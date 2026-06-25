import { describe, it, expect } from 'vitest';
import { deriveSafetyNumber, E2EE_SAFETY_NUMBER_GROUPS } from './safety-number';
import { fromX25519PrivateKey } from './keypair';

function seeded(seed: number): Uint8Array {
  let s = seed >>> 0;
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    out[i] = s & 0xff;
  }
  return out;
}

const a = fromX25519PrivateKey(seeded(0x1111)).publicKey;
const b = fromX25519PrivateKey(seeded(0x2222)).publicKey;
const c = fromX25519PrivateKey(seeded(0x3333)).publicKey;

describe('deriveSafetyNumber', () => {
  it('is order-independent (both sides compute the same number)', () => {
    expect(deriveSafetyNumber(a, b)).toBe(deriveSafetyNumber(b, a));
  });

  it('renders the expected number of 5-digit groups', () => {
    const sn = deriveSafetyNumber(a, b);
    const groups = sn.split(' ');
    expect(groups).toHaveLength(E2EE_SAFETY_NUMBER_GROUPS);
    for (const g of groups) expect(g).toMatch(/^\d{5}$/);
  });

  it('differs for a different peer pair', () => {
    expect(deriveSafetyNumber(a, b)).not.toBe(deriveSafetyNumber(a, c));
  });

  it('is deterministic across calls', () => {
    expect(deriveSafetyNumber(a, b)).toBe(deriveSafetyNumber(a, b));
  });

  it('throws on a wrong-length key', () => {
    expect(() => deriveSafetyNumber(new Uint8Array(16), b)).toThrow(/32 bytes/);
  });
});
