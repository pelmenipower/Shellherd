import { EventEmitter } from 'node:events';
import { connect, createServer } from 'node:net';
import type { AddressInfo, Socket } from 'node:net';
import { Duplex, PassThrough } from 'node:stream';
import type { Client } from 'ssh2';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ForwardStatus } from '../../shared/ssh';
import type { PortForward } from '../../shared/vault/types';
import { ForwardRegistry, SessionForwards } from './forwards';

/** A channel as the server sees it: `sent` holds what we write, `received` what the server sends back. */
interface FakeChannel { channel: Duplex; sent: PassThrough; received: PassThrough }

function fakeChannel(): FakeChannel {
  const sent = new PassThrough();
  const received = new PassThrough();
  return { channel: Duplex.from({ writable: sent, readable: received }), sent, received };
}

/** Records forwarding calls; forwardOut hands out a channel per call. */
class FakeClient extends EventEmitter {
  channels: FakeChannel[] = [];
  forwardCalls: string[] = [];
  forwardedIn: number[] = [];
  unforwarded: number[] = [];
  refuseOut = false;
  refuseIn = false;

  forwardOut(_src: string, _srcPort: number, host: string, port: number, callback: (error: Error | undefined, channel?: Duplex) => void): this {
    this.forwardCalls.push(`${host}:${port}`);
    if (this.refuseOut) { callback(new Error('refused')); return this; }
    const fake = fakeChannel();
    this.channels.push(fake);
    callback(undefined, fake.channel);
    return this;
  }
  forwardIn(_address: string, port: number, callback: (error: Error | undefined, port: number) => void): this {
    if (this.refuseIn) { callback(new Error('refused'), 0); return this; }
    this.forwardedIn.push(port);
    callback(undefined, port);
    return this;
  }
  unforwardIn(_address: string, port: number, callback?: () => void): this {
    this.unforwarded.push(port);
    callback?.();
    return this;
  }
}

const asClient = (fake: FakeClient) => fake as unknown as Client;
const LOCAL = (localPort: number, auto = false, id = 'f-local'): PortForward => ({ id, kind: 'local', localPort, targetHost: 'db.internal', targetPort: 5432, auto });
const DYNAMIC = (localPort: number): PortForward => ({ id: 'f-dyn', kind: 'dynamic', localPort, auto: false });
const REMOTE = (remotePort: number): PortForward => ({ id: 'f-remote', kind: 'remote', remotePort, targetHost: 'web.internal', targetPort: 8080, auto: false });

const sessions: SessionForwards[] = [];
afterEach(() => { for (const session of sessions.splice(0)) session.stopAll(); });

function session(client: FakeClient, forwards: PortForward[], options: { registry?: ForwardRegistry; emit?: (list: ForwardStatus[]) => void; connect?: typeof connect; sessionId?: string } = {}): SessionForwards {
  const created = new SessionForwards({
    client: asClient(client), connectionId: 'c1', sessionId: options.sessionId ?? 's1', forwards,
    registry: options.registry ?? new ForwardRegistry(), emit: options.emit ?? (() => undefined), connect: options.connect,
  });
  sessions.push(created);
  return created;
}

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  return port;
}

/** Reads exactly `bytes` from a socket. */
function take(socket: Socket, bytes: number): Promise<Buffer> {
  return new Promise(resolve => {
    let received = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      received = Buffer.concat([received, chunk]);
      if (received.length >= bytes) { socket.off('data', onData); resolve(received); }
    };
    socket.on('data', onData);
  });
}

const connected = (port: number): Promise<Socket> => new Promise(resolve => {
  const socket = connect(port, '127.0.0.1', () => resolve(socket));
  socket.on('error', () => undefined);
});

describe('local forward', () => {
  it('relays a local port through a forwarded channel and reports active, then stopped', async () => {
    const client = new FakeClient();
    const port = await freePort();
    const emitted: ForwardStatus[][] = [];
    const forwards = session(client, [LOCAL(port)], { emit: list => emitted.push(list) });
    await forwards.start('f-local');
    expect(forwards.list()[0]).toMatchObject({ id: 'f-local', kind: 'local', state: 'active', localPort: port, targetHost: 'db.internal', targetPort: 5432, open: 0 });
    expect(emitted.at(-1)?.[0].state).toBe('active');

    const socket = await connected(port);
    socket.write('ping');
    await vi.waitFor(() => expect(client.channels).toHaveLength(1));
    expect(client.forwardCalls).toEqual(['db.internal:5432']);
    const received = new Promise<string>(resolve => client.channels[0].sent.once('data', chunk => resolve(String(chunk))));
    expect(await received).toBe('ping');
    await vi.waitFor(() => expect(forwards.busy()).toBe(true));
    expect(forwards.list()[0].open).toBe(1);

    forwards.stop('f-local');
    expect(forwards.list()[0].state).toBe('stopped');
    expect(forwards.busy()).toBe(false);
    await expect(new Promise((_, reject) => { const again = connect(port, '127.0.0.1'); again.once('error', reject); })).rejects.toThrow();
    socket.destroy();
  });

  it('maps a taken local port to ssh.forwardPortInUse and keeps the error in the state', async () => {
    const blocker = createServer();
    await new Promise<void>(resolve => blocker.listen(0, '127.0.0.1', resolve));
    const port = (blocker.address() as AddressInfo).port;
    const forwards = session(new FakeClient(), [LOCAL(port)]);
    await expect(forwards.start('f-local')).rejects.toMatchObject({ code: 'ssh.forwardPortInUse', params: { port } });
    expect(forwards.list()[0]).toMatchObject({ state: 'error', error: { code: 'ssh.forwardPortInUse', params: { port } } });
    blocker.close();
  });

  it('startAuto starts automatic forwards with a free key and keeps errors in the state instead of throwing', async () => {
    const registry = new ForwardRegistry();
    const free = await freePort();
    const blocker = createServer();
    await new Promise<void>(resolve => blocker.listen(0, '127.0.0.1', resolve));
    const taken = (blocker.address() as AddressInfo).port;
    const held = await freePort();
    const manual = await freePort();
    registry.claim('c1:f-held', 'other');
    const forwards = session(new FakeClient(), [LOCAL(free, true, 'f-auto'), LOCAL(taken, true, 'f-busy'), LOCAL(held, true, 'f-held'), LOCAL(manual, false, 'f-manual')], { registry });
    expect(() => forwards.startAuto()).not.toThrow();
    await vi.waitFor(() => expect(forwards.list().find(entry => entry.id === 'f-busy')?.state).toBe('error'));
    const states = Object.fromEntries(forwards.list().map(entry => [entry.id, entry.state]));
    expect(states).toEqual({ 'f-auto': 'active', 'f-busy': 'error', 'f-held': 'elsewhere', 'f-manual': 'stopped' });
    blocker.close();
  });

  it('reports elsewhere when another session holds the key, and stopped again once it is released', async () => {
    const registry = new ForwardRegistry();
    const port = await freePort();
    const first = session(new FakeClient(), [LOCAL(port)], { registry, sessionId: 's1' });
    const emitted: ForwardStatus[][] = [];
    const second = session(new FakeClient(), [LOCAL(port)], { registry, sessionId: 's2', emit: list => emitted.push(list) });
    await first.start('f-local');
    await expect(second.start('f-local')).rejects.toMatchObject({ code: 'ssh.forwardElsewhere' });
    expect(second.list()[0].state).toBe('elsewhere');
    first.stop('f-local');
    expect(emitted.at(-1)?.[0].state).toBe('stopped');
  });
});

describe('dynamic forward (SOCKS5)', () => {
  it('serves SOCKS5 CONNECT and relays the bytes that follow the request', async () => {
    const client = new FakeClient();
    const port = await freePort();
    const forwards = session(client, [DYNAMIC(port)]);
    await forwards.start('f-dyn');
    expect(forwards.list()[0]).toMatchObject({ kind: 'dynamic', state: 'active', localPort: port });

    const socket = await connected(port);
    socket.write(Buffer.from([5, 1, 0]));
    expect(await take(socket, 2)).toEqual(Buffer.from([5, 0]));
    const domain = Buffer.from('db.internal');
    socket.write(Buffer.concat([Buffer.from([5, 1, 0, 3, domain.length]), domain, Buffer.from([0x15, 0x38]), Buffer.from('hi')]));
    expect(await take(socket, 10)).toEqual(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
    expect(client.forwardCalls).toEqual(['db.internal:5432']);
    const { sent, received } = client.channels[0];
    expect(await new Promise<string>(resolve => sent.once('data', chunk => resolve(String(chunk))))).toBe('hi');
    received.write('back');
    expect(String(await take(socket, 4))).toBe('back');
    socket.destroy();
  });

  it('answers 0x05 when the forward is refused', async () => {
    const client = new FakeClient();
    client.refuseOut = true;
    const port = await freePort();
    const forwards = session(client, [DYNAMIC(port)]);
    await forwards.start('f-dyn');
    const socket = await connected(port);
    socket.write(Buffer.from([5, 1, 0]));
    await take(socket, 2);
    socket.write(Buffer.from([5, 1, 0, 1, 10, 0, 0, 1, 0, 80]));
    expect((await take(socket, 10))[1]).toBe(0x05);
    socket.destroy();
  });

  it('answers 0x07 to a command other than CONNECT', async () => {
    const port = await freePort();
    const forwards = session(new FakeClient(), [DYNAMIC(port)]);
    await forwards.start('f-dyn');
    const socket = await connected(port);
    socket.write(Buffer.from([5, 1, 0]));
    await take(socket, 2);
    socket.write(Buffer.from([5, 2, 0, 1, 10, 0, 0, 1, 0, 80]));
    expect((await take(socket, 10))[1]).toBe(0x07);
    socket.destroy();
  });

  it('answers 05 FF when no authentication-free method is offered', async () => {
    const port = await freePort();
    const forwards = session(new FakeClient(), [DYNAMIC(port)]);
    await forwards.start('f-dyn');
    const socket = await connected(port);
    socket.write(Buffer.from([5, 1, 2]));
    expect(await take(socket, 2)).toEqual(Buffer.from([5, 0xff]));
    socket.destroy();
  });

  it('closes a handshake larger than 512 bytes', async () => {
    const port = await freePort();
    const forwards = session(new FakeClient(), [DYNAMIC(port)]);
    await forwards.start('f-dyn');
    const socket = await connected(port);
    const closed = new Promise(resolve => socket.once('close', resolve));
    socket.write(Buffer.concat([Buffer.from([5, 255]), Buffer.alloc(600, 1)]));
    await closed;
  });
});

describe('remote forward', () => {
  it('asks the server for the port and relays accepted connections to the target', async () => {
    const client = new FakeClient();
    const targets: string[] = [];
    const targetSockets: PassThrough[] = [];
    const fakeConnect = ((port: number, host: string) => {
      targets.push(`${host}:${port}`);
      const target = new PassThrough();
      targetSockets.push(target);
      return target;
    }) as unknown as typeof connect;
    const forwards = session(client, [REMOTE(2222)], { connect: fakeConnect });
    await forwards.start('f-remote');
    expect(client.forwardedIn).toEqual([2222]);
    expect(forwards.list()[0]).toMatchObject({ kind: 'remote', state: 'active', remotePort: 2222, targetHost: 'web.internal', targetPort: 8080 });

    const accepted: FakeChannel[] = [];
    let rejected = 0;
    const info = { srcIP: '198.51.100.7', srcPort: 5000, destIP: 'localhost', destPort: 2222 };
    client.emit('tcp connection', info, () => { const fake = fakeChannel(); accepted.push(fake); return fake.channel; }, () => { rejected++; });
    expect(targets).toEqual(['web.internal:8080']);
    expect(rejected).toBe(0);
    const received = new Promise<string>(resolve => targetSockets[0].once('data', chunk => resolve(String(chunk))));
    accepted[0].received.write('hello');
    expect(await received).toBe('hello');
    await vi.waitFor(() => expect(forwards.busy()).toBe(true));

    accepted[0].channel.destroy();
    await vi.waitFor(() => expect(forwards.busy()).toBe(false));
    forwards.stop('f-remote');
    expect(client.unforwarded).toEqual([2222]);
  });

  it('rejects connections for unknown remote ports', async () => {
    const client = new FakeClient();
    const forwards = session(client, [REMOTE(2222)], { connect: (() => new PassThrough()) as unknown as typeof connect });
    await forwards.start('f-remote');
    let rejected = 0;
    let accepted = 0;
    client.emit('tcp connection', { srcIP: 'a', srcPort: 1, destIP: 'localhost', destPort: 9999 }, () => { accepted++; return fakeChannel().channel; }, () => { rejected++; });
    expect(rejected).toBe(1);
    expect(accepted).toBe(0);
  });

  it('maps a refused forwardIn to ssh.forwardRemoteRefused', async () => {
    const client = new FakeClient();
    client.refuseIn = true;
    const forwards = session(client, [REMOTE(2222)]);
    await expect(forwards.start('f-remote')).rejects.toMatchObject({ code: 'ssh.forwardRemoteRefused', params: { port: 2222 } });
    expect(forwards.list()[0].state).toBe('error');
  });
});

describe('ForwardRegistry', () => {
  it('lets only the holder release a key and notifies subscribers on every change', () => {
    const registry = new ForwardRegistry();
    const listener = vi.fn();
    const unsubscribe = registry.subscribe(listener);
    expect(registry.claim('k', 'a')).toBe(true);
    expect(registry.claim('k', 'a')).toBe(true);
    expect(registry.claim('k', 'b')).toBe(false);
    expect(registry.holder('k')).toBe('a');
    registry.release('k', 'b');
    expect(registry.holder('k')).toBe('a');
    registry.release('k', 'a');
    expect(registry.holder('k')).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    registry.claim('k', 'c');
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('stopAll', () => {
  it('closes listeners and channels, frees the registry and stops listening to it', async () => {
    const registry = new ForwardRegistry();
    const port = await freePort();
    const client = new FakeClient();
    const emit = vi.fn();
    const forwards = session(client, [LOCAL(port)], { registry, emit });
    await forwards.start('f-local');
    const socket = await connected(port);
    const closed = new Promise(resolve => socket.once('close', resolve));
    socket.write('x');
    await vi.waitFor(() => expect(forwards.busy()).toBe(true));
    const emitted = emit.mock.calls.length;

    forwards.stopAll();
    await closed;
    expect(forwards.busy()).toBe(false);
    expect(registry.holder('c1:f-local')).toBeUndefined();
    registry.claim('other', 'x');
    expect(emit.mock.calls.length).toBe(emitted);
  });
});
