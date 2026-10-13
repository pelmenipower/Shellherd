import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import { registerSshIpcHandlers, requireSshSender } from './ipc';
import type { SshSessionManager } from './session';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: IpcMainInvokeEvent, request: unknown) => unknown>(),
  trustedWindow: true,
  getSnapshot: vi.fn(),
}));
vi.mock('electron', () => ({
  app: { getPath: () => 'synthetic-user-data' },
  BrowserWindow: { fromWebContents: () => mocks.trustedWindow ? {} : null, getFocusedWindow: () => null },
  dialog: { showMessageBox: vi.fn() },
  ipcMain: { handle: (channel: string, handler: (event: IpcMainInvokeEvent, request: unknown) => unknown) => mocks.handlers.set(channel, handler) },
  webContents: { fromId: () => undefined },
}));
vi.mock('../vault/ipc', () => ({ vaultSessionManager: { getSnapshot: mocks.getSnapshot } }));

function sender(id = 1, subframe = false): IpcMainInvokeEvent {
  const frame = {};
  return { sender: { id, isDestroyed: () => false, mainFrame: frame }, senderFrame: subframe ? {} : frame } as unknown as IpcMainInvokeEvent;
}
let manager: SshSessionManager;
beforeEach(() => {
  mocks.handlers.clear(); mocks.trustedWindow = true;
  mocks.getSnapshot.mockReturnValue({ vault: { nodes: [{ id: 'saved-id', type: 'connection', protocol: 'ssh', name: 'Synthetic',
    host: 'example.test', port: 22, username: 'synthetic-user', authentication: { method: 'password', password: 'synthetic-secret' }, tags: [] }] } });
  manager = registerSshIpcHandlers();
});
afterEach(() => manager.closeAll());

describe('SSH IPC authorization', () => {
  it('rejects subframes and senders outside the app window', () => {
    expect(() => requireSshSender(sender(1, true))).toThrow('nicht erlaubt');
    mocks.trustedWindow = false;
    expect(() => requireSshSender(sender())).toThrow('nicht erlaubt');
  });
  it('returns only a session ID, with credentials resolved from the main vault', () => {
    const result = mocks.handlers.get('ssh:prepare')!(sender(), { connectionId: 'saved-id', cols: 80, rows: 24 });
    expect(result).toEqual({ sessionId: expect.any(String) });
    expect(JSON.stringify(result)).not.toContain('synthetic-secret');
    expect(mocks.getSnapshot).toHaveBeenCalled();
  });
  it('rejects injected credentials and ownership violations through the handlers', () => {
    const prepare = mocks.handlers.get('ssh:prepare')!;
    expect(() => prepare(sender(), { connectionId: 'saved-id', cols: 80, rows: 24, password: 'synthetic' })).toThrow('Ungültige');
    const result = prepare(sender(), { connectionId: 'saved-id', cols: 80, rows: 24 }) as { sessionId: string };
    expect(() => mocks.handlers.get('ssh:close')!(sender(2), result)).toThrow('verfügbar');
    expect(() => mocks.handlers.get('ssh:resize')!(sender(2), { ...result, cols: 80, rows: 24 })).toThrow('verfügbar');
  });
  it('cannot prepare an unsaved connection or use a locked vault', () => {
    const prepare = mocks.handlers.get('ssh:prepare')!;
    expect(() => prepare(sender(), { connectionId: 'unknown', cols: 80, rows: 24 })).toThrow('nicht gefunden');
    mocks.getSnapshot.mockImplementationOnce(() => { throw new Error('Vault gesperrt'); });
    expect(() => prepare(sender(), { connectionId: 'saved-id', cols: 80, rows: 24 })).toThrow('Vault gesperrt');
  });
});
