import { describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
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
    await expect(runAction(api, { ref: deploy, action: 'restart' }, { readOnly: true })).rejects.toThrow('Dieser Cluster ist schreibgeschützt.');
    expect(api.mergePatch).not.toHaveBeenCalled();
    await expect(runAction(api, { ref: { kind: 'pods', namespace: 'shop', name: 'api-1' }, action: 'delete' }, { readOnly: true })).rejects.toThrow('Dieser Cluster ist schreibgeschützt.');
    expect(api.remove).not.toHaveBeenCalled();
  });

  it('refuses actions that do not fit the kind, scale without replicas and refs without namespace', async () => {
    const api = fakeApi();
    await expect(runAction(api, { ref: { kind: 'pods', namespace: 'shop', name: 'a' }, action: 'restart' }, { readOnly: false })).rejects.toThrow('Diese Aktion ist hier nicht möglich.');
    await expect(runAction(api, { ref: deploy, action: 'scale' }, { readOnly: false })).rejects.toThrow('Bitte gib die Anzahl der Replicas an.');
    await expect(runAction(api, { ref: { kind: 'pods', name: 'a' }, action: 'delete' }, { readOnly: false })).rejects.toThrow('Diese Aktion ist hier nicht möglich.');
    expect(api.mergePatch).not.toHaveBeenCalled();
    expect(api.remove).not.toHaveBeenCalled();
  });

  it('refuses replicas outside 0..MAX_REPLICAS or not an integer', async () => {
    const api = fakeApi();
    for (const replicas of [-1, 1.5, 1001, Number.NaN]) {
      await expect(runAction(api, { ref: deploy, action: 'scale', replicas }, { readOnly: false })).rejects.toThrow('Bitte gib die Anzahl der Replicas an.');
    }
    expect(api.mergePatch).not.toHaveBeenCalled();
  });

  it('passes API errors through unchanged', async () => {
    const api = fakeApi();
    api.remove.mockRejectedValueOnce(new Error('forbidden'));
    await expect(runAction(api, { ref: { kind: 'pods', namespace: 'shop', name: 'a' }, action: 'delete' }, { readOnly: false })).rejects.toThrow('forbidden');
  });
});
