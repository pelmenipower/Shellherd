import { generateKeyPairSync } from 'node:crypto';
import { Server } from 'ssh2';
import type { Connection, ServerChannel } from 'ssh2';
import type { AddressInfo } from 'node:net';
import { expect, it } from 'vitest';
import { SshSessionManager } from './session';
import { ToolbarItemSchema } from '../../shared/toolbar';
import type { ToolbarConfig } from '../../shared/toolbar';
import type { SshEvent } from '../../shared/ssh';
import type { SshConnectionNode } from '../../shared/vault/types';

const wait = async (predicate: () => boolean) => { const start = Date.now(); while (!predicate()) { if (Date.now() - start > 4000) throw new Error('test timeout'); await new Promise(resolve => setTimeout(resolve, 10)); } };
it('uses an independent channel on the owned SSH session without leaking checks to the terminal', async () => {
  const peers: Connection[] = [];
  const commands: string[] = [], input: string[] = [];
  let terminal: ServerChannel | undefined;
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });
  const server = new Server({ hostKeys: [key] }, peer => {
    peers.push(peer); peer.on('error', () => {});
    peer.on('authentication', context => context.method === 'password' && context.password === 'synthetic' ? context.accept() : context.reject());
    peer.on('ready', () => peer.on('session', accept => {
      const session = accept();
      session.on('pty', accept => accept());
      session.on('shell', accept => { terminal = accept(); terminal.on('error', () => {}); terminal.write('terminal-ready'); terminal.on('data', (data: Buffer) => input.push(data.toString())); });
      session.on('exec', (accept, _reject, info) => { commands.push(info.command); const stream = accept(); stream.on('error', () => {}); stream.write('{"value":"banana","message":"service running","extra":42}'); stream.exit(0); stream.end(); });
    }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const node: SshConnectionNode = { id: 'ssh', type: 'connection', protocol: 'ssh', name: 'Synthetic', host: '127.0.0.1', port: (server.address() as AddressInfo).port, username: 'test', authentication: { method: 'password', password: 'synthetic' }, tags: [] };
  const item = ToolbarItemSchema.parse({ id: '11111111-1111-4111-8111-111111111111', kind: 'status', name: 'Service', command: '/opt/check.sh', description: '', enabled: true, showText: true, confirm: false,
    icon: 'server', color: '#ffffff', text: '', trigger: 'click', intervalMs: 1000, timeoutMs: 2000, mappings: [], unknown: { icon: 'warning', color: '#aaaaaa', text: '?' } });
  const config: ToolbarConfig = { mode: 'type', items: [item] };
  const events: SshEvent[] = [];
  let allowed = true;
  const manager = new SshSessionManager({ getConnection: () => node, getToolbar: () => config, toolbarAllowed: () => allowed, verifyHost: async () => true,
    spawnShell: () => { throw new Error('no local shell'); }, emit: (owner, event) => { events.push(event); if (event.type === 'data') manager.acknowledge(owner, event.sessionId, event.sequence); } });
  try {
    const { sessionId } = manager.prepare(1, { connectionId: node.id, cols: 80, rows: 24 });
    await manager.connect(1, sessionId);
    await wait(() => !!terminal && events.some(event => event.type === 'status' && event.status === 'connected'));
    expect(() => manager.toolbar(2, sessionId, 'start')).toThrow();
    manager.toolbar(1, sessionId, 'start'); manager.toolbar(1, sessionId, 'check', item.id);
    await wait(() => events.some(event => event.type === 'toolbar' && event.result.state === 'ok'));
    expect(peers).toHaveLength(1);
    expect(commands).toEqual(['/opt/check.sh']);
    expect(input).toEqual([]);
    const visible = Buffer.concat(events.filter(event => event.type === 'data').map(event => Buffer.from(event.data))).toString();
    expect(visible).not.toContain('banana'); expect(visible).not.toContain('/opt/check.sh');
    expect(events).toContainEqual(expect.objectContaining({ type: 'toolbar', result: expect.objectContaining({ value: 'banana', message: 'service running' }) }));
    await manager.input(1, sessionId, 'echo still-interactive\r');
    await wait(() => input.length === 1);
    allowed = false; manager.stopToolbars();
    expect(() => manager.toolbar(1, sessionId, 'check', item.id)).toThrow();
    expect(() => manager.close(2, sessionId)).toThrow();
  } finally {
    manager.closeAll(); peers.forEach(peer => peer.end());
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
