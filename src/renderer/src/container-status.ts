import type { InventoryKind, InventoryRow } from '../../shared/containers';
import { t } from './i18n';

export type ChipGroup = 'attention' | 'status' | 'trait';
export interface ChipDef {
  /** Lowercase English, stable. */
  id: string;
  /** UI text in the current language; a getter, read when it is used. */
  label: string;
  /** OR within a group, AND between groups. */
  group: ChipGroup;
  matches: (row: InventoryRow) => boolean;
}

const CHIP_LABEL_KEYS = {
  attention: 'containers:chips.attention', running: 'containers:chips.running', stopped: 'containers:chips.stopped',
  paused: 'containers:chips.paused', compose: 'containers:chips.compose', dangling: 'containers:chips.dangling',
  unused: 'containers:chips.unused',
} as const;
type ChipId = keyof typeof CHIP_LABEL_KEYS;

const chip = (id: ChipId, group: ChipGroup, matches: ChipDef['matches']): ChipDef => ({
  id, get label() { return t(CHIP_LABEL_KEYS[id]); }, group, matches,
});
const unused = chip('unused', 'trait', row => row.usedBy === 0);

/** Order in each array = order in the chip bar and the canonical order of stored ids. */
export const CHIPS: Record<InventoryKind, readonly ChipDef[]> = {
  containers: [
    chip('attention', 'attention', row => row.tone === 'warn' || row.tone === 'bad'),
    chip('running', 'status', row => row.state === 'running'),
    chip('stopped', 'status', row => row.state === 'exited' || row.state === 'stopped' || row.state === 'created' || row.state === 'dead'),
    chip('paused', 'status', row => row.state === 'paused'),
    chip('compose', 'trait', row => Boolean(row.project)),
  ],
  images: [chip('dangling', 'trait', row => row.cells.tag === ''), unused],
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
