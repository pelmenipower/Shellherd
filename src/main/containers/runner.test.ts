import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { Client, Server } from 'ssh2';
import type { Connection, ServerChannel } from 'ssh2';
import type { SshConnectionNode } from '../../shared/vault/types';
import { remoteCommand } from './commands';
import { BATCH_TOO_LARGE, describeFailure } from './parsers';
import { HostAccessError, openRemoteHost, runLocal } from './runner';

const hostKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });
let server: Server;
let peers: Connection[];
let commands: string[];
let stdinSeen: string[];
let connection: SshConnectionNode;

const SUDO_PASSWORD = 'synthetic-sudo-secret';
const MARKER = '[terminus-sudo-0123456789abcdef]';
const READY = '[terminus-ready-0123456789abcdef]';
const sudoCommand = (...argv: string[]) => remoteCommand(argv, { kind: 'prompt', marker: MARKER, ready: READY, stdin: true });
const prompt = (password = SUDO_PASSWORD) => ({ marker: MARKER, ready: READY, password });

/**
 * Behaves like the prompt script: `sudo -S -p MARKER -v` asks on stderr and reads a line from stdin
 * (asking again after a wrong one), then READY on stdout, then the command.
 */
function simulateSudo(stream: ServerChannel, command: string): void {
  const marker = /\[terminus-sudo-[0-9a-f]{16}\]/.exec(command)![0];
  const ready = /\[terminus-ready-[0-9a-f]{16}\]/.exec(command)![0];
  const finishCommand = () => { stream.write(ready); stream.write('ran\n'); stream.exit(0); stream.end(); };
  let received = '';
  stream.on('data', (data: Buffer) => {
    received += data.toString('utf8');
    stdinSeen.push(data.toString('utf8'));
    const end = received.indexOf('\n');
    if (end === -1) return;
    const line = received.slice(0, end);
    received = received.slice(end + 1);
    if (line === SUDO_PASSWORD) { finishCommand(); return; }
    stream.stderr.write(`Sorry, try again.\n${marker}`);
    setTimeout(() => { stream.exit(1); stream.end(); }, 3_000).unref();
  });
  if (command.includes('silent')) return;
  if (command.includes('nopasswd-leak')) {
    stream.write(ready);
    stream.stderr.write(`late ${marker}\n`);
    stream.write(`out ${marker}\n`);
    stream.exit(0); stream.end();
    return;
  }
  if (command.includes('nocache')) { stream.write(ready); stream.stderr.write('sudo: a password is required\n'); stream.exit(1); stream.end(); return; }
  if (command.includes('nopasswd')) { finishCommand(); return; }
  // Two writes, so detection has to work across chunks.
  stream.stderr.write(`notice\n${marker.slice(0, 7)}`);
  stream.stderr.write(marker.slice(7));
}
beforeEach(async () => {
  peers = []; commands = []; stdinSeen = [];
  server = new Server({ hostKeys: [hostKey] }, peer => {
    peers.push(peer);
    peer.on('error', () => {});
    peer.on('authentication', context => context.method === 'password' && context.password === 'synthetic-password' ? context.accept() : context.reject());
    peer.on('ready', () => peer.on('session', accept => accept().on('exec', (acceptExec, _reject, info) => {
      commands.push(info.command);
      const stream = acceptExec();
      if (info.command === 'hang') return;
      if (info.command.includes(' -v && printf')) { simulateSudo(stream, info.command); return; }
      if (info.command === 'flood') {
        let sent = 0;
        const timer = setInterval(() => {
          stream.write('x'.repeat(65_536));
          if (++sent === 4) { clearInterval(timer); stream.exit(0); stream.end(); }
        }, 20);
        return;
      }
      if (info.command === 'fail') { stream.stderr.write('boom\n'); stream.exit(3); stream.end(); return; }
      stream.write(`ran:${info.command}\n`); stream.exit(0); stream.end();
    })));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address === 'string' || !address) throw new Error('Missing server address');
  connection = { id: 'c1', type: 'connection', protocol: 'ssh', name: 'Host', host: '127.0.0.1', port: address.port,
    username: 'synthetic-user', authentication: { method: 'password', password: 'synthetic-password' }, tags: [] };
});

afterEach(async () => {
  for (const peer of peers) peer.end();
  await new Promise<void>(resolve => server.close(() => resolve()));
});

describe('openRemoteHost', () => {
  it('runs commands over one connection and reports exit codes', async () => {
    const host = await openRemoteHost(connection, async () => true);
    expect(await host.run('echo a', 5_000)).toEqual({ code: 0, stdout: 'ran:echo a\n', stderr: '' });
    expect(await host.run('fail', 5_000)).toEqual({ code: 3, stdout: '', stderr: 'boom\n' });
    expect(peers).toHaveLength(1);
    expect(commands).toEqual(['echo a', 'fail']);
    host.close();
    expect(host.closed).toBe(true);
  });
  it('times out a command without closing the host', async () => {
    const host = await openRemoteHost(connection, async () => true);
    expect(await host.run('hang', 200)).toMatchObject({ timedOut: true, code: null });
    expect((await host.run('echo b', 5_000)).code).toBe(0);
    host.close();
  });
  it('refuses an unconfirmed host key with a readable error', async () => {
    await expect(openRemoteHost(connection, async () => false)).rejects.toThrow(HostAccessError);
    await expect(openRemoteHost(connection, async () => false)).rejects.toMatchObject({ code: 'containers.hostKeyRejected' });
  });
});

describe('openRemoteHost output limit', () => {
  it('keeps at most the given limit per stream, the default 1 MiB otherwise', async () => {
    const host = await openRemoteHost(connection, async () => true);
    const limited = await host.run('flood', 5_000, undefined, 100_000);
    expect(limited.stdout.length).toBeGreaterThanOrEqual(100_000);
    expect(limited.stdout.length).toBeLessThan(262_144);
    expect((await host.run('flood', 5_000)).stdout.length).toBe(262_144);
    host.close();
  });
});

describe('openRemoteHost sudo prompts', () => {
  it('answers the prompt once, waits for readiness and keeps both markers out of the output', async () => {
    const host = await openRemoteHost(connection, async () => true);
    let readyCalls = 0;
    const result = await host.run(sudoCommand('pct', 'list'), 5_000, { ...prompt(), onReady: () => { readyCalls++; } });
    expect(result).toEqual({ code: 0, stdout: 'ran\n', stderr: 'notice\n', sudoReady: true });
    expect(readyCalls).toBe(1);
    expect(stdinSeen.join('')).toBe(`${SUDO_PASSWORD}\n`);
    expect(JSON.stringify(result)).not.toContain(SUDO_PASSWORD);
    host.close();
  });
  it('sends nothing when sudo does not ask', async () => {
    const host = await openRemoteHost(connection, async () => true);
    const result = await host.run(sudoCommand('nopasswd'), 5_000, prompt());
    expect(result).toEqual({ code: 0, stdout: 'ran\n', stderr: '', sudoReady: true });
    expect(stdinSeen).toEqual([]);
    host.close();
  });
  it('treats a prompt marker after readiness as plain text', async () => {
    const host = await openRemoteHost(connection, async () => true);
    const result = await host.run(sudoCommand('nopasswd-leak'), 5_000, prompt());
    expect(result).toEqual({ code: 0, stdout: `out ${MARKER}\n`, stderr: `late ${MARKER}\n`, sudoReady: true });
    expect(stdinSeen).toEqual([]);
    host.close();
  });
  it('stops at the second prompt and reports the rejection', async () => {
    const host = await openRemoteHost(connection, async () => true);
    const started = Date.now();
    const result = await host.run(sudoCommand('pct', 'list'), 5_000, prompt('wrong-synthetic'));
    expect(result.sudoRejected).toBe(true);
    expect(result.timedOut).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(2_500);
    expect(stdinSeen.join('')).toBe('wrong-synthetic\n');
    expect(result.stderr).not.toContain(MARKER);
    expect(JSON.stringify(result)).not.toContain('wrong-synthetic');
    expect((await host.run('echo c', 5_000)).code).toBe(0);
    host.close();
  });
  it('marks results that failed after readiness', async () => {
    const host = await openRemoteHost(connection, async () => true);
    const result = await host.run(sudoCommand('nocache'), 5_000, prompt());
    expect(result).toEqual({ code: 1, stdout: '', stderr: 'sudo: a password is required\n', sudoReady: true });
    expect(describeFailure('docker', result)).toEqual({ code: 'containers.sudoNotCached' });
    host.close();
  });
  it('reports a missing prompt on timeout and never sends the password', async () => {
    const host = await openRemoteHost(connection, async () => true);
    const result = await host.run(sudoCommand('silent'), 300, prompt());
    expect(result).toMatchObject({ timedOut: true, sudoNoPrompt: true });
    expect(stdinSeen).toEqual([]);
    host.close();
  });
});

describe('openRemoteHost failures', () => {
  it('marks an abandoned attempt as inactive when the connection fails', async () => {
    let isActive: (() => boolean) | undefined;
    connection.authentication = { method: 'password', password: 'wrong' };
    await expect(openRemoteHost(connection, async (_h, _p, _k, active) => { isActive = active; return true; })).rejects.toThrow();
    expect(isActive).toBeDefined();
    expect(isActive!()).toBe(false);
  });
});

describe('runLocal', () => {
  it('reports a missing program as notFound', async () => {
    const exec = ((_file: string, _args: string[], _options: object, callback: (error: NodeJS.ErrnoException | null, stdout: string, stderr: string) => void) => {
      callback(Object.assign(new Error('spawn docker ENOENT'), { code: 'ENOENT' }), '', '');
    }) as never;
    expect(await runLocal('docker', ['ps'], 1_000, exec)).toEqual({ code: null, stdout: '', stderr: '', notFound: true });
  });
  it('returns output and exit code', async () => {
    const exec = ((_file: string, _args: string[], _options: object, callback: (error: (Error & { code?: number }) | null, stdout: string, stderr: string) => void) => {
      callback(Object.assign(new Error('failed'), { code: 2 }), 'out', 'err');
    }) as never;
    expect(await runLocal('docker', ['ps'], 1_000, exec)).toEqual({ code: 2, stdout: 'out', stderr: 'err' });
  });
  it('reports a killed process as timedOut', async () => {
    const exec = ((_f: string, _a: string[], _o: object, callback: (error: object | null, stdout: string, stderr: string) => void) => {
      callback(Object.assign(new Error('timeout'), { killed: true }), 'partial', '');
    }) as never;
    expect(await runLocal('docker', ['ps'], 1_000, exec)).toEqual({ code: null, stdout: 'partial', stderr: '', timedOut: true });
  });
  it('reports exceeded output as a failure, not a timeout', async () => {
    const exec = ((_f: string, _a: string[], _o: object, callback: (error: object | null, stdout: string, stderr: string) => void) => {
      callback(Object.assign(new Error('maxBuffer'), { killed: true, code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }), 'big', '');
    }) as never;
    expect(await runLocal('docker', ['ps'], 1_000, exec)).toEqual({ code: null, stdout: 'big', stderr: BATCH_TOO_LARGE });
  });
});

describe('RemoteHost.forward', () => {
  /** Fake ssh2 client: ready on connect, forwardOut answered by the given handler. */
  function openFakeHost(forwardOut: (...args: unknown[]) => void) {
    const fake = Object.assign(new EventEmitter(), {
      connect() { setImmediate(() => fake.emit('ready')); },
      forwardOut,
      end() {},
      destroy() {},
    });
    return openRemoteHost(connection, async () => true, () => fake as unknown as Client);
  }
  it('forwards a channel to the target through the SSH connection', async () => {
    const calls: unknown[][] = [];
    const channel = new PassThrough();
    const host = await openFakeHost((...args: unknown[]) => { calls.push(args.slice(0, 4)); (args[4] as (e: Error | undefined, s: unknown) => void)(undefined, channel); });
    await expect(host.forward('10.0.0.5', 6443)).resolves.toBe(channel);
    expect(calls).toEqual([['127.0.0.1', 0, '10.0.0.5', 6443]]);
  });
  it('rejects forward with a readable error when the server refuses', async () => {
    const host = await openFakeHost((...args: unknown[]) => (args[4] as (e: Error) => void)(new Error('Connection refused')));
    await expect(host.forward('10.0.0.5', 6443)).rejects.toMatchObject({ code: 'containers.apiUnreachable', params: { host: '10.0.0.5', port: 6443 } });
  });
});
