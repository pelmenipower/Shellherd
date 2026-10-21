import { describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
import type { IPty } from 'node-pty';
import { localShellCommand, shellEnvironment, SshSessionManager } from './session';
import type { SpawnShell } from './session';
import type { ConnectionNode } from '../../shared/vault/types';
import type { SshEvent } from '../../shared/ssh';

function fakePty() {
  let data: ((text: string) => void) | undefined;
  let exit: (() => void) | undefined;
  const pty = {
    write: vi.fn(), resize: vi.fn(), kill: vi.fn(), pause: vi.fn(), resume: vi.fn(),
    onData: (listener: (text: string) => void) => { data = listener; return { dispose() {} }; },
    onExit: (listener: () => void) => { exit = listener; return { dispose() {} }; },
  };
  return { pty: pty as unknown as IPty, mock: pty, emit: (text: string) => data?.(text), exit: () => exit?.() };
}

function setup(connection: ConnectionNode) {
  const events: SshEvent[] = [];
  const shell = fakePty();
  const spawnShell = vi.fn<SpawnShell>(() => shell.pty);
  const manager = new SshSessionManager({ getConnection: () => connection, spawnShell,
    verifyHost: async () => true, emit: (_owner, event) => events.push(event) });
  return { events, shell, spawnShell, manager };
}

const powershell: ConnectionNode = { id: 'ps', type: 'connection', protocol: 'powershell', name: 'PS', tags: [], workingDirectory: tmpdir() };

describe('local shell sessions', () => {
  it.runIf(process.platform === 'win32')('never reads the idle timeout and is not closed for idleness', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const getTimeouts = vi.fn(() => ({ idleMinutes: 1, keepaliveSeconds: 15, keepaliveCount: 3, connectSeconds: 120 }));
      const events: SshEvent[] = [];
      const shell = fakePty();
      const manager = new SshSessionManager({ getConnection: () => powershell, spawnShell: () => shell.pty, getTimeouts,
        verifyHost: async () => true, emit: (_owner, event) => events.push(event) });
      const { sessionId } = manager.prepare(1, { connectionId: 'ps', cols: 80, rows: 24 });
      await manager.connect(1, sessionId);
      const timers = vi.getTimerCount();
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(events.some(event => event.type === 'status' && event.status === 'closed')).toBe(false);
      expect(getTimeouts).not.toHaveBeenCalled();
      expect(timers).toBe(0);
      manager.close(1, sessionId);
    } finally { vi.useRealTimers(); }
  });

  it('uses fixed system paths instead of PATH lookups', () => {
    expect(localShellCommand('powershell', 'C:\\Windows')).toEqual({ file: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', args: ['-NoLogo'] });
    expect(localShellCommand('cmd', 'C:\\Windows')).toEqual({ file: 'C:\\Windows\\System32\\cmd.exe', args: [] });
  });

  it('removes Electron variables from the shell environment', () => {
    expect(shellEnvironment({ PATH: 'p', ELECTRON_RUN_AS_NODE: '1', electron_x: 'y', EMPTY: undefined })).toEqual({ PATH: 'p' });
  });

  it.runIf(process.platform === 'win32')('starts, streams, resizes and closes a PowerShell session', async () => {
    const { events, shell, spawnShell, manager } = setup(powershell);
    const { sessionId } = manager.prepare(1, { connectionId: 'ps', cols: 80, rows: 24 });
    await manager.connect(1, sessionId);
    expect(spawnShell).toHaveBeenCalledWith(expect.stringMatching(/powershell\.exe$/i), ['-NoLogo'],
      expect.objectContaining({ cwd: tmpdir(), cols: 80, rows: 24, useConpty: true }));
    expect(events).toContainEqual({ type: 'status', sessionId, status: 'connected' });
    shell.emit('PS> ');
    expect(events.find(event => event.type === 'data')).toMatchObject({ sessionId, sequence: 1 });
    await manager.input(1, sessionId, 'dir\r');
    expect(shell.mock.write).toHaveBeenCalledWith('dir\r');
    manager.resize(1, sessionId, { cols: 100, rows: 30 });
    expect(shell.mock.resize).toHaveBeenCalledWith(100, 30);
    manager.close(1, sessionId);
    expect(shell.mock.kill).toHaveBeenCalled();
    expect(manager.hasOwner(1)).toBe(false);
  });

  it.runIf(process.platform === 'win32')('reports a closed tab when the shell exits', async () => {
    const { events, shell, manager } = setup(powershell);
    const { sessionId } = manager.prepare(1, { connectionId: 'ps', cols: 80, rows: 24 });
    await manager.connect(1, sessionId);
    shell.exit();
    expect(events.at(-1)).toEqual({ type: 'status', sessionId, status: 'closed' });
  });

  it.runIf(process.platform === 'win32')('reports a missing start folder clearly', async () => {
    const { events, spawnShell, manager } = setup({ ...powershell, workingDirectory: 'C:\\does-not-exist-terminus' });
    const { sessionId } = manager.prepare(1, { connectionId: 'ps', cols: 80, rows: 24 });
    await manager.connect(1, sessionId);
    expect(spawnShell).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({ status: 'error', error: { code: 'ssh.startFolderMissing', params: { folder: 'C:\\does-not-exist-terminus' } } });
  });

  it.runIf(process.platform === 'win32')('starts an installed AI CLI in cmd /k and explains a missing one', async () => {
    const cli: ConnectionNode = { id: 'ai', type: 'connection', protocol: 'aicli', name: 'Claude', tool: 'claude', workingDirectory: tmpdir(), tags: [] };
    const events: SshEvent[] = [];
    const shell = fakePty();
    const spawnShell = vi.fn<SpawnShell>(() => shell.pty);
    let installed = true;
    const manager = new SshSessionManager({ getConnection: () => cli, spawnShell, locate: async () => installed ? 'C:\\tools\\claude.cmd' : null,
      verifyHost: async () => true, emit: (_owner, event) => events.push(event) });
    const first = manager.prepare(1, { connectionId: 'ai', cols: 80, rows: 24 });
    await manager.connect(1, first.sessionId);
    expect(spawnShell).toHaveBeenCalledWith(expect.stringMatching(/cmd\.exe$/i), '/d /k claude', expect.objectContaining({ cwd: tmpdir() }));
    installed = false;
    const second = manager.prepare(1, { connectionId: 'ai', cols: 80, rows: 24 });
    await manager.connect(1, second.sessionId);
    expect(events.at(-1)).toMatchObject({ sessionId: second.sessionId, status: 'error', error: { code: 'ssh.aiToolNotInstalled', params: expect.objectContaining({ install: expect.stringContaining('npm install -g @anthropic-ai/claude-code') }) } });
    expect(spawnShell).toHaveBeenCalledTimes(1);
    manager.closeAll();
  });

  it('refuses RDP connections as terminal sessions', () => {
    const { manager } = setup({ id: 'r', type: 'connection', protocol: 'rdp', name: 'R', host: 'h', port: 3389, rdp: { clipboard: true }, tags: [] });
    expect(() => manager.prepare(1, { connectionId: 'r', cols: 80, rows: 24 })).toThrow(expect.objectContaining({ code: 'ssh.notTerminal' }));
  });
});
