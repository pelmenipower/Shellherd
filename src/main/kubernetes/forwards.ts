import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import type { Server, Socket } from 'node:net';
import { AppError } from '../../shared/errors';
import type { CodedError } from '../../shared/errors';
import type { KubeForwardStatus, KubeForwardTarget } from '../../shared/kubernetes';
import { KubeApiError } from './api';
import type { KubeApi, KubeObject } from './api';

/** App-wide cap on running forwards, and per forward on connections open at once. */
export const MAX_KUBE_FORWARDS = 10;
export const MAX_FORWARD_CONNECTIONS = 32;
/** Same deadline as the cluster reconnect wait (session.ts READY_WAIT_MS). */
const HANDSHAKE_WAIT_MS = 30_000;

type Dict = Record<string, unknown>;
const rec = (value: unknown): Dict => (value && typeof value === 'object' && !Array.isArray(value) ? value as Dict : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** Where one connection goes. */
export interface ForwardHop { pod: string; port: number }

/** The view a forward belongs to; `api` waits through a reconnect (Session.waitReady). */
export interface ForwardView { ownerId: number; viewId: string; api: () => Promise<KubeApi> }

interface Entry {
  ownerId: number;
  viewId: string;
  api: () => Promise<KubeApi>;
  server: Server;
  sockets: Set<Socket>;
  status: KubeForwardStatus;
  /** Services: the hop that opened last; dropped when a connection through it fails to open. */
  hop?: ForwardHop;
  closed: boolean;
}

/** A pod that serves traffic: Running, condition Ready=True, not being deleted. */
export function podReady(pod: KubeObject): boolean {
  const status = rec(pod.status);
  if (status.phase !== 'Running' || rec(pod.metadata).deletionTimestamp) return false;
  return list(status.conditions).some(condition => rec(condition).type === 'Ready' && rec(condition).status === 'True');
}

/** Container port for a service targetPort: a number as is, a name looked up in the ports of all containers. */
export function containerPort(pod: KubeObject, targetPort: unknown): number | undefined {
  if (typeof targetPort === 'number') return targetPort;
  if (typeof targetPort !== 'string') return undefined;
  if (/^\d+$/.test(targetPort)) return Number(targetPort);
  for (const container of list(rec(pod.spec).containers)) {
    const match = list(rec(container).ports).map(rec).find(port => port.name === targetPort);
    if (match && typeof match.containerPort === 'number') return match.containerPort;
  }
  return undefined;
}

/** Pod and port for a target. Services: the first ready pod of the selector by name, on the service port's targetPort. */
export async function resolveHop(api: KubeApi, target: KubeForwardTarget): Promise<ForwardHop> {
  if (target.kind === 'pods') return { pod: target.name, port: target.port };
  const service = await api.read({ kind: 'services', namespace: target.namespace, name: target.name });
  const spec = rec(service.spec);
  const selector = Object.fromEntries(Object.entries(rec(spec.selector)).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  if (Object.keys(selector).length === 0) throw new AppError('kubernetes.portForwardNoSelector', { name: target.name });
  const servicePort = list(spec.ports).map(rec).find(port => port.port === target.port && (port.protocol ?? 'TCP') === 'TCP');
  if (!servicePort) throw new AppError('kubernetes.portForwardNoPort', { port: target.port });
  const ready = (await api.list('pods', target.namespace, { labels: selector })).items
    .filter(podReady)
    .sort((a, b) => ((a.metadata?.name ?? '') < (b.metadata?.name ?? '') ? -1 : 1));
  const pod = ready[0];
  const name = pod?.metadata?.name;
  if (!pod || !name) throw new AppError('kubernetes.portForwardNoReadyPod', { name: target.name });
  const port = containerPort(pod, servicePort.targetPort ?? servicePort.port);
  if (port === undefined) throw new AppError('kubernetes.portForwardNoPort', { port: target.port });
  return { pod: name, port };
}

function codedOf(error: unknown): CodedError {
  if (error instanceof AppError) return error.toCoded();
  if (error instanceof KubeApiError) return error.coded;
  return { code: 'kubernetes.portForwardFailed' };
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') reject(new AppError('ssh.forwardPortInUse', { port }));
      else if (error.code === 'EACCES') reject(new AppError('ssh.forwardPortDenied', { port }));
      else reject(new AppError('kubernetes.portForwardFailed'));
    });
    // Loopback only, never 0.0.0.0: the forward carries the user's cluster rights, on all interfaces the network would share them.
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address !== 'string') resolve(address.port);
      else { server.close(); reject(new AppError('kubernetes.portForwardFailed')); }
    });
  });
}

/** Port forwards of all cluster views: one listener on 127.0.0.1 each, one WebSocket per accepted connection. */
export class KubeForwards {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly emit: (ownerId: number, viewId: string, forwards: KubeForwardStatus[]) => void) {}

  async start(view: ForwardView, target: KubeForwardTarget, localPort: number): Promise<KubeForwardStatus> {
    if (this.entries.size >= MAX_KUBE_FORWARDS) throw new AppError('kubernetes.portForwardTooMany', { max: MAX_KUBE_FORWARDS });
    let entry: Entry | undefined;
    const server = createServer(socket => { if (entry) this.accept(entry, socket); else socket.destroy(); });
    const port = await listen(server, localPort);
    const created: Entry = {
      ownerId: view.ownerId, viewId: view.viewId, api: view.api, server, sockets: new Set(), closed: false,
      status: { id: randomUUID(), target, localPort: port, open: 0 },
    };
    entry = created;
    this.entries.set(created.status.id, created);
    // A listener that breaks later ends its forward instead of leaving a dead entry behind.
    server.on('error', () => this.stop(created.viewId, created.status.id));
    this.changed(created);
    return this.snapshot(created);
  }

  stop(viewId: string, id: string): void {
    const entry = this.entries.get(id);
    if (!entry || entry.viewId !== viewId) return;
    this.close(entry);
    this.emit(entry.ownerId, viewId, this.list(viewId));
  }

  /** The view is gone; no event, its renderer no longer listens. */
  stopView(viewId: string): void {
    for (const entry of [...this.entries.values()]) if (entry.viewId === viewId) this.close(entry);
  }

  stopAll(): void {
    for (const entry of [...this.entries.values()]) this.close(entry);
  }

  list(viewId: string): KubeForwardStatus[] {
    return [...this.entries.values()].filter(entry => entry.viewId === viewId).map(entry => this.snapshot(entry));
  }

  private snapshot(entry: Entry): KubeForwardStatus {
    return { ...entry.status, open: entry.sockets.size };
  }

  private close(entry: Entry): void {
    entry.closed = true;
    this.entries.delete(entry.status.id);
    entry.server.close();
    for (const socket of entry.sockets) socket.destroy();
    entry.sockets.clear();
  }

  private changed(entry: Entry): void {
    if (!entry.closed) this.emit(entry.ownerId, entry.viewId, this.list(entry.viewId));
  }

  private fail(entry: Entry, error: CodedError): void {
    entry.status = { ...entry.status, error };
    this.changed(entry);
  }

  private accept(entry: Entry, socket: Socket): void {
    socket.on('error', error => { if (error instanceof KubeApiError) this.fail(entry, error.coded); });
    if (entry.closed) { socket.destroy(); return; }
    if (entry.sockets.size >= MAX_FORWARD_CONNECTIONS) {
      socket.destroy();
      this.fail(entry, { code: 'kubernetes.portForwardBusy', params: { max: MAX_FORWARD_CONNECTIONS } });
      return;
    }
    socket.pause(); // nothing the client sends may be lost before the stream to the pod is open
    entry.sockets.add(socket);
    socket.once('close', () => { entry.sockets.delete(socket); this.changed(entry); });
    this.changed(entry);
    void this.relay(entry, socket);
  }

  private async relay(entry: Entry, socket: Socket): Promise<void> {
    const { target } = entry.status;
    try {
      const api = await entry.api();
      for (let attempt = 0; ; attempt++) {
        const hop = entry.hop ?? await resolveHop(api, target);
        if (socket.destroyed || entry.closed) { socket.destroy(); return; }
        // A handshake that never answers would hold one of the 32 slots until the client gives up.
        let expired = false;
        const timer = setTimeout(() => {
          expired = true;
          // A hanging pod must not stay the service's choice for the next connection.
          entry.hop = undefined;
          socket.destroy();
          this.fail(entry, { code: 'kubernetes.portForwardFailed' });
        }, HANDSHAKE_WAIT_MS);
        try {
          await api.portForward(target.namespace, hop.pod, hop.port, socket);
        } catch (error) {
          clearTimeout(timer);
          if (expired) return;
          entry.hop = undefined;
          // A service gets one fresh lookup: its pod may have been replaced since the last connection.
          if (target.kind === 'services' && attempt === 0 && !socket.destroyed) continue;
          throw error;
        }
        clearTimeout(timer);
        // A handshake that answers after the deadline has already failed; its status must stay.
        if (expired) return;
        if (target.kind === 'services') entry.hop = hop;
        const next: KubeForwardStatus = { ...entry.status, pod: hop.pod, podPort: hop.port };
        delete next.error;
        entry.status = next;
        this.changed(entry);
        return;
      }
    } catch (error) {
      socket.destroy();
      this.fail(entry, codedOf(error));
    }
  }
}
