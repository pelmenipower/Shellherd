# README-Galerie – Review

Geprüft: `git diff 74cc3f1..HEAD` (6 Commits) gegen `2026-10-20-readme-gallery-design.md` und den bindenden Anhang `2026-10-20-readme-gallery-validation.md`.

**Urteil: ready to merge.** 0 Blocker, 0 Major, 2 Minor. Beide Minor sind optional.

`npm run typecheck`: grün. `npx vitest run`: 121 Dateien, 1675 Tests grün. Der Arbeitsbaum ist sauber, und kein Commit berührt `src/`, `package.json`, CHANGELOG oder das Handbuch (R3 eingehalten).

## Sicherheit und Datenschutz

- Am App-Code hat sich nichts geändert. Bestätigungspfad, „Nur lesen“ im Main, Exec erst nach Klick und kubeconfig sind nicht berührt. Das Skript liest das Treiber-Token wie bisher und schreibt keine Secrets.
- Alle fünf Bilder wurden mit Read angesehen. Jedes ist 1440×874 (`crop=status`) und hat damit keine Statusleiste und keinen Vault-Pfad. „Dieser Computer“ fehlt in der Seitenleiste. Es gibt keinen Windows-Benutzernamen und kein `/home/<Benutzer>`, nur synthetische Daten: `demo@127.0.0.1:2222`, `/home/demo`, `10.0.0.8`, die Cluster-Fixtures `cp1/w1/w2` mit Namespace `shop`, die Container-Fixtures `api/worker/redis/db/migrate/cron-legacy` und den KI-Fake `Demo-KI · gpt-4o-mini`. Die lokale SFTP-Spalte zeigt `C:\Users\Public\shellherd-demo-local` mit den drei synthetischen Dateien (siehe M1).
- Die Sperre aus B1 ist umgesetzt: `screens.mjs:40-44` bricht für README-Bilder ab, sobald `.local-containers` im DOM steht. Der Selektor stimmt mit `LocalContainers.tsx:15` überein. Der Block schlägt dann fehl, sein Bild wird nicht kopiert und der Exit-Code ist 1.

## Abdeckung des Anhangs

| Punkt | Stelle | Befund |
|---|---|---|
| Vertrag `REPO`, `README_SHOTS` | `screens.mjs:12-13` | wörtlich wie im Anhang |
| B1 Abbruch bei `.local-containers` | `screens.mjs:40-44` | wörtlich wie im Anhang |
| K1 nur README-Bilder kopieren | `screens.mjs:158` | `ai-settings.png` wird nicht kopiert |
| K2 Pfad aus `/ss` | `screens.mjs:43`, `driver.mjs:64-68` | Der Rückgabewert des Treibers (`file`) landet in `shots`. `SHOTS` wird in `shot()` nicht mehr benutzt. |
| K3 Argumente vor dem Treiber, `Object.hasOwn` | `screens.mjs:137-141` vor `:143-145` | erfüllt. `--readme` darf an beliebiger Stelle stehen. |
| Usage und Kommentar | `screens.mjs:2-3` | erfüllt, englisch |
| K4 Bildtexte | `README.md:49-73` | wörtlich wie im Anhang. Die übrigen Texte stammen aus Spec 2.2. |
| K5 Pipeline Schritt 6 | `feature-pipeline/SKILL.md:33` | wörtlich wie im Anhang |
| K6 Stolperstein | `run-app/SKILL.md:100` | wörtlich wie im Anhang |
| Spec 2.3 und 2.4 | `run-app/SKILL.md:23`, `:33`, `:96` | erfüllt |
| README `:101` (jetzt `:127`) | `README.md:127` | erfüllt. Der Satz `:131` („taken this way“) stimmt weiterhin. |

**Bildtexte gegen Bilder:**
- Kubernetes: Node-Kacheln mit CPU und RAM, das Band „3 Probleme“, die Pod-Tabelle und das Abzeichen „Produktion“ sind zu sehen. Die Texte passen.
- SFTP: lokaler Ordner links, `/home/demo` rechts. Passt.
- Container: sechs Container mit Image, Ports und Projekt `shop`, ohne Gruppierung. Passt.
- Einstellungen: Sprache, Dateizuordnung, Nachfrage vor dem Trennen und KI-Anbieter sind zu sehen. Passt.
- Assistent: Panel neben dem Terminal mit den Buttons „Eintippen“ und „Kopieren“. Passt.

**README-HTML:** Die Struktur entspricht der Tabelle `README.md:18-31`, die GitHub schon anzeigt. Vor und nach dem HTML-Block steht eine Leerzeile, und alle Alt-Texte sind englisch und beschreibend.

## Befunde

### Minor

**M1 Galerie-Lauf ohne `SHELLHERD_RUN_DIR` außerhalb des Profils (R4, Spec 6 Welle 2 Schritt 2)**
- **Stelle:** `docs/images/screenshot-sftp.png`. Die lokale Spalte zeigt `C:\Users\Public\shellherd-demo-local`.
- **Szenario:** `localTarget()` (`screens.mjs:61-64`) nimmt `<RUN_DIR>\local`, wenn dieser Ordner außerhalb des Profils liegt. Der Public-Fallback greift nur, wenn das nicht so ist. Also lag `RUN_DIR` beim Lauf unter `%TEMP%`, entgegen R4. Für den Datenschutz ist das ohne Folgen, denn Spec 3 erlaubt den Fallback ausdrücklich, und das Bild zeigt keinen Benutzernamen. Im README-Bild steht allerdings „Users \ Public“ statt des sauberen Pfads.
- **Kleinste Korrektur:** Als ACCEPTED führen. Wer das saubere Bild will, setzt `SHELLHERD_RUN_DIR=C:\shellherd-run` und startet `screens.mjs --readme sftp` neu (Treiber und Testserver müssen mit demselben Run-Ordner laufen). Am Code ändert sich nichts.

**M2 `--readme` endet mit Exit 0, obwohl das Kubernetes-Bild fehlt**
- **Stelle:** `.claude/skills/run-app/screens.mjs:96`.
- **Szenario:** Fehlt `openssl`, läuft kein Kube-Fake und `prod-k8s` fehlt. Der Block meldet dann nur „übersprungen“ und kehrt zurück. `--readme` endet mit Exit 0, und `docs/images/screenshot-kubernetes.png` bleibt auf dem alten Stand, ohne Fehler. Die Pipeline-Regel in `feature-pipeline/SKILL.md:33` verlangt das Neuerzeugen, und ein Agent würde den Exit 0 als Erfolg lesen. Abgemildert wird das durch zwei Dinge: Die Spec nennt das Risiko („sichtbar im `git status`“), und vor jedem Commit ist eine Sichtprüfung Pflicht.
- **Kleinste Korrektur:** Im README-Modus soll das Überspringen ein Fehler sein. In `:96` vor `console.log(…); return;` kommt `if (readme) throw new Error('prod-k8s fehlt im Baum (Testserver ohne Kubernetes?)');`. Das ist eine Zeile und ändert nichts am Verhalten ohne `--readme`.

## Fix-Welle-Vorschlag

Es ist keine Pflicht-Welle nötig. Optional übernimmt ein `umsetzer` die eine Zeile aus M2 in `.claude/skills/run-app/screens.mjs` und prüft sie mit `node --check`. M1 bleibt als ACCEPTED im Ledger, weil das Bild datenschutzkonform ist und ein neuer Lauf nur kosmetisch wäre.

Nicht bewertet (vorgegeben): Die Bilder zeigen die deutsche Oberfläche, wie die drei älteren.
