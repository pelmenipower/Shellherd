# Kubernetes – Spaltenfilter und Gruppierung – Validierung

Stand: 2026-10-18 · Validierung: Opus · Bezug: `2026-10-18-kubernetes-column-filters-design.md` (Spec)

**Dieses Dokument ist bindend und hat Vorrang vor der Spec.** Wo es schweigt, gilt die Spec. Wo es von der 0.7.0-Validierung (`…search-filter-validation.md`) abweicht, gilt dieses Dokument. Zielversion **0.8.0**.

**Verdict: ready after corrections.** 12 Blocker (B1–B12), 34 Korrekturen/Entscheidungen (C1–C34), Vertrag in Abschnitt 1, Wellen und Tasks in Abschnitt 4.

Kommentare im Code englisch, UI-Texte deutsch und **wörtlich** wie hier. Namen und Signaturen sind verbindlich, damit parallele Tasks ohne Rückfrage gegeneinander bauen.

---

## 1. Vertrag (exaktes TypeScript)

### 1.1 `src/shared/kubernetes.ts` (T1, nur Ergänzungen)

```ts
/** Group-by options of the cluster table; the per-kind subset is GROUP_OPTIONS in kube-columns.ts. */
export const GROUP_BY_IDS = ['namespace', 'node', 'status', 'owner', 'roles', 'type', 'reason', 'objectKind'] as const;
export type GroupBy = typeof GROUP_BY_IDS[number];
/** Limits of the saved view; the reducer keeps the state inside them so the vault schema never rejects a snapshot. */
export const MAX_COLUMN_FILTERS = 12;
export const MAX_COLUMN_FILTER_LENGTH = 100;
export const MAX_COLLAPSED = 50;
export const MAX_GROUP_KEY_LENGTH = 300;

/** Saved filter and grouping of one kind; every field optional, absent = empty / no grouping. */
export interface KubeFilterSnapshot {
  text?: string;
  chips?: string[];
  /** Column key → filter text as typed. */
  columns?: Record<string, string>;
  groupBy?: GroupBy;
  /** Keys of collapsed groups ('' = „(ohne)“). */
  collapsed?: string[];
}
```

`KubeViewSnapshot` bleibt unverändert (`filters?: Partial<Record<KubeKind, KubeFilterSnapshot>>`). Gruppierung reist im selben Eintrag je Kind mit (kein zweiter Record).

### 1.2 `src/shared/kubernetes-schema.ts` (T1)

```ts
import { GROUP_BY_IDS, MAX_COLLAPSED, MAX_COLUMN_FILTER_LENGTH, MAX_COLUMN_FILTERS, MAX_GROUP_KEY_LENGTH, … } from './kubernetes';

const KubeFilterSnapshotSchema = z.object({
  text: z.string().max(200).optional(),
  chips: z.array(z.string().max(40)).max(16).optional(),
  columns: z.record(z.string().regex(/^[A-Za-z]{1,40}$/), z.string().max(MAX_COLUMN_FILTER_LENGTH))
    .refine(columns => Object.keys(columns).length <= MAX_COLUMN_FILTERS, { message: 'Zu viele Spaltenfilter.' })
    .optional(),
  groupBy: z.enum(GROUP_BY_IDS).optional(),
  collapsed: z.array(z.string().max(MAX_GROUP_KEY_LENGTH)).max(MAX_COLLAPSED).optional(),
}).strict();
```

`KubeViewSnapshotSchema` bleibt sonst gleich (`z.partialRecord(z.enum(KUBE_KINDS), KubeFilterSnapshotSchema).optional()`). Ein `z.record` mit **String**-Schlüssel ist in zod 4 nicht erschöpfend; die Grenze von 12 Einträgen kommt aus dem `refine`.

### 1.3 `src/shared/kube-filter.ts` (T1, nur der Typ)

```ts
/** Search text, active chip ids and column filters of one kind. `columns` is omitted when empty, never `{}` (B11). */
export interface KubeFilter { text: string; chips: string[]; columns?: Record<string, string> }
```

`EMPTY_FILTER` bleibt `{ text: '', chips: [] }`. Sonst ändert sich in `kube-filter.ts` nichts. `SEARCH_HELP` bleibt exportiert und getestet, wird aber von der UI nicht mehr benutzt (C27).

### 1.4 `src/renderer/src/kube-columns.ts` (T2, neu, rein)

Importiert **nur** aus `../../shared/kubernetes` (Werte `KIND_COLUMNS`, `KIND_INFO`; Typen `ColumnInfo`, `GroupBy`, `KubeKind`, `KubeRow`). **Nie** aus `kube-view.ts` (B12).

```ts
export type ColumnFilterKind = 'text' | 'select' | 'number' | 'age' | 'none';

/** Value of the empty option in select filters and the key of the empty group's label. */
export const EMPTY_VALUE = '(ohne)';

/** Columns of a table: KIND_COLUMNS[kind], plus { key: 'namespace', label: 'Namespace' } right after 'name'
 *  (index 0 without 'name') when namespace === null and KIND_INFO[kind].namespaced. kube-view's columnsOf delegates here. */
export function columnsFor(kind: KubeKind, namespace: string | null): ColumnInfo[];

/** usage → 'none'; age → 'age'; numeric → 'number'; key 'namespace' or in SELECT_COLUMNS[kind] → 'select'; else 'text'. */
export function columnFilterKind(kind: KubeKind, column: ColumnInfo): ColumnFilterKind;

/** Column `/` focuses: 'message' for events, else 'name'. */
export function primaryFilterColumn(kind: KubeKind): string;

/** Normalised cell values of a row for one column (C3); [] = empty cell. */
export function cellValues(kind: KubeKind, row: KubeRow, key: string): string[];

export type NumberOp = '>' | '>=' | '<' | '<=' | '=';
/** '>3', '>= 3', '=3', '3' (= equal), '2.5'. Blank or anything else: null. */
export function parseNumberFilter(text: string): { op: NumberOp; value: number } | null;
export type AgeOp = '<' | '<=' | '>' | '>=';
/** '<10m', '> 1h', '<=2d', '30s', '10M'. Without operator: '<'. Units s, m, h, d (case-insensitive). Blank or anything else: null. */
export function parseAgeFilter(text: string): { op: AgeOp; ms: number } | null;

/** False only for a non-blank number/age filter that does not parse (the field is marked red). */
export function isValidColumnFilter(kind: KubeKind, column: ColumnInfo, value: string): boolean;

/** AND of all column filters whose key is in `columns` and whose kind is not 'none'. Blank, invalid and unknown keys match all. */
export function compileColumnFilters(kind: KubeKind, columns: readonly ColumnInfo[], filters: Readonly<Record<string, string>> | undefined, now: number): (row: KubeRow) => boolean;

/** Options of a select filter: unique values of `rows`, sorted with localeCompare; EMPTY_VALUE last when a row is empty;
 *  `selected` (non-blank) is always included, even if no row has it anymore (C10). */
export function columnValues(kind: KubeKind, rows: readonly KubeRow[], key: string, selected?: string): string[];

export interface GroupOption {
  id: GroupBy;
  label: string;
  /** Group key of a row; '' = „(ohne)“. */
  key: (row: KubeRow) => string;
  /** Only with all namespaces (query.namespace === null). */
  allNamespacesOnly?: true;
}
export const GROUP_OPTIONS: Record<KubeKind, GroupOption[]>;   // without „keine“; the UI adds it
/** GROUP_OPTIONS[kind].find(id)?.key(row) ?? ''. */
export function groupKey(kind: KubeKind, groupBy: GroupBy, row: KubeRow): string;

/** Grouping of one kind in the view state. */
export interface KubeGrouping { by: GroupBy; collapsed: string[] }

export type GroupRow = { type: 'group'; key: string; label: string; count: number; collapsed: boolean };
export type ResourceItem = { type: 'row'; row: KubeRow };
export type TableItem = GroupRow | ResourceItem;
/** groupBy null or not in GROUP_OPTIONS[kind]: every row as ResourceItem, same order. Else C17. */
export function groupRows(rows: readonly KubeRow[], kind: KubeKind, groupBy: GroupBy | null, collapsed: readonly string[]): TableItem[];

/** Help texts (C27). */
export interface FilterHelpForm { form: string; description: string; example: string }
export const FILTER_HELP: FilterHelpForm[];
export const FILTER_NOTE: string;
export const GROUP_NOTE: string;
export const TEXT_FILTER_NOTE: string;
export const FILTER_KIND_LABEL: Record<Exclude<ColumnFilterKind, 'none'>, string>;
```

`matchesColumnFilters` aus der Spec entfällt zugunsten von `compileColumnFilters` (einmal parsen, oft prüfen).

**`SELECT_COLUMNS`** (intern): pods `status`, `node`; jobs `status`; services `type`; nodes `status`, `roles`; events `type`. Dazu überall `namespace`.

**Feldart je Spalte** (Ergebnis, Test-Tabelle für T2):

| Kind | Spalten → Feldart |
|---|---|
| pods | name text · namespace select · ready text · status select · restarts number · cpu none · memory none · node select · age age |
| deployments, statefulsets, daemonsets | name text · namespace select · ready text · upToDate number · image text · age age |
| jobs | name text · namespace select · completions text · status select · lastRun age · age age |
| cronjobs | name text · namespace select · schedule text · lastRun age · age age |
| services | name text · namespace select · type select · clusterIp text · ports text · age age |
| ingresses | name text · namespace select · hosts text · address text · age age |
| nodes | name text · status select · roles select · cpu none · memory none · pods number · version text |
| events | type select · reason text · object text · message text · count number · last age |

**`GROUP_OPTIONS`** (Reihenfolge, ID, Label wörtlich, Key):

| Kind | Optionen |
|---|---|
| pods | `namespace` „Namespace“ (allNamespacesOnly) · `node` „Node“ · `status` „Status“ · `owner` „Owner“ |
| deployments, statefulsets, daemonsets, jobs, cronjobs, services, ingresses | `namespace` „Namespace“ (allNamespacesOnly) |
| nodes | `status` „Status“ · `roles` „Rollen“ |
| events | `namespace` „Namespace“ (allNamespacesOnly) · `type` „Typ“ · `reason` „Grund“ · `objectKind` „Objekt-Art“ |

Keys (alle über die Normalisierung aus C3, leer → `''`):
- `namespace`: `row.ref.namespace`
- `node`: `row.node`
- `status`: `cells.status` als Ganzes (Nodes also auch `Ready,SchedulingDisabled`)
- `owner`: `` `${KIND_INFO[owner.kind].kind} ${owner.name}` `` → „Deployment api“, ohne Owner `''`
- `roles`: `cells.roles` als Ganzes (`control-plane,worker` ist eine Gruppe; jede Zeile steht in genau einer Gruppe)
- `type`: `cells.type`; `reason`: `cells.reason`
- `objectKind`: `row.involved?.kind`, sonst der Teil von `cells.object` vor dem ersten `/` (wie Qualifier `kind:`)

### 1.5 `src/renderer/src/kube-view.ts` (T3)

```ts
import { columnsFor, compileColumnFilters, groupKey, groupRows, GROUP_OPTIONS, type KubeGrouping, type TableItem } from './kube-columns';

export interface Crumb { label: string; query: KubeQuery; text: string;
  /** Column filters of the table left behind; back restores them. Omitted when empty. */ columns?: Record<string, string> }

// KubeViewState, new field after `filters`:
  /** Grouping per kind; a kind without an entry is not grouped. */
  groups: Partial<Record<KubeKind, KubeGrouping>>;

// KubeViewAction, new variants:
  | { type: 'setColumnFilter'; key: string; value: string }   // current kind; C6
  | { type: 'setGroupBy'; groupBy: GroupBy | null }           // current kind; C14
  | { type: 'toggleGroup'; key: string }                      // current kind; C15

export function initialKubeView(namespace: string | null): KubeViewState;   // … groups: {}
/** Filter of the current kind with only the column filters that apply to columnsOf(state) (B7). */
export function activeFilter(state: KubeViewState): KubeFilter;
/** Grouping of the current kind, or null when absent, unknown for the kind, or 'namespace'-only while query.namespace !== null (B7). */
export function activeGrouping(state: KubeViewState): KubeGrouping | null;
/** text.trim() !== '' || chips.length > 0 || some column value with trim() !== ''. */
export function isFiltered(filter: KubeFilter): boolean;
/** Search ∧ chips ∧ column filters over `columns`. Default columns: KIND_COLUMNS[kind]. */
export function compileFilter(kind: KubeKind, filter: KubeFilter, now: number, columns?: readonly ColumnInfo[]): (row: KubeRow) => boolean;
/** state.rows matched by search text AND column filters, chips ignored (input of chipCounts). */
export function searchedRows(state: KubeViewState): KubeRow[];
/** compileFilter(kind, activeFilter(state), now, columnsOf(state)), then sorted (unchanged). Ungrouped. */
export function visibleRows(state: KubeViewState): KubeRow[];
/** = columnsFor(query.kind, query.namespace). */
export function columnsOf(state: KubeViewState): ColumnInfo[];
/** groupRows(rows, kind, activeGrouping?.by ?? null, activeGrouping?.collapsed ?? []). */
export function tableItems(state: KubeViewState, rows?: KubeRow[]): TableItem[];   // rows default: visibleRows(state)
/** Resource rows of tableItems in display order; rows of collapsed groups are not in it. */
export function navigableRows(state: KubeViewState): KubeRow[];
```

`filterOf`, `defaultSort`, `snapshotOf` behalten ihre Signaturen; `snapshotOf` nach C21.

### 1.6 `src/renderer/src/kube-commands.ts` (T4)

```ts
export type CommandId = 'down' | 'up' | 'drill' | 'back' | 'filter' | 'tab' | 'logs' | 'shell' | 'events' | 'yaml'
  | 'describe' | 'previous' | 'menu' | 'restart' | 'scale' | 'delete' | 'toggleDock' | 'popout' | 'help' | 'attention' | 'resetFilter';
export interface KubeCommand { id; group; description; keys; bindings; unavailable? }   // field `command` REMOVED
```

- Entfernt: Einträge `command` (`:`), `kind`, `namespace`, `status`; das Feld `command` bei `help`, `filter`, `restart`, `scale`, `delete`.
- Entfernt: `parseCommandLine`, `ParsedCommand`, `applyStatusCommand`, `completions`, `TAKES_ARGUMENT`, `PLAIN_COMMANDS` und danach unbenutzte Imports (`KUBE_KINDS`, `KUBE_NAME`, `MAX_REPLICAS`, `CHIPS`, `knownChips`, ggf. `KIND_INFO`).
- Geändert:

```ts
{ id: 'filter', group: 'Ansicht', description: 'Name filtern (Events: Meldung)', keys: ['/'], bindings: ['/'],
  unavailable: context => context.state.containersOf ? 'In der Container-Liste gibt es keine Filter.' : undefined },
{ id: 'resetFilter', group: 'Ansicht', description: 'Alle Filter des Reiters zurücksetzen (Gruppierung bleibt)', keys: ['F'], bindings: ['F'] },
```

Alle übrigen Einträge, `bindingOf`, `commandForKey`, `actionReason`, `podNotRunning` bleiben.

### 1.7 Props

- `ResourceTable`: Props unverändert (`state`, `rows`, `dispatch`, `tableRef`, `onMenu`). `rows` ist weiter `visibleRows(state)`; Gruppen berechnet die Tabelle selbst (`tableItems(state, rows)`).
- `HelpOverlay`: Props unverändert.
- DOM-Vertrag zwischen T4 (ClusterView) und T6 (ResourceTable): jedes Filterfeld trägt `data-column-filter="<column.key>"` (B3).

---

## 2. Blocker

**B1 · Wellen bleiben nicht grün, wenn `CommandId` schrumpft.** Fällt `'command'` aus `CommandId`, meldet `tsc` in `ClusterView.tsx` `case 'command'` als unvergleichbar; die Imports `parseCommandLine`, `completions` und `applyStatusCommand` brechen ebenfalls. **Fix:** T4 (Welle 3) besitzt `ClusterView.tsx` vollständig und baut die Befehlszeile dort selbst aus (C24). T6 (Welle 4) fasst `ClusterView.tsx` nicht an. Alle anderen Änderungen sind additiv (`columns?`, `Crumb.columns?`, neue Aktionen), sodass Welle 1 und 2 nichts Bestehendes brechen. Gate nach jeder Welle: `npm run typecheck` und `npm test` grün.

**B2 · Was aus `:` wird (0.7.0-Funktionen).** Die Spec lässt `parseCommandLine` und `completions` „dürfen bleiben“. Ohne UI-Aufrufer wären das tote Exporte, die nur ihre eigenen Tests am Leben halten. **Entscheidung:** löschen (1.6), samt ihrer Tests (2.x unten). Ersatz für jeden Befehl:

| Befehl | Ersatz in 0.8.0 |
|---|---|
| `:pods` … `:events` | Ziffern `1`–`0`, Reiter-Klick |
| `:ns <name>` / `:ns all` | Namespace-Auswahl im Kopf; „alle“ plus Namespace-Spaltenfilter |
| `:restart`, `:delete`, `:scale <n>` | `r`, `Ctrl+d`, `S` (Dialog fragt die Replikate ab), Kontextmenü |
| `:help` | `?` |
| `:filter <suche>` | Spaltenfilter; Kontextmenüs setzen den Textfilter weiterhin |
| `:status …` | Chips (Klick), Kontextmenü „Nur … anzeigen“ |

Bekannte, akzeptierte Lücke: Namespaces ohne Pods stehen nicht in der Auswahl (`overview.ts:90` leitet sie aus Pods ab) und waren bisher nur per `:ns <name>` erreichbar. Umweg: „alle“ und Namespace-Spaltenfilter. In CHANGELOG und README erwähnen (C33).

**B3 · `/` muss ein Feld fokussieren, das `ResourceTable` rendert.** `ClusterView` hat keinen Ref darauf, und eine neue Prop würde T4 und T6 koppeln. **Fix:** DOM-Vertrag `data-column-filter`. `runKey` in `ClusterView`:

```ts
case 'filter': {
  const field = rootRef.current?.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-column-filter="${primaryFilterColumn(state.query.kind)}"]`);
  field?.focus({ preventScroll: true });
  if (field instanceof HTMLInputElement) field.select();
  return;
}
```

`onKeyDown` ruft vorher schon `event.preventDefault()`, also landet das `/` nicht im Feld. Der Kopf der Tabelle ist nie gefenstert, das Feld existiert also immer (außer im Container-Modus, dort ist `/` per `unavailable` gesperrt). Nach Welle 3 und vor Welle 4 findet `querySelector` nichts; das ist ein No-op und kein Fehler.

**B4 · Gruppierung ändert die Anzeigereihenfolge, `move` und `keepSelection` kennen nur `visibleRows`.** Mit „nach Node gruppieren“ stünde die Auswahl bei `j` sonst auf einer Zeile in einer ganz anderen Gruppe. **Fix:**
- `move` arbeitet auf `navigableRows(state)` (Anzeigereihenfolge, ohne zugeklappte Gruppen, ohne Gruppenzeilen). Damit überspringen `j`/`k` Gruppenzeilen und zugeklappte Gruppen.
- `keepSelection`, Modus `'rows'`: Position aus `navigableRows(previous)`, Ziel `navigableRows(next)[min(index, len − 1)]`, sonst `null`; war die Zeile dort nicht (Index −1), wird die Auswahl `null`.
- Die Prüfung „noch sichtbar“ bleibt `visibleRows(next)`.

Ohne Gruppierung ist `navigableRows === visibleRows` (gleiche Reihenfolge). Bestehende Tests bleiben unverändert grün.

**B5 · Auswahl in einer zugeklappten Gruppe.** Spec: „Ist die Auswahl in einer zugeklappten Gruppe, klappt diese auf.“ Das kann nach `jump` (Zeilen kommen erst später), `select` aus einem Menü, `restore` oder einer Verschiebung durch `keepSelection` passieren. **Fix:** eine Invariante am Ende von `kubeViewReducer`. Die Gruppe der ausgewählten Zeile ist nie zugeklappt.

```ts
export function kubeViewReducer(state, action) { return reveal(reduce(state, action)); }   // reduce = today's switch
/** Removes the selected row's group from `collapsed` of the current kind; same state when nothing changes. */
function reveal(state: KubeViewState): KubeViewState;
```

- `reveal` nutzt `activeGrouping(state)`. Ist `collapsed` leer, `selected` null oder die Zeile nicht in `state.rows` (per `refKey`), gibt es denselben State zurück.
- Sonst berechnet es `groupKey(kind, by, row)` und entfernt diesen Schlüssel.
- `toggleGroup` beim **Zuklappen** der Gruppe, in der die ausgewählte, sichtbare Zeile steht, setzt `selected: null, container: null`. Sonst würde `reveal` sofort wieder aufklappen.

**B6 · Fensterung rechnet in Zeilen, die Tabelle hat jetzt Gruppenzeilen und zwei Kopfzeilen.** **Fix (T6):**
- Gefenstert wird über `items = tableItems(state, rows)`: Schwelle `items.length > 200`, Abstandshalter mit `items.length`. Gruppenzeilen sind ebenfalls `ROW_HEIGHT = 24` hoch.
- `selectedIndex = items.findIndex(item => item.type === 'row' && refKey(item.row.ref) === state.selected)`.
- Scroll-Rechnung mit `HEADER_ROWS = inContainers ? 1 : 2`: `rowTop = (selectedIndex + HEADER_ROWS) * ROW_HEIGHT`, die obere Grenze ist `element.scrollTop + HEADER_ROWS * ROW_HEIGHT`.
- Die Filterzeile ist eine zweite `<tr className="kube-filter-row">` in `<thead>`. Ihre `th` sind sticky mit `top: 24px` und genau 24 px hoch.
- Inputs bekommen `size={1}` und `width: 100%`, damit ihre Eigenbreite die Spalten nicht aufbläht.

**B7 · Versteckte Filter bei wechselndem Namespace.** Die Namespace-Spalte existiert nur bei „alle“. Ein gesetzter Namespace-Spaltenfilter oder `groupBy: 'namespace'` würde nach `setNamespace('shop')` unsichtbar weiter filtern; die Tabelle wäre leer, obwohl kein Feld etwas zeigt. **Fix:** nichts löschen, nur nicht anwenden.
- `activeFilter(state)` behält in `columns` nur Schlüssel, die in `columnsOf(state)` vorkommen und eine Feldart ≠ `none` haben; danach leer → `columns` weglassen.
- `activeGrouping(state)` liefert `null` für eine Option mit `allNamespacesOnly` bei `query.namespace !== null` und für eine Option, die das Kind nicht hat.
- `visibleRows`, `searchedRows`, `tableItems`, `reveal`, „N von M“, der Leer-Text und die Zurücksetzen-Knöpfe nutzen nur diese beiden Funktionen.

Zurück bei „alle“ wirken die gespeicherten Werte wieder. `clearFilter` löscht auch die versteckten Werte.

**B8 · `back` würde Spaltenfilter verlieren.** `withText` baut `{ text, chips }` neu, also gingen nach Drill-down und `back` die Spaltenfilter der Quelltabelle verloren. Bei `openQuery` Pods → Pods auf Node gilt das sogar für dasselbe Kind. **Fix:**
- `drill` und `openQuery` speichern `columns: filterOf(state).columns` in der Crumb (nur wenn vorhanden).
- `back` setzt beim Ziel-Kind `text = crumb.text` und `columns = crumb.columns` (beides ersetzt, die Chips bleiben).
- Interner Helfer: `withText(state, kind, text, columns?: Record<string, string>)` setzt `{ text, chips: <bleiben>, ...(columns && Object.keys(columns).length > 0 ? { columns } : {}) }`.
- Aus dem Snapshot wiederhergestellte Crumbs haben keine `columns`.

**B9 · Das Schema in `shared` kann `kube-columns.ts` (Renderer) nicht importieren.** **Fix:** `GROUP_BY_IDS`, `GroupBy` und die Grenzen liegen in `shared/kubernetes.ts` (1.1). Ein Snapshot über den Grenzen würde wie in 0.7.0 (B4 dort) den ganzen Vault ungültig machen. Deshalb hält der Reducer den State in den Grenzen, und `snapshotOf` kürzt zusätzlich (C21).

**B10 · Memo-Abhängigkeiten ohne Spaltenfilter.** `ClusterView` berechnet `rows` mit `useMemo([…, filter.text, filter.chips, …])`, `ResourceTable` die Zähler mit `[state.rows, kind, filter.text, state.now]`. Spaltenfilter würden die Tabelle also nicht aktualisieren. **Fix:**
- T4 ergänzt in `ClusterView` `filter.columns`.
- T6 ergänzt bei den Zählern `filter.columns` und `state.query.namespace` und memoisiert `items` auf `[rows, state.groups, kind, state.query.namespace]`.
- Der Reducer ersetzt `columns` bei jeder Änderung als neues Objekt, damit die Referenz als Abhängigkeit taugt.

**B11 · `toEqual` in bestehenden Tests.** `kube-view.test.ts:413` erwartet `[{ label, query, text: 'x' }]`, die Zeilen 549, 580 und 612 erwarten `{ text: '', chips: [] }`. Ein `columns: {}` oder `columns: undefined` in Crumb oder Filter bräche sie. **Fix:** `columns` wird **nie** leer gespeichert, der Key fehlt dann ganz. Das gilt für `KubeFilter`, `Crumb` und den Snapshot. `undefined` als Wert ist ebenfalls verboten (Spread-Muster wie in 1.5).

**B12 · Import-Zyklus.** `kube-view.ts` importiert `kube-columns.ts`. Würde `kube-columns` für das Alter `formatAge` oder `columnsOf` aus `kube-view` holen, entstünde ein Zyklus. **Fix:** `kube-columns` rechnet das Alter selbst (`now - Date.parse(value)`) und besitzt `columnsFor`. `columnsOf` in `kube-view` delegiert nur noch dorthin.

---

## 3. Korrekturen und Entscheidungen

### Spaltenfilter (T2)

**C1 · Text.** `value.trim()` ist leer → kein Filter. Sonst gilt die Zeile, wenn ein Wert aus `cellValues` den Text enthält (`toLowerCase().includes`). Leere Zelle → kein Treffer. Kein `!`, keine Qualifier, keine Wildcards.

**C2 · Auswahl.** Der Wert `''` heißt „alle“ (kein Filter). `EMPTY_VALUE` trifft Zeilen mit `cellValues(...).length === 0`. Jeder andere Wert trifft bei exakter Gleichheit, mit Groß/Klein, mit einem Element aus `cellValues`. Die Werte stammen aus der Liste und sind deshalb exakt.

**C3 · `cellValues(kind, row, key)` und Normalisierung.**
- `namespace` → `row.ref.namespace`
- `name` → `cells.name ?? row.ref.name`
- nodes `roles` → `cells.roles` an `,` geteilt (nur fürs Filtern; die Gruppe nutzt den ganzen String, 1.4)
- sonst `String(cells[key])`, wenn gesetzt

Jeder Wert wird getrimmt. `''`, `-`, `–` und `—` gelten als leer und fallen weg (Main schreibt `—` für Node ohne Pod, Rollen und Cluster-IP).

**C4 · Zahl.**
- Getrimmt muss die Eingabe `^(>=|<=|>|<|=)?\s*(\d+(?:\.\d+)?)$` erfüllen. Ohne Operator gilt `=`.
- Verglichen wird mit `Number(cellValues(...)[0])`; `NaN` oder eine leere Zelle treffen nie.
- `>-1`, `3x`, `>>3` und `,5` sind ungültig: Sie filtern nicht, das Feld wird rot.

**C5 · Alter.**
- Getrimmt muss die Eingabe `^(<=|>=|<|>)?\s*(\d+)\s*([smhd])$` erfüllen, case-insensitive. Ohne Operator gilt `<` (jünger als).
- `ms = n × {s: 1 000, m: 60 000, h: 3 600 000, d: 86 400 000}`.
- `age = max(0, now − Date.parse(value))`. Ein nicht lesbarer Zeitstempel oder eine leere Zelle treffen nie. Bei `now <= 0` (vor dem ersten Tick) sind Alter-Filter inaktiv.
- `=` gibt es nicht. `<10`, `10min` und `1h30m` sind ungültig.

**C6 · Aktion `setColumnFilter` (T3).**
- `key` muss in `columnsOf(state)` stehen und eine Feldart ≠ `none` haben, sonst bleibt der State gleich.
- `value` wird auf `MAX_COLUMN_FILTER_LENGTH` gekürzt. Ist `value.trim() === ''`, wird der Key gelöscht; werden `columns` dadurch leer, entfällt der Key `columns`.
- Gespeichert wird ungetrimmt (Feld ist kontrolliert).
- Ist der Wert unverändert, bleibt der State gleich (Referenz).
- Sonst `changeFilter` (`keepSelection` Modus `'filter'`).
- Mehr als 12 Schlüssel sind nicht erreichbar, weil höchstens neun Spalten pro Kind filterbar sind.

**C7 · Kein Debounce.** Jeder Anschlag dispatcht (wie 0.7.0). Kosten: ein Filterlauf über höchstens ein paar tausend Zeilen. Wird es je nötig, kommt `useDeferredValue` in der Tabelle infrage, kein Timer.

**C8 · Gültig, aber nicht anwendbar.** Für Spalten mit Feldart `none` (CPU/RAM) gibt es kein Feld. Gespeicherte Schlüssel für unbekannte Spalten ignoriert `compileColumnFilters`. `restore` verwirft sie (C22).

**C9 · `searchedRows` (Zählerbasis der Chips)** = Suchtext ∧ Spaltenfilter (über `activeFilter`). „Fehler 3“ heißt also „3 Fehler unter allem, was Text- und Spaltenfilter durchlassen“.

**C10 · Werte der Auswahlfelder, live.**
- `columnValues(kind, state.rows, key, current)`. Grundlage sind **alle** Zeilen der Query, nicht die gefilterten. Sonst bliebe nach einer Wahl nur noch ein Wert übrig, und man käme nicht mehr weg.
- Memo in T6 auf `[state.rows, kind, key, current]`.
- Ein gewählter Wert, der live verschwindet, bleibt als Option stehen (`selected`). Die Tabelle zeigt dann den Leer-Text (C30).
- Sortierung mit `a.localeCompare(b)`, `EMPTY_VALUE` immer am Ende. Duplikate entfallen.
- Status-Werte kommen nur aus den Daten, es gibt keine festen Listen. Was zu erwarten ist:
  - Pods: jeder `podStatus`-String (`Running`, `Pending`, `CrashLoopBackOff`, `Completed`, `Evicted` …)
  - Jobs: `Failed`, `Complete`, `Suspended`, `Running`, `Pending`
  - Nodes: `Ready`, `NotReady`, jeweils auch mit `,SchedulingDisabled`
  - Services-Typ: `ClusterIP`, `NodePort`, `LoadBalancer`, `ExternalName`
  - Events-Typ: `Normal`, `Warning`
  - Rollen: einzelne Rollen nach dem Teilen

**C11 · Verknüpfung:** Suchtext ∧ Chips ∧ alle aktiven Spaltenfilter (AND). Die Chip-Logik bleibt unverändert.

### Reducer (T3)

**C12 · Regeln je Aktion (ergänzt C9 der 0.7.0-Validierung).**

| Aktion | Spaltenfilter | Gruppierung (`groups`) |
|---|---|---|
| `setKind`, `setNamespace` | bleiben je Kind (ggf. inaktiv, B7) | bleiben je Kind (ggf. inaktiv, B7) |
| `drill` (alle Varianten außer Pod → Container), `openQuery` | Ziel-Kind geleert; Crumb merkt sich die Quelle (B8) | bleiben |
| `back` aus Crumb | Ziel-Kind = `crumb.columns` | bleiben |
| `jump` | Ziel-Kind geleert (`EMPTY_FILTER`) | bleiben; `reveal` klappt die Gruppe des Ziels auf, sobald die Zeilen da sind (B5) |
| `clearFilter` (`F`) | geleert | **bleiben** |
| `restore` | aus Snapshot (C22) | aus Snapshot (C22) |

`clearFilter` ist nur dann ein No-op mit gleicher Referenz, wenn `text === ''`, `chips.length === 0` und kein `columns`-Key vorhanden ist.

**C13 · `isFiltered`** berücksichtigt Spaltenfilter (1.5). UI und Menüs rufen es mit `activeFilter(state)` auf, nicht mit `filterOf(state)`. Ausnahme: das No-op-Kriterium von `clearFilter` und `filter-reset` (C28) arbeitet auf `filterOf` (roh).

**C14 · `setGroupBy`.**
- `null` → Eintrag des Kinds löschen (gleicher State, wenn keiner da ist).
- Eine ID, die nicht in `GROUP_OPTIONS[kind]` steht, oder eine `allNamespacesOnly`-Option bei `query.namespace !== null` → gleicher State.
- Dieselbe ID wie bisher → gleicher State.
- Sonst `{ by, collapsed: [] }`. Die Auswahl bleibt, weil alle Gruppen offen beginnen.

**C15 · `toggleGroup`.**
- Ohne `activeGrouping` oder bei `key.length > MAX_GROUP_KEY_LENGTH` → gleicher State.
- Steht `key` in `collapsed`, wird er entfernt.
- Sonst wird er angehängt: `[...collapsed, key].slice(-MAX_COLLAPSED)` (der älteste fällt heraus).
- Beim Zuklappen gilt außerdem B5: Liegt die ausgewählte Zeile aus `visibleRows` in dieser Gruppe, werden `selected` und `container` null.
- Der Key wird nicht gegen vorhandene Gruppen geprüft (Gruppen kommen und gehen live).

**C16 · `navigableRows` statt `visibleRows`** in `move` und `keepSelection` (B4). `drill` sucht die Zeile weiter in `visibleRows`. `selectedRow` in `kube-commands.ts` und `ClusterView` sucht sie ebenfalls dort (eine zugeklappte Auswahl gibt es wegen B5 nicht).

**C17 · `groupRows`.**
- Zeilen werden in Eingangsreihenfolge (also nach der Tabellensortierung) auf Gruppen verteilt.
- Die Gruppen sind nach Key sortiert (`localeCompare`), `''` steht am Ende. `label = key || EMPTY_VALUE`, `count` = Zeilen der Gruppe.
- Ausgabe: je Gruppe eine `GroupRow`, dann ihre Zeilen. Bei zugeklappter Gruppe (`collapsed.includes(key)`) folgen keine Zeilen.
- Leere Gruppen gibt es nicht. Eine einzige Gruppe bekommt trotzdem ihre Kopfzeile.

**C18 · `now`** bleibt wie in 0.7.0 (nur `tick` setzt es). `tick` wendet `keepSelection(…, 'rows')` an. Das deckt Alter-Filter ab, die mit der Zeit Zeilen ausblenden.

**C19 · Container-Modus.** Aktionen wirken auf `state.query.kind`. Filterzeile, Gruppenzeilen und Chip-Leiste fehlen. `/` ist gesperrt (1.6).

**C20 · Reihenfolge in `reveal`:** Es läuft nach **jeder** Aktion, auch nach `event` (rows), `restore` und `tick`, und hält Referenzgleichheit, wenn nichts zu tun ist.

**C21 · `snapshotOf`.**
- Je Kind (Iteration in `KUBE_KINDS`-Reihenfolge über `filters` und `groups`) ein Eintrag, wenn es Inhalt gibt:
  - `text`: wie bisher, nur wenn nicht leer, gekürzt auf 200
  - `chips`: wie bisher, `slice(0, 16)`
  - `columns`: nur Werte mit `trim() !== ''`, jeweils `slice(0, 100)`, höchstens die ersten 12 Einträge, nur wenn danach nicht leer
  - `groupBy`: wenn eine Gruppierung gesetzt ist
  - `collapsed`: nur wenn nicht leer, `filter(key => key.length <= 300).slice(-50)`
- Ohne Inhalt fehlt der Kind-Eintrag. Ohne einen einzigen Eintrag fehlt `filters` ganz, der Snapshot ist dann byte-gleich mit 0.7.0.
- Gespeichert werden die **rohen** Werte, auch inaktive (B7).

**C22 · `restore`.**
- Je Kind aus dem Snapshot:
  - `text`, `chips` wie bisher.
  - `columns`: nur Schlüssel, die in `columnsFor(kind, null)` stehen und eine Feldart ≠ `none` haben (mit `null`, damit `namespace` erlaubt ist), Werte gekürzt, leere entfernt.
  - `groupBy`: nur, wenn er in `GROUP_OPTIONS[kind]` steht. `collapsed` wird dedupliziert und auf 50 begrenzt, gilt aber nur mit gültigem `groupBy`.
- Kinds ohne Inhalt entfallen.
- Alte Snapshots (0.6.0 ohne `filters`, 0.7.0 nur mit `text`/`chips`) bleiben gültig.
- Bekannt und akzeptiert: Ein 0.8.0-Vault mit `columns` lässt sich in 0.7.0 nicht öffnen (`.strict()`), genauso wie 0.7.0 gegenüber 0.6.0.

### Befehle, Hilfe, ClusterView (T4)

**C23 · Tasten.** `:` ist frei, `commandForKey(':')` ist `undefined`. Ein `:` in der Tabelle tut nichts (kein `preventDefault`, kein Hinweis). `/` hat die Beschreibung aus 1.6. Alle anderen Tasten bleiben unverändert, auch `w` und `F`.

**C24 · `ClusterView.tsx`: die Befehlszeile entfällt.**
- Entfernt: State `prompt`/`line`, `runCommand`, `closePrompt`, `onPromptKeyDown`, `suggestions`, `kindChipIds`, die Imports `parseCommandLine`, `completions`, `applyStatusCommand`, `MAX_SEARCH_LENGTH` und `CHIPS`, außerdem `case 'command'`.
- `case 'filter'` nach B3.
- Der Block `.kube-prompt` enthält nur noch den Hilfe-Knopf. Klasse und Position bleiben, damit `margin-left: auto` greift.
- `rows`-Memo bekommt `filter.columns` (B10).
- Sonst nichts. Die Chips, das Tick und die Menüs bleiben unverändert.

**C25 · Hilfe (`HelpOverlay.tsx`).**
- Titel `Tasten und Filter`, Kommentar oben: „Modal with every key and the filters of the current kind“.
- Die Spalte „Befehle (:)“ entfällt, die Spalte „Suche“ wird durch **„Filter“** ersetzt. Das ergibt zwei Spalten: „Tasten“ (unverändert gebaut, nur ohne `:`-Eintrag) und „Filter“.
- Die Spalte „Filter“ enthält in dieser Reihenfolge (alle Zeilen durchsucht die Hilfesuche):
  1. `<p className="kube-muted">Unter jedem Spaltenkopf steht ein Filterfeld. / springt in das Feld „{Name|Meldung}“.</p>` (Meldung bei Events)
  2. `<dl>` mit je `FILTER_HELP`-Eintrag `<dt><code>{form}</code></dt><dd>{description}<span className="kube-muted"> · Beispiel: <code>{example}</code></span></dd>`
  3. `<p className="kube-muted">{FILTER_NOTE}</p>`
  4. `<h4>Spaltenfilter für {label}</h4>` mit je Spalte aus `columnsOf(state)` mit Feldart ≠ `none`: `<dt>{column.label}</dt><dd>{FILTER_KIND_LABEL[art]}</dd>`
  5. `<h4>Status-Filter für {label}</h4>` mit `<p>{CHIPS[kind].map(c => c.label).join(' · ')}</p>`, ohne Chips `Keine Status-Filter.`
  6. `<h4>Gruppieren für {label}</h4>` mit `<p>{['keine', ...GROUP_OPTIONS[kind].map(o => o.label)].join(' · ')}</p>` und `<p className="kube-muted">{GROUP_NOTE}</p>`
  7. `<h4>Textfilter</h4>` mit `<p className="kube-muted">{TEXT_FILTER_NOTE}</p>`
- Eine Überschrift entfällt, wenn ihre Zeilen weggefiltert sind (wie heute).
- CSS `grid-template-columns: 1fr 1fr` setzt T6.

**C26 · Texte aus `kube-columns.ts` (wörtlich, T2):**

```ts
export const FILTER_HELP: FilterHelpForm[] = [
  { form: 'Text', description: 'Spalte enthält den Text', example: 'api' },
  { form: 'Auswahl', description: 'Spalte hat genau diesen Wert; „(ohne)“ für leere Zellen', example: 'shop' },
  { form: '>3  >=3  <3  <=3  =3  3', description: 'Zahlenspalten vergleichen; eine reine Zahl heißt gleich', example: '>3' },
  { form: '<10m  >1h  <2d', description: 'Alter jünger (<) oder älter (>) als; Einheiten s, m, h, d', example: '<10m' },
];
export const FILTER_NOTE = 'Alle Filter gelten zusammen, Groß- und Kleinschreibung zählen nicht. Ungültige Eingaben sind rot markiert und filtern nicht. F setzt alle Filter des Reiters zurück, die Gruppierung bleibt.';
export const GROUP_NOTE = 'Gruppen sind nach Name sortiert, „(ohne)“ steht am Ende. Ein Klick auf die Gruppenzeile klappt sie auf und zu; j und k überspringen Gruppenzeilen.';
export const TEXT_FILTER_NOTE = 'Kontextmenüs setzen Textfilter wie app=api oder owner:nightly. Sie stehen als Chip „Filter: …“ am Anfang der Leiste und lassen sich mit × entfernen.';
export const FILTER_KIND_LABEL = { text: 'Text', select: 'Auswahl', number: 'Zahl', age: 'Alter' };
```

**C27 · Suchtext (0.7.0) bleibt Modell.**
- Keine UI-Eingabe mehr. Das Menü „Filtern: key=value“ und der CronJob-Drill (`owner:<name>`) setzen ihn wie bisher, mit voller 0.7.0-Syntax.
- `SEARCH_HELP` bleibt im Code, die Hilfe zeigt es nicht mehr.

### Menüs (T5)

**C28 · Hintergrundmenü, erste Gruppe in dieser Reihenfolge:**
1. `filter-reset` „Alle Filter zurücksetzen“ → `view({ type: 'clearFilter' })`, `extra: 'F'`. Deaktiviert mit dem Hint `Kein Filter gesetzt.`, wenn `text === ''`, keine Chips und keine `columns` (roh).
2. `search-clear` **„Textfilter entfernen“** → `view({ type: 'search', text: '' })`, deaktiviert mit dem Hint `Kein Textfilter gesetzt.`.
3. `chips-clear` unverändert.
4. `group-clear` „Gruppierung aufheben“ → `view({ type: 'setGroupBy', groupBy: null })`, deaktiviert mit dem Hint `Keine Gruppierung gesetzt.`, wenn `state.groups[kind]` fehlt.
5. `namespace`, `sort-clear` unverändert.

Das Zeilenmenü bleibt unverändert, ebenso „Filtern: …“, „Nur … anzeigen“ und der CronJob-Eintrag. Kopf-, Gruppen- und Filterzeile bekommen keine eigenen Menüs.

### UI (T6)

**C29 · Filterzeile (`ResourceTable`).**
- `<tr className="kube-filter-row">` als zweite Zeile in `<thead>`, nur außerhalb des Container-Modus. Je Spalte ein `<th>` ohne `onClick`. `onContextMenu` ruft `preventDefault` und `stopPropagation` auf, kein Menü.
- Inhalt je Feldart:
  - **`none`**: leeres `th`.
  - **`select`**: `<select data-column-filter={key} aria-label={`Filter ${column.label}`} value={current}>` mit `<option value="">alle</option>` und `columnValues(...)` als Optionen (`EMPTY_VALUE` zeigt „(ohne)“). `onChange` dispatcht `setColumnFilter`.
  - **`text`, `number`, `age`**: `<span className="kube-col-filter"><input type="text" size={1} data-column-filter={key} aria-label={`Filter ${column.label}`} placeholder="Filter …" maxLength={100} spellCheck={false} autoComplete="off" value={current} aria-invalid={!valid} className={valid ? undefined : 'kube-filter-invalid'} title={…} />{current && <button type="button" className="kube-col-filter-clear" aria-label={`Filter ${column.label} leeren`}>×</button>}</span>`.
- `title` wörtlich:
  - number: `Zahl: >3, >=3, <3, <=3, =3 oder 3`
  - age: `Alter: <10m, >1h, <2d (Einheiten s, m, h, d)`
  - text: kein `title`
  - Bei ungültiger Eingabe stattdessen `Ungültig, filtert nicht. ` plus der jeweilige Text.
- Das Feld zeigt den **rohen** Wert (`filterOf(state).columns?.[key] ?? ''`), nicht den aktiven.
- Tasten im Feld: `Enter` und `Escape` setzen den Fokus auf `tableRef` (Wert bleibt; `preventDefault` und `stopPropagation`). Alles andere tippt.

**C30 · Leer-Text (ersetzt C28 der 0.7.0-Validierung, Fälle 4–6).**
- Die Reihenfolge `trouble` → „Lade …“ → „Keine Einträge.“ bleibt.
- Danach, wenn `isFiltered(activeFilter(state))`: wörtlich `Keine Treffer für die Filter.`, darunter der Knopf `Filter zurücksetzen` (`clearFilter`, Klasse `kube-empty-action`).
- Dahinter, wie bisher unter den Bedingungen von `widenable` (jetzt mit `activeFilter`), `In allen Namespaces suchen`.
- Der Leer-Fall gilt bei `rows.length === 0`, nicht bei `items.length`.

**C31 · Gruppenzeilen.**
- `<tr className="kube-group-row" aria-expanded={!item.collapsed} onClick={() => dispatch({ type: 'toggleGroup', key: item.key })}>`, darin `<td colSpan={columns.length}>{item.collapsed ? '▸' : '▾'} {item.label} · {item.count}</td>`.
- `onContextMenu` öffnet das Hintergrundmenü. Kein Doppelklick, kein `aria-selected`.
- React-Key: `` `group:${item.key}` ``.
- Keine Taste zum Zuklappen. Bekannt, nicht in dieser Stufe.

**C32 · Chip-Leiste.**
- Sie ist außerhalb des Container-Modus **immer** sichtbar, weil dort die Gruppieren-Auswahl wohnt. `aria-label="Filter"`.
- Aufbau von links nach rechts:
  1. Ist `filter.text.trim()` nicht leer: `<span className="kube-chip kube-text-chip">Filter: {text.trim()} <button type="button" className="kube-text-chip-clear" aria-label="Textfilter entfernen">×</button></span>`. Der Knopf dispatcht `search` mit `''`.
  2. Die Chips wie bisher.
  3. `<span className="kube-chipbar-end">`:
     - Bei `isFiltered(activeFilter(state)) && !state.loading`: `` `${rows.length} von ${state.rows.length}` `` und der Knopf „Zurücksetzen“, jetzt mit `title="Alle Filter zurücksetzen (F)"`.
     - Danach immer `<label className="kube-group-by">Gruppieren nach <select aria-label="Gruppieren nach" value={activeGrouping(state)?.by ?? ''}>`.
- Optionen der Gruppieren-Auswahl:
  - `<option value="">keine</option>`
  - je `GROUP_OPTIONS[kind]` eine Option. Bei `allNamespacesOnly && query.namespace !== null` ist sie `disabled` und lautet wörtlich `Namespace – nur bei allen Namespaces`.
- `onChange` dispatcht `setGroupBy` (`''` → `null`).
- „N von M“ zählt nur Ressourcen-Zeilen und ignoriert zugeklappte Gruppen.

**C33 · CSS (`kubernetes-ui.css`):**
- Neu:
  - `.kube-filter-row th { top: 24px; padding: 0 2px; cursor: default; }`
  - `.kube-col-filter { position: relative; display: block; }`
  - `.kube-filter-row input, .kube-filter-row select { width: 100%; min-width: 0; height: 20px; box-sizing: border-box; padding: 0 14px 0 4px; font-size: 11px; }`
  - `.kube-col-filter-clear, .kube-text-chip-clear { position: absolute; right: 1px; top: 1px; min-height: 0; height: 18px; padding: 0 3px; border: 0; background: none; color: var(--ui-muted); }` (beim Text-Chip `position: static`)
  - `.kube-filter-invalid { border-color: var(--ui-danger); }`
  - `.kube-group-row td { background: var(--ui-raised); color: var(--ui-muted); cursor: pointer; font-weight: 500; }`
  - `.kube-group-by { display: inline-flex; align-items: center; gap: 4px; }`
  - `.kube-group-by select { width: auto; height: 22px; padding: 0 4px; font-size: 11px; }`
- `.kube-help-columns` bekommt `1fr 1fr`.
- Entfernt: `.kube-prompt-input`, `.kube-prompt-hint`, `.kube-suggest`, `.kube-suggest button`, `.kube-prompt-clear`.
- Die `th` der ersten Kopfzeile bleiben sticky mit `top: 0`.

### Doku und Version (T7)

**C34 · Doku.**
- `npm run version:minor` → 0.8.0 (`package.json` und `package-lock.json`).
- CHANGELOG, oben:

```
## [0.8.0] – 2026-10-18

- Kubernetes-Tabelle mit Spaltenfiltern: Text (enthält), Auswahl für Namespace, Status, Typ, Node und Rollen, Zahlen (`>3`, `<=5`, `3`) und Alter (`<10m`, `>1h`, `<2d`). `/` springt in den Namensfilter (Events: Meldung), `F` setzt alle Filter des Reiters zurück.
- „Gruppieren nach“ (z. B. Namespace, Node, Status, Owner) mit auf- und zuklappbaren Gruppen; Filter und Gruppierung bleiben je Reiter und im Workspace erhalten.
- Die Befehlszeile oben rechts (`/`-Suche und `:`-Befehle wie `:ns`, `:filter`, `:status`) entfällt. Namespaces ohne Pods erreicht man über „alle“ und den Namespace-Filter. Textfilter aus dem Kontextmenü (z. B. `app=api`) erscheinen als Chip „Filter: …“.
```

- README, Absatz ab Zeile 152: Den `:`-Satz und den `/`-Such-Absatz ersetzen. Inhalt: Spaltenfilter mit den vier Feldarten, `/`, Chips und `w`, `F`, Gruppieren, der Textfilter-Chip aus Menüs, Persistenz je Reiter. Die Jobs/Evicted/Events-Sortierung bleibt.
- `…integration-design.md`: In der Tastentabelle (Zeile 191–195) wird `/` zu „Name filtern (Events: Meldung)“, `F` zu „Alle Filter des Reiters zurücksetzen“, und die Zeile `:` entfällt. Zeile 128 und der Absatz „Befehle:“ (206–207) bekommen einen Hinweis „entfällt ab 0.8.0, siehe `…column-filters-validation.md`“. Die Hilfe beschreibt zwei Spalten „Tasten“ und „Filter“.
- `…search-filter-design.md` und `…search-filter-validation.md` bekommen oben je einen Satz: „Ab 0.8.0 entfallen Suchfeld, `:filter`, `:status` und die Befehlszeile; der Suchtext bleibt als Textfilter aus Menüs. Siehe `…column-filters-validation.md`.“
- `…column-filters-design.md` bekommt im Kopf: „Bindend ist `-validation.md`.“

---

## 4. Wellen und Tasks

| Task | Welle | Dateien (exakt, disjunkt je Welle) | Vertrag | Blocker/Korrekturen |
|---|---|---|---|---|
| **T1** Shared-Typen + Schema | 1 | `src/shared/kubernetes.ts`, `src/shared/kube-filter.ts`, `src/shared/kubernetes-schema.ts`, `src/shared/kubernetes-schema.test.ts` | 1.1–1.3 | B9, B11, C22 (Schema-Teil) |
| **T2** Spaltenmodell (rein) | 1 | `src/renderer/src/kube-columns.ts`, `src/renderer/src/kube-columns.test.ts` | 1.4 | B12, C1–C5, C8, C10, C17, C26 |
| **T3** Reducer | 2 | `src/renderer/src/kube-view.ts`, `src/renderer/src/kube-view.test.ts` | 1.5 | B4, B5, B7, B8, B11, C6, C9, C12–C22 |
| **T4** Befehle, Hilfe, ClusterView | 3 | `src/renderer/src/kube-commands.ts`, `src/renderer/src/kube-commands.test.ts`, `components/kubernetes/HelpOverlay.tsx`, `components/kubernetes/ClusterView.tsx` | 1.6, 1.7 | B1, B2, B3, B10 (ClusterView), C23–C27 |
| **T5** Menüs | 3 | `src/renderer/src/kube-menus.ts`, `src/renderer/src/kube-menus.test.ts` | nutzt 1.5 | C28 |
| **T6** Tabelle + CSS | 4 | `components/kubernetes/ResourceTable.tsx`, `src/renderer/src/kubernetes-ui.css` | nutzt 1.4, 1.5, DOM-Vertrag 1.7 | B6, B7, B10 (Tabelle), C19, C29–C33 |
| **T7** Doku + Version | 5 | `README.md`, `CHANGELOG.md`, `package.json`, `package-lock.json`, `…integration-design.md`, `…search-filter-design.md`, `…search-filter-validation.md`, `…column-filters-design.md` | – | C34 (CHANGELOG und Version im selben Task, sonst bricht `version.test.ts`) |

**Hinweise je Welle:**
- **Welle 1:** T2 importiert aus `shared/kubernetes` nur `KIND_COLUMNS`, `KIND_INFO` und **Typen** (`GroupBy`, `ColumnInfo`, `KubeKind`, `KubeRow`). `vitest` für T2 läuft deshalb auch, bevor T1 fertig ist. `tsc` ist erst am Gate verbindlich.
- **Welle 2:** Kein anderer Code ruft die neuen Aktionen auf. `ClusterView` und `ResourceTable` kompilieren unverändert, weil alle neuen Felder optional sind oder aus `initialKubeView` kommen.
- **Welle 3:** T4 und T5 teilen keine Datei. T5 kompiliert gegen das schrumpfende `CommandId`, weil `kube-menus.ts` nur `drill`, `events`, `yaml`, `describe`, `logs`, `previous`, `shell`, `popout`, `delete`, `restart`, `scale` und `toggleDock` nutzt.
- **Welle 4:** Nur T6. Erst danach gibt es die Felder, auf die `/` zielt (B3).

**Testpflicht (über die Spec hinaus):**
- **T1** (`kubernetes-schema.test.ts`):
  - akzeptiert einen 0.7.0-Snapshot, einen mit `columns`/`groupBy`/`collapsed` und `collapsed: ['']`
  - lehnt ab: 13 Spaltenfilter, einen Wert mit 101 Zeichen, den Key `image:app`, `groupBy: 'foo'` und 51 zugeklappte Gruppen
- **T2** (`kube-columns.test.ts`):
  - die Feldart-Tabelle aus 1.4 komplett
  - `columnsFor` mit und ohne Namespace
  - C3 (`—` ist leer, Rollen werden geteilt)
  - Zahl: `>3`, `>= 3`, `3`, `=0`, `2.5`, ungültig `3x`/`>>3`/`-1`/`''` → `null`
  - Alter: `<10m`, `>1h`, `<=2d`, `30s`, `10M`, ohne Operator, ungültig `<10`/`1h30m`/`=5m`; `now = 0` macht inaktiv; Zukunft gilt als Alter 0
  - Auswahl mit `EMPTY_VALUE`
  - `isValidColumnFilter`
  - `columnValues`: eindeutig, sortiert, `(ohne)` am Ende, `selected` bleibt drin
  - `groupRows`: Reihenfolge, `(ohne)` am Ende, zugeklappt mit Anzahl und ohne Zeilen, Sortierung innerhalb erhalten, `null` und unbekannte ID unverändert
  - Owner-Label „Deployment api“, `objectKind` aus `involved` und aus `cells.object`
- **T3** (`kube-view.test.ts`):
  - C6: ungültiger Key, Kürzung, Leerwert löscht den Key, Referenzgleichheit
  - Persistenz je Reiter über `setKind`
  - B7: der Namespace-Filter wirkt nach `setNamespace('shop')` nicht mehr und nach `setNamespace(null)` wieder
  - B8: `drill` und `back` stellen die Spalten wieder her
  - `jump` und `openQuery` leeren das Ziel
  - `F` behält die Gruppierung
  - C14, C15 (Kappung bei 50)
  - B5: Zuklappen der Auswahl-Gruppe setzt die Auswahl auf null; `jump`, dann Rows-Event klappt die Zielgruppe auf
  - B4: `move` in gruppierter Reihenfolge und über zugeklappte Gruppen hinweg; `keepSelection` im Modus `'rows'` nach Anzeigeposition
  - C21/C22: ein Snapshot über den Grenzen besteht das Schema; Restore mit altem Snapshot; unbekannte Spalte und unbekannter `groupBy` fallen weg
  - B11: `filterOf` ohne `columns`-Key nach `clearFilter`
- **T4** (`kube-commands.test.ts`):
  - Die Tests „parses command lines“, „completes commands and namespaces“, „parses :filter …“, „parses :status“, „applies :status per group“ und „completes :status …“ werden gelöscht. In „maps the spec hotkeys“ wird `commandForKey(':')` zu `undefined`.
  - Neu: `/` hat die neue Beschreibung und ist im Container-Modus gesperrt; jeder Eintrag hat mindestens eine Taste (`keys.length > 0`, `bindings.length > 0`). Der bestehende Test auf doppelt belegte Tasten bleibt.
- **T5** (`kube-menus.test.ts`):
  - Die Erwartungen in „lists the background menu“ (Zeile 599 ff.), „enables search-clear and chips-clear independently“ (607 ff.) und der Test um Zeile 630 werden auf C28 umgestellt. Neue Labelliste: `['Alle Filter zurücksetzen', 'Textfilter entfernen', 'Status-Filter leeren', 'Gruppierung aufheben', 'Alle Namespaces', 'Sortierung aufheben', '---', 'Hilfe…']`.
  - Neu: `filter-reset` ist mit nur einem Spaltenfilter aktiv; `group-clear` dispatcht `setGroupBy` mit `null`.
- **T6:** Es gibt keine Komponententests. Die Manuell-Liste der Spec gilt, dazu:
  - `/` in Events
  - ungültige Zahl rot
  - Gruppe mit Auswahl zuklappen
  - mehr als 200 Zeilen mit Gruppen scrollen
  - `F` behält die Gruppierung
  - Text-Chip aus „Filtern: app=api“ entfernen

**Gate nach jeder Welle:** `npm run typecheck` und `npm test` grün, bevor die nächste startet. Am Ende zusätzlich `npm run check:version`.
