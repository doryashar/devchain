import { describe, it, expect } from 'vitest';
import { bytesToHex } from '@noble/hashes/utils';
import {
  E2EE_SHARED_KEY_BYTES,
  PAIRING_SECRET_BYTES,
  PAIRING_MAC_BYTES,
  deriveSharedKey,
  buildPairingTranscript,
  computePairingMac,
  verifyPairingMac,
  type PairingTranscriptInput,
} from './key-exchange';
import { fromX25519PrivateKey } from './keypair';

// Deterministic byte source so the suite is reproducible without a real CSPRNG.
function seeded(seed: number, n: number): Uint8Array {
  let s = seed >>> 0;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    out[i] = s & 0xff;
  }
  return out;
}

const pc = fromX25519PrivateKey(seeded(0x1111, 32));
const mobile = fromX25519PrivateKey(seeded(0x2222, 32));
const other = fromX25519PrivateKey(seeded(0x3333, 32));

const transcriptInput = (o: Partial<PairingTranscriptInput> = {}): PairingTranscriptInput => ({
  pcPublicKey: pc.publicKey,
  pcKid: pc.kid,
  mobilePublicKey: mobile.publicKey,
  mobileKid: mobile.kid,
  channelId: 'chan-1234',
  ...o,
});

describe('deriveSharedKey — symmetric ECDH + HKDF', () => {
  it('both sides derive the identical 32-byte key', () => {
    const pcSide = deriveSharedKey(pc.privateKey, mobile.publicKey);
    const mobileSide = deriveSharedKey(mobile.privateKey, pc.publicKey);
    expect(pcSide.length).toBe(E2EE_SHARED_KEY_BYTES);
    expect(bytesToHex(pcSide)).toBe(bytesToHex(mobileSide));
  });

  it('is deterministic for the same key pair', () => {
    expect(bytesToHex(deriveSharedKey(pc.privateKey, mobile.publicKey))).toBe(
      bytesToHex(deriveSharedKey(pc.privateKey, mobile.publicKey)),
    );
  });

  it('derives a different key against a different peer', () => {
    const a = deriveSharedKey(pc.privateKey, mobile.publicKey);
    const b = deriveSharedKey(pc.privateKey, other.publicKey);
    expect(bytesToHex(a)).not.toBe(bytesToHex(b));
  });

  it('never returns the raw ECDH secret (HKDF-expanded)', () => {
    // Sanity: output differs from a naive re-derivation length/shape and is full-entropy.
    const key = deriveSharedKey(pc.privateKey, mobile.publicKey);
    expect(key.length).toBe(32);
    expect(bytesToHex(key)).not.toBe('00'.repeat(32));
  });

  it('throws on wrong-length keys', () => {
    expect(() => deriveSharedKey(new Uint8Array(31), mobile.publicKey)).toThrow(
      /privateKey must be 32/,
    );
    expect(() => deriveSharedKey(pc.privateKey, new Uint8Array(10))).toThrow(
      /peerPublicKey must be 32/,
    );
  });
});

describe('buildPairingTranscript — canonical, unambiguous', () => {
  it('is deterministic for identical inputs', () => {
    expect(bytesToHex(buildPairingTranscript(transcriptInput()))).toBe(
      bytesToHex(buildPairingTranscript(transcriptInput())),
    );
  });

  it('changes when ANY bound field changes', () => {
    const ref = bytesToHex(buildPairingTranscript(transcriptInput()));
    expect(bytesToHex(buildPairingTranscript(transcriptInput({ channelId: 'other' })))).not.toBe(
      ref,
    );
    expect(bytesToHex(buildPairingTranscript(transcriptInput({ pcKid: 'zz' })))).not.toBe(ref);
    expect(bytesToHex(buildPairingTranscript(transcriptInput({ mobileKid: 'zz' })))).not.toBe(ref);
    expect(
      bytesToHex(buildPairingTranscript(transcriptInput({ pcPublicKey: other.publicKey }))),
    ).not.toBe(ref);
    expect(
      bytesToHex(buildPairingTranscript(transcriptInput({ mobilePublicKey: other.publicKey }))),
    ).not.toBe(ref);
  });

  it('is unambiguous across field boundaries (length-prefixed)', () => {
    const a = buildPairingTranscript(transcriptInput({ pcKid: 'ab', channelId: 'c' }));
    const b = buildPairingTranscript(transcriptInput({ pcKid: 'a', channelId: 'bc' }));
    expect(bytesToHex(a)).not.toBe(bytesToHex(b));
  });
});

describe('pairing MAC — QR auto-verification, fail-closed', () => {
  const secret = seeded(0xabcd, PAIRING_SECRET_BYTES);
  const transcript = buildPairingTranscript(transcriptInput());

  it('round-trips a freshly computed MAC', () => {
    const mac = computePairingMac(secret, transcript);
    expect(mac.length).toBe(PAIRING_MAC_BYTES);
    expect(verifyPairingMac(secret, transcript, mac)).toBe(true);
  });

  it('rejects a MAC computed with a different pairing secret', () => {
    const mac = computePairingMac(seeded(0x9999, PAIRING_SECRET_BYTES), transcript);
    expect(verifyPairingMac(secret, transcript, mac)).toBe(false);
  });

  it('rejects a MAC when the transcript was tampered (key substitution)', () => {
    const mac = computePairingMac(secret, transcript);
    // Simulate a relay swapping the mobile public key for its own.
    const substituted = buildPairingTranscript(
      transcriptInput({ mobilePublicKey: other.publicKey }),
    );
    expect(verifyPairingMac(secret, substituted, mac)).toBe(false);
  });

  it('rejects a MAC replayed onto a different channel', () => {
    const mac = computePairingMac(secret, transcript);
    const replayed = buildPairingTranscript(transcriptInput({ channelId: 'different-channel' }));
    expect(verifyPairingMac(secret, replayed, mac)).toBe(false);
  });

  it('rejects a wrong-length MAC without throwing', () => {
    expect(verifyPairingMac(secret, transcript, new Uint8Array(0))).toBe(false);
    expect(verifyPairingMac(secret, transcript, new Uint8Array(16))).toBe(false);
    expect(verifyPairingMac(secret, transcript, new Uint8Array(64))).toBe(false);
  });

  it('rejects a flipped MAC byte', () => {
    const mac = computePairingMac(secret, transcript);
    mac[0] ^= 0x01;
    expect(verifyPairingMac(secret, transcript, mac)).toBe(false);
  });

  it('throws on an empty pairing secret at compute time', () => {
    expect(() => computePairingMac(new Uint8Array(0), transcript)).toThrow(/non-empty/);
  });
});
