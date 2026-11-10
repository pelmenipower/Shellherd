// State machine for the remote lab (view-only screen sharing). No Electron dependency: everything
// external (server, account, peer, presence, identity, timers) is injected. Deadlines use the local clock only.
import type { KeyObject } from 'node:crypto';
import { z } from 'zod';
import { isDeviceName } from '../../shared/device-name';
import { compareText } from '../../shared/format';
import { REMOTE_LAB_LIMITS } from '../../shared/remote-lab';
import type { RemoteMediaReply } from '../../shared/remote-media';
import type {
  RemoteDevice, RemoteEndReason, RemoteErrorCode, RemoteLabEvent, RemoteLabReply, RemoteLabSession, RemoteLabState, RemoteSignalPart,
} from '../../shared/remote-lab';
import { SignalCollector, checkSdp, isSignalPart, normalizeVerification, splitSignal, verifyFingerprintPrefix } from '../../shared/remote-signal';
import { normalizeSyncServerUrl } from '../../shared/sync-server-url.mjs';
import type { RemoteIdentity, RemoteIdentityStore } from './identity';
import type { MediaPort } from './media-window';
import type { PresenceHandlers, PresenceTimers, PresenceTransport } from './presence';

export interface RemoteServerInfo { serverUrl: string; serverId: string; namespace: string; authentication: 'password' | 'device' | 'enrolled-device'; deviceSessions: boolean; rendezvous: boolean; rendezvousProof: boolean; rendezvousNoise: boolean }
/** What the native consent dialog shows; fingerprint is the full 64-hex id of the requester. */
export interface CapturePrompt { name: string; fingerprint: string; verified: boolean }
export interface RemoteSessionWire { id: string; from: string; to: string; nonce: string; scope: string; state: string; expiresAt: number }
export interface RemoteChannel { readonly ready: boolean; accept(): Promise<void>; send(value: unknown): Promise<unknown>; receive(): Promise<unknown[]>; close(): Promise<void>; dispose(): void }
export interface RemotePeer {
  readonly identity: { id: string; publicKey: string; privateKey: KeyObject };
  register(name: string): Promise<unknown>; devices(): Promise<unknown[]>; sessions(): Promise<unknown[]>; unregister(): Promise<unknown>;
  request(target: string, scope: 'view'): Promise<RemoteSessionWire>;
  channel(session: RemoteSessionWire, expectedFingerprint: string, scope: 'view'): RemoteChannel;
  /** Drops a request that never became a channel (frees one of the peer's request slots). */
  forget(sessionId: string): void;
}
export interface RemoteAccount {
  enroll(identity: RemoteIdentity, input: { username: string; password: string; name: string; ephemeral: boolean }): Promise<unknown>;
  openSession(identity: RemoteIdentity): Promise<{ signedIn: true; expiresAt: number; device: string }>;
  request(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: string): Promise<unknown>;
  refresh(): Promise<{ expiresAt: number }>;
  logout(): Promise<void>; close(): void;
}
export interface RemoteDeps {
  probe(serverUrl: string, allowPrivateHttp: boolean, signal: AbortSignal): Promise<RemoteServerInfo>;
  createAccount(info: RemoteServerInfo, signal: AbortSignal): RemoteAccount;
  createPeer(account: RemoteAccount, identity: RemoteIdentity): RemotePeer;
  identity(): RemoteIdentityStore;
  presence(transport: PresenceTransport, name: string, handlers: PresenceHandlers): { start(): Promise<void>; stop(): Promise<void> };
  timers: PresenceTimers;
  isUnlocked(): boolean;
  /** Constant-time check against the unlocked vault; rejects (any error) when the vault is locked. */
  matchesVaultPassword(password: string): Promise<boolean>;
  /** Native consent in main: 'declined' on a real refusal or abort, 'unavailable' when no dialog could be shown (no window). Never throws. */
  confirmCapture(owner: number, prompt: CapturePrompt, signal: AbortSignal): Promise<'accepted' | 'declined' | 'unavailable'>;
  /** The hidden agent window and the viewer window (Electron-free port). */
  media: MediaPort;
  /** Fallback path B only: id of the first screen source from desktopCapturer. Absent means path A. */
  captureSource?(): Promise<string | null>;
}

const L = REMOTE_LAB_LIMITS;
/** Global brake (V7): this many refused or expired unverified requests within the window silence further ones until goOnline. */
const BRAKE_COUNT = 3;
const BRAKE_WINDOW_MS = 600_000;
const hex64 = /^[a-f0-9]{64}$/;
const uuid = z.string().uuid();
const sessionId = z.string().min(1).max(128);
const requestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('status'), clientId: uuid }).strict(),
  z.object({ kind: z.literal('close'), clientId: uuid }).strict(),
  z.object({ kind: z.literal('connect'), clientId: uuid, serverUrl: z.string().max(2048), privateNetwork: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal('signIn'), clientId: uuid, username: z.string().regex(/^[a-zA-Z0-9_.-]{1,64}$/), password: z.string().min(1).max(1024), deviceName: z.string().max(1024), confirmElsewhere: z.literal(true).optional() }).strict(),
  z.object({ kind: z.literal('openSession'), clientId: uuid }).strict(),
  z.object({ kind: z.literal('goOnline'), clientId: uuid, deviceName: z.string().max(1024) }).strict(),
  z.object({ kind: z.literal('goOffline'), clientId: uuid }).strict(),
  z.object({ kind: z.literal('request'), clientId: uuid, target: z.string().regex(hex64), verification: z.string().max(64).nullable() }).strict(),
  z.object({ kind: z.literal('armCapture'), clientId: uuid, sessionId, verification: z.string().max(64).nullable() }).strict(),
  z.object({ kind: z.literal('decline'), clientId: uuid, sessionId }).strict(),
  z.object({ kind: z.literal('stop'), clientId: uuid, sessionId }).strict(),
]);
const mediaSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('signal'), part: z.unknown() }).strict(),
  z.object({ kind: z.literal('stop') }).strict(),
  z.object({ kind: z.literal('failed'), code: z.enum(['peer', 'signal', 'media']) }).strict(),
]);
const wireSchema = z.object({
  id: z.string().regex(hex64), from: z.string().regex(hex64), to: z.string().regex(hex64), nonce: z.string().regex(/^[a-f0-9]{1,128}$/),
  scope: z.string().max(32), state: z.string().max(32), expiresAt: z.number().finite(),
});
const deviceSchema = z.object({ id: z.string().regex(hex64), name: z.string().refine(isDeviceName), publicKey: z.string().max(256) });
const frameSchema = z.object({ part: z.unknown() }).strict();

interface Sess {
  id: string; role: 'viewer' | 'agent'; peer: RemoteDevice; wire: RemoteSessionWire;
  state: RemoteLabSession['state']; deadline: number; requestDeadline: number; startedAt?: number;
  channel?: RemoteChannel; collector: SignalCollector; tail: Promise<unknown>; pending: number;
  armed: boolean; handles: Set<unknown>; deadlineHandle?: unknown; ended: boolean;
  owner: number; verified: boolean; attempts: number; prompting: boolean; captured: boolean; abort: AbortController;
  /** Complete signal messages received so far (V1: exactly one is allowed). */
  messages: number;
  /** Webcontents id of the media window of this session (B5). */
  media?: number;
  mediaReady: boolean;
  /** The one-time capture grant was used by the display-media handler (B7). */
  grantConsumed: boolean;
  /** Agent: 'accepted' was sent to the media window. Viewer: the offer was delivered. */
  ownStarted: boolean;
  /** Own description (offer/answer) of the media window: parts collected so far, and complete (forwarded). */
  out: SignalCollector;
  sent: boolean;
  /** Parts of the incoming message: partial, and complete but not yet delivered to the media window. */
  rx: RemoteSignalPart[];
  inbound: RemoteSignalPart[];
  /** Own parts collected until the message is complete and checked. */
  outParts: RemoteSignalPart[];
}
interface PeerDevice { id: string; name: string; publicKey: string }
interface Online { store: RemoteIdentityStore; identity: RemoteIdentity; persistent: boolean; peer: RemotePeer; presence: { start(): Promise<void>; stop(): Promise<void> }; devices: PeerDevice[]; processed: Set<string>; attempts: Map<string, number>; muted: Map<string, number>; mutedCount: number; refusals: number[] }

const statusOf = (error: unknown): number | undefined =>
  typeof error === 'object' && error !== null && typeof (error as { status?: unknown }).status === 'number' ? (error as { status: number }).status : undefined;
const wireError = (error: unknown): RemoteErrorCode => statusOf(error) === 401 ? 'authentication' : statusOf(error) === 429 ? 'limit' : 'connection';

export class RemoteLabHost {
  #binding?: { owner: number; clientId: string };
  #phase: RemoteLabState['phase'] = 'idle';
  #info?: RemoteServerInfo;
  #account?: RemoteAccount;
  #user?: { username: string; validUntil: number; deviceName: string };
  #loaded?: { identity: RemoteIdentity; persistent: boolean };
  #enrolled?: { username: string; name: string };
  #elsewhere?: string;
  #online?: Online;
  #session?: Sess;
  #controller = new AbortController();
  #busy = false;
  #gen = 0;
  #sharing = false;
  #lastSent?: string;
  readonly #listeners = new Set<(owner: number, event: RemoteLabEvent) => void>();
  readonly #sharingListeners = new Set<(sharing: boolean) => void>();

  constructor(private readonly deps?: RemoteDeps) {}

  get enabled(): boolean { return this.deps !== undefined; }
  get sharing(): boolean { return this.#sharing; }
  onEvent(listener: (owner: number, event: RemoteLabEvent) => void): () => void { this.#listeners.add(listener); return () => { this.#listeners.delete(listener); }; }
  onSharingChange(listener: (sharing: boolean) => void): () => void { this.#sharingListeners.add(listener); return () => { this.#sharingListeners.delete(listener); }; }

  async action(owner: number, raw: unknown): Promise<RemoteLabReply> {
    if (!this.deps) return { ok: false, code: 'unavailable' };
    const parsed = requestSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, code: 'invalid' };
    const req = parsed.data;
    const bound = this.#binding;
    if (!bound) {
      if (req.kind === 'status' || req.kind === 'close') return { ok: true, state: { phase: 'idle' } };
      if (req.kind !== 'connect') return this.#fail('stale');
    } else if (bound.owner !== owner || bound.clientId !== req.clientId) return { ok: false, code: 'stale' };
    switch (req.kind) {
      case 'status': return this.#ok();
      case 'close': this.#teardown('stopped'); return { ok: true, state: { phase: 'idle' } };
      case 'connect': return this.#exclusive(() => this.#connect(owner, req.clientId, req.serverUrl, req.privateNetwork === true));
      case 'signIn': return this.#exclusive(() => this.#signIn(req.username, req.password, req.deviceName, req.confirmElsewhere));
      case 'openSession': return this.#exclusive(() => this.#openSession());
      case 'goOnline': return this.#exclusive(() => this.#goOnline(req.deviceName));
      case 'goOffline': return this.#exclusive(() => this.#goOffline());
      case 'request': return this.#exclusive(() => this.#request(req.target, req.verification));
      case 'armCapture': return this.#armCapture(req.sessionId, req.verification);
      case 'decline': return this.#decline(req.sessionId);
      case 'stop': return this.#stop(req.sessionId);
    }
  }

  /** Agent session in state 'granted' whose media window is this one, grant not consumed, not ended. */
  grantedSession(webContentsId: number): string | null {
    const s = this.#session;
    return s && s.role === 'agent' && s.state === 'granted' && s.media === webContentsId && !s.grantConsumed && !s.ended ? s.id : null;
  }

  /** Same condition as grantedSession; marks the grant consumed (once). */
  consumeCaptureGrant(webContentsId: number): string | null {
    const id = this.grantedSession(webContentsId);
    if (id === null) return null;
    this.#session!.grantConsumed = true;
    return id;
  }

  /** The live captured agent session with this media window (consumed or not), for the check after getSources. */
  isCaptureSession(webContentsId: number, sessionId?: string): boolean {
    const s = this.#session;
    return !!s && (sessionId === undefined || s.id === sessionId) && s.role === 'agent' && s.captured && s.media === webContentsId && !s.ended;
  }

  closeOwner(owner: number): void {
    if (this.#binding?.owner === owner) this.#teardown('stopped');
  }
  reset(reason?: 'locked'): void { this.#teardown(reason ?? 'stopped'); }

  // --- network actions -------------------------------------------------------------------------

  async #exclusive(fn: () => Promise<RemoteLabReply>): Promise<RemoteLabReply> {
    if (this.#busy) return { ok: false, code: 'stale' };
    this.#busy = true;
    const gen = this.#gen;
    try { return await fn(); }
    finally { if (this.#gen === gen) this.#busy = false; } // A teardown already cleared the flag.
  }

  async #connect(owner: number, clientId: string, serverUrl: string, privateNetwork: boolean): Promise<RemoteLabReply> {
    if (this.#binding) return { ok: false, code: 'stale' };
    const url = normalizeSyncServerUrl(serverUrl, { loopback: true, private: privateNetwork });
    if (!url) return { ok: false, code: 'invalid' };
    this.#binding = { owner, clientId };
    this.#controller = new AbortController();
    const gen = this.#gen;
    try {
      const info = await this.deps!.probe(url, privateNetwork, this.#controller.signal);
      if (this.#gen !== gen) return { ok: false, code: 'stale' };
      if (info.authentication !== 'enrolled-device' || info.deviceSessions !== true || !info.rendezvous || info.rendezvousProof !== true || info.rendezvousNoise !== true) { this.#binding = undefined; return { ok: false, code: 'unavailable' }; }
      const store = this.deps!.identity();
      let loaded: { identity: RemoteIdentity; persistent: boolean };
      try { loaded = store.load(); } catch { this.#binding = undefined; this.#lastSent = undefined; return { ok: false, code: 'identity' }; }
      this.#loaded = loaded;
      const e = store.enrollment(info.serverId, info.serverUrl);
      if (e && e.namespace === info.namespace) this.#enrolled = { username: e.username, name: e.name };
      else if (!e) this.#elsewhere = store.enrolledElsewhere(info.serverId, info.serverUrl); // Same origin, new namespace: server reset, enroll normally (N7).
      this.#info = info; this.#phase = 'serverReady';
      return this.#ok();
    } catch {
      if (this.#gen !== gen) return { ok: false, code: 'stale' };
      this.#binding = undefined; this.#lastSent = undefined;
      return { ok: false, code: 'connection' };
    }
  }

  async #signIn(username: string, password: string, deviceName: string, confirmElsewhere?: true): Promise<RemoteLabReply> {
    if (this.#phase !== 'serverReady' || !this.#info || !this.#loaded) return { ok: false, code: 'stale' };
    if (!this.deps!.isUnlocked()) return { ok: false, code: 'locked' };
    if (!isDeviceName(deviceName)) return { ok: false, code: 'invalid' };
    // Another address already holds an enrollment for this server ID: enrolling here needs an explicit confirmation (K29).
    if (this.#elsewhere && confirmElsewhere !== true) return { ok: false, code: 'enrolledElsewhere' };
    const gen = this.#gen;
    let same: boolean;
    try { same = await this.deps!.matchesVaultPassword(password); } catch { return { ok: false, code: 'locked' }; }
    if (this.#gen !== gen) return { ok: false, code: 'stale' };
    if (same) return { ok: false, code: 'samePassword' };
    const info = this.#info;
    const loaded = this.#loaded;
    const account = this.deps!.createAccount(info, this.#controller.signal);
    try {
      await account.enroll(loaded.identity, { username, password, name: deviceName, ephemeral: !loaded.persistent });
      const result = await account.openSession(loaded.identity);
      if (this.#gen !== gen) { account.close(); return { ok: false, code: 'stale' }; }
      this.deps!.identity().rememberEnrollment({ serverId: info.serverId, namespace: info.namespace, serverUrl: info.serverUrl, username, name: deviceName, enrolledAt: this.deps!.timers.now() });
      this.#enrolled = { username, name: deviceName }; this.#elsewhere = undefined;
      this.#account = account; this.#user = { username, validUntil: result.expiresAt, deviceName }; this.#phase = 'signedIn';
      return this.#ok();
    } catch (error) {
      account.close();
      return this.#gen !== gen ? { ok: false, code: 'stale' } : { ok: false, code: statusOf(error) === 403 ? 'enrollmentLocked' : wireError(error) };
    }
  }

  /** Signed session from the enrolled device key; no password. A second 401 means the server forgot this device (B6). */
  async #openSession(): Promise<RemoteLabReply> {
    const info = this.#info;
    const loaded = this.#loaded;
    const enrolled = this.#enrolled;
    if (this.#phase !== 'serverReady' || !info || !loaded || !enrolled || this.#account) return { ok: false, code: 'stale' };
    if (!this.deps!.isUnlocked()) return { ok: false, code: 'locked' };
    const gen = this.#gen;
    for (let attempt = 0; attempt < 2; attempt++) {
      const account = this.deps!.createAccount(info, this.#controller.signal);
      try {
        const result = await account.openSession(loaded.identity);
        if (this.#gen !== gen) { account.close(); return { ok: false, code: 'stale' }; }
        this.#account = account; this.#user = { username: enrolled.username, validUntil: result.expiresAt, deviceName: enrolled.name }; this.#phase = 'signedIn';
        return this.#ok();
      } catch (error) {
        account.close();
        if (this.#gen !== gen) return { ok: false, code: 'stale' };
        if (statusOf(error) === 401 && attempt === 0) continue;
        if (statusOf(error) === 401) {
          this.deps!.identity().forgetEnrollment(info.serverId, info.serverUrl);
          this.#enrolled = undefined;
          this.#publish();
        }
        return { ok: false, code: wireError(error) };
      }
    }
    return { ok: false, code: 'connection' };
  }

  async #goOnline(name: string): Promise<RemoteLabReply> {
    const account = this.#account;
    if (this.#phase !== 'signedIn' || !account) return { ok: false, code: 'stale' };
    if (!this.deps!.isUnlocked()) return { ok: false, code: 'locked' };
    const loaded = this.#loaded;
    if (!loaded) return { ok: false, code: 'stale' };
    // An empty name falls back to the name given at enrollment.
    if (name === '' && this.#enrolled) name = this.#enrolled.name;
    if (!isDeviceName(name)) return { ok: false, code: 'invalid' };
    const gen = this.#gen;
    const store = this.deps!.identity();
    const peer = this.deps!.createPeer(account, loaded.identity);
    const transport: PresenceTransport = {
      register: n => peer.register(n), sessions: () => peer.sessions(), devices: () => peer.devices(),
      refresh: () => account.refresh(), unregister: () => peer.unregister(),
    };
    const ctx: Online = { store, identity: loaded.identity, persistent: loaded.persistent, peer, devices: [], processed: new Set(), attempts: new Map(), muted: new Map(), mutedCount: 0, refusals: [], presence: undefined as unknown as Online['presence'] };
    const live = (): boolean => this.#online === ctx;
    ctx.presence = this.deps!.presence(transport, name, {
      onSessions: list => { if (live()) this.#onSessions(ctx, list); },
      onDevices: list => { if (live()) this.#onDevices(ctx, list); },
      onValidUntil: ms => { if (live() && this.#user) { this.#user.validUntil = ms; this.#publish(); } },
      onOffline: code => { if (live()) this.#onOffline(code); },
    });
    this.#online = ctx; this.#phase = 'online';
    try { await ctx.presence.start(); }
    catch (error) {
      if (this.#gen !== gen) return { ok: false, code: 'stale' };
      if (this.#online === ctx) { this.#online = undefined; this.#phase = 'signedIn'; }
      void ctx.presence.stop().catch(() => undefined);
      if (statusOf(error) === 401) this.#dropAccount();
      this.#publish();
      return { ok: false, code: wireError(error) };
    }
    if (this.#gen !== gen || this.#online !== ctx) return { ok: false, code: 'stale' };
    return this.#ok();
  }

  async #goOffline(): Promise<RemoteLabReply> {
    const ctx = this.#online;
    if (this.#phase !== 'online' || !ctx) return { ok: false, code: 'stale' };
    if (this.#session) this.#end(this.#session, 'stopped');
    this.#online = undefined; this.#phase = 'signedIn';
    await ctx.presence.stop().catch(() => undefined);
    return this.#ok();
  }

  async #request(target: string, verification: string | null): Promise<RemoteLabReply> {
    const ctx = this.#online;
    if (this.#phase !== 'online' || !ctx || this.#session) return { ok: false, code: 'stale' };
    if (!this.deps!.isUnlocked()) return { ok: false, code: 'locked' };
    const device = ctx.devices.find(d => d.id === target);
    if (!device) return { ok: false, code: 'stale' };
    if (verification === null) {
      if (ctx.store.known(target)?.verified !== true) return { ok: false, code: 'invalid' };
    } else {
      if (normalizeVerification(verification) === null) return { ok: false, code: 'invalid' };
      if ((ctx.attempts.get(target) ?? 0) >= L.verificationAttempts) return { ok: false, code: 'mismatch' };
      if (!verifyFingerprintPrefix(verification, target)) {
        ctx.attempts.set(target, (ctx.attempts.get(target) ?? 0) + 1);
        return { ok: false, code: 'mismatch' };
      }
      ctx.attempts.delete(target);
    }
    const verified = verification !== null;
    const gen = this.#gen;
    let wire: RemoteSessionWire;
    try { wire = await ctx.peer.request(target, 'view'); }
    catch (error) {
      if (this.#gen !== gen) return { ok: false, code: 'stale' };
      if (statusOf(error) === 401) {
        // Expired sign-in: back to serverReady so the user can sign in again (no dead account).
        if (this.#online === ctx) { this.#online = undefined; void ctx.presence.stop().catch(() => undefined); }
        this.#dropAccount();
        this.#publish();
        return { ok: false, code: 'authentication' };
      }
      return { ok: false, code: statusOf(error) === 429 ? 'limit' : 'connection' };
    }
    if (this.#gen !== gen || this.#online !== ctx || this.#session) {
      void this.#delete(wire.id);
      return { ok: false, code: 'stale' };
    }
    const now = this.deps!.timers.now();
    const s = this.#newSession('viewer', wire, device, now + L.requestMs);
    s.verified = verified;
    s.requestDeadline = s.deadline;
    this.#session = s;
    this.#startDeadline(s);
    this.#pollRequest(s);
    return this.#ok();
  }

  // --- session actions -------------------------------------------------------------------------

  #armCapture(id: string, verification: string | null): RemoteLabReply {
    const s = this.#session;
    if (!s || s.id !== id || s.role !== 'agent' || s.state !== 'consent' || s.armed) return { ok: false, code: 'stale' };
    if (!this.deps!.isUnlocked()) return { ok: false, code: 'locked' };
    if (verification === null) {
      if (s.peer.known?.verified !== true) return { ok: false, code: 'invalid' };
    } else {
      if (normalizeVerification(verification) === null) return { ok: false, code: 'invalid' };
      if (!verifyFingerprintPrefix(verification, s.peer.id)) {
        s.attempts++;
        if (s.attempts >= L.verificationAttempts) {
          this.#mute(s.peer.id);
          this.#end(s, 'mismatch');
        } else this.#publish();
        return { ok: false, code: 'mismatch' };
      }
      s.verified = true;
    }
    s.armed = true;
    this.#after(s, L.nativeDelayMs, () => { void this.#prompt(s); });
    return this.#ok();
  }

  /** Native consent, then media window, capture and handshake (agent). Every failure after open ends the session (K8). */
  async #prompt(s: Sess): Promise<void> {
    const deps = this.deps!;
    const gone = (): boolean => s.ended || this.#session !== s;
    if (gone() || s.role !== 'agent' || s.state !== 'consent' || !s.armed || s.prompting || !deps.isUnlocked() || deps.timers.now() >= s.deadline) return;
    s.prompting = true;
    let result: 'accepted' | 'declined' | 'unavailable' = 'declined';
    try { result = await deps.confirmCapture(s.owner, { name: s.peer.name, fingerprint: s.peer.id, verified: s.verified || s.peer.known?.verified === true }, s.abort.signal); }
    catch { result = 'declined'; }
    s.prompting = false;
    if (gone()) return;
    // No dialog could be shown (no window): nobody refused, so neither mute nor end (K7).
    if (result === 'unavailable') { s.armed = false; this.#publish(); return; }
    if (result !== 'accepted') { this.#mute(s.peer.id); this.#end(s, 'declined'); return; }
    const locked = !deps.isUnlocked();
    if (locked || deps.timers.now() >= s.deadline) { this.#end(s, locked ? 'locked' : 'expired'); return; }
    s.state = 'granted'; s.captured = true;
    this.#publish();
    let id: number;
    try { id = deps.media.open({ role: 'agent', peerName: s.peer.name }); }
    catch { this.#emit({ kind: 'error', code: 'mediaWindow' }); this.#end(s, 'failed'); return; }
    s.media = id;
    if (!await deps.media.ready(id)) {
      if (gone()) return;
      this.#emit({ kind: 'error', code: 'mediaWindow' }); this.#end(s, 'failed'); return;
    }
    if (gone()) return;
    s.mediaReady = true;
    // No data of the other side before the capture has started.
    deps.media.send(id, { kind: 'hello', role: 'agent', peerName: '', expiresAt: s.deadline });
    let source: string | undefined;
    try { source = (await deps.captureSource?.()) ?? undefined; }
    catch { if (!gone()) { this.#emit({ kind: 'error', code: 'media' }); this.#end(s, 'failed'); } return; }
    if (gone()) return;
    const ok = await deps.media.capture(id, source);
    if (gone()) return;
    // Chromium reports but does not enforce the gesture: the one-time grant must have been used (B7).
    if (!ok || !s.grantConsumed) { this.#emit({ kind: 'error', code: 'media' }); this.#end(s, 'failed'); return; }
    await this.#openChannel(s, id);
  }

  /** Former accept body: channel, Noise handshake, connecting; then the media window creates its offer (K6 timer). */
  async #openChannel(s: Sess, id: number): Promise<void> {
    const deps = this.deps!;
    const timers = deps.timers;
    const gone = (): boolean => s.ended || this.#session !== s;
    if (!this.#online) { this.#end(s, 'failed'); return; }
    if (!deps.isUnlocked()) { this.#end(s, 'locked'); return; }
    if (timers.now() >= s.deadline) { this.#end(s, 'expired'); return; }
    let channel: RemoteChannel;
    try { channel = this.#online.peer.channel(s.wire, s.peer.id, 'view'); }
    catch { this.#emit({ kind: 'error', code: 'mismatch' }); this.#end(s, 'failed'); return; }
    s.channel = channel;
    try { await channel.accept(); }
    catch {
      if (gone()) return;
      if (timers.now() >= s.deadline) this.#end(s, 'expired');
      else { this.#emit({ kind: 'error', code: 'connection' }); this.#end(s, 'failed'); }
      return;
    }
    if (gone()) return;
    // The state stays 'granted' during the handshake; decline and stop end it.
    const r = await this.#establish(s);
    if (!r.ok) { if (r.code === 'mismatch') this.#emit({ kind: 'error', code: 'mismatch' }); return; }
    if (gone()) return;
    s.state = 'connecting';
    s.deadline = timers.now() + L.sessionMs;
    this.#startDeadline(s);
    this.#setSharing(true);
    deps.media.send(id, { kind: 'accepted' });
    s.ownStarted = true;
    this.#startOwnDeadline(s);
    this.#publish();
    if (this.#consume(s, r.values)) this.#startLoop(s);
  }

  /** K6: no complete own description within handshakeMs ends the session. */
  #startOwnDeadline(s: Sess): void {
    this.#after(s, L.handshakeMs, () => {
      if (s.sent) return;
      this.#emit({ kind: 'error', code: 'signal' });
      this.#end(s, 'failed');
    });
  }

  #decline(id: string): RemoteLabReply {
    const s = this.#session;
    if (!s || s.id !== id || s.role !== 'agent' || (s.state !== 'consent' && s.state !== 'granted')) return { ok: false, code: 'stale' };
    this.#mute(s.peer.id);
    this.#end(s, 'declined');
    return this.#ok();
  }

  /** Suppresses further requests of this device for muteMs (FIFO, at most 64 entries). */
  #mute(fingerprint: string): void {
    const ctx = this.#online;
    if (!ctx) return;
    ctx.muted.delete(fingerprint);
    ctx.muted.set(fingerprint, this.deps!.timers.now() + L.muteMs);
    if (ctx.muted.size > 64) ctx.muted.delete(ctx.muted.keys().next().value as string);
  }

  #stop(id: string): RemoteLabReply {
    const s = this.#session;
    if (!s || s.id !== id) return { ok: false, code: 'stale' };
    this.#end(s, 'stopped');
    return this.#ok();
  }

  /** Actions of the media window. Replies never carry state (B8). */
  async mediaAction(webContentsId: number, raw: unknown): Promise<RemoteMediaReply> {
    const s = this.#session;
    if (!this.deps || !s || s.media === undefined || s.media !== webContentsId || s.ended) return { ok: false, code: 'stale' };
    const parsed = mediaSchema.safeParse(raw);
    if (!parsed.success) { this.#end(s, 'failed'); return { ok: false, code: 'invalid' }; }
    const action = parsed.data;
    switch (action.kind) {
      case 'stop': this.#end(s, 'stopped'); return { ok: true };
      case 'failed': this.#emit({ kind: 'error', code: action.code }); this.#end(s, 'failed'); return { ok: true };
      case 'signal': return this.#ownSignal(s, action.part);
    }
  }

  async #ownSignal(s: Sess, raw: unknown): Promise<RemoteMediaReply> {
    const channel = s.channel;
    const ready = s.role === 'agent' ? s.ownStarted : s.ownStarted && s.mediaReady;
    if (!channel || !channel.ready || (s.state !== 'connecting' && s.state !== 'active') || s.sent || !ready) return { ok: false, code: 'stale' };
    const kind = s.role === 'agent' ? 'offer' : 'answer';
    if (!isSignalPart(raw) || raw.kind !== kind) { this.#end(s, 'failed'); return { ok: false, code: 'invalid' }; }
    const part: RemoteSignalPart = raw;
    let message: ReturnType<SignalCollector['push']>;
    try { message = s.out.push(part); } catch { this.#end(s, 'failed'); return { ok: false, code: 'invalid' }; }
    s.outParts.push(part);
    if (!message) return { ok: true };
    try { checkSdp(message.data, kind); }
    catch { this.#emit({ kind: 'error', code: 'signal' }); this.#end(s, 'failed'); return { ok: false, code: 'invalid' }; }
    s.sent = true;
    const parts = s.outParts;
    s.outParts = [];
    for (const p of parts) {
      s.pending++;
      const run = s.tail.then(() => { if (this.#session !== s) throw new Error('ended'); return channel.send({ part: p }); });
      s.tail = run.catch(() => undefined);
      try { await run; }
      catch {
        s.pending--;
        if (this.#session === s) this.#end(s, 'failed');
        return { ok: false, code: 'stale' };
      }
      s.pending--;
    }
    return { ok: true };
  }

  /** The media window closed or its renderer is gone (T1: MediaWindows does not end on its own). */
  mediaGone(webContentsId: number, reason: 'closed' | 'crashed'): void {
    const s = this.#session;
    if (!s || s.media === undefined || s.media !== webContentsId || s.ended) return;
    this.#end(s, s.role === 'viewer' && reason === 'closed' ? 'stopped' : 'failed');
  }

  // --- incoming lists --------------------------------------------------------------------------

  #onDevices(ctx: Online, list: unknown[]): void {
    const own = ctx.identity.id;
    ctx.devices = list.flatMap(item => { const r = deviceSchema.safeParse(item); return r.success && r.data.id !== own ? [{ id: r.data.id, name: r.data.name, publicKey: r.data.publicKey }] : []; })
      .sort((a, b) => compareText(a.name, b.name));
    this.#publish();
  }

  #onSessions(ctx: Online, list: unknown[]): void {
    const wires = list.flatMap(item => { const r = wireSchema.safeParse(item); return r.success ? [r.data] : []; });
    const current = this.#session;
    if (current?.role === 'agent' && (current.state === 'consent' || current.state === 'granted') && !wires.some(w => w.id === current.id)) this.#end(current, 'remote', 'remote');
    for (const wire of wires) {
      if (wire.to !== ctx.identity.id || wire.state !== 'pending' || ctx.processed.has(wire.id)) continue;
      const now = this.deps!.timers.now();
      if (ctx.refusals.filter(at => now - at < BRAKE_WINDOW_MS).length >= BRAKE_COUNT && ctx.store.known(wire.from)?.verified !== true) {
        this.#markProcessed(ctx, wire.id); void this.#delete(wire.id); ctx.mutedCount++; continue;
      }
      const mutedUntil = ctx.muted.get(wire.from);
      if (mutedUntil !== undefined) {
        if (this.deps!.timers.now() < mutedUntil) { this.#markProcessed(ctx, wire.id); void this.#delete(wire.id); ctx.mutedCount++; continue; }
        ctx.muted.delete(wire.from);
      }
      if (wire.scope !== 'view' || this.#session) { this.#markProcessed(ctx, wire.id); void this.#delete(wire.id); continue; }
      const device = ctx.devices.find(d => d.id === wire.from);
      if (!device) continue; // Not in the device list yet: retry next round without marking.
      this.#markProcessed(ctx, wire.id);
      const s = this.#newSession('agent', wire, device, this.deps!.timers.now() + L.consentMs);
      s.state = 'consent';
      this.#session = s;
      this.#startDeadline(s);
    }
    this.#publish();
  }

  #markProcessed(ctx: Online, id: string): void {
    ctx.processed.add(id);
    if (ctx.processed.size > 64) ctx.processed.delete(ctx.processed.values().next().value as string);
  }

  #onOffline(code: 'authentication' | 'connection'): void {
    const s = this.#session;
    if (s) this.#end(s, 'failed');
    this.#online = undefined;
    if (code === 'authentication') this.#dropAccount();
    else this.#phase = 'signedIn';
    this.#publish();
    this.#emit({ kind: 'error', code });
  }

  /** Discards the account after an expired sign-in (logout best effort, then close) and returns to serverReady. */
  #dropAccount(): void {
    const account = this.#account;
    this.#account = undefined; this.#user = undefined; this.#phase = 'serverReady';
    if (account) void account.logout().catch(() => undefined).finally(() => account.close());
  }

  // --- session plumbing ------------------------------------------------------------------------

  #newSession(role: 'viewer' | 'agent', wire: RemoteSessionWire, device: PeerDevice, deadline: number): Sess {
    return {
      id: wire.id, role, wire, peer: this.#peerOf(device),
      state: role === 'viewer' ? 'requesting' : 'consent', deadline, requestDeadline: deadline, collector: new SignalCollector(),
      tail: Promise.resolve(), pending: 0, armed: false, handles: new Set(), ended: false,
      owner: this.#binding!.owner, verified: false, attempts: 0, prompting: false, captured: false, abort: new AbortController(), messages: 0,
      mediaReady: false, grantConsumed: false, ownStarted: false, out: new SignalCollector(), sent: false, rx: [], inbound: [], outParts: [],
    };
  }

  #peerOf(device: PeerDevice): RemoteDevice {
    const store = this.#online?.store;
    const known = store?.known(device.id);
    return { id: device.id, name: device.name, ...(known ? { known: { ...known } } : {}), ...(store?.renamed(device.id, device.name) ? { changed: true as const } : {}) };
  }

  #after(s: Sess, ms: number, fn: () => void): void {
    const handle = this.deps!.timers.setTimeout(() => { s.handles.delete(handle); if (!s.ended) fn(); }, ms);
    s.handles.add(handle);
  }

  #startDeadline(s: Sess): void {
    // A previous deadline timer is replaced when the deadline moves (viewer active, agent accept).
    if (s.deadlineHandle !== undefined) { this.deps!.timers.clearTimeout(s.deadlineHandle); s.handles.delete(s.deadlineHandle); }
    const handle = this.deps!.timers.setTimeout(() => { s.handles.delete(handle); if (!s.ended) this.#end(s, 'expired'); }, Math.max(0, s.deadline - this.deps!.timers.now()));
    s.deadlineHandle = handle; s.handles.add(handle);
  }

  #pollRequest(s: Sess): void {
    this.#after(s, L.setupPollMs, () => { void this.#pollTick(s); });
  }

  async #pollTick(s: Sess): Promise<void> {
    const timers = this.deps!.timers;
    let result: unknown;
    try { result = await this.#account!.request('GET', `/v1/rendezvous/sessions/${s.id}`); }
    catch (error) {
      if (s.ended) return;
      if (statusOf(error) === 404) this.#end(s, timers.now() < s.requestDeadline ? 'declined' : 'expired', 'remote');
      else this.#pollRequest(s);
      return;
    }
    if (s.ended) return;
    const parsed = wireSchema.safeParse(result);
    if (!parsed.success) { this.#end(s, 'failed'); return; }
    if (parsed.data.state !== 'active') { this.#pollRequest(s); return; }
    try { s.channel = this.#online!.peer.channel(parsed.data, s.peer.id, 'view'); }
    catch { this.#end(s, 'failed'); this.#emit({ kind: 'error', code: 'mismatch' }); return; }
    const r = await this.#establish(s);
    if (!r.ok) { if (r.code === 'mismatch') this.#emit({ kind: 'error', code: 'mismatch' }); return; }
    if (this.#session !== s || s.ended) return;
    s.state = 'connecting';
    s.deadline = timers.now() + L.sessionMs;
    this.#startDeadline(s);
    let id: number;
    try { id = this.deps!.media.open({ role: 'viewer', peerName: s.peer.name }); }
    catch { this.#emit({ kind: 'error', code: 'mediaWindow' }); this.#end(s, 'failed'); return; }
    s.media = id;
    this.#publish();
    void this.#viewerReady(s, id);
    if (this.#consume(s, r.values)) this.#startLoop(s);
  }

  /** K5: hello and the buffered offer follow once the media page has loaded. */
  async #viewerReady(s: Sess, id: number): Promise<void> {
    const ready = await this.deps!.media.ready(id);
    if (s.ended || this.#session !== s) return;
    if (!ready) { this.#emit({ kind: 'error', code: 'mediaWindow' }); this.#end(s, 'failed'); return; }
    s.mediaReady = true;
    this.deps!.media.send(id, { kind: 'hello', role: 'viewer', peerName: s.peer.name, expiresAt: s.deadline });
    this.#deliver(s);
  }

  /** Hands the checked, complete incoming message to the media window, in order. */
  #deliver(s: Sess): void {
    if (s.media === undefined || s.inbound.length === 0) return;
    const parts = s.inbound;
    s.inbound = [];
    for (const part of parts) this.deps!.media.send(s.media, { kind: 'signal', part });
    if (s.role === 'viewer' && !s.ownStarted) { s.ownStarted = true; this.#startOwnDeadline(s); }
  }

  /** Resolves when the timer fires or the session aborts; the handle never outlives the session. */
  #sleep(s: Sess, ms: number): Promise<void> {
    return new Promise(resolve => {
      if (s.ended) { resolve(); return; }
      const timers = this.deps!.timers;
      const done = (): void => { s.abort.signal.removeEventListener('abort', done); s.handles.delete(handle); timers.clearTimeout(handle); resolve(); };
      const handle = timers.setTimeout(done, ms);
      s.handles.add(handle);
      s.abort.signal.addEventListener('abort', done, { once: true });
    });
  }

  /** Drives the Noise handshake until the channel is ready. Delivered values are buffered for #consume, never an error. */
  async #establish(s: Sess): Promise<{ ok: true; values: unknown[] } | { ok: false; code: RemoteErrorCode }> {
    const timers = this.deps!.timers;
    const channel = s.channel!;
    const limit = Math.min(s.deadline, timers.now() + L.handshakeMs);
    const values: unknown[] = [];
    const timeout = (): { ok: false; code: RemoteErrorCode } => {
      if (timers.now() >= s.deadline) { this.#end(s, 'expired'); return { ok: false, code: 'expired' }; }
      this.#end(s, 'failed'); return { ok: false, code: 'connection' };
    };
    for (let first = true; ; first = false) {
      if (!first) await this.#sleep(s, L.setupPollMs);
      if (s.ended || this.#session !== s) return { ok: false, code: 'stale' };
      if (timers.now() >= limit) return timeout();
      try { values.push(...await channel.receive()); }
      catch (error) {
        if (s.ended || this.#session !== s) return { ok: false, code: 'stale' };
        if ((error as { code?: unknown } | null)?.code === 'mismatch') { this.#end(s, 'failed'); return { ok: false, code: 'mismatch' }; }
        if (statusOf(error) === 404) { this.#end(s, 'remote', 'remote'); return { ok: false, code: 'stale' }; }
        if (timers.now() < limit) continue; // 429 or a transient network error: keep polling until handshakeMs.
        return timeout();
      }
      if (s.ended || this.#session !== s) return { ok: false, code: 'stale' };
      if (channel.ready) return { ok: true, values };
    }
  }

  #startLoop(s: Sess): void {
    this.#after(s, s.state === 'active' ? L.activePollMs : L.setupPollMs, () => { void this.#loopTick(s); });
  }

  async #loopTick(s: Sess): Promise<void> {
    let values: unknown[];
    try { values = await s.channel!.receive(); }
    catch (error) {
      if (s.ended) return;
      if (statusOf(error) === 404) this.#end(s, 'remote', 'remote');
      else if (statusOf(error) === 429 && this.deps!.timers.now() < s.deadline) this.#startLoop(s); // Shared server limit: retry next tick.
      else this.#end(s, this.deps!.timers.now() >= s.deadline ? 'expired' : 'failed');
      return;
    }
    if (s.ended) return;
    if (this.#consume(s, values)) this.#startLoop(s);
  }

  /** Processes the values of one receive(); false when the session ended while doing so. */
  #consume(s: Sess, values: unknown[]): boolean {
    for (const value of values) {
      const frame = frameSchema.safeParse(value);
      if (!frame.success || !isSignalPart(frame.data.part)) { this.#end(s, 'failed'); return false; }
      const part = frame.data.part;
      if (part.kind === 'bye') { this.#end(s, 'remote', 'remote'); return false; }
      if (part.kind !== (s.role === 'viewer' ? 'offer' : 'answer')) { this.#end(s, 'failed'); return false; }
      // One complete message per session (V1): any further part ends it before it is passed on.
      if (s.messages >= 1) { this.#end(s, 'failed'); return false; }
      let message: ReturnType<SignalCollector['push']>;
      try { message = s.collector.push(part); } catch { this.#end(s, 'failed'); return false; }
      s.rx.push(part);
      if (!message) continue;
      try { checkSdp(message.data, s.role === 'viewer' ? 'offer' : 'answer'); }
      catch { this.#emit({ kind: 'error', code: 'signal' }); this.#end(s, 'failed'); return false; }
      s.messages++;
      s.inbound.push(...s.rx); s.rx = [];
      if (s.state === 'connecting') {
        const now = this.deps!.timers.now();
        s.state = 'active'; s.startedAt = now;
        const store = this.#online?.store;
        store?.remember(s.peer.id, s.peer.name, now, s.verified || store.known(s.peer.id)?.verified === true);
        this.#publish();
      }
      if (s.mediaReady) this.#deliver(s);
    }
    return !s.ended;
  }

  /** Local ordering (K8): state first, events second, network last and never awaited by the caller. */
  #end(s: Sess, reason: RemoteEndReason, mode: 'local' | 'remote' = 'local'): Promise<void> {
    if (this.#session !== s) return Promise.resolve();
    s.ended = true;
    if (s.media !== undefined) { try { this.deps!.media.destroy(s.media); } catch { /* best effort */ } }
    for (const h of s.handles) this.deps!.timers.clearTimeout(h);
    s.handles.clear();
    s.abort.abort();
    if (s.role === 'agent' && !s.captured && (reason === 'declined' || reason === 'expired') && !s.verified && s.peer.known?.verified !== true) {
      const ctx = this.#online;
      if (ctx) {
        const now = this.deps!.timers.now();
        ctx.refusals = [...ctx.refusals.filter(at => now - at < BRAKE_WINDOW_MS), now];
      }
    }
    if (s.role === 'viewer' && !s.channel) { try { this.#online?.peer.forget(s.id); } catch { /* best effort */ } }
    this.#session = undefined;
    this.#setSharing(false);
    this.#emit({ kind: 'ended', sessionId: s.id, reason });
    this.#publish();
    return this.#cleanup(s, mode);
  }

  async #cleanup(s: Sess, mode: 'local' | 'remote'): Promise<void> {
    try {
      if (s.channel) {
        if (mode === 'local' && s.channel.ready && s.pending === 0) {
          const part = splitSignal('bye', '')[0]!;
          await this.#capped(s.channel.send({ part }), L.byeMs);
        }
        await s.channel.close();
      } else if (mode === 'local') await this.#delete(s.id);
    } catch { /* best effort */ }
    finally { try { s.channel?.dispose(); } catch { /* best effort */ } }
  }

  /** Resolves when the promise settles or after ms (0: no cap); never rejects. */
  #capped(promise: Promise<unknown>, ms: number): Promise<void> {
    return new Promise(resolve => {
      const timers = this.deps!.timers;
      const handle = ms > 0 ? timers.setTimeout(() => resolve(), ms) : undefined;
      const done = (): void => { if (handle !== undefined) timers.clearTimeout(handle); resolve(); };
      promise.then(done, done);
    });
  }

  async #delete(id: string): Promise<void> {
    try { await this.#account?.request('DELETE', `/v1/rendezvous/sessions/${id}`); } catch { /* best effort */ }
  }

  #teardown(reason: 'stopped' | 'locked'): void {
    if (!this.deps) return;
    const s = this.#session;
    const account = this.#account;
    const online = this.#online;
    const cleanup = s ? this.#end(s, reason) : Promise.resolve();
    const controller = this.#controller;
    this.#gen++; this.#busy = false;
    this.#online = undefined; this.#account = undefined; this.#user = undefined; this.#info = undefined; this.#phase = 'idle';
    this.#loaded = undefined; this.#enrolled = undefined; this.#elsewhere = undefined;
    void online?.presence.stop().catch(() => undefined);
    this.#publish();
    this.#binding = undefined; this.#lastSent = undefined;
    if (account) {
      void this.#capped(cleanup, L.byeMs + 500)
        .then(() => account.logout()).catch(() => undefined)
        .finally(() => { account.close(); controller.abort(); });
    } else controller.abort();
  }

  #setSharing(sharing: boolean): void {
    if (this.#sharing === sharing) return;
    this.#sharing = sharing;
    for (const listener of [...this.#sharingListeners]) { try { listener(sharing); } catch { /* listener failure must not break the state machine */ } }
  }

  // --- state and events ------------------------------------------------------------------------

  #state(): RemoteLabState {
    const state: RemoteLabState = { phase: this.#phase };
    if (this.#info) state.server = { serverUrl: this.#info.serverUrl, serverId: this.#info.serverId };
    if (this.#user) state.account = { username: this.#user.username, validUntil: this.#user.validUntil, deviceName: this.#user.deviceName };
    if (this.#loaded) state.identity = { fingerprint: this.#loaded.identity.id, persistent: this.#loaded.persistent };
    if (this.#enrolled) state.enrolled = { ...this.#enrolled };
    if (this.#elsewhere) state.enrolledElsewhere = this.#elsewhere;
    const online = this.#online;
    if (online && this.#phase === 'online') {
      state.devices = online.devices.map(d => this.#peerOf(d));
      if (online.mutedCount > 0) state.muted = online.mutedCount;
    }
    const s = this.#session;
    if (s) state.session = { id: s.id, role: s.role, peer: s.peer, scope: 'view', state: s.state, expiresAt: s.deadline, ...(s.startedAt !== undefined ? { startedAt: s.startedAt } : {}), ...(s.role === 'agent' && s.state === 'consent' && !s.verified && s.peer.known?.verified !== true ? { attemptsLeft: L.verificationAttempts - s.attempts } : {}), ...(s.armed && s.state === 'consent' ? { armed: true as const } : {}) };
    return state;
  }

  #ok(): RemoteLabReply { this.#publish(); return { ok: true, state: this.#state() }; }
  #fail(code: RemoteErrorCode): RemoteLabReply { return { ok: false, code }; }

  #publish(): void {
    if (!this.#binding) return;
    const state = this.#state();
    const json = JSON.stringify(state);
    if (json === this.#lastSent) return;
    this.#lastSent = json;
    this.#emit({ kind: 'state', state });
  }

  #emit(event: RemoteLabEvent): void {
    const owner = this.#binding?.owner;
    if (owner === undefined) return;
    for (const listener of [...this.#listeners]) { try { listener(owner, event); } catch { /* listener failure must not break the state machine */ } }
  }
}
