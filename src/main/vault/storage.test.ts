import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  ensureVaultFileExtension,
  loadVault,
  saveVault,
} from './storage';
import { exampleVault } from '../../shared/vault/example';

const createdDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'terminus-test-'));
  createdDirectories.push(directory);

  return directory;
}

afterEach(async () => {
  await Promise.all(
    createdDirectories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

describe('vault storage', () => {
  it('adds the .term extension and keeps .terminus files of earlier versions', () => {
    expect(ensureVaultFileExtension('my-vault')).toBe(
      'my-vault.term',
    );
    expect(ensureVaultFileExtension('my-vault.TERM')).toBe('my-vault.TERM');

    expect(ensureVaultFileExtension('my-vault.terminus')).toBe(
      'my-vault.terminus',
    );
  });

  it('saves and loads an encrypted vault', async () => {
    const directory = await createTemporaryDirectory();
    const requestedPath = join(directory, 'development');
    const password = 'correct horse battery staple';

    const savedPath = await saveVault(
      requestedPath,
      exampleVault,
      password,
    );

    const loadedVault = await loadVault(savedPath, password);

    expect(savedPath).toBe(`${requestedPath}.term`);
    expect(loadedVault).toEqual(exampleVault);
  });

  it('does not store connection details as plaintext', async () => {
    const directory = await createTemporaryDirectory();
    const savedPath = await saveVault(
      join(directory, 'secret-vault'),
      exampleVault,
      'very-secret-password',
    );

    const fileContent = await readFile(savedPath, 'utf8');

    expect(fileContent).not.toContain('very-secret-password');

    for (const node of exampleVault.nodes) {
      expect(fileContent).not.toContain(node.name);
    }
  });

  it('rejects invalid JSON files', async () => {
    const directory = await createTemporaryDirectory();
    const filePath = join(directory, 'broken.terminus');

    await writeFile(filePath, 'this is not JSON', 'utf8');

    await expect(
      loadVault(filePath, 'password'),
    ).rejects.toThrow(expect.objectContaining({ code: 'core.vaultFileNotJson' }));
  });

  it('rejects an incorrect password', async () => {
    const directory = await createTemporaryDirectory();
    const savedPath = await saveVault(
      join(directory, 'protected-vault'),
      exampleVault,
      'correct-password',
    );

    await expect(
      loadVault(savedPath, 'wrong-password'),
    ).rejects.toThrow(expect.objectContaining({ code: 'core.wrongPassword' }));
  });
});