# Übertragungen fortsetzen und beschleunigen – Design

Auftrag: Abgebrochene Übertragungen sollen sich fortsetzen lassen (gba.zip, 5,4 GB, bei 4,1 GB abgebrochen). Die Übertragung soll schneller werden (3,8 MB/s). Bereits kopierte Daten dürfen dabei nicht zerstört werden. Grundlage ist der ergänzte Entwurf `.superpowers/sdd/transfer-resume-speed-research.md`, hier ab Abschnitt 1 vollständig übernommen. Diese Spec **ersetzt** `2026-10-21-transfer-resume-design.md`. Die Korrekturen aus `2026-10-21-transfer-resume-validation.md` sind eingearbeitet (Abschnitt 4.5 des Entwurfs) und bleiben bindend, soweit hier nichts anderes steht.

## Nutzer-Entscheidungen (bindend)

- **N1** Fortsetzen geht über einen Knopf an der fehlgeschlagenen oder abgebrochenen Übertragung. Wird dieselbe Datei erneut übertragen, setzt Shellherd automatisch fort. Ein automatisches Neuverbinden gibt es nicht.
- **N2** Vor dem Fortsetzen wird geprüft:
  - Die `.part` ist höchstens so groß wie die Quelle.
  - Das letzte MB vor dem Rückspulpunkt stimmt byteweise mit der Quelle überein.
  - Die Quelle ist nicht neuer als die `.part` (R3).
- **N3** Bricht der Nutzer ab, bleibt die `.part` erhalten. Es gibt „Teildatei verwerfen“ (nur bei regulären Dateien, B1).
- **N4** Schlägt die Prüfung fehl, beginnt die Übertragung bei 0, und die Zeile zeigt einen Hinweis.
- **N5** Das gilt für Upload und Download.
- **N6** Fortsetzen und Tempo sind ein Feature und ein PR.
- **N7** Das Fenster ist fest, etwa 4 MB in flight (128 × 32 KB). Fortgesetzt wird ab `max(0, Größe − W)`.
- **N8** Ein Ordner-Job überträgt bis zu 4 Dateien parallel. Fortgesetzt wird pro Datei.
- **N9** Ein optionaler Knopf „Prüfen“ (sha256 lokal gegen den Server) gibt es an fertig fortgesetzten Übertragungen.

## Spec-Rulings (Stufe 3)

- **S1** Es gelten die Rulings des Entwurfs (R1–R26), außerdem B1, B2 und K1–K12 der ersten Validierung, soweit Abschnitt 4.5 des Entwurfs sie nicht ersetzt.
- **S2** W wird in späteren Versionen nie kleiner (R16).
- **S3** Version `0.18.0`, CHANGELOG ohne Fettdruck.
- **S4** Abnahme:
  - Vorher-Messung mit dem heutigen Build und künstlicher Latenz, dann Nachher-Messung.
  - Abbrechen und Fortsetzen mit SHA-256-Vergleich.
  - Ordner mit vielen Dateien.
  - Die Screenshots werden angesehen.

## 1. Bestand und Lücken

### 1.1 Was heute unterwegs ist (ssh2 1.17.0, `node_modules/ssh2/lib/protocol/SFTP.js`)

| Stelle | Befund |
|---|---|
| `WriteStream._write` 3953–3981 | Ein `sftp.write` je Chunk; `cb()` erst im Ack-Callback (3970–3977). Node ruft `_write` für den nächsten Chunk erst nach `cb()`. Also **eine WRITE-Anfrage in flight**. |
| `write()` 442–490 | Chunk > `_maxWriteLen` wird zerlegt, der Rest geht **erst nach dem Ack** des ersten Teils raus (479–485). Ein 256-KiB-Chunk aus `createReadStream(…, 256 KiB)` ist 262 144 Bytes > 260 096 → **2 Anfragen nacheinander** (OpenSSH) bzw. 9 (Fremdserver, 31 952). |
| `WriteStream._writev` 3983–4012 | Schickt gepufferte Chunks gleichzeitig; greift nur, wenn Node mehr als einen Chunk gepuffert hat. Der Writable hat die Standard-hwm 16 KiB (3849, keine Option), die Pipeline pausiert den Reader nach einem gepufferten 256-KiB-Chunk; nach dem Ack räumt Node einen einzelnen Chunk mit `_write`, nicht `_writev`. Praktisch nie mehr als eine Anfrage. |
| `ReadStream._read` 3724–3794 | Ein `sftp.read` je `_read`; `push` erst im Callback (3790); Node ruft `_read` erst nach `push`. **Eine READ-Anfrage in flight**, bei 256 KiB wieder 2 Teilanfragen (`read_` 2101–2106, 2152–2157). |
| `fastXfer` 2185–2391 (`fastPut` 508, `fastGet` 502) | `concurrency` 64, `chunkSize` 32 768 (2186–2187) = 2 MiB. Öffnet das Ziel **immer mit `'w'`** (2281), liest **immer ab 0** (2378–2386): kein Offset, also kürzt es jede `.part`. Kein `signal`, kein Abbruch; `onerror` schließt nur Handles (2227–2252). Nach jedem Ack folgt die nächste Lese-Anfrage (2351–2357): die Anzahl ist begrenzt, die **Spanne** zwischen ältester offener und neuester Anfrage nicht (eine hängende Anfrage bremst die anderen nicht). `step` meldet Gesamtsumme, keine bestätigten Bytes je Anfrage. → **nicht nutzbar**, eigener Code ist kleiner (eine Schleife, ~30 Zeilen) und beweisbar. |
| Paketgrenzen 102, 116, 157–162, 2804–2815 | `_maxReadLen`/`_maxWriteLen` = 256 KiB − 2 KiB = **260 096** bei Ident `OpenSSH`/`dropbear` (115, 145), sonst **31 952**; mit `limits@openssh.com` (OpenSSH ≥ 8.5) übernimmt ssh2 die Serverwerte (OpenSSH meldet 261 120 für Lesen und Schreiben, `sftp-server` `SFTP_MAX_MSG_LENGTH` 256 KiB − 1024). Eine 32-KiB-Anfrage passt bei OpenSSH in ein Paket; bei Fremdservern zerlegt ssh2 sie in 31 952 + 816 (nacheinander, Callback erst nach beiden). |
| Kanalfenster `Channel.js:14–16`, `client.js:545–552, 572–592, 617–627`, `SFTP.js:2649–2690` | Eigenes Eingangsfenster **2 MiB** (`MAX_WINDOW`), Nachschub bei ≤ 1 MiB (`WINDOW_THRESHOLD`, client.js:590). Ausgangsfenster = was der Server gewährt (OpenSSH: 2 MiB initial, Nachschub beim Lesen aus dem Kanal). Ist es 0, **puffert ssh2 die Payload im Speicher** (`_buffer`, 2654–2658) und leert beim `CHANNEL_WINDOW_ADJUST` (2692–2710). Folge: Das Kanalfenster deckelt den Durchsatz bei etwa 2 MiB je RTT (≈ 120 MB/s bei 17 ms, ≈ 1 GB/s im LAN). Das 4-MiB-SFTP-Fenster hält das Kanalfenster dauerhaft voll; mehr SFTP-Fenster brächte ohne größeres Kanalfenster nichts. Deshalb 4 MiB und nicht mehr (Nutzer: Cipher/Kanalfenster erst bei Bedarf). |
| Antworten 2883–2920, 2823–2860, 2723–2737 | Antworten werden über `reqid` zugeordnet (`_requests`); ein Server darf in beliebiger Reihenfolge antworten, jede Anfrage bekommt ihren eigenen Callback. Bei Verbindungsende bekommen alle offenen Anfragen `No response from server` (`cleanupRequests`). READ in unseren Puffer (`req.buffer`, 2894–2903), EOF liefert 0 Bytes (2147–2165). |
| `open(path, flags, attrs)` 313–360 | `attrs` darf eine Zahl (Mode) sein; `stringToFlags('r+')` = READ|WRITE ohne CREAT/TRUNC, `'w'` = WRITE|CREAT|TRUNC. Der WriteStream setzt den Mode zusätzlich per `fchmod` (3949); dasselbe machen wir. |

Rechnung: Heute 1 Anfrage ≤ 254 KiB je RTT (OpenSSH), mit Zerlegung ~128 KiB je RTT: bei 17 ms ≈ 7,5 MB/s theoretisch; gemessen 3,8 MB/s (Server-Schreiblatenz kommt dazu). Mit 128 Anfragen à 32 KiB in flight sind es 4 MiB je RTT, gedeckelt vom Kanalfenster bei ~2 MiB je RTT ≈ 120 MB/s. Das OpenSSH-Kommandozeilen-`sftp` fährt mit 64 × 32 KiB; 128 ist die Nutzer-Entscheidung und wegen des Kanalfensters ohne Nachteil.

### 1.2 Projektcode

| Was | Wo | Befund |
|---|---|---|
| `copyFile` | `src/main/files/transfer.ts:113–142` | `pipeline(from.read, counter, to.write(partial, mode))`; Zähler zählt gestreamte Chunks (115–121), `.part` wird bei jedem Fehler gelöscht (127). Rename-Swap 132–139. |
| `runTransfer` | `transfer.ts:64–111` | Streng seriell über `items`; Ordner und Dateien gemischt in Planreihenfolge; eine Konfliktfrage zur Zeit, `policy` für „für alle“ (81–88). `doneBytes = before + item.size` (141) setzt den Zähler absolut – **mit parallelen Dateien falsch** (eine Datei überschriebe den Fortschritt der anderen). |
| `FileSystem` | `src/main/files/file-system.ts:11–28` | Nur Streams `read(path)`/`write(path, mode)`. `remote-edit.ts:59,90` und `createFile` (`sftp-session.ts:220`) nutzen sie weiter; die Kopierschleife braucht Positionszugriff. `mapLimit` (55–62) ist vorhanden und trägt die Dateiparallelität. |
| Session | `sftp-session.ts:42–47, 60, 286–299` | `session.conflict` ist **ein** Slot; `ask` überschreibt ihn. Zwei gleichzeitige Fragen → die erste bleibt unbeantwortet (Promise hängt). Parallelität verlangt eine Serialisierung in `runTransfer`. `session.client` ist der ssh2-`Client`; `client.exec` ist dort möglich (so macht es `src/main/containers/runner.ts:66`). |
| Renderer | `FilesPanel.tsx:353–379` | Zeile mit `·`-Teilen, `job.current` wird als Text gezeigt (371). Mehrere Namen in `current` brauchen keine Änderung. `.transfer-main > small` ist einzeilig mit Ellipse (`files-ui.css:82`). |
| Fakes | `transfer.test.ts:12–35` (`memory()`), `auto-upload.test.ts:16–46` (`fakeRemote`, `write` als Stream, `.part` entsteht erst in `final`) | Beide brauchen die neuen Handle-Methoden (siehe 3.1); `auto-upload.ts` selbst nicht. |
| Testserver | `sftp-loopback.test.ts:42–49`, `.claude/skills/run-app/sshd.mjs:83–90` | `OPEN` mit `flagsToString`, `READ`/`WRITE` positioniert über `readSync`/`writeSync`. Beide antworten synchron, in Reihenfolge, ohne Latenz. Kein `exec`-Handler im Loopback-Server; der run-app-Server hat `execReply` (28–48) mit festen Mustern. Beide Server melden sich als `ssh2js…`, nicht als OpenSSH: ssh2 zerlegt dort jede 32-KiB-Anfrage in zwei (Ident bleibt, siehe Risiko 9). |
| Shell-Quoting | `src/main/containers/commands.ts:15–17` `shellJoin` | Vorhanden, POSIX-sicher (`'…'` mit `'\''`). Wird für `sha256sum -- <pfad>` wiederverwendet. |
| Hash lokal | `node:crypto` `createHash('sha256')` (Muster `known-hosts.ts:16`) | Streamend über `createReadStream`. |

## 2. Empfehlung je Fläche

| Fläche | Empfehlung | Wert | Aufwand |
|---|---|---|---|
| Kopierschleife mit Fenster (128 × 32 KiB) für Upload und Download, bestätigte Bytes zählen | Ja, Kern | ★★★ | kleine Main-Änderung (`transfer.ts` ~60 Zeilen, je ~15 in beiden Dateisystemen) |
| Fortsetzen ab `size − W` mit 1-MB-Vergleich davor, `.part` behalten, Knopf „Fortsetzen“, „Teildatei verwerfen“, Verbindungsabbruch im Renderer | Ja (validierter Stand, mit Fenster) | ★★★ | Main ~40 Zeilen, Renderer ~25 Zeilen |
| Bis zu 4 Dateien parallel je Ordner-Job, eine Frage zur Zeit | Ja | ★★ | nur `transfer.ts` (~25 Zeilen) |
| Knopf „Prüfen“ (SHA-256 lokal gegen `sha256sum`) | Ja, kleinste Form (nur fertige fortgesetzte Jobs, nicht bei Verschieben) | ★★ | neue Datei `verify.ts` ~40 Zeilen, IPC 4 Zeilen, Renderer ~8 Zeilen |
| run-app: künstliche Latenz im Fake-Server, Vorher/Nachher-Messung, Abbrechen → Fortsetzen → SHA-256 | Ja | ★★ | nur run-app |
| Auto-Upload | Profitiert ohne Änderung (ein Item je `runTransfer`, Fenster greift) | ★★ | keine Zeile in `auto-upload.ts`; Fake im Test +10 Zeilen |
| Chunk 256 KiB statt 32 KiB | Nein | ★ | Kanalfenster deckelt ohnehin; 32 KiB passt auf jeden Server in ein Paket |
| Cipher-Wahl, größeres Kanalfenster, Kompression | Nein (Nutzer) | – | nicht jetzt |

## 3. Entwurf: eine Kopierschleife statt Streams

### 3.1 `FileSystem` bekommt Positionszugriff (`file-system.ts`)

```ts
/** Positional access for the copy loop. `read` returns fewer bytes only at the end of the file. */
export interface ReadHandle { read: (length: number, position: number) => Promise<Buffer>; close: () => Promise<void> }
/** `write` resolves once every byte is confirmed (local: written, server: STATUS OK). */
export interface WriteHandle { write: (data: Buffer, position: number) => Promise<void>; close: () => Promise<void> }

  openRead: (path: string) => Promise<ReadHandle>;
  /** `resume` opens an existing file without truncating (`r+`), otherwise the file is created or truncated. Servers apply `mode` (see `write`). */
  openWrite: (path: string, mode?: number, resume?: boolean) => Promise<WriteHandle>;
```
`read`/`write` (Streams) bleiben unverändert für `remote-edit.ts` und `createFile`; `sftp-file-system.test.ts` bleibt grün. Die in der Validierung vorgesehenen `start`/`end`-Parameter an den Streams **entfallen**: Der Tail-Vergleich liest über `openRead`.

Lokal (`file-system.ts`, `open` aus `node:fs/promises`):
```ts
  openRead: async path => {
    const handle = await open(path, 'r');
    return { read: async (length, position) => {
        const buffer = Buffer.allocUnsafe(length);
        let got = 0;
        // pread may return less than asked; only 0 means end of file.
        while (got < length) { const { bytesRead } = await handle.read(buffer, got, length - got, position + got); if (!bytesRead) break; got += bytesRead; }
        return buffer.subarray(0, got);
      }, close: () => handle.close() };
  },
  openWrite: async (path, _mode, resume) => {
    const handle = await open(path, resume ? 'r+' : 'w');
    return { write: async (data, position) => {
        for (let done = 0; done < data.length;) { const { bytesWritten } = await handle.write(data, done, data.length - done, position + done); done += bytesWritten; }
      }, close: () => handle.close() };
  },
```
Server (`sftp-file-system.ts`):
```ts
    openRead: async path => {
      const handle = await call<Buffer>(callback => sftp.open(path, 'r', callback));
      return { read: async (length, position) => {
          const buffer = Buffer.allocUnsafe(length);
          let got = 0;
          // ssh2 splits requests above the server's limit itself; a short answer short of EOF is asked again.
          while (got < length) {
            const bytes = await call<number>(callback => sftp.read(handle, buffer, got, length - got, position + got, (error, count) => callback(error, count)));
            if (!bytes) break;
            got += bytes;
          }
          return buffer.subarray(0, got);
        }, close: () => call<void>(callback => sftp.close(handle, error => callback(error, undefined))) };
    },
    openWrite: async (path, mode = 0o644, resume) => {
      const handle = await call<Buffer>(callback => sftp.open(path, resume ? 'r+' : 'w', mode, callback));
      // Like ssh2's write stream: servers set the mode on new and existing files alike; a refusal is not an error.
      await call<void>(callback => sftp.fchmod(handle, mode, error => callback(error, undefined))).catch(() => {});
      return { write: (data, position) => call<void>(callback => sftp.write(handle, data, 0, data.length, position, error => callback(error, undefined))),
        close: () => call<void>(callback => sftp.close(handle, error => callback(error, undefined))) };
    },
```
`sftp.write` ruft den Callback erst, wenn **alle** Teile einer zerlegten Anfrage bestätigt sind (SFTP.js:474–490); ein WRITE hat in SFTP keinen Teilerfolg (OpenSSH antwortet FAILURE, wenn `write()` kürzer schreibt). „Bestätigt“ heißt also auf beiden Seiten: alle Bytes des Stücks.

### 3.2 Die Schleife (`transfer.ts`), für Upload und Download dieselbe

Upload = `openRead` lokal + `openWrite` auf dem Server, Download umgekehrt. Es gibt keinen Lesestream mehr, deshalb auch keine Backpressure gegen einen Stream: Die Fenstersperre ist die Backpressure. Ein Stück ist „in flight“ vom Beginn seines Lesens bis zur Bestätigung seines Schreibens.

```ts
/** Copy window: pieces of `chunk` bytes, at most `inFlight` unconfirmed (4 MiB), `files` copied at once per job. Tests shrink these. */
export const TUNING = { chunk: 32 * 1024, inFlight: 128, files: 4 };
/** Bytes that may be unconfirmed at any time; a leftover .part is resumed this far before its end. Must never shrink (see resume). */
export const windowBytes = (): number => TUNING.chunk * TUNING.inFlight;
const TAIL_BYTES = 1024 * 1024;

/** Copies [start, size) in pieces. Pieces go out in order; the oldest unconfirmed piece blocks new ones, so unconfirmed bytes
 *  never span more than windowBytes(), whatever order the confirmations arrive in. Confirmed bytes are reported as they come. */
export async function copyRange(source: ReadHandle, target: WriteHandle, start: number, size: number, signal: AbortSignal,
  onConfirmed: (bytes: number) => void): Promise<void> {
  const pending = new Map<number, Promise<void>>();
  let failure: unknown;
  let eof = false;
  let offset = start;
  const piece = async (at: number): Promise<void> => {
    const want = Math.min(TUNING.chunk, size - at);
    const data = await source.read(want, at);
    if (data.length < want) eof = true;
    if (data.length) { await target.write(data, at); onConfirmed(data.length); }
  };
  // A cancel must leave the loop at once, even while the oldest piece hangs on a silent server.
  let cancel!: () => void;
  const canceled = new Promise<never>((_, reject) => { cancel = () => reject(new TransferCanceled()); });
  canceled.catch(() => {});
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (pending.size || (!eof && offset < size && failure === undefined)) {
      checkAborted(signal);
      while (!eof && offset < size && failure === undefined && pending.size < TUNING.inFlight) {
        pending.set(offset, piece(offset).catch(error => { failure ??= error; }));
        offset += TUNING.chunk;
      }
      const oldest = pending.keys().next().value as number;
      await Promise.race([pending.get(oldest), canceled]);
      pending.delete(oldest);
    }
  } finally { signal.removeEventListener('abort', cancel); }
  if (failure !== undefined) throw failure;
}
```
Eigenschaften:
- `pending` hält das älteste unbestätigte Stück und alle danach ausgegebenen (auch schon fertige). `pending.size < inFlight` ist damit genau die Spannen-Sperre: `offset − ältestes ≤ W`.
- Kopiert wird die **geplante Größe** `size` (aus `planTransfer`). Eine Datei, die während der Kopie wächst, wird bis `size` kopiert (heute: bis EOF). Auto-Upload bekommt für den Zuwachs ohnehin ein Watcher-Ereignis. Eine schrumpfende Datei endet beim kurzen Read (`eof`). Ohne Größenschranke würde die Schleife bei jeder kleinen Datei 128 READs hinter EOF schicken.
- Abbruch: `checkAborted` je Runde und das `Promise.race` gegen `canceled`, damit ein Cancel auch bei hängendem Server sofort aus der Schleife führt. Noch offene Stücke laufen in ihr `.catch` aus; danach schließt `copyFile` beide Handles und **wartet auf `close`**: OpenSSH arbeitet Anfragen eines Kanals der Reihe nach ab, das CLOSE kommt nach allen WRITEs, die `.part` ändert sich nach der Rückkehr nicht mehr. Ohne dieses Warten könnte ein spät landendes WRITE der alten Runde in eine schon neu begonnene Datei schreiben. Bei totem Server beendet `cleanupRequests` das `close` mit Fehler (ignoriert).
- Speicher: je Datei 128 × 32 KiB Puffer plus ssh2-Kopien ≈ 8 MiB; bei 4 Dateien ≈ 32 MiB Spitze.
- Fortschritt und Rate: `onConfirmed` → `job.doneBytes += bytes; job.bytesPerSecond = rate.add(bytes); hooks.progress(job)`. Gezählt werden **bestätigte** Bytes, die Reihenfolge ist egal (Summe). `emitJob` drosselt auf 200 ms, `rate.add` ist billig.

### 3.3 `copyFile` (ersetzt `transfer.ts:113–142`, mit K1–K4 der Validierung)

```ts
async function copyFile(job: TransferJob, item: PlannedItem, target: string, mode: number | undefined, from: FileSystem, to: FileSystem,
  hooks: TransferHooks, rate: RateMeter, partials: Set<string>, signal: AbortSignal): Promise<void> {
  // shortcut: a real file named x.part is taken for ours (resumed when it matches, removed otherwise); upgrade when someone reports it.
  const partial = `${target}.part`;
  const part = await to.stat(partial);
  // A folder named x.part is never ours; discarding it would delete it recursively.
  if (part && part.type !== 'file') throw new FileError('files.existsAsDirectory', { name: to.basename(partial) });
  const source = await from.openRead(item.source);
  try {
    let offset = 0;
    if (part && part.size > windowBytes()) {
      if (await resumable(source, item, to, partial, part)) { offset = part.size - windowBytes(); job.resumedFrom = (job.resumedFrom ?? 0) + offset; }
      else { await to.removeFile(partial); job.restarted = true; }
    }
    checkAborted(signal);
    partials.add(partial); job.partials = [...partials];
    let counted = offset;
    if (offset) { job.doneBytes += offset; hooks.progress(job); }
    try {
      const dest = await to.openWrite(partial, mode, offset > 0);
      try {
        await copyRange(source, dest, offset, item.size, signal, bytes => { counted += bytes; job.doneBytes += bytes; job.bytesPerSecond = rate.add(bytes); hooks.progress(job); });
      } finally { await dest.close().catch(() => {}); }
    } catch (error) {
      if (!hooks.keepPartial) { await to.removeFile(partial).catch(() => {}); partials.delete(partial); job.partials = [...partials]; }
      if (signal.aborted) throw new TransferCanceled();
      throw error;
    }
    // Rename swap: K3 of the validation, verbatim, with `partials.delete(partial); job.partials = [...partials]` wherever it set `job.partial = undefined`.
    …
    partials.delete(partial); job.partials = [...partials];
    // Files that changed size while copying still count once; other files may have counted meanwhile, so add the difference.
    job.doneBytes += item.size - counted;
  } finally { await source.close().catch(() => {}); }
}

/** A leftover .part longer than one window continues the copy at `size − window`: everything after that point may hold gaps and is rewritten,
 *  everything before it was confirmed. It qualifies when it is not longer or newer than the source and its last megabyte before that point equals the source there. */
async function resumable(source: ReadHandle, item: PlannedItem, to: FileSystem, partial: string, part: FileEntry): Promise<boolean> {
  // Servers keep whole seconds (same rule as the conflict check).
  if (part.size > item.size || item.modified > part.modified + 1000) return false;
  const end = part.size - windowBytes();
  const start = Math.max(0, end - TAIL_BYTES);
  const ours = await to.openRead(partial);
  try {
    const [mine, theirs] = await Promise.all([ours.read(end - start, start), source.read(end - start, start)]);
    return mine.length === end - start && mine.equals(theirs);
  } finally { await ours.close().catch(() => {}); }
}
```
Das Quell-Handle wird einmal geöffnet und für Tail-Vergleich und Kopie genutzt. Der Mode geht wie heute als Mode des alten Ziels mit (`openWrite(partial, mode, …)`).

## 4. Fortsetzen mit Fenster

### 4.1 Invariante und Beweis

Sei W = `windowBytes()` (4 MiB), S die Größe der `.part` nach einem Abbruch, `oldest` das älteste unbestätigte Stück und `offset` das nächste auszugebende zum Zeitpunkt des Abbruchs.

1. **Spanne.** Stücke werden in aufsteigender Reihenfolge ausgegeben, und ein neues nur, wenn `pending.size < inFlight`. `pending` enthält genau die Stücke in `[oldest, offset)`, also `offset − oldest ≤ W`. Das gilt unabhängig davon, in welcher Reihenfolge Bestätigungen eintreffen: Ein später ausgegebenes Stück kann früher bestätigt sein, bleibt aber in `pending`, bis `oldest` bestätigt ist.
2. **Bestätigt heißt vollständig.** Lokal löst `write` erst nach der Schleife über `bytesWritten` auf, auf dem Server erst nach STATUS OK für alle Teilanfragen (SFTP.js:474–490; ein WRITE kennt keinen Teilerfolg). Ein kurzes Write ist deshalb ein unbestätigtes Stück.
3. **Lage möglicher Lücken.** Jedes Stück `< oldest` ist bestätigt. Nur Stücke in `[oldest, offset)` können fehlen oder unvollständig sein. Die Datei endet spätestens beim letzten ausgegebenen Stück: `S ≤ offset`. Also `oldest ≥ offset − W ≥ S − W`, und **jede Lücke liegt in `[S − W, S)`**.
4. **Rückspulen.** Der Lauf setzt bei `R = max(0, S − W)` fort und schreibt `[R, size)` neu, mit `r+` positioniert, ohne Kürzen. Die Bytes `[0, R)` sind nach 3 bestätigt und richtig, falls die Quelle dieselbe ist. Der Vergleich der letzten `min(1 MiB, R)` Bytes vor R prüft genau das: Er liegt vollständig im bestätigten Bereich, eine Abweichung kann nur eine andere Quelle bedeuten (N2/N4 greifen: verwerfen, bei 0 beginnen, Hinweis). Dazu die mtime-Regel R3 für Änderungen vor dem verglichenen MB.
5. **Mehrfache Abbrüche.** Sei nach Lauf k die Invariante I_k: „`[0, S_k − W)` ist bestätigt“. Lauf k+1 beginnt bei `R_k = S_k − W` und schreibt ab dort. Bei dessen Abbruch ist `[R_k, oldest_{k+1})` bestätigt und `[0, R_k)` nach I_k. Ist `S_{k+1} = offset_{k+1}` (die Datei wuchs), gilt 3. Ist `S_{k+1} = S_k > offset_{k+1}` (Abbruch vor dem alten Ende), dann `S_{k+1} − W = R_k ≤ oldest_{k+1}`, also I_{k+1}. Der Bereich `[oldest_{k+1}, S_k)` kann alte Bytes aus Lauf k enthalten (womöglich mit Lücken), liegt aber innerhalb von W vor dem Ende und wird neu geschrieben.
6. **Download.** Dieselbe Schleife, Lücken entstehen nur durch unbestätigte lokale `pwrite`s; der Beweis ist identisch. Dass OpenSSH READs in Reihenfolge beantwortet, wird nicht gebraucht.
7. **Cancel durch den Nutzer.** `copyFile` wartet auf `close`; bei OpenSSH sind dann alle ausgegebenen WRITEs gelandet, die `.part` ist sogar lückenlos. Gespult wird trotzdem um W (eine Regel für alle Fälle; Kosten ≤ 4 MiB je Datei).

### 4.2 Regeln zu W

- W ist eine **Konstante** (`TUNING.chunk × TUNING.inFlight`), kein Jobfeld, nicht in der `.part` vermerkt. Gespult wird immer mit der aktuellen W.
- W darf später **nur wachsen**: Eine `.part` aus einer Version mit kleinerem W hat Lücken höchstens in den letzten W_alt < W_neu Bytes, das Rückspulen um W_neu deckt sie. Ein kleineres W_neu würde Lücken vor dem Rückspulpunkt übersehen (der 1-MB-Vergleich sieht nur das MB davor). Kommentar an `windowBytes` sagt es (Ruling R16).
- `.part`-Dateien aus 0.17 (serielle Streams, eine Anfrage in flight) sind lückenlose Präfixe; Rückspulen um 4 MiB ist nur Mehrarbeit.
- Eine `.part` von **höchstens W Bytes** wird ohne Prüfung und ohne Hinweis mit `'w'` neu geschrieben (R = 0, nichts zu übernehmen); das verallgemeinert R5 (0 Bytes). Die Größen-/mtime-Prüfung und `restarted` greifen erst ab `part.size > W`.

### 4.3 Randfälle (ergänzt gegenüber Spec 3.4)

| Fall | Verhalten |
|---|---|
| `.part` ≤ W | `'w'`, kein Hinweis, kein `removeFile`. |
| `.part` > W, Tail vor R gleich | `r+`, Kopie ab R, `resumedFrom += R`. |
| `.part` = Quelle (vollständig) | R = size − W, die letzten 4 MiB werden neu geschrieben, dann Swap. |
| `.part` > Quelle, Quelle neuer, Tail ungleich | `removeFile`, `restarted`, von 0 (wie validiert). |
| Abweichung **nach** R in der `.part` | unerheblich, wird überschrieben. |
| Quelle schrumpft während einer fortgesetzten Kopie | Kopie endet beim kurzen Read; alte Bytes jenseits davon bleiben in der `.part` (kein Kürzen bei `r+`); nach dem Swap ist die Datei zu lang. Wie heute mit `r+`; Risiko 6. |
| Stall des Servers | Cancel wirkt sofort (`race`), `close` wartet auf den Server oder das Sessionende. |

### 4.4 Fortschritt

`doneBytes += R` vor der Kopie (nur bei R > 0, K2), danach bestätigte Bytes; am Ende `+= item.size − counted`. Die Rate sieht nur gestreamte, bestätigte Bytes. Mit 4 Dateien parallel ist `rate` ein gemeinsamer Zähler über alle Arbeiter, also die Jobrate.

### 4.5 Abgleich mit der Validierung (bindend, was sich ändert)

| Korrektur | Stand |
|---|---|
| K1 Ordner `x.part` | Bleibt wörtlich. |
| K2 Progress nur bei Offset | Bleibt. Der Rate-Test (`transfer.test.ts:52–65`) bleibt im Rumpf gleich, setzt aber `TUNING.chunk = 1024` (drei Stücke von 1024 Bytes wie bisher drei Chunks); `threeChunks` entfällt, weil die Schleife selbst in Stücken liest. |
| K3 Rename-Ausweichpfad | Bleibt wörtlich; `job.partial = undefined` wird `partials.delete(partial); job.partials = [...partials]`. |
| K4 `checkAborted` vor `job.partial` | Bleibt (vor `partials.add`). |
| K5 Quellen beim Verschieben | Bleibt, im Datei-Arbeiter. |
| K6 Session | Bleibt (`Job.sources` bleibt, `sources: [...request.sources]`, `keepPartial: true`), dazu `copied` (6.). |
| K7 Renderer | Bleibt; `partial` wird `partials: string[]` (bis zu 4 Teildateien), `sftpDelete`/`localDelete` nehmen die Liste. `title` = Pfade mit Zeilenumbruch. |
| K8 `memory()`-FS | `read(start,end)`/`write(start)` entfallen; stattdessen `openRead`/`openWrite` (8.1). Fälle 1–12 mit Fensterzahlen (8.1). |
| K9 `job.partial` nach Abbruch | `job.partials` enthält den Pfad bzw. ist leer. |
| K10 Loopback | Größen an W angepasst: 12 MiB, Stall ab 8 MiB, `resumedFrom` = 4 MiB (8.2). |
| K11 run-app | Bleibt, dazu Latenz, Rate-Protokoll, `Prüfen`, dritter Shot (7.5). |
| K12 Texte | Bleiben, dazu je eine Zeile Tempo und Prüfen (7.4). |
| Prüfergebnis „Lücke in den letzten ≤ 512 KiB“ | Wird „in den letzten W = 4 MiB“, deshalb das Rückspulen (Nutzer-Entscheidung). R12/Spec-Risiko 2 bleibt gestrichen: Lücken auf umsortierenden Servern liegen beweisbar in `[S − W, S)`. |
| Vertrag `read(start,end)`/`write(mode,start)` | **Entfällt** (3.1). |
| `TransferJob.partial?: string` | **Wird** `partials?: string[]`. |

## 5. Ordner-Jobs: bis zu 4 Dateien parallel (`runTransfer`)

```ts
export async function runTransfer(job, items, from, to, hooks, signal): Promise<void> {
  const rate = rateMeter();
  let policy: ConflictChoice | undefined;
  let asking: Promise<unknown> = Promise.resolve();
  const partials = new Set<string>();
  const running = new Set<string>();
  job.totalFiles = …; job.totalBytes = …; hooks.progress(job);
  // Folders first, parents before children (plan order); files afterwards, a few at a time.
  for (const item of items) {
    if (item.type !== 'directory') continue;
    checkAborted(signal);
    const existing = await to.stat(item.target);
    if (existing && existing.type !== 'directory') throw new FileError('files.existsAsFile', { name: item.name });
    if (!existing) await to.mkdir(item.target);
  }
  // The session holds one open question at a time; an answer "for all" settles the questions still waiting.
  const decide = (item: PlannedItem, existing: FileEntry): Promise<ConflictChoice> => {
    const turn = asking.then(async () => {
      if (policy) return policy;
      job.bytesPerSecond = undefined; rate.reset();
      const answer = await hooks.conflict({ name: item.name, source: { size: item.size, modified: item.modified }, target: { size: existing.size, modified: existing.modified } });
      if (answer.applyToAll) policy = answer.choice;
      return answer.choice;
    });
    asking = turn.catch(() => {});
    return turn;
  };
  // One failure or cancel stops every worker; the first error is the job's error.
  const inner = new AbortController();
  const relay = (): void => inner.abort();
  signal.addEventListener('abort', relay, { once: true });
  let failure: unknown;
  const one = async (item: PlannedItem): Promise<void> => {
    checkAborted(inner.signal);
    running.add(item.name); job.current = [...running].join(', ');
    try {
      const existing = await to.stat(item.target);
      if (existing) {
        if (existing.type === 'directory') throw new FileError('files.existsAsDirectory', { name: item.name });
        const choice = policy ?? await decide(item, existing);
        checkAborted(inner.signal);
        if (choice === 'cancel') throw new TransferCanceled();
        // Servers keep whole seconds; a smaller difference is not "newer".
        if (choice === 'skip' || (choice === 'newer' && item.modified <= existing.modified + 1000)) { job.skippedFiles += 1; job.doneBytes += item.size; hooks.progress(job); return; }
      }
      const target = existing ? await to.realpath(item.target).catch(() => item.target) : item.target;
      await copyFile(job, item, target, existing?.mode, from, to, hooks, rate, partials, inner.signal);
      await to.setModified(target, item.modified).catch(() => {});
      if (job.move) { await from.removeFile(item.source); if (job.sources) job.sources = job.sources.filter(source => source !== item.source); }
      hooks.copied?.(item.source, target);
      job.doneFiles += 1;
      hooks.progress(job);
    } finally { running.delete(item.name); job.current = [...running].join(', ') || undefined; }
  };
  try {
    await mapLimit(items.filter(item => item.type === 'file'), TUNING.files, async item => {
      if (failure !== undefined) return;
      try { await one(item); } catch (error) { failure ??= error; inner.abort(); }
    });
  } finally { signal.removeEventListener('abort', relay); }
  if (failure !== undefined) throw failure;
  if (job.move) { /* deepest folders first, unchanged */ }
  job.current = undefined;
}
```
- **Reihenfolge:** alle Ordner zuerst (Planreihenfolge = Eltern vor Kindern), dann Dateien über `mapLimit(…, 4)` in Planreihenfolge begonnen. Neu gegenüber heute: Bei einem Cancel in der ersten Konfliktfrage sind die Ordner schon angelegt (leer). Hingenommen.
- **Konfliktdialog:** genau einer zur Zeit (`asking`-Kette); `session.conflict` (ein Slot) bleibt. Während die Frage offen ist, kopieren die anderen Arbeiter weiter; die Rate ist kurz leer und kommt nach einer Sekunde wieder. Ein „für alle“ beantwortet wartende Fragen ohne Dialog (`policy`-Prüfung in der Kette).
- **Zähler:** `doneFiles`/`doneBytes`/`skippedFiles` sind reine Inkremente, der absolute `doneBytes = before + size` entfällt (siehe 3.3). `current` = laufende Namen mit `, ` getrennt (Renderer unverändert, Ellipse in der Zeile).
- **Abbruch:** `inner` bricht alle Arbeiter ab; jeder behält seine `.part` (`keepPartial`), `job.partials` listet bis zu 4 Pfade. „Fortsetzen“ schickt dieselbe Anfrage, jede Datei setzt ab ihrem eigenen R fort; fertige Dateien laufen über den Konfliktdialog wie validiert (K-Prüfergebnis „Konfliktdialog“).
- **Auto-Upload:** ruft `runTransfer` mit genau einem Item (`auto-upload.ts:271`), also ohne Dateiparallelität, aber mit Fenster. Unverändert.

## 6. Knopf „Prüfen“ (SHA-256)

- **Wo:** an Jobs mit `state === 'done'`, `resumedFrom > 0` und `!move` (beim Verschieben ist die Quelle weg). Knopf `Prüfen` neben `Fortsetzen`/`Teildatei verwerfen`, nur mit Verbindung (`disabled` + `title` `files:sync.notConnected`), während der Prüfung `disabled`.
- **Was:** Main merkt sich je Queue-Job die kopierten Paare über einen neuen Hook `copied?: (source, target) => void` (`TransferHooks`), in `pump` als `entry.copied.push(…)` (Main-seitig, nie im Snapshot). Höchstens 10 000 Paare; darüber wirft `verify` `files.verifyTooMany`. Endet ein Job ohne `resumedFrom`, wird `copied` im `finally` von `pump` geleert (Speicher).
- **Wie:** neue Datei `src/main/files/verify.ts`:
  ```ts
  const command = (path: string): string => `${shellJoin(['sha256sum', '--', path])} 2>/dev/null || ${shellJoin(['shasum', '-a', '256', '--', path])}`;
  /** Hex digest from `sha256sum` (coreutils, BusyBox) or `shasum -a 256` (macOS); anything else means the server cannot answer. */
  export function sha256Remote(client: Client, path: string): Promise<string> {
    return new Promise((resolve, reject) => {
      client.exec(command(path), (error, stream) => {
        if (error) { reject(new FileError('files.verifyUnavailable')); return; }
        let out = '';
        stream.on('data', (chunk: Buffer) => { if (out.length < 4096) out += chunk.toString('utf8'); });
        stream.stderr.resume();
        stream.on('close', () => { const match = /^([0-9a-f]{64})\s/i.exec(out); match ? resolve(match[1].toLowerCase()) : reject(new FileError('files.verifyUnavailable')); });
      });
    });
  }
  export function sha256Local(path: string): Promise<string>   // createReadStream → createHash('sha256'), pipeline
  /** Names of copied files whose digests differ; local and server digests run side by side, files one after another. */
  export async function verifyCopies(client: Client, pairs: { source: string; target: string }[], direction: TransferDirection): Promise<string[]>
  ```
  `shellJoin` kommt aus `src/main/containers/commands.ts` (POSIX-Quoting, dort getestet). Der Pfad stammt aus `entry.copied` (Main-Zustand, vom Job selbst geschrieben), nie aus dem Renderer; die IPC trägt nur `jobId`. `exec` läuft über `session.client`, einen zweiten Kanal neben dem SFTP-Kanal; `MaxSessions` (OpenSSH-Standard 10) reicht. Ein Server mit `ForceCommand internal-sftp` lehnt den Kanal ab → `files.verifyUnavailable`. Fehlt `sha256sum` (dann `shasum`), ist die Datei unlesbar oder beides fehlt → kein Hex → derselbe Code. Zeitlimit: keins (5 GB dauern auf dem Server Sekunden bis Minuten); das Sessionende beendet den Kanal.
- **Session** (`sftp-session.ts`, Welle 2):
  ```ts
  /** "Prüfen": sha256 of every file the job copied, local stream against sha256sum on the server. Result lands on the job and is emitted. */
  async verify(ownerId: number, id: string, jobId: string): Promise<void> {
    const session = this.owned(ownerId, id);
    const entry = session.jobs.find(item => item.job.id === jobId);
    if (!entry || entry.job.state !== 'done' || !entry.job.resumedFrom || entry.job.verify === 'running') return;
    if (entry.copied.length > VERIFY_MAX) throw new FileError('files.verifyTooMany', { max: VERIFY_MAX });
    entry.job.verify = 'running'; entry.job.mismatched = undefined; this.emitJob(session, entry, true);
    try {
      const mismatched = await verifyCopies(session.client, entry.copied, entry.job.direction);
      entry.job.verify = mismatched.length ? 'mismatch' : 'ok';
      entry.job.mismatched = mismatched.length ? mismatched : undefined;
    } catch (error) { entry.job.verify = undefined; throw error; }
    finally { if (this.active(session)) this.emitJob(session, entry, true); }
  }
  ```
- **IPC:** `IPC_CHANNELS.sftpVerify = 'sftp:verify'`, `desktopApi.sftpVerify(request: SftpJobRequest): Promise<void>`, Preload-Zeile, Handler mit dem vorhandenen `JobSchema` (`ipc.ts:32`). Kein neues Zod-Schema.
- **Anzeige:** in der `·`-Zeile: `Prüfung läuft`, `Prüfsumme stimmt`, `Prüfsumme weicht ab: a.bin, b.bin`. Fehler (`verifyUnavailable`, `verifyTooMany`) kommen als IPC-Rejection und landen wie andere Aktionen in `actionError` (`FilesPanel.tsx:314`). Nicht über `run()`, damit die Panes während einer Minuten-Prüfung nicht gesperrt sind.
- **Felder** (`TransferJob`): `verify?: 'running' | 'ok' | 'mismatch'`, `mismatched?: string[]` (Namen).

## 7. Querschnitt

### 7.1 Geteilte Typen (`src/shared/sftp.ts`, nach `bytesPerSecond`)

```ts
  /** Absolute paths on the source side as requested; moved top-level files leave the list. Absent for auto-upload. */
  sources?: string[];
  /** Target-side paths of half-written .part files: set while files are copied, kept after a cancel or failure, gone after the swap. */
  partials?: string[];
  /** Bytes taken over from leftover .part files when the copy continued (sum over the job). */
  resumedFrom?: number;
  /** A leftover .part did not match the source and was discarded; the copy started over. */
  restarted?: boolean;
  /** "Prüfen": sha256 of every copied file on both sides; `mismatched` names the files that differ. */
  verify?: 'running' | 'ok' | 'mismatch';
  mismatched?: string[];
```
`TransferHooks`: `keepPartial?: boolean` (validiert) und `copied?: (source: string, target: string) => void`.

### 7.2 Session (`sftp-session.ts`)

Welle 1 (Task A): `Job.copied: { source: string; target: string }[]` (leer angelegt), Job-Literal `sources: [...request.sources]`, Hooks `keepPartial: true, copied: (source, target) => { if (entry.copied.length <= VERIFY_MAX) entry.copied.push({ source, target }); }`; im `finally` von `pump`: `if (!job.resumedFrom) entry.copied = [];`. `finish`, `cancel`, `state`, `clearFinished` unverändert. Welle 2 (Task F): `verify` wie in 6.

### 7.3 Renderer (`FilesPanel.tsx`), Stand der Validierung plus

- `discardPartial`: `paths: job.partials` (Liste), `partials: undefined` danach; Knopf nur bei `job.partials?.length`, `title={job.partials.join('\n')}`.
- `verify = (job) => { if (!sessionId) return; void window.desktopApi.sftpVerify({ sessionId, jobId: job.id }).catch(error => setActionError(fail(error))); }`; `TransferQueue` bekommt `onVerify`.
- Knopf nach „Teildatei verwerfen“:
  ```tsx
  {job.state === 'done' && !!job.resumedFrom && !job.move && <button type="button" className="secondary-button" disabled={!canResume || job.verify === 'running'}
    title={canResume ? undefined : t('files:sync.notConnected')} onClick={() => onVerify(job)}>{t('files:queue.verify')}</button>}
  ```
  Statuszeile nach `restarted`:
  ```tsx
  {job.verify === 'running' && ` · ${t('files:queue.verifying')}`}
  {job.verify === 'ok' && ` · ${t('files:queue.verified')}`}
  {job.verify === 'mismatch' && ` · ${t('files:queue.verifyMismatch', { names: (job.mismatched ?? []).join(', ') })}`}
  ```
  Kein CSS, kein Token, keine Bewegung (wie validiert).

### 7.4 Texte

`files.json` → `queue` (validierte vier Keys bleiben wörtlich), dazu:

| Key | de-DE | en-US |
|---|---|---|
| `queue.verify` | Prüfen | Verify |
| `queue.verifying` | Prüfung läuft | verifying |
| `queue.verified` | Prüfsumme stimmt | checksum matches |
| `queue.verifyMismatch` | Prüfsumme weicht ab: {{names}} | checksum differs: {{names}} |

`errors/files.json` → `files` (`connectionLost` bleibt), dazu:

| Key | de-DE | en-US |
|---|---|---|
| `verifyUnavailable` | Der Server liefert keine Prüfsumme: sha256sum fehlt, die Datei ist nicht lesbar oder Befehle sind nicht erlaubt. | The server returned no checksum: sha256sum is missing, the file is unreadable or commands are not allowed. |
| `verifyTooMany` | Prüfen geht bis {{max}} Dateien je Übertragung. | Verify covers up to {{max}} files per transfer. |

CHANGELOG `## [0.18.0] – 2026-10-21`: die beiden Zeilen aus K12 wörtlich, davor:
- de: „- Übertragungen schicken jetzt viele Anfragen gleichzeitig statt einer nach der anderen und kopieren bei Ordnern bis zu vier Dateien parallel. Über das Internet sind sie dadurch um ein Vielfaches schneller.“ en: „- Transfers now keep many requests in flight instead of one at a time and copy up to four files of a folder in parallel. Over the internet they are many times faster.“
- de: „- Neu: Prüfen vergleicht nach einer fortgesetzten Übertragung die SHA-256-Prüfsumme jeder Datei lokal und auf dem Server.“ en: „- New: Verify compares the SHA-256 checksum of every file locally and on the server after a resumed transfer.“

Handbuch (`docs/handbuch.md` nach 348, `manual.md` nach 344): Absatz aus Spec 7.4 + K12-Satz, mit zwei Ergänzungen: „Fortgesetzt wird vier Megabyte vor dem Ende der Teildatei, weil bis dahin noch Daten unterwegs gewesen sein können; das letzte Megabyte davor wird mit der Quelle verglichen.“ und „`Prüfen` an einer fertigen, fortgesetzten Übertragung berechnet die SHA-256-Prüfsumme jeder Datei lokal und mit `sha256sum` auf dem Server und zeigt, ob sie übereinstimmen. Das braucht eine Shell auf dem Server; reine SFTP-Konten melden, dass keine Prüfsumme möglich ist.“ Dazu im Absatz Geschwindigkeit (Zeile 346): „Shellherd hält dabei bis zu vier Megabyte an Anfragen gleichzeitig unterwegs und kopiert bei Ordnern bis zu vier Dateien parallel; die Zeile nennt die gerade laufenden Dateien.“

### 7.5 run-app

`sshd.mjs` (Welle 0, Task D0):
- `const LATENCY = Number(process.env.SSHD_LATENCY_MS ?? 0)`; `const later = run => LATENCY ? setTimeout(run, LATENCY) : run();` um die Handler `READ` und `WRITE` (Antwort je Anfrage um 10 ms verzögert, Reihenfolge bleibt). Kommentar in der Kopfzeile.
- `execReply`: `const sum = /^sha256sum -- (\S+|'(?:[^']|'\\'')*') 2>\/dev\/null \|\| shasum /.exec(command)` → Wort entquoten (`'\''` → `'`, Außenquotes ab) → `local(p)` aus dem SFTP-Handler (dafür `local` nach oben ziehen oder als Parameter geben) → `createHash('sha256')` der Datei → `{ out: \`${hex}  ${p}\n\`, code: 0 }`; Datei fehlt → `{ err, code: 1 }`. Kopfkommentar anpassen: der Pfad wird nur über `local()` (auf die SFTP-Wurzel beschränkt) gelesen, nie ausgeführt.
- **Vorher-Messung** (Orchestrator, vor Welle 1, mit dem heutigen Build): `SSHD_LATENCY_MS=10 npm run drive:sshd`, `screens.mjs sftp` (heutiger Stand), die Rate aus `sftp-transfer.png` ins Ledger (erwartet ≈ 3 MB/s: 256-KiB-Chunk = 9 Anfragen à 10 ms beim ssh2-Ident).

`screens.mjs` (Welle 1, Task D), im `sftp`-Block, Stand K11 plus:
- Nach `waitFor('Rate', …)` die Rate ins Protokoll: `console.log(\`Rate: ${await evaluate(\`(document.querySelector('${queue}')?.innerText.match(/\\d[\\d,.]*\\s?[KMG]B\\/s/) ?? [''])[0]\`)}\`)`.
- Ablauf: 512 MiB `big.bin` aus `randomBytes` (K11), Abbruch bei 1–40 % (K11), `shot('sftp-transfer-canceled')` (beide Knöpfe), Fortsetzen, `waitFor('fortgesetzt', /fortgesetzt ab/ und Rate)`, `shot('sftp-transfer')`, `waitFor('Upload fertig', …, { timeout: 300000 })`, SHA-256 beider Dateien streamend im Node-Prozess (K11), dann Klick auf `Prüfen` (Knopf per Text in der `.is-done`-Zeile), `waitFor('Prüfsumme', textContent enthält 'Prüfsumme stimmt', { timeout: 120000 })`, `shot('sftp-transfer-verified')`. `finally` wie K11.
- `SKILL.md` Zeilen 23 und 33: `sftp-transfer-canceled.png` und `sftp-transfer-verified.png`; Abschnitt „Nachher-Messung: `SSHD_LATENCY_MS=10`, Rate im Protokoll“.

## 8. Tests

### 8.1 `transfer.test.ts`

`memory()` bekommt `openRead`/`openWrite` auf `nodes` (Daten als `latin1`-String, positionierte Writes füllen Lücken mit `\0`), mit Optionen `{ shuffle?: boolean; stallFrom?: number }`: `shuffle` lässt jedes Write nach `[3, 0, 2, 1][index % 4]` ms landen (feste Reihenfolge, nicht zufällig), `stallFrom` lässt Writes ab diesem Offset nie auflösen. `openWrite(path, mode, true)` ohne Datei wirft synchron `ENOENT` (K8). Jeder Testfall, der Fenster braucht, setzt `TUNING` (`afterEach` stellt `{ chunk: 32768, inFlight: 128, files: 4 }` wieder her). Quelle `/a.bin` = `'abcdefgh'`, `TUNING = { chunk: 1, inFlight: 2 }` (W = 2):

1. `.part` = `'abcde'` → `resumedFrom 3`, Ergebnis `'abcdefgh'`, `openWrite` mit `('/target/a.bin.part', undefined, true)`, `partials` leer, kein `restarted`.
2. `.part` = `'abXde'` → `removeFile` aufgerufen, `restarted true`, Ergebnis richtig (Vergleich `[0,3)`).
3. `.part` = `'abcdefghij'` → `restarted`. Quelle `modified 10_000`, `.part` `1000` → `restarted`.
4. `.part` = `'abcdefgh'` → `resumedFrom 6`, Ergebnis gleich.
5. `.part` = `'ab'` (≤ W) → kein `restarted`, kein `resumedFrom`, `removeFile` nicht aufgerufen, `openWrite(…, false)`.
6. `.part` = `'abcdX'` (Abweichung nach R = 3) → fortgesetzt, Ergebnis richtig (dokumentiert, dass alles nach R neu geschrieben wird).
7. Abbruch mit `keepPartial: true` und `stallFrom`: Quelle 64 Bytes Muster, `TUNING = { chunk: 4, inFlight: 4 }`, `stallFrom: 32`; `progress` bricht ab, sobald `doneBytes ≥ 32`. Erwartet `TransferCanceled`, `job.partials = ['/target/a.bin.part']`, `.part`-Länge 32, kein Ziel. Dann derselbe Transfer ohne Stall → `resumedFrom 16`, und `createHash('sha256')` des Ergebnisses gleich dem der Quelle. Ohne `keepPartial` bleibt der bestehende Löschtest und prüft `partials` leer (K9).
8. `shuffle` mit 1000 Bytes Muster, `TUNING = { chunk: 7, inFlight: 5 }` → Hash gleich.
9. Invariante direkt an `copyRange` mit Fake-Handles: `TUNING = { chunk: 4, inFlight: 3 }`, das Write bei Offset 0 bleibt offen, alle anderen lösen sofort auf; nach ein paar Ticks ist der höchste ausgegebene Offset < 12; nach dem Freigeben endet die Kopie mit allen Offsets `0, 4, …`.
10. Ordner `/target/a.bin.part` → `files.existsAsDirectory`, Ordner bleibt, `partials` undefined (K8/9).
11. Strikter Rename, `.part` verschwindet vor dem Rename → Fehler, `/target/a.txt` behält `'old'` (K8/10).
12. Verschieben mit `job.sources = ['/a.txt', '/b.txt']`, `/b.txt` liest mit Fehler → `sources` = `['/b.txt']` (K8/11).
13. Parallel: 6 Dateien, davon 2 mit vorhandenem Ziel, `conflict` zählt gleichzeitige Aufrufe → nie > 1; `applyToAll` beim ersten → zweiter Aufruf bleibt aus. `TUNING.files = 4`.
14. Rate-Test 52–65 mit `TUNING.chunk = 1024`, Erwartungen unverändert; Konflikt-Rate-Test 67–87 mit `TUNING.files = 1`, unverändert.
15. Bestehender Test 206–214 erwartet `openWrite` mit `('/target/a.txt.part', 0o600, false)`.

### 8.2 `sftp-loopback.test.ts` (eigener Ordner `/resume`, am Ende `manager.delete`)

- Testserver: `let stallWritesFrom: number | undefined` (K10) und `let shuffleWrites = false` (Antwort nach `setTimeout(…, [3,0,2,1][reqid % 4])`). Kein `exec`.
- Upload-Resume: `resume/part.bin` 12 MiB Muster `i % 251`, alte mtime; Server `.part` = erste 8 MiB → `{ state: 'done', resumedFrom: 4 MiB, sources: [pfad] }`, Serverdatei byte-gleich, keine `.part`.
- Mismatch: `.part` 8 MiB mit gekipptem Byte bei 3,5 MiB (im verglichenen MB) → `restarted: true`, Datei gleich. Gekipptes Byte bei 6 MiB → `resumedFrom`, Datei trotzdem gleich.
- Abbrechen behält (K10): `stallWritesFrom = 8 MiB`, Upload 12 MiB, Polling bis `.part` ≥ 8 MiB, `manager.cancel` → `{ state: 'canceled', partials: ['/resume/huge.bin.part'] }`, dann ohne Stall → `done`, `resumedFrom: 4 MiB`, byte-gleich.
- Shuffle: `shuffleWrites = true`, Upload 12 MiB → byte-gleich.
- Download-Resume: `/resume/dl.bin` 12 MiB Muster, lokale `.part` = erste 8 MiB → `resumedFrom: 4 MiB`, gleich.
- Ordner parallel: `resume/dir` mit 6 Dateien à 1 MiB → `doneFiles 6`, alle gleich.
- `readdirSync(remoteRoot)` bleibt im letzten Test leer.

### 8.3 `verify.test.ts`

Fake-`Client` mit `exec(command, cb)`, der `command` aufzeichnet und einen `PassThrough` liefert: (a) Hex-Zeile → Digest; (b) `sh: sha256sum: not found` und Exit 127 → `files.verifyUnavailable`; (c) `exec`-Fehler → `verifyUnavailable`; (d) Pfad `/srv/it's here.bin` → Kommando enthält `'/srv/it'\''s here.bin'`; (e) `verifyCopies` mit einer lokalen Temp-Datei und Fake-Antwort gleich/ungleich → `[]` bzw. `['x.bin']`.

### 8.4 Unverändert

`auto-upload.ts`, `sftp-session.test.ts`, `remote-edit.test.ts`, `sftp-file-system.test.ts`. `auto-upload.test.ts`: nur `fakeRemote` bekommt `openWrite` (Daten im Speicher, Knoten entsteht erst bei `close` – wie heute in `final`; `failOn` → `write` wirft `boom`, `missingOn` → `openWrite` wirft Code 2, `writeDelayMs` → Verzögerung in `close`). Die Testfälle bleiben.

## 9. Regeln und Risiken: was ausdrücklich nicht getan wird

- Kein `fastPut`/`fastGet` (kürzt, kein Offset, kein Abbruch, unbegrenzte Spanne). Keine ssh2-Patches.
- Kein größeres Kanalfenster, keine Cipher-Wahl, keine Kompression (Nutzer). Chunk bleibt 32 KiB.
- Kein automatisches Neuverbinden, kein neues Zod-Schema (Verify nutzt `JobSchema`), kein Preload jenseits einer Zeile.
- Keine Prüfsumme in der `.part`, kein Index der Lücken: das Fenster und das Rückspulen ersetzen beides.
- Kein `ftruncate` nach einer geschrumpften Quelle (Risiko 6), kein Kürzen der `.part` beim Fortsetzen.
- `Prüfen` nur an fertigen, fortgesetzten, nicht verschobenen Jobs; keine Prüfung aller Jobs, keine automatische Prüfung, kein Verwerfen bei Abweichung.
- `auto-upload.ts`, `remote-edit.ts`, CSS, Tokens, Motion-Gate unverändert. Main `finish` unverändert.
- Sicherheitsregeln früherer Specs gelten: Ziel nie vor dem Ende ersetzen, auf dem Server nur `move`/Swap/„Verwerfen“ löschen, Pfade nur über vorhandene Schemata; das `exec`-Kommando entsteht aus Main-Zustand mit `shellJoin`.

Risiken:
1. **W darf nie schrumpfen** (4.2). Kommentar und Ruling; keine Laufzeitprüfung möglich.
2. **Speicher**: bis zu 32 MiB Puffer bei 4 Dateien; dazu ssh2-`_buffer`, wenn das Kanalfenster 0 ist (≤ W je Datei).
3. **Rate-Lücke bei Konfliktfrage** mit parallelen Dateien: die anderen Arbeiter laufen weiter, die Rate ist eine Sekunde leer.
4. **Ordner vor Dateien**: Bei Cancel in der ersten Frage bleiben leere Ordner stehen.
5. **`current`** zeigt bis zu 4 Namen, die Zeile kürzt mit Ellipse.
6. **Quelle schrumpft während fortgesetzter Kopie** → zu lange Zieldatei (wie heute mit `r+`). `Prüfen` deckt es auf.
7. **Prüfen auf SFTP-only-Konten** geht nicht; der Hinweis sagt es. `shasum` auf macOS; andere Exoten melden „nicht verfügbar“.
8. **Lange Prüfung**: keine Abbruchmöglichkeit außer Sitzung schließen; der Knopf ist solange gesperrt.
9. **Fake-Server-Ident** (`ssh2js`): ssh2 zerlegt dort jedes 32-KiB-Stück in zwei Anfragen (31 952 + 816). Das Fenster bleibt 128 Stücke; die Messung ist konservativ. Ident bleibt, weil ssh2 bei OpenSSH-Ident OpenSSH-eigene Anfragen freischaltet (`client.js:65, 1426 ff.`, `strictVendor`) und wir das nicht mitprüfen wollen.
10. **run-app-Timing** (K11): Nach der Beschleunigung läuft 512 MiB über Loopback in wenigen Sekunden; 1–40 % mit 100-ms-Polling sind mindestens ~1 s Fenster. Wird es knapp, Datei auf 1 GiB.
11. **Threadpool**: lokale `pread`/`pwrite` laufen über libuv (4 Threads); kein Engpass gegenüber dem Netz.
12. Validierungsrisiken 1–9 bleiben (Uhrenversatz, zwei Sitzungen, veralteter Snapshot, Papierkorb, Nutzlast `sources`, übersprungene halbe Datei).

## 10. Zerlegung in Wellen

Jede Datei gehört je Welle genau einem Task; eine spätere Welle darf eine Datei einer früheren erweitern (nur `sftp-session.ts`, `sshd.mjs`). Nach jeder Welle `npm run typecheck` und `npx vitest run` grün, ein Commit je Task.

| Welle | Task | Dateien (exklusiv) | Inhalt |
|---|---|---|---|
| 0 | D0 Fake-Server | `.claude/skills/run-app/sshd.mjs` | 7.5: `SSHD_LATENCY_MS`, `sha256sum`-Antwort in `execReply`. Danach **Vorher-Messung** durch den Orchestrator (heutiger Build, `SSHD_LATENCY_MS=10`), Wert ins Ledger. |
| 1 | A Kern und Verträge | `src/shared/sftp.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/files/file-system.ts`, `src/main/files/sftp-file-system.ts`, `src/main/files/transfer.ts`, `src/main/files/transfer.test.ts`, `src/main/files/auto-upload.test.ts`, `src/main/files/sftp-session.ts` | 3, 4, 5, 7.1, 7.2 (Welle-1-Teil), 8.1, 8.4. `sftpVerify` nur als Kanalname, `desktopApi`-Typ und Preload-Zeile (Handler kommt in F). |
| 1 | C Doku und Version | `docs/handbuch.md`, `docs/manual.md`, `CHANGELOG.md`, `CHANGELOG.en.md`, `package.json`, `package-lock.json` | 7.4 (K12 plus zwei Zeilen), `npm run version:minor` → 0.18.0. |
| 1 | D run-app | `.claude/skills/run-app/screens.mjs`, `.claude/skills/run-app/SKILL.md` | 7.5 (K11, Rate-Protokoll, Prüfen, dritter Shot). Ausgeführt erst nach Welle 2. |
| 2 | B Renderer und Texte | `src/renderer/src/components/FilesPanel.tsx`, `src/shared/locales/de-DE/files.json`, `src/shared/locales/en-US/files.json`, `src/shared/locales/de-DE/errors/files.json`, `src/shared/locales/en-US/errors/files.json` | Validierung Vertrag Renderer/Texte (K7) mit `partials`, 7.3, 7.4 (Keys). |
| 2 | E Loopback | `src/main/files/sftp-loopback.test.ts` | 8.2 (Stall, Shuffle, Resume beidseitig, Ordner parallel). |
| 2 | F Prüfen (Main) | `src/main/files/verify.ts` (neu), `src/main/files/verify.test.ts` (neu), `src/main/files/ipc.ts`, `src/main/files/sftp-session.ts` (nur `verify`, `VERIFY_MAX`) | 6, 8.3. |

Abhängigkeiten: B, E, F brauchen A (Typen, Hooks, Session-Zeilen). B braucht den `sftpVerify`-Typ aus A. D0 steht allein und muss vor der Vorher-Messung liegen. Gate nach Welle 2: Typecheck, Vitest, dann run-app `sftp` mit `SSHD_LATENCY_MS=10`; angesehen werden `sftp-transfer-canceled.png` (zwei Knöpfe), `sftp-transfer.png` (Rate, „fortgesetzt ab“, laufende Datei) und `sftp-transfer-verified.png` („Fertig · … · fortgesetzt ab … · Prüfsumme stimmt“); die Rate aus dem Protokoll als **Nachher** ins Ledger; der Node-SHA-Vergleich muss bestehen.

## 11. Minimale erste Stufe gegenüber Extras

Erste Stufe = D0, A–F. Streichbar ohne Folgen für den Rest: **F + die Prüfen-Teile von B und D** (dann entfallen `verify`/`mismatched`, `copied`, `sftpVerify`, vier `queue.verify*`-Keys, zwei Fehlercodes, der dritte Shot). Alles andere hängt zusammen.

| Extra | Wert | Aufwand | Entscheidung |
|---|---|---|---|
| E1 Konflikt-Voreinstellung beim Fortsetzen von Ordnern | ★★ | kleine Main-Änderung | nicht jetzt (validiert) |
| E2 Jobliste über Neustart | ★ | Renderer + Store | nicht jetzt |
| E7 Chunk/Fenster/Dateiparallelität in den Einstellungen | ★ | Settings + Schema | nicht jetzt; `TUNING` ist die Stelle dafür |
| E8 Größeres Kanalfenster (ssh2-Fork) oder Cipher-Wahl | ★ | außerhalb | nur bei Bedarf (Nutzer) |
| E9 Prüfen an jedem fertigen Job, automatisch nach Fortsetzen | ★ | Renderer | nicht jetzt |
| E10 `ftruncate` nach geschrumpfter Quelle (`SETSTAT size`) | ★ | Main | nicht jetzt |

## 12. Rulings-Vorschläge

R1–R11, R13 der Spec und K1–K12 der Validierung gelten, soweit Abschnitt 4.5 nichts anderes sagt. Neu bzw. geändert:

- **R14** Die Kopie läuft über eine eigene Schleife mit Positionszugriff (`openRead`/`openWrite`), nicht über Streams und nicht über `fastPut`/`fastGet`; die Streams `read`/`write` bleiben für Bearbeiten und `createFile` — `fastXfer` kürzt das Ziel, kennt keinen Offset und keinen Abbruch, und eine Schleife ist beweisbar — gering.
- **R15** Fenster: 32 KiB-Stücke, 128 unbestätigt (4 MiB), Upload wie Download; die älteste unbestätigte Anfrage sperrt neue (Spanne ≤ W) — Nutzer-Entscheidung, Kanalfenster deckelt bei ~2 MiB je RTT — gering.
- **R16** W ist eine Konstante und darf in späteren Versionen nur wachsen; Fortsetzen beginnt bei `max(0, S − W)`, der 1-MB-Vergleich liegt davor; eine `.part` ≤ W wird ohne Prüfung und Hinweis neu geschrieben — Lücken liegen beweisbar in `[S − W, S)` — gering (≤ 4 MiB Mehrarbeit je Datei).
- **R17** Gezählt werden bestätigte Bytes; am Dateiende wird die Differenz zur Plangröße nachgetragen, nie ein absoluter Wert gesetzt — parallele Dateien — gering.
- **R18** Kopiert wird die geplante Größe; eine während der Kopie wachsende Datei endet bei der Plangröße — verhindert 128 READs hinter EOF je kleiner Datei; Auto-Upload sieht den Zuwachs als Ereignis — gering.
- **R19** Nach einem Abbruch wartet `copyFile` auf `close` beider Handles, damit keine späten Writes in einen neuen Lauf fallen — Korrektheit vor Reaktionszeit — gering (≤ 1 s bei OpenSSH).
- **R20** Ordner-Jobs: zuerst alle Ordner, dann bis zu 4 Dateien parallel in Planreihenfolge; eine Konfliktfrage zur Zeit (Kette), „für alle“ beantwortet Wartende; ein Fehler oder Cancel bricht alle Arbeiter ab, der erste Fehler ist der Jobfehler — `session.conflict` ist ein Slot — gering (leere Ordner bei frühem Cancel).
- **R21** `TransferJob.partials: string[]` statt `partial`; „Teildatei verwerfen“ löscht die Liste — bis zu 4 Teildateien — gering.
- **R22** `current` = laufende Dateinamen mit `, ` — kein neues Feld, keine Renderer-Änderung — gering.
- **R23** `Prüfen`: nur fertige, fortgesetzte, nicht verschobene Jobs; Paare aus Main-Zustand (`copied`, max. 10 000), `sha256sum -- <pfad> 2>/dev/null || shasum -a 256 -- <pfad>` per `client.exec` mit `shellJoin`; ohne Hex-Antwort `files.verifyUnavailable`; Ergebnis als `verify`/`mismatched` am Job; Fehler als IPC-Rejection, nicht über `run()` — kleinste Form, kein Renderer-Pfad erreicht die Shell — gering.
- **R24** Testknöpfe `TUNING = { chunk, inFlight, files }` sind ein exportiertes Objekt, das Tests je Datei verändern und zurücksetzen — kleiner als Parameter durch alle Aufrufer — gering.
- **R25** run-app: `SSHD_LATENCY_MS` im Fake-Server, Vorher-Messung mit dem heutigen Build vor Welle 1, Nachher nach Welle 2, beide Werte im Ledger; der Fake-Ident bleibt `ssh2js` — konservative Messung — gering.
- **R26** `FileSystem.read/write` behalten ihre heutige Signatur; `start`/`end` aus der Validierung entfallen — nur ein Positions-API — gering.
