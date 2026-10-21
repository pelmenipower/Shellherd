import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { Vault } from '../../shared/vault/types';
import {
  mkdtemp,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { encryptVault } from './crypto';
import { decryptVault } from '../../test/vault-helpers';
import {
  readEncryptedVaultFile,
  writeEncryptedVaultFile,
} from './storage';
import { VaultSessionManager, resumesLocked } from './session';
import { addNode, updateNode, removeNodeFromVault } from '../../shared/vault/mutations';
import { validateVaultConsistency } from '../../shared/vault/consistency';
import { exampleVault } from '../../shared/vault/example';

vi.mock('./storage', async importOriginal => {
  const actual = await importOriginal<typeof import('./storage')>();
  return { ...actual, writeEncryptedVaultFile: vi.fn(actual.writeEncryptedVaultFile) };
});

const temporaryDirectories: string[] = [];

async function createTestVault(): Promise<{
  directory: string;
  filePath: string;
  password: string;
}> {
  const directory = await mkdtemp(
    join(tmpdir(), 'terminus-session-test-'),
  );

  temporaryDirectories.push(directory);

  const filePath = join(
    directory,
    'session.terminus',
  );

  const password = 'synthetic-vault-pw';

  const encryptedVault = await encryptVault(
    exampleVault,
    password,
    {
      memoryKiB: 16_384,
      iterations: 1,
      parallelism: 1,
    },
  );

  await writeEncryptedVaultFile(
    filePath,
    encryptedVault,
  );

  return {
    directory,
    filePath,
    password,
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(
      (directory) =>
        rm(directory, {
          recursive: true,
          force: true,
        }),
    ),
  );
});

describe('VaultSessionManager', () => {
  it('unlocks a vault without exposing the key', async () => {
    const { filePath, password } =
      await createTestVault();

    const manager = new VaultSessionManager();

    const snapshot = await manager.unlock(
      filePath,
      password,
    );

    expect(manager.isUnlocked()).toBe(true);
    expect(snapshot.filePath).toBe(filePath);
    expect(snapshot.vault).toEqual(exampleVault);
    expect(snapshot).not.toHaveProperty('key');

    manager.lock();
  });

  it('remembers the locked vault until the next successful unlock', async () => {
    const { filePath, password } = await createTestVault();
    const manager = new VaultSessionManager();
    expect(manager.lockedVault()).toBeUndefined();
    const snapshot = await manager.unlock(filePath, password);
    expect(manager.lockedVault()).toBeUndefined();
    manager.lock();
    expect(manager.lockedVault()).toEqual({ filePath, vaultId: snapshot.vault.id });
    await expect(manager.unlock(filePath, 'wrong-password')).rejects.toThrow();
    expect(manager.lockedVault()).toEqual({ filePath, vaultId: snapshot.vault.id });
    await manager.unlock(filePath, password);
    expect(manager.lockedVault()).toBeUndefined();
    manager.lock();
  });

  it('saves changes with the session key', async () => {
    const { filePath, password } =
      await createTestVault();

    const manager = new VaultSessionManager();

    const snapshot = await manager.unlock(
      filePath,
      password,
    );

    await manager.save({
      ...snapshot.vault,
      name: 'Gespeicherter Session-Vault',
    });

    manager.lock();

    const encryptedVault =
      await readEncryptedVaultFile(filePath);

    const persistedVault = await decryptVault(
      encryptedVault,
      password,
    );

    expect(persistedVault.name).toBe(
      'Gespeicherter Session-Vault',
    );
  });

  it('persists nested folder edits and removes workspace references when deleting their subtree', async () => {
    const { filePath, password } = await createTestVault();
    const manager = new VaultSessionManager();
    try {
      const { vault } = await manager.unlock(filePath, password);
      const connection = { id: 'synthetic-ssh', type: 'connection' as const, protocol: 'ssh' as const, name: 'Synthetic SSH',
        host: 'example.test', port: 22, authentication: { method: 'agent' as const }, tags: [] };
      const nodes = addNode(vault.nodes, {
        id: 'synthetic-folder', type: 'folder', name: 'Folder', children: [
          { id: 'synthetic-child', type: 'folder', name: 'Child', children: [connection] },
        ],
      });
      const updated = { ...vault, nodes: updateNode(nodes, 'synthetic-child', node => ({
        ...node, name: 'Renamed', comment: 'Synthetic comment',
      })), workspaces: [{ id: 'synthetic-workspace', name: 'Workspace', layout: {
        type: 'pane' as const, connectionIds: [connection.id], activeConnectionId: connection.id,
      } }] };
      await manager.save(updated);
      manager.lock();
      const reopened = await manager.unlock(filePath, password);
      expect(reopened.vault.nodes).toEqual(updated.nodes);
      const deleted = removeNodeFromVault(reopened.vault, 'synthetic-folder');
      expect(validateVaultConsistency(deleted)).toEqual([]);
      await manager.save(deleted);
      manager.lock();
      const final = await manager.unlock(filePath, password);
      expect(final.vault.nodes).toEqual(vault.nodes);
      expect(final.vault.workspaces[0].layout).toEqual({ type: 'pane', connectionIds: [] });
    } finally { manager.lock(); }
  });

  it('drops unknown fields from the session vault on save', async () => {
    const { filePath, password } = await createTestVault();
    const manager = new VaultSessionManager();
    try {
      const { vault } = await manager.unlock(filePath, password);
      const saved = await manager.save({ ...vault, unknownField: 1 } as Vault);
      expect(saved.vault).not.toHaveProperty('unknownField');
      expect(manager.getSnapshot().vault).not.toHaveProperty('unknownField');
    } finally { manager.lock(); }
  });

  it('resolves a save that was written even if the session was locked meanwhile', async () => {
    const { filePath, password } = await createTestVault();
    const manager = new VaultSessionManager();
    const actual = await vi.importActual<typeof import('./storage')>('./storage');
    const { vault } = await manager.unlock(filePath, password);
    vi.mocked(writeEncryptedVaultFile).mockImplementationOnce(async (path, file) => {
      const written = await actual.writeEncryptedVaultFile(path, file);
      manager.lock();
      return written;
    });
    const saved = await manager.save({ ...vault, name: 'Racing' });
    expect(saved.vault.name).toBe('Racing');
    expect(saved.filePath).toBe(filePath);
  });

  it('rejects saving after the vault was locked', async () => {
    const { filePath, password } =
      await createTestVault();

    const manager = new VaultSessionManager();

    const snapshot = await manager.unlock(
      filePath,
      password,
    );

    manager.lock();

    expect(manager.isUnlocked()).toBe(false);

    await expect(
      manager.save(snapshot.vault),
    ).rejects.toThrow(expect.objectContaining({ code: 'core.vaultLocked' })
    );
  });
});
describe('resumesLocked', () => {
  const previous = { filePath: 'a.term', vaultId: 'v1' };
  it('resumes only for the same file and the same vault id', () => {
    expect(resumesLocked(previous, { filePath: 'a.term', vault: { id: 'v1' } })).toBe(true);
    expect(resumesLocked(previous, { filePath: 'a.term', vault: { id: 'v2' } })).toBe(false);
    expect(resumesLocked(previous, { filePath: 'b.term', vault: { id: 'v1' } })).toBe(false);
    expect(resumesLocked(undefined, { filePath: 'a.term', vault: { id: 'v1' } })).toBe(false);
  });
});
