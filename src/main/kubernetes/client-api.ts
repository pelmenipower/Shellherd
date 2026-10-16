import { PassThrough, Writable } from 'node:stream';
import { Exec, KubernetesObjectApi, Log, Metrics, PatchStrategy, Watch } from '@kubernetes/client-node';
import type { KubeConfig, KubernetesObject } from '@kubernetes/client-node';
import { KIND_INFO } from '../../shared/kubernetes';
import type { KubeKind, KubeRef, KubeSelector, KubeTerminalTarget } from '../../shared/kubernetes';
import { SHELL_CHOICE } from '../containers/commands';
import { KubeApiError } from './api';
import type { KubeApi, KubeObject, KubeStream, ListResult, MetricsSample, TerminalIo, WatchHandle, WatchType } from './api';
import { parseCpu, parseMemory } from './rows';

type Socket = Awaited<ReturnType<Exec['exec']>>;
type OutputStream = Writable & { rows: number; columns: number };

/** REST path of a kind's collection, e.g. /api/v1/namespaces/shop/pods. Cluster-scoped kinds ignore the namespace. */
export function resourcePath(kind: KubeKind, namespace: string | null): string {
  const info = KIND_INFO[kind];
  const root = info.apiVersion === 'v1' ? '/api/v1' : `/apis/${info.apiVersion}`;
  const scope = info.namespaced && namespace ? `/namespaces/${namespace}` : '';
  return `${root}${scope}/${kind}`;
}

/** Label and field selector query parameters for list and watch. */
export function selectorQuery(selector?: KubeSelector): { labelSelector?: string; fieldSelector?: string } {
  const query: { labelSelector?: string; fieldSelector?: string } = {};
  const labels = Object.entries(selector?.labels ?? {});
  if (labels.length) query.labelSelector = labels.map(([key, value]) => `${key}=${value}`).join(',');
  if (selector?.node) query.fieldSelector = `spec.nodeName=${selector.node}`;
  return query;
}

const TLS_MESSAGES: Record<string, string> = {
  ERR_TLS_CERT_ALTNAME_INVALID: 'Das Zertifikat des API-Servers passt nicht zum Namen',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'Das Zertifikat des API-Servers ist nicht vertrauenswürdig',
  SELF_SIGNED_CERT_IN_CHAIN: 'Das Zertifikat des API-Servers ist nicht vertrauenswürdig',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'Das Zertifikat des API-Servers ist nicht vertrauenswürdig',
};

/** Maps client errors to messages that are safe to show. Raw response bodies and headers are never used. */
export function toApiError(error: unknown): KubeApiError {
  if (error instanceof KubeApiError) return error;
  const e = (error ?? {}) as { code?: unknown; statusCode?: unknown; reason?: unknown; message?: unknown; body?: { message?: unknown } };
  const status = typeof e.code === 'number' ? e.code : typeof e.statusCode === 'number' ? e.statusCode : undefined;
  if (status === 401) return new KubeApiError('Nicht angemeldet. Die Zugangsdaten der kubeconfig wurden abgelehnt.', 401);
  if (status === 403) return new KubeApiError(forbiddenMessage(e.body?.message), 403);
  if (status === 404) return new KubeApiError('Die Ressource gibt es nicht (mehr).', 404);
  if (status === 410) return new KubeApiError('Watch veraltet.', 410);
  if (typeof e.code === 'string' && e.code in TLS_MESSAGES) {
    const detail = typeof e.reason === 'string' ? e.reason : typeof e.message === 'string' ? e.message : undefined;
    return new KubeApiError(`TLS: ${TLS_MESSAGES[e.code]}${detail ? ` (${detail})` : ''}.`);
  }
  if (e.code === 'ECONNRESET' || e.message === 'socket hang up') {
    return new KubeApiError('Die Verbindung zum API-Server ist abgebrochen.');
  }
  return new KubeApiError('Die Kubernetes-API hat einen Fehler gemeldet.', status);
}

function forbiddenMessage(serverMessage: unknown): string {
  const match = typeof serverMessage === 'string'
    ? /cannot (\w+) resource "([^"]+)".*namespace "([^"]+)"/.exec(serverMessage)
    : null;
  return match ? `Keine Berechtigung: ${match[2]}/${match[1]} in ${match[3]}` : 'Keine Berechtigung.';
}

function statusOf(error: unknown): number | undefined {
  const e = (error ?? {}) as { code?: unknown; statusCode?: unknown };
  return typeof e.code === 'number' ? e.code : typeof e.statusCode === 'number' ? e.statusCode : undefined;
}

/** Header that identifies one object for read, patch and delete. */
function headerOf(ref: KubeRef) {
  const info = KIND_INFO[ref.kind];
  return {
    apiVersion: info.apiVersion,
    kind: info.kind,
    metadata: { name: ref.name, namespace: info.namespaced ? ref.namespace : undefined },
  };
}

/** Terminal output: rows and columns let client-node send the terminal size with an exec session. */
function terminalOutput(io: TerminalIo, size: { cols: number; rows: number }): OutputStream {
  const output = new Writable({
    write(chunk, _encoding, callback) {
      io.data(Buffer.from(chunk));
      callback();
    },
  });
  return Object.assign(output, { rows: size.rows, columns: size.cols });
}

function openLogs(config: KubeConfig, target: KubeTerminalTarget, io: TerminalIo): KubeStream {
  let finished = false;
  const finish = (code: number | null, message?: string) => {
    if (finished) return;
    finished = true;
    io.end(code, message);
  };
  const output = terminalOutput(io, { cols: 0, rows: 0 });
  output.on('finish', () => finish(0));

  let controller: AbortController | undefined;
  let closed = false;
  new Log(config)
    .log(target.namespace, target.pod, target.container, output, {
      follow: target.mode === 'logs',
      previous: target.mode === 'previous',
      tailLines: 500,
      timestamps: false,
    })
    .then(created => {
      controller = created;
      if (closed) controller.abort();
    })
    .catch((error: unknown) => finish(null, toApiError(error).message));

  return {
    write() {},
    resize() {},
    // The log flow is capped by the terminal's line limit, so back-pressure is not needed.
    pause() {},
    resume() {},
    close() {
      closed = true;
      controller?.abort();
    },
  };
}

async function openShell(config: KubeConfig, target: KubeTerminalTarget, size: { cols: number; rows: number }, io: TerminalIo): Promise<KubeStream> {
  let finished = false;
  const finish = (code: number | null, message?: string) => {
    if (finished) return;
    finished = true;
    io.end(code, message);
  };
  const stdin = new PassThrough();
  const stdout = terminalOutput(io, size);
  let socket: Socket | undefined;
  let closed = false;

  new Exec(config)
    .exec(target.namespace, target.pod, target.container, ['sh', '-c', SHELL_CHOICE], stdout, stdout, stdin, true, status => {
      const exitCause = status.details?.causes?.find(cause => cause.reason === 'ExitCode');
      if (status.status === 'Success') finish(0);
      else if (exitCause) finish(Number(exitCause.message));
      else if (status.message?.includes('executable file not found')) finish(127, 'Im Container gibt es weder bash noch sh.');
      else finish(null, 'Die Verbindung zum Container ist fehlgeschlagen.');
    })
    .then(created => {
      socket = created;
      created.on('close', () => finish(null));
      if (closed) created.close();
    })
    .catch((error: unknown) => finish(null, toApiError(error).message));

  return {
    write(data) {
      stdin.write(data);
    },
    resize(cols, rows) {
      stdout.columns = cols;
      stdout.rows = rows;
      stdout.emit('resize');
    },
    pause() {
      (socket as { pause?: () => void } | undefined)?.pause?.();
    },
    resume() {
      (socket as { resume?: () => void } | undefined)?.resume?.();
    },
    close() {
      closed = true;
      socket?.close();
    },
  };
}

export function createKubeApi(config: KubeConfig): KubeApi {
  const objects = () => KubernetesObjectApi.makeApiClient(config);

  return {
    async list(kind, namespace, selector) {
      const info = KIND_INFO[kind];
      const { fieldSelector, labelSelector } = selectorQuery(selector);
      const list = await objects().list(
        info.apiVersion,
        info.kind,
        info.namespaced ? namespace ?? undefined : undefined,
        undefined,
        undefined,
        undefined,
        fieldSelector,
        labelSelector,
      );
      return { items: list.items as KubeObject[], resourceVersion: list.metadata?.resourceVersion ?? '' } satisfies ListResult;
    },

    async watch(kind, namespace, selector, resourceVersion, onEvent, onEnd): Promise<WatchHandle> {
      const controller = await new Watch(config).watch(
        resourcePath(kind, namespace),
        { resourceVersion, allowWatchBookmarks: true, ...selectorQuery(selector) },
        (type, object) => onEvent(type as WatchType, object as KubeObject),
        error => {
          if (error?.name === 'AbortError') return;
          onEnd(error ? toApiError(error) : undefined);
        },
      );
      return { stop: () => controller.abort() };
    },

    async read(ref) {
      return (await objects().read(headerOf(ref))) as KubeObject;
    },

    async eventsFor(ref) {
      const involved = `involvedObject.name=${ref.name}${ref.namespace ? `,involvedObject.namespace=${ref.namespace}` : ''}`;
      const list = await objects().list('v1', 'Event', ref.namespace ?? undefined, undefined, undefined, undefined, involved);
      return list.items as KubeObject[];
    },

    async mergePatch(ref, body) {
      const header = headerOf(ref);
      const spec = { ...body, ...header, metadata: { ...(body as { metadata?: object }).metadata, ...header.metadata } };
      await objects().patch(spec as KubernetesObject, undefined, undefined, 'terminus', undefined, PatchStrategy.MergePatch);
    },

    async remove(ref) {
      await objects().delete(headerOf(ref) as KubernetesObject);
    },

    async nodeMetrics(): Promise<MetricsSample[] | null> {
      try {
        const list = await new Metrics(config).getNodeMetrics();
        return list.items.map(node => ({
          name: node.metadata.name,
          cpuMilli: parseCpu(node.usage.cpu),
          memoryBytes: parseMemory(node.usage.memory),
        }));
      } catch (error) {
        if (statusOf(error) === 404 || statusOf(error) === 503) return null;
        throw toApiError(error);
      }
    },

    async podMetrics(namespace): Promise<MetricsSample[] | null> {
      try {
        const list = await new Metrics(config).getPodMetrics(namespace ?? undefined);
        return list.items.map(pod => pod.containers.reduce<MetricsSample>(
          (sum, container) => ({
            ...sum,
            cpuMilli: sum.cpuMilli + parseCpu(container.usage.cpu),
            memoryBytes: sum.memoryBytes + parseMemory(container.usage.memory),
          }),
          { namespace: pod.metadata.namespace, name: pod.metadata.name, cpuMilli: 0, memoryBytes: 0 },
        ));
      } catch (error) {
        if (statusOf(error) === 404 || statusOf(error) === 503) return null;
        throw toApiError(error);
      }
    },

    async openTerminal(target, size, io) {
      if (target.mode === 'shell') return openShell(config, target, size, io);
      return openLogs(config, target, io);
    },
  };
}
