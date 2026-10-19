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
  /** The offending node or connection id. */
  id: string;
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
    workspace.views?.forEach((view, viewIndex) => {
      validateWorkspaceLayout(view.layout, `workspaces[${index}].views[${viewIndex}].layout`, connectionIds, issues);
    });
    workspace.windows?.forEach((window, windowIndex) => {
      validateWorkspaceLayout(window.layout, `workspaces[${index}].windows[${windowIndex}].layout`, connectionIds, issues);
      window.views?.forEach((view, viewIndex) => {
        validateWorkspaceLayout(view.layout, `workspaces[${index}].windows[${windowIndex}].views[${viewIndex}].layout`, connectionIds, issues);
      });
    });
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
        id: node.id,
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
          id: connectionId,
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
        id: layout.activeConnectionId,
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