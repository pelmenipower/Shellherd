import { describe, expect, it } from 'vitest';
import {
  ConnectionNodeSchema,
  EncryptedVaultFileSchema,
  VaultSchema,
} from './schema';
import { exampleVault } from './example';


describe('ConnectionNodeSchema', () => {
    it('keeps the disabled flag and treats it as optional', () => {
        const connection = { id: 'c', type: 'connection', protocol: 'cmd', name: 'CMD', tags: [] };
        expect(ConnectionNodeSchema.parse({ ...connection, disabled: true })).toMatchObject({ disabled: true });
        expect(ConnectionNodeSchema.safeParse(connection).success).toBe(true);
        expect(ConnectionNodeSchema.safeParse({ ...connection, disabled: 'yes' }).success).toBe(false);
    });

    it('accepts a valid SSH connection', () => {
        const connection = {
            id: 'connection-api',
            type: 'connection',
            protocol: 'ssh',
            name: 'API Server',
            host: 'api.example.local',
            port: 22,
            username: 'developer',
            authentication: {
                method: 'agent',
            },
            tags: ['development'],
        };

        const result = ConnectionNodeSchema.safeParse(connection);

        expect(result.success).toBe(true);
    });

    it('rejects a port represented as text', () => {
        const connection = {
            id: 'connection-api',
            type: 'connection',
            name: 'API Server',
            host: 'api.example.local',
            port: '22',
            authentication: {
                method: 'agent',
            },
            tags: [],
        };

        const result = ConnectionNodeSchema.safeParse(connection);

        expect(result.success).toBe(false)
    });

    it('rejects ports outside the valid range', () => {
        const connection = {
            id: 'connection-api',
            type: 'connection',
            name: 'API Server',
            host: 'api.example.local',
            port: 100_000,
            username: 'developer',
            authentication: {
                method: 'agent',
            },
            tags: ['development'],
        };

        const result = ConnectionNodeSchema.safeParse(connection);

        expect(result.success).toBe(false)
    });
});

describe('VaultSchema', () => {
  it('round-trips optional connection appearance without requiring it in old vaults', () => {
    const node = { id: 'appearance', type: 'connection', protocol: 'ssh', name: 'DB', host: 'example.test', port: 22, authentication: { method: 'agent' }, tags: [] };
    expect(ConnectionNodeSchema.parse(node).icon).toBeUndefined();
    const vault = VaultSchema.parse({ ...exampleVault, nodes: [{ ...node, icon: 'database', color: '#fbbf24' }] });
    expect(vault.nodes[0]).toMatchObject({ icon: 'database', color: '#fbbf24' });
    expect(ConnectionNodeSchema.safeParse({ ...node, icon: 'unknown' }).success).toBe(false);
  });
  it('accepts a complete valid vault', () => {
    const result = VaultSchema.safeParse(exampleVault);

    expect(result.success).toBe(true);
  });

  it('rejects an unsupported theme', () => {
    const invalidVault = {
      ...exampleVault,

      settings: {
        ...exampleVault.settings,
        theme: 'neon',
      },
    };

    const result = VaultSchema.safeParse(invalidVault);

    expect(result.success).toBe(false);
  });
});

describe('EncryptedVaultFileSchema', () => {
  it('rejects dangerous Argon2 memory settings', () => {
    const file = {
      format: 'terminus-encrypted-vault',
      version: 1,

      kdf: {
        algorithm: 'argon2id',
        salt: 'c2FsdA==',
        memoryKiB: 10_000_000,
        iterations: 3,
        parallelism: 1,
      },

      cipher: {
        algorithm: 'aes-256-gcm',
        nonce: 'bm9uY2U=',
        authTag: 'dGFn',
      },

      payload: 'ZW5jcnlwdGVk',
    };

    const result = EncryptedVaultFileSchema.safeParse(file);

    expect(result.success).toBe(false);
  });
});
