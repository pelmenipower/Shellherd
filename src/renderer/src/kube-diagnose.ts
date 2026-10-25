/** "Mit KI analysieren": hand-over from a cluster tab to the assistant panel of the same window, and the helpers of the panel's Kubernetes mode. */
import type { AiChatMessage } from '../../shared/ai';
import { formatNumber } from '../../shared/format';
import type { KubeDiagnosePart, KubeDiagnosePartId, KubeDiagnosis, KubeRef, ProblemKind } from '../../shared/kubernetes';
import { historyForRequest } from './assistant-chat';
import { t } from './i18n';
import type { TerminalTab } from './terminal-tabs';

/** What to analyse: a pod, workload or job; `event` when started from an event row, `problem` when the object has one. */
export interface DiagnoseTarget { ref: KubeRef; event?: KubeRef; problem?: ProblemKind }
/** One request from a cluster tab; `context` is the answer of k8s:diagnose. */
export interface DiagnoseRequest { tabId: string; cluster: string; production: boolean; target: DiagnoseTarget; context: Promise<KubeDiagnosis> }

let pending: DiagnoseRequest | null = null;
const listeners = new Set<() => void>();

/** Hands a request to the assistant panel of this window; the newest wins. */
export function requestDiagnosis(request: DiagnoseRequest): void {
  // The panel reports a failure; this only keeps an unread request from becoming an unhandled rejection.
  request.context.catch(() => {});
  pending = request;
  for (const listener of [...listeners]) listener();
}

/** The waiting request, once. */
export function takeDiagnosis(): DiagnoseRequest | null {
  const request = pending;
  pending = null;
  return request;
}

export function onDiagnosis(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The cluster view itself (SplitTerminalArea shows ClusterView for exactly these tabs), not a pod logs or shell tab of it. */
export const isClusterTab = (tab: Pick<TerminalTab, 'connection'> | undefined): boolean =>
  !!tab && tab.connection.protocol === 'kubernetes' && !tab.connection.kube;

const PROBLEM_QUESTIONS = {
  crashloop: 'assistant:kube.questions.crashloop',
  oomkilled: 'assistant:kube.questions.oomkilled',
  image: 'assistant:kube.questions.image',
  pending: 'assistant:kube.questions.pending',
  node: 'assistant:kube.questions.pod',
} as const satisfies Record<ProblemKind, string>;

/** The question the input starts with. */
export function diagnoseQuestion(target: DiagnoseTarget): string {
  if (target.event) return t('assistant:kube.questions.event');
  if (target.problem) return t(PROBLEM_QUESTIONS[target.problem]);
  return t(target.ref.kind === 'pods' ? 'assistant:kube.questions.pod' : 'assistant:kube.questions.workload');
}

/** First message of an analysis: the question, then the collected context as data. */
export function diagnoseMessage(question: string, context: string): string {
  return `${question}\n\n${t('assistant:kube.contextHeading')}\n\`\`\`\n${context.replace(/```/g, "'''")}\n\`\`\``;
}

// A client as a word of its own: also /usr/bin/kubectl, kubectl.exe, sh -c "kubectl …", $(kubectl …), `kubectl …`; the verb anywhere after it.
const MUTATING_KUBECTL = /(?<![\w.-])(?:kubectl|kubecolor|oc|k)(?:\.exe)?\s(?:.*\s)?(?:apply|create|delete|edit|patch|replace|scale|autoscale|drain|cordon|uncordon|taint|label|annotate|set|expose|run|exec|cp|debug|attach|port-forward|proxy|reconcile|certificate)(?=[\s"'`);&|]|$)/i;
const MUTATING_ROLLOUT = /\brollout\s+(?:restart|undo|pause|resume)\b/i;
const MUTATING_HELM = /(?<![\w.-])helm(?:\.exe)?\s(?:.*\s)?(?:install|upgrade|uninstall|delete|del|un|rollback|test)(?=[\s"'`);&|]|$)/i;
const MUTATING_GITOPS = /(?<![\w.-])(?:argocd\s(?:.*\s)?(?:sync|rollback|delete|set|terminate-op)|flux\s(?:.*\s)?(?:reconcile|suspend|resume|delete|create))(?=[\s"'`);&|]|$)/i;

/** True when a command changes or enters the cluster. Only positive: a command not recognised is never called safe. */
export function mutatingCommand(command: string): boolean {
  // "auth can-i delete pods" asks, it does not delete: drop the verb it asks about, keep the rest of the line.
  return command.replace(/\\\r?\n/g, ' ').split(/[;&|\n]/).map(part => part.replace(/\bauth\s+can-i\s+\S+/gi, 'auth can-i'))
    .some(part => MUTATING_KUBECTL.test(part) || MUTATING_ROLLOUT.test(part) || MUTATING_HELM.test(part) || MUTATING_GITOPS.test(part));
}

/** History of a Kubernetes conversation: the context message and its answer always go along, then the newest turns. */
export function kubeHistory(turns: AiChatMessage[], max = 12): AiChatMessage[] {
  if (turns.length <= max) return historyForRequest(turns, max);
  return [...turns.slice(0, 2), ...historyForRequest(turns.slice(2), max - 2)];
}

/** Rough token count for the preview; shown as "etwa". */
export const estimatedTokens = (chars: number): number => Math.ceil(chars / 4);

const PART_KEYS = {
  trigger: 'assistant:kube.parts.trigger',
  object: 'assistant:kube.parts.object',
  events: 'assistant:kube.parts.events',
  pods: 'assistant:kube.parts.pods',
  podEvents: 'assistant:kube.parts.podEvents',
  logs: 'assistant:kube.parts.logs',
  previousLogs: 'assistant:kube.parts.previousLogs',
  owner: 'assistant:kube.parts.owner',
  node: 'assistant:kube.parts.node',
} as const satisfies Record<KubeDiagnosePartId, string>;
const MISSING_KEYS = {
  forbidden: 'assistant:kube.missing.forbidden',
  notFound: 'assistant:kube.missing.notFound',
  none: 'assistant:kube.missing.none',
  failed: 'assistant:kube.missing.failed',
} as const satisfies Record<NonNullable<KubeDiagnosePart['missing']>, string>;

/** One line of the preview: the part with its size, or why it is missing. */
export function diagnosePartLabel(part: KubeDiagnosePart): string {
  const label = t(PART_KEYS[part.id], { name: part.name ?? '' });
  return part.missing
    ? t('assistant:kube.partMissing', { label, reason: t(MISSING_KEYS[part.missing]) })
    : t('assistant:kube.partSize', { label, chars: formatNumber(part.chars) });
}
