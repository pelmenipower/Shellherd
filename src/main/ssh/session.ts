import { randomUUID } from 'node:crypto';
import { open, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { win32 } from 'node:path';
import { Client } from 'ssh2';
import type { ClientChannel, ConnectConfig } from 'ssh2';
import type { IPty, IPtyForkOptions, IWindowsPtyForkOptions } from 'node-pty';
import type { ConnectionNode, LocalShellConnectionNode, LocalShellProtocol, VaultNode } from '../../shared/vault/types';
import type { SshEvent, SshPrepareRequest, TerminalSize } from '../../shared/ssh';
import { MAX_SSH_SESSIONS } from '../../shared/ssh';
import { HostKeyError } from './known-hosts';

const OUTPUT_HIGH = 128 * 1024;
const OUTPUT_LOW = 32 * 1024;
const OUTPUT_LIMIT = 512 * 1024;
const INPUT_LIMIT = 64 * 1024;

export type SpawnShell = (file: string, args: string[], options: IPtyForkOptions | IWindowsPtyForkOptions) => IPty;

export interface SshDependencies {
  getConnection: (id: string) => ConnectionNode;
  /** node-pty's spawn; injected so tests never start real processes. */
  spawnShell: SpawnShell;
  verifyHost: (host: string, port: number, key: Buffer, isActive: () => boolean) => Promise<boolean>;
  emit: (ownerId: number, event: SshEvent) => void;
}

interface Session {
  id: string;
  ownerId: number;
  connectionId: string;
  /** SSH sessions use client/stream; local shells use pty. */
  client?: Client;
  stream?: ClientChannel;
  pty?: IPty;
  phase: 'prepared' | 'connecting' | 'connected';
  size: TerminalSize;
  outstanding: Map<number, number>;
  outputBytes: number;
  inputBytes: number;
  sequence: number;
  timer?: ReturnType<typeof setTimeout>;
  key?: Buffer;
}

export function findConnection(nodes: VaultNode[], id: string): ConnectionNode | undefined {
  for (const node of nodes) {
    if (node.id === id && node.type === 'connection') return node;
    if (node.type === 'folder') {
      const found = findConnection(node.children, id);
      if (found) return found;
    }
  }
  return undefined;
}

/** Fixed system paths; never resolved through PATH. */
export function localShellCommand(protocol: LocalShellProtocol, systemRoot = process.env.SystemRoot ?? 'C:\\Windows'): { file: string; args: string[] } {
  return protocol === 'powershell'
    ? { file: win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), args: ['-NoLogo'] }
    : { file: win32.join(systemRoot, 'System32', 'cmd.exe'), args: [] };
}

/** Electron's own variables must not leak into user shells. */
export function shellEnvironment(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  return Object.fromEntries(Object.entries(source).filter((entry): entry is [string, string] =>
    entry[1] !== undefined && !entry[0].toUpperCase().startsWith('ELECTRON_')));
}

export function agentSocket(platform = process.platform, socket = process.env.SSH_AUTH_SOCK): string {
  if (socket) return socket;
  if (platform === 'win32') return '\\\\.\\pipe\\openssh-ssh-agent';
  throw new Error('Kein SSH-Agent gefunden. Starte einen Agent oder wähle eine andere Authentifizierung.');
}

class LocalShellError extends Error {}

function publicError(error: unknown): string {
  if (error instanceof HostKeyError || error instanceof LocalShellError) return error.message;
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === 'ENOENT' || code === 'EACCES') return 'Die private Schlüsseldatei konnte nicht gelesen werden. Prüfe Pfad und Zugriffsrechte.';
  if (code === 'ECONNREFUSED') return 'Der Server lehnt die Verbindung ab. Prüfe Host und Port.';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'Der Host konnte nicht gefunden werden.';
  if ((error as { level?: string })?.level === 'client-authentication') return 'SSH-Anmeldung fehlgeschlagen. Prüfe Benutzer und Authentifizierung.';
  if ((error as { level?: string })?.level === 'client-timeout' || code === 'ETIMEDOUT') return 'Zeitüberschreitung beim Verbindungsaufbau.';
  return 'Die SSH-Verbindung ist fehlgeschlagen. Prüfe Host, Benutzer und Authentifizierung.';
}

export class SshSessionManager {
  private sessions = new Map<string, Session>();
  constructor(private readonly dependencies: SshDependencies) {}

  prepare(ownerId: number, request: SshPrepareRequest): { sessionId: string } {
    if (this.sessions.size >= MAX_SSH_SESSIONS) throw new Error(`Maximal ${MAX_SSH_SESSIONS} Terminal-Sessions gleichzeitig. Schließe zuerst einen Tab.`);
    const connection = this.dependencies.getConnection(request.connectionId);
    if (connection.protocol === 'rdp') throw new Error('Diese Verbindung ist keine Terminalverbindung.');
    if (connection.protocol === 'ssh' && (!connection.host.trim() || !connection.username?.trim())) {
      throw new Error('Bitte speichere Host und Benutzername, bevor du die Verbindung startest.');
    }
    const id = randomUUID();
    const session: Session = { id, ownerId, connectionId: request.connectionId,
      phase: 'prepared', size: { cols: request.cols, rows: request.rows }, outstanding: new Map(),
      outputBytes: 0, inputBytes: 0, sequence: 0 };
    this.sessions.set(id, session);
    session.timer = setTimeout(() => this.finish(session, 'error', 'Der Terminalstart wurde abgebrochen.'), 30_000);
    if (connection.protocol === 'ssh') {
      const client = new Client();
      session.client = client;
      // Always handle errors, including after destroy or a failed handshake.
      client.on('error', error => this.finish(session, 'error', publicError(error)));
      client.on('close', () => this.finish(session, 'closed'));
    }
    return { sessionId: id };
  }

  private owned(ownerId: number, id: string): Session {
    const session = this.sessions.get(id);
    if (!session || session.ownerId !== ownerId) throw new Error('Die Terminalverbindung ist nicht verfügbar.');
    return session;
  }

  private active(session: Session): boolean { return this.sessions.get(session.id) === session; }

  async connect(ownerId: number, id: string): Promise<void> {
    const session = this.owned(ownerId, id);
    if (session.phase !== 'prepared') throw new Error('Die Terminalverbindung wurde bereits gestartet.');
    clearTimeout(session.timer);
    session.timer = undefined;
    session.phase = 'connecting';
    this.status(session, 'connecting');
    try {
      const connection = this.dependencies.getConnection(session.connectionId);
      if (connection.protocol === 'powershell' || connection.protocol === 'cmd') { await this.startLocalShell(session, connection); return; }
      if (connection.protocol !== 'ssh' || !session.client) throw new Error('Die Verbindungsart hat sich geändert. Öffne den Tab erneut.');
      const client = session.client;
      const config: ConnectConfig = { host: connection.host, port: connection.port,
        username: connection.username, readyTimeout: 120_000, keepaliveInterval: 15_000,
        keepaliveCountMax: 3, agentForward: false, tryKeyboard: false,
        hostVerifier: (key: Buffer, callback: (valid: boolean) => void) => {
          void this.dependencies.verifyHost(connection.host, connection.port, key, () => this.active(session))
            .then(valid => {
              if (!valid && this.active(session)) this.finish(session, 'error', 'Der Server-Schlüssel wurde nicht bestätigt.');
              callback(valid && this.active(session));
            }).catch(error => {
              this.finish(session, 'error', publicError(error));
              callback(false);
            });
        },
      };
      const auth = connection.authentication;
      if (auth.method === 'password') config.password = auth.password;
      else if (auth.method === 'agent') config.agent = agentSocket();
      else {
        const file = await open(auth.keyPath, 'r');
        try {
          const stat = await file.stat();
          if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('Invalid key file');
          session.key = await file.readFile();
        } finally { await file.close(); }
        if (!this.active(session)) { this.clearKey(session); return; }
        config.privateKey = session.key;
        config.passphrase = auth.passphrase;
      }
      if (!this.active(session)) return;
      client.once('ready', () => {
        this.clearKey(session);
        client.shell({ term: 'xterm-256color', cols: session.size.cols, rows: session.size.rows }, (error, stream) => {
          if (!this.active(session)) { stream?.destroy(); return; }
          if (error) { this.finish(session, 'error', publicError(error)); return; }
          session.stream = stream;
          session.phase = 'connected';
          stream.on('data', (chunk: Buffer) => this.output(session, chunk));
          stream.stderr.on('data', (chunk: Buffer) => this.output(session, chunk));
          stream.on('error', (error: Error) => this.finish(session, 'error', publicError(error)));
          stream.stderr.on('error', (error: Error) => this.finish(session, 'error', publicError(error)));
          stream.on('close', () => this.finish(session, 'closed'));
          this.status(session, 'connected');
        });
      });
      client.connect(config);
    } catch (error) { this.finish(session, 'error', publicError(error)); }
  }

  private async startLocalShell(session: Session, connection: LocalShellConnectionNode): Promise<void> {
    if (process.platform !== 'win32') throw new LocalShellError('Lokale PowerShell- und CMD-Sitzungen sind nur unter Windows verfügbar.');
    const cwd = connection.workingDirectory?.trim() || homedir();
    const folder = await stat(cwd).catch(() => undefined);
    if (!folder?.isDirectory()) throw new LocalShellError(`Der Startordner „${cwd}“ existiert nicht.`);
    if (!this.active(session)) return;
    const { file, args } = localShellCommand(connection.protocol);
    let pty: IPty;
    try {
      pty = this.dependencies.spawnShell(file, args, { name: 'xterm-256color', cols: session.size.cols, rows: session.size.rows,
        cwd, env: shellEnvironment(), useConpty: true });
    } catch { throw new LocalShellError('Die lokale Shell konnte nicht gestartet werden.'); }
    session.pty = pty;
    session.phase = 'connected';
    pty.onData(data => this.output(session, Buffer.from(data, 'utf8')));
    pty.onExit(() => this.finish(session, 'closed'));
    this.status(session, 'connected');
  }

  private clearKey(session: Session): void { session.key?.fill(0); session.key = undefined; }

  private status(session: Session, status: 'connecting' | 'connected' | 'closed' | 'error', message?: string): void {
    this.dependencies.emit(session.ownerId, { type: 'status', sessionId: session.id, status, ...(message ? { message } : {}) });
  }

  private output(session: Session, chunk: Buffer): void {
    if (!this.active(session) || chunk.length === 0) return;
    if (session.outputBytes + chunk.length > OUTPUT_LIMIT) {
      this.finish(session, 'error', 'Die Terminalausgabe konnte nicht schnell genug verarbeitet werden.');
      return;
    }
    const sequence = ++session.sequence;
    session.outstanding.set(sequence, chunk.length);
    session.outputBytes += chunk.length;
    if (session.outputBytes >= OUTPUT_HIGH) { session.stream?.pause(); session.stream?.stderr.pause(); session.pty?.pause(); }
    if (!session.timer) session.timer = setTimeout(() => this.finish(session, 'error', 'Das Terminal reagiert nicht mehr.'), 30_000);
    this.dependencies.emit(session.ownerId, { type: 'data', sessionId: session.id, sequence, data: new Uint8Array(chunk) });
  }

  acknowledge(ownerId: number, id: string, sequence: number): void {
    const session = this.sessions.get(id);
    if (!session) return;
    this.owned(ownerId, id);
    const length = session.outstanding.get(sequence);
    if (length === undefined) return;
    session.outstanding.delete(sequence);
    session.outputBytes -= length;
    if (!session.outstanding.size) { clearTimeout(session.timer); session.timer = undefined; }
    if (session.outputBytes < OUTPUT_LOW) { session.stream?.resume(); session.stream?.stderr.resume(); session.pty?.resume(); }
  }

  async input(ownerId: number, id: string, data: string): Promise<void> {
    const session = this.owned(ownerId, id);
    if (session.phase !== 'connected' || (!session.stream && !session.pty)) throw new Error('Das Terminal ist noch nicht verbunden.');
    const bytes = Buffer.byteLength(data);
    if (bytes > 16_384 || session.inputBytes + bytes > INPUT_LIMIT) throw new Error('Zu viele Terminaleingaben. Bitte warte kurz.');
    if (!bytes) return;
    session.inputBytes += bytes;
    try {
      if (session.pty) { session.pty.write(data); return; }
      await new Promise<void>((resolve, reject) => session.stream!.write(data, error => error ? reject(error) : resolve()));
    } catch { throw new Error('Die Terminaleingabe konnte nicht gesendet werden.'); }
    finally { session.inputBytes -= bytes; }
  }

  resize(ownerId: number, id: string, size: TerminalSize): void {
    const session = this.owned(ownerId, id);
    session.size = size;
    session.stream?.setWindow(size.rows, size.cols, 0, 0);
    try { session.pty?.resize(size.cols, size.rows); } catch { /* shell already exited */ }
  }

  close(ownerId: number, id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    this.owned(ownerId, id);
    this.finish(session, 'closed');
  }

  closeAll(): void { for (const session of [...this.sessions.values()]) this.finish(session, 'closed'); }
  closeOwner(ownerId: number): void {
    for (const session of [...this.sessions.values()]) if (session.ownerId === ownerId) this.finish(session, 'closed');
  }
  hasOwner(ownerId: number): boolean { return [...this.sessions.values()].some(session => session.ownerId === ownerId); }

  private finish(session: Session, status: 'closed' | 'error', message?: string): void {
    if (!this.active(session)) return;
    this.sessions.delete(session.id);
    clearTimeout(session.timer);
    this.clearKey(session);
    session.outstanding.clear();
    session.stream?.destroy();
    session.client?.destroy();
    try { session.pty?.kill(); } catch { /* already exited */ }
    this.status(session, status, message);
  }
}
