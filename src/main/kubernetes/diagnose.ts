/**
 * "Mit KI analysieren": collects status, events, logs and spec of one pod, workload or job as text for the assistant.
 * Reads only: get, list and get on pods/log. Never reads Secrets or ConfigMaps and never resolves secretKeyRef.
 * Section titles and field labels are technical English like describe.ts; the text goes to the AI only.
 */
import { AppError } from '../../shared/errors';
import { DIAGNOSE_KINDS, DIAGNOSE_MAX_CHARS, KIND_INFO, type KubeDiagnosePart, type KubeDiagnosePartId, type KubeDiagnosis, type KubeRef } from '../../shared/kubernetes';
import { KubeApiError, type KubeApi, type KubeObject, type LogReadTarget } from './api';
import { envValue } from './describe';
import { formatLogLine } from './log-format';
import { ownerOf } from './rows';
import { MAX_LINE_CHARS, cleanLogText } from './workload-logs';

/** Characters per section. A pod and a workload stay below DIAGNOSE_MAX_CHARS together (diagnose.test.ts). */
export const DIAGNOSE_BUDGET: Record<KubeDiagnosePartId, number> = {
  trigger: 400, object: 3000, events: 2000, pods: 1500, podEvents: 1500, logs: 2000, previousLogs: 2000, owner: 800, node: 600,
};
export const DIAGNOSE_EVENTS = 15;
export const DIAGNOSE_LOG_LINES = 100;
export const DIAGNOSE_LOG_BYTES = 64 * 1024;
/** Tails tried in turn: the API applies limitBytes from the first tailed line, so a tail over the limit loses the newest lines. */
const LOG_TAILS = [DIAGNOSE_LOG_LINES, 20, 5, 1] as const;
/** Containers whose logs a pod analysis reads; a workload analysis reads one container of its worst pod. */
export const DIAGNOSE_POD_CONTAINERS = 2;
export const DIAGNOSE_WORKLOAD_CONTAINERS = 1;
export const DIAGNOSE_PODS = 5;
const EVENT_MESSAGE_CHARS = 300;
/** Env names whose literal value never goes out, not even to the masker: it cannot see `- name: X` + `value: y`. */
const HIDDEN_ENV = /pass|pwd|secret|token|key|credential|auth|cert|private|salt|signature|cookie|session|dsn|conn/i;
const MISSING_TEXT = {
  forbidden: 'not readable: forbidden by RBAC', notFound: 'not found', none: 'none available', failed: 'could not be read',
} as const satisfies Record<NonNullable<KubeDiagnosePart['missing']>, string>;

type Rec = Record<string, any>;
interface Section { part: KubeDiagnosePart; text: string }

const rec = (value: unknown): Rec | undefined => (typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Rec : undefined);
const arr = (value: unknown): any[] => (Array.isArray(value) ? value : []);
/** client-node turns time fields of read objects into Date; String(date) would send the local zone name, so dates go out as ISO 8601. */
const str = (value: unknown): string => (value === undefined || value === null ? ''
  : value instanceof Date ? (Number.isNaN(value.getTime()) ? '' : value.toISOString()) : String(value));
const pairs = (map: unknown): string => Object.entries(rec(map) ?? {}).map(([key, value]) => `${key}=${str(value)}`).join(', ') || '<none>';
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Keeps the start of a text, cut at a line end; the result is at most `max` characters. A single overlong line is cut at a space, never inside a token. */
export function headOf(text: string, max: number): string {
  if (text.length <= max) return text;
  const line = text.lastIndexOf('\n', max - 2);
  if (line > 0) return `${text.slice(0, line)}\n…`;
  // A token cut in half could slip past the masker: keep only whole words.
  const space = text.slice(0, max - 2).search(/\s\S*$/);
  return space > 0 ? `${text.slice(0, space)}\n…` : '…';
}

/** Keeps the end of a text (logs: the newest lines), cut at a line start; the result is at most `max` characters. A single overlong line is cut at a space, never inside a token. */
export function tailOf(text: string, max: number): string {
  if (text.length <= max) return text;
  const from = text.length - max + 2;
  const line = text.indexOf('\n', from - 1);
  if (line >= 0 && line < text.length - 1) return `…\n${text.slice(line + 1)}`;
  // A token cut in half could slip past the masker: keep only whole words.
  const space = text.slice(from).search(/\s/);
  return space >= 0 && from + space + 1 < text.length ? `…\n${text.slice(from + space + 1)}` : '…';
}

/** Cuts one line at a space before `max` and marks the cut; never inside a token (M-3). */
export function wordCut(line: string, max: number): string {
  if (line.length <= max) return line;
  const space = line.slice(0, max).search(/\s\S*$/);
  return `${space > 0 ? line.slice(0, space) : ''}…`;
}

/** Why a section is empty: 403 forbidden, 404 gone, 400 nothing to read (no previous or no started container). */
export function missingReason(error: unknown): NonNullable<KubeDiagnosePart['missing']> {
  if (!(error instanceof KubeApiError)) return 'failed';
  return error.code === 403 ? 'forbidden' : error.code === 404 ? 'notFound' : error.code === 400 ? 'none' : 'failed';
}

function section(id: KubeDiagnosePartId, title: string, body: string, name?: string, keep: 'head' | 'tail' = 'head'): Section {
  const text = keep === 'tail' ? tailOf(body, DIAGNOSE_BUDGET[id]) : headOf(body, DIAGNOSE_BUDGET[id]);
  return { part: { id, ...(name ? { name } : {}), chars: text.length }, text: `## ${title}\n${text}` };
}

function missing(id: KubeDiagnosePartId, title: string, error: unknown, name?: string): Section {
  const reason = missingReason(error);
  return { part: { id, ...(name ? { name } : {}), chars: 0, missing: reason }, text: `## ${title}\n(${MISSING_TEXT[reason]})` };
}

async function guarded(id: KubeDiagnosePartId, title: string, read: () => Promise<string>, name?: string): Promise<Section> {
  try {
    return section(id, title, await read(), name);
  } catch (error) {
    return missing(id, title, error, name);
  }
}

const conditionsText = (conditions: unknown): string => arr(conditions)
  .map(c => `${str(c.type)}=${str(c.status)}${c.reason || c.message ? ` (${[str(c.reason), str(c.message)].filter(Boolean).join(': ')})` : ''}`)
  .join('; ') || '<none>';

function probeText(probe: unknown): string | undefined {
  const p = rec(probe);
  if (!p) return undefined;
  const http = rec(p.httpGet);
  const tcp = rec(p.tcpSocket);
  const exec = rec(p.exec);
  const grpc = rec(p.grpc);
  const how = http ? `http-get :${str(http.port)}${str(http.path)}` : tcp ? `tcp :${str(tcp.port)}`
    : exec ? `exec ${arr(exec.command).map(str).join(' ')}` : grpc ? `grpc :${str(grpc.port)}` : 'other';
  const timing: [string, unknown, string][] = [['delay', p.initialDelaySeconds, 's'], ['timeout', p.timeoutSeconds, 's'], ['period', p.periodSeconds, 's'], ['failure', p.failureThreshold, '']];
  return [how, ...timing.filter(([, value]) => value !== undefined).map(([name, value, unit]) => `${name}=${str(value)}${unit}`)].join(' ');
}

/** `NAME: value`; secret-like literal values become <hidden>, references stay references (envValue never resolves them). */
function envLine(entry: Rec): string {
  const name = str(entry.name);
  const value = entry.value !== undefined && HIDDEN_ENV.test(name) ? '<hidden>' : envValue(entry);
  return `    ${name}: ${value}`;
}

function containerSpecLines(container: Rec): string[] {
  const resources = rec(container.resources) ?? {};
  const command = arr(container.command).map(str).join(' ');
  const args = arr(container.args).map(str).join(' ');
  const ports = arr(container.ports).map(p => `${str(p.containerPort)}/${str(p.protocol ?? 'TCP')}`).join(', ');
  const lines = [
    `  Image: ${str(container.image)}`,
    ...(command ? [`  Command: ${command}`] : []),
    ...(args ? [`  Args: ${args}`] : []),
    ...(ports ? [`  Ports: ${ports}`] : []),
    `  Requests: ${pairs(resources.requests)}`,
    `  Limits: ${pairs(resources.limits)}`,
  ];
  for (const [label, key] of [['Liveness', 'livenessProbe'], ['Readiness', 'readinessProbe'], ['Startup', 'startupProbe']] as const) {
    const text = probeText(container[key]);
    if (text) lines.push(`  ${label}: ${text}`);
  }
  const env = arr(container.env);
  if (env.length > 0) lines.push('  Env:', ...env.map(entry => envLine(rec(entry) ?? {})));
  const from = arr(container.envFrom)
    .map(item => (rec(item.secretRef) ? `<Secret ${str(item.secretRef.name)}>` : rec(item.configMapRef) ? `<ConfigMap ${str(item.configMapRef.name)}>` : ''))
    .filter(Boolean);
  if (from.length > 0) lines.push(`  Env from: ${from.join(', ')}`);
  const mounts = arr(container.volumeMounts).map(m => `${str(m.mountPath)} (${str(m.name)}${m.readOnly ? ', ro' : ''})`);
  if (mounts.length > 0) lines.push(`  Mounts: ${mounts.join(', ')}`);
  return lines;
}

function stateText(state: unknown): string {
  const s = rec(state) ?? {};
  const running = rec(s.running);
  const waiting = rec(s.waiting);
  const ended = rec(s.terminated);
  if (running) return `Running since ${str(running.startedAt)}`;
  if (waiting) return `Waiting (${[str(waiting.reason), str(waiting.message)].filter(Boolean).join(': ')})`;
  if (ended) {
    return `Terminated (${[str(ended.reason), `exit code ${str(ended.exitCode)}`, ended.signal !== undefined ? `signal ${str(ended.signal)}` : '',
      ended.finishedAt ? `finished ${str(ended.finishedAt)}` : '', str(ended.message)].filter(Boolean).join(', ')})`;
  }
  return 'unknown';
}

function containerStatusLines(status: Rec | undefined): string[] {
  if (!status) return ['  Status: not reported'];
  const last = rec(status.lastState);
  return [
    `  State: ${stateText(status.state)}`,
    ...(last && Object.keys(last).length > 0 ? [`  Last state: ${stateText(last)}`] : []),
    `  Ready: ${status.ready ? 'true' : 'false'}, restarts: ${str(status.restartCount ?? 0)}`,
  ];
}

function volumeText(volume: Rec): string {
  const source = rec(volume.secret) ? `Secret ${str(volume.secret.secretName)}` : rec(volume.configMap) ? `ConfigMap ${str(volume.configMap.name)}`
    : rec(volume.persistentVolumeClaim) ? `PVC ${str(volume.persistentVolumeClaim.claimName)}` : rec(volume.emptyDir) ? 'EmptyDir'
      : rec(volume.hostPath) ? `HostPath ${str(volume.hostPath.path)}` : rec(volume.projected) ? 'Projected' : 'other';
  return `${str(volume.name)} (${source})`;
}

/** Pod as text: a whitelist of fields. No annotations, no managedFields, no secret values. */
export function podSummary(pod: KubeObject): string {
  const meta = pod.metadata ?? {};
  const spec = rec(pod.spec) ?? {};
  const status = rec(pod.status) ?? {};
  const lines = [
    'Kind: Pod',
    `Name: ${str(meta.name)}`,
    `Namespace: ${str(meta.namespace)}`,
    `Phase: ${str(status.phase)}${status.reason ? ` (${str(status.reason)}: ${str(status.message)})` : ''}`,
    `Node: ${str(spec.nodeName) || '<not scheduled>'}`,
    `Created: ${str(meta.creationTimestamp)}`,
    `Labels: ${pairs(meta.labels)}`,
    `Owner: ${arr(meta.ownerReferences).map(o => `${str(o.kind)}/${str(o.name)}`).join(', ') || '<none>'}`,
    `Service account: ${str(spec.serviceAccountName) || 'default'}`,
    `Restart policy: ${str(spec.restartPolicy) || 'Always'}`,
    `QoS class: ${str(status.qosClass) || '<unknown>'}`,
    `Conditions: ${conditionsText(status.conditions)}`,
  ];
  if (rec(spec.nodeSelector)) lines.push(`Node selector: ${pairs(spec.nodeSelector)}`);
  const tolerations = arr(spec.tolerations).map(item => `${str(item.key)}${item.operator === 'Exists' ? '' : `=${str(item.value)}`}${item.effect ? `:${str(item.effect)}` : ''}`).filter(Boolean);
  if (tolerations.length > 0) lines.push(`Tolerations: ${tolerations.join(', ')}`);
  for (const container of arr(spec.initContainers)) {
    const name = str(container.name);
    lines.push(`Init container ${name}:`, ...containerSpecLines(rec(container) ?? {}),
      ...containerStatusLines(arr(status.initContainerStatuses).find(item => item.name === name)));
  }
  for (const container of arr(spec.containers)) {
    const name = str(container.name);
    lines.push(`Container ${name}:`, ...containerSpecLines(rec(container) ?? {}),
      ...containerStatusLines(arr(status.containerStatuses).find(item => item.name === name)));
  }
  const volumes = arr(spec.volumes).map(volume => volumeText(rec(volume) ?? {}));
  if (volumes.length > 0) lines.push(`Volumes: ${volumes.join(', ')}`);
  return lines.join('\n');
}

/** Deployment, StatefulSet, DaemonSet or Job as text; `withTemplate` false for the owner section of a pod. */
export function workloadSummary(object: KubeObject, withTemplate: boolean): string {
  const meta = object.metadata ?? {};
  const kind = str(object.kind);
  const spec = rec(object.spec) ?? {};
  const status = rec(object.status) ?? {};
  const lines = [`Kind: ${kind}`, `Name: ${str(meta.name)}`, `Namespace: ${str(meta.namespace)}`, `Created: ${str(meta.creationTimestamp)}`, `Labels: ${pairs(meta.labels)}`];
  if (kind === 'DaemonSet') {
    lines.push(`Pods: desired ${str(status.desiredNumberScheduled ?? 0)}, ready ${str(status.numberReady ?? 0)}, updated ${str(status.updatedNumberScheduled ?? 0)}, available ${str(status.numberAvailable ?? 0)}`);
  } else if (kind === 'Job') {
    lines.push(`Completions: ${str(spec.completions ?? 1)}, parallelism ${str(spec.parallelism ?? 1)}, backoff limit ${str(spec.backoffLimit ?? 6)}`,
      `Pods: active ${str(status.active ?? 0)}, succeeded ${str(status.succeeded ?? 0)}, failed ${str(status.failed ?? 0)}`);
  } else {
    lines.push(`Replicas: desired ${str(spec.replicas ?? 1)}, ready ${str(status.readyReplicas ?? 0)}, updated ${str(status.updatedReplicas ?? 0)}, available ${str(status.availableReplicas ?? 0)}`);
  }
  const strategy = rec(spec.strategy) ?? rec(spec.updateStrategy);
  if (strategy) lines.push(`Strategy: ${str(strategy.type)}${rec(strategy.rollingUpdate) ? ` (${pairs(strategy.rollingUpdate)})` : ''}`);
  lines.push(`Selector: ${pairs(rec(spec.selector)?.matchLabels)}`, `Conditions: ${conditionsText(status.conditions)}`);
  if (!withTemplate) return lines.join('\n');
  const template = rec(rec(spec.template)?.spec) ?? {};
  for (const container of arr(template.initContainers)) lines.push(`Init container ${str(container.name)}:`, ...containerSpecLines(rec(container) ?? {}));
  for (const container of arr(template.containers)) lines.push(`Container ${str(container.name)}:`, ...containerSpecLines(rec(container) ?? {}));
  const volumes = arr(template.volumes).map(volume => volumeText(rec(volume) ?? {}));
  if (volumes.length > 0) lines.push(`Volumes: ${volumes.join(', ')}`);
  return lines.join('\n');
}

export function nodeSummary(node: KubeObject): string {
  const spec = rec(node.spec) ?? {};
  const status = rec(node.status) ?? {};
  const taints = arr(spec.taints).map(item => `${str(item.key)}${item.value ? `=${str(item.value)}` : ''}:${str(item.effect)}`);
  return [
    `Conditions: ${arr(status.conditions).map(c => `${str(c.type)}=${str(c.status)}`).join(', ') || '<none>'}`,
    `Unschedulable: ${spec.unschedulable ? 'true' : 'false'}`,
    `Taints: ${taints.join(', ') || '<none>'}`,
    `Allocatable: ${pairs(status.allocatable)}`,
    `Kubelet: ${str(rec(status.nodeInfo)?.kubeletVersion)}`,
  ].join('\n');
}

const eventTime = (event: KubeObject): number => {
  const time = Date.parse(str(event.lastTimestamp ?? event.eventTime ?? event.metadata?.creationTimestamp));
  return Number.isNaN(time) ? 0 : time;
};

/** The newest DIAGNOSE_EVENTS events, newest first, one line each. */
export function eventLines(events: KubeObject[]): string {
  return [...events].sort((a, b) => eventTime(b) - eventTime(a)).slice(0, DIAGNOSE_EVENTS).map(event => {
    const message = str(event.message).replace(/\s+/g, ' ');
    const short = wordCut(message, EVENT_MESSAGE_CHARS);
    return `${str(event.lastTimestamp ?? event.eventTime)} ${str(event.type)} ${str(event.reason)} (x${str(event.count ?? 1)}): ${short}`;
  }).join('\n') || '<none>';
}

/** Log text as the AI gets it: JSON lines compact, ANSI and control characters removed, lines cut at 4 000 characters. */
export function logText(raw: string): string {
  const lines = raw.split('\n');
  if (lines.at(-1) === '') lines.pop();
  // cleanLogText cuts at MAX_LINE_CHARS mid-token; wordCut cuts again at a space.
  return lines.map(line => wordCut(cleanLogText(formatLogLine(line.replace(/\r$/, ''))), MAX_LINE_CHARS)).join('\n') || '(empty)';
}

/** Containers worth reading: init containers that did not finish with 0, then containers not ready or restarted; else the first one. */
export function problemContainers(pod: KubeObject, max: number): { name: string; previous: boolean }[] {
  const spec = rec(pod.spec) ?? {};
  const status = rec(pod.status) ?? {};
  const picked: { name: string; previous: boolean }[] = [];
  for (const container of arr(spec.initContainers)) {
    const item = arr(status.initContainerStatuses).find(s => s.name === container.name);
    const done = rec(rec(item?.state)?.terminated)?.exitCode === 0;
    if (item && !done) picked.push({ name: str(container.name), previous: (Number(item.restartCount) || 0) > 0 });
  }
  for (const container of arr(spec.containers)) {
    const item = arr(status.containerStatuses).find(s => s.name === container.name);
    if (item && (!item.ready || (Number(item.restartCount) || 0) > 0)) picked.push({ name: str(container.name), previous: (Number(item.restartCount) || 0) > 0 });
  }
  const first = arr(spec.containers)[0];
  if (picked.length === 0 && first) picked.push({ name: str(first.name), previous: false });
  return picked.slice(0, max);
}

const restarts = (pod: KubeObject): number => arr(rec(pod.status)?.containerStatuses).reduce((sum: number, s) => sum + (Number(s.restartCount) || 0), 0);
const podReady = (pod: KubeObject): boolean => arr(rec(pod.status)?.conditions).some(c => c.type === 'Ready' && c.status === 'True');

/** Not ready first, then the most restarts, then by name. */
export function sortPodsWorstFirst(pods: KubeObject[]): KubeObject[] {
  return [...pods].sort((a, b) => Number(podReady(a)) - Number(podReady(b)) || restarts(b) - restarts(a)
    || compare(str(a.metadata?.name), str(b.metadata?.name)));
}

function podLine(pod: KubeObject): string {
  const status = rec(pod.status) ?? {};
  const statuses = arr(status.containerStatuses);
  const total = statuses.length || arr(rec(pod.spec)?.containers).length;
  const reason = statuses.map(s => str(rec(rec(s.state)?.waiting)?.reason) || str(rec(rec(s.state)?.terminated)?.reason)).find(Boolean) ?? '';
  return `${str(pod.metadata?.name)}  ${str(status.phase)}  ready ${statuses.filter(s => s.ready).length}/${total}  restarts ${restarts(pod)}  node ${str(rec(pod.spec)?.nodeName) || '-'}${reason ? `  ${reason}` : ''}`;
}

/** The newest lines that fit into DIAGNOSE_LOG_BYTES; a read that hits the limit is shorter than the limit, so a shorter tail is tried. */
async function readTail(api: KubeApi, target: LogReadTarget, previous: boolean): Promise<{ raw: string; lines: number }> {
  for (const lines of LOG_TAILS) {
    const raw = await api.readLog(target, { previous, tailLines: lines, limitBytes: DIAGNOSE_LOG_BYTES });
    // A cut multi-byte character decodes to U+FFFD (3 bytes), so a cut body is never shorter than the limit.
    // With one line the cut body still starts at that line's start, so its head is kept (logText cuts at a space).
    if (Buffer.byteLength(raw) < DIAGNOSE_LOG_BYTES || lines === 1) return { raw, lines };
  }
  throw new Error('unreachable: the last tail is one line');
}

async function readLogSection(api: KubeApi, namespace: string, pod: string, container: string, previous: boolean): Promise<Section> {
  const id: KubeDiagnosePartId = previous ? 'previousLogs' : 'logs';
  const name = `${pod}/${container}`;
  const which = previous ? 'previous container' : 'current container';
  const title = (lines: number): string => `Logs ${name} (${which}, last ${lines} ${lines === 1 ? 'line' : 'lines'})`;
  try {
    const { raw, lines } = await readTail(api, { namespace, pod, container }, previous);
    return section(id, title(lines), logText(raw), name, 'tail');
  } catch (error) {
    return missing(id, `Logs ${name} (${which})`, error, name);
  }
}

function logSections(api: KubeApi, pod: KubeObject, max: number): Promise<Section[]> {
  const namespace = str(pod.metadata?.namespace);
  const name = str(pod.metadata?.name);
  return Promise.all(problemContainers(pod, max).flatMap(container => [
    readLogSection(api, namespace, name, container.name, false),
    ...(container.previous ? [readLogSection(api, namespace, name, container.name, true)] : []),
  ]));
}

/**
 * Reads one pod, workload or job and builds the context of "Mit KI analysieren". Only the object itself must be readable;
 * every other part that fails is named with its reason. `event`: the event the analysis started from.
 */
export async function buildDiagnosis(api: KubeApi, ref: KubeRef, event?: KubeRef): Promise<KubeDiagnosis> {
  const namespace = ref.namespace;
  // The IPC schema checks the same; this keeps every other caller from reading anything else.
  if (!DIAGNOSE_KINDS.includes(ref.kind) || !namespace || (event && event.kind !== 'events')) throw new AppError('kubernetes.apiError');
  const object = await api.read(ref);
  const title = `Object: ${KIND_INFO[ref.kind].kind} ${namespace}/${ref.name}`;
  const sections: Section[] = [];
  if (event) sections.push(await guarded('trigger', 'Trigger event', async () => eventLines([await api.read(event)])));
  if (ref.kind === 'pods') {
    sections.push(section('object', title, podSummary(object)));
    const owner = ownerOf('pods', (object.metadata ?? {}) as Record<string, unknown>, namespace);
    const nodeName = str(rec(object.spec)?.nodeName);
    const ownerName = owner ? `${KIND_INFO[owner.kind].kind} ${owner.name}` : '';
    const [events, logs, ownerSection, nodeSection] = await Promise.all([
      guarded('events', 'Events (newest first)', async () => eventLines(await api.eventsFor(ref))),
      logSections(api, object, DIAGNOSE_POD_CONTAINERS),
      owner && owner.kind !== 'nodes' ? guarded('owner', `Owner ${ownerName}`, async () => workloadSummary(await api.read(owner), false), ownerName) : Promise.resolve(undefined),
      nodeName ? guarded('node', `Node ${nodeName}`, async () => nodeSummary(await api.read({ kind: 'nodes', name: nodeName })), nodeName) : Promise.resolve(undefined),
    ]);
    sections.push(events, ...logs, ...(ownerSection ? [ownerSection] : []), ...(nodeSection ? [nodeSection] : []));
    return assemble(sections);
  }
  sections.push(section('object', title, workloadSummary(object, true)));
  const labels = rec(rec(object.spec)?.selector)?.matchLabels;
  const podsRead: Promise<KubeObject[]> = labels && Object.keys(labels).length > 0
    ? api.list('pods', namespace, { labels }).then(list => sortPodsWorstFirst(list.items))
    : Promise.resolve([]);
  const [events, pods] = await Promise.all([
    guarded('events', 'Events (newest first)', async () => eventLines(await api.eventsFor(ref))),
    podsRead.then(items => ({ items, error: undefined as unknown }), (error: unknown) => ({ items: [] as KubeObject[], error })),
  ]);
  sections.push(events);
  if (pods.error !== undefined) sections.push(missing('pods', 'Pods', pods.error));
  else sections.push(section('pods', `Pods (worst first, at most ${DIAGNOSE_PODS})`, pods.items.slice(0, DIAGNOSE_PODS).map(podLine).join('\n') || '<none>'));
  const worst = pods.items[0];
  if (worst) {
    const podRef: KubeRef = { kind: 'pods', namespace, name: str(worst.metadata?.name) };
    const [podEvents, logs] = await Promise.all([
      guarded('podEvents', `Events of pod ${podRef.name} (newest first)`, async () => eventLines(await api.eventsFor(podRef)), podRef.name),
      logSections(api, worst, DIAGNOSE_WORKLOAD_CONTAINERS),
    ]);
    sections.push(podEvents, ...logs);
  }
  return assemble(sections);
}

function assemble(sections: Section[]): KubeDiagnosis {
  return { text: headOf(sections.map(item => item.text).join('\n\n'), DIAGNOSE_MAX_CHARS), parts: sections.map(item => item.part) };
}
