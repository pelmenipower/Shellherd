import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), on: vi.fn() } }));
vi.mock('./ssh/ipc', () => ({ requireSshSender: vi.fn() }));
vi.mock('./vault/ipc', () => ({ vaultSessionManager: { getSnapshot: vi.fn() } }));
vi.mock('./drag-ghost', () => ({ DragGhost: class {}, tearOffBounds: vi.fn() }));
vi.mock('./windows', () => ({ visibleBounds: vi.fn() }));

import { TabConnectionSchema, catalog, moveSession, type TransferTab } from './window-ipc';
import { vaultSessionManager } from './vault/ipc';
import { DEFAULT_TERMINAL_SETTINGS } from '../shared/vault/terminal-settings';

const target = { webContents: { id: 2 } } as BrowserWindow;
const connection: TransferTab['connection'] = { id: 'c1', name: 'srv', protocol: 'ssh', address: 'host' };
const session = { kind: 'terminal' as const, sessionId: '3f2b8a52-1c3e-4d5e-9f10-0a1b2c3d4e5f' };
const owner = (transferOwner: () => TransferTab['status']) => ({ transferOwner, owns: () => true });

describe('moveSession', () => {
  it('returns the session with the new status', () => {
    const owners = { ssh: owner(() => 'connected'), rdp: owner(() => 'closed'), sftp: owner(() => 'closed') };
    const tab: TransferTab = { connection, status: 'connecting', session, snapshot: 'abc' };
    expect(moveSession(owners as never, 1, tab, target)).toEqual({ connection, status: 'connected', session, snapshot: 'abc' });
  });

  it('turns a vanished session into a closed tab and keeps the snapshot', () => {
    const gone = { transferOwner: () => 'connected', owns: () => false };
    const owners = { ssh: gone, rdp: gone, sftp: gone };
    const tab: TransferTab = { connection, status: 'connected', session, snapshot: 'abc' };
    expect(moveSession(owners as never, 1, tab, target)).toEqual({ connection, status: 'closed', snapshot: 'abc' });
  });

  it('does not swallow errors from the transfer itself', () => {
    const broken = owner(() => { throw new Error('boom'); });
    const owners = { ssh: broken, rdp: broken, sftp: broken };
    expect(() => moveSession(owners as never, 1, { connection, status: 'connected', session }, target)).toThrow('boom');
  });
});

describe('catalog', () => {
  const withSettings = (settings: Record<string, unknown>) =>
    vi.mocked(vaultSessionManager.getSnapshot).mockReturnValue({ vault: { nodes: [], settings } } as never);

  it('sends the default terminal settings for a vault without them', () => {
    withSettings({ confirmBeforeClosingSession: true });
    expect(catalog().terminal).toEqual(DEFAULT_TERMINAL_SETTINGS);
  });

  it('sends the vault terminal settings over the defaults', () => {
    withSettings({ confirmBeforeClosingSession: true, terminal: { ...DEFAULT_TERMINAL_SETTINGS, fontSize: 18, cursorStyle: 'bar' } });
    expect(catalog().terminal).toEqual({ ...DEFAULT_TERMINAL_SETTINGS, fontSize: 18, cursorStyle: 'bar' });
  });
});

describe('TabConnectionSchema', () => {
  it('rejects the welcome page, which never travels between windows', () => {
    expect(TabConnectionSchema.safeParse({ id: 'welcome', name: 'x', protocol: 'cmd', address: '', view: 'welcome' }).success).toBe(false);
    expect(TabConnectionSchema.safeParse({ id: 'c1', name: 'x', protocol: 'cmd', address: '', view: 'files' }).success).toBe(true);
  });
});
