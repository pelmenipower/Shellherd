import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { Client } from 'ssh2';
import type { ConnectionNode } from '../../shared/vault/types';
import type { SftpEvent } from '../../shared/sftp';
import { AppError, type CodedError } from '../../shared/errors';
import { FileError, localFileSystem } from './file-system';
import { SftpSessionManager } from './sftp-session';
import type { SftpDependencies } from './sftp-session';
import type { Jump } from '../ssh/jump';
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

describe('SFTP idle disconnect', () => {
  type Internals = { sessions: Map<string, { syncs?: unknown; edits?: unknown; running?: unknown }> };

  async function connected(idleMinutes: number) {
    const events: SftpEvent[] = [];
    const client = Object.assign(new EventEmitter(), { destroy: vi.fn(), connect: vi.fn(),
      sftp: vi.fn((callback: (error: undefined, sftp: EventEmitter & { end: () => void }) => void) => callback(undefined, Object.assign(new EventEmitter(), { end: vi.fn() }))) });
    const manager = new SftpSessionManager({ getConnection: id => nodes[id], verifyHost: async () => true, emit: (_owner, event) => events.push(event),
      local: localFileSystem, openFile: async () => {}, createClient: () => client as unknown as Client,
      getTimeouts: () => ({ idleMinutes, keepaliveSeconds: 15, keepaliveCount: 3, connectSeconds: 120 }) });
    const { sessionId } = manager.open(1, 'files');
    await vi.waitFor(() => expect(client.connect).toHaveBeenCalled());
    client.emit('ready');
    const session = (manager as unknown as Internals).sessions.get(sessionId)!;
    return { manager, events, session, sessionId };
  }
  const lastStatus = (events: SftpEvent[]) => events.filter(event => event.type === 'status').at(-1);

  it('closes with code idle after the idle time and leaves no timer behind', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const { events } = await connected(1);
      expect(vi.getTimerCount()).toBe(1);
      vi.advanceTimersByTime(60_000);
      expect(lastStatus(events)).toMatchObject({ status: 'closed', code: 'idle' });
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it('is extended by server calls and sets no timer for idleMinutes 0', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const { manager, events, sessionId } = await connected(1);
      vi.advanceTimersByTime(59_000);
      manager.state(1, sessionId);
      vi.advanceTimersByTime(59_000);
      expect(lastStatus(events)).toMatchObject({ status: 'connected' });
      vi.advanceTimersByTime(1_000);
      expect(lastStatus(events)).toMatchObject({ status: 'closed', code: 'idle' });
    } finally { vi.useRealTimers(); }
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const { manager } = await connected(0);
      expect(vi.getTimerCount()).toBe(0);
      manager.closeAll();
    } finally { vi.useRealTimers(); }
  });

  it.each([
    ['a running job', (session: { running?: unknown }) => { session.running = {}; }],
    ['a watching auto-upload', (session: { syncs?: unknown }) => { session.syncs = { list: () => [{ state: 'watching' }], closeAll: vi.fn() }; }],
    ['an open edit', (session: { edits?: unknown }) => { session.edits = { list: () => [{}], closeAll: vi.fn() }; }],
  ])('stays open while busy with %s', async (_name, makeBusy) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const { manager, events, session } = await connected(1);
      makeBusy(session);
      vi.advanceTimersByTime(180_000);
      expect(lastStatus(events)).toMatchObject({ status: 'connected' });
      manager.closeAll();
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it('disconnects when the only auto-upload is in error', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const { events, session } = await connected(1);
      session.syncs = { list: () => [{ state: 'error' }], closeAll: vi.fn() };
      vi.advanceTimersByTime(60_000);
      expect(lastStatus(events)).toMatchObject({ status: 'closed', code: 'idle' });
    } finally { vi.useRealTimers(); }
  });
});

describe('SFTP jump host and keyboard prompts', () => {
  const behind = { ...nodes.files, id: 'behind', jumpHost: 'hop' } as ConnectionNode;
  const hop = (close = vi.fn()): Jump => ({ name: 'hop', sock: new PassThrough(), close });

  function setup(deps: Partial<SftpDependencies>) {
    const events: SftpEvent[] = [];
    const client = Object.assign(new EventEmitter(), { connect: vi.fn(), destroy: vi.fn() });
    const manager = new SftpSessionManager({
      getConnection: id => (id === 'behind' ? behind : nodes[id]),
      verifyHost: async () => true,
      emit: (_owner, event) => events.push(event),
      local: localFileSystem,
      openFile: async () => {},
      createClient: () => client as unknown as Client,
      ...deps,
    });
    return { manager, events, client };
  }

  it('connects through the jump socket and closes the hop with the session', async () => {
    const jump = hop();
    const openJump = vi.fn(async () => jump);
    const { manager, client } = setup({ openJump });
    manager.open(1, 'behind');
    await vi.waitFor(() => expect(client.connect).toHaveBeenCalledWith(expect.objectContaining({ sock: jump.sock })));
    expect(openJump).toHaveBeenCalledWith(behind, 1, expect.any(Function));
    expect(jump.close).not.toHaveBeenCalled();
    manager.closeAll();
    expect(jump.close).toHaveBeenCalledTimes(1);
  });

  it('closes a hop that arrives after the session was closed', async () => {
    const jump = hop();
    let resolve!: (value: Jump | undefined) => void;
    const { manager, client } = setup({ openJump: () => new Promise<Jump | undefined>(done => { resolve = done; }) });
    const { sessionId } = manager.open(1, 'behind');
    manager.close(1, sessionId);
    resolve(jump);
    await vi.waitFor(() => expect(jump.close).toHaveBeenCalledTimes(1));
    expect(client.connect).not.toHaveBeenCalled();
  });

  it('ends the session with the hop error when the hop fails', async () => {
    const { manager, events, client } = setup({ openJump: async () => { throw new AppError('ssh.jumpHostFailed', { name: 'hop' }); } });
    manager.open(1, 'behind');
    await vi.waitFor(() => expect(events.at(-1)).toMatchObject({ type: 'status', status: 'error', error: { code: 'ssh.jumpHostFailed' } }));
    expect(client.connect).not.toHaveBeenCalled();
  });

  it('stops asking for the hop once the session has ended', async () => {
    let isActive!: () => boolean;
    const { manager } = setup({ openJump: async (_connection, _owner, active) => { isActive = active; return new Promise<Jump | undefined>(() => {}); } });
    const { sessionId } = manager.open(1, 'behind');
    await vi.waitFor(() => expect(isActive).toBeDefined());
    expect(isActive()).toBe(true);
    manager.close(1, sessionId);
    expect(isActive()).toBe(false);
  });

  it('refuses to connect directly when the jump host cannot be opened', async () => {
    const { manager, events, client } = setup({});
    manager.open(1, 'behind');
    await vi.waitFor(() => expect(events.at(-1)).toMatchObject({ type: 'status', status: 'error', error: { code: 'ssh.jumpHostUnusable' } }));
    expect(client.connect).not.toHaveBeenCalled();
  });

  it('answers keyboard prompts only when a prompt function is given', async () => {
    const withAsk = setup({ ask: async () => null });
    withAsk.manager.open(1, 'files');
    await vi.waitFor(() => expect(withAsk.client.connect).toHaveBeenCalledWith(expect.objectContaining({ tryKeyboard: true })));
    withAsk.manager.closeAll();
    const without = setup({});
    without.manager.open(1, 'files');
    await vi.waitFor(() => expect(without.client.connect).toHaveBeenCalled());
    expect(without.client.connect).toHaveBeenCalledWith(expect.objectContaining({ tryKeyboard: false }));
    without.manager.closeAll();
  });
});
