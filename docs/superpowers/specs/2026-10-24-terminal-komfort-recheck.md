# Terminal-Komfort – Nachprüfung (Runde 2)

Grundlage: Review `2026-10-24-terminal-komfort-review.md`, Ledger `.superpowers/sdd/2026-10-24-terminal-komfort/progress.md` (Ruling: M2 als Upstream-Grenze akzeptiert, Halbsatz in der Doku). Fix-Diff: `git diff 4bc90f5..00b4dd0` (efbc2d5, fdf3b7b, f690857, 00b4dd0), 21 Dateien.

**Urteil: ready to merge.** Alle 9 Befunde erledigt (8 ADDRESSED, 1 ACCEPTED). Im Fix-Diff gibt es 0 neue Critical, 0 Important und 2 Minor.

Gates: `npm run typecheck` grün, `npx vitest run` grün (144 Dateien, 2157 Tests). Die run-app-Szenen (`terminal-link`, `terminal-link-osc8`, `broadcast`) habe ich nicht ausgeführt, die prüft der Orchestrator.

## 1. Befunde

| Befund | Status | Beleg |
|---|---|---|
| I1 – OSC-8-Link verbirgt sein Ziel | ADDRESSED | `src/renderer/src/terminal-links.ts:7-10` `linkHintHost` = `new URL(webLinkHref(uri)).host` oder null. Beide Hover-Wege nutzen ihn: `TerminalPanel.tsx:106` (OSC 8, `linkHandler.hover(_event, uri)`) und `TerminalPanel.tsx:117` (WebLinksAddon). Anzeige `TerminalPanel.tsx:351` mit `terminal:links.hintTarget` (de/en `terminal.json:271`). Der alte Key `links.hint` ist in beiden Lokalen entfernt, der Katalogtest ist grün. Tests: `terminal-links.test.ts` (Host, Port, `javascript:`, Benutzerdaten → null). Szene `terminal-link-osc8` plus Fake `sshd.mjs` `cat ~/LINKS` mit abweichendem Text und Ziel. |
| I2 – Auswahl öffnet beim Remount | ADDRESSED | `ConnectionPicker.tsx:30` `handled = useRef(openRequest ?? 0)`. `:64-68` öffnet nur bei `shouldOpen(handled.current, openRequest)`. `src/renderer/src/open-request.ts:2-4` und Test `open-request.test.ts` (Mount mit gleichem Wert → zu, Änderung → offen, 0/undefined → zu). Zur Testlücke siehe N2. |
| M1 – Terminal-Antworten bei „An alle“ | ADDRESSED | `terminal-broadcast.ts:10-12` `broadcastable`, verwendet in `TerminalPanel.tsx:218`. Die eigene Sitzung bekommt weiterhin alles (`enqueue` davor). Test `terminal-broadcast.test.ts` (DSR, DA, Fokus, SGR-Maus). Zur Nebenwirkung siehe N1. |
| M2 – Linkifier-Zeilencache (xterm) | ACCEPTED | Ruling im Ledger (Upstream-Grenze, kein Eingriff in private Felder). Doku-Halbsatz in `docs/handbuch.md:81` („Erscheint ein Link unter der ruhenden Maus, bewege die Maus kurz auf eine andere Zeile.“) und `docs/manual.md:82`. Die Lage ist auch im run-app-Skill beschrieben (`SKILL.md`, „Link-Hinweis“). |
| M3 – Grenzen unformatiert | ADDRESSED | `SettingsDialog.tsx:69` `min: format(limits[0]), max: format(limits[1])`. |
| M4 – 240px-Literal | ADDRESSED | Token mit Rolle `tokens.css:58-59` `--width-search`, verwendet in `terminal-comfort-ui.css:3`. Der Design-Test ist grün. |
| M5 – Changelog-Satz | ADDRESSED | `CHANGELOG.md:14` „Sobald der Tab sichtbar wird, verschwindet die Markierung.“, en analog in `CHANGELOG.en.md:14`. |
| T1 – Szene parkt die Maus | ADDRESSED | `screens.mjs` Helfer `hoverLink`: erst `move` unten links in `.xterm-screen`, dann auf den Link. Er wird in `terminal-link` und `terminal-link-osc8` verwendet. Der Lauf in der App liegt beim Orchestrator. |
| T2 – „Hier verbinden“ in der Szene | ADDRESSED | `screens.mjs` `broadcast`: nach dem Teilen kommen `waitFor('.empty-pane button')` und `click`, danach Seitenleiste + Enter. Im Skill unter „Bereich teilen“ dokumentiert. |

## 2. Gezielte Prüfungen

**I1, Host des Ziels:**
- Für WebLinksAddon-Links ist `uri` der erkannte Text, also Text = Ziel = Host. Für OSC-8-Links ist `uri` das Ziel aus der Sequenz, nicht der sichtbare Text. Der Hinweis nennt also den Host, den Strg+Klick öffnet. `openTerminalLink` und der Main-Handler verwenden dasselbe `webLinkHref`, Hinweis und Ziel können nicht auseinanderlaufen.
- Überlappen sich die Provider (OSC-8-Text, der selbst eine URL ist, wie in `cat ~/LINKS`): Der OSC-Provider wird im Konstruktor registriert und kommt damit vor dem Addon. xterm bevorzugt den Provider mit dem kleineren Index, der Hinweis zeigt also das OSC-Ziel. Belegt wird das durch das `waitFor` auf `status.intranet.demo` in der Szene `terminal-link-osc8`.
- Hosts mit Umlauten erscheinen als Punycode (`URL.host`). Das ist gegen Homograph-Täuschung eher günstig. React escapt den Text.

**I1, kann `linkHintHost` werfen?** Nein.
- `webLinkHref` (`src/shared/links.ts:3-10`) fängt Fehler von `new URL(raw)` ab und gibt bei ungültigen Werten null zurück.
- Sonst gibt die Funktion `url.href` einer schon geparsten http(s)-URL zurück. Das erneute `new URL(href)` gelingt deshalb immer.
- http(s)-URLs haben nach WHATWG immer einen nicht leeren Host (`http:///x` wird zu Host `x`). Der Hinweis ist also nie leer.

**I1, OSC 8 mit `javascript:`-Ziel:** `linkHintHost` liefert null, also erscheint kein Hinweis. `openTerminalLink` bricht ab (`!webLinkHref`), und mit `allowNonHttpProtocols: false` öffnet auch xterm selbst nichts. Unterstreichung und Zeiger-Cursor von xterm können beim Überfahren trotzdem erscheinen. Der Nutzer sieht dann einen unterstrichenen Text ohne Hinweis, und Strg+Klick bewirkt nichts. Das ist sicher und passt zum Handbuch („alles andere bleibt Text“).

**M1, verschluckt `broadcastable` echte Eingaben?** Die Regex ist vollständig verankert (`^…$`) und wirkt nur, wenn ein `onData`-Block genau einer Antwortform entspricht.
- Pfeiltasten (`ESC[A`), Pos1/Ende, Bild↑/↓ und F5–F12 (`ESC[15~` usw.) passen nicht.
- F1–F4 ohne Modifikator kommen als `ESC O P…S` und passen ebenfalls nicht.
- Alt-Kombinationen (`ESC` + Zeichen) passen nicht, auch Alt+[ nicht (`ESC[` ohne Endzeichen).
- Eingefügter Text mit Bracketed Paste ist in `ESC[200~…ESC[201~` eingepackt und passt nicht. Ohne Bracketed Paste würde nur ein Einfügetext verworfen, der *exakt* eine Antwortform ist, etwa genau `ESC[c`. Das ist vernachlässigbar.
- Ausnahme: **Umschalt-, Strg- und Alt+F3** erzeugen in xterm 6 `ESC[1;<m>R` (`node_modules/@xterm/xterm/lib/xterm.mjs`, `case 114: … "[1;"+(n+1)+"R"`). Das ist dieselbe Form wie ein Cursor-Positionsbericht, siehe N1.

**I2, bricht `next > 0` die normale Strg+Umschalt+T-Folge?** Nein.
- `pickerRequest.count` in `SplitTerminalArea.tsx:241` zählt über alle Bereiche hoch. Der nicht adressierte Bereich bekommt 0 (`:424`).
- Folge A=1 → `shouldOpen(0,1)`, offen. Danach B=2, A sieht 0 und `handled` bleibt 1. Dann wieder A=3 → `shouldOpen(1,3)`, offen.
- Zweimal derselbe Bereich (1 → 2) öffnet auch beim zweiten Mal. Ist die Auswahl schon offen, wird die Anfrage verbraucht, ohne zu schließen. Das ist dasselbe Verhalten wie vorher.
- Beim Remount mit unverändertem Wert bleibt die Auswahl zu, damit ist I2 behoben.
- Eine Anfrage bei `disabled` wird verbraucht und später nicht nachgeholt. Das ist gewollt.

**Doku gegen Code:** Handbuch und Manual zitieren den Hinweis wörtlich wie die Keys: „Strg+Klick öffnet <Host> im Browser“ / „Ctrl+click opens <host> in your browser“ (`{{host}}`). Die Regel für erlaubte Ziele stimmt mit `webLinkHref` überein. Der M2-Halbsatz beschreibt die Abhilfe richtig: eine senkrechte Bewegung leert den Zeilencache. Der Changelog erwähnt den Link-Hinweis nicht eigens, deshalb ist dort keine Änderung nötig.

## 3. Neue Befunde (nur Fix-Diff)

### Minor

**N1 – „An alle“ verschluckt Umschalt-, Strg- und Alt+F3** (`src/renderer/src/terminal-broadcast.ts:11`)
Szenario: „An alle“ ist aktiv, der Nutzer drückt in mc, htop oder vim Umschalt+F3. xterm sendet `ESC[1;2R`. Das passt auf `[\d;]*R` (Cursor-Positionsbericht). Das eigene Terminal bekommt die Taste, die anderen Mitglieder nicht. Die Bereiche laufen dann still auseinander. Unmodifiziertes F3 (`ESC OR`) ist nicht betroffen.
Fix-Richtung: Die Mehrdeutigkeit lässt sich im Datenstrom nicht auflösen. Eine Möglichkeit: Im `attachCustomKeyEventHandler` die letzte Tastenquelle merken (keydown F1–F4 mit Modifikator) und `broadcastable` dann umgehen. Oder als bekannte Grenze akzeptieren und im Handbuch bei „Eingabe an alle“ nennen. Test: `broadcastable('\x1b[1;2R')` dokumentiert das gewählte Verhalten.

**N2 – I2-Verdrahtung ohne Komponententest** (`src/renderer/src/components/ConnectionPicker.tsx:64-68`)
Getestet ist nur die reine Funktion `shouldOpen`. Ob `handled` beim Mount mit dem aktuellen Wert startet und im Effekt nachgezogen wird, prüft kein Test. Das war der Kern von I2. Ein späteres Refactoring, zum Beispiel `useRef(0)`, würde den Fehler unbemerkt zurückbringen.
Fix-Richtung: Ein Komponententest wie im Review vorgeschlagen: Rendern mit `openRequest=3` → zu, Rerender mit 4 → offen, Unmount und Mount mit 4 → zu. Alternativ ein Kommentar-Verweis auf den Test von `shouldOpen` und das Risiko akzeptieren.

## 4. Für den Orchestrator

- Die Szenen `terminal-link`, `terminal-link-osc8` und `broadcast` gegen einen frischen Build aus HEAD laufen lassen. Im OSC-8-Bild muss der Hinweis `status.intranet.demo` zeigen, nicht `intranet.demo`.
- N1 und N2 blockieren den Merge nicht. Zu N1 entweder eine Zeile ins Handbuch oder ein Ruling.
