import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Server, utils } from 'ssh2';
import type { ConnectionNode } from '../shared/vault/types';
import { testConnection } from './connection-test';

const trust = { verifyHost: async () => true, resolve: async () => '127.0.0.1' };

describe('connection test (dry run)', () => {
  let server: Server;
  let port: number;
  beforeAll(async () => {
    server = new Server({ hostKeys: [utils.generateKeyPairSync('ed25519').private] }, client => {
      client.on('authentication', context => context.method === 'password' && context.password === 'synthetic-secret' ? context.accept() : context.reject(['password']));
      client.on('ready', () => client.on('session', accept => accept().on('sftp', acceptSftp => { acceptSftp(); })));
      client.on('error', () => {});
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => { server.close(); });

  const node = (protocol: 'ssh' | 'sftp', password: string): ConnectionNode => ({ id: 'x', type: 'connection', protocol, name: 'Test', host: '127.0.0.1', port,
    username: 'synthetic-user', authentication: { method: 'password', password }, tags: [] });

  it('walks through every step of a working SFTP connection', async () => {
    const result = await testConnection(node('sftp', 'synthetic-secret'), trust);
    expect(result.steps.map(step => [step.step, step.ok])).toEqual([
      ['nameResolved', true], ['portReachable', true], ['hostKey', true], ['login', true], ['sftp', true]]);
    expect(result.steps[1]).toMatchObject({ params: { port } });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain('synthetic-secret');
  });

  it('stops at the failing step: wrong password, refused port, unknown host, distrusted key', async () => {
    const wrong = await testConnection(node('ssh', 'wrong'), trust);
    expect(wrong.ok).toBe(false);
    expect(wrong.steps.at(-1)).toMatchObject({ step: 'login', ok: false, note: { code: 'ssh.authFailed' } });

    const closed = createServer();
    await new Promise<void>(resolve => closed.listen(0, '127.0.0.1', () => resolve()));
    const closedPort = (closed.address() as AddressInfo).port;
    await new Promise<void>(resolve => closed.close(() => resolve()));
    const refused = await testConnection({ ...node('ssh', 'x'), port: closedPort } as ConnectionNode, trust);
    expect(refused.steps.at(-1)).toMatchObject({ step: 'portReachable', params: { port: closedPort }, ok: false, note: { code: 'core.testConnectionRefused' } });

    const unknown = await testConnection(node('ssh', 'x'), { ...trust, resolve: async () => { throw Object.assign(new Error(), { code: 'ENOTFOUND' }); } });
    expect(unknown.steps).toEqual([{ step: 'nameResolved', ok: false, note: { code: 'core.testHostUnknown' } }]);

    const distrusted = await testConnection(node('ssh', 'synthetic-secret'), { ...trust, verifyHost: async () => false });
    expect(distrusted.steps.at(-1)).toMatchObject({ step: 'hostKey', ok: false, note: { code: 'core.testHostKeyRejected' } });
  });

  it('checks RDP reachability and local shells without connecting', async () => {
    const rdp: ConnectionNode = { id: 'r', type: 'connection', protocol: 'rdp', name: 'R', host: 'desk.test', port: 3389, rdp: { clipboard: true }, tags: [] };
    const reachable = await testConnection(rdp, { ...trust, probePort: async () => {} });
    expect(reachable.ok).toBe(true);
    expect(reachable.steps.map(step => step.step)).toEqual(['nameResolved', 'portReachable', 'login']);
    expect(reachable.steps[2]).toMatchObject({ note: { code: 'core.testRdpCredentials' } });
    const shell = await testConnection({ id: 'p', type: 'connection', protocol: 'cmd', name: 'C', workingDirectory: 'Z:\\does-not-exist', tags: [] }, trust);
    expect(shell.steps[0]).toMatchObject({ step: 'startFolder', ok: false, note: { code: 'core.testFolderMissing', params: { path: 'Z:\\does-not-exist' } } });
  });
});

describe('connection test explanations', () => {
  it('reports missing input as coded notes without prose in detail', async () => {
    const noHost = await testConnection({ id: 'h', type: 'connection', protocol: 'ssh', name: 'H', host: ' ', port: 22, username: 'u',
      authentication: { method: 'password', password: 'x' }, tags: [] }, trust);
    expect(noHost.steps).toEqual([{ step: 'hostGiven', ok: false, note: { code: 'core.testHostMissing' } }]);
    const noUser = await testConnection({ id: 'u', type: 'connection', protocol: 'ssh', name: 'U', host: 'h.test', port: 22, username: '',
      authentication: { method: 'password', password: 'x' }, tags: [] }, trust);
    expect(noUser.steps.at(-1)).toEqual({ step: 'userGiven', ok: false, note: { code: 'core.testUserMissing' } });
  });

  it('names the tool by brand and explains how to install it', async () => {
    const missing = await testConnection({ id: 'a', type: 'connection', protocol: 'aicli', name: 'A', tool: 'claude', tags: [] } as ConnectionNode,
      { ...trust, locate: async () => null });
    const tool = missing.steps.at(-1)!;
    expect(tool).toMatchObject({ step: 'toolFound', ok: false, note: { code: 'core.testNotInstalled' } });
    expect(tool.params).toEqual({ tool: expect.any(String) });
    expect(tool.note?.params).toEqual({ install: expect.any(String) });
  });
});
