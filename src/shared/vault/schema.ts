import { ToolbarConfigSchema } from '../toolbar';
import { z } from 'zod';
import { CONNECTION_ICONS } from './appearance';
import { TIMEOUT_LIMITS } from './timeouts';
import { FONT_FAMILY_MAX, FONT_FAMILY_PATTERN, TERMINAL_LIMITS } from './terminal-settings';
import type {
  FolderNode,
  TerminalSettings,
  Vault,
  VaultNode,
  VaultSettings,
  Workspace,
  WorkspaceLayout,
  WorkspacePane,
  WorkspaceSplit,
} from './types';
import { ContainerTargetSchema } from '../containers-schema';
import { KubeNameSchema, KubeViewSnapshotSchema } from '../kubernetes-schema';
import { MAX_BASE_URL, httpsBase } from '../kube-links';
import type { EncryptedVaultFile } from './file-format';

export const AuthenticationSchema = z.discriminatedUnion('method', [
    z.object({
        method: z.literal('agent')
    }),

    z.object({
        method: z.literal('password'),
        password: z.string()  
    }),

    z.object({
        method: z.literal('privateKey'),
        keyPath: z.string().min(1),
        passphrase: z.string().optional(),     
    }),
]);

const connectionBase = {
    id: z.string(),
    type: z.literal('connection'),
    name: z.string(),
    comment: z.string().optional(),

    tags: z.array(z.string()),
    color: z.string().optional(),
    icon: z.enum(CONNECTION_ICONS).optional(),
    disabled: z.boolean().optional(),
};

/** Drive path (`C:\…`) or UNC share (`\\server\share…`); device paths (`\\?\`, `\\.\`) are refused. */
export const AUTO_UPLOAD_LOCAL_PATH = /^(?:\/(?!\/)|[A-Za-z]:\\|\\\\(?![?.](?:[\\/]|$)))/;
const noLineBreak = (value: string) => !/[\0\r\n]/.test(value);

export const AutoUploadBindingSchema = z.object({
    id: z.string().uuid(),
    localPath: z.string().min(1).max(32_767).regex(AUTO_UPLOAD_LOCAL_PATH).refine(noLineBreak),
    remotePath: z.string().min(2).max(4096).refine(path => path.startsWith('/')).refine(noLineBreak),
    excludes: z.array(z.string().min(1).max(256).refine(pattern => !/[\x00-\x1f\x7f]/.test(pattern))).max(200),
    enabled: z.boolean(),
}); // not .strict(): an older version must still open a vault a newer one extended

export const ConnectionTimeoutsSchema = z.object({
    idleMinutes: z.number().int().min(TIMEOUT_LIMITS.idleMinutes[0]).max(TIMEOUT_LIMITS.idleMinutes[1]),
    keepaliveSeconds: z.number().int().min(TIMEOUT_LIMITS.keepaliveSeconds[0]).max(TIMEOUT_LIMITS.keepaliveSeconds[1]),
    keepaliveCount: z.number().int().min(TIMEOUT_LIMITS.keepaliveCount[0]).max(TIMEOUT_LIMITS.keepaliveCount[1]),
    connectSeconds: z.number().int().min(TIMEOUT_LIMITS.connectSeconds[0]).max(TIMEOUT_LIMITS.connectSeconds[1]),
}); // not .strict(), like AutoUploadBindingSchema

/** Start commands after login: at most `lines` lines of at most `length` characters. */
export const LOGIN_LIMITS = { lines: 20, length: 500 } as const;
/** C0, DEL and C1 controls: no extra Enter, no Tab completion, no escape sequences or terminal replies. */
export const LOGIN_CONTROL = /[\x00-\x1f\x7f-\x9f]/;
const LoginLineSchema = z.string().min(1).max(LOGIN_LIMITS.length).refine(line => !LOGIN_CONTROL.test(line));

const autoUpload = z.array(AutoUploadBindingSchema).max(16)
    .refine(list => new Set(list.map(binding => binding.id)).size === list.length).optional();

/** Port forwards of an SSH connection; see docs/superpowers/specs/2026-10-24-ssh-pro-design.md 5.1. */
export const MAX_FORWARDS = 16;
const portSchema = z.number().int().min(1).max(65_535);
const forwardHost = z.string().min(1).max(253).refine(host => !/[\s\x00-\x1f\x7f]/.test(host));
export const PortForwardSchema = z.discriminatedUnion('kind', [
    z.object({ id: z.string().uuid(), kind: z.literal('local'), localPort: portSchema, targetHost: forwardHost, targetPort: portSchema, auto: z.boolean() }),
    z.object({ id: z.string().uuid(), kind: z.literal('remote'), remotePort: portSchema, targetHost: forwardHost, targetPort: portSchema, auto: z.boolean() }),
    z.object({ id: z.string().uuid(), kind: z.literal('dynamic'), localPort: portSchema, auto: z.boolean() }),
]); // not .strict(), like AutoUploadBindingSchema
const forwards = z.array(PortForwardSchema).max(MAX_FORWARDS)
    .refine(list => new Set(list.map(forward => forward.id)).size === list.length).optional();

const remoteTarget = {
    host: z.string(),
    port: z.number().int().min(1).max(65_535),
    username: z.string().optional(),
};

export const SshConnectionNodeSchema = z.object({
    ...connectionBase,
    protocol: z.literal('ssh'),
    ...remoteTarget,
    authentication: AuthenticationSchema,
    containers: z.object({ sudo: z.boolean().optional() }).optional(),
    autoUpload,
    jumpHost: z.string().min(1).max(256).optional(),
    forwards,
    timeouts: ConnectionTimeoutsSchema.partial().optional(),
    login: z.object({
        sudo: z.boolean().optional(),
        commands: z.array(LoginLineSchema).max(LOGIN_LIMITS.lines).optional(),
    }).optional(), // not .strict(), like AutoUploadBindingSchema
});

export const SftpConnectionNodeSchema = z.object({
    ...connectionBase,
    protocol: z.literal('sftp'),
    ...remoteTarget,
    authentication: AuthenticationSchema,
    autoUpload,
    jumpHost: z.string().min(1).max(256).optional(),
    timeouts: ConnectionTimeoutsSchema.partial().optional(),
});

export const RdpConnectionNodeSchema = z.object({
    ...connectionBase,
    protocol: z.literal('rdp'),
    ...remoteTarget,
    password: z.string().optional(),
    rdp: z.object({
        domain: z.string().optional(),
        clipboard: z.boolean(),
    }),
});

export const LocalShellConnectionNodeSchema = z.object({
    ...connectionBase,
    protocol: z.enum(['powershell', 'cmd', 'bash', 'zsh', 'fish']),
    workingDirectory: z.string().optional(),
});

export const AiCliConnectionNodeSchema = z.object({
    ...connectionBase,
    protocol: z.literal('aicli'),
    tool: z.enum(['claude', 'codex', 'gemini', 'custom']),
    command: z.string().max(1000).refine(command => !/[\r\n]/.test(command)).optional(),
    workingDirectory: z.string().optional(),
}).refine(node => node.tool !== 'custom' || Boolean(node.command?.trim()), { message: 'commandRequired', path: ['command'] });

/** A valid https address (the form stores it normalized); main and renderer normalize again before use. Not "=== httpsBase(value)": a URL parser update must never make a vault unopenable. */
const WebAddressSchema = z.string().max(MAX_BASE_URL).refine(value => httpsBase(value) !== null, { message: 'httpsAddress' });

export const KubernetesConnectionNodeSchema = z.object({
    ...connectionBase,
    protocol: z.literal('kubernetes'),
    accessHosts: z.array(z.string().min(1).max(256)).min(1).max(8),
    kubeconfig: z.discriminatedUnion('source', [
        z.object({ source: z.literal('auto') }),
        z.object({ source: z.literal('path'), path: z.string().min(1).max(1024).refine(path => !/[\r\n\0]/.test(path)) }),
    ]),
    context: z.string().min(1).max(253).optional(),
    namespace: KubeNameSchema.optional(),
    production: z.boolean(),
    readOnly: z.boolean(),
    argoUrl: WebAddressSchema.optional(),
    harborUrl: WebAddressSchema.optional(),
});

export const ConnectionNodeSchema = z.discriminatedUnion('protocol', [
    SshConnectionNodeSchema,
    SftpConnectionNodeSchema,
    RdpConnectionNodeSchema,
    LocalShellConnectionNodeSchema,
    AiCliConnectionNodeSchema,
    KubernetesConnectionNodeSchema,
]);

export const VaultNodeSchema: z.ZodType<VaultNode> = z.lazy(() =>
    z.union([ConnectionNodeSchema, FolderNodeSchema]),
);

export const FolderNodeSchema: z.ZodType<FolderNode> = z.object({
    id: z.string().min(1),
    type: z.literal('folder'),
    name: z.string().min(1),
    comment: z.string().optional(),
    children: z.array(VaultNodeSchema),
});

export const WorkspacePaneSchema: z.ZodType<WorkspacePane> = z.object({
  type: z.literal('pane'),
  connectionIds: z.array(z.string().min(1)),
  activeConnectionId: z.string().min(1).optional(),
  fileBrowsers: z.array(z.number().int().min(0).max(63)).max(64).optional(),
  containerViews: z.array(z.union([
    z.number().int().min(0).max(63),
    z.object({ index: z.number().int().min(0).max(63), runtime: z.enum(['docker', 'podman']).optional() }).strict(),
  ])).max(64).optional(),
  containerTabs: z.array(z.object({ index: z.number().int().min(0).max(63), target: ContainerTargetSchema, mode: z.enum(['shell', 'logs']) }).strict()).max(64).optional(),
  kubeTabs: z.array(z.object({ index: z.number().int().min(0).max(63), view: KubeViewSnapshotSchema }).strict()).max(64).optional(),
});

export const WorkspaceLayoutSchema: z.ZodType<WorkspaceLayout> = z.lazy(() =>
    z.union([
        WorkspacePaneSchema,
        WorkspaceSplitSchema,
    ]),
);

export const WorkspaceSplitSchema: z.ZodType<WorkspaceSplit> = z.object({
  type: z.literal('split'),
  direction: z.enum(['horizontal', 'vertical']),

  // Verhindert praktisch unsichtbare Bereiche.
  ratio: z.number().min(0.1).max(0.9),

  first: WorkspaceLayoutSchema,
  second: WorkspaceLayoutSchema,
});

export const WorkspaceViewsSchema = z.array(z.object({
  name: z.string().min(1).max(60),
  layout: WorkspaceLayoutSchema,
})).min(1).max(12);

export const WorkspaceSchema: z.ZodType<Workspace> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  comment: z.string().optional(),
  layout: WorkspaceLayoutSchema,
  views: WorkspaceViewsSchema.optional(),
  windows: z.array(z.object({
    bounds: z.object({ x: z.number().int(), y: z.number().int(), width: z.number().int().min(320).max(20_000), height: z.number().int().min(240).max(20_000) }),
    layout: WorkspaceLayoutSchema,
    views: WorkspaceViewsSchema.optional(),
  })).max(8).optional(),
});

export const TerminalSettingsSchema: z.ZodType<TerminalSettings> = z.object({
    fontFamily: z.string().max(FONT_FAMILY_MAX).regex(FONT_FAMILY_PATTERN),
    fontSize: z.number().int().min(TERMINAL_LIMITS.fontSize[0]).max(TERMINAL_LIMITS.fontSize[1]),
    scrollback: z.number().int().min(TERMINAL_LIMITS.scrollback[0]).max(TERMINAL_LIMITS.scrollback[1]),
    cursorStyle: z.enum(['block', 'bar', 'underline']),
    cursorBlink: z.boolean(),
});

export const VaultSettingsSchema: z.ZodType<VaultSettings> = z.object({
    theme: z.enum(['dark', 'light', 'system']),

    // 0 deaktiviert die automatische Sperre.
    autoLockMinutes: z.number().int().min(0).max(1_440),

    confirmBeforeClosingSession: z.boolean(),
    timeouts: ConnectionTimeoutsSchema.optional(),
    terminal: TerminalSettingsSchema.optional(),
});

export const AiProviderSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  kind: z.enum(['openai', 'azure', 'anthropic', 'gemini']),
  model: z.string().min(1).max(200),
  apiKey: z.string().max(4096).optional(),
  baseUrl: z.string().url().max(2048).optional(),
  apiVersion: z.string().max(40).optional(),
  maskSecrets: z.boolean().optional(),
});

export const AiSettingsSchema = z.object({
  providers: z.array(AiProviderSchema).max(20),
  defaultProviderId: z.string().optional(),
});

export const VaultSchema: z.ZodType<Vault> = z.object({
  format: z.literal('terminus-vault'),
  version: z.literal(2),

  id: z.string().min(1),
  name: z.string().min(1),
  comment: z.string().optional(),

  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),

  nodes: z.array(VaultNodeSchema),
  workspaces: z.array(WorkspaceSchema),
  settings: VaultSettingsSchema,
  ai: AiSettingsSchema.optional(),
  // Preserve retired data without exposing the removed feature.
  workflows: z.unknown().optional(),
  toolbar: ToolbarConfigSchema.optional(),
});

export const EncryptedVaultFileSchema: z.ZodType<EncryptedVaultFile> =
  z.object({
    format: z.literal('terminus-encrypted-vault'),
    version: z.literal(1),

    kdf: z.object({
      algorithm: z.literal('argon2id'),
      salt: z.string().min(1),
      memoryKiB: z.number().int().min(16_384).max(262_144),
      iterations: z.number().int().min(1).max(10),
      parallelism: z.number().int().min(1).max(4),
    }),

    cipher: z.object({
      algorithm: z.literal('aes-256-gcm'),
      nonce: z.string().min(1),
      authTag: z.string().min(1),
    }),

    payload: z.string().min(1),
  });
