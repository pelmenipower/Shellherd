import { describe, expect, it } from 'vitest';
import type { KubeKind, KubeRow, RowTone } from './kubernetes';
import { KUBE_KINDS } from './kubernetes';
import { CHIPS, MUTED_STATES, WARN_STATES, attentionChip, chipCounts, compileChips, jobTone, knownChips, podTone, primaryChip } from './kube-status';

const NOW = Date.parse('2026-10-18T12:00:00Z');
function row(kind: KubeKind, cells: KubeRow['cells'], extra: Partial<KubeRow> = {}): KubeRow {
  return { uid: 'u', ref: { kind, name: 'x' }, cells, tone: 'ok', labels: {}, ...extra };
}
const pod = (status: string, extra: Partial<KubeRow['cells']> = {}, notReady = false): KubeRow =>
  row('pods', { status, ready: notReady ? '0/1' : '1/1', restarts: 0, ...extra }, { tone: podTone(status, notReady) });
const ids = (kind: KubeKind, r: KubeRow, group?: string): string[] => CHIPS[kind].filter(c => (!group || c.group === group) && c.matches(r, NOW)).map(c => c.id);

describe('podTone', () => {
  it('partitions every status into one tone', () => {
    const cases: [string, boolean, RowTone][] = [['Completed', false, 'muted'], ['Terminating', false, 'muted'], ['Pending', false, 'warn'],
      ['ContainerCreating', false, 'warn'], ['PodInitializing', false, 'warn'], ['Running', false, 'ok'], ['Running', true, 'warn'],
      ['CrashLoopBackOff', false, 'bad'], ['CreateContainerError', false, 'bad'], ['RunContainerError', false, 'bad'], ['ErrImageNeverPull', false, 'bad'],
      ['Unknown', false, 'bad'], ['Evicted', false, 'bad'], ['Foo', false, 'bad'], ['Failed', false, 'bad']];
    for (const [status, notReady, tone] of cases) expect(podTone(status, notReady)).toBe(tone);
    expect(WARN_STATES.has('Pending')).toBe(true);
    expect(MUTED_STATES.has('Completed')).toBe(true);
  });
  it('puts every pod status into exactly one status chip and failed iff bad', () => {
    const statuses = ['Running', 'Pending', 'ContainerCreating', 'PodInitializing', 'Terminating', 'Completed', 'CrashLoopBackOff', 'ImagePullBackOff',
      'ErrImagePull', 'InvalidImageName', 'OOMKilled', 'Error', 'Failed', 'CreateContainerError', 'CreateContainerConfigError', 'Unknown', 'Evicted', 'Foo'];
    for (const status of statuses) {
      for (const notReady of status === 'Running' ? [false, true] : [false]) {
        const r = pod(status, {}, notReady);
        expect(ids('pods', r, 'status'), status).toHaveLength(1);
        expect(ids('pods', r, 'status').includes('failed'), status).toBe(r.tone === 'bad');
      }
    }
  });
  it('files a Completed sidecar pod under Abgeschlossen only', () => {
    expect(ids('pods', pod('Completed', { ready: '0/1' }), 'status')).toEqual(['completed']);
  });
});

describe('jobTone', () => {
  it('maps job statuses', () => {
    expect([jobTone('Failed'), jobTone('Complete'), jobTone('Suspended'), jobTone('Running'), jobTone('Pending')]).toEqual(['bad', 'ok', 'muted', 'warn', 'warn']);
  });
});

describe('chips per kind', () => {
  it('pods', () => {
    expect(ids('pods', pod('Running'))).toEqual(['running']);
    expect(ids('pods', pod('Running', {}, true))).toEqual(['attention', 'running', 'notready']);
    expect(ids('pods', pod('Pending', { ready: '0/1' }))).toEqual(['attention', 'waiting', 'notready']);
    expect(ids('pods', pod('CrashLoopBackOff', { ready: '0/1', restarts: 4 }))).toEqual(['attention', 'failed', 'notready', 'restarts']);
    expect(ids('pods', pod('Completed', { ready: '0/1' }))).toEqual(['completed']);
    expect(ids('pods', pod('Terminating', { ready: '0/1' }))).toEqual(['terminating']);
    expect(ids('pods', pod('Running', { ready: 'x' }))).toEqual(['running']);
  });
  it('workloads', () => {
    for (const kind of ['deployments', 'statefulsets', 'daemonsets'] as const) {
      expect(ids(kind, row(kind, {}, { tone: 'ok' }))).toEqual(['complete']);
      expect(ids(kind, row(kind, {}, { tone: 'warn' }))).toEqual(['attention', 'incomplete']);
      expect(ids(kind, row(kind, {}, { tone: 'muted' }))).toEqual(['zero']);
    }
  });
  it('jobs', () => {
    expect(ids('jobs', row('jobs', { status: 'Failed' }, { tone: 'bad' }))).toEqual(['attention', 'failed']);
    expect(ids('jobs', row('jobs', { status: 'Complete' }))).toEqual(['success']);
    expect(ids('jobs', row('jobs', { status: 'Running' }, { tone: 'warn' }))).toEqual(['attention', 'running']);
    expect(ids('jobs', row('jobs', { status: 'Pending' }, { tone: 'warn' }))).toEqual(['attention', 'running']);
    expect(ids('jobs', row('jobs', { status: 'Suspended' }, { tone: 'muted' }))).toEqual([]);
  });
  it('cronjobs and ingresses', () => {
    expect(ids('cronjobs', row('cronjobs', {}))).toEqual(['active']);
    expect(ids('cronjobs', row('cronjobs', {}, { suspended: true }))).toEqual(['suspended']);
    expect(CHIPS.ingresses).toEqual([]);
  });
  it('services', () => {
    expect(ids('services', row('services', { type: 'NodePort', clusterIp: '10.0.0.1' }, { selector: { app: 'a' } }))).toEqual(['nodeport']);
    expect(ids('services', row('services', { type: 'ClusterIP', clusterIp: 'None' }))).toEqual(['clusterip', 'headless', 'noselector']);
    expect(ids('services', row('services', { type: 'LoadBalancer' }, { selector: { a: 'b' } }))).toEqual(['loadbalancer']);
    expect(ids('services', row('services', { type: 'ExternalName' }, { selector: { a: 'b' } }))).toEqual(['externalname']);
  });
  it('nodes', () => {
    expect(ids('nodes', row('nodes', { status: 'Ready', roles: 'worker' }, { pressure: [] }))).toEqual([]);
    expect(ids('nodes', row('nodes', { status: 'NotReady,SchedulingDisabled', roles: 'control-plane,etcd' },
      { tone: 'bad', unschedulable: true, pressure: ['DiskPressure'] }))).toEqual(['attention', 'notready', 'cordoned', 'pressure', 'controlplane']);
    expect(ids('nodes', row('nodes', { status: 'Ready', roles: 'master' }))).toEqual(['controlplane']);
    expect(ids('nodes', row('nodes', { status: 'Ready', roles: 'control-planes' }))).toEqual([]);
  });
  it('events with time chips', () => {
    const at = (offsetMs: number, type = 'Normal'): KubeRow => row('events', { type, last: new Date(NOW - offsetMs).toISOString() });
    expect(ids('events', at(4 * 60000, 'Warning'))).toEqual(['warning', '5m', '15m']);
    expect(ids('events', at(5 * 60000))).toEqual(['normal', '5m', '15m']);
    expect(ids('events', at(10 * 60000))).toEqual(['normal', '15m']);
    expect(ids('events', at(16 * 60000))).toEqual(['normal']);
    expect(ids('events', at(-60000))).toEqual(['normal', '5m', '15m']);
    expect(ids('events', row('events', { type: 'Normal' }))).toEqual(['normal']);
    expect(ids('events', row('events', { type: 'Normal', last: 'garbage' }))).toEqual(['normal']);
  });
});

describe('attentionChip and primaryChip', () => {
  it('names the attention chip', () => {
    expect(attentionChip('pods')).toBe('attention');
    expect(attentionChip('nodes')).toBe('attention');
    expect(attentionChip('events')).toBe('warning');
    for (const kind of ['cronjobs', 'services', 'ingresses'] as const) expect(attentionChip(kind)).toBeNull();
  });
  it('picks the row-menu chip', () => {
    expect(primaryChip('pods', pod('CrashLoopBackOff'), NOW)?.id).toBe('failed');
    expect(primaryChip('jobs', row('jobs', { status: 'Complete' }), NOW)?.id).toBe('success');
    expect(primaryChip('services', row('services', { type: 'NodePort' }), NOW)?.id).toBe('nodeport');
    expect(primaryChip('events', row('events', { type: 'Warning' }), NOW)?.id).toBe('warning');
    expect(primaryChip('nodes', row('nodes', { status: 'Ready', roles: '' }, { unschedulable: true, pressure: ['MemoryPressure'] }), NOW)?.id).toBe('pressure');
    expect(primaryChip('nodes', row('nodes', { status: 'Ready', roles: '' }, { pressure: [] }), NOW)).toBeUndefined();
    expect(primaryChip('deployments', row('deployments', {}), NOW)).toBeUndefined();
    expect(primaryChip('pods', pod('Foo'), NOW)?.id).toBe('failed');
  });
});

describe('knownChips', () => {
  it('keeps known ids, deduplicated, in CHIPS order', () => {
    expect(knownChips('pods', ['restarts', 'bogus', 'failed', 'restarts', 'attention'])).toEqual(['attention', 'failed', 'restarts']);
    expect(knownChips('ingresses', ['attention'])).toEqual([]);
  });
});

describe('compileChips', () => {
  const rows = [pod('Running'), pod('Pending'), pod('CrashLoopBackOff', { restarts: 3 }), pod('Completed')];
  const names = (active: string[]): string[] => rows.filter(compileChips('pods', active, NOW)).map(r => String(r.cells.status));
  it('matches everything without ids and ignores unknown ids', () => {
    expect(names([])).toHaveLength(4);
    expect(names(['bogus'])).toHaveLength(4);
  });
  it('ORs within a group', () => {
    expect(names(['waiting', 'failed'])).toEqual(['Pending', 'CrashLoopBackOff']);
  });
  it('ANDs between groups', () => {
    expect(names(['waiting', 'failed', 'restarts'])).toEqual(['CrashLoopBackOff']);
    expect(names(['running', 'restarts'])).toEqual([]);
    expect(names(['attention', 'failed'])).toEqual(['CrashLoopBackOff']);
  });
});

describe('chipCounts', () => {
  it('has every id including zero and counts the given rows only', () => {
    const rows = [pod('Running'), pod('Running'), pod('CrashLoopBackOff')];
    const counts = chipCounts('pods', rows, NOW);
    expect(Object.keys(counts)).toEqual(CHIPS.pods.map(c => c.id));
    expect(counts).toMatchObject({ attention: 1, running: 2, failed: 1, waiting: 0, completed: 0 });
    expect(chipCounts('ingresses', rows, NOW)).toEqual({});
    for (const kind of KUBE_KINDS) expect(Object.keys(chipCounts(kind, [], NOW))).toEqual(CHIPS[kind].map(c => c.id));
  });
});
