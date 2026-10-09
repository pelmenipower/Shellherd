import { describe, expect, it } from 'vitest';
import { findNode } from './vault-selection';
import { addNode } from '../../shared/vault/mutations';
import type { FolderNode, VaultNode } from '../../shared/vault/types';

describe('vault selection', () => {
  const leaf: FolderNode = { id: 'leaf', type: 'folder', name: 'Leaf', children: [] };
  const nodes: VaultNode[] = [{ id: 'root', type: 'folder', name: 'Root', children: [
    { id: 'middle', type: 'folder', name: 'Middle', children: [leaf] },
  ] }];

  it('finds a selected folder at three levels without changing the tree', () => {
    expect(findNode(nodes, 'leaf')).toBe(leaf);
    expect(findNode(nodes, 'missing')).toBeUndefined();
    const child: FolderNode = { id: 'new', type: 'folder', name: 'New', children: [] };
    const updated = addNode(nodes, child, findNode(nodes, 'leaf')?.id);
    expect(findNode(updated, 'leaf')).toMatchObject({ children: [child] });
    expect(leaf.children).toEqual([]);
  });

  it('finds connections alongside folders', () => {
    const connection: VaultNode = { id: 'ssh', type: 'connection', name: 'SSH', host: 'example.test',
      port: 22, authentication: { method: 'agent' }, tags: [] };
    expect(findNode([...nodes, connection], 'ssh')).toBe(connection);
  });
});
