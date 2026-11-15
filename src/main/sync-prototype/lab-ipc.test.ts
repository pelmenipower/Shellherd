import { beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({
  app: { isPackaged: true, getAppPath: vi.fn(() => '/nonexistent-sync-lab-checkout') },
  handle: vi.fn(), guard: vi.fn(),
}));
vi.mock('electron', () => ({ app: mock.app, ipcMain: { handle: mock.handle } }));
vi.mock('../windows', () => ({ windowRegistry: { requireMain: mock.guard } }));
const sync = vi.hoisted(() => ({ synchronizeVault: vi.fn(), importSyncedVault: vi.fn(), removeForeignObjects: vi.fn(), regenerateRecoveryCode: vi.fn() }));
vi.mock('./vault-sync', () => sync);
import { buildSyncLabHost, registerSyncLabIpc, vaultPasswordMatcher } from './lab-ipc';
import { AppError } from '../../shared/errors';
beforeEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); mock.app.isPackaged = true; });
it('never loads the prototype backend in a packaged app, even with the environment flag', async () => {
  vi.stubEnv('SHELLHERD_SYNC_LAB', '1');
  const host = await registerSyncLabIpc(); expect(host.enabled).toBe(false); expect(mock.app.getAppPath).not.toHaveBeenCalled();
  const handler = mock.handle.mock.calls[0][1]; const event = { sender: { id: 1 } };
  expect(handler(event, { kind: 'start', clientId: '123e4567-e89b-42d3-a456-426614174000' })).toEqual({ ok: false, code: 'unavailable' });
  expect(mock.guard).toHaveBeenCalledWith(event);
  mock.guard.mockImplementationOnce(() => { throw Error('Main frame required'); });
  expect(() => handler(event, {})).toThrow('Main frame required');
});
it('stays unavailable without opt-in and fails closed if the development backend cannot load', async () => {
  mock.app.isPackaged = false; vi.stubEnv('SHELLHERD_SYNC_LAB', '0');
  expect((await registerSyncLabIpc()).enabled).toBe(false); expect(mock.app.getAppPath).not.toHaveBeenCalled();
  vi.stubEnv('SHELLHERD_SYNC_LAB', '1');
  expect((await registerSyncLabIpc()).enabled).toBe(false); expect(mock.app.getAppPath).not.toHaveBeenCalled();
});
it('maps a locked vault to undefined and propagates other failures', async () => {
  expect(vaultPasswordMatcher(undefined)).toBeUndefined();
  const locked = vaultPasswordMatcher({ matchesPassword: async () => { throw new AppError('core.vaultLocked'); } });
  expect(await locked!('x')).toBeUndefined();
  expect(await vaultPasswordMatcher({ matchesPassword: async () => true })!('x')).toBe(true);
  await expect(vaultPasswordMatcher({ matchesPassword: async () => { throw Error('boom'); } })!('x')).rejects.toThrow('boom');
});
it('passes remove through to the vault remote and calls removeForeignObjects with the ids', async () => {
  const remove = vi.fn(async () => true);
  const driver = { list: async () => ['a'], get: async () => 'w', put: async () => 'id', remove };
  const info = { id: 'srv' } as never; const signal = new AbortController().signal; const sessions = {} as never;
  sync.removeForeignObjects.mockResolvedValue(2); sync.synchronizeVault.mockResolvedValue({ ok: 1 });
  const host = buildSyncLabHost({ probeSyncServer: vi.fn() }, { AccountStore: vi.fn() as never }, { sessions }) as unknown as { syncVault: (...a: unknown[]) => Promise<unknown> };
  expect(await host.syncVault(driver, info, signal, { kind: 'removeForeign', ids: ['x', 'y'] })).toEqual({ removedForeign: 2 });
  const [s, remote, i, ids, sg] = sync.removeForeignObjects.mock.calls[0];
  expect([s, i, ids, sg]).toEqual([sessions, info, ['x', 'y'], signal]);
  await remote.remove('x'); expect(remove).toHaveBeenCalledWith('x');
  await host.syncVault({ list: driver.list, get: driver.get, put: driver.put }, info, signal, { kind: 'synchronize' }, undefined);
  expect(sync.synchronizeVault.mock.calls[0][1].remove).toBeUndefined();
});
it('adds the device to the sync context and routes regenerate and import to the core', async () => {
  const driver = { list: async () => [], get: async () => 'w', put: async () => 'id', remove: async () => true };
  const info = { serverId: 's', namespace: 'n' } as never; const signal = new AbortController().signal; const sessions = {} as never;
  const device = { id: 'd' } as never;
  sync.regenerateRecoveryCode.mockResolvedValue({ recoveryCode: 'c' }); sync.synchronizeVault.mockResolvedValue({}); sync.importSyncedVault.mockResolvedValue({});
  const host = buildSyncLabHost({ probeSyncServer: vi.fn() }, { AccountStore: vi.fn() as never }, { sessions }) as unknown as { syncVault: (...a: unknown[]) => Promise<unknown> };
  expect(await host.syncVault(driver, info, signal, { kind: 'regenerateCode' }, device)).toEqual({ recoveryCode: 'c' });
  expect(sync.regenerateRecoveryCode.mock.calls[0][2]).toEqual({ serverId: 's', namespace: 'n', device });
  await host.syncVault(driver, info, signal, { kind: 'synchronize', recoveryCode: 'abc' }, device);
  expect(sync.synchronizeVault.mock.calls[0][2]).toEqual({ serverId: 's', namespace: 'n', device });
  expect(sync.synchronizeVault.mock.calls[0][4]).toEqual({ keepLocalRevision: undefined, recoveryCode: 'abc' });
  await host.syncVault(driver, info, signal, { kind: 'importVault', password: 'p', recoveryCode: 'rc' }, device);
  expect(sync.importSyncedVault.mock.calls[0].slice(2, 5)).toEqual([{ serverId: 's', namespace: 'n', device }, 'rc', 'p']);
});
it('dispatches the device-key requests to the host', async () => {
  const host = await registerSyncLabIpc(); const handler = mock.handle.mock.calls[0][1]; const event = { sender: { id: 1 } };
  const clientId = '123e4567-e89b-42d3-a456-426614174000';
  for (const kind of ['openSession', 'listDevices', 'revokeDevice', 'regenerateCode', 'signIn'])
    expect(await handler(event, { kind, clientId })).toMatchObject({ ok: false });
  expect(host.enabled).toBe(false);
});
it('forwards allowPrivateHttp to the server probe', async () => {
  const probeSyncServer = vi.fn(async () => ({ serverUrl: 'u', serverId: 's', namespace: 'n' }));
  const host = buildSyncLabHost({ probeSyncServer }, { AccountStore: vi.fn() as never }, {}) as unknown as { probe: (u: string, p: boolean, s: AbortSignal) => Promise<unknown> };
  const signal = new AbortController().signal;
  await host.probe('http://10.0.0.5', true, signal);
  expect(probeSyncServer).toHaveBeenCalledWith('http://10.0.0.5', { allowLoopbackHttp: true, allowPrivateHttp: true, signal });
});
