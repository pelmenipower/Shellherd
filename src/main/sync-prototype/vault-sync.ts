/** Manual central sync of the real unlocked Vault. No plaintext in transport/checkpoints. */
import { open, unlink } from 'node:fs/promises';
import { z } from 'zod';
import { encryptVaultWithKey } from '../vault/crypto';
import { ensureVaultFileExtension, writeEncryptedVaultFile } from '../vault/storage';
import type { VaultSessionManager, VaultSessionSnapshot } from '../vault/session';
import { materializeVault, mergePortableVaults, resolveVaultConfigurationConflicts, splitVaultForSync, validatePortableVault } from './vault-merge';
import type { PortableVault } from './vault-merge';
import { SyncFailure, encryptedFile, ensure, hashWire, keyFromPassword, openDocument, samePortable, sealDocument, stable, validateKdf } from './vault-sync-crypto';
import type { SyncContext } from './vault-sync-crypto';
import { lockSyncState } from './vault-sync-state';
import type { EncryptedVaultFile } from '../../shared/vault/file-format';
import type { Vault } from '../../shared/vault/types';
export interface VaultRemote { list(): Promise<string[]>; get(id: string): Promise<string>; put(wire: string): Promise<string>; /** true = removed, false = already absent (404). */ remove?(id: string): Promise<boolean> }
export interface VaultSyncResult {
  status: 'synced' | 'conflict' | 'bindings';
  versions: number;
  conflicts: number;
  canKeepLocal: boolean;
  conflictRevision?: string;
  approvals: number;
  /** Foreign or unreadable account objects that were ignored; always set by the sync code. */
  skipped?: number;
  /** Server objects removed by compaction in this run (removed or already absent). */
  compacted?: number;
  /** Ids of unreadable account objects of this run; main-only, never copied into renderer state. */
  foreign?: string[];
  snapshot?: VaultSessionSnapshot;
}
interface Version { kind: 'shellherd-sync-version-v1'; parents: string[]; portable: PortableVault; compacts?: string[] }
export const SYNC_RETAIN = 16; export const SYNC_COMPACT_AT = 32; export const SYNC_COMPACTS_MAX = 256;
const ids = z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(100).refine(a => new Set(a).size === a.length);
const versionSchema = z.object({ kind: z.literal('shellherd-sync-version-v1'), parents: ids.refine(a => a.length <= 16), portable: z.unknown(), compacts: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(SYNC_COMPACTS_MAX).refine(a => new Set(a).size === a.length).optional() }).strict();
const pendingSchema = z.object({ before: z.string(), after: z.string(), localHeads: ids, working: z.unknown(), projection: z.unknown() }).strict();
const stateSchema = z.object({ kind: z.literal('shellherd-sync-state-v1'), versions: z.array(z.string().max(1048576)).max(100), acked: ids, localHeads: ids, working: z.unknown(), projection: z.unknown(), pending: pendingSchema.optional() }).strict();
type State = z.infer<typeof stateSchema>;
const documentHash = (vault: Vault) => { const copy = structuredClone(vault); copy.updatedAt = ''; return hashWire(stable(copy)); };
class Graph {
  readonly values = new Map<string, Version>(); readonly wires = new Map<string, string>(); private bytes = 0; private compactedCache?: Set<string>;
  constructor(readonly key: Buffer, readonly kdf: EncryptedVaultFile['kdf'], readonly context: SyncContext, private vaultId?: string) {}
  /** `null` = unreadable or foreign object; capacity overruns throw `limit`. */
  tryAdd(wire: string): string | null {
    const id = hashWire(wire); if (this.values.has(id)) return id;
    let raw: z.infer<typeof versionSchema>; let portable: PortableVault;
    try {
      raw = versionSchema.parse(openDocument(encryptedFile(wire), this.key, this.kdf, this.context, 'version'));
      portable = validatePortableVault(raw.portable); ensure(typeof portable.document.id === 'string', 'wrongVault');
      if (this.vaultId && portable.document.id !== this.vaultId) return null;
      if (raw.compacts?.some(c => c === id || raw.parents.includes(c))) return null;
    } catch (error) { if (error instanceof SyncFailure && error.code === 'limit') throw error; return null; }
    ensure(this.values.size < 100 && this.bytes + Buffer.byteLength(wire) <= 32 * 1048576, 'limit');
    if (!this.vaultId) this.vaultId = portable.document.id;
    this.values.set(id, { ...raw, portable }); this.wires.set(id, wire); this.bytes += Buffer.byteLength(wire); this.compactedCache = undefined; return id;
  }
  add(wire: string): string { const id = this.tryAdd(wire); ensure(id !== null, 'wrongVault'); return id; }
  create(portable: PortableVault, parents: string[], compacts?: string[]): string {
    return this.add(JSON.stringify(sealDocument({ kind: 'shellherd-sync-version-v1', parents: [...parents].sort(), portable: validatePortableVault(portable), ...(compacts?.length ? { compacts } : {}) }, this.key, this.kdf, this.context, 'version')));
  }
  validate(): void {
    const done = new Set<string>(); const visiting = new Set<string>();
    const visit = (id: string): void => {
      if (!this.values.has(id)) { ensure(this.compacted.has(id), 'history'); return; }
      if (done.has(id)) return; ensure(!visiting.has(id), 'history'); visiting.add(id);
      for (const parent of this.value(id).parents) visit(parent); visiting.delete(id); done.add(id);
    };
    for (const id of this.values.keys()) visit(id);
    const created = new Set([...this.values.values()].map(v => v.portable.document.createdAt)); ensure(created.size <= 1, 'wrongVault');
  }
  value(id: string): Version { const value = this.values.get(id); ensure(value); return value; }
  /** Union of `compacts` over all present versions; recomputed after add/drop. */
  get compacted(): Set<string> {
    return this.compactedCache ??= new Set([...this.values.values()].flatMap(v => v.compacts ?? []));
  }
  compactedBy(id: string): Set<string> { return new Set([...this.ancestors(id)].flatMap(a => this.value(a).compacts ?? [])); }
  heads(): string[] { const parents = new Set([...this.values.values()].flatMap(v => v.parents)); const compacted = this.compacted; return [...this.values.keys()].filter(id => !parents.has(id) && !compacted.has(id)).sort(); }
  /** Present ancestors including the id itself; compacted (missing) parents are skipped. */
  ancestors(id: string): Set<string> { const found = new Set<string>(); const walk = (key: string): void => { const v = this.values.get(key); if (!v || found.has(key)) return; found.add(key); v.parents.forEach(walk); }; walk(id); return found; }
  drop(id: string): void { const wire = this.wires.get(id); if (wire === undefined) return; this.values.delete(id); this.wires.delete(id); this.bytes -= Buffer.byteLength(wire); this.compactedCache = undefined; }
  /** Removes compacted versions except `keep`; returns how many were removed. */
  prune(keep: Set<string>): number { const doomed = [...this.values.keys()].filter(id => this.compacted.has(id) && !keep.has(id)); doomed.forEach(id => this.drop(id)); return doomed.length; }
  base(left: string, right: string): string | undefined {
    const a = this.ancestors(left); const b = this.ancestors(right); const byLeft = this.compactedBy(left); const byRight = this.compactedBy(right);
    // An honest device lists only its own ancestors, so a local ancestor compacted by the other side is common.
    const common = [...new Set([...[...a].filter(id => b.has(id) || byRight.has(id)), ...[...b].filter(id => byLeft.has(id))])];
    const maximal = common.filter(id => !common.some(other => other !== id && this.ancestors(other).has(id))); return maximal.length === 1 ? maximal[0] : undefined;
  }
}
const baseOutcome = (status: VaultSyncResult['status'], graph: Graph, conflicts = 0, canKeepLocal = false, approvals = 0, skipped = 0): VaultSyncResult => ({ status, versions: graph.values.size, conflicts, canKeepLocal, approvals, skipped });
function validateState(raw: unknown, graph: Graph): State {
  const state = stateSchema.parse(raw); state.working = validatePortableVault(state.working); state.projection = validatePortableVault(state.projection);
  for (const wire of state.versions) graph.add(wire); graph.validate();
  ensure(state.localHeads.length <= 16 && [...state.acked, ...state.localHeads].every(id => graph.values.has(id)));
  if (state.pending) { state.pending.working = validatePortableVault(state.pending.working); state.pending.projection = validatePortableVault(state.pending.projection); ensure(state.pending.localHeads.every(id => graph.values.has(id))); }
  return state;
}
/** Do not trust omissions of versions already received/acknowledged, even after restart. Foreign objects outside `acked` are skipped and counted. No pruning here. */
async function pull(remote: VaultRemote, graph: Graph, acked: string[], check: () => void): Promise<{ received: string[]; skipped: number; foreign: string[]; stale: string[] }> {
  const listing = ids.parse(await remote.list()); check();
  const before = new Set(graph.values.keys()); const foreign: string[] = [];
  for (const id of listing) {
    if (graph.values.has(id)) continue;
    const wire = await remote.get(id); check(); ensure(hashWire(wire) === id);
    if (graph.tryAdd(wire) === null) { ensure(!acked.includes(id), 'history'); foreign.push(id); }
  }
  // Zombies: newly loaded versions that an existing compaction already covers are discarded (the server kept them).
  const compacted = graph.compacted; for (const id of listing) if (!before.has(id) && graph.values.has(id) && compacted.has(id)) graph.drop(id);
  ensure(acked.filter(id => !listing.includes(id)).every(id => graph.compacted.has(id)), 'history');
  graph.validate();
  return { received: listing.filter(id => graph.values.has(id)), skipped: foreign.length, foreign, stale: listing.filter(id => graph.compacted.has(id)) };
}
export async function synchronizeVault(sessions: VaultSessionManager, remote: VaultRemote, context: SyncContext, signal: AbortSignal, keepLocalRevision?: string): Promise<VaultSyncResult> {
  ensure(process.platform === 'linux', 'limit');
  const lease = await sessions.captureForSync(); let checkpoint: Awaited<ReturnType<typeof lockSyncState>> | undefined;
  const check = (): void => { ensure(!signal.aborted, 'locked'); lease.assertCurrent(); };
  try {
    validateKdf(lease.kdf); check();
    checkpoint = await lockSyncState(lease.snapshot.filePath, lease.key, lease.kdf, context, check);
    const local = splitVaultForSync(lease.snapshot.vault); const graph = new Graph(lease.key, lease.kdf, context, lease.snapshot.vault.id);
    const raw = await checkpoint.read(); check();
    const state: State = raw === undefined ? { kind: 'shellherd-sync-state-v1', versions: [], acked: [], localHeads: [], working: local.portable, projection: local.portable } : validateState(raw, graph);
    let recoveredSnapshot: VaultSessionSnapshot | undefined;
    if (state.pending) {
      const current = documentHash(lease.snapshot.vault);
      if (current === state.pending.after) {
        Object.assign(state, { localHeads: state.pending.localHeads, working: state.pending.working, projection: state.pending.projection });
        recoveredSnapshot = lease.snapshot;
      }
      else ensure(current === state.pending.before, 'recovery');
      delete state.pending;
    }
    const { received, skipped, foreign, stale } = await pull(remote, graph, state.acked, check);
    const outcome = (status: VaultSyncResult['status'], g: Graph, conflicts = 0, canKeepLocal = false, approvals = 0): VaultSyncResult => ({ ...baseOutcome(status, g, conflicts, canKeepLocal, approvals, skipped), ...(foreign.length ? { foreign } : {}) });
    const persist = async (): Promise<void> => { state.versions = [...graph.wires.values()]; await checkpoint!.write(state); check(); };
    if (!state.localHeads.length) {
      const equal = graph.heads().filter(id => samePortable(graph.value(id).portable, local.portable));
      if (equal.length === 1) { state.localHeads = equal; state.working = graph.value(equal[0]).portable; }
      else state.localHeads = [graph.create(local.portable, [])];
      state.projection = local.portable;
    } else if (!samePortable(local.portable, state.projection)) {
      // Transfer edits from the local projection without publishing withheld remote actions/AI as deletions.
      const changed = mergePortableVaults(state.projection, local.portable, state.working); ensure(changed.portable !== null, 'conflict');
      state.working = changed.portable; state.localHeads = [graph.create(changed.portable, state.localHeads)]; state.projection = local.portable;
    }
    state.acked = [...new Set([...state.acked, ...received])]; await persist(); // Durable outbox before any upload.
    const upload = async (): Promise<void> => {
      for (const [id, wire] of graph.wires) if (!state.acked.includes(id)) {
        check(); ensure(await remote.put(wire) === id); check(); state.acked.push(id); await persist();
      }
    };
    await upload(); const heads = graph.heads(); ensure(heads.length > 0);
    let target: PortableVault; let targetHeads = heads;
    if (heads.length === 1) target = graph.value(heads[0]).portable;
    else {
      if (heads.length !== 2) return outcome('conflict', graph, heads.length);
      const localHead = heads.find(id => state.localHeads.includes(id));
      const left = localHead ?? heads[0]; const right = heads.find(id => id !== left)!; const base = graph.base(left, right);
      if (!base) return outcome('conflict', graph, 1);
      const b = graph.value(base).portable; const l = graph.value(left).portable; const r = graph.value(right).portable;
      const merged = mergePortableVaults(b, l, r);
      const canKeepLocal = Boolean(localHead) && merged.conflicts.length > 0 && merged.conflicts.every(c => c.scope === 'node' && c.field === 'configuration-or-move');
      if (!merged.portable) {
        // Consent is valid only for the exact local document and conflicting history the user saw.
        const conflictRevision = hashWire(stable([heads, documentHash(lease.snapshot.vault)]));
        if (!canKeepLocal || keepLocalRevision !== conflictRevision) return {
          ...outcome('conflict', graph, merged.conflicts.length, canKeepLocal),
          ...(canKeepLocal ? { conflictRevision } : {}),
          ...(recoveredSnapshot ? { snapshot: recoveredSnapshot } : {}),
        };
        target = resolveVaultConfigurationConflicts(b, l, r, merged.conflicts.map(c => ({ id: c.id, side: 'left' as const })));
      } else target = merged.portable;
      targetHeads = [graph.create(target, heads)]; await persist(); await upload();
    }
    const materialized = materializeVault(target, local.local);
    if (!materialized.vault) return outcome('bindings', graph, materialized.needsBindings.length);
    const next = materialized.vault; const projection = splitVaultForSync(next).portable;
    let snapshot = recoveredSnapshot;
    if (!samePortable(next, lease.snapshot.vault)) {
      state.pending = { before: documentHash(lease.snapshot.vault), after: documentHash(next), localHeads: targetHeads, working: target, projection };
      await persist(); check(); snapshot = await lease.commit(next, check); check();
    }
    state.localHeads = targetHeads; state.working = target; state.projection = snapshot ? splitVaultForSync(snapshot.vault).portable : local.portable; delete state.pending;
    await persist();
    // Compaction runs only after a successful sync; never on conflict or bindings.
    let compactedCount = 0;
    const removeAll = async (list: string[]): Promise<void> => {
      for (const id of list) {
        check();  
        try { await remote.remove!(id); } catch { return; } // Deletion is housekeeping: stop quietly, the next run repairs.
        check(); compactedCount++;
      }
    };
    if (remote.remove) await removeAll(stale);
    const keep = new Set([...graph.heads(), ...state.localHeads]);
    if (graph.prune(keep) > 0) { state.acked = state.acked.filter(id => graph.values.has(id)); await persist(); }
    if (remote.remove && graph.heads().length === 1 && !state.pending && graph.values.size > SYNC_COMPACT_AT) {
      const head = graph.heads()[0]; const retain = new Set<string>(); let level = [head];
      for (let distance = 0; distance < SYNC_RETAIN && level.length; distance++) {
        level.forEach(id => retain.add(id)); level = [...new Set(level.flatMap(id => graph.value(id).parents))].filter(id => graph.values.has(id) && !retain.has(id));
      }
      const removeNow = [...graph.values.keys()].filter(id => !retain.has(id)).sort();
      if (removeNow.length) {
        // Age order is preserved (newest first): new ids, then the predecessors' lists in stored order, nearest compaction first. The cut drops the oldest.
        const inherited: string[] = []; const seen = new Set<string>([head]); let frontier = [head];
        while (frontier.length) {
          for (const id of frontier) inherited.push(...(graph.value(id).compacts ?? []));
          frontier = [...new Set(frontier.flatMap(id => graph.value(id).parents))].filter(id => graph.values.has(id) && !seen.has(id)); frontier.forEach(id => seen.add(id));
        }
        const compacts = [...new Set([...removeNow, ...inherited.filter(id => !retain.has(id))])].slice(0, SYNC_COMPACTS_MAX);
        // Housekeeping: a failed upload/persist leaves C in the checkpoint for the next run (E5); abort and key-change signals still propagate.
        let c: string;
        try { c = graph.create(graph.value(head).portable, [head], compacts); await persist(); await upload(); state.localHeads = [c]; await persist(); }
        catch (error) { if (error instanceof SyncFailure && (error.code === 'locked' || error.code === 'changed')) throw error; return { ...outcome('synced', graph, 0, false, materialized.needsApproval.length), ...(compactedCount > 0 ? { compacted: compactedCount } : {}), snapshot }; }
        await removeAll(removeNow);
        graph.prune(new Set([c])); state.acked = state.acked.filter(id => graph.values.has(id)); await persist();
      }
    }
    return { ...outcome('synced', graph, 0, false, materialized.needsApproval.length), ...(compactedCount > 0 ? { compacted: compactedCount } : {}), snapshot };
  } finally { try { await checkpoint?.close(); } finally { lease.key.fill(0); } }
}

/** Local password input is used only here; it is never passed to remote methods. */
export async function importSyncedVault(sessions: VaultSessionManager, remote: VaultRemote, context: SyncContext, password: string, signal: AbortSignal,
  selectPath: () => Promise<string | undefined>): Promise<VaultSyncResult | undefined> {
  const check = (): void => { ensure(!signal.aborted && !sessions.isUnlocked(), 'locked'); };
  ensure(process.platform === 'linux', 'limit');
  check(); const listing = ids.parse(await remote.list()); check(); ensure(listing.length > 0, 'history');
  // Group candidates by KDF parameter set; derive for the most frequent sets first (at most 8 derivations), so a few foreign objects cannot block the import.
  let key: Buffer | undefined; let graph: Graph | undefined;
  const groups = new Map<string, { kdf: EncryptedVaultFile['kdf']; wires: string[] }>();
  for (const id of listing) {
    const wire = await remote.get(id); check(); ensure(hashWire(wire) === id);
    let kdf: EncryptedVaultFile['kdf'];
    try { kdf = encryptedFile(wire).kdf; } catch (error) { if (error instanceof SyncFailure && error.code === 'limit') throw error; continue; }
    const tag = stable(kdf); const group = groups.get(tag);
    if (group) group.wires.push(wire); else groups.set(tag, { kdf, wires: [wire] });
  }
  for (const { kdf, wires } of [...groups.values()].sort((x, y) => y.wires.length - x.wires.length).slice(0, 8)) {
    const candidate = await keyFromPassword(password, kdf);
    try {
      check();
      for (const wire of wires) {
        const attempt = new Graph(candidate, kdf, context);
        if (attempt.tryAdd(wire) !== null) { graph = attempt; key = candidate; break; }
      }
    } finally { if (candidate !== key) candidate.fill(0); }
    if (key) break;
  }
  ensure(graph && key, 'wrongVault');
  const kdf = graph.kdf; let checkpoint: Awaited<ReturnType<typeof lockSyncState>> | undefined; let reserved: string | undefined; let written = false;
  try {
    check(); const { skipped, foreign } = await pull(remote, graph, [], check); ensure(graph.heads().length === 1, 'conflict');
    const outcome = (status: VaultSyncResult['status'], g: Graph, conflicts = 0, canKeepLocal = false, approvals = 0): VaultSyncResult => ({ ...baseOutcome(status, g, conflicts, canKeepLocal, approvals, skipped), ...(foreign.length ? { foreign } : {}) });
    const head = graph.heads()[0]; const target = graph.value(head).portable; const materialized = materializeVault(target);
    if (!materialized.vault) return outcome('bindings', graph, materialized.needsBindings.length);
    const vault = materialized.vault; const selected = await selectPath(); check(); if (!selected) return undefined;
    const path = ensureVaultFileExtension(selected); const reservation = await open(path, 'wx', 0o600); await reservation.close(); reserved = path;
    checkpoint = await lockSyncState(path, key, kdf, context, check); ensure(await checkpoint.read() === undefined, 'recovery');
    const state: State = { kind: 'shellherd-sync-state-v1', versions: [...graph.wires.values()], acked: [...graph.values.keys()], localHeads: [head], working: target, projection: splitVaultForSync(vault).portable };
    await checkpoint.write(state); check();
    const encrypted = encryptVaultWithKey(vault, key, kdf);
    try {
      await writeEncryptedVaultFile(path, encrypted, async () => { check(); }, { durable: true, onCommitted: () => { written = true; } });
    } catch (error) {
      if (written) ensure(false, 'recovery');
      throw error;
    }
    check();
    const snapshot = sessions.openWithKey(path, encrypted, Buffer.from(key));
    return { ...outcome('synced', graph, 0, false, materialized.needsApproval.length), snapshot };
  } finally { try { await checkpoint?.close(); } finally { key.fill(0); if (reserved && !written) await unlink(reserved); } }
}

/** Re-reads each candidate; deletes only objects that do not AEAD-open under the unlocked vault key. Returns the number actually removed. */
export async function removeForeignObjects(sessions: VaultSessionManager, remote: VaultRemote, context: SyncContext, candidates: string[], signal: AbortSignal): Promise<number> {
  ensure(process.platform === 'linux', 'limit'); ensure(remote.remove, 'limit');
  const lease = await sessions.captureForSync();
  const check = (): void => { ensure(!signal.aborted, 'locked'); lease.assertCurrent(); };
  try {
    const wanted = ids.parse(candidates); check(); const listing = ids.parse(await remote.list()); check();
    let removed = 0;
    for (const id of wanted.filter(candidate => listing.includes(candidate))) {
      const wire = await remote.get(id); check(); ensure(hashWire(wire) === id);
      // Readable = opens under the current key, regardless of schema, vault id or compacts (newer clients stay intact).
      let readable = true;
      try { openDocument(encryptedFile(wire), lease.key, lease.kdf, context, 'version'); } catch (error) { if (error instanceof SyncFailure && error.code === 'limit') throw error; readable = false; }
      if (readable) continue;
      if (await remote.remove(id)) removed++; check();
    }
    return removed;
  } finally { lease.key.fill(0); }
}
