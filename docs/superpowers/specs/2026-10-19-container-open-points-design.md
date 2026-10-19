# Container – offene Punkte schließen – Design

Stand: 2026-10-19 · Branch `claude/fix/container-open-points` (gestapelt auf `claude/feature/design-system`, PR #16) · Version bleibt 0.9.0

> „schließe die offenen punkte ab“

Bindend sind die Lösungen, Testfälle und Tasks aus dem Plan `docs/superpowers/plans/2026-10-19-container-open-points.md` (Recherche, wörtlich übernommen). Bei einem Widerspruch gilt diese Spec.

## Punkte

| # | Offener Punkt (Quelle) | Lösung |
|---|---|---|
| P1 | sudo im Passwortmodus meldet sich je Poll viermal an (View-Review M6, C32) | Ein Remote-Batch je Poll: `sudo -v` einmal, dann vier `sudo -n <argv>` mit zufälligen, zeilenverankerten Marken je Art auf stdout und stderr. Neue reine Datei `inventory-batch.ts`, die den Befehl baut und die Ausgabe zurückspaltet. Fehler bleiben je Art in `problems`. Lokal ändert sich nichts. |
| P2 | `useContainerInventory` ohne Test (View-Review M8) | `InventoryScheduler` mit derselben Semantik wie heute, getestet mit Fake-Timern |
| P3 | Fokus-Logik ohne Test (Entries-Review M5) | `reusableTab` und `planContainerView` in `terminal-tabs.ts`, mit Tests |
| P4 | Fallback-Maske mit Lücken (View-Rereview N1, Minor im Ledger) | zweistufig: erst Werte in Quotes mit Escapes, dann Freitext bis zum Whitespace |
| P5 | Veralteter `reloadDock`-Vergleich (View-Rereview N2) | `stateRef` in `ContainerView.tsx` |
| P6 | Ein fester Tab fragt die andere Laufzeit ab (Entries-Review M4) | Strenger Modus: Fehlt die angeforderte Laufzeit, wirft Main „Docker wurde auf diesem Host nicht gefunden.“ bzw. „Podman …“, bevor eine Liste läuft. Der Reducer-Zweig bleibt als zweite Verteidigung. |
| P7 | README-Zeile zu lang (Entries-Rereview N1) | umbrechen |

## Rulings

| # | Ruling | Warum | Kosten, falls falsch |
|---|---|---|---|
| O1 | Die Validierung der Container-Ansicht lösen B8 (Schritte 3 und 4) und C32 ab, außerdem E1 der Entries-Validierung. | Die Nutzer-Rückmeldung „offene Punkte abschließen“. Vierfache sudo-Anmeldung und stilles Ausweichen sind die offenen Punkte selbst. | keine |
| O2 | Der Batch läuft nur per SSH. Lokal gibt es kein sudo, die Abfrage dort bleibt wie heute. | Nur dort entsteht das Problem. | keine |
| O3 | Die Ausgabegrenze des Batches liegt bei 4 MiB, also 4 × 1 MiB wie bisher je Liste. | Große Hosts verlieren sonst Listen. | etwas mehr Speicher je Poll |
| O4 | Die Marken sind zufällig je Aufruf (Main, `crypto.randomBytes`) und zeilenverankert. Eine Ausgabe, die eine Marke nachahmt, kann eine Liste nur verwerfen, aber nichts ausführen. | Host-Ausgabe ist nicht vertrauenswürdig. | keine |
| O5 | Keine neue Version. Der CHANGELOG 0.9.0 wird ergänzt. | unveröffentlicht, gestapelt | keine |
