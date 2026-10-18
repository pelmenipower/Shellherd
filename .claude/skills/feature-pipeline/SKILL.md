---
name: feature-pipeline
description: Pflicht-Ablauf für jedes neue Feature und jede größere Änderung in Terminus. Fable konzipiert, Opus validiert, Sonnet baut parallel in Wellen, Opus prüft. Laden, sobald etwas gebaut, erweitert oder umgebaut werden soll (nicht für Ein-Zeilen-Fixes).
---

# Feature-Pipeline für Terminus

Dieser Ablauf gilt für jedes Feature. Zwischen den Stufen fragst du nicht nach Freigabe („frag nicht nach, mach es selber“). Entscheidungen hältst du als `Ruling: <was> — <warum> — <Kosten, falls falsch>` im Ledger fest und nennst sie am Ende. Nur vier Dinge halten an: unumkehrbare oder destruktive Schritte, Sicherheitsfragen, Seiteneffekte außerhalb des Repos, die man normalerweise vorher abstimmt, und ein Plan, bei dem jeder Weg nur geraten wäre.

## Agenten (feste Modelle)

| Agent | Modell | Aufgabe |
|---|---|---|
| `konzept` | Fable | Analyse und Empfehlung |
| `pruefer` | Opus | Spec validieren, Review, Nachprüfung |
| `umsetzer` | Sonnet | eine Task auf zugewiesenen Dateien |

Beim Agent-Aufruf immer `subagent_type` auf einen dieser drei setzen. Ein anderes Modell ist nur erlaubt, wenn der Nutzer es ausdrücklich verlangt.

## Ablauf

1. **Branch:** `claude/feature/<thema>` vom aktuellen Stapel-Ende. Für jedes Feature lege ein Ledger an: `.superpowers/sdd/<datum>-<thema>/progress.md`.
2. **Konzept** (`konzept`): Recherche und Empfehlung nach `.superpowers/sdd/<thema>-research.md`.
3. **Spec und Plan** (du):
   - Lege den Umfang fest (erste Stufe gegenüber Extras) und schreibe `docs/superpowers/specs/<datum>-<thema>-design.md`.
   - Ist das Feature größer, kommt `docs/superpowers/plans/<datum>-<thema>.md` mit Wellen dazu.
   - Commit: `docs(<scope>): design …`.
4. **Validierung** (`pruefer`): erzeugt `…-validation.md` mit Vertrag, Blockern, Korrekturen und Wellen. Übernimm sie bindend und committe sie.
5. **Umsetzung** (`umsetzer`, so viele parallel wie möglich):
   - Je Welle getrennte Dateien. Jeder Auftrag nennt die Spec-Pflichtpunkte, die eigenen Dateien, „kein Commit“ und eine Report-Datei.
   - **Prüfung nach jeder Welle:** `npm run typecheck` und `npx vitest run` müssen grün sein. Danach committest du pro Task.
   - Bedenken der Umsetzer kommen als Minor ins Ledger.
6. **Doku:** README-Abschnitt, CHANGELOG-Eintrag und Version (`npm run version:minor`) im selben Task, sonst bricht `version.test.ts`.
7. **Review** (`pruefer`) des ganzen Branches.
8. **Fix-Welle** (`umsetzer`, ein Agent oder zwei auf getrennten Dateien). Danach eine **Nachprüfung** (`pruefer`). Es gibt keine zweite Fix-Welle, Restbefunde gehen an den Nutzer.
9. **Abschluss:**
   - Push, dann ein gestapelter PR auf git.example über die Gitea-API mit `git credential fill`. Basis ist der vorige Feature-Branch.
   - Danach merge in den lokalen Teststand `claude/feature/disable-connections`, dort noch einmal Typecheck und Tests.
   - Zum Schluss eine Zusammenfassung für den Nutzer mit allen Rulings und den offenen Punkten für den manuellen Test.

## Regeln aus Erfahrung

- **Keine Worktrees mit `node_modules`-Junction.** `git worktree remove` löscht dabei das Ziel. Arbeite stattdessen im Hauptbaum, nacheinander je Branch.
- **Agenten löschen nichts außerhalb ihrer Task,** auch keine unversionierten Dateien.
- **Nichts Veränderndes gegen den echten Cluster,** auch nicht zum Testen. Verändernde Aktionen werden in der Abnahme nur bis zum Dialog geprüft.
- **Commit-Format** nach `~/.claude/CLAUDE.md` (`type(scope): summary`, What/Why, Bullets), ohne Co-Authored-By-Zeile.
