import type { SyncDevice } from './vault-sync-crypto';
import { describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync, verify } from 'node:crypto';
import { SyncLabHost, weakEd25519 } from './lab-host';
import type { AccountDriver, DeviceEntry } from './lab-host';
import { generateRemoteIdentity } from '../remote/identity';
import type { RemoteIdentity, RemoteIdentityStore } from '../remote/identity';
const clientId = '123e4567-e89b-42d3-a456-426614174000';
const otherId = '123e4567-e89b-42d3-a456-426614174001';
const serverId = 'a'.repeat(64);
const infoOf = async (serverUrl: string) => ({ serverUrl, serverId, namespace: 'space', authentication: 'enrolled-device' as const, deviceSessions: true, invites: true, objectEpochs: true, enrollment: 'password' as const });
const url = 'https://sync.example.net';
const connectCommand = { kind: 'connect', clientId, serverUrl: url };
const signInCommand = { kind: 'signIn', clientId, username: 'alice', password: 'PRIVATE_PASSWORD', deviceName: 'Laptop' };
const entryOf = (identity: RemoteIdentity, extra: Partial<DeviceEntry> = {}): DeviceEntry => ({ id: identity.id, name: 'Laptop', signingKey: identity.signingPublicKey, enrolledAt: 1, enrolledBy: null, revokedAt: null, ephemeral: false, ...extra });
/** Identity store fake; enrollment starts empty unless given. */
const storeOf = (identity = generateRemoteIdentity(), enrollment?: unknown, persistent = true) => {
  const origin = (u: string) => new URL(u).origin;
  const known = enrollment as { serverUrl: string } | undefined;
  type Pin = { id: string; signingKey: string; revokedAt: number | null; enrolledBy: string | null; acknowledged: boolean };
  let pinned: { pins: Pin[]; at: number | null } | undefined = known ? { pins: [], at: null } : undefined;
  // Same semantics as the real store: the entry matches by origin, an entry of another origin is "elsewhere".
  const store = { load: vi.fn(() => ({ identity, persistent })),
    enrollment: vi.fn((_id: string, serverUrl: string) => known && origin(known.serverUrl) === origin(serverUrl) ? enrollment : undefined),
    enrolledElsewhere: vi.fn((_id: string, serverUrl: string) => known && origin(known.serverUrl) !== origin(serverUrl) ? known.serverUrl : undefined),
    // Pinned roster like the real store: present with an enrollment, empty (at null) until the first roster was seen.
    rememberEnrollment: vi.fn(() => { pinned = { pins: [], at: null }; }), forgetEnrollment: vi.fn(),
    rosterOf: vi.fn(() => pinned && { pins: pinned.pins.map(p => ({ ...p })), at: pinned.at }),
    rememberRoster: vi.fn((_id: string, _url: string, pins: Pin[], at: number) => { pinned = { pins: pins.map(p => ({ ...p })), at }; }) };
  return { identity, store, asStore: store as unknown as RemoteIdentityStore };
};
const accountOf = (identity: RemoteIdentity, over: Partial<Record<keyof AccountDriver, unknown>> = {}) => ({
  enroll: vi.fn(async () => ({})), enrollWithInvite: vi.fn(async () => ({ username: 'alice' })), invite: vi.fn(async () => ({ expiresAt: Date.now() + 600000 })), openSession: vi.fn(async () => ({ signedIn: true as const, expiresAt: Date.now() + 600000, device: identity.id })),
  devices: vi.fn(async () => [entryOf(identity)]), revoke: vi.fn(async () => ({ revoked: true })), list: vi.fn(async () => []), close: vi.fn(), ...over,
}) as unknown as AccountDriver & { [K in keyof AccountDriver]: AccountDriver[K] & ReturnType<typeof vi.fn> };
const enrolledOf = (over: Record<string, unknown> = {}) => ({ serverId, namespace: 'space', serverUrl: `${url}/`, username: 'alice', name: 'Laptop', enrolledAt: 1, ...over });
const sync = { status: 'synced' as const, versions: 1, conflicts: 0, canKeepLocal: false, approvals: 0 };
/** Host with injected fakes; `connected` runs connect and (optionally) sign-in. */
const harness = (opts: { enrollment?: unknown; persistent?: boolean; account?: Partial<Record<keyof AccountDriver, unknown>>; syncVault?: (...a: any[]) => Promise<any>; matches?: (p: string) => Promise<boolean | undefined>; info?: (u: string) => Promise<any> } = {}) => {
  const ids = storeOf(undefined, opts.enrollment, opts.persistent);
  const account = accountOf(ids.identity, opts.account);
  const createAccount = vi.fn(() => account);
  const host = new SyncLabHost(opts.info ?? infoOf, createAccount, opts.syncVault as never, opts.matches, () => ids.asStore);
  const signedIn = async () => { await host.connect(1, connectCommand); return host.signIn(1, signInCommand); };
  return { host, account, createAccount, ...ids, signedIn };
};
describe('development lab ownership boundary', () => {
  it('allows conflict resolution only after sign-in, for the owning dialog and the reviewed revision', async () => {
    const revision = 'c'.repeat(64);
    const syncVault = vi.fn(async () => ({ ...sync, status: 'conflict' as const, versions: 3, conflicts: 1, canKeepLocal: true, conflictRevision: revision }));
    const { host } = harness({ syncVault });
    await host.connect(1, connectCommand);
    expect(await host.performSync(1, { kind: 'synchronize', clientId })).toEqual({ ok: false, code: 'stale' });
    await host.signIn(1, signInCommand);
    expect(await host.performSync(2, { kind: 'synchronize', clientId })).toEqual({ ok: false, code: 'stale' });
    expect(await host.performSync(1, { kind: 'keepLocal', clientId, reviewed: true, revision })).toEqual({ ok: false, code: 'invalid' });
    expect(syncVault).not.toHaveBeenCalled();
    expect(await host.performSync(1, { kind: 'synchronize', clientId })).toMatchObject({ ok: true, state: { sync: { conflictRevision: revision } } });
    expect(await host.performSync(1, { kind: 'keepLocal', clientId, reviewed: false, revision })).toEqual({ ok: false, code: 'invalid' });
    expect(await host.performSync(1, { kind: 'keepLocal', clientId, reviewed: true, revision: 'd'.repeat(64) })).toEqual({ ok: false, code: 'invalid' });
    expect(syncVault).toHaveBeenCalledOnce();
    expect(await host.performSync(1, { kind: 'keepLocal', clientId, reviewed: true, revision })).toMatchObject({ ok: true });
    expect(syncVault).toHaveBeenLastCalledWith(expect.any(Object), expect.any(Object), expect.any(AbortSignal), { kind: 'keepLocal', reviewed: true, revision }, expect.any(Object));
    host.reset();
  });
  it('keeps credentials and tokens out of replies, permits retry and closes the account with its owner', async () => {
    const enroll = vi.fn().mockRejectedValueOnce({ status: 401 }).mockResolvedValue({ token: 'MUST_NOT_LEAK' });
    const { host, account } = harness({ account: { enroll } });
    await host.connect(1, connectCommand);
    expect(await host.signIn(2, signInCommand)).toEqual({ ok: false, code: 'stale' });
    expect(enroll).not.toHaveBeenCalled();
    expect(await host.signIn(1, signInCommand)).toEqual({ ok: false, code: 'authentication' });
    expect(account.close).toHaveBeenCalledOnce();
    const reply = await host.signIn(1, signInCommand);
    expect(reply).toMatchObject({ ok: true, state: { account: { signedIn: true, username: 'alice' } } });
    expect(JSON.stringify(reply)).not.toMatch(/PRIVATE_PASSWORD|MUST_NOT_LEAK/);
    expect(account.list).toHaveBeenCalledOnce(); host.closeOwner(1); expect(account.close).toHaveBeenCalledTimes(2);
  });
  it('aborts sign-in on close and never exposes a completed canceled sign-in', async () => {
    let complete!: () => void; let signal!: AbortSignal;
    const ids = storeOf(); const account = accountOf(ids.identity, { enroll: () => new Promise<void>(resolve => { complete = resolve; }) });
    const host = new SyncLabHost(infoOf, ((_info: unknown, current: AbortSignal) => { signal = current; return account; }) as never, undefined, undefined, () => ids.asStore);
    await host.connect(1, connectCommand);
    const pending = host.signIn(1, signInCommand);
    expect(await host.signIn(1, signInCommand)).toEqual({ ok: false, code: 'stale' });
    await vi.waitFor(() => expect(complete).toBeDefined());
    host.closeOwner(1); expect(account.close).toHaveBeenCalled(); expect(signal.aborted).toBe(true);
    complete(); expect(await pending).toEqual({ ok: false, code: 'stale' });
    expect(host.request(1, { kind: 'status', clientId })).toEqual({ ok: false, code: 'stale' });
  });
  it('is unavailable unless probe, account and identity were wired', () => {
    expect(new SyncLabHost().enabled).toBe(false);
    expect(new SyncLabHost(infoOf).enabled).toBe(false);
    expect(new SyncLabHost().request(1, { kind: 'status', clientId })).toEqual({ ok: false, code: 'unavailable' });
    expect(harness().host.enabled).toBe(true);
  });
  it('answers the removed pairing requests with invalid (A4)', () => {
    const { host } = harness();
    for (const kind of ['start', 'requestAccess', 'refreshAccess', 'confirm', 'resolve']) expect(host.request(1, { kind, clientId })).toEqual({ ok: false, code: 'invalid' });
    expect(host.request(1, { kind: 'status', clientId, extra: 'forbidden' })).toEqual({ ok: false, code: 'invalid' });
  });
  it('connects only an explicitly selected safe URL and keeps the result scoped to its dialog', async () => {
    const { host } = harness();
    expect(await host.connect(1, { kind: 'connect', clientId, serverUrl: 'http://192.168.1.2' })).toEqual({ ok: false, code: 'invalid' });
    const reply = await host.connect(1, connectCommand);
    expect(reply).toMatchObject({ ok: true, state: { phase: 'serverReady', server: { serverUrl: 'https://sync.example.net/' }, identity: { persistent: true } } });
    expect(host.request(2, { kind: 'status', clientId })).toEqual({ ok: false, code: 'stale' });
    host.request(1, { kind: 'close', clientId: otherId });
    expect(host.request(1, { kind: 'status', clientId }).ok).toBe(true);
    host.closeOwner(1); expect(host.request(1, { kind: 'status', clientId }).ok).toBe(false);
  });
  it('aborts a pending server probe on close and never resurrects a canceled setup', async () => {
    let resolveProbe!: (value: Awaited<ReturnType<typeof infoOf>>) => void; let signal!: AbortSignal;
    const probe = vi.fn((_url: string, _private: boolean, current: AbortSignal) => { signal = current; return new Promise<Awaited<ReturnType<typeof infoOf>>>(resolve => { resolveProbe = resolve; }); });
    const host = new SyncLabHost(probe as never, ((() => accountOf(storeOf().identity)) as never), undefined, undefined, () => storeOf().asStore);
    const pending = host.connect(1, connectCommand);
    host.request(1, { kind: 'close', clientId }); expect(signal.aborted).toBe(true);
    resolveProbe(await infoOf(`${url}/`));
    expect(await pending).toEqual({ ok: false, code: 'stale' });
    expect(host.request(1, { kind: 'status', clientId }).ok).toBe(false);
  });
});

describe('connect and enrollment state', () => {
  it('requires enrolled-device authentication with device sessions', async () => {
    for (const info of [{ authentication: 'password' as const, deviceSessions: true }, { authentication: 'enrolled-device' as const, deviceSessions: undefined }, { authentication: 'device' as const, deviceSessions: true }]) {
      const { host, store } = harness({ info: async serverUrl => ({ ...(await infoOf(serverUrl)), ...info }) });
      expect(await host.connect(1, connectCommand)).toEqual({ ok: false, code: 'unavailable' });
      expect(store.load).not.toHaveBeenCalled();
      expect(host.request(1, { kind: 'status', clientId }).ok).toBe(false);
    }
  });
  it('drops the connection when the identity cannot be loaded', async () => {
    const ids = storeOf(); ids.store.load.mockImplementation(() => { throw Error('corrupt'); });
    const host = new SyncLabHost(infoOf, (() => accountOf(ids.identity)) as never, undefined, undefined, () => ids.asStore);
    expect(await host.connect(1, connectCommand)).toEqual({ ok: false, code: 'identity' });
    expect(host.request(1, { kind: 'status', clientId }).ok).toBe(false);
  });
  it('reports the enrollment for the same URL and namespace', async () => {
    const { host, store } = harness({ enrollment: enrolledOf() });
    const reply = await host.connect(1, connectCommand);
    expect(store.enrollment).toHaveBeenCalledWith(serverId, 'https://sync.example.net/');
    expect(reply).toMatchObject({ ok: true, state: { enrolled: { username: 'alice', name: 'Laptop' } } });
    expect((reply as { state: object }).state).not.toHaveProperty('enrolledElsewhere');
  });
  it('flags another URL with the same serverId as enrolledElsewhere and never opens a session (K10)', async () => {
    const { host, createAccount, account } = harness({ enrollment: enrolledOf({ serverUrl: 'https://old.example.net/' }) });
    const reply = await host.connect(1, connectCommand);
    expect(reply).toMatchObject({ ok: true, state: { enrolledElsewhere: 'https://old.example.net/' } });
    expect((reply as { state: object }).state).not.toHaveProperty('enrolled');
    expect(await host.openSession(1, { kind: 'openSession', clientId })).toEqual({ ok: false, code: 'stale' });
    expect(createAccount).not.toHaveBeenCalled(); expect(account.openSession).not.toHaveBeenCalled();
  });
});

describe('sign-in', () => {
  it('enrolls, opens a session, remembers the enrollment and loads the roster; clears enrolledElsewhere', async () => {
    const { host, account, store, identity } = harness({ enrollment: enrolledOf({ serverUrl: 'https://old.example.net/' }), persistent: false });
    await host.connect(1, connectCommand);
    const reply = await host.signIn(1, { ...signInCommand, confirmElsewhere: true });
    expect(account.enroll).toHaveBeenCalledWith(identity, { username: 'alice', password: 'PRIVATE_PASSWORD', name: 'Laptop', ephemeral: true });
    expect(store.rememberEnrollment).toHaveBeenCalledWith({ serverId, namespace: 'space', serverUrl: 'https://sync.example.net/', username: 'alice', name: 'Laptop', enrolledAt: expect.any(Number) });
    expect(reply).toMatchObject({ ok: true, state: { account: { signedIn: true, username: 'alice', device: { fingerprint: identity.id, name: 'Laptop', persistent: false } }, enrolled: { username: 'alice', name: 'Laptop' }, devices: [{ id: identity.id, self: true }] } });
    expect((reply as { state: object }).state).not.toHaveProperty('enrolledElsewhere');
    expect(JSON.stringify(reply)).not.toContain(identity.signingPublicKey);
  });
  it('maps 429 to limit, 401 to authentication, others to connection', async () => {
    for (const [status, code] of [[429, 'limit'], [401, 'authentication'], [409, 'connection'], [undefined, 'connection']] as const) {
      const { host, store } = harness({ account: { enroll: vi.fn(async () => { throw { status }; }) } });
      await host.connect(1, connectCommand);
      expect(await host.signIn(1, signInCommand)).toEqual({ ok: false, code });
      expect(store.rememberEnrollment).not.toHaveBeenCalled();
    }
  });
  it('treats the enrollment as known when the sign-in fails after it was remembered', async () => {
    const { host, store } = harness({ account: { list: vi.fn(async () => { throw { status: 500 }; }) } });
    await host.connect(1, connectCommand);
    expect(await host.signIn(1, signInCommand)).toEqual({ ok: false, code: 'connection' });
    expect(store.rememberEnrollment).toHaveBeenCalled();
    expect(host.request(1, { kind: 'status', clientId })).toMatchObject({ ok: true, state: { enrolled: { username: 'alice', name: 'Laptop' } } });
  });
  it('rejects a device name with control characters or a bad length without contacting the server', async () => {
    const { host, createAccount } = harness();
    await host.connect(1, connectCommand);
    for (const deviceName of ['bad\nname', 'tab\there', '', 'x'.repeat(81), '\u007f'])
      expect(await host.signIn(1, { ...signInCommand, deviceName })).toEqual({ ok: false, code: 'invalid' });
    expect(createAccount).not.toHaveBeenCalled();
  });
});

describe('session handling', () => {
  const opened = async (over: Parameters<typeof harness>[0] = {}) => {
    const h = harness({ enrollment: enrolledOf(), ...over });
    await h.host.connect(1, connectCommand);
    return h;
  };
  const open = { kind: 'openSession', clientId };
  it('opens a session without a password for an enrolled device', async () => {
    const { host, account, identity } = await opened();
    const reply = await host.openSession(1, open);
    expect(account.openSession).toHaveBeenCalledWith(identity);
    expect(account.enroll).not.toHaveBeenCalled(); expect(account.list).toHaveBeenCalledOnce();
    expect(reply).toMatchObject({ ok: true, state: { account: { signedIn: true, username: 'alice', device: { name: 'Laptop' } }, enrolled: { username: 'alice' } } });
    expect(await host.openSession(1, open)).toEqual({ ok: false, code: 'stale' }); // Already signed in.
  });
  it('requires an enrollment', async () => {
    const h = harness(); await h.host.connect(1, connectCommand);
    expect(await h.host.openSession(1, open)).toEqual({ ok: false, code: 'stale' });
  });
  it('retries a 401 once with a new openSession call; the enrollment stays on success', async () => {
    const good = { signedIn: true, expiresAt: Date.now() + 600000, device: 'x' };
    const openSession = vi.fn().mockRejectedValueOnce({ status: 401 }).mockResolvedValue(good);
    const { host, store } = await opened({ account: { openSession } });
    expect(await host.openSession(1, open)).toMatchObject({ ok: true });
    expect(openSession).toHaveBeenCalledTimes(2); expect(store.forgetEnrollment).not.toHaveBeenCalled();
  });
  it('forgets the enrollment after a second 401 (B6)', async () => {
    const openSession = vi.fn(async () => { throw { status: 401 }; });
    const { host, store } = await opened({ account: { openSession } });
    const reply = await host.openSession(1, open);
    expect(reply).toMatchObject({ ok: false, code: 'authentication' });
    expect(openSession).toHaveBeenCalledTimes(2);
    expect(store.forgetEnrollment).toHaveBeenCalledWith(serverId, 'https://sync.example.net/');
    expect(host.request(1, { kind: 'status', clientId })).toMatchObject({ ok: true });
    expect(JSON.stringify(host.request(1, { kind: 'status', clientId }))).not.toContain('"enrolled"');
  });
  it('keeps the enrollment when a server action answers 401 and drops only the session', async () => {
    const syncVault = vi.fn(async () => { throw { status: 401 }; });
    const { host, store, account } = await opened({ syncVault });
    await host.openSession(1, open);
    const reply = await host.performSync(1, { kind: 'synchronize', clientId });
    expect(reply).toMatchObject({ ok: false, code: 'authentication', state: { enrolled: { username: 'alice', name: 'Laptop' } } });
    expect((reply as { state: object }).state).not.toHaveProperty('account');
    expect(account.close).toHaveBeenCalled(); expect(store.forgetEnrollment).not.toHaveBeenCalled();
    expect(await host.performSync(1, { kind: 'synchronize', clientId })).toEqual({ ok: false, code: 'stale' });
    expect(await host.openSession(1, open)).toMatchObject({ ok: true }); // A new session needs no password.
  });
  it('renews the session at expiresAt minus 60 s before a server action', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1_000_000);
    try {
      const openSession = vi.fn(async () => ({ signedIn: true as const, expiresAt: Date.now() + 300_000, device: 'x' }));
      const syncVault = vi.fn(async () => sync);
      const { host } = await opened({ account: { openSession }, syncVault });
      await host.openSession(1, open); expect(openSession).toHaveBeenCalledTimes(1);
      vi.setSystemTime(1_000_000 + 239_999);
      await host.performSync(1, { kind: 'synchronize', clientId }); expect(openSession).toHaveBeenCalledTimes(1);
      vi.setSystemTime(1_000_000 + 240_000);
      await host.performSync(1, { kind: 'synchronize', clientId }); expect(openSession).toHaveBeenCalledTimes(2);
      await host.devices(1, { kind: 'listDevices', clientId }); expect(openSession).toHaveBeenCalledTimes(2); // New expiry is far away.
      vi.setSystemTime(1_000_000 + 240_000 + 240_000);
      await host.devices(1, { kind: 'listDevices', clientId }); expect(openSession).toHaveBeenCalledTimes(3);
    } finally { vi.useRealTimers(); }
  });
});

describe('sync actions', () => {
  const run = async (opts: Parameters<typeof harness>[0] = {}) => { const h = harness(opts); await h.signedIn(); return h; };
  it('hands syncVault a device whose keys come from a fresh roster', async () => {
    const other = generateRemoteIdentity();
    const seen: any[] = [];
    const syncVault = vi.fn(async (_a, _i, _s, _r, device) => { seen.push(device); return sync; });
    const h = harness({ syncVault }); await h.signedIn();
    h.account.devices.mockClear();
    h.account.devices.mockResolvedValue([entryOf(h.identity), entryOf(other, { name: 'Other', revokedAt: 77 })]);
    await h.host.performSync(1, { kind: 'synchronize', clientId });
    expect(h.account.devices).toHaveBeenCalledOnce();
    const device = seen[0]; expect(device.id).toBe(h.identity.id);
    expect(device.revokedAt(other.id)).toBe(77); expect(device.revokedAt(h.identity.id)).toBeNull(); expect(device.revokedAt('f'.repeat(64))).toBeUndefined();
    const data = Buffer.from('payload');
    expect(verify(null, data, device.keyOf(h.identity.id), device.sign(data))).toBe(true);
    expect(device.keyOf(other.id)).toBeDefined(); expect(device.keyOf('f'.repeat(64))).toBeUndefined();
    // A later run reads the new roster again; a revoked device the server drops stays pinned with its revocation (B8).
    h.account.devices.mockResolvedValue([entryOf(h.identity)]);
    await h.host.performSync(1, { kind: 'synchronize', clientId });
    expect(seen[1].keyOf(other.id)).toBeDefined(); expect(seen[1].revokedAt(other.id)).toBe(77);
  });
  it('ends with connection when the own roster entry is missing or carries another key (B3)', async () => {
    const syncVault = vi.fn(async () => sync);
    const h = await run({ syncVault });
    const foreignKey = generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
    for (const roster of [[], [entryOf(h.identity, { signingKey: foreignKey })], [entryOf(generateRemoteIdentity())]]) {
      h.account.devices.mockResolvedValue(roster);
      expect(await h.host.performSync(1, { kind: 'synchronize', clientId })).toEqual({ ok: false, code: 'connection' });
    }
    expect(syncVault).not.toHaveBeenCalled();
  });
  it('does not pass a device (or load the strict roster) for removeForeign', async () => {
    const syncVault = vi.fn()
      .mockResolvedValueOnce({ ...sync, foreign: ['f'.repeat(64)] }).mockResolvedValueOnce({ removedForeign: 1 });
    const h = await run({ syncVault });
    await h.host.performSync(1, { kind: 'synchronize', clientId });
    h.account.devices.mockClear(); h.account.devices.mockResolvedValue([]);
    expect(await h.host.performSync(1, { kind: 'removeForeign', clientId })).toMatchObject({ ok: true });
    expect(syncVault).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), expect.any(AbortSignal), { kind: 'removeForeign', ids: ['f'.repeat(64)] }, undefined);
    expect(h.account.devices).not.toHaveBeenCalled();
  });
  it('returns the recovery code only in the one reply and never in state, status or later replies (K13)', async () => {
    const code = '0123456789abcdef0123456789abcdef';
    const syncVault = vi.fn()
      .mockResolvedValueOnce({ ...sync, recoveryCode: code, unknownAuthors: 2, quarantined: 1 })
      .mockResolvedValueOnce({ recoveryCode: 'f'.repeat(32) }).mockResolvedValueOnce(sync);
    const h = await run({ syncVault });
    const first = await h.host.performSync(1, { kind: 'synchronize', clientId }) as { state: { sync: object }; recoveryCode?: string };
    expect(first.recoveryCode).toBe(code);
    expect(first.state.sync).toEqual({ ...sync, unknownAuthors: 2, quarantined: 1 });
    expect(JSON.stringify(first.state)).not.toContain(code);
    expect(JSON.stringify(h.host.request(1, { kind: 'status', clientId }))).not.toContain(code);
    const regenerated = await h.host.performSync(1, { kind: 'rotateKey', clientId, confirmed: true }) as { state: unknown; recoveryCode?: string };
    expect(regenerated.recoveryCode).toBe('f'.repeat(32));
    expect(syncVault).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), expect.any(AbortSignal), { kind: 'rotateKey' }, expect.any(Object));
    expect(JSON.stringify(regenerated.state)).not.toContain('f'.repeat(32));
    expect(h.host.request(1, { kind: 'status', clientId })).toMatchObject({ ok: true, state: { sync: { unknownAuthors: 2 } } }); // sync unchanged by regenerate
    expect(JSON.stringify(h.host.request(1, { kind: 'status', clientId }))).not.toMatch(new RegExp(`${code}|${'f'.repeat(32)}`));
    const later = await h.host.performSync(1, { kind: 'synchronize', clientId });
    expect(later).not.toHaveProperty('recoveryCode');
  });
  it('normalizes a recovery code for synchronize and import, rejecting an invalid one before any call', async () => {
    const syncVault = vi.fn(async () => sync);
    const h = await run({ syncVault });
    expect(await h.host.performSync(1, { kind: 'importVault', clientId, password: 'OTHER-PASSWORD', recoveryCode: 'not a code' })).toEqual({ ok: false, code: 'invalid' });
    expect(await h.host.performSync(1, { kind: 'importVault', clientId, password: 'OTHER-PASSWORD', recoveryCode: 'x'.repeat(65) })).toEqual({ ok: false, code: 'invalid' });
    expect(await h.host.performSync(1, { kind: 'importVault', clientId, password: 'OTHER-PASSWORD' })).toEqual({ ok: false, code: 'invalid' });
    expect(await h.host.performSync(1, { kind: 'synchronize', clientId, recoveryCode: 'zzz' })).toEqual({ ok: false, code: 'invalid' });
    expect(syncVault).not.toHaveBeenCalled();
    const raw = '0123456789ABCDEF0123456789ABCDEF';
    await h.host.performSync(1, { kind: 'importVault', clientId, password: 'OTHER-PASSWORD', recoveryCode: raw });
    expect((syncVault.mock.calls as unknown[][])[0][3]).toEqual({ kind: 'importVault', password: 'OTHER-PASSWORD', recoveryCode: expect.stringMatching(/^[0-9a-f]{32}$/) });
    await h.host.performSync(1, { kind: 'synchronize', clientId, recoveryCode: raw });
    expect((syncVault.mock.calls as unknown[][])[1][3]).toEqual({ kind: 'synchronize', recoveryCode: expect.stringMatching(/^[0-9a-f]{32}$/) });
  });
  it('maps core error codes including the new ones, and HTTP 429/507 during sync to syncLimit', async () => {
    const errors: [unknown, string][] = [[{ code: 'syncKey' }, 'syncKey'], [{ code: 'recoveryCode' }, 'syncRecoveryCode'], [{ code: 'migrate' }, 'syncMigrate'], [{ code: 'recovery' }, 'syncRecovery'], [{ status: 429 }, 'syncLimit'], [{ status: 507 }, 'syncLimit'], [Error('x'), 'connection']];
    for (const [error, code] of errors) {
      const h = await run({ syncVault: async () => { throw error; } });
      expect(await h.host.performSync(1, { kind: 'synchronize', clientId })).toEqual({ ok: false, code });
    }
  });
  it('reports skipped objects in the state', async () => {
    const h = await run({ syncVault: async () => ({ ...sync, skipped: 2 }) });
    expect(await h.host.performSync(1, { kind: 'synchronize', clientId })).toMatchObject({ ok: true, state: { sync: { skipped: 2 } } });
  });
});

describe('device list', () => {
  const run = async () => { const h = harness({ syncVault: async () => sync }); await h.signedIn(); return h; };
  it('computes self locally and ignores the server flag', async () => {
    const h = await run(); const other = generateRemoteIdentity();
    h.account.devices.mockResolvedValue([{ ...entryOf(h.identity), self: false }, { ...entryOf(other, { name: 'Other' }), self: true }]);
    const reply = await h.host.devices(1, { kind: 'listDevices', clientId });
    expect((reply as any).state.devices).toEqual([
      { id: h.identity.id, name: 'Laptop', enrolledAt: 1, revokedAt: null, ephemeral: false, self: true, enrolledVia: 'password' },
      { id: other.id, name: 'Other', enrolledAt: 1, revokedAt: null, ephemeral: false, self: false, enrolledVia: 'password' },
    ]);
    expect(JSON.stringify(reply)).not.toContain('signingKey');
  });
  it('validates revoke ids, revokes another device and reloads the list; 404 is ok', async () => {
    const h = await run(); const other = generateRemoteIdentity();
    expect(await h.host.devices(1, { kind: 'revokeDevice', clientId, id: 'nothex' })).toEqual({ ok: false, code: 'invalid' });
    expect(h.account.revoke).not.toHaveBeenCalled();
    h.account.devices.mockClear();
    expect(await h.host.devices(1, { kind: 'revokeDevice', clientId, id: other.id })).toMatchObject({ ok: true, state: { phase: 'serverReady' } });
    expect(h.account.revoke).toHaveBeenCalledWith(h.identity, other.id); expect(h.account.devices).toHaveBeenCalledOnce();
    h.account.revoke.mockRejectedValueOnce({ status: 404 });
    expect(await h.host.devices(1, { kind: 'revokeDevice', clientId, id: other.id })).toMatchObject({ ok: true });
  });
  it('revoking itself forgets the enrollment, closes the connection and ends idle', async () => {
    const h = await run();
    expect(await h.host.devices(1, { kind: 'revokeDevice', clientId, id: h.identity.id })).toEqual({ ok: true, state: { phase: 'idle' } });
    expect(h.store.forgetEnrollment).toHaveBeenCalledWith(serverId, 'https://sync.example.net/'); expect(h.account.close).toHaveBeenCalled();
    expect(h.host.request(1, { kind: 'status', clientId }).ok).toBe(false);
  });
  it('needs a session and the owning dialog', async () => {
    const h = harness(); await h.host.connect(1, connectCommand);
    expect(await h.host.devices(1, { kind: 'listDevices', clientId })).toEqual({ ok: false, code: 'stale' });
    await h.host.signIn(1, signInCommand);
    expect(await h.host.devices(2, { kind: 'listDevices', clientId })).toEqual({ ok: false, code: 'stale' });
  });
});

describe('vault password separation', () => {
  const make = (matches: (p: string) => Promise<boolean | undefined>, enroll = vi.fn(async () => ({}))) => harness({ matches, account: { enroll } });
  it('rejects the vault password before sign-in', async () => {
    const { host, account } = make(async () => true);
    await host.connect(1, connectCommand);
    expect(await host.signIn(1, signInCommand)).toEqual({ ok: false, code: 'samePassword' });
    expect(account.enroll).not.toHaveBeenCalled();
  });
  it('signs in when the vault is locked (undefined) or the password differs', async () => {
    for (const result of [undefined, false]) {
      const { host, account } = make(async () => result);
      await host.connect(1, connectCommand);
      expect(await host.signIn(1, signInCommand)).toMatchObject({ ok: true });
      expect(account.enroll).toHaveBeenCalledOnce();
    }
  });
  it('ends with connection when the check throws', async () => {
    const { host, account } = make(async () => { throw Error('boom'); });
    await host.connect(1, connectCommand);
    expect(await host.signIn(1, signInCommand)).toEqual({ ok: false, code: 'connection' });
    expect(account.enroll).not.toHaveBeenCalled();
  });
  it('is stale when the connection changes during the check', async () => {
    let release!: (v: boolean) => void;
    const { host, account } = make(() => new Promise<boolean>(resolve => { release = resolve; }));
    await host.connect(1, connectCommand);
    const pending = host.signIn(1, signInCommand);
    host.closeOwner(1); release(false);
    expect(await pending).toEqual({ ok: false, code: 'stale' });
    expect(account.enroll).not.toHaveBeenCalled();
  });
});

describe('private network, import digest and foreign objects', () => {
  const code = '0123456789abcdef0123456789abcdef';
  const imp = (password: string, recoveryCode = code) => ({ kind: 'importVault', clientId, password, recoveryCode });
  const setup = async (syncVault: any, matches: (p: string) => Promise<boolean | undefined> = async () => undefined) => {
    const h = harness({ syncVault, matches }); await h.signedIn(); return h.host;
  };
  const signedPassword = signInCommand.password;
  it('passes privateNetwork to the probe and rejects tunnel HTTP without the flag', async () => {
    const probe = vi.fn(infoOf);
    const host = new SyncLabHost(probe, (() => accountOf(storeOf().identity)) as never, undefined, undefined, () => storeOf().asStore);
    expect(await host.connect(1, { kind: 'connect', clientId, serverUrl: 'http://10.0.0.5' })).toEqual({ ok: false, code: 'invalid' });
    expect(probe).not.toHaveBeenCalled();
    expect(await host.connect(1, { kind: 'connect', clientId, serverUrl: 'http://10.0.0.5', privateNetwork: true })).toMatchObject({ ok: true });
    expect(probe).toHaveBeenCalledWith('http://10.0.0.5/', true, expect.any(AbortSignal));
    host.reset();
    await host.connect(1, connectCommand);
    expect(probe).toHaveBeenLastCalledWith('https://sync.example.net/', false, expect.any(AbortSignal));
    host.reset();
  });
  it('rejects an import with the sign-in password (locked vault) and wipes the digest', async () => {
    const syncVault = vi.fn(async () => sync);
    const host = await setup(syncVault);
    expect(await host.performSync(1, imp(signedPassword))).toMatchObject({ ok: false, code: 'samePasswordImport' });
    expect(syncVault).not.toHaveBeenCalled();
    expect(await host.performSync(1, imp('OTHER-PASSWORD'))).toMatchObject({ ok: true });
    expect(syncVault).toHaveBeenCalledOnce();
  });
  it('rejects an invalid recovery code without a syncVault call', async () => {
    const syncVault = vi.fn(async () => sync);
    const host = await setup(syncVault);
    expect(await host.performSync(1, imp('OTHER-PASSWORD', 'nope'))).toEqual({ ok: false, code: 'invalid' });
    expect(syncVault).not.toHaveBeenCalled();
  });
  it('keeps the digest across failed attempts and wipes it after a successful import', async () => {
    const syncVault = vi.fn(async (_a: unknown, _i: unknown, _s: unknown, request: any) => request.password === 'OTHER-PASSWORD' ? { ...sync, snapshot: {} } : undefined);
    const host = await setup(syncVault);
    expect(await host.performSync(1, imp('WRONG-PASSWORD'))).toMatchObject({ ok: true });
    expect(await host.performSync(1, imp(signedPassword))).toMatchObject({ ok: false, code: 'samePasswordImport' });
    expect(await host.performSync(1, imp(signedPassword))).toMatchObject({ ok: false, code: 'samePasswordImport' });
    expect(syncVault).toHaveBeenCalledOnce();
    expect(await host.performSync(1, imp('OTHER-PASSWORD'))).toMatchObject({ ok: true });
    expect(await host.performSync(1, imp(signedPassword))).toMatchObject({ ok: true }); // digest wiped after success
  });
  it('compares NFKC-normalized', async () => {
    const syncVault = vi.fn(async () => undefined);
    const h = harness({ syncVault }); await h.host.connect(1, connectCommand);
    await h.host.signIn(1, { ...signInCommand, password: 'café-café' });
    expect(await h.host.performSync(1, imp('café-café'))).toMatchObject({ ok: false, code: 'samePasswordImport' });
    expect(syncVault).not.toHaveBeenCalled();
  });
  it('wipes the digest on close and reset', async () => {
    const fill = vi.spyOn(Buffer.prototype, 'fill');
    try {
      const h = harness(); const ready = async () => { await h.host.connect(1, connectCommand); await h.host.signIn(1, signInCommand); };
      await ready(); fill.mockClear(); h.host.request(1, { kind: 'close', clientId }); expect(fill).toHaveBeenCalledTimes(2);
      await ready(); fill.mockClear(); h.host.reset(); expect(fill).toHaveBeenCalledTimes(2);
      await ready(); fill.mockClear(); h.host.closeOwner(1); expect(fill).toHaveBeenCalledTimes(2);
    } finally { fill.mockRestore(); }
  });
  it('keeps the rest as skipped after a default-mode removal and clears it with the versions opt-in (m5)', async () => {
    const ids = ['f'.repeat(64), 'e'.repeat(64)];
    const syncVault = vi.fn().mockResolvedValueOnce({ ...sync, skipped: 2, foreign: ids, snapshot: undefined }).mockResolvedValueOnce({ removedForeign: 1 }).mockResolvedValueOnce({ removedForeign: 1 });
    const host = await setup(syncVault);
    await host.performSync(1, { kind: 'synchronize', clientId });
    expect(await host.performSync(1, { kind: 'removeForeign', clientId })).toMatchObject({ ok: true, state: { sync: { skipped: 1, removedForeign: 1 } } });
    expect(await host.performSync(1, { kind: 'removeForeign', clientId, versions: true })).toMatchObject({ ok: true, state: { sync: { skipped: 0 } } });
  });
  it('keeps foreign ids out of the state and removes them only when known', async () => {
    const foreignId = 'f'.repeat(64);
    const syncVault = vi.fn()
      .mockResolvedValueOnce({ ...sync, skipped: 1, compacted: 3, foreign: [foreignId], snapshot: undefined })
      .mockResolvedValueOnce({ removedForeign: 1 });
    const host = await setup(syncVault);
    expect(await host.performSync(1, { kind: 'removeForeign', clientId })).toEqual({ ok: false, code: 'invalid' });
    expect(syncVault).not.toHaveBeenCalled();
    const reply = await host.performSync(1, { kind: 'synchronize', clientId });
    expect(reply).toMatchObject({ ok: true, state: { sync: { skipped: 1, compacted: 3 } } });
    expect(JSON.stringify(reply)).not.toContain(foreignId);
    expect(JSON.stringify(host.request(1, { kind: 'status', clientId }))).not.toContain(foreignId);
    const removed = await host.performSync(1, { kind: 'removeForeign', clientId });
    expect(syncVault).toHaveBeenLastCalledWith(expect.any(Object), expect.any(Object), expect.any(AbortSignal), { kind: 'removeForeign', ids: [foreignId] }, undefined);
    expect(removed).toMatchObject({ ok: true, state: { sync: { skipped: 0, removedForeign: 1 } } });
    expect(JSON.stringify(removed)).not.toContain(foreignId);
    expect(await host.performSync(1, { kind: 'removeForeign', clientId })).toEqual({ ok: false, code: 'invalid' });
  });
});

describe('parity with the server device proof', () => {
  it('rejects the same weak Ed25519 keys as the server: all eight small-order points, non-canonical y, and no real key', async () => {
    // @ts-expect-error The dev script has no type declarations.
    const proof = await import('../../../scripts/sync-prototype/device-proof.mjs') as { weakEd25519(raw: Buffer): boolean };
    const weak = ['0100000000000000000000000000000000000000000000000000000000000000', '0100000000000000000000000000000000000000000000000000000000000080',
      'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f', 'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      '0000000000000000000000000000000000000000000000000000000000000000', '0000000000000000000000000000000000000000000000000000000000000080',
      'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a', 'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa',
      '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05', '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc85',
      'edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f', 'eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f', 'f'.repeat(64)];
    for (const hex of weak) { const raw = Buffer.from(hex, 'hex'); expect(weakEd25519(raw)).toBe(true); expect(proof.weakEd25519(raw)).toBe(true); }
    for (let n = 0; n < 32; n++) {
      const raw = generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
      expect(weakEd25519(raw)).toBe(false); expect(proof.weakEd25519(raw)).toBe(false);
    }
  });
});

describe('weak signing keys in the device list', () => {
  it('counts the author of an identity-point key as unknown for the sync core', async () => {
    let device: { keyOf(id: string): unknown } | undefined; const weak = 'f'.repeat(64);
    const identity = generateRemoteIdentity(); const good = generateKeyPairSync('ed25519'); const goodRaw = good.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
    const identityPoint = Buffer.concat([Buffer.from([1]), Buffer.alloc(31)]).toString('base64');
    const h = harness({
      account: { devices: vi.fn(async () => [entryOf(identity), entryOf(identity, { id: weak, signingKey: identityPoint }), entryOf(identity, { id: 'e'.repeat(64), signingKey: goodRaw })]) },
      syncVault: async (...a: any[]) => { device = a[4]; return sync; },
    });
    h.store.load.mockReturnValue({ identity, persistent: true });
    await h.signedIn(); await h.host.performSync(1, { kind: 'synchronize', clientId });
    expect(device!.keyOf(weak)).toBeUndefined(); expect(device!.keyOf('e'.repeat(64))).toBeDefined();
  });
});

describe('H3.1 hardening of the app surface', () => {
  const elsewhere = { enrollment: enrolledOf({ serverUrl: 'https://old.example.net/' }) };
  it('refuses sign-in for an enrolledElsewhere server without confirmation and sends nothing (C1)', async () => {
    const { host, createAccount, account } = harness(elsewhere);
    await host.connect(1, connectCommand);
    expect(await host.signIn(1, signInCommand)).toEqual({ ok: false, code: 'enrolledElsewhere' });
    expect(await host.signIn(1, { ...signInCommand, confirmElsewhere: false })).toEqual({ ok: false, code: 'invalid' });
    expect(createAccount).not.toHaveBeenCalled(); expect(account.enroll).not.toHaveBeenCalled();
    expect(await host.signIn(1, { ...signInCommand, confirmElsewhere: true })).toMatchObject({ ok: true });
    expect(account.enroll).toHaveBeenCalledOnce();
  });
  it('does not ask for confirmation when nothing is enrolled elsewhere', async () => {
    const { host } = harness();
    await host.connect(1, connectCommand);
    expect(await host.signIn(1, signInCommand)).toMatchObject({ ok: true });
  });
  it('rejects device names the shared rule forbids before any network call', async () => {
    const { host, createAccount } = harness();
    await host.connect(1, connectCommand);
    for (const deviceName of ['20241110', ' Laptop', 'Cafe Bad Deck', 'x'.repeat(65), 'Laptoṕ ']) expect(await host.signIn(1, { ...signInCommand, deviceName })).toEqual({ ok: false, code: 'invalid' });
    expect(createAccount).not.toHaveBeenCalled();
  });
  const run = async (syncVault: (...a: any[]) => Promise<any>, account: Partial<Record<keyof AccountDriver, unknown>> = {}) => { const h = harness({ syncVault, account }); await h.signedIn(); return h; };
  it('requires confirmed:true for rotateKey (C2, K23)', async () => {
    const syncVault = vi.fn(async () => ({ recoveryCode: 'f'.repeat(32) }));
    const h = await run(syncVault);
    expect(await h.host.performSync(1, { kind: 'rotateKey', clientId })).toEqual({ ok: false, code: 'invalid' });
    expect(await h.host.performSync(1, { kind: 'rotateKey', clientId, confirmed: false })).toEqual({ ok: false, code: 'invalid' });
    expect(syncVault).not.toHaveBeenCalled();
    expect(await h.host.performSync(1, { kind: 'rotateKey', clientId, confirmed: true })).toMatchObject({ ok: true, recoveryCode: 'f'.repeat(32) });
  });
  it('passes the versions opt-in to removeForeign only when set (B8)', async () => {
    const id = 'f'.repeat(64);
    const syncVault = vi.fn().mockResolvedValueOnce({ ...sync, skipped: 1, foreign: [id] }).mockResolvedValue({ removedForeign: 1 });
    const h = await run(syncVault);
    await h.host.performSync(1, { kind: 'synchronize', clientId });
    expect(await h.host.performSync(1, { kind: 'removeForeign', clientId, versions: false })).toEqual({ ok: false, code: 'invalid' });
    await h.host.performSync(1, { kind: 'removeForeign', clientId, versions: true });
    expect(syncVault).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), expect.any(AbortSignal), { kind: 'removeForeign', ids: [id], versions: true }, undefined);
  });
  it('maps the new core failures to their own codes (C2, C8, A2)', async () => {
    for (const [code, mapped] of [['foreignKey', 'syncForeignKey'], ['otherServer', 'syncOtherServer'], ['platform', 'syncPlatform']] as const) {
      const h = await run(async () => { throw { code }; });
      expect(await h.host.performSync(1, { kind: 'synchronize', clientId })).toEqual({ ok: false, code: mapped });
    }
  });
  it('maps a 429 during renewal or roster loading to limit, not syncLimit (R4)', async () => {
    const syncVault = vi.fn(async () => sync);
    const h = await run(syncVault);
    h.account.devices.mockRejectedValueOnce({ status: 429 });
    expect(await h.host.performSync(1, { kind: 'synchronize', clientId })).toEqual({ ok: false, code: 'limit' });
    expect(syncVault).not.toHaveBeenCalled();
    const real = await run(async () => { throw { status: 429 }; });
    expect(await real.host.performSync(1, { kind: 'synchronize', clientId })).toEqual({ ok: false, code: 'syncLimit' });
  });
  it('rejects an import password shorter than the vault minimum before any call', async () => {
    const syncVault = vi.fn(async () => sync);
    const h = await run(syncVault);
    expect(await h.host.performSync(1, { kind: 'importVault', clientId, password: 'x'.repeat(7), recoveryCode: '0123456789abcdef0123456789abcdef' })).toEqual({ ok: false, code: 'invalid' });
    expect(syncVault).not.toHaveBeenCalled();
  });
});

describe('H4 key epochs: enrollment code, roster pins, rotation', () => {
  const INVITE = '0123456789abcdef0123456789abcdef';
  const inviteCommand = { kind: 'signInWithInvite', clientId, code: INVITE, deviceName: 'Laptop' };
  const inviteHarness = async (opts: Parameters<typeof harness>[0] = {}, info = (u: string) => infoOf(u)) => {
    const h = harness({ info, ...opts }); await h.host.connect(1, connectCommand); return h;
  };
  const pinOf = (h: ReturnType<typeof harness>) => (h.store.rosterOf as unknown as () => { pins: any[]; at: number | null })();

  it('needs invites and object epochs from the server', async () => {
    for (const missing of ['invites', 'objectEpochs']) {
      const { host } = harness({ info: async (u: string) => ({ ...(await infoOf(u)), [missing]: false }) });
      expect(await host.connect(1, connectCommand)).toEqual({ ok: false, code: 'unavailable' });
    }
  });
  it('maps a 403 from the password enrollment to enrollmentLocked', async () => {
    const h = harness({ account: { enroll: vi.fn().mockRejectedValue({ status: 403 }) } });
    await h.host.connect(1, connectCommand);
    expect(await h.host.signIn(1, signInCommand)).toEqual({ ok: false, code: 'enrollmentLocked' });
  });
  it('enrolls with a code: derived secret, username from the server, code held as a zeroable buffer', async () => {
    const h = await inviteHarness({ syncVault: async () => sync });
    const reply = await h.host.signInWithInvite(1, inviteCommand);
    expect(reply).toMatchObject({ ok: true, state: { account: { signedIn: true, username: 'alice' }, inviteKey: true } });
    expect(h.account.enrollWithInvite).toHaveBeenCalledWith(expect.anything(), { secret: expect.stringMatching(/^[0-9a-f]{64}$/), name: 'Laptop', ephemeral: false });
    expect(h.store.rememberEnrollment).toHaveBeenCalledWith(expect.objectContaining({ username: 'alice', name: 'Laptop' }));
    expect(JSON.stringify(reply)).not.toContain(INVITE);
    expect(JSON.stringify(h.host.request(1, { kind: 'status', clientId }))).not.toContain(INVITE);
  });
  it('rejects a malformed code without network and maps 401 to invite, 429 to limit', async () => {
    const h = await inviteHarness();
    expect(await h.host.signInWithInvite(1, { ...inviteCommand, code: 'nope' })).toEqual({ ok: false, code: 'invalid' });
    expect(h.createAccount).not.toHaveBeenCalled();
    const denied = await inviteHarness({ account: { enrollWithInvite: vi.fn().mockRejectedValue({ status: 401 }) } });
    expect(await denied.host.signInWithInvite(1, inviteCommand)).toEqual({ ok: false, code: 'invite' });
    const limited = await inviteHarness({ account: { enrollWithInvite: vi.fn().mockRejectedValue({ status: 429 }) } });
    expect(await limited.host.signInWithInvite(1, inviteCommand)).toEqual({ ok: false, code: 'limit' });
  });
  it('imports and synchronizes with the held code, then wipes it after success', async () => {
    const syncVault = vi.fn(async (..._a: any[]) => sync);
    const h = await inviteHarness({ syncVault }); await h.host.signInWithInvite(1, inviteCommand);
    await h.host.performSync(1, { kind: 'synchronize', clientId });
    expect(syncVault.mock.calls[0][3]).toEqual({ kind: 'synchronize', inviteCode: INVITE });
    expect((h.host.request(1, { kind: 'status', clientId }) as any).state.inviteKey).toBeUndefined();
    await h.host.performSync(1, { kind: 'synchronize', clientId });
    expect(syncVault.mock.calls[1][3]).toEqual({ kind: 'synchronize' });
  });
  it('imports with the held code and wipes it after the import', async () => {
    const syncVault = vi.fn(async (..._a: any[]) => ({ ...sync, snapshot: { filePath: '/x.term', vault: {} } }));
    const h = await inviteHarness({ syncVault }); await h.host.signInWithInvite(1, inviteCommand);
    await h.host.performSync(1, { kind: 'importVault', clientId, password: 'OTHER-PASSWORD' });
    expect(syncVault.mock.calls[0][3]).toEqual({ kind: 'importVault', password: 'OTHER-PASSWORD', inviteCode: INVITE });
    expect((h.host.request(1, { kind: 'status', clientId }) as any).state.inviteKey).toBeUndefined();
  });
  it('wipes the held code after syncInviteKey and keeps it across other failures', async () => {
    const syncVault = vi.fn().mockRejectedValueOnce({ code: 'conflict' }).mockRejectedValueOnce({ code: 'inviteKey' });
    const h = await inviteHarness({ syncVault }); await h.host.signInWithInvite(1, inviteCommand);
    expect(await h.host.performSync(1, { kind: 'synchronize', clientId })).toEqual({ ok: false, code: 'syncConflict' });
    expect(h.host.request(1, { kind: 'status', clientId })).toMatchObject({ state: { inviteKey: true } });
    expect(await h.host.performSync(1, { kind: 'synchronize', clientId })).toMatchObject({ ok: false, code: 'syncInviteKey' });
    expect((h.host.request(1, { kind: 'status', clientId }) as any).state.inviteKey).toBeUndefined();
  });
  it('zeroes the held code buffer on close (K12)', async () => {
    const from = Buffer.from.bind(Buffer); let held: Buffer | undefined;
    const spy = vi.spyOn(Buffer, 'from').mockImplementation(((...args: unknown[]) => { const result = (from as (...a: unknown[]) => Buffer)(...args); if (args[0] === INVITE && args[1] === 'hex') held = result; return result; }) as never);
    const h = await inviteHarness(); await h.host.signInWithInvite(1, inviteCommand); spy.mockRestore();
    expect(held?.toString('hex')).toBe(INVITE);
    h.host.request(1, { kind: 'close', clientId });
    expect(held!.every(byte => byte === 0)).toBe(true);
  });
  it('requires an import code when none is typed and none is held', async () => {
    const h = harness({ syncVault: async () => sync }); await h.signedIn();
    expect(await h.host.performSync(1, { kind: 'importVault', clientId, password: 'OTHER-PASSWORD' })).toEqual({ ok: false, code: 'invalid' });
  });
  it('issues an invite: keybox, server registration, count; the code stays out of the state', async () => {
    const issued = { code: INVITE, enrollSecret: 'e'.repeat(64), keyboxId: 'b'.repeat(64) };
    const h = harness({ syncVault: async () => issued }); await h.signedIn();
    const reply = await h.host.performSync(1, { kind: 'invite', clientId }) as { state: unknown; inviteCode?: string };
    expect(reply.inviteCode).toBe(INVITE); expect(JSON.stringify(reply.state)).not.toContain(INVITE);
    expect(h.account.invite).toHaveBeenCalledWith(expect.anything(), { secret: 'e'.repeat(64), object: 'b'.repeat(64) });
    expect(JSON.stringify(h.host.request(1, { kind: 'status', clientId }))).not.toContain(INVITE);
  });
  it('takes the keybox back best effort when the server refuses the invite', async () => {
    const remove = vi.fn(async () => true);
    const h = harness({ syncVault: async () => ({ code: INVITE, enrollSecret: 'e'.repeat(64), keyboxId: 'b'.repeat(64) }), account: { invite: vi.fn().mockRejectedValue({ status: 403 }), remove } });
    await h.signedIn();
    expect(await h.host.performSync(1, { kind: 'invite', clientId })).toEqual({ ok: false, code: 'connection' });
    expect(remove).toHaveBeenCalledWith('b'.repeat(64));
  });
  it('passes the canonical origin to createInvite', async () => {
    const syncVault = vi.fn(async (..._a: any[]) => ({ code: INVITE, enrollSecret: 'e'.repeat(64), keyboxId: 'b'.repeat(64) }));
    const h = harness({ syncVault }); await h.signedIn(); await h.host.performSync(1, { kind: 'invite', clientId });
    expect(syncVault.mock.calls[0][3]).toEqual({ kind: 'createInvite', origin: 'https://sync.example.net' });
  });
  it('maps the epoch errors', async () => {
    for (const [code, mapped] of [['rotated', 'syncRotated'], ['rotateBlocked', 'syncRotateBlocked'], ['rotateRaced', 'syncRotateRaced']]) {
      const h = harness({ syncVault: async () => { throw { code }; } }); await h.signedIn();
      expect(await h.host.performSync(1, { kind: 'synchronize', clientId })).toEqual({ ok: false, code: mapped });
    }
  });
  it('advises rotation after removing any device, clears it after rotating, and pins a local revocation (K14, K15)', async () => {
    const other = generateRemoteIdentity();
    const h = harness({ syncVault: async () => ({ recoveryCode: 'f'.repeat(32) }) }); await h.signedIn();
    h.account.devices.mockResolvedValue([entryOf(h.identity), entryOf(other, { name: 'Phone', ephemeral: true })]);
    await h.host.devices(1, { kind: 'listDevices', clientId });
    h.account.devices.mockResolvedValue([entryOf(h.identity)]); // A temporary device vanishes from the server roster on removal.
    const reply = await h.host.devices(1, { kind: 'revokeDevice', clientId, id: other.id });
    expect(reply).toMatchObject({ ok: true, state: { rotationAdvised: true } });
    expect(pinOf(h).pins.find(p => p.id === other.id)).toMatchObject({ revokedAt: expect.any(Number) });
    const rotated = await h.host.performSync(1, { kind: 'rotateKey', clientId, confirmed: true });
    expect((rotated as any).state.rotationAdvised).toBeUndefined();
  });
  it('flags a new device, flags an own invitation in the same connection as info and requires acknowledgement', async () => {
    const other = generateRemoteIdentity(); const third = generateRemoteIdentity();
    const issued = { code: INVITE, enrollSecret: 'e'.repeat(64), keyboxId: 'b'.repeat(64) };
    const h = harness({ enrollment: enrolledOf(), syncVault: async () => issued });
    await h.host.connect(1, connectCommand); await h.host.openSession(1, { kind: 'openSession', clientId });
    await h.host.performSync(1, { kind: 'invite', clientId });
    h.account.devices.mockResolvedValue([entryOf(h.identity), entryOf(other, { name: 'Phone', enrolledBy: h.identity.id }), entryOf(third, { name: 'Stranger' })]);
    const listed = await h.host.devices(1, { kind: 'listDevices', clientId }) as any;
    expect(listed.state.newDevices).toEqual([{ id: other.id, name: 'Phone', enrolledVia: 'invite', invitedBy: 'Laptop', ownInvite: true }, { id: third.id, name: 'Stranger', enrolledVia: 'password' }]);
    expect(listed.state.devices.find((d: any) => d.id === other.id)).toMatchObject({ enrolledVia: 'invite', invitedBy: 'Laptop' });
    const ack = await h.host.devices(1, { kind: 'acknowledgeDevice', clientId, id: third.id }) as any;
    expect(ack.state.newDevices).toEqual([expect.objectContaining({ id: other.id, ownInvite: true })]); // The own invitation still waits.
    expect(pinOf(h).pins.find(p => p.id === third.id)).toMatchObject({ acknowledged: true });
    expect(((await h.host.devices(1, { kind: 'acknowledgeDevice', clientId, id: other.id })) as any).state.newDevices).toBeUndefined();
  });
  it('does not let an unacknowledged new device vouch for a key epoch (R1)', async () => {
    const third = generateRemoteIdentity();
    const syncVault = vi.fn(async () => ({ status: 'synced' as const, versions: 1, received: 0, sent: 0 }));
    const h = harness({ syncVault }); await h.signedIn();
    await h.host.devices(1, { kind: 'listDevices', clientId }); // First run pins the roster silently.
    h.account.devices.mockResolvedValue([entryOf(h.identity), entryOf(third, { name: 'Stranger' })]);
    await h.host.performSync(1, { kind: 'synchronize', clientId });
    const deviceOf = (): SyncDevice => (syncVault.mock.calls.at(-1) as unknown as [unknown, unknown, unknown, unknown, SyncDevice])[4];
    expect(deviceOf().trusted?.(third.id)).toBe(false);
    expect(deviceOf().trusted?.(h.identity.id)).toBe(true);
    await h.host.devices(1, { kind: 'acknowledgeDevice', clientId, id: third.id });
    await h.host.performSync(1, { kind: 'synchronize', clientId });
    expect(deviceOf().trusted?.(third.id)).toBe(true);
  });
  it('refuses to acknowledge an id without an open notice and keeps a local revocation (m2)', async () => {
    const other = generateRemoteIdentity();
    const h = harness({ enrollment: enrolledOf() });
    h.account.devices.mockResolvedValue([entryOf(h.identity), entryOf(other, { name: 'Phone', revokedAt: 9 })]);
    await h.host.connect(1, connectCommand); await h.host.openSession(1, { kind: 'openSession', clientId });
    expect(await h.host.devices(1, { kind: 'acknowledgeDevice', clientId, id: other.id })).toEqual({ ok: false, code: 'invalid' });
    expect(await h.host.devices(1, { kind: 'acknowledgeDevice', clientId, id: 'f'.repeat(64) })).toEqual({ ok: false, code: 'invalid' });
    expect(pinOf(h).pins.find(p => p.id === other.id)).toMatchObject({ revokedAt: 9 });
  });
  it('warns about an own invitation after the connection was closed', async () => {
    const other = generateRemoteIdentity();
    const h = harness({ enrollment: enrolledOf() });
    await h.host.connect(1, connectCommand); await h.host.openSession(1, { kind: 'openSession', clientId });
    h.account.devices.mockResolvedValue([entryOf(h.identity), entryOf(other, { name: 'Phone', enrolledBy: h.identity.id })]);
    expect(await h.host.devices(1, { kind: 'listDevices', clientId })).toMatchObject({ state: { newDevices: [{ name: 'Phone', enrolledVia: 'invite' }] } });
  });
  it('treats a revived device as removed until acknowledged (E11)', async () => {
    const other = generateRemoteIdentity();
    const h = harness({ enrollment: enrolledOf() });
    h.account.devices.mockResolvedValue([entryOf(h.identity), entryOf(other, { name: 'Phone', revokedAt: 9 })]);
    await h.host.connect(1, connectCommand); await h.host.openSession(1, { kind: 'openSession', clientId });
    h.account.devices.mockResolvedValue([entryOf(h.identity), entryOf(other, { name: 'Phone' })]);
    const listed = await h.host.devices(1, { kind: 'listDevices', clientId }) as any;
    expect(listed.state.revived).toEqual([{ id: other.id, name: 'Phone' }]);
    expect(listed.state.devices.find((d: any) => d.id === other.id).revokedAt).toBe(9);
    const ack = await h.host.devices(1, { kind: 'acknowledgeDevice', clientId, id: other.id }) as any;
    expect(ack.state.revived).toBeUndefined();
    expect(ack.state.devices.find((d: any) => d.id === other.id).revokedAt).toBeNull();
    expect(pinOf(h).pins.find(p => p.id === other.id)).toMatchObject({ revokedAt: null, acknowledged: true });
  });
  it('ends with syncRoster when a known device shows another key and keeps the pins', async () => {
    const other = generateRemoteIdentity(); const impostor = generateRemoteIdentity();
    const syncVault = vi.fn(async (..._a: any[]) => sync);
    const h = harness({ enrollment: enrolledOf(), syncVault });
    h.account.devices.mockResolvedValue([entryOf(h.identity), entryOf(other, { name: 'Phone' })]);
    await h.host.connect(1, connectCommand); await h.host.openSession(1, { kind: 'openSession', clientId });
    const before = JSON.stringify(pinOf(h));
    h.account.devices.mockResolvedValue([entryOf(h.identity), { ...entryOf(impostor, { name: 'Phone' }), id: other.id }]);
    expect(await h.host.performSync(1, { kind: 'synchronize', clientId })).toEqual({ ok: false, code: 'syncRoster' });
    expect(syncVault).not.toHaveBeenCalled();
    expect(JSON.stringify(pinOf(h))).toBe(before);
    expect(h.host.request(1, { kind: 'status', clientId })).toMatchObject({ ok: true, state: { account: { signedIn: true } } }); // The session stays.
  });
  it('rejects a server roster the identity store refuses as syncRoster', async () => {
    const h = harness({ enrollment: enrolledOf(), syncVault: async () => sync });
    (h.store.rememberRoster as any).mockImplementation(() => { throw Error('identity'); });
    await h.host.connect(1, connectCommand);
    expect(await h.host.openSession(1, { kind: 'openSession', clientId })).toEqual({ ok: false, code: 'syncRoster' });
  });
  it('acknowledges without network and without waiting for a busy request', async () => {
    const other = generateRemoteIdentity();
    let release!: () => void; const gate = new Promise<void>(r => { release = r; });
    const h = harness({ enrollment: enrolledOf(), syncVault: async () => { await gate; return sync; } });
    await h.host.connect(1, connectCommand); await h.host.openSession(1, { kind: 'openSession', clientId });
    h.account.devices.mockResolvedValue([entryOf(h.identity), entryOf(other, { name: 'Phone' })]);
    await h.host.devices(1, { kind: 'listDevices', clientId });
    const running = h.host.performSync(1, { kind: 'synchronize', clientId });
    h.account.devices.mockClear();
    expect(await h.host.devices(1, { kind: 'acknowledgeDevice', clientId, id: other.id })).toMatchObject({ ok: true });
    expect(h.account.devices).toHaveBeenCalledTimes(1); // Only the running synchronize loaded the roster.
    release(); await running;
  });
  it('keeps the earlier revocation time of pin and server', async () => {
    const other = generateRemoteIdentity();
    const h = harness({ enrollment: enrolledOf() });
    h.account.devices.mockResolvedValue([entryOf(h.identity), entryOf(other, { name: 'Phone', revokedAt: 5 })]);
    await h.host.connect(1, connectCommand); await h.host.openSession(1, { kind: 'openSession', clientId });
    h.account.devices.mockResolvedValue([entryOf(h.identity), entryOf(other, { name: 'Phone', revokedAt: 50 })]);
    const listed = await h.host.devices(1, { kind: 'listDevices', clientId }) as any;
    expect(listed.state.devices.find((d: any) => d.id === other.id).revokedAt).toBe(5);
  });
});
