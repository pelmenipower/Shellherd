# Container-Ansicht für Docker und Podman – Validierung

Stand: 2026-10-18 · Validierung: Opus · Bezug: `2026-10-18-container-view-design.md` (Spec), `docs/superpowers/plans/2026-10-18-container-view.md` (Plan), `.superpowers/sdd/container-view-research.md` (Recherche)

**Dieses Dokument ist bindend und hat Vorrang vor Spec, Plan und Recherche.** Wo es schweigt, gilt die Spec, danach die Recherche. Zielversion **0.9.0**. Code-Kommentare englisch, UI-Texte deutsch und **wörtlich** wie hier. Namen, Dateien und Signaturen sind verbindlich, damit parallele Umsetzer ohne Rückfrage gegeneinander bauen.

## 0. Urteil

**ready after corrections.** 10 Blocker (B1–B10), 32 Korrekturen und Entscheidungen (C1–C32). Der Vertrag steht in Abschnitt 1, die Wellen in Abschnitt 4, die Testpflichten in Abschnitt 5.

Geprüft gegen den Code auf `claude/feature/container-view` (HEAD `4ca545b`). Ausgangslage: `npm run typecheck` ist grün. `npx vitest run` lief dreimal mit 72 Dateien und 945 Tests, zweimal grün. Einmal schlug ein Test fehl, der beim Wiederholen grün war, also ein bestehender Wackeltest. Vor Welle 1 bitte einmal neu laufen lassen und ein erneutes Scheitern nicht der Welle zuschreiben.

Bestätigte Annahmen (Fundstellen):

| Annahme | Befund |
|---|---|
| `LOCAL_CONTAINER_HOST` | existiert: `src/shared/containers.ts:5` = `'local-containers'`. **Nicht neu anlegen.** |
| `CONTAINER_REF` | `src/shared/containers.ts:7` `/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/`. Ein führendes `-` ist ausgeschlossen. |
| Weg über `target` für Logs und Shell | `TerminalPanel.tsx:152` schickt `connection.target` an `sshPrepare`. `session.ts:142-158` prüft (lokal nur mit `target`, `terminalArgv` vorab), `:187-214` per SSH-exec mit pty, `:312-330` lokal per ConPTY (nur unter Windows). Kein Main-Umbau nötig. |
| `fileBrowsers` | `src/shared/vault/types.ts:206`, `schema.ts:131`, `terminal-layout.ts:161,181`. |
| `TabConnectionSchema` | `src/main/window-ipc.ts:20-24`, nicht exportiert, `.strict()`, `view: z.literal('files').optional()`. Es kennt weder `kube` noch `'kubernetes'`. Das ist eine bestehende Lücke und nicht Teil dieses Auftrags. |
| Kube-Helfer aus R1 | Alle sind schon exportiert: `kube-menu-trigger.ts:10-25`, `kube-columns.ts:8,52,60`, `kube-view.ts:264` (`formatAge`), `kube-commands.ts:95` (`bindingOf`), `kube-copy.ts:24,30`, `native-surface.ts:10`. **Die R2-Ausnahme wird nicht gebraucht. Keine Kube-Datei wird verändert.** |
| `view` als Union | Auf `TabConnection.view` gibt es nur Vergleiche, kein `switch` (`terminal-tabs.ts:19,46,56`, `terminal-layout.ts:161`). Erweitert man `view` um `'containers'`, bleibt der Typecheck grün. |
| Sender-Prüfung | `requireSshSender` (`src/main/ssh/ipc.ts:13`) gilt auch für Zweitfenster. |
| `SecondaryWindow.tsx` | Rendert `SplitTerminalArea` ohne `onPopout` (Zeile 99). Dort erscheint die Ansicht ohne „Als Tab öffnen“. **Keine Änderung nötig.** |
| `removeConnectionsFromLayout` (`mutations.ts:368`) | Verwirft heute `fileBrowsers`, `containerTabs` und `kubeTabs` ganz, wenn eine Verbindung gelöscht wird. Für `containerViews` gilt dasselbe, ohne Änderung. |

---

## 1. Vertrag (exaktes TypeScript)

### 1.1 `src/shared/containers.ts` (T1, nur Ergänzungen)

```ts
export type InventoryKind = 'containers' | 'images' | 'volumes' | 'networks';
export const INVENTORY_KINDS: readonly InventoryKind[] = ['containers', 'images', 'volumes', 'networks'];
/** ref: container name (or ID when the name is not a valid ref), image repo:tag or ID without "sha256:", volume name, network name or ID. */
export interface InventoryRef { kind: InventoryKind; runtime: ContainerRuntime; ref: string }
export type InventoryState = 'running' | 'exited' | 'paused' | 'restarting' | 'created' | 'dead' | 'stopped' | 'unknown';
export type RowTone = 'ok' | 'warn' | 'bad' | 'muted';
/** Raw links of a container row; only for linkUsage in main and the networks column. */
export interface ContainerLinks { image: string; imageId: string; mounts: string[]; networks: string[] }
export interface InventoryRow {
  /** `${runtime}:${kind}:${key}`, see B1; unique within one inventory and stable across polls. */
  uid: string;
  ref: InventoryRef;
  /** Full ID without "sha256:" (volumes: the name). */
  id: string;
  /** Display name: container name, repo:tag or 12-char ID, volume or network name. */
  name: string;
  /** Column key -> raw value; '' = unknown. Keys per kind: C5. */
  cells: Record<string, string | number>;
  tone: RowTone;
  labels: Record<string, string>;
  state?: InventoryState;
  exitCode?: number;
  project?: string;
  pod?: string;
  /** Containers using it; undefined = unknown (never 0 for unknown). */
  usedBy?: number;
  links?: ContainerLinks;
}
export interface ContainerInventory {
  runtime: ContainerRuntime;
  runtimes: ContainerRuntime[];
  rows: Record<InventoryKind, InventoryRow[]>;
  /** German message per failed list. */
  problems: Partial<Record<InventoryKind, string>>;
  /** Epoch ms. */
  at: number;
  /** SSH user name; absent for this computer. */
  user?: string;
  /** connection.containers?.sudo === true; false for this computer. */
  sudo: boolean;
}
export type InventoryAction = 'start' | 'stop' | 'restart' | 'remove';
export const INVENTORY_ACTIONS: Record<InventoryKind, readonly InventoryAction[]> = {
  containers: ['start', 'stop', 'restart', 'remove'], images: ['remove'], volumes: ['remove'], networks: [],
};
export type ContainerDockMode = 'logs' | 'shell' | 'inspect';
export const IMAGE_ID = /^(sha256:)?[a-f0-9]{12,64}$/;
export const IMAGE_NAME_TAG = /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:(?::[0-9]{1,5})?\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
export const MAX_REF_LENGTH = 255;
/** images: IMAGE_ID or IMAGE_NAME_TAG; other kinds: CONTAINER_REF. Always false above MAX_REF_LENGTH or for an unknown runtime/kind. */
export function inventoryRefValid(ref: InventoryRef): boolean;
/** True for InventoryRef, false for ContainerTarget (kind 'container' | 'lxc' | 'vm'). */
export function isInventoryRef(target: ContainerTarget | InventoryRef): target is InventoryRef;
/** See C3. */
export function containerTone(state: InventoryState, status: string, exitCode?: number): RowTone;
export const CONTAINER_VIEW_SUFFIX = ' · Container';
export const LOCAL_HOST_NAME = 'Dieser Computer';
/** Host part of a container view tab name: `name` without a trailing CONTAINER_VIEW_SUFFIX. */
export function containerViewHostName(name: string): string;
```

`ContainerAction` (`'start' | 'stop' | 'restart' | 'shutdown'`) bleibt **unverändert**. `'remove'` gibt es nur in `InventoryAction` (B5).

### 1.2 `src/shared/containers-schema.ts` (T1)

```ts
export const InventoryRefSchema: z.ZodType<InventoryRef> = z.object({
  kind: z.enum(['containers', 'images', 'volumes', 'networks']),
  runtime: z.enum(['docker', 'podman']),
  ref: z.string().min(1).max(MAX_REF_LENGTH),
}).strict().refine(inventoryRefValid, { message: 'Ungültige Angabe.' });
```

`ContainerTargetSchema` und `TerminalTargetSchema` bleiben unverändert (R9).

### 1.3 `src/shared/ipc.ts`, `src/preload/index.ts` (T1)

```ts
// IPC_CHANNELS
containersInventory: 'containers:inventory',
containersInspect: 'containers:inspect',
// DesktopApi
containersInventory: (request: { hostId: ContainerHostId; runtime?: ContainerRuntime }) => Promise<ContainerInventory>;
/** Masked, 2-space indented JSON of `<rt> <kind> inspect <ref>`. */
containersInspect: (request: { hostId: ContainerHostId; ref: InventoryRef }) => Promise<string>;
containersAction: (request:
  | { hostId: ContainerHostId; target: ContainerTarget; action: ContainerAction }
  | { hostId: ContainerHostId; target: InventoryRef; action: InventoryAction }) => Promise<void>;
```

Preload: `containersInventory: request => ipcRenderer.invoke('containers:inventory', request)` und `containersInspect: request => ipcRenderer.invoke('containers:inspect', request)`. Bis T6 gibt es keinen Handler. Das kompiliert, und vor Welle 5 ruft niemand die Methoden auf.

### 1.4 Tab und Workspace (T1)

```ts
// src/shared/windows.ts
/** File browser ('files') or container view ('containers') of the connection `id`. */
view?: 'files' | 'containers';
// src/shared/vault/types.ts, WorkspacePane
/** Positions in `connectionIds` of SSH connections opened as container view. */
containerViews?: number[];
// src/shared/vault/schema.ts, WorkspacePaneSchema
containerViews: z.array(z.number().int().min(0).max(63)).max(64).optional(),
// src/main/window-ipc.ts, TabConnectionSchema
view: z.enum(['files', 'containers']).optional(),
```

### 1.5 `src/main/containers/inventory-parsers.ts` (T2, neu, rein, wirft nie)

```ts
export function parseContainerRows(runtime: ContainerRuntime, text: string): InventoryRow[];
export function parseImageRows(runtime: ContainerRuntime, text: string): InventoryRow[];
export function parseVolumeRows(runtime: ContainerRuntime, text: string): InventoryRow[];
export function parseNetworkRows(runtime: ContainerRuntime, text: string): InventoryRow[];
/** '142MB' -> 142_000_000, '1.2GB', '10.5kB', '0B'; decimal (B, kB/KB, MB, GB, TB); numbers pass through; else null. */
export function parseDockerSize(value: unknown): number | null;
/** '2026-10-18 10:00:00 +0200 CEST' -> '2026-10-18T08:00:00.000Z'; Unix seconds (number) -> ISO; ISO stays; else ''. */
export function parseDockerTime(value: unknown): string;
/** 'a=b,c=d' or an object -> record; anything else -> {}. */
export function parseLabels(value: unknown): Record<string, string>;
/** Podman Ports[] -> '0.0.0.0:8080->80/tcp, 443/tcp'; not an array -> ''. */
export function podmanPorts(value: unknown): string;
/** Strips 'docker.io/', then 'library/', appends ':latest' when the last path part has no tag and no '@'. */
export function normalizeImageRef(ref: string): string;
/** Sets usedBy and cells.usedBy (images, volumes) or cells.containers (networks) from rows.containers[].links; see C8. Pure, returns new rows. */
export function linkUsage(runtime: ContainerRuntime, rows: Record<InventoryKind, InventoryRow[]>, containersKnown?: boolean): Record<InventoryKind, InventoryRow[]>;   // default true; B8 passes !problems.containers
/** See C10. Unparsable input comes back unchanged. */
export function maskInspect(text: string): string;
```

### 1.6 `src/main/containers/commands.ts` (T3, nur Ergänzungen)

```ts
export function inventoryArgv(runtime: ContainerRuntime, kind: InventoryKind): string[];
export function inspectArgv(ref: InventoryRef): string[];
export function inventoryActionArgv(ref: InventoryRef, action: InventoryAction): string[];
```

Die genauen Argument-Arrays stehen in C11. Bei einem ungültigen `ref` oder einer unbekannten Laufzeit kommt `ContainerInputError('Ungültige Container-Angabe.')`. Eine Aktion außerhalb von `INVENTORY_ACTIONS[kind]` wirft `ContainerInputError('Diese Aktion ist hier nicht möglich.')`. `listArgv`, `actionArgv` und `terminalArgv` bleiben unverändert.

### 1.7 `src/main/containers/discovery.ts`, `validation.ts`, `ipc.ts` (T6)

```ts
// ContainerDiscovery (additive methods; list/action unchanged)
inventory(hostId: ContainerHostId, runtime?: ContainerRuntime): Promise<ContainerInventory>;
inspect(hostId: ContainerHostId, ref: InventoryRef): Promise<string>;
inventoryAction(hostId: ContainerHostId, ref: InventoryRef, action: InventoryAction): Promise<void>;
// validation.ts (additive; ListRequestSchema and ActionRequestSchema unchanged)
export const InventoryRequestSchema = z.object({ hostId, runtime: z.enum(['docker', 'podman']).optional() }).strict();
export const InspectRequestSchema = z.object({ hostId, ref: InventoryRefSchema }).strict();
export const InventoryActionRequestSchema = z.object({ hostId, target: InventoryRefSchema, action: z.enum(['start', 'stop', 'restart', 'remove']) }).strict();
```

So verteilt `ipc.ts` den Kanal `containers:action`:

```ts
ipcMain.handle(IPC_CHANNELS.containersAction, (event, request: unknown) => {
  requireSshSender(event);
  const inventory = InventoryActionRequestSchema.safeParse(request);
  if (inventory.success) return discovery.inventoryAction(inventory.data.hostId, inventory.data.target, inventory.data.action);
  const parsed = parseRequest(ActionRequestSchema, request);
  return discovery.action(parsed.hostId, parsed.target, parsed.action);
});
```

### 1.8 `src/renderer/src/container-columns.ts` (T4, neu, rein)

```ts
import type { FacetOption, NumberOp } from './kube-columns';
import { EMPTY_VALUE, parseAgeFilter, parseNumberFilter } from './kube-columns';
export type ColumnFilterKind = 'text' | 'select' | 'number' | 'size' | 'age';
export interface ContainerColumn { key: string; label: string; filter: ColumnFilterKind; podmanOnly?: true }
export const COLUMNS: Record<InventoryKind, readonly ContainerColumn[]>;           // C5
export function columnsFor(kind: InventoryKind, runtime: ContainerRuntime): ContainerColumn[]; // drops podmanOnly for docker
export function primaryFilterColumn(kind: InventoryKind): string;                  // images: 'repository', else 'name'
/** Normalised values; [] = empty. 'networks' splits on ','. '', '-', '–', '—' count as empty. */
export function cellValues(row: InventoryRow, key: string): string[];
/** size -> formatBytes, age -> formatAge (kube-view), number as is, empty -> '–'. */
export function displayCell(row: InventoryRow, column: ContainerColumn, now: number): string;
/** '>100MB', '<= 1.5 GB', '2048', '=0'; units B, kB, KB, MB, GB, TB (case-insensitive, decimal); no unit = bytes; no operator = '='. */
export function parseSizeFilter(text: string): { op: NumberOp; bytes: number } | null;
export function isValidColumnFilter(column: ContainerColumn, value: string): boolean;
export function compileColumnFilters(columns: readonly ContainerColumn[], filters: Readonly<Record<string, string>> | undefined, now: number): (row: InventoryRow) => boolean;
export function facetValues(rows: readonly InventoryRow[], columns: readonly ContainerColumn[], column: ContainerColumn,
  filters: Readonly<Record<string, string>> | undefined, now: number, otherPredicate: (row: InventoryRow) => boolean): FacetOption[];
export type GroupId = 'project' | 'status' | 'image' | 'pod' | 'repository' | 'driver';
export interface GroupOption { id: GroupId; label: string; key: (row: InventoryRow) => string; podmanOnly?: true }
export const GROUP_OPTIONS: Record<InventoryKind, readonly GroupOption[]>;           // C6
export function groupOptionsFor(kind: InventoryKind, runtime: ContainerRuntime): GroupOption[];
export type GroupRow = { type: 'group'; key: string; label: string; count: number; collapsed: boolean };
export type ResourceItem = { type: 'row'; row: InventoryRow };
export type TableItem = GroupRow | ResourceItem;
export function groupRows(rows: readonly InventoryRow[], options: readonly GroupOption[], groupBy: GroupId | null, collapsed: readonly string[]): TableItem[];
/** Decimal like Docker: 999 -> '999 B', 142_000_000 -> '142 MB', 1_200_000_000 -> '1.2 GB', 10_500 -> '10.5 kB'. */
export function formatBytes(bytes: number): string;
export interface FilterHelpForm { form: string; description: string; example: string }
export const FILTER_HELP: readonly FilterHelpForm[];                                 // C7
```

Die Semantik von `select`, `number`, `age`, `facetValues` und `groupRows` ist die von `kube-columns.ts:65-255`, jeweils ohne `kind`-Parameter und mit eigener Zeilenform.

### 1.9 `src/renderer/src/container-status.ts`, `container-commands.ts`, `container-confirm.ts` (T5, neu, rein)

```ts
// container-status.ts
export type ChipGroup = 'attention' | 'status' | 'trait';
export interface ChipDef { id: string; label: string; group: ChipGroup; matches: (row: InventoryRow) => boolean }
export const CHIPS: Record<InventoryKind, readonly ChipDef[]>;                      // C12
export function knownChips(kind: InventoryKind, ids: readonly string[]): string[];
/** OR within a group, AND between groups; no ids = all. */
export function compileChips(kind: InventoryKind, ids: readonly string[]): (row: InventoryRow) => boolean;
export function chipCounts(kind: InventoryKind, rows: readonly InventoryRow[]): Record<string, number>;
export function attentionChip(kind: InventoryKind): 'attention' | null;
/** containers: first matching 'status' chip; other kinds: undefined. */
export function primaryChip(kind: InventoryKind, row: InventoryRow): ChipDef | undefined;

// container-commands.ts
import type { CommandGroup } from './kube-commands';
export type ContainerCommandId = 'down' | 'up' | 'tab' | 'menu' | 'help' | 'reload' | 'filter' | 'attention' | 'resetFilter'
  | 'logs' | 'shell' | 'inspect' | 'toggleDock' | 'popout' | 'restart' | 'stop' | 'remove';
/** Independent of the reducer (B4); the view builds it. */
export interface ContainerCommandContext { kind: InventoryKind; row: InventoryRow | null; dock: ContainerDockMode; canPopout: boolean }
export interface ContainerCommand {
  id: ContainerCommandId; group: CommandGroup; description: string; keys: string[]; bindings: string[];
  unavailable?: (context: ContainerCommandContext) => string | undefined;
}
export const CONTAINER_COMMANDS: readonly ContainerCommand[];                       // C13
export function commandForKey(binding: string): ContainerCommand | undefined;
/** Why `action` cannot run on `row` now; undefined = possible. Used by registry, menus and dock. */
export function actionUnavailable(row: InventoryRow | null, action: InventoryAction): string | undefined;   // C14

// container-confirm.ts
export interface ContainerConfirmation { title: string; body: string; requireTyping: string | null; confirmLabel: string }
/** 'diesem Computer' for LOCAL_CONTAINER_HOST, else hostName. */
export function hostLabel(hostId: string, hostName: string): string;
/** null = run without dialog (start only). */
export function confirmationFor(row: InventoryRow, action: InventoryAction, where: string): ContainerConfirmation | null;   // C15
```

### 1.10 `src/renderer/src/container-view.ts` (T7, neu, rein)

```ts
export interface KindView {
  filters: Record<string, string>; chips: string[];
  sort: { key: string; dir: 'asc' | 'desc' } | null;
  groupBy: GroupId | null; collapsed: string[];
}
export interface ContainerViewState {
  inventory: ContainerInventory | null;
  /** Runtime asked for; null = default (first found). */
  requestedRuntime: ContainerRuntime | null;
  kind: InventoryKind;
  views: Record<InventoryKind, KindView>;
  /** uid of the selected row. */
  selected: string | null;
  dock: ContainerDockMode; dockOpen: boolean;
  /** uid the shell was opened for; any other selection shows the button again. */
  armed: string | null;
  /** Restarts log streams (reloadDock). */
  epoch: number;
  loading: boolean; error: string | null;
  /** uids with an action in flight. */
  busy: string[];
  now: number;
}
export type ContainerViewAction =
  | { type: 'loading' }
  | { type: 'setInventory'; inventory: ContainerInventory }
  | { type: 'fail'; message: string }
  | { type: 'setRuntime'; runtime: ContainerRuntime }
  | { type: 'setKind'; kind: InventoryKind }
  | { type: 'setColumnFilter'; key: string; value: string }
  | { type: 'toggleChip'; id: string }
  | { type: 'setChips'; ids: string[] }
  | { type: 'clearFilter' }
  | { type: 'setGroupBy'; groupBy: GroupId | null }
  | { type: 'toggleGroup'; key: string }
  | { type: 'sort'; key: string; dir?: 'asc' | 'desc' }
  | { type: 'clearSort' }
  | { type: 'select'; uid: string | null }
  | { type: 'move'; delta: 1 | -1 }
  | { type: 'dock'; mode: ContainerDockMode }
  | { type: 'toggleDock' }
  | { type: 'arm' }
  | { type: 'reloadDock' }
  | { type: 'busy'; uid: string; busy: boolean }
  | { type: 'tick'; now: number }
  | { type: 'showContainersWith'; key: 'project' | 'image' | 'networks'; value: string };
export function initialContainerViewState(now: number): ContainerViewState;
export function containerViewReducer(state: ContainerViewState, action: ContainerViewAction): ContainerViewState;
export function currentColumns(state: ContainerViewState): ContainerColumn[];   // columnsFor(kind, inventory?.runtime ?? 'docker')
export function rowsOf(state: ContainerViewState): InventoryRow[];               // inventory rows of state.kind, [] without inventory
export function visibleRows(state: ContainerViewState): InventoryRow[];          // column filters AND chips, then sort
export function tableItems(state: ContainerViewState): TableItem[];
export function navigableRows(state: ContainerViewState): InventoryRow[];        // rows of tableItems in display order
export function selectedRow(state: ContainerViewState): InventoryRow | null;     // among visibleRows
export function dockTerminalKey(row: InventoryRow, mode: 'logs' | 'shell', epoch: number): string;   // C20
export function loadedLabel(at: number, now: number): string;                    // C22
export function rootlessHint(state: ContainerViewState, hostId: string): string | null;   // C23
export function tabStatus(state: ContainerViewState): 'connecting' | 'connected' | 'error';
```

### 1.11 `src/renderer/src/container-menus.ts`, `container-menu-run.ts` (T8, neu, rein)

```ts
// container-menus.ts
export type ContainerMenuTarget =
  | { type: 'row'; row: InventoryRow }
  | { type: 'dock'; mode: ContainerDockMode; row: InventoryRow | null }
  | { type: 'header'; column: ContainerColumn }
  | { type: 'background' };
export type ContainerMenuAction =
  | { type: 'view'; actions: ContainerViewAction[] }
  | { type: 'copy'; text: string; label: string }
  | { type: 'containerAction'; row: InventoryRow; action: InventoryAction }
  | { type: 'popout'; target: TerminalTarget }
  | { type: 'reload' }
  | { type: 'dockReload' }
  | { type: 'help' };
export type ContainerMenuEntry =
  | { kind: 'item'; id: string; label: string; hint?: string; disabled?: boolean; run: ContainerMenuAction }
  | { kind: 'heading'; label: string }
  | { kind: 'separator' };
export interface ContainerMenuContext { state: ContainerViewState; canPopout: boolean }
export function menuFor(target: ContainerMenuTarget, context: ContainerMenuContext): ContainerMenuEntry[];   // C24–C27
/** TerminalTarget of a container row for logs or shell (kind 'container', ref.ref, name). */
export function terminalTargetOf(row: InventoryRow, mode: 'logs' | 'shell'): TerminalTarget;

// container-menu-run.ts
export const rowMenuTarget = (row: InventoryRow): ContainerMenuTarget => ({ type: 'row', row });
export interface ContainerMenuRunner {
  dispatch(action: ContainerViewAction): void;
  copy(text: string, label: string): void;
  /** The only way to a container action: dialog or, for start, direct run. */
  confirm(row: InventoryRow, action: InventoryAction): void;
  popout(target: TerminalTarget): void;
  reload(): void;
  reloadDock(): void;
  help(): void;
}
/** Exhaustive switch without default branch. */
export function runMenuAction(action: ContainerMenuAction, runner: ContainerMenuRunner): void;
```

### 1.12 Komponenten (T9) und Verdrahtung (T10)

```ts
// src/renderer/src/components/containers/ContainerView.tsx (T9)
export interface ContainerViewProps {
  connection: TerminalConnection; tabId: string; visible: boolean; focused?: boolean;
  style?: CSSProperties; onFocus?: () => void;
  onStatusChange: (id: string, status: SshStatus) => void;
  onPopout?: (connection: TerminalConnection) => void;
}
export function ContainerView(props: ContainerViewProps): JSX.Element;
// src/renderer/src/hooks/useContainerInventory.ts (T9)
export function useContainerInventory(hostId: string, runtime: ContainerRuntime | null, visible: boolean,
  dispatch: (action: ContainerViewAction) => void): { reload: () => void };
// src/renderer/src/terminal-tabs.ts (T10, additive)
export function containerViewConnection(hostId: string, hostName: string, address: string): TerminalConnection;
// = { id: hostId, name: `${hostName}${CONTAINER_VIEW_SUFFIX}`, protocol: hostId === LOCAL_CONTAINER_HOST ? 'cmd' : 'ssh', address, view: 'containers' }
```

So rendert T10 die Ansicht in `SplitTerminalArea.tsx`, **vor** `if (tab.connection.protocol === 'sftp')`:

```tsx
if (tab.connection.view === 'containers') return <ContainerView key={tab.id} tabId={tab.id} connection={tab.connection} visible={panel.visible}
  focused={panel.focused} style={panel.style} onFocus={panel.onFocus} onStatusChange={onStatus} onPopout={onPopout} />;
```

---

## 2. Blocker

### B1 · Die `uid` ist bei Images nicht eindeutig
`docker images` liefert für jedes Tag eine eigene Zeile mit **derselben** ID. Mit `${kind}:${id}` entstehen doppelte React-Keys, die Auswahl springt, und R7 („Entfernen über `repo:tag` der Zeile“) trifft das falsche Tag. Podman liefert pro Image **einen** Eintrag mit `Names[]`.
**Fix:** `uid = ${runtime}:${kind}:${key}`. `key` ist bei Containern die volle ID, bei Images `${id}@${repo}:${tag}` (ohne Tag nur `${id}`), bei Volumes der Name und bei Netzwerken die ID (fehlt sie, der Name). Der Podman-Parser legt **pro Eintrag in `Names` eine Zeile** an, wie Docker. Ist `Names` leer oder `null`, gibt es eine Zeile ohne Tag. Die Laufzeit steht in der `uid`, damit ein Wechsel der Laufzeit nie eine Auswahl übernimmt.

### B2 · Die Props passen nicht zu `SplitTerminalArea`
Die Spec setzt `onStatusChange?: (status) => void`. `SplitTerminalArea` reicht aber `onStatus: (id: string, status: SshStatus) => void` durch (Zeile 391), genau wie bei `ClusterView` (`ClusterView.tsx:29`).
**Fix:** Es gelten die Props aus 1.12. `onStatusChange` ist Pflicht und wird mit `(tabId, tabStatus(state))` aufgerufen, und zwar nur, wenn sich der Wert ändert.

### B3 · Das Dock-Terminal verbindet sich bei einem Auswahlwechsel nicht neu
Der Effekt in `TerminalPanel.tsx` hängt nur an `[connection.id, kubeKey, tabId, onStatusChange]` (Zeile 186). Ein neues `connection.target` startet **keine** neue Session. Das Dock würde weiter die Logs des alten Containers zeigen.
**Fix:** Das Dock rendert `<TerminalPanel key={dockTerminalKey(row, mode, epoch)} tabId={`${tabId}:dock`} … />`, so wie `DetailDock.tsx:171`. `TerminalPanel.tsx` bleibt unverändert. Kopiert wird aus `liveSessions.get(`${tabId}:dock`)`.

### B4 · Die Registry aus Welle 2 kann den Reducer aus Welle 3 nicht typisieren
`KUBE_COMMANDS.unavailable` bekommt `KubeViewState`. `CONTAINER_COMMANDS` (T5, Welle 2) gäbe es aber vor `container-view.ts` (T7, Welle 3) nicht, und Welle 2 würde nicht kompilieren.
**Fix:** Die Registry nimmt `ContainerCommandContext` (1.9). Die Komponente baut den Kontext aus `selectedRow(state)`. T5 importiert nichts aus `container-view.ts`.

### B5 · `containers:action` ist weder typsicher noch ausdrücklich verteilt
Wird `ContainerTarget | InventoryRef` mit `ContainerAction | 'remove'` vermischt, wären `remove` auf einem `ContainerTarget` (Seitenleiste) oder `shutdown` auf einem Image möglich. `ContainerDiscovery.action` nimmt nur `ContainerTarget`. Eine Überladung lässt sich nicht mit dem geparsten Union aufrufen.
**Fix:** Es gelten 1.3 und 1.7. Es gibt eine eigene Methode `inventoryAction`, ein eigenes `InventoryActionRequestSchema`, und es wird zuerst mit `safeParse` geprüft. `ActionRequestSchema` und `ContainerAction` bleiben unverändert. Testpflicht: `{ target: ContainerTarget, action: 'remove' }` wird abgewiesen.

### B6 · `linkUsage` hat keine Datenquelle
`usedBy` braucht Image-Referenz, `Mounts` und `Networks` der Container. Diese Werte stehen in keiner Spalte, und die Parser liefern sie getrennt.
**Fix:** Container-Zeilen tragen `links: ContainerLinks` (1.1). `parseContainerRows` füllt das Feld. Docker liefert `Image`, `Mounts` und `Networks` jeweils komma-getrennt. Podman liefert `Image`, `ImageID`, `Mounts` (Pfade), `Networks[]`. `linkUsage` liest nur `rows.containers[].links`. Regeln: C8.

### B7 · „Container mit diesem Volume/Netzwerk anzeigen“ hat keine Filterspalte
Der Reiter Container hat weder eine Spalte für Volumes noch für Netzwerke. Podman-`Mounts` sind Zielpfade und keine Volume-Namen.
**Fix:** Der Reiter Container bekommt die Spalte `networks` „Netzwerke“ · select. Die Werte sind mehrfach (`cellValues` trennt an `,`), die Auswahl trifft genau. Den Eintrag „Container mit diesem Volume anzeigen“ gibt es **in Stufe 1 nicht**. „Container in diesem Netzwerk anzeigen“ setzt `showContainersWith { key: 'networks', value: row.name }`.

### B8 · Lokal gibt es keine Probe
„Probe wie bei `list`“ gilt nur für SSH. Lokal hat `listLocal` keine Probe, es wertet nur `notFound` aus (`discovery.ts:98-108`).
**Fix (T6), Ablauf von `inventory`:**
1. **SSH:** `sudoSetting(connection)` (wirft bei einem Passwort mit Zeilenumbruch). Dann `PROBE_COMMAND` ohne sudo, mit `LIST_TIMEOUT` und über `probeOutput`. `runtimes` sind `docker` und dann `podman`, soweit vorhanden.
   **Lokal:** Für `docker` und dann `podman` läuft `inventoryArgv(rt, 'containers')` über `runLocal` mit `LIST_TIMEOUT`. `notFound` bedeutet, die Laufzeit fehlt. Das Ergebnis der gewählten Laufzeit wird als Container-Liste weiterverwendet.
2. `runtimes` leer: `throw new Error('Auf diesem Host wurde weder Docker noch Podman gefunden.')`.
3. Laufzeit: Ist der Parameter in `runtimes`, gilt er, sonst `runtimes[0]`. Es gibt keinen Fehler.
4. Die Arten laufen **nacheinander** in der Reihenfolge `INVENTORY_KINDS`, per SSH über `runWithSudo` und lokal über `runLocal`, jede mit `LIST_TIMEOUT`. Bei `code === 0` wird geparst. Sonst gilt `problems[kind] = result.notFound ? `${rt} ist nicht installiert.` : describeFailure(rt, result)`, und die Zeilen dieser Art sind `[]`.
5. `rows = linkUsage(rt, rows, !problems.containers)`. Dann `{ runtime, runtimes, rows, problems, at: Date.now(), ...(SSH ? { user: connection.username } : {}), sudo: SSH && connection.containers?.sudo === true }`.
6. Alles läuft in `try … catch (error) { throw readable(error); }` wie `list`. Bei SSH geht alles über `withHost`.

### B9 · Hostname und Ortsangabe sind in der Ansicht unbekannt
Die Ansicht kennt nur `connection.name` (`<Host> · Container`). Dialogtexte („auf `<host>`“) und Popout-Tabs („`Logs: web-1 @ <Host>`“) brauchen aber den Host. „auf Dieser Computer“ ist kein Deutsch.
**Fix:** `containerViewHostName(connection.name)` und `hostLabel(hostId, hostName)` (1.1, 1.9). Lokal ergibt das „diesem Computer“. Beispiel: „Container „web-1“ auf diesem Computer wird gestoppt.“

### B10 · Die Verbindung für Popout und Dock ist falsch gebaut
`{ ...connection, view: undefined, target }` erbt den Namen `<Host> · Container`. Der Popout-Tab hieße dann „srv · Container“ und hätte falsche Ordinalzahlen.
**Fix:** Dock und Popout nutzen `containerConnection(connection.id, hostName, connection.address, terminalTargetOf(row, mode))` aus `terminal-tabs.ts:31`. Das ist vorhanden und hat weder `view` noch einen Namenskonflikt. Popout: `onPopout(containerConnection(…))`. Ohne `onPopout` sagt die Ansicht „Hier lässt sich kein Tab öffnen.“

---

## 3. Korrekturen und Entscheidungen

### Shared (T1)

**C1 · `inventoryRefValid`:** `ref.length` liegt zwischen 1 und `MAX_REF_LENGTH`, die Laufzeit ist `docker` oder `podman`, `kind` liegt in `INVENTORY_KINDS`. Für `images` gilt `IMAGE_ID.test || IMAGE_NAME_TAG.test`, sonst `CONTAINER_REF.test`. Kein Muster lässt ein führendes `-`, ein Leerzeichen, `;`, `$`, `` ` ``, `<` oder `/` am Anfang zu. Damit gibt es keine Option-Injection, und nach dem Ref setzt kein Befehl ein `--`.

**C2 · `isInventoryRef`:** `(INVENTORY_KINDS as readonly string[]).includes(target.kind)`.

**C3 · `containerTone` (genaue Reihenfolge):**
1. `running`: Steht `(unhealthy)` im Status → `bad`. Steht `(health: starting)` oder `(starting)` darin → `warn`. Sonst `ok`.
2. `restarting` → `warn`.
3. `paused` und `created` → `muted`.
4. `exited` und `stopped`: Ist `exitCode` nicht gesetzt oder 0 → `muted`, sonst `bad`.
5. `dead` → `bad`, `unknown` → `warn`.

Der `status` wird ohne Beachtung der Groß- und Kleinschreibung verglichen.

**C4 · `containerViewHostName`:** Endet `name` auf `CONTAINER_VIEW_SUFFIX`, wird das Suffix abgeschnitten. Sonst bleibt `name` unverändert.

### Parser (T2)

**C5 · Zellen je Art** (Schlüssel = Spalte, `''` = unbekannt). Die Spalten `status` und `info` ersetzen die eine Status-Spalte aus der Recherche, denn als Auswahl über den Docker-Status-Text („Up 2 hours“) wäre jede Option einzeln.

| Art | Schlüssel · Label · Filter (T4 `COLUMNS`, in dieser Reihenfolge) | Quelle |
|---|---|---|
| containers | `name` Name · text · `status` Status · select · `info` Details · text · `image` Image · text · `ports` Ports · text · `project` Projekt · select · `pod` Pod · select (`podmanOnly`) · `networks` Netzwerke · select · `created` Erstellt · age | `status` = `InventoryState`. `info` = roher `Status`. Docker `Names` (erstes vor `,`), Podman `Names[0]`. Container-`ref` = Name, wenn `CONTAINER_REF` passt, sonst die ID. Passt keines, wird die Zeile verworfen (wie `parsers.ts:218-219`). Docker-Exit-Code aus `/^Exited \((-?\d+)\)/`, Podman `ExitCode` nur bei `exited`/`stopped`. `networks` werden mit `, ` verbunden. |
| images | `repository` Repository · text · `tag` Tag · text · `id` ID · text · `size` Größe · size · `usedBy` Benutzt · number · `created` Erstellt · age | `<none>` → `''`. `id` ist eine 12-stellige Anzeige ohne `sha256:`. `name` = `repo:tag`, ohne Tag die 12-stellige ID. `ref` = `repo:tag`, wenn `IMAGE_NAME_TAG` passt, sonst die volle ID ohne Präfix (gilt auch für zu strenge Grammatik wie `my__app` oder Großbuchstaben in der Registry). `size` ist eine Zahl (Bytes) oder `''`. Bei Podman ist `usedBy` = `Containers`, sofern es eine Zahl ist. Podman `Names[i]` wird beim letzten `:` nach dem letzten `/` in Repository und Tag getrennt. |
| volumes | `name` Name · text · `driver` Treiber · select · `mountpoint` Mountpoint · text · `usedBy` Benutzt · number · `created` Erstellt · age | Bei Docker fehlt `created` → `''`. Bei Podman ist `usedBy` = `MountCount`, sofern es eine Zahl ist. Ein Name, der nicht zu `CONTAINER_REF` passt, verwirft die Zeile. |
| networks | `name` Name · text · `driver` Treiber · select · `scope` Scope · select · `internal` Intern · select · `containers` Container · number · `created` Erstellt · age | Schlüssel tolerant lesen (`r.Name ?? r.name`, `r.ID ?? r.Id ?? r.id`, `r.CreatedAt ?? r.Created ?? r.created`). `internal` gibt bei `true`/`'true'` „ja“, bei `false`/`'false'` „nein“, sonst `''`. `ref` = Name, wenn `CONTAINER_REF` passt, sonst die ID. Passt keines, wird die Zeile verworfen. |

Zustände: `running`, `exited`, `paused`, `restarting`, `created`, `dead` und `stopped` werden direkt übernommen. Podman `configured` und `initialized` werden zu `created`. Alles andere wird zu `unknown`. Tones: Container über `containerTone`. Bei Images ist der Tone `muted`, wenn kein Tag da ist oder `usedBy === 0`, sonst `ok`. Bei Volumes ist er `muted` bei `usedBy === 0`, sonst `ok`. Netzwerke sind immer `ok`. Podman-Infra-Container (`IsInfra === true`) sind immer `muted`. `project` kommt zuerst aus `com.docker.compose.project`, sonst aus `io.podman.compose.project`. `pod` gibt es nur bei Podman, aus `PodName`. `linkUsage` setzt die Tones neu, sobald es `usedBy` setzt.

**C6 · `GROUP_OPTIONS`:** `containers` = Projekt (`project`), Status (`status`), Image (`image`), Pod (`pod`, `podmanOnly`). `images` = Repository (`repository`). `volumes` und `networks` = Treiber (`driver`). Der Gruppenschlüssel ist der erste Wert aus `cellValues`, sonst `''`. `''` steht am Ende und heißt „(ohne)“.

**C7 · `FILTER_HELP` (wörtlich):** `Text` · „Spalte enthält den Text“ · `web`. `Auswahl` · „genau dieser Wert, mit Anzahl“ · `running`. `Zahl` · „Vergleich mit >, >=, <, <=, =“ · `>0`. `Größe` · „Vergleich in Bytes, Einheiten B, kB, MB, GB, TB“ · `>100MB`. `Alter` · „jünger (<) oder älter (>) als s, m, h, d“ · `<10m`.

**C8 · `linkUsage`:** Docker-Images: Es zählen die Container, für die `normalizeImageRef(links.image) === normalizeImageRef(row.name)` gilt. Außerdem zählen die Container, bei denen `links.image` auf `IMAGE_ID` passt und ohne `sha256:` ein Präfix der Image-ID ist. Jeder Container zählt pro Zeile höchstens einmal. Bei Podman-Images bleibt `Containers` aus dem Parser. Docker-Volumes: Container mit `links.mounts.includes(name)`. Bei Podman-Volumes bleibt `MountCount`, fehlt es, ist der Wert `undefined`. Netzwerke beider Laufzeiten: Container mit `links.networks.includes(name)`, das ergibt `usedBy` und `cells.containers`. Ist `rows.containers` leer **und** ist die Container-Liste fehlgeschlagen (`problems.containers`), bleiben `usedBy` und die Zellen unbekannt. Dafür hat `linkUsage` den dritten Parameter `containersKnown` aus 1.5.

**C9 · `parseDockerTime`:** Bei einem String wird zuerst `/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.\d+)? ([+-]\d{2})(\d{2})(?: \S+)?$/` geprüft. Passt es, wird `new Date(`${d}T${t}${h}:${m}`).toISOString()` gebildet. Sonst wird `Date.parse` versucht, und bei `NaN` ergibt sich `''`. Eine Zahl wird als Unix-Sekunden gelesen. Ist sie größer als `1e12`, gilt sie als Millisekunden. Andere Typen ergeben `''`.

**C10 · `maskInspect`:** `JSON.parse` des Texts. Im ganzen Baum werden die Arrays unter dem Schlüssel `Env` maskiert, deren Elternschlüssel `Config` oder `ContainerConfig` heißt. Für jedes String-Element `NAME=wert` gilt: Passt `NAME` auf `/PASS|PASSWORD|PASSWD|PWD|SECRET|TOKEN|API_?KEY|PRIVATE_?KEY|CREDENTIAL/i`, wird daraus `NAME=***`. Elemente ohne `=` bleiben, wie sie sind. Zum Schluss `JSON.stringify(value, null, 2)`. Bei einem Parsefehler kommt der Originaltext zurück. Nur Main maskiert. Der Renderer bekommt nie den unmaskierten Text. Labels, `Cmd`, `Entrypoint` und Mounts bleiben unverändert (R8). Die README nennt diese Grenze ausdrücklich, auch Zugangsdaten in Werten wie `DATABASE_URL=postgres://u:p@…`.

### Befehle (T3)

**C11 · Argument-Arrays (exakt):**

| | docker | podman |
|---|---|---|
| containers | `['docker','ps','-a','--no-trunc','--format','{{json .}}']` | `['podman','ps','-a','--format','json']` |
| images | `['docker','images','--no-trunc','--format','{{json .}}']` | `['podman','images','--format','json']` |
| volumes | `['docker','volume','ls','--format','{{json .}}']` | `['podman','volume','ls','--format','json']` |
| networks | `['docker','network','ls','--no-trunc','--format','{{json .}}']` | `['podman','network','ls','--format','json']` |
| inspect | `[rt, word, 'inspect', ref]`, word = `container`/`image`/`volume`/`network` | gleich |
| start/stop/restart (containers) | `[rt, action, ref]` | gleich |
| remove containers | `[rt, 'rm', ref]` | gleich |
| remove images | `[rt, 'rmi', ref]` | gleich |
| remove volumes | `[rt, 'volume', 'rm', ref]` | gleich |

Kein Action-Argv enthält `-f`, `--force`, `-v`, `--volumes` oder `prune`. Das sichert ein Test über alle Kombinationen aus Laufzeit, Art und Aktion ab. Die Prüfreihenfolge in `inventoryActionArgv` ist: zuerst die Aktion (`INVENTORY_ACTIONS`), dann die Laufzeit, dann der `ref`.

### Chips, Registry, Dialoge (T5)

**C12 · `CHIPS` (Reihenfolge = Chip-Leiste):**
- `containers`: `attention` „Auffällig“ · attention · Tone `warn`/`bad`. `running` „Läuft“ · status · `state === 'running'`. `stopped` „Gestoppt“ · status · `exited`/`stopped`/`created`/`dead`. `paused` „Pausiert“ · status · `paused`. `compose` „Compose“ · trait · `project` ist gesetzt.
- `images`: `dangling` „Ohne Tag“ · trait · `cells.tag === ''`. `unused` „Unbenutzt“ · trait · `usedBy === 0`.
- `volumes`: `unused` „Unbenutzt“ · trait · `usedBy === 0`.
- `networks`: keine.

**C13 · `CONTAINER_COMMANDS`:** Es gilt die folgende Tabelle mit ihren wörtlichen Beschreibungen. Keine Bindung ist doppelt belegt.

| id | Gruppe | keys | bindings | Beschreibung | unavailable |
|---|---|---|---|---|---|
| down | Navigation | `↓` `j` | `j`, `ArrowDown` | Zeile nach unten | – |
| up | Navigation | `↑` `k` | `k`, `ArrowUp` | Zeile nach oben | – |
| tab | Navigation | `1–4` | `1`–`4` | Reiter wechseln | – |
| menu | Navigation | `Shift+F10` | `Shift+F10`, `ContextMenu`, `Shift+ContextMenu` | Kontextmenü der Zeile öffnen | – |
| help | Navigation | `?` | `?` | Hilfe mit allen Tasten und Filtern | – |
| reload | Ansicht | `F5` | `F5` | Neu laden | – |
| filter | Ansicht | `/` | `/` | Name filtern (Images: Repository) | – |
| attention | Ansicht | `w` | `w` | Nur auffällige Container ein/aus | `attentionChip(kind)` null → „Dieser Reiter hat keinen Chip „Auffällig“.“ |
| resetFilter | Ansicht | `F` | `F` | Alle Filter des Reiters zurücksetzen (Gruppierung bleibt) | – |
| logs | Ansicht | `l` | `l` | Logs des Containers anzeigen | not containers → „Nur für Container.“ |
| shell | Ansicht | `s` | `s` | Shell im Container | not containers → „Nur für Container.“, kein Zustand `running` → „Der Container läuft nicht.“ |
| inspect | Ansicht | `i` | `i` | Inspect anzeigen | row null → „Keine Zeile ausgewählt.“ |
| toggleDock | Ansicht | `Ctrl+j` | `Ctrl+j` | Unteres Panel ein- und ausblenden | – |
| popout | Ansicht | `Ctrl+Shift+T` | `Ctrl+Shift+T` | Logs oder Shell als eigenen Tab öffnen | !canPopout → „Hier lässt sich kein Tab öffnen.“, dock `inspect` → „Nur für Logs und Shell.“, sonst Logik wie logs/shell |
| restart | Aktionen | `r` | `r` | Container neu starten | `actionUnavailable(row,'restart')` |
| stop | Aktionen | `x` | `x` | Container stoppen | `actionUnavailable(row,'stop')` |
| remove | Aktionen | `Ctrl+d` | `Ctrl+d` | Container, Image oder Volume entfernen | `actionUnavailable(row,'remove')` |

`Enter` hat keine Funktion. Ein Doppelklick auf eine Container-Zeile öffnet die Logs im Dock (`dock: 'logs'`, Dock auf). Bei anderen Arten öffnet er Inspect. Nach `/` und in Eingabefeldern gelten nur `Escape` (Feld verlassen, Fokus zurück an die Tabelle) und die Pfeiltasten. Im Dock-Terminal greifen keine Tasten der Ansicht außer `Ctrl+j`, so wie im Cluster-Tab.

**C14 · `actionUnavailable` (wörtlich, in dieser Reihenfolge):**
1. Row null → „Keine Zeile ausgewählt.“
2. Die Aktion steht nicht in `INVENTORY_ACTIONS[kind]` → bei `networks` „Netzwerke lassen sich hier nicht ändern.“, sonst „Nur für Container.“
3. Container und `start`: Zustand `running`/`paused`/`restarting` → „Der Container läuft bereits.“
4. Container und `stop`: Zustand nicht `running`/`paused`/`restarting` → „Der Container läuft nicht.“
5. Container und `remove`: Zustand `running`/`paused`/`restarting` → „Laufende Container zuerst stoppen.“
6. Image und `remove`: `usedBy > 0` → „Das Image wird noch benutzt.“
7. Volume und `remove`: `usedBy > 0` → „Das Volume wird noch benutzt.“

`restart` ist sonst immer möglich. Ein unbekanntes `usedBy` sperrt nichts. Docker und Podman lehnen dann selbst ab, und der Fehlertext erscheint.

**C15 · `confirmationFor` (wörtlich; `where` = `hostLabel(...)`; Name in „…“):**

| Aktion | title | body | requireTyping | confirmLabel |
|---|---|---|---|---|
| start | – (Rückgabe `null`) | | | |
| stop | Container stoppen? | Container „{name}“ auf {where} wird gestoppt. | null | Stoppen |
| restart | Container neu starten? | Container „{name}“ auf {where} wird neu gestartet. | null | Neu starten |
| remove (containers) | Container entfernen? | Container „{name}“ auf {where} wird entfernt. Anonyme Volumes bleiben erhalten und erscheinen unter Volumes. | `row.name` | Entfernen |
| remove (images) | Image entfernen? | Image „{name}“ auf {where} wird entfernt. | `row.name` | Entfernen |
| remove (volumes) | Volume entfernen? | Volume „{name}“ auf {where} wird gelöscht. Die Daten gehen verloren. | `row.name` | Entfernen |

**Korrektur der Spec:** Ohne `-v` entfernt `docker rm` bzw. `podman rm` die anonymen Volumes **nicht**. Der Satz „Anonyme Volumes des Containers gehen verloren.“ ist falsch und wird ersetzt. Unter dem Eingabefeld steht: „Zum Bestätigen „{requireTyping}“ eintippen.“ Bei Images ist `row.name` entweder `repo:tag` oder die 12-stellige ID.

### Reducer (T7)

**C16 · Anfangszustand:** `kind: 'containers'`, `dock: 'logs'`, `dockOpen: true`, `loading: true`. Jede `KindView` ist leer: `{ filters: {}, chips: [], sort: null, groupBy: null, collapsed: [] }`. `epoch: 0`, `busy: []`.

**C17 · Auswahl:** Es gilt das Muster `keepSelection` aus `kube-view.ts:415-429`, jedoch ohne `containersOf`.
- Modus `'rows'` gilt für `setInventory` und `tick`. Ist die Auswahl nicht mehr sichtbar, springt sie auf dieselbe Position in `navigableRows`, sonst auf die letzte Zeile, sonst auf `null`.
- Modus `'filter'` gilt für `setColumnFilter`, `toggleChip`, `setChips`, `clearFilter` und `showContainersWith`. Bleibt die gewählte Zeile sichtbar, bleibt die Auswahl. Sonst wird sie `null`. Damit ist der Satz aus der Spec „Ändert man Filter oder Chips, wird die Auswahl `null`“ genauer gefasst.
- `setKind` setzt `selected: null`.
- `setInventory` mit einer anderen `runtime` als der vorige Stand setzt ebenfalls `selected: null`.
- Wechselt `selected` auf irgendeinem Weg, wird `armed` zu `null`.

**C18 · Laufzeit:** `setRuntime` setzt `requestedRuntime`, `loading: true` und `selected: null`. Der Hook lädt danach neu. `setInventory` übernimmt den Stand komplett, mit `loading: false` und `error: null`. `fail` setzt `loading: false` und `error`. Ein vorhandenes `inventory` bleibt dabei (alter Stand plus Fehler).

**C19 · Reiter und Dock:** Bei `setKind` auf eine andere Art als `containers` wird `dock` zu `inspect`, sofern es auf `logs` oder `shell` stand. `dock` auf `logs` oder `shell` bei einer anderen Art als `containers` ändert nichts. `dock` öffnet das Dock (`dockOpen: true`). `arm` setzt `armed = selected` nur, wenn `selectedRow` ein Container im Zustand `running` ist. `reloadDock` erhöht `epoch`. `sort` ohne `dir` schaltet zyklisch: keine Sortierung → `asc` → `desc` → `null`. `sort` mit `dir` setzt die Richtung direkt. Sortiert wird: `number`/`size` numerisch, `age` nach Zeit (jüngste zuerst bei `asc` nach Alter), sonst `localeCompare`. Leere Werte stehen immer am Ende. Ohne Sortierung bleibt die Reihenfolge des Hosts.

**C20 · `dockTerminalKey`:** `shell` ergibt `${row.uid}/shell`. `logs` ergibt `${row.uid}/logs/${epoch}`. Ein Poll ändert den Schlüssel nicht. Die Shell öffnet sich nie von selbst. Eine Shell wird nur gerendert, wenn `armed === row.uid` und `state === 'running'`.

**C21 · `showContainersWith`:** setzt `kind: 'containers'`, `views.containers.filters[key] = value`, setzt die übrigen Filter dieses Reiters **nicht** zurück und läuft über `keepSelection('filter')`. Bei Images wird `value` = `cells.repository`, bei einem Image ohne Tag die 12-stellige ID, als Textfilter auf `image`.

**C22 · `loadedLabel(at, now)`:** Unter 5 s heißt es „gerade geladen“. Unter 60 s „geladen vor {n} s“. Darüber „geladen vor {n} min“. Der Tick kommt alle 5 s und nur bei `visible`.

**C23 · `rootlessHint`:** Der Hinweis erscheint nur, wenn `hostId !== LOCAL_CONTAINER_HOST`, `inventory.runtime === 'podman'`, `!inventory.sudo`, `rows.containers.length === 0` und `!problems.containers`. Text: „Podman rootless zeigt nur Container des Benutzers {user}. Für Root-Container sudo aktivieren.“ `tabStatus` ergibt `connected`, wenn ein `inventory` da ist. Ohne `inventory` ergibt es `error`, wenn `error` gesetzt ist, sonst `connecting`.

### Menüs (T8)

**C24 · Zeile Container** (Gruppen durch `separator` getrennt; Hint = Taste nur bei der ausgewählten Zeile, sonst Grund):
- Logs (`l`) → `view [dock logs]`.
- Shell öffnen (`s`, ist der Container nicht `running`, deaktiviert mit „Der Container läuft nicht.“) → `view [select uid, dock shell, arm]`. Aus dem Menü öffnet sich die Shell also direkt. Die Taste `s` zeigt nur den Knopf.
- Inspect (`i`).
- Logs als Tab öffnen, Shell als Tab öffnen (nur `running`). Beide sind ohne `canPopout` deaktiviert mit „Hier lässt sich kein Tab öffnen.“
- Nur Projekt „{p}“ anzeigen (nur mit `project`).
- Nur „{chip.label}“ anzeigen (`primaryChip`, `setChips([id])`).

Kopieren:
- Name.
- ID.
- Image.
- Ports (leer → deaktiviert mit „Keine Ports.“).
- `{rt} logs -f {ref}`.
- `{rt} exec -it {ref} sh`.

`{ref}` ist `row.ref.ref`, also immer gültig. Aktionen:
- Starten.
- Stoppen… (`x`).
- Neu starten… (`r`).
- Entfernen… (`Ctrl+d`).

Alle vier laufen als `containerAction`, deaktiviert mit dem Grund aus `actionUnavailable`.

**C25 · Zeile Image:**
- Inspect.
- Container mit diesem Image anzeigen.

Kopieren:
- Referenz (ohne Tag deaktiviert mit „Das Image hat kein Tag.“).
- ID.
- `{rt} pull {name}` (nur wenn `IMAGE_NAME_TAG` passt, sonst deaktiviert mit „Name enthält ungültige Zeichen.“; ohne Tag „Das Image hat kein Tag.“).

Aktionen: Entfernen…

**Zeile Volume:**
- Inspect.

Kopieren: Name, Mountpoint. Aktionen: Entfernen…

**Zeile Netzwerk:**
- Inspect.
- Container in diesem Netzwerk anzeigen.

Kopieren: Name, ID. Keine Aktionen.

Kopier-Labels für `copiedMessage` sind wörtlich: „Name“, „ID“, „Image“, „Ports“, „Befehl“, „Referenz“, „Mountpoint“.

**C26 · Dock, Kopfzeile und Hintergrund:**
- **Dock:** Logs · Shell · Inspect · Logs neu starten (nur im Modus `logs` mit Container-Zeile → `dockReload`) · Als Tab öffnen · „Panel einklappen“.
- **Kopfzeile einer Spalte:** „Aufsteigend sortieren“ · „Absteigend sortieren“ · „Sortierung aufheben“ (deaktiviert ohne Sortierung, Hint „Standard: Reihenfolge des Hosts“) · „Nach {label} gruppieren“ (nur, wenn es in `groupOptionsFor` eine Option mit `id === column.key` gibt) · „Filter dieser Spalte leeren“ (deaktiviert, wenn leer).
- **Hintergrund:** „Alle Filter zurücksetzen“ (`clearFilter`, Hint `F`) · „Gruppierung aufheben“ (deaktiviert mit „Keine Gruppierung aktiv.“) · „Sortierung aufheben“ · „Aktualisieren“ (Hint `F5`, `reload`) · „Hilfe…“ (Hint `?`).

Das Dock-Terminal hat kein Menü.

**C27 · Aktionen nur über `confirm`:** Jede Einwirkung auf den Host ist `{ type: 'containerAction' }`, auch Starten. Erst `runner.confirm` entscheidet: Liefert `confirmationFor` `null`, läuft die Aktion sofort, sonst kommt der Dialog. Der Knopf „Starten“ im Dock-Platzhalter ruft ebenfalls `confirm(row, 'start')` auf. Kein Modul außer `ContainerView` ruft `containersAction` auf, und zwar nur in der Funktion `run(row, action)`. Sie macht nacheinander `busy`, `await containersAction({ hostId, target: row.ref, action })`, dann im `finally` `busy false` und `reload()`. Fehler gehen über `ipcMessage(error, 'Die Aktion ist fehlgeschlagen.')` in die Statuszeile.

### UI (T9)

**C28 · Texte (wörtlich):**
- Reiter: „Container“, „Images“, „Volumes“, „Netzwerke“, jeweils mit Zähler.
- Laufzeit-Auswahl: „Laufzeit“ mit „Docker“ und „Podman“, nur bei `runtimes.length > 1`.
- Knöpfe: „Aktualisieren“, „?“ (aria „Hilfe“).
- Statuszeile: „lade …“ und `loadedLabel`. Bei einem Fehler die Meldung und „Erneut versuchen“. Dazu `problems[kind]` des Reiters und `rootlessHint`.
- Zähler: „{n} von {m}“.
- Gruppierung: „Gruppieren nach“ mit „Keine Gruppierung“.
- Leer-Texte: „Keine Container.“, „Keine Images.“, „Keine Volumes.“, „Keine Netzwerke.“. Bei aktiven Filtern: „Keine Zeile passt zu den Filtern.“

Dock-Platzhalter:
- „Wähle einen Container, um Logs zu sehen.“
- „Wähle einen Container, um eine Shell zu öffnen.“
- „Wähle eine Zeile.“
- „Lade …“
- „Nur für Container.“
- „Die Shell startet erst auf Knopfdruck, damit Auswahlwechsel keine Verbindung öffnen.“ mit [Shell öffnen]
- „Der Container läuft nicht.“ mit [Starten]

Dock-Knöpfe: „Logs“, „Shell“, „Inspect“, „Als Tab öffnen“, „Kopieren“. Nichts kopiert: „Nichts zu kopieren.“

**C29 · CSS und Struktur:**
- `ContainerView.tsx` importiert `'../../kubernetes-ui.css'`, `'../../kubernetes-dock.css'` und `'../../containers-ui.css'` und nutzt die Klassen `.kube-*`.
- `containers-ui.css` enthält nur neue Klassen mit dem Präfix `.ctr-`.
- Die Tabelle zeichnet ab 200 Zeilen nur ein Fenster (wie `ResourceTable.tsx:9-12,52-65`).
- Die Dialoge nutzen `useNativeSurfaceBlock(true)`.
- `ContainerTable.tsx`, `ContainerDock.tsx`, `ContainerConfirm.tsx` und `ContainerHelp.tsx` sind interne Komponenten von T9. Ihre Props legt T9 selbst fest.

**C30 · Polling (`useContainerInventory`):**
- Laden beim Mount, wenn `visible` wahr wird, und bei jeder Änderung von `runtime`. Danach alle 10 s per `setTimeout`, aber nur bei `visible`. Der nächste Lauf wird erst nach der Antwort geplant.
- Es läuft nie mehr als eine Anfrage. `reload()` während einer laufenden Anfrage merkt sich genau einen Nachlauf.
- Jede Anfrage bekommt eine laufende Nummer. Antworten mit einer älteren Nummer und Antworten nach dem Unmount werden verworfen.
- Vor der Anfrage `dispatch({ type: 'loading' })`, danach `setInventory` oder `fail` mit `ipcMessage(error, 'Die Container konnten nicht geladen werden.')`.

### Verdrahtung und Doku (T10, T11)

**C31 · Verdrahtung:**
- **`App.openContainerView(hostId)`:** Bei SSH muss `host?.type === 'connection' && protocol === 'ssh'` gelten. Ist die Verbindung deaktiviert, kommt `setError(disabledNotice(host))`. Dann `navigateEditor` → Session-Limit → `terminals.open(containerViewConnection(hostId, name, address))`. Bei SSH sind `name` und `address` die der Verbindung, lokal `LOCAL_HOST_NAME` und `'lokal'`.
- **`VaultTree`:** neue Prop `onOpenContainerView?: (hostId: string) => void`. Der Eintrag „Container-Ansicht öffnen“ kommt direkt nach „Container anzeigen“ und ist bei `off` deaktiviert. Im Hintergrund-Menü kommt „Lokale Container-Ansicht öffnen“ nach „Lokale Container suchen“.
- **`LocalContainers`:** neue Prop `onOpenView?: (hostId: string) => void`. Die Überschrift „Dieser Computer“ bekommt `onContextMenu` mit einem `ContextMenu` und dem einzigen Eintrag „Lokale Container-Ansicht öffnen“.
- **`terminal-tabs.ts`:** `shellOf` liefert für `view === 'containers'` `null`, und das wird vor allem anderen geprüft. Dazu `containerViewConnection`.
- **`terminal-layout.ts`:** In `savedLayout` kommt `containerViews` dazu (Index der Tabs mit `view === 'containers'`). Lokale Tabs bleiben gefiltert. In `restoreLayout` gilt die Reihenfolge `containerTabs` → `containerViews` (nur bei `protocol === 'ssh'`, sonst normal) → `fileBrowsers`.
- `SecondaryWindow.tsx` und `container-tree.ts` bleiben unverändert.

**C32 · Doku:**
- README, Abschnitt „Container und VMs“: die Ansicht, Start über die Menüs, die Grenzen R6 (Seitenleiste stoppt ohne Nachfrage) und R8/C10 (Maskierung nur von `Config.Env`).
- Außerdem in der README: Polling alle 10 s. Mit sudo im Passwortmodus meldet sich jeder Poll viermal per sudo an, das steht im Auth-Log des Hosts. Zwei Tabs desselben Hosts pollen doppelt.
- CHANGELOG `## [0.9.0] – 2026-10-18` mit mindestens drei Punkten, zusammen mit `npm run version:minor` **im selben Commit**. Sonst scheitert `src/shared/version.test.ts`.
- In der Container-Spec ein Satz mit Verweis auf diese Spec.

---

## 4. Wellen (endgültig, Dateien je Welle disjunkt)

Gate nach jeder Welle: `npm run typecheck` und `npx vitest run` grün, ein Commit pro Task (Format laut CLAUDE.md).

| Welle | Task | Dateien (exakt) | Hängt ab von | Warum es nach der Welle kompiliert |
|---|---|---|---|---|
| 1 | **T1** Vertrag | `src/shared/containers.ts`, **neu** `src/shared/containers.test.ts`, `src/shared/containers-schema.ts`, `src/shared/containers-schema.test.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/shared/windows.ts`, `src/main/window-ipc.ts`, `src/shared/vault/types.ts`, `src/shared/vault/schema.ts`, `src/shared/vault/schema.test.ts` | – | Nur additive Typen. `view` wird als Union nur verglichen. Preload ohne Handler ist erlaubt. `containersAction` als Union nimmt den bestehenden Aufruf `useContainerDiscovery.ts:28` an. **Keine Kube-Datei.** |
| 2 | **T2** Parser | `src/main/containers/inventory-parsers.ts`, `inventory-parsers.test.ts` | T1 | neue Datei, niemand importiert sie |
| 2 | **T3** Befehle | `src/main/containers/commands.ts`, `commands.test.ts` | T1 | nur neue Exporte |
| 2 | **T4** Spalten | `src/renderer/src/container-columns.ts`, `container-columns.test.ts` | T1 | neue Datei |
| 2 | **T5** Chips, Registry, Dialogtexte | `src/renderer/src/container-status.ts`, `container-status.test.ts`, `container-commands.ts`, `container-commands.test.ts`, `container-confirm.ts`, `container-confirm.test.ts` | T1 | nutzt `ContainerCommandContext` (B4) und nichts aus T7 |
| 3 | **T6** Discovery und IPC | `src/main/containers/discovery.ts`, `discovery.test.ts`, `ipc.ts`, `validation.ts`, `validation.test.ts` | T2, T3 | Handler für Kanäle, die es schon gibt |
| 3 | **T7** Reducer | `src/renderer/src/container-view.ts`, `container-view.test.ts` | T4, T5 | neue Datei |
| 4 | **T8** Menüs | `src/renderer/src/container-menus.ts`, `container-menus.test.ts`, `container-menu-run.ts`, **neu** `container-menu-run.test.ts` | T5, T7 | neue Dateien |
| 5 | **T9** Komponenten | `src/renderer/src/components/containers/ContainerView.tsx`, `ContainerTable.tsx`, `ContainerDock.tsx`, `ContainerConfirm.tsx`, `ContainerHelp.tsx`, `src/renderer/src/hooks/useContainerInventory.ts`, `src/renderer/src/containers-ui.css` | T1–T8 | Noch nicht eingebunden, wird aber typgeprüft (`tsconfig.web.json`). |
| 6 | **T10** Verdrahtung | `src/renderer/src/App.tsx`, `components/SplitTerminalArea.tsx`, `components/VaultTree.tsx`, `components/LocalContainers.tsx`, `terminal-tabs.ts`, `terminal-tabs.test.ts`, `terminal-layout.ts`, `terminal-layout.test.ts` | T9 | Der Import von `ContainerView` existiert nach Welle 5. |
| 6 | **T11** Doku und Version | `README.md`, `CHANGELOG.md`, `package.json`, `package-lock.json`, `docs/superpowers/specs/2026-10-14-container-integration-design.md` | – (Text nach Spec) | keine Code-Dateien |

Nicht in der Zuteilung, weil keine Änderung nötig ist: alle `kube-*`-Dateien, `components/kubernetes/*`, `TerminalPanel.tsx`, `SecondaryWindow.tsx`, `container-tree.ts`, `ContainerChildren.tsx`, `src/main/ssh/session.ts`, `src/main/containers/parsers.ts`, `src/shared/vault/mutations.ts`, `src/renderer/src/global.d.ts` (sie nimmt `DesktopApi` automatisch).

---

## 5. Testpflichten je Task

**T1**
- `containers.test.ts`, `containerTone`: alle Zweige aus C3, auch `(unhealthy)` gegen `(healthy)`, `(health: starting)`, `(starting)`, `exited` ohne Code, mit 0 und mit 137, sowie `dead`, `unknown`, `created`, `paused` und `restarting`.
- `containers.test.ts`, `inventoryRefValid`: Angenommen werden `nginx:1.27`, `docker.io/library/nginx:latest`, `registry:5000/a/b:v1`, `harbor.local/proj/img:1.0`, `localhost/app:dev`, 12- und 64-stellige Hex-IDs mit und ohne `sha256:`. Abgelehnt werden `<none>:<none>`, `nginx` ohne Tag, `a b:1`, `x:1; rm -rf /`, `$(id):1`, `-f`, `--force`, `-rf:1`, `nginx@sha256:…`, mehr als 255 Zeichen, Laufzeit `proxmox` und Volume `-v`.
- `containers.test.ts`, weitere Fälle: `isInventoryRef`, `containerViewHostName`.
- Schema: `InventoryRefSchema` mit einem Extra-Schlüssel wird abgelehnt. `TerminalTargetSchema` mit `item.kind: 'image'` wird abgelehnt.
- `vault/schema.test.ts`: Ein alter Workspace ohne `containerViews` bleibt gültig, `containerViews: [0, 3]` ist gültig, `[64]` und `[-1]` werden abgelehnt.

**T2**
- Fixtures je Art und Laufzeit: Docker als JSON-Zeilen, Podman als Array. Dazu leere Ausgabe, `[]`, kaputte Zeile zwischen gültigen, Nicht-Objekte.
- Podman-Netzwerk mit kleingeschriebenen Schlüsseln, Podman-Image mit zwei `Names` (zwei Zeilen und zwei `uid`s, B1), Docker-Image mit zwei Tags derselben ID.
- Dangling-Image (`ref` = ID ohne `sha256:`), Image mit Tag, das nicht zu `IMAGE_NAME_TAG` passt (`ref` = ID), Container ohne gültigen Namen (`ref` = ID), Volume mit ungültigem Namen (verworfen).
- `parseDockerSize`: alle Einheiten, `0B`, Müll ergibt `null`. `parseDockerTime` mit `CEST`, `UTC` und `+0530 +0530`, Unix-Sekunden, Müll ergibt `''`. `parseLabels` mit String und Objekt. `podmanPorts`.
- Compose-Projekt aus beiden Labels samt Vorrang, Infra-Container `muted`.
- `linkUsage` (C8): `nginx` passt zu `nginx:latest`, `docker.io/library/nginx:latest` passt zu `nginx:latest`, ID-Präfix, ein Container zählt einmal. Ohne Quelle `undefined`. `containersKnown=false` lässt alles unbekannt. Ein Volume über `Mounts`, ein Netzwerk über `Networks`.
- `maskInspect`: `Config.Env` und `ContainerConfig.Env` maskiert, `PATH` und `HOME` unverändert, `Labels` und `Cmd` unverändert, Array mit zwei Objekten, ungültiges JSON bleibt.

**T3**
- Jede Kombination aus Laufzeit × Art für `inventoryArgv` exakt (C11).
- `inspectArgv` je Art.
- `inventoryActionArgv` über alle Kombinationen aus Laufzeit × Art × Aktion: Erlaubte Kombinationen ergeben das exakte Array, nicht erlaubte werfen „Diese Aktion ist hier nicht möglich.“
- Kein Token aus `-f`, `--force`, `-v`, `--volumes`, `prune` in irgendeinem Ergebnis.
- Ungültige Refs (`; rm`, `$()`, `<none>:<none>`, Leerzeichen, führendes `-`) werfen „Ungültige Container-Angabe.“
- `remoteCommand(inventoryArgv('docker','containers'), none)` quotet `'{{json .}}'`.

**T4**
- `columnsFor`: `pod` nur bei Podman.
- `cellValues` für `networks` (getrennt).
- `parseSizeFilter`: `>100MB`, `<= 1.5 GB`, `2048`, `=0`, `10 kb`; `>10XB` ergibt `null`. Größenfilter auf Bytes. Zahl- und Alter-Filter.
- Auswahl mit `EMPTY_VALUE`. Ungültige Filter sind ungültig und treffen alles.
- `facetValues` abhängig von den anderen Filtern, mit Anzahl. Die eigene Auswahl bleibt mit 0.
- `groupRows` ('' am Ende, eingeklappt). `groupOptionsFor`: `pod` nur bei Podman.
- `formatBytes` mit den Fällen aus 1.8. `displayCell`: leer ergibt `–`.

**T5**
- `CHIPS`: Prädikate, `compileChips` (ODER innerhalb, UND zwischen Gruppen), `chipCounts` mit allen IDs, `primaryChip`.
- Registry: keine Bindung doppelt, jede `description` nicht leer, `commandForKey('Ctrl+d')` ergibt remove, `F` ergibt resetFilter, `F5` ergibt reload, `?` ergibt help. Jede `unavailable`-Meldung wörtlich laut C13 und C14.
- `actionUnavailable`: alle Zweige.
- `confirmationFor`: alle Zeilen aus C15 wörtlich, `start` ergibt `null`, `hostLabel` lokal.

**T6**
- Fake-`RemoteHost.run` nach Befehlstext (Muster `discovery.test.ts`) prüft:
  - Docker vor Podman.
  - Parameter `podman` gewinnt.
  - Unbekannter Parameter fällt auf die erste Laufzeit zurück.
  - Ohne Laufzeit kommt die Meldung aus B8.
  - `images` scheitert, die anderen drei kommen trotzdem.
  - Timeout ergibt „Der Host hat nicht rechtzeitig geantwortet.“ in `problems`.
  - Die Probe scheitert, also kommt ein Fehler.
  - Die Listen laufen nacheinander (Reihenfolge der Aufrufe).
  - `user` und `sudo` sind gesetzt.
- Lokal: `notFound` für Podman, Docker liefert. Beide `notFound` ergeben die Meldung aus B8.
- `inspect` maskiert, und ein Fehler wird über `describeFailure` gemeldet.
- `inventoryAction`: `remove` auf `networks` wird abgewiesen, bevor etwas läuft. `rmi` per `repo:tag`. Lokal per `runLocal`.
- `validation.test.ts`: `InventoryActionRequestSchema` lehnt `shutdown` ab, und `ActionRequestSchema` lehnt `remove` auf einem `ContainerTarget` ab.

**T7**
- Auswahl nach einem Poll an derselben `uid`. Verschwindet die Zeile, springt die Auswahl auf den Nachbarn an derselben Position.
- Filter, der die Auswahl ausblendet, ergibt `null`. Filter, der sie zeigt, lässt sie stehen.
- Filter, Chips, Sortierung und Gruppierung bleiben je Reiter über `setKind` erhalten. `clearFilter` lässt die Gruppierung stehen.
- Laufzeitwechsel ergibt `selected: null`.
- `armed` wird beim Auswahlwechsel `null`. `arm` gilt nur bei einem laufenden Container.
- `setKind('images')` stellt das Dock auf `inspect`.
- Sortierzyklus.
- `showContainersWith`, `dockTerminalKey` (ein Poll ändert ihn nicht, `reloadDock` schon), `loadedLabel`, `rootlessHint` (alle Bedingungen), `tabStatus`.

**T8**
- Für jede Art: Reihenfolge der Einträge laut C24–C26.
- Hints nur bei der ausgewählten Zeile.
- Gesperrte Einträge mit wörtlichem Grund.
- **Jeder verändernde Eintrag ist `containerAction`, und kein `run` enthält eine Host-Aktion außerhalb davon** (Schleife über alle Ziele).
- Netzwerkzeile ohne Aktionen.
- `pull` bei Image ohne Tag ist gesperrt.
- Popout ohne `canPopout` ist gesperrt.
- `runMenuAction` ruft für jeden Typ genau eine Runner-Methode auf.

**T9:** Keine Komponententests (wie im Cluster-Tab). Pflicht sind grüner Typecheck und ein manueller Prüfabschnitt im Report:
- SSH-Host mit Docker und Compose, Podman rootless, Docker Desktop lokal.
- Jeden Reiter filtern und gruppieren.
- Logs wechseln mit der Auswahl (B3). Die Shell erst auf Knopfdruck.
- Inspect maskiert.
- Entfernen nur bis zum Dialog, dann abbrechen.
- Polling nur bei sichtbarem Tab (in DevTools prüfen).

**T10**
- `terminal-tabs.test.ts`: `containerViewConnection` für SSH und lokal, `shellOf` ergibt `null`, `sameTarget` unterscheidet `files` von `containers`, Ordinalzahlen.
- `terminal-layout.test.ts`: `savedLayout` schreibt `containerViews`. Eine lokale Ansicht wird nicht gespeichert. `restoreLayout` stellt die Ansicht wieder her, eine Nicht-SSH-Verbindung fällt auf den normalen Tab zurück, und die Reihenfolge aus C31 gilt.
- Manuell: Workspace speichern und laden, Tab in ein zweites Fenster ziehen (lädt neu, ohne „Als Tab öffnen“).

**T11:** `npm run check:version` und `src/shared/version.test.ts` sind grün.
