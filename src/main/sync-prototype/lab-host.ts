import type { VaultSyncResult } from './vault-sync';
import { z } from 'zod';
import type { SyncLabReply, SyncLabRequest, SyncLabState } from '../../shared/sync-lab';
import { normalizeSyncServerUrl } from '../../shared/sync-server-url.mjs';

const token = z.string().uuid();
const requestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('start'), clientId: token }).strict(),
  z.object({ kind: z.literal('status'), clientId: token }).strict(),
  z.object({ kind: z.literal('close'), clientId: token }).strict(),
  z.object({ kind: z.literal('confirm'), clientId: token, sessionId: token, role: z.enum(['left', 'right']), fingerprint: z.string().max(128), compared: z.literal(true) }).strict(),
  z.object({ kind: z.literal('resolve'), clientId: token, sessionId: token, revision: token, reviewed: z.literal(true), choices: z.array(z.object({ id: z.string().min(1).max(256), side: z.enum(['left', 'right']) }).strict()).min(1).max(16) }).strict(),
]);
export interface LabDriver { action(request: SyncLabRequest): SyncLabReply; close(): void }
export interface EnrollmentDriver { begin(): Promise<NonNullable<SyncLabState['enrollment']>>; refresh(): Promise<NonNullable<SyncLabState['enrollment']>>; close(): void }
export interface AccountDriver { login(username: string, password: string): Promise<unknown>; list(): Promise<unknown>; get?(id: string): Promise<string>; put?(wire: string): Promise<string>; close(): void }
type ServerInfo = NonNullable<SyncLabState['server']>;
export class SyncLabHost {
  #active?: { owner: number; clientId: string; driver: LabDriver };
  #connection?: { owner: number; clientId: string; controller: AbortController; info?: ServerInfo; enrollment?: EnrollmentDriver; busy?: boolean; view?: SyncLabState['enrollment']; account?: AccountDriver; signedIn?: SyncLabState['account']; sync?: SyncLabState['sync'] };
  constructor(private readonly createDriver?: () => LabDriver,
    private readonly probe?: (serverUrl: string, signal: AbortSignal) => Promise<ServerInfo>,
    private readonly createEnrollment?: (info: ServerInfo) => EnrollmentDriver,
    private readonly createAccount?: (info: ServerInfo, signal: AbortSignal) => AccountDriver,
    private readonly syncVault?: (account: AccountDriver, info: ServerInfo, signal: AbortSignal, request: { kind: 'synchronize' } | { kind: 'keepLocal'; reviewed: true; revision: string } | { kind: 'importVault'; password: string }) => Promise<VaultSyncResult | undefined>,
    private readonly matchesVaultPassword?: (password: string) => Promise<boolean | undefined>) {}
  get enabled(): boolean { return this.createDriver !== undefined; }
  async connect(owner: number, raw: unknown): Promise<SyncLabReply> {
    if (!this.enabled || !this.probe) return { ok: false, code: 'unavailable' };
    const parsed = z.object({ kind: z.literal('connect'), clientId: token, serverUrl: z.string().max(2048) }).strict().safeParse(raw);
    const url = parsed.success ? normalizeSyncServerUrl(parsed.data.serverUrl, true) : null;
    if (!parsed.success || !url) return { ok: false, code: 'invalid' };
    if (this.#connection || this.#active) return { ok: false, code: 'stale' };
    const connection = { owner, clientId: parsed.data.clientId, controller: new AbortController(), info: undefined as ServerInfo | undefined };
    this.#connection = connection;
    try {
      const info = await this.probe(url, connection.controller.signal);
      if (this.#connection !== connection) return { ok: false, code: 'stale' };
      connection.info = info; return { ok: true, state: { phase: 'serverReady', server: info } };
    } catch {
      if (this.#connection !== connection) return { ok: false, code: 'stale' };
      this.#connection = undefined; return { ok: false, code: 'connection' };
    }
  }
  async signIn(owner: number, raw: unknown): Promise<SyncLabReply> {
    if (!this.enabled || !this.createAccount) return { ok: false, code: 'unavailable' };
    const parsed = z.object({ kind: z.literal('signIn'), clientId: token, username: z.string().regex(/^[a-zA-Z0-9_.-]{1,64}$/), password: z.string().min(1).max(1024) }).strict().safeParse(raw);
    if (!parsed.success) return { ok: false, code: 'invalid' };
    const current = this.#connection;
    if (!current?.info || current.owner !== owner || current.clientId !== parsed.data.clientId || current.busy || current.signedIn) return { ok: false, code: 'stale' };
    if (current.info.authentication !== 'password') return { ok: false, code: 'unavailable' };
    current.busy = true;
    try {
      // Never send the vault password to the server; undefined means the vault is locked, so no check is possible.
      const same = await this.matchesVaultPassword?.(parsed.data.password);
      if (this.#connection !== current) return { ok: false, code: 'stale' };
      if (same === true) return { ok: false, code: 'samePassword' };
      current.account = this.createAccount(current.info, current.controller.signal);
      await current.account.login(parsed.data.username, parsed.data.password);
      if (this.#connection !== current) return { ok: false, code: 'stale' };
      await current.account.list(); // Verify access, never upload a Vault as a side effect of login.
      if (this.#connection !== current) return { ok: false, code: 'stale' };
      current.signedIn = { signedIn: true, username: parsed.data.username };
      return { ok: true, state: { phase: 'serverReady', server: current.info, account: current.signedIn } };
    } catch (error) {
      current.account?.close(); current.account = undefined;
      return { ok: false, code: this.#connection !== current ? 'stale' : error && typeof error === 'object' && 'status' in error && error.status === 401 ? 'authentication' : 'connection' };
    } finally { current.busy = false; }
  }
  async performSync(owner: number, raw: unknown): Promise<SyncLabReply> {
    if (!this.enabled || !this.syncVault) return { ok: false, code: 'unavailable' };
    const parsed = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('synchronize'), clientId: token }).strict(),
      z.object({ kind: z.literal('keepLocal'), clientId: token, reviewed: z.literal(true), revision: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
      z.object({ kind: z.literal('importVault'), clientId: token, password: z.string().min(1).max(1024) }).strict(),
    ]).safeParse(raw);
    if (!parsed.success) return { ok: false, code: 'invalid' };
    const current = this.#connection;
    if (!current?.info || !current.account || !current.signedIn || current.owner !== owner || current.clientId !== parsed.data.clientId || current.busy) return { ok: false, code: 'stale' };
    if (parsed.data.kind === 'keepLocal' && (!current.sync?.canKeepLocal || parsed.data.revision !== current.sync.conflictRevision)) return { ok: false, code: 'invalid' };
    current.busy = true;
    try {
      const result = await this.syncVault(current.account, current.info, current.controller.signal, parsed.data);
      if (this.#connection !== current) return { ok: false, code: 'stale' };
      if (result) { const { snapshot: _snapshot, ...summary } = result; current.sync = summary; }
      return { ok: true, state: { phase: 'serverReady', server: current.info, account: current.signedIn, sync: current.sync }, ...(result?.snapshot ? { vaultChanged: result.snapshot } : {}) };
    } catch (error) {
      if (this.#connection !== current) return { ok: false, code: 'stale' };
      const codes = { locked: 'syncLocked', changed: 'syncChanged', history: 'syncHistory', wrongVault: 'syncWrongVault', recovery: 'syncRecovery', limit: 'syncLimit', conflict: 'syncConflict', bindings: 'syncBindings' } as const;
      if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && Object.hasOwn(codes, error.code)) return { ok: false, code: codes[error.code as keyof typeof codes] };
      return { ok: false, code: error && typeof error === 'object' && 'status' in error && error.status === 401 ? 'authentication' : 'connection' };
    } finally { current.busy = false; }
  }
  async authorize(owner: number, raw: unknown): Promise<SyncLabReply> {
    const parsed = z.object({ kind: z.enum(['requestAccess', 'refreshAccess']), clientId: token }).strict().safeParse(raw);
    if (!this.enabled || !this.createEnrollment) return { ok: false, code: 'unavailable' };
    if (!parsed.success) return { ok: false, code: 'invalid' };
    const current = this.#connection;
    if (!current?.info || current.owner !== owner || current.clientId !== parsed.data.clientId || current.busy) return { ok: false, code: 'stale' };
    if (!current.info.enrollmentAvailable) return { ok: false, code: 'unavailable' };
    current.busy = true;
    try {
      if (parsed.data.kind === 'requestAccess') {
        if (current.view) return { ok: false, code: 'invalid' };
        current.enrollment ??= this.createEnrollment(current.info); current.view = await current.enrollment.begin();
      } else {
        if (!current.enrollment) return { ok: false, code: 'invalid' };
        current.view = await current.enrollment.refresh();
      }
      if (this.#connection !== current) return { ok: false, code: 'stale' };
      return { ok: true, state: { phase: 'serverReady', server: current.info, enrollment: current.view } };
    } catch { return { ok: false, code: this.#connection === current ? 'connection' : 'stale' }; }
    finally { current.busy = false; }
  }
  request(owner: number, raw: unknown): SyncLabReply {
    if (!this.createDriver) return { ok: false, code: 'unavailable' };
    if (raw && typeof raw === 'object' && ('choices' in raw && Array.isArray(raw.choices) && raw.choices.length > 16)) return { ok: false, code: 'invalid' };
    const parsed = requestSchema.safeParse(raw); if (!parsed.success) return { ok: false, code: 'invalid' };
    const request = parsed.data;
    if (request.kind === 'start') {
      if (this.#active || this.#connection) return { ok: false, code: 'stale' };
      try {
        const driver = this.createDriver(); this.#active = { owner, clientId: request.clientId, driver };
        return driver.action({ kind: 'status', clientId: request.clientId });
      } catch { this.reset(); return { ok: false, code: 'failed' }; }
    }
    if (request.kind === 'close') {
      if (this.#active?.owner === owner && this.#active.clientId === request.clientId) this.reset();
      if (this.#connection?.owner === owner && this.#connection.clientId === request.clientId) { this.#connection.controller.abort(); this.#connection.enrollment?.close(); this.#connection.account?.close(); this.#connection = undefined; }
      return { ok: true, state: { phase: 'idle' } };
    }
    if (request.kind === 'status' && this.#connection?.owner === owner && this.#connection.clientId === request.clientId && this.#connection.info)
      return { ok: true, state: { phase: 'serverReady', server: this.#connection.info, enrollment: this.#connection.view, account: this.#connection.signedIn, sync: this.#connection.sync } };
    if (this.#active?.owner !== owner || this.#active.clientId !== request.clientId) return { ok: false, code: 'stale' };
    try { return this.#active.driver.action(request); }
    catch { this.reset(); return { ok: false, code: 'failed' }; }
  }
  closeOwner(owner: number): void { if (this.#active?.owner === owner || this.#connection?.owner === owner) this.reset(); }
  reset(): void {
    this.#connection?.controller.abort(); this.#connection?.enrollment?.close(); this.#connection?.account?.close(); this.#connection = undefined;
    const driver = this.#active?.driver; this.#active = undefined;
    try { driver?.close(); } catch { /* A fixture cleanup failure must not prevent real session cleanup. */ }
  }
}
