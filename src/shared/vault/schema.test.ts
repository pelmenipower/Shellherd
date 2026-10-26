import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ConnectionNodeSchema,
  LOGIN_LIMITS,
  EncryptedVaultFileSchema,
  TerminalSettingsSchema,
  VaultSchema,
  VaultSettingsSchema,
  WorkspacePaneSchema,
} from './schema';
import { DEFAULT_TERMINAL_SETTINGS } from './terminal-settings';
import { exampleVault } from './example';


describe('ConnectionNodeSchema login block', () => {
    const ssh = { id: 'c', type: 'connection', protocol: 'ssh', name: 'S', host: 'h', port: 22, tags: [], authentication: { method: 'agent' } };
    const ok = (commands: string[]) => ConnectionNodeSchema.safeParse({ ...ssh, login: { commands } }).success;

    it('keeps login through the parse and treats it as optional', () => {
        const login = { sudo: true, commands: ['uptime', 'df -h /'] };
        expect(ConnectionNodeSchema.parse({ ...ssh, login })).toMatchObject({ login });
        expect(ConnectionNodeSchema.parse(ssh)).not.toHaveProperty('login');
    });

    it('rejects Tab, ESC, DEL and C1 controls', () => {
        for (const bad of ['a\tb', 'a\x1bb', 'a\x7fb', 'a\u009b6n', 'a\nb', '']) expect(ok([bad])).toBe(false);
        expect(ok(['plain command'])).toBe(true);
    });

    it('keeps schema.ts free of raw control characters', () => {
        const source = readFileSync(new URL('./schema.ts', import.meta.url), 'utf8');
        expect(source).not.toMatch(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/);
    });

    it('enforces the limits', () => {
        expect(ok(Array(LOGIN_LIMITS.lines).fill('x'.repeat(LOGIN_LIMITS.length)))).toBe(true);
        expect(ok(Array(LOGIN_LIMITS.lines + 1).fill('x'))).toBe(false);
        expect(ok(['x'.repeat(LOGIN_LIMITS.length + 1)])).toBe(false);
    });
});

describe('ConnectionNodeSchema', () => {
    it('accepts a kubernetes connection and keeps old vaults valid', () => {
        const cluster = { id: 'k1', type: 'connection', name: 'k8s', tags: [], protocol: 'kubernetes', accessHosts: ['cp1'],
            kubeconfig: { source: 'auto' }, production: true, readOnly: false };
        expect(ConnectionNodeSchema.safeParse(cluster).success).toBe(true);
        expect(ConnectionNodeSchema.safeParse({ ...cluster, accessHosts: [] }).success).toBe(false);
        expect(ConnectionNodeSchema.safeParse({ ...cluster, namespace: 'Shop' }).success).toBe(false);
    });

    it('accepts optional https addresses for Argo CD and Harbor and refuses anything else there', () => {
        const cluster = { id: 'k1', type: 'connection', name: 'k8s', tags: [], protocol: 'kubernetes', accessHosts: ['cp1'],
            kubeconfig: { source: 'auto' }, production: true, readOnly: false };
        expect(ConnectionNodeSchema.parse({ ...cluster, argoUrl: 'https://argocd.example.test', harborUrl: 'https://harbor.example.test:8443/sub' }))
            .toMatchObject({ argoUrl: 'https://argocd.example.test', harborUrl: 'https://harbor.example.test:8443/sub' });
        expect(ConnectionNodeSchema.parse(cluster)).not.toHaveProperty('argoUrl');
        for (const value of ['http://argocd.example.test', 'https://u@argocd.example.test', 'https://u:p@argocd.example.test', 'https://argocd.example.test/?a=1',
            'https://argocd.example.test/#x', 'javascript:alert(1)', '', `https://argocd.example.test/${'x'.repeat(513)}`]) {
            expect(ConnectionNodeSchema.safeParse({ ...cluster, argoUrl: value }).success).toBe(false);
            expect(ConnectionNodeSchema.safeParse({ ...cluster, harborUrl: value }).success).toBe(false);
        }
        expect(ConnectionNodeSchema.safeParse({ ...cluster, argoUrl: 42 }).success).toBe(false);
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
            { ...binding, localPath: '\\\\?/C:/x' },
            { ...binding, localPath: '\\\\./pipe/x' },
            { ...binding, localPath: '\\\\.\\pipe\\x' },
            { ...binding, localPath: '\\\\?' },
            { ...binding, localPath: '\\\\.' },
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

describe('jump host and port forwards', () => {
    const uuid = (index: number) => `3f2b1c4e-5a6d-4e7f-8a9b-${String(index).padStart(12, '0')}`;
    const host = { id: 'c', type: 'connection', name: 'S', tags: [], host: 'h', port: 22, authentication: { method: 'agent' } };
    const ssh = (extra: object) => ConnectionNodeSchema.safeParse({ ...host, protocol: 'ssh', ...extra });
    const sftp = (extra: object) => ConnectionNodeSchema.safeParse({ ...host, protocol: 'sftp', ...extra });
    const local = { id: uuid(1), kind: 'local', localPort: 15432, targetHost: 'db-internal', targetPort: 5432, auto: true };
    const remote = { id: uuid(2), kind: 'remote', remotePort: 8080, targetHost: 'localhost', targetPort: 80, auto: false };
    const dynamic = { id: uuid(3), kind: 'dynamic', localPort: 1080, auto: false };

    it('accepts a jump host on SSH and SFTP and rejects an empty one', () => {
        expect(ssh({ jumpHost: 'web-01' }).success).toBe(true);
        expect(sftp({ jumpHost: 'web-01' }).success).toBe(true);
        expect(ssh({ jumpHost: '' }).success).toBe(false);
    });

    it('accepts all three forward kinds on SSH', () => {
        expect(ssh({ forwards: [local, remote, dynamic] }).success).toBe(true);
        expect(ssh({ forwards: [{ ...local, targetHost: 'a b' }] }).success).toBe(false);
    });

    it('rejects a duplicate forward id', () => {
        expect(ssh({ forwards: [local, { ...remote, id: local.id }] }).success).toBe(false);
    });

    it('allows at most 16 forwards', () => {
        const many = Array.from({ length: 17 }, (_, index) => ({ ...dynamic, id: uuid(100 + index) }));
        expect(ssh({ forwards: many.slice(0, 16) }).success).toBe(true);
        expect(ssh({ forwards: many }).success).toBe(false);
    });

    it('rejects port 0', () => {
        expect(ssh({ forwards: [{ ...local, localPort: 0 }] }).success).toBe(false);
        expect(ssh({ forwards: [{ ...remote, remotePort: 0 }] }).success).toBe(false);
    });

    it('drops forwards on SFTP instead of rejecting the connection', () => {
        const parsed = sftp({ forwards: [local] });
        expect(parsed.success).toBe(true);
        expect(JSON.stringify(parsed.data)).not.toContain('forwards');
    });
});

describe('TerminalSettingsSchema', () => {
    const ok = (patch: Record<string, unknown>) => TerminalSettingsSchema.safeParse({ ...DEFAULT_TERMINAL_SETTINGS, ...patch }).success;

    it('accepts the defaults and values on the limits', () => {
        expect(ok({})).toBe(true);
        expect(ok({ fontFamily: 'Fira Code', fontSize: 8, scrollback: 50_000, cursorStyle: 'underline', cursorBlink: false })).toBe(true);
        expect(ok({ fontSize: 32, scrollback: 1_000, cursorStyle: 'bar' })).toBe(true);
    });

    it('rejects font names with quotes, commas or more than 64 characters', () => {
        expect(ok({ fontFamily: 'A"B' })).toBe(false);
        expect(ok({ fontFamily: 'A,B' })).toBe(false);
        expect(ok({ fontFamily: 'a'.repeat(65) })).toBe(false);
        expect(ok({ fontFamily: 'a'.repeat(64) })).toBe(true);
    });

    it('rejects sizes and scrollback outside the limits', () => {
        for (const fontSize of [7, 33, 14.5]) expect(ok({ fontSize })).toBe(false);
        for (const scrollback of [999, 50_001]) expect(ok({ scrollback })).toBe(false);
    });

    it('rejects unknown cursor styles', () => {
        expect(ok({ cursorStyle: 'beam' })).toBe(false);
    });

    it('treats a missing terminal block as valid in the vault settings', () => {
        const settings = { theme: 'dark', autoLockMinutes: 10, confirmBeforeClosingSession: true };
        expect(VaultSettingsSchema.safeParse(settings).success).toBe(true);
        expect(VaultSettingsSchema.safeParse({ ...settings, terminal: DEFAULT_TERMINAL_SETTINGS }).success).toBe(true);
        expect(VaultSettingsSchema.safeParse({ ...settings, terminal: { ...DEFAULT_TERMINAL_SETTINGS, fontSize: 7 } }).success).toBe(false);
    });
});
