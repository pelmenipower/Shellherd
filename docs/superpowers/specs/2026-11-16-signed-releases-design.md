# Signierte Releases und Update aus der App – Design

Stand: 2026-11-16 · Branch `claude/feature/signed-releases` (von `staging` 2b66ac1, eigener PR gegen `staging`)
Grundlage: Konzept `.superpowers/sdd/signed-releases-research.md` („K“). Diese Spec übernimmt K als verbindlichen Entwurf; Verweise „K §x“ zählen als Teil der Spec.

## Ziel

Nutzerwunsch: „Unix- und Windows-Pakete signieren und einen Update-Mechanismus ähnlich zu HerdCtrl, damit die Virenscanner bei den unsignierten EXE-Dateien nicht ausrasten.“

Nutzerentscheidungen (fest):
1. Windows-Authenticode über die **SignPath Foundation**. Der Nutzer bewirbt sich; bis zur Freigabe läuft der Release-Workflow grün und unsigniert und meldet das sichtbar.
2. Update wie HerdCtrl: Hinweis in der App, ein Klick startet das gebündelte `install.sh`/`install.ps1`, das lädt, prüft (Sigstore wenn möglich, `SHA256SUMS` immer, Authenticode unter Windows) und installiert. Kein electron-updater.

## Umfang Stufe 1 (verbindlich)

- **R-SR-1 Windows zweiphasig signieren** nach K §3.3: `--dir` → Unpacked-ZIP tief über die SignPath-Action → `--prepackaged` NSIS/Portable → Installer-ZIP signieren. Ohne Secret/Variablen alle Signierschritte übersprungen, Lauf grün, Status in Step-Summary, Annotation und Release-Notes. Prüfskript `scripts/check-win-signatures.ps1` (Pflichtliste, Zeitstempel-Pflicht, `Unsigned`-Modus, Prüfung nach Phase 2, stille Testinstallation). Referenz-XML unter `.github/signpath/`. Uninstaller in Stufe 1 unsigniert (K §3.4).
- **R-SR-2 Sigstore und Attestation** nach K §4: `cosign sign-blob` über `SHA256SUMS` mit Bundle `SHA256SUMS.sigstore.json`, Verifikation im Workflow, `actions/attest-build-provenance` mit `subject-checksums`; Identity `https://github.com/pelmenipower/Shellherd/.github/workflows/release.yml@refs/heads/main`.
- **R-SR-3 Dry-Run bei PRs** nach K §6 (paths-Filter, kein Publish, keine Attestation, SignPath übersprungen).
- **R-SR-4 Installationsskripte** nach K §5.5/§5.6: Signaturprüfung, Handoff an das Release-Skript, `--from-app`/`-FromApp`, AppImage-Ersatz, Portable-Download, Lock, Env-Bereinigung, Sicherheitsregeln K §5.7.
- **R-SR-5 Update aus der App** nach K §5.2–§5.4: Skripte als `extraResources`, `src/main/update-launch.ts` (`detectInstallKind`, `planUpdateLaunch`), IPC `app:update-install`, `UpdateStatus.install`, Menüpunkt „Jetzt aktualisieren“/„Neue Version herunterladen“ mit ConfirmDialog, Fehlercodes, Test-Hook nur mit lokaler Test-URL.
- **R-SR-6 Nachweis und Doku** nach K §6/§7: Tests für Skripte und Main, `release-verify-notes.mjs`, run-app-Szene `update` mit `update-confirm.png`; README (Installation, Verify a download, Code signing policy, Updates, Releasing), Handbuch/Manual.

## Rulings

Alle aus K §11 gelten, insbesondere:
- **Keine Versionserhöhung, kein CHANGELOG** — AGENTS.md; Version 0.33.0 läuft in PR #54 — Kosten: Nutzer ergänzt beim nächsten Release.
- **SignPath-Details „zu prüfen“ (K §12) blockieren nicht** — jeder Signierschritt ist abschaltbar, jede Prüfung meldet statt zu raten — Kosten: nach der Freigabe evtl. kleine Anpassung an Action-Inputs oder Artefakt-Konfiguration.
- **Identity auf `refs/heads/main`** — Releases laufen per Push auf `main` — Kosten: schwächerer Pin als ein Tag.

## Nicht-Ziele

Extras K §9 (E1–E6). Keine gespeicherten Signaturschlüssel, kein cosign-Download, kein `pkexec`, kein Ersetzen der Portable-EXE.

## Wellen

Nach K §10 (W1 T1–T5, W2 T6–T8), bindend in der Fassung der Validierung.

## Abnahme

`npm run typecheck`, `npx vitest run`, `bash -n install.sh`, Installer-Tests, run-app-Szene `update` grün, Screenshot angesehen; Dry-Run des Release-Workflows im PR grün (Windows unsigniert gemeldet, cosign signiert und verifiziert).
