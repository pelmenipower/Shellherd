# Rebranding Terminus → Shellherd: Recherche und Empfehlung

Stand: 2026-10-19, Branch `claude/feature/shellherd-rebrand`, Basis `017c85b`.
Icons vom Nutzer: `resources/Shellherd-Icons.zip` (unversioniert), entpackt unter
`C:\Users\user\AppData\Local\Temp\claude\C--workspace-Terminus\c164ed33-6480-4141-8932-cc088df10c19\scratchpad\shellherd-icons\`.
Künftiges Remote: `https://github.com/pelmenipower/Shellherd`.

## 0. Empfehlung in Kürze

1. **Sichtbare Marke komplett umbenennen** (Fenstertitel, Dialoge, Kopfzeile, Willkommensseite, Release-Notes, KI-Prompt, Hinweise, README, CHANGELOG-Kopf, Designsystem-Doku). `package.json` bekommt `name: "shellherd"`, `productName: "Shellherd"`.
2. **Persistente Formate nicht anfassen**: `terminus-vault`, `terminus-encrypted-vault`, AAD `terminus-encrypted-vault:v1`, Endungen `.term`/`.terminus`. Sie sind Dateiformat, nicht Marke. Ein Umbenennen würde jeden bestehenden Vault unlesbar machen.
3. **userData wandert** von `%APPDATA%\Terminus` nach `%APPDATA%\Shellherd` (Electron leitet den Pfad aus `productName`/`name` ab). Darin liegen `known-hosts.json` (SSH-Vertrauensdatei, sicherheitsrelevant) und `last-vault.json`. **Einmalige Kopie beim ersten Start ist Pflicht**, kein Weiterbenutzen des alten Pfads, kein Löschen.
4. **Dateizuordnung** bekommt die neue ProgID `Shellherd.Vault`; `register()`/`unregister()` räumen die alte `Terminus.Vault` mit ab. Endung bleibt `.term`.
5. **Icons** werden aus der 662-px-Vorlage per Electron `nativeImage` erzeugt (Maske für die runden Ecken, Größen 16–256, `.ico` als PNG-Container), ohne neue Pakete. Versioniert: `resources/brand/shellherd-master.png`, `resources/icon.ico`, `resources/icon.png`, `resources/mark-64.png`. Das ZIP bleibt unversioniert.
6. **Version 0.10.0** mit CHANGELOG-Abschnitt; die Release-Notes erscheinen wegen des neuen userData-Verzeichnisses ohnehin beim ersten Start.
7. **Nicht jetzt:** sudo-Marker `[terminus-…]`, Installer/electron-builder (gibt es heute nicht), vereinfachtes 16-px-Glyph, historische Specs/Pläne/CHANGELOG-Einträge.

## 1. Bestand: Inventar aller Vorkommen

Legende Entscheidung: **JA** umbenennen, **NEIN** bleibt, **SPÄTER** nicht in dieser Stufe.

### 1.1 Identität, Pfade, Fenster (Main)

| Fundstelle | Inhalt | Entscheidung | Grund |
|---|---|---|---|
| `package.json:2` | `"name": "Terminus"` | JA → `"name": "shellherd"`, neu `"productName": "Shellherd"` | Electron nimmt `productName` vor `name` für `app.getName()` und damit für `userData`. Kleinschreibung bei `name` ist npm-Konvention. |
| `package.json:4` | `description` | JA → `"Shellherd – a local, encrypted connection manager for SSH, RDP, containers and Kubernetes."` | Veraltet (nur SSH). Neu dazu: `"homepage": "https://github.com/pelmenipower/Shellherd"`, `"repository": { "type": "git", "url": "https://github.com/pelmenipower/Shellherd.git" }`. |
| `package-lock.json` (Wurzel und `packages[""]`) | `"name": "Terminus"` ×2, `"version": "0.9.0"` ×2 | JA | Muss zu `package.json` passen; `npm run version:minor` zieht nur die Version nach, den Namen von Hand ändern. |
| `src/main/index.ts:64` | `title: role === 'main' ? 'Terminus' : 'Terminus – Sitzungen'` | JA → `'Shellherd'` / `'Shellherd – Sitzungen'` | Sichtbarer Fenstertitel. |
| `src/main/index.ts:60-74` | `new BrowserWindow({...})` ohne `icon` | JA → `icon: brandIconPath()` | Heute zeigt Fenster und Taskleiste das Electron-Icon. |
| `src/main/index.ts:112` | Dialog `'Terminus schließen'` / `'… und Terminus schließen?'` | JA | Sichtbar. |
| `src/main/index.ts:149-151` | Single-Instance-Lock, Kommentar „One Terminus per user“ | Kommentar JA; Verhalten NEIN | Siehe Abschnitt 2.4. |
| `src/main/index.ts:165-183` | `app.whenReady()` → `createKnownHosts()` (Z. 183), `registerVaultIpcHandlers` (später) | JA: davor `migrateUserData()` einhängen | Muss vor dem ersten Lesen aus `userData` laufen. |
| `src/main/index.ts` (kein Treffer) | kein `app.setAppUserModelId` | JA → `app.setAppUserModelId('com.pelmenipower.shellherd')` vor `whenReady` | Ohne AUMID gruppiert Windows Dev-Fenster unter „Electron“; Toasts hießen „Electron“. Keine persistierten Daten hängen daran. |
| `src/main/index.ts:167` | `new FileAssociation(process.execPath, …)` | JA → dritter Parameter Icon-Pfad | `DefaultIcon` zeigt sonst `electron.exe,0`. |
| `src/main/ssh/ipc.ts:23` | `join(app.getPath('userData'), 'known-hosts.json')` | NEIN (Pfad folgt automatisch) | Muss migriert werden, siehe 2.1. |
| `src/main/vault/ipc.ts:48` | `join(app.getPath('userData'), 'last-vault.json')` | NEIN (Pfad folgt automatisch) | Migration, siehe 2.1. |
| `src/main/vault/ipc.ts:75,79-80,120,126-127` | Dialogtitel `'Terminus-Vault speichern'`/`'… auswählen'`, Filtername `'Terminus Vault'`, `extensions: ['term','terminus']` | Titel und Filtername JA → `'Shellherd-Vault speichern'`, `'Shellherd Vault'`; Endungen NEIN | Endungen sind Dateiformat. |
| `src/main/windows.ts:28,62`, `src/main/drag-ghost.ts:24` | Kommentare „Terminus windows“ | JA | Konsistenz, kostenlos. |

### 1.2 Dateizuordnung (`file-association.ts`)

| Fundstelle | Inhalt | Entscheidung | Grund |
|---|---|---|---|
| `src/main/file-association.ts:6` | `VAULT_EXTENSIONS = ['.term', '.terminus']` | NEIN | `.term` liest sich als „Terminal“, ist seit 0.x dokumentiert (CHANGELOG:69) und auf Nutzerrechnern registriert. `.terminus` ist Altbestand. |
| `src/main/file-association.ts:7` | `PROG_ID = 'Terminus.Vault'` | JA → `'Shellherd.Vault'`, neu `LEGACY_PROG_ID = 'Terminus.Vault'` | ProgID ist in Explorer sichtbar („Dateityp“). |
| `src/main/file-association.ts:32` | `add(PROG_ID, 'Terminus Vault')` | JA → `'Shellherd Vault'` | Sichtbarer Typname. |
| `src/main/file-association.ts:35` | `'Mit Terminus öffnen'` | JA → `'Mit Shellherd öffnen'` | Kontextmenü im Explorer. |
| `src/main/file-association.ts:60-65` `register()` | schreibt nur neue Schlüssel | JA: zusätzlich alte ProgID löschen (`HKCU\Software\Classes\Terminus.Vault`, `.term\OpenWithProgids\Terminus.Vault`, `.terminus\OpenWithProgids\Terminus.Vault`) | Sonst bleiben zwei Einträge „Mit Terminus öffnen“/„Mit Shellherd öffnen“ im Explorer. |
| `src/main/file-association.ts:67-74` `unregister()` | löscht nur eigene Schlüssel | JA: beide ProgIDs; `.term`-Default entfernen, wenn es auf eine von beiden zeigt | Sauberes Aufräumen auch für Alt-Installationen. |
| `src/main/file-association.ts:63` | `DefaultIcon = "${execPath}",0` | JA → `"${iconPath}",0` mit `resources/icon.ico` | Im Dev-Betrieb ist `execPath` `electron.exe`. |
| `src/main/file-association.test.ts:14-15,21-23` | Pfade `…\Terminus\Terminus.exe`, ProgID, Menütext | JA anpassen; neue Fälle für Legacy-Löschung | |
| `src/renderer/src/components/WelcomePage.tsx:62,71,78` | „Mit Terminus öffnen“, „Terminus ist mit .term-Dateien verknüpft.“ | JA | Sichtbar. |

### 1.3 Persistente Formate: bleiben unverändert

| Fundstelle | Inhalt | Entscheidung | Grund |
|---|---|---|---|
| `src/main/vault/crypto.ts:29` | AAD `'terminus-encrypted-vault:v1'` | **NEIN** | Geht in den AES-GCM-Auth-Tag ein. Ändern = jeder Vault entschlüsselt nicht mehr. |
| `src/main/vault/crypto.ts:143`, `src/shared/vault/file-format.ts:2`, `schema.ts:229`, `schema.test.ts:118` | `format: 'terminus-encrypted-vault'` | **NEIN** | Dateikennung auf der Platte. |
| `src/shared/vault/schema.ts:210`, `migrations.ts:22`, `types.ts:120`, `example.ts:4`, `mutations.test.ts:327`, `src/renderer/src/App.tsx:67` | `format: 'terminus-vault'` | **NEIN** | Kennung des Klartext-Dokuments; ein Alias wäre eine Formatmigration (MAJOR) ohne Nutzen. |
| `src/main/vault/storage.ts:22,28,75-76`, `storage.test.ts:34-41,81` | `.term`/`.terminus` | NEIN | Dateiformat. |
| `src/renderer/src/App.tsx:87` | `isVaultFileName` `.term|.terminus` | NEIN | |
| `src/main/vault/migration-backup.test.ts:13,17,40,54` | `legacy.terminus`, Kommentar „older Terminus builds“ | NEIN (Kommentar darf bleiben: historisch korrekt) | |

### 1.4 Sichtbare Texte (Renderer, Main, Shared)

| Fundstelle | Inhalt | Entscheidung |
|---|---|---|
| `src/renderer/index.html:6` | `<title>Terminus</title>` | JA (Fallback-Titel bis Electron den Fenstertitel setzt). Kein Favicon nötig: Electron ignoriert `<link rel="icon">` für das Fenster. |
| `src/renderer/src/App.tsx:757` | `<span className="brand-word">Terminus</span>` | JA → Icon `<img className="brand-icon" src={mark} alt="" />` + `Shellherd` |
| `src/renderer/src/App.tsx:869-871` | `.brand-mark` mit SVG `>_`, `<span>Terminus</span>` | JA → `<img className="brand-mark" src={mark} alt="" />` + `Shellherd` |
| `src/renderer/src/App.tsx:1057` | `<footer>Terminus {version}</footer>` | JA |
| `src/renderer/src/App.tsx:182` | Kommentar | JA |
| `src/renderer/src/components/ReleaseNotes.tsx:35` | `Terminus {version}` | JA |
| `src/renderer/src/components/AiSettingsDialog.tsx:66,98` | „Terminus-Hauptprozess“, „Terminus findet …“ | JA |
| `src/renderer/src/kube-menus.ts:355`, `kube-menus.test.ts:451,726` | „zeigt Terminus nicht an.“ | JA (Test mitziehen) |
| `src/shared/vault/migrations.ts:59`, `migrations.test.ts:37` | „neueren Terminus-Version … aktualisiere Terminus.“ | JA (Test mitziehen) |
| `src/main/ai/assistant.ts:19,22` | System-Prompt „Terminal-Assistent in Terminus“, „Terminus tippt ihn ein“ | JA |
| `src/main/ssh/session.ts:251,286`, `session.test.ts:450-451` | `[Terminus] sudo hat nicht wie erwartet geantwortet` | JA → `[Shellherd] …` (Test mitziehen) |
| `src/renderer/src/components/{AssistantPanel.tsx:29, SplitTerminalArea.tsx:106}`, `assistant-chat.ts:61`, `src/shared/{ipc.ts:225,247, ai-cli.ts:3}` | Kommentare | JA |

### 1.5 Interne Kennungen

| Fundstelle | Inhalt | Entscheidung | Grund |
|---|---|---|---|
| `src/renderer/src/release-notes.ts:7` `'terminus.seenVersion'`, `AssistantPanel.tsx:45-46` `'terminus.aiProvider'`, `'terminus.aiStepByStep'`, `hooks/useAssistantToggle.ts:4` `'terminus.assistantOpen'` | localStorage-Schlüssel | JA → `shellherd.*` | Kostenlos: der Chromium-Speicher liegt unter `userData` und ist nach dem Pfadwechsel ohnehin leer. |
| `src/renderer/src/components/FilePane.tsx:8` `'application/x-terminus-files'`, `VaultTree.tsx:44` `'application/x-terminus-node'` | Drag-and-Drop-MIME, nur app-intern | JA → `x-shellherd-…` | Je eine Konstante, Verbraucher importieren sie (`FilePane.tsx:135,148,170`, `VaultTree.tsx:102`). |
| `src/main/kubernetes/client-api.ts:377,388`, `client-api.test.ts:370` | fieldManager `'terminus'` | JA → `'shellherd'` | Sichtbar in `managedFields` auf dem Cluster. Nur MergePatch/Create, kein Server-Side-Apply, daher keine Konflikte mit alten Einträgen. |
| `src/main/rdp/host.ts:10-11,78`, `src/main/rdp/ipc.ts:28` | `TERMINUS_RDP_DEBUG`, `TERMINUS_RDP_SMARTSIZE`, `TERMINUS_RDP_MODE` | JA → `SHELLHERD_RDP_*` | Entwickler-Schalter, drei Zeilen. |
| `src/main/files/remote-edit.ts:55` | Temp-Präfix `'terminus-edit-'` | JA → `'shellherd-edit-'` | Der Pfad erscheint im externen Editor. |
| `src/main/containers/sudo.ts:5`, `inventory-batch.ts:7` und ~12 Testdateien (`commands.test.ts`, `discovery.test.ts`, `inventory-batch.test.ts`, `runner.test.ts`, `sudo-run.test.ts`, `sudo.test.ts`, `ssh/session.test.ts:50-51,312-343,459`) | sudo-/list-/ready-Marker `[terminus-…-<hex>]` | **SPÄTER** | Nur im Draht zum Remote-Host, pro Sitzung zufällig, nie gespeichert. Umbenennen zieht 14 Dateien, bringt dem Nutzer nichts. Folge-Task. |
| Test-Temp-Präfixe (`terminus-test-`, `terminus-sftp-` usw. in `*.test.ts`) | nur Tests | NEIN | Wertlos. |
| `src/main/kubernetes/access.test.ts:151`, `ssh/local-shell.test.ts:68`, `locate.test.ts:13` | Platzhalterpfade in Tests | NEIN | |

### 1.6 RDP-Helfer (C#) und Skripte

| Fundstelle | Inhalt | Entscheidung |
|---|---|---|
| `native/Terminus.RdpHost/` (Ordner) | | JA → `git mv native/Terminus.RdpHost native/Shellherd.RdpHost` |
| `native/Terminus.RdpHost/app.manifest:3` | `name="Terminus.RdpHost"` | JA → `Shellherd.RdpHost` |
| `NativeSurface.cs:5`, `Program.cs:8`, `Protocol.cs:7`, `RdpInterop.cs:5`, `RdpSession.cs:7` | `namespace Terminus.RdpHost` | JA → `Shellherd.RdpHost` |
| `RdpSession.cs:77` | Fenstertext `"Terminus RDP-Prototyp - "` | JA → `"Shellherd RDP - "` |
| `RdpSession.cs:32,138,307,351`, `NativeSurface.cs:7,46` | Kommentare (inkl. `TERMINUS_RDP_DEBUG`) | JA |
| `scripts/build-rdp-host.mjs:14,15,35,38` | Quellordner, Exe-Name | JA → `Shellherd.RdpHost.exe` |
| `scripts/rdp-try.mjs:17` | Exe-Pfad | JA |
| `src/main/rdp/ipc.ts:33,35` | `'../rdp-host/Terminus.RdpHost.exe'`, Kommentar | JA |
| Protokoll zwischen Main und Helfer (`Protocol.cs`, `host.ts`) | keine Markennamen in Nachrichten | nichts zu tun |

Hinweis: `out/rdp-host/Terminus.RdpHost.exe` bleibt als Leiche in `out/` (ignoriert). `npm run dev` baut die neue Exe; die alte stört nicht.

### 1.7 Dokumentation

| Fundstelle | Entscheidung |
|---|---|
| `README.md:1` Titel, `:3` „`.terminus`-Vaults“ (veraltet, heute `.term`), `:108-232` Prosa | JA: Titel `# Shellherd`, Icon-Zeile `<img src="resources/icon.png" width="96" alt="Shellherd">`, Satz „Shellherd hieß bis Version 0.9.0 Terminus; Vault-Dateien (`.term`, ältere `.terminus`) bleiben kompatibel.“, Prosa `Terminus` → `Shellherd`, Abschnitt „Icons“ (Skript `npm run icons`). GitHub-URL nur über `package.json`; im README reicht die Erwähnung des Repos im Kopf. |
| `CHANGELOG.md:3` „Alle nennenswerten Änderungen an Terminus.“ | JA → „… an Shellherd (bis 0.9.0 unter dem Namen Terminus).“ |
| `CHANGELOG.md:69` „`.terminus`-Dateien funktionieren weiter“ | NEIN (historischer Eintrag) |
| `docs/design-system.md:1,7` | JA: Titel `# Shellherd-Designsystem`, Leitsatz; neuer Absatz „Marke“ (Abschnitt 4) |
| `UI_UX_PLAN.md`, `RDP_IMPLEMENTIERUNGSPLAN.md`, `docs/superpowers/specs/**`, `docs/superpowers/plans/**` | NEIN: historische Arbeitsdokumente, Datums-Specs sind Protokoll. |
| `LEARNING.md` | kein Treffer |
| `.claude/agents/*.md`, `.claude/skills/feature-pipeline/SKILL.md` | **nicht versioniert** (`.git/info/exclude`, `git ls-files` leer). Außerhalb des Repos; der Orchestrator kann sie lokal anpassen, kein Task. |
| `CLAUDE.md` | liegt nicht im Arbeitsbaum (`ls` zeigt keine Datei). Kein Task. |

## 2. Risiken für bestehende Nutzer und Migration

### 2.1 userData-Verzeichnis (Pflicht-Migration)

Ist: Electron leitet `app.getPath('userData')` aus `app.getName()` ab, heute `%APPDATA%\Terminus` (aus `package.json:2`). Inhalt, den Shellherd selbst schreibt:

- `known-hosts.json` (`src/main/ssh/ipc.ts:23`, Schema in `known-hosts.ts:6-9`): SSH-Host-Fingerprints, Trust-on-first-use. **Sicherheitsrelevant:** Geht sie verloren, fragt jede Verbindung neu nach dem Host-Schlüssel, und Nutzer klicken Bestätigungen in Serie weg. Genau das Fenster, das die Datei schließen soll.
- `last-vault.json` (`src/main/vault/ipc.ts:48`, `last-vault.ts`): nur der Pfad des zuletzt geöffneten Vaults (CHANGELOG 0.8.0 „Zuletzt geöffnete Vault-Datei wird beim Start vorausgewählt“). Komfort.
- Chromium-Profil (`Local Storage/leveldb`, Cache): enthält die vier localStorage-Schlüssel (1.5). Verlust ist unkritisch: Release-Notes erscheinen einmal (gewollt für 0.10.0), KI-Anbieterwahl und Assistent-Zustand setzen sich zurück.
- Workspaces liegen **im Vault**, nicht in `userData`. Keine Gefahr.

Entscheidung: **einmalige Kopie, nicht Weiterbenutzen, nicht Verschieben.**

- Weiterbenutzen (`app.setPath('userData', …\Terminus)`) hält den alten Namen für immer am Leben und verwirrt bei Fehlersuche. Verworfen.
- Verschieben/Löschen zerstört eine parallel installierte alte Version. Verworfen.
- Kopie: neues Modul `src/main/user-data.ts`, `migrateUserData(appData: string, from = 'Terminus', to = 'Shellherd', files = ['known-hosts.json', 'last-vault.json'])`: wenn `appData/to` fehlt oder die Datei dort fehlt und `appData/from/<datei>` existiert → `mkdirSync(to, { recursive: true })`, `copyFileSync(src, dst, COPYFILE_EXCL)`. Synchron (wenige KB), Fehler schlucken (bestenfalls erneuter Versuch beim nächsten Start). Aufruf in `index.ts` zu Beginn von `app.whenReady().then(…)`, vor `createKnownHosts()` (Z. 183) und `registerVaultIpcHandlers` (später in derselben Funktion). Nie etwas im alten Ordner anfassen. Test mit Temp-Verzeichnissen: kopiert, überschreibt nicht, ignoriert fehlende Quelle.
- Idempotent: Ist die Zieldatei vorhanden, passiert nichts. Kein Marker nötig.

### 2.2 Dateizuordnung alter Vault-Dateien

Ist: Registrierung pro Nutzer (`HKCU\Software\Classes`), `.term` → `Terminus.Vault` → `"<exe>" "%1"`. Nach dem Rebranding zeigt die alte Registrierung weiter auf `electron.exe` + Projektpfad; `vaultFileFromArgs` (`file-association.ts:15`) versteht `.term` und `.terminus` weiterhin. Doppelklick funktioniert also auch ohne Neuregistrierung, nur der Menütext bleibt „Mit Terminus öffnen“ und `registered()` liefert `false`, weil die neue ProgID fehlt. Die Willkommensseite bietet dann „verknüpfen“ an; `register()` ersetzt die Einträge und löscht die alte ProgID (1.2). Keine automatische Registry-Änderung beim Start (bindend aus bisheriger Praxis: Registry nur auf Nutzerklick).

### 2.3 Keychain / safeStorage

Kein Vorkommen von `safeStorage`, keyring oder Credential Manager im Code (`grep` leer). Passwörter liegen im Vault. Nichts zu migrieren.

### 2.4 Single-Instance-Lock

`app.requestSingleInstanceLock()` (`index.ts:150`) hängt am `userData`-Pfad. Nach der Umbenennung können eine alte Terminus-Instanz und Shellherd gleichzeitig laufen. Das ist richtig so: zwei Programme, zwei Sperren. Explorer-Doppelklick auf `.term` geht an die registrierte App.

### 2.5 Windows-AppUserModelId

Heute nicht gesetzt; Taskleiste gruppiert unter Electrons Standard-ID. Mit `app.setAppUserModelId('com.pelmenipower.shellherd')` gruppieren alle Shellherd-Fenster korrekt und das Fenster-Icon greift in der Taskleiste. Pinnt der Nutzer später eine Verknüpfung, muss sie dieselbe ID tragen (Thema für einen Installer, nicht jetzt). Keine gespeicherten Daten betroffen.

### 2.6 Vault-Format

Unverändert (1.3). Alte und neue Version lesen und schreiben dieselben Dateien. Kein MAJOR.

## 3. Icons

### 3.1 Befund der gelieferten Dateien (gemessen mit `nativeImage.toBitmap`)

| Datei | Größe | Hintergrund | Kachel-Bounding-Box (nicht-helle Pixel) | Ecke |
|---|---|---|---|---|
| `shellherd-app-icon.png` | 662×662, RGB opak | `#f8f8fa` | x 0–660, y 8–651 (661×644): Kachel links/rechts leicht beschnitten, oben 8 px Rand | Radius ≈ 125 px (≈ 19 %) |
| `shellherd-256.png` | 256 | `#f8f8fa` | x 0–254, y 3–252 | ≈ 46 px |
| `shellherd-64.png` | 64 | – | füllt ganz | ≈ 11 px |
| `shellherd-32.png` | 32 | `#f8f8fa` | x 3–31, y 2–29 (29×28, verschoben) | ≈ 4 px |
| `shellherd-16.png` | 16 | `#fcfcfe` | füllt ganz, Mitte grau (Motiv verschmiert) | ≈ 2 px |

Kachelfarbe: `#141d2a`-nah (Mitte `rgb(20,29,42)`, Rand `rgb(21,32,45)`); sie liegt zwischen `--color-bg-panel #111925` und `--color-bg-raised #182334` und passt ins Designsystem. Motiv: Berner Sennenhund mit `>_`-Prompt, Weiß/Orange auf Dunkelblau.

Folgerung: Die kleinen Exporte sind uneinheitlich beschnitten und ohne Alpha. **Nur die 662-px-Vorlage wird versioniert und als einzige Quelle genutzt**; alle Größen entstehen daraus per Skript. Die übrigen PNGs und das ZIP bleiben unversioniert (`.gitignore`: `resources/*.zip`).

### 3.2 Erzeugung ohne neue Pakete

`node_modules` enthält keine PNG-/ICO-Bibliothek (kein `pngjs`, `sharp`, `jimp`). Electron 44.4.2 ist vorhanden; `nativeImage` kann PNG lesen (`createFromPath`), rohe BGRA-Pixel liefern (`toBitmap`), aus BGRA ein Bild bauen (`createFromBitmap`), skalieren (`resize({ quality: 'best' })`) und PNG schreiben (`toPNG`). Geprüft: Round-Trip 256→Bitmap→Bild→48 px→PNG funktioniert (4,5 KB). Ein ESM-Skript läuft direkt als Electron-Hauptprozess (`electron scripts/icons/make-icons.mjs`, Electron ≥ 28 unterstützt ESM-Einstieg).

Skript `scripts/icons/make-icons.mjs` (Electron-Einstieg, nach `app.whenReady()`, am Ende `app.exit(0)`):

1. `resources/brand/shellherd-master.png` laden, Bounding-Box aller Pixel mit Luminanz < 200 bestimmen (erwartet x 0–660, y 8–651).
2. Quadrat: Seite `s = min(w, h)` = 644, zentriert in der Box (Mitte 330 / 329,5). Radius `r = 0,20 · s` (≈ 129 px, bewusst 1 Prozentpunkt größer als gemessen, damit keine hellen Splitter an den Ecken bleiben).
3. Alphamaske: Pro Pixel vorzeichenbehafteter Abstand zum abgerundeten Quadrat; Alpha = `clamp(0,5 − d, 0, 1) · 255` (1 px weiche Kante). Außerhalb Alpha 0 und RGB 0 (saubere Vormultiplikation). Ergebnis per `createFromBitmap` → 644-px-Quelle mit Alpha. Pixel innerhalb der Maske bleiben unangetastet (weißes Fell ist Motiv, nicht Hintergrund).
4. `resize` auf 256, 64, 48, 32, 24, 16 (`quality: 'best'`) → PNG-Puffer.
5. Schreiben: `resources/icon.png` (256), `resources/mark-64.png` (64, Renderer), `resources/icon.ico` mit den Einträgen 16, 24, 32, 48, 64, 256.
6. ICO-Container in `scripts/icons/ico.mjs` als reine Funktion `buildIco(entries: Array<{ size: number; png: Buffer }>): Buffer`: Header 6 Byte (`0, 1, n`), je Eintrag 16 Byte (Breite/Höhe mit 0 für 256, 0 Farben, 0 reserviert, 1 Ebene, 32 bpp, Länge, Offset), danach die PNG-Blöcke. Windows ab Vista liest PNG-komprimierte Einträge in allen Größen. Dazu `parseIco(buffer)` für den Test.
7. `package.json` → `"icons": "electron scripts/icons/make-icons.mjs"`.

Tests (`scripts/icons/ico.test.mjs`, Vitest findet `*.test.mjs` mit Standardmuster):
- `buildIco`: Header, Offsets lückenlos, 256 als 0 kodiert, Round-Trip über `parseIco`.
- Versionierte Artefakte: `resources/icon.ico` enthält genau die Größen 16, 24, 32, 48, 64, 256 und jeder Eintrag beginnt mit der PNG-Signatur; `resources/icon.png` und `resources/mark-64.png` haben IHDR 256×256 bzw. 64×64 mit Farbtyp 6 (RGBA). Damit kann niemand versehentlich eine Variante ohne Alpha einchecken.

Bekannte Grenze: Bei 16 px ist das Motiv Brei, wie auch im gelieferten 16-px-Export. Ein vereinfachtes Glyph für 16/24 ist ein Extra (Abschnitt 9).

### 3.3 Einbindung

| Fläche | Wie | Datei |
|---|---|---|
| Fenster und Taskleiste | `icon: brandIconPath()` in `createWindow` (`index.ts:60`). Neues `src/main/brand.ts`: `brandIconPath = () => app.isPackaged ? join(process.resourcesPath, 'icon.ico') : join(app.getAppPath(), 'resources', 'icon.ico')`; auf Nicht-Windows `icon.png`. Bewusst **kein** `?asset`-Import: der Dev-Pfad bleibt stabil (keine Hash-Namen), und derselbe Pfad landet in der Registry. | `src/main/brand.ts`, `src/main/index.ts` |
| Explorer-Icon für `.term` | `FileAssociation(execPath, appPath, iconPath)`; `DefaultIcon = "<iconPath>",0` (`file-association.ts:63`) | `src/main/file-association.ts`, `index.ts:167` |
| App-Kopf | `<img className="brand-icon" src={mark} alt="" />` vor `.brand-word` (`App.tsx:757`), 24 px | `App.tsx`, `styles.css` |
| Willkommensseite | `<img className="brand-mark" src={mark} alt="" />` statt SVG (`App.tsx:870`), 36 px | `App.tsx`, `styles.css` |
| Renderer-Import | `import mark from '../../../resources/mark-64.png'` + `declare module '*.png' { const src: string; export default src; }` in `src/renderer/src/assets.d.ts` (tsconfig.web hat keine `vite/client`-Typen). Vite erlaubt Importe aus dem Projektstamm (`fs.allow` = Workspace-Wurzel), Basis `./` funktioniert unter `file://`. | `assets.d.ts` |
| README | `resources/icon.png` | `README.md` |
| Favicon `index.html` | **nicht**: wirkungslos in Electron | – |
| Tray | gibt es nicht (`grep Tray` leer) | – |
| Installer | gibt es nicht (keine electron-builder-Konfiguration). `resources/icon.ico` ist vorbereitet für `build.win.icon`, nicht jetzt. | – |

## 4. Design-System

- `.brand-mark` (`styles.css:47`): heute `28×28`, `color: var(--color-accent)` für das SVG. Neu: `width/height: var(--control-lg)` (36 px), `color` entfällt, `object-fit: contain`. Kein `border-radius`, kein `filter`, kein Schatten: die Ecken sind im Asset, Filter auf Rasterbildern verbietet der Leitsatz „Cyan ist das einzige Signal“ sinngemäß.
- Neu `.brand-icon { width: var(--control-xs); height: var(--control-xs); flex: 0 0 auto; }` (24 px) im 44-px-Kopf; `.header-vault` behält `gap: var(--space-16)`. Unter 1100 px blendet `styles.css:89` nur `.brand-word` aus; das Icon bleibt, unter 700 px verschwindet `.header-vault` ganz (bestehendes Verhalten).
- Lint `design-tokens.test.ts`: nur Token-Werte, keine Literale, keine neuen Farben nötig. Das Dunkelblau der Kachel ist Bildinhalt, kein CSS-Wert.
- `docs/design-system.md`: Titel und Leitsatz (`:1,7`) umbenennen; neuer Abschnitt „Marke“ nach „Roter Faden“: „Das Shellherd-Zeichen (`resources/mark-64.png`) ist das einzige Rasterbild der Oberfläche: 24 px im App-Kopf (`.brand-icon`), 36 px auf der Willkommensseite (`.brand-mark`). Keine CSS-Radien, Filter oder Schatten darauf; die runden Ecken stecken im Asset. Erzeugung: `npm run icons` aus `resources/brand/shellherd-master.png`.“

## 5. Version

`package.json` steht auf 0.9.0 (CHANGELOG-Abschnitt vom 2026-10-18, bereits mit Designsystem-Punkten). Rebranding ist sichtbar und ändert Pfade: **neue Minor 0.10.0** (`npm run version:minor`, Datum 2026-10-19). `version.test.ts:9-13` und `scripts/check-version.mjs` erzwingen den passenden CHANGELOG-Abschnitt. Vorschlag:

```
## [0.10.0] – 2026-10-19

- Terminus heißt jetzt Shellherd: neues Programmsymbol in Fenster, Taskleiste, Kopfzeile und Willkommensseite, neuer Name in allen Texten. Vault-Dateien (`.term`, ältere `.terminus`) und ihr Format bleiben unverändert.
- Einstellungen ziehen beim ersten Start automatisch um: bekannte SSH-Hostschlüssel und die zuletzt geöffnete Vault-Datei werden aus dem alten Terminus-Ordner übernommen; der alte Ordner bleibt bestehen.
- Dateiverknüpfung: „Mit Shellherd öffnen“ ersetzt beim nächsten Verknüpfen den alten Eintrag; `.term` zeigt im Explorer das Shellherd-Symbol.
- Der RDP-Helfer heißt `Shellherd.RdpHost.exe`; die Entwickler-Schalter heißen `SHELLHERD_RDP_DEBUG`, `SHELLHERD_RDP_MODE` und `SHELLHERD_RDP_SMARTSIZE`.
```

Die Release-Notes zeigen beim ersten Start nur 0.10.0 (`notesSince(…, null)` → aktuelle Version, `version.test.ts:26`), weil `shellherd.seenVersion` im neuen Profil leer ist. Gewollt.

## 6. Regeln und Risiken: was ausdrücklich nicht getan wird

1. Keine Änderung an `terminus-vault`, `terminus-encrypted-vault`, AAD-String, `.term`/`.terminus`. Kein Format-Alias.
2. Kein Löschen, Verschieben oder Umbenennen von `%APPDATA%\Terminus`. Nur Kopie fehlender Dateien.
3. Keine Registry-Schreibzugriffe beim Start; nur über den Knopf auf der Willkommensseite (wie bisher).
4. Keine neuen Pakete (`sharp`, `png-to-ico`, electron-builder). Keine SDK-Installationen (Memory des Nutzers).
5. Keine Umschreibung historischer Specs, Pläne, CHANGELOG-Einträge, `UI_UX_PLAN.md`, `RDP_IMPLEMENTIERUNGSPLAN.md`.
6. sudo-Marker bleiben `[terminus-…]` (Folge-Task).
7. Das ZIP und die kleinen gelieferten PNGs werden nicht versioniert; einzige Quelle ist `resources/brand/shellherd-master.png`.
8. Bisherige Sicherheitsregeln gelten weiter: `requireMain`-Guards unverändert, keine neuen IPC-Kanäle, `sandbox: true`, keine DevTools.
9. Nichts Veränderndes gegen den echten Cluster; der fieldManager-Wechsel wird nur im Unit-Test geprüft.

Risiko-Notizen für den Prüfer:
- `nativeImage.createFromBitmap` erwartet dasselbe BGRA-Layout wie `toBitmap` (verifiziert, Electron 44.4.2).
- Vite-Import aus `resources/` außerhalb des Renderer-Roots: erlaubt durch `server.fs.allow` (Workspace-Wurzel); falls ein künftiger Vite-Umbau das einschränkt, Datei nach `src/renderer/src/assets/` kopieren. Entscheidung jetzt: eine Quelle in `resources/`.
- Die ICO-Einträge sind PNG-komprimiert; sollte ein altes Tool BMP-Einträge verlangen, betrifft das nur Fremdsoftware, nicht Windows 10/11.

## 7. Zerlegung in Tasks (disjunkte Dateien)

### Welle 1 (parallel, keine Abhängigkeiten)

**T0 Icons und Skript** (★★★, kleine Main-Änderung nur in `package.json`-Skript – siehe T1 für `package.json`; T0 liefert den Skripteintrag als Text an T1)
Dateien: `scripts/icons/make-icons.mjs`, `scripts/icons/ico.mjs`, `scripts/icons/ico.test.mjs`, `resources/brand/shellherd-master.png` (Kopie von `shellherd-app-icon.png`), `resources/icon.ico`, `resources/icon.png`, `resources/mark-64.png`, `.gitignore` (`resources/*.zip`).
Pflicht: Maske wie 3.2, Größen 16/24/32/48/64/256, Tests nach 3.2. Skript einmal ausführen (`./node_modules/.bin/electron scripts/icons/make-icons.mjs`), Artefakte einchecken.

**T2 Dateizuordnung** (★★★, kleine Main-Änderung)
Dateien: `src/main/file-association.ts`, `src/main/file-association.test.ts`, `src/renderer/src/components/WelcomePage.tsx`.
Pflicht: `PROG_ID = 'Shellherd.Vault'`, `LEGACY_PROG_ID`, Konstruktor `(execPath, appPath, iconPath)`, `register()` löscht Legacy, `unregister()` räumt beide; neue Testfälle; Texte „Mit Shellherd öffnen“, „Shellherd ist mit .term-Dateien verknüpft.“. Signatur `registryEntries(command, icon)` bleibt.

**T3 Renderer-Texte und Marke** (★★★, nur Renderer; Laufzeit braucht T0, Typecheck nicht)
Dateien: `src/renderer/index.html`, `src/renderer/src/App.tsx`, `src/renderer/src/styles.css`, `src/renderer/src/assets.d.ts`, `src/renderer/src/components/{ReleaseNotes.tsx, AiSettingsDialog.tsx, AssistantPanel.tsx, FilePane.tsx, VaultTree.tsx, SplitTerminalArea.tsx}`, `src/renderer/src/hooks/useAssistantToggle.ts`, `src/renderer/src/release-notes.ts`, `src/renderer/src/assistant-chat.ts`, `src/renderer/src/kube-menus.ts`, `src/renderer/src/kube-menus.test.ts`.
Pflicht: Abschnitt 1.4, 1.5 (Renderer), 3.3 (Kopf, Willkommen), 4 (CSS); `design-tokens.test.ts` bleibt grün.

**T4 Main- und Shared-Texte** (★★, kleine Main-Änderung)
Dateien: `src/main/vault/ipc.ts`, `src/main/ssh/session.ts`, `src/main/ssh/session.test.ts` (nur Z. 450-451), `src/main/ai/assistant.ts`, `src/main/kubernetes/client-api.ts`, `src/main/kubernetes/client-api.test.ts`, `src/main/files/remote-edit.ts`, `src/shared/ipc.ts`, `src/shared/ai-cli.ts`, `src/shared/vault/migrations.ts`, `src/shared/vault/migrations.test.ts`.
Pflicht: Dialogtitel/Filtername, `[Shellherd] sudo …`, Prompt, fieldManager `shellherd`, Temp-Präfix, Fehlermeldung „neueren Shellherd-Version“. Endungen und Formatstrings unangetastet (ausdrücklich prüfen).

**T5 RDP-Helfer** (★★, kleine Main-Änderung)
Dateien: `native/Terminus.RdpHost/**` → `native/Shellherd.RdpHost/**` (git mv), `scripts/build-rdp-host.mjs`, `scripts/rdp-try.mjs`, `src/main/rdp/host.ts`, `src/main/rdp/ipc.ts`.
Pflicht: Namespace, Manifest, Fenstertext, Exe-Name, Env-Variablen `SHELLHERD_RDP_*`. Nachweis: `npm run build:rdp-host` erzeugt `out/rdp-host/Shellherd.RdpHost.exe` (csc aus .NET Framework 4.8, vorhanden).

### Welle 2 (nach Welle 1)

**T1 Identität und Start** (★★★, kleine Main-Änderung; braucht T0 für den Icon-Pfad, T2 für die Konstruktor-Signatur)
Dateien: `package.json`, `package-lock.json`, `src/main/index.ts`, `src/main/brand.ts` (neu), `src/main/user-data.ts` (neu), `src/main/user-data.test.ts` (neu), `src/main/windows.ts`, `src/main/drag-ghost.ts`.
Pflicht: `name`/`productName`/`description`/`homepage`/`repository`/`icons`-Skript, Version 0.10.0 (`npm run version:minor`), Lock-Namen; Fenstertitel, Dialog, `icon`, AUMID, `migrateUserData` vor `createKnownHosts`, `FileAssociation(…, brandIconPath())`; Migrationstest (kopiert, überschreibt nicht, Quelle fehlt).

**T6 Dokumentation** (★★, nur Doku; gleiche Welle wie T1, weil `version.test.ts` erst mit beiden grün ist)
Dateien: `README.md`, `CHANGELOG.md`, `docs/design-system.md`.
Pflicht: Abschnitt 1.7, 4 (Absatz „Marke“), 5 (Abschnitt 0.10.0 wortgleich oder enger).

Nach Welle 2: `npm run typecheck`, `npx vitest run`, `npm run build:rdp-host`. Danach Prüfer-Review.

## 8. Tests und manuelle Abnahme

Automatisch:
- neu: `src/main/user-data.test.ts`, `scripts/icons/ico.test.mjs`
- angepasst: `file-association.test.ts`, `kube-menus.test.ts:451,726`, `migrations.test.ts:37`, `session.test.ts:450-451`, `client-api.test.ts:370`
- unverändert, aber betroffen: `version.test.ts` (0.10.0 + CHANGELOG), `design-tokens.test.ts` (neue CSS-Regeln), `storage.test.ts`/`migration-backup.test.ts` (müssen weiter grün sein → Beleg, dass Formate unverändert sind)

Manuell (Windows, Dev-Start):
1. `npm run dev`: Titelleiste „Shellherd“, Fenster- und Taskleisten-Icon zeigen den Hund; Sekundärfenster „Shellherd – Sitzungen“.
2. Willkommensseite: 36-px-Zeichen plus „Shellherd“, Fußzeile „Shellherd 0.10.0“; nach dem Öffnen Kopfzeile mit 24-px-Zeichen und „Shellherd“ vor dem Vault-Namen; unter 1100 px Fensterbreite bleibt das Zeichen, der Text verschwindet.
3. Vor dem Start `%APPDATA%\Terminus\known-hosts.json` sichern; nach dem Start existiert `%APPDATA%\Shellherd\known-hosts.json` inhaltsgleich, der alte Ordner ist unverändert; bekannte Hosts fragen nicht erneut; der zuletzt geöffnete Vault ist vorausgewählt.
4. Release-Notes 0.10.0 erscheinen einmal.
5. Willkommensseite → verknüpfen: `reg query HKCU\Software\Classes\.term` zeigt `Shellherd.Vault`, `…\Terminus.Vault` existiert nicht mehr, Explorer zeigt das Hund-Icon und „Mit Shellherd öffnen“; Doppelklick auf eine `.term`- und eine alte `.terminus`-Datei öffnet sie in der laufenden Instanz. Danach Verknüpfung entfernen: beide ProgIDs weg.
6. Schließen mit offener Sitzung: Dialog „Shellherd schließen“.
7. RDP: Verbindung zu `rdp-test` aufbauen (Memory: Testserver), Helfer `Shellherd.RdpHost.exe` läuft; `SHELLHERD_RDP_DEBUG=1` loggt.
8. Vault speichern/öffnen: Dialogtitel „Shellherd-Vault speichern/auswählen“, Filter „Shellherd Vault (*.term, *.terminus)“.
9. Kubernetes nur lesend: Hinweistext „Objekte vom Typ … zeigt Shellherd nicht an.“ im Kontextmenü eines Events; keine schreibende Aktion.

## 9. Minimale erste Stufe gegenüber Extras

Erste Stufe (alles oben, T0–T6): Name, Icons, Pfadmigration, Dateizuordnung, Version, Doku. Wert ★★★, Aufwand klein bis mittel, alles in zwei Wellen.

Extras, bewusst nicht jetzt:
- sudo-/list-/ready-Marker auf `shellherd-` (14 Dateien, ★).
- Vereinfachtes Glyph für 16/24 px (nur `>_` auf Kachel) als zweite Quelle im Skript (★★, braucht Gestaltung).
- Installer/electron-builder mit `appId: com.pelmenipower.shellherd`, `win.icon: resources/icon.ico`, `extraResources` (★★, eigenes Feature; `brandIconPath()` ist dafür schon auf `process.resourcesPath` vorbereitet).
- Umbenennung der Test-Temp-Präfixe und historischer Pläne (★, nie).
- Lokale `.claude/`-Dateien und Memory des Nutzers: außerhalb des Repos, vom Orchestrator nach Belieben.
