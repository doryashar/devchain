import { normalizeLineEndings, stripFinalLineEnding } from './normalize-line-endings';

describe('normalizeLineEndings', () => {
  it('normalizes bare LF while preserving existing CRLF', () => {
    expect(normalizeLineEndings('a\nb\r\nc')).toBe('a\r\nb\r\nc');
  });
});

describe('stripFinalLineEnding', () => {
  it('removes one final LF capture separator', () => {
    expect(stripFinalLineEnding('a\nb\n')).toBe('a\nb');
  });

  it('removes one final CRLF capture separator', () => {
    expect(stripFinalLineEnding('a\r\nb\r\n')).toBe('a\r\nb');
  });

  it('preserves real trailing blank rows before the final separator', () => {
    expect(stripFinalLineEnding('a\r\nb\r\n\r\n')).toBe('a\r\nb\r\n');
  });

  it('leaves content without a final line ending unchanged', () => {
    expect(stripFinalLineEnding('a\r\nb')).toBe('a\r\nb');
  });
});
