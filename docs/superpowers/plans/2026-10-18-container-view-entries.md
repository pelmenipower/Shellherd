# Laufzeit-Einträge statt Container-Listen in der Seitenleiste – Recherche

Stand: 2026-10-18 · Branch `claude/feature/container-view-entries` (gestapelt auf `claude/feature/container-view`, PR #13) · Version bleibt 0.9.0 (unveröffentlicht)

> „beim aufklappen eines ssh verbindung sollte nicht die docker und container augeklappt werden. sonder man kann sowas haben wie "docker ansicht" "podmanansicht" das wäre viel eleganter und darüber gelangt man zur UI. keine notwendigkeit mehr die container zu listen“

Bindend bleiben: `docs/superpowers/specs/2026-10-14-container-integration-design.md` (Sicherheit, sudo, Befehlsbau, Proxmox), `2026-10-18-container-view-design.md` und `-validation.md` (Ansicht). Diese Recherche hebt genau zwei Punkte davon auf: den Abschnitt „Seitenleiste“ der Container-Spec für Docker/Podman und Ruling R6 der Ansichts-Spec („Die Seitenleiste bleibt unverändert“).

## 0. Empfehlung in einem Absatz

Beim Aufklappen läuft weiter die **billige Probe** (`has:docker` / `has:podman` / `has:pct` / `has:qm`, ein SSH-exec ohne sudo), aber **kein `docker ps` und kein `podman ps` mehr**. Unter dem Host erscheinen pro gefundener Laufzeit die Einträge **„Docker-Ansicht“** und **„Podman-Ansicht“**; ein Klick öffnet den Tab `<Host> · Docker` bzw. `<Host> · Podman` oder springt zu ihm, wenn er schon offen ist. **Proxmox LXC und VMs bleiben als Liste**, denn dafür gibt es keine Ansicht, und Shell, serielle Konsole, Start/Stop/Herunterfahren laufen dort weiter wie heute. Die Laufzeit wandert als neues Feld `TabConnection.runtime` in den Tab, in `sameTarget` und in den Workspace; mit fester Laufzeit verschwindet der Umschalter im Kopf der Ansicht. „Dieser Computer“ zeigt die gleichen Einträge, die lokale Probe ist `docker --version` / `podman --version`. Container-Zeilen, ihr Kontextmenü (Shell/Logs/Start/Stop), `parseContainerList` und die Docker/Podman-Zweige von `listArgv` fliegen raus. Main-Änderung: klein (Probe statt Liste, eine Schema-Zeile).

## 1. Bestand mit Belegen

### 1.1 Seitenleiste heute

| Was | Wo |
|---|---|
| SSH-Knoten aufklappbar, jedes Aufklappen ruft `containers.onExpand(id)` | `src/renderer/src/components/VaultTree.tsx:70-81`, `:172-174`, `:213-214` |
| Kontextmenü SSH: „Container anzeigen“, „Container-Ansicht öffnen“ | `VaultTree.tsx:160-161` |
| Hintergrund-Menü: „Lokale Container suchen“, „Lokale Container-Ansicht öffnen“ | `VaultTree.tsx:142-144` |
| Zustände „Suche Container …“, Fehler + „Erneut versuchen“, „Keine Container gefunden.“, „Aktualisiere …“ | `src/renderer/src/components/ContainerChildren.tsx:25-29`, `:39` |
| Gruppen Docker/Podman/Proxmox LXC/Proxmox VMs mit allen Einträgen, Status-Punkt, Tooltip | `ContainerChildren.tsx:40-73`, `src/renderer/src/container-tree.ts:48-63` |
| Zeilen-Kontextmenü: Shell öffnen, Logs folgen, Neu starten, Stoppen, Starten (Container) bzw. Shell/Serielle Konsole, Herunterfahren, Stoppen (Gäste) | `container-tree.ts:65-80`, `ContainerChildren.tsx:30-35` |
| Doppelklick/Enter öffnet Shell bei laufenden Containern und LXC, nie bei VMs | `ContainerChildren.tsx:47-58` |
| Aktion mit `window.confirm` nur bei VM-Hartstopp | `src/renderer/src/App.tsx:688` |
| Hook mit Cache je Host, `containersList`, `act` → `containersAction` | `src/renderer/src/hooks/useContainerDiscovery.ts:10-34` |
| Reducer (loading/ready/error, busy, notice, refreshing) | `container-tree.ts:11-44`, Tests `container-tree.test.ts:9-43` |
| „Dieser Computer“ nur, wenn eine Laufzeit **antwortet** (`hasUsableLocalRuntime`) | `src/renderer/src/components/LocalContainers.tsx:12`, `container-tree.ts:82-84` |
| Lokale Probe einmal je entsperrtem Vault | `App.tsx:162-166` |
| Container-Shell/Logs-Tab aus der Seitenleiste | `App.tsx:658-669` (`openContainer`), `terminal-tabs.ts:24-33` |
| CSS der Gruppen, Punkte, Notizen | `src/renderer/src/components/navigation-ui.css:58-67` |

### 1.2 Main

| Was | Wo |
|---|---|
| `list(hostId)`: Probe, dann `docker ps -a` / `podman ps -a` je Laufzeit, dann `pct list` / `qm list` | `src/main/containers/discovery.ts:58-79` |
| Lokal: kein Probe-Skript, `docker ps -a` mit `notFound` als „nicht installiert“ | `discovery.ts:167-177` |
| `inventory(hostId, runtime?)`: eigene Probe, fällt bei unbekannter Laufzeit **stillschweigend** auf `runtimes[0]` zurück | `discovery.ts:99-139`, Zeile 116 |
| Probe-Skript, `listArgv('docker'|'podman'|'lxc'|'vm')` | `src/main/containers/commands.ts:11-18`, `:58-65` |
| `parseContainerList`, `parsePctList`, `parseQmList`, `parseProbe` | `src/main/containers/parsers.ts:22-72` |
| IPC `containers:list` mit `ListRequestSchema` | `src/main/containers/ipc.ts:24-27`, `validation.ts:5` |
| `runLocal` setzt `notFound` bei `ENOENT` | `src/main/containers/runner.ts:112` |
| Tests, die `list` als Vehikel für die sudo-Logik nutzen (Probe liefert `has:docker`, Erwartung `problems.docker`) | `discovery.test.ts:55-222`, z. B. `:104-115`, `:116-135`, `:208-222` |
| Container-Parser-Tests | `parsers.test.ts:4-13`, `:30-46`; `commands.test.ts:86-92` |

### 1.3 Ansicht und Tab

| Was | Wo |
|---|---|
| `TabConnection.view?: 'files' | 'containers'`, kein Laufzeit-Feld | `src/shared/windows.ts:9-17` |
| Fenster-Transfer-Schema `.strict()` mit `view`, ohne `runtime` | `src/main/window-ipc.ts:20-24` |
| `containerViewConnection(hostId, hostName, address)` → Name `<Host> · Container` | `src/renderer/src/terminal-tabs.ts:36-38`, `CONTAINER_VIEW_SUFFIX` in `src/shared/containers.ts:125-130` |
| `sameTarget` vergleicht `id`, `view`, `target`, `kube`; zwei Ansichten desselben Hosts teilen Ordinalzahlen | `terminal-tabs.ts:60-63`, Test `terminal-tabs.test.ts:140-152` |
| Workspace: `containerViews?: number[]` | `src/shared/vault/types.ts:207-208`, `schema.ts:132`, `terminal-layout.ts:162`, `:182-183` |
| Ansicht: `requestedRuntime` im Reducer, `setRuntime`, Umschalter nur bei `runtimes.length > 1` | `src/renderer/src/container-view.ts:15`, `:63-69`, `:83-89`; `components/containers/ContainerView.tsx:252-259` |
| `RUNTIME_LABEL` lokal in der Komponente | `ContainerView.tsx:45` |
| Hook pollt mit `{ hostId, runtime? }` | `hooks/useContainerInventory.ts:36` |
| `App.openContainerView(hostId)` ohne Laufzeit, öffnet immer einen neuen Tab | `App.tsx:671-682` |
| Dock und Popout nehmen die Laufzeit aus der Zeile (`row.ref.runtime`), nicht aus dem Tab | `ContainerDock.tsx:84`, `container-menus.ts` (`terminalTargetOf`) |

### 1.4 Lücken gegenüber dem Wunsch

1. Es gibt keinen Weg, eine Ansicht **mit fester Laufzeit** zu öffnen. Zwei Tabs Docker und Podman desselben Hosts wären für `sameTarget` identisch und hießen beide `<Host> · Container`.
2. Die Seitenleiste listet Container, obwohl die Ansicht das besser kann. `docker ps -a` läuft bei jedem Aufklappen, auch mit sudo (Auth-Log).
3. Ein Nutzer mit Podman-Ansicht sähe bei fehlendem Podman stillschweigend Docker (`discovery.ts:116`).

## 2. Entscheidungen

| # | Entscheidung | Wert | Aufwand |
|---|---|---|---|
| E1 | **Probe bleibt, Listen entfallen.** Beim Aufklappen läuft genau das Probe-Skript (SSH, ohne sudo) bzw. lokal `docker --version` / `podman --version` (`notFound` = fehlt). Nur gefundene Laufzeiten bekommen einen Eintrag. Die Zustände „suchen“, „nichts gefunden“, „Fehler + Erneut versuchen“ bleiben. | ★★★ | kleine Main-Änderung |
| E2 | **Proxmox bleibt als Liste** (Gruppen „Proxmox LXC“, „Proxmox VMs“, Problemzeile „Proxmox-Befehle brauchen root …“, Kontextmenü, Doppelklick-Shell, VM-Hartstopp mit Rückfrage). Nichts, was heute geht, geht verloren. Eine Proxmox-Ansicht ist nicht Teil dieser Stufe. | ★★★ | nur Renderer (Logik bleibt) |
| E3 | **Einträge** „Docker-Ansicht“ und „Podman-Ansicht“ als Baumzeilen unter dem Host (vor den Proxmox-Gruppen) und unter „Dieser Computer“. Klick oder Enter: vorhandenen Tab mit gleicher Laufzeit fokussieren, sonst öffnen. Rechtsklick: „Docker-Ansicht öffnen“ (immer neuer Tab), „Aktualisieren“. | ★★★ | nur Renderer |
| E4 | **Laufzeit im Tab:** `TabConnection.runtime?: ContainerRuntime`. Tab-Name `<Host> · Docker` / `<Host> · Podman`, ohne Laufzeit weiter `<Host> · Container`. `sameTarget` vergleicht `runtime`. Fenster-Schema bekommt die Zeile. | ★★★ | kleine Main-Änderung (eine Schema-Zeile) |
| E5 | **Workspace:** `containerViews` nimmt Elemente `number | { index, runtime }`. Zahlen bleiben gültig (Stand aus PR #13), Objekte tragen die Laufzeit. Keine Migration. | ★★ | Renderer + Schema |
| E6 | **Ansicht mit fester Laufzeit:** `pinned` im Reducer. Umschalter nur ohne `pinned`. Liefert Main eine andere Laufzeit als die feste (Fallback aus `discovery.ts:116`), zeigt die Statuszeile „Podman wurde auf diesem Host nicht gefunden.“ mit „Erneut versuchen“, statt still Docker zu zeigen. Main bleibt unverändert. | ★★ | nur Renderer |
| E7 | **Kontextmenüs:** SSH-Knoten behält „Container-Ansicht öffnen“ (ohne feste Laufzeit, mit Umschalter, immer neuer Tab) und bekommt statt „Container anzeigen“ den Eintrag **„Laufzeiten anzeigen“** (aufklappen + Probe). Hintergrund: „Lokale Container suchen“ → **„Lokale Laufzeiten suchen“**, „Lokale Container-Ansicht öffnen“ bleibt. Überschrift „Dieser Computer“: „Lokale Container-Ansicht öffnen“ bleibt. | ★★ | nur Renderer |
| E8 | **Toter Code raus:** Container-Zeilen und ihr Menü, `itemCommands`-Containerzweig, `parseContainerList`, `listArgv('docker'|'podman')`, die Docker-Fixtures der Seitenleisten-Tests. `DiscoveredItem` wird auf Gäste verengt (letzte Welle). `ContainerTarget`, `TerminalTargetSchema`, `containerTabs`, `openContainer`, `containerConnection` bleiben: Dock, Popout, Proxmox und alte Workspaces brauchen sie. | ★★ | Main + Renderer, Tests umhängen |
| E9 | **Doku:** README-Abschnitt „Container und VMs“ neu, Grenze „Seitenleiste stoppt ohne Nachfrage“ entfällt, CHANGELOG 0.9.0 ergänzt (keine neue Version, 0.9.0 ist unveröffentlicht). Container-Spec und Ansichts-Spec bekommen je einen Satz, dass diese Spec die Seitenleiste neu regelt. | ★ | Text |

### Begründungen

- **E1 statt „ohne Probe“:** Ohne Probe stünden „Docker-Ansicht“ und „Podman-Ansicht“ unter jedem SSH-Host, auch unter Routern und Jump-Hosts, und Proxmox wäre nicht erkennbar. Die Probe ist ein einziges `sh -c` ohne sudo (`commands.ts:18`), also die billigste denkbare Anfrage, und sie liefert `pct`/`qm` gleich mit. Das Probe-Skript, `parseProbe` und die Host-Verbindung mit Leerlauf-Schließen (`discovery.ts:191-234`) bleiben unverändert.
- **E1 lokal `--version` statt `ps -a`:** Gleiches Kriterium wie per SSH (installiert oder nicht), kein Daemon-Kontakt. Folge: „Dieser Computer“ erscheint, sobald die CLI installiert ist, auch wenn Docker Desktop nicht läuft; der Fehler „Der Docker-Dienst läuft nicht.“ erscheint dann in der Ansicht mit „Erneut versuchen“. Das ist ein bewusster Tausch gegen die heutige Regel „nur wenn es antwortet“ (`container-tree.ts:82-84`) und steht in der README.
- **E2 statt „Proxmox zu einem Eintrag“:** Ein Eintrag ohne Ziel wäre eine Sackgasse. Die Liste ist das einzige Proxmox-UI und funktioniert. Sie bleibt, bis es eine Proxmox-Ansicht gibt.
- **E3 Fokus statt neuer Tab:** Ein Sidebar-Eintrag ist Navigation. Zwei Docker-Ansichten desselben Hosts pollen doppelt (Validierung C32) und bringen nichts. Wer trotzdem einen zweiten Tab will, nimmt das Kontextmenü.
- **E4 eigenes Feld statt Kodierung in `view`:** `view` wird nur verglichen (`terminal-tabs.ts:51`, `:61`, `terminal-layout.ts:161-162`, `SplitTerminalArea.tsx:398`). Ein eigenes optionales Feld lässt alle Vergleiche gültig und braucht keine Sonderfälle. Ohne die Schema-Zeile in `window-ipc.ts:22` würde das Verschieben eines Docker-Tabs in ein zweites Fenster an `.strict()` scheitern, deshalb gehört sie in Welle 1.
- **E6 Fehler statt Fallback:** Ein Tab „srv · Podman“, der Docker-Container zeigt, ist falsch. Der Reducer kennt die feste Laufzeit und lehnt den Stand ab; Main behält B8 Schritt 3 der Validierung.

## 3. Zustände der Seitenleiste (nach dem Umbau)

| Zustand | Anzeige unter dem Host | Wörtlich |
|---|---|---|
| Probe läuft, kein Cache | eine Notiz | „Suche Laufzeiten …“ |
| Probe läuft, Cache vorhanden | Cache bleibt stehen, Notiz davor | „Aktualisiere …“ |
| Probe fehlgeschlagen (Host, Auth, Host-Key, Timeout) | rote Notiz + Link | `<Meldung>` „Erneut versuchen“ |
| Docker und/oder Podman gefunden | je ein Eintrag | „Docker-Ansicht“, „Podman-Ansicht“ (Tooltip: „Container, Images, Volumes und Netzwerke von `<Host>` (Docker)“) |
| `pct`/`qm` gefunden | Gruppen wie heute, inkl. Problemzeile | „Proxmox LXC“, „Proxmox VMs“, „Proxmox-Befehle brauchen root. sudo aktivieren oder als root verbinden.“ |
| nichts gefunden | graue Notiz | „Keine Container-Laufzeit gefunden.“ |
| sudo-Passwort abgelehnt | nur noch bei Proxmox sichtbar (Problemzeile) | wie heute |

Docker-Berechtigungsprobleme („Keine Berechtigung für Docker …“, „Der Docker-Dienst läuft nicht.“) erscheinen nicht mehr in der Seitenleiste, sondern in der Statuszeile der Ansicht. Das ist Absicht: Die Seitenleiste fragt Docker nicht mehr.

„Dieser Computer“: Abschnitt sichtbar, sobald die Probe `docker` oder `podman` findet. Darunter dieselben Einträge. Kein Proxmox.

## 4. Vertrag (TypeScript, verbindlich für die Umsetzer)

### 4.1 `src/shared/containers.ts` (Welle 1, additiv)

```ts
export const RUNTIME_LABEL: Record<ContainerRuntime, string> = { docker: 'Docker', podman: 'Podman' };   // aus ContainerView.tsx:45 hierher
/** `<host> · Docker`, `<host> · Podman`, without runtime `<host> · Container`. */
export function containerViewTabName(hostName: string, runtime?: ContainerRuntime): string;
/** Strips ' · Container', ' · Docker' or ' · Podman'; anything else stays. */
export function containerViewHostName(name: string): string;   // vorhanden, Verhalten erweitert
```

### 4.2 `src/shared/windows.ts`, `src/main/window-ipc.ts` (Welle 1)

```ts
// TabConnection
/** Fixed runtime of a container view; absent = first runtime found, with the switcher in the header. */
runtime?: ContainerRuntime;
// TabConnectionSchema (window-ipc.ts:22)
runtime: z.enum(['docker', 'podman']).optional(),
```

### 4.3 Workspace (`src/shared/vault/types.ts`, `schema.ts`) (Welle 1)

```ts
/** Container view at `index` in `connectionIds`; a bare number means no fixed runtime. */
export interface WorkspaceContainerView { index: number; runtime?: ContainerRuntime }
containerViews?: (number | WorkspaceContainerView)[];
// schema.ts:132
containerViews: z.array(z.union([
  z.number().int().min(0).max(63),
  z.object({ index: z.number().int().min(0).max(63), runtime: z.enum(['docker', 'podman']).optional() }).strict(),
])).max(64).optional(),
```

### 4.4 `src/renderer/src/terminal-tabs.ts`, `terminal-layout.ts` (Welle 2)

```ts
export function containerViewConnection(hostId: string, hostName: string, address: string, runtime?: ContainerRuntime): TerminalConnection;
// = { id, name: containerViewTabName(hostName, runtime), protocol: local ? 'cmd' : 'ssh', address, view: 'containers', ...(runtime ? { runtime } : {}) }
// sameTarget: zusätzlich (a.runtime ?? '') === (b.runtime ?? '')
// Reducer 'open' und 'adopt' (terminal-tabs.ts:93-95, :99-101) kopieren runtime wie view.
// savedLayout (terminal-layout.ts:162): runtime gesetzt → { index, runtime }, sonst index.
// restoreLayout (:182-183): Eintrag per (typeof e === 'number' ? e : e.index) === index suchen, runtime aus dem Objekt.
```

### 4.5 `src/renderer/src/container-tree.ts` (Welle 2)

```ts
export interface ContainerTreeProps {
  state: ContainerTreeState;
  onExpand: (hostId: string) => void;
  /** Focuses the open view of this runtime or opens one. Optional until App wires it (wave 3). */
  onOpenView?: (hostId: string, runtime: ContainerRuntime) => void;
  /** Proxmox guests only: shell or serial console. */
  onOpen: (hostId: string, item: DiscoveredItem, mode: TerminalTargetMode) => void;
  onAction: (hostId: string, item: DiscoveredItem, action: ContainerAction, confirm?: string) => void;
}
/** ['docker','podman'] filtered by result.runtimes, in that order. */
export function runtimeEntries(result: DiscoveryResult): ContainerRuntime[];
/** Only the Proxmox groups (lxc, vm) with the shared problem on the first one; no Docker or Podman groups. */
export function groupItems(result: DiscoveryResult): ItemGroup[];
/** Guests only; a container item yields [] (type narrows in wave 4). */
export function itemCommands(item: DiscoveredItem): ItemCommand[];
/** runtimeEntries(result).length > 0 */
export function hasUsableLocalRuntime(result: DiscoveryResult): boolean;
```

Reducer, `HostDiscovery`, `ContainerTreeAction`, `ipcMessage` bleiben unverändert (`container-tree.ts:11-44`, `:86-88`).

### 4.6 `src/renderer/src/container-view.ts`, `ContainerView.tsx` (Welle 2)

```ts
// ContainerViewState
/** Runtime fixed by the tab; null = free, the header shows the switcher. */
pinned: ContainerRuntime | null;
export function initialContainerViewState(now: number, pinned: ContainerRuntime | null = null): ContainerViewState;  // requestedRuntime = pinned
// Reducer:
// setInventory: pinned !== null && inventory.runtime !== pinned → { ...state, loading: false, error: `${RUNTIME_LABEL[pinned]} wurde auf diesem Host nicht gefunden.` } (inventory bleibt, wie es war)
// setRuntime: pinned !== null → state (ignoriert)
// ContainerView.tsx: useReducer(..., () => initialContainerViewState(Date.now(), connection.runtime ?? null));
// Umschalter: state.pinned === null && inventory.runtimes.length > 1
```

### 4.7 Main `src/main/containers/` (Welle 2)

```ts
// commands.ts
export function listArgv(kind: 'lxc' | 'vm'): string[];                 // docker/podman-Zweige entfallen
/** Local presence check without touching the daemon. */
export function localProbeArgv(runtime: ContainerRuntime): string[];   // [runtime, '--version']
// parsers.ts: parseContainerList und containerRecords entfallen; parseProbe, parsePctList, parseQmList, describeFailure bleiben.
// discovery.ts list(hostId): SSH = Probe (ohne sudo) → runtimes aus has:docker/has:podman, dann pct/qm wie heute (mit runWithSudo).
//   Lokal = localProbeArgv je Laufzeit über runLocal; !notFound → runtimes.push(rt). items bleiben leer, problems nur proxmox.
// ipc.ts, validation.ts, Kanalname 'containers:list', ListRequestSchema: unverändert. Kommentar in shared/ipc.ts:231 anpassen.
```

`inventory`, `inspect`, `inventoryAction`, `action`, `withHost`, `sudoSetting` bleiben unverändert.

### 4.8 `App.tsx` (Welle 3)

```ts
function openContainerView(hostId: string, runtime?: ContainerRuntime, reuse = false): void;
// Prüfungen wie heute (App.tsx:672-676). connection = containerViewConnection(hostId, name, address, runtime).
// reuse: const open = terminals.tabs.find(tab => sameTarget(tab.connection, connection)); if (open) { terminals.select(open.id); return; }
// containerTree.onOpenView = (id, rt) => openContainerView(id, rt, true)
// Kontextmenüs rufen openContainerView(id) ohne runtime, ohne reuse (wie heute).
```

### 4.9 Welle 4 (Aufräumen, `src/shared/containers.ts`)

```ts
export type DiscoveredItem = { kind: 'lxc' | 'vm'; vmid: number; name: string; state: ItemState };
export function toTarget(item: DiscoveredItem): ContainerTarget;   // nur noch der Gast-Zweig
// DiscoveryResult.problems bleibt Partial<Record<RuntimeKind, string>>; befüllt wird nur noch 'proxmox'.
// ContainerTarget (mit 'container'), itemKey, targetKey, TerminalTarget: unverändert (Dock, Popout, containerTabs).
```

Warum erst Welle 4: Solange `ContainerChildren.tsx` und `container-tree.ts` noch `item.kind === 'container'` vergleichen (bis Welle 2/3), würde eine engere Union den Typecheck brechen („This comparison appears to be unintentional“). Nach Welle 3 referenziert kein Konsument den Container-Zweig mehr, die Verengung kompiliert dann ohne weitere Änderung.

## 5. Regeln und Risiken

**Was ausdrücklich nicht getan wird**

- Kein neuer IPC-Kanal. `containers:list` bleibt, nur sein Inhalt wird kleiner. Keine Änderung an `containersAction`, `containersInventory`, `containersInspect`, `TerminalTargetSchema`, `ContainerTargetSchema` (R9), `session.ts`, `TerminalPanel.tsx`.
- Keine Kube-Datei wird angefasst (R2).
- Kein Statuszähler an den Einträgen („3 laufen“). Das hieße wieder `docker ps` beim Aufklappen.
- Keine Proxmox-Ansicht, keine Laufzeit-Icons (Wal, Robbe), kein Entfernen von `containerTabs` oder `openContainer`.
- Keine Migration. Alte Workspaces mit `containerViews: [0]` öffnen weiter eine Ansicht ohne feste Laufzeit.
- Die Seitenleiste führt keine Docker- oder Podman-Befehle mehr aus, auch nicht mit sudo. Damit entfällt der heutige Satz „Die Seitenleiste stoppt Container ohne Nachfrage“ (R6, README:151) ersatzlos.

**Risiken**

| Risiko | Einschätzung | Gegenmaßnahme |
|---|---|---|
| Die sudo-Integrationstests in `discovery.test.ts:55-222` hängen an `list` mit `has:docker` und `problems.docker`. | Reines Umhängen, keine Logikänderung. Die Mechanik ist in `sudo-run.test.ts` separat getestet. | Fixtures auf `has:pct` umstellen, Erwartungen auf `problems.proxmox` und `sudo -n pct list`. Testnamen behalten. |
| Fenster-Transfer eines Docker-Tabs scheitert ohne Schema-Zeile. | Sicher, wegen `.strict()`. | Schema-Zeile in Welle 1 (T1), manueller Test „Tab in zweites Fenster ziehen“ in T6. |
| Nutzer verliert Shell/Logs per Doppelklick für Docker-Container in der Seitenleiste. | Gewollt. Die Ansicht hat Dock mit Logs/Shell und „Als Tab öffnen“ (`Ctrl+Shift+T`). | README nennt den Weg. |
| „Dieser Computer“ erscheint bei installierter, aber nicht laufender Docker-CLI. | Kleiner Tausch. | Fehler in der Ansicht mit „Erneut versuchen“; README-Satz. |
| `containerViewHostName` bei einem Host, der selbst auf „ · Docker“ endet. | Theoretisch. | ignorieren |
| Zwei Tabs mit und ohne feste Laufzeit desselben Hosts sind für `sameTarget` verschieden und heißen verschieden. | Richtig so. | Test in T3. |

## 6. Tasks in Wellen (Dateien je Welle disjunkt)

Gate nach jeder Welle: `npm run typecheck` und `npx vitest run` grün, ein Commit je Task.

| Welle | Task | Dateien (exakt) | Hängt ab von | Warum es kompiliert |
|---|---|---|---|---|
| 1 | **T1 Vertrag** | `src/shared/containers.ts`, `src/shared/containers.test.ts`, `src/shared/windows.ts`, `src/main/window-ipc.ts`, `src/shared/vault/types.ts`, `src/shared/vault/schema.ts`, `src/shared/vault/schema.test.ts`, `src/shared/ipc.ts` (nur Kommentar) | – | nur additive Typen; `containerViews` als Union wird in `terminal-layout.ts:162,182` erst in T3 anders gelesen, der heutige Code (`includes(index)` auf `(number|object)[]`) kompiliert weiter |
| 2 | **T2 Main** | `src/main/containers/commands.ts`, `commands.test.ts`, `parsers.ts`, `parsers.test.ts`, `discovery.ts`, `discovery.test.ts` | T1 | `list` behält Signatur und Rückgabetyp |
| 2 | **T3 Tabs und Layout** | `src/renderer/src/terminal-tabs.ts`, `terminal-tabs.test.ts`, `terminal-layout.ts`, `terminal-layout.test.ts` | T1 | `runtime` optional, App ruft die alte Form weiter auf |
| 2 | **T4 Baumlogik** | `src/renderer/src/container-tree.ts`, `container-tree.test.ts` | – | `onOpenView` optional, `itemCommands`/`groupItems` behalten Signaturen |
| 2 | **T5 Ansicht** | `src/renderer/src/container-view.ts`, `container-view.test.ts`, `src/renderer/src/components/containers/ContainerView.tsx` | T1 | `pinned` mit Default, `connection.runtime` existiert nach T1 |
| 3 | **T6 Seitenleiste und App** | `src/renderer/src/components/ContainerChildren.tsx`, `LocalContainers.tsx`, `VaultTree.tsx`, `src/renderer/src/App.tsx`, `src/renderer/src/components/navigation-ui.css` | T3, T4, T5 | alle Helfer vorhanden |
| 3 | **T7 Doku** | `README.md`, `CHANGELOG.md` | – (Text nach Spec) | keine Code-Dateien |
| 4 | **T8 Aufräumen** | `src/shared/containers.ts`, `src/shared/containers.test.ts` | T2, T6 | kein Konsument des Container-Zweigs von `DiscoveredItem` mehr |

Nicht in der Zuteilung, weil keine Änderung nötig ist: `hooks/useContainerDiscovery.ts`, `hooks/useContainerInventory.ts`, `ContainerDock.tsx`, `ContainerTable.tsx`, `ContainerConfirm.tsx`, `ContainerHelp.tsx`, `container-menus.ts`, `container-commands.ts`, `container-status.ts`, `container-columns.ts`, `container-confirm.ts`, `SplitTerminalArea.tsx`, `SecondaryWindow.tsx`, `src/main/containers/ipc.ts`, `validation.ts`, `runner.ts`, `sudo-*.ts`, `inventory-parsers.ts`, `src/preload/index.ts`, `src/shared/containers-schema.ts`, `src/shared/vault/mutations.ts`, alle `kube-*`.

### Details je Task

**T1** · `RUNTIME_LABEL`, `containerViewTabName`, `containerViewHostName` (drei Suffixe). `windows.ts` Feld, `window-ipc.ts:22` Schema-Zeile, `types.ts` `WorkspaceContainerView` und Union, `schema.ts:132` Union. Tests: `containerViewTabName` für beide Laufzeiten und ohne; `containerViewHostName` für drei Suffixe und einen Fremdnamen; `schema.test.ts:144-152` ergänzen um `[{ index: 0, runtime: 'docker' }]` gültig, `[{ index: 0, runtime: 'proxmox' }]` ungültig, `[{ index: 0, extra: 1 }]` ungültig, gemischt `[0, { index: 2, runtime: 'podman' }]` gültig.

**T2** · `listArgv` nur `lxc`/`vm`; `localProbeArgv`; `parseContainerList` und `containerRecords` löschen (Import `ContainerRuntime` in `parsers.ts` entfällt). `discovery.ts:66-70` entfernen, `listLocal` → Probe mit `localProbeArgv`. Tests: `answers` (`discovery.test.ts:26-31`) ohne `docker ps`; `:36-43` erwartet `runtimes ['docker','proxmox']`, `items []`, `problems.proxmox`; sudo-Tests `:55-222` mit `has:pct` und `problems.proxmox`; `:224-249` unverändert (nutzen nur die Probe); lokal `:326-335` erwartet `runLocal('docker', ['--version'], 15_000)` und `runtimes ['docker']`; ein neuer Fall „beide `notFound` → `runtimes []`“. Ein Test sichert, dass `list` **keinen** Befehl ausführt, der mit `docker` oder `podman` beginnt. `parsers.test.ts:4-13,30-46` löschen, `commands.test.ts:86-92` kürzen.

**T3** · wie 4.4. Tests: `containerViewConnection` mit `'docker'` → Name `srv · Docker`, `runtime: 'docker'`; `sameTarget(docker, podman)` false, `sameTarget(docker, ohne)` false, `sameTarget(docker, docker)` true; Ordinalzahlen je Laufzeit; Reducer `open` behält `runtime`. Layout: `savedLayout` schreibt `{ index, runtime }` für feste und `index` für freie Ansicht; `restoreLayout` liest beide, alte `number`-Einträge ergeben eine Ansicht ohne `runtime`; Nicht-SSH fällt weiter auf den normalen Tab zurück; `containerTabs` gewinnt weiter (`terminal-layout.test.ts:210-213`).

**T4** · wie 4.5. Tests: `runtimeEntries` Reihenfolge und Filter; `groupItems` liefert bei `runtimes ['docker','proxmox']` nur die Proxmox-Gruppen; `itemCommands` für LXC/VM wie heute (`container-tree.test.ts:61-63`), Container ergibt `[]`; `hasUsableLocalRuntime` wahr bei `['docker']`, falsch bei `['proxmox']` und `[]`. Reducer-Tests bleiben.

**T5** · wie 4.6. Tests: `initialContainerViewState(now, 'podman')` setzt `pinned` und `requestedRuntime`; `setInventory` mit anderer Laufzeit ergibt den Fehlertext wörtlich und lässt `inventory` unverändert; mit passender Laufzeit normal; `setRuntime` bei `pinned` ist ein No-op; ohne `pinned` wie heute. `ContainerView.tsx`: `RUNTIME_LABEL` aus shared, Umschalter nur ohne `pinned`.

**T6** · `ContainerChildren.tsx`: Notiz „Suche Laufzeiten …“, Fehlerpfad wie heute, dann Laufzeit-Zeilen (`vault-tree-row container-row`, `tree-node-button`, kleines Inline-SVG als Icon, Text „Docker-Ansicht“ / „Podman-Ansicht“, `title` laut Abschnitt 3, `onClick`/Enter → `onOpenView`, Rechtsklick und `Shift+F10`/`ContextMenu` → Menü „Docker-Ansicht öffnen“ (ruft `onOpenView`; App entscheidet über `reuse` nicht, deshalb hier `onOpenView` mit Fokus-Verhalten; der Eintrag „immer neuer Tab“ liegt im Host-Kontextmenü), „Aktualisieren“), danach Proxmox-Gruppen wie heute, zuletzt „Keine Container-Laufzeit gefunden.“, wenn weder Einträge noch Gruppen. Alle `item.kind === 'container'`-Zweige und `STATE_LABEL`-Nutzung für Container entfallen. `LocalContainers.tsx`: `onOpenView` aus `containers` durchreichen, Heading-Menü wie heute. `VaultTree.tsx:160` Label „Laufzeiten anzeigen“, `:143` „Lokale Laufzeiten suchen“, aria-Label `:173` „Laufzeiten von `<Name>` anzeigen/zuklappen“. `App.tsx`: `openContainerView(hostId, runtime?, reuse)` laut 4.8, `containerTree.onOpenView`, `onAction` mit `window.confirm` bleibt (VM). `navigation-ui.css`: höchstens eine Regel für das Eintrag-Icon; die Punkte (`.container-state`) bleiben für Gäste. Manuell prüfen: Host mit Docker und Podman (zwei Einträge, zwei Tabs nebeneinander, Umschalter weg), Host nur Proxmox, Host ohne alles, Host nicht erreichbar, „Dieser Computer“, Workspace speichern/laden, Tab ins zweite Fenster ziehen.

**T7** · README `102-128`: Absatz neu (Aufklappen zeigt Laufzeiten und Proxmox; Docker/Podman über die Ansicht; „Dieser Computer“ sobald die CLI installiert ist; Fehler in der Ansicht). `130-158`: Startwege ergänzen („Docker-Ansicht“/„Podman-Ansicht“ in der Seitenleiste, Umschalter nur ohne feste Laufzeit), Grenze `151` streichen. CHANGELOG `## [0.9.0]`: Punkt „Seitenleiste zeigt unter SSH-Verbindungen und ‚Dieser Computer‘ die Einträge „Docker-Ansicht“ und „Podman-Ansicht“ statt der Container-Listen; Proxmox LXC und VMs bleiben als Liste. Tabs heißen `<Host> · Docker` bzw. `<Host> · Podman` und werden mit Laufzeit im Workspace gespeichert.“ Kein `version:minor`.

**T8** · wie 4.9. `containers.test.ts`: `toTarget` nur für Gäste; `itemKey` weiter für `ContainerTarget` mit `kind: 'container'`.

## 7. Minimale erste Stufe gegenüber Extras

**Stufe 1 (dieser Auftrag):** T1 bis T8. Ergebnis: Einträge statt Listen, feste Laufzeit im Tab und Workspace, Proxmox unverändert, toter Code weg.

**Extras, nicht jetzt**

| Extra | Wert | Aufwand | Warum nicht jetzt |
|---|---|---|---|
| `Ctrl`+Klick auf einen Eintrag öffnet immer einen neuen Tab | ★ | nur Renderer, wenige Zeilen | Kontextmenü deckt es ab |
| Proxmox-Ansicht (Tab mit LXC/VM-Tabelle) | ★★ | groß, Main + Renderer | eigene Spec |
| Laufzeit-Icons je Eintrag | ★ | nur Renderer | Geschmackssache, ohne Nutzen für die Bedienung |
| „Container-Ansicht öffnen“ im Host-Kontextmenü durch je einen Eintrag pro Laufzeit ersetzen | ★ | nur Renderer | braucht die Probe vor dem Menü; der freie Tab mit Umschalter reicht |
| Umbenennung `containers:list` → `containers:probe` | ★ | Main + Preload + Renderer | Name stimmt noch (listet Gäste), Umbenennen kostet drei Dateien ohne Nutzen |
