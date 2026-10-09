import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Server } from 'ssh2';
import type { Connection, ServerChannel, PseudoTtyOptions } from 'ssh2';
import type { ConnectionNode } from '../../shared/vault/types';
import type { SshEvent } from '../../shared/ssh';
import { agentSocket, SshSessionManager } from './session';
import { MAX_SSH_SESSIONS } from '../../shared/ssh';
import { HostKeyError } from './known-hosts';

const hostKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });
let server: Server;
let manager: SshSessionManager;
let connection: ConnectionNode;
let events: SshEvent[];
let peers: Connection[];
let shell: ServerChannel | undefined;
let shells: ServerChannel[];
let size: PseudoTtyOptions | undefined;
let autoAck: boolean;
const directories: string[] = [];

async function waitFor(predicate: () => boolean): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > 7000) throw new Error('SSH test timed out');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
function hasStatus(status: string): boolean { return events.some(event => event.type === 'status' && event.status === status); }
function output(): string { return Buffer.concat(events.filter(event => event.type === 'data').map(event => Buffer.from(event.data))).toString('utf8'); }
function prepare() { return manager.prepare(1, { connectionId: connection.id, cols: 80, rows: 24 }).sessionId; }

beforeEach(async () => {
  events = []; peers = []; shell = undefined; shells = []; size = undefined; autoAck = true;
  server = new Server({ hostKeys: [hostKey] }, peer => {
    peers.push(peer);
    peer.on('error', () => {});
    peer.on('authentication', context => {
      if (context.username === 'synthetic-user' &&
        ((context.method === 'password' && context.password === 'synthetic-password') || context.method === 'publickey')) context.accept();
      else context.reject();
    });
    peer.on('ready', () => peer.on('session', accept => {
      const session = accept();
      session.on('pty', (acceptPty, _reject, info) => { size = info; acceptPty(); });
      session.on('window-change', (acceptResize, _reject, info) => { size = { ...size!, ...info }; acceptResize?.(); });
      session.on('shell', acceptShell => {
        const stream = acceptShell();
        shell = stream; shells.push(stream);
        stream.on('error', () => {});
        stream.write('synthetic-ready\r\n');
        stream.on('data', (data: Buffer) => { stream.write(data); });
      });
    }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address === 'string' || !address) throw new Error('Missing server address');
  connection = { id: 'test-connection', type: 'connection', name: 'Synthetic server', host: '127.0.0.1',
    port: address.port, username: 'synthetic-user', authentication: { method: 'password', password: 'synthetic-password' }, tags: [] };
  manager = new SshSessionManager({ getConnection: id => {
    if (id !== connection.id) throw new Error('Unknown saved connection');
    return structuredClone(connection);
  }, verifyHost: async () => true, emit: (owner, event) => {
    events.push(event);
    if (autoAck && event.type === 'data') manager.acknowledge(owner, event.sessionId, event.sequence);
  } });
});

afterEach(async () => {
  manager.closeAll();
  for (const peer of peers) peer.end();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe('SSH session manager with a real local SSH server', () => {
  it('authenticates, exchanges UTF-8 and ANSI data, resizes and closes', async () => {
    const id = prepare();
    await manager.connect(1, id);
    await waitFor(() => hasStatus('connected') && output().includes('synthetic-ready'));
    expect(size).toMatchObject({ cols: 80, rows: 24, term: 'xterm-256color' });
    await manager.input(1, id, 'echo synthetic \u00e4 \u{1f642}\r');
    await waitFor(() => output().includes('echo synthetic \u00e4 \u{1f642}'));
    const bytes = Buffer.from('\u00e4');
    shell!.write(bytes.subarray(0, 1)); shell!.write(bytes.subarray(1));
    shell!.stderr.write('\x1b[31mstderr\x1b[0m');
    await waitFor(() => output().includes('\x1b[31mstderr\x1b[0m'));
    manager.resize(1, id, { cols: 110, rows: 37 });
    await waitFor(() => size?.cols === 110 && size.rows === 37);
    manager.close(1, id);
    expect(hasStatus('closed')).toBe(true);
    expect(manager.hasOwner(1)).toBe(false);
  });

  it('keeps ownership boundaries across multiple sessions', async () => {
    const id = prepare();
    const second = manager.prepare(2, { connectionId: connection.id, cols: 80, rows: 24 }).sessionId;
    await manager.connect(2, second);
    await waitFor(() => events.some(event => event.type === 'status' && event.sessionId === second && event.status === 'connected'));
    await expect(manager.connect(2, id)).rejects.toThrow('verfügbar');
    expect(() => manager.close(2, id)).toThrow('verfügbar');
    await manager.connect(1, id);
    await waitFor(() => hasStatus('connected'));
    await expect(manager.input(2, id, 'input')).rejects.toThrow('verfügbar');
    expect(() => manager.resize(2, id, { cols: 80, rows: 24 })).toThrow('verfügbar');
    expect(() => manager.acknowledge(2, id, 1)).toThrow('verfügbar');
    manager.closeOwner(1);
    expect(manager.hasOwner(1)).toBe(false);
    expect(manager.hasOwner(2)).toBe(true);
    manager.closeOwner(2);
    expect(manager.hasOwner(2)).toBe(false);
  });

  it('isolates concurrent shell output and keeps other sessions alive when one closes', async () => {
    const first = prepare(); const second = prepare();
    await Promise.all([manager.connect(1, first), manager.connect(1, second)]);
    await waitFor(() => [first, second].every(id => events.some(event => event.type === 'status' && event.sessionId === id && event.status === 'connected')));
    await Promise.all([manager.input(1, first, 'only-first\r'), manager.input(1, second, 'only-second\r')]);
    const sessionOutput = (id: string) => Buffer.concat(events.flatMap(event => event.type === 'data' && event.sessionId === id ? [Buffer.from(event.data)] : [])).toString();
    await waitFor(() => sessionOutput(first).includes('only-first') && sessionOutput(second).includes('only-second'));
    expect(sessionOutput(first)).not.toContain('only-second');
    expect(sessionOutput(second)).not.toContain('only-first');
    manager.close(1, first);
    expect(() => manager.acknowledge(1, first, 1)).not.toThrow();
    await manager.input(1, second, 'still-alive\r');
    await waitFor(() => sessionOutput(second).includes('still-alive'));
    expect(manager.hasOwner(1)).toBe(true);
    manager.closeAll();
    expect(manager.hasOwner(1)).toBe(false);
  });

  it('limits simultaneous reservations and releases a slot on close', () => {
    const ids = Array.from({ length: MAX_SSH_SESSIONS }, () => prepare());
    expect(() => prepare()).toThrow(`Maximal ${MAX_SSH_SESSIONS}`);
    manager.close(1, ids[0]);
    expect(() => prepare()).not.toThrow();
  });

  it('reports authentication failure without exposing the password', async () => {
    connection.authentication = { method: 'password', password: 'wrong-synthetic-secret' };
    await manager.connect(1, prepare());
    await waitFor(() => hasStatus('error'));
    expect(JSON.stringify(events)).not.toContain('wrong-synthetic-secret');
    expect(events).toContainEqual(expect.objectContaining({ type: 'status', status: 'error', message: expect.stringContaining('Anmeldung') }));
    expect(manager.hasOwner(1)).toBe(false);
  });

  it('rejects changed host keys before authentication', async () => {
    manager = new SshSessionManager({ getConnection: () => connection,
      verifyHost: async () => { throw new HostKeyError('Server-Schlüssel geändert'); },
      emit: (_owner, event) => events.push(event) });
    await manager.connect(1, prepare());
    await waitFor(() => hasStatus('error'));
    expect(hasStatus('connected')).toBe(false);
    expect(manager.hasOwner(1)).toBe(false);
  });

  it('loads an encrypted private key only in the main process', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'terminus-ssh-key-test-')); directories.push(directory);
    const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
      type: 'pkcs1', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'synthetic-passphrase',
    });
    const keyPath = join(directory, 'synthetic.pem');
    await writeFile(keyPath, privateKey);
    connection.authentication = { method: 'privateKey', keyPath, passphrase: 'synthetic-passphrase' };
    await manager.connect(1, prepare());
    await waitFor(() => hasStatus('connected'));
    expect(JSON.stringify(events)).not.toContain('synthetic-passphrase');
    expect(JSON.stringify(events)).not.toContain('PRIVATE KEY');
  });

  it('bounds output until the renderer acknowledges processed blocks', async () => {
    const id = prepare();
    await manager.connect(1, id);
    await waitFor(() => hasStatus('connected') && output().includes('synthetic-ready'));
    events = []; autoAck = false;
    shell!.write(Buffer.alloc(768 * 1024, 65));
    await waitFor(() => events.filter(event => event.type === 'data').reduce((sum, event) => sum + event.data.byteLength, 0) >= 128 * 1024);
    await new Promise(resolve => setTimeout(resolve, 100));
    const pending = events.filter(event => event.type === 'data');
    expect(pending.reduce((sum, event) => sum + event.data.byteLength, 0)).toBeLessThanOrEqual(512 * 1024);
    expect(hasStatus('error')).toBe(false);
    autoAck = true;
    for (const event of pending) manager.acknowledge(1, id, event.sequence);
    await waitFor(() => output().length === 768 * 1024);
  });

  it('aborts a pending host-key decision cleanly when closed', async () => {
    let complete: ((accepted: boolean) => void) | undefined;
    manager = new SshSessionManager({ getConnection: () => connection,
      verifyHost: () => new Promise(resolve => { complete = resolve; }), emit: (_owner, event) => events.push(event) });
    const id = prepare();
    await manager.connect(1, id);
    await waitFor(() => Boolean(complete));
    manager.closeAll();
    complete!(true);
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(hasStatus('connected')).toBe(false);
    expect(manager.hasOwner(1)).toBe(false);
  });
});

describe('SSH agent socket selection', () => {
  it('uses OpenSSH on Windows and respects SSH_AUTH_SOCK', () => {
    expect(agentSocket('win32', '')).toBe('\\\\.\\pipe\\openssh-ssh-agent');
    expect(agentSocket('linux', '/synthetic/agent.sock')).toBe('/synthetic/agent.sock');
    expect(() => agentSocket('linux', '')).toThrow('SSH-Agent');
  });
});
