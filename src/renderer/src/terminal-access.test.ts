import { describe, expect, it, vi } from 'vitest';
import type { Terminal } from '@xterm/xterm';
import { bufferText, rangeText, terminalAccess } from './terminal-access';

describe('mark', () => {
  it('follows the marker, clamps trimmed lines to 0 and disposes it', () => {
    const marker = { line: 5, dispose: vi.fn() };
    const term = { onWriteParsed: () => ({ dispose() {} }), buffer: { active: {} }, registerMarker: vi.fn(() => marker) } as unknown as Terminal;
    const mark = terminalAccess(term).mark();
    expect(mark.line()).toBe(5);
    marker.line = 2;
    expect(mark.line()).toBe(2);
    marker.line = -1;
    expect(mark.line()).toBe(0);
    mark.dispose();
    expect(marker.dispose).toHaveBeenCalled();
  });
});

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

describe('rangeText', () => {
  it('joins wrapped rows and starts a range inside a wrapped line at its first row', () => {
    expect(rangeText(lines(['abc', false], ['def', true]), 0, 1)).toBe('abcdef');
    expect(rangeText(lines(['abc', false], ['def', true]), 1, 1)).toBe('abcdef');
  });
  it('reads the wrapped rows that continue the end of the range', () => {
    expect(rangeText(lines(['abc', false], ['def', true]), 0, 0)).toBe('abcdef');
    expect(rangeText(lines(['abc', false], ['def', true], ['ghi']), 0, 0)).toBe('abcdef');
  });
  it('trims only the last row of a line and drops trailing empty lines', () => {
    expect(rangeText(lines(['ab  ', false], ['cd  ', true], ['x  '], [''], ['  ']), 0, 4)).toBe('ab  cd\nx');
  });
});
