import { describe, expect, it } from 'vitest';
import { parseWinScp } from './import-winscp';

const REG_HEAD = 'Windows Registry Editor Version 5.00';
const KEY = '[HKEY_CURRENT_USER\\Software\\Martin Prikryl\\WinSCP 2\\Sessions\\';

/** Builds a synthetic reg export; each section is [name, lines]. */
function reg(sections: [string, string[]][]): string {
  return [REG_HEAD, ...sections.flatMap(([name, lines]) => ['', KEY + name + ']', ...lines])].join('\r\n');
}

/** Builds a synthetic WinSCP.ini; each section is [name, lines]. */
function ini(sections: [string, string[]][]): string {
  return sections.flatMap(([name, lines]) => ['[Sessions\\' + name + ']', ...lines, '']).join('\n');
}

const dword = (n: number) => `dword:${n.toString(16).padStart(8, '0')}`;

describe('parseWinScp reg export', () => {
  it('reads host, port, user and key path, skips Default Settings', () => {
    const text = reg([
      ['Default%20Settings', ['"HostName"="default.example"']],
      ['build', [
        '"HostName"="build.example"', `"PortNumber"=${dword(2222)}`, '"UserName"="deploy"',
        '"PublicKeyFile"="C:\\\\keys\\\\id_ed25519"', '"FSProtocol"=dword:00000002',
      ]],
    ]);
    const r = parseWinScp(text);
    expect(r.skipped).toEqual([]);
    expect(r.candidates).toEqual([{
      key: 'build', name: 'build', protocol: 'sftp', folder: [], host: 'build.example', port: 2222,
      username: 'deploy', keyPath: 'C:\\keys\\id_ed25519', forwards: [], notes: [],
    }]);
  });

  it('puts the part before a slash into the folder', () => {
    const r = parseWinScp(reg([['Prod/files-02', ['"HostName"="files.example"']]]));
    expect(r.candidates[0]).toMatchObject({ key: 'Prod/files-02', name: 'files-02', folder: ['Prod'] });
  });

  it('decodes %XX in names', () => {
    const r = parseWinScp(reg([['web%2001', ['"HostName"="web.example"']], ['a%2Fb', ['"HostName"="x.example"']]]));
    expect(r.candidates.map(c => [c.key, c.name, c.folder])).toEqual([
      ['web 01', 'web 01', []],
      ['a/b', 'b', ['a']],
    ]);
  });

  it('imports SCP as SFTP with a note', () => {
    const r = parseWinScp(reg([['legacy-scp', ['"HostName"="scp.example"', '"FSProtocol"=dword:00000000']]]));
    expect(r.candidates[0]).toMatchObject({ protocol: 'sftp', notes: ['scpAsSftp'] });
  });

  it('skips FTP, WebDAV and S3 as unsupported', () => {
    const r = parseWinScp(reg([
      ['ftp-site', ['"HostName"="ftp.example"', '"FSProtocol"=dword:00000005']],
      ['dav', ['"HostName"="dav.example"', '"FSProtocol"=dword:00000006']],
      ['dav-s', ['"HostName"="dav2.example"', '"FSProtocol"=dword:00000007']],
      ['s3', ['"HostName"="s3.example"', '"FSProtocol"=dword:00000008']],
    ]));
    expect(r.candidates).toEqual([]);
    expect(r.skipped).toEqual([{ code: 'unsupported', count: 4 }]);
  });

  it('notes PPK keys and tunnels without importing a jump host', () => {
    const r = parseWinScp(reg([['jenkins', [
      '"HostName"="jenkins.example"', '"PublicKeyFile"="C:\\\\keys\\\\jenkins.PPK"', '"Tunnel"=dword:00000001',
    ]]]));
    expect(r.candidates[0]).toMatchObject({
      keyPath: 'C:\\keys\\jenkins.PPK', notes: ['ppkKey', 'jumpUnsupported'],
    });
    expect(r.candidates[0].jumpKey).toBeUndefined();
  });

  it('counts invalid hosts and ports', () => {
    const r = parseWinScp(reg([
      ['no-host', ['"PortNumber"=dword:00000016']],
      ['bad-host', ['"HostName"="bad host"']],
      ['bad-port', ['"HostName"="p.example"', `"PortNumber"=${dword(70000)}`]],
      ['ok', ['"HostName"="ok.example"']],
    ]));
    expect(r.candidates.map(c => c.key)).toEqual(['ok']);
    expect(r.skipped).toEqual([{ code: 'invalid', count: 3 }]);
  });

  it('never reads or returns passwords', () => {
    const text = reg([['pw', ['"HostName"="pw.example"', '"Password"="s3cr3t-reg-value"', '"TunnelPassword"="s3cr3t-tunnel"']]]);
    const r = parseWinScp(text);
    expect(r.candidates).toHaveLength(1);
    expect(JSON.stringify(r)).not.toContain('s3cr3t');
  });

  it('ignores other sections and nested keys', () => {
    const text = [REG_HEAD, '', '[HKEY_CURRENT_USER\\Software\\Martin Prikryl\\WinSCP 2\\Config]',
      '"HostName"="config.example"', '', KEY + 'a\\nested]', '"HostName"="nested.example"'].join('\r\n');
    expect(parseWinScp(text).candidates).toEqual([]);
  });
});

describe('parseWinScp WinSCP.ini', () => {
  it('reads ini sections and decodes values', () => {
    const text = ini([
      ['Default%20Settings', ['HostName=default.example']],
      ['web%2001', ['HostName=web.example', 'PortNumber=2222', 'UserName=ann%40corp', 'FSProtocol=1']],
      ['legacy', ['HostName=scp.example', 'FSProtocol=0']],
      ['ftp-site', ['HostName=ftp.example', 'FSProtocol=5']],
    ]);
    const r = parseWinScp(text);
    expect(r.candidates).toEqual([
      { key: 'web 01', name: 'web 01', protocol: 'sftp', folder: [], host: 'web.example', port: 2222,
        username: 'ann@corp', forwards: [], notes: [] },
      { key: 'legacy', name: 'legacy', protocol: 'sftp', folder: [], host: 'scp.example', port: 22,
        forwards: [], notes: ['scpAsSftp'] },
    ]);
    expect(r.skipped).toEqual([{ code: 'unsupported', count: 1 }]);
  });

  it('matches the section header case-insensitively and ignores nested or other sections', () => {
    const text = [
      '[sessions\\lower]', 'HostName=lower.example',
      '[Sessions\\a\\b]', 'HostName=nested.example',
      '[Config]', 'HostName=config.example', '',
    ].join('\n');
    const r = parseWinScp(text);
    expect(r.candidates.map(c => c.key)).toEqual(['lower']);
    expect(r.skipped).toEqual([]);
  });

  it('keeps Tunnel and ppk notes and drops ini passwords', () => {
    const text = ini([['tun', [
      'HostName=tun.example', 'Tunnel=1', 'PublicKeyFile=C:\\keys\\a.ppk',
      'Password=s3cr3t-ini-value', 'TunnelPassword=s3cr3t-ini-tunnel',
    ]]]);
    const r = parseWinScp(text);
    expect(r.candidates[0]).toMatchObject({ keyPath: 'C:\\keys\\a.ppk', notes: ['ppkKey', 'jumpUnsupported'] });
    expect(JSON.stringify(r)).not.toContain('s3cr3t');
  });
});

describe('parseWinScp limits', () => {
  it('caps candidates at 500 and counts the rest as tooMany', () => {
    const sections: [string, string[]][] = Array.from({ length: 502 }, (_, i) => [`s${i}`, [`HostName=h${i}.example`]]);
    sections.push(['bad', ['PortNumber=0', 'HostName=bad.example']]);
    const r = parseWinScp(ini(sections));
    expect(r.candidates).toHaveLength(500);
    expect(r.skipped).toEqual([{ code: 'invalid', count: 1 }, { code: 'tooMany', count: 2 }]);
  });
});
