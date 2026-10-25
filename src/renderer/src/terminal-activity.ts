import { useSyncExternalStore } from 'react';

// Tabs that got output while not visible; the tab strip shows the ring.
let marked: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();
const emit = (): void => { for (const listener of listeners) listener(); };

export const tabActivity = {
  /** New set and notification only when the id was not marked. */
  mark(tabId: string): void {
    if (marked.has(tabId)) return;
    marked = new Set([...marked, tabId]);
    emit();
  },
  /** New set and notification only when the id was marked. */
  clear(tabId: string): void {
    if (!marked.has(tabId)) return;
    const next = new Set(marked);
    next.delete(tabId);
    marked = next;
    emit();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  snapshot: (): ReadonlySet<string> => marked,
};

export function useTabActivity(): ReadonlySet<string> { return useSyncExternalStore(tabActivity.subscribe, tabActivity.snapshot); }
