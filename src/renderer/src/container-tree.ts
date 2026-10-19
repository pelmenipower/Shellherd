import type { ContainerAction, DiscoveredItem, DiscoveryResult, TerminalTargetMode } from '../../shared/containers';

/** What VaultTree and LocalContainers need from the app. */
export interface ContainerTreeProps {
  state: ContainerTreeState;
  onExpand: (hostId: string) => void;
  onOpen: (hostId: string, item: DiscoveredItem, mode: TerminalTargetMode) => void;
  onAction: (hostId: string, item: DiscoveredItem, action: ContainerAction, confirm?: string) => void;
}

export type HostDiscovery =
  | { status: 'loading' }
  | { status: 'ready'; result: DiscoveryResult; busy: string[]; notice?: { key: string; message: string }; refreshing?: boolean }
  | { status: 'error'; message: string };
export type ContainerTreeState = Record<string, HostDiscovery>;
export type ContainerTreeAction =
  | { type: 'loading'; hostId: string }
  | { type: 'loaded'; hostId: string; result: DiscoveryResult }
  | { type: 'failed'; hostId: string; message: string }
  | { type: 'busy'; hostId: string; key: string; busy: boolean }
  | { type: 'notice'; hostId: string; key: string; message: string };

export function containerTreeReducer(state: ContainerTreeState, action: ContainerTreeAction): ContainerTreeState {
  switch (action.type) {
    case 'loading': {
      const host = state[action.hostId];
      if (host?.status !== 'ready') return { ...state, [action.hostId]: { status: 'loading' } };
      return { ...state, [action.hostId]: { ...host, refreshing: true } };
    }
    case 'loaded': {
      const host = state[action.hostId];
      const previous = host?.status === 'ready' ? host : undefined;
      return { ...state, [action.hostId]: { status: 'ready', result: action.result, busy: previous?.busy ?? [], ...(previous?.notice ? { notice: previous.notice } : {}) } };
    }
    case 'failed': return { ...state, [action.hostId]: { status: 'error', message: action.message } };
    case 'busy': case 'notice': {
      const host = state[action.hostId];
      if (host?.status !== 'ready') return state;
      if (action.type === 'notice') return { ...state, [action.hostId]: { ...host, notice: { key: action.key, message: action.message } } };
      const busy = host.busy.filter(key => key !== action.key);
      return { ...state, [action.hostId]: { ...host, busy: action.busy ? [...busy, action.key] : busy, ...(action.busy ? { notice: undefined } : {}) } };
    }
  }
}

export interface ItemGroup { key: string; label: string; items: DiscoveredItem[]; problem?: string }

export function groupItems(result: DiscoveryResult): ItemGroup[] {
  const groups: ItemGroup[] = [];
  for (const runtime of ['docker', 'podman'] as const) {
    if (!result.runtimes.includes(runtime)) continue;
    groups.push({ key: runtime, label: runtime === 'docker' ? 'Docker' : 'Podman',
      items: result.items.filter(item => item.kind === 'container' && item.runtime === runtime), problem: result.problems[runtime] });
  }
  if (result.runtimes.includes('proxmox')) {
    const lxc = result.items.filter(item => item.kind === 'lxc'), vms = result.items.filter(item => item.kind === 'vm');
    const problem = result.problems.proxmox;
    // The problem is shown once, on the first Proxmox group.
    if (lxc.length || problem) groups.push({ key: 'lxc', label: 'Proxmox LXC', items: lxc, problem });
    if (vms.length) groups.push({ key: 'vm', label: 'Proxmox VMs', items: vms });
  }
  return groups;
}

export type ItemCommand = { label: string; run: 'shell' | 'logs' | ContainerAction; confirm?: string };

export function itemCommands(item: DiscoveredItem): ItemCommand[] {
  const running = item.state === 'running';
  if (item.kind === 'container') {
    if (running) return [{ label: 'Shell öffnen', run: 'shell' }, { label: 'Logs folgen', run: 'logs' }, { label: 'Neu starten', run: 'restart' }, { label: 'Stoppen', run: 'stop' }];
    if (item.state === 'paused') return [{ label: 'Logs folgen', run: 'logs' }, { label: 'Stoppen', run: 'stop' }];
    return [{ label: 'Starten', run: 'start' }, { label: 'Logs folgen', run: 'logs' }];
  }
  if (!running) return [{ label: 'Starten', run: 'start' }];
  return [
    { label: item.kind === 'lxc' ? 'Shell öffnen' : 'Serielle Konsole', run: 'shell' },
    { label: 'Herunterfahren', run: 'shutdown' },
    { label: 'Stoppen', run: 'stop', ...(item.kind === 'vm' ? { confirm: `VM „${item.name}“ hart ausschalten? Nicht gespeicherte Daten in der VM gehen verloren.` } : {}) },
  ];
}

export function hasUsableLocalRuntime(result: DiscoveryResult): boolean {
  return result.runtimes.some(runtime => !result.problems[runtime]);
}

export function ipcMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : fallback;
}
