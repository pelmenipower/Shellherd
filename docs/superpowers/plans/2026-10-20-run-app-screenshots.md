# run-app: Screenshots aller Komponenten – Plan

Spec: `docs/superpowers/specs/2026-10-20-run-app-screenshots-design.md` (Modulvertrag in Abschnitt 4, Fixtures in 2.x, Szenario in 3).

Gate nach jeder Welle: `npm run typecheck` und `npx vitest run` grün, danach ein Commit pro Task. Umsetzer schreiben nur die genannten Dateien, committen nie.

## Welle 1 – fünf Tasks parallel

| Task | Dateien |
|---|---|
| 1A SSH-Testserver | `.claude/skills/run-app/sshd.mjs`, `.claude/skills/run-app/fixtures.mjs` |
| 1B Kubernetes-Fake | `.claude/skills/run-app/kube-fake.mjs`, `.claude/skills/run-app/kube-fixtures.mjs` |
| 1C KI-Fake | `.claude/skills/run-app/ai-fake.mjs` |
| 1D Demo-Vault | `.claude/skills/run-app/demo-setup.mjs` |
| 1E Selbsttest | `.claude/skills/run-app/fakes.test.mjs`, `vitest.config.ts` (eine Zeile) |

## Welle 2 – drei Tasks parallel

| Task | Dateien |
|---|---|
| 2A Szenario | `.claude/skills/run-app/screens.mjs` (sechs Pflichtbilder, Spec S2) |
| 2B Doku | `.claude/skills/run-app/SKILL.md` |
| 2C README | `README.md` (ein Halbsatz im Abschnitt „Driving the app") |

## Welle 3 – Gesamtlauf (1 Task)

Build, `drive:sshd`, `drive`, `demo-setup.mjs` auf frischem Profil, `screens.mjs`, alle PNGs ansehen, Gate. Korrekturen nur in der Datei des jeweiligen Fehlers.
