import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Server } from 'ssh2';
import type { Connection, ServerChannel, PseudoTtyOptions } from 'ssh2';
import type { ConnectionNode, KubernetesConnectionNode, SshConnectionNode } from '../../shared/vault/types';
import type { SshEvent, TerminalSize } from '../../shared/ssh';
import type { KubeTerminalTarget } from '../../shared/kubernetes';
import type { KubeStream, TerminalIo } from '../kubernetes/api';
import { agentSocket, publicError, SshSessionManager, targetExitError } from './session';
import { AppError } from '../../shared/errors';
import { MAX_SSH_SESSIONS } from '../../shared/ssh';
import { HostKeyError } from './known-hosts';
import { LOCAL_CONTAINER_HOST } from '../../shared/containers';
import { connectionFingerprint, SudoRejections } from '../containers/sudo-rejections';

const hostKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });
let server: Server;
let manager: SshSessionManager;
let connection: SshConnectionNode;
const noShell = (): never => { throw new Error('SSH tests never start local shells'); };
let events: SshEvent[];
let peers: Connection[];
let shell: ServerChannel | undefined;
let shells: ServerChannel[];
let execCommands: string[];
let sudoInput: string[];
let size: PseudoTtyOptions | undefined;
let autoAck: boolean;
let sudoRejections: SudoRejections;
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

/**
 * Behaves like the prompt script on a tty: `sudo -p MARKER -v` prints the prompt and reads a line
 * (asking again after a wrong one), then READY, then an echoing shell that prints MARKER on "leak".
 */
function simulateTtySudo(stream: ServerChannel, command: string): void {
  const marker = /\[terminus-sudo-[0-9a-f]{16}\]/.exec(command)![0];
  const ready = /\[terminus-ready-[0-9a-f]{16}\]/.exec(command)![0];
  const expected = command.includes('sudo-wrong') ? 'other-synthetic-password' : 'synthetic-password';
  let answered = command.includes('nopasswd');
  let line = '';
  stream.on('data', (data: Buffer) => {
    sudoInput.push(data.toString('utf8'));
    if (answered) {
      stream.write(data);
      if (data.toString('utf8').includes('leak')) stream.write(`\r\nleaked ${marker}\r\n`);
      return;
    }
    line += data.toString('utf8');
    const end = line.indexOf('\n');
    if (end === -1) return;
    const attempt = line.slice(0, end);
    line = '';
    if (attempt === expected && command.includes('sudo-nocache')) {
      stream.write(`\r\n${ready}sudo: a password is required\r\n`); stream.exit(1); stream.end(); return;
    }
    if (attempt === expected) { answered = true; stream.write('\r\n'); stream.write(`${ready}sudo-ok\r\n`); return; }
    stream.write(`\r\nSorry, try again.\r\n${marker}`);
  });
  if (answered) { stream.write(ready); stream.write('exec-ready\r\n'); return; }
  // Captured per test, so streams of earlier tests that close late do not count.
  const open = openPrompts;
  const settle = () => { open.delete(stream); };
  stream.on('data', () => { if (answered) settle(); });
  stream.on('close', settle);
  const prompt = () => {
    open.add(stream); mostOpenPrompts = Math.max(mostOpenPrompts, open.size);
    // Two writes, so detection has to work across chunks.
    stream.write(`notice\r\n${marker.slice(0, 9)}`);
    stream.write(marker.slice(9));
  };
  if (command.includes('sudo-quiet')) {
    stream.write('starting\r\n');
    quietPrompt = prompt;
    quietCrash = () => { stream.stderr.write('sudo: unable to resolve host\r\n'); stream.exit(1); stream.end(); };
    return;
  }
  prompt();
}
let quietPrompt: (() => void) | undefined;
let quietCrash: (() => void) | undefined;
let openPrompts = new Set<ServerChannel>();
let mostOpenPrompts = 0;

beforeEach(async () => {
  events = []; peers = []; shell = undefined; shells = []; execCommands = []; sudoInput = []; size = undefined; autoAck = true; quietPrompt = undefined; quietCrash = undefined; openPrompts = new Set(); mostOpenPrompts = 0;
  sudoRejections = new SudoRejections();
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
      session.on('exec', (acceptExec, _reject, info) => {
        execCommands.push(info.command);
        const stream = acceptExec();
        stream.on('error', () => {});
        if (info.command.includes(' -v && printf')) { simulateTtySudo(stream, info.command); return; }
        if (info.command.includes('missing')) { stream.stderr.write('Error response from daemon: No such container: missing\r\n'); stream.exit(1); stream.end(); return; }
        if (info.command.includes('exits-ok')) { stream.write('bye\r\n'); stream.exit(0); stream.end(); return; }
        if (info.command.includes('exits-on-input')) {
          stream.write('exec-ready\r\n');
          stream.on('data', () => { stream.exit(127); stream.end(); });
          return;
        }
        stream.write('exec-ready\r\n');
        stream.on('data', (data: Buffer) => { stream.write(data); });
      });
    }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address === 'string' || !address) throw new Error('Missing server address');
  connection = { id: 'test-connection', type: 'connection', protocol: 'ssh', name: 'Synthetic server', host: '127.0.0.1',
    port: address.port, username: 'synthetic-user', authentication: { method: 'password', password: 'synthetic-password' }, tags: [] };
  manager = new SshSessionManager({ getConnection: id => {
    if (id !== connection.id) throw new Error('Unknown saved connection');
    return structuredClone(connection);
  }, verifyHost: async () => true, spawnShell: noShell, sudoRejections, emit: (owner, event) => {
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
    await expect(manager.connect(2, id)).rejects.toThrow(expect.objectContaining({ code: 'ssh.notAvailable' }));
    expect(() => manager.close(2, id)).toThrow(expect.objectContaining({ code: 'ssh.notAvailable' }));
    await manager.connect(1, id);
    await waitFor(() => hasStatus('connected'));
    await expect(manager.input(2, id, 'input')).rejects.toThrow(expect.objectContaining({ code: 'ssh.notAvailable' }));
    expect(() => manager.resize(2, id, { cols: 80, rows: 24 })).toThrow(expect.objectContaining({ code: 'ssh.notAvailable' }));
    expect(() => manager.acknowledge(2, id, 1)).toThrow(expect.objectContaining({ code: 'ssh.notAvailable' }));
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
    expect(() => prepare()).toThrow(expect.objectContaining({ code: 'ssh.sessionLimit', params: { max: MAX_SSH_SESSIONS } }));
    manager.close(1, ids[0]);
    expect(() => prepare()).not.toThrow();
  });

  it('reports authentication failure without exposing the password', async () => {
    connection.authentication = { method: 'password', password: 'wrong-synthetic-secret' };
    await manager.connect(1, prepare());
    await waitFor(() => hasStatus('error'));
    expect(JSON.stringify(events)).not.toContain('wrong-synthetic-secret');
    expect(events).toContainEqual(expect.objectContaining({ type: 'status', status: 'error', error: { code: 'ssh.authFailed' } }));
    expect(manager.hasOwner(1)).toBe(false);
  });

  it('rejects changed host keys before authentication', async () => {
    manager = new SshSessionManager({ getConnection: () => connection, spawnShell: noShell,
      verifyHost: async () => { throw new HostKeyError('ssh.hostKeyChanged'); },
      emit: (_owner, event) => events.push(event) });
    await manager.connect(1, prepare());
    await waitFor(() => hasStatus('error'));
    expect(events).toContainEqual(expect.objectContaining({ status: 'error', error: { code: 'ssh.hostKeyChanged' } }));
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
    manager = new SshSessionManager({ getConnection: () => connection, spawnShell: noShell,
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

  const web = { kind: 'container' as const, runtime: 'docker' as const, ref: 'web-1', name: 'web-1' };

  it('opens a container shell through exec with a pseudo terminal', async () => {
    const id = manager.prepare(1, { connectionId: connection.id, cols: 90, rows: 30, target: { item: web, mode: 'shell' } }).sessionId;
    await manager.connect(1, id);
    await waitFor(() => output().includes('exec-ready'));
    expect(execCommands).toEqual([`PATH="$PATH:/usr/sbin:/sbin" docker exec -it web-1 sh -c 'command -v bash >/dev/null 2>&1 && exec bash || exec sh'`]);
    expect(size).toMatchObject({ cols: 90, rows: 30, term: 'xterm-256color' });
    await manager.input(1, id, 'ls\r');
    await waitFor(() => output().includes('ls'));
    expect(shells).toHaveLength(0);
  });

  it('uses sudo -n when the connection asks for it but has no stored password', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'terminus-ssh-key-test-')); directories.push(directory);
    const keyPath = join(directory, 'synthetic.pem');
    await writeFile(keyPath, generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }));
    connection = { ...connection, containers: { sudo: true }, authentication: { method: 'privateKey', keyPath } };
    const id = manager.prepare(1, { connectionId: connection.id, cols: 80, rows: 24, target: { item: { kind: 'lxc', vmid: 101, name: 'ct' }, mode: 'shell' } }).sessionId;
    await manager.connect(1, id);
    await waitFor(() => execCommands.length === 1);
    expect(execCommands[0]).toBe('PATH="$PATH:/usr/sbin:/sbin" sudo -n pct enter 101');
  });

  const sudoTab = (ref: string) => {
    connection = { ...connection, containers: { sudo: true } };
    return manager.prepare(1, { connectionId: connection.id, cols: 80, rows: 24, target: { item: { ...web, ref, name: ref }, mode: 'shell' } }).sessionId;
  };
  const leaked = () => /leaked \[terminus-sudo-[0-9a-f]{16}\]/.test(output());

  it('answers the sudo prompt once, then disarms at the ready marker', async () => {
    const id = sudoTab('web-1');
    await manager.connect(1, id);
    await waitFor(() => output().includes('sudo-ok'));
    expect(execCommands[0]).toMatch(/^sh -c 'PATH="\$PATH:\/usr\/sbin:\/sbin"; sudo -p '\\''\[terminus-sudo-[0-9a-f]{16}\]'\\'' -v && printf %s '\\''\[terminus-ready-[0-9a-f]{16}\]'\\'' && sudo -n docker exec -it web-1 /);
    expect(execCommands[0]).not.toContain('synthetic-password');
    expect(sudoInput.join('')).toBe('synthetic-password\n');
    expect(output()).toContain('notice\r\n');
    expect(output()).not.toContain('terminus-');
    await manager.input(1, id, 'leak\r');
    await waitFor(leaked);
    expect(sudoInput.join('')).toBe('synthetic-password\nleak\r');
    expect(JSON.stringify(events)).not.toContain('synthetic-password');
    expect(hasStatus('error')).toBe(false);
  });

  it('ends a container tab when sudo rejects the stored password', async () => {
    await manager.connect(1, sudoTab('sudo-wrong'));
    await waitFor(() => hasStatus('error'));
    expect(events).toContainEqual(expect.objectContaining({ type: 'status', status: 'error', error: { code: 'containers.sudoRejected' } }));
    expect(sudoInput.join('')).toBe('synthetic-password\n');
    expect(output()).not.toContain('terminus-');
    expect(JSON.stringify(events)).not.toContain('synthetic-password');
  });

  it('never types the password when sudo does not ask, even if the shell prints the prompt marker later', async () => {
    const id = sudoTab('nopasswd');
    await manager.connect(1, id);
    await waitFor(() => output().includes('exec-ready'));
    expect(output()).not.toContain('terminus-');
    await manager.input(1, id, 'a[');
    await waitFor(() => output().includes('a['));
    await manager.input(1, id, 'leak\r');
    await waitFor(leaked);
    await manager.input(1, id, 'more\r');
    await waitFor(() => output().includes('more'));
    expect(sudoInput.join('')).toBe('a[leak\rmore\r');
    expect(hasStatus('error')).toBe(false);
  });

  it('refuses a password with a line break before connecting', async () => {
    connection = { ...connection, authentication: { method: 'password', password: 'synthetic\npassword' } };
    await manager.connect(1, sudoTab('web-1'));
    await waitFor(() => hasStatus('error'));
    expect(events).toContainEqual(expect.objectContaining({ status: 'error', error: expect.objectContaining({ code: expect.stringMatching(/^containers\./) }) }));
    expect(execCommands).toEqual([]);
    expect(peers).toHaveLength(0);
  });

  it('remembers a rejection so further tabs fail without sending the password again', async () => {
    await manager.connect(1, sudoTab('sudo-wrong'));
    await waitFor(() => hasStatus('error'));
    expect(sudoRejections.isRejected(connection.id, connectionFingerprint(connection))).toBe(true);
    events = [];
    await manager.connect(1, sudoTab('web-1'));
    await waitFor(() => hasStatus('error'));
    expect(events).toContainEqual(expect.objectContaining({ status: 'error', error: { code: 'containers.sudoRejected' } }));
    expect(execCommands).toHaveLength(1);
    expect(peers).toHaveLength(1);
    expect(sudoInput.join('')).toBe('synthetic-password\n');
  });

  const statusesOf = (ids: string[], status: string) => ids.filter(id => events.some(event => event.type === 'status' && event.sessionId === id && event.status === status));

  it('sends a wrong password only once when several tabs open at the same time', async () => {
    const ids = [sudoTab('sudo-wrong'), sudoTab('sudo-wrong'), sudoTab('sudo-wrong')];
    await Promise.all(ids.map(id => manager.connect(1, id)));
    await waitFor(() => statusesOf(ids, 'error').length === 3);
    for (const id of ids) {
      expect(events).toContainEqual(expect.objectContaining({ sessionId: id, status: 'error', error: { code: 'containers.sudoRejected' } }));
    }
    expect(sudoInput.join('')).toBe('synthetic-password\n');
    expect(execCommands).toHaveLength(1);
  });

  it('lets several tabs authenticate one after another with a correct password', async () => {
    const ids = [sudoTab('web-1'), sudoTab('web-1'), sudoTab('web-1')];
    await Promise.all(ids.map(id => manager.connect(1, id)));
    await waitFor(() => output().split('sudo-ok').length === 4);
    expect(sudoInput.join('')).toBe('synthetic-password\n'.repeat(3));
    expect(mostOpenPrompts).toBe(1);
    expect(statusesOf(ids, 'connected')).toHaveLength(3);
    expect(hasStatus('error')).toBe(false);
  });

  it('gives up its place when a waiting tab is closed', async () => {
    const holder = sudoTab('sudo-quiet');
    const closed = sudoTab('web-1');
    const next = sudoTab('web-1');
    const connecting = [manager.connect(1, holder), manager.connect(1, closed), manager.connect(1, next)];
    await waitFor(() => Boolean(quietPrompt));
    // The gate is taken after the SSH handshake, so waiting tabs are already connected to the host.
    await waitFor(() => peers.length === 3);
    expect(execCommands).toHaveLength(1);
    manager.close(1, closed);
    quietPrompt!();
    await Promise.all(connecting);
    await waitFor(() => output().split('sudo-ok').length === 3);
    expect(execCommands).toHaveLength(2);
    expect(statusesOf([closed], 'connected')).toHaveLength(0);
  });

  it('releases the gate when the holding tab fails', async () => {
    const failing = sudoTab('sudo-quiet');
    const next = sudoTab('web-1');
    const connecting = [manager.connect(1, failing), manager.connect(1, next)];
    await waitFor(() => Boolean(quietCrash));
    quietCrash!();
    await waitFor(() => statusesOf([failing], 'closed').length + statusesOf([failing], 'error').length === 1);
    await Promise.all(connecting);
    await waitFor(() => output().includes('sudo-ok'));
    expect(sudoInput.join('')).toBe('synthetic-password\n');
  });

  it('honours a rejection recorded by the container list', async () => {
    sudoRejections.markRejected(connection.id, connectionFingerprint(connection));
    await manager.connect(1, sudoTab('web-1'));
    await waitFor(() => hasStatus('error'));
    expect(events).toContainEqual(expect.objectContaining({ status: 'error', error: { code: 'containers.sudoRejected' } }));
    expect(peers).toHaveLength(0);
  });

  it('explains a server that does not cache sudo credentials', async () => {
    await manager.connect(1, sudoTab('sudo-nocache'));
    await waitFor(() => hasStatus('error'));
    expect(events).toContainEqual(expect.objectContaining({ status: 'error', error: { code: 'containers.sudoNotCached' } }));
  });

  it('gives control back to the user when sudo does not answer in time', async () => {
    manager = new SshSessionManager({ getConnection: () => structuredClone(connection), verifyHost: async () => true, spawnShell: noShell,
      sudoRejections, sudoReadyTimeoutMs: 150, emit: (owner, event) => {
        events.push(event);
        if (event.type === 'data') manager.acknowledge(owner, event.sessionId, event.sequence);
      } });
    const stuck = sudoTab('sudo-quiet');
    await manager.connect(1, stuck);
    await waitFor(() => output().includes('[Shellherd] sudo hat nicht wie erwartet geantwortet'));
    expect(output()).toContain('\r\n[Shellherd] sudo hat nicht wie erwartet geantwortet – bitte selbst eingeben.\r\n');
    // The gate is free again: another tab authenticates while the first one is still open.
    const next = sudoTab('web-1');
    await manager.connect(1, next);
    await waitFor(() => output().includes('sudo-ok'));
    await manager.input(1, stuck, 'typed\r');
    await waitFor(() => sudoInput.join('').includes('typed\r'));
    quietPrompt!();
    await waitFor(() => /notice\r\n\[terminus-sudo-[0-9a-f]{16}\]/.test(output()));
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(sudoInput.join('').split('synthetic-password').length).toBe(2);
    expect(hasStatus('error')).toBe(false);
  });

  it('ignores typing while sudo is still authenticating', async () => {
    const id = sudoTab('sudo-quiet');
    await manager.connect(1, id);
    await waitFor(() => output().includes('starting') && Boolean(quietPrompt));
    await manager.input(1, id, 'early\r');
    quietPrompt!();
    await waitFor(() => output().includes('sudo-ok'));
    await manager.input(1, id, 'late\r');
    await waitFor(() => output().includes('late'));
    expect(sudoInput.join('')).toBe('synthetic-password\nlate\r');
    expect(hasStatus('error')).toBe(false);
  });

  it('reports a missing container when the command fails', async () => {
    const id = manager.prepare(1, { connectionId: connection.id, cols: 80, rows: 24, target: { item: { ...web, ref: 'missing', name: 'missing' }, mode: 'shell' } }).sessionId;
    await manager.connect(1, id);
    await waitFor(() => hasStatus('error'));
    expect(events).toContainEqual(expect.objectContaining({ type: 'status', status: 'error', error: { code: 'ssh.containerNotFound', params: { name: 'missing' } } }));
  });

  it('closes normally when the user ends the shell after typing, whatever the exit code', async () => {
    const id = manager.prepare(1, { connectionId: connection.id, cols: 80, rows: 24, target: { item: { ...web, ref: 'exits-on-input' }, mode: 'shell' } }).sessionId;
    await manager.connect(1, id);
    await waitFor(() => output().includes('exec-ready'));
    await manager.input(1, id, 'exit\r');
    await waitFor(() => hasStatus('closed') || hasStatus('error'));
    expect(hasStatus('closed')).toBe(true);
    expect(hasStatus('error')).toBe(false);
  });

  it('closes normally when the remote command exits with 0', async () => {
    const id = manager.prepare(1, { connectionId: connection.id, cols: 80, rows: 24, target: { item: { ...web, ref: 'exits-ok' }, mode: 'logs' } }).sessionId;
    await manager.connect(1, id);
    await waitFor(() => hasStatus('closed') || hasStatus('error'));
    expect(hasStatus('closed')).toBe(true);
    expect(hasStatus('error')).toBe(false);
  });

  it('rejects invalid targets before connecting', () => {
    expect(() => manager.prepare(1, { connectionId: connection.id, cols: 80, rows: 24, target: { item: { ...web, ref: '$(id)' }, mode: 'shell' } })).toThrow(expect.objectContaining({ code: expect.stringMatching(/^containers\./) }));
    expect(() => manager.prepare(1, { connectionId: LOCAL_CONTAINER_HOST, cols: 80, rows: 24 })).toThrow();
  });
});

describe('Kubernetes pod terminals', () => {
  const target: KubeTerminalTarget = { namespace: 'shop', pod: 'api-1', container: 'api', mode: 'logs' };
  const cluster = (id: string, readOnly: boolean): KubernetesConnectionNode => ({ id, type: 'connection', protocol: 'kubernetes', name: 'Synthetic cluster',
    tags: [], accessHosts: [connection.id], kubeconfig: { source: 'auto' }, production: false, readOnly });
  let vault: Record<string, ConnectionNode>;
  let kube: SshSessionManager;
  let kubeEvents: { owner: number; event: SshEvent }[];
  let opened: { clusterId: string; target: KubeTerminalTarget; size: TerminalSize; io: TerminalIo }[];
  let streamCalls: string[];
  let stream: KubeStream;

  beforeEach(() => {
    vault = { [connection.id]: connection, k1: cluster('k1', false), k2: cluster('k2', true) };
    kubeEvents = []; opened = []; streamCalls = [];
    stream = { write: data => streamCalls.push(`write:${data}`), resize: (cols, rows) => streamCalls.push(`resize:${cols}x${rows}`),
      pause: () => streamCalls.push('pause'), resume: () => streamCalls.push('resume'), close: () => streamCalls.push('close') };
    kube = new SshSessionManager({ getConnection: id => {
      const node = vault[id];
      if (!node) throw new Error('Unknown saved connection');
      return structuredClone(node);
    }, verifyHost: async () => true, spawnShell: noShell, emit: (owner, event) => kubeEvents.push({ owner, event }),
    openKubeTerminal: async (clusterId, podTarget, size, io) => { opened.push({ clusterId, target: podTarget, size, io }); return stream; } });
  });
  afterEach(() => kube.closeAll());

  const lastStatus = (id: string) => kubeEvents.flatMap(({ event }) => event.type === 'status' && event.sessionId === id ? [event] : []).pop();
  const kubeOutput = (id: string) => Buffer.concat(kubeEvents.flatMap(({ event }) => event.type === 'data' && event.sessionId === id ? [Buffer.from(event.data)] : [])).toString('utf8');
  async function openPod(mode: KubeTerminalTarget['mode'] = 'logs', clusterId = 'k1') {
    const id = kube.prepare(1, { connectionId: clusterId, cols: 80, rows: 24, kube: { ...target, mode } }).sessionId;
    await kube.connect(1, id);
    return { id, io: opened[opened.length - 1].io };
  }

  it('requires the cluster tab for a cluster without a pod target', () => {
    expect(() => kube.prepare(1, { connectionId: 'k1', cols: 80, rows: 24 })).toThrow(expect.objectContaining({ code: 'ssh.clusterInTab' }));
    expect(opened).toHaveLength(0);
  });

  it('opens pod logs through the cluster and passes output with sequences', async () => {
    const { id, io } = await openPod();
    expect(opened[0]).toMatchObject({ clusterId: 'k1', target, size: { cols: 80, rows: 24 } });
    expect(lastStatus(id)).toMatchObject({ status: 'connected' });
    io.data(Buffer.from('line 1\r\n'));
    io.data(Buffer.from('line 2\r\n'));
    expect(kubeEvents.flatMap(({ event }) => event.type === 'data' ? [event.sequence] : [])).toEqual([1, 2]);
    expect(kubeOutput(id)).toBe('line 1\r\nline 2\r\n');
  });

  it('closes cleanly on exit 0 and reports an error message when the pod gives one', async () => {
    const clean = await openPod();
    clean.io.end(0);
    expect(lastStatus(clean.id)).toMatchObject({ status: 'closed' });
    expect(kube.owns(1, clean.id)).toBe(false);

    const failed = await openPod();
    failed.io.end(137, { code: 'ssh.podTerminalFailed' });
    expect(lastStatus(failed.id)).toMatchObject({ status: 'error', error: { code: 'ssh.podTerminalFailed' } });

    const silent = await openPod();
    silent.io.end(1);
    expect(lastStatus(silent.id)).toMatchObject({ status: 'closed' });
    expect(lastStatus(silent.id)).not.toHaveProperty('error');
  });

  it('writes input, resizes the stream and closes it with the tab', async () => {
    const { id } = await openPod('shell');
    await kube.input(1, id, 'ls\r');
    kube.resize(1, id, { cols: 100, rows: 30 });
    expect(streamCalls).toEqual(['write:ls\r', 'resize:100x30']);
    kube.close(1, id);
    expect(streamCalls[streamCalls.length - 1]).toBe('close');
  });

  it('pauses the stream above the high-water mark and resumes after acknowledgment', async () => {
    const { id, io } = await openPod();
    io.data(Buffer.alloc(128 * 1024));
    expect(streamCalls).toEqual(['pause']);
    kube.acknowledge(1, id, 1);
    expect(streamCalls).toEqual(['pause', 'resume']);
  });

  it('refuses a shell on a read-only cluster but allows logs and previous logs', async () => {
    expect(() => kube.prepare(1, { connectionId: 'k2', cols: 80, rows: 24, kube: { ...target, mode: 'shell' } })).toThrow(expect.objectContaining({ code: 'kubernetes.readOnly' }));
    const logs = await openPod('logs', 'k2');
    expect(lastStatus(logs.id)).toMatchObject({ status: 'connected' });
    const previous = await openPod('previous', 'k2');
    expect(lastStatus(previous.id)).toMatchObject({ status: 'connected' });
  });

  it('refuses a pod target on a connection that is not a cluster', () => {
    expect(() => kube.prepare(1, { connectionId: connection.id, cols: 80, rows: 24, kube: target })).toThrow(expect.objectContaining({ code: 'ssh.podTerminalOnlyKube' }));
  });

  it('rejects invalid pod names and modes before connecting', () => {
    expect(() => kube.prepare(1, { connectionId: 'k1', cols: 80, rows: 24, kube: { ...target, pod: 'api/../x' } })).toThrow(expect.objectContaining({ code: 'ssh.invalidPod' }));
    expect(() => kube.prepare(1, { connectionId: 'k1', cols: 80, rows: 24, kube: { ...target, mode: 'exec' as never } })).toThrow(expect.objectContaining({ code: 'ssh.invalidPod' }));
  });

  it('fails before connecting when cluster terminals are not wired', () => {
    const plain = new SshSessionManager({ getConnection: () => structuredClone(vault.k1), verifyHost: async () => true, spawnShell: noShell, emit: () => {} });
    expect(() => plain.prepare(1, { connectionId: 'k1', cols: 80, rows: 24, kube: target })).toThrow(expect.objectContaining({ code: 'ssh.podTerminalUnavailable' }));
  });

  it('holds output during a window transfer and delivers it to the new owner', async () => {
    const { id, io } = await openPod();
    io.data(Buffer.from('before\r\n'));
    expect(kube.transferOwner(1, id, 2)).toBe('connected');
    io.data(Buffer.from('held\r\n'));
    expect(kubeOutput(id)).toBe('before\r\n');
    expect(streamCalls).toEqual(['pause']);
    kube.attach(2, id);
    expect(kubeOutput(id)).toBe('before\r\nheld\r\n');
    expect(kubeEvents[kubeEvents.length - 1]).toMatchObject({ owner: 2, event: { type: 'data' } });
    expect(streamCalls).toEqual(['pause', 'resume']);
  });
});

describe('targetExitError', () => {
  const web = { kind: 'container' as const, runtime: 'docker' as const, ref: 'web-1', name: 'web-1' };
  it('explains failed container commands', () => {
    expect(targetExitError({ item: web, mode: 'shell' }, 0, '')).toBeUndefined();
    expect(targetExitError({ item: web, mode: 'shell' }, 127, '')).toEqual({ code: 'ssh.noShellInContainer' });
    expect(targetExitError({ item: web, mode: 'logs' }, 1, 'No such container: web-1')).toEqual({ code: 'ssh.containerNotFound', params: { name: 'web-1' } });
    expect(targetExitError({ item: { kind: 'vm', vmid: 100, name: 'w' }, mode: 'shell' }, 255, 'unable to find a serial interface')).toEqual({ code: 'ssh.serialConsoleUnavailable' });
    expect(targetExitError({ item: web, mode: 'shell' }, 130, '')).toBeUndefined();
  });
  it('stays silent once the user typed or without a serial hint', () => {
    expect(targetExitError({ item: web, mode: 'shell' }, 127, '', true)).toBeUndefined();
    expect(targetExitError({ item: web, mode: 'shell' }, 1, 'No such container: x', true)).toBeUndefined();
    expect(targetExitError({ item: { kind: 'vm', vmid: 100, name: 'w' }, mode: 'shell' }, 255, 'connection lost')).toBeUndefined();
  });
});

describe.runIf(process.platform === 'win32')('local container tabs', () => {
  it('starts docker exec through node-pty with an argument array', async () => {
    const spawned: { file: string; args: string[] | string }[] = [];
    const localEvents: SshEvent[] = [];
    let exit: ((event: { exitCode: number }) => void) | undefined;
    const pty = { onData: () => ({ dispose() {} }), onExit: (listener: typeof exit) => { exit = listener; return { dispose() {} }; },
      write() {}, resize() {}, kill() {}, pause() {}, resume() {} };
    const local = new SshSessionManager({ getConnection: () => { throw new Error('no vault lookups'); },
      verifyHost: async () => true, locate: async command => `C:\\bin\\${command}.exe`, emit: (_owner, event) => localEvents.push(event),
      spawnShell: (file, args) => { spawned.push({ file, args }); return pty as never; } });
    const id = local.prepare(1, { connectionId: LOCAL_CONTAINER_HOST, cols: 80, rows: 24, target: { item: { kind: 'container', runtime: 'docker', ref: 'web-1', name: 'web-1' }, mode: 'shell' } }).sessionId;
    await local.connect(1, id);
    expect(spawned).toEqual([{ file: 'C:\\bin\\docker.exe', args: ['exec', '-it', 'web-1', 'sh', '-c', 'command -v bash >/dev/null 2>&1 && exec bash || exec sh'] }]);
    exit?.({ exitCode: 127 });
    expect(localEvents).toContainEqual(expect.objectContaining({ status: 'error', error: { code: 'ssh.noShellInContainer' } }));
  });
});

describe('SSH agent socket selection', () => {
  it('uses OpenSSH on Windows and respects SSH_AUTH_SOCK', () => {
    expect(agentSocket('win32', '')).toBe('\\\\.\\pipe\\openssh-ssh-agent');
    expect(agentSocket('linux', '/synthetic/agent.sock')).toBe('/synthetic/agent.sock');
    expect(() => agentSocket('linux', '')).toThrow(expect.objectContaining({ code: 'ssh.noAgent' }));
  });
});

describe('publicError', () => {
  it('passes coded errors through unchanged', () => {
    expect(publicError(new AppError('ssh.notAvailable'))).toEqual({ code: 'ssh.notAvailable' });
    expect(publicError(new HostKeyError('ssh.hostKeyChanged'))).toEqual({ code: 'ssh.hostKeyChanged' });
    expect(publicError(new AppError('ssh.startFolderMissing', { folder: 'x' }))).toEqual({ code: 'ssh.startFolderMissing', params: { folder: 'x' } });
  });
  it('maps library errors to ssh codes and never leaks library text', () => {
    const errno = (code: string) => Object.assign(new Error('secret library text'), { code });
    expect(publicError(errno('ENOENT'))).toEqual({ code: 'ssh.keyFileUnreadable' });
    expect(publicError(errno('EACCES'))).toEqual({ code: 'ssh.keyFileUnreadable' });
    expect(publicError(errno('ECONNREFUSED'))).toEqual({ code: 'ssh.connectionRefused' });
    expect(publicError(errno('ENOTFOUND'))).toEqual({ code: 'ssh.hostNotFound' });
    expect(publicError(errno('EAI_AGAIN'))).toEqual({ code: 'ssh.hostNotFound' });
    expect(publicError(errno('ETIMEDOUT'))).toEqual({ code: 'ssh.timeout' });
    expect(publicError(Object.assign(new Error('x'), { level: 'client-authentication' }))).toEqual({ code: 'ssh.authFailed' });
    expect(publicError(Object.assign(new Error('x'), { level: 'client-timeout' }))).toEqual({ code: 'ssh.timeout' });
    expect(publicError(new Error('secret library text'))).toEqual({ code: 'ssh.failed' });
    expect(publicError(undefined)).toEqual({ code: 'ssh.failed' });
  });
});
