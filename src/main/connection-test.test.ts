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
    expect(result.steps.map(step => [step.label, step.ok])).toEqual([
      ['Name aufgelöst', true], [`Port ${port} erreichbar`, true], ['Server-Schlüssel geprüft', true], ['Anmeldung', true], ['SFTP verfügbar', true]]);
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain('synthetic-secret');
  });

  it('stops at the failing step: wrong password, refused port, unknown host, distrusted key', async () => {
    const wrong = await testConnection(node('ssh', 'wrong'), trust);
    expect(wrong.ok).toBe(false);
    expect(wrong.steps.at(-1)).toMatchObject({ label: 'Anmeldung', ok: false });

    const closed = createServer();
    await new Promise<void>(resolve => closed.listen(0, '127.0.0.1', () => resolve()));
    const closedPort = (closed.address() as AddressInfo).port;
    await new Promise<void>(resolve => closed.close(() => resolve()));
    const refused = await testConnection({ ...node('ssh', 'x'), port: closedPort } as ConnectionNode, trust);
    expect(refused.steps.at(-1)).toMatchObject({ label: `Port ${closedPort} erreichbar`, ok: false, detail: expect.stringContaining('lehnt') });

    const unknown = await testConnection(node('ssh', 'x'), { ...trust, resolve: async () => { throw Object.assign(new Error(), { code: 'ENOTFOUND' }); } });
    expect(unknown.steps).toEqual([{ label: 'Name aufgelöst', ok: false, detail: expect.stringContaining('unbekannt') }]);

    const distrusted = await testConnection(node('ssh', 'synthetic-secret'), { ...trust, verifyHost: async () => false });
    expect(distrusted.steps.at(-1)).toMatchObject({ label: 'Server-Schlüssel geprüft', ok: false });
  });

  it('checks RDP reachability and local shells without connecting', async () => {
    const rdp: ConnectionNode = { id: 'r', type: 'connection', protocol: 'rdp', name: 'R', host: 'desk.test', port: 3389, rdp: { clipboard: true }, tags: [] };
    const reachable = await testConnection(rdp, { ...trust, probePort: async () => {} });
    expect(reachable.ok).toBe(true);
    expect(reachable.steps.map(step => step.label)).toEqual(['Name aufgelöst', 'Port 3389 erreichbar', 'Anmeldung']);
    const shell = await testConnection({ id: 'p', type: 'connection', protocol: 'cmd', name: 'C', workingDirectory: 'Z:\\does-not-exist', tags: [] }, trust);
    expect(shell.steps[0]).toMatchObject({ label: 'Startordner vorhanden', ok: false });
  });
});
