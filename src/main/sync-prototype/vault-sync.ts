/** Manual central sync of the real unlocked Vault. No plaintext in transport/checkpoints. */
import { randomBytes, verify } from 'node:crypto';
import { open, unlink } from 'node:fs/promises';
import { z } from 'zod';
import { encryptVaultWithKey } from '../vault/crypto';
import { ensureVaultFileExtension, writeEncryptedVaultFile } from '../vault/storage';
import type { VaultSessionManager, VaultSessionSnapshot } from '../vault/session';
import { materializeVault, mergePortableVaults, resolveVaultConfigurationConflicts, splitVaultForSync, validatePortableVault } from './vault-merge';
import type { PortableVault } from './vault-merge';
import { SyncFailure, ensure, generateRecoveryCode, hashWire, keyFromPassword, keyboxWrapKey, openSyncObject, parseSyncEnvelope, samePortable, sealSyncObject, stable, validateKdf, versionKey } from './vault-sync-crypto';
import type { SyncContext } from './vault-sync-crypto';
import { lockSyncState } from './vault-sync-state';
import type { StateFile } from './vault-sync-state';
import { normalizeRecoveryCode } from '../../shared/recovery-code';
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
  /** Shown once after a key bootstrap or replacement; must never be stored in state. */
  recoveryCode?: string;
  /** Newly accepted versions whose author is not in the device list. */
  unknownAuthors?: number;
  /** Versions held back because a revoked device wrote them after its revocation or the signature is invalid. */
  quarantined?: number;
  snapshot?: VaultSessionSnapshot;
}
export interface SyncOptions { keepLocalRevision?: string; recoveryCode?: string }
interface Author { device: string; at: number; signature: string }
interface Version { kind: 'shellherd-sync-version-v2'; parents: string[]; portable: PortableVault; compacts?: string[]; author?: Author; /** Hash of the portable as stored (for the author signature). */ digest?: string }
export const SYNC_RETAIN = 16; export const SYNC_COMPACT_AT = 32; export const SYNC_COMPACTS_MAX = 256; const SYNC_KEYBOXES_MAX = 8;
const hex64 = z.string().regex(/^[a-f0-9]{64}$/);
const base64 = (size: number) => z.string().refine(value => { const bytes = Buffer.from(value, 'base64'); return bytes.length === size && bytes.toString('base64') === value; });
const ids = z.array(hex64).max(100).refine(a => new Set(a).size === a.length);
/** Account listing: up to 100 versions plus a few keyboxes. */
const listingIds = z.array(hex64).max(100 + SYNC_KEYBOXES_MAX).refine(a => new Set(a).size === a.length);
const authorSchema = z.object({ device: hex64, at: z.number().refine(Number.isSafeInteger).refine(n => n >= 0), signature: base64(64) }).strict();
const versionSchema = z.object({ kind: z.literal('shellherd-sync-version-v2'), parents: ids.refine(a => a.length <= 16), portable: z.unknown(), compacts: z.array(hex64).max(SYNC_COMPACTS_MAX).refine(a => new Set(a).size === a.length).optional(), author: authorSchema.optional() }).strict();
const keyboxSchema = z.object({ kind: z.literal('shellherd-sync-keybox-v1'), method: z.literal('recovery'), syncKey: base64(32), createdBy: hex64.nullable() }).strict();
const pendingSchema = z.object({ before: z.string(), after: z.string(), localHeads: ids, working: z.unknown(), projection: z.unknown() }).strict();
const stateSchema = z.object({ kind: z.literal('shellherd-sync-state-v2'), syncKey: base64(32), keybox: hex64.optional(), versions: z.array(z.string().max(1048576)).max(100), acked: ids, localHeads: ids, working: z.unknown(), projection: z.unknown(), pending: pendingSchema.optional() }).strict();
type State = z.infer<typeof stateSchema>;
type Stance = 'ok' | 'unknown' | 'suspect';
const documentHash = (vault: Vault) => { const copy = structuredClone(vault); copy.updatedAt = ''; return hashWire(stable(copy)); };
const authorMessage = (context: SyncContext, parents: string[], compacts: string[] | undefined, digest: string, device: string, at: number): Buffer =>
  Buffer.from(JSON.stringify(['shellherd-sync-author-v1', context.serverId, context.namespace, parents, compacts ?? [], digest, device, at]));
class Graph {
  readonly values = new Map<string, Version>(); readonly wires = new Map<string, string>();
  /** Quarantined versions: neither part of the graph nor of the checkpoint; only their `compacts` count for the history check. */
  readonly held = new Map<string, Version>();
  private bytes = 0; private compactedCache?: Set<string>;
  constructor(readonly key: Buffer, readonly context: SyncContext, private vaultId?: string) {}
  /** `null` = unreadable or foreign object; capacity overruns throw `limit`. */
  tryAdd(wire: string): string | null {
    const id = hashWire(wire); if (this.values.has(id)) return id;
    let raw: z.infer<typeof versionSchema>; let portable: PortableVault; let digest: string | undefined;
    try {
      if (parseSyncEnvelope(wire)?.kind !== 'version') return null;
      raw = versionSchema.parse(openSyncObject(wire, 'version', this.key, this.context));
      if (this.context.device && raw.author) digest = hashWire(stable(raw.portable));
      portable = validatePortableVault(raw.portable); ensure(typeof portable.document.id === 'string', 'wrongVault');
      if (this.vaultId && portable.document.id !== this.vaultId) return null;
      if (raw.compacts?.some(c => c === id || raw.parents.includes(c))) return null;
    } catch (error) { if (error instanceof SyncFailure && error.code === 'limit') throw error; return null; }
    ensure(this.values.size + this.held.size < 100 && this.bytes + Buffer.byteLength(wire) <= 32 * 1048576, 'limit');
    if (!this.vaultId) this.vaultId = portable.document.id;
    this.values.set(id, { ...raw, portable, ...(digest ? { digest } : {}) }); this.wires.set(id, wire); this.bytes += Buffer.byteLength(wire); this.compactedCache = undefined; return id;
  }
  add(wire: string): string { const id = this.tryAdd(wire); ensure(id !== null, 'wrongVault'); return id; }
  create(portable: PortableVault, parents: string[], compacts?: string[]): string {
    const validated = validatePortableVault(portable); const sorted = [...parents].sort(); const document: Record<string, unknown> = { kind: 'shellherd-sync-version-v2', parents: sorted, portable: validated, ...(compacts?.length ? { compacts } : {}) };
    const device = this.context.device;
    if (device) {
      const at = Date.now(); const signature = device.sign(authorMessage(this.context, sorted, compacts?.length ? compacts : undefined, hashWire(stable(validated)), device.id, at)); ensure(signature.length === 64, 'wrongVault');
      document.author = { device: device.id, at, signature: signature.toString('base64') };
    }
    return this.add(sealSyncObject('version', document, this.key, this.context));
  }
  /** Author check of a freshly loaded version (only with a device context). */
  stance(id: string): Stance {
    const device = this.context.device; const version = this.value(id);
    if (!device || !version.author || !version.digest) return 'unknown';
    const key = device.keyOf(version.author.device); if (!key) return 'unknown';
    let valid = false;
    try { valid = verify(null, authorMessage(this.context, version.parents, version.compacts, version.digest, version.author.device, version.author.at), key, Buffer.from(version.author.signature, 'base64')); } catch { valid = false; }
    if (!valid) return 'suspect';
    const revoked = device.revokedAt(version.author.device);
    return typeof revoked === 'number' && version.author.at >= revoked ? 'suspect' : 'ok';
  }
  hold(id: string): void { const version = this.value(id); this.drop(id); this.held.set(id, version); }
  validate(): void {
    const done = new Set<string>(); const visiting = new Set<string>();
    const visit = (id: string): void => {
      if (!this.values.has(id)) { ensure(this.compactedAll.has(id), 'history'); return; }
      if (done.has(id)) return; ensure(!visiting.has(id), 'history'); visiting.add(id);
      for (const parent of this.value(id).parents) visit(parent); visiting.delete(id); done.add(id);
    };
    for (const id of this.values.keys()) visit(id);
    const created = new Set([...this.values.values()].map(v => v.portable.document.createdAt)); ensure(created.size <= 1, 'wrongVault');
  }
  value(id: string): Version { const value = this.values.get(id); ensure(value); return value; }
  /** Union of `compacts` over all present (trusted) versions; recomputed after add/drop. */
  get compacted(): Set<string> {
    return this.compactedCache ??= new Set([...this.values.values()].flatMap(v => v.compacts ?? []));
  }
  /** Trusted plus held `compacts`: only for the history check and for tolerating missing parents. */
  get compactedAll(): Set<string> { return new Set([...this.compacted, ...[...this.held.values()].flatMap(v => v.compacts ?? [])]); }
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
function validateState(state: State, graph: Graph): State {
  state.working = validatePortableVault(state.working); state.projection = validatePortableVault(state.projection);
  for (const wire of state.versions) graph.add(wire); graph.validate();
  ensure(state.localHeads.length <= 16 && [...state.acked, ...state.localHeads].every(id => graph.values.has(id)));
  if (state.pending) { state.pending.working = validatePortableVault(state.pending.working); state.pending.projection = validatePortableVault(state.pending.projection); ensure(state.pending.localHeads.every(id => graph.values.has(id))); }
  return state;
}
/** Fetches every listed object the caller does not already hold; the hash must match the id. */
async function fetchNew(remote: VaultRemote, listing: string[], known: (id: string) => boolean, check: () => void): Promise<Map<string, string>> {
  const wires = new Map<string, string>();
  for (const id of listing) {
    if (known(id)) continue;
    const wire = await remote.get(id); check(); ensure(hashWire(wire) === id); wires.set(id, wire);
  }
  return wires;
}
const keyboxesOf = (wires: Map<string, string>): [string, string][] => [...wires].filter(([, wire]) => parseSyncEnvelope(wire)?.kind === 'keybox').sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
function sealKeybox(syncKey: Buffer, code: string, context: SyncContext): string {
  const wrap = keyboxWrapKey(code, context);
  try { return sealSyncObject('keybox', { kind: 'shellherd-sync-keybox-v1', method: 'recovery', syncKey: syncKey.toString('base64'), createdBy: context.device?.id ?? null }, wrap, context); } finally { wrap.fill(0); }
}
/** Opens at most eight keyboxes (sorted by id) with the code; the caller zeroes the returned key. */
function openKeyboxes(keyboxes: [string, string][], code: string, context: SyncContext): Buffer | undefined {
  const wrap = keyboxWrapKey(code, context);
  try {
    for (const [, wire] of keyboxes.slice(0, SYNC_KEYBOXES_MAX)) {
      try { return Buffer.from(keyboxSchema.parse(openSyncObject(wire, 'keybox', wrap, context)).syncKey, 'base64'); } catch { /* not this code */ }
    }
    return undefined;
  } finally { wrap.fill(0); }
}
/** After uploading a keybox: false if another keybox or any version envelope showed up (a concurrent bootstrap or a foreign writer). */
async function confirmKeybox(remote: VaultRemote, own: string, allowed: Set<string>, ignored: Set<string>, check: () => void): Promise<boolean> {
  const listing = listingIds.parse(await remote.list()); check();
  for (const id of listing) {
    if (id === own || allowed.has(id) || ignored.has(id)) continue;
    const wire = await remote.get(id); check(); ensure(hashWire(wire) === id);
    if (parseSyncEnvelope(wire)) return false;
  }
  return true;
}
/** Do not trust omissions of versions already received/acknowledged, even after restart. Foreign objects outside `acked` are skipped and counted. No pruning here. */
function pull(listing: string[], wires: Map<string, string>, graph: Graph, acked: string[]): { received: string[]; skipped: number; foreign: string[]; stale: string[]; quarantined: number; unknownAuthors: number } {
  const before = new Set(graph.values.keys()); const foreign: string[] = []; const loaded: string[] = [];
  for (const id of listing) {
    if (graph.values.has(id)) continue;
    const wire = wires.get(id); ensure(wire !== undefined);
    const kind = parseSyncEnvelope(wire)?.kind;
    if (kind === 'keybox') continue; // Never foreign, never a version, never acked.
    if (kind === 'version' && graph.tryAdd(wire) !== null) { loaded.push(id); continue; }
    ensure(!acked.includes(id), 'history'); foreign.push(id);
  }
  let unknownAuthors = 0;
  if (graph.context.device) {
    // Quarantine (B2): only suspect versions outside every accepted ancestry are held back.
    const stances = new Map(loaded.map(id => [id, graph.stance(id)] as const));
    const accepted = new Set<string>();
    const walk = (id: string): void => { if (accepted.has(id)) return; const v = graph.values.get(id); if (!v) return; accepted.add(id); v.parents.forEach(walk); };
    for (const id of [...before, ...acked, ...loaded.filter(id => stances.get(id) !== 'suspect')]) walk(id);
    for (const id of loaded) if (stances.get(id) === 'suspect' && !accepted.has(id)) graph.hold(id);
    unknownAuthors = loaded.filter(id => stances.get(id) === 'unknown' && accepted.has(id)).length;
  }
  // Zombies: newly loaded versions that an existing (trusted) compaction already covers are discarded (the server kept them).
  const compacted = graph.compacted; for (const id of loaded) if (graph.values.has(id) && compacted.has(id)) graph.drop(id);
  ensure(acked.filter(id => !listing.includes(id)).every(id => graph.compactedAll.has(id)), 'history');
  graph.validate();
  return { received: listing.filter(id => graph.values.has(id)), skipped: foreign.length, foreign, stale: listing.filter(id => graph.compacted.has(id) && !graph.held.has(id)), quarantined: graph.held.size, unknownAuthors };
}
export async function synchronizeVault(sessions: VaultSessionManager, remote: VaultRemote, context: SyncContext, signal: AbortSignal, options: SyncOptions = {}): Promise<VaultSyncResult> {
  const keepLocalRevision = options.keepLocalRevision;
  ensure(process.platform === 'linux', 'limit');
  const lease = await sessions.captureForSync(); let checkpoint: StateFile | undefined; let syncKey: Buffer | undefined; let graphIn: Graph | undefined;
  const check = (): void => { ensure(!signal.aborted, 'locked'); lease.assertCurrent(); };
  try {
    validateKdf(lease.kdf); check();
    checkpoint = await lockSyncState(lease.snapshot.filePath, lease.key, lease.kdf, context, check);
    const local = splitVaultForSync(lease.snapshot.vault);
    const raw = await checkpoint.read(); check();
    let stateIn: State | undefined = raw === undefined ? undefined : stateSchema.parse(raw);
    if (stateIn) { syncKey = Buffer.from(stateIn.syncKey, 'base64'); graphIn = new Graph(versionKey(syncKey, context), context, lease.snapshot.vault.id); stateIn = validateState(stateIn, graphIn); }
    const listing = listingIds.parse(await remote.list()); check();
    const known = graphIn;
    const wires = await fetchNew(remote, listing, id => known?.values.has(id) ?? false, check);
    const keyboxes = keyboxesOf(wires); const versionCount = [...wires.values()].filter(wire => parseSyncEnvelope(wire)?.kind === 'version').length;
    const ignored = new Set([...wires].filter(([, wire]) => parseSyncEnvelope(wire) === null).map(([id]) => id));
    let recoveryCode: string | undefined;
    // Aborts a key bootstrap: take our keybox back, drop the checkpoint, report syncKey.
    const abortBootstrap = async (own: string): Promise<never> => {
      try { await remote.remove?.(own); } catch { /* best effort */ }
      await checkpoint!.remove(); throw new SyncFailure('syncKey');
    };
    if (!stateIn) {
      if (options.recoveryCode !== undefined) {
        const code = normalizeRecoveryCode(options.recoveryCode); ensure(code !== null, 'recoveryCode');
        syncKey = openKeyboxes(keyboxes, code, context); ensure(syncKey, 'recoveryCode');
        stateIn = { kind: 'shellherd-sync-state-v2', syncKey: syncKey.toString('base64'), versions: [], acked: [], localHeads: [], working: local.portable, projection: local.portable };
      } else {
        ensure(keyboxes.length === 0 && versionCount === 0, 'syncKey'); // Another device owns the account key, or versions exist without a keybox.
        syncKey = randomBytes(32); const code = generateRecoveryCode(); const keybox = sealKeybox(syncKey, code, context); const id = hashWire(keybox);
        // Checkpoint first, so a crash after the upload leaves a recoverable (pending) keybox instead of an orphan.
        stateIn = { kind: 'shellherd-sync-state-v2', syncKey: syncKey.toString('base64'), keybox: id, versions: [], acked: [], localHeads: [], working: local.portable, projection: local.portable };
        await checkpoint.write(stateIn); check();
        ensure(await remote.put(keybox) === id); check();
        if (!await confirmKeybox(remote, id, new Set(), ignored, check)) await abortBootstrap(id);
        delete stateIn.keybox; await checkpoint.write(stateIn); check(); recoveryCode = code;
      }
      graphIn = new Graph(versionKey(syncKey, context), context, lease.snapshot.vault.id);
    } else if (stateIn.keybox) {
      // Crash after a bootstrap upload, code never shown: replace the keybox with a fresh code.
      const old = stateIn.keybox; const code = generateRecoveryCode(); const keybox = sealKeybox(syncKey!, code, context); const id = hashWire(keybox);
      stateIn.keybox = id; await checkpoint.write(stateIn); check();
      try { await remote.remove?.(old); } catch { /* 404 or network: the stale keybox stays harmless */ }
      check(); ensure(await remote.put(keybox) === id); check();
      if (!await confirmKeybox(remote, id, new Set([old]), ignored, check)) await abortBootstrap(id);
      delete stateIn.keybox; await checkpoint.write(stateIn); check(); recoveryCode = code;
    }
    const state: State = stateIn!; const graph: Graph = graphIn!;
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
    const { received, skipped, foreign, stale, quarantined, unknownAuthors } = pull(listing, wires, graph, state.acked); check();
    const outcome = (status: VaultSyncResult['status'], g: Graph, conflicts = 0, canKeepLocal = false, approvals = 0): VaultSyncResult => ({
      ...baseOutcome(status, g, conflicts, canKeepLocal, approvals, skipped), ...(foreign.length ? { foreign } : {}),
      ...(recoveryCode ? { recoveryCode } : {}), ...(unknownAuthors ? { unknownAuthors } : {}), ...(quarantined ? { quarantined } : {}),
    });
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
  } finally { try { await checkpoint?.close(); } finally { lease.key.fill(0); syncKey?.fill(0); graphIn?.key.fill(0); } }
}

/** The recovery code opens the account key; the new local password is used only here and never reaches remote methods. */
export async function importSyncedVault(sessions: VaultSessionManager, remote: VaultRemote, context: SyncContext, recoveryCode: string, newPassword: string, signal: AbortSignal,
  selectPath: () => Promise<string | undefined>): Promise<VaultSyncResult | undefined> {
  const check = (): void => { ensure(!signal.aborted && !sessions.isUnlocked(), 'locked'); };
  ensure(process.platform === 'linux', 'limit');
  const code = normalizeRecoveryCode(recoveryCode); ensure(code !== null, 'recoveryCode');
  ensure(typeof newPassword === 'string' && newPassword.length >= 1 && newPassword.length <= 1024, 'wrongVault');
  check(); const listing = listingIds.parse(await remote.list()); check(); ensure(listing.length > 0, 'history');
  const wires = await fetchNew(remote, listing, () => false, check);
  let syncKey = openKeyboxes(keyboxesOf(wires), code, context); ensure(syncKey, 'recoveryCode');
  const graph = new Graph(versionKey(syncKey, context), context);
  let key: Buffer | undefined; let checkpoint: StateFile | undefined; let reserved: string | undefined; let written = false;
  try {
    const { skipped, foreign, quarantined, unknownAuthors } = pull(listing, wires, graph, []); check();
    ensure(graph.values.size > 0, 'history'); ensure(graph.heads().length === 1, 'conflict');
    const outcome = (status: VaultSyncResult['status'], g: Graph, conflicts = 0, canKeepLocal = false, approvals = 0): VaultSyncResult => ({
      ...baseOutcome(status, g, conflicts, canKeepLocal, approvals, skipped), ...(foreign.length ? { foreign } : {}), ...(unknownAuthors ? { unknownAuthors } : {}), ...(quarantined ? { quarantined } : {}),
    });
    const head = graph.heads()[0]; const target = graph.value(head).portable; const materialized = materializeVault(target);
    if (!materialized.vault) return outcome('bindings', graph, materialized.needsBindings.length);
    const vault = materialized.vault; const selected = await selectPath(); check(); if (!selected) return undefined;
    const path = ensureVaultFileExtension(selected); const reservation = await open(path, 'wx', 0o600); await reservation.close(); reserved = path;
    // New salt, new key from the new password. encryptVault would zero the key before openWithKey needs it (K11).
    const kdf: EncryptedVaultFile['kdf'] = { algorithm: 'argon2id', salt: randomBytes(16).toString('base64'), memoryKiB: 65536, iterations: 3, parallelism: 1 };
    key = await keyFromPassword(newPassword, kdf); check();
    checkpoint = await lockSyncState(path, key, kdf, context, check); ensure(await checkpoint.read() === undefined, 'recovery');
    const state: State = { kind: 'shellherd-sync-state-v2', syncKey: syncKey.toString('base64'), versions: [...graph.wires.values()], acked: [...graph.values.keys()], localHeads: [head], working: target, projection: splitVaultForSync(vault).portable };
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
  } finally { try { await checkpoint?.close(); } finally { key?.fill(0); syncKey.fill(0); graph.key.fill(0); if (reserved && !written) await unlink(reserved); } }
}

/** Reads the account key from the checkpoint; without one there is nothing this device may judge. */
function checkpointKey(raw: unknown): Buffer {
  const parsed = z.object({ syncKey: base64(32) }).passthrough().safeParse(raw); ensure(parsed.success, 'syncKey');
  return Buffer.from(parsed.data.syncKey, 'base64');
}

/** Re-reads each candidate; deletes only objects that cannot be read with this account's key. Keyboxes are never removed. Returns the number actually removed. */
export async function removeForeignObjects(sessions: VaultSessionManager, remote: VaultRemote, context: SyncContext, candidates: string[], signal: AbortSignal): Promise<number> {
  ensure(process.platform === 'linux', 'limit'); ensure(remote.remove, 'limit');
  const lease = await sessions.captureForSync(); let checkpoint: StateFile | undefined; let syncKey: Buffer | undefined; let key: Buffer | undefined;
  const check = (): void => { ensure(!signal.aborted, 'locked'); lease.assertCurrent(); };
  try {
    checkpoint = await lockSyncState(lease.snapshot.filePath, lease.key, lease.kdf, context, check);
    const raw = await checkpoint.read(); check(); ensure(raw !== undefined, 'syncKey');
    syncKey = checkpointKey(raw); key = versionKey(syncKey, context);
    const wanted = ids.parse(candidates); check(); const listing = listingIds.parse(await remote.list()); check();
    let removed = 0;
    for (const id of wanted.filter(candidate => listing.includes(candidate))) {
      const wire = await remote.get(id); check(); ensure(hashWire(wire) === id);
      // Readable = a keybox, or a version envelope that opens under the account key, regardless of schema, vault id or compacts (newer clients stay intact).
      const kind = parseSyncEnvelope(wire)?.kind; let readable = kind === 'keybox';
      if (kind === 'version') { try { openSyncObject(wire, 'version', key, context); readable = true; } catch (error) { if (error instanceof SyncFailure && error.code === 'limit') throw error; } }
      if (readable) continue;
      if (await remote.remove(id)) removed++; check();
    }
    return removed;
  } finally { try { await checkpoint?.close(); } finally { lease.key.fill(0); syncKey?.fill(0); key?.fill(0); } }
}

/** Replaces the recovery code: uploads a new keybox and removes every other one. The code is returned only if all old keyboxes are gone (K12). */
export async function regenerateRecoveryCode(sessions: VaultSessionManager, remote: VaultRemote, context: SyncContext, signal: AbortSignal): Promise<{ recoveryCode: string }> {
  ensure(process.platform === 'linux', 'limit'); ensure(remote.remove, 'limit');
  const lease = await sessions.captureForSync(); let checkpoint: StateFile | undefined; let syncKey: Buffer | undefined;
  const check = (): void => { ensure(!signal.aborted, 'locked'); lease.assertCurrent(); };
  try {
    checkpoint = await lockSyncState(lease.snapshot.filePath, lease.key, lease.kdf, context, check);
    const raw = await checkpoint.read(); check(); ensure(raw !== undefined, 'syncKey');
    syncKey = checkpointKey(raw);
    const code = generateRecoveryCode(); const keybox = sealKeybox(syncKey, code, context); const own = hashWire(keybox);
    ensure(await remote.put(keybox) === own); check();
    const listing = listingIds.parse(await remote.list()); check();
    for (const id of listing) {
      if (id === own) continue;
      const wire = await remote.get(id); check(); ensure(hashWire(wire) === id);
      if (parseSyncEnvelope(wire)?.kind !== 'keybox') continue;
      await remote.remove(id); check(); // A failure other than 404 (false) propagates: the code stays unreturned.
    }
    const state = raw as { keybox?: string };
    if (state.keybox !== undefined) { const { keybox: _pending, ...rest } = state; await checkpoint.write(rest); check(); }
    return { recoveryCode: code };
  } finally { try { await checkpoint?.close(); } finally { lease.key.fill(0); syncKey?.fill(0); } }
}
