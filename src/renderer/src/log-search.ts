import type { LogEntry } from './kube-logs';

export interface SearchOptions { regex: boolean; caseSensitive: boolean; wholeWord: boolean }
export const DEFAULT_SEARCH_OPTIONS: Readonly<SearchOptions> = { regex: false, caseSensitive: false, wholeWord: false };
/** Same as the xterm search addon's default highlight limit. */
export const SEARCH_LIMIT = 1000;

export type SearchStatus =
  | { kind: 'idle' }                                   // empty query
  | { kind: 'count'; index: number; count: number }    // index 0-based; shown as "1 von 100"
  | { kind: 'many'; count: number }                    // at least SEARCH_LIMIT matches; count === SEARCH_LIMIT
  | { kind: 'total'; count: number }                   // matches, but no current one known
  | { kind: 'none' }                                   // no match
  | { kind: 'invalid' };                               // regex does not compile

// mirrors NON_WORD_CHARACTERS of @xterm/addon-search 0.16, plus tab
const WORD_SEP = ' ~!@#$%^&*()+`-=[]{}|\;:"\',./<>?\t'.replace(/[\\\]^-]/g, '\\$&');

/** Global RegExp ('g' or 'gi', never 'u'), or null for '' and for a regex that does not compile. */
export function compileSearch(query: string, options: SearchOptions): RegExp | null {
  if (query === '') return null;
  const flags = options.caseSensitive ? 'g' : 'gi';
  let source = query;
  if (options.regex) {
    // Validate the raw input first: wrapping could make an invalid pattern like "a)(?:b" valid.
    try { new RegExp(query, flags); } catch { return null; }
  } else {
    source = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  if (options.wholeWord) source = `(?<=^|[${WORD_SEP}])(?:${source})(?=$|[${WORD_SEP}])`;
  try { return new RegExp(source, flags); } catch { return null; }
}

export interface LineMatch { seq: number; start: number; end: number }

/** Non-empty matches in the order of `lines`, only in `line.text`; at most `limit`, truncated when one more exists. */
export function findMatches(lines: readonly LogEntry[], pattern: RegExp, limit: number = SEARCH_LIMIT): { matches: LineMatch[]; truncated: boolean } {
  const matches: LineMatch[] = [];
  for (const line of lines) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(line.text)) !== null) {
      if (m[0].length === 0) { pattern.lastIndex++; continue; }
      if (matches.length >= limit) return { matches, truncated: true };
      matches.push({ seq: line.seq, start: m.index, end: m.index + m[0].length });
    }
  }
  return { matches, truncated: false };
}

/** Matches grouped by line, for rendering. */
export function matchesBySeq(matches: readonly LineMatch[]): ReadonlyMap<number, readonly LineMatch[]> {
  const map = new Map<number, LineMatch[]>();
  for (const m of matches) {
    const list = map.get(m.seq);
    if (list) list.push(m); else map.set(m.seq, [m]);
  }
  return map;
}

/** Text split around the matches of one line; `current` is marked 'current', the others 'match'. */
export function markParts(text: string, lineMatches: readonly LineMatch[], current: LineMatch | null): { text: string; mark: 'match' | 'current' | null }[] {
  const parts: { text: string; mark: 'match' | 'current' | null }[] = [];
  let pos = 0;
  for (const m of lineMatches) {
    if (m.start > pos) parts.push({ text: text.slice(pos, m.start), mark: null });
    const isCurrent = current !== null && current.seq === m.seq && current.start === m.start && current.end === m.end;
    parts.push({ text: text.slice(m.start, m.end), mark: isCurrent ? 'current' : 'match' });
    pos = m.end;
  }
  if (pos < text.length || parts.length === 0) parts.push({ text: text.slice(pos), mark: null });
  return parts;
}

/** Next index, cyclic; from -1, 'next' gives 0 and 'previous' gives count - 1; -1 when count is 0. */
export function stepMatch(index: number, count: number, direction: 'next' | 'previous'): number {
  if (count <= 0) return -1;
  if (index < 0) return direction === 'next' ? 0 : count - 1;
  return direction === 'next' ? (index + 1) % count : (index - 1 + count) % count;
}

/** Index of the remembered match after the matches changed: exact (seq, start), else the first match of the same line, else min(lastIndex, count - 1); -1 when there is no match or nothing is remembered. */
export function refindMatch(matches: readonly LineMatch[], current: { seq: number; start: number } | null, lastIndex: number): number {
  if (matches.length === 0 || current === null) return -1;
  const exact = matches.findIndex((m) => m.seq === current.seq && m.start === current.start);
  if (exact >= 0) return exact;
  const sameLine = matches.findIndex((m) => m.seq === current.seq);
  if (sameLine >= 0) return sameLine;
  return Math.max(0, Math.min(lastIndex, matches.length - 1));
}

/** Status from the xterm addon's onDidChangeResults. */
export function searchStatusOf(result: { resultIndex: number; resultCount: number }, limit: number = SEARCH_LIMIT): SearchStatus {
  if (result.resultCount === 0) return { kind: 'none' };
  if (result.resultCount >= limit) return { kind: 'many', count: limit };
  if (result.resultIndex < 0) return { kind: 'total', count: result.resultCount };
  return { kind: 'count', index: result.resultIndex, count: result.resultCount };
}

/** Status of the log list. */
export function listSearchStatus(query: string, pattern: RegExp | null, matchCount: number, truncated: boolean, currentIndex: number): SearchStatus {
  if (query === '') return { kind: 'idle' };
  if (pattern === null) return { kind: 'invalid' };
  if (matchCount === 0) return { kind: 'none' };
  if (truncated) return { kind: 'many', count: SEARCH_LIMIT };
  if (currentIndex < 0) return { kind: 'total', count: matchCount };
  return { kind: 'count', index: currentIndex, count: matchCount };
}
