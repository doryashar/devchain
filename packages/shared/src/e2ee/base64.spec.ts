import { describe, it, expect } from 'vitest';
import { webcrypto } from 'node:crypto';
import { bytesToBase64, base64ToBytes, InvalidBase64Error } from './base64';

const rand = (n: number) => webcrypto.getRandomValues(new Uint8Array(n));

describe('base64 (platform-agnostic)', () => {
  it('matches Buffer base64 across all byte-length remainders', () => {
    for (let len = 0; len < 130; len++) {
      const bytes = rand(len);
      const ours = bytesToBase64(bytes);
      expect(ours).toBe(Buffer.from(bytes).toString('base64'));
      expect(base64ToBytes(ours)).toEqual(bytes);
    }
  });

  it('round-trips known vectors (RFC 4648)', () => {
    const enc = new TextEncoder();
    expect(bytesToBase64(enc.encode(''))).toBe('');
    expect(bytesToBase64(enc.encode('f'))).toBe('Zg==');
    expect(bytesToBase64(enc.encode('fo'))).toBe('Zm8=');
    expect(bytesToBase64(enc.encode('foo'))).toBe('Zm9v');
    expect(bytesToBase64(enc.encode('foob'))).toBe('Zm9vYg==');
    expect(bytesToBase64(enc.encode('fooba'))).toBe('Zm9vYmE=');
    expect(bytesToBase64(enc.encode('foobar'))).toBe('Zm9vYmFy');
  });

  it('throws InvalidBase64Error on bad length, illegal chars, and decodes back', () => {
    expect(() => base64ToBytes('abc')).toThrow(InvalidBase64Error); // not multiple of 4
    expect(() => base64ToBytes('!!!!')).toThrow(InvalidBase64Error); // illegal chars
    expect(() => base64ToBytes('Zg=!')).toThrow(InvalidBase64Error);
  });
});
