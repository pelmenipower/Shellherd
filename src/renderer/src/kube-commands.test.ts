import { describe, expect, it } from 'vitest';
import { ACTION_KINDS, type KubeAction, type KubeKind, type KubeRow } from '../../shared/kubernetes';
import { KUBE_COMMANDS, actionReason, commandDescription, bindingOf, commandForKey, podNotRunning } from './kube-commands';
import { i18n, t } from './i18n';
import { initialKubeView, type KubeViewState } from './kube-view';

const RECONNECTING_MESSAGE = t('kubeActions:reasons.reconnecting');

const READY = { state: 'ready', name: 'c', production: false, readOnly: false, metrics: true } as const;
const ref = (kind: KubeKind) => ({ kind, namespace: kind === 'nodes' ? undefined : 'shop', name: 'x' });
const row = (kind: KubeKind, status?: string): KubeRow => ({ uid: 'u', ref: ref(kind), cells: status ? { status } : {}, tone: 'ok', labels: {}, containers: ['a'] });
const withRow = (kind: KubeKind, status?: string): KubeViewState => {
  const r = row(kind, status);
  return { ...initialKubeView('shop'), status: READY, query: { kind, namespace: 'shop' }, rows: [r], selected: `${kind}/${r.ref.namespace ?? ''}/x` };
};

describe('actionReason', () => {
  const ACTIONS = Object.keys(ACTION_KINDS) as KubeAction[];
  const wrong = (action: KubeAction): KubeKind => (action === 'cordon' || action === 'uncordon' ? 'pods' : 'nodes');
  it.each(ACTIONS)('checks %s in order: readOnly, connected, kind, ref', action => {
    const right = ref(ACTION_KINDS[action][0]);
    expect(actionReason(action, { ref: null, readOnly: true, connected: false })).toBe('Dieser Cluster ist schreibgeschützt.');
    expect(actionReason(action, { ref: null, readOnly: false, connected: false })).toBe('Der Cluster ist gerade nicht verbunden.');
    expect(actionReason(action, { ref: right, readOnly: false, connected: true })).toBeUndefined();
    expect(actionReason(action, { ref: null, readOnly: false, connected: true })).toBe('Wähle zuerst eine Zeile.');
    expect(actionReason(action, { ref: ref(wrong(action)), readOnly: false, connected: true })).toMatch(/^Nur für /);
    expect(actionReason(action, { ref: null, kind: wrong(action), readOnly: false, connected: true })).toMatch(/^Nur für /);
  });
  it('words the lock as reconnecting while reconnecting (B8)', () => {
    expect(actionReason('restart', { ref: null, readOnly: false, connected: false, reconnecting: true })).toBe(RECONNECTING_MESSAGE);
    expect(actionReason('restart', { ref: null, readOnly: true, connected: false, reconnecting: true })).toBe('Dieser Cluster ist schreibgeschützt.');
  });
  it('words the registry locks as reconnecting, shell included (K24)', () => {
    const state = { ...withRow('pods', 'Running'), status: { ...READY, state: 'reconnecting' } } as KubeViewState;
    for (const id of ['restart', 'delete', 'shell']) expect(KUBE_COMMANDS.find(c => c.id === id)!.unavailable?.({ state, readOnly: false })).toBe(RECONNECTING_MESSAGE);
  });
  it('words the kind restriction for delete', () => {
    expect(actionReason('delete', { ref: ref('services'), readOnly: false, connected: true })).toBe('Nur für Pods und Jobs.');
  });
  it('feeds the registry from the selected row, or the drilled pod', () => {
    const command = (id: string) => KUBE_COMMANDS.find(c => c.id === id)!;
    expect(command('delete').unavailable?.({ state: withRow('jobs'), readOnly: false })).toBeUndefined();
    expect(command('restart').unavailable?.({ state: withRow('pods'), readOnly: false })).toBe('Nur für Deployments, StatefulSets und DaemonSets.');
    expect(command('restart').unavailable?.({ state: { ...withRow('deployments'), selected: null }, readOnly: false })).toBe('Wähle zuerst eine Zeile.');
    const pods = withRow('pods');
    expect(command('delete').unavailable?.({ state: { ...pods, containersOf: pods.rows[0], selected: null }, readOnly: false })).toBeUndefined();
  });
  it('refuses a shell in pods that do not run', () => {
    const shell = KUBE_COMMANDS.find(c => c.id === 'shell')!;
    expect(shell.unavailable?.({ state: withRow('pods', 'Running'), readOnly: false })).toBeUndefined();
    expect(shell.unavailable?.({ state: withRow('pods', 'Completed'), readOnly: false })).toBe('Der Pod läuft nicht.');
    expect(podNotRunning(row('pods', 'Terminating'))).toBe(true);
    expect(podNotRunning(null)).toBe(false);
  });
});

describe('kube commands', () => {
  it('gives every command a description and a group', () => {
    for (const command of KUBE_COMMANDS) { expect(commandDescription(command).length).toBeGreaterThan(3); expect(['navigation', 'view', 'actions']).toContain(command.group); }
  });
  it('never binds a key twice', () => {
    const bindings = KUBE_COMMANDS.flatMap(command => command.bindings);
    expect(new Set(bindings).size).toBe(bindings.length);
  });
  it('maps the spec hotkeys', () => {
    expect(commandForKey('j')?.id).toBe('down'); expect(commandForKey('ArrowUp')?.id).toBe('up');
    expect(commandForKey('Enter')?.id).toBe('drill'); expect(commandForKey('Escape')?.id).toBe('back'); expect(commandForKey('Backspace')?.id).toBe('back');
    expect(commandForKey('l')?.id).toBe('logs'); expect(commandForKey('s')?.id).toBe('shell'); expect(commandForKey('e')?.id).toBe('events');
    expect(commandForKey('y')?.id).toBe('yaml'); expect(commandForKey('d')?.id).toBe('describe'); expect(commandForKey('p')?.id).toBe('previous');
    expect(commandForKey('r')?.id).toBe('restart'); expect(commandForKey('S')?.id).toBe('scale'); expect(commandForKey('Ctrl+d')?.id).toBe('delete');
    expect(commandForKey('Ctrl+j')?.id).toBe('toggleDock'); expect(commandForKey('Ctrl+Shift+T')?.id).toBe('popout');
    expect(commandForKey('?')?.id).toBe('help'); expect(commandForKey('/')?.id).toBe('filter'); expect(commandForKey(':')).toBeUndefined();
    expect(commandForKey('1')?.id).toBe('tab'); expect(commandForKey('0')?.id).toBe('tab');
  });
  it('builds bindings from keyboard events', () => {
    expect(bindingOf({ key: 'd', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false })).toBe('Ctrl+d');
    expect(bindingOf({ key: 'T', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false })).toBe('Ctrl+Shift+T');
    expect(bindingOf({ key: 'S', ctrlKey: false, shiftKey: true, altKey: false, metaKey: false })).toBe('S');
    expect(bindingOf({ key: 'F10', ctrlKey: false, shiftKey: true, altKey: false, metaKey: false })).toBe('Shift+F10');
    expect(bindingOf({ key: 'ContextMenu', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false })).toBe('ContextMenu');
    expect(commandForKey('Shift+F10')?.id).toBe('menu'); expect(commandForKey('ContextMenu')?.id).toBe('menu');
    expect(bindingOf({ key: 'ContextMenu', ctrlKey: false, shiftKey: true, altKey: false, metaKey: false })).toBe('Shift+ContextMenu');
    expect(commandForKey('Shift+ContextMenu')?.id).toBe('menu');
  });
  it('explains why actions are unavailable', () => {
    const state = { ...initialKubeView('shop') };
    const restart = KUBE_COMMANDS.find(command => command.id === 'restart')!;
    expect(restart.unavailable?.({ state, readOnly: true })).toBe('Dieser Cluster ist schreibgeschützt.');
    expect(restart.unavailable?.({ state: { ...state, status: READY }, readOnly: false })).toBe('Nur für Deployments, StatefulSets und DaemonSets.');
    expect(restart.unavailable?.({ state, readOnly: false })).toBe('Der Cluster ist gerade nicht verbunden.');
    expect(KUBE_COMMANDS.find(command => command.id === 'shell')!.unavailable?.({ state, readOnly: true })).toBe('Dieser Cluster ist schreibgeschützt.');
  });
  it('the shell hotkey needs a connection after read-only (M-2)', () => {
    const shell = KUBE_COMMANDS.find(command => command.id === 'shell')!;
    const pods = { ...initialKubeView('shop'), query: { kind: 'pods' as const, namespace: 'shop' } };
    expect(shell.unavailable?.({ state: pods, readOnly: false })).toBe('Der Cluster ist gerade nicht verbunden.');
    expect(shell.unavailable?.({ state: { ...pods, status: READY }, readOnly: false })).toBeUndefined();
  });
  it('gives every command a key and a binding', () => {
    for (const command of KUBE_COMMANDS) { expect(command.keys.length).toBeGreaterThan(0); expect(command.bindings.length).toBeGreaterThan(0); }
  });
  it('describes / as the name filter and locks it in the container list', () => {
    const filter = commandForKey('/')!;
    expect(commandDescription(filter)).toBe('Name filtern (Events: Meldung)');
    expect(filter.unavailable?.({ state: withRow('pods'), readOnly: false })).toBeUndefined();
    const pods = withRow('pods');
    expect(filter.unavailable?.({ state: { ...pods, containersOf: pods.rows[0] }, readOnly: false })).toBe('In der Container-Liste gibt es keine Filter.');
    expect(commandDescription(commandForKey('F')!)).toBe('Alle Filter des Reiters zurücksetzen (Gruppierung bleibt)');
  });
});

describe('search and status commands', () => {
  it('binds w and F, available per kind', () => {
    expect(commandForKey('w')?.id).toBe('attention');
    expect(commandForKey('F')?.id).toBe('resetFilter');
    expect(bindingOf({ key: 'F', ctrlKey: false, shiftKey: true, altKey: false, metaKey: false })).toBe('F');
    const attention = commandForKey('w')!;
    expect(attention.unavailable?.({ state: withRow('pods'), readOnly: false })).toBeUndefined();
    expect(attention.unavailable?.({ state: withRow('events'), readOnly: false })).toBeUndefined();
    for (const kind of ['cronjobs', 'services', 'ingresses'] as const) {
      expect(attention.unavailable?.({ state: withRow(kind), readOnly: false })).toBe('Dieser Reiter hat keinen Chip „Auffällig“.');
    }
    expect(commandForKey('F')!.unavailable).toBeUndefined();
  });
});

describe('commandDescription', () => {
  it('has a catalog text for every command in both languages', async () => {
    try {
      for (const language of ['de-DE', 'en-US']) {
        await i18n.changeLanguage(language);
        for (const command of KUBE_COMMANDS) expect(commandDescription(command)).not.toMatch(/^kubeActions:/);
      }
      await i18n.changeLanguage('en-US');
      expect(commandDescription(KUBE_COMMANDS.find(c => c.id === 'down')!)).toBe('Move down one row');
    } finally { await i18n.changeLanguage('de-DE'); }
  });
});
