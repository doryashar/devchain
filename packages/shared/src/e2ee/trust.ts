// Shared E2EE trust-state model (Phase-1 Task:4 + Task:8).
//
// One vocabulary for "do we trust this peer device's public key?", consumed by BOTH
// login paths so they converge on the same record shape:
//   - QR pairing (Task:4) verifies via the on-screen visual channel -> 'verified'/'qr'
//     with NO extra user step.
//   - Email/magic-link login (Task:8) adopts the relayed key on first use -> 'unverified'
//     ('email-tofu'), upgradeable to 'verified'/'safety-number' by an out-of-band compare.
//
// Verified vs. unverified is a TRUST LABEL on an otherwise-encrypted channel — it is
// never a plaintext downgrade (capability negotiation in Task:5 keeps that distinction).
// This module is pure types/constants/guards; persistence is platform-specific (PC: the
// SQLite device directory; mobile: the SecureStore peer record).

/** Whether a peer device's public key is trusted, and to what degree. */
export type E2eeTrustStatus = 'unverified' | 'verified' | 'revoked';

/** How a 'verified' status was established. */
export type E2eeVerificationMethod = 'qr' | 'email-tofu' | 'safety-number';

/** How a peer key first entered the store (its adoption origin). */
export type E2eeAdoptionMethod = 'qr' | 'email-tofu';

/**
 * A peer device's public X25519 key plus its trust state. The unit both login paths
 * read/write. Public material only — never carries a private key or a derived secret
 * (the shared key is re-derived on demand from the local private key + `publicKeyB64`).
 */
export interface E2eeTrustRecord {
  /** Key id — `deriveKid` of the peer public key; the lookup key. */
  kid: string;
  /** base64 of the raw 32-byte peer X25519 public key. */
  publicKeyB64: string;
  /** Trust level for this key. */
  trust: E2eeTrustStatus;
  /** How the key was adopted: 'qr' (auto-verified) or 'email-tofu' (trust-on-first-use). */
  adoptedVia?: E2eeAdoptionMethod;
  /** How the key was verified — present iff `trust === 'verified'`. */
  verifiedVia?: E2eeVerificationMethod;
  /** ISO timestamp the key first became known (pairing / first-use time). */
  addedAt: string;
  /** ISO timestamp the key reached `'verified'` — present iff `trust === 'verified'`. */
  verifiedAt?: string;
  /** Optional human label (device name); populated when known. */
  label?: string;
}

/** `true` iff the record is currently verified (the strongest, no-warning trust level). */
export function isE2eeVerified(record: Pick<E2eeTrustRecord, 'trust'>): boolean {
  return record.trust === 'verified';
}

/** A peer key as delivered by the relayed swap, before it's reconciled into the store. */
export interface IncomingPeerKey {
  kid: string;
  publicKeyB64: string;
  label?: string;
}

/**
 * Reconcile an incoming peer key against the currently-stored record — the shared
 * trust-on-first-use + key-change logic used by BOTH the PC device store and the mobile
 * peer-key store, and the seam Task:7 (`946cc703`) invokes on re-pair / key rotation.
 *
 * - No existing record → ADOPT (TOFU): `trust:'unverified'`, `adoptedVia:'email-tofu'`.
 * - Same public key as stored → UNCHANGED (preserves an existing 'verified' state).
 * - Different public key than stored → ROTATED: re-adopt as `'unverified'` and DROP any
 *   prior verification (silent revert — never auto-trust a changed key). The caller
 *   surfaces the calmer status; there is no alarming banner.
 *
 * Pure: callers persist the returned record. `now` is injected (ISO string).
 */
export function reconcilePeerKey(
  existing: E2eeTrustRecord | null,
  incoming: IncomingPeerKey,
  now: string,
): E2eeTrustRecord {
  if (existing && existing.publicKeyB64 === incoming.publicKeyB64) {
    // Same key — keep trust/verification; refresh an optional label if newly provided.
    return incoming.label !== undefined ? { ...existing, label: incoming.label } : existing;
  }
  // New key (first contact) or a changed key (rotation/re-pair) → unverified TOFU adopt.
  return {
    kid: incoming.kid,
    publicKeyB64: incoming.publicKeyB64,
    trust: 'unverified',
    adoptedVia: 'email-tofu',
    addedAt: now,
    ...(incoming.label !== undefined ? { label: incoming.label } : {}),
  };
}

/**
 * Mark a TOFU-adopted record VERIFIED after a successful out-of-band safety-number
 * compare. No-op shape change if already verified for the same key. Pure.
 */
export function markVerifiedViaSafetyNumber(record: E2eeTrustRecord, now: string): E2eeTrustRecord {
  return {
    ...record,
    trust: 'verified',
    verifiedVia: 'safety-number',
    verifiedAt: now,
  };
}
