import { describe, expect, it } from 'vitest';
import type { KubeRow } from '../../shared/kubernetes';
import { i18n } from './i18n';
import { capText, copiedMessage, eventsTsv } from './kube-copy';

const row = (cells: KubeRow['cells']): KubeRow => ({ uid: 'u', ref: { kind: 'events', name: 'e' }, cells, tone: 'ok' }) as KubeRow;

describe('eventsTsv', () => {
  it('writes the header and one line per row', () => {
    const tsv = eventsTsv([row({ type: 'Warning', reason: 'BackOff', object: 'pod/a', message: 'x', count: 3, last: '2026-10-18T10:00:00Z' })], Date.parse('2026-10-18T10:05:00Z'));
    expect(tsv.split('\n')).toEqual(['Typ\tGrund\tObjekt\tMeldung\tAnzahl\tZuletzt', 'Warning\tBackOff\tpod/a\tx\t3\t5m']);
  });
  it('flattens tabs and newlines in cells and tolerates missing cells', () => {
    const tsv = eventsTsv([row({ message: 'a\tb\r\nc' })], 0);
    expect(tsv.split('\n')[1]).toBe('\t\t\ta b c\t\t-');
  });
  it('returns an empty string without rows', () => { expect(eventsTsv([], 0)).toBe(''); });
});

describe('copiedMessage', () => {
  it('names the line count for multi-line text', () => {
    expect(copiedMessage('Logs', 'a\nb\nc')).toBe('Kopiert: Logs (3 Zeilen)');
  });
  it('counts a single line', () => { expect(copiedMessage('YAML', 'a')).toBe('Kopiert: YAML (1 Zeile)'); });
});

describe('copiedMessage line counting', () => {
  it('ignores a trailing newline', () => { expect(copiedMessage('YAML', 'a\nb\n')).toBe('Kopiert: YAML (2 Zeilen)'); });
  it('uses an explicit line count (Events without the header)', () => {
    expect(copiedMessage('Events', 'h\nr1\nr2', { lines: 2 })).toBe('Kopiert: Events (2 Zeilen)');
  });
  it('mentions shortened text', () => {
    expect(copiedMessage('Logs', 'a\nb', { shortened: true })).toBe('Kopiert: Logs (2 Zeilen, gekürzt)');
  });
});

describe('capText', () => {
  it('keeps short text', () => { expect(capText('abc', 10)).toEqual({ text: 'abc', shortened: false }); });
  it('keeps the tail and starts at a line start', () => {
    expect(capText('aaaa\nbbbb\ncccc', 8)).toEqual({ text: 'cccc', shortened: true });
  });
  it('cuts mid-line when a single line is too long', () => {
    expect(capText('abcdefgh', 3)).toEqual({ text: 'fgh', shortened: true });
  });
});

describe('eventsTsv cell cleaning', () => {
  it('strips control characters and neutralises formula starts', () => {
    const cells = eventsTsv([row({ message: '=SUM(1)\u001b[2J', reason: '"q' })], 0).split('\n')[1].split('\t');
    expect(cells[3]).toBe("'=SUM(1)[2J");
    expect(cells[1]).toBe("'\"q");
  });
});

describe('copiedMessage in English', () => {
  it('pluralizes and marks truncation', async () => {
    await i18n.changeLanguage('en-US');
    try {
      expect(copiedMessage('YAML', 'a')).toBe('Copied: YAML (1 line)');
      expect(copiedMessage('Logs', 'a\nb', { shortened: true })).toBe('Copied: Logs (2 lines, truncated)');
    } finally { await i18n.changeLanguage('de-DE'); }
  });
});
