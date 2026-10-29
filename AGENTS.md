# Repository-Regeln

## Git und Veröffentlichungen

- `main` ist tabu: niemals direkt auf `main` arbeiten, committen oder pushen.
- Für Änderungen immer einen eigenen Feature- oder Fix-Branch verwenden.
- Nur den eigenen Branch pushen. Pull Requests für diese Arbeit gegen `staging` richten.
- Der Benutzer übernimmt die Merges: eigener Branch → `staging` → `main`. Keine dieser Zusammenführungen eigenständig durchführen.
- Keine Versionsnummern erhöhen, Git-Tags erstellen oder Releases veröffentlichen, sofern der Benutzer dies nicht ausdrücklich beauftragt.
- Vor jedem Commit und Push den aktuellen Branch prüfen. Bei `main` oder `staging` zuerst auf einen eigenen Branch wechseln.
- Bestehende Änderungen im Arbeitsverzeichnis respektieren und keine fremden Änderungen verwerfen.
