# Übertragungen fortsetzen und beschleunigen – Nachprüfung (Stufe 6)

Branch `claude/feature/transfer-resume`, geprüft als `git diff 507e0a4..HEAD` (2 Commits: `2058664`, `12e17a1`, 9 Dateien, +59/−29). Grundlage: Review `2026-10-21-transfer-resume-speed-review.md` (bindend), Ledger `.superpowers/sdd/2026-10-21-transfer-resume/progress.md`.

Urteil: mergebar ja. 6 von 6 Befunden ADDRESSED, 0 neue Befunde im Fix-Diff. Ein Restpunkt außerhalb des Fix-Diffs geht an den Nutzer (siehe unten).

## Läufe

- `npm run typecheck` ist grün.
- `npx vitest run` lief zweimal (dazu ein dritter Lauf für die Zahlen): 132 Dateien, 1940 Tests, alle grün. Vorher waren es 1937 Tests. Dazu kommen 2 neue Tests und 2 neue `it.each`-Fälle, 1 Test entfiel.
- Im Diff gibt es keine binäre Datei (`git diff --numstat 507e0a4..HEAD | grep '^-'` ist leer) und kein CRLF in den geänderten Blobs (`git grep -lIP '\r$' HEAD -- <Dateien>` ist leer).
- Nach allen Mutationsproben wurde aus einer Sicherung in der Scratchpad zurückkopiert. `git status --short src/` ist leer, es bleibt nichts geändert.

## Befunde

| Befund | Status | Beleg |
|---|---|---|
| C1 Injektion über PowerShell | ADDRESSED | Siehe unten |
| I1 Leck durch `Promise.race` | ADDRESSED | Siehe unten |
| I2 `x` und `x.part` parallel | ADDRESSED | Siehe unten |
| M1 Doku-Sätze | ADDRESSED | `docs/handbuch.md:356`: „Dateinamen mit Zeichen wie `&`, `$`, `\` oder `'` lassen sich nicht prüfen.“ `docs/manual.md:352`: „File names with characters such as `&`, `$`, `\` or `'` cannot be verified.“ Beide Sätze sind wörtlich wie verlangt. `.claude/skills/run-app/SKILL.md:50` lautet jetzt „READ-, WRITE- und CLOSE-Antwort“. |
| M2 Loopback-Teil wirkungslos | ADDRESSED | `sftp-loopback.test.ts:327–336`: Die Sleeps und der `writes`-Vergleich sind entfernt, der Kommentar steht wörtlich, und der Testname ist umbenannt. `lateWrites` bleibt als Rauchtest. |
| M3 Zeile verschwindet zu früh | ADDRESSED | Siehe unten |

### C1 – ADDRESSED

- `verify.ts:12`: Die Positivliste lautet jetzt wörtlich `/^[\p{L}\p{N}\p{M} _.\/+,=@~#:()[\]-]+$/u` und enthält kein `'` mehr. Der Kommentar ist wörtlich übernommen, `verifyCommand` ist unverändert.
- `verify.test.ts:67`: `"/srv/it's here.bin"` und `"/srv/x'+(calc)+'.bin"` stehen in der `it.each`-Liste „rejects %j without running a command“. Der alte Test „passes a path with a quote only as a quoted argument“ ist entfernt.
- Prüffrage: Interpretiert eine der Shells ein verbleibendes Zeichen innerhalb von `'…'`? Nein.
  - sh, bash, zsh: Innerhalb von `'…'` ist alles literal. `!` (Bash-History) ist nicht in der Liste.
  - fish: Innerhalb von `'…'` sind nur `\'` und `\\` Escapes. Weder `\` noch `'` ist in der Liste.
  - csh/tcsh: Nur `!` (History) und ein Zeilenende wirken innerhalb von `'…'`. Beides ist nicht in der Liste.
  - PowerShell: Innerhalb von `'…'` sind nur die Anführungszeichen `'` und U+2018–U+201B wirksam. Die vier Unicode-Zeichen sind Pi/Pf/Ps bzw. Po und damit nicht in `\p{L}`, `\p{N}` oder `\p{M}`. Unicode-Gedankenstriche (Pd), Zeilentrenner (Zl) und NEL (Cc) sind ebenfalls nicht in der Liste.
  - cmd: `'` quotet in cmd nicht. Die Metazeichen `& | < > ^ % " !` sind aber nicht in der Liste. `(` und `)` wirken nur in Blöcken, und das Pfadargument steht nie am Anfang eines Befehls. Eine Leerstelle im Namen führt höchstens zu einer Zerlegung in zwei Argumente, also zu einem falschen oder fehlenden Hash, nicht zur Ausführung.
- Sonderfall: `shellJoin` quotet Wörter nicht, die zu `SAFE_WORD` (`commands.ts:14`) passen. Ein Pfad aus `[A-Za-z0-9_./:=@+,-]` läuft also ungequotet. Mit `powershell.exe` nachgestellt: `sh /srv/a,b.bin`, `/srv/x@y.bin` und `/srv/a+b=c:d.bin` kommen je als ein einziges Argument an. Weil der Pfad mit `/` beginnt, gibt es kein Array, kein Splatting und keinen Parameter. Das ergibt keinen Befund.

### I1 – ADDRESSED

- `transfer.ts:193` und `:200–208`: `untilDoneOrAborted` ist wörtlich wie im Review umgesetzt. `canceled` und `cancel` sind entfernt, im `finally` steht nur `open = false;`, und `checkAborted(signal)` steht am Schleifenkopf. Zwischen `checkAborted` und `addEventListener` liegt kein `await`, ein Abbruch geht also nicht verloren. Hängt ein Stück, hält es nur seine eigene Closure.
- Test: `transfer.test.ts:459` „leaves no listener behind“.
- Mutationsprobe 1: Das alte `Promise.race` mit dem langlebigen `canceled` ist eingesetzt, der Rest des Fixes bleibt. Der Test ist rot (`expected 1 to be greater than or equal to 250`), die anderen 40 Tests bleiben grün, auch die Abbruchtests.
- Mutationsprobe 2: Der neue Helfer läuft ohne `removeEventListener`. Der Test ist rot (`expected 1000 to be +0`).
- Wiederhergestellt.

### I2 – ADDRESSED

- `transfer.ts:153–156`: Der Code ist wörtlich wie im Review umgesetzt. Weil alle Ziele kleingeschrieben verglichen werden, fängt die Prüfung auch `X.BIN` neben `x.bin.part`.
- Test: `transfer.test.ts:517` „copies a file and a file named like its .part one after another“.
- Mutationsprobe: Mit der alten Breite (`targets.size < files.length ? 1 : TUNING.files`) ist der Test rot (`expected 2 to be 1`). Wiederhergestellt.
- Der Commit `2058664` nennt die Gegenprobe nicht ausdrücklich. Sie ist hiermit nachgeholt.

### M3 – ADDRESSED

- `FilesPanel.tsx:253–259`: Der Code ist wie im Review umgesetzt. Zusätzlich prüft er `!sessionId`, was für die Typen nötig ist und den alten Wächter in `transfer` ersetzt. Die Richtung ist unverändert (`job.direction` statt des Umwegs über `from`). `targetDir` ist in `TransferJob` Pflicht (`shared/sftp.ts:39`), der frühere Rückgriff auf `paths.current` fällt also ohne Verlust weg.
- `SftpSessions.transfer` (`sftp-session.ts:232–244`) legt den Job synchron an, meldet ihn per `emitJob` und gibt erst dann `{ jobId }` zurück. Die alte Zeile verschwindet also erst, wenn der neue Job existiert. Bei einem Fehler zeigt `run` den Fehler an und gibt `false` zurück, die Zeile bleibt.
- Gate: Laut Ledger lief die Abnahme nach der Fix-Welle mit 59 MB/s bei 10 ms, „fortgesetzt ab 74 MB“, „Prüfsumme stimmt“ und gleichem Node-SHA, danach wurde aufgeräumt. Den Zeitpunkt, zu dem die alte Zeile verschwindet, nennt das Ledger nicht ausdrücklich. Er ist aber durch den Code oben belegt.

## Neue Befunde im Fix-Diff

Keine.

## Restpunkt an den Nutzer (außerhalb des Fix-Diffs, schon vor 0.17 so)

Nach I2 laufen `x` und `x.part` nacheinander, in der Reihenfolge des Plans. Liegt die Quelle `x.part` im Plan vor `x`, kommt es zu Folgendem. `x.part` wird korrekt kopiert. Danach behandelt `copyFile` für `x` diese frische Kopie als eigene Teildatei (Shortcut in `transfer.ts:212`) und verwirft sie oder setzt sie fort. Das Ziel `x` stimmt, aber das Ziel `x.part` fehlt. Beim Verschieben ist die Quelle `x.part` dann schon gelöscht (`transfer.ts:142`), die Datei ist also verloren.

Nachgestellt habe ich das mit der umgekehrten Reihenfolge im neuen Test. Er ist dann rot: `/target/x.bin.part` ist `undefined`. Wiederhergestellt.

Der Shortcut steht im Handbuch („Teildateien mit dem Namen `name.part` behandelt Shellherd als seine eigenen.“). Seriell war es in 0.17 genauso, deshalb ist das kein Befund dieser Nachprüfung. Ein günstiger Fix für später: Ist `shared` gesetzt, die Dateien so sortieren, dass `x` vor `x.part` läuft, und dazu den Test mit umgekehrter Reihenfolge.

## Urteil

Mergebar: ja. Der Merge nach `main` bleibt beim Nutzer. Restpunkt an den Nutzer ist der Fall `x.part` vor `x` beim Verschieben (siehe oben), ein bekannter Shortcut mit möglichem Datenverlust beim Verschieben.
