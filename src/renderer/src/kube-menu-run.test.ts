import { describe, expect, it, vi } from 'vitest';
import type { KubeRow } from '../../shared/kubernetes';
import { rowMenuTarget, runMenuAction, type MenuRunner } from './kube-menu-run';
import type { MenuAction } from './kube-menus';

const runner = () => ({
  dispatch: vi.fn(), setPrevious: vi.fn(), arm: vi.fn(), copy: vi.fn(), confirm: vi.fn(), popout: vi.fn(), ssh: vi.fn(), reloadDock: vi.fn(), help: vi.fn(),
}) satisfies MenuRunner;

const ref = { kind: 'deployments' as const, namespace: 'shop', name: 'api' };

describe('runMenuAction', () => {
  it('dispatches every view action in order', () => {
    const r = runner();
    runMenuAction({ type: 'view', actions: [{ type: 'select', key: 'k' }, { type: 'dock', mode: 'events' }] }, r);
    expect(r.dispatch.mock.calls).toEqual([[{ type: 'select', key: 'k' }], [{ type: 'dock', mode: 'events' }]]);
    expect(r.setPrevious).not.toHaveBeenCalled();
    expect(r.arm).not.toHaveBeenCalled();
  });

  it('sets previous before dispatching and arms the shell', () => {
    const r = runner();
    runMenuAction({ type: 'view', actions: [{ type: 'dock', mode: 'logs' }], previous: true }, r);
    expect(r.setPrevious).toHaveBeenCalledWith(true);
    runMenuAction({ type: 'view', actions: [{ type: 'dock', mode: 'shell' }], armShell: true }, r);
    expect(r.arm).toHaveBeenCalledTimes(1);
  });

  it('routes the other actions to exactly one runner method', () => {
    const cases: [MenuAction, keyof MenuRunner, unknown[]][] = [
      [{ type: 'copy', text: 'x', label: 'L' }, 'copy', ['x', 'L']],
      [{ type: 'kubeAction', ref, action: 'scale', currentReplicas: 3 }, 'confirm', [ref, 'scale', 3]],
      [{ type: 'kubeAction', ref, action: 'delete' }, 'confirm', [ref, 'delete', undefined]],
      [{ type: 'popout', target: { namespace: 'a', pod: 'p', container: 'c', mode: 'logs' } }, 'popout', [{ namespace: 'a', pod: 'p', container: 'c', mode: 'logs' }]],
      [{ type: 'ssh', connectionId: 'id' }, 'ssh', ['id']],
      [{ type: 'dockReload' }, 'reloadDock', []],
      [{ type: 'help' }, 'help', []],
    ];
    for (const [action, method, args] of cases) {
      const r = runner();
      runMenuAction(action, r);
      expect(r[method]).toHaveBeenCalledWith(...args);
      const total = Object.values(r).reduce((sum, fn) => sum + fn.mock.calls.length, 0);
      expect(total).toBe(1);
    }
  });
});

describe('rowMenuTarget', () => {
  it('wraps the clicked row', () => {
    const row = { uid: 'u', ref, cells: {}, tone: 'ok', labels: {} } as KubeRow;
    expect(rowMenuTarget(row)).toEqual({ type: 'row', row });
  });
});
