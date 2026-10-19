import { encodeError, type CodedError, type ErrorCode } from '../../shared/errors';
import type { DiscoveredItem, ItemState, RuntimeKind } from '../../shared/containers';

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  /** Local only: the program is not installed. */
  notFound?: boolean;
  /** sudo asked again after the stored password was sent. */
  sudoRejected?: boolean;
  /** Timed out in prompt mode before sudo asked or reported readiness. */
  sudoNoPrompt?: boolean;
  /** Prompt mode: sudo authenticated and the ready marker was seen. */
  sudoReady?: boolean;
  /** Not run: another sudo authentication for this connection did not finish in time. */
  sudoBusy?: boolean;
}

type ProbeTool = 'docker' | 'podman' | 'pct' | 'qm';
export function parseProbe(text: string): Set<ProbeTool> {
  const found = new Set<ProbeTool>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^has:(docker|podman|pct|qm)$/.exec(line.trim());
    if (match) found.add(match[1] as ProbeTool);
  }
  return found;
}

const state = (value: unknown): ItemState => value === 'running' ? 'running' : value === 'paused' ? 'paused' : 'stopped';

function guestRows(text: string): string[][] {
  return text.split(/\r?\n/).map(line => line.trim().split(/\s+/)).filter(parts => /^\d+$/.test(parts[0] ?? ''));
}

/** Columns: VMID Status [Lock] Name. */
export function parsePctList(text: string): DiscoveredItem[] {
  return guestRows(text).filter(parts => parts.length >= 3)
    .map(parts => ({ kind: 'lxc' as const, vmid: Number(parts[0]), name: parts[parts.length - 1], state: state(parts[1]) }));
}

/** Columns: VMID NAME STATUS MEM BOOTDISK PID; read from the right because unnamed VMs show as "VM <vmid>". */
export function parseQmList(text: string): DiscoveredItem[] {
  return guestRows(text).filter(parts => parts.length >= 6)
    .map(parts => ({ kind: 'vm' as const, vmid: Number(parts[0]), name: parts.slice(1, parts.length - 4).join(' '), state: state(parts[parts.length - 4]) }));
}

/** Stored in RunResult.stderr when output exceeded its limit; describeFailure turns it into a code. */
export const BATCH_TOO_LARGE = encodeError('containers.outputTooLarge');

export const SUDO_REJECTED = 'containers.sudoRejected' as const satisfies ErrorCode;
/** `sudo -v` succeeded, yet the following `sudo -n` still wanted a password. */
export const SUDO_NOT_CACHED = 'containers.sudoNotCached' as const satisfies ErrorCode;

export function describeFailure(kind: RuntimeKind, result: RunResult): CodedError {
  if (result.sudoRejected) return { code: SUDO_REJECTED };
  if (result.sudoBusy) return { code: 'containers.sudoBusy' };
  if (result.sudoNoPrompt) return { code: 'containers.sudoNoPrompt' };
  if (result.timedOut) return { code: 'containers.hostTimeout' };
  const text = `${result.stderr}\n${result.stdout}`;
  if (result.sudoReady && /sudo: a password is required/i.test(text)) return { code: SUDO_NOT_CACHED };
  if (/sudo: (a password is required|a terminal is required)/i.test(text)) return { code: 'containers.sudoPasswordMissing' };
  if (kind !== 'proxmox' && /permission denied[^\n]*\.sock/i.test(text)) {
    return { code: kind === 'docker' ? 'containers.noPermissionDocker' : 'containers.noPermissionPodman' };
  }
  if (kind === 'docker' && /Cannot connect to the Docker daemon/i.test(text)) return { code: 'containers.dockerNotRunning' };
  if (kind === 'proxmox' && (result.code === 127 || /permission denied|only root|must be root|need to be root|not root/i.test(text))) return { code: 'containers.proxmoxNeedsRoot' };
  return lastLine(result.stderr) ?? { code: 'containers.commandFailed', params: { code: result.code ?? '?' } };
}

/** The last stderr line as a remote-output problem (at most 200 characters); the batch limit sentinel becomes its code. */
export function lastLine(stderr: string): CodedError | undefined {
  const last = stderr.split(/\r?\n/).map(line => line.trim()).filter(Boolean).pop();
  if (!last) return undefined;
  if (last === BATCH_TOO_LARGE) return { code: 'containers.outputTooLarge' };
  return { code: 'containers.remoteOutput', params: { line: last.slice(0, 200) } };
}
