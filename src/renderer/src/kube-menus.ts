/** Context menus of the cluster tab as pure data; see docs/superpowers/specs/2026-10-16-kubernetes-context-menus-design.md. */
import {
  DIAGNOSE_KINDS, KIND_INFO, refKey,
  type ClusterStatus, type ColumnInfo, type DockMode, type KubeAction, type KubeKind, type KubeProblem, type KubeRef, type KubeRow, type KubeTerminalMode, type KubeTerminalTarget, type NodeTile, type ProblemKind,
} from '../../shared/kubernetes';
import { KUBE_COMMANDS, actionReason, podNotRunning, type CommandId } from './kube-commands';
import * as kubectl from './kube-kubectl';
import { errorText } from './error-text';
import { t } from './i18n';
import { chipLabel } from './kube-labels';
import { primaryChip } from '../../shared/kube-status';
import type { KubeAccessId } from '../../shared/kube-access';
import { refAccessReason } from './kube-access';
import { defaultSort, filterOf, type KubeViewAction, type KubeViewState } from './kube-view';
import type { DiagnoseTarget } from './kube-diagnose';

export type MenuTarget =
  | { type: 'row'; row: KubeRow }
  | { type: 'container'; pod: KubeRow; name: string }
  | { type: 'node'; tile: NodeTile }
  | { type: 'problem'; problem: KubeProblem }
  | { type: 'dock'; mode: DockMode; pod: KubeRow | null; container: string | null; previous: boolean }
  | { type: 'dockText'; mode: 'yaml' | 'describe'; text: string; selection: string }
  | { type: 'dockEvent'; row: KubeRow }
  | { type: 'header'; column: ColumnInfo }
  | { type: 'background' };

export type MenuAction =
  | { type: 'view'; actions: KubeViewAction[]; previous?: boolean; armShell?: boolean }
  | { type: 'copy'; text: string; label: string }
  | { type: 'kubeAction'; ref: KubeRef; action: KubeAction; currentReplicas?: number }
  | { type: 'forward'; row: KubeRow }
  | { type: 'logsAll'; row: KubeRow }
  | { type: 'popout'; target: KubeTerminalTarget }
  | { type: 'ssh'; connectionId: string }
  | { type: 'dockReload' }
  | { type: 'help' }
  | { type: 'analyze'; target: DiagnoseTarget };

export type MenuEntry =
  | { kind: 'item'; id: string; label: string; hint?: string; disabled?: boolean; run: MenuAction }
  | { kind: 'heading'; label: string }
  | { kind: 'separator' };

export interface MenuContext {
  state: KubeViewState;
  status: ClusterStatus | null;
  canPopout: boolean;
  /** SSH connection in the vault for a node, see kube-ssh.ts. */
  sshForNode: (node: { name: string; ip?: string }) => { id: string; name: string } | undefined;
  /** False where no SSH connection can be opened at all (secondary window without the hook). */
  canSsh?: boolean;
  /** Unix milliseconds; menuFor never reads the clock itself. */
  now: number;
}

const ARGO_LABEL = 'argocd.argoproj.io/instance';
const PREFERRED_LABELS = ['app', 'app.kubernetes.io/name', 'app.kubernetes.io/instance', 'app.kubernetes.io/component'];

interface Env { ctx: MenuContext; connected: boolean; /** status.state === 'reconnecting' */ reconnecting: boolean; readOnly: boolean; /** Hotkey hints only for targets that are the selection. */ hot: boolean }
interface Options { hotkey?: CommandId; extra?: string; reason?: string | undefined }
type Group = MenuEntry[];

const item = (env: Env, id: string, label: string, run: MenuAction, options: Options = {}): MenuEntry => {
  if (options.reason) return { kind: 'item', id, label, hint: options.reason, disabled: true, run };
  const key = env.hot && options.hotkey ? KUBE_COMMANDS.find(command => command.id === options.hotkey)?.keys[0] : undefined;
  const hint = [key, options.extra].filter(Boolean).join(' · ');
  return { kind: 'item', id, label, ...(hint ? { hint } : {}), run };
};

/** Groups in order; empty groups drop out and the rest is joined by single separators. */
function assemble(lead: MenuEntry[], groups: Group[]): MenuEntry[] {
  const out: MenuEntry[] = [...lead];
  let first = true;
  for (const group of groups) {
    if (group.length === 0) continue;
    if (!first) out.push({ kind: 'separator' });
    out.push(...group);
    first = false;
  }
  return out;
}

const view = (...actions: KubeViewAction[]): MenuAction => ({ type: 'view', actions });
const select = (row: KubeRow): KubeViewAction => ({ type: 'select', key: refKey(row.ref) });
const dock = (mode: DockMode): KubeViewAction => ({ type: 'dock', mode });
const connectedReason = (env: Env): string | undefined => (env.connected ? undefined : env.reconnecting ? t('kubeActions:reasons.reconnecting') : t('errors:kubernetes.notConnected'));
const readOnlyReason = (): string => t('errors:kubernetes.readOnly');
const hasSelector = (row: KubeRow): boolean => Object.keys(row.selector ?? {}).length > 0;
const forbidden = (env: Env, ref: KubeRef, id: KubeAccessId): string | undefined => refAccessReason(env.ctx.state.access, env.ctx.status, ref, id);
const NO_SELECTOR_KEYS = {
  deployments: 'kubeActions:reasons.noSelectorWorkload', statefulsets: 'kubeActions:reasons.noSelectorWorkload', daemonsets: 'kubeActions:reasons.noSelectorWorkload',
  jobs: 'kubeActions:reasons.noSelectorJob', services: 'kubeActions:reasons.noSelectorService',
} as const;
const cell = (row: KubeRow, key: string): string => String(row.cells[key] ?? '').trim();

/** Copy group: heading plus the entries that exist; text null = a builder refused the name, undefined = field absent. */
function copyGroup(env: Env, entries: [id: string, label: string, text: string | null | undefined][]): Group {
  const items = entries.flatMap(([id, label, text]): MenuEntry[] => {
    if (text === undefined || text === '') return [];
    const run: MenuAction = { type: 'copy', text: text ?? '', label };
    return [item(env, `copy-${id}`, label, run, text === null ? { reason: t('kubeActions:reasons.invalidName') } : {})];
  });
  return items.length === 0 ? [] : [{ kind: 'heading', label: t('kubeActions:copy.heading') }, ...items];
}

const kubeActionItem = (env: Env, id: string, label: string, ref: KubeRef, action: KubeAction, options: Options & { replicas?: number } = {}): MenuEntry =>
  item(env, id, label, { type: 'kubeAction', ref, action, ...(options.replicas !== undefined ? { currentReplicas: options.replicas } : {}) },
    { hotkey: options.hotkey, reason: actionReason(action, { ref, readOnly: env.readOnly, connected: env.connected, reconnecting: env.reconnecting, access: env.ctx.state.access, status: env.ctx.status }) });

const namespaceOf = (row: KubeRow): string | undefined => row.ref.namespace;

function namespaceGroup(env: Env, row: KubeRow): MenuEntry[] {
  const namespace = namespaceOf(row);
  if (env.ctx.state.query.namespace !== null || !namespace) return [];
  return [item(env, 'namespace', t('kubeActions:menu.showNamespace', { namespace }), view(select(row), { type: 'setNamespace', namespace }))];
}

const podsOnNode = (env: Env, node: string, prefix: KubeViewAction[], id = 'node-pods', label = t('kubeActions:menu.podsOnNode', { node })): MenuEntry =>
  item(env, id, label, view(...prefix, { type: 'openQuery', query: { kind: 'pods', namespace: null, selector: { node } }, crumb: t('kubeActions:crumb.node', { name: node }) }));

function sshItem(env: Env, node: { name: string; ip?: string }): MenuEntry {
  const match = env.ctx.sshForNode(node);
  return match
    ? item(env, 'ssh', t('kubeActions:menu.ssh'), { type: 'ssh', connectionId: match.id }, { extra: match.name })
    : item(env, 'ssh', t('kubeActions:menu.ssh'), { type: 'ssh', connectionId: '' },
      { reason: env.ctx.canSsh === false ? t('kubeActions:reasons.noSshHere') : t('kubeActions:reasons.noSshForNode', { name: node.name }) });
}

function ownerItem(env: Env, row: KubeRow, kinds: KubeKind[]): MenuEntry[] {
  const owner = row.owner;
  if (!owner || !kinds.includes(owner.kind)) return [];
  return [item(env, 'owner', t('kubeActions:menu.showOwner', { kind: KIND_INFO[owner.kind].kind, name: owner.name }), view(select(row), { type: 'jump', ref: owner }))];
}

function viewItems(env: Env, prefix: KubeViewAction[], ofPod = false): MenuEntry[] {
  const reason = connectedReason(env);
  const labels = ofPod
    ? { events: t('kubeActions:menu.eventsOfPod'), yaml: t('kubeActions:menu.yamlOfPod'), describe: t('kubeActions:menu.describeOfPod') }
    : { events: t('kubeActions:menu.events'), yaml: t('kubeActions:menu.yaml'), describe: t('kubeActions:menu.describe') };
  return (['events', 'yaml', 'describe'] as const).map(id => item(env, id, labels[id], view(...prefix, dock(id)), { hotkey: id, reason }));
}

const SHELL_ARMED = (...actions: KubeViewAction[]): MenuAction => ({ type: 'view', actions, armShell: true });

/** Logs, previous logs and shell of one container; `prefix` selects the pod/container first. */
function terminalItems(env: Env, pod: KubeRow, container: string | undefined, prefix: KubeViewAction[], extra?: string): MenuEntry[] {
  const logsReason = (container ? connectedReason(env) : t('kubeActions:reasons.noContainer')) ?? forbidden(env, pod.ref, 'logs');
  const shellReason = (env.readOnly ? readOnlyReason() : connectedReason(env) ?? (podNotRunning(pod) ? t('kubeActions:reasons.notRunning') : undefined) ?? (container ? undefined : t('kubeActions:reasons.noContainer')))
    ?? forbidden(env, pod.ref, 'shell');
  return [
    { ...item(env, 'logs', t('kubeActions:menu.logs'), { type: 'view', actions: [...prefix, dock('logs')], previous: false }, { hotkey: 'logs', extra, reason: logsReason }) },
    item(env, 'previous', t('kubeActions:menu.previousLogs'), { type: 'view', actions: [...prefix, dock('logs')], previous: true }, { hotkey: 'previous', extra, reason: logsReason }),
    item(env, 'shell', t('kubeActions:menu.openShell'), SHELL_ARMED(...prefix, dock('shell')), { hotkey: 'shell', extra, reason: shellReason }),
  ];
}

function popoutItems(env: Env, pod: KubeRow, container: string | undefined, extra?: string): MenuEntry[] {
  const namespace = pod.ref.namespace ?? '';
  const make = (mode: KubeTerminalMode, id: string, label: string, reason: string | undefined): MenuEntry =>
    item(env, id, label, { type: 'popout', target: { namespace, pod: pod.ref.name, container: container ?? '', mode } },
      { hotkey: 'popout', extra, reason: env.ctx.canPopout ? reason : t('kubeActions:reasons.noPopout') });
  const logsReason = (connectedReason(env) ?? (container ? undefined : t('kubeActions:reasons.noContainer'))) ?? forbidden(env, pod.ref, 'logs');
  const shellReason = (env.readOnly ? readOnlyReason() : connectedReason(env) ?? (podNotRunning(pod) ? t('kubeActions:reasons.notRunning') : undefined) ?? (container ? undefined : t('kubeActions:reasons.noContainer')))
    ?? forbidden(env, pod.ref, 'shell');
  return [make('logs', 'popout-logs', t('kubeActions:menu.popoutLogs'), logsReason), make('shell', 'popout-shell', t('kubeActions:menu.popoutShell'), shellReason)];
}

/** "Port weiterleiten…": running pods; services with a selector and a TCP port. Read-only clusters allow it (it changes nothing). */
function forwardItem(env: Env, row: KubeRow): MenuEntry {
  const reason = (connectedReason(env) ?? (row.ref.kind === 'pods'
    ? (row.cells.status === 'Running' ? undefined : t('kubeActions:reasons.notRunning'))
    : !hasSelector(row) ? t('kubeActions:reasons.noSelectorService')
      : (row.ports?.length ?? 0) === 0 ? t('kubeActions:reasons.noTcpPort') : undefined)) ?? forbidden(env, row.ref, 'forward');
  return item(env, 'forward', t('kubeActions:menu.forward'), { type: 'forward', row }, { reason });
}

/** "Logs aller Pods": workloads, jobs and services with a selector. Reading, so read-only clusters allow it. */
function logsAllItem(env: Env, row: KubeRow): MenuEntry {
  const kind = row.ref.kind as keyof typeof NO_SELECTOR_KEYS;
  const reason = connectedReason(env) ?? (hasSelector(row) ? forbidden(env, row.ref, 'logsAll') : t(NO_SELECTOR_KEYS[kind]));
  return item(env, 'logs-all', t('kubeActions:menu.logsAll'), { type: 'logsAll', row }, { reason });
}

/** "Mit KI analysieren": pods, workloads and jobs; events through the object they concern. Reading only, so read-only clusters allow it. */
function analyzeItem(env: Env, ref: KubeRef, extra: { event?: KubeRef; problem?: ProblemKind } = {}): MenuEntry {
  const reason = connectedReason(env) ?? (DIAGNOSE_KINDS.includes(ref.kind) ? undefined : t('kubeActions:reasons.analyzeUnsupported', { kind: KIND_INFO[ref.kind].kind }));
  const problem = extra.problem ?? env.ctx.state.problems.find(item => refKey(item.ref) === refKey(ref))?.kind;
  const target: DiagnoseTarget = { ref, ...(extra.event ? { event: extra.event } : {}), ...(problem ? { problem } : {}) };
  return item(env, 'analyze', t('kubeActions:menu.analyze'), { type: 'analyze', target }, { reason });
}

function imageLines(row: KubeRow): string | undefined {
  const names = row.containers ?? Object.keys(row.cells).filter(key => key.startsWith('image:')).map(key => key.slice('image:'.length));
  const images = names.filter(name => cell(row, `image:${name}`) !== '').map(name => [name, cell(row, `image:${name}`)] as const);
  if (images.length === 0) return undefined;
  return images.length === 1 ? images[0][1] : images.map(([name, image]) => `${name}=${image}`).join('\n');
}

const namespacedName = (row: KubeRow): string | undefined => (row.ref.namespace ? `${row.ref.namespace}/${row.ref.name}` : undefined);

function filterItems(env: Env, row: KubeRow): MenuEntry[] {
  const entries = Object.entries(row.labels);
  const preferred = PREFERRED_LABELS.filter(key => key in row.labels).map(key => [key, row.labels[key]] as const);
  return (preferred.length > 0 ? preferred : entries).slice(0, 3).map(([key, value]) =>
    item(env, `filter-${key}=${value}`, t('kubeActions:menu.filterBy', { key, value }), view(select(row), { type: 'search', text: `${key}=${value}` })));
}

function podRowGroups(env: Env, row: KubeRow): Group[] {
  const { name } = row.ref;
  const namespace = namespaceOf(row) ?? '';
  const containers = row.containers ?? [];
  const first = containers[0];
  const extra = containers.length > 1 ? first : undefined;
  const prefix: KubeViewAction[] = [select(row), ...(first ? [{ type: 'selectContainer', name: first } as const] : [])];
  return [
    [
      item(env, 'drill', t('kubeActions:menu.showContainers'), view(select(row), { type: 'drill' }), { hotkey: 'drill' }),
      ...(row.node ? [podsOnNode(env, row.node, [select(row)])] : []),
      ...ownerItem(env, row, [...(Object.keys(KIND_INFO) as KubeKind[])]),
      ...namespaceGroup(env, row),
      ...filterItems(env, row),
    ],
    [...terminalItems(env, row, first, prefix, extra), ...viewItems(env, [select(row)]), ...popoutItems(env, row, first, extra), forwardItem(env, row), analyzeItem(env, row.ref)],
    copyGroup(env, [
      ['name', t('kubeActions:copy.name'), name],
      ['namespaced-name', t('kubeActions:copy.namespacedName'), namespacedName(row)],
      ['image', t('kubeActions:copy.image'), imageLines(row)],
      ['labels', t('kubeActions:copy.labels'), Object.keys(row.labels).length > 0 ? kubectl.labelsText(row.labels) : undefined],
      ['ip', t('kubeActions:copy.podIp'), row.ip],
      ['logs', 'kubectl logs -f', kubectl.logs(namespace, name, first)],
      ['exec', 'kubectl exec', kubectl.exec(namespace, name, first)],
      ['describe', 'kubectl describe', kubectl.describe('pods', namespace, name)],
      ...argoCopy(row),
    ]),
    [kubeActionItem(env, 'delete', t('kubeActions:menu.deletePod'), row.ref, 'delete', { hotkey: 'delete' })],
  ];
}

const argoCopy = (row: KubeRow): [string, string, string][] => (row.labels[ARGO_LABEL] ? [['argo', t('kubeActions:copy.argoApp'), row.labels[ARGO_LABEL]]] : []);

function workloadGroups(env: Env, row: KubeRow): Group[] {
  const { kind, name } = row.ref;
  const namespace = namespaceOf(row);
  const images = cell(row, 'image').split(',').map(part => part.trim()).filter(Boolean).join('\n');
  const scalable = kind === 'deployments' || kind === 'statefulsets';
  return [
    [
      item(env, 'drill', t('kubeActions:menu.showPods'), view(select(row), { type: 'drill' }), { hotkey: 'drill', reason: hasSelector(row) ? undefined : t('kubeActions:reasons.noSelectorWorkload') }),
      ...namespaceGroup(env, row),
    ],
    [logsAllItem(env, row), ...viewItems(env, [select(row)]), analyzeItem(env, row.ref)],
    copyGroup(env, [
      ['name', t('kubeActions:copy.name'), name],
      ['namespaced-name', t('kubeActions:copy.namespacedName'), namespacedName(row)],
      ['image', t('kubeActions:copy.image'), images],
      ['selector', t('kubeActions:copy.selector'), hasSelector(row) ? kubectl.selectorText(row.selector ?? {}) : undefined],
      ['labels', t('kubeActions:copy.labels'), Object.keys(row.labels).length > 0 ? kubectl.labelsText(row.labels) : undefined],
      ['restart', 'kubectl rollout restart', kubectl.rolloutRestart(kind, namespace, name)],
      ['scale', 'kubectl scale', scalable && row.replicas !== undefined ? kubectl.scale(kind, namespace, name, row.replicas) : undefined],
      ['status', 'kubectl rollout status', kubectl.rolloutStatus(kind, namespace, name)],
      ...argoCopy(row),
    ]),
    [
      kubeActionItem(env, 'restart', t('kubeActions:menu.restart'), row.ref, 'restart', { hotkey: 'restart' }),
      kubeActionItem(env, 'scale', t('kubeActions:menu.scale'), row.ref, 'scale', { hotkey: 'scale', replicas: row.replicas }),
    ],
  ];
}

function jobGroups(env: Env, row: KubeRow): Group[] {
  const { name } = row.ref;
  const namespace = namespaceOf(row) ?? '';
  return [
    [
      item(env, 'drill', t('kubeActions:menu.showPods'), view(select(row), { type: 'drill' }), { hotkey: 'drill', reason: hasSelector(row) ? undefined : t('kubeActions:reasons.noSelectorJob') }),
      ...ownerItem(env, row, ['cronjobs']),
      ...namespaceGroup(env, row),
    ],
    [logsAllItem(env, row), ...viewItems(env, [select(row)]), analyzeItem(env, row.ref)],
    copyGroup(env, [
      ['name', t('kubeActions:copy.name'), name],
      ['namespaced-name', t('kubeActions:copy.namespacedName'), namespacedName(row)],
      ['logs', 'kubectl logs', kubectl.logsJob(namespace, name)],
      ['describe', 'kubectl describe', kubectl.describe('jobs', namespace, name)],
      ...argoCopy(row),
    ]),
    [kubeActionItem(env, 'delete', t('kubeActions:menu.deleteJob'), row.ref, 'delete', { hotkey: 'delete' })],
  ];
}

function cronJobGroups(env: Env, row: KubeRow): Group[] {
  const { name } = row.ref;
  const namespace = namespaceOf(row) ?? '';
  const suspended = row.suspended === true;
  return [
    [item(env, 'drill', t('kubeActions:menu.showJobs'), view(select(row), { type: 'openQuery', query: { kind: 'jobs', namespace: row.ref.namespace ?? null }, crumb: t('kubeActions:crumb.cronJob', { name }) },
      { type: 'search', text: `owner:${name}` }), { hotkey: 'drill' })],
    viewItems(env, [select(row)]),
    copyGroup(env, [
      ['name', t('kubeActions:copy.name'), name],
      ['schedule', t('kubeActions:copy.schedule'), cell(row, 'schedule')],
      ['create-job', 'kubectl create job', kubectl.createJobFromCron(namespace, name, Math.floor(env.ctx.now / 1000))],
      ['patch', t(suspended ? 'kubeActions:copy.patchResume' : 'kubeActions:copy.patchSuspend'), kubectl.patchSuspend(namespace, name, !suspended)],
      ...argoCopy(row),
    ]),
    [
      suspended
        ? kubeActionItem(env, 'resume', t('kubeActions:menu.resume'), row.ref, 'resume')
        : kubeActionItem(env, 'suspend', t('kubeActions:menu.suspend'), row.ref, 'suspend'),
      kubeActionItem(env, 'trigger', t('kubeActions:menu.trigger'), row.ref, 'trigger'),
    ],
  ];
}

const firstPort = (ports: string): number | undefined => {
  const match = /(\d+)/.exec(ports);
  return match ? Number(match[1]) : undefined;
};

function serviceGroups(env: Env, row: KubeRow): Group[] {
  const { name } = row.ref;
  const namespace = namespaceOf(row) ?? '';
  const ip = cell(row, 'clusterIp');
  const ports = cell(row, 'ports');
  const port = firstPort(ports);
  return [
    [item(env, 'drill', t('kubeActions:menu.showPods'), view(select(row), { type: 'drill' }),
      { hotkey: 'drill', reason: hasSelector(row) ? undefined : t('kubeActions:reasons.noSelectorService') }), forwardItem(env, row)],
    [logsAllItem(env, row), ...viewItems(env, [select(row)])],
    copyGroup(env, [
      ['name', t('kubeActions:copy.name'), name],
      ['cluster-ip', t('kubeActions:copy.clusterIp'), ip === 'None' || ip === '-' ? undefined : ip],
      ['dns', t('kubeActions:copy.dns'), kubectl.serviceDns(namespace, name)],
      ['ports', t('kubeActions:copy.ports'), ports === '-' ? undefined : ports],
      ['selector', t('kubeActions:copy.selector'), hasSelector(row) ? kubectl.selectorText(row.selector ?? {}) : undefined],
      ['port-forward', 'kubectl port-forward', port === undefined ? undefined : kubectl.portForward(namespace, name, port)],
      ...argoCopy(row),
    ]),
  ];
}

function ingressGroups(env: Env, row: KubeRow): Group[] {
  const hosts = cell(row, 'hosts');
  const names = hosts.split(/[,\s]+/).filter(host => /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i.test(host));
  const address = cell(row, 'address');
  return [
    viewItems(env, [select(row)]),
    copyGroup(env, [
      ['name', t('kubeActions:copy.name'), row.ref.name],
      ['hosts', t('kubeActions:copy.hosts'), hosts === '-' ? undefined : hosts],
      ['urls', t('kubeActions:copy.urls'), names.length > 0 ? names.map(host => `https://${host}`).join('\n') : undefined],
      ['address', t('kubeActions:copy.address'), address === '-' ? undefined : address],
      ...argoCopy(row),
    ]),
  ];
}

function nodeRowGroups(env: Env, row: KubeRow): Group[] {
  const { name } = row.ref;
  const unschedulable = row.unschedulable === true;
  return [
    [item(env, 'drill', t('kubeActions:menu.podsOnThisNode'), view(select(row), { type: 'drill' }), { hotkey: 'drill' })],
    [...viewItems(env, [select(row)]), sshItem(env, { name, ip: row.ip })],
    copyGroup(env, [
      ['name', t('kubeActions:copy.name'), name],
      ['ip', t('kubeActions:copy.internalIp'), row.ip],
      ['version', t('kubeActions:copy.kubeletVersion'), cell(row, 'version')],
      ['describe', 'kubectl describe', kubectl.describe('nodes', undefined, name)],
      ['drain', 'kubectl drain', kubectl.drain(name)],
      unschedulable ? ['uncordon', 'kubectl uncordon', kubectl.uncordon(name)] : ['cordon', 'kubectl cordon', kubectl.cordon(name)],
      ...argoCopy(row),
    ]),
    [unschedulable
      ? kubeActionItem(env, 'uncordon', t('kubeActions:menu.uncordon'), row.ref, 'uncordon')
      : kubeActionItem(env, 'cordon', t('kubeActions:menu.cordon'), row.ref, 'cordon')],
  ];
}

/** The object an event is about: the mapped ref, or a `Kind/name` parse of the object cell as fallback. */
function involvedOf(row: KubeRow): { kind: string; name: string; ref?: KubeRef } | undefined {
  if (row.involved) return row.involved;
  const [kind, name] = cell(row, 'object').split('/');
  if (!kind || !name) return undefined;
  const mapped = (Object.keys(KIND_INFO) as KubeKind[]).find(candidate => KIND_INFO[candidate].kind === kind);
  if (!mapped) return { kind, name };
  return { kind, name, ref: { kind: mapped, ...(KIND_INFO[mapped].namespaced && row.ref.namespace ? { namespace: row.ref.namespace } : {}), name } };
}

const involvedReason = (involved: { kind: string; ref?: KubeRef }): string | undefined =>
  involved.ref ? undefined : t('kubeActions:reasons.involvedUnsupported', { kind: involved.kind });

function eventGroups(env: Env, row: KubeRow): Group[] {
  const involved = involvedOf(row);
  const ref = involved?.ref;
  const reason = involved ? involvedReason(involved) : undefined;
  const jumpTo = (...actions: KubeViewAction[]): MenuAction => view(select(row), ...(ref ? [{ type: 'jump', ref } as const] : []), ...actions);
  const label = involved ? `${involved.kind} ${involved.name}` : '';
  const viaConnection = reason ?? connectedReason(env);
  const nav: Group = involved ? [item(env, 'involved', t('kubeActions:menu.showObject', { label }), jumpTo(), { reason })] : [];
  const views: Group = involved ? [
    item(env, 'involved-events', t('kubeActions:menu.objectEvents'), jumpTo(dock('events')), { reason: viaConnection }),
    item(env, 'involved-describe', t('kubeActions:menu.objectDescribe'), jumpTo(dock('describe')), { reason: viaConnection }),
    ...(ref?.kind === 'pods' ? [item(env, 'involved-logs', t('kubeActions:menu.podLogs'), { type: 'view', actions: [select(row), { type: 'jump', ref }, dock('logs')], previous: false }, { reason: viaConnection ?? forbidden(env, ref, 'logs') })] : []),
    involved.ref ? analyzeItem(env, involved.ref, { event: row.ref })
      : item(env, 'analyze', t('kubeActions:menu.analyze'), { type: 'analyze', target: { ref: row.ref } }, { reason: involvedReason(involved) }),
  ] : [];
  return [nav, views, copyGroup(env, [
    ['message', t('kubeActions:copy.message'), cell(row, 'message')],
    ['object', t('kubeActions:copy.object'), involved ? `${involved.kind}/${involved.name}` : undefined],
    ['reason', t('kubeActions:copy.reason'), cell(row, 'reason')],
  ])];
}

function rowMenu(env: Env, row: KubeRow): MenuEntry[] {
  const argo = row.labels[ARGO_LABEL];
  const lead: MenuEntry[] = argo ? [{ kind: 'heading', label: t('kubeActions:menu.argoApp', { name: argo }) }] : [];
  const groups = ((): Group[] => {
    switch (row.ref.kind) {
      case 'pods': return podRowGroups(env, row);
      case 'deployments': case 'statefulsets': case 'daemonsets': return workloadGroups(env, row);
      case 'jobs': return jobGroups(env, row);
      case 'cronjobs': return cronJobGroups(env, row);
      case 'services': return serviceGroups(env, row);
      case 'ingresses': return ingressGroups(env, row);
      case 'nodes': return nodeRowGroups(env, row);
      case 'events': return eventGroups(env, row);
    }
  })();
  const chip = primaryChip(row.ref.kind, row, env.ctx.now);
  if (chip && groups.length > 0) {
    groups[0] = [...groups[0], item(env, `only-${chip.id}`, t('kubeActions:menu.onlyChip', { label: chipLabel(chip.id, row.ref.kind) }), view(select(row), { type: 'setChips', ids: [chip.id] }))];
  }
  return assemble(lead, groups);
}

function containerMenu(env: Env, pod: KubeRow, name: string): MenuEntry[] {
  const drilled = env.ctx.state.containersOf !== null && refKey(env.ctx.state.containersOf.ref) === refKey(pod.ref);
  const podPrefix: KubeViewAction[] = drilled ? [] : [select(pod)];
  const prefix: KubeViewAction[] = [...podPrefix, { type: 'selectContainer', name }];
  const namespace = namespaceOf(pod) ?? '';
  return assemble([], [
    [...terminalItems(env, pod, name, prefix), ...popoutItems(env, pod, name), ...viewItems(env, podPrefix, true)],
    copyGroup(env, [
      ['name', t('kubeActions:copy.containerName'), name],
      ['image', t('kubeActions:copy.image'), cell(pod, `image:${name}`)],
      ['logs', 'kubectl logs -f', kubectl.logs(namespace, pod.ref.name, name)],
      ['exec', 'kubectl exec', kubectl.exec(namespace, pod.ref.name, name)],
    ]),
    [kubeActionItem(env, 'delete', t('kubeActions:menu.deletePod'), pod.ref, 'delete', { hotkey: 'delete' })],
  ]);
}

function nodeStateText(tile: NodeTile): string {
  return [t(tile.ready ? 'kubeActions:menu.nodeReady' : 'kubeActions:menu.nodeNotReady'), ...tile.pressure, ...(tile.unschedulable ? [t('kubeActions:menu.nodeCordoned')] : [])].join(', ');
}

function nodeTileMenu(env: Env, tile: NodeTile): MenuEntry[] {
  const ref: KubeRef = { kind: 'nodes', name: tile.name };
  const reason = connectedReason(env);
  const onNode = (id: string, label: string, mode: DockMode): MenuEntry => item(env, id, label, view({ type: 'jump', ref }, dock(mode)), { reason });
  return assemble([{ kind: 'heading', label: `${tile.name} · ${nodeStateText(tile)}` }], [
    [item(env, 'node', t('kubeActions:menu.showNode'), view({ type: 'jump', ref })), podsOnNode(env, tile.name, [], 'node-pods', t('kubeActions:menu.podsOnThisNode'))],
    [onNode('describe', t('kubeActions:menu.describe'), 'describe'), onNode('events', t('kubeActions:menu.events'), 'events'), onNode('yaml', t('kubeActions:menu.yaml'), 'yaml'), sshItem(env, { name: tile.name, ip: tile.ip })],
    copyGroup(env, [['name', t('kubeActions:copy.name'), tile.name], ['ip', t('kubeActions:copy.internalIp'), tile.ip]]),
    [tile.unschedulable
      ? kubeActionItem(env, 'uncordon', t('kubeActions:menu.uncordon'), ref, 'uncordon')
      : kubeActionItem(env, 'cordon', t('kubeActions:menu.cordon'), ref, 'cordon')],
  ]);
}

function problemMenu(env: Env, problem: KubeProblem): MenuEntry[] {
  const { ref, kind } = problem;
  const reason = connectedReason(env);
  const jump: KubeViewAction = { type: 'jump', ref };
  const crashes = kind === 'crashloop' || kind === 'oomkilled';
  const podProblem = kind !== 'node';
  const namespace = ref.namespace ?? '';
  const nodeTile = env.ctx.state.nodes.find(tile => tile.name === ref.name);
  const logsReason = reason ?? forbidden(env, ref, 'logs');
  return assemble([], [
    [
      item(env, 'show', t('kubeActions:menu.show'), view(jump)),
      ...(kind === 'node' ? [podsOnNode(env, ref.name, [], 'node-pods', t('kubeActions:menu.podsOnThisNode'))] : []),
    ],
    [
      ...(crashes ? [item(env, 'previous', t('kubeActions:menu.previousLogs'), { type: 'view', actions: [jump, dock('logs')], previous: true }, { reason: logsReason })] : []),
      ...(podProblem ? [item(env, 'logs', t('kubeActions:menu.logs'), { type: 'view', actions: [jump, dock('logs')], previous: false }, { reason: logsReason })] : []),
      item(env, 'describe', t('kubeActions:menu.describe'), view(jump, dock('describe')), { reason }),
      item(env, 'events', t('kubeActions:menu.events'), view(jump, dock('events')), { reason }),
      ...(podProblem ? [analyzeItem(env, ref, { problem: kind })] : []),
      ...(kind === 'node' ? [sshItem(env, { name: ref.name, ip: nodeTile?.ip })] : []),
    ],
    copyGroup(env, [
      ['name', t('kubeActions:copy.name'), ref.name],
      ['namespaced-name', t('kubeActions:copy.namespacedName'), ref.namespace ? `${ref.namespace}/${ref.name}` : undefined],
      ['message', t('kubeActions:copy.message'), errorText(problem.error)],
      ['logs', 'kubectl logs --previous', crashes ? kubectl.logs(namespace, ref.name, undefined, true) : undefined],
    ]),
    podProblem ? [kubeActionItem(env, 'delete', t('kubeActions:menu.deletePod'), ref, 'delete')] : [],
  ]);
}

function dockMenu(env: Env, target: Extract<MenuTarget, { type: 'dock' }>): MenuEntry[] {
  const { pod, container, previous, mode } = target;
  const reason = connectedReason(env);
  const podOnly = pod ? undefined : t('kubeActions:reasons.onlyPods');
  const containers = pod?.containers ?? [];
  const terminalMode = mode === 'logs' || mode === 'shell';
  const popoutMode: KubeTerminalMode = mode === 'shell' ? 'shell' : previous ? 'previous' : 'logs';
  const popoutReason = !env.ctx.canPopout ? t('kubeActions:reasons.noPopout') : !pod || !container ? t('kubeActions:reasons.onlyPods')
    : mode === 'shell' ? (env.readOnly ? readOnlyReason() : reason ?? (podNotRunning(pod) ? t('kubeActions:reasons.notRunning') : undefined)) : reason;
  const logsReason = podOnly ?? reason ?? (pod ? forbidden(env, pod.ref, 'logs') : undefined);
  const shellReason = (podOnly ?? (env.readOnly ? readOnlyReason() : reason ?? (podNotRunning(pod) ? t('kubeActions:reasons.notRunning') : undefined)))
    ?? (pod ? forbidden(env, pod.ref, 'shell') : undefined);
  return assemble([], [
    [
      item(env, 'mode-logs', t('kubeActions:menu.logs'), { type: 'view', actions: [dock('logs')], previous: false }, { hotkey: 'logs', reason: logsReason }),
      item(env, 'mode-shell', t('kubeActions:menu.shell'), SHELL_ARMED(dock('shell')), { hotkey: 'shell', reason: shellReason }),
      item(env, 'mode-events', t('kubeActions:menu.events'), view(dock('events')), { hotkey: 'events', reason }),
      item(env, 'mode-yaml', t('kubeActions:menu.yaml'), view(dock('yaml')), { hotkey: 'yaml', reason }),
      item(env, 'mode-describe', t('kubeActions:menu.describe'), view(dock('describe')), { hotkey: 'describe', reason }),
    ],
    [
      ...(mode === 'logs' ? [item(env, 'previous', t(previous ? 'kubeActions:menu.currentLogs' : 'kubeActions:menu.previousLogs'),
        { type: 'view', actions: [], previous: !previous }, { hotkey: previous ? undefined : 'previous', reason: logsReason })] : []),
      ...(pod && containers.length > 1 ? containers.map(name =>
        item(env, `container-${name}`, t('kubeActions:menu.container', { name }), view({ type: 'selectContainer', name }), { extra: name === container ? t('kubeActions:menu.active') : undefined, reason })) : []),
      ...(mode === 'logs' && pod && container ? [item(env, 'reload', t('kubeActions:menu.reloadLogs'), { type: 'dockReload' }, { reason })] : []),
      ...(terminalMode ? [item(env, 'popout', t('kubeActions:menu.popout'),
        { type: 'popout', target: { namespace: pod?.ref.namespace ?? '', pod: pod?.ref.name ?? '', container: container ?? '', mode: popoutMode } },
        { hotkey: 'popout', reason: popoutReason })] : []),
    ],
    [item(env, 'toggle', t('kubeActions:menu.collapsePanel'), view({ type: 'toggleDock' }), { hotkey: 'toggleDock' })],
  ]);
}

function dockTextMenu(env: Env, target: Extract<MenuTarget, { type: 'dockText' }>): MenuEntry[] {
  const entries: [string, string, string | undefined][] = [
    [target.mode, t(target.mode === 'yaml' ? 'kubeActions:menu.copyYaml' : 'kubeActions:menu.copyDescribe'), target.text],
    ['selection', t('kubeActions:menu.copySelection'), target.selection],
  ];
  return assemble([], [copyGroup(env, entries)]);
}

function dockEventMenu(env: Env, row: KubeRow): MenuEntry[] {
  const involved = involvedOf(row);
  return assemble([], [
    involved?.ref ? [item(env, 'involved', t('kubeActions:menu.jumpToObject'), view({ type: 'jump', ref: involved.ref }))]
      : involved ? [item(env, 'involved', t('kubeActions:menu.jumpToObject'), view(), { reason: involvedReason(involved) })] : [],
    copyGroup(env, [['message', t('kubeActions:menu.copyMessage'), cell(row, 'message')]]),
  ]);
}

/** "Sortierung aufheben": disabled while the sort already equals the default of the kind (C21). */
function sortClearItem(env: Env): MenuEntry {
  const { sort, query } = env.ctx.state;
  const standard = defaultSort(query.kind);
  const atDefault = sort === null || standard === null ? sort === standard : sort.key === standard.key && sort.descending === standard.descending;
  return { kind: 'item', id: 'sort-clear', label: t('kubeActions:menu.sortClear'), hint: t(standard ? 'kubeActions:menu.sortHintEvents' : 'kubeActions:menu.sortHintArrival'), ...(atDefault ? { disabled: true } : {}), run: view({ type: 'sortBy', sort: null }) };
}

function headerMenu(env: Env, column: ColumnInfo): MenuEntry[] {
  const sort = (descending: boolean): MenuAction => view({ type: 'sortBy', sort: { key: column.key, descending } });
  return [
    item(env, 'sort-asc', t('kubeActions:menu.sortAsc'), sort(false)),
    item(env, 'sort-desc', t('kubeActions:menu.sortDesc'), sort(true)),
    sortClearItem(env),
  ];
}

function backgroundMenu(env: Env): MenuEntry[] {
  const { state, status } = env.ctx;
  const filter = filterOf(state);
  const all = state.query.namespace === null;
  const back = status?.namespace ?? 'default';
  return assemble([], [
    [
      item(env, 'filter-reset', t('kubeActions:menu.filterReset'), view({ type: 'clearFilter' }), { extra: 'F', reason: filter.text !== '' || filter.chips.length > 0 || Object.keys(filter.columns ?? {}).length > 0 ? undefined : t('kubeActions:reasons.noFilter') }),
      item(env, 'search-clear', t('kubeActions:menu.searchClear'), view({ type: 'search', text: '' }), { reason: filter.text !== '' ? undefined : t('kubeActions:reasons.noTextFilter') }),
      item(env, 'chips-clear', t('kubeActions:menu.chipsClear'), view({ type: 'setChips', ids: [] }), { reason: filter.chips.length > 0 ? undefined : t('kubeActions:reasons.noChipFilter') }),
      item(env, 'group-clear', t('kubeActions:menu.groupClear'), view({ type: 'setGroupBy', groupBy: null }), { reason: state.groups[state.query.kind] ? undefined : t('kubeActions:reasons.noGrouping') }),
      all ? item(env, 'namespace', t('kubeActions:menu.backTo', { namespace: back }), view({ type: 'setNamespace', namespace: back }))
        : item(env, 'namespace', t('kubeActions:menu.allNamespaces'), view({ type: 'setNamespace', namespace: null })),
      sortClearItem(env),
    ],
    [item(env, 'help', t('kubeActions:menu.help'), { type: 'help' }, { extra: '?' })],
  ]);
}

export function menuFor(target: MenuTarget, context: MenuContext): MenuEntry[] {
  const hot = target.type === 'row' || target.type === 'container' || target.type === 'dock';
  const env: Env = { ctx: context, connected: context.status?.state === 'ready', reconnecting: context.status?.state === 'reconnecting', readOnly: context.status?.readOnly ?? true, hot };
  switch (target.type) {
    case 'row': return rowMenu(env, target.row);
    case 'container': return containerMenu(env, target.pod, target.name);
    case 'node': return nodeTileMenu(env, target.tile);
    case 'problem': return problemMenu(env, target.problem);
    case 'dock': return dockMenu(env, target);
    case 'dockText': return dockTextMenu(env, target);
    case 'dockEvent': return dockEventMenu(env, target.row);
    case 'header': return headerMenu(env, target.column);
    case 'background': return backgroundMenu(env);
  }
}
