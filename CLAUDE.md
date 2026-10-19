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

## Texte (verbindlich)

- UI-Texte stehen nie als Literal im Code, sondern nur über `t()`/`useT()` aus `src/renderer/src/i18n.ts`. Der Main-Prozess nutzt ausschließlich `mainT`, Fehler gehen als `AppError`-Codes zum Renderer.
- Neue Keys immer in de-DE und en-US anlegen (`src/shared/locales/`), mit Namespace-Präfix und ohne dynamische Key-Zusammensetzung (Maps mit vollen Literalen).
- `src/shared/locales/i18n-catalog.test.ts` setzt das durch (Parität, Platzhalter, verwaiste Keys, deutsche Literale im Code). Ausnahmen nur mit `i18n-ignore` und kurzem Grund.
- Zahlen, Daten und Sortierung nur über `src/shared/format.ts`, nie `localeCompare` oder `new Intl.*` in Komponenten.

## Prüfen

- `npm run typecheck` und `npx vitest run` müssen vor jedem Commit grün sein.
- Specs liegen in `docs/superpowers/specs/`, Pläne in `docs/superpowers/plans/`. Validierungs-Anhänge (`…-validation.md`) sind bindend.
