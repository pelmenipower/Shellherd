import type { VaultNode } from '../../shared/vault/types';
import { foldCase } from '../../shared/format';
import { connectionAddress, protocolShort } from './connection-labels';

/** Match metadata and ancestor paths; never inspect authentication secrets. */
export function searchVaultNodes(nodes: VaultNode[], query: string): { node: VaultNode; path: string }[] {
  const terms = foldCase(query.trim()).split(/\s+/).filter(Boolean);
  const results: { node: VaultNode; path: string }[] = [];
  const visit = (items: VaultNode[], ancestors: string[]) => {
    for (const node of items) {
      const text = foldCase([node.name, ...ancestors, ...(node.type === 'connection' ? [connectionAddress(node), protocolShort(node.protocol), ...node.tags] : [])].join(' '));
      if (terms.every(term => text.includes(term))) results.push({ node, path: ancestors.join(' / ') });
      if (node.type === 'folder') visit(node.children, [...ancestors, node.name]);
    }
  };
  visit(nodes, []);
  return results;
}
