// Bridge-relayed key exchange primitives (Phase-1 Task:4).
//
// The asymmetric leg of the ADR-locked chain (X25519 ECDH -> HKDF-SHA256 ->
// XChaCha20-Poly1305): given this side's private key and the peer's public key, both
// ends derive the SAME 32-byte symmetric key without the bridge/relay ever learning
// it. Login-method-agnostic — the QR path (Task:4) and the email-TOFU path (Task:8)
// both call `deriveSharedKey`; they differ only in how the peer key is VERIFIED.
//
// QR auto-verification rides a second, out-of-band primitive: the PC mints a random
// `pairingSecret`, ships it (+ its public key) ONLY through the on-screen QR (the
// visual channel the cloud can't see), and the phone returns its key plus
// `mac = HMAC(pairingSecret, transcript)`. A key-substituting relay never learns
// `pairingSecret`, so it cannot forge a MAC over a swapped key — the PC's
// `verifyPairingMac` fails closed. transcript binds BOTH public keys + the pairing id
// so a MAC cannot be replayed onto a different key or channel.
//
// Platform-agnostic: pure-JS `@noble/curves` + `@noble/hashes` run byte-identically on
// Node (PC) and Hermes (mobile). All secret material is Uint8Array; base64/hex framing
// for the wire/QR lives in the platform apps, not here.

import { x25519 } from '@noble/curves/ed25519';
import { hkdf } from '@noble/hashes/hkdf';
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha2';

// Raw X25519 key lengths. Kept as local literals (not imported from ./keypair) so this
// module has no runtime cross-file dependency; the canonical exports remain
// `X25519_PRIVATE_KEY_BYTES` / `X25519_PUBLIC_KEY_BYTES` in ./keypair and are byte-equal.
const X25519_PRIVATE_KEY_BYTES = 32;
const X25519_PUBLIC_KEY_BYTES = 32;

/** Derived shared-key length, in bytes (matches the XChaCha20-Poly1305 key size). */
export const E2EE_SHARED_KEY_BYTES = 32;

/**
 * HKDF `info` for the E2EE shared-key derivation. Domain-separates this key from any
 * other use of the same ECDH secret. Fixed and identical on both sides.
 */
export const E2EE_HKDF_INFO = 'devchain-e2ee-v1';

/**
 * HKDF `salt` for the shared-key derivation. A non-secret, fixed domain constant — the
 * ECDH secret already binds both keypairs; the salt only adds domain separation. Both
 * sides MUST use the identical value or they derive different keys.
 */
export const E2EE_HKDF_SALT = 'devchain/e2ee/hkdf/salt/v1';

/** Length of the QR `pairingSecret` (the HMAC key for QR auto-verification), in bytes. */
export const PAIRING_SECRET_BYTES = 32;

/** HMAC-SHA256 tag length, in bytes. */
export const PAIRING_MAC_BYTES = 32;

const TRANSCRIPT_DOMAIN = 'devchain/e2ee/pairing/transcript/v1';

const utf8 = new TextEncoder();

/**
 * Derive the shared symmetric key from this side's X25519 private key and the peer's
 * X25519 public key: `HKDF-SHA256(X25519(priv, peerPub), salt, info)`. Deterministic
 * and symmetric — PC and mobile compute the identical key. Throws on wrong-length keys.
 * The raw ECDH secret is never returned (only its HKDF expansion).
 */
export function deriveSharedKey(privateKey: Uint8Array, peerPublicKey: Uint8Array): Uint8Array {
  if (privateKey.length !== X25519_PRIVATE_KEY_BYTES) {
    throw new TypeError(
      `deriveSharedKey: privateKey must be ${X25519_PRIVATE_KEY_BYTES} bytes, got ${privateKey.length}`,
    );
  }
  if (peerPublicKey.length !== X25519_PUBLIC_KEY_BYTES) {
    throw new TypeError(
      `deriveSharedKey: peerPublicKey must be ${X25519_PUBLIC_KEY_BYTES} bytes, got ${peerPublicKey.length}`,
    );
  }
  const ecdh = x25519.getSharedSecret(privateKey, peerPublicKey);
  return hkdf(
    sha256,
    ecdh,
    utf8.encode(E2EE_HKDF_SALT),
    utf8.encode(E2EE_HKDF_INFO),
    E2EE_SHARED_KEY_BYTES,
  );
}

/** Inputs that uniquely pin a pairing handshake — both ends must agree byte-for-byte. */
export interface PairingTranscriptInput {
  /** PC (QR-displaying side) raw 32-byte X25519 public key. */
  pcPublicKey: Uint8Array;
  /** PC key id (`deriveKid` of `pcPublicKey`). */
  pcKid: string;
  /** Mobile (scanning side) raw 32-byte X25519 public key. */
  mobilePublicKey: Uint8Array;
  /** Mobile key id (`deriveKid` of `mobilePublicKey`). */
  mobileKid: string;
  /** The pairing channel id — a non-secret UUID identifying this handshake. */
  channelId: string;
}

/**
 * Build the canonical pairing transcript bytes that the MAC authenticates. Fixed field
 * order, each field length-prefixed (u32be) so no two distinct inputs can produce the
 * same byte string (an adjacent-field splice can't collide). Binding BOTH public keys
 * means the MAC cannot be lifted onto a substituted key; binding `channelId` means it
 * cannot be replayed onto another pairing.
 */
export function buildPairingTranscript(input: PairingTranscriptInput): Uint8Array {
  return concat(
    field(utf8.encode(TRANSCRIPT_DOMAIN)),
    field(utf8.encode(input.channelId)),
    field(utf8.encode(input.pcKid)),
    field(input.pcPublicKey),
    field(utf8.encode(input.mobileKid)),
    field(input.mobilePublicKey),
  );
}

/**
 * Compute `HMAC-SHA256(pairingSecret, transcript)` — the QR auto-verification tag the
 * phone returns. The `pairingSecret` is the on-screen secret, known only to the PC and
 * (via the camera) the phone.
 */
export function computePairingMac(pairingSecret: Uint8Array, transcript: Uint8Array): Uint8Array {
  if (pairingSecret.length === 0) {
    throw new TypeError('computePairingMac: pairingSecret must be non-empty');
  }
  return hmac(sha256, pairingSecret, transcript);
}

/**
 * Constant-time verification of a pairing MAC. Returns `false` (never throws) on any
 * mismatch — wrong length, tampered transcript, or a relay-substituted key — so callers
 * fail closed. The comparison time depends only on the MAC length (public), never on
 * where the bytes first differ.
 */
export function verifyPairingMac(
  pairingSecret: Uint8Array,
  transcript: Uint8Array,
  mac: Uint8Array,
): boolean {
  let expected: Uint8Array;
  try {
    expected = computePairingMac(pairingSecret, transcript);
  } catch {
    return false;
  }
  return constantTimeEqual(expected, mac);
}

/** Length-mismatch-safe constant-time byte comparison. */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Prefix a field with its big-endian u32 length, so concatenation is unambiguous. */
function field(value: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + value.length);
  out[0] = (value.length >>> 24) & 0xff;
  out[1] = (value.length >>> 16) & 0xff;
  out[2] = (value.length >>> 8) & 0xff;
  out[3] = value.length & 0xff;
  out.set(value, 4);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
