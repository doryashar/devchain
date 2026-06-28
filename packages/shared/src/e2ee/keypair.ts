// X25519 keypair generation + deterministic key id (`kid`) derivation.
//
// This is the asymmetric leg of the ADR-locked chain (X25519 ECDH -> HKDF-SHA256 ->
// XChaCha20-Poly1305). Task:3 owns keygen + kid + at-rest storage on each side; the
// ECDH/HKDF exchange itself (Task:4) consumes the public key + kid produced here.
//
// As with the rest of the e2ee module, crypto is platform-agnostic: `@noble/curves`
// (pure JS) runs identically on Node (PC) and Hermes (mobile), and the RNG is injected
// so the SAME code is the one shared impl on both sides. At-rest storage of the
// returned private key is platform-specific (PC: scrypt-bound SQLite blob; mobile:
// SecureStore) and lives in the platform apps, NOT here.

import { x25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha2';
import type { RandomBytes } from './envelope.js';

/** Raw X25519 private key length, in bytes. */
export const X25519_PRIVATE_KEY_BYTES = 32;
/** Raw X25519 public key length, in bytes. */
export const X25519_PUBLIC_KEY_BYTES = 32;

/**
 * Number of bytes of SHA-256(publicKey) retained as the `kid`. 16 bytes (128 bits)
 * is far above any accidental-collision threshold while keeping the id short. The kid
 * is PUBLIC (it identifies a key, never the secret) and is bound into the envelope.
 */
export const E2EE_KID_BYTES = 16;

export interface E2eeKeyPair {
  /** 32-byte X25519 private key (raw; @noble clamps on use). Secret — never logged. */
  privateKey: Uint8Array;
  /** 32-byte X25519 public key. Safe to share for pairing. */
  publicKey: Uint8Array;
  /** Deterministic key id — {@link deriveKid} of {@link publicKey}. */
  kid: string;
}

/**
 * Derive the deterministic key id for an X25519 public key: the first
 * {@link E2EE_KID_BYTES} bytes of SHA-256(publicKey), lower-case hex encoded.
 * Stable across platforms (the input is the raw 32-byte public key, NOT a
 * SPKI/PEM wrapping). Throws if the input is not a 32-byte X25519 public key.
 */
export function deriveKid(publicKey: Uint8Array): string {
  if (publicKey.length !== X25519_PUBLIC_KEY_BYTES) {
    throw new TypeError(
      `deriveKid: publicKey must be ${X25519_PUBLIC_KEY_BYTES} bytes, got ${publicKey.length}`,
    );
  }
  const hash = sha256(publicKey);
  return bytesToHex(hash.subarray(0, E2EE_KID_BYTES));
}

/**
 * Generate a fresh X25519 keypair with a deterministic `kid`. The private key is drawn
 * from the injected `randomBytes` (expo-crypto on mobile, node:webcrypto on PC) and the
 * public key + kid are derived deterministically. Any 32 random bytes are a valid
 * X25519 private key; @noble clamps during scalar-mult, so no pre-clamping is needed.
 */
export function generateX25519KeyPair(randomBytes: RandomBytes): E2eeKeyPair {
  const privateKey = randomBytes(X25519_PRIVATE_KEY_BYTES);
  if (privateKey.length !== X25519_PRIVATE_KEY_BYTES) {
    throw new Error(
      `generateX25519KeyPair: RNG returned ${privateKey.length} bytes, expected ${X25519_PRIVATE_KEY_BYTES}`,
    );
  }
  return fromX25519PrivateKey(privateKey);
}

/**
 * Reconstruct a keypair from a stored raw private key (the at-rest load path). The
 * public key + kid are re-derived, so the stored record never needs to carry them and
 * can never drift from the private key. Throws on a wrong-length private key.
 */
export function fromX25519PrivateKey(privateKey: Uint8Array): E2eeKeyPair {
  if (privateKey.length !== X25519_PRIVATE_KEY_BYTES) {
    throw new TypeError(
      `fromX25519PrivateKey: privateKey must be ${X25519_PRIVATE_KEY_BYTES} bytes, got ${privateKey.length}`,
    );
  }
  const publicKey = x25519.getPublicKey(privateKey);
  return { privateKey, publicKey, kid: deriveKid(publicKey) };
}

// Minimal hex encoder (no Node `Buffer` / dependency) — matches the platform-agnostic
// constraint of the e2ee module.
function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}
