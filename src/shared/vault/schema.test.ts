import { describe, expect, it } from 'vitest';
import {
  ConnectionNodeSchema,
  EncryptedVaultFileSchema,
  VaultSchema,
  WorkspacePaneSchema,
} from './schema';
import { exampleVault } from './example';


describe('ConnectionNodeSchema', () => {
    it('accepts a kubernetes connection and keeps old vaults valid', () => {
        const cluster = { id: 'k1', type: 'connection', name: 'k8s', tags: [], protocol: 'kubernetes', accessHosts: ['cp1'],
            kubeconfig: { source: 'auto' }, production: true, readOnly: false };
        expect(ConnectionNodeSchema.safeParse(cluster).success).toBe(true);
        expect(ConnectionNodeSchema.safeParse({ ...cluster, accessHosts: [] }).success).toBe(false);
        expect(ConnectionNodeSchema.safeParse({ ...cluster, namespace: 'Shop' }).success).toBe(false);
    });

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

describe('WorkspacePaneSchema containerViews', () => {
  const pane = { type: 'pane', connectionIds: ['a', 'b'] };
  it('keeps old panes valid and accepts positions', () => {
    expect(WorkspacePaneSchema.safeParse(pane).success).toBe(true);
    expect(WorkspacePaneSchema.safeParse({ ...pane, containerViews: [0, 3] }).success).toBe(true);
  });
  it('rejects out-of-range positions', () => {
    expect(WorkspacePaneSchema.safeParse({ ...pane, containerViews: [64] }).success).toBe(false);
    expect(WorkspacePaneSchema.safeParse({ ...pane, containerViews: [-1] }).success).toBe(false);
    expect(WorkspacePaneSchema.safeParse({ ...pane, containerViews: [{ index: 64, runtime: 'docker' }] }).success).toBe(false);
  });
  it('accepts objects with a fixed runtime', () => {
    const ok = (containerViews: unknown[]) => WorkspacePaneSchema.safeParse({ ...pane, containerViews }).success;
    expect(ok([{ index: 0, runtime: 'docker' }])).toBe(true);
    expect(ok([{ index: 0 }])).toBe(true);
    expect(ok([0, { index: 2, runtime: 'podman' }])).toBe(true);
  });
  it('rejects unknown runtimes and extra keys', () => {
    const ok = (containerViews: unknown[]) => WorkspacePaneSchema.safeParse({ ...pane, containerViews }).success;
    expect(ok([{ index: 0, runtime: 'proxmox' }])).toBe(false);
    expect(ok([{ index: 0, extra: 1 }])).toBe(false);
  });
});

describe('autoUpload bindings', () => {
    const id = '3f2b1c4e-5a6d-4e7f-8a9b-0c1d2e3f4a5b';
    const binding = { id, localPath: 'C:\\Projekte\\app', remotePath: '/srv/app', excludes: ['.git'], enabled: true };
    const host = { id: 'c', type: 'connection', name: 'S', tags: [], host: 'h', port: 22, authentication: { method: 'agent' } };
    const ssh = (autoUpload?: unknown) => ConnectionNodeSchema.safeParse({ ...host, protocol: 'ssh', ...(autoUpload === undefined ? {} : { autoUpload }) });
    const sftp = (autoUpload?: unknown) => ConnectionNodeSchema.safeParse({ ...host, protocol: 'sftp', autoUpload });

    it('keeps vaults without bindings valid and accepts a binding on SSH and SFTP', () => {
        expect(ssh().success).toBe(true);
        expect(ssh([binding]).success).toBe(true);
        expect(sftp([binding]).success).toBe(true);
        expect(ssh([{ ...binding, localPath: '\\\\server\\share\\x' }]).success).toBe(true);
    });

    it('rejects unusable bindings', () => {
        for (const bad of [
            { ...binding, localPath: 'app' },
            { ...binding, localPath: '\\\\?\\C:\\x' },
            { ...binding, localPath: '\\\\.\\C:\\x' },
            { ...binding, remotePath: 'srv/app' },
            { ...binding, excludes: ['a\tb'] },
        ]) expect(ssh([bad]).success).toBe(false);
        expect(ssh([binding, { ...binding }]).success).toBe(false);
        const many = Array.from({ length: 17 }, (_, index) => ({ ...binding, id: `3f2b1c4e-5a6d-4e7f-8a9b-0c1d2e3f4a${String(index).padStart(2, '0')}` }));
        expect(ssh(many).success).toBe(false);
        expect(ssh(many.slice(0, 16)).success).toBe(true);
    });

    it('strips unknown binding fields instead of rejecting them', () => {
        const parsed = ssh([{ ...binding, future: 1 }]);
        expect(parsed.success && parsed.data.protocol === 'ssh' ? parsed.data.autoUpload?.[0] : undefined).toEqual(binding);
    });
});
