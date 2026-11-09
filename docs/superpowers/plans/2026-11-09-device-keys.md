# Plan: Sicherheitshärtung H3

Spec: `docs/superpowers/specs/2026-11-09-device-keys-design.md` (Zerlegung dort in Abschnitt 8, Umfang in Abschnitt 0). Bindend geht `…-validation.md` vor. Jede Task test-first, nur eigene Dateien, **kein Commit**, Bericht als Antworttext.

## Welle 1 (parallel; grün erst mit T1 + T2 zusammen)
T1 Server · T2 Client-Transport · T3 Sync-Kern (inkl. Autorenstempel und `regenerateRecoveryCode`) · T4 Identität · T5 Shared + Texte · T6 Betrieb

## Welle 2 (typecheck-grün erst mit T7 + T8 + T9 zusammen)
T7 Sync-Lab Host/IPC · T8 Remote-Lab Host/IPC + Wiring · T9 Renderer

## Welle 3
T10 Doku + Szenen (`remote-scene.mjs` angepasst, neu `sync-scene.mjs`)

Danach: typecheck, vitest, `node server/smoke.mjs`, Build, run-app-Szenen mit `/console`, Container-Check (CI), Review (`pruefer`), eine Fix-Welle, Nachprüfung. Keine Version, kein CHANGELOG.
