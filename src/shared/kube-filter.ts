import { LABEL_KEY, LABEL_VALUE, type KubeKind, type KubeRow } from './kubernetes';

/** Search text plus active chip ids of one kind. */
export interface KubeFilter { text: string; chips: string[] }
export const EMPTY_FILTER: KubeFilter = { text: '', chips: [] };
export const MAX_SEARCH_LENGTH = 200;

export interface QualifierDef {
  name: string;                         // lowercase, e.g. 'ns', 'node'
  description: string;                  // German, for the help
  /** true: whole value must equal (owner:); false: substring. */
  exact?: boolean;
  values: (row: KubeRow) => string[];   // raw values; matching lowercases both sides
}

const one = (value: string | undefined): string[] => (value ? [value] : []);
const cell = (row: KubeRow, key: string): string[] => one(row.cells[key] === undefined ? undefined : String(row.cells[key]));
const imageCells = (row: KubeRow): string[] =>
  Object.keys(row.cells).filter(key => key.startsWith('image:')).flatMap(key => cell(row, key));
const ns: QualifierDef = { name: 'ns', description: 'Namespace', values: row => one(row.ref.namespace) };
const q = (name: string, description: string, values: (row: KubeRow) => string[], exact?: boolean): QualifierDef =>
  ({ name, description, values, ...(exact ? { exact } : {}) });
const owner = q('owner', 'Besitzer (ganzer Name)', row => one(row.owner?.name), true);

export const QUALIFIERS: Record<KubeKind, QualifierDef[]> = {
  pods: [ns, q('node', 'Node', row => one(row.node)), q('status', 'Status', row => cell(row, 'status')),
    q('image', 'Image eines Containers', imageCells), owner, q('ip', 'Pod-IP', row => one(row.ip)),
    q('container', 'Container-Name', row => row.containers ?? [])],
  deployments: [ns, q('image', 'Image', row => cell(row, 'image'))],
  statefulsets: [ns, q('image', 'Image', row => cell(row, 'image'))],
  daemonsets: [ns, q('image', 'Image', row => cell(row, 'image'))],
  jobs: [ns, q('status', 'Status', row => cell(row, 'status')), owner],
  cronjobs: [ns, q('schedule', 'Zeitplan', row => cell(row, 'schedule'))],
  services: [ns, q('type', 'Typ', row => cell(row, 'type')), q('ip', 'Cluster-IP', row => cell(row, 'clusterIp')),
    q('port', 'Port', row => cell(row, 'ports'))],
  ingresses: [ns, q('host', 'Host', row => cell(row, 'hosts')), q('address', 'Adresse', row => cell(row, 'address'))],
  nodes: [q('role', 'Rolle', row => cell(row, 'roles')), q('ip', 'Interne IP', row => one(row.ip)),
    q('version', 'Kubelet-Version', row => cell(row, 'version'))],
  events: [ns, q('reason', 'Grund', row => cell(row, 'reason')), q('object', 'Objekt (Kind/Name)', row => cell(row, 'object')),
    q('type', 'Typ (Normal, Warning)', row => cell(row, 'type')),
    q('kind', 'Kind des Objekts', row => {
      if (row.involved?.kind) return [row.involved.kind];
      const object = String(row.cells.object ?? '');
      const slash = object.indexOf('/');
      return slash > 0 ? [object.slice(0, slash)] : [];
    })],
};

/** Numeric fields for `name(>|>=|<|<=|=)digits`, read via Number(row.cells[name]). */
export const NUMERIC_FIELDS: Partial<Record<KubeKind, string[]>> = { pods: ['restarts'], events: ['count'] };

const name = (row: KubeRow): string[] => one(row.ref.name);
const namespace = (row: KubeRow): string[] => one(row.ref.namespace);
const FREE_TEXT: Record<KubeKind, (row: KubeRow) => string[]> = {
  pods: row => [...name(row), ...namespace(row), ...cell(row, 'status'), ...one(row.node), ...imageCells(row), ...one(row.owner?.name), ...one(row.ip)],
  deployments: row => [...name(row), ...namespace(row), ...cell(row, 'image')],
  statefulsets: row => [...name(row), ...namespace(row), ...cell(row, 'image')],
  daemonsets: row => [...name(row), ...namespace(row), ...cell(row, 'image')],
  jobs: row => [...name(row), ...namespace(row), ...cell(row, 'status'), ...one(row.owner?.name)],
  cronjobs: row => [...name(row), ...namespace(row), ...cell(row, 'schedule')],
  services: row => [...name(row), ...namespace(row), ...cell(row, 'type'), ...cell(row, 'clusterIp'), ...cell(row, 'ports')],
  ingresses: row => [...name(row), ...namespace(row), ...cell(row, 'hosts'), ...cell(row, 'address')],
  nodes: row => [...name(row), ...cell(row, 'status'), ...cell(row, 'roles'), ...cell(row, 'version'), ...one(row.ip)],
  events: row => [...cell(row, 'reason'), ...cell(row, 'object'), ...cell(row, 'message'), ...namespace(row), ...cell(row, 'type')],
};

const searchCache = new WeakMap<KubeRow, string>();
/** All free-text fields of the row, lowercase, joined with '\n'; cached in a WeakMap<KubeRow, string>. */
export function searchText(row: KubeRow): string {
  let text = searchCache.get(row);
  if (text === undefined) {
    text = FREE_TEXT[row.ref.kind](row).filter(value => value !== '').join('\n').toLowerCase();
    searchCache.set(row, text);
  }
  return text;
}

interface Token { text: string; negated: boolean; phrase: boolean }

/** Whitespace splits tokens except inside quotes; quotes may start mid-token and are removed; an unclosed quote runs to the end. */
function tokenize(input: string): Token[] {
  const raws: string[] = [];
  let current = '';
  let quoted = false;
  let started = false;
  for (const char of input) {
    if (char === '"') { quoted = !quoted; started = true; current += char; continue; }
    if (!quoted && /\s/.test(char)) {
      if (started) raws.push(current);
      current = ''; started = false;
      continue;
    }
    started = true;
    current += char;
  }
  if (started) raws.push(current);

  const tokens: Token[] = [];
  for (const raw of raws) {
    const negated = raw.length > 1 && raw.startsWith('!');
    const rest = negated ? raw.slice(1) : raw;
    const text = rest.replace(/"/g, '').toLowerCase();
    if (raw === '!' || text === '') continue;
    tokens.push({ text, negated, phrase: rest.startsWith('"') });
  }
  return tokens;
}

const NUMERIC = /^([a-z]+)(>=|<=|>|<|=)(\d+)$/;
const LABEL = /^([^=!]+)(!=|=)([^=]*)$/;
const QUALIFIER = /^([a-z]+):(.*)$/;

type Predicate = (row: KubeRow) => boolean;

function compare(left: number, operator: string, right: number): boolean {
  switch (operator) {
    case '>': return left > right;
    case '>=': return left >= right;
    case '<': return left < right;
    case '<=': return left <= right;
    default: return left === right;
  }
}

/** One token to a predicate that ignores the leading `!` (the caller negates). Ignored tokens are flagged and filtered out. */
function compileToken(kind: KubeKind, token: Token): { test: Predicate; ignored?: boolean; negated: boolean } {
  const { text, negated, phrase } = token;
  if (!phrase) {
    const numeric = NUMERIC.exec(text);
    if (numeric && NUMERIC_FIELDS[kind]?.includes(numeric[1])) {
      const [, field, operator, digits] = numeric;
      const limit = Number(digits);
      return { negated, test: row => compare(Number(row.cells[field]), operator, limit) };
    }
    const label = LABEL.exec(text);
    if (label && LABEL_KEY.test(label[1]) && LABEL_VALUE.test(label[3])) {
      const [, key, operator, value] = label;
      // `!key=value` is `key!=value`; `!key!=value` is `key=value`.
      const wantEqual = (operator === '=') !== negated;
      const has = (row: KubeRow): boolean => Object.entries(row.labels).some(([k, v]) => k.toLowerCase() === key && v.toLowerCase() === value);
      return { negated: false, test: row => has(row) === wantEqual };
    }
    const qualifier = QUALIFIER.exec(text);
    const def = qualifier ? QUALIFIERS[kind].find(candidate => candidate.name === qualifier[1]) : undefined;
    if (qualifier && def) {
      const value = qualifier[2];
      if (value === '') return { negated: false, ignored: true, test: () => true };
      return {
        negated,
        test: row => def.values(row).some(candidate => {
          const lower = candidate.toLowerCase();
          return def.exact ? lower === value : lower.includes(value);
        }),
      };
    }
  }
  return { negated, test: row => searchText(row).includes(text) };
}

let lastCompiled: { kind: KubeKind; text: string; predicate: Predicate } | undefined;

/** Predicate for the search text only (no chips). Empty/whitespace text matches everything. Memoised for the last (kind, text). */
export function compileSearch(kind: KubeKind, text: string): (row: KubeRow) => boolean {
  if (lastCompiled && lastCompiled.kind === kind && lastCompiled.text === text) return lastCompiled.predicate;
  const parts = tokenize(text).map(token => compileToken(kind, token)).filter(part => !part.ignored);
  const predicate: Predicate = parts.length === 0
    ? () => true
    : row => parts.every(part => part.test(row) !== part.negated);
  lastCompiled = { kind, text, predicate };
  return predicate;
}

export interface SearchForm { form: string; description: string; example: string }
export interface SearchHelp {
  syntax: string;
  forms: SearchForm[];
  note: string;
  qualifiers: Record<KubeKind, { name: string; description: string }[]>;   // derived from QUALIFIERS
  numeric: Partial<Record<KubeKind, string[]>>;                            // = NUMERIC_FIELDS
}

const helpQualifiers = Object.fromEntries(
  (Object.keys(QUALIFIERS) as KubeKind[]).map(kind => [kind, QUALIFIERS[kind].map(({ name, description }) => ({ name, description }))]),
) as SearchHelp['qualifiers'];

export const SEARCH_HELP: SearchHelp = {
  syntax: 'term  "ein satz"  !term  key=value  key!=value  feld:wert  !feld:wert  restarts>3  count>=5',
  forms: [
    { form: 'term', description: 'Teilstring in einem Suchfeld des Reiters; mehrere Begriffe müssen alle passen', example: 'api' },
    { form: '"ein satz"', description: 'Begriff mit Leerzeichen', example: '"back-off restarting"' },
    { form: '!term', description: 'Kein Suchfeld enthält den Begriff', example: '!kube-system' },
    { form: 'key=value', description: 'Label hat genau diesen Wert', example: 'app=api' },
    { form: 'key!=value', description: 'Label fehlt oder hat einen anderen Wert', example: 'tier!=web' },
    { form: 'feld:wert', description: 'Teilstring in einem Feld (Qualifier des Reiters unten)', example: 'node:worker2' },
    { form: '!feld:wert', description: 'Feld enthält den Wert nicht', example: '!status:running' },
    { form: 'restarts>3', description: 'Zahlenvergleich mit > >= < <= = (Pods: restarts, Events: count)', example: 'count>=5' },
  ],
  note: 'Groß- und Kleinschreibung zählen nicht. Unbekannte Qualifier gelten als Text.',
  qualifiers: helpQualifiers,
  numeric: NUMERIC_FIELDS,
};
