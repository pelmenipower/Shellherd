# Übertragungen fortsetzen und beschleunigen – Review (Stufe 5)

Branch `claude/feature/transfer-resume`, geprüft als `git diff claude/feature/sftp-typeahead-speed...HEAD` (11 Commits, 35 Dateien, Stand `4cb9665`). Grundlage: CLAUDE.md, `docs/design-system.md`, Spec `2026-10-21-transfer-resume-speed-design.md`, Validierungen `2026-10-21-transfer-resume-validation.md` und `2026-10-21-transfer-resume-speed-validation.md` (bindend), Ledger `.superpowers/sdd/2026-10-21-transfer-resume/progress.md`.

Urteil: not ready. 1 Critical, 2 Important, 3 Minor. Alle Befunde lassen sich mit der Fix-Welle am Ende beheben (zwei Tasks, getrennte Dateien).

Ausgangslage: `npm run typecheck` grün. `npx vitest run` ergibt 132 Dateien und 1937 Tests, alle grün. `transfer.test.ts`, `sftp-loopback.test.ts`, `auto-upload.test.ts` und `verify.test.ts` liefen fünfmal hintereinander grün (je 100 Tests), ohne Flackern. Es gibt keine binäre Datei im Diff (`git diff --numstat … | grep '^-'` ist leer) und keine Datei mit CRLF im Blob (`git grep -lIP '\r$' HEAD` ist leer). Das Ledger enthält die Vorher-Messung (1,9 MB/s bei 10 ms) und die Nachher-Messung (59–65 MB/s), dazu Abbrechen, Fortsetzen ab `.part − W`, „Prüfsumme stimmt“ und den Node-SHA-Vergleich.

## Prüfergebnisse

### Sicherheit

| Punkt | Ergebnis |
|---|---|
| Bestätigungspfad, Exec nur nach Klick | Korrekt. `sftp:verify` trägt nur `{ sessionId, jobId }` (`JobSchema`, `ipc.ts:98`). `owned()` prüft den Besitzer (`sftp-session.ts:321`), die Pfade stammen nur aus `entry.copied` (Main). `exec` läuft nur aus `verify()`, und `verify()` läuft nur nach dem Klick auf „Prüfen“. |
| Befehlsinjektion (V-B6/V-K9) | Nicht behoben, siehe C1. Die Positivliste lässt `'` zusammen mit `(`, `)` und `+` zu. Unter PowerShell als Login-Shell bricht `'\''` aus dem String aus, und `(…)` wird ausgeführt. Ich habe das mit `powershell.exe` nachgestellt: Der Teilausdruck läuft, auch wenn `sh` gar nicht existiert. |
| Secrets, kubeconfig | Nicht berührt. Der `exec`-Kanal liest nichts aus `kubernetes/`, und im Diff stehen keine Zugangsdaten außer den synthetischen im Loopback-Test. |
| Nur lesen im Main | Der Diff fügt keinen Schreibpfad hinzu, der eine Sperre umgeht. Schreibende Wege bleiben `transfer`, `delete` und `localDelete` (Papierkorb). |

### Datensicherheit: `copyRange`, `copyFile`, `runTransfer`

| Punkt | Ergebnis |
|---|---|
| Invariante „nie mehr als W unbestätigt“ | Im Code korrekt (`transfer.ts:189–198`). `pending` ist eine Map in Einfügereihenfolge mit lückenlosen Stücken ab `oldest`. Neue Stücke kommen nur bei `pending.size < inFlight` hinzu, und gelöscht wird nur das älteste. Damit gilt `offset − oldest ≤ W`, alles unter `oldest` ist bestätigt. Ein Stück belegt seinen Platz vom Lesen bis zur Bestätigung. Mutationsprobe `inFlight + 1`: Der Fenstertest schlägt fehl. |
| Rückspulen (R = S − W) | Korrekt (`transfer.ts:213–214`). Mutationsprobe `offset = part.size`: 9 Tests schlagen fehl, darunter der inhaltsbasierte 5-GiB-Test mit Lücken und vier Loopback-Tests. Die Tests sind also aussagekräftig. |
| V-B1 `VERIFY_MAX` in A | Behoben (`sftp-session.ts:126`). |
| V-B2 CLOSE-Fehler im Erfolgsfall | Behoben (`transfer.ts:227`, `await dest.close()` ohne `catch`). Getestet mit „keeps the old target when closing the copy fails“. |
| V-B3 Konfliktkette | Behoben. `stop` und `stopped` stehen vor der Ordnerphase (`transfer.ts:92–95`), `decide` prüft `checkAborted(stop)` und läuft per `race` gegen `stopped` (`:105–118`). V-K6 ist in `sftp-session.ts:286` umgesetzt. Getestet mit „stops at the first failure without hanging“. |
| V-B4 Groß-/Kleinschreibung | Behoben (`transfer.ts:154`). Eine verwandte Kollision ist offen: `x` und `x.part` in derselben Quelle, siehe I2. |
| V-B5 Abbruch hängt an `close` | Behoben (`settle`, 10 s, `transfer.ts:31–35`, `:225`, `:247`, `:261`). |
| V-B7 späte WRITEs | Behoben. Die Stückgröße beträgt 31 KiB (`:23`). Die Sperre `closed` wird synchron in `close()` gesetzt und in `write` vor dem Senden geprüft (`sftp-file-system.ts:107–111`). Lokal lehnt Node-`FileHandle` nach `close` ab. Späte Bestätigungen melden wegen `open` nichts mehr (`transfer.ts:181`, `:199`). |
| V-K1–V-K18 | Bis auf C1 (V-K9 unvollständig), M1 (V-K14, ein Zeichen fehlt) und M2 (V-K13: Der Loopback-Teil „sendet danach nichts“ beweist V-K2 nicht) wörtlich umgesetzt. |
| Rename-Ausweichpfad | Korrekt (`transfer.ts:234–243`). Fehlt die `.part`, bleibt das alte Ziel, und der Fehler wird gemeldet. Ist das Ziel entfernt und der zweite Rename scheitert, bleibt die `.part` als einzige Kopie in `partials`. „Verwerfen“ träfe dann nur eine Kopie, deren Quelle noch existiert: Beim Verschieben wird die Quelle erst nach `copyFile` gelöscht. |
| `.part`-Ordner | Korrekt (`transfer.ts:209`), mit Unit- und Loopback-Test. |
| Abbruch, Verwerfen | Abbrechen behält die `.part` (`keepPartial: true`, `sftp-session.ts:275`). Verwerfen läuft lokal über `shell.trashItem` (`ipc.ts:123`) und ist gesperrt, solange Jobs laufen (`FilesPanel.tsx:410`). |
| Auto-Upload | Weiter korrekt. Ohne `keepPartial` wird die `.part` bei Fehler und Abbruch gelöscht (`transfer.ts:229`). Der bestehende Test „a restarted binding waits for the aborted run before touching the same .part“ prüft das `removeFile` der `.part` weiter. |

### Renderer

Fortsetzen funktioniert nach „Neu verbinden“: `reconnect` leert die Jobs nicht mehr, und `report('closed'|'error')` setzt laufende und wartende Zeilen auf `files.connectionLost`. Die Knöpfe sind korrekt gesperrt: Fortsetzen und Prüfen ohne Verbindung, Verwerfen bei aktiven Jobs oder bei einem Upload ohne Verbindung, Prüfen während `verify === 'running'`. Alle Texte laufen über `t()`. Es gibt kein CSS, kein Token und keine Bewegung. Eine Lücke: siehe M3.

### Leistung

Je Datei liegen bis zu 128 × 31 KiB in eigenen Puffern und dieselbe Menge in ssh2. Das sind rund 8 MiB je Datei und rund 31 MiB bei vier Dateien, wie in der Validierung hingenommen. Die einzige Backpressure ist die Fenstersperre, und sie genügt. Die CPU-Last ist unauffällig: Fortschritt wird gedrosselt gemeldet (200 ms), und die Join-Operationen laufen je Datei, nicht je Stück. Es gibt aber ein Speicherleck, das linear mit der Dateigröße wächst, siehe I1.

### Tests

Die Mutationsproben für Rückspulen, Fenster und Handle-Sperre zeigen, dass die Unit-Tests die Invarianten tragen. Zur Zeitabhängigkeit im Loopback-Test (`sftp-loopback.test.ts:336–340`, 200 ms + 300 ms): Er kann nicht flackern. Alle WRITEs eines Jobs stehen auf dem Kanal vor dessen CLOSE, und `finished` löst sich erst nach der CLOSE-Antwort auf. Damit ist `probe.writes` beim Ende schon fest. Er kann aber auch nichts finden (M2): Mit entfernter Handle-Sperre (`sftp-file-system.ts`) bleibt er grün. V-K2 beweist allein `sftp-file-system.test.ts` („sends nothing on a closed write handle“).

### Formales

i18n: Die Keys stehen in de/en, mit Namespace und vollen Literalen, und `i18n-catalog.test.ts` ist grün. Tokens und Design sind nicht berührt. Handbuch, Manual und CHANGELOG kommen ohne Fettdruck aus. Die neue Zeile in `.claude/skills/run-app/SKILL.md:50` nutzt Fettdruck wie die 21 übrigen Stellen dieser Datei (Hausstil der Skill-Datei, kein Befund). Specs und Validierungen sind wie bisher formatiert.

## Befunde

### Critical

C1 – Befehlsinjektion bei „Prüfen“ über PowerShell, `src/main/files/verify.ts:12`
- Ursache: `VERIFIABLE` enthält `'`, `(`, `)` und `+`. `shellJoin` macht aus `'` die Folge `'\''`. In POSIX-Shells und in fish ist das korrekt. In PowerShell gibt es `\'` aber nicht als Escape: `'…x'` endet, `\` ist ein Wortzeichen, `''` ist ein leerer String, und danach steht `+(…)+` im Argumentmodus. Ein Teilausdruck in Klammern wird dort ausgewertet, bevor PowerShell den Befehl `sh` sucht. Nachgestellt mit `powershell.exe -File`: `sh-does-not-exist … sh '/srv/x'\''+(Write-Host INJECTED-NO-SH)+'\''.bin'` gibt `INJECTED-NO-SH` aus.
- Fehlerszenario: Auf einem Windows-OpenSSH-Server mit PowerShell als `DefaultShell` (oder bei einem Konto mit `pwsh` als Login-Shell) legt ein anderer Nutzer die Datei `x'+(Remove-Item -Recurse ~)+'.bin` ab. `VERIFIABLE.test` liefert dafür `true`. Der Nutzer lädt den Ordner herunter, bricht ab, setzt fort und klickt „Prüfen“. Der Befehl läuft dann mit seinen Rechten auf dem Server. Die Annahme in V3 und im Kommentar `verify.ts:11` („PowerShell passes literally inside '…'“) gilt nur für Namen ohne `'`.
- Fix (bindend): `'` fliegt aus der Positivliste:
  ```ts
  // Only names every common login shell (sh, bash, zsh, fish, csh, cmd, PowerShell) passes literally inside '…'; a quote would need an escape that PowerShell does not know.
  const VERIFIABLE = /^[\p{L}\p{N}\p{M} _.\/+,=@~#:()[\]-]+$/u;
  ```
  Namen mit `'` ergeben dann `files.verifyUnsafeName` ohne `exec`. Damit enthält ein geprüfter Pfad nie ein `'`, und jedes Argument ist in allen genannten Shells ein einzelnes Literal. `verifyCommand` bleibt unverändert.
- Test (`src/main/files/verify.test.ts`): Der Test „passes a path with a quote only as a quoted argument“ (`:66`) wird ersetzt. `"/srv/it's here.bin"` und `"/srv/x'+(calc)+'.bin"` kommen in die `it.each`-Liste „rejects %j without running a command“ (Erwartung `files.verifyUnsafeName`, `commands` leer). Der `verifyCommand`-Test mit `it's here.bin` bleibt als Test des reinen Befehlsbaus. Der Fake-Server-Test in `fakes.test.mjs` bleibt ebenfalls, er prüft nur den Fake.
- Doku: siehe M1, der Satz nennt danach auch `'`.

### Important

I1 – Speicherleck durch `Promise.race` gegen ein langlebiges Promise, `src/main/files/transfer.ts:185–196`
- Ursache: Jede Runde von `await Promise.race([pending.get(oldest), canceled])` hängt eine Reaktion an `canceled` an. `canceled` löst sich nur bei einem Abbruch auf, sonst nie. Bis `copyRange` endet, bleiben deshalb alle Reaktionen erreichbar, eine je Stück. Gemessen (vitest mit `--expose-gc`, `copyRange` über 170 000 Stücke, so viele wie bei 5,4 GB mit 31 KiB): 53,1 MB Heap bleiben bis zum Ende belegt, also rund 310 Bytes je Stück.
- Fehlerszenario: Ein 100-GB-VM-Image belegt rund 1 GB Heap im Main-Prozess, bei vier parallelen großen Dateien entsprechend mehr. Die GC-Pausen werden länger, und ab der Heap-Grenze stürzt der Main-Prozess ab. Das trifft genau den Zweck des Features (große Dateien).
- Fix (bindend): `canceled` und `cancel` entfallen. Gewartet wird je Runde mit einem eigenen Listener, der wieder entfernt wird:
  ```ts
  /** Waits for `piece` or a cancel, whichever comes first; leaves nothing attached afterwards (a race against one long-lived promise keeps every round alive). */
  function untilDoneOrAborted(piece: Promise<void>, signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const onAbort = (): void => reject(new TransferCanceled());
      signal.addEventListener('abort', onAbort, { once: true });
      void piece.then(() => { signal.removeEventListener('abort', onAbort); resolve(); });
    });
  }
  ```
  In der Schleife steht `await untilDoneOrAborted(pending.get(oldest)!, signal);`. `checkAborted(signal)` am Schleifenkopf bleibt. Im `finally` bleibt nur `open = false;`. Die `pending`-Promises lehnen nie ab (`.catch` beim Einfügen), deshalb genügt `then`. Den Kommentar „A cancel must leave the loop at once …“ übernimmt die Funktion.
- Test (`src/main/files/transfer.test.ts`, `describe('copyRange')`): „leaves no listener behind“. `TUNING.chunk = 1, inFlight = 4`, `copyRange` über 1000 Bytes mit einem `AbortController`, `vi.spyOn(signal, 'addEventListener')` und `vi.spyOn(signal, 'removeEventListener')`. Nach dem Ende gilt `add.mock.calls.length === remove.mock.calls.length`, und beide sind ≥ 250. Die bestehenden Abbruchtests („leaves at once when aborted while a piece hangs“, „reports nothing once a canceled copy has ended“) müssen unverändert grün bleiben.

I2 – `x` und `x.part` in derselben Quelle laufen parallel in dieselbe Datei, `src/main/files/transfer.ts:152–154`
- Ursache: V-K7 setzt die Breite nur bei gleichen Zielen (ohne Groß-/Kleinschreibung) auf 1. Bei den Quellen `x` und `x.part` (zum Beispiel ein Ordner auf dem Server mit einem liegen gebliebenen Download `big.iso.part` neben `big.iso`) schreibt Arbeiter 1 nach `x.part`. Arbeiter 2 schreibt nach `x.part.part` und benennt das in `x.part` um. Auf SFTP schlägt dieser Rename zuerst fehl, worauf `removeFile(x.part)` die Datei von Arbeiter 1 löscht und der zweite Rename gelingt. Arbeiter 1 schreibt danach in den gelöschten Inode und benennt am Ende `x.part` in `x` um, also die Datei von Arbeiter 2.
- Fehlerszenario: Der Job meldet „Fertig“. `x` enthält still den Inhalt der Quelle `x.part`, und das Ziel `x.part` fehlt. Weil beide Arbeiter gleichzeitig mit `stat` starten, erscheint keine Konfliktfrage. Seriell (0.17 und `width = 1`) war das Ergebnis für `x` korrekt. Dass `x.part` als eigene Teildatei gilt, ist ein bekannter Shortcut (`transfer.ts:205`). Neu ist, dass dadurch das Ziel `x` falsch wird.
- Fix (bindend):
  ```ts
  const files = items.filter(item => item.type === 'file');
  const targets = new Set(files.map(item => item.target.toLowerCase()));
  // Windows ignores case, and a file named like another file's .part shares that .part: such jobs copy one file at a time, like before.
  const shared = targets.size < files.length || [...targets].some(target => target.endsWith('.part') && targets.has(target.slice(0, -'.part'.length)));
  const width = shared ? 1 : TUNING.files;
  ```
- Test (`src/main/files/transfer.test.ts`, `describe('folders')`): „copies a file and a file named like its .part one after another“. `TUNING.files = 4`, Quellen `/x.bin` (`'main'`) und `/x.bin.part` (`'side'`), dazu `openWrite` mit Zähler offener Handles wie im Groß-/Kleinschreibungstest. Erwartet: höchstens 1 Handle gleichzeitig, `/target/x.bin` hat `'main'`, `/target/x.bin.part` hat `'side'`. Mit der alten Breite schlägt der Test fehl (Gegenprobe im Commit nennen).

### Minor

M1 – Fehlender Backslash im Satz zu den Sonderzeichen, `docs/handbuch.md:356`, `docs/manual.md:352`
- Ursache: V-K14 verlangt wörtlich „… wie &, $ oder \ lassen …“. In beiden Dateien steht „$ oder  lassen“ bzw. „$ or  cannot“ (Bytes geprüft), der `\` fehlt.
- Fehlerszenario: Der Satz ist unvollständig, und nach C1 fehlt dort auch `'`.
- Fix (bindend, wörtlich): de „Dateinamen mit Zeichen wie `&`, `$`, `\` oder `'` lassen sich nicht prüfen.“ en „File names with characters such as `&`, `$`, `\` or `'` cannot be verified.“ Außerdem in `.claude/skills/run-app/SKILL.md:50` „verzögert jede READ- und WRITE-Antwort“ → „verzögert jede READ-, WRITE- und CLOSE-Antwort“ (so arbeitet `sshd.mjs` seit V-K10).
- Test: keiner, `i18n-catalog.test.ts` bleibt grün.

M2 – Der Loopback-Teil „sendet danach nichts“ ist wirkungslos, `src/main/files/sftp-loopback.test.ts:333–340`
- Ursache: Beim Abbruch sind alle 128 offenen Stücke angehaltene WRITEs, keines liest noch. Ein spätes WRITE kann es in diesem Aufbau nicht geben. Mit entfernter Sperre `closed` bleibt der Test grün (Mutationsprobe). Die 500 ms Warten kosten nur Zeit, flackern aber nicht.
- Fehlerszenario: Der Test täuscht eine Absicherung von V-K2 über echtes SSH vor, die es nicht gibt. Eine Regression in `sftp-file-system.ts` fiele nur im Unit-Test auf.
- Fix (bindend): `await sleep(200)`, `const writes`, `await sleep(300)` und `expect(probe.writes).toBe(writes)` entfallen. `expect(probe.lateWrites).toBe(0)` bleibt als Rauchtest. Davor kommt der Kommentar `// Every write of the job precedes its CLOSE on the channel; the handle lock itself is proven in sftp-file-system.test.ts.` Der Testname wird zu „keeps the .part on cancel with writes stalled and resumes to an identical file“.
- Test: Der geänderte Test selbst. Er muss weiter grün sein und läuft rund 0,5 s schneller.

M3 – „Fortsetzen“ entfernt die Zeile, bevor der neue Job angenommen ist, `src/renderer/src/components/FilesPanel.tsx:253–257`
- Ursache: `resume` ruft erst `setJobs(… filter …)` auf und danach `transfer(…)`. `transfer` meldet einen Fehler von `sftpTransfer` nur über `run` (`setActionError`).
- Fehlerszenario: Die Sitzung ist gerade nicht bereit (`files.sessionNotReady`), oder der Aufruf scheitert anders. Die alte Zeile ist dann weg und mit ihr „Teildatei verwerfen“, die `.part` bleibt ohne Knopf liegen (sie wird erst beim nächsten Übertragen derselben Datei wieder sichtbar).
- Fix (bindend): `resume` ruft `sftpTransfer` selbst über `run` auf und entfernt die Zeile erst bei Erfolg:
  ```ts
  const resume = (job: TransferJob): void => {
    if (!remoteReady || !sessionId || !job.sources?.length) return;
    const sources = job.sources;
    // The old row (and its discard button) stays until the new job exists.
    void run(() => window.desktopApi.sftpTransfer({ sessionId, direction: job.direction, sources, targetDir: job.targetDir, move: job.move }))
      .then(done => { if (done) setJobs(current => current.filter(item => item.id !== job.id)); });
  };
  ```
- Test: Für `FilesPanel` gibt es keinen Komponententest. Geprüft wird im Gate der Fix-Welle über run-app `sftp` (Fortsetzen startet, und die alte Zeile verschwindet).

## Fix-Welle (bindend)

| Task | Dateien (exklusiv) | Inhalt |
|---|---|---|
| R1 Main | `src/main/files/verify.ts`, `src/main/files/verify.test.ts`, `src/main/files/transfer.ts`, `src/main/files/transfer.test.ts`, `src/main/files/sftp-loopback.test.ts` | C1, I1, I2, M2 mit den Tests aus den Befunden |
| R2 Doku und Renderer | `docs/handbuch.md`, `docs/manual.md`, `.claude/skills/run-app/SKILL.md`, `src/renderer/src/components/FilesPanel.tsx` | M1 (Sätze wörtlich), M3 |

Die Tasks sind unabhängig und laufen parallel, mit je einem Commit. Gate danach: `npm run typecheck` und `npx vitest run` grün, dazu run-app `sftp` mit `SSHD_LATENCY_MS=10`. Bedingungen: Die Rate liegt in der Größenordnung des Ledgers (≥ 40 MB/s), „fortgesetzt ab“ erscheint, die alte Zeile verschwindet erst nach dem Start des neuen Jobs, „Prüfsumme stimmt“ erscheint, und der Node-SHA-Vergleich besteht. Danach folgt die Nachprüfung (Stufe 6) nur über den Fix-Diff.
