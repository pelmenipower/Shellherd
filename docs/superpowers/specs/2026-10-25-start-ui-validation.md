# Start-UI – Validierung (bindend)

Urteil: **ready after corrections**. 0 Blocker, 4 Korrekturen. Alles nicht Genannte gilt aus der Spec `2026-10-25-start-ui-design.md` wörtlich (Rulings 2, Verträge 3, Token-Tabelle 4, Regeln 5, Doku-Texte 6, Tasks 7).

## Rulings

- **R-A Pfad-Freigabeliste nicht jetzt** (Spec A4): `unlockVault` nimmt schon heute Pfade aus Explorer-Start, Drag-and-drop und Sperrbildschirm an. Eine Liste allein würde nichts absichern. Eigenes Härtungs-Feature, dem Nutzer im Bericht nennen.
- **R-B Theme in userData, Standard `dark`:** Das Vault-Feld `settings.theme` wird ignoriert (vor dem Entsperren unbekannt). Kein Schema-Bruch, keine Migration.
- **R-C Orphan-Test:** Nach Welle 1 und 2 darf `i18n-catalog.test.ts` (d) nur für neue Keys aus T3 rot sein; nach Welle 3 grün.

## Korrekturen

- **V1 Löschen von `last-vault.ts`:** T10 darf `src/main/vault/last-vault.ts` und `last-vault.test.ts` löschen (gehört zur Task). Vorher alle Aufrufer per `grep -rn "last-vault\|LastVaultFile" src` umstellen; ein einmaliges Lesen von `last-vault.json` als Startwert bleibt (Spec 3.3).
- **V2 Playwright und Farbschema:** Der Treiber startet Electron unter Playwright. Prüft T14, dass `matchMedia('(prefers-color-scheme: light)')` nach `setTheme('light')` wirklich umschaltet; wenn nicht, ist das ein Werkzeugproblem (Playwright-Emulation), kein Produktfehler – dann im Bericht nennen und per `electronApp`-Option `colorScheme` lösen, nicht im Produkt.
- **V3 Pfade in Screenshots:** Alle neuen Bilder mit `crop=status`; der Startbildschirm zeigt Pfade – die Szene `recent` nutzt nur Pfade unter `RUN_DIR` und bricht bei `--readme` ab (Spec 7, T14).
- **V4 Version:** T9 setzt 0.22.0 mit `npm run version:minor`; Changelog de/en gleiche Anzahl Einträge.
