# SFTP: Tippen zum Springen und Übertragungsgeschwindigkeit – Validierung (Stufe 3)

Spec: `docs/superpowers/specs/2026-10-21-sftp-typeahead-speed-design.md`, Plan: `docs/superpowers/plans/2026-10-21-sftp-typeahead-speed.md`.
Dieser Anhang ist bindend und geht Spec und Plan vor.

**Urteil: ready after corrections** – 3 Blocker, 10 Korrekturen, 6 offene Risiken.

Basis geprüft am 2026-10-21 auf `claude/feature/sftp-typeahead-speed`: `npx vitest run` 129 Dateien / 1859 Tests grün, `npm run typecheck` grün.

Gegen den Code bestätigt: `FilePane.tsx:115-141` (Handler, Guard 116, `moveTo` 118-124, letzter Zweig 140), `68-69` (`names` = Anzeige-Reihenfolge, `..` nicht enthalten), `79-81` (Scroll-Effekt), `74` (Reset bei Pfadwechsel), Pfad- und Prompt-Input außerhalb von `.file-list` (216, 227). `useShortcut.ts:14` fängt nur Strg-Kombinationen ab. Kein Vorfahr von `FilePane` hat einen `onKeyDown`. `transfer.ts:62-136` (Zähler 111-115, Konflikt 79-84, Skip 88-90), `sftp-session.ts:249-254` (Throttle 200 ms, Snapshot), `276-281` (`finally`), `285-293` (`ask` emittiert erzwungen). `FilesPanel.tsx:183-185` ersetzt den Job als Ganzes, ein gelöschtes Feld bleibt also nicht stehen. Nur Electron-IPC, kein JSON, ein `undefined`-Feld kommt an. `formatSize` steht in `file-browser.ts:24-30`. Keine Komponententests für `FilePane` oder `FilesPanel`. Kein `toStrictEqual` auf Jobs.

## 1. Vertrag

### `src/renderer/src/file-typeahead.ts` (neu)

```ts
import { foldCase } from '../../shared/format';

export const TYPEAHEAD_MS = 1000;
export interface Typeahead { text: string; at: number }

export function isTypeaheadKey(event: { key: string; ctrlKey: boolean; altKey: boolean; metaKey: boolean }): boolean;
// wie Spec: key.length === 1 && key !== ' ' && !ctrlKey && !altKey && !metaKey

export function typeahead(names: string[], cursor: string | null, previous: Typeahead | null, key: string, now: number):
  { name: string | null; state: Typeahead };
```

Rumpf wie in der Spec, mit zwei bindenden Änderungen (B1, K1):

```ts
  const text = previous && now - previous.at < TYPEAHEAD_MS ? previous.text + key : key;
  const folded = foldCase(text);
  const repeat = folded.length > 1 && [...folded].every(char => char === folded[0]);
  const prefix = repeat ? folded[0] : folded;
  const index = cursor ? names.indexOf(cursor) : -1;
  const start = repeat || text.length === 1 ? index + 1 : Math.max(index, 0);
  // loop unchanged: names[(start + step) % names.length], foldCase(name).startsWith(prefix)
```

### `src/main/files/transfer-rate.ts` (neu)

```ts
export interface RateMeter { add: (bytes: number) => number | undefined; reset: () => void }
export function rateMeter(now: () => number = Date.now): RateMeter;
```

Die Konstanten `WINDOW_MS = 3000`, `MIN_SPAN_MS = 1000` und `SAMPLE_MS = 100` bleiben modulintern, der Rumpf ist wörtlich wie in der Spec.

### `src/shared/sftp.ts`, `TransferJob`, direkt nach `current?: string;`

```ts
  /** Smoothed rate of the running copy; absent in the first second, while a conflict question is open and after the end. */
  bytesPerSecond?: number;
```

### `src/main/files/transfer.ts`

- `runTransfer` behält seine Signatur. In der ersten Zeile des Rumpfs steht `const rate = rateMeter();`.
- Neue interne Signatur: `copyFile(job, item, target, mode, from, to, hooks, rate: RateMeter, signal)`, also `rate` vor `signal`. Der Aufruf in Zeile 96 wird angepasst.
- Konflikt, innerhalb von `if (!choice) {` und vor `await hooks.conflict(...)`: `job.bytesPerSecond = undefined; rate.reset();`.
- Zähler: `job.doneBytes += chunk.length; job.bytesPerSecond = rate.add(chunk.length); hooks.progress(job);`. Dazu kommt der Shortcut-Kommentar aus der Spec.

### `src/main/files/sftp-session.ts:277`

Im `finally` steht zusätzlich `job.bytesPerSecond = undefined;` direkt nach `job.current = undefined;`.

### `src/renderer/src/file-browser.ts`, nach `formatSize`

```ts
export function formatRate(bytesPerSecond: number): string { return `${formatSize(Math.round(bytesPerSecond))}/s`; }
```

### `src/renderer/src/components/FilesPanel.tsx`

- Import um `formatRate` erweitern.
- Nach Zeile 368 (`files:queue.bytes`) folgt: `{!!job.bytesPerSecond && ` · ${formatRate(job.bytesPerSecond)}`}`.

### `src/renderer/src/components/FilePane.tsx`

- Import von `isTypeaheadKey`, `typeahead` und `type Typeahead` aus `'../file-typeahead'`.
- Nach `listRef` (67): `const typeaheadRef = useRef<Typeahead | null>(null);`.
- Effekt in Zeile 74: zusätzlich `typeaheadRef.current = null;` (K2).
- `moveTo` wird zu `(next: number, extend = event.shiftKey): void`. Zeile 121 prüft `extend` statt `event.shiftKey`.
- Letzter `else if`-Zweig nach Zeile 140, wörtlich wie in der Spec, mit `!event.nativeEvent.isComposing`.

### Keine Änderung an

IPC, Zod-Schemas, Preload, `auto-upload.ts`, CSS, Tokens, i18n-Katalogen, README.

### Frage aus dem Auftrag: „MB/s“ ohne Übersetzung

Das ist in Ordnung. `B`, `KB` und `MB` sind schon heute Code-Literale in `file-browser.ts:24`, und `/s` ist in Deutsch und Englisch gleich. Der Dezimaltrenner kommt über `formatNumber`. Regel (g) im Katalogtest (`i18n-catalog.test.ts:120-132`) greift nicht, weil die Zeile keinen Umlaut und keinen JSX-Satz enthält. Es gibt keinen neuen Key und kein `i18n-ignore`.

## 2. Blocker

**B1: Absturz bei Präfix ohne Cursor** (`file-typeahead.ts`)

- Fehlerszenario: Es gibt keinen Cursor (direkt nach dem Ordnerwechsel ist `cursor` null), und der erste Buchstabe trifft nichts, etwa `q`. Kommt dann innerhalb von 1 s ein zweiter Buchstabe, ist `text.length === 2` und nicht `repeat`. Damit wird `start = index = -1`. Bei `step = 0` liest der Code `names[-1 % n]`, also `names[-1]`, das ist `undefined`. `foldCase(undefined)` wirft einen `TypeError` im Key-Handler, und der Typeahead ist bis zum Verfall tot.
- Fix: `start = … : Math.max(index, 0)` wie im Vertrag.
- Pflichttest: Cursor `null`, dann `q` bei 0 und `u` bei 100. Erwartet wird kein Throw und `name === null`. Zweiter Pflichttest: Cursor `null`, dann `x` bei 0 (kein Treffer) und `a` bei 100 mit Namen `['xa.txt']`. Erwartet wird `'xa.txt'`.

**B2: run-app findet `big.bin` lokal nie** (`.claude/skills/run-app/screens.mjs`)

- Fehlerszenario: Die lokale Spalte hat keinen Watcher (`FilesPanel.tsx` lädt nur bei Navigation, Aktualisieren und Transferende neu, siehe 188). Nach `fs.writeFileSync` gibt es die Zeile `[data-name="big.bin"]` deshalb nicht. Der `click` scheitert nach 5 s, und die Abnahme S4 ist nicht erfüllbar.
- Fix: Nach dem Schreiben folgt `await click('.file-pane-local button[aria-label="Aktualisieren"]')` und dann `waitFor('große Datei lokal', '!!document.querySelector(\'.file-pane-local [role=row][data-name="big.bin"]\')')`. Erst danach kommt der Klick auf die Zeile. Ablauf siehe K7.

**B3: Der Bindungstest in `transfer.test.ts` ist so nicht grün zu bekommen** (`src/main/files/transfer.test.ts`)

- Fehlerszenario 1: `runTransfer` ruft `hooks.progress` schon vor dem ersten Chunk auf (`transfer.ts:66`) und nach jeder Datei noch einmal (100). „Erste zwei Aufrufe `undefined`, dritter `> 0`“ ist deshalb falsch gezählt.
- Fehlerszenario 2: Die Uhr im Generator vorzustellen hängt davon ab, wie weit `Readable.from` im Objektmodus vorausliest. Das ist nicht deterministisch.
- Fehlerszenario 3: Der Konfliktfall mit nur einer Datei prüft nichts, weil die Rate dort ohnehin `undefined` ist.
- Fix, bindend: `vi.useFakeTimers({ toFake: ['Date'] })` in `try/finally` mit `vi.useRealTimers()`. Die Quelle ist `memory({ '/a.txt': 'x'.repeat(3072) })`, dazu kommt die Überschreibung `from.read = () => Readable.from([Buffer.alloc(1024), Buffer.alloc(1024), Buffer.alloc(1024)])`. Der `progress`-Hook ist synchron und läuft im Transform. Er schreibt `seen.push(job.bytesPerSecond)` und ruft danach `vi.setSystemTime(Date.now() + 600)` auf.
  - Fall 1, nur `/a.txt`: `seen` hat die Länge 5. Die ersten drei Werte sind `undefined` (Start, Chunk 1 und Chunk 2). `seen[3]` und `seen[4]` sind `toBeCloseTo(2048 / 1.2, 3)`: Chunk 3 kommt bei Spanne 1200 ms, danach folgt der Aufruf nach der Datei.
  - Fall 2: Die Quellen sind `/a.txt` und `/b.txt`, beide 3072 Zeichen, mit derselben `read`-Überschreibung. Das Ziel enthält `/target/b.txt`. Der `conflict`-Hook schreibt `atConflict = job.bytesPerSecond` und antwortet `overwrite` mit `applyToAll: false`. Erwartet wird: `seen` enthält vor dem Konflikt eine Zahl, `atConflict` ist `undefined`, und der erste `seen`-Eintrag nach dem Konflikt ist `undefined`.

## 3. Korrekturen (bindend)

**K1** (`src/renderer/src/file-typeahead.ts`, `file-typeahead.test.ts`)

- Die Wiederholung wird auf dem gefalteten Text erkannt (Vertrag). Sonst ergibt `b` und danach `B` (Shift) den Puffer `bB`, der als Präfix `bb` nichts trifft, statt zum nächsten B-Treffer zu wechseln.
- Zusätzliche Pflichttests zu den Fällen der Spec:
  - `b` bei 0 und `B` bei 200 mit Cursor `Bilder` ergibt `Beta.md`.
  - B1 mit zwei Fällen.
  - `isTypeaheadKey({ key: '@', ctrlKey: true, altKey: true, metaKey: false })` ergibt `false`. Das dokumentiert den AltGr-Fall.
- Hinweis zur Namensliste der Spec: Sie ist eine frei gewählte Anzeige-Reihenfolge. Der Test ruft `sortEntries` nicht auf.

**K2** (`src/renderer/src/components/FilePane.tsx:74`): Beim Pfadwechsel wird `typeaheadRef.current = null` gesetzt. Sonst verlängert ein Buchstabe, der direkt nach dem Ordnerwechsel kommt, den Puffer aus dem alten Ordner.

**K3** (`src/renderer/src/file-browser.ts`, `file-browser.test.ts`)

- `formatRate` rundet vor `formatSize`. Für `unit === 0` gibt `formatSize` den Wert roh aus (Zeile 29), eine Rate von `512.33` würde sonst als `512.33333333 B/s` erscheinen.
- Pflichttests im bestehenden de-Block:
  - `formatRate(1.5 * 1024 * 1024)` ergibt `'1,5 MB/s'`.
  - `formatRate(512.4)` ergibt `'512 B/s'`.
  - `formatRate(1023.6)` ergibt `'1 KB/s'`.
- Pflichttest im en-US-Block (`file-browser.test.ts:69`): `formatRate(1.5 * 1024 * 1024)` ergibt `'1.5 MB/s'`.

**K4** (`src/main/files/transfer-rate.ts`, `transfer.ts`): Der Typ `RateMeter` wird exportiert und `copyFile` bekommt den Parameter `rate` vor `signal` (Vertrag). Ein `ReturnType<…>` ist nicht erlaubt.

**K5** (`src/main/files/transfer-rate.test.ts`): Die Pflichtfälle stehen mit Zahlen fest, alle mit `let t = 0; const meter = rateMeter(() => t)`.

1. `add(1024)` bei 0, 600 und 1200. Die ersten beiden ergeben `undefined`, der dritte ergibt `toBeCloseTo(2048 / 1.2)`.
2. Fenster: `add(1000)` bei 0, 1000, 2000 und 3000, danach `add(4000)` bei 4000 und 5000. Bei 5000 ergibt das `3000`: Die Basis ist die Probe bei 2000 mit Gesamtwert 3000, und (12000 − 3000) / 3 s ergibt 3000.
3. Proben: `add(1000)` bei 0 und 50, dann `add(1000)` bei 1000. Das ergibt `2000`: Die Probe bei 50 wird nicht gespeichert, ihre Bytes zählen aber.
4. `reset()` bei 2000, danach `add(1000)` bei 2000 und 2500. Beide ergeben `undefined`. Ein `add(1000)` bei 3000 ergibt `2000`.

**K6** (`src/main/files/transfer.ts`): Der Reset steht nur im Zweig `if (!choice)`, gilt also nur für eine tatsächlich gestellte Frage. Bei `applyToAll` gibt es keinen Reset, und übersprungene Dateien lassen den Meter unberührt (wie in der Spec). `runTransfer` setzt am Ende kein `bytesPerSecond = undefined`. Das gehört allein ins `finally` der Session, damit done, error und canceled denselben Weg nehmen.

**K7** (`.claude/skills/run-app/screens.mjs`): Der Ablauf im Block `sftp` direkt nach `await shot('sftp');` und vor dem Zahnrad-Menü ist endgültig.

1. In `localTarget()` vor den drei `writeFileSync` steht `fs.rmSync(path.join(dir, 'big.bin'), { force: true });`. Das entfernt den Rest eines abgebrochenen Laufs, den der Auto-Upload sonst hochladen würde. `big.bin` wird dort nicht angelegt.
2. Typeahead:
   - `await click('.file-pane-remote [role=row][data-name="backups"]');` Der Klick auf eine feste Zeile fokussiert die Liste. Ein Klick in die Listenmitte trifft je nach Fensterhöhe eine beliebige Zeile oder den Leerraum.
   - `await key('n');`
   - `await waitFor('Typeahead', '!!document.querySelector(\'.file-pane-remote .file-row.is-cursor[data-name="notes.md"]\')');`
   - `await shot('sftp-typeahead');`
3. Rate, in `try { … } finally { … }`:
   - Im `try`:
     - `fs.writeFileSync(path.join(target, 'big.bin'), Buffer.alloc(256 * 1024 * 1024));`
     - die Schritte aus B2 (lokal aktualisieren und auf die Zeile warten)
     - `await click('.file-pane-local [role=row][data-name="big.bin"]');`
     - `await click('.file-pane-local .file-pane-actions button:first-child');`
     - Mit `const queue = '.transfer-queue:not(.file-sync-list):not(.edit-list)'` (`.transfer-queue` trägt auch die Auto-Upload-Liste, `AutoUploadList.tsx:25`): `await waitFor('Rate', \`/\\d\\s?[KMG]B\\/s/.test(document.querySelector('${queue}')?.innerText ?? '')\`, { timeout: 60000, every: 100 });`
     - `await shot('sftp-transfer');` ohne `pause`, denn die Rate verschwindet am Ende.
     - `await waitFor('Upload fertig', \`[...document.querySelectorAll('${queue} .transfer-job.is-done')].some(j => j.textContent.includes('big.bin'))\`, { timeout: 180000 });`
   - Im `finally`: `fs.rmSync` mit `{ force: true }` auf genau drei Pfade, `path.join(target, 'big.bin')`, `path.join(RUN_DIR, 'sftp', 'home', 'demo', 'big.bin')` und dieselbe Datei mit `.part`. Kein `recursive`, keine weiteren Pfade.
   - Danach (nicht im `finally`):
     - Beide Spalten über `button[aria-label="Aktualisieren"]` aktualisieren.
     - `waitFor('große Datei entfernt', '!document.querySelector(\'[role=row][data-name="big.bin"]\')')`
     - `await click(\`${queue} header button\`);` (`Erledigte entfernen`)
4. Zur Sicherheit: `target` kommt nur aus `localTarget()`, und das lehnt Pfade im Benutzerordner ab (Zeile 54-57). Der Server-Pfad liegt unter `RUN_DIR/sftp`, und `seedSftp` baut diesen Baum ohnehin neu. Zeigen `screens.mjs` und `drive:sshd` auf verschiedene `SHELLHERD_RUN_DIR`, löscht `force` dort nichts, und der `waitFor` scheitert laut. Echte Daten werden in keinem Fall berührt.

**K8** (`CHANGELOG.md`, `CHANGELOG.en.md`): Der Wortlaut ist bindend. Backticks sind verboten, weil `version.test.ts:47-52` sie prüft. Jede Datei bekommt genau zwei Einträge, damit die Paritätsprüfung greift.

```
## [0.17.0] – 2026-10-21

- Neu: In der Dateiansicht springt ein getippter Buchstabe zum nächsten Eintrag mit diesem Anfang. Schnell weitergetippt wird daraus ein Namensanfang, derselbe Buchstabe mehrmals geht zum nächsten Treffer. Das gilt für die lokale und die Server-Seite.
- Neu: Übertragungen zeigen nach der ersten Sekunde ihre Geschwindigkeit (etwa 12 MB/s) hinter dem Fortschritt.
```

```
## [0.17.0] – 2026-10-21

- New: In the file view, typing a letter jumps to the next entry that starts with it. Typing quickly builds a name prefix; the same letter again moves to the next match. This works on the local and the server side.
- New: Transfers show their speed (e.g. 12 MB/s) next to the progress after the first second.
```

Danach folgt `npm run version:minor`. Es ändert nur `package.json` und `package-lock.json`.

**K9** (`docs/handbuch.md` vor Zeile 344, `docs/manual.md` vor Zeile 340): Überschriften und Text sind bindend.

```
## Dateiansicht: Tastatur und Übertragungen

Tippen in der Dateiliste springt zum nächsten Eintrag, dessen Name so beginnt. Gesucht wird in der angezeigten Reihenfolge, Ordner zuerst. Schnell weitergetippt sucht Shellherd nach dem ganzen Anfang (`no` findet `notes.md`); derselbe Buchstabe mehrmals geht zum jeweils nächsten Treffer. Nach einer Sekunde Pause beginnt die Suche neu. Groß- und Kleinschreibung spielt keine Rolle. Das gilt für die lokale und die Server-Seite. Die Leertaste, Kombinationen mit `Strg` oder `Alt` und Zeichen, die nur mit `AltGr` entstehen (etwa `@`), springen nicht.

Laufende Übertragungen zeigen nach der ersten Sekunde ihre Geschwindigkeit hinter dem Fortschritt (`12 MB/s`), geglättet über die letzten Sekunden. Solange die Frage nach einer vorhandenen Datei offen ist und bei fertigen Übertragungen steht keine Geschwindigkeit. Auto-Upload zeigt keine.
```

```
## File view: keyboard and transfers

Typing in the file list jumps to the next entry whose name starts that way. The search follows the order shown, folders first. When you type quickly, Shellherd searches for the whole prefix (`no` finds `notes.md`); the same letter repeated moves to the next match each time. After a one-second pause the search starts over. Upper and lower case do not matter. This works on the local and the server side. The space bar, combinations with `Ctrl` or `Alt` and characters that need `AltGr` (such as `@`) do not jump.

Running transfers show their speed next to the progress after the first second (`12 MB/s`), smoothed over the last few seconds. While the question about an existing file is open and on finished transfers no speed is shown. Auto-upload shows none.
```

**K10** (`.claude/skills/run-app/SKILL.md`)

- Zeile 21, Kommentar zu `sftp`: „sftp erzeugt zusätzlich sftp-typeahead.png, sftp-transfer.png, sftp-auto-upload-dialog.png und sftp-auto-upload.png“.
- Zeile 30: `sftp-typeahead.png` und `sftp-transfer.png` stehen direkt nach `sftp.png`.

## 4. Welle (endgültig)

Es gibt eine Welle mit vier Tasks auf disjunkten Dateien, ohne Abhängigkeiten in der Umsetzung. Jede Datei gehört genau einem Task.

| Task | Dateien (exklusiv) | Pflichtpunkte |
|---|---|---|
| A Typeahead | `src/renderer/src/file-typeahead.ts` (neu), `src/renderer/src/file-typeahead.test.ts` (neu), `src/renderer/src/components/FilePane.tsx` | Vertrag 1 mit B1 und K1, K2. Alle Testfälle der Spec plus die aus B1 und K1. Keine Umlaute im Code von `file-typeahead.ts` (Kommentare sind englisch). Kein Timer, kein `Intl`, kein `localeCompare`. |
| B Rate | `src/main/files/transfer-rate.ts` (neu), `src/main/files/transfer-rate.test.ts` (neu), `src/main/files/transfer.ts`, `src/main/files/transfer.test.ts`, `src/main/files/sftp-session.ts`, `src/shared/sftp.ts`, `src/renderer/src/file-browser.ts`, `src/renderer/src/file-browser.test.ts`, `src/renderer/src/components/FilesPanel.tsx` | Vertrag 1 mit B3, K3 bis K6. `auto-upload.ts` bleibt unberührt. Kein neuer i18n-Key. `sftp-session.ts` ändert sich um genau eine Zeile. |
| C Doku und Version | `docs/handbuch.md`, `docs/manual.md`, `CHANGELOG.md`, `CHANGELOG.en.md`, `package.json`, `package-lock.json` | K8 und K9 im Wortlaut. `npm run version:minor` erst, wenn beide Changelogs geschrieben sind. Danach `npx vitest run src/shared/version.test.ts` und `node scripts/check-version.mjs` grün. |
| D run-app | `.claude/skills/run-app/screens.mjs`, `.claude/skills/run-app/SKILL.md` | B2, K7, K10. Erst nach A und B gegen einen frischen Build ausführen: `npx electron-vite build`, Treiber neu starten. Beide neuen Screenshots ansehen, `sftp-transfer.png` muss eine Rate zeigen. |

Grün nach der Welle:

- A und B berühren keine gemeinsame Datei und keinen gemeinsamen Typ. `TransferJob` erweitert nur B, und das Feld ist optional.
- Jeder Task ist für sich typecheck- und testgrün. Ausnahme ist das Zeitfenster in C zwischen Changelog-Edit und `version:minor`. Läuft in diesem Fenster `version.test.ts` rot, ist das kein Fehler von A oder B. Die Umsetzer A und B führen deshalb gezielt ihre eigenen Testdateien und `npm run typecheck` aus.
- Gate nach der Welle: `npm run typecheck` und `npx vitest run` voll grün, danach D in der echten App.

## 5. Offene Risiken

1. **AltGr** (hingenommen, Ruling): `@`, `~`, `{`, `[` und `\` sind unter Windows kein Typeahead, weil Chromium dort `ctrlKey && altKey` meldet. Nachrüsten ginge über `event.getModifierState('AltGraph')`.
2. **Stockender Stream und Skip-Serien**: Die zuletzt gemessene Rate bleibt stehen, bis der nächste Chunk kommt. Das gilt auch, während mit „Alle überspringen“ viele Dateien ohne Transfer durchlaufen. Nach einem langen Stillstand fällt die Rate kurz ab, weil die Basisprobe vor dem Stillstand liegt. Geregelt über den Shortcut-Kommentar.
3. **run-app-Durchsatz**: Loopback, ssh2 in JavaScript und `writeSync` je WRITE-Paket schaffen erfahrungsgemäß etwa 20 bis 100 MB/s. 256 MB dauern also etwa 3 bis 13 s, und die Rate ist ab 1 s sichtbar. Auf sehr schnellen Rechnern (unter 1,3 s Gesamtzeit) kann der Rate-`waitFor` die Anzeige verpassen. Dann wird die Datei auf 1 GB erhöht, ohne die Logik zu ändern. Endet der Upload zwischen Erkennung und Screenshot, fehlt die Rate auf dem Bild. Deshalb muss der Screenshot angesehen werden.
4. **Plattenplatz run-app**: Unter `RUN_DIR` liegen kurzzeitig bis zu 512 MB (lokal und Server). Der Lauf räumt im `finally` auf, `seedSftp` ebenfalls beim nächsten Start.
5. **Screenreader**: Typeahead wird wie die Pfeiltasten nur über `aria-selected` angesagt, nicht über `aria-activedescendant` (E1, Ruling).
6. **NFC**: Zerlegte Umlaute in Dateinamen (etwa von macOS-Servern) treffen ein getipptes `ä` nicht. Shortcut laut Spec, nachrüsten bei Meldung.
