# SFTP Auto-Upload – Plan

Spec: `docs/superpowers/specs/2026-10-20-sftp-auto-upload-design.md`. Verträge: Typen 3.1/3.7, Matcher 3.2, `AutoUploads` 3.3–3.6, UI 3.8, Texte 3.9, Tests 3.10, Aufteilung Abschnitt 6.

Gate nach jeder Welle: `npm run typecheck` und `npx vitest run` grün, danach ein Commit pro Task. Umsetzer schreiben nur die genannten Dateien und committen nie.

## Welle 1 – fünf Tasks parallel

| Task | Dateien |
|---|---|
| A Shared-Typen und Vault | `src/shared/sftp.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/shared/vault/types.ts`, `src/shared/vault/schema.ts`, `src/shared/vault/schema.test.ts`, `src/renderer/src/connection-form.ts`, `src/renderer/src/connection-form.test.ts` |
| B Matcher | `src/shared/exclude-glob.ts`, `src/shared/exclude-glob.test.ts` |
| C Texte | `src/shared/locales/{de-DE,en-US}/files.json`, `src/shared/locales/{de-DE,en-US}/errors/files.json` |
| D Transfer-Hook | `src/main/files/transfer.ts`, `src/main/files/transfer.test.ts` |
| J Doku und Version | `docs/handbuch.md`, `docs/manual.md`, `CHANGELOG.md`, `CHANGELOG.en.md`, `package.json`, `package-lock.json` (nur über `npm run version:minor`), `docs/design-system.md` |

Bis Welle 3 die Keys benutzt, sind die neuen Keys aus C verwaist. Stört das `i18n-catalog.test.ts`, legt C sie trotzdem an und das Gate nach Welle 1 nimmt nur diesen Befund hin. Nach Welle 3 muss alles grün sein.

## Welle 2 – vier Tasks parallel

| Task | Dateien |
|---|---|
| E AutoUploads | `src/main/files/auto-upload.ts`, `src/main/files/auto-upload.test.ts` |
| G Dialog und Prüfung | `src/renderer/src/components/AutoUploadDialog.tsx`, `src/renderer/src/auto-upload-form.ts`, `src/renderer/src/auto-upload-form.test.ts` |
| H Liste und CSS | `src/renderer/src/components/AutoUploadList.tsx`, `src/renderer/src/files-ui.css` |
| K run-app | `.claude/skills/run-app/screens.mjs`, `.claude/skills/run-app/SKILL.md` |

## Welle 3 – zwei Tasks parallel

| Task | Dateien |
|---|---|
| F Session und IPC | `src/main/files/sftp-session.ts`, `src/main/files/ipc.ts`, `src/main/files/sftp-session.test.ts`, `src/main/files/sftp-loopback.test.ts` |
| I Panel-Verdrahtung | `src/renderer/src/components/FilesPanel.tsx`, `src/renderer/src/components/FilePane.tsx`, `src/renderer/src/components/SplitTerminalArea.tsx`, `src/renderer/src/App.tsx` |

## Abnahme

Build, dann `run-app` mit dem Block `sftp` aus `screens.mjs`. Beide neuen PNGs werden angesehen, dann das Gate. Korrekturen gehen nur in die Datei, in der der Fehler liegt.
