import { describe, expect, it } from 'vitest';
import { ACTION_KINDS, type KubeAction, type KubeKind, type KubeRow } from '../../shared/kubernetes';
import { KUBE_COMMANDS, actionReason, bindingOf, commandForKey, completions, parseCommandLine, podNotRunning } from './kube-commands';
import { initialKubeView, type KubeViewState } from './kube-view';

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
    for (const command of KUBE_COMMANDS) { expect(command.description.length).toBeGreaterThan(3); expect(['Navigation', 'Ansicht', 'Aktionen']).toContain(command.group); }
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
    expect(commandForKey('?')?.id).toBe('help'); expect(commandForKey('/')?.id).toBe('filter'); expect(commandForKey(':')?.id).toBe('command');
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
  it('parses command lines', () => {
    expect(parseCommandLine(':pods')).toEqual({ id: 'kind', kind: 'pods' });
    expect(parseCommandLine('deploy')).toEqual({ id: 'kind', kind: 'deployments' });
    expect(parseCommandLine(':ns all')).toEqual({ id: 'namespace', namespace: null });
    expect(parseCommandLine(':ns shop')).toEqual({ id: 'namespace', namespace: 'shop' });
    expect(parseCommandLine(':scale 3')).toEqual({ id: 'scale', replicas: 3 });
    expect(parseCommandLine(':scale -1')).toEqual({ error: 'Replicas: ganze Zahl von 0 bis 1000.' });
    expect(parseCommandLine(':ns Shop')).toEqual({ error: 'Ungültiger Namespace „Shop“.' });
    expect(parseCommandLine(':foo')).toEqual({ error: 'Unbekannter Befehl „foo“. Mit ? siehst du alle Befehle.' });
  });
  it('completes commands and namespaces', () => {
    expect(completions(':n', [])).toEqual([':nodes', ':ns ']);
    expect(completions(':ns s', ['shop', 'monitoring', 'system'])).toEqual([':ns shop', ':ns system']);
  });
});
