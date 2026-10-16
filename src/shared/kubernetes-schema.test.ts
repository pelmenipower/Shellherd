import { describe, expect, it } from 'vitest';
import { KUBE_NAME, manualJobName } from './kubernetes';
import { KubeActionRequestSchema, KubeQuerySchema, KubeRefSchema, KubeTerminalTargetSchema } from './kubernetes-schema';

describe('kubernetes schemas', () => {
  it('accepts a namespaced ref and rejects bad names', () => {
    expect(KubeRefSchema.safeParse({ kind: 'pods', namespace: 'shop', name: 'api-7f9c-x2kq' }).success).toBe(true);
    expect(KubeRefSchema.safeParse({ kind: 'pods', namespace: 'shop', name: 'API' }).success).toBe(false);
    expect(KubeRefSchema.safeParse({ kind: 'pods', namespace: '../x', name: 'a' }).success).toBe(false);
    expect(KubeRefSchema.safeParse({ kind: 'secrets', name: 'a' }).success).toBe(false);
  });
  it('accepts queries with label and node selectors', () => {
    expect(KubeQuerySchema.safeParse({ kind: 'pods', namespace: null, selector: { labels: { 'app.kubernetes.io/name': 'api' }, node: 'worker1' } }).success).toBe(true);
    expect(KubeQuerySchema.safeParse({ kind: 'pods', namespace: null, selector: { labels: { app: 'a,b' } } }).success).toBe(false);
  });
  it('bounds replicas', () => {
    const ref = { kind: 'deployments', namespace: 'shop', name: 'api' };
    expect(KubeActionRequestSchema.safeParse({ viewId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d', ref, action: 'scale', replicas: 3 }).success).toBe(true);
    expect(KubeActionRequestSchema.safeParse({ viewId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d', ref, action: 'scale', replicas: 1001 }).success).toBe(false);
    expect(KubeActionRequestSchema.safeParse({ viewId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d', ref, action: 'scale', replicas: 1.5 }).success).toBe(false);
  });
  it('accepts the new actions and rejects unknown ones', () => {
    const viewId = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
    const ref = { kind: 'nodes', name: 'w1' };
    for (const action of ['cordon', 'uncordon', 'suspend', 'resume', 'trigger']) expect(KubeActionRequestSchema.safeParse({ viewId, ref, action }).success).toBe(true);
    expect(KubeActionRequestSchema.safeParse({ viewId, ref, action: 'drain' }).success).toBe(false);
  });
  it('validates terminal targets', () => {
    expect(KubeTerminalTargetSchema.safeParse({ namespace: 'shop', pod: 'api-1', container: 'api', mode: 'shell' }).success).toBe(true);
    expect(KubeTerminalTargetSchema.safeParse({ namespace: 'shop', pod: 'api-1', container: 'api;rm', mode: 'shell' }).success).toBe(false);
  });
});

describe('manualJobName', () => {
  it('appends the unix time to a short name', () => {
    expect(manualJobName('nightly', 1760000000)).toBe('nightly-manual-1760000000');
  });
  it('keeps the whole suffix when the name is long', () => {
    const name = manualJobName('a'.repeat(52), 1760000000);
    expect(name.length).toBeLessThanOrEqual(63);
    expect(name).toMatch(/-manual-1760000000$/);
    expect(name).toMatch(KUBE_NAME);
  });
  it('drops a dash or dot left at the cut', () => {
    const name = manualJobName('a'.repeat(44) + '-bcdefgh', 1760000000);
    expect(name).toBe('a'.repeat(44) + '-manual-1760000000');
    expect(name).toMatch(KUBE_NAME);
    expect(manualJobName('a'.repeat(44) + '.bcdefgh', 1760000000)).toBe('a'.repeat(44) + '-manual-1760000000');
  });
  it('gives different names for different times', () => {
    const cron = 'a'.repeat(52);
    expect(manualJobName(cron, 1760000000)).not.toBe(manualJobName(cron, 1760000001));
  });
});
