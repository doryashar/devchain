import { describe, it, expect } from 'vitest';
import {
  isE2eeVerified,
  reconcilePeerKey,
  markVerifiedViaSafetyNumber,
  type E2eeTrustRecord,
} from './trust';

const base: E2eeTrustRecord = {
  kid: 'k1',
  publicKeyB64: 'AAAA',
  trust: 'unverified',
  addedAt: '2026-01-01T00:00:00.000Z',
};

const NOW = '2026-06-22T00:00:00.000Z';

describe('E2EE trust model', () => {
  it('isE2eeVerified is true only for verified records', () => {
    expect(isE2eeVerified({ trust: 'verified' })).toBe(true);
    expect(isE2eeVerified({ trust: 'unverified' })).toBe(false);
    expect(isE2eeVerified({ trust: 'revoked' })).toBe(false);
  });

  it('a QR-verified record carries method + verifiedAt', () => {
    const rec: E2eeTrustRecord = {
      ...base,
      trust: 'verified',
      verifiedVia: 'qr',
      verifiedAt: '2026-01-02T00:00:00.000Z',
    };
    expect(isE2eeVerified(rec)).toBe(true);
    expect(rec.verifiedVia).toBe('qr');
    expect(rec.verifiedAt).toBeTruthy();
  });
});

describe('reconcilePeerKey — TOFU adopt + key-change revert', () => {
  it('adopts a brand-new key as unverified (email-tofu)', () => {
    const rec = reconcilePeerKey(null, { kid: 'k1', publicKeyB64: 'AAAA' }, NOW);
    expect(rec).toEqual({
      kid: 'k1',
      publicKeyB64: 'AAAA',
      trust: 'unverified',
      adoptedVia: 'email-tofu',
      addedAt: NOW,
    });
  });

  it('leaves an unchanged key untouched (preserves a verified state)', () => {
    const existing: E2eeTrustRecord = {
      kid: 'k1',
      publicKeyB64: 'AAAA',
      trust: 'verified',
      verifiedVia: 'safety-number',
      adoptedVia: 'email-tofu',
      addedAt: '2026-01-01T00:00:00.000Z',
      verifiedAt: '2026-02-01T00:00:00.000Z',
    };
    const rec = reconcilePeerKey(existing, { kid: 'k1', publicKeyB64: 'AAAA' }, NOW);
    expect(rec).toBe(existing); // same reference — no change
    expect(rec.trust).toBe('verified');
  });

  it('reverts to unverified when the key changes (rotation / re-pair)', () => {
    const existing: E2eeTrustRecord = {
      kid: 'k1',
      publicKeyB64: 'AAAA',
      trust: 'verified',
      verifiedVia: 'safety-number',
      adoptedVia: 'email-tofu',
      addedAt: '2026-01-01T00:00:00.000Z',
      verifiedAt: '2026-02-01T00:00:00.000Z',
    };
    const rec = reconcilePeerKey(existing, { kid: 'k2', publicKeyB64: 'BBBB' }, NOW);
    expect(rec.trust).toBe('unverified');
    expect(rec.publicKeyB64).toBe('BBBB');
    expect(rec.kid).toBe('k2');
    expect(rec.verifiedVia).toBeUndefined();
    expect(rec.verifiedAt).toBeUndefined();
    expect(rec.adoptedVia).toBe('email-tofu');
  });

  it('refreshes a label on an unchanged key', () => {
    const existing: E2eeTrustRecord = { ...base, label: 'old' };
    const rec = reconcilePeerKey(existing, { kid: 'k1', publicKeyB64: 'AAAA', label: 'new' }, NOW);
    expect(rec.label).toBe('new');
    expect(rec.trust).toBe('unverified');
  });
});

describe('markVerifiedViaSafetyNumber', () => {
  it('upgrades a TOFU record to verified via safety-number', () => {
    const adopted = reconcilePeerKey(null, { kid: 'k1', publicKeyB64: 'AAAA' }, NOW);
    const verified = markVerifiedViaSafetyNumber(adopted, '2026-06-23T00:00:00.000Z');
    expect(isE2eeVerified(verified)).toBe(true);
    expect(verified.verifiedVia).toBe('safety-number');
    expect(verified.verifiedAt).toBe('2026-06-23T00:00:00.000Z');
    expect(verified.adoptedVia).toBe('email-tofu'); // origin preserved
  });
});
