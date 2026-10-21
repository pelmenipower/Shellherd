# Root-Shell und Startbefehle nach dem Anmelden – Nachprüfung (Stufe 6)

Geprüft: `git diff 6cf373c..HEAD` auf `claude/feature/login-commands` (HEAD `fdf3de5`, 2 Fix-Commits `a6893ca` und `fdf3de5`) gegen den bindenden Review `2026-10-21-login-commands-review.md` und das Ledger `.superpowers/sdd/2026-10-21-login-commands/progress.md`, Abschnitt „Abnahme nach Fix-Welle“.

Gates:
- `npm run typecheck`: grün.
- `npx vitest run`: zweimal grün (dazu ein dritter Lauf für die Zählung), 129 Dateien und 1859 Tests. Vor der Fix-Welle waren es 1856, dazu kommen 3 neue Tests (Quelltext-Test, M2, M3).

Urteil: **mergebar: ja.** Alle Befunde sind erledigt oder akzeptiert. Neu ist 1 Minor (nicht blockierend).

---

## Befunde aus dem Review

| Befund | Status | Beleg |
|---|---|---|
| I1 `LOGIN_CONTROL` als Rohbytes, CRLF, Datei als binär erkannt | ADDRESSED | Siehe unten. |
| I2 Handbuch-Abschnitt dreimal | ADDRESSED | `grep -c '^### Nach dem Anmelden' docs/handbuch.md` ergibt `1`, `grep -c '^### After login' docs/manual.md` ergibt `1`. Auf den Abschnitt folgt mit genau einer Leerzeile `## Container und VMs` (`handbuch.md:218-219`). Diff: 86 Zeilen gelöscht, sonst nichts. |
| M1 Fokus-Rückgabe beim Klick außerhalb | ADDRESSED | `SplitTerminalArea.tsx:119-120` setzt den Fokus nur noch, wenn `document.activeElement` fehlt oder `body` ist, wörtlich wie im Fix vorgegeben. Die run-app-Prüfungen stehen in `screens.mjs:252-260`, Block `login-commands`: Nach Escape liegt der Fokus auf dem Tab, nach einem Klick ins Terminal bleibt er in `.xterm`. Beide Prüfungen werfen bei einem Fehlschlag. Laut Ledger lief die Abnahme mit OK. Die Tab-Prüfung nutzt `id.startsWith('tab-')` statt der exakten ID. Weil Escape nur das Menü des zuvor fokussierten Tabs schließt, reicht das. |
| M2 Test für ein Passwort mit Zeilenumbruch bei `login.sudo` | ADDRESSED | `session.test.ts:604-611` prüft den Fehlercode `containers.passwordLineBreak`, `execCommands` als `[]` und `peers` als Länge 0. Die Behauptung `JSON.stringify(events)` enthält das Passwort nicht fehlt, siehe N1. |
| M3 NOPASSWD/Cache im Passwort-Modus | ADDRESSED | `session.test.ts:613-622` mit `loginSudo = 'nopasswd'`: `sudoInput` ist genau `typed` und enthält das Passwort nicht. Kein `terminus-` in der Ausgabe und kein Passwort in den Events. Die zuvor tote Variante wird damit benutzt. |
| M4 run-app-Namen weichen von K11 ab | ACCEPTED | Ruling im Ledger (`progress.md:23`): „run-app-Namen login-commands/login-plain.png, Demo-Befehle cd /var/www, uptime“. |

### I1 im Detail

- `git diff --numstat claude/feature/lock-screen...HEAD -- src/shared/vault/schema.ts` ergibt `10	0`. Das sind Zahlen statt `-`, und es sind nur die Login-Zeilen (LOGIN_LIMITS, LOGIN_CONTROL, LoginLineSchema und der `login`-Block).
- Der Blob von `schema.ts` in HEAD enthält 0 CR-Bytes.
- Zeile 69 lautet wörtlich `export const LOGIN_CONTROL = /[\x00-\x1f\x7f-\x9f]/;`.
- Die einzigen Nicht-ASCII-Bytes im Blob sind das `…` in Zeile 47. Es stammt aus der Basis und ist kein Steuerzeichen.
- `git diff --numstat claude/feature/lock-screen...HEAD | grep '^-'` gibt nichts aus. Keine Datei im Branch gilt als binär.
- Keine geänderte Datei im Branch hat CR im HEAD-Blob.
- Der Quelltext-Test in `schema.test.ts:28-31` ist nur mit Escapes geschrieben (im Blob 0 Nicht-ASCII-Bytes). Er nimmt `\x09`, `\x0a` und `\x0d` aus und bleibt deshalb auch bei einem CRLF-Checkout unter Windows grün. Die bisherigen Tests für `\t`, `\x1b`, `\x7f` und `\u009b` bestehen weiter.
- Hinweis: `git diff --stat 6cf373c..HEAD` zeigt für `schema.ts` noch „Bin“. Das liegt an der binären Seite `6cf373c` und betrifft den PR gegen `lock-screen` nicht.

## Neue Befunde im Fix-Diff

### Minor

N1. `src/main/ssh/session.test.ts:604-611`: Im M2-Test fehlt die im Review bindend geforderte Zeile `expect(JSON.stringify(events)).not.toContain('synthetic\\npassword')`.
- Fehlerszenario: Eine Regression nimmt das Passwort in die Fehlermeldung des Events auf, und kein Test schlägt an. Der Fehler entsteht heute als `ContainerInputError` mit festem Code ohne Passwort. Das Risiko ist also gering, und die anderen Login-Tests prüfen Events bereits auf Secrets.
- Fix-Richtung: Die eine Zeile im Test ergänzen. Für den Merge nicht blockierend.

Sonst hat der Fix-Diff keine Nebenwirkungen. Die Sicherheitspfade (Bestätigung, „Nur lesen“, kubeconfig, Exec ohne Klick) berührt er nicht. Produktivcode ändert sich nur in `SplitTerminalArea.tsx` (1 Zeile) und `schema.ts` (Escapes, inhaltlich gleiche Regex).

## Restpunkte an den Nutzer

- N1 (optional): eine fehlende Test-Assertion im M2-Test, nicht blockierend.
- M4 ist als Ruling akzeptiert. Die run-app-Namen weichen von K11 ab, sind aber in sich konsistent.
- Das Merge-Ziel ist `claude/feature/lock-screen` bzw. staging, nicht `main`. Den Merge nach `main` macht der Nutzer selbst.
