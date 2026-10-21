# SFTP Auto-Upload – Validierung (Stufe 3)

Prüfer-Anhang zu `docs/superpowers/specs/2026-10-20-sftp-auto-upload-design.md` und `docs/superpowers/plans/2026-10-20-sftp-auto-upload.md`. **Dieser Anhang ist bindend und geht Spec und Plan vor.** Die Nutzer-Entscheidungen N1–N6 bleiben unverändert.

**Urteil: ready after corrections.** 6 Blocker, 27 Korrekturen, 9 offene Risiken.

Grundlage: Code auf `claude/feature/sftp-auto-upload` (Stand `03cbd2a`), Baseline `npm run typecheck` grün, `npx vitest run` 121 Dateien / 1675 Tests grün. Zeilenangaben der Spec stichprobenartig geprüft: `transfer.ts:24-58,86-87,96`, `remote-edit.ts:14,61-69,78-99`, `sftp-session.ts:96-100,216,264-275,291-301`, `ipc.ts:18-20,60-75`, `sftp.ts:69-74,91`, `FilesPanel.tsx:145,167-173,213,305-326`, `FilePane.tsx:187-188,267-286`, `ContextMenu.tsx:5-8`, `schema.ts:52-65`, `App.tsx:171,838`, `SplitTerminalArea.tsx:49` stimmen. **Falsch** sind die Aussage zu `connection-form.ts:117` (B3) und `findConnection` im Renderer (K20).

Messungen (Electron 44.4.2, `ELECTRON_RUN_AS_NODE`, Node 24.21.0, Windows 11):
- `fs.watch(dir, { recursive: true })` ist vorhanden und meldet Unterordner mit relativem Backslash-Pfad (`sub\x.txt`, `new\deep\y.txt`). Ordner bekommen zusätzlich `change` für jede Änderung darin (`change "sub"` nach dem Schreiben von `sub\x.txt`).
- Wird der überwachte Ordner gelöscht, kommt **kein** `error`-Ereignis. Stattdessen läuft ein Endlossturm von `rename`-Ereignissen mit **absolutem** Dateinamen `\\?\C:\…\<root>` (47 000 Ereignisse in 1,1 s, bis zum Ende des Prozesses).
- `fs.watch` auf einen fehlenden Pfad wirft synchron `EPERM` (nicht `ENOENT`).
- Schreibt man in das Ziel einer Junction im überwachten Ordner, kommt kein Ereignis.
- Solange der Watcher läuft, scheitert das Umbenennen eines **Elternordners** mit `EPERM`.

---

## 1. Vertrag

Die Umsetzer halten diese Signaturen wörtlich ein. Namen, Felder und Reihenfolgen sind bindend.

### 1.1 `src/shared/vault/types.ts` (Task A)

```ts
/** A local folder mirrored into a server folder while its file view is open; one way, never deletes. */
export interface AutoUploadBinding {
  /** crypto.randomUUID(); unique within the connection. */
  id: string;
  /** Windows path on the computer that created the binding; may not exist elsewhere. */
  localPath: string;
  /** Absolute POSIX path on the server, never `/`. */
  remotePath: string;
  /** gitignore-style patterns, see src/shared/exclude-glob.ts. */
  excludes: string[];
  /** Off: kept, but not started with the session. */
  enabled: boolean;
}
```

`SshConnectionNode` und `SftpConnectionNode` bekommen jeweils `autoUpload?: AutoUploadBinding[];` (als letztes Feld, mit Kommentar `/** Auto-upload bindings; see docs/superpowers/specs/2026-10-20-sftp-auto-upload-design.md. */`).

### 1.2 `src/shared/vault/schema.ts` (Task A)

```ts
/** Drive path (`C:\…`) or UNC share (`\\server\share…`); device paths (`\\?\`, `\\.\`) are refused. */
export const AUTO_UPLOAD_LOCAL_PATH = /^(?:[A-Za-z]:\\|\\\\(?![?.]\\))/;
const noLineBreak = (value: string) => !/[\0\r\n]/.test(value);

export const AutoUploadBindingSchema = z.object({
  id: z.string().uuid(),
  localPath: z.string().min(1).max(32_767).regex(AUTO_UPLOAD_LOCAL_PATH).refine(noLineBreak),
  remotePath: z.string().min(2).max(4096).refine(path => path.startsWith('/')).refine(noLineBreak),
  excludes: z.array(z.string().min(1).max(256).refine(pattern => !/[\x00-\x1f\x7f]/.test(pattern))).max(200),
  enabled: z.boolean(),
});   // bewusst NICHT .strict(), siehe K2

const autoUpload = z.array(AutoUploadBindingSchema).max(16)
  .refine(list => new Set(list.map(binding => binding.id)).size === list.length).optional();
```

`autoUpload` kommt in `SshConnectionNodeSchema` und `SftpConnectionNodeSchema`. `CURRENT_VAULT_VERSION` bleibt 2. Es gibt keine Migration.

### 1.3 `src/shared/sftp.ts` (Task A)

```ts
export type AutoUploadState = 'syncing' | 'watching' | 'error';
export interface AutoUploadStatus {
  bindingId: string;
  /** As stored in the binding (display only). */
  localPath: string;
  remotePath: string;
  /** `syncing` only during a full comparison (start, storm, overflow); single uploads keep `watching`. */
  state: AutoUploadState;
  /** Files uploaded since the binding started. */
  synced: number;
  /** Relative POSIX paths skipped because the server copy is newer or was changed by someone else; max 100. */
  skipped: string[];
  /** Skipped beyond the first 100. */
  skippedMore: number;
  /** Relative POSIX paths whose upload failed; max 100; removed again after a later successful upload. */
  failed: string[];
  last?: { name: string; at: number };
  /** With state 'error': why the binding stopped. Otherwise: cause of the latest entry in `failed`. */
  error?: CodedError;
}
export interface SftpSyncRequest extends SftpSessionRequest { bindingId: string }
```

- `SftpEvent` bekommt am Ende `| { type: 'sync'; sessionId: string; sync: AutoUploadStatus; closed?: boolean }`.
- `SftpSessionState` bekommt `syncs?: AutoUploadStatus[]`. Das Feld ist **optional** (B1).

### 1.4 `src/shared/ipc.ts`, `src/preload/index.ts` (Task A)

```ts
// IPC_CHANNELS, nach sftpEditClose
sftpSyncStart: 'sftp:sync-start',
sftpSyncStop: 'sftp:sync-stop',
sftpSyncForce: 'sftp:sync-force',
// DesktopApi
sftpSyncStart: (request: SftpSyncRequest) => Promise<void>;
sftpSyncStop: (request: SftpSyncRequest) => Promise<void>;
sftpSyncForce: (request: SftpSyncRequest) => Promise<void>;
```

Preload: `sftpSyncStart: request => ipcRenderer.invoke('sftp:sync-start', request),` und entsprechend für die beiden anderen.

### 1.5 `src/renderer/src/connection-form.ts` (Task A)

```ts
/** Bindings are edited in the file view, never in the form: saving the form keeps the stored list. */
export function keepAutoUpload(updated: ConnectionNode, existing: VaultNode | undefined): ConnectionNode
```

Die Funktion gibt `updated` unverändert zurück, außer wenn `updated.protocol` `ssh` oder `sftp` ist und `existing` eine Verbindung desselben Protokolls mit nicht-leerem `autoUpload` ist. Dann gibt sie `{ ...updated, autoUpload: existing.autoUpload }` zurück.

### 1.6 `src/shared/exclude-glob.ts` (Task B)

```ts
export type ExcludeMatcher = (relativePosixPath: string, isDirectory: boolean) => boolean;
export const DEFAULT_EXCLUDES: readonly string[] = ['.git', 'node_modules/', '~$*', '*.swp', '*.tmp', '.DS_Store'];
/** gitignore rules: no slash → any level; leading or inner slash → from the binding root; trailing slash → folders only. Case-insensitive; `\` counts as `/`. Invalid lines are ignored. */
export function compileExcludes(patterns: readonly string[]): ExcludeMatcher;
/** For the dialog; `pattern` is one line. */
export function excludePatternError(pattern: string): 'negation' | 'control' | null;
```

Keine Imports aus `node:*`. Die Datei landet im Renderer-Bundle.

### 1.7 `src/main/files/transfer.ts` (Task D)

```ts
export async function planTransfer(from: FileSystem, to: FileSystem, sources: string[], targetDir: string, signal: AbortSignal,
  skip?: (source: string, entry: FileEntry) => boolean): Promise<{ items: PlannedItem[]; skipped: number }>
```

`FileEntry` wird als Typ aus `../../shared/sftp` importiert. `runTransfer`, `TransferHooks` und `copyFile` bleiben **unverändert**.

### 1.8 `src/main/files/auto-upload.ts` (Task E)

```ts
export interface AutoUploadDependencies {
  local: FileSystem;
  emit: (status: AutoUploadStatus, closed?: boolean) => void;
  /** True when another file view already runs this binding (same id). */
  inUseElsewhere?: (bindingId: string) => boolean;
  /** Quiet time before a batch is uploaded; default 500. */
  settleMs?: number;
  /** Upper bound from the first pending event to the batch; default 2000. */
  maxWaitMs?: number;
}

export class AutoUploads {
  constructor(remote: RemoteFileSystem, deps: AutoUploadDependencies);
  /** Registers and reports the binding synchronously, then checks folders and starts the watcher; the first full comparison runs in the background. Never rejects for binding problems: they end as state 'error'. A running binding with the same id is stopped first. */
  start(binding: AutoUploadBinding): Promise<void>;
  /** Unknown id: no-op. Emits the last status with `closed`. */
  stop(id: string): void;
  /** Re-uploads every skipped entry that is still a regular file, overwriting the server copy. Unknown id: throws FileError('files.syncNotFound'). Runs serialized with the batches. */
  force(id: string): void;
  /** Registered and not in state 'error'. */
  running(id: string): boolean;
  list(): AutoUploadStatus[];
  /** Synchronous: clears timers, closes watchers, aborts uploads, emits `closed` for each. */
  closeAll(): void;
  /** Watcher callback; public for tests. */
  handleEvent(id: string, eventType: string, filename: string | null): void;
}
```

### 1.9 `src/main/files/sftp-session.ts` (Task F)

```ts
interface Session { …; syncs?: AutoUploads }
syncStart(ownerId: number, id: string, bindingId: string): Promise<void>;
syncStop(ownerId: number, id: string, bindingId: string): void;
syncForce(ownerId: number, id: string, bindingId: string): void;
```

`src/main/files/ipc.ts`: `const SyncSchema = z.object({ ...session, bindingId: z.string().uuid() }).strict();` Damit werden drei `handle(...)` registriert.

### 1.10 `src/renderer/src/auto-upload-form.ts` (Task G)

```ts
export type AutoUploadField = 'localPath' | 'remotePath' | 'excludes';
/** Text of the dialog fields; `excludes` is the textarea content. */
export interface AutoUploadDraft { localPath: string; remotePath: string; excludes: string }
export function newAutoUpload(localPath: string, remotePath: string): AutoUploadBinding;   // id crypto.randomUUID(), excludes [...DEFAULT_EXCLUDES], enabled true
export function draftOf(binding: AutoUploadBinding): AutoUploadDraft;                     // excludes.join('\n')
export function bindingFromDraft(base: AutoUploadBinding, draft: AutoUploadDraft): AutoUploadBinding;  // normalizes, keeps id and enabled
export function bindingName(binding: Pick<AutoUploadBinding, 'localPath'>): string;        // last path segment, else the whole path
export function autoUploadErrors(binding: AutoUploadBinding, others: AutoUploadBinding[]): Partial<Record<AutoUploadField, string>>;
```

### 1.11 Komponenten (Tasks G, H, I)

```ts
// AutoUploadDialog.tsx (G)
export interface AutoUploadDialogProps {
  binding: AutoUploadBinding; others: AutoUploadBinding[]; isNew: boolean; busy: boolean;
  onCancel: () => void; onSave: (binding: AutoUploadBinding) => void;
}
// AutoUploadList.tsx (H); returns null when bindings is empty
export interface AutoUploadListProps {
  bindings: AutoUploadBinding[]; syncs: AutoUploadStatus[]; status: SftpStatus;
  /** False in secondary windows: edit, pause/resume and remove are disabled. */
  canEdit: boolean;
  onEdit: (binding: AutoUploadBinding) => void; onToggle: (binding: AutoUploadBinding) => void;
  onRemove: (binding: AutoUploadBinding) => void; onForce: (bindingId: string) => void;
}
// FilePane.tsx (I): new optional props
onAutoUpload?: (localDir: string) => void;
/** Set: the menu entry is disabled and shows this text. */
autoUploadHint?: string;
// FilesPanel.tsx (I): new optional props
bindings?: AutoUploadBinding[];
onSaveAutoUpload?: (bindings: AutoUploadBinding[]) => Promise<boolean>;
// SplitTerminalArea.tsx (I): new optional prop next to onSnapshot
onSaveAutoUpload?: (connectionId: string, bindings: AutoUploadBinding[]) => Promise<boolean>;
```

### 1.12 Texte (Tasks C1, C2): endgültige Liste

Alle Keys liegen im Namespace `files` (`src/shared/locales/{de-DE,en-US}/files.json`) bzw. in `errors/files.json`. Die Spec 3.9 gilt mit diesen Änderungen und Ergänzungen. Die Texte sind wörtlich zu übernehmen.

**C1 (Welle 2): Keys, die E, G und H benutzen**

| Key | de-DE | en-US | benutzt in |
|---|---|---|---|
| `sync.title` | Auto-Upload | Auto-upload | H |
| `sync.hint` | Änderungen im lokalen Ordner werden automatisch hochgeladen. Auf dem Server wird nie gelöscht. | Changes in the local folder are uploaded automatically. Nothing is ever deleted on the server. | H, G |
| `sync.target` | {{local}} → {{remote}} | {{local}} → {{remote}} | H |
| `sync.state.disabled` | Angehalten | Paused | H |
| `sync.state.offline` | Pausiert, Verbindung getrennt | Paused, connection lost | H |
| `sync.state.idle` | Nicht gestartet | Not started | H |
| `sync.state.syncing` | Gleicht ab … {{count}} hochgeladen | Syncing… {{count}} uploaded | H |
| `sync.state.watching` | Überwacht | Watching | H |
| `sync.state.error` | Fehler | Error | H |
| `sync.last` | zuletzt {{name}} um {{time}} | last {{name}} at {{time}} | H |
| `sync.skipped_one` / `_other` | {{count}} übersprungen, auf dem Server neuer | {{count}} skipped, newer on the server | H |
| `sync.failed_one` / `_other` | {{count}} nicht hochgeladen | {{count}} not uploaded | H |
| `sync.force` | Trotzdem überschreiben | Overwrite anyway | H, I |
| `sync.forceTitle` | Die Serverfassungen werden durch deine lokalen Dateien ersetzt | The server copies are replaced by your local files | H |
| `sync.edit` | Bearbeiten … | Edit… | H |
| `sync.pause` | Anhalten | Pause | H |
| `sync.resume` | Fortsetzen | Resume | H |
| `sync.remove` | Entfernen | Remove | H |
| `sync.removeTitle` | Nur die Merkung wird entfernt, keine Dateien | Only the binding is removed, no files | H |
| `sync.mainWindowOnly` | Nur im Hauptfenster | Main window only | H, I |
| `sync.dialog.titleNew` | Auto-Upload einrichten | Set up auto-upload | G |
| `sync.dialog.titleEdit` | Auto-Upload bearbeiten | Edit auto-upload | G |
| `sync.dialog.local` | Lokaler Ordner | Local folder | G |
| `sync.dialog.remote` | Server-Ordner | Server folder | G |
| `sync.dialog.excludes` | Ausschlüsse (eine Zeile je Muster) | Excludes (one pattern per line) | G |
| `sync.dialog.excludesHint` | Ohne / gilt ein Muster auf jeder Ebene, mit führendem / nur ab dem gebundenen Ordner, mit abschließendem / nur für Ordner. \ zählt wie /. | Without / a pattern applies at every level, with a leading / only from the bound folder, with a trailing / only to folders. \ counts as /. | G |
| `sync.dialog.start` | Auto-Upload starten | Start auto-upload | G |
| `sync.dialog.apply` | Übernehmen | Apply | G |
| `sync.errors.localAbsolute` | Gib einen vollständigen Windows-Pfad an, z. B. C:\Projekte\app. | Enter a full Windows path, e.g. C:\Projects\app. | G |
| `sync.errors.remoteAbsolute` | Gib einen absoluten Server-Pfad an, der mit / beginnt. | Enter an absolute server path starting with /. | G |
| `sync.errors.remoteRoot` | Das Wurzelverzeichnis / ist als Ziel nicht erlaubt. | The root folder / is not allowed as target. | G |
| `sync.errors.negation` | Ausnahmen mit ! werden nicht unterstützt. | Exceptions with ! are not supported. | G |
| `sync.errors.patternChars` | Das Muster enthält ungültige Zeichen. | The pattern contains invalid characters. | G |
| `sync.errors.overlap` | Dieser Ordner überschneidet sich mit der Bindung „{{name}}“. | This folder overlaps with the binding “{{name}}”. | G |

In JSON werden Backslashes verdoppelt (`"C:\\Projekte\\app"`, `"\\ zählt wie /."`).

`errors/files.json` (C1, benutzt in E): `syncLocalMissing`, `syncLocalLink`, `syncRemoteMissing`, `syncRemoteRoot`, `syncOverlap`, `syncNotFound` mit den Texten aus Spec 3.9. Neu ist `syncElsewhere`: „Der Auto-Upload läuft bereits in einer anderen Dateiansicht.“ / “The auto-upload is already running in another file view.”

**C2 (Welle 3): Keys, die nur I benutzt**

| Key | de-DE | en-US |
|---|---|---|
| `pane.autoUpload` | Auto-Upload einrichten … | Set up auto-upload… |
| `sync.notConnected` | Nur mit Verbindung zum Server | Only while connected to the server |
| `sync.skippedTitle_one` | Auto-Upload: {{count}} Datei übersprungen | Auto-upload: {{count}} file skipped |
| `sync.skippedTitle_other` | Auto-Upload: {{count}} Dateien übersprungen | Auto-upload: {{count}} files skipped |
| `sync.skippedBody` | Auf dem Server neuer: {{names}} | Newer on the server: {{names}} |
| `sync.failedTitle` | Auto-Upload „{{name}}“ gestoppt | Auto-upload “{{name}}” stopped |
| `sync.notSaved` | Auto-Upload nicht gespeichert | Auto-upload not saved |

---

## 2. Blocker

**B1: Welle 1 bricht den Typecheck.**
- Task A erweitert `SftpEvent` um `sync`. Damit greift `FilesPanel.tsx:145` (der `else`-Zweig nimmt „alles andere“ als Transfer) auf `event.job` einer Union zu, die `sync` enthält. Das ist ein TS-Fehler.
- Ein Pflichtfeld `syncs` in `SftpSessionState` bricht `sftp-session.ts:266`. Die Datei gehört F, und F kommt erst in Welle 3.
- **Fix:** Task A bekommt in Welle 1 zusätzlich `src/renderer/src/components/FilesPanel.tsx`, aber nur die Zeile 145: `else {` → `else if (event.type === 'transfer') {`. `syncs` ist optional (Vertrag 1.3).

**B2: Der Plan nimmt nach Welle 1 rote Tests hin, und die Keys sind typisiert.**
- `i18n-catalog.test.ts (d)` meldet jeden neuen Key, solange kein Quelltext ihn in Anführungszeichen nennt.
- `t()` ist über `CustomTypeOptions` (`src/shared/i18n.d.ts`) typisiert, `ErrorCode` über den Fehlerkatalog (`src/shared/errors.ts:6`). Keys müssen also in derselben Welle entstehen, in der sie benutzt werden. Sonst ist entweder der Typecheck oder der Test rot.
- **Fix:** Task C wird geteilt. C1 läuft in Welle 2 und enthält die Keys für E, G und H. C2 läuft in Welle 3 und enthält die Keys für I (Tabelle 1.12). Nach jeder Welle sind Typecheck und Tests grün. Die Ausnahme im Plan („Gate nach Welle 1 nimmt nur diesen Befund hin“) entfällt.

**B3: Der Pflichtfix in `connection-form.ts` ist so nicht umsetzbar und würde Bindungen trotzdem verlieren.**
- `connectionFromFields(id, fields, protocol)` hat keinen Parameter `connection`.
- `containers` wird nicht „mitgenommen“, sondern kommt aus dem Formularfeld `containerSudo` (`connection-form.ts:117`).
- `App.saveConnection` (`App.tsx:489-497`) ersetzt den Knoten vollständig (`updateNode(..., () => connection)` bzw. `addNode(removeNode(...))` beim Ordnerwechsel).
- Das Formular hält zudem einen Snapshot vom Öffnen. Legt der Nutzer bei offenem Formular in der Dateiansicht eine Bindung an, würde ein Weg „über die Felder“ sie beim Speichern löschen.
- **Fix:** `keepAutoUpload(updated, existing)` in `connection-form.ts` (Vertrag 1.5, Task A). `App.saveConnection` (Task I) ruft vor dem Bau von `nodes` `connection = keepAutoUpload(connection, existing)` mit dem **aktuellen** `existing = findNode(vault.nodes, connection.id)` auf. Weitere Stellen, die Knoten neu bauen, gibt es nicht (geprüft):
  - `redactSecrets` spreizt den Knoten.
  - `migrateNode` spreizt den Knoten.
  - `toggleDisabled`, `renameNode` und `moveNode` spreizen bzw. verschieben das Objekt.
  - Import, Export und Duplizieren existieren nicht.

**B4: Regel 1 und die `skipped`-Liste sind mit dem bestehenden Konflikt-Hook nicht umsetzbar, und ein Fehler bricht den ganzen Abgleich ab.**
- `hooks.conflict` bekommt nur `{ name, source, target }` (`transfer.ts:79-80`). Es fehlt der Pfad, also gibt es kein `known.get(rel)` und keinen relativen Pfad für `skipped`.
- `runTransfer` wirft beim ersten Fehler eines Elements und beendet damit den Lauf (z. B. eine gesperrte Datei beim Startabgleich). Die Spec würde daraus „Vollabgleich-Fehler → error, Watcher bleibt zu“ machen. Eine einzige gesperrte Datei würde die Bindung stilllegen.
- **Fix ohne Änderung an `runTransfer`:** AutoUploads ruft `runTransfer(job, [item], local, remote, hooks, signal)` **je geplantem Element** auf. Der Hook ist eine Closure über `item`, und `rel = item.target.slice(remoteRoot.length + 1)`. Details stehen in K6 und K12.

**B5: Wird der gebundene Ordner gelöscht, entsteht ein CPU-Sturm statt eines Fehlers (gemessen).**
- Es gibt kein `error`-Ereignis, sondern endlos `rename` mit absolutem `\\?\…`-Namen. Die Prüfung aus Spec 3.5 verwirft jedes Ereignis, der Sturm hält an.
- `fs.watch` auf einen fehlenden Pfad wirft synchron `EPERM`.
- **Fix:** K10.

**B6: Dieselbe Bindung kann in zwei Sitzungen gleichzeitig laufen und Serverdateien zerstören.**
- Zwei Dateiansicht-Tabs derselben Verbindung (erlaubt bis `MAX_SFTP_SESSIONS`) starten beide jede aktive Bindung.
- Beide schreiben bei derselben Änderung parallel nach `${target}.part` (`transfer.ts:116`) und benennen danach um. Das Ergebnis kann eine verschränkt geschriebene Datei sein.
- **Fix:** K16. Pro Manager läuft eine Bindungs-ID höchstens einmal. Die zweite Ansicht meldet `files.syncElsewhere`.

---

## 3. Korrekturen (bindend)

**K1: `src/main/files/transfer.ts`, `skip`-Hook (D).**
- Nur im `walk`, nicht für die Top-Level-Quellen. Diese filtern die Aufrufer selbst, das bestehende Verhalten (Fehler `sourceNotFound`/`unsafeName`) bleibt.
- `source` wird vor der Prüfung berechnet:
  ```ts
  for (const entry of await from.list(dir)) {
    const source = from.join(dir, entry.name);
    if (unsafeLocalName(entry.name) || skip?.(source, entry)) { skipped += 1; continue; }
    const destination = to.join(target, entry.name);
  ```
- Der Aufruf `sftp-session.ts:216` bleibt Zeichen für Zeichen gleich.
- Tests in `transfer.test.ts`:
  - `skip` verhindert den Abstieg: `from.list` wird für den ausgeschlossenen Ordner nie aufgerufen.
  - `skip` zählt in `skipped`.
  - `skip` bekommt den vollen Quellpfad.
  - Ohne `skip` sind die Ergebnisse unverändert (bestehende Tests).

**K2: `src/shared/vault/schema.ts`, nicht strikt (A).**
- Spec 3.1 verlangt `.strict()`. Der Vault wird aber beim **Laden** mit `VaultSchema.parse` geprüft (`migrations.ts:53`). Ein strikter Bindungs-Typ sperrt eine ältere Shellherd-Version komplett aus dem Vault, sobald eine neuere ein Feld an der Bindung ergänzt. Mit Stripping geht schlimmstenfalls ein Feld verloren, wie bei jedem anderen optionalen Feld.
- Schema genau nach Vertrag 1.2: `id` ist `uuid()` (gleiche Regel wie das IPC-Schema, sonst wäre eine Bindung nicht adressierbar), IDs sind eindeutig, Gerätepfade `\\?\` und `\\.\` werden abgelehnt.
- `schema.test.ts`:
  - Vault ohne `autoUpload` bleibt gültig.
  - Eine gültige Bindung an SSH und an SFTP wird angenommen.
  - Abgelehnt werden: relativer `localPath`, `\\?\C:\x`, `remotePath` ohne `/`, doppelte IDs, 17 Bindungen, ein Muster mit `\t`.
  - Ein Zusatzfeld in der Bindung wird **gestrichen** (nicht abgelehnt).

**K3: `src/shared/sftp.ts`, `ipc.ts`, `preload` (A).** Genau nach Vertrag 1.3 und 1.4, inklusive `failed`.

**K4: Bindungen beim Speichern des Formulars erhalten (A, I).**
- A: `keepAutoUpload` (Vertrag 1.5).
- A, Tests in `connection-form.test.ts`: SSH-Knoten mit Liste und frisch gebauter Knoten ergibt die Liste erhalten. Das gilt ebenso für SFTP. `existing` undefined oder ohne Liste ergibt das Objekt unverändert (`toBe`).
- I: Aufruf in `App.saveConnection` (B3).

**K5: Matcher-Regeln präzisiert (B).** Die Reihenfolge je Zeile:
1. Rand-Leerraum entfernen.
2. Leer oder mit `#` beginnend: ignorieren.
3. Mit `!` beginnend oder mit Steuerzeichen: ignorieren (`compileExcludes`) bzw. melden (`excludePatternError`).
4. Alle `\` durch `/` ersetzen. Windows-Nutzer tippen `build\`, gitignore-Escapes gibt es in Stufe 1 nicht.
5. Endet die Zeile auf `/`: `dirOnly` setzen und das `/` entfernen.
6. Enthält der Rest ein `/` (führend oder innen): verankert. Ein führendes `/` wird entfernt.
7. Ist der Rest leer: ignorieren.
8. Übersetzen wie in Spec 3.2. Ein `[!` am Klassenanfang wird zu `[^`. Flag `i`.

`excludePatternError` prüft nur die Punkte 3 (`negation` vor `control`). Die Prüfung `isExcluded` über alle Präfixe gilt wie in Spec 3.2. Zusätzliche Fälle in `exclude-glob.test.ts`:
- `build\` trifft den Ordner `build`.
- `src\gen\*.js` trifft `src/gen/a.js`.
- `[!a].txt` trifft `b.txt`, nicht `a.txt`.
- `#x` und `   ` treffen nichts.
- `/` allein trifft nichts.
- `**` trifft alles.
- `DEFAULT_EXCLUDES` wie in Spec 3.10.

**K6: Upload je Element, `known` aus dem Server (E).**
- Pro Lauf gibt es ein `TransferJob`-Objekt `{ id: binding.id, direction: 'upload', move: false, label: '', entryCount: 0, targetDir: remoteRoot, state: 'running', totalBytes: 0, doneBytes: 0, totalFiles: 0, doneFiles: 0, skippedFiles: 0 }`. `move` ist **literal `false`**: `runTransfer` löscht bei `move` die lokalen Quellen.
- Je Element: `const before = job.doneFiles; await runTransfer(job, [item], local, remote, { progress: () => {}, conflict: answerFor(item) }, signal)`. Hat sich `job.doneFiles` erhöht, war es ein Upload.
- Nach jedem Upload gilt `known.set(rel, (await remote.stat(item.target))?.modified ?? item.modified)`. **Nicht** `item.modified`: Lehnt der Server `setModified` ab (`transfer.ts:96` schluckt den Fehler, typisch bei fremdem Dateibesitz mit Gruppenschreibrecht), trägt die Serverdatei die Uploadzeit. Regel 1 würde dann jede weitere Speicherung als „fremd geändert“ überspringen.
- Danach: `synced += 1`, `last = { name: item.name, at: Date.now() }`, `rel` aus `skipped` und `failed` entfernen.
- Die Konfliktregeln 1–4 aus Spec 3.4 gelten unverändert, mit Vergleichen strikt `>` bzw. `≤` 1000.

**K7: Ordner-Ereignisse (E).**
- `handleEvent` merkt sich je relativem Pfad, ob ein `rename` dabei war (`pending: Map<string, boolean>`).
- Beim Flush wird jeder Eintrag geprüft (K9):
  - Ein Ordner **ohne** `rename` wird verworfen. `change` auf Ordnern kommt bei jeder Dateiänderung darin, gemessen. Sonst würde jede Speicherung den ganzen Elternordner abgleichen.
  - Ein Ordner mit `rename` (neu angelegt oder hineinverschoben) wird durchlaufen.
- Die Vorfahren-Deduplizierung läuft **nach** dieser Prüfung, nur gegen verbleibende Ordner-Einträge.

**K8: Settle mit Obergrenze (E).** Der Timer wird bei jedem Ereignis neu gesetzt, feuert aber spätestens `maxWaitMs` (2000) nach dem ersten noch offenen Ereignis. Sonst blockiert eine laufend beschriebene Datei (Log) im Ordner alle Uploads für immer.

**K9: Prüfung je Eintrag beim Flush (E).** Reihenfolge:
1. `abs = win32.join(root, relWin)`.
2. `lstat(abs)`: fehlt → verwerfen (Löschen wird nie gespiegelt). Link → verwerfen.
3. `real = await realpath(abs)` (`node:fs/promises`, nativ).
4. `rel = win32.relative(root, real)`. Verwerfen bei `''`, `..`-Präfix oder absolut. Das fängt Junctions in **Vorfahren** und 8.3-Kurznamen ab: ReadDirectoryChangesW kann Kurznamen melden, `NODE_M~1\x.js` würde sonst die Ausschlüsse umgehen und Müllordner auf dem Server anlegen.
5. Jedes Segment muss `!unsafeLocalName` sein.
6. Der Matcher prüft `rel` (POSIX) mit dem echten `isDirectory`.
7. Das Ziel ist `posix.join(remoteRoot, relPosix)` und muss mit `remoteRoot + '/'` beginnen.

Weitere Punkte:
- `root` ist `await realpath(win32.resolve(binding.localPath))` vom Start.
- In `handleEvent` (synchron, ohne I/O) wird nur vorgefiltert: `filename` ist null → Vollabgleich. NUL, absolut oder außerhalb → K10. Sonst `matcher(relPosix, false)`. Das schließt alle Vorfahren-Ordner aus, Ordner-Muster auf dem Eintrag selbst greifen erst beim Flush.

**K10: Wurzel weg und Startfehler (E).**
- Start: `lstat(localPath)`. Fehlt der Ordner oder ist er kein Ordner → `files.syncLocalMissing`. Ist er ein Link (`isSymbolicLink()`, also auch eine Junction) → `files.syncLocalLink`.
- Danach `fs.watch` in `try`. Ein synchroner Wurf wird zu `state: 'error'` mit `fileError(error)`.
- Ein Ereignis mit absolutem oder außerhalb liegendem `filename` startet einmalig (Flag `checkingRoot`) sofort `lstat(root)`:
  - Fehlt die Wurzel: Watcher schließen, Timer löschen, Lauf abbrechen, `state: 'error'` mit `files.syncLocalMissing`.
  - Sonst: Flag zurücksetzen und das Ereignis verwerfen.
- `watcher.on('error')` wie Spec 3.3.

**K11: Lokaler Wurzelpfad (E).**
- Die Gleichheitsprüfung `win32.resolve(localPath) === localPath` aus Spec 3.5 entfällt. Sie lehnt `C:\x\` ab, obwohl das Schema ihn erlaubt. Stattdessen gilt `root` aus K9.
- Überlappung (`files.syncOverlap`): gegen alle registrierten Bindungen dieser Instanz außer der eigenen ID, Vergleich `a.toLowerCase() + '\\'` beginnt mit `b.toLowerCase() + '\\'` oder umgekehrt (Pfade ohne abschließenden Backslash).

**K12: Fehler je Element (E).**
- Fehler eines Elements fangen. Ist der Code `files.sourceNotFound`/`files.notFound` (lokal inzwischen gelöscht): ignorieren. Sonst `rel` in `failed` (max. 100, ohne Duplikate), `error = fileError(e)`. Der Status bleibt `watching`/`syncing`, der Lauf geht weiter.
- `TransferCanceled` oder ein abgebrochenes Signal beenden den Lauf still.
- Nur Fehler aus `planTransfer` und `local.list(root)` im Vollabgleich (`tooManyPlanned`, `tooManyEntries`, Zugriff auf die Wurzel) führen zu `state: 'error'` mit geschlossenem Watcher.
- `ensureRemoteDir(remoteParent)` gilt nur für Batch-Einträge, segmentweise ab `remoteRoot`: `stat`, bei `null` `mkdir`, bei Typ ≠ Ordner `FileError('files.existsAsFile', { name })` als Elementfehler.

**K13: Filter des Vollabgleichs (E).**
- Gemeinsames Prädikat `skip = (source, entry) => entry.type === 'link' || entry.modified === 0 || matcher(relOf(source), entry.type === 'directory')`. `modified === 0` heißt: `lstat` ist gescheitert (`file-system.ts:81`), etwa bei einer gesperrten Datei. Ohne den Filter würde sie fälschlich als „auf dem Server neuer“ gemeldet.
- Die Kinder der Wurzel: `entries.filter(e => !unsafeLocalName(e.name) && !skip(win32.join(root, e.name), e))`. Ein unsicherer Name würde `planTransfer` sonst mit `files.unsafeName` für den ganzen Abgleich werfen lassen.

**K14: Force (E).**
- `force(id)` ist synchron: unbekannt → `FileError('files.syncNotFound')`. Sonst wird die interne, ungekappte Menge aller übersprungenen Pfade (nicht nur die 100 angezeigten) in eine Force-Warteschlange übernommen, und der Flush läuft wie ein Batch an (bei laufendem Lauf: `again`).
- Je Eintrag: `lstat`. Nur reguläre Dateien werden mit Hook `overwrite` hochgeladen. Wer inzwischen Ordner, Link oder weg ist, wird verworfen. Sonst würde ein Ordner mit `overwrite` ungefragt Dateien darin überschreiben.
- Danach `skipped = []`, `skippedMore = 0` für die abgearbeiteten Einträge.

**K15: `syncing` nur beim Vollabgleich (E).** Start, Sturm über 500 Einträge oder `filename === null` schalten auf `syncing`, danach zurück auf `watching`. Einzelne Batch-Uploads bleiben `watching` und setzen `last`. Sonst flackert die Zeile bei jeder Speicherung „Gleicht ab …“. Statusmeldungen werden auf 200 ms gedrosselt, Zustandswechsel und `closed` gehen sofort raus.

**K16: Eine Bindung nur einmal (E, F).**
- E: Am Anfang von `start()`, synchron vor jeder `await`-Stelle, gilt: `deps.inUseElsewhere?.(binding.id)` → Status `error` mit `files.syncElsewhere` registrieren und melden, sonst nichts starten.
- F: `inUseElsewhere: bindingId => [...this.sessions.values()].some(other => other !== session && other.syncs?.running(bindingId) === true)`.

**K17: Start-Ablauf (E).**
- `start()` registriert synchron einen Status (`syncing`, Zähler 0, Listen leer) und meldet ihn. Erst danach wird asynchron geprüft (K10, K11, Spec 3.5 remote: `realpath`, `stat` als Ordner, `remoteRoot === '/'` → `files.syncRemoteRoot`, nicht gefunden oder kein Ordner → `files.syncRemoteMissing`).
- Danach wird der Watcher gestartet und das Promise aufgelöst. Der Vollabgleich läuft im Hintergrund (`void`). So kehrt die IPC sofort zurück, und die Zeile hat immer einen Status.
- Eine bereits registrierte ID wird vorher mit `stop(id)` beendet.
- `closeAll()` und `stop()` setzen ein `closed`-Flag. Jede Fortsetzung prüft es bzw. das Signal.

**K18: Manager (F).**
- `connect` (`sftp-session.ts:96-100`):
  1. Nach `session.edits` kommt `session.syncs = new AutoUploads(session.fs, { local: this.dependencies.local, emit: (sync, closed) => { if (this.active(session)) this.emit(session, { type: 'sync', sessionId: session.id, sync, ...(closed ? { closed } : {}) }); }, inUseElsewhere: … })`.
  2. Status `connected` setzen und melden.
  3. **Danach** `for (const binding of connection.autoUpload ?? []) if (binding.enabled) void session.syncs.start(binding);`. Dazu ist eine Typ-Einengung auf `ssh`/`sftp` nötig, sie besteht in `connect` bereits.
- `syncStart`:
  1. `owned`.
  2. `getConnection(session.connectionId)`, Protokoll `ssh`/`sftp`.
  3. Bindung suchen, sonst `files.syncNotFound`.
  4. `session.syncs` muss da sein, sonst `files.sessionNotReady`.
  5. `await session.syncs.start(binding)`. `enabled` wird hier **nicht** geprüft, es steuert nur den Auto-Start.
- `syncStop`: `owned`, dann `session.syncs?.stop(bindingId)`.
- `syncForce`: `owned`, `syncs` muss da sein (sonst `sessionNotReady`), dann `force`.
- `state()` liefert `syncs: session.syncs?.list() ?? []`.
- `finish` ruft `session.syncs?.closeAll()` neben `edits.closeAll()` auf.
- `transferOwner` bleibt unverändert, `emit` liest `session.ownerId` zur Laufzeit.

**K19: IPC (F).** `SyncSchema` laut Vertrag 1.9. Die drei Handler werden nach `sftpEditClose` registriert. Der Renderer schickt nur `sessionId` und `bindingId`, Pfade kommen ausschließlich aus dem Vault-Snapshot.

**K20: `SplitTerminalArea.tsx` (I).** `findConnection` liegt in `src/main/ssh/session.ts` und ist im Renderer nicht importierbar. Stattdessen gilt:
```ts
const NO_BINDINGS: AutoUploadBinding[] = [];
const bindingsOf = (nodes: VaultNode[], id: string): AutoUploadBinding[] => {
  const node = findNode(nodes, id);   // ../vault-selection
  return node?.type === 'connection' && (node.protocol === 'ssh' || node.protocol === 'sftp') ? node.autoUpload ?? NO_BINDINGS : NO_BINDINGS;
};
```
FilesPanel bekommt `bindings={bindingsOf(nodes, tab.connection.id)}` und `onSaveAutoUpload={onSaveAutoUpload ? list => onSaveAutoUpload(tab.connection.id, list) : undefined}`. `App.tsx`:
```ts
const saveAutoUpload = (connectionId: string, bindings: AutoUploadBinding[]): Promise<boolean> => !vault ? Promise.resolve(false)
  : persistVault({ ...vault, nodes: updateNode(vault.nodes, connectionId, node => {
      if (node.type !== 'connection' || (node.protocol !== 'ssh' && node.protocol !== 'sftp')) return node;
      const { autoUpload: _old, ...rest } = node;
      return bindings.length ? { ...rest, autoUpload: bindings } : rest;
    }) }, t('files:sync.notSaved'));
```
Die Funktion wird nur an das `SplitTerminalArea` im Hauptfenster gegeben, `SecondaryWindow.tsx` bleibt unverändert.

**K21: `FilePane.tsx`, Menüeintrag (I).**
- Nur bei `side === 'local' && onAutoUpload`, ans Ende angehängt: `{ kind: 'separator' }, { kind: 'item', label: t('files:pane.autoUpload'), disabled: !!autoUploadHint, hint: autoUploadHint, onSelect: () => onAutoUpload(menuFolder ? fullPaths([menuFolder.name])[0] : path!) }`. Der Eintrag erscheint nur, wenn `path` gesetzt ist.
- FilesPanel übergibt `onAutoUpload` nur bei `remote` (nicht `LOCAL_CONTAINER_HOST`) und `autoUploadHint = !onSaveAutoUpload ? t('files:sync.mainWindowOnly') : !remoteReady ? t('files:sync.notConnected') : undefined`. Die Spec setzte die Prop nur bei `remoteReady` und zeigte dann fälschlich „Nur im Hauptfenster“, auch wenn nur die Verbindung fehlte.

**K22: `FilesPanel.tsx`, Verdrahtung (I).**
- `syncs` als State: der `sync`-Zweig fügt ein oder ersetzt, `closed` entfernt. Die Adoption übernimmt `state.syncs ?? []`. `reconnect` setzt `syncs` auf `[]`.
- Toasts:
  - Fehler-Toast, wenn eine Bindung **per Ereignis** von „nicht error“ nach `error` wechselt. Bei der Adoption über `state()` gibt es keinen Toast.
  - Info-Toast, wenn `skipped.length` per Ereignis von 0 auf mehr als 0 wechselt: `notify.info(t('files:sync.skippedTitle', { count: skipped.length + skippedMore }), { body: t('files:sync.skippedBody', { names: skipped.slice(0, 5).join(', ') }), action: { label: t('files:sync.force'), run: () => void window.desktopApi.sftpSyncForce({ sessionId, bindingId }).catch(…) } })`.
  - Die vorherigen Zustände werden je `bindingId` in einem `useRef` gemerkt.
- Abläufe, jeweils **erst** `await onSaveAutoUpload(...)`. Nur bei `true` folgt die IPC, Fehler gehen nach `setActionError(fail(error))`:

  | Aktion | Vault | IPC |
  |---|---|---|
  | Neu | `[...bindings, b]` | `sftpSyncStart` |
  | Bearbeiten | ersetzen | `sftpSyncStop`, dann bei `enabled` `sftpSyncStart` |
  | Anhalten | `enabled: false` | `sftpSyncStop` |
  | Fortsetzen | `enabled: true` | `sftpSyncStart` |
  | Entfernen | filtern | `sftpSyncStop` |

- „Trotzdem überschreiben“ ruft ohne Vault-Schritt `sftpSyncForce` auf.
- Der Dialog ist `busy`, solange gespeichert wird. Bei `false` bleibt er offen.
- `AutoUploadList` steht unter der `EditList` mit `canEdit = !!onSaveAutoUpload`.

**K23: `AutoUploadList.tsx`, Zeilentext (H).** Vorrang:
1. `!enabled` → `sync.state.disabled`.
2. `status === 'closed' || status === 'error'` → `sync.state.offline`.
3. Kein Laufzeitstatus → `sync.state.idle`.
4. Sonst nach `state`:
   - `watching` mit `last` → `Überwacht · zuletzt …`.
   - `error` → `${t('files:sync.state.error')} · ${errorText(error)}`.

Dazu kommen ` · ` + `sync.skipped` (count = `skipped.length + skippedMore`) und ` · ` + `sync.failed` (title = `errorText(error)` und die Namen).
- Der Titel ist `bindingName(binding)` aus `auto-upload-form.ts` (G, gleiche Welle, nur Import).
- Zustandsschlüssel über eine Map mit vollen Literalen wie `EDIT_STATE_KEYS`.
- Knöpfe nach Spec 3.8. Die drei Vault-Knöpfe sind bei `!canEdit` `disabled` mit `title={t('files:sync.mainWindowOnly')}`.
- Das CSS für **Liste und Dialog** (`.file-sync-list`, `.file-sync-dialog`) schreibt H in `files-ui.css`, G fasst kein CSS an.

**K24: Dialog und Prüfung (G).**
- Normalisierung in `bindingFromDraft`:
  - lokal: trimmen, `/` → `\`, abschließende `\` entfernen, außer bei `X:\`.
  - remote: trimmen, abschließende `/` entfernen, außer bei `/`.
  - Ausschlüsse: Zeilen trimmen, leere verwerfen.
- `autoUploadErrors`:
  - `localPath`: `!AUTO_UPLOAD_LOCAL_PATH.test(p) || /[\0\r\n]/.test(p)` → `localAbsolute`. Überlappung (K11-Regel, gegen **alle** anderen Bindungen der Verbindung, auch angehaltene) → `overlap` mit `{ name: bindingName(other) }`.
  - `remotePath`: `/` → `remoteRoot`, ohne führendes `/` oder mit `\0\r\n` → `remoteAbsolute`.
  - `excludes`: Das erste Muster mit `excludePatternError` ergibt `negation`/`patternChars`. Mehr als 200 Muster oder ein Muster über 256 Zeichen → `patternChars`.
- Feldfehler mit `.field-error`, `role="alert"`, `aria-invalid`, `aria-describedby`.
- `onSave` erst, wenn keine Fehler vorliegen.
- `auto-upload-form.test.ts`: jeder Fehler, Überlappung (gleich, Vorfahre, Nachfahre, Groß/Klein, `C:\a` gegen `C:\ab` **ohne** Überlappung), Normalisierung, `newAutoUpload` mit gültiger UUID und Vorgaben.

**K25: Doku (J).**
- `docs/handbuch.md` hat **kein** Dateiansicht-Kapitel. Neu ist `## Dateiansicht: Auto-Upload` vor `## Meldungen und Verbindungszustand`, entsprechend in `docs/manual.md`.
- Inhalt wie Spec 3.12, zusätzlich die Risiken R3, R4, R6, R7 und R9 aus Abschnitt 5 in Nutzersprache.
- CHANGELOG de und en mit gleicher Anzahl Punkte (Paritätstest), Version über `npm run version:minor` (0.13.0).
- `docs/design-system.md` Zeile 203: `Auto-Upload-Dialog (.file-sync-dialog)` in „Übrige Dialoge“ ergänzen.

**K26: run-app (K).**
- Der Demo-Vault überlebt Läufe (`demo-setup.mjs` entsperrt einen bestehenden). Eine bleibende Bindung würde beim nächsten Lauf schon vor dem Shot `sftp` automatisch hochladen und den Shot verändern.
- Der Block endet daher mit „Entfernen“ der Bindung. Steht beim Start schon eine Zeile `.file-sync-list .transfer-job` da (abgebrochener Lauf), wird sie zuerst entfernt.
- Dann folgt Rechtsklick auf `.file-pane-local .file-list`, `menuItem('Auto-Upload einrichten …')`, `waitFor('dialog.file-sync-dialog[open]')`, Shot `sftp-auto-upload-dialog`, Primärknopf, `waitFor` `.file-sync-list .transfer-job` mit „Überwacht“, Shot `sftp-auto-upload`, Entfernen.
- In SKILL.md kommen beide Screens in die Liste.

**K27: Tests (E, F).** Zusätzlich zu Spec 3.10:
- `auto-upload.test.ts`, Fake-Remote mit `rename`, das ersetzt:
  - `removeFile` und `removeDirectory` werden **nie** aufgerufen.
  - Lokale Dateien bestehen nach jedem Lauf (`move: false`).
  - Fake-`setModified` als No-op (Server übernimmt die Zeit nicht): Die zweite lokale Änderung wird trotzdem hochgeladen (K6).
  - Ein `change`-Ereignis auf einem Ordner löst keinen Abgleich des Ordners aus (K7).
  - Dauerereignisse alle 100 ms auf `a.log`: Upload spätestens nach `maxWaitMs` (K8).
  - Junction (`symlinkSync(outside, join(root, 'j'), 'junction')`) und Ereignis `j\secret.txt` ergeben keinen Upload (K9).
  - Wurzel löschen, dann `handleEvent(id, 'rename', '\\\\?\\' + root)` ergibt `error` mit `files.syncLocalMissing` und keine weiteren Ereignisse (K10).
  - Ein Fake-`write`, das für eine Datei scheitert: Die übrigen werden hochgeladen, `failed` enthält sie (K12).
  - `force` lädt nur noch vorhandene Dateien (K14).
  - `inUseElsewhere` true ergibt `files.syncElsewhere` (K16).
  - `stop` ergibt `closed`.
  - `force` mit unbekannter ID wirft `files.syncNotFound`.
- `sftp-session.test.ts`: `state()` enthält `syncs: []` nach dem Öffnen. `syncStart` mit unbekannter ID ergibt `files.syncNotFound`, ohne dass die Sitzung bereit ist (Reihenfolge K18).
- `sftp-loopback.test.ts`: das `it` aus Spec 3.10, außerdem eine zweite Sitzung derselben Verbindung, deren Bindung `files.syncElsewhere` meldet.

---

## 4. Wellen (endgültig)

Nach jeder Welle müssen `npm run typecheck` und `npx vitest run` grün sein, ohne Ausnahme. Umsetzer schreiben nur ihre Dateien, committen nie und löschen nichts außerhalb ihrer Task. Ein Umsetzer darf mitten in der Welle Typfehler aus Dateien paralleler Tasks derselben Welle sehen. Maßgeblich ist das Gate am Wellenende.

### Welle 1: A, B, D, J

| Task | Dateien (exklusiv) | Pflichtpunkte |
|---|---|---|
| **A** Typen, Vault, IPC | `src/shared/sftp.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/shared/vault/types.ts`, `src/shared/vault/schema.ts`, `src/shared/vault/schema.test.ts`, `src/renderer/src/connection-form.ts`, `src/renderer/src/connection-form.test.ts`, `src/renderer/src/components/FilesPanel.tsx` (**nur** Zeile 145) | Vertrag 1.1–1.5; B1, B3, K2, K3, K4 (A-Teil) |
| **B** Matcher | `src/shared/exclude-glob.ts`, `src/shared/exclude-glob.test.ts` | Vertrag 1.6; Spec 3.2 mit K5 |
| **D** Transfer-Hook | `src/main/files/transfer.ts`, `src/main/files/transfer.test.ts` | Vertrag 1.7; K1 |
| **J** Doku, Version | `docs/handbuch.md`, `docs/manual.md`, `CHANGELOG.md`, `CHANGELOG.en.md`, `package.json` und `package-lock.json` (nur über `npm run version:minor`), `docs/design-system.md` | K25; `version.test.ts` grün |

### Welle 2: E, G, H, C1, K

| Task | Dateien (exklusiv) | Pflichtpunkte | braucht |
|---|---|---|---|
| **E** AutoUploads | `src/main/files/auto-upload.ts`, `src/main/files/auto-upload.test.ts` | Vertrag 1.8; Spec 3.3–3.5 mit B4, B5, K6–K17, K27 (E-Teil) | A, B, D, C1 |
| **G** Dialog, Prüfung | `src/renderer/src/components/AutoUploadDialog.tsx`, `src/renderer/src/auto-upload-form.ts`, `src/renderer/src/auto-upload-form.test.ts` | Vertrag 1.10, 1.11; Spec 3.8 (Dialog); K24 | A, B, C1 |
| **H** Liste, CSS | `src/renderer/src/components/AutoUploadList.tsx`, `src/renderer/src/files-ui.css` | Vertrag 1.11; Spec 3.8 (Liste, CSS für Liste **und** Dialog, nur Tokens, keine Bewegung); K23 | A, G (`bindingName`), C1 |
| **C1** Texte I | `src/shared/locales/{de-DE,en-US}/files.json`, `src/shared/locales/{de-DE,en-US}/errors/files.json` | Tabelle 1.12 „C1“ vollständig, sonst nichts | – |
| **K** run-app | `.claude/skills/run-app/screens.mjs`, `.claude/skills/run-app/SKILL.md` | K26; Ausführung erst nach Welle 3 | – |

### Welle 3: F, I, C2

| Task | Dateien (exklusiv) | Pflichtpunkte | braucht |
|---|---|---|---|
| **F** Session, IPC | `src/main/files/sftp-session.ts`, `src/main/files/ipc.ts`, `src/main/files/sftp-session.test.ts`, `src/main/files/sftp-loopback.test.ts` | Vertrag 1.9; Spec 3.6; K16 (F-Teil), K18, K19, K27 (F-Teil) | A, E |
| **I** Panel-Verdrahtung | `src/renderer/src/components/FilesPanel.tsx`, `src/renderer/src/components/FilePane.tsx`, `src/renderer/src/components/SplitTerminalArea.tsx`, `src/renderer/src/App.tsx` | Vertrag 1.11; B3 (App-Teil), K4 (I-Teil), K20, K21, K22 | A, G, H, C2 |
| **C2** Texte II | `src/shared/locales/{de-DE,en-US}/files.json` | Tabelle 1.12 „C2“ vollständig, sonst nichts | – |

Nach Welle 3 folgen der Build und `run-app` mit dem Block `sftp`, beide neuen PNGs werden angesehen (Spec S4). Danach kommt das Gate.

### Rulings dieser Validierung

- **R-V1:** Upload je Element statt eines erweiterten Konflikt-Hooks. Grund: `transfer.ts` bleibt bis auf `skip` unverändert, Fehler bleiben je Datei. Kosten, falls falsch: ein `runTransfer`-Aufruf je Datei, also messbar nur im Mikrosekundenbereich.
- **R-V2:** Das Bindungs-Schema ist nicht strikt. Grund: Ein älteres Shellherd soll den Vault weiter öffnen können. Kosten, falls falsch: Unbekannte Felder an Bindungen werden beim Speichern still gestrichen.
- **R-V3:** `realpath` dient nur als Eingrenzung (Junction in Vorfahren, Kurznamen), nie zum Folgen von Links. Kosten, falls falsch: ein Syscall je Batch-Eintrag.
- **R-V4:** Eine Bindungs-ID läuft je App nur in einer Dateiansicht. Kosten, falls falsch: Die zweite Ansicht zeigt einen Fehler statt mitzulaufen.
- **R-V5:** `syncing` gilt nur beim Vollabgleich. Kosten, falls falsch: Einzel-Uploads zeigen keinen Zwischenzustand.

---

## 5. Offene Risiken

- **R1:** Lehnt der Server `setModified` ab, trägt die Serverdatei die Uploadzeit. Beim **nächsten Sessionstart** (`known` ist leer) gelten solche Dateien als „auf dem Server neuer“ und werden mit Hinweis übersprungen. „Trotzdem überschreiben“ löst das. In Stufe 1 bleibt das so (K6 behebt nur den Fall innerhalb der Sitzung).
- **R2:** Bestehender Shortcut `transfer.ts:115`: Eine echte Serverdatei `x.part` neben `x` wird beim Upload von `x` überschrieben bzw. bei einem Fehler entfernt. Eine gebundene lokale Datei `x.part` ist damit gefährdet.
- **R3:** Solange die Dateiansicht mit aktiver Bindung offen ist, lässt Windows den **Elternordner** nicht umbenennen oder verschieben (`EPERM`, gemessen). Das gehört ins Handbuch.
- **R4:** Die Vorgaben (N6) schließen `.env`, Schlüssel und Ähnliches nicht aus. Neue Dateien landen mit 0644 auf dem Server. Das Handbuch muss ausdrücklich darauf hinweisen.
- **R5:** Netzlaufwerke und UNC-Freigaben: ReadDirectoryChangesW über SMB ist unzuverlässig. Pufferüberlauf meldet libuv als `filename === null`, das ergibt einen Vollabgleich. Verpasste Ereignisse ohne Überlauf holt erst der nächste Sessionstart nach.
- **R6:** Ein lokal nicht lesbarer Unterordner (`EACCES` in `list`) bricht den Vollabgleich ab (K12), die Bindung steht auf Fehler. Abhilfe ist ein Ausschluss-Muster.
- **R7:** Zwei Bindungen verschiedener lokaler Ordner auf denselben Server-Ordner sind erlaubt. Sie schützen sich gegenseitig über Regel 1 (übersprungen mit Hinweis), überschreiben sich aber nicht still.
- **R8:** Startabgleich mit vielen Dateien bedeutet ein `stat` je Zieldatei, wie in Spec 4 (1).
- **R9:** Groß/Klein-Umbenennung lokal (`Foo` → `foo`) legt auf dem Server eine zweite Datei an, die alte bleibt (N5).
