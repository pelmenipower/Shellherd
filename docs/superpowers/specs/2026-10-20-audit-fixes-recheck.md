# Audit-Fixes – Nachprüfung (Stufe 8)

Branch `claude/feature/audit-fixes`, Fix-Diff `eac52ab..HEAD` (Commits e4aa3bd, 60d24e0, 6cf4b6a, 13 Dateien). Grundlage: Review `2026-10-20-audit-fixes-review.md`.

**Urteil: done with open points.** 7 von 7 Befunden ADDRESSED. Neu: 0 Critical, 0 Important, 1 Minor (n1). Dazu zwei ACCEPTED-Hinweise ohne Fix. Es gibt keine zweite Fix-Welle; n1 geht an den Nutzer.

## Gate

- `npm run typecheck`: grün.
- `npx vitest run`: 120 Dateien und 1669 Tests grün. Gegenüber dem Review sind das 1 Datei (`sftp-file-system.test.ts`) und 8 Tests mehr. `src/shared/version.test.ts` ist grün.
- CHANGELOG 0.12.1: de und en haben je 11 Einträge. Der neue Eintrag zu M2 steht in beiden an derselben Stelle (Position 3) und entspricht wörtlich dem Vorschlag aus dem Review.

## Befunde aus dem Review

| Befund | Status | Beleg |
|---|---|---|
| M1 Symlink wird durch `.part` ersetzt | ADDRESSED | `transfer.ts:93` löst bei vorhandenem Ziel mit `to.realpath` auf. `copyFile` und `setModified` nutzen den echten Pfad (`:94-95`). `realpath` steht jetzt in `FileSystem` (`file-system.ts:27`, lokal `:97`), SFTP nutzt die bestehende Methode, die Memory-FS bildet auf sich selbst ab. Test `transfer.test.ts:135`: Er wäre ohne Fix rot, weil `/target/link` sonst `new` enthielte. |
| M2 Uploads auf 0666 | ADDRESSED | `sftp-file-system.ts:60`: `createWriteStream(path, { mode: mode ?? 0o644 })`. `runTransfer` reicht `existing?.mode` weiter (`transfer.ts:94` → `:117`). `mode` ist auf `& 0o7777` maskiert (`sftp-file-system.ts:26`), Typbits gelangen also nicht zu `fchmod`. Tests: `sftp-file-system.test.ts` (0644 ohne und 0600 mit Mode) und `transfer.test.ts:145`. |
| M2 Zusatz: Remote-Edit-Upload (6cf4b6a) | ADDRESSED | `remote-edit.ts:90` schreibt mit `remote?.mode`. `remote` ist das `stat` aus der Konfliktprüfung; es folgt Links, liefert also die Mode der echten Datei. Ist die Datei inzwischen gelöscht, ist `remote` null und es gilt 0644. Test `remote-edit.test.ts:20` erwartet `write('/srv/run.sh', 0o755)`. |
| m1 Marker im Updater | ADDRESSED | `AssistantPanel.tsx:104`: `access.mark()` steht jetzt vor `update(...)`. Im Updater bleibt nur `clearAwaiting` → `dispose()`. Läuft das in StrictMode doppelt, wird derselbe alte Marker zweimal entsorgt; xterm-`dispose` ist idempotent. |
| m2 `catch` schluckt alles | ADDRESSED | `window-ipc.ts:70`: Vorabprüfung über `owns()`, danach kein `try/catch` mehr. Test `window-ipc.test.ts:30` prüft, dass `boom` durchschlägt. |
| m3 knappe Timeouts | ADDRESSED | `connection-test.test.ts:56`: `timeout: 1_000`, Dialog 2000 ms, wie K13. |
| m4 Ausweichpfad ungetestet | ADDRESSED | `transfer.test.ts:155-177`: `rename` lehnt ein vorhandenes Ziel ab. (a) Das Ziel wird ersetzt, `.part` ist weg. (b) Bei gesperrtem `removeFile` bleibt das alte Ziel, `.part` ist weg, der Fehler `exists` wird gemeldet. |
| m5 deutscher Kommentar | ADDRESSED | `transfer.ts:114`, Wortlaut wie im Review vorgeschlagen. |

## Gezielt geprüfte Fälle

- **realpath bei nicht vorhandenem Ziel:** wird nicht aufgerufen (`existing ? … : item.target`). Ein toter Link liefert bei `stat` null; dann ersetzt `.part` den toten Link. Das ist hinnehmbar, weil es dort keine Datei gibt, deren Inhalt verloren geht.
- **Symlink auf ein Verzeichnis:** `stat` folgt dem Link, liefert `type: 'directory'` und wirft `files.existsAsDirectory` (`transfer.ts:76`), bevor `realpath` läuft. Das Verhalten ist unverändert.
- **Lokal unter Windows (Downloads mit Überschreiben):** `fs.promises.realpath` läuft nativ. Ein Netzlaufwerk wird zum UNC-Pfad aufgelöst, `.part` und `rename` funktionieren dort. Ein `subst`-Laufwerk wird zum echten Pfad aufgelöst, das ist harmlos. Offen bleibt n1.
- **SFTP-Mode beim Überschreiben:** `.part` ist neu und gehört dem Nutzer, `fchmod(existing.mode)` greift also. Bei setuid-Bits übernimmt der Besitzer sie; das ist zulässig. Besitzer und Gruppe der alten Datei gehen weiterhin verloren (wie im Review ACCEPTED).
- **ssh2 `fchmod` auf bestehenden Dateien (Remote-Edit):** `SFTP.js:3949` ruft `fchmod` auf. Schlägt es fehl (fremde Datei, `EPERM`), folgt `chmod` mit ignoriertem Fehler (`:3911-3915`), der Stream läuft weiter. Gruppen-beschreibbare Dateien fremder Nutzer lassen sich also weiter speichern, und ihre Mode bleibt. Vor dem Fix versuchte ssh2 hier 0666, jetzt die alte Mode: Das ist eine reine Verbesserung.
- **`sftp-session.ts:170` (neue Datei):** `createFile` ruft `fs.write(path)` auf und legt damit 0644 statt 0666 an. Siehe ACCEPTED A1.
- **`moveSession`: Rennen zwischen `owns` und `transferOwner`?** Es gibt keins. Beide Aufrufe sind synchron, ohne `await` dazwischen, im selben Tick des Main-Prozesses (`window-ipc.ts:70-76`). `owns` prüft genau die Bedingung, an der `owned()` in `transferOwner` scheitern würde (`ssh/session.ts:548`, `rdp/host.ts:141`, `sftp-session.ts:288`). Bleibt ein Fehler übrig, etwa `getNativeWindowHandle` auf einem zerstörten Zielfenster (`rdp/host.ts:129`), steigt er wie vor #11 auf. Das war die Absicht von m2.
- **Marker-Lebensdauer:** Ein Marker entsteht pro Klick nach 400 ms und wird beim nächsten `clearAwaiting` entsorgt (`:119`, `:158`, `:161`). Siehe ACCEPTED A2.

## Neue Befunde (nur im Fix-Diff)

**n1 (Minor) – `realpath` kann ein lokales Überschreiben abbrechen, das vorher funktioniert hat.** Betroffen ist `src/main/files/transfer.ts:93` mit lokalem Ziel (Download) unter Windows.
- Fehlerszenario: Das native `realpath` von Node schlägt auf manchen virtuellen Laufwerken fehl, etwa RAM-Disks (ImDisk), einigen Cloud- und Krypto-Laufwerken oder FUSE-artigen Treibern (`EISDIR`/`EPERM`/`UNKNOWN`). Der Download einer vorhandenen Datei bricht dann mit einem rohen Fehler ab, obwohl Schreiben und Umbenennen dort gingen. Neue Dateien sind nicht betroffen.
- Fix-Richtung: `const target = existing ? await to.realpath(item.target).catch(() => item.target) : item.target;`. Fällt `realpath` aus, gilt das Verhalten von vor M1. Test: Memory-FS mit `realpath`, das wirft; das Ziel wird trotzdem überschrieben.

## ACCEPTED (kein Fix)

- **A1:** `mode ?? 0o644` wird per `fchmod` gesetzt, ohne umask. Bei einem Nutzer mit `umask 077` legen Upload und „Neue Datei“ also 0644 statt 0600 an. Das ist die Vorgabe aus dem Review und deutlich enger als vorher (0666).
- **A2:** Wird das Panel innerhalb der 400 ms geschlossen, entsteht der Marker trotzdem und lebt bis zum Ende des Terminals. Dasselbe gilt für einen Marker, der beim Schließen des Panels noch in `awaiting` steht: Es gibt keinen Unmount-Cleanup. xterm entsorgt beide mit dem Terminal, ein sichtbarer Schaden entsteht nicht. Der m1-Teil „doppelter Marker durch StrictMode“ ist behoben.

## Sicherheit

Durch den Fix-Diff ändert sich nichts an Bestätigungspfad, „Nur lesen“, Secrets oder kubeconfig. Es gibt keinen neuen Tippweg; `typeIntoTerminal` hat weiterhin nur Klick-Aufrufer. Die Mode-Übernahme macht Uploads weniger offen als vorher.
