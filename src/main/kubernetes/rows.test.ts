import { describe, it, expect } from 'vitest';
import { toRow, toNodeTile, podStatus, parseCpu, parseMemory } from './rows';

const pod = (status: object, spec: object = { containers: [{ name: 'api' }], nodeName: 'worker2' }) =>
  ({ metadata: { name: 'api-1', namespace: 'shop', uid: 'u1', creationTimestamp: '2026-10-16T08:00:00Z', labels: { app: 'api' } }, spec, status });

describe('pods', () => {
  it('maps a running pod', () => {
    const row = toRow('pods', pod({ phase: 'Running', containerStatuses: [{ name: 'api', ready: true, restartCount: 0, state: { running: {} } }] }));
    expect(row).toMatchObject({ uid: 'u1', ref: { kind: 'pods', namespace: 'shop', name: 'api-1' }, tone: 'ok', node: 'worker2', containers: ['api'],
      cells: { name: 'api-1', ready: '1/1', status: 'Running', restarts: 0, node: 'worker2', age: '2026-10-16T08:00:00Z' } });
  });

  it('shows the waiting reason of a crashing container', () => {
    const row = toRow('pods', pod({ phase: 'Running', containerStatuses: [{ name: 'api', ready: false, restartCount: 14, state: { waiting: { reason: 'CrashLoopBackOff' } } }] }));
    expect(row).toMatchObject({ tone: 'bad', cells: { ready: '0/1', status: 'CrashLoopBackOff', restarts: 14 } });
  });

  it('handles a freshly scheduled pod without statuses', () => {
    expect(toRow('pods', pod({ phase: 'Pending' }, { containers: [{ name: 'a' }, { name: 'b' }] })))
      .toMatchObject({ tone: 'warn', cells: { ready: '0/2', status: 'Pending', restarts: 0 } });
  });

  it('shows Terminating for pods with deletionTimestamp and Completed for succeeded pods', () => {
    const base = pod({ phase: 'Running', containerStatuses: [{ name: 'api', ready: true, restartCount: 0, state: { running: {} } }] });
    const terminating = { ...base, metadata: { ...base.metadata, deletionTimestamp: '2026-10-16T09:30:00Z' } };
    expect(toRow('pods', terminating)).toMatchObject({ tone: 'muted', cells: { status: 'Terminating' } });

    const succeeded = pod({ phase: 'Succeeded', containerStatuses: [{ name: 'api', ready: false, restartCount: 0, state: { terminated: { reason: 'Completed', exitCode: 0 } } }] });
    expect(toRow('pods', succeeded)).toMatchObject({ tone: 'muted', cells: { ready: '0/1', status: 'Completed' } });
  });

  it('shows the terminated reason of a failed container and marks it bad', () => {
    const row = toRow('pods', pod({ phase: 'Failed', containerStatuses: [{ name: 'api', ready: false, restartCount: 2, state: { terminated: { reason: 'OOMKilled' } } }] }));
    expect(row).toMatchObject({ tone: 'bad', cells: { status: 'OOMKilled', restarts: 2 } });
  });

  it('warns for a running pod that is not fully ready', () => {
    const row = toRow('pods', pod({ phase: 'Running', containerStatuses: [{ name: 'a', ready: true, restartCount: 1 }, { name: 'b', ready: false, restartCount: 0 }] },
      { containers: [{ name: 'a' }, { name: 'b' }], nodeName: 'worker1' }));
    expect(row).toMatchObject({ tone: 'warn', cells: { ready: '1/2', status: 'Running', restarts: 1 } });
  });

  it('podStatus sums restarts and reports the ready count', () => {
    expect(podStatus(pod({ phase: 'Running', containerStatuses: [{ name: 'api', ready: true, restartCount: 3 }] })))
      .toEqual({ ready: '1/1', status: 'Running', restarts: 3, tone: 'ok' });
  });
});

describe('workloads', () => {
  it('maps a deployment with selector and replicas', () => {
    const row = toRow('deployments', { metadata: { name: 'api', namespace: 'shop', uid: 'd1', creationTimestamp: '2026-10-01T00:00:00Z' },
      spec: { replicas: 3, selector: { matchLabels: { app: 'api' } }, template: { spec: { containers: [{ image: 'harbor/shop/api:2.4.1' }] } } },
      status: { readyReplicas: 2, updatedReplicas: 3 } });
    expect(row).toMatchObject({ tone: 'warn', replicas: 3, selector: { app: 'api' }, cells: { ready: '2/3', upToDate: 3, image: 'harbor/shop/api:2.4.1' } });
  });

  it('marks a deployment with zero replicas as muted', () => {
    expect(toRow('deployments', { metadata: { name: 'api', namespace: 'shop', uid: 'd2' }, spec: { replicas: 0, template: { spec: { containers: [] } } }, status: {} }))
      .toMatchObject({ tone: 'muted', replicas: 0, cells: { ready: '0/0' } });
  });

  it('maps a statefulset with replicas and selector', () => {
    const row = toRow('statefulsets', { metadata: { name: 'db', namespace: 'shop', uid: 's1' },
      spec: { replicas: 2, selector: { matchLabels: { app: 'db' } }, template: { spec: { containers: [{ image: 'postgres:16' }, { image: 'exporter:1' }] } } },
      status: { readyReplicas: 2, updatedReplicas: 2 } });
    expect(row).toMatchObject({ tone: 'ok', replicas: 2, selector: { app: 'db' }, cells: { ready: '2/2', upToDate: 2, image: 'postgres:16,exporter:1' } });
  });

  it('maps a daemonset with scheduled and ready counts', () => {
    const row = toRow('daemonsets', { metadata: { name: 'agent', namespace: 'kube-system', uid: 'ds1' },
      spec: { selector: { matchLabels: { app: 'agent' } }, template: { spec: { containers: [{ image: 'agent:3' }] } } },
      status: { desiredNumberScheduled: 4, numberReady: 3, updatedNumberScheduled: 4 } });
    expect(row).toMatchObject({ tone: 'warn', selector: { app: 'agent' }, cells: { ready: '3/4', upToDate: 4, image: 'agent:3' } });
  });

  it('maps a job with completions and last run', () => {
    expect(toRow('jobs', { metadata: { name: 'migrate', namespace: 'shop', uid: 'j1', creationTimestamp: '2026-10-16T07:00:00Z' },
      spec: { completions: 1 }, status: { succeeded: 1, startTime: '2026-10-16T07:00:00Z', completionTime: '2026-10-16T07:02:00Z' } }))
      .toMatchObject({ tone: 'ok', cells: { completions: '1/1', lastRun: '2026-10-16T07:02:00Z' } });
  });

  it('gives a job the selector of its pods and a pod the image of each container', () => {
    expect(toRow('jobs', { metadata: { name: 'migrate', namespace: 'shop', uid: 'j1' }, spec: { selector: { matchLabels: { 'controller-uid': 'abc' } } }, status: {} }))
      .toMatchObject({ selector: { 'controller-uid': 'abc' } });
    expect(toRow('jobs', { metadata: { name: 'plain', namespace: 'shop', uid: 'j3' }, spec: {}, status: {} })?.selector).toBeUndefined();
    const row = toRow('pods', pod({ phase: 'Running' }, { containers: [{ name: 'api', image: 'reg/api:1' }, { name: 'proxy', image: 'envoy:2' }], nodeName: 'w' }));
    expect(row?.cells).toMatchObject({ 'image:api': 'reg/api:1', 'image:proxy': 'envoy:2' });
  });

  it('falls back to startTime for a job without completionTime', () => {
    expect(toRow('jobs', { metadata: { name: 'backup', namespace: 'shop', uid: 'j2' }, spec: {}, status: { startTime: '2026-10-16T06:00:00Z', failed: 1 } }))
      .toMatchObject({ tone: 'bad', cells: { completions: '0/1', lastRun: '2026-10-16T06:00:00Z' } });
  });

  it('maps a cronjob with schedule and last schedule time', () => {
    expect(toRow('cronjobs', { metadata: { name: 'nightly', namespace: 'shop', uid: 'c1' }, spec: { schedule: '0 2 * * *' },
      status: { lastScheduleTime: '2026-10-16T02:00:00Z' } }))
      .toMatchObject({ tone: 'ok', cells: { schedule: '0 2 * * *', lastRun: '2026-10-16T02:00:00Z' } });
  });
});

describe('services and ingresses', () => {
  it('maps a service with ports and selector', () => {
    expect(toRow('services', { metadata: { name: 'web', namespace: 'shop', uid: 'sv1' },
      spec: { type: 'LoadBalancer', clusterIP: '10.43.0.12', selector: { app: 'web' }, ports: [{ port: 80, protocol: 'TCP' }, { port: 443 }] } }))
      .toMatchObject({ selector: { app: 'web' }, cells: { type: 'LoadBalancer', clusterIp: '10.43.0.12', ports: '80/TCP,443/TCP' } });
  });

  it('maps an ingress with hosts and address', () => {
    expect(toRow('ingresses', { metadata: { name: 'shop', namespace: 'shop', uid: 'i1' },
      spec: { rules: [{ host: 'shop.example.de' }, { host: 'api.example.de' }] },
      status: { loadBalancer: { ingress: [{ ip: '192.168.1.20' }, { hostname: 'lb.example.de' }] } } }))
      .toMatchObject({ cells: { hosts: 'shop.example.de,api.example.de', address: '192.168.1.20,lb.example.de' } });
  });
});

describe('nodes', () => {
  it('maps nodes with roles and readiness', () => {
    const node = { metadata: { name: 'k8s-cp1', uid: 'n1', labels: { 'node-role.kubernetes.io/control-plane': '' } },
      status: { conditions: [{ type: 'Ready', status: 'True' }, { type: 'DiskPressure', status: 'True' }], allocatable: { cpu: '4', memory: '8Gi' }, nodeInfo: { kubeletVersion: 'v1.31.2' } } };
    expect(toRow('nodes', node)).toMatchObject({ ref: { kind: 'nodes', name: 'k8s-cp1' }, tone: 'warn', cells: { status: 'Ready', roles: 'control-plane', version: 'v1.31.2' } });
    expect(toNodeTile(node, { cpuMilli: 1000, memoryBytes: 4 * 1024 ** 3 })).toEqual({ name: 'k8s-cp1', ready: true, roles: ['control-plane'],
      pressure: ['DiskPressure'], unschedulable: false, cpu: 0.25, memory: 0.5 });
  });

  it('marks a not-ready node as bad and an unschedulable node as warn', () => {
    expect(toRow('nodes', { metadata: { name: 'w1', uid: 'n2' }, status: { conditions: [{ type: 'Ready', status: 'False' }] } }))
      .toMatchObject({ tone: 'bad', cells: { status: 'NotReady', roles: '—' } });
    expect(toRow('nodes', { metadata: { name: 'w2', uid: 'n3' }, spec: { unschedulable: true },
      status: { conditions: [{ type: 'Ready', status: 'True' }] } }))
      .toMatchObject({ tone: 'warn', cells: { status: 'Ready,SchedulingDisabled' } });
  });

  it('leaves out usage fields in the tile without metrics', () => {
    const tile = toNodeTile({ metadata: { name: 'w1' }, status: { conditions: [{ type: 'Ready', status: 'True' }], allocatable: { cpu: '2' } } });
    expect(tile).toEqual({ name: 'w1', ready: true, roles: [], pressure: [], unschedulable: false });
    expect('cpu' in tile).toBe(false);
    expect('memory' in tile).toBe(false);
  });
});

describe('events', () => {
  it('maps events with the involved object', () => {
    expect(toRow('events', { metadata: { name: 'e1', namespace: 'shop', uid: 'e1' }, type: 'Warning', reason: 'BackOff', count: 7,
      involvedObject: { kind: 'Pod', name: 'api-1' }, message: 'Back-off restarting', lastTimestamp: '2026-10-16T09:00:00Z' }))
      .toMatchObject({ tone: 'warn', cells: { type: 'Warning', reason: 'BackOff', object: 'Pod/api-1', count: 7, last: '2026-10-16T09:00:00Z' } });
  });

  it('treats Normal events as muted and falls back to eventTime and series count', () => {
    expect(toRow('events', { metadata: { name: 'e2', namespace: 'shop', uid: 'e2' }, type: 'Normal', reason: 'Pulled',
      involvedObject: { kind: 'Pod', name: 'api-1' }, eventTime: '2026-10-16T09:10:00Z', series: { count: 4 } }))
      .toMatchObject({ tone: 'muted', cells: { count: 4, last: '2026-10-16T09:10:00Z' } });
  });
});

describe('quantities', () => {
  it('parses cpu quantities', () => {
    expect(parseCpu('250m')).toBe(250);
    expect(parseCpu('2')).toBe(2000);
    expect(parseCpu('1500n')).toBeCloseTo(0.0015);
    expect(parseCpu('500u')).toBe(0.5);
    expect(parseCpu(undefined)).toBe(0);
    expect(parseCpu('abc')).toBe(0);
  });

  it('parses memory quantities', () => {
    expect(parseMemory('128Mi')).toBe(128 * 1024 ** 2);
    expect(parseMemory('1G')).toBe(1e9);
    expect(parseMemory('1024')).toBe(1024);
    expect(parseMemory('2k')).toBe(2000);
    expect(parseMemory(undefined)).toBe(0);
    expect(parseMemory('lots')).toBe(0);
  });
});

describe('invalid objects', () => {
  it('returns null for objects without name or uid', () => {
    expect(toRow('pods', { metadata: {} })).toBeNull();
    expect(toRow('pods', { metadata: { name: 'x' } })).toBeNull();
  });
});
