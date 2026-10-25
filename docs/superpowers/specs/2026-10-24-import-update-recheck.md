# Import und Update-Hinweis – Nachprüfung Runde 2

Grundlage: Review `2026-10-24-import-update-review.md`, Ledger `.superpowers/sdd/2026-10-24-import-update/progress.md` (Ruling zu M1), Fix-Diff `HEAD~5..HEAD` (a749e24, 67d6154, b81447b, 0654061, bc0940f).

**Urteil: ready after fixes.** Von 9 Befunden: 7 ADDRESSED, 1 ACCEPTED (M1, Ruling), 1 NOT ADDRESSED (I2, teilweise). Neu: 0 Critical, 1 Important (N1), 0 Minor.

Gates: `npm run typecheck` grün, `npx vitest run` grün (152 Dateien, 2328 Tests).

Messungen: Ich habe die Parser des Branches mit esbuild gebündelt und unter Node 24.20 (V8) gemessen. Das Skript liegt in der Scratchpad-Ablage dieser Sitzung und nicht im Repo.

## 1. Befunde aus dem Review

| Befund | Status | Beleg |
|---|---|---|
| I1 mRemoteNG-Regex O(n²) | **ADDRESSED** (Muster) | `src/shared/import-mremoteng.ts:9-12`: Tag-Inhalt `[^<>]`, `ATTR` an `(?:^|\s)` verankert. Gemessen mit 4 MiB: `<Node ` 9 ms, `<Connections ` 9 ms, Wortlauf im Tag 13 ms, Wortlauf ohne `>` 8 ms, ` a="` ohne Ende 63 ms, `</Node>` 42 ms, nur Leerzeichen 12 ms, `&#`-Lauf 20 ms, 100 000 verschachtelte Container 131 ms. Der Ordner-Stapel ist jetzt inkrementell (`:28-29, 40-44`). Die Muster sind linear. Ein weiterer quadratischer Pfad im selben Parser steht unter **N1**. |
| I2 OpenSSH-Glob exponentiell | **NOT ADDRESSED** (teilweise) | Der exponentielle Einzelfall ist behoben: `globMatch` (`src/shared/import-openssh.ts:21`) ist iterativ und kostet O(n·m). `*a`×20+`*b` gegen 40 Zeichen braucht 0 ms, 1000 Sterne gegen 4000 Zeichen ebenfalls 0 ms. 100 000 Host-Zeilen brauchen 299 ms, 400 000 Zeilen (4 MiB) 479 ms. **Offen ist die Gesamtlast**, die das Review mit „Hunderte Millionen Tests“ benannt hat. `MAX_HOST_BLOCKS` (`:13, :157`) begrenzt nur die Blöcke, nicht die Muster je Block (`:159 args.map(toPattern)`). `optionsOf` (`:193-196`) prüft für jeden der 500 Aliasse jedes Muster. Gemessen: 500 Aliasse plus **eine** `Host`-Zeile mit 1 000 000 Mustern `?x` (3 MiB) brauchen **46 s**. 500 Aliasse mit 2000 Zeichen plus eine Zeile mit 200 Mustern `*a…ab` (Länge 1000, Datei nur 1,2 MB) brauchen **533 s**, weil jedes Paar (L−P)·P Schritte kostet. Folge wie im Review: Der Main-Prozess friert ein, sobald im Dialog eine fremde oder kaputte Datei gewählt wird. |
| M1 reg.exe-Fehler still | **ACCEPTED** (Teil Richtlinie), sonst ADDRESSED | `src/main/import-source.ts:63-67` `isPlainExit1`. `:144`: ENOENT, Timeout (`killed`) und Fehler ohne Exit-Code werden zu `core.importUnreadable`, das `finally` räumt weiter auf (Test `import-source.test.ts:132-140`). Ein per Richtlinie gesperrtes `reg.exe` (Exit 1) bleibt eine leere Vorschau, so das Ledger-Ruling aus Runde 2 FC. Dem Nutzer als Restpunkt nennen. |
| M2 mkdtemp roh | **ADDRESSED** | `src/main/import-source.ts:131-136` wirft `AppError('core.importUnreadable')`. Der Test `:142-147` belegt außerdem, dass `reg.exe` dann nicht läuft. |
| M3 UPDATE_URL-Präfix | **ADDRESSED** | `src/main/import-source.ts:70-79` prüft per `new URL`: `protocol === 'http:'`, `hostname === '127.0.0.1'`, kein `username`/`password`. Verwendet wird es in `src/main/index.ts:356`. Gegengeprüft: `127.0.0.1.evil`, `127.0.0.1\t.evil`, `[::ffff:127.0.0.1]`, `127.0.0.1:@evil`, `127.0.0.1:80@evil`, `127.0.0.1%2f@evil` und `evil#@127.0.0.1` werden abgelehnt. `HTTP://`, `0x7f.1`, `127.1` und Port 0 werden angenommen, normalisieren aber auf 127.0.0.1 und bleiben damit lokal (Port 0 scheitert still). |
| M4 PuTTY ProxyPassword | **ADDRESSED** | `src/shared/import-putty.ts:11` hat die Whitelist `PUTTY_VALUES`. `:41` legt nur Werte aus `keep` ab, ohne Groß-/Kleinschreibung. `parseRegSections` hat keinen weiteren Aufrufer. Test `import-putty.test.ts:80-91`. |
| M5 Badge fragt nur einmal | **ADDRESSED** | `src/renderer/src/update-store.ts` mit `useSyncExternalStore`. `UpdateBadge.tsx:15-17` fragt beim Mount und bei jedem `vault:unlocked` und gibt die Abmeldung als Cleanup zurück. Die Preload-Seite `subscribe` (`src/preload/index.ts:12-16`) entfernt den Listener, es gibt kein Leck. `UpdateSetting.tsx:18` schreibt in denselben Store, also verschwindet der Badge beim Abschalten sofort. Doppelte Abrufe (Mount, Unlock-Ereignis, Einstellungsdialog, StrictMode) teilen sich `inFlight` (`src/main/update-check.ts:55-58`), und `updateDue` verhindert einen zweiten Netzabruf. Harmlos. |
| M6 Doku | **ADDRESSED** | `docs/handbuch.md:358-359, 363`, `docs/manual.md` an den entsprechenden Stellen, `CHANGELOG.md`/`CHANGELOG.en.md` 0.21.0: WinSCP nur aus der Registry, RDP aus mRemoteNG mit Domain und ohne Passwort, „RDP wird mit RDP verglichen“. `vault.json` `import.empty` ist jetzt neutral (de/en). Die Aussagen stimmen mit dem Code überein (`import.ts` Duplikatgruppen, `import-source.ts` ohne ini-Pfad). |
| M7 200px-Literal | **ADDRESSED** | `src/renderer/src/import-ui.css:12` `var(--import-name-min)`, `tokens.css:75` mit Rollenkommentar, `docs/design-system.md:124`. |

## 2. Neue Befunde

### Important

**N1 – mRemoteNG: Die Schlüssel-Entdopplung ist quadratisch und kopiert unbegrenzt tiefe Ordnerpfade.** `src/shared/import-mremoteng.ts:52-56`.
- Diese Zeilen stehen nicht als `+`-Zeilen im Diff, gehören aber zum Ziel von I1 (fremde `confCons.xml` darf Main nicht einfrieren). Laut Ledger wurde I1 als „linear“ abgeschlossen.
- Ursache: Für den k-ten Kandidaten mit gleichem `base` läuft `for (let n = 2; keys.has(key); n++) key = \`${base}#${n}\`` k-mal. Jedes Mal entsteht ein String der Länge `base`. Bei 500 Kandidaten sind das etwa 125 000 Strings. `base` ist `Id` oder `[...folder, name].join('/')`, die Länge ist also unbegrenzt.
- Gemessen:
  - 500 gleiche Verbindungen mit 7000 Zeichen langem `Name` (3,5 MB): 1,4 s.
  - 60 000 verschachtelte Container mit Namen `x`, darunter 30 000 gleiche SSH-Verbindungen (rund 3 MB): **89 s**.
  - Mit längeren Container-Namen bis 4 MiB sind es mehrere Minuten.
- Zusätzlich bekommt jeder der bis zu 500 Kandidaten eine Kopie des vollständigen Ordnerpfads (`:56`), die per IPC an den Renderer geht. Bei 100 000 Ebenen sind das bis zu 50 Mio. Strings im Structured Clone. Erst `buildImportNodes` prüft die Segmente.
- **Fehlerszenario:** Wie bei I1. Eine präparierte oder kaputte `confCons.xml` blockiert den Main-Thread: Sitzungen stehen, der Auto-Lock läuft nicht.
- **Fix-Richtung:**
  - Die nächste Nummer je `base` in einer `Map<string, number>` führen, dann gibt es keine Schleife über `keys`.
  - Die Ordnertiefe begrenzen, etwa auf 32 Ebenen. Tiefere Verbindungen gelten als `invalid` oder werden auf 32 Ebenen gekürzt. Optional die Länge von `Name` und `Id` begrenzen.
  - Regressionstest: Die beiden Eingaben oben müssen in weniger als 1 s geparst sein.

### Zu I2 (offen): Fix-Richtung für Runde 3

- Die Muster gesamt begrenzen, nicht nur die Blöcke, etwa 5000 Muster über alle Blöcke. Was darüber liegt, wird ignoriert und als `tooMany` gezählt.
- Muster und Aliasse über 255 Zeichen verwerfen. Solche Aliasse sind ohnehin keine gültigen Hosts, sie gehen also als `invalid` raus, bevor `optionsOf` läuft.
- Jeden Alias nur einmal klein schreiben und in Zeichen zerlegen, nicht bei jedem `globMatch`-Aufruf.
- Grenzen allein reichen nicht. Selbst 500 × 5000 Muster × 255²/4 Schritte sind rund 4·10¹⁰ Schritte. Deshalb zusätzlich ein Schrittbudget für alle `globMatch`-Aufrufe zusammen, etwa 2·10⁷ Zeichenvergleiche. Wird es überschritten, folgt `AppError('core.importTooLarge')`.
- Alternative für alle Parser zugleich: in einem `worker_threads`-Worker parsen, mit Zeitlimit.
- Regressionstests mit beiden Messfällen aus der Tabelle, jeweils unter 1 s.

### Geprüft ohne Befund

- **Glob-Korrektheit:**
  - `*` passt auch auf leeren Text, `?` auf genau ein Zeichen und nie auf leeren Text.
  - Das Muster muss den ganzen String abdecken. Groß-/Kleinschreibung zählt nicht, `.` ist literal, `**` verhält sich wie `*`.
  - Negation läuft unverändert über `toPattern` und `optionsOf`.
  - Abweichung ohne Folgen: `?` steht jetzt für einen Codepunkt statt einer UTF-16-Einheit. Das betrifft nur Nicht-BMP-Zeichen.
- **`MAX_HOST_BLOCKS`:**
  - Optionen nach einem ignorierten `Host` hängen nicht mehr am vorigen Block, weil `current` dort `undefined` ist (`:154-174`).
  - `tooMany` addiert sich korrekt zu den Aliassen über 500.
  - Restpunkt ohne Befund: Ab dem 5001. Host-Block wird auch ein abschließendes `Host *` mit Vorgaben ignoriert. Das tritt nur bei mehr als 5000 Blöcken auf.
- **mRemoteNG `ATTR`:** Attribute ohne Leerraum davor (`a="1"b="2"`) gehen jetzt verloren. Das ist kein gültiges XML und kommt in mRemoteNG-Dateien nicht vor.
- **Store:** Die Modulvariable überlebt Sperren und Entsperren. Der Badge hängt aber am Vault-Bildschirm und fragt beim Entsperren neu. Ein alter Stand ist höchstens bis zur Antwort sichtbar.
- **Szenen und Skill** (`.claude/skills/run-app`): Das sind nur Werkzeugänderungen, sie prüft der Orchestrator in der App.
