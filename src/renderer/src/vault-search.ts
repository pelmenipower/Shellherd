import type { VaultNode } from '../../shared/vault/types';

/** Match metadata and ancestor paths; never inspect authentication secrets. */
export function searchVaultNodes(nodes: VaultNode[], query: string): { node: VaultNode; path: string }[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const results: { node: VaultNode; path: string }[] = [];
  const visit = (items: VaultNode[], ancestors: string[]) => {
    for (const node of items) {
      const text = [node.name, ...ancestors, ...(node.type === 'connection' ? [node.host, node.username ?? '', ...node.tags] : [])].join(' ').toLocaleLowerCase();
      if (terms.every(term => text.includes(term))) results.push({ node, path: ancestors.join(' / ') });
      if (node.type === 'folder') visit(node.children, [...ancestors, node.name]);
    }
  };
  visit(nodes, []);
  return results;
}
