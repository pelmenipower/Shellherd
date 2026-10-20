# run-app: Screenshots aller Komponenten – Nachprüfung (Stufe 8)

Geprüft: die Fix-Welle `bd8e5e6` (screens.mjs) und `f1dd563` (SKILL.md) gegen `2026-10-20-run-app-screenshots-review.md`.

**Urteil: done with open points.** Der Major ist behoben. m1 und m2 sind erledigt, m3 bis m5 bleiben akzeptiert. Neu ist ein Minor: Ein Escape fehlt in einer Fehlermeldung. Das Verhalten ist davon nicht betroffen.

Gate auf HEAD `f1dd563`: `npm run typecheck` grün. `npx vitest run` mit 121 Dateien und 1675 Tests grün. Die Ports 2222, 9334 und 9335 sind frei, der verwaiste Testserver aus dem Review läuft also nicht mehr.

## Befunde aus dem Review

| Befund | Status | Beleg |
|---|---|---|
| M1 – `sftp.png` zeigt die echte Laufwerkswurzel, die Benutzernamen-Erkennung prüft den falschen Wert | **ADDRESSED** | `screens.mjs:53-63`: Der Fallback auf die Laufwerkswurzel ist entfernt. Ob ein Ordner im Profil liegt, prüft jetzt `path.relative(os.homedir(), p)` statt `os.userInfo().username`. Unter win32 vergleicht `path.relative` ohne Groß- und Kleinschreibung, damit ist auch Fall 2 (Profilordner weicht vom Kontonamen ab) erledigt. Die Kandidaten sind in dieser Reihenfolge `<RUN_DIR>\local` und `%PUBLIC%\shellherd-demo-local`. Passt keiner, wirft der Block (Zeile 57). Die Umsetzung weicht in der Form vom Review-Snippet ab, ist aber gleichwertig. Neues Bild `%TEMP%\shellherd-run\shots\sftp.png` (20.10., 09:58) angesehen: Die Pfadleiste lautet `C: \ Users \ Public \ shellherd-demo-local`. Zu sehen sind die drei Dateien `deploy.sh`, `notes.md` und `readme.txt` sowie „3 Einträge“, kein echter Ordner. Die Remote-Seite zeigt `/home/demo` mit 5 Einträgen. Der Ordner `C:\Users\Public\shellherd-demo-local` enthält genau diese drei Dateien. |
| m1 – Kein Stopp-Weg für einen hängenden Testserver | **ADDRESSED** | `SKILL.md:102`: Die Zeile verwendet statt `netstat`/`taskkill` die PowerShell-Befehle `Get-CimInstance` und `Stop-Process`, gefiltert auf `*run-app*sshd.mjs*`, und prüft danach mit `Get-NetTCPConnection`. Das ist gleichwertig und gezielter, weil nur der Testserver beendet wird und nicht der Prozess hinter einer beliebigen PID. |
| m2 – SKILL.md beschreibt das alte Verhalten | **ADDRESSED** | `SKILL.md:101`: Der Text stimmt mit `screens.mjs` überein. Er nennt beide Orte und deren Reihenfolge (`localTarget`), den Abbruch statt eines Bilds mit echten Ordnern und die liegen bleibenden Dateien unter `%PUBLIC%`. Er ist nicht wörtlich der Review-Text, aber inhaltlich vollständig. |
| m3 – Temp-Ordner beim Sammeln auf Nicht-Windows | **ACCEPTED** | Im Review so entschieden. CI läuft auf `windows-latest`. |
| m4 – Problembanner eingeklappt | **ACCEPTED** | Im Review so entschieden. |
| m5 – Kleinigkeiten in den Fakes | **ACCEPTED** | Im Review so entschieden. |

## Neue Befunde (nur im Fix-Diff)

**n1 (Minor) – Der Backslash im Pfadbeispiel der Fehlermeldung geht verloren.** `.claude/skills/run-app/screens.mjs:57`
- **Fall:** Der String steht in einfachen Anführungszeichen und enthält `C:\shellherd-run`. `\s` ist in JS kein gültiges Escape und wird zu `s`. Die Meldung lautet deshalb „(z. B. C:shellherd-run)“, mit `node -e` nachgeprüft. Wer den Pfad übernimmt, erhält einen relativen Laufwerkspfad.
- **Folge:** Nur der Hinweistext ist falsch, die Sicherheit ist nicht betroffen. Der Fall tritt nur auf, wenn weder `RUN_DIR` noch `%PUBLIC%` außerhalb des Profils liegt. SKILL.md:101 nennt den Pfad korrekt.
- **Fix-Richtung:** `C:\\shellherd-run` schreiben. Das ist eine Zeile und kann in den nächsten Commit am Skill.

Sonst ist im Fix-Diff nichts Neues aufgefallen.
- `!rel.startsWith('..')` würde einen Ordner namens `..x` direkt im Profil als „außerhalb“ werten. Der Kandidat heißt aber immer `local` oder `shellherd-demo-local`, deshalb kann der Fall nicht eintreten.
- Ein `RUN_DIR` auf einem anderen Laufwerk ergibt einen absoluten `rel`. Er gilt korrekt als „außerhalb“.

## Offene Punkte

- n1: Backslash in der Fehlermeldung (Minor, Ein-Zeilen-Fix).
- m3, m4 und m5 sind bewusst akzeptiert.
