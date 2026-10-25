import { describe, expect, it } from 'vitest';
import { ACTION_KINDS, KIND_COLUMNS, refKey, type ClusterStatus, type KubeKind, type KubeProblem, type KubeRow, type NodeTile, type ProblemKind } from '../../shared/kubernetes';
import type { KubeDenied } from '../../shared/kube-access';
import { actionReason } from './kube-commands';
import { i18n, t } from './i18n';
import { menuFor, type MenuContext, type MenuEntry, type MenuTarget } from './kube-menus';
import { initialKubeView, type KubeViewState } from './kube-view';

/** The shared reasons now come from the catalog (de-DE in the test setup). */
const READ_ONLY_MESSAGE = t('errors:kubernetes.readOnly');
const NOT_CONNECTED_MESSAGE = t('errors:kubernetes.notConnected');
const RECONNECTING_MESSAGE = t('kubeActions:reasons.reconnecting');

type Item = Extract<MenuEntry, { kind: 'item' }>;

const READY: ClusterStatus = { state: 'ready', name: 'c', production: false, readOnly: false, metrics: true, namespace: 'shop' };
const READ_ONLY: ClusterStatus = { ...READY, readOnly: true };
const PRODUCTION: ClusterStatus = { ...READY, production: true };
const RECONNECTING: ClusterStatus = { ...READY, state: 'reconnecting' };

const NOW = 1_700_000_000_000;
const ssh = (node: { name: string; ip?: string }) => (node.name === 'worker2' ? { id: 'conn-1', name: 'w2-ssh' } : undefined);
const state = (patch: Partial<KubeViewState> = {}): KubeViewState => ({ ...initialKubeView('shop'), status: READY, ...patch });
const context = (patch: Partial<MenuContext> = {}): MenuContext => ({ state: state(), status: READY, canPopout: true, sshForNode: ssh, now: NOW, ...patch });

const row = (kind: KubeKind, name: string, patch: Partial<KubeRow> = {}): KubeRow => ({
  uid: `${kind}-${name}`, ref: { kind, ...(kind === 'nodes' ? {} : { namespace: 'shop' }), name }, cells: {}, tone: 'ok', labels: {}, ...patch,
});
const pod = (patch: Partial<KubeRow> = {}): KubeRow => row('pods', 'api-1', {
  cells: { status: 'Running', 'image:api': 'reg/api:1', 'image:proxy': 'reg/proxy:2' }, containers: ['api', 'proxy'], node: 'worker2', ip: '10.0.0.5',
  labels: { app: 'api', tier: 'web', 'app.kubernetes.io/name': 'api' }, owner: { kind: 'deployments', namespace: 'shop', name: 'api' }, ...patch,
});
const singlePod = (): KubeRow => pod({ containers: ['api'], cells: { status: 'Running', 'image:api': 'reg/api:1' } });
const deployment = (patch: Partial<KubeRow> = {}): KubeRow => row('deployments', 'api', {
  cells: { image: 'reg/api:1, reg/side:2' }, selector: { app: 'api', tier: 'web' }, replicas: 3, labels: { app: 'api' }, ...patch,
});
const node = (patch: Partial<KubeRow> = {}): KubeRow => row('nodes', 'worker2', { cells: { version: 'v1.30.1' }, ip: '10.0.0.2', ...patch });
const tile = (patch: Partial<NodeTile> = {}): NodeTile => ({ name: 'worker2', ready: true, roles: [], pressure: [], unschedulable: false, ip: '10.0.0.2', ...patch });
const problem = (kind: ProblemKind, patch: Partial<KubeProblem> = {}): KubeProblem => ({
  id: `p-${kind}`, kind, ref: kind === 'node' ? { kind: 'nodes', name: 'worker2' } : { kind: 'pods', namespace: 'shop', name: 'api-1' }, error: { code: 'kubernetes.problemOom', params: { name: 'api-1' } }, ...patch,
});

const items = (entries: MenuEntry[]): Item[] => entries.filter((entry): entry is Item => entry.kind === 'item');
const labels = (entries: MenuEntry[]): string[] => entries.map(entry => (entry.kind === 'separator' ? '---' : entry.label));
const find = (entries: MenuEntry[], id: string): Item => {
  const found = items(entries).find(entry => entry.id === id);
  if (!found) throw new Error(`no entry ${id} in ${labels(entries).join(' | ')}`);
  return found;
};
const has = (entries: MenuEntry[], id: string): boolean => items(entries).some(entry => entry.id === id);
const menu = (target: MenuTarget, ctx: MenuContext = context()): MenuEntry[] => menuFor(target, ctx);
const rowMenu = (r: KubeRow, ctx?: MenuContext): MenuEntry[] => menu({ type: 'row', row: r }, ctx);
const viewActions = (entry: Item) => (entry.run.type === 'view' ? entry.run.actions : []);

const withStatus = (status: ClusterStatus | null): MenuContext => context({ status, state: state({ status }) });

describe('structure', () => {
  const targets: MenuTarget[] = [
    { type: 'row', row: pod() }, { type: 'row', row: deployment() }, { type: 'row', row: row('services', 's', { selector: { a: 'b' } }) },
    { type: 'row', row: node() }, { type: 'container', pod: pod(), name: 'api' }, { type: 'node', tile: tile() }, { type: 'problem', problem: problem('crashloop') },
    { type: 'dock', mode: 'logs', pod: pod(), container: 'api', previous: false }, { type: 'dockText', mode: 'yaml', text: 'a: b', selection: 'a' },
    { type: 'header', column: KIND_COLUMNS.pods[0] }, { type: 'background' },
  ];
  it.each(targets.map((target, index) => [index, target] as const))('has no leading, trailing or doubled separators (target %i)', (_, target) => {
    for (const status of [READY, READ_ONLY, RECONNECTING, null]) {
      const entries = menu(target, withStatus(status));
      expect(entries.length).toBeGreaterThan(0);
      expect(entries[0].kind).not.toBe('separator');
      expect(entries[entries.length - 1].kind).not.toBe('separator');
      entries.forEach((entry, i) => { if (entry.kind === 'separator') expect(entries[i - 1].kind).not.toBe('separator'); });
      expect(entries[entries.length - 1].kind).not.toBe('heading');
    }
  });
  it('gives every item a unique id within its menu', () => {
    for (const target of targets) {
      const ids = items(menu(target)).map(entry => entry.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
  it('puts a disabled entry with a hint that is its reason', () => {
    for (const entry of items(rowMenu(pod(), withStatus(READ_ONLY)))) if (entry.disabled) expect(entry.hint).toBeTruthy();
  });
  it('never calls the clock: the copy text uses context.now', () => {
    const cron = row('cronjobs', 'backup', { cells: { schedule: '*/5 * * * *' } });
    expect(find(rowMenu(cron), 'copy-create-job').run).toMatchObject({ text: `kubectl -n shop create job --from=cronjob/backup backup-manual-${NOW / 1000}` });
    expect(find(rowMenu(cron, context({ now: 2_000_000_000_000 })), 'copy-create-job').run).toMatchObject({ text: 'kubectl -n shop create job --from=cronjob/backup backup-manual-2000000000' });
  });
});

describe('A1 pods', () => {
  it('lists the groups in order for a running two-container pod', () => {
    const entries = rowMenu(pod());
    expect(labels(entries)).toEqual([
      'Container anzeigen', 'Pods auf Node worker2 anzeigen', 'Deployment api anzeigen', 'Filtern: app=api', 'Filtern: app.kubernetes.io/name=api', 'Nur Läuft anzeigen', '---',
      'Logs', 'Logs des vorherigen Containers', 'Shell öffnen', 'Events', 'YAML', 'Describe', 'Logs als Tab öffnen', 'Shell als Tab öffnen', 'Port weiterleiten…', '---',
      'Kopieren', 'Name', 'Namespace/Name', 'Image', 'Labels', 'Pod-IP', 'kubectl logs -f', 'kubectl exec', 'kubectl describe', '---', 'Pod löschen…',
    ]);
  });
  it('shows hotkeys, with the container for multi-container pods', () => {
    const entries = rowMenu(pod());
    expect(find(entries, 'drill').hint).toBe('Enter');
    expect(find(entries, 'logs').hint).toBe('l · api');
    expect(find(entries, 'previous').hint).toBe('p · api');
    expect(find(entries, 'shell').hint).toBe('s · api');
    expect(find(entries, 'popout-logs').hint).toBe('Ctrl+Shift+T · api');
    expect(find(entries, 'events').hint).toBe('e');
    expect(find(entries, 'delete').hint).toBe('Ctrl+d');
    const single = rowMenu(singlePod());
    expect(find(single, 'logs').hint).toBe('l');
    expect(find(single, 'shell').hint).toBe('s');
  });
  it('starts every view with the row selection and arms the shell', () => {
    const entries = rowMenu(pod());
    for (const id of ['drill', 'node-pods', 'owner', 'logs', 'events', 'yaml', 'describe']) expect(viewActions(find(entries, id))[0]).toEqual({ type: 'select', key: 'pods/shop/api-1' });
    expect(find(entries, 'shell').run).toEqual({ type: 'view', actions: [{ type: 'select', key: 'pods/shop/api-1' }, { type: 'selectContainer', name: 'api' }, { type: 'dock', mode: 'shell' }], armShell: true });
    expect(find(entries, 'previous').run).toMatchObject({ previous: true });
    expect(find(entries, 'logs').run).toMatchObject({ previous: false });
    expect(find(entries, 'node-pods').run).toMatchObject({ actions: [expect.anything(), { type: 'openQuery', query: { kind: 'pods', namespace: null, selector: { node: 'worker2' } }, crumb: 'Node worker2' }] });
    expect(find(entries, 'owner').run).toMatchObject({ actions: [expect.anything(), { type: 'jump', ref: { kind: 'deployments', namespace: 'shop', name: 'api' } }] });
  });
  it('depends on the target row, never on state.selected (C14)', () => {
    const a = row('pods', 'a-1', { containers: ['x'], cells: { status: 'Running' } });
    const b = pod();
    const ctx = context({ state: state({ rows: [a, b], selected: refKey(a.ref) }) });
    const entries = rowMenu(b, ctx);
    for (const entry of items(entries)) {
      if (entry.run.type === 'view') expect(entry.run.actions[0]).toEqual({ type: 'select', key: refKey(b.ref) });
      if (entry.run.type === 'kubeAction') expect(entry.run.ref).toEqual(b.ref);
    }
  });
  it('omits node, owner and filter entries when the row lacks them', () => {
    const entries = rowMenu(pod({ node: undefined, owner: undefined, labels: {}, ip: undefined }));
    expect(has(entries, 'node-pods')).toBe(false);
    expect(has(entries, 'owner')).toBe(false);
    expect(items(entries).some(entry => entry.id.startsWith('filter-'))).toBe(false);
    expect(has(entries, 'copy-labels')).toBe(false);
    expect(has(entries, 'copy-ip')).toBe(false);
  });
  it('names the owner kind', () => {
    expect(find(rowMenu(pod({ owner: { kind: 'daemonsets', namespace: 'shop', name: 'agent' } })), 'owner').label).toBe('DaemonSet agent anzeigen');
    expect(find(rowMenu(pod({ owner: { kind: 'statefulsets', namespace: 'shop', name: 'db' } })), 'owner').label).toBe('StatefulSet db anzeigen');
  });
  it('shows the namespace entry only in all-namespaces', () => {
    expect(has(rowMenu(pod()), 'namespace')).toBe(false);
    const all = rowMenu(pod(), context({ state: state({ query: { kind: 'pods', namespace: null } }) }));
    expect(find(all, 'namespace').label).toBe('Namespace shop anzeigen');
    expect(find(all, 'namespace').run).toMatchObject({ actions: [expect.anything(), { type: 'setNamespace', namespace: 'shop' }] });
  });
  it('orders filter labels: preferred keys first, at most three, else the first labels', () => {
    const preferred = rowMenu(pod({ labels: { zone: 'a', 'app.kubernetes.io/component': 'c', app: 'x', 'app.kubernetes.io/instance': 'i', 'app.kubernetes.io/name': 'n' } }));
    expect(items(preferred).filter(entry => entry.id.startsWith('filter-')).map(entry => entry.label)).toEqual(['Filtern: app=x', 'Filtern: app.kubernetes.io/name=n', 'Filtern: app.kubernetes.io/instance=i']);
    const fallback = rowMenu(pod({ labels: { a: '1', b: '2', c: '3', d: '4' } }));
    expect(items(fallback).filter(entry => entry.id.startsWith('filter-')).map(entry => entry.label)).toEqual(['Filtern: a=1', 'Filtern: b=2', 'Filtern: c=3']);
    expect(find(fallback, 'filter-a=1').run).toMatchObject({ actions: [expect.anything(), { type: 'search', text: 'a=1' }] });
  });
  it('disables logs and shell for a Completed pod, shell with its reason', () => {
    const entries = rowMenu(pod({ cells: { status: 'Completed' } }));
    expect(find(entries, 'shell')).toMatchObject({ disabled: true, hint: 'Der Pod läuft nicht.' });
    expect(find(entries, 'popout-shell')).toMatchObject({ disabled: true, hint: 'Der Pod läuft nicht.' });
    expect(find(entries, 'logs').disabled).toBeUndefined();
    expect(find(rowMenu(pod({ cells: { status: 'Terminating' } })), 'shell').hint).toBe('Der Pod läuft nicht.');
  });
  it('disables logs for a pod without containers', () => {
    expect(find(rowMenu(pod({ containers: [] })), 'logs')).toMatchObject({ disabled: true, hint: 'Der Pod hat keine Container.' });
  });
  it('copies name, namespace/name, images, labels, ip and kubectl commands', () => {
    const entries = rowMenu(pod());
    const text = (id: string) => (find(entries, id).run as { text: string }).text;
    expect(text('copy-name')).toBe('api-1');
    expect(text('copy-namespaced-name')).toBe('shop/api-1');
    expect(text('copy-image')).toBe('api=reg/api:1\nproxy=reg/proxy:2');
    expect(text('copy-labels')).toBe('app=api\napp.kubernetes.io/name=api\ntier=web');
    expect(text('copy-ip')).toBe('10.0.0.5');
    expect(text('copy-logs')).toBe('kubectl -n shop logs -f api-1 -c api');
    expect(text('copy-exec')).toBe('kubectl -n shop exec -it api-1 -c api -- sh');
    expect(text('copy-describe')).toBe('kubectl -n shop describe pod api-1');
    expect(text('copy-image')).not.toContain('=undefined');
    expect((find(rowMenu(singlePod()), 'copy-image').run as { text: string }).text).toBe('reg/api:1');
  });
  it('disables a copy entry whose name the builder refuses', () => {
    const entries = rowMenu(pod({ ref: { kind: 'pods', namespace: 'shop', name: 'Bad Name;' } }));
    expect(find(entries, 'copy-logs')).toMatchObject({ disabled: true, hint: 'Name enthält ungültige Zeichen.' });
    expect(find(entries, 'copy-name').disabled).toBeUndefined();
  });
  it('keeps navigation and copy active when not connected, but disables view, terminal and action entries', () => {
    const entries = rowMenu(pod(), withStatus(RECONNECTING));
    for (const id of ['drill', 'node-pods', 'owner', 'filter-app=api', 'copy-name', 'copy-logs']) expect(find(entries, id).disabled).toBeUndefined();
    for (const id of ['logs', 'previous', 'shell', 'events', 'yaml', 'describe', 'popout-logs', 'popout-shell', 'delete']) {
      expect(find(entries, id)).toMatchObject({ disabled: true, hint: RECONNECTING_MESSAGE });
    }
  });
  it('treats a missing status as read-only like the hotkeys and the help (M-1)', () => {
    const entries = rowMenu(pod(), withStatus(null));
    expect(find(entries, 'delete')).toMatchObject({ disabled: true, hint: READ_ONLY_MESSAGE });
    expect(find(entries, 'logs')).toMatchObject({ disabled: true, hint: NOT_CONNECTED_MESSAGE });
    expect(find(entries, 'drill').disabled).toBeUndefined();
  });
  it('dock Logs leaves previous mode and SSH explains a missing hook (M-3, M-6)', () => {
    const entries = menu({ type: 'dock', mode: 'logs', pod: pod(), container: 'api', previous: true });
    expect(find(entries, 'mode-logs').run).toMatchObject({ type: 'view', previous: false });
    expect(find(rowMenu(node(), { ...context(), canSsh: false, sshForNode: () => undefined }), 'ssh')).toMatchObject({ disabled: true, hint: 'Hier lässt sich keine Verbindung öffnen.' });
  });
  it('read-only disables shell and delete with READ_ONLY_MESSAGE but keeps logs and copy', () => {
    const entries = rowMenu(pod(), withStatus(READ_ONLY));
    expect(find(entries, 'shell')).toMatchObject({ disabled: true, hint: READ_ONLY_MESSAGE });
    expect(find(entries, 'popout-shell')).toMatchObject({ disabled: true, hint: READ_ONLY_MESSAGE });
    expect(find(entries, 'delete')).toMatchObject({ disabled: true, hint: READ_ONLY_MESSAGE });
    expect(find(entries, 'logs').disabled).toBeUndefined();
    expect(find(entries, 'popout-logs').disabled).toBeUndefined();
    expect(find(entries, 'copy-exec').disabled).toBeUndefined();
  });
  it('is identical for a production cluster (the dialog asks for the name)', () => {
    expect(rowMenu(pod(), withStatus(PRODUCTION))).toEqual(rowMenu(pod()));
  });
  it('disables the tab entries without popout support', () => {
    const entries = rowMenu(pod(), context({ canPopout: false }));
    expect(find(entries, 'popout-logs')).toMatchObject({ disabled: true, hint: 'Hier lässt sich kein Tab öffnen.' });
    expect(find(entries, 'popout-shell')).toMatchObject({ disabled: true, hint: 'Hier lässt sich kein Tab öffnen.' });
  });
  it('builds popout targets from the first container', () => {
    const entries = rowMenu(pod());
    expect(find(entries, 'popout-logs').run).toEqual({ type: 'popout', target: { namespace: 'shop', pod: 'api-1', container: 'api', mode: 'logs' } });
    expect(find(entries, 'popout-shell').run).toEqual({ type: 'popout', target: { namespace: 'shop', pod: 'api-1', container: 'api', mode: 'shell' } });
  });
  it('keeps the delete action active for a problem pod in another namespace and kind (RF2)', () => {
    const ctx = context({ state: state({ query: { kind: 'deployments', namespace: 'other' } }) });
    const entries = menu({ type: 'problem', problem: problem('crashloop') }, ctx);
    expect(find(entries, 'delete')).toMatchObject({ run: { type: 'kubeAction', action: 'delete', ref: { kind: 'pods', namespace: 'shop', name: 'api-1' } } });
    expect(find(entries, 'delete').disabled).toBeUndefined();
  });
});

describe('Argo (C28)', () => {
  it('puts the heading first and Argo-App-Name last under Kopieren, for any row kind', () => {
    for (const r of [deployment({ labels: { 'argocd.argoproj.io/instance': 'shop-api' } }), pod({ labels: { 'argocd.argoproj.io/instance': 'shop-api' } }), row('services', 's', { labels: { 'argocd.argoproj.io/instance': 'shop-api' }, selector: { a: 'b' } })]) {
      const entries = rowMenu(r);
      expect(entries[0]).toEqual({ kind: 'heading', label: 'Argo CD: App shop-api' });
      expect(entries[1].kind).toBe('item');
      const copies = items(entries).filter(entry => entry.id.startsWith('copy-'));
      expect(copies[copies.length - 1]).toMatchObject({ id: 'copy-argo', label: 'Argo-App-Name', run: { type: 'copy', text: 'shop-api' } });
    }
  });
  it('has no Argo entries without the label', () => {
    const entries = rowMenu(deployment());
    expect(entries.some(entry => entry.kind === 'heading' && entry.label.startsWith('Argo'))).toBe(false);
    expect(has(entries, 'copy-argo')).toBe(false);
  });
});

describe('A2 workloads', () => {
  it('lists a deployment menu', () => {
    expect(labels(rowMenu(deployment()))).toEqual([
      'Pods anzeigen', '---', 'Logs aller Pods', 'Events', 'YAML', 'Describe', '---',
      'Kopieren', 'Name', 'Namespace/Name', 'Image', 'Selector', 'Labels', 'kubectl rollout restart', 'kubectl scale', 'kubectl rollout status', '---',
      'Rollout neu starten…', 'Skalieren…',
    ]);
  });
  it('copies images one per line, the selector and kubectl commands', () => {
    const entries = rowMenu(deployment());
    const text = (id: string) => (find(entries, id).run as { text: string }).text;
    expect(text('copy-image')).toBe('reg/api:1\nreg/side:2');
    expect(text('copy-selector')).toBe('app=api,tier=web');
    expect(text('copy-restart')).toBe('kubectl -n shop rollout restart deployment api');
    expect(text('copy-scale')).toBe('kubectl -n shop scale deployment api --replicas=3');
    expect(text('copy-status')).toBe('kubectl -n shop rollout status deployment api');
  });
  it('carries hotkeys and the current replicas on the actions', () => {
    const entries = rowMenu(deployment());
    expect(find(entries, 'restart')).toMatchObject({ hint: 'r', run: { type: 'kubeAction', action: 'restart', ref: deployment().ref } });
    expect(find(entries, 'scale')).toMatchObject({ hint: 'S', run: { type: 'kubeAction', action: 'scale', currentReplicas: 3 } });
    expect(find(entries, 'drill').hint).toBe('Enter');
  });
  it('disables scale for a DaemonSet, which also has no scale command', () => {
    const entries = rowMenu(row('daemonsets', 'agent', { selector: { a: 'b' } }));
    expect(find(entries, 'scale')).toMatchObject({ disabled: true, hint: 'Nur für Deployments und StatefulSets.' });
    expect(find(entries, 'restart').disabled).toBeUndefined();
    expect(has(entries, 'copy-scale')).toBe(false);
    expect(has(entries, 'copy-restart')).toBe(true);
  });
  it('disables Pods anzeigen without a selector, including an empty one (C6)', () => {
    for (const selector of [undefined, {}]) {
      expect(find(rowMenu(deployment({ selector })), 'drill')).toMatchObject({ disabled: true, hint: 'Dieser Workload hat keinen Selector.' });
    }
    expect(has(rowMenu(deployment({ selector: {} })), 'copy-selector')).toBe(false);
  });
  it('gates actions on read-only and connection', () => {
    expect(find(rowMenu(deployment(), withStatus(READ_ONLY)), 'restart')).toMatchObject({ disabled: true, hint: READ_ONLY_MESSAGE });
    expect(find(rowMenu(deployment(), withStatus(RECONNECTING)), 'scale')).toMatchObject({ disabled: true, hint: RECONNECTING_MESSAGE });
    expect(find(rowMenu(deployment(), withStatus(RECONNECTING)), 'drill').disabled).toBeUndefined();
  });
  it('words every connection lock as reconnecting while reconnecting, not only mutations (K24)', () => {
    const entries = rowMenu(singlePod(), withStatus(RECONNECTING));
    for (const id of ['logs', 'shell']) expect(find(entries, id)).toMatchObject({ disabled: true, hint: RECONNECTING_MESSAGE });
    expect(find(rowMenu(singlePod(), withStatus({ ...RECONNECTING, state: 'connecting' })), 'logs')).toMatchObject({ hint: NOT_CONNECTED_MESSAGE });
  });
  it('adds the namespace entry only in all-namespaces', () => {
    expect(has(rowMenu(deployment()), 'namespace')).toBe(false);
    expect(has(rowMenu(deployment(), context({ state: state({ query: { kind: 'deployments', namespace: null } }) })), 'namespace')).toBe(true);
  });
});

describe('A3 jobs', () => {
  const job = (patch: Partial<KubeRow> = {}) => row('jobs', 'backup-123', { selector: { 'job-name': 'backup-123' }, owner: { kind: 'cronjobs', namespace: 'shop', name: 'backup' }, ...patch });
  it('lists the job menu with CronJob owner and delete', () => {
    expect(labels(rowMenu(job()))).toEqual([
      'Pods anzeigen', 'CronJob backup anzeigen', '---', 'Logs aller Pods', 'Events', 'YAML', 'Describe', '---',
      'Kopieren', 'Name', 'Namespace/Name', 'kubectl logs', 'kubectl describe', '---', 'Job löschen…',
    ]);
    expect(find(rowMenu(job()), 'delete')).toMatchObject({ hint: 'Ctrl+d', run: { type: 'kubeAction', action: 'delete', ref: { kind: 'jobs', name: 'backup-123' } } });
  });
  it('copies kubectl logs job/<name>', () => {
    expect(find(rowMenu(job()), 'copy-logs').run).toMatchObject({ text: 'kubectl -n shop logs job/backup-123' });
    expect(find(rowMenu(job()), 'copy-describe').run).toMatchObject({ text: 'kubectl -n shop describe job backup-123' });
  });
  it('explains a job without selector and omits a missing owner', () => {
    const entries = rowMenu(job({ selector: undefined, owner: undefined }));
    expect(find(entries, 'drill')).toMatchObject({ disabled: true, hint: 'Dieser Job hat keinen Selector.' });
    expect(has(entries, 'owner')).toBe(false);
  });
  it('ignores a non-CronJob owner', () => {
    expect(has(rowMenu(job({ owner: { kind: 'deployments', namespace: 'shop', name: 'x' } })), 'owner')).toBe(false);
  });
  it('disables the delete under read-only', () => {
    expect(find(rowMenu(job(), withStatus(READ_ONLY)), 'delete')).toMatchObject({ disabled: true, hint: READ_ONLY_MESSAGE });
  });
});

describe('A4 cronjobs', () => {
  const cron = (patch: Partial<KubeRow> = {}) => row('cronjobs', 'backup', { cells: { schedule: '*/5 * * * *' }, ...patch });
  it('lists the menu for a running cronjob', () => {
    expect(labels(rowMenu(cron()))).toEqual([
      'Jobs anzeigen', '---', 'Events', 'YAML', 'Describe', '---',
      'Kopieren', 'Name', 'Zeitplan', 'kubectl create job', 'kubectl patch (anhalten)', '---', 'Anhalten…', 'Jetzt ausführen…',
    ]);
  });
  it('opens the jobs with a crumb and a name filter (C9)', () => {
    const drill = find(rowMenu(cron()), 'drill');
    expect(drill.hint).toBe('Enter');
    expect(viewActions(drill)).toEqual([
      { type: 'select', key: 'cronjobs/shop/backup' },
      { type: 'openQuery', query: { kind: 'jobs', namespace: 'shop' }, crumb: 'CronJob backup' },
      { type: 'search', text: 'owner:backup' },
    ]);
  });
  it('offers Fortsetzen for a suspended cronjob and copies the matching patch', () => {
    const entries = rowMenu(cron({ suspended: true }));
    expect(has(entries, 'suspend')).toBe(false);
    expect(find(entries, 'resume')).toMatchObject({ label: 'Fortsetzen…', run: { type: 'kubeAction', action: 'resume' } });
    expect(find(entries, 'copy-patch').run).toMatchObject({ text: `kubectl -n shop patch cronjob backup -p '{"spec":{"suspend":false}}'` });
    expect(find(rowMenu(cron()), 'copy-patch').run).toMatchObject({ text: `kubectl -n shop patch cronjob backup -p '{"spec":{"suspend":true}}'` });
  });
  it('copies the schedule verbatim and wires trigger', () => {
    const entries = rowMenu(cron());
    expect(find(entries, 'copy-schedule').run).toMatchObject({ text: '*/5 * * * *' });
    expect(find(entries, 'trigger')).toMatchObject({ label: 'Jetzt ausführen…', run: { type: 'kubeAction', action: 'trigger', ref: cron().ref } });
    expect(find(entries, 'suspend').hint).toBeUndefined();
  });
  it('disables mutations under read-only and when not connected', () => {
    for (const [status, text] of [[READ_ONLY, READ_ONLY_MESSAGE], [RECONNECTING, RECONNECTING_MESSAGE]] as const) {
      const entries = rowMenu(cron(), withStatus(status));
      for (const id of ['suspend', 'trigger']) expect(find(entries, id)).toMatchObject({ disabled: true, hint: text });
    }
  });
});

describe('A5 services', () => {
  const service = (patch: Partial<KubeRow> = {}) => row('services', 'web', { cells: { clusterIp: '10.1.2.3', ports: '8080:30080/TCP,443/TCP' }, selector: { app: 'web' }, ...patch });
  it('lists the service menu without actions', () => {
    expect(labels(rowMenu(service()))).toEqual([
      'Pods anzeigen', 'Port weiterleiten…', '---', 'Logs aller Pods', 'Events', 'YAML', 'Describe', '---', 'Kopieren', 'Name', 'Cluster-IP', 'DNS-Name', 'Ports', 'Selector', 'kubectl port-forward',
    ]);
  });
  it('copies dns name and a port-forward with the first port', () => {
    const entries = rowMenu(service());
    expect(find(entries, 'copy-dns').run).toMatchObject({ text: 'web.shop.svc.cluster.local' });
    expect(find(entries, 'copy-port-forward').run).toMatchObject({ text: 'kubectl -n shop port-forward svc/web 8080:8080' });
    expect(find(entries, 'copy-cluster-ip').run).toMatchObject({ text: '10.1.2.3' });
    expect(find(entries, 'copy-ports').run).toMatchObject({ text: '8080:30080/TCP,443/TCP' });
  });
  it('explains a service without selector and omits absent fields', () => {
    const entries = rowMenu(service({ selector: undefined, cells: { clusterIp: 'None', ports: '' } }));
    expect(find(entries, 'drill')).toMatchObject({ disabled: true, hint: 'Dieser Service hat keinen Selector, z. B. ExternalName.' });
    for (const id of ['copy-cluster-ip', 'copy-ports', 'copy-selector', 'copy-port-forward']) expect(has(entries, id)).toBe(false);
    expect(has(entries, 'copy-dns')).toBe(true);
  });
  it('treats an empty selector map as no selector', () => {
    expect(find(rowMenu(service({ selector: {} })), 'drill').disabled).toBe(true);
  });
});

describe('A6 ingress', () => {
  const ingress = (patch: Partial<KubeRow> = {}) => row('ingresses', 'web', { cells: { hosts: 'a.example.com,*.example.com, b.example.com', address: '10.9.9.9' }, ...patch });
  it('lists events/yaml/describe and copy entries only', () => {
    expect(labels(rowMenu(ingress()))).toEqual(['Events', 'YAML', 'Describe', '---', 'Kopieren', 'Name', 'Hosts', 'URL(s)', 'Adresse']);
  });
  it('builds https URLs per host and skips wildcards', () => {
    expect(find(rowMenu(ingress()), 'copy-urls').run).toMatchObject({ text: 'https://a.example.com\nhttps://b.example.com' });
  });
  it('omits absent fields and has no browser entry', () => {
    const entries = rowMenu(ingress({ cells: {} }));
    expect(labels(entries)).toEqual(['Events', 'YAML', 'Describe', '---', 'Kopieren', 'Name']);
    expect(labels(rowMenu(ingress())).join()).not.toMatch(/Browser/);
  });
});

describe('A7 nodes', () => {
  it('lists the node row menu with ssh and cordon', () => {
    expect(labels(rowMenu(node()))).toEqual([
      'Pods auf dieser Node anzeigen', '---', 'Events', 'YAML', 'Describe', 'SSH-Verbindung öffnen', '---',
      'Kopieren', 'Name', 'Interne IP', 'Kubelet-Version', 'kubectl describe', 'kubectl drain', 'kubectl cordon', '---', 'Node sperren (cordon)…',
    ]);
  });
  it('wires drill, ssh with the vault name as hint, and cordon', () => {
    const entries = rowMenu(node());
    expect(find(entries, 'drill').hint).toBe('Enter');
    expect(find(entries, 'ssh')).toMatchObject({ hint: 'w2-ssh', run: { type: 'ssh', connectionId: 'conn-1' } });
    expect(find(entries, 'cordon')).toMatchObject({ run: { type: 'kubeAction', action: 'cordon', ref: { kind: 'nodes', name: 'worker2' } } });
    expect(find(entries, 'copy-drain').run).toMatchObject({ text: 'kubectl drain worker2 --ignore-daemonsets --delete-emptydir-data' });
    expect(find(entries, 'copy-describe').run).toMatchObject({ text: 'kubectl describe node worker2' });
  });
  it('passes name and ip to sshForNode', () => {
    const seen: unknown[] = [];
    rowMenu(node(), context({ sshForNode: n => { seen.push(n); return undefined; } }));
    expect(seen).toContainEqual({ name: 'worker2', ip: '10.0.0.2' });
  });
  it('disables ssh without a vault match, naming the node', () => {
    expect(find(rowMenu(node({ ref: { kind: 'nodes', name: 'worker9' } })), 'ssh')).toMatchObject({ disabled: true, hint: 'Keine SSH-Verbindung für worker9 im Vault.' });
  });
  it('keeps ssh active under read-only and when not connected (C33)', () => {
    for (const status of [READ_ONLY, RECONNECTING, null]) expect(find(rowMenu(node(), withStatus(status)), 'ssh').disabled).toBeUndefined();
  });
  it('offers uncordon for an unschedulable node', () => {
    const entries = rowMenu(node({ unschedulable: true }));
    expect(has(entries, 'cordon')).toBe(false);
    expect(find(entries, 'uncordon')).toMatchObject({ label: 'Node freigeben (uncordon)…', run: { action: 'uncordon' } });
    expect(find(entries, 'copy-uncordon').run).toMatchObject({ text: 'kubectl uncordon worker2' });
  });
  it('disables cordon under read-only', () => {
    expect(find(rowMenu(node(), withStatus(READ_ONLY)), 'cordon')).toMatchObject({ disabled: true, hint: READ_ONLY_MESSAGE });
  });
});

describe('A8 events', () => {
  const event = (involved: KubeRow['involved'], patch: Partial<KubeRow> = {}) => row('events', 'ev1', { cells: { message: 'Back-off', reason: 'BackOff', object: 'Pod/api-1' }, involved, ...patch });
  const podEvent = () => event({ kind: 'Pod', name: 'api-1', ref: { kind: 'pods', namespace: 'shop', name: 'api-1' } });
  it('lists jump, events, describe, logs and copy for a pod event, without hotkeys (C8)', () => {
    const entries = rowMenu(podEvent());
    expect(labels(entries)).toEqual(['Pod api-1 anzeigen', '---', 'Events des Objekts', 'Describe des Objekts', 'Logs des Pods', '---', 'Kopieren', 'Meldung', 'Objekt', 'Grund']);
    for (const entry of items(entries)) if (!entry.disabled) expect(entry.hint).toBeUndefined();
    expect(find(entries, 'involved').run).toMatchObject({ actions: [{ type: 'select' }, { type: 'jump', ref: { kind: 'pods', name: 'api-1' } }] });
    expect(find(entries, 'involved-logs').run).toMatchObject({ actions: [{ type: 'select' }, { type: 'jump' }, { type: 'dock', mode: 'logs' }], previous: false });
    expect(find(entries, 'copy-object').run).toMatchObject({ text: 'Pod/api-1' });
    expect(find(entries, 'copy-message').run).toMatchObject({ text: 'Back-off' });
  });
  it('omits the log entry for a non-pod object', () => {
    const entries = rowMenu(event({ kind: 'Deployment', name: 'api', ref: { kind: 'deployments', namespace: 'shop', name: 'api' } }));
    expect(has(entries, 'involved-logs')).toBe(false);
    expect(has(entries, 'involved-describe')).toBe(true);
  });
  it('disables the jumps for a foreign kind with the reason (C5)', () => {
    const entries = rowMenu(event({ kind: 'ReplicaSet', name: 'api-5d8f' }));
    for (const id of ['involved', 'involved-events', 'involved-describe']) {
      expect(find(entries, id)).toMatchObject({ disabled: true, hint: 'Objekte vom Typ ReplicaSet zeigt Shellherd nicht an.' });
    }
    expect(find(entries, 'copy-object').run).toMatchObject({ text: 'ReplicaSet/api-5d8f' });
  });
  it('keeps the jump active when not connected but disables the dock entries', () => {
    const entries = rowMenu(podEvent(), withStatus(RECONNECTING));
    expect(find(entries, 'involved').disabled).toBeUndefined();
    expect(find(entries, 'involved-events')).toMatchObject({ disabled: true, hint: RECONNECTING_MESSAGE });
  });
  it('falls back to the object cell when `involved` is missing', () => {
    const entries = rowMenu(event(undefined));
    expect(find(entries, 'involved').label).toBe('Pod api-1 anzeigen');
    expect(find(entries, 'involved').run).toMatchObject({ actions: [expect.anything(), { type: 'jump', ref: { kind: 'pods', namespace: 'shop', name: 'api-1' } }] });
  });
});

describe('B container rows', () => {
  const drilled = (p = pod()) => context({ state: state({ containersOf: p }) });
  it('lists the container menu', () => {
    expect(labels(menu({ type: 'container', pod: pod(), name: 'proxy' }, drilled()))).toEqual([
      'Logs', 'Logs des vorherigen Containers', 'Shell öffnen', 'Logs als Tab öffnen', 'Shell als Tab öffnen', 'Events des Pods', 'YAML des Pods', 'Describe des Pods', '---',
      'Kopieren', 'Container-Name', 'Image', 'kubectl logs -f', 'kubectl exec', '---', 'Pod löschen…',
    ]);
  });
  it('selects the container and gives plain hotkeys (no container suffix)', () => {
    const entries = menu({ type: 'container', pod: pod(), name: 'proxy' }, drilled());
    expect(find(entries, 'logs')).toMatchObject({ hint: 'l', run: { actions: [{ type: 'selectContainer', name: 'proxy' }, { type: 'dock', mode: 'logs' }] } });
    expect(find(entries, 'shell').run).toMatchObject({ armShell: true, actions: [{ type: 'selectContainer', name: 'proxy' }, { type: 'dock', mode: 'shell' }] });
    expect(find(entries, 'popout-shell').run).toEqual({ type: 'popout', target: { namespace: 'shop', pod: 'api-1', container: 'proxy', mode: 'shell' } });
    expect(find(entries, 'delete')).toMatchObject({ hint: 'Ctrl+d', run: { ref: pod().ref } });
    expect(find(entries, 'events').run).toEqual({ type: 'view', actions: [{ type: 'dock', mode: 'events' }] });
  });
  it('selects the pod first outside the drill-down (C14)', () => {
    const entries = menu({ type: 'container', pod: pod(), name: 'proxy' }, context());
    expect(viewActions(find(entries, 'logs'))).toEqual([{ type: 'select', key: 'pods/shop/api-1' }, { type: 'selectContainer', name: 'proxy' }, { type: 'dock', mode: 'logs' }]);
  });
  it('copies the container name, image and commands with -c', () => {
    const entries = menu({ type: 'container', pod: pod(), name: 'proxy' }, drilled());
    expect(find(entries, 'copy-name').run).toMatchObject({ text: 'proxy' });
    expect(find(entries, 'copy-image').run).toMatchObject({ text: 'reg/proxy:2' });
    expect(find(entries, 'copy-logs').run).toMatchObject({ text: 'kubectl -n shop logs -f api-1 -c proxy' });
    expect(find(entries, 'copy-exec').run).toMatchObject({ text: 'kubectl -n shop exec -it api-1 -c proxy -- sh' });
  });
  it('gates shell and delete on read-only, and Completed pods', () => {
    const readOnly = menu({ type: 'container', pod: pod(), name: 'api' }, { ...drilled(), status: READ_ONLY, state: state({ containersOf: pod(), status: READ_ONLY }) });
    expect(find(readOnly, 'shell')).toMatchObject({ disabled: true, hint: READ_ONLY_MESSAGE });
    expect(find(readOnly, 'delete')).toMatchObject({ disabled: true, hint: READ_ONLY_MESSAGE });
    const done = pod({ cells: { status: 'Completed' } });
    expect(find(menu({ type: 'container', pod: done, name: 'api' }, drilled(done)), 'shell').hint).toBe('Der Pod läuft nicht.');
  });
  it('disables terminal entries when not connected', () => {
    const entries = menu({ type: 'container', pod: pod(), name: 'api' }, withStatus(RECONNECTING));
    expect(find(entries, 'logs')).toMatchObject({ disabled: true, hint: RECONNECTING_MESSAGE });
    expect(find(entries, 'copy-name').disabled).toBeUndefined();
  });
});

describe('C node tiles', () => {
  it('starts with a heading naming the state (C27)', () => {
    const heading = (t: NodeTile) => (menu({ type: 'node', tile: t })[0] as { label: string }).label;
    expect(heading(tile())).toBe('worker2 · bereit');
    expect(heading(tile({ ready: false, pressure: ['DiskPressure'] }))).toBe('worker2 · nicht bereit, DiskPressure');
    expect(heading(tile({ unschedulable: true, pressure: ['MemoryPressure', 'PIDPressure'] }))).toBe('worker2 · bereit, MemoryPressure, PIDPressure, gesperrt');
    expect(menu({ type: 'node', tile: tile() })[0].kind).toBe('heading');
  });
  it('lists the tile menu without hotkey hints (C8)', () => {
    const entries = menu({ type: 'node', tile: tile() });
    expect(labels(entries).slice(1)).toEqual([
      'Node anzeigen', 'Pods auf dieser Node anzeigen', '---', 'Describe', 'Events', 'YAML', 'SSH-Verbindung öffnen', '---', 'Kopieren', 'Name', 'Interne IP', '---', 'Node sperren (cordon)…',
    ]);
    for (const entry of items(entries)) if (!entry.disabled && entry.id !== 'ssh') expect(entry.hint).toBeUndefined();
  });
  it('jumps without touching the selection and opens the node query', () => {
    const entries = menu({ type: 'node', tile: tile() });
    expect(find(entries, 'node').run).toEqual({ type: 'view', actions: [{ type: 'jump', ref: { kind: 'nodes', name: 'worker2' } }] });
    expect(find(entries, 'node-pods').run).toEqual({ type: 'view', actions: [{ type: 'openQuery', query: { kind: 'pods', namespace: null, selector: { node: 'worker2' } }, crumb: 'Node worker2' }] });
    expect(find(entries, 'describe').run).toEqual({ type: 'view', actions: [{ type: 'jump', ref: { kind: 'nodes', name: 'worker2' } }, { type: 'dock', mode: 'describe' }] });
    expect(find(entries, 'cordon').run).toEqual({ type: 'kubeAction', ref: { kind: 'nodes', name: 'worker2' }, action: 'cordon' });
  });
  it('uses the ref of the tile for uncordon and ssh with the tile ip', () => {
    const seen: unknown[] = [];
    const entries = menu({ type: 'node', tile: tile({ unschedulable: true }) }, context({ sshForNode: n => { seen.push(n); return ssh(n); } }));
    expect(find(entries, 'uncordon')).toMatchObject({ label: 'Node freigeben (uncordon)…' });
    expect(seen).toContainEqual({ name: 'worker2', ip: '10.0.0.2' });
    expect(find(entries, 'ssh').hint).toBe('w2-ssh');
  });
  it('omits the ip copy without ip and gates on read-only / connection', () => {
    expect(has(menu({ type: 'node', tile: tile({ ip: undefined }) }), 'copy-ip')).toBe(false);
    expect(find(menu({ type: 'node', tile: tile() }, withStatus(READ_ONLY)), 'cordon')).toMatchObject({ disabled: true, hint: READ_ONLY_MESSAGE });
    const down = menu({ type: 'node', tile: tile() }, withStatus(RECONNECTING));
    expect(find(down, 'describe')).toMatchObject({ disabled: true, hint: RECONNECTING_MESSAGE });
    expect(find(down, 'node').disabled).toBeUndefined();
    expect(find(down, 'node-pods').disabled).toBeUndefined();
  });
});

describe('D problems', () => {
  const entriesFor = (kind: ProblemKind, ctx?: MenuContext) => menu({ type: 'problem', problem: problem(kind) }, ctx);
  it.each([
    ['crashloop', ['Anzeigen', '---', 'Logs des vorherigen Containers', 'Logs', 'Describe', 'Events', '---', 'Kopieren', 'Name', 'Namespace/Name', 'Meldung', 'kubectl logs --previous', '---', 'Pod löschen…']],
    ['oomkilled', ['Anzeigen', '---', 'Logs des vorherigen Containers', 'Logs', 'Describe', 'Events', '---', 'Kopieren', 'Name', 'Namespace/Name', 'Meldung', 'kubectl logs --previous', '---', 'Pod löschen…']],
    ['image', ['Anzeigen', '---', 'Logs', 'Describe', 'Events', '---', 'Kopieren', 'Name', 'Namespace/Name', 'Meldung', '---', 'Pod löschen…']],
    ['pending', ['Anzeigen', '---', 'Logs', 'Describe', 'Events', '---', 'Kopieren', 'Name', 'Namespace/Name', 'Meldung', '---', 'Pod löschen…']],
    ['node', ['Anzeigen', 'Pods auf dieser Node anzeigen', '---', 'Describe', 'Events', 'SSH-Verbindung öffnen', '---', 'Kopieren', 'Name', 'Meldung']],
  ] as const)('lists the %s menu', (kind, expected) => {
    expect(labels(entriesFor(kind))).toEqual(expected);
  });
  it('uses the ref of the problem, no hotkey hints (C8)', () => {
    const entries = entriesFor('crashloop');
    expect(find(entries, 'previous').run).toEqual({ type: 'view', actions: [{ type: 'jump', ref: problem('crashloop').ref }, { type: 'dock', mode: 'logs' }], previous: true });
    expect(find(entries, 'logs').run).toMatchObject({ previous: false });
    expect(find(entries, 'delete').run).toEqual({ type: 'kubeAction', ref: problem('crashloop').ref, action: 'delete' });
    for (const entry of items(entries)) if (!entry.disabled) expect(entry.hint).toBeUndefined();
    expect(find(entries, 'copy-logs').run).toMatchObject({ text: 'kubectl -n shop logs --previous api-1' });
  });
  it('copies the problem as readable text, not as its code', () => {
    expect(find(entriesFor('crashloop'), 'copy-message').run).toMatchObject({ text: 'api-1 wurde wegen Speichermangel beendet (OOMKilled)' });
  });
  it('takes the ssh ip from state.nodes (C27)', () => {
    const seen: unknown[] = [];
    entriesFor('node', context({ state: state({ nodes: [tile({ ip: '10.7.7.7' })] }), sshForNode: n => { seen.push(n); return ssh(n); } }));
    expect(seen).toContainEqual({ name: 'worker2', ip: '10.7.7.7' });
    const entries = entriesFor('node');
    expect(find(entries, 'node-pods').run).toMatchObject({ actions: [{ type: 'openQuery', crumb: 'Node worker2' }] });
  });
  it('gates read-only and connection', () => {
    expect(find(entriesFor('image', withStatus(READ_ONLY)), 'delete')).toMatchObject({ disabled: true, hint: READ_ONLY_MESSAGE });
    const down = entriesFor('crashloop', withStatus(RECONNECTING));
    expect(find(down, 'previous')).toMatchObject({ disabled: true, hint: RECONNECTING_MESSAGE });
    expect(find(down, 'show').disabled).toBeUndefined();
    expect(find(entriesFor('crashloop', withStatus(null)), 'delete').disabled).toBe(true);
  });
});

describe('H header and I background', () => {
  const column = KIND_COLUMNS.pods[3];
  it('sorts ascending, descending and clears', () => {
    const entries = menu({ type: 'header', column }, context({ state: state({ sort: { key: 'restarts', descending: false } }) }));
    expect(labels(entries)).toEqual(['Aufsteigend sortieren', 'Absteigend sortieren', 'Sortierung aufheben']);
    expect(find(entries, 'sort-asc').run).toEqual({ type: 'view', actions: [{ type: 'sortBy', sort: { key: 'restarts', descending: false } }] });
    expect(find(entries, 'sort-desc').run).toEqual({ type: 'view', actions: [{ type: 'sortBy', sort: { key: 'restarts', descending: true } }] });
    expect(find(entries, 'sort-clear')).toMatchObject({ hint: 'Standard: Reihenfolge des Eintreffens', run: { actions: [{ type: 'sortBy', sort: null }] } });
    expect(find(entries, 'sort-clear').disabled).toBeUndefined();
  });
  it('disables clearing without a sort, and still sorts when not connected', () => {
    const entries = menu({ type: 'header', column }, withStatus(RECONNECTING));
    expect(find(entries, 'sort-clear')).toMatchObject({ disabled: true, hint: 'Standard: Reihenfolge des Eintreffens' });
    expect(find(entries, 'sort-asc').disabled).toBeUndefined();
  });
  it('lists the background menu', () => {
    const entries = menu({ type: 'background' });
    expect(labels(entries)).toEqual(['Alle Filter zurücksetzen', 'Textfilter entfernen', 'Status-Filter leeren', 'Gruppierung aufheben', 'Alle Namespaces', 'Sortierung aufheben', '---', 'Hilfe…']);
    expect(has(entries, 'filter-clear')).toBe(false);
    expect(find(entries, 'search-clear')).toMatchObject({ disabled: true, hint: 'Kein Textfilter gesetzt.', run: { actions: [{ type: 'search', text: '' }] } });
    expect(find(entries, 'filter-reset')).toMatchObject({ disabled: true, hint: 'Kein Filter gesetzt.', run: { actions: [{ type: 'clearFilter' }] } });
    expect(find(entries, 'group-clear')).toMatchObject({ disabled: true, hint: 'Keine Gruppierung gesetzt.', run: { actions: [{ type: 'setGroupBy', groupBy: null }] } });
    expect(find(entries, 'chips-clear')).toMatchObject({ disabled: true, hint: 'Kein Status-Filter gesetzt.', run: { actions: [{ type: 'setChips', ids: [] }] } });
    expect(find(entries, 'sort-clear')).toMatchObject({ disabled: true, hint: 'Standard: Reihenfolge des Eintreffens' });
    expect(find(entries, 'help')).toMatchObject({ run: { type: 'help' }, hint: '?' });
    expect(find(entries, 'namespace').run).toMatchObject({ actions: [{ type: 'setNamespace', namespace: null }] });
  });
  it('enables search-clear and chips-clear independently (C22)', () => {
    const textOnly = menu({ type: 'background' }, context({ state: state({ filters: { pods: { text: 'api', chips: [] } } }) }));
    expect(find(textOnly, 'search-clear').disabled).toBeUndefined();
    expect(find(textOnly, 'chips-clear').disabled).toBe(true);
    const chipsOnly = menu({ type: 'background' }, context({ state: state({ filters: { pods: { text: '', chips: ['failed'] } } }) }));
    expect(find(chipsOnly, 'search-clear').disabled).toBe(true);
    expect(find(chipsOnly, 'chips-clear')).toMatchObject({ run: { actions: [{ type: 'setChips', ids: [] }] } });
    expect(find(chipsOnly, 'chips-clear').disabled).toBeUndefined();
  });
  it('enables filter-reset for column filters only and group-clear for a grouping (C28)', () => {
    const cols = menu({ type: 'background' }, context({ state: state({ filters: { pods: { text: '', chips: [], columns: { status: 'Running' } } } }) }));
    expect(find(cols, 'filter-reset').disabled).toBeUndefined();
    expect(find(cols, 'filter-reset').hint).toContain('F');
    expect(find(cols, 'search-clear').disabled).toBe(true);
    const grouped = menu({ type: 'background' }, context({ state: state({ groups: { pods: { by: 'namespace', collapsed: [] } } }) }));
    expect(find(grouped, 'group-clear').disabled).toBeUndefined();
    expect(find(grouped, 'filter-reset').disabled).toBe(true);
  });
  it('uses the events default sort for "Sortierung aufheben" (C21)', () => {
    const events = (sort: KubeViewState['sort']) => state({ query: { kind: 'events', namespace: 'shop' }, sort });
    const atDefault = menu({ type: 'background' }, context({ state: events({ key: 'last', descending: true }) }));
    expect(find(atDefault, 'sort-clear')).toMatchObject({ disabled: true, hint: 'Standard: Zuletzt absteigend' });
    const otherDirection = menu({ type: 'background' }, context({ state: events({ key: 'last', descending: false }) }));
    expect(find(otherDirection, 'sort-clear').disabled).toBeUndefined();
    const nullSort = menu({ type: 'header', column: KIND_COLUMNS.events[0] }, context({ state: events(null) }));
    expect(find(nullSort, 'sort-clear').disabled).toBeUndefined();
    expect(find(nullSort, 'sort-clear').run).toEqual({ type: 'view', actions: [{ type: 'sortBy', sort: null }] });
    const podsDefault = menu({ type: 'header', column }, context({ state: state({ sort: null }) }));
    expect(find(podsDefault, 'sort-clear')).toMatchObject({ disabled: true, hint: 'Standard: Reihenfolge des Eintreffens' });
  });
  it('clears a set filter and sort, and goes back to the default namespace from all (C26)', () => {
    const ctx = context({ state: state({ filters: { pods: { text: 'api', chips: [] } }, sort: { key: 'name', descending: true }, query: { kind: 'pods', namespace: null } }) });
    const entries = menu({ type: 'background' }, ctx);
    expect(find(entries, 'search-clear')).toMatchObject({ run: { actions: [{ type: 'search', text: '' }] } });
    expect(find(entries, 'search-clear').disabled).toBeUndefined();
    expect(find(entries, 'sort-clear').disabled).toBeUndefined();
    expect(find(entries, 'namespace')).toMatchObject({ label: 'Zurück zu shop', run: { actions: [{ type: 'setNamespace', namespace: 'shop' }] } });
    const none = menu({ type: 'background' }, context({ status: { ...READY, namespace: undefined }, state: state({ query: { kind: 'pods', namespace: null } }) }));
    expect(find(none, 'namespace').label).toBe('Zurück zu default');
  });
});

describe('J dock bar', () => {
  const dockTarget = (patch: Partial<Extract<MenuTarget, { type: 'dock' }>> = {}): MenuTarget => ({ type: 'dock', mode: 'logs', pod: pod(), container: 'api', previous: false, ...patch });
  it('lists the logs menu with two containers', () => {
    const entries = menu(dockTarget());
    expect(labels(entries)).toEqual([
      'Logs', 'Shell', 'Events', 'YAML', 'Describe', '---',
      'Logs des vorherigen Containers', 'Container: api', 'Container: proxy', 'Logs neu starten', 'Als Tab öffnen', '---', 'Panel einklappen',
    ]);
    expect(find(entries, 'mode-logs').hint).toBe('l');
    expect(find(entries, 'previous').hint).toBe('p');
    expect(find(entries, 'container-api').hint).toBe('aktiv');
    expect(find(entries, 'container-proxy').hint).toBeUndefined();
    expect(find(entries, 'container-proxy').run).toEqual({ type: 'view', actions: [{ type: 'selectContainer', name: 'proxy' }] });
    expect(find(entries, 'reload').run).toEqual({ type: 'dockReload' });
    expect(find(entries, 'toggle')).toMatchObject({ hint: 'Ctrl+j', run: { actions: [{ type: 'toggleDock' }] } });
    expect(find(entries, 'popout')).toMatchObject({ hint: 'Ctrl+Shift+T', run: { type: 'popout', target: { namespace: 'shop', pod: 'api-1', container: 'api', mode: 'logs' } } });
  });
  it('toggles previous logs', () => {
    const entries = menu(dockTarget({ previous: true }));
    expect(find(entries, 'previous')).toMatchObject({ label: 'Aktuelle Logs', run: { type: 'view', actions: [], previous: false } });
    expect(find(entries, 'popout').run).toMatchObject({ target: { mode: 'previous' } });
    expect(find(menu(dockTarget()), 'previous').run).toMatchObject({ previous: true });
  });
  it('has no container, previous or reload entries for a single-container pod in shell mode', () => {
    const entries = menu(dockTarget({ mode: 'shell', pod: singlePod() }));
    expect(items(entries).map(entry => entry.id)).toEqual(['mode-logs', 'mode-shell', 'mode-events', 'mode-yaml', 'mode-describe', 'popout', 'toggle']);
    expect(find(entries, 'popout').run).toMatchObject({ target: { mode: 'shell' } });
  });
  it('has only the generic entries without a pod', () => {
    const entries = menu(dockTarget({ mode: 'yaml', pod: null, container: null }));
    expect(find(entries, 'mode-logs')).toMatchObject({ disabled: true, hint: 'Nur für Pods.' });
    expect(find(entries, 'mode-shell')).toMatchObject({ disabled: true, hint: 'Nur für Pods.' });
    expect(find(entries, 'mode-yaml').disabled).toBeUndefined();
    expect(has(entries, 'popout')).toBe(false);
    expect(has(entries, 'reload')).toBe(false);
  });
  it('arms the shell mode and gates it', () => {
    expect(find(menu(dockTarget()), 'mode-shell')).toMatchObject({ hint: 's', run: { armShell: true, actions: [{ type: 'dock', mode: 'shell' }] } });
    expect(find(menu(dockTarget(), withStatus(READ_ONLY)), 'mode-shell')).toMatchObject({ disabled: true, hint: READ_ONLY_MESSAGE });
    expect(find(menu(dockTarget({ pod: pod({ cells: { status: 'Completed' } }) })), 'mode-shell').hint).toBe('Der Pod läuft nicht.');
  });
  it('disables view, reload and popout when not connected, or popout without support', () => {
    const down = menu(dockTarget(), withStatus(RECONNECTING));
    for (const id of ['mode-logs', 'mode-events', 'previous', 'container-proxy', 'reload', 'popout']) expect(find(down, id)).toMatchObject({ disabled: true, hint: RECONNECTING_MESSAGE });
    expect(find(down, 'toggle').disabled).toBeUndefined();
    expect(find(menu(dockTarget(), context({ canPopout: false })), 'popout')).toMatchObject({ disabled: true, hint: 'Hier lässt sich kein Tab öffnen.' });
  });
  it('lists the dock menu of a events/yaml mode with container choice only for logs-like pods', () => {
    const entries = menu(dockTarget({ mode: 'events' }));
    expect(has(entries, 'container-proxy')).toBe(true);
    expect(has(entries, 'previous')).toBe(false);
    expect(has(entries, 'popout')).toBe(false);
  });
});

describe('K dock content', () => {
  it('copies the whole text and the selection', () => {
    const entries = menu({ type: 'dockText', mode: 'yaml', text: 'a: b\nc: d', selection: 'a: b' });
    expect(labels(entries)).toEqual(['Kopieren', 'YAML kopieren', 'Markierung kopieren']);
    expect(find(entries, 'copy-yaml').run).toEqual({ type: 'copy', text: 'a: b\nc: d', label: 'YAML kopieren' });
    expect(find(entries, 'copy-selection').run).toMatchObject({ text: 'a: b' });
  });
  it('labels describe and drops entries without text', () => {
    expect(labels(menu({ type: 'dockText', mode: 'describe', text: 'x', selection: '' }))).toEqual(['Kopieren', 'Describe kopieren']);
    expect(menu({ type: 'dockText', mode: 'yaml', text: '', selection: '' })).toEqual([]);
  });
  it('copies the event message and jumps to the object', () => {
    const ev = row('events', 'e', { cells: { message: 'Back-off' }, involved: { kind: 'Pod', name: 'api-1', ref: { kind: 'pods', namespace: 'shop', name: 'api-1' } } });
    const entries = menu({ type: 'dockEvent', row: ev });
    expect(labels(entries)).toEqual(['Zum Objekt springen', '---', 'Kopieren', 'Meldung kopieren']);
    expect(find(entries, 'involved').run).toEqual({ type: 'view', actions: [{ type: 'jump', ref: { kind: 'pods', namespace: 'shop', name: 'api-1' } }] });
    expect(find(entries, 'copy-message').run).toMatchObject({ text: 'Back-off' });
  });
  it('disables the jump for a foreign object kind', () => {
    const ev = row('events', 'e', { cells: { message: 'm' }, involved: { kind: 'Lease', name: 'l' } });
    expect(find(menu({ type: 'dockEvent', row: ev }), 'involved')).toMatchObject({ disabled: true, hint: 'Objekte vom Typ Lease zeigt Shellherd nicht an.' });
  });
});

describe('invariants', () => {
  const rows: KubeRow[] = [
    pod(), singlePod(), pod({ cells: { status: 'Completed' } }), deployment(), row('daemonsets', 'agent', { selector: { a: 'b' } }), row('statefulsets', 'db', { selector: { a: 'b' }, replicas: 2 }),
    row('jobs', 'j', { selector: { a: 'b' } }), row('cronjobs', 'c', { cells: { schedule: '* * * * *' } }), row('cronjobs', 'c', { suspended: true }),
    row('services', 's', { cells: { clusterIp: '1.2.3.4', ports: '80/TCP' }, selector: { a: 'b' } }), row('ingresses', 'i', { cells: { hosts: 'x.example.com', address: '1.1.1.1' } }),
    node(), node({ unschedulable: true }), row('events', 'e', { cells: { message: 'm; rm -rf $(x) | y & `z`', reason: 'R', object: 'Pod/a' } }),
  ];
  const targets: MenuTarget[] = [
    ...rows.map(r => ({ type: 'row', row: r }) as MenuTarget),
    { type: 'container', pod: pod(), name: 'api' }, { type: 'node', tile: tile() }, { type: 'node', tile: tile({ unschedulable: true }) },
    ...(['crashloop', 'oomkilled', 'image', 'pending', 'node'] as const).map(kind => ({ type: 'problem', problem: problem(kind) }) as MenuTarget),
    { type: 'dock', mode: 'logs', pod: pod(), container: 'api', previous: false },
  ];
  const contexts = [READY, READ_ONLY, RECONNECTING, PRODUCTION, null].map(status => withStatus(status));

  it('activates no kubeAction when actionReason gives a reason, and always uses actionReason text', () => {
    let checked = 0;
    for (const target of targets) for (const ctx of contexts) {
      for (const entry of items(menuFor(target, ctx))) {
        if (entry.run.type !== 'kubeAction') continue;
        checked++;
        const reason = actionReason(entry.run.action, { ref: entry.run.ref, readOnly: ctx.status?.readOnly ?? true, connected: ctx.status?.state === 'ready', reconnecting: ctx.status?.state === 'reconnecting' });
        if (reason) expect(entry).toMatchObject({ disabled: true, hint: reason });
        else expect(entry.disabled).toBeUndefined();
        if (!reason) expect(ACTION_KINDS[entry.run.action]).toContain(entry.run.ref.kind);
      }
    }
    expect(checked).toBeGreaterThan(40);
  });
  it('ends every mutating label with an ellipsis and models it as kubeAction', () => {
    for (const target of targets) for (const entry of items(menuFor(target, context()))) {
      if (entry.run.type === 'kubeAction') expect(entry.label.endsWith('…')).toBe(true);
      if (/(löschen|sperren|freigeben|Anhalten|Fortsetzen|ausführen|neu starten|Skalieren)…$/.test(entry.label)) expect(entry.run.type).toBe('kubeAction');
    }
  });
  it('copies only plain kubectl commands, apart from the fixed patch literal and free-text fields (C21)', () => {
    const plain = /^kubectl( [-a-zA-Z0-9./=:,_]+)+$/;
    const patch = /^kubectl -n [a-z0-9.-]+ patch cronjob [a-z0-9.-]+ -p '\{"spec":\{"suspend":(true|false)\}\}'$/;
    let commands = 0;
    for (const target of targets) for (const ctx of contexts) for (const entry of items(menuFor(target, ctx))) {
      if (entry.run.type !== 'copy' || !entry.run.text.startsWith('kubectl ')) continue;
      commands++;
      expect(plain.test(entry.run.text) || patch.test(entry.run.text), entry.run.text).toBe(true);
    }
    expect(commands).toBeGreaterThan(30);
  });
  it('rejects hostile names instead of copying them', () => {
    for (const name of ['a;b', 'a|b', 'a$b', 'a`b', 'a&b', 'a b']) {
      const entries = rowMenu(pod({ ref: { kind: 'pods', namespace: 'shop', name }, containers: ['api'] }));
      for (const id of ['copy-logs', 'copy-exec', 'copy-describe']) expect(find(entries, id)).toMatchObject({ disabled: true, hint: 'Name enthält ungültige Zeichen.' });
    }
    const hostileCronJob = rowMenu(row('cronjobs', 'a;b'));
    expect(find(hostileCronJob, 'copy-create-job').disabled).toBe(true);
    expect(find(hostileCronJob, 'copy-patch').disabled).toBe(true);
  });
  it('never copies env values, secrets, tokens or server urls', () => {
    for (const target of targets) for (const entry of items(menuFor(target, context()))) {
      if (entry.run.type === 'copy') expect(entry.run.text).not.toMatch(/token|secret|kubeconfig|https:\/\/[^\s]*:6443/i);
    }
  });
  it('is pure: the same input gives the same output without mutating the row', () => {
    const r = pod();
    const snapshot = JSON.stringify(r);
    expect(rowMenu(r)).toEqual(rowMenu(r));
    expect(JSON.stringify(r)).toBe(snapshot);
  });
});

describe('T6 "Nur <Chip> anzeigen" (C24)', () => {
  const onlyId = (entries: MenuEntry[]) => items(entries).find(entry => entry.id.startsWith('only-'));
  const expectOnly = (entries: MenuEntry[], r: KubeRow, id: string, label: string) => {
    expect(find(entries, `only-${id}`)).toMatchObject({ label: `Nur ${label} anzeigen`, run: { type: 'view', actions: [{ type: 'select', key: refKey(r.ref) }, { type: 'setChips', ids: [id] }] } });
    expect(find(entries, `only-${id}`).hint).toBeUndefined();
  };
  it('pods: first matching status chip, last in the first group after the filter entries', () => {
    const bad = pod({ tone: 'bad', cells: { status: 'CrashLoopBackOff' } });
    const entries = rowMenu(bad);
    expectOnly(entries, bad, 'failed', 'Fehler');
    const ids = items(entries).map(entry => entry.id);
    const last = ids.filter(id => id.startsWith('filter-')).pop() as string;
    expect(ids.indexOf('only-failed')).toBe(ids.indexOf(last) + 1);
    expect(labels(entries)[labels(entries).indexOf('Nur Fehler anzeigen') + 1]).toBe('---');
    expectOnly(rowMenu(pod()), pod(), 'running', 'Läuft');
    expect(onlyId(rowMenu(pod({ cells: { status: 'Whatever' } })))).toBeUndefined();
  });
  it('jobs, services, nodes and events get their chip; other kinds none', () => {
    const job = row('jobs', 'j', { cells: { status: 'Failed' }, tone: 'bad' });
    expect(onlyId(rowMenu(job))?.id).toBe('only-failed');
    const service = row('services', 's', { cells: { type: 'NodePort', clusterIp: '10.0.0.1' }, selector: { a: 'b' } });
    expectOnly(rowMenu(service), service, 'nodeport', 'NodePort');
    const cordoned = node({ unschedulable: true });
    expectOnly(rowMenu(cordoned), cordoned, 'cordoned', 'Gesperrt');
    expect(onlyId(rowMenu(node()))).toBeUndefined();
    const event = row('events', 'e', { cells: { type: 'Warning' }, involved: { kind: 'Pod', name: 'api-1', ref: { kind: 'pods', namespace: 'shop', name: 'api-1' } } });
    expectOnly(rowMenu(event), event, 'warning', 'Warning');
    expect(onlyId(rowMenu(deployment()))).toBeUndefined();
    expect(onlyId(rowMenu(row('cronjobs', 'c')))).toBeUndefined();
    expect(onlyId(rowMenu(row('ingresses', 'i')))).toBeUndefined();
  });
  it('an event without an involved object has the entry as its only first group', () => {
    const entries = rowMenu(row('events', 'e', { cells: { type: 'Normal', message: 'm' } }));
    expect(labels(entries).slice(0, 2)).toEqual(['Nur Normal anzeigen', '---']);
  });
  it('does not read the selection (C14)', () => {
    const r = pod({ tone: 'bad' });
    expect(rowMenu(r, context({ state: state({ selected: 'other' }) }))).toEqual(rowMenu(r, context({ state: state({ selected: null }) })));
  });
});

describe('English catalog', () => {
  it('words the pod menu and its reasons natively', async () => {
    await i18n.changeLanguage('en-US');
    try {
      const entries = rowMenu(pod(), withStatus(READ_ONLY));
      expect(find(entries, 'drill').label).toBe('Show containers');
      expect(find(entries, 'delete')).toMatchObject({ label: 'Delete pod…', disabled: true, hint: 'This cluster is read-only.' });
      expect(find(entries, 'copy-namespaced-name').label).toBe('Namespace/Name');
      expect(find(entries, 'events').label).toBe('Events');
      expect(labels(menu({ type: 'background' }))).toContain('Help…');
    } finally { await i18n.changeLanguage('de-DE'); }
  });
});

describe('port forward entry', () => {
  const service = (patch: Partial<KubeRow> = {}) => row('services', 'web', { cells: { ports: '80/TCP' }, selector: { app: 'web' }, ports: [{ port: 80 }], ...patch });

  it('opens the dialog for a running pod, also on a read-only cluster', () => {
    const target = pod();
    expect(find(rowMenu(target), 'forward')).toMatchObject({ label: 'Port weiterleiten…', run: { type: 'forward', row: target } });
    expect(find(rowMenu(target), 'forward').disabled).toBeUndefined();
    expect(find(rowMenu(target, withStatus(READ_ONLY)), 'forward').disabled).toBeUndefined();
  });

  it('explains why it is not available', () => {
    expect(find(rowMenu(pod({ cells: { status: 'Pending' } })), 'forward')).toMatchObject({ disabled: true, hint: 'Der Pod läuft nicht.' });
    expect(find(rowMenu(pod(), withStatus(RECONNECTING)), 'forward')).toMatchObject({ disabled: true, hint: RECONNECTING_MESSAGE });
    expect(find(rowMenu(service({ ports: undefined })), 'forward')).toMatchObject({ disabled: true, hint: 'Dieser Service hat keinen TCP-Port.' });
    expect(find(rowMenu(service({ selector: undefined })), 'forward')).toMatchObject({ disabled: true, hint: 'Dieser Service hat keinen Selector, z. B. ExternalName.' });
    expect(find(rowMenu(service()), 'forward').disabled).toBeUndefined();
  });
});

describe('logs of all pods and the rights pre-check in menus', () => {
  const FORBIDDEN_PATCH = 'Keine Berechtigung: patch auf deployments in shop';
  const withAccess = (denied: KubeDenied[] | null, status: ClusterStatus = READY): MenuContext =>
    context({ status, state: state({ status, access: { shop: { at: NOW, denied } } }) });
  const job = row('jobs', 'backup-1', { selector: { 'job-name': 'backup-1' } });
  const service = row('services', 'web', { selector: { app: 'web' }, ports: [{ port: 80 }] });

  it('offers Logs aller Pods before Events for workloads, jobs and services, and runs logsAll', () => {
    for (const target of [deployment(), row('statefulsets', 'db', { selector: { app: 'db' } }), row('daemonsets', 'agent', { selector: { app: 'agent' } }), job, service]) {
      const labelsOf = labels(rowMenu(target));
      expect(labelsOf.indexOf('Logs aller Pods'), target.ref.kind).toBe(labelsOf.indexOf('Events') - 1);
      expect(find(rowMenu(target), 'logs-all')).toMatchObject({ run: { type: 'logsAll', row: target } });
      expect(find(rowMenu(target), 'logs-all').disabled).toBeUndefined();
    }
    expect(has(rowMenu(pod()), 'logs-all')).toBe(false);
    expect(has(rowMenu(row('cronjobs', 'nightly')), 'logs-all')).toBe(false);
  });

  it('greys it out without a selector, while not connected and without the right; read-only allows it', () => {
    expect(find(rowMenu(deployment({ selector: undefined })), 'logs-all').hint).toBe(t('kubeActions:reasons.noSelectorWorkload'));
    expect(find(rowMenu({ ...job, selector: undefined }), 'logs-all').hint).toBe(t('kubeActions:reasons.noSelectorJob'));
    expect(find(rowMenu({ ...service, selector: {} }), 'logs-all').hint).toBe(t('kubeActions:reasons.noSelectorService'));
    expect(find(rowMenu(deployment(), withStatus(RECONNECTING)), 'logs-all').hint).toBe(RECONNECTING_MESSAGE);
    expect(find(rowMenu(deployment(), withAccess([{ id: 'logsAll', verb: 'watch', resource: 'pods' }])), 'logs-all').hint).toBe('Keine Berechtigung: watch auf pods in shop');
    expect(find(rowMenu(deployment(), withStatus(READ_ONLY)), 'logs-all').disabled).toBeUndefined();
  });

  it('greys out restart and scale without patch, nothing when the rights are unknown, read-only first', () => {
    const entries = rowMenu(deployment(), withAccess([{ id: 'patchDeployments', verb: 'patch', resource: 'deployments' }]));
    expect(find(entries, 'restart')).toMatchObject({ disabled: true, hint: FORBIDDEN_PATCH });
    expect(find(entries, 'scale')).toMatchObject({ disabled: true, hint: FORBIDDEN_PATCH });
    const unknown = rowMenu(deployment(), withAccess(null));
    expect(find(unknown, 'restart').disabled).toBeUndefined();
    expect(find(unknown, 'scale').disabled).toBeUndefined();
    expect(find(rowMenu(deployment(), withAccess([{ id: 'patchDeployments', verb: 'patch', resource: 'deployments' }], READ_ONLY)), 'restart').hint).toBe(READ_ONLY_MESSAGE);
  });

  it('says cluster-wide for nodes and checks them with the default namespace', () => {
    const ctx = withAccess([{ id: 'patchNodes', verb: 'patch', resource: 'nodes' }]);
    expect(find(menu({ type: 'node', tile: tile() }, ctx), 'cordon').hint).toBe('Keine Berechtigung: patch auf nodes (clusterweit)');
    expect(find(rowMenu(node(), ctx), 'cordon').hint).toBe('Keine Berechtigung: patch auf nodes (clusterweit)');
  });

  it('gives logs, shell, forward and the tab entries of a pod their right, after Pod läuft nicht', () => {
    const ctx = withAccess([
      { id: 'logs', verb: 'get', resource: 'pods/log' }, { id: 'shell', verb: 'create', resource: 'pods/exec' }, { id: 'forward', verb: 'create', resource: 'pods/portforward' },
    ]);
    const entries = rowMenu(singlePod(), ctx);
    expect(find(entries, 'logs').hint).toBe('Keine Berechtigung: get auf pods/log in shop');
    expect(find(entries, 'previous').hint).toBe('Keine Berechtigung: get auf pods/log in shop');
    expect(find(entries, 'shell').hint).toBe('Keine Berechtigung: create auf pods/exec in shop');
    expect(find(entries, 'forward').hint).toBe('Keine Berechtigung: create auf pods/portforward in shop');
    expect(find(entries, 'popout-logs').hint).toBe('Keine Berechtigung: get auf pods/log in shop');
    expect(find(entries, 'popout-shell').hint).toBe('Keine Berechtigung: create auf pods/exec in shop');
    const stopped = rowMenu(pod({ containers: ['api'], cells: { status: 'Completed' } }), ctx);
    expect(find(stopped, 'shell').hint).toBe(t('kubeActions:reasons.notRunning'));
    expect(find(stopped, 'forward').hint).toBe(t('kubeActions:reasons.notRunning'));
  });

  it('checks the logs entries of problems, events and the dock', () => {
    const ctx = withAccess([{ id: 'logs', verb: 'get', resource: 'pods/log' }, { id: 'shell', verb: 'create', resource: 'pods/exec' }]);
    const reason = 'Keine Berechtigung: get auf pods/log in shop';
    expect(find(menu({ type: 'problem', problem: problem('crashloop') }, ctx), 'logs').hint).toBe(reason);
    expect(find(menu({ type: 'problem', problem: problem('crashloop') }, ctx), 'previous').hint).toBe(reason);
    const event = row('events', 'e1', { cells: { object: 'Pod/api-1' }, involved: { kind: 'Pod', name: 'api-1', ref: { kind: 'pods', namespace: 'shop', name: 'api-1' } } });
    expect(find(rowMenu(event, ctx), 'involved-logs').hint).toBe(reason);
    const dockEntries = menu({ type: 'dock', mode: 'logs', pod: singlePod(), container: 'api', previous: false }, ctx);
    expect(find(dockEntries, 'mode-logs').hint).toBe(reason);
    expect(find(dockEntries, 'previous').hint).toBe(reason);
    expect(find(dockEntries, 'mode-shell').hint).toBe('Keine Berechtigung: create auf pods/exec in shop');
  });
});
