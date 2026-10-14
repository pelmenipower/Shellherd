import { CONTAINER_REF } from '../../shared/containers';
import type { ContainerRuntime, DiscoveredItem, ItemState, RuntimeKind } from '../../shared/containers';

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

function containerRecords(text: string): Record<string, unknown>[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try { const parsed: unknown = JSON.parse(trimmed); return Array.isArray(parsed) ? parsed.filter(entry => entry && typeof entry === 'object') : []; }
    catch { return []; }
  }
  return trimmed.split(/\r?\n/).flatMap(line => {
    try { const parsed: unknown = JSON.parse(line); return parsed && typeof parsed === 'object' ? [parsed as Record<string, unknown>] : []; }
    catch { return []; }
  });
}

/** Docker prints one JSON object per line, Podman a JSON array. */
export function parseContainerList(runtime: ContainerRuntime, text: string): DiscoveredItem[] {
  return containerRecords(text).flatMap(record => {
    const id = String(record.ID ?? record.Id ?? '');
    const names = Array.isArray(record.Names) ? record.Names.map(String) : String(record.Names ?? '').split(',');
    const name = names[0]?.trim() || id.slice(0, 12);
    const ref = CONTAINER_REF.test(name) ? name : id;
    if (!CONTAINER_REF.test(ref)) return [];
    return [{ kind: 'container' as const, runtime, id, ref, name, image: String(record.Image ?? ''), state: state(String(record.State ?? '').toLowerCase()) }];
  });
}

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

const SUDO_PASSWORD = 'sudo verlangt ein Passwort, für diese Verbindung ist keins hinterlegt. Richte NOPASSWD ein oder melde dich per Passwort an.';
export const SUDO_REJECTED = 'Das sudo-Passwort wurde abgelehnt.';
/** `sudo -v` succeeded, yet the following `sudo -n` still wanted a password. */
export const SUDO_NOT_CACHED = 'sudo speichert die Anmeldung nicht zwischen (timestamp_timeout=0). Richte NOPASSWD ein.';

export function describeFailure(kind: RuntimeKind, result: RunResult): string {
  if (result.sudoRejected) return SUDO_REJECTED;
  if (result.sudoNoPrompt) return 'sudo hat nicht wie erwartet nach dem Passwort gefragt.';
  if (result.timedOut) return 'Der Host hat nicht rechtzeitig geantwortet.';
  const text = `${result.stderr}\n${result.stdout}`;
  if (result.sudoReady && /sudo: a password is required/i.test(text)) return SUDO_NOT_CACHED;
  if (/sudo: (a password is required|a terminal is required)/i.test(text)) return SUDO_PASSWORD;
  if (kind !== 'proxmox' && /permission denied[^\n]*\.sock/i.test(text)) {
    return kind === 'docker' ? 'Keine Berechtigung für Docker. Benutzer zur Gruppe docker hinzufügen oder sudo aktivieren.'
      : 'Keine Berechtigung für Podman. sudo aktivieren oder Podman rootless einrichten.';
  }
  if (kind === 'docker' && /Cannot connect to the Docker daemon/i.test(text)) return 'Der Docker-Dienst läuft nicht.';
  if (kind === 'proxmox' && (result.code === 127 || /permission denied|only root|must be root|need to be root|not root/i.test(text))) return 'Proxmox-Befehle brauchen root. sudo aktivieren oder als root verbinden.';
  const last = result.stderr.split(/\r?\n/).map(line => line.trim()).filter(Boolean).pop();
  return last ? last.slice(0, 200) : `Befehl fehlgeschlagen (Exit-Code ${result.code ?? '?'}).`;
}
