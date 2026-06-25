import { describe, it, expect } from 'vitest';
import { x25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha2';
import {
  deriveKid,
  generateX25519KeyPair,
  fromX25519PrivateKey,
  E2EE_KID_BYTES,
  X25519_PRIVATE_KEY_BYTES,
  X25519_PUBLIC_KEY_BYTES,
} from './keypair.js';

// Deterministic xorshift32 RNG so assertions are reproducible. Randomness quality is
// irrelevant here; we only need 32 distinct bytes per call.
function makeRng(seed = 0x9e3779b9): (n: number) => Uint8Array {
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

describe('deriveKid', () => {
  it('produces a 32-char hex string (16 bytes) for a valid public key', () => {
    const pub = x25519.getPublicKey(new Uint8Array(32).fill(7));
    const kid = deriveKid(pub);
    expect(kid).toMatch(/^[0-9a-f]{32}$/);
    expect(E2EE_KID_BYTES).toBe(16);
  });

  it('equals the first 16 bytes of SHA-256(publicKey), hex', () => {
    const pub = x25519.getPublicKey(makeRng(1)(32));
    const kid = deriveKid(pub);
    const expected = Array.from(sha256(pub).subarray(0, 16))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    expect(kid).toBe(expected);
  });

  it('is deterministic: same public key -> same kid', () => {
    const pub = x25519.getPublicKey(makeRng(42)(32));
    expect(deriveKid(pub)).toBe(deriveKid(pub));
  });

  it('differs across distinct public keys', () => {
    const a = deriveKid(x25519.getPublicKey(makeRng(1)(32)));
    const b = deriveKid(x25519.getPublicKey(makeRng(2)(32)));
    expect(a).not.toBe(b);
  });

  it('throws on a wrong-length public key (never silently weakens the id)', () => {
    expect(() => deriveKid(new Uint8Array(31))).toThrow(TypeError);
    expect(() => deriveKid(new Uint8Array(33))).toThrow(TypeError);
  });
});

describe('generateX25519KeyPair', () => {
  it('returns 32-byte private + 32-byte public key + a kid', () => {
    const kp = generateX25519KeyPair(makeRng(99));
    expect(kp.privateKey.length).toBe(X25519_PRIVATE_KEY_BYTES);
    expect(kp.publicKey.length).toBe(X25519_PUBLIC_KEY_BYTES);
    expect(kp.kid).toMatch(/^[0-9a-f]{32}$/);
  });

  it('derives the public key from the private key via X25519 scalar-mult', () => {
    const rng = makeRng(7);
    const kp = generateX25519KeyPair(rng);
    expect(kp.publicKey).toEqual(x25519.getPublicKey(kp.privateKey));
  });

  it('kid matches deriveKid of the generated public key (single source of truth)', () => {
    const kp = generateX25519KeyPair(makeRng(5));
    expect(kp.kid).toBe(deriveKid(kp.publicKey));
  });

  it('is deterministic for a deterministic RNG (reproducible)', () => {
    const a = generateX25519KeyPair(makeRng(123));
    const b = generateX25519KeyPair(makeRng(123));
    expect(Array.from(a.privateKey)).toEqual(Array.from(b.privateKey));
    expect(Array.from(a.publicKey)).toEqual(Array.from(b.publicKey));
    expect(a.kid).toBe(b.kid);
  });

  it('throws when the RNG returns the wrong length (fails loud, never weakens)', () => {
    const bad = (): Uint8Array => new Uint8Array(16);
    expect(() => generateX25519KeyPair(bad)).toThrow();
  });
});

describe('fromX25519PrivateKey', () => {
  it('reconstructs the same public key + kid as generateX25519KeyPair', () => {
    const rng = makeRng(31);
    const original = generateX25519KeyPair(rng);
    const restored = fromX25519PrivateKey(original.privateKey);
    expect(Array.from(restored.privateKey)).toEqual(Array.from(original.privateKey));
    expect(Array.from(restored.publicKey)).toEqual(Array.from(original.publicKey));
    expect(restored.kid).toBe(original.kid);
  });

  it('re-derives the kid from the public key (no stored drift possible)', () => {
    const kp = fromX25519PrivateKey(makeRng(8)(32));
    expect(kp.kid).toBe(deriveKid(kp.publicKey));
  });

  it('throws on a wrong-length private key', () => {
    expect(() => fromX25519PrivateKey(new Uint8Array(31))).toThrow(TypeError);
  });
});
