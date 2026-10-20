# SFTP Auto-Upload – Design

Auftrag: „Kann man beim SFTP sowas wie Auto-Upload einstellen, also zwei Ordner synchronisieren?“, danach Brainstorming mit dem Nutzer und Nachreichung „Ausschlüsse beim Einrichten, mehrere Muster, Haupt- und Unterordner“. Grundlage ist das Konzept `.superpowers/sdd/sftp-auto-upload-research.md`, das hier ab „1. Bestand und Lücken“ vollständig als Spec übernommen ist. Plan: `docs/superpowers/plans/2026-10-20-sftp-auto-upload.md`.

## Nutzer-Entscheidungen (bindend)

- **N1** Einweg lokal → Server. Kein Download, keine Zweiweg-Synchronisation.
- **N2** Die Bindung wird pro Verbindung im Vault gemerkt und startet beim Öffnen der Dateiansicht automatisch.
- **N3** Beim Start werden Größe und Änderungszeit abgeglichen. Fehlende und lokal neuere Dateien gehen einmal hoch, danach werden nur Änderungen hochgeladen.
- **N4** Ist die Datei auf dem Server neuer, wird sie übersprungen. Der Nutzer bekommt einen Hinweis mit „Trotzdem überschreiben“.
- **N5** Lokales Löschen wird ignoriert. Auf dem Server wird nie gelöscht.
- **N6** Ausschlüsse sind pro Bindung eine Liste von Glob-Mustern wie bei `.gitignore`. Sie werden beim Einrichten festgelegt und sind später änderbar. Ausgeschlossene Ordner werden nicht durchlaufen. Vorbelegung: `.git`, `node_modules/`, `~$*`, `*.swp`, `*.tmp`, `.DS_Store`.

## Spec-Rulings (Stufe 3)

- **S1** Die Rulings 1–6 aus Abschnitt 7 des Konzepts gelten.
- **S2** Der Umfang ist Stufe 1 aus Abschnitt 5. Alles unter „Bewusst weggelassen“ entfällt.
- **S3** Version `0.13.0` über `npm run version:minor`. Handbuch de/en und CHANGELOG de/en gehören in denselben Task.
- **S4** Abnahme: `npm run typecheck` und `npx vitest run` grün, `run-app` mit den Screens `sftp-auto-upload-dialog` und `sftp-auto-upload`, und jedes PNG wird angesehen.

## 1. Bestand und Lücken

| Baustein | Was da ist | Datei:Zeile | Lücke für Auto-Upload |
|---|---|---|---|
| Watch + Settle + Konflikt | `RemoteEdits`: `watchFile` je Datei (Polling 1 s), Settle 500 ms, Konflikt über `remoteModified` (±1 s), `upload(id, force)`, `uploading/pending`-Serialisierung | `src/main/files/remote-edit.ts:14,61-69,78-99` | Nur eine Datei je Watch, Polling (für ganze Ordner ungeeignet). Das Muster Settle/Serialisierung/Force wird übernommen, der Code nicht. |
| Upload-Pfad | `planTransfer` (Ordner vor Inhalt, Links zu Ordnern übersprungen, `unsafeLocalName`, MAX_PLANNED 100 000), `runTransfer` (mkdir für Ordner, `.part`-Swap, Konflikt-Hook je vorhandener Datei, `newer`-Regel „≤ +1 s ist nicht neuer“, `setModified` erhält mtime) | `src/main/files/transfer.ts:24-58,61-106,86-87,96` | Kein Filter-Hook im Walk (Ausschlüsse müssen den Abstieg verhindern). `copyFile` ist privat. |
| Session-Manager | `Session` mit `fs`, `edits`, `jobs`, `ownerId`; `connect` erzeugt `RemoteEdits` sobald SFTP bereit; `finish` räumt Jobs, Konflikt, Edits auf; `transferOwner` wechselt nur die `ownerId`; `state()` liefert Jobs/Edits/Konflikt für ein adoptierendes Fenster | `src/main/files/sftp-session.ts:45-57,96-100,264-268,271-275,291-301` | Kein Reconnect im Main: Der Renderer öffnet bei „Neu verbinden“ eine neue Session (`FilesPanel.tsx:213,178-182`). Genau darauf setzt Auto-Start auf. |
| Datei-IPC | `handle()` mit `requireSshSender`, Vault muss offen sein, Zod `strict()`, `remotePath` (absolut, kein NUL), `localPath` (`win32.isAbsolute`) | `src/main/files/ipc.ts:18-20,60-67` | Drei neue Kanäle (`sftp:sync-start/-stop/-force`), gleiche Helfer. |
| Events/Typen | `SftpEvent` als Union (`status`, `edit`, `transfer`, `conflict`), `SftpSessionState` | `src/shared/sftp.ts:69-74,91` | Neuer Event-Typ `sync`; `FilesPanel.tsx:145` behandelt heute „alles andere“ als Transfer – der Zweig muss explizit werden. |
| Lokales Pane | Kontextmenü mit `menuFolder`, `ContextMenuEntry` kennt `disabled`/`hint` | `src/renderer/src/components/FilePane.tsx:187-188,267-286`, `ContextMenu.tsx:5-8` | Neuer Eintrag für Ordner (oder aktuellen Ordner) der lokalen Seite. |
| Panel-Listen | `EditList` (Zeile mit Status, Knöpfen „Trotzdem hochladen“/„Erneut hochladen“), CSS `.transfer-queue`, `.transfer-job`, `.is-edit-*` | `FilesPanel.tsx:305-326`, `files-ui.css:69-104` | Dritte Liste gleicher Bauart für Bindungen. |
| Meldungen | `notify.error/info/ok` global, Aktion mit `label/run` | `src/renderer/src/notice-store.ts:62-66` | Nichts – wird direkt genutzt. |
| Vault | `SshConnectionNode`/`SftpConnectionNode`, nicht-strikte `z.object` (unbekannte Felder werden gestrichen), optionale Zusätze wie `containers` ohne Versionssprung, `CURRENT_VAULT_VERSION = 2`, `updateNode`, `persistVault` optimistisch mit Rollback und Retry-Toast | `src/shared/vault/types.ts:36-53`, `schema.ts:52-65`, `migrations.ts:6`, `mutations.ts:127-143`, `hooks/usePersistVault.ts:18-50` | Feld `autoUpload`. **Risiko:** `src/renderer/src/connection-form.ts:117` baut SSH/SFTP-Knoten aus den Formularfeldern neu auf; `containers` wird explizit mitgenommen, ein neues Feld ginge beim Speichern des Formulars verloren. |
| Fenster | Nebenfenster bekommen `catalog()` mit `redactSecrets(vault.nodes)` (also auch `autoUpload`), dürfen aber keinen Vault schreiben; `onVaultChange → broadcastCatalog` | `src/main/window-ipc.ts:80-83,224-228`, `index.ts:264-265`, `SecondaryWindow.tsx:23` | Bindung anlegen/ändern nur im Hauptfenster; laufende Bindungen folgen dem Tab (Session bleibt im Main). |
| Globs | Kein Matcher im Repo (kein `minimatch`/`picomatch` in `package.json`, keine Treffer in `src`). `path.matchesGlob` existiert in Node 24, aber: `.foo.tmp` passt nicht zu `**/*.tmp`, `a/.hidden/x.log` nicht zu `**/*.log` (Dotfiles ausgenommen, Stability 1) | gemessen | Eigener Mini-Matcher mit gitignore-Semantik (Abschnitt 3.2). |
| fs.watch | `fs.watch(dir, { recursive: true })` liefert unter Windows `rename`/`change` mit relativem Pfad in Backslashes, auch für Unterordner (gemessen: `sub\x.txt`) | Node 24 / ReadDirectoryChangesW | Pfad muss gegen Ausbruch geprüft werden (Abschnitt 3.5). |
| Tests | Loopback-SFTP-Server mit Upload, Konflikt, Edit (Settle, Konflikt, Force), Download/Rename/Delete; `editPollInterval` injizierbar | `src/main/files/sftp-loopback.test.ts:17-62,122-140` | Ein weiteres `it` für die Bindung Ende-zu-Ende. |
| run-app | Block `sftp` setzt die lokale Spalte auf `RUN_DIR/local` (feste, nutzerfreie Pfade) | `.claude/skills/run-app/screens.mjs:51-78` | Zwei Screenshots: Dialog und Statuszeile. |

## 2. Empfehlung je Fläche

| Fläche | Empfehlung | Wert | Aufwand |
|---|---|---|---|
| Main: `AutoUploads` neben `RemoteEdits` in der Session | ★★★ | kleine Main-Änderung |
| Vault: `autoUpload?: AutoUploadBinding[]` an SSH- und SFTP-Knoten, kein Versionssprung | ★★★ | Shared + Renderer |
| Ausschlüsse: eigener Glob-Matcher in `src/shared`, gitignore-Regeln | ★★★ | Shared, ~40 Zeilen + Tests |
| Erkennung: ein rekursiver `fs.watch` je Bindung, Settle 500 ms, Batch, Vollabgleich bei Sturm | ★★★ | Main |
| Konflikt: mtime-Regel plus „zuletzt von uns geschriebener Remote-mtime“ je Datei, Force für alle übersprungenen | ★★★ | Main |
| UI: Menüeintrag, Einrichten/Bearbeiten-Dialog, Statusliste im Panel, Toasts | ★★★ | nur Renderer |
| Ordner-Picker (nativer Dialog) für den lokalen Ordner | ★ | nicht jetzt – der Eintrag kommt aus dem Kontextmenü eines Ordners, der Pfad ist vorbelegt |
| Bindung im Verbindungsformular bearbeiten | ★ | nicht jetzt – Bearbeiten lebt im Panel; das Formular trägt das Feld nur durch |
| Reconnect im Main (Session überlebt Abbruch) | ★★ | nicht jetzt – „Neu verbinden“ öffnet eine Session, Auto-Start holt nach |
| Lösch-Spiegelung, Umbenennen-Erkennung, Zweiweg | – | ausdrücklich nie (Nutzerentscheidung) |

## 3. Entwurf

### 3.1 Vault-Modell

`src/shared/vault/types.ts`, nach `Authentication`:

```ts
/** A local folder mirrored into a server folder while its file browser is open; one way, never deletes. */
export interface AutoUploadBinding {
  id: string;
  /** Windows path on the computer that created the binding; may not exist elsewhere. */
  localPath: string;
  /** Absolute POSIX path on the server. */
  remotePath: string;
  /** gitignore-style patterns, see src/shared/exclude-glob.ts. */
  excludes: string[];
  /** Off: kept but not started with the session. */
  enabled: boolean;
}
```

`SshConnectionNode` und `SftpConnectionNode` bekommen `autoUpload?: AutoUploadBinding[]` – SSH ebenfalls, weil ein SSH-Knoten als Dateibrowser dieselbe Session öffnet (`terminal-tabs.ts:20`, `sftp-session.ts:66`).

`schema.ts`: ein Fragment `autoUpload: z.array(AutoUploadBindingSchema).max(16).optional()` in beiden Objekten (wie `remoteTarget`). `AutoUploadBindingSchema = z.object({ id: min(1), localPath: min(1).max(32_767).refine(/^([A-Za-z]:\\|\\\\)/).refine(kein NUL/CR/LF), remotePath: min(1).max(4096).refine(startsWith('/')).refine(kein NUL/CR/LF), excludes: z.array(z.string().min(1).max(256).refine(kein Steuerzeichen)).max(200), enabled: z.boolean() }).strict()`. `src/shared` darf kein `node:path` importieren (Renderer-Bundle), daher Regex. Kein Versionssprung: optionales Feld wie `containers`/`workflows`; `CURRENT_VAULT_VERSION` bleibt 2, keine Migration, kein Konsistenz-Check (keine Querverweise). Ältere Shellherd-Versionen streichen das Feld beim nächsten Speichern still – gleiches Verhalten wie bei jedem bisherigen optionalen Feld.

Schreibweg: nur über `persistVault` im Hauptfenster (`App.tsx:171`). `App.tsx` bekommt `saveAutoUpload = (connectionId, bindings) => persistVault({ ...vault, nodes: updateNode(vault.nodes, connectionId, node => ({ ...node, autoUpload: bindings })) }, t('files:sync.notSaved'))` und reicht es als neue optionale Prop `onSaveAutoUpload` durch `SplitTerminalArea` (`SplitTerminalArea.tsx:47-49`, neben `onSnapshot`) an `FilesPanel`. `SplitTerminalArea` sucht die aktuelle Liste selbst: `findConnection(nodes, tab.connection.id)?.autoUpload ?? []` (die `nodes`-Prop existiert, `App.tsx:838`, `SecondaryWindow.tsx:104`) und gibt sie als `bindings` weiter. Im Nebenfenster ist `onSaveAutoUpload` undefined → Anlegen/Bearbeiten/Anhalten/Entfernen deaktiviert mit Hinweis „Nur im Hauptfenster“; „Trotzdem überschreiben“ ist sessiongebunden und funktioniert überall.

**Pflicht:** `src/renderer/src/connection-form.ts:117` nimmt `autoUpload` mit wie `containers`: `...(connection?.autoUpload ? { autoUpload: connection.autoUpload } : {})` für `ssh` und `sftp`. Test in `connection-form.test.ts`: Formular-Roundtrip erhält die Liste.

Maschinenspezifische Pfade: Nichts im Vault markieren. Beim Start prüft Main den Ordner; fehlt er, meldet die Bindung `state: 'error'` mit `files.syncLocalMissing` („Der lokale Ordner wurde auf diesem Computer nicht gefunden.“). Die Zeile im Panel zeigt den Fehler mit „Bearbeiten …“ und „Entfernen“; ein Fehler-Toast je Sessionstart. Nicht automatisch deaktivieren – auf dem ursprünglichen Rechner soll sie weiter laufen.

### 3.2 Ausschlüsse: `src/shared/exclude-glob.ts`

Entscheidung: **eigener Matcher, nicht `path.matchesGlob`.** Gemessen in Electrons Node 24.21: `matchesGlob('.foo.tmp', '**/*.tmp') === false`, `matchesGlob('a/.hidden/x.log', '**/*.log') === false`, `matchesGlob('a/.x', '**/*') === false` – gitignore-Semantik verlangt, dass `*` Dotfiles trifft (`~$*`, `*.tmp` auf `.foo.tmp`). Dazu Stability 1. Keine neue Abhängigkeit; ein Glob→RegExp-Umsetzer mit gitignore-Regeln sind rund 40 Zeilen:

```ts
export interface ExcludeMatcher { (relativePosixPath: string, isDirectory: boolean): boolean }
/** gitignore rules: no leading slash → any level; leading or inner slash → from the binding root; trailing slash → folders only. */
export function compileExcludes(patterns: string[]): ExcludeMatcher
export function excludePatternError(pattern: string): 'negation' | 'control' | null   // für den Dialog
```

Regeln (Tests sind die Spezifikation):
- Leerzeilen und `#…` werden ignoriert; Leerraum am Rand entfällt.
- `!…` wird abgelehnt (Negation nicht in Stufe 1; der Dialog meldet „Ausnahmen mit ! werden nicht unterstützt.“). Main ignoriert eine solche Zeile stumm, falls sie aus einem fremden Vault kommt.
- Abschließendes `/` → nur Ordner (`dirOnly`). Führendes `/` oder ein `/` im Inneren → am Root verankert (`^`), sonst `(^|/)`; Ende immer `$`.
- Übersetzung: `**/` → `(?:.*/)?`, `/**` am Ende → `(?:/.*)?`, `**` sonst → `.*`, `*` → `[^/]*`, `?` → `[^/]`, `[…]` wird durchgereicht (unbalanciertes `[` wird wörtlich escaped), alles andere `RegExp`-escaped. Flag `i`, weil Windows-Dateinamen ohne Groß/Klein unterscheiden (so dokumentieren).
- `isExcluded(rel, isDir)`: Für jedes Präfix `seg[0..i]` (i = 1..n) prüfen, ob ein Muster passt; `dirOnly`-Muster zählen nur, wenn das Präfix ein Ordner ist (`i < n` oder `isDir`). Damit schließt ein getroffener Ordner alles darunter aus, ohne dass Muster `**` tragen müssen.

Randfälle, die `src/shared/exclude-glob.test.ts` abdeckt: `.git` trifft `.git` und `a/.git` und `a/.git/HEAD`; `node_modules/` trifft den Ordner `node_modules` (und `x/node_modules/y`), aber nicht eine Datei namens `node_modules`; `*.log` trifft `a.log`, `x/a.log`, `.hidden.log`; `/build/` trifft nur `build` am Root, nicht `src/build`; `secrets/**/*.pem` trifft `secrets/a.pem` und `secrets/x/y/a.pem`, nicht `a/secrets/a.pem`; `~$*` trifft `~$Report.docx`; `*.tmp` trifft `.foo.tmp`; `[ab].txt` trifft `a.txt`, nicht `c.txt`; `a b/c d.txt` mit Leerzeichen; `(x)+.txt` bleibt wörtlich; `!x` und Steuerzeichen werden gemeldet; Groß/Klein (`A.LOG` ↔ `*.log`); Pfad mit Backslashes wird vom Aufrufer vorher normalisiert (der Matcher nimmt nur POSIX).

Vorbelegung: Konstante `DEFAULT_EXCLUDES = ['.git', 'node_modules/', '~$*', '*.swp', '*.tmp', '.DS_Store']` in derselben Datei.

### 3.3 Erkennung und Batching: `src/main/files/auto-upload.ts`

`class AutoUploads` (Muster `RemoteEdits`): `constructor(remote: RemoteFileSystem, deps: { local: FileSystem; emit: (status: AutoUploadStatus, closed?: boolean) => void; settleMs?: number })`, Methoden `start(binding)`, `stop(id)`, `force(id)`, `list()`, `closeAll()`.

Je Bindung: `watcher = fs.watch(localRoot, { recursive: true, persistent: false })`, `pending: Set<string>` (relative Windows-Pfade), `timer` (Settle 500 ms, Reset bei jedem Ereignis, wie `remote-edit.ts:14,66`), `running: boolean`, `again: boolean`, `controller: AbortController`, `known: Map<string, number>` (Remote-mtime nach unserem letzten Upload), `status: AutoUploadStatus`.

Ereignis (`eventType, filename`): `filename === null` → `fullResync = true`. Sonst Pfad prüfen (3.5), relative POSIX-Form bilden, gegen den Matcher mit `isDirectory` unbekannt → doppelt prüfen (`isExcluded(rel, false) || isExcluded(rel, true)`): ausgeschlossen → verwerfen, sonst in `pending`. Ein rekursiver Watcher kann einzelne Unterbäume nicht vom Kernel ausnehmen; Ereignisse aus `node_modules` kommen also an und werden in Mikrosekunden verworfen (100 000 Matches ≈ 90 ms gemessen). „Nicht überwacht“ heißt in Stufe 1: nicht durchlaufen, nicht hochgeladen, nicht gestatet. Pro-Ordner-Watcher wären auf Windows schlechter (Handle je Ordner, Lücken bei neuen Ordnern).

Flush (nach Settle): wenn `running` → `again = true`, Ende. Sonst `pending` übernehmen, Vorfahren-Dedupe (Eintrag entfällt, wenn ein Vorfahre im Set ist), bei `fullResync` oder mehr als 500 Einträgen stattdessen Vollabgleich des Roots. Je Eintrag `lstat` lokal: fehlt → ignorieren (Löschen wird nie gespiegelt), Link → ignorieren, sonst `planTransfer(local, remote, [abs], posix.dirname(remoteAbs), signal, skip)` und `runTransfer(job, items, local, remote, hooks, signal)` – sequenziell (eine SFTP-Session, `runTransfer` ist ohnehin seriell; mehr Parallelität bringt über einen Kanal nichts). Vor dem Lauf `ensureRemoteDir(remoteParent)`: Segmentweise `stat`, bei `null` `mkdir`, nur unterhalb von `remoteRoot`. Fehler je Eintrag werden gefangen (`fileError`), landen als `status.error`, der Lauf geht weiter; nach dem Lauf `again` → sofort erneut.

Vollabgleich beim Start und nach Sturm: `list(localRoot)` → Kinder filtern (Matcher, Links raus) → `planTransfer(local, remote, children, remoteRoot, signal, skip)` → `runTransfer`. Hook `skip` in `planTransfer` ist die einzige Änderung an `transfer.ts`: Signatur `planTransfer(from, to, sources, targetDir, signal, skip?: (source: string, entry: FileEntry) => boolean)`, in `walk` (`transfer.ts:33-43`) `if (unsafeLocalName(entry.name) || skip?.(source, entry)) { skipped += 1; continue; }` vor dem Abstieg, und für die Top-Level-Quellen (`:47-56`) ebenso. `skip` der Bindung: `entry.type === 'link' || isExcluded(toPosixRelative(source), entry.type === 'directory')`. Der bestehende Aufruf `sftp-session.ts:216` bleibt unverändert.

Statusmeldungen laufen durch dasselbe 200-ms-Throttle-Muster wie `emitJob` (`sftp-session.ts:22,199-204`): `synced` zählt hoch, `last = { name, at }` bei jedem fertigen Upload, Übergänge `syncing ↔ watching` sofort.

Watcher-Fehler (`watcher.on('error')`, z. B. Laufwerk weg) → Watcher schließen, `state: 'error'` mit `fileError(error)`; kein Neustart. Vollabgleich-Fehler (z. B. `files.tooManyPlanned`) → ebenfalls `error`, Watcher bleibt zu.

### 3.4 Abgleich und Konflikt „Server neuer“

Keine Vergleichslogik außerhalb des bestehenden Konflikt-Hooks. `runTransfer` ruft `hooks.conflict` für jede bereits vorhandene Zieldatei mit `source {size, modified}` und `target {size, modified}` (`transfer.ts:75-83`); die Bindung antwortet programmatisch, nie mit UI:

1. `known.get(rel)` vorhanden und `|target.modified − known| > 1000` → Server wurde seit unserem Upload von jemand anderem geändert → `skip`, `rel` in `status.skipped` (max. 100 Einträge, Rest zählt in `skippedMore`).
2. sonst `target.modified > source.modified + 1000` → Server neuer → `skip` + Eintrag in `skipped`.
3. sonst `|Δ| ≤ 1000 && target.size === source.size` → unverändert → `skip` stumm (das ist der „Größe+mtime“-Abgleich; da `runTransfer` nach jedem Upload `setModified` setzt, `transfer.ts:96`, sind unsere eigenen Uploads beim nächsten Start gleich alt).
4. sonst `overwrite`.

Nach jedem Upload `known.set(rel, item.modified)` (das ist der Wert, den `setModified` auf dem Server hinterlässt; Server runden auf Sekunden, deshalb ±1 s wie `remote-edit.ts:86`). Regel 1 ist das Sicherheitsnetz, das die reine mtime-Regel nicht hat: Wer lokal nach einer fremden Serveränderung speichert, ist lokal „neuer“ und würde sonst überschreiben.

`force(id)`: die Einträge aus `skipped` erneut planen und mit Hook `() => 'overwrite'` laufen lassen, Liste leeren. Granularität in Stufe 1: alle übersprungenen auf einmal; die Namen stehen in der Statuszeile (`title`) und im Toast-Text.

Hinweis an den Nutzer (Renderer, auf Übergang `skipped.length` 0 → n): `notify.info(t('files:sync.skippedTitle', { count }), { body: t('files:sync.skippedBody', { names }), action: { label: t('files:sync.force'), run: () => sftpSyncForce } })`. Dazu dauerhaft in der Zeile: „{{count}} übersprungen, auf dem Server neuer“ mit Knopf „Trotzdem überschreiben“.

### 3.5 Sicherheit an der Vertrauensgrenze

- IPC-Schemas (`ipc.ts`): `SyncSchema = z.object({ ...session, bindingId: z.string().uuid() }).strict()` für alle drei Kanäle. Der Renderer schickt **nur die Bindungs-ID**; Main liest die Bindung aus dem Vault-Snapshot (`getConnection(session.connectionId).autoUpload`, `ipc.ts:71-75`). Pfade reisen also nie als freie Parameter, sondern sind bereits durch `VaultSchema.parse` beim Speichern (`src/main/vault/session.ts:69-78`) gelaufen.
- Start-Prüfung lokal (Main): `lstat(localPath)` muss Ordner und kein Symlink/Junction sein (`isSymbolicLink()` → `files.syncLocalLink`), `win32.resolve(localPath) === localPath` nach Normalisierung, Pfad absolut mit Laufwerk oder UNC. Fehlt → `files.syncLocalMissing`.
- Start-Prüfung remote: `remote.realpath(remotePath)` muss gelingen und `stat` einen Ordner liefern (`files.syncRemoteMissing`); der aufgelöste Pfad wird als `remoteRoot` verwendet; `remoteRoot !== '/'` ist erlaubt, aber `/` als Ziel wird abgelehnt (`files.syncRemoteRoot`), damit ein Tippfehler nicht das Dateisystem flutet.
- Watch-Ereignis: `abs = win32.resolve(localRoot, filename)`; `rel = win32.relative(localRoot, abs)`; verwerfen, wenn `rel === ''`, `rel.startsWith('..')`, `win32.isAbsolute(rel)` oder `filename` NUL enthält. Jedes Segment muss `!unsafeLocalName` sein (`file-system.ts:50-52`; auf dem Server wäre ein Name mit `/` unmöglich, er kann aus Windows gar nicht kommen, die Prüfung kostet nichts). Remote-Ziel `posix.join(remoteRoot, rel.split('\\').join('/'))` muss mit `remoteRoot + '/'` beginnen, sonst verwerfen.
- Überlappung: beim Start werden Bindungen derselben Session abgelehnt, deren `localPath` gleich, Vorfahre oder Nachfahre einer laufenden ist (`files.syncOverlap`); der Dialog prüft dasselbe vorher (Feldfehler).
- Kein Löschen auf dem Server, nie: `AutoUploads` ruft `removeFile`/`removeDirectory` nur über `runTransfer` mit `move: false` (dort nur bei `move`, `transfer.ts:97,101-103`) – ein Test stellt sicher, dass die Fake-Remote nie `removeFile` sieht.
- Symlinks: Root darf keiner sein, Einträge vom Typ `link` werden übersprungen (lokal wie in `planTransfer`), keine `realpath`-Auflösung lokaler Links.
- Grenzen: max. 16 Bindungen je Verbindung (Schema), `MAX_PLANNED` 100 000 (bestehend), 500 Einträge je Batch → Vollabgleich, `skipped` max. 100.

### 3.6 Lebenszyklus

- Start: in `connect` (`sftp-session.ts:96-100`) nach `session.edits` auch `session.syncs = new AutoUploads(session.fs, { local, emit: … })`, danach `for (const binding of connection.autoUpload ?? []) if (binding.enabled) void session.syncs.start(binding)`. `connection` ist der Vault-Knoten vom Öffnen (`sftp-session.ts:65`), `protocol` ssh oder sftp.
- Fensterwechsel: `transferOwner` (`:271-275`) ändert nur `ownerId`; `state()` (`:264-268`) liefert zusätzlich `syncs: session.syncs?.list() ?? []`, `FilesPanel.tsx:167-173` übernimmt sie wie `edits`. Nichts weiter.
- Verbindungsabbruch/Schließen/App-Ende: `finish` (`:291-301`) ruft `session.syncs?.closeAll()` (Watcher schließen, Controller abbrechen, `emit(status, true)`). Für den Nutzer ist die Bindung dann „pausiert“ – im Panel abgeleitet aus `status !== 'connected'`, kein eigener Zustand. „Neu verbinden“ (`FilesPanel.tsx:213`) öffnet eine neue Session → Auto-Start → Vollabgleich holt alles nach. `closeOwner`/`closeAll`/`will-quit` (`index.ts:47-52,282-285`) laufen alle über `finish`.
- Mehrere Bindungen: unabhängige Watcher/Queues in einer Session; `MAX_SFTP_SESSIONS` bleibt unberührt, da keine neue Session entsteht.
- Vault-Änderung während laufender Session: Renderer persistiert, dann `syncStop` + `syncStart` (Bearbeiten) bzw. `syncStop` (Anhalten/Entfernen) bzw. `syncStart` (Fortsetzen/Neu). Main liest beim `syncStart` den frischen Snapshot.
- Vault sperren/wechseln: `onSessionChange → closeAllSessions` (`index.ts:263`) → `finish`. Fertig.

### 3.7 Shared-Typen, IPC, Events

`src/shared/sftp.ts`:

```ts
export type AutoUploadState = 'syncing' | 'watching' | 'error';
export interface AutoUploadStatus {
  bindingId: string; localPath: string; remotePath: string; state: AutoUploadState;
  /** Files uploaded since the session started. */
  synced: number;
  /** Relative paths skipped because the server copy is newer; `skippedMore` counts beyond the first 100. */
  skipped: string[]; skippedMore: number;
  last?: { name: string; at: number };
  error?: CodedError;
}
export type SftpEvent = … | { type: 'sync'; sessionId: string; sync: AutoUploadStatus; closed?: boolean };
export interface SftpSessionState { …; syncs: AutoUploadStatus[] }
export interface SftpSyncRequest extends SftpSessionRequest { bindingId: string }
```

`src/shared/ipc.ts`: `sftpSyncStart: 'sftp:sync-start'`, `sftpSyncStop: 'sftp:sync-stop'`, `sftpSyncForce: 'sftp:sync-force'` plus `DesktopApi`-Signaturen; `src/preload/index.ts` drei Zeilen. Manager: `syncStart(ownerId, id, bindingId)` (Bindung aus `getConnection`, nicht gefunden → `files.syncNotFound`), `syncStop`, `syncForce`.

Neue Fehlercodes in `src/shared/locales/*/errors/files.json`: `syncLocalMissing`, `syncLocalLink`, `syncRemoteMissing`, `syncRemoteRoot`, `syncOverlap`, `syncNotFound`.

### 3.8 UI

**Kontextmenü (lokale Seite, `FilePane.tsx:267-286`):** nach „Pfad kopieren“ ein Separator und `{ kind: 'item', label: t('files:pane.autoUpload'), disabled: !onAutoUpload, hint: !onAutoUpload ? t('files:sync.mainWindowOnly') : undefined, onSelect: () => onAutoUpload(menuFolder ? joinPath(side, path, menuFolder.name) : path) }` – nur für `side === 'local'`. Neue optionale Prop `onAutoUpload?: (localDir: string) => void`. `FilesPanel` setzt sie nur, wenn `remoteReady && onSaveAutoUpload`; Ziel-Vorbelegung ist `paths.current.remote`.

**Dialog `src/renderer/src/components/AutoUploadDialog.tsx`** (Muster `PermissionsDialog.tsx:27-75`: `<dialog className="confirm-dialog conflict-dialog file-sync-dialog">`, `useNativeSurfaceBlock(true)`, `showModal()` im Effekt, `onCancel` nur wenn nicht busy, `BusyButton`). Dient zum Einrichten und Bearbeiten; Props `{ binding: AutoUploadBinding; others: AutoUploadBinding[]; isNew: boolean; busy: boolean; onCancel; onSave(binding) }`. Felder: „Lokaler Ordner“ (Text, vorbelegt), „Server-Ordner“ (Text, vorbelegt mit dem aktuellen Server-Ordner), „Ausschlüsse (eine Zeile je Muster)“ als `<textarea>` mit den Vorgaben, darunter ein gedämpfter Hilfesatz „Ohne / gilt ein Muster auf jeder Ebene, mit führendem / nur ab dem gebundenen Ordner, mit abschließendem / nur für Ordner.“ Feldfehler nach Meldungsmuster „Feld“ (`.field-error`, `aria-invalid`): Pfad nicht absolut, Server-Pfad nicht absolut oder `/`, Muster mit `!` oder Steuerzeichen, Überlappung mit einer anderen Bindung dieser Verbindung. Die reine Prüf-Funktion `autoUploadErrors(binding, others)` liegt in `src/renderer/src/auto-upload-form.ts` (testbar ohne DOM). Knöpfe: „Abbrechen“, primär „Auto-Upload starten“ (neu) bzw. „Übernehmen“ (bearbeiten). Dialog ist per Maus erreichbar, animiert wie `.confirm-dialog` (kein neuer Gate-Eintrag nötig, er übernimmt die bestehende Regel; Zeile in der Tabelle „Übrige Dialoge“ um den Namen ergänzen).

**Statusliste `src/renderer/src/components/AutoUploadList.tsx`** (Bauart `EditList`, Klassen `transfer-queue file-sync-list`, Zeilen `transfer-job is-sync-<state>`): Datenbasis ist die Vault-Liste `bindings`, je Zeile der Laufzeitstatus aus `syncs` per `bindingId`. Zeile: Richtungszeichen `⇡` (`aria-hidden`), `<strong>{basename(localPath)}</strong>`, `<span class="transfer-target" title>` `{localPath} → {remotePath}`, `<small role="status">`:
- `enabled === false` → „Angehalten“
- Session nicht verbunden → „Pausiert, Verbindung getrennt“
- `syncing` → „Gleicht ab … {{count}} hochgeladen“
- `watching` → „Überwacht“ + „ · zuletzt {{name}} um {{time}}“ (`formatDateTime(at, 'time')` wie `FilesPanel.tsx:315`)
- `error` → „Fehler · {{errorText}}“
- zusätzlich bei `skipped.length` → „ · {{count}} übersprungen, auf dem Server neuer“

Knöpfe (`.secondary-button`, 28 px wie `.transfer-job button`): „Trotzdem überschreiben“ (nur bei `skipped`), „Bearbeiten …“, „Anhalten“/„Fortsetzen“, „Entfernen“ (Entfernen ohne Rückfrage: es löscht nichts auf dem Server, nur die Merkung). Im Nebenfenster die drei Vault-Knöpfe `disabled` mit `title="Nur im Hauptfenster"`. Die Liste erscheint nur, wenn `bindings.length > 0`.

CSS in `files-ui.css` (Präfix `.file-sync-`): `.file-sync-list { max-height: 26%; }`, `.file-sync-list .transfer-job.is-sync-watching small { color: var(--color-ok); }`, `.is-sync-error small { color: var(--color-danger); }`, `.file-sync-dialog textarea { min-height: calc(var(--control-lg) * 3); font-family: var(--font-mono); font-size: var(--fs-sm); }`, `.file-sync-dialog label { display: grid; gap: var(--space-4); }`. Keine Bewegung, keine neuen Tokens.

**Toasts (Renderer, in `FilesPanel`):** Fehler-Toast beim Übergang einer Bindung nach `error` (Titel „Auto-Upload „{{name}}“ gestoppt“, Body `errorText(error)`), Info-Toast bei neu übersprungenen Dateien mit Aktion (3.4). Kein Toast für erfolgreiche Uploads (zu häufig; die Zeile zeigt „zuletzt …“).

### 3.9 i18n (de-DE / en-US)

`files.json` (Namespace `files:`), alle neu:
- `pane.autoUpload`: „Auto-Upload einrichten …“ / “Set up auto-upload…”
- `sync.title`: „Auto-Upload“ / “Auto-upload”
- `sync.hint`: „Änderungen im lokalen Ordner werden automatisch hochgeladen. Auf dem Server wird nie gelöscht.“ / “Changes in the local folder are uploaded automatically. Nothing is ever deleted on the server.”
- `sync.target`: „{{local}} → {{remote}}“ (beide Sprachen gleich)
- `sync.state.disabled` „Angehalten“ / “Paused”; `sync.state.offline` „Pausiert, Verbindung getrennt“ / “Paused, connection lost”; `sync.state.syncing` „Gleicht ab … {{count}} hochgeladen“ / “Syncing… {{count}} uploaded”; `sync.state.watching` „Überwacht“ / “Watching”; `sync.state.error` „Fehler“ / “Error”; `sync.last` „zuletzt {{name}} um {{time}}“ / “last {{name}} at {{time}}”
- `sync.skipped_one/_other`: „{{count}} übersprungen, auf dem Server neuer“ / “{{count}} skipped, newer on the server”
- `sync.force`: „Trotzdem überschreiben“ / “Overwrite anyway”; `sync.forceTitle`: „Die Serverfassungen werden durch deine lokalen Dateien ersetzt“ / “The server copies are replaced by your local files”
- `sync.edit` „Bearbeiten …“ / “Edit…”; `sync.pause` „Anhalten“ / “Pause”; `sync.resume` „Fortsetzen“ / “Resume”; `sync.remove` „Entfernen“ / “Remove”; `sync.removeTitle` „Nur die Merkung wird entfernt, keine Dateien“ / “Only the binding is removed, no files”
- `sync.mainWindowOnly`: „Nur im Hauptfenster“ / “Main window only”
- `sync.skippedTitle_one/_other`: „Auto-Upload: {{count}} Datei übersprungen“ / “Auto-upload: {{count}} file skipped”; `sync.skippedBody`: „Auf dem Server neuer: {{names}}“ / “Newer on the server: {{names}}”
- `sync.failedTitle`: „Auto-Upload „{{name}}“ gestoppt“ / “Auto-upload “{{name}}” stopped”; `sync.notSaved`: „Auto-Upload nicht gespeichert“ / “Auto-upload not saved”
- Dialog: `sync.dialog.titleNew` „Auto-Upload einrichten“ / “Set up auto-upload”; `sync.dialog.titleEdit` „Auto-Upload bearbeiten“ / “Edit auto-upload”; `sync.dialog.local` „Lokaler Ordner“ / “Local folder”; `sync.dialog.remote` „Server-Ordner“ / “Server folder”; `sync.dialog.excludes` „Ausschlüsse (eine Zeile je Muster)“ / “Excludes (one pattern per line)”; `sync.dialog.excludesHint` (Satz aus 3.8); `sync.dialog.start` „Auto-Upload starten“ / “Start auto-upload”; `sync.dialog.apply` „Übernehmen“ / “Apply”
- Feldfehler: `sync.errors.localAbsolute` „Gib einen vollständigen Windows-Pfad an, z. B. C:\Projekte\app.“ / “Enter a full Windows path, e.g. C:\Projects\app.”; `sync.errors.remoteAbsolute` „Gib einen absoluten Server-Pfad an, der mit / beginnt.“ / “Enter an absolute server path starting with /.”; `sync.errors.remoteRoot` „Das Wurzelverzeichnis / ist als Ziel nicht erlaubt.“ / “The root folder / is not allowed as target.”; `sync.errors.negation` „Ausnahmen mit ! werden nicht unterstützt.“ / “Exceptions with ! are not supported.”; `sync.errors.patternChars` „Das Muster enthält ungültige Zeichen.“ / “The pattern contains invalid characters.”; `sync.errors.overlap` „Dieser Ordner überschneidet sich mit der Bindung „{{name}}“.“ / “This folder overlaps with the binding “{{name}}”.”

`errors/files.json`: `files.syncLocalMissing` „Der lokale Ordner wurde auf diesem Computer nicht gefunden.“ / “The local folder was not found on this computer.”; `files.syncLocalLink` „Der lokale Ordner ist eine Verknüpfung; Verknüpfungen werden nicht überwacht.“ / “The local folder is a link; links are not watched.”; `files.syncRemoteMissing` „Der Server-Ordner wurde nicht gefunden.“ / “The server folder was not found.”; `files.syncRemoteRoot` „Das Wurzelverzeichnis ist als Ziel nicht erlaubt.“ / “The root folder is not allowed as target.”; `files.syncOverlap` „Der Ordner überschneidet sich mit einer laufenden Bindung.“ / “The folder overlaps with a running binding.”; `files.syncNotFound` „Die Bindung wurde nicht gefunden.“ / “The binding was not found.”

Katalog-Regeln (`i18n-catalog.test.ts`): keine drei Punkte (Ellipse „…“), kein „Bitte“, Anführungszeichen „“ in de und “” in en, keine verwaisten Keys, keine Umlaute im Code.

### 3.10 Tests

- `src/shared/exclude-glob.test.ts`: die Randfälle aus 3.2 (Tabelle Muster × Pfad × isDir → erwartet), Ablehnung `!`/Steuerzeichen, `DEFAULT_EXCLUDES` trifft `.git/config`, `x/node_modules/y/z.js`, `~$a.docx`, `.foo.tmp`, nicht `src/app.ts`.
- `src/shared/vault/schema.test.ts`: alter Vault ohne `autoUpload` bleibt gültig; Liste mit relativer `localPath` wird abgelehnt; `strict` lehnt Zusatzfelder ab.
- `src/renderer/src/connection-form.test.ts`: Roundtrip einer SSH- und einer SFTP-Verbindung erhält `autoUpload`.
- `src/renderer/src/auto-upload-form.test.ts`: `autoUploadErrors` für jeden Feldfehler und Überlappung (gleich, Vorfahre, Nachfahre, Groß/Klein).
- `src/main/files/transfer.test.ts`: `skip` verhindert Abstieg (Fake-`from.list` wird für den ausgeschlossenen Ordner nie aufgerufen) und zählt in `skipped`.
- `src/main/files/auto-upload.test.ts` (Fake-`RemoteFileSystem` als In-Memory-Map, echter Temp-Ordner, `settleMs: 50`): Startabgleich lädt fehlende und neuere hoch, überspringt gleiche stumm, meldet Server-neuere in `skipped`; `force` überschreibt; Änderung nach Settle hochgeladen; Löschen lokal → kein `removeFile` auf der Fake; Link übersprungen; `known`-Regel: Serverdatei nach unserem Upload fremd geändert → übersprungen trotz lokal neuer; Ereignis `..\\x` und absoluter Pfad verworfen (Methode `handleEvent(eventType, filename)` ist für den Test `public`); fehlender Root → `error` mit `files.syncLocalMissing`; `closeAll` schließt den Watcher (kein Upload nach Schreiben).
- `src/main/files/sftp-loopback.test.ts` (nur win32, wie bisher): ein `it('mirrors a bound folder and skips newer server files until forced')` – `getConnection` liefert den Knoten mit `autoUpload` (enabled), nach Session-Start `waitFor` `sync.state === 'watching'`, Datei schreiben → auf dem Server; Server-Datei mit `utimesSync` in die Zukunft, lokal schreiben → `skipped` enthält sie, Inhalt unverändert; `syncForce` → überschrieben; `node_modules/x` lokal anlegen → nie auf dem Server; `manager.close` → Event `closed`.
- `src/main/files/sftp-session.test.ts`: `state()` enthält `syncs`, `syncStart` mit unbekannter ID → `files.syncNotFound`, Nebenfenster-Ownership wie gehabt.
- `design-tokens.test.ts`, `i18n-catalog.test.ts`, `version.test.ts` laufen mit.

### 3.11 run-app

`screens.mjs`, Block `sftp` ergänzen (nach dem bestehenden Shot): Rechtsklick auf `.file-pane-local .file-list`, Menüeintrag „Auto-Upload einrichten …“, `waitFor('dialog.file-sync-dialog[open]')`, Shot `sftp-auto-upload-dialog`; Primärknopf, `waitFor` `.file-sync-list .transfer-job` mit Text „Überwacht“, Shot `sftp-auto-upload`. Die Bindung landet im Demo-Vault mit `RUN_DIR/local` – der Pfad ist zwischen Läufen stabil und nutzerfrei (`screens.mjs:51-58`); der Block ist idempotent: existiert die Zeile schon, nur Shots. `demo-setup.mjs` bleibt unverändert (Bindungen entstehen über die UI). SKILL.md: beide Screens in die Liste. Der SSH-Testserver (`sshd.mjs`) schreibt in `seedSftp`-Root; danach `seedSftp` beim nächsten Lauf räumt die hochgeladenen Dateien weg (`fixtures.mjs:68-76`).

### 3.12 Doku, Changelog, Version

`docs/handbuch.md`: Abschnitt „Auto-Upload“ im Dateibrowser-Kapitel (Einrichten, Regeln: nur lokal→Server, nie löschen, Server neuer wird übersprungen, Ausschlüsse mit Beispielen, Pfade sind rechnerspezifisch, Nebenfenster). `docs/manual.md` englisch entsprechend. `CHANGELOG.md`/`CHANGELOG.en.md` plus `npm run version:minor` (→ 0.13.0) im selben Task, sonst bricht `version.test.ts`. `docs/design-system.md`: Dialogname in der Zeile „Übrige Dialoge“ ergänzen.

## 4. Regeln und Risiken – was ausdrücklich nicht getan wird

- **Nie löschen auf dem Server, nie umbenennen.** Lokales Löschen und Umbenennen erzeugen nur neue Uploads; alte Serverdateien bleiben. Test erzwingt, dass die Remote nie `removeFile`/`rename` außerhalb des `.part`-Swaps sieht.
- **Keine Zweiweg-Synchronisation, kein Download.** Server-Änderungen werden erkannt (übersprungen), nie geholt.
- **Keine Abstraktion auf Vorrat:** kein generischer „Sync-Engine“-Layer, keine Plug-in-Matcher, kein eigener Job-Typ in der Transfer-Queue. `AutoUploads` ist eine Klasse mit einer Map, wie `RemoteEdits`.
- **Keine neue Abhängigkeit** (kein chokidar, kein picomatch). `path.matchesGlob` wird wegen der Dotfile-Lücke nicht verwendet.
- **Kein Reconnect im Main.** „Neu verbinden“ im Panel reicht; die Bindung startet mit der Session.
- **Kein nativer Ordner-Picker, keine Bearbeitung im Verbindungsformular**; das Formular trägt das Feld nur durch (Pflichtfix `connection-form.ts:117`).
- **Keine Negationsmuster (`!`)** und kein Brace-Expansion in Stufe 1; der Dialog lehnt `!` ab.
- **Keine Bewegung** in Statuszeile oder Liste; der Dialog erbt die bestehende `.confirm-dialog`-Regel.
- Risiken: (1) Startabgleich statet jede Zieldatei einzeln über SFTP (`transfer.ts:69`) – bei 10 000 Dateien dauert der erste Abgleich spürbar; Stufe 1 nimmt das hin, die Zeile zeigt „Gleicht ab …“. (2) Ein großer Sturm (`npm install` im nicht ausgeschlossenen Ordner) löst Vollabgleiche aus; das ist korrekt, nur langsam; die Vorgabe schließt `node_modules/` aus. (3) `fs.watch` ohne `filename` (selten) → Vollabgleich, nie Datenverlust. (4) mtime-Gleichheit mit ±1 s: Dateien, die binnen einer Sekunde zweimal mit gleicher Größe geändert werden, könnten beim Startabgleich als „gleich“ gelten – im Watch-Betrieb wird jede Änderung hochgeladen (Regel 4 greift, da die Dateigröße oder mtime abweicht); Restrisiko dokumentieren. (5) Case-insensitive Matcher: ein Muster `Build/` schließt auch `build` aus; auf Windows erwartbar, in der Doku nennen.

## 5. Stufe 1 (dieser PR) gegenüber Extras

**Stufe 1, vollständig und minimal:** Vault-Feld + Schema + Formular-Durchreichung; Matcher mit gitignore-Regeln; `AutoUploads` mit Startabgleich, Watch, Settle, Batch, Konflikt-Hook, `force`; `skip`-Hook in `planTransfer`; Session-Integration (Start, `state`, `finish`); drei IPC-Kanäle; Kontextmenü-Eintrag; Dialog (Anlegen/Bearbeiten, Ausschlussliste); Statusliste mit Anhalten/Fortsetzen/Bearbeiten/Entfernen/Trotzdem überschreiben; Toasts; i18n de/en; Tests inkl. Loopback; run-app-Screens; Handbuch, Changelog, Version.

**Bewusst weggelassen (Stufe 2, erst bei Bedarf):** Negation `!` in Ausschlüssen; „Trotzdem überschreiben“ je einzelner Datei; Ordner-Picker; Reconnect im Main; Fortschrittsbalken für den Startabgleich (Zähler reicht); Verzeichnislisten-Vergleich statt Einzel-`stat`; Rechnername an der Bindung; Bindung aus dem Verbindungsformular.

## 6. Zerlegung in parallele Tasks

| Task | Dateien (exklusiv) | Inhalt | Hängt ab von |
|---|---|---|---|
| **A** Shared-Typen und Vault | `src/shared/sftp.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/shared/vault/types.ts`, `src/shared/vault/schema.ts`, `src/shared/vault/schema.test.ts`, `src/renderer/src/connection-form.ts`, `src/renderer/src/connection-form.test.ts` | Typen aus 3.1/3.7, Schema-Fragment, Kanäle, Durchreichung im Formular | – |
| **B** Matcher | `src/shared/exclude-glob.ts`, `src/shared/exclude-glob.test.ts` | 3.2 inkl. `DEFAULT_EXCLUDES`, `excludePatternError` | – |
| **C** i18n | `src/shared/locales/de-DE/files.json`, `en-US/files.json`, `de-DE/errors/files.json`, `en-US/errors/files.json` | alle Keys aus 3.9 | – |
| **D** Transfer-Hook | `src/main/files/transfer.ts`, `src/main/files/transfer.test.ts` | `skip`-Parameter in `planTransfer` | – |
| **E** AutoUploads | `src/main/files/auto-upload.ts`, `src/main/files/auto-upload.test.ts` | 3.3–3.6 Klasse mit Fake-Tests | A, B, D |
| **F** Session + IPC | `src/main/files/sftp-session.ts`, `src/main/files/ipc.ts`, `src/main/files/sftp-session.test.ts`, `src/main/files/sftp-loopback.test.ts` | Integration, drei Handler, `state`, `finish`, Loopback-`it` | A, E |
| **G** Dialog + Prüfung | `src/renderer/src/components/AutoUploadDialog.tsx`, `src/renderer/src/auto-upload-form.ts`, `src/renderer/src/auto-upload-form.test.ts` | 3.8 Dialog, Feldfehler, Überlappung | A, B, C |
| **H** Liste + CSS | `src/renderer/src/components/AutoUploadList.tsx`, `src/renderer/src/files-ui.css` | 3.8 Statusliste, Präfix `.file-sync-` | A, C |
| **I** Panel-Verdrahtung | `src/renderer/src/components/FilesPanel.tsx`, `src/renderer/src/components/FilePane.tsx`, `src/renderer/src/components/SplitTerminalArea.tsx`, `src/renderer/src/App.tsx` | Menüeintrag, Dialog-/Listen-Einbindung, `sync`-Event-Zweig, Toasts, `onSaveAutoUpload`, `bindings` aus `nodes` | A, C, G, H |
| **J** Doku, Changelog, Version, Design-Doku | `docs/handbuch.md`, `docs/manual.md`, `CHANGELOG.md`, `CHANGELOG.en.md`, `package.json`/`package-lock.json` (über `npm run version:minor`), `docs/design-system.md` | 3.12 | – (Texte stehen hier) |
| **K** run-app | `.claude/skills/run-app/screens.mjs`, `.claude/skills/run-app/SKILL.md` | 3.11 | I (läuft erst nach Welle 3, Anpassung kann vorher geschrieben werden) |

**Wellen:** Welle 1: A, B, C, D, J parallel. Welle 2: E, G, H, K parallel. Welle 3: F, I parallel (F nur Main, I nur Renderer). Nach jeder Welle `npm run typecheck` und `npx vitest run`; nach Welle 3 `run-app` mit den beiden neuen Screens.

## 7. Rulings-Vorschläge für die Spec

1. Bindungen hängen an SSH- **und** SFTP-Knoten (ein SSH-Knoten als Dateibrowser ist dieselbe Session). Kein Vault-Versionssprung.
2. Eigener Glob-Matcher mit gitignore-Semantik statt `path.matchesGlob` (Dotfile-Lücke gemessen), case-insensitiv, ohne Negation.
3. Konflikt = Server-mtime neuer als lokal **oder** Server-mtime abweichend vom Wert nach unserem letzten Upload; „Trotzdem überschreiben“ wirkt auf alle übersprungenen.
4. Einrichten/Bearbeiten/Anhalten/Entfernen nur im Hauptfenster; laufende Bindungen folgen dem Tab in Nebenfenster.
5. Verbindungsabbruch beendet die Bindung mit der Session; „Neu verbinden“ startet sie mit Vollabgleich neu – kein Main-Reconnect.
6. Ziel `/` ist verboten; Bindungen derselben Verbindung dürfen sich nicht überlappen.
