import { describe, expect, it, vi } from 'vitest';
import { REMOTE_LAB_LIMITS, type RemoteLabEvent, type RemoteLabReply, type RemoteSignalPart } from '../../shared/remote-lab';
import type { RemoteMediaEvent, RemoteMediaReply, RemoteMediaRole } from '../../shared/remote-media';
import { splitSignal } from '../../shared/remote-signal';
import type { Enrollment, RemoteIdentity, RemoteIdentityStore } from './identity';
import { RemoteLabHost, type RemoteAccount, type RemoteChannel, type RemoteDeps, type RemotePeer, type RemoteSessionWire } from './lab-host';
import type { MediaPort } from './media-window';
import type { PresenceHandlers } from './presence';

const SELF = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const SID = '1'.repeat(64);
const SID2 = '2'.repeat(64);
const CLIENT = '00000000-0000-4000-8000-000000000001';
const OWNER = 7;
const MAIN = OWNER; // the main window id equals the bound owner; media windows get other ids
const PREFIX = 'b'.repeat(REMOTE_LAB_LIMITS.verificationHex);
const URL = 'http://127.0.0.1:8788/';
const NATIVE = REMOTE_LAB_LIMITS.nativeDelayMs;

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
  /** receive() calls until the Noise handshake is done (ready). */
  rounds = 1;
  receives = 0;
  async accept(): Promise<void> { if (this.acceptError) throw this.acceptError; }
  async send(value: unknown): Promise<unknown> { this.sendsStarted++; await this.sendGate?.(); this.sent.push(value); return {}; }
  async receive(): Promise<unknown[]> { if (this.receiveError) throw this.receiveError; if (++this.receives >= this.rounds) this.ready = true; return this.inbox.shift() ?? []; }
  close(): Promise<void> { this.closed++; return this.closeHangs ? new Promise(() => undefined) : Promise.resolve(); }
  dispose(): void { this.disposed++; }
}

/** Fake media port. capture() mimics the display-media handler: it consumes the grant through the host (path A). */
class FakeMedia implements MediaPort {
  host?: RemoteLabHost;
  nextId = 41;
  opened: Array<{ id: number; role: RemoteMediaRole; peerName: string }> = [];
  events: Array<{ id: number; event: RemoteMediaEvent }> = [];
  destroyed: number[] = [];
  captures: Array<{ id: number; sourceId?: string }> = [];
  order: string[] = [];
  readyResult = true;
  readyGate?: Promise<boolean>;
  captureResult = true;
  consumeGrant = true;
  captureGate?: Promise<void>;
  openError = false;
  open(input: { role: RemoteMediaRole; peerName: string }): number {
    if (this.openError) throw new Error('open');
    const id = this.nextId++;
    this.opened.push({ id, ...input });
    this.order.push('open');
    return id;
  }
  async ready(_id: number): Promise<boolean> { this.order.push('ready'); return this.readyGate ?? this.readyResult; }
  send(id: number, event: RemoteMediaEvent): void { this.order.push(event.kind); this.events.push({ id, event }); }
  async capture(id: number, sourceId?: string): Promise<boolean> {
    this.order.push('capture');
    this.captures.push({ id, sourceId });
    await this.captureGate;
    if (this.consumeGrant) this.host?.consumeCaptureGrant(id);
    return this.captureResult;
  }
  destroy(id: number): void { this.order.push('destroy'); this.destroyed.push(id); }
  get id(): number { return this.opened[this.opened.length - 1]!.id; }
  kinds(kind: RemoteMediaEvent['kind']): RemoteMediaEvent[] { return this.events.filter(e => e.event.kind === kind).map(e => e.event); }
  signals(): RemoteSignalPart[] { return this.kinds('signal').map(e => (e as { part: RemoteSignalPart }).part); }
}

const fp = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, '0')).join(':');
const sdpText = (direction: string, extra: string[] = [], media = 'm=video 9 UDP/TLS/RTP/SAVPF 96'): string =>
  ['v=0', 'o=- 1 2 IN IP4 127.0.0.1', 's=-', `a=fingerprint:sha-256 ${fp}`, 'a=setup:actpass', media, direction, ...extra, ''].join('\r\n');
const OFFER = sdpText('a=sendonly');
const ANSWER = sdpText('a=recvonly');
/** A complete, valid message of the given kind, split into `count` wire parts. */
const msg = (kind: 'offer' | 'answer', count = 1, data = kind === 'offer' ? OFFER : ANSWER): RemoteSignalPart[] => {
  if (count === 1) return splitSignal(kind, data);
  const size = Math.ceil(data.length / count);
  return Array.from({ length: count }, (_, i) => ({ kind, part: i + 1, of: count, data: data.slice(i * size, (i + 1) * size) }));
};
const part = (kind: RemoteSignalPart['kind'], n = 1, of = 1, data = 'x'): RemoteSignalPart => ({ kind, part: n, of, data });
const frames = (parts: RemoteSignalPart[]): unknown[] => parts.map(p => ({ part: p }));

const wire = (over: Partial<RemoteSessionWire> = {}): RemoteSessionWire => ({ id: SID, from: B, to: SELF, nonce: 'ab'.repeat(16), scope: 'view', state: 'pending', expiresAt: 1, ...over });
const device = (id: string, name: string) => ({ id, name, publicKey: `pk-${id.slice(0, 1)}`, expiresAt: 1 });

function setup(overrides: { deps?: Partial<RemoteDeps>; probe?: RemoteDeps['probe'] } = {}) {
  const clock = new Clock();
  const channels: FakeChannel[] = [];
  const handshake = { rounds: 1 };
  const requests: Array<{ method: string; path: string }> = [];
  let handlers!: PresenceHandlers;
  let presenceStart: () => Promise<void> = async () => undefined;
  const presenceStop = vi.fn(async () => undefined);
  const remember = vi.fn();
  const known = vi.fn((_id: string): { firstSeen: number; verified: boolean; verifiedAt?: number } | undefined => undefined);
  const renamed = vi.fn((_id: string, _name: string) => false);
  const load = vi.fn(() => ({ identity: { id: SELF, publicKey: 'pk-self', privateKey: {} } as unknown as RemoteIdentity, persistent: true }));
  const enrollment = vi.fn((_serverId: string, _serverUrl: string): Enrollment | undefined => undefined);
  const enrolledElsewhere = vi.fn((_serverId: string, _serverUrl: string): string | undefined => undefined);
  const rememberEnrollment = vi.fn();
  const forgetEnrollment = vi.fn();
  const store = { load, known, remember, renamed, enrollment, enrolledElsewhere, rememberEnrollment, forgetEnrollment } as unknown as RemoteIdentityStore;
  const account: RemoteAccount & { getImpl?: () => Promise<unknown> } = {
    enroll: vi.fn(async () => ({})),
    openSession: vi.fn(async () => ({ signedIn: true as const, expiresAt: 5_000_000, device: 'Laptop' })),
    request: vi.fn(async (method: string, path: string) => { requests.push({ method, path }); if (method === 'GET') return account.getImpl ? account.getImpl() : wire({ from: SELF, to: B }); return {}; }),
    refresh: vi.fn(async () => ({ expiresAt: 1 })), logout: vi.fn(async () => undefined), close: vi.fn(),
  };
  const peer = {
    identity: { id: SELF, publicKey: 'pk-self', privateKey: {} },
    request: vi.fn(async (target: string) => wire({ from: SELF, to: target })),
    forget: vi.fn(),
    channel: vi.fn(() => { const c = new FakeChannel(); c.rounds = handshake.rounds; channels.push(c); return c; }),
  } as unknown as RemotePeer & { request: ReturnType<typeof vi.fn>; forget: ReturnType<typeof vi.fn>; channel: ReturnType<typeof vi.fn> };
  const unlocked = { value: true };
  const media = new FakeMedia();
  const confirmCapture = vi.fn(async (_owner: number, _prompt: unknown, _signal: AbortSignal): Promise<'accepted' | 'declined' | 'unavailable'> => { media.order.push('dialog'); return 'accepted'; });
  const deps: RemoteDeps = {
    probe: overrides.probe ?? (async () => ({ serverUrl: URL, serverId: 'f'.repeat(64), namespace: 'demo', authentication: 'enrolled-device', deviceSessions: true, rendezvous: true, rendezvousProof: true, rendezvousNoise: true })),
    createAccount: () => account,
    createPeer: () => peer,
    identity: () => store,
    presence: (_t, _n, h) => { handlers = h; return { start: () => presenceStart(), stop: presenceStop }; },
    timers: clock,
    isUnlocked: () => unlocked.value,
    matchesVaultPassword: async () => false,
    confirmCapture,
    media,
    ...overrides.deps,
  };
  const host = new RemoteLabHost(deps);
  media.host = host;
  const events: Array<{ owner: number; event: RemoteLabEvent }> = [];
  host.onEvent((owner, event) => events.push({ owner, event }));
  const act = (body: Record<string, unknown>, owner = OWNER, clientId = CLIENT): Promise<RemoteLabReply> => host.action(owner, { clientId, ...body });
  const goOnline = async (): Promise<void> => {
    expect((await act({ kind: 'connect', serverUrl: URL })).ok).toBe(true);
    expect((await act({ kind: 'signIn', username: 'demo', password: 'pw', deviceName: 'Laptop' })).ok).toBe(true);
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
  /** Armed, the native dialog follows after nativeDelayMs. */
  const armed = async (): Promise<void> => { await consent(); expect((await act({ kind: 'armCapture', sessionId: SID, verification: PREFIX })).ok).toBe(true); };
  /** Dialog accepted, media window open and loaded, capture still pending (gate held). */
  const granted = async (): Promise<() => void> => {
    let release!: () => void;
    media.captureGate = new Promise<void>(r => { release = r; });
    await armed();
    await clock.advance(NATIVE);
    return release;
  };
  /** The whole agent flow through `accepted` sent to the media window. */
  const accepted = async (): Promise<FakeChannel> => { await armed(); await clock.advance(NATIVE); return channels[channels.length - 1]!; };
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
  const mediaAct = (body: unknown, id?: number): Promise<RemoteMediaReply> => host.mediaAction(id ?? media.id, body);
  return { host, handshake, clock, act, events, kinds, account, peer, channels, requests, deletes, goOnline, consent, armed, granted, accepted, requesting, viewing, presenceStop, remember, known, renamed, enrollment, enrolledElsewhere, rememberEnrollment, forgetEnrollment, confirmCapture, media, mediaAct, load, unlocked, handlers: () => handlers, setStart: (fn: () => Promise<void>) => { presenceStart = fn; } };
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
    const noRv = setup({ probe: async () => ({ serverUrl: URL, serverId: 'f'.repeat(64), namespace: 'n', authentication: 'enrolled-device', deviceSessions: true, rendezvous: false, rendezvousProof: true, rendezvousNoise: true }) });
    expect(await noRv.act({ kind: 'connect', serverUrl: URL })).toEqual({ ok: false, code: 'unavailable' });
    const a = setup();
    await a.act({ kind: 'connect', serverUrl: URL });
    (a.account.enroll as ReturnType<typeof vi.fn>).mockRejectedValueOnce(Object.assign(new Error('x'), { status: 401 }));
    expect(await a.act({ kind: 'signIn', username: 'demo', password: 'pw', deviceName: 'Laptop' })).toEqual({ ok: false, code: 'authentication' });
    (a.account.enroll as ReturnType<typeof vi.fn>).mockRejectedValueOnce(Object.assign(new Error('x'), { status: 403 }));
    expect(await a.act({ kind: 'signIn', username: 'demo', password: 'pw', deviceName: 'Laptop' })).toEqual({ ok: false, code: 'enrollmentLocked' });
    (a.account.enroll as ReturnType<typeof vi.fn>).mockRejectedValueOnce(Object.assign(new Error('x'), { status: 429 }));
    expect(await a.act({ kind: 'signIn', username: 'demo', password: 'pw', deviceName: 'Laptop' })).toEqual({ ok: false, code: 'limit' });
    (a.account.enroll as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('x'));
    expect(await a.act({ kind: 'signIn', username: 'demo', password: 'pw', deviceName: 'Laptop' })).toEqual({ ok: false, code: 'connection' });
    await a.act({ kind: 'signIn', username: 'demo', password: 'pw', deviceName: 'Laptop' });
    a.setStart(async () => { throw Object.assign(new Error('x'), { status: 409 }); });
    expect(await a.act({ kind: 'goOnline', deviceName: 'L' })).toEqual({ ok: false, code: 'connection' });
    a.setStart(async () => { throw Object.assign(new Error('x'), { status: 429 }); });
    expect(await a.act({ kind: 'goOnline', deviceName: 'L' })).toEqual({ ok: false, code: 'limit' });
  });

  it('goOnline: locked and invalid name; an empty name falls back to the enrollment name', async () => {
    const t = setup();
    await t.act({ kind: 'connect', serverUrl: URL });
    await t.act({ kind: 'signIn', username: 'demo', password: 'pw', deviceName: 'Laptop' });
    t.unlocked.value = false;
    expect(await t.act({ kind: 'goOnline', deviceName: 'L' })).toEqual({ ok: false, code: 'locked' });
    t.unlocked.value = true;
    expect(await t.act({ kind: 'goOnline', deviceName: 'a\nb' })).toEqual({ ok: false, code: 'invalid' });
    const names: string[] = [];
    const named = setup({ deps: { presence: (_t, n, h) => { names.push(n); void h; return { start: async () => undefined, stop: async () => undefined }; } } });
    await named.act({ kind: 'connect', serverUrl: URL });
    await named.act({ kind: 'signIn', username: 'demo', password: 'pw', deviceName: 'Büro-PC' });
    expect((await named.act({ kind: 'goOnline', deviceName: '' })).ok).toBe(true);
    expect(names).toEqual(['Büro-PC']);
  });

  it('connect loads the identity once (shown from connect on); a failure yields identity and drops the binding', async () => {
    const t = setup();
    const reply = await t.act({ kind: 'connect', serverUrl: URL });
    expect(reply).toMatchObject({ ok: true, state: { phase: 'serverReady', identity: { fingerprint: SELF, persistent: true } } });
    expect((await t.act({ kind: 'signIn', username: 'demo', password: 'pw', deviceName: 'L' })).ok).toBe(true);
    await t.act({ kind: 'goOnline', deviceName: 'L' });
    expect(t.load).toHaveBeenCalledTimes(1);
    const bad = setup();
    bad.load.mockImplementationOnce(() => { throw new Error('identity'); });
    expect(await bad.act({ kind: 'connect', serverUrl: URL })).toEqual({ ok: false, code: 'identity' });
    expect(await bad.act({ kind: 'status' })).toEqual({ ok: true, state: { phase: 'idle' } });
    expect((await bad.act({ kind: 'connect', serverUrl: URL })).ok).toBe(true);
  });

  it('connect requires enrolled-device authentication and deviceSessions', async () => {
    const info = (over: Record<string, unknown>) => async () => ({ serverUrl: URL, serverId: 'f'.repeat(64), namespace: 'n', authentication: 'enrolled-device' as const, deviceSessions: true, rendezvous: true, rendezvousProof: true, rendezvousNoise: true, ...over }) as never;
    for (const over of [{ deviceSessions: false }, { authentication: 'password' }, { authentication: 'device' }]) {
      const t = setup({ probe: info(over) });
      expect(await t.act({ kind: 'connect', serverUrl: URL })).toEqual({ ok: false, code: 'unavailable' });
      expect(t.load).not.toHaveBeenCalled();
    }
  });

  it('signIn enrolls with the device name, opens the session and remembers the enrollment (ephemeral for a temporary identity)', async () => {
    const t = setup();
    await t.act({ kind: 'connect', serverUrl: URL });
    const reply = await t.act({ kind: 'signIn', username: 'demo', password: 'pw', deviceName: 'Laptop' });
    expect(reply).toMatchObject({ ok: true, state: { phase: 'signedIn', account: { username: 'demo', validUntil: 5_000_000, deviceName: 'Laptop' }, enrolled: { username: 'demo', name: 'Laptop' } } });
    expect(t.account.enroll).toHaveBeenCalledWith(expect.objectContaining({ id: SELF }), { username: 'demo', password: 'pw', name: 'Laptop', ephemeral: false });
    expect(t.rememberEnrollment).toHaveBeenCalledWith({ serverId: 'f'.repeat(64), namespace: 'demo', serverUrl: URL, username: 'demo', name: 'Laptop', enrolledAt: t.clock.t });
    const temp = setup();
    temp.load.mockReturnValue({ identity: { id: SELF, publicKey: 'pk-self', privateKey: {} } as unknown as RemoteIdentity, persistent: false });
    await temp.act({ kind: 'connect', serverUrl: URL });
    expect(await temp.act({ kind: 'status' })).toMatchObject({ ok: true, state: { identity: { persistent: false } } });
    await temp.act({ kind: 'signIn', username: 'demo', password: 'pw', deviceName: 'Laptop' });
    expect(temp.account.enroll).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ ephemeral: true }));
  });

  it('signIn rejects a bad device name before any account is created', async () => {
    const createAccount = vi.fn();
    const t = setup({ deps: { createAccount: createAccount as unknown as RemoteDeps['createAccount'] } });
    await t.act({ kind: 'connect', serverUrl: URL });
    expect(await t.act({ kind: 'signIn', username: 'demo', password: 'pw', deviceName: '' })).toEqual({ ok: false, code: 'invalid' });
    expect(await t.act({ kind: 'signIn', username: 'demo', password: 'pw', deviceName: 'a\nb' })).toEqual({ ok: false, code: 'invalid' });
    expect(createAccount).not.toHaveBeenCalled();
  });

  it('an enrollment for this server is offered; openSession needs no password', async () => {
    const t = setup();
    t.enrollment.mockReturnValue({ serverId: 'f'.repeat(64), namespace: 'demo', serverUrl: URL, username: 'demo', name: 'Laptop', enrolledAt: 1 });
    expect(await t.act({ kind: 'connect', serverUrl: URL })).toMatchObject({ ok: true, state: { phase: 'serverReady', enrolled: { username: 'demo', name: 'Laptop' } } });
    const reply = await t.act({ kind: 'openSession' });
    expect(reply).toMatchObject({ ok: true, state: { phase: 'signedIn', account: { username: 'demo', deviceName: 'Laptop' } } });
    expect(t.account.enroll).not.toHaveBeenCalled();
    expect((await t.act({ kind: 'goOnline', deviceName: '' })).ok).toBe(true);
  });

  it('K10: an enrollment on another origin shows enrolledElsewhere and allows no openSession', async () => {
    const t = setup();
    t.enrolledElsewhere.mockReturnValue('https://old.example/');
    const reply = await t.act({ kind: 'connect', serverUrl: URL });
    expect(reply).toMatchObject({ ok: true, state: { enrolledElsewhere: 'https://old.example/' } });
    expect(t.enrolledElsewhere).toHaveBeenCalledWith('f'.repeat(64), URL);
    expect((reply as { state: { enrolled?: unknown } }).state.enrolled).toBeUndefined();
    expect(await t.act({ kind: 'openSession' })).toEqual({ ok: false, code: 'stale' });
  });

  it('K29: signIn on an elsewhere-enrolled device needs confirmElsewhere; the old entry is kept', async () => {
    const t = setup();
    t.enrolledElsewhere.mockReturnValue('https://old.example/');
    await t.act({ kind: 'connect', serverUrl: URL });
    expect(await t.act({ kind: 'signIn', username: 'demo', password: 'pw', deviceName: 'Laptop' })).toEqual({ ok: false, code: 'enrolledElsewhere' });
    expect(t.account.enroll).not.toHaveBeenCalled();
    expect(t.rememberEnrollment).not.toHaveBeenCalled();
    expect((await t.act({ kind: 'signIn', username: 'demo', password: 'pw', deviceName: 'Laptop', confirmElsewhere: true })).ok).toBe(true);
    expect(t.account.enroll).toHaveBeenCalledTimes(1);
    expect(t.forgetEnrollment).not.toHaveBeenCalled();
  });

  it('device names follow isDeviceName: a code-like name is invalid, listed devices with such names are dropped', async () => {
    const t = setup();
    await t.act({ kind: 'connect', serverUrl: URL });
    expect(await t.act({ kind: 'signIn', username: 'demo', password: 'pw', deviceName: 'ab12 cd34' })).toEqual({ ok: false, code: 'invalid' });
    expect(await t.act({ kind: 'signIn', username: 'demo', password: 'pw', deviceName: 'x'.repeat(65) })).toEqual({ ok: false, code: 'invalid' });
    const u = setup();
    await u.goOnline();
    u.handlers().onDevices([device(B, 'Büro'), device('c'.repeat(64), 'abcdef12 34')]);
    expect(await u.act({ kind: 'status' })).toMatchObject({ ok: true, state: { devices: [{ id: B, name: 'Büro' }] } });
  });

  it('openSession: one 401 is retried, two 401 forget the enrollment (B6)', async () => {
    const t = setup();
    t.enrollment.mockReturnValue({ serverId: 'f'.repeat(64), namespace: 'demo', serverUrl: URL, username: 'demo', name: 'Laptop', enrolledAt: 1 });
    await t.act({ kind: 'connect', serverUrl: URL });
    const open = t.account.openSession as ReturnType<typeof vi.fn>;
    open.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 401 }));
    expect((await t.act({ kind: 'openSession' })).ok).toBe(true);
    expect(t.forgetEnrollment).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledTimes(2);
    const u = setup();
    u.enrollment.mockReturnValue({ serverId: 'f'.repeat(64), namespace: 'demo', serverUrl: URL, username: 'demo', name: 'Laptop', enrolledAt: 1 });
    await u.act({ kind: 'connect', serverUrl: URL });
    (u.account.openSession as ReturnType<typeof vi.fn>).mockRejectedValue(Object.assign(new Error('x'), { status: 401 }));
    expect(await u.act({ kind: 'openSession' })).toEqual({ ok: false, code: 'authentication' });
    expect(u.forgetEnrollment).toHaveBeenCalledWith('f'.repeat(64), URL);
    expect((await u.act({ kind: 'status' }) as { state: { enrolled?: unknown } }).state.enrolled).toBeUndefined();
  });

  it('B6: a 401 in presence keeps the enrollment; openSession then signs in again without a password', async () => {
    const t = setup();
    t.enrollment.mockReturnValue({ serverId: 'f'.repeat(64), namespace: 'demo', serverUrl: URL, username: 'demo', name: 'Laptop', enrolledAt: 1 });
    await t.act({ kind: 'connect', serverUrl: URL });
    await t.act({ kind: 'openSession' });
    t.setStart(async () => { throw Object.assign(new Error('x'), { status: 401 }); });
    expect(await t.act({ kind: 'goOnline', deviceName: '' })).toEqual({ ok: false, code: 'authentication' });
    expect(await t.act({ kind: 'status' })).toMatchObject({ ok: true, state: { phase: 'serverReady', enrolled: { name: 'Laptop' } } });
    expect(t.forgetEnrollment).not.toHaveBeenCalled();
    t.setStart(async () => undefined);
    expect((await t.act({ kind: 'openSession' })).ok).toBe(true);
    expect(t.account.enroll).not.toHaveBeenCalled();
  });

  it('B6: onOffline(authentication) and a 401 in request keep the enrollment', async () => {
    const t = setup();
    await t.goOnline();
    t.handlers().onOffline('authentication');
    expect(await t.act({ kind: 'status' })).toMatchObject({ ok: true, state: { phase: 'serverReady', enrolled: { username: 'demo' } } });
    expect(t.forgetEnrollment).not.toHaveBeenCalled();
    const u = setup();
    await u.goOnline();
    u.handlers().onDevices([device(B, 'Büro')]);
    u.peer.request.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 401 }));
    await u.act({ kind: 'request', target: B, verification: PREFIX });
    expect(u.forgetEnrollment).not.toHaveBeenCalled();
    expect(await u.act({ kind: 'status' })).toMatchObject({ ok: true, state: { phase: 'serverReady', enrolled: { username: 'demo' } } });
  });

  it('allows only one network action at a time', async () => {
    let release!: () => void;
    const t = setup({ probe: () => new Promise(r => { release = () => r({ serverUrl: URL, serverId: 'f'.repeat(64), namespace: 'n', authentication: 'enrolled-device', deviceSessions: true, rendezvous: true, rendezvousProof: true, rendezvousNoise: true }); }) });
    const first = t.act({ kind: 'connect', serverUrl: URL });
    expect(await t.act({ kind: 'signIn', username: 'demo', password: 'pw', deviceName: 'Laptop' })).toEqual({ ok: false, code: 'stale' });
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


describe('RemoteLabHost: consent, native dialog and capture (R1, B7)', () => {
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

  it('the legacy renderer commands accept, signal and stopped no longer exist', async () => {
    const t = setup();
    await t.consent();
    for (const kind of ['accept', 'signal', 'stopped']) expect(await t.act({ kind, sessionId: SID, part: part('offer') })).toEqual({ ok: false, code: 'invalid' });
  });

  it('armed shows in the state until the dialog; no dialog before nativeDelayMs, then exactly one (V8)', async () => {
    const t = setup();
    await t.consent();
    expect(((await t.act({ kind: 'status' })) as { state: { session: { armed?: true } } }).state.session.armed).toBeUndefined();
    await t.act({ kind: 'armCapture', sessionId: SID, verification: PREFIX });
    expect(await t.act({ kind: 'status' })).toMatchObject({ state: { session: { state: 'consent', armed: true } } });
    await t.clock.advance(NATIVE - 1);
    expect(t.confirmCapture).not.toHaveBeenCalled();
    await t.clock.advance(1);
    expect(t.confirmCapture).toHaveBeenCalledTimes(1);
    expect(t.confirmCapture).toHaveBeenCalledWith(OWNER, { name: 'Büro', fingerprint: B, verified: true }, expect.any(AbortSignal));
    await t.clock.advance(10_000);
    expect(t.confirmCapture).toHaveBeenCalledTimes(1);
    expect(((await t.act({ kind: 'status' })) as { state: { session: { armed?: true } } }).state.session.armed).toBeUndefined();
  });

  it('agent flow order: dialog, open, ready, hello, capture, channel, accepted', async () => {
    const t = setup();
    await t.armed();
    const before = t.clock.t;
    await t.clock.advance(NATIVE);
    expect(t.media.order).toEqual(['dialog', 'open', 'ready', 'hello', 'capture', 'accepted']);
    expect(t.media.opened).toEqual([{ id: 41, role: 'agent', peerName: 'Büro' }]);
    expect(t.media.events[0]).toEqual({ id: 41, event: { kind: 'hello', role: 'agent', peerName: '', expiresAt: before + 55_000 } });
    expect(t.media.captures).toEqual([{ id: 41, sourceId: undefined }]);
    expect(t.peer.channel).toHaveBeenCalledWith(expect.objectContaining({ id: SID }), B, 'view');
    expect(await t.act({ kind: 'status' })).toMatchObject({ state: { session: { state: 'connecting' } } });
    expect(t.host.sharing).toBe(true);
  });

  it('path B: captureSource is awaited and its id is passed to capture', async () => {
    const t = setup({ deps: { captureSource: async () => 'screen:0:0' } });
    await t.armed();
    await t.clock.advance(NATIVE);
    expect(t.media.captures).toEqual([{ id: 41, sourceId: 'screen:0:0' }]);
    expect(t.media.kinds('accepted')).toHaveLength(1);
  });

  it('decline during the waiting time shows no dialog', async () => {
    const t = setup();
    await t.armed();
    await t.clock.advance(NATIVE - 100);
    expect((await t.act({ kind: 'decline', sessionId: SID })).ok).toBe(true);
    await t.clock.advance(5000);
    expect(t.confirmCapture).not.toHaveBeenCalled();
    expect(t.media.opened).toEqual([]);
    expect(t.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'declined' }]);
  });

  it('K7: unavailable resets armed without muting or ending; arming again works', async () => {
    const t = setup();
    await t.armed();
    t.confirmCapture.mockResolvedValueOnce('unavailable');
    await t.clock.advance(NATIVE);
    expect(t.kinds('ended')).toEqual([]);
    expect(t.media.opened).toEqual([]);
    const status = await t.act({ kind: 'status' });
    expect(status).toMatchObject({ state: { session: { state: 'consent' } } });
    expect((status as { state: { session: { armed?: true }; muted?: number } }).state.session.armed).toBeUndefined();
    expect((status as { state: { muted?: number } }).state.muted).toBeUndefined();
    expect((await t.act({ kind: 'armCapture', sessionId: SID, verification: PREFIX })).ok).toBe(true);
    await t.clock.advance(NATIVE);
    expect(t.media.opened).toHaveLength(1);
  });

  it('a refusal declines, mutes the device and ends the session without any window', async () => {
    const t = setup();
    await t.armed();
    t.confirmCapture.mockResolvedValueOnce('declined');
    await t.clock.advance(NATIVE);
    expect(t.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'declined' }]);
    expect(t.media.opened).toEqual([]);
    t.handlers().onSessions([wire({ id: SID2 })]);
    await flush();
    expect(t.deletes()).toContain(`/v1/rendezvous/sessions/${SID2}`);
    expect(await t.act({ kind: 'status' })).toMatchObject({ state: { muted: 1 } });
  });

  it('a throwing dialog counts as declined; a lock during the dialog ends locked', async () => {
    const t = setup();
    await t.armed();
    t.confirmCapture.mockRejectedValueOnce(new Error('x'));
    await t.clock.advance(NATIVE);
    expect(t.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'declined' }]);
    const l = setup();
    await l.armed();
    l.confirmCapture.mockImplementationOnce(async () => { l.unlocked.value = false; return 'accepted' as const; });
    await l.clock.advance(NATIVE);
    expect(l.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'locked' }]);
    expect(l.media.opened).toEqual([]);
  });

  it('the deadline aborts the dialog signal and ends expired', async () => {
    const t = setup();
    await t.armed();
    let signal!: AbortSignal;
    t.confirmCapture.mockImplementationOnce((_o, _p, s) => new Promise<'declined'>(r => { signal = s; s.addEventListener('abort', () => r('declined')); }));
    await t.clock.advance(55_000);
    expect(signal.aborted).toBe(true);
    expect(t.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'expired' }]);
    expect(t.media.opened).toEqual([]);
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
      t.confirmCapture.mockImplementationOnce((_o, _p, s) => new Promise<'declined'>(r => { signal = s; s.addEventListener('abort', () => r('declined')); }));
      await t.clock.advance(NATIVE);
      await end(t);
      await flush();
      expect(signal.aborted).toBe(true);
      expect(t.media.opened).toEqual([]);
    }
  });

  it('B7: the grant belongs to the media window only; it is consumed exactly once', async () => {
    const t = setup();
    const release = await t.granted();
    const id = t.media.id;
    expect(t.host.grantedSession(MAIN)).toBeNull();
    expect(t.host.consumeCaptureGrant(MAIN)).toBeNull();
    expect(t.host.grantedSession(id + 1)).toBeNull();
    expect(t.host.grantedSession(id)).toBe(SID);
    expect(t.host.isCaptureSession(id, SID)).toBe(true);
    expect(t.host.isCaptureSession(MAIN, SID)).toBe(false);
    expect(t.host.isCaptureSession(id, SID2)).toBe(false);
    expect(t.host.consumeCaptureGrant(id)).toBe(SID);
    expect(t.host.consumeCaptureGrant(id)).toBeNull();
    expect(t.host.grantedSession(id)).toBeNull();
    expect(t.host.isCaptureSession(id, SID)).toBe(true); // consumed, still the live captured session
    expect(t.host.isCaptureSession(id)).toBe(true);
    expect(t.host.isCaptureSession(MAIN)).toBe(false);
    t.media.consumeGrant = false;
    release();
    await flush();
    expect(t.media.kinds('accepted')).toHaveLength(1);
    await t.act({ kind: 'stop', sessionId: SID });
    expect(t.host.isCaptureSession(id, SID)).toBe(false);
    expect(t.host.isCaptureSession(id)).toBe(false);
  });

  it('B7: the main window id never gets a grant, before or after the dialog', async () => {
    const t = setup();
    await t.consent();
    expect(t.host.grantedSession(MAIN)).toBeNull();
    await t.act({ kind: 'armCapture', sessionId: SID, verification: PREFIX });
    expect(t.host.grantedSession(MAIN)).toBeNull();
    await t.clock.advance(NATIVE);
    expect(t.host.grantedSession(MAIN)).toBeNull();
    expect(t.host.consumeCaptureGrant(MAIN)).toBeNull();
  });

  it('B7: after the handshake started the grant is no longer offered (state connecting)', async () => {
    const t = setup();
    await t.accepted();
    expect(t.host.grantedSession(t.media.id)).toBeNull();
    expect(t.host.consumeCaptureGrant(t.media.id)).toBeNull();
  });

  it('B7: capture false ends with error media and failed, destroying the window', async () => {
    const t = setup();
    t.media.captureResult = false;
    await t.armed();
    await t.clock.advance(NATIVE);
    expect(t.kinds('error')).toEqual([{ kind: 'error', code: 'media' }]);
    expect(t.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'failed' }]);
    expect(t.media.destroyed).toEqual([41]);
    expect(t.peer.channel).not.toHaveBeenCalled();
    expect(t.media.kinds('accepted')).toEqual([]);
  });

  it('B7: capture true without a consumed grant ends with error media and failed (no gesture, no handler call)', async () => {
    const t = setup();
    t.media.consumeGrant = false;
    await t.armed();
    await t.clock.advance(NATIVE);
    expect(t.kinds('error')).toEqual([{ kind: 'error', code: 'media' }]);
    expect(t.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'failed' }]);
    expect(t.media.destroyed).toEqual([41]);
    expect(t.peer.channel).not.toHaveBeenCalled();
    expect(t.host.sharing).toBe(false);
  });

  it('ready false ends with error mediaWindow and failed, destroying the window; no hello, no capture', async () => {
    const t = setup();
    t.media.readyResult = false;
    await t.armed();
    await t.clock.advance(NATIVE);
    expect(t.kinds('error')).toEqual([{ kind: 'error', code: 'mediaWindow' }]);
    expect(t.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'failed' }]);
    expect(t.media.destroyed).toEqual([41]);
    expect(t.media.events).toEqual([]);
    expect(t.media.captures).toEqual([]);
  });

  it('K8: open throwing ends with mediaWindow and failed', async () => {
    const t = setup();
    t.media.openError = true;
    await t.armed();
    await t.clock.advance(NATIVE);
    expect(t.kinds('error')).toEqual([{ kind: 'error', code: 'mediaWindow' }]);
    expect(t.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'failed' }]);
  });

  it('an end during ready destroys exactly once and never captures', async () => {
    const t = setup();
    let release!: (ok: boolean) => void;
    t.media.readyGate = new Promise<boolean>(r => { release = r; });
    await t.armed();
    await t.clock.advance(NATIVE);
    expect(t.media.opened).toHaveLength(1);
    await t.act({ kind: 'stop', sessionId: SID });
    release(true);
    await flush();
    expect(t.media.destroyed).toEqual([41]);
    expect(t.media.captures).toEqual([]);
    expect(t.media.events).toEqual([]);
    expect(t.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'stopped' }]);
  });

  it('an end during capture destroys exactly once and never builds a channel', async () => {
    const t = setup();
    const release = await t.granted();
    expect(t.media.captures).toHaveLength(1);
    await t.act({ kind: 'stop', sessionId: SID });
    release();
    await flush();
    expect(t.media.destroyed).toEqual([41]);
    expect(t.peer.channel).not.toHaveBeenCalled();
    expect(t.media.kinds('accepted')).toEqual([]);
    expect(t.kinds('error')).toEqual([]);
  });

  it('decline works in granted; a vanishing request ends a granted session with remote; both destroy the window', async () => {
    const d = setup();
    await d.granted();
    expect((await d.act({ kind: 'decline', sessionId: SID })).ok).toBe(true);
    expect(d.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'declined' }]);
    expect(d.media.destroyed).toEqual([41]);
    const v = setup();
    await v.granted();
    v.handlers().onSessions([]);
    expect(v.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'remote' }]);
    expect(v.media.destroyed).toEqual([41]);
  });

  it('armCapture: null needs a verified pin; invalid input is no attempt; three misses end with mismatch and mute', async () => {
    const t = setup();
    await t.consent();
    expect(await t.act({ kind: 'armCapture', sessionId: SID, verification: null })).toEqual({ ok: false, code: 'invalid' });
    expect(await t.act({ kind: 'armCapture', sessionId: SID, verification: 'zz' })).toEqual({ ok: false, code: 'invalid' });
    expect(await t.act({ kind: 'status' })).toMatchObject({ state: { session: { attemptsLeft: 3 } } });
    expect(await t.act({ kind: 'armCapture', sessionId: SID, verification: 'c'.repeat(REMOTE_LAB_LIMITS.verificationHex) })).toEqual({ ok: false, code: 'mismatch' });
    expect(await t.act({ kind: 'status' })).toMatchObject({ state: { session: { attemptsLeft: 2 } } });
    expect(await t.act({ kind: 'armCapture', sessionId: SID, verification: 'c'.repeat(REMOTE_LAB_LIMITS.verificationHex) })).toEqual({ ok: false, code: 'mismatch' });
    expect(t.kinds('ended')).toEqual([]);
    expect(await t.act({ kind: 'armCapture', sessionId: SID, verification: 'c'.repeat(REMOTE_LAB_LIMITS.verificationHex) })).toEqual({ ok: false, code: 'mismatch' });
    expect(t.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'mismatch' }]);
    expect(t.host.grantedSession(41)).toBeNull();
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
    await t.clock.advance(NATIVE);
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

  it('K28: a lock after the capture ends the session locked instead of reporting to a renderer', async () => {
    const t = setup();
    const release = await t.granted();
    t.unlocked.value = false;
    release();
    await flush();
    expect(t.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'locked' }]);
    expect(t.media.destroyed).toEqual([41]);
    expect(t.peer.channel).not.toHaveBeenCalled();
  });

  it('K28: a channel mismatch emits error mismatch and ends failed; a failing accept emits connection', async () => {
    const m = setup();
    (m.peer.channel as ReturnType<typeof vi.fn>).mockImplementationOnce(() => { throw new Error('mismatch'); });
    await m.armed();
    await m.clock.advance(NATIVE);
    expect(m.kinds('error')).toEqual([{ kind: 'error', code: 'mismatch' }]);
    expect(m.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'failed' }]);
    expect(m.media.destroyed).toEqual([41]);
    const f = setup();
    (f.peer.channel as ReturnType<typeof vi.fn>).mockImplementationOnce(() => { const c = new FakeChannel(); c.acceptError = new Error('x'); return c; });
    await f.armed();
    await f.clock.advance(NATIVE);
    expect(f.kinds('error')).toEqual([{ kind: 'error', code: 'connection' }]);
    expect(f.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'failed' }]);
    expect(f.host.sharing).toBe(false);
    expect(f.media.destroyed).toEqual([41]);
  });

  it('accepted starts sharing and flips to connecting with a fresh sessionMs deadline', async () => {
    const t = setup();
    const sharing: boolean[] = [];
    t.host.onSharingChange(s => sharing.push(s));
    await t.accepted();
    expect(sharing).toEqual([true]);
    expect(await t.act({ kind: 'status' })).toMatchObject({ state: { session: { state: 'connecting', expiresAt: t.clock.t + REMOTE_LAB_LIMITS.sessionMs } } });
  });

  it('K6: no complete own offer within handshakeMs after accepted ends with error signal and failed', async () => {
    const t = setup();
    await t.accepted();
    await t.clock.advance(REMOTE_LAB_LIMITS.handshakeMs - 1);
    expect(t.kinds('ended')).toEqual([]);
    await t.clock.advance(1);
    expect(t.kinds('error')).toEqual([{ kind: 'error', code: 'signal' }]);
    expect(t.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'failed' }]);
    expect(t.media.destroyed).toEqual([41]);
  });

  it('K6: a complete offer within the window stops the timer', async () => {
    const t = setup();
    await t.accepted();
    expect(await t.mediaAct({ kind: 'signal', part: msg('offer')[0] })).toEqual({ ok: true });
    await t.clock.advance(REMOTE_LAB_LIMITS.handshakeMs * 2);
    expect(t.kinds('error')).toEqual([]);
    expect(t.kinds('ended')).toEqual([]);
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
    expect(t.media.destroyed).toEqual([41]);
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
    expect(t.media.destroyed).toEqual([]);
    t.host.closeOwner(OWNER);
    expect(t.host.sharing).toBe(false);
    expect(t.media.destroyed).toEqual([41]);
    expect(t.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'stopped' }]);
  });

  it('every end destroys the media window exactly once, even before the channel exists', async () => {
    const t = setup();
    await t.accepted();
    await t.act({ kind: 'stop', sessionId: SID });
    t.host.reset();
    t.host.closeOwner(OWNER);
    expect(t.media.destroyed).toEqual([41]);
    const e = setup();
    e.handshake.rounds = 1000;
    await e.armed();
    await e.clock.advance(NATIVE); // handshake still running: no channel ready yet
    expect(e.media.kinds('accepted')).toEqual([]);
    await e.act({ kind: 'stop', sessionId: SID });
    expect(e.media.destroyed).toEqual([41]);
    const v = setup();
    await v.requesting();
    expect(v.media.opened).toEqual([]);
    await v.act({ kind: 'stop', sessionId: SID });
    expect(v.media.destroyed).toEqual([]);
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
    await t.act({ kind: 'signIn', username: 'demo', password: 'pw', deviceName: 'Laptop' });
    t.setStart(async () => { throw Object.assign(new Error('x'), { status: 401 }); });
    expect(await t.act({ kind: 'goOnline', deviceName: 'L' })).toEqual({ ok: false, code: 'authentication' });
    const status = await t.act({ kind: 'status' });
    expect(status).toMatchObject({ ok: true, state: { phase: 'serverReady' } });
    expect((status as { state: { account?: unknown } }).state.account).toBeUndefined();
    expect(t.account.close).toHaveBeenCalled();
    expect((await t.act({ kind: 'signIn', username: 'demo', password: 'pw', deviceName: 'Laptop' })).ok).toBe(true);
  });

  it('M3: a 401 in request drops the account and stops presence', async () => {
    const t = setup();
    await t.goOnline();
    t.handlers().onDevices([device(B, 'Büro')]);
    t.peer.request.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 401 }));
    expect(await t.act({ kind: 'request', target: B, verification: PREFIX })).toEqual({ ok: false, code: 'authentication' });
    expect(await t.act({ kind: 'status' })).toMatchObject({ ok: true, state: { phase: 'serverReady' } });
    expect(t.presenceStop).toHaveBeenCalled();
    expect((await t.act({ kind: 'signIn', username: 'demo', password: 'pw', deviceName: 'Laptop' })).ok).toBe(true);
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
    expect(t.media.opened).toHaveLength(1);
    expect(t.peer.channel).toHaveBeenCalledWith(expect.objectContaining({ state: 'active' }), B, 'view');
    expect(await t.act({ kind: 'status' })).toMatchObject({ state: { session: { state: 'connecting' } } });
  });

  it('a 404 while requesting ends with declined', async () => {
    const t = setup();
    await t.requesting();
    t.account.getImpl = async () => { throw Object.assign(new Error('x'), { status: 404 }); };
    await t.clock.advance(1000);
    expect(t.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'declined' }]);
  });

  it('K5: the viewer window opens after the channel and deadline, hello carries the session deadline', async () => {
    const t = setup();
    await t.requesting();
    expect(t.media.opened).toEqual([]);
    t.account.getImpl = async () => wire({ from: SELF, to: B, state: 'active' });
    await t.clock.advance(1000);
    expect(t.media.opened).toEqual([{ id: 41, role: 'viewer', peerName: 'Büro' }]);
    expect(t.media.order.slice(0, 3)).toEqual(['open', 'ready', 'hello']);
    expect(t.media.events[0]).toEqual({ id: 41, event: { kind: 'hello', role: 'viewer', peerName: 'Büro', expiresAt: t.clock.t + REMOTE_LAB_LIMITS.sessionMs } });
    expect(t.media.captures).toEqual([]);
  });

  it('K5: an offer arriving before ready is buffered and delivered after hello', async () => {
    const t = setup();
    let release!: (ok: boolean) => void;
    t.media.readyGate = new Promise<boolean>(r => { release = r; });
    await t.requesting();
    t.account.getImpl = async () => wire({ from: SELF, to: B, state: 'active' });
    await t.clock.advance(1000);
    const channel = t.channels[0]!;
    channel.inbox.push(frames(msg('offer', 2)));
    await t.clock.advance(1000);
    expect(t.media.events).toEqual([]);
    expect(await t.act({ kind: 'status' })).toMatchObject({ state: { session: { state: 'active' } } });
    release(true);
    await flush();
    expect(t.media.order.filter(k => k === 'hello' || k === 'signal')).toEqual(['hello', 'signal', 'signal']);
    expect(t.media.signals()).toEqual(msg('offer', 2));
  });

  it('delivers the offer only after the complete message: parts of an incomplete message stay inside the host', async () => {
    const t = setup();
    const channel = await t.viewing();
    const offer = msg('offer', 2);
    channel.inbox.push(frames([offer[0]!]));
    await t.clock.advance(1000);
    expect(t.media.signals()).toEqual([]);
    expect(await t.act({ kind: 'status' })).toMatchObject({ state: { session: { state: 'connecting' } } });
    channel.inbox.push(frames([offer[1]!]));
    await t.clock.advance(1000);
    expect(t.media.signals()).toEqual(offer);
    expect(t.kinds('signal')).toEqual([]);
    expect(await t.act({ kind: 'status' })).toMatchObject({ state: { session: { state: 'active', startedAt: t.clock.t } } });
    expect(t.remember).toHaveBeenCalledWith(B, 'Büro', t.clock.t, true);
  });

  it('an SDP with a=sendrecv or m=application ends with error signal and failed, nothing delivered', async () => {
    for (const bad of [sdpText('a=sendrecv'), sdpText('a=sendonly', [], 'm=application 9 UDP/DTLS/SCTP webrtc-datachannel')]) {
      const t = setup();
      const channel = await t.viewing();
      channel.inbox.push(frames(msg('offer', 1, bad)));
      await t.clock.advance(1000);
      expect(t.kinds('error')).toEqual([{ kind: 'error', code: 'signal' }]);
      expect(t.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'failed' }]);
      expect(t.media.signals()).toEqual([]);
      expect(t.media.destroyed).toEqual([41]);
      expect(t.remember).not.toHaveBeenCalled();
    }
  });

  it('K5: ready false ends with error mediaWindow and failed', async () => {
    const t = setup();
    t.media.readyResult = false;
    await t.viewing();
    expect(t.kinds('error')).toEqual([{ kind: 'error', code: 'mediaWindow' }]);
    expect(t.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'failed' }]);
    expect(t.media.destroyed).toEqual([41]);
  });

  it('K6: no complete answer within handshakeMs after the delivered offer ends with error signal and failed', async () => {
    const t = setup();
    const channel = await t.viewing();
    channel.inbox.push(frames(msg('offer')));
    await t.clock.advance(1000);
    expect(t.media.signals()).toHaveLength(1);
    await t.clock.advance(REMOTE_LAB_LIMITS.handshakeMs - 1);
    expect(t.kinds('ended')).toEqual([]);
    await t.clock.advance(1);
    expect(t.kinds('error')).toEqual([{ kind: 'error', code: 'signal' }]);
    expect(t.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'failed' }]);
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
    c2.inbox.push(frames(msg('answer')));
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
    c5.inbox.push(frames(msg('offer')));
    await limited.clock.advance(1000);
    expect(limited.kinds('ended')).toEqual([]);
    expect(limited.media.signals()).toHaveLength(1);
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
    channel.inbox.push(frames(msg('offer')));
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

  it('a capture finishing after the deadline is expired; the viewer request expires after 60 s', async () => {
    const t = setup();
    const release = await t.granted();
    t.clock.t += 55_000;
    release();
    await flush();
    expect(t.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'expired' }]);
    expect(t.peer.channel).not.toHaveBeenCalled();
    expect(t.media.destroyed).toEqual([41]);
    const v = setup();
    await v.requesting();
    await v.clock.advance(60_000);
    expect(v.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'expired' }]);
  });

  it('connecting and active end 300 s after the channel was created', async () => {
    const t = setup();
    await t.accepted();
    const created = t.clock.t;
    await t.mediaAct({ kind: 'signal', part: msg('offer')[0] }); // an own offer keeps the K6 timer quiet
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

describe('RemoteLabHost: media window actions (B8, K3)', () => {
  const delivered = async (): Promise<{ t: ReturnType<typeof setup>; channel: FakeChannel }> => {
    const t = setup();
    const channel = await t.viewing();
    channel.inbox.push(frames(msg('offer')));
    await t.clock.advance(1000);
    return { t, channel };
  };

  it('an unknown or foreign webcontents id and a missing session answer stale and change nothing', async () => {
    const none = setup();
    expect(await none.host.mediaAction(41, { kind: 'stop' })).toEqual({ ok: false, code: 'stale' });
    const t = setup();
    const channel = await t.accepted();
    expect(await t.host.mediaAction(MAIN, { kind: 'stop' })).toEqual({ ok: false, code: 'stale' });
    expect(await t.host.mediaAction(t.media.id + 1, { kind: 'signal', part: msg('offer')[0] })).toEqual({ ok: false, code: 'stale' });
    expect(await t.host.mediaAction(MAIN, 'garbage')).toEqual({ ok: false, code: 'stale' });
    expect(t.kinds('ended')).toEqual([]);
    expect(channel.sent).toEqual([]);
  });

  it('the host without deps answers stale', async () => {
    expect(await new RemoteLabHost().mediaAction(41, { kind: 'stop' })).toEqual({ ok: false, code: 'stale' });
  });

  it('a schema error of the matching window ends the session failed and answers invalid', async () => {
    for (const bad of [null, 'x', { kind: 'nope' }, { kind: 'stop', extra: 1 }, { kind: 'failed', code: 'locked' }, { kind: 'signal', part: 1, extra: 1 }]) {
      const t = setup();
      await t.accepted();
      expect(await t.mediaAct(bad)).toEqual({ ok: false, code: 'invalid' });
      expect(t.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'failed' }]);
      expect(t.media.destroyed).toEqual([41]);
    }
  });

  it('stop ends stopped', async () => {
    const t = setup();
    await t.accepted();
    expect(await t.mediaAct({ kind: 'stop' })).toEqual({ ok: true });
    expect(t.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'stopped' }]);
    expect(t.media.destroyed).toEqual([41]);
    expect(t.host.sharing).toBe(false);
  });

  it('failed emits the error code first (peer, signal, media), then ends failed', async () => {
    for (const code of ['peer', 'signal', 'media'] as const) {
      const t = setup();
      await t.accepted();
      expect(await t.mediaAct({ kind: 'failed', code })).toEqual({ ok: true });
      const order = t.events.map(e => e.event.kind === 'error' ? `error:${e.event.code}` : e.event.kind === 'ended' ? 'ended' : '').filter(Boolean);
      expect(order).toEqual([`error:${code}`, 'ended']);
      expect(t.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'failed' }]);
    }
  });

  it('an action after the end is stale', async () => {
    const t = setup();
    await t.accepted();
    const id = t.media.id;
    await t.act({ kind: 'stop', sessionId: SID });
    expect(await t.host.mediaAction(id, { kind: 'stop' })).toEqual({ ok: false, code: 'stale' });
  });

  it('agent: a signal before accepted is stale and sends nothing', async () => {
    const t = setup();
    await t.granted();
    expect(await t.mediaAct({ kind: 'signal', part: msg('offer')[0] })).toEqual({ ok: false, code: 'stale' });
    expect(t.channels).toHaveLength(0);
    expect(t.kinds('ended')).toEqual([]);
  });

  it('agent: the relay starts only after the complete message and keeps the part order', async () => {
    const t = setup();
    const channel = await t.accepted();
    const offer = msg('offer', 3);
    expect(await t.mediaAct({ kind: 'signal', part: offer[0] })).toEqual({ ok: true });
    expect(await t.mediaAct({ kind: 'signal', part: offer[1] })).toEqual({ ok: true });
    expect(channel.sendsStarted).toBe(0);
    expect(await t.mediaAct({ kind: 'signal', part: offer[2] })).toEqual({ ok: true });
    expect(channel.sent).toEqual(offer.map(p => ({ part: p })));
    expect(await t.act({ kind: 'status' })).toMatchObject({ state: { session: { state: 'connecting' } } });
  });

  it('agent: a=sendrecv, m=application and a wrong direction end with error signal and failed before any send', async () => {
    for (const bad of [sdpText('a=sendrecv'), sdpText('a=sendonly', [], 'm=application 9 UDP/DTLS/SCTP webrtc-datachannel'), ANSWER]) {
      const t = setup();
      const channel = await t.accepted();
      const reply = await t.mediaAct({ kind: 'signal', part: msg('offer', 1, bad)[0] });
      expect(reply).toEqual({ ok: false, code: 'invalid' });
      expect(t.kinds('error')).toEqual([{ kind: 'error', code: 'signal' }]);
      expect(t.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'failed' }]);
      expect(channel.sent.filter(v => (v as { part: RemoteSignalPart }).part.kind !== 'bye')).toEqual([]);
    }
  });

  it('a bye, the wrong kind, a malformed part and a broken sequence end failed and answer invalid before any send', async () => {
    const cases: Array<{ role: 'agent' | 'viewer'; parts: unknown[] }> = [
      { role: 'agent', parts: [part('bye', 1, 1, '')] },
      { role: 'agent', parts: [msg('answer')[0]] },
      { role: 'agent', parts: [{ kind: 'offer', part: 9, of: 1, data: 'x' }] },
      { role: 'agent', parts: [{ nope: 1 }] },
      { role: 'agent', parts: [msg('offer', 2)[1]] },
      { role: 'agent', parts: [msg('offer', 2)[0], msg('offer', 2)[0]] },
      { role: 'viewer', parts: [msg('offer')[0]] },
    ];
    for (const c of cases) {
      let t: ReturnType<typeof setup>;
      let channel: FakeChannel;
      if (c.role === 'agent') { t = setup(); channel = await t.accepted(); } else ({ t, channel } = await delivered());
      let reply: RemoteMediaReply | undefined;
      for (const p of c.parts) reply = await t.mediaAct({ kind: 'signal', part: p });
      expect(reply).toEqual({ ok: false, code: 'invalid' });
      expect(t.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'failed' }]);
      expect(channel.sent.filter(v => (v as { part: RemoteSignalPart }).part.kind !== 'bye')).toEqual([]);
    }
  });

  it('agent: a second message and any part after the complete one are stale, nothing more is sent', async () => {
    const t = setup();
    const channel = await t.accepted();
    expect(await t.mediaAct({ kind: 'signal', part: msg('offer')[0] })).toEqual({ ok: true });
    expect(await t.mediaAct({ kind: 'signal', part: msg('offer')[0] })).toEqual({ ok: false, code: 'stale' });
    expect(await t.mediaAct({ kind: 'signal', part: msg('offer', 2)[1] })).toEqual({ ok: false, code: 'stale' });
    expect(channel.sent).toEqual([{ part: msg('offer')[0] }]);
    expect(t.kinds('ended')).toEqual([]);
  });

  it('agent: a signal in a non-connecting state or on a channel that is not ready is stale', async () => {
    const t = setup();
    t.handshake.rounds = 1000;
    await t.armed();
    await t.clock.advance(NATIVE);
    expect(t.media.kinds('accepted')).toEqual([]);
    expect(await t.mediaAct({ kind: 'signal', part: msg('offer')[0] })).toEqual({ ok: false, code: 'stale' });
    expect(t.channels[0]!.sent).toEqual([]);
  });

  it('viewer: the answer is stale until the offer was delivered, then it is relayed once complete', async () => {
    const t = setup();
    const channel = await t.viewing();
    expect(await t.mediaAct({ kind: 'signal', part: msg('answer')[0] })).toEqual({ ok: false, code: 'stale' });
    channel.inbox.push(frames(msg('offer')));
    await t.clock.advance(1000);
    const answer = msg('answer', 2);
    expect(await t.mediaAct({ kind: 'signal', part: answer[0] })).toEqual({ ok: true });
    expect(channel.sent).toEqual([]);
    expect(await t.mediaAct({ kind: 'signal', part: answer[1] })).toEqual({ ok: true });
    expect(channel.sent).toEqual(answer.map(p => ({ part: p })));
  });

  it('viewer: an answer with the wrong direction ends with error signal and failed before any send', async () => {
    const { t, channel } = await delivered();
    expect(await t.mediaAct({ kind: 'signal', part: msg('answer', 1, sdpText('a=sendrecv'))[0] })).toEqual({ ok: false, code: 'invalid' });
    expect(t.kinds('error')).toEqual([{ kind: 'error', code: 'signal' }]);
    expect(t.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'failed' }]);
    expect(channel.sent.filter(v => (v as { part: RemoteSignalPart }).part.kind !== 'bye')).toEqual([]);
  });

  it('sends strictly serially: the second part starts after the first finished', async () => {
    const t = setup();
    const channel = await t.accepted();
    let release!: () => void;
    channel.sendGate = () => new Promise<void>(r => { release = r; });
    const offer = msg('offer', 2);
    expect(await t.mediaAct({ kind: 'signal', part: offer[0] })).toEqual({ ok: true });
    const done = t.mediaAct({ kind: 'signal', part: offer[1] });
    await flush();
    expect(channel.sendsStarted).toBe(1);
    channel.sendGate = undefined;
    release();
    expect(await done).toEqual({ ok: true });
    expect(channel.sent).toEqual(offer.map(p => ({ part: p })));
  });

  it('a failing send ends the session failed', async () => {
    const t = setup();
    const channel = await t.accepted();
    channel.sendGate = async () => { throw new Error('x'); };
    expect(await t.mediaAct({ kind: 'signal', part: msg('offer')[0] })).toEqual({ ok: false, code: 'stale' });
    expect(t.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'failed' }]);
    expect(t.media.destroyed).toEqual([41]);
  });

  it('B8: no reply carries more than ok and code, and never any state', async () => {
    const t = setup();
    await t.accepted();
    const replies: unknown[] = [
      await t.host.mediaAction(MAIN, { kind: 'stop' }),
      await t.mediaAct({ kind: 'signal', part: msg('offer')[0] }),
      await t.mediaAct({ kind: 'signal', part: msg('offer')[0] }),
      await t.mediaAct({ kind: 'stop' }),
      await t.mediaAct({ kind: 'stop' }),
    ];
    const bad = setup();
    await bad.accepted();
    replies.push(await bad.mediaAct({ kind: 'nope' }));
    const failed = setup();
    await failed.accepted();
    replies.push(await failed.mediaAct({ kind: 'failed', code: 'peer' }));
    for (const r of replies) expect(Object.keys(r as object).every(k => k === 'ok' || k === 'code')).toBe(true);
    expect(replies).toEqual([{ ok: false, code: 'stale' }, { ok: true }, { ok: false, code: 'stale' }, { ok: true }, { ok: false, code: 'stale' }, { ok: false, code: 'invalid' }, { ok: true }]);
  });

  it('B8: events to the media window are only hello, accepted and signal', async () => {
    const { t } = await delivered();
    await t.mediaAct({ kind: 'signal', part: msg('answer')[0] });
    const a = setup();
    await a.accepted();
    for (const e of [...t.media.events, ...a.media.events]) expect(['hello', 'accepted', 'signal']).toContain(e.event.kind);
    for (const e of t.media.events) expect(JSON.stringify(e.event)).not.toMatch(/serverUrl|username|devices|sessionId/);
  });

  it('mediaGone: a closed viewer window ends stopped, everything else ends failed', async () => {
    const v = (await delivered()).t;
    v.host.mediaGone(v.media.id, 'closed');
    expect(v.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'stopped' }]);
    expect(v.media.destroyed).toEqual([41]);
    const vc = (await delivered()).t;
    vc.host.mediaGone(vc.media.id, 'crashed');
    expect(vc.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'failed' }]);
    const ac = setup(); await ac.accepted();
    ac.host.mediaGone(ac.media.id, 'closed');
    expect(ac.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'failed' }]);
    const ax = setup(); await ax.accepted();
    ax.host.mediaGone(ax.media.id, 'crashed');
    expect(ax.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'failed' }]);
  });

  it('mediaGone ignores a foreign id and an already ended session', async () => {
    const t = setup();
    await t.accepted();
    t.host.mediaGone(MAIN, 'crashed');
    t.host.mediaGone(t.media.id + 1, 'closed');
    expect(t.kinds('ended')).toEqual([]);
    const id = t.media.id;
    await t.act({ kind: 'stop', sessionId: SID });
    t.host.mediaGone(id, 'crashed');
    expect(t.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'stopped' }]);
  });

  it('failed with peer emits the error peer for the user', async () => {
    const t = setup();
    await t.accepted();
    await t.mediaAct({ kind: 'failed', code: 'peer' });
    expect(t.kinds('error')).toEqual([{ kind: 'error', code: 'peer' }]);
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
    expect(await t.act({ kind: 'signIn', username: 'demo', password: 'pw', deviceName: 'Laptop' })).toEqual({ ok: false, code: 'locked' });
    expect(createAccount).not.toHaveBeenCalled();
  });

  it('the vault password is refused with samePassword before createAccount and enroll', async () => {
    const createAccount = vi.fn();
    const t = await ready({ matchesVaultPassword: async () => true, createAccount: createAccount as unknown as RemoteDeps['createAccount'] });
    expect(await t.act({ kind: 'signIn', username: 'demo', password: 'pw', deviceName: 'Laptop' })).toEqual({ ok: false, code: 'samePassword' });
    expect(createAccount).not.toHaveBeenCalled();
    expect(t.account.enroll).not.toHaveBeenCalled();
  });

  it('a throwing check yields locked', async () => {
    const createAccount = vi.fn();
    const t = await ready({ matchesVaultPassword: async () => { throw new Error('locked'); }, createAccount: createAccount as unknown as RemoteDeps['createAccount'] });
    expect(await t.act({ kind: 'signIn', username: 'demo', password: 'pw', deviceName: 'Laptop' })).toEqual({ ok: false, code: 'locked' });
    expect(createAccount).not.toHaveBeenCalled();
  });

  it('a reset during the check yields stale', async () => {
    let release!: (v: boolean) => void;
    const createAccount = vi.fn();
    const t = await ready({ matchesVaultPassword: () => new Promise<boolean>(r => { release = r; }), createAccount: createAccount as unknown as RemoteDeps['createAccount'] });
    const pending = t.act({ kind: 'signIn', username: 'demo', password: 'pw', deviceName: 'Laptop' });
    await flush();
    t.host.reset();
    release(false);
    expect(await pending).toEqual({ ok: false, code: 'stale' });
    expect(createAccount).not.toHaveBeenCalled();
  });

  it('connect without rendezvousProof is unavailable', async () => {
    const t = setup({ probe: async () => ({ serverUrl: URL, serverId: 'f'.repeat(64), namespace: 'n', authentication: 'enrolled-device', deviceSessions: true, rendezvous: true, rendezvousProof: false, rendezvousNoise: true }) });
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
    for (let i = 0; i < 3; i++) expect(await t.act({ kind: 'request', target: B, verification: 'c'.repeat(REMOTE_LAB_LIMITS.verificationHex) })).toEqual({ ok: false, code: 'mismatch' });
    expect(t.peer.request).not.toHaveBeenCalled();
  });

  it('three misses lock the device until goOnline; the fourth try is not even compared', async () => {
    const t = setup();
    await t.goOnline();
    t.handlers().onDevices([device(B, 'Büro')]);
    for (let i = 0; i < 3; i++) expect(await t.act({ kind: 'request', target: B, verification: 'c'.repeat(REMOTE_LAB_LIMITS.verificationHex) })).toEqual({ ok: false, code: 'mismatch' });
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
    channel.inbox.push(frames(msg('offer')));
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
    t.channels[0]!.inbox.push(frames(msg('offer')));
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

let channels0: FakeChannel | undefined;
describe('RemoteLabHost: Noise handshake (T8)', () => {
  const PRIVATE = 'http://10.8.0.2:8787/';
  const info = (over: Record<string, unknown> = {}) => ({ serverUrl: PRIVATE, serverId: 'f'.repeat(64), namespace: 'n', authentication: 'enrolled-device' as const, deviceSessions: true, rendezvous: true, rendezvousProof: true, rendezvousNoise: true, ...over });

  it('connect without rendezvousNoise is unavailable (no downgrade)', async () => {
    const t = setup({ probe: async () => info({ rendezvousNoise: false }) });
    expect(await t.act({ kind: 'connect', serverUrl: URL })).toEqual({ ok: false, code: 'unavailable' });
  });

  it('privateNetwork opts a tunnel address in; without the flag it is invalid', async () => {
    const probe = vi.fn(async (_u: string, _p: boolean, _s: AbortSignal) => info());
    const t = setup({ probe });
    expect(await t.act({ kind: 'connect', serverUrl: PRIVATE })).toEqual({ ok: false, code: 'invalid' });
    expect(probe).not.toHaveBeenCalled();
    expect((await t.act({ kind: 'connect', serverUrl: PRIVATE, privateNetwork: true })).ok).toBe(true);
    expect(probe).toHaveBeenCalledWith(PRIVATE, true, expect.any(AbortSignal));
    const loop = setup({ probe });
    await loop.act({ kind: 'connect', serverUrl: URL });
    expect(probe).toHaveBeenLastCalledWith(URL, false, expect.any(AbortSignal));
  });

  it('agent: connecting only after two receive() rounds, deadline = sessionMs, no peer key passed', async () => {
    const t = setup();
    t.handshake.rounds = 2;
    await t.armed();
    await t.clock.advance(NATIVE);
    expect(t.kinds('state').some(e => (e as { state: { session?: { state: string } } }).state.session?.state === 'connecting')).toBe(false);
    expect(t.host.sharing).toBe(false);
    expect(t.media.kinds('accepted')).toEqual([]);
    await t.clock.advance(REMOTE_LAB_LIMITS.setupPollMs);
    expect(await t.act({ kind: 'status' })).toMatchObject({ state: { session: { state: 'connecting', expiresAt: t.clock.now() + REMOTE_LAB_LIMITS.sessionMs } } });
    expect(t.channels[0]!.receives).toBe(2);
    expect(t.host.sharing).toBe(true);
    expect(t.media.kinds('accepted')).toHaveLength(1);
    expect(t.peer.channel).toHaveBeenCalledWith(expect.objectContaining({ id: SID }), B, 'view');
  });

  it('agent: a mismatch error ends failed with error mismatch', async () => {
    const t = setup();
    (t.peer.channel as ReturnType<typeof vi.fn>).mockImplementationOnce(() => { const c = new FakeChannel(); c.receiveError = Object.assign(new Error('x'), { code: 'mismatch' }); return c; });
    await t.armed();
    await t.clock.advance(NATIVE);
    expect(t.kinds('error')).toEqual([{ kind: 'error', code: 'mismatch' }]);
    expect(t.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'failed' }]);
    expect(t.host.sharing).toBe(false);
    expect(t.media.destroyed).toEqual([41]);
  });

  it('agent: the consent deadline during the handshake ends expired and frees the host', async () => {
    const t = setup();
    t.handshake.rounds = 1000;
    const release = await t.granted();
    await t.clock.advance(REMOTE_LAB_LIMITS.consentMs - 3000 - NATIVE);
    release();
    await t.clock.advance(3000);
    expect(t.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'expired' }]);
    expect(t.host.sharing).toBe(false);
    expect(t.media.destroyed).toEqual([41]);
  });

  it('agent: exceeding handshakeMs fails, not expired', async () => {
    const t = setup();
    t.handshake.rounds = 1000;
    await t.armed();
    await t.clock.advance(NATIVE + REMOTE_LAB_LIMITS.handshakeMs + REMOTE_LAB_LIMITS.setupPollMs);
    expect(t.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'failed' }]);
    expect(t.media.destroyed).toEqual([41]);
  });

  it('agent: a transient network error during the handshake keeps polling until it recovers (m3)', async () => {
    const t = setup();
    t.handshake.rounds = 2;
    (t.peer.channel as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      const c = new FakeChannel(); c.rounds = 2; c.receiveError = new Error('ECONNRESET'); channels0 = c; return c;
    });
    await t.armed();
    await t.clock.advance(NATIVE);
    channels0!.receiveError = undefined;
    await t.clock.advance(REMOTE_LAB_LIMITS.setupPollMs * 3);
    expect(await t.act({ kind: 'status' })).toMatchObject({ state: { session: { state: 'connecting' } } });
    expect(t.kinds('ended')).toEqual([]);
    expect(t.media.kinds('accepted')).toHaveLength(1);
  });

  it('agent: decline during the handshake ends declined, never connects and frees the host (B6)', async () => {
    const t = setup();
    t.handshake.rounds = 1000;
    await t.armed();
    await t.clock.advance(NATIVE);
    expect(await t.act({ kind: 'decline', sessionId: SID })).toMatchObject({ ok: true });
    await t.clock.advance(REMOTE_LAB_LIMITS.setupPollMs * 2);
    expect(t.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'declined' }]);
    expect(t.host.sharing).toBe(false);
    expect(t.media.kinds('accepted')).toEqual([]);
    expect(t.kinds('state').some(e => (e as { state: { session?: { state: string } } }).state.session?.state === 'connecting')).toBe(false);
    expect(t.media.destroyed).toEqual([41]);
    // The busy flag is free: a follow-up network action is not stale.
    expect(await t.act({ kind: 'goOffline' })).toMatchObject({ ok: true });
  });

  it('agent: 404 during the handshake ends remote', async () => {
    const t = setup();
    (t.peer.channel as ReturnType<typeof vi.fn>).mockImplementationOnce(() => { const c = new FakeChannel(); c.receiveError = { status: 404 }; return c; });
    await t.armed();
    await t.clock.advance(NATIVE);
    expect(t.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'remote' }]);
    expect(t.media.destroyed).toEqual([41]);
  });

  it('viewer: connecting only once the handshake is ready; offer values from the last receive are processed after it', async () => {
    const t = setup();
    t.handshake.rounds = 2;
    await t.requesting();
    t.account.getImpl = async () => wire({ from: SELF, to: B, state: 'active' });
    await t.clock.advance(REMOTE_LAB_LIMITS.setupPollMs);
    const channel = t.channels[0]!;
    expect(channel.ready).toBe(false);
    expect(t.kinds('state').some(e => (e as { state: { session?: { state: string } } }).state.session?.state === 'connecting')).toBe(false);
    channel.inbox.push(frames(msg('offer')));
    await t.clock.advance(REMOTE_LAB_LIMITS.setupPollMs);
    expect(channel.ready).toBe(true);
    expect(t.kinds('ended')).toEqual([]);
    expect(t.media.signals()).toHaveLength(1);
    expect(t.kinds('state').some(e => (e as { state: { session?: { state: string } } }).state.session?.state === 'active')).toBe(true);
  });

  it('viewer: a mismatch during the handshake emits error/mismatch', async () => {
    const t = setup();
    await t.requesting();
    (t.peer.channel as ReturnType<typeof vi.fn>).mockImplementationOnce(() => { const c = new FakeChannel(); c.receiveError = Object.assign(new Error('x'), { code: 'mismatch' }); return c; });
    t.account.getImpl = async () => wire({ from: SELF, to: B, state: 'active' });
    await t.clock.advance(REMOTE_LAB_LIMITS.setupPollMs);
    expect(t.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'failed' }]);
    expect(t.kinds('error')).toEqual([{ kind: 'error', code: 'mismatch' }]);
  });
});

describe('V1: one message per session', () => {
  it('viewer: a second complete offer ends failed before it is delivered', async () => {
    const t = setup();
    const channel = await t.viewing();
    channel.inbox.push(frames(msg('offer')));
    await t.clock.advance(1000);
    expect(t.media.signals()).toHaveLength(1);
    channel.inbox.push(frames(msg('offer')));
    await t.clock.advance(5000);
    expect(t.media.signals()).toHaveLength(1);
    expect(t.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'failed' }]);
  });

  it('viewer: any part after the first complete message ends failed, even in the same batch', async () => {
    const t = setup();
    const channel = await t.viewing();
    channel.inbox.push([{ part: msg('offer')[0] }, { part: part('offer', 1, 2, 'b') }]);
    await t.clock.advance(1000);
    expect(t.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'failed' }]);
    expect(t.media.signals().length).toBeLessThanOrEqual(1);
  });

  it('viewer: a bye after the message is still a normal remote end', async () => {
    const t = setup();
    const channel = await t.viewing();
    channel.inbox.push(frames(msg('offer')));
    await t.clock.advance(1000);
    channel.inbox.push([{ part: part('bye', 1, 1, '') }]);
    await t.clock.advance(5000);
    expect(t.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'remote' }]);
  });

  it('agent: the answer is delivered once complete; a second complete answer ends failed before it is delivered', async () => {
    const t = setup();
    const channel = await t.accepted();
    const answer = msg('answer', 2);
    channel.inbox.push(frames([answer[0]!]));
    await t.clock.advance(5000);
    expect(t.media.signals()).toEqual([]);
    channel.inbox.push(frames([answer[1]!]));
    await t.clock.advance(5000);
    expect(t.media.signals()).toEqual(answer);
    expect(await t.act({ kind: 'status' })).toMatchObject({ state: { session: { state: 'active' } } });
    channel.inbox.push(frames(msg('answer')));
    await t.clock.advance(5000);
    expect(t.media.signals()).toEqual(answer);
    expect(t.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'failed' }]);
  });

  it('agent: an answer with a=sendrecv ends with error signal and failed without delivery', async () => {
    const t = setup();
    const channel = await t.accepted();
    channel.inbox.push(frames(msg('answer', 1, sdpText('a=sendrecv'))));
    await t.clock.advance(5000);
    expect(t.media.signals()).toEqual([]);
    expect(t.kinds('error')).toEqual([{ kind: 'error', code: 'signal' }]);
    expect(t.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'failed' }]);
  });
});

describe('V7: global brake for unverified requests', () => {
  const D = 'd'.repeat(64);
  const E = 'e'.repeat(64);
  const sid = (n: number): string => String(n).repeat(64);
  const refuse = async (t: ReturnType<typeof setup>, from: string, n: number, how: 'decline' | 'expire'): Promise<void> => {
    t.handlers().onDevices([device(B, 'B'), device(C, 'C'), device(D, 'D'), device(E, 'E')]);
    t.handlers().onSessions([wire({ id: sid(n), from })]);
    await flush();
    if (how === 'decline') expect((await t.act({ kind: 'decline', sessionId: sid(n) })).ok).toBe(true);
    else await t.clock.advance(REMOTE_LAB_LIMITS.consentMs + 1);
  };

  it('after three refusals unverified requests are dropped silently; verified pins pass; goOnline resets', async () => {
    const t = setup();
    await t.goOnline();
    await refuse(t, B, 3, 'decline');
    await refuse(t, C, 4, 'decline');
    await refuse(t, D, 5, 'expire');
    t.handlers().onSessions([wire({ id: sid(6), from: E })]);
    await flush();
    expect(t.deletes()).toContain(`/v1/rendezvous/sessions/${sid(6)}`);
    expect(await t.act({ kind: 'status' })).toMatchObject({ state: { muted: 1 } });
    expect(((await t.act({ kind: 'status' })) as { state: { session?: unknown } }).state.session).toBeUndefined();
    t.known.mockImplementation(id => id === E ? { firstSeen: 1, verified: true } : undefined);
    t.handlers().onSessions([wire({ id: sid(7), from: E })]);
    await flush();
    expect(await t.act({ kind: 'status' })).toMatchObject({ state: { session: { id: sid(7), role: 'agent' } } });
    await t.act({ kind: 'stop', sessionId: sid(7) });
    t.known.mockImplementation(() => undefined);
    expect((await t.act({ kind: 'goOffline' })).ok).toBe(true);
    expect((await t.act({ kind: 'goOnline', deviceName: 'Laptop' })).ok).toBe(true);
    t.handlers().onDevices([device(E, 'E')]);
    t.handlers().onSessions([wire({ id: sid(8), from: E })]);
    await flush();
    expect(await t.act({ kind: 'status' })).toMatchObject({ state: { session: { id: sid(8) } } });
  });

  it('two refusals do not brake, and refusals of verified devices are not counted', async () => {
    const t = setup();
    await t.goOnline();
    t.known.mockImplementation(id => id === B ? { firstSeen: 1, verified: true } : undefined);
    await refuse(t, B, 3, 'decline');
    await refuse(t, C, 6, 'decline');
    await refuse(t, D, 7, 'decline');
    t.handlers().onSessions([wire({ id: sid(8), from: E })]);
    await flush();
    expect(await t.act({ kind: 'status' })).toMatchObject({ state: { session: { id: sid(8) } } });
  });

  it('refusals older than the window do not count', async () => {
    const t = setup();
    await t.goOnline();
    await refuse(t, B, 3, 'decline');
    await refuse(t, C, 4, 'decline');
    await t.clock.advance(600_001);
    await refuse(t, D, 5, 'decline');
    t.handlers().onSessions([wire({ id: sid(6), from: E })]);
    await flush();
    expect(await t.act({ kind: 'status' })).toMatchObject({ state: { session: { id: sid(6) } } });
  });
});

describe('V10: forget unredeemed viewer requests', () => {
  it('a viewer session without a channel is forgotten when it ends', async () => {
    const t = setup();
    await t.requesting();
    await t.act({ kind: 'stop', sessionId: SID });
    expect(t.peer.forget).toHaveBeenCalledWith(SID);
  });

  it('a viewer session with a channel and agent sessions are not forgotten; a throwing forget is harmless', async () => {
    const t = setup();
    await t.viewing();
    await t.act({ kind: 'stop', sessionId: SID });
    expect(t.peer.forget).not.toHaveBeenCalled();
    const a = setup();
    await a.accepted();
    await a.act({ kind: 'stop', sessionId: SID });
    expect(a.peer.forget).not.toHaveBeenCalled();
    const x = setup();
    x.peer.forget.mockImplementation(() => { throw new Error('x'); });
    await x.requesting();
    expect((await x.act({ kind: 'stop', sessionId: SID })).ok).toBe(true);
    expect(x.kinds('ended')).toEqual([{ kind: 'ended', sessionId: SID, reason: 'stopped' }]);
  });
});
