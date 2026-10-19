import { describe, expect, it } from 'vitest';
import type { ClusterStatus } from '../../shared/kubernetes';
import { FIRST_NOTICE_MS, RECOVERED_MS, connbar } from './cluster-bar';

const NOW = 1_000_000;
const base: ClusterStatus = { state: 'ready', name: 'c', production: false, readOnly: false, metrics: true, host: 'node-a' };
const status = (patch: Partial<ClusterStatus>): ClusterStatus => ({ ...base, ...patch });
const bar = (patch: Partial<Parameters<typeof connbar>[0]> & { s?: Partial<ClusterStatus> | null }) => {
  const { s, ...rest } = patch;
  return connbar({ status: s === null ? null : status(s ?? {}), now: NOW, updatedAt: 0, ...rest });
};

describe('connbar', () => {
  it('constants', () => { expect(RECOVERED_MS).toBe(3000); expect(FIRST_NOTICE_MS).toBe(2000); });

  it('is off and "Verbinde …" without status or while connecting', () => {
    expect(bar({ s: null })).toEqual({ tone: 'off', text: 'Verbinde …', age: '' });
    expect(bar({ s: { state: 'connecting' }, updatedAt: NOW - 5000 })).toEqual({ tone: 'off', text: 'Verbinde …', age: '' });
  });
  it('names the connection being tried while connecting', () => {
    expect(bar({ s: { state: 'connecting', trying: 'jump' } })).toMatchObject({ tone: 'off', text: 'Verbinde über jump …' });
  });

  it('is live; age empty for unknown updatedAt', () => {
    expect(bar({ updatedAt: 0 })).toEqual({ tone: 'live', text: 'Live', age: '' });
  });
  it.each([
    [0, 'gerade aktualisiert'], [14_999, 'gerade aktualisiert'], [15_000, 'Stand vor 15 s'], [59_999, 'Stand vor 59 s'],
    [60_000, 'Stand vor 1 min'], [125_000, 'Stand vor 2 min'],
  ])('ages %i ms as "%s"', (ms, text) => {
    expect(bar({ updatedAt: NOW - ms }).age).toBe(text);
  });
  it('treats an updatedAt in the future as fresh', () => {
    expect(bar({ updatedAt: NOW + 500 }).age).toBe('gerade aktualisiert');
  });

  it('is ok for 3 s after recovery', () => {
    expect(bar({ recoveredAt: NOW - 2999, updatedAt: NOW })).toEqual({ tone: 'ok', text: 'Wieder verbunden über node-a', age: 'gerade aktualisiert' });
    expect(bar({ recoveredAt: NOW - 3000 }).tone).toBe('live');
  });

  it('warns with the host that does not answer in the first 2 s', () => {
    const input = { s: { state: 'reconnecting' as const, attempt: 1 }, updatedAt: NOW - 20_000 };
    expect(bar({ ...input, reconnectingSince: NOW - 1999 })).toEqual({ tone: 'warn', text: 'node-a antwortet nicht. Verbinde neu …', age: 'Stand vor 20 s' });
    expect(bar({ s: { ...input.s, trying: 'node-a' }, updatedAt: input.updatedAt, reconnectingSince: NOW - 10 }).text).toBe('node-a antwortet nicht. Verbinde neu …');
    expect(bar({ s: { ...input.s, trying: 'node-b' }, updatedAt: input.updatedAt, reconnectingSince: NOW - 10 }).text).toBe('node-a antwortet nicht. Verbinde über node-b …');
  });
  it('shows the attempt after the first 2 s, or without host', () => {
    const s = { state: 'reconnecting' as const, attempt: 3 };
    expect(bar({ s, reconnectingSince: NOW - 2000 })).toMatchObject({ tone: 'warn', text: 'Verbinde neu … (Versuch 3)' });
    expect(bar({ s: { ...s, trying: 'node-b' }, reconnectingSince: NOW - 5000 }).text).toBe('Verbinde über node-b … (Versuch 3)');
    expect(bar({ s: { ...s, host: undefined }, reconnectingSince: NOW - 10 }).text).toBe('Verbinde neu … (Versuch 3)');
    expect(bar({ s, reconnectingSince: undefined }).text).toBe('Verbinde neu … (Versuch 3)');
  });
  it('omits the attempt number when main sent none', () => {
    expect(bar({ s: { state: 'reconnecting' }, reconnectingSince: NOW - 9000 }).text).toBe('Verbinde neu …');
  });

  it('is off with "Nicht verbunden" on error', () => {
    expect(bar({ s: { state: 'error' }, updatedAt: NOW - 1000 })).toEqual({ tone: 'off', text: 'Nicht verbunden', age: '' });
  });
});
