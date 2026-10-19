// Pure column model of the Kubernetes table: filter kinds, cell normalisation, column filters, grouping.
// Imports only from shared/kubernetes; never from kube-view (import cycle, B12).
import { KIND_COLUMNS, KIND_INFO, type ColumnInfo, type GroupBy, type KubeKind, type KubeRow } from '../../shared/kubernetes';

export type ColumnFilterKind = 'text' | 'select' | 'number' | 'age' | 'none';

/** Value of the empty option in select filters and the key of the empty group's label. */
export const EMPTY_VALUE = '(ohne)';

/** Columns of a table: KIND_COLUMNS[kind], plus a Namespace column after 'name' for all-namespaces tables of namespaced kinds. */
export function columnsFor(kind: KubeKind, namespace: string | null): ColumnInfo[] {
  const columns = KIND_COLUMNS[kind];
  if (namespace !== null || !KIND_INFO[kind].namespaced) return columns;
  const at = columns.findIndex(column => column.key === 'name') + 1;
  return [...columns.slice(0, at), { key: 'namespace', label: 'Namespace' }, ...columns.slice(at)];
}

const SELECT_COLUMNS: Partial<Record<KubeKind, string[]>> = {
  pods: ['status', 'node'], jobs: ['status'], services: ['type'], nodes: ['status', 'roles'], events: ['type'],
};

/** usage -> 'none'; age -> 'age'; numeric -> 'number'; namespace or SELECT_COLUMNS -> 'select'; else 'text'. */
export function columnFilterKind(kind: KubeKind, column: ColumnInfo): ColumnFilterKind {
  if (column.usage) return 'none';
  if (column.age) return 'age';
  if (column.numeric) return 'number';
  if (column.key === 'namespace' || SELECT_COLUMNS[kind]?.includes(column.key)) return 'select';
  return 'text';
}

/** Column `/` focuses: 'message' for events, else 'name'. */
export function primaryFilterColumn(kind: KubeKind): string {
  return kind === 'events' ? 'message' : 'name';
}

const EMPTY_MARKERS = new Set(['', '-', '–', '—']);
const normalise = (values: Array<string | undefined>): string[] =>
  values.map(value => (value ?? '').trim()).filter(value => !EMPTY_MARKERS.has(value));

/** Normalised cell values of a row for one column; [] = empty cell. */
export function cellValues(kind: KubeKind, row: KubeRow, key: string): string[] {
  if (key === 'namespace') return normalise([row.ref.namespace]);
  if (key === 'name') return normalise([row.cells.name === undefined ? row.ref.name : String(row.cells.name)]);
  const raw = row.cells[key];
  if (raw === undefined) return [];
  if (kind === 'nodes' && key === 'roles') return normalise(String(raw).split(','));
  return normalise([String(raw)]);
}

export type NumberOp = '>' | '>=' | '<' | '<=' | '=';
/** '>3', '>= 3', '=3', '3' (= equal), '2.5'. Blank or anything else: null. */
export function parseNumberFilter(text: string): { op: NumberOp; value: number } | null {
  const match = /^(>=|<=|>|<|=)?\s*(\d+(?:\.\d+)?)$/.exec(text.trim());
  return match ? { op: (match[1] as NumberOp | undefined) ?? '=', value: Number(match[2]) } : null;
}

export type AgeOp = '<' | '<=' | '>' | '>=';
const UNIT_MS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
/** '<10m', '> 1h', '<=2d', '30s', '10M'. Without operator: '<'. Units s, m, h, d (case-insensitive). Blank or anything else: null. */
export function parseAgeFilter(text: string): { op: AgeOp; ms: number } | null {
  const match = /^(<=|>=|<|>)?\s*(\d+)\s*([smhd])$/i.exec(text.trim());
  return match ? { op: (match[1] as AgeOp | undefined) ?? '<', ms: Number(match[2]) * UNIT_MS[match[3].toLowerCase()] } : null;
}

/** False only for a non-blank number/age filter that does not parse (the field is marked red). */
export function isValidColumnFilter(kind: KubeKind, column: ColumnInfo, value: string): boolean {
  if (value.trim() === '') return true;
  const filterKind = columnFilterKind(kind, column);
  if (filterKind === 'number') return parseNumberFilter(value) !== null;
  if (filterKind === 'age') return parseAgeFilter(value) !== null;
  return true;
}

type Predicate = (row: KubeRow) => boolean;

function compileOne(kind: KubeKind, column: ColumnInfo, value: string, now: number): Predicate | null {
  const text = value.trim();
  if (text === '') return null;
  const key = column.key;
  switch (columnFilterKind(kind, column)) {
    case 'text': {
      const needle = text.toLowerCase();
      return row => cellValues(kind, row, key).some(cell => cell.toLowerCase().includes(needle));
    }
    case 'select': {
      // Select values come from the option list and are exact; the stored value is not trimmed away.
      if (value === EMPTY_VALUE) return row => cellValues(kind, row, key).length === 0;
      return row => cellValues(kind, row, key).includes(value);
    }
    case 'number': {
      const parsed = parseNumberFilter(text);
      if (!parsed) return null;
      const { op, value: limit } = parsed;
      return row => {
        const cell = cellValues(kind, row, key)[0];
        if (cell === undefined) return false;
        const number = Number(cell);
        if (Number.isNaN(number)) return false;
        return op === '>' ? number > limit : op === '>=' ? number >= limit : op === '<' ? number < limit : op === '<=' ? number <= limit : number === limit;
      };
    }
    case 'age': {
      const parsed = parseAgeFilter(text);
      if (!parsed || now <= 0) return null;
      const { op, ms } = parsed;
      return row => {
        const cell = cellValues(kind, row, key)[0];
        if (cell === undefined) return false;
        const time = Date.parse(cell);
        if (Number.isNaN(time)) return false;
        const age = Math.max(0, now - time);
        return op === '<' ? age < ms : op === '<=' ? age <= ms : op === '>' ? age > ms : age >= ms;
      };
    }
    default:
      return null;
  }
}

/** AND of all column filters whose key is in `columns` and whose kind is not 'none'. Blank, invalid and unknown keys match all. */
export function compileColumnFilters(kind: KubeKind, columns: readonly ColumnInfo[], filters: Readonly<Record<string, string>> | undefined, now: number): (row: KubeRow) => boolean {
  const predicates: Predicate[] = [];
  if (filters) {
    for (const column of columns) {
      const value = filters[column.key];
      if (value === undefined) continue;
      const predicate = compileOne(kind, column, value, now);
      if (predicate) predicates.push(predicate);
    }
  }
  return row => predicates.every(predicate => predicate(row));
}

/** Options of a select filter: unique values of `rows`, sorted with localeCompare; EMPTY_VALUE last when a row is empty;
 *  `selected` (non-blank) is always included, even if no row has it anymore. */
export function columnValues(kind: KubeKind, rows: readonly KubeRow[], key: string, selected?: string): string[] {
  const values = new Set<string>();
  let empty = false;
  for (const row of rows) {
    const cells = cellValues(kind, row, key);
    if (cells.length === 0) empty = true;
    for (const cell of cells) values.add(cell);
  }
  if (selected !== undefined && selected.trim() !== '') {
    if (selected === EMPTY_VALUE) empty = true;
    else values.add(selected);
  }
  const sorted = [...values].sort((a, b) => a.localeCompare(b));
  return empty ? [...sorted, EMPTY_VALUE] : sorted;
}

export interface FacetOption { value: string; label: string; count: number }

/** Options of a select filter with counts among the rows that pass all OTHER filters (`filters` minus this column's own,
 *  plus `otherPredicate` for chips and search text). The own selected value stays, with count 0 when nothing matches. */
export function facetValues(
  rows: readonly KubeRow[], kind: KubeKind, column: ColumnInfo, filters: Readonly<Record<string, string>> | undefined, now: number,
  otherPredicate: (row: KubeRow) => boolean,
): FacetOption[] {
  const others: Record<string, string> = {};
  for (const [key, value] of Object.entries(filters ?? {})) if (key !== column.key) others[key] = value;
  const columnFilters = compileColumnFilters(kind, columnsFor(kind, null), others, now);
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!otherPredicate(row) || !columnFilters(row)) continue;
    const cells = cellValues(kind, row, column.key);
    for (const cell of cells.length === 0 ? [EMPTY_VALUE] : [...new Set(cells)]) counts.set(cell, (counts.get(cell) ?? 0) + 1);
  }
  const selected = filters?.[column.key];
  if (selected !== undefined && selected.trim() !== '' && !counts.has(selected)) counts.set(selected, 0);
  const values = [...counts.keys()].filter(value => value !== EMPTY_VALUE).sort((a, b) => a.localeCompare(b));
  if (counts.has(EMPTY_VALUE)) values.push(EMPTY_VALUE);
  return values.map(value => {
    const count = counts.get(value) as number;
    return { value, label: `${value} (${count})`, count };
  });
}

export interface GroupOption {
  id: GroupBy;
  label: string;
  /** Group key of a row; '' = "(ohne)". */
  key: (row: KubeRow) => string;
  /** Only with all namespaces (query.namespace === null). */
  allNamespacesOnly?: true;
}

const whole = (key: string) => (row: KubeRow): string => normalise([row.cells[key] === undefined ? undefined : String(row.cells[key])])[0] ?? '';
const namespaceOption: GroupOption = { id: 'namespace', label: 'Namespace', key: row => normalise([row.ref.namespace])[0] ?? '', allNamespacesOnly: true };

function objectKind(row: KubeRow): string {
  const kind = row.involved?.kind ?? (row.cells.object === undefined ? undefined : String(row.cells.object).split('/')[0]);
  return normalise([kind])[0] ?? '';
}

export const GROUP_OPTIONS: Record<KubeKind, GroupOption[]> = {
  pods: [
    namespaceOption,
    { id: 'node', label: 'Node', key: row => normalise([row.node])[0] ?? '' },
    { id: 'status', label: 'Status', key: whole('status') },
    { id: 'owner', label: 'Owner', key: row => (row.owner ? `${KIND_INFO[row.owner.kind].kind} ${row.owner.name}` : '') },
  ],
  deployments: [namespaceOption],
  statefulsets: [namespaceOption],
  daemonsets: [namespaceOption],
  jobs: [namespaceOption],
  cronjobs: [namespaceOption],
  services: [namespaceOption],
  ingresses: [namespaceOption],
  nodes: [
    { id: 'status', label: 'Status', key: whole('status') },
    { id: 'roles', label: 'Rollen', key: whole('roles') },
  ],
  events: [
    namespaceOption,
    { id: 'type', label: 'Typ', key: whole('type') },
    { id: 'reason', label: 'Grund', key: whole('reason') },
    { id: 'objectKind', label: 'Objekt-Art', key: objectKind },
  ],
};

/** GROUP_OPTIONS[kind].find(id)?.key(row) ?? ''. */
export function groupKey(kind: KubeKind, groupBy: GroupBy, row: KubeRow): string {
  return GROUP_OPTIONS[kind].find(option => option.id === groupBy)?.key(row) ?? '';
}

/** Grouping of one kind in the view state. */
export interface KubeGrouping { by: GroupBy; collapsed: string[] }

export type GroupRow = { type: 'group'; key: string; label: string; count: number; collapsed: boolean };
export type ResourceItem = { type: 'row'; row: KubeRow };
export type TableItem = GroupRow | ResourceItem;

/** groupBy null or not in GROUP_OPTIONS[kind]: every row as ResourceItem, same order. Else groups sorted by key ('' last),
 *  one GroupRow each followed by its rows (none when collapsed); rows keep their input order. */
export function groupRows(rows: readonly KubeRow[], kind: KubeKind, groupBy: GroupBy | null, collapsed: readonly string[]): TableItem[] {
  const option = groupBy === null ? undefined : GROUP_OPTIONS[kind].find(candidate => candidate.id === groupBy);
  if (!option) return rows.map(row => ({ type: 'row', row }));
  const groups = new Map<string, KubeRow[]>();
  for (const row of rows) {
    const key = option.key(row);
    const members = groups.get(key);
    if (members) members.push(row);
    else groups.set(key, [row]);
  }
  const keys = [...groups.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
  const items: TableItem[] = [];
  for (const key of keys) {
    const members = groups.get(key) as KubeRow[];
    const isCollapsed = collapsed.includes(key);
    items.push({ type: 'group', key, label: key || EMPTY_VALUE, count: members.length, collapsed: isCollapsed });
    if (!isCollapsed) for (const row of members) items.push({ type: 'row', row });
  }
  return items;
}

/** Help texts. */
export interface FilterHelpForm { form: string; description: string; example: string }
export const FILTER_HELP: FilterHelpForm[] = [
  { form: 'Text', description: 'Spalte enthält den Text', example: 'api' },
  { form: 'Auswahl', description: 'Spalte hat genau diesen Wert; „(ohne)“ für leere Zellen', example: 'shop' },
  { form: '>3  >=3  <3  <=3  =3  3', description: 'Zahlenspalten vergleichen; eine reine Zahl heißt gleich', example: '>3' },
  { form: '<10m  >1h  <2d', description: 'Alter jünger (<) oder älter (>) als; Einheiten s, m, h, d', example: '<10m' },
];
export const FILTER_NOTE = 'Alle Filter gelten zusammen, Groß- und Kleinschreibung zählen nicht. Ungültige Eingaben sind rot markiert und filtern nicht. F setzt alle Filter des Reiters zurück, die Gruppierung bleibt.';
export const GROUP_NOTE = 'Gruppen sind nach Name sortiert, „(ohne)“ steht am Ende. Ein Klick auf die Gruppenzeile klappt sie auf und zu; j und k überspringen Gruppenzeilen.';
export const TEXT_FILTER_NOTE = 'Kontextmenüs setzen Textfilter wie app=api oder owner:nightly. Sie stehen als Chip „Filter: …“ am Anfang der Leiste und lassen sich mit × entfernen.';
export const FILTER_KIND_LABEL: Record<Exclude<ColumnFilterKind, 'none'>, string> = { text: 'Text', select: 'Auswahl', number: 'Zahl', age: 'Alter' };
