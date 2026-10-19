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

export type InventoryKind = 'containers' | 'images' | 'volumes' | 'networks';
export const INVENTORY_KINDS: readonly InventoryKind[] = ['containers', 'images', 'volumes', 'networks'];
/** ref: container name (or ID when the name is not a valid ref), image repo:tag or ID without "sha256:", volume name, network name or ID. */
export interface InventoryRef { kind: InventoryKind; runtime: ContainerRuntime; ref: string }
export type InventoryState = 'running' | 'exited' | 'paused' | 'restarting' | 'created' | 'dead' | 'stopped' | 'unknown';
export type RowTone = 'ok' | 'warn' | 'bad' | 'muted';
/** Raw links of a container row; only for linkUsage in main and the networks column. */
export interface ContainerLinks { image: string; imageId: string; mounts: string[]; networks: string[] }
export interface InventoryRow {
  /** `${runtime}:${kind}:${key}`; unique within one inventory and stable across polls. */
  uid: string;
  ref: InventoryRef;
  /** Full ID without "sha256:" (volumes: the name). */
  id: string;
  /** Display name: container name, repo:tag or 12-char ID, volume or network name. */
  name: string;
  /** Column key -> raw value; '' = unknown. */
  cells: Record<string, string | number>;
  tone: RowTone;
  labels: Record<string, string>;
  state?: InventoryState;
  exitCode?: number;
  project?: string;
  pod?: string;
  /** Containers using it; undefined = unknown (never 0 for unknown). */
  usedBy?: number;
  links?: ContainerLinks;
}
export interface ContainerInventory {
  runtime: ContainerRuntime;
  runtimes: ContainerRuntime[];
  rows: Record<InventoryKind, InventoryRow[]>;
  /** German message per failed list. */
  problems: Partial<Record<InventoryKind, string>>;
  /** Epoch ms. */
  at: number;
  /** SSH user name; absent for this computer. */
  user?: string;
  /** connection.containers?.sudo === true; false for this computer. */
  sudo: boolean;
}
export type InventoryAction = 'start' | 'stop' | 'restart' | 'remove';
export const INVENTORY_ACTIONS: Record<InventoryKind, readonly InventoryAction[]> = {
  containers: ['start', 'stop', 'restart', 'remove'], images: ['remove'], volumes: ['remove'], networks: [],
};
export type ContainerDockMode = 'logs' | 'shell' | 'inspect';
export const IMAGE_ID = /^(sha256:)?[a-f0-9]{12,64}$/;
export const IMAGE_NAME_TAG = /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:(?::[0-9]{1,5})?\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
export const MAX_REF_LENGTH = 255;

/** images: IMAGE_ID or IMAGE_NAME_TAG; other kinds: CONTAINER_REF. Always false above MAX_REF_LENGTH or for an unknown runtime/kind. */
export function inventoryRefValid(ref: InventoryRef): boolean {
  if (ref.runtime !== 'docker' && ref.runtime !== 'podman') return false;
  if (!(INVENTORY_KINDS as readonly string[]).includes(ref.kind)) return false;
  if (typeof ref.ref !== 'string' || ref.ref.length < 1 || ref.ref.length > MAX_REF_LENGTH) return false;
  return ref.kind === 'images' ? IMAGE_ID.test(ref.ref) || IMAGE_NAME_TAG.test(ref.ref) : CONTAINER_REF.test(ref.ref);
}

/** True for InventoryRef, false for ContainerTarget (kind 'container' | 'lxc' | 'vm'). */
export function isInventoryRef(target: ContainerTarget | InventoryRef): target is InventoryRef {
  return (INVENTORY_KINDS as readonly string[]).includes(target.kind);
}

/** Row tone of a container from its state, raw status text and exit code. */
export function containerTone(state: InventoryState, status: string, exitCode?: number): RowTone {
  const text = status.toLowerCase();
  switch (state) {
    case 'running':
      if (text.includes('(unhealthy)')) return 'bad';
      if (text.includes('(health: starting)') || text.includes('(starting)')) return 'warn';
      return 'ok';
    case 'restarting': return 'warn';
    case 'paused':
    case 'created': return 'muted';
    case 'exited':
    case 'stopped': return exitCode === undefined || exitCode === 0 ? 'muted' : 'bad';
    case 'dead': return 'bad';
    case 'unknown': return 'warn';
  }
}

export const CONTAINER_VIEW_SUFFIX = ' · Container';
export const LOCAL_HOST_NAME = 'Dieser Computer';
/** Host part of a container view tab name: `name` without a trailing CONTAINER_VIEW_SUFFIX. */
export function containerViewHostName(name: string): string {
  return name.endsWith(CONTAINER_VIEW_SUFFIX) ? name.slice(0, -CONTAINER_VIEW_SUFFIX.length) : name;
}
