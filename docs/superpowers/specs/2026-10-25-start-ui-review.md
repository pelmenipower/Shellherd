# Start-UI – Review (Stufe 7)

Branch `claude/feature/start-ui` gegen `claude/feature/import-update` (9 Commits, 35 Dateien). Grundlage: Spec `2026-10-25-start-ui-design.md`, bindender Anhang `…-validation.md` (R-A bis R-C, V1–V4), Ledger `.superpowers/sdd/2026-10-25-start-ui/progress.md`.

**Urteil: ready after fixes.** 0 Critical, 1 Important, 7 Minor.

Gates: `npm run typecheck` grün, `npx vitest run` grün (154 Dateien, 2375 Tests). Die echte App prüft der Orchestrator parallel (Ledger: run-app Runde 1 i.O.). Kontraste sind hier per WCAG-2.x-Formel nachgerechnet, nicht im Bild gemessen.

## 1. Sicherheit

| Punkt | Befund |
|---|---|
| Liste nur in Main | Geschrieben wird `recentVaults` nur durch `RecentVaults.touch` (nach erfolgreichem `saveVault`, `unlockVault`, `saveCurrentVault`) und `remove`. Einen Kanal zum Hinzufügen gibt es nicht. i.O. |
| Entfernen nur per Id | `vault:recent-remove` läuft über `handle` mit `guard` = `windowRegistry.requireMain` (`src/main/vault/ipc.ts:53-63`, `src/main/index.ts:354`). `remove(id: unknown)` vergleicht mit den Hashes der gespeicherten Liste. Eine unbekannte Id oder ein Wert, der kein String ist, führt zu `core.invalidRequest`, ein Schreibfehler zu `core.settingsWriteFailed`. Getestet. i.O. |
| Prüfung beim Lesen | `readRecentVaults` (`src/main/app-settings.ts:55-63`) prüft per zod, dass der Pfad absolut ist und 1 bis 4096 Zeichen hat und dass `openedAt` eine ganze Zahl ≥ 0 ist. Ungültige Einträge fallen weg, danach wird auf 8 gekappt. Ist der Wert kein Array, gilt das Feld als fehlend. Getestet. Ausnahme ist der Startwert aus `last-vault.json`, siehe **M1**. |
| Pfade im Renderer | `RecentVault.filePath` geht absichtlich an den Renderer (R-A3, zur Anzeige und für `unlockVault`). Das ist nicht neu, `lastVaultFile` lieferte den Pfad schon vorher. Die Freigabeliste ist nach R-A ein eigenes Feature und **muss dem Nutzer im Bericht genannt werden**. |
| UNC und NTLM: wann wird geprüft? | `list()` führt `stat` auf **alle** bis zu 8 Einträge aus (`recent-vaults.ts:42-48`). `latest()` ruft `list()` auf. Beim **bloßen Start** läuft das ohne Klick: `App.tsx:248` (`lastVaultFile`) und danach auf `open` erneut `App.tsx:257` sowie `RecentVaults` beim Mounten. Ein UNC-Pfad in der Liste löst damit bei jedem Start eine SMB-Verbindung aus, samt impliziter NTLM-Anmeldung. Vorher galt das nur für den einen letzten Vault. In die Liste kommt ein Pfad aber nur nach einem *erfolgreichen* Entsperren oder Speichern an genau diesem Pfad, also an Servern, die der Nutzer selbst benutzt hat. Ein neuer Angriffsweg entsteht nicht. Nur eine XSS mit `unlockVault` auf einen fremden UNC-Vault mit bekanntem Passwort würde den Abfluss über Neustarts hinweg verlängern. Das gehört zur zurückgestellten Härtung A4, siehe **M2**. Die Verzögerung beim Start ist dagegen ein echter Rückschritt, siehe **I1**. |
| Theme-Handler | `app:get-theme`/`app:set-theme` (`src/main/index.ts:265-276`): `requireMain`, `z.enum(THEME_SETTINGS)` mit `core.invalidRequest`, zuerst `writeAppSettings` und dann `themeSource`, bei einem Fehler `core.settingsWriteFailed`. i.O. |
| `nativeTheme` beim Start | `nativeTheme.themeSource = readAppSettings(settingsFile).theme` (`index.ts:236`) steht in `whenReady` vor `createMainWindow` (`:401`). Das erste Fenster bekommt damit schon das richtige `backgroundColor` und die richtige Media-Query. `nativeTheme.on('updated')` setzt den Hintergrund nur bei registrierten Fenstern, das Drag-Ghost-Fenster ist ausgenommen. i.O. |
| Secrets, kubeconfig, Exec | Nicht berührt. In `settings.json` stehen nur Pfad und Zeitpunkt. |

## 2. Theme

**Vollständigkeit (R19):** Der helle Block deklariert alle 35 `--color-*` des dunklen Blocks, dazu `color-scheme` und `--shadow-overlay`. Die Lint-Regel R19 (`design-tokens.test.ts:195-206`) leitet die Liste aus dem dunklen `:root` ab und meldet auch fremde Tokens im hellen Block. Selbsttest vorhanden. `COLORS` (R9) enthält jetzt auch `warn-bg`/`ok-bg`. i.O.

**Kontraste (nachgerechnet, gemischte Tönungen über Panel):**

| Paar | Wert | Ziel |
|---|---|---|
| Text auf Bühne / App / Panel / erhöht / Hover | 17,5 / 15,1 / 16,2 / 14,2 / 13,2 | 4,5 ✓ |
| Gedämpft auf App / Panel / Hover / ausgewählt | 6,5 / 7,0 / 5,7 / 5,9 | 4,5 ✓ |
| Akzent (Link) auf Panel / erhöht / Hover / ausgewählt | 6,2 / 5,4 / 5,0 / 5,2 | 4,5 ✓ |
| Weiß auf Akzent / Akzent-Hover (Primärknopf) | 6,7 / 8,6 | 4,5 ✓ |
| Fokusring (Akzent) gegen jede Fläche, schlechtester Fall Drop-Tönung auf App | ≥ 4,3 | 3 ✓ |
| Gefahr-Text auf Gefahr-Fläche / Gefahr-Hover | 9,3 / 8,1 | 4,5 ✓ |
| `--color-danger` auf Gefahr-Fläche (`.kube-chip-bad`, `.file-error`) | 5,75 | 4,5 ✓ |
| Produktionslinie `--color-danger` auf App / Panel | 5,7 / 6,1 | 3 ✓ |
| Warn auf Warn-Fläche / Panel / Hover | 5,7 / 5,9 / 4,8 | 4,5 ✓ |
| Ok auf Ok-Fläche / Panel / Hover | 5,75 / 6,1 / 5,0 | 4,5 ✓ |
| Danger-strong (Punkte) auf Panel / Hover | 4,5 / 3,65 | 3 ✓ |
| Auswahltext auf Auswahl | 11,9 | 4,5 ✓ |
| `--color-border` auf Panel / Eingabe | 1,43 / 1,54 | wie dunkel, siehe **M4** |

Die Grenzfälle unter 4,5 sind Warn- oder Akzent-Text auf einer Drop-Tönung bzw. auf `--color-selection-bg` (4,1 bis 4,4). Für diese Paare gibt es heute keine Fundstelle. In der Doku-Tabelle stehen dazu einige zu hohe Mindestwerte, siehe **M5**.

**Terminal:** `minimumContrastRatio` wird beim Anlegen aus `matchMedia` gesetzt (`TerminalPanel.tsx:107`). Der neue Effekt (`:299-311`) setzt `theme` und `minimumContrastRatio` bei `change` neu, nach Spec §3.7. Er gilt für alle Fenster, weil jedes Fenster `TerminalPanel` nutzt. i.O. Der Orchestrator hat das live bestätigt (Ledger, Runde 1).

**Harte Farben außerhalb von `tokens.css`:** Neu ist nur `windowBackground` (`index.ts:97`), in `design-system.md` als Ausnahme eingetragen. Nach R-B7 bleiben unverändert: `NativeSurface.cs:36` (dunkler RDP-Grund vor dem ersten Bild), `drag-ghost.ts:16-19` (eigene, opake dunkle Leiste, auf jedem Grund lesbar) und `ConnectionForm.tsx:164`. Ein Kommentar stimmt nicht, siehe **M3**.

**Kubernetes-Produktionsrahmen:** Er hängt nur an Gefahr-Tokens (`navigation-ui.css:8`, `kubernetes-ui.css:20,63`). Die Werte oben erfüllen AA. i.O.

## 3. Recent Vaults

| Punkt | Befund |
|---|---|
| Startwert | Wird aus `last-vault.json` nur gelesen, wenn `recentVaults` fehlt. `openedAt` ist die mtime. Bei `[]` gibt es keinen neuen Startwert (getestet). `last-vault.ts` ist gelöscht (V1), `LEGACY_USER_DATA_FILES` unverändert. i.O. |
| `touch` nach Entsperren | Alle Wege laufen über `unlockVault` (`ipc.ts:186-189`): Formular (`App.tsx:406`), Explorer-Start und `second-instance` (`openVaultFile` → Formular), Drag-and-drop (dito) und Sperrbildschirm (`App.tsx:636`). Dazu kommen `saveVault` und `saveCurrentVault`. Der Sperrbildschirm setzt dabei die Zeit neu, das passt zu „zuletzt benutzt“. i.O. |
| Kappen auf 8 | `touch` und `readRecentVaults` schneiden beide ab (getestet). i.O. |
| Groß-/Kleinschreibung | Unter win32 vergleicht `recentKey` `resolve(p).toLowerCase()`. Gespeichert wird die zuletzt benutzte Schreibweise. i.O. |
| Fehlende Dateien | Sie werden markiert, der Knopf ist `disabled` und `latest()` überspringt sie. Entfernt wird nichts automatisch. i.O. |
| Gewählten Eintrag entfernen | `onRemoved` leert die Auswahl, der vorhandene Effekt `App.tsx:254-259` wählt den neuesten vorhandenen Eintrag. Das entspricht der Spec. i.O. |
| Fehler beim Laden | Die Liste bleibt dann leer, es wird nichts angezeigt (Spec). i.O. |

## 4. Doku

- Das Workflows-Kapitel habe ich am Code geprüft und es stimmt: Kürzel als Umschalter im Haupt- und Nebenfenster (`App.tsx:138`, `SecondaryWindow.tsx:121`), Titel `→ Tab` bzw. `· kein Terminal ausgewählt`, Suche nach jedem Wort (`workflows.ts:21-28`), Sortierung, Platzhalter-Regex (`workflows.ts:5`), Steuerzeichen-Filter, Gründe aus `terminal-input.ts`, Grenzen 1000/120/4000/2000/20×40 (`schema.ts:264-288`), Löschen ohne Rückfrage, `Verwalten` und „Als Workflow“ nur im Hauptfenster. Eine Lücke gibt es, siehe **M6**.
- Handbuch und Manual: Abschnitte „Zuletzt benutzte Vaults“/„Darstellung“ und der Satz zu den Nebenfenstern stehen wörtlich nach §6. Changelog de/en je 3 Einträge, Version 0.22.0 (V4), README-Ergänzung ebenfalls vorhanden. i.O.
- `design-system.md`: Roter Faden, Tabelle „Helles Theme“, zwei Motion-Gate-Zeilen, Ausnahmeliste für Druck-Feedback, R19 und Farbausnahme sind drin. Die Ausnahmeliste hat ein Leerzeichen vor dem Komma (`… button` , `.file-path …`), kosmetisch.

## 5. i18n und Tokens

8 neue Keys in de-DE und en-US, volle Literale (`THEME_LABELS`), kein dynamischer Key. Neue CSS-Regeln nutzen nur Tokens. `formatDateTime` kommt aus `shared/format`. Keine Bewegung, `.recent-vault-open` ist vom Druck-Feedback ausgenommen. `i18n-catalog.test.ts` und `design-tokens.test.ts` sind grün. Die zusätzliche Regel `.recent-vaults .field-error` (T13) ist nur mit Tokens geschrieben, ok.

## Issues

### Important

**I1 – `latest()` prüft beim Start alle 8 Pfade und wartet auf den langsamsten.** `src/main/vault/recent-vaults.ts:42-53`, Aufruf beim Start in `src/renderer/src/App.tsx:248` und `:257`, im Dateidialog in `src/main/vault/ipc.ts:141`.
Fehlerszenario: Der neueste Vault liegt lokal, Eintrag 4 auf einem getrennten Netzlaufwerk oder auf `\\server\share`. `latest()` = `list()` führt `Promise.all(stat …)` aus und wartet, bis der SMB-Timeout (oft 20 s und mehr) abgelaufen ist. Erst danach springt die App auf `open` und wählt vor, und erst dann öffnet sich „Andere Vault-Datei auswählen“. Vorher wurde nur ein Pfad geprüft. Spec-Risiko 5.8 nimmt Wartezeit nur für die *Liste* hin. Dass der Startsprung und der Dialog dadurch gebremst werden, ist ein Rückschritt. Außerdem löst jeder Start ohne Klick bis zu 8 SMB-Anmeldungen aus, statt einer (siehe §1).
Fix-Richtung: `latest()` prüft die Einträge der Reihe nach und hört beim ersten vorhandenen auf. Im Normalfall bleibt es so bei einem `stat` wie vorher. Dazu ein Test, der zeigt, dass ein späterer Eintrag nicht geprüft wird, etwa über ein injiziertes `stat` oder einen Zähler. `list()` darf parallel bleiben, denn es läuft nur, wenn `open` sichtbar ist. Optional: UNC-Pfade (`\\`-Präfix) in `list()` nicht prüfen und als vorhanden anzeigen. Ein Fehler kommt dann erst beim Entsperren.

### Minor

**M1 – Startwert aus `last-vault.json` ungeprüft.** `src/main/vault/recent-vaults.ts:77-85`. `seed()` verlangt nur einen nicht leeren String. Ein relativer oder 10 MB langer `filePath` (zum Beispiel aus einer übernommenen Terminus-Datei) landet in `list()`, wird mit `stat` relativ zum Arbeitsverzeichnis geprüft und an den Renderer geschickt. Beim nächsten `touch` filtert `readAppSettings` den Eintrag ohne Meldung heraus. Fix: Den Startwert durch dasselbe `RecentVaultSchema` schicken. Dafür das Schema oder `readRecentVaults` aus `app-settings.ts` exportieren.

**M2 – UNC-Pfade werden ohne Klick geprüft (A4 nennen).** `src/main/vault/recent-vaults.ts:44`. Siehe §1: Eine XSS mit `unlockVault` auf einen fremden UNC-Vault würde dafür sorgen, dass bei jedem Start eine NTLM-Anmeldung an diesen Server geht. Kein Fix in diesem Paket (R-A). Im Bericht an den Nutzer bei der Härtung A4 nennen: Freigabeliste für Pfade, und UNC-Pfade beim Start nicht prüfen.

**M3 – Kommentar stimmt für Dunkel nicht.** `src/main/index.ts:96`: „matches --color-bg-app of the active scheme“. Dunkel ist es `#0b1120`, `--color-bg-app` ist aber `#0e141e`. Der Wert ist älter, der Kommentar neu. Fix: Den dunklen Wert auf `#0e141e` setzen, mit derselben Zeile in `design-system.md`, oder den Kommentar ehrlich formulieren.

**M4 – Eingabefelder im hellen Theme kaum abgegrenzt.** `src/renderer/src/tokens.css` (heller Block, `--color-bg-input`/`--color-border`). Ein weißes Feld (1,08 gegen Panel) mit Rand 1,54 liegt unter 3:1 (WCAG 1.4.11). Dunkel ist es genauso (1,47), die Rolle „Haarlinie“ ist so gewollt (Spec §4). Hell fällt es stärker auf. Fix-Richtung (später): Eingaben bekommen `--color-border-strong` als Rand, oder ein eigenes Token `--color-border-control` mit ≥ 3:1. Bitte im Screenshot `light-settings.png` ansehen.

**M5 – Mindestwerte in der Kontrast-Tabelle zu hoch.** `docs/design-system.md:75,86,88`. Nachgerechnet: Warn auf Hover 4,80 (die Tabelle sagt „≥ 4,96“), gedämpft auf Drop-Tönung 5,2 bzw. auf Auswahl 5,2 (Tabelle „≥ 5,7 auf jeder Fläche“), Akzent auf Drop-Tönung 4,6 bzw. auf Auswahl 4,6, über App-Grund 4,3 (Tabelle „≥ 5,0 auf allen Flächen“). Fix: Die Formulierungen auf die tatsächlichen Minima ändern. Für AA reicht es überall, wo diese Paare heute vorkommen.

**M6 – Workflows: Container-Shells fehlen in der Doku.** `docs/handbuch.md:194`, `docs/manual.md:193`. `shellOf` (`terminal-tabs.ts:58-63`) gibt auch Container-Exec-Tabs (`connection.target`) die Shell `ssh`. Workflows gehen also auch dorthin. Fix: „… sowie die Shell eines Containers oder Pods“ bzw. „container and pod shells“.

**M7 – `light-sftp` zeigt den echten lokalen Benutzerordner.** `.claude/skills/run-app/screens.mjs:672-676`. Das ist ein Werkzeugbefund, er steht schon im Ledger. Die linke Seite der SFTP-Ansicht beginnt im echten Home-Verzeichnis. Fix wie im Ledger: vorher `localTarget` setzen, wie es andere Szenen tun. Das gehört nicht ins Produkt.

## Spec-Abdeckung

T1 bis T14 sind umgesetzt, die Verträge §3.1 bis §3.9 stimmen wörtlich oder in der Bedeutung. Abweichungen: `ThemeSetting` gibt `JSX.Element | null` ohne Annotation zurück, ohne Folgen. `RecentVaults` gibt `ReactElement | null` zurück. Dazu kommt die `.field-error`-Regel. V1 bis V4 sind erfüllt (V2 über `colorScheme: null` im Treiber, Ledger). R-A, R-B und R-C sind eingehalten.

Nicht geprüft: das Bild in der laufenden App (Orchestrator), die Dauer eines SMB-Timeouts, nur abgeschätzt, und die xterm-Kontrastanhebung im Bild.
