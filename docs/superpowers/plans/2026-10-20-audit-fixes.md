# Audit-Fixes – Plan

Spec: `docs/superpowers/specs/2026-10-20-audit-fixes-design.md` (Lösung, Ruling und roter Test je Befund dort).

Gate nach jeder Welle: `npm run typecheck` und `npx vitest run` grün, danach ein Commit pro Task. Jeder Umsetzer arbeitet test-first, schreibt nur die genannten Dateien, committet nie und legt einen Report unter `.superpowers/sdd/2026-10-19-audit-fixes/reports/<task>.md` ab.

## Welle 1 – zehn Tasks parallel, disjunkte Dateien

| Task | Befunde | Dateien |
|---|---|---|
| **A Dateien** | #1, #2, #3 | `src/main/files/file-system.ts`, `transfer.ts` + Test, `remote-edit.ts` + neuer Test, `files/ipc.ts` (nur `openForEditing`/`editorFor`), neuer `open-for-editing.test.ts`, `src/shared/locales/{de-DE,en-US}/errors/files.json` |
| **B Vault-Speicher** | #4, #25, #20 (`loadVault`, `decryptVault`, `crypto`-Dependency) | `src/main/vault/storage.ts`, `crypto.ts`, deren Tests, `migration-backup.test.ts`, `session-key.test.ts` (nur falls nötig), neuer `src/test/vault-helpers.ts`, `package.json`, `package-lock.json` |
| **C Vault-Session** | #7, #14, #15 | `src/main/vault/session.ts` + Test, `src/main/vault/ipc.ts` |
| **D RDP** | #6 | `src/main/rdp/host.ts` + Test, `native/Shellherd.RdpHost/Program.cs` |
| **E Assistent** | #8, #9, #10 | `src/renderer/src/components/AssistantPanel.tsx`, `src/renderer/src/terminal-access.ts` + Test, `src/shared/locales/{de-DE,en-US}/assistant.json`, `src/shared/locales/{de-DE,en-US}/main.json` (nur `assistant.prompt.command`) |
| **F Fenster** | #11 | `src/main/window-ipc.ts`, neuer `src/main/window-ipc.test.ts` |
| **G Kubernetes** | #12, #13, #17 | `src/main/kubernetes/client-api.ts` + Test, `src/main/kubernetes/access.ts` + Test, `src/main/ssh/session.ts` + Test |
| **H Verbindungstest/Einstellungen** | #16, #18 | `src/main/connection-test.ts` + Test, `src/main/app-settings.ts` + Test, `src/main/locale.ts` + Test, `src/shared/locales/{de-DE,en-US}/errors/core.json` |
| **I Renderer** | #19, #22, #23, #24 | `src/renderer/src/App.tsx`, neuer `src/renderer/src/hooks/usePersistVault.ts` + Test, `SplitTerminalArea.tsx`, `src/renderer/src/i18n.ts` + Test |
| **J KI + Skill** | #5, #21 | `src/main/ai/assistant.ts`, neuer `src/main/ai/assistant.test.ts`, `.claude/skills/run-app/{driver.mjs,demo-setup.mjs,SKILL.md}` |

Konflikt-Hinweis: Nur H und A schreiben Fehlerkataloge, in getrennte Dateien (`core.json` und `files.json`). E schreibt `main.json`, H nicht.

## Welle 2 – Duplikate (1 Task)

| Task | Befunde | Dateien |
|---|---|---|
| **K Duplikate** | #20 Rest | `src/main/ssh/validation.ts`, `ai/ipc.ts`, `files/ipc.ts` (nur `parse`), `rdp/ipc.ts`, `window-ipc.ts` (nur `parse`), `src/renderer/src/container-tree.ts`, `file-browser.ts`, `FilesPanel.tsx`, `error-text.ts` und alle Aufrufer von `ipcMessage`/`ipcErrorText`, `src/preload/index.ts`, `src/main/containers/sudo.ts`, `sudo-rejections.ts` + Test |

## Welle 3 – Doku und Version (1 Task)

**L Doku:** `package.json` und `package-lock.json` auf 0.12.1 (`npm run version:patch`), `CHANGELOG.md` und `CHANGELOG.en.md` mit den zehn Einträgen aus der Spec, `docs/handbuch.md` und `docs/manual.md` (ein Satz zur Allow-Liste).

Danach `run-app`-Abnahme (Spec S5), Review, eine Fix-Welle und eine Nachprüfung.
