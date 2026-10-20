import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import { createKnownHosts, registerSshIpcHandlers, requireSshSender } from './ipc';
import type { SshSessionManager } from './session';
import { hostFingerprint } from './known-hosts';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: IpcMainInvokeEvent, request: unknown) => unknown>(),
  trustedWindow: true,
  getSnapshot: vi.fn(),
  showMessageBox: vi.fn(async (_options: unknown) => ({ response: 0 })),
}));
vi.mock('electron', () => ({
  app: { getPath: () => 'synthetic-user-data' },
  BrowserWindow: { fromWebContents: () => mocks.trustedWindow ? {} : null, getFocusedWindow: () => null },
  dialog: { showMessageBox: mocks.showMessageBox },
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
  manager = registerSshIpcHandlers(createKnownHosts());
});
afterEach(() => manager.closeAll());

describe('SSH IPC authorization', () => {
  it('rejects subframes and senders outside the app window', () => {
    expect(() => requireSshSender(sender(1, true))).toThrow(expect.objectContaining({ code: 'ssh.senderNotAllowed' }));
    mocks.trustedWindow = false;
    expect(() => requireSshSender(sender())).toThrow(expect.objectContaining({ code: 'ssh.senderNotAllowed' }));
  });
  it('returns only a session ID, with credentials resolved from the main vault', () => {
    const result = mocks.handlers.get('ssh:prepare')!(sender(), { connectionId: 'saved-id', cols: 80, rows: 24 });
    expect(result).toEqual({ sessionId: expect.any(String) });
    expect(JSON.stringify(result)).not.toContain('synthetic-secret');
    expect(mocks.getSnapshot).toHaveBeenCalled();
  });
  it('rejects injected credentials and ownership violations through the handlers', () => {
    const prepare = mocks.handlers.get('ssh:prepare')!;
    expect(() => prepare(sender(), { connectionId: 'saved-id', cols: 80, rows: 24, password: 'synthetic' })).toThrow(expect.objectContaining({ code: 'ssh.invalidRequest' }));
    const result = prepare(sender(), { connectionId: 'saved-id', cols: 80, rows: 24 }) as { sessionId: string };
    expect(() => mocks.handlers.get('ssh:close')!(sender(2), result)).toThrow(expect.objectContaining({ code: 'ssh.notAvailable' }));
    expect(() => mocks.handlers.get('ssh:resize')!(sender(2), { ...result, cols: 80, rows: 24 })).toThrow(expect.objectContaining({ code: 'ssh.notAvailable' }));
  });
  it('cannot prepare an unsaved connection or use a locked vault', () => {
    const prepare = mocks.handlers.get('ssh:prepare')!;
    expect(() => prepare(sender(), { connectionId: 'unknown', cols: 80, rows: 24 })).toThrow(expect.objectContaining({ code: 'ssh.connectionNotFound' }));
    mocks.getSnapshot.mockImplementationOnce(() => { throw new Error('Vault gesperrt'); });
    expect(() => prepare(sender(), { connectionId: 'saved-id', cols: 80, rows: 24 })).toThrow('Vault gesperrt');
  });
});

describe('host key dialog', () => {
  it('shows catalog texts and the unescaped fingerprint', async () => {
    const key = Buffer.from('synthetic-host-key');
    const trusted = await createKnownHosts().verify('dialog.test', 22, key, () => true);
    expect(trusted).toBe(false);
    const options = mocks.showMessageBox.mock.calls.at(-1)![0] as { title: string; message: string; detail: string; buttons: string[] };
    expect(options.title).toBe('Unbekannter SSH-Server');
    expect(options.message).toBe('Server-Schlüssel für dialog.test:22 prüfen');
    expect(options.detail).toContain(hostFingerprint(key));
    expect(options.buttons).toEqual(['Abbrechen', 'Schlüssel vertrauen und speichern']);
  });
});
