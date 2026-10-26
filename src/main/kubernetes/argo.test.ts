import { describe, expect, it } from 'vitest';
import { ARGO_TIMEOUT_MS, argoAppLocation, argoStateOf } from './argo';

const app = (spec: object, status: object = {}) => ({ metadata: { name: 'shop', namespace: 'argocd' }, spec, status });

describe('argoAppLocation', () => {
  it('reads plain names from argocd and namespace_name from their namespace', () => {
    expect(argoAppLocation('shop')).toEqual({ namespace: 'argocd', name: 'shop' });
    expect(argoAppLocation('team-a_shop')).toEqual({ namespace: 'team-a', name: 'shop' });
    for (const name of ['evil.example.test/x', 'A', 'a_b_c', '']) expect(argoAppLocation(name)).toBeNull();
    expect(ARGO_TIMEOUT_MS).toBe(5000);
  });
});

describe('argoStateOf', () => {
  it('reads automated sync and Self-Heal, Argo CD 3 enabled: false included', () => {
    expect(argoStateOf(app({ syncPolicy: { automated: { selfHeal: true } } }))).toEqual({ automated: true, selfHeal: true });
    expect(argoStateOf(app({ syncPolicy: { automated: {} } }))).toEqual({ automated: true, selfHeal: false });
    expect(argoStateOf(app({ syncPolicy: { automated: { enabled: false, selfHeal: true } } }))).toEqual({ automated: false, selfHeal: false });
    expect(argoStateOf(app({ syncPolicy: { automated: { selfHeal: 'true' } } }))).toEqual({ automated: true, selfHeal: false });
    expect(argoStateOf(app({ syncPolicy: { automated: true } }))).toEqual({ automated: false, selfHeal: false });
    expect(argoStateOf(app({}))).toEqual({ automated: false, selfHeal: false });
    expect(argoStateOf({})).toEqual({ automated: false, selfHeal: false });
  });

  it('keeps only Argo CD sync and health values', () => {
    expect(argoStateOf(app({}, { sync: { status: 'OutOfSync' }, health: { status: 'Degraded' } }))).toEqual({ automated: false, selfHeal: false, sync: 'OutOfSync', health: 'Degraded' });
    expect(argoStateOf(app({}, { sync: { status: 'Evil' }, health: { status: '<b>x</b>' } }))).toEqual({ automated: false, selfHeal: false });
  });
});
