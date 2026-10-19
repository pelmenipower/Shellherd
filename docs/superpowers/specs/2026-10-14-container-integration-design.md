# Container- und VM-Integration (Docker, Podman, Proxmox) — Design

> Hinweis: Die Container-Ansicht (Tabelle mit Reitern, Dock, Aktionen mit Dialog) steht in [2026-10-18-container-view-design.md](2026-10-18-container-view-design.md). Diese Spec gilt für die Seitenleiste weiter.

Stand: 2026-10-14 · Phase 1 · Vorbild: [XPipe](https://github.com/xpipe-io/xpipe) (nur Ideen, kein Code und keine Abhängigkeit)

## Ziel

Container und VMs sollen ohne Tipparbeit erreichbar sein. Statt `ssh host` → `docker ps` → ID kopieren → `docker exec -it … sh`
klappt der Nutzer eine Verbindung in der Seitenleiste auf, sieht Container und VMs mit Status und öffnet per Doppelklick eine Shell im Tab.
Dazu kommen einfache Aktionen: Start, Stop, Restart und Logs.

**Erfolgskriterien**

- Unter einer SSH-Verbindung mit Docker, Podman oder Proxmox erscheinen nach dem Aufklappen die Container bzw. LXC und VMs mit Status.
- Ein Doppelklick auf einen laufenden Container öffnet eine interaktive Shell als normalen Terminal-Tab (Resize, Flow-Control, Abkoppeln in Fenster funktionieren wie bei SSH).
- Start, Stop und Restart sowie „Logs folgen“ funktionieren über das Kontextmenü.
- Lokales Docker Desktop oder Podman erscheint im Abschnitt „Dieser Computer“.
- Auf den Servern muss nichts installiert werden, und es braucht keine API-Tokens.

## Abgrenzung (nicht in Phase 1)

- Datei-Browser in Container und VMs (Phase 2, als weitere Implementierung von `FileSystem` in `src/main/files/file-system.ts`)
- Proxmox-REST-API und Cluster-weite Sicht
- Kubernetes (eigene Spec: `2026-10-16-kubernetes-integration-design.md`)
- Container als feste Favoriten im Vault speichern
- Ressourcen-Graphen, Container anlegen und Images verwalten

## Grundprinzip

Alles läuft über Shell-Befehle, die über eine **bestehende SSH-Verbindung** (`ssh2` `exec`) oder **lokal** (`execFile` / `node-pty`) ausgeführt werden.
Podman ist mit Docker CLI-kompatibel. Für die Umsetzung unterscheiden sich beide nur im Programmnamen.

| Laufzeit | Auflisten | Shell | Logs | Aktionen |
|---|---|---|---|---|
| Docker | `docker ps -a --no-trunc --format '{{json .}}'` | `docker exec -it <id> sh -c '<shell-wahl>'` | `docker logs -f --tail 500 <id>` | `docker start/stop/restart <id>` |
| Podman | wie Docker mit `podman` | wie Docker | wie Docker | wie Docker |
| Proxmox LXC | `pct list` | `pct enter <vmid>` | — | `pct start/shutdown/stop <vmid>` |
| Proxmox VM | `qm list` | `qm terminal <vmid>` (nur mit serieller Schnittstelle) | — | `qm start/shutdown/stop <vmid>` |

`<shell-wahl>` ist fest: `command -v bash >/dev/null 2>&1 && exec bash || exec sh`.

## Bedienung

### Seitenleiste

- Jede SSH-Verbindung (`protocol: 'ssh'`) bekommt einen Aufklapp-Pfeil.
  - Die Erkennung startet **erst beim Aufklappen**. Beim App-Start wird kein Host gescannt.
  - Darunter erscheinen nur die Gruppen, die es auf dem Host gibt: **Docker**, **Podman**, **Proxmox LXC** und **Proxmox VMs**.
  - Jeder Eintrag zeigt Name, Status-Punkt (läuft / gestoppt / pausiert) und als Tooltip Image bzw. VMID.
  - Wenn der Host keine Laufzeit hat: grauer Eintrag „Keine Container gefunden“.
  - Wenn die Erkennung fehlschlägt: grauer Eintrag mit kurzer Fehlermeldung und Aktion „Erneut versuchen“. Es gibt kein Modal.
  - Während der Erkennung: Eintrag „Suche Container …“.
- Abschnitt **„Dieser Computer“** ganz oben:
  - Er erscheint nur, wenn lokal `docker` oder `podman` im PATH liegt **und** antwortet.
  - Die lokale Prüfung läuft einmal nach dem Entsperren des Vaults und danach nur auf Anforderung (Aktualisieren).
- Gefundene Einträge sind **nicht** Teil des Vaults. Sie lassen sich nicht verschieben, umbenennen oder bearbeiten.
- Die Suche in der Seitenleiste durchsucht nur Vault-Knoten. Container werden nicht durchsucht, weil sie erst nach dem Aufklappen existieren.

### Aktionen

Ein Doppelklick führt die erste mögliche Aktion aus: „Shell öffnen“ bei laufenden Containern oder LXC, sonst nichts.

Kontextmenü eines Containers bzw. LXC:

- Shell öffnen (nur wenn er läuft)
- Logs folgen (nur Docker und Podman)
- Starten / Stoppen / Neu starten (je nach Status)
- Aktualisieren (lädt die Liste des Hosts neu)

Kontextmenü einer VM:

- Serielle Konsole (nur wenn sie läuft): Ohne serielle Schnittstelle beendet `qm terminal` sich mit einer Meldung. Der Tab zeigt dann einen Hinweis.
- Starten / Herunterfahren / Stoppen

Aktionen wie Start und Stop laufen im Hintergrund. Währenddessen zeigt der Eintrag einen Lade-Zustand, danach wird die Liste des Hosts neu geladen.
Ein Fehler erscheint als kurze Meldung am Eintrag.
„Stoppen“ bei VMs (hartes Ausschalten) fragt vorher nach. Container-Stop fragt nicht nach.

### Tabs

- Tab-Titel: `<containername> @ <verbindungsname>` bzw. `CT <vmid> <name> @ <verbindungsname>`. Logs-Tabs bekommen das Präfix „Logs: “.
- Container-Tabs verhalten sich wie SSH-Tabs: Split, Abkoppeln in Fenster, Workflows senden und Assistent.
- Sie zählen zum gemeinsamen Limit von 16 Sessions (`MAX_SSH_SESSIONS`).

### sudo

- Jede SSH-Verbindung bekommt die optionale Einstellung **„Container-Befehle mit sudo ausführen“** (`containers.sudo`).
- Ist sie gesetzt, wird jedem Laufzeit-Befehl `sudo -n` vorangestellt.
- Scheitert `sudo -n` mangels NOPASSWD, lautet die Meldung: „sudo verlangt ein Passwort. Richte NOPASSWD für docker/pct ein oder füge den Benutzer der Gruppe docker hinzu.“
- Terminus versucht sudo nie von sich aus.

## Architektur

### Neues Modul `src/main/containers/`

| Datei | Aufgabe |
|---|---|
| `types.ts` (in `src/shared/containers.ts`) | `ContainerRuntime = 'docker' \| 'podman'`, `GuestKind = 'lxc' \| 'vm'`, `DiscoveredItem`, `DiscoveryResult`, `ContainerTarget`, `ContainerAction` |
| `parsers.ts` | Reine Funktionen: `parseDockerPs(jsonLines)`, `parsePctList(text)`, `parseQmList(text)`, `parseProbe(text)` |
| `commands.ts` | Reine Funktionen, die Befehlszeilen bauen. Bestandteile werden geprüft, ungeprüfte Strings werden nie eingesetzt (siehe Sicherheit). |
| `discovery.ts` | `ContainerDiscovery`: führt Probe und Listen aus, hält Host-Verbindungen kurz offen und führt Aktionen aus |
| `ipc.ts` | Registriert die IPC-Kanäle |

### Gemeinsame Typen (`src/shared/containers.ts`)

```ts
export type ContainerRuntime = 'docker' | 'podman';
/** An SSH connection id from the vault, or LOCAL_CONTAINER_HOST for this computer. */
export type ContainerHostId = string;
export const LOCAL_CONTAINER_HOST = 'local-containers';

export type DiscoveredItem =
  | { kind: 'container'; runtime: ContainerRuntime; id: string; ref: string; name: string; image: string; state: 'running' | 'paused' | 'stopped' }
  | { kind: 'lxc' | 'vm'; vmid: number; name: string; state: 'running' | 'stopped' | 'paused' };

export interface DiscoveryResult {
  runtimes: ('docker' | 'podman' | 'proxmox')[];
  items: DiscoveredItem[];
  /** Per runtime: a short German message when listing failed (e.g. no permission). */
  problems: Partial<Record<'docker' | 'podman' | 'proxmox', string>>;
}

export type ContainerTarget =
  /** `ref` is the container name when it is a valid reference, otherwise the ID; commands use it. */
  | { kind: 'container'; runtime: ContainerRuntime; ref: string; name: string }
  | { kind: 'lxc' | 'vm'; vmid: number; name: string };

export type TerminalTargetMode = 'shell' | 'logs';
export type ContainerAction = 'start' | 'stop' | 'restart' | 'shutdown';
```

### Erkennung

Ein einziger Probe-Befehl (POSIX-`sh`, über `exec`) liefert Abschnitte mit Markern:

```sh
for c in docker podman pct qm; do command -v "$c" >/dev/null 2>&1 && echo "has:$c"; done
```

Danach werden pro gefundener Laufzeit die Listen-Befehle einzeln ausgeführt. So bekommt jeder Befehl seinen eigenen Exit-Code und seine eigene Fehlermeldung, und `problems` kann pro Laufzeit befüllt werden.

Bekannte Fehlerbilder werden in deutsche Meldungen übersetzt:

- `permission denied … docker.sock` → „Keine Berechtigung für Docker. Benutzer zur Gruppe docker hinzufügen oder sudo aktivieren.“
- `pct`/`qm` als Nicht-root → „Proxmox-Befehle brauchen root. sudo aktivieren oder als root verbinden.“
- `Cannot connect to the Docker daemon` → „Der Docker-Dienst läuft nicht.“

Lokal (Windows):

- Es wird `execFile('docker'|'podman', ['ps', …])` verwendet, ohne Probe-Shell. „Nicht im PATH“ (`ENOENT`) bedeutet: keine Laufzeit.
- Proxmox gibt es lokal nicht.

Erkennungs- und Listen-Befehle haben ein **Timeout von 15 s**, Aktionen (Start/Stop, `qm shutdown` kann dauern) **120 s**. Danach wird er abgebrochen und als Problem gemeldet.

### Host-Verbindungen

- `ContainerDiscovery` hält pro SSH-Verbindung höchstens **einen** `ssh2.Client`.
  - Er wird beim ersten Aufklappen aufgebaut, mit `sshConnectConfig` und derselben Host-Key-Prüfung (`verifyHost`) wie Terminal-Sessions.
  - Nach **60 s ohne Anfrage** wird er geschlossen.
- Shell- und Logs-Tabs nutzen diesen Client **nicht**, sondern bauen wie heute ihre eigene Verbindung auf. Dadurch bleiben Tab-Lebensdauer und Fehlerbehandlung unverändert.
- Ändert oder löscht man die Verbindung im Vault, wird der zwischengespeicherte Client geschlossen.

### Terminal-Sessions mit Ziel

Das ist die zentrale Änderung an bestehendem Code.

- `SshPrepareRequest` (`src/shared/ssh.ts`) bekommt ein optionales Feld `target?: TerminalTarget` (`{ item: ContainerTarget; mode: TerminalTargetMode }`). Der Host ist die `connectionId`, bei lokalen Containern `LOCAL_CONTAINER_HOST`.
- `SshSessionManager.prepare` erlaubt `target` nur bei `protocol: 'ssh'` oder `connectionId === LOCAL_CONTAINER_HOST`. Ohne `target` ist `LOCAL_CONTAINER_HOST` ungültig.
- `SshSessionManager.connect` hat zwei Fälle:
  - **SSH mit Ziel:** Nach `ready` wird `client.exec(command, { pty: { term: 'xterm-256color', cols, rows } }, …)` statt `client.shell` aufgerufen. Der Stream wird genauso verdrahtet wie bei `shell` (Daten, stderr, Flow-Control, close). Resize läuft über `stream.setWindow`, wie heute.
  - **Lokal mit Ziel:** `spawnShell('docker'|'podman', ['exec', '-it', id, 'sh', '-c', SHELL_CHOICE], …)` mit ConPTY.
- Endet der Prozess mit Exit-Code ≠ 0 und hat er keine Ausgabe geliefert, zeigt der Tab eine passende Meldung:
  - „Keine Shell im Container gefunden.“ bei Exit-Code 126/127 für `exec`.
  - Sonst die letzte stderr-Zeile.

### Renderer

- **`VaultTree.tsx`:**
  - SSH-Knoten werden aufklappbar.
  - Neu ist eine Komponente `ContainerChildren` (eigene Datei). Sie rendert den Zustand der Erkennung pro Host:
    - `idle` / `loading` / `ready` / `error`
  - Der Zustand liegt in einem Hook `useContainerDiscovery`, der pro Host einen Cache im Speicher hält.
- **Abschnitt „Dieser Computer“:** Eine eigene kleine Komponente über dem Baum, die denselben Hook mit `{ kind: 'local' }` nutzt.
- **Tabs:**
  - Der Tab-Zustand in `terminal-tabs.ts` bekommt das optionale Feld `target` (gleiche Struktur wie im Request).
  - `TerminalPanel` reicht es beim `prepare` durch.
- **Workspaces:**
  - `WorkspacePane` bekommt `containerTabs?: { index: number; target: ContainerTarget; mode: TerminalTargetMode }[]`. Das funktioniert wie das vorhandene `fileBrowsers`: `index` ist die Position in `connectionIds`, und der Eintrag dort ist die SSH-Verbindung des Hosts.
  - Beim Wiederherstellen wird der Container über die gespeicherte `ref` geöffnet. Das ist bei Docker und Podman der Name, der auch eine Neuanlage überlebt. Gibt es ihn nicht mehr, zeigt der Tab: „Container ‚web-1‘ wurde nicht gefunden.“
  - Tabs lokaler Container („Dieser Computer“) werden in Phase 1 **nicht** in Workspaces gespeichert, weil es dafür keine Vault-Verbindung gibt.
- **Verbindungsformular:** Im Bereich SSH kommt das Häkchen „Container-Befehle mit sudo ausführen“ hinzu.

### Vault

- `SshConnectionNode` bekommt `containers?: { sudo?: boolean }`. Das Feld ist optional, deshalb ist **keine Migration** nötig.
  - Das zod-Schema wird erweitert.
- `WorkspacePane` bekommt das optionale `containerTabs` (siehe Renderer). Das Schema wird erweitert, auch hier ohne Migration.
- Gefundene Container werden nie gespeichert.

### IPC

| Kanal | Richtung | Inhalt |
|---|---|---|
| `containers:list` | invoke | `{ hostId: ContainerHostId }` → `DiscoveryResult` (immer frisch, Cache nur im Renderer) |
| `containers:action` | invoke | `{ hostId; target; action: ContainerAction }` → `void` (wirft eine deutsche Fehlermeldung) |

Die Verträge stehen in `src/shared/ipc.ts`, die Freigabe in `src/preload/index.ts`. Der Main-Prozess prüft jeden Request mit zod.

## Sicherheit

- **Keine Freitext-Einbettung:** Container-Referenzen (`ref`) müssen `^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$` entsprechen, VMIDs sind Ganzzahlen von 100 bis 999999999. Alles andere wird in `commands.ts` mit einem Fehler abgewiesen.
  - Als `ref` dient der Container-Name, wenn er diesem Muster entspricht. Docker und Podman erzwingen das für Namen, sonst wird die ID verwendet. Proxmox-Namen werden nur angezeigt.
  - Remote-Befehle werden zusätzlich aus Argumenten gebaut, die in einfache Anführungszeichen gesetzt sind (`shellJoin`).
- Der Renderer kann **keine** beliebigen Befehle schicken. `containers:action` nimmt nur das Enum `ContainerAction`, und die Befehle baut ausschließlich der Main-Prozess.
- Remote-Befehle werden aus festen Teilen und geprüften Werten zusammengesetzt. Lokal wird `execFile`/`spawn` mit einem Argument-Array benutzt, nie eine Shell-Zeichenkette.
- Die Host-Key-Prüfung ist dieselbe wie bei Terminal-Sessions. Schlüssel und Passwörter werden nach dem Verbindungsaufbau wie bisher genullt (`clearKey`).
- Der Assistent sieht Container-Tabs wie andere Terminal-Tabs. Es werden keine zusätzlichen Daten weitergegeben.

## Fehlerbehandlung (Übersicht)

| Situation | Anzeige |
|---|---|
| Host nicht erreichbar / Auth falsch | Fehlereintrag unter dem Host mit „Erneut versuchen“ |
| Host-Key nicht bestätigt | Fehlereintrag „Der Server-Schlüssel wurde nicht bestätigt.“ |
| Laufzeit vorhanden, keine Rechte | Gruppe mit Hinweis statt Liste |
| sudo ohne NOPASSWD | Hinweis wie im Abschnitt sudo |
| Timeout | „Der Host hat nicht rechtzeitig geantwortet.“ |
| Container ohne Shell | Tab-Meldung „Keine Shell im Container gefunden.“ |
| VM ohne serielle Schnittstelle | Tab-Meldung aus `qm terminal`, dazu der Hinweis „Serielle Schnittstelle in der VM-Hardware hinzufügen.“ |
| Aktion fehlgeschlagen | Kurze Meldung am Eintrag, die Liste wird neu geladen |

## Tests

Mit vitest, im Stil der bestehenden Tests mit injizierten Abhängigkeiten:

- `parsers.test.ts`: echte Beispielausgaben von `docker ps --format json` (Docker und Podman, inklusive Sonderzeichen in Namen), `pct list`, `qm list` und leere Ausgaben.
- `commands.test.ts`: korrekte Befehle pro Laufzeit, Aktion und Modus, sudo-Präfix sowie abgewiesene IDs und VMIDs (`; rm`, Leerzeichen, `$()`, leer).
- `discovery.test.ts`: Fake-exec liefert Probe- und Listen-Ausgaben, geprüft werden `runtimes`, `items` und `problems`. Timeout, Übersetzung der Fehlerbilder, Leerlauf-Schließen mit Fake-Timer.
- `session.test.ts` (Erweiterung):
  - SSH-Session mit `target` ruft `exec` mit pty statt `shell` auf.
  - Lokales Ziel startet `docker exec -it` mit Argument-Array.
  - `target` bei RDP/SFTP wird abgewiesen.
- Renderer: Reducer bzw. Hook-Logik für die Zustände `idle` / `loading` / `ready` / `error` sowie Workspace-Wiederherstellung mit `target`.
- Manuell:
  - Docker-Host über SSH
  - Docker Desktop lokal
  - Proxmox-Node (LXC-Shell, VM Start/Stop, serielle Konsole mit und ohne Schnittstelle)

## Umsetzungsreihenfolge

1. Gemeinsame Typen und `parsers.ts` / `commands.ts` mit Tests
2. `ContainerDiscovery` und IPC (SSH und lokal)
3. Session-Erweiterung `target` (SSH-exec mit pty, lokal per node-pty)
4. Seitenleiste: aufklappbare SSH-Knoten, `ContainerChildren`, Abschnitt „Dieser Computer“
5. Aktionen im Kontextmenü, Logs-Tabs
6. sudo-Einstellung im Formular, Workspace-Wiederherstellung
7. README/CHANGELOG
