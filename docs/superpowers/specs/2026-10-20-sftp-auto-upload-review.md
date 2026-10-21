# SFTP Auto-Upload – Review (Stufe 5)

Prüfer-Review von `claude/feature/sftp-auto-upload` gegen `staging` (`git diff staging...HEAD`, Stand `0d2499b`). Geprüft gegen die Spec `2026-10-20-sftp-auto-upload-design.md`, den bindenden Anhang `2026-10-20-sftp-auto-upload-validation.md` (Vertrag, B1–B6, K1–K27) und das Ledger `.superpowers/sdd/2026-10-20-sftp-auto-upload/progress.md`. **Die Fixes in diesem Dokument sind bindend und gehen Spec und Anhang vor, wo sie abweichen (nur bei M1).**

**Urteil: ready after fixes.** 1 Blocker, 5 Major, 3 Minor (zu beheben), 9 hingenommen.

Gate-Stand: `npm run typecheck` grün. `npx vitest run` ist **nicht stabil grün**: In 4 Läufen schlug zweimal `sftp-loopback.test.ts > SFTP auto-upload over a real SSH connection` mit „Test timed out in 5000ms“ fehl (alleine läuft die Datei in 3,9 s grün). `auto-upload.test.ts` lief 5-mal hintereinander grün.

---

## Sicherheit (zuerst)

| Punkt | Befund |
|---|---|
| Bestätigungspfad / Exec ohne Klick | Nicht betroffen. Das Feature startet keine Prozesse. |
| Bindungs-ID als einzige Eingabe | Erfüllt. `SyncSchema` ist `strict()` mit `uuid()` (`src/main/files/ipc.ts:41`). `syncStart` liest die Bindung aus dem aktuellen Vault-Snapshot der eigenen Sitzung (`sftp-session.ts:174-181`). Eine ID einer fremden Verbindung ergibt `files.syncNotFound`. |
| Pfad-Grenzen | Erfüllt. Schema prüft `localPath` (Laufwerk/UNC, keine Gerätepfade) und `remotePath` (absolut, kein NUL/CR/LF). Main prüft Wurzel per `lstat` (kein Link), `realpath`, Remote-`realpath` und `/`-Verbot (`auto-upload.ts:85-91`). Ziel muss mit `remoteRoot + '/'` beginnen (`:228`). |
| Junctions, Kurznamen | Erfüllt für Batches: `realpath` je Eintrag und Containment-Prüfung (`auto-upload.ts:207-209`), Test mit echter Junction (`auto-upload.test.ts:189-206`). Vollabgleich überspringt `link`-Einträge (`:187`). |
| `move: false` | Erfüllt, literal im Job (`auto-upload.ts:76`). Kein Aufruf von `removeFile`/`removeDirectory` außer über `runTransfer`. Tests prüfen das (`auto-upload.test.ts:100,125,154`). |
| Nie remote löschen | Grundsätzlich erfüllt. Ein Rennfall beim Neustart derselben Bindung kann über den bestehenden Rename-Fallback in `transfer.ts:126-132` eine Serverdatei entfernen, siehe m1. |
| `.part` bei Abbruch | `stop` bricht ab, `copyFile` entfernt die `.part` (`transfer.ts:121`). Bei Sitzungsende ist der Kanal weg, die `.part` bleibt auf dem Server liegen (bestehendes Verhalten normaler Transfers, R2 im Anhang). Hingenommen, H8. |
| Secrets | Keine. `AutoUploadStatus` trägt nur Pfade und Zähler, Fehler gehen als `CodedError`. |
| kubeconfig, „Nur lesen“ | Nicht betroffen. |

---

## Blocker

### B-R1: Der Loopback-Test reißt das Testgate unter Last

- **Ort:** `src/main/files/sftp-loopback.test.ts:97` (das `it` ohne eigenes Timeout), `:73-79` (`waitFor` wartet bis zu 6 s).
- **Fehlerszenario:** Der Test verbindet zweimal per SSH, wartet auf den Startabgleich und auf vier Uploads mit dem Settle-Default von 500 ms. Das dauert alleine etwa 3,8 s. Im vollen Lauf mit 124 Workern überschreitet er das Vitest-Default-Timeout von 5000 ms. Gemessen wurden 2 Fehlschläge in 4 Läufen. Damit ist die CLAUDE.md-Regel „`npx vitest run` muss vor jedem Commit grün sein“ zufällig verletzt, und CI wird flackern.
- **Fix (bindend):** Das `it` bekommt als drittes Argument `30_000`. Am Inhalt des Tests ändert sich nichts.
  ```ts
  it('mirrors a bound folder, …, and reports a second view', async () => { … }, 30_000);
  ```
- **Test:** `npx vitest run` dreimal hintereinander voll durchlaufen lassen, alle drei Läufe grün.

---

## Major

### M1: Eine zweite Speicherung binnen einer Sekunde mit gleicher Größe wird still nicht hochgeladen

- **Ort:** `src/main/files/auto-upload.ts:248-252` (Konflikt-Hook). Das Ledger führt diesen Punkt als Minor (E), er wird hier hochgestuft.
- **Fehlerszenario:** Nach dem ersten Upload trägt die Serverdatei die lokale mtime `m1` (`setModified`). Der Nutzer speichert 0,5–1 s später erneut mit gleicher Größe (Tippfehler korrigiert, Formatter beim Speichern, VS-Code-Autosave „afterDelay 1000“). Regel 3 sieht `|m2 − m1| ≤ 1000` und gleiche Größe und überspringt die Datei als „unverändert“, ohne Eintrag in `skipped`. Der Server behält den alten Inhalt, die Zeile zeigt „Überwacht · zuletzt …“ mit der vorigen Zeit. Das ist ein stiller Synchronisationsfehler. Lehnt der Server `setModified` ab, trifft es zusätzlich jede Speicherung binnen 1 s nach dem Upload.
- **Ursache:** Innerhalb der Sitzung wissen wir genau, welche lokale mtime wir zuletzt hochgeladen haben. Der Hook vergleicht trotzdem unscharf gegen die Serverzeit. Regel 2 („Server neuer“) greift außerdem auch dann, wenn die Serverdatei nachweislich unsere eigene ist (`known` passt).
- **Fix (bindend, ersetzt Spec 3.4 Regeln 2 und 3 für Dateien, die in dieser Sitzung schon hochgeladen wurden):**
  - `Bound` bekommt `sent: Map<string, number>`, die lokale mtime (`item.modified`) des letzten Uploads je `rel`.
  - In `upload` wird nach dem erfolgreichen Upload neben `known.set(...)` auch `b.sent.set(rel, item.modified)` gesetzt.
  - Der Hook lautet:
  ```ts
  const known = b.known.get(rel);
  const sent = b.sent.get(rel);
  // Rule 1: the server copy changed since our upload; rule 2 only without our own upload in this session.
  const newer = known !== undefined ? Math.abs(target.modified - known) > 1000 : target.modified > source.modified + 1000;
  if (newer && !overwrite) b.skipped.add(rel);
  // Our own upload: exact local time; otherwise the size and ±1 s comparison of the start.
  const unchanged = target.size === source.size && (sent !== undefined ? source.modified === sent : Math.abs(target.modified - source.modified) <= 1000);
  return { choice: overwrite || (!newer && !unchanged) ? 'overwrite' : 'skip', applyToAll: false };
  ```
- **Tests in `auto-upload.test.ts`:**
  1. `'uploads a same-size change within a second of the previous upload'`: `write('a.txt', 'aaa', T)` mit `T = Date.now() - 5000`, dann `start` und `ready`. Danach `write('a.txt', 'bbb', T + 500)`, `handleEvent(id, 'change', 'a.txt')` und `waitFor(() => text(nodes, '/srv/a.txt') === 'bbb')`, außerdem `skipped` gleich `[]`.
  2. Dasselbe mit `setup({ keepUploadTime: true })` und `write('a.txt', 'bbb', Date.now())`.
  3. Die bestehenden Tests „compares at start“, „skips a server file that someone else changed“ und „uploads a second change even when the server keeps its own upload time“ bleiben unverändert grün.

### M2: Eine Datei oder ein Ordner verschwindet während des Vollabgleichs, und die Bindung stoppt dauerhaft

- **Ort:** `src/main/files/auto-upload.ts:195` (`planTransfer` im `fullSync`), `:176-177` (der `catch` in `flush` führt zu `fail`). Im Ledger steht das als Minor (E), hier wird es hochgestuft.
- **Fehlerszenario:** Ein Vollabgleich läuft beim Start, bei mehr als 500 Ereignissen (Sturm) oder bei einem Pufferüberlauf. Genau das passiert bei `git checkout`, bei Builds, die `dist/` neu schreiben, und bei Paketinstallationen. Verschwindet dabei zwischen `list` und `stat` eine Top-Level-Quelle (`files.sourceNotFound`, `transfer.ts:49`) oder ein Unterordner (`list` → ENOENT → `files.notFound`, `transfer.ts:34`), wirft `planTransfer` für den ganzen Abgleich. Die Bindung geht auf `error` und schließt den Watcher. Es erscheint ein Fehler-Toast. Ohne Eingriff des Nutzers wird nichts mehr hochgeladen.
- **Fix (bindend):** `Bound` bekommt `retries: number` (Start 0). In `fullSync` wird nur `planTransfer` eingefasst, `local.list(root)` bleibt außerhalb, sodass eine fehlende Wurzel weiter zum Fehler führt:
  ```ts
  let items: PlannedItem[];
  try { ({ items } = await planTransfer(this.deps.local, this.remote, children, b.remoteRoot, b.controller.signal, skip)); }
  catch (error) {
    const code = fileError(error).code;
    // Files vanish while a checkout or build runs: compare again once it settles, a few times at most.
    if ((code === 'files.sourceNotFound' || code === 'files.notFound') && b.retries < 3) { b.retries += 1; b.full = true; this.schedule(b); return; }
    throw error;
  }
  b.retries = 0;
  for (const item of items) await this.upload(b, item, false);
  ```
- **Tests in `auto-upload.test.ts`:** Hier wird ein `AutoUploads` mit einem eigenen `local` gebaut, `{ ...localFileSystem, stat }`.
  1. `stat` liefert für `…\gone.txt` beim ersten Aufruf `null`, danach den echten Wert. Erwartet wird, dass `state` am Ende `'watching'` ist, `error` undefined, und dass `/srv/gone.txt` sowie `/srv/other.txt` hochgeladen sind.
  2. `stat` liefert für `gone.txt` immer `null`, die Datei existiert aber lokal. Erwartet wird, dass nach den Wiederholungen `state === 'error'` mit `files.sourceNotFound` gilt (`waitFor`, Timeout 4000).

### M3: Fehlt etwas auf dem Server, wird das als „lokal gelöscht“ verschluckt

- **Ort:** `src/main/files/auto-upload.ts:271` (`itemFailed`).
- **Fehlerszenario:** `fileError` bildet lokales ENOENT **und** SFTP-Status 2 auf `files.notFound` ab (`file-system.ts:39`). Löscht jemand auf dem Server den Zielordner oder einen Unterordner, scheitern `mkdir` bzw. `write` der `.part` mit Code 2. `itemFailed` hält das für eine lokale Löschung und kehrt still zurück. Es gibt keinen Eintrag in `failed`, keinen Fehler, die Zeile zeigt weiter „Überwacht“. Alle weiteren Uploads gehen still verloren.
- **Fix (bindend):** `itemFailed` wird `async` und bekommt den lokalen Quellpfad. Ignoriert wird nur, wenn die lokale Quelle tatsächlich fehlt:
  ```ts
  private async itemFailed(b: Bound, rel: string, source: string, error: unknown): Promise<void> {
    if (error instanceof TransferCanceled || b.controller.signal.aborted) throw new TransferCanceled();
    const coded = fileError(error);
    // Only a local deletion is ignored; a missing server folder has the same code and must show as a failure.
    if ((coded.code === 'files.sourceNotFound' || coded.code === 'files.notFound') && !(await lstat(source).catch(() => null))) return;
    …unverändert…
  }
  ```
  Die Aufrufer sind `send` (`await this.itemFailed(b, rel, abs, error)`) und `upload` (`await this.itemFailed(b, rel, item.source, error)`).
- **Tests in `auto-upload.test.ts`:**
  - `fakeRemote` bekommt die Option `missingOn?: string`. Dann scheitert `final` mit `Object.assign(new Error('no such file'), { code: 2 })`.
  - `'reports a missing server folder as failed instead of ignoring it'`: `setup({ missingOn: 'x.txt' })`, dann `start` und `ready`. Danach `write('x.txt', 'x', Date.now())` und `handleEvent(id, 'rename', 'x.txt')`. Erwartet wird per `waitFor`, dass `failed` gleich `['x.txt']` ist und `error.code === 'files.notFound'`.
  - Der bestehende Test „never mirrors a local deletion“ bleibt grün.

### M4 (Abnahme A1): Die Server-Spalte lädt nach Auto-Uploads nicht neu

- **Ort:** `src/renderer/src/components/FilesPanel.tsx:160-176` (der `sync`-Zweig). Der vorhandene Mechanismus ist `refresh('remote')`. Er läuft nach fertigen Transfers (`:182`) und nach gespeicherten Remote-Edits (`:158`), der `sync`-Zweig ruft ihn nie auf.
- **Fehlerszenario:** Hochgeladene Dateien fehlen in der Server-Spalte, bis der Nutzer von Hand neu lädt. Die transiente `notes.md.part` im Abnahme-Shot war ein Listing, das mitten in einem Upload geholt wurde. Danach kam kein Refresh mehr, der den Endzustand gezeigt hätte.
- **Fix (bindend):**
  1. In `src/renderer/src/auto-upload-form.ts` kommt ein reiner Helfer dazu:
     ```ts
     /** True when the binding uploaded something new and the visible server folder lies in its target. */
     // shortcut: compares with the stored remote path, not the server's resolved one; a symlinked target is not refreshed, upgrade when reported.
     export function syncTouchesFolder(remoteDir: string | undefined, sync: Pick<AutoUploadStatus, 'remotePath' | 'synced'>, previousSynced = 0): boolean {
       const root = sync.remotePath.replace(/\/+$/, '');
       return !!remoteDir && sync.synced > previousSynced && (remoteDir === root || remoteDir.startsWith(`${root}/`));
     }
     ```
  2. In `FilesPanel.tsx` wird `syncSeen` um `synced` erweitert, an beiden Stellen: `:165` und bei der Adoption `:204` (dort `synced: sync.synced`). Der Typ des Refs wird zu `{ error: boolean; skipped: number; synced: number }`.
  3. Im Verbindungs-Effekt kommt neben `let id` ein `let syncRefresh: ReturnType<typeof setTimeout> | undefined;` dazu. Im `sync`-Zweig (nicht bei `closed`) folgt nach dem Setzen von `syncSeen`:
     ```ts
     // Throttled: one listing per second at most, after the uploads it covers.
     if (!syncRefresh && syncTouchesFolder(paths.current.remote, sync, seen?.synced))
       syncRefresh = setTimeout(() => { syncRefresh = undefined; refresh('remote'); }, SYNC_REFRESH_MS);
     ```
     Dazu kommt die Modulkonstante `const SYNC_REFRESH_MS = 1000;`. Die Cleanup-Funktion des Effekts ruft zusätzlich `clearTimeout(syncRefresh);` auf. `refresh` steht schon in den Deps.
- **Tests in `auto-upload-form.test.ts`:**
  - `syncTouchesFolder`: gleicher Ordner ergibt true, Unterordner true, `/srv/app2` gegen `/srv/app` false, Elternordner `/srv` false.
  - `synced` nicht gestiegen ergibt false, `remoteDir` undefined false, `remotePath` mit abschließendem `/` true.
  - Sichtprüfung per `run-app`: Nach dem Shot `sftp-auto-upload` zeigt die Server-Spalte die hochgeladene Datei ohne `.part`.

### M5 (Abnahme A2): Der Info-Toast mit Aktion bricht den Titel mitten im Wort um

- **Ort:** `src/renderer/src/components/toast-ui.css:2,4,9,13`. Der Notice-Store ist nicht beteiligt, `Toast.tsx:39-55` rendert nur Punkt, Text, Aktion und „Schließen“ in einer Flex-Zeile.
- **Ursache:** Der Stapel ist höchstens 400 px breit (`:2`). Beide Knöpfe sind `flex: 0 0 auto` (`:13`). „Trotzdem überschreiben“ (etwa 160 px) und „Schließen“ (etwa 75 px) nehmen mit drei Lücken von je 12 px, Innenabstand, Rand und Punkt rund 305 px weg. Dem Text (`flex: 1; min-width: 0`) bleiben etwa 95 px, und `overflow-wrap: anywhere` (`:9`) bricht „übersprungen“ mitten im Wort. Toasts ohne Aktion sind nicht betroffen, sie haben nur einen kurzen Knopf.
- **Fix (bindend, nur Tokens, keine Bewegung):**
  - `src/renderer/src/tokens.css`, direkt unter `--size-dot`:
    ```css
    /* Notice text: narrowest width before the buttons move to a second row */
    --toast-text-min: 200px;
    ```
  - `src/renderer/src/components/toast-ui.css`:
    - `.toast` bekommt `flex-wrap: wrap; row-gap: var(--space-8);`.
    - `.toast-text`: `flex: 1;` wird zu `flex: 1 1 var(--toast-text-min);`.
    - Neue Regel `.toast-action { margin-left: auto; }`. In einer gemeinsamen Zeile wirkt sie nicht, weil der wachsende Text den Platz schon nimmt. In der zweiten Zeile rückt sie die Knöpfe nach rechts.
  - Ergebnis: Toasts ohne Aktion bleiben einzeilig. Punkt, Lücke, 200 px Text, Lücke und „Schließen“ ergeben zusammen etwa 307 px, das passt in die 348 px Innenbreite. Mit Aktion passt die Zeile nicht mehr, die Knöpfe rücken rechtsbündig in eine zweite Zeile, und der Titel bekommt die volle Breite.
  - `docs/design-system.md`, Tabelle „Statuspunkt und Meldungsdauer“: neue Zeile `| --toast-text-min | Mindestbreite des Meldungstexts, bevor die Knöpfe in eine zweite Zeile rücken | 200px | .toast-text |`.
- **Test:** `design-tokens.test.ts` bleibt grün (R18: das Token ist deklariert). Sichtprüfung per `run-app`: Den Info-Toast „Server neuer“ wie in der Abnahme auslösen und ansehen. Der Titel steht in einer Zeile, die Knöpfe stehen darunter rechts. Ein Fehler-Toast ohne Aktion bleibt einzeilig.

---

## Minor (beheben)

### m1: Ein Neustart derselben Bindung wartet nicht auf den abgebrochenen Lauf

- **Ort:** `src/main/files/auto-upload.ts:72` (`this.stop(binding.id)` am Anfang von `start`, danach sofort der neue Lauf).
- **Fehlerszenario:** „Bearbeiten“ (Stop und Start) oder „Anhalten“ und gleich „Fortsetzen“, während eine große Datei hochlädt. Der alte Lauf entfernt beim Abbruch `${target}.part` (`transfer.ts:121`). Öffnet der neue Lauf dieselbe `.part` vorher, entfernt der alte die Datei des neuen. Dessen `rename` scheitert, der Fallback `transfer.ts:127` löscht die **echte Serverdatei**, und der zweite `rename` scheitert ebenfalls. Die Serverdatei ist weg, ein Verstoß gegen N5. Auf demselben SFTP-Kanal schützt meist die Reihenfolge der Anfragen, garantiert ist das nicht.
- **Fix (bindend):**
  - `Bound` bekommt `current?: Promise<void>`.
  - `flush` wird geteilt: `flush(b)` behält die Prüfungen auf `closed`, `error` und `running` (`again`) und setzt dann `b.current = this.drain(b); return b.current;`. `drain` ist der bisherige Rumpf ab `b.running = true`.
  - `start` merkt sich vor `this.stop(...)` `const previous = this.bound.get(binding.id)?.current;`. Im `try` wird nach den synchronen Prüfungen auf `inUseElsewhere` und Überlappung (K16 bleibt synchron) zuerst `await previous;` ausgeführt, erst danach `lstat`. `drain` wirft nie.
- **Test:** In `fakeRemote` kommen die Option `writeDelayMs` (verzögert `final`) und ein gemeinsames `log: string[]` dazu, das `write:<path>` und `removeFile:<path>` mitschreibt. Ablauf: Start, `ready`, eine Datei schreiben, `handleEvent`, warten bis `log` `write:/srv/big.txt.part` enthält. Dann `stop` und sofort `await start`, danach `waitFor(text === lokaler Inhalt)`. Erwartet wird, dass der Index von `removeFile:/srv/big.txt.part` kleiner ist als der des **zweiten** `write:/srv/big.txt.part` und dass `/srv/big.txt` am Ende existiert.

### m2: `setState('watching')` kann einen Fehlerzustand überschreiben

- **Ort:** `src/main/files/auto-upload.ts:173` und `:286-289`.
- **Fehlerszenario:** `watcher.on('error')` oder die Wurzelprüfung ruft `fail` auf, während der Vollabgleich gerade sein letztes `remote.stat` abwartet (`:257`, dort ohne Abbruchprüfung). `fullSync` kehrt normal zurück, und `setState(b, 'watching')` setzt den Zustand wieder auf „Überwacht“. Der Watcher ist dann aber geschlossen, und `running()` meldet true.
- **Fix (bindend):** Die erste Zeile von `setState` wird `if (b.closed || b.status.state === 'error') return;`.
- **Test:** Kein eigener Test, die Zeile ist ein Guard. Die bestehenden Tests zu `ready`/`watching` bleiben grün.

### m3: Ein Fehler bei „Trotzdem überschreiben“ im Toast wird verschluckt

- **Ort:** `src/renderer/src/components/FilesPanel.tsx:171` (`.catch(() => {})`). K22 verlangt eine Fehlerbehandlung, die Zeile `:323` hat sie.
- **Fehlerszenario:** Ist die Sitzung inzwischen beendet oder die Bindung gestoppt, scheitert der Klick im Toast ohne jede Rückmeldung.
- **Fix (bindend):** `.catch(error => setActionError(errorText(error, tRef.current('files:actionFailed'))))`. `fail` wird im Effekt nicht benutzt, damit die Deps unverändert bleiben.
- **Test:** Kein Komponententest (Ruling I). Sichtprüfung entfällt.

---

## Hingenommen (mit Grund)

| # | Punkt | Grund |
|---|---|---|
| H1 | Ledger (K): Knopf-Selektoren in `screens.mjs` | Mit `0d2499b` behoben (Primärknopf per Klasse, Entfernen eines Überbleibsels vor dem Shot). |
| H2 | Ledger (E): Überlappung zählt Bindungen im Zustand `error` | Der Dialog verhindert Überlappung schon gegen alle Bindungen (K24). Beim Bearbeiten derselben ID stoppt `start` zuerst die alte. Ein Fall, in dem das stört, ist über die UI nicht erreichbar. |
| H3 | Ledger (G): `autoUploadErrors` liefert übersetzte Texte, die eigene ID wird ignoriert | So vom Vertrag gewollt (Feldtexte). Die eigene ID auszunehmen ist für „Bearbeiten“ nötig. |
| H4 | Ledger (I): keine Komponententests für FilesPanel/FilePane | Gilt weiter. Neue Logik aus M4 liegt deshalb im reinen Helfer `syncTouchesFolder` und wird dort getestet. |
| H5 | `forceOne` (`auto-upload.ts:220`) prüft den Pfad nicht per `realpath` | `rel` stammt aus `planTransfer` unter der aufgelösten Wurzel. Ein nachträglich eingeschobener Vorfahren-Junction setzt einen lokalen Angreifer voraus. |
| H6 | Die Knöpfe der Liste sind während `savingSync` nicht gesperrt | Ein zweiter Klick scheitert an der `inProgress`-Sperre von `persistVault` und gibt `false` zurück. Es geht nichts verloren. |
| H7 | Symlinks **auf dem Server** im Zielordner werden durchschrieben | Normale Transfers verhalten sich genauso (`transfer.ts:93-95`). Es schreibt mit den Rechten des Nutzers. |
| H8 | `.part` bleibt bei Verbindungsabbruch mitten im Upload auf dem Server | Bestehendes Transferverhalten (R2), nie löschen hat Vorrang. |
| H9 | Ereignisse während eines laufenden Batches lösen nach dessen Ende sofort einen Flush ohne Settle aus (`firstAt` bleibt gesetzt) | Folge: höchstens ein zusätzlicher Upload eines halb geschriebenen Stands, den das nächste Ereignis korrigiert. |

## Abdeckung von Vertrag und Anhang

- Vertrag 1.1–1.12: wörtlich umgesetzt (Typen, Schema nicht strikt, IPC, Preload, `keepAutoUpload`, Matcher, `planTransfer`-Hook, `AutoUploads`-API, Session, Formular, Komponenten, Texte de/en). Die Texte stimmen mit Tabelle 1.12 überein.
- B1–B6: erfüllt. B4 über Upload je Element, B5 über `checkingRoot`, B6 über `inUseElsewhere`, mit Loopback-Test.
- K1–K27: erfüllt. Abweichungen gibt es nur in den Befunden oben: K6/K12 (M1, M3), K12/K13 (M2), K15 (m2), K22 (m3, M4).
- Renderer-Abläufe: Neu, Bearbeiten, Anhalten, Fortsetzen und Entfernen laufen erst über den Vault, dann über IPC (`FilesPanel.tsx:250-274`). Ohne Verbindung wird nur der Vault geschrieben (Ruling I). `keepAutoUpload` wird in `App.saveConnection` mit dem aktuellen `existing` aufgerufen. Das Nebenfenster bekommt kein `onSaveAutoUpload`, die Liste ist dort sichtbar (Katalog über `redactSecrets` behält `autoUpload`), die Vault-Knöpfe sind gesperrt.
- Toast-Übergänge: Ein Fehler-Toast kommt nur beim Wechsel per Ereignis, ein Info-Toast beim Wechsel von 0 auf mehr als 0 übersprungene Dateien. Bei der Adoption gibt es keinen Toast. Erfüllt.
- i18n, Tokens, Motion: Es gibt keine Literale. Die Keys stehen in beiden Sprachen, das CSS nutzt nur Tokens, Bewegung gibt es keine. Der Dialog übernimmt die Regel von `.confirm-dialog`, und `design-system.md` ist ergänzt.
- Testqualität: `auto-upload.test.ts` ist stabil. Negative Prüfungen arbeiten mit `pause(150–200)` und sind nicht flackergefährdet, positive mit `waitFor` (4 s). Die Lücken sind M1 (gleiche Größe), M2 und M3 und das Timeout aus B-R1.

---

## Fix-Welle (eine Welle, zwei Tasks, Dateien exklusiv)

Nach der Welle müssen `npm run typecheck` und dreimal `npx vitest run` grün sein. Danach `run-app` mit dem Block `sftp` laufen lassen, die PNGs `sftp-auto-upload` und einen ausgelösten „Server neuer“-Toast ansehen.

| Task | Dateien (exklusiv) | Befunde |
|---|---|---|
| **R1** Main | `src/main/files/auto-upload.ts`, `src/main/files/auto-upload.test.ts`, `src/main/files/sftp-loopback.test.ts` | B-R1, M1, M2, M3, m1, m2 |
| **R2** Renderer, Toast | `src/renderer/src/components/FilesPanel.tsx`, `src/renderer/src/auto-upload-form.ts`, `src/renderer/src/auto-upload-form.test.ts`, `src/renderer/src/components/toast-ui.css`, `src/renderer/src/tokens.css`, `docs/design-system.md` | M4, M5, m3 |

R1 und R2 haben keine gemeinsamen Dateien und keine Abhängigkeit voneinander. `AutoUploadStatus` und alle Verträge bleiben unverändert.
