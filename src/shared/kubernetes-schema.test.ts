import { describe, expect, it } from 'vitest';
import { GROUP_BY_IDS, KUBE_NAME, manualJobName, MAX_COLLAPSED, MAX_COLUMN_FILTER_LENGTH, MAX_COLUMN_FILTERS, MAX_GROUP_KEY_LENGTH } from './kubernetes';
import { KubeActionRequestSchema, KubeQuerySchema, KubeRefSchema, KubeTerminalTargetSchema, KubeViewSnapshotSchema } from './kubernetes-schema';

describe('kubernetes schemas', () => {
  it('accepts a namespaced ref and rejects bad names', () => {
    expect(KubeRefSchema.safeParse({ kind: 'pods', namespace: 'shop', name: 'api-7f9c-x2kq' }).success).toBe(true);
    expect(KubeRefSchema.safeParse({ kind: 'pods', namespace: 'shop', name: 'API' }).success).toBe(false);
    expect(KubeRefSchema.safeParse({ kind: 'pods', namespace: '../x', name: 'a' }).success).toBe(false);
    expect(KubeRefSchema.safeParse({ kind: 'secrets', name: 'a' }).success).toBe(false);
  });
  it('accepts queries with label and node selectors', () => {
    expect(KubeQuerySchema.safeParse({ kind: 'pods', namespace: null, selector: { labels: { 'app.kubernetes.io/name': 'api' }, node: 'worker1' } }).success).toBe(true);
    expect(KubeQuerySchema.safeParse({ kind: 'pods', namespace: null, selector: { labels: { app: 'a,b' } } }).success).toBe(false);
  });
  it('bounds replicas', () => {
    const ref = { kind: 'deployments', namespace: 'shop', name: 'api' };
    expect(KubeActionRequestSchema.safeParse({ viewId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d', ref, action: 'scale', replicas: 3 }).success).toBe(true);
    expect(KubeActionRequestSchema.safeParse({ viewId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d', ref, action: 'scale', replicas: 1001 }).success).toBe(false);
    expect(KubeActionRequestSchema.safeParse({ viewId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d', ref, action: 'scale', replicas: 1.5 }).success).toBe(false);
  });
  it('accepts the new actions and rejects unknown ones', () => {
    const viewId = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
    const ref = { kind: 'nodes', name: 'w1' };
    for (const action of ['cordon', 'uncordon', 'suspend', 'resume', 'trigger']) expect(KubeActionRequestSchema.safeParse({ viewId, ref, action }).success).toBe(true);
    expect(KubeActionRequestSchema.safeParse({ viewId, ref, action: 'drain' }).success).toBe(false);
  });
  it('validates terminal targets', () => {
    expect(KubeTerminalTargetSchema.safeParse({ namespace: 'shop', pod: 'api-1', container: 'api', mode: 'shell' }).success).toBe(true);
    expect(KubeTerminalTargetSchema.safeParse({ namespace: 'shop', pod: 'api-1', container: 'api;rm', mode: 'shell' }).success).toBe(false);
  });
  it('validates the optional log format of terminal targets', () => {
    const target = { namespace: 'shop', pod: 'api-1', container: 'api', mode: 'logs' };
    expect(KubeTerminalTargetSchema.safeParse({ ...target, format: 'compact' }).success).toBe(true);
    expect(KubeTerminalTargetSchema.safeParse({ ...target, format: 'raw' }).success).toBe(true);
    expect(KubeTerminalTargetSchema.safeParse(target).success).toBe(true);
    expect(KubeTerminalTargetSchema.safeParse({ ...target, format: 'pretty' }).success).toBe(false);
  });
  it('accepts an optional logFormat in the snapshot', () => {
    const base = { query: { kind: 'pods', namespace: null }, crumbs: [], dock: 'logs' };
    expect(KubeViewSnapshotSchema.safeParse({ ...base, logFormat: 'raw' }).success).toBe(true);
    expect(KubeViewSnapshotSchema.safeParse({ ...base, logFormat: 'compact' }).success).toBe(true);
    expect(KubeViewSnapshotSchema.safeParse({ ...base, logFormat: 'x' }).success).toBe(false);
  });
  it('keeps old snapshots without filters valid and accepts a filter of one kind', () => {
    const base = { query: { kind: 'pods', namespace: null }, crumbs: [], dock: 'logs' };
    expect(KubeViewSnapshotSchema.safeParse(base).success).toBe(true);
    expect(KubeViewSnapshotSchema.safeParse({ ...base, filters: { pods: { text: 'api', chips: ['failed'] } } }).success).toBe(true);
    expect(KubeViewSnapshotSchema.safeParse({ ...base, filters: { events: { chips: ['warning'] }, nodes: {} } }).success).toBe(true);
    expect(KubeViewSnapshotSchema.safeParse({ ...base, filters: {} }).success).toBe(true);
  });
  it('rejects filters over the bounds or with unknown keys', () => {
    const base = { query: { kind: 'pods', namespace: null }, crumbs: [], dock: 'logs' };
    const parse = (filters: unknown): boolean => KubeViewSnapshotSchema.safeParse({ ...base, filters }).success;
    expect(parse({ pods: { text: 'a'.repeat(200) } })).toBe(true);
    expect(parse({ pods: { text: 'a'.repeat(201) } })).toBe(false);
    expect(parse({ pods: { chips: Array.from({ length: 16 }, (_, i) => `c${i}`) } })).toBe(true);
    expect(parse({ pods: { chips: Array.from({ length: 17 }, (_, i) => `c${i}`) } })).toBe(false);
    expect(parse({ pods: { chips: ['a'.repeat(41)] } })).toBe(false);
    expect(parse({ secrets: { text: 'x' } })).toBe(false);
    expect(parse({ pods: { text: 'x', extra: 1 } })).toBe(false);
  });
  it('accepts 0.7.0 snapshots and ones with columns, groupBy and collapsed', () => {
    const base = { query: { kind: 'pods', namespace: null }, crumbs: [], dock: 'logs' };
    const parse = (filters: unknown): boolean => KubeViewSnapshotSchema.safeParse({ ...base, filters }).success;
    expect(parse({ pods: { text: 'api', chips: ['failed'] } })).toBe(true);
    expect(parse({ pods: { columns: { name: 'api', restarts: '>3' }, groupBy: 'node', collapsed: ['worker1'] } })).toBe(true);
    expect(parse({ pods: { groupBy: 'namespace', collapsed: [''] } })).toBe(true);
    for (const groupBy of GROUP_BY_IDS) expect(parse({ pods: { groupBy } })).toBe(true);
  });
  it('rejects column filters, groupBy and collapsed over the bounds', () => {
    const base = { query: { kind: 'pods', namespace: null }, crumbs: [], dock: 'logs' };
    const parse = (filters: unknown): boolean => KubeViewSnapshotSchema.safeParse({ ...base, filters }).success;
    const keys = (n: number): Record<string, string> => Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${String.fromCharCode(97 + i)}`, 'x']));
    expect(parse({ pods: { columns: keys(MAX_COLUMN_FILTERS) } })).toBe(true);
    expect(parse({ pods: { columns: keys(MAX_COLUMN_FILTERS + 1) } })).toBe(false);
    expect(parse({ pods: { columns: { name: 'a'.repeat(MAX_COLUMN_FILTER_LENGTH) } } })).toBe(true);
    expect(parse({ pods: { columns: { name: 'a'.repeat(MAX_COLUMN_FILTER_LENGTH + 1) } } })).toBe(false);
    expect(parse({ pods: { columns: { 'image:app': 'x' } } })).toBe(false);
    expect(parse({ pods: { groupBy: 'foo' } })).toBe(false);
    expect(parse({ pods: { collapsed: Array.from({ length: MAX_COLLAPSED }, (_, i) => `g${i}`) } })).toBe(true);
    expect(parse({ pods: { collapsed: Array.from({ length: MAX_COLLAPSED + 1 }, (_, i) => `g${i}`) } })).toBe(false);
    expect(parse({ pods: { collapsed: ['a'.repeat(MAX_GROUP_KEY_LENGTH)] } })).toBe(true);
    expect(parse({ pods: { collapsed: ['a'.repeat(MAX_GROUP_KEY_LENGTH + 1)] } })).toBe(false);
  });
});

describe('manualJobName', () => {
  it('appends the unix time to a short name', () => {
    expect(manualJobName('nightly', 1760000000)).toBe('nightly-manual-1760000000');
  });
  it('keeps the whole suffix when the name is long', () => {
    const name = manualJobName('a'.repeat(52), 1760000000);
    expect(name.length).toBeLessThanOrEqual(63);
    expect(name).toMatch(/-manual-1760000000$/);
    expect(name).toMatch(KUBE_NAME);
  });
  it('drops a dash or dot left at the cut', () => {
    const name = manualJobName('a'.repeat(44) + '-bcdefgh', 1760000000);
    expect(name).toBe('a'.repeat(44) + '-manual-1760000000');
    expect(name).toMatch(KUBE_NAME);
    expect(manualJobName('a'.repeat(44) + '.bcdefgh', 1760000000)).toBe('a'.repeat(44) + '-manual-1760000000');
  });
  it('gives different names for different times', () => {
    const cron = 'a'.repeat(52);
    expect(manualJobName(cron, 1760000000)).not.toBe(manualJobName(cron, 1760000001));
  });
});
