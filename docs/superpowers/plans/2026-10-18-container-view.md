# Container-Ansicht – Plan

Spec: `docs/superpowers/specs/2026-10-18-container-view-design.md`. Nach jeder Welle `npm run typecheck` und `npx vitest run`, danach ein Commit pro Task.
Jede Task arbeitet test-first und fasst nur ihre Dateien an. Kube-Dateien bleiben unverändert, außer einem fehlenden `export` laut R2. Wer so einen Export braucht, meldet ihn im Report. Welle 1 setzt ihn.

| Task | Welle | Dateien | Inhalt |
|---|---|---|---|
| T1 Vertrag | 1 | `src/shared/containers.ts`, `src/shared/containers-schema.ts` (+test), `src/shared/ipc.ts`, `src/shared/windows.ts`, `src/shared/vault/types.ts`, `src/shared/vault/schema.ts` (+test), `src/preload/index.ts`, `src/main/window-ipc.ts`, ggf. `export` in `src/renderer/src/kube-*.ts` | Spec 4 vollständig. Preload-Methoden `containersInventory`, `containersInspect`. Main-Handler gibt es noch nicht. |
| T2 Parser | 2 | `src/main/containers/inventory-parsers.ts` (+test) | Spec 5 Parser |
| T3 Befehle | 2 | `src/main/containers/commands.ts` (+test) | Spec 5 Befehle |
| T4 Spalten | 2 | `src/renderer/src/container-columns.ts` (+test) | Spec 6.2 Spalten, Filter, Facetten, Gruppen, `formatBytes` |
| T5 Chips/Registry/Texte | 2 | `src/renderer/src/container-status.ts`, `container-commands.ts`, `container-confirm.ts` (je +test) | Spec 6.2 Chips, 6.5 Registry und Dialogtexte |
| T6 Discovery/IPC | 3 | `src/main/containers/discovery.ts` (+test), `ipc.ts`, `validation.ts` | Spec 5 Discovery und IPC |
| T7 Reducer | 3 | `src/renderer/src/container-view.ts` (+test) | Spec 6.1–6.4 Zustand |
| T8 Menüs | 4 | `src/renderer/src/container-menus.ts` (+test), `container-menu-run.ts` | Spec 6.5 Menüs |
| T9 Komponenten | 5 | `src/renderer/src/components/containers/*.tsx`, `src/renderer/src/hooks/useContainerInventory.ts`, `src/renderer/src/containers-ui.css` | Spec 6.1–6.5 UI, Props aus Spec 4 |
| T10 Verdrahtung | 6 | `App.tsx`, `components/SplitTerminalArea.tsx`, `components/VaultTree.tsx`, `components/LocalContainers.tsx`, `terminal-tabs.ts` (+test), `terminal-layout.ts` (+test), ggf. `SecondaryWindow.tsx` | Spec 6.6 |
| T11 Doku/Version | 6 | `README.md`, `CHANGELOG.md`, `package.json`, `package-lock.json`, Container-Spec (Hinweis) | Spec 8 |
