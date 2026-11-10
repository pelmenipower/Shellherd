import type { VaultSyncResult } from './vault-sync';
import { createHmac, createPublicKey, randomBytes, sign, timingSafeEqual } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { z } from 'zod';
import type { RemoteIdentity, RemoteIdentityStore } from '../remote/identity';
import { isDeviceName } from '../../shared/device-name';
import { normalizeRecoveryCode } from '../../shared/recovery-code';
import { VAULT_PASSWORD_MIN_LENGTH } from '../../shared/vault-password';
import type { SyncLabReply, SyncLabState } from '../../shared/sync-lab';
import { normalizeSyncServerUrl } from '../../shared/sync-server-url.mjs';
import { inviteEnrollSecret } from './vault-sync-crypto';
import type { SyncDevice } from './vault-sync-crypto';
import { acknowledgePin, mergeRoster } from './roster-pins';
import type { EffectiveDevice, Hints, MergeResult } from './roster-pins';

const token = z.string().uuid();
const hex64 = /^[a-f0-9]{64}$/;
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
// Same rule as weakEd25519 in device-proof.mjs: small-order points (sign bit cleared) and non-canonical y >= p.
export const SMALL_ORDER_Y = ['0100000000000000000000000000000000000000000000000000000000000000', 'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
  '0000000000000000000000000000000000000000000000000000000000000000', 'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a',
  '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05'];
const FIELD_P = (1n << 255n) - 19n;
export function weakEd25519(raw32: Buffer): boolean {
  const y = Buffer.from(raw32); y[31] &= 0x7f;
  if (BigInt('0x' + Buffer.from(y).reverse().toString('hex')) >= FIELD_P) return true;
  return SMALL_ORDER_Y.includes(y.toString('hex'));
}
const RENEW_MARGIN_MS = 60_000;
const statusSchema = z.object({ kind: z.enum(['status', 'close']), clientId: token }).strict();
export interface DeviceEntry { id: string; name: string; signingKey: string; enrolledAt: number; enrolledBy: string | null; revokedAt: number | null; ephemeral: boolean }
export interface AccountDriver {
  enroll(identity: RemoteIdentity, input: { username: string; password: string; name: string; ephemeral: boolean }): Promise<unknown>;
  enrollWithInvite(identity: RemoteIdentity, input: { secret: string; name: string; ephemeral: boolean }): Promise<{ username: string } & Record<string, unknown>>;
  invite(identity: RemoteIdentity, input: { secret: string; object: string | null }): Promise<{ expiresAt: number }>;
  openSession(identity: RemoteIdentity): Promise<{ signedIn: true; expiresAt: number; device: string }>;
  devices(): Promise<DeviceEntry[]>; revoke(identity: RemoteIdentity, id: string): Promise<unknown>;
  list(): Promise<unknown>; get?(id: string): Promise<string>; put?(wire: string): Promise<string>; remove?(id: string): Promise<boolean>; close(): void;
}
export type SyncVaultRequest = { kind: 'synchronize'; recoveryCode?: string; inviteCode?: string } | { kind: 'keepLocal'; reviewed: true; revision: string }
  | { kind: 'importVault'; password: string; recoveryCode: string } | { kind: 'importVault'; password: string; inviteCode: string }
  | { kind: 'removeForeign'; ids: string[]; versions?: true } | { kind: 'rotateKey' } | { kind: 'createInvite'; origin: string };
export type SyncVaultOutcome = VaultSyncResult | { removedForeign: number } | { recoveryCode: string } | { code: string; enrollSecret: string; keyboxId: string };
/** Keyed digest of the sign-in password so the later import password can be compared without keeping the password itself. */
const digestOf = (key: Buffer, password: string): Buffer => createHmac('sha256', key).update(password.normalize('NFKC')).digest();
type ServerInfo = NonNullable<SyncLabState['server']>;
type Loaded = { identity: RemoteIdentity; persistent: boolean };
type Failure = { code: 'connection' | 'unavailable' | 'identity' | 'authentication' | 'limit' | 'stale' | 'enrolledElsewhere' | 'syncRoster' | 'invite' | 'enrollmentLocked' };
const failure = (code: Failure['code']): Failure & { host: true } => ({ code, host: true });
const isFailure = (error: unknown): error is Failure & { host: true } => !!error && typeof error === 'object' && 'host' in error && error.host === true;
const statusOf = (error: unknown): number | undefined => error && typeof error === 'object' && 'status' in error && typeof error.status === 'number' ? error.status : undefined;
const syncCodes = { locked: 'syncLocked', changed: 'syncChanged', history: 'syncHistory', wrongVault: 'syncWrongVault', recovery: 'syncRecovery', limit: 'syncLimit', conflict: 'syncConflict', bindings: 'syncBindings', syncKey: 'syncKey', recoveryCode: 'syncRecoveryCode', migrate: 'syncMigrate',
  rotated: 'syncRotated', rotateBlocked: 'syncRotateBlocked', rotateRaced: 'syncRotateRaced', inviteKey: 'syncInviteKey',
  foreignKey: 'syncForeignKey', otherServer: 'syncOtherServer', platform: 'syncPlatform' } as const;
interface Connection {
  owner: number; clientId: string; controller: AbortController; info?: ServerInfo; busy?: boolean;
  account?: AccountDriver; signedIn?: SyncLabState['account']; sync?: SyncLabState['sync']; foreign?: string[]; passwordDigest?: { key: Buffer; digest: Buffer };
  /** Sync-key carrying enrollment code (K12): a Buffer so it can be zeroed. */
  inviteCode?: Buffer; invitesIssued: number; ownInvited?: ReadonlySet<string>; rotationAdvised?: boolean; hints?: Hints;
  store?: RemoteIdentityStore; loaded?: Loaded; enrolled?: SyncLabState['enrolled']; enrolledElsewhere?: string; expiresAt?: number; roster?: DeviceEntry[]; devices?: SyncLabState['devices'];
}
export class SyncLabHost {
  #connection?: Connection;
  constructor(private readonly probe?: (serverUrl: string, allowPrivateHttp: boolean, signal: AbortSignal) => Promise<ServerInfo>,
    private readonly createAccount?: (info: ServerInfo, signal: AbortSignal) => AccountDriver,
    private readonly syncVault?: (account: AccountDriver, info: ServerInfo, signal: AbortSignal, request: SyncVaultRequest, device: SyncDevice | undefined) => Promise<SyncVaultOutcome | undefined>,
    private readonly matchesVaultPassword?: (password: string) => Promise<boolean | undefined>,
    private readonly identity?: () => RemoteIdentityStore) {}
  get enabled(): boolean { return Boolean(this.probe && this.createAccount && this.identity); }
  /** Renderer-visible state of a connection; never contains keys, tokens or the recovery code. */
  #state(c: Connection): SyncLabState {
    return {
      phase: 'serverReady', server: c.info,
      ...(c.signedIn ? { account: c.signedIn } : {}), ...(c.sync ? { sync: c.sync } : {}),
      ...(c.enrolled ? { enrolled: c.enrolled } : {}), ...(c.enrolledElsewhere ? { enrolledElsewhere: c.enrolledElsewhere } : {}),
      ...(c.loaded ? { identity: { fingerprint: c.loaded.identity.id, persistent: c.loaded.persistent } } : {}), ...(c.devices ? { devices: c.devices } : {}),
      ...(c.inviteCode ? { inviteKey: true as const } : {}), ...(c.rotationAdvised ? { rotationAdvised: true as const } : {}),
      ...(c.hints?.newDevices.length ? { newDevices: c.hints.newDevices } : {}), ...(c.hints?.revived.length ? { revived: c.hints.revived } : {}),
    };
  }
  #live(c: Connection): void { if (this.#connection !== c) throw failure('stale'); }
  #own(owner: number, clientId: string): Connection | undefined {
    const c = this.#connection; return c?.info && c.owner === owner && c.clientId === clientId ? c : undefined;
  }
  /** Maps a failed server action: 401 drops the session (enrollment stays, B6), everything else is reported. */
  #failed(c: Connection, error: unknown): SyncLabReply {
    if (this.#connection !== c || (isFailure(error) && error.code === 'stale')) return { ok: false, code: 'stale' };
    if (isFailure(error)) return { ok: false, code: error.code };
    const status = statusOf(error);
    if (status === 401) {
      c.account?.close(); c.account = undefined; c.signedIn = undefined; c.expiresAt = undefined; c.roster = undefined; c.devices = undefined; c.hints = undefined;
      return { ok: false, code: 'authentication', state: this.#state(c) };
    }
    return { ok: false, code: status === 429 ? 'limit' : 'connection' };
  }
  /** Opens a device session; one retry on 401 with a fresh challenge, a second 401 forgets the enrollment (B6). */
  async #open(c: Connection, account: AccountDriver): Promise<void> {
    const identity = c.loaded!.identity;
    for (let attempt = 0; ; attempt++) {
      try {
        const session = await account.openSession(identity); this.#live(c);
        c.expiresAt = session.expiresAt; return;
      } catch (error) {
        this.#live(c);
        if (statusOf(error) !== 401) throw error;
        if (attempt === 1) {
          c.store?.forgetEnrollment(c.info!.serverId, c.info!.serverUrl); c.enrolled = undefined;
          throw { status: 401, forgotten: true };
        }
      }
    }
  }
  /** Renews the session shortly before it expires (B6). */
  async #renew(c: Connection): Promise<void> {
    if (c.expiresAt !== undefined && Date.now() >= c.expiresAt - RENEW_MARGIN_MS) await this.#open(c, c.account!);
  }
  /** Loads the roster fresh, compares it with the pinned one and returns the keys the author checks run against (B3, B8). */
  async #roster(c: Connection, strict: boolean): Promise<EffectiveDevice[]> {
    const list = await c.account!.devices(); this.#live(c);
    const identity = c.loaded!.identity; const { serverId, serverUrl } = c.info!;
    if (strict) { const own = list.find(item => item.id === identity.id); if (!own || own.signingKey !== identity.signingPublicKey) throw failure('connection'); }
    const merged = mergeRoster({ snapshot: c.store?.rosterOf(serverId, serverUrl), server: list, selfId: identity.id, invitesIssued: c.invitesIssued, ownInvited: c.ownInvited });
    if (!merged.ok) throw failure('syncRoster'); // A known device changed its key: nothing is trusted (B8).
    // Invalid or oversized pins come from the server; the store refuses them and the run ends as a roster conflict.
    try { if (merged.persist) c.store?.rememberRoster(serverId, serverUrl, merged.pins, Date.now()); } catch { throw failure('syncRoster'); }
    c.invitesIssued = merged.invitesIssued; c.ownInvited = merged.ownInvited;
    this.#project(c, list, merged);
    return merged.effective;
  }
  /** Publishes the merged roster: device rows with the effective revocation and the notices. */
  #project(c: Connection, list: DeviceEntry[], merged: Extract<MergeResult, { ok: true }>): void {
    const identity = c.loaded!.identity; c.roster = list; c.hints = { newDevices: merged.newDevices, revived: merged.revived };
    c.devices = list.map(({ id, name, enrolledAt, ephemeral }) => {
      const by = merged.pins.find(p => p.id === id)?.enrolledBy ?? null; const issuer = by === null ? undefined : list.find(item => item.id === by)?.name;
      return { id, name, enrolledAt, revokedAt: merged.effective.find(e => e.id === id)?.revokedAt ?? null, ephemeral, self: id === identity.id,
        enrolledVia: by === null ? 'password' as const : 'invite' as const, ...(issuer !== undefined ? { invitedBy: issuer } : {}) };
    });
  }
  /** `pending` are roster entries with an open notice: the server may have added them, so they do not vouch for a key epoch (R1). */
  #deviceOf(identity: RemoteIdentity, list: EffectiveDevice[], pending: ReadonlySet<string> = new Set()): SyncDevice {
    const keys = new Map<string, KeyObject>(); const revoked = new Map<string, number | null>();
    for (const item of list) {
      revoked.set(item.id, item.revokedAt);
      try {
        const raw = Buffer.from(item.signingKey, 'base64'); if (raw.length !== 32 || weakEd25519(raw)) continue;
        keys.set(item.id, createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: 'der', type: 'spki' }));
      } catch { /* Unusable or weak key: the author counts as unknown. */ }
    }
    return { id: identity.id, sign: data => sign(null, data, identity.signingKey), keyOf: id => keys.get(id), revokedAt: id => revoked.get(id), trusted: id => !pending.has(id) };
  }
  async connect(owner: number, raw: unknown): Promise<SyncLabReply> {
    if (!this.enabled || !this.probe || !this.identity) return { ok: false, code: 'unavailable' };
    const parsed = z.object({ kind: z.literal('connect'), clientId: token, serverUrl: z.string().max(2048), privateNetwork: z.boolean().optional() }).strict().safeParse(raw);
    const url = parsed.success ? normalizeSyncServerUrl(parsed.data.serverUrl, { loopback: true, private: parsed.data.privateNetwork === true }) : null;
    if (!parsed.success || !url) return { ok: false, code: 'invalid' };
    if (this.#connection) return { ok: false, code: 'stale' };
    const privateNetwork = parsed.data.privateNetwork === true;
    const connection: Connection = { owner, clientId: parsed.data.clientId, controller: new AbortController(), invitesIssued: 0 };
    this.#connection = connection;
    try {
      const info = await this.probe(url, privateNetwork, connection.controller.signal);
      this.#live(connection);
      if (info.authentication !== 'enrolled-device' || info.deviceSessions !== true || info.invites !== true || info.objectEpochs !== true) throw failure('unavailable');
      try { connection.store = this.identity(); connection.loaded = connection.store.load(); } catch { throw failure('identity'); }
      connection.info = info;
      const e = connection.store.enrollment(info.serverId, info.serverUrl);
      if (e && e.namespace === info.namespace) connection.enrolled = { username: e.username, name: e.name };
      // Relay protection: never open a session for another URL without explicit confirmation (K10, C1).
      // Same origin with another namespace (server reset): not another address, so enroll normally and replace the entry (N7).
      else if (!e) connection.enrolledElsewhere = connection.store.enrolledElsewhere(info.serverId, info.serverUrl);
      return { ok: true, state: this.#state(connection) };
    } catch (error) {
      if (this.#connection !== connection) return { ok: false, code: 'stale' };
      this.#connection = undefined;
      return { ok: false, code: isFailure(error) && error.code !== 'stale' ? error.code : 'connection' };
    }
  }
  async signIn(owner: number, raw: unknown): Promise<SyncLabReply> {
    if (!this.enabled || !this.createAccount) return { ok: false, code: 'unavailable' };
    const parsed = z.object({ kind: z.literal('signIn'), clientId: token, username: z.string().regex(/^[a-zA-Z0-9_.-]{1,64}$/), password: z.string().min(1).max(1024), deviceName: z.string().max(1024), confirmElsewhere: z.literal(true).optional() }).strict().safeParse(raw);
    if (!parsed.success || !isDeviceName(parsed.data.deviceName)) return { ok: false, code: 'invalid' };
    const current = this.#own(owner, parsed.data.clientId);
    if (!current?.info || !current.loaded || current.busy || current.signedIn) return { ok: false, code: 'stale' };
    if (current.enrolledElsewhere && parsed.data.confirmElsewhere !== true) return { ok: false, code: 'enrolledElsewhere' }; // No network call without confirmation (C1).
    const { identity, persistent } = current.loaded; const { username, password, deviceName } = parsed.data;
    current.busy = true; let remembered = false; let enrolling = false;
    try {
      // Never send the vault password to the server; undefined means the vault is locked, so no check is possible.
      const same = await this.matchesVaultPassword?.(password); this.#live(current);
      if (same === true) return { ok: false, code: 'samePassword' };
      const account = current.account = this.createAccount(current.info, current.controller.signal);
      enrolling = true; await account.enroll(identity, { username, password, name: deviceName, ephemeral: !persistent }); enrolling = false; this.#live(current);
      const session = await account.openSession(identity); this.#live(current);
      current.expiresAt = session.expiresAt;
      current.store!.rememberEnrollment({ serverId: current.info.serverId, namespace: current.info.namespace, serverUrl: current.info.serverUrl, username, name: deviceName, enrolledAt: Date.now() }); remembered = true;
      { const key = randomBytes(32); current.passwordDigest = { key, digest: digestOf(key, password) }; } // Held after every sign-in, checked or not (E3).
      await account.list(); this.#live(current); // Verify access, never upload a Vault as a side effect of sign-in.
      await this.#roster(current, false);
      current.enrolled = { username, name: deviceName }; current.enrolledElsewhere = undefined;
      current.signedIn = { signedIn: true, username, device: { fingerprint: identity.id, name: deviceName, persistent } };
      return { ok: true, state: this.#state(current) };
    } catch (error) {
      if (this.#connection === current) {
        current.account?.close(); current.account = undefined; current.expiresAt = undefined; current.roster = undefined; current.devices = undefined; current.hints = undefined;
        if (remembered) current.enrolled = { username, name: deviceName }; // The store knows the enrollment, so the dialog must not ask for the password again.
      }
      if (this.#connection !== current || (isFailure(error) && error.code === 'stale')) return { ok: false, code: 'stale' };
      const status = statusOf(error);
      return { ok: false, code: isFailure(error) ? error.code : status === 401 ? 'authentication' : status === 429 ? 'limit' : status === 403 && enrolling ? 'enrollmentLocked' : 'connection' };
    } finally { current.busy = false; }
  }
  /** Enrolls with a one-time enrollment code; the code also carries the sync key and is held until the first import or sync (K12). */
  async signInWithInvite(owner: number, raw: unknown): Promise<SyncLabReply> {
    if (!this.enabled || !this.createAccount) return { ok: false, code: 'unavailable' };
    const parsed = z.object({ kind: z.literal('signInWithInvite'), clientId: token, code: z.string().max(64), deviceName: z.string().max(1024), confirmElsewhere: z.literal(true).optional() }).strict().safeParse(raw);
    const code = parsed.success ? normalizeRecoveryCode(parsed.data.code) : null;
    if (!parsed.success || code === null || !isDeviceName(parsed.data.deviceName)) return { ok: false, code: 'invalid' };
    const current = this.#own(owner, parsed.data.clientId);
    if (!current?.info || !current.loaded || current.busy || current.signedIn) return { ok: false, code: 'stale' };
    if (current.enrolledElsewhere && parsed.data.confirmElsewhere !== true) return { ok: false, code: 'enrolledElsewhere' };
    let secret: string;
    try { secret = inviteEnrollSecret(code, current.info, new URL(current.info.serverUrl).origin); } catch { return { ok: false, code: 'invalid' }; }
    const { identity, persistent } = current.loaded; const { deviceName } = parsed.data;
    current.busy = true; let remembered: string | undefined; let enrolling = false;
    try {
      const account = current.account = this.createAccount(current.info, current.controller.signal);
      enrolling = true; const result = await account.enrollWithInvite(identity, { secret, name: deviceName, ephemeral: !persistent }); enrolling = false; this.#live(current);
      const username = result.username;
      if (typeof username !== 'string' || !/^[a-zA-Z0-9_.-]{1,64}$/.test(username)) throw failure('connection');
      const session = await account.openSession(identity); this.#live(current);
      current.expiresAt = session.expiresAt;
      current.store!.rememberEnrollment({ serverId: current.info.serverId, namespace: current.info.namespace, serverUrl: current.info.serverUrl, username, name: deviceName, enrolledAt: Date.now() }); remembered = username;
      current.inviteCode = Buffer.from(code, 'hex');
      await account.list(); this.#live(current);
      await this.#roster(current, false);
      current.enrolled = { username, name: deviceName }; current.enrolledElsewhere = undefined;
      current.signedIn = { signedIn: true, username, device: { fingerprint: identity.id, name: deviceName, persistent } };
      return { ok: true, state: this.#state(current) };
    } catch (error) {
      if (this.#connection === current) {
        current.account?.close(); current.account = undefined; current.expiresAt = undefined; current.roster = undefined; current.devices = undefined; current.hints = undefined;
        if (remembered !== undefined) current.enrolled = { username: remembered, name: deviceName };
      }
      if (this.#connection !== current || (isFailure(error) && error.code === 'stale')) return { ok: false, code: 'stale' };
      const status = statusOf(error);
      return { ok: false, code: isFailure(error) ? error.code : status === 401 ? (enrolling ? 'invite' : 'authentication') : status === 429 ? 'limit' : 'connection' };
    } finally { current.busy = false; }
  }
  async openSession(owner: number, raw: unknown): Promise<SyncLabReply> {
    if (!this.enabled || !this.createAccount) return { ok: false, code: 'unavailable' };
    const parsed = z.object({ kind: z.literal('openSession'), clientId: token }).strict().safeParse(raw);
    if (!parsed.success) return { ok: false, code: 'invalid' };
    const current = this.#own(owner, parsed.data.clientId);
    if (!current?.info || !current.loaded || !current.enrolled || current.busy || current.signedIn) return { ok: false, code: 'stale' };
    const { identity, persistent } = current.loaded; const enrolled = current.enrolled;
    current.busy = true;
    try {
      const account = current.account = this.createAccount(current.info, current.controller.signal);
      await this.#open(current, account);
      await account.list(); this.#live(current);
      await this.#roster(current, false);
      current.signedIn = { signedIn: true, username: enrolled.username, device: { fingerprint: identity.id, name: enrolled.name, persistent } };
      return { ok: true, state: this.#state(current) };
    } catch (error) {
      if (this.#connection === current) { current.account?.close(); current.account = undefined; current.expiresAt = undefined; current.roster = undefined; current.devices = undefined; current.hints = undefined; }
      if (this.#connection !== current || (isFailure(error) && error.code === 'stale')) return { ok: false, code: 'stale' };
      if (isFailure(error)) return { ok: false, code: error.code };
      const status = statusOf(error);
      return { ok: false, code: status === 401 ? 'authentication' : status === 429 ? 'limit' : 'connection', ...(status === 401 ? { state: this.#state(current) } : {}) };
    } finally { current.busy = false; }
  }
  async devices(owner: number, raw: unknown): Promise<SyncLabReply> {
    if (!this.enabled) return { ok: false, code: 'unavailable' };
    const parsed = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('listDevices'), clientId: token }).strict(),
      z.object({ kind: z.literal('revokeDevice'), clientId: token, id: z.string().regex(hex64) }).strict(),
      z.object({ kind: z.literal('acknowledgeDevice'), clientId: token, id: z.string().regex(hex64) }).strict(),
    ]).safeParse(raw);
    if (!parsed.success) return { ok: false, code: 'invalid' };
    const current = this.#own(owner, parsed.data.clientId);
    if (parsed.data.kind === 'acknowledgeDevice') return this.#acknowledge(current, parsed.data.id);
    if (!current?.info || !current.loaded || !current.account || !current.signedIn || current.busy) return { ok: false, code: 'stale' };
    const identity = current.loaded.identity;
    current.busy = true;
    try {
      await this.#renew(current);
      if (parsed.data.kind === 'revokeDevice') {
        try { await current.account.revoke(identity, parsed.data.id); this.#live(current); }
        catch (error) { this.#live(current); if (statusOf(error) !== 404) throw error; }
        if (parsed.data.id === identity.id) {
          current.store?.forgetEnrollment(current.info.serverId, current.info.serverUrl); this.#close(current);
          return { ok: true, state: { phase: 'idle' } };
        }
        // Any removed device held the sync key (K14); its pin gets a local revocation in case the server drops the entry (K15).
        current.rotationAdvised = true;
        this.#pinRevoked(current, parsed.data.id);
      }
      await this.#roster(current, false);
      return { ok: true, state: this.#state(current) };
    } catch (error) { return this.#failed(current, error); }
    finally { current.busy = false; }
  }
  /** Marks a pin revoked locally (`revokedAt ??= now`); temporary devices vanish from the server roster on removal (K15). */
  #pinRevoked(c: Connection, id: string): void {
    const { serverId, serverUrl } = c.info!; const snapshot = c.store?.rosterOf(serverId, serverUrl); const now = Date.now();
    if (!snapshot?.pins.some(p => p.id === id && p.revokedAt === null)) return;
    try { c.store!.rememberRoster(serverId, serverUrl, snapshot.pins.map(p => p.id === id ? { ...p, revokedAt: now } : p), snapshot.at ?? now); } catch { throw failure('syncRoster'); }
  }
  /** Confirms a new or revived device without network access; a revived pin turns active again (E11). */
  #acknowledge(c: Connection | undefined, id: string): SyncLabReply {
    if (!c?.info || !c.loaded || !c.signedIn || !c.roster) return { ok: false, code: 'stale' };
    const { serverId, serverUrl } = c.info; const snapshot = c.store?.rosterOf(serverId, serverUrl);
    // Only ids with an open notice are accepted; the renderer is not trusted (m2).
    const revived = c.hints?.revived.some(item => item.id === id) === true;
    if (!snapshot || snapshot.at === null || !(revived || c.hints?.newDevices.some(item => item.id === id))) return { ok: false, code: 'invalid' };
    const pins = acknowledgePin(snapshot.pins, id, revived); const at = Date.now();
    try { c.store!.rememberRoster(serverId, serverUrl, pins, at); } catch { return { ok: false, code: 'syncRoster' }; }
    const merged = mergeRoster({ snapshot: { pins, at }, server: c.roster, selfId: c.loaded.identity.id, invitesIssued: c.invitesIssued, ownInvited: c.ownInvited });
    if (!merged.ok) return { ok: false, code: 'syncRoster' };
    this.#project(c, c.roster, merged);
    return { ok: true, state: this.#state(c) };
  }
  async performSync(owner: number, raw: unknown): Promise<SyncLabReply> {
    if (!this.enabled || !this.syncVault) return { ok: false, code: 'unavailable' };
    const parsed = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('synchronize'), clientId: token, recoveryCode: z.string().max(64).optional() }).strict(),
      z.object({ kind: z.literal('keepLocal'), clientId: token, reviewed: z.literal(true), revision: z.string().regex(hex64) }).strict(),
      z.object({ kind: z.literal('importVault'), clientId: token, password: z.string().min(VAULT_PASSWORD_MIN_LENGTH).max(1024), recoveryCode: z.string().max(64).optional() }).strict(),
      z.object({ kind: z.literal('removeForeign'), clientId: token, versions: z.literal(true).optional() }).strict(),
      z.object({ kind: z.literal('invite'), clientId: token }).strict(),
      z.object({ kind: z.literal('rotateKey'), clientId: token, confirmed: z.literal(true) }).strict(),
    ]).safeParse(raw);
    if (!parsed.success) return { ok: false, code: 'invalid' };
    const data = parsed.data;
    let code: string | undefined;
    if ((data.kind === 'importVault' || data.kind === 'synchronize') && data.recoveryCode !== undefined) {
      code = normalizeRecoveryCode(data.recoveryCode) ?? undefined;
      if (code === undefined) return { ok: false, code: 'invalid' };
    }
    const current = this.#connection;
    if (!current?.info || !current.loaded || !current.account || !current.signedIn || current.owner !== owner || current.clientId !== data.clientId || current.busy) return { ok: false, code: 'stale' };
    if (data.kind === 'keepLocal' && (!current.sync?.canKeepLocal || data.revision !== current.sync.conflictRevision)) return { ok: false, code: 'invalid' };
    if (data.kind === 'removeForeign' && !current.foreign?.length) return { ok: false, code: 'invalid' };
    if (data.kind === 'importVault' && code === undefined && !current.inviteCode) return { ok: false, code: 'invalid' }; // No code typed and none held.
    if (data.kind === 'importVault') {
      // The digest stays held across failed attempts; it is wiped only after a successful import or on close/reset.
      const held = current.passwordDigest;
      if (held) {
        const same = timingSafeEqual(digestOf(held.key, data.password), held.digest);
        if (same) return { ok: false, code: 'samePasswordImport', state: this.#state(current) };
      }
    }
    current.busy = true;
    try {
      let device: SyncDevice | undefined;
      // Renewal and roster failures are connection problems, never the sync limit (R4).
      try {
        await this.#renew(current);
        if (data.kind !== 'removeForeign') {
          const list = await this.#roster(current, true); // Fresh roster per run (B3).
          device = this.#deviceOf(current.loaded.identity, list, new Set(current.hints?.newDevices.map(item => item.id) ?? []));
        }
      } catch (error) { return this.#failed(current, error); }
      const request: SyncVaultRequest = data.kind === 'removeForeign' ? { kind: 'removeForeign', ids: current.foreign!, ...(data.versions ? { versions: true as const } : {}) }
        : data.kind === 'importVault' ? (code !== undefined ? { kind: 'importVault', password: data.password, recoveryCode: code } : { kind: 'importVault', password: data.password, inviteCode: current.inviteCode!.toString('hex') })
        : data.kind === 'synchronize' ? (code !== undefined ? { kind: 'synchronize', recoveryCode: code } : current.inviteCode ? { kind: 'synchronize', inviteCode: current.inviteCode.toString('hex') } : { kind: 'synchronize' })
        : data.kind === 'keepLocal' ? { kind: 'keepLocal', reviewed: true, revision: data.revision }
        : data.kind === 'invite' ? { kind: 'createInvite', origin: new URL(current.info.serverUrl).origin } : { kind: 'rotateKey' };
      const result = await this.syncVault(current.account, current.info, current.controller.signal, request, device);
      this.#live(current);
      if (data.kind === 'rotateKey') {
        // The code travels only in this one reply, never in held state (K13).
        current.rotationAdvised = undefined; this.#wipeInvite(current);
        return { ok: true, state: this.#state(current), recoveryCode: (result as { recoveryCode: string }).recoveryCode };
      }
      if (data.kind === 'invite') {
        const issued = result as { code: string; enrollSecret: string; keyboxId: string };
        try { await current.account.invite(current.loaded.identity, { secret: issued.enrollSecret, object: issued.keyboxId }); this.#live(current); }
        catch (error) {
          // The keybox is already stored; take it back best effort so no orphan stays behind.
          try { await current.account.remove?.(issued.keyboxId); } catch { /* Housekeeping only. */ }
          throw error;
        }
        current.invitesIssued += 1;
        return { ok: true, state: this.#state(current), inviteCode: issued.code };
      }
      let recoveryCode: string | undefined;
      if (data.kind === 'importVault' && result && 'snapshot' in result && result.snapshot) this.#wipe(current);
      if (result && 'removedForeign' in result) {
        // Default mode keeps unreadable versions: only an opt-in removal clears them; otherwise the rest stays foreign (m5).
        const all = data.kind === 'removeForeign' && data.versions === true; const rest = all ? 0 : Math.max(0, (current.sync?.skipped ?? 0) - result.removedForeign);
        if (rest === 0) current.foreign = undefined;
        current.sync = { ...current.sync!, skipped: rest, removedForeign: result.removedForeign };
      } else if (result && 'status' in result) {
        const { snapshot: _snapshot, foreign, recoveryCode: issued, ...summary } = result; current.sync = summary; current.foreign = foreign?.length ? foreign : undefined; recoveryCode = issued;
        if (summary.status === 'synced') this.#wipeInvite(current); // The sync key is stored locally now.
      } else if (data.kind === 'removeForeign') { current.foreign = undefined; current.sync = { ...current.sync!, skipped: 0, removedForeign: 0 }; }
      return { ok: true, state: this.#state(current), ...(recoveryCode ? { recoveryCode } : {}), ...(result && 'snapshot' in result && result.snapshot ? { vaultChanged: result.snapshot } : {}) };
    } catch (error) {
      if (this.#connection === current && !isFailure(error) && error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && Object.hasOwn(syncCodes, error.code)) {
        if (error.code === 'inviteKey') this.#wipeInvite(current); // The keybox behind the code is gone; only the recovery code helps now.
        return { ok: false, code: syncCodes[error.code as keyof typeof syncCodes], ...(error.code === 'inviteKey' ? { state: this.#state(current) } : {}) };
      }
      if (this.#connection === current && (statusOf(error) === 429 || statusOf(error) === 507)) return { ok: false, code: 'syncLimit' }; // Object write budget or quota.
      return this.#failed(current, error);
    } finally { current.busy = false; }
  }
  #wipeInvite(connection?: { inviteCode?: Buffer }): void {
    if (!connection?.inviteCode) return;
    connection.inviteCode.fill(0); connection.inviteCode = undefined;
  }
  #wipe(connection?: { passwordDigest?: { key: Buffer; digest: Buffer }; inviteCode?: Buffer }): void {
    this.#wipeInvite(connection);
    const held = connection?.passwordDigest; if (!held) return;
    held.key.fill(0); held.digest.fill(0); connection!.passwordDigest = undefined;
  }
  #close(connection: Connection): void {
    connection.controller.abort(); connection.account?.close(); this.#wipe(connection);
    if (this.#connection === connection) this.#connection = undefined;
  }
  /** Only status and close remain; everything else is dispatched to the dedicated handlers. */
  request(owner: number, raw: unknown): SyncLabReply {
    if (!this.enabled) return { ok: false, code: 'unavailable' };
    const parsed = statusSchema.safeParse(raw); if (!parsed.success) return { ok: false, code: 'invalid' };
    const request = parsed.data; const current = this.#connection;
    if (request.kind === 'close') {
      if (current?.owner === owner && current.clientId === request.clientId) this.#close(current);
      return { ok: true, state: { phase: 'idle' } };
    }
    return current?.info && current.owner === owner && current.clientId === request.clientId ? { ok: true, state: this.#state(current) } : { ok: false, code: 'stale' };
  }
  closeOwner(owner: number): void { if (this.#connection?.owner === owner) this.reset(); }
  reset(): void {
    this.#connection?.controller.abort(); this.#connection?.account?.close(); this.#wipe(this.#connection); this.#connection = undefined;
  }
}
