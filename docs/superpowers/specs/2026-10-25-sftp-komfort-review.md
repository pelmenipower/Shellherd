# SFTP-Komfort – Review (Stufe 7)

Branch `claude/feature/sftp-komfort` gegen `claude/feature/start-ui` (5 Commits, `.claude/skills/run-app/` ausgenommen).
Grundlage: Spec `2026-10-25-sftp-komfort-design.md`, bindender Anhang `…-validation.md` (R-A, R-B), Ledger.

**Urteil: ready after fixes** – 0 Critical, 2 Important, 5 Minor.

Gates: `npm run typecheck` grün, `npx vitest run` grün (2392/2392).

---

## 1. Sicherheit

### R-B (Filter und Ausblenden wirken nur auf Sichtbares)

Geprüft, Ergebnis vollständig bis auf I-2:

- `entries`/`names` sind schon gefiltert (`FilePane.tsx:80,84`). Die Bereinigung (`:90-93`) räumt `selected`/`cursor` nach jedem Filter- oder Schalterwechsel ab.
- `targets()` (`:98-101`) filtert zusätzlich gegen `names`. Darüber laufen F5, F6, Entf, F2, F9, Kontextmenü (`:227`), Fußzeilenknöpfe (`:369-372`).
- Strg+A (`:168`), Pfeile, Pos1/Ende, Enter, F4 und Type-to-jump (`:172`) arbeiten auf `names`/`entries`.
- Drag aus der Liste: Startzeilen sind nur sichtbare Zeilen. `selected` wird vorher bereinigt (siehe M-1, nur defensiv).
- Drop auf eine Ordnerzeile: nur sichtbare Ordner haben eine Zeile.
- Drag aus dem Explorer und Übertragungen auf ein verstecktes Ziel (`.env` ausgeblendet): Die Konfliktfrage kommt aus dem Main (`FilesPanel.tsx:166`) und hängt nicht am Filter. Das ist richtig.
- Anlegen und Umbenennen prüfen gegen `allNames` (`FilePane.tsx:82,135`). Lokal geschieht das aber case-sensitiv (I-2).
- Umbenennen in einen versteckten Namen (`foo` → `.foo` bei „aus“): Die Auswahl auf `.foo` wird nach dem Refresh bereinigt, `targets()` ist leer. Es gibt keine Aktion auf den unsichtbaren Eintrag.
- Auto-Upload: Bindet nur den angezeigten Ordner oder einen sichtbaren Unterordner (`:348,361`). Darin läuft alles mit, wie es R3.4 für „Ordner vollständig“ festlegt.

### Pfad-Eingabe

- Server-Pfade: Der Renderer macht jede Eingabe absolut. `remotePath` verlangt `/`. Ein `..` löst `realpath` auf. Die Rechte entscheidet der Server, einen Ausbruch über die eigene Sitzung hinaus gibt es nicht.
- `sftp-session.ts:188-199`: Nach einem gescheiterten `readdir` folgt `stat` (folgt Links). Ein Link auf einen Ordner ohne Rechte meldet weiter den Originalfehler. Das ist richtig.
- Lokal: UNC bleibt erlaubt, getippt und mit Enter bestätigt (R1.4). Main-Prüfung siehe I-1.

---

## Issues

### Critical

Keine.

### Important

**I-1 Main lässt Gerätepfade mit Schrägstrich durch** – `src/main/files/ipc.ts:40`, Ursache `src/shared/vault/schema.ts:50`
- Szenario: `AUTO_UPLOAD_LOCAL_PATH = /^(?:[A-Za-z]:\\|\\\\(?![?.]\\))/` prüft nach `\\?` bzw. `\\.` nur einen Backslash.
  - `localList({ path: '\\\\?/C:/x' })` besteht `win32.isAbsolute` und die Regex. `win32.resolve` macht daraus `\\?\C:\x`.
  - Ebenso `'\\\\./pipe/x'` → `\\.\pipe\x`. Damit lassen sich z. B. die Named Pipes auflisten.
  - Nachgeprüft mit Node 24: beide Eingaben `isAbsolute=true`, `regex=true`, Ergebnis ein Gerätepfad.
- Der Renderer blockt das (`resolveGoTo` tauscht `/` vorher gegen `\`). Main ist aber die Vertrauensgrenze, und Kommentar und Changelog („öffnet keine Gerätepfade mehr“) versprechen es dort.
- Dieselbe Lücke hat die Auto-Upload-Bindung (`schema.ts:55`), deren Watcher denselben Pfad nutzt.
- Der Ledger-Fall `\\?` ohne folgenden Zeichen ist dagegen harmlos: `win32.resolve('\\\\?')` = `C:\?`, `'\\\\.'` = `C:\`.
- Fix-Richtung:
  - Die Regex auf beide Trenner und das Ende erweitern: `/^(?:[A-Za-z]:\\|\\\\(?![?.](?:[\\/]|$)))/`.
  - Zusätzlich in `localList` den Wert **nach** `win32.resolve` prüfen (`resolved` muss die Regex erfüllen). Die Normalisierung kann dann nichts mehr umgehen.
  - Tests in `ipc`/Schema-Tests für `\\?/C:/x`, `\\./pipe/x`, `\\?`.

**I-2 Namensprüfung lokal case-sensitiv: verstecktes `.env` wird beim Umbenennen still ersetzt** – `src/renderer/src/components/FilePane.tsx:135`
- Szenario: Lokal, „Versteckte Dateien ausblenden“, im Ordner liegt `.env`. Der Nutzer benennt `neu.txt` in `.ENV` um.
  - `allNames.includes('.ENV')` ist false. `localRename` → `fs.rename` (`file-system.ts:130`) ersetzt unter Windows das Ziel ohne Rückfrage: NTFS ist case-insensitiv, und Node nutzt `MOVEFILE_REPLACE_EXISTING`.
  - Der Inhalt von `.env` ist weg, nicht im Papierkorb.
- Genau diesen Fall soll R3.4 ausschließen. Für sichtbare Dateien bestand die Lücke schon vorher, durch das Ausblenden sieht der Nutzer das Opfer jetzt aber nicht mehr.
- Fix-Richtung:
  - Auf der lokalen Seite vergleichen ohne Groß- und Kleinschreibung: `side === 'local' ? allNames.some(n => foldCase(n) === foldCase(name)) : allNames.includes(name)`.
  - Ein reiner Case-Wechsel derselben Datei (`a.txt` → `A.txt`) muss erlaubt bleiben: den Vergleich gegen `prompt.original` ausnehmen.
  - Test für `.env`/`.ENV` lokal und den Case-Wechsel.

### Minor

**M-1 Drag nimmt `selected` ungefiltert** – `FilePane.tsx:211`
- Szenario: Theoretisch landet ein Name aus der alten Auswahl im Payload, bevor der Bereinigungs-Effekt (`:90-93`) gelaufen ist. React spült passive Effekte zwar vor dem nächsten diskreten Ereignis, praktisch ist das also nicht erreichbar. Es ist aber der einzige Aktionspfad ohne den `names`-Filter.
- Fix-Richtung: `const list = selected.includes(name) ? selected.filter(n => names.includes(n)) : [name];`.

**M-2 Neue Punkt-Datei verschwindet bei „ausblenden“** – `FilePane.tsx:139` (Ledger)
- Szenario: Bei „aus“ legt Shift+F4 `.htaccess` an. Die Datei öffnet sich im Editor, fehlt aber in der Liste. Nur „· 1 ausgeblendet“ verrät sie.
- Fix-Richtung: Bei `done` und einem Namen mit `.` am Anfang und `!showHidden` die Fußzeile bzw. einen Hinweis nennen. Alternativ für später als Extra dokumentieren. Keine Sicherheitsfrage.

**M-3 `\x` auf einer Netzwerkfreigabe** – `src/renderer/src/file-browser.ts:106`
- Szenario: Der aktuelle Ordner ist `\\server\share\a`, die Eingabe `\x`. Ergebnis ist `\\server\share\a\x` statt der Freigabe-Wurzel `\\server\share\x`.
- Das entspricht dem Spec-Wortlaut 3.1, widerspricht aber R1.3 („bezieht sich auf das Laufwerk des aktuellen Ordners“).
- Fix-Richtung: Für UNC-`current` die ersten zwei Segmente als Wurzel nehmen. Test ergänzen.

**M-4 Pfadfeld: veraltete Antwort gilt als Erfolg, Blur während des Wartens** – `FilesPanel.tsx:114` / `FilePane.tsx:125-127`
- Szenario 1: Ein neuerer `load` überholt den Gehe-zu-Aufruf. `load` liefert dann `null`, das Feld schließt wie bei Erfolg, gezeigt wird aber der andere Ordner.
- Szenario 2: Der Nutzer klickt während des Wartens weg. Ein später Fehler öffnet das Feld per `setPathField({ value, error })` wieder, mit `autoFocus`.
- Fix-Richtung: Für „überholt“ einen eigenen Rückgabewert vorsehen. In `submitPath` nach dem `await` prüfen, ob das Feld noch offen ist (Ref).

**M-5 Keine Komponententests für R-B**
- Szenario: `allNames` (`FilePane.tsx:135`) und die Wirkung von Filter und Schalter auf `targets()`/Strg+A/Drag sind nur über die reine Funktion `visibleEntries` und die run-app-Szene abgedeckt. Eine spätere Umstellung von `allNames` auf `names` bliebe grün.
- Fix-Richtung: Die Namensprüfung als reine Funktion (`nameTaken(side, allNames, name, original)`) nach `file-browser.ts` ziehen und testen. Das deckt I-2 gleich mit ab.

---

## 2. Korrektheit (geprüft, ohne Befund außer oben)

- `resolveGoTo`: wörtlich nach Vertrag 3.1, Tests decken die Tabelle der Spec ab.
  - Server: `~` (mit `home=null` → aktueller Ordner), `~/x`, relativ, `../x` (über `realpath`), `//etc` (der Server normalisiert).
  - Lokal: `D:`, `D:x`, `d:/x`, `\\server\share`, `//server/share`, `~`, `~/x`, Gerätepfade abgelehnt.
- Fehler am Feld: Bei `quiet` behält das Listing seinen Banner (`FilesPanel.tsx:122`). Das Feld bekommt `role="alert"`, `aria-invalid` und `aria-describedby`.
- Fokus:
  - Strg+L/Strg+F nur in der Liste, mit `preventDefault` und `stopPropagation`, und nur ohne Alt/Umschalt (AltGr = Strg+Alt, also kein Konflikt).
  - Esc im Feld führt zurück in die Liste, Enter bei Erfolg ebenso.
  - Im Filter setzen Enter/↓ Cursor und Auswahl auf den ersten Eintrag, wenn kein Cursor da ist.
  - Ein Aufruf über das ⚙-Menü funktioniert, weil `ContextMenu` keinen Fokus zurückgibt und `autoFocus` greift.
- Kollisionen:
  - Type-to-jump schließt Strg aus (`file-typeahead.ts:8`).
  - Die Terminal-Suche Strg+Umschalt+F hängt nur am xterm (`TerminalPanel.tsx:120`).
  - Globale Capture-Kürzel sind nur Strg+Umschalt+Leertaste/Tab/W/T/K sowie Strg+Komma/Tab, also kein L und kein F.
- Der Filter endet bei Ordnerwechsel (`FilePane.tsx:89`) und nach erfolgreichem Anlegen oder Umbenennen (`:139`).
- `localStorage` in `useShowHidden.ts:8,12` steht in try/catch. Fehlt der Wert, gilt „anzeigen“.

## 3. Doku

- Handbuch und Manual (`handbuch.md:540-546`, `manual.md:529-535`) sind wörtlich wie Spec 5 und stimmen mit dem Code überein, einschließlich „Ordner vollständig“ und dem lokalen Punkt statt dem Windows-Attribut.
- R-A ist ehrlich beschrieben: „Aus der Dateiansicht lässt sich nichts in den Explorer ziehen“, mit der Alternative Strg+L und F5.
- Changelog de/en 0.23.0 und der README-Satz passen. Die Zeile „öffnet keine Gerätepfade mehr“ stimmt erst nach I-1 auch für den Main.
- Versionen: `package.json` und `package-lock.json` stehen auf 0.23.0.

## 4. i18n und Tokens

- Neue Keys gibt es in de-DE und en-US, mit dem Platzhalter `{{hidden}}` (kein `count`) und ohne dynamische Keys. Der Main liefert nur den Code `files.notADirectory`.
- CSS (`files-ui.css:27-31`) nutzt nur `var(--…)`. Es gibt keine Bewegung und keine neuen Tokens (R5).
- `×` als Knopfzeichen folgt dem vorhandenen Muster (↑ ⌂ ⟳ ⚙). Die Beschriftung kommt per `aria-label`/`title` über `t()`.
