import { describe, expect, it } from 'vitest';
import { bufferText } from './terminal-access';

const lines = (...entries: Array<[string, boolean?]>) => ({
  length: entries.length,
  getLine: (index: number) => entries[index] ? { isWrapped: entries[index][1] === true, translateToString: (trim?: boolean) => trim ? entries[index][0].trimEnd() : entries[index][0] } : undefined,
});

describe('bufferText', () => {
  it('joins wrapped lines and drops trailing empty lines', () => {
    expect(bufferText(lines(['abc', false], ['def', true], ['ghi'], [''], ['  ']), 100)).toBe('abcdef\nghi');
  });
  it('keeps only the last maxLines lines', () => {
    expect(bufferText(lines(['1'], ['2'], ['3'], ['4']), 2)).toBe('3\n4');
  });
  it('does not trim a wrapped line that continues, only the last segment', () => {
    expect(bufferText(lines(['ab  ', false], ['cd', true]), 10)).toBe('ab  cd');
  });
  it('is empty for an empty buffer', () => { expect(bufferText(lines(), 10)).toBe(''); });
});
