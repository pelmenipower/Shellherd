import { z } from 'zod';
import { SshConnectionNodeSchema, VaultSchema, VaultSettingsSchema, WorkspaceSchema } from './schema';
import type { Vault, VaultNode } from './types';

export const CURRENT_VAULT_VERSION = 2;

/** Version 1 knew only SSH connections and had no `protocol` field. */
const LegacyConnectionSchema = SshConnectionNodeSchema.omit({ protocol: true });
type LegacyConnection = z.infer<typeof LegacyConnectionSchema>;
interface LegacyFolder { id: string; type: 'folder'; name: string; comment?: string; children: LegacyNode[] }
type LegacyNode = LegacyConnection | LegacyFolder;

const LegacyFolderSchema: z.ZodType<LegacyFolder> = z.lazy(() => z.object({
  id: z.string().min(1),
  type: z.literal('folder'),
  name: z.string().min(1),
  comment: z.string().optional(),
  children: z.array(z.union([LegacyConnectionSchema, LegacyFolderSchema])),
}));

const VaultV1Schema = z.object({
  format: z.literal('terminus-vault'),
  version: z.literal(1),
  id: z.string().min(1),
  name: z.string().min(1),
  comment: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  nodes: z.array(z.union([LegacyConnectionSchema, LegacyFolderSchema])),
  workspaces: z.array(WorkspaceSchema),
  settings: VaultSettingsSchema,
});

function migrateNode(node: LegacyNode): VaultNode {
  return node.type === 'folder'
    ? { ...node, children: node.children.map(migrateNode) }
    : { ...node, protocol: 'ssh' };
}

export interface ParsedVault {
  vault: Vault;
  /** Set when the stored document used an older format and was migrated in memory. */
  migratedFrom?: number;
}

/**
 * Validates a decrypted vault document and migrates older versions in memory.
 * IDs, folders, appearance, credentials and workspace references are kept unchanged.
 */
export function parseVaultDocument(input: unknown): ParsedVault {
  const version = typeof input === 'object' && input !== null ? (input as { version?: unknown }).version : undefined;
  if (version === CURRENT_VAULT_VERSION) return { vault: VaultSchema.parse(input) };
  if (version === 1) {
    const legacy = VaultV1Schema.parse(input);
    const vault = VaultSchema.parse({ ...legacy, version: CURRENT_VAULT_VERSION, nodes: legacy.nodes.map(migrateNode) });
    return { vault, migratedFrom: 1 };
  }
  throw new Error(typeof version === 'number' && version > CURRENT_VAULT_VERSION
    ? `Dieser Vault wurde mit einer neueren Terminus-Version gespeichert (Format ${version}). Bitte aktualisiere Terminus.`
    : 'Das Vault-Format wird nicht unterstützt.');
}
