import { describe, expect, it } from 'vitest';
import * as k from './kube-kubectl';

const SAFE = /^kubectl( [-a-zA-Z0-9.\/=:,_]+)+$/;

describe('kube-kubectl builders', () => {
  it('builds the documented commands', () => {
    expect(k.logs('shop', 'api-1', 'api')).toBe('kubectl -n shop logs -f api-1 -c api');
    expect(k.logs('shop', 'api-1')).toBe('kubectl -n shop logs -f api-1');
    expect(k.logs('shop', 'api-1', 'api', true)).toBe('kubectl -n shop logs --previous api-1 -c api');
    expect(k.exec('shop', 'api-1', 'api')).toBe('kubectl -n shop exec -it api-1 -c api -- sh');
    expect(k.exec('shop', 'api-1')).toBe('kubectl -n shop exec -it api-1 -- sh');
    expect(k.describe('pods', 'shop', 'api-1')).toBe('kubectl -n shop describe pod api-1');
    expect(k.describe('nodes', undefined, 'worker1')).toBe('kubectl describe node worker1');
    expect(k.getYaml('deployments', 'shop', 'api')).toBe('kubectl -n shop get deployment api -o yaml');
    expect(k.rolloutRestart('statefulsets', 'shop', 'db')).toBe('kubectl -n shop rollout restart statefulset db');
    expect(k.rolloutStatus('deployments', 'shop', 'api')).toBe('kubectl -n shop rollout status deployment api');
    expect(k.scale('deployments', 'shop', 'api', 3)).toBe('kubectl -n shop scale deployment api --replicas=3');
    expect(k.logsJob('shop', 'migrate')).toBe('kubectl -n shop logs job/migrate');
    expect(k.createJobFromCron('shop', 'backup', 1792131952)).toBe('kubectl -n shop create job --from=cronjob/backup backup-manual-1792131952');
    expect(k.patchSuspend('shop', 'backup', true)).toBe(`kubectl -n shop patch cronjob backup -p '{"spec":{"suspend":true}}'`);
    expect(k.patchSuspend('shop', 'backup', false)).toBe(`kubectl -n shop patch cronjob backup -p '{"spec":{"suspend":false}}'`);
    expect(k.cordon('worker1')).toBe('kubectl cordon worker1');
    expect(k.uncordon('worker1')).toBe('kubectl uncordon worker1');
    expect(k.drain('worker1')).toBe('kubectl drain worker1 --ignore-daemonsets --delete-emptydir-data');
    expect(k.portForward('shop', 'web', 8080)).toBe('kubectl -n shop port-forward svc/web 8080:8080');
    expect(k.serviceDns('shop', 'web')).toBe('web.shop.svc.cluster.local');
    expect(k.labelsText({ tier: 'web', app: 'api' })).toBe('app=api\ntier=web');
    expect(k.selectorText({ app: 'api', tier: 'web' })).toBe('app=api,tier=web');
  });

  it('keeps every output but patchSuspend within the safe charset', () => {
    const outs = [
      k.logs('shop', 'api-1', 'api', true), k.exec('shop', 'api-1', 'api'), k.describe('pods', 'shop', 'a'),
      k.getYaml('cronjobs', 'shop', 'a'), k.rolloutRestart('daemonsets', 'shop', 'a'), k.rolloutStatus('deployments', 'shop', 'a'),
      k.scale('deployments', 'shop', 'a', 2), k.logsJob('shop', 'a'), k.createJobFromCron('shop', 'a', 1),
      k.cordon('n1'), k.uncordon('n1'), k.drain('n1'), k.portForward('shop', 'web', 80),
    ];
    for (const out of outs) expect(out).toMatch(SAFE);
  });

  it('returns null for invalid names', () => {
    for (const bad of ['Api', 'a;b', 'a b', '', 'a$(x)']) {
      expect(k.logs(bad, 'p')).toBeNull();
      expect(k.logs('shop', bad)).toBeNull();
      expect(k.logs('shop', 'p', bad)).toBeNull();
      expect(k.exec('shop', bad)).toBeNull();
      expect(k.describe('pods', bad, 'p')).toBeNull();
      expect(k.getYaml('pods', 'shop', bad)).toBeNull();
      expect(k.rolloutRestart('deployments', 'shop', bad)).toBeNull();
      expect(k.rolloutStatus('deployments', bad, 'a')).toBeNull();
      expect(k.scale('deployments', 'shop', bad, 1)).toBeNull();
      expect(k.logsJob(bad, 'a')).toBeNull();
      expect(k.createJobFromCron('shop', bad, 1)).toBeNull();
      expect(k.patchSuspend('shop', bad, true)).toBeNull();
      expect(k.cordon(bad)).toBeNull();
      expect(k.uncordon(bad)).toBeNull();
      expect(k.drain(bad)).toBeNull();
      expect(k.portForward('shop', bad, 80)).toBeNull();
      expect(k.serviceDns('shop', bad)).toBeNull();
    }
    expect(k.describe('pods', undefined, 'p')).toBeNull();
  });

  it('rejects bad numbers', () => {
    expect(k.scale('deployments', 'shop', 'api', -1)).toBeNull();
    expect(k.scale('deployments', 'shop', 'api', 1.5)).toBeNull();
    expect(k.scale('deployments', 'shop', 'api', 1001)).toBeNull();
    expect(k.scale('deployments', 'shop', 'api', 0)).toBe('kubectl -n shop scale deployment api --replicas=0');
    expect(k.portForward('shop', 'web', 0)).toBeNull();
    expect(k.portForward('shop', 'web', 70000)).toBeNull();
    expect(k.createJobFromCron('shop', 'backup', 1.5)).toBeNull();
  });

  it('validates labels and selectors', () => {
    expect(k.labelsText({ 'a b': 'x' })).toBeNull();
    expect(k.labelsText({ app: 'x;y' })).toBeNull();
    expect(k.selectorText({ app: 'a,b' })).toBeNull();
    expect(k.labelsText({})).toBe('');
    expect(k.labelsText({ 'app.kubernetes.io/name': 'api', empty: '' })).toBe('app.kubernetes.io/name=api\nempty=');
  });
});
