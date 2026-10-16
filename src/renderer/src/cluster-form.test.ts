import { describe, expect, it } from 'vitest';
import { emptyCluster, newClusterFromSsh, suggestAccessHosts, validateCluster } from './cluster-form';
import type { SshConnectionNode } from '../../shared/vault/types';

function ssh(id: string, host: string): SshConnectionNode {
  return { id, type: 'connection', protocol: 'ssh', name: id, tags: [], host, port: 22, authentication: { method: 'agent' } };
}

describe('cluster access hosts', () => {
  it('suggests sibling control planes by host pattern', () => {
    const nodes = [ssh('a', 'k8s-cp1'), ssh('b', 'k8s-cp2'), ssh('c', 'k8s-cp3'), ssh('d', 'k8s-worker1'), ssh('e', 'other-cp2')];
    expect(suggestAccessHosts(nodes, 'a')).toEqual(['a', 'b', 'c']);
  });
  it('works with FQDNs and skips disabled connections', () => {
    const nodes = [ssh('a', 'k8s-cp1.example.local'), { ...ssh('b', 'k8s-cp2.example.local'), disabled: true }, ssh('c', 'k8s-cp3.example.local')];
    expect(suggestAccessHosts(nodes, 'a')).toEqual(['a', 'c']);
  });
  it('orders multi-digit numbers numerically and puts the source first', () => {
    const nodes = [ssh('a', 'cp2'), ssh('b', 'cp10'), ssh('c', 'cp1')];
    expect(suggestAccessHosts(nodes, 'a')).toEqual(['a', 'c', 'b']);
  });
  it('suggests only the source when the host has no number', () => {
    expect(suggestAccessHosts([ssh('a', 'gateway'), ssh('b', 'gateway2')], 'a')).toEqual(['a']);
  });
});

describe('cluster creation and validation', () => {
  it('creates a production cluster from the probe', () => {
    const cluster = newClusterFromSsh(ssh('a', 'k8s-cp1'), [ssh('a', 'k8s-cp1')], { source: '/etc/kubernetes/admin.conf (sudo)', contexts: ['kubernetes-admin@kubernetes'], currentContext: 'kubernetes-admin@kubernetes', clusterName: 'kubernetes' }, 'k1');
    expect(cluster).toMatchObject({ id: 'k1', protocol: 'kubernetes', name: 'kubernetes', accessHosts: ['a'], kubeconfig: { source: 'auto' }, production: true, readOnly: false });
    expect(cluster.context).toBe('kubernetes-admin@kubernetes');
  });
  it('leaves the context empty when the probe has no current context', () => {
    const cluster = newClusterFromSsh(ssh('a', 'h'), [ssh('a', 'h')], { source: '~/.kube/config', contexts: ['x'] }, 'k1');
    expect(cluster.context).toBeUndefined();
  });
  it('creates an empty cluster with production defaults', () => {
    expect(emptyCluster('k')).toMatchObject({ protocol: 'kubernetes', name: '', tags: [], accessHosts: [], kubeconfig: { source: 'auto' }, production: true, readOnly: false, type: 'connection' });
  });
  it('validates access hosts and paths', () => {
    expect(validateCluster({ ...emptyCluster('k'), accessHosts: [] }, [])).toBe('Wähle mindestens eine SSH-Verbindung als Zugang.');
    expect(validateCluster({ ...emptyCluster('k'), accessHosts: ['x'] }, [])).toBe('Die Zugangs-Verbindung „x“ gibt es nicht mehr.');
    expect(validateCluster({ ...emptyCluster('k'), name: '', accessHosts: ['a'] }, [ssh('a', 'h')])).toBe('Bitte gib einen Namen an.');
    expect(validateCluster({ ...emptyCluster('k'), name: 'x', accessHosts: ['a'], kubeconfig: { source: 'path', path: 'rel/path' } }, [ssh('a', 'h')]))
      .toBe('Der Pfad muss mit / oder ~/ beginnen.');
  });
  it('accepts a valid cluster and rejects disabled access hosts', () => {
    const cluster = { ...emptyCluster('k'), name: 'Prod', accessHosts: ['a'], kubeconfig: { source: 'path' as const, path: '~/.kube/config' } };
    expect(validateCluster(cluster, [ssh('a', 'h')])).toBeNull();
    expect(validateCluster(cluster, [{ ...ssh('a', 'h'), disabled: true }])).toBe('Die Zugangs-Verbindung „a“ ist deaktiviert.');
  });
});
