import { describe, expect, it } from 'vitest';
import { parsePuttyReg, parseRegSections } from './import-putty';

const SESSIONS = 'HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions';
const reg = (...lines: string[]) => ['Windows Registry Editor Version 5.00', '', ...lines].join('\r\n');
/** Parses one session section with the given value lines. */
const one = (...lines: string[]) => parsePuttyReg(reg(`[${SESSIONS}\\s]`, ...lines));

/** Value names the PuTTY parser reads; everything else (ProxyPassword, Password, ...) is dropped. */
const WANTED = new Set(['HostName', 'PortNumber', 'UserName', 'Protocol', 'PublicKeyFile', 'ProxyMethod', 'PortForwardings']);

const sample = reg(
  `[${SESSIONS}\\Default%20Settings]`,
  '"HostName"=""',
  '"Protocol"="ssh"',
  '',
  `[${SESSIONS}\\web%2001]`,
  '"HostName"="10.0.0.5"',
  '"PortNumber"=dword:000008ae',
  '"UserName"="admin"',
  String.raw`"PublicKeyFile"="C:\\keys\\web.ppk"`,
  '"ProxyMethod"=dword:00000001',
  '"Password"="geheim"',
  '',
  `[${SESSIONS}\\router]`,
  '"Protocol"="telnet"',
  '"HostName"="192.168.1.1"',
  '"PortNumber"=dword:00000017',
  '',
  `[${SESSIONS}\\jenkins]`,
  '"HostName"="deploy@ci.example.com"',
  '"PortNumber"=dword:00000016',
  String.raw`"PublicKeyFile"="C:\\Users\\demo\\.ssh\\jenkins.ppk"`,
  '"PortForwardings"="L3000=localhost:3000,R2222=ci-internal:22,D1080,L4000=localhost:4000,X1=a:1"',
  '',
  '[HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY]',
  '"HostName"="other.example"',
);

describe('parseRegSections', () => {
  it('returns only sections directly below the prefix, raw name still encoded', () => {
    const text = reg(
      `[${SESSIONS}\\web%2001]`,
      '"HostName"="a"',
      `[${SESSIONS}\\nested\\deeper]`,
      '"HostName"="b"',
      `[${SESSIONS.toLowerCase()}]`,
      '"HostName"="c"',
      `[${SESSIONS.toUpperCase()}\\UPPER]`,
      '"HostName"="d"',
    );
    const sections = parseRegSections(text, SESSIONS, WANTED);
    expect(sections.map(s => s.raw)).toEqual(['web%2001', 'UPPER']);
    expect(sections[0].values.get('HostName')).toBe('a');
  });

  it('unescapes string values and reads dword values as numbers', () => {
    const text = reg(
      `[${SESSIONS}\\s]`,
      String.raw`"Quoted"="a\"b\\c"`,
      '"PortNumber"=dword:000008ae',
      '"Hex"=hex:01,02',
    );
    const values = parseRegSections(text, SESSIONS, new Set(['Quoted', 'PortNumber', 'Hex']))[0].values;
    expect(values.get('Quoted')).toBe('a"b\\c');
    expect(values.get('PortNumber')).toBe(0x8ae);
    expect(values.has('Hex')).toBe(false);
  });

  it('ignores continuation lines of multi-line values', () => {
    const text = reg(
      `[${SESSIONS}\\s]`,
      '"Hex"=hex(2):41,00,\\',
      '"HostName"="ignored.example"',
      '"HostName"="real.example"',
    );
    expect(parseRegSections(text, SESSIONS, WANTED)[0].values.get('HostName')).toBe('real.example');
  });

  it('keeps only wanted values, matching names case-insensitively', () => {
    const text = reg(
      `[${SESSIONS}\\s]`,
      '"ProxyPassword"="geheim1"',
      '"Password"="geheim2"',
      '"hostname"="h.example"',
    );
    const values = parseRegSections(text, SESSIONS, WANTED)[0].values;
    expect(values.has('ProxyPassword')).toBe(false);
    expect(values.has('Password')).toBe(false);
    expect(values.get('hostname')).toBe('h.example');
  });
});

describe('parsePuttyReg', () => {
  it('skips Default Settings and sections outside Sessions silently', () => {
    const preview = parsePuttyReg(sample);
    expect(preview.candidates.map(c => c.key)).toEqual(['web 01', 'jenkins']);
    expect(preview.skipped).toEqual([{ code: 'notSsh', count: 1 }]);
  });

  it('decodes the name, sets key, protocol ssh and empty folder', () => {
    const web = parsePuttyReg(sample).candidates[0];
    expect(web).toEqual({
      key: 'web 01',
      name: 'web 01',
      protocol: 'ssh',
      folder: [],
      host: '10.0.0.5',
      port: 2222,
      username: 'admin',
      keyPath: 'C:\\keys\\web.ppk',
      forwards: [],
      notes: ['ppkKey', 'proxyDropped'],
    });
    expect(web).not.toHaveProperty('jumpKey');
  });

  it('never reads the password', () => {
    expect(JSON.stringify(parsePuttyReg(sample))).not.toContain('geheim');
  });

  it('splits user@host and lets UserName win', () => {
    const jenkins = parsePuttyReg(sample).candidates[1];
    expect(jenkins.host).toBe('ci.example.com');
    expect(jenkins.username).toBe('deploy');
    const both = one('"HostName"="deploy@ci.example.com"', '"UserName"="root"');
    expect(both.candidates[0]).toMatchObject({ host: 'ci.example.com', username: 'root' });
  });

  it('takes the part before the last @ as user', () => {
    const c = one('"HostName"="a@b@host.example"').candidates[0];
    expect(c).toMatchObject({ host: 'host.example', username: 'a@b' });
  });

  it('omits username when neither UserName nor user@ is set', () => {
    expect(one('"HostName"="host.example"').candidates[0]).not.toHaveProperty('username');
  });

  it('defaults the port to 22', () => {
    expect(one('"HostName"="h.example"').candidates[0].port).toBe(22);
  });

  it('counts invalid entries: bad port, bad host, empty host', () => {
    const preview = parsePuttyReg(reg(
      `[${SESSIONS}\\a]`, '"HostName"="h1.example"', '"PortNumber"=dword:00000000',
      `[${SESSIONS}\\b]`, '"HostName"="with space"',
      `[${SESSIONS}\\c]`, '"HostName"=""',
      `[${SESSIONS}\\d]`, '"HostName"="h2.example"', '"PortNumber"=dword:00010000',
    ));
    expect(preview.candidates).toEqual([]);
    expect(preview.skipped).toEqual([{ code: 'invalid', count: 4 }]);
  });

  it('accepts a missing or ssh Protocol and counts other protocols as notSsh', () => {
    expect(one('"HostName"="h.example"', '"Protocol"="ssh"').candidates).toHaveLength(1);
    const raw = one('"HostName"="h.example"', '"Protocol"="raw"');
    expect(raw.candidates).toEqual([]);
    expect(raw.skipped).toEqual([{ code: 'notSsh', count: 1 }]);
  });

  it('sets the key file only from PublicKeyFile and flags .ppk case-insensitively', () => {
    const plain = one('"HostName"="h.example"', String.raw`"PublicKeyFile"="C:\\k\\id_ed25519"`).candidates[0];
    expect(plain.keyPath).toBe('C:\\k\\id_ed25519');
    expect(plain.notes).toEqual([]);
    expect(one('"HostName"="h.example"', String.raw`"PublicKeyFile"="C:\\k\\KEY.PPK"`).candidates[0].notes).toEqual(['ppkKey']);
  });

  it('flags a proxy only when ProxyMethod is not 0', () => {
    expect(one('"HostName"="h.example"', '"ProxyMethod"=dword:00000000').candidates[0].notes).toEqual([]);
    expect(one('"HostName"="h.example"', '"ProxyMethod"=dword:00000003').candidates[0].notes).toEqual(['proxyDropped']);
  });

  it('parses local, remote and dynamic forwards', () => {
    const forwards = one('"HostName"="h.example"',
      '"PortForwardings"="L127.0.0.1:8080=db:5432,R2222=ci-internal:22,D1080"').candidates[0].forwards;
    expect(forwards).toEqual([
      { kind: 'local', localPort: 8080, targetHost: 'db', targetPort: 5432 },
      { kind: 'remote', remotePort: 2222, targetHost: 'ci-internal', targetPort: 22 },
      { kind: 'dynamic', localPort: 1080 },
    ]);
  });

  it('keeps a port starting with 4 or 6 when the family digit reading fails', () => {
    const c = one('"HostName"="h.example"', '"PortForwardings"="L4000=localhost:4000"').candidates[0];
    expect(c.forwards).toEqual([{ kind: 'local', localPort: 4000, targetHost: 'localhost', targetPort: 4000 }]);
  });

  it('drops invalid forwards with forwardsDropped and keeps the valid ones', () => {
    const c = one('"HostName"="h.example"',
      '"PortForwardings"="X1=a:1,Lxx=a:1,L3000=localhost,L3001=localhost:0,L3002=localhost:80"').candidates[0];
    expect(c.forwards).toEqual([{ kind: 'local', localPort: 3002, targetHost: 'localhost', targetPort: 80 }]);
    expect(c.notes).toEqual(['forwardsDropped']);
  });

  it('keeps at most 16 forwards', () => {
    const list = Array.from({ length: 17 }, (_, i) => `D${1000 + i}`).join(',');
    const c = one('"HostName"="h.example"', `"PortForwardings"="${list}"`).candidates[0];
    expect(c.forwards).toHaveLength(16);
    expect(c.notes).toEqual(['forwardsDropped']);
  });

  it('marks candidates beyond 500 as tooMany', () => {
    const lines = Array.from({ length: 501 }, (_, i) => [`[${SESSIONS}\\s${i}]`, '"HostName"="h.example"']).flat();
    const preview = parsePuttyReg(reg(...lines));
    expect(preview.candidates).toHaveLength(500);
    expect(preview.skipped).toEqual([{ code: 'tooMany', count: 1 }]);
  });

  it('ignores continuation lines', () => {
    const c = parsePuttyReg(reg(
      `[${SESSIONS}\\cont]`,
      '"Hex"=hex:01,\\',
      '"HostName"="bad host"',
      '"HostName"="cont.example"',
    )).candidates[0];
    expect(c.host).toBe('cont.example');
  });

  it('returns an empty preview for text without sessions', () => {
    expect(parsePuttyReg(reg())).toEqual({ candidates: [], skipped: [] });
  });
});
