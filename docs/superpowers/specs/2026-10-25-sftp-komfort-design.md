# SFTP-Komfort: Gehe zu, versteckte Dateien, Filter – Design

> Übernommen aus dem Konzept (Opus, `.superpowers/sdd/sftp-komfort-research.md`). Bindend geht `2026-10-25-sftp-komfort-validation.md` vor.


Branch `claude/feature/sftp-komfort`, gestapelt auf 0.22.0, Ziel **0.23.0**.

Vier Komfortfunktionen der Dateiansicht:
1. Pfadfeld „Gehe zu“
2. versteckte Dateien
3. Filterbox
4. Ziehen in den Explorer

Die Umsetzer sind Haiku-Modelle. Signaturen, Texte und Fehlercodes unten sind verbindlich und wörtlich zu übernehmen.

---

## 0. Bestand (mit Fundstellen)

### Pfadfeld
- **Das Pfadfeld gibt es schon.** `FilePane.tsx:224-232`: Ein Doppelklick auf die Brotkrumen-`nav` macht daraus ein `<input aria-label="Pfad">`. Die Leiste hat den Hinweis `files:pane.pathHint` = „Doppelklick: Pfad eingeben“ (`:227`).
  - `Enter` ruft `onNavigate(value)` auf, ohne auf das Ergebnis zu warten, und schließt das Feld (`:224`).
  - `Escape` und Blur schließen das Feld (`:226`).
- **Lücken:**
  - Es gibt keinen Tastaturzugang.
  - Ein Fehler erscheint nicht am Feld, sondern als Banner `file-error` über der Liste (`FilesPanel.tsx:116-119` → `FilePane.tsx:244`). Das Feld ist dann schon zu, und die Eingabe ist verloren.
  - `~` wird nicht unterstützt.
  - Relative Server-Pfade scheitern am Schema: `remotePath` verlangt `/…` oder `.` (`src/main/files/ipc.ts:23`). Das Ergebnis ist „Ungültige Dateianfrage.“.
  - Lokal scheitern `C:/x` und `Projekte` an `win32.isAbsolute` (`ipc.ts:24`).
- **Server:** `list` ruft `realpath(path)` und dann `readdir` auf (`sftp-session.ts:188-192`). `realpath` löst `..` auf, aber kein `~`. Der Basisordner ist `realpath('.')` (`:186`). Er liegt im Renderer als `homes.remote` (`FilesPanel.tsx:155`).
- **Lokal:** `localList` ruft `win32.resolve(path)` und `readdir` auf (`ipc.ts:122-125`). Das Schema lässt **jeden** absoluten win32-Pfad durch, also auch UNC und Gerätepfade (`\\?\…`, `\\.\…`).
  - Die vorhandene Regel `AUTO_UPLOAD_LOCAL_PATH` (`src/shared/vault/schema.ts:49-50`) erlaubt Laufwerke und UNC und lehnt Gerätepfade ab. Sie gilt bisher nur für Auto-Upload-Bindungen.
- **Datei statt Ordner:** `fileError` (`file-system.ts:44-55`) kennt kein `ENOTDIR`. Ein Dateipfad im Feld ergibt deshalb „Die Dateiaktion ist fehlgeschlagen.“.
  - OpenSSH meldet `ENOTDIR` als `NO_SUCH_FILE`.
  - Der Demo-Server öffnet eine Datei per `OPENDIR` und antwortet auf `READDIR` mit `FAILURE` (`.claude/skills/run-app/sshd.mjs:85,95-97`).
- **Tasten der Liste** (`FilePane.tsx:118-149`): Pfeile, Pos1/Ende, Enter, Rücktaste, F2, F4 (Bearbeiten), Umschalt+F4, F5, F6, F7, F9, Entf, Strg+A, Strg+R. Alle anderen Zeichen gehen an Type-to-jump (`file-typeahead.ts:7-9`, ohne Strg/Alt/Meta).
  - **Strg+L und Strg+F sind in der Liste frei.**
  - Global belegt sind nur Strg+Umschalt+Leertaste (`App.tsx:138`) und Strg+, (`App.tsx:228`).
  - Strg+Umschalt+F hängt nur am xterm (`TerminalPanel.tsx:120`).
  - Es gibt keine Electron-Menü-Accelerators.

### Versteckte Dateien
- Auf dem Server werden nur `.` und `..` gefiltert (`sftp-file-system.ts:50`). Punkt-Dateien sind immer sichtbar.
- Lokal läuft `readdir` ohne Attribute (`file-system.ts:82-93`). Node und Electron liefern das Windows-Attribut „Versteckt/System“ nicht. `package.json` enthält keine native Bibliothek dafür.
- UI-Vorlieben je Profil stehen in `localStorage` unter dem Präfix `shellherd.` (`hooks/useAssistantToggle.ts:4`, `AssistantPanel.tsx:51-54`).
- `ContextMenu` kennt nur `item | heading | separator`, kein Häkchen (`ContextMenu.tsx:5-8`).

### Filter und Auswahl
- `entries` ist `sortEntries(listing.entries)` (`FilePane.tsx:71`), `names` wird daraus gebildet (`:72`).
- `targets()` nimmt nur Namen aus `names` (`:86-89`).
- Eine Auswahl wird auf `names` bereinigt (`:78-81`).
- Strg+A wählt alle `names` (`:142`). F5, F6 und Entf arbeiten über `targets()` (`:135,141`). Drag nimmt `selected` (`:185`).
- Die Prüfung „Name existiert“ beim Anlegen und Umbenennen läuft gegen `names` (`:111`).
- Fußzeile: `:316-317`. Leerzustand: `:279`. ⚙-Menü: `:306-314`.

### Drag
- Hinein in die Liste: aus der anderen Seite (`FILES_MIME`) oder aus dem Explorer, Letzteres nur auf die Server-Seite (`FilePane.tsx:160,166`).
- Heraus aus der Liste: nur `FILES_MIME` (`:183-190`). Es gibt kein `startDrag` und keine Datei-Daten fürs Betriebssystem.

### Demo
- Der sftp-Block (`screens.mjs:147-228`) öffnet das Pfadfeld per `dblclick` auf `nav[aria-label="Pfad"]` und füllt dann `input[aria-label="Pfad"]` (`:153-156`, ebenso `:679-682`). **Diese Selektoren und die Beschriftung „Pfad“ müssen bleiben.**
- Die Fixtures haben `.bashrc` und `.profile` im Server-Home (`fixtures.mjs:56-57`).
- Lokal liegen `readme.txt`, `deploy.sh` und `notes.md` (`screens.mjs:95-97`).

---

## 1. Empfehlungen

| # | Fläche / Funktion | Wert | Aufwand |
|---|---|---|---|
| 1a | Pfadfeld per **Strg+L** und über ⚙ → `Gehe zu …`. Fehler stehen am Feld, das Feld bleibt offen. | ★★★ | nur Renderer |
| 1b | `~`, `~/…` und relative Pfade auf beiden Seiten. Lokal wird `C:/x` zu `C:\x` und `D:` zu `D:\`. | ★★★ | nur Renderer |
| 1c | Lokal Gerätepfade ablehnen (Text im Renderer, Schema im Main). Für Dateipfade die Meldung „Das ist kein Ordner.“. | ★★ | kleine Main-Änderung |
| 2a | ⚙ → `Versteckte Dateien ausblenden/anzeigen`, je Seite, für Namen mit Punkt am Anfang. Standard: **anzeigen**. | ★★ | nur Renderer |
| 2b | Lokal das Windows-Attribut „Versteckt/System“ | ★ | nicht jetzt (ohne native Abhängigkeit gibt es keine API) |
| 3a | Filterfeld per **Strg+F** und über ⚙ → `Filtern …`. Prüft „enthält“, ohne Groß- und Kleinschreibung. | ★★★ | nur Renderer |
| 3b | Auswahl, F5, F6, Entf, Strg+A und Drag wirken nur auf sichtbare Einträge. | ★★★ | nur Renderer (ergibt sich aus 3a) |
| 4a | Server-Datei in den Explorer ziehen | ★★ | **nicht jetzt** (R4) |
| 4b | Lokale Datei in den Explorer ziehen | ★ | nicht jetzt (R4) |

---

## 2. Rulings (Entscheidungen mit Begründung)

### 1 – Pfadfeld „Gehe zu“

**R1.1 Kürzel Strg+L, nur bei Fokus in der Dateiliste.**
- Explorer und Browser nutzen Strg+L ebenfalls für die Adressleiste.
- F4 bleibt „Bearbeiten“ (`FilePane.tsx:138`).
- Alt+D gibt es nicht, weil die Liste nirgends Alt-Kombinationen nutzt.
- Der Doppelklick bleibt. Neu ist der Eintrag ⚙ → `Gehe zu …` mit dem Hinweis `Strg+L`.

**R1.2 Das vorhandene Feld wird ausgebaut, nicht ersetzt.**
- Die Beschriftung `files:pane.path` = „Pfad“ bleibt (die Demo braucht sie).
- `Enter` wartet auf das Ergebnis.
  - Bei Erfolg schließt das Feld, und der Fokus geht in die Liste.
  - Bei einem Fehler bleibt das Feld offen und behält den Text. Darunter steht der Fehler als `field-error` mit `role="alert"`, das Feld bekommt `aria-invalid`. Der bisherige Ordner bleibt angezeigt.
- `Esc` schließt das Feld und setzt den Fokus in die Liste.
- Blur schließt das Feld ohne Fokuswechsel, wie bisher.
- Ein Fehler erscheint nicht mehr zusätzlich im Banner.

**R1.3 Pfade werden im Renderer aufgelöst**, mit der reinen Funktion `resolveGoTo` (Vertrag 3.1).
- Server:
  - `~` führt zum Basisordner, `~/x` zu Basisordner/x.
  - `/…` bleibt unverändert, alles andere gilt relativ zum aktuellen Ordner.
  - `..` löst der Server per `realpath` auf.
  - `~user` wird **nicht** aufgelöst und gilt als normaler Name.
- Lokal:
  - `/` wird zu `\`.
  - `D:` wird zu `D:\`, `D:x` zu `D:\x`.
  - `\x` bezieht sich auf das Laufwerk des aktuellen Ordners.
  - `\\server\share` bleibt unverändert.
  - `~`, `~\x` und `~/x` beziehen sich auf den Benutzerordner.
  - Alles andere gilt relativ zum aktuellen Ordner.
  - `..` löst Main per `win32.resolve` auf.
- Eine leere Eingabe schließt das Feld.

**R1.4 Sicherheit lokal.**
- Gerätepfade (`\\?\`, `\\.\`) lehnt der Renderer mit einem Text ab.
- Main lehnt sie zusätzlich im Schema ab, aber **nur für `local:list`**, mit der vorhandenen Regex `AUTO_UPLOAD_LOCAL_PATH`. Die anderen Kanäle bekommen keinen getippten Text und bleiben unverändert, damit nichts bricht.
- UNC-Freigaben bleiben erlaubt. Der Nutzer tippt sie selbst und bestätigt mit `Enter`; das ist der Klick im Sinne von „Main öffnet nichts ohne Klick“.
- Ordner werden nur im Tab-Snapshot für den Fensterwechsel gemerkt (`FilesPanel.tsx:50,202`), nicht über einen Neustart hinweg.
- Die NTLM-Härtung bleibt A4 aus start-ui.

**R1.5 Neuer Fehlercode `files.notADirectory`.**
- Lokal wird `ENOTDIR` in `fileError` zu diesem Code.
- Auf dem Server fragt `list` nur dann per `stat` nach, wenn `readdir` scheitert. Ist der Pfad kein Ordner, kommt der neue Code, sonst der ursprüngliche Fehler. Ein erfolgreiches Listing kostet damit keinen zusätzlichen Roundtrip.
- Ein Sprung zur Datei mit Markierung wie bei WinSCP ist ein Extra.

### 2 – Versteckte Dateien

**R2.1 Standard: anzeigen.**
- Das ist das bisherige Verhalten, und es ändert sich nicht still.
- Ausgeblendet wären sonst `.env`, `.htaccess` und `.ssh`, also genau das, was Admins auf Servern bearbeiten.
- Wer die Dateien ausblendet, sieht in der Fußzeile „· N ausgeblendet“ (R3.5).

**R2.2 Regel: Der Name beginnt mit `.`**, auf beiden Seiten gleich.
- Lokal zählt das Windows-Attribut **nicht**. Node und Electron liefern es nicht.
- `attrib` oder `cmd` je Ordner zu starten wäre langsam und wegen der Quoting-Regeln von cmd ein Injektionsrisiko.
- Diese Einschränkung steht im Handbuch.

**R2.3 Gefiltert wird nur im Renderer.** Main liefert weiter alle Einträge. Es gibt kein neues IPC-Feld und keine zweite Wahrheit.

**R2.4 Gespeichert wird in `localStorage`, je Seite.**
- Schlüssel: `shellherd.files.showHidden.local` und `shellherd.files.showHidden.remote`.
- Werte: `'on'` und `'off'`. Fehlt der Schlüssel, gilt „anzeigen“.
- Die Einstellung kommt **nicht** in den Vault. Sie ist eine Ansichtsvorliebe des Geräts, wie der Assistent-Schalter, und gehört zu keiner Verbindung. Sie gilt für alle Verbindungen.
- Offene Bereiche in anderen Fenstern übernehmen sie erst beim nächsten Öffnen. Ein Live-Abgleich ist ein Extra.

**R2.5 Bedienung über das ⚙-Menü.**
- Ein Eintrag mit wechselndem Text: `Versteckte Dateien ausblenden` oder `Versteckte Dateien anzeigen`.
- Es gibt kein Tastenkürzel (Extra). Strg+H heißt in Windows-Programmen „Ersetzen“, und Strg+Alt+H kollidiert mit AltGr.

### 3 – Filter

**R3.1 Kürzel Strg+F, nur bei Fokus in der Dateiliste.**
- Kein Konflikt mit dem Terminal: R1 aus terminal-komfort verbietet Strg+F nur im Terminal, und die Dateiliste ist keine Shell.
- Neu ist der Eintrag ⚙ → `Filtern …` mit dem Hinweis `Strg+F`.
- Type-to-jump bleibt unverändert: Buchstaben in der Liste springen weiter. Das Filterfeld ist ein eigenes Input.

**R3.2 Regel:** `foldCase(name).includes(foldCase(filter.trim()))`.
- Ist der Filter leer oder besteht nur aus Leerzeichen, wird nicht gefiltert.
- Keine Platzhalter wie `*`, keine Regex.

**R3.3 Lebensdauer des Filters.**
- Er endet beim Ordnerwechsel, wie die Explorer-Suche.
- Er endet nach erfolgreichem Anlegen oder Umbenennen, damit der neue Eintrag sichtbar ist.
- `Esc` im Feld und der Knopf `×` entfernen ihn.
- Blur bei leerem Feld schließt das Feld. Ist der Filter nicht leer, bleibt das Feld sichtbar.
- `Enter` oder `↓` setzt den Fokus in die Liste. Gibt es noch keinen Cursor, gehen Cursor und Auswahl auf den ersten sichtbaren Eintrag.

**R3.4 Sicherheit (bindend).**
- Ausgeblendete oder weggefilterte Einträge sind **nicht auswählbar und nie Ziel einer Aktion**.
- Umgesetzt wird das, indem `entries` und `names` schon gefiltert sind. Dann greift die vorhandene Bereinigung (`FilePane.tsx:78-81`), und `targets()` (`:86-89`), Strg+A, F5, F6, Entf, F2, F9, Drag und das Kontextmenü sehen nur Sichtbares. Es entsteht kein zweiter Codepfad.
- **Ausnahme:** Die Namensprüfung beim Anlegen und Umbenennen läuft gegen **alle** Namen (`allNames`). Grund: Lokal überschreibt `fs.rename` unter Windows eine vorhandene Datei. Ein ausgeblendetes `.env` darf nicht still ersetzt werden.
- Ein Ordner wird weiter **vollständig** kopiert, verschoben oder gelöscht, mit den versteckten Dateien darin. Filter und Schalter betreffen nur die angezeigte Ebene. Auch das steht im Handbuch.

**R3.5 Rückmeldung.**
- Fehlen Einträge durch den Schalter oder den Filter, hängt die Fußzeile `· {{hidden}} ausgeblendet` an.
- Sind alle Einträge ausgeblendet, zeigt die Liste „Alle Einträge sind ausgeblendet.“ statt „Dieser Ordner ist leer.“.
- „N von M ausgewählt“ zählt nur sichtbare Einträge.

**R3.6 Tempo.** Erst sortieren (Memo auf `listing.entries` und die Sortierung), dann filtern (Memo auf die sortierte Liste, den Schalter und den Filter). Bei 50.000 Einträgen wird pro Tastendruck nur gefiltert, nicht neu sortiert.

### 4 – Ziehen in den Explorer: nicht jetzt

**R4.1 Vom Server in den Explorer geht es nicht sauber.**
- `webContents.startDrag({ file | files, icon })` braucht Dateien, die **beim Start des Ziehens** lokal existieren. Der Aufruf muss synchron aus `dragstart` kommen; danach blockiert das modale Drag-and-drop von Windows.
- Vorab herunterladen hieße eine von zwei schlechten Lösungen:
  - auf Verdacht beim Überfahren oder Auswählen laden (Datenschutz, Traffic, große Dateien), oder
  - das Ziehen erst nach dem Download beginnen; dann ist die Geste vorbei.
- Den Ablageordner erfährt Shellherd nicht. Die bindenden Regeln aus transfer-resume und sftp-auto-upload greifen dann nicht: Download nur in den gewählten Ordner, `.part`, Konfliktfrage, unsichere Windows-Namen überspringen.
- Temp-Kopien in `%TEMP%` müssten aufgeräumt werden, ohne dass Shellherd weiß, wann der Explorer fertig kopiert hat.

**R4.2 Ebenfalls verworfen:**
- Der `DownloadURL`-Drag von Chromium. Er braucht ein eigenes Protokoll, das Server-Dateien an Chromium streamt. Das Ziel bleibt unbekannt, es gibt weder Konfliktfrage noch Namensprüfung, und es entsteht eine neue Angriffsfläche.
- Virtuelle Dateien (`CFSTR_FILECONTENTS`). Electron unterstützt sie nicht, es bräuchte ein natives Modul.
- Der WinSCP-Weg mit einer Shell-Erweiterung, die den Ablageordner meldet. Dafür wären ein Installer und eine COM-Registrierung nötig.

**R4.3 Lokal in den Explorer ziehen** wäre technisch leicht, bringt aber wenig, denn der Explorer zeigt die Datei schon selbst.
- Dazu kommt ein Risiko: Ob der Explorer auf demselben Laufwerk standardmäßig *verschiebt*, hängt von den erlaubten Effekten in Electrons `startDrag` ab. Das ist nicht geprüft.
- Deshalb nicht jetzt.

**R4.4 Die kleinste Alternative gibt es schon.**
- `← Herunterladen` (F5) lädt in den Ordner der linken Seite, mit allen Sicherheitsregeln. Mit Strg+L ist dieser Zielordner jetzt in einer Sekunde eingetippt.
- Es braucht weder neuen Code noch neue UI. Das Handbuch nennt diesen Weg im neuen Absatz.
- Extra für später: lokal ⚙ → „Im Explorer zeigen“ (`shell.showItemInFolder`, kleine Main-Änderung). Von dort kann man die heruntergeladene Datei weiterziehen.

### Allgemein
- **R5** Keine Bewegung und keine neuen Tokens. Im CSS stehen nur vorhandene `var(--…)`: `--space-2`, `--space-4`, `--space-6`, `--control-xs`, `--radius-sm`, `--color-*`, `--fs-sm` und `--font-ui`.
- **R6** Alle Texte laufen über `t()`. Neue Keys kommen gleichzeitig in de-DE und en-US, als volle Literale, ohne zusammengesetzte Keys.
  - Der Platzhalter heißt `{{hidden}}` und **nicht** `{{count}}`, sonst sucht i18next nach Plural-Keys.

---

## 3. Vertrag (wörtlich)

### 3.1 `src/renderer/src/file-browser.ts` (Task B)

Import ändern: `import { compareText, foldCase, formatDateTime, formatNumber } from '../../shared/format';`

Nach `nameError` einfügen:

```ts
/** Entries the pane shows: dot names only if `showHidden`; then names containing the trimmed `filter`, ignoring case. Keeps the order. */
export function visibleEntries(entries: FileEntry[], showHidden: boolean, filter: string): FileEntry[] {
  const needle = foldCase(filter.trim());
  return entries.filter(entry => (showHidden || !entry.name.startsWith('.')) && (!needle || foldCase(entry.name).includes(needle)));
}

/** Target of the "Gehe zu" field. */
export type GoTo = { path: string } | { unsupported: true };

/** Remote: `~` and `~/…` start at `home`, other relative input at `current`. Local: `/` becomes `\`, `D:` becomes `D:\`,
 *  `\x` uses the drive of `current`, `~` the home folder, other relative input starts at `current`; device paths are refused.
 *  Null for empty input. `..` is left to the server's realpath and Main's win32.resolve. */
export function resolveGoTo(side: FileSide, input: string, current: string, home: string | null): GoTo | null {
  const text = input.trim();
  if (!text) return null;
  const base = home ?? current;
  if (side === 'remote') {
    if (text === '~') return { path: base };
    if (text.startsWith('~/')) return { path: joinPath('remote', base, text.slice(2)) };
    return { path: text.startsWith('/') ? text : joinPath('remote', current, text) };
  }
  const value = text.replace(/\//g, '\\');
  if (/^\\\\[?.](\\|$)/.test(value)) return { unsupported: true };
  if (value === '~') return { path: base };
  if (value.startsWith('~\\')) return { path: joinPath('local', base, value.slice(2)) };
  if (/^[A-Za-z]:/.test(value)) return { path: value[2] === '\\' ? value : `${value.slice(0, 2)}\\${value.slice(2)}` };
  if (value.startsWith('\\\\')) return { path: value };
  if (value.startsWith('\\')) return { path: /^[A-Za-z]:/.test(current) ? `${current.slice(0, 2)}${value}` : joinPath('local', current, value.slice(1)) };
  return { path: joinPath('local', current, value) };
}
```

Tests in `file-browser.test.ts` (Task B):

`visibleEntries`:
- Bei `showHidden=false` fehlt `.bashrc`, bei `true` ist es da.
- Filter `'NOT'` findet `notes.md`.
- Filter `'  '` filtert nicht.
- Filter `'bash'` mit `showHidden=false` liefert kein `.bashrc`.
- Die Reihenfolge bleibt erhalten.

`resolveGoTo`, Server (`current='/home/demo'`, `home='/home/demo'`):

| Eingabe | Ergebnis |
|---|---|
| `'  '` | `null` |
| `'~'` | `{ path: '/home/demo' }` |
| `'~/www'` | `{ path: '/home/demo/www' }` |
| `'/etc'` | `{ path: '/etc' }` |
| `'www'` | `{ path: '/home/demo/www' }` |
| `'../x'` mit `current='/a/b'` | `{ path: '/a/b/../x' }` |
| `'~'` mit `home=null` | `{ path: current }` |

`resolveGoTo`, lokal (`current='C:\\Users\\me'`, `home='C:\\Users\\me'`):

| Eingabe | Ergebnis |
|---|---|
| `'D:'` | `D:\` |
| `'d:/Projekte/x'` | `d:\Projekte\x` |
| `'D:x'` | `D:\x` |
| `'Docs'` | `C:\Users\me\Docs` |
| `'\\Windows'` | `C:\Windows` |
| `'\\\\server\\share'` | unverändert |
| `'//server/share'` | `\\server\share` |
| `'~/Downloads'` | `C:\Users\me\Downloads` |
| `'\\\\?\\C:\\x'`, `'\\\\.\\pipe\\x'`, `'\\\\?'` | `{ unsupported: true }` |

### 3.2 Main (Task C)

`src/main/files/file-system.ts`, in `fileError` direkt nach der `EEXIST`-Zeile:
```ts
  if (code === 'ENOTDIR') return { code: 'files.notADirectory' };
```

`src/main/files/sftp-session.ts`, `list` ersetzen (`FileError` aus `./file-system` importieren, falls nötig):
```ts
  async list(ownerId: number, id: string, path: string): Promise<DirectoryListing> {
    const fs = this.remote(ownerId, id);
    const resolved = await fs.realpath(path);
    try {
      return { path: resolved, entries: await fs.list(resolved) };
    } catch (error) {
      // Servers answer a file path with "no such file" (OpenSSH) or a plain failure; only then ask what it is.
      const entry = await fs.stat(resolved).catch(() => null);
      if (entry && entry.type !== 'directory') throw new FileError('files.notADirectory');
      throw error;
    }
  }
```

`src/main/files/ipc.ts`:
```ts
import { AUTO_UPLOAD_LOCAL_PATH } from '../../shared/vault/schema';
// Typed paths reach this channel: drive or UNC only, never device paths (\\?\, \\.\).
const LocalListSchema = z.object({ path: localPath.refine(value => AUTO_UPLOAD_LOCAL_PATH.test(value)) }).strict();
```
`handle(IPC_CHANNELS.localList, LocalListSchema, …)` statt `LocalPathSchema`. Alle anderen Kanäle bleiben unverändert.

Fehlertexte (Task C), jeweils direkt nach `"notFound"`:
- `src/shared/locales/de-DE/errors/files.json`: `"notADirectory": "Das ist kein Ordner."`
- `src/shared/locales/en-US/errors/files.json`: `"notADirectory": "This is not a folder."`

Tests (Task C):
- `sftp-loopback.test.ts`: `manager.list` auf eine vorhandene Datei scheitert mit Code `files.notADirectory`. Ein fehlender Pfad scheitert weiter mit `files.notFound`.
- Neu `src/main/files/file-system.test.ts`: `fileError({ code: 'ENOTDIR' })` liefert `{ code: 'files.notADirectory' }`.

### 3.3 `src/renderer/src/hooks/useShowHidden.ts` (neu, Task D)
```ts
import { useState } from 'react';
import type { FileSide } from '../file-browser';

const KEYS = { local: 'shellherd.files.showHidden.local', remote: 'shellherd.files.showHidden.remote' } as const satisfies Record<FileSide, string>;

/** Dot names per side and profile; shown unless turned off (the behaviour before 0.23.0). */
export function useShowHidden(side: FileSide): [boolean, () => void] {
  const [show, setShow] = useState(() => { try { return localStorage.getItem(KEYS[side]) !== 'off'; } catch { return true; } });
  const toggle = (): void => {
    const next = !show;
    setShow(next);
    try { localStorage.setItem(KEYS[side], next ? 'on' : 'off'); } catch { /* convenience only */ }
  };
  return [show, toggle];
}
```

### 3.4 `FilesPanel.tsx` (Task D)
- `load` bekommt den Parameter `quiet = false` und liefert `Promise<string | null>`:
  - `null` bei Erfolg, bei einer veralteten Anfrage und wenn keine Session besteht.
  - Bei einem Fehler: `const text = errorText(error, tRef.current('files:panel.openFolderFailed'));`.
    - Mit `quiet` bleibt `listing.error` unverändert (`current[side].error`), sonst wird `text` gesetzt.
    - `loading: false` gilt in beiden Fällen.
    - Danach folgt `return text;`.
- Alle bisherigen Aufrufer bleiben bei `void load(...)`.
- `pane(side)` bekommt `onGoTo={path => load(side, path, true)}`.

### 3.5 `FilePane.tsx` (Task D)

**Prop:**
```ts
/** Lists a typed path; resolves to an error text (the folder stays) or null. */
onGoTo: (path: string) => Promise<string | null>;
```

**State:**
- `editingPath` wird zu `pathField: { value: string; error?: string } | null`.
- Neu: `filter: string | null` (`null` heißt: Feld geschlossen).
- Neu: `const [showHidden, toggleHidden] = useShowHidden(side);`
- Neu: `filterRef = useRef<HTMLInputElement>(null)` und `const pathErrorId = useId();`.

**Listen:**
```ts
const sorted = useMemo(() => sortEntries(listing.entries, sort), [listing.entries, sort, i18n.language]);
const entries = useMemo(() => visibleEntries(sorted, showHidden, filter ?? ''), [sorted, showHidden, filter]);
const allNames = useMemo(() => listing.entries.map(entry => entry.name), [listing.entries]);
const hiddenCount = listing.entries.length - entries.length;
```
`names` bleibt `entries.map(...)`.

**Effekte und `submitPrompt`:**
- Der Effekt auf `[path]` (`:77`) setzt zusätzlich `setFilter(null); setPathField(null);`.
- In `submitPrompt` wird `names.includes(name)` zu `allNames.includes(name)` (R3.4). Bei `done` kommt zusätzlich `setFilter(null)` dazu.

**Funktionen:**
```ts
const openPathField = (): void => { if (path && !disabled) setPathField({ value: path }); };
const openFilter = (): void => { if (filter === null) setFilter(''); else { filterRef.current?.focus(); filterRef.current?.select(); } };
const submitPath = async (): Promise<void> => {
  if (!pathField || !path) return;
  const value = pathField.value;
  const target = resolveGoTo(side, value, path, home);
  if (!target) { setPathField(null); listRef.current?.focus(); return; }
  if ('unsupported' in target) { setPathField({ value, error: t('files:pane.goToUnsupported') }); return; }
  const error = await onGoTo(target.path);
  if (error) setPathField({ value, error });
  else { setPathField(null); listRef.current?.focus(); }
};
```

**Tasten in `onKeyDown`**, vor dem Zweig für Strg+A:
```ts
else if (event.key.toLowerCase() === 'l' && event.ctrlKey && !event.altKey && !event.shiftKey) { handled(); openPathField(); }
else if (event.key.toLowerCase() === 'f' && event.ctrlKey && !event.altKey && !event.shiftKey) { handled(); openFilter(); }
```

**Pfadleiste:**
- Die `nav` bekommt `onDoubleClick={openPathField}`.
- Das Formular: `onSubmit` → `event.preventDefault(); void submitPath();`.
- Das Input behält `aria-label={t('files:pane.path')}` und `autoFocus`. Neu sind `aria-invalid={!!pathField.error || undefined}` und `aria-describedby={pathField.error ? pathErrorId : undefined}`.
- `onChange` setzt `{ value }` ohne Fehler.
- `Escape` → `setPathField(null); listRef.current?.focus();`. Blur → `setPathField(null)`.
- Darunter im `.file-path`-Div:
  `{pathField?.error && <p id={pathErrorId} className="field-error" role="alert">{pathField.error}</p>}`

**Filterleiste** direkt nach dem `.file-path`-Div und vor `prompt`, nur wenn `filter !== null`:
```tsx
<div className="file-path file-filter">
  <input ref={filterRef} autoFocus type="text" spellCheck={false} maxLength={256} value={filter}
    aria-label={t('files:pane.filterLabel')} placeholder={t('files:pane.filterPlaceholder')}
    onChange={event => setFilter(event.target.value)}
    onBlur={() => { if (!filter) setFilter(null); }}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); setFilter(null); listRef.current?.focus(); }
      else if (event.key === 'Enter' || event.key === 'ArrowDown') {
        event.preventDefault();
        if (!cursor && names[0]) { setSelected([names[0]]); setAnchor(names[0]); setCursor(names[0]); }
        listRef.current?.focus();
      }
    }} />
  <button type="button" aria-label={t('files:pane.filterClear')} title={t('files:pane.filterClear')}
    onClick={() => { setFilter(null); listRef.current?.focus(); }}>×</button>
</div>
```

**⚙-Menü (`toolsMenu`)**, nach `Neuer Ordner` und vor dem Auto-Upload-Block:
```ts
{ kind: 'separator' },
{ kind: 'item', label: t('files:pane.goTo'), hint: `${t('common:keys.ctrl')}+L`, onSelect: openPathField },
{ kind: 'item', label: t('files:pane.filter'), hint: `${t('common:keys.ctrl')}+F`, onSelect: openFilter },
{ kind: 'item', label: showHidden ? t('files:pane.hideHidden') : t('files:pane.showHidden'), onSelect: toggleHidden },
```

**Leerzustand (`:279`):** `{listing.entries.length ? t('files:pane.allHidden') : t('files:pane.empty')}`

**Fußzeile (`:316`):** an den bisherigen Ausdruck im ersten `<span>` anhängen:
`{hiddenCount > 0 && ` · ${t('files:pane.hiddenCount', { hidden: hiddenCount })}`}`

### 3.6 `src/renderer/src/files-ui.css` (Task D), nach der Regel `.file-path input…` (`:26`)
```css
.file-path .field-error { margin: var(--space-2) 0 0; }
.file-filter { display: flex; align-items: center; gap: var(--space-4); }
.file-filter input:not([type='checkbox']):not([type='range']):not([type='color']) { flex: 1; font-family: var(--font-ui); }
.file-filter button { min-height: var(--control-xs); height: var(--control-xs); padding: 0 var(--space-4); border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--color-text-muted); font-size: var(--fs-sm); }
.file-filter button:hover { background: var(--color-bg-hover); color: var(--color-text); }
```

### 3.7 Texte in `src/shared/locales/{de-DE,en-US}/files.json`, Block `pane` (Task D)

| Key | de-DE | en-US |
|---|---|---|
| `pathHint` (geändert) | Doppelklick oder Strg+L: Pfad eingeben | Double-click or Ctrl+L: enter a path |
| `goTo` | Gehe zu … | Go to… |
| `goToUnsupported` | Dieser Pfad wird nicht unterstützt. | This path is not supported. |
| `filter` | Filtern … | Filter… |
| `filterLabel` | Name filtern | Filter by name |
| `filterPlaceholder` | Name enthält … | Name contains… |
| `filterClear` | Filter entfernen | Clear filter |
| `showHidden` | Versteckte Dateien anzeigen | Show hidden files |
| `hideHidden` | Versteckte Dateien ausblenden | Hide hidden files |
| `hiddenCount` | {{hidden}} ausgeblendet | {{hidden}} hidden |
| `allHidden` | Alle Einträge sind ausgeblendet. | All entries are hidden. |

---

## 4. Zerlegung (exklusive Dateien, Wellen)

| Task | Dateien (exklusiv) | Inhalt | Welle | hängt ab von |
|---|---|---|---|---|
| **B** Logik | `src/renderer/src/file-browser.ts`, `file-browser.test.ts` | 3.1 | 1 | – |
| **C** Main | `src/main/files/file-system.ts`, `file-system.test.ts` (neu), `sftp-session.ts`, `sftp-loopback.test.ts`, `ipc.ts`, `src/shared/locales/{de-DE,en-US}/errors/files.json` | 3.2 | 1 | – |
| **E** Doku | `docs/handbuch.md`, `docs/manual.md`, `CHANGELOG.md`, `CHANGELOG.en.md`, `package.json` + `package-lock.json` (Version 0.23.0) | Abschnitt 5 | 1 | – |
| **D** UI | `FilePane.tsx`, `FilesPanel.tsx`, `hooks/useShowHidden.ts` (neu), `files-ui.css`, `src/shared/locales/{de-DE,en-US}/files.json` | 3.3–3.7 | 2 | B (Funktionen), C (nur für den Gesamttest) |
| **F** Demo | `.claude/skills/run-app/screens.mjs`, `.claude/skills/run-app/SKILL.md` | Abschnitt 6 | 3 | D |

- Die neuen Keys in `files.json` gehören absichtlich zu D und nicht zu Welle 1. Der Katalogtest meldet unbenutzte Keys als verwaist; so bleibt er in jeder Welle grün.
- Aus demselben Grund liefert `resolveGoTo` `{ unsupported: true }` statt eines Keys.
- Nach jeder Welle laufen `npm run typecheck` und `npx vitest run`.

---

## 5. Doku (Task E)

**Handbuch** `docs/handbuch.md`, Kapitel „Dateiansicht: Tastatur und Übertragungen“ (`:536`). Nach dem Absatz zum Typeahead einfügen:

> `Strg+L` in der Dateiliste, ein Doppelklick auf die Pfadleiste oder ⚙ → `Gehe zu …` macht aus der Pfadleiste ein Eingabefeld. `Enter` öffnet den Ordner, `Esc` bricht ab. Auf dem Server führen `~` und `~/…` in den Basisordner; ein Pfad ohne führenden `/` gilt ab dem aktuellen Ordner. Lokal gehen Laufwerkspfade (`D:\Projekte`, auch mit `/`), Netzwerkfreigaben (`\\server\freigabe`), `~` und Pfade ab dem aktuellen Ordner, Gerätepfade wie `\\?\` nicht. Fehlt der Ordner, ist es eine Datei oder fehlen Rechte, steht der Fehler unter dem Feld und der bisherige Ordner bleibt.
>
> `Strg+F` in der Liste oder ⚙ → `Filtern …` blendet ein Filterfeld ein. Es zeigt nur Einträge, deren Name den Text enthält; Groß- und Kleinschreibung spielt keine Rolle. `Enter` oder `↓` geht zurück in die Liste. `Esc`, `×` oder ein Ordnerwechsel entfernen den Filter.
>
> ⚙ → `Versteckte Dateien ausblenden` blendet Namen mit Punkt am Anfang aus (`.bashrc`, `.git`). Das gilt für die lokale und die Server-Seite getrennt und wird für alle Verbindungen gemerkt. Lokal zählt nur der Punkt, nicht das Windows-Attribut „Versteckt“. Standard ist: alles anzeigen.
>
> Ausgeblendete und weggefilterte Einträge lassen sich weder auswählen noch kopieren, verschieben oder löschen; `Strg+A` wählt nur, was zu sehen ist. Ein Ordner wird dabei immer vollständig kopiert oder gelöscht, mit den versteckten Dateien darin. Die Fußzeile zeigt, wie viele Einträge ausgeblendet sind. Aus der Dateiansicht lässt sich nichts in den Explorer ziehen. Zum Herunterladen wählst du links den Zielordner (etwa mit `Strg+L`) und drückst `F5`.

**Manual** `docs/manual.md:525`: dieselben vier Absätze auf Englisch, mit den englischen UI-Texten aus 3.7 (`Go to…`, `Filter…`, `Hide hidden files`, Fußzeile „N hidden“).

**CHANGELOG.md**, Abschnitt `## [0.23.0] – <Datum des Merges>`:
- Neu: Pfadfeld in der Dateiansicht mit `Strg+L`, auch über ⚙ → `Gehe zu …`; der Doppelklick geht wie bisher. Es versteht `~`, Pfade ab dem aktuellen Ordner und lokal `/` statt `\`. Fehler wie „Ordner nicht gefunden“ oder „Das ist kein Ordner.“ stehen am Feld, der bisherige Ordner bleibt.
- Neu: Filter nach Name mit `Strg+F` in der Dateiliste, je Seite. Er prüft „enthält“, ohne Groß- und Kleinschreibung, und endet beim Ordnerwechsel. Kopieren, Verschieben, Löschen und `Strg+A` wirken nur auf sichtbare Einträge.
- Neu: ⚙ → `Versteckte Dateien ausblenden/anzeigen`, je Seite, für Namen mit Punkt am Anfang. Standard bleibt: alles anzeigen. Die Fußzeile zählt die ausgeblendeten Einträge.
- Sicherheit: Die lokale Dateiansicht öffnet keine Gerätepfade (`\\?\`, `\\.\`) mehr.

**CHANGELOG.en.md**: dieselben Punkte auf Englisch.

---

## 6. Demo und Screenshots (Task F)

Im sftp-Block von `screens.mjs`, nach `sftp-typeahead` und vor dem Block mit der großen Datei:

1. **Pfadfeld mit Fehler**
   - Auf die Zeile `backups` klicken (Fokus in der Server-Liste), dann `Control+l`.
   - `fill('.file-pane-remote input[aria-label="Pfad"]', '/etc/nginx/fehlt')`, dann `Enter`.
   - Warten auf `.file-pane-remote .file-path .field-error`.
   - Shot **`sftp-goto.png`**.
2. **Relativ und `~`**
   - Feld leeren, `www` eingeben, `Enter`. Warten, bis `nav[aria-label="Pfad"]` `www` enthält.
   - `Control+l`, `~` eingeben, `Enter`. Warten auf die Zeile `notes.md`.
3. **Versteckte Dateien aus**
   - ⚙ der Server-Seite → `Versteckte Dateien ausblenden`.
   - Warten, bis `[data-name=".bashrc"]` fehlt und die Fußzeile `ausgeblendet` enthält.
   - Shot **`sftp-hidden.png`**.
4. **Filter**
   - Auf die Zeile `backups` klicken, `Control+f`, `ba` tippen.
   - Erwartet wird nur `backups`, weil `.bashrc` ausgeblendet ist. Die Fußzeile zeigt „4 ausgeblendet“.
   - Shot **`sftp-filter.png`**.
5. **Aufräumen (Pflicht, im `finally`)**
   - `Escape` im Filterfeld, dann ⚙ → `Versteckte Dateien anzeigen`.
   - Grund: Das Demo-Profil behält `localStorage`. Sonst entstünden spätere Läufe und das README-Bild `sftp.png` ohne Punkt-Dateien.

In `SKILL.md` die drei neuen Dateinamen in beide Listen eintragen (`:24` und `:34`). Die Selektoren `nav[aria-label="Pfad"]` und `input[aria-label="Pfad"]` bleiben unverändert und funktionieren weiter (R1.2).

---

## 7. Was ausdrücklich nicht getan wird

- Kein Ziehen in den Explorer, weder vom Server noch lokal (R4). Kein Temp-Download, kein `DownloadURL`, kein eigenes Protokoll.
- Kein Lesen des Windows-Attributs „Versteckt/System“. Kein Start von `attrib`, `cmd` oder PowerShell (R2.2).
- Kein Filter im Main und kein neues IPC-Feld für versteckte Dateien (R2.3).
- Keine Platzhalter und keine Regex im Filter. Der Filter wird nicht gemerkt (R3.2, R3.3).
- Keine Aktion auf unsichtbare Einträge. Die Prüfung auf vorhandene Namen läuft weiter gegen den ganzen Ordner (R3.4).
- Im Pfadfeld kein `~user` und keine Umgebungsvariablen wie `%USERPROFILE%`.
- Kein Strg+H. Strg+F und Strg+L gelten nur in der Dateiliste, nicht global.
- Keine Änderung an den Schemas der übrigen lokalen Kanäle (R1.4).

## 8. Minimale erste Stufe und Extras

**Stufe 1 (dieses Paket):** 1a bis 1c, 2a, 3a und 3b.
- Die Main-Änderung ist klein: `ENOTDIR` erkennen, nach einem gescheiterten `readdir` per `stat` nachfragen, das Schema von `local:list` verschärfen.
- Alles andere ist Renderer.

**Extras für später:**
- Zeigt der Pfad auf eine Datei, zu ihr springen und sie markieren.
- Verlauf und Autovervollständigung im Pfadfeld.
- Tastenkürzel für versteckte Dateien.
- Live-Abgleich des Schalters zwischen Fenstern (`storage`-Event).
- Das Windows-Attribut „Versteckt“ über eine native Abhängigkeit.
- Lokal ⚙ → „Im Explorer zeigen“.
- Ziehen in den Explorer nur mit einer Shell-Erweiterung wie bei WinSCP.

## 9. Risiken

- **Vergessene ausgeblendete Dateien:** Die Fußzeile („· N ausgeblendet“) und der Leertext („Alle Einträge sind ausgeblendet.“) machen sie sichtbar.
- **UNC im Feld:** Ein UNC-Pfad löst eine SMB-Anmeldung aus, aber nur nach `Enter` durch den Nutzer. Das ist hingenommen; A4 bleibt offen.
- **`..` in Pfaden:** `resolveGoTo` normalisiert `..` nicht selbst. Das übernehmen `realpath` auf dem Server und `win32.resolve` im Main. Löst ein Server `..` per `realpath` nicht auf, zeigt die Leiste den Pfad wörtlich an. Das ist harmlos, denn der Server löst ihn beim Zugriff selbst auf.
- **Nicht geprüft:** wie `realpath` fehlende Pfade auf anderen Servern als OpenSSH und dem Demo-Server behandelt. In jedem Fall endet es in einem Fehler am Feld.
- **Nicht geprüft:** welche Drop-Effekte Electrons `startDrag` unter Windows erlaubt (R4.3). Das ist erst relevant, wenn 4b später kommt.
