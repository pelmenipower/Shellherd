import { describe, expect, it } from 'vitest';
import { DIAGNOSE_MAX_CHARS, type KubeKind, type KubeRef, type KubeSelector } from '../../shared/kubernetes';
import { KubeApiError, type KubeApi, type KubeObject, type ListResult, type LogReadOptions, type LogReadTarget } from './api';
import { DIAGNOSE_BUDGET, buildDiagnosis, headOf, logText, problemContainers, tailOf } from './diagnose';

const forbidden = (): never => { throw new Error('forbidden in diagnose'); };

/** Records every call; any method that could write, watch, open a stream or ask RBAC throws. */
class RecordingApi implements KubeApi {
  calls: string[] = [];
  objects = new Map<string, KubeObject>();
  events: KubeObject[] = [];
  pods: KubeObject[] = [];
  logs: (target: LogReadTarget, options: LogReadOptions) => string = () => 'log line\n';
  failures = new Map<string, KubeApiError>();

  async read(ref: KubeRef): Promise<KubeObject> {
    const key = `${ref.kind}/${ref.namespace ?? ''}/${ref.name}`;
    this.calls.push(`read ${key}`);
    const failure = this.failures.get(`read ${key}`);
    if (failure) throw failure;
    const object = this.objects.get(key);
    if (!object) throw new KubeApiError('Not found', 404);
    return object;
  }
  async list(kind: KubeKind, namespace: string | null, selector?: KubeSelector): Promise<ListResult> {
    this.calls.push(`list ${kind}/${namespace ?? ''}/${JSON.stringify(selector ?? {})}`);
    return { items: this.pods, resourceVersion: '1' };
  }
  async eventsFor(ref: KubeRef): Promise<KubeObject[]> {
    this.calls.push(`events ${ref.kind}/${ref.name}`);
    return this.events;
  }
  async readLog(target: LogReadTarget, options: LogReadOptions): Promise<string> {
    const key = `log ${target.pod}/${target.container}/${options.previous ? 'previous' : 'current'}`;
    this.calls.push(key);
    expect(options).toMatchObject({ tailLines: 100, limitBytes: 64 * 1024 });
    const failure = this.failures.get(key);
    if (failure) throw failure;
    return this.logs(target, options);
  }
  watch = forbidden;
  mergePatch = forbidden;
  remove = forbidden;
  createJobFrom = forbidden;
  nodeMetrics = forbidden;
  podMetrics = forbidden;
  openTerminal = forbidden;
  portForward = forbidden;
  followLog = forbidden;
  rulesReview = forbidden;
}

const POD: KubeRef = { kind: 'pods', namespace: 'shop', name: 'checkout-7f9c6b8d4-m2n5z' };
const EVENT: KubeRef = { kind: 'events', namespace: 'shop', name: 'checkout-7f9c6b8d4-m2n5z.1' };
const DEPLOYMENT: KubeRef = { kind: 'deployments', namespace: 'shop', name: 'checkout' };

function crashPod(name = POD.name, restarts = 14, ready = false): KubeObject {
  return {
    apiVersion: 'v1', kind: 'Pod',
    metadata: {
      name, namespace: 'shop', creationTimestamp: new Date('2026-10-23T08:00:00Z'),
      labels: { app: 'checkout', 'pod-template-hash': '7f9c6b8d4' },
      annotations: { 'kubectl.kubernetes.io/last-applied-configuration': '{"env":[{"name":"DB_PASSWORD","value":"Synth-Annotation-3"}]}' },
      managedFields: [{ manager: 'managed-marker' }],
      ownerReferences: [{ kind: 'ReplicaSet', name: 'checkout-7f9c6b8d4', controller: true } as { kind: string; name: string }],
    },
    spec: {
      nodeName: 'w1',
      imagePullSecrets: [{ name: 'Synth-Pull-Secret' }],
      containers: [{
        name: 'main', image: 'registry.local/shop/checkout:1.9.0',
        env: [
          { name: 'DB_HOST', value: 'db' },
          { name: 'DB_PASSWORD', value: 'Synth-Literal-1' },
          { name: 'JWT_SIGNING_KEY', value: 'Synth-Literal-2' },
          { name: 'DB_SECRET', valueFrom: { secretKeyRef: { name: 'checkout-db', key: 'password' } } },
        ],
        envFrom: [{ secretRef: { name: 'checkout-env' } }, { configMapRef: { name: 'checkout-config' } }],
      }],
      volumes: [{ name: 'tls', secret: { secretName: 'tls' } }],
    },
    status: {
      phase: 'Running',
      conditions: [{ type: 'Ready', status: ready ? 'True' : 'False' }],
      containerStatuses: [{
        name: 'main', ready, restartCount: restarts,
        state: restarts > 0 ? { waiting: { reason: 'CrashLoopBackOff' } } : { running: { startedAt: new Date('2026-10-25T08:00:00Z') } },
        ...(restarts > 0 ? { lastState: { terminated: { reason: 'Error', exitCode: 1, finishedAt: new Date('2026-10-25T07:55:02Z') } } } : {}),
      }],
    },
  };
}

function setup(pod = crashPod()): RecordingApi {
  const api = new RecordingApi();
  api.objects.set('pods/shop/checkout-7f9c6b8d4-m2n5z', pod);
  api.objects.set('deployments/shop/checkout', {
    apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name: 'checkout', namespace: 'shop', annotations: { 'deployment.kubernetes.io/revision': 'Synth-Annotation-4' } },
    spec: { replicas: 1, selector: { matchLabels: { app: 'checkout' } }, template: { spec: { containers: [{ name: 'main', image: 'registry.local/shop/checkout:1.9.0' }] } } },
    status: { readyReplicas: 0 },
  });
  api.objects.set('nodes//w1', { kind: 'Node', metadata: { name: 'w1' }, spec: {}, status: { conditions: [{ type: 'Ready', status: 'True' }], nodeInfo: { kubeletVersion: 'v1.31.4' } } });
  api.objects.set('events/shop/checkout-7f9c6b8d4-m2n5z.1', { kind: 'Event', metadata: { name: EVENT.name }, type: 'Warning', reason: 'BackOff', message: 'Back-off restarting failed container', count: 14, lastTimestamp: new Date('2026-10-25T08:00:00Z') });
  api.events = [{ kind: 'Event', type: 'Warning', reason: 'BackOff', message: 'Back-off restarting failed container', count: 14, lastTimestamp: '2026-10-25T08:00:00Z' }];
  return api;
}

const ids = (parts: { id: string }[]): string[] => parts.map(part => part.id);

describe('buildDiagnosis: calls', () => {
  it('reads only: get on the pod, owner, node and event, list on events, get on pods/log; never a ReplicaSet, Secret or ConfigMap', async () => {
    const api = setup();
    await buildDiagnosis(api, POD, EVENT);
    expect([...api.calls].sort()).toEqual([
      'events pods/checkout-7f9c6b8d4-m2n5z',
      'log checkout-7f9c6b8d4-m2n5z/main/current',
      'log checkout-7f9c6b8d4-m2n5z/main/previous',
      'read deployments/shop/checkout',
      'read events/shop/checkout-7f9c6b8d4-m2n5z.1',
      'read nodes//w1',
      'read pods/shop/checkout-7f9c6b8d4-m2n5z',
    ]);
  });

  it('refuses kinds it does not analyse and an event that is no event, before any call', async () => {
    const api = setup();
    await expect(buildDiagnosis(api, { kind: 'services', namespace: 'shop', name: 'x' })).rejects.toThrow();
    await expect(buildDiagnosis(api, { kind: 'pods', name: 'x' })).rejects.toThrow();
    await expect(buildDiagnosis(api, POD, { kind: 'pods', namespace: 'shop', name: 'x' })).rejects.toThrow();
    expect(api.calls).toEqual([]);
  });

  it('rejects when the object itself cannot be read', async () => {
    const api = setup();
    api.objects.delete('pods/shop/checkout-7f9c6b8d4-m2n5z');
    await expect(buildDiagnosis(api, POD)).rejects.toMatchObject({ code: 404 });
  });
});

describe('buildDiagnosis: secrets stay out', () => {
  it('keeps references as references, hides secret-like literals and drops annotations, managedFields and pull secrets', async () => {
    const { text } = await buildDiagnosis(setup(), POD);
    for (const needle of ['DB_HOST: db', 'DB_PASSWORD: <hidden>', 'JWT_SIGNING_KEY: <hidden>', 'DB_SECRET: <Secret checkout-db/password>',
      'Env from: <Secret checkout-env>, <ConfigMap checkout-config>', 'tls (Secret tls)']) expect(text).toContain(needle);
    for (const leak of ['Synth-Literal-1', 'Synth-Literal-2', 'Synth-Annotation-3', 'Synth-Annotation-4', 'managed-marker', 'last-applied', 'Synth-Pull-Secret']) expect(text).not.toContain(leak);
  });

  it('writes dates as ISO 8601, never in the local time zone', async () => {
    const { text } = await buildDiagnosis(setup(), POD, EVENT);
    expect(text).toContain('Created: 2026-10-23T08:00:00.000Z');
    expect(text).toContain('finished 2026-10-25T07:55:02.000Z');
    expect(text).toContain('2026-10-25T08:00:00.000Z Warning BackOff (x14)');
    expect(text).not.toMatch(/GMT/);
  });
});

describe('buildDiagnosis: parts', () => {
  it('lists the pod parts in order; the owner is the Deployment from the pod-template-hash', async () => {
    const result = await buildDiagnosis(setup(), POD);
    expect(ids(result.parts)).toEqual(['object', 'events', 'logs', 'previousLogs', 'owner', 'node']);
    expect(result.parts.find(part => part.id === 'owner')?.name).toBe('Deployment checkout');
    expect(result.parts.find(part => part.id === 'previousLogs')?.name).toBe('checkout-7f9c6b8d4-m2n5z/main');
    expect(result.text).toContain('## Logs checkout-7f9c6b8d4-m2n5z/main (previous container, last 100 lines)');
  });

  it('starts with the trigger event', async () => {
    const result = await buildDiagnosis(setup(), POD, EVENT);
    expect(ids(result.parts)[0]).toBe('trigger');
    expect(result.text.startsWith('## Trigger event\n')).toBe(true);
  });

  it('reads the current log of the first container of a healthy pod, no previous one', async () => {
    const api = setup(crashPod(POD.name, 0, true));
    const result = await buildDiagnosis(api, POD);
    expect(ids(result.parts)).toEqual(['object', 'events', 'logs', 'owner', 'node']);
    expect(api.calls.filter(call => call.startsWith('log '))).toEqual(['log checkout-7f9c6b8d4-m2n5z/main/current']);
  });

  it('names a part it may not read and keeps the others', async () => {
    const api = setup();
    api.failures.set('log checkout-7f9c6b8d4-m2n5z/main/current', new KubeApiError('Forbidden', 403));
    api.failures.set('log checkout-7f9c6b8d4-m2n5z/main/previous', new KubeApiError('No previous container', 400));
    api.failures.set('read deployments/shop/checkout', new KubeApiError('Not found', 404));
    const result = await buildDiagnosis(api, POD);
    expect(ids(result.parts)).toEqual(['object', 'events', 'logs', 'previousLogs', 'owner', 'node']);
    expect(result.parts.find(part => part.id === 'logs')).toEqual({ id: 'logs', name: 'checkout-7f9c6b8d4-m2n5z/main', chars: 0, missing: 'forbidden' });
    expect(result.parts.find(part => part.id === 'previousLogs')?.missing).toBe('none');
    expect(result.parts.find(part => part.id === 'owner')?.missing).toBe('notFound');
    expect(result.text).toContain('(not readable: forbidden by RBAC)');
    expect(result.parts.find(part => part.id === 'node')?.missing).toBeUndefined();
  });

  it('analyses a workload through its worst pod', async () => {
    const api = setup();
    api.pods = [crashPod('checkout-b', 0, true), crashPod('checkout-a', 3), crashPod(POD.name, 14), ...['c', 'd', 'e', 'f'].map(name => crashPod(`checkout-${name}`, 0, true))];
    const result = await buildDiagnosis(api, DEPLOYMENT);
    expect(ids(result.parts)).toEqual(['object', 'events', 'pods', 'podEvents', 'logs', 'previousLogs']);
    expect(api.calls).toContain('list pods/shop/{"labels":{"app":"checkout"}}');
    expect(result.parts.find(part => part.id === 'podEvents')?.name).toBe(POD.name);
    const pods = result.text.split('## Pods (worst first, at most 5)\n')[1].split('\n\n')[0].split('\n');
    expect(pods).toHaveLength(5);
    expect(pods[0].startsWith(`${POD.name}  Running  ready 0/1  restarts 14`)).toBe(true);
    expect(result.text).not.toContain('Synth-Annotation-4');
  });

  it('does not list pods of a workload without matchLabels', async () => {
    const api = setup();
    api.objects.set('deployments/shop/checkout', { kind: 'Deployment', metadata: { name: 'checkout', namespace: 'shop' }, spec: {}, status: {} });
    const result = await buildDiagnosis(api, DEPLOYMENT);
    expect(api.calls.some(call => call.startsWith('list '))).toBe(false);
    expect(result.text).toContain('## Pods (worst first, at most 5)\n<none>');
  });
});

describe('buildDiagnosis: budget', () => {
  it('stays below DIAGNOSE_MAX_CHARS with huge logs, events and env, keeping the newest log line and the newest event', async () => {
    const pod = crashPod();
    const spec = pod.spec as { containers: { env: unknown[] }[] };
    spec.containers[0].env = Array.from({ length: 50 }, (_, i) => ({ name: `VAR_${i}`, value: `value-${i}-${'x'.repeat(80)}` }));
    const api = setup(pod);
    api.events = Array.from({ length: 200 }, (_, i) => ({ type: 'Warning', reason: `R${i}`, message: `m${i} ${'y'.repeat(1000)}`, lastTimestamp: new Date(Date.UTC(2026, 9, 25, 0, i)).toISOString() }));
    api.logs = () => Array.from({ length: 10_000 }, (_, i) => `line ${i} ${'z'.repeat(60)}`).join('\n') + '\n';
    const result = await buildDiagnosis(api, POD, EVENT);
    expect(result.text.length).toBeLessThanOrEqual(DIAGNOSE_MAX_CHARS);
    for (const part of result.parts) expect(part.chars).toBeLessThanOrEqual(DIAGNOSE_BUDGET[part.id]);
    expect(result.text).toContain(`line 9999 ${'z'.repeat(60)}`);
    expect(result.text).toContain('Warning R199 (x1): m199');
  });

  it('adds up below DIAGNOSE_MAX_CHARS for the largest pod and workload case with 1 200 characters of titles', () => {
    const b = DIAGNOSE_BUDGET;
    const pod = b.trigger + b.object + b.events + 2 * b.logs + 2 * b.previousLogs + b.owner + b.node;
    const workload = b.trigger + b.object + b.events + b.pods + b.podEvents + b.logs + b.previousLogs;
    expect(pod + 1200).toBeLessThanOrEqual(DIAGNOSE_MAX_CHARS);
    expect(workload + 1200).toBeLessThanOrEqual(DIAGNOSE_MAX_CHARS);
  });
});

describe('helpers', () => {
  it('cuts at line ends and stays within max', () => {
    const text = ['aaaa', 'bbbb', 'cccc', 'dddd'].join('\n');
    expect(headOf(text, 12)).toBe('aaaa\nbbbb\n…');
    expect(tailOf(text, 12)).toBe('…\ncccc\ndddd');
    for (const max of [3, 5, 8, 13]) {
      expect(headOf(text, max).length).toBeLessThanOrEqual(max);
      expect(tailOf(text, max).length).toBeLessThanOrEqual(max);
    }
  });

  it('never cuts a token in half when one line is longer than max', () => {
    const line = `start Bearer ${'t'.repeat(40)} end`;
    expect(headOf(line, 30)).toBe('start Bearer\n…');
    expect(tailOf(line, 30)).toBe('…\nend');
    expect(headOf('x'.repeat(50), 30)).toBe('…');
    expect(tailOf('x'.repeat(50), 30)).toBe('…');
  });

  it('removes ANSI codes and compacts JSON lines', () => {
    expect(logText('\u001b[31mred\u001b[0m\r\n{"level":"error","msg":"boom"}\n')).not.toContain('\u001b');
    expect(logText('{"level":"error","msg":"boom"}\n')).not.toContain('{"level"');
    expect(logText('')).toBe('(empty)');
  });

  it('puts a failed init container before the main container and keeps max', () => {
    const pod: KubeObject = {
      spec: { initContainers: [{ name: 'init' }], containers: [{ name: 'main' }, { name: 'side' }] },
      status: {
        initContainerStatuses: [{ name: 'init', restartCount: 2, state: { terminated: { exitCode: 1 } } }],
        containerStatuses: [{ name: 'main', ready: false, restartCount: 0 }, { name: 'side', ready: false, restartCount: 0 }],
      },
    };
    expect(problemContainers(pod, 2)).toEqual([{ name: 'init', previous: true }, { name: 'main', previous: false }]);
    expect(problemContainers(pod, 1)).toEqual([{ name: 'init', previous: true }]);
  });
});
