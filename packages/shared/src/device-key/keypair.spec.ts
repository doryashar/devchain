import { describe, it, expect } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha2';
import {
  ED25519_PRIVATE_KEY_BYTES,
  ED25519_PUBLIC_KEY_BYTES,
  ED25519_SIGNATURE_BYTES,
  DEVICE_KEY_KTY,
  DEVICE_KEY_CRV,
  fromEd25519PrivateKey,
  generateEd25519KeyPair,
  publicKeyToJwk,
  canonicalJwk,
  computeJwkThumbprint,
  signMessage,
  verifySignature,
} from './keypair.js';

// Deterministic xorshift32 RNG so assertions are reproducible. Randomness quality is
// irrelevant; we only need 32 distinct bytes per call.
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

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('generateEd25519KeyPair / fromEd25519PrivateKey', () => {
  it('returns 32-byte private + 32-byte public key', () => {
    const kp = generateEd25519KeyPair(makeRng(1));
    expect(kp.privateKey.length).toBe(ED25519_PRIVATE_KEY_BYTES);
    expect(kp.publicKey.length).toBe(ED25519_PUBLIC_KEY_BYTES);
  });

  it('derives the public key from the private key via Ed25519 scalar-base', () => {
    const kp = generateEd25519KeyPair(makeRng(2));
    expect(kp.publicKey).toEqual(ed25519.getPublicKey(kp.privateKey));
  });

  it('is deterministic for a deterministic RNG', () => {
    const a = generateEd25519KeyPair(makeRng(7));
    const b = generateEd25519KeyPair(makeRng(7));
    expect(Array.from(a.privateKey)).toEqual(Array.from(b.privateKey));
    expect(Array.from(a.publicKey)).toEqual(Array.from(b.publicKey));
  });

  it('reconstructs identically from the private key (single source of truth)', () => {
    const original = generateEd25519KeyPair(makeRng(9));
    const restored = fromEd25519PrivateKey(original.privateKey);
    expect(Array.from(restored.privateKey)).toEqual(Array.from(original.privateKey));
    expect(Array.from(restored.publicKey)).toEqual(Array.from(original.publicKey));
  });

  it('throws on a wrong-length private key (fails loud, never weakens)', () => {
    expect(() => fromEd25519PrivateKey(new Uint8Array(31))).toThrow(TypeError);
    expect(() => generateEd25519KeyPair((): Uint8Array => new Uint8Array(16))).toThrow();
  });
});

describe('publicKeyToJwk / canonicalJwk', () => {
  it('produces an OKP/Ed25519 JWK with base64url(no-pad) `x`', () => {
    const kp = generateEd25519KeyPair(makeRng(3));
    const jwk = publicKeyToJwk(kp.publicKey);
    expect(jwk.kty).toBe(DEVICE_KEY_KTY);
    expect(jwk.crv).toBe(DEVICE_KEY_CRV);
    // base64url no padding: 32 bytes -> 43 chars, charset [-_A-Za-z0-9] only.
    expect(jwk.x).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('canonicalJwk is the lexicographic, whitespace-free serialization', () => {
    const kp = generateEd25519KeyPair(makeRng(4));
    const jwk = publicKeyToJwk(kp.publicKey);
    expect(canonicalJwk(kp.publicKey)).toBe(
      `{"crv":"${jwk.crv}","kty":"${jwk.kty}","x":"${jwk.x}"}`,
    );
  });

  it('throws on a wrong-length public key', () => {
    expect(() => publicKeyToJwk(new Uint8Array(31))).toThrow(TypeError);
    expect(() => canonicalJwk(new Uint8Array(33))).toThrow(TypeError);
  });
});

describe('computeJwkThumbprint (RFC 7638)', () => {
  it('produces a 43-char base64url(no-pad) string (SHA-256 = 32 bytes)', () => {
    const kp = generateEd25519KeyPair(makeRng(5));
    expect(computeJwkThumbprint(kp.publicKey)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('equals base64url(SHA-256(canonical-JWK)) computed independently (RFC 7638 formula)', () => {
    const kp = generateEd25519KeyPair(makeRng(11));
    // Re-derive the canonical input WITHOUT reusing the helper's internal builder, to
    // prove the thumbprint follows the RFC rather than just self-consistency.
    const independentCanonical = JSON.stringify(
      { crv: 'Ed25519', kty: 'OKP', x: publicKeyToJwk(kp.publicKey).x },
      Object.keys({ crv: '', kty: '', x: '' }).sort(),
    );
    const expected = sha256(utf8(independentCanonical));
    const b64url = Buffer.from(expected)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(computeJwkThumbprint(kp.publicKey)).toBe(b64url);
  });

  it('is deterministic and differs across distinct public keys', () => {
    const a = generateEd25519KeyPair(makeRng(20));
    const b = generateEd25519KeyPair(makeRng(21));
    expect(computeJwkThumbprint(a.publicKey)).toBe(computeJwkThumbprint(a.publicKey));
    expect(computeJwkThumbprint(a.publicKey)).not.toBe(computeJwkThumbprint(b.publicKey));
  });

  it('throws on a wrong-length public key (never silently weakens the binding id)', () => {
    expect(() => computeJwkThumbprint(new Uint8Array(31))).toThrow(TypeError);
  });

  // CROSS-IMPL CONTRACT (RFC 7638 drift guard): the identity-service Node-native impl
  // (apps/identity-service/src/common/crypto/device-key.spec.ts) pins the SAME fixed vector.
  // The two impls can't be imported together, so this shared known-answer keeps them in lockstep:
  // a server `cnf.jkt` will always match the thumbprint this mobile mirror computes.
  it('matches the identity-service cross-impl known-answer vector (32-byte key [0..31])', () => {
    const fixedPubKey = Uint8Array.from(Array.from({ length: 32 }, (_, i) => i));
    expect(computeJwkThumbprint(fixedPubKey)).toBe('P7IdLIpiTZiFaIoOSqbX3JrSyps3hvZ4Y2SieP96XIY');
  });
});

describe('signMessage / verifySignature', () => {
  it('produces a verifiable 64-byte Ed25519 signature (round-trip)', () => {
    const kp = generateEd25519KeyPair(makeRng(30));
    const msg = utf8('POST:/auth/refresh:aud:iat:1700000000:<sha256>');
    const sig = signMessage(kp.privateKey, msg);
    expect(sig.length).toBe(ED25519_SIGNATURE_BYTES);
    expect(verifySignature(kp.publicKey, msg, sig)).toBe(true);
  });

  it('rejects a tampered message', () => {
    const kp = generateEd25519KeyPair(makeRng(31));
    const sig = signMessage(kp.privateKey, utf8('message-a'));
    expect(verifySignature(kp.publicKey, utf8('message-b'), sig)).toBe(false);
  });

  it('rejects a signature verified against the wrong public key', () => {
    const a = generateEd25519KeyPair(makeRng(32));
    const b = generateEd25519KeyPair(makeRng(33));
    const sig = signMessage(a.privateKey, utf8('message'));
    expect(verifySignature(b.publicKey, utf8('message'), sig)).toBe(false);
  });

  it('verifySignature returns false (never throws) on a malformed signature', () => {
    const kp = generateEd25519KeyPair(makeRng(34));
    expect(verifySignature(kp.publicKey, utf8('message'), new Uint8Array(10))).toBe(false);
  });
});
