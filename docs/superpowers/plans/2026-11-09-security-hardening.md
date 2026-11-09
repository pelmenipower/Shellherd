# Plan: Sicherheitshärtung H1

Spec: `docs/superpowers/specs/2026-11-09-security-hardening-design.md` (Zerlegung dort in Abschnitt 8). Bindend geht `…-validation.md` vor. Jede Task test-first, nur eigene Dateien, **kein Commit**, Bericht als Antworttext.

## Welle 1 (unabhängig)
T1 Server-Limits · T2 Rendezvous-Proof/Spam/I4 · T3 Vault-Passwort-Prüfung · T4 Identität v2 · T5 CSP + Permissions · T6 Signal-Helfer + Vertrag · T7 Betrieb (Caddy, Dockerfile-Digest, Compose, README, Init-Passwort) · T8 Sync-Toleranz

Dateien und Inhalte je Task: Spec §8, Detail §4.x.

## Welle 2 (nach Welle 1)
T9 RemoteLabHost · T10 SyncLabHost + Verdrahtung · T11 Lab-IPC + nativer Dialog + main.json

## Welle 3
T12 Renderer (Dialoge, Peer-Ack, Locales, CSS nur Tokens) · T13 Doku + Szene (Handbuch, Pläne, remote-scene, Consent-Hook, SKILL.md)

Danach: `npm run typecheck`, `npx vitest run`, `node server/smoke.mjs`, Szene ausführen (Lead), Container-Check, Review (`pruefer`), eine Fix-Welle, Nachprüfung. Keine Version und kein CHANGELOG in H1 (wie beim Fernzugriff-Meilenstein): kommt mit dem nächsten Release-Branch auf Wunsch des Nutzers.
