import { describe, expect, it } from 'vitest';
import { confirmationFor } from './confirm-action';

describe('confirmationFor', () => {
  it('asks to type the name on production clusters', () => {
    expect(confirmationFor({ ref: { kind: 'deployments', namespace: 'shop', name: 'api' }, action: 'restart' }, { name: 'k8s', production: true }))
      .toEqual({ title: 'Rollout neu starten?', body: 'Deployment api im Namespace shop auf k8s wird neu gestartet.', requireTyping: 'api', confirmLabel: 'Neu starten' });
  });

  it('asks to type the name when scaling to zero, also outside production', () => {
    const result = confirmationFor({ ref: { kind: 'statefulsets', namespace: 'db', name: 'pg' }, action: 'scale', replicas: 0, currentReplicas: 3 }, { name: 'test', production: false });
    expect(result).toMatchObject({ title: 'Skalieren?', body: 'StatefulSet pg im Namespace db auf test: 3 → 0 Replicas.', requireTyping: 'pg', confirmLabel: 'Skalieren' });
  });

  it('only confirms without typing outside production', () => {
    expect(confirmationFor({ ref: { kind: 'pods', namespace: 'shop', name: 'api-1' }, action: 'delete' }, { name: 'test', production: false }))
      .toEqual({ title: 'Pod löschen?', body: 'Pod api-1 im Namespace shop auf test wird gelöscht.', requireTyping: null, confirmLabel: 'Löschen' });
  });
});
