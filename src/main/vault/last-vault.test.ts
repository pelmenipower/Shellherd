import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LastVaultFile } from './last-vault';

describe('LastVaultFile', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'terminus-last-vault-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('returns nothing before a vault was opened', async () => {
    expect(await new LastVaultFile(join(dir, 'last-vault.json')).get()).toBeNull();
  });

  it('remembers the path of an existing vault file', async () => {
    const vault = join(dir, 'team.term');
    await writeFile(vault, 'x');
    const store = new LastVaultFile(join(dir, 'last-vault.json'));
    await store.set(vault);
    expect(await new LastVaultFile(join(dir, 'last-vault.json')).get()).toBe(vault);
  });

  it('forgets a vault file that no longer exists', async () => {
    const store = new LastVaultFile(join(dir, 'last-vault.json'));
    await store.set(join(dir, 'gone.term'));
    expect(await store.get()).toBeNull();
  });

  it('ignores a broken settings file', async () => {
    await writeFile(join(dir, 'last-vault.json'), '{not json');
    expect(await new LastVaultFile(join(dir, 'last-vault.json')).get()).toBeNull();
  });

  it('never throws when the settings file cannot be written', async () => {
    await expect(new LastVaultFile(join(dir, 'missing', 'last-vault.json')).set('x')).resolves.toBeUndefined();
  });
});
