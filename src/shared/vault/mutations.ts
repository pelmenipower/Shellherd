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
        ...(workspace.windows ? { windows: workspace.windows.map(window => ({
          ...window, layout: removeConnectionsFromLayout(window.layout, removedConnectionIds),
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
