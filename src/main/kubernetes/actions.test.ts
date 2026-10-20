import { describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { KubeAction } from '../../shared/kubernetes';
import type { KubeApi } from './api';
import { runAction } from './actions';

const fakeApi = () => ({ mergePatch: vi.fn(async () => {}), remove: vi.fn(async () => {}) }) as unknown as KubeApi & { mergePatch: Mock; remove: Mock };
const deploy = { kind: 'deployments', namespace: 'shop', name: 'api' } as const;

describe('runAction', () => {
  it('restarts by patching the template annotation', async () => {
    const api = fakeApi();
    await runAction(api, { ref: deploy, action: 'restart' }, { readOnly: false, now: () => new Date('2026-10-16T10:00:00Z') });
    expect(api.mergePatch).toHaveBeenCalledWith(deploy, { spec: { template: { metadata: { annotations: { 'kubectl.kubernetes.io/restartedAt': '2026-10-16T10:00:00.000Z' } } } } });
  });

  it('scales by patching spec.replicas', async () => {
    const api = fakeApi();
    await runAction(api, { ref: deploy, action: 'scale', replicas: 0 }, { readOnly: false });
    expect(api.mergePatch).toHaveBeenCalledWith(deploy, { spec: { replicas: 0 } });
  });

  it('deletes pods', async () => {
    const api = fakeApi();
    await runAction(api, { ref: { kind: 'pods', namespace: 'shop', name: 'api-1' }, action: 'delete' }, { readOnly: false });
    expect(api.remove).toHaveBeenCalledWith({ kind: 'pods', namespace: 'shop', name: 'api-1' });
  });

  it('refuses everything on read-only clusters without calling the API', async () => {
    const api = fakeApi();
    await expect(runAction(api, { ref: deploy, action: 'restart' }, { readOnly: true })).rejects.toMatchObject({ code: 'kubernetes.readOnly' });
    expect(api.mergePatch).not.toHaveBeenCalled();
    await expect(runAction(api, { ref: { kind: 'pods', namespace: 'shop', name: 'api-1' }, action: 'delete' }, { readOnly: true })).rejects.toMatchObject({ code: 'kubernetes.readOnly' });
    expect(api.remove).not.toHaveBeenCalled();
  });

  it('refuses actions that do not fit the kind, scale without replicas and refs without namespace', async () => {
    const api = fakeApi();
    await expect(runAction(api, { ref: { kind: 'pods', namespace: 'shop', name: 'a' }, action: 'restart' }, { readOnly: false })).rejects.toMatchObject({ code: 'kubernetes.actionUnavailable' });
    await expect(runAction(api, { ref: deploy, action: 'scale' }, { readOnly: false })).rejects.toMatchObject({ code: 'kubernetes.replicasMissing' });
    await expect(runAction(api, { ref: { kind: 'pods', name: 'a' }, action: 'delete' }, { readOnly: false })).rejects.toMatchObject({ code: 'kubernetes.actionUnavailable' });
    expect(api.mergePatch).not.toHaveBeenCalled();
    expect(api.remove).not.toHaveBeenCalled();
  });

  it('refuses replicas outside 0..MAX_REPLICAS or not an integer', async () => {
    const api = fakeApi();
    for (const replicas of [-1, 1.5, 1001, Number.NaN]) {
      await expect(runAction(api, { ref: deploy, action: 'scale', replicas }, { readOnly: false })).rejects.toMatchObject({ code: 'kubernetes.replicasMissing' });
    }
    expect(api.mergePatch).not.toHaveBeenCalled();
  });

  it('passes API errors through unchanged', async () => {
    const api = fakeApi();
    api.remove.mockRejectedValueOnce(new Error('forbidden'));
    await expect(runAction(api, { ref: { kind: 'pods', namespace: 'shop', name: 'a' }, action: 'delete' }, { readOnly: false })).rejects.toThrow('forbidden');
  });
});

describe('runAction (context-menu actions)', () => {
  const node = { kind: 'nodes', name: 'w1' } as const;
  const cron = { kind: 'cronjobs', namespace: 'shop', name: 'backup' } as const;
  const rw = { readOnly: false };
  const fake = () => {
    const api = fakeApi() as KubeApi & { mergePatch: Mock; remove: Mock; createJobFrom: Mock };
    api.createJobFrom = vi.fn(async () => {});
    return api;
  };

  it('cordons and uncordons nodes without namespace', async () => {
    const api = fake();
    await runAction(api, { ref: node, action: 'cordon' }, rw);
    expect(api.mergePatch).toHaveBeenLastCalledWith(node, { spec: { unschedulable: true } });
    await runAction(api, { ref: node, action: 'uncordon' }, rw);
    expect(api.mergePatch).toHaveBeenLastCalledWith(node, { spec: { unschedulable: false } });
  });

  it('refuses a namespace on a cluster-scoped kind and a missing one on a namespaced kind', async () => {
    const api = fake();
    await expect(runAction(api, { ref: { kind: 'nodes', namespace: 'x', name: 'w1' }, action: 'cordon' }, rw)).rejects.toMatchObject({ code: 'kubernetes.actionUnavailable' });
    await expect(runAction(api, { ref: { kind: 'pods', name: 'a' }, action: 'delete' }, rw)).rejects.toMatchObject({ code: 'kubernetes.actionUnavailable' });
    expect(api.mergePatch).not.toHaveBeenCalled();
  });

  it('suspends and resumes cronjobs', async () => {
    const api = fake();
    await runAction(api, { ref: cron, action: 'suspend' }, rw);
    expect(api.mergePatch).toHaveBeenLastCalledWith(cron, { spec: { suspend: true } });
    await runAction(api, { ref: cron, action: 'resume' }, rw);
    expect(api.mergePatch).toHaveBeenLastCalledWith(cron, { spec: { suspend: false } });
  });

  it('triggers a job named from options.now', async () => {
    const api = fake();
    await runAction(api, { ref: cron, action: 'trigger' }, { readOnly: false, now: () => new Date('2026-10-16T10:00:00Z') });
    expect(api.createJobFrom).toHaveBeenCalledWith(cron, 'backup-manual-1792144800');
  });

  it('deletes jobs with Background propagation and pods without options', async () => {
    const api = fake();
    const job = { kind: 'jobs', namespace: 'shop', name: 'j' } as const;
    await runAction(api, { ref: job, action: 'delete' }, rw);
    expect(api.remove).toHaveBeenLastCalledWith(job, { propagationPolicy: 'Background' });
    const pod = { kind: 'pods', namespace: 'shop', name: 'p' } as const;
    await runAction(api, { ref: pod, action: 'delete' }, rw);
    expect(api.remove).toHaveBeenLastCalledWith(pod);
  });

  it('refuses read-only, wrong kinds and unknown actions without an API call', async () => {
    const api = fake();
    await expect(runAction(api, { ref: node, action: 'cordon' }, { readOnly: true })).rejects.toMatchObject({ code: 'kubernetes.readOnly' });
    await expect(runAction(api, { ref: deploy, action: 'cordon' }, rw)).rejects.toMatchObject({ code: 'kubernetes.actionUnavailable' });
    await expect(runAction(api, { ref: node, action: 'drain' as KubeAction }, rw)).rejects.toMatchObject({ code: 'kubernetes.actionUnavailable' });
    expect(api.mergePatch).not.toHaveBeenCalled();
    expect(api.createJobFrom).not.toHaveBeenCalled();
  });
});
