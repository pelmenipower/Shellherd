import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileAssociation, iconValue, launchCommand, legacyRegistryDeletes, pointsToVaultProgId, registryEntries, vaultFileFromArgs } from './file-association';

describe('vault file association', () => {
  it.runIf(process.platform === 'win32')('finds an existing vault file among Explorer arguments', () => {
    const exists = (path: string) => path !== 'C:\\missing.term';
    expect(vaultFileFromArgs(['C:\\app\\electron.exe', 'C:\\app', 'C:\\Vaults\\Prod.TERM'], exists)).toBe('C:\\Vaults\\Prod.TERM');
    expect(vaultFileFromArgs(['electron.exe', 'C:\\old.terminus'], exists)).toBe('C:\\old.terminus');
    expect(vaultFileFromArgs(['electron.exe', 'C:\\missing.term'], exists)).toBeNull();
    expect(vaultFileFromArgs(['electron.exe', 'relative.term', '--flag'], exists)).toBeNull();
  });

  it('quotes the launch command and passes the app folder only in development', () => {
    expect(launchCommand('C:\\Program Files\\Shellherd\\Shellherd.exe', null)).toBe('"C:\\Program Files\\Shellherd\\Shellherd.exe" "%1"');
    expect(launchCommand('C:\\dev\\electron.exe', 'C:\\dev\\Shellherd')).toBe('"C:\\dev\\electron.exe" "C:\\dev\\Shellherd" "%1"');
  });

  it('writes only per-user keys and names the open verb', () => {
    const entries = registryEntries('"x.exe" "%1"', '"x.exe",0');
    expect(entries.every(args => args[1].startsWith('HKCU\\Software\\Classes\\'))).toBe(true);
    expect(entries).toContainEqual(['add', 'HKCU\\Software\\Classes\\.term', '/ve', '/t', 'REG_SZ', '/d', 'Shellherd.Vault', '/f']);
    expect(entries).toContainEqual(['add', 'HKCU\\Software\\Classes\\Shellherd.Vault\\shell\\open', '/ve', '/t', 'REG_SZ', '/d', 'Mit Shellherd öffnen', '/f']);
    expect(entries.at(-1)).toEqual(['add', 'HKCU\\Software\\Classes\\Shellherd.Vault\\shell\\open\\command', '/ve', '/t', 'REG_SZ', '/d', '"x.exe" "%1"', '/f']);
  });

  it('removes only the legacy per-user keys', () => {
    const deletes = legacyRegistryDeletes();
    expect(deletes).toEqual([
      ['delete', 'HKCU\\Software\\Classes\\Terminus.Vault', '/f'],
      ['delete', 'HKCU\\Software\\Classes\\.term\\OpenWithProgids', '/v', 'Terminus.Vault', '/f'],
      ['delete', 'HKCU\\Software\\Classes\\.terminus\\OpenWithProgids', '/v', 'Terminus.Vault', '/f'],
    ]);
    expect(deletes.every(args => args[1].startsWith('HKCU\\Software\\Classes\\'))).toBe(true);
    expect(deletes.some(args => args[1] === 'HKCU\\Software\\Classes\\.term' || /Microsoft/.test(args[1]))).toBe(false);
  });

  it('recognises our ProgIDs in a .term default value', () => {
    expect(pointsToVaultProgId('    (Standard)    REG_SZ    Shellherd.Vault')).toBe(true);
    expect(pointsToVaultProgId('    (Standard)    REG_SZ    Terminus.Vault')).toBe(true);
    expect(pointsToVaultProgId('    (Standard)    REG_SZ    SomeEditor.term')).toBe(false);
    expect(pointsToVaultProgId('')).toBe(false);
  });

  it('quotes the icon path for DefaultIcon', () => {
    expect(iconValue('C:\\a b\\icon.ico')).toBe('"C:\\a b\\icon.ico",0');
  });
});

describe('FileAssociation errors', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('refuses outside Windows with a coded error', async () => {
    vi.stubGlobal('process', Object.create(process, { platform: { value: 'linux' } }));
    await expect(new FileAssociation('x', null).register()).rejects.toMatchObject({ code: 'core.fileAssociationWindowsOnly' });
  });
});
