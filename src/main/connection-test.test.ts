import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { PassThrough } from 'node:stream';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Client, Server, utils } from 'ssh2';
import { AppError } from '../shared/errors';
import type { ConnectionNode } from '../shared/vault/types';
import { testConnection } from './connection-test';
import type { Jump } from './ssh/jump';

const trust = { verifyHost: async () => true, resolve: async () => '127.0.0.1' };
/** Replaces the socket handshake: `run` plays the events a server would send. */
const fakeConnect = (run: () => void = () => {}) => vi.spyOn(Client.prototype, 'connect')
  .mockImplementation(function (this: Client) { run(); return this; });

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

  it('does not count the host key dialog against the timeout', async () => {
    const slow = { ...trust, timeout: 1_000, verifyHost: () => new Promise<boolean>(resolve => setTimeout(() => resolve(true), 2_000)) };
    const result = await testConnection(node('ssh', 'synthetic-secret'), slow);
    expect(result.steps.map(step => [step.step, step.ok])).toEqual([['nameResolved', true], ['portReachable', true], ['hostKey', true], ['login', true]]);
  });

  it('keeps its own timer and no keepalive whatever the connection overrides', async () => {
    const connect = vi.spyOn(Client.prototype, 'connect');
    try {
      const overridden = { ...node('ssh', 'synthetic-secret'), timeouts: { connectSeconds: 5, keepaliveSeconds: 5 } } as ConnectionNode;
      await testConnection(overridden, trust);
      expect(connect).toHaveBeenCalledWith(expect.objectContaining({ readyTimeout: 120_000, keepaliveInterval: 0 }));
    } finally { connect.mockRestore(); }
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

describe('connection test through a jump host', () => {
  const jumped = (): ConnectionNode => ({ id: 'j', type: 'connection', protocol: 'ssh', name: 'J', host: 'target.internal', port: 22,
    username: 'synthetic-user', authentication: { method: 'password', password: 'synthetic-secret' }, jumpHost: 'bastion-id', tags: [] } as ConnectionNode);
  // The far side resolves the target, so a local lookup must never run.
  const noLookup = { ...trust, resolve: async (): Promise<string> => { throw new Error('local lookup'); } };
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it('opens the jump host first and skips the local name lookup', async () => {
    const bastion: Jump = { name: 'Bastion', sock: new PassThrough(), close: vi.fn() };
    let client: Client | undefined;
    const connect = fakeConnect(() => { client?.emit('connect'); client?.emit('ready'); });
    const openJump = vi.fn(async () => bastion);
    const result = await testConnection(jumped(), { ...noLookup, openJump, createClient: () => (client = new Client()) });
    expect(openJump).toHaveBeenCalledOnce();
    expect(result.steps.map(step => [step.step, step.ok])).toEqual([['jumpHost', true], ['portReachable', true], ['login', true]]);
    expect(result.steps[0]).toMatchObject({ params: { name: 'Bastion' } });
    expect(connect).toHaveBeenCalledWith(expect.objectContaining({ sock: bastion.sock }));
    expect(bastion.close).toHaveBeenCalledOnce();
  });

  it('stops after a failed jump host without connecting to the target', async () => {
    const connect = fakeConnect();
    const openJump = async (): Promise<Jump | undefined> => { throw new AppError('ssh.jumpHostFailed', { name: 'bastion-id' }); };
    const result = await testConnection(jumped(), { ...noLookup, openJump });
    expect(result.ok).toBe(false);
    expect(result.steps).toEqual([{ step: 'jumpHost', ok: false, params: { name: 'bastion-id' }, note: { code: 'ssh.jumpHostFailed', params: { name: 'bastion-id' } } }]);
    expect(connect).not.toHaveBeenCalled();
  });

  it('does not count a sign-in question against the timeout', async () => {
    vi.useFakeTimers();
    const bastion: Jump = { name: 'Bastion', sock: new PassThrough(), close: vi.fn() };
    let client!: Client;
    fakeConnect(() => { client.emit('connect'); });
    let answer!: (values: string[] | null) => void;
    const ask = vi.fn(() => new Promise<string[] | null>(resolve => { answer = resolve; }));
    const run = testConnection(jumped(), { ...noLookup, timeout: 1_000, ask, openJump: async () => bastion,
      createClient: () => (client = new Client()) });
    await vi.advanceTimersByTimeAsync(10);
    client.emit('keyboard-interactive', '', '', '', [{ prompt: 'Code: ', echo: true }], vi.fn());
    await vi.advanceTimersByTimeAsync(5_000);
    expect(ask).toHaveBeenCalledOnce();
    answer(['123456']);
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await run;
    expect(result.steps.at(-1)).toMatchObject({ step: 'hostKey', ok: false });
    expect(bastion.close).toHaveBeenCalledOnce();
  });

  it('passes the keyboard prompts only when the test can answer them', async () => {
    const connect = fakeConnect();
    await testConnection(node('ssh', 'x'), { ...trust, timeout: 50 });
    expect(connect.mock.calls[0][0]).toMatchObject({ tryKeyboard: false });
    await testConnection(node('ssh', 'x'), { ...trust, timeout: 50, ask: async () => null });
    expect(connect.mock.calls[1][0]).toMatchObject({ tryKeyboard: true });
  });
});

const node = (protocol: 'ssh' | 'sftp', password: string): ConnectionNode => ({ id: 'x', type: 'connection', protocol, name: 'Test', host: '127.0.0.1', port: 22,
  username: 'synthetic-user', authentication: { method: 'password', password }, tags: [] });
