import { connect as netConnect, createServer } from 'node:net';
import type { Server, Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import type { Client } from 'ssh2';
import { AppError } from '../../shared/errors';
import type { CodedError } from '../../shared/errors';
import type { ForwardState, ForwardStatus } from '../../shared/ssh';
import type { PortForward } from '../../shared/vault/types';
import { dropChannel, openTunnel } from '../kubernetes/tunnel';
import { parseGreeting, parseRequest, reply } from './socks5';

const HANDSHAKE_MS = 10_000;
const HANDSHAKE_BYTES = 512;

/** App-wide claims: a forward key (`connectionId:forwardId`) runs in one session at a time. */
export class ForwardRegistry {
  private readonly holders = new Map<string, string>();
  private readonly listeners = new Set<() => void>();

  claim(key: string, sessionId: string): boolean {
    const holder = this.holders.get(key);
    if (holder === sessionId) return true;
    if (holder !== undefined) return false;
    this.holders.set(key, sessionId);
    this.notify();
    return true;
  }

  release(key: string, sessionId: string): void {
    if (this.holders.get(key) !== sessionId) return;
    this.holders.delete(key);
    this.notify();
  }

  holder(key: string): string | undefined {
    return this.holders.get(key);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

interface Entry {
  forward: PortForward;
  key: string;
  state: ForwardState;
  error?: CodedError;
  /** Token of the running start; stop clears it so a late open cleans up after itself. */
  run?: object;
  close?: () => void;
  /** Every stream of this forward (sockets and channels), destroyed on stop. */
  streams: Set<Duplex>;
  /** Forwarded connections in use; their number is `open`. */
  channels: Set<Duplex>;
}

/** The forwards of one terminal session, fixed to the snapshot taken at connect. */
export class SessionForwards {
  private readonly client: Client;
  private readonly sessionId: string;
  private readonly registry: ForwardRegistry;
  private readonly emitList: (list: ForwardStatus[]) => void;
  private readonly connectTo: typeof import('node:net').connect;
  private readonly entries = new Map<string, Entry>();
  private readonly unsubscribe: () => void;
  private disposed = false;

  constructor(options: { client: Client; connectionId: string; sessionId: string; forwards: PortForward[];
    registry: ForwardRegistry; emit: (list: ForwardStatus[]) => void; connect?: typeof import('node:net').connect }) {
    this.client = options.client;
    this.sessionId = options.sessionId;
    this.registry = options.registry;
    this.emitList = options.emit;
    this.connectTo = options.connect ?? netConnect;
    for (const forward of options.forwards) {
      this.entries.set(forward.id, { forward, key: `${options.connectionId}:${forward.id}`, state: 'stopped', streams: new Set(), channels: new Set() });
    }
    this.unsubscribe = options.registry.subscribe(() => this.changed());
    this.client.on('tcp connection', this.onTcp);
  }

  /** Starts the automatic forwards whose key is free; errors stay in the state. */
  startAuto(): void {
    for (const entry of this.entries.values()) {
      if (entry.forward.auto && this.registry.holder(entry.key) === undefined) void this.start(entry.forward.id).catch(() => undefined);
    }
  }

  async start(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) throw new AppError('ssh.forwardFailed');
    if (entry.state === 'starting' || entry.state === 'active') return;
    if (!this.registry.claim(entry.key, this.sessionId)) {
      // Shown as 'elsewhere' while the other session holds the key; no stored error.
      this.changed();
      throw new AppError('ssh.forwardElsewhere');
    }
    const run = {};
    entry.run = run;
    entry.state = 'starting';
    entry.error = undefined;
    this.changed();
    let close: () => void;
    try {
      close = await this.open(entry);
    } catch (error) {
      if (entry.run !== run) return; // stopped while opening; stop released the key
      entry.run = undefined;
      this.halt(entry);
      this.registry.release(entry.key, this.sessionId);
      throw this.fail(entry, error instanceof AppError ? error.toCoded() : { code: 'ssh.forwardFailed' });
    }
    // A late run closes only what it opened; a newer run may own entry.close now.
    if (entry.run !== run) { close(); return; }
    entry.close = close;
    entry.state = 'active';
    this.changed();
  }

  stop(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.stopEntry(entry);
    this.registry.release(entry.key, this.sessionId);
    this.changed();
  }

  /** Session end: closes everything, frees the keys and leaves the registry. */
  stopAll(): void {
    this.disposed = true;
    this.unsubscribe();
    this.client.removeListener('tcp connection', this.onTcp);
    for (const entry of this.entries.values()) {
      this.stopEntry(entry);
      this.registry.release(entry.key, this.sessionId);
    }
  }

  busy(): boolean {
    return [...this.entries.values()].some(entry => entry.channels.size > 0);
  }

  list(): ForwardStatus[] {
    return [...this.entries.values()].map(entry => this.status(entry));
  }

  private status(entry: Entry): ForwardStatus {
    const { forward } = entry;
    const running = entry.state === 'starting' || entry.state === 'active';
    const holder = this.registry.holder(entry.key);
    const elsewhere = !running && holder !== undefined && holder !== this.sessionId;
    const status: ForwardStatus = { id: forward.id, kind: forward.kind, state: elsewhere ? 'elsewhere' : entry.state, open: entry.channels.size };
    if (forward.kind === 'remote') status.remotePort = forward.remotePort;
    else status.localPort = forward.localPort;
    if (forward.kind !== 'dynamic') { status.targetHost = forward.targetHost; status.targetPort = forward.targetPort; }
    if (entry.error && !elsewhere) status.error = entry.error;
    return status;
  }

  private changed(): void {
    if (!this.disposed) this.emitList(this.list());
  }

  private fail(entry: Entry, error: CodedError): AppError {
    entry.state = 'error';
    entry.error = error;
    this.changed();
    return AppError.from(error);
  }

  private stopEntry(entry: Entry): void {
    entry.run = undefined;
    entry.state = 'stopped';
    entry.error = undefined;
    this.halt(entry);
  }

  /** Closes the listener or remote binding and destroys every stream of the entry. */
  private halt(entry: Entry): void {
    const { close } = entry;
    entry.close = undefined;
    close?.();
    for (const stream of entry.streams) dropChannel(stream); // sockets and channels alike
    entry.streams.clear();
    entry.channels.clear();
  }

  /** Opens the listener or binding and returns the function that closes exactly that. */
  private async open(entry: Entry): Promise<() => void> {
    const { forward } = entry;
    if (forward.kind === 'remote') return this.openRemote(forward.remotePort);
    try {
      if (forward.kind === 'local') {
        const tunnel = await openTunnel(
          (host, port) => this.forwardChannel(host, port).then(channel => this.count(entry, channel)),
          { host: forward.targetHost, port: forward.targetPort }, forward.localPort);
        return () => tunnel.close();
      }
      return await this.openDynamic(entry, forward.localPort);
    } catch (error) {
      throw listenFailure(error, forward.localPort);
    }
  }

  private openRemote(remotePort: number): Promise<() => void> {
    return new Promise((resolve, reject) => {
      this.client.forwardIn('localhost', remotePort, error => {
        if (error) { reject(new AppError('ssh.forwardRemoteRefused', { port: remotePort })); return; }
        resolve(() => {
          try { this.client.unforwardIn('localhost', remotePort, () => undefined); } catch { /* client already gone */ }
        });
      });
    });
  }

  private openDynamic(entry: Entry, port: number): Promise<() => void> {
    const server: Server = createServer(socket => this.handshake(entry, socket));
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        server.off('error', reject);
        server.on('error', () => this.stop(entry.forward.id));
        resolve(() => { server.close(); });
      });
    });
  }

  /** SOCKS5 greeting and request on a local socket; the handshake is cut after 10 s or 512 bytes. */
  private handshake(entry: Entry, socket: Socket): void {
    this.hold(entry, socket);
    socket.on('error', () => socket.destroy());
    const timer = setTimeout(() => socket.destroy(), HANDSHAKE_MS);
    socket.once('close', () => clearTimeout(timer));
    let buffer: Buffer = Buffer.alloc(0);
    let stage: 'greeting' | 'request' | 'done' = 'greeting';
    const finish = (payload: Buffer) => {
      stage = 'done';
      socket.end(payload, () => socket.destroy());
    };
    const onData = (chunk: Buffer) => {
      if (stage === 'done') return;
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > HANDSHAKE_BYTES) { socket.destroy(); return; }
      if (stage === 'greeting') {
        const greeting = parseGreeting(buffer);
        if ('need' in greeting) return;
        if (!greeting.ok) { finish(Buffer.from([0x05, 0xff])); return; }
        socket.write(Buffer.from([0x05, 0x00]));
        buffer = greeting.rest;
        stage = 'request';
      }
      const request = parseRequest(buffer);
      if ('need' in request) return;
      if (!request.ok) { finish(reply(request.reply)); return; }
      stage = 'done';
      clearTimeout(timer);
      socket.off('data', onData);
      socket.pause(); // no data may be lost between here and the pipe
      this.relay(entry, socket, request.host, request.port, request.rest);
    };
    socket.on('data', onData);
  }

  private relay(entry: Entry, socket: Socket, host: string, port: number, rest: Buffer): void {
    this.forwardChannel(host, port).then(channel => {
      if (socket.destroyed) { dropChannel(channel); return; }
      socket.write(reply(0x00));
      if (rest.length > 0) channel.write(rest);
      this.bridge(entry, channel, socket);
    }, () => { socket.end(reply(0x05), () => socket.destroy()); });
  }

  private forwardChannel(host: string, port: number): Promise<Duplex> {
    return new Promise((resolve, reject) => {
      this.client.forwardOut('127.0.0.1', 0, host, port, (error, channel) => (error ? reject(error) : resolve(channel)));
    });
  }

  /** Pipes a channel and a local socket both ways; either side closing closes the other. */
  private bridge(entry: Entry, channel: Duplex, socket: Duplex): void {
    this.count(entry, channel);
    this.hold(entry, socket);
    const end = () => { dropChannel(channel); socket.destroy(); };
    channel.on('error', end);
    socket.on('error', end);
    channel.on('close', () => socket.destroy());
    socket.on('close', () => dropChannel(channel));
    channel.pipe(socket);
    socket.pipe(channel);
  }

  private count(entry: Entry, stream: Duplex): Duplex {
    entry.channels.add(stream);
    this.hold(entry, stream);
    stream.once('close', () => { entry.channels.delete(stream); this.changed(); });
    this.changed();
    return stream;
  }

  private hold(entry: Entry, stream: Duplex): void {
    entry.streams.add(stream);
    stream.once('close', () => { entry.streams.delete(stream); });
  }

  /** Incoming connections of remote forwards: routed by the port the server reports. */
  private readonly onTcp = (details: { destPort: number }, accept: () => Duplex, reject: () => void): void => {
    const entry = [...this.entries.values()].find(candidate => candidate.state === 'active'
      && candidate.forward.kind === 'remote' && candidate.forward.remotePort === details.destPort);
    if (!entry || entry.forward.kind !== 'remote') { reject(); return; }
    const channel = accept();
    this.bridge(entry, channel, this.connectTo(entry.forward.targetPort, entry.forward.targetHost));
  };
}

/** EADDRINUSE and EACCES get their own text; anything else is the generic failure. */
function listenFailure(error: unknown, port: number): AppError {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'EADDRINUSE') return new AppError('ssh.forwardPortInUse', { port });
  if (code === 'EACCES') return new AppError('ssh.forwardPortDenied', { port });
  return new AppError('ssh.forwardFailed');
}
