# Import und Update-Hinweis – Nachprüfung Runde 3

Grundlage: Nachprüfung Runde 2 `2026-10-24-import-update-recheck.md` (I2 teilweise offen, N1 Important) und der Fix-Commit `84a7061` (`fix(import): bounded total work in the OpenSSH and mRemoteNG parsers`).

**Urteil: ready after fixes.** Von 2 offenen Befunden sind 2 ADDRESSED. Neu: 0 Critical, 1 Important (N2), 1 Minor (N3).

Gates: `npm run typecheck` grün, `npx vitest run` grün (152 Dateien, 2338 Tests).

Messungen: Die Parser des Branches habe ich mit esbuild gebündelt und unter Node 24.20 (V8) gemessen. Bündel und Skript liegen in der Scratchpad-Ablage dieser Sitzung (`m3.mjs`, `openssh.cjs`, `mremoteng.cjs`) und nicht im Repo.

## 1. Befunde aus Runde 2

| Befund | Status | Beleg |
|---|---|---|
| I2 OpenSSH-Glob, Gesamtlast | **ADDRESSED** | `src/shared/import-openssh.ts:18` `MAX_PATTERNS` 5000 über alle Blöcke, Zählung `:179-185`, eine `tooMany` je überlaufender Host-Zeile. `:20, :58` Globs über 255 Codepunkte werden ignoriert. `:226-228` Aliasse über 255 zählen als `invalid`, bevor `optionsOf` läuft. `:29, :57, :227` Muster und Alias werden einmal klein geschrieben und zerlegt. `:22, :33, :39` Schrittbudget 2·10⁷ für alle Aufrufe zusammen, jeder Aufruf kostet mindestens einen Schritt, Überlauf führt zu `AppError('core.importTooLarge')`. Gemessen mit denselben Eingaben wie in Runde 2: 500 Aliasse + 1 000 000 Muster `?x` **307 ms** (vorher 46 s). 500 Aliasse mit 2000 Zeichen + 200 Muster `*a…ab` der Länge 1000 **21 ms** (vorher 533 s, jetzt 500 `invalid`). 400 000 Host-Zeilen 303 ms. Schlimmster Fall innerhalb der Grenzen (500 Aliasse mit 254 Zeichen, 1 bis 4499 Muster `*a{126}b`, auch negiert): das Budget greift nach **68–82 ms** mit `core.importTooLarge`. 4499 billige Muster gegen 500 Aliasse: 24 ms. Regressionstests `import-openssh.test.ts:245-296`. |
| N1 mRemoteNG-Schlüssel quadratisch, Ordnertiefe unbegrenzt | **ADDRESSED** | `src/shared/import-mremoteng.ts:31-32, 60-63` nächste Nummer je `base` in `next`. Jeder belegte Schlüssel lässt sich nur einem `base` zuordnen (Zerlegung am letzten `#Ziffern`), und `n` steigt je `base` nur an. Damit gibt es höchstens 500 Kollisionen insgesamt. `:18-20, :47-49` Tiefe 32, Segment 255, `:58` Schlüssel 1024, `:108` Name 255, `:73-77` `clip` ohne einzelnes High-Surrogate am Ende. Gemessen: 500 gleiche Verbindungen mit 7000 Zeichen langem `Name` **9 ms** (vorher 1,4 s). 60 000 Container + 30 000 gleiche Verbindungen **125 ms** (vorher 89 s). Tests `import-mremoteng.test.ts:162-209`. |

## 2. Messungen: Suche nach dem nächsten pathologischen Fall (bis 4 MiB)

### mRemoteNG, ohne Befund

| Eingabe | Zeit |
|---|---|
| 31 Container mit 100 000 Zeichen langen Namen + 500 Verbindungen mit 2000 Zeichen langen Namen | 17 ms (Ordner 31 Ebenen, Schlüssel 1024 Zeichen) |
| 32 Container mit 254 Zeichen langen Namen, danach 4 MiB Verbindungen | 134 ms |
| Entitäten-Lauf `&#65;` mit 4 MiB in einem `Name` | 358 ms |
| Entitäten-Lauf `&amp;` mit 4 MiB | 256 ms |
| Ein Tag mit 4 MiB ` Name="a"`-Attributen | 129 ms |
| Ein Tag mit 4 MiB ` a=""`-Attributen | 87 ms |
| 499 Ids `x#2…x#500`, dann zweimal `x` (gezielte Kollisionen) | 1 ms |
| 500 Ids mit 8000 Zeichen | 11 ms |
| 4 MiB unbenannte Container | 137 ms |
| 4 MiB gültige oder ungültige Verbindungen | 110 ms |

### OpenSSH: neue Fan-out-Last bei den Optionen (N2)

| Eingabe | Größe | Zeit |
|---|---|---|
| 10 000 Zeilen `User x` vor dem ersten `Host`, dann 500 Aliasse | 75 KB | 429 ms |
| 50 000 Zeilen `User x` + 500 Aliasse | 355 KB | 2,2 s |
| 100 000 Zeilen `User x` + 500 Aliasse | 705 KB | 4,9 s |
| **590 000 Zeilen `User x` + 500 Aliasse** | **4,1 MB** | **34 s** |
| 10 000 Zeilen `LocalForward 1 h:2` + 500 Aliasse | 195 KB | 1,7 s |
| 50 000 Zeilen `LocalForward 1 h:2` + 500 Aliasse | 955 KB | 10,4 s |
| **220 000 Zeilen `LocalForward 1 h:2` + 500 Aliasse** | **4,2 MB** | **50 s** |

## 3. Neue Befunde

### Important

**N2 – OpenSSH: Optionen werden je Alias vollständig kopiert und durchlaufen. Das ist O(Aliasse × Optionen) ohne Grenze.** `src/shared/import-openssh.ts:200, 221-224, 229, 146-151`.
- Die Zeilen `:221-229` sind `+`-Zeilen im Fix-Diff. Sie gehören zum Ziel von I2: Eine fremde Datei darf den Main-Prozess nicht einfrieren, und der Commit verspricht „bounded total work“.
- Ursache:
  - `:200` speichert jede Optionszeile ohne Grenze im aktuellen Block, auch im impliziten `*`-Block vor dem ersten `Host` oder in einem `Host *`.
  - `optionsOf` (`:221-224`) baut für jeden der bis zu 500 Aliasse per `flatMap` ein neues Array mit allen Optionen aller passenden Blöcke. `optsByAlias` hält alle 500 Arrays gleichzeitig. Bei 590 000 Optionen sind das rund 3·10⁸ Referenzen, etwa 1,2 GB Heap mit Pointer Compression.
  - Danach läuft `candidateFor` je Alias mehrmals `first()` über das ganze Array (`hostname`, `port`, `user`, `identityfile`, `proxycommand`, dazu `hasJump` zweimal). Die Forward-Schleife `:146-151` ruft `parseForward` mit Regex für jede Forward-Zeile auf, auch nach `MAX_FORWARDS`.
  - Das Glob-Budget deckt diesen Pfad nicht ab.
- **Fehlerszenario:** Der Nutzer wählt im Dialog eine fremde, generierte oder kaputte Config, z. B. eine Datei mit vielen `LocalForward`-Zeilen unter `Host *`. Der Main-Thread steht 34 bis 50 s still (gemessen bei 4 MiB). Sitzungen, IPC und der Auto-Lock laufen in der Zeit nicht. Der Heap wächst um mehr als 1 GB, das Risiko eines OOM-Absturzes des Main-Prozesses ist real.
- **Fix-Richtung:**
  - Optionen gesamt begrenzen, analog zu `MAX_PATTERNS`, etwa 5000 Zeilen über alle Blöcke. Beim Überlauf gibt es `AppError('core.importTooLarge')` oder einen Zähler `tooMany`. Optionen von Blöcken, die keine Muster bekommen haben, gar nicht erst speichern.
  - Zusätzlich oder alternativ: Kein `flatMap` je Alias. Je Alias über die passenden Blöcke laufen und nur die gebrauchten Werte nach „erster Wert gewinnt“ sammeln: die sechs Schlüssel und höchstens `MAX_FORWARDS + 1` Forwards. Danach abbrechen, `optsByAlias` hält dann nur diese kleine Auswahl.
  - Regressionstest: 590 000 Zeilen `User x` + 500 Aliasse und 220 000 Zeilen `LocalForward 1 h:2` + 500 Aliasse, beide unter 1 s, oder `core.importTooLarge` unter 1 s.

### Minor

**N3 – Die Meldung bei Budget-Überlauf nennt eine falsche Ursache.** `src/shared/import-openssh.ts:33, 39` wirft `core.importTooLarge`. Der Text dazu lautet in `src/shared/locales/de-DE/errors/core.json:64` „Die Importquelle ist zu groß (höchstens 4 MiB).“ (en-US entsprechend).
- **Fehlerszenario:** Die Testeingabe in `import-openssh.test.ts:281-296` ist etwa 150 KB groß und löst die Meldung aus. Der Nutzer liest „höchstens 4 MiB“ zu einer Datei weit unter 4 MiB und kann nicht erkennen, was zu ändern ist.
- **Fix-Richtung:** Einen eigenen Code, etwa `core.importTooComplex`, in de-DE und en-US anlegen, z. B. „Die Importquelle enthält zu viele Muster, um sie zu prüfen.“ / „The import source has too many patterns to check.“ Alternativ den bestehenden Text neutral fassen, ohne 4 MiB. N2 kann denselben Code nutzen.

## 4. Fehlerweg `core.importTooLarge` zum Renderer, ohne Befund

- `parse()` läuft synchron in `readFromDialog` (`src/main/import-source.ts:122-123`), einer `async`-Funktion. Ein Wurf wird damit zur Ablehnung des Promise, das der IPC-Handler `src/main/index.ts:346-353` zurückgibt.
- `AppError` kodiert den Code in `message` (`src/shared/errors.ts:121` `encodeError`). Electron reicht die Meldung mit dem Präfix „Error invoking remote method …“ weiter.
- `ImportDialog.tsx:95` fängt sie ab, und `errorText` (`src/renderer/src/error-text.ts`) entfernt das Präfix über `decodeError`. Das ist derselbe Weg, den `core.importEncrypted` aus `parseMRemoteNg` schon nimmt. `import-source.test.ts:82, 136` belegt den Code für die Größenprüfung.
- `globMatch` mit unbegrenztem Budget (`:50`) hat außerhalb der Tests keinen Aufrufer.

## 5. Geprüft ohne Befund

- **Kollisionsschleife in `parseMRemoteNg`:** `while (keys.has(key))` ist über alle Kandidaten zusammen höchstens 500-mal wahr (Begründung oben). Gemessen mit gezielten Ids: 1 ms.
- **`clip`:** Schneidet nach UTF-16-Einheiten und lässt kein einzelnes High-Surrogate am Ende stehen. Ein gekürzter `Name` und das zugehörige Ordnersegment bleiben gültige Strings.
- **Abgeschnittene Muster bei `MAX_PATTERNS`:** Bricht eine Host-Zeile mitten in der Liste ab, fehlen ihr ggf. negierte Muster (`Host * … !bastion`), und ihre Optionen gelten dann auch für den ausgeschlossenen Alias. Das tritt erst ab 5000 Mustern auf, wird als `tooMany` angezeigt, und die Vorschau ist vor dem Übernehmen sichtbar. Ich nenne es als Restpunkt, nicht als Befund.
- **Lange, schlichte Muster:** Muster ohne `*`/`?` werden nicht verworfen. Sie bleiben als Alias erhalten und zählen dann als `invalid`. Als Muster kosten sie höchstens die Alias-Länge, also 255 Schritte je Vergleich.
