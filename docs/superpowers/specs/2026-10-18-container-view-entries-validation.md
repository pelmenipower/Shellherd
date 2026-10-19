# Laufzeit-Einträge statt Container-Listen – Validierung

Stand: 2026-10-18 · Branch `claude/feature/container-view-entries` (HEAD a369a8a) · geprüft gegen den echten Code, Baseline grün (`npm run typecheck` ok, `npx vitest run` 81 Dateien / 1119 Tests).

**Dieser Anhang ist bindend und geht Spec (`2026-10-18-container-view-entries-design.md`) und Plan (`docs/superpowers/plans/2026-10-18-container-view-entries.md`) vor.**

## Urteil

**ready after corrections** · 3 Blocker · 14 Korrekturen · 6 Entscheidungen

## 1. Prüfung der Annahmen

| Annahme im Plan | Befund |
|---|---|
| `discovery.ts:58-79` `list`, `:66-70` Docker/Podman-Schleife, `:116` stiller Fallback, `:167-177` `listLocal` | stimmt |
| `commands.ts:11-18` Probe, `:58-65` `listArgv` | stimmt |
| `parsers.ts:22-72`, `parseContainerList` nur in `discovery.ts` und `parsers.test.ts` benutzt | stimmt; `state()` bleibt (pct/qm nutzen sie) |
| sudo-Tests `discovery.test.ts:55-222` hängen an `has:docker` | stimmt; genaue neue Erwartungen siehe K3 |
| `container-tree.ts:48-84`, Tests `:61-63` | stimmt, aber die Reducer-Tests benutzen ein Container-Item (`web`, Zeile 5) → B1 |
| `ContainerChildren.tsx:25-29`, `:39` | stimmt; die Komponente kennt den Host-Namen nicht → K1 |
| `LocalContainers.tsx:12` | stimmt |
| `VaultTree.tsx:143`, `:160`, `:173`, `:213-214` | stimmt; `:213-214` muss `onOpenView` und `hostName` durchreichen (K1) |
| `App.tsx:162-166`, `:671-682`, `:688`, `:805-808` | stimmt |
| Fokus-Mittel: `terminals.select(id)` (`useTerminalTabs.ts:14`) | vorhanden; `useTerminalLayout` folgt der Auswahl in die richtige Ansicht und den richtigen Bereich (`useTerminalLayout.ts:13-25`, `terminal-views.ts:30-35`). Reihenfolge der Prüfungen ist falsch → B3 |
| `terminal-tabs.ts:36-38`, `:60-63`, `:93-101` | stimmt |
| `terminal-layout.ts:162`, `:182-183` | stimmt; `includes(index)` auf `(number \| WorkspaceContainerView)[]` kompiliert in Welle 1 |
| `window-ipc.ts:20-24` `.strict()` | stimmt; der Main reicht `tab.connection` unverändert weiter (`window-ipc.ts:118`), `adopt` im Reducer kopiert Felder einzeln → `runtime` muss in T3 dazu |
| `container-view.ts:15`, `:63-69`, `:83-89`; `ContainerView.tsx:45`, `:49`, `:252-259` | stimmt |
| `schema.ts:132`, `types.ts:207-208`, `schema.test.ts:144-152` | stimmt; sonst liest niemand `containerViews` (auch nicht `mutations.ts`) |
| `shared/ipc.ts:231` Kommentar | stimmt |
| README `102-128`, `130-158`, `151`; CHANGELOG `## [0.9.0]` | stimmt |
| Nicht zugeteilte Dateien (`useContainerDiscovery`, `SplitTerminalArea`, `SecondaryWindow`, Preload, `useContainerInventory`) | brauchen tatsächlich keine Änderung: Preload/IPC bleiben, `SecondaryWindow` übernimmt über `terminals.adopt` (T3), `SplitTerminalArea:398` reicht `tab.connection` an `ContainerView` |
| Tests gehören zum Typecheck (`tsconfig.web.json` schließt `src/renderer/src` ganz ein) | ja → B1 betrifft auch Testdateien |

Proxmox: Die SSH-Liste behält Probe → `pct list`/`qm list` mit `runWithSudo`, `ContainerChildren` behält Gruppen, Problemzeile, Menü, Doppelklick-Shell und `window.confirm` beim VM-Hartstopp (`App.tsx:688`). Nichts bricht, wenn K3 und B1 eingehalten werden.

## 2. Blocker (mit Fix)

**B1 · Welle 4 bricht den Typecheck.** Plan 4.5/T4 verlangt „`itemCommands`: Container ergibt `[]`“ und „Reducer-Tests bleiben“. Beides vergleicht bzw. erzeugt `kind: 'container'` als `DiscoveredItem` (`container-tree.test.ts:5-7`, `:59-60`). Nach der Verengung in T8 meldet `tsc` TS2367 bzw. TS2322, T8 darf diese Dateien aber nicht anfassen.
Fix (T4): `itemCommands` hat **keinen** Container-Zweig, nur die Gast-Logik von heute (`container-tree.ts:74-79`). In `container-tree.ts` und `container-tree.test.ts` kommt nach T4 kein `'container'` mehr vor. Die Reducer-Tests werden mit einem Gast gebaut: `const ct = { kind: 'lxc' as const, vmid: 101, name: 'ct', state: 'running' as const }`, `result = { runtimes: ['docker', 'proxmox'], problems: { proxmox: 'Proxmox-Befehle brauchen root.' }, items: [ct, { kind: 'vm', vmid: 100, name: 'win11', state: 'stopped' }] }`, busy/notice-Schlüssel `'lxc:101'` statt `'container:docker:web-1'`. Der Test „Container ergibt []“ entfällt.

**B2 · Widerspruch Spec S5 / Plan T6 beim Eintragsmenü.** Spec S5 und E3: „Docker-Ansicht öffnen“ am Eintrag öffnet **immer einen neuen Tab**. Plan T6 lässt es nur fokussieren. Die Spec gilt. Der Vertrag braucht dafür einen Parameter.
Fix: `onOpenView?: (hostId: string, runtime: ContainerRuntime, newTab?: boolean) => void` (Vertrag 3.5). Klick/Enter → `onOpenView(hostId, rt)`, Menü → `onOpenView(hostId, rt, true)`. App: `onOpenView: (id, rt, newTab) => openContainerView(id, rt, !newTab)`.

**B3 · Fokus scheitert am Session-Limit.** Plan 4.8 setzt „Prüfungen wie heute (672-676)“ vor die Wiederverwendung. Bei 16 offenen Tabs meldet ein Klick auf „Docker-Ansicht“ dann „Maximal 16 Sessions …“, statt den offenen Tab zu zeigen.
Fix: Reihenfolge laut Vertrag 3.8: Host-Prüfung, deaktiviert-Prüfung, dann in `navigateEditor` zuerst die Wiederverwendung, erst danach das Limit.

## 3. Vertrag (präzisiert, bindend)

### 3.1 `src/shared/containers.ts` (T1)

```ts
export const RUNTIME_LABEL: Record<ContainerRuntime, string> = { docker: 'Docker', podman: 'Podman' };
/** `<host> · Docker`, `<host> · Podman`; without runtime `<host> · Container` (CONTAINER_VIEW_SUFFIX). */
export function containerViewTabName(hostName: string, runtime?: ContainerRuntime): string;
/** Strips one trailing ' · Container', ' · Docker' or ' · Podman'; anything else stays unchanged. */
export function containerViewHostName(name: string): string;
```
`CONTAINER_VIEW_SUFFIX` und `LOCAL_HOST_NAME` bleiben exportiert.

### 3.2 `src/shared/windows.ts`, `src/main/window-ipc.ts` (T1)

```ts
// windows.ts: import type { ContainerRuntime, TerminalTarget } from './containers';
// TabConnection, after `kube?`:
/** Fixed runtime of a container view; absent = first runtime found, with the switcher in the header. */
runtime?: ContainerRuntime;
// window-ipc.ts TabConnectionSchema, after `target`:
runtime: z.enum(['docker', 'podman']).optional(),
```

### 3.3 Workspace (T1)

```ts
// types.ts (import ContainerRuntime from '../containers')
/** Container view at `index` in `connectionIds`; a bare number means no fixed runtime. */
export interface WorkspaceContainerView { index: number; runtime?: ContainerRuntime }
// WorkspacePane
/** Positions in `connectionIds` of SSH connections opened as container view; objects carry a fixed runtime. */
containerViews?: (number | WorkspaceContainerView)[];
// schema.ts:132
containerViews: z.array(z.union([
  z.number().int().min(0).max(63),
  z.object({ index: z.number().int().min(0).max(63), runtime: z.enum(['docker', 'podman']).optional() }).strict(),
])).max(64).optional(),
```

### 3.4 `terminal-tabs.ts`, `terminal-layout.ts` (T3)

```ts
export function containerViewConnection(hostId: string, hostName: string, address: string, runtime?: ContainerRuntime): TerminalConnection;
// = { id: hostId, name: containerViewTabName(hostName, runtime), protocol: hostId === LOCAL_CONTAINER_HOST ? 'cmd' : 'ssh', address, view: 'containers', ...(runtime ? { runtime } : {}) }
// sameTarget: bisherige Bedingung && (a.runtime ?? '') === (b.runtime ?? '')
// Reducer 'open' und 'adopt': runtime mit destrukturieren und wie view kopieren: ...(runtime ? { runtime } : {})
// savedLayout: const containerViews: (number | WorkspaceContainerView)[] = saved.flatMap((tab, index) =>
//   tab.connection.view !== 'containers' ? [] : [tab.connection.runtime ? { index, runtime: tab.connection.runtime } : index]);
// restoreLayout: const view = node.containerViews?.find(entry => (typeof entry === 'number' ? entry : entry.index) === index);
//   view !== undefined && connection.protocol === 'ssh'
//     ? containerViewConnection(connection.id, connection.name, connectionAddress(connection), typeof view === 'number' ? undefined : view.runtime)
// Reihenfolge der Zweige bleibt: containerTabs vor containerViews vor toTerminalConnection.
```

### 3.5 `container-tree.ts` (T4)

```ts
export interface ContainerTreeProps {
  state: ContainerTreeState;
  onExpand: (hostId: string) => void;
  /** Focuses an open view of this host and runtime or opens one; `newTab` always opens another. Optional until App wires it (wave 3). */
  onOpenView?: (hostId: string, runtime: ContainerRuntime, newTab?: boolean) => void;
  /** Proxmox guests only: shell or serial console. */
  onOpen: (hostId: string, item: DiscoveredItem, mode: TerminalTargetMode) => void;
  onAction: (hostId: string, item: DiscoveredItem, action: ContainerAction, confirm?: string) => void;
}
/** ['docker', 'podman'] filtered by result.runtimes, in that order. */
export function runtimeEntries(result: DiscoveryResult): ContainerRuntime[];
/** Only the Proxmox groups (lxc, vm), problem on the first one as today; never Docker or Podman groups. */
export function groupItems(result: DiscoveryResult): ItemGroup[];
/** Guest commands as today (container-tree.ts:74-79); no container branch (B1). */
export function itemCommands(item: DiscoveredItem): ItemCommand[];
/** runtimeEntries(result).length > 0 */
export function hasUsableLocalRuntime(result: DiscoveryResult): boolean;
```
Reducer, `HostDiscovery`, `ContainerTreeAction`, `ItemGroup`, `ItemCommand`, `ipcMessage` bleiben unverändert.

### 3.6 `container-view.ts`, `ContainerView.tsx` (T5)

```ts
// ContainerViewState, after requestedRuntime:
/** Runtime fixed by the tab; null = free, the header shows the switcher. */
pinned: ContainerRuntime | null;
export function initialContainerViewState(now: number, pinned: ContainerRuntime | null = null): ContainerViewState; // requestedRuntime: pinned, pinned
// reduce 'setInventory': if (state.pinned !== null && action.inventory.runtime !== state.pinned)
//   return { ...state, loading: false, error: `${RUNTIME_LABEL[state.pinned]} wurde auf diesem Host nicht gefunden.` };   // inventory, selected unverändert
// reduce 'setRuntime': if (state.pinned !== null) return state;
// ContainerView.tsx:49: useReducer(containerViewReducer, undefined, () => initialContainerViewState(Date.now(), connection.runtime ?? null));
// Umschalter (:252): state.pinned === null && inventory && inventory.runtimes.length > 1
// Titel (:250): <strong>{state.pinned ? `${hostName} · ${RUNTIME_LABEL[state.pinned]}` : hostName}</strong>
// RUNTIME_LABEL aus shared importieren, lokale Konstante :45 löschen.
```

### 3.7 Main `src/main/containers/` (T2)

```ts
// commands.ts
export function listArgv(kind: 'lxc' | 'vm'): string[];          // ['pct', 'list'] | ['qm', 'list']
/** Local presence check without touching the daemon. */
export function localProbeArgv(runtime: ContainerRuntime): string[]; // [runtime, '--version']
// parsers.ts: parseContainerList und containerRecords löschen; Importe CONTAINER_REF und ContainerRuntime entfallen.
// discovery.ts list(): SSH-Zweig wie heute ohne Zeilen 66-70; stattdessen
//   for (const runtime of ['docker', 'podman'] as const) if (tools.has(runtime)) result.runtimes.push(runtime);
//   Proxmox-Block (71-75) unverändert.
// listLocal(): for runtime of ['docker','podman']: argv = localProbeArgv(runtime); run = await runLocal(argv[0], argv.slice(1), LIST_TIMEOUT);
//   if (!run.notFound) result.runtimes.push(runtime);  — kein collect, items [], problems {}.
// Import parseContainerList entfällt. inventory/inspect/action/inventoryAction/withHost/sudoSetting unverändert.
```

### 3.8 `App.tsx` (T6)

```ts
function openContainerView(hostId: string, runtime?: ContainerRuntime, reuse = false): void {
  // 1. Host-Prüfung und deaktiviert-Prüfung wie heute (App.tsx:672-674).
  // 2. navigateEditor(() => {
  //      name/address wie heute; const connection = containerViewConnection(hostId, name, address, runtime);
  //      if (reuse) {
  //        const matches = terminals.tabs.filter(tab => sameTarget(tab.connection, connection));
  //        const open = matches.find(tab => tab.id === terminals.activeTabId) ?? matches[0];
  //        if (open) { terminals.select(open.id); setEditorOpen(false); setEditorDirty(false); setError(null); return; }
  //      }
  //      Session-Limit wie heute; terminals.open(connection); setEditorOpen(false); setEditorDirty(false); setError(null);
  //    });
}
// containerTree.onOpenView = (id, rt, newTab) => openContainerView(id, rt, !newTab)
// VaultTree onOpenContainerView={id => openContainerView(id)}; LocalContainers onOpenView={id => openContainerView(id)}  (Lambdas, keine Funktionsreferenz)
// sameTarget aus './terminal-tabs' importieren.
```
Tabs in einem zweiten Fenster sind für den Hauptfenster-Fokus unsichtbar; dann öffnet der Klick einen Tab im Hauptfenster. Das ist gewollt (E6 unten).

### 3.9 `ContainerChildren.tsx`, `LocalContainers.tsx`, `VaultTree.tsx` (T6)

```ts
interface ContainerChildrenProps extends Omit<ContainerTreeProps, 'state' | 'onExpand'> {
  hostId: string;
  /** Shown in the entry tooltips. */
  hostName: string;
  discovery: HostDiscovery | undefined; depth: number; disabled: boolean; onRefresh: () => void;
}
```
- VaultTree `:213-214`: zusätzlich `hostName={node.name} onOpenView={containers.onOpenView}`.
- LocalContainers: `hostName={LOCAL_HOST_NAME}`, `onOpenView={containers.onOpenView}` an `ContainerChildren`. Die eigene Prop `onOpenView?: (hostId: string) => void` der Komponente bleibt für das Heading-Menü (freie Ansicht).

### 3.10 Welle 4 (T8)

```ts
export type DiscoveredItem = { kind: 'lxc' | 'vm'; vmid: number; name: string; state: ItemState };
export function toTarget(item: DiscoveredItem): ContainerTarget { return { kind: item.kind, vmid: item.vmid, name: item.name }; }
// ContainerTarget, itemKey, targetKey, TerminalTarget, DiscoveryResult (problems-Typ) unverändert.
// Kommentar an DiscoveryResult.problems: "Per runtime kind: a short German message when listing failed; only 'proxmox' is filled."
```

## 4. Korrekturen (wörtliche Texte)

- **K1 Tooltip und Host-Name.** Eintrag-`title`, SSH: „Container, Images, Volumes und Netzwerke von `<Host>` (Docker)“ bzw. „… (Podman)“. Lokal (`hostId === LOCAL_CONTAINER_HOST`): „Container, Images, Volumes und Netzwerke auf diesem Computer (Docker)“ bzw. „… (Podman)“.
- **K2 Eintragszeile.** Markup wie eine Gastzeile: `li > div.vault-tree-row.container-row` (Einrückung `depth * 14 + 14`), `span.tree-toggle-spacer`, `button.tree-node-button` mit `disabled={disabled || !onOpenView}`, Icon `span.container-entry-icon` mit einem Inline-SVG (für beide Laufzeiten gleich, `aria-hidden="true"`, 14×14, `viewBox="0 0 24 24"`, `fill="none" stroke="currentColor" strokeWidth="1.5"`, Pfad `M3 7.5 12 3l9 4.5v9L12 21l-9-4.5v-9Zm0 0 9 4.5 9-4.5M12 12v9`), Text `span.tree-node-text > span` „Docker-Ansicht“ bzw. „Podman-Ansicht“. `onClick` und `Enter` → `onOpenView(hostId, rt)`. Rechtsklick sowie `ContextMenu`/`Shift+F10` → Menü mit Label „Aktionen für Docker-Ansicht“ bzw. „Aktionen für Podman-Ansicht“ und den Einträgen „Docker-Ansicht öffnen“ (bzw. „Podman-Ansicht öffnen“, `hint: 'neuer Tab'`, `onOpenView(hostId, rt, true)`), Trenner, „Aktualisieren“ (`onRefresh`). Das Menü öffnet nicht, wenn `disabled`. CSS (`navigation-ui.css`), eine Regel: `.container-entry-icon { display: inline-flex; flex: 0 0 14px; margin: 0 8px 0 2px; color: var(--ui-muted); }`.
- **K3 Reihenfolge und Zustände in `ContainerChildren`.** Laden ohne Cache: „Suche Laufzeiten …“. Fehler: Meldung + „Erneut versuchen“ wie heute. Sonst in dieser Reihenfolge: „Aktualisiere …“ (wenn `refreshing`), Einträge aus `runtimeEntries`, Proxmox-Gruppen aus `groupItems` (Code wie heute ohne alle Container-Zweige). Leer-Notiz, wenn Einträge und Gruppen leer sind: „Keine Container-Laufzeit gefunden.“, aber wenn `result.runtimes.includes('proxmox')`: „Keine Proxmox-Gäste gefunden.“ (sonst behauptete die Seitenleiste bei einem leeren Proxmox-Knoten, es gebe keine Laufzeit). Der Gast-`title` bleibt `` `${'CT'|'VM'} ${vmid} — ${STATE_LABEL[state]}` ``, der Text `` `${vmid} ${name}` ``.
- **K4 VaultTree-Texte.** `:143` „Lokale Laufzeiten suchen“; `:160` „Laufzeiten anzeigen“ (Verhalten wie heute); `:173` aria-label `` `Laufzeiten von ${node.name} ${expandedHosts.has(node.id) ? 'zuklappen' : 'anzeigen'}` ``; Kommentar `:40` „Runtime entries and Proxmox guests below SSH connections; omitted hides them.“
- **K5 LocalContainers.** Kommentar „"Dieser Computer": shown when the docker or podman CLI is installed.“ Rest unverändert.
- **K6 sudo-Tests (T2), genaue Erwartungen.**
  - `answers` (`:26-31`): Docker-Zeile löschen. Test `:36` heißt „lists runtimes from the probe and reports Proxmox permission problems“: `runtimes ['docker','proxmox']`, `items []`, `problems.proxmox` enthält „root“, `problems.docker` undefiniert.
  - `:61-78`: Probe `ok('has:pct\n')`; `argvs = [listArgv('lxc'), ['pct', 'start', '101']]`; `toHaveLength(3)`; Marker-Set `.size` `4`.
  - `:79-87`: Probe `ok('has:pct\n')`; `host.commands[1]` `` `${P} sudo -n pct list` ``.
  - `:88-94`: Probe `ok('has:pct\n')`; `` `${P} pct list` ``.
  - `:104-115`: Probe unverändert (alle vier); `problems` `toEqual({ proxmox: 'Das sudo-Passwort wurde abgelehnt.' })`; Passwort genau einmal; zusätzlich kein Befehl außer der Probe enthält `docker` oder `podman`.
  - `:116-135`, `:208-222`: Probe `ok('has:pct\n')`, Erwartung `problems.proxmox`.
  - Testnamen sonst unverändert.
- **K7 Test „Seitenleiste fragt Docker nicht“ (T2).** SSH: Probe `has:docker\nhas:podman\n`, Verbindung mit `containers: { sudo: true }` und Passwort → `host.commands` ist genau `[PROBE]`, `host.sudo.filter(Boolean)` leer. Lokal: `runLocal` wird nur mit `('docker', ['--version'], 15_000)` und `('podman', ['--version'], 15_000)` aufgerufen. Fälle: nur docker → `runtimes ['docker']`; beide `notFound` → `runtimes []`; `code: 1` ohne `notFound` → zählt als vorhanden (S6).
- **K8 `commands.test.ts:86-92`.** Nur noch `lxc`/`vm`; neu: `localProbeArgv('docker')` → `['docker', '--version']`, `localProbeArgv('podman')` → `['podman', '--version']`.
- **K9 `parsers.test.ts`.** `:30-46` (Describe `parseContainerList`) löschen und den Import anpassen; die Fixtures in `:4-13` nur löschen, wenn sie ausschließlich dort benutzt werden.
- **K10 Ungenutzte Importe** entfernen: `parsers.ts` (`CONTAINER_REF`, `ContainerRuntime`), `commands.ts` (`RuntimeKind`, falls ungenutzt), `discovery.ts` (`parseContainerList`), `terminal-tabs.ts` (`CONTAINER_VIEW_SUFFIX`, falls ungenutzt).
- **K11 `shared/ipc.ts:231`** Kommentar: „Probes an SSH connection or this computer for Docker and Podman and lists Proxmox guests; always fresh.“
- **K12 T7 vollständig.** E9 verlangt je einen Satz in `docs/superpowers/specs/2026-10-14-container-integration-design.md` und `2026-10-18-container-view-design.md`. Diese Dateien gehören zu T7. Satz: „Die Seitenleiste für Docker und Podman regelt seit 2026-10-18 `2026-10-18-container-view-entries-design.md`: Einträge „Docker-Ansicht“/„Podman-Ansicht“ statt Container-Listen.“ README zusätzlich `:115`: „`Lokale Container suchen`“ → „`Lokale Laufzeiten suchen`“.
- **K13 Abhängigkeiten.** T8 hängt von T2, **T4** und T6 ab.
- **K14 Fallback-Text** in `useContainerDiscovery.ts:19` bleibt („Die Container konnten nicht geladen werden.“). Die Datei wird nicht angefasst.

## 5. Entscheidungen

| # | Entscheidung | Warum |
|---|---|---|
| E1 | Feste Laufzeit, die fehlt (S4): Renderer lehnt ab, `inventory` und `selected` bleiben, Polling läuft weiter. Main bleibt bei `discovery.ts:116`. | Spec S4/E6. Folge: In diesem Randfall führt Main alle 10 s die Inventar-Befehle der anderen Laufzeit aus. Das ist akzeptiert, weil es selten vorkommt und nur lesend ist. |
| E2 | Bei Fokus wird der aktive passende Tab bevorzugt, sonst der erste. | deterministisch |
| E3 | Fokus läuft durch `navigateEditor` und schließt den Editor wie das Öffnen. | gleiches Verhalten, ungespeicherte Änderungen werden abgefragt |
| E4 | Kopf der Ansicht mit fester Laufzeit: Titel `<Host> · Docker`. | Ohne Umschalter sieht man sonst nicht, welche Laufzeit die Ansicht zeigt. |
| E5 | Ein Icon für beide Laufzeiten (K2). Das ist kein Laufzeit-Icon im Sinne der Extras. | Plan T6 und Extras widersprechen sich sonst. |
| E6 | Tabs in Zweitfenstern werden nicht fokussiert. | Es gibt keinen fensterübergreifenden Fokus-Kanal, und S9/R9 schließen neue IPC aus. |

## 6. Wellen (endgültig, Dateien je Welle disjunkt)

Gate nach jeder Welle: `npm run typecheck` und `npx vitest run` grün. Ein Commit je Task.

| Welle | Task | Dateien (exakt) | Hängt ab von |
|---|---|---|---|
| 1 | T1 Vertrag | `src/shared/containers.ts`, `src/shared/containers.test.ts`, `src/shared/windows.ts`, `src/main/window-ipc.ts`, `src/shared/vault/types.ts`, `src/shared/vault/schema.ts`, `src/shared/vault/schema.test.ts`, `src/shared/ipc.ts` | – |
| 2 | T2 Main | `src/main/containers/commands.ts`, `commands.test.ts`, `parsers.ts`, `parsers.test.ts`, `discovery.ts`, `discovery.test.ts` | T1 |
| 2 | T3 Tabs/Layout | `src/renderer/src/terminal-tabs.ts`, `terminal-tabs.test.ts`, `terminal-layout.ts`, `terminal-layout.test.ts` | T1 |
| 2 | T4 Baumlogik | `src/renderer/src/container-tree.ts`, `container-tree.test.ts` | – |
| 2 | T5 Ansicht | `src/renderer/src/container-view.ts`, `container-view.test.ts`, `src/renderer/src/components/containers/ContainerView.tsx` | T1 |
| 3 | T6 Seitenleiste/App | `src/renderer/src/components/ContainerChildren.tsx`, `LocalContainers.tsx`, `VaultTree.tsx`, `src/renderer/src/App.tsx`, `src/renderer/src/components/navigation-ui.css` | T3, T4, T5 |
| 3 | T7 Doku | `README.md`, `CHANGELOG.md`, `docs/superpowers/specs/2026-10-14-container-integration-design.md`, `docs/superpowers/specs/2026-10-18-container-view-design.md` | – |
| 4 | T8 Aufräumen | `src/shared/containers.ts`, `src/shared/containers.test.ts` | T2, T4, T6 |

Kompiliert jede Welle?
- W1: `containerViews` als Union. `includes(index)` (`terminal-layout.ts:182`) und `number[]` aus `savedLayout` sind zuweisungskompatibel. `runtime?` ist optional, `RUNTIME_LABEL` in `ContainerView.tsx:45` bleibt bis T5 lokal (kein Import-Konflikt).
- W2: `onOpenView` ist optional, `initialContainerViewState` hat einen Default (`container-menus.test.ts:20` kompiliert weiter). `listArgv('docker')` wird nur in T2-Dateien benutzt. Bis T6 zeigt das alte `ContainerChildren` nur Proxmox-Gruppen. Das ist ein gewollter Zwischenstand und wird nicht ausgeliefert.
- W3: Nach T6 vergleicht keine Datei `DiscoveredItem.kind` mit `'container'`, mit B1 auch die Testdateien nicht.
- W4: Prüfung vor dem Commit: `rg "kind: 'container'" src/renderer/src/container-tree* src/renderer/src/components/ContainerChildren.tsx` ergibt keinen Treffer. `itemKey` und `useContainerDiscovery` vergleichen über `ContainerTarget` und kompilieren weiter.

## 7. Testpflichten

- **T1:** `containerViewTabName('srv')` → `srv · Container`, mit `'docker'` → `srv · Docker`, mit `'podman'` → `srv · Podman`. `containerViewHostName` für alle drei Suffixe, einen Fremdnamen und `' · Dockerx'` (bleibt). `RUNTIME_LABEL` beider Werte. Schema: `[{ index: 0, runtime: 'docker' }]` gültig, `[{ index: 0 }]` gültig, `[0, { index: 2, runtime: 'podman' }]` gültig, `[{ index: 0, runtime: 'proxmox' }]` ungültig, `[{ index: 0, extra: 1 }]` ungültig, `[{ index: 64, runtime: 'docker' }]` ungültig, bestehende Fälle `:148-152` bleiben.
- **T2:** K6, K7, K8, K9. Der Lokal-Fehlerpfad (`:314-315`, `runLocal` lehnt ab) wirft weiter einen `Error`.
- **T3:** Name und Feld (`srv · Docker`, `runtime: 'docker'`). Ohne Laufzeit genau wie heute (`:133-134` unverändert). `sameTarget(docker, podman)` false, `(docker, ohne)` false, `(docker, docker)` true. Ordinalzahlen je Laufzeit (`[docker, docker, podman]` → `[1, 2, 1]`). Reducer `open` **und** `adopt` behalten `runtime`. Layout: `savedLayout` schreibt `{ index, runtime }` bzw. `index`. `restoreLayout` mit `[{ index: 0, runtime: 'podman' }]` ergibt Name `server01 · Podman` und `runtime: 'podman'`, mit `[0]` keine `runtime`. Rundreise speichern → laden erhält die Laufzeit. RDP-Fallback und „containerTabs gewinnt“ (`:210-217`) bleiben.
- **T4:** `runtimeEntries` (`['podman','docker','proxmox']` → `['docker','podman']`, `['proxmox']` → `[]`). `groupItems` bei `['docker','proxmox']` nur Proxmox-Gruppen. Problemzeile einmal. `itemCommands` für LXC/VM wie heute. `hasUsableLocalRuntime` true bei `['docker']` (auch mit `problems.docker`), false bei `['proxmox']` und `[]`. Reducer-Tests mit Gast-Items (B1).
- **T5:** `initialContainerViewState(NOW, 'podman')` → `pinned` und `requestedRuntime` `'podman'`. Mismatch auf leerem Stand → `error` wörtlich „Podman wurde auf diesem Host nicht gefunden.“, `inventory null`, `tabStatus` `'error'`. Mismatch nach geladenem Stand → `inventory` und `selected` unverändert. Passende Laufzeit → normal, `error null`. `setRuntime` bei `pinned` gibt denselben Stand zurück (`toBe`). Ohne `pinned` bleibt `:63-67` grün.
- **T6 (manuell, im PR beschreiben):** Host mit Docker und Podman (zwei Einträge, Klick fokussiert, Menü öffnet zweiten Tab `srv · Docker (2)`, kein Umschalter, Titel mit Laufzeit), nur Proxmox (Gruppen, Doppelklick-Shell, VM-Hartstopp fragt), ohne alles, nicht erreichbar (Fehler + „Erneut versuchen“), „Dieser Computer“ mit gestopptem Docker Desktop (Eintrag da, Fehler in der Ansicht), Fokus bei 16 offenen Tabs (B3), Workspace speichern/laden mit festen und freien Ansichten, alter Workspace mit `containerViews: [0]`, Docker-Tab in zweites Fenster ziehen und zurück.
- **T8:** `toTarget` für LXC und VM. `itemKey({ kind: 'container', runtime: 'docker', ref: 'web-1', name: 'web-1' })` → `container:docker:web-1` bleibt.

## 8. Sicherheit

- Die Seitenleiste führt keinen Docker- oder Podman-Befehl mehr aus, auch nicht mit sudo (K7 sichert das ab). Die Probe läuft ohne sudo wie bisher.
- Keine neue IPC. `containers:list` behält Schema und Validierung, Preload unverändert.
- `runtime` im Fenster-Transfer ist ein Enum mit `.strict()`. Im Workspace-Schema ist es ein Enum in einem `.strict()`-Objekt. Es kommen keine Secrets und keine freien Strings dazu.
- Kube-Dateien, `session.ts`, `TerminalPanel.tsx`, `inventory-parsers.ts` und `containers-schema.ts` werden nicht angefasst (S9).
