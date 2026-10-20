# README-Galerie – Validierung

Spec: `2026-10-20-readme-gallery-design.md`, Plan: `../plans/2026-10-20-readme-gallery.md`. Dieser Anhang ist bindend und geht Spec und Plan vor.

**Urteil: ready after corrections** – 1 Blocker, 6 Korrekturen.

Geprüft gegen `screens.mjs`, `driver.mjs`, `run-app/SKILL.md`, `README.md`, `feature-pipeline/SKILL.md`, `LocalContainers.tsx`, `ContainerChildren.tsx` und die fünf aktuellen PNGs in `%TEMP%\shellherd-run\shots` (20.10., 09:51/09:58). Zeilenangaben der Spec stimmen. Die Zielnamen kollidieren nicht mit den drei vorhandenen Dateien in `docs/images/`.

## Blocker

**B1 „Dieser Computer“ ist ein Datenleck, kein Schönheitsfehler (Spec 3, letzter Punkt).**
`LocalContainers.tsx:19` rendert `ContainerChildren` direkt aufgeklappt. Ist Docker oder Podman lokal installiert, stehen die echten Laufzeiten, Container und Compose-Projekte des Rechners in der Seitenleiste, und damit in allen fünf Bildern (auch abgedunkelt hinter dem Einstellungsdialog). Die Spec sagt „kein Datenleck … hinnehmen und im Ledger vermerken“. Das gilt nicht.
**Fix:** Im `--readme`-Modus bricht `shot()` für README-Bilder ab, wenn `.local-containers` im DOM steht (Vertrag unten). Dann wird der Block nicht kopiert und das Skript endet mit Exit 1. Welle 2 läuft deshalb nur auf einem Rechner ohne lokale Docker- oder Podman-CLI. Ist eine vorhanden, bricht die Welle ab, und das kommt als offener Punkt an den Nutzer. Die Sichtprüfung bleibt zusätzlich Pflicht.

## Korrekturen

- **K1 Nur README-Bilder kopieren.** In Spec 2.1 steht „für Dateien in `shots`“. Das schließt `ai-settings.png` ein. Kopiert wird nur, wenn `README_SHOTS.has(path.basename(file, '.png'))`.
- **K2 Pfad aus `/ss` übernehmen.** `shot()` nimmt den Pfad, den der Treiber zurückgibt (`driver.mjs:69`), statt ihn selbst aus `SCREENSHOT_DIR` zu bauen. Sonst kopiert `--readme` alte Bilder aus früheren Läufen, wenn `SCREENSHOT_DIR` bei Treiber und Skript verschieden gesetzt ist. Im Shots-Ordner liegen solche Dateien bereits.
- **K3 Argumente vor dem Treiber prüfen.** Die Argumentprüfung (`:133-135`) kommt vor den Treiber-Check (`:129-131`). Dann liefert die Prüfung aus Task 1A `node screens.mjs --readme nix` ohne Treiber Exit 2 mit „Unbekannter Block: nix“. Die Bedingung wird `Object.hasOwn(blocks, name)` statt `name in blocks`, sonst gilt `toString` als Block.
- **K4 Bildtexte passend zu den Bildern** (README, wörtlich):
  - SFTP-Unterschrift: `SFTP file browser: local folder and server side by side` (eine Transfer-Warteschlange ist im Bild nicht zu sehen).
  - Container-Alt: `Container view of an SSH host with six Docker containers, their images, ports and Compose project` (das Bild zeigt „Keine Gruppierung“, die Container sind also nicht gruppiert).
  - Kubernetes-Unterschrift: `Kubernetes: live nodes, workloads and pods; production clusters are clearly marked`.
  - Assistent-Alt: `AI assistant panel next to a terminal, suggesting a command with buttons to type it in or copy it`.
  - Alle übrigen Texte bleiben wie in Spec 2.2.
- **K5 Pipeline-Schritt 6, endgültiger Wortlaut** (ersetzt `feature-pipeline/SKILL.md:33`):
  > 6. **Doku:** Abschnitt in `docs/handbuch.md`, CHANGELOG-Eintrag und Version (`npm run version:minor`) im selben Task, sonst bricht `version.test.ts`. Die README bleibt ein englischer Kurzüberblick: bei neuen oder sichtbar geänderten Features die Feature-Liste in `README.md` (ein Punkt je Feature) von Hand anpassen, nie generieren. Zeigt ein README-Bild die geänderte Fläche (SFTP, Container, Kubernetes, Einstellungen, Assistent), die Bilder mit `node .claude/skills/run-app/screens.mjs --readme` neu erzeugen, jedes ansehen und mitcommitten. Die drei älteren Bilder (Terminals, Fehlerkarte, Hinweis) entstehen von Hand per `/ss?…&crop=status` (Skill `run-app`).
- **K6 Stolperstein in `run-app/SKILL.md:100`**, neuer Wortlaut:
  > - **„Dieser Computer“** erscheint in der Seitenleiste, wenn Docker oder Podman lokal installiert ist, und zeigt dann echte lokale Container. Mit `--readme` bricht der Block in diesem Fall ab. README-Bilder nur auf einem Rechner ohne lokale Container-CLI aufnehmen.

## Vertrag `screens.mjs` (Task 1A)

```js
const REPO = path.resolve(import.meta.dirname, '../../..');
const README_SHOTS = new Set(['sftp', 'containers', 'kubernetes', 'settings', 'assistant']);

// shot(): the path comes from the driver; README images never show the real local container tree.
const shot = async name => {
  if (readme && README_SHOTS.has(name) && await evaluate(`!!document.querySelector('.local-containers')`))
    throw new Error('„Dieser Computer“ (lokale Container) in der Seitenleiste – kein README-Bild');
  shots.push(await call('ss', undefined, `?name=${name}&crop=status`));
};

// before the driver check (:129):
const args = process.argv.slice(2);
const readme = args.includes('--readme');
const wanted = args.filter(arg => arg !== '--readme');
const unknown = wanted.filter(name => !Object.hasOwn(blocks, name));
// … unchanged error message/exit 2, then driver check, then the loop over `wanted.length ? wanted : Object.keys(blocks)`

// after `for (const file of shots) console.log(file);`, before process.exit:
if (readme) for (const file of shots.filter(f => README_SHOTS.has(path.basename(f, '.png')))) {
  const target = path.join(REPO, 'docs', 'images', `screenshot-${path.basename(file)}`);
  fs.copyFileSync(file, target);
  console.log(`→ ${target}`);
}
```

- Usage-Zeile `:2` endet mit `[--readme]`. Darunter kommt eine Kommentarzeile: `// --readme copies sftp, containers, kubernetes, settings and assistant to docs/images/screenshot-<name>.png`. Kommentare sind englisch, Fehlertexte deutsch wie im übrigen Skript.
- Exit-Code wie bisher: 1, wenn ein Block fehlschlug (die erfolgreichen Bilder werden trotzdem kopiert), 2 bei unbekanntem Argument oder fehlendem Treiber oder Vault.
- `--readme` allein läuft über alle Blöcke, `--readme kubernetes` nur über `kubernetes`. Die Reihenfolge der Argumente ist egal.
- Nicht dazu gehören Resize, Optimierung, Commit und Löschen. Überschrieben werden nur die fünf festen Namen.

## Endgültige Wellen

| Welle | Task | Dateien (nur diese) | Inhalt |
|---|---|---|---|
| 1 | 1A Flag | `.claude/skills/run-app/screens.mjs` | Vertrag oben, B1, K1–K3. Prüfung: `node --check` und `node .claude/skills/run-app/screens.mjs --readme nix` ergibt Exit 2 mit „Unbekannter Block: nix“. |
| 1 | 1B Galerie | `README.md` | Spec 2.2 mit den Texten aus K4, Kommentar `:101` wie in Spec 2.2. |
| 1 | 1C Regeln | `.claude/skills/run-app/SKILL.md`, `.claude/skills/feature-pipeline/SKILL.md` | K5, K6, die Ergänzungen zu SKILL.md `:23`, `:33` und `:96` aus Spec 2.3, dazu der Hinweis aus Spec 2.4. |
| 2 | 2 Galerie-Lauf | nur neue `docs/images/screenshot-{sftp,containers,kubernetes,settings,assistant}.png` | Schritte aus Spec 6, Welle 2. Abbruch, wenn ein Bild „Dieser Computer“ zeigt, `/home/<Benutzer>` oder `C:\Users\<Name>` enthält, die Statusleiste zeigt oder nicht 1440×874 groß ist. |

Gate nach jeder Welle: `npm run typecheck` und `npx vitest run` bleiben grün (kein `src/`-Code betroffen). Keine Tests, keine Version und kein CHANGELOG (R3 gilt). Commits wie in Spec 6.

## Geprüft, ohne Befund

- Zielpfad: `REPO` wie in `driver.mjs:11` ist unabhängig vom cwd. `docs/images/` existiert. Node 24 hat `import.meta.dirname`.
- `crop=status` ist in `shot()` fest eingebaut. Die lokale SFTP-Spalte nutzt `<RUN_DIR>\local` oder `%PUBLIC%`, nie das Profil (`screens.mjs:53-63`). Die aktuellen Bilder enthalten keinen Benutzernamen und nur synthetische Daten (`demo@127.0.0.1:2222`, `10.0.0.8`, Cluster-Fixtures).
- README auf GitHub: `<p align="center">`, `<table>`, `<td width="50%">` und `<img width="100%">` werden nicht gefiltert. Das Muster ist identisch mit `README.md:18-31`. Vor und nach dem HTML-Block steht eine Leerzeile, die Überschrift `## Screenshots` ist Markdown.
- Hinweis ohne Fix: Die Bilder zeigen die deutsche Oberfläche, die README ist englisch. Das passt zu den drei vorhandenen Bildern (R1).
