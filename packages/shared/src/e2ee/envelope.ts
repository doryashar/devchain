// E2EE envelope — the single versioned shape sealed/opened at the transport seams.
//
// ADR chain: X25519 ECDH -> HKDF-SHA256 -> XChaCha20-Poly1305. THIS module owns the
// symmetric AEAD leg only (a pre-derived 32-byte shared key is injected); ECDH/HKDF
// (key exchange + derivation) live in later Phase-1 tasks. No platform-specific
// imports here — key material and RNG are injected so the same code runs on Node
// (PC) and Hermes (mobile).

/** Symmetric key length for XChaCha20-Poly1305, in bytes. */
export const E2EE_KEY_BYTES = 32;
/** XChaCha20 nonce length, in bytes. The 24-byte nonce is why XChaCha was chosen:
 *  random nonces are safe without cross-lane/device counter coordination. */
export const E2EE_NONCE_BYTES = 24;

/** Current envelope schema version. An unknown `v` is rejected, never crashed on. */
export const E2EE_ENVELOPE_VERSION = 1;
export type E2eeEnvelopeVersion = typeof E2EE_ENVELOPE_VERSION;

/** AEAD algorithm tag. Only XChaCha20-Poly1305 in v1; an unknown `alg` is rejected. */
export const E2EE_ALG_XCHACHA20POLY1305 = 'XC20P';
export type E2eeAlg = typeof E2EE_ALG_XCHACHA20POLY1305;

/**
 * Reserved multi-device fan-out slot. Single-recipient in v1 (this field is left
 * unset); declared NOW so adding per-recipient wrapped keys later is not a schema
 * break. Each entry wraps the message key to one recipient device's key id.
 */
export interface E2eeRecipient {
  kid: string;
  /** base64 of the wrapped message key for this recipient. */
  wrappedKey: string;
}

/**
 * The on-the-wire envelope. All binary fields are base64. `kid` identifies the
 * shared key used (NOT secret). The bridge-assigned push `eventId` is deliberately
 * NOT part of this shape — encryption precedes stamping (see {@link E2eeContext}).
 */
export interface E2eeEnvelope {
  /** Schema version. */
  v: E2eeEnvelopeVersion;
  /** Id of the shared key the ciphertext was sealed under. */
  kid: string;
  /** AEAD algorithm tag. */
  alg: E2eeAlg;
  /** base64 nonce (24 bytes). */
  nonce: string;
  /** base64 ciphertext with the appended Poly1305 tag. */
  ct: string;
  /** Reserved for multi-device fan-out; unset in v1. */
  recipients?: E2eeRecipient[];
}

/** Transport lane a message rides — part of the AAD so a ciphertext can't be replayed across lanes. */
export type E2eeLane = 'rpc' | 'push' | 'viewport';

/** Travel direction — part of the AAD so a message can't be reflected back the other way. */
export type E2eeDirection = 'pc-to-mobile' | 'mobile-to-pc';

/**
 * Cleartext routing context bound into the AEAD's AAD. The SAME context must be
 * supplied to `open` as was used by `seal`, or authentication fails closed.
 *
 * `routeKey` is the lane's natural routing key: the push topic, the RPC method, or
 * the viewport sessionId. `seq` is an optional per-stream monotonic counter. We bind
 * `kid`/`v`/`alg` too (taken from the envelope), but those are added internally — the
 * caller supplies only the routing fields below.
 *
 * NOT bound: the bridge-assigned `eventId` (it does not exist yet at seal time).
 */
export interface E2eeContext {
  lane: E2eeLane;
  direction: E2eeDirection;
  /** The PC instance the tunnel belongs to. */
  instanceId: string;
  /** topic (push) | method (rpc) | sessionId (viewport). */
  routeKey: string;
  /** Optional per-stream monotonic sequence; bound when present. */
  seq?: number;
}

/**
 * Key material lookup, injected so at-rest storage stays platform-specific
 * (Node secret file on PC, Keychain/Keystore on mobile — Phase-1 Task:3).
 * Methods may be sync or async; the service awaits either.
 */
export interface E2eeKeyProvider {
  /** The key id + 32-byte key to seal NEW envelopes under (the current shared key). */
  resolveSealKey(): SealKey | Promise<SealKey>;
  /** Look up the 32-byte key for an envelope's `kid`; `undefined`/`null` if unknown. */
  getKeyById(kid: string): KeyLookup | Promise<KeyLookup>;
}

export interface SealKey {
  kid: string;
  key: Uint8Array;
}
export type KeyLookup = Uint8Array | undefined | null;

/** Random-bytes source, injected (expo-crypto on mobile, webcrypto/node on PC). */
export type RandomBytes = (n: number) => Uint8Array;

// ── Typed errors — open() rejects with these instead of crashing ────────────────

export class E2eeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'E2eeError';
  }
}
/** Envelope shape/encoding is malformed (bad base64, wrong nonce length, missing field). */
export class E2eeMalformedEnvelopeError extends E2eeError {
  constructor(reason: string) {
    super(`malformed e2ee envelope: ${reason}`);
    this.name = 'E2eeMalformedEnvelopeError';
  }
}
/** Envelope `v` is not a version this build understands. */
export class E2eeUnsupportedVersionError extends E2eeError {
  constructor(public readonly version: unknown) {
    super(`unsupported e2ee envelope version: ${String(version)}`);
    this.name = 'E2eeUnsupportedVersionError';
  }
}
/** Envelope `alg` is not an AEAD this build understands. */
export class E2eeUnsupportedAlgError extends E2eeError {
  constructor(public readonly alg: unknown) {
    super(`unsupported e2ee alg: ${String(alg)}`);
    this.name = 'E2eeUnsupportedAlgError';
  }
}
/** No key is known for the envelope's `kid` (e.g. wiped on logout, or never paired). */
export class E2eeUnknownKeyError extends E2eeError {
  constructor(public readonly kid: string) {
    super(`no e2ee key for kid: ${kid}`);
    this.name = 'E2eeUnknownKeyError';
  }
}
/** AEAD authentication failed: ciphertext/nonce tampered, or AAD/context mismatch (e.g. replay). */
export class E2eeAuthenticationError extends E2eeError {
  constructor() {
    super('e2ee authentication failed');
    this.name = 'E2eeAuthenticationError';
  }
}
/** An injected key is the wrong length for the AEAD. */
export class E2eeInvalidKeyError extends E2eeError {
  constructor(actual: number) {
    super(`e2ee key must be ${E2EE_KEY_BYTES} bytes, got ${actual}`);
    this.name = 'E2eeInvalidKeyError';
  }
}

/**
 * Structural guard over untrusted, already-parsed JSON. Validates only the SHAPE
 * (presence + primitive types of `v`/`kid`/`alg`/`nonce`/`ct`), never decoding or
 * authenticating. Returns `false` — never throws. `recipients`, when present, must
 * be an array; its contents are not validated here (reserved for v>1).
 */
export function isE2eeEnvelope(value: unknown): value is E2eeEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.v === 'number' &&
    typeof e.kid === 'string' &&
    e.kid.length > 0 &&
    typeof e.alg === 'string' &&
    typeof e.nonce === 'string' &&
    e.nonce.length > 0 &&
    typeof e.ct === 'string' &&
    e.ct.length > 0 &&
    (e.recipients === undefined || Array.isArray(e.recipients))
  );
}
