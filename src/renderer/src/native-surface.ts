import { useEffect, useSyncExternalStore } from 'react';

// Native RDP surfaces are drawn above the DOM. Any HTML overlay that could be covered registers
// itself here; while at least one is active, all native surfaces are hidden.
let blockers = 0;
const listeners = new Set<() => void>();
const notify = (): void => listeners.forEach(listener => listener());
const subscribe = (listener: () => void): (() => void) => { listeners.add(listener); return () => listeners.delete(listener); };

export function useNativeSurfaceBlock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    blockers += 1; notify();
    return () => { blockers -= 1; notify(); };
  }, [active]);
}

export function useNativeSurfacesBlocked(): boolean {
  return useSyncExternalStore(subscribe, () => blockers > 0);
}
