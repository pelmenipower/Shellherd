# UX-Audit v2 – Design-Spec

Stand: 2026-10-19 · Branch `claude/feature/ux-audit-v2` · Version-Ziel 0.11.0
Quelle: Claude-Design-Prototyp „Shellherd UX Audit v2“, abgelegt als [`docs/superpowers/design/2026-10-19-ux-audit-v2.html`](../design/2026-10-19-ux-audit-v2.html). Farbrichtung **1b „Berner Kupfer“** ist vom Nutzer gewählt.

## Umfang

Diese Spec setzt die **erste Stufe** aus Abschnitt 5 um (Punkte 1–7). Die dort genannten Extras sind ausdrücklich nicht Teil dieses Branches.

## Rulings

Die Entscheidungen U1–U12 aus Abschnitt 0 gelten als Rulings dieser Spec. Zusätzlich:

- **R-A:** Task 2C (RDP, SFTP, Tabs) läuft erst in Welle 3, weil sie die Komponenten aus 2B nutzt. — Parallel geratene Props-Signaturen wären teurer als eine Welle mehr. — Kosten: eine zusätzliche Welle.
- **R-B:** Der Prototyp ist Design-Input. Hex-Werte und Inline-Styles werden nie übernommen, sondern auf Tokens abgebildet; `design-tokens.test.ts` bleibt maßgeblich. — Kosten, falls falsch: keine.
- **R-C:** Wo Audit und bestehende bindende Regeln (CLAUDE.md, Gate, R13, S3-1/S3-2) kollidieren, gewinnen die bestehenden Regeln (siehe U3, U5). — Kosten: Abweichungen vom Prototyp bei Bewegung, im Feel-Check zu bewerten.

---

---

## 0. Entscheidungen in Kürze (Vorschläge für Rulings)

| # | Entscheidung | Warum | Kosten, falls falsch |
|---|---|---|---|
| U1 | **Flache Semantik-Tokens behalten, nur Werte tauschen.** Die 12-Stufen-Primitive (Radix-Muster) sind ein Extra, nicht erste Stufe. | `terminal-theme.test.ts` vergleicht den Tokenwert wörtlich mit dem Fallback (`--color-bg-stage:\s*([^;]+)`); Primitive (`var(--navy-2)`) würden den Test und die Doku-Tabelle brechen. Der Wechsel 1a → 1b ist auch so ein Tausch von ~25 Zeilen. | Primitive später nachziehen: ein Task in `tokens.css` + Test |
| U2 | **Kupfer ist nie ein Zustand, Gelb nie ein Akzent** wird Regel 2 des roten Fadens. Konsequenz: `.container-state.is-busy` (Akzent-Puls) wird Gelb, `.assistant-typing` wird gedämpfter Text, Busy-Punkt im Primärbutton nutzt `--color-on-accent`. | Kupfer liegt nah an Warnung; ohne Regel verschwimmt die Ampel. | eine Zeile je Stelle |
| U3 | **Bewegung bleibt bei `transform`/`opacity`.** Die drei Audit-Vorschläge mit `background-color`-Transition (Schritt-Punkte, Cluster-Leiste) und `blur()` („Gespeichert“) werden **nicht** übernommen; Farbwechsel springen, das Label blendet nur per Opazität. | `CLAUDE.md` („nur transform/opacity“), Gate-Zeile „Hover-Farbwechsel: keine transition auf background oder color“, R13 verbietet `filter` auf Bühnen; `blur` ist teuer und unscharf bei 13 px. | nichts; die Zustände sind auch ohne Übergang eindeutig, weil Platz und Text wechseln |
| U4 | **Meldungskanal als Modul-Store** (`notice-store.ts`, Muster wie `native-surface.ts`), nicht als Prop-Kette. `App.tsx` und `SecondaryWindow.tsx` rendern nur `<ToastStack />` und rufen `notify.error/info/ok()`. Terminal-, Datei- und Cluster-Komponenten melden direkt. | Entkoppelt die Wellen: `SplitTerminalArea.tsx` bleibt unberührt, die Panels brauchen keine neuen Props, `App.tsx` wird nur einmal angefasst. | keine; der Store ist 40 Zeilen und testbar |
| U5 | **S3-1 aus Stufe 2 gilt weiter für Fehler** (kein Zeitlimit, kein Escape, kein Fokus). Hinweise (5 s) und Erfolge (3 s) laufen ab, Hover und verstecktes Fenster pausieren. S3-2 (RDP-Fläche ausblenden, solange ein Toast steht) bleibt für alle Stufen. | Escape gehört dem Terminal; Fehler müssen gelesen werden. | RDP flackert bei Hinweisen 3–5 s; akzeptiert |
| U6 | **Kein neuer IPC-Kanal.** Schritte und Fehlercodes kommen als zusätzliche Felder des bestehenden `ssh:event`; Abbrechen ist `sshClose`, Neu verbinden ist `sshPrepare`+`sshConnect` mit neuer Session-ID. Renderer → Main bleibt zod-geprüft und besitzgebunden (`requireSshSender`, `owned()`). | Sicherheitsregeln der SSH- und Kube-Specs. | keine |
| U7 | **Fehlertexte werden im Main auf Codes abgebildet** (`src/shared/connection-errors.ts` hält Code → Titel/Ursache/nächster Schritt/Aktionen; Main liefert `code` + `detail`). Der Rohtext ist nur `error.message` (max. 500 Zeichen), nie Stack, nie Schlüsselmaterial. | Ein Wörterbuch für SSH, SFTP (nutzt dasselbe `publicError`) und die Fehlerkarte. | keine |
| U8 | **Schrittanzeige nur für ssh2-Sessions** (SSH-Terminal, Container-Tab über SSH). Lokale Shells, Pod-Terminals, RDP und SFTP zeigen die Karte mit einem Schritt („Shell öffnen“ / „Anmelden“ / „Verbinden“). SFTP-Schritte sind ein Extra. | RDP-Helfer kennt nur `connecting`/`loginComplete`; SFTP-Schritte brauchen Änderungen an `SftpEvent`. | SFTP-Karte zeigt eine Zeile statt vier |
| U9 | **Cluster-Leiste zeigt „Versuch n“ ohne „von y“.** | `DEFAULT_BACKOFF_MS` (`main/kubernetes/session.ts:25`) wiederholt den letzten Wert unbegrenzt; eine Obergrenze gibt es nicht. Der Zugangs-Host des laufenden Versuchs kommt neu aus `openAccess` (`access.ts:85`). | Text ohne Zähler-Ende |
| U10 | **Limit-Text als eine Funktion** `sessionLimitNotice()` in `src/shared/vault/connections.ts` neben `disabledNotice` (nutzt `MAX_SSH_SESSIONS` aus `../ssh`), als Hinweis (`info`), nicht als Fehler. Main-Fehlertexte (`ssh/session.ts:141`, `rdp/host.ts:68`, `sftp-session.ts:62`) nutzen `sessionLimitText()`. | Audit P3; drei Main-Varianten desselben Satzes. | keine |
| U11 | **Lint-Test für Texte:** `ui-text.test.ts` prüft alle `.ts/.tsx` unter `src/renderer` auf `...` in Strings und auf Strings, die mit `Bitte ` beginnen. Main-Texte werden in Stufe 1 nur dort geändert, wo sie bis zur Oberfläche gelangen (Liste unten), der Lint greift dort noch nicht. | 14 Main-Texte hängen an Tests (`actions.test.ts:40`, `discovery.test.ts:64/177`, `parsers.test.ts:61`, `cluster-form.test.ts:43`, `session.test.ts:226`), das ist eine eigene Welle. | Extra-Welle „Main-Texte“ |
| U12 | **Warteanzeige nach 400 ms:** die Verbindungskarte erscheint erst, wenn der Aufbau länger als 400 ms dauert (JS-Timer `WAIT_MS` in `TerminalPanel.tsx`, dokumentierte Kopplung), dann mit Opazität per `@starting-style`; bei reduced motion ohne Übergang. | Ein LAN-Login dauert 200–400 ms; eine aufblitzende Karte wäre schlimmer als heute. | keine |

---

## 1. Bestand und Lücken

### 1.1 Farben

| Befund | Stelle |
|---|---|
| 31 Semantik-Tokens, Cyan-Akzent `#67e8f9`, Warn `#fcd34d` (Bernstein) | `src/renderer/src/tokens.css:6-44` |
| R9 verlangt genau diese 31 `--color-*`-Namen; neue Namen sind erlaubt, fehlende nicht | `design-tokens.test.ts:64-67,192-194` |
| xterm-Fallbacks sind Kopien der Tokenwerte und werden wörtlich gegen `tokens.css` geprüft | `terminal-theme.ts:3`, `terminal-theme.test.ts:9-14` |
| xterm liest die vier Farben per `getComputedStyle` vor `new Terminal` → Bühne, Code-Text, Cursor und Auswahl ziehen automatisch mit; nur die Fallbacks müssen nachgezogen werden | `TerminalPanel.tsx:50-53` |
| Einzige erlaubte Hex-Stelle im TSX: `'#a7b7cb'` als Startwert von `input[type=color]` = `--color-text-muted` | `ConnectionForm.tsx:136`, dokumentiert in `design-system.md:235` |
| Akzent-Puls als Zustand (verletzt künftig „Kupfer nie als Zustand“) | `navigation-ui.css:71` (`.container-state.is-busy`), `assistant-ui.css:26` (`.assistant-typing`) |
| Roter Faden sagt „was leuchtet, ist Cyan“, Marke: „Das Orange im Zeichen ist Bildinhalt, kein Signal“ | `docs/design-system.md:7,19` |
| Produktions-Rand `--color-danger` (Rosé) bleibt laut Audit | `navigation-ui.css:8` |

### 1.2 Meldungskanal

| Befund | Stelle |
|---|---|
| Ein globaler `error`-String, `role="alert"`, rote Fläche, kein Timer, nur „Schließen“ | `App.tsx:133,857`, `Toast.tsx:19-23`, `toast-ui.css:2` |
| `setError(null)` löscht die Meldung beiläufig bei Auswahl, Editor-Wechsel, Verbinden | `App.tsx:600,628,638,645,656,669,682,685,813` (Audit nennt 600/656/813: stimmt, es sind neun Stellen) |
| Hinweise als Fehler: Ordner ohne Verbindungen, Limit, deaktivierte Verbindung, übersprungene Verbindungen, Teilöffnung | `App.tsx:702,610,654,665,683,714,618,652,663,676,716,562,707-709`, `SecondaryWindow.tsx:72,81,82` |
| Echte Fehler: Vault speichern, Workspace öffnen, Fenster öffnen, Verschieben, Cluster prüfen, Tab-Transfer, Katalog | `App.tsx:459,557,564,724,620`, `hooks/useTabTransfer.ts:60,76`, `SecondaryWindow.tsx:39,74` |
| Formularfehler der Startkarte und des Ordner-Formulars laufen ebenfalls über `error` (Startkarte zeigt sie inline, das Ordner-Formular in der Seitenleiste gar nicht inline) | `App.tsx:292-351,403-417,956,1029,805-810` |
| Erfolg gibt es nur als Statusleisten-Wort „Gespeichert“ | `App.tsx:455,858` |
| S3-1/S3-2 (kein Zeitlimit, RDP-Block) sind bindende Rulings der Stufe 2 | Plan `2026-10-19-design-system-stage2.md:82-83` |
| Toast-Zustand als reine Funktion mit Test (S3-5) | `toast-state.ts`, `toast-state.test.ts` |
| Gate-Zeile „Fehlerhinweis (.toast)“: Eintritt `--dur-toast` 220 ms per `@starting-style`, Austritt `--dur-fade` über `.is-closing` | `design-system.md:200`, `toast-ui.css:6-13` |
| Fünf Fehlermuster: Toast, `.error-message`, `.tree-error`, `.workspace-menu-error`, `.file-error`, dazu `.field-error` in vier Dateien | `styles.css:40`, `navigation-ui.css:20-21,38`, `files-ui.css:30`, `editor-ui.css:29`, `workflows-ui.css:28` |

### 1.3 Verbindungszustand

| Befund | Stelle |
|---|---|
| `SshEvent` kennt nur `data` und `status` (`connecting/connected/closed/error`, optional `message`) | `src/shared/ssh.ts:12-15` |
| Main meldet `connecting` einmal beim Start, `connected` nach `client.shell()`; dazwischen nichts | `main/ssh/session.ts:185,248` |
| ssh2-Ereignisse, die Schritte liefern: `hostVerifier`-Aufruf (TCP + Identifikation + KEX erreicht), unser `callback(valid)`, `ready` (Auth fertig), `attachStream` (Shell offen). `greeting` feuert nur bei Vor-Banner, ungeeignet; `connect` wird intern emittiert (`ssh2/lib/client.js:767`), ist aber in `@types/ssh2` nicht deklariert | `main/ssh/session.ts:196-218`, `client-config.ts:26-29` |
| `publicError` bildet bereits ab: ENOENT/EACCES (Schlüsseldatei), ECONNREFUSED, ENOTFOUND/EAI_AGAIN, `client-authentication`, `client-timeout`/ETIMEDOUT, HostKeyError-Texte; alles als String ohne Code | `main/ssh/session.ts:113-122`, `known-hosts.ts:49-50,57,66` |
| ssh2-Rohtexte: „All configured authentication methods failed“, „Timed out while waiting for handshake“ – sie erreichen den Nutzer heute nicht aus `publicError`, aber aus dem `prepare`/`connect`-Reject über `caught.message` | `TerminalPanel.tsx:164` (Regex strippt nur das IPC-Präfix) |
| `readyTimeout` 120 s, Start-Timer 30 s („Der Terminalstart wurde abgebrochen.“) | `client-config.ts:27`, `session.ts:160` |
| SFTP nutzt dasselbe `publicError` → bekommt Codes mit | `main/files/sftp-session.ts:12,69,83,101` |
| RDP liefert nur `connecting`/`loginComplete`/`disconnected`/`error` mit Helfer-Text | `main/rdp/host.ts:211-222` |
| TerminalPanel: während `connecting` bleibt die Bühne leer; Status nur im versteckten `role="status"`-Span; Fehler als `.error-message`-Box über dem Terminal; keine Aktion; kein „Neu verbinden“ (Effekt hängt an `[connection.id, kubeKey, tabId]`) | `TerminalPanel.tsx:28-30,160-167,198-203`, `terminal-ui.css:31-32` |
| FilesPanel hat bereits „Neu verbinden“ über `attempt`-Zähler – das Muster für den Terminal | `FilesPanel.tsx:43,163,184` |
| Tab-Transfer-Schema kennt nur die vier Statuswerte – `SshStatus` darf sich nicht ändern | `main/window-ipc.ts:33`, `src/shared/windows.ts:39,50` |
| Schließen per Taste: SplitTerminalArea hat keine Esc/Enter-Behandlung für Panels; xterm fängt Tasten, solange es Fokus hat (Fokus geht erst bei `connected` ins Terminal) | `TerminalPanel.tsx:110,149` |
| R13 verbietet `transform/transition/filter` auf Selektoren, die `.terminal-panel`, `.terminal-container`, `.split-terminal-stage`, `.rdp-surface`, `.kube-dock-terminal` enthalten – auch `.terminal-panel .karte` wäre ein Treffer | `design-tokens.test.ts:53,164` |

### 1.4 Statuswörter und Texte

| Befund | Stelle |
|---|---|
| Vier Wörterbücher: Tabs „Verbindet/Verbunden/Beendet/Fehler“, Terminal „Verbindet .../Verbunden/Verbindung beendet/Verbindung fehlgeschlagen“, RDP „RDP verbindet ...“, SFTP inline im JSX | `TerminalTabs.tsx:20`, `TerminalPanel.tsx:28-30`, `RdpPanel.tsx:22-24`, `FilesPanel.tsx:212` |
| `...` statt `…` in Strings: 7 Stellen | `ConnectionForm.tsx:206`, `ConfirmDialog.tsx:43`, `FilesPanel.tsx:212`, `FolderEditor.tsx:54`, `RdpPanel.tsx:23`, `kubernetes/ConfirmAction.tsx:87`, `TerminalPanel.tsx:29` |
| „Bitte …“-Strings im Renderer: 16 Stellen (`App.tsx:295,346,351,410,417`, `connection-form.ts:92,100,112,127,140,149,150,152`, `ConnectionForm.tsx:66,95`, `TerminalPanel.tsx:119`, `VaultTree.tsx:125,129,130`, `WorkspaceControls.tsx:56,57,62,66,67,118`, `PermissionsDialog.tsx:53`, `cluster-form.ts:6,66`, `WorkflowsDialog.tsx:38`, `AiSettingsDialog.tsx:49`, `FolderEditor.tsx:28`, `file-browser.ts:70`) | siehe Grep im Anhang |
| „Speichern fehlgeschlagen. Bitte erneut versuchen.“ sechsmal, ohne Ursache; die Ursache kennt nur `persistVault` (und die verwirft sie in `getErrorMessage`) | `WorkspaceControls.tsx:56,57,66,67,118`, `VaultTree.tsx:129,130`, `App.tsx:100-111,459` |
| Vault-Schreibfehler kommen roh (EACCES, EBUSY, ENOSPC) aus `writeFile` durch IPC; Main übersetzt nicht | `main/vault/storage.ts:114-128`, `main/vault/ipc.ts` (saveCurrent) |
| Limit-Text sechsmal im Renderer, dreimal abweichend im Main, einmal im Picker | `App.tsx:610,654,665,683,714`, `SecondaryWindow.tsx:82`, `ConnectionPicker.tsx:83`, `main/ssh/session.ts:141`, `rdp/host.ts:68`, `sftp-session.ts:62` |

### 1.5 Cluster-Reconnect

| Befund | Stelle |
|---|---|
| `.kube-stale > :not(.kube-dock) { filter: grayscale(1); opacity: .55 }` plus Opazitäts-Transition | `kubernetes-ui.css:35-36`, gesetzt in `ClusterView.tsx:336` |
| Status-Zeile im Kopf: „verbinde …“ / „bereit über host“ / „getrennt – verbinde neu …“ / Fehler + „Erneut versuchen“ | `ClusterView.tsx:296-301,331-334` |
| `ClusterStatus` hat `state`, `host` (Name der SSH-Verbindung), `message`; kein Versuchszähler, kein Host des laufenden Versuchs, kein Datenalter | `src/shared/kubernetes.ts:113-126`, `main/kubernetes/session.ts:461-475` |
| Versuch: `attempt` nur intern, Backoff `[1000, 2000, 5000, 10000, 30000]`, unbegrenzt | `main/kubernetes/session.ts:25,113,307-335` |
| Zugangs-Hosts werden in `openAccess` der Reihe nach probiert; der Session ist der laufende Host unbekannt, bis `establish` zurückkommt | `main/kubernetes/access.ts:82-107`, `session.ts:241-244` |
| Verändernde Aktionen sind bei `state !== 'ready'` schon gesperrt, Begründung `NOT_CONNECTED_MESSAGE` („Der Cluster ist gerade nicht verbunden.“) im Menü-Hint | `kube-commands.ts:45-47,61`, `kube-menus.ts:85`, `shared/kubernetes.ts:147` |
| Main-Text beim Reconnect: `RECONNECTING` = „Die Verbindung zum Cluster wird gerade wiederhergestellt.“ | `main/kubernetes/session.ts:28` |
| Gate-Zeile `.kube-stale` „animieren, nur opacity“ | `design-system.md:212` |
| Reducer kennt `now` (Tick alle 10 s), aber keinen Zeitstempel der letzten Daten | `kube-view.ts:30,120`, `ClusterView.tsx:45,82-86` |
| Statuspunkt im Node-Strip ist ein Textglyph „●“ | `NodeStrip.tsx:40`, `kubernetes-ui.css:44-45` |

### 1.6 Busy-Buttons und Container-Aktion

| Befund | Stelle |
|---|---|
| Labelwechsel ohne feste Breite, keine Bestätigung danach | `ConnectionForm.tsx:206`, `FolderEditor.tsx:54`, `WorkspaceControls.tsx:89,113`, `ConfirmDialog.tsx:43`, `ConfirmAction.tsx:87`, `PermissionsDialog.tsx:58` |
| `.ctr-busy { opacity: .6; cursor: progress } … td:first-child::after { content: ' …' }` | `containers-ui.css:8-9`, `ContainerTable.tsx:192-195` |
| Busy-Zustand im Reducer: `busy: string[]` (nur uids, keine Aktion) | `container-view.ts:29,54`, `ContainerView.tsx:105-117` |
| Status-Spalte heißt `status` | `container-columns.ts:13` |
| Seitenleisten-Puls auf Akzent | `navigation-ui.css:71` |

### 1.7 Kleinkram

| Befund | Stelle |
|---|---|
| Statuspunkte 6 px (Tab) und 8 px (Baum), Glyph „●“ im Node-Strip | `terminal-ui.css:15`, `navigation-ui.css:68`, `NodeStrip.tsx:40` |
| „▴▾“ in ProblemBanner, DetailDock, ContainerDock; Sortier-Pfeile „▾▴/▲▼“ und Gruppen-„▸▾“ in drei Tabellen | `ProblemBanner.tsx:29`, `DetailDock.tsx:155`, `ContainerDock.tsx:188`, `ResourceTable.tsx:185,223`, `ContainerTable.tsx:165,186`, `FilePane.tsx:238,253` |
| Welcome-Hover mit Akzentrand | `styles.css:112` |
| Baum nutzt SVG-Chevron (`Icon kind="chevron"`, Rotation per CSS) | `VaultTree.tsx:171`, `navigation-ui.css:11` |

---

## 2. Empfehlung je Fläche

### 2.1 Farbrichtung 1b „Berner Kupfer“ · ★★★ · nur Renderer (tokens.css, drei kleine TS-Stellen, Doku)

Neue Werte in `tokens.css` (gleiche Namen, R9 bleibt grün):

| Token | alt | neu | Herkunft |
|---|---|---|---|
| `--color-bg-stage` | `#070b14` | `#0b1018` | Audit „Bühne“ |
| `--color-bg-app` | `#090e17` | `#0e141e` | „Grund“ |
| `--color-bg-panel` | `#111925` | `#151d2a` | „Panel“ |
| `--color-bg-raised` | `#182334` | `#1c2635` | „Erhöht“ |
| `--color-bg-hover` | `#233045` | `#253043` | Prototyp `style-hover` |
| `--color-bg-input` | `#0b111c` | `#0f1520` | Prototyp Feld |
| `--color-bg-selected` | `#183245` | `#2e2620` | „Auswahl“ |
| `--color-bg-active` | `rgb(103 232 249 / 14%)` | `rgb(232 147 90 / 14%)` | Tönung aus Akzent |
| `--color-bg-drop` | `rgb(103 232 249 / 22%)` | `rgb(232 147 90 / 22%)` | |
| `--color-bg-tint` | `rgb(103 232 249 / 6%)` | `rgb(232 147 90 / 6%)` | |
| `--color-backdrop` | `rgb(2 6 15 / 72%)` | `rgb(5 8 13 / 72%)` | dunkler als Grund |
| `--color-border` | `#29374b` | `#2e3a4c` | „Linie“ |
| `--color-border-strong` | `#496078` | `#4d5b70` | |
| `--color-text` | `#e2eaf4` | `#ebe7e2` | |
| `--color-text-muted` | `#a7b7cb` | `#aeb3bc` | |
| `--color-text-code` | `#dce9f8` | `#e6e2dc` | „Terminal-Text“ |
| `--color-accent` | `#67e8f9` | `#e8935a` | |
| `--color-accent-hover` | `#a5f3fc` | `#f0a673` | Prototyp `a:hover` |
| `--color-on-accent` | `#072733` | `#2a1406` | |
| `--color-selection-bg` | `#164e63` | `#3f2e22` | Vorschlag: Kupfer-Stufe 5, Feel-Check |
| `--color-selection-text` | `#ecfeff` | `#fbf5ef` | Vorschlag |
| `--color-warn` | `#fcd34d` | `#facc15` | „reines Gelb“ |
| `--color-warn-border` | `#6b5520` | `#6b5a12` | Prototyp Cluster-Leiste |
| `--color-ok`, `--color-danger*` | | unverändert | Audit nutzt dieselben Hex |

Neue Tokens (Rolle in die Doku-Tabelle):

| Token | Wert | Rolle |
|---|---|---|
| `--color-warn-bg` | `#2a2614` | Warn-Fläche (Cluster-Leiste beim Reconnect) |
| `--color-ok-bg` | `#16261f` | OK-Fläche (Cluster-Leiste „Wieder verbunden“) |
| `--size-dot` | `8px` | das eine Statuspunkt-Maß |
| `--notice-ttl-info` | `5000ms` | Anzeigezeit Hinweis (keine Bewegung; R4 prüft nur `--dur-*`) |
| `--notice-ttl-ok` | `3000ms` | Anzeigezeit Erfolg |

Mitzuziehen: `terminal-theme.ts:3` Fallbacks (`#0b1018`, `#e6e2dc`, `#e8935a`, `#3f2e22`), `ConnectionForm.tsx:136` → `'#aeb3bc'`, `design-system.md` (roter Faden Satz 1: „was leuchtet, ist Kupfer“; Marke: der Akzent kommt aus dem Kupfer der Wangen; Regel: Kupfer nie als Zustand, Gelb nie als Akzent; Token-Tabelle; Zustände-Tabelle unverändert). Kontrast laut Audit: Text 13,7, gedämpft 8,0, Akzent 7,9 auf Panel; `--color-on-accent` auf Akzent ≈ 7:1.

Prüfung Terminal/Cursor: `TerminalPanel.tsx:50-53` liest `--color-bg-stage`, `--color-text-code`, `--color-accent` (Cursor), `--color-selection-bg` per `getComputedStyle` – der Cursor wird also Kupfer, die Bühne `#0b1018`. Die ANSI-16-Palette von xterm bleibt Standard (nicht aus Tokens). Caret in Eingaben (`styles.css:21`) und Checkbox-`accent-color` ziehen über `--color-accent` mit. Tabs: aktive Unterkante Kupfer (`terminal-ui.css:9`), Fokusring Kupfer (`--focus-outline`).

Zustandsfarben nach U2: `navigation-ui.css:71` `.container-state.is-busy` → `var(--color-warn)`; `assistant-ui.css:26` `.assistant-typing` → `var(--color-text-muted)`. `.file-kind.is-folder` (Ordner-Glyph, `files-ui.css:54`) und `.kube-meter-bar i` (`kubernetes-ui.css:49`) bleiben Akzent: kein Zustand.

### 2.2 Meldungskanal · ★★★ · nur Renderer

**Modul `src/renderer/src/notice-store.ts`** (rein, ohne React): `Notice { id: number; tone: 'error' | 'info' | 'ok'; title: string; body?: string; action?: { label: string; run: () => void }; ttl: number; leaving: boolean }`. Funktionen `pushNotice(list, notice)` (max. 3 sichtbar: die älteste bekommt `leaving: true`), `closeNotice(list, id)`, `removeNotice(list, id)`, `clearNotices()`. Dazu ein Modul-Store mit `subscribe`/`getSnapshot` (wie `native-surface.ts`) und die API `notify.error(title, { body, action })` (ttl 0), `notify.info(title, { body })` (ttl `--notice-ttl-info`), `notify.ok(title, { body })`. Test `notice-store.test.ts` (ersetzt `toast-state.ts`/`.test.ts`, die gelöscht werden).

**`components/Toast.tsx`** → exportiert `ToastStack` (liest den Store per `useSyncExternalStore`) und `ToastItem`. Verhalten:

- Fehler: `role="alert"`, Gefahr-Fläche, roter Punkt, bleibt bis „Schließen“ oder Aktion.
- Hinweis: `role="status"`, Panel-Fläche, Punkt in `--color-text` (weiß; Kupfer ist nie ein Zustand), 5 s.
- Erfolg: `role="status"`, Panel-Fläche, grüner Punkt, 3 s.
- Ablaufbalken 2 px unten (`.toast-bar`), Farbe = Punktfarbe bei 50 % Opazität. CSS-Animation `toast-bar` (`transform: scaleX(1→0)`, `linear`, Dauer `var(--notice-ttl-*)`), hinter `prefers-reduced-motion: no-preference`; unter `reduce` dieselbe Dauer als `width 100%→0` (geduldete Layout-Eigenschaft wie `progress`, R7b-konform, weil `width` nicht in `TRANSFORM_PROPS` steht). Ende per `animationend` → `closeNotice`. **Eine Quelle der Zeit: CSS.** Pause: Stack-Container setzt `is-paused` bei `mouseenter` und `document.hidden` → `animation-play-state: paused`.
- Stapel: `.toast-stack` fixed unten rechts, `gap: var(--space-8)`, Breite `min(400px, calc(100vw - 2 * var(--space-12)))`; `.secondary-shell .toast-stack { bottom: var(--space-12) }` wie heute.
- Ein-/Austritt: bestehender CSS-Pfad (`@starting-style` + `.is-closing`), unverändert.
- Aktion: `.toast-action` (Gefahr-Button auf Fehler, Sekundär auf Hinweis), Klick schließt und führt aus. Schließen-Knopf `aria-label="Meldung schließen"` (heute „Fehlermeldung schließen“).
- `useNativeSurfaceBlock(notices.length > 0)` bleibt (S3-2).
- Kein Fokuswechsel, kein Escape (U5).

**Zuordnung der heutigen `setError`-Aufrufe** (App.tsx; wörtliche Texte):

| Stelle | Stufe | Titel | Text |
|---|---|---|---|
| 231 Drop keine Vault-Datei | info | `Keine Vault-Datei` | bestehender Satz |
| 295/346/351 Startkarte | inline (`formError`, `.error-message` bleibt) | – | „Gib dem Vault einen Namen.“ / „Wähle zuerst eine Vault-Datei aus.“ / „Gib das Vault-Passwort ein.“ |
| 410/417 Ordner-Formular | inline `field-error` unter dem Feld (`folderError`), neu in `sidebar-create-form` | – | „Wähle einen Ordner oder die Vault-Ebene aus.“ / „Gib einen Ordnernamen ein.“ |
| 459 persistVault | error + Aktion „Erneut versuchen“ (ruft `persistVault(updatedVault)` erneut) | `Vault nicht gespeichert` | Ursache aus Main (siehe 2.4) |
| 557 Fenster | error | `Fenster nicht wiederhergestellt` | „Nicht alle Fenster des Workspaces konnten geöffnet werden.“ |
| 562, SecondaryWindow 72 | info | `Verbindungen übersprungen` | `skippedNotice(n)` |
| 564, SecondaryWindow 74 | error | `Workspace nicht geöffnet` | Meldung |
| 610/654/665/683/714, SecondaryWindow 82 | info | `Maximal 16 Sessions` | „Schließe zuerst einen Tab.“ (`sessionLimitNotice()`) |
| 618/652/663/676/716, SecondaryWindow 81 | info | `Verbindung deaktiviert` | `disabledNotice(node)` („Die Verbindung „X“ ist deaktiviert. Per Rechtsklick → „Aktivieren“ wieder freigeben.“) |
| 620 kubeProbe | error | `Cluster nicht geprüft` | Meldung |
| 702 Ordner leer | info | `Nichts zu verbinden` | „Der Ordner „Staging“ enthält keine Verbindungen.“ / „Alle Verbindungen im Ordner „X“ sind deaktiviert.“ |
| 707-709 Teilöffnung | info | `Nur 3 von 7 Verbindungen geöffnet` | „Maximal 16 Sessions gleichzeitig.“ + ggf. `skippedNotice` |
| 724 Verschieben | error | `Nicht verschoben` | Meldung |
| `useTabTransfer.ts:60,76` | error (über `notify`, Prop `onError` entfällt) | `Tab nicht verschoben` | `errorText(error)` |
| SecondaryWindow 39 | error | `Verbindungsliste nicht verfügbar` | „Ist der Vault gesperrt?“ |
| neu: `saveWorkspace` Erfolg | ok | `Workspace „Produktion“ gespeichert` | `workspaceSummary(workspace)` (z. B. „4 Bereiche, 6 Tabs“) |

Alle neun `setError(null)` entfallen. `resetForm()` ruft `clearNotices()` (Bildschirmwechsel, Sperren). Statusleiste `App.tsx:858`: „Aktion fehlgeschlagen“ fällt weg (`busy ? 'Speichert …' : savedNotice || 'Vault geöffnet'`). `.error-message` in `styles.css:40` bleibt für Startkarte und Dialoge (`ConfirmAction.tsx:83`, `ResourceTable.tsx:257`).

Drei Muster (Audit Prototyp 4) als Regel in `design-system.md`, Abschnitt „Meldungen“: **Feld** (`.field-error`, `aria-invalid`, Fokus zum Feld), **Bereich** (`.area-error`: Gefahr-Fläche mit Titel, Satz, Knopf; ersetzt `.tree-error` in `VaultTree.tsx:226` und `.workspace-menu-error` in `WorkspaceControls.tsx:109`; `ContainerChildren.tsx:30,107` behält `.tree-error` als Zeilenhinweis), **global** (Toast, nur Hintergrundereignisse ohne Ort). CSS für `.area-error` in `styles.css` neben `.error-message` (gleiche Fläche, zusätzlich `display: grid; gap: var(--space-8)` und Knopf-Regel).

### 2.3 Verbindungszustand im Bereich · ★★★ · kleine Main-Änderung

**Shared (`src/shared/ssh.ts`):**

```ts
export type SshStep = 'reach' | 'hostkey' | 'auth' | 'shell';
export type SshEvent =
  | { type: 'data'; … }
  | { type: 'step'; sessionId: string; step: SshStep }                       // Schritt beginnt
  | { type: 'status'; sessionId: string; status: SshStatus; message?: string; code?: ConnectionErrorCode; detail?: string };
```

`SshStatus` bleibt (Transfer-Schema `window-ipc.ts:33`).

**Shared (`src/shared/connection-errors.ts`, neu):** `ConnectionErrorCode = 'auth' | 'timeout' | 'hostkey-changed' | 'hostkey-rejected' | 'hostkey-store' | 'refused' | 'not-found' | 'key-file' | 'agent' | 'limit' | 'closed-by-server' | 'unknown'` und `connectionError(code, ctx: { name; address; user?; keyPath? })` → `{ title, body, next, primary, secondary }`. Wörtlich:

| Code | Titel | Ursache | Nächster Schritt | Primär · Sekundär |
|---|---|---|---|---|
| `auth` | Anmeldung abgelehnt | Der Server hat den Benutzer „deploy“ mit {dem gespeicherten Schlüssel \| dem Passwort \| dem SSH-Agent} nicht angenommen. | Prüfe Benutzer und Anmeldung in den Verbindungseinstellungen. | Verbindung bearbeiten · Erneut verbinden |
| `timeout` | Server antwortet nicht | 10.0.4.21:22 hat nicht rechtzeitig geantwortet. | Prüfe VPN, Firewall und Port. Möglicherweise ist der Rechner aus. | Erneut verbinden · Verbindung bearbeiten |
| `hostkey-changed` | Server-Schlüssel hat sich geändert | Der Fingerprint stimmt nicht mit dem bestätigten überein. Shellherd hat die Verbindung abgebrochen. | Kläre den Schlüsselwechsel mit dem Administrator, bevor du fortfährst. | Fingerprint kopieren · Erneut verbinden |
| `hostkey-rejected` | Server-Schlüssel nicht bestätigt | Du hast den Schlüssel von 10.0.4.21:22 nicht bestätigt. | Verbinde erneut und vergleiche den Fingerprint mit einer vertrauenswürdigen Quelle. | Erneut verbinden · Verbindung bearbeiten |
| `refused` | Verbindung abgelehnt | 10.0.4.21 nimmt auf Port 22 keine Verbindung an. | Prüfe Host und Port. Läuft der SSH-Dienst? | Erneut verbinden · Verbindung bearbeiten |
| `not-found` | Host nicht gefunden | Der Name „web-01.example“ ließ sich nicht auflösen. | Prüfe Schreibweise, DNS und VPN. | Verbindung bearbeiten · Erneut verbinden |
| `key-file` | Schlüsseldatei nicht lesbar | Die Datei „C:\…\id_ed25519“ fehlt oder ist nicht lesbar. | Prüfe Pfad und Zugriffsrechte in den Verbindungseinstellungen. | Verbindung bearbeiten · Erneut verbinden |
| `agent` | Kein SSH-Agent | Es läuft kein SSH-Agent, der den Schlüssel liefern könnte. | Starte den Agent oder wähle Passwort oder Schlüsseldatei. | Verbindung bearbeiten · Erneut verbinden |
| `unknown` | Verbindung fehlgeschlagen | (Main-Text wie heute) | Prüfe Host, Benutzer und Anmeldung. | Erneut verbinden · Verbindung bearbeiten |

„Fingerprint kopieren“ braucht beide Fingerprints im `detail` (HostKeyError-Text um „erwartet …/erhalten …“ ergänzen, `known-hosts.ts:49-50`); Kopieren über `writeClipboardText`. Sekundärfenster ohne Editor: „Verbindung bearbeiten“ entfällt dort (Prop `onEdit` fehlt).

**Main (`main/ssh/session.ts`):** `classifyError(error): { code, message, detail }` neben `publicError` (das weiter den String liefert, damit `sftp-session.ts` unverändert bleibt; `publicError` ruft intern `classifyError`). `finish(session, 'error', …)` bekommt `code` und `detail` (= `error.message.slice(0, 500)`, nie `stack`, nie Config). Schritt-Events: in `connect()` vor `client.connect(config)` → `step: 'reach'`; im `hostVerifier`-Callback erster Aufruf → `step: 'hostkey'`; nach `callback(true)` → `step: 'auth'`; in `client.once('ready')` → `step: 'shell'`; `attachStream` sendet wie heute `status: 'connected'`. Pod-, Container-lokal- und Shell-Sessions senden nur `step: 'shell'`. Bei `closed` ohne Nutzereingabe (`!session.typed`, nur bei `stream.on('close')`) → `code: 'closed-by-server'`. Tests in `session.test.ts` (Loopback-Server vorhanden): Reihenfolge `reach < hostkey < auth < shell < connected`; Auth-Fehler liefert `code: 'auth'` und `detail` mit „authentication“.

**Renderer `TerminalPanel.tsx`:** Zustand `phase: { step: SshStep; startedAt: number }[]`, `attempt` (wie FilesPanel), `endedAt`, `failure: { code, message, detail } | null`. Effekt-Dependency um `attempt` ergänzen; Abbrechen → `sshClose` (Status `closed`, Leiste instant). Neue Komponenten in eigenen Dateien:

- `components/ConnectingCard.tsx`: Overlay `.connect-card` (eigener Selektor ohne Bühnenklasse, siehe R13), erscheint nach `WAIT_MS = 400` (U12). Titel `Verbinde mit web-01 …`, Zeile `deploy@10.0.4.21:22` (`connection.address`) in `--font-mono`. Schritte „Server erreichen“ (Notiz Adresse), „Server-Schlüssel prüfen“ (Notiz „bekannt“ kann der Renderer nicht wissen → ohne Notiz), „Anmelden“ (Notiz „Schlüssel id_ed25519“ / „Passwort“ / „SSH-Agent“ – aus dem Katalog? Der Renderer hat im Hauptfenster `vault.nodes`, im Nebenfenster den redigierten Katalog mit `method: 'agent'` → Notiz nur im Hauptfenster; der Picker gibt `authentication.method` nicht an das Panel. Entscheidung: Notiz weglassen, Stufe 1 ohne), „Shell öffnen“. Zeit je Schritt `0,4 s` (tabular-nums, 100-ms-Tick nur solange sichtbar). Fußzeile: links `Gesamt 1,2 s` oder ab 1,5 s im Schritt `Der Server antwortet langsam …` (Schritt 1) / `Dauert länger als üblich …` (andere) in `--color-warn`; rechts Button `Abbrechen` mit `<kbd>Esc</kbd>`. Der Button bekommt Fokus, wenn der Bereich fokussiert ist (`focused && visible`), Esc = Klick. Punkte: 14 px Ring, erledigt gefüllt Akzent mit Häkchen (SVG), aktiv Ring Akzent, offen Ring `--color-border-strong`; **kein** Farbübergang (U3).
- `components/ConnectionErrorCard.tsx`: `.connect-error` mittig, Gefahr-Rand, Schatten `--shadow-overlay`, Punkt rot, Titel, Ursache, nächster Schritt (gedämpft), Buttons (Primär Akzent, Sekundär), rechts `Details` / `Details ausblenden` (Link-Button), Rohtext in `<pre>` (`--font-mono`, Bühne). Eintritt opacity + `scale(.97)` (Gate-Eintrag), reduce nur opacity.
- `components/DisconnectedBar.tsx`: `.connect-closed` unten im Bereich: Punkt gedämpft, `Verbindung getrennt · vor 12 s · der Server hat sie beendet` (bei `closed-by-server`) bzw. `· die Sitzung wurde beendet`, rechts Primärbutton `Neu verbinden` mit `<kbd>Enter</kbd>`; Zeit tickt sekündlich bis 60 s, dann `vor 2 min`. Eintritt opacity + `translateY(100%)` nur bei Server-Trennung, `data-instant` nach Abbrechen/Esc (Tastatur bewegt sich nie).

RdpPanel: Platzhalter (`rdp-surface`) nutzt `DisconnectedBar` und `ConnectionErrorCard` (`code: 'unknown'`, `detail` = Helfer-Text) und die Karte mit einem Schritt „Anmelden“; „Neu verbinden“ über `attempt` wie FilesPanel. FilesPanel: `remoteNotice` (`FilesPanel.tsx:182-184`) wird zur `ConnectionErrorCard`/`DisconnectedBar` (Codes kommen über `publicError` mit, sobald `SftpEvent.status` die Felder `code`/`detail` bekommt – zwei Zeilen in `shared/sftp.ts:65` und `sftp-session.ts:291`).

CSS neu: `components/connection-ui.css` (Präfix `.connect-`), importiert von `ConnectingCard.tsx`. Keine Bühnenklasse in Selektoren. Motion dort mit `prefers-reduced-motion`-Block.

### 2.4 Textregeln und Statuswörterbuch · ★★ · nur Renderer (+ 6 Main-Zeilen)

- `src/renderer/src/status-words.ts`: `statusWord(status: SshStatus, form: 'short' | 'long', name?: string)`:
  kurz (Tabs, `title`): `Verbindet …` / `Verbunden` / `Getrennt` / `Fehler`; lang (Bereich, Screenreader-Span): `Verbinde mit web-01 …` / `Verbunden` / `Verbindung getrennt` / `Verbindung fehlgeschlagen`. Protokoll-Präfix für den Live-Span: `statusWord` bekommt optional `protocol` („RDP: Verbunden“, „SFTP: Verbindet …“). Nutzer: `TerminalTabs.tsx:20,52-53`, `TerminalPanel.tsx:28-30,200`, `RdpPanel.tsx:22-24,124`, `FilesPanel.tsx:212`. Test `status-words.test.ts`.
- `src/renderer/src/ui-text.test.ts`: liest `src/renderer/src/**/*.{ts,tsx}` ohne `*.test.ts`, entfernt Kommentare, meldet (a) `...` das nicht Spread ist (`/\.\.\.(?![\w[({$])/`), (b) String-Literale, die mit `Bitte ` beginnen (`/(['"`])Bitte /`). Selbsttest mit Fixture. Erlaubnisliste leer.
- Umschreibungen (Du-Imperativ ohne „Bitte“), wörtlich:
  `App.tsx:295` „Gib dem Vault einen Namen.“ · `346` „Wähle zuerst eine Vault-Datei aus.“ · `351` „Gib das Vault-Passwort ein.“ · `410` „Wähle einen Ordner oder die Vault-Ebene aus.“ · `417` „Gib einen Ordnernamen ein.“ · `connection-form.ts:92` „Gib einen Host oder eine IP-Adresse ein.“ (Audit) · `100` „Gib einen Verbindungsnamen ein.“ · `112` „Gib den Pfad zum privaten Schlüssel ein.“ · `127` „Gib den Befehl an, z. B. aider --model sonnet.“ · `140` „Gib einen gültigen Namespace ein, z. B. default.“ · `149` „Gib die Farbe als #RRGGBB an.“ · `150` „Wähle ein verfügbares Symbol.“ · `152`, `ConnectionForm.tsx:66` „Prüfe die Verbindungsdaten.“ · `ConnectionForm.tsx:95` „Nicht gespeichert. Deine Eingaben bleiben erhalten.“ (Ursache steht im Toast) · `TerminalPanel.tsx:119` „Die Eingabe ist zu groß. Füge kleinere Abschnitte ein.“ · `VaultTree.tsx:125` „Gib einen Namen ein.“ · `129/130` „Nicht umbenannt.“ (Ursache im Toast) · `WorkspaceControls.tsx:62` „Gib einen Workspace-Namen ein.“ · `56/57/66/67` „Nicht gespeichert.“ · `118` „Nicht gelöscht.“ · `PermissionsDialog.tsx:53` „Gib drei oder vier Ziffern von 0 bis 7 ein, z. B. 644.“ · `cluster-form.ts:6` „Gib den Pfad zur Kubeconfig an.“ · `66` „Gib einen Namen an.“ (Test `cluster-form.test.ts:43` anpassen) · `WorkflowsDialog.tsx:38` „Gib Name und Befehl an.“ · `AiSettingsDialog.tsx:49` „Prüfe Name, Modell und URL (mit https:// oder http://).“ · `FolderEditor.tsx:28` „Gib einen Ordnernamen ein.“ · `file-browser.ts:70` „Gib einen Namen ein.“ · Auslassung: `ConnectionForm.tsx:206`, `ConfirmDialog.tsx:43` („Bitte warten ...“ → „Warte kurz …“? Nein: `Bitte warten …` entfällt mit dem BusyButton, Label bleibt gleich und der Punkt pulst), `FilesPanel.tsx:212`, `FolderEditor.tsx:54`, `RdpPanel.tsx:23`, `ConfirmAction.tsx:87`, `TerminalPanel.tsx:29`.
- Main-Texte, die die Oberfläche erreichen (gleiche Welle, ohne Lint): `main/ssh/session.ts:150`, `sftp-session.ts:65`, `rdp/ipc.ts:43` → „Speichere Host und Benutzername, bevor du die Verbindung startest.“; `kubernetes/ipc.ts:77` „Wähle eine SSH-Verbindung.“; `known-hosts.ts:50` „Der Server-Schlüssel hat sich geändert. Verbindung abgebrochen. Kläre die Änderung mit dem Server-Administrator.“; `session.ts:438` „Zu viele Terminaleingaben. Warte kurz.“ Alle übrigen Main-„Bitte“ (ai, containers, migrations, actions) sind Extra (U11).
- **Was · Warum · Was jetzt** für Speicherfehler: Main `vault/ipc.ts` (saveCurrentVault) übersetzt `writeFile`-Codes: EACCES/EPERM → „Die Vault-Datei ist schreibgeschützt.“, EBUSY → „Die Vault-Datei ist von einem anderen Programm gesperrt.“, ENOENT → „Der Ordner der Vault-Datei existiert nicht mehr.“, ENOSPC → „Auf dem Laufwerk ist kein Platz mehr.“; Renderer `getErrorMessage` (`App.tsx:100-111`) reicht deutsche Main-Texte durch (IPC-Präfix strippen) statt alles auf „Der Vault konnte nicht verarbeitet werden.“ zu falten. Damit heißt der Toast: Titel `Workspace nicht gespeichert` / `Vault nicht gespeichert`, Text „Die Vault-Datei D:\vaults\ops.term ist schreibgeschützt.“ (Pfad aus `vaultPath`), Button `Erneut versuchen`. Die Komponenten (WorkspaceControls, VaultTree, FolderEditor, WorkflowsDialog, AiSettingsDialog) zeigen bei `false` nur noch das Was („Nicht gespeichert.“) inline oder nichts, weil `persistVault` bereits meldet.

### 2.5 Cluster-Reconnect · ★★★ · kleine Main-Änderung

- **Shared:** `ClusterStatus` + `attempt?: number` (1-basiert, nur bei `reconnecting`), `trying?: string` (Name der SSH-Verbindung des laufenden Versuchs), `since?: number` (ms-Zeitstempel des letzten erfolgreichen `ready`). `RECONNECTING_MESSAGE = 'Gesperrt, bis der Cluster wieder erreichbar ist.'` neben `NOT_CONNECTED_MESSAGE` (`shared/kubernetes.ts:147`).
- **Main:** `openAccess(cluster, deps, onTry?: (name: string) => void)` (`access.ts:82`) ruft `onTry(connection.name)` vor `openRemote`; `Session.establish` reicht ihn durch und setzt `this.trying`, `emitStatus()`. `retryNow` setzt `attempt + 1` vor `establish`. `status()` liefert `attempt`, `trying`, `since`. Test `session.test.ts` (Kube): nach Host-Ausfall kommt `reconnecting` mit `attempt: 1` und `trying`.
- **Renderer:** `kubernetes-ui.css:35-36` löschen; Gate-Zeile `.kube-stale` streichen. Neue Komponente `components/kubernetes/ClusterStatusBar.tsx` (eigene Datei) direkt unter dem Kopf, `role="status"`, immer gerendert (`min-height: var(--control-sm)`, Platz reserviert, keine Höhenänderung). Texte:
  - ready: `Live` · rechts `Stand vor 12 s` (Alter aus `state.updatedAt`, das der Reducer bei `rows`/`overview` setzt; Tick bleibt 10 s, Text „gerade aktualisiert“ unter 15 s).
  - reconnecting, erste 2 s: `k8s-cp1 antwortet nicht. Verbinde über k8s-cp2 …`; danach `Verbinde über k8s-cp2 … (Versuch 2)`; ohne `trying`: `Verbinde neu … (Versuch 2)`. Rechts `Stand vor 48 s`. Fläche `--color-warn-bg`, Rand `--color-warn-border`, Punkt gelb.
  - ready nach reconnecting, 3 s lang: `Wieder verbunden über k8s-cp2` (Fläche `--color-ok-bg`), dann `Live`.
  - error: bisherige Kopfzeile mit „Erneut versuchen“ bleibt; die Leiste zeigt `Nicht verbunden`.
  - Farbwechsel ohne Transition (U3).
- Kopfzeile `ClusterView.tsx:296-301`: „getrennt – verbinde neu …“ entfällt (Leiste übernimmt), „bereit über host“ bleibt.
- Sperren nur verändernder Aktionen: bereits so (`actionReason`), Text im Hint bei `reconnecting` → `RECONNECTING_MESSAGE`; Logs/YAML/Describe im Dock bleiben lesbar (gecachter Text), ein Neuladen antwortet mit `RECONNECTING` aus Main (`session.ts:28`), das der Dock als Satz zeigt. Auswahl, Fokus, Filter unverändert (kein Filter mehr).

### 2.6 Busy-Buttons und Container-Zielzustand · ★★ · nur Renderer

- `components/BusyButton.tsx` (neu): `<BusyButton busy done idleLabel busyLabel doneLabel className type disabled onClick />`. Breite fest über den längsten Text: `.busy-button { display: inline-grid; grid-template-areas: 'a' } .busy-button > * { grid-area: a }` und ein `aria-hidden` Sizer-Span pro Label mit `visibility: hidden` (kein Pixel-Maß, kein Token nötig). Sichtbarer Inhalt: Punkt `.busy-dot` (`--size-dot` 6 px? → `calc(var(--size-dot) - 2px)`; Farbe `currentColor`, auf Primärbutton also `--color-on-accent`) mit `tm-pulse` während `busy`, grüner Punkt (`--color-ok`) bei `done`; Label `Speichert …` → `Gespeichert` 1,2 s (`DONE_MS = 1200` im TSX), dann Idle. Label-Wechsel: Span mit `key={state}` und `@starting-style { opacity: .4 }` → `transition: opacity var(--dur-fade) var(--ease-out)`; reduce: ohne Übergang, Puls steht. CSS in `styles.css` (globale Komponente) mit `prefers-reduced-motion`-Block.
- Einsatz: `ConnectionForm.tsx:206` („Verbindung speichern“ / „Speichert …“ / „Gespeichert“; `done` nach `saved === true`), `FolderEditor.tsx:54`, `WorkspaceControls.tsx:89,113` („Speichern“ / „Speichert …“ / „Gespeichert“), `ConfirmDialog.tsx:43`, `ConfirmAction.tsx:87`, `PermissionsDialog.tsx:58` (dort nur `busy`, kein `done`, Label bleibt der Bestätigungstext; „Bitte warten …“ entfällt).
- Container-Aktion: `container-view.ts` `busy: Record<string, InventoryAction>`; Aktion `{ type: 'busy'; uid; action?: InventoryAction }` (ohne `action` = fertig). `ContainerTable.tsx:192-203`: Zelle `status` zeigt bei busy `BUSY_LABEL[action]`: `start → startet`, `stop → stoppt`, `restart → startet neu`, `remove → wird entfernt`, `pause → pausiert`, `unpause → läuft an` (nur vorhandene Aktionen aus `InventoryAction` belegen), Ton `warn`. `containers-ui.css:8-9`: nur `cursor: progress`, keine Opazität, kein `::after`. Nach dem Poll (`reload()` in `ContainerView.tsx:113`) kehrt der echte Wert zurück. Reducer-Test ergänzen (`container-view.test.ts`).

### 2.7 Motion-Gate-Einträge (docs/design-system.md) · ★★ · nur Doku + CSS

| Kandidat | Häufigkeit | Entscheidung | Eigenschaften, Kurve, Dauer | Reduced motion |
|---|---|---|---|---|
| Meldung ein/aus (`.toast`, alle drei Stufen) | gelegentlich, Ereignisse | animieren, Herkunft | wie heute: `opacity`, `translateY(100%)`, `--ease-out`, `--dur-toast` ein, `--dur-fade` aus | nur `opacity` |
| Ablaufbalken (`.toast-bar`) | laufend bei Hinweis/Erfolg | behalten, Zustand | Keyframe `toast-bar` `scaleX(1→0)`, `linear`, Dauer `--notice-ttl-info`/`--notice-ttl-ok`; Hover und `document.hidden` pausieren (`animation-play-state`) | Keyframe `toast-bar-width` (`width`, geduldet wie `progress`), gleiche Dauer |
| Vierte Meldung | selten | animieren | älteste über `.is-closing` | nur `opacity` |
| Fehlerkarte (`.connect-error`) | gelegentlich, Ereignis | animieren, harter Wechsel | `opacity 0→1`, `scale(.97)→1`, `--ease-out`, `--dur-modal`, Origin Mitte | nur `opacity` |
| Getrennt-Leiste (`.connect-closed`) | gelegentlich, Ereignis | animieren bei Server-Trennung, sofort nach Abbrechen/Esc (`data-instant`) | `opacity`, `translateY(100%)→0`, `--ease-out`, `--dur-toast` | nur `opacity` |
| Verbindungskarte (`.connect-card`) | Enter | **Warteanzeige**: erscheint nach 400 ms (`WAIT_MS`, TSX), dann nur `opacity` per `@starting-style`, `--dur-fade` | – | sofort, ohne Übergang |
| Schritt-Punkte | 4× je Verbindung | **nicht** (Audit: Farbübergang 150 ms abgelehnt, U3) | Farbe springt | – |
| Cluster-Leiste (`.kube-connbar`) | Ereignis | **nicht** (Audit: Farbübergang 200 ms abgelehnt, U3); Platz reserviert | – | – |
| „Gespeichert“-Label (`.busy-button`) | gelegentlich | animieren, Zustand | `opacity .4→1`, `--dur-fade`, `--ease-out`; Punkt `tm-pulse` während busy (Audit: `blur(2px)` abgelehnt, U3) | nur Einblenden, Puls steht |
| `.kube-stale` | – | **entfällt** | – | – |
| `.ctr-busy` | gelegentlich | nicht (Zieltext statt Blässe) | – | – |
| Spinner, Skelette | – | weiter nicht einführen; Warteanzeigen sind Text und Punkt nach 400 ms | – | – |

Abschnitt „Regeln für neues CSS“ ergänzt: Warteanzeigen erst nach 400 ms; Kupfer nie als Zustand, Gelb nie als Akzent; ein Statuspunkt-Maß `--size-dot`; Chevrons sind SVG (`m5 9 7 7 7-7`, 12 px, Rotation per CSS).

### 2.8 Kleinkram · ★ · nur Renderer

- `--size-dot: 8px`: `terminal-ui.css:15` (`width/height/flex-basis: var(--size-dot)`), `navigation-ui.css:68`, `.toast-dot`, `.kube-connbar-dot`; `NodeStrip.tsx:40` ohne Glyph, `.kube-dot` wird ein Kreis aus `currentColor` (`kubernetes-ui.css:44`).
- SVG-Chevron: `ProblemBanner.tsx:29`, `DetailDock.tsx:155`, `ContainerDock.tsx:188` (gleiches `<svg … d="m5 9 7 7 7-7">` wie `WorkspaceControls.tsx:81`, `aria-hidden`, Klasse `.chevron.is-open { transform: rotate(180deg) }` statisch ohne Transition – `transform` ohne Bewegung ist lint-neutral, R7b greift nur bei `:active`/`@starting-style`/Transition). Sortier- und Gruppen-Glyphen in Tabellen bleiben (Extra).
- `styles.css:112`: `border-color: var(--color-border-strong)`.

---

## 3. Regeln und Risiken – was ausdrücklich nicht getan wird

- Kein neuer IPC-Kanal, kein neues zod-Schema; `SshStatus`, `TransferSession`, `window-ipc.ts:33` unverändert. Abbrechen = `sshClose`, Neu verbinden = neue Session (neue ID), die alte ist im Main schon `finish`ed.
- `detail` enthält nur `error.message` (≤ 500 Zeichen). Kein Stack, keine Config, kein Schlüsselpfad außer dem, den der Nutzer selbst eingetragen hat (`key-file`-Ursache nennt den Pfad).
- Keine Primitive-Palette (U1), keine ANSI-Palette aus Tokens, kein Lucide-Paket (keine neuen Abhängigkeiten).
- Keine `background-color`-Transitions, kein `blur()`, keine Höhenänderung durch Leisten (Platz immer reserviert).
- Kein Escape auf Toasts, kein Fokus auf Toasts, keine Tastaturbedienung der Toast-Aktion (bekannte Lücke, wie heute der Schließen-Knopf). Esc/Enter wirken nur, wenn Karte oder Leiste den Fokus hat (Bereich fokussiert und sichtbar); xterm behält sonst alle Tasten.
- `.error-message` bleibt für Startkarte, ConfirmAction, ResourceTable-Leerzustand.
- Container-Ansicht ohne Reconnect-Leiste (hat keinen Reconnect-Zustand).
- Keine Screenshot-Tests; Feel-Check manuell.

Risiken:

| Risiko | Gegenmittel |
|---|---|
| R13: ein `.terminal-panel .connect-card`-Selektor würde `transform` verbieten | Karten-Selektoren ohne Bühnenklasse; `connection-ui.css` eigene Datei |
| R7b: bewegte Keyframes (`toast-bar` mit `scaleX`) werden dateiübergreifend gesammelt; jede `animation: toast-bar` außerhalb `no-preference` schlägt an | Balken-Regel im `no-preference`-Block, `reduce`-Zweig nutzt `toast-bar-width` |
| `terminal-theme.test.ts` bricht beim Token-Tausch | Fallbacks in derselben Task ändern (Welle 1, Task A) |
| `toast-state.test.ts` referenziert gelöschtes Modul | Datei mit löschen (R0 kennt `toast-ui.css`, nicht den Test) |
| `ConnectionPicker.tsx:83` hart „16“ | `sessionLimitText()` |
| Zeit-Tick der Karte (100 ms) läuft in versteckten Tabs weiter | Tick nur bei `visible`, Timer in Cleanup |
| Hinweise blenden die RDP-Fläche 3–5 s aus (S3-2) | akzeptiert (U5); Hinweise kommen nur von Nutzeraktionen |
| `hostVerifier` wird für jede Session aufgerufen, auch bei gespeicherten Schlüsseln → `hostkey`-Schritt dauert < 10 ms und ist sichtbar „erledigt“ | gewollt, die Zeit steht daneben |
| Main `attempt`/`trying` ohne Tests → Regression | Kube-`session.test.ts` hat Fake-Deps (`openAccess` injizierbar): `onTry`-Aufruf prüfen |
| `useTabTransfer` verliert `onError`-Prop → Signaturänderung in `App.tsx:160`, `SecondaryWindow.tsx:28` | gleiche Task wie App.tsx (Welle 2) |

---

## 4. Zerlegung in Wellen (Sonnet parallel, disjunkte Dateien)

Gate nach jeder Welle: `npm run typecheck`, `npx vitest run`.

### Welle 1 – Fundament (6 Tasks parallel, keine gemeinsamen Dateien)

| Task | Dateien | Inhalt | Abhängig von |
|---|---|---|---|
| **1A Tokens + Theme** | `tokens.css`, `terminal-theme.ts`, `terminal-theme.test.ts`, `ConnectionForm.tsx` (nur Zeile 136), `navigation-ui.css` (nur Zeile 71, 68), `assistant-ui.css` (nur Zeile 26), `styles.css` (nur Zeile 112) | 2.1 komplett, `--size-dot`, `--color-warn-bg`, `--color-ok-bg`, `--notice-ttl-*` | – |
| **1B Notice-Store + Toast** | `notice-store.ts` (neu), `notice-store.test.ts` (neu), `components/Toast.tsx`, `components/toast-ui.css`, löschen `toast-state.ts`, `toast-state.test.ts` | 2.2 Store, `ToastStack`, Stufen, Balken, Pause, max. 3 | 1A (Tokens-Namen; kann mit Platzhalternamen vorab laufen, Lint R18 prüft erst im Gate) |
| **1C Shared-Verträge + Texte** | `src/shared/ssh.ts`, `src/shared/connection-errors.ts` (neu + Test), `src/shared/sftp.ts` (nur `code`/`detail`), `src/shared/kubernetes.ts` (`attempt`, `trying`, `since`, `RECONNECTING_MESSAGE`), `src/shared/vault/connections.ts` (`sessionLimitNotice`, `sessionLimitText`), `status-words.ts` (neu + Test) | Verträge für alle späteren Tasks | – |
| **1D Main SSH** | `main/ssh/session.ts`, `main/ssh/session.test.ts`, `main/ssh/known-hosts.ts` (Fingerprints im Text), `main/files/sftp-session.ts` (nur `finish` → `code/detail`, Limit-Text), `main/rdp/host.ts` (Limit-Text), `main/rdp/ipc.ts:43`, `main/kubernetes/ipc.ts:77` (Text) | `classifyError`, Schritt-Events, `closed-by-server`, Texte ohne „Bitte“ | 1C (Typen) – Sonnet bekommt die Typen aus 1C vorab als Vertrag im Auftrag |
| **1E Main Kube** | `main/kubernetes/session.ts`, `main/kubernetes/access.ts`, `main/kubernetes/session.test.ts`, `main/kubernetes/access.test.ts` | `onTry`, `attempt`, `trying`, `since` | 1C |
| **1F Main Vault-Fehler** | `main/vault/ipc.ts`, `main/vault/ipc.test.ts` (falls vorhanden, sonst `storage.test.ts`) | fs-Codes → deutsche Ursachen | – |

### Welle 2 – Komponenten (6 Tasks parallel)

| Task | Dateien | Inhalt | Abhängig von |
|---|---|---|---|
| **2A App-Integration (Engpass, ein Umsetzer)** | `App.tsx`, `SecondaryWindow.tsx`, `hooks/useTabTransfer.ts`, `styles.css` (nur `.area-error`, `.error-message`-Block) | 2.2 Zuordnungstabelle, `setError(null)` entfernen, `formError`/`folderError` inline, `getErrorMessage` durchreichen, ok-Toast beim Workspace-Speichern, Texte 2.4 in App.tsx, `<ToastStack />`, `clearNotices` in `resetForm` | 1B, 1C, 1F |
| **2B Terminal-Karten** | `components/TerminalPanel.tsx`, `components/ConnectingCard.tsx` (neu), `components/ConnectionErrorCard.tsx` (neu), `components/DisconnectedBar.tsx` (neu), `components/connection-ui.css` (neu), `terminal-ui.css` (Zeile 15 `--size-dot`, Zeile 32 löschen) | 2.3 Renderer, `statusWord`, Esc/Enter, `attempt`, 400 ms | 1A, 1C, 1D |
| **2C RDP + SFTP + Tabs** | `components/RdpPanel.tsx`, `components/FilesPanel.tsx`, `components/TerminalTabs.tsx` | Karten einbauen (Komponenten aus 2B werden als Vertrag genannt; falls 2B und 2C gleichzeitig laufen, nutzt 2C die Props-Signatur aus dem Auftrag), `statusWord`, „…“ | 1C, 2B (Komponenten) → **2C startet nach 2B** oder in Welle 3 |
| **2D Cluster-Leiste** | `components/kubernetes/ClusterView.tsx`, `components/kubernetes/ClusterStatusBar.tsx` (neu), `kube-view.ts` (`updatedAt`), `kube-view.test.ts`, `kubernetes-ui.css` (Zeilen 35-36 löschen, `.kube-connbar`, `.kube-dot`), `kube-commands.ts`, `kube-menus.ts` (Hint bei reconnecting), `components/kubernetes/NodeStrip.tsx`, `components/kubernetes/ProblemBanner.tsx`, `components/kubernetes/DetailDock.tsx` (Chevron) | 2.5, 2.8 Kube-Teil | 1A, 1C, 1E |
| **2E BusyButton + Formulare** | `components/BusyButton.tsx` (neu), `components/ConnectionForm.tsx` (außer Zeile 136), `components/FolderEditor.tsx`, `components/WorkspaceControls.tsx`, `components/ConfirmDialog.tsx`, `components/PermissionsDialog.tsx`, `components/kubernetes/ConfirmAction.tsx`, `components/VaultTree.tsx`, `components/WorkflowsDialog.tsx`, `components/AiSettingsDialog.tsx`, `connection-form.ts`, `connection-form.test.ts`, `cluster-form.ts`, `cluster-form.test.ts`, `file-browser.ts`, `navigation-ui.css` (ohne Zeilen 68/71), `editor-ui.css`, `styles.css`-Block `.busy-button` → **Konflikt mit 2A auf `styles.css`**: BusyButton-CSS kommt in `editor-ui.css` (ConnectionForm importiert sie) | 2.6 Buttons, 2.4 Texte, `.area-error` in VaultTree/WorkspaceControls | 1A, 1C |
| **2F Container** | `container-view.ts`, `container-view.test.ts`, `components/containers/ContainerTable.tsx`, `components/containers/ContainerView.tsx`, `components/containers/ContainerDock.tsx` (Chevron), `containers-ui.css`, `components/ConnectionPicker.tsx` (Limit-Text) | 2.6 Zielzustand, 2.8 | 1A, 1C |

`styles.css` wird von 1A (Zeile 112), 2A (`.area-error`) berührt: 1A läuft vorher, 2A danach – kein Parallelkonflikt. `navigation-ui.css`: 1A (68, 71) vor 2E. `terminal-ui.css`: nur 2B. `SplitTerminalArea.tsx`: unberührt.

### Welle 3 – Doku, Lint, Abschluss (3 Tasks parallel)

| Task | Dateien | Inhalt |
|---|---|---|
| **3A Doku** | `docs/design-system.md`, `docs/handbuch.md` (Abschnitt „Meldungen und Verbindungszustand“), `CHANGELOG.md`, `package.json` (`npm run version:minor` → 0.11.0), `src/renderer/src/release-notes.ts` | Gate-Tabelle 2.7, Regeln, Token-Tabelle, Muster Feld/Bereich/global |
| **3B Text-Lint** | `ui-text.test.ts` (neu) | 2.4 Lint; läuft erst jetzt, weil Welle 2 die Texte ändert |
| **3C Nachzügler** | `components/RdpPanel.tsx`, `components/FilesPanel.tsx`, `components/TerminalTabs.tsx` (= 2C, falls 2B/2C nicht sequenziell liefen) | |

---

## 5. Minimale erste Stufe gegenüber Extras

**Erste Stufe (dieser Branch):**
1. Farbrichtung 1b (1A) – ★★★, ein Token-Tausch.
2. Meldungskanal mit Stufen, Stapel, Aktion (1B, 2A) – ★★★.
3. SSH-Schritte, Fehlerkarte, Getrennt-Leiste, Codes im Main (1C, 1D, 2B) – ★★★.
4. Cluster-Leiste statt Grau (1E, 2D) – ★★★.
5. Statuswörterbuch, „…“, Du-Imperativ im Renderer, Limit-Funktion, Vault-Ursachen (1C, 1F, 2E, 3B) – ★★.
6. BusyButton, Container-Zielzustand (2E, 2F) – ★★.
7. Gate-Einträge, Kleinkram (2D, 2F, 3A) – ★.

**Extras (später, eigene Specs):**
- Primitive-Palette in 12 Stufen (U1): `tokens.css` + `terminal-theme.test.ts` (Auflösung der `var()`-Kette) + Doku.
- SFTP-Schritte (U8): `SftpEvent` um `step`, `sftp-session.ts` mit `hostVerifier`-Marker.
- RDP mit mehr Phasen aus dem Helfer (`Shellherd.RdpHost` müsste `connecting`/`negotiating`/`login` melden).
- Main-„Bitte“-Texte in ai, containers, migrations, actions mit Testanpassung; Lint auf `src/main` ausweiten.
- Sortier-/Gruppen-Glyphen (`▾▴`, `▲▼`, `▸`) in Tabellen als SVG.
- Tastaturbedienung der Toast-Aktion (F8-ähnlicher Sprung in die Meldung), heute bewusst ausgeklammert (S3-1).
- Anmelde-Notiz („Schlüssel id_ed25519“) in der Verbindungskarte – braucht die Auth-Methode am Tab (`TabConnection`) oder eine Katalog-Abfrage.

---

## 6. Tests und Abnahme (für Spec und Validierung)

Automatisch: `notice-store.test.ts` (push/max 3/close/remove/ttl je Stufe), `status-words.test.ts`, `connection-errors.test.ts` (jeder Code hat Titel/Ursache/Schritt/Aktionen; `detail` ≤ 500), `ui-text.test.ts` (Fixture positiv/negativ), `main/ssh/session.test.ts` (Schritt-Reihenfolge, `code: 'auth'`, `closed-by-server`), `main/kubernetes/session.test.ts` (`attempt`, `trying`, `since`), `kube-view.test.ts` (`updatedAt`), `container-view.test.ts` (`busy` mit Aktion), `terminal-theme.test.ts` (neue Fallbacks), `design-tokens.test.ts` unverändert grün (R9 mit neuen Namen, R7b für `toast-bar`, R13 für `connection-ui.css`), `cluster-form.test.ts`, `connection-form.test.ts` (neue Sätze).

Manuell (Electron, synthetischer Vault, lokaler SSH-Testserver): (1) Verbinden gegen `127.0.0.1:1` → Karte nach 400 ms, Schritt 1 wird rot, Karte „Verbindung abgelehnt“ mit Details-Rohtext, „Erneut verbinden“ erzeugt neue Session; (2) `sleep 2; exit` → Getrennt-Leiste mit tickender Zeit, Enter verbindet neu; (3) während des Aufbaus Esc → Leiste sofort ohne Animation; (4) Ordner ohne Verbindungen → Hinweis mit Balken, Hover pausiert, nach 5 s weg, Klick in den Baum schließt nichts; vier Fehler nacheinander → der älteste verlässt den Stapel; (5) Vault schreibgeschützt setzen, Workspace speichern → Fehler-Toast mit Ursache und „Erneut versuchen“; Button zeigt „Speichert …“ ohne Breitensprung, dann 1,2 s „Gespeichert“; (6) Cluster: Zugangs-Host trennen → Leiste gelb mit Host und Versuch, Tabelle lesbar, Neu starten gesperrt mit Tooltip „Gesperrt, bis der Cluster wieder erreichbar ist.“, nach Rückkehr 3 s grün „Wieder verbunden über …“; (7) Container starten → Status-Zelle „startet“, Zeile bleibt voll sichtbar; (8) Feel-Check bei fünffacher Dauer und mit emuliertem reduced motion: Karte wächst aus der Mitte, Leiste kommt von unten, Balken läuft, Label blendet; unter reduce nur Einblenden, Balken als Breite; (9) RDP: Hinweis-Toast blendet die Fläche für 5 s aus, danach pixelgenau zurück; (10) Kontrast-Stichprobe Kupfer-Primärbutton und gedämpfter Text auf Panel.

---

## Anhang: Grep-Belege

- `...` in Strings: `ConnectionForm.tsx:206`, `ConfirmDialog.tsx:43`, `FilesPanel.tsx:212`, `FolderEditor.tsx:54`, `RdpPanel.tsx:23`, `kubernetes/ConfirmAction.tsx:87`, `TerminalPanel.tsx:29` (Kommentare in `inventory-batch.test.ts:26`, `design-tokens.test.ts:79` sind keine Strings).
- Limit-Text: `App.tsx:610,654,665,683,707,714`, `SecondaryWindow.tsx:82`, `ConnectionPicker.tsx:83`, `main/ssh/session.ts:141`, `main/rdp/host.ts:68`, `main/files/sftp-session.ts:62`.
- `role="alert"` heute: 23 Stellen (siehe 1.2), davon bleiben Feldfehler und `.error-message`; `Toast.tsx:19` wird je Stufe `alert`/`status`.
- ssh2-Ereignisse: `@types/ssh2/index.d.ts:330-432` (`banner`, `ready`, `error`, `end`, `close`, `timeout`, `greeting`, `handshake`, `hostkeys`); `lib/client.js:767` `emit('connect')` untypisiert; `level`-Werte `client-authentication`, `client-timeout`, `client-socket`, `protocol` (`client.js:404,721,804,864,1115`).
