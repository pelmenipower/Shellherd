import { z } from 'zod';
import { CONNECTION_ICONS } from './appearance';
import type {
  FolderNode,
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
});

export const SftpConnectionNodeSchema = z.object({
    ...connectionBase,
    protocol: z.literal('sftp'),
    ...remoteTarget,
    authentication: AuthenticationSchema,
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
    protocol: z.enum(['powershell', 'cmd']),
    workingDirectory: z.string().optional(),
});

export const AiCliConnectionNodeSchema = z.object({
    ...connectionBase,
    protocol: z.literal('aicli'),
    tool: z.enum(['claude', 'codex', 'gemini', 'custom']),
    command: z.string().max(1000).refine(command => !/[\r\n]/.test(command)).optional(),
    workingDirectory: z.string().optional(),
}).refine(node => node.tool !== 'custom' || Boolean(node.command?.trim()), { message: 'commandRequired', path: ['command'] });

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

export const VaultSettingsSchema: z.ZodType<VaultSettings> = z.object({
    theme: z.enum(['dark', 'light', 'system']),

    // 0 deaktiviert die automatische Sperre.
    autoLockMinutes: z.number().int().min(0).max(1_440),

    confirmBeforeClosingSession: z.boolean(),
});

export const AiProviderSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  kind: z.enum(['openai', 'azure', 'anthropic', 'gemini']),
  model: z.string().min(1).max(200),
  apiKey: z.string().max(4096).optional(),
  baseUrl: z.string().url().max(2048).optional(),
  apiVersion: z.string().max(40).optional(),
});

export const AiSettingsSchema = z.object({
  providers: z.array(AiProviderSchema).max(20),
  defaultProviderId: z.string().optional(),
});

export const WorkflowSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  command: z.string().min(1).max(4000).refine(command => !/[\r\n]/.test(command), 'Ein Workflow ist eine Zeile.'),
  description: z.string().max(2000).optional(),
  tags: z.array(z.string().min(1).max(40)).max(20),
  shell: z.enum(['ssh', 'powershell', 'cmd']).optional(),
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
  workflows: z.array(WorkflowSchema).max(1000).optional(),
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
