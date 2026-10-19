import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { RequestOptions } from 'node:https';
import { PassThrough, Writable } from 'node:stream';
import { Exec, KubernetesObjectApi, Metrics, PatchStrategy, Watch } from '@kubernetes/client-node';
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

/** Message prefix of the one TLS error the tunnel fallback (tls-server-name) can fix. */
export const TLS_ALTNAME_PREFIX = 'TLS: Das Zertifikat des API-Servers passt nicht zum Namen';

const TLS_MESSAGES: Record<string, string> = {
  ERR_TLS_CERT_ALTNAME_INVALID: TLS_ALTNAME_PREFIX,
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'TLS: Das Zertifikat des API-Servers ist nicht vertrauenswürdig',
  SELF_SIGNED_CERT_IN_CHAIN: 'TLS: Das Zertifikat des API-Servers ist nicht vertrauenswürdig',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'TLS: Das Zertifikat des API-Servers ist nicht vertrauenswürdig',
};

/** True only for the certificate-name mismatch that the tls-server-name fallback fixes. */
export function isAltnameError(error: KubeApiError): boolean {
  return error.message.startsWith(TLS_ALTNAME_PREFIX);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

const WATCH_REQUEST_TIMEOUT_MS = 600_000;
const WATCH_TIMEOUT_SECONDS = 300;

function errorNamed(error: unknown, name: string): boolean {
  const e = asRecord(error);
  return e.name === name || asRecord(e.cause).name === name;
}

/**
 * How a finished watch request is reported. Timeouts and aborts that were not caused by stop() are
 * a normal end (the server closes watches after timeoutSeconds). An abort caused by stop() is ignored.
 */
export function watchEnd(error: unknown, stopped: boolean): KubeApiError | undefined | 'ignore' {
  if (stopped) return 'ignore';
  if (!error) return undefined;
  if (errorNamed(error, 'TimeoutError') || errorNamed(error, 'AbortError')) return undefined;
  return toApiError(error);
}

function statusOf(error: unknown): number | undefined {
  const e = asRecord(error);
  return typeof e.code === 'number' ? e.code : typeof e.statusCode === 'number' ? e.statusCode : undefined;
}

/**
 * Maps client errors to messages that are safe to show. Raw response bodies, headers and
 * ApiException.message (which contains both) are never used.
 */
export function toApiError(error: unknown): KubeApiError {
  if (error instanceof KubeApiError) return error;
  const e = asRecord(error);
  const cause = asRecord(e.cause);
  const status = statusOf(error);
  if (status === 401) return new KubeApiError('Nicht angemeldet. Die Zugangsdaten der kubeconfig wurden abgelehnt.', 401);
  if (status === 403) return new KubeApiError(forbiddenMessage(asRecord(e.body).message), 403);
  if (status === 404) return new KubeApiError('Die Ressource gibt es nicht (mehr).', 404);
  if (status === 410) return new KubeApiError('Watch veraltet.', 410);
  // undici wraps TLS failures in TypeError('fetch failed'); the code lives on the cause.
  const tlsCode = [e.code, cause.code].find((code): code is string => typeof code === 'string' && code in TLS_MESSAGES);
  if (tlsCode) {
    const reason = typeof cause.reason === 'string' ? cause.reason : typeof e.reason === 'string' ? e.reason : undefined;
    return new KubeApiError(`${TLS_MESSAGES[tlsCode]}${reason ? ` (${reason})` : ''}.`);
  }
  if (e.code === 'ECONNRESET' || cause.code === 'ECONNRESET' || e.message === 'socket hang up') {
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

/** Runs one client call and rethrows its failure as a KubeApiError with a safe message. */
async function call<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw toApiError(error);
  }
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

/** The response fields the log stream reads. The body is an async iterable of chunks. */
export interface LogResponse { status: number; body: AsyncIterable<Uint8Array> }
/** Sends the GET for a log request. Injected in tests. */
export type LogRequest = (url: URL, options: RequestOptions) => Promise<LogResponse>;

const requestLogs: LogRequest = (url, options) => new Promise((resolve, reject) => {
  const request = url.protocol === 'http:' ? httpRequest : httpsRequest;
  const req = request(url, options, response => {
    // Error bodies are small and unused: drain them so the socket is released.
    if (response.statusCode !== 200) response.resume();
    // The body is read with for-await in openLogs, which reports its errors; this listener only keeps
    // an error that lands before that loop starts from becoming an uncaught 'error'.
    response.on('error', () => undefined);
    resolve({ status: response.statusCode ?? 0, body: response });
  });
  // Stays attached after the response, so a later abort cannot become an uncaught 'error'.
  req.on('error', reject);
  req.end();
});

/** Pod log URL, built the way client-node's Log class builds it. */
export function logUrl(server: string, target: KubeTerminalTarget): string {
  const path = `/api/v1/namespaces/${encodeURIComponent(target.namespace)}/pods/${encodeURIComponent(target.pod)}/log`;
  const url = new URL(server + path);
  const params = url.searchParams;
  params.set('container', target.container);
  params.set('follow', String(target.mode === 'logs'));
  params.set('previous', String(target.mode === 'previous'));
  params.set('tailLines', '500');
  params.set('timestamps', 'false');
  return url.toString();
}

function logStatusError(status: number, mode: KubeTerminalTarget['mode']): KubeApiError {
  if (mode === 'previous' && status === 400) return new KubeApiError('Kein vorheriger Container vorhanden.', 400);
  return toApiError({ code: status });
}

/**
 * Streams pod logs. The request is made here instead of through client-node's Log class, because
 * Log pipes the response body into a stream without an error handler: aborting it crashes main.
 * Body errors are read and handled in this function.
 */
export function openLogs(config: KubeConfig, target: KubeTerminalTarget, io: TerminalIo, sendRequest: LogRequest = requestLogs): KubeStream {
  const controller = new AbortController();
  let finished = false;
  const finish = (code: number | null, message?: string) => {
    if (finished) return;
    finished = true;
    io.end(code, message);
  };

  const run = async () => {
    const cluster = config.getCurrentCluster();
    if (!cluster) throw new Error('No currently active cluster');
    const url = new URL(logUrl(cluster.server, target));
    // Same auth path as client-node's own requests: TLS agent, CA, client cert and token come from the kubeconfig.
    const options: RequestOptions = { method: 'GET', headers: {}, signal: controller.signal };
    await config.applyToHTTPSOptions(options);
    const response = await sendRequest(url, options);
    if (response.status !== 200) throw logStatusError(response.status, target.mode);

    for await (const chunk of response.body) {
      if (finished) break;
      io.data(Buffer.from(chunk));
    }
    finish(0);
  };

  run().catch((error: unknown) => {
    // After close() the abort error is expected: finish() is blocked, so nothing is reported.
    if (controller.signal.aborted) return;
    finish(null, toApiError(error).message);
  });

  return {
    write() {},
    resize() {},
    // The log flow is capped by the terminal's line limit, so back-pressure is not needed.
    pause() {},
    resume() {},
    close() {
      if (finished) return;
      finished = true;
      controller.abort();
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
  // One client per API instance: client-node discovers the resource paths once per client.
  let objectApi: KubernetesObjectApi | undefined;
  const objects = () => {
    objectApi ??= KubernetesObjectApi.makeApiClient(config);
    return objectApi;
  };

  return {
    async list(kind, namespace, selector) {
      return call(async () => {
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
      });
    },

    async watch(kind, namespace, selector, resourceVersion, onEvent, onEnd): Promise<WatchHandle> {
      return call(async () => {
        let stopped = false;
        const watch = new Watch(config);
        // client-node aborts every watch after requestTimeoutMs (30 s by default). The server ends the
        // watch itself after timeoutSeconds, so the client timer only needs to be a safety net.
        (watch as unknown as { requestTimeoutMs: number }).requestTimeoutMs = WATCH_REQUEST_TIMEOUT_MS;
        const controller = await watch.watch(
          resourcePath(kind, namespace),
          { resourceVersion, allowWatchBookmarks: true, timeoutSeconds: WATCH_TIMEOUT_SECONDS, ...selectorQuery(selector) },
          (type, object) => onEvent(type as WatchType, object as KubeObject),
          error => {
            const end = watchEnd(error, stopped);
            if (end !== 'ignore') onEnd(end);
          },
        );
        return {
          stop: () => {
            stopped = true;
            controller.abort();
          },
        };
      });
    },

    async read(ref) {
      return call(async () => (await objects().read(headerOf(ref))) as KubeObject);
    },

    async eventsFor(ref) {
      return call(async () => {
        const involved = `involvedObject.name=${ref.name}${ref.namespace ? `,involvedObject.namespace=${ref.namespace}` : ''}`;
        const list = await objects().list('v1', 'Event', ref.namespace ?? undefined, undefined, undefined, undefined, involved);
        return list.items as KubeObject[];
      });
    },

    async mergePatch(ref, body) {
      await call(async () => {
        const header = headerOf(ref);
        const spec = { ...body, ...header, metadata: { ...(body as { metadata?: object }).metadata, ...header.metadata } };
        await objects().patch(spec as KubernetesObject, undefined, undefined, 'terminus', undefined, PatchStrategy.MergePatch);
      });
    },

    async remove(ref) {
      await call(() => objects().delete(headerOf(ref) as KubernetesObject));
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
