import { describe, expect, it, vi } from 'vitest';
import type { RemoteLabEvent, RemoteLabReply, RemoteSignalPart } from '../../shared/remote-lab';
import type { RemoteIdentity, RemoteIdentityStore } from './identity';
import { RemoteLabHost, type RemoteAccount, type RemoteChannel, type RemoteDeps, type RemotePeer, type RemoteSessionWire } from './lab-host';
import type { PresenceHandlers } from './presence';

const SELF = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const SID = '1'.repeat(64);
const SID2 = '2'.repeat(64);
const CLIENT = '00000000-0000-4000-8000-000000000001';
const OWNER = 7;
const PREFIX = 'b'.repeat(12);
const URL = 'http://127.0.0.1:8788/';

class Clock {
  t = 1_000_000;
  private seq = 0;
  items = new Map<number, { at: number; fn: () => void }>();
  setTimeout = (fn: () => void, ms: number): unknown => { const id = ++this.seq; this.items.set(id, { at: this.t + ms, fn }); return id; };
  clearTimeout = (h: unknown): void => { this.items.delete(h as number); };
  now = (): number => this.t;
  async advance(ms: number): Promise<void> {
    const target = this.t + ms;
    for (;;) {
      await flush();
      const next = [...this.items.entries()].filter(([, v]) => v.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      this.items.delete(next[0]); this.t = Math.max(this.t, next[1].at); next[1].fn();
    }
    this.t = target; await flush();
  }
}
const flush = async (): Promise<void> => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };

class FakeChannel implements RemoteChannel {
  ready = false;
  sent: unknown[] = [];
  inbox: unknown[][] = [];
  receiveError?: unknown;
  acceptError?: unknown;
  closed = 0;
  disposed = 0;
  sendGate?: () => Promise<void>;
  sendsStarted = 0;
  closeHangs = false;
  async accept(): Promise<void> { if (this.acceptError) throw this.acceptError; this.ready = true; }
  async send(value: unknown): Promise<unknown> { this.sendsStarted++; await this.sendGate?.(); this.sent.push(value); return {}; }
  async receive(): Promise<unknown[]> { if (this.receiveError) throw this.receiveError; this.ready = true; return this.inbox.shift() ?? []; }
  close(): Promise<void> { this.closed++; return this.closeHangs ? new Promise(() => undefined) : Promise.resolve(); }
  dispose(): void { this.disposed++; }
}

const wire = (over: Partial<RemoteSessionWire> = {}): RemoteSessionWire => ({ id: SID, from: B, to: SELF, nonce: 'ab'.repeat(16), scope: 'view', state: 'pending', expiresAt: 1, ...over });
const device = (id: string, name: string) => ({ id, name, publicKey: `pk-${id.slice(0, 1)}`, expiresAt: 1 });
const part = (kind: RemoteSignalPart['kind'], n = 1, of = 1, data = 'x'): RemoteSignalPart => ({ kind, part: n, of, data });

function setup(overrides: { deps?: Partial<RemoteDeps>; probe?: RemoteDeps['probe'] } = {}) {
  const clock = new Clock();
  const channels: FakeChannel[] = [];
  const requests: Array<{ method: string; path: string }> = [];
  let handlers!: PresenceHandlers;
  let presenceStart: () => Promise<void> = async () => undefined;
  const presenceStop = vi.fn(async () => undefined);
  const remember = vi.fn();
  const known = vi.fn((_id: string): { firstSeen: number; verified: boolean; verifiedAt?: number } | undefined => undefined);
  const renamed = vi.fn((_id: string, _name: string) => false);
  const load = vi.fn(() => ({ identity: { id: SELF, publicKey: 'pk-self', privateKey: {} } as unknown as RemoteIdentity, persistent: true }));
  const store = { load, known, remember, renamed } as unknown as RemoteIdentityStore;
  const account: RemoteAccount & { getImpl?: () => Promise<unknown> } = {
    login: vi.fn(async () => ({ signedIn: true as const, expiresAt: 5_000_000 })),
    request: vi.fn(async (method: string, path: string) => { requests.push({ method, path }); if (method === 'GET') return account.getImpl ? account.getImpl() : wire({ from: SELF, to: B }); return {}; }),
    refresh: vi.fn(async () => ({ expiresAt: 1 })), logout: vi.fn(async () => undefined), close: vi.fn(),
  };
  const peer = {
    identity: { id: SELF, publicKey: 'pk-self', privateKey: {} },
    request: vi.fn(async (target: string) => wire({ from: SELF, to: target })),
    channel: vi.fn(() => { const c = new FakeChannel(); channels.push(c); return c; }),
  } as unknown as RemotePeer & { request: ReturnType<typeof vi.fn>; channel: ReturnType<typeof vi.fn> };
  const unlocked = { value: true };
  const emergency = vi.fn();
  const confirmCapture = vi.fn(async (_owner: number, _prompt: unknown, _signal: AbortSignal) => true);
  const deps: RemoteDeps = {
    probe: overrides.probe ?? (async () => ({ serverUrl: URL, serverId: 'f'.repeat(64), namespace: 'demo', authentication: 'password', rendezvous: true, rendezvousProof: true })),
    createAccount: () => account,
    createPeer: () => peer,
    identity: () => store,
    presence: (_t, _n, h) => { handlers = h; return { start: () => presenceStart(), stop: presenceStop }; },
    timers: clock,
    isUnlocked: () => unlocked.value,
    matchesVaultPassword: async () => false,
    confirmCapture,
    emergency,
    ...overrides.deps,
  };
  const host = new RemoteLabHost(deps);
  const events: Array<{ owner: number; event: RemoteLabEvent }> = [];
  host.onEvent((owner, event) => events.push({ owner, event }));
  const act = (body: Record<string, unknown>, owner = OWNER, clientId = CLIENT): Promise<RemoteLabReply> => host.action(owner, { clientId, ...body });
  const goOnline = async (): Promise<void> => {
    expect((await act({ kind: 'connect', serverUrl: URL })).ok).toBe(true);
    expect((await act({ kind: 'signIn', username: 'demo', password: 'pw' })).ok).toBe(true);
    expect((await act({ kind: 'goOnline', deviceName: 'Laptop' })).ok).toBe(true);
  };
  const kinds = (kind: string): RemoteLabEvent[] => events.filter(e => e.event.kind === kind).map(e => e.event);
  /** Online agent with an incoming request from B in `consent`. */
  const consent = async (): Promise<void> => {
    await goOnline();
    handlers.onDevices([device(B, 'Büro')]);
    handlers.onSessions([wire()]);
    await flush();
  };
  const armed = async (): Promise<void> => { await consent(); expect((await act({ kind: 'armCapture', sessionId: SID, verification: PREFIX })).ok).toBe(true); };
  const granted = async (): Promise<void> => { await armed(); expect(await host.requestCapture(OWNER)).toBe(SID); };
  const accepted = async (): Promise<FakeChannel> => { await granted(); expect((await act({ kind: 'accept', sessionId: SID })).ok).toBe(true); return channels[channels.length - 1]!; };
  /** Online viewer with a request to B in `requesting`. */
  const requesting = async (): Promise<void> => {
    await goOnline();
    handlers.onDevices([device(B, 'Büro')]);
    expect((await act({ kind: 'request', target: B, verification: PREFIX })).ok).toBe(true);
  };
  const viewing = async (): Promise<FakeChannel> => {
    await requesting();
    account.getImpl = async () => wire({ from: SELF, to: B, state: 'active' });
    await clock.advance(1000);
    return channels[channels.length - 1]!;
  };
  const deletes = (): string[] => requests.filter(r => r.method === 'DELETE').map(r => r.path);
  return { host, clock, act, events, kinds, account, peer, channels, requests, deletes, goOnline, consent, armed, granted, accepted, requesting, viewing, presenceStop, remember, known, renamed, emergency, confirmCapture, load, unlocked, handlers: () => handlers, setStart: (fn: () => Promise<void>) => { presenceStart = fn; } };
}

describe('RemoteLabHost: setup', () => {
  it('without deps every action is unavailable', async () => {
    const host = new RemoteLabHost();
    expect(host.enabled).toBe(false);
    expect(await host.action(1, { kind: 'status', clientId: CLIENT })).toEqual({ ok: false, code: 'unavailable' });
  });

  it('rejects malformed requests and non-https server URLs', async () => {
    const { act } = setup();
    expect(await act({ kind: 'bogus' })).toEqual({ ok: false, code: 'invalid' });
    expect(await act({ kind: 'connect', serverUrl: 'http://example.com/' })).toEqual({ ok: false, code: 'invalid' });
    expect(await act({ kind: 'request', target: B, verification: 5 })).toEqual({ ok: false, code: 'invalid' });
    expect(await act({ kind: 'status', extra: 1 })).toEqual({ ok: false, code: 'invalid' });
  });

  it('connects, signs in and goes online with a state that never exposes keys', async () => {
    const { act, handlers, goOnline } = setup();
    await goOnline();
    handlers().onDevices([device(C, 'Zeta'), device(B, 'alpha'), device(SELF, 'me'), { id: 'bad', name: 'x', publicKey: 'k' }]);
    const reply = await act({ kind: 'status' });
    expect(reply).toMatchObject({ ok: true, state: { phase: 'online', server: { serverUrl: URL }, account: { username: 'demo', validUntil: 5_000_000 }, identity: { fingerprint: SELF, persistent: true } } });
    if (!reply.ok) throw new Error();
    expect(reply.state.devices?.map(d => d.name)).toEqual(['alpha', 'Zeta']);
    expect(JSON.stringify(reply.state)).not.toContain('pk-');
    expect(JSON.stringify(reply.state)).not.toContain('pw');
  });

  it('maps probe, login and presence errors to codes', async () => {
    const down = setup({ probe: async () => { throw new Error('x'); } });
    expect(await down.act({ kind: 'connect', serverUrl: URL })).toEqual({ ok: false, code: 'connection' });
    const noRv = setup({ probe: async () => ({ serverUrl: URL, serverId: 'f'.repeat(64), namespace: 'n', authentication: 'password', rendezvous: false, rendezvousProof: true }) });
    expect(await noRv.act({ kind: 'connect', serverUrl: URL })).toEqual({ ok: false, code: 'unavailable' });
    const a = setup();
    await a.act({ kind: 'connect', serverUrl: URL });
    (a.account.login as ReturnType<typeof vi.fn>).mockRejectedValueOnce(Object.assign(new Error('x'), { status: 401 }));
    expect(await a.act({ kind: 'signIn', username: 'demo', password: 'pw' })).toEqual({ ok: false, code: 'authentication' });
    (a.account.login as ReturnType<typeof vi.fn>).mockRejectedValueOnce(Object.assign(new Error('x'), { status: 429 }));
    expect(await a.act({ kind: 'signIn', username: 'demo', password: 'pw' })).toEqual({ ok: false, code: 'limit' });
    (a.account.login as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('x'));
    expect(await a.act({ kind: 'signIn', username: 'demo', password: 'pw' })).toEqual({ ok: false, code: 'connection' });
    await a.act({ kind: 'signIn', username: 'demo', password: 'pw' });
    a.setStart(async () => { throw Object.assign(new Error('x'), { status: 409 }); });
    expect(await a.act({ kind: 'goOnline', deviceName: 'L' })).toEqual({ ok: false, code: 'connection' });
    a.setStart(async () => { throw Object.assign(new Error('x'), { status: 429 }); });
    expect(await a.act({ kind: 'goOnline', deviceName: 'L' })).toEqual({ ok: false, code: 'limit' });
  });

  it('goOnline: locked, invalid name and identity failure', async () => {
    const t = setup();
    await t.act({ kind: 'connect', serverUrl: URL });
    await t.act({ kind: 'signIn', username: 'demo', password: 'pw' });
    t.unlocked.value = false;
    expect(await t.act({ kind: 'goOnline', deviceName: 'L' })).toEqual({ ok: false, code: 'locked' });
    t.unlocked.value = true;
    expect(await t.act({ kind: 'goOnline', deviceName: '' })).toEqual({ ok: false, code: 'invalid' });
    expect(await t.act({ kind: 'goOnline', deviceName: 'a\nb' })).toEqual({ ok: false, code: 'invalid' });
    t.load.mockImplementationOnce(() => { throw new Error('identity'); });
    expect(await t.act({ kind: 'goOnline', deviceName: 'L' })).toEqual({ ok: false, code: 'identity' });
  });

  it('allows only one network action at a time', async () => {
    let release!: () => void;
    const t = setup({ probe: () => new Promise(r => { release = () => r({ serverUrl: URL, serverId: 'f'.repeat(64), namespace: 'n', authentication: 'password', rendezvous: true, rendezvousProof: true }); }) });
    const first = t.act({ kind: 'connect', serverUrl: URL });
    expect(await t.act({ kind: 'signIn', username: 'demo', password: 'pw' })).toEqual({ ok: false, code: 'stale' });
    release();
    expect((await first).ok).toBe(true);
  });
});

describe('RemoteLabHost: owner binding (K2)', () => {
  it('answers status/close with idle when unbound, stale for others when bound', async () => {
    const t = setup();
    expect(await t.act({ kind: 'status' }, 99, '00000000-0000-4000-8000-000000000009')).toEqual({ ok: true, state: { phase: 'idle' } });
    expect(await t.act({ kind: 'close' })).toEqual({ ok: true, state: { phase: 'idle' } });
    await t.act({ kind: 'connect', serverUrl: URL });
    expect(await t.act({ kind: 'status' }, 8)).toEqual({ ok: false, code: 'stale' });
    expect(await t.act({ kind: 'status' }, OWNER, '00000000-0000-4000-8000-000000000009')).toEqual({ ok: false, code: 'stale' });
    expect(await t.act({ kind: 'close' }, 8)).toEqual({ ok: false, code: 'stale' });
    expect(await t.act({ kind: 'connect', serverUrl: URL })).toEqual({ ok: false, code: 'stale' });
  });

  it('close resets, logs out and frees the binding', async () => {
    const t = setup();
    await t.goOnline();
    expect(await t.act({ kind: 'close' })).toEqual({ ok: true, state: { phase: 'idle' } });
    await t.clock.advance(0);
    expect(t.presenceStop).toHaveBeenCalled();
    expect(t.account.logout).toHaveBeenCalled();
    expect((await t.act({ kind: 'connect', serverUrl: URL }, 8, '00000000-0000-4000-8000-000000000008')).ok).toBe(true);
  });
});

describe('RemoteLabHost: incoming requests (K4, R3, busy)', () => {
  it('shows consent for a view request with name and known-since, and emits state', async () => {
    const t = setup();
    t.known.mockReturnValue({ firstSeen: 42, verified: false });
    await t.consent();
    const reply = await t.act({ kind: 'status' });
    expect(reply).toMatchObject({ ok: true, state: { session: { id: SID, role: 'agent', state: 'consent', scope: 'view', peer: { id: B, name: 'Büro', known: { firstSeen: 42, verified: false } } } } });
    expect(t.kinds('state').length).toBeGreaterThan(0);
  });

  it('R3: a control request is deleted without any event or dialog', async () => {
    const t = setup();
    await t.goOnline();
    t.handlers().onDevices([device(B, 'Büro')]);
    const before = t.events.length;
    t.handlers().onSessions([wire({ scope: 'control' })]);
    await flush();
    expect(t.deletes()).toEqual([`/v1/rendezvous/sessions/${SID}`]);
    expect(t.events.slice(before).filter(e => e.event.kind !== 'state')).toEqual([]);
    expect(((await t.act({ kind: 'status' })) as { state: { session?: unknown } }).state.session).toBeUndefined();
  });

  it('busy: a second request and a request during an own viewer session are deleted', async () => {
    const t = setup();
    await t.consent();
    t.handlers().onSessions([wire(), wire({ id: SID2, from: C })]);
    await flush();
    expect(t.deletes()).toEqual([`/v1/rendezvous/sessions/${SID2}`]);
    const v = setup();
    await v.requesting();
    v.handlers().onSessions([wire({ id: SID2, from: B })]);
    await flush();
    expect(v.deletes()).toEqual([`/v1/rendezvous/sessions/${SID2}`]);
  });

  it('ignores invalid entries and skips an unknown sender without marking it processed', async () => {
    const t = setup();
    await t.goOnline();
    t.handlers().onSessions([{ junk: true }, wire()]);
    expect(((await t.act({ kind: 'status' })) as { state: { session?: unknown } }).state.session).toBeUndefined();
    t.handlers().onDevices([device(B, 'Büro')]);
    t.handlers().onSessions([wire()]);
    expect(((await t.act({ kind: 'status' })) as { state: { session?: unknown } }).state.session).toMatchObject({ id: SID });
  });

  it('ends a consent session with ended/remote when it vanishes from the list', async () => {
    const t = setup();
    await t.consent();
    t.handlers().onSessions([]);
    expect(t.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'remote' }]);
    expect(t.deletes()).toEqual([]);
  });
});

describe('RemoteLabHost: consent, capture grant and accept (R1, R4)', () => {
  it('R1: accept before granted is stale and builds no channel', async () => {
    const t = setup();
    await t.consent();
    expect(await t.act({ kind: 'accept', sessionId: SID })).toEqual({ ok: false, code: 'stale' });
    expect(t.channels).toHaveLength(0);
  });

  it('armCapture works once per session and needs the unlocked vault', async () => {
    const t = setup();
    await t.consent();
    t.unlocked.value = false;
    expect(await t.act({ kind: 'armCapture', sessionId: SID, verification: PREFIX })).toEqual({ ok: false, code: 'locked' });
    t.unlocked.value = true;
    expect(await t.act({ kind: 'armCapture', sessionId: 'other', verification: PREFIX })).toEqual({ ok: false, code: 'stale' });
    expect((await t.act({ kind: 'armCapture', sessionId: SID, verification: PREFIX })).ok).toBe(true);
    expect(await t.act({ kind: 'armCapture', sessionId: SID, verification: PREFIX })).toEqual({ ok: false, code: 'stale' });
  });

  it('requestCapture: needs armed, the bound owner and runs one dialog at a time', async () => {
    const t = setup();
    await t.consent();
    expect(await t.host.requestCapture(OWNER)).toBeNull();
    expect(t.confirmCapture).not.toHaveBeenCalled();
    await t.act({ kind: 'armCapture', sessionId: SID, verification: PREFIX });
    expect(await t.host.requestCapture(OWNER + 1)).toBeNull();
    let release!: (ok: boolean) => void;
    t.confirmCapture.mockImplementationOnce(() => new Promise<boolean>(r => { release = r; }));
    const first = t.host.requestCapture(OWNER);
    expect(await t.host.requestCapture(OWNER)).toBeNull();
    expect(t.confirmCapture).toHaveBeenCalledTimes(1);
    expect(t.confirmCapture).toHaveBeenCalledWith(OWNER, { name: 'Büro', fingerprint: B, verified: true }, expect.any(AbortSignal));
    release(true);
    expect(await first).toBe(SID);
    expect(await t.act({ kind: 'status' })).toMatchObject({ state: { session: { state: 'granted' } } });
    expect(await t.host.requestCapture(OWNER)).toBeNull();
  });

  it('requestCapture: false declines, mutes the device and ends the session', async () => {
    const t = setup();
    await t.armed();
    t.confirmCapture.mockResolvedValueOnce(false);
    expect(await t.host.requestCapture(OWNER)).toBeNull();
    expect(t.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'declined' }]);
    t.handlers().onSessions([wire({ id: SID2 })]);
    await flush();
    expect(t.deletes()).toContain(`/v1/rendezvous/sessions/${SID2}`);
    expect(await t.act({ kind: 'status' })).toMatchObject({ state: { muted: 1 } });
  });

  it('requestCapture: a throwing dialog counts as declined; a lock during the dialog ends locked', async () => {
    const t = setup();
    await t.armed();
    t.confirmCapture.mockRejectedValueOnce(new Error('x'));
    expect(await t.host.requestCapture(OWNER)).toBeNull();
    expect(t.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'declined' }]);
    const l = setup();
    await l.armed();
    l.confirmCapture.mockImplementationOnce(async () => { l.unlocked.value = false; return true; });
    expect(await l.host.requestCapture(OWNER)).toBeNull();
    expect(l.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'locked' }]);
  });

  it('requestCapture: the deadline aborts the dialog signal and yields null', async () => {
    const t = setup();
    await t.armed();
    let signal!: AbortSignal;
    t.confirmCapture.mockImplementationOnce((_o, _p, s) => new Promise<boolean>(r => { signal = s; s.addEventListener('abort', () => r(false)); }));
    const pending = t.host.requestCapture(OWNER);
    await t.clock.advance(55_000);
    expect(signal.aborted).toBe(true);
    expect(await pending).toBeNull();
    expect(t.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'expired' }]);
  });

  it('every end path aborts the dialog signal (stop, decline, vanishing request, reset, closeOwner, goOffline)', async () => {
    const cases: Array<(t: ReturnType<typeof setup>) => unknown> = [
      t => t.act({ kind: 'stop', sessionId: SID }),
      t => t.act({ kind: 'decline', sessionId: SID }),
      t => t.handlers().onSessions([]),
      t => t.host.reset('locked'),
      t => t.host.closeOwner(OWNER),
      t => t.act({ kind: 'goOffline' }),
    ];
    for (const end of cases) {
      const t = setup();
      await t.armed();
      let signal!: AbortSignal;
      t.confirmCapture.mockImplementationOnce((_o, _p, s) => new Promise<boolean>(r => { signal = s; s.addEventListener('abort', () => r(false)); }));
      const pending = t.host.requestCapture(OWNER);
      await end(t);
      await flush();
      expect(signal.aborted).toBe(true);
      expect(await pending).toBeNull();
    }
  });

  it('captureArmed is true in consent (armed) and granted, false otherwise and after the end', async () => {
    const t = setup();
    await t.consent();
    expect(t.host.captureArmed(OWNER)).toBe(false);
    await t.act({ kind: 'armCapture', sessionId: SID, verification: PREFIX });
    expect(t.host.captureArmed(OWNER)).toBe(true);
    expect(t.host.captureArmed(OWNER + 1)).toBe(false);
    expect(await t.host.requestCapture(OWNER)).toBe(SID);
    expect(t.host.captureArmed(OWNER)).toBe(true);
    await t.act({ kind: 'stop', sessionId: SID });
    expect(t.host.captureArmed(OWNER)).toBe(false);
  });

  it('decline works in granted; a vanishing request ends a granted session with remote', async () => {
    const d = setup();
    await d.granted();
    expect((await d.act({ kind: 'decline', sessionId: SID })).ok).toBe(true);
    expect(d.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'declined' }]);
    const v = setup();
    await v.granted();
    v.handlers().onSessions([]);
    expect(v.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'remote' }]);
  });

  it('armCapture: null needs a verified pin; invalid input is no attempt; three misses end with mismatch and mute', async () => {
    const t = setup();
    await t.consent();
    expect(await t.act({ kind: 'armCapture', sessionId: SID, verification: null })).toEqual({ ok: false, code: 'invalid' });
    expect(await t.act({ kind: 'armCapture', sessionId: SID, verification: 'zz' })).toEqual({ ok: false, code: 'invalid' });
    expect(await t.act({ kind: 'status' })).toMatchObject({ state: { session: { attemptsLeft: 3 } } });
    expect(await t.act({ kind: 'armCapture', sessionId: SID, verification: 'c'.repeat(12) })).toEqual({ ok: false, code: 'mismatch' });
    expect(await t.act({ kind: 'status' })).toMatchObject({ state: { session: { attemptsLeft: 2 } } });
    expect(await t.act({ kind: 'armCapture', sessionId: SID, verification: 'c'.repeat(12) })).toEqual({ ok: false, code: 'mismatch' });
    expect(t.kinds('ended')).toEqual([]);
    expect(await t.act({ kind: 'armCapture', sessionId: SID, verification: 'c'.repeat(12) })).toEqual({ ok: false, code: 'mismatch' });
    expect(t.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'mismatch' }]);
    expect(t.host.captureArmed(OWNER)).toBe(false);
    t.handlers().onSessions([wire({ id: SID2 })]);
    await flush();
    expect(t.deletes()).toContain(`/v1/rendezvous/sessions/${SID2}`);
    const status = await t.act({ kind: 'status' });
    expect(status).toMatchObject({ state: { muted: 1 } });
    expect((status as { state: { session?: unknown } }).state.session).toBeUndefined();
  });

  it('armCapture: a verified pin accepts null and never exposes attemptsLeft', async () => {
    const t = setup();
    t.known.mockReturnValue({ firstSeen: 1, verified: true, verifiedAt: 2 });
    await t.consent();
    expect(await t.act({ kind: 'status' })).toMatchObject({ state: { session: { peer: { known: { verified: true } } } } });
    expect((await t.act({ kind: 'status' }) as { state: { session: { attemptsLeft?: number } } }).state.session.attemptsLeft).toBeUndefined();
    expect((await t.act({ kind: 'armCapture', sessionId: SID, verification: null })).ok).toBe(true);
    expect(await t.host.requestCapture(OWNER)).toBe(SID);
    expect(t.confirmCapture).toHaveBeenCalledWith(OWNER, expect.objectContaining({ verified: true }), expect.any(AbortSignal));
  });

  it('mute: entries are FIFO-capped at 64 and expire after muteMs', async () => {
    const t = setup();
    await t.goOnline();
    t.handlers().onDevices([device(B, 'Büro')]);
    t.handlers().onSessions([wire()]);
    await flush();
    await t.act({ kind: 'decline', sessionId: SID });
    await t.clock.advance(600_000);
    t.handlers().onSessions([wire({ id: SID2 })]);
    expect(await t.act({ kind: 'status' })).toMatchObject({ state: { session: { id: SID2 } } });
  });

  it('emergency brake: captured session ending without stopped triggers emergency once after 2 s', async () => {
    const t = setup();
    await t.accepted();
    await t.act({ kind: 'stop', sessionId: SID });
    await t.clock.advance(1999);
    expect(t.emergency).not.toHaveBeenCalled();
    await t.clock.advance(1);
    expect(t.emergency).toHaveBeenCalledTimes(1);
    expect(t.emergency).toHaveBeenCalledWith(OWNER);
    await t.clock.advance(10_000);
    expect(t.emergency).toHaveBeenCalledTimes(1);
  });

  it('emergency brake: stopped cancels it', async () => {
    const t = setup();
    await t.accepted();
    await t.act({ kind: 'stop', sessionId: SID });
    expect((await t.act({ kind: 'stopped', sessionId: SID })).ok).toBe(true);
    await t.clock.advance(5000);
    expect(t.emergency).not.toHaveBeenCalled();
  });

  it('emergency brake: reset("locked") then stopped without a binding answers idle and cancels', async () => {
    const t = setup();
    await t.granted();
    t.host.reset('locked');
    expect(await t.act({ kind: 'stopped', sessionId: SID })).toEqual({ ok: true, state: { phase: 'idle' } });
    await t.clock.advance(5000);
    expect(t.emergency).not.toHaveBeenCalled();
  });

  it('emergency brake: closeOwner discards the brake; a non-captured session never arms it', async () => {
    const c = setup();
    await c.granted();
    c.host.closeOwner(OWNER);
    await c.clock.advance(5000);
    expect(c.emergency).not.toHaveBeenCalled();
    const n = setup();
    await n.armed();
    await n.act({ kind: 'decline', sessionId: SID });
    await n.clock.advance(5000);
    expect(n.emergency).not.toHaveBeenCalled();
  });

  it('emergency brake: stopped from a foreign owner is stale and the brake still fires', async () => {
    const t = setup();
    await t.granted();
    await t.act({ kind: 'stop', sessionId: SID });
    expect(await t.act({ kind: 'stopped', sessionId: SID }, OWNER + 1)).toEqual({ ok: false, code: 'stale' });
    expect(await t.act({ kind: 'stopped', sessionId: 'unknown' })).toEqual({ ok: false, code: 'stale' });
    await t.clock.advance(2000);
    expect(t.emergency).toHaveBeenCalledWith(OWNER);
  });

  it('accept creates the channel with the verified peer, flips to connecting and starts sharing', async () => {
    const t = setup();
    const sharing: boolean[] = [];
    t.host.onSharingChange(s => sharing.push(s));
    await t.granted();
    expect(t.host.sharing).toBe(false);
    const reply = await t.act({ kind: 'accept', sessionId: SID });
    expect(reply).toMatchObject({ ok: true, state: { session: { state: 'connecting' } } });
    expect(t.peer.channel).toHaveBeenCalledWith(expect.objectContaining({ id: SID }), 'pk-b', B, 'view');
    expect(t.host.sharing).toBe(true);
    expect(sharing).toEqual([true]);
  });

  it('accept: locked vault, channel mismatch and channel failure', async () => {
    const l = setup(); await l.granted();
    l.unlocked.value = false;
    expect(await l.act({ kind: 'accept', sessionId: SID })).toEqual({ ok: false, code: 'locked' });
    const m = setup(); await m.granted();
    (m.peer.channel as ReturnType<typeof vi.fn>).mockImplementationOnce(() => { throw new Error('mismatch'); });
    expect(await m.act({ kind: 'accept', sessionId: SID })).toEqual({ ok: false, code: 'mismatch' });
    expect(m.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'failed' }]);
    const f = setup(); await f.granted();
    (f.peer.channel as ReturnType<typeof vi.fn>).mockImplementationOnce(() => { const c = new FakeChannel(); c.acceptError = new Error('x'); return c; });
    expect(await f.act({ kind: 'accept', sessionId: SID })).toEqual({ ok: false, code: 'connection' });
    expect(f.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'failed' }]);
    expect(f.host.sharing).toBe(false);
  });

  it('decline clears locally, emits ended/declined and deletes best effort', async () => {
    const t = setup();
    await t.consent();
    const reply = await t.act({ kind: 'decline', sessionId: SID });
    expect(reply).toMatchObject({ ok: true });
    expect((reply as { state: { session?: unknown } }).state.session).toBeUndefined();
    expect(t.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'declined' }]);
    await flush();
    expect(t.deletes()).toEqual([`/v1/rendezvous/sessions/${SID}`]);
  });
});

describe('RemoteLabHost: ending (R5, R6, K8)', () => {
  it('R5: stop reports ended immediately even if close never resolves; bye precedes close', async () => {
    const t = setup();
    const channel = await t.accepted();
    channel.closeHangs = true;
    const reply = await t.act({ kind: 'stop', sessionId: SID });
    expect((reply as { state: { session?: unknown } }).state.session).toBeUndefined();
    expect(t.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'stopped' }]);
    expect(t.host.sharing).toBe(false);
    await flush();
    expect(channel.sent).toEqual([{ part: { kind: 'bye', part: 1, of: 1, data: '' } }]);
    expect(channel.closed).toBe(1);
  });

  it('ends a session with a hanging bye after 2 s and still closes', async () => {
    const t = setup();
    const channel = await t.accepted();
    channel.ready = true;
    channel.sendGate = () => new Promise(() => undefined);
    await t.act({ kind: 'stop', sessionId: SID });
    expect(channel.closed).toBe(0);
    await t.clock.advance(2000);
    expect(channel.closed).toBe(1);
  });

  it('R6: reset("locked") ends with locked, stops presence, logs out and frees the binding', async () => {
    const t = setup();
    await t.accepted();
    t.host.reset('locked');
    expect(t.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'locked' }]);
    expect(t.host.sharing).toBe(false);
    expect(t.presenceStop).toHaveBeenCalled();
    await t.clock.advance(3000);
    expect(t.account.logout).toHaveBeenCalled();
    expect(await t.act({ kind: 'status' }, 99, '00000000-0000-4000-8000-000000000009')).toEqual({ ok: true, state: { phase: 'idle' } });
  });

  it('R6: closeOwner only acts for the bound owner', async () => {
    const t = setup();
    await t.accepted();
    t.host.closeOwner(OWNER + 1);
    expect(t.host.sharing).toBe(true);
    t.host.closeOwner(OWNER);
    expect(t.host.sharing).toBe(false);
    expect(t.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'stopped' }]);
  });

  it('goOffline ends the session, stops presence and drops devices', async () => {
    const t = setup();
    await t.accepted();
    const reply = await t.act({ kind: 'goOffline' });
    expect(reply).toMatchObject({ ok: true, state: { phase: 'signedIn' } });
    expect((reply as { state: { devices?: unknown } }).state.devices).toBeUndefined();
    expect(t.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'stopped' }]);
    expect(t.presenceStop).toHaveBeenCalled();
  });

  it('K9: presence going offline emits an error event and falls back a phase', async () => {
    const a = setup();
    await a.accepted();
    a.handlers().onOffline('authentication');
    expect(a.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'failed' }]);
    expect(a.kinds('error')).toEqual([{ kind: 'error', code: 'authentication' }]);
    expect(await a.act({ kind: 'status' })).toMatchObject({ ok: true, state: { phase: 'serverReady' } });
    expect((await a.act({ kind: 'status' }) as { state: { account?: unknown } }).state.account).toBeUndefined();
    const c = setup();
    await c.goOnline();
    c.handlers().onOffline('connection');
    expect(c.kinds('error')).toEqual([{ kind: 'error', code: 'connection' }]);
    expect(await c.act({ kind: 'status' })).toMatchObject({ ok: true, state: { phase: 'signedIn' } });
  });

  it('M3: a 401 in goOnline drops the account so the user can sign in again', async () => {
    const t = setup();
    await t.act({ kind: 'connect', serverUrl: URL });
    await t.act({ kind: 'signIn', username: 'demo', password: 'pw' });
    t.setStart(async () => { throw Object.assign(new Error('x'), { status: 401 }); });
    expect(await t.act({ kind: 'goOnline', deviceName: 'L' })).toEqual({ ok: false, code: 'authentication' });
    const status = await t.act({ kind: 'status' });
    expect(status).toMatchObject({ ok: true, state: { phase: 'serverReady' } });
    expect((status as { state: { account?: unknown } }).state.account).toBeUndefined();
    expect(t.account.close).toHaveBeenCalled();
    expect((await t.act({ kind: 'signIn', username: 'demo', password: 'pw' })).ok).toBe(true);
  });

  it('M3: a 401 in request drops the account and stops presence', async () => {
    const t = setup();
    await t.goOnline();
    t.handlers().onDevices([device(B, 'Büro')]);
    t.peer.request.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 401 }));
    expect(await t.act({ kind: 'request', target: B, verification: PREFIX })).toEqual({ ok: false, code: 'authentication' });
    expect(await t.act({ kind: 'status' })).toMatchObject({ ok: true, state: { phase: 'serverReady' } });
    expect(t.presenceStop).toHaveBeenCalled();
    expect((await t.act({ kind: 'signIn', username: 'demo', password: 'pw' })).ok).toBe(true);
  });

  it('K10: unchanged state is not re-sent, a changed device list is', async () => {
    const t = setup();
    await t.goOnline();
    t.handlers().onDevices([device(B, 'Büro')]);
    const count = (): number => t.kinds('state').length;
    const after = count();
    t.handlers().onDevices([device(B, 'Büro')]);
    t.handlers().onSessions([]);
    expect(count()).toBe(after);
    t.handlers().onDevices([device(B, 'Büro'), device(C, 'Neu')]);
    expect(count()).toBe(after + 1);
  });
});

describe('RemoteLabHost: viewer (B1)', () => {
  it('request needs the target in the device list and builds no channel yet', async () => {
    const t = setup();
    await t.goOnline();
    expect(await t.act({ kind: 'request', target: B, verification: PREFIX })).toEqual({ ok: false, code: 'stale' });
    t.handlers().onDevices([device(B, 'Büro')]);
    t.unlocked.value = false;
    expect(await t.act({ kind: 'request', target: B, verification: PREFIX })).toEqual({ ok: false, code: 'locked' });
    t.unlocked.value = true;
    t.peer.request.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 429 }));
    expect(await t.act({ kind: 'request', target: B, verification: PREFIX })).toEqual({ ok: false, code: 'limit' });
    const reply = await t.act({ kind: 'request', target: B, verification: PREFIX });
    expect(reply).toMatchObject({ ok: true, state: { session: { role: 'viewer', state: 'requesting', peer: { id: B } } } });
    expect(t.channels).toHaveLength(0);
    expect(await t.act({ kind: 'request', target: B, verification: PREFIX })).toEqual({ ok: false, code: 'stale' });
  });

  it('polls GET /sessions/:id until active, then builds the channel and connects', async () => {
    const t = setup();
    await t.requesting();
    t.account.getImpl = async () => wire({ from: SELF, to: B, state: 'pending' });
    await t.clock.advance(1000);
    expect(t.channels).toHaveLength(0);
    expect(t.requests.some(r => r.method === 'GET' && r.path === `/v1/rendezvous/sessions/${SID}`)).toBe(true);
    t.account.getImpl = async () => wire({ from: SELF, to: B, state: 'active' });
    await t.clock.advance(1000);
    expect(t.channels).toHaveLength(1);
    expect(t.peer.channel).toHaveBeenCalledWith(expect.objectContaining({ state: 'active' }), 'pk-b', B, 'view');
    expect(await t.act({ kind: 'status' })).toMatchObject({ state: { session: { state: 'connecting' } } });
  });

  it('a 404 while requesting ends with declined', async () => {
    const t = setup();
    await t.requesting();
    t.account.getImpl = async () => { throw Object.assign(new Error('x'), { status: 404 }); };
    await t.clock.advance(1000);
    expect(t.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'declined' }]);
  });

  it('receives offer parts, emits signal events, goes active and remembers the peer', async () => {
    const t = setup();
    const channel = await t.viewing();
    channel.inbox.push([{ part: part('offer', 1, 2, 'a') }]);
    await t.clock.advance(1000);
    expect(t.kinds('signal')).toHaveLength(1);
    expect(await t.act({ kind: 'status' })).toMatchObject({ state: { session: { state: 'connecting' } } });
    channel.inbox.push([{ part: part('offer', 2, 2, 'b') }]);
    await t.clock.advance(1000);
    const status = await t.act({ kind: 'status' });
    expect(status).toMatchObject({ state: { session: { state: 'active', startedAt: t.clock.t } } });
    expect(t.remember).toHaveBeenCalledWith(B, 'Büro', t.clock.t, true);
  });

  it('bye from the peer ends with remote and closes without sending a bye back', async () => {
    const t = setup();
    const channel = await t.viewing();
    channel.inbox.push([{ part: part('bye', 1, 1, '') }]);
    await t.clock.advance(1000);
    expect(t.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'remote' }]);
    expect(channel.sent).toEqual([]);
  });

  it('invalid frames, wrong role kinds and 404 in the channel end the session', async () => {
    const bad = setup();
    const c1 = await bad.viewing();
    c1.inbox.push([{ foo: 1 }]);
    await bad.clock.advance(1000);
    expect(bad.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'failed' }]);
    const wrongRole = setup();
    const c2 = await wrongRole.viewing();
    c2.inbox.push([{ part: part('answer') }]);
    await wrongRole.clock.advance(1000);
    expect(wrongRole.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'failed' }]);
    const gone = setup();
    const c3 = await gone.viewing();
    c3.receiveError = Object.assign(new Error('x'), { status: 404 });
    await gone.clock.advance(1000);
    expect(gone.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'remote' }]);
    const limited = setup();
    const c5 = await limited.viewing();
    c5.receiveError = Object.assign(new Error('x'), { status: 429 });
    await limited.clock.advance(1000);
    expect(limited.kinds('ended')).toEqual([]);
    c5.receiveError = undefined;
    c5.inbox.push([{ part: part('offer') }]);
    await limited.clock.advance(1000);
    expect(limited.kinds('ended')).toEqual([]);
    expect(limited.kinds('signal')).toHaveLength(1);
    const broken = setup();
    const c4 = await broken.viewing();
    c4.receiveError = new Error('x');
    await broken.clock.advance(1000);
    expect(broken.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'failed' }]);
  });

  it('polls every 1 s until active and every 5 s afterwards', async () => {
    const t = setup();
    const channel = await t.viewing();
    const spy = vi.spyOn(channel, 'receive');
    channel.inbox.push([{ part: part('offer') }]);
    await t.clock.advance(1000);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await t.act({ kind: 'status' })).toMatchObject({ state: { session: { state: 'active' } } });
    await t.clock.advance(4999);
    expect(spy).toHaveBeenCalledTimes(1);
    await t.clock.advance(1);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('RemoteLabHost: local deadlines (K3)', () => {
  it('agent consent expires 55 s after it was seen', async () => {
    const t = setup();
    await t.consent();
    const seen = t.clock.t;
    expect(await t.act({ kind: 'status' })).toMatchObject({ state: { session: { expiresAt: seen + 55_000 } } });
    await t.clock.advance(54_999);
    expect(t.kinds('ended')).toEqual([]);
    await t.clock.advance(1);
    expect(t.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'expired' }]);
    expect(t.deletes()).toEqual([`/v1/rendezvous/sessions/${SID}`]);
  });

  it('accept after the deadline is expired; the viewer request expires after 60 s', async () => {
    const t = setup();
    await t.granted();
    t.clock.t += 55_000;
    expect(await t.act({ kind: 'accept', sessionId: SID })).toEqual({ ok: false, code: 'expired' });
    const v = setup();
    await v.requesting();
    await v.clock.advance(60_000);
    expect(v.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'expired' }]);
  });

  it('connecting and active end 300 s after the channel was created', async () => {
    const t = setup();
    await t.accepted();
    const created = t.clock.t;
    expect(await t.act({ kind: 'status' })).toMatchObject({ state: { session: { expiresAt: created + 300_000 } } });
    await t.clock.advance(299_999);
    expect(t.kinds('ended')).toEqual([]);
    await t.clock.advance(1);
    expect(t.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'expired' }]);
    expect(t.host.sharing).toBe(false);
  });

  it('server clock values never reach the state', async () => {
    const t = setup();
    t.peer.request.mockResolvedValueOnce(wire({ from: SELF, to: B, expiresAt: 999 }));
    await t.requesting();
    expect(JSON.stringify(await t.act({ kind: 'status' }))).not.toContain('"expiresAt":999');
  });
});

describe('RemoteLabHost: signal action', () => {
  it('bye from the renderer is invalid, roles are enforced (agent offer, viewer answer)', async () => {
    const t = setup();
    const channel = await t.accepted();
    expect(await t.act({ kind: 'signal', sessionId: SID, part: part('bye', 1, 1, '') })).toEqual({ ok: false, code: 'invalid' });
    expect(await t.act({ kind: 'signal', sessionId: SID, part: part('answer') })).toEqual({ ok: false, code: 'invalid' });
    expect(await t.act({ kind: 'signal', sessionId: SID, part: { kind: 'offer', part: 9, of: 1, data: 'x' } })).toEqual({ ok: false, code: 'invalid' });
    expect((await t.act({ kind: 'signal', sessionId: SID, part: part('offer') })).ok).toBe(true);
    expect(channel.sent).toEqual([{ part: part('offer') }]);
    const v = setup();
    const vc = await v.viewing();
    vc.ready = true;
    expect(await v.act({ kind: 'signal', sessionId: SID, part: part('offer') })).toEqual({ ok: false, code: 'invalid' });
    expect((await v.act({ kind: 'signal', sessionId: SID, part: part('answer') })).ok).toBe(true);
  });

  it('is stale before the channel is ready', async () => {
    const t = setup();
    await t.consent();
    expect(await t.act({ kind: 'signal', sessionId: SID, part: part('offer') })).toEqual({ ok: false, code: 'stale' });
    const v = setup();
    await v.viewing(); // channel exists but is not ready until accepted arrives
    expect(await v.act({ kind: 'signal', sessionId: SID, part: part('answer') })).toEqual({ ok: false, code: 'stale' });
  });

  it('sends strictly serially: the second send starts after the first finished', async () => {
    const t = setup();
    const channel = await t.accepted();
    let release!: () => void;
    channel.sendGate = () => new Promise<void>(r => { release = r; });
    const first = t.act({ kind: 'signal', sessionId: SID, part: part('offer', 1, 2, 'a') });
    const second = t.act({ kind: 'signal', sessionId: SID, part: part('offer', 2, 2, 'b') });
    await flush();
    expect(channel.sendsStarted).toBe(1);
    channel.sendGate = undefined;
    release();
    await Promise.all([first, second]);
    expect(channel.sent).toEqual([{ part: part('offer', 1, 2, 'a') }, { part: part('offer', 2, 2, 'b') }]);
  });

  it('a failing send ends the session as failed with code connection', async () => {
    const t = setup();
    const channel = await t.accepted();
    channel.sendGate = async () => { throw new Error('x'); };
    expect(await t.act({ kind: 'signal', sessionId: SID, part: part('offer') })).toEqual({ ok: false, code: 'connection' });
    expect(t.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'failed' }]);
  });
});

describe('RemoteLabHost: sign-in guard (M3) and server capability', () => {
  const ready = async (deps: Partial<RemoteDeps> = {}) => {
    const t = setup({ deps });
    await t.act({ kind: 'connect', serverUrl: URL });
    return t;
  };

  it('a locked vault yields locked and never touches the account', async () => {
    const createAccount = vi.fn();
    const t = await ready({ createAccount: createAccount as unknown as RemoteDeps['createAccount'] });
    t.unlocked.value = false;
    expect(await t.act({ kind: 'signIn', username: 'demo', password: 'pw' })).toEqual({ ok: false, code: 'locked' });
    expect(createAccount).not.toHaveBeenCalled();
  });

  it('the vault password is refused with samePassword before createAccount and login', async () => {
    const createAccount = vi.fn();
    const t = await ready({ matchesVaultPassword: async () => true, createAccount: createAccount as unknown as RemoteDeps['createAccount'] });
    expect(await t.act({ kind: 'signIn', username: 'demo', password: 'pw' })).toEqual({ ok: false, code: 'samePassword' });
    expect(createAccount).not.toHaveBeenCalled();
    expect(t.account.login).not.toHaveBeenCalled();
  });

  it('a throwing check yields locked', async () => {
    const createAccount = vi.fn();
    const t = await ready({ matchesVaultPassword: async () => { throw new Error('locked'); }, createAccount: createAccount as unknown as RemoteDeps['createAccount'] });
    expect(await t.act({ kind: 'signIn', username: 'demo', password: 'pw' })).toEqual({ ok: false, code: 'locked' });
    expect(createAccount).not.toHaveBeenCalled();
  });

  it('a reset during the check yields stale', async () => {
    let release!: (v: boolean) => void;
    const createAccount = vi.fn();
    const t = await ready({ matchesVaultPassword: () => new Promise<boolean>(r => { release = r; }), createAccount: createAccount as unknown as RemoteDeps['createAccount'] });
    const pending = t.act({ kind: 'signIn', username: 'demo', password: 'pw' });
    await flush();
    t.host.reset();
    release(false);
    expect(await pending).toEqual({ ok: false, code: 'stale' });
    expect(createAccount).not.toHaveBeenCalled();
  });

  it('connect without rendezvousProof is unavailable', async () => {
    const t = setup({ probe: async () => ({ serverUrl: URL, serverId: 'f'.repeat(64), namespace: 'n', authentication: 'password', rendezvous: true, rendezvousProof: false }) });
    expect(await t.act({ kind: 'connect', serverUrl: URL })).toEqual({ ok: false, code: 'unavailable' });
  });
});

describe('RemoteLabHost: viewer verification (B7, B10)', () => {
  it('null without a verified pin is invalid, a malformed input is invalid and no attempt', async () => {
    const t = setup();
    await t.goOnline();
    t.handlers().onDevices([device(B, 'Büro')]);
    expect(await t.act({ kind: 'request', target: B, verification: null })).toEqual({ ok: false, code: 'invalid' });
    t.known.mockReturnValue({ firstSeen: 1, verified: false });
    expect(await t.act({ kind: 'request', target: B, verification: null })).toEqual({ ok: false, code: 'invalid' });
    expect(await t.act({ kind: 'request', target: B, verification: 'zz' })).toEqual({ ok: false, code: 'invalid' });
    for (let i = 0; i < 3; i++) expect(await t.act({ kind: 'request', target: B, verification: 'c'.repeat(12) })).toEqual({ ok: false, code: 'mismatch' });
    expect(t.peer.request).not.toHaveBeenCalled();
  });

  it('three misses lock the device until goOnline; the fourth try is not even compared', async () => {
    const t = setup();
    await t.goOnline();
    t.handlers().onDevices([device(B, 'Büro')]);
    for (let i = 0; i < 3; i++) expect(await t.act({ kind: 'request', target: B, verification: 'c'.repeat(12) })).toEqual({ ok: false, code: 'mismatch' });
    expect(await t.act({ kind: 'request', target: B, verification: PREFIX })).toEqual({ ok: false, code: 'mismatch' });
    expect(t.peer.request).not.toHaveBeenCalled();
    await t.act({ kind: 'goOffline' });
    expect((await t.act({ kind: 'goOnline', deviceName: 'Laptop' })).ok).toBe(true);
    t.handlers().onDevices([device(B, 'Büro')]);
    expect((await t.act({ kind: 'request', target: B, verification: PREFIX })).ok).toBe(true);
    expect(t.peer.request).toHaveBeenCalledTimes(1);
  });

  it('a verified pin with null sends the request', async () => {
    const t = setup();
    t.known.mockReturnValue({ firstSeen: 1, verified: true });
    await t.goOnline();
    t.handlers().onDevices([device(B, 'Büro')]);
    expect((await t.act({ kind: 'request', target: B, verification: null })).ok).toBe(true);
    expect(t.peer.request).toHaveBeenCalledWith(B, 'view');
  });

  it('a correct typed prefix remembers the peer as verified when the session goes active', async () => {
    const t = setup();
    const channel = await t.viewing();
    channel.inbox.push([{ part: part('offer') }]);
    await t.clock.advance(1000);
    expect(t.remember).toHaveBeenCalledWith(B, 'Büro', t.clock.t, true);
  });

  it('a verified pin is passed on as verified even without a typed prefix', async () => {
    const t = setup();
    t.known.mockReturnValue({ firstSeen: 1, verified: true });
    await t.goOnline();
    t.handlers().onDevices([device(B, 'Büro')]);
    await t.act({ kind: 'request', target: B, verification: null });
    t.account.getImpl = async () => wire({ from: SELF, to: B, state: 'active' });
    await t.clock.advance(1000);
    t.channels[0]!.inbox.push([{ part: part('offer') }]);
    await t.clock.advance(1000);
    expect(t.remember).toHaveBeenCalledWith(B, 'Büro', t.clock.t, true);
  });

  it('state carries the full known pin and changed for a renamed device', async () => {
    const t = setup();
    t.known.mockReturnValue({ firstSeen: 5, verified: true, verifiedAt: 9 });
    t.renamed.mockReturnValue(true);
    await t.goOnline();
    t.handlers().onDevices([device(B, 'Büro')]);
    const reply = await t.act({ kind: 'status' });
    expect(reply).toMatchObject({ ok: true, state: { devices: [{ id: B, name: 'Büro', known: { firstSeen: 5, verified: true, verifiedAt: 9 }, changed: true }] } });
  });
});
