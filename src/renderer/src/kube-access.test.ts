import { describe, expect, it } from 'vitest';
import type { ClusterStatus } from '../../shared/kubernetes';
import { accessNamespace, accessStale, refAccessReason, type KubeAccessMap } from './kube-access';

const READY: ClusterStatus = { state: 'ready', name: 'c', production: false, readOnly: false, metrics: true, namespace: 'shop' };
const pod = { kind: 'pods' as const, namespace: 'shop', name: 'api-1' };
const node = { kind: 'nodes' as const, name: 'worker2' };

describe('accessNamespace', () => {
  it('uses the namespace of the object, the default namespace for cluster-wide kinds, else default', () => {
    expect(accessNamespace(pod, null)).toBe('shop');
    expect(accessNamespace(node, READY)).toBe('shop');
    expect(accessNamespace(node, { ...READY, namespace: undefined })).toBe('default');
    expect(accessNamespace(node, null)).toBe('default');
  });
});

describe('accessStale', () => {
  it('is stale without an answer and after 60 s', () => {
    const access: KubeAccessMap = { shop: { at: 1_000_000, denied: [] } };
    expect(accessStale(access, 'monitoring', 1_000_000)).toBe(true);
    expect(accessStale(access, 'shop', 1_000_000 + 59_000)).toBe(false);
    expect(accessStale(access, 'shop', 1_000_000 + 60_000)).toBe(false);
    expect(accessStale(access, 'shop', 1_000_000 + 61_000)).toBe(true);
  });
});

describe('refAccessReason', () => {
  const access: KubeAccessMap = {
    shop: { at: 1, denied: [{ id: 'shell', verb: 'create', resource: 'pods/exec' }, { id: 'patchNodes', verb: 'patch', resource: 'nodes' }] },
    monitoring: { at: 1, denied: null },
  };
  it('names verb, resource and namespace, cluster-wide for nodes', () => {
    expect(refAccessReason(access, READY, pod, 'shell')).toBe('Keine Berechtigung: create auf pods/exec in shop');
    expect(refAccessReason(access, READY, node, 'patchNodes')).toBe('Keine Berechtigung: patch auf nodes (clusterweit)');
  });
  it('blocks nothing that is allowed, unknown (null) or not asked yet', () => {
    expect(refAccessReason(access, READY, pod, 'logs')).toBeUndefined();
    expect(refAccessReason(access, READY, { ...pod, namespace: 'monitoring' }, 'shell')).toBeUndefined();
    expect(refAccessReason(access, READY, { ...pod, namespace: 'kube-system' }, 'shell')).toBeUndefined();
    expect(refAccessReason({}, READY, node, 'patchNodes')).toBeUndefined();
  });
});
