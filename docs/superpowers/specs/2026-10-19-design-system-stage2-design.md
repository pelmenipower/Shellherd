# Designsystem Stufe 2 – Design

Stand: 2026-10-19 · Branch `claude/feature/design-system-stage2` (gestapelt auf `claude/fix/container-open-points`, PR #18) · Version bleibt 0.9.0

> „schließe die offenen punkte ab“ (offene Punkte aus PR #16, Designsystem)

Bindend sind die Rulings in Abschnitt 2 sowie die Abschnitte 3–7 (Faltungstabellen, Lint-Regeln, Toast, xterm, Aliase, Keyframes), 8 (Ausschlüsse), 10 (Tests) und 11 (Tasks) aus dem Plan `docs/superpowers/plans/2026-10-19-design-system-stage2.md` (Recherche mit Electron-Messungen, wörtlich übernommen). Bei einem Widerspruch gilt diese Spec. Weiter gelten `docs/design-system.md` und die Validierung von Stufe 1.

## Punkte

| # | Offener Punkt | Lösung |
|---|---|---|
| S1 | Der Lint erkennt bewegte Keyframes nur innerhalb derselben Datei (Rereview N1). | Keyframes einmal über alle Dateien sammeln |
| S2 | Maße sind nicht vereinheitlicht. | Control-Höhen 24/28/32/36, Leisten 32 (Kopf 44, Status 24), Schrift-Skala, numerische Abstands-Skala. Lint R14–R17 verbietet literale Maße. Die Kopplungen in TSX (Pane-Kopf 32, Zeilenhöhe 24) bleiben literal und werden per Lint festgeschrieben. |
| S3 | Fehler erscheinen als Fluss-Balken, der die Bühne verkleinert. | Toast unten rechts. Er gleitet rein und auf demselben Weg wieder raus (220 ms), hat kein Zeitlimit, schließt nur per Knopf, nimmt keinen Fokus und blockiert die RDP-Fläche wie Menüs. |
| S4 | Das xterm-Theme hält eine Kopie der Farben. | Die vier Farben kommen per `getComputedStyle` vor `new Terminal`, die Fallbacks werden per Test gegen `tokens.css` geprüft. |
| S5 | Es gibt noch Alias-Namen. | löschen, der Lint verbietet sie |

## Rulings

Die Rulings S2-1 … S5-1 und ALLG aus Plan Abschnitt 2 gelten wörtlich. Zusätzlich:

| # | Ruling | Warum | Kosten, falls falsch |
|---|---|---|---|
| Z1 | Sichtbare Dichte-Änderungen sind gewollt: View-Leiste 30 → 32, Editor-/Assistent-Kopf 40 → 32, Chip-Leiste 41 → 33. | So folgt Terminus dem roten Faden „vier Control-Höhen, Leisten 32“. Alle drei Änderungen sind gemessen und laufen nicht über. | Eine Zeile je Leiste |
| Z2 | Lieber eine Faltung weglassen als ein Layout brechen. Werte, deren Kopplung unklar ist, bleiben als `calc()` aus einem Token oder in der Ausnahmeliste der Lint-Regel. | Ohne Screenshot-Tests ist das sicherer. | eine Ausnahme mehr |
| Z3 | Die Aliase (D2 „entfallen in 1.0“) werden schon jetzt entfernt. | Sie werden nicht mehr genutzt, und das Designsystem ist laut CLAUDE.md verbindlich. | keine |
