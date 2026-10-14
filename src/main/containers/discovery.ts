import { LOCAL_CONTAINER_HOST } from '../../shared/containers';
import type { ContainerAction, ContainerHostId, ContainerTarget, DiscoveredItem, DiscoveryResult, RuntimeKind } from '../../shared/containers';
import type { ConnectionNode, SshConnectionNode } from '../../shared/vault/types';
import { publicError } from '../ssh/session';
import { actionArgv, ContainerInputError, listArgv, PROBE_SCRIPT, remoteCommand } from './commands';
import { describeFailure, parseContainerList, parsePctList, parseProbe, parseQmList } from './parsers';
import type { RunResult } from './parsers';
import { HostAccessError } from './runner';
import type { RemoteHost } from './runner';

const LIST_TIMEOUT = 15_000;
const ACTION_TIMEOUT = 120_000;

export interface DiscoveryDependencies {
  getConnection: (id: string) => ConnectionNode;
  openRemote: (connection: SshConnectionNode) => Promise<RemoteHost>;
  runLocal: (file: string, args: string[], timeoutMs: number) => Promise<RunResult>;
  idleMs?: number;
}

interface CachedHost { fingerprint: string; host: Promise<RemoteHost>; timer?: ReturnType<typeof setTimeout> }

const fingerprint = (connection: SshConnectionNode): string =>
  JSON.stringify([connection.host, connection.port, connection.username, connection.authentication]);

function readable(error: unknown): Error {
  if (error instanceof HostAccessError || error instanceof ContainerInputError) return error;
  return new Error(publicError(error));
}

const kindOf = (target: ContainerTarget): RuntimeKind => target.kind === 'container' ? target.runtime : 'proxmox';

export class ContainerDiscovery {
  private hosts = new Map<string, CachedHost>();
  constructor(private readonly dependencies: DiscoveryDependencies) {}

  async list(hostId: ContainerHostId): Promise<DiscoveryResult> {
    if (hostId === LOCAL_CONTAINER_HOST) return this.listLocal();
    const connection = this.sshConnection(hostId);
    try {
      const host = await this.remote(connection);
      const sudo = connection.containers?.sudo === true;
      const tools = parseProbe((await host.run(PROBE_SCRIPT, LIST_TIMEOUT)).stdout);
      const result: DiscoveryResult = { runtimes: [], items: [], problems: {} };
      for (const runtime of ['docker', 'podman'] as const) {
        if (!tools.has(runtime)) continue;
        result.runtimes.push(runtime);
        this.collect(result, runtime, await host.run(remoteCommand(listArgv(runtime), sudo), LIST_TIMEOUT), text => parseContainerList(runtime, text));
      }
      if (tools.has('pct') || tools.has('qm')) {
        result.runtimes.push('proxmox');
        if (tools.has('pct')) this.collect(result, 'proxmox', await host.run(remoteCommand(listArgv('lxc'), sudo), LIST_TIMEOUT), parsePctList);
        if (tools.has('qm')) this.collect(result, 'proxmox', await host.run(remoteCommand(listArgv('vm'), sudo), LIST_TIMEOUT), parseQmList);
      }
      return result;
    } catch (error) { throw readable(error); }
  }

  async action(hostId: ContainerHostId, target: ContainerTarget, action: ContainerAction): Promise<void> {
    const argv = actionArgv(target, action);
    let result: RunResult;
    if (hostId === LOCAL_CONTAINER_HOST) {
      if (target.kind !== 'container') throw new ContainerInputError('Proxmox gibt es nur auf entfernten Hosts.');
      result = await this.dependencies.runLocal(argv[0], argv.slice(1), ACTION_TIMEOUT);
    } else {
      const connection = this.sshConnection(hostId);
      try { result = await (await this.remote(connection)).run(remoteCommand(argv, connection.containers?.sudo === true), ACTION_TIMEOUT); }
      catch (error) { throw readable(error); }
    }
    if (result.code !== 0) throw new Error(result.notFound ? `${argv[0]} ist nicht installiert.` : describeFailure(kindOf(target), result));
  }

  closeAll(): void {
    for (const [id, cached] of this.hosts) { clearTimeout(cached.timer); this.hosts.delete(id); void cached.host.then(host => host.close(), () => {}); }
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

  /** One cached connection per host; replaced when the saved connection changes, closed when idle. */
  private async remote(connection: SshConnectionNode): Promise<RemoteHost> {
    const print = fingerprint(connection);
    let cached = this.hosts.get(connection.id);
    if (cached && cached.fingerprint !== print) { this.drop(connection.id, cached); cached = undefined; }
    if (cached) {
      const host = await cached.host.catch(() => undefined);
      if (host?.closed) { this.drop(connection.id, cached); cached = undefined; }
    }
    if (!cached) {
      const opened = this.dependencies.openRemote(connection);
      cached = { fingerprint: print, host: opened };
      this.hosts.set(connection.id, cached);
      opened.catch(() => { if (this.hosts.get(connection.id) === cached) this.hosts.delete(connection.id); });
    }
    const entry = cached;
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => this.drop(connection.id, entry), this.dependencies.idleMs ?? 60_000);
    return entry.host;
  }

  private drop(id: string, cached: CachedHost): void {
    clearTimeout(cached.timer);
    if (this.hosts.get(id) === cached) this.hosts.delete(id);
    void cached.host.then(host => host.close(), () => {});
  }
}
