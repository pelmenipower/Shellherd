# Audit-Fixes – Design

Auftrag: „fix everything u found!“ – alle 25 Befunde aus dem Ponytail-Audit vom 2026-10-19 (`.superpowers/sdd/2026-10-19-audit-fixes/audit.md`). Grundlage ist das Konzept `.superpowers/sdd/audit-fixes-research.md`, das hier vollständig als Spec übernommen ist (ab „Leitentscheidungen“). Plan: `docs/superpowers/plans/2026-10-20-audit-fixes.md`.

## Spec-Rulings (Stufe 3)

- **S1** Alle Konzept-Rulings gelten unverändert, einschließlich der bewusst weggelassenen Punkte.
- **S2** #2 Allow-Liste ohne `js`/`py`/`sh`/`ps1`/`html`: Sicherheit vor Bequemlichkeit. Wer ein Skript im Standardeditor will, wählt „Bearbeiten mit Notepad“ oder öffnet es lokal selbst. Steht als „Geändert“ im CHANGELOG.
- **S3** #8 Auto-Tippen entfällt ersatzlos, ohne Einstellung.
- **S4** Version 0.12.1 (Patch), Datum 2026-10-20.
- **S5** Abnahme in der echten App (`run-app`) nach Welle 3 für #1, #2, #5, #8 und #15. Nichts Veränderndes gegen echte Hosts oder Cluster.

## Leitentscheidungen

- **Alle 25 Befunde werden behoben, in der kleinsten vollständigen Form.** Kein Umbau drumherum, keine neuen Optionen. Wo ein Befund eine Entscheidung verlangt, steht unten ein Ruling.
- **Version 0.12.1 (Patch).** Nichts ist eine neue Funktion; zwei sichtbare Verhaltensänderungen (Assistent tippt nicht mehr selbst, Bearbeiten öffnet nur Allow-Liste im Standardprogramm) sind Fehlerbehebungen und kommen ins CHANGELOG. `src/shared/version.test.ts` und `scripts/check-version.mjs` verlangen für die `package.json`-Version einen obersten Abschnitt `## [0.12.1] – 2026-10-20` in `CHANGELOG.md` **und** `CHANGELOG.en.md` mit gleicher Eintragszahl.
- **Jeder Befund bekommt einen Test, der vor der Änderung rot ist**, außer den unter „Bewusst weggelassen“ genannten (#5, #8/#9, #15, #20, #22, #23, #25) – dort steht je ein Abnahmeschritt.
- **Keine neuen Abhängigkeiten.** Für #24 kein i18next-Plugin.

---

## Must fix

### #1 SFTP-Download: Pfadausbruch über Servernamen – bestätigt

- `src/main/files/transfer.ts:34-35`: `to.join(target, entry.name)`; bei Downloads ist `to` `localFileSystem` mit `win32.join` (`src/main/files/file-system.ts:64`). Ein Linux-Name `..\..\x.bat` verlässt den Zielordner, `a:b` schreibt einen NTFS-Stream. Oberste Ebene ebenso: `transfer.ts:48-49` (`from.basename` ist `posix.basename`, lässt `\` und `:` durch). `.`/`..` filtert der Server-Listing-Code (`sftp-file-system.ts:51`), aber `CON`, `NUL`, `COM1` sind Gerätenamen und blockieren `createWriteStream`.
- **Lösung:** Helfer in `src/main/files/file-system.ts` neben `fileError`:

  ```ts
  /** Names Windows cannot store safely: separators, drive/stream colons, control chars, trailing dot/space, device names. */
  export const unsafeLocalName = (name: string): boolean =>
    /[\\/:*?"<>|\0-\x1f]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(name) || name === '' || name === '.' || name === '..';
  ```

  In `planTransfer`: im `walk` vor dem `join` `if (unsafeLocalName(entry.name)) { skipped += 1; continue; }`; auf oberster Ebene `if (unsafeLocalName(name)) throw new FileError('files.unsafeName', { name })`. Das folgt dem bestehenden Muster: oberste Ebene wirft (`files.sourceNotFound`), Unterebenen zählen (`transfer.ts:41`).
- **Ruling:** Der Check gilt richtungsunabhängig (auch Upload); Windows-Namen enthalten die Zeichen ohnehin nicht, so gibt es einen Pfad statt zwei. Kein Umbenennen mit `_`: stilles Umbenennen macht Daten unauffindbar.
- **Test** (`transfer.test.ts`, Memory-FS): Quellordner mit `..\\evil.bat`, `a:b`, `trail.`, `ok.txt` → nur `/target/dir/ok.txt` entsteht, `skipped === 3`; oberste Quelle `/src/x:y` → rejects `files.unsafeName`. Vorher: alle vier landen im Ziel.
- **Katalog:** `files.unsafeName` (errors). Übersprungene Einträge nutzen den vorhandenen Text `files:queue.skipped` („{{count}} übersprungen“, `FilesPanel.tsx:293`); kein weiterer Text.

### #2 Remote-Bearbeiten führt Code aus – bestätigt

- `src/main/files/remote-edit.ts:54-56`: `posix.basename(remotePath)` als lokaler Name unter `mkdtemp(...)`; `\`-Namen verlassen den Temp-Ordner.
- `src/main/files/ipc.ts:43-52` `openForEditing`: Block-Liste `RUNNABLE` umgehbar mit `evil.bat.` (`extname` = `.`), `evil.bat ` (Windows entfernt das Leerzeichen) und fehlenden Typen. Gravierender: `.py`, `.rb`, `.pl`, `.php`, `.sh`, `.lua` fehlen; mit installiertem Interpreter (Python-Launcher, Git für Windows registriert `.sh`) **führt `shell.openPath` sie aus**. Gilt auch für `localOpen` (`ipc.ts:111`).
- **Lösung:**
  1. `remote-edit.ts:54`: `if (unsafeLocalName(name)) throw new FileError('files.unsafeName', { name })`.
  2. `ipc.ts`: Block-Liste durch Allow-Liste ersetzen, Entscheidung als reine Funktion:

  ```ts
  // Only types whose Windows association is a viewer or editor, never an interpreter. Everything else opens in Notepad.
  const EDITABLE = /^\.(txt|text|md|markdown|rst|json|json5|jsonc|yaml|yml|toml|ini|cfg|conf|config|properties|env|log|csv|tsv|xml|xsd|xsl|sql|diff|patch|c|h|cc|cpp|hpp|cs|java|go|rs|kt|swift|ts|tsx|jsx|css|scss|less|vue|svelte|graphql|proto|tf|hcl|service|timer)$/i;
  export function editorFor(path: string, editor: EditorChoice): EditorChoice {
    return editor === 'notepad' || !EDITABLE.test(extname(path)) ? 'notepad' : 'default';
  }
  ```

  `openForEditing`: `if (editorFor(path, editor) === 'notepad' || await shell.openPath(path)) openInNotepad(path)`.
- **Ruling Allow-Liste:** Nur Klartext, Konfiguration und Quelltexte kompilierter Sprachen. Bewusst **nicht**: `js`, `py`, `rb`, `pl`, `php`, `sh`, `bash`, `ps1`, `lua`, `vbs` (Interpreter-Verknüpfung möglich), `html`/`htm`/`svg` (Browser führt Skripte aus), alles Binäre. `extname` auf dem rohen Namen: `evil.bat.` → `.` → Notepad, `evil.bat ` → `.bat ` → Notepad. Damit ist #2 auch ohne Schritt 1 dicht; Schritt 1 schließt nur den Temp-Ordner-Ausbruch.
- **Verhaltensänderung:** Lokale `.py`/`.sh` im Dateibereich öffnen in Notepad statt zu laufen → CHANGELOG.
- **Test** (`src/main/files/open-for-editing.test.ts`, neu, nur `editorFor`, kein Electron-Mock): `evil.bat.`, `evil.bat `, `x.chm`, `x.py`, `x.sh`, `x.html` → `notepad`; `x.txt`, `x.yaml`, `x.cs` → `default`; `x.txt` mit `notepad` → `notepad`. Vorher: `evil.bat.` und `x.py` liefern `default`. Für `remote-edit.ts` neuer `remote-edit.test.ts`: `open('/srv/..\\x')` mit Fake-`RemoteFileSystem` (`stat` liefert Datei) → rejects `files.unsafeName`, kein Temp-Ordner angelegt.

### #3 Überschreiben + Lesefehler löscht die bestehende Datei – bestätigt

- `transfer.ts:111-114`: `to.write(item.target)` kürzt das Ziel auf 0; der `catch` löscht es. Ein Lesefehler der Quelle vernichtet die Zieldatei.
- **Lösung:** In `copyFile` nach `item.target + '.part'` schreiben; nach Erfolg `await to.removeFile(item.target).catch(() => {}); await to.rename(partial, item.target)`; im `catch` nur `to.removeFile(partial)`. `FileSystem.rename` existiert (`file-system.ts:23`, SFTP `sftp-file-system.ts:65`).
- **Ruling:** `removeFile` vor `rename` ist nötig, weil SFTP-`rename` (SSH_FXP_RENAME) auf OpenSSH ein vorhandenes Ziel nicht ersetzt. Das Fenster ohne Ziel ist minimal; die Daten liegen vollständig in `.part`. Kein `posix-rename@openssh.com` (serverabhängig). `shortcut: ein echter Name x.part kollidiert; bleibt so, bis es jemand meldet.`
- **Test** (`transfer.test.ts`): `/target/a.txt` = „alt“, Quelle `read` wirft nach dem ersten Chunk → `runTransfer` rejects, `/target/a.txt` ist weiter „alt“, kein `a.txt.part`. Vorher: `a.txt` fehlt. Zweiter Fall: Erfolg → kein `.part`, Inhalt neu. Der Abbruch-Test (`transfer.test.ts:87`) wird auf `.part` angepasst.

### #4 Vault-Schreiben nicht dauerhaft – bestätigt

- `src/main/vault/storage.ts:52-58`: `writeFile(tmp)` + `rename` ohne `fsync`.
- **Lösung:** `open(temporaryPath, 'w', 0o600)` → `handle.writeFile(serializedVault, 'utf8')` → `handle.sync()` → `handle.close()` im `finally` → `rename`. Import `writeFile` weg, `open` dazu.
- **Test** (`storage.test.ts`): `vi.mock('node:fs/promises', async importOriginal => …)` mit `open`-Spy, der das echte Handle liefert und `sync` beobachtet; Erwartung: `sync` vor `rename` (gemeinsames `calls`-Array). Vorher: `sync` nie gerufen.

### #5 Dev-Treiber führt Code für jede Website aus – bestätigt

- `.claude/skills/run-app/driver.mjs:57-61,82-94`: `/eval`, `/main` führen den Body aus; keine Aufruferprüfung. Browserseiten können `POST text/plain` ohne Preflight an `127.0.0.1:9333` schicken.
- **Lösung (nur Skill-Dateien):**
  - `driver.mjs`: `const TOKEN = randomBytes(16).toString('hex')`; nach `WORK/token` schreiben (`mode: 0o600`), im `ready`-Log nennen. Vor dem Routing (auch vor `/quit`): `if (request.headers.origin || request.headers['x-driver-token'] !== TOKEN) { response.statusCode = 403; response.end('token'); return; }`.
  - `demo-setup.mjs:12`: Token aus `path.join(RUN_DIR, 'token')` lesen (`RUN_DIR` aus dem `VAULT`-Ausdruck herausziehen), Header `x-driver-token` setzen.
  - `SKILL.md`: Absatz „Treiber-Token“: `T="x-driver-token: $(cat "$TEMP/shellherd-run/token")"`; alle `curl`-Beispiele und die Bereitschaftsschleife mit `-H "$T"`; Hinweis „ohne Header 403“.
- **Ruling:** Datei statt Umgebungsvariable, weil die Shell zwischen Agent-Aufrufen nicht erhalten bleibt. `Origin`-Sperre zusätzlich, weil eine Zeile und Browser den Header immer setzen. Kein Projektcode, kein Unit-Test; Abnahme: `curl -s -o /dev/null -w '%{http_code}' -X POST --data 'return 1' http://127.0.0.1:9333/eval` → `403`.

### #6 Fehlgeschlagenes RDP-Öffnen hängt für immer – bestätigt

- `src/main/rdp/host.ts:210`: `type:'error'` → nur `console.warn`. `native/Shellherd.RdpHost/Program.cs:120` schickt bei `Open`-Fehlern (Server leer, Sitzung existiert, Maximum, `stopping`) nur `requestId`, und `host.ts` setzt gar keine `requestId`. Die Sitzung bleibt in `sessions` mit `connecting`.
- **Lösung:**
  - `Program.cs` `Handle`: `type` vor dem `try` deklarieren; `catch` → `SendError(requestId, error.Message, type == "open" ? Protocol.String(message, "sessionId", false) : null)`; `SendError` setzt `error["sessionId"]`, wenn nicht null.
  - `host.ts` `receive`: bei `type === 'error'` Sitzung über `message.sessionId` suchen; gefunden → `session.failed = true`, Status `error` mit `rdpStatusError('error', message.message)`, `this.sessions.delete(session.id)`; sonst wie bisher `console.warn`.
- **Ruling Semantik:** Nur `open`-Fehler tragen `sessionId`. Fehler aus `bounds`/`focus`/`action` auf einer lebenden Sitzung dürfen sie nicht beenden (Helfer-Fenster liefe weiter, Main hätte sie vergessen).
- **Aufwand:** Main + C#-Helfer (`scripts/build-rdp-host.mjs` mit `csc.exe`; `out/rdp-host` per `extraResources`). Der Umsetzer baut den Helfer und prüft mit `SHELLHERD_RDP_DEBUG=1`, dass die Fehlermeldung `sessionId` trägt.
- **Test** (`host.test.ts`): `vi.mock('node:child_process')` (stdin-Stub, `stdout` als `PassThrough`), `vi.mock('electron', …)` wie `ssh/ipc.test.ts:13`; nach `open(...)` `(manager as unknown as { receive(line: string): void }).receive(JSON.stringify({ type: 'error', sessionId, message: 'x' }))` → `emit` erhält `{ type: 'status', status: 'error', error: { code: 'core.rdpFailed', detail: 'x' } }`. Vorher: kein `emit`.

### #7 Session hält ungeparsten Vault – bestätigt

- `src/main/vault/session.ts:75-98`: `updatedVault` ist das Renderer-Objekt; `encryptVaultWithKey` (`crypto.ts:106`) parst mit `VaultSchema` (plain `z.object`, entfernt unbekannte Felder), aber nur die Datei bekommt das Ergebnis. `session.vault` behält unbekannte Felder, die über `getSnapshot` an Renderer, Container- und Kube-Code zurückgehen.
- **Lösung:** `session.ts:75`: `const updatedVault: Vault = { ...VaultSchema.parse(vault), updatedAt: new Date().toISOString() };` `structuredClone` an `:76` und `:98` entfällt (`parse` liefert neue Objekte, `getSnapshot` klont beim Lesen).
- **Ruling:** Die zweite `parse` in `encryptVaultWithKey` bleibt (Mikrosekunden; eine Signaturänderung zöge `session-key.test.ts:41` mit).
- **Test** (`session.test.ts`): `save({ ...vault, unknownField: 1 } as Vault)` → `getSnapshot().vault` ohne `unknownField`. Vorher: vorhanden.

---

## Should fix

### #8 Assistent tippt ohne Klick – bestätigt

- `src/renderer/src/components/AssistantPanel.tsx:124-131`: im `delta`-Zweig wird der erste vollständige `<command>`-Block sofort über `typeCommand` ins Terminal geschrieben. `less`/`git log` ohne Alternate Screen nehmen Tasten entgegen; Terminaltext kann das Modell steuern.
- **Ruling: ganz streichen, keine Einstellung.** Eine Einstellung würde die Lücke als Schalter konservieren. `Eintippen` (`assistant:panel.type`) bleibt der einzige Weg. Die Checkbox `autoEvaluate` („Ausgabe nach Enter automatisch einordnen“) betrifft nur das Lesen und bleibt. Keine Einstellung und kein Key fällt weg.
- **Lösung:** `delta`-Zweig nur noch `request.text += event.text` + `updateEntry`; `done`-Zweig ohne den `awaiting`-Block (`:133-139`, zieht nach `typeCommand`, siehe #9). `isFinished`-Import entfällt, wenn ungenutzt. Komponentenkommentar (`:52-56`) anpassen.
- **Texte (de/en):** `assistant:panel.hint1` → „Sag, was du erreichen willst, z. B. „Ich will die Pods im Namespace monitoring neu starten.“ Der Assistent schlägt den passenden Befehl vor; Eintippen schreibt ihn in die Eingabezeile. Nach deinem Enter liest er die Ausgabe, ordnet sie in einem Satz ein und geht nur weiter, solange dein Ziel offen ist.“ `assistant:panel.hint2` → „… Befehle landen erst mit Eintippen in der Eingabezeile und laufen erst mit deinem Enter.“ `main` `assistant.prompt.command` (`de-DE/main.json:46`): „Shellherd zeigt ihn als Vorschlag; der Nutzer tippt ihn selbst ein und führt ihn aus.“ (en: “Shellherd shows it as a suggestion; the user types it in and runs it.”). Handbuch/README beschreiben das Auto-Tippen nicht → nur CHANGELOG.
- **Test:** keiner (React-Handler ohne reine Logik, kein DOM-Harness in `vitest.config.ts`). Abnahme: Prüfer-Review des Diffs.

### #9 Assistent wartet auf Ausgabe eines nie getippten Befehls – bestätigt

- `AssistantPanel.tsx:135-139`: `awaiting` wird 400 ms nach `done` gesetzt, auch wenn `typeIntoTerminal` abgelehnt hat.
- **Lösung:** `awaiting` entsteht nur in `typeCommand`, wenn `result` `typed` enthält:

  ```ts
  void typeIntoTerminal(tab, command).then(result => {
    if (!('typed' in result)) { updateEntry(tabId, entryId, { note: result.reason }); return; }
    updateEntry(tabId, entryId, { inserted: result.typed, note: undefined });
    const access = liveSessions.get(tabId)?.terminal;
    // The echo of the typed command arrives first; output after Enter starts below it.
    if (access) setTimeout(() => update(tabId, current => ({ ...clearAwaiting(current), output: undefined, awaiting: { mark: access.mark(), command: result.typed } })), 400);
  });
  ```

  Durch #8 miterledigt; kein eigener Test.

### #10 `cursorLine` bricht nach vollem Scrollback – bestätigt

- `src/renderer/src/terminal-access.ts:45`: `baseY + cursorY` ist nur absolut, solange der Puffer nicht abschneidet; danach wandert `awaiting.line` weg, `cursorLine() <= line` wird falsch, `linesFrom` liest zu viel oder nichts.
- **Lösung:** `TerminalAccess.mark: () => TerminalMark` mit `TerminalMark = { line: () => number; dispose: () => void }` über `term.registerMarker(0)`; `line()` liefert `Math.max(0, marker.line)` (xterm setzt `-1`, wenn die Zeile aus dem Scrollback fiel → ab Pufferanfang lesen). Liefert `registerMarker` `undefined`, bleibt die feste Zahl `baseY + cursorY`. `cursorLine` bleibt für den Vergleich. `awaiting: { mark: TerminalMark; command: string }`; Watcher: `const line = item.awaiting.mark.line(); … linesFrom(line, 300)`.
- **Ruling Marker-Lebensdauer:** genau so lang wie `awaiting`. Helfer `clearAwaiting(current)` (dispose + `awaiting: undefined`) an allen Stellen, die `awaiting` löschen: `send` (`:109`), Watcher (`:157`, `:160`), „Verlauf leeren“ (`:264`). Schließt der Tab, entsorgt xterm die Marker mit dem Terminal. Kein Timeout, kein Zähler.
- **Test** (`terminal-access.test.ts`): Fake-`Terminal` mit `registerMarker` → Marker mit veränderbarem `line`; `mark().line()` folgt dem Marker; `-1` → `0`; `dispose` ruft `marker.dispose`. Vorher: `mark` existiert nicht.

### #11 Tab-/Ansicht-Verschieben mit Teilfehler – bestätigt

- `src/main/window-ipc.ts:114-121` `moveSession`: `transferOwner` wirft `ssh.notAvailable` (`ssh/session.ts:206`), wenn die Sitzung inzwischen weg ist; in `viewTransfer` (`:142-152`) passiert das **nach** `await resolveTarget` und mitten im `map` – schon übertragene Sitzungen sind pausiert (`stream.pause()`) und gehören einem Fenster, das nie `attach` ruft. `tabTransfer` (`:131-140`) prüft nicht und erzeugt ggf. ein Fenster, bevor `transferOwner` wirft.
- **Ruling Semantik:** Eine Sitzung, die beim Verschieben nicht mehr dem Quellfenster gehört, wandert als **geschlossener Tab** weiter (`status: 'closed'`, ohne `session`, mit `snapshot`) – wie ein Tab, dessen Verbindung während des Ziehens endete. Die Ansicht bleibt vollständig. Vor dem Anlegen eines Fensters wird wie bei `viewTransfer` geprüft; der `closed`-Pfad fängt das Rennen dazwischen.
- **Lösung:** `moveSession` als exportierte Modulfunktion `moveSession(owners: Pick<WindowIpcDependencies, 'ssh' | 'rdp' | 'sftp'>, from, tab, target)`; Body in `try`, `catch` → `{ connection: tab.connection, status: 'closed', ...(tab.snapshot ? { snapshot: tab.snapshot } : {}) }`. `tabTransfer`: vor `resolveTarget` dieselbe `owns`-Prüfung wie `viewTransfer:144-146` mit `core.viewSessionUnavailable` (Text passt auch für einen Tab; kein neuer Key).
- **Test** (`src/main/window-ipc.test.ts`, neu, nur `moveSession`): Fake-Owner, dessen `transferOwner` `ssh.notAvailable` wirft → `status: 'closed'` ohne `session`; Fake mit `connected` → Ergebnis mit `session`. Vorher: rejects.

### #12 Events mischen Kinds – bestätigt

- `src/main/kubernetes/client-api.ts:369`: Selector ohne `involvedObject.kind`; Deployment und ReplicaSet gleichen Namens teilen sich Events.
- **Lösung:** `involvedObject.kind=${KIND_INFO[ref.kind].kind},` voranstellen (Tabelle wie `headerOf`, `:122-126`).
- **Test** (`client-api.test.ts`, `fakeClient.list`-Spy `:323`): `eventsFor({ kind: 'pods', namespace: 'shop', name: 'web' })` → Field-Selector enthält `involvedObject.kind=Pod`. Vorher: fehlt.

### #13 Kubeconfig-Suche scheitert an Login-Banner – bestätigt

- `src/main/kubernetes/access.ts:59-61`: erste Zeile = Header; `sh -lc` lädt Login-Profile mit Ausgabe → `kubernetes.kubeconfigSearchFailed` (`:77`).
- **Lösung:** `const lines = probe.stdout.split('\n'); const index = lines.findIndex(line => line.startsWith('src:')); const header = index === -1 ? '' : lines[index].replace(/\r$/, ''); const body = index === -1 ? '' : lines.slice(index + 1).join('\n');` Rest unverändert.
- **Test** (`access.test.ts`, `fakeHost`): `ok('Welcome to Ubuntu\nsrc:/home/admin/.kube/config\n' + CONFIG_YAML)` → `source` `/home/admin/.kube/config`, `text` = YAML. Vorher: rejects `kubeconfigSearchFailed`.

### #14 Speichern rast mit Sperren/Entsperren – bestätigt

- `session.ts:100`: `return this.getSnapshot()` nach den `await`s; `lock()` dazwischen → `core.vaultLocked`, obwohl geschrieben wurde; `unlock()` eines anderen Vaults dazwischen → fremder Snapshot als Ergebnis.
- **Lösung:** `return { filePath, vault: structuredClone(updatedVault) };` aus lokalen Werten. Die Zuweisungen an `session` bleiben (bei gesperrter Session landen sie in einem toten Objekt).
- **Test** (`session.test.ts`): `writeEncryptedVaultFile` per `vi.mock('./storage')` so stubben, dass es vor dem Auflösen `manager.lock()` ruft → `save` resolves mit dem geschriebenen Vault. Vorher: rejects `core.vaultLocked`.
- Gleiche Datei wie #7 → eine Aufgabe.

### #15 `lastVault` veraltet nach Umbenennen der Endung – bestätigt

- `src/main/vault/ipc.ts:190-209`: `save` kann `name` → `name.term` umbenennen (`storage.ts:38`); `lastVault.set` nur bei `unlock` (`:180`) und Anlegen (`:114`).
- **Ruling:** Nach erfolgreichem `save` immer `await lastVault.set(result.filePath)` – eine Zeile; `LastVaultFile.set` ist best effort (`last-vault.ts:22`), schreibt 40 Byte, Saves sind Nutzeraktionen. Kein Vergleich mit dem vorherigen Pfad.
- **Test:** keiner (`vault/ipc.ts` ohne Testharness, zieht Electron). Abnahme in `run-app`: Vault `demo2` ohne Endung anlegen, speichern, `profile/last-vault.json` zeigt `demo2.term`.

### #16 Verbindungstest läuft während des Hostkey-Dialogs in den Timeout – bestätigt

- `src/main/connection-test.ts:105`: 15-s-Timer läuft, während `verifyHost` (`:120`) den Dialog zeigt; `fail` → `finish` → `isActive()` falsch → `verify` bricht ab (`known-hosts.ts:51`). Zusätzlich `readyTimeout: TIMEOUT` (`:130`) in ssh2 selbst würde während des Dialogs feuern (`client-config.ts:31` nutzt 120 s, `containers/runner.ts:39` begründet es).
- **Lösung:** `let timer`; im Hostkey-Callback `clearTimeout(timer)`; nach `verifyHost` (then **und** catch) `if (!finished) timer = setTimeout(…, timeout)`; `readyTimeout: 120_000`. Timeout als optionale Abhängigkeit `timeout?: number` in `ConnectionTestDependencies` (Default 15 000), derselbe Test-Zugang wie `createClient`.
- **Test** (`connection-test.test.ts`, echter ssh2-Server): `timeout: 300`, `verifyHost` wartet 600 ms und liefert `true` → alle Schritte `ok`. Vorher: `hostKey` fehlgeschlagen.

### #17 Pod-Terminal verbirgt Ursache – bestätigt

- `src/main/ssh/session.ts:428`: nur `KubeApiError` behält den Code; `AppError`s aus `kubernetes/session.ts` (`kubernetes.readOnly`, `notConnected`, `reconnecting`, `disabled`, `ended`) werden `ssh.podTerminalFailed`.
- **Lösung:** `throw error instanceof AppError ? error : error instanceof KubeApiError ? AppError.from(error.coded) : new LocalShellError('ssh.podTerminalFailed');` (`LocalShellError extends AppError`, `:115`; der Aufrufer behandelt `AppError` generisch, `:119`).
- **Test** (`ssh/session.test.ts:555-570` erweitern): `failure = new AppError('kubernetes.readOnly')` → Status-Fehler `kubernetes.readOnly`; `new Error('boom')` bleibt generisch. Vorher: `ssh.podTerminalFailed`.

### #18 Sprach-Speichern scheitert still – bestätigt

- `src/main/app-settings.ts:26-31` schluckt; `src/main/locale.ts:27-32` setzt Zustand und benachrichtigt trotzdem.
- **Lösung:** `writeAppSettings` gibt `boolean` zurück (`catch { return false; }`). `LocaleStore.set`: zuerst schreiben; `if (this.file && !writeAppSettings(...)) throw new AppError('core.settingsWriteFailed');` **vor** der Zustandsänderung – Fenster bleiben bei der alten Sprache; `LanguageSetting.tsx:20` zeigt den Fehler schon (`setFailure(errorText(error))`).
- **Katalog:** `core.settingsWriteFailed`.
- **Test** (`locale.test.ts`): `settingsFile` in nicht existierendem Ordner → `set('en-US')` wirft `core.settingsWriteFailed`, `get()` unverändert, kein Listener. `app-settings.test.ts:44` ergänzt um `toBe(false)`. Vorher: kein Wurf, Listener gerufen.

### #19 `App.tsx` mischt vier Aufgaben, `persistVault` ungetestet – bestätigt

- `src/renderer/src/App.tsx:466-495`: Optimistic Update, Rollback, Retry-Hinweise; `saveInProgress` (`:149`) und `vaultRef` (`:172`) nur hierfür. Vierzehn Aufrufer (`:460` … `:912`) brauchen `selectedNode`, `terminals`, Editor-Zustand aus `App`.
- **Ruling Zuschnitt:** Neuer Hook `src/renderer/src/hooks/usePersistVault.ts` mit **nur** `persistVault`; die Aufrufer bleiben. Verhalten unverändert (gleiche `set*`-Reihenfolge, Texte, Retry-Regeln). `busy`/`saved` bleiben in `App` (auch für Lock/Laden genutzt) und gehen als Setter hinein.

  ```ts
  export interface PersistDeps { vault: () => Vault | null; setVault; setVaultPath; setBusy; setSaved; save: (vault: Vault) => Promise<VaultSessionResult>; t: TFunction }
  export function persistVaultWith(deps: PersistDeps, inProgress: { current: boolean }, updatedVault: Vault, failureTitle?: string): Promise<boolean>  // pure, tested
  export function usePersistVault(...): (updatedVault: Vault, failureTitle?: string) => Promise<boolean>  // refs + useT + window.desktopApi
  ```

  `notify` wie in `App.tsx:98` aus dem Modul-Import. `updateNode`/`upsertWorkspace` sind schon in Gebrauch (`:20`).
- **Test** (`hooks/usePersistVault.test.ts`, nur `persistVaultWith`, kein DOM): Erfolg → `setVault(result.vault)`, `setVaultPath`, `setSaved(true)`, `true`; Fehler → `setVault(previous)`, `false`, `notify.error` mit Retry; Retry bei verändertem Vault → `notify.info` `retryChanged`, kein zweiter `save`; `inProgress` → sofort `false`. Vorher: Modul existiert nicht.

### #20 Toter Code und Duplikate – bestätigt mit Einschränkungen

| Punkt | Befund | Entscheidung |
|---|---|---|
| npm-Dependency `crypto` (`package.json:41`) | Platzhalter, Code nutzt `node:crypto` | `npm uninstall crypto` |
| `loadVault` (`storage.ts:131`) | nur `storage.test.ts:65,95,108` | löschen; Tests nutzen `readEncryptedVaultFile` + Test-Helfer |
| `decryptVault` (`crypto.ts:166`) | nur Tests | nach `src/test/vault-helpers.ts` (siehe #25) |
| `SudoWatcher.armed` (`sudo.ts:26`) | ungenutzt | löschen |
| `SudoWatcher.holding` (`sudo.ts:27`) | **`sudo.test.ts:44-93` nutzt es** | bleibt |
| `SudoRejections.clear` (`sudo-rejections.ts:51`) | nur `sudo-rejections.test.ts:66` | löschen samt Testzeile |
| `formatLocale` (`format.ts:14`) | `format.test.ts`, `i18n.test.ts` | **bleibt** – drei Zeilen, Ersatz kostet mehr |
| zod-`parse` ×5 (`ai/ipc.ts:21`, `files/ipc.ts:56`, `rdp/ipc.ts:22`, `window-ipc.ts:55`, `ssh/validation.ts:15`) | identisch bis auf Fehlercode | `ssh/validation.ts` → `parseRequest(schema, value, code: ErrorCode = 'ssh.invalidRequest')`; die vier anderen importieren es mit ihrem Code |
| `ipcMessage` (`container-tree.ts:87`), `ipcErrorText` (`file-browser.ts:100`) | reine Weiterleitung, 17 Aufrufer | löschen; Aufrufer rufen `errorText(error, fallback)`, bei `ipcErrorText` ohne Fallback `t('files:actionFailed')` am Aufruf |
| `FilesPanel.tsx:54` Prefix-Regex | dupliziert `error-text.ts:4` | `IPC_PREFIX` exportieren und importieren |
| `preload/index.ts:68,79` | duplizieren `subscribe()` (`:13`) | `onSshEvent: listener => subscribe('ssh:event', listener)` usw. |
| stderr-Kürzung ×2 (`parsers.ts:74-77`, `access.ts:38-40`) | drei gleiche Zeilen, andere Codes | **bleibt** – Helfer brächte eine Zeile gegen zwei Importe |
| `preload/index.ts:19` | `LOCALE_ARG` in `shared/locale.ts:8` | importieren |

Kein Test; Guard sind `typecheck`, `vitest` und `i18n-catalog.test.ts` (verwaiste Keys).

---

## Small

### #21 KI-Fehlerdetail über 500 Zeichen – bestätigt

- `src/main/ai/assistant.ts:70`: `codedFrom(error, 'ai.requestFailed')` ohne `limitError` (`shared/errors.ts:20`).
- **Lösung:** `error: limitError(codedFrom(error, 'ai.requestFailed'))`.
- **Test** (`src/main/ai/assistant.test.ts`, neu): `stream` wirft `Error('x'.repeat(2000))` → `emit`-Fehler `detail.length <= 500`. Vorher: 2000.

### #22 Drag-Vorschau bleibt in anderen Fenstern – bestätigt

- `SplitTerminalArea.tsx:75-92`: rAF-Schleife über `external.current`; `cancelDrag` (`:170-178`) räumt auf, läuft aber nicht beim Unmount.
- **Lösung:** `const cancelRef = useRef(cancelDrag); cancelRef.current = cancelDrag; useEffect(() => () => cancelRef.current(), []);`
- Kein Test (Komponente); Abnahme: Review.

### #23 `lockVault().then(...)` ohne `catch` – bestätigt

- `App.tsx:275`; `lockVault` (`:614-625`) räumt im `finally` lokal auf, aber wenn `desktopApi.lockVault()` wirft, bleibt die Promise unbehandelt und `setScreen('open')`/`setSelectedVaultPath` laufen nicht.
- **Lösung:** `void lockVault().catch(() => {}).then(() => { setScreen('open'); setSelectedVaultPath(filePath); });` – der Main-Fehler beim Sperren ist fürs Öffnen irrelevant, lokal ist schon gesperrt.
- Gleiche Datei wie #19 → eine Aufgabe; kein eigener Test.

### #24 Zahlen in `{{count}}` nicht lokalisiert – bestätigt

- 37 Keys mit `{{count}}` (z. B. `files:queue.skipped`, `kubernetes:problems.count`), dazu `{{done}}`, `{{opened}}`; i18next interpoliert `1000` roh.
- **Ruling:** kein Plugin, keine Katalogänderung, kein `formatNumber` an 37 Stellen. Ein Interpolations-Hook in `src/renderer/src/i18n.ts` (i18next 26.5.2 liefert `interpolationkey`, `node_modules/i18next/dist/esm/i18next.js:1212`):

  ```ts
  const COUNT_KEYS = new Set(['count', 'done', 'opened']);
  interpolation: { escapeValue: false, alwaysFormat: true,
    format: (value, _format, _lng, options) => COUNT_KEYS.has(options?.interpolationkey ?? '') && typeof value === 'number' ? formatNumber(value) : value },
  ```

  Nur Zähl-Platzhalter, damit `{{port}}` (2222) und `{{exit}}` roh bleiben. `formatNumber` aus `format.ts`. Pluralwahl bleibt unberührt. Main braucht nichts (`main.json`/`errors/*` ohne `{{count}}`).
- **Test** (`i18n.test.ts`): `t('files:queue.skipped', { count: 1000 })` → „1.000 übersprungen“, nach `changeLanguage('en-US')` „1,000 skipped“; ein Key mit `{{port}}` bleibt „2222“. Vorher: „1000“.

### #25 `EncryptedVaultFileSchema` zweimal beim Entsperren – bestätigt

- `storage.ts:110` und `crypto.ts:187` (`unlockVault(input: unknown)`).
- **Lösung:** `unlockVault(file: EncryptedVaultFile, password)` ohne Parse; `readEncryptedVaultFile` bleibt die Prüfstelle (`storage.test.ts:35`, `migration-backup.test.ts:58` verlassen sich darauf). `decryptVault` wird Test-Helfer in `src/test/vault-helpers.ts` mit eigenem `safeParse` + `core.vaultFileCorrupt` (`crypto.test.ts:29`).
- Kein Test (keine beobachtbare Verhaltensänderung); Guard ist der Typ.

---

## Dateien, Konflikte, Wellen

| Datei | Befunde |
|---|---|
| `files/file-system.ts`, `files/transfer.ts` (+test), `files/remote-edit.ts` (+test), `files/ipc.ts`, `errors/files.json` de/en | #1, #2, #3 (und #20 `parse` in `files/ipc.ts`) |
| `vault/storage.ts`, `vault/crypto.ts`, `src/test/vault-helpers.ts`, Vault-Tests, `package.json` | #4, #25, #20 |
| `vault/session.ts` (+test), `vault/ipc.ts` | #7, #14, #15 |
| `.claude/skills/run-app/{driver.mjs,demo-setup.mjs,SKILL.md}` | #5 |
| `rdp/host.ts` (+test), `native/Shellherd.RdpHost/Program.cs` | #6 |
| `AssistantPanel.tsx`, `terminal-access.ts` (+test), `assistant.json`, `main.json` de/en | #8, #9, #10 |
| `window-ipc.ts` (+neuer Test) | #11 (und #20 `parse`) |
| `kubernetes/client-api.ts`, `kubernetes/access.ts`, `ssh/session.ts` (+tests) | #12, #13, #17 |
| `connection-test.ts`, `app-settings.ts`, `locale.ts` (+tests), `errors/core.json` de/en | #16, #18 |
| `App.tsx`, `hooks/usePersistVault.ts` (+test), `SplitTerminalArea.tsx`, `i18n.ts` (+test) | #19, #22, #23, #24 |
| `ai/assistant.ts` (+neuer Test) | #21 |
| `ai/ipc.ts`, `rdp/ipc.ts`, `ssh/validation.ts`, `container-tree.ts`, `file-browser.ts`, `FilesPanel.tsx`, `error-text.ts`, `preload/index.ts`, `containers/sudo.ts`, `sudo-rejections.ts` | #20 Rest |
| `CHANGELOG.md`, `CHANGELOG.en.md`, `package.json` (Version), `docs/handbuch.md`, `docs/manual.md` | Doku |

Konflikte: `files/ipc.ts` (#2 vs. #20), `window-ipc.ts` (#11 vs. #20) → #20-Rest in eigene Welle. `storage.ts`/`crypto.ts` (#4, #25, #20), `session.ts` (#7, #14), `App.tsx` (#19, #23), `AssistantPanel.tsx` (#8–#10) → je eine Aufgabe. Katalogdateien disjunkt: #1 `errors/files.json`, #18 `errors/core.json`, #8 `assistant.json` + `main.json`.

**Welle 1 (parallel, disjunkte Dateien):**

| Task | Befunde |
|---|---|
| A Dateien | #1, #2, #3 |
| B Vault-Speicher | #4, #25, #20 (`loadVault`, `decryptVault`, `crypto`-Dependency) |
| C Vault-Session | #7, #14, #15 |
| D RDP | #6 |
| E Assistent | #8, #9, #10 |
| F Fenster | #11 |
| G Kubernetes | #12, #13, #17 |
| H Verbindungstest/Einstellungen | #16, #18 |
| I Renderer | #19, #22, #23, #24 |
| J KI + Skill | #5, #21 |

Keine Abhängigkeiten in Welle 1 (B ändert die Signatur von `unlockVault` auf `EncryptedVaultFile`; `session.ts:43-45` liefert das bereits, C bleibt kompatibel).

**Welle 2 (eine Aufgabe):** K Duplikate (#20 Rest: `parseRequest`, `errorText`-Wrapper, `IPC_PREFIX`, preload, `LOCALE_ARG`, `armed`, `clear`) – berührt `files/ipc.ts` und `window-ipc.ts` aus A und F.

**Welle 3:** L Doku und Version (CHANGELOG de/en, `package.json` 0.12.1, Handbuch/Manual), dann `npm run typecheck`, `npx vitest run`, `run-app`-Abnahme (#15-Schritt; Download einer Datei `a:b` vom Testserver → übersprungen bzw. Fehlerkarte; `.sh` im Dateibereich → Notepad; `/eval` ohne Token → 403).

Prüfer-Stufe nach Welle 3 über alles.

## Neue Katalog-Keys (de-DE und en-US)

| Key | de | en | Befund |
|---|---|---|---|
| `errors` `files.unsafeName` | Der Dateiname „{{name}}“ ist unter Windows nicht erlaubt. | The file name “{{name}}” is not allowed on Windows. | #1, #2 |
| `errors` `core.settingsWriteFailed` | Die Einstellungen konnten nicht gespeichert werden. | The settings could not be saved. | #18 |

Geänderte Texte: `assistant:panel.hint1`, `assistant:panel.hint2`, `main` `assistant.prompt.command` (#8). Keine Keys fallen weg.

## Doku und Version

- **0.12.1**, 2026-10-20, in `package.json`, `CHANGELOG.md`, `CHANGELOG.en.md` (gleiche Eintragszahl, Backticks nur für Code, vgl. `version.test.ts`). Einträge:
  1. Behoben: Downloads aus der Dateiansicht landen nur im gewählten Zielordner; Namen, die Windows nicht speichern kann (`\`, `:`, Gerätenamen, Punkt oder Leerzeichen am Ende), werden übersprungen oder mit Hinweis abgelehnt.
  2. Behoben: Beim Überschreiben bleibt die alte Datei erhalten, bis die neue vollständig angekommen ist.
  3. Geändert: `Bearbeiten` öffnet nur Text- und Konfigurationsdateien im Standardprogramm; Skripte und alles andere in Notepad, auch lokal.
  4. Geändert: Der KI-Assistent tippt Befehle nicht mehr selbst ein; `Eintippen` schreibt den Vorschlag in die Eingabezeile.
  5. Behoben: Die Vault-Datei wird vor dem Umbenennen auf die Platte geschrieben; Speichern während des Sperrens liefert kein falsches Ergebnis; nach dem Anhängen von `.term` merkt sich Shellherd den neuen Pfad.
  6. Behoben: Fehlgeschlagene RDP-Verbindungen zeigen den Fehler statt dauerhaft „Verbindet“.
  7. Behoben: Verschieben einer Ansicht in ein anderes Fenster lässt keine Sitzung zurück, wenn eine davon gerade endete.
  8. Behoben: Cluster-Ansicht zeigt nur die Ereignisse des gewählten Objekts; Kubeconfig-Suche funktioniert trotz Login-Banner; das Pod-Terminal nennt die Ursache.
  9. Behoben: Der Verbindungstest wartet, solange der Server-Schlüssel-Dialog offen ist; die Spracheinstellung meldet, wenn sie nicht gespeichert werden kann.
  10. Behoben: Zahlen in Meldungen folgen der Sprache (z. B. „1.000 Einträge“); die Drag-Vorschau verschwindet beim Schließen eines Fensters.
- **Handbuch** (`docs/handbuch.md`, `docs/manual.md`): ein Satz im Abschnitt Dateiansicht zur Allow-Liste („Nur Text- und Konfigurationsdateien öffnen im Standardprogramm, alles andere in Notepad.“). Der Assistent ist dort nicht mit Auto-Tippen beschrieben → nichts.
- **SKILL.md**: Token-Absatz (#5).

## Bewusst weggelassen

- Keine Einstellung „automatisch eintippen“ (#8) – die Lücke als Option wäre keine Behebung.
- Kein `posix-rename@openssh.com`, keine `.part`-Aufräumlogik beim Start (#3) – eine `.part` nach Absturz sieht und löscht der Nutzer.
- Kein Umbau der `persistVault`-Aufrufer (#19) – nur die Speicherlogik wird testbar.
- `lastStderrLine`-Helfer, `formatLocale`, `SudoWatcher.holding` bleiben (#20) – Löschen kostet mehr als es bringt.
- Keine Unit-Tests für #5, #8, #9, #15, #20, #22, #23, #25 – Skill-Skript, reine UI-Handler ohne DOM-Harness oder Doppelung ohne beobachtbares Verhalten; je ein Abnahmeschritt (Review oder `run-app`).
- Keine Änderung an `encryptVaultWithKey` (#7); `unlockVault`-Signatur nur für den Typ (#25).
- Keine Minor-Version: nichts ist neu.
