import { describe, expect, it } from 'vitest';
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
  it('validates terminal targets', () => {
    expect(KubeTerminalTargetSchema.safeParse({ namespace: 'shop', pod: 'api-1', container: 'api', mode: 'shell' }).success).toBe(true);
    expect(KubeTerminalTargetSchema.safeParse({ namespace: 'shop', pod: 'api-1', container: 'api;rm', mode: 'shell' }).success).toBe(false);
  });
});
