import type { KubeMeta, KubeObject } from './api';
import type { CodedError } from '../../shared/errors';
import { refKey, type KubeProblem, type KubeRef } from '../../shared/kubernetes';

const OOM_WINDOW_MS = 60 * 60_000;
const PENDING_LIMIT_MS = 5 * 60_000;
const IMAGE_REASONS = new Set(['ImagePullBackOff', 'ErrImagePull', 'InvalidImageName']);
const NODE_PRESSURE = ['MemoryPressure', 'DiskPressure', 'PIDPressure'];

interface ContainerState { waiting?: { reason?: string }; terminated?: { reason?: string; finishedAt?: string } }
interface ContainerStatus { name?: string; restartCount?: number; state?: ContainerState; lastState?: ContainerState }
interface PodStatus { phase?: string; containerStatuses?: ContainerStatus[] }
interface Condition { type?: string; status?: string }
type PodMeta = KubeMeta & { deletionTimestamp?: string };

const toMillis = (value: string | Date | undefined): number => (value === undefined ? NaN : new Date(value).getTime());

const problem = (kind: KubeProblem['kind'], ref: KubeRef, error: CodedError): KubeProblem =>
  ({ id: `${kind}:${refKey(ref)}`, kind, ref, error });

/** Detects problems in pods (all namespaces) and nodes. Nodes come first, then pods sorted by namespace and name. */
export function detectProblems(pods: KubeObject[], nodes: KubeObject[], now: number): KubeProblem[] {
  const nodeProblems = nodes.map(node => nodeProblem(node)).filter(isProblem)
    .sort((a, b) => compare(a.ref.name, b.ref.name));
  const podProblems = pods.map(pod => podProblem(pod, now)).filter(isProblem)
    .sort((a, b) => compare(a.ref.namespace ?? '', b.ref.namespace ?? '') || compare(a.ref.name, b.ref.name));
  return [...nodeProblems, ...podProblems];
}

const isProblem = (value: KubeProblem | undefined): value is KubeProblem => value !== undefined;
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function podProblem(pod: KubeObject, now: number): KubeProblem | undefined {
  const meta = (pod.metadata ?? {}) as PodMeta;
  if (!meta.name || meta.deletionTimestamp) return undefined;
  const ref: KubeRef = { kind: 'pods', namespace: meta.namespace, name: meta.name };
  const status = (pod.status ?? {}) as PodStatus;
  const containers = status.containerStatuses ?? [];
  const name = meta.name;

  const crashing = containers.find(c => c.state?.waiting?.reason === 'CrashLoopBackOff');
  if (crashing) return problem('crashloop', ref, { code: 'kubernetes.problemCrashloop', params: { name, restarts: crashing.restartCount ?? 0 } });

  const image = containers.find(c => IMAGE_REASONS.has(c.state?.waiting?.reason ?? ''));
  if (image) return problem('image', ref, { code: 'kubernetes.problemImage', params: { name, reason: image.state?.waiting?.reason ?? '' } });

  const oom = containers.find(c => c.lastState?.terminated?.reason === 'OOMKilled' && withinOomWindow(c, now));
  if (oom) return problem('oomkilled', ref, { code: 'kubernetes.problemOom', params: { name } });

  if (status.phase === 'Pending') {
    const created = toMillis(meta.creationTimestamp);
    const age = now - created;
    if (Number.isFinite(age) && age > PENDING_LIMIT_MS) {
      return problem('pending', ref, { code: 'kubernetes.problemPending', params: { name, minutes: Math.floor(age / 60_000) } });
    }
  }
  return undefined;
}

function withinOomWindow(container: ContainerStatus, now: number): boolean {
  const finished = Date.parse(container.lastState?.terminated?.finishedAt ?? '');
  return Number.isFinite(finished) && now - finished <= OOM_WINDOW_MS;
}

function nodeProblem(node: KubeObject): KubeProblem | undefined {
  const meta = node.metadata ?? {};
  if (!meta.name) return undefined;
  const ref: KubeRef = { kind: 'nodes', name: meta.name };
  const conditions = ((node.status ?? {}) as { conditions?: Condition[] }).conditions ?? [];
  const ready = conditions.find(c => c.type === 'Ready');
  if (ready?.status !== 'True') return problem('node', ref, { code: 'kubernetes.problemNodeNotReady', params: { name: meta.name } });
  const pressure = NODE_PRESSURE.filter(type => conditions.some(c => c.type === type && c.status === 'True'));
  if (pressure.length > 0) return problem('node', ref, { code: 'kubernetes.problemNodePressure', params: { name: meta.name, pressure: pressure.join(', ') } });
  return undefined;
}
