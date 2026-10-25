import { useSyncExternalStore } from 'react';
import type { UpdateStatus } from '../../shared/ipc';

// Last update status from main; the badge and the settings switch write here so they agree.
let current: UpdateStatus | null = null;
const listeners = new Set<() => void>();
const emit = (): void => { for (const listener of listeners) listener(); };

export const updateStore = {
  get: (): UpdateStatus | null => current,
  set(status: UpdateStatus): void {
    current = status;
    emit();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
};

export function useUpdateStatus(): UpdateStatus | null {
  return useSyncExternalStore(updateStore.subscribe, updateStore.get);
}
