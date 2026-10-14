import { CONTAINER_REF, MAX_VMID, MIN_VMID } from '../../shared/containers';
import type { ContainerAction, ContainerTarget, RuntimeKind, TerminalTarget } from '../../shared/containers';

/** Invalid targets or actions; the message is safe to show. */
export class ContainerInputError extends Error {}

export const SHELL_CHOICE = 'command -v bash >/dev/null 2>&1 && exec bash || exec sh';
/** Proxmox tools live in /usr/sbin, which non-root PATHs often lack. */
const PATH_PREFIX = 'PATH="$PATH:/usr/sbin:/sbin"';
export const PROBE_SCRIPT = `${PATH_PREFIX}; for c in docker podman pct qm; do command -v "$c" >/dev/null 2>&1 && echo "has:$c"; done; true`;

const SAFE_WORD = /^[A-Za-z0-9_./:=@%+,-]+$/;
export function shellJoin(argv: string[]): string {
  return argv.map(arg => SAFE_WORD.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`).join(' ');
}
/** The probe runs in sh so fish, csh and other login shells do not break it. */
export const PROBE_COMMAND = shellJoin(['sh', '-c', PROBE_SCRIPT]);
/**
 * none: no sudo. noninteractive: `sudo -n`, fails if a password is needed.
 * prompt: sudo asks with `marker` as prompt; stdin reads it from stdin (-S), otherwise from the tty.
 */
export type SudoMode = { kind: 'none' } | { kind: 'noninteractive' } | { kind: 'prompt'; marker: string; stdin: boolean };

/** No `%` (sudo expands prompt escapes) and nothing a terminal could reinterpret. */
const SUDO_MARKER = /^[A-Za-z0-9_[\]-]{8,64}$/;

function sudoArgv(sudo: SudoMode): string[] {
  if (sudo.kind === 'none') return [];
  if (sudo.kind === 'noninteractive') return ['sudo', '-n'];
  if (!SUDO_MARKER.test(sudo.marker)) throw new Error('Invalid sudo marker');
  return sudo.stdin ? ['sudo', '-S', '-p', sudo.marker] : ['sudo', '-p', sudo.marker];
}

export function remoteCommand(argv: string[], sudo: SudoMode): string {
  return `${PATH_PREFIX} ${shellJoin([...sudoArgv(sudo), ...argv])}`;
}

function ref(value: string): string {
  if (!CONTAINER_REF.test(value)) throw new ContainerInputError('Ungültige Container-Angabe.');
  return value;
}
function vmid(value: number): string {
  if (!Number.isInteger(value) || value < MIN_VMID || value > MAX_VMID) throw new ContainerInputError('Ungültige VM-ID.');
  return String(value);
}

export function listArgv(kind: Exclude<RuntimeKind, 'proxmox'> | 'lxc' | 'vm'): string[] {
  switch (kind) {
    case 'docker': return ['docker', 'ps', '-a', '--no-trunc', '--format', '{{json .}}'];
    case 'podman': return ['podman', 'ps', '-a', '--format', 'json'];
    case 'lxc': return ['pct', 'list'];
    case 'vm': return ['qm', 'list'];
  }
}

export function terminalArgv({ item, mode }: TerminalTarget): string[] {
  if (item.kind === 'container') {
    return mode === 'logs' ? [item.runtime, 'logs', '-f', '--tail', '500', ref(item.ref)]
      : [item.runtime, 'exec', '-it', ref(item.ref), 'sh', '-c', SHELL_CHOICE];
  }
  if (mode === 'logs') throw new ContainerInputError('Logs gibt es nur für Docker- und Podman-Container.');
  return item.kind === 'lxc' ? ['pct', 'enter', vmid(item.vmid)] : ['qm', 'terminal', vmid(item.vmid)];
}

const ACTIONS: Record<ContainerTarget['kind'], ContainerAction[]> = {
  container: ['start', 'stop', 'restart'], lxc: ['start', 'shutdown', 'stop'], vm: ['start', 'shutdown', 'stop'],
};

export function actionArgv(target: ContainerTarget, action: ContainerAction): string[] {
  if (!ACTIONS[target.kind].includes(action)) throw new ContainerInputError('Diese Aktion ist hier nicht möglich.');
  if (target.kind === 'container') return [target.runtime, action, ref(target.ref)];
  return [target.kind === 'lxc' ? 'pct' : 'qm', action, vmid(target.vmid)];
}
