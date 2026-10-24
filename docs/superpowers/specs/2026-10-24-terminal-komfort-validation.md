# Terminal-Komfort – Validierung (bindend)

Urteil: **ready after corrections**. 0 Blocker, 5 Korrekturen. Alles nicht Genannte gilt aus der Spec `2026-10-24-terminal-komfort-design.md` wörtlich (Rulings R1–R17, Vertrag 3.x, Texte 12, Tasks 15).

## Korrekturen

- **V1 Pakete:** `@xterm/addon-search@0.16.0` und `@xterm/addon-web-links@0.12.0` sind bereits exakt installiert (Orchestrator). Task A fasst `package.json`/`package-lock.json` nicht an. Die Version 0.20.0 setzt Task L (`npm run version:minor`), nicht A.
- **V2 Katalog:** `ConnectionCatalog.terminal` ist **optional** (`terminal?: TerminalSettings`). Leser fallen auf `effectiveTerminalSettings(undefined)` zurück. So bleibt der Typecheck nach Welle 0 grün.
- **V3 Orphan-Test:** Nach Welle 0 und 1 darf `i18n-catalog.test.ts` (d) nur für die neuen Keys aus Task B rot sein; nach Welle 2 grün. Jede andere rote Prüfung ist ein Fehler der Welle.
- **V4 Electron-Menü:** Shellherd setzt kein eigenes Menü (`src/main` ohne `setApplicationMenu`). Das Standardmenü belegt Strg+Umschalt+T/W nicht; Strg+W bleibt dem Standardmenü überlassen und ist kein Ziel. Keine Änderung nötig.
- **V5 Version und Doku:** Task L macht zusätzlich `npm run version:minor` (0.19.0 → 0.20.0) und ergänzt die README-Feature-Liste (Terminal: search, links, shortcuts, settings, broadcast). Dateien: `package.json`, `package-lock.json`, `README.md` gehören zu L.

## Wellen

Wie Spec 15, mit V1 (A ohne Paketdateien) und V5 (L mit Version und README).
Gates: nach jeder Welle `npm run typecheck` grün; `npx vitest run` grün bis auf V3.
