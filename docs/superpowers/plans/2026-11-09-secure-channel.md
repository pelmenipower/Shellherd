# Plan: Sicherheitshärtung H2

Spec: `docs/superpowers/specs/2026-11-09-secure-channel-design.md` (Zerlegung dort in Abschnitt 8). Bindend geht `…-validation.md` vor. Jede Task test-first, nur eigene Dateien, **kein Commit**, Bericht als Antworttext.

## Welle 1 (parallel)
T1 Noise-Kanal · T2 Server-Frames/Info/DELETE/Listen · T3 URL-Regeln · T4 Kompaktierung · T5 Permissions · T6 Dialog-Throw · T7 Prüfung 16 Hex · T11 Betrieb

## Welle 2
T8 RemoteLabHost · T9 Sync-Lab · T10 Renderer

## Welle 3
T12 Doku + Szene

Danach: typecheck, vitest, smoke, Build, run-app-Screens und Szene mit `/console`, Container-Check (CI), Review (`pruefer`), eine Fix-Welle, Nachprüfung. Keine Version, kein CHANGELOG.
