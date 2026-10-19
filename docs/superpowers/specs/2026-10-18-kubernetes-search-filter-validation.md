# Kubernetes – Suchen und Filtern – Validierung

Stand: 2026-10-18 · Validierung: Opus · Bezug: `2026-10-18-kubernetes-search-filter-design.md` (Spec) und `docs/superpowers/plans/2026-10-18-kubernetes-search-filter.md` (Plan)

**Dieses Dokument ist bindend und hat Vorrang vor Plan und Spec.** Wo es schweigt, gilt die Spec. Der Umfang aus „Umfang (festgelegt)“ der Spec bleibt unverändert (drin: `F`, `:filter`; nicht drin: Highlighting, `age<`, „Rollout läuft“, Ingress „Ohne Adresse“, „Ähnliche ausblenden“, Problem-Banner „In der Tabelle zeigen“, Reiter-Punkt).

**Verdict: ready after corrections.** 6 Blocker (B1–B6), 32 Korrekturen/Entscheidungen (C1–C32), Vertrag in Abschnitt 1, Zuordnung je Task in Abschnitt 4.

---

## 1. Vertrag (exaktes TypeScript)

Kommentare englisch, UI-Texte deutsch und wörtlich wie hier. Namen sind verbindlich, damit parallele Tasks ohne Rückfrage gegeneinander bauen.

### 1.1 `src/shared/kube-filter.ts` (Task 1, rein, keine Imports außer `./kubernetes`)

```ts
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
export const QUALIFIERS: Record<KubeKind, QualifierDef[]>;
/** Numeric fields for `name(>|>=|<|<=|=)digits`, read via Number(row.cells[name]). */
export const NUMERIC_FIELDS: Partial<Record<KubeKind, string[]>>; // { pods: ['restarts'], events: ['count'] }

/** All free-text fields of the row, lowercase, joined with '\n'; cached in a WeakMap<KubeRow, string>. */
export function searchText(row: KubeRow): string;

/** Predicate for the search text only (no chips). Empty/whitespace text matches everything. Memoised for the last (kind, text). */
export function compileSearch(kind: KubeKind, text: string): (row: KubeRow) => boolean;

export interface SearchForm { form: string; description: string; example: string }
export interface SearchHelp {
  syntax: string;
  forms: SearchForm[];
  note: string;
  qualifiers: Record<KubeKind, { name: string; description: string }[]>;   // derived from QUALIFIERS
  numeric: Partial<Record<KubeKind, string[]>>;                            // = NUMERIC_FIELDS
}
export const SEARCH_HELP: SearchHelp;
```

`compileFilter` liegt **nicht** hier (siehe B1), sondern in `kube-view.ts`.

**Freitextfelder (`searchText`)** je `row.ref.kind`, Werte, die fehlen oder leer sind, entfallen:

| Kind | Felder |
|---|---|
| pods | `ref.name`, `ref.namespace`, `cells.status`, `row.node`, alle `cells['image:*']`, `owner.name`, `row.ip` |
| deployments, statefulsets, daemonsets | `ref.name`, `ref.namespace`, `cells.image` |
| jobs | `ref.name`, `ref.namespace`, `cells.status`, `owner.name` |
| cronjobs | `ref.name`, `ref.namespace`, `cells.schedule` |
| services | `ref.name`, `ref.namespace`, `cells.type`, `cells.clusterIp`, `cells.ports` |
| ingresses | `ref.name`, `ref.namespace`, `cells.hosts`, `cells.address` |
| nodes | `ref.name`, `cells.status`, `cells.roles`, `cells.version`, `row.ip` |
| events | `cells.reason`, `cells.object`, `cells.message`, `ref.namespace`, `cells.type` (**nicht** `ref.name`) |

Labels stehen nie im Freitext.

**`QUALIFIERS`** (Name · `description` wörtlich · Werte):

| Kind | Qualifier |
|---|---|
| pods | `ns` · „Namespace“ · `ref.namespace`; `node` · „Node“ · `row.node`; `status` · „Status“ · `cells.status`; `image` · „Image eines Containers“ · alle `cells['image:*']`; `owner` · „Besitzer (ganzer Name)“ · `owner.name`, **exact**; `ip` · „Pod-IP“ · `row.ip`; `container` · „Container-Name“ · `row.containers` |
| deployments, statefulsets, daemonsets | `ns` · „Namespace“; `image` · „Image“ · `cells.image` |
| jobs | `ns` · „Namespace“; `status` · „Status“ · `cells.status`; `owner` · „Besitzer (ganzer Name)“ · `owner.name`, **exact** |
| cronjobs | `ns` · „Namespace“; `schedule` · „Zeitplan“ · `cells.schedule` |
| services | `ns` · „Namespace“; `type` · „Typ“ · `cells.type`; `ip` · „Cluster-IP“ · `cells.clusterIp`; `port` · „Port“ · `cells.ports` |
| ingresses | `ns` · „Namespace“; `host` · „Host“ · `cells.hosts`; `address` · „Adresse“ · `cells.address` |
| nodes | `role` · „Rolle“ · `cells.roles`; `ip` · „Interne IP“ · `row.ip`; `version` · „Kubelet-Version“ · `cells.version` |
| events | `ns` · „Namespace“; `reason` · „Grund“ · `cells.reason`; `object` · „Objekt (Kind/Name)“ · `cells.object`; `type` · „Typ (Normal, Warning)“ · `cells.type`; `kind` · „Kind des Objekts“ · `involved.kind`, sonst Teil vor `/` von `cells.object` |

**`SEARCH_HELP`** (wörtlich):

```ts
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
```

### 1.2 `src/shared/kube-status.ts` (Task 2, rein, importiert nur `./kubernetes`)

```ts
import type { KubeKind, KubeRow, RowTone } from './kubernetes';

export type ChipGroup = 'attention' | 'status' | 'type' | 'trait' | 'time';
export interface ChipDef {
  id: string;        // lowercase English, stable; also the :status value
  label: string;     // German UI text
  group: ChipGroup;  // OR within a group, AND between groups
  matches: (row: KubeRow, now: number) => boolean;
}
/** Order in each array = order in the chip bar and the canonical order of stored ids. */
export const CHIPS: Record<KubeKind, ChipDef[]>;

/** Pod status partition (one source for main and renderer). */
export const WARN_STATES: ReadonlySet<string>;   // Pending, ContainerCreating, PodInitializing
export const MUTED_STATES: ReadonlySet<string>;  // Completed, Terminating
/** muted for MUTED_STATES, warn for WARN_STATES, 'Running' → notReady ? warn : ok, every other status → bad. */
export function podTone(status: string, notReady: boolean): RowTone;

export type JobStatus = 'Failed' | 'Complete' | 'Suspended' | 'Running' | 'Pending';
/** Failed → bad, Complete → ok, Suspended → muted, Running/Pending → warn. */
export function jobTone(status: JobStatus): RowTone;

/** 'attention' where CHIPS[kind] has it, 'warning' for events, else null (cronjobs, services, ingresses). */
export function attentionChip(kind: KubeKind): string | null;
/** Chip for the row menu „Nur <label> anzeigen“ (C24); undefined = no entry. */
export function primaryChip(kind: KubeKind, row: KubeRow, now: number): ChipDef | undefined;
/** Known ids of CHIPS[kind] only, deduplicated, in CHIPS order. */
export function knownChips(kind: KubeKind, ids: readonly string[]): string[];
/** Predicate for active chips: OR within a group, AND between groups; no ids = everything. Unknown ids are ignored. */
export function compileChips(kind: KubeKind, ids: readonly string[], now: number): (row: KubeRow) => boolean;
/** Per chip id of CHIPS[kind]: how many of `rows` it matches (callers pass the rows the search text matches; chips are ignored). Every id is present, 0 included. */
export function chipCounts(kind: KubeKind, rows: readonly KubeRow[], now: number): Record<string, number>;
```

**`CHIPS`** (Reihenfolge, ID, Label wörtlich, Gruppe, Prädikat):

| Kind | Chips |
|---|---|
| pods | `attention` „Auffällig“ attention `tone ∈ {warn,bad}` · `running` „Läuft“ status `cells.status === 'Running'` · `waiting` „Wartet“ status `WARN_STATES.has(cells.status)` · `failed` „Fehler“ status `tone === 'bad'` · `completed` „Abgeschlossen“ status `cells.status === 'Completed'` · `terminating` „Beendet“ status `cells.status === 'Terminating'` · `notready` „Nicht bereit“ trait: `ready` als `a/b` geparst, `a < b`, und `status ∉ {Completed, Terminating}` · `restarts` „Mit Neustarts“ trait `Number(cells.restarts) > 0` |
| deployments, statefulsets, daemonsets | `attention` „Auffällig“ · `complete` „Vollständig“ status `tone === 'ok'` · `incomplete` „Nicht vollständig“ status `tone === 'warn'` · `zero` „Auf 0“ status `tone === 'muted'` |
| jobs | `attention` „Auffällig“ · `running` „Läuft“ status `cells.status ∈ {Running, Pending}` · `success` „Erfolgreich“ status `=== 'Complete'` · `failed` „Fehlgeschlagen“ status `=== 'Failed'` |
| cronjobs | `active` „Aktiv“ status `row.suspended !== true` · `suspended` „Angehalten“ status `row.suspended === true` |
| services | `clusterip` „ClusterIP“ · `nodeport` „NodePort“ · `loadbalancer` „LoadBalancer“ · `externalname` „ExternalName“ (alle type, `cells.type === 'ClusterIP'` …) · `headless` „Headless“ trait `cells.clusterIp === 'None'` · `noselector` „Ohne Selector“ trait `Object.keys(row.selector ?? {}).length === 0` |
| ingresses | keine (`[]`) |
| nodes | `attention` „Auffällig“ · `notready` „Nicht bereit“ trait `String(cells.status).startsWith('NotReady')` · `cordoned` „Gesperrt“ trait `row.unschedulable === true` · `pressure` „Druck“ trait `(row.pressure ?? []).length > 0` · `controlplane` „Control-Plane“ trait: `String(cells.roles).split(',')` enthält `control-plane` oder `master` |
| events | `warning` „Warning“ type `cells.type === 'Warning'` · `normal` „Normal“ type `=== 'Normal'` · `5m` „Letzte 5 min“ time · `15m` „Letzte 15 min“ time; Zeit: `t = Date.parse(String(cells.last))`, `Number.isFinite(t) && now - t <= 5·60·1000` bzw. `15·60·1000` (Zukunft zählt als neu) |

### 1.3 `src/shared/kubernetes.ts` und `kubernetes-schema.ts` (Task 2)

```ts
// KubeRow, new optional field after `unschedulable`:
  /** Nodes: MemoryPressure / DiskPressure / PIDPressure conditions that are True; always set on node rows. */
  pressure?: string[];

// KIND_COLUMNS.jobs becomes:
  jobs: [{ key: 'name', label: 'Name' }, { key: 'completions', label: 'Abgeschlossen' }, { key: 'status', label: 'Status' },
    { key: 'lastRun', label: 'Letzter Lauf', age: true }, { key: 'age', label: 'Alter', age: true }],

/** Saved filter of one kind; both fields optional, absent = empty. */
export interface KubeFilterSnapshot { text?: string; chips?: string[] }
export interface KubeViewSnapshot { query: KubeQuery; crumbs: string[]; selected?: string; dock: DockMode;
  filters?: Partial<Record<KubeKind, KubeFilterSnapshot>> }
```

```ts
// kubernetes-schema.ts (zod 4.6.5: z.record with an enum key is exhaustive, so partialRecord – see B3)
const KubeFilterSnapshotSchema = z.object({
  text: z.string().max(200).optional(),
  chips: z.array(z.string().max(40)).max(16).optional(),
}).strict();
export const KubeViewSnapshotSchema: z.ZodType<KubeViewSnapshot> = z.object({ query: KubeQuerySchema, crumbs: z.array(z.string().max(300)).max(8),
  selected: z.string().max(600).optional(), dock: DockModeSchema,
  filters: z.partialRecord(z.enum(KUBE_KINDS), KubeFilterSnapshotSchema).optional() }).strict();
```

Lässt sich `z.partialRecord` mit der Typannotation nicht in Deckung bringen, ist der Ersatz `z.object(Object.fromEntries(KUBE_KINDS.map(kind => [kind, KubeFilterSnapshotSchema.optional()]))).strict()` mit einem Cast auf denselben Typ. Unbekannte Kind-Keys bleiben ein Validierungsfehler.

### 1.4 `src/renderer/src/kube-view.ts` (Task 4)

```ts
import { compileSearch, EMPTY_FILTER, MAX_SEARCH_LENGTH, type KubeFilter } from '../../shared/kube-filter';
import { compileChips, knownChips } from '../../shared/kube-status';

export interface Crumb { label: string; query: KubeQuery; /** Search text of the table left behind; back restores it. */ text: string }

// KubeViewState: `filter: string` is REMOVED, replaced by
  filters: Partial<Record<KubeKind, KubeFilter>>;
  /** Unix ms for time chips and ages; set only by 'tick'. 0 until the first tick. */
  now: number;

// KubeViewAction: `{ type: 'filter'; text: string }` is REMOVED; new variants:
  | { type: 'search'; text: string }        // search text of the current kind, cut to MAX_SEARCH_LENGTH
  | { type: 'toggleChip'; id: string }      // unknown id for the current kind: state unchanged
  | { type: 'setChips'; ids: string[] }     // replaces all chips of the current kind; knownChips() applied
  | { type: 'clearFilter' }                 // text and chips of the current kind; no-op returns the same state
  | { type: 'tick'; now: number }

export function initialKubeView(namespace: string | null): KubeViewState;   // filters: {}, now: 0
/** Filter of the current kind (state.query.kind), EMPTY_FILTER if none. */
export function filterOf(state: KubeViewState): KubeFilter;
export function isFiltered(filter: KubeFilter): boolean;                      // text.trim() !== '' || chips.length > 0
/** Search ∧ chips. Search part memoised in compileSearch. */
export function compileFilter(kind: KubeKind, filter: KubeFilter, now: number): (row: KubeRow) => boolean;
/** state.rows matched by the search text only (input of chipCounts). */
export function searchedRows(state: KubeViewState): KubeRow[];
/** Filtered by compileFilter, then sorted (unchanged algorithm). */
export function visibleRows(state: KubeViewState): KubeRow[];
/** KIND_COLUMNS[kind], plus { key: 'namespace', label: 'Namespace' } after 'name' (index 0 if there is no 'name') when query.namespace === null and KIND_INFO[kind].namespaced. */
export function columnsOf(state: KubeViewState): ColumnInfo[];
/** events: { key: 'last', descending: true }; every other kind: null. */
export function defaultSort(kind: KubeKind): { key: string; descending: boolean } | null;
export function snapshotOf(state: KubeViewState): KubeViewSnapshot;          // see C14
```

`matchesFilter` entfällt (ersetzt durch `compileSearch`). `visibleRows` und `sortValue` lösen Spalten über `columnsOf(state)` auf; `sortValue` liest für `namespace` `row.ref.namespace ?? ''`.

### 1.5 `src/renderer/src/kube-commands.ts` (Task 5)

```ts
export type CommandId = /* existing ids */ | 'attention' | 'resetFilter' | 'status';

// Existing entry 'filter' ('/') gets a description and a command:
{ id: 'filter', group: 'Ansicht', description: 'Suchen: Freitext, Qualifier, Labels', keys: ['/'], bindings: ['/'],
  command: { name: 'filter', syntax: ':filter <suche>', example: ':filter status:crash' } },
{ id: 'attention', group: 'Ansicht', description: 'Nur auffällige Zeilen ein/aus (Events: Warning)', keys: ['w'], bindings: ['w'],
  unavailable: context => attentionChip(context.state.query.kind) ? undefined : 'Dieser Reiter hat keinen Chip „Auffällig“.' },
{ id: 'resetFilter', group: 'Ansicht', description: 'Suche und Status-Filter des Reiters zurücksetzen', keys: ['F'], bindings: ['F'] },
{ id: 'status', group: 'Ansicht', description: 'Status-Filter setzen', keys: [], bindings: [],
  command: { name: 'status', syntax: ':status <id>[,<id>] | :status alle', example: ':status failed,waiting' } },

export type ParsedCommand = /* existing */
  | { id: 'filter'; text: string }               // text after the command name, trimmed; '' clears
  | { id: 'status'; chips: string[] | 'all' };   // ids lowercased, split on ',', trimmed, empty parts dropped

/** New chip list for `:status`: replaces the chips of the groups the ids belong to, keeps other groups; 'all' → []. */
export function applyStatusCommand(kind: KubeKind, current: readonly string[], chips: string[] | 'all'): string[] | { error: string };

/** Third parameter optional: chip ids of the current kind for `:status` completion. */
export function completions(prefix: string, namespaces: string[], chipIds?: string[]): string[];
```

`PLAIN_COMMANDS` und `TAKES_ARGUMENT` bekommen `filter` und `status`.

### 1.6 Weitere Exporte

- `kube-menus.ts` (Task 6): keine neuen Typen. Neue Menü-IDs: `only-<chipId>`, `search-clear`, `chips-clear` (ersetzt `filter-clear`).
- `HelpOverlay.tsx` (Task 5): Props unverändert.
- `ResourceTable.tsx`/`ClusterView.tsx` (Task 7): Props von `ResourceTable` unverändert (`state`, `rows`, `dispatch`, `tableRef`, `onMenu`).

---

## 2. Blocker

**B1 · `compileFilter` braucht Chips aus Task 2, Task 1 läuft aber parallel.** Die Spec legt `compileFilter(kind, filter, now)` in `kube-filter.ts` (T1) ab. Die Funktion bräuchte `CHIPS` aus `kube-status.ts` (T2, dieselbe Welle). Damit würde T1 nicht kompilieren. **Fix:** T1 liefert nur `compileSearch(kind, text)`, T2 liefert `compileChips(kind, ids, now)`. `compileFilter` setzt beides in `kube-view.ts` (T4) zusammen. `kube-filter.ts` und `kube-status.ts` importieren sich nie gegenseitig.

**B2 · T4 entfernt `state.filter` und die Aktion `filter`. Damit sind nach Welle 2 `npm run typecheck` und `npm test` rot.** Betroffen sind `kube-menus.ts:168,260,519-525`, `kube-menus.test.ts:16 ff.,147,330,600-609`, `ClusterView.tsx:241,283,353-371` und `ResourceTable.tsx:159`. **Fix:** T4 macht in diesen vier Dateien die mechanische Umstellung und sonst nichts:
- `{ type: 'filter', text }` → `{ type: 'search', text }`
- `state.filter` → `filterOf(state).text`
- CronJob-Menü (`kube-menus.ts:260`): `{ type: 'search', text: \`owner:${name}\` }`, gleich wie der Reducer-Drill (C9). Tests entsprechend anpassen.
- `state({ filter: 'api' })` → `state({ filters: { pods: { text: 'api', chips: [] } } })`

Die Labels der Menüeinträge bleiben in T4 unverändert. Die neuen Einträge und Texte baut T6, die UI baut T7. Nach jeder Welle müssen `npm run typecheck` und `npm test` grün sein.

**B3 · zod 4: `z.record(z.enum(KUBE_KINDS), …)` ist erschöpfend.** Damit würde jeder Snapshot abgelehnt, der nicht alle zehn Kinds enthält. **Fix:** `z.partialRecord` wie in 1.3.

**B4 · Ein Snapshot über den Grenzen macht den ganzen Vault ungültig.** `KubeViewSnapshotSchema` hängt über `kubeTabs` an `WorkspaceSchema`, und dieses hängt an `workspaces: z.array(WorkspaceSchema)` (`vault/schema.ts:133,217`). Ein Suchtext mit 201 Zeichen oder 17 Chip-IDs würde also die Validierung des Vaults brechen. **Fix:**
- Der Reducer (`search`) kürzt auf `MAX_SEARCH_LENGTH`.
- `setChips`/`toggleChip`/`restore` lassen nur `knownChips` zu (höchstens 8 je Kind).
- `snapshotOf` kürzt zusätzlich defensiv: `text.slice(0, 200)` und `chips.slice(0, 16)`.
- Das Suchfeld bekommt `maxLength={200}`.
- Test in T4: Ein Snapshot aus einem Zustand mit 300 Zeichen besteht `KubeViewSnapshotSchema`.

**B5 · Die Namespace-Spalte ließe sich nicht sortieren.** `visibleRows` sucht die Sortierspalte in `KIND_COLUMNS` (`kube-view.ts:102`). Eine Spalte, die nur `ResourceTable` einfügt, wird dort nicht gefunden, und ein Klick auf die Spalte täte nichts. **Fix:** `columnsOf(state)` in T4 (1.4). `visibleRows`, `ResourceTable` (T7) und das Kopfzeilenmenü nutzen diese eine Quelle.

**B6 · „`tone bad` ⇔ Chip `failed`“ und „jeder Status in höchstens einem Status-Chip“ lassen sich mit den heutigen Mengen nicht erfüllen.** Drei Lücken:
- `CreateContainerError` (Spec 2.2), `RunContainerError` und `ErrImageNeverPull` stehen in keiner Menge und werden grün. Mit aktivem Status-Chip wären sie unsichtbar.
- `Unknown` ist `ok`.
- `BAD_STATES` als Positivliste lässt jeden neuen Grund durchfallen.

**Fix:** Die Pod-Zustände werden eine Partition in `kube-status.ts` (`podTone`, 1.2): `MUTED_STATES` → muted, `WARN_STATES` → warn, `Running` → ok/warn, **alles andere → bad**. `BAD_STATES` entfällt als Konstante. T3 ersetzt in `podStatus` die Tone-Berechnung durch `podTone(reason, phase === 'Running' && readyCount < containers.length)`. So fällt jeder Status in genau einen der Chips `running`/`waiting`/`failed`/`completed`/`terminating`. Test in T2: eine Tabelle mit allen Fixture-Status plus `CreateContainerError`, `Unknown`, `Evicted` und `Foo`.

---

## 3. Korrekturen und Entscheidungen

### Suche (T1)

**C1 · Tokenizer.**
- Leerzeichen trennen Tokens, außer innerhalb von `"…"`.
- Anführungszeichen gruppieren auch mitten im Token (`reason:"back off"` → `reason:back off`) und werden entfernt.
- Ein nicht geschlossenes `"` reicht bis zum Ende.
- `!` am Anfang des rohen Tokens negiert, wenn danach noch etwas kommt. Ein einzelnes `!` und ein leeres `""` werden ignoriert.
- Beginnt der Rest (nach `!`) mit `"`, ist das Token reiner Text (Phrase). Qualifier, Labels und Zahlen werden dann nicht ausgewertet: `"!foo"` sucht wörtlich `!foo`.

**C2 · Reihenfolge je Token (ersetzt Spec 3.1 „Grammatik“).** Gearbeitet wird auf dem kleingeschriebenen Token.
1. **Zahl:** `^([a-z]+)(>=|<=|>|<|=)(\d+)$` und der Name steht in `NUMERIC_FIELDS[kind]`. Vergleich gegen `Number(row.cells[name])`; `NaN` passt nie.
2. **Label:** `^([^=!]+)(!=|=)([^=]*)$`. Der Key muss `LABEL_KEY` erfüllen, der Wert `LABEL_VALUE` (der Wert darf leer sein). `=` heißt: ein Label hat genau diesen Key und Wert, case-insensitive. `!=` heißt: kein solches Label (passt auch ohne den Key). `!key=value` ist dasselbe wie `key!=value`, `!key!=value` dasselbe wie `key=value`.
3. **Qualifier:** `^([a-z]+):(.*)$` und der Name steht in `QUALIFIERS[kind]`. Mit leerem Wert wird das Token ignoriert (passt auf alles), damit die Tabelle beim Tippen von `status:` nicht leer wird. Sonst ist es ein Teilstring-Treffer auf einen der Werte, bei `exact` Gleichheit. Fehlt der Wert an der Zeile, passt der Qualifier nicht (negiert passt er).
4. **Sonst Text:** Teilstring in `searchText(row)`.

Dass Zahlen vor Labels kommen, behebt einen Widerspruch der Spec: `restarts=3` wäre sonst ein Label.

**C3 · Robustheit.**
- `a=b=c`, `http://x`, `10:30`, `restarts>x` und `foo:bar` (unbekannt) sind Text.
- Es gibt nie einen Fehler.
- Leerer oder reiner Leerraum-Text passt auf alles.

**C4 · `owner:` ist exakt** (ganzer Name, case-insensitive) auf `row.owner.name`. Manuell gestartete Jobs tragen die ownerReference auf den CronJob (`client-api.ts:142`), `owner:<cron>` trifft sie also mit. Nice-to-have 9 der Kontextmenü-Validierung ist damit erledigt.

### Chips und Main (T2, T3)

**C5 · Pod-Status in Main (T3), Reihenfolge in `podStatus`:**
1. `deletionTimestamp` → `Terminating`
2. sonst `status.reason`, wenn gesetzt und die Phase weder `Succeeded` noch `Running` ist (Evicted, NodeLost, Shutdown, Preempting, OutOfcpu, Terminated …)
3. sonst der `waiting`-Grund
4. sonst der `terminated`-Grund bei Phase ≠ Succeeded
5. sonst `Completed` bei Phase Succeeded
6. sonst die Phase, ohne Phase `Unknown`

Der Grund aus Schritt 2 muss **vor** dem `terminated`-Grund stehen. Sonst zeigt ein evicteter Pod „Error“ oder „ContainerStatusUnknown“. Die Tone kommt aus `podTone` (B6).

**C6 · Jobs-Status (T3).**
- Reihenfolge: Condition `Failed=True` → `Failed`, `Complete=True` → `Complete`, `spec.suspend === true` → `Suspended`, `status.active > 0` → `Running`.
- Ohne Conditions mit `succeeded >= completions` → `Complete` (alte Objekte).
- Sonst `Pending`.
- `cells.status` wird gesetzt, die Tone kommt aus `jobTone`.
- Der bestehende Test `rows.test.ts:93` (`failed: 1` ohne Condition → `bad`) wird auf `Pending`/`warn` geändert. Genau diesen Fall behebt die Änderung.

**C7 · Node-`pressure` (T3):** `row.pressure = facts.pressure` an jeder Node-Zeile, auch als `[]`.

**C8 · Spec 2.2 irrt beim Sidecar.** Ein Pod mit beendetem `Completed`-Sidecar hat `cells.status === 'Completed'` und fällt in „Abgeschlossen“, nicht in keinen Chip. Dank B6 fällt jeder Pod-Status in **genau einen** Status-Chip. Der Test prüft „genau einen“.

### Reducer (T4)

**C9 · Regeln je Aktion (ersetzt Spec 4.1).** „Text“ meint immer `filters[kind].text` des genannten Kinds.

| Aktion | Text | Chips | Sortierung |
|---|---|---|---|
| `setKind` | bleibt je Kind | bleiben je Kind | `defaultSort(kind)` (auch bei gleichem Kind, wie heute) |
| `setNamespace` | bleibt | bleiben | bleibt |
| `drill` (Workload/Service/Job → Pods, Node → Pods) | Ziel-Kind geleert; die Crumb merkt sich den Text des Quell-Kinds | bleiben | bleibt (wie heute) |
| `drill` CronJob → Jobs | Ziel `jobs` = `owner:<cronjob>` | bleiben | bleibt |
| `drill` Pod → Container | unverändert | unverändert | unverändert |
| `openQuery` | Ziel-Kind geleert, Crumb merkt sich den Quelltext | bleiben | bleibt (bestehender Test `kube-view.test.ts:414`) |
| `back` aus einer Crumb | Ziel-Kind = `crumb.text` (stellt wieder her) | bleiben | bleibt |
| `back` aus Containern | unverändert | unverändert | unverändert |
| `jump` | Ziel-Kind geleert | Ziel-Kind geleert | bleibt |
| `restore` | aus dem Snapshot (gekürzt) | `knownChips(kind, …)` | `defaultSort(snapshot.query.kind)` |
| `sortBy` mit `null` | – | – | `defaultSort(kind)` (C20) |

Abweichung von der Spec: „`back` leert den Text“ und „wie heute“ stimmen nicht mit dem Code. Heute behalten `drill` und `back` den globalen Filter. Wiederherstellen per `crumb.text` ist das, was ein Nutzer erwartet. Aus dem Snapshot wiederhergestellte Crumbs haben `text: ''`.

**C10 · Verdeckte Auswahl (ersetzt Spec 5 „Verdeckte Auswahl“), eine Funktion `keepSelection(previous, next, mode)`:**
- Ist `next.selected` null oder in `visibleRows(next)`, bleibt `next` unverändert.
- Ist der Schlüssel weder in `next.rows` noch in `previous.rows` (noch nicht geladen, z. B. nach `jump` oder `restore`), bleibt `next` unverändert.
- Sonst gilt die Zeile als „gelöscht oder verdeckt“:
  - Bei Modus `'rows'` (Rows-Event, `tick`) rückt die Auswahl auf dieselbe Position in `visibleRows(next)`, sonst auf die letzte Zeile, sonst `null`. Die Position kommt aus `visibleRows(previous)`. War die Zeile dort nicht sichtbar, wird die Auswahl `null`.
  - Bei Modus `'filter'` (`search`, `toggleChip`, `setChips`, `clearFilter`) wird die Auswahl `null`.
- Jede Änderung der Auswahl setzt `container: null`.
- `containersOf` bleibt unberührt.
- Restore mit verdeckter Auswahl führt beim ersten Rows-Event zu `null` (akzeptiert).

**C11 · Aktionen wirken immer auf `state.query.kind`**, auch im Container-Modus (dort auf die Pod-Tabelle dahinter). `toggleChip` mit unbekannter ID und `clearFilter` ohne Filter geben **denselben** State zurück (Referenzgleichheit, damit kein Snapshot feuert). Gespeicherte Chips stehen immer in `CHIPS`-Reihenfolge (`knownChips`), damit der Snapshot-Key nicht von der Klickreihenfolge abhängt.

**C12 · `now`.**
- `initialKubeView` setzt `now: 0`. Der Reducer liest nie die Uhr.
- `tick` setzt `now` und wendet `keepSelection(…, 'rows')` an, weil Zeit-Chips Zeilen ausblenden.
- T7 dispatcht `tick` einmal beim Mount und dann alle 10 s. Vor dem ersten Tick sind ohnehin keine Zeilen da.

**C13 · `compileSearch` merkt sich den letzten `(kind, text)`.** `compileChips` wird nicht gecacht, es parst nichts. `searchText` nutzt die WeakMap. `visibleRows`, `searchedRows` und `chipCounts` dürfen je Render mehrfach laufen. T7 berechnet `rows` und `counts` mit `useMemo` auf `[state.rows, state.query.kind, filter.text, filter.chips, state.sort, state.now, state.query.namespace]`.

**C14 · `snapshotOf`.**
- `filters` enthält nur Kinds mit `text.trim() !== ''` oder `chips.length > 0`.
- Ein leerer Text oder eine leere Chip-Liste wird als Feld weggelassen.
- Ohne einen solchen Kind fehlt der Key `filters` ganz. Ein Snapshot ohne Filter ist damit byte-gleich mit dem heutigen.
- Der Text wird ungetrimmt gespeichert (gekürzt nach B4).
- Ein Snapshot pro Tastendruck ist unkritisch: `saveKubeView` (`App.tsx:153`) schreibt nur in eine Map, nichts auf die Platte. Die Spec-Prüfung „sonst erst beim Schließen“ entfällt.

**C15 · Alte Snapshots** ohne `filters` → `filters: {}`. Unbekannte Chip-IDs fallen weg. Kinds, die danach leer sind, entfallen.

### Befehle und Hilfe (T5)

**C16 · `F` und `w`.**
- `bindingOf` liefert für Shift+f `'F'` (Taste mit einer Stelle, kein weiterer Modifier).
- Beide Tasten sind heute frei. Der bestehende Eindeutigkeitstest deckt sie ab.
- `F` ist immer verfügbar (kein `unavailable`). Ohne Filter tut es nichts.
- `w` ist bei cronjobs, services und ingresses nicht verfügbar, mit dem Text aus 1.5.

**C17 · `:filter`.** Das Argument ist der Text nach dem Befehlsnamen im getrimmten Original (`text.slice(name.length).trim()`), **nicht** `rest.join(' ')`. So bleiben doppelte Leerzeichen in Phrasen erhalten. `:filter` ohne Argument leert den Text. Ergebnis: `{ id: 'filter', text }`.

**C18 · `:status`, Texte wörtlich:**
- Ohne Argument: `Status fehlt. Syntax: :status <id>[,<id>] | :status alle`
- `alle` oder `all` → `'all'`.
- Reiter ohne Chips (`applyStatusCommand`): `Für ${KIND_INFO[kind].label} gibt es keine Status-Filter.`
- Unbekannte ID: `Unbekannter Status „${id}“. Möglich: ${CHIPS[kind].map(c => c.id).join(', ')}`. Gemeldet wird die erste unbekannte ID, nichts wird gesetzt.
- Gültig: Aus `current` werden alle Chips der Gruppen entfernt, zu denen die genannten IDs gehören. Danach kommen die genannten IDs dazu (`knownChips`).
- Beispiel Pods: `current = ['attention','running']`, `:status failed,waiting` → `['attention','waiting','failed']`.

**C19 · Vervollständigung.**
- `completions(':st', …)` liefert `':status '`.
- `completions(':status fa', ns, ids)` liefert `':status failed'`. Kandidaten sind `['alle', ...ids]`, sortiert.
- Bei Kommas wird nur das letzte Segment ergänzt: `':status failed,wa'` → `':status failed,waiting'`.
- Ohne `chipIds` gibt es für `:status` keine Vorschläge.
- `:filter ` hat keine Vorschläge.

**C20 · Hilfe-Spalte „Suche“ (`HelpOverlay.tsx`).**
- Dritte Spalte mit `<h3>Suche</h3>`.
- Darin die `syntax` als `<code>`, dann je `forms`-Eintrag eine Zeile (`<code>{form}</code>`, Beschreibung, „· Beispiel: `<code>`“), dann `note`.
- Darunter `<h4>Qualifier für {KIND_INFO[kind].label}</h4>` mit `name:` und Beschreibung. Ohne Qualifier entfällt die Überschrift.
- Bei Pods und Events folgt `Zahlen: restarts` bzw. `Zahlen: count`.
- Dann `<h4>Status-Filter für {label}</h4>` mit `id` und Label. Bei Ingress steht dort „Keine Status-Filter.“
- Die Hilfesuche filtert auch diese Zeilen (Form, Beschreibung, Beispiel, Name, ID, Label).
- `kind` ist `state.query.kind`.

### Menüs (T6)

**C21 · „Sortierung aufheben“ mit der Events-Standardsortierung.**
- Kopf- und Hintergrundmenü dispatchen weiter `{ type: 'sortBy', sort: null }`. Der Reducer setzt dann `defaultSort(kind)` (C9).
- Deaktiviert ist der Eintrag, wenn `state.sort` gleich `defaultSort(kind)` ist (beide null, oder gleicher Key und gleiche Richtung).
- Hint: bei Events `Standard: Zuletzt absteigend`, sonst wie heute `Standard: Reihenfolge des Eintreffens`.
- Das ändert C26 der Kontextmenü-Validierung entsprechend.

**C22 · Hintergrundmenü, ersetzt `filter-clear`:**
- `search-clear` „Suche leeren“ → `view({ type: 'search', text: '' })`, deaktiviert ohne Text mit dem Hint `Keine Suche gesetzt.`
- `chips-clear` „Status-Filter leeren“ → `view({ type: 'setChips', ids: [] })`, deaktiviert ohne Chips mit dem Hint `Kein Status-Filter gesetzt.`
- Beide gelten für `filterOf(state)`, stehen an der Stelle des alten Eintrags und erscheinen in dieser Reihenfolge.

**C23 · „Filtern: key=value“.**
- Label und ID bleiben (`filter-<key>=<value>`).
- Die Aktion ist `[select(row), { type: 'search', text: 'key=value' }]`. Sie ersetzt den Suchtext, die Chips bleiben.
- Mehrere Labels kombinieren ist kein Menüthema.
- Die Zeile „Label-Filter: genau ein key=value“ der Kontextmenü-Spec (`…context-menus-design.md:283`) wird gestrichen (T8).

**C24 · „Nur <Label> anzeigen“** (ID `only-<chipId>`, Label wörtlich `Nur ${chip.label} anzeigen`, Aktion `view(select(row), { type: 'setChips', ids: [chip.id] })`). Die Zeile kommt aus `primaryChip(kind, row, ctx.now)`:
- pods, jobs: der erste passende Chip der Gruppe `status`
- services, events: der erste passende Chip der Gruppe `type`
- nodes: der erste passende von `notready`, `pressure`, `cordoned`
- alle anderen Kinds und Zeilen ohne Treffer: kein Eintrag

Der Eintrag steht am Ende der ersten Gruppe des Zeilenmenüs. Bei Pods ist das nach den „Filtern: …“-Einträgen. Ist die erste Gruppe leer (Event ohne `involved`), bildet er die erste Gruppe allein. Kein Hotkey-Hint. `menuFor` liest nie `state.selected` (C14 der Kontextmenü-Validierung).

**C25 · Problem-Hinweis und Node-Kachel:** keine Änderung in `ProblemBanner.tsx`. Das Leeren der Ziel-Chips leistet `jump` (C9). T6 fasst `ProblemBanner.tsx` nicht an, weil „In der Tabelle zeigen“ nicht im Umfang ist.

### UI (T7)

**C26 · Suchfeld und Kopfzeile.**
- `aria-label="Suchen"`, Placeholder wörtlich `Name, status:, node:, app=api, !term …`, `maxLength={200}`.
- Der Wert ist `filterOf(state).text`, `onChange` dispatcht `search`.
- `Enter` schließt, behält den Text und gibt den Fokus an die Tabelle (`tableRef`).
- `Esc` leert **nur den Text** und schließt. `onBlur` schließt und behält.
- Ein ×-Knopf (`aria-label="Suche leeren"`, `onMouseDown` mit `preventDefault`) leert den Text, das Feld bleibt offen und fokussiert.
- Die Hinweis-Schaltfläche zeigt `Suche: ${text} · : befehl` bzw. `/ suchen · : befehl`.
- Der Befehls-Prompt bleibt, wie er ist.

**C27 · Chip-Leiste.**
- Unter `kube-kind-tabs` als `<div className="kube-chipbar" role="toolbar" aria-label="Status-Filter">`.
- Je Chip ein `<button type="button" className="kube-chip kube-filter-chip[ kube-chip-on][ kube-chip-zero]" aria-pressed={on}>{label} <span className="kube-chip-count">{count}</span></button>`. Klick dispatcht `toggleChip`.
- Chips mit 0 bleiben klickbar, sind nur grau.
- Ein dünner Trenner `<span className="kube-chip-sep" aria-hidden="true" />` steht, wo die Gruppe wechselt.
- Der Chip `attentionChip(kind)` hat `title="Taste w"`.
- Rechts, nur bei `isFiltered(filter)` und nicht während `loading`: `${rows.length} von ${state.rows.length}` und ein Knopf „Zurücksetzen“ (`title="Suche und Status-Filter zurücksetzen (F)"`, dispatcht `clearFilter`).
- Die Leiste fehlt im Container-Modus. Sie fehlt auch, wenn der Reiter keine Chips hat und kein Filter aktiv ist (Ingress ohne Suche).
- Zähler: `chipCounts(kind, searchedRows(state), state.now)`.

**C28 · Leer-Text (ersetzt Spec 4.3 „Leer-Text“).** Reihenfolge:
1. `trouble`
2. `loading` → „Lade …“
3. `state.rows.length === 0` → „Keine Einträge.“
4. Text und Chips → `Keine Treffer für „${text}“ mit ${labels}${ns}.`
5. Nur Text → `Keine Treffer für „${text}“${ns}.`
6. Nur Chips → `Keine Zeilen mit ${labels}${ns}.`

Dabei ist `labels` die Liste der Labels der aktiven Chips mit „, “ verbunden und `ns` gleich ` in ${query.namespace}`, wenn `query.namespace !== null`. Der Text wird getrimmt.

Der Knopf „In allen Namespaces suchen“ (`dispatch({ type: 'setNamespace', namespace: null })`, Filter bleiben) erscheint unter dem Text, wenn alle diese Bedingungen gelten:
- Fall 4–6
- `query.namespace !== null`
- `KIND_INFO[kind].namespaced`
- `state.crumbs.length === 0`

Die letzte Bedingung gilt, weil `setNamespace` den Drill-down verwerfen würde. „Keine Zeilen mit Status Fehler.“ aus der Spec entfällt, weil „Status“ bei Warning oder NodePort falsch wäre.

**C29 · Spalten und Alter.**
- `ResourceTable` nimmt `columnsOf(state)` statt `KIND_COLUMNS[kind]`.
- Die Zelle `namespace` zeigt `row.ref.namespace ?? '–'`.
- Der 10-s-Timer in `ResourceTable` entfällt. Alter nutzt `state.now`.
- `DetailDock` bleibt bei seinem eigenen `Date.now()`.

**C30 · `runKey`/`runCommand` (ClusterView):**
- `attention` → `toggleChip(attentionChip(kind)!)`
- `resetFilter` → `clearFilter`
- Befehl `filter` → `search(text)`
- Befehl `status` → `applyStatusCommand(kind, filterOf(state).chips, parsed.chips)`. Bei einem Fehler wird `say(error)` aufgerufen, sonst `setChips`.
- Vervollständigung: `completions(line, state.namespaces, CHIPS[state.query.kind].map(c => c.id))` in der Tab-Taste und in den Vorschlägen.
- CSS: `.kube-chip-on` mit Akzent wie `.kube-kind-on`, `.kube-chip-zero` mit `opacity: .5`, außerdem `.kube-chipbar`, `.kube-chip-sep`, `.kube-chip-count`, `.kube-filter-chip` (`cursor: pointer`, `background: none`).

### Doku (T8)

**C31 · Spec-Anpassungen.**
- `…integration-design.md:150` „Warnungen stehen oben“ → „Neueste zuerst (Standardsortierung Zuletzt ↓); Warnungen per `w`.“
- `…context-menus-design.md:283` wird gestrichen.
- In `…context-menus-validation.md` wird Nice-to-have 9 als erledigt markiert, C26 bekommt einen Verweis auf C21 hier.
- Die Tastentabelle der Integrations-Spec bekommt `w` und `F`.
- README Zeile 155 und CHANGELOG 0.7.0: Suche-Syntax, Chips, `w`, `F`, `:filter`, `:status`, Jobs-Status, Evicted/Unknown.
- Version mit `npm run version:minor`.

**C32 · Testpflicht über die Spec hinaus.**
- T1: Tests zu C1–C3, darunter `restarts=3` als Zahl, `!key!=value` und `status:` leer.
- T2: B6-Partition, `knownChips`-Reihenfolge, `compileChips` mit OR in der Gruppe und AND zwischen Gruppen, `chipCounts` enthält jede ID, Schema lehnt Text mit 201 Zeichen ab und akzeptiert `filters` mit nur einem Kind (B3).
- T4: C9 (`back` stellt `crumb.text` wieder her), C10 (beide Modi), C11 (Referenzgleichheit), B4 (Kürzung), `columnsOf` und Sortierung nach `namespace`, `sortBy null` → `defaultSort` bei Events.
- T5: C17–C19.
- T6: C21, C22, C24.

---

## 4. Zuordnung je Task

| Task | Welle | Dateien (exakt) | Vertrag | Blocker/Korrekturen |
|---|---|---|---|---|
| **T1** Filter-Modell | 1 | `src/shared/kube-filter.ts`, `src/shared/kube-filter.test.ts` | 1.1 komplett | B1, C1–C4, C13 (Memo/WeakMap), C32 |
| **T2** Status-Chips + Shared-Typen | 1 | `src/shared/kube-status.ts` (+ Test), `src/shared/kubernetes.ts`, `src/shared/kubernetes-schema.ts`, `src/shared/kubernetes-schema.test.ts` | 1.2, 1.3 | B1, B3, B6, C8, C32. `rows.ts` bleibt unberührt (behält vorerst seine lokalen Mengen) |
| **T3** Main-Zeilen | 2 | `src/main/kubernetes/rows.ts`, `src/main/kubernetes/rows.test.ts` | nutzt `podTone`, `jobTone`, `JobStatus`, `KubeRow.pressure` | B6 (Umstellung), C5–C7 |
| **T4** Reducer | 2 | `src/renderer/src/kube-view.ts`, `kube-view.test.ts`, **dazu nur mechanisch** `kube-menus.ts`, `kube-menus.test.ts`, `components/kubernetes/ClusterView.tsx`, `components/kubernetes/ResourceTable.tsx` | 1.4 | B2, B4, B5, C9–C15, C32 |
| **T5** Befehle + Hilfe | 3 | `src/renderer/src/kube-commands.ts`, `kube-commands.test.ts`, `components/kubernetes/HelpOverlay.tsx` | 1.5 | C16–C20 |
| **T6** Menüs | 3 | `src/renderer/src/kube-menus.ts`, `kube-menus.test.ts` (kein `ProblemBanner.tsx`) | 1.6, nutzt `primaryChip`, `filterOf`, `defaultSort` | C21–C25 |
| **T7** UI | 4 | `components/kubernetes/ResourceTable.tsx`, `components/kubernetes/ClusterView.tsx`, `src/renderer/src/kubernetes-ui.css` | nutzt 1.2, 1.4, 1.5 | B4 (`maxLength`), B5, C12 (Tick), C13 (`useMemo`), C26–C30 |
| **T8** Doku | 1 (Entwurf) / 5 (final) | `README.md`, `CHANGELOG.md`, `package.json`/`package-lock.json` (Version), `…integration-design.md`, `…context-menus-design.md`, `…context-menus-validation.md`, diese Spec | – | C31 |

**Gate nach jeder Welle:** `npm run typecheck` und `npm test` grün, bevor die nächste Welle startet. Konflikte zwischen den Dateien gibt es nur zwischen den Wellen, nie innerhalb einer Welle:
- `kube-menus*` und `ClusterView`/`ResourceTable` ändert T4 nur mechanisch (Welle 2); die Funktionen bauen T6 bzw. T7 (Wellen 3 und 4).
- `ClusterView.tsx` kompiliert nach Welle 3 auch ohne T7, weil `runKey` einen `default`-Zweig hat und `runCommand` die neuen `ParsedCommand`-Varianten nicht behandeln muss.

## Nachtrag nach dem Review

**C10, angepasst:** Im Container-Modus verschiebt `keepSelection` weder Auswahl noch Container. Damit bleibt der geöffnete Pod stabil, auch wenn ein Filter ihn verbirgt. Diese Regel stammt aus dem Opus-Review (I1) und gilt vor C10.
