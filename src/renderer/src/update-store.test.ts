import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdateStatus } from '../../shared/ipc';

const status = (available: UpdateStatus['available'] = null): UpdateStatus => ({ enabled: true, current: '0.21.0', available });

describe('updateStore', () => {
  // Fresh module per test, the store keeps its value at module level.
  let updateStore: typeof import('./update-store').updateStore;
  beforeEach(async () => {
    vi.resetModules();
    ({ updateStore } = await import('./update-store'));
  });

  it('starts empty', () => {
    expect(updateStore.get()).toBeNull();
  });

  it('returns the last value set', () => {
    const first = status();
    const second = status({ version: '0.22.0', url: 'https://example.invalid/v0.22.0' });
    updateStore.set(first);
    expect(updateStore.get()).toBe(first);
    updateStore.set(second);
    expect(updateStore.get()).toBe(second);
  });

  it('notifies subscribers on every set', () => {
    const listener = vi.fn();
    updateStore.subscribe(listener);
    updateStore.set(status());
    updateStore.set(status());
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('stops notifying after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = updateStore.subscribe(listener);
    updateStore.set(status());
    unsubscribe();
    updateStore.set(status());
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps other listeners when one unsubscribes', () => {
    const kept = vi.fn();
    const removed = vi.fn();
    updateStore.subscribe(kept);
    const unsubscribe = updateStore.subscribe(removed);
    unsubscribe();
    updateStore.set(status());
    expect(kept).toHaveBeenCalledTimes(1);
    expect(removed).not.toHaveBeenCalled();
  });
});
