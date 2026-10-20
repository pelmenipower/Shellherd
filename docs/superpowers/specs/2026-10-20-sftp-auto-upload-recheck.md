# SFTP Auto-Upload – Nachprüfung (Stufe 5b)

Nachprüfung der Fix-Welle gegen den bindenden Review `2026-10-20-sftp-auto-upload-review.md`. Geprüft wurden `git log 791ccca..HEAD` (`7f8711e`, `0bce7d1`, `5b5d8ff`) und `git diff 791ccca..HEAD`, 10 Dateien.

**Urteil: nicht mergebar ohne einen kleinen Nachfix.** 7 von 9 Befunden sind erledigt (ADDRESSED). m1 ist nicht erledigt (NOT ADDRESSED), der Fix greift in keinem UI-Ablauf. M5 ist für Deutsch erledigt, bringt aber eine neue Darstellungsregression (N1). Neu sind 1 Important (N1) und 2 Minor (N2, N3). Beide Abweichungen der Umsetzer werden hingenommen (ACCEPTED).

Gate-Stand: `npm run typecheck` ist grün. `npx vitest run` lief dreimal hintereinander grün, jedes Mal 124 Dateien und 1770 Tests, ohne Timeout.

---

## Sicherheit

Durch die Welle hat sich nichts verschlechtert. `move: false`, die Containment-Prüfungen, `SyncSchema` und die Bindungs-ID als einzige Eingabe sind unverändert. Neu ist im Main ein `lstat(source)` in `itemFailed` (`auto-upload.ts:296`). Es liest nur den lokalen Pfad, der vorher schon geprüft wurde. Secrets, kubeconfig, „Nur lesen“ und der Bestätigungspfad sind nicht berührt. Das in m1 beschriebene Löschrisiko (N5) besteht weiter, siehe m1.

---

## Je Befund

| # | Status | Beleg |
|---|---|---|
| B-R1 | **ADDRESSED** | `sftp-loopback.test.ts:134`: `}, 30_000);`. Drei volle Läufe waren grün. Die Abweichung beim Warten ist unten bewertet. |
| M1 | **ADDRESSED** | `Bound.sent` (`auto-upload.ts:43`), `sent.set` nach `known.set` (`:282`). Der Hook (`:269-276`) entspricht wörtlich dem Review. Beide Tests sind da (`auto-upload.test.ts` „uploads a same-size change within a second …“, „… when the server keeps its own time“). Die drei Bestandstests sind grün. |
| M2 | **ADDRESSED** | `retries` (`:60`, Start 0). Nur `planTransfer` steht im `try` (`:208-216`), `local.list(root)` bleibt außerhalb. Beide Tests sind da („compares again when a file vanishes …“, „ends in error when a file keeps vanishing …“). Siehe auch N3. |
| M3 | **ADDRESSED** | `itemFailed` ist async und hat ein `lstat(source)` (`:292-296`). Beide Aufrufer verwenden `await` (`:261` mit `abs`, `:278` mit `item.source`). Es gibt `missingOn` im Fake und den Test „reports a missing server folder as failed …“. „never mirrors a local deletion“ ist grün. |
| M4 | **ADDRESSED** | Der Helfer `syncTouchesFolder` steht wörtlich so in `auto-upload-form.ts:71-76`, mit allen 7 Prüfungen in `auto-upload-form.test.ts`. `syncSeen` hat `synced` an beiden Stellen (`FilesPanel.tsx:168`, `:210`). `syncRefresh` hat einen Throttle und `clearTimeout` im Cleanup (`:228`). Die Abnahme bestätigt den Neuaufbau nach etwa 1 s. `screens.mjs` wartet zusätzlich auf die Zeile `readme.txt`, das ist sinnvoll. |
| M5 | **ADDRESSED (de, mit Aktion)**, Regression siehe N1 | Das Token `--toast-text-min: 200px` steht in `tokens.css:54-55`, die Doku-Zeile in `design-system.md:83`. `flex-wrap`, `flex: 1 1 var(--toast-text-min)` und `.toast-action { margin-left: auto }` sind gesetzt. Die Abnahme bestätigt: Der Titel steht einzeilig, die Knöpfe stehen in Zeile 2. `row-gap` wirkt nicht, siehe N2. |
| m1 | **NOT ADDRESSED** | Siehe unten. |
| m2 | **ADDRESSED** | `setState` hat als erste Zeile `if (b.closed \|\| b.status.state === 'error') return;` (`:312`). |
| m3 | **ADDRESSED** | `.catch(error => setActionError(errorText(error, tRef.current('files:actionFailed'))))` (`FilesPanel.tsx:177`). Die Deps sind unverändert, `setActionError` ist ein State-Setter und stabil. |

### m1 im Einzelnen (NOT ADDRESSED)

- **Ort:** `src/main/files/auto-upload.ts:76` (`const previous = this.bound.get(binding.id)?.current;`) und `:112-121` (`stop` löscht die Bindung aus `this.bound`).
- **Befund:** Alle Abläufe in der UI rufen **zuerst** `sftpSyncStop` und danach `sftpSyncStart` auf. Das gilt für „Bearbeiten“ (`FilesPanel.tsx:276-277`) und für „Anhalten“ mit anschließendem „Fortsetzen“ (`:281-283`). `stop` entfernt die Bindung aus der Map. Deshalb ist `previous` beim folgenden `start` immer `undefined`, und `await previous` wartet auf nichts. Gewartet wird nur, wenn `start` direkt auf eine laufende Bindung trifft, und das kommt in der UI nicht vor. Genau die beiden Szenarien aus dem Review sind also ungeschützt.
- **Test:** Der Test „a restarted binding waits for the aborted run …“ ruft ebenfalls zuerst `stop` und dann `start` auf. Er prüft den Fix also nicht. Er ist grün, weil im Fake `removeFile` der `.part` sofort nach dem Abbruch synchron läuft, also lange vor dem neuen `write`. Er wäre auch ohne die Zeile `await previous` grün.
- **Praktisches Risiko:** Gering. Auf demselben SFTP-Kanal schickt der alte Lauf `remove(.part)` gleich nach dem Abbruch. Der neue Lauf braucht vor dem `open` mehrere Roundtrips (`realpath`, `stat`, `list`, `planTransfer`). OpenSSH arbeitet Anfragen der Reihe nach ab. Garantiert ist das nicht, und wenn es schiefgeht, ist die Serverdatei weg (N5).
- **Fix-Richtung (klein):** Die letzte Drain-Promise wird je ID außerhalb von `Bound` gehalten, damit sie `stop` übersteht. Das deckt auch einen dreifachen Neustart ab (A → B → C, B hat nie einen Drain).
  ```ts
  private readonly runs = new Map<string, Promise<void>>();
  // flush:
  b.current = this.drain(b);
  this.runs.set(b.status.bindingId, b.current);
  return b.current;
  // start, statt Zeile 76:
  const previous = this.runs.get(binding.id);
  ```
  Aufräumen: Am Ende von `drain` (`finally`) wird der Eintrag gelöscht, wenn `this.runs.get(id) === b.current`. Optional ist `Bound.current` dann überflüssig.
- **Test-Richtung:** `fakeRemote` bekommt `removeDelayMs`. Damit wird `removeFile` für `*.part` verzögert, zum Beispiel um 300 ms. Ohne den Fix liegt das zweite `write:/srv/big.txt.part` dann vor `removeFile:/srv/big.txt.part`, und der bestehende Test schlägt fehl. Mit dem Fix ist er grün.

---

## Bewertung der beiden Abweichungen

### `if (b.closed) return;` nach `await previous` (`auto-upload.ts:91`): ACCEPTED

Die Zeile ist richtig. Wird die Bindung gestoppt oder neu gestartet, während `start` auf den alten Lauf wartet, bricht sie die Arbeit an einer schon geschlossenen Bindung ab. `stop` hat dann bereits `closed` gemeldet. Ohne die Zeile liefen `lstat`, `realpath` und die Remote-Prüfungen umsonst, und ein Fehler ginge über den Guard in `catch` (`:104`) verloren. Den Watcher schützt schon die Prüfung in `:99`. Die Zeile ist also harmlos und spart unnötige Arbeit. Mit dem m1-Nachfix wird sie wirklich gebraucht.

### Loopback-Test wartet auf `synced === 2` (`sftp-loopback.test.ts:104-106`): ACCEPTED

Die Diagnose stimmt. `upload` setzt `known` erst nach `remote.stat(item.target)`, also nach dem Rename (`auto-upload.ts:281`), und zählt `synced` erst danach hoch (`:284`). Wenn der Test auf `synced === 2` wartet, ist `known` sicher gebucht. Die Inhaltsprüfung bleibt als `expect` erhalten, der Test wird dadurch nicht schwächer.

**Ist das Zeitfenster im Produkt ein Risiko?** Nein, es ist kein relevantes Risiko, es kommt als Nachtrag ins Risikoregister:

- **R-NEU (Rennfenster beim Zurücklesen der Serverzeit):** Schreibt ein Dritter die Serverdatei genau zwischen unserem Rename und unserem `stat`, übernehmen wir seine mtime als `known`. Den nächsten lokalen Stand halten wir dann nicht für „Server neuer“ und überschreiben seine Änderung, ohne die Datei als übersprungen zu melden. Das Fenster ist ein einziger SFTP-Roundtrip, also Millisekunden. Es gehört zur selben Klasse wie ein fremdes Schreiben während unseres eigenen Uploads: Da gewinnt ohnehin das Rename, und auch das erkennt kein Mechanismus. Echtes gleichzeitiges Schreiben ist mit einer Einweg-Spiegelung ohne Sperren nicht lösbar. Im Test trat das Fenster nur auf, weil der Test selbst die zweite Partei war und genau darauf gewartet hat. **Hingenommen**, die Handbuch-Aussage „Server neuer wird übersprungen“ gilt nach bestem Bemühen und ist keine Garantie.

---

## Neue Befunde (nur im Fix-Diff)

### N1 (Important): Toasts mit kurzer Aktion schieben „Schließen“ allein links in eine zweite Zeile

- **Ort:** `src/renderer/src/components/toast-ui.css:4` (`flex-wrap: wrap`), `:14` (`.toast-action { margin-left: auto; }`) und `Toast.tsx:47-52` (Aktion und „Schließen“ sind getrennte Flex-Kinder).
- **Rechnung** (`tokens.css`: `--space-12` = 12, `--space-10` = 10, `--fs-sm` = 12 px, `--size-dot` = 8; Breite des Stapels `min(400px, …)`). Innenbreite = 400 − 2 × 1 (Rand) − 2 × 12 (Padding) = **374 px**. Der Review nannte 348, das Ergebnis ändert sich dadurch nicht. Knopfbreiten bei Inter 12 px, geschätzt ≈ 6,5 px je Zeichen plus 2 × 10 Padding plus 2 Rand:

  | Toast | Zeile 1 bis zur Aktion | Umbruch |
  |---|---|---|
  | ohne Aktion, de („Schließen“ ≈ 77) | 8 + 12 + 200 + 12 + 77 = **309 ≤ 374** | keiner, einzeilig. Der Text wächst auf etwa 265 px. **Erfüllt.** |
  | ohne Aktion, en („Close“ ≈ 54) | 286 ≤ 374 | keiner. **Erfüllt.** |
  | „Trotzdem überschreiben“ ≈ 157, de | 8 + 12 + 200 + 12 + 157 = 389 > 374 | Aktion und „Schließen“ rechtsbündig in Zeile 2. **Erfüllt**, entspricht der Abnahme. |
  | „Overwrite anyway“ ≈ 125, en | 357 ≤ 374, mit „Close“ 423 > 374 | Die Aktion bleibt in Zeile 1, **„Close“ rutscht allein in Zeile 2, linksbündig unter den Punkt.** |
  | Vault-Fehler „Erneut versuchen“ ≈ 122, de (`usePersistVault.ts:35`) | 354 ≤ 374, mit „Schließen“ 443 > 374 | Ebenso: **„Schließen“ allein links in Zeile 2.** Das ist eine Regression an einem bestehenden deutschen Fehler-Toast. |

  Ein Hinweis ohne Aktion bleibt also rechnerisch einzeilig, mit 65 px Reserve. Einzeilig bleibt er ab einer Toast-Breite von 335 px, das entspricht einer Fensterbreite von 359 px. Das Hauptfenster hat `minWidth` 900, das Nebenfenster 480.
- **Fehlerszenario:** Ein Vault-Speicherfehler oder der englische Hinweis „übersprungen“ zeigt „Schließen“/„Close“ getrennt von der Aktion, links unter dem Statuspunkt. Der Knopf wirkt zugehörig zum Text, nicht zur Aktion, das Layout ist zerrissen.
- **Fix-Richtung:** Beide Knöpfe kommen in `Toast.tsx` in eine gemeinsame Gruppe, `<div className="toast-buttons">{action…}<button className="toast-close" …/></div>`. CSS: `.toast-buttons { flex: 0 0 auto; display: flex; gap: var(--space-8); align-self: center; margin-left: auto; }`, die Regel `.toast-action { margin-left: auto; }` entfällt. Die Gruppe bricht dann nur als Ganzes um und steht immer rechts. In Zeile 1 wirkt `margin-left: auto` nicht, weil der wachsende Text den Platz nimmt. Danach `run-app` mit einem englischen „übersprungen“-Toast oder einem Vault-Fehler-Toast prüfen.

### N2 (Minor): `row-gap` wird vom späteren `gap` überschrieben

- **Ort:** `toast-ui.css:4`: `… flex-wrap: wrap; row-gap: var(--space-8); align-items: flex-start; gap: var(--space-12); …`
- **Fehlerszenario:** Die Kurzschreibweise `gap` setzt `row-gap` und `column-gap`. Weil sie später in der Regel steht, beträgt der Zeilenabstand 12 px statt der verlangten 8 px. Das sieht man nur am Abstand zur zweiten Zeile.
- **Fix-Richtung:** `row-gap` entfällt, stattdessen `gap: var(--space-8) var(--space-12);`.

### N3 (Minor): Ein Wiederholungslauf zeigt kurz „Überwacht“

- **Ort:** `auto-upload.ts:185-186` zusammen mit `:213`.
- **Fehlerszenario:** Plant `fullSync` eine Wiederholung und kehrt normal zurück, setzt `drain` den Zustand auf `watching`. Etwa 500 ms später setzt der nächste Flush ihn wieder auf `syncing`. Die Zeile springt kurz auf „Überwacht“, obwohl der Abgleich noch aussteht. Es geht nichts verloren. **Hingenommen**, einen Fix kann man optional nachziehen: `fullSync` gibt bei einer Wiederholung `false` zurück, und `drain` setzt `watching` nur bei `true`.

---

## Restpunkte an den Nutzer

1. **Vor dem Merge beheben (klein, eine Datei mit Test):** m1 mit der `runs`-Map und dem Test mit `removeDelayMs`. Sonst bleibt der bindende Fix aus dem Review wirkungslos. Das Restrisiko ist zwar gering, im Fehlerfall aber eine gelöschte Serverdatei.
2. **Vor dem Merge beheben (zwei Dateien):** N1 mit der Knopfgruppe in `Toast.tsx` und `toast-ui.css`, N2 in derselben Zeile. Danach den Vault-Fehler-Toast (de) oder den „übersprungen“-Toast (en) per `run-app` ansehen.
3. **Hingenommen, nur zur Kenntnis:** R-NEU (Rennfenster beim Zurücklesen der Serverzeit) und N3 (kurzes „Überwacht“ bei einer Wiederholung).
4. Ein Hinweis ohne Aktion wurde nicht live gesehen. Rechnerisch bleibt er einzeilig (309 von 374 px, de).
