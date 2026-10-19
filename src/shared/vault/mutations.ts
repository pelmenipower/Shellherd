import type {
  Vault,
  VaultNode,
  WorkspaceLayout,
  Workspace,
} from './types';

export function upsertWorkspace(workspaces: Workspace[], workspace: Workspace): Workspace[] {
  return workspaces.some(item => item.id === workspace.id)
    ? workspaces.map(item => item.id === workspace.id ? workspace : item)
    : [...workspaces, workspace];
}

export function removeWorkspace(workspaces: Workspace[], id: string): Workspace[] {
  return workspaces.filter(item => item.id !== id);
}

export function addNode(
  nodes: VaultNode[],
  node: VaultNode,
  parentFolderId?: string,
): VaultNode[] {
  if (!parentFolderId) {
    return [...nodes, node];
  }

  let parentFound = false;

  const updatedNodes = nodes.map((currentNode) => {
    if (currentNode.type !== 'folder') {
      return currentNode;
    }

    if (currentNode.id === parentFolderId) {
      parentFound = true;

      return {
        ...currentNode,
        children: [...currentNode.children, node],
      };
    }

    const updatedChildren = addNodeToFolder(
      currentNode.children,
      node,
      parentFolderId,
    );

    if (updatedChildren.found) {
      parentFound = true;

      return {
        ...currentNode,
        children: updatedChildren.nodes,
      };
    }

    return currentNode;
  });

  if (!parentFound) {
    throw new Error(
      `Der Zielordner "${parentFolderId}" wurde nicht gefunden.`,
    );
  }

  return updatedNodes;
}

interface AddNodeResult {
  nodes: VaultNode[];
  found: boolean;
}

function addNodeToFolder(
  nodes: VaultNode[],
  node: VaultNode,
  parentFolderId: string,
): AddNodeResult {
  for (let index = 0; index < nodes.length; index += 1) {
    const currentNode = nodes[index];

    if (currentNode.type !== 'folder') {
      continue;
    }

    if (currentNode.id === parentFolderId) {
      return {
        nodes: nodes.map((item, itemIndex) =>
          itemIndex === index
            ? {
                ...currentNode,
                children: [...currentNode.children, node],
              }
            : item,
        ),
        found: true,
      };
    }

    const childResult = addNodeToFolder(
      currentNode.children,
      node,
      parentFolderId,
    );

    if (childResult.found) {
      return {
        nodes: nodes.map((item, itemIndex) =>
          itemIndex === index
            ? {
                ...currentNode,
                children: childResult.nodes,
              }
            : item,
        ),
        found: true,
      };
    }
  }

  return {
    nodes,
    found: false,
  };
}

export function updateNode(
  nodes: VaultNode[],
  nodeId: string,
  update: (node: VaultNode) => VaultNode,
): VaultNode[] {
  const result = updateNodeRecursive(
    nodes,
    nodeId,
    update,
  );

  if (!result.found) {
    throw new Error(
      `Der Knoten "${nodeId}" wurde nicht gefunden.`,
    );
  }

  return result.nodes;
}

interface UpdateNodeResult {
  nodes: VaultNode[];
  found: boolean;
}

function updateNodeRecursive(
  nodes: VaultNode[],
  nodeId: string,
  update: (node: VaultNode) => VaultNode,
): UpdateNodeResult {
  for (
    let index = 0;
    index < nodes.length;
    index += 1
  ) {
    const currentNode = nodes[index];

    if (currentNode.id === nodeId) {
      return {
        nodes: nodes.map((node, nodeIndex) =>
          nodeIndex === index
            ? update(currentNode)
            : node,
        ),
        found: true,
      };
    }

    if (currentNode.type !== 'folder') {
      continue;
    }

    const childResult = updateNodeRecursive(
      currentNode.children,
      nodeId,
      update,
    );

    if (childResult.found) {
      return {
        nodes: nodes.map((node, nodeIndex) =>
          nodeIndex === index
            ? {
                ...currentNode,
                children: childResult.nodes,
              }
            : node,
        ),
        found: true,
      };
    }
  }

  return {
    nodes,
    found: false,
  };
}

export function removeNode(
  nodes: VaultNode[],
  nodeId: string,
): VaultNode[] {
  const result = removeNodeRecursive(
    nodes,
    nodeId,
  );

  if (!result.found) {
    throw new Error(
      `Der Knoten "${nodeId}" wurde nicht gefunden.`,
    );
  }

  return result.nodes;
}

interface RemoveNodeResult {
  nodes: VaultNode[];
  found: boolean;
}

function removeNodeRecursive(
  nodes: VaultNode[],
  nodeId: string,
): RemoveNodeResult {
  const directMatch = nodes.some(
    (node) => node.id === nodeId,
  );

  if (directMatch) {
    return {
      nodes: nodes.filter(
        (node) => node.id !== nodeId,
      ),
      found: true,
    };
  }

  for (
    let index = 0;
    index < nodes.length;
    index += 1
  ) {
    const currentNode = nodes[index];

    if (currentNode.type !== 'folder') {
      continue;
    }

    const childResult = removeNodeRecursive(
      currentNode.children,
      nodeId,
    );

    if (childResult.found) {
      return {
        nodes: nodes.map((node, nodeIndex) =>
          nodeIndex === index
            ? {
                ...currentNode,
                children: childResult.nodes,
              }
            : node,
        ),
        found: true,
      };
    }
  }

  return {
    nodes,
    found: false,
  };
}

export function removeNodeFromVault(
  vault: Vault,
  nodeId: string,
): Vault {
  const node = findNode(vault.nodes, nodeId);

  if (!node) {
    throw new Error(
      `Der Knoten "${nodeId}" wurde nicht gefunden.`,
    );
  }

  const removedConnectionIds = new Set<string>();

  collectConnectionIds(
    node,
    removedConnectionIds,
  );

  return {
    ...vault,
    nodes: removeNode(vault.nodes, nodeId),
    workspaces: vault.workspaces.map(
      (workspace) => ({
        ...workspace,
        layout: removeConnectionsFromLayout(
          workspace.layout,
          removedConnectionIds,
        ),
        ...(workspace.views ? { views: workspace.views.map(view => ({
          ...view, layout: removeConnectionsFromLayout(view.layout, removedConnectionIds),
        })) } : {}),
        ...(workspace.windows ? { windows: workspace.windows.map(window => ({
          ...window, layout: removeConnectionsFromLayout(window.layout, removedConnectionIds),
          ...(window.views ? { views: window.views.map(view => ({
            ...view, layout: removeConnectionsFromLayout(view.layout, removedConnectionIds),
          })) } : {}),
        })) } : {}),
      }),
    ),
  };
}

function findNode(
  nodes: VaultNode[],
  nodeId: string,
): VaultNode | undefined {
  for (const node of nodes) {
    if (node.id === nodeId) {
      return node;
    }

    if (node.type === 'folder') {
      const found = findNode(
        node.children,
        nodeId,
      );

      if (found) {
        return found;
      }
    }
  }

  return undefined;
}

function collectConnectionIds(
  node: VaultNode,
  connectionIds: Set<string>,
): void {
  if (node.type === 'connection') {
    connectionIds.add(node.id);
    return;
  }

  for (const child of node.children) {
    collectConnectionIds(
      child,
      connectionIds,
    );
  }
}

function removeConnectionsFromLayout(
  layout: WorkspaceLayout,
  removedConnectionIds: Set<string>,
): WorkspaceLayout {
  if (layout.type === 'split') {
    return {
      ...layout,
      first: removeConnectionsFromLayout(
        layout.first,
        removedConnectionIds,
      ),
      second: removeConnectionsFromLayout(
        layout.second,
        removedConnectionIds,
      ),
    };
  }

  const connectionIds =
    layout.connectionIds.filter(
      (connectionId) =>
        !removedConnectionIds.has(connectionId),
    );

  const previousActiveId =
    layout.activeConnectionId;

  const activeConnectionId =
    previousActiveId &&
    connectionIds.includes(previousActiveId)
      ? previousActiveId
      : connectionIds[0];

  if (!activeConnectionId) {
    return {
      type: 'pane',
      connectionIds,
    };
  }

  return {
    type: 'pane',
    connectionIds,
    activeConnectionId,
  };
}

/** Where a dragged node lands: inside a folder (null: top level) or next to another node. */
export type NodeDropTarget =
  | { kind: 'into'; folderId: string | null }
  | { kind: 'before' | 'after'; nodeId: string };

function contains(node: VaultNode, id: string): boolean {
  return node.id === id || (node.type === 'folder' && node.children.some(child => contains(child, id)));
}

function insertNext(nodes: VaultNode[], targetId: string, node: VaultNode, after: boolean): { nodes: VaultNode[]; found: boolean } {
  const index = nodes.findIndex(item => item.id === targetId);
  if (index >= 0) return { nodes: [...nodes.slice(0, index + (after ? 1 : 0)), node, ...nodes.slice(index + (after ? 1 : 0))], found: true };
  let found = false;
  const updated = nodes.map(item => {
    if (found || item.type !== 'folder') return item;
    const result = insertNext(item.children, targetId, node, after);
    found = result.found;
    return result.found ? { ...item, children: result.nodes } : item;
  });
  return { nodes: updated, found };
}

/** Moves a connection or folder; a folder can never move into itself or its own subfolders. */
export function moveNode(nodes: VaultNode[], nodeId: string, target: NodeDropTarget): VaultNode[] {
  const node = findNode(nodes, nodeId);
  if (!node) throw new Error(`Der Knoten "${nodeId}" wurde nicht gefunden.`);
  const anchor = target.kind === 'into' ? target.folderId : target.nodeId;
  if (anchor === nodeId) return nodes;
  if (anchor && contains(node, anchor)) throw new Error('Ein Ordner kann nicht in sich selbst verschoben werden.');
  const remaining = removeNode(nodes, nodeId);
  if (target.kind === 'into') return addNode(remaining, node, target.folderId ?? undefined);
  const result = insertNext(remaining, target.nodeId, node, target.kind === 'after');
  if (!result.found) throw new Error(`Der Knoten "${target.nodeId}" wurde nicht gefunden.`);
  return result.nodes;
}
