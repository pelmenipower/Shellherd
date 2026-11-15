import { describe, it, expect } from 'vitest';
import type { LogEntry } from './kube-logs';
import {
  compileSearch, findMatches, matchesBySeq, markParts, stepMatch, refindMatch, searchStatusOf, listSearchStatus,
  DEFAULT_SEARCH_OPTIONS, SEARCH_LIMIT, type SearchOptions
} from './log-search';

const opts = (o: Partial<SearchOptions> = {}): SearchOptions => ({ ...DEFAULT_SEARCH_OPTIONS, ...o });
const entry = (seq: number, text: string): LogEntry => ({ seq, text } as unknown as LogEntry);

describe('compileSearch', () => {
  it('returns null for an empty query', () => {
    expect(compileSearch('', opts())).toBeNull();
    expect(compileSearch('', opts({ regex: true }))).toBeNull();
  });
  it('escapes plain text', () => {
    expect('a.b axb'.match(compileSearch('a.b', opts())!)).toEqual(['a.b']);
    expect('f(x) fx'.match(compileSearch('(x)', opts())!)).toEqual(['(x)']);
    expect('a[b'.match(compileSearch('[', opts())!)).toEqual(['[']);
  });
  it('uses g or gi and never u', () => {
    expect(compileSearch('a', opts())!.flags).toBe('gi');
    expect(compileSearch('a', opts({ caseSensitive: true }))!.flags).toBe('g');
    expect(compileSearch('a', opts({ regex: true, wholeWord: true }))!.flags).toBe('gi');
  });
  it('is case-insensitive by default', () => {
    expect('ERROR'.match(compileSearch('error', opts())!)).toEqual(['ERROR']);
    expect('ERROR'.match(compileSearch('error', opts({ caseSensitive: true }))!)).toBeNull();
  });
  it('compiles regex and returns null when invalid', () => {
    expect('ab12'.match(compileSearch('\\d+', opts({ regex: true }))!)).toEqual(['12']);
    expect(compileSearch('(', opts({ regex: true }))).toBeNull();
    expect(compileSearch('[a', opts({ regex: true }))).toBeNull();
  });
  it('checks the raw input before wrapping (K6)', () => {
    expect(compileSearch('a)(?:b', opts({ regex: true }))).toBeNull();
    expect(compileSearch('a)(?:b', opts({ regex: true, wholeWord: true }))).toBeNull();
  });
  it('whole word follows the addon separator set', () => {
    const p = () => compileSearch('foo', opts({ wholeWord: true }))!;
    expect('foo bar'.match(p())).toEqual(['foo']);
    expect('x.foo'.match(p())).toEqual(['foo']);
    expect('a\tfoo'.match(p())).toEqual(['foo']);
    expect('foobar'.match(p())).toBeNull();
    expect('foo_bar'.match(p())).toBeNull();
    expect('über'.match(compileSearch('ber', opts({ wholeWord: true }))!)).toBeNull();
  });
  it('whole word keeps regex alternation grouped', () => {
    const p = compileSearch('foo|bar', opts({ regex: true, wholeWord: true }))!;
    expect('foo xbar bar'.match(p)).toEqual(['foo', 'bar']);
  });
});

describe('findMatches', () => {
  const p = compileSearch('err', opts())!;
  it('returns matches in line order', () => {
    const r = findMatches([entry(1, 'err a'), entry(2, 'none'), entry(3, 'x ERR')], p);
    expect(r.matches).toEqual([{ seq: 1, start: 0, end: 3 }, { seq: 3, start: 2, end: 5 }]);
    expect(r.truncated).toBe(false);
  });
  it('finds two matches in one line', () => {
    expect(findMatches([entry(7, 'err err')], p).matches).toEqual([
      { seq: 7, start: 0, end: 3 }, { seq: 7, start: 4, end: 7 }
    ]);
  });
  it('is not confused by a pattern lastIndex left over', () => {
    p.lastIndex = 5;
    expect(findMatches([entry(1, 'err')], p).matches).toHaveLength(1);
  });
  it('skips empty matches', () => {
    const a = compileSearch('a*', opts({ regex: true }))!;
    expect(findMatches([entry(1, 'baaa')], a).matches).toEqual([{ seq: 1, start: 1, end: 4 }]);
    expect(findMatches([entry(1, 'xyz')], a).matches).toEqual([]);
  });
  it('limits and flags truncation exactly', () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => entry(i, 'err'));
    const exact = findMatches(mk(SEARCH_LIMIT), p);
    expect(exact.matches).toHaveLength(SEARCH_LIMIT);
    expect(exact.truncated).toBe(false);
    const over = findMatches(mk(SEARCH_LIMIT + 1), p);
    expect(over.matches).toHaveLength(SEARCH_LIMIT);
    expect(over.truncated).toBe(true);
  });
  it('honours a custom limit within one line', () => {
    const r = findMatches([entry(1, 'err err err')], p, 2);
    expect(r.matches).toHaveLength(2);
    expect(r.truncated).toBe(true);
  });
});

describe('matchesBySeq', () => {
  it('groups by line', () => {
    const m = [{ seq: 1, start: 0, end: 1 }, { seq: 1, start: 2, end: 3 }, { seq: 4, start: 0, end: 1 }];
    const g = matchesBySeq(m);
    expect(g.get(1)).toEqual([m[0], m[1]]);
    expect(g.get(4)).toEqual([m[2]]);
    expect(g.get(2)).toBeUndefined();
  });
});

describe('markParts', () => {
  it('returns the whole text without matches', () => {
    expect(markParts('abc', [], null)).toEqual([{ text: 'abc', mark: null }]);
  });
  it('splits around matches and marks the current one', () => {
    const m = [{ seq: 1, start: 0, end: 2 }, { seq: 1, start: 5, end: 7 }];
    expect(markParts('ab-- cd', m, m[1])).toEqual([
      { text: 'ab', mark: 'match' }, { text: '-- ', mark: null }, { text: 'cd', mark: 'current' }
    ]);
  });
  it('marks only the equal match as current', () => {
    const m = [{ seq: 1, start: 0, end: 1 }, { seq: 1, start: 1, end: 2 }];
    expect(markParts('ab', m, { seq: 1, start: 0, end: 1 })).toEqual([
      { text: 'a', mark: 'current' }, { text: 'b', mark: 'match' }
    ]);
  });
  it('handles a trailing match and no current', () => {
    expect(markParts('xab', [{ seq: 1, start: 1, end: 3 }], null)).toEqual([
      { text: 'x', mark: null }, { text: 'ab', mark: 'match' }
    ]);
  });
});

describe('stepMatch', () => {
  it('cycles', () => {
    expect(stepMatch(0, 3, 'next')).toBe(1);
    expect(stepMatch(2, 3, 'next')).toBe(0);
    expect(stepMatch(0, 3, 'previous')).toBe(2);
    expect(stepMatch(2, 3, 'previous')).toBe(1);
  });
  it('starts from -1', () => {
    expect(stepMatch(-1, 3, 'next')).toBe(0);
    expect(stepMatch(-1, 3, 'previous')).toBe(2);
  });
  it('returns -1 without matches', () => {
    expect(stepMatch(-1, 0, 'next')).toBe(-1);
    expect(stepMatch(0, 0, 'previous')).toBe(-1);
  });
});

describe('refindMatch', () => {
  const m = [{ seq: 1, start: 0, end: 1 }, { seq: 2, start: 0, end: 1 }, { seq: 2, start: 5, end: 6 }, { seq: 4, start: 0, end: 1 }];
  it('finds the exact match', () => {
    expect(refindMatch(m, { seq: 2, start: 5 }, 0)).toBe(2);
  });
  it('falls back to the first match of the same line', () => {
    expect(refindMatch(m, { seq: 2, start: 3 }, 0)).toBe(1);
  });
  it('falls back to the clamped last index', () => {
    expect(refindMatch(m, { seq: 3, start: 0 }, 2)).toBe(2);
    expect(refindMatch(m, { seq: 3, start: 0 }, 9)).toBe(3);
  });
  it('returns -1 when empty or nothing remembered', () => {
    expect(refindMatch([], { seq: 1, start: 0 }, 0)).toBe(-1);
    expect(refindMatch(m, null, 2)).toBe(-1);
  });
});

describe('searchStatusOf', () => {
  it('maps each branch', () => {
    expect(searchStatusOf({ resultIndex: -1, resultCount: 0 })).toEqual({ kind: 'none' });
    expect(searchStatusOf({ resultIndex: 3, resultCount: SEARCH_LIMIT })).toEqual({ kind: 'many', count: SEARCH_LIMIT });
    expect(searchStatusOf({ resultIndex: -1, resultCount: 5 })).toEqual({ kind: 'total', count: 5 });
    expect(searchStatusOf({ resultIndex: 2, resultCount: 5 })).toEqual({ kind: 'count', index: 2, count: 5 });
    expect(searchStatusOf({ resultIndex: 0, resultCount: 10 }, 10)).toEqual({ kind: 'many', count: 10 });
  });
});

describe('listSearchStatus', () => {
  const p = /a/g;
  it('maps each branch', () => {
    expect(listSearchStatus('', p, 3, false, 0)).toEqual({ kind: 'idle' });
    expect(listSearchStatus('a', null, 0, false, -1)).toEqual({ kind: 'invalid' });
    expect(listSearchStatus('a', p, 0, false, -1)).toEqual({ kind: 'none' });
    expect(listSearchStatus('a', p, SEARCH_LIMIT, true, 0)).toEqual({ kind: 'many', count: SEARCH_LIMIT });
    expect(listSearchStatus('a', p, 3, false, -1)).toEqual({ kind: 'total', count: 3 });
    expect(listSearchStatus('a', p, 3, false, 1)).toEqual({ kind: 'count', index: 1, count: 3 });
  });
});
