import { errorText } from './error-text';
import { t } from './i18n';
import type { ContainerAction, ContainerRuntime, DiscoveredItem, DiscoveryResult, TerminalTargetMode } from '../../shared/containers';

/** What VaultTree and LocalContainers need from the app. */
export interface ContainerTreeProps {
  state: ContainerTreeState;
  onExpand: (hostId: string) => void;
  /** Focuses an open view of this host and runtime or opens one; `newTab` always opens another. */
  onOpenView?: (hostId: string, runtime: ContainerRuntime, newTab?: boolean) => void;
  /** Proxmox guests only: shell or serial console. */
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

/** Docker and Podman entries, filtered by what the host answered, in fixed order. */
export function runtimeEntries(result: DiscoveryResult): ContainerRuntime[] {
  return (['docker', 'podman'] as const).filter(runtime => result.runtimes.includes(runtime));
}

/** Only the Proxmox groups; Docker and Podman are entries, not groups. */
export function groupItems(result: DiscoveryResult): ItemGroup[] {
  const groups: ItemGroup[] = [];
  if (result.runtimes.includes('proxmox')) {
    const lxc = result.items.filter(item => item.kind === 'lxc'), vms = result.items.filter(item => item.kind === 'vm');
    const problem = result.problems.proxmox ? errorText(result.problems.proxmox) : undefined;
    // The problem is shown once, on the first Proxmox group.
    if (lxc.length || problem) groups.push({ key: 'lxc', label: 'Proxmox LXC', items: lxc, problem });
    if (vms.length) groups.push({ key: 'vm', label: 'Proxmox VMs', items: vms });
  }
  return groups;
}

export type ItemCommand = { label: string; run: 'shell' | 'logs' | ContainerAction; confirm?: string };

export function itemCommands(item: DiscoveredItem): ItemCommand[] {
  const running = item.state === 'running';
  if (!running) return [{ label: t('containers:menu.start'), run: 'start' }];
  return [
    { label: item.kind === 'lxc' ? t('containers:menu.shellOpen') : t('containers:tree.serialConsole'), run: 'shell' },
    { label: t('containers:tree.shutdown'), run: 'shutdown' },
    { label: t('containers:tree.stop'), run: 'stop', ...(item.kind === 'vm' ? { confirm: t('containers:tree.confirmPowerOff', { name: item.name }) } : {}) },
  ];
}

export function hasUsableLocalRuntime(result: DiscoveryResult): boolean {
  return runtimeEntries(result).length > 0;
}

export function ipcMessage(error: unknown, fallback: string): string {
  return errorText(error, fallback);
}
