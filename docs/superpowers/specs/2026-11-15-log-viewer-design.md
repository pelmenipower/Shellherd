# Log-Viewer: Automatisch scrollen und Suche in Logs – Design

Stand: 2026-11-15 · Branch `claude/feature/log-viewer` (von `staging` 4b5d3a1, eigener PR gegen `staging`)
Grundlage: Konzept `.superpowers/sdd/2026-11-15-log-viewer-research.md` (im Folgenden „K“). Diese Spec übernimmt K §4 als verbindlichen Entwurf und legt nur Umfang, Abweichungen und Pflichtpunkte fest. Abschnittsverweise „K §x“ zählen als Teil dieser Spec.

## Ziel

Nutzerwunsch: In Kubernetes- und Docker-Logs soll Autoscroll per Häkchen abschaltbar sein, und die Logs sollen eine Suche mit Hervorhebung aller Treffer, Zähler „1 von 100“, Strg+F bzw. Suchleiste, Wörtern und Regex bekommen.

Flächen: Container-Logs (`ContainerDock` → `TerminalPanel` embedded), Pod-Logs/Vorherige (`DetailDock` → `TerminalPanel` embedded), „Logs aller Pods“ (`WorkloadLogs`).

## Bereits erledigt (Vorab-Fix, Commit f1dbd0e)

Dock-Terminal als Flex-Column; `.kube-dock-terminal .terminal-container { flex: 1; min-height: 0; overflow: hidden }`. Vorher blieb xterm bei 24 Zeilen (abgeschnitten im kleinen Dock, leerer Platz nach dem Hochziehen). Die Szene `containers` prüft das. Task C aus K §6 fasst diese Regeln **nicht** erneut an.

## Umfang Stufe 1 (verbindlich)

- **R-LV-1 Häkchen „Automatisch scrollen“** nach K §4.1: in beiden Dock-Leisten im Reiter Logs, je Dock und Log-Ziel (`followOff`-Muster), nicht persistent, Standard an. Semantik K §4.1 „Semantik“: Hochscrollen schaltet aus, Herunterscrollen nicht ein, Treffer-Sprung schaltet aus, neues Ziel startet an, Einschalten springt ans Ende. Gilt für alle drei Flächen; in „Logs aller Pods“ ersetzt es den Knopf „Folgen“, neue Zeilen stehen in der Statuszeile.
- **R-LV-2 Follow-Controller** `src/renderer/src/terminal-follow.ts` nach Vertrag K §4.1 (reines Modul, getestet). Bei „aus“ hält er die Position aktiv per Marker, auch wenn der Viewport unten stand.
- **R-LV-3 Gemeinsame Suchleiste** `TerminalSearchBar` nach Vertrag K §4.2 (Optionen `Aa`/`.*`/`ab`, Status idle/count/many/none/invalid, Enter/Umschalt+Enter/F3/Umschalt+F3/Esc, Zähler über `formatNumber`). Name und Klasse `.terminal-search` bleiben.
- **R-LV-4 Suchlogik** `src/renderer/src/log-search.ts` nach K §4.2 (`compileSearch`, `findMatches` mit Limit 1 000, `markParts`), getestet inkl. Null-Breite-Treffern.
- **R-LV-5 xterm-Suche** in `TerminalPanel` nach K §4.2 „xterm-Seite“: `allowProposedApi: true`, Decorations mit Token-Farben, `onDidChangeResults` → Status, Vorprüfung mit `compileSearch` plus `try/catch`, `follow`/`searchRequest`-Props, Strg+F nur in Log-Panels (Shells unverändert, R1), `clearDecorations` beim Schließen.
- **R-LV-6 Copy-on-Select bei offener Suche nur per Maus** (K §4.2 letzter Punkt). Pflicht.
- **R-LV-7 Listen-Suche** in `WorkloadLogs` nach K §4.2 „Listen-Seite“ und K §4.3 (nur angezeigte Zeilen, nur Zeilentext, `scrollIntoView` ohne smooth, eine Markierungsart pro Zeile).
- **R-LV-8 Lupen-Knopf** in beiden Dock-Leisten (K §4.2 letzter Absatz).
- **R-LV-9 Tokens/CSS** nach K §4.4 ohne die schon erledigten Dock-Flex-Regeln; Kontraste prüft der Prüfer nach.
- **R-LV-10 Texte** nach K §4.5, de-DE und en-US, keine verwaisten Keys.
- **R-LV-11 Abnahme** nach K §6 Task F: `docker logs`-Fake in `sshd.mjs`, Szene `kube-logs` erweitert, neue Szene `container-logs`, `terminal-search` angepasst; Handbuch; README-Feature-Zeile.

## Abweichungen vom Konzept

- **Ruling: keine Versionserhöhung und kein CHANGELOG-Eintrag** — AGENTS.md verbietet Versionsnummern ohne ausdrücklichen Auftrag, und der Pipeline-Hinweis koppelt CHANGELOG an die Version — Kosten: der Nutzer muss beim Release die Notiz ergänzen. Task F lässt `CHANGELOG.md`, `package.json`, `package-lock.json` unberührt.
- **Ruling: Dock-Flex-Layout schon im Vorab-Fix** — der Nutzer meldete den Größen-Bug separat; kleiner, klarer Fix — Kosten: keine.

## Nicht-Ziele

K §5 gilt vollständig (kein Main, keine Pakete, keine Persistenz, kein Regex im Filter, ReDoS dokumentiert statt abgefangen, keine Bewegung, kein Neue-Zeilen-Zähler für xterm). Extras G/H aus K §6 nicht in diesem Branch.

## Wellen

K §6 mit den Abweichungen oben: W1 A, B, C parallel; W2 D, E parallel; W3 F.

## Abnahme

`npm run typecheck`, `npx vitest run`, Szenen `containers`, `kube-logs`, `container-logs`, `terminal-search` grün, Screenshots angesehen (hell und dunkel mindestens einmal für die Trefferfarben).
