import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { decryptVault } from './crypto';
import {
  ensureVaultFileExtension,
  readEncryptedVaultFile,
  saveVault,
} from './storage';
import { exampleVault } from '../../shared/vault/example';

const calls: string[] = [];

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    open: (async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      const sync = handle.sync.bind(handle);
      handle.sync = async () => {
        calls.push('sync');
        return sync();
      };
      return handle;
    }) as typeof actual.open,
    rename: (async (...args: Parameters<typeof actual.rename>) => {
      calls.push('rename');
      return actual.rename(...args);
    }) as typeof actual.rename,
  };
});

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
  it('reports a structurally wrong vault file as damaged', async () => {
    const directory = await createTemporaryDirectory();
    const filePath = join(directory, 'wrong.term');
    await writeFile(filePath, JSON.stringify({ unexpected: true }), 'utf8');

    await expect(readEncryptedVaultFile(filePath)).rejects.toThrow(expect.objectContaining({ code: 'core.vaultFileCorrupt' }));
  });

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

    const loadedVault = await decryptVault(await readEncryptedVaultFile(savedPath), password);

    expect(savedPath).toBe(`${requestedPath}.term`);
    expect(loadedVault).toEqual(exampleVault);
  });

  it('flushes the temporary file to disk before renaming it', async () => {
    calls.length = 0;
    const directory = await createTemporaryDirectory();
    await saveVault(join(directory, 'durable'), exampleVault, 'pw');

    expect(calls).toEqual(['sync', 'rename']);
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
      readEncryptedVaultFile(filePath),
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
      decryptVault(await readEncryptedVaultFile(savedPath), 'wrong-password'),
    ).rejects.toThrow(expect.objectContaining({ code: 'core.wrongPassword' }));
  });
});