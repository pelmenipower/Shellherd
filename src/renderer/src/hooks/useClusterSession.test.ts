import { describe, expect, it } from 'vitest';
import type { KubeDenied } from '../../../shared/kube-access';
import { accessRequests } from './useClusterSession';

const denied: KubeDenied[] = [{ id: 'patchDeployments', verb: 'patch', resource: 'deployments' }];

/** Requests that the test resolves by hand, in order. */
function setup() {
  const asks: { viewId: string; namespace: string; resolve: (value: KubeDenied[] | null) => void; reject: (error: Error) => void }[] = [];
  const answers: { namespace: string; denied: KubeDenied[] | null }[] = [];
  const gate = accessRequests(
    (viewId, namespace) => new Promise((resolve, reject) => { asks.push({ viewId, namespace, resolve, reject }); }),
    (namespace, value) => answers.push({ namespace, denied: value }),
  );
  return { gate, asks, answers };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

describe('accessRequests', () => {
  it('asks once per namespace while the answer is pending', async () => {
    const { gate, asks, answers } = setup();
    gate.ensure('v', 'shop');
    gate.ensure('v', 'shop');
    expect(asks).toHaveLength(1);
    asks[0].resolve(denied);
    await settle();
    expect(answers).toEqual([{ namespace: 'shop', denied }]);
    gate.ensure('v', 'shop');
    expect(asks).toHaveLength(2);
  });

  it('drops an answer that arrives after a reset and asks again on the next need', async () => {
    const { gate, asks, answers } = setup();
    gate.ensure('v', 'shop');
    gate.reset();
    gate.ensure('v', 'shop');
    expect(asks).toHaveLength(2);
    asks[0].resolve(null);
    await settle();
    expect(answers).toEqual([]);
    asks[1].resolve(denied);
    await settle();
    expect(answers).toEqual([{ namespace: 'shop', denied }]);
  });

  it('counts a failed request as unknown (null) and frees the namespace', async () => {
    const { gate, asks, answers } = setup();
    gate.ensure('v', 'shop');
    asks[0].resolve(null);
    await settle();
    expect(answers).toEqual([{ namespace: 'shop', denied: null }]);
  });

  it('treats a refused request (disabled cluster, locked vault) as unknown and asks again later', async () => {
    const { gate, asks, answers } = setup();
    gate.ensure('v', 'shop');
    asks[0].reject(new Error('kubernetes.disabled'));
    await settle();
    expect(answers).toEqual([{ namespace: 'shop', denied: null }]);
    gate.ensure('v', 'shop');
    expect(asks).toHaveLength(2);
  });
});
