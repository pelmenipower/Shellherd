import { describe, expect, it } from 'vitest';
import { validateVaultConsistency } from './consistency';
import { exampleVault } from './example';
import type { Vault } from './types';

function createVault(): Vault {
  return structuredClone(exampleVault);
}

describe('validateVaultConsistency', () => {
  it('accepts a consistent vault', () => {
    const vault = createVault();

    const issues = validateVaultConsistency(vault);

    expect(issues).toEqual([]);
  });

  it('detects references to unknown connections', () => {
    const vault = createVault();

    vault.workspaces[0].layout = {
      type: 'pane',
      connectionIds: ['connection-does-not-exist'],
      activeConnectionId: 'connection-does-not-exist',
    };

    const issues = validateVaultConsistency(vault);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: 'unknown-connection',
      }),
    );
  });

  it('detects an invalid active connection', () => {
    const vault = createVault();

    vault.workspaces[0].layout = {
      type: 'pane',
      connectionIds: [],
      activeConnectionId: 'connection-dev-api',
    };

    const issues = validateVaultConsistency(vault);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: 'invalid-active-connection',
      }),
    );
  });

  it('detects duplicate node IDs', () => {
    const vault = createVault();

    vault.nodes.push({
      id: 'folder-development',
      type: 'folder',
      name: 'Doppelter Ordner',
      children: [],
    });

    const issues = validateVaultConsistency(vault);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: 'duplicate-node-id',
      }),
    );
  });
});