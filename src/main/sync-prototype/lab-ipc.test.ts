import { beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({
  app: { isPackaged: true, getAppPath: vi.fn(() => '/nonexistent-sync-lab-checkout') },
  handle: vi.fn(), guard: vi.fn(),
}));
vi.mock('electron', () => ({ app: mock.app, ipcMain: { handle: mock.handle } }));
vi.mock('../windows', () => ({ windowRegistry: { requireMain: mock.guard } }));
import { registerSyncLabIpc, vaultPasswordMatcher } from './lab-ipc';
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
  expect((await registerSyncLabIpc()).enabled).toBe(false); expect(mock.app.getAppPath).toHaveBeenCalledOnce();
});
it('maps a locked vault to undefined and propagates other failures', async () => {
  expect(vaultPasswordMatcher(undefined)).toBeUndefined();
  const locked = vaultPasswordMatcher({ matchesPassword: async () => { throw new AppError('core.vaultLocked'); } });
  expect(await locked!('x')).toBeUndefined();
  expect(await vaultPasswordMatcher({ matchesPassword: async () => true })!('x')).toBe(true);
  await expect(vaultPasswordMatcher({ matchesPassword: async () => { throw Error('boom'); } })!('x')).rejects.toThrow('boom');
});
