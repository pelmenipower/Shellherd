# Root-Shell und Startbefehle nach dem Anmelden – Review (Stufe 5)

Geprüft: `git diff claude/feature/lock-screen...HEAD` auf `claude/feature/login-commands` (HEAD `6d0d25e`, 8 Commits). Grundlage: Spec `2026-10-21-login-commands-design.md`, bindender Anhang `2026-10-21-login-commands-validation.md` (Vertrag 1.1–1.9, B1, K1–K11), Ledger `.superpowers/sdd/2026-10-21-login-commands/progress.md` mit run-app-Abnahme.

Stand: Arbeitsbaum sauber. `npm run typecheck` grün, `npx vitest run` grün mit 129 Dateien und 1856 Tests.

Urteil: ready after fixes. 0 Critical, 2 Important, 4 Minor (davon 1 ACCEPTED ohne Fix).

---

## 1. Sicherheit

### 1.1 Passwort

| Fall | Ergebnis | Beleg |
|---|---|---|
| Nur auf den Marker | Das Passwort geht ausschließlich in `sudoOutput()` raus, nach genau einem Marker-Prompt (`watcher.count === 1`) und nur solange `session.sudo` besteht. | `session.ts:357-373` |
| Marker über Chunk-Grenzen | Der Watcher hält höchstens `marker.length - 1` Bytes zurück. Der Login-Test nutzt den geteilten Prompt aus `simulateTtySudo`, der run-app-Fake schreibt den Marker in zwei `write`s. | `sudo.ts:28-56`, `session.test.ts:94-96`, `sshd.mjs:237` |
| Marker vor dem Exec | `exec` druckt kein MOTD. Der Marker ist je Sitzung zufällig (64 Bit). Banner laufen nicht über den Kanal. | `sudo.ts:4-6` |
| Cache und NOPASSWD | READY kommt vor jedem Prompt, dann folgen `dropSudo` und das Vergessen des Passworts. Im Code korrekt, aber ungetestet (M3). | `session.ts:360` |
| Ablehnung | Beim zweiten Prompt folgen `markRejected` und das Ende mit `ssh.loginSudoRejected`, ohne zweites Senden. Das nächste `connect` scheitert ohne Hostkontakt. Getestet. | `session.ts:364-368`, `:333`, `session.test.ts` „ends with ssh.loginSudoRejected …“ |
| Timeout und später Prompt | `sudoGaveUp` → `releaseSudoHold` → `dropSudo`. Danach läuft die Ausgabe über `output()` und nie mehr über `sudoOutput()`. Ein später Marker erscheint roh, es wird nichts gesendet. Getestet. | `session.ts:376-380`, `session.test.ts` „after a timeout …“ |
| Vergessen | `sudo.password = undefined` nach dem Senden. `dropSudo` läuft bei READY, Timeout, Close und `finish()`. Im Plan-Objekt `root` steht kein Passwort. JS-Strings lassen sich nicht nullen, das ist wie bei den Container-Tabs. | `session.ts:370-372`, `:391-397`, `:629` |
| Manueller Modus | Fasst kein gespeichertes Passwort an. Kein Gate, kein Timer, die Eingabe bleibt offen (R4). | `session.ts:341-342`, `:292`, `:561` |

Kein Befund.

### 1.2 Startbefehle

- Nie vor READY: Im Root-Modus gehen sie nur in `sudoOutput()` bei `result.ready` raus (`session.ts:362`). Im reinen Befehlsmodus nur über `session.login && !session.login.sudo` (`:314`). `sendLogin()` prüft `sent`, `active` und `stream` und leert die Liste (`:346-354`).
- Nie nach einem Timeout, auch nicht im manuellen Modus: Nach `dropSudo` gibt es keinen Pfad mehr zu `sendLogin()`. Der manuelle Modus hat keinen Timer. READY kommt dort nur über den Watcher, und den Marker kennt nur das Exec-Kommando.
- `skipLogin`: ein Boolean in einem strikten Schema (`validation.ts:8`). Main nutzt ihn nur in `!session.skipLogin` (`session.ts:246`), er kann also nur abschalten. Für Container-Anfragen bleibt er wirkungslos (getestet).
- Steuerzeichen: Zod (`schema.ts:69-70`) und Formular (`connection-form.ts:118-131`) nutzen dieselbe Konstante `LOGIN_CONTROL`. Abgelehnt werden C0, DEL und C1, getestet mit `\t`, `\x1b`, `\x7f` und `\u009b`. Die Regex stimmt inhaltlich, steht aber als Rohbytes in der Datei (I1).
- Quoting: Die Befehle stehen nie im Exec-String. Der Test prüft `not.toContain('uptime')`. Die Marker werden gegen `SUDO_MARKER` geprüft, der Hinweis läuft über `shellJoin`. Backslashes kommen nur in `'\''` vor, das prüft `login.test.ts` für beide Modi und beide Sprachen. B1 (`sudo -n true`) ist umgesetzt und getestet.

### 1.3 Weitere Grundregeln

Die kubeconfig, „Nur lesen“ und der Kube-Pfad sind unberührt. Die Startbefehle laufen ohne Klick, aber nur aus dem Vault-Snapshot und vom Nutzer selbst konfiguriert (N4). Der Renderer kann keine Befehle einschleusen. `redactSecrets` entfernt `login` für Nebenfenster und den gesperrten Renderer, getestet auch in Ordnern. Keine Secrets in Events: geprüft per `JSON.stringify(events)`.

## 2. Zusammenspiel

| Bereich | Ergebnis |
|---|---|
| Reconnect | Jeder neue `attempt` liest den Vault neu und loggt sich wieder ein. `skipLogin` hängt am Versuch (`plainAttempt`), wie in K7 wörtlich gefordert (`TerminalPanel.tsx:70-77`, `:88`, `:215`). |
| Leerlauf | Das Echo der Startbefehle stempelt `lastIo` über `output()`. Keine Änderung. |
| Sperre | `getConnection` wirft gesperrt. Laufende sudo-Austausche enden wie in Risiko 9 akzeptiert. |
| Handover | Der Watcher läuft in Main weiter. `sendLogin` schreibt auf den pausierten Stream, die Echo-Ausgabe wird gepuffert. |
| Container, Pod, lokal | `session.login` wird erst nach den Kube- und Lokal-Zweigen und nur ohne `target` gesetzt (`session.ts:246-247`). Getestet für Container mit und ohne `skipLogin`. |
| Tab-Menü | Es öffnet nur für SSH-Terminal-Tabs (`SplitTerminalArea.tsx:376-381`). Willkommens-Tab (`protocol: 'cmd'`, `view: 'welcome'`), lokale Tabs, Container, Pod und `LOCAL_CONTAINER_HOST` sind ausgeschlossen, ebenso der Zustand `busy`/`disabled`. Es gibt einen Eintrag, einen Hinweis bei laufender Sitzung und ein Label mit dem Tabnamen. Docks bekommen kein `reconnectPlain`. Die Fokus-Rückgabe hat einen Fehler (M1). |

## 3. Regeln, Tests, Doku

- i18n: Alle Keys liegen in beiden Sprachen und entsprechen 1.9 wörtlich. Der Katalog-Test ist grün. Es gibt keine Literale in Komponenten.
- Tokens: Kein neues CSS und kein Motion-Eintrag, wie in K8 gefordert.
- Fake-Varianten: `quiet` und `double` erweitern die Union aus K6 nur im Testcode, das ist zulässig. `nopasswd` ist deklariert, wird aber von keinem Login-Test benutzt (M3).
- Doku: Changelog 0.16.0 in beiden Sprachen, wörtlich nach K10 und ohne Fettdruck. Die Version ist 0.16.0. README hat einen Satz im Stil der Liste. `manual.md` ist korrekt. Im `handbuch.md` steht der Abschnitt dreimal (I2).

---

## 4. Befunde

### Important

I1. `src/shared/vault/schema.ts:69` – `LOGIN_CONTROL` steht als Rohbytes in der Datei. Sie enthält NUL, U+001F, DEL und U+009F als echte Zeichen statt `\x..`-Escapes.
- Folgen:
  - Git hält die Datei für binär. `git diff` und der PR zeigen nur „Binary files differ“, und die sicherheitsrelevante Grenze ist im Review unsichtbar.
  - Weil die Datei als binär gilt, hat `core.autocrlf` sie nicht normalisiert. Der committete Blob hat CRLF in allen 285 Zeilen, die Basis hatte LF. Der Diff umfasst deshalb die ganze Datei, und auf Linux-CI und jedem anderen Checkout liegt die Datei mit CRLF.
  - Jede künftige Änderung oder jeder Merge an dieser zentralen Schema-Datei wird zum Konflikt ohne Textdiff.
- Fehlerszenario: Ein späterer Umsetzer ändert die Regex versehentlich, etwa beim Speichern mit einem Editor, der NUL entfernt. Kein Reviewer sieht das, und die Prüfung auf Steuerzeichen fällt still weg.
- Fix (bindend): Zeile 69 lautet wörtlich `export const LOGIN_CONTROL = /[\x00-\x1f\x7f-\x9f]/;`, nur mit ASCII-Escapes. Die Datei wird mit LF gespeichert. Danach zeigt `git diff --numstat claude/feature/lock-screen...HEAD -- src/shared/vault/schema.ts` Zahlen statt `-`, und der Diff umfasst nur die Login-Zeilen.
- Test (bindend) in `src/shared/vault/schema.test.ts`: Die Datei liest `schema.ts` per `readFileSync(new URL('./schema.ts', import.meta.url), 'utf8')` und prüft `expect(source).not.toMatch(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/)`. Diese Regex im Test ebenfalls nur mit Escapes schreiben. Die bestehenden Tests für `\t`, `\x1b`, `\x7f` und `\u009b` bleiben.

I2. `docs/handbuch.md:219-303` – Der Abschnitt „### Nach dem Anmelden“ steht dreimal hintereinander (`:176`, `:219`, `:262`), wortgleich. `docs/manual.md:175` hat ihn einmal.
- Fehlerszenario: Das Handbuch wird ausgeliefert, und der Nutzer sieht denselben Abschnitt dreimal. Das Inhaltsverzeichnis und die Anker zeigen dreimal „Nach dem Anmelden“.
- Fix (bindend): Die Zeilen 219 bis einschließlich 303 löschen, also die zweite und dritte Kopie samt ihrer Leerzeile. Danach folgt auf den ersten Abschnitt mit genau einer Leerzeile `## Container und VMs`.
- Test (bindend): `grep -c '^### Nach dem Anmelden' docs/handbuch.md` ergibt `1`, `grep -c '^### After login' docs/manual.md` ergibt `1`. Diese Prüfung kommt ins Ledger-Abnahmeprotokoll, ein Unit-Test ist nicht nötig.

### Minor

M1. `src/renderer/src/components/SplitTerminalArea.tsx:117-122` – `closeTabMenu` setzt den Fokus nach `requestAnimationFrame` immer auf den Tab, auch wenn das Menü durch einen Klick außerhalb oder durch Blur schließt (`ContextMenu.tsx:32-35`).
- Fehlerszenario: Der Nutzer öffnet das Menü und klickt dann ins Terminal, um weiterzutippen. Der Pointerdown schließt das Menü, der Klick fokussiert xterm, und im nächsten Frame holt `closeTabMenu` den Fokus auf den Tab-Button. Die nächsten Tasten landen auf dem Tab, und Pfeiltasten wechseln den Tab. K8 wollte die Fokus-Rückgabe nur für Escape und Auswahl, also für die Fälle, in denen der Fokus im Menü lag.
- Fix (bindend): Im rAF nur fokussieren, wenn der Fokus beim Schließen des Menüs verloren ging: `requestAnimationFrame(() => { const active = document.activeElement; if (!active || active === document.body) document.getElementById(`tab-${current.tabId}`)?.focus(); });`. Sonst nichts ändern.
- Test (bindend): Es gibt keine Komponententests (K8), die Prüfung läuft über run-app im Block `login-commands`. Nach dem Rechtsklick auf den Tab `Escape` drücken, dann muss `document.activeElement.id === 'tab-<id>'` gelten. Danach erneut Rechtsklick, dann `click('.terminal-panel:not([hidden]) .xterm')`, und nach einer Pause `document.activeElement.closest('.xterm')` ist ungleich `null`. Beide Prüfungen werfen bei einem Fehlschlag wie die vorhandene `uptimes`-Prüfung.

M2. `src/main/ssh/session.test.ts:540-692` – Der Test für ein Passwort mit Zeilenumbruch bei `login.sudo` fehlt (Minor aus T2). Der Pfad `rootShellPlan` → `sudoSetting(connection, true)` → `ContainerInputError('containers.passwordLineBreak')` vor `sshConnectConfig` (`session.ts:331-332`, `:253`) ist ungetestet.
- Fehlerszenario: Ein späterer Umbau verschiebt `rootShellPlan` hinter den Verbindungsaufbau. Dann scheitert erst der Marker-Austausch, nach Hostkontakt und möglicherweise mit einem abgeschnittenen Passwort an sudo.
- Fix und Test (bindend) im Describe „root shell and start commands after login“: `it('refuses a stored password with a line break before contacting the host', …)` mit `connection = { ...connection, authentication: { method: 'password', password: 'synthetic\npassword' }, login: { sudo: true, commands } }`, dann `connect` und `waitFor(hasStatus('error'))`. Erwartet werden `expect(events).toContainEqual(expect.objectContaining({ status: 'error', error: { code: 'containers.passwordLineBreak' } }))`, `expect(peers).toHaveLength(0)`, `expect(execCommands).toEqual([])` und `expect(JSON.stringify(events)).not.toContain('synthetic\\npassword')`. Mit `skipLogin: true` verbindet dieselbe Verbindung dagegen ohne diesen Fehler, die Auth scheitert dann am Server. Dieser zweite Teil ist optional.

M3. `src/main/ssh/session.test.ts:32-36`, `:540-692` – Die Variante `loginSudo = 'nopasswd'` ist deklariert, aber ungenutzt. Ungetestet bleibt damit der Kernfall „Cache gültig / NOPASSWD im Passwort-Modus: das Passwort wird nie gesendet“ (Anhang 5, erste Zeile).
- Fehlerszenario: Eine Regression sendet das Passwort auch ohne Prompt, etwa beim Umbau von `sudoOutput`. Dann landet es als Eingabe in der Root-Shell und in der History. Kein Test schlägt an.
- Fix und Test (bindend): `it('never sends the password when sudo does not ask (cache or NOPASSWD)', …)` mit `loginSudo = 'nopasswd'` und `login: { sudo: true, commands }`. Nach `waitFor(output().includes('df -h /'))` gilt `expect(sudoInput.join('')).toBe(typed)` und `expect(sudoInput.join('')).not.toContain('synthetic-password')`. Außerdem `output()` enthält kein `terminus-`, und `JSON.stringify(events)` enthält kein `synthetic-password`.

M4. `.claude/skills/run-app/screens.mjs:241-258`, `demo-setup.mjs:66-69`, `SKILL.md:19,27` – Abweichungen von K11 bei den Namen:
- Der Block heißt `login-commands` statt `login`.
- Der zweite Screenshot heißt `login-plain.png` statt `login-commands-plain.png`.
- Die Startbefehle von `ops-01` sind `cd /var/www` und `uptime` statt `uptime` und `df -h /`.

Die Dateien sind in sich konsistent, die Abnahme im Ledger lief damit, und `fakes.test.mjs` prüft weiter `uptime`/`df -h /` über den echten Manager. ACCEPTED, kein Fix. Als Ruling im Ledger festhalten: „run-app-Namen `login-commands`/`login-plain.png`, Demo-Befehle `cd /var/www`, `uptime`“.

---

## 5. Abdeckung Spec und Anhang

| Punkt | Status |
|---|---|
| Vertrag 1.1–1.4 | erfüllt (`types.ts:74-75`, `schema.ts:66-92`, `connections.ts:32-41`, `ssh.ts:9-13`, `validation.ts:8`) |
| Vertrag 1.5–1.7 | erfüllt, wörtlich (`commands.ts:28,49-51`, `login.ts`, `session.ts:246-247,253,269,292,295,310,312,314,331-354,362,368,379,525,561`) |
| Vertrag 1.8–1.9 | erfüllt |
| B1 | erfüllt, getestet (`login.test.ts` „manual mode checks with sudo -n true“) |
| K1 | erfüllt inhaltlich. Die Form der Regex fällt unter I1. Der Vault-Test nutzt `ConnectionNodeSchema` statt `VaultSchema`, das ist gleichwertig. |
| K2–K6 | erfüllt. Testlücken siehe M2 und M3. |
| K7 | erfüllt, wörtlich |
| K8 | erfüllt bis auf die Fokus-Rückgabe bei Klick außerhalb (M1) |
| K9 | erfüllt, Tests vollständig |
| K10 | Changelog, Version, README und manual erfüllt. Handbuch siehe I2. |
| K11 | erfüllt, Namen siehe M4 |

---

## 6. Fix-Welle (bindend)

Gate danach: `npm run typecheck` und `npx vitest run` grün. Umsetzer schreiben nur die genannten Dateien und committen nicht.

| Task | Dateien (exklusiv) | Inhalt |
|---|---|---|
| F1 Main und Shared | `src/shared/vault/schema.ts`, `src/shared/vault/schema.test.ts`, `src/main/ssh/session.test.ts` | I1 (Escapes, LF, Quelltext-Test), M2 (Test für den Zeilenumbruch), M3 (Test für NOPASSWD/Cache im Passwort-Modus) |
| F2 Renderer, Doku, run-app | `src/renderer/src/components/SplitTerminalArea.tsx`, `docs/handbuch.md`, `.claude/skills/run-app/screens.mjs` | I2 (Zeilen 219–303 löschen), M1 (Fokus nur bei verlorenem Fokus, run-app-Prüfungen im Block `login-commands`), danach run-app-Block `login-commands` ausführen und beide Screenshots ansehen |

M4 braucht keinen Code. Das Ruling kommt ins Ledger (Orchestrator).
