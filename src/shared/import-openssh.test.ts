import { describe, expect, it } from 'vitest';
import { AppError } from './errors';
import { globMatch, parseOpenSshConfig } from './import-openssh';

const HOME = 'C:\\Users\\demo';
const parse = (lines: string[], eol = '\n') => parseOpenSshConfig(lines.join(eol), HOME);
const timed = <T>(fn: () => T): { value: T; ms: number } => {
  const start = performance.now();
  const value = fn();
  return { value, ms: performance.now() - start };
};
const find = (result: ReturnType<typeof parse>, key: string) => {
  const candidate = result.candidates.find(c => c.key === key);
  if (!candidate) throw new Error(`no candidate ${key}`);
  return candidate;
};
const skipped = (result: ReturnType<typeof parse>) => Object.fromEntries(result.skipped.map(s => [s.code, s.count]));

describe('parseOpenSshConfig', () => {
  it('reads a Host block into an ssh candidate', () => {
    expect(parse(['Host web', '  HostName 10.0.0.5', '  Port 2222', '  User admin'])).toEqual({
      candidates: [{ key: 'web', name: 'web', protocol: 'ssh', folder: [], host: '10.0.0.5', port: 2222, username: 'admin', forwards: [], notes: [] }],
      skipped: [],
    });
  });

  it('uses the alias as host, port 22 and no user as defaults', () => {
    const candidate = find(parse(['Host db-01']), 'db-01');
    expect(candidate).toMatchObject({ host: 'db-01', port: 22 });
    expect(candidate.username).toBeUndefined();
  });

  it('applies the first value, and Host * defaults come first', () => {
    const candidate = find(parse(['Host *', '  User demo', '  Port 2200', 'Host web', '  User other', '  Port 2222', '  HostName 10.0.0.5']), 'web');
    expect(candidate).toMatchObject({ host: '10.0.0.5', port: 2200, username: 'demo' });
  });

  it('treats lines before the first Host as a * block', () => {
    expect(find(parse(['User top', 'Host a']), 'a').username).toBe('top');
  });

  it('keeps the order of first appearance and drops duplicate aliases', () => {
    const result = parse(['Host b a', 'Host a c', 'Host b']);
    expect(result.candidates.map(c => c.key)).toEqual(['b', 'a', 'c']);
  });

  it('yields only concrete aliases of a multi-pattern Host line', () => {
    expect(parse(['Host p1 *.x p2 h?']).candidates.map(c => c.key)).toEqual(['p1', 'p2']);
  });

  it('excludes a negated pattern from the block', () => {
    const result = parse(['Host *.internal !skip.internal', '  User ops', 'Host skip.internal app.internal']);
    expect(find(result, 'skip.internal').username).toBeUndefined();
    expect(find(result, 'app.internal').username).toBe('ops');
  });

  it('matches globs case-insensitively with * and ?', () => {
    const result = parse(['Host WEB*', '  User ops', 'Host web-01', 'Host db?', '  User dbu', 'Host db1 db10']);
    expect(result.candidates.map(c => c.key)).toEqual(['web-01', 'db1', 'db10']);
    expect(find(result, 'web-01').username).toBe('ops');
    expect(find(result, 'db1').username).toBe('dbu');
    expect(find(result, 'db10').username).toBeUndefined();
  });

  it('yields no candidate from wildcard-only or negated-only Host lines', () => {
    expect(parse(['Host *', '  User demo']).candidates).toEqual([]);
    expect(parse(['Host !x*', '  User demo']).candidates).toEqual([]);
  });

  it('skips Match blocks and counts them, Include inside them is not counted', () => {
    const result = parse(['Match host x', '  User nope', '  Include a.conf', 'Host a', '  User yes']);
    expect(find(result, 'a').username).toBe('yes');
    expect(skipped(result)).toEqual({ match: 1 });
  });

  it('counts Include lines and ignores them', () => {
    const result = parse(['Include config.d/*', 'Host a', 'Include other']);
    expect(result.candidates.map(c => c.key)).toEqual(['a']);
    expect(skipped(result)).toEqual({ include: 2 });
  });

  it('reads keyword=value, case-insensitive keywords, comments, CRLF and quotes', () => {
    const result = parse(['# top comment', '', 'host=web', '  hostname = 10.0.0.7', '  PORT 2022', '  User "Anna Schmidt"', 'Host "web one"', '  HostName 10.0.0.8'], '\r\n');
    expect(find(result, 'web')).toMatchObject({ host: '10.0.0.7', port: 2022, username: 'Anna Schmidt' });
    expect(find(result, 'web one')).toMatchObject({ host: '10.0.0.8', port: 22 });
  });

  it('expands %h and %% in HostName', () => {
    const result = parse(['Host web', '  HostName %h.corp.local', 'Host plain', '  HostName a%%b.example', 'Host 10.0.0.9']);
    expect(find(result, 'web').host).toBe('web.corp.local');
    expect(find(result, 'plain').host).toBe('a%b.example');
    expect(find(result, '10.0.0.9').host).toBe('10.0.0.9');
  });

  it('drops candidates with an invalid port or host and counts them as invalid', () => {
    const result = parse(['Host p0', '  Port 0', 'Host p1', '  Port 65536', 'Host p2', '  Port 22x', 'Host bad', '  HostName bad host', 'Host ok']);
    expect(result.candidates.map(c => c.key)).toEqual(['ok']);
    expect(skipped(result)).toEqual({ invalid: 4 });
  });

  it('drops a user name containing %', () => {
    const result = parse(['Host a', '  User %r', 'Host b', '  User demo']);
    expect(find(result, 'a').username).toBeUndefined();
    expect(find(result, 'b').username).toBe('demo');
  });

  it('resolves IdentityFile to a path and never reads it', () => {
    const result = parse([
      'Host a', '  IdentityFile ~/.ssh/id_ed25519',
      'Host b', '  IdentityFile %d/.ssh/id_rsa',
      'Host c', '  IdentityFile keys/work',
      'Host d', '  IdentityFile C:/keys/id',
      'Host e', '  IdentityFile \\\\srv\\share\\id',
      'Host f', '  IdentityFile keys/%r',
      'Host g', '  IdentityFile "C:\\My Keys\\id"',
      'Host h', '  IdentityFile first', '  IdentityFile second',
    ]);
    expect(find(result, 'a').keyPath).toBe('C:\\Users\\demo\\.ssh\\id_ed25519');
    expect(find(result, 'b').keyPath).toBe('C:\\Users\\demo\\.ssh\\id_rsa');
    expect(find(result, 'c').keyPath).toBe('C:\\Users\\demo\\.ssh\\keys\\work');
    expect(find(result, 'd').keyPath).toBe('C:\\keys\\id');
    expect(find(result, 'e').keyPath).toBe('\\\\srv\\share\\id');
    expect(find(result, 'f').notes).toEqual(['keyUnresolved']);
    expect(find(result, 'f').keyPath).toBeUndefined();
    expect(find(result, 'g').keyPath).toBe('C:\\My Keys\\id');
    expect(find(result, 'h').keyPath).toBe('C:\\Users\\demo\\.ssh\\first');
  });

  it('keeps one hop to a concrete alias of the same file', () => {
    const result = parse(['Host build', 'Host db', '  ProxyJump build', 'Host chain1', '  ProxyJump build']);
    expect(find(result, 'db').jumpKey).toBe('build');
    expect(find(result, 'chain1').jumpKey).toBe('build');
    expect(find(result, 'build').jumpKey).toBeUndefined();
  });

  it('drops ProxyJump with a note when it is not one hop to a same-file alias', () => {
    const result = parse([
      'Host build', 'Host nojump', '  ProxyJump none',
      'Host multi', '  ProxyJump build,other',
      'Host at', '  ProxyJump me@build',
      'Host port', '  ProxyJump build:22',
      'Host ghost', '  ProxyJump unknown',
      'Host chain2', '  ProxyJump db',
      'Host db', '  ProxyJump build',
      'Host self', '  ProxyJump self',
      'Host badtarget', '  HostName bad host',
      'Host viabad', '  ProxyJump badtarget',
    ]);
    expect(find(result, 'nojump').notes).toEqual([]);
    expect(find(result, 'nojump').jumpKey).toBeUndefined();
    for (const key of ['multi', 'at', 'port', 'ghost', 'chain2', 'self', 'viabad']) {
      expect(find(result, key).jumpKey).toBeUndefined();
      expect(find(result, key).notes).toEqual(['jumpUnsupported']);
    }
    expect(result.candidates.map(c => c.key)).not.toContain('badtarget');
  });

  it('notes ProxyCommand unless it is none', () => {
    const result = parse(['Host proxied', '  ProxyCommand ssh -W %h:%p bastion', 'Host plain', '  ProxyCommand none']);
    expect(find(result, 'proxied').notes).toEqual(['proxyDropped']);
    expect(find(result, 'plain').notes).toEqual([]);
  });

  it('reads local, remote and dynamic forwards with bind addresses and IPv6 targets', () => {
    const result = parse([
      'Host fw',
      '  LocalForward 8080 db-internal:5432',
      '  LocalForward 127.0.0.1:15433 db-internal:5432',
      '  LocalForward 15434 [fe80::1]:5432',
      '  RemoteForward 9000 localhost:3000',
      '  DynamicForward 1080',
      '  DynamicForward 127.0.0.1:1081',
    ]);
    expect(find(result, 'fw').forwards).toEqual([
      { kind: 'local', localPort: 8080, targetHost: 'db-internal', targetPort: 5432 },
      { kind: 'local', localPort: 15433, targetHost: 'db-internal', targetPort: 5432 },
      { kind: 'local', localPort: 15434, targetHost: 'fe80::1', targetPort: 5432 },
      { kind: 'remote', remotePort: 9000, targetHost: 'localhost', targetPort: 3000 },
      { kind: 'dynamic', localPort: 1080 },
      { kind: 'dynamic', localPort: 1081 },
    ]);
    expect(find(result, 'fw').notes).toEqual([]);
  });

  it('drops socket paths and invalid forwards with one forwardsDropped note', () => {
    const result = parse([
      'Host sock',
      '  LocalForward /tmp/agent.sock localhost:80',
      '  RemoteForward 9001 /var/run/x.sock',
      '  RemoteForward 9002',
      '  LocalForward 8080 host:0',
      '  DynamicForward 1080 extra',
      '  LocalForward 8081 nohost',
    ]);
    expect(find(result, 'sock').forwards).toEqual([]);
    expect(find(result, 'sock').notes).toEqual(['forwardsDropped']);
  });

  it('keeps 16 forwards and drops the 17th with forwardsDropped', () => {
    const lines = ['Host many', ...Array.from({ length: 17 }, (_, i) => `  DynamicForward ${1000 + i}`)];
    const candidate = find(parse(lines), 'many');
    expect(candidate.forwards.map(f => (f.kind === 'dynamic' ? f.localPort : 0))).toEqual(Array.from({ length: 16 }, (_, i) => 1000 + i));
    expect(candidate.notes).toEqual(['forwardsDropped']);
  });

  it('collects forwards over all matching blocks in file order', () => {
    const result = parse(['Host *', '  DynamicForward 1080', 'Host a', '  LocalForward 8080 x:80', 'Host b']);
    expect(find(result, 'a').forwards).toEqual([
      { kind: 'dynamic', localPort: 1080 },
      { kind: 'local', localPort: 8080, targetHost: 'x', targetPort: 80 },
    ]);
    expect(find(result, 'b').forwards).toEqual([{ kind: 'dynamic', localPort: 1080 }]);
  });

  it('keeps 500 aliases and counts the rest as tooMany', () => {
    const hosts = (n: number) => Array.from({ length: n }, (_, i) => `Host h${i + 1}`);
    const full = parse(hosts(500));
    expect(full.candidates).toHaveLength(500);
    expect(full.skipped).toEqual([]);
    const over = parse(hosts(501));
    expect(over.candidates).toHaveLength(500);
    expect(over.skipped).toEqual([{ code: 'tooMany', count: 1 }]);
  });

  it('returns nothing for empty text', () => {
    expect(parse([])).toEqual({ candidates: [], skipped: [] });
  });

  it('stays under 100 ms with a pathological glob next to a long alias', () => {
    const alias = `Host ${'a'.repeat(40)}`;
    const { value, ms } = timed(() => parse(['Host *a*a*a*a*a*a*a*a*a*a*b', alias]));
    expect(ms).toBeLessThan(100);
    expect(value.candidates.map(c => c.key)).toEqual(['a'.repeat(40)]);
  });

  it('stays under 2 s with 100,000 Host lines and counts the ignored blocks as tooMany', () => {
    const lines = Array.from({ length: 100_000 }, (_, i) => `Host h${i + 1}`);
    const { value, ms } = timed(() => parse(lines));
    expect(ms).toBeLessThan(2000);
    expect(value.candidates).toHaveLength(500);
    // 95,001 ignored Host lines (from the 5,000th on, the 5,000th exhausts the pattern budget) plus 4,499 aliases beyond 500.
    expect(skipped(value)).toEqual({ tooMany: 99_500 });
  });

  it('keeps 5,000 patterns over all blocks and counts one tooMany for the Host line that overflows', () => {
    const line = `Host ${Array.from({ length: 5_001 }, (_, i) => `p${i}`).join(' ')}`;
    const result = parse([line]);
    expect(result.candidates).toHaveLength(500);
    // 4,999 concrete aliases (the * block takes one slot): 4,499 beyond 500, plus the overflow line.
    expect(skipped(result)).toEqual({ tooMany: 4_500 });
  });

  it('ignores patterns over 255 characters silently and counts aliases over 255 as invalid', () => {
    const result = parse([`Host ${'a'.repeat(256)} ${'b'.repeat(253)} ${'*'.repeat(256)} w`, '  User demo']);
    expect(result.candidates.map(c => c.key)).toEqual(['b'.repeat(253), 'w']);
    expect(skipped(result)).toEqual({ invalid: 1 });
  });

  it('stays under 1 s with 500 aliases and one Host line of 1,000,000 patterns', () => {
    const lines = [
      ...Array.from({ length: 500 }, (_, i) => `Host h${i + 1}`),
      `Host ${'?x '.repeat(1_000_000).trimEnd()}`,
    ];
    const { value, ms } = timed(() => parse(lines));
    expect(ms).toBeLessThan(1000);
    expect(value.candidates).toHaveLength(500);
    expect(skipped(value)).toEqual({ tooMany: 1 });
  });

  it('stays under 1 s with 500 aliases of 2,000 characters and 200 patterns of 1,000 characters', () => {
    const lines = [
      ...Array.from({ length: 500 }, (_, i) => `Host ${String(i).padEnd(2_000, 'x')}`),
      `Host ${Array.from({ length: 200 }, () => `*a${'a'.repeat(997)}b`).join(' ')}`,
    ];
    const { value, ms } = timed(() => parse(lines));
    expect(ms).toBeLessThan(1000);
    expect(value.candidates).toEqual([]);
    expect(skipped(value)).toEqual({ invalid: 500 });
  });

  it('throws core.importTooComplex when the glob steps of one parse run exceed the budget', () => {
    const lines = [
      ...Array.from({ length: 500 }, (_, i) => `Host ${'a'.repeat(200)}${i}`),
      `Host ${Array.from({ length: 200 }, () => `*${'a'.repeat(200)}b`).join(' ')}`,
    ];
    const start = performance.now();
    let caught: unknown;
    try {
      parse(lines);
    } catch (error) {
      caught = error;
    }
    expect(performance.now() - start).toBeLessThan(1000);
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).toCoded().code).toBe('core.importTooComplex');
  });
});

describe('globMatch', () => {
  it('matches * as any run, including empty, and ? as exactly one character', () => {
    expect(globMatch('*', '')).toBe(true);
    expect(globMatch('*', 'abc')).toBe(true);
    expect(globMatch('a*c', 'ac')).toBe(true);
    expect(globMatch('a?c', 'abc')).toBe(true);
    expect(globMatch('a?c', 'ac')).toBe(false);
    expect(globMatch('a?c', 'abbc')).toBe(false);
  });

  it('matches the whole string, case-insensitively, with dots literal', () => {
    expect(globMatch('web', 'webx')).toBe(false);
    expect(globMatch('web*', 'WEB-01')).toBe(true);
    expect(globMatch('a.b', 'axb')).toBe(false);
    expect(globMatch('', '')).toBe(true);
    expect(globMatch('', 'a')).toBe(false);
  });

  it('backtracks to the last * only and treats a literal * in the text as a character', () => {
    expect(globMatch('*a*b', 'xaxab')).toBe(true);
    expect(globMatch('*a*b', 'xaxa')).toBe(false);
    expect(globMatch('a*b*c', 'abxbxc')).toBe(true);
    expect(globMatch('a*', 'a*')).toBe(true);
    expect(globMatch('a?', 'a*')).toBe(true);
  });

  it('stays fast on a pathological pattern', () => {
    const { value, ms } = timed(() => globMatch(`${'*a'.repeat(10)}*b`, 'a'.repeat(40)));
    expect(value).toBe(false);
    expect(ms).toBeLessThan(100);
  });
});
