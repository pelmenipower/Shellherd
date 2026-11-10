/** Manual central sync of the real unlocked Vault. No plaintext in transport/checkpoints. */
import { randomBytes, verify } from 'node:crypto';
import { open, unlink } from 'node:fs/promises';
import { z } from 'zod';
import { encryptVaultWithKey } from '../vault/crypto';
import { ensureVaultFileExtension, writeEncryptedVaultFile } from '../vault/storage';
import type { VaultSessionManager, VaultSessionSnapshot } from '../vault/session';
import { materializeVault, mergePortableVaults, resolveVaultConfigurationConflicts, splitVaultForSync, validatePortableVault } from './vault-merge';
import type { PortableVault } from './vault-merge';
import { SYNC_EPOCH_MAX, SyncFailure, ensure, generateRecoveryCode, hashWire, inviteEnrollSecret, inviteWrapKey, keyFromPassword, keyboxWrapKey, openSyncObject, parseSyncEnvelope, samePortable, sealSyncObject, stable, validateKdf, versionKey } from './vault-sync-crypto';
import type { SyncContext } from './vault-sync-crypto';
import { lockSyncState } from './vault-sync-state';
import type { StateFile } from './vault-sync-state';
import { normalizeRecoveryCode } from '../../shared/recovery-code';
import { VAULT_PASSWORD_MIN_LENGTH } from '../../shared/vault-password';
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
/** At most one of the two codes. */
export interface SyncOptions { keepLocalRevision?: string; recoveryCode?: string; inviteCode?: string }
interface Author { device: string; at: number; signature: string }
interface Version { kind: 'shellherd-sync-version-v2'; parents: string[]; portable: PortableVault; compacts?: string[]; author?: Author; /** Hash of the portable as stored (for the author signature). */ digest?: string }
export const SYNC_RETAIN = 16; export const SYNC_COMPACT_AT = 32; export const SYNC_COMPACTS_MAX = 256;
/** The account holds at most 100 objects; a rotation needs room for two more (K7). */
const ROTATE_LISTING_MAX = 98; const ADOPTS_MAX = 512; const INVITES_MAX = 16; const INVITE_KEEP_MS = 20 * 60_000;
const hex64 = z.string().regex(/^[a-f0-9]{64}$/);
const base64 = (size: number) => z.string().refine(value => { const bytes = Buffer.from(value, 'base64'); return bytes.length === size && bytes.toString('base64') === value; });
const ids = z.array(hex64).max(100).refine(a => new Set(a).size === a.length);
/** Account listing: the server and the transport cap the account at 100 objects in total (keyboxes included). */
const listingSchema = z.array(hex64).max(100).refine(a => new Set(a).size === a.length);
/** Server listing; more than the 100-object quota reports `limit`, anything else malformed throws. */
const listingIds = { parse(value: unknown): string[] { if (Array.isArray(value) && value.length > 100) throw new SyncFailure('limit'); return listingSchema.parse(value); } };
const authorSchema = z.object({ device: hex64, at: z.number().refine(Number.isSafeInteger).refine(n => n >= 0), signature: base64(64) }).strict();
const versionSchema = z.object({ kind: z.literal('shellherd-sync-version-v2'), parents: ids.refine(a => a.length <= 16), portable: z.unknown(), compacts: z.array(hex64).max(SYNC_COMPACTS_MAX).refine(a => new Set(a).size === a.length).optional(), author: authorSchema.optional() }).strict();
const epochSchema = z.number().int().min(1).max(SYNC_EPOCH_MAX);
const adoptsSchema = z.array(hex64).max(ADOPTS_MAX).refine(a => new Set(a).size === a.length);
const keyboxSchema = z.object({ kind: z.literal('shellherd-sync-keybox-v2'), method: z.enum(['recovery', 'invite']), epoch: epochSchema, syncKey: base64(32), createdBy: hex64.nullable(), adopts: adoptsSchema }).strict();
const invitesSchema = z.array(z.object({ id: hex64, at: z.number().refine(Number.isSafeInteger).refine(n => n >= 0) }).strict()).max(INVITES_MAX);
const pendingSchema = z.object({ before: z.string(), after: z.string(), localHeads: ids, working: z.unknown(), projection: z.unknown() }).strict();
const stateSchema = z.object({ kind: z.literal('shellherd-sync-state-v3'), epoch: epochSchema, syncKey: base64(32), adopts: adoptsSchema, keybox: hex64.optional(), /** Objects of a rolled back rotation whose delete failed; the next sync removes them before anything else (m4). */ rollback: ids.optional(), invites: invitesSchema.optional(), versions: z.array(z.string().max(1048576)).max(100), acked: ids, localHeads: ids, working: z.unknown(), projection: z.unknown(), pending: pendingSchema.optional() }).strict();
type State = z.infer<typeof stateSchema>;
/** An inner v2 checkpoint (no epochs) is a migration case, not a schema error (K5). */
function parseState(raw: unknown): State {
  if (raw !== null && typeof raw === 'object' && (raw as { kind?: unknown }).kind === 'shellherd-sync-state-v2') throw new SyncFailure('migrate');
  return stateSchema.parse(raw);
}
type Stance = 'ok' | 'unknown' | 'suspect';
const documentHash = (vault: Vault) => { const copy = structuredClone(vault); copy.updatedAt = ''; return hashWire(stable(copy)); };
const authorMessage = (context: SyncContext, epoch: number, parents: string[], compacts: string[] | undefined, digest: string, device: string, at: number): Buffer =>
  Buffer.from(JSON.stringify(['shellherd-sync-author-v2', context.serverId, context.namespace, epoch, parents, compacts ?? [], digest, device, at]));
class Graph {
  readonly values = new Map<string, Version>(); readonly wires = new Map<string, string>();
  /** Quarantined versions: neither part of the graph nor of the checkpoint; their `compacts` excuse nothing (C9). */
  readonly held = new Map<string, Version>();
  private bytes = 0; private compactedCache?: Set<string>;
  constructor(readonly key: Buffer, readonly context: SyncContext, readonly epoch: number, private vaultId?: string) {}
  /** `null` = unreadable or foreign object; capacity overruns throw `limit`. */
  tryAdd(wire: string): string | null {
    const id = hashWire(wire); if (this.values.has(id)) return id;
    let raw: z.infer<typeof versionSchema>; let portable: PortableVault; let digest: string | undefined;
    try {
      const envelope = parseSyncEnvelope(wire); if (envelope?.kind !== 'version' || envelope.epoch !== this.epoch) return null;
      raw = versionSchema.parse(openSyncObject(wire, 'version', this.key, this.context, this.epoch));
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
      const at = Date.now(); const signature = device.sign(authorMessage(this.context, this.epoch, sorted, compacts?.length ? compacts : undefined, hashWire(stable(validated)), device.id, at)); ensure(signature.length === 64, 'wrongVault');
      document.author = { device: device.id, at, signature: signature.toString('base64') };
    }
    return this.add(sealSyncObject('version', document, this.key, this.context, this.epoch));
  }
  /** Author check of a freshly loaded version (only with a device context). */
  stance(id: string): Stance {
    const device = this.context.device; const version = this.value(id);
    if (!device || !version.author || !version.digest) return 'unknown';
    const key = device.keyOf(version.author.device); if (!key) return 'unknown';
    let valid = false;
    try { valid = verify(null, authorMessage(this.context, this.epoch, version.parents, version.compacts, version.digest, version.author.device, version.author.at), key, Buffer.from(version.author.signature, 'base64')); } catch { valid = false; }
    if (!valid) return 'suspect';
    const revoked = device.revokedAt(version.author.device);
    return typeof revoked === 'number' && version.author.at >= revoked ? 'suspect' : 'ok';
  }
  hold(id: string): void { const version = this.value(id); this.drop(id); this.held.set(id, version); }
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
  /** Union of `compacts` over all present (trusted) versions; recomputed after add/drop. */
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
type Envelope = { kind: 'version' | 'keybox'; epoch: number };
type KeyboxMethod = 'recovery' | 'invite';
interface CodeSecret { method: KeyboxMethod; code: string }
const byId = ([a]: [string, unknown], [b]: [string, unknown]) => a < b ? -1 : a > b ? 1 : 0;
const codeFailure = (method: KeyboxMethod) => method === 'invite' ? 'inviteKey' as const : 'recoveryCode' as const;
function secretOf(options: { recoveryCode?: string; inviteCode?: string }): CodeSecret | undefined {
  ensure(options.recoveryCode === undefined || options.inviteCode === undefined, 'recoveryCode');
  if (options.inviteCode !== undefined) return { method: 'invite', code: options.inviteCode };
  return options.recoveryCode !== undefined ? { method: 'recovery', code: options.recoveryCode } : undefined;
}
function sealKeybox(syncKey: Buffer, code: string, method: KeyboxMethod, epoch: number, adopts: string[], context: SyncContext): string {
  const wrap = method === 'invite' ? inviteWrapKey(code, context, epoch) : keyboxWrapKey(code, context, epoch);
  try { return sealSyncObject('keybox', { kind: 'shellherd-sync-keybox-v2', method, epoch, syncKey: syncKey.toString('base64'), createdBy: context.device?.id ?? null, adopts }, wrap, context, epoch); } finally { wrap.fill(0); }
}
interface OpenedKeybox { id: string; syncKey: Buffer; adopts: string[]; createdBy: string | null; method: KeyboxMethod }
/** Tries every keybox of the epoch (sorted by id, at most the 100-object account quota) with the code; the caller zeroes the returned key (B10). */
function openKeyboxes(wires: Map<string, string>, ids: string[], secret: CodeSecret, epoch: number, context: SyncContext): OpenedKeybox | undefined {
  const wrap = secret.method === 'invite' ? inviteWrapKey(secret.code, context, epoch) : keyboxWrapKey(secret.code, context, epoch);
  try {
    for (const id of [...ids].sort().slice(0, 100)) {
      try {
        const doc = keyboxSchema.parse(openSyncObject(wires.get(id)!, 'keybox', wrap, context, epoch));
        if (doc.method === secret.method && doc.epoch === epoch) return { id, syncKey: Buffer.from(doc.syncKey, 'base64'), adopts: doc.adopts, createdBy: doc.createdBy, method: doc.method };
      } catch { /* not this code */ }
    }
    return undefined;
  } finally { wrap.fill(0); }
}
/** Target epoch = the largest envelope epoch; its keyboxes are tried with the code. A code that only opens an epoch between `after` and the target is stale (`rotated`). Nothing is written (A1). */
function openTarget(envs: Map<string, Envelope | null>, wires: Map<string, string>, secret: CodeSecret, context: SyncContext, after: number): { epoch: number; opened: OpenedKeybox } {
  const epochs = [...new Set([...envs.values()].flatMap(e => e ? [e.epoch] : []))].sort((x, y) => y - x);
  ensure(epochs.length > 0, codeFailure(secret.method));
  const keyboxIdsOf = (epoch: number) => [...envs].filter(([, e]) => e?.kind === 'keybox' && e.epoch === epoch).map(([id]) => id);
  const opened = openKeyboxes(wires, keyboxIdsOf(epochs[0]), secret, epochs[0], context);
  if (opened) return { epoch: epochs[0], opened };
  for (const epoch of epochs.slice(1)) {
    if (epoch <= after) break;
    const stale = openKeyboxes(wires, keyboxIdsOf(epoch), secret, epoch, context);
    if (stale) { stale.syncKey.fill(0); ensure(false, 'rotated'); }
  }
  throw new SyncFailure(codeFailure(secret.method));
}
/**
 * A code alone proves nothing about a higher epoch: a leaked old recovery code can wrap a keybox for any epoch (M1).
 * With a device context the epoch is accepted only if a readable version of it carries a valid author stamp of a device
 * that is known, not revoked and acknowledged by the user (R1: the server can add roster entries at will). The stamp binds
 * the epoch, so any such device proves it held the epoch's key; the rotator itself may have been revoked or compacted away
 * since (R2). Without a device context there is no roster to judge by. Throws `foreignKey` before anything is written.
 */
function vetEpoch(graph: Graph, _opened: OpenedKeybox): void {
  const device = graph.context.device; if (!device) return;
  const vouches = (id: string): boolean => device.keyOf(id) !== undefined && (device.revokedAt(id) ?? null) === null && (device.trusted?.(id) ?? true);
  ensure([...graph.values.keys()].some(id => { const author = graph.value(id).author?.device; return author !== undefined && vouches(author) && graph.stance(id) === 'ok'; }), 'foreignKey');
}
/** After uploading a keybox: false if another keybox or any version envelope of this or a newer epoch showed up (a concurrent bootstrap or a foreign writer). Older epochs are leftovers of a rotation and ignored (B2). */
async function confirmKeybox(remote: VaultRemote, own: string, allowed: Set<string>, ignored: Set<string>, epoch: number, check: () => void): Promise<boolean> {
  const listing = listingIds.parse(await remote.list()); check();
  for (const id of listing) {
    if (id === own || allowed.has(id) || ignored.has(id)) continue;
    const wire = await remote.get(id); check(); ensure(hashWire(wire) === id);
    const envelope = parseSyncEnvelope(wire);
    if (envelope && envelope.epoch >= epoch) return false;
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
  ensure(acked.filter(id => !listing.includes(id)).every(id => graph.compacted.has(id)), 'history');
  graph.validate();
  return { received: listing.filter(id => graph.values.has(id)), skipped: foreign.length, foreign, stale: listing.filter(id => graph.compacted.has(id) && !graph.held.has(id)), quarantined: graph.held.size, unknownAuthors };
}
export async function synchronizeVault(sessions: VaultSessionManager, remote: VaultRemote, context: SyncContext, signal: AbortSignal, options: SyncOptions = {}): Promise<VaultSyncResult> {
  const keepLocalRevision = options.keepLocalRevision;
  ensure(process.platform === 'linux', 'platform');
  const secret = secretOf(options);
  const lease = await sessions.captureForSync(); let checkpoint: StateFile | undefined; let syncKey: Buffer | undefined; let graphIn: Graph | undefined;
  const check = (): void => { ensure(!signal.aborted, 'locked'); lease.assertCurrent(); };
  try {
    validateKdf(lease.kdf); check();
    checkpoint = await lockSyncState(lease.snapshot.filePath, lease.key, lease.kdf, context, check);
    const local = splitVaultForSync(lease.snapshot.vault);
    const raw = await checkpoint.read(); check();
    let stateIn: State | undefined = raw === undefined ? undefined : parseState(raw);
    const knownEpoch = stateIn?.epoch;
    if (stateIn) { syncKey = Buffer.from(stateIn.syncKey, 'base64'); graphIn = new Graph(versionKey(syncKey, context, stateIn.epoch), context, stateIn.epoch, lease.snapshot.vault.id); stateIn = validateState(stateIn, graphIn); }
    // A rolled back rotation left objects of a newer epoch behind: remove them first, or every device would see `rotated` for good (m4).
    if (stateIn?.rollback?.length) {
      ensure(remote.remove, 'rotated');
      for (const id of stateIn.rollback) { check(); await remote.remove(id); }
      check(); delete stateIn.rollback; await checkpoint.write(stateIn); check();
    }
    const listing = listingIds.parse(await remote.list()); check();
    const known = graphIn;
    const wires = await fetchNew(remote, listing, id => known?.values.has(id) ?? false, check);
    // Epoch of every listed object; ids already in the graph belong to the checkpoint epoch, unreadable ones are `null`.
    const envs = new Map<string, Envelope | null>(listing.map(id => [id, wires.has(id) ? parseSyncEnvelope(wires.get(id)!) : { kind: 'version' as const, epoch: knownEpoch! }]));
    const idsOf = (pick: (e: Envelope) => boolean): string[] => listing.filter(id => { const e = envs.get(id); return e !== null && e !== undefined && pick(e); });
    const ignored = new Set(listing.filter(id => envs.get(id) === null));
    let joinedKeybox: OpenedKeybox | undefined; let recoveryCode: string | undefined; let inviteKeybox: string | undefined; let pulled: ReturnType<typeof pull> | undefined; let recoveredSnapshot: VaultSessionSnapshot | undefined;
    // While the pending marker stands, no code for this sync key ever left the device, so nobody else can read our objects:
    // take them back (best effort) and drop the checkpoint; the local Vault holds the data. The next run can take the rival's code (R2).
    const abortBootstrap = async (own: string, uploaded: string[] = []): Promise<never> => {
      for (const id of [own, ...uploaded]) { try { await remote.remove?.(id); } catch { /* unreadable leftovers stay foreign for everyone */ } }
      await checkpoint!.remove(); throw new SyncFailure('syncKey');
    };
    const resolvePending = (state: State): void => {
      if (!state.pending) return;
      const current = documentHash(lease.snapshot.vault);
      if (current === state.pending.after) {
        Object.assign(state, { localHeads: state.pending.localHeads, working: state.pending.working, projection: state.pending.projection });
        recoveredSnapshot = lease.snapshot;
      }
      else ensure(current === state.pending.before, 'recovery');
      delete state.pending;
    };
    if (!stateIn) {
      if (secret !== undefined) {
        const { epoch, opened } = openTarget(envs, wires, secret, context, 0);
        syncKey = opened.syncKey; joinedKeybox = opened; if (secret.method === 'invite') inviteKeybox = opened.id;
        stateIn = { kind: 'shellherd-sync-state-v3', epoch, syncKey: syncKey.toString('base64'), adopts: opened.adopts, versions: [], acked: [], localHeads: [], working: local.portable, projection: local.portable };
        graphIn = new Graph(versionKey(syncKey, context, epoch), context, epoch, lease.snapshot.vault.id);
      } else {
        ensure(!idsOf(() => true).length, 'syncKey'); // Another device owns the account key, or versions exist without a keybox.
        syncKey = randomBytes(32); const code = generateRecoveryCode(); const keybox = sealKeybox(syncKey, code, 'recovery', 1, [], context); const id = hashWire(keybox);
        // Checkpoint first, so a crash after the upload leaves a recoverable (pending) keybox instead of an orphan.
        stateIn = { kind: 'shellherd-sync-state-v3', epoch: 1, syncKey: syncKey.toString('base64'), adopts: [], keybox: id, versions: [], acked: [], localHeads: [], working: local.portable, projection: local.portable };
        await checkpoint.write(stateIn); check();
        ensure(await remote.put(keybox) === id); check();
        if (!await confirmKeybox(remote, id, new Set(), ignored, 1, check)) await abortBootstrap(id);
        recoveryCode = code; // The pending marker stays until a result carrying the code is returned (see `settle`).
        graphIn = new Graph(versionKey(syncKey, context, 1), context, 1, lease.snapshot.vault.id);
      }
    } else if (idsOf(e => e.epoch > stateIn!.epoch).length) {
      // Another device rotated the key. Without a code nothing is written; with the matching code this device adopts the new epoch (B1).
      ensure(secret !== undefined, 'rotated');
      resolvePending(stateIn); // `pending.localHeads` refers to the old graph (K6).
      const { epoch, opened } = openTarget(envs, wires, secret, context, stateIn.epoch);
      if (secret.method === 'invite') inviteKeybox = opened.id;
      const adopted = new Graph(versionKey(opened.syncKey, context, epoch), context, epoch, lease.snapshot.vault.id);
      const inEpoch = listing.filter(id => { const e = envs.get(id); return e === null || e?.epoch === epoch; });
      try {
        pulled = pull(inEpoch, wires, adopted, []); vetEpoch(adopted, opened);
        ensure(adopted.heads().length === 1, 'conflict'); const head = adopted.heads()[0];
        const oldGraph = graphIn!; const heads = stateIn.localHeads; const own = new Set(opened.adopts);
        // Local edits since the last sync, on top of the old working copy.
        let working: PortableVault = stateIn.working as PortableVault;
        if (!samePortable(local.portable, stateIn.projection)) { const changed = mergePortableVaults(stateIn.projection as PortableVault, local.portable, working); ensure(changed.portable !== null, 'conflict'); working = changed.portable; }
        // Base: what the rotating device knew (`adopts`) of this device's history; versions it did not know are merged, not lost.
        let base: PortableVault;
        if (heads.every(id => own.has(id))) base = stateIn.working as PortableVault;
        else {
          const reach = new Set(heads.flatMap(id => [...oldGraph.ancestors(id)])); const candidates = [...reach].filter(id => own.has(id));
          const maximal = candidates.filter(id => !candidates.some(other => other !== id && oldGraph.ancestors(other).has(id)));
          ensure(maximal.length === 1, 'conflict'); base = oldGraph.value(maximal[0]).portable;
        }
        let localHeads = [head]; let adoptedWorking = adopted.value(head).portable;
        if (!samePortable(working, base)) {
          const merged = mergePortableVaults(base, working, adoptedWorking); ensure(merged.portable !== null, 'conflict');
          adoptedWorking = merged.portable; localHeads = [adopted.create(merged.portable, [head])];
        }
        stateIn = { kind: 'shellherd-sync-state-v3', epoch, syncKey: opened.syncKey.toString('base64'), adopts: opened.adopts, versions: [...adopted.wires.values()], acked: pulled.received, localHeads, working: adoptedWorking, projection: local.portable };
      } catch (error) { opened.syncKey.fill(0); adopted.key.fill(0); throw error; }
      syncKey!.fill(0); graphIn!.key.fill(0); syncKey = opened.syncKey; graphIn = adopted;
    } else if (stateIn.keybox) {
      // Crash after a bootstrap or rotation upload, code never shown: replace the keybox with a fresh code.
      // The old keybox goes first and must be gone (removed or 404); a network error ends the run with the marker unchanged (R1).
      const old = stateIn.keybox; const allowed = new Set([...stateIn.acked, ...graphIn!.values.keys()]);
      if (!listing.includes(old)) { /* never uploaded or already removed */ }
      else if (remote.remove) { await remote.remove(old); check(); }
      else allowed.add(old); // H1 server without DELETE: tolerate the leftover.
      const code = generateRecoveryCode(); const keybox = sealKeybox(syncKey!, code, 'recovery', stateIn.epoch, stateIn.adopts, context); const id = hashWire(keybox);
      stateIn.keybox = id; await checkpoint.write(stateIn); check();
      ensure(await remote.put(keybox) === id); check();
      // A failed earlier run may already have uploaded own versions.
      if (!await confirmKeybox(remote, id, allowed, ignored, stateIn.epoch, check)) await abortBootstrap(id, [...graphIn!.values.keys()].filter(v => listing.includes(v)));
      recoveryCode = code;
    }
    const state: State = stateIn!; const graph: Graph = graphIn!;
    resolvePending(state);
    // Older epochs are leftovers of a rotation: out of the working listing now, deleted only after a successful run (B2).
    const lower = idsOf(e => e.epoch < state.epoch);
    const current = listing.filter(id => { const e = envs.get(id); return e === null || e?.epoch === state.epoch; });
    const { received, skipped, foreign, stale, quarantined, unknownAuthors } = pulled ?? pull(current, wires, graph, state.acked); check();
    if (joinedKeybox && state.epoch > 1) vetEpoch(graph, joinedKeybox); // A device joining by code has no earlier epoch to compare with (M1).
    const outcome = (status: VaultSyncResult['status'], g: Graph, conflicts = 0, canKeepLocal = false, approvals = 0): VaultSyncResult => ({
      ...baseOutcome(status, g, conflicts, canKeepLocal, approvals, skipped), ...(foreign.length ? { foreign } : {}),
      ...(recoveryCode ? { recoveryCode } : {}), ...(unknownAuthors ? { unknownAuthors } : {}), ...(quarantined ? { quarantined } : {}),
    });
    const persist = async (): Promise<void> => { state.versions = [...graph.wires.values()]; await checkpoint!.write(state); check(); };
    // Clears the pending keybox marker right before a result (with the recovery code) is returned; an exception keeps it for the next run.
    // The write ignores aborts and nothing checks afterwards: an abort must not swallow the one-time code (R3).
    const settle = async (): Promise<void> => { if (state.keybox) { delete state.keybox; state.versions = [...graph.wires.values()]; await checkpoint!.write(state, { ignoreAbort: true }); } };
    // Only after a `synced` run: delete older epochs and stale invite keyboxes with housekeeping semantics (stop quietly at the first failure, signals propagate), then settle.
    const finishSynced = async (): Promise<void> => {
      if (remote.remove) {
        let failed = false;
        for (const id of lower) { check(); try { await remote.remove(id); } catch { failed = true; break; } check(); }
        const expired = failed ? [] : (state.invites ?? []).filter(invite => Date.now() - invite.at > INVITE_KEEP_MS); const gone = new Set<string>();
        for (const invite of expired) { check(); try { await remote.remove(invite.id); } catch { break; } gone.add(invite.id); }
        if (gone.size) { const rest = (state.invites ?? []).filter(invite => !gone.has(invite.id)); if (rest.length) state.invites = rest; else delete state.invites; await persist(); }
        if (inviteKeybox !== undefined) { try { check(); await remote.remove(inviteKeybox); } catch (error) { if (error instanceof SyncFailure && (error.code === 'locked' || error.code === 'changed')) throw error; } }
      }
      await settle();
    };
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
      if (heads.length !== 2) { await settle(); return outcome('conflict', graph, heads.length); }
      const localHead = heads.find(id => state.localHeads.includes(id));
      const left = localHead ?? heads[0]; const right = heads.find(id => id !== left)!; const base = graph.base(left, right);
      if (!base) { await settle(); return outcome('conflict', graph, 1); }
      const b = graph.value(base).portable; const l = graph.value(left).portable; const r = graph.value(right).portable;
      const merged = mergePortableVaults(b, l, r);
      const canKeepLocal = Boolean(localHead) && merged.conflicts.length > 0 && merged.conflicts.every(c => c.scope === 'node' && c.field === 'configuration-or-move');
      if (!merged.portable) {
        // Consent is valid only for the exact local document and conflicting history the user saw.
        const conflictRevision = hashWire(stable([heads, documentHash(lease.snapshot.vault)]));
        if (!canKeepLocal || keepLocalRevision !== conflictRevision) {
          await settle();
          return {
            ...outcome('conflict', graph, merged.conflicts.length, canKeepLocal),
            ...(canKeepLocal ? { conflictRevision } : {}),
            ...(recoveredSnapshot ? { snapshot: recoveredSnapshot } : {}),
          };
        }
        target = resolveVaultConfigurationConflicts(b, l, r, merged.conflicts.map(c => ({ id: c.id, side: 'left' as const })));
      } else target = merged.portable;
      targetHeads = [graph.create(target, heads)]; await persist(); await upload();
    }
    const materialized = materializeVault(target, local.local);
    if (!materialized.vault) { await settle(); return outcome('bindings', graph, materialized.needsBindings.length); }
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
        catch (error) { if (error instanceof SyncFailure && (error.code === 'locked' || error.code === 'changed')) throw error; await finishSynced(); return { ...outcome('synced', graph, 0, false, materialized.needsApproval.length), ...(compactedCount > 0 ? { compacted: compactedCount } : {}), snapshot }; }
        await removeAll(removeNow);
        graph.prune(new Set([c])); state.acked = state.acked.filter(id => graph.values.has(id)); await persist();
      }
    }
    await finishSynced();
    return { ...outcome('synced', graph, 0, false, materialized.needsApproval.length), ...(compactedCount > 0 ? { compacted: compactedCount } : {}), snapshot };
  } finally { try { await checkpoint?.close(); } finally { lease.key.fill(0); syncKey?.fill(0); graphIn?.key.fill(0); } }
}

/** With a device context, `author.at` counts only when the signature of a known, not yet revoked roster device verifies; else -1 (N1). */
function trustedAt(raw: z.infer<typeof versionSchema>, context: SyncContext, epoch: number): number {
  const device = context.device; const author = raw.author; if (!author) return -1;
  if (!device) return author.at; // No roster to verify against (device-less context).
  const key = device.keyOf(author.device); if (!key) return -1;
  try {
    if (!verify(null, authorMessage(context, epoch, raw.parents, raw.compacts, hashWire(stable(raw.portable)), author.device, author.at), key, Buffer.from(author.signature, 'base64'))) return -1;
  } catch { return -1; }
  const revoked = device.revokedAt(author.device);
  return typeof revoked === 'number' && author.at >= revoked ? -1 : author.at;
}

/** Id of the vault whose readable version has the largest `author.at` (missing = -1); ties go to the smaller object id (C10). */
function newestVaultId(wires: Map<string, string>, syncKey: Buffer, context: SyncContext, epoch: number): string | undefined {
  const key = versionKey(syncKey, context, epoch); let best: { id: string; at: number; vault: string } | undefined;
  try {
    for (const [id, wire] of wires) {
      const envelope = parseSyncEnvelope(wire); if (envelope?.kind !== 'version' || envelope.epoch !== epoch) continue;
      let vault: string; let at: number;
      try {
        const raw = versionSchema.parse(openSyncObject(wire, 'version', key, context, epoch)); const portable = validatePortableVault(raw.portable);
        if (typeof portable.document.id !== 'string') continue; vault = portable.document.id; at = trustedAt(raw, context, epoch);
      } catch (error) { if (error instanceof SyncFailure && error.code === 'limit') throw error; continue; }
      if (!best || at > best.at || (at === best.at && id < best.id)) best = { id, at, vault };
    }
  } finally { key.fill(0); }
  return best?.vault;
}

/** A code opens the account key (recovery code or enrollment code); the new local password is used only here and never reaches remote methods. */
export async function importSyncedVault(sessions: VaultSessionManager, remote: VaultRemote, context: SyncContext, codeIn: { recoveryCode: string } | { inviteCode: string }, newPassword: string, signal: AbortSignal,
  selectPath: () => Promise<string | undefined>): Promise<VaultSyncResult | undefined> {
  const check = (): void => { ensure(!signal.aborted && !sessions.isUnlocked(), 'locked'); };
  ensure(process.platform === 'linux', 'platform');
  const secret = secretOf(codeIn); ensure(secret !== undefined, 'recoveryCode');
  const code = normalizeRecoveryCode(secret.code); ensure(code !== null, codeFailure(secret.method));
  ensure(typeof newPassword === 'string' && newPassword.length >= VAULT_PASSWORD_MIN_LENGTH && newPassword.length <= 1024, 'wrongVault');
  check(); const listing = listingIds.parse(await remote.list()); check(); ensure(listing.length > 0, 'history');
  const wires = await fetchNew(remote, listing, () => false, check);
  const envs = new Map<string, Envelope | null>(listing.map(id => [id, parseSyncEnvelope(wires.get(id)!)]));
  const { epoch, opened } = openTarget(envs, wires, { method: secret.method, code }, context, 0);
  const syncKey = opened.syncKey;
  const graph = new Graph(versionKey(syncKey, context, epoch), context, epoch, newestVaultId(wires, syncKey, context, epoch));
  let key: Buffer | undefined; let checkpoint: StateFile | undefined; let reserved: string | undefined; let written = false;
  try {
    // Objects of other epochs are ignored, not foreign.
    const { skipped, foreign, quarantined, unknownAuthors } = pull(listing.filter(id => { const e = envs.get(id); return e === null || e?.epoch === epoch; }), wires, graph, []); check();
    ensure(graph.values.size > 0, 'history'); if (epoch > 1) vetEpoch(graph, opened); ensure(graph.heads().length === 1, 'conflict');
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
    const state: State = { kind: 'shellherd-sync-state-v3', epoch, syncKey: syncKey.toString('base64'), adopts: opened.adopts, versions: [...graph.wires.values()], acked: [...graph.values.keys()], localHeads: [head], working: target, projection: splitVaultForSync(vault).portable };
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
    // An enrollment keybox has done its job: remove it best effort (no count, no check; the vault is open now).
    if (secret.method === 'invite') { try { await remote.remove?.(opened.id); } catch { /* the server drops it after ten minutes anyway */ } }
    return { ...outcome('synced', graph, 0, false, materialized.needsApproval.length), snapshot };
  } finally { try { await checkpoint?.close(); } finally { key?.fill(0); syncKey.fill(0); graph.key.fill(0); if (reserved && !written) await unlink(reserved); } }
}

/** Reads the account key and epoch from the checkpoint; without one there is nothing this device may judge (K9). */
function checkpointKey(raw: unknown): { syncKey: Buffer; epoch: number } {
  if (raw !== null && typeof raw === 'object' && (raw as { kind?: unknown }).kind === 'shellherd-sync-state-v2') throw new SyncFailure('migrate');
  const parsed = stateSchema.safeParse(raw); ensure(parsed.success, 'syncKey');
  return { syncKey: Buffer.from(parsed.data.syncKey, 'base64'), epoch: parsed.data.epoch };
}

/** Re-reads each candidate. Unreadable envelopes and older epochs always go; version envelopes of the current epoch that the account key cannot open only with `options.versions` (B8). Keyboxes, newer epochs and readable versions never go. Returns the number actually removed. */
export async function removeForeignObjects(sessions: VaultSessionManager, remote: VaultRemote, context: SyncContext, candidates: string[], signal: AbortSignal, options: { versions?: boolean } = {}): Promise<number> {
  ensure(process.platform === 'linux', 'platform'); ensure(remote.remove, 'limit');
  const lease = await sessions.captureForSync(); let checkpoint: StateFile | undefined; let syncKey: Buffer | undefined; let key: Buffer | undefined;
  const check = (): void => { ensure(!signal.aborted, 'locked'); lease.assertCurrent(); };
  try {
    checkpoint = await lockSyncState(lease.snapshot.filePath, lease.key, lease.kdf, context, check);
    const raw = await checkpoint.read(); check(); ensure(raw !== undefined, 'syncKey');
    const opened = checkpointKey(raw); syncKey = opened.syncKey; key = versionKey(syncKey, context, opened.epoch);
    const wanted = ids.parse(candidates); check(); const listing = listingIds.parse(await remote.list()); check();
    let removed = 0;
    for (const id of wanted.filter(candidate => listing.includes(candidate))) {
      const wire = await remote.get(id); check(); ensure(hashWire(wire) === id);
      // Readable = a keybox, a newer epoch, or a version envelope that opens under the account key, regardless of schema, vault id or compacts (newer clients stay intact).
      const envelope = parseSyncEnvelope(wire); let readable = false;
      if (envelope?.kind === 'keybox' || (envelope !== null && envelope.epoch > opened.epoch)) readable = true;
      else if (envelope?.kind === 'version' && envelope.epoch === opened.epoch) {
        readable = options.versions !== true;
        if (options.versions === true) { try { openSyncObject(wire, 'version', key, context, opened.epoch); readable = true; } catch (error) { if (error instanceof SyncFailure && error.code === 'limit') throw error; } }
      }
      if (readable) continue;
      if (await remote.remove(id)) removed++; check();
    }
    return removed;
  } finally { try { await checkpoint?.close(); } finally { lease.key.fill(0); syncKey?.fill(0); key?.fill(0); } }
}

/** Reads and validates the v3 checkpoint for rotation and invites; anything unusable means there is no key to work with. */
function stateForKeyWork(raw: unknown): State {
  try { return parseState(raw); } catch (error) { if (error instanceof SyncFailure) throw error; throw new SyncFailure('syncKey'); }
}
const sortedIds = (ids: Iterable<string>): string[] => [...new Set(ids)].sort();

/**
 * Rotates the account key: a new epoch with a fresh key, one root version (the current head) and a recovery keybox.
 * The checkpoint is written first (pending marker) so a crash is repaired by the next sync. Older epochs are deleted only afterwards (B2);
 * a version of the old epoch this device never saw blocks the rotation or rolls it back (B1).
 */
export async function rotateSyncKey(sessions: VaultSessionManager, remote: VaultRemote, context: SyncContext, signal: AbortSignal): Promise<{ recoveryCode: string }> {
  ensure(process.platform === 'linux', 'platform'); ensure(remote.remove, 'limit');
  const lease = await sessions.captureForSync(); let checkpoint: StateFile | undefined; let syncKey: Buffer | undefined; let nextKey: Buffer | undefined; let oldGraph: Graph | undefined; let nextGraph: Graph | undefined;
  const check = (): void => { ensure(!signal.aborted, 'locked'); lease.assertCurrent(); };
  try {
    checkpoint = await lockSyncState(lease.snapshot.filePath, lease.key, lease.kdf, context, check);
    const raw = await checkpoint.read(); check(); ensure(raw !== undefined, 'syncKey');
    const state = stateForKeyWork(raw); syncKey = Buffer.from(state.syncKey, 'base64'); const epoch = state.epoch;
    oldGraph = new Graph(versionKey(syncKey, context, epoch), context, epoch, lease.snapshot.vault.id); validateState(state, oldGraph); const graph = oldGraph;
    ensure(!state.pending && !state.keybox && !state.rollback, 'rotateBlocked');
    const local = splitVaultForSync(lease.snapshot.vault); const heads = graph.heads();
    ensure(samePortable(local.portable, state.projection), 'rotateBlocked');
    ensure(heads.length === 1 && stable(state.localHeads) === stable(heads), 'rotateBlocked');
    // Everything on the server must be known: a foreign key, a newer epoch or an unseen version of this epoch means this device cannot rotate safely.
    const listing = listingIds.parse(await remote.list()); check();
    const wires = await fetchNew(remote, listing, id => graph.values.has(id), check);
    const envelopes = (list: string[]): Map<string, Envelope | null> => new Map(list.map(id => [id, wires.has(id) ? parseSyncEnvelope(wires.get(id)!) : { kind: 'version' as const, epoch }]));
    const unseenVersions = (list: string[], envs: Map<string, Envelope | null>): { foreign: boolean; unseen: boolean } => {
      let foreign = false; let unseen = false;
      for (const id of list) {
        const e = envs.get(id); if (e?.kind !== 'version' || e.epoch !== epoch || graph.values.has(id)) continue;
        try { openSyncObject(wires.get(id)!, 'version', graph.key, context, epoch); } catch (error) { if (error instanceof SyncFailure && error.code === 'limit') throw error; foreign = true; continue; }
        if (!graph.compacted.has(id)) unseen = true;
      }
      return { foreign, unseen };
    };
    const envs1 = envelopes(listing);
    ensure(![...envs1.values()].some(e => e && e.epoch > epoch), 'rotated');
    const seen1 = unseenVersions(listing, envs1); ensure(!seen1.foreign, 'foreignKey'); ensure(!seen1.unseen, 'rotateBlocked');
    ensure(state.acked.every(id => listing.includes(id) || graph.compacted.has(id)), 'history');
    ensure(listing.length <= ROTATE_LISTING_MAX, 'limit');
    const next = epoch + 1; ensure(next <= SYNC_EPOCH_MAX, 'limit');
    const adopts = sortedIds([...graph.values.keys(), ...graph.compacted]); ensure(adopts.length <= ADOPTS_MAX, 'limit');
    nextKey = randomBytes(32); const code = generateRecoveryCode(); const head = graph.value(heads[0]);
    nextGraph = new Graph(versionKey(nextKey, context, next), context, next, lease.snapshot.vault.id);
    const root = nextGraph.create(head.portable, []); const keybox = sealKeybox(nextKey, code, 'recovery', next, adopts, context); const keyboxId = hashWire(keybox);
    const before = structuredClone(state);
    // Checkpoint first: a crash from here on is repaired by the retry path of the next sync (pending keybox marker).
    await checkpoint.write({ kind: 'shellherd-sync-state-v3', epoch: next, syncKey: nextKey.toString('base64'), adopts, keybox: keyboxId, versions: [...nextGraph.wires.values()], acked: [], localHeads: [root], working: head.portable, projection: state.projection }); check();
    wires.set(keyboxId, keybox); wires.set(root, nextGraph.wires.get(root)!);
    ensure(await remote.put(keybox) === keyboxId); check();
    ensure(await remote.put(nextGraph.wires.get(root)!) === root); check();
    const listing2 = listingIds.parse(await remote.list()); check();
    for (const id of listing2) { if (!wires.has(id) && !graph.values.has(id) && id !== keyboxId && id !== root) { const wire = await remote.get(id); check(); ensure(hashWire(wire) === id); wires.set(id, wire); } }
    const envs2 = envelopes(listing2); const own = new Set([keyboxId, root]);
    const raced = listing2.some(id => { const e = envs2.get(id); return !own.has(id) && e !== null && e !== undefined && e.epoch >= next; });
    const overtaken = unseenVersions(listing2, envs2).unseen;
    if (raced || overtaken) {
      const left: string[] = [];
      for (const id of [keyboxId, root]) { try { await remote.remove!(id); } catch { left.push(id); } }
      // Objects that could not be deleted stay on the list; the next sync removes them before it looks at the account (m4).
      await checkpoint.write(left.length ? { ...before, rollback: left } : before, { ignoreAbort: true });
      throw new SyncFailure(raced ? 'rotateRaced' : 'rotateBlocked');
    }
    // The old epoch goes only now. An abort from here on keeps the marker: the next sync shows a fresh code.
    const done = { kind: 'shellherd-sync-state-v3' as const, epoch: next, syncKey: nextKey.toString('base64'), adopts, keybox: keyboxId, versions: [...nextGraph.wires.values()], acked: [root], localHeads: [root], working: head.portable, projection: state.projection };
    await checkpoint.write(done); check();
    for (const id of listing2.filter(id => { const e = envs2.get(id); return e !== null && e !== undefined && e.epoch < next; })) {
      check(); try { await remote.remove!(id); } catch { break; } // Housekeeping: the next sync finishes it.
      check();
    }
    const { keybox: _marker, ...settled } = done;
    await checkpoint.write(settled, { ignoreAbort: true });
    return { recoveryCode: code };
  } finally { try { await checkpoint?.close(); } finally { lease.key.fill(0); syncKey?.fill(0); nextKey?.fill(0); oldGraph?.key.fill(0); nextGraph?.key.fill(0); } }
}

/** Seals an enrollment keybox (current epoch) under a fresh code. The checkpoint records it first so cleanup survives a crash (B7); returns the code once. */
export async function createInvite(sessions: VaultSessionManager, remote: VaultRemote, context: SyncContext, origin: string, signal: AbortSignal): Promise<{ code: string; enrollSecret: string; keyboxId: string }> {
  ensure(process.platform === 'linux', 'platform');
  const lease = await sessions.captureForSync(); let checkpoint: StateFile | undefined; let syncKey: Buffer | undefined; let graph: Graph | undefined;
  const check = (): void => { ensure(!signal.aborted, 'locked'); lease.assertCurrent(); };
  try {
    checkpoint = await lockSyncState(lease.snapshot.filePath, lease.key, lease.kdf, context, check);
    const raw = await checkpoint.read(); check(); ensure(raw !== undefined, 'syncKey');
    const state = stateForKeyWork(raw); syncKey = Buffer.from(state.syncKey, 'base64');
    ensure(!state.keybox && !state.rollback, 'rotateBlocked'); // The marker means no code has left this device yet (K8).
    const listing = listingIds.parse(await remote.list()); check();
    graph = new Graph(versionKey(syncKey, context, state.epoch), context, state.epoch, lease.snapshot.vault.id); validateState(state, graph);
    const wires = await fetchNew(remote, listing, id => graph!.values.has(id), check);
    ensure(![...wires.values()].some(wire => (parseSyncEnvelope(wire)?.epoch ?? 0) > state.epoch), 'rotated');
    // Invite keyboxes older than 20 minutes are dead weight: remove them best effort before counting.
    const expired = (state.invites ?? []).filter(invite => Date.now() - invite.at > INVITE_KEEP_MS); const gone = new Set<string>();
    for (const invite of expired) { if (!remote.remove) break; check(); try { await remote.remove(invite.id); } catch { continue; } gone.add(invite.id); }
    const rest = (state.invites ?? []).filter(invite => !gone.has(invite.id)); ensure(rest.length < INVITES_MAX, 'limit');
    const code = generateRecoveryCode(); const enrollSecret = inviteEnrollSecret(code, context, origin);
    const keybox = sealKeybox(syncKey, code, 'invite', state.epoch, state.adopts, context); const keyboxId = hashWire(keybox);
    state.invites = [...rest, { id: keyboxId, at: Date.now() }];
    await checkpoint.write(state); check();
    ensure(await remote.put(keybox) === keyboxId); check();
    return { code, enrollSecret, keyboxId };
  } finally { try { await checkpoint?.close(); } finally { lease.key.fill(0); syncKey?.fill(0); graph?.key.fill(0); } }
}
