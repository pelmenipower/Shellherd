import type { Duplex } from 'node:stream';
import type { CodedError } from '../../shared/errors';
import type { KubeKind, KubeRef, KubeSelector, KubeTerminalTarget } from '../../shared/kubernetes';
import type { KubeResourceRule } from '../../shared/kube-access';

/** The slice of the Kubernetes API the cluster tab needs; client-api.ts implements it, tests use fakes. */
export interface KubeMeta {
  name?: string; namespace?: string; uid?: string; resourceVersion?: string; creationTimestamp?: string | Date;
  labels?: Record<string, string>; annotations?: Record<string, string>; ownerReferences?: { kind: string; name: string }[]; managedFields?: unknown;
}
export interface KubeObject { apiVersion?: string; kind?: string; metadata?: KubeMeta; [key: string]: unknown }
export interface ListResult { items: KubeObject[]; resourceVersion: string }
/** ERROR carries a Status object ({ kind: 'Status', code, … }) inside an otherwise healthy stream. */
export type WatchType = 'ADDED' | 'MODIFIED' | 'DELETED' | 'BOOKMARK' | 'ERROR';
export interface WatchHandle { stop(): void }
/**
 * code: HTTP status when there is one (401, 403, 404, 410 …). Message is English, technical and safe to pass on as a detail;
 * `coded` is what the user sees.
 */
export class KubeApiError extends Error {
  constructor(message: string, readonly code?: number, readonly coded: CodedError = { code: 'kubernetes.apiError' }) { super(message); }
}
export interface MetricsSample { namespace?: string; name: string; cpuMilli: number; memoryBytes: number }
export interface TerminalIo { data(chunk: Buffer): void; end(code: number | null, error?: CodedError): void }
export interface KubeStream { write(data: string): void; resize(cols: number, rows: number): void; pause(): void; resume(): void; close(): void }
/** Start of a followed log: the newest `tailLines`, or everything since `sinceTime` (RFC 3339, whole seconds). */
export interface LogFollowOptions { tailLines?: number; sinceTime?: string }
/** One container log read once (no follow): the newest `tailLines`, at most `limitBytes`; `previous` = the container before the last restart. */
export interface LogReadTarget { namespace: string; pod: string; container: string }
export interface LogReadOptions { previous: boolean; tailLines: number; limitBytes: number }
/** Result of a SelfSubjectRulesReview; incomplete = the rules cannot be trusted to be complete. */
export interface KubeRulesReview { incomplete: boolean; rules: KubeResourceRule[] }
export interface KubeApi {
  list(kind: KubeKind, namespace: string | null, selector?: KubeSelector): Promise<ListResult>;
  watch(kind: KubeKind, namespace: string | null, selector: KubeSelector | undefined, resourceVersion: string,
    onEvent: (type: WatchType, object: KubeObject) => void, onEnd: (error?: KubeApiError) => void): Promise<WatchHandle>;
  read(ref: KubeRef): Promise<KubeObject>;
  eventsFor(ref: KubeRef): Promise<KubeObject[]>;
  mergePatch(ref: KubeRef, body: object): Promise<void>;
  remove(ref: KubeRef, options?: { propagationPolicy?: 'Background' | 'Foreground' | 'Orphan' }): Promise<void>;
  /** Creates a batch/v1 Job named jobName from the CronJob's jobTemplate, owned by the CronJob. */
  createJobFrom(cron: KubeRef, jobName: string): Promise<void>;
  /** null: metrics.k8s.io is not served. */
  nodeMetrics(): Promise<MetricsSample[] | null>;
  podMetrics(namespace: string | null): Promise<MetricsSample[] | null>;
  openTerminal(target: KubeTerminalTarget, size: { cols: number; rows: number }, io: TerminalIo): Promise<KubeStream>;
  /**
   * Opens one port-forward stream (WebSocket) to a pod port and pipes `socket` through it both ways, with back-pressure;
   * resolves once it is open. The caller pauses `socket`; this resumes it. A port the pod refuses later destroys `socket`
   * with a KubeApiError (kubernetes.portForwardRefused). Handshake failures reject with a mapped KubeApiError.
   */
  portForward(namespace: string, pod: string, port: number, socket: Duplex): Promise<void>;
  /** Follows one container log with server timestamps (`timestamps=true`); `io.data` gets the raw bytes, always asynchronously. */
  followLog(target: KubeTerminalTarget, options: LogFollowOptions, io: TerminalIo): KubeStream;
  /** Reads one container log once (get on pods/log). Rejects with KubeApiError: 400 no (previous) container to read, 403, 404. */
  readLog(target: LogReadTarget, options: LogReadOptions): Promise<string>;
  /** SelfSubjectRulesReview of one namespace: a query, nothing is stored in the cluster. */
  rulesReview(namespace: string): Promise<KubeRulesReview>;
  /** One Argo CD Application (get on applications.argoproj.io, v1alpha1). Rejects with KubeApiError: 403, 404 (also when the CRD is missing). */
  readArgoApp(namespace: string, name: string): Promise<KubeObject>;
}
