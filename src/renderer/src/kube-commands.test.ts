import { describe, expect, it } from 'vitest';
import { KUBE_COMMANDS, bindingOf, commandForKey, completions, parseCommandLine } from './kube-commands';
import { initialKubeView } from './kube-view';

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
  });
  it('explains why actions are unavailable', () => {
    const state = { ...initialKubeView('shop') };
    const restart = KUBE_COMMANDS.find(command => command.id === 'restart')!;
    expect(restart.unavailable?.({ state, readOnly: true })).toBe('Dieser Cluster ist schreibgeschützt.');
    expect(restart.unavailable?.({ state, readOnly: false })).toBe('Nur für Deployments, StatefulSets und DaemonSets.');
    expect(KUBE_COMMANDS.find(command => command.id === 'shell')!.unavailable?.({ state, readOnly: true })).toBe('Dieser Cluster ist schreibgeschützt.');
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
