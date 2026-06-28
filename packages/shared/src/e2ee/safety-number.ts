// Human-comparable safety number (Phase-1 Task:8).
//
// Derives a stable, order-independent fingerprint from BOTH peers' X25519 public keys
// so the phone and the PC render the IDENTICAL number for an out-of-band compare. When
// the two match, the user has confirmed there's no active MITM and the device upgrades
// to VERIFIED. Pure + platform-agnostic (`@noble/hashes`); the mobile side mirrors this
// and is kept byte-identical by a contract test.

import { sha256 } from '@noble/hashes/sha2';

const SAFETY_NUMBER_DOMAIN = 'devchain/e2ee/safety-number/v1';

/** Number of 5-digit groups in a rendered safety number (8 groups = 40 digits). */
export const E2EE_SAFETY_NUMBER_GROUPS = 8;

const utf8 = new TextEncoder();

/**
 * Derive the safety number for a pair of raw 32-byte X25519 public keys. The inputs are
 * sorted before hashing so BOTH sides compute the same value regardless of who is "a" or
 * "b". Returns {@link E2EE_SAFETY_NUMBER_GROUPS} space-separated 5-digit decimal groups
 * (e.g. `"01234 56789 ..."`). Throws on a wrong-length key.
 */
export function deriveSafetyNumber(pubA: Uint8Array, pubB: Uint8Array): string {
  if (pubA.length !== 32 || pubB.length !== 32) {
    throw new TypeError('deriveSafetyNumber: both public keys must be 32 bytes');
  }
  const [low, high] = compareBytes(pubA, pubB) <= 0 ? [pubA, pubB] : [pubB, pubA];
  const material = new Uint8Array(low.length + high.length + SAFETY_NUMBER_DOMAIN.length);
  const domain = utf8.encode(SAFETY_NUMBER_DOMAIN);
  material.set(domain, 0);
  material.set(low, domain.length);
  material.set(high, domain.length + low.length);
  const digest = sha256(material);

  const groups: string[] = [];
  for (let g = 0; g < E2EE_SAFETY_NUMBER_GROUPS; g++) {
    const off = g * 4;
    const n =
      ((digest[off] << 24) | (digest[off + 1] << 16) | (digest[off + 2] << 8) | digest[off + 3]) >>>
      0;
    groups.push((n % 100000).toString().padStart(5, '0'));
  }
  return groups.join(' ');
}

/** Lexicographic byte comparison: <0 if a<b, 0 if equal, >0 if a>b. */
function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}
