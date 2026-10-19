import { describe, expect, it } from 'vitest';
import type { InventoryKind, InventoryRow, InventoryState, RowTone } from '../../shared/containers';
import { CHIPS, attentionChip, chipCounts, compileChips, knownChips, primaryChip } from './container-status';

const row = (kind: InventoryKind, extra: Partial<InventoryRow> = {}): InventoryRow => ({
  uid: 'u', ref: { kind, runtime: 'docker', ref: 'x' }, id: 'x', name: 'x', cells: {}, tone: 'ok', labels: {}, ...extra,
});
const container = (state: InventoryState, tone: RowTone = 'ok', extra: Partial<InventoryRow> = {}) => row('containers', { state, tone, ...extra });
const chip = (kind: InventoryKind, id: string) => CHIPS[kind].find(def => def.id === id)!;

describe('CHIPS', () => {
  it('lists the chips in bar order', () => {
    expect(CHIPS.containers.map(c => c.id)).toEqual(['attention', 'running', 'stopped', 'paused', 'compose']);
    expect(CHIPS.containers.map(c => c.label)).toEqual(['Auffällig', 'Läuft', 'Gestoppt', 'Pausiert', 'Compose']);
    expect(CHIPS.images.map(c => c.id)).toEqual(['dangling', 'unused']);
    expect(CHIPS.volumes.map(c => c.id)).toEqual(['unused']);
    expect(CHIPS.networks).toEqual([]);
  });
  it('matches containers', () => {
    expect(chip('containers', 'attention').matches(container('running', 'warn'))).toBe(true);
    expect(chip('containers', 'attention').matches(container('exited', 'bad'))).toBe(true);
    expect(chip('containers', 'attention').matches(container('running', 'ok'))).toBe(false);
    expect(chip('containers', 'running').matches(container('running'))).toBe(true);
    expect(chip('containers', 'running').matches(container('paused'))).toBe(false);
    for (const state of ['exited', 'stopped', 'created', 'dead'] as const) expect(chip('containers', 'stopped').matches(container(state))).toBe(true);
    expect(chip('containers', 'stopped').matches(container('running'))).toBe(false);
    expect(chip('containers', 'paused').matches(container('paused'))).toBe(true);
    expect(chip('containers', 'compose').matches(container('running', 'ok', { project: 'shop' }))).toBe(true);
    expect(chip('containers', 'compose').matches(container('running'))).toBe(false);
  });
  it('matches images and volumes', () => {
    expect(chip('images', 'dangling').matches(row('images', { cells: { tag: '' } }))).toBe(true);
    expect(chip('images', 'dangling').matches(row('images', { cells: { tag: 'latest' } }))).toBe(false);
    expect(chip('images', 'unused').matches(row('images', { usedBy: 0 }))).toBe(true);
    expect(chip('images', 'unused').matches(row('images', { usedBy: 2 }))).toBe(false);
    expect(chip('images', 'unused').matches(row('images'))).toBe(false);
    expect(chip('volumes', 'unused').matches(row('volumes', { usedBy: 0 }))).toBe(true);
    expect(chip('volumes', 'unused').matches(row('volumes'))).toBe(false);
  });
});

describe('knownChips', () => {
  it('keeps known ids only, deduplicated, in CHIPS order', () => {
    expect(knownChips('containers', ['compose', 'nope', 'running', 'running'])).toEqual(['running', 'compose']);
    expect(knownChips('networks', ['running'])).toEqual([]);
  });
});

describe('compileChips', () => {
  const rows = [container('running', 'ok', { project: 'a' }), container('running', 'bad'), container('exited', 'bad', { project: 'a' }), container('paused')];
  const run = (ids: string[]) => rows.filter(compileChips('containers', ids));
  it('passes everything without ids or with unknown ids', () => {
    expect(run([])).toHaveLength(4);
    expect(run(['nope'])).toHaveLength(4);
  });
  it('ORs within a group', () => {
    expect(run(['running', 'paused'])).toEqual([rows[0], rows[1], rows[3]]);
  });
  it('ANDs between groups', () => {
    expect(run(['running', 'compose'])).toEqual([rows[0]]);
    expect(run(['attention', 'stopped', 'compose'])).toEqual([rows[2]]);
  });
});

describe('chipCounts', () => {
  it('counts every id, zero included', () => {
    const rows = [container('running'), container('running', 'warn', { project: 'a' }), container('paused')];
    expect(chipCounts('containers', rows)).toEqual({ attention: 1, running: 2, stopped: 0, paused: 1, compose: 1 });
    expect(chipCounts('networks', [row('networks')])).toEqual({});
  });
});

describe('attentionChip', () => {
  it('exists for containers only', () => {
    expect(attentionChip('containers')).toBe('attention');
    for (const kind of ['images', 'volumes', 'networks'] as const) expect(attentionChip(kind)).toBeNull();
  });
});

describe('primaryChip', () => {
  it('is the first matching status chip for containers', () => {
    expect(primaryChip('containers', container('running'))?.id).toBe('running');
    expect(primaryChip('containers', container('dead', 'bad'))?.id).toBe('stopped');
    expect(primaryChip('containers', container('paused'))?.id).toBe('paused');
    expect(primaryChip('containers', container('restarting', 'warn'))).toBeUndefined();
  });
  it('is undefined for other kinds', () => {
    expect(primaryChip('images', row('images', { usedBy: 0 }))).toBeUndefined();
    expect(primaryChip('volumes', row('volumes', { usedBy: 0 }))).toBeUndefined();
  });
});
