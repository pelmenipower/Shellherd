# SFTP: Tippen zum Springen und Übertragungsgeschwindigkeit – Design

Auftrag: „Wenn ich in einem Ordner bin und einen Buchstaben tippe, will ich, dass er zu der Datei springt. Standard-Usability. Ich will beim Hochladen eine MB/s-Anzeige für die Geschwindigkeit.“ Grundlage ist das Konzept `.superpowers/sdd/sftp-typeahead-speed-research.md`, ab „1.“ hier vollständig als Spec übernommen. Plan: `docs/superpowers/plans/2026-10-21-sftp-typeahead-speed.md`.

## Spec-Rulings (Stufe 3)

- **S1** Die Rulings aus dem Ledger und die Rulings-Vorschläge am Ende des Konzepts gelten.
- **S2** Umfang ist Stufe 1. Die Extras entfallen (aria-activedescendant, Durchschnittsrate, Rate im Auto-Upload, Typeahead im Baum, Restzeit).
- **S3** Version `0.17.0`, CHANGELOG ohne Fettdruck.
- **S4** Abnahme: Typecheck und `npx vitest run` grün, run-app-Block `sftp` mit Typeahead und großem Upload, Screenshot mit sichtbarer Rate ansehen.

## 1. Bestand und Lücken

### A) Dateiliste und Tastatur

| Was | Wo | Befund |
|---|---|---|
| Tastatur-Handler der Liste | `src/renderer/src/components/FilePane.tsx:115-141` | `onKeyDown` auf dem `.file-list`-Div (`role="grid"`, `tabIndex={0}`, Zeile 238). Frühes `return` bei `disabled || prompt || !path` (116). Belegt: Pfeile, Home/End, Enter, Backspace, F2, F4, Shift+F4, F5, F6, F7, F9, Delete, Strg+A, Strg+R. Kein Zweig für Buchstaben. |
| `moveTo(next)` | `FilePane.tsx:118-124` | Setzt Cursor und Auswahl; liest `event.shiftKey` direkt und erweitert dann den Bereich. Für Typeahead unbrauchbar, solange Shift (Großbuchstabe) als Bereichserweiterung gilt. |
| Anzeige-Reihenfolge | `FilePane.tsx:68-69`, `src/renderer/src/file-browser.ts:14-22` | `entries` = `sortEntries(listing.entries, sort)`: Ordner und Ordner-Links zuerst, dann nach Spalte, Namensvergleich über `compareText` (Collator). `names` ist die Reihenfolge der Anzeige. Die `..`-Zeile (252) steht nicht in `names`. |
| Scrollen zum Cursor | `FilePane.tsx:79-81` | Effekt scrollt `[data-name=cursor]` mit `scrollIntoView({ block: 'nearest' })`. Greift für jede Cursoränderung, also auch für Typeahead. |
| Ansage | `FilePane.tsx:255` | Zeilen tragen `aria-selected`; der Fokus bleibt auf dem Grid-Container. Kein `aria-activedescendant` (im Renderer nur in `WorkflowPalette.tsx:59`). Pfeiltasten werden heute nicht angesagt; Typeahead ändert daran nichts, Lücke bleibt bestehen (Extra E1). |
| Eingabefelder | `FilePane.tsx:216` (Pfad), `227` (Prompt) | Beide liegen außerhalb des `.file-list`-Divs, ihre Tastendrücke erreichen `onKeyDown` nicht. Prompt zusätzlich über `prompt`-Guard (116). Kontextmenü (272) ebenfalls außerhalb. |
| Globale Tastenkürzel | `src/renderer/src/hooks/useShortcut.ts:4-16` | Nur Strg(+Shift)+Code in der Capture-Phase. Einzelne Buchstaben ohne Modifier kollidieren mit nichts. |
| Unicode-Vergleich | `src/shared/format.ts:48-59` | `compareText` (Collator, für Sortierung) und `foldCase` (`toLocaleLowerCase(locale)`). Es gibt keine Präfix-Funktion; `foldCase(name).startsWith(foldCase(prefix))` ist das Muster, das `vault-search.ts:7-11` und `container-columns.ts:128-129` schon nutzen. `localeCompare` ist nirgends nötig. |
| Testmuster | `src/renderer/src/file-browser.test.ts:1-40` | Reine Funktionen, `FileEntry`-Fabriken, vitest. Testdateien sind von der Umlaut-Regel (g) ausgenommen (`i18n-catalog.test.ts:36`). |

Lücke: Es fehlt genau ein `else if`-Zweig plus eine reine Funktion mit Puffer.

### B) Übertragungsfortschritt

| Was | Wo | Befund |
|---|---|---|
| Byte-Zähler | `src/main/files/transfer.ts:109-115` | `copyFile` zählt im `Transform` jeden Chunk auf `job.doneBytes` und ruft `hooks.progress(job)`. Hier fließen die echten gestreamten Bytes. |
| Sprünge ohne Transfer | `transfer.ts:88-90` | Übersprungene Dateien (`skip`, `newer`) addieren `item.size` auf `doneBytes` ohne Übertragung. Eine Rate aus `doneBytes`-Deltas wäre hier falsch hoch. |
| Konfliktpause | `transfer.ts:79-84`, `src/main/files/sftp-session.ts:285-293` | `await hooks.conflict(...)` hält den Lauf an; `ask` sendet davor ein erzwungenes `emitJob`. Während der Pause kommt kein `progress`, der Renderer hält den letzten Snapshot. |
| Throttle | `sftp-session.ts:24,249-254` | `PROGRESS_INTERVAL = 200`, Snapshot `{ ...entry.job }`. Alle Felder von `TransferJob` reisen automatisch mit, auch neue. |
| Ende | `sftp-session.ts:276-281` | `finally` setzt `job.current = undefined` und emittiert erzwungen, für done, error und canceled. |
| Zustand für andere Fenster | `sftp-session.ts:315-319` | `state()` kopiert die Jobs; keine Zod-Schemas auf Antworten oder Events (kein weiterer Code liest `doneBytes`, nur `auto-upload.ts:82`, `FilesPanel.tsx:368`, `file-browser.ts:93`). |
| Job-Typ | `src/shared/sftp.ts:30-48` | `TransferJob` ohne Zeitfeld. |
| Anzeige | `src/renderer/src/components/FilesPanel.tsx:366-371` | Ein `<small>` mit `·`-getrennten Teilen: Zustand, Dateien, Bytes (`files:queue.bytes`), übersprungen, aktueller Name, Fehler. Die Rate gehört als weiterer Teil hinter die Bytes. |
| Formatierung | `src/renderer/src/file-browser.ts:24-30` | `formatSize` lebt hier (nicht in `shared/format.ts`), Einheiten `B`, `KB`, `MB` als Code-Literale, Zahl über `formatNumber`. `formatRate` kommt daneben. |
| Auto-Upload | `src/main/files/auto-upload.ts:82,271` | Eigener Job mit `progress: () => {}`; erscheint nicht in der Queue. Unberührt. |
| run-app | `.claude/skills/run-app/screens.mjs:69-101`, `sshd.mjs:50-95`, `fixtures.mjs:69-76` | SFTP-Block lädt nur per Auto-Upload hoch. Der Fake-Server schreibt echte Dateien unter `RUN_DIR/sftp` (`sshd.mjs:167`), `seedSftp` löscht den Baum beim Start. Ein großer Upload ist möglich. |
| Testmuster Main | `src/main/files/transfer.test.ts:12-46`, `sftp-session.test.ts:163` | In-Memory-Dateisystem, `vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })` ist etabliert. |

Lücke: Messung, ein optionales Feld, ein Formatierer, ein Anzeigeteil.

## 2. Empfehlung A: Tippen zum Springen

Wert ★★★, Aufwand: nur Renderer (eine neue Datei, ~25 Zeilen in `FilePane.tsx` geändert: 3).

### Reine Logik: `src/renderer/src/file-typeahead.ts` (neu)

```ts
import { foldCase } from '../../shared/format';

export const TYPEAHEAD_MS = 1000;
export interface Typeahead { text: string; at: number }

/** One printable character without Ctrl/Alt/Meta; Space and named keys (F5, Backspace, Dead) stay with their bindings. */
export function isTypeaheadKey(event: { key: string; ctrlKey: boolean; altKey: boolean; metaKey: boolean }): boolean {
  return event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.altKey && !event.metaKey;
}

/** Explorer rule: characters typed within TYPEAHEAD_MS form a prefix; one character repeated cycles through its matches.
 *  Searches `names` in display order, wrapping; a fresh character starts after the cursor, a longer prefix at the cursor. */
export function typeahead(names: string[], cursor: string | null, previous: Typeahead | null, key: string, now: number): { name: string | null; state: Typeahead } {
  const text = previous && now - previous.at < TYPEAHEAD_MS ? previous.text + key : key;
  const repeat = text.length > 1 && [...text].every(char => char === text[0]);
  const prefix = foldCase(repeat ? text[0] : text);
  const index = cursor ? names.indexOf(cursor) : -1;
  const start = repeat || text.length === 1 ? index + 1 : index;
  for (let step = 0; step < names.length; step += 1) {
    const name = names[(start + step) % names.length];
    if (foldCase(name).startsWith(prefix)) return { name, state: { text, at: now } };
  }
  return { name: null, state: { text, at: now } };
}
```

Entscheidungen darin:
- **Verfall über Zeitstempel**, kein Timer: `now` ist Parameter, Tests brauchen keine Fake-Timer, die Komponente keinen Cleanup.
- **Groß/Klein** über `foldCase` (locale-bewusst, `format.ts:57`), kein `localeCompare`, kein `Intl` in der Komponente. Keine NFC-Normalisierung (shortcut: zerlegte Umlaute in Dateinamen treffen nicht; nachrüsten, wenn es jemand meldet).
- **Sortierung**: `names` aus `FilePane.tsx:69` ist die Anzeige-Reihenfolge (Ordner zuerst, aktuelle Spalte und Richtung). Explorer sucht ebenfalls in Anzeige-Reihenfolge.
- **Kein Treffer**: Cursor bleibt, Puffer bleibt (wie Explorer), Taste gilt trotzdem als behandelt.

### Einbau in `FilePane.tsx`

1. Zeile 67: `const typeaheadRef = useRef<Typeahead | null>(null);`
2. Zeile 118/121: `const moveTo = (next: number, extend = event.shiftKey): void => { … if (extend) { … } … }` – Großbuchstaben erweitern die Auswahl nicht.
3. Nach Zeile 140 als letzter Zweig (alle belegten Tasten gewinnen vorher):
   ```ts
   else if (isTypeaheadKey(event) && !event.nativeEvent.isComposing) {
     handled();
     const hit = typeahead(names, cursor, typeaheadRef.current, event.key, Date.now());
     typeaheadRef.current = hit.state;
     if (hit.name) moveTo(names.indexOf(hit.name), false);
   }
   ```
   `handled()` (125) verhindert Default und Bubbling wie bei den Pfeiltasten. Beide Seiten bekommen es automatisch, denn `FilePane` ist für lokal und Server dieselbe Komponente.

Scrollen und Ansage: nichts Neues. Der Effekt `FilePane.tsx:79-81` scrollt den Cursor in Sicht; die Zeile bekommt `aria-selected="true"` wie bei Pfeiltasten. Ein `aria-activedescendant` wäre für Pfeile und Typeahead dieselbe Nachrüstung (E1, nicht jetzt).

Ausdrücklich nicht ausgelöst: Leertaste, F-Tasten, Backspace, Delete, Enter, Home/End (alle `key.length > 1` oder eigener Zweig), Strg/Alt/Meta-Kombinationen (damit auch AltGr-Zeichen wie `@` und `~`, Chromium setzt dort `ctrlKey && altKey`; hingenommen), IME-Komposition, Eingabefelder (strukturell außerhalb), deaktivierte Liste oder offener Prompt (Guard 116).

### Tests: `src/renderer/src/file-typeahead.test.ts` (neu)

Namen in Anzeige-Reihenfolge `['Bilder', 'www', 'alpha.txt', 'Beta.md', 'bravo.sh', 'ärger.txt']`:
- `b` ohne Cursor → `Bilder` (Groß/Klein egal); `b` bei +300 ms → `Beta.md`; `b` → `bravo.sh`; `b` → wieder `Bilder` (Umlauf).
- `b`, dann `r` innerhalb 1 s mit Cursor `Bilder` → `bravo.sh` (Präfix `br`, Suche ab Cursor einschließlich).
- `b` bei 0, `r` bei 1500 → neuer Puffer `r`, kein Treffer → `name: null`, `state.text === 'r'`.
- `ä` und `Ä` → `ärger.txt`.
- `w`, `w` → bleibt `www` (einziger Treffer beim Zyklus).
- leere Liste → `null`.
- `isTypeaheadKey`: `a`, `ä`, `.` ja; `' '`, `F5`, `Backspace`, `Dead`, Strg+`a`, Alt+`a` nein.

## 3. Empfehlung B: Übertragungsgeschwindigkeit

Wert ★★★, Aufwand: kleine Main-Änderung (eine neue Datei ~20 Zeilen, `transfer.ts` 4 Zeilen, `sftp-session.ts` 1 Zeile, `sftp.ts` 1 Feld, Renderer 2 Zeilen).

### Messort: Main, in `transfer.ts`, aus gestreamten Bytes

Entscheidung gegen den Renderer: Der Renderer sieht nur 200-ms-Snapshots von `doneBytes`, in denen übersprungene Dateien als Sprung erscheinen (`transfer.ts:89`), und nach `transferOwner` (Fensterwechsel) fehlt ihm die Historie. Entscheidung gegen `emitJob` in `sftp-session.ts`: dort ist nur `doneBytes` sichtbar, nicht, ob die Bytes geflossen sind. Im `Transform` von `copyFile` (`transfer.ts:111`) fließen genau die übertragenen Chunks; dort wird gemessen. Das Ergebnis reist als Feld im Job, Throttle und Snapshot bleiben wie sie sind.

### Reine Logik: `src/main/files/transfer-rate.ts` (neu)

```ts
const WINDOW_MS = 3000;
const MIN_SPAN_MS = 1000;
const SAMPLE_MS = 100;

/** Bytes per second over a sliding window of streamed chunks; undefined until the window spans MIN_SPAN_MS. */
export function rateMeter(now: () => number = Date.now): { add: (bytes: number) => number | undefined; reset: () => void } {
  let samples: { at: number; total: number }[] = [];
  let total = 0;
  return {
    add(bytes) {
      total += bytes;
      const at = now();
      const last = samples[samples.length - 1];
      if (!last || at - last.at >= SAMPLE_MS) samples.push({ at, total });
      // The oldest kept sample is the base; one sample may sit just outside the window so the span stays near WINDOW_MS.
      while (samples.length > 1 && samples[1].at <= at - WINDOW_MS) samples.shift();
      const span = at - samples[0].at;
      return span >= MIN_SPAN_MS ? (total - samples[0].total) / span * 1000 : undefined;
    },
    reset() { samples = []; },
  };
}
```

- **Glättung**: gleitendes Fenster 3 s, höchstens eine Probe je 100 ms (bei 64-KB-Chunks und 100 MB/s wären es sonst 1 600 Proben/s). Kein EMA: das Fenster ist vorhersagbar und ebenso kurz.
- **Anzeige erst nach kurzer Zeit**: `undefined`, solange das Fenster unter 1 s liegt. Das deckt kurze Transfers ab, die sonst eine Fantasiezahl aus 20 ms zeigen.
- **Fenster über Dateigrenzen**: der Meter lebt je Job (in `runTransfer`), nicht je Datei; sonst zeigte ein Ordner aus kleinen Dateien nie eine Rate.
- `now` ist injizierbar, der Test braucht keine Fake-Timer.

### Einbau

`src/shared/sftp.ts:46` (neben `current`):
```ts
/** Smoothed rate of the running copy; absent in the first second, while a conflict question is open and after the end. */
bytesPerSecond?: number;
```

`src/main/files/transfer.ts`:
- `runTransfer` (62): `const rate = rateMeter();`, an `copyFile` weiterreichen (ein Parameter mehr, 96/109).
- Konfliktzweig vor `await hooks.conflict(...)` (80): `job.bytesPerSecond = undefined; rate.reset();` – `ask` (`sftp-session.ts:290`) emittiert direkt danach erzwungen, der Dialog zeigt also keine Rate; nach der Antwort beginnt das Fenster neu.
- Zähler (111-115): `job.bytesPerSecond = rate.add(chunk.length);` vor `hooks.progress(job)`.
- Übersprungene Dateien (88-90) bleiben unangetastet: sie streamen nichts, der Meter sieht sie nicht.
- Shortcut-Kommentar an den Zähler: `// shortcut: a stalled stream keeps the last rate until the next chunk; add a timer if users report it.` (Ein Stillstand ohne Chunks sendet ohnehin keinen Progress, der Renderer hält dann auch `doneBytes` fest; konsistent.)

`src/main/files/sftp-session.ts:277` im `finally`: `job.bytesPerSecond = undefined;` neben `job.current = undefined;`. Damit ist die Quelle sauber für done, error, canceled und für `state()` eines adoptierenden Fensters. `auto-upload.ts` bleibt unverändert; sein interner Job bekommt das Feld gesetzt, niemand liest es.

`src/renderer/src/file-browser.ts:30` (hinter `formatSize`):
```ts
export function formatRate(bytesPerSecond: number): string { return `${formatSize(bytesPerSecond)}/s`; }
```
`/s` ist eine Einheit wie `KB` (Zeile 24) und kein UI-Text; kein i18n-Key, kein `i18n-ignore` nötig (die Regel (g) prüft Umlaute und JSX-Sätze). Ergebnis de `1,5 MB/s`, en `1.5 MB/s` über `formatNumber`.

`src/renderer/src/components/FilesPanel.tsx`:
- Zeile 12: `formatRate` importieren.
- Nach Zeile 368: `{!!job.bytesPerSecond && ` · ${formatRate(job.bytesPerSecond)}`}` – falsy (0, undefined) zeigt nichts; die Main setzt das Feld bei Konflikt und Ende auf `undefined`, Download und Upload laufen durch denselben Code.

Kein CSS, kein Token, keine Bewegung: der Text steht im bestehenden `<small>` (`files-ui.css:74-88` deckt es ab). Keine neuen i18n-Keys in de/en.

### Tests

- `src/main/files/transfer-rate.test.ts` (neu, manuelle Uhr `let t = 0; rateMeter(() => t)`): vor 1 s `undefined`; drei Proben 0/600/1200 ms je 1 024 B → `(2048 / 1.2 s)`; Fenster rollt (Proben älter als 3 s fallen weg, die Rate folgt dem jüngsten Abschnitt); `reset()` liefert wieder `undefined` bis 1 s; zwei `add` innerhalb 100 ms ergeben eine Probe (Rate rechnet mit dem Gesamtbetrag).
- `src/main/files/transfer.test.ts` (bestehend, ergänzen): `vi.useFakeTimers({ toFake: ['Date'] })` wie `sftp-session.test.ts:163`; `from.read` liefert einen Async-Generator, der zwischen drei 1-KB-Chunks `vi.advanceTimersByTime(600)` ruft; der `progress`-Hook sammelt `job.bytesPerSecond`: erste zwei Aufrufe `undefined`, dritter `> 0`. Zweiter Fall: Zieldatei vorhanden, `conflict`-Hook liest `job.bytesPerSecond` → `undefined`, und nach `overwrite` beginnt das Fenster neu (nächster Chunk `undefined`).
- `src/renderer/src/file-browser.test.ts`: `formatRate(1.5 * 1024 * 1024)` → `'1,5 MB/s'`, `formatRate(512)` → `'512 B/s'`.
- `sftp-session.test.ts`: kein neuer Test nötig; `toEqual` ignoriert `undefined`-Felder (kein `toStrictEqual` in den Dateitests).

## 4. Doku und Version

- `docs/handbuch.md`: neuer kurzer Abschnitt `## Dateiansicht: Tastatur und Übertragungen` direkt vor `## Dateiansicht: Auto-Upload` (Zeile 344). Inhalt: Tippen springt zum nächsten Eintrag mit diesem Anfang (Ordner zuerst, in der angezeigten Reihenfolge), schnell weitergetippt wird daraus ein Präfix, derselbe Buchstabe wiederholt geht zum nächsten Treffer, nach einer Sekunde Pause beginnt die Suche neu, Groß/Klein egal; gilt für beide Seiten. Übertragungen zeigen nach der ersten Sekunde die geglättete Geschwindigkeit (`12 MB/s`) hinter dem Fortschritt; während der Konfliktfrage und bei fertigen Jobs steht keine Rate; Auto-Upload zeigt keine.
- `docs/manual.md`: dasselbe englisch vor `## File view: auto-upload` (Zeile 340).
- `CHANGELOG.md` und `CHANGELOG.en.md`: Abschnitt `## [0.17.0] – 2026-10-21` mit zwei `Neu:`-Zeilen (Wortlaut wie 0.16.0). `npm run version:minor` (→ `package.json`, `package-lock.json`). `src/shared/version.test.ts:10-12` und `scripts/check-version.mjs` prüfen beide Changelogs gegen die Version.
- README: keine Änderung (englischer Kurzüberblick, SFTP-Zeile 41 bleibt zutreffend).

## 5. run-app

`.claude/skills/run-app/screens.mjs`, Block `sftp` (69-101), zwei Schritte nach `shot('sftp')` und vor dem Auto-Upload-Teil (eine aktive Bindung würde eine große Datei im lokalen Ordner sonst selbst hochladen):

1. Typeahead: `await click('.file-pane-remote .file-list')` (fokussiert, leert Auswahl), `await key('n')`, `waitFor('Typeahead', '!!document.querySelector(".file-pane-remote .file-row.is-cursor[data-name=\\"notes.md\\"]")')`, `shot('sftp-typeahead')`. `/home/demo` zeigt `backups`, `www`, `.bashrc`, `.profile`, `notes.md`; `n` trifft nur `notes.md`.
2. Rate: `fs.writeFileSync(path.join(target, 'big.bin'), Buffer.alloc(256 * 1024 * 1024))` (Nullen, SFTP komprimiert nicht; über Loopback läuft der Fake-Server mit synchronem `writeSync` einige Sekunden, genug für das 1-s-Fenster). `click('.file-pane-local [role=row][data-name="big.bin"]')`, `click('.file-pane-local footer button:first-child')` (`Hochladen →`), `waitFor('Rate', '/\\d\\s?[KMG]B\\/s/.test(document.querySelector(".transfer-queue")?.innerText ?? "")')`, `shot('sftp-transfer')`, `waitFor('Fertig', ...)`. Aufräumen: `fs.rmSync` auf `path.join(target, 'big.bin')` und `path.join(RUN_DIR, 'sftp', 'home', 'demo', 'big.bin')` (`sshd.mjs:167`), dann `click('.file-pane-remote button[aria-label="Aktualisieren"]')` und `click('.file-pane-local button[aria-label="Aktualisieren"]')`, damit der zweite Lauf keinen Konfliktdialog bekommt und `waitFor('hochgeladene Datei')` (97) unverändert gilt. `Erledigte entfernen` leert die Queue (`.transfer-queue header button`).
3. `.claude/skills/run-app/SKILL.md`: `sftp-typeahead.png` und `sftp-transfer.png` in beide Screenshot-Listen (Zeile 21 und 30).

Datei `big.bin` nur im Transfer-Schritt anlegen, nicht in `localTarget()` (53-63), sonst lädt der spätere Auto-Upload-Abgleich sie hoch.

## 6. Regeln und Risiken: was ausdrücklich nicht getan wird

- Keine ETA (Ruling). Keine Durchschnittsrate auf fertigen Jobs.
- Keine Rate im Auto-Upload (`AutoUploadStatus` bleibt wie er ist), keine in der Statusleiste.
- Kein `aria-activedescendant`, keine Live-Region: gleiches Ansageverhalten wie Pfeiltasten.
- Keine Timer in der Komponente (Zeitstempel reichen), keine Normalisierung (NFC) von Dateinamen.
- Keine neuen i18n-Keys, Tokens, CSS-Regeln oder Bewegung. Design-System-Tests bleiben unberührt.
- `runTransfer`-Signatur bleibt (der Meter ist intern); Auto-Upload unverändert.
- Sicherheitsregeln früherer Specs gelten: kein Löschen auf dem Server außerhalb von `move`, keine freien Pfade über IPC. Beide Features berühren keinen IPC-Kanal und kein Schema.
- Risiko Typeahead: AltGr-Zeichen (`@`, `~`, `{`) lösen nichts aus, weil Chromium `ctrlKey && altKey` setzt. Hingenommen; nachrüsten über `event.getModifierState('AltGraph')`, falls gemeldet.
- Risiko Rate: ein stockender Stream hält den letzten Wert bis zum nächsten Chunk (Shortcut-Kommentar). Ein Fenster, das die Sitzung nach der Konfliktpause adoptiert, sieht korrekt `undefined`.
- Risiko run-app: 256 MB im `RUN_DIR`; der Block räumt beide Kopien selbst auf, `seedSftp` löscht den Server-Baum ohnehin beim nächsten Start.

## 7. Zerlegung in parallele Tasks

Eine Welle, vier Tasks auf disjunkten Dateien, keine Abhängigkeiten untereinander. Danach eine Prüfung (`npm run typecheck`, `npx vitest run`, run-app `sftp`).

| Task | Dateien (exklusiv) | Inhalt |
|---|---|---|
| A Typeahead | `src/renderer/src/file-typeahead.ts` (neu), `src/renderer/src/file-typeahead.test.ts` (neu), `src/renderer/src/components/FilePane.tsx` | Abschnitt 2 |
| B Rate | `src/main/files/transfer-rate.ts` (neu), `src/main/files/transfer-rate.test.ts` (neu), `src/main/files/transfer.ts`, `src/main/files/transfer.test.ts`, `src/main/files/sftp-session.ts` (eine Zeile), `src/shared/sftp.ts`, `src/renderer/src/file-browser.ts`, `src/renderer/src/file-browser.test.ts`, `src/renderer/src/components/FilesPanel.tsx` | Abschnitt 3 |
| C Doku und Version | `docs/handbuch.md`, `docs/manual.md`, `CHANGELOG.md`, `CHANGELOG.en.md`, `package.json`, `package-lock.json` (über `npm run version:minor`) | Abschnitt 4 |
| D run-app | `.claude/skills/run-app/screens.mjs`, `.claude/skills/run-app/SKILL.md` | Abschnitt 5; die Selektoren stehen fest (`is-cursor`, `data-name`, `.transfer-queue`), D kann parallel zu A und B geschrieben werden und läuft erst nach dem Build |

Abhängigkeit nur zur Prüfung: D wird nach A und B gegen `out/` ausgeführt.

## 8. Minimale erste Stufe gegenüber Extras

Erste Stufe = Tasks A bis D wie oben. Alles darin ist nötig, damit beide Nutzerwünsche vollständig und geprüft sind.

| Extra | Wert | Aufwand | Entscheidung |
|---|---|---|---|
| E1 `aria-activedescendant` auf dem Grid für Pfeile und Typeahead (Zeilen brauchen `id`) | ★★ | nur Renderer, ~4 Zeilen | nicht jetzt; eigener a11y-Punkt für beide Navigationsarten |
| E2 Durchschnittsrate auf fertigen Jobs („12 MB/s im Schnitt“) | ★ | kleine Main-Änderung | nicht jetzt |
| E3 Rate je Auto-Upload-Bindung | ★ | Main plus Renderer | nicht jetzt; Auto-Upload läuft im Hintergrund |
| E4 Typeahead im Verbindungsbaum | ★★ | nur Renderer | nicht jetzt; eigener Bereich, Baum hat die Suche |
| E5 Restzeit | – | – | ausgeschlossen (Ruling) |

## 9. Rulings-Vorschläge

- Ruling: Typeahead-Logik in `src/renderer/src/file-typeahead.ts`, Verfall 1 000 ms über Zeitstempel ohne Timer — testbar ohne Fake-Zeit, kein Cleanup — gering.
- Ruling: Ein frisch getipptes Zeichen sucht ab dem Eintrag nach dem Cursor, ein verlängertes Präfix ab dem Cursor einschließlich, dasselbe Zeichen wiederholt zyklisch; Umlauf am Ende — Explorer-Verhalten — gering.
- Ruling: Shift beim Tippen (Großbuchstabe) erweitert die Auswahl nicht; `moveTo` bekommt den Parameter `extend` — sonst wählt „B“ einen Bereich — gering.
- Ruling: Leertaste, Strg/Alt/Meta (damit auch AltGr-Zeichen) und IME-Komposition sind kein Typeahead — belegte Tasten und Eingabemethoden bleiben unberührt — gering (AltGr-Zeichen fehlen als Präfix).
- Ruling: Kein `aria-activedescendant` in Stufe 1; Typeahead sagt wie Pfeiltasten über `aria-selected` an — gleiches Verhalten, eigener a11y-Punkt — gering.
- Ruling: Die Rate wird im Main in `transfer.ts` aus gestreamten Chunks gemessen (gleitendes Fenster 3 s, Anzeige ab 1 s, Probe je 100 ms) und als `bytesPerSecond?` im `TransferJob` gesendet; übersprungene Dateien zählen nicht — richtig bei Skips, Fensterwechsel und Throttle — gering.
- Ruling: Bei Konfliktfrage und am Ende setzt der Main `bytesPerSecond` auf `undefined`; der Renderer zeigt nur truthy Werte — keine falschen Werte in Pausen — gering.
- Ruling: `formatRate` steht neben `formatSize` in `file-browser.ts`, `/s` ist Einheit wie `KB` und kein i18n-Key — keine neuen Katalog-Einträge — gering.
- Ruling: Auto-Upload bleibt ohne Rate — nicht verlangt, kein Queue-Eintrag — gering.
- Ruling: run-app lädt 256 MB Nullen hoch, räumt lokal und unter `RUN_DIR/sftp` selbst auf und läuft vor dem Auto-Upload-Teil — sonst lädt die Bindung die Datei — gering.
- Ruling: Version 0.17.0, Doku als eigener Abschnitt vor „Dateiansicht: Auto-Upload“ in Handbuch und Manual — Pipeline-Regel — gering.
