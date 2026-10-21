# README-Galerie aus run-app – Design

Auftrag (vom Nutzer bestätigt): `screens.mjs --readme` kopiert die Bilder nach `docs/images/`, die README bekommt eine Galerie (SFTP, Container, Kubernetes, Einstellungen, Assistent), und die Feature-Pipeline zieht die README-Feature-Liste mit. Feature-Texte werden nicht generiert. Grundlage ist das Konzept `.superpowers/sdd/readme-gallery-research.md`, das hier vollständig als Spec gilt (Abschnitte unten). Plan: `docs/superpowers/plans/2026-10-20-readme-gallery.md`.

## Spec-Rulings (Stufe 3)

- **R1** Die drei vorhandenen README-Bilder bleiben, wie sie sind; keine Szenario-Blöcke für sie (★-Extra).
- **R2** `ai-settings` bleibt Review-Bild und kommt nicht in die README.
- **R3** Keine Tests, keine Version, kein CHANGELOG (Tooling und Doku, wie PR #6).
- **R4** Der Gesamtlauf läuft mit `SHELLHERD_RUN_DIR` außerhalb des Benutzerprofils; jedes PNG wird vor dem Commit angesehen.

## 1. Bestand und Lücken

| Was | Wo | Befund |
|---|---|---|
| Szenario-Skript | `screens.mjs:1-3` (Usage), `:36` (`shot` = `/ss?name=…&crop=status`), `:65` (`shots[]`), `:133-147` (Argumente, Schleife, Ausgabe) | Schreibt sechs PNGs nach `%TEMP%\shellherd-run\shots`. Kein Weg ins Repo; Argumente sind nur Blocknamen, ein unbekanntes Argument bricht mit Exit 2 ab (`:134-135`). |
| Repo-Pfad | `driver.mjs:11` (`REPO = path.resolve(import.meta.dirname, '../../..')`) | Muster vorhanden, in `screens.mjs` noch nicht. |
| Statusleiste abschneiden | `driver.mjs:56` (`STATUS_BAR = 26`), `:63-70` | `crop=status` liefert 1440×874 bei Viewport 1440×900. |
| Bestehende README-Bilder | `docs/images/screenshot-{terminals,connection-error,notice}.png`, je 1440×874, 47–58 KB | Alle drei sind **1440×874, also mit `crop=status`** gemacht. Commit `c23eefb` (19.10., 16:09) hat sie von Hand per Treiber aufgenommen (`curl …/ss?name=…&crop=status`), **ohne Szenario-Block** – `screens.mjs` entstand erst in PR #6 (`8095855`, 20.10.). Inhalt: Demo-Vault `web-01/db-main/legacy-app/Staging`, Workspace „Produktion“, nur synthetische Daten (`demo@web-01`, `127.0.0.1`). |
| README | `README.md:18-31` (Hero + 2×2-Tabelle mit `<sub>`-Bildunterschriften), `:35-47` (Feature-Liste), `:92-106` (Driving the app, Zeile 101 nennt `screens.mjs`) | Keine Bilder von SFTP, Containern, Kubernetes, Einstellungen, Assistent. Alt-Texte englisch. |
| Skill-Doku | `run-app/SKILL.md:23` (Aufruf), `:33` (Dateinamen), `:96` (Stolperstein „README-Screenshots immer mit crop=status“) | `--readme` fehlt. |
| Pipeline | `feature-pipeline/SKILL.md:33` (Schritt 6: „die README bleibt ein englischer Kurzüberblick“) | Keine Pflicht, die Feature-Liste mitzuziehen. |
| Aktuelle Komponentenbilder (lokaler Lauf 20.10., 09:51) | `%TEMP%\shellherd-run\shots\{sftp,containers,kubernetes,settings,ai-settings,assistant}.png` | 1440×874, 84–135 KB. `sftp.png` zeigt lokal `C:\Users\Public\shellherd-demo-local` (Fallback aus `screens.mjs:55`), kein Benutzername. Seitenleiste ohne „Dieser Computer“. |

## 2. Empfehlung

### 2.1 `screens.mjs --readme` ★★★ – nur Skript, ~6 Zeilen

- **Feste Namen** nach dem vorhandenen Muster `docs/images/screenshot-<block>.png`: `screenshot-sftp.png`, `screenshot-containers.png`, `screenshot-kubernetes.png`, `screenshot-settings.png`, `screenshot-assistant.png`. Keine Map nötig – Zielname = `screenshot-` + Basisname des Shots.
- **Umfang:** nur diese fünf. `ai-settings.png` bleibt Review-Bild im Shots-Ordner (die README zeigt die Anbieterliste nicht; der Nutzer hat fünf Flächen genannt). Dafür ein `const README_SHOTS = new Set(['sftp', 'containers', 'kubernetes', 'settings', 'assistant'])`.
- **Argumente:** `--readme` wird aus `wanted` herausgefiltert, bevor die Unbekannt-Prüfung (`:134`) läuft. Blocknamen bleiben kombinierbar (`screens.mjs --readme kubernetes` erneuert nur ein Bild).
- **Kopieren:** nach der Schleife, nur für Dateien in `shots` (also nur erfolgreiche Blöcke; `shots.push` steht hinter dem `/ss`-Aufruf, `:36`). `fs.copyFileSync(file, path.join(REPO, 'docs/images', 'screenshot-' + path.basename(file)))`, `REPO` wie `driver.mjs:11`. Je Kopie eine Ausgabezeile mit dem Zielpfad. Exit-Code bleibt wie bisher (1, wenn ein Block fehlte) – ein halber Satz Bilder ist im `git status` sichtbar und damit kein stilles Problem.
- **Usage-Kommentar** `:2` ergänzen: `[--readme]  kopiert die fünf README-Bilder nach docs/images/`.
- **Nicht:** kein Resize, keine PNG-Optimierung, keine neue Abhängigkeit, kein automatischer Commit, kein Vergleich mit dem Bestand.

### 2.2 README-Galerie ★★★ – nur README

- **Ort:** neuer Abschnitt `## Screenshots` **nach** `## Features` (vor `## Installation`). Oben bleiben Hero und die 2×2-Tabelle wie sie sind; acht Bilder vor dem ersten Satz wären zu viel, und die Galerie illustriert die Feature-Liste direkt darüber.
- **Layout wie vorhanden:** Kubernetes als volle Breite (dichte Tabelle, braucht Platz), darunter eine 2×2-Tabelle im Muster von `README.md:22-31` (`<td width="50%">`, Zeile mit `<sub>`-Unterschriften):

```html
## Screenshots

<p align="center">
  <img src="docs/images/screenshot-kubernetes.png" alt="Kubernetes view of a production cluster: node tiles with CPU and RAM, a problem banner and the pod table" width="100%">
</p>
<p align="center"><sub>Kubernetes: live nodes, workloads and pods; production clusters are framed in red</sub></p>

<table>
  <tr>
    <td width="50%"><img src="docs/images/screenshot-sftp.png" alt="Two-pane SFTP file browser with a local folder on the left and the remote home directory on the right"></td>
    <td width="50%"><img src="docs/images/screenshot-containers.png" alt="Container view of an SSH host with six Docker containers grouped by Compose project"></td>
  </tr>
  <tr>
    <td align="center"><sub>SFTP file browser, two panes with a transfer queue</sub></td>
    <td align="center"><sub>Docker containers per SSH host</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/images/screenshot-settings.png" alt="Settings dialog with language, file association, disconnect confirmation and AI providers"></td>
    <td width="50%"><img src="docs/images/screenshot-assistant.png" alt="AI assistant panel next to a terminal, suggesting a command with a Type in button"></td>
  </tr>
  <tr>
    <td align="center"><sub>Settings in one place</sub></td>
    <td align="center"><sub>AI assistant: explains output and suggests the next command, nothing runs on its own</sub></td>
  </tr>
</table>
```

- **Development-Abschnitt** `README.md:101`: Kommentar wird zu `# SFTP, containers, Kubernetes, settings and assistant screenshots; --readme refreshes docs/images/`. Satz `:106` „the README screenshots were taken this way“ bleibt wahr.
- **Alt-Texte** englisch, beschreibend, ohne „Screenshot of“.

### 2.3 Pipeline Schritt 6 ★★ – nur `feature-pipeline/SKILL.md:33`

Neuer Wortlaut (ersetzt die Zeile):

> 6. **Doku:** Abschnitt in `docs/handbuch.md`, CHANGELOG-Eintrag und Version (`npm run version:minor`) im selben Task, sonst bricht `version.test.ts`. Die README bleibt ein englischer Kurzüberblick: bei neuen oder sichtbar geänderten Features die Feature-Liste in `README.md` (ein Punkt je Feature) von Hand anpassen, nie generieren. Zeigt ein README-Bild die geänderte Fläche (SFTP, Container, Kubernetes, Einstellungen, Assistent), die Bilder mit `node .claude/skills/run-app/screens.mjs --readme` neu erzeugen und mitcommitten.

Dazu `run-app/SKILL.md`: `:23` Aufruf um `[--readme]` ergänzen, `:33` Satz „Mit `--readme` landen `sftp`, `containers`, `kubernetes`, `settings` und `assistant` zusätzlich als `docs/images/screenshot-<name>.png` im Repo.“, `:96` Stolperstein bleibt und bekommt den Zusatz „`--readme` tut das automatisch“.

### 2.4 Die drei bestehenden Bilder per `--readme`? ★ – nicht jetzt

Fehlende Blöcke und ihr Preis:

| Bild | Nötiger Block | Aufwand |
|---|---|---|
| `screenshot-terminals.png` | `web-01` verbinden, Bereich teilen (`aria-label^="Layout für Bereich"` → „Nebeneinander teilen“, `SplitTerminalArea.tsx:372-380`), zweites `web-01` in den neuen Bereich, vier Befehle tippen, Workspace „Produktion“ als aktiv | ~15 Zeilen, zustandslos |
| `screenshot-connection-error.png` | `legacy-app` verbinden, auf Fehlerkarte warten | ~5 Zeilen, zustandslos |
| `screenshot-notice.png` | drei Tabs öffnen, `details.workspace-menu` → „Speichern unter“ → Name „Produktion“ → Speichern (`WorkspaceControls.tsx:64-73, 97-103`) | ~10 Zeilen, **ändert den Demo-Vault**: beim zweiten Lauf gibt es „Produktion“ schon, der Block braucht eine Weiche (vorhanden → nur `.workspace-save`, sonst Speichern unter) |

Entscheidung: **nicht in dieser Stufe.** Die drei Bilder sind einen Tag alt, synthetisch, bereits `crop=status`, und die Flächen (Terminal, Fehlerkarte, Hinweis) haben sich seit `c23eefb` nicht sichtbar geändert. Der Nutzen käme erst, wenn diese Flächen umgebaut werden; dann kosten die Blöcke `terminals` und `error` zusammen 20 Zeilen und kommen in derselben Form (Block + Eintrag in `README_SHOTS`) dazu. `notice` lohnt wegen des Vault-Zustands auch dann nur, wenn der Hinweis selbst umgebaut wird. Das kommt als Hinweis in `run-app/SKILL.md:33` („Die drei älteren README-Bilder entstanden von Hand per `/ss`“).

## 3. Bildgröße, Dateigröße, Datenschutz

- **Format:** PNG, 1440×874 wie die drei vorhandenen (Viewport 1440×900 minus Statusleiste). GitHub skaliert auf ~830 px Inhaltsbreite; 1440 px bleibt auf HiDPI scharf. Kein Resize, keine Breitenangabe außer `width="100%"` für das Kubernetes-Bild.
- **Größe:** Messung vom 20.10.: sftp 85 KB, containers 102 KB, kubernetes 119 KB, settings 114 KB, assistant 84 KB → ~0,5 MB je Satz. Jede Auffrischung legt ~0,5 MB in die Git-Historie. Akzeptabel; keine Optimierung (`oxipng`/`pngquant` wären eine Abhängigkeit, ★ Extra, erst wenn das Repo spürbar wächst).
- **Datenschutz (bindend aus der Validierung, Abschnitt „Sicherheit“ und X4):**
  - `crop=status` ist in `shot()` fest (`screens.mjs:36`), die Statusleiste mit dem Vault-Pfad fehlt also immer.
  - Lokale SFTP-Spalte zeigt `<RUN_DIR>\local` oder `%PUBLIC%\shellherd-demo-local`, nie das Benutzerprofil (`screens.mjs:52-63`). Für den Galerie-Lauf `SHELLHERD_RUN_DIR=C:\shellherd-run` setzen (sauberer Pfad `C:\shellherd-run\local`); der Public-Fallback ist zulässig, zeigt aber „Users \ Public“.
  - Alle Daten sind synthetisch: `demo@127.0.0.1:2222`, Cluster-Fixtures, KI-Fake. Kein Hostname, kein Schlüssel, kein echter Vault.
  - **Sichtprüfung Pflicht:** Jedes der fünf PNGs per Read ansehen, bevor es committet wird (`SKILL.md:35`). Besonders: Seitenleiste ohne „Dieser Computer“ (erscheint bei lokal installiertem Docker, `SKILL.md:100`) – ist der Knoten da, ist das kein Datenleck, aber das Bild zeigt dann eine Fläche, die die Doku nicht erklärt; Lauf auf einem Rechner ohne Docker Desktop oder Knoten hinnehmen und im Ledger vermerken.

## 4. Tests, Version, CHANGELOG

- **Tests: keine neuen.** Die Änderung in `screens.mjs` ist ein Argumentfilter und ein `copyFileSync`-Loop; `screens.mjs` läuft beim Import los (kein `isMain`-Schutz, `:129-131`) und ist nicht testbar, ohne es umzubauen. `fakes.test.mjs` bleibt unberührt. `i18n-catalog.test.ts` scannt nur `src/` (`:28-32`), `design-tokens.test.ts` nur CSS – keine Wirkung. Gate wie immer: `npm run typecheck`, `npx vitest run`.
- **Version/CHANGELOG: nein.** Keine Änderung an der App; `package.json`, `CHANGELOG*.md`, `docs/handbuch.md` bleiben unberührt (Präzedenz: PR #6 „run-app-screenshots“ ohne Bump, Validierung „Kein Task ändert `src/`, `package.json`, CHANGELOG oder Handbuch“). `version.test.ts` schlägt nur bei Bump ohne CHANGELOG-Abschnitt an.
- **App-Prüfung:** Der Gesamtlauf in Welle 2 ist die Prüfung.

## 5. Regeln und Risiken – was nicht getan wird

- Kein Feature-Text wird erzeugt oder generiert; Schritt 6 verlangt nur das Mitziehen von Hand.
- `screens.mjs --readme` committet nicht und löscht nichts; es überschreibt nur die fünf festen Dateinamen.
- Keine Änderung an `driver.mjs`, `demo-setup.mjs`, Fakes, `src/`.
- Keine Bildbearbeitung, keine Abhängigkeit, kein CI-Schritt (CI hat keinen Desktop; ein Vergleich „Bilder aktuell?“ wäre flaky und nicht verlangt).
- Risiko „halber Satz“: Fällt ein Block aus (z. B. kein openssl → kein `prod-k8s`, `screens.mjs:88`), fehlt dessen Bild im Repo oder bleibt alt. Sichtbar im `git status`; der Gesamtlauf-Task bricht ab, wenn nicht genau fünf Dateien neu sind.
- Risiko Vault-Zustand: `demo-setup.mjs` hinterlässt ggf. den Einstellungsdialog, `closeTabs()` fängt das (`screens.mjs:39-43`). Mit neuem `SHELLHERD_RUN_DIR` entsteht ein neuer Vault; Host-Schlüssel und `known-hosts.json` gehören dann zum neuen Ordner (`SKILL.md:97-98`).

## 6. Zerlegung in Tasks und Wellen

Dateien je Task disjunkt. Umsetzer committen nicht.

**Welle 1 (parallel, 3 Tasks)**

| Task | Dateien (nur diese) | Inhalt |
|---|---|---|
| 1A Skript | `.claude/skills/run-app/screens.mjs` | 2.1: `REPO`, `README_SHOTS`, `--readme`-Filter vor `:134`, Kopierschleife nach `:146`, Usage-Kommentar `:2`. Prüfung: `node --check`, `node screens.mjs --readme nix` muss „Unbekannter Block: nix“ melden (Treiber darf fehlen → Exit 2 „Treiber nicht erreichbar“ ist dann vorher; reicht `node --check` plus Lesen). |
| 1B README | `README.md` | 2.2: Abschnitt `## Screenshots` nach Features, Kommentar in `:101`. |
| 1C Skill-Doku | `.claude/skills/run-app/SKILL.md`, `.claude/skills/feature-pipeline/SKILL.md` | 2.3 und Hinweis aus 2.4. |

Gate: `npm run typecheck`, `npx vitest run` (unverändert grün erwartet, 121 Dateien). Commits je Task: `feat(run-app): screens.mjs --readme copies the gallery images`, `docs(readme): screenshot gallery`, `docs(claude): README feature list and gallery in pipeline step 6`.

**Welle 2 (1 Task, nacheinander): Galerie-Lauf**

1. `npx electron-vite build`.
2. `SHELLHERD_RUN_DIR=C:\shellherd-run` für alle drei Prozesse setzen; dort `profile\demo.term` und `profile\Shellherd\known-hosts.json` löschen, falls vorhanden.
3. `npm run drive:sshd` (drei „ready“-Zeilen, sonst Abbruch – ohne `kube-fake ready` fehlt `prod-k8s`).
4. `npm run drive`, dann `demo-setup.mjs` (Meldung mit `prod-k8s` und `Demo-KI`).
5. `node .claude/skills/run-app/screens.mjs --readme` → Exit 0, fünf Zeilen mit `docs/images/…`.
6. Jedes der fünf PNGs mit Read ansehen; Pflichtinhalt wie Validierung PR #6 („Abnahme der Bilder“), zusätzlich: kein Benutzername, keine Statusleiste, 1440×874.
7. `git status` zeigt genau fünf neue Dateien unter `docs/images/`. Commit `docs(readme): gallery screenshots from the demo vault`.
8. `/quit`, Testserver beenden (`SKILL.md:102`).

Abhängigkeit: Welle 2 braucht 1A (Kopie) und 1B (README zeigt die Namen); 1C ist unabhängig.

## 7. Minimale erste Stufe gegenüber Extras

**Stufe 1 (dieser Branch):** 2.1, 2.2, 2.3, Welle 2. Ergebnis: `screens.mjs --readme` erneuert fünf Bilder; README hat acht Bilder; die Pipeline zieht die Feature-Liste mit.

**Extras (nicht jetzt):**
- ★ Blöcke `terminals`, `error`, `notice` für die drei älteren Bilder (2.4), erst wenn diese Flächen umgebaut werden.
- ★ PNG-Optimierung, erst wenn die Historie durch Bildwechsel spürbar wächst.
- ★ `ai-settings.png` in die README, falls die Anbieterverwaltung ein eigenes Feature-Bild bekommen soll (dann in `README_SHOTS` aufnehmen und eine dritte Tabellenzeile).
