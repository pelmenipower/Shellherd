import { randomUUID } from 'node:crypto';
import { open } from 'node:fs/promises';
import { Client } from 'ssh2';
import type { ClientChannel, ConnectConfig } from 'ssh2';
import type { ConnectionNode, VaultNode } from '../../shared/vault/types';
import type { SshEvent, SshPrepareRequest, TerminalSize } from '../../shared/ssh';
import { MAX_SSH_SESSIONS } from '../../shared/ssh';
import { HostKeyError } from './known-hosts';

const OUTPUT_HIGH = 128 * 1024;
const OUTPUT_LOW = 32 * 1024;
const OUTPUT_LIMIT = 512 * 1024;
const INPUT_LIMIT = 64 * 1024;

export interface SshDependencies {
  getConnection: (id: string) => ConnectionNode;
  verifyHost: (host: string, port: number, key: Buffer, isActive: () => boolean) => Promise<boolean>;
  emit: (ownerId: number, event: SshEvent) => void;
}

interface Session {
  id: string;
  ownerId: number;
  connectionId: string;
  client: Client;
  stream?: ClientChannel;
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

export function agentSocket(platform = process.platform, socket = process.env.SSH_AUTH_SOCK): string {
  if (socket) return socket;
  if (platform === 'win32') return '\\\\.\\pipe\\openssh-ssh-agent';
  throw new Error('Kein SSH-Agent gefunden. Starte einen Agent oder wähle eine andere Authentifizierung.');
}

function publicError(error: unknown): string {
  if (error instanceof HostKeyError) return error.message;
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
    if (this.sessions.size >= MAX_SSH_SESSIONS) throw new Error(`Maximal ${MAX_SSH_SESSIONS} SSH-Sessions gleichzeitig. Schließe zuerst einen Tab.`);
    const connection = this.dependencies.getConnection(request.connectionId);
    if (!connection.host.trim() || !connection.username?.trim()) {
      throw new Error('Bitte speichere Host und Benutzername, bevor du die Verbindung startest.');
    }
    const id = randomUUID();
    const session: Session = { id, ownerId, connectionId: request.connectionId, client: new Client(),
      phase: 'prepared', size: { cols: request.cols, rows: request.rows }, outstanding: new Map(),
      outputBytes: 0, inputBytes: 0, sequence: 0 };
    this.sessions.set(id, session);
    session.timer = setTimeout(() => this.finish(session, 'error', 'Der Terminalstart wurde abgebrochen.'), 30_000);
    // Always handle errors, including after destroy or a failed handshake.
    session.client.on('error', error => this.finish(session, 'error', publicError(error)));
    session.client.on('close', () => this.finish(session, 'closed'));
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
      session.client.once('ready', () => {
        this.clearKey(session);
        session.client.shell({ term: 'xterm-256color', cols: session.size.cols, rows: session.size.rows }, (error, stream) => {
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
      session.client.connect(config);
    } catch (error) { this.finish(session, 'error', publicError(error)); }
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
    if (session.outputBytes >= OUTPUT_HIGH) { session.stream?.pause(); session.stream?.stderr.pause(); }
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
    if (session.outputBytes < OUTPUT_LOW) { session.stream?.resume(); session.stream?.stderr.resume(); }
  }

  async input(ownerId: number, id: string, data: string): Promise<void> {
    const session = this.owned(ownerId, id);
    if (session.phase !== 'connected' || !session.stream) throw new Error('Das Terminal ist noch nicht verbunden.');
    const bytes = Buffer.byteLength(data);
    if (bytes > 16_384 || session.inputBytes + bytes > INPUT_LIMIT) throw new Error('Zu viele Terminaleingaben. Bitte warte kurz.');
    if (!bytes) return;
    session.inputBytes += bytes;
    try {
      await new Promise<void>((resolve, reject) => session.stream!.write(data, error => error ? reject(error) : resolve()));
    } catch { throw new Error('Die Terminaleingabe konnte nicht gesendet werden.'); }
    finally { session.inputBytes -= bytes; }
  }

  resize(ownerId: number, id: string, size: TerminalSize): void {
    const session = this.owned(ownerId, id);
    session.size = size;
    session.stream?.setWindow(size.rows, size.cols, 0, 0);
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
    session.client.destroy();
    this.status(session, status, message);
  }
}
