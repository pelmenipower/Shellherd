import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContainerInventory } from '../../shared/containers';
import type { ContainerViewAction } from './container-view';
import { InventoryScheduler, type InventoryInput } from './inventory-scheduler';

interface Pending { input: InventoryInput; resolve: (inv: ContainerInventory) => void; reject: (e: unknown) => void }

const inv = (n: number) => ({ n }) as unknown as ContainerInventory;
const A: InventoryInput = { hostId: 'h', runtime: 'docker' };

function setup(pollMs?: number) {
  const pending: Pending[] = [];
  const actions: ContainerViewAction[] = [];
  const scheduler = new InventoryScheduler({
    request: input => new Promise<ContainerInventory>((resolve, reject) => { pending.push({ input, resolve, reject }); }),
    dispatch: a => { actions.push(a); },
    ...(pollMs !== undefined ? { pollMs } : {}),
  });
  scheduler.start();
  return { scheduler, pending, actions };
}
const flush = () => vi.advanceTimersByTimeAsync(0);

describe('InventoryScheduler', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('loads on first visible update, then polls quietly', async () => {
    const { scheduler, pending, actions } = setup();
    scheduler.update(A, true);
    expect(pending).toHaveLength(1);
    expect(pending[0].input).toEqual(A);
    expect(actions).toEqual([{ type: 'loading' }]);
    pending[0].resolve(inv(1));
    await flush();
    expect(actions[1]).toEqual({ type: 'setInventory', inventory: inv(1) });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(pending).toHaveLength(2);
    expect(actions[2]).toEqual({ type: 'loading', quiet: true });
  });

  it('respects pollMs', async () => {
    const { scheduler, pending } = setup(50);
    scheduler.update(A, true);
    pending[0].resolve(inv(1));
    await flush();
    await vi.advanceTimersByTimeAsync(49);
    expect(pending).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(pending).toHaveLength(2);
  });

  it('collapses two reloads during a request into one follow-up, not quiet', async () => {
    const { scheduler, pending, actions } = setup();
    scheduler.update(A, true);
    scheduler.reload();
    scheduler.reload();
    expect(pending).toHaveLength(1);
    pending[0].resolve(inv(1));
    await flush();
    expect(pending).toHaveLength(2);
    expect(actions.filter(a => a.type === 'loading')).toEqual([{ type: 'loading' }, { type: 'loading' }]);
  });

  it('drops the answer after a runtime change and restarts at once', async () => {
    const { scheduler, pending, actions } = setup();
    scheduler.update(A, true);
    scheduler.update({ hostId: 'h', runtime: 'podman' }, true);
    expect(pending).toHaveLength(1);
    pending[0].resolve(inv(1));
    await flush();
    expect(actions.some(a => a.type === 'setInventory')).toBe(false);
    expect(pending).toHaveLength(2);
    expect(pending[1].input).toEqual({ hostId: 'h', runtime: 'podman' });
  });

  it('does nothing when invisible first, polls not after hiding, loads when visible again', async () => {
    const { scheduler, pending } = setup();
    scheduler.update(A, false);
    expect(pending).toHaveLength(0);
    scheduler.update(A, true);
    pending[0].resolve(inv(1));
    await flush();
    scheduler.update(A, false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(pending).toHaveLength(1);
    scheduler.update(A, true);
    expect(pending).toHaveLength(2);
  });

  it('neither repeats nor polls when hidden during a request; later visible update loads', async () => {
    const { scheduler, pending } = setup();
    scheduler.update(A, true);
    scheduler.update(A, false);
    pending[0].resolve(inv(1));
    await flush();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(pending).toHaveLength(1);
    scheduler.update(A, true);
    expect(pending).toHaveLength(2);
  });

  it('does not repeat on hidden runtime change until visible', async () => {
    const { scheduler, pending } = setup();
    scheduler.update(A, true);
    scheduler.update({ hostId: 'h', runtime: 'podman' }, false);
    pending[0].resolve(inv(1));
    await flush();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(pending).toHaveLength(1);
    scheduler.update({ hostId: 'h', runtime: 'podman' }, true);
    expect(pending).toHaveLength(2);
  });

  it('reload while invisible loads once without a timer', async () => {
    const { scheduler, pending } = setup();
    scheduler.update(A, false);
    scheduler.reload();
    expect(pending).toHaveLength(1);
    pending[0].resolve(inv(1));
    await flush();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(pending).toHaveLength(1);
  });

  it('survives the StrictMode sequence with a single request', async () => {
    const { scheduler, pending, actions } = setup();
    scheduler.update(A, true);
    scheduler.stop();
    scheduler.start();
    scheduler.update(A, true);
    expect(pending).toHaveLength(1);
    pending[0].resolve(inv(1));
    await flush();
    expect(actions.some(a => a.type === 'setInventory')).toBe(true);
  });

  it('drops the answer after stop and loads again after start and update', async () => {
    const { scheduler, pending, actions } = setup();
    scheduler.update(A, true);
    scheduler.stop();
    pending[0].resolve(inv(1));
    await flush();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(actions.some(a => a.type === 'setInventory')).toBe(false);
    expect(pending).toHaveLength(1);
    scheduler.start();
    scheduler.update(A, true);
    expect(pending).toHaveLength(2);
  });

  it('issues one request for a second update with the same key during a request', () => {
    const { scheduler, pending } = setup();
    scheduler.update(A, true);
    scheduler.update({ ...A }, true);
    expect(pending).toHaveLength(1);
  });

  it('maps rejections to messages', async () => {
    const { scheduler, pending, actions } = setup();
    scheduler.update(A, true);
    pending[0].reject(new Error("Error invoking remote method 'x': Error: Boom"));
    await flush();
    expect(actions[1]).toEqual({ type: 'fail', message: 'Boom' });
    scheduler.reload();
    pending[1].reject('nope');
    await flush();
    expect(actions.at(-1)).toEqual({ type: 'fail', message: 'Die Container konnten nicht geladen werden.' });
  });
});
