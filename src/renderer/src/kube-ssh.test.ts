import { describe, expect, it } from 'vitest';
import type { ConnectionNode, VaultNode } from '../../shared/vault/types';
import { sshConnectionForNode } from './kube-ssh';

function ssh(id: string, name: string, host: string, extra: Partial<ConnectionNode> = {}): ConnectionNode {
  return { id, type: 'connection', protocol: 'ssh', name, host, port: 22, tags: [], authentication: { method: 'password', password: 'x' }, ...extra } as ConnectionNode;
}

describe('sshConnectionForNode', () => {
  it('ranks host=ip above host=name above name=name above short name', () => {
    const nodes: VaultNode[] = [ssh('short', 'worker2', 'other-a'), ssh('byName', 'k8s-worker2', 'other-b'), ssh('byHostName', 'x', 'K8S-Worker2'), ssh('byIp', 'y', '10.0.0.2')];
    const node = { name: 'k8s-worker2', ip: '10.0.0.2' };
    expect(sshConnectionForNode(nodes, node)).toEqual({ id: 'byIp', name: 'y' });
    expect(sshConnectionForNode(nodes.slice(0, 3), node)?.id).toBe('byHostName');
    expect(sshConnectionForNode(nodes.slice(0, 2), node)?.id).toBe('byName');
    expect(sshConnectionForNode(nodes.slice(0, 1), node)?.id).toBe('short');
  });

  it('lets an exact match further down beat a short-name match further up', () => {
    const nodes: VaultNode[] = [ssh('short', 'worker2', 'a'), { id: 'f', type: 'folder', name: 'F', children: [ssh('exact', 'n', 'k8s-worker2')] }];
    expect(sshConnectionForNode(nodes, { name: 'k8s-worker2' })?.id).toBe('exact');
  });

  it('matches the short name in both directions', () => {
    expect(sshConnectionForNode([ssh('a', 'k8s-worker2', 'h')], { name: 'worker2' })?.id).toBe('a');
    expect(sshConnectionForNode([ssh('a', 'worker2', 'h')], { name: 'k8s-worker2' })?.id).toBe('a');
  });

  it('requires at least two characters for a short name and no partial matches', () => {
    expect(sshConnectionForNode([ssh('a', 'x', 'h')], { name: 'node-x' })).toBeUndefined();
    expect(sshConnectionForNode([ssh('a', 'worker', 'h')], { name: 'k8s-worker2' })).toBeUndefined();
  });

  it('takes the first hit in tree order within a rank and ignores case', () => {
    const nodes: VaultNode[] = [{ id: 'f', type: 'folder', name: 'F', children: [ssh('first', 'N1', 'h1')] }, ssh('second', 'n1', 'h2')];
    expect(sshConnectionForNode(nodes, { name: 'n1' })?.id).toBe('first');
  });

  it('skips disabled and non-ssh connections', () => {
    const nodes: VaultNode[] = [ssh('off', 'n1', 'h', { disabled: true }), { ...ssh('sftp', 'n1', 'h'), protocol: 'sftp' } as ConnectionNode, ssh('on', 'n1', 'h')];
    expect(sshConnectionForNode(nodes, { name: 'n1' })?.id).toBe('on');
    expect(sshConnectionForNode(nodes.slice(0, 2), { name: 'n1' })).toBeUndefined();
  });
});
