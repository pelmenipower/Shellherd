# KI-Maskierung – Nachprüfung Runde 2

Grundlage:
- Review `2026-10-25-ki-maskierung-review.md` (M-1 bis M-5)
- Ledger `.superpowers/sdd/2026-10-25-ki-maskierung/progress.md`. Ruling: alle fünf werden gefixt. Bei M-3 kommen nur glpat-, sk_live_/rk_live_, npm_, `.netrc` password und der ConvertTo-SecureString-Fehlgriff. Cookies und `.ppk` gehen als Grenze ins Handbuch.
- Fix-Diff `79ed760..21ec763`: `36ea39b` (M-2, M-3) und `21ec763` (M-1, M-4, M-5, Doku)

**Urteil: ready** – 5 Befunde geprüft: 4 ADDRESSED, 1 PARTIAL, 0 NOT ADDRESSED. Neu: 0 Critical, 0 Important, 4 Minor (N-1 bis N-4). Keiner blockiert. N-1 sollte vor dem nächsten Ausbau der Maskierung kommen.

Gates: `npm run typecheck` ist grün. `npx vitest run` ist grün mit 162 Dateien und 2534/2534 Tests, 10 mehr als im Review (2524). `src/` ist sauber, die Läufe gelten also für `21ec763`.

Proben (nur synthetisch, Node 24, Dateien im Scratchpad, `secret-mask.ts` direkt importiert):
- ReDoS: 18 feindliche Eingaben zu je 256 KiB auf die neuen Regeln.
- Speicher: Heap nach `gc()`, mit und ohne Kopie der Werte.
- Mutationen: `MAX_KNOWN = Infinity` gegen den K4-Test, und die alte `numbers.keys()`-Suche gegen den M-2-Test.
- Falsch-Positive der `.netrc`-Regel.

Live: Ich habe keine eigene Treiber-Probe gemacht. Die Fixes liegen in Main-Logik, in `rangeText` und in der Szene. Laut Ledger lief run-app Runde 2 (`masking` und `assistant`) gegen `out/run-app` grün. `out/` und `out/main` habe ich nicht angefasst. Es wurden weder ein echter Vault noch `%APPDATA%\Shellherd` geöffnet.

---

## Befunde aus dem Review

### M-1 LRU-Verdrängung – ADDRESSED
- `src/main/ai/assistant.ts:12`: `MAX_CONVERSATIONS = 256`. Die LRU-Logik in `masker()` (`:66-73`) ist unverändert, `cancelOwner`/`cancelAll` räumen weiter auf.
- Handbuch `:212` und Manual nennen die Grenze in den Grenzen. Der Wortlaut ist genauer als der Vorschlag im Review („nur noch durch die Regeln und die Vault-Werte“) und stimmt mit dem Code überein.
- Test `assistant.test.ts` „remembers the 256 most recent conversations …“ prüft beides:
  - Unterhaltung 2 bleibt nach 255 weiteren bekannt (`mysql -p[SECRET_1]`).
  - Unterhaltung 1 ist verdrängt und geht mit Klartext hinaus.

  Damit ist die Grenze festgehalten.

### M-2 Unbegrenztes `numbers` und Kopie je Nachricht – ADDRESSED
- `secret-mask.ts:217-233`: `recent` (älteste zuerst, höchstens `MAX_KNOWN`) ersetzt `[...numbers.keys()].filter(…)`. Die Suche kopiert und sortiert nur noch höchstens 1 000 Werte.
- `MAX_NUMBERS = 50_000` (`:10`). Bei Überlauf wirft `placeholder` (`:223`), und `prepare` macht daraus `ai.maskFailed`. Es wird nichts gesendet (`assistant.ts:85-88`, fail-closed).
  - Vault-Werte und bekannte Werte sind ausgenommen (`fromText = false`). Das ist korrekt: Vault-Werte sind durch die Vaultgröße begrenzt, bekannte Werte stehen schon in der Map.
  - `Verlauf leeren` erzeugt eine neue `conversationId` (`AssistantPanel.tsx:257`), also einen frischen Masker.
- Tests: Die Deckel-Probe „refuses new values beyond the cap but still masks known and vault values“ belegt das Fail-closed-Verhalten und die Ausnahmen.
- Einschränkungen:
  - Der Zeittest erkennt die alte Suche nicht (N-3).
  - Der gemeldete Extremfall beim Speicher ist unten bewertet (N-1).

### M-3 Formatlücken – PARTIAL
Die Regeln aus dem Ruling sind alle da:
- `glpat-`, `[sr]k_live_` und `npm_` (`:28-30`), jeweils mit Grenz-Lookbehind. `npm_` hat zusätzlich eine Grenze nach 36 Zeichen.
- `.netrc` (`NETRC`, `:54`, `netrcSpans`)
- `ConvertTo-SecureString` (`SECURE_STRING`, `:56`). Dazu lässt `FLAG` jetzt `(` aus (`:87`).
- Cookies und `.ppk` stehen als Grenze in Handbuch und Manual.
- Tests für Treffer, Doppelgänger (`sk_test_`, `pk_live_`, `npm_config_cache`, 19/35 Zeichen) und die beiden PowerShell-Formen. Die Laufzeiteinheiten sind um `login `, `ConvertTo-SecureString "`, `glpat-`, `npm_` und `sk_live_` erweitert.

Offen ist die Doku. Laut Fix-Richtung im Review wird die Aufzählung in Handbuch, Manual und CHANGELOG erweitert, sobald die Regeln da sind. Das ist nicht passiert:
- `docs/handbuch.md:196`, die Aufzählung „Erkannt werden“, nennt weder GitLab, Stripe und npm noch `.netrc` oder `ConvertTo-SecureString`. Das Manual auch nicht.
- `CHANGELOG.md:9` nennt sie ebenfalls nicht.

Die Liste ist abschließend formuliert und verspricht damit weniger, als der Code tut. Ein Sicherheitsrisiko ist das nicht, aber es widerspricht der Fix-Richtung.
- Fix (Eigentümer Doku): In Handbuch `:196` die Liste der Schlüssel um „GitLab (`glpat-…`), Stripe (`sk_live_…`, `rk_live_…`), npm (`npm_…`)“ ergänzen. Neue Zeile: „Passwörter in `.netrc`-Zeilen (`machine … login … password …`) und der Text in `ConvertTo-SecureString "…"`,“. Manual und CHANGELOG 0.25.0 entsprechend.
- Zur Mehrzeilen-Form von `.netrc` siehe N-2.

### M-4 `rangeText` hinter dem Cursor – ADDRESSED
- `terminal-access.ts:52-58` zieht `end` über die folgenden Fortsetzungszeilen vor. `continued` nutzt jetzt `end`, und die Schleife geht bis `end`.
- Einziger Aufrufer ist `read` (`:72`), über `screen` und `linesFrom`. Beide enden an `cursorLine()`. Die Erweiterung bleibt also in derselben logischen Zeile und liest keine fremde Ausgabe.
- Die Tests decken die Fortsetzung (`0,0 → 'abcdef'`) und das Stoppen an einer neuen logischen Zeile (`['ghi']` bleibt draußen) ab.

### M-5 Platzhalter-Prüfung der Szene – ADDRESSED
- `.claude/skills/run-app/screens.mjs:370-372` zählt Platzhalter nur noch in `role === 'user'`. Der Systemprompt (OpenAI-Form `role: 'system'`, Anthropic-Form `system`-Feld) zählt nicht mehr mit. Die Schwelle liegt bei 14, passend zu `DEMO_SECRETS`.
- Wäre `content` ein Array (Content-Blöcke), ergäbe `join` „[object Object]“ und die Prüfung schlüge fehl, statt fälschlich zu bestehen. Das ist der sichere Fehlermodus.
- Laut Ledger ist run-app Runde 2 grün.

---

## Zusätzlich bewertete Punkte

### Speicher: `MAX_NUMBERS` × `MAX_VALUE` ≈ 200 MB je Masker
Die Rechnung des Umsetzers trifft die falsche Größe. Pro Masker begrenzt ist nicht die Länge der Werte, sondern **der Text, den sie festhalten**.

- **Ehrlicher Renderer: nicht erreichbar.**
  - Je Frage kommen höchstens etwa 14 000 neue Zeichen hinzu (`SCREEN_CHARS` 6 000 + `OUTPUT_CHARS` 8 000 + Frage). Der übrige Verlauf wiederholt Bekanntes, und bekannte Werte werden nicht neu gespeichert.
  - 50 000 Werte zu je 4 KB hießen rund 200 MB **verschiedener** Geheimnisse, also mehr als 14 000 Fragen in einer Unterhaltung.
  - Probe: 500 Fragen zu je 14 000 Zeichen mit je einem neuen Wert ergeben +7,3 MB.
- **Kompromittierter Renderer: erreichbar.** Die IPC-Grenze (`ai/ipc.ts:14-21`) erlaubt 256 KiB je Anfrage, 40 Nachrichten zu je 64 KiB.
  - Der eigentliche Hebel ist V8: `current.slice(span.start, span.end)` (`secret-mask.ts:246`) erzeugt ab 13 Zeichen einen *SlicedString*. Der hält den ganzen Elterntext am Leben.
  - Probe: 2 000 neue Werte zu je 20 Zeichen aus Nachrichten zu je 64 KiB ergeben +128 MB. Mit Kopie (`JSON.parse(JSON.stringify(v))` oder `Buffer`-Rundreise) sind es +0,7 MB.
  - Bis zum Deckel sind das rund 1 250 Anfragen und etwa 320 MB je Masker, mal 256 Masker.
  - Der Angreifer braucht dafür nur einen eingetragenen Anbieter. Erreichbar sein muss der nicht, denn `prepare` läuft vor dem Senden.
- Das war schon vor dem Fix so, damals sogar ohne Deckel. Es ist also keine Regression, und deshalb nur Minor (N-1).

### `.netrc`-Heuristik: Prosa wie „login password for“
**Als Falsch-Positiv akzeptabel**, denn die Maskierung soll im Zweifel mehr verdecken.

Probe:
- „Enter your login password for the server“ wird zu „… password [SECRET_1] the server“. Das Deutsche („Login und Password für“) verhält sich genauso.
- `Last login: … password changed` bleibt stehen. Ebenso `[sudo] password for demo:` ohne `login`/`machine`.

Eine Nebenwirkung ist größer als der Einzeltreffer: Ist das Folgewort mindestens 6 Zeichen lang, wird es ein **bekannter Wert**. Bei „login password expired“ etwa wird „expired“ danach im ganzen Verlauf zu `[SECRET_n]`, auch im Fließtext. Das stört die Antwortqualität, verrät aber nichts.

Umgekehrt deckt die Regel die häufige mehrzeilige `.netrc`-Form nicht ab, weil `[^\n]` greift:
```
machine db
  login app
  password Synth-Pw-123
```
Dieser Text bleibt in der Probe unverändert. Beides steht in N-2.

### Flutungstest K4 von 12 auf 2 Runden
**Er prüft noch, was er soll.** K4 fordert, dass die Suche über bekannte Werte gedeckelt ist.
- Mutationsprobe mit `MAX_KNOWN = Infinity`: Runde 1 dauert 3 457 ms, Runde 2 6 650 ms. Der Test schlägt schon in Runde 1 fehl.
- Mit Deckel dauern beide Runden rund 220 ms.
- Die 12 Runden passen nicht mehr, weil 12 × 20 000 über `MAX_NUMBERS` liegt. 2 × 20 000 bleibt darunter, und der Kommentar sagt das.
- Das Langzeitverhalten über viele Runden sollte der neue M-2-Test abdecken. Der ist aber zu schwach (N-3).

### Neue Regeln: ReDoS
**ReDoS-frei.** Keine Regel hat verschachtelte Quantoren, alle Wiederholungen sind begrenzt.

| Regel | Schlechteste Probe (256 KiB) | Zeit |
|---|---|---|
| `glpat-`, `[sr]k_live_`, `npm_` | Präfix wiederholt, Präfix + 256 KiB `a` | 7–8 ms |
| `SECURE_STRING` | `ConvertTo-SecureString "` wiederholt, `-String "a…` ohne Schluss, 8 Leerzeichen | 7–18 ms |
| `FLAG` mit `(` | `-Password (` wiederholt | 11 ms |
| `NETRC` | `login ` wiederholt | **121 ms** |
| `NETRC` | `login\t` / `machine a ` / `login + 1018 x` / `login password ` | 124 / 82 / 7 / 21 ms |

Bei `NETRC` gibt es einen begrenzten Rückschritt. Das lazy `[^\n]{0,1024}?` prüft an jedem `login`-Anfang bis zu 1 024 Stellen auf `\bpassword`, das ergibt O(n · 1 024). Die 121 ms liegen deutlich unter der Testschwelle und sind linear in n.

---

## Neue Befunde

### Critical
Keine.

### Important
Keine.

### Minor

**N-1 Gespeicherte Werte halten ihren ganzen Quelltext fest (SlicedString). Der Speicher je Masker ist nur durch die Anzahl begrenzt.** – `src/main/ai/secret-mask.ts:246`, `:223-229`
- Ursache: Ab 13 Zeichen ist `value` ein Ausschnitt-String von V8. `numbers`/`recent` behalten ihn und damit die ganze Nachricht (bis 64 KiB, zweibytig bis 128 KB). `MAX_NUMBERS` deckelt die Anzahl, nicht die Bytes.
- Szenario: Ein kompromittierter Renderer schickt je Anfrage 40 Nachrichten zu je 6,4 KiB, jede mit einem neuen Wert ab 13 Zeichen. Nach rund 1 250 Anfragen hält ein Masker etwa 320 MB. Das wiederholt er über bis zu 256 `conversationId`s, und Main läuft voll. Mit ehrlichem Renderer bleibt es im einstelligen MB-Bereich (Probe: 7,3 MB nach 500 Fragen).
- Fix (Eigentümer `secret-mask.ts`, klein):
  - In `placeholder` den Wert vor dem Speichern lösen, verlustfrei auch für einzelne Surrogates: `value = JSON.parse(JSON.stringify(value))` (nur im Zweig `number === undefined`).
  - Zusätzlich die Bytes deckeln: `export const MAX_STORED_CHARS = 1_000_000`. Die Summe der Längen der Werte aus Text zählt mit, und bei Überschreitung wirft `placeholder` genauso fail-closed wie bei `MAX_NUMBERS`.
  - Ein ehrlicher Verlauf erreicht das nicht: Das wären rund 70 Fragen, deren gesamter Kontext aus Geheimnissen besteht.
  - Dann gilt je Masker höchstens etwa 2 MB Werte plus Map-Overhead. Wahlweise `MAX_NUMBERS` auf 10 000 senken, damit der Worst Case über 256 Masker im Bereich einiger hundert MB bleibt.
- Test (`secret-mask.test.ts`): Ein Wert mit mehr als `MAX_STORED_CHARS` Gesamtlänge aus Text führt zum Wurf, Vault-Werte nicht. Den Heap-Nachweis für das Lösen nicht als Unit-Test bauen, er ist zu flackrig.

**N-2 `.netrc`: Prosa erzeugt bekannte Werte, die mehrzeilige Form fehlt** – `src/main/ai/secret-mask.ts:54`
- Ursache: Die Regel braucht `machine` oder `login` **in derselben Zeile** vor `password`, egal wo in der Zeile.
- Szenario A: Prosa wie „your login password expired“. „expired“ wird bekannter Wert und im ganzen Verlauf verdeckt. Das stört, verrät aber nichts.
- Szenario B: Ein `cat ~/.netrc` in der üblichen mehrzeiligen Form (`machine`, `login` und `password` je in einer eigenen Zeile) geht mit Passwort im Klartext hinaus. Die Doku nennt `.netrc` weder als erkannt noch als Grenze.
- Fix (Eigentümer `secret-mask.ts`, eine Regel):
  - Neben der bestehenden Regel eine zweite für Zeilen, die nur aus `password <wert>` bestehen: `/^[ \t]{0,64}password[ \t]{1,8}(?=\S)/gim`. Sie läuft durch dieselbe `netrcSpans`-Schleife, ist linear und verankert.
  - Fließtext ist selten eine Zeile, die mit `password ` beginnt und genau ein Wort weiterläuft.
  - Prosa mit `login … password` in der Mitte der Zeile bleibt ein akzeptierter Falsch-Positiv.
  - Falls das nicht gewollt ist, gehört die mehrzeilige `.netrc`-Form in die Grenzen von Handbuch und Manual: „`.netrc`-Einträge über mehrere Zeilen“.
- Test: der mehrzeilige Block oben → `password [SECRET_1]`. `Password: ` und `[sudo] password for demo:` bleiben.

**N-3 Der M-2-Zeittest erkennt die alte Suche nicht** – `src/main/ai/secret-mask.test.ts:243`
- Ursache: 10 Werte je Nachricht ergeben am Ende rund 24 000 Einträge. Die alte Kopie mit `filter` kostet dann nur etwa 17 ms je Runde, bei einer Schwelle von 250 ms.
- Mutationsprobe: Mit der alten Zeile `[...this.numbers.keys()].filter(…).slice(-MAX_KNOWN)` bleibt der Test grün (17 ms gegenüber 7 ms).
- Wirkung gering: Die Begrenzung trägt der Deckeltest (`MAX_NUMBERS`), und die gedeckelte Suche trägt K4.
- Fix (Eigentümer `secret-mask.test.ts`): Den Fall direkt prüfen.
  - Masker bis knapp unter `MAX_NUMBERS` füllen, wie im Deckeltest.
  - Danach 41 kurze `mask`-Aufrufe ohne neue Werte messen, Schwelle 50 ms.
  - Mit der alten Kopie (49 000 Schlüssel × 41) reißt das die Schwelle. Vorher mit der Mutation prüfen.

**N-4 Nach dem Deckel bleibt die Unterhaltung stumm gesperrt, die Meldung nennt keinen Ausweg** – `src/main/ai/secret-mask.ts:223`; `src/shared/locales/de-DE/errors/ai.json:8`
- Ursache: Ist `MAX_NUMBERS` erreicht, scheitert jede weitere Frage mit neuem Wert in dieser Unterhaltung mit `ai.maskFailed`: „Shellherd konnte den Text nicht auf Geheimnisse prüfen und hat nichts gesendet.“
  - Erst `Verlauf leeren` hilft, das sagt die Meldung aber nicht.
  - Das Handbuch nennt den Deckel nicht.
- Wirkung gering: Mit ehrlichem Renderer ist der Fall praktisch nur über Ausgaben mit sehr vielen kurzen `name=wert`-Paaren erreichbar, z. B. `env`-Dumps fremder Systeme in Tausenden Runden.
- Fix: einen eigenen Code `ai.maskLimit` anlegen, de-DE „Dieser Verlauf enthält zu viele maskierte Werte. Leere den Verlauf, um weiterzufragen.“, en-US „This history holds too many masked values. Clear the history to keep asking.“
  - `placeholder` wirft eine markierte Ausnahme, `prepare` bildet sie auf `ai.maskLimit` ab und alles andere weiter auf `ai.maskFailed`.
  - Alternativ, ohne neuen Key, in den Grenzen von Handbuch und Manual ergänzen: „mehr als 50.000 verschiedene erkannte Werte in einem Verlauf: Shellherd sendet dann nichts mehr, bis du den Verlauf leerst,“.

---

## Ergebnis

| Befund | Status | Beleg |
|---|---|---|
| M-1 | ADDRESSED | `assistant.ts:12`, Handbuch/Manual-Grenze, Test mit 257 Unterhaltungen |
| M-2 | ADDRESSED | `recent` + `MAX_NUMBERS` fail-closed, Deckeltest. Zeittest schwach (N-3) |
| M-3 | PARTIAL | Regeln laut Ruling vollständig und getestet, Cookies/.ppk als Grenze. Aufzählung „Erkannt werden“ und CHANGELOG nicht erweitert |
| M-4 | ADDRESSED | `terminal-access.ts:52-58`, zwei Tests |
| M-5 | ADDRESSED | `screens.mjs:370-372`, nur `user`-Nachrichten, Schwelle 14 |

**Urteil: ready.** Kein Critical und kein Important. Den Doku-Rest von M-3 und N-1 bis N-4 kann ein Folgepaket erledigen. N-1 vor dem nächsten Ausbau der Maskierung.
