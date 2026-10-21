# Übertragungen fortsetzen – Design

Auftrag: „Ich habe gba.zip kopiert, 5,4 GB. 4,1 GB waren kopiert, dann ist es abgebrochen. Ich will das fortsetzen können.“ Grundlage ist das Konzept `.superpowers/sdd/transfer-resume-research.md`, hier ab Abschnitt 1 vollständig als Spec übernommen. Plan: `docs/superpowers/plans/2026-10-21-transfer-resume.md`.

## Nutzer-Entscheidungen (bindend)

- **N1** Ausgelöst wird das Fortsetzen über einen Knopf „Fortsetzen“ an einer fehlgeschlagenen oder abgebrochenen Übertragung. Wird dieselbe Datei erneut übertragen und liegt eine passende `.part` vor, setzt Shellherd automatisch fort. Ein automatisches Neuverbinden gibt es nicht.
- **N2** Vor dem Fortsetzen wird geprüft: Die `.part` ist höchstens so groß wie die Quelle, und ihr letztes MB stimmt byteweise mit der Quelle an derselben Stelle überein.
- **N3** Bricht der Nutzer selbst ab, bleibt die `.part` erhalten. Aufräumen geht über „Teildatei verwerfen“.
- **N4** Schlägt die Prüfung fehl, wird die Teildatei verworfen und die Übertragung beginnt bei 0. Die Zeile zeigt dazu einen Hinweis.
- **N5** Das gilt für Upload und Download.

## Spec-Rulings (Stufe 3)

- **S1** Es gelten die Rulings-Vorschläge des Konzepts, einschließlich R3 (die Quelle ist nicht neuer als die `.part`, mit 1 s Toleranz).
- **S2** Umfang ist Stufe 1. Die Extras entfallen.
- **S3** Version `0.18.0`, CHANGELOG ohne Fettdruck.
- **S4** Abnahme: Typecheck und `npx vitest run` grün. Im run-app-Szenario wird ein großer Upload abgebrochen, fortgesetzt und per SHA-256 auf denselben Inhalt geprüft. Die Screenshots werden angesehen.

## 1. Bestand und Lücken

### A) Transfer-Kern (`src/main/files/transfer.ts`)

| Was | Wo | Befund |
|---|---|---|
| `planTransfer` | `transfer.ts:26-61` | Liefert `PlannedItem { source, target, type, size, modified, name }`; `size`/`modified` kommen vom `stat` der Quelle zur Planzeit. Unverändert nutzbar: `size` ist die Obergrenze der Prüfung, `modified` der Vergleichswert. |
| `runTransfer` | `transfer.ts:64-111` | `existing = await to.stat(item.target)` (73), Konfliktfrage nur bei vorhandenem **Ziel** (79-96), nicht bei vorhandener `.part`. `realpath` bei vorhandenem Ziel (99), danach `copyFile` (100), `setModified` (101), `move` löscht die Quelle erst nach Erfolg (102). |
| `copyFile` | `transfer.ts:113-142` | `before = job.doneBytes` (114); Zähler-Transform (115-121) zählt nur gestreamte Chunks, Rate ebenfalls; `partial = ${target}.part` (123) mit Shortcut-Kommentar (122); `pipeline(from.read(source), counter, to.write(partial, mode), { signal })` (125); **`catch` löscht die `.part` immer** (127), dann `TransferCanceled` bei Abbruch (128); Rename-Swap mit OpenSSH-Ausweichpfad (132-139), Abschluss `doneBytes = before + item.size` (141). |
| Hooks | `transfer.ts:13-17` | `TransferHooks { progress, conflict }`. Beide Aufrufer (`sftp-session.ts:268-271`, `auto-upload.ts:271-280`) bauen das Objekt inline. Ein optionales Feld fällt bei Auto-Upload automatisch weg. |

Lücke: Es gibt keinen Offset, keine Prüfung, kein Behalten der `.part`, keine Felder im Job dafür.

### B) Streams und Dateisysteme

| Was | Wo | Befund |
|---|---|---|
| Schnittstelle | `src/main/files/file-system.ts:18,20` | `read: (path) => Readable`, `write: (path, mode?) => Writable`. Kein Offset, kein Bereich. |
| Lokal | `file-system.ts:91-92` | `createReadStream(path, { highWaterMark })`, `createWriteStream(path)`. Node kennt `start`/`end` (inklusiv) beim Lesen und `flags: 'r+'` + `start` beim Schreiben (positionsgebundenes `pwrite`). |
| Server | `src/main/files/sftp-file-system.ts:59-60` | `sftp.createReadStream(path, { highWaterMark })`, `sftp.createWriteStream(path, { mode })`. |
| ssh2 ReadStream | `node_modules/ssh2/lib/protocol/SFTP.js:3659-3673, 3747-3752` | `options.start` setzt `pos`; jede READ-Anfrage trägt den absoluten Offset. `end` inklusiv wie Node. |
| ssh2 WriteStream | `SFTP.js:3852-3868, 3893-3951, 3959-3970` | `flags` Default `'w'`; `start` setzt `pos`; jede WRITE-Anfrage trägt den absoluten Offset (`this.pos += data.length`). **`fchmod(handle, mode)` läuft nach jedem `open`, auch bei `r+`** (3949), harmlos. Bei `'a'` holt ssh2 die Größe per `fstat` (3922-3944), aber `O_APPEND` auf dem Server ignoriert Offsets; deshalb `'r+'` und nicht `'a'`. `stringToFlags('r+')` = `READ \| WRITE` ohne `CREAT`/`TRUNC` (2534): die `.part` muss existieren, sonst `NO_SUCH_FILE`. |
| Testserver | `src/main/files/sftp-loopback.test.ts:42,48`, `.claude/skills/run-app/sshd.mjs:83,89` | `OPEN` mit `openSync(path, flagsToString(flags))`, `WRITE` mit `writeSync(fd, data, 0, len, offset)`. `r+` und Offsets funktionieren dort ohne Änderung. |

### C) Session und Jobs (`src/main/files/sftp-session.ts`)

| Was | Wo | Befund |
|---|---|---|
| Job-Eintrag | `sftp-session.ts:42-47` | `Job { job, sources, controller, lastEmit }`. `sources` bleibt im Main; der Renderer sieht nur `TransferJob`. |
| `transfer()` | `sftp-session.ts:228-241` | Baut `TransferJob` aus `request` (232-234), `entry.sources = request.sources` (235), `pump`. |
| `pump` | `sftp-session.ts:256-284` | `catch`: `canceled` bei `TransferCanceled` oder `signal.aborted`, sonst `error` mit `fileError` (273-275). `finally` räumt `current`/`bytesPerSecond` und emittiert erzwungen (276-282), **aber nur, wenn die Session noch aktiv ist** (`emitJob` 249-254, Guard 253). |
| `cancel` | `sftp-session.ts:301-308` | `controller.abort()`; die `.part` wird heute in `copyFile` gelöscht. |
| `finish` | `sftp-session.ts:343-356` | Löscht die Session aus der Map (348), bricht alle Jobs ab (350), zerstört den Client (353), emittiert nur das Status-Event (355). Folge: **Bei Verbindungsabbruch bekommt der Renderer für laufende Jobs kein Endereignis**; sie bleiben im Renderer auf `running` stehen. Die `.part` bleibt auf dem Ziel liegen (kein `removeFile` mehr möglich). |
| `state()` | `sftp-session.ts:316-320` | Kopiert die Jobs; neue Felder reisen automatisch mit (kein Zod auf Antworten/Events). |

### D) Geteilte Typen und IPC

| Was | Wo | Befund |
|---|---|---|
| `TransferJob` | `src/shared/sftp.ts:30-50` | `direction`, `move`, `targetDir`, `label`, `entryCount`, Zähler, `current`, `bytesPerSecond`, `error`. **Keine `sources`**: der Renderer kann einen Job heute nicht neu anstoßen. |
| `SftpTransferRequest` | `src/shared/sftp.ts:105-111`, Schema `src/main/files/ipc.ts:28-31` | `direction`, `sources` (lokal win32-absolut bzw. remote `/…`), `targetDir`, `move`. Ein erneuter Aufruf mit denselben Werten ist die komplette „Fortsetzen“-Anfrage. |
| Löschen | `ipc.ts:93` (`sftpDelete`, Pfade `/…`), `ipc.ts:121-123` (`localDelete` → `shell.trashItem`, Papierkorb) | Beide vorhanden; genügen für „Teildatei verwerfen“. |

### E) Renderer (`src/renderer/src/components/FilesPanel.tsx`)

| Was | Wo | Befund |
|---|---|---|
| Jobliste | `FilesPanel.tsx:89`, Event-Handler 183-190 | Ersetzt den Job als Ganzes; `isFinished` → Konflikt schließen, beide Seiten neu laden. |
| `report()` | `FilesPanel.tsx:140-144` | Setzt Status/Fehler bei `closed`/`error`. Jobs bleiben unberührt (siehe C, Lücke). |
| `transfer()` | `FilesPanel.tsx:242-246` | `(from, sources, move, targetDir?)` → `sftpTransfer`. Für „Fortsetzen“ direkt wiederverwendbar. |
| `reconnect()` | `FilesPanel.tsx:255` | **`setJobs([])`**: beim Neuverbinden verschwindet die Liste, damit auch jeder fortsetzbare Job. |
| `TransferQueue` | `FilesPanel.tsx:353-379` | Zeile mit `·`-Teilen (366-372), ein Knopf `Abbrechen` nur für laufende Jobs (374). Fertige Jobs haben keinen Knopf. `onClear` 338 ruft `sftpClearFinished`. |
| CSS | `src/renderer/src/files-ui.css:69-89` | `.transfer-job` ist Flex mit `gap`; `.transfer-job button` (88) stylt jeden Knopf in der Zeile. Zwei Knöpfe nebeneinander brauchen keine neue Regel. |
| Wortlaut | `src/shared/locales/de-DE/files.json` `queue.*`, `sync.resume` = „Fortsetzen“, `sync.notConnected` = „Nur mit Verbindung zum Server“ | „Fortsetzen“ ist als Wort im Auto-Upload schon da; derselbe Wortlaut für die Queue. |
| Fehlercodes | `src/shared/errors.ts:6` (`ErrorCode` aus dem Katalog), `src/shared/locales/*/errors/files.json` | Ein neuer Code braucht nur den Katalogeintrag in de und en; die Orphan-Prüfung (`i18n-catalog.test.ts`, Regel d) verlangt die Nutzung als Literal im Code. |

### F) Auto-Upload (`src/main/files/auto-upload.ts`)

`runs` (66) und `await previous` in `start` (91) existieren nur, damit ein Neustart wartet, bis der abgebrochene Lauf **seine `.part` entfernt hat** (Test `auto-upload.test.ts:234-246`). `stop` (113-123) bricht ab; `upload` (267-293) ruft `runTransfer` mit `progress: () => {}`. Auto-Upload ist der zweite Aufrufer von `copyFile` und erbt jede Änderung dort.

### G) Tests und run-app

- `src/main/files/transfer.test.ts:12-35` `memory()`-FS: `read` ignoriert jede Position, `write` sammelt Chunks ab 0. Beide müssen `start`/`end` beherrschen. Erwartungen auf „keine `.part`“ (141, 177, 185, 195, 229, 237) bleiben gültig, solange die Tests ohne `keepPartial` laufen. `toHaveBeenCalledWith('/target/a.txt.part', 0o600)` (213) bekommt ein drittes Argument.
- `src/main/files/sftp-loopback.test.ts:137-236`: echte ssh2-Verbindung, `transfer` + `finished(jobId)` (156-157, Wartezeit 200 × 25 ms = 5 s), `resolveConflict`. Letzter Test erwartet am Ende ein leeres Server-Root (234).
- `.claude/skills/run-app/screens.mjs:94-115`: 256 MB `big.bin` hochladen, Rate abwarten, Shot, fertig abwarten, `finally` löscht `big.bin`, Serverkopie und `.part`. Der Block ist der richtige Ort für Abbrechen → Fortsetzen → Inhalt prüfen.
- `docs/handbuch.md:344-348` / `docs/manual.md:340-344`: Abschnitt „Dateiansicht: Tastatur und Übertragungen“ nimmt den Absatz auf. `CHANGELOG.md`/`CHANGELOG.en.md` 0.17.0 oben; `npm run version:minor` (`package.json:21`).

## 2. Empfehlung je Fläche

| Fläche | Empfehlung | Wert | Aufwand |
|---|---|---|---|
| Fortsetzen in `copyFile` (Offset, Prüfung, `.part` behalten) | Ja, Kern | ★★★ | kleine Main-Änderung (~45 Zeilen in `transfer.ts`, je 2 Zeilen in beiden Dateisystemen, Interface) |
| Knopf „Fortsetzen“ als Wiederholung der Anfrage (`TransferJob.sources`) | Ja | ★★★ | Main 3 Zeilen, Renderer ~20 Zeilen |
| Verbindungsabbruch: Jobs im Renderer als Fehler markieren, Liste beim Neuverbinden behalten | Ja | ★★★ | nur Renderer (2 Zeilen) |
| „Teildatei verwerfen“ über vorhandene Lösch-IPCs | Ja | ★★ | nur Renderer (~8 Zeilen) |
| Hinweise „fortgesetzt ab 4,1 GB“ und „Teildatei passte nicht, neu begonnen“ | Ja | ★★ | nur Renderer (2 Zeilen) + 2 Jobfelder |
| Auto-Upload: eigene Abbrüche löschen weiter, Erkennung einer fremden Rest-`.part` geerbt | Ja, ohne Änderung in `auto-upload.ts` | ★★ | keine Zeile |
| Konflikt-Voreinstellung beim Fortsetzen von Ordnern | Nein (Extra E1) | ★★ | nicht jetzt |
| Fortsetzen über App-Neustart hinweg (Jobliste persistieren) | Nein (Extra E2) | ★ | nicht jetzt; die automatische Erkennung beim erneuten Übertragen deckt es |

## 3. Fortsetzen technisch

### 3.1 Schnittstelle `FileSystem` (`file-system.ts:18-20`)

```ts
  /** `start`/`end` select a byte range, `end` inclusive like Node; both optional. */
  read: (path: string, start?: number, end?: number) => Readable;
  /** Servers set `mode` on new and existing files alike (default 0644), so pass the old mode when overwriting; this computer ignores it.
   *  `start` > 0 continues an existing file at that offset (`r+`), otherwise the file is created or truncated. */
  write: (path: string, mode?: number, start?: number) => Writable;
```

Lokal (`file-system.ts:91-92`):
```ts
  read: (path, start, end) => createReadStream(path, { highWaterMark: 256 * 1024, start, end }),
  write: (path, _mode, start) => createWriteStream(path, start ? { flags: 'r+', start } : {}),
```
Server (`sftp-file-system.ts:59-60`):
```ts
    read: (path, start, end) => sftp.createReadStream(path, { highWaterMark: 256 * 1024, start, end }),
    write: (path, mode, start) => sftp.createWriteStream(path, { mode: mode ?? 0o644, ...(start ? { flags: 'r+', start } : {}) }),
```
`undefined` für `start`/`end` ist in Node und ssh2 erlaubt (beide prüfen nur `!== undefined`). `start: 0` beim Lesen ist gültig; beim Schreiben bedeutet 0/undefined „neu anlegen“ wie heute. `createFile` (`sftp-session.ts:220`) und `remote-edit.ts` rufen `write(path)` ohne weitere Argumente und bleiben unberührt.

### 3.2 `copyFile` (`transfer.ts:113-142`)

```ts
const TAIL_BYTES = 1024 * 1024;

/** Reads one byte range into memory; the tail check needs at most TAIL_BYTES per side. */
async function readRange(fs: FileSystem, path: string, start: number, end: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of fs.read(path, start, end)) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/** A leftover .part continues the copy when it is not longer or newer than the source and its last megabyte equals the source at the same place. */
async function resumable(from: FileSystem, item: PlannedItem, to: FileSystem, partial: string, part: FileEntry): Promise<boolean> {
  // Servers keep whole seconds (same rule as the conflict check).
  if (part.size > item.size || item.modified > part.modified + 1000) return false;
  const start = Math.max(0, part.size - TAIL_BYTES);
  const [ours, theirs] = await Promise.all([readRange(to, partial, start, part.size - 1), readRange(from, item.source, start, part.size - 1)]);
  return ours.length === part.size - start && ours.equals(theirs);
}
```

Im Rumpf von `copyFile` ersetzt dies die Zeilen 122-130:
```ts
  // shortcut: a real file named x.part collides (it is resumed or removed); upgrade when someone reports it.
  const partial = `${target}.part`;
  const part = await to.stat(partial);
  let offset = 0;
  if (part?.type === 'file' && part.size > 0) {
    if (await resumable(from, item, to, partial, part)) { offset = part.size; job.resumedFrom = offset; }
    else { await to.removeFile(partial); job.restarted = true; }
  }
  job.partial = partial;
  job.doneBytes += offset;
  hooks.progress(job);
  try {
    await pipeline(from.read(item.source, offset), counter, to.write(partial, mode, offset), { signal });
  } catch (error) {
    if (!hooks.keepPartial) { await to.removeFile(partial).catch(() => {}); job.partial = undefined; }
    if (signal.aborted) throw new TransferCanceled();
    throw error;
  }
```
Nach dem erfolgreichen Rename (nach 139): `job.partial = undefined;`. Im Ausweichpfad, der die Kopie verwirft, weil das alte Ziel überlebt hat (136), ebenfalls `job.partial = undefined`. Zeile 141 (`doneBytes = before + item.size`) bleibt; `before` wurde vor dem Offset gelesen, deshalb zählt die Datei am Ende genau einmal.

`TransferHooks` (13-17) bekommt:
```ts
  /** Keep a half-written .part after a cancel or failure so a later run can resume it; the queue keeps, auto-upload removes. */
  keepPartial?: boolean;
```

### 3.3 Fortschritt und Rate

`job.doneBytes += offset` vor dem Stream: der Balken springt auf 76 %, die Rate (`rate.add` im Zähler, 118) sieht nur gestreamte Chunks und ist korrekt. `totalBytes` enthält weiter `item.size`. Nach dem Ende steht `fortgesetzt ab 4,1 GB` dauerhaft in der Zeile (Feld bleibt am Job).

### 3.4 Prüfung „letztes 1 MB“ und Randfälle

| Fall | Verhalten |
|---|---|
| `.part` fehlt | Wie heute: `write` mit `'w'`, kein Hinweis. |
| `.part` = 0 Bytes | Wird ohne Prüfung und ohne Hinweis überschrieben (`'w'` kürzt). Kein `restarted`, denn es gab nichts zum Fortsetzen. |
| `.part` < 1 MB | Verglichen wird die ganze `.part` (`start = 0`). |
| `.part` = Quelle (gleich groß, Tail gleich) | `offset = size`; Lesestream ab EOF liefert sofort Ende (Node und ssh2 geben bei `pos = size` EOF), Schreibstream öffnet mit `r+` und schließt; dann Rename. `resumedFrom = size`. |
| `.part` > Quelle | `resumable` false → `removeFile`, `restarted`, von 0. |
| Quelle neuer als `.part` (mtime, +1 s Toleranz) | false → neu. Fängt den Fall, in dem die Quelle nach dem Abbruch im vorderen Teil geändert wurde und das letzte MB zufällig gleich blieb. Kostet nichts (beide `stat`s liegen vor). Siehe Ruling R3. |
| Tail ungleich | false → neu, Hinweis. |
| Quelle während der Prüfung geschrumpft | `readRange` liefert weniger Bytes → Längenvergleich schlägt fehl → neu. |
| `.part` zwischen `stat` und `open` verschwunden | `r+` scheitert mit `NO_SUCH_FILE`/`ENOENT` → Job `error`; „Fortsetzen“ beginnt dann von 0. |
| `.part` ist Ordner oder Link auf Ordner | `write` scheitert (EISDIR) → `error`, wie heute. |

Kosten: höchstens 2 × 1 MB lesen (eine Seite über das Netz), ein `stat` je Datei zusätzlich. Bei einem Ordner mit 10 000 kleinen Dateien sind das 10 000 zusätzliche `stat`-Roundtrips (je ~1 ms über LAN, mehr über WAN). Hinnehmbar; wer es spürt, bekommt später ein `list`-basiertes Vorab-Set (nicht jetzt).

Reihenfolge der WRITE-Pakete: OpenSSH arbeitet Anfragen eines Kanals der Reihe nach ab, die `.part` ist also nach einem Abbruch ein lückenloses Präfix. Ein Server, der WRITEs umsortiert, könnte ein Loch hinterlassen; der Tail-Vergleich erkennt es nur innerhalb des letzten MB. Hingenommen (R12).

## 4. Wann wird fortgesetzt

### 4.1 Knopf „Fortsetzen“ = dieselbe Anfrage noch einmal

Der Job behält alles, was `sftpTransfer` braucht, wenn `TransferJob` das Feld `sources: string[]` bekommt (`direction`, `targetDir`, `move` sind schon da, `src/shared/sftp.ts:30-50`). Dann ist Fortsetzen im Renderer:

```ts
const resume = (job: TransferJob): void => {
  if (!remoteReady) return;
  setJobs(current => current.filter(item => item.id !== job.id));
  transfer(job.direction === 'upload' ? 'local' : 'remote', job.sources, job.move, job.targetDir);
};
```
Die alte Zeile verschwindet, die neue erscheint als neuer Job. Die `.part` wird in `copyFile` erkannt (3.2). Kein neuer IPC-Kanal, kein neues Schema, `TransferSchema` (`ipc.ts:28-31`) prüft die Pfade erneut.

Main: `sftp-session.ts:232-235` setzt `sources: request.sources` in den Job; `Job.sources` (44) entfällt, `pump` (266) liest `job.sources`. `auto-upload.ts:82` muss `sources: []` setzen (ein Wort, Datei gehört zu Task A? Nein: siehe Welle, das Feld wird optional gehalten, damit `auto-upload.ts` unberührt bleibt: `sources?: string[]`; der Renderer prüft `job.sources?.length`). Entscheidung: **optional**, Begründung in R1.

Nutzlast: Die Quellen reisen mit jedem 200-ms-Snapshot (`emitJob` 249-254). Bei 1 000 Quellen à ~100 Zeichen sind das ~100 KB fünfmal pro Sekunde, nur für die Dauer des Jobs. Hinnehmbar; typische Jobs haben wenige Quellen.

### 4.2 Verbindungsabbruch

Die Session stirbt in `finish` (343-356); laufende Jobs bekommen kein Endereignis (Guard 253). Der Renderer weiß aber, dass die Verbindung weg ist: `report()` (140-144) bekommt `closed`/`error`. Dort werden alle nicht fertigen Jobs lokal als Fehler markiert:

```ts
if (next === 'closed' || next === 'error') {
  setEndedAt(Date.now());
  // The main process cannot report jobs of a dead session; whatever ran or waited has stopped.
  setJobs(current => current.map(job => isFinished(job) ? job
    : { ...job, state: 'error', error: { code: 'files.connectionLost' }, current: undefined, bytesPerSecond: undefined }));
}
```
`reconnect()` (255) behält die Jobliste (`setJobs([])` entfällt). Nach „Neu verbinden“ zeigt die Zeile „Fehler · Die Verbindung wurde getrennt.“ mit aktivem „Fortsetzen“; der Klick schickt die Anfrage an die **neue** `sessionId` (aus dem State, `transfer()` 243-245). `partial` steht im letzten Snapshot (wurde beim Start der Datei gesetzt und emittiert), deshalb ist auch „Teildatei verwerfen“ verfügbar.

Warum nicht im Main (`finish` emittiert Endereignisse)? Das brächte Reihenfolge-Fragen (Transfer-Event vor Status-Event löst `refresh('remote')` auf der toten Session aus und schreibt einen Listenfehler unter den Hinweis, `FilePane.tsx:244-245`) und eine Sonderbehandlung im Renderer dazu. Zwei Zeilen im Renderer sind kleiner und ohne Nebenwirkung. Main `finish` bleibt unverändert.

Neuer Fehlercode `files.connectionLost` in `src/shared/locales/de-DE/errors/files.json` „Die Verbindung wurde getrennt.“ und `en-US` „The connection was lost.“; `ErrorCode` (`errors.ts:6`) nimmt ihn aus dem Katalog auf, die Orphan-Regel findet das Literal in `FilesPanel.tsx`.

### 4.3 Automatisch beim erneuten Übertragen

Gleicher Pfad: `copyFile` findet die `.part`. Gilt für Upload und Download, für Drag-and-drop, F5 und den Knopf. Auch Auto-Upload erbt es: Bleibt nach einem Verbindungsabbruch eine `.part` im Server-Ordner, setzt der nächste Abgleich sie fort (Prüfung inklusive mtime-Regel, deshalb nie eine veraltete Fassung).

### 4.4 Mehrdateien-Jobs

Fertige Dateien existieren am Ziel mit der Quellzeit (`setModified` 101). Beim Fortsetzen fragt der vorhandene Konfliktdialog einmal; „Nur wenn neuer“ mit „Für alle weiteren Konflikte“ überspringt sie (`transfer.ts:92`, Regel „≤ +1 s ist nicht neuer“). Die angefangene Datei hat kein Ziel, nur eine `.part`, und wird ohne Frage fortgesetzt. Bei `move` sind die fertigen Quellen schon gelöscht; `planTransfer` sieht nur den Rest, es gibt keine Frage. Eine Voreinstellung der Antwort ist Extra E1.

## 5. Nutzer-Abbrechen und „Teildatei verwerfen“

- `cancel` (301-308) bleibt wie es ist. `pipeline` zerstört beide Streams, ssh2 schließt das Handle (`CLOSE`), die `.part` bleibt mit dem geschriebenen Präfix liegen, weil die Queue `keepPartial: true` setzt (`sftp-session.ts:268-271`). Der Job endet als `canceled` mit `partial` gesetzt.
- Die Zeile zeigt dann zwei Knöpfe: `Fortsetzen` und `Teildatei verwerfen` (`title` = Pfad der `.part`, wie `transfer-target` den Zielordner als `title` trägt).
- Verwerfen nutzt die vorhandenen Lösch-IPCs:
  ```ts
  const discardPartial = (job: TransferJob): void => {
    const path = job.partial!;
    const side: FileSide = job.direction === 'upload' ? 'remote' : 'local';
    void run(() => side === 'remote' ? window.desktopApi.sftpDelete({ sessionId: sessionId!, paths: [path] }) : window.desktopApi.localDelete({ paths: [path] }), side)
      .then(done => { if (done) setJobs(current => current.map(item => item.id === job.id ? { ...item, partial: undefined } : item)); });
  };
  ```
  `run` (236-241) liefert Busy, Fehlertext und den Refresh der Seite. Upload-`.part` liegt auf dem Server (Knopf nur mit Verbindung, sonst `disabled` mit `title` `files:sync.notConnected`), Download-`.part` lokal → Papierkorb (`shell.trashItem`, `ipc.ts:121-123`). Die Zeile bleibt stehen, verliert nur den Verwerfen-Knopf; „Fortsetzen“ beginnt dann von 0.
- Die `.part` ist außerdem in der Dateiliste sichtbar und dort wie jede Datei löschbar.

## 6. Sicherheit und Daten

- **Zieldatei nie vor dem Ende ersetzt**: unverändert. Geschrieben wird nur in `name.part`, der Swap (132-139) bleibt wörtlich.
- **Fremde `x.part`**: Heute wird eine fremde `x.part` beim Upload von `x` mit `'w'` überschrieben und bei Fehler gelöscht (Shortcut 122). Neu: Sie wird nur als Präfix benutzt, wenn sie nicht größer und nicht neuer als die Quelle ist **und** ihr letztes MB byteweise mit der Quelle übereinstimmt. Eine fremde Datei erfüllt das praktisch nur, wenn sie unsere eigene Teildatei ist. Passt sie nicht, wird sie gelöscht, genau wie heute im Fehlerfall. Fortsetzen erhöht das Risiko also nicht; die mtime-Regel senkt es. Symlink-`x.part` → wir schreiben wie heute durch den Link (`stat` folgt Links, `'w'` auch); kein neuer Pfad. Shortcut-Kommentar bleibt, angepasst.
- **Keine freien Pfade über IPC**: „Verwerfen“ schickt `job.partial`, das ist Zielordner + Name + `.part`, also nichts, was der Renderer nicht ohnehin kennt; die Lösch-Schemata prüfen die Form (`ipc.ts:20-21`).
- **Auto-Upload**: Eigene Abbrüche (`stop`, `fail`) löschen die `.part` weiter, weil `auto-upload.ts:271` kein `keepPartial` übergibt. Begründung: Spiegelziele sind oft Webroots, eine `index.html.part` neben `index.html` nach einem Anhalten ist Müll für andere; außerdem hängt der Neustart-Schutz (`runs`, 66/91, Test 234-246) am Entfernen. Eine `.part` aus einem Verbindungsabbruch bleibt zwangsläufig liegen (H8 der Auto-Upload-Spec) und wird beim nächsten Abgleich fortgesetzt oder verworfen. `auto-upload.ts` und `auto-upload.test.ts` bleiben unberührt; der Fake-Remote dort bekommt beim Upload einen zusätzlichen `stat(.part)` ins Log, die Tests prüfen `calls.stat` nur in Fällen ohne Upload (254-257, 320).
- **Daten im Fehlerfall**: Ein Lesefehler lässt das alte Ziel stehen (unverändert) und jetzt zusätzlich die `.part` liegen. Das ist gewollt (fortsetzbar); Platz räumt „Teildatei verwerfen“.

## 7. UI, Texte, Doku, run-app

### 7.1 `TransferJob` (`src/shared/sftp.ts`, nach `bytesPerSecond`)

```ts
  /** Absolute paths on the source side as requested; "Fortsetzen" sends them again. Absent for auto-upload. */
  sources?: string[];
  /** Target-side path of the half-written .part: set while a file is copied, kept after a cancel or failure, absent after the swap. */
  partial?: string;
  /** Bytes a leftover .part already held when the copy continued. */
  resumedFrom?: number;
  /** A leftover .part did not match the source and was discarded; the copy started over. */
  restarted?: boolean;
```

### 7.2 `TransferQueue` (`FilesPanel.tsx:353-379`)

Props: `canResume: boolean` (= `remoteReady`), `onResume`, `onDiscard`. Nach dem Abbrechen-Knopf (374):
```tsx
{isFinished(job) && job.state !== 'done' && !!job.sources && <button type="button" className="secondary-button" disabled={!canResume}
  title={canResume ? undefined : t('files:sync.notConnected')} onClick={() => onResume(job)}>{t('files:queue.resume')}</button>}
{isFinished(job) && job.partial && <button type="button" className="secondary-button" disabled={job.direction === 'upload' && !canResume}
  title={job.partial} onClick={() => onDiscard(job)}>{t('files:queue.discardPartial')}</button>}
```
Statuszeile nach `skipped` (370):
```tsx
{!!job.resumedFrom && ` · ${t('files:queue.resumedFrom', { size: formatSize(job.resumedFrom) })}`}
{job.restarted && ` · ${t('files:queue.restarted')}`}
```
Kein CSS, kein Token, keine Bewegung: `.transfer-job button` (`files-ui.css:88`) und `.secondary-button` decken beide Knöpfe, `disabled` ist global geregelt.

### 7.3 i18n (`src/shared/locales/*/files.json`, `queue`)

| Key | de-DE | en-US |
|---|---|---|
| `queue.resume` | Fortsetzen | Resume |
| `queue.discardPartial` | Teildatei verwerfen | Discard partial file |
| `queue.resumedFrom` | fortgesetzt ab {{size}} | resumed at {{size}} |
| `queue.restarted` | Teildatei passte nicht, neu begonnen | partial file did not match, started over |

Plus `errors/files.json`: `connectionLost` (4.2). Keine Punkte am Ende in Teilen der `·`-Zeile (wie `queue.skipped`).

### 7.4 Doku und Version

`docs/handbuch.md` nach Zeile 348 ein Absatz: Abgebrochene oder fehlgeschlagene Übertragungen lassen sich mit `Fortsetzen` wieder aufnehmen, auch nach `Neu verbinden`. Jede Datei wird zuerst als `name.part` geschrieben und ersetzt das Ziel erst am Ende. Eine liegen gebliebene `.part` wird beim nächsten Übertragen derselben Datei weiterverwendet, wenn sie nicht größer und nicht neuer als die Quelle ist und ihr letztes Megabyte mit der Quelle übereinstimmt; die Zeile zeigt dann „fortgesetzt ab 4,1 GB“. Passt sie nicht, beginnt die Übertragung von vorn, die Zeile sagt es. `Abbrechen` behält die Teildatei, `Teildatei verwerfen` löscht sie (lokal in den Papierkorb). Bei Ordnern fragt Shellherd nach schon fertigen Dateien wie gewohnt; `Nur wenn neuer` mit `Für alle` überspringt sie. Auto-Upload räumt seine Teildateien weiterhin selbst auf. `docs/manual.md` entsprechend nach Zeile 344. `CHANGELOG.md`/`CHANGELOG.en.md` `## [0.18.0] – 2026-10-21` mit zwei Zeilen (eine `Neu:` für Fortsetzen, eine für das Verhalten beim Abbrechen), ohne Backticks, dann `npm run version:minor`.

### 7.5 run-app (`.claude/skills/run-app/screens.mjs:94-115`)

Innerhalb des bestehenden `try`, `big.bin` aus `crypto.randomBytes(256 * 1024 * 1024)` statt Nullen (Inhaltsprüfung braucht Muster), dann:
1. `waitFor('Rate', …)` wie heute (≥ 1 s Laufzeit, die Datei ist zu höchstens ~40 % durch).
2. `await click(\`${queue} .transfer-job.is-running button\`)` (Abbrechen), `waitFor('abgebrochen', is-canceled-Zeile mit big.bin)`, `shot('sftp-transfer-canceled')` (zeigt beide Knöpfe).
3. Fortsetzen per `evaluate([...querySelectorAll(\`${queue} .transfer-job.is-canceled button\`)].find(b => b.textContent.trim() === 'Fortsetzen').click())`.
4. `waitFor('fortgesetzt', /fortgesetzt ab/ und Rate im innerText, { timeout: 60000, every: 100 })`, `shot('sftp-transfer')` (ersetzt den bisherigen Rate-Shot, zeigt Rate und „fortgesetzt ab“).
5. `waitFor('Upload fertig', …)` wie heute, dann im Node-Prozess `createHash('sha256')` von `bigLocal` und `bigServer` vergleichen; bei Abweichung `throw`.
`finally` bleibt (drei Pfade). `SKILL.md:23,33` nimmt `sftp-transfer-canceled.png` auf.

## 8. Tests

### `src/main/files/transfer.test.ts`

`memory()` (12-35): `read: (path, start = 0, end) => Readable.from([Buffer.from(node.data).subarray(start, end === undefined ? undefined : end + 1)])`; `write: (path, _mode, start = 0)` beginnt mit dem Präfix `data.slice(0, start)` der vorhandenen Datei. Test 213 erwartet `('/target/a.txt.part', 0o600, 0)`. Neue Fälle (Quelle `/a.bin` = `'abcdefgh'`, Ziel mit `/target/a.bin.part`, `hooks` mit `keepPartial: true` wo angegeben):
1. `.part` = `'abcde'` → Ergebnis `'abcdefgh'`, `resumedFrom 5`, `doneBytes 8`, `from.read` mit `('/a.bin', 5)`, `to.write` mit `('/target/a.bin.part', undefined, 5)`, keine `.part`, `partial` undefined, `restarted` undefined.
2. `.part` = `'abXde'` → `removeFile('/target/a.bin.part')` aufgerufen, `restarted true`, kein `resumedFrom`, Ergebnis korrekt.
3. `.part` = `'abcdefghij'` (länger) → `restarted`. Quelle `modified 10_000`, `.part` `1000` → `restarted` (mtime-Regel).
4. `.part` = `'abcdefgh'` (vollständig) → `resumedFrom 8`, Ergebnis gleich, `write` mit `start 8`.
5. Fenster: `.part` = `'z' + 'y'.repeat(TAIL)`, Quelle `'x' + 'y'.repeat(TAIL) + 'tail'` → wird fortgesetzt (`resumedFrom TAIL + 1`), Ergebnis beginnt mit `z`. Dokumentiert die 1-MB-Grenze.
6. `.part` = `''` → kein `restarted`, kein `resumedFrom`, `removeFile` nicht aufgerufen, Ergebnis korrekt.
7. Abbruch mit `keepPartial: true` (Muster 135-141) → `.part` existiert mit `'partial'`, `job.partial === '/target/big.bin.part'`, kein Ziel. Ohne `keepPartial` bleibt der bestehende Test (Löschung).
8. Lesefehler mit `keepPartial: true` (Muster 171-178) → Ziel `'old'` bleibt, `.part` bleibt.

### `src/main/files/sftp-loopback.test.ts` (neuer Test vor „downloads, renames and deletes“, eigener Ordner `/resume`, am Ende per `manager.delete` entfernt)

- Upload-Resume: lokal `resume/part.bin` (700 000 Bytes Muster `i % 251`, alte mtime), Server `/resume/part.bin.part` = erste 300 000 Bytes → Job `{ state: 'done', resumedFrom: 300_000, sources: [lokaler Pfad] }`, Serverdatei gleich, keine `.part`.
- Mismatch: Serverdatei löschen, `.part` mit gekipptem letzten Byte → `restarted: true`, Datei gleich.
- Download-Resume: lokal `resume-dl/big.bin.part` = erste 300 000 Bytes von `/project/docs/big.bin` → `resumedFrom: 300_000`, Inhalt gleich.
- Abbrechen behält: lokal `resume/huge.bin` = 32 MB (`Buffer.alloc(32 MB, 9)`), Upload starten, auf das erste Transfer-Event mit `state 'running'` und `doneBytes > 0` warten, `manager.cancel` → `{ state: 'canceled', partial: '/resume/huge.bin.part' }`, `statSync(.part).size > 0`, kein `huge.bin`. Erneuter Upload → `done`, `resumedFrom > 0`, Inhalt gleich. 32 MB, damit `finished()` (5 s) auch bei 20 MB/s reicht.

### Auto-Upload, Session, Renderer

`auto-upload.test.ts` bleibt grün ohne Änderung (6.). `sftp-session.test.ts`: keine Änderung nötig (`toEqual` ignoriert `undefined`-Felder; `sources` prüft der Loopback-Test). Keine Komponententests für `FilesPanel`; die Sichtprüfung läuft über run-app (7.5).

## 9. Regeln und Risiken: was ausdrücklich nicht getan wird

- Kein automatisches Neuverbinden (Nutzer-Entscheidung). Kein neuer IPC-Kanal, kein neues Zod-Schema, kein Preload-Eintrag.
- Kein `'a'`-Flag, kein `posix-rename@openssh.com`, keine Prüfsumme über die ganze Datei (zu teuer über das Netz).
- Keine Persistenz der Jobliste über den App-Neustart; die Erkennung beim erneuten Übertragen deckt den Fall.
- Keine Konflikt-Voreinstellung beim Fortsetzen (E1), kein Vorab-Set der `.part`-Namen.
- Keine Änderung an `auto-upload.ts`, `remote-edit.ts`, `ipc.ts`, `preload`, CSS, Tokens, Motion-Gate.
- Main `finish` bleibt unverändert; der Renderer markiert tote Jobs selbst.
- Sicherheitsregeln früherer Specs gelten weiter: Zieldatei nie vor dem Ende ersetzen, auf dem Server nie außerhalb von `move`/`.part`-Swap/„Verwerfen“ löschen, Pfade nur über die vorhandenen Schemata.

Risiken:
1. **1-MB-Fenster**: Ein Unterschied vor dem letzten MB bleibt unentdeckt, wenn Größe und mtime passen (Test 5 dokumentiert es). Die mtime-Regel schließt den realistischen Fall (Quelle nach dem Abbruch geändert).
2. **WRITE-Reihenfolge** auf Nicht-OpenSSH-Servern (3.4), hingenommen.
3. **Uhrenversatz**: Liegt die Serveruhr weit zurück und war die Quelle kurz vor dem Upload geändert, gilt die `.part` als „älter“ und es beginnt von vorn. Kein Datenverlust, nur ein Neustart.
4. **Adoption in ein anderes Fenster** nach „Verwerfen“: Der Main-Job trägt `partial` weiter; `state()` zeigt den Knopf erneut, der Klick meldet „nicht gefunden“. Selten, sichtbar, harmlos.
5. **Papierkorb** bei lokalen `.part`: Eine 4-GB-Teildatei landet im Papierkorb (Verhalten von `localDelete`). Hingenommen, konsistent mit lokalem Löschen.
6. **run-app-Timing**: Abbrechen muss landen, solange der Upload läuft (≥ 1 s nach Start bei 256 MB und bis ~100 MB/s über Loopback: 2,5 s Gesamtzeit). Wird es knapp, Datei auf 512 MB erhöhen, Ablauf unverändert.
7. **Zusätzlicher `stat` je Datei** bei großen Ordnern über WAN (3.4).

## 10. Zerlegung in parallele Tasks

Zwei Wellen. Jede Datei gehört genau einem Task.

| Welle | Task | Dateien (exklusiv) | Inhalt |
|---|---|---|---|
| 1 | A Main | `src/shared/sftp.ts`, `src/main/files/file-system.ts`, `src/main/files/sftp-file-system.ts`, `src/main/files/transfer.ts`, `src/main/files/transfer.test.ts`, `src/main/files/sftp-session.ts`, `src/main/files/sftp-loopback.test.ts` | 3.1-3.4, 4.1 (Main-Teil), 7.1, 8 (Main-Tests). `keepPartial: true` in `sftp-session.ts:268-271`, `sources` in 232-235, `Job.sources` entfällt. |
| 1 | C Doku und Version | `docs/handbuch.md`, `docs/manual.md`, `CHANGELOG.md`, `CHANGELOG.en.md`, `package.json`, `package-lock.json` | 7.4 |
| 1 | D run-app | `.claude/skills/run-app/screens.mjs`, `.claude/skills/run-app/SKILL.md` | 7.5; Selektoren stehen fest (`.transfer-job.is-running button`, `.is-canceled`, Text „Fortsetzen“, „fortgesetzt ab“). Läuft erst nach Welle 2 gegen einen frischen Build. |
| 2 | B Renderer | `src/renderer/src/components/FilesPanel.tsx`, `src/shared/locales/de-DE/files.json`, `src/shared/locales/en-US/files.json`, `src/shared/locales/de-DE/errors/files.json`, `src/shared/locales/en-US/errors/files.json` | 4.1 (Renderer-Teil), 4.2, 5, 7.2, 7.3 |

Abhängigkeit: B braucht die Felder aus A (`TransferJob.sources/partial/resumedFrom/restarted`) für den Typecheck, deshalb Welle 2. A, C und D sind untereinander frei. Gate nach Welle 2: `npm run typecheck`, `npx vitest run`, dann D in der echten App mit Blick auf `sftp-transfer-canceled.png` und `sftp-transfer.png`.

## 11. Minimale erste Stufe gegenüber Extras

Erste Stufe = A bis D. Alles darin ist nötig, damit die fünf Nutzer-Entscheidungen vollständig und geprüft sind.

| Extra | Wert | Aufwand | Entscheidung |
|---|---|---|---|
| E1 Fortsetzen eines Ordners beantwortet Konflikte automatisch mit „Nur wenn neuer“ für alle (`SftpTransferRequest.conflicts?`, Schema, Startpolicy in `runTransfer`) | ★★ | kleine Main-Änderung | nicht jetzt; der Dialog kommt einmal |
| E2 Jobliste über App-Neustart persistieren | ★ | Renderer + Store | nicht jetzt |
| E3 `.part`-Einträge in der Dateiliste kennzeichnen | ★ | nur Renderer | nicht jetzt |
| E4 Auto-Upload behält eigene Abbrüche | ★ | Main | nicht jetzt, bewusst gegenteilig entschieden (6.) |
| E5 Vollständige Prüfsumme nach dem Fortsetzen | ★ | Main, teuer über das Netz | nicht jetzt |
| E6 Automatisches Neuverbinden | – | – | ausgeschlossen (Nutzer) |

## 12. Rulings-Vorschläge

- **R1** „Fortsetzen“ ist die Wiederholung der Transfer-Anfrage aus dem Renderer; `TransferJob` bekommt `sources?: string[]` (optional, damit `auto-upload.ts` unberührt bleibt). Kein neuer IPC-Kanal — überlebt den Verbindungsabbruch mit dem vorhandenen Weg — gering.
- **R2** Die Erkennung einer `.part` liegt allein in `copyFile`; Knopf, erneutes Übertragen und Auto-Upload nehmen denselben Pfad — ein Code, ein Verhalten — gering.
- **R3** Prüfung: `part.size ≤ item.size`, `item.modified ≤ part.modified + 1000` und die letzten `min(1 MB, size)` Bytes byteweise gleich. Die mtime-Bedingung verschärft die Nutzerregel, lockert nichts, und fängt eine nach dem Abbruch geänderte Quelle — kostet nichts, schließt den Datenverlust-Fall — gering (bei großem Uhrenversatz ein unnötiger Neustart).
- **R4** Streams öffnen mit `'r+'` + `start` (Node und ssh2), nie `'a'`; `read` bekommt `start`/`end` (inklusiv) — ssh2 schreibt ohnehin absolute Offsets, `O_APPEND` ignoriert sie — gering.
- **R5** Eine `.part` von 0 Bytes wird ohne Prüfung und ohne Hinweis überschrieben — nichts zum Fortsetzen — gering.
- **R6** `TransferHooks.keepPartial`: die Queue behält die `.part` bei Abbruch und Fehler, Auto-Upload übergibt nichts und räumt wie bisher — Spiegelziele bleiben sauber, Neustart-Schutz bleibt — gering.
- **R7** Verbindungsabbruch: der Renderer markiert in `report()` nicht fertige Jobs als `error` mit `files.connectionLost`; `reconnect()` behält die Jobliste; Main `finish` bleibt — kleinster Eingriff, keine Reihenfolge-Fragen — gering.
- **R8** „Teildatei verwerfen“ nutzt `sftpDelete` (Upload) bzw. `localDelete` (Download, Papierkorb) und löscht danach `partial` im Renderer-Job — keine neue IPC — gering (Adoptionsfall sichtbar harmlos).
- **R9** Fertige Dateien eines Ordner-Jobs laufen beim Fortsetzen über den vorhandenen Konfliktdialog („Nur wenn neuer“ + „Für alle“), keine Voreinstellung — Stufe 1 — gering.
- **R10** Neue Jobfelder `partial?`, `resumedFrom?`, `restarted?`; Anzeige „fortgesetzt ab {{size}}“ und „Teildatei passte nicht, neu begonnen“ als `·`-Teile; Knöpfe „Fortsetzen“ und „Teildatei verwerfen“ als `.secondary-button`, deaktiviert ohne Verbindung mit `files:sync.notConnected` als `title` — kein CSS, kein Token — gering.
- **R11** run-app: `big.bin` aus `randomBytes`, Abbrechen nach sichtbarer Rate, Fortsetzen, SHA-256-Vergleich lokal gegen Server; `sftp-transfer.png` zeigt Rate und „fortgesetzt ab“, `sftp-transfer-canceled.png` die beiden Knöpfe — Inhalt wird wirklich geprüft — gering.
- **R12** Lücken durch umsortierte WRITEs auf Fremdservern und Unterschiede vor dem letzten MB werden hingenommen; der Shortcut-Kommentar an `partial` nennt es — gering.
- **R13** Version 0.18.0; Doku als Absatz im Abschnitt „Dateiansicht: Tastatur und Übertragungen“ — Pipeline-Regel — gering.
