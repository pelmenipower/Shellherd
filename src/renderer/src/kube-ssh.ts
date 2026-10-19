import type { ConnectionNode, VaultNode } from '../../shared/vault/types';

function* activeSsh(nodes: VaultNode[]): Generator<ConnectionNode & { protocol: 'ssh' }> {
  for (const node of nodes) {
    if (node.type === 'folder') yield* activeSsh(node.children);
    else if (node.protocol === 'ssh' && !node.disabled) yield node as ConnectionNode & { protocol: 'ssh' };
  }
}

function shortName(name: string): string {
  return name.slice(name.lastIndexOf('-') + 1);
}

/** One name is the part after the last "-" of the other, at least two characters long. */
function shortMatch(a: string, b: string): boolean {
  const shortA = shortName(a);
  const shortB = shortName(b);
  return (shortA !== a && shortA.length >= 2 && shortA === b) || (shortB !== b && shortB.length >= 2 && shortB === a);
}

/**
 * Finds the active SSH connection for a cluster node. Rank 1: host = IP, 2: host = node name,
 * 3: name = node name, 4: short-name match. Within a rank the first hit in tree order wins.
 */
export function sshConnectionForNode(nodes: VaultNode[], node: { name: string; ip?: string }): { id: string; name: string } | undefined {
  const name = node.name.toLowerCase();
  const ip = node.ip?.toLowerCase();
  const ranks: Array<(c: { name: string; host: string }) => boolean> = [
    (c) => ip !== undefined && ip !== '' && c.host === ip,
    (c) => c.host === name,
    (c) => c.name === name,
    (c) => shortMatch(c.name, name),
  ];
  const connections = [...activeSsh(nodes)].map((c) => ({ c, name: c.name.toLowerCase(), host: c.host.toLowerCase() }));
  for (const matches of ranks) {
    const hit = connections.find(matches);
    if (hit) return { id: hit.c.id, name: hit.c.name };
  }
  return undefined;
}
