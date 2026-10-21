# SFTP: Tippen zum Springen und Übertragungsgeschwindigkeit – Review (Stufe 5)

Spec: `docs/superpowers/specs/2026-10-21-sftp-typeahead-speed-design.md`, bindender Anhang: `docs/superpowers/specs/2026-10-21-sftp-typeahead-speed-validation.md`, Ledger: `.superpowers/sdd/2026-10-21-sftp-typeahead-speed/progress.md`.
Geprüft: `git diff claude/feature/login-commands...HEAD` (6 Commits, 23 Dateien, +809/−12) am 2026-10-21.

Urteil: approved – 0 Critical, 0 Important, 1 Minor. Eine Fix-Welle ist nicht nötig, M1 kann mitlaufen oder entfallen.

## Gates

- `npm run typecheck` grün.
- `npx vitest run`: 131 Dateien und 1877 Tests grün (Basis laut Anhang 129 / 1859, neu sind 2 Dateien und 18 Tests).
- Flackern: `transfer.test.ts`, `transfer-rate.test.ts` und `file-typeahead.test.ts` liefen fünfmal hintereinander, jedes Mal 32 von 32 grün. Die Zeit ist deterministisch. `transfer-rate.test.ts` nutzt eine injizierte Uhr, `file-typeahead.test.ts` feste Zeitstempel, und `transfer.test.ts` fälscht nur `Date` und stellt die Uhr im synchronen `progress`-Hook pro Aufruf weiter, also abhängig von der Zahl der Aufrufe und nicht vom Vorauslesen des Streams. `vi.useRealTimers()` steht jeweils im `finally`.
- Binärdateien: `git diff --numstat <merge-base> HEAD | grep '^-'` ist leer.
- Zeilenenden: Alle 23 Blobs haben in Basis und HEAD 0 CR-Bytes (`git show <rev>:<datei> | tr -cd '\r' | wc -c`), Index durchgehend `i/lf`. Der Arbeitsbaum ist sauber, auch mit `--ignore-cr-at-eol`.

## Sicherheit

- Kein IPC-Kanal, kein Zod-Schema, kein Preload und kein Main-Handler ist neu oder geändert. Das neue Feld `bytesPerSecond` reist im bestehenden Job-Snapshot (`sftp-session.ts:252`, `{ ...entry.job }`, synchron, ohne verzögerten Timer, deshalb kein später Snapshot nach dem `finally`).
- Bestätigungspfad, „Nur lesen“ im Main, Exec und kubeconfig sind nicht berührt. Es gibt keine Secrets und keine Logs mit Pfaden oder Inhalten.
- run-app löscht nur eigene Dateien. `screens.mjs:60` entfernt `big.bin` im synthetischen Ordner aus `localTarget()`, der den Benutzerordner ablehnt (Zeile 54-57). `screens.mjs:61` hat genau drei feste Pfade (`bigLocal`, `bigServer`, `bigServer.part`) mit `{ force: true }`, ohne `recursive`. `bigServer` liegt unter `RUN_DIR/sftp/home/demo`, passend zu `sshd.mjs:167` und `fixtures.mjs:54-60`. Echte Daten werden nicht berührt.

## Typeahead

- Vertrag aus dem Anhang wörtlich umgesetzt (`file-typeahead.ts:13-24`): Wiederholung auf dem gefalteten Text (K1), `Math.max(index, 0)` (B1). Beide Pflichttests aus B1 und der `b`/`B`-Test aus K1 sind vorhanden (`file-typeahead.test.ts:31-38`).
- Tasten-Kollisionen: Der neue Zweig steht als letzter `else if` (`FilePane.tsx:144-149`). Alle belegten Tasten sind entweder benannt (`key.length > 1`) oder fangen vorher mit Strg/Meta ab. `useShortcut.ts:14` lauscht in der Capture-Phase und ist von `stopPropagation` nicht betroffen. Der einzige weitere globale Listener (`SplitTerminalArea.tsx:212`) gilt Escape.
- Shift: `moveTo(…, false)` (`FilePane.tsx:148`), Großbuchstaben erweitern die Auswahl nicht. Die übrigen Aufrufe behalten `event.shiftKey` als Standardwert.
- AltGr: `isTypeaheadKey` lehnt Strg+Alt ab, das ist getestet (`file-typeahead.test.ts:60-62`) und in Handbuch und Manual beschrieben. Das Risiko ist laut Anhang 5.1 hingenommen.
- IME: `!event.nativeEvent.isComposing`, dazu `Process`/`Dead` über `key.length > 1`.
- Puffer-Reset bei Pfadwechsel: `FilePane.tsx:77` (K2).
- Scrollen und Auswahl: Der bestehende Cursor-Effekt scrollt mit `block: 'nearest'`, die Auswahl wird wie bei den Pfeiltasten gesetzt. Die Reihenfolge ist die Anzeige-Reihenfolge, Ordner immer zuerst (`sortEntries`, `file-browser.ts:17-18`), passend zur Doku.
- Barrierefreiheit: Die Ansage läuft wie bei den Pfeiltasten über `aria-selected`. `aria-activedescendant` ist als E1 ausgeschlossen (Ruling S2).
- Ein veralteter Cursor nach einem Refresh ergibt `indexOf === -1`, das fangen `Math.max` und `index + 1` sauber ab. Eine leere Liste ist getestet.

## Rate

- Fenster und Glättung: Der Rumpf in `transfer-rate.ts` entspricht der Spec wörtlich. Die vier Pflichtfälle aus K5 stehen mit den Zahlen aus dem Anhang in `transfer-rate.test.ts`.
- Konflikt: Der Reset steht nur in `if (!choice)` (`transfer.ts:83`, K6), vor `hooks.conflict`. `ask` emittiert danach erzwungen mit `undefined`. Bei `applyToAll` und bei Skip bleibt der Meter unberührt.
- Ende und Abbruch: `sftp-session.ts:278` im `finally` gilt für done, error und canceled, `runTransfer` setzt das Feld am Ende nicht zurück (K6).
- Mehrere Jobs: Ein Meter pro `runTransfer`-Aufruf (`transfer.ts:65`). Jobs einer Sitzung laufen nacheinander (`session.running`), Sitzungen haben getrennte Meter.
- Overhead pro Chunk: ein `Date.now()`, höchstens ein `push` alle 100 ms, das Fenster hat höchstens etwa 31 Proben. `hooks.progress` pro Chunk gab es schon vorher, der Throttle bleibt bei 200 ms.
- Auto-Upload: `auto-upload.ts` ist unverändert. Sein interner `b.job` bekommt das Feld gesetzt, aber `view(b)` (`auto-upload.ts:320-324`) gibt nur `b.status` heraus. Es kommt nichts beim Renderer an, wie in der Spec vorgesehen.
- Anzeige: `FilesPanel.tsx:369`, `!!job.bytesPerSecond` blendet 0 und `undefined` aus. `formatRate` rundet vor `formatSize` (K3), die Tests für de und en-US sind vorhanden.

## Weiteres

- Formatierung: Die Zahl läuft über `formatSize` → `formatNumber`. Kein `Intl`, kein `localeCompare`, Groß- und Kleinschreibung über `foldCase`.
- i18n: Es gibt keinen neuen Key. `/s` ist eine Einheit wie `KB`, der Katalogtest ist grün.
- Tokens und CSS: unverändert, der Design-Test ist grün.
- Doku: Changelog (de und en) und Handbuch/Manual stehen im Wortlaut von K8 und K9, ohne Fettdruck und ohne Backticks im Changelog. Die Version ist 0.17.0 in `package.json` und `package-lock.json`.
- run-app: Der Ablauf entspricht K7 und B2 (`screens.mjs:89-115`), SKILL.md entspricht K10. Die Abnahme im Ledger ist mit beiden Screenshots belegt (Rate „46 MB/s“ sichtbar).

## Befunde

### Critical

Keine.

### Important

Keine.

### Minor

M1: Test liest den Job vor seiner Deklaration (`src/main/files/transfer.test.ts:78`, `81`)

- Fehlerszenario: Der `conflict`-Hook liest `newestJob?.bytesPerSecond`, `newestJob` wird aber erst in Zeile 81 als `const` deklariert. Heute läuft das nur, weil der Hook später aufgerufen wird. Wird der Hook einmal vor Zeile 81 ausgewertet oder die Zeile verschoben, wirft der Test einen TDZ-`ReferenceError` statt eine klare Assertion zu melden. Das `?.` suggeriert außerdem, der Job könne fehlen.
- Fix (bindend, falls umgesetzt): `const job = newJob();` vor `progress` und `conflict` deklarieren, im Hook `atConflict = job.bytesPerSecond;` schreiben (ohne `?.`) und `transfer(…, job, …)` übergeben. Keine Logikänderung.
- Test: Der bestehende Fall „clears the rate during a conflict question and restarts the window“ bleibt mit denselben drei Erwartungen grün. Danach `npx vitest run src/main/files/transfer.test.ts`.

## Geprüft und hingenommen (kein Befund)

- Der interne `b.job.bytesPerSecond` im Auto-Upload bleibt nach dem Lauf stehen. Er ist nicht beobachtbar (siehe oben), die Spec hat das ausdrücklich zugelassen.
- Scheitert der run-app-`waitFor('Rate')`, läuft der Upload weiter, während das `finally` die Dateien löscht. Unter Windows (libuv öffnet mit `FILE_SHARE_DELETE`) und POSIX verschwinden die Dateien beim Schließen des Handles, und der Job endet mit einem Fehler. Es bleibt kein Rest, der Lauf scheitert laut.
- `foldCase('İ')` ergibt zwei Code-Units, eine Wiederholung von `İ` wird deshalb nicht als Zyklus erkannt. Das ist ein Randfall ohne Bezug zu de/en, so wie NFC (Anhang 5.6).

## Fix-Welle

Nicht nötig. Falls M1 mitgenommen wird: ein Task mit der einzigen Datei `src/main/files/transfer.test.ts`. Gate danach: `npm run typecheck` und `npx vitest run` grün. run-app ist nicht nötig, weil sich nichts Sichtbares ändert.
