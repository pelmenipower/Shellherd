import { describe, expect, it } from 'vitest';

import { parseImport } from './import-parse';

const HOME = 'C:/Users/demo';

describe('parseImport', () => {
  it('dispatches OpenSSH to the OpenSSH parser with the home directory', () => {
    const result = parseImport('openssh', 'Host web\n  HostName 10.0.0.1\n', HOME);
    expect(result.candidates).toMatchObject([{ key: 'web', host: '10.0.0.1' }]);
  });

  it('dispatches PuTTY to the .reg parser', () => {
    const text = '[HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\web%2001]\r\n"HostName"="10.0.0.1"\r\n"PortNumber"=dword:00000016\r\n';
    expect(parseImport('putty', text, HOME).candidates).toMatchObject([{ key: 'web 01', host: '10.0.0.1', port: 22 }]);
  });

  it('dispatches WinSCP to the WinSCP parser', () => {
    const text = '[HKEY_CURRENT_USER\\Software\\Martin Prikryl\\WinSCP 2\\Sessions\\prod]\r\n"HostName"="files.example"\r\n';
    expect(parseImport('winscp', text, HOME).candidates).toMatchObject([{ key: 'prod', host: 'files.example', protocol: 'sftp' }]);
  });

  it('dispatches mRemoteNG to the XML parser', () => {
    const xml = '<Connections><Node Name="web" Type="Connection" Hostname="10.0.0.2" Protocol="SSH2" Port="2222" /></Connections>';
    expect(parseImport('mremoteng', xml, HOME).candidates).toMatchObject([{ key: 'web', host: '10.0.0.2', port: 2222 }]);
  });
});
