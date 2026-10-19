import type { InventoryKind, InventoryRow } from '../../shared/containers';

export type ChipGroup = 'attention' | 'status' | 'trait';
export interface ChipDef {
  /** Lowercase English, stable. */
  id: string;
  /** German UI text. */
  label: string;
  /** OR within a group, AND between groups. */
  group: ChipGroup;
  matches: (row: InventoryRow) => boolean;
}

const chip = (id: string, label: string, group: ChipGroup, matches: ChipDef['matches']): ChipDef => ({ id, label, group, matches });
const unused = chip('unused', 'Unbenutzt', 'trait', row => row.usedBy === 0);

/** Order in each array = order in the chip bar and the canonical order of stored ids. */
export const CHIPS: Record<InventoryKind, readonly ChipDef[]> = {
  containers: [
    chip('attention', 'Auffällig', 'attention', row => row.tone === 'warn' || row.tone === 'bad'),
    chip('running', 'Läuft', 'status', row => row.state === 'running'),
    chip('stopped', 'Gestoppt', 'status', row => row.state === 'exited' || row.state === 'stopped' || row.state === 'created' || row.state === 'dead'),
    chip('paused', 'Pausiert', 'status', row => row.state === 'paused'),
    chip('compose', 'Compose', 'trait', row => Boolean(row.project)),
  ],
  images: [chip('dangling', 'Ohne Tag', 'trait', row => row.cells.tag === ''), unused],
  volumes: [unused],
  networks: [],
};

/** Known ids of CHIPS[kind] only, deduplicated, in CHIPS order. */
export function knownChips(kind: InventoryKind, ids: readonly string[]): string[] {
  const wanted = new Set(ids);
  return CHIPS[kind].filter(def => wanted.has(def.id)).map(def => def.id);
}

/** OR within a group, AND between groups; no ids = all. Unknown ids are ignored. */
export function compileChips(kind: InventoryKind, ids: readonly string[]): (row: InventoryRow) => boolean {
  const known = new Set(knownChips(kind, ids));
  const active = CHIPS[kind].filter(def => known.has(def.id));
  if (active.length === 0) return () => true;
  const groups = new Map<ChipGroup, ChipDef[]>();
  for (const def of active) groups.set(def.group, [...(groups.get(def.group) ?? []), def]);
  const lists = [...groups.values()];
  return row => lists.every(list => list.some(def => def.matches(row)));
}

/** Per chip id of CHIPS[kind]: how many of `rows` it matches. Every id is present, 0 included. */
export function chipCounts(kind: InventoryKind, rows: readonly InventoryRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const def of CHIPS[kind]) counts[def.id] = rows.reduce((sum, row) => sum + (def.matches(row) ? 1 : 0), 0);
  return counts;
}

export function attentionChip(kind: InventoryKind): 'attention' | null {
  return CHIPS[kind].some(def => def.id === 'attention') ? 'attention' : null;
}

/** containers: first matching 'status' chip; other kinds: undefined. */
export function primaryChip(kind: InventoryKind, row: InventoryRow): ChipDef | undefined {
  return kind === 'containers' ? CHIPS.containers.find(def => def.group === 'status' && def.matches(row)) : undefined;
}
