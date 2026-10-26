# Terminal-Komfort – Review (Stufe 7)

Branch `claude/feature/terminal-komfort` gegen `claude/feature/ssh-pro` (12 Commits, 58 Dateien). Grundlage: Spec `2026-10-24-terminal-komfort-design.md`, bindender Anhang `…-validation.md`, Ledger `.superpowers/sdd/2026-10-24-terminal-komfort/progress.md`.

**Urteil: ready after fixes.** 0 Critical, 2 Important, 5 Minor.

Gates: `npm run typecheck` grün, `npx vitest run` grün (143 Dateien, 2148 Tests). Zusätzlich in der laufenden run-app-Instanz geprüft (Build aus HEAD): Link-Hover, „Hier verbinden“ nach dem Teilen und „Eingabe an alle“ mit zwei web-01-Bereichen. Außerdem gab es einen Electron-Versuch mit xterm 6.0.0 und addon-web-links 0.12.0 ohne App, mit der Konfiguration der App.

## 1. Sicherheit

| Punkt | Befund |
|---|---|
| `app:open-external` | Der Handler (`src/main/index.ts`) prüft den Absender mit `requireSshSender` (BrowserWindow und mainFrame), verlangt einen entsperrten Vault (`getSnapshot`) und prüft `webLinkHref(raw)` erneut im Main. `shell.openExternal` bekommt nur die normalisierte `href`. Erlaubt sind nur `http:`/`https:`, keine Benutzer- oder Passwortteile, höchstens 2048 Zeichen. Abgelehnte Ziele enden als `AppError('core.linkNotAllowed')`. i.O. |
| Strg+Klick | WebLinksAddon und `linkHandler` (OSC 8) laufen beide über `openTerminalLink`, das `ctrlKey` und `webLinkHref` prüft. `allowNonHttpProtocols: false`. Ein Klick ohne Strg tut nichts: Im Versuch ruft xterm `activate` mit `ctrl=false` auf, und die Funktion bricht ab. i.O. Das Ziel eines OSC-8-Links ist allerdings unsichtbar, siehe **I1**. |
| Strg+Klick ohne erkannten Hover | Öffnet nie. xterm aktiviert nur `_currentLink`, und den setzt allein die Hover-Erkennung (`_handleMouseUp` verlangt, dass mousedown und mouseup auf demselben aktuellen Link liegen). Bei T1 geht deshalb auch Strg+Klick nicht. Das ist sicher, aber für T1 relevant. |
| Eingabe an alle | Mitglieder sind nur verbundene `ssh`/`powershell`/`cmd`-Tabs ohne `view`/`target`/`kube`. Pro Ansicht. Beim Ansichtswechsel oder bei weniger als 2 Mitgliedern schaltet die Eingabe aus. Beim Start erscheint eine Meldung, jedes Mitglied zeigt Chip und Warnlinie. Die Weitergabe läuft über die `enqueue`-Warteschlangen der anderen Mitglieder und nicht über deren `onData`, es gibt also keine Schleife. Workflows und Assistent nutzen `terminal-input.ts` → `sshInput` und erreichen nur einen Tab. In der App geprüft: `df -h /` erscheint in beiden Bereichen je einmal, der Chip beendet. Einschränkung siehe **M1**. |
| Kürzel | `shortcutBlocked` sperrt bei `busy`, `!visible`, Tab-Drag, `dialog[open]` (das schließt Sperrbildschirm und Einstellungen ein), `[role=dialog][aria-modal]` und Eingabefeldern außer dem xterm-Textfeld. Strg+Umschalt+F hängt am Key-Handler des Terminals, greift also nur mit Fokus im Terminal und nicht in Docks. i.O. Zur spontan aufgehenden Auswahl siehe **I2**. |
| Fenster-Bounds | Gespeichert werden sie nur in userData `settings.json` (`writeAppSettings` führt mit bestehenden Schlüsseln zusammen). Beim Lesen prüft ein zod-Schema: ganze Zahlen, Mindestgröße 900×600 wie `minWidth`/`minHeight`. Danach greift `visibleBounds`. Wurde das Fenster minimiert geschlossen, wird nichts geschrieben. i.O. |
| Schriftname in CSS | Der xterm-DOM-Renderer schreibt `fontFamily` in ein `<style>`. Das Muster `^[\p{L}\p{N} ._-]*$` gilt im Dialog und im Vault-Schema und schließt `;`, `}` und Anführungszeichen aus. i.O. |
| Secrets, kubeconfig, Exec | Nicht berührt. Der Katalog an Nebenfenster bekommt nur `effectiveTerminalSettings`. |

## 2. Befund T1: Link-Hover reagiert nicht (Diagnose)

**Ursache: Die Szene parkt die Maus. Produkt und xterm-Integration sind in Ordnung.** Zugrunde liegt eine bekannte Eigenart des xterm-Linkifiers.

Belege:
- Electron-Versuch ohne App, mit `screenReaderMode: true`, `linkHandler` und dem Addon vor `term.open`: Mit echten Mausereignissen (`sendInputEvent`) feuert `hover`, `.xterm-screen` bekommt `xterm-cursor-pointer`, und ein Klick ruft `activate` auf.
- In der laufenden App kommen `mousemove` von einer anderen Zeile auf den Link (synthetisch, danach auch echt über `/move`) an: Unterstrich (`text-decoration: underline` am Link-Span), Zeiger-Cursor und `.terminal-link-hint` erscheinen. `elementFromPoint` trifft `.xterm-screen`, nichts liegt darüber.
- `screens.mjs terminal-link` scheitert reproduzierbar (zweimal).

Mechanik: `screens.mjs:405` klickt auf `.xterm-helper-textarea`. Im Screenreader-Modus ist dieses Feld am Cursor 64 px hoch (gemessen: top 167, Zeile 3, Mitte y=199). Der Klick setzt die Maus deshalb auf **Zeile 4**, die zu dem Zeitpunkt leer ist. xterm fragt beim mousemove die Link-Provider für Zeile 4 ab und speichert die leere Antwort (`Linkifier._activeProviderReplies`, Schlüssel `_activeLine`). Danach druckt `cat ~/LIESMICH` den Link genau in Zeile 4. `move` auf (440, 192.5) bleibt in Zeile 4. Bei gleicher Zeile ruft `_handleHover` `_askForLink(e, true)` auf und nutzt den alten, leeren Cache. Der Cache wird nur bei Zeilenwechsel, Resize oder Viewport-Render mit aktivem Link geleert, nie bei einem Schreibvorgang. Auch `mouseleave` setzt `_activeLine` nicht zurück. Folge: kein Hover, kein Hinweis, und Strg+Klick öffnet nicht.

Ausgeschlossen: Provider-Registrierung (das Addon vor `open` ist korrekt, `registerLinkProvider` hängt am Service des Konstruktors), Regex/`isUrl` für `https://intranet.demo/handbuch`, Koordinaten (`getCoords`, `hasValidSize`), `xterm-hover` im composedPath, Überlagerung durch Suchleiste, Link-Hinweis (`pointer-events: none`), `.pane-chrome`, a11y-Baum (`pointer-events: none`), die Option `linkHandler` (der OSC-Provider antwortet mit `[]`, danach wird Provider 1 ausgewertet) und die Reihenfolge der Addons.

Fix:
- **Szene (nötig):** In `screens.mjs` `terminal-link` vor dem `move` auf den Link die Maus auf eine andere Zeile setzen, z. B. `call('move', undefined, '?x=<screen.left+5>&y=<screen.bottom-5>')`. Alternativ statt auf `.xterm-helper-textarea` auf `.terminal-panel:not([hidden]) .xterm-screen` mit Position unten links klicken. Test-Idee: Die Szene läuft danach grün, der Screenshot zeigt Unterstrich und Hinweis.
- **Produkt (optional, siehe M2):** Im echten Gebrauch tritt der Fall auf, wenn die Maus auf der Zeile ruht, in die der Link später geschrieben wird, und nur waagerecht bewegt wird. Eine senkrechte Bewegung löst ihn.

## 3. Befund T2: „Hier verbinden“ nach dem Teilen

**Die Szene ist schuld, nicht das Produkt. Task I hat nichts gebrochen.** `SplitTerminalArea.tsx` (Knopf `terminal:area.connectHere`) ist gegenüber der Basis unverändert: `onClick={() => onFocus(region.pane.id)}`. Der Knopf fokussiert den leeren Bereich und öffnet bewusst keine Auswahl. `splitPane` (`terminal-layout.ts:64-68`) verschiebt den aktiven Tab in den **neuen** Bereich und fokussiert ihn. Der alte Bereich bleibt leer. Ein Enter in der Seitenleiste verbindet deshalb in den fokussierten Bereich mit dem Tab. In der App geprüft: Teilen → „Hier verbinden“ → web-01 + Enter, und der neue Tab landet im leeren Bereich `root`. Die neue Prop `openRequest` bleibt bei 0 wirkungslos. Fix in `screens.mjs:457ff.` (`broadcast`): nach `menuButton('Nebeneinander teilen')` `click('.empty-pane button')`, dann Seitenleiste + Enter.

## 4. Issues

### Important

**I1 – OSC-8-Links verbergen ihr Ziel** (`src/renderer/src/components/TerminalPanel.tsx:105`, `:350`, `src/shared/locales/de-DE/terminal.json:271`)
Szenario: Ein Programm oder eine per `cat`/`less` angezeigte Datei (Log, README, kompromittierter Server) gibt `ESC]8;;https://evil.example/ESC\https://intranet.firma/loginESC]8;;ESC\` aus. Der Nutzer sieht `https://intranet.firma/login`, der Hinweis sagt nur „Strg+Klick öffnet den Link im Browser“. Strg+Klick öffnet `evil.example` (Phishing). WebLinksAddon-Links sind davon nicht betroffen, denn bei ihnen sind Text und Ziel gleich.
Fix: `hover` bekommt `(event, uri)`. Der State wird `linkTarget: string | null` = `new URL(webLinkHref(uri)).host`. Neuer Key `terminal:links.hintTarget` mit Platzhalter, de „Strg+Klick öffnet {{host}} im Browser“ und en „Ctrl+click opens {{host}} in your browser“, für beide Hover-Wege. `links.hint` entfällt oder bleibt als Fallback. Test: Unit-Test einer kleinen Funktion `linkHintHost(uri)` (http/https → Host, sonst null). Zusätzlich die run-app-Szene mit einem OSC-8-Link mit abweichendem Text im Fake-sshd.

**I2 – Die Verbindungsauswahl öffnet sich nach Maximieren/Wiederherstellen oder einem Ansichtswechsel von selbst** (`src/renderer/src/components/ConnectionPicker.tsx:61-63`, `src/renderer/src/components/SplitTerminalArea.tsx:241`, `:424`)
Szenario: Strg+Umschalt+T in Bereich A (`pickerRequest = {A, 1}`), Auswahl schließen. Dann Bereich B maximieren und wiederherstellen, oder die Ansicht wechseln und zurückkehren. Das Pane-Chrome von A wird neu gemountet, `ConnectionPicker` mountet mit `openRequest=1`, und der Effekt `[openRequest]` läuft beim Mount, also öffnet `toggle()` die Auswahl. Das Popover fokussiert das Suchfeld. Tippt der Nutzer weiter (`ls` + Enter), verbindet Enter die erste passende Verbindung.
Fix: Nur auf Änderungen reagieren, z. B. `const handled = useRef(openRequest ?? 0)`, und im Effekt nur öffnen, wenn `openRequest !== handled.current`, danach `handled.current = openRequest`. Test: `ConnectionPicker` mit `openRequest=3` rendern → Popover zu. Rerender mit 4 → offen. Unmount und Mount mit 4 → zu.

### Minor

**M1 – Eingabe an alle leitet auch automatische Terminal-Antworten weiter** (`src/renderer/src/components/TerminalPanel.tsx:217`)
Szenario: In Mitglied A läuft vim, fish oder ein Programm mit Mausmodus. xterm beantwortet dessen Abfragen (DSR `ESC[6n` → `ESC[24;1R`, DA, Fokusmeldungen `ESC[I`/`ESC[O`, Mausberichte) über `onData`. Diese Bytes gehen auch an B und C und landen dort als Müll in der Eingabezeile.
Fix: Nur weiterleiten, was nicht wie eine Terminal-Antwort aussieht, z. B. Daten verwerfen, die vollständig auf `/^\x1b\[(?:[?>]?[\d;]*[Rcn]|[IO]|M[\s\S]{3}|<[\d;]+[Mm])$/` passen. Test: reine Funktion `broadcastable(data)` mit Fällen für Eingaben und Antworten.

**M2 – Link-Hover bleibt auf einer Zeile aus, die vor der Ausgabe schon überfahren wurde** (xterm 6.0.0 `Linkifier`, Integration `TerminalPanel.tsx:116`)
Szenario wie T1, im echten Gebrauch: Die Maus ruht auf der Zeile, in die die Ausgabe einen Link schreibt. Waagerechtes Bewegen zeigt keinen Link, Strg+Klick öffnet nicht. Senkrechtes Bewegen hilft.
Fix: als Upstream-Grenze akzeptieren und im Handbuch einen Halbsatz ergänzen, oder einen Workaround nur über öffentliche API bauen. Ein Upstream-Issue melden, dass der Linkifier-Zeilencache bei Writes nicht verworfen wird. Kein Eingriff in private Felder.

**M3 – Bereichsfehler zeigt unformatierte Grenzen** (`src/renderer/src/components/SettingsDialog.tsx:69`)
Szenario: Beim Verlauf steht „5.000“ im Feld. Bei ungültiger Eingabe kommt „Gib eine ganze Zahl von 1000 bis 50000 ein.“, ohne Tausendertrennung und damit gegen die Format-Regel in `CLAUDE.md`.
Fix: `min: format(limits[0]), max: format(limits[1])` mit der `format`-Prop von `NumberSetting`.
Zu `parseGroupedNumber` für alle Felder: Mit realistischen Eingaben wird nichts falsch gelesen. Gruppen verlangen genau drei Ziffern, Dezimalfälle („1.5“, „5.00“, „1,25“) sind ungültig, die Timeouts (5–300, 1–10) sind kleiner als jede gültige Gruppierung. Die Auto-Sperre und `idleMinutes` (0–1440) lesen „1.000“ und „1,000“ unabhängig von der Lokale als 1000. Das ist für Ganzzahlfelder vertretbar.

**M4 – Hart codierte Breite** (`src/renderer/src/terminal-comfort-ui.css:3`)
`flex: 0 1 240px` steht so in der Spec, widerspricht aber der Token-Regel in `CLAUDE.md`. Für `settings-ui.css` wurde dasselbe Literal bewusst ersetzt.
Fix: vorhandenes Breiten-Token nutzen oder `flex: 0 1 auto` mit `width: min(100%, …token…)`. Ein neuer Wert kommt zuerst als Token mit Rolle in `tokens.css`.

**M5 – Changelog-Grammatik** (`CHANGELOG.md:14`)
„Sichtbar werden entfernt die Markierung.“ → „Sobald der Tab sichtbar wird, verschwindet die Markierung.“ (so steht es im Handbuch).

## 5. Zusammenspiel und Spec-Abdeckung

- **Live-Update:** Das Hauptfenster setzt `terminalPrefs` aus `vault.settings`. Beim Sperren bleiben die Einstellungen erhalten (`redactVault` behält `settings`, `set` ist bei Gleichheit ein No-op), der Verlauf wird also nicht gekürzt. Nebenfenster nutzen den Katalog (`catalog().terminal`, `broadcastCatalog` bei `onVaultChange`). Ihr Effekt steht vor der Ready-Meldung. Panels übernehmen Änderungen über `subscribe` und rufen danach `fit()` auf. i.O.
- **R3:** Copy-on-select überspringt Auswahlen, die dem Suchbegriff gleichen (ohne Groß/Klein). Beim Schließen wird die Auswahl gelöscht. i.O.
- **Aktivität:** Markiert wird nur bei `!embedded && !visible`. Sichtbar werden und Unmount löschen. In der App bestätigt (Ledger). i.O.
- **CSS-Import:** `TerminalPanel.tsx:9` importiert `terminal-comfort-ui.css`. Die Klassen aus TerminalTabs und SplitTerminalArea liegen im selben Bundle. i.O.
- **i18n:** Alle neuen Texte laufen über `t()`. Die Keys gibt es in de/en (Katalogtest grün), Fehler gehen als `AppError`-Code. **Tokens:** Abgesehen von M4 nur `var(--…)`, keine Bewegung. i.O.
- **Rulings:** R1 (Strg+Umschalt-Varianten) und Strg+Tab mit Wiederholung entsprechen dem Ledger. V1–V5 umgesetzt (Version 0.20.0, README-Zeile).

## 6. Doku

Handbuch, Manual (gleicher Umfang, +43 Zeilen), Changelog (de/en) und README stimmen mit dem Code überein: Kürzel, Sperren in Dialogen und Textfeldern, keine Wiederholung bei T/W, Grenzen 8–32 und 1.000–50.000, Schriftregeln, Speicherort `settings.json`, Mitglieder und Endbedingungen von „An alle“, keine Suche in Docks. Ausnahme ist M5. Nach I1 muss der Satz zum Link-Hinweis das angezeigte Ziel nennen.

## 7. Für den Orchestrator

- Nach I1 und I2 und den Szenenkorrekturen (T1, T2) `screens.mjs terminal-link broadcast` erneut laufen lassen.
- Laufende run-app-Instanz: Durch die Prüfung sind dort zwei geteilte Bereiche mit web-01 offen, „An alle“ ist aus. `out/` wurde aus HEAD neu gebaut.
