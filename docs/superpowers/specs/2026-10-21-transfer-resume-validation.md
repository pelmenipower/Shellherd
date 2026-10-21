# Übertragungen fortsetzen – Validierung (Stufe 3, bindend)

Spec: `docs/superpowers/specs/2026-10-21-transfer-resume-design.md`, Plan: `docs/superpowers/plans/2026-10-21-transfer-resume.md`. Dieser Anhang geht Spec und Plan vor. N1–N5 und S1–S4 gelten unverändert.

**Urteil: ready after corrections.** 2 Blocker, 12 Korrekturen, 9 offene Risiken.

Ausgangslage geprüft: `npm run typecheck` grün, `npx vitest run` 131 Dateien / 1877 Tests grün (Stand `4a17524`). Zeilenangaben der Spec stimmen in Stichproben (`transfer.ts:113-142`, `sftp-session.ts:228-284, 301-356`, `ipc.ts:20-36, 93, 121-123`, `FilesPanel.tsx:140-144, 242-255, 353-379`, `files-ui.css:88`, `SFTP.js:3655-3970`).

## Prüfergebnisse zum Schwerpunkt

| Frage | Ergebnis |
|---|---|
| 1-MB-Vergleich, Größe, mtime | Korrekt. `part.size > item.size` oder `item.modified > part.modified + 1000` → neu. Bei `.part` < 1 MB wird die ganze `.part` verglichen, ein Treffer ist dann ein exaktes Präfix. Bei ≥ 1 MB bleibt der Bereich vor dem letzten MB ungeprüft (Risiko R1). |
| Teil = 0 | Kein Vergleich, `'w'` kürzt, kein Hinweis. Korrekt. |
| Teil ≥ Quelle | `>` → neu. `=` → `offset = size`, Lesen ab EOF liefert sofort Ende (Node und ssh2: `toRead <= 0` bzw. EOF-Status), `r+` öffnet ohne Kürzen, danach Rename. Korrekt. |
| Quelle wächst | Während des ersten Laufs: Das Präfix bleibt gültig, und ein späteres Anhängen macht die Quelle neuer als die `.part`, also beginnt es neu. Wächst sie zwischen Plan und Tail-Lesen, bleibt `part.size ≤ item.size` erfüllt, und die Bytes vor `part.size` sind dieselben. Korrekt. |
| Fremde `x.part` | Passt sie nicht, wird sie gelöscht. Heute wird sie mit `'w'` gekürzt, beides ist endgültig, das Risiko steigt also nicht. **Neu und gefährlich:** Ein **Ordner** `x.part` wird in `job.partial` gemeldet. „Teildatei verwerfen“ ruft `sftpDelete` → `removeRemote` auf, und das löscht **rekursiv** (`sftp-file-system.ts:39`, `sftp-session.ts:174-180`). Siehe Blocker B1. |
| `'r+'` mit `start` | Lokal: `createWriteStream` mit `flags 'r+'` und `start` schreibt per `pwrite` an der Position. ssh2: `start` setzt `pos`, jede WRITE-Anfrage trägt den absoluten Offset. `_write` wartet auf die Bestätigung, große Chunks gehen als Folge-WRITEs erst nach dem Ack raus (`SFTP.js:422-490`). Nur `_writev` schickt gepufferte Chunks gleichzeitig. Durch den Backpressure der Pipeline (Writable-hwm 16 KiB) sind höchstens zwei Chunks zu je 256 KiB unterwegs. **Folge:** Eine Lücke durch umsortierte WRITEs liegt immer in den letzten ≤ 512 KiB und damit im geprüften letzten MB. Liest sie sich als Nullen und ist die Quelle dort ebenfalls 0, ist der Inhalt trotzdem richtig. R12 der Spec ist damit abgedeckt und kein offenes Risiko mehr. |
| `doneBytes` | `before` wird vor dem Offset gelesen, `+= offset`, der Zähler zählt nur gestreamte Bytes, am Ende `before + item.size`. Korrekt. Die Rate sieht nur gestreamte Chunks, ist also korrekt ab Offset. |
| Löschen trotz Fehler | Bei `keepPartial` bleibt die `.part` im `catch` stehen. Es löschen weiterhin: (a) der Ausweichpfad, wenn das alte Ziel überlebt (`transfer.ts:136`), dann ist der Fehler gewollt, `job.partial` muss aber geleert werden; (b) das Verwerfen nach N4. **Neu und gefährlich:** Verschwindet die `.part` vor dem Rename, etwa durch „Verwerfen“ an einer alten Zeile, während ein neuer Job dieselbe `.part` schreibt, scheitert der Rename. Der Ausweichpfad löscht dann das **alte Ziel** (`transfer.ts:133`), und es bleibt keine Datei übrig. Siehe K3 und K7. |
| Auto-Upload | Unverändert richtig. Ohne `keepPartial` wird gelöscht, der Neustart-Schutz bleibt. Der Fake in `auto-upload.test.ts:25-32` legt die `.part` erst in `final` an, dadurch findet der Neustart keine `.part`. |
| Verwerfen lokal | Läuft über `localDelete` → `shell.trashItem`, also identisch mit dem bestehenden lokalen Löschen. Konsistent. Der automatische Neustart nach N4 löscht dagegen per `unlink`, wie heute das Kürzen mit `'w'`. |
| Retry, IPC | Dieselbe `sftpTransfer`-Anfrage geht durch `TransferSchema` (`ipc.ts:28-31`). Das Schema prüft die Pfade erneut. Die Pfade sind dieselben, die der Renderer heute schon schicken darf. Damit kein neuer Vertrauensweg. **Lücke:** Bei Verschieben-Jobs mit mehreren Quellen sind die fertigen Quellen gelöscht. `planTransfer` wirft dann `files.sourceNotFound` (`transfer.ts:50-51`), der ganze Job scheitert. Spec 4.4 irrt hier. Siehe K5. |
| Konfliktdialog | Er erscheint beim Fortsetzen für fertige Dateien. Mit „Nur wenn neuer“ und „Für alle“ werden sie übersprungen. Die angefangene Datei hat kein Ziel und läuft ohne Frage weiter. Hatte sie schon ein altes Ziel, kommt die Frage erneut. Korrekt. |
| Verbindungsverlust | Der Dialog bleibt im Renderer offen (`conflict`-State), obwohl der Main ihn mit `cancel` aufgelöst hat (`sftp-session.ts:351`). Das ist heute schon so. Mit der Jobmarkierung in `report()` muss er mit geschlossen werden (K7). |
| Regeln | i18n: `files.connectionLost` passt ins Katalogformat (`errors/files.json` mit genau dem Schlüssel `files`, Regel e). Die Orphan-Regel (d) findet `'files.connectionLost'` als Literal. Keine Tokens, kein CSS, keine Bewegung. `.transfer-job button` und `.secondary-button` reichen. |
| Tests | Der Rate-Test `transfer.test.ts:52-65` erwartet genau 5 `progress`-Aufrufe. Der zusätzliche `hooks.progress(job)` der Spec macht daraus 6 und verschiebt die Zeitachse. **Welle 1 wäre rot**, siehe Blocker B2. Der Loopback-Abbruchtest („32 MB, erstes Event mit `doneBytes > 0`“) hängt vom Timing ab: Bei mehr als 100 MB/s ist der Upload fertig, bevor der Abbruch ankommt. Siehe K10. run-app: Mit 256 MB, Abbruch nach sichtbarer Rate und erneutem Warten auf die Rate ist das Fenster bei schnellem Loopback unter 0,5 s. Siehe K11. |

## 1. Vertrag (bindend, exakt)

### `src/shared/sftp.ts` – `TransferJob`, nach `bytesPerSecond`

```ts
  /** Absolute paths on the source side as requested; moved top-level files leave the list. Absent for auto-upload. */
  sources?: string[];
  /** Target-side path of the half-written .part: set while a file is copied, kept after a cancel or failure, absent after the swap. */
  partial?: string;
  /** Bytes a leftover .part already held when the copy continued. */
  resumedFrom?: number;
  /** A leftover .part did not match the source and was discarded; the copy started over. */
  restarted?: boolean;
```

### `src/main/files/file-system.ts` – Schnittstelle und lokale Umsetzung

```ts
  /** `start`/`end` select a byte range, `end` inclusive like Node; both optional. */
  read: (path: string, start?: number, end?: number) => Readable;
  /** Servers set `mode` on new and existing files alike (default 0644), so pass the old mode when overwriting; this computer ignores it.
   *  `start` > 0 continues an existing file at that offset (`r+`), otherwise the file is created or truncated. */
  write: (path: string, mode?: number, start?: number) => Writable;
```
```ts
  read: (path, start, end) => createReadStream(path, { highWaterMark: 256 * 1024, start, end }),
  write: (path, _mode, start) => createWriteStream(path, start ? { flags: 'r+', start } : {}),
```

### `src/main/files/sftp-file-system.ts`

```ts
    read: (path, start, end) => sftp.createReadStream(path, { highWaterMark: 256 * 1024, start, end }),
    write: (path, mode, start) => sftp.createWriteStream(path, { mode: mode ?? 0o644, ...(start ? { flags: 'r+', start } : {}) }),
```

### `src/main/files/transfer.ts`

`TransferHooks` bekommt:
```ts
  /** Keep a half-written .part after a cancel or failure so a later run can resume it; the queue keeps, auto-upload removes. */
  keepPartial?: boolean;
```
`TAIL_BYTES`, `readRange` und `resumable` übernimmst du wörtlich aus Spec 3.2. In `runTransfer` folgt direkt auf `if (job.move) await from.removeFile(item.source);` (102):
```ts
    // A resumed move must not ask for sources that are already gone.
    if (job.move && job.sources) job.sources = job.sources.filter(source => source !== item.source);
```
`copyFile` ab Zeile 122 bis zum Ende, endgültig:
```ts
  // shortcut: a real file named x.part is taken for ours (resumed when it matches, removed otherwise); upgrade when someone reports it.
  const partial = `${target}.part`;
  const part = await to.stat(partial);
  // A folder named x.part is never ours; discarding it would delete it recursively.
  if (part && part.type !== 'file') throw new FileError('files.existsAsDirectory', { name: to.basename(partial) });
  let offset = 0;
  if (part && part.size > 0) {
    if (await resumable(from, item, to, partial, part)) { offset = part.size; job.resumedFrom = offset; }
    else { await to.removeFile(partial); job.restarted = true; }
  }
  checkAborted(signal);
  job.partial = partial;
  if (offset) { job.doneBytes += offset; hooks.progress(job); }
  try {
    await pipeline(from.read(item.source, offset), counter, to.write(partial, mode, offset), { signal });
  } catch (error) {
    if (!hooks.keepPartial) { await to.removeFile(partial).catch(() => {}); job.partial = undefined; }
    if (signal.aborted) throw new TransferCanceled();
    throw error;
  }
  // Local rename replaces the target; OpenSSH SFTP refuses an existing one, so it is removed first there.
  await to.rename(partial, target).catch(async (error: unknown) => {
    // The .part is gone (removed elsewhere): the old target must survive.
    if (!await to.stat(partial).catch(() => null)) throw error;
    await to.removeFile(target).catch(() => {});
    await to.rename(partial, target).catch(async (retryError: unknown) => {
      // The old file survived (e.g. locked): drop the copy. Otherwise `.part` is the only copy and stays.
      if (await to.stat(target).catch(() => null)) { await to.removeFile(partial).catch(() => {}); job.partial = undefined; }
      throw retryError;
    });
  });
  job.partial = undefined;
  // Files that changed size while copying still count once.
  job.doneBytes = before + item.size;
```
Hinweise: `resumedFrom` und `restarted` gelten für den ganzen Job, der letzte Wert zählt. `checkAborted` steht vor `job.partial`. Ein Abbruch während der Prüfung hinterlässt so keine leere `.part` und meldet keinen Pfad.

### `src/main/files/sftp-session.ts`

- `Job.sources` (44) **bleibt**, `pump` (266) liest weiter `entry.sources`. Die Spec hatte „entfällt“ vorgesehen, das wird hiermit überstimmt: Der Diff wird kleiner, und `job.sources` darf durch K5 schrumpfen, ohne den laufenden Plan zu berühren.
- Job-Literal (232-234) bekommt `sources: [...request.sources]`.
- Hooks in `pump` (268-271): `keepPartial: true` neben `progress` und `conflict`.
- `finish`, `cancel`, `state`, `clearFinished` und `ipc.ts` bleiben unverändert.

### `src/renderer/src/components/FilesPanel.tsx`

- `report()` (140-144):
  ```ts
  if (next === 'closed' || next === 'error') {
    setEndedAt(Date.now());
    // The main process cannot report jobs of a dead session; whatever ran or waited has stopped.
    setJobs(current => current.map(job => isFinished(job) ? job
      : { ...job, state: 'error', error: { code: 'files.connectionLost' }, current: undefined, bytesPerSecond: undefined }));
    setConflict(null);
  }
  ```
- `reconnect()` (255): `setJobs([])` entfällt, alles andere bleibt.
- Neu, neben `transfer`:
  ```ts
  const resume = (job: TransferJob): void => {
    if (!remoteReady || !job.sources?.length) return;
    setJobs(current => current.filter(item => item.id !== job.id));
    transfer(job.direction === 'upload' ? 'local' : 'remote', job.sources, job.move, job.targetDir);
  };
  const discardPartial = (job: TransferJob): void => {
    const path = job.partial;
    if (!path) return;
    const side: FileSide = job.direction === 'upload' ? 'remote' : 'local';
    void run(() => side === 'remote' ? window.desktopApi.sftpDelete({ sessionId: sessionId!, paths: [path] }) : window.desktopApi.localDelete({ paths: [path] }), side)
      .then(done => { if (done) setJobs(current => current.map(item => item.id === job.id ? { ...item, partial: undefined } : item)); });
  };
  ```
- `TransferQueue` hat die Props `{ jobs, activeCount, canResume, onCancel, onClear, onResume, onDiscard }`. Der Aufruf (336) übergibt `canResume={remoteReady} onResume={resume} onDiscard={discardPartial}`. Die Knöpfe stehen nach dem Abbrechen-Knopf (374):
  ```tsx
  {isFinished(job) && job.state !== 'done' && !!job.sources?.length && <button type="button" className="secondary-button" disabled={!canResume}
    title={canResume ? undefined : t('files:sync.notConnected')} onClick={() => onResume(job)}>{t('files:queue.resume')}</button>}
  {isFinished(job) && job.partial && <button type="button" className="secondary-button" disabled={activeCount > 0 || (job.direction === 'upload' && !canResume)}
    title={job.partial} onClick={() => onDiscard(job)}>{t('files:queue.discardPartial')}</button>}
  ```
  Die Statuszeile bekommt nach `skipped` (370) zwei Zeilen:
  ```tsx
  {!!job.resumedFrom && ` · ${t('files:queue.resumedFrom', { size: formatSize(job.resumedFrom) })}`}
  {job.restarted && ` · ${t('files:queue.restarted')}`}
  ```
  `TransferJob` und `FileSide` sind im File bereits importiert, `formatSize` ebenso. Ein fehlender Import wird ergänzt, und es kommt keine neue Datei dazu.

### Texte (wörtlich)

`src/shared/locales/<locale>/files.json`, unter `queue` nach `skipped`:

| Key | de-DE | en-US |
|---|---|---|
| `queue.resume` | Fortsetzen | Resume |
| `queue.discardPartial` | Teildatei verwerfen | Discard partial file |
| `queue.resumedFrom` | fortgesetzt ab {{size}} | resumed at {{size}} |
| `queue.restarted` | Teildatei passte nicht, neu begonnen | partial file did not match, started over |

`src/shared/locales/<locale>/errors/files.json`, unter `files`:

| Key | de-DE | en-US |
|---|---|---|
| `connectionLost` | Die Verbindung wurde getrennt. | The connection was lost. |

Für einen `.part`-Ordner gibt es keinen neuen Key. Es gilt der vorhandene `files.existsAsDirectory`: „„x.part“ existiert im Ziel bereits als Ordner.“

## 2. Blocker

- **B1 – Verwerfen löscht einen Ordner `x.part` rekursiv** (`transfer.ts` Spec 3.2 setzt `job.partial` ohne Typprüfung; `sftp-session.ts:174-180` → `removeRemote` rekursiv; lokal `shell.trashItem` verschiebt den ganzen Ordner).
  - Fehlerszenario: Im Zielordner liegt ein Ordner `backup.tar.part`. Der Upload von `backup.tar` scheitert beim Öffnen mit EISDIR, die Zeile zeigt „Teildatei verwerfen“, und der Klick löscht den fremden Ordner samt Inhalt endgültig vom Server.
  - Fix: K1. Ist die `.part` vorhanden und keine Datei, wirft `copyFile` `files.existsAsDirectory`, bevor `job.partial` gesetzt wird.
- **B2 – Welle 1 rot durch einen zusätzlichen `progress`-Aufruf** (`transfer.test.ts:60`, `toHaveLength(5)`, Zeitachse +600 ms je Aufruf).
  - Fehlerszenario: Spec 3.2 ruft `hooks.progress(job)` vor jedem Stream auf. Der Rate-Test bekommt 6 Werte, `seen[3]` ist dann nicht mehr `2048 / 1.2`.
  - Fix: K2. Der Aufruf kommt nur bei `offset > 0`. Die bestehenden Tests bleiben unverändert grün.

## 3. Korrekturen (bindend)

| # | Datei | Korrektur |
|---|---|---|
| K1 | `src/main/files/transfer.ts` | Eine `.part`, die keine Datei ist, führt zu `throw new FileError('files.existsAsDirectory', { name: to.basename(partial) })`. Das geschieht vor `job.partial`, vor jedem Löschen und vor `write` (Vertrag). Behebt B1. |
| K2 | `src/main/files/transfer.ts` | `if (offset) { job.doneBytes += offset; hooks.progress(job); }`. Ohne Offset gibt es keinen zusätzlichen Aufruf. Behebt B2. |
| K3 | `src/main/files/transfer.ts` | Rename-Ausweichpfad: Zuerst `stat(partial)`. Fehlt die `.part`, wird der ursprüngliche Fehler geworfen und das Ziel **nicht** gelöscht. Wird die Kopie verworfen, setzt der Pfad `job.partial = undefined` (Vertrag). |
| K4 | `src/main/files/transfer.ts` | `checkAborted(signal)` nach der `.part`-Prüfung und vor `job.partial` (Vertrag). |
| K5 | `src/main/files/transfer.ts` | Nach `from.removeFile(item.source)` fällt die Quelle bei `job.move` aus `job.sources` (Vertrag). Spec 4.4 „planTransfer sieht nur den Rest“ gilt damit auch für mehrere Quellen auf oberster Ebene. Bei Ordnerquellen ändert sich nichts, der Ordner bleibt bis zum Ende stehen. |
| K6 | `src/main/files/sftp-session.ts` | `Job.sources` bleibt. Das Job-Literal bekommt `sources: [...request.sources]`, die Queue-Hooks `keepPartial: true`. Gegenüber Spec 4.1 Absatz „Main“ ist das bewusst so entschieden. |
| K7 | `src/renderer/src/components/FilesPanel.tsx` | „Teildatei verwerfen“ ist `disabled`, solange in diesem Panel ein Job wartet oder läuft (`activeCount > 0`). So löscht der Knopf nie die `.part`, die ein neuer Job gerade fortsetzt. `report()` schließt bei `closed`/`error` zusätzlich den Konfliktdialog (`setConflict(null)`). „Fortsetzen“ erscheint und wirkt nur mit `job.sources?.length`. `discardPartial` ohne Non-Null-Assertion auf `partial` (Vertrag). |
| K8 | `src/main/files/transfer.test.ts` | Das `memory()`-FS bekommt `read(path, start = 0, end)` mit `subarray(start, end === undefined ? undefined : end + 1)` und `write(path, _mode, start = 0)`. Bei `start > 0` und fehlender Datei wirft `write` synchron `Object.assign(new Error('missing'), { code: 'ENOENT' })`. Sonst beginnt es mit `data.slice(0, start)` der vorhandenen Datei. `modified` beim Schreiben bleibt 0. Test 213 erwartet `('/target/a.txt.part', 0o600, 0)`. Die Fälle 1–8 der Spec gelten, mtime-Fälle mit zwei FS-Instanzen und eigenem `modified`. **Zusätzlich:** (9) Ein Ordner `/target/a.bin.part` führt zu `rejects.toMatchObject({ code: 'files.existsAsDirectory' })`, der Ordner bleibt bestehen und `job.partial` ist `undefined`. (10) Strikter Rename (Muster `strict()`), dabei entfernt `to.write` beim Ende die `.part` (simuliert „anderswo gelöscht“): Der Fehler wird geworfen, und `/target/a.txt` behält `'old'`. (11) Verschieben mit `job.sources = ['/a.txt', '/b.txt']`, `/b.txt` liest mit Fehler: Danach ist `job.sources` gleich `['/b.txt']`. (12) Der Rate-Test (52-65) bleibt **unverändert** grün. |
| K9 | `src/main/files/transfer.test.ts` | Fall 7 prüft zusätzlich `job.partial === '/target/big.bin.part'` nach dem Abbruch. Der bestehende Abbruchtest ohne `keepPartial` (135-141) prüft zusätzlich `job.partial` ist `undefined`. |
| K10 | `src/main/files/sftp-loopback.test.ts` | Der Abbruchtest hängt nicht mehr vom Timing ab. Auf Modulebene kommt `let stallWritesFrom: number \| undefined;`. Der `WRITE`-Handler des Testservers beantwortet bei `stallWritesFrom !== undefined && offset >= stallWritesFrom` die Anfrage nicht und schreibt nichts (`return` vor `guard`). Ablauf: `stallWritesFrom = 1024 * 1024`, Upload von `resume/huge.bin` (4 MB, Muster `i % 251`), Polling bis `statSync(<remoteRoot>/resume/huge.bin.part).size >= 1024 * 1024`, `manager.cancel`. Erwartet: `{ state: 'canceled', partial: '/resume/huge.bin.part' }`, Größe der `.part` > 0, kein `huge.bin`. Danach `stallWritesFrom = undefined`, neuer Upload: `done`, `resumedFrom` gleich der zuvor gemessenen `.part`-Größe, Inhalt byte-gleich. Download-Resume nutzt eine **eigene** Musterdatei `/resume/dl.bin` (700 000 Bytes `i % 251`, per `writeFileSync` in `remoteRoot` mit `utimesSync` auf alte Zeit), nicht `Buffer.alloc(…, 7)`, sonst bestünde ein falscher Offset die Inhaltsprüfung. Die Upload-Prüfung erwartet `sources: [lokaler Pfad]`. Am Ende `manager.delete` für `/resume`, lokales `resume`/`resume-dl` per `rmSync`. `readdirSync(remoteRoot)` bleibt im letzten Test leer. |
| K11 | `.claude/skills/run-app/screens.mjs`, `SKILL.md` | `big.bin` wird **512 MB** groß, geschrieben als 8 × `crypto.randomBytes(64 * 1024 * 1024)` per `fs.writeSync`. Der Abbruch wartet nicht auf die Rate, sondern bis die Fortschrittsanzeige der laufenden Zeile zwischen 1 und 40 % steht: `waitFor('Upload läuft', \`(() => { const p = document.querySelector('${queue} .transfer-job.is-running progress'); return p && p.value >= 1 && p.value <= 40; })()\`, { timeout: 60000, every: 100 })`. Dann `click(\`${queue} .transfer-job.is-running button\`)`, `waitFor` auf eine `.is-canceled`-Zeile mit `big.bin`, im Node-Prozess `fs.statSync(\`${bigServer}.part\`).size > 0`, sonst `throw`. Danach `shot('sftp-transfer-canceled')`. Fortsetzen, Rate und „fortgesetzt ab“ wie Spec 7.5 Schritt 3–4. „Upload fertig“ mit `timeout: 300000`. SHA-256 beider Dateien **streamend** (`fs.createReadStream` → `createHash`), bei Abweichung `throw new Error('SHA-256 nach dem Fortsetzen verschieden')`. `finally` bleibt mit drei Pfaden. `SKILL.md` Zeile 23 und 33 nennen `sftp-transfer-canceled.png`. |
| K12 | `CHANGELOG.md`, `CHANGELOG.en.md`, `docs/handbuch.md`, `docs/manual.md` | Wörtliche CHANGELOG-Zeilen unter `## [0.18.0] – 2026-10-21`. de: „- Neu: Abgebrochene oder fehlgeschlagene Übertragungen lassen sich mit Fortsetzen an der Stelle wieder aufnehmen, an der sie stehen geblieben sind, auch nach Neu verbinden. Eine liegen gebliebene Teildatei wird beim erneuten Übertragen derselben Datei weiterverwendet, wenn sie zur Quelle passt.“ und „- Abbrechen behält jetzt die Teildatei, Teildatei verwerfen löscht sie (lokal in den Papierkorb). Auto-Upload räumt seine Teildateien weiterhin selbst auf.“ en: „- New: Canceled or failed transfers can be resumed with Resume from where they stopped, also after Reconnect. A leftover partial file is reused when the same file is transferred again and it matches the source.“ und „- Cancel now keeps the partial file, Discard partial file deletes it (local files go to the recycle bin). Auto-upload still cleans up its own partial files.“ Der Handbuch-Absatz (Spec 7.4) bekommt zusätzlich den Satz: „Teildatei verwerfen ist gesperrt, solange eine Übertragung läuft.“ en: „Discard partial file is unavailable while a transfer is running.“ Danach `npm run version:minor`. |

## 4. Wellen (endgültig)

Jede Datei gehört genau einem Task. Nach jeder Welle laufen `npm run typecheck` und `npx vitest run` grün, danach ein Commit je Task.

| Welle | Task | Dateien (exklusiv) | Pflichtpunkte |
|---|---|---|---|
| 1 | A Main | `src/shared/sftp.ts`, `src/main/files/file-system.ts`, `src/main/files/sftp-file-system.ts`, `src/main/files/transfer.ts`, `src/main/files/transfer.test.ts`, `src/main/files/sftp-session.ts`, `src/main/files/sftp-loopback.test.ts` | Vertrag Abschnitt 1 (Main-Teil) wörtlich, K1–K6, K8–K10. Spec 3.1–3.4, 7.1, 8. `auto-upload.ts`, `auto-upload.test.ts`, `remote-edit.ts`, `ipc.ts` und `preload` bleiben unberührt. Der Rate-Test bleibt unverändert grün. |
| 1 | C Doku und Version | `docs/handbuch.md`, `docs/manual.md`, `CHANGELOG.md`, `CHANGELOG.en.md`, `package.json`, `package-lock.json` | Spec 7.4, dazu K12. Absatz nach `handbuch.md:348` bzw. `manual.md:344`. Ohne Fettdruck und ohne Backticks im CHANGELOG. `npm run version:minor` → 0.18.0. |
| 1 | D run-app | `.claude/skills/run-app/screens.mjs`, `.claude/skills/run-app/SKILL.md` | Spec 7.5, dazu K11. Selektoren: `.transfer-job.is-running`, `.is-canceled`, Knopftext „Fortsetzen“, Text „fortgesetzt ab“. Ausgeführt wird D erst nach Welle 2 gegen einen frischen Build. |
| 2 | B Renderer | `src/renderer/src/components/FilesPanel.tsx`, `src/shared/locales/de-DE/files.json`, `src/shared/locales/en-US/files.json`, `src/shared/locales/de-DE/errors/files.json`, `src/shared/locales/en-US/errors/files.json` | Vertrag Abschnitt 1 (Renderer und Texte) wörtlich, K7. Spec 4.1 (Renderer), 4.2, 5, 7.2, 7.3. Kein CSS, kein Token. Keine deutschen Literale im Code (Katalogregel g). |

Abhängigkeit: B braucht die Felder aus A. A, C und D sind untereinander frei. Am Ende: run-app `sftp`. Angesehen werden `sftp-transfer-canceled.png` (beide Knöpfe, Zustand „Abgebrochen“) und `sftp-transfer.png` (Rate und „fortgesetzt ab“). Der SHA-Vergleich muss bestehen.

## 5. Offene Risiken (hingenommen)

1. **1-MB-Fenster** (Spec-Risiko 1): Ändert sich die Quelle während des **ersten** Laufs vor dem Abbruch im vorderen Teil, bestehen mtime und Tail die Prüfung. Das Ergebnis ist eine Mischung. Ohne Fortsetzen wäre die Kopie ebenso inkonsistent.
2. **Fremde `x.part` als Datei**: Passt sie, wird sie zur Zieldatei umbenannt. Passt sie nicht, wird sie gelöscht (lokal per `unlink`, nicht in den Papierkorb). Das ist gleichwertig zum heutigen Kürzen mit `'w'`, Shortcut-Kommentar wie im Vertrag. Dazu gehört, dass ein Job mit `x.part` und `x` als Quellen die eben kopierte `x.part` verbraucht.
3. **Zwei Sitzungen** (zwei Tabs oder Auto-Upload neben der Queue) auf dieselbe `.part`: Gleichzeitiges Schreiben gab es auch vorher. K3 schützt jetzt das alte Ziel. K7 wirkt nur im eigenen Panel.
4. **Uhrenversatz** (Spec-Risiko 3): Im ungünstigen Fall beginnt die Übertragung unnötig neu, Daten gehen nicht verloren.
5. **Veralteter Snapshot bei Verbindungsverlust**: `partial` und `sources` stammen aus dem letzten gedrosselten Snapshot (≤ 200 ms alt). Im schlimmsten Fall meldet „Verwerfen“, dass die Datei nicht gefunden wurde, oder ein Verschieben-Job meldet `files.sourceNotFound`. Sichtbar, nichts geht verloren.
6. **Adoption nach Verwerfen** (Spec-Risiko 4): Main behält `partial`. Ein Klick meldet dann „nicht gefunden“.
7. **Papierkorb bei großen lokalen `.part`**: Verhalten von `shell.trashItem`, wenn die Datei größer ist als der Papierkorb. Das ist dasselbe Verhalten wie beim bestehenden lokalen Löschen.
8. **Nutzlast `sources`**: Bis zu 1000 × 32 767 Zeichen je Snapshot sind möglich. Treffen kann das nur einen Renderer, der sich selbst überlastet. Typisch sind wenige hundert Bytes.
9. **Übersprungene halbe Datei**: Hatte die angefangene Datei ein altes Ziel und antwortet der Nutzer beim Fortsetzen mit „Überspringen“, bleibt die `.part` verwaist. Sie ist in der Dateiliste sichtbar und dort löschbar.

Gestrichen gegenüber der Spec: R12 bzw. Spec-Risiko 2 (WRITE-Reihenfolge). Lücken liegen beweisbar im geprüften letzten MB (siehe Prüfergebnisse).
