import { describe, expect, it } from 'vitest';
import type { KubeMeta, KubeObject } from './api';
import { detectProblems } from './problems';

const NOW = Date.parse('2026-10-16T10:00:00Z');
const MIN = 60_000;

interface PodOptions { namespace?: string; phase?: string; created?: number; deleting?: boolean; containers?: object[] }

function pod(name: string, options: PodOptions = {}): KubeObject {
  const meta = {
    name, namespace: options.namespace ?? 'shop',
    creationTimestamp: new Date(options.created ?? NOW - 60 * MIN).toISOString(),
    ...(options.deleting ? { deletionTimestamp: new Date(NOW).toISOString() } : {}),
  } as KubeMeta;
  return {
    apiVersion: 'v1', kind: 'Pod', metadata: meta,
    status: { phase: options.phase ?? 'Running', containerStatuses: options.containers ?? [{ name: 'app', restartCount: 0, state: { running: {} } }] },
  };
}

const waiting = (reason: string, restartCount = 0) => ({ name: 'app', restartCount, state: { waiting: { reason } } });
const oomTerminated = (minutesAgo: number) => ({
  name: 'app', restartCount: 3, state: { running: {} },
  lastState: { terminated: { reason: 'OOMKilled', finishedAt: new Date(NOW - minutesAgo * MIN).toISOString() } },
});

interface NodeOptions { ready?: string; pressure?: string[] }
function node(name: string, options: NodeOptions = {}): KubeObject {
  const conditions = [
    { type: 'Ready', status: options.ready ?? 'True' },
    ...['MemoryPressure', 'DiskPressure', 'PIDPressure'].map(type => ({ type, status: options.pressure?.includes(type) ? 'True' : 'False' })),
  ];
  return { apiVersion: 'v1', kind: 'Node', metadata: { name } as KubeMeta, status: { conditions } };
}

describe('detectProblems', () => {
  it('flags CrashLoopBackOff', () => {
    const problems = detectProblems([pod('api-1', { containers: [waiting('CrashLoopBackOff', 14)] })], [], NOW);
    expect(problems).toEqual([{
      id: 'crashloop:pods/shop/api-1',
      kind: 'crashloop',
      ref: { kind: 'pods', namespace: 'shop', name: 'api-1' },
      message: 'api-1 crasht (CrashLoopBackOff, 14 Neustarts)',
    }]);
  });

  it('flags OOMKilled within 60 minutes only', () => {
    const recent = detectProblems([pod('api-1', { containers: [oomTerminated(59)] })], [], NOW);
    expect(recent).toEqual([{
      id: 'oomkilled:pods/shop/api-1',
      kind: 'oomkilled',
      ref: { kind: 'pods', namespace: 'shop', name: 'api-1' },
      message: 'api-1 wurde wegen Speichermangel beendet (OOMKilled)',
    }]);

    expect(detectProblems([pod('api-1', { containers: [oomTerminated(61)] })], [], NOW)).toEqual([]);
  });

  it('flags image pull failures', () => {
    for (const reason of ['ImagePullBackOff', 'ErrImagePull', 'InvalidImageName']) {
      const problems = detectProblems([pod('api-1', { containers: [waiting(reason)] })], [], NOW);
      expect(problems).toEqual([{
        id: 'image:pods/shop/api-1',
        kind: 'image',
        ref: { kind: 'pods', namespace: 'shop', name: 'api-1' },
        message: `api-1: Image kann nicht geladen werden (${reason})`,
      }]);
    }
  });

  it('flags pods pending longer than five minutes', () => {
    expect(detectProblems([pod('api-1', { phase: 'Pending', created: NOW - 5 * MIN })], [], NOW)).toEqual([]);

    const problems = detectProblems([pod('api-1', { phase: 'Pending', created: NOW - 5 * MIN - 1000 })], [], NOW);
    expect(problems).toEqual([{
      id: 'pending:pods/shop/api-1',
      kind: 'pending',
      ref: { kind: 'pods', namespace: 'shop', name: 'api-1' },
      message: 'api-1 wartet seit 5 min (Pending)',
    }]);
  });

  it('flags nodes that are not ready or under pressure', () => {
    const notReady = detectProblems([], [node('k8s-worker2', { ready: 'False' })], NOW);
    expect(notReady).toEqual([{
      id: 'node:nodes//k8s-worker2',
      kind: 'node',
      ref: { kind: 'nodes', name: 'k8s-worker2' },
      message: 'k8s-worker2 ist nicht bereit',
    }]);

    const pressure = detectProblems([], [node('k8s-worker2', { pressure: ['MemoryPressure'] })], NOW);
    expect(pressure).toEqual([{
      id: 'node:nodes//k8s-worker2',
      kind: 'node',
      ref: { kind: 'nodes', name: 'k8s-worker2' },
      message: 'k8s-worker2: MemoryPressure',
    }]);

    expect(detectProblems([], [node('k8s-worker2')], NOW)).toEqual([]);
  });

  it('reports one problem per pod, crashloop before oomkilled, and sorts nodes first', () => {
    const crashing = pod('zeta', { containers: [waiting('CrashLoopBackOff', 2), oomTerminated(5)] });
    const pending = pod('beta', { phase: 'Pending', created: NOW - 10 * MIN });
    const otherNamespace = pod('alpha', { namespace: 'auth', containers: [waiting('ErrImagePull')] });
    const problems = detectProblems(
      [crashing, pending, otherNamespace],
      [node('k8s-worker2', { ready: 'False' }), node('k8s-worker1', { pressure: ['DiskPressure'] })],
      NOW,
    );

    expect(problems.map(p => p.id)).toEqual([
      'node:nodes//k8s-worker1',
      'node:nodes//k8s-worker2',
      'image:pods/auth/alpha',
      'pending:pods/shop/beta',
      'crashloop:pods/shop/zeta',
    ]);
    expect(problems.filter(p => p.ref.name === 'zeta')).toHaveLength(1);
    expect(problems.find(p => p.ref.name === 'zeta')?.kind).toBe('crashloop');
  });

  it('ignores terminating pods', () => {
    const terminating = pod('api-1', { deleting: true, phase: 'Pending', created: NOW - 60 * MIN, containers: [waiting('CrashLoopBackOff', 5)] });
    expect(detectProblems([terminating], [], NOW)).toEqual([]);
  });
});
