import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { Client } from 'ssh2';
import type { ConnectionNode } from '../../shared/vault/types';
import type { SftpEvent } from '../../shared/sftp';
import { localFileSystem } from './file-system';
import { SftpSessionManager } from './sftp-session';
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
    getConnection: id => { const node = nodes[id]; if (!node) throw new Error('Die Verbindung wurde nicht gefunden.'); return node; },
    verifyHost: async () => true,
    emit: (ownerId, event) => events.push({ ownerId, event }),
    local: localFileSystem,
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
    expect(() => manager.open(1, 'desktop')).toThrow('keine Dateiübertragung');
    manager.closeAll();
  });

  it('belongs to one window at a time and follows a tab into another window', () => {
    const { manager, events } = setup();
    const { sessionId } = manager.open(1, 'files');
    expect(() => manager.state(2, sessionId)).toThrow('nicht verfügbar');
    expect(manager.transferOwner(1, sessionId, 2)).toBe('connecting');
    expect(manager.owns(2, sessionId)).toBe(true);
    expect(() => manager.close(1, sessionId)).toThrow('nicht verfügbar');
    manager.close(2, sessionId);
    expect(events.at(-1)).toEqual({ ownerId: 2, event: { type: 'status', sessionId, status: 'closed' } });
  });

  it('refuses file actions before the connection is ready', async () => {
    const { manager } = setup();
    const { sessionId } = manager.open(1, 'files');
    await expect(manager.list(1, sessionId, '/')).rejects.toThrow('noch nicht bereit');
    expect(() => manager.transfer(1, { sessionId, direction: 'download', sources: ['/a'], targetDir: 'C:\\', move: false })).toThrow('noch nicht bereit');
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
