import { describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
import type { IPty } from 'node-pty';
import { SshSessionManager } from './session';
import type { ConnectionNode } from '../../shared/vault/types';
import type { SshEvent } from '../../shared/ssh';

const shell: ConnectionNode = { id: 'ps', type: 'connection', protocol: process.platform === 'win32' ? 'powershell' : 'bash', name: 'PS', tags: [], workingDirectory: tmpdir() };

function setup() {
  const events: { owner: number; event: SshEvent }[] = [];
  let data: ((text: string) => void) | undefined;
  const pty = { write: vi.fn(), resize: vi.fn(), kill: vi.fn(), pause: vi.fn(), resume: vi.fn(),
    onData: (listener: (text: string) => void) => { data = listener; return { dispose() {} }; },
    onExit: () => ({ dispose() {} }) };
  const manager = new SshSessionManager({ getConnection: () => shell, spawnShell: () => pty as unknown as IPty,
    verifyHost: async () => true, emit: (owner, event) => events.push({ owner, event }) });
  return { events, pty, manager, emit: (text: string) => data?.(text) };
}

describe('session transfer between windows', () => {
  it('holds output during the handover and delivers it to the new window on attach', async () => {
    const { events, pty, manager, emit } = setup();
    const { sessionId } = manager.prepare(1, { connectionId: 'ps', cols: 80, rows: 24 });
    await manager.connect(1, sessionId);
    emit('before');
    expect(manager.transferOwner(1, sessionId, 2)).toBe('connected');
    expect(pty.pause).toHaveBeenCalled();
    emit('in flight');
    expect(events.filter(item => item.owner === 2)).toEqual([]);
    manager.attach(2, sessionId);
    const delivered = events.filter(item => item.owner === 2 && item.event.type === 'data');
    expect(delivered).toHaveLength(1);
    expect(Buffer.from((delivered[0].event as { data: Uint8Array }).data).toString()).toBe('in flight');
    expect(pty.resume).toHaveBeenCalled();
    emit('after');
    expect(events.at(-1)?.owner).toBe(2);
  });

  it('rejects the old window after the transfer and ignores its acknowledgments', async () => {
    const { manager, emit } = setup();
    const { sessionId } = manager.prepare(1, { connectionId: 'ps', cols: 80, rows: 24 });
    await manager.connect(1, sessionId);
    emit('pending');
    manager.transferOwner(1, sessionId, 2);
    expect(() => manager.close(1, sessionId)).toThrow();
    expect(() => manager.acknowledge(1, sessionId, 1)).toThrow();
    expect(() => manager.attach(1, sessionId)).toThrow();
    expect(manager.hasOwner(1)).toBe(false);
    expect(manager.hasOwner(2)).toBe(true);
    await expect(manager.input(2, sessionId, 'x')).resolves.toBeUndefined();
  });
});
