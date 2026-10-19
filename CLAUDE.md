# Shellherd – Regeln für Claude

Electron-44-App (TypeScript, React 19, xterm, ssh2, `@kubernetes/client-node`). UI-Texte auf Deutsch, Code-Kommentare auf Englisch.

## Arbeitsweise (verbindlich)

**Jedes neue Feature und jede größere Änderung läuft über den Skill `feature-pipeline`.** Fable konzipiert, Opus validiert die Spec, Sonnet setzt parallel in Wellen um, Opus prüft. Die Agenten mit festen Modellen liegen in `.claude/agents/` (`konzept`, `pruefer`, `umsetzer`). Zwischen den Stufen gibt es keine Rückfragen. Entscheidungen werden als Rulings festgehalten und am Ende genannt.

Ausnahme sind kleine, klar umrissene Fehlerbehebungen (eine Ursache, wenige Zeilen). Sie gehen direkt nach `superpowers:systematic-debugging`, test-first, ohne Pipeline.

## Design (verbindlich)

- Jede Oberfläche folgt `docs/design-system.md`. Farben, Abstände, Radien, Schrift, Ebenen, Schatten und Bewegung kommen ausschließlich als `var(--…)` aus `src/renderer/src/tokens.css`. Keine harten Werte in Komponenten-CSS oder Inline-Styles (Inline nur für berechnete Geometrie).
- Fehlt ein Wert, kommt er zuerst als Token in `tokens.css` (mit Rolle), nie als Einzelwert in eine Komponente.
- Bewegung nur mit Eintrag im Motion-Gate der Doku: nur `transform`/`opacity`, Kurven und Dauern aus den Tokens, `prefers-reduced-motion` in derselben Datei, nie auf per Tastatur ausgelöste oder 100-mal-am-Tag-Aktionen.
- `src/renderer/src/design-tokens.test.ts` setzt das durch und läuft mit `npx vitest run`.

## Prüfen

- `npm run typecheck` und `npx vitest run` müssen vor jedem Commit grün sein.
- Sichtbare Änderungen zusätzlich in der echten App prüfen: Skill `run-app` (`.claude/skills/run-app/SKILL.md`). Er startet die App isoliert mit synthetischem Demo-Vault und lokalem SSH-Testserver und macht Screenshots. Echte Vaults und `%APPDATA%\Shellherd` werden dabei nie geöffnet.
- Specs liegen in `docs/superpowers/specs/`, Pläne in `docs/superpowers/plans/`. Validierungs-Anhänge (`…-validation.md`) sind bindend.
