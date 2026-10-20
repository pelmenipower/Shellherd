// Pure column model of the container view: filter kinds, cell normalisation, column filters, grouping.
import type { ContainerRuntime, InventoryKind, InventoryRow } from '../../shared/containers';
import type { FacetOption, NumberOp } from './kube-columns';
import { EMPTY_VALUE, parseAgeFilter, parseNumberFilter } from './kube-columns';
import { formatAge } from './kube-view';
import { compareText, foldCase, formatNumber } from '../../shared/format';
import { t } from './i18n';

export type ColumnFilterKind = 'text' | 'select' | 'number' | 'size' | 'age';
export interface ContainerColumn { key: string; label: string; filter: ColumnFilterKind; podmanOnly?: true }

const COLUMN_LABEL_KEYS = {
  name: 'containers:columns.name', status: 'containers:columns.status', info: 'containers:columns.info', image: 'containers:columns.image',
  ports: 'containers:columns.ports', project: 'containers:columns.project', pod: 'containers:columns.pod', networks: 'containers:columns.networks',
  created: 'containers:columns.created', repository: 'containers:columns.repository', tag: 'containers:columns.tag', id: 'containers:columns.id',
  size: 'containers:columns.size', usedBy: 'containers:columns.usedBy', driver: 'containers:columns.driver', mountpoint: 'containers:columns.mountpoint',
  scope: 'containers:columns.scope', internal: 'containers:columns.internal', containers: 'containers:columns.containers',
} as const;
type ColumnKey = keyof typeof COLUMN_LABEL_KEYS;

/** Header text of a column key in the current language; an unknown key comes back as it is. */
export function columnLabel(key: string): string {
  return key in COLUMN_LABEL_KEYS ? t(COLUMN_LABEL_KEYS[key as ColumnKey]) : key;
}

// `label` is a getter: it reads the language when it is used, not when the module loads.
const column = (key: ColumnKey, filter: ColumnFilterKind, podmanOnly?: true): ContainerColumn => ({
  key, get label() { return columnLabel(key); }, filter, ...(podmanOnly ? { podmanOnly } : {}),
});

export const COLUMNS: Record<InventoryKind, readonly ContainerColumn[]> = {
  containers: [
    column('name', 'text'), column('status', 'select'), column('info', 'text'), column('image', 'text'), column('ports', 'text'),
    column('project', 'select'), column('pod', 'select', true), column('networks', 'select'), column('created', 'age'),
  ],
  images: [
    column('repository', 'text'), column('tag', 'text'), column('id', 'text'), column('size', 'size'), column('usedBy', 'number'), column('created', 'age'),
  ],
  volumes: [
    column('name', 'text'), column('driver', 'select'), column('mountpoint', 'text'), column('usedBy', 'number'), column('created', 'age'),
  ],
  networks: [
    column('name', 'text'), column('driver', 'select'), column('scope', 'select'), column('internal', 'select'), column('containers', 'number'), column('created', 'age'),
  ],
};

/** Columns of one kind; podmanOnly columns are dropped for docker. */
export function columnsFor(kind: InventoryKind, runtime: ContainerRuntime): ContainerColumn[] {
  return COLUMNS[kind].filter(column => !column.podmanOnly || runtime === 'podman');
}

/** Column `/` focuses: 'repository' for images, else 'name'. */
export function primaryFilterColumn(kind: InventoryKind): string {
  return kind === 'images' ? 'repository' : 'name';
}

const EMPTY_MARKERS = new Set(['', '-', '–', '—']);
const normalise = (values: Array<string | undefined>): string[] =>
  values.map(value => (value ?? '').trim()).filter(value => !EMPTY_MARKERS.has(value));

/** Normalised cell values of a row for one column; [] = empty cell. 'networks' is split on ','. */
export function cellValues(row: InventoryRow, key: string): string[] {
  if (key === 'name' && row.cells.name === undefined) return normalise([row.name]);
  const raw = row.cells[key];
  if (raw === undefined) return [];
  if (key === 'networks') return normalise(String(raw).split(','));
  return normalise([String(raw)]);
}

/** Decimal like Docker: 999 -> '999 B', 142_000_000 -> '142 MB', 1_200_000_000 -> '1.2 GB' (en-US; '1,2 GB' in de-DE), 10_500 -> '10.5 kB'. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  const units = ['B', 'kB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let index = 0;
  while (value >= 1000 && index < units.length - 1) {
    value /= 1000;
    index++;
  }
  if (index === 0) return `${Math.round(value)} B`;
  // Three significant digits at most, no trailing zero.
  const text = value >= 100 ? String(Math.round(value)) : String(Number(value.toFixed(value >= 10 ? 1 : 2)));
  return `${text} ${units[index]}`;
}

/** size -> formatBytes, age -> formatAge, number as is, empty -> '–'. */
export function displayCell(row: InventoryRow, column: ContainerColumn, now: number): string {
  const values = cellValues(row, column.key);
  if (values.length === 0) return '–';
  if (column.filter === 'size') {
    const bytes = Number(values[0]);
    return Number.isNaN(bytes) ? '–' : formatBytes(bytes);
  }
  if (column.filter === 'age') return formatAge(values[0], now);
  return column.key === 'networks' ? values.join(', ') : values[0];
}

const SIZE_UNIT: Record<string, number> = { b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12 };
/** '>100MB', '<= 1.5 GB', '2048', '=0'; units B, kB, KB, MB, GB, TB (case-insensitive, decimal); no unit = bytes; no operator = '='. */
export function parseSizeFilter(text: string): { op: NumberOp; bytes: number } | null {
  const match = /^(>=|<=|>|<|=)?\s*(\d+(?:\.\d+)?)\s*([a-z]+)?$/i.exec(text.trim());
  if (!match) return null;
  const unit = match[3] === undefined ? 1 : SIZE_UNIT[match[3].toLowerCase()];
  if (unit === undefined) return null;
  return { op: (match[1] as NumberOp | undefined) ?? '=', bytes: Math.round(Number(match[2]) * unit) };
}

/** False only for a non-blank number/size/age filter that does not parse (the field is marked red). */
export function isValidColumnFilter(column: ContainerColumn, value: string): boolean {
  if (value.trim() === '') return true;
  if (column.filter === 'number') return parseNumberFilter(value) !== null;
  if (column.filter === 'size') return parseSizeFilter(value) !== null;
  if (column.filter === 'age') return parseAgeFilter(value) !== null;
  return true;
}

type Predicate = (row: InventoryRow) => boolean;

const compare = (op: NumberOp, a: number, b: number): boolean =>
  op === '>' ? a > b : op === '>=' ? a >= b : op === '<' ? a < b : op === '<=' ? a <= b : a === b;

function compileOne(column: ContainerColumn, value: string, now: number): Predicate | null {
  const text = value.trim();
  if (text === '') return null;
  const key = column.key;
  switch (column.filter) {
    case 'text': {
      const needle = foldCase(text);
      return row => cellValues(row, key).some(cell => foldCase(cell).includes(needle));
    }
    case 'select': {
      // Select values come from the option list and are exact; the stored value is not trimmed away.
      if (value === EMPTY_VALUE) return row => cellValues(row, key).length === 0;
      return row => cellValues(row, key).includes(value);
    }
    case 'number':
    case 'size': {
      const parsed = column.filter === 'size' ? parseSizeFilter(text) : parseNumberFilter(text);
      if (!parsed) return null;
      const op = parsed.op;
      const limit = 'bytes' in parsed ? parsed.bytes : parsed.value;
      return row => {
        const cell = cellValues(row, key)[0];
        if (cell === undefined) return false;
        const number = Number(cell);
        return !Number.isNaN(number) && compare(op, number, limit);
      };
    }
    case 'age': {
      const parsed = parseAgeFilter(text);
      if (!parsed || now <= 0) return null;
      const { op, ms } = parsed;
      return row => {
        const cell = cellValues(row, key)[0];
        if (cell === undefined) return false;
        const time = Date.parse(cell);
        if (Number.isNaN(time)) return false;
        const age = Math.max(0, now - time);
        return op === '<' ? age < ms : op === '<=' ? age <= ms : op === '>' ? age > ms : age >= ms;
      };
    }
  }
}

/** AND of all column filters whose key is in `columns`. Blank, invalid and unknown keys match all. */
export function compileColumnFilters(columns: readonly ContainerColumn[], filters: Readonly<Record<string, string>> | undefined, now: number): (row: InventoryRow) => boolean {
  const predicates: Predicate[] = [];
  if (filters) {
    for (const column of columns) {
      const value = filters[column.key];
      if (value === undefined) continue;
      const predicate = compileOne(column, value, now);
      if (predicate) predicates.push(predicate);
    }
  }
  return row => predicates.every(predicate => predicate(row));
}

/** Options of a select filter with counts among the rows that pass all OTHER filters (`filters` minus this column's own,
 *  plus `otherPredicate` for chips). The own selected value stays, with count 0 when nothing matches. */
export function facetValues(
  rows: readonly InventoryRow[], columns: readonly ContainerColumn[], column: ContainerColumn,
  filters: Readonly<Record<string, string>> | undefined, now: number, otherPredicate: (row: InventoryRow) => boolean,
): FacetOption[] {
  const others: Record<string, string> = {};
  for (const [key, value] of Object.entries(filters ?? {})) if (key !== column.key) others[key] = value;
  const columnFilters = compileColumnFilters(columns, others, now);
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!otherPredicate(row) || !columnFilters(row)) continue;
    const cells = cellValues(row, column.key);
    for (const cell of cells.length === 0 ? [EMPTY_VALUE] : [...new Set(cells)]) counts.set(cell, (counts.get(cell) ?? 0) + 1);
  }
  const selected = filters?.[column.key];
  if (selected !== undefined && selected.trim() !== '' && !counts.has(selected)) counts.set(selected, 0);
  const values = [...counts.keys()].filter(value => value !== EMPTY_VALUE).sort(compareText);
  if (counts.has(EMPTY_VALUE)) values.push(EMPTY_VALUE);
  return values.map(value => {
    const count = counts.get(value) as number;
    return { value, label: `${value} (${count})`, count };
  });
}

export type GroupId = 'project' | 'status' | 'image' | 'pod' | 'repository' | 'driver';
export interface GroupOption { id: GroupId; label: string; key: (row: InventoryRow) => string; podmanOnly?: true }

const by = (key: string) => (row: InventoryRow): string => cellValues(row, key)[0] ?? '';

const option = (id: GroupId, key: (row: InventoryRow) => string, podmanOnly?: true): GroupOption => ({
  id, get label() { return columnLabel(id); }, key, ...(podmanOnly ? { podmanOnly } : {}),
});

export const GROUP_OPTIONS: Record<InventoryKind, readonly GroupOption[]> = {
  containers: [option('project', by('project')), option('status', by('status')), option('image', by('image')), option('pod', by('pod'), true)],
  images: [option('repository', by('repository'))],
  volumes: [option('driver', by('driver'))],
  networks: [option('driver', by('driver'))],
};

export function groupOptionsFor(kind: InventoryKind, runtime: ContainerRuntime): GroupOption[] {
  return GROUP_OPTIONS[kind].filter(option => !option.podmanOnly || runtime === 'podman');
}

export type GroupRow = { type: 'group'; key: string; label: string; count: number; collapsed: boolean };
export type ResourceItem = { type: 'row'; row: InventoryRow };
export type TableItem = GroupRow | ResourceItem;

/** groupBy null or not in `options`: every row as ResourceItem, same order. Else groups sorted by key ('' last),
 *  one GroupRow each followed by its rows (none when collapsed); rows keep their input order. */
export function groupRows(rows: readonly InventoryRow[], options: readonly GroupOption[], groupBy: GroupId | null, collapsed: readonly string[]): TableItem[] {
  const option = groupBy === null ? undefined : options.find(candidate => candidate.id === groupBy);
  if (!option) return rows.map(row => ({ type: 'row', row }));
  const groups = new Map<string, InventoryRow[]>();
  for (const row of rows) {
    const key = option.key(row);
    const members = groups.get(key);
    if (members) members.push(row);
    else groups.set(key, [row]);
  }
  const keys = [...groups.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : compareText(a, b)));
  const items: TableItem[] = [];
  for (const key of keys) {
    const members = groups.get(key) as InventoryRow[];
    const isCollapsed = collapsed.includes(key);
    items.push({ type: 'group', key, label: key || EMPTY_VALUE, count: members.length, collapsed: isCollapsed });
    if (!isCollapsed) for (const row of members) items.push({ type: 'row', row });
  }
  return items;
}

export interface FilterHelpForm { form: string; description: string; example: string }
const HELP_KEYS = {
  text: { form: 'containers:filterHelp.text.form', description: 'containers:filterHelp.text.description' },
  select: { form: 'containers:filterHelp.select.form', description: 'containers:filterHelp.select.description' },
  number: { form: 'containers:filterHelp.number.form', description: 'containers:filterHelp.number.description' },
  size: { form: 'containers:filterHelp.size.form', description: 'containers:filterHelp.size.description' },
  age: { form: 'containers:filterHelp.age.form', description: 'containers:filterHelp.age.description' },
} as const satisfies Record<ColumnFilterKind, { form: string; description: string }>;
// form and description are getters: they read the language when they are used.
const helpForm = (kind: ColumnFilterKind, example: string): FilterHelpForm => ({
  get form() { return t(HELP_KEYS[kind].form); }, get description() { return t(HELP_KEYS[kind].description); }, example,
});
export const FILTER_HELP: readonly FilterHelpForm[] = [
  helpForm('text', 'web'), helpForm('select', 'running'), helpForm('number', '>0'), helpForm('size', '>100MB'), helpForm('age', '<10m'),
];
