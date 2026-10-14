import { describe, expect, it } from 'vitest';
import { createSudoMarker, SudoPromptWatcher } from './sudo';

const MARKER = '[terminus-sudo-0123456789abcdef]';
const bytes = (text: string): Buffer => Buffer.from(text, 'utf8');

function feedAll(watcher: SudoPromptWatcher, chunks: string[]): { text: string; prompts: number[] } {
  const parts: Buffer[] = [];
  const prompts: number[] = [];
  for (const chunk of chunks) {
    const result = watcher.feed(bytes(chunk));
    parts.push(result.output);
    prompts.push(result.prompts);
  }
  parts.push(watcher.flush());
  return { text: Buffer.concat(parts).toString('utf8'), prompts };
}

describe('createSudoMarker', () => {
  it('creates distinct markers without sudo escapes', () => {
    const markers = new Set(Array.from({ length: 50 }, () => createSudoMarker()));
    expect(markers.size).toBe(50);
    for (const marker of markers) expect(marker).toMatch(/^\[terminus-sudo-[0-9a-f]{16}\]$/);
  });
});

describe('SudoPromptWatcher', () => {
  it('passes output without a marker through unchanged', () => {
    const watcher = new SudoPromptWatcher(MARKER);
    const result = watcher.feed(bytes('hello world\n'));
    expect(result.output.toString('utf8')).toBe('hello world\n');
    expect(result.prompts).toBe(0);
    expect(watcher.holding).toBe(false);
    expect(watcher.flush()).toHaveLength(0);
  });
  it('removes a marker contained in one chunk', () => {
    const watcher = new SudoPromptWatcher(MARKER);
    const result = watcher.feed(bytes(`before${MARKER}after`));
    expect(result.output.toString('utf8')).toBe('beforeafter');
    expect(result.prompts).toBe(1);
    expect(watcher.count).toBe(1);
  });
  it('finds a marker split across two chunks and holds only the possible prefix', () => {
    const watcher = new SudoPromptWatcher(MARKER);
    const first = watcher.feed(bytes(`line\n${MARKER.slice(0, 10)}`));
    expect(first.output.toString('utf8')).toBe('line\n');
    expect(first.prompts).toBe(0);
    expect(watcher.holding).toBe(true);
    const second = watcher.feed(bytes(`${MARKER.slice(10)}rest`));
    expect(second.output.toString('utf8')).toBe('rest');
    expect(second.prompts).toBe(1);
  });
  it('finds a marker split across three chunks', () => {
    const watcher = new SudoPromptWatcher(MARKER);
    const { text, prompts } = feedAll(watcher, [`a${MARKER.slice(0, 3)}`, MARKER.slice(3, 20), `${MARKER.slice(20)}b`]);
    expect(text).toBe('ab');
    expect(prompts).toEqual([0, 0, 1]);
  });
  it('counts two markers, in one chunk or across chunks', () => {
    const watcher = new SudoPromptWatcher(MARKER);
    expect(watcher.feed(bytes(`${MARKER}x${MARKER}`)).prompts).toBe(2);
    const other = new SudoPromptWatcher(MARKER);
    const { text, prompts } = feedAll(other, [MARKER, '\nSorry, try again.\n', MARKER]);
    expect(text).toBe('\nSorry, try again.\n');
    expect(prompts).toEqual([1, 0, 1]);
    expect(other.count).toBe(2);
  });
  it('releases a near-miss prefix as soon as it can no longer be a marker', () => {
    const watcher = new SudoPromptWatcher(MARKER);
    expect(watcher.feed(bytes('x[terminus-')).output.toString('utf8')).toBe('x');
    const next = watcher.feed(bytes('other]'));
    expect(next.output.toString('utf8')).toBe('[terminus-other]');
    expect(next.prompts).toBe(0);
    expect(watcher.holding).toBe(false);
  });
  it('re-holds a new prefix that starts inside a near miss', () => {
    const watcher = new SudoPromptWatcher(MARKER);
    const { text, prompts } = feedAll(watcher, ['[ter[', `${MARKER.slice(1)}`]);
    expect(text).toBe('[ter');
    expect(prompts).toEqual([0, 1]);
  });
  it('flushes a held tail that never became a marker', () => {
    const watcher = new SudoPromptWatcher(MARKER);
    expect(watcher.feed(bytes('prompt$ [')).output.toString('utf8')).toBe('prompt$ ');
    expect(watcher.flush().toString('utf8')).toBe('[');
    expect(watcher.holding).toBe(false);
  });
  it('keeps multi-byte characters split across chunks byte-exact', () => {
    const watcher = new SudoPromptWatcher(MARKER);
    const umlaut = Buffer.from('ä');
    const out = Buffer.concat([watcher.feed(umlaut.subarray(0, 1)).output, watcher.feed(umlaut.subarray(1)).output, watcher.flush()]);
    expect(out.toString('utf8')).toBe('ä');
  });
});
