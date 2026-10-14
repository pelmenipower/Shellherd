import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Server } from 'ssh2';
import type { Connection, ServerChannel, PseudoTtyOptions } from 'ssh2';
import type { SshConnectionNode } from '../../shared/vault/types';
import type { SshEvent } from '../../shared/ssh';
import { agentSocket, SshSessionManager, targetExitMessage } from './session';
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
  const prompt = () => {
    // Two writes, so detection has to work across chunks.
    stream.write(`notice\r\n${marker.slice(0, 9)}`);
    stream.write(marker.slice(9));
  };
  if (command.includes('sudo-quiet')) { stream.write('starting\r\n'); quietPrompt = prompt; return; }
  prompt();
}
let quietPrompt: (() => void) | undefined;

beforeEach(async () => {
  events = []; peers = []; shell = undefined; shells = []; execCommands = []; sudoInput = []; size = undefined; autoAck = true; quietPrompt = undefined;
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
    manager = new SshSessionManager({ getConnection: () => connection, spawnShell: noShell,
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
    expect(events).toContainEqual(expect.objectContaining({ type: 'status', status: 'error', message: 'Das sudo-Passwort wurde abgelehnt.' }));
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
    expect(events).toContainEqual(expect.objectContaining({ status: 'error', message: 'Das Passwort enthält einen Zeilenumbruch und kann nicht für sudo verwendet werden.' }));
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
    expect(events).toContainEqual(expect.objectContaining({ status: 'error', message: 'Das sudo-Passwort wurde abgelehnt.' }));
    expect(execCommands).toHaveLength(1);
    expect(peers).toHaveLength(1);
    expect(sudoInput.join('')).toBe('synthetic-password\n');
  });

  it('honours a rejection recorded by the container list', async () => {
    sudoRejections.markRejected(connection.id, connectionFingerprint(connection));
    await manager.connect(1, sudoTab('web-1'));
    await waitFor(() => hasStatus('error'));
    expect(events).toContainEqual(expect.objectContaining({ status: 'error', message: 'Das sudo-Passwort wurde abgelehnt.' }));
    expect(peers).toHaveLength(0);
  });

  it('explains a server that does not cache sudo credentials', async () => {
    await manager.connect(1, sudoTab('sudo-nocache'));
    await waitFor(() => hasStatus('error'));
    expect(events).toContainEqual(expect.objectContaining({ status: 'error', message: 'sudo speichert die Anmeldung nicht zwischen (timestamp_timeout=0). Richte NOPASSWD ein.' }));
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
    expect(events).toContainEqual(expect.objectContaining({ type: 'status', status: 'error', message: 'Container „missing“ wurde nicht gefunden.' }));
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
    expect(() => manager.prepare(1, { connectionId: connection.id, cols: 80, rows: 24, target: { item: { ...web, ref: '$(id)' }, mode: 'shell' } })).toThrow('Ungültige Container-Angabe.');
    expect(() => manager.prepare(1, { connectionId: LOCAL_CONTAINER_HOST, cols: 80, rows: 24 })).toThrow();
  });
});

describe('targetExitMessage', () => {
  const web = { kind: 'container' as const, runtime: 'docker' as const, ref: 'web-1', name: 'web-1' };
  it('explains failed container commands', () => {
    expect(targetExitMessage({ item: web, mode: 'shell' }, 0, '')).toBeUndefined();
    expect(targetExitMessage({ item: web, mode: 'shell' }, 127, '')).toBe('Keine Shell im Container gefunden.');
    expect(targetExitMessage({ item: web, mode: 'logs' }, 1, 'No such container: web-1')).toBe('Container „web-1“ wurde nicht gefunden.');
    expect(targetExitMessage({ item: { kind: 'vm', vmid: 100, name: 'w' }, mode: 'shell' }, 255, 'unable to find a serial interface')).toContain('Serielle Schnittstelle');
    expect(targetExitMessage({ item: web, mode: 'shell' }, 130, '')).toBeUndefined();
  });
  it('stays silent once the user typed or without a serial hint', () => {
    expect(targetExitMessage({ item: web, mode: 'shell' }, 127, '', true)).toBeUndefined();
    expect(targetExitMessage({ item: web, mode: 'shell' }, 1, 'No such container: x', true)).toBeUndefined();
    expect(targetExitMessage({ item: { kind: 'vm', vmid: 100, name: 'w' }, mode: 'shell' }, 255, 'connection lost')).toBeUndefined();
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
    expect(localEvents).toContainEqual(expect.objectContaining({ status: 'error', message: 'Keine Shell im Container gefunden.' }));
  });
});

describe('SSH agent socket selection', () => {
  it('uses OpenSSH on Windows and respects SSH_AUTH_SOCK', () => {
    expect(agentSocket('win32', '')).toBe('\\\\.\\pipe\\openssh-ssh-agent');
    expect(agentSocket('linux', '/synthetic/agent.sock')).toBe('/synthetic/agent.sock');
    expect(() => agentSocket('linux', '')).toThrow('SSH-Agent');
  });
});
