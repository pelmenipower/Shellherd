# Designsystem und Motion – Design

Stand: 2026-10-19 · Branch `claude/feature/design-system` (gestapelt auf `claude/fix/stage-view-position`, PR #15) · Version bleibt 0.9.0 (unveröffentlicht)

> „überprüfe welche design wir anpassen können um einen konkreten roten faden zu haben nutzen auch /animate um die notwendigen elemente zu animieren. darauf aufgebaut erstelle ein designsystem was wir als grundlage verwenden wollen.“

Maßstab: die Skills `emil-design-eng` und `animate` (Emil Kowalski). Bindend sind die Abschnitte 2 (roter Faden), 3 (Tokens, Faltungstabelle, Zustände), 4 (Motion-Gate), 5 (Regeln), 6.3 (Ausschlüsse), 6.5 (Test) und 6.6 (Tasks) aus dem Plan `docs/superpowers/plans/2026-10-19-design-system.md` (Recherche, wörtlich übernommen). Bei einem Widerspruch gilt diese Spec.

## 1. Ziel

- **Eine Token-Datei** `src/renderer/src/tokens.css` ist die einzige Quelle für Farben, Abstände, Radien, Schrift, Control-Höhen, Ebenen, Fokus, Schatten und Motion. Alle zehn CSS-Dateien nutzen nur noch `var(--…)` daraus.
- **Roter Faden:** Terminus ist ein dichtes, dunkles Ops-Werkzeug. Es bewegt sich fast nichts. Was leuchtet, ist Cyan, und was gefärbt ist, zeigt einen Zustand. Drei Flächenstufen, eine Linie, ein Auswahl-Blau, eine Aktiv-Tönung, eine Ampel nur für Zustände, zwei Textstufen.
- **Motion nur nach dem Gate:** Druck-Feedback auf Buttons (120 ms), Einblenden von Dialogen (200 ms), drei Popovern (160 ms, Ursprung am Auslöser) und dem Drop-Hinweis (180 ms), dazu ein gemeinsamer Puls für „beschäftigt“. Alles, was die Tastatur auslöst oder sehr oft vorkommt, bleibt sofort.
- **Absicherung:** Ein vitest-Test prüft alle CSS-Dateien auf Verstöße (harte Farben, `transition: all`, eingebaute Easings, literale Dauern und z-index, `scale(0)`, fehlendes `prefers-reduced-motion`, ungeschütztes Hover-Motion).
- **Doku:** `docs/design-system.md` als Grundlage für jede neue Oberfläche.

## 2. Rulings

| # | Ruling | Warum | Kosten, falls falsch |
|---|---|---|---|
| D1 | Vereinheitlichen statt neu gestalten: **keine neue Farbe**. Jede Faltung geht auf den häufigsten Bestandswert. | Der Faden existiert schon, er ist nur verwaschen. Es entsteht kein Bruch im Look. | Feinschliff einzelner Werte später, eine Zeile in `tokens.css` |
| D2 | Alte Namen (`--ui-*`, `--surface`, `--border`, `--text`, `--accent` …) bleiben in Stufe 1 als **Aliase**. Sie werden in 1.0 entfernt. | Es bricht nichts, und die Umstellung erfolgt pro Datei. | Altnamen bleiben eine Zeit lang sichtbar |
| D3 | **Nur CSS**, kein Framework und keine Motion-Bibliothek. Werkzeuge sind Transitions und `@starting-style` (Chromium in Electron 44). | Die Regel „das billigste Werkzeug“ aus `animate`. | keine |
| D4 | **Gate streng:** Tabs, Kontextmenü, Workflow-Palette, Hilfe-Overlay, Dock, Seitenleiste, Baum, Chips, Zeilenauswahl, Hover-Farben und Terminal werden nicht animiert. | Tastatur- oder 100+-pro-Tag-Aktionen. Bei Seitenleiste und Dock kommt der xterm- und RDP-Resize hinzu. | Etwas wirkt „hart“: Ein Eintrag in der Gate-Tabelle reicht, um das nachzuziehen. |
| D5 | Jede Bewegung steht hinter `prefers-reduced-motion: no-preference`. Bei `reduce` bleibt nur die Opazität. | Pflicht aus beiden Skills. | keine |
| D6 | Keine Geometrie-Faltung in Stufe 1 (Control-, Leisten- und Schrifthöhen bleiben). Das gehört in Stufe 2. | Ohne Screenshot-Tests ist eine Layoutänderung riskant. Stufe 1 ändert nur Farbvarianten, Schatten, z-index und Motion. | Höhen bleiben vorerst uneinheitlich |
| D7 | Der z-index-Fehler (Hilfe-Backdrop 50 unter dem App-Kopf 60) wird mit `--layer-modal` behoben. | echter Fehler, eine Zeile | keine |
| D8 | Klassen, UI-Texte, Main, Preload und Shared bleiben unverändert. Einzige TSX-Änderung: `transformOrigin` in `ConnectionPicker.tsx`. Das xterm-Theme in `TerminalPanel.tsx` bleibt ebenfalls unverändert. | DOM-Vertrag früherer Validierungen, RDP-Fläche und xterm-Fit | keine |
| D9 | Keine neue Version. Der CHANGELOG-Eintrag 0.9.0 wird ergänzt. | 0.9.0 ist unveröffentlicht, die PRs sind gestapelt. | keine |
| D10 | Der Lint-Test läuft in Welle 1 gegen `MIGRATED`. Welle 3 weitet ihn auf alle Dateien aus. | Jedes Wellen-Gate bleibt grün. | keine |

## 3. Tasks

Plan Abschnitt 6.6: T1 (Tokens, Shell, Test) → T2–T7 parallel je CSS-Fläche → T8 (Test auf alle, `docs/design-system.md`, README-Absatz, CHANGELOG 0.9.0). Gate nach jeder Welle: `npm run typecheck` und `npx vitest run`.

## 4. Abnahme (manuell)

`npm run dev`, dann diese Bereiche durchgehen: Seitenleiste, Terminal-Tabs, geteilte Ansicht, Dateien, Cluster, Container (Docker/Podman), Assistent, Bestätigungsdialoge, Workflow-Palette, Verbindungs-Picker, Workspace- und Layout-Menü. Feel-Check: Dialog und Picker bei fünffacher Dauer im DevTools-Animations-Panel ansehen. Druck-Feedback auf Icon- und Primärbutton vergleichen. Reduced motion in den DevTools emulieren.
