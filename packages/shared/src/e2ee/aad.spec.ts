import { describe, it, expect } from 'vitest';
import { bytesToHex } from '@noble/hashes/utils';
import { buildAad } from './aad';
import { E2EE_ALG_XCHACHA20POLY1305, E2EE_ENVELOPE_VERSION, type E2eeContext } from './envelope';

const base: E2eeContext = {
  lane: 'rpc',
  direction: 'pc-to-mobile',
  instanceId: 'inst-1',
  routeKey: 'session.transcript',
};
const aad = (ctx: E2eeContext, kid = 'k1') =>
  bytesToHex(buildAad(ctx, kid, E2EE_ENVELOPE_VERSION, E2EE_ALG_XCHACHA20POLY1305));

describe('buildAad — canonical, deterministic, unambiguous', () => {
  it('is deterministic for identical inputs', () => {
    expect(aad(base)).toBe(aad(base));
  });

  it('changes when ANY bound field changes', () => {
    const ref = aad(base);
    expect(aad({ ...base, lane: 'push' })).not.toBe(ref);
    expect(aad({ ...base, direction: 'mobile-to-pc' })).not.toBe(ref);
    expect(aad({ ...base, instanceId: 'inst-2' })).not.toBe(ref);
    expect(aad({ ...base, routeKey: 'other' })).not.toBe(ref);
    expect(aad({ ...base, seq: 0 })).not.toBe(ref);
    expect(aad(base, 'k2')).not.toBe(ref);
    expect(bytesToHex(buildAad(base, 'k1', 2 as 1, E2EE_ALG_XCHACHA20POLY1305))).not.toBe(ref);
  });

  it('distinguishes seq absent from seq=0 and seq=1', () => {
    const none = aad(base);
    const zero = aad({ ...base, seq: 0 });
    const one = aad({ ...base, seq: 1 });
    expect(new Set([none, zero, one]).size).toBe(3);
  });

  it('is unambiguous across field boundaries (length-prefixed, no splice collision)', () => {
    // Moving a delimiter-looking substring between adjacent fields must NOT collide.
    const a = aad({ ...base, instanceId: 'inst-1', routeKey: 'a/b' });
    const b = aad({ ...base, instanceId: 'inst-1a', routeKey: '/b' });
    expect(a).not.toBe(b);
  });
});
