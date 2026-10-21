# Verbindungs-Timeouts und Vault-Auto-Sperre – Plan

Spec: `docs/superpowers/specs/2026-10-21-connection-timeouts-design.md`. Die Aufteilung steht in Abschnitt 6, die Verträge in 3.1–3.8, die Tests in 3.9.

Gate nach jeder Welle: `npm run typecheck` und `npx vitest run` grün, danach ein Commit pro Task. Umsetzer schreiben nur die genannten Dateien und committen nie.

## Welle 0 (ein Task)
0A Vertrag: Typen, Schema, `timeouts.ts`, Fehlercode `idle`, IPC-Kanäle, Preload.

## Welle 1 (fünf Tasks parallel)
1B Main SSH/SFTP · 1C Main Auto-Sperre · 1D Einstellungsdialog · 1E Verbindungsformular · 1F Renderer Sperre und Grund. Die Dateien stehen in Spec 6.

## Welle 2 (ein Task)
2A Doku, Changelog, Version 0.14.0.

## Abnahme
Build, run-app nach Spec 3.10, Screenshots `settings`, `idle-disconnect` und die Startkarte nach der Auto-Sperre ansehen.
