/** Context menus of the cluster tab as pure data; see docs/superpowers/specs/2026-10-16-kubernetes-context-menus-design.md. */
import {
  KIND_INFO, NOT_CONNECTED_MESSAGE, READ_ONLY_MESSAGE, refKey,
  type ClusterStatus, type ColumnInfo, type DockMode, type KubeAction, type KubeKind, type KubeProblem, type KubeRef, type KubeRow, type KubeTerminalMode, type KubeTerminalTarget, type NodeTile,
} from '../../shared/kubernetes';
import { KUBE_COMMANDS, actionReason, podNotRunning, type CommandId } from './kube-commands';
import * as kubectl from './kube-kubectl';
import { primaryChip } from '../../shared/kube-status';
import { defaultSort, filterOf, type KubeViewAction, type KubeViewState } from './kube-view';

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
  | { type: 'popout'; target: KubeTerminalTarget }
  | { type: 'ssh'; connectionId: string }
  | { type: 'dockReload' }
  | { type: 'help' };

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
const INVALID_NAME = 'Name enthält ungültige Zeichen.';
const NO_POPOUT = 'Hier lässt sich kein Tab öffnen.';
const NO_CONTAINER = 'Der Pod hat keine Container.';
const NOT_RUNNING = 'Der Pod läuft nicht.';
const ONLY_PODS = 'Nur für Pods.';
const SORT_HINT = 'Standard: Reihenfolge des Eintreffens';
const EVENTS_SORT_HINT = 'Standard: Zuletzt absteigend';
const PREFERRED_LABELS = ['app', 'app.kubernetes.io/name', 'app.kubernetes.io/instance', 'app.kubernetes.io/component'];

interface Env { ctx: MenuContext; connected: boolean; readOnly: boolean; /** Hotkey hints only for targets that are the selection. */ hot: boolean }
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
const connectedReason = (env: Env): string | undefined => (env.connected ? undefined : NOT_CONNECTED_MESSAGE);
const hasSelector = (row: KubeRow): boolean => Object.keys(row.selector ?? {}).length > 0;
const cell = (row: KubeRow, key: string): string => String(row.cells[key] ?? '').trim();

/** Copy group: heading plus the entries that exist; text null = a builder refused the name, undefined = field absent. */
function copyGroup(env: Env, entries: [id: string, label: string, text: string | null | undefined][]): Group {
  const items = entries.flatMap(([id, label, text]): MenuEntry[] => {
    if (text === undefined || text === '') return [];
    const run: MenuAction = { type: 'copy', text: text ?? '', label };
    return [item(env, `copy-${id}`, label, run, text === null ? { reason: INVALID_NAME } : {})];
  });
  return items.length === 0 ? [] : [{ kind: 'heading', label: 'Kopieren' }, ...items];
}

const kubeActionItem = (env: Env, id: string, label: string, ref: KubeRef, action: KubeAction, options: Options & { replicas?: number } = {}): MenuEntry =>
  item(env, id, label, { type: 'kubeAction', ref, action, ...(options.replicas !== undefined ? { currentReplicas: options.replicas } : {}) },
    { hotkey: options.hotkey, reason: actionReason(action, { ref, readOnly: env.readOnly, connected: env.connected }) });

const namespaceOf = (row: KubeRow): string | undefined => row.ref.namespace;

function namespaceGroup(env: Env, row: KubeRow): MenuEntry[] {
  const namespace = namespaceOf(row);
  if (env.ctx.state.query.namespace !== null || !namespace) return [];
  return [item(env, 'namespace', `Namespace ${namespace} anzeigen`, view(select(row), { type: 'setNamespace', namespace }))];
}

const podsOnNode = (env: Env, node: string, prefix: KubeViewAction[], id = 'node-pods', label = `Pods auf Node ${node} anzeigen`): MenuEntry =>
  item(env, id, label, view(...prefix, { type: 'openQuery', query: { kind: 'pods', namespace: null, selector: { node } }, crumb: `Node ${node}` }));

function sshItem(env: Env, node: { name: string; ip?: string }): MenuEntry {
  const match = env.ctx.sshForNode(node);
  return match
    ? item(env, 'ssh', 'SSH-Verbindung öffnen', { type: 'ssh', connectionId: match.id }, { extra: match.name })
    : item(env, 'ssh', 'SSH-Verbindung öffnen', { type: 'ssh', connectionId: '' },
      { reason: env.ctx.canSsh === false ? 'Hier lässt sich keine Verbindung öffnen.' : `Keine SSH-Verbindung für ${node.name} im Vault.` });
}

function ownerItem(env: Env, row: KubeRow, kinds: KubeKind[]): MenuEntry[] {
  const owner = row.owner;
  if (!owner || !kinds.includes(owner.kind)) return [];
  return [item(env, 'owner', `${KIND_INFO[owner.kind].kind} ${owner.name} anzeigen`, view(select(row), { type: 'jump', ref: owner }))];
}

function viewItems(env: Env, prefix: KubeViewAction[], suffix = ''): MenuEntry[] {
  const reason = connectedReason(env);
  return ([['events', 'Events', 'events'], ['yaml', 'YAML', 'yaml'], ['describe', 'Describe', 'describe']] as const).map(([id, label, mode]) =>
    item(env, id, `${label}${suffix}`, view(...prefix, dock(mode)), { hotkey: id, reason }));
}

const SHELL_ARMED = (...actions: KubeViewAction[]): MenuAction => ({ type: 'view', actions, armShell: true });

/** Logs, previous logs and shell of one container; `prefix` selects the pod/container first. */
function terminalItems(env: Env, pod: KubeRow, container: string | undefined, prefix: KubeViewAction[], extra?: string): MenuEntry[] {
  const logsReason = container ? connectedReason(env) : NO_CONTAINER;
  const shellReason = env.readOnly ? READ_ONLY_MESSAGE : connectedReason(env) ?? (podNotRunning(pod) ? NOT_RUNNING : undefined) ?? (container ? undefined : NO_CONTAINER);
  return [
    { ...item(env, 'logs', 'Logs', { type: 'view', actions: [...prefix, dock('logs')], previous: false }, { hotkey: 'logs', extra, reason: logsReason }) },
    item(env, 'previous', 'Logs des vorherigen Containers', { type: 'view', actions: [...prefix, dock('logs')], previous: true }, { hotkey: 'previous', extra, reason: logsReason }),
    item(env, 'shell', 'Shell öffnen', SHELL_ARMED(...prefix, dock('shell')), { hotkey: 'shell', extra, reason: shellReason }),
  ];
}

function popoutItems(env: Env, pod: KubeRow, container: string | undefined, extra?: string): MenuEntry[] {
  const namespace = pod.ref.namespace ?? '';
  const make = (mode: KubeTerminalMode, id: string, label: string, reason: string | undefined): MenuEntry =>
    item(env, id, label, { type: 'popout', target: { namespace, pod: pod.ref.name, container: container ?? '', mode } },
      { hotkey: 'popout', extra, reason: env.ctx.canPopout ? reason : NO_POPOUT });
  const logsReason = connectedReason(env) ?? (container ? undefined : NO_CONTAINER);
  const shellReason = env.readOnly ? READ_ONLY_MESSAGE : connectedReason(env) ?? (podNotRunning(pod) ? NOT_RUNNING : undefined) ?? (container ? undefined : NO_CONTAINER);
  return [make('logs', 'popout-logs', 'Logs als Tab öffnen', logsReason), make('shell', 'popout-shell', 'Shell als Tab öffnen', shellReason)];
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
    item(env, `filter-${key}=${value}`, `Filtern: ${key}=${value}`, view(select(row), { type: 'search', text: `${key}=${value}` })));
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
      item(env, 'drill', 'Container anzeigen', view(select(row), { type: 'drill' }), { hotkey: 'drill' }),
      ...(row.node ? [podsOnNode(env, row.node, [select(row)])] : []),
      ...ownerItem(env, row, [...(Object.keys(KIND_INFO) as KubeKind[])]),
      ...namespaceGroup(env, row),
      ...filterItems(env, row),
    ],
    [...terminalItems(env, row, first, prefix, extra), ...viewItems(env, [select(row)]), ...popoutItems(env, row, first, extra)],
    copyGroup(env, [
      ['name', 'Name', name],
      ['namespaced-name', 'Namespace/Name', namespacedName(row)],
      ['image', 'Image', imageLines(row)],
      ['labels', 'Labels', Object.keys(row.labels).length > 0 ? kubectl.labelsText(row.labels) : undefined],
      ['ip', 'Pod-IP', row.ip],
      ['logs', 'kubectl logs -f', kubectl.logs(namespace, name, first)],
      ['exec', 'kubectl exec', kubectl.exec(namespace, name, first)],
      ['describe', 'kubectl describe', kubectl.describe('pods', namespace, name)],
      ...argoCopy(row),
    ]),
    [kubeActionItem(env, 'delete', 'Pod löschen…', row.ref, 'delete', { hotkey: 'delete' })],
  ];
}

const argoCopy = (row: KubeRow): [string, string, string][] => (row.labels[ARGO_LABEL] ? [['argo', 'Argo-App-Name', row.labels[ARGO_LABEL]]] : []);

function workloadGroups(env: Env, row: KubeRow): Group[] {
  const { kind, name } = row.ref;
  const namespace = namespaceOf(row);
  const images = cell(row, 'image').split(',').map(part => part.trim()).filter(Boolean).join('\n');
  const scalable = kind === 'deployments' || kind === 'statefulsets';
  return [
    [
      item(env, 'drill', 'Pods anzeigen', view(select(row), { type: 'drill' }), { hotkey: 'drill', reason: hasSelector(row) ? undefined : 'Dieser Workload hat keinen Selector.' }),
      ...namespaceGroup(env, row),
    ],
    viewItems(env, [select(row)]),
    copyGroup(env, [
      ['name', 'Name', name],
      ['namespaced-name', 'Namespace/Name', namespacedName(row)],
      ['image', 'Image', images],
      ['selector', 'Selector', hasSelector(row) ? kubectl.selectorText(row.selector ?? {}) : undefined],
      ['labels', 'Labels', Object.keys(row.labels).length > 0 ? kubectl.labelsText(row.labels) : undefined],
      ['restart', 'kubectl rollout restart', kubectl.rolloutRestart(kind, namespace, name)],
      ['scale', 'kubectl scale', scalable && row.replicas !== undefined ? kubectl.scale(kind, namespace, name, row.replicas) : undefined],
      ['status', 'kubectl rollout status', kubectl.rolloutStatus(kind, namespace, name)],
      ...argoCopy(row),
    ]),
    [
      kubeActionItem(env, 'restart', 'Rollout neu starten…', row.ref, 'restart', { hotkey: 'restart' }),
      kubeActionItem(env, 'scale', 'Skalieren…', row.ref, 'scale', { hotkey: 'scale', replicas: row.replicas }),
    ],
  ];
}

function jobGroups(env: Env, row: KubeRow): Group[] {
  const { name } = row.ref;
  const namespace = namespaceOf(row) ?? '';
  return [
    [
      item(env, 'drill', 'Pods anzeigen', view(select(row), { type: 'drill' }), { hotkey: 'drill', reason: hasSelector(row) ? undefined : 'Dieser Job hat keinen Selector.' }),
      ...ownerItem(env, row, ['cronjobs']),
      ...namespaceGroup(env, row),
    ],
    viewItems(env, [select(row)]),
    copyGroup(env, [
      ['name', 'Name', name],
      ['namespaced-name', 'Namespace/Name', namespacedName(row)],
      ['logs', 'kubectl logs', kubectl.logsJob(namespace, name)],
      ['describe', 'kubectl describe', kubectl.describe('jobs', namespace, name)],
      ...argoCopy(row),
    ]),
    [kubeActionItem(env, 'delete', 'Job löschen…', row.ref, 'delete', { hotkey: 'delete' })],
  ];
}

function cronJobGroups(env: Env, row: KubeRow): Group[] {
  const { name } = row.ref;
  const namespace = namespaceOf(row) ?? '';
  const suspended = row.suspended === true;
  return [
    [item(env, 'drill', 'Jobs anzeigen', view(select(row), { type: 'openQuery', query: { kind: 'jobs', namespace: row.ref.namespace ?? null }, crumb: `CronJob ${name}` },
      { type: 'search', text: `owner:${name}` }), { hotkey: 'drill' })],
    viewItems(env, [select(row)]),
    copyGroup(env, [
      ['name', 'Name', name],
      ['schedule', 'Zeitplan', cell(row, 'schedule')],
      ['create-job', 'kubectl create job', kubectl.createJobFromCron(namespace, name, Math.floor(env.ctx.now / 1000))],
      ['patch', suspended ? 'kubectl patch (fortsetzen)' : 'kubectl patch (anhalten)', kubectl.patchSuspend(namespace, name, !suspended)],
      ...argoCopy(row),
    ]),
    [
      suspended
        ? kubeActionItem(env, 'resume', 'Fortsetzen…', row.ref, 'resume')
        : kubeActionItem(env, 'suspend', 'Anhalten…', row.ref, 'suspend'),
      kubeActionItem(env, 'trigger', 'Jetzt ausführen…', row.ref, 'trigger'),
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
    [item(env, 'drill', 'Pods anzeigen', view(select(row), { type: 'drill' }),
      { hotkey: 'drill', reason: hasSelector(row) ? undefined : 'Dieser Service hat keinen Selector, z. B. ExternalName.' })],
    viewItems(env, [select(row)]),
    copyGroup(env, [
      ['name', 'Name', name],
      ['cluster-ip', 'Cluster-IP', ip === 'None' || ip === '-' ? undefined : ip],
      ['dns', 'DNS-Name', kubectl.serviceDns(namespace, name)],
      ['ports', 'Ports', ports === '-' ? undefined : ports],
      ['selector', 'Selector', hasSelector(row) ? kubectl.selectorText(row.selector ?? {}) : undefined],
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
      ['name', 'Name', row.ref.name],
      ['hosts', 'Hosts', hosts === '-' ? undefined : hosts],
      ['urls', 'URL(s)', names.length > 0 ? names.map(host => `https://${host}`).join('\n') : undefined],
      ['address', 'Adresse', address === '-' ? undefined : address],
      ...argoCopy(row),
    ]),
  ];
}

function nodeRowGroups(env: Env, row: KubeRow): Group[] {
  const { name } = row.ref;
  const unschedulable = row.unschedulable === true;
  return [
    [item(env, 'drill', 'Pods auf dieser Node anzeigen', view(select(row), { type: 'drill' }), { hotkey: 'drill' })],
    [...viewItems(env, [select(row)]), sshItem(env, { name, ip: row.ip })],
    copyGroup(env, [
      ['name', 'Name', name],
      ['ip', 'Interne IP', row.ip],
      ['version', 'Kubelet-Version', cell(row, 'version')],
      ['describe', 'kubectl describe', kubectl.describe('nodes', undefined, name)],
      ['drain', 'kubectl drain', kubectl.drain(name)],
      unschedulable ? ['uncordon', 'kubectl uncordon', kubectl.uncordon(name)] : ['cordon', 'kubectl cordon', kubectl.cordon(name)],
      ...argoCopy(row),
    ]),
    [unschedulable
      ? kubeActionItem(env, 'uncordon', 'Node freigeben (uncordon)…', row.ref, 'uncordon')
      : kubeActionItem(env, 'cordon', 'Node sperren (cordon)…', row.ref, 'cordon')],
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
  involved.ref ? undefined : `Objekte vom Typ ${involved.kind} zeigt Shellherd nicht an.`;

function eventGroups(env: Env, row: KubeRow): Group[] {
  const involved = involvedOf(row);
  const ref = involved?.ref;
  const reason = involved ? involvedReason(involved) : undefined;
  const jumpTo = (...actions: KubeViewAction[]): MenuAction => view(select(row), ...(ref ? [{ type: 'jump', ref } as const] : []), ...actions);
  const label = involved ? `${involved.kind} ${involved.name}` : '';
  const viaConnection = reason ?? connectedReason(env);
  const nav: Group = involved ? [item(env, 'involved', `${label} anzeigen`, jumpTo(), { reason })] : [];
  const views: Group = involved ? [
    item(env, 'involved-events', 'Events des Objekts', jumpTo(dock('events')), { reason: viaConnection }),
    item(env, 'involved-describe', 'Describe des Objekts', jumpTo(dock('describe')), { reason: viaConnection }),
    ...(ref?.kind === 'pods' ? [item(env, 'involved-logs', 'Logs des Pods', { type: 'view', actions: [select(row), { type: 'jump', ref }, dock('logs')], previous: false }, { reason: viaConnection })] : []),
  ] : [];
  return [nav, views, copyGroup(env, [
    ['message', 'Meldung', cell(row, 'message')],
    ['object', 'Objekt', involved ? `${involved.kind}/${involved.name}` : undefined],
    ['reason', 'Grund', cell(row, 'reason')],
  ])];
}

function rowMenu(env: Env, row: KubeRow): MenuEntry[] {
  const argo = row.labels[ARGO_LABEL];
  const lead: MenuEntry[] = argo ? [{ kind: 'heading', label: `Argo CD: App ${argo}` }] : [];
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
    groups[0] = [...groups[0], item(env, `only-${chip.id}`, `Nur ${chip.label} anzeigen`, view(select(row), { type: 'setChips', ids: [chip.id] }))];
  }
  return assemble(lead, groups);
}

function containerMenu(env: Env, pod: KubeRow, name: string): MenuEntry[] {
  const drilled = env.ctx.state.containersOf !== null && refKey(env.ctx.state.containersOf.ref) === refKey(pod.ref);
  const podPrefix: KubeViewAction[] = drilled ? [] : [select(pod)];
  const prefix: KubeViewAction[] = [...podPrefix, { type: 'selectContainer', name }];
  const namespace = namespaceOf(pod) ?? '';
  return assemble([], [
    [...terminalItems(env, pod, name, prefix), ...popoutItems(env, pod, name), ...viewItems(env, podPrefix, ' des Pods')],
    copyGroup(env, [
      ['name', 'Container-Name', name],
      ['image', 'Image', cell(pod, `image:${name}`)],
      ['logs', 'kubectl logs -f', kubectl.logs(namespace, pod.ref.name, name)],
      ['exec', 'kubectl exec', kubectl.exec(namespace, pod.ref.name, name)],
    ]),
    [kubeActionItem(env, 'delete', 'Pod löschen…', pod.ref, 'delete', { hotkey: 'delete' })],
  ]);
}

function nodeStateText(tile: NodeTile): string {
  return [tile.ready ? 'bereit' : 'nicht bereit', ...tile.pressure, ...(tile.unschedulable ? ['gesperrt'] : [])].join(', ');
}

function nodeTileMenu(env: Env, tile: NodeTile): MenuEntry[] {
  const ref: KubeRef = { kind: 'nodes', name: tile.name };
  const reason = connectedReason(env);
  const onNode = (id: string, label: string, mode: DockMode): MenuEntry => item(env, id, label, view({ type: 'jump', ref }, dock(mode)), { reason });
  return assemble([{ kind: 'heading', label: `${tile.name} · ${nodeStateText(tile)}` }], [
    [item(env, 'node', 'Node anzeigen', view({ type: 'jump', ref })), podsOnNode(env, tile.name, [], 'node-pods', 'Pods auf dieser Node anzeigen')],
    [onNode('describe', 'Describe', 'describe'), onNode('events', 'Events', 'events'), onNode('yaml', 'YAML', 'yaml'), sshItem(env, { name: tile.name, ip: tile.ip })],
    copyGroup(env, [['name', 'Name', tile.name], ['ip', 'Interne IP', tile.ip]]),
    [tile.unschedulable
      ? kubeActionItem(env, 'uncordon', 'Node freigeben (uncordon)…', ref, 'uncordon')
      : kubeActionItem(env, 'cordon', 'Node sperren (cordon)…', ref, 'cordon')],
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
  return assemble([], [
    [
      item(env, 'show', 'Anzeigen', view(jump)),
      ...(kind === 'node' ? [podsOnNode(env, ref.name, [], 'node-pods', 'Pods auf dieser Node anzeigen')] : []),
    ],
    [
      ...(crashes ? [item(env, 'previous', 'Logs des vorherigen Containers', { type: 'view', actions: [jump, dock('logs')], previous: true }, { reason })] : []),
      ...(podProblem ? [item(env, 'logs', 'Logs', { type: 'view', actions: [jump, dock('logs')], previous: false }, { reason })] : []),
      item(env, 'describe', 'Describe', view(jump, dock('describe')), { reason }),
      item(env, 'events', 'Events', view(jump, dock('events')), { reason }),
      ...(kind === 'node' ? [sshItem(env, { name: ref.name, ip: nodeTile?.ip })] : []),
    ],
    copyGroup(env, [
      ['name', 'Name', ref.name],
      ['namespaced-name', 'Namespace/Name', ref.namespace ? `${ref.namespace}/${ref.name}` : undefined],
      ['message', 'Meldung', problem.message],
      ['logs', 'kubectl logs --previous', crashes ? kubectl.logs(namespace, ref.name, undefined, true) : undefined],
    ]),
    podProblem ? [kubeActionItem(env, 'delete', 'Pod löschen…', ref, 'delete')] : [],
  ]);
}

function dockMenu(env: Env, target: Extract<MenuTarget, { type: 'dock' }>): MenuEntry[] {
  const { pod, container, previous, mode } = target;
  const reason = connectedReason(env);
  const podOnly = pod ? undefined : ONLY_PODS;
  const containers = pod?.containers ?? [];
  const terminalMode = mode === 'logs' || mode === 'shell';
  const popoutMode: KubeTerminalMode = mode === 'shell' ? 'shell' : previous ? 'previous' : 'logs';
  const popoutReason = !env.ctx.canPopout ? NO_POPOUT : !pod || !container ? ONLY_PODS
    : mode === 'shell' ? (env.readOnly ? READ_ONLY_MESSAGE : reason ?? (podNotRunning(pod) ? NOT_RUNNING : undefined)) : reason;
  const shellReason = podOnly ?? (env.readOnly ? READ_ONLY_MESSAGE : reason ?? (podNotRunning(pod) ? NOT_RUNNING : undefined));
  return assemble([], [
    [
      item(env, 'mode-logs', 'Logs', { type: 'view', actions: [dock('logs')], previous: false }, { hotkey: 'logs', reason: podOnly ?? reason }),
      item(env, 'mode-shell', 'Shell', SHELL_ARMED(dock('shell')), { hotkey: 'shell', reason: shellReason }),
      item(env, 'mode-events', 'Events', view(dock('events')), { hotkey: 'events', reason }),
      item(env, 'mode-yaml', 'YAML', view(dock('yaml')), { hotkey: 'yaml', reason }),
      item(env, 'mode-describe', 'Describe', view(dock('describe')), { hotkey: 'describe', reason }),
    ],
    [
      ...(mode === 'logs' ? [item(env, 'previous', previous ? 'Aktuelle Logs' : 'Logs des vorherigen Containers',
        { type: 'view', actions: [], previous: !previous }, { hotkey: previous ? undefined : 'previous', reason: podOnly ?? reason })] : []),
      ...(pod && containers.length > 1 ? containers.map(name =>
        item(env, `container-${name}`, `Container: ${name}`, view({ type: 'selectContainer', name }), { extra: name === container ? 'aktiv' : undefined, reason })) : []),
      ...(mode === 'logs' && pod && container ? [item(env, 'reload', 'Logs neu starten', { type: 'dockReload' }, { reason })] : []),
      ...(terminalMode ? [item(env, 'popout', 'Als Tab öffnen',
        { type: 'popout', target: { namespace: pod?.ref.namespace ?? '', pod: pod?.ref.name ?? '', container: container ?? '', mode: popoutMode } },
        { hotkey: 'popout', reason: popoutReason })] : []),
    ],
    [item(env, 'toggle', 'Panel einklappen', view({ type: 'toggleDock' }), { hotkey: 'toggleDock' })],
  ]);
}

function dockTextMenu(env: Env, target: Extract<MenuTarget, { type: 'dockText' }>): MenuEntry[] {
  const entries: [string, string, string | undefined][] = [
    [target.mode, target.mode === 'yaml' ? 'YAML kopieren' : 'Describe kopieren', target.text],
    ['selection', 'Markierung kopieren', target.selection],
  ];
  return assemble([], [copyGroup(env, entries)]);
}

function dockEventMenu(env: Env, row: KubeRow): MenuEntry[] {
  const involved = involvedOf(row);
  return assemble([], [
    involved?.ref ? [item(env, 'involved', 'Zum Objekt springen', view({ type: 'jump', ref: involved.ref }))]
      : involved ? [item(env, 'involved', 'Zum Objekt springen', view(), { reason: involvedReason(involved) })] : [],
    copyGroup(env, [['message', 'Meldung kopieren', cell(row, 'message')]]),
  ]);
}

/** "Sortierung aufheben": disabled while the sort already equals the default of the kind (C21). */
function sortClearItem(env: Env): MenuEntry {
  const { sort, query } = env.ctx.state;
  const standard = defaultSort(query.kind);
  const atDefault = sort === null || standard === null ? sort === standard : sort.key === standard.key && sort.descending === standard.descending;
  return { kind: 'item', id: 'sort-clear', label: 'Sortierung aufheben', hint: standard ? EVENTS_SORT_HINT : SORT_HINT, ...(atDefault ? { disabled: true } : {}), run: view({ type: 'sortBy', sort: null }) };
}

function headerMenu(env: Env, column: ColumnInfo): MenuEntry[] {
  const sort = (descending: boolean): MenuAction => view({ type: 'sortBy', sort: { key: column.key, descending } });
  return [
    item(env, 'sort-asc', 'Aufsteigend sortieren', sort(false)),
    item(env, 'sort-desc', 'Absteigend sortieren', sort(true)),
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
      item(env, 'filter-reset', 'Alle Filter zurücksetzen', view({ type: 'clearFilter' }), { extra: 'F', reason: filter.text !== '' || filter.chips.length > 0 || Object.keys(filter.columns ?? {}).length > 0 ? undefined : 'Kein Filter gesetzt.' }),
      item(env, 'search-clear', 'Textfilter entfernen', view({ type: 'search', text: '' }), { reason: filter.text !== '' ? undefined : 'Kein Textfilter gesetzt.' }),
      item(env, 'chips-clear', 'Status-Filter leeren', view({ type: 'setChips', ids: [] }), { reason: filter.chips.length > 0 ? undefined : 'Kein Status-Filter gesetzt.' }),
      item(env, 'group-clear', 'Gruppierung aufheben', view({ type: 'setGroupBy', groupBy: null }), { reason: state.groups[state.query.kind] ? undefined : 'Keine Gruppierung gesetzt.' }),
      all ? item(env, 'namespace', `Zurück zu ${back}`, view({ type: 'setNamespace', namespace: back }))
        : item(env, 'namespace', 'Alle Namespaces', view({ type: 'setNamespace', namespace: null })),
      sortClearItem(env),
    ],
    [item(env, 'help', 'Hilfe…', { type: 'help' }, { extra: '?' })],
  ]);
}

export function menuFor(target: MenuTarget, context: MenuContext): MenuEntry[] {
  const hot = target.type === 'row' || target.type === 'container' || target.type === 'dock';
  const env: Env = { ctx: context, connected: context.status?.state === 'ready', readOnly: context.status?.readOnly ?? true, hot };
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
