import { describe, it, expect, vi, afterEach } from 'vitest';
import { webcrypto } from 'node:crypto';
import { CryptoEnvelopeService } from './crypto-envelope.service';
import {
  E2EE_ALG_XCHACHA20POLY1305,
  E2EE_ENVELOPE_VERSION,
  E2EE_KEY_BYTES,
  E2EE_NONCE_BYTES,
  E2eeAuthenticationError,
  E2eeInvalidKeyError,
  E2eeMalformedEnvelopeError,
  E2eeUnknownKeyError,
  E2eeUnsupportedAlgError,
  E2eeUnsupportedVersionError,
  type E2eeContext,
  type E2eeEnvelope,
  type E2eeKeyProvider,
} from './envelope';
import { bytesToBase64, base64ToBytes } from './base64';

// CSPRNG-backed, chunked to dodge webcrypto's 64 KiB getRandomValues cap.
const randomBytes = (n: number): Uint8Array => {
  const out = new Uint8Array(n);
  for (let off = 0; off < n; off += 65536) {
    webcrypto.getRandomValues(out.subarray(off, Math.min(off + 65536, n)));
  }
  return out;
};

/** In-memory key provider: a single active key plus a kid->key map. */
function makeKeys(
  active = 'k1',
): E2eeKeyProvider & { add(kid: string, key?: Uint8Array): Uint8Array } {
  const map = new Map<string, Uint8Array>();
  const add = (kid: string, key = randomBytes(E2EE_KEY_BYTES)) => {
    map.set(kid, key);
    return key;
  };
  add(active);
  return {
    add,
    resolveSealKey: () => ({ kid: active, key: map.get(active)! }),
    getKeyById: (kid: string) => map.get(kid),
  };
}

const ctx = (overrides: Partial<E2eeContext> = {}): E2eeContext => ({
  lane: 'rpc',
  direction: 'pc-to-mobile',
  instanceId: 'inst-1',
  routeKey: 'session.transcript',
  ...overrides,
});

afterEach(() => vi.restoreAllMocks());

describe('CryptoEnvelopeService — round-trip', () => {
  it('seals and opens an arbitrary JSON object', async () => {
    const svc = new CryptoEnvelopeService(makeKeys(), randomBytes);
    const msg = {
      method: 'foo',
      params: { a: 1, b: ['x', null, true], nested: { deep: 'value' } },
    };
    const env = await svc.seal(msg, ctx());
    expect(env.v).toBe(E2EE_ENVELOPE_VERSION);
    expect(env.alg).toBe(E2EE_ALG_XCHACHA20POLY1305);
    expect(env.kid).toBe('k1');
    expect(base64ToBytes(env.nonce).length).toBe(E2EE_NONCE_BYTES);
    expect(env.recipients).toBeUndefined();
    await expect(svc.open(env, ctx())).resolves.toEqual(msg);
  });

  it('round-trips primitives, arrays, empty objects, and unicode', async () => {
    const svc = new CryptoEnvelopeService(makeKeys(), randomBytes);
    for (const msg of [0, '', 'héllo 🌍', [], {}, [1, 2, 3], { '': null }, false] as const) {
      const env = await svc.seal(msg, ctx());
      await expect(svc.open(env, ctx())).resolves.toEqual(msg);
    }
  });

  it('round-trips a large (~256 KiB) payload', async () => {
    const svc = new CryptoEnvelopeService(makeKeys(), randomBytes);
    const msg = { frame: 'x'.repeat(256 * 1024) };
    const env = await svc.seal(msg, ctx({ lane: 'viewport', routeKey: 'sess-9', seq: 42 }));
    await expect(
      svc.open(env, ctx({ lane: 'viewport', routeKey: 'sess-9', seq: 42 })),
    ).resolves.toEqual(msg);
  });

  it('uses a fresh random nonce per seal (no nonce reuse)', async () => {
    const svc = new CryptoEnvelopeService(makeKeys(), randomBytes);
    const nonces = new Set<string>();
    for (let i = 0; i < 100; i++) nonces.add((await svc.seal({ i }, ctx())).nonce);
    expect(nonces.size).toBe(100);
  });

  it('the ciphertext does not contain the plaintext (content is hidden)', async () => {
    const svc = new CryptoEnvelopeService(makeKeys(), randomBytes);
    const secret = 'TOP-SECRET-NEEDLE-9f3a';
    const env = await svc.seal({ secret }, ctx());
    expect(env.ct.includes('SECRET')).toBe(false);
    expect(bytesToUtf8Safe(base64ToBytes(env.ct)).includes(secret)).toBe(false);
  });
});

describe('CryptoEnvelopeService — tamper & replay fail closed', () => {
  it('rejects a flipped ciphertext byte', async () => {
    const svc = new CryptoEnvelopeService(makeKeys(), randomBytes);
    const env = await svc.seal({ a: 1 }, ctx());
    const ct = base64ToBytes(env.ct);
    ct[0] ^= 0x01;
    const tampered: E2eeEnvelope = { ...env, ct: bytesToBase64(ct) };
    await expect(svc.open(tampered, ctx())).rejects.toBeInstanceOf(E2eeAuthenticationError);
  });

  it('rejects a flipped nonce byte', async () => {
    const svc = new CryptoEnvelopeService(makeKeys(), randomBytes);
    const env = await svc.seal({ a: 1 }, ctx());
    const nonce = base64ToBytes(env.nonce);
    nonce[0] ^= 0x80;
    await expect(svc.open({ ...env, nonce: bytesToBase64(nonce) }, ctx())).rejects.toBeInstanceOf(
      E2eeAuthenticationError,
    );
  });

  it.each([
    ['routeKey', ctx({ routeKey: 'other.topic' })],
    ['lane', ctx({ lane: 'push' })],
    ['direction', ctx({ direction: 'mobile-to-pc' })],
    ['instanceId', ctx({ instanceId: 'inst-2' })],
    ['seq present vs absent', ctx({ seq: 0 })],
  ])('rejects an AAD/context mismatch on %s (replay protection)', async (_name, openCtx) => {
    const svc = new CryptoEnvelopeService(makeKeys(), randomBytes);
    const env = await svc.seal({ a: 1 }, ctx());
    await expect(svc.open(env, openCtx)).rejects.toBeInstanceOf(E2eeAuthenticationError);
  });

  it('distinguishes seq=0 from seq absent in the AAD', async () => {
    const svc = new CryptoEnvelopeService(makeKeys(), randomBytes);
    const env = await svc.seal({ a: 1 }, ctx({ seq: 0 }));
    await expect(svc.open(env, ctx({ seq: 0 }))).resolves.toEqual({ a: 1 });
    await expect(svc.open(env, ctx())).rejects.toBeInstanceOf(E2eeAuthenticationError);
  });

  it('rejects a kid swapped to another known key (kid is bound in AAD + wrong key)', async () => {
    const keys = makeKeys('k1');
    keys.add('k2');
    const svc = new CryptoEnvelopeService(keys, randomBytes);
    const env = await svc.seal({ a: 1 }, ctx());
    await expect(svc.open({ ...env, kid: 'k2' }, ctx())).rejects.toBeInstanceOf(
      E2eeAuthenticationError,
    );
  });
});

describe('CryptoEnvelopeService — versioning & typed rejections (no crash)', () => {
  it('rejects an unknown version', async () => {
    const svc = new CryptoEnvelopeService(makeKeys(), randomBytes);
    const env = await svc.seal({ a: 1 }, ctx());
    await expect(svc.open({ ...env, v: 999 } as E2eeEnvelope, ctx())).rejects.toBeInstanceOf(
      E2eeUnsupportedVersionError,
    );
  });

  it('rejects an unknown alg', async () => {
    const svc = new CryptoEnvelopeService(makeKeys(), randomBytes);
    const env = await svc.seal({ a: 1 }, ctx());
    await expect(
      svc.open({ ...env, alg: 'AES-GCM' } as unknown as E2eeEnvelope, ctx()),
    ).rejects.toBeInstanceOf(E2eeUnsupportedAlgError);
  });

  it('rejects an unknown key id', async () => {
    const svc = new CryptoEnvelopeService(makeKeys(), randomBytes);
    const env = await svc.seal({ a: 1 }, ctx());
    await expect(svc.open({ ...env, kid: 'never-seen' }, ctx())).rejects.toBeInstanceOf(
      E2eeUnknownKeyError,
    );
  });

  it.each([
    null,
    undefined,
    42,
    'string',
    {},
    { v: 1, kid: 'k1', alg: 'XC20P', nonce: '', ct: 'AA==' }, // empty nonce
    { v: 1, kid: 'k1', alg: 'XC20P', nonce: 'AA==', ct: '' }, // empty ct
    { v: 1, kid: '', alg: 'XC20P', nonce: 'AA==', ct: 'AA==' }, // empty kid
  ])('rejects a malformed envelope shape: %j', async (bad) => {
    const svc = new CryptoEnvelopeService(makeKeys(), randomBytes);
    await expect(svc.open(bad, ctx())).rejects.toBeInstanceOf(E2eeMalformedEnvelopeError);
  });

  it('rejects non-base64 nonce/ct with a malformed error (not a crash)', async () => {
    const svc = new CryptoEnvelopeService(makeKeys(), randomBytes);
    const env = await svc.seal({ a: 1 }, ctx());
    await expect(svc.open({ ...env, nonce: 'not base64!!!' }, ctx())).rejects.toBeInstanceOf(
      E2eeMalformedEnvelopeError,
    );
  });

  it('rejects a wrong-length (but valid base64) nonce', async () => {
    const svc = new CryptoEnvelopeService(makeKeys(), randomBytes);
    const env = await svc.seal({ a: 1 }, ctx());
    await expect(
      svc.open({ ...env, nonce: bytesToBase64(new Uint8Array(12)) }, ctx()),
    ).rejects.toBeInstanceOf(E2eeMalformedEnvelopeError);
  });
});

describe('CryptoEnvelopeService — key validation & RNG', () => {
  it('rejects a wrong-length seal key', async () => {
    const bad: E2eeKeyProvider = {
      resolveSealKey: () => ({ kid: 'k1', key: new Uint8Array(16) }),
      getKeyById: () => new Uint8Array(16),
    };
    const svc = new CryptoEnvelopeService(bad, randomBytes);
    await expect(svc.seal({ a: 1 }, ctx())).rejects.toBeInstanceOf(E2eeInvalidKeyError);
  });

  it('rejects a wrong-length key at open', async () => {
    const good = makeKeys();
    const env = await new CryptoEnvelopeService(good, randomBytes).seal({ a: 1 }, ctx());
    const bad: E2eeKeyProvider = {
      resolveSealKey: good.resolveSealKey,
      getKeyById: () => new Uint8Array(31),
    };
    await expect(
      new CryptoEnvelopeService(bad, randomBytes).open(env, ctx()),
    ).rejects.toBeInstanceOf(E2eeInvalidKeyError);
  });

  it('fails loudly if the RNG returns the wrong nonce length', async () => {
    const svc = new CryptoEnvelopeService(makeKeys(), () => new Uint8Array(8));
    await expect(svc.seal({ a: 1 }, ctx())).rejects.toThrow(/RNG returned 8 bytes/);
  });

  it('supports an async key provider (mobile keystore is async)', async () => {
    const map = new Map([['k1', randomBytes(E2EE_KEY_BYTES)]]);
    const asyncKeys: E2eeKeyProvider = {
      resolveSealKey: async () => ({ kid: 'k1', key: map.get('k1')! }),
      getKeyById: async (kid) => map.get(kid),
    };
    const svc = new CryptoEnvelopeService(asyncKeys, randomBytes);
    const env = await svc.seal({ hi: true }, ctx());
    await expect(svc.open(env, ctx())).resolves.toEqual({ hi: true });
  });
});

describe('CryptoEnvelopeService — no secret leakage', () => {
  it('never logs key material or plaintext during seal/open', async () => {
    const spies = [
      vi.spyOn(console, 'log').mockImplementation(() => {}),
      vi.spyOn(console, 'info').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {}),
      vi.spyOn(console, 'debug').mockImplementation(() => {}),
    ];
    const svc = new CryptoEnvelopeService(makeKeys(), randomBytes);
    const env = await svc.seal({ secret: 'NEEDLE' }, ctx());
    await svc.open(env, ctx());
    // also exercise an error path
    await svc.open({ ...env, ct: bytesToBase64(new Uint8Array(20)) }, ctx()).catch(() => {});
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });

  it('error messages do not echo plaintext', async () => {
    const svc = new CryptoEnvelopeService(makeKeys(), randomBytes);
    const env = await svc.seal({ secret: 'NEEDLE-XYZ' }, ctx());
    const err = await svc.open(env, ctx({ routeKey: 'wrong' })).catch((e) => e as Error);
    expect(err.message.includes('NEEDLE')).toBe(false);
  });
});

// Local helper: decode bytes to a string without throwing on invalid utf8 (for the
// "ciphertext doesn't contain plaintext" assertion only).
function bytesToUtf8Safe(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}
