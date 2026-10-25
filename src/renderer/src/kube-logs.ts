import { foldCase } from '../../shared/format';
import type { KubeLogLine, KubeLogSource } from '../../shared/kubernetes';

/** A received line with its arrival number: React key and tie-break for equal times. */
export interface LogEntry extends KubeLogLine { seq: number }
export const MAX_BUFFER_LINES = 10_000;
export const DISPLAY_LINES = 2_000;
/** Number of --color-source-* tokens; sources beyond reuse them. */
export const SOURCE_COLORS = 4;

/** Inserts lines after the last line with the same or an older time (stable; lines without time go to the end) and keeps the newest `max`. */
export function mergeLines(buffer: readonly LogEntry[], lines: readonly KubeLogLine[], firstSeq: number, max: number): LogEntry[] {
  const out = buffer.slice();
  lines.forEach((line, index) => {
    let at = out.length;
    if (line.time !== '') while (at > 0 && out[at - 1].time > line.time) at--;
    out.splice(at, 0, { ...line, seq: firstSeq + index });
  });
  return out.length > max ? out.slice(out.length - max) : out;
}

export const sourceLabel = (source: KubeLogSource | undefined): string => (source ? `${source.pod}/${source.container}` : '?');

/** Lines of shown sources that contain `filter` (in prefix or text, case-insensitive); the newest `limit`, and how many matches were left out. */
export function shownLines(lines: readonly LogEntry[], sources: readonly KubeLogSource[], hidden: ReadonlySet<number>, filter: string,
  limit: number = DISPLAY_LINES): { lines: LogEntry[]; hiddenOlder: number } {
  const needle = foldCase(filter.trim());
  const matches = lines.filter(line => !hidden.has(line.source)
    && (needle === '' || foldCase(`${sourceLabel(sources[line.source])} ${line.text}`).includes(needle)));
  return matches.length > limit ? { lines: matches.slice(matches.length - limit), hiddenOlder: matches.length - limit } : { lines: matches, hiddenOlder: 0 };
}

/** HH:MM:SS.mmm of a server timestamp, UTC like the compact log format; '' without one. */
export const logTime = (time: string): string => time.slice(11, 23);

/** Text split around the case-insensitive matches of `filter`. shortcut: no marks when case folding changes the length (rare scripts); matching lines are still filtered. */
export function highlightParts(text: string, filter: string): { text: string; mark: boolean }[] {
  const needle = foldCase(filter.trim());
  const folded = foldCase(text);
  if (needle === '' || folded.length !== text.length) return [{ text, mark: false }];
  const parts: { text: string; mark: boolean }[] = [];
  let from = 0;
  for (let at = folded.indexOf(needle); at >= 0; at = folded.indexOf(needle, at + needle.length)) {
    if (at > from) parts.push({ text: text.slice(from, at), mark: false });
    parts.push({ text: text.slice(at, at + needle.length), mark: true });
    from = at + needle.length;
  }
  if (from < text.length) parts.push({ text: text.slice(from), mark: false });
  return parts.length > 0 ? parts : [{ text, mark: false }];
}

/** Lines as plain text for the clipboard: `<pod>/<container> <HH:MM:SS.mmm> <text>`. */
export function logsText(lines: readonly LogEntry[], sources: readonly KubeLogSource[]): string {
  return lines.map(line => `${sourceLabel(sources[line.source])} ${logTime(line.time)} ${line.text}`).join('\n');
}

export function toggleSource(hidden: ReadonlySet<number>, index: number): ReadonlySet<number> {
  const next = new Set(hidden);
  if (next.has(index)) next.delete(index);
  else next.add(index);
  return next;
}
