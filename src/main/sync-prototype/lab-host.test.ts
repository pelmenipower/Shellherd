import { describe, expect, it, vi } from 'vitest';
import { SyncLabHost } from './lab-host';
const clientId = '123e4567-e89b-42d3-a456-426614174000';
const otherId = '123e4567-e89b-42d3-a456-426614174001';
describe('development lab ownership boundary', () => {
  it('allows conflict resolution only after login, for the owning dialog and the reviewed revision', async () => {
    const revision = 'c'.repeat(64);
    const sync = vi.fn(async () => ({ status: 'conflict' as const, versions: 3, conflicts: 1, canKeepLocal: true, conflictRevision: revision, approvals: 0 }));
    const host = new SyncLabHost(() => ({ action: () => ({ ok: false, code: 'unavailable' }), close() {} }),
      async serverUrl => ({ serverUrl, serverId: 'a'.repeat(64), namespace: 'space', authentication: 'password' }), undefined,
      () => ({ login: async () => {}, list: async () => [], close() {} }), sync);
    await host.connect(1, { kind: 'connect', clientId, serverUrl: 'https://sync.example.net' });
    expect(await host.performSync(1, { kind: 'synchronize', clientId })).toEqual({ ok: false, code: 'stale' });
    await host.signIn(1, { kind: 'signIn', clientId, username: 'alice', password: 'ONLY_TEST_PASSWORD' });
    expect(await host.performSync(2, { kind: 'synchronize', clientId })).toEqual({ ok: false, code: 'stale' });
    expect(await host.performSync(1, { kind: 'keepLocal', clientId, reviewed: true, revision })).toEqual({ ok: false, code: 'invalid' });
    expect(sync).not.toHaveBeenCalled();
    expect(await host.performSync(1, { kind: 'synchronize', clientId })).toMatchObject({ ok: true, state: { sync: { conflictRevision: revision } } });
    expect(await host.performSync(1, { kind: 'keepLocal', clientId, reviewed: false, revision })).toEqual({ ok: false, code: 'invalid' });
    expect(await host.performSync(1, { kind: 'keepLocal', clientId, reviewed: true, revision: 'd'.repeat(64) })).toEqual({ ok: false, code: 'invalid' });
    expect(sync).toHaveBeenCalledOnce();
    expect(await host.performSync(1, { kind: 'keepLocal', clientId, reviewed: true, revision })).toMatchObject({ ok: true });
    expect(sync).toHaveBeenLastCalledWith(expect.any(Object), expect.any(Object), expect.any(AbortSignal), { kind: 'keepLocal', clientId, reviewed: true, revision });
    host.reset();
  });
  it('keeps login credentials and tokens out of replies, permits retry and closes the account with its owner', async () => {
    const login = vi.fn().mockRejectedValueOnce({ status: 401 }).mockResolvedValue({ token: 'MUST_NOT_LEAK' });
    const list = vi.fn(async () => []); const close = vi.fn(); const createAccount = vi.fn(() => ({ login, list, close }));
    const host = new SyncLabHost(() => ({ action: () => ({ ok: false, code: 'unavailable' }), close() {} }),
      async serverUrl => ({ serverUrl, serverId: 'a'.repeat(64), namespace: 'space', authentication: 'password' }), undefined, createAccount);
    await host.connect(1, { kind: 'connect', clientId, serverUrl: 'https://sync.example.net' });
    const command = { kind: 'signIn', clientId, username: 'alice', password: 'PRIVATE_PASSWORD' };
    expect(await host.signIn(2, command)).toEqual({ ok: false, code: 'stale' });
    expect(login).not.toHaveBeenCalled();
    expect(await host.signIn(1, command)).toEqual({ ok: false, code: 'authentication' });
    expect(close).toHaveBeenCalledOnce();
    const reply = await host.signIn(1, command);
    expect(reply).toMatchObject({ ok: true, state: { account: { signedIn: true, username: 'alice' } } });
    expect(JSON.stringify(reply)).not.toMatch(/PRIVATE_PASSWORD|MUST_NOT_LEAK/);
    expect(list).toHaveBeenCalledOnce(); host.closeOwner(1); expect(close).toHaveBeenCalledTimes(2);
  });
  it('aborts login on close and never exposes a completed canceled sign-in', async () => {
    let complete!: () => void; let signal!: AbortSignal;
    const close = vi.fn(); const list = vi.fn(async () => []);
    const host = new SyncLabHost(() => ({ action: () => ({ ok: false, code: 'unavailable' }), close() {} }),
      async serverUrl => ({ serverUrl, serverId: 'a'.repeat(64), namespace: 'space', authentication: 'password' }), undefined,
      (_info, current) => { signal = current; return { login: () => new Promise<void>(resolve => { complete = resolve; }), list, close }; });
    await host.connect(1, { kind: 'connect', clientId, serverUrl: 'https://sync.example.net' });
    const command = { kind: 'signIn', clientId, username: 'alice', password: 'PRIVATE_PASSWORD' };
    const pending = host.signIn(1, command);
    expect(await host.signIn(1, command)).toEqual({ ok: false, code: 'stale' });
    host.closeOwner(1); expect(close).toHaveBeenCalledOnce(); expect(signal.aborted).toBe(true);
    complete(); expect(await pending).toEqual({ ok: false, code: 'stale' });
    expect(host.request(1, { kind: 'status', clientId })).toEqual({ ok: false, code: 'stale' });
  });
  it('is unavailable unless a dev backend was explicitly enabled', () => {
    expect(new SyncLabHost().request(1, { kind: 'start', clientId })).toEqual({ ok: false, code: 'unavailable' });
  });
  it('validates commands, rejects cross-window clients, and closes only the owned attempt', () => {
    const close = vi.fn(); const action = vi.fn(() => ({ ok: true as const, state: { phase: 'compare' as const } }));
    const host = new SyncLabHost(() => ({ close, action }));
    expect(host.request(1, { kind: 'start', clientId, extra: 'forbidden' }).ok).toBe(false);
    expect(host.request(1, { kind: 'start', clientId }).ok).toBe(true);
    expect(host.request(2, { kind: 'status', clientId })).toEqual({ ok: false, code: 'stale' });
    expect(host.request(1, { kind: 'status', clientId: otherId })).toEqual({ ok: false, code: 'stale' });
    host.request(2, { kind: 'close', clientId }); host.request(1, { kind: 'close', clientId: otherId });
    expect(close).not.toHaveBeenCalled();
    host.closeOwner(2); expect(close).not.toHaveBeenCalled();
    host.closeOwner(1); expect(close).toHaveBeenCalledOnce();
    expect(host.request(1, { kind: 'status', clientId })).toEqual({ ok: false, code: 'stale' });
  });
  it('requires explicit acknowledgments and bounds choice lists before parsing them', () => {
    const action = vi.fn(() => ({ ok: true as const, state: { phase: 'idle' as const } }));
    const host = new SyncLabHost(() => ({ action, close() {} })); host.request(1, { kind: 'start', clientId });
    expect(host.request(1, { kind: 'confirm', clientId, sessionId: otherId, role: 'left', fingerprint: 'a'.repeat(64), compared: false }).ok).toBe(false);
    expect(host.request(1, { kind: 'resolve', clientId, sessionId: otherId, revision: otherId, reviewed: true, choices: Array(10000).fill({ id: 'x', side: 'left' }) }).ok).toBe(false);
    expect(action).toHaveBeenCalledTimes(1);
    host.reset();
  });
  it('connects only an explicitly selected safe URL and keeps the result scoped to its dialog', async () => {
    const probe = vi.fn(async (serverUrl: string) => ({ serverUrl, serverId: 'a'.repeat(64), namespace: 'space' }));
    const host = new SyncLabHost(() => ({ action: () => ({ ok: true, state: { phase: 'idle' } }), close() {} }), probe);
    expect(await host.connect(1, { kind: 'connect', clientId, serverUrl: 'http://192.168.1.2' })).toEqual({ ok: false, code: 'invalid' });
    expect(probe).not.toHaveBeenCalled();
    const reply = await host.connect(1, { kind: 'connect', clientId, serverUrl: 'https://sync.example.net' });
    expect(reply).toMatchObject({ ok: true, state: { phase: 'serverReady', server: { serverUrl: 'https://sync.example.net/' } } });
    expect(host.request(2, { kind: 'status', clientId })).toEqual({ ok: false, code: 'stale' });
    host.request(1, { kind: 'close', clientId: otherId });
    expect(host.request(1, { kind: 'status', clientId }).ok).toBe(true);
    host.closeOwner(1); expect(host.request(1, { kind: 'status', clientId }).ok).toBe(false);
  });
  it('aborts a pending server probe on close and never resurrects a canceled setup', async () => {
    let resolveProbe!: (value: { serverUrl: string; serverId: string; namespace: string }) => void;
    let signal!: AbortSignal;
    const probe = vi.fn((_url: string, _private: boolean, current: AbortSignal) => { signal = current; return new Promise<{ serverUrl: string; serverId: string; namespace: string }>(resolve => { resolveProbe = resolve; }); });
    const host = new SyncLabHost(() => ({ action: () => ({ ok: true, state: { phase: 'idle' } }), close() {} }), probe);
    const pending = host.connect(1, { kind: 'connect', clientId, serverUrl: 'https://sync.example.net' });
    host.request(1, { kind: 'close', clientId }); expect(signal.aborted).toBe(true);
    resolveProbe({ serverUrl: 'https://sync.example.net/', serverId: 'a'.repeat(64), namespace: 'space' });
    expect(await pending).toEqual({ ok: false, code: 'stale' });
    expect(host.request(1, { kind: 'status', clientId }).ok).toBe(false);
  });
  it('scopes enrollment to its owner, rejects concurrent actions, and discards completion after close', async () => {
    const view = { status: 'pending' as const, requestId: 'b'.repeat(64), fingerprint: 'c'.repeat(64), deviceId: 'temporary', expiresAt: Date.now() + 300000 };
    let complete!: (value: typeof view) => void;
    const begin = vi.fn(() => new Promise<typeof view>(resolve => { complete = resolve; }));
    const close = vi.fn(); const refresh = vi.fn(async () => view);
    const createEnrollment = vi.fn(() => ({ begin, refresh, close }));
    const host = new SyncLabHost(() => ({ action: () => ({ ok: true, state: { phase: 'idle' } }), close() {} }),
      async serverUrl => ({ serverUrl, serverId: 'a'.repeat(64), namespace: 'space', enrollmentAvailable: true }), createEnrollment);
    await host.connect(1, { kind: 'connect', clientId, serverUrl: 'https://sync.example.net' });
    expect(await host.authorize(2, { kind: 'requestAccess', clientId })).toEqual({ ok: false, code: 'stale' });
    expect(await host.authorize(1, { kind: 'requestAccess', clientId: otherId })).toEqual({ ok: false, code: 'stale' });
    expect(createEnrollment).not.toHaveBeenCalled();
    const pending = host.authorize(1, { kind: 'requestAccess', clientId });
    expect(await host.authorize(1, { kind: 'refreshAccess', clientId })).toEqual({ ok: false, code: 'stale' });
    host.closeOwner(2); expect(close).not.toHaveBeenCalled();
    host.closeOwner(1); expect(close).toHaveBeenCalledOnce();
    complete(view); expect(await pending).toEqual({ ok: false, code: 'stale' });
    expect(host.request(1, { kind: 'status', clientId })).toEqual({ ok: false, code: 'stale' });
    expect(refresh).not.toHaveBeenCalled();
  });
  describe('vault password separation', () => {
    const make = (matches: (p: string) => Promise<boolean | undefined>, login = vi.fn(async () => {}), sync?: () => Promise<any>) => {
      const host = new SyncLabHost(() => ({ action: () => ({ ok: false, code: 'unavailable' }), close() {} }),
        async serverUrl => ({ serverUrl, serverId: 'a'.repeat(64), namespace: 'space', authentication: 'password' }), undefined,
        () => ({ login, list: async () => [], close() {} }), sync, matches);
      return { host, login };
    };
    const command = { kind: 'signIn', clientId, username: 'alice', password: 'PRIVATE_PASSWORD' };
    it('rejects the vault password before login', async () => {
      const { host, login } = make(async () => true);
      await host.connect(1, { kind: 'connect', clientId, serverUrl: 'https://sync.example.net' });
      expect(await host.signIn(1, command)).toEqual({ ok: false, code: 'samePassword' });
      expect(login).not.toHaveBeenCalled();
    });
    it('signs in when the vault is locked (undefined) or the password differs', async () => {
      for (const result of [undefined, false]) {
        const { host, login } = make(async () => result);
        await host.connect(1, { kind: 'connect', clientId, serverUrl: 'https://sync.example.net' });
        expect(await host.signIn(1, command)).toMatchObject({ ok: true });
        expect(login).toHaveBeenCalledOnce();
      }
    });
    it('ends with connection when the check throws', async () => {
      const { host, login } = make(async () => { throw Error('boom'); });
      await host.connect(1, { kind: 'connect', clientId, serverUrl: 'https://sync.example.net' });
      expect(await host.signIn(1, command)).toEqual({ ok: false, code: 'connection' });
      expect(login).not.toHaveBeenCalled();
    });
    it('is stale when the connection changes during the check', async () => {
      let release!: (v: boolean) => void;
      const { host, login } = make(() => new Promise<boolean>(resolve => { release = resolve; }));
      await host.connect(1, { kind: 'connect', clientId, serverUrl: 'https://sync.example.net' });
      const pending = host.signIn(1, command);
      host.closeOwner(1); release(false);
      expect(await pending).toEqual({ ok: false, code: 'stale' });
      expect(login).not.toHaveBeenCalled();
    });
    it('reports skipped objects in the state', async () => {
      const { host } = make(async () => false, undefined, async () => ({ status: 'synced' as const, versions: 1, conflicts: 0, canKeepLocal: false, approvals: 0, skipped: 2 }));
      await host.connect(1, { kind: 'connect', clientId, serverUrl: 'https://sync.example.net' });
      await host.signIn(1, command);
      expect(await host.performSync(1, { kind: 'synchronize', clientId })).toMatchObject({ ok: true, state: { sync: { skipped: 2 } } });
    });
  });
  describe('private network, import digest and foreign objects', () => {
    const info = async (serverUrl: string) => ({ serverUrl, serverId: 'a'.repeat(64), namespace: 'space', authentication: 'password' as const });
    const signIn = { kind: 'signIn', clientId, username: 'alice', password: 'LOGIN_PASSWORD' };
    const setup = (sync: any, matches: (p: string) => Promise<boolean | undefined> = async () => undefined) => {
      const host = new SyncLabHost(() => ({ action: () => ({ ok: false, code: 'unavailable' }), close() {} }), info, undefined,
        () => ({ login: async () => {}, list: async () => [], close() {} }), sync, matches);
      return host;
    };
    const ready = async (host: SyncLabHost) => { await host.connect(1, { kind: 'connect', clientId, serverUrl: 'https://sync.example.net' }); await host.signIn(1, signIn); };
    it('passes privateNetwork to the probe and rejects tunnel HTTP without the flag', async () => {
      const probe = vi.fn(async (serverUrl: string) => ({ serverUrl, serverId: 'a'.repeat(64), namespace: 'space' }));
      const host = new SyncLabHost(() => ({ action: () => ({ ok: true, state: { phase: 'idle' } }), close() {} }), probe);
      expect(await host.connect(1, { kind: 'connect', clientId, serverUrl: 'http://10.0.0.5' })).toEqual({ ok: false, code: 'invalid' });
      expect(probe).not.toHaveBeenCalled();
      expect(await host.connect(1, { kind: 'connect', clientId, serverUrl: 'http://10.0.0.5', privateNetwork: true })).toMatchObject({ ok: true });
      expect(probe).toHaveBeenCalledWith('http://10.0.0.5/', true, expect.any(AbortSignal));
      host.reset();
      await host.connect(1, { kind: 'connect', clientId, serverUrl: 'https://sync.example.net' });
      expect(probe).toHaveBeenLastCalledWith('https://sync.example.net/', false, expect.any(AbortSignal));
      host.reset();
    });
    it('rejects an import with the sign-in password (locked vault) and wipes the digest', async () => {
      const sync = vi.fn(async () => ({ status: 'synced' as const, versions: 1, conflicts: 0, canKeepLocal: false, approvals: 0 }));
      const host = setup(sync); await ready(host);
      expect(await host.performSync(1, { kind: 'importVault', clientId, password: 'LOGIN_PASSWORD' })).toMatchObject({ ok: false, code: 'samePasswordImport' });
      expect(sync).not.toHaveBeenCalled();
      expect(await host.performSync(1, { kind: 'importVault', clientId, password: 'OTHER' })).toMatchObject({ ok: true });
      expect(sync).toHaveBeenCalledOnce();
    });
    it('keeps the digest across failed attempts and wipes it after a successful import', async () => {
      const sync = vi.fn(async (_a: unknown, _i: unknown, _s: unknown, request: any) => request.password === 'OTHER' ? { status: 'synced' as const, versions: 1, conflicts: 0, canKeepLocal: false, approvals: 0, snapshot: {} } : undefined);
      const host = setup(sync); await ready(host);
      expect(await host.performSync(1, { kind: 'importVault', clientId, password: 'WRONG' })).toMatchObject({ ok: true });
      expect(await host.performSync(1, { kind: 'importVault', clientId, password: 'LOGIN_PASSWORD' })).toMatchObject({ ok: false, code: 'samePasswordImport' });
      expect(await host.performSync(1, { kind: 'importVault', clientId, password: 'LOGIN_PASSWORD' })).toMatchObject({ ok: false, code: 'samePasswordImport' });
      expect(sync).toHaveBeenCalledOnce();
      expect(await host.performSync(1, { kind: 'importVault', clientId, password: 'OTHER' })).toMatchObject({ ok: true });
      expect(await host.performSync(1, { kind: 'importVault', clientId, password: 'LOGIN_PASSWORD' })).toMatchObject({ ok: true }); // digest wiped after success
    });
    it('also rejects after a checked-different login, and compares NFKC-normalized', async () => {
      const sync = vi.fn(async () => undefined);
      const host = setup(sync, async () => false); await ready(host);
      expect(await host.performSync(1, { kind: 'importVault', clientId, password: 'LOGIN_PASSWORD' })).toMatchObject({ ok: false, code: 'samePasswordImport' });
      const host2 = setup(sync);
      await host2.connect(1, { kind: 'connect', clientId, serverUrl: 'https://sync.example.net' });
      await host2.signIn(1, { ...signIn, password: 'caf\u00e9' });
      expect(await host2.performSync(1, { kind: 'importVault', clientId, password: 'cafe\u0301' })).toMatchObject({ ok: false, code: 'samePasswordImport' });
      expect(sync).not.toHaveBeenCalled();
    });
    it('wipes the digest on close and reset', async () => {
      const fill = vi.spyOn(Buffer.prototype, 'fill');
      try {
        const host = setup(async () => undefined); await ready(host);
        fill.mockClear(); host.request(1, { kind: 'close', clientId }); expect(fill).toHaveBeenCalledTimes(2);
        await ready(host); fill.mockClear(); host.reset(); expect(fill).toHaveBeenCalledTimes(2);
        await ready(host); fill.mockClear(); host.closeOwner(1); expect(fill).toHaveBeenCalledTimes(2);
      } finally { fill.mockRestore(); }
    });
    it('keeps foreign ids out of the state and removes them only when known', async () => {
      const foreignId = 'f'.repeat(64);
      const sync = vi.fn()
        .mockResolvedValueOnce({ status: 'synced', versions: 1, conflicts: 0, canKeepLocal: false, approvals: 0, skipped: 1, compacted: 3, foreign: [foreignId], snapshot: undefined })
        .mockResolvedValueOnce({ removedForeign: 1 });
      const host = setup(sync); await ready(host);
      expect(await host.performSync(1, { kind: 'removeForeign', clientId })).toEqual({ ok: false, code: 'invalid' });
      expect(sync).not.toHaveBeenCalled();
      const reply = await host.performSync(1, { kind: 'synchronize', clientId });
      expect(reply).toMatchObject({ ok: true, state: { sync: { skipped: 1, compacted: 3 } } });
      expect(JSON.stringify(reply)).not.toContain(foreignId);
      expect(JSON.stringify(host.request(1, { kind: 'status', clientId }))).not.toContain(foreignId);
      const removed = await host.performSync(1, { kind: 'removeForeign', clientId });
      expect(sync).toHaveBeenLastCalledWith(expect.any(Object), expect.any(Object), expect.any(AbortSignal), { kind: 'removeForeign', ids: [foreignId] });
      expect(removed).toMatchObject({ ok: true, state: { sync: { skipped: 0, removedForeign: 1 } } });
      expect(JSON.stringify(removed)).not.toContain(foreignId);
      expect(await host.performSync(1, { kind: 'removeForeign', clientId })).toEqual({ ok: false, code: 'invalid' });
    });
  });
});
