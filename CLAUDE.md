# Terminus – Regeln für Claude

Electron-44-App (TypeScript, React 19, xterm, ssh2, `@kubernetes/client-node`). UI-Texte auf Deutsch, Code-Kommentare auf Englisch.

## Arbeitsweise (verbindlich)

**Jedes neue Feature und jede größere Änderung läuft über den Skill `feature-pipeline`.** Fable konzipiert, Opus validiert die Spec, Sonnet setzt parallel in Wellen um, Opus prüft. Die Agenten mit festen Modellen liegen in `.claude/agents/` (`konzept`, `pruefer`, `umsetzer`). Zwischen den Stufen gibt es keine Rückfragen. Entscheidungen werden als Rulings festgehalten und am Ende genannt.

Ausnahme sind kleine, klar umrissene Fehlerbehebungen (eine Ursache, wenige Zeilen). Sie gehen direkt nach `superpowers:systematic-debugging`, test-first, ohne Pipeline.

## Prüfen

- `npm run typecheck` und `npx vitest run` müssen vor jedem Commit grün sein.
- Specs liegen in `docs/superpowers/specs/`, Pläne in `docs/superpowers/plans/`. Validierungs-Anhänge (`…-validation.md`) sind bindend.
