import { LogFormatter } from './log-format';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { RequestOptions } from 'node:https';
import { PassThrough, Writable } from 'node:stream';
import type { Duplex } from 'node:stream';
import { AuthorizationV1Api, Exec, KubernetesObjectApi, Metrics, PatchStrategy, PortForward, Watch } from '@kubernetes/client-node';
import type { KubeConfig, KubernetesObject } from '@kubernetes/client-node';
import { AppError } from '../../shared/errors';
import type { CodedError, ErrorCode } from '../../shared/errors';
import { KIND_INFO } from '../../shared/kubernetes';
import type { KubeKind, KubeRef, KubeSelector, KubeTerminalTarget } from '../../shared/kubernetes';
import { SHELL_CHOICE } from '../containers/commands';
import { KubeApiError } from './api';
import type { KubeApi, KubeObject, KubeRulesReview, KubeStream, ListResult, LogFollowOptions, LogReadOptions, LogReadTarget, MetricsSample, TerminalIo, WatchHandle, WatchType } from './api';
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

const TLS_ERRORS: Record<string, { code: ErrorCode; message: string }> = {
  ERR_TLS_CERT_ALTNAME_INVALID: { code: 'kubernetes.tlsAltname', message: 'TLS: certificate does not match the server name' },
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: { code: 'kubernetes.tlsUntrusted', message: 'TLS: certificate is not trusted' },
  SELF_SIGNED_CERT_IN_CHAIN: { code: 'kubernetes.tlsUntrusted', message: 'TLS: certificate is not trusted' },
  DEPTH_ZERO_SELF_SIGNED_CERT: { code: 'kubernetes.tlsUntrusted', message: 'TLS: certificate is not trusted' },
};

/** True only for the certificate-name mismatch that the tls-server-name fallback fixes. */
export function isAltnameError(error: KubeApiError): boolean {
  return error.coded.code === 'kubernetes.tlsAltname';
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
 * Maps client errors to codes and English messages that are safe to show. Raw response bodies, headers and
 * ApiException.message (which contains both) are never used.
 */
export function toApiError(error: unknown): KubeApiError {
  if (error instanceof KubeApiError) return error;
  const e = asRecord(error);
  const cause = asRecord(e.cause);
  const status = statusOf(error);
  if (status === 401) return new KubeApiError('Unauthorized: the kubeconfig credentials were rejected', 401, { code: 'kubernetes.unauthorized' });
  if (status === 403) return forbiddenError(asRecord(e.body).message);
  if (status === 404) return new KubeApiError('Not found', 404, { code: 'kubernetes.notFound' });
  if (status === 410) return new KubeApiError('Watch expired', 410, { code: 'kubernetes.watchExpired' });
  // undici wraps TLS failures in TypeError('fetch failed'); the code lives on the cause.
  const tlsCode = [e.code, cause.code].find((code): code is string => typeof code === 'string' && code in TLS_ERRORS);
  if (tlsCode) {
    const reason = typeof cause.reason === 'string' ? cause.reason : typeof e.reason === 'string' ? e.reason : undefined;
    const tls = TLS_ERRORS[tlsCode];
    return new KubeApiError(tls.message, undefined, { code: tls.code, ...(reason ? { detail: reason } : {}) });
  }
  if (e.code === 'ECONNRESET' || cause.code === 'ECONNRESET' || e.message === 'socket hang up') {
    return new KubeApiError('Connection to the API server was reset', undefined, { code: 'kubernetes.connectionReset' });
  }
  return new KubeApiError('The Kubernetes API reported an error', status, { code: 'kubernetes.apiError' });
}

function forbiddenError(serverMessage: unknown): KubeApiError {
  const match = typeof serverMessage === 'string'
    ? /cannot (\w+) resource "([^"]+)".*namespace "([^"]+)"/.exec(serverMessage)
    : null;
  if (!match) return new KubeApiError('Forbidden', 403, { code: 'kubernetes.forbidden' });
  return new KubeApiError(`Forbidden: ${match[2]}/${match[1]} in ${match[3]}`, 403,
    { code: 'kubernetes.forbiddenResource', params: { resource: match[2], verb: match[1], namespace: match[3] } });
}

/** Handshake failures of a port-forward WebSocket; ws reports only "Unexpected server response: <status>", without the body. */
export function portForwardError(error: unknown, namespace: string, pod: string): KubeApiError {
  const e = asRecord(error);
  const message = [e.message, asRecord(e.error).message].find((text): text is string => typeof text === 'string') ?? '';
  const status = Number(/Unexpected server response: (\d{3})/.exec(message)?.[1]);
  if (status === 403) return new KubeApiError('Forbidden: pods/portforward', 403, { code: 'kubernetes.portForwardForbidden', params: { namespace } });
  if (status === 404) return new KubeApiError('Pod not found', 404, { code: 'kubernetes.portForwardPodGone', params: { name: pod } });
  if (status === 400) return new KubeApiError('Pod is not running', 400, { code: 'kubernetes.portForwardNotRunning', params: { name: pod } });
  // ws wraps network and TLS failures in an ErrorEvent; the Error with its code sits in `error`.
  return toApiError(Number.isFinite(status) ? { code: status } : e.error ?? error);
}

/** The parts of ws's WebSocket used here; client-node's own type is any because @types/ws is not installed. */
interface ForwardSocket {
  readonly bufferedAmount: number;
  readonly isPaused: boolean;
  on(event: 'close' | 'error', listener: () => void): unknown;
  close(): void;
  pause(): void;
  resume(): void;
  ping(data: undefined, mask: undefined, callback: () => void): void;
}

/** Unsent bytes a forward stream may hold before the local socket stops reading. */
const FORWARD_HIGH_WATER = 1024 * 1024;

/** Port forward over the API server (WebSocket, v4.channel.k8s.io): one stream per local connection, with back-pressure both ways. */
async function openPortForward(config: KubeConfig, namespace: string, pod: string, port: number, socket: Duplex): Promise<void> {
  let ws: ForwardSocket | undefined;
  // Set once data has arrived: later error text then means a failed stream, not a refused port.
  let delivered = false;
  // Channel 1 carries the kubelet's error text (e.g. nothing listens on the port); the text itself is not passed on.
  const errors = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      if (chunk.length > 0) {
        socket.destroy(delivered
          ? new KubeApiError('The port forward failed', undefined, { code: 'kubernetes.portForwardFailed' })
          : new KubeApiError('The pod refused the port', undefined, { code: 'kubernetes.portForwardRefused', params: { port } }));
      }
      callback();
    },
  });
  // Pod to local: a slow local reader pauses the WebSocket instead of buffering the whole download in main.
  const output = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      if (chunk.length > 0) delivered = true;
      // A closed local socket must not pause the stream again: the closing handshake has to be read.
      if (!socket.writable) { callback(); return; }
      if (!socket.write(chunk) && ws && !ws.isPaused) {
        const paused = ws;
        paused.pause();
        socket.once('drain', () => paused.resume());
      }
      callback();
    },
  });
  try {
    ws = await new PortForward(config).portForward(namespace, pod, [port], output, errors, socket) as ForwardSocket;
  } catch (error) {
    throw portForwardError(error, namespace, pod);
  }
  const open = ws;
  // end, not destroy: what the pod sent may still wait in the local socket's buffer.
  open.on('close', () => socket.end(() => socket.destroy()));
  open.on('error', () => socket.destroy());
  // resume: a paused WebSocket could not read the closing handshake.
  socket.once('close', () => { open.resume(); open.close(); });
  // Local to pod: client-node sends without looking at the buffer; stop reading until the queued frames are written.
  let waiting = false;
  socket.on('data', () => {
    if (waiting || open.bufferedAmount <= FORWARD_HIGH_WATER) return;
    waiting = true;
    socket.pause();
    open.ping(undefined, undefined, () => { waiting = false; socket.resume(); });
  });
  if (socket.destroyed) { open.close(); return; }
  socket.resume();
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

/** Body of a Job started by hand from a CronJob. Only labels and annotations of the template metadata are taken over. */
export function manualJobBody(cron: KubeObject, jobName: string): KubeObject {
  const meta = cron.metadata;
  const jobTemplate = asRecord(asRecord(cron.spec).jobTemplate);
  if (!meta?.uid || !meta.name || !jobTemplate.spec) throw new KubeApiError('The CronJob is incomplete', undefined, { code: 'kubernetes.cronJobIncomplete' });
  const template = asRecord(jobTemplate.metadata) as { labels?: Record<string, string>; annotations?: Record<string, string> };
  return {
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: {
      name: jobName,
      namespace: meta.namespace,
      ...(template.labels ? { labels: template.labels } : {}),
      annotations: { ...template.annotations, 'cronjob.kubernetes.io/instantiate': 'manual' },
      ownerReferences: [{ apiVersion: 'batch/v1', kind: 'CronJob', name: meta.name, uid: meta.uid, controller: true, blockOwnerDeletion: true }],
    },
    spec: jobTemplate.spec,
  } as unknown as KubeObject;
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

/** URL of a followed workload log: server timestamps on, the newest `tailLines` or everything since `sinceTime`. */
export function followLogUrl(server: string, target: KubeTerminalTarget, options: LogFollowOptions): string {
  const path = `/api/v1/namespaces/${encodeURIComponent(target.namespace)}/pods/${encodeURIComponent(target.pod)}/log`;
  const url = new URL(server + path);
  const params = url.searchParams;
  params.set('container', target.container);
  params.set('follow', 'true');
  params.set('timestamps', 'true');
  if (options.sinceTime) params.set('sinceTime', options.sinceTime);
  else params.set('tailLines', String(options.tailLines ?? 200));
  return url.toString();
}

/** Time limit of one log read for an analysis. */
export const LOG_READ_TIMEOUT_MS = 10_000;

/** URL of a one-time log read: no follow, no timestamps, the newest `tailLines`, at most `limitBytes`. */
export function readLogUrl(server: string, target: LogReadTarget, options: LogReadOptions): string {
  const path = `/api/v1/namespaces/${encodeURIComponent(target.namespace)}/pods/${encodeURIComponent(target.pod)}/log`;
  const url = new URL(server + path);
  const params = url.searchParams;
  params.set('container', target.container);
  params.set('follow', 'false');
  params.set('previous', String(options.previous));
  params.set('tailLines', String(options.tailLines));
  params.set('limitBytes', String(options.limitBytes));
  params.set('timestamps', 'false');
  return url.toString();
}

/** Reads one log once, through the same request path as openLogs; the body is cut at `limitBytes` even if the server sends more. */
export async function readLog(config: KubeConfig, target: LogReadTarget, options: LogReadOptions, sendRequest: LogRequest = requestLogs): Promise<string> {
  const cluster = config.getCurrentCluster();
  if (!cluster) throw new AppError('kubernetes.apiError');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOG_READ_TIMEOUT_MS);
  try {
    const request: RequestOptions = { method: 'GET', headers: {}, signal: controller.signal };
    await config.applyToHTTPSOptions(request);
    const response = await sendRequest(new URL(readLogUrl(cluster.server, target, options)), request);
    if (response.status !== 200) throw logStatusError(response.status, options.previous);
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of response.body) {
      const bytes = Buffer.from(chunk);
      chunks.push(bytes);
      size += bytes.length;
      if (size >= options.limitBytes) break;
    }
    return Buffer.concat(chunks).subarray(0, options.limitBytes).toString('utf8');
  } catch (error) {
    throw toApiError(error);
  } finally {
    clearTimeout(timer);
    // Frees the socket, also when the read stopped at limitBytes.
    controller.abort();
  }
}

function logStatusError(status: number, previous: boolean): KubeApiError {
  if (previous && status === 400) return new KubeApiError('No previous container', 400, { code: 'kubernetes.noPreviousContainer' });
  return toApiError({ code: status });
}

/**
 * Streams pod logs. The request is made here instead of through client-node's Log class, because
 * Log pipes the response body into a stream without an error handler: aborting it crashes main.
 * Body errors are read and handled in this function.
 */
export function openLogs(config: KubeConfig, target: KubeTerminalTarget, io: TerminalIo, sendRequest: LogRequest = requestLogs, follow?: LogFollowOptions): KubeStream {
  const controller = new AbortController();
  let finished = false;
  const finish = (code: number | null, error?: CodedError) => {
    if (finished) return;
    finished = true;
    io.end(code, error);
  };
  // Followed workload logs pass the raw bytes on: workload-logs.ts splits and cleans the lines itself.
  const formatter = follow ? undefined : new LogFormatter(target.format ?? 'compact');

  const run = async () => {
    const cluster = config.getCurrentCluster();
    if (!cluster) throw new AppError('kubernetes.apiError');
    const url = new URL(follow ? followLogUrl(cluster.server, target, follow) : logUrl(cluster.server, target));
    // Same auth path as client-node's own requests: TLS agent, CA, client cert and token come from the kubeconfig.
    const options: RequestOptions = { method: 'GET', headers: {}, signal: controller.signal };
    await config.applyToHTTPSOptions(options);
    const response = await sendRequest(url, options);
    if (response.status !== 200) throw logStatusError(response.status, target.mode === 'previous');

    for await (const chunk of response.body) {
      if (finished) break;
      const bytes = Buffer.from(chunk);
      if (!formatter) { io.data(bytes); continue; }
      const text = formatter.feed(bytes);
      if (text) io.data(Buffer.from(text));
    }
    if (!finished) {
      const rest = formatter?.flush();
      if (rest) io.data(Buffer.from(rest));
    }
    finish(0);
  };

  run().catch((error: unknown) => {
    // After close() the abort error is expected: finish() is blocked, so nothing is reported.
    if (controller.signal.aborted) return;
    // Show the held partial line before the error, so it is not lost.
    if (!finished) {
      const rest = formatter?.flush();
      if (rest) io.data(Buffer.from(rest));
    }
    finish(null, toApiError(error).coded);
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
  const finish = (code: number | null, error?: CodedError) => {
    if (finished) return;
    finished = true;
    io.end(code, error);
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
      else if (status.message?.includes('executable file not found')) finish(127, { code: 'kubernetes.noShell' });
      else finish(null, { code: 'kubernetes.containerConnectionFailed' });
    })
    .then(created => {
      socket = created;
      created.on('close', () => finish(null));
      if (closed) created.close();
    })
    .catch((error: unknown) => finish(null, toApiError(error).coded));

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
        const involved = `involvedObject.kind=${KIND_INFO[ref.kind].kind},involvedObject.name=${ref.name}${ref.namespace ? `,involvedObject.namespace=${ref.namespace}` : ''}`;
        const list = await objects().list('v1', 'Event', ref.namespace ?? undefined, undefined, undefined, undefined, involved);
        return list.items as KubeObject[];
      });
    },

    async mergePatch(ref, body) {
      await call(async () => {
        const header = headerOf(ref);
        const spec = { ...body, ...header, metadata: { ...(body as { metadata?: object }).metadata, ...header.metadata } };
        await objects().patch(spec as KubernetesObject, undefined, undefined, 'shellherd', undefined, PatchStrategy.MergePatch);
      });
    },

    async remove(ref, options) {
      await call(() => objects().delete(headerOf(ref) as KubernetesObject, undefined, undefined, undefined, undefined, options?.propagationPolicy));
    },

    async createJobFrom(cron, jobName) {
      await call(async () => {
        const cronObject = (await objects().read(headerOf(cron))) as KubeObject;
        await objects().create(manualJobBody(cronObject, jobName) as KubernetesObject, undefined, undefined, 'shellherd');
      });
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

    portForward(namespace, pod, port, socket) {
      return openPortForward(config, namespace, pod, port, socket);
    },

    followLog(target, options, io) {
      return openLogs(config, target, io, requestLogs, options);
    },

    readLog(target, options) {
      return readLog(config, target, options);
    },

    async rulesReview(namespace) {
      return call(async () => {
        const review = await config.makeApiClient(AuthorizationV1Api).createSelfSubjectRulesReview({
          body: { apiVersion: 'authorization.k8s.io/v1', kind: 'SelfSubjectRulesReview', spec: { namespace } },
        });
        const status = review.status;
        return {
          // A missing status or an evaluation error (e.g. a binding to a missing role) counts as incomplete: then nothing is greyed out.
          incomplete: status?.incomplete !== false || Boolean(status?.evaluationError),
          rules: (status?.resourceRules ?? []).map(rule => ({
            verbs: rule.verbs ?? [], apiGroups: rule.apiGroups ?? [], resources: rule.resources ?? [],
            ...(rule.resourceNames?.length ? { resourceNames: rule.resourceNames } : {}),
          })),
        } satisfies KubeRulesReview;
      });
    },
  };
}
