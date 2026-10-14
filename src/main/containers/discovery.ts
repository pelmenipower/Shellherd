import { LOCAL_CONTAINER_HOST } from '../../shared/containers';
import type { ContainerAction, ContainerHostId, ContainerTarget, DiscoveredItem, DiscoveryResult, RuntimeKind } from '../../shared/containers';
import type { ConnectionNode, SshConnectionNode } from '../../shared/vault/types';
import { publicError } from '../ssh/session';
import { actionArgv, ContainerInputError, listArgv, PROBE_COMMAND, remoteCommand, sudoSetting } from './commands';
import { describeFailure, parseContainerList, parsePctList, parseProbe, parseQmList } from './parsers';
import type { RunResult } from './parsers';
import { HostAccessError } from './runner';
import { createSudoMarker } from './sudo';
import { connectionFingerprint, SudoRejections } from './sudo-rejections';
import type { RemoteHost } from './runner';

const LIST_TIMEOUT = 15_000;
const ACTION_TIMEOUT = 120_000;

export interface DiscoveryDependencies {
  getConnection: (id: string) => ConnectionNode;
  openRemote: (connection: SshConnectionNode) => Promise<RemoteHost>;
  runLocal: (file: string, args: string[], timeoutMs: number) => Promise<RunResult>;
  idleMs?: number;
  /** Shared with terminal tabs; a private instance when not given. */
  sudoRejections?: SudoRejections;
}

interface CachedHost { fingerprint: string; host: Promise<RemoteHost>; timer?: ReturnType<typeof setTimeout>; inFlight: number }


function readable(error: unknown): Error {
  if (error instanceof HostAccessError || error instanceof ContainerInputError) return error;
  return new Error(publicError(error));
}

/** A failed probe must not look like a host without containers. */
function probeOutput(result: RunResult): string {
  if (result.timedOut) throw new HostAccessError('Der Host hat nicht rechtzeitig geantwortet.');
  if (result.code !== 0) {
    const last = result.stderr.split(/\r?\n/).map(line => line.trim()).filter(Boolean).pop();
    throw new HostAccessError(last ? last.slice(0, 200) : `Die Container-Erkennung ist fehlgeschlagen (Exit-Code ${result.code ?? '?'}).`);
  }
  return result.stdout;
}

const kindOf = (target: ContainerTarget): RuntimeKind => target.kind === 'container' ? target.runtime : 'proxmox';

export class ContainerDiscovery {
  private hosts = new Map<string, CachedHost>();
  private readonly sudoRejections: SudoRejections;
  constructor(private readonly dependencies: DiscoveryDependencies) {
    this.sudoRejections = dependencies.sudoRejections ?? new SudoRejections();
  }

  async list(hostId: ContainerHostId): Promise<DiscoveryResult> {
    try {
      if (hostId === LOCAL_CONTAINER_HOST) return await this.listLocal();
      const connection = this.sshConnection(hostId);
      sudoSetting(connection);
      return await this.withHost(connection, async host => {
        const tools = parseProbe(probeOutput(await host.run(PROBE_COMMAND, LIST_TIMEOUT)));
        const result: DiscoveryResult = { runtimes: [], items: [], problems: {} };
        for (const runtime of ['docker', 'podman'] as const) {
          if (!tools.has(runtime)) continue;
          result.runtimes.push(runtime);
          this.collect(result, runtime, await this.runSudo(host, connection, listArgv(runtime), LIST_TIMEOUT), text => parseContainerList(runtime, text));
        }
        if (tools.has('pct') || tools.has('qm')) {
          result.runtimes.push('proxmox');
          if (tools.has('pct')) this.collect(result, 'proxmox', await this.runSudo(host, connection, listArgv('lxc'), LIST_TIMEOUT), parsePctList);
          if (tools.has('qm')) this.collect(result, 'proxmox', await this.runSudo(host, connection, listArgv('vm'), LIST_TIMEOUT), parseQmList);
        }
        return result;
      });
    } catch (error) { throw readable(error); }
  }

  async action(hostId: ContainerHostId, target: ContainerTarget, action: ContainerAction): Promise<void> {
    let argv: string[];
    let result: RunResult;
    try {
      argv = actionArgv(target, action);
      if (hostId === LOCAL_CONTAINER_HOST) {
        if (target.kind !== 'container') throw new ContainerInputError('Proxmox gibt es nur auf entfernten Hosts.');
        result = await this.dependencies.runLocal(argv[0], argv.slice(1), ACTION_TIMEOUT);
      } else {
        const connection = this.sshConnection(hostId);
        const command = argv;
        sudoSetting(connection);
        result = await this.withHost(connection, host => this.runSudo(host, connection, command, ACTION_TIMEOUT));
      }
    } catch (error) { throw readable(error); }
    if (result.code !== 0) throw new Error(result.notFound ? `${argv[0]} ist nicht installiert.` : describeFailure(kindOf(target), result));
  }

  closeAll(): void {
    this.sudoRejections.clearAll();
    for (const [id, cached] of [...this.hosts]) this.drop(id, cached);
  }

  /**
   * With a stored password: authenticate with `sudo -S -v` first, fresh markers per command. After a
   * rejection the password is not sent again (account lockout), until the connection settings change.
   */
  private async runSudo(host: RemoteHost, connection: SshConnectionNode, argv: string[], timeoutMs: number): Promise<RunResult> {
    const setting = sudoSetting(connection);
    if (setting.kind !== 'prompt') return host.run(remoteCommand(argv, setting), timeoutMs);
    const print = connectionFingerprint(connection);
    if (this.sudoRejections.isRejected(connection.id, print)) return { code: null, stdout: '', stderr: '', sudoRejected: true };
    const marker = createSudoMarker('sudo');
    const ready = createSudoMarker('ready');
    const result = await host.run(remoteCommand(argv, { kind: 'prompt', marker, ready, stdin: true }), timeoutMs, { marker, ready, password: setting.password });
    if (result.sudoRejected) this.sudoRejections.markRejected(connection.id, print);
    return result;
  }

  private async listLocal(): Promise<DiscoveryResult> {
    const result: DiscoveryResult = { runtimes: [], items: [], problems: {} };
    for (const runtime of ['docker', 'podman'] as const) {
      const argv = listArgv(runtime);
      const run = await this.dependencies.runLocal(argv[0], argv.slice(1), LIST_TIMEOUT);
      if (run.notFound) continue;
      result.runtimes.push(runtime);
      this.collect(result, runtime, run, text => parseContainerList(runtime, text));
    }
    return result;
  }

  private collect(result: DiscoveryResult, kind: RuntimeKind, run: RunResult, parse: (text: string) => DiscoveredItem[]): void {
    if (run.code === 0) result.items.push(...parse(run.stdout));
    else result.problems[kind] ??= describeFailure(kind, run);
  }

  private sshConnection(hostId: string): SshConnectionNode {
    const connection = this.dependencies.getConnection(hostId);
    if (connection.protocol !== 'ssh') throw new ContainerInputError('Container gibt es nur für SSH-Verbindungen.');
    if (!connection.host.trim() || !connection.username?.trim()) throw new ContainerInputError('Bitte speichere Host und Benutzername der Verbindung.');
    return connection;
  }

  /** One cached connection per host; replaced when the saved connection changes, closed when no command ran for idleMs. */
  private async withHost<T>(connection: SshConnectionNode, use: (host: RemoteHost) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const entry = this.claim(connection);
      try {
        const host = await entry.host;
        if (host.closed && attempt === 0) { this.drop(connection.id, entry); continue; }
        return await use(host);
      } finally {
        entry.inFlight--;
        if (entry.inFlight === 0 && this.hosts.get(connection.id) === entry) this.arm(connection.id, entry);
      }
    }
  }

  /** Synchronously picks or creates the entry and marks it in use, so concurrent callers share one opening. */
  private claim(connection: SshConnectionNode): CachedHost {
    const print = connectionFingerprint(connection);
    let entry = this.hosts.get(connection.id);
    if (entry && entry.fingerprint !== print) { this.drop(connection.id, entry); entry = undefined; }
    if (!entry) {
      const created: CachedHost = { fingerprint: print, host: this.dependencies.openRemote(connection), inFlight: 0 };
      entry = created;
      this.hosts.set(connection.id, created);
      created.host.catch(() => {
        clearTimeout(created.timer);
        if (this.hosts.get(connection.id) === created) this.hosts.delete(connection.id);
      });
    }
    entry.inFlight++;
    clearTimeout(entry.timer);
    return entry;
  }

  private arm(id: string, entry: CachedHost): void {
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => { if (entry.inFlight === 0) this.drop(id, entry); }, this.dependencies.idleMs ?? 60_000);
  }

  private drop(id: string, cached: CachedHost): void {
    clearTimeout(cached.timer);
    if (this.hosts.get(id) === cached) this.hosts.delete(id);
    void cached.host.then(host => { try { host.close(); } catch { /* already gone */ } }, () => {});
  }
}
