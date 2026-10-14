import { CONTAINER_REF, MAX_VMID, MIN_VMID } from '../../shared/containers';
import type { ContainerAction, ContainerTarget, RuntimeKind, TerminalTarget } from '../../shared/containers';
import type { SshConnectionNode } from '../../shared/vault/types';

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
 * prompt: `sudo -v` asks with `marker` (from stdin with -S, else from the tty), then `ready` is
 * printed and the command runs as `sudo -n` with the cached credentials.
 */
export type SudoMode = { kind: 'none' } | { kind: 'noninteractive' } | { kind: 'prompt'; marker: string; ready: string; stdin: boolean };

/** No `%` (sudo expands prompt escapes) and nothing a terminal could reinterpret. */
const SUDO_MARKER = /^[A-Za-z0-9_[\]-]{8,64}$/;

export function remoteCommand(argv: string[], sudo: SudoMode): string {
  if (sudo.kind === 'none') return `${PATH_PREFIX} ${shellJoin(argv)}`;
  if (sudo.kind === 'noninteractive') return `${PATH_PREFIX} ${shellJoin(['sudo', '-n', ...argv])}`;
  if (!SUDO_MARKER.test(sudo.marker) || !SUDO_MARKER.test(sudo.ready)) throw new Error('Invalid sudo marker');
  const validate = shellJoin(['sudo', ...(sudo.stdin ? ['-S'] : []), '-p', sudo.marker, '-v']);
  // The command itself runs as `sudo -n <argv>` so sudoers rules limited to a program still match.
  // No exec and a trailing exit: sh stays the parent, so sudo's per-parent credential cache matches without a tty.
  const script = `${PATH_PREFIX}; ${validate} && printf %s ${shellJoin([sudo.ready])} && ${shellJoin(['sudo', '-n', ...argv])}; exit $?`;
  return shellJoin(['sh', '-c', script]);
}

/** How container commands of this connection use sudo; prompt only with a stored password. */
export function sudoSetting(connection: SshConnectionNode): { kind: 'none' } | { kind: 'noninteractive' } | { kind: 'prompt'; password: string } {
  if (connection.containers?.sudo !== true) return { kind: 'none' };
  const auth = connection.authentication;
  if (auth.method !== 'password' || !auth.password) return { kind: 'noninteractive' };
  if (/[\r\n]/.test(auth.password)) throw new ContainerInputError('Das Passwort enthält einen Zeilenumbruch und kann nicht für sudo verwendet werden.');
  return { kind: 'prompt', password: auth.password };
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
