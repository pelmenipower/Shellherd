# Start-UI – Nachprüfung (Runde 2)

Grundlage: Review `2026-10-25-start-ui-review.md`, Ledger `.superpowers/sdd/2026-10-25-start-ui/progress.md` (Rulings M2 teilweise, M4 jetzt). Fix-Diff `git diff HEAD~4..HEAD` (7e19b4a, 22616df, 2a5a331, bf1bdb7; 10 Dateien, +97/−25).

**Urteil: ready.** 7 ADDRESSED, 1 ACCEPTED (M2-Rest nach Ruling), 0 NOT ADDRESSED. Neu im Fix-Diff: 0 Critical, 0 Important, 1 Minor.

Gates: `npm run typecheck` grün, `npx vitest run` grün (154 Dateien, 2379 Tests, +4 gegenüber dem Review). Das Bild prüft der Orchestrator.

## Befunde

| Befund | Status | Beleg |
|---|---|---|
| I1 `latest()` prüft alle 8 Pfade parallel | ADDRESSED | `recent-vaults.ts` `latest()` läuft jetzt der Reihe nach über `entries()` und bricht beim ersten vorhandenen Eintrag ab. `list()` bleibt parallel, das ist gewollt. Über die injizierbare `Probe` wird getestet, dass nur `a.term` geprüft wird bzw. `a` und `b`, nie `c` (`recent-vaults.test.ts`, „latest() stops at the first existing entry …“ und „… skips missing entries …“). Auch `ipc.ts:141` (Dateidialog) nutzt `latest()` und profitiert davon. |
| M1 Startwert ungeprüft | ADDRESSED | `seed()` schickt den Startwert durch das exportierte `RecentVaultSchema` (`app-settings.ts:23`). Ein relativer Pfad und ein Pfad über 4096 Zeichen ergeben `[]`, beides ist getestet. |
| M2 UNC ohne Klick geprüft | ACCEPTED (Teil-Fix nach Ruling) | `missing()` gibt bei einem Pfad mit `\`-Präfix `false` zurück, ohne `stat`. Das gilt in `list()` und in `latest()`, Test „does not probe UNC paths“ (win32, CI läuft auf `windows-latest`). Die Freigabeliste bleibt Härtung A4 (R-A) und muss im Bericht an den Nutzer stehen. Eine Lücke in der Erkennung siehe **N1**. |
| M3 Fensterfarbe dunkel | ADDRESSED | `index.ts:97` nutzt jetzt `#0e141e` = `--color-bg-app` (`tokens.css:7`), der Kommentar stimmt. Die Ausnahme in `design-system.md` ist angepasst. |
| M4 Eingaberand hell unter 3:1 | ADDRESSED | Neues Token `--color-border-control` in beiden Blöcken, `styles.css:15` nutzt es für `input, textarea, select`. Nachrechnung und Prüfung, ob andere Regeln noch `--color-border` setzen, stehen unten. |
| M5 Kontrast-Tabelle zu optimistisch | ADDRESSED | Die Zeilen in `design-system.md` für `bg-raised`, `bg-hover`, `text`, `text-muted` und `accent` nennen jetzt die echten Minima: warn 4,8 auf Hover, gedämpft 5,2 auf Drop und Auswahl, Akzent 4,6/4,3/4,6. Das deckt sich mit meiner Rechnung aus dem Review. |
| M6 Workflows in Container-Shells | ADDRESSED | `handbuch.md:194` und `manual.md:193` nennen jetzt Container- und Pod-Shells und grenzen die Container-Ansicht selbst ab. Das passt zu `shellOf` (`terminal-tabs.ts:58-63`). |
| M7 `light-sftp` zeigt echten Home-Ordner | ADDRESSED | `screens.mjs:675-685` stellt die lokale Spalte über `localTarget()` auf den synthetischen Ordner, genau wie der SFTP-Block (`:148-154`). Ohne sicheren Ordner fällt das Bild weg. Ein Bild vom echten Ordner entsteht so nie. |

## Nachrechnung `--color-border-control` (WCAG 2.x)

| Fläche | dunkel `#637389` | hell `#857a6d` |
|---|---|---|
| `--color-bg-input` | 3,78 | 4,20 |
| `--color-bg-panel` | 3,50 | 3,89 |
| `--color-bg-app` | 3,82 | 3,63 |
| `--color-bg-stage` | 3,94 | 4,20 |
| `--color-bg-raised` | 3,15 | 3,41 |
| `--color-bg-hover` | 2,75 | 3,17 |

Die Kommentare in `tokens.css:22,121` und die Doku-Zeilen (`design-system.md:45,86`) stimmen. Unter 3:1 liegt nur dunkel auf `--color-bg-hover`. Eingaben auf Hover-Flächen gibt es heute nicht, die Kube-Filterzeile liegt auf Panel. Kein Befund.

## Andere Eingabe-Regeln

Alle CSS-Regeln mit `input`, `textarea` oder `select` im Selektor habe ich durchsucht. Außerdem habe ich die `className` aller `<input>`, `<textarea>` und `<select>` im Renderer geprüft: `tree-search`, `view-rename`, `workflow-search`, `workflow-mono`. Keine dieser Regeln setzt `border` oder `border-color` auf `--color-border`. Die Kube-Filter (`kubernetes-ui.css:146`) setzen nur `border-width`, die Farbe kommt aus der Basisregel. `.kube-filter-invalid` setzt absichtlich Gefahr. `.file-pane-tools select` ist absichtlich randlos (`border: 0`) und war das schon vorher. Die übrigen Treffer für `--color-border` sind Container, etwa `.terminal-search` (Unterkante der Leiste), `.assistant-input` (Oberkante des Bereichs) und `.language-setting` (Fieldset), aber keine Eingaben. i.O.

## Neue Befunde (nur Fix-Diff)

### Minor

**N1 – Die UNC-Erkennung übersieht Schrägstrich-Schreibweisen.** `src/main/vault/recent-vaults.ts:61` (`filePath.startsWith('\\')`).
Fehlerszenario: `//server/share/v.term` oder `\/server\share\v.term`. Unter win32 ist das für `isAbsolute` ein absoluter Pfad und Windows behandelt es als UNC. `unlockVault` (`ipc.ts:176-189`) übernimmt den Pfad aus dem Renderer, ohne ihn zu normalisieren, und `touch` speichert ihn wörtlich. Der Pfad kann über eine XSS kommen, über ein Kommandozeilen-Argument mit Schrägstrichen oder über einen eingetippten Pfad. Danach führen `list()` und, wenn es der neueste Eintrag ist, auch `latest()` bei jedem Start ein `stat` und damit eine SMB/NTLM-Anmeldung aus. Das Ruling zu M2 wird damit umgangen.
`\?\UNC\server\share` und `\?\C:\…` fängt das Präfix ab. Die zweite Form wird dabei unnötig als „vorhanden“ gezeigt, das ist harmlos.
Fix-Richtung: `/^[\/]{2}/.test(filePath)` statt `startsWith('\\')`, dazu ein Testfall `//server/share/vault.term`. Alternativ in `touch` `win32.normalize` anwenden, dann landet nur noch die `\`-Form in der Liste.

### Rest, kein Befund

- **Gemappte Netzlaufwerke (`Z:\…`)** sind ohne `GetDriveType` nicht von lokalen Laufwerken zu unterscheiden. Der Rest ist hinnehmbar. `latest()` prüft der Reihe nach und wartet nur, wenn der Laufwerkseintrag vor dem ersten erreichbaren Eintrag steht. Vor dem Paket war das genauso, denn dort wurde der eine letzte Vault geprüft. Ein Rückschritt ist es also nicht. Dass `list()` wartet, nimmt Spec-Risiko 5.8 hin. Ein NTLM-Abfluss an fremde Server ist nicht möglich, weil der Nutzer die Zuordnung selbst angelegt hat. Optional später bei A4 erledigen.
- `COLORS` in `design-tokens.test.ts:64` führt `border-control` nicht auf (R9). R19 erzwingt den hellen Wert und die Basisregel nutzt das Token. Eine Pflicht ist das nicht, nur ein Hinweis für die Vollständigkeit.

## Nicht geprüft

Das Bild in der laufenden App, insbesondere ob der stärkere Rand bei `input[type=color]`, bei Checkboxen und Radios gut aussieht und ob `light-sftp` den synthetischen Ordner zeigt. Das prüft der Orchestrator.
