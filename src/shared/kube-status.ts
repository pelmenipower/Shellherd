import type { KubeKind, KubeRow, RowTone } from './kubernetes';

export type ChipGroup = 'attention' | 'status' | 'type' | 'trait' | 'time';
export interface ChipDef {
  /** Lowercase English, stable; also the :status value. */
  id: string;
  /** German UI text. */
  label: string;
  /** OR within a group, AND between groups. */
  group: ChipGroup;
  matches: (row: KubeRow, now: number) => boolean;
}

/** Pod status partition (one source for main and renderer). */
export const WARN_STATES: ReadonlySet<string> = new Set(['Pending', 'ContainerCreating', 'PodInitializing']);
export const MUTED_STATES: ReadonlySet<string> = new Set(['Completed', 'Terminating']);

/** muted for MUTED_STATES, warn for WARN_STATES, 'Running' -> notReady ? warn : ok, every other status -> bad. */
export function podTone(status: string, notReady: boolean): RowTone {
  if (MUTED_STATES.has(status)) return 'muted';
  if (WARN_STATES.has(status)) return 'warn';
  if (status === 'Running') return notReady ? 'warn' : 'ok';
  return 'bad';
}

export type JobStatus = 'Failed' | 'Complete' | 'Suspended' | 'Running' | 'Pending';
/** Failed -> bad, Complete -> ok, Suspended -> muted, Running/Pending -> warn. */
export function jobTone(status: JobStatus): RowTone {
  switch (status) {
    case 'Failed': return 'bad';
    case 'Complete': return 'ok';
    case 'Suspended': return 'muted';
    default: return 'warn';
  }
}

const status = (row: KubeRow): string => String(row.cells.status ?? '');
const attention: ChipDef = { id: 'attention', label: 'Auffällig', group: 'attention', matches: row => row.tone === 'warn' || row.tone === 'bad' };
const chip = (id: string, label: string, group: ChipGroup, matches: ChipDef['matches']): ChipDef => ({ id, label, group, matches });

function notReady(row: KubeRow): boolean {
  const state = status(row);
  if (state === 'Completed' || state === 'Terminating') return false;
  const match = /^(\d+)\/(\d+)$/.exec(String(row.cells.ready ?? ''));
  return match !== null && Number(match[1]) < Number(match[2]);
}

const workloadChips = (): ChipDef[] => [attention,
  chip('complete', 'Vollständig', 'status', row => row.tone === 'ok'),
  chip('incomplete', 'Nicht vollständig', 'status', row => row.tone === 'warn'),
  chip('zero', 'Auf 0', 'status', row => row.tone === 'muted')];

const recent = (minutes: number): ChipDef['matches'] => (row, now) => {
  const time = Date.parse(String(row.cells.last));
  return Number.isFinite(time) && now - time <= minutes * 60 * 1000;
};

/** Order in each array = order in the chip bar and the canonical order of stored ids. */
export const CHIPS: Record<KubeKind, ChipDef[]> = {
  pods: [attention,
    chip('running', 'Läuft', 'status', row => status(row) === 'Running'),
    chip('waiting', 'Wartet', 'status', row => WARN_STATES.has(status(row))),
    chip('failed', 'Fehler', 'status', row => row.tone === 'bad'),
    chip('completed', 'Abgeschlossen', 'status', row => status(row) === 'Completed'),
    chip('terminating', 'Beendet', 'status', row => status(row) === 'Terminating'),
    chip('notready', 'Nicht bereit', 'trait', notReady),
    chip('restarts', 'Mit Neustarts', 'trait', row => Number(row.cells.restarts) > 0)],
  deployments: workloadChips(),
  statefulsets: workloadChips(),
  daemonsets: workloadChips(),
  jobs: [attention,
    chip('running', 'Läuft', 'status', row => status(row) === 'Running' || status(row) === 'Pending'),
    chip('success', 'Erfolgreich', 'status', row => status(row) === 'Complete'),
    chip('failed', 'Fehlgeschlagen', 'status', row => status(row) === 'Failed')],
  cronjobs: [
    chip('active', 'Aktiv', 'status', row => row.suspended !== true),
    chip('suspended', 'Angehalten', 'status', row => row.suspended === true)],
  services: [
    chip('clusterip', 'ClusterIP', 'type', row => row.cells.type === 'ClusterIP'),
    chip('nodeport', 'NodePort', 'type', row => row.cells.type === 'NodePort'),
    chip('loadbalancer', 'LoadBalancer', 'type', row => row.cells.type === 'LoadBalancer'),
    chip('externalname', 'ExternalName', 'type', row => row.cells.type === 'ExternalName'),
    chip('headless', 'Headless', 'trait', row => row.cells.clusterIp === 'None'),
    chip('noselector', 'Ohne Selector', 'trait', row => Object.keys(row.selector ?? {}).length === 0)],
  ingresses: [],
  nodes: [attention,
    chip('notready', 'Nicht bereit', 'trait', row => status(row).startsWith('NotReady')),
    chip('cordoned', 'Gesperrt', 'trait', row => row.unschedulable === true),
    chip('pressure', 'Druck', 'trait', row => (row.pressure ?? []).length > 0),
    chip('controlplane', 'Control-Plane', 'trait', row => String(row.cells.roles ?? '').split(',').some(role => role === 'control-plane' || role === 'master'))],
  events: [
    chip('warning', 'Warning', 'type', row => row.cells.type === 'Warning'),
    chip('normal', 'Normal', 'type', row => row.cells.type === 'Normal'),
    chip('5m', 'Letzte 5 min', 'time', recent(5)),
    chip('15m', 'Letzte 15 min', 'time', recent(15))],
};

/** 'attention' where CHIPS[kind] has it, 'warning' for events, else null (cronjobs, services, ingresses). */
export function attentionChip(kind: KubeKind): string | null {
  if (kind === 'events') return 'warning';
  return CHIPS[kind].some(def => def.id === 'attention') ? 'attention' : null;
}

/** Chip for the row menu "Nur <label> anzeigen"; undefined = no entry. */
export function primaryChip(kind: KubeKind, row: KubeRow, now: number): ChipDef | undefined {
  const defs = CHIPS[kind];
  switch (kind) {
    case 'pods': case 'jobs': return defs.find(def => def.group === 'status' && def.matches(row, now));
    case 'services': case 'events': return defs.find(def => def.group === 'type' && def.matches(row, now));
    case 'nodes': return ['notready', 'pressure', 'cordoned'].map(id => defs.find(def => def.id === id)).find(def => def?.matches(row, now));
    default: return undefined;
  }
}

/** Known ids of CHIPS[kind] only, deduplicated, in CHIPS order. */
export function knownChips(kind: KubeKind, ids: readonly string[]): string[] {
  const wanted = new Set(ids);
  return CHIPS[kind].filter(def => wanted.has(def.id)).map(def => def.id);
}

/** Predicate for active chips: OR within a group, AND between groups; no ids = everything. Unknown ids are ignored. */
export function compileChips(kind: KubeKind, ids: readonly string[], now: number): (row: KubeRow) => boolean {
  const known = new Set(knownChips(kind, ids));
  const active = CHIPS[kind].filter(def => known.has(def.id));
  if (active.length === 0) return () => true;
  const groups = new Map<ChipGroup, ChipDef[]>();
  for (const def of active) groups.set(def.group, [...(groups.get(def.group) ?? []), def]);
  const lists = [...groups.values()];
  return row => lists.every(list => list.some(def => def.matches(row, now)));
}

/** Per chip id of CHIPS[kind]: how many of `rows` it matches (callers pass the rows the search text matches; chips are ignored). Every id is present, 0 included. */
export function chipCounts(kind: KubeKind, rows: readonly KubeRow[], now: number): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const def of CHIPS[kind]) counts[def.id] = rows.reduce((sum, row) => sum + (def.matches(row, now) ? 1 : 0), 0);
  return counts;
}
