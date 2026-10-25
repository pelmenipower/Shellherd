import { describe, expect, it, vi } from 'vitest';
import { droppedVaultPath, VaultPathGrants, vaultPathAllowed } from './path-grants';

// Spies on the file system: an allowed-path check must never touch a file.
const fsSpies = vi.hoisted(() => ({ stat: vi.fn(), readFile: vi.fn() }));
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, stat: fsSpies.stat, readFile: fsSpies.readFile };
});

describe('droppedVaultPath', () => {
  it.each([
    ['C:\\a\\v.term', 'C:\\a\\v.term'],
    ['c:/a/v.TERM', 'c:\\a\\v.TERM'],
    ['C:\\a\\..\\v.terminus', 'C:\\v.terminus'],
  ])('accepts %s', (raw, expected) => {
    expect(droppedVaultPath(raw)).toBe(expected);
  });

  it.each([
    '\\\\srv\\s\\v.term',
    '//srv/s/v.term',
    '\\\\?\\C:\\v.term',
    '\\\\.\\pipe\\v.term',
    'v.term',
    'C:v.term',
    'C:\\a\\v.txt',
    42,
    null,
    `C:\\${'a'.repeat(5000)}.term`,
  ])('refuses %j', raw => {
    expect(droppedVaultPath(raw)).toBeNull();
  });
});

describe('VaultPathGrants', () => {
  it('matches a granted path in another spelling and no other path', () => {
    const grants = new VaultPathGrants();
    grants.grant('C:\\A\\v.term');
    expect(grants.has('c:\\a\\V.term')).toBe(true);
    expect(grants.has('C:\\b.term')).toBe(false);
  });

  it('folds ASCII case only', () => {
    const grants = new VaultPathGrants();
    grants.grant('C:\\Vaults\\A.term');
    expect(grants.has('c:\\vaults\\a.term')).toBe(true);
  });

  it('does not match a Kelvin sign for a k in a UNC share', () => {
    const grants = new VaultPathGrants();
    grants.grant('\\\\nas.k\\s\\v.term');
    expect(grants.has('\\\\nas.\u212A\\s\\v.term')).toBe(false);
  });
});

describe('vaultPathAllowed', () => {
  it('allows a grant without asking the recent list', async () => {
    const grants = new VaultPathGrants();
    grants.grant('C:\\a\\v.term');
    const inRecent = vi.fn(async () => false);
    expect(await vaultPathAllowed('C:\\a\\v.term', grants, undefined, inRecent)).toBe(true);
    expect(inRecent).not.toHaveBeenCalled();
  });

  it('allows the locked vault path in another spelling', async () => {
    expect(await vaultPathAllowed('c:\\a\\V.term', new VaultPathGrants(), 'C:\\A\\v.term', async () => false)).toBe(true);
  });

  it('does not allow the locked path with a Kelvin sign for a k', async () => {
    expect(await vaultPathAllowed('\\\\nas.K\\s\\v.term', new VaultPathGrants(), '\\\\nas.k\\s\\v.term', async () => false)).toBe(false);
  });

  it('otherwise lets the recent list decide', async () => {
    const grants = new VaultPathGrants();
    expect(await vaultPathAllowed('C:\\x.term', grants, undefined, async () => true)).toBe(true);
    expect(await vaultPathAllowed('C:\\x.term', grants, undefined, async () => false)).toBe(false);
  });

  it('touches no file for a UNC path', async () => {
    fsSpies.stat.mockClear();
    fsSpies.readFile.mockClear();
    const inRecent = vi.fn(async () => false);
    expect(await vaultPathAllowed('\\\\srv\\s\\v.term', new VaultPathGrants(), undefined, inRecent)).toBe(false);
    expect(fsSpies.stat).not.toHaveBeenCalled();
    expect(fsSpies.readFile).not.toHaveBeenCalled();
  });
});
