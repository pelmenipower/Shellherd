import { describe, expect, it } from 'vitest';
import type { KubeRow } from '../../shared/kubernetes';
import { copiedMessage, eventsTsv } from './kube-copy';

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
