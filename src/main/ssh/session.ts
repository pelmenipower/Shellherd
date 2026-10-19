import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { win32 } from 'node:path';
import { Client } from 'ssh2';
import type { ClientChannel } from 'ssh2';
import type { IPty, IPtyForkOptions, IWindowsPtyForkOptions } from 'node-pty';
import type { ConnectionNode, LocalConnectionNode, LocalShellProtocol, SshConnectionNode, VaultNode } from '../../shared/vault/types';
import { AI_CLI_TOOLS, aiCliCommandLine } from '../../shared/ai-cli';
import { locateCommand } from './locate';
import type { SshEvent, SshPrepareRequest, SshStatus, SshStep, TerminalSize } from '../../shared/ssh';
import { AppError, MAX_DETAIL } from '../../shared/errors';
import type { CodedError } from '../../shared/errors';
import { MAX_SSH_SESSIONS } from '../../shared/ssh';
import { HostKeyError } from './known-hosts';
import { AgentError, sshConnectConfig } from './client-config';
import type { ConnectionErrorCode } from '../../shared/connection-errors';
import { LOCAL_CONTAINER_HOST } from '../../shared/containers';
import type { TerminalTarget } from '../../shared/containers';
import { remoteCommand, sudoSetting, terminalArgv } from '../containers/commands';
import type { SudoMode } from '../containers/commands';
import { SUDO_NOT_CACHED, SUDO_REJECTED } from '../containers/parsers';
import { connectionFingerprint, SudoRejections } from '../containers/sudo-rejections';
import { createSudoMarker, SudoWatcher } from '../containers/sudo';
import { KUBE_NAME } from '../../shared/kubernetes';
import type { KubeTerminalMode, KubeTerminalTarget } from '../../shared/kubernetes';
import { KubeApiError } from '../kubernetes/api';
import type { KubeStream, TerminalIo } from '../kubernetes/api';
import { mainT } from '../i18n';

export { agentSocket } from './client-config';

const OUTPUT_HIGH = 128 * 1024;
const OUTPUT_LOW = 32 * 1024;
const OUTPUT_LIMIT = 512 * 1024;
const INPUT_LIMIT = 64 * 1024;
const SUDO_READY_TIMEOUT = 20_000;
const KUBE_TERMINAL_MODES: KubeTerminalMode[] = ['logs', 'previous', 'shell'];

/** `args` as a string is passed to Windows unchanged (cmd.exe /k <command line>). */
export type SpawnShell = (file: string, args: string[] | string, options: IPtyForkOptions | IWindowsPtyForkOptions) => IPty;

export interface SshDependencies {
  getConnection: (id: string) => ConnectionNode;
  /** Shared with container lists; a private instance when not given. */
  sudoRejections?: SudoRejections;
  /** How long a container tab waits for sudo to authenticate before handing control to the user. */
  sudoReadyTimeoutMs?: number;
  /** node-pty's spawn; injected so tests never start real processes. */
  spawnShell: SpawnShell;
  /** Finds an installed program; injected for tests. */
  locate?: (command: string) => Promise<string | null>;
  verifyHost: (host: string, port: number, key: Buffer, isActive: () => boolean) => Promise<boolean>;
  /** Opens logs or a shell of a pod through the cluster's live session; absent disables cluster terminals. */
  openKubeTerminal?: (clusterId: string, target: KubeTerminalTarget, size: TerminalSize, io: TerminalIo) => Promise<KubeStream>;
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
  /** Between a window transfer and the new window's attach: output is held, not emitted. */
  handover?: { held: Buffer[]; bytes: number };
  target?: TerminalTarget;
  /** Cluster pod terminal (logs or shell); no SSH client, the stream comes from the cluster's session. */
  kube?: KubeTerminalTarget;
  kubeStream?: KubeStream;
  exitCode?: number | null;
  tail?: string;
  /** Set once the user sent input; later exits are the user's own. */
  typed?: boolean;
  /** Container tab authenticating sudo with the stored password; removed at the ready marker. */
  sudo?: { watcher: SudoWatcher; password?: string; fingerprint: string; release?: () => void; timer?: ReturnType<typeof setTimeout> };
  /** sudo authenticated and the ready marker was seen. */
  sudoReady?: boolean;
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

export class LocalShellError extends AppError {}

/** Coded errors pass through; everything else maps to an ssh.* code, never to library text. */
export function publicError(error: unknown): CodedError {
  if (error instanceof AppError) return error.toCoded();
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === 'ENOENT' || code === 'EACCES') return { code: 'ssh.keyFileUnreadable' };
  if (code === 'ECONNREFUSED') return { code: 'ssh.connectionRefused' };
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return { code: 'ssh.hostNotFound' };
  if ((error as { level?: string })?.level === 'client-authentication') return { code: 'ssh.authFailed' };
  if ((error as { level?: string })?.level === 'client-timeout' || code === 'ETIMEDOUT') return { code: 'ssh.timeout' };
  return { code: 'ssh.failed' };
}

export interface ClassifiedError { code: ConnectionErrorCode; error: CodedError }

/** Maps an error to a card code and a coded error; library text only as `detail` (at most MAX_DETAIL characters). */
export function classifyError(error: unknown): ClassifiedError {
  if (error instanceof HostKeyError) {
    if (error.kind === 'changed' && error.fingerprints) {
      return { code: 'hostkey-changed', error: { ...error.toCoded(), detail: `expected ${error.fingerprints.expected}
received ${error.fingerprints.received}` } };
    }
    // A changed key without fingerprints cannot be compared, so it is treated like a store problem (contract 1.17).
    return { code: 'hostkey-store', error: error.toCoded() };
  }
  if (error instanceof AgentError) return { code: 'agent', error: error.toCoded() };
  if (error instanceof AppError) return { code: 'unknown', error: error.toCoded() };
  const coded = publicError(error);
  const raw = error instanceof Error ? error.message.slice(0, MAX_DETAIL) : '';
  const withDetail: CodedError = raw ? { ...coded, detail: raw } : coded;
  switch (coded.code) {
    case 'ssh.keyFileUnreadable': return { code: 'key-file', error: withDetail };
    case 'ssh.connectionRefused': return { code: 'refused', error: withDetail };
    case 'ssh.hostNotFound': return { code: 'not-found', error: withDetail };
    case 'ssh.authFailed': return { code: 'auth', error: withDetail };
    case 'ssh.timeout': return { code: 'timeout', error: withDetail };
    default: return { code: 'unknown', error: withDetail };
  }
}

/** Why a container tab ended; undefined when the output already says enough or the user ended it. */
export function targetExitError(target: TerminalTarget, code: number | null | undefined, tail: string, typed = false): CodedError | undefined {
  if (typed || code === undefined || code === null || code === 0) return undefined;
  if (/No such container/i.test(tail)) return { code: 'ssh.containerNotFound', params: { name: target.item.name } };
  if (target.item.kind === 'container' && target.mode === 'shell' && (code === 126 || code === 127)) return { code: 'ssh.noShellInContainer' };
  if (target.item.kind === 'vm' && /serial/i.test(tail)) return { code: 'ssh.serialConsoleUnavailable' };
  return undefined;
}

export class SshSessionManager {
  private sessions = new Map<string, Session>();
  private readonly sudoRejections: SudoRejections;
  constructor(private readonly dependencies: SshDependencies) {
    this.sudoRejections = dependencies.sudoRejections ?? new SudoRejections();
  }

  prepare(ownerId: number, request: SshPrepareRequest): { sessionId: string } {
    if (this.sessions.size >= MAX_SSH_SESSIONS) throw new AppError('ssh.sessionLimit', { max: MAX_SSH_SESSIONS });
    const local = request.connectionId === LOCAL_CONTAINER_HOST;
    if (local && !request.target) throw new AppError('ssh.connectionNotFound');
    const connection = local ? undefined : this.dependencies.getConnection(request.connectionId);
    if (connection?.protocol === 'rdp' || connection?.protocol === 'sftp') throw new AppError('ssh.notTerminal');
    if (connection?.protocol === 'kubernetes' && !request.kube) throw new AppError('ssh.clusterInTab');
    if (request.kube) this.checkKubeRequest(request.kube, connection);
    if (connection && request.target && connection.protocol !== 'ssh') throw new AppError('ssh.containerTabsSshOnly');
    if (connection?.protocol === 'ssh' && (!connection.host.trim() || !connection.username?.trim())) {
      throw new AppError('ssh.hostUserMissing');
    }
    // Validates the target now so the tab fails before any connection is made.
    if (request.target) terminalArgv(request.target);
    const id = randomUUID();
    const session: Session = { id, ownerId, connectionId: request.connectionId,
      phase: 'prepared', size: { cols: request.cols, rows: request.rows }, outstanding: new Map(),
      outputBytes: 0, inputBytes: 0, sequence: 0, ...(request.target ? { target: request.target, tail: '' } : {}),
      ...(request.kube ? { kube: { ...request.kube } } : {}) };
    this.sessions.set(id, session);
    session.timer = setTimeout(() => this.finish(session, 'error', { code: 'ssh.startAborted' }), 30_000);
    if (connection?.protocol === 'ssh') {
      const client = new Client();
      session.client = client;
      // Always handle errors, including after destroy or a failed handshake.
      client.on('error', error => this.fail(session, error));
      // A close while the session is still active was not caused by the user.
      client.on('close', () => this.finish(session, 'closed', undefined, 'closed-by-server'));
    }
    return { sessionId: id };
  }

  private owned(ownerId: number, id: string): Session {
    const session = this.sessions.get(id);
    if (!session || session.ownerId !== ownerId) throw new AppError('ssh.notAvailable');
    return session;
  }

  private active(session: Session): boolean { return this.sessions.get(session.id) === session; }

  async connect(ownerId: number, id: string): Promise<void> {
    const session = this.owned(ownerId, id);
    if (session.phase !== 'prepared') throw new AppError('ssh.alreadyStarted');
    clearTimeout(session.timer);
    session.timer = undefined;
    session.phase = 'connecting';
    this.status(session, 'connecting');
    try {
      if (session.connectionId === LOCAL_CONTAINER_HOST) { await this.startLocalContainer(session); return; }
      const connection = this.dependencies.getConnection(session.connectionId);
      if (session.kube) { await this.startKubeTerminal(session, session.kube, connection); return; }
      if (session.target && connection.protocol !== 'ssh') throw new AppError('ssh.connectionTypeChanged');
      if (connection.protocol === 'powershell' || connection.protocol === 'cmd' || connection.protocol === 'aicli') { await this.startLocalShell(session, connection); return; }
      if (connection.protocol !== 'ssh' || !session.client) throw new AppError('ssh.connectionTypeChanged');
      const client = session.client;
      // Decided before connecting, so an unusable password fails without contacting the host.
      const sudo = session.target ? this.sudoMode(session, connection) : undefined;
      let hostKeySeen = false;
      const { config, key } = await sshConnectConfig(connection, (hostKey, callback) => {
        if (!hostKeySeen) { hostKeySeen = true; this.step(session, 'hostkey'); }
        void this.dependencies.verifyHost(connection.host, connection.port, hostKey, () => this.active(session))
          .then(valid => {
            if (!valid && this.active(session)) this.finish(session, 'error', { code: 'ssh.hostKeyRejected' }, 'hostkey-rejected');
            callback(valid && this.active(session));
            if (valid) this.step(session, 'auth');
          }).catch(error => {
            this.fail(session, error);
            callback(false);
          });
      });
      session.key = key;
      if (!this.active(session)) { this.clearKey(session); return; }
      client.once('ready', () => {
        this.clearKey(session);
        this.step(session, 'shell');
        void this.awaitSudoTurn(session).then(proceed => {
          if (!proceed) return;
          const pty = { term: 'xterm-256color', cols: session.size.cols, rows: session.size.rows };
          const attach = (error: Error | undefined, stream: ClientChannel) => this.attachStream(session, error, stream);
          if (session.target && sudo) client.exec(remoteCommand(terminalArgv(session.target), sudo), { pty }, attach);
          else client.shell(pty, attach);
        }, error => this.fail(session, error));
      });
      this.step(session, 'reach');
      client.connect(config);
    } catch (error) { this.fail(session, error); }
  }

  /**
   * One sudo authentication per connection at a time, so parallel tabs cannot multiply a wrong
   * password. Taken after the SSH handshake to keep the wait short; false when the tab went away.
   */
  private async awaitSudoTurn(session: Session): Promise<boolean> {
    const pending = session.sudo;
    if (!pending) return true;
    const release = await this.sudoRejections.acquire(session.connectionId);
    if (!this.active(session) || session.sudo !== pending) { release(); return false; }
    pending.release = release;
    if (this.sudoRejections.isRejected(session.connectionId, pending.fingerprint)) throw new AppError(SUDO_REJECTED);
    return true;
  }

  private attachStream(session: Session, error: Error | undefined, stream: ClientChannel | undefined): void {
    if (!this.active(session)) { stream?.destroy(); return; }
    if (error || !stream) { this.fail(session, error); return; }
    session.stream = stream;
    session.phase = 'connected';
    stream.on('data', (chunk: Buffer) => session.sudo ? this.sudoOutput(session, chunk) : this.output(session, chunk));
    stream.stderr.on('data', (chunk: Buffer) => this.output(session, chunk));
    stream.on('error', (error: Error) => this.fail(session, error));
    stream.stderr.on('error', (error: Error) => this.fail(session, error));
    if (session.target) stream.on('exit', (code: number | null) => { session.exitCode = code; });
    stream.on('close', () => { this.releaseSudoHold(session); this.ended(session, true); });
    if (session.sudo) session.sudo.timer = setTimeout(() => this.sudoGaveUp(session), this.dependencies.sudoReadyTimeoutMs ?? SUDO_READY_TIMEOUT);
    this.status(session, 'connected');
  }

  /** With a stored password, `sudo -v` prompts on the tty with a marker that Shellherd answers; otherwise sudo -n. */
  private sudoMode(session: Session, connection: SshConnectionNode): SudoMode {
    const setting = sudoSetting(connection);
    if (setting.kind !== 'prompt') return setting;
    const fingerprint = connectionFingerprint(connection);
    // A refused password is not tried again (account lockout) until the connection changes.
    if (this.sudoRejections.isRejected(connection.id, fingerprint)) throw new AppError(SUDO_REJECTED);
    const marker = createSudoMarker('sudo');
    const ready = createSudoMarker('ready');
    session.sudo = { watcher: new SudoWatcher({ prompt: marker, ready }), password: setting.password, fingerprint };
    return { kind: 'prompt', marker, ready, stdin: false };
  }

  /** Before the ready marker only sudo writes; after it the watcher and password are gone and output is untouched. */
  private sudoOutput(session: Session, chunk: Buffer): void {
    const sudo = session.sudo!;
    const result = sudo.watcher.feed(chunk);
    if (result.ready) { this.dropSudo(session); session.sudoReady = true; }
    this.output(session, result.output);
    if (result.ready || !result.prompts) return;
    // A second prompt means sudo refused the password; never send it twice.
    if (sudo.watcher.count > 1 || !sudo.password) {
      this.sudoRejections.markRejected(session.connectionId, sudo.fingerprint);
      this.finish(session, 'error', { code: SUDO_REJECTED });
      return;
    }
    const password = sudo.password;
    sudo.password = undefined;
    session.stream?.write(`${password}\n`);
  }

  /** sudo neither finished nor failed in time: stop watching, free the gate and let the user answer by hand. */
  private sudoGaveUp(session: Session): void {
    if (!this.active(session) || !session.sudo) return;
    this.releaseSudoHold(session);
    this.output(session, Buffer.from(`\r\n${mainT('terminal.sudoGaveUp')}\r\n`, 'utf8'));
  }

  private releaseSudoHold(session: Session): void {
    const sudo = session.sudo;
    this.dropSudo(session);
    if (sudo) this.output(session, sudo.watcher.flush());
  }

  /** Forgets the password and opens the connection's sudo gate for the next tab or command. */
  private dropSudo(session: Session): void {
    const sudo = session.sudo;
    session.sudo = undefined;
    if (!sudo) return;
    clearTimeout(sudo.timer);
    sudo.release?.();
  }

  /** `remote`: the end came from an ssh2 stream, so an untouched session means the server ended it. */
  private ended(session: Session, remote = false): void {
    const notCached = session.sudoReady && !session.typed && session.exitCode && /sudo: a password is required/i.test(session.tail ?? '');
    const error: CodedError | undefined = notCached ? { code: SUDO_NOT_CACHED } : session.target ? targetExitError(session.target, session.exitCode, session.tail ?? '', session.typed === true) : undefined;
    if (error) this.finish(session, 'error', error, 'unknown');
    else this.finish(session, 'closed', undefined, remote && !session.typed ? 'closed-by-server' : undefined);
  }

  private async startLocalContainer(session: Session): Promise<void> {
    this.step(session, 'shell');
    if (process.platform !== 'win32') throw new LocalShellError('ssh.localContainerWindowsOnly');
    const target = session.target!;
    if (target.item.kind !== 'container') throw new LocalShellError('ssh.proxmoxRemoteOnly');
    const argv = terminalArgv(target);
    const file = await (this.dependencies.locate ?? locateCommand)(argv[0]);
    if (!file) throw new LocalShellError('ssh.programNotInstalled', { program: argv[0] });
    if (!this.active(session)) return;
    let pty: IPty;
    try {
      pty = this.dependencies.spawnShell(file, argv.slice(1), { name: 'xterm-256color', cols: session.size.cols, rows: session.size.rows,
        cwd: homedir(), env: shellEnvironment(), useConpty: true });
    } catch { throw new LocalShellError('ssh.programStartFailed', { program: argv[0] }); }
    session.pty = pty;
    session.phase = 'connected';
    pty.onData(data => this.output(session, Buffer.from(data, 'utf8')));
    pty.onExit(({ exitCode }) => { session.exitCode = exitCode; this.ended(session); });
    this.status(session, 'connected');
  }

  private async startLocalShell(session: Session, connection: LocalConnectionNode): Promise<void> {
    this.step(session, 'shell');
    if (process.platform !== 'win32') throw new LocalShellError('ssh.localShellWindowsOnly');
    const cwd = connection.workingDirectory?.trim() || homedir();
    const folder = await stat(cwd).catch(() => undefined);
    if (!folder?.isDirectory()) throw new LocalShellError('ssh.startFolderMissing', { folder: cwd });
    if (!this.active(session)) return;
    let file: string;
    let args: string[] | string;
    if (connection.protocol === 'aicli') {
      // Preset tools are checked first so a missing install gives a clear hint instead of a cmd error.
      if (connection.tool !== 'custom') {
        const tool = AI_CLI_TOOLS[connection.tool];
        if (!await (this.dependencies.locate ?? locateCommand)(tool.command)) {
          throw new LocalShellError('ssh.aiToolNotInstalled', { tool: tool.label, install: tool.install });
        }
        if (!this.active(session)) return;
      }
      file = localShellCommand('cmd').file;
      // cmd /k: after the tool exits, the tab stays a prompt in the project folder.
      args = `/d /k ${aiCliCommandLine(connection)}`;
    } else ({ file, args } = localShellCommand(connection.protocol));
    let pty: IPty;
    try {
      pty = this.dependencies.spawnShell(file, args, { name: 'xterm-256color', cols: session.size.cols, rows: session.size.rows,
        cwd, env: shellEnvironment(), useConpty: true });
    } catch { throw new LocalShellError('ssh.localShellStartFailed'); }
    session.pty = pty;
    session.phase = 'connected';
    pty.onData(data => this.output(session, Buffer.from(data, 'utf8')));
    pty.onExit(() => this.finish(session, 'closed'));
    this.status(session, 'connected');
  }

  /** Cluster terminals are checked before connecting, so a refused request never reaches the cluster. */
  private checkKubeRequest(kube: KubeTerminalTarget, connection: ConnectionNode | undefined): void {
    if (connection?.protocol !== 'kubernetes') throw new AppError('ssh.podTerminalOnlyKube');
    if (!this.dependencies.openKubeTerminal) throw new AppError('ssh.podTerminalUnavailable');
    if (!KUBE_NAME.test(kube.namespace) || !KUBE_NAME.test(kube.pod) || !KUBE_NAME.test(kube.container) || !KUBE_TERMINAL_MODES.includes(kube.mode)) {
      throw new AppError('ssh.invalidPod');
    }
    if (kube.mode === 'shell' && connection.readOnly) throw new AppError('kubernetes.readOnly');
  }

  /** Output and exit come back through `io`; the stream is closed if the tab went away while opening. */
  private async startKubeTerminal(session: Session, target: KubeTerminalTarget, connection: ConnectionNode): Promise<void> {
    this.step(session, 'shell');
    if (connection.protocol !== 'kubernetes') throw new LocalShellError('ssh.connectionTypeChanged');
    if (target.mode === 'shell' && connection.readOnly) throw new LocalShellError('kubernetes.readOnly');
    const open = this.dependencies.openKubeTerminal;
    if (!open) throw new LocalShellError('ssh.podTerminalUnavailable');
    const io: TerminalIo = {
      data: chunk => this.output(session, chunk),
      end: (code, error) => { session.exitCode = code; this.finish(session, error ? 'error' : 'closed', error, error ? 'unknown' : undefined); },
    };
    let stream: KubeStream;
    try { stream = await open(session.connectionId, target, session.size, io); }
    catch (error) { throw error instanceof KubeApiError ? AppError.from(error.coded) : new LocalShellError('ssh.podTerminalFailed'); }
    if (!this.active(session)) { stream.close(); return; }
    session.kubeStream = stream;
    session.phase = 'connected';
    this.status(session, 'connected');
  }

  private clearKey(session: Session): void { session.key?.fill(0); session.key = undefined; }

  private status(session: Session, status: SshStatus, error?: CodedError, code?: ConnectionErrorCode): void {
    this.dependencies.emit(session.ownerId, { type: 'status', sessionId: session.id, status, ...(error ? { error } : {}), ...(code ? { code } : {}) });
  }

  /** Steps go to the owner and only while the session is active. */
  private step(session: Session, step: SshStep): void {
    if (this.active(session)) this.dependencies.emit(session.ownerId, { type: 'step', sessionId: session.id, step });
  }

  /** Ends the session with the classified error. */
  private fail(session: Session, error: unknown): void {
    const { code, error: coded } = classifyError(error);
    this.finish(session, 'error', coded, code);
  }

  private output(session: Session, chunk: Buffer): void {
    if (!this.active(session) || chunk.length === 0) return;
    if (session.target) session.tail = ((session.tail ?? '') + chunk.subarray(-2048).toString('utf8')).slice(-2048);
    if (session.handover) {
      // Streams are paused; only chunks already in flight arrive here.
      if (session.handover.bytes + chunk.length > OUTPUT_LIMIT) { this.finish(session, 'error', { code: 'ssh.handoverFailed' }); return; }
      session.handover.held.push(chunk);
      session.handover.bytes += chunk.length;
      return;
    }
    if (session.outputBytes + chunk.length > OUTPUT_LIMIT) {
      this.finish(session, 'error', { code: 'ssh.outputTooSlow' });
      return;
    }
    const sequence = ++session.sequence;
    session.outstanding.set(sequence, chunk.length);
    session.outputBytes += chunk.length;
    if (session.outputBytes >= OUTPUT_HIGH) { session.stream?.pause(); session.stream?.stderr.pause(); session.pty?.pause(); session.kubeStream?.pause(); }
    if (!session.timer) session.timer = setTimeout(() => this.finish(session, 'error', { code: 'ssh.notResponding' }), 30_000);
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
    if (session.outputBytes < OUTPUT_LOW) { session.stream?.resume(); session.stream?.stderr.resume(); session.pty?.resume(); session.kubeStream?.resume(); }
  }

  async input(ownerId: number, id: string, data: string): Promise<void> {
    const session = this.owned(ownerId, id);
    if (session.phase !== 'connected' || (!session.stream && !session.pty && !session.kubeStream)) throw new AppError('ssh.notConnected');
    // While sudo authenticates, keystrokes would end up in its password line.
    if (session.sudo) return;
    const bytes = Buffer.byteLength(data);
    if (bytes > 16_384 || session.inputBytes + bytes > INPUT_LIMIT) throw new AppError('ssh.tooMuchInput');
    if (!bytes) return;
    session.inputBytes += bytes;
    session.typed = true;
    try {
      if (session.pty) { session.pty.write(data); return; }
      if (session.kubeStream) { session.kubeStream.write(data); return; }
      await new Promise<void>((resolve, reject) => session.stream!.write(data, error => error ? reject(error) : resolve()));
    } catch { throw new AppError('ssh.inputFailed'); }
    finally { session.inputBytes -= bytes; }
  }

  resize(ownerId: number, id: string, size: TerminalSize): void {
    const session = this.owned(ownerId, id);
    session.size = size;
    session.stream?.setWindow(size.rows, size.cols, 0, 0);
    try { session.pty?.resize(size.cols, size.rows); } catch { /* shell already exited */ }
    try { session.kubeStream?.resize(size.cols, size.rows); } catch { /* stream already closed */ }
  }

  close(ownerId: number, id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    this.owned(ownerId, id);
    this.finish(session, 'closed');
  }

  /**
   * Moves a session to another window without reconnecting. Output still awaiting an acknowledgment
   * from the old window is considered delivered; the new window restores the screen from a snapshot.
   */
  transferOwner(fromOwner: number, id: string, toOwner: number): SshStatus {
    const session = this.owned(fromOwner, id);
    session.ownerId = toOwner;
    session.outstanding.clear();
    session.outputBytes = 0;
    if (session.phase === 'connected') { clearTimeout(session.timer); session.timer = undefined; }
    session.handover ??= { held: [], bytes: 0 };
    session.stream?.pause(); session.stream?.stderr.pause(); session.pty?.pause(); session.kubeStream?.pause();
    return session.phase === 'connected' ? 'connected' : 'connecting';
  }

  /** The new window is ready: deliver held output and resume the streams. */
  attach(ownerId: number, id: string): void {
    const session = this.owned(ownerId, id);
    const handover = session.handover;
    if (!handover) return;
    session.handover = undefined;
    for (const chunk of handover.held) this.output(session, chunk);
    if (session.outputBytes < OUTPUT_HIGH) { session.stream?.resume(); session.stream?.stderr.resume(); session.pty?.resume(); session.kubeStream?.resume(); }
  }

  closeAll(): void { for (const session of [...this.sessions.values()]) this.finish(session, 'closed'); }
  closeOwner(ownerId: number): void {
    for (const session of [...this.sessions.values()]) if (session.ownerId === ownerId) this.finish(session, 'closed');
  }
  owns(ownerId: number, id: string): boolean { return this.sessions.get(id)?.ownerId === ownerId; }
  hasOwner(ownerId: number): boolean { return [...this.sessions.values()].some(session => session.ownerId === ownerId); }

  private finish(session: Session, status: 'closed' | 'error', error?: CodedError, code?: ConnectionErrorCode): void {
    if (!this.active(session)) return;
    this.sessions.delete(session.id);
    clearTimeout(session.timer);
    this.clearKey(session);
    this.dropSudo(session);
    session.outstanding.clear();
    session.kubeStream?.close();
    session.stream?.destroy();
    session.client?.destroy();
    try { session.pty?.kill(); } catch { /* already exited */ }
    this.status(session, status, error, code ?? (status === 'error' ? 'unknown' : undefined));
  }
}
