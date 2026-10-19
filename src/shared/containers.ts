export type ContainerRuntime = 'docker' | 'podman';
export type RuntimeKind = ContainerRuntime | 'proxmox';
/** An SSH connection id from the vault, or LOCAL_CONTAINER_HOST for this computer. */
export type ContainerHostId = string;
export const LOCAL_CONTAINER_HOST = 'local-containers';
/** Docker and Podman enforce this for names; IDs match it too. */
export const CONTAINER_REF = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
export const MIN_VMID = 100;
export const MAX_VMID = 999_999_999;

export type ItemState = 'running' | 'paused' | 'stopped';
export type DiscoveredItem =
  | { kind: 'container'; runtime: ContainerRuntime; id: string; ref: string; name: string; image: string; state: ItemState }
  | { kind: 'lxc' | 'vm'; vmid: number; name: string; state: ItemState };

export interface DiscoveryResult {
  runtimes: RuntimeKind[];
  items: DiscoveredItem[];
  /** Per runtime: a short German message when listing failed (e.g. no permission). */
  problems: Partial<Record<RuntimeKind, string>>;
}

/** `ref` is the container name when it is a valid reference, otherwise the ID; commands use it. */
export type ContainerTarget =
  | { kind: 'container'; runtime: ContainerRuntime; ref: string; name: string }
  | { kind: 'lxc' | 'vm'; vmid: number; name: string };
export type TerminalTargetMode = 'shell' | 'logs';
export interface TerminalTarget { item: ContainerTarget; mode: TerminalTargetMode }
export type ContainerAction = 'start' | 'stop' | 'restart' | 'shutdown';

export function toTarget(item: DiscoveredItem): ContainerTarget {
  return item.kind === 'container'
    ? { kind: 'container', runtime: item.runtime, ref: item.ref, name: item.name }
    : { kind: item.kind, vmid: item.vmid, name: item.name };
}

/** Identity of a container or guest on one host. */
export function itemKey(item: DiscoveredItem | ContainerTarget): string {
  return item.kind === 'container' ? `container:${item.runtime}:${item.ref}` : `${item.kind}:${item.vmid}`;
}

export function targetKey(target: TerminalTarget): string { return `${itemKey(target.item)}:${target.mode}`; }
