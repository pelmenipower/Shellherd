import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), on: vi.fn() } }));
vi.mock('./ssh/ipc', () => ({ requireSshSender: vi.fn() }));
vi.mock('./vault/ipc', () => ({ vaultSessionManager: {} }));
vi.mock('./drag-ghost', () => ({ DragGhost: class {}, tearOffBounds: vi.fn() }));
vi.mock('./windows', () => ({ visibleBounds: vi.fn() }));

import { moveSession, type TransferTab } from './window-ipc';

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
    const gone = owner(() => { throw new Error('ssh.notAvailable'); });
    const owners = { ssh: gone, rdp: gone, sftp: gone };
    const tab: TransferTab = { connection, status: 'connected', session, snapshot: 'abc' };
    expect(moveSession(owners as never, 1, tab, target)).toEqual({ connection, status: 'closed', snapshot: 'abc' });
  });
});
