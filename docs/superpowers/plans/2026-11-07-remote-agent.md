# Plan: Fernzugriff (Entwicklung), Meilenstein 1

Spec: `docs/superpowers/specs/2026-11-07-remote-agent-design.md`. Bindend geht `…-validation.md` vor. Jede Task test-first, nur eigene Dateien, **kein Commit**, Report nach `.superpowers/sdd/2026-11-07-remote-agent/report-<task>.md`.

## Welle 1 (unabhängig)

| Task | Dateien (exklusiv) | Inhalt | Tests |
|---|---|---|---|
| A Vertrag | `src/shared/remote-lab.ts`, `src/shared/remote-signal.ts`, `src/shared/remote-signal.test.ts`, `src/shared/ipc.ts`, `src/preload/index.ts` | Spec 5.1–5.3 | Codec, `checkSdp`, `formatFingerprint`; Round-Trip eines 20-KiB-Payloads in Teilen über echten `createSyncServer({ rendezvous: true })` und zwei `RendezvousPeer` (Muster `scripts/sync-prototype/rendezvous.test.mjs`) |
| B Server | `scripts/sync-prototype/account-auth.mjs`, `server.mjs`, `account-transport.mjs`, `rendezvous.test.mjs`, `server/README.md` | Spec 4 | 4 Integrationstests mit Fake-Clock |
| C Identität | `src/main/remote/identity.ts`, `identity.test.ts` | Spec 5.4 `identity.ts` | Fake-Cipher; speichern/laden, 0600, atomar, korrupt → Fehler ohne Überschreiben, nicht verfügbar → RAM-only, `remember` max 64 |
| D Präsenz | `src/main/remote/presence.ts`, `presence.test.ts` | Spec 5.4 `presence.ts` | Fake-Timer/Transport: Takte, Backoff, 401, 60-s-Offline, `stop` idempotent, keine Überlappung |
| T Texte | `src/shared/locales/de-DE/remoteLab.json`, `src/shared/locales/en-US/remoteLab.json`, `src/shared/locales/index.ts` | Spec 5.6 | `i18n-catalog.test.ts` (verwaiste Keys: Keys werden in Welle 2 genutzt – falls der Test verwaiste Keys in Welle 1 rot macht, die Prüfung bleibt rot bis Welle 2; dann T erst in Welle 2 committen) |
| G Renderer-Logik | `src/renderer/src/remote-lab.ts`, `remote-lab.test.ts`, `src/renderer/src/remote-peer.ts`, `remote-peer.test.ts`, `src/renderer/src/remote-capture-fake.ts` | Spec 5.5 (Controller, reine Logik, Fake-Capture) | Fake-RTCPeerConnection: Offer→Answer, 2-s-Timeout, `share`-Reihenfolge armCapture→capture→accept, Fehlerpfade, `ended` |
| J run-app Fakes | `.claude/skills/run-app/rendezvous.mjs` (neu), `driver.mjs`, `sshd.mjs`, `fakes.test.mjs` | Rendezvous-Fake 8788 mit synthetischem Konto, Start neben den anderen Fakes; `driver.mjs` setzt `SHELLHERD_SYNC_LAB=1`, `SHELLHERD_REMOTE_CAPTURE_FAKE=1` | Fake-Test: `/v1/info` `rendezvous: true`, Login |

Welle 1 importiert Typen aus A nur per Pfad; G und D/C dürfen die Spec-Signaturen bis zum A-Merge lokal voraussetzen (Welle wird gemeinsam geprüft).

## Welle 2 (braucht Welle 1)

| Task | Dateien | Inhalt |
|---|---|---|
| E Host | `src/main/remote/lab-host.ts`, `lab-host.test.ts` | Spec 5.4 `RemoteLabHost` mit Fake-Deps; Tests für R1, R3, R4 (Grant einmalig, 15 s, Owner), R5, R6, Serien-Queue, Ablauf, Busy-Ablehnung |
| F IPC + Bootstrap | `src/main/remote/lab-ipc.ts`, `src/main/index.ts` | Spec 5.4 `lab-ipc.ts` und Bootstrap, R11; programmiert gegen die Spec-Signatur von `RemoteLabHost` |
| H Dialoge | `src/renderer/src/components/RemoteLabDialog.tsx`, `RemoteConsentDialog.tsx`, `src/renderer/src/remote-lab.css` | Spec 5.5 |
| I Leiste + Einstieg | `src/renderer/src/components/RemoteShareBar.tsx`, `src/renderer/src/App.tsx`, `src/renderer/src/components/SettingsDialog.tsx` | Spec 5.5; nutzt H-Komponenten per Import (Props laut Spec: `controller`, `onClose`) |

## Welle 3

| Task | Dateien | Inhalt |
|---|---|---|
| K Szene + Doku | `.claude/skills/run-app/remote-scene.mjs` (neu), `.claude/skills/run-app/SKILL.md`, `docs/handbuch.md`, `docs/plans/selfhosted-e2ee.md`, `docs/plans/docker-rendezvous.md` | Spec 6.3, Handbuch mit Grenzen (nur Ansehen, nur LAN, kein Sperrbildschirm/UAC, Linux ohne Fensterschutz, Entwicklungsfunktion ohne Sicherheitsreview) |

Danach: Szene tatsächlich ausführen (Lead), Review (`pruefer`), eine Fix-Welle, Nachprüfung.
