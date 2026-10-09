import type { VaultNode } from '../../shared/vault/types';

export function findNode(nodes: VaultNode[], nodeId: string): VaultNode | undefined {
  for (const node of nodes) {
    if (node.id === nodeId) return node;
    if (node.type === 'folder') {
      const found = findNode(node.children, nodeId);
      if (found) return found;
    }
  }
  return undefined;
}
