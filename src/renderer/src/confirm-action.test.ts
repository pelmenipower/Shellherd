import { describe, expect, it } from 'vitest';
import type { KubeAction, KubeRef } from '../../shared/kubernetes';
import { confirmationFor } from './confirm-action';
import { i18n } from './i18n';

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

  const test = { name: 'test', production: false };
  const prod = { name: 'test', production: true };
  const ns = { namespace: 'shop' };
  const cases: Array<[string, KubeRef, KubeAction, string, string, string]> = [
    ['delete job', { kind: 'jobs', ...ns, name: 'backup-1' }, 'delete', 'Job löschen?', 'Job backup-1 im Namespace shop auf test und seine Pods werden gelöscht.', 'Löschen'],
    ['cordon', { kind: 'nodes', name: 'w1' }, 'cordon', 'Node sperren?', 'Auf Node w1 auf test werden keine neuen Pods mehr geplant. Laufende Pods bleiben.', 'Sperren'],
    ['uncordon', { kind: 'nodes', name: 'w1' }, 'uncordon', 'Node freigeben?', 'Node w1 auf test nimmt wieder neue Pods an.', 'Freigeben'],
    ['suspend', { kind: 'cronjobs', ...ns, name: 'nightly' }, 'suspend', 'CronJob anhalten?', 'CronJob nightly im Namespace shop auf test startet keine neuen Jobs mehr.', 'Anhalten'],
    ['resume', { kind: 'cronjobs', ...ns, name: 'nightly' }, 'resume', 'CronJob fortsetzen?', 'CronJob nightly im Namespace shop auf test startet wieder nach Zeitplan.', 'Fortsetzen'],
    ['trigger', { kind: 'cronjobs', ...ns, name: 'nightly' }, 'trigger', 'CronJob jetzt ausführen?', 'Aus CronJob nightly im Namespace shop auf test wird sofort ein Job gestartet.', 'Ausführen'],
  ];
  it.each(cases)('words %s', (_name, ref, action, title, body, confirmLabel) => {
    expect(confirmationFor({ ref, action }, test)).toEqual({ title, body, requireTyping: null, confirmLabel });
    expect(confirmationFor({ ref, action }, prod)).toEqual({ title, body, requireTyping: ref.name, confirmLabel });
  });
});

describe('confirmationFor in English', () => {
  it('words restart, scale and delete natively', async () => {
    await i18n.changeLanguage('en-US');
    try {
      const cluster = { name: 'k8s', production: false };
      expect(confirmationFor({ ref: { kind: 'deployments', namespace: 'shop', name: 'api' }, action: 'restart' }, cluster))
        .toEqual({ title: 'Restart rollout?', body: 'Deployment api in namespace shop on k8s will be restarted.', requireTyping: null, confirmLabel: 'Restart' });
      expect(confirmationFor({ ref: { kind: 'deployments', namespace: 'shop', name: 'api' }, action: 'scale', replicas: 2, currentReplicas: 3 }, cluster).body)
        .toBe('Deployment api in namespace shop on k8s: 3 → 2 replicas.');
      expect(confirmationFor({ ref: { kind: 'jobs', namespace: 'shop', name: 'j' }, action: 'delete' }, cluster).title).toBe('Delete job?');
    } finally { await i18n.changeLanguage('de-DE'); }
  });
});
