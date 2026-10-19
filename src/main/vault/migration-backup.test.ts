import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encryptDocumentWithKey, encryptVault, unlockVault } from './crypto';
import { readEncryptedVaultFile, writeEncryptedVaultFile } from './storage';
import { VaultSessionManager } from './session';
import { exampleVault } from '../../shared/vault/example';

const directories: string[] = [];
const password = 'synthetic-Vault-pw1';

/** Writes a version 1 vault encrypted exactly like older Terminus builds did. */
async function createLegacyVault(): Promise<{ directory: string; filePath: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'terminus-migration-test-'));
  directories.push(directory);
  const filePath = join(directory, 'legacy.terminus');
  const seed = await encryptVault(exampleVault, password, { memoryKiB: 16_384, iterations: 1, parallelism: 1 });
  const unlocked = await unlockVault(seed, password);
  const legacy = structuredClone(exampleVault) as unknown as { version: number; nodes: { children: Record<string, unknown>[] }[] };
  legacy.version = 1;
  delete legacy.nodes[0].children[0].protocol;
  await writeEncryptedVaultFile(filePath, encryptDocumentWithKey(legacy, unlocked.key, unlocked.kdf));
  unlocked.key.fill(0);
  return { directory, filePath };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe('vault format migration', () => {
  it('opens a version 1 vault without touching the file', async () => {
    const { directory, filePath } = await createLegacyVault();
    const before = await readFile(filePath);
    const manager = new VaultSessionManager();
    const { vault } = await manager.unlock(filePath, password);
    expect(vault).toEqual(exampleVault);
    expect(await readFile(filePath)).toEqual(before);
    expect(await readdir(directory)).toEqual(['legacy.terminus']);
    manager.lock();
  });

  it('backs up the original once before the first version 2 save', async () => {
    const { directory, filePath } = await createLegacyVault();
    const original = await readFile(filePath);
    const manager = new VaultSessionManager();
    const { vault } = await manager.unlock(filePath, password);
    await manager.save({ ...vault, name: 'Renamed' });
    await manager.save({ ...vault, name: 'Renamed again' });
    const files = (await readdir(directory)).sort();
    expect(files).toHaveLength(2);
    const backup = files.find(file => file.startsWith('legacy.v1-backup-'))!;
    expect(backup).toMatch(/\.terminus$/);
    expect(await readFile(join(directory, backup))).toEqual(original);
    const reopened = new VaultSessionManager();
    expect((await reopened.unlock(filePath, password)).vault.name).toBe('Renamed again');
    expect((await readEncryptedVaultFile(filePath)).version).toBe(1);
    manager.lock(); reopened.lock();
  });

  it('does not save when the backup cannot be created', async () => {
    const { filePath } = await createLegacyVault();
    const manager = new VaultSessionManager();
    const { vault } = await manager.unlock(filePath, password);
    await rm(filePath);
    await expect(manager.save({ ...vault, name: 'Lost' })).rejects.toThrow();
    await expect(readFile(filePath)).rejects.toThrow();
    manager.lock();
  });
});
