import { describe, expect, it } from 'vitest';
import { launchCommand, registryEntries, vaultFileFromArgs } from './file-association';

describe('vault file association', () => {
  it('finds an existing vault file among Explorer arguments', () => {
    const exists = (path: string) => path !== 'C:\\missing.term';
    expect(vaultFileFromArgs(['C:\\app\\electron.exe', 'C:\\app', 'C:\\Vaults\\Prod.TERM'], exists)).toBe('C:\\Vaults\\Prod.TERM');
    expect(vaultFileFromArgs(['electron.exe', 'C:\\old.terminus'], exists)).toBe('C:\\old.terminus');
    expect(vaultFileFromArgs(['electron.exe', 'C:\\missing.term'], exists)).toBeNull();
    expect(vaultFileFromArgs(['electron.exe', 'relative.term', '--flag'], exists)).toBeNull();
  });

  it('quotes the launch command and passes the app folder only in development', () => {
    expect(launchCommand('C:\\Program Files\\Terminus\\Terminus.exe', null)).toBe('"C:\\Program Files\\Terminus\\Terminus.exe" "%1"');
    expect(launchCommand('C:\\dev\\electron.exe', 'C:\\dev\\Terminus')).toBe('"C:\\dev\\electron.exe" "C:\\dev\\Terminus" "%1"');
  });

  it('writes only per-user keys and names the open verb', () => {
    const entries = registryEntries('"x.exe" "%1"', '"x.exe",0');
    expect(entries.every(args => args[1].startsWith('HKCU\\Software\\Classes\\'))).toBe(true);
    expect(entries).toContainEqual(['add', 'HKCU\\Software\\Classes\\.term', '/ve', '/t', 'REG_SZ', '/d', 'Terminus.Vault', '/f']);
    expect(entries).toContainEqual(['add', 'HKCU\\Software\\Classes\\Terminus.Vault\\shell\\open', '/ve', '/t', 'REG_SZ', '/d', 'Mit Terminus öffnen', '/f']);
    expect(entries.at(-1)).toEqual(['add', 'HKCU\\Software\\Classes\\Terminus.Vault\\shell\\open\\command', '/ve', '/t', 'REG_SZ', '/d', '"x.exe" "%1"', '/f']);
  });
});
