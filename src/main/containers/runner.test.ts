import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { Server } from 'ssh2';
import type { Connection } from 'ssh2';
import type { SshConnectionNode } from '../../shared/vault/types';
import { HostAccessError, openRemoteHost, runLocal } from './runner';

const hostKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });
let server: Server;
let peers: Connection[];
let commands: string[];
let connection: SshConnectionNode;

beforeEach(async () => {
  peers = []; commands = [];
  server = new Server({ hostKeys: [hostKey] }, peer => {
    peers.push(peer);
    peer.on('error', () => {});
    peer.on('authentication', context => context.method === 'password' && context.password === 'synthetic-password' ? context.accept() : context.reject());
    peer.on('ready', () => peer.on('session', accept => accept().on('exec', (acceptExec, _reject, info) => {
      commands.push(info.command);
      const stream = acceptExec();
      if (info.command === 'hang') return;
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
    await expect(openRemoteHost(connection, async () => false)).rejects.toThrow('Der Server-Schlüssel wurde nicht bestätigt.');
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
});
