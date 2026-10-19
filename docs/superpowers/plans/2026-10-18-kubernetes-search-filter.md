# Kubernetes – Suchen und Filtern Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:**
- Suche mit Qualifiern und Status-Chips (OR innerhalb einer Gruppe, AND zwischen Gruppen) in jedem Reiter des Cluster-Tabs.
- Filter bleiben je Reiter erhalten, werden im Workspace gespeichert und zeigen „N von M“.

**Architecture:**
- Zwei reine Shared-Module, beide auch für Main nutzbar:
  - `src/shared/kube-filter.ts` (Parser und kompiliertes Prädikat)
  - `src/shared/kube-status.ts` (Chips je Kind, Status-Mengen)
- Der Reducer hält Filter je Kind.
- Die UI rendert eine Chip-Leiste mit Zählern.
- Main liefert die fehlenden Status-Zellen.

**Spec:** `docs/superpowers/specs/2026-10-18-kubernetes-search-filter-design.md` (bindend; Abschnitte 2–5 sind die Anforderungen, Abschnitt 6 die Zerlegung). Nach der Opus-Validierung gilt zusätzlich `…-validation.md` vorrangig.

## Global Constraints

- **Keine neuen Abhängigkeiten.** UI-Texte auf Deutsch, Kommentare auf Englisch, knapp wie im bestehenden Code.
- **Chips:** Labels und IDs exakt wie in Spec Abschnitt 2. Suche immer case-insensitive. Kein Debounce, kein Highlighting.
- **Hotkeys und Bindungen:** neu `w` und `F`. `KUBE_COMMANDS` darf keine Bindung doppelt vergeben, das prüft der bestehende Test.
- **Snapshot:** Alte Workspace-Snapshots ohne Filter bleiben gültig, unbekannte Chip-IDs werden beim Wiederherstellen verworfen.
- **Sicherheit:** Filter und Suche ändern nichts am Cluster. Sie wirken nur auf Zeilen, die der Renderer schon hat.
- **Befehle:** `npm test`, `npm run typecheck`. Agenten committen nicht, der Orchestrator committet pro Task (Format laut `~/.claude/CLAUDE.md`, ohne Co-Authored-By-Zeile).
- **Branch:** `claude/feature/kubernetes-search-filter`. Version `0.7.0`.

## Review Focus

1. Die ausgewählte Zeile wird durch Chip oder Suche verborgen, während Live-Updates eintreffen: Auswahl und Dock verhalten sich wie in Spec 4.1 und 5 (T4).
2. Ein Event wird über `message` oder `reason` gefunden, nicht über den eigenen Namen (T1).
3. Der Reiterwechsel hin und zurück behält Chips und Text je Reiter. `jump` aus dem Problem-Hinweis zeigt das Ziel trotz aktivem Chip (T4).
4. Bei Pods fällt jeder Status in höchstens einen Status-Chip, und `tone bad` gilt genau dann, wenn der Chip `failed` greift (T2).
5. Workspace mit alten Snapshots und mit unbekannten Chip-IDs (T2/T4).

## Wellen

| Welle | Tasks (parallel) |
|---|---|
| 1 | Task 1 (Filter-Modell), Task 2 (Status-Chips + Shared-Typen) |
| 2 | Task 3 (Main-Zeilen), Task 4 (Reducer) |
| 3 | Task 5 (Befehle + Hilfe), Task 6 (Menüs) |
| 4 | Task 7 (UI) |
| 5 | Task 8 (Doku, Version 0.7.0) |

### Task 1: Filter-Modell
Spec-Zeile T1 in Abschnitt 6, dazu Spec 3.1–3.3 und 5. Dateien: `src/shared/kube-filter.ts` und Test. Tests laut Spec „Tests (Pflicht je Aufgabe)“ T1. Die exakte API (`KubeFilter`, `compileFilter`, `searchText`, `SEARCH_HELP`) legt die Spec 2.1/3 fest. Fehlt dort ein Detail, entscheidet der Agent und dokumentiert es im Report.

### Task 2: Status-Chips und Shared-Typen
Spec-Zeile T2, Spec 2.1–2.9. Dateien: `src/shared/kube-status.ts` und Test, `src/shared/kubernetes.ts` (Snapshot-Typ mit Filtern, Jobs-Spalte `status`, `KubeRow.pressure`), `src/shared/kubernetes-schema.ts` und Test. Tests laut Spec T2.

### Task 3: Main-Zeilen
Spec-Zeile T3. Dateien: `src/main/kubernetes/rows.ts` und Test. Tests laut Spec T3.

### Task 4: Reducer
Spec-Zeile T4, Spec 4.1–4.3 und 5. Dateien: `src/renderer/src/kube-view.ts` und Test. Tests laut Spec T4.

### Task 5: Befehle und Hilfe
Spec-Zeile T5, Spec 4.4–4.5, dazu `F` und `:filter`. Dateien: `src/renderer/src/kube-commands.ts` und Test, `components/kubernetes/HelpOverlay.tsx`. Tests laut Spec T5.

### Task 6: Menüs
Spec-Zeile T6, Spec 4.6, ohne „Ähnliche ausblenden“ und ohne „In der Tabelle zeigen“ im Problem-Hinweis. Dateien: `src/renderer/src/kube-menus.ts` und Test. Tests laut Spec T6.

### Task 7: UI
Spec-Zeile T7, Spec 4.3, ohne Punkt am Reiter. Dateien: `components/kubernetes/ResourceTable.tsx`, `ClusterView.tsx`, `src/renderer/src/kubernetes-ui.css`.

### Task 8: Doku
Spec-Zeile T8. Dateien: `README.md`, `CHANGELOG.md` (0.7.0, `npm run version:minor`) und die Spec-Anpassungen aus T8.
