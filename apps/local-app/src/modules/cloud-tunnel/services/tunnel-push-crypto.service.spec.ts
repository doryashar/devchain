import {
  CryptoEnvelopeService,
  generateX25519KeyPair,
  deriveSharedKey,
  bytesToBase64,
  E2eeAuthenticationError,
  type E2eeContext,
  type E2eeEnvelope,
  type E2eeKeyProvider,
} from '@devchain/shared';
import { TunnelPushCryptoService, pushRouteKey } from './tunnel-push-crypto.service';

// Test layer: module-unit. The crypto is the REAL shared `CryptoEnvelopeService` / X25519
// ECDH (resolved via the jest shim), with the keypair + device-store deps faked. It proves
// the push seam (1) seals the payload under the paired device's shared key, binding
// topic+eventType into the AAD; (2) the phone half opens it; (3) returns plaintext / blocked
// when no usable device is paired (driving the forwarder's content-bearing guard).

const INSTANCE_ID = 'inst-push-1';

function makeRng(seed: number): (n: number) => Uint8Array {
  let s = seed >>> 0;
  return (n: number) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      out[i] = s & 0xff;
    }
    return out;
  };
}

const pc = generateX25519KeyPair(makeRng(0x1111));
const mobile = generateX25519KeyPair(makeRng(0x2222));
const sharedKey = deriveSharedKey(mobile.privateKey, pc.publicKey);

/** The phone's half: open a PC-sealed push payload bound to a (topic, eventType). */
function mobileEnvelopeService(): CryptoEnvelopeService {
  const provider: E2eeKeyProvider = {
    resolveSealKey: () => ({ kid: mobile.kid, key: sharedKey }),
    getKeyById: (kid) => (kid === pc.kid || kid === mobile.kid ? sharedKey : undefined),
  };
  return new CryptoEnvelopeService(provider, makeRng(0x3333));
}

const openCtx = (topic: string, eventType: string): E2eeContext => ({
  lane: 'push',
  direction: 'pc-to-mobile',
  instanceId: INSTANCE_ID,
  routeKey: pushRouteKey(topic, eventType),
});

interface FakeDevice {
  kid: string;
  publicKeyB64: string;
  trust: 'unverified' | 'verified' | 'revoked';
  addedAt: string;
}

const pairedDevice: FakeDevice = {
  kid: mobile.kid,
  publicKeyB64: bytesToBase64(mobile.publicKey),
  trust: 'verified',
  addedAt: '2026-01-01T00:00:00.000Z',
};

function makeService(devices: FakeDevice[], opts?: { e2eeRequired?: boolean }) {
  const keypair = { getOrCreate: jest.fn().mockResolvedValue(pc) };
  const deviceStore = { list: jest.fn(() => devices) };
  const svc = new TunnelPushCryptoService(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    keypair as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    deviceStore as any,
    opts?.e2eeRequired,
  );
  return { svc, keypair, deviceStore };
}

describe('TunnelPushCryptoService', () => {
  it('seals the payload for a paired device — phone opens it with matching topic/eventType', async () => {
    const { svc } = makeService([pairedDevice]);
    const channel = await svc.resolvePushChannel(INSTANCE_ID);
    expect(channel.mode).toBe('encrypted');
    expect(channel.seal).toBeDefined();

    const payload = { toolUseId: 'tu1', question: 'Deploy to prod?' };
    const env = (await channel.seal!(
      'session/s1',
      'ask_user_question.pending',
      payload,
    )) as E2eeEnvelope;

    // The envelope is sealed under THIS PC's kid (phone maps it to the same shared key).
    expect(env.kid).toBe(pc.kid);
    expect(env.alg).toBe('XC20P');
    // The phone opens it with the SAME (topic, eventType) AAD.
    const opened = await mobileEnvelopeService().open(
      env,
      openCtx('session/s1', 'ask_user_question.pending'),
    );
    expect(opened).toEqual(payload);
  });

  it('binds topic+eventType into the AAD — opening with a different route fails closed', async () => {
    const { svc } = makeService([pairedDevice]);
    const channel = await svc.resolvePushChannel(INSTANCE_ID);
    const env = (await channel.seal!('chat/t1', 'message.created', {
      id: 'm1',
      content: 'hi',
    })) as E2eeEnvelope;

    // Same ciphertext, wrong eventType → authentication failure (no plaintext leak).
    await expect(
      mobileEnvelopeService().open(env, openCtx('chat/t1', 'wrong.event')),
    ).rejects.toBeInstanceOf(E2eeAuthenticationError);
    // Wrong topic also fails.
    await expect(
      mobileEnvelopeService().open(env, openCtx('chat/other', 'message.created')),
    ).rejects.toBeInstanceOf(E2eeAuthenticationError);
  });

  it('falls back to plaintext (no seal) when no device is paired', async () => {
    const { svc } = makeService([]);
    const channel = await svc.resolvePushChannel(INSTANCE_ID);
    expect(channel.mode).toBe('plaintext');
    expect(channel.seal).toBeUndefined();
  });

  it('blocks (withholds everything) when E2EE is required but no device is paired', async () => {
    const { svc } = makeService([], { e2eeRequired: true });
    const channel = await svc.resolvePushChannel(INSTANCE_ID);
    expect(channel.mode).toBe('blocked');
    expect(channel.reason).toBe('peer-incapable-required');
  });

  it('still encrypts when E2EE is required AND a device is paired', async () => {
    const { svc } = makeService([pairedDevice], { e2eeRequired: true });
    const channel = await svc.resolvePushChannel(INSTANCE_ID);
    expect(channel.mode).toBe('encrypted');
  });

  it('treats a missing instanceId (pre-ready) as plaintext — cannot bind AAD', async () => {
    const { svc, keypair } = makeService([pairedDevice]);
    const channel = await svc.resolvePushChannel(null);
    expect(channel.mode).toBe('plaintext');
    // No crypto work attempted without an instance to bind.
    expect(keypair.getOrCreate).not.toHaveBeenCalled();
  });

  it('blocks (withholds everything) when E2EE is required and the local keypair fails to load', async () => {
    // Even with a usable paired device, a broken LOCAL keypair must not leak hint frames
    // in plaintext under strict mode — the lane fails closed and the forwarder withholds all.
    const { svc, keypair } = makeService([pairedDevice], { e2eeRequired: true });
    keypair.getOrCreate.mockRejectedValueOnce(new Error('keystore unavailable'));
    const channel = await svc.resolvePushChannel(INSTANCE_ID);
    expect(channel.mode).toBe('blocked');
    expect(channel.reason).toBe('peer-incapable-required');
    expect(channel.seal).toBeUndefined();
  });

  it('falls back to plaintext (hints only) when the local keypair fails and E2EE is optional', async () => {
    const { svc, keypair } = makeService([pairedDevice]);
    keypair.getOrCreate.mockRejectedValueOnce(new Error('keystore unavailable'));
    const channel = await svc.resolvePushChannel(INSTANCE_ID);
    expect(channel.mode).toBe('plaintext');
    expect(channel.seal).toBeUndefined();
  });

  it('ignores revoked / structurally invalid device keys (fail-closed selection)', async () => {
    const revoked: FakeDevice = { ...pairedDevice, kid: 'k-revoked', trust: 'revoked' };
    const malformed: FakeDevice = {
      kid: 'k-bad',
      publicKeyB64: 'not-base64!!',
      trust: 'verified',
      addedAt: '2026-01-02T00:00:00.000Z',
    };
    const { svc } = makeService([revoked, malformed]);
    const channel = await svc.resolvePushChannel(INSTANCE_ID);
    expect(channel.mode).toBe('plaintext');
  });

  it('with multiple usable devices, seals for the most recently added (v1 single-recipient)', async () => {
    const older: FakeDevice = { ...pairedDevice, addedAt: '2026-01-01T00:00:00.000Z' };
    // A second usable device added LATER, with a different (valid) key.
    const newerKp = generateX25519KeyPair(makeRng(0x4444));
    const newerShared = deriveSharedKey(newerKp.privateKey, pc.publicKey);
    const newer: FakeDevice = {
      kid: newerKp.kid,
      publicKeyB64: bytesToBase64(newerKp.publicKey),
      trust: 'verified',
      addedAt: '2026-02-01T00:00:00.000Z',
    };
    const { svc } = makeService([older, newer]);
    const channel = await svc.resolvePushChannel(INSTANCE_ID);
    expect(channel.mode).toBe('encrypted');

    const env = (await channel.seal!('agent/a1', 'presence', { online: true })) as E2eeEnvelope;
    // Opens with the NEWER device's shared key, not the older one.
    const newerProvider: E2eeKeyProvider = {
      resolveSealKey: () => ({ kid: newerKp.kid, key: newerShared }),
      getKeyById: (kid) => (kid === pc.kid || kid === newerKp.kid ? newerShared : undefined),
    };
    const opened = await new CryptoEnvelopeService(newerProvider, makeRng(0x5555)).open(
      env,
      openCtx('agent/a1', 'presence'),
    );
    expect(opened).toEqual({ online: true });
  });
});
