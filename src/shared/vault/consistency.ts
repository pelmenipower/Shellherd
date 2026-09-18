import type {
  Vault,
  VaultNode,
  WorkspaceLayout,
} from './types';

export type VaultConsistencyIssueCode =
  | 'duplicate-node-id'
  | 'unknown-connection'
  | 'invalid-active-connection';

export interface VaultConsistencyIssue {
  code: VaultConsistencyIssueCode;
  path: string;
  message: string;
}

export function validateVaultConsistency(
  vault: Vault,
): VaultConsistencyIssue[] {
  const issues: VaultConsistencyIssue[] = [];

  const nodeIds = new Set<string>();
  const connectionIds = new Set<string>();

  collectNodeIds(
    vault.nodes,
    'nodes',
    nodeIds,
    connectionIds,
    issues,
  );

  vault.workspaces.forEach((workspace, index) => {
    validateWorkspaceLayout(
      workspace.layout,
      `workspaces[${index}].layout`,
      connectionIds,
      issues,
    );
  });

  return issues;
}

function collectNodeIds(
  nodes: VaultNode[],
  path: string,
  nodeIds: Set<string>,
  connectionIds: Set<string>,
  issues: VaultConsistencyIssue[],
): void {
  nodes.forEach((node, index) => {
    const nodePath = `${path}[${index}]`;

    if (nodeIds.has(node.id)) {
      issues.push({
        code: 'duplicate-node-id',
        path: `${nodePath}.id`,
        message: `Die ID "${node.id}" wird mehrfach verwendet.`,
      });
    } else {
      nodeIds.add(node.id);
    }

    if (node.type === 'connection') {
      connectionIds.add(node.id);
      return;
    }

    collectNodeIds(
      node.children,
      `${nodePath}.children`,
      nodeIds,
      connectionIds,
      issues,
    );
  });
}

function validateWorkspaceLayout(
  layout: WorkspaceLayout,
  path: string,
  connectionIds: Set<string>,
  issues: VaultConsistencyIssue[],
): void {
  if (layout.type === 'pane') {
    layout.connectionIds.forEach((connectionId, index) => {
      if (!connectionIds.has(connectionId)) {
        issues.push({
          code: 'unknown-connection',
          path: `${path}.connectionIds[${index}]`,
          message: `Die Verbindung "${connectionId}" existiert nicht.`,
        });
      }
    });

    if (
      layout.activeConnectionId !== undefined &&
      !layout.connectionIds.includes(layout.activeConnectionId)
    ) {
      issues.push({
        code: 'invalid-active-connection',
        path: `${path}.activeConnectionId`,
        message:
          `Die aktive Verbindung "${layout.activeConnectionId}" ` +
          'ist nicht in diesem Terminalbereich geöffnet.',
      });
    }

    return;
  }

  validateWorkspaceLayout(
    layout.first,
    `${path}.first`,
    connectionIds,
    issues,
  );

  validateWorkspaceLayout(
    layout.second,
    `${path}.second`,
    connectionIds,
    issues,
  );
}