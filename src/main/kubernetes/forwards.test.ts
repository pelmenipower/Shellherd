import { Server, connect } from 'node:net';
import type { Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../shared/errors';
import type { KubeForwardStatus, KubeForwardTarget } from '../../shared/kubernetes';
import { KubeApiError } from './api';
import type { KubeApi, KubeObject } from './api';
import { KubeForwards, MAX_FORWARD_CONNECTIONS, MAX_KUBE_FORWARDS, containerPort, podReady, resolveHop } from './forwards';

const POD: KubeForwardTarget = { kind: 'pods', namespace: 'shop', name: 'api-1', port: 8080 };
const SERVICE: KubeForwardTarget = { kind: 'services', namespace: 'shop', name: 'api', port: 80 };
const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });

function podObject(name: string, options: { ready?: boolean; phase?: string; deleting?: boolean } = {}): KubeObject {
  return {
    metadata: { name, namespace: 'shop', ...(options.deleting ? { deletionTimestamp: '2026-10-25T00:00:00Z' } : {}) } as KubeObject['metadata'],
    spec: { containers: [{ name: 'main', ports: [{ name: 'http', containerPort: 8080 }] }] },
    status: { phase: options.phase ?? 'Running', conditions: [{ type: 'Ready', status: options.ready === false ? 'False' : 'True' }] },
  };
}

/** Pod stream stand-in: echoes, or fails like the API server and the kubelet would. */
class Fake {
  service: KubeObject = { metadata: { name: 'api', namespace: 'shop' }, spec: { selector: { app: 'api' }, ports: [{ port: 80, targetPort: 'http', protocol: 'TCP' }] } };
  pods: KubeObject[] = [];
  gone = new Set<string>();
  refuse = false;
  hang = false;
  calls: { pod: string; port: number }[] = [];
  list = vi.fn(async () => ({ items: this.pods, resourceVersion: '1' }));
  readonly api = {
    read: async () => this.service,
    list: this.list,
    portForward: async (_namespace: string, pod: string, port: number, socket: Duplex): Promise<void> => {
      this.calls.push({ pod, port });
      if (this.hang) return new Promise<void>(() => {});
      if (this.gone.has(pod)) throw new KubeApiError('gone', 404, { code: 'kubernetes.portForwardPodGone', params: { name: pod } });
      if (this.refuse) {
        socket.destroy(new KubeApiError('refused', undefined, { code: 'kubernetes.portForwardRefused', params: { port } }));
        return;
      }
      socket.on('data', chunk => socket.write(chunk));
      socket.resume();
    },
  } as unknown as KubeApi;
}

function setup() {
  const fake = new Fake();
  const lists: KubeForwardStatus[][] = [];
  const forwards = new KubeForwards((_ownerId, _viewId, list) => { lists.push(list); });
  cleanups.push(() => forwards.stopAll());
  const view = { ownerId: 1, viewId: 'v1', api: async () => fake.api };
  const latest = (): KubeForwardStatus | undefined => lists.at(-1)?.[0];
  return { fake, forwards, view, lists, latest };
}

/** Sends text over a new connection and resolves with what comes back. */
function echo(port: number, text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => socket.write(text));
    socket.once('data', data => { resolve(data.toString()); socket.end(); });
    socket.once('error', reject);
  });
}

/** A connection that stays open; the caller destroys it. */
function open(port: number): Promise<Socket> {
  return new Promise(resolve => {
    const socket = connect(port, '127.0.0.1', () => resolve(socket));
    socket.on('error', () => {});
  });
}

/** Connects and resolves once the forward has closed the connection. */
function dropped(port: number): Promise<void> {
  return new Promise(resolve => {
    const socket = connect(port, '127.0.0.1');
    socket.on('error', () => {});
    socket.on('close', () => resolve());
  });
}

async function until(check: () => boolean): Promise<void> {
  for (const end = Date.now() + 3000; !check(); await new Promise(resolve => setTimeout(resolve, 10))) {
    if (Date.now() > end) throw new Error('condition not reached');
  }
}

/** Like `until`, but yields with setImmediate so it still works while setTimeout is faked. */
async function settle(check: () => boolean): Promise<void> {
  for (const end = Date.now() + 3000; !check(); await new Promise(resolve => setImmediate(resolve))) {
    if (Date.now() > end) throw new Error('condition not reached');
  }
}

describe('KubeForwards', () => {
  it('listens on 127.0.0.1 only and pipes a connection through the pod stream', async () => {
    const listen = vi.spyOn(Server.prototype, 'listen');
    cleanups.push(() => listen.mockRestore());
    const { fake, forwards, view, latest } = setup();
    const status = await forwards.start(view, POD, 0);
    expect(listen.mock.calls.at(-1)?.slice(0, 2)).toEqual([0, '127.0.0.1']);
    expect(status.localPort).toBeGreaterThan(0);
    expect(status).toMatchObject({ target: POD, open: 0 });
    const client = await open(status.localPort);
    await until(() => latest()?.open === 1);
    client.destroy();
    await until(() => latest()?.open === 0);
    expect(await echo(status.localPort, 'ping')).toBe('ping');
    expect(fake.calls.at(-1)).toEqual({ pod: 'api-1', port: 8080 });
    expect(latest()).toMatchObject({ pod: 'api-1', podPort: 8080 });
  });

  it('refuses a local port that is taken and keeps no entry', async () => {
    const { forwards, view } = setup();
    const first = await forwards.start(view, POD, 0);
    await expect(forwards.start(view, POD, first.localPort)).rejects.toMatchObject({ code: 'ssh.forwardPortInUse', params: { port: first.localPort } });
    expect(forwards.list('v1')).toHaveLength(1);
  });

  it('starts at most 10 forwards', async () => {
    const { forwards, view } = setup();
    for (let index = 0; index < MAX_KUBE_FORWARDS; index++) await forwards.start(view, POD, 0);
    await expect(forwards.start(view, POD, 0)).rejects.toMatchObject({ code: 'kubernetes.portForwardTooMany', params: { max: 10 } });
  });

  it('resolves a service to the first ready pod by name, remembers it and looks again when it is gone', async () => {
    const { fake, forwards, view, latest } = setup();
    fake.pods = [podObject('b'), podObject('a'), podObject('c', { ready: false }), podObject('0-old', { deleting: true })];
    const status = await forwards.start(view, SERVICE, 0);
    expect(await echo(status.localPort, 'one')).toBe('one');
    expect(fake.list).toHaveBeenCalledWith('pods', 'shop', { labels: { app: 'api' } });
    expect(fake.calls).toEqual([{ pod: 'a', port: 8080 }]);
    expect(latest()).toMatchObject({ pod: 'a', podPort: 8080 });
    expect(await echo(status.localPort, 'two')).toBe('two');
    expect(fake.list).toHaveBeenCalledTimes(1);
    fake.gone.add('a');
    fake.pods = fake.pods.filter(pod => pod.metadata?.name !== 'a');
    expect(await echo(status.localPort, 'three')).toBe('three');
    expect(fake.list).toHaveBeenCalledTimes(2);
    expect(fake.calls.slice(-2)).toEqual([{ pod: 'a', port: 8080 }, { pod: 'b', port: 8080 }]);
    expect(latest()).toMatchObject({ pod: 'b', podPort: 8080 });
    expect(latest()?.error).toBeUndefined();
  });

  it('keeps listening when the pod is gone and tries again with the next connection', async () => {
    const { fake, forwards, view, latest } = setup();
    fake.gone.add('api-1');
    const status = await forwards.start(view, POD, 0);
    await dropped(status.localPort);
    await until(() => latest()?.error?.code === 'kubernetes.portForwardPodGone');
    fake.gone.clear();
    expect(await echo(status.localPort, 'back')).toBe('back');
    expect(fake.calls).toHaveLength(2);
    expect(latest()?.error).toBeUndefined();
  });

  it('shows a refused port and clears it with the next good connection', async () => {
    const { fake, forwards, view, latest } = setup();
    fake.refuse = true;
    const status = await forwards.start(view, POD, 0);
    await dropped(status.localPort);
    await until(() => latest()?.error?.code === 'kubernetes.portForwardRefused');
    expect(latest()?.error).toEqual({ code: 'kubernetes.portForwardRefused', params: { port: 8080 } });
    fake.refuse = false;
    expect(await echo(status.localPort, 'ok')).toBe('ok');
    expect(latest()?.error).toBeUndefined();
  });

  it('refuses the 33rd connection at once while 32 are opening', async () => {
    const { fake, forwards, view, latest } = setup();
    fake.hang = true;
    const status = await forwards.start(view, POD, 0);
    const clients = await Promise.all(Array.from({ length: MAX_FORWARD_CONNECTIONS }, () => open(status.localPort)));
    cleanups.push(() => { for (const client of clients) client.destroy(); });
    await until(() => latest()?.open === MAX_FORWARD_CONNECTIONS);
    await dropped(status.localPort);
    await until(() => latest()?.error !== undefined);
    expect(latest()?.error).toEqual({ code: 'kubernetes.portForwardBusy', params: { max: 32 } });
    expect(fake.calls).toHaveLength(MAX_FORWARD_CONNECTIONS);
  });

  it('closes a connection when the cluster does not come back and shows why', async () => {
    const { forwards, latest } = setup();
    const view = { ownerId: 1, viewId: 'v1', api: async (): Promise<KubeApi> => { throw new AppError('kubernetes.reconnecting'); } };
    const status = await forwards.start(view, POD, 0);
    await dropped(status.localPort);
    await until(() => latest()?.error?.code === 'kubernetes.reconnecting');
  });

  it('stop closes the listener and its connections; a foreign view stops nothing', async () => {
    const { forwards, view, lists } = setup();
    const keep = await forwards.start(view, POD, 0);
    const status = await forwards.start(view, POD, 0);
    const client = await open(status.localPort);
    const closed = new Promise(resolve => client.once('close', resolve));
    forwards.stop('v2', status.id);
    expect(forwards.list('v1')).toHaveLength(2);
    forwards.stop('v1', status.id);
    expect(lists.at(-1)?.map(forward => forward.id)).toEqual([keep.id]);
    await closed;
    // The port is free again: a new forward can take it.
    const again = await forwards.start(view, POD, status.localPort);
    expect(again.localPort).toBe(status.localPort);
  });

  it('stopView and stopAll end the forwards without any further event', async () => {
    const { forwards, view, lists } = setup();
    const status = await forwards.start(view, POD, 0);
    const other = await forwards.start({ ...view, viewId: 'v2' }, POD, 0);
    const client = await open(status.localPort);
    await until(() => lists.at(-1)?.[0]?.open === 1);
    const count = lists.length;
    const closed = new Promise(resolve => client.once('close', resolve));
    forwards.stopView('v1');
    await closed;
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(lists).toHaveLength(count);
    expect(forwards.list('v1')).toEqual([]);
    expect(forwards.list('v2')).toHaveLength(1);
    forwards.stopAll();
    expect(forwards.list('v2')).toEqual([]);
    expect(lists).toHaveLength(count);
    expect((await forwards.start(view, POD, other.localPort)).localPort).toBe(other.localPort);
  });

  it('gives up on a handshake that never answers after 30 seconds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    cleanups.push(() => vi.useRealTimers());
    const { fake, forwards, view, latest } = setup();
    fake.hang = true;
    const status = await forwards.start(view, POD, 0);
    const client = await open(status.localPort);
    const closed = new Promise(resolve => client.once('close', resolve));
    await settle(() => fake.calls.length === 1);
    vi.advanceTimersByTime(29_999);
    expect(latest()?.error).toBeUndefined();
    vi.advanceTimersByTime(1);
    expect(latest()?.error).toEqual({ code: 'kubernetes.portForwardFailed' });
    await closed;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the handshake timer once the stream is open', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    cleanups.push(() => vi.useRealTimers());
    const { forwards, view, latest } = setup();
    const status = await forwards.start(view, POD, 0);
    expect(await echo(status.localPort, 'ping')).toBe('ping');
    expect(vi.getTimerCount()).toBe(0);
    expect(latest()?.error).toBeUndefined();
  });
});

describe('resolveHop', () => {
  const api = (spec: object, pods: KubeObject[]) =>
    ({ read: async () => ({ metadata: { name: 'api' }, spec }), list: async () => ({ items: pods, resourceVersion: '1' }) }) as unknown as KubeApi;
  const selector = { app: 'api' };

  it('names what is missing', async () => {
    await expect(resolveHop(api({ ports: [{ port: 80 }] }, []), SERVICE)).rejects.toMatchObject({ code: 'kubernetes.portForwardNoSelector', params: { name: 'api' } });
    await expect(resolveHop(api({ selector, ports: [{ port: 80 }] }, [podObject('a')]), { ...SERVICE, port: 81 }))
      .rejects.toMatchObject({ code: 'kubernetes.portForwardNoPort', params: { port: 81 } });
    await expect(resolveHop(api({ selector, ports: [{ port: 80, protocol: 'UDP' }] }, [podObject('a')]), SERVICE)).rejects.toMatchObject({ code: 'kubernetes.portForwardNoPort' });
    await expect(resolveHop(api({ selector, ports: [{ port: 80 }] }, [podObject('a', { ready: false }), podObject('b', { phase: 'Pending' })]), SERVICE))
      .rejects.toMatchObject({ code: 'kubernetes.portForwardNoReadyPod', params: { name: 'api' } });
    await expect(resolveHop(api({ selector, ports: [{ port: 80, targetPort: 'metrics' }] }, [podObject('a')]), SERVICE))
      .rejects.toMatchObject({ code: 'kubernetes.portForwardNoPort', params: { port: 80 } });
  });

  it('takes the service port without targetPort and passes pod targets through', async () => {
    expect(await resolveHop(api({ selector, ports: [{ port: 80 }] }, [podObject('a')]), SERVICE)).toEqual({ pod: 'a', port: 80 });
    expect(await resolveHop(api({}, []), POD)).toEqual({ pod: 'api-1', port: 8080 });
  });

  it('reads container ports and readiness', () => {
    const pod: KubeObject = { spec: { containers: [{ ports: [{ containerPort: 9090 }] }, { ports: [{ name: 'http', containerPort: 8080 }] }] } };
    expect(containerPort(pod, 8080)).toBe(8080);
    expect(containerPort(pod, '8080')).toBe(8080);
    expect(containerPort(pod, 'http')).toBe(8080);
    expect(containerPort(pod, 'grpc')).toBeUndefined();
    expect(containerPort(pod, undefined)).toBeUndefined();
    expect(podReady(podObject('a'))).toBe(true);
    expect(podReady(podObject('a', { phase: 'Pending' }))).toBe(false);
    expect(podReady(podObject('a', { ready: false }))).toBe(false);
    expect(podReady(podObject('a', { deleting: true }))).toBe(false);
  });
});
