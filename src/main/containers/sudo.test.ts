import { describe, expect, it } from 'vitest';
import { createSudoMarker, SudoWatcher } from './sudo';

const PROMPT = '[terminus-sudo-0123456789abcdef]';
const READY = '[terminus-ready-0123456789abcdef]';
const bytes = (text: string): Buffer => Buffer.from(text, 'utf8');

describe('createSudoMarker list', () => {
  it('creates a fresh list marker per call', () => {
    expect(createSudoMarker('list')).toMatch(/^\[terminus-list-[0-9a-f]{16}\]$/);
    expect(new Set(Array.from({ length: 50 }, () => createSudoMarker('list'))).size).toBe(50);
  });
});

function feedAll(watcher: SudoWatcher, chunks: string[]): { text: string; prompts: number[]; ready: boolean[] } {
  const parts: Buffer[] = [];
  const prompts: number[] = [];
  const ready: boolean[] = [];
  for (const chunk of chunks) {
    const result = watcher.feed(bytes(chunk));
    parts.push(result.output);
    prompts.push(result.prompts);
    ready.push(result.ready);
  }
  parts.push(watcher.flush());
  return { text: Buffer.concat(parts).toString('utf8'), prompts, ready };
}

describe('createSudoMarker', () => {
  it('creates distinct prompt and ready markers without sudo escapes', () => {
    const markers = new Set(Array.from({ length: 50 }, () => createSudoMarker('sudo')));
    expect(markers.size).toBe(50);
    for (const marker of markers) expect(marker).toMatch(/^\[terminus-sudo-[0-9a-f]{16}\]$/);
    expect(createSudoMarker('ready')).toMatch(/^\[terminus-ready-[0-9a-f]{16}\]$/);
  });
});

describe('SudoWatcher', () => {
  it('passes output without a marker through unchanged', () => {
    const watcher = new SudoWatcher({ prompt: PROMPT, ready: READY });
    const result = watcher.feed(bytes('hello world\n'));
    expect(result).toMatchObject({ prompts: 0, ready: false });
    expect(result.output.toString('utf8')).toBe('hello world\n');
    expect(watcher.holding).toBe(false);
    expect(watcher.flush()).toHaveLength(0);
  });
  it('removes a prompt contained in one chunk', () => {
    const watcher = new SudoWatcher({ prompt: PROMPT });
    const result = watcher.feed(bytes(`before${PROMPT}after`));
    expect(result.output.toString('utf8')).toBe('beforeafter');
    expect(result.prompts).toBe(1);
    expect(watcher.count).toBe(1);
  });
  it('finds a prompt split across two and three chunks and holds only the possible prefix', () => {
    const watcher = new SudoWatcher({ prompt: PROMPT });
    const first = watcher.feed(bytes(`line\n${PROMPT.slice(0, 10)}`));
    expect(first.output.toString('utf8')).toBe('line\n');
    expect(watcher.holding).toBe(true);
    expect(watcher.feed(bytes(`${PROMPT.slice(10)}rest`))).toMatchObject({ prompts: 1 });
    const other = new SudoWatcher({ prompt: PROMPT });
    const { text, prompts } = feedAll(other, [`a${PROMPT.slice(0, 3)}`, PROMPT.slice(3, 20), `${PROMPT.slice(20)}b`]);
    expect(text).toBe('ab');
    expect(prompts).toEqual([0, 0, 1]);
  });
  it('counts two prompts, in one chunk or across chunks', () => {
    expect(new SudoWatcher({ prompt: PROMPT }).feed(bytes(`${PROMPT}x${PROMPT}`)).prompts).toBe(2);
    const watcher = new SudoWatcher({ prompt: PROMPT });
    const { text, prompts } = feedAll(watcher, [PROMPT, '\nSorry, try again.\n', PROMPT]);
    expect(text).toBe('\nSorry, try again.\n');
    expect(prompts).toEqual([1, 0, 1]);
    expect(watcher.count).toBe(2);
  });
  it('does not count a marker re-formed around a removed one', () => {
    const watcher = new SudoWatcher({ prompt: PROMPT });
    const result = watcher.feed(bytes(`${PROMPT.slice(0, 15)}${PROMPT}${PROMPT.slice(15)}`));
    expect(result.prompts).toBe(1);
    expect(watcher.count).toBe(1);
  });
  it('releases a near-miss prefix as soon as it can no longer be a marker', () => {
    const watcher = new SudoWatcher({ prompt: PROMPT, ready: READY });
    expect(watcher.feed(bytes('x[terminus-')).output.toString('utf8')).toBe('x');
    const next = watcher.feed(bytes('other]'));
    expect(next.output.toString('utf8')).toBe('[terminus-other]');
    expect(watcher.holding).toBe(false);
    const { text, prompts } = feedAll(new SudoWatcher({ prompt: PROMPT }), ['[ter[', PROMPT.slice(1)]);
    expect(text).toBe('[ter');
    expect(prompts).toEqual([0, 1]);
  });
  it('flushes a held tail that never became a marker', () => {
    const watcher = new SudoWatcher({ prompt: PROMPT });
    expect(watcher.feed(bytes('prompt$ [')).output.toString('utf8')).toBe('prompt$ ');
    expect(watcher.flush().toString('utf8')).toBe('[');
    expect(watcher.holding).toBe(false);
  });
  it('disarms at the ready marker and passes everything after it through untouched', () => {
    const watcher = new SudoWatcher({ prompt: PROMPT, ready: READY });
    const result = watcher.feed(bytes(`\r\n${READY}shell$ ${PROMPT}`));
    expect(result).toMatchObject({ prompts: 0, ready: true });
    expect(result.output.toString('utf8')).toBe(`\r\nshell$ ${PROMPT}`);
    expect(watcher.armed).toBe(false);
    const later = watcher.feed(bytes(`${PROMPT}[`));
    expect(later).toMatchObject({ prompts: 0, ready: false });
    expect(later.output.toString('utf8')).toBe(`${PROMPT}[`);
    expect(watcher.holding).toBe(false);
  });
  it('finds a ready marker split across chunks', () => {
    const watcher = new SudoWatcher({ prompt: PROMPT, ready: READY });
    const { text, ready } = feedAll(watcher, [READY.slice(0, 12), `${READY.slice(12)}ok`]);
    expect(text).toBe('ok');
    expect(ready).toEqual([false, true]);
  });
  it('reports prompts seen before the ready marker in the same chunk', () => {
    const result = new SudoWatcher({ prompt: PROMPT, ready: READY }).feed(bytes(`${PROMPT}${READY}${PROMPT}`));
    expect(result).toMatchObject({ prompts: 1, ready: true });
    expect(result.output.toString('utf8')).toBe(PROMPT);
  });
  it('keeps multi-byte characters split across chunks byte-exact', () => {
    const watcher = new SudoWatcher({ prompt: PROMPT });
    const umlaut = Buffer.from('ä');
    const out = Buffer.concat([watcher.feed(umlaut.subarray(0, 1)).output, watcher.feed(umlaut.subarray(1)).output, watcher.flush()]);
    expect(out.toString('utf8')).toBe('ä');
  });
});
