import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { Client } from 'ssh2';
import type { ConnectionNode } from '../../shared/vault/types';
import type { SftpEvent } from '../../shared/sftp';
import { AppError, type CodedError } from '../../shared/errors';
import { FileError, localFileSystem } from './file-system';
import { SftpSessionManager } from './sftp-session';
import { MAX_SFTP_SESSIONS } from '../../shared/sftp';
import { permissionText, remoteEntry } from './sftp-file-system';

const nodes: Record<string, ConnectionNode> = {
  files: { id: 'files', type: 'connection', protocol: 'sftp', name: 'Files', host: 'example.test', port: 22, username: 'synthetic-user',
    authentication: { method: 'password', password: 'synthetic-secret' }, tags: [] },
  desktop: { id: 'desktop', type: 'connection', protocol: 'rdp', name: 'Desktop', host: 'example.test', port: 3389, rdp: { clipboard: true }, tags: [] },
};

function setup() {
  const events: { ownerId: number; event: SftpEvent }[] = [];
  const clients: (EventEmitter & { connect: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> })[] = [];
  const manager = new SftpSessionManager({
    getConnection: id => { const node = nodes[id]; if (!node) throw new FileError('files.connectionNotFound'); return node; },
    verifyHost: async () => true,
    emit: (ownerId, event) => events.push({ ownerId, event }),
    local: localFileSystem,
    openFile: async () => {},
    createClient: () => {
      const client = Object.assign(new EventEmitter(), { connect: vi.fn(), destroy: vi.fn() });
      clients.push(client);
      return client as unknown as Client;
    },
  });
  return { manager, events, clients };
}

describe('SFTP sessions', () => {
  it('opens only file-capable connections and never returns credentials', async () => {
    const { manager, clients } = setup();
    const result = manager.open(1, 'files');
    expect(JSON.stringify(result)).not.toContain('synthetic-secret');
    await vi.waitFor(() => expect(clients[0].connect).toHaveBeenCalledWith(expect.objectContaining({ host: 'example.test', password: 'synthetic-secret' })));
    expect(() => manager.open(1, 'desktop')).toThrow(expect.objectContaining({ code: 'files.noTransferSupport' }));
    manager.closeAll();
  });

  it('belongs to one window at a time and follows a tab into another window', () => {
    const { manager, events } = setup();
    const { sessionId } = manager.open(1, 'files');
    expect(() => manager.state(2, sessionId)).toThrow(expect.objectContaining({ code: 'files.sessionUnavailable' }));
    expect(manager.transferOwner(1, sessionId, 2)).toBe('connecting');
    expect(manager.owns(2, sessionId)).toBe(true);
    expect(() => manager.close(1, sessionId)).toThrow(expect.objectContaining({ code: 'files.sessionUnavailable' }));
    manager.close(2, sessionId);
    expect(events.at(-1)).toEqual({ ownerId: 2, event: { type: 'status', sessionId, status: 'closed' } });
  });

  it('refuses file actions before the connection is ready', async () => {
    const { manager } = setup();
    const { sessionId } = manager.open(1, 'files');
    await expect(manager.list(1, sessionId, '/')).rejects.toMatchObject({ code: 'files.sessionNotReady' });
    expect(() => manager.transfer(1, { sessionId, direction: 'download', sources: ['/a'], targetDir: 'C:\\', move: false })).toThrow(expect.objectContaining({ code: 'files.sessionNotReady' }));
    manager.closeAll();
  });

  it('reports no auto-uploads in the state and looks up the binding before checking readiness', async () => {
    const { manager } = setup();
    const { sessionId } = manager.open(1, 'files');
    expect(manager.state(1, sessionId).syncs).toEqual([]);
    const binding = { id: '5b1d6f0e-3c1a-4c53-9f0e-0a6f4a1d9b11', localPath: 'C:\\x', remotePath: '/x', excludes: [], enabled: true };
    nodes.synced = { ...nodes.files, id: 'synced', autoUpload: [binding] } as ConnectionNode;
    const synced = manager.open(1, 'synced').sessionId;
    // Unknown binding wins over "not ready"; a known one reaches the readiness check.
    await expect(manager.syncStart(1, synced, '00000000-0000-4000-8000-000000000000')).rejects.toMatchObject({ code: 'files.syncNotFound' });
    await expect(manager.syncStart(1, synced, binding.id)).rejects.toMatchObject({ code: 'files.sessionNotReady' });
    expect(() => manager.syncForce(1, synced, binding.id)).toThrow(expect.objectContaining({ code: 'files.sessionNotReady' }));
    expect(() => manager.syncStop(1, synced, binding.id)).not.toThrow();
    expect(() => manager.syncStop(2, synced, binding.id)).toThrow(expect.objectContaining({ code: 'files.sessionUnavailable' }));
    delete nodes.synced;
    manager.closeAll();
  });

  it('reads remote types, sizes and permissions', () => {
    expect(permissionText(0o100644)).toBe('-rw-r--r--');
    expect(permissionText(0o040755)).toBe('drwxr-xr-x');
    const attrs = { mode: 0o120777, size: 7, mtime: 10, atime: 0, uid: 0, gid: 0 };
    expect(remoteEntry('link', attrs, { ...attrs, mode: 0o040755 })).toMatchObject({ type: 'link', linkTarget: 'directory', size: 0, modified: 10_000 });
    expect(remoteEntry('broken', attrs, null)).toMatchObject({ type: 'link', size: 0 });
  });
});

describe('SFTP connection failures', () => {
  it('throws coded errors for the session limit and missing fields', () => {
    const { manager } = setup();
    for (let index = 0; index < MAX_SFTP_SESSIONS; index++) manager.open(1, 'files');
    expect(() => manager.open(1, 'files')).toThrow(expect.objectContaining({ code: 'files.maxSessions', params: { max: MAX_SFTP_SESSIONS } }));
    manager.closeAll();
    nodes.blank = { ...nodes.files, id: 'blank', username: '' } as ConnectionNode;
    expect(() => setup().manager.open(1, 'blank')).toThrow(expect.objectContaining({ code: 'files.missingHostOrUser' }));
    delete nodes.blank;
  });

  it('reports a connection error with code and raw text', async () => {
    const { manager, events, clients } = setup();
    const { sessionId } = manager.open(1, 'files');
    await vi.waitFor(() => expect(clients[0].connect).toHaveBeenCalled());
    clients[0].emit('error', Object.assign(new Error('connect ECONNREFUSED 1.2.3.4:22'), { code: 'ECONNREFUSED' }));
    expect(events.at(-1)).toEqual({ ownerId: 1, event: { type: 'status', sessionId, status: 'error', error: { code: 'ssh.connectionRefused', detail: 'connect ECONNREFUSED 1.2.3.4:22' }, code: 'refused' } });
  });

  it('truncates a long error detail and cause details to 500 characters', async () => {
    const { manager, events, clients } = setup();
    manager.open(1, 'files');
    await vi.waitFor(() => expect(clients[0].connect).toHaveBeenCalled());
    const long = 'y'.repeat(600);
    clients[0].emit('error', new AppError('ssh.failed', undefined, long, [{ label: 'host', error: { code: 'ssh.failed', detail: long } }]));
    const sent = (events.at(-1)!.event as { error?: CodedError }).error!;
    expect(sent.detail).toHaveLength(500);
    expect(sent.causes![0].error.detail).toHaveLength(500);
  });

  it('reports closed-by-server when the client closes on its own', async () => {
    const { manager, events, clients } = setup();
    const { sessionId } = manager.open(1, 'files');
    await vi.waitFor(() => expect(clients[0].connect).toHaveBeenCalled());
    clients[0].emit('close');
    expect(events.at(-1)).toEqual({ ownerId: 1, event: { type: 'status', sessionId, status: 'closed', code: 'closed-by-server' } });
    manager.closeAll();
  });

  it('reports hostkey-rejected when the key is not confirmed', async () => {
    const events: SftpEvent[] = [];
    let verifier: ((key: Buffer, callback: (valid: boolean) => void) => void) | undefined;
    const client = Object.assign(new EventEmitter(), { destroy: vi.fn(),
      connect: vi.fn((config: { hostVerifier: typeof verifier }) => { verifier = config.hostVerifier; }) });
    const manager = new SftpSessionManager({ getConnection: id => nodes[id], verifyHost: async () => false,
      emit: (_owner, event) => events.push(event), local: localFileSystem, openFile: async () => {}, createClient: () => client as unknown as Client });
    manager.open(1, 'files');
    await vi.waitFor(() => expect(verifier).toBeDefined());
    verifier!(Buffer.from('key'), () => {});
    await vi.waitFor(() => expect(events.at(-1)).toMatchObject({ status: 'error', error: { code: 'files.hostKeyRejected' }, code: 'hostkey-rejected' }));
  });
});
