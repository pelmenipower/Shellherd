import { INVENTORY_KINDS, LOCAL_CONTAINER_HOST, RUNTIME_LABEL } from '../../shared/containers';
import type { ContainerAction, ContainerHostId, ContainerInventory, ContainerRuntime, ContainerTarget, DiscoveredItem, DiscoveryResult, InventoryAction, InventoryKind, InventoryRef, InventoryRow, RuntimeKind } from '../../shared/containers';
import type { ConnectionNode, SshConnectionNode } from '../../shared/vault/types';
import { publicError } from '../ssh/session';
import { actionArgv, ContainerInputError, inspectArgv, inventoryActionArgv, inventoryArgv, listArgv, localProbeArgv, PROBE_COMMAND, sudoSetting } from './commands';
import { BATCH_OUTPUT_LIMIT, BATCH_TIMEOUT, inventoryBatchCommand, splitInventoryBatch } from './inventory-batch';
import { linkUsage, maskInspect, parseContainerRows, parseImageRows, parseNetworkRows, parseVolumeRows } from './inventory-parsers';
import { describeFailure, parsePctList, parseProbe, parseQmList } from './parsers';
import type { RunResult } from './parsers';
import { HostAccessError } from './runner';
import { createSudoMarker } from './sudo';
import { runWithSudo } from './sudo-run';
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

const INVENTORY_PARSERS: Record<InventoryKind, (runtime: ContainerRuntime, text: string) => InventoryRow[]> = {
  containers: parseContainerRows, images: parseImageRows, volumes: parseVolumeRows, networks: parseNetworkRows,
};
const emptyRows = (): Record<InventoryKind, InventoryRow[]> => ({ containers: [], images: [], volumes: [], networks: [] });

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
        for (const runtime of ['docker', 'podman'] as const) if (tools.has(runtime)) result.runtimes.push(runtime);
        if (tools.has('pct') || tools.has('qm')) {
          result.runtimes.push('proxmox');
          if (tools.has('pct')) this.collect(result, 'proxmox', await runWithSudo(host, connection, listArgv('lxc'), LIST_TIMEOUT, this.sudoRejections), parsePctList);
          if (tools.has('qm')) this.collect(result, 'proxmox', await runWithSudo(host, connection, listArgv('vm'), LIST_TIMEOUT, this.sudoRejections), parseQmList);
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
        result = await this.withHost(connection, host => runWithSudo(host, connection, command, ACTION_TIMEOUT, this.sudoRejections));
      }
    } catch (error) { throw readable(error); }
    if (result.code !== 0) throw new Error(result.notFound ? `${argv[0]} ist nicht installiert.` : describeFailure(kindOf(target), result));
  }

  async inventory(hostId: ContainerHostId, runtime?: ContainerRuntime): Promise<ContainerInventory> {
    try {
      const connection = hostId === LOCAL_CONTAINER_HOST ? undefined : this.sshConnection(hostId);
      if (connection) sudoSetting(connection);
      const runtimes: ContainerRuntime[] = [];
      const build = async (lists: (rt: ContainerRuntime) => Promise<Record<InventoryKind, RunResult>>): Promise<ContainerInventory> => {
        // A requested runtime is strict: nothing runs for another one (P6).
        if (runtime && !runtimes.includes(runtime)) throw new HostAccessError(`${RUNTIME_LABEL[runtime]} wurde auf diesem Host nicht gefunden.`);
        if (runtimes.length === 0) throw new HostAccessError('Auf diesem Host wurde weder Docker noch Podman gefunden.');
        const rt = runtime ?? runtimes[0];
        const results = await lists(rt);
        const rows = emptyRows();
        const problems: ContainerInventory['problems'] = {};
        for (const kind of INVENTORY_KINDS) {
          const result = results[kind];
          if (result.code === 0) rows[kind] = INVENTORY_PARSERS[kind](rt, result.stdout);
          else problems[kind] = result.notFound ? `${rt} ist nicht installiert.` : describeFailure(rt, result);
        }
        return { runtime: rt, runtimes, rows: linkUsage(rt, rows, !problems.containers), problems, at: Date.now(),
          ...(connection ? { user: connection.username } : {}), sudo: !!connection && connection.containers?.sudo === true };
      };
      if (!connection) {
        const local = (rt: ContainerRuntime, kind: InventoryKind): Promise<RunResult> => {
          const argv = inventoryArgv(rt, kind);
          return this.dependencies.runLocal(argv[0], argv.slice(1), LIST_TIMEOUT);
        };
        // Local has no probe: the container list doubles as one, a missing program means no runtime.
        const probed = new Map<ContainerRuntime, RunResult>();
        for (const rt of ['docker', 'podman'] as const) {
          const result = await local(rt, 'containers');
          if (result.notFound) continue;
          runtimes.push(rt);
          probed.set(rt, result);
        }
        return await build(async rt => ({ containers: probed.get(rt)!, images: await local(rt, 'images'),
          volumes: await local(rt, 'volumes'), networks: await local(rt, 'networks') }));
      }
      return await this.withHost(connection, async host => {
        const tools = parseProbe(probeOutput(await host.run(PROBE_COMMAND, LIST_TIMEOUT)));
        for (const rt of ['docker', 'podman'] as const) if (tools.has(rt)) runtimes.push(rt);
        return build(async rt => {
          const marker = createSudoMarker('list');
          const batch = await runWithSudo(host, connection, mode => inventoryBatchCommand(rt, marker, mode), BATCH_TIMEOUT, this.sudoRejections, BATCH_OUTPUT_LIMIT);
          return splitInventoryBatch(batch, marker);
        });
      });
    } catch (error) { throw readable(error); }
  }

  async inspect(hostId: ContainerHostId, ref: InventoryRef): Promise<string> {
    const result = await this.runInventoryCommand(hostId, () => inspectArgv(ref), LIST_TIMEOUT);
    if (result.code !== 0) throw new Error(result.notFound ? `${ref.runtime} ist nicht installiert.` : describeFailure(ref.runtime, result));
    return maskInspect(result.stdout);
  }

  async inventoryAction(hostId: ContainerHostId, ref: InventoryRef, action: InventoryAction): Promise<void> {
    const result = await this.runInventoryCommand(hostId, () => inventoryActionArgv(ref, action), ACTION_TIMEOUT);
    if (result.code !== 0) throw new Error(result.notFound ? `${ref.runtime} ist nicht installiert.` : describeFailure(ref.runtime, result));
  }

  closeAll(): void {
    this.sudoRejections.clearAll();
    for (const [id, cached] of [...this.hosts]) this.drop(id, cached);
  }

  private async runInventoryCommand(hostId: ContainerHostId, makeArgv: () => string[], timeoutMs: number): Promise<RunResult> {
    try {
      const argv = makeArgv();
      if (hostId === LOCAL_CONTAINER_HOST) return await this.dependencies.runLocal(argv[0], argv.slice(1), timeoutMs);
      const connection = this.sshConnection(hostId);
      sudoSetting(connection);
      return await this.withHost(connection, host => runWithSudo(host, connection, argv, timeoutMs, this.sudoRejections));
    } catch (error) { throw readable(error); }
  }

  private async listLocal(): Promise<DiscoveryResult> {
    const result: DiscoveryResult = { runtimes: [], items: [], problems: {} };
    for (const runtime of ['docker', 'podman'] as const) {
      const argv = localProbeArgv(runtime);
      const run = await this.dependencies.runLocal(argv[0], argv.slice(1), LIST_TIMEOUT);
      if (!run.notFound) result.runtimes.push(runtime);
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
