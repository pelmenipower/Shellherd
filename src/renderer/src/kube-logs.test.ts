import { describe, expect, it } from 'vitest';
import type { KubeLogLine, KubeLogSource } from '../../shared/kubernetes';
import { highlightParts, logTime, logsText, mergeLines, shownLines, toggleSource, type LogEntry } from './kube-logs';

const T = (second: number, fraction = 0) => `2026-10-25T08:10:${String(second).padStart(2, '0')}.${String(fraction).padStart(9, '0')}Z`;
const line = (source: number, time: string, text: string): KubeLogLine => ({ source, time, text });
const texts = (entries: LogEntry[]) => entries.map(entry => entry.text);
const sources: KubeLogSource[] = [{ pod: 'api-x7k2p', container: 'main', live: true }, { pod: 'worker-q9m4d', container: 'main', live: false }];

describe('mergeLines', () => {
  it('sorts interleaved sources by time and keeps arrival order for equal times', () => {
    const merged = mergeLines([], [line(0, T(1), 'a1'), line(0, T(3), 'a3'), line(1, T(2), 'b2'), line(1, T(3), 'b3'), line(1, T(1), 'b1')], 0, 100);
    expect(texts(merged)).toEqual(['a1', 'b1', 'b2', 'a3', 'b3']);
    expect(merged.map(entry => entry.seq)).toEqual([0, 4, 2, 1, 3]);
  });

  it('puts a late older line in its place, appends lines without time and keeps the newest max', () => {
    const first = mergeLines([], [line(0, T(1), 'one'), line(0, T(5), 'five')], 0, 3);
    const second = mergeLines(first, [line(1, T(3), 'three'), line(1, '', 'no time')], 2, 3);
    expect(texts(second)).toEqual(['three', 'five', 'no time']);
    expect(second.map(entry => entry.seq)).toEqual([2, 1, 3]);
    expect(first).toHaveLength(2);
  });

  it('compares nine fraction digits as strings', () => {
    expect(texts(mergeLines([], [line(0, T(1, 900000000), 'later'), line(1, T(1, 100000000), 'earlier')], 0, 10))).toEqual(['earlier', 'later']);
  });
});

describe('shownLines', () => {
  const entries = mergeLines([], [line(0, T(1), 'GET /health ok'), line(1, T(2), 'ERROR job failed'), line(0, T(3), 'error: timeout'), line(1, T(4), 'done')], 0, 100);

  it('filters by text and by the pod in the prefix, ignoring case, and leaves out hidden sources', () => {
    expect(texts(shownLines(entries, sources, new Set(), 'Error').lines)).toEqual(['ERROR job failed', 'error: timeout']);
    expect(texts(shownLines(entries, sources, new Set(), 'WORKER-q9').lines)).toEqual(['ERROR job failed', 'done']);
    expect(texts(shownLines(entries, sources, new Set([1]), '').lines)).toEqual(['GET /health ok', 'error: timeout']);
    expect(texts(shownLines(entries, sources, new Set(), '  ').lines)).toHaveLength(4);
  });

  it('gives the newest matches up to the limit and counts the older ones', () => {
    expect(shownLines(entries, sources, new Set(), '', 3)).toEqual({ lines: entries.slice(1), hiddenOlder: 1 });
    expect(shownLines(entries, sources, new Set(), '', Number.POSITIVE_INFINITY).hiddenOlder).toBe(0);
  });
});

describe('text helpers', () => {
  it('marks every match and returns one part without a filter', () => {
    expect(highlightParts('Error and error', 'ERROR')).toEqual([
      { text: 'Error', mark: true }, { text: ' and ', mark: false }, { text: 'error', mark: true },
    ]);
    expect(highlightParts('abc', '')).toEqual([{ text: 'abc', mark: false }]);
    expect(highlightParts('abc', 'x')).toEqual([{ text: 'abc', mark: false }]);
  });

  it('shows the UTC time with milliseconds and copies prefix, time and text', () => {
    expect(logTime(T(7, 123456789))).toBe('08:10:07.123');
    expect(logTime('')).toBe('');
    const entries = mergeLines([], [line(0, T(1), 'one'), line(1, '', 'two')], 0, 10);
    expect(logsText(entries, sources)).toBe('api-x7k2p/main 08:10:01.000 one\nworker-q9m4d/main  two');
  });

  it('toggles a source', () => {
    const hidden = toggleSource(new Set(), 1);
    expect([...hidden]).toEqual([1]);
    expect([...toggleSource(hidden, 1)]).toEqual([]);
  });
});
