import { z } from 'zod';
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

export const ConnectionNodeSchema = z.object({
    id: z.string(),
    type: z.literal('connection'),
    name: z.string(),
    comment: z.string().optional(),

    host:  z.string(),
    port:  z.number().int().min(1).max(65_535),
    username: z.string().optional(),

    authentication: AuthenticationSchema,

    tags: z.array(z.string()),
    color: z.string().optional()
});

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

export const WorkspaceSchema: z.ZodType<Workspace> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  comment: z.string().optional(),
  layout: WorkspaceLayoutSchema,
});

export const VaultSettingsSchema: z.ZodType<VaultSettings> = z.object({
    theme: z.enum(['dark', 'light', 'system']),

    // 0 deaktiviert die automatische Sperre.
    autoLockMinutes: z.number().int().min(0).max(1_440),

    confirmBeforeClosingSession: z.boolean(),
});

export const VaultSchema: z.ZodType<Vault> = z.object({
  format: z.literal('terminus-vault'),
  version: z.literal(1),

  id: z.string().min(1),
  name: z.string().min(1),
  comment: z.string().optional(),

  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),

  nodes: z.array(VaultNodeSchema),
  workspaces: z.array(WorkspaceSchema),
  settings: VaultSettingsSchema,
});