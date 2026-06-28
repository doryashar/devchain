// Ed25519 device SIGNING keypair + RFC 7638 JWK thumbprint (device-bound auth).
//
// This is the SIGNING leg of device-bound refresh tokens (Phase 1, epic 7a29cb1e): the
// key whose possession the identity service verifies on /auth/refresh. It is a SIBLING
// to — and NEVER reused as — the X25519 E2EE key-agreement key (separate key, separate
// SecureStore slot, separate identifier scheme).
//
// Platform-agnostic: `@noble/curves` (pure JS) runs identically on Node (identity
// service) and Hermes (mobile), and the RNG is injected so the SAME code is the single
// implementation on both sides. At-rest storage of the private key is platform-specific
// (mobile: expo-secure-store; the server NEVER holds a device private key) and lives in
// the platform apps, NOT here.
//
// The `cnf.jkt` is the RFC 7638 JWK thumbprint of the canonical OKP JWK:
// base64url(SHA-256(canonical-JWK)). It is DISTINCT from the E2EE `deriveKid` (a
// truncated SHA-256 of the raw X25519 public key, not a JWK thumbprint).

import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToBase64 } from '../e2ee/base64.js';
import type { RandomBytes } from '../e2ee/envelope.js';

/** Raw Ed25519 private key (seed) length, in bytes. */
export const ED25519_PRIVATE_KEY_BYTES = 32;
/** Raw Ed25519 public key length, in bytes. */
export const ED25519_PUBLIC_KEY_BYTES = 32;
/** Raw Ed25519 signature length, in bytes. */
export const ED25519_SIGNATURE_BYTES = 64;

/** JWK `kty` (key type) for an Ed25519 key — RFC 7517/8037 "OKP" (Octet Key Pair). */
export const DEVICE_KEY_KTY = 'OKP';
/** JWK `crv` (curve) for Ed25519 — RFC 8037 "Ed25519". */
export const DEVICE_KEY_CRV = 'Ed25519';

export interface Ed25519KeyPair {
  /** 32-byte Ed25519 private key (seed). Secret — never logged, never transmitted. */
  privateKey: Uint8Array;
  /** 32-byte Ed25519 public key. Safe to share for binding + signature verification. */
  publicKey: Uint8Array;
}

/** Canonical RFC 7517/8037 OKP JWK for an Ed25519 PUBLIC key (the RFC 7638 input). */
export interface Ed25519PublicJwk {
  kty: typeof DEVICE_KEY_KTY;
  crv: typeof DEVICE_KEY_CRV;
  /** base64url of the raw 32-byte public key, no padding (RFC 7515 §2). */
  x: string;
}

/**
 * Reconstruct a keypair from a stored raw private key (the at-rest load path). The
 * public key is re-derived, so the stored record never needs to carry it and can never
 * drift from the private key. Throws on a wrong-length private key.
 */
export function fromEd25519PrivateKey(privateKey: Uint8Array): Ed25519KeyPair {
  if (privateKey.length !== ED25519_PRIVATE_KEY_BYTES) {
    throw new TypeError(
      `fromEd25519PrivateKey: privateKey must be ${ED25519_PRIVATE_KEY_BYTES} bytes, got ${privateKey.length}`,
    );
  }
  const publicKey = ed25519.getPublicKey(privateKey);
  return { privateKey, publicKey };
}

/**
 * Generate a fresh Ed25519 keypair. The private key is drawn from the injected
 * `randomBytes` (globalThis.crypto on mobile, node:webcrypto on the server). Any 32
 * random bytes are a valid Ed25519 private key seed.
 */
export function generateEd25519KeyPair(randomBytes: RandomBytes): Ed25519KeyPair {
  const privateKey = randomBytes(ED25519_PRIVATE_KEY_BYTES);
  if (privateKey.length !== ED25519_PRIVATE_KEY_BYTES) {
    throw new Error(
      `generateEd25519KeyPair: RNG returned ${privateKey.length} bytes, expected ${ED25519_PRIVATE_KEY_BYTES}`,
    );
  }
  return fromEd25519PrivateKey(privateKey);
}

/** Build the canonical OKP JWK for an Ed25519 public key. Throws on a wrong-length key. */
export function publicKeyToJwk(publicKey: Uint8Array): Ed25519PublicJwk {
  if (publicKey.length !== ED25519_PUBLIC_KEY_BYTES) {
    throw new TypeError(
      `publicKeyToJwk: publicKey must be ${ED25519_PUBLIC_KEY_BYTES} bytes, got ${publicKey.length}`,
    );
  }
  return { kty: DEVICE_KEY_KTY, crv: DEVICE_KEY_CRV, x: bytesToBase64Url(publicKey) };
}

/**
 * The RFC 7638 §3 canonical JSON serialization of the public JWK: members in
 * lexicographic order (`crv` < `kty` < `x`), no insignificant whitespace. Built as a
 * literal string (NOT `JSON.stringify`, whose member ordering / spacing is not
 * guaranteed to be canonical across runtimes) so the thumbprint is byte-stable.
 */
export function canonicalJwk(publicKey: Uint8Array): string {
  const jwk = publicKeyToJwk(publicKey);
  return `{"crv":"${jwk.crv}","kty":"${jwk.kty}","x":"${jwk.x}"}`;
}

/**
 * RFC 7638 JWK thumbprint — the `cnf.jkt` bound into a device-bound refresh token:
 * base64url(SHA-256(canonical-JWK)), unpadded. DISTINCT from the E2EE `deriveKid`.
 * Throws on a wrong-length public key (never silently weakens the binding id).
 */
export function computeJwkThumbprint(publicKey: Uint8Array): string {
  if (publicKey.length !== ED25519_PUBLIC_KEY_BYTES) {
    throw new TypeError(
      `computeJwkThumbprint: publicKey must be ${ED25519_PUBLIC_KEY_BYTES} bytes, got ${publicKey.length}`,
    );
  }
  const digest = sha256(new TextEncoder().encode(canonicalJwk(publicKey)));
  return bytesToBase64Url(digest);
}

/**
 * Sign a message with an Ed25519 private key (pure Ed25519; the message is hashed
 * internally by @noble). Returns the raw 64-byte signature. This is the device's
 * proof-of-possession primitive for /auth/refresh.
 */
export function signMessage(privateKey: Uint8Array, message: Uint8Array): Uint8Array {
  return ed25519.sign(message, privateKey);
}

/**
 * Verify an Ed25519 signature over a message against a public key. @noble performs the
 * comparison in constant time internally. Returns `false` (never throws) for a malformed
 * key/signature so callers can map the failure to a typed rejection. The identity
 * service's DevicePopService (Task:4) consumes this.
 */
export function verifySignature(
  publicKey: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array,
): boolean {
  try {
    return ed25519.verify(signature, message, publicKey);
  } catch {
    return false;
  }
}

// base64url WITHOUT padding (RFC 7515 §2) — the JWK + thumbprint encoding. Derived from
// the shared standard base64 encoder so the two encodings can never diverge.
function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
