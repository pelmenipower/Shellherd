# Audit-Fixes – Validierung (bindend)

Spec: `docs/superpowers/specs/2026-10-20-audit-fixes-design.md` · Plan: `docs/superpowers/plans/2026-10-20-audit-fixes.md` · Stand: HEAD 7be51a0, Baseline `npx vitest run` 114 Dateien / 1635 Tests grün.

**Urteil: ready after corrections.** 4 Blocker, 19 Korrekturen. Dieser Anhang geht Spec und Plan vor.

Geprüft und bestätigt (keine Änderung nötig): `unsafeLocalName` deckt Download-Unterordner und oberste Ebene ab; Uploads laufen durch denselben Pfad (`sftp-session.ts:216`), lokale Namen können die Zeichen nicht enthalten. Lokale Umbenennen/Neu-Ordner/Neue-Datei-Namen kommen nur vom Nutzer und werden schon im Renderer geprüft (`file-browser.ts:68` `nameError`, verbietet `\/:*?"<>|`); Servernamen erreichen lokale Pfade nur über `transfer.ts` und `remote-edit.ts`. `planTransfer`-`skipped` landet in `job.skippedFiles` (`sftp-session.ts:217`) und damit in `files:queue.skipped`. Windows-`fs.rename` ersetzt ein vorhandenes Ziel (libuv, Replace-Semantik); OpenSSH-SFTP-`rename` nicht. `registerMarker` in xterm 6.0.0: `registerMarker(cursorYOffset?): IMarker` (nie `undefined`), Marker folgt `onTrim`, wird bei `line < 0` disposed und meldet dann `line === -1`. `transferOwner` (ssh/rdp/sftp) wirft vor jeder Mutation; ein `closed`-Tab ohne `session` wird im Zielfenster schon heute über `adopt` dargestellt (`useTabTransfer.ts:36,44`, Typ-Kommentar `windows.ts:52`). `writeAppSettings` hat genau einen Aufrufer (`locale.ts:29`) plus Test. `files/ipc.ts` und `window-ipc.ts` lassen sich in Vitest ohne Electron-Mock importieren (geprüft). Versionsregeln: `version.test.ts` und `check-version.mjs` verlangen `## [0.12.1] – 2026-10-20` oben in beiden CHANGELOGs mit gleicher Eintragszahl; gepaarte Backticks sind erlaubt.

---

## Blocker

**X1 – #24 funktioniert so nicht.** In i18next 26.5.2 überschreibt `init` `options.interpolation.format` immer mit dem Formatter-Modul (`node_modules/i18next/dist/esm/i18next.js:1858-1861`, Standard `Formatter`), und `InterpolationOptions` kennt `format` nicht (Typecheck rot). **Fix:** eigenes Formatter-Modul über `use()` (öffentliche API, `FormatterModule`, `type: 'formatter'`, `i18next.js:1996`). Katalog nutzt keine eingebauten `{{x, number}}`-Formate (geprüft), der Ersatz des Standard-Formatters bricht nichts. Exakter Code siehe Vertrag V8.

**X2 – Welle-1-Dateikonflikt durch `decryptVault`.** `decryptVault` wird importiert von `session.test.ts:15` (Task C), `session-key.test.ts:8`, `crypto.test.ts:4` und `storage.ts:14`. Löscht B es in Welle 1, ist Cs Testdatei rot bzw. zwei Tasks schreiben `session.test.ts`. **Fix:** In Welle 1 bleibt `decryptVault` in `crypto.ts` und bekommt die `safeParse`-Prüfung, die `unlockVault` verliert (V3). Das Verschieben nach `src/test/vault-helpers.ts` samt aller Importe macht K in Welle 2.

**X3 – Roter Test #21 ist nicht rot.** `codedFrom(new Error('x'.repeat(2000)), …)` liefert `{ code: 'ai.requestFailed' }` ohne `detail` (`shared/errors.ts:107-111`); der Test wäre vor dem Fix grün. **Fix:** `stream` wirft `new AiError('ai.requestFailed', undefined, 'x'.repeat(2000))` (AppError behält `detail` ungekürzt, `toCoded()`); Erwartung `detail.length <= 500`. Vorher: 2000.

**X4 – #20 bricht Typecheck in Welle 2.** `SudoWatcher.armed` wird in `sudo.test.ts:100` benutzt, `SudoRejections.clear` zusätzlich in `discovery.test.ts:229`. **Fix:** K ändert `sudo.test.ts:100` (Zeile löschen; die folgenden Assertions belegen das Entschärfen), `discovery.test.ts:229` → `sudoRejections.clearAll();`, `sudo-rejections.test.ts:66-68` → `clear`-Zeilen und die zugehörigen `expect` streichen, `clearAll`-Teil bleibt.

---

## Vertrag (verbindliche Schnittstellen)

**V1 – `src/main/files/file-system.ts` (A)**
```ts
/** Names Windows cannot store safely: separators, drive/stream colons, control chars, trailing dot/space, device names. */
export const unsafeLocalName = (name: string): boolean =>
  name === '' || name === '.' || name === '..' || /[\\/:*?"<>|\x00-\x1f]/.test(name) || /[. ]$/.test(name)
  || /^(con|prn|aux|nul|com[1-9]|lpt[1-9]|conin\$|conout\$)(\..*)?$/i.test(name);
```
Fehler: `new FileError('files.unsafeName', { name })`.

**V2 – `copyFile` in `src/main/files/transfer.ts` (A)**, ersetzt Spec #3-Ablauf:
```ts
const partial = `${item.target}.part`;
try {
  await pipeline(from.read(item.source), counter, to.write(partial), { signal });
} catch (error) {
  await to.removeFile(partial).catch(() => {});
  if (signal.aborted) throw new TransferCanceled();
  throw error;
}
// Local rename replaces the target; OpenSSH SFTP refuses an existing one, so it is removed first there.
await to.rename(partial, item.target).catch(async () => {
  await to.removeFile(item.target).catch(() => {});
  await to.rename(partial, item.target).catch(async error => {
    // The old file survived (e.g. locked): drop the copy. Otherwise `.part` is the only copy and stays.
    if (await to.stat(item.target).catch(() => null)) await to.removeFile(partial).catch(() => {});
    throw error;
  });
});
```
Kommentar `shortcut: ein echter Name x.part kollidiert; bleibt so, bis es jemand meldet.` bleibt. `runTransfer` unverändert (Move löscht die Quelle erst nach erfolgreichem `copyFile`).

**V3 – `src/main/vault/crypto.ts` (B, Welle 1)**
```ts
export async function unlockVault(file: EncryptedVaultFile, password: string): Promise<UnlockedVault>   // no schema parse
export async function decryptVault(input: unknown, password: string): Promise<Vault>   // safeParse EncryptedVaultFileSchema → AppError('core.vaultFileCorrupt'), then unlockVault
```
Welle 2 (K): `decryptVault` wandert unverändert nach `src/test/vault-helpers.ts` (gleiche Signatur), wird aus `crypto.ts` entfernt.

**V4 – `src/renderer/src/terminal-access.ts` (E)**
```ts
export interface TerminalMark { line: () => number; dispose: () => void }
// in TerminalAccess:
/** Marks the cursor line; the mark follows the buffer when old lines are trimmed. */
mark: () => TerminalMark;
// implementation:
mark: () => { const marker = term.registerMarker(0); return { line: () => Math.max(0, marker.line), dispose: () => marker.dispose() }; },
```
Kein `undefined`-Fallback (Typ ist `IMarker`). `cursorLine` bleibt.

**V5 – `src/main/window-ipc.ts` (F)**
```ts
export type TransferTab = z.infer<z.ZodObject<typeof tabFields>>;
export function moveSession(owners: Pick<WindowIpcDependencies, 'ssh' | 'rdp' | 'sftp'>, from: number, tab: TransferTab, target: BrowserWindow):
  { connection: TransferTab['connection']; status: TransferTab['status']; session?: TransferTab['session']; snapshot?: string }
```
Fehlerfall: `{ connection: tab.connection, status: 'closed', ...(tab.snapshot ? { snapshot: tab.snapshot } : {}) }`.

**V6 – `src/main/app-settings.ts` / `locale.ts` (H)**
```ts
/** Sync, never throws; false when the file could not be written. */
export function writeAppSettings(file: string, patch: Partial<AppSettings>): boolean
```
`LocaleStore.set`: zuerst `if (this.file && !writeAppSettings(this.file, { language: setting })) throw new AppError('core.settingsWriteFailed');`, danach Zustand und Listener wie bisher. Docstring: „Persists first; throws core.settingsWriteFailed and keeps the old state when that fails.“

**V7 – `src/renderer/src/hooks/usePersistVault.ts` (I)**
```ts
export interface PersistDeps {
  vault: () => Vault | null;
  setVault: (vault: Vault) => void;
  setVaultPath: (path: string) => void;
  setBusy: (busy: boolean) => void;
  setSaved: (saved: boolean) => void;
  save: (vault: Vault) => Promise<VaultSessionResult>;
}
export function persistVaultWith(deps: PersistDeps, inProgress: { current: boolean }, updatedVault: Vault, failureTitle?: string): Promise<boolean>;
export function usePersistVault(vault: Vault | null, setters: Pick<PersistDeps, 'setVault' | 'setVaultPath' | 'setBusy' | 'setSaved'>):
  (updatedVault: Vault, failureTitle?: string) => Promise<boolean>;
```
Texte über das Modul-`t` aus `../i18n` (kein `t` in den Deps), `notify` aus `../notice-store`, `errorText` aus `../error-text`. `previousVault = deps.vault()`; Retry vergleicht `deps.vault() === previousVault` und ruft `persistVaultWith` rekursiv mit denselben Deps. Der Hook hält `vaultRef` und `inProgress` als `useRef` und `save: vault => window.desktopApi.saveCurrentVault({ vault })`. `App.tsx` entfernt `saveInProgress` und `vaultRef` (nur dort genutzt) und ruft `const persistVault = usePersistVault(vault, { setVault, setVaultPath, setBusy, setSaved });`.

**V8 – `src/renderer/src/i18n.ts` (I)**
```ts
import type { FormatterModule } from 'i18next';
import { formatNumber, setFormatLocale } from '../../shared/format';
// Counts and limits follow the language; ports, exit codes and IDs stay raw.
const COUNT_KEYS = new Set(['count', 'done', 'opened', 'total', 'shown', 'selected', 'max']);
// i18next replaces interpolation.format with its formatter module, so the hook is a formatter module.
const countFormatter: FormatterModule = { type: 'formatter', init: () => {}, add: () => {}, addCached: () => {},
  format: (value, _format, _lng, options) =>
    typeof value === 'number' && COUNT_KEYS.has(String(options?.interpolationkey)) ? formatNumber(value) : value };
void i18next.use(initReactI18next).use(countFormatter).init({ …, interpolation: { escapeValue: false, alwaysFormat: true }, … });
```
Pluralwahl liest `options.count` vor der Interpolation und bleibt unberührt. Strings (z. B. `files:queue.bytes` mit `formatSize`-Text in `done`/`total`) bleiben unverändert (`typeof` number).

**V9 – RDP-Protokoll (D):** Eine `error`-Zeile des Helfers trägt `sessionId` genau dann, wenn die fehlgeschlagene Nachricht `type: 'open'` war. `host.ts` beendet nur dann eine Sitzung.

**V10 – Katalog-Keys** (genau diese, sonst keine neuen oder entfallenden Keys): `errors` `files.unsafeName` (A), `errors` `core.settingsWriteFailed` (H); geänderte Texte `assistant:panel.hint1`, `assistant:panel.hint2`, `main` `assistant.prompt.command` (E). Wortlaute in K12.

---

## Korrekturen

**K1 – #1/#2 Tests ohne Nebenwirkung auf echtes `%TEMP%`.** `remote-edit.test.ts`: `vi.mock('node:fs/promises', async importOriginal => ({ ...await importOriginal<typeof import('node:fs/promises')>(), mkdtemp: vi.fn() }))`; Fake-`read` liefert einen Stream, der sofort mit Fehler endet. Erwartung: rejects `{ code: 'files.unsafeName' }`, `mkdtemp` und `openFile` nicht aufgerufen. Vorher rot (mkdtemp gerufen bzw. anderer Fehler). Der Check in `remote-edit.ts` steht direkt nach `const name = posix.basename(remotePath)` und vor `mkdtemp`.

**K2 – #2 `editorFor`** bleibt wie in der Spec in `src/main/files/ipc.ts` (exportiert, `extname` aus `node:path`), Test `open-for-editing.test.ts` importiert aus `./ipc` ohne Mock. Der alte `RUNNABLE`-Ausdruck und sein Kommentar entfallen.

**K3 – #3 Tests.** Neuer Test „Lesefehler“: Quelle `read` = `PassThrough`, ein Chunk geschrieben, danach `stream.destroy(new Error('read'))`; Erwartung rejects, `/target/a.txt` weiter `{ data: 'old' }`, kein `/target/a.txt.part`. Erfolgsfall: kein `.part`, Inhalt neu. Abbruchtest `transfer.test.ts:87-99` zusätzlich `expect(target.nodes.has('/target/big.bin.part')).toBe(false)`.

**K4 – #4 Test.** `vi.mock('node:fs/promises', …)` als Passthrough (`...actual`, `open` und `rename` als `vi.fn(actual.…)`); im Test `open` per `mockImplementationOnce` das echte Handle liefern und `handle.sync` umhüllen, das `calls`-Array erhält `'sync'` und `'rename'`. Erwartung `calls` = `['sync', 'rename']`. `storage.ts`: `open(temporaryPath, 'w', 0o600)`, `writeFile(serializedVault, 'utf8')`, `sync()`, `close()` im inneren `finally`, dann `rename`; äußeres `finally` mit `rm(temporaryPath, { force: true })` bleibt.

**K5 – #4/#20 `loadVault`.** B löscht `loadVault` und den `decryptVault`-Import in `storage.ts`. `storage.test.ts:65,95,108` nutzen `decryptVault(await readEncryptedVaultFile(path), password)` aus `./crypto` (Welle 1); K stellt den Import in Welle 2 auf `../../test/vault-helpers` um.

**K6 – #6 C# exakt** (`Program.cs`, C# 5, `csc.exe`):
```csharp
string requestId = null;
string type = null;
try { requestId = Protocol.String(message, "requestId", false); type = Protocol.String(message, "type", true); switch (type) { … } }
catch (Exception error)
{
    // Only a failed open ends a session in the main process; errors on live sessions must not.
    object id = null;
    SendError(requestId, error.Message, type == "open" && message.TryGetValue("sessionId", out id) ? id as string : null);
}
…
private static void SendError(string requestId, string message, string sessionId = null)
{ … if (sessionId != null) error["sessionId"] = sessionId; … }
```
Nicht `Protocol.String` im `catch` (wirft bei Nicht-String und entkäme `Handle`). Die beiden anderen `SendError`-Aufrufe (`:61`, `:65`) bleiben unverändert. Abnahme statt `SHELLHERD_RDP_DEBUG`: `npm run build:rdp-host` baut; `printf '{"type":"open","sessionId":"abc"}\n' | out/rdp-host/Shellherd.RdpHost.exe` gibt eine `error`-Zeile mit `"sessionId":"abc"` aus (fehlender `server` → FormatException). Ergebnis in den Report.

**K7 – #6 `host.ts`:** im `error`-Zweig `const failed = message.sessionId ? this.sessions.get(message.sessionId) : undefined; if (!failed) { console.warn('RDP-Helfer:', message.message); return; }`, sonst `failed.failed = true; failed.status = 'error'; emit(...status 'error', rdpStatusError('error', message.message)); this.sessions.delete(failed.id)`. `host.test.ts`: `vi.mock('electron', () => ({ screen: { dipToScreenRect: (_w: unknown, rect: unknown) => rect } }))`, `vi.mock('node:child_process', …)` mit Fake-Child (`stdin: { write, on }`, `stdout: new PassThrough()`, `stderr: { resume }`, `on`, `exitCode: null`); Fake-Fenster mit `getNativeWindowHandle: () => Buffer.alloc(8)`, `webContents.getZoomFactor`, `getContentBounds`, `on`, `isDestroyed`. Die Fehlerzeile per `stdout.write(JSON.stringify(…) + '\n')` einspeisen und einen Tick warten (statt privater `receive`). Zusätzlich: Fehler ohne `sessionId` → kein `emit`.

**K8 – #7/#14 `session.ts` exakt:** `const updatedVault: Vault = { ...VaultSchema.parse(vault), updatedAt: new Date().toISOString() };` · nach dem Schreiben `session.filePath = filePath; session.vault = updatedVault; return { filePath, vault: structuredClone(updatedVault) };`. Import `VaultSchema` aus `../../shared/vault/schema`. Test #14: `vi.mock('./storage', async importOriginal => { const actual = await importOriginal<typeof import('./storage')>(); return { ...actual, writeEncryptedVaultFile: vi.fn(actual.writeEncryptedVaultFile) }; })`; im Test `mockImplementationOnce(async (path, file) => { const written = await actual…(path, file); manager.lock(); return written; })` (actual über `vi.importActual`). Die anderen Tests der Datei laufen über den Passthrough unverändert. Der Import von `decryptVault` in `session.test.ts` bleibt in Welle 1 auf `./crypto`.

**K9 – #9 Ablauf präzisiert.** `typeCommand(tabId, entryId, command)`:
```ts
void typeIntoTerminal(tabsRef.current.find(item => item.id === tabId), command).then(result => {
  if (!('typed' in result)) { updateEntry(tabId, entryId, { note: result.reason }); return; }
  updateEntry(tabId, entryId, { inserted: result.typed, note: undefined });
  const access = liveSessions.get(tabId)?.terminal;
  // The echo of the typed command arrives first; output after Enter starts below it.
  if (access) setTimeout(() => update(tabId, current => ({ ...clearAwaiting(current), output: undefined, awaiting: { mark: access.mark(), command: result.typed } })), 400);
});
```
`useCallback`-Deps `[update, updateEntry]`. Ruling: `awaiting` entsteht jetzt nach jedem erfolgreichen Eintippen per Klick (bisher nur beim Auto-Tippen) – gewollt, passt zu `hint1`. `clearAwaiting` als Modulfunktion: `const clearAwaiting = (current: Conversation): Conversation => { current.awaiting?.mark.dispose(); return { ...current, awaiting: undefined }; };` (doppeltes `dispose` unter StrictMode ist harmlos). „Verlauf leeren“ (`AssistantPanel.tsx:242`): vor `delete next[tab.id]` `next[tab.id]?.awaiting?.mark.dispose();`. Watcher: `const line = item.awaiting.mark.line(); if (access.cursorLine() <= line || …) continue; … access.linesFrom(line, 300)`; beide Löschstellen über `clearAwaiting`. `isFinished`-Import aus `assistant-chat` entfällt in `AssistantPanel.tsx`.

**K10 – #10 Test** in der bestehenden `terminal-access.test.ts`: Fake-`Terminal` mit `onWriteParsed: () => ({ dispose() {} })`, `buffer.active`, `registerMarker: vi.fn(() => marker)` mit `marker = { line: 5, dispose: vi.fn() }`. Erwartungen: `mark().line()` = 5, nach `marker.line = 2` → 2, nach `-1` → 0, `dispose()` ruft `marker.dispose`.

**K11 – #11** `tabTransfer`: vor `resolveTarget` `if (parsed.session && !{ terminal: ssh, rdp, sftp }[parsed.session.kind].owns(from, parsed.session.sessionId)) throw new AppError('core.viewSessionUnavailable');`. Beide Handler rufen `moveSession({ ssh, rdp, sftp }, from, tab, target)`. Test: Fake-Ziel `{ webContents: { id: 2 } } as BrowserWindow`.

**K12 – #8 Wortlaute (vollständig, ersetzen die Spec-Auszüge):**

| Key | de-DE | en-US |
|---|---|---|
| `assistant:panel.hint1` | Sag, was du erreichen willst, z. B. „Ich will die Pods im Namespace monitoring neu starten.“ Der Assistent schlägt den passenden Befehl vor; Eintippen schreibt ihn in die Eingabezeile. Nach deinem Enter liest er die Ausgabe, ordnet sie in einem Satz ein und geht nur weiter, solange dein Ziel offen ist. | Say what you want to achieve, e.g. “I want to restart the pods in the monitoring namespace.” The assistant suggests the matching command; Type in puts it on the input line. After you press Enter, it reads the output, summarizes it in one sentence and only continues while your goal is still open. |
| `assistant:panel.hint2` | Erklärungen gibt es nur auf Nachfrage („erkläre …“). Die letzten Terminalzeilen gehen mit deiner Frage an <provider/>. Befehle landen erst mit Eintippen in der Eingabezeile und laufen erst mit deinem Enter. | Explanations only on request (“explain…”). The last terminal lines go to <provider/> along with your question. Commands reach the input line only with Type in and run only when you press Enter. |
| `main` `assistant.prompt.command` | Befehl einzeilig in <command>…</command>, höchstens einer pro Antwort. Shellherd zeigt ihn als Vorschlag; der Nutzer tippt ihn selbst ein und führt ihn aus. | Put the command on one line inside <command>…</command>, at most one per answer. Shellherd shows it as a suggestion; the user types it in and runs it. |
| `errors` `files.unsafeName` | Der Dateiname „{{name}}“ ist unter Windows nicht erlaubt. | The file name “{{name}}” is not allowed on Windows. |
| `errors` `core.settingsWriteFailed` | Die Einstellungen konnten nicht gespeichert werden. | The settings could not be saved. |

`<provider/>` bleibt (Trans-Komponente). Regeln aus `i18n-catalog.test.ts` (f) sind eingehalten.

**K13 – #16 Test-Reihenfolge und Werte.** Zuerst `timeout?: number` in `ConnectionTestDependencies` einführen (`dependencies.timeout ?? TIMEOUT`, sonst nichts) – erst dann ist der Test rot (vorher würde das Literal-Feld ignoriert und der Test wäre grün). Werte: `timeout: 1_000`, `verifyHost` wartet 2 000 ms. Fix: `let timer: ReturnType<typeof setTimeout>`; Hostkey-Callback beginnt mit `clearTimeout(timer)`; in `then` nach `keyChecked = valid` und im `catch` jeweils `if (!finished) timer = setTimeout(onTimeout, timeout)` (Timeout-Handler als benannte Konstante); `readyTimeout: 120_000` mit Kommentar „ssh2 must not time out while the host key dialog is open.“ Läuft der Timer ab, bevor der Callback startet, ist `isActive()` falsch und `verify` zeigt keinen Dialog – korrekt.

**K14 – #18** Testzeile ist `app-settings.test.ts:47` (nicht `:44`): `expect(writeAppSettings(join(dir, 'missing', 'x', 'settings.json'), { language: 'de-DE' })).toBe(false);`; zusätzlich der Erfolgsfall `toBe(true)`. `locale.test.ts`: nach `init` mit nicht existierendem Ordner wirft `set('en-US')` `{ code: 'core.settingsWriteFailed' }`, `get()` unverändert, Listener nicht gerufen.

**K15 – #19/#23** wie V7; `void lockVault().catch(() => {}).then(() => { setScreen('open'); setSelectedVaultPath(filePath); });`. Test `hooks/usePersistVault.test.ts` spioniert `notify.error`/`notify.info` per `vi.spyOn` und prüft, dass `action.run()` bei verändertem `deps.vault()` `notify.info` mit `t('app:notices.notRetried')` ruft und `save` genau einmal lief.

**K16 – #24 Test** in `i18n.test.ts`: `t('files:queue.skipped', { count: 1000 })` → `1.000 übersprungen`; nach `changeLanguage('en-US')` → `1,000 skipped`; `t('connection:test.steps.portReachable', { port: 2222 })` → `Port 2222 erreichbar` (de); `t('files:queue.bytes', { done: '1,0 KB', total: '2,0 KB' })` unverändert. Danach `changeLanguage('de-DE')` zurück (Datei-Setup erwartet de-DE). Vorher rot (`1000`).

**K17 – #5 Treiber.** Token vor `listen` schreiben (`fs.writeFileSync(path.join(WORK, 'token'), TOKEN, { mode: 0o600 })`, bei jedem Start neu). Die Prüfung steht als erste Anweisung im Request-Handler, vor `/quit`. SKILL.md: Bereitschaftsschleife liest das Token je Durchlauf und nutzt `-f`, sonst bricht ein 403 (altes Token) die Schleife ab: `for i in $(seq 1 60); do curl -sf -m 2 -H "x-driver-token: $(cat "$TEMP/shellherd-run/token" 2>/dev/null)" http://127.0.0.1:9333/windows && break; sleep 1; done`. Alle anderen `curl`-Beispiele mit `-H "$T"`, `T` wie in der Spec. `demo-setup.mjs`: `const RUN_DIR = process.env.SHELLHERD_RUN_DIR ?? path.join(os.tmpdir(), 'shellherd-run')`, `VAULT` daraus, Token in `call` lesen, Header `x-driver-token`. Node-`fetch` sendet kein `Origin` (geprüft).

**K18 – #20 preload.** `LOCALE_ARG` ist der erste Laufzeit-Import aus `src/shared` im sandboxed Preload. K prüft nach `npx electron-vite build`, dass `out/preload/index.js` kein `require("../shared` o. ä. enthält (gebündelt), und startet die App einmal (`run-app`, Screenshot Startkarte). `ipcErrorText`-Aufrufer schließen `file-browser.test.ts` ein.

**K19 – Doku/CHANGELOG/Abnahme.**
- Eintrag 10 de: „Behoben: Zahlen in Meldungen folgen der Sprache (z. B. „1.000 übersprungen“); die Drag-Vorschau in anderen Fenstern verschwindet auch, wenn die Ansicht während des Ziehens geschlossen wird.“ (Fensterschließen entlädt die Seite ohne React-Unmount; das deckt #22 nicht ab – ACCEPTED, siehe Risiken.) en sinngemäß gleich, gleiche Eintragszahl.
- Handbuch/Manual haben keinen Abschnitt Dateiansicht. Der Satz kommt als letzter Punkt in die Liste „Aktueller Stand“ (`docs/handbuch.md`) bzw. deren Gegenstück in `docs/manual.md`: de „Dateiansicht: `Bearbeiten` öffnet nur Text-, Konfigurations- und Quelltextdateien im Standardprogramm, alles andere in Notepad.“ en „File view: `Edit` opens only text, configuration and source files in the default program, everything else in Notepad.“ (en-Label vorher im Katalog prüfen und exakt übernehmen).
- #15-Abnahme: Ein neu angelegter Vault bekommt `.term` schon beim Anlegen. Stattdessen `profile/demo.term` nach `profile/demo2` kopieren, `demo2` öffnen (Dialog-Stub über `/main` auf `demo2` umbiegen), etwas ändern, speichern → `profile/last-vault.json` nennt `demo2.term`.

---

## Wellen und Dateien (endgültig)

Regeln für alle Tasks: test-first; nur die genannten Dateien schreiben; während der Welle nur die eigenen Testdateien laufen lassen (`npx vitest run <dateien>`) und Typecheck-Fehler außerhalb der eigenen Dateien ignorieren; das Gate (voller `npm run typecheck` + `npx vitest run`) macht die Orchestrierung nach jeder Welle. Kein Commit durch Umsetzer.

### Welle 1 (parallel, disjunkt)

| Task | Befunde | Dateien |
|---|---|---|
| A | #1, #2, #3 | `src/main/files/file-system.ts`, `src/main/files/transfer.ts`, `src/main/files/transfer.test.ts`, `src/main/files/remote-edit.ts`, `src/main/files/remote-edit.test.ts` (neu), `src/main/files/ipc.ts` (nur `openForEditing`/`editorFor`/`RUNNABLE`), `src/main/files/open-for-editing.test.ts` (neu), `src/shared/locales/de-DE/errors/files.json`, `src/shared/locales/en-US/errors/files.json` |
| B | #4, #25, #20 (`loadVault`, `crypto`-Dependency) | `src/main/vault/storage.ts`, `src/main/vault/storage.test.ts`, `src/main/vault/crypto.ts`, `package.json` + `package-lock.json` (nur `npm uninstall crypto`) |
| C | #7, #14, #15 | `src/main/vault/session.ts`, `src/main/vault/session.test.ts`, `src/main/vault/ipc.ts` |
| D | #6 | `src/main/rdp/host.ts`, `src/main/rdp/host.test.ts`, `native/Shellherd.RdpHost/Program.cs` |
| E | #8, #9, #10 | `src/renderer/src/components/AssistantPanel.tsx`, `src/renderer/src/terminal-access.ts`, `src/renderer/src/terminal-access.test.ts`, `src/shared/locales/{de-DE,en-US}/assistant.json`, `src/shared/locales/{de-DE,en-US}/main.json` (nur `assistant.prompt.command`) |
| F | #11 | `src/main/window-ipc.ts`, `src/main/window-ipc.test.ts` (neu) |
| G | #12, #13, #17 | `src/main/kubernetes/client-api.ts`, `src/main/kubernetes/client-api.test.ts`, `src/main/kubernetes/access.ts`, `src/main/kubernetes/access.test.ts`, `src/main/ssh/session.ts`, `src/main/ssh/session.test.ts` |
| H | #16, #18 | `src/main/connection-test.ts`, `src/main/connection-test.test.ts`, `src/main/app-settings.ts`, `src/main/app-settings.test.ts`, `src/main/locale.ts`, `src/main/locale.test.ts`, `src/shared/locales/{de-DE,en-US}/errors/core.json` |
| I | #19, #22, #23, #24 | `src/renderer/src/App.tsx`, `src/renderer/src/hooks/usePersistVault.ts` (neu), `src/renderer/src/hooks/usePersistVault.test.ts` (neu), `src/renderer/src/components/SplitTerminalArea.tsx`, `src/renderer/src/i18n.ts`, `src/renderer/src/i18n.test.ts` |
| J | #5, #21 | `src/main/ai/assistant.ts`, `src/main/ai/assistant.test.ts` (neu), `.claude/skills/run-app/driver.mjs`, `.claude/skills/run-app/demo-setup.mjs`, `.claude/skills/run-app/SKILL.md` |

B ändert `migration-backup.test.ts` und `session-key.test.ts` nicht (Aufrufer übergeben bereits `EncryptedVaultFile`).

### Welle 2 (eine Task)

| Task | Befunde | Dateien |
|---|---|---|
| K | #20 Rest, #25 Test-Helfer | `src/main/ssh/validation.ts`, `src/main/ai/ipc.ts`, `src/main/files/ipc.ts` (nur `parse`), `src/main/rdp/ipc.ts`, `src/main/window-ipc.ts` (nur `parse`), `src/renderer/src/container-tree.ts`, `src/renderer/src/file-browser.ts`, `src/renderer/src/file-browser.test.ts`, `src/renderer/src/components/FilesPanel.tsx`, `src/renderer/src/components/containers/ContainerDock.tsx`, `src/renderer/src/components/containers/ContainerView.tsx`, `src/renderer/src/hooks/useContainerDiscovery.ts`, `src/renderer/src/inventory-scheduler.ts`, `src/renderer/src/error-text.ts`, `src/preload/index.ts`, `src/main/containers/sudo.ts`, `src/main/containers/sudo.test.ts`, `src/main/containers/sudo-rejections.ts`, `src/main/containers/sudo-rejections.test.ts`, `src/main/containers/discovery.test.ts`, `src/test/vault-helpers.ts` (neu), `src/main/vault/crypto.ts`, `src/main/vault/crypto.test.ts`, `src/main/vault/session-key.test.ts`, `src/main/vault/session.test.ts`, `src/main/vault/storage.test.ts` |

`parseRequest(schema, value, code: ErrorCode = 'ssh.invalidRequest')`; Codes: ai `ai.invalidRequest`, files `files.invalidRequest`, rdp `core.invalidRdpRequest`, window `core.invalidWindowRequest`. Weitere Fundstellen von `ipcMessage`/`ipcErrorText` per `grep` vor dem Löschen; Liste oben ist der Stand von HEAD.

### Welle 3 (eine Task)

| Task | Dateien |
|---|---|
| L | `package.json`, `package-lock.json` (`npm run version:patch` → 0.12.1), `CHANGELOG.md`, `CHANGELOG.en.md` (zehn Einträge, K19), `docs/handbuch.md`, `docs/manual.md` |

Danach Gate, `run-app`-Abnahme (Spec S5, mit K17-Token und K19-#15-Ablauf), Review.

---

## Risiken (ACCEPTED)

- #7: Felder, die der Renderer an Vault-Objekte hängt und die `VaultSchema` nicht kennt, verschwinden jetzt sofort nach dem Speichern statt erst nach dem nächsten Entsperren. In der Datei fehlten sie schon immer. C prüft im Report per `grep`, ob ein Renderer-Pfad solche Felder erwartet.
- #22: Beim Schließen eines ganzen Fensters räumt der Main-Prozess Hover und Ghost nicht auf (`window-ipc.ts` `hovered`). Nicht Teil dieses Auftrags.
- #6: Ein doppeltes `open` mit vorhandener `sessionId` würde die lebende Sitzung beenden; `host.ts` erzeugt UUIDs, der Fall tritt nicht auf.
- #2: `csv` öffnet im Standardprogramm (meist Excel, das Formeln vor Ausführung abfragt). Bleibt in der Allow-Liste.
