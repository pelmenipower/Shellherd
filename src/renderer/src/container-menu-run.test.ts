import { describe, expect, it } from 'vitest';
import type { InventoryRow } from '../../shared/containers';
import { rowMenuTarget, runMenuAction, type ContainerMenuRunner } from './container-menu-run';
import type { ContainerMenuAction } from './container-menus';

const row: InventoryRow = { uid: 'docker:containers:web', ref: { kind: 'containers', runtime: 'docker', ref: 'web' }, id: 'web', name: 'web', cells: {}, tone: 'ok', labels: {} };
const target = { item: { kind: 'container', runtime: 'docker', ref: 'web', name: 'web' }, mode: 'logs' } as const;

function recorder(): { runner: ContainerMenuRunner; calls: [string, ...unknown[]][] } {
  const calls: [string, ...unknown[]][] = [];
  const runner: ContainerMenuRunner = {
    dispatch: a => calls.push(['dispatch', a]), copy: (t, l) => calls.push(['copy', t, l]), confirm: (r, a) => calls.push(['confirm', r, a]),
    popout: t => calls.push(['popout', t]), reload: () => calls.push(['reload']), reloadDock: () => calls.push(['reloadDock']), help: () => calls.push(['help']),
  };
  return { runner, calls };
}

describe('runMenuAction', () => {
  const cases: [ContainerMenuAction, [string, ...unknown[]][]][] = [
    [{ type: 'copy', text: 't', label: 'Name' }, [['copy', 't', 'Name']]],
    [{ type: 'containerAction', row, action: 'stop' }, [['confirm', row, 'stop']]],
    [{ type: 'popout', target }, [['popout', target]]],
    [{ type: 'reload' }, [['reload']]],
    [{ type: 'dockReload' }, [['reloadDock']]],
    [{ type: 'help' }, [['help']]],
  ];
  it.each(cases)('calls exactly one runner method for %j', (action, expected) => {
    const { runner, calls } = recorder();
    runMenuAction(action, runner);
    expect(calls).toEqual(expected);
  });
  it('dispatches every step of a view in order', () => {
    const { runner, calls } = recorder();
    runMenuAction({ type: 'view', actions: [{ type: 'select', uid: 'u' }, { type: 'dock', mode: 'shell' }, { type: 'arm' }] }, runner);
    expect(calls).toEqual([['dispatch', { type: 'select', uid: 'u' }], ['dispatch', { type: 'dock', mode: 'shell' }], ['dispatch', { type: 'arm' }]]);
  });
  it('never confirms for a view', () => {
    const { runner, calls } = recorder();
    runMenuAction({ type: 'view', actions: [] }, runner);
    expect(calls).toEqual([]);
  });
});

describe('rowMenuTarget', () => {
  it('is the clicked row', () => {
    expect(rowMenuTarget(row)).toEqual({ type: 'row', row });
  });
});
