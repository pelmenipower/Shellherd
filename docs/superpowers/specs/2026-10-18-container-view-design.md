# Container-Ansicht für Docker und Podman – Design

Stand: 2026-10-18 · Branch `claude/feature/container-view` (ab `claude/feature/kubernetes-log-view`) · Version 0.9.0

> „nutze die gewonnene UI für kubernetes und mach daraus einen pendant für Docker und Podman“

Recherche mit Datei- und Zeilenbelegen: `.superpowers/sdd/container-view-research.md` (Abschnitte 1–3). Diese Spec ist bindend, die Recherche erklärt sie.
Weiter bindend: `2026-10-14-container-integration-design.md` (Seitenleiste, sudo, Befehlsbau) sowie die Regeln der Kubernetes-Specs zu Kontextmenüs, Spaltenfiltern und Dock, soweit sie hier übernommen werden.

> Die Seitenleiste für Docker und Podman regelt seit 2026-10-18 `2026-10-18-container-view-entries-design.md`: Einträge „Docker-Ansicht“/„Podman-Ansicht“ statt Container-Listen.

## 1. Ziel und Erfolgskriterien

Pro SSH-Host und für „Dieser Computer“ gibt es einen Tab **Container-Ansicht**. Er arbeitet wie der Cluster-Tab: Tabelle mit Spaltenfiltern, Chips, Gruppierung und Sortierung, Kontextmenüs, Tastenkürzel, Hilfe und ein Dock mit Logs, Shell und Inspect.

- Aus dem Kontextmenü einer SSH-Verbindung öffnet „Container-Ansicht öffnen“ einen Tab `<Host> · Container`. Er zeigt die vier Reiter Container, Images, Volumes und Netzwerke.
- Filter, Chips, Gruppierung und Sortierung verhalten sich wie im Cluster-Tab: abhängige Facetten mit Anzahl, Syntax `>3` und `<10m`, „N von M“.
- Logs und Shell laufen im Dock. Die Shell startet erst auf Knopfdruck. Inspect zeigt das JSON, sensible Env-Werte sind maskiert.
- Starten läuft ohne Dialog. Stoppen, Neu starten und Entfernen laufen nur über einen Dialog, beim Entfernen muss man den Namen eintippen.
- Auf dem Host muss nichts installiert sein. Alles läuft über die vorhandene Container-Schicht (SSH-exec bzw. lokales `execFile`, sudo-Gate).

## 2. Nicht in Stufe 1

Stats (CPU/RAM), `docker events`, Kompakt/Roh für Container-Logs, Pausieren und `kill`, Netzwerke entfernen, `prune`, Compose- und Pod-Aktionen, ein Reiter „Compose“, Filter im Workspace speichern, Proxmox-Tab, „In Container-Ansicht zeigen“ aus der Seitenleiste, Umbenennung der `kube-*`-Helfer in neutrale Module. Liste und Bewertung: Recherche 4.2 (E1–E10).

## 3. Architektur-Rulings

| # | Ruling | Warum | Kosten, falls falsch |
|---|---|---|---|
| R1 | **Muster kopieren, nicht verallgemeinern.** Neue Module `container-*.ts` mit eigenen Typen. Direkt importiert werden nur Helfer, die schon heute nicht an `KubeKind` hängen: `ContextMenu`, `isMenuKey`, `markKeyMenu`, `isKeyboardContextMenu`, `keyMenuAnchor`, `parseNumberFilter`, `parseAgeFilter`, `EMPTY_VALUE`, `formatAge`, `bindingOf`, `capText`, `copiedMessage`, `useNativeSurfaceBlock`. Die CSS-Klassen kommen aus `kubernetes-ui.css` und `kubernetes-dock.css`. | Die Kube-Module sind über `Record<KubeKind,…>` verdrahtet und stehen unter bindenden Validierungen. Ein Umbau würde etwa 2 500 Zeilen getesteten Code anfassen. | Später ein Rename-Task (E9). Etwa 600 Zeilen Logik sind doppelt. |
| R2 | **Kube-Dateien werden nicht verändert.** Ausnahme: ein fehlender `export` an einem der Helfer aus R1. | Hält die Kubernetes-Specs stabil. | keine |
| R3 | Tab über `TabConnection.view: 'containers'` (Union mit `'files'`), Tab-Name `<Host> · Container` bzw. `Dieser Computer · Container`. | Liegt neben `<Host> · Dateien`. Es gibt kein neues Protokoll und keinen neuen Vault-Knoten. | Umbenennen kostet eine Zeile. |
| R4 | Haben Docker und Podman beide auf einem Host, gilt Docker als Standard (Reihenfolge der Probe). Ein Umschalter im Kopf wechselt. | So arbeitet die Probe ohnehin (`commands.ts`). | gering |
| R5 | Live-Stand per **Polling alle 10 s, nur bei sichtbarem Tab**, dazu Neuladen nach jeder Aktion und mit `F5`. Es läuft nie mehr als eine Anfrage gleichzeitig, ältere Antworten werden verworfen. | `docker events` braucht einen langlebigen Kanal mit eigener Neuaufbau-Logik (E2). | 10 s Latenz |
| R6 | Die Seitenleiste bleibt unverändert. Dort läuft Container-Stop weiter ohne Nachfrage (Container-Spec), in der Ansicht mit Dialog. | Die Container-Spec gilt dort weiter, und die Abweichung ist klein. | Angleichen in einem Folge-Task |
| R7 | Ein Image wird über `repo:tag` der Zeile entfernt. Hat die Zeile kein Tag, geht es über die ID. Nie mit `-f`. | `rmi <id>` scheitert bei mehreren Tags. `repo:tag` entfernt nur das gemeinte Tag. | Docker-Fehlertext wird gezeigt. |
| R8 | Inspect maskiert **nur** `Config.Env`-Werte mit sensiblen Namen. Labels, `Cmd` und Mounts bleiben unverändert. Das ist eine bekannte Grenze und steht im README. | Gleiche Linie wie Describe im Cluster-Tab. | Ein Geheimnis in `Cmd` ist sichtbar. Das sieht man mit `docker inspect` genauso. |
| R9 | `TerminalTargetSchema` bleibt unverändert (`container`/`lxc`/`vm`). Logs und Shell im Dock nutzen genau den Weg, den die Seitenleiste für Tabs nutzt (`SshPrepareRequest.target`). | Niemand soll ein Terminal auf ein Image öffnen können. `session.ts` bleibt unverändert. | keine |

## 4. Gemeinsamer Vertrag (Welle 1, `src/shared/`)

```ts
// src/shared/containers.ts (additive)
export type InventoryKind = 'containers' | 'images' | 'volumes' | 'networks';
export const INVENTORY_KINDS: readonly InventoryKind[] = ['containers', 'images', 'volumes', 'networks'];
export interface InventoryRef { kind: InventoryKind; runtime: ContainerRuntime; ref: string }
export type InventoryState = 'running' | 'exited' | 'paused' | 'restarting' | 'created' | 'dead' | 'stopped' | 'unknown';
export type RowTone = 'ok' | 'warn' | 'bad' | 'muted';
export interface InventoryRow {
  uid: string;                                  // `${kind}:${id}` – stable across polls
  ref: InventoryRef;                            // what actions/inspect use
  name: string;                                 // display name (container name, repo:tag or <id12>, volume/network name)
  cells: Record<string, string | number>;       // column key -> raw value; '' = unknown
  tone: RowTone;
  labels: Record<string, string>;
  state?: InventoryState; exitCode?: number; project?: string; pod?: string; usedBy?: number;
}
export interface ContainerInventory {
  runtime: ContainerRuntime; runtimes: ContainerRuntime[];
  rows: Record<InventoryKind, InventoryRow[]>;
  problems: Partial<Record<InventoryKind, string>>;   // German message per failed list
  at: number;                                          // epoch ms
  user?: string;                                       // ssh user, for the rootless hint
}
export type InventoryAction = 'start' | 'stop' | 'restart' | 'remove';
export const INVENTORY_ACTIONS: Record<InventoryKind, readonly InventoryAction[]> = {
  containers: ['start', 'stop', 'restart', 'remove'], images: ['remove'], volumes: ['remove'], networks: [],
};
export const IMAGE_ID = /^(sha256:)?[a-f0-9]{12,64}$/;
export const IMAGE_NAME_TAG = /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:(?::[0-9]{1,5})?\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
export function inventoryRefValid(ref: InventoryRef): boolean;   // images: IMAGE_ID | IMAGE_NAME_TAG, sonst CONTAINER_REF
export function containerTone(state: InventoryState, status: string, exitCode?: number): RowTone;
export const LOCAL_CONTAINER_HOST: string;   // vorhandene Konstante, falls schon da: nicht neu anlegen
```

`containerTone`: `running` → `ok`. Steht „(unhealthy)“ im Status → `bad`, steht „(health: starting)“ darin → `warn`. `restarting` → `warn`, `paused` und `created` → `muted`. `exited`/`stopped` mit Exit-Code 0 oder ohne Code → `muted`, mit einem anderen Code → `bad`. `dead` → `bad`, `unknown` → `warn`.

IPC (`src/shared/ipc.ts`, `src/preload/index.ts`, Schemas in `src/shared/containers-schema.ts`):

| Kanal | Request | Antwort |
|---|---|---|
| `containers:inventory` | `{ hostId: string, runtime?: ContainerRuntime }` | `ContainerInventory` |
| `containers:inspect` | `{ hostId: string, ref: InventoryRef }` | `string` (maskiertes, eingerücktes JSON) |
| `containers:action` (vorhanden) | `target`: bisheriges Ziel **oder** `InventoryRef`; `action` zusätzlich `'remove'` | wie heute |

`InventoryRefSchema` prüft `kind`, `runtime` (nur `docker` oder `podman`) und `ref` per `inventoryRefValid`. Main prüft zusätzlich `INVENTORY_ACTIONS[kind].includes(action)` und wirft sonst „Diese Aktion ist hier nicht möglich.“ Kein `default`-Zweig liefert stillschweigend etwas.

Tab und Workspace: `TabConnection.view?: 'files' | 'containers'` (`src/shared/windows.ts`). `window-ipc.ts` bekommt `view: z.enum(['files','containers']).optional()`. `WorkspacePane.containerViews?: number[]` funktioniert wie `fileBrowsers`. Alte Vaults und Workspaces bleiben gültig, eine Migration gibt es nicht.

Props der Ansicht (fest, damit die Verdrahtung parallel kompiliert):

```ts
export interface ContainerViewProps {
  connection: TabConnection; tabId: string; visible: boolean; focused: boolean;
  style?: React.CSSProperties; onFocus?: () => void;
  onStatusChange?: (status: 'connecting' | 'connected' | 'error') => void;
  onPopout?: (connection: TabConnection) => void;
}
```

## 5. Main (`src/main/containers/`)

**Befehle** (`commands.ts`, nur Argument-Arrays, `remoteCommand`/`shellJoin` wie heute):

| Zweck | Docker | Podman |
|---|---|---|
| Container | `docker ps -a --no-trunc --format {{json .}}` | `podman ps -a --format json` |
| Images | `docker images --no-trunc --format {{json .}}` | `podman images --format json` |
| Volumes | `docker volume ls --format {{json .}}` | `podman volume ls --format json` |
| Netzwerke | `docker network ls --no-trunc --format {{json .}}` | `podman network ls --format json` |
| Inspect | `<rt> container\|image\|volume\|network inspect <ref>` | gleich |
| Aktionen | `<rt> start\|stop\|restart <ref>`, `<rt> rm <ref>`, `<rt> rmi <ref>`, `<rt> volume rm <ref>` | gleich |

Jedes `ref` geht vor dem Bau durch `inventoryRefValid`. Wenn nicht, kommt ein `ContainerInputError`. Kein Befehl enthält `-f`, `--force` oder `prune`. Das sichert ein Test für jede Kombination ab.

**Parser** (neue Datei `inventory-parsers.ts`, `parsers.ts` bleibt unberührt): Die Spalten-Quellen pro Laufzeit stehen in Recherche 2.2, die Podman-Abweichungen in Recherche 3.4. Pflicht:
- Es kommen JSON-Zeilen (Docker) und JSON-Arrays (Podman) an. Kaputte Zeilen werden übersprungen. Fehlende Felder ergeben `''`. Der Parser wirft nie.
- `parseDockerSize` (dezimal: B, kB, MB, GB, TB), `parseDockerTime` (Zonenname wie „CEST“ abschneiden → ISO), `parseLabels('a=b,c=d')`, `podmanPorts`.
- Projekt: zuerst `com.docker.compose.project`, sonst `io.podman.compose.project`. Pod nur bei Podman (`PodName`).
- Podman-Netzwerke haben kleingeschriebene Schlüssel. Podman-Image-`Id` mit `sha256:` → Anzeige 12 Zeichen, `ref` volle ID ohne Präfix, sofern kein `repo:tag` vorhanden ist (R7).
- `linkUsage(rows)` setzt `usedBy`: bei Images über die Image-Referenz oder den ID-Präfix der Container, bei Docker-Volumes über `Mounts`, bei Netzwerken über `Networks`. Gibt es keine Quelle, bleibt der Wert `undefined` (nicht 0).
- `maskInspect(text)`: parsen, in jedem Objekt mit `Config.Env` die Werte maskieren, deren Name auf `/PASS|PASSWORD|PASSWD|PWD|SECRET|TOKEN|API_?KEY|PRIVATE_?KEY|CREDENTIAL/i` passt (`NAME=***`), danach mit 2 Leerzeichen serialisieren. Bei einem Parsefehler bleibt der Originaltext.

**Discovery und IPC:**
- `inventory(hostId, runtime?)`: Probe wie bei `list`, dann die vier Listen **nacheinander** über `runWithSudo` bzw. `runLocal`, jede mit 15 s Timeout. Ein Fehler wird pro Art in `problems[kind]` über `describeFailure` festgehalten. Die anderen Arten werden trotzdem geliefert. Ohne Docker und Podman kommt der Fehler „Auf diesem Host wurde weder Docker noch Podman gefunden.“
- `inspect(hostId, ref)` → maskierter Text. `action` nimmt zusätzlich `InventoryRef` mit Prüfung aus Abschnitt 4.
- Sender-Prüfung wie bei den vorhandenen Container-Kanälen.

## 6. Renderer

### 6.1 Layout (wie `ClusterView.tsx`)

1. **Kopf:** Hostname, Laufzeit-Umschalter (nur wenn beide gefunden), Reiter `1 Container · 2 Images · 3 Volumes · 4 Netzwerke` mit Zählern, „Aktualisieren“, „?“, Statuszeile („geladen vor 4 s“, „lade …“, Fehler mit „Erneut versuchen“, `problems` der aktuellen Art).
2. **Chip-Leiste** mit „N von M“, rechts „Gruppieren nach“.
3. **Tabelle** mit Filterzeile, Sortierung, Gruppenzeilen, Fensterung ab 200 Zeilen und Leer-Text.
4. **Dock** mit Logs, Shell und Inspect, „Als Tab öffnen“, „Kopieren“. Es lässt sich einklappen (`Ctrl+j`) und in der Höhe ziehen.

Rootless-Hinweis: Laufzeit ist Podman, die Container-Liste ist leer und es gibt keinen Fehler. Dann zeigt die Statuszeile: „Podman rootless zeigt nur Container des Benutzers `<user>`. Für Root-Container sudo aktivieren.“

### 6.2 Spalten, Chips, Gruppen

Spalten je Reiter laut Recherche 2.2 (Schlüssel, Label, Filterart text/select/number/age). Die Spalte `pod` gibt es nur bei Podman. `size` zeigt dezimal („142 MB“) und filtert in Bytes, auch `>100MB` (Einheit erlaubt). Chips und Gruppierung laut Recherche 2.3. `F` setzt Filter und Chips des Reiters zurück, die Gruppierung bleibt. Filter, Chips, Sortierung und Gruppierung gelten **je Reiter** und bleiben beim Reiterwechsel erhalten.

### 6.3 Auswahl und Polling

Ein neuer Stand ersetzt die Zeilen komplett. Die Auswahl bleibt am `uid`. Verschwindet die Zeile, springt die Auswahl auf den Nachbarn an derselben Stelle (Muster `keepSelection`). Ändert man Filter oder Chips, wird die Auswahl `null`. Ein Auswahlwechsel öffnet nie eine Exec-Session. Ein offenes Logs-Terminal bleibt bei derselben `uid` bestehen und wird bei Auswahlwechsel neu verbunden.

### 6.4 Dock

- **Logs** (`l`): `TerminalPanel` mit der Verbindung `{ ...connection, view: undefined, target: { item: { kind: 'container', runtime, ref, name }, mode: 'logs' } }`. Das ist dieselbe Form, die die Seitenleiste für Tabs nutzt.
- **Shell** (`s`): nur bei laufendem Container und erst nach „Shell öffnen“. Läuft er nicht, steht da „Der Container läuft nicht.“ mit dem Knopf „Starten“, der direkt startet.
- **Inspect** (`i`): `containers:inspect`, `<pre>`, „Kopieren“ kopiert den angezeigten Text (`capText`).
- Bei Images, Volumes und Netzwerken gibt es nur Inspect. Logs und Shell sind deaktiviert mit „Nur für Container.“
- „Als Tab öffnen“ (`Ctrl+Shift+T`) ruft `onPopout` mit derselben Verbindung auf.
- Das Dock-Terminal hat kein Kontextmenü. Rechtsklick fügt ein (Regel aus der Kontextmenü-Spec).

### 6.5 Tasten, Menüs, Aktionen

Tasten laut Recherche 2.5 in einer Registry `CONTAINER_COMMANDS` (Muster `KUBE_COMMANDS`, mit `unavailable` und Beschreibung). Keine Taste ist doppelt belegt. Nach `/` und in Eingabefeldern greifen nur `Escape` und die Pfeiltasten.

Menüs laut Recherche 2.6 als reines Modul `menuFor(target, ctx) → MenuItem[]` mit einer `MenuAction`-Union. Jede verändernde Aktion ist `{ type: 'containerAction', … }` und läuft über `confirm()`. Kein Eintrag ruft `containersAction` direkt auf. Kopierbare Befehle setzen den Namen nur ein, wenn er gültig ist. Sonst ist der Eintrag deaktiviert mit „Name enthält ungültige Zeichen.“

Aktionen und Dialoge laut Recherche 2.7:

| Aktion | Dialog | Eintippen |
|---|---|---|
| Starten | kein Dialog | – |
| Stoppen… (`x`) | „Container stoppen?“ | nein |
| Neu starten… (`r`) | „Container neu starten?“ | nein |
| Entfernen… Container (`Ctrl+d`, nur wenn nicht laufend) | „Container entfernen?“ + „Anonyme Volumes des Containers gehen verloren.“ | Name |
| Entfernen… Image (nur `usedBy === 0`) | „Image entfernen?“ | Referenz |
| Entfernen… Volume (nicht bei `usedBy > 0`) | „Volume entfernen?“ + „Die Daten gehen verloren.“ | Name |

Während einer Aktion zeigt die Zeile einen Lade-Zustand, danach wird sofort neu geladen. Fehler erscheinen in der Statuszeile.

### 6.6 Start und Tabs

- `VaultTree`: Das Kontextmenü einer SSH-Verbindung bekommt **„Container-Ansicht öffnen“** (deaktiviert, wenn die Verbindung deaktiviert ist). Die Überschrift „Dieser Computer“ und der Baum-Hintergrund bekommen **„Lokale Container-Ansicht öffnen“**.
- `App.openContainerView(hostId)`: prüft Session-Limit und `disabledNotice`, dann `terminals.open({ …, view: 'containers' })`.
- `SplitTerminalArea` rendert `ContainerView`, wenn `view === 'containers'`. Diese Prüfung kommt vor der Protokoll-Verteilung.
- `shellOf` liefert `null`, denn der Assistent bekommt kein Terminal. Workspace: `containerViews` speichern und wiederherstellen. Lokale Tabs werden wie heute nicht gespeichert.
- Fenster-Transfer: Die Ansicht lädt im Zielfenster neu.

## 7. Tests (vitest, keine echten Hosts)

- Shared: Schemas lehnen `kind: 'image'` im `TerminalTargetSchema` ab, ebenso ungültige Refs (`; rm`, `$()`, `<none>:<none>`, Leerzeichen). Diese Image-Refs werden angenommen: `nginx:1.27`, `docker.io/library/nginx:latest`, `registry:5000/a/b:v1`, `harbor.local/proj/img:1.0`. `containerTone` ist vollständig getestet.
- Main: Fixtures für Docker und Podman je Art, leere Ausgabe, kaputte Zeilen, Podman mit kleingeschriebenen Schlüsseln, Zonenname. `maskInspect` wird getestet. Befehle: jede Kombination, kein `-f`. Discovery mit Fake-`RemoteHost`: Laufzeitwahl, `problems` je Art, lokal `notFound`, `remove` auf Netzwerk wird abgewiesen.
- Renderer (rein): Spalten, Facetten, Filter-Syntax inkl. Größen, Chips, Gruppen, Reducer (Auswahl nach Poll, `null` nach Filter, Filter je Reiter), Registry (keine Taste doppelt), Menüs (Reihenfolge, Hints, jede verändernde Aktion ist `containerAction`), `terminal-tabs`/`terminal-layout` für `view: 'containers'`.
- Komponenten werden manuell geprüft (Liste im Abschluss).

## 8. Doku

README: Abschnitt „Container und VMs“ um die Ansicht ergänzen, mit Grenzen aus R6 und R8. CHANGELOG 0.9.0. `npm run version:minor`. In der Container-Spec ein Hinweis auf diese Spec.
