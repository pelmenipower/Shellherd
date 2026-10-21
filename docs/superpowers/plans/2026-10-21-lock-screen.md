# Sperrbildschirm und Willkommens-Tab – Plan

Spec: `docs/superpowers/specs/2026-10-21-lock-screen-design.md`. Die Aufteilung steht in Abschnitt 9, die Tests in 6.

Gate nach jeder Welle: `npm run typecheck` und `npx vitest run` grün, danach ein Commit pro Task. Umsetzer schreiben nur die genannten Dateien und committen nie.

## 9. Zerlegung in parallele Tasks

| Welle | Task | Dateien (exklusiv) | Abhängigkeit |
|---|---|---|---|
| 1 | **1A Main Sperre** | `src/main/vault/session.ts` + `session.test.ts`, `src/main/vault/ipc.ts`, `src/main/index.ts`, `src/main/files/ipc.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/shared/vault/connections.ts` + `connections.test.ts` (`redactVault`) | – |
| 1 | **1B Tab-Modell Willkommen** | `src/shared/windows.ts`, `src/renderer/src/terminal-tabs.ts` + `.test.ts`, `terminal-layout.ts` + `.test.ts`, `hooks/useTabTransfer.ts`, `components/TerminalTabs.tsx`, `components/SplitTerminalArea.tsx`, `components/ConnectionPicker.tsx`, `terminal-ui.css`, `src/main/window-ipc.test.ts` (Assertion), `src/shared/locales/{de-DE,en-US}/{terminal,vault}.json` | – |
| 1 | **1C Sperrbildschirm** | neu `components/LockScreen.tsx`, neu `lock-ui.css`, `src/shared/locales/{de-DE,en-US}/app.json` (alle Keys aus 5, inkl. Löschungen), `docs/design-system.md` (Gate-Zeilen, Ebenen-Satz) | – (Prop-Vertrag aus 3.3) |
| 1 | **1D Doku und Version** | `docs/handbuch.md`, `docs/manual.md`, `CHANGELOG.md`, `CHANGELOG.en.md`, `package.json`, `package-lock.json`, `.claude/skills/run-app/screens.mjs`, `.claude/skills/run-app/SKILL.md` | – (Verhalten aus Spec) |
| 2 | **2A Hauptfenster** | `src/renderer/src/App.tsx`, `src/renderer/src/styles.css` (`.no-terminals` weg) | 1A, 1B, 1C |
| 2 | **2C Nebenfenster** | `src/renderer/src/SecondaryWindow.tsx` | 1A, 1C |

Gate nach jeder Welle: `npm run typecheck`, `npx vitest run`. Nach Welle 1 schlagen `i18n-catalog` (verwaiste/fehlende Keys bis 2A) und `typecheck` (neue `DesktopApi`-Methoden ohne Nutzer sind erlaubt; `WelcomePage`-Import in `App.tsx` bleibt bis 2A) nur dort an, wo 2A den Vertrag schließt – die Validierung sollte das Gate für Welle 1 auf `typecheck` plus die Tests der geänderten Module begrenzen oder 1C die alten Keys erst in 2A löschen lassen. Empfehlung: **1C behält `dialogs.lockVault`, `dialogs.confirmLock`, `home.autoLocked_*` und 2A löscht sie** – dann ist jede Welle vollständig grün. Nach Welle 2: run-app nach Abschnitt 6.

