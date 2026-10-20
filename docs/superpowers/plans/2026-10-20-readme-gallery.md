# README-Galerie aus run-app – Plan

Spec: `docs/superpowers/specs/2026-10-20-readme-gallery-design.md`. Gate nach jeder Welle: `npm run typecheck` und `npx vitest run`. Umsetzer committen nicht.

## Welle 1 – drei Tasks parallel

| Task | Dateien |
|---|---|
| 1A Flag | `.claude/skills/run-app/screens.mjs` |
| 1B Galerie | `README.md` |
| 1C Regeln | `.claude/skills/run-app/SKILL.md`, `.claude/skills/feature-pipeline/SKILL.md` |

## Welle 2 – Gesamtlauf (1 Task)

Build, `drive:sshd`, `drive`, `demo-setup.mjs`, `screens.mjs --readme` mit `SHELLHERD_RUN_DIR` außerhalb des Profils; die fünf neuen PNGs in `docs/images/` ansehen; nur diese fünf Dateien kommen dazu.
