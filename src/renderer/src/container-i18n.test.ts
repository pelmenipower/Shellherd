import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LOCAL_CONTAINER_HOST, type InventoryRow } from '../../shared/containers';
import { COLUMNS, FILTER_HELP, columnLabel, groupOptionsFor } from './container-columns';
import { CONTAINER_COMMANDS, actionUnavailable } from './container-commands';
import { confirmationFor, hostLabel } from './container-confirm';
import { menuFor } from './container-menus';
import { CHIPS } from './container-status';
import { containerViewReducer, initialContainerViewState, loadedLabel } from './container-view';
import { itemCommands } from './container-tree';
import { i18n } from './i18n';

const row = (kind: 'containers' | 'images', name: string, extra: Partial<InventoryRow> = {}): InventoryRow => ({
  uid: `docker:${kind}:${name}`, ref: { kind, runtime: 'docker', ref: name }, id: name, name, cells: { name }, tone: 'ok', labels: {}, ...extra,
});

describe('container texts follow the language', () => {
  beforeEach(async () => { await i18n.changeLanguage('en-US'); });
  afterEach(async () => { await i18n.changeLanguage('de-DE'); });

  it('reads column, chip and help labels when they are used', () => {
    expect(COLUMNS.containers[5]?.label).toBe('Project');
    expect(columnLabel('size')).toBe('Size');
    expect(columnLabel('unknown')).toBe('unknown');
    expect(CHIPS.containers.map(chip => chip.label)).toEqual(['Needs attention', 'Running', 'Stopped', 'Paused', 'Compose']);
    expect(groupOptionsFor('containers', 'docker').map(option => option.label)).toEqual(['Project', 'Status', 'Image']);
    expect(FILTER_HELP[1]).toMatchObject({ form: 'Selection', description: 'exactly this value, with count', example: 'running' });
  });

  it('words commands and reasons', () => {
    expect(CONTAINER_COMMANDS.find(command => command.id === 'down')?.description).toBe('Row down');
    expect(CONTAINER_COMMANDS.find(command => command.id === 'attention')?.unavailable?.({ kind: 'images', row: null, dock: 'logs', canPopout: true }))
      .toBe('This tab has no “Needs attention” chip.');
    expect(actionUnavailable(null, 'stop')).toBe('No row selected.');
    expect(actionUnavailable(row('containers', 'web', { state: 'exited' }), 'stop')).toBe('The container is not running.');
  });

  it('words confirmations', () => {
    expect(hostLabel(LOCAL_CONTAINER_HOST, 'x')).toBe('this computer');
    expect(confirmationFor(row('containers', 'web'), 'remove', 'srv')).toEqual({
      title: 'Remove container?',
      body: 'Container “web” on srv will be removed. Anonymous volumes are kept and show up under Volumes.',
      requireTyping: 'web', confirmLabel: 'Remove',
    });
  });

  it('words menus, the load label and the proxmox commands', () => {
    const state = initialContainerViewState(0);
    const entries = menuFor({ type: 'background' }, { state, canPopout: true });
    expect(entries.find(entry => entry.kind === 'item' && entry.id === 'filter-reset')).toMatchObject({ label: 'Reset all filters' });
    expect(loadedLabel(0, 30_000)).toBe('loaded 30 s ago');
    expect(loadedLabel(0, 130_000)).toBe('loaded 2 min ago');
    expect(itemCommands({ kind: 'vm', vmid: 100, name: 'db', state: 'running' }).map(command => command.label)).toEqual(['Serial console', 'Shut down', 'Stop']);
  });

  it('words the pinned-runtime error of the reducer', () => {
    const state = initialContainerViewState(0, 'podman');
    const inventory = { runtime: 'docker' as const, runtimes: ['docker' as const], rows: { containers: [], images: [], volumes: [], networks: [] }, problems: {}, at: 0, sudo: false };
    expect(containerViewReducer(state, { type: 'setInventory', inventory }).error).toBe('Podman was not found on this host.');
  });
});
