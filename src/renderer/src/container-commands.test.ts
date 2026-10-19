import { describe, expect, it } from 'vitest';
import { INVENTORY_ACTIONS, type ContainerDockMode, type InventoryAction, type InventoryKind, type InventoryRow, type InventoryState } from '../../shared/containers';
import { CONTAINER_COMMANDS, actionUnavailable, commandForKey, type ContainerCommandContext, type ContainerCommandId } from './container-commands';

const row = (kind: InventoryKind, extra: Partial<InventoryRow> = {}): InventoryRow => ({
  uid: 'u', ref: { kind, runtime: 'docker', ref: 'x' }, id: 'x', name: 'x', cells: {}, tone: 'ok', labels: {}, ...extra,
});
const container = (state: InventoryState) => row('containers', { state });
const ctx = (extra: Partial<ContainerCommandContext> = {}): ContainerCommandContext => ({
  kind: 'containers', row: container('running'), dock: 'logs', canPopout: true, ...extra,
});
const reason = (id: ContainerCommandId, context: ContainerCommandContext) => CONTAINER_COMMANDS.find(c => c.id === id)!.unavailable?.(context);

describe('CONTAINER_COMMANDS', () => {
  it('binds no key twice and describes every command', () => {
    const bindings = CONTAINER_COMMANDS.flatMap(c => c.bindings);
    expect(new Set(bindings).size).toBe(bindings.length);
    for (const command of CONTAINER_COMMANDS) expect(command.description).not.toBe('');
  });
  it('looks up keys', () => {
    expect(commandForKey('Ctrl+d')?.id).toBe('remove');
    expect(commandForKey('F')?.id).toBe('resetFilter');
    expect(commandForKey('F5')?.id).toBe('reload');
    expect(commandForKey('?')?.id).toBe('help');
    expect(commandForKey('x')?.id).toBe('stop');
    expect(commandForKey('Enter')).toBeUndefined();
  });
  it('words attention', () => {
    expect(reason('attention', ctx())).toBeUndefined();
    expect(reason('attention', ctx({ kind: 'images' }))).toBe('Dieser Reiter hat keinen Chip „Auffällig“.');
  });
  it('words logs and shell', () => {
    expect(reason('logs', ctx())).toBeUndefined();
    expect(reason('logs', ctx({ kind: 'volumes' }))).toBe('Nur für Container.');
    expect(reason('shell', ctx())).toBeUndefined();
    expect(reason('shell', ctx({ kind: 'images' }))).toBe('Nur für Container.');
    expect(reason('shell', ctx({ row: container('exited') }))).toBe('Der Container läuft nicht.');
    expect(reason('shell', ctx({ row: null }))).toBe('Keine Zeile ausgewählt.');
  });
  it('words inspect', () => {
    expect(reason('inspect', ctx())).toBeUndefined();
    expect(reason('inspect', ctx({ row: null }))).toBe('Keine Zeile ausgewählt.');
  });
  it('words popout', () => {
    expect(reason('popout', ctx())).toBeUndefined();
    expect(reason('popout', ctx({ canPopout: false }))).toBe('Hier lässt sich kein Tab öffnen.');
    expect(reason('popout', ctx({ dock: 'inspect' }))).toBe('Nur für Logs und Shell.');
    expect(reason('popout', ctx({ dock: 'logs', kind: 'images' }))).toBe('Nur für Container.');
    expect(reason('popout', ctx({ dock: 'logs', row: null }))).toBe('Keine Zeile ausgewählt.');
    expect(reason('popout', ctx({ dock: 'shell', row: container('exited') }))).toBe('Der Container läuft nicht.');
    expect(reason('popout', ctx({ dock: 'shell' }))).toBeUndefined();
  });
  it('feeds actions from actionUnavailable', () => {
    expect(reason('restart', ctx({ row: null }))).toBe('Keine Zeile ausgewählt.');
    expect(reason('stop', ctx({ row: container('exited') }))).toBe('Der Container läuft nicht.');
    expect(reason('remove', ctx())).toBe('Laufende Container zuerst stoppen.');
    expect(reason('remove', ctx({ row: container('exited') }))).toBeUndefined();
  });
  it('has no restriction on the rest', () => {
    const dock: ContainerDockMode = 'logs';
    for (const id of ['down', 'up', 'tab', 'menu', 'help', 'reload', 'filter', 'resetFilter', 'toggleDock'] as const) {
      expect(reason(id, ctx({ dock, row: null }))).toBeUndefined();
    }
  });
});

describe('actionUnavailable', () => {
  it('needs a row', () => {
    expect(actionUnavailable(null, 'start')).toBe('Keine Zeile ausgewählt.');
  });
  it('rejects actions outside INVENTORY_ACTIONS', () => {
    const all: InventoryAction[] = ['start', 'stop', 'restart', 'remove'];
    for (const kind of ['images', 'volumes'] as const) {
      for (const action of all.filter(a => !INVENTORY_ACTIONS[kind].includes(a))) expect(actionUnavailable(row(kind), action)).toBe('Nur für Container.');
    }
    for (const action of all) expect(actionUnavailable(row('networks'), action)).toBe('Netzwerke lassen sich hier nicht ändern.');
  });
  it('checks start, stop, remove against the container state', () => {
    for (const state of ['running', 'paused', 'restarting'] as const) {
      expect(actionUnavailable(container(state), 'start')).toBe('Der Container läuft bereits.');
      expect(actionUnavailable(container(state), 'stop')).toBeUndefined();
      expect(actionUnavailable(container(state), 'remove')).toBe('Laufende Container zuerst stoppen.');
      expect(actionUnavailable(container(state), 'restart')).toBeUndefined();
    }
    for (const state of ['exited', 'created', 'dead', 'stopped', 'unknown'] as const) {
      expect(actionUnavailable(container(state), 'start')).toBeUndefined();
      expect(actionUnavailable(container(state), 'stop')).toBe('Der Container läuft nicht.');
      expect(actionUnavailable(container(state), 'remove')).toBeUndefined();
      expect(actionUnavailable(container(state), 'restart')).toBeUndefined();
    }
  });
  it('blocks removing used images and volumes only when usedBy is known and above 0', () => {
    expect(actionUnavailable(row('images', { usedBy: 1 }), 'remove')).toBe('Das Image wird noch benutzt.');
    expect(actionUnavailable(row('images', { usedBy: 0 }), 'remove')).toBeUndefined();
    expect(actionUnavailable(row('images'), 'remove')).toBeUndefined();
    expect(actionUnavailable(row('volumes', { usedBy: 3 }), 'remove')).toBe('Das Volume wird noch benutzt.');
    expect(actionUnavailable(row('volumes', { usedBy: 0 }), 'remove')).toBeUndefined();
    expect(actionUnavailable(row('volumes'), 'remove')).toBeUndefined();
  });
});
