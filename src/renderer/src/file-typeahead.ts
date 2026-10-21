import { foldCase } from '../../shared/format';

export const TYPEAHEAD_MS = 1000;
export interface Typeahead { text: string; at: number }

/** One printable character without Ctrl/Alt/Meta; Space and named keys (F5, Backspace, Dead) stay with their bindings. */
export function isTypeaheadKey(event: { key: string; ctrlKey: boolean; altKey: boolean; metaKey: boolean }): boolean {
  return event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.altKey && !event.metaKey;
}

/** Explorer rule: characters typed within TYPEAHEAD_MS form a prefix; one character repeated cycles through its matches.
 *  Searches `names` in display order, wrapping; a fresh character starts after the cursor, a longer prefix at the cursor. */
export function typeahead(names: string[], cursor: string | null, previous: Typeahead | null, key: string, now: number): { name: string | null; state: Typeahead } {
  const text = previous && now - previous.at < TYPEAHEAD_MS ? previous.text + key : key;
  const folded = foldCase(text);
  const repeat = folded.length > 1 && [...folded].every(char => char === folded[0]);
  const prefix = repeat ? folded[0] : folded;
  const index = cursor ? names.indexOf(cursor) : -1;
  const start = repeat || text.length === 1 ? index + 1 : Math.max(index, 0);
  for (let step = 0; step < names.length; step += 1) {
    const name = names[(start + step) % names.length];
    if (foldCase(name).startsWith(prefix)) return { name, state: { text, at: now } };
  }
  return { name: null, state: { text, at: now } };
}
