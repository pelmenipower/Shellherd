# Root-Shell und Startbefehle nach dem Anmelden – Design

Auftrag: „Ich habe Systeme, wo ich mit Credentials reingehe und dann instant `sudo bash` mache, mit den gleichen Credentials. Kann man das als Menüpunkt beim Einrichten einer Verbindung initialisieren, quasi Befehle mitschicken?“ Grundlage ist das Konzept `.superpowers/sdd/login-commands-research.md`, ab „1. Bestand und Lücken“ hier vollständig als Spec übernommen. Plan: `docs/superpowers/plans/2026-10-21-login-commands.md`.

## Nutzer-Entscheidungen (bindend)

- **N1** Pro SSH-Verbindung gibt es die Option „Nach dem Anmelden root werden“, sie startet `sudo -i`.
- **N2** Bei Passwort-Login gilt der vorhandene sichere sudo-Mechanismus der Container-Tabs: Marker-Prompt, nie zweimal, nie blind.
- **N3** Bei Schlüssel- oder Agent-Login gilt `sudo -n`. Ohne NOPASSWD kommt ein Hinweis, und der Nutzer tippt selbst. Ein eigenes sudo-Passwortfeld gibt es nicht.
- **N4** Startbefehle sind Freitext, eine Zeile je Befehl. Sie werden nach dem sudo-Schritt wie getippt gesendet.
- **N5** Das gilt bei jedem Verbinden, auch bei „Neu verbinden“. Dazu kommt „Ohne Startbefehle verbinden“ im Tab-Menü.

## Spec-Rulings (Stufe 3)

- **S1** Die Rulings R1–R8 aus Abschnitt 6 des Konzepts gelten. R1 heißt ausdrücklich: `exit` in der Root-Shell schließt den Tab, statt zur Benutzer-Shell zurückzukehren. Das ist der Preis für „kein Passwort und kein sudo-Aufruf in der History“.
- **S2** Der Umfang ist Stufe 1 aus Abschnitt 8. Welle 3 darf sofort laufen, der parallele Ablauf ist inzwischen committet.
- **S3** Version `0.16.0`. CHANGELOG ohne Fettdruck.
- **S4** Abnahme nach Abschnitt 9. Typecheck und `npx vitest run` grün, Screenshots ansehen.

## 1. Bestand und Lücken

### 1.1 sudo-Mechanismus der Container-Tabs (wird wiederverwendet)

| Baustein | Stelle | Was passiert |
|---|---|---|
| Entscheidung vor dem Verbinden | `src/main/ssh/session.ts:243`, `sudoMode()` `:306-316` | `sudoSetting(connection)` (`src/main/containers/commands.ts:50-56`) liest **nur** `containers.sudo`; mit Passwort-Login → `prompt`, sonst `noninteractive` (`sudo -n`). Passwort mit Zeilenumbruch → `containers.passwordLineBreak`. Rejection-Check über `connectionFingerprint` (`sudo-rejections.ts:5-8`, Hash aus Host, Port, User, Auth). |
| Marker und Watcher | `src/main/containers/sudo.ts:4-6`, `:13-72` | `[terminus-sudo-<16 hex>]` als sudo-Prompt (`-p`), `[terminus-ready-…]` als Ready-Marker; der Watcher strippt beide aus dem Bytestrom und hält höchstens `marker.length - 1` Bytes zurück. |
| Gate je Verbindung | `awaitSudoTurn()` `session.ts:279-287`, `SudoRejections.acquire` `sudo-rejections.ts:26-47` | Nach dem SSH-Handshake: nur eine sudo-Anmeldung je Verbindung gleichzeitig, damit ein falsches Passwort einmal statt je Tab scheitert. |
| Kanal | `session.ts:264-267` | Container-Tab: `client.exec(remoteCommand(argv, sudo), { pty }, attach)`; normales Terminal: `client.shell(pty, attach)`. Mit pty landen stdout und stderr im selben Strom, der Watcher sieht alles (`:318`). |
| Skript | `remoteCommand()` `commands.ts:30-39` | `sh -c 'PATH="$PATH:/usr/sbin:/sbin"; sudo -p MARKER -v && printf %s READY && sudo -n <argv>; exit $?'`. Kein `exec`, damit `sh` Elternprozess bleibt (Kommentar `:36`). |
| Ausgabe | `sudoOutput()` `session.ts:319-334` | Erster Marker-Prompt → Passwort genau einmal (`:331-333`, danach `password = undefined`); zweiter Prompt oder kein Passwort → `markRejected` + Ende mit `containers.sudoRejected` (`:326-329`). READY → `dropSudo`, `sudoReady = true` (`:322`). |
| Eingabe | `input()` `:521-522` | Solange `session.sudo` gesetzt ist, werden Tastendrücke verworfen (sie landeten sonst in der Passwortzeile). |
| Timeout | `SUDO_READY_TIMEOUT = 20_000` `:38`, Timer `:301`, `sudoGaveUp()` `:337-341` | Hinweis `main.json` `terminal.sudoGaveUp` (`src/shared/locales/de-DE/main.json:59`), Hold frei, Nutzer tippt selbst. |
| Ende | `ended()` `:359-364` | `sudoReady && !typed && exitCode && /sudo: a password is required/` im `tail` → `containers.sudoNotCached`. `tail` wird nur bei `session.target` gepflegt (`:486`), der `exit`-Listener ebenfalls (`:299`). |
| Tests | `src/main/ssh/session.test.ts:54-97` (`simulateTtySudo`), Routing `:129` (`' -v && printf'`), Fälle `:320-482` | Echter ssh2-Server im Test, Passwort nie in Events, Gate, Timeout, nopasswd, Rejection-Gedächtnis. |

Lücken für dieses Feature: (a) `sudoSetting` kennt nur `containers.sudo`; (b) `tail`/`exit` nur für Container-Tabs; (c) im `noninteractive`-Modus gibt es keinen Watcher, also keinen Ready-Marker; (d) nach READY passiert nichts weiter – es gibt keine Stelle, die etwas in den Kanal schreibt.

### 1.2 Normales SSH-Terminal

`client.shell(pty)` (`session.ts:267`), keine Befehle. Jeder Verbindungsaufbau – Baum, Picker, Workspace-Wiederherstellung, Nebenfenster, „Neu verbinden“ (`TerminalPanel.tsx:256-259` erhöht `attempt`, der Effekt `:74-236` startet komplett neu) und „Erneut verbinden“ der Fehlerkarte (`ConnectionErrorCard.tsx:39`) – läuft durch `sshPrepare`/`sshConnect` (`TerminalPanel.tsx:202-207`). Eine Stelle in Main deckt also alle Auslöser ab. Die Verbindungs-Schritte (`reach/hostkey/auth/shell`, `ssh.ts:16`) enden mit `connected` (`session.ts:302`); sudo und Startbefehle laufen danach sichtbar im Terminal, ein neuer Schritt ist nicht nötig.

### 1.3 Vault-Modell und Formular

- `SshConnectionNode` `src/shared/vault/types.ts:62-74` (optionale Blöcke `containers`, `autoUpload`, `timeouts`); Schema `src/shared/vault/schema.ts:75-83`, bewusst nicht `.strict()` (`:57`). Workflows zeigen das Muster für Befehlszeilen (`:231`: `max(4000)`, kein Zeilenumbruch).
- Formular-Felder `src/renderer/src/connection-form.ts:11-47`, `fieldsFromConnection` `:61-100` (containerSudo `:87`), `connectionFromFields` `:117-179` (SSH-Knoten `:141`), `keepAutoUpload` `:111-115` bleibt unberührt, weil `login` im Formular selbst steht. `ConnectionForm.tsx:199-200` Checkbox `containerSudo`, Textarea-Muster `:208` (Kommentar), Fehler-Fokus per `id` `:113-116`, Klassen `.editor-checkbox`/`.editor-hint` (`editor-ui.css:46-47`), Textarea global gestylt (`styles.css:15-19`, `editor-ui.css:7`). Kein neues CSS nötig.
- Redaktion: `redactSecrets` `src/shared/vault/connections.ts:33-40` entfernt SSH-Auth und RDP-Passwort; Nebenfenster-Katalog (`src/main/window-ipc.ts:80-82`) und gesperrter Renderer (`redactVault` `:43-46`) bekommen sonst alles.

### 1.4 IPC-Grenze

`PrepareSchema` ist `.strict()` (`src/main/ssh/validation.ts:8`), `SshPrepareRequest` `src/shared/ssh.ts:9`; Main liest die Verbindung ausschließlich über `getConnection` aus dem Vault-Snapshot (`src/main/ssh/ipc.ts:45-49`). Der Renderer kann heute keine Befehle mitschicken, und das bleibt so.

### 1.5 Tab-Menü

Es gibt **kein** Kontextmenü für Terminal-Tabs: `TerminalTabs.tsx:52-60` hat kein `onContextMenu`. Vorlage ist das Ansicht-Menü in `SplitTerminalArea.tsx:341` (Auslöser) und `:454-464` (`ContextMenu`, `ContextMenu.tsx:5-8`: `item`/`heading`/`separator`). Motion-Gate: „Kontextmenü (.context-menu) … nicht“ (`docs/design-system.md:212`), also kein neuer Eintrag.

### 1.6 Tests und run-app

- `session.test.ts` hat den echten ssh2-Server mit `simulateTtySudo`; neue Fälle passen dort hinein. `validation.test.ts` prüft `PrepareSchema`. `schema.test.ts`, `connections.test.ts`, `connection-form.test.ts`, `commands.test.ts` existieren.
- Fake-sshd `.claude/skills/run-app/sshd.mjs`: `exec` antwortet mit festen Mustern (`execReply` `:28-47`) und beendet den Kanal sofort (`:144-151`); die Shell (`:152-178`) hat Prompt `demo@web-01:~$ ` und vier feste Befehle (`:17-22`). Für eine Root-Shell fehlt ein `exec`-Zweig, der das Marker-Skript erkennt, das Passwort liest, READY schreibt und dann die Shell-Emulation mit Root-Prompt weiterführt. Demo-Vault `demo-setup.mjs:35-52` legt Verbindungen per Formular an (braucht die neuen Felder), Screenshot-Blöcke `screens.mjs:68`.
- **Achtung:** `screens.mjs`, `run-app/SKILL.md`, `CHANGELOG.md` und `docs/manual.md` sind im Arbeitsbaum gerade durch einen parallelen Ablauf geändert. Die Tasks, die diese Dateien anfassen (Welle 3), starten erst nach dessen Commit.

## 2. Empfehlung je Fläche

| Fläche | Empfehlung | Wert | Aufwand |
|---|---|---|---|
| A Main: Root-Shell per `exec` mit Marker-Skript, Startbefehle als Typeahead nach READY | ja, Kern | ★★★ | kleine Main-Änderung (`session.ts` ≈ 40 Zeilen, neue reine Datei `login.ts`) |
| B Vault: `login` am SSH-Knoten, Zod-Grenzen, Redaktion | ja | ★★★ | nur Shared (klein) |
| C Formular: Checkbox + Textarea + Hinweis im SSH-Block | ja | ★★★ | nur Renderer |
| D Tab-Menü „Ohne Startbefehle verbinden“ + `skipLogin` im Prepare | ja | ★★ | nur Renderer + 1 Zeile Schema |
| E Handbuch, Changelog, Version 0.16.0 | ja | ★★ | Doku |
| F run-app: Fake-Root-Shell, Demo-Verbindung, Screenshot | ja, nach dem parallelen Ablauf | ★★ | Skill-Dateien |
| Eigener Fehlerkarten-Code für sudo-Fehler statt `unknown` + Text | nein | ★ | nicht jetzt |
| Verbindungstest prüft sudo | nein | ★ | nicht jetzt |
| Prompt-Erkennung, Warten je Befehl | nein | – | nicht jetzt (fragil) |

### 2.1 Fläche A: `sudo -i` sicher starten

**Entscheidung: `exec` mit pty und Marker-Skript, kein getipptes `sudo -i`.** Gründe: Das Marker-Verfahren ist erprobt (Passwort nur auf den Marker, einmal, Ablehnung gemerkt, Gate), der sudo-Aufruf steht nicht in der History des Nutzers, es gibt keinen Wettlauf mit der Initialisierung der Login-Shell (fish, zsh, tmux-Autostart), und sudo-Fehler kommen als Kanal-Ende mit Exit-Code an, nicht als Prompt-Rätselraten. Preis: Der sshd druckt bei `exec` kein MOTD/„Last login“, und `exit` in der Root-Shell beendet den Tab (wie bei Container-Tabs). Beides geht ins Handbuch.

Drei Skripte, gebaut in der neuen reinen Datei `src/main/ssh/login.ts` (`rootShellCommand(plan)`), Quoting über `shellJoin` (`commands.ts:15-17`), Marker gegen `SUDO_MARKER` (`commands.ts:28`, zu exportieren):

| Login | Skript (innerhalb `sh -c '…'`) | Verhalten |
|---|---|---|
| Passwort | `sudo -p MARKER -v && printf %s READY && sudo -n -i; exit $?` | Wie `remoteCommand` (`:37`) mit `argv = ['-i']`. Prompt → gespeichertes Passwort einmal; READY → Startbefehle; `sudo -n -i` nutzt den Cache. `timestamp_timeout=0` → `sudo -n -i` scheitert mit „a password is required“ → vorhandener Pfad `containers.sudoNotCached` (`ended()`), weil `tail` jetzt auch hier gepflegt wird. Falsches Passwort → `containers.sudoRejected`, Rejection gemerkt. |
| Schlüssel/Agent | `{ sudo -n -v 2>/dev/null \|\| { printf '%s\n' HINT; sudo -v; }; } && printf %s READY && sudo -n -i; exit $?` | NOPASSWD: `-n -v` still, READY, Befehle. Ohne NOPASSWD: Hinweis `[Shellherd] sudo verlangt ein Passwort (kein NOPASSWD) – bitte eingeben.` (neuer Key `terminal.sudoNeedsPassword` in `main.json`, über `mainT` an `rootShellCommand` übergeben), dann sudos eigener Prompt `[sudo] password for …:`; der Nutzer tippt (Eingabe **nicht** gesperrt, kein Timer, kein Gate), danach READY → Befehle. Nicht in sudoers: `sudo -v` druckt die Meldung, Kanal endet, Getrennt-Leiste. |
| kein sudo | – (`client.shell`) | Startbefehle sofort nach `attachStream`. |

Warum der letzte Schritt `sudo -n -i` und nicht `sudo -i`: Ein unerwarteter Passwort-Prompt würde die Startbefehle als Passwortversuche verschlucken (echo aus, drei Fehlversuche im auth.log). Mit `-n` scheitert er sofort und sauber erkennbar.

**pty, Umgebung, Größe:** Die pty kommt vom Kanal (`{ term: 'xterm-256color', cols, rows }`, `session.ts:264`); `resize()` ruft `stream.setWindow` (`:540`) → SIGWINCH an die Vordergrundgruppe, auch wenn sudo mit `use_pty` eine eigene pty einzieht (sudo leitet Fenstergrößen weiter). `sudo -i` setzt die Umgebung nach sudoers zurück (`env_reset`, `secure_path`, `HOME=/root`), `TERM` bleibt über `env_keep`. `requiretty` ist erfüllt. Der `PATH_PREFIX` des Container-Skripts ist hier unnötig, schadet aber nicht; `login.ts` lässt ihn weg.

**Änderungen in `session.ts`** (alle klein):

- `Session`: `login?: { sudo: boolean; commands: string[] }` (aus dem Vault, in `connect()` gesetzt, außer `skipLogin`), `sudo.manual?: boolean` (Schlüssel/Agent-Modus: Watcher nur mit `ready`, kein Passwort).
- `prepare()` `:179-209`: `skipLogin` aus dem Request auf der Session merken.
- `connect()` `:239-269`: `session.login = !skip && connection.login && (connection.login.sudo || connection.login.commands?.length) ? {…} : undefined`; `const root = session.login?.sudo ? this.rootShellPlan(session, connection) : undefined` (vor dem Verbinden, wie `:242-243`); in `ready`: `else if (root) client.exec(rootShellCommand(root), { pty }, attach); else client.shell(pty, attach)`.
- `rootShellPlan()` neu neben `sudoMode()`: `sudoSetting(connection, true)` (neuer zweiter Parameter `enabled`, Standard `connection.containers?.sudo === true`, `commands.ts:50`); `prompt` → wie `sudoMode` (Gate, Rejection, Watcher prompt+ready, Passwort), Rückgabe `{ kind: 'password', marker, ready }`; sonst `session.sudo = { watcher: new SudoWatcher({ ready }), fingerprint, manual: true }`, Rückgabe `{ kind: 'manual', ready, hint: mainT('terminal.sudoNeedsPassword') }`.
- `awaitSudoTurn()` `:281`: `if (!pending || pending.manual) return true`.
- `attachStream()` `:289-303`: `exit`-Listener bei `session.target || session.login`; Timer nur `if (session.sudo && !session.sudo.manual)`; nach `status(connected)`: `if (!session.sudo) this.sendLogin(session)`.
- `sudoOutput()` `:322-323`: nach READY `this.sendLogin(session)`; die Prompt-Logik bleibt, im manuellen Modus kommt nie ein Prompt-Marker (`prompts = 0`).
- `sendLogin()` neu: `stream.write(loginInput(session.login.commands))` mit `loginInput = lines => lines.map(l => l + '\r').join('')` aus `login.ts`. `typed` bleibt `false` (siehe Risiken).
- `input()` `:522`: `if (session.sudo && !session.sudo.manual) return`.
- `output()` `:486`: `tail` bei `session.target || session.login`.

### 2.2 Fläche A: Wann ist die Shell bereit?

Bewertung der Varianten:

| Variante | Urteil |
|---|---|
| Prompt-Erkennung | nein: Prompts sind frei konfigurierbar, mehrzeilig, farbig; fish/zsh zeichnen asynchron. |
| `sudo -i bash -c 'cmds; exec bash'` | nein: Befehle wären unsichtbar und nicht in der History (widerspricht der Entscheidung), die Shell wäre immer bash statt der Login-Shell des Nutzers, Vollbildprogramme liefen in einem Subshell-Kontext. |
| Ready-Marker im selben `exec` + Befehle danach schreiben | **ja.** READY bedeutet „sudo hat authentifiziert, die Root-Shell startet jetzt“. Die Bytes liegen in der Eingabewarteschlange der pty (Typeahead) und werden von der Shell gelesen, sobald sie den ersten Prompt liest. Genau das passiert, wenn ein Mensch vor dem Prompt tippt. Ohne sudo: schreiben direkt nach `attachStream`; der sshd hat die Shell-Anfrage angenommen, die Zeilen warten in der pty. |

Robustheit: bash/readline, zsh/ZLE, fish und dash lesen vorhandene Eingabe beim Start (sie setzen die Terminalmodi mit `TCSADRAIN`, nicht `TCSAFLUSH`). Jede Zeile endet mit `\r` wie die Eingabetaste; im kanonischen Modus wandelt `ICRNL` es in `\n`, im Raw-Modus akzeptieren alle vier Shells `\r` als Enter. Die Zeilen werden in einem `write` gesendet; die Shell liest sie nacheinander, solange der laufende Befehl nicht selbst von stdin liest.

Vollbild- und stdin-Programme (`vim`, `top`, `less`, `ssh`, `mysql`): als **letzte** Zeile korrekt – sie starten und bekommen den Fokus. In der Mitte fressen sie die Folgezeilen als Tastendrücke. Das steht so im Handbuch; eine Erkennung gibt es nicht (der Renderer kennt den Alternate-Buffer nur für Workflows, `terminal-access.ts:15-16`, Main nicht).

Timeout und Fehler: Passwort-Modus 20 s (`SUDO_READY_TIMEOUT`) → `sudoGaveUp`-Hinweis, Hold frei, **Befehle werden nicht gesendet** (sie könnten sonst in einen Passwort-Prompt laufen). Manueller Modus: kein Timer; READY kommt, wenn der Nutzer sein Passwort eingegeben hat, erst dann die Befehle. Ohne sudo: sofort, kein Wartefall. Endet der Kanal vorher, flusht `releaseSudoHold` wie heute.

### 2.3 Fläche B: Vault-Modell

```ts
// types.ts, SshConnectionNode
/** Root shell and typed start commands after login; see docs/superpowers/specs/2026-10-21-login-commands-design.md. */
login?: { sudo?: boolean; commands?: string[] };
```

Schema (`schema.ts`, neben `containers`): `login: z.object({ sudo: z.boolean().optional(), commands: z.array(LoginLineSchema).max(20).optional() }).optional()`, nicht strict (wie `:57`). `LoginLineSchema = z.string().min(1).max(500).refine(line => !/[\x00-\x1f\x7f]/.test(line))` – **auch Tab ist verboten** (Ruling R2 unten). Kein Versionssprung: optionales Feld; ein älteres Shellherd entfernt es beim Speichern (Changelog-Hinweis wie bei den Timeouts). `redactSecrets` (`connections.ts:36`) entfernt `login` mit: Nebenfenster und der gesperrte Renderer brauchen die Befehle nicht, und wer trotz Hinweis ein Geheimnis hineinschreibt, hat es dort nicht im Speicher.

`connection-form.ts`: Felder `loginSudo: 'on' | 'off'` und `loginCommands: string`; `fieldsFromConnection` füllt sie bei `ssh`; `connectionFromFields` trennt an `\r?\n`, entfernt Leerzeilen, prüft Zeilenzahl (`connection:validation.loginTooManyLines`), Länge (`loginLineTooLong`) und Steuerzeichen (`loginControlChars`) als `ConnectionFieldError('loginCommands', …)`, und schreibt `login` nur, wenn sudo an ist oder Befehle vorhanden sind. `keepAutoUpload` und die Timeouts bleiben unberührt.

### 2.4 Fläche C: Verbindungsformular

Im SSH-Block direkt unter „Container-Befehle mit sudo ausführen“ (`ConnectionForm.tsx:199-200`), nicht unter „Weitere Angaben“ (dort würde es niemand finden; Fehler-Fokus müsste die Details öffnen):

- Checkbox `.editor-checkbox`: **„Nach dem Anmelden root werden (sudo -i)“** (`connection:form.login.sudo`).
- Label + `<textarea rows={3} spellCheck={false}>` mit `id={`${prefix}-loginCommands`}`: **„Startbefehle (eine Zeile je Befehl)“** (`connection:form.login.commands`), Placeholder leer.
- `.editor-hint`: **„Werden nach dem Anmelden eingetippt, sichtbar und in der Shell-History. Keine Passwörter eintragen; ein Vollbildprogramm nur als letzte Zeile.“** (`connection:form.login.hint`).
- Feldfehler wie bei `textField` (`.field-error`, `aria-invalid`, `role="alert"`), Fokus über die vorhandene `requestAnimationFrame`-Logik `:115`.

Kein neues CSS, keine Bewegung, keine Tokens nötig.

### 2.5 Fläche D: „Ohne Startbefehle verbinden“

- `TerminalTabs.tsx:52`: `onContextMenu={event => { event.preventDefault(); onTabMenu?.(tab.id, event.clientX, event.clientY); }}` am Tab-Button (Shift+F10 und Menütaste lösen in Chromium dasselbe Ereignis aus). Neue optionale Prop `onTabMenu`.
- `SplitTerminalArea.tsx`: State `tabMenu` nach dem Muster `viewMenu` (`:341`, `:454-464`); nur für SSH-Terminal-Tabs (`protocol === 'ssh'`, kein `view`, kein `target`, kein `kube`, `id !== LOCAL_CONTAINER_HOST`), ein Eintrag **„Ohne Startbefehle verbinden“** (`terminal:tabMenu.withoutLogin`), Menü-Label `terminal:tabMenu.label` („Aktionen für {{name}}“). Für andere Tabs kein Menü.
- Weg zum Panel ohne Registry: SplitTerminalArea hält `plainReconnect: { tabId: string; nonce: number } | null` und gibt `TerminalPanel` die Prop `reconnectPlainNonce` (0, wenn nicht betroffen). `TerminalPanel`: `useEffect(() => { if (nonce) { skipLoginRef.current = true; reconnect(); } }, [nonce])`; das Session-Effekt liest `skipLoginRef.current` beim `sshPrepare` (`:202`) als `skipLogin: true` und setzt den Ref danach zurück. `ContainerDock`/`DetailDock` (`ContainerDock.tsx:159`, `DetailDock.tsx:180`) geben die Prop nicht mit.
- Main: `SshPrepareRequest.skipLogin?: boolean` (`ssh.ts:9`), `PrepareSchema` + `skipLogin: z.boolean().optional()` (`validation.ts:8`). Ein Flag, keine Befehle – der Renderer kann nur **weniger** auslösen, nie mehr.
- Semantik (Ruling R3): Der Eintrag übergeht den ganzen Block „Nach dem Anmelden“, also auch `sudo -i`, und gilt für genau diesen Versuch. Er ist immer aktiv; bei laufender Sitzung beendet er sie ohne Rückfrage, weil der Name sagt, dass neu verbunden wird.

### 2.6 Flächen E und F

- Handbuch: neuer Absatz im SSH-Teil nach `docs/handbuch.md:174` (englisch `docs/manual.md:173`): was die Option tut, Passwort- gegen Schlüssel-Login, Hinweis im Terminal, Befehle sichtbar und in der History, keine Passwörter, Vollbild nur zuletzt, `exit` beendet den Tab, kein MOTD, sudo-Aufrufe stehen im auth.log, „Ohne Startbefehle verbinden“ per Rechtsklick auf den Tab, älteres Shellherd entfernt die Einstellung. Changelog 0.16.0 (`npm run version:minor`), `CHANGELOG.en.md` parallel.
- run-app: `sshd.mjs` bekommt einen `exec`-Zweig für `[terminus-sudo-…] … sudo -n -i`: Marker-Prompt schreiben, Zeile lesen, bei `synthetic-demo` READY und dann die Shell-Emulation mit Prompt `root@web-01:~# ` (Shell-Code aus `:152-178` in eine Funktion `serveShell(stream, prompt)` ziehen), sonst `Sorry, try again.` und erneut Marker. `demo-setup.mjs`: Verbindung `ops-01` (SSH, Passwort, root werden, Befehle `uptime` und `df -h /`). `screens.mjs`: Block `login` → `login-commands.png` (Terminal mit Root-Prompt und den beiden getippten Befehlen), `fakes.test.mjs` prüft den Zweig. `SKILL.md`-Tabellen ergänzen.

## 3. Zusammenspiel

| Bereich | Verhalten | Änderung |
|---|---|---|
| Leerlauf-Trennung (`armIdle` `session.ts:453-464`) | Startbefehle gehen direkt in den Stream; ihr Echo stempelt `lastIo` über `output()`. Danach normal. | keine |
| Sperre (lock-screen) | `getConnection` wirft gesperrt (`ipc.ts:45-49`) → kein Prepare/Connect, also auch keine Startbefehle; laufende Sitzungen bleiben. Nach dem Entsperren läuft „Neu verbinden“ mit Startbefehlen. | keine |
| Reconnect | Neuer `attempt` → neues `prepare`/`connect` → Login erneut (Entscheidung). `skipLogin` nur für den einen Versuch. | D |
| Handover zwischen Fenstern (`transferOwner` `:556-565`, `attach` `:568-575`) | Streams pausiert, Watcher und Timer laufen in Main weiter; READY wird nach `attach` verarbeitet. Nebenfenster-Katalog ohne `login` (Redaktion), Main liest den Vault. | keine |
| Workspaces | Tabs werden über dieselben Pfade geöffnet; mehrere Tabs derselben Verbindung durchlaufen das Gate nacheinander. Kein Workspace-Feld, `skipLogin` wird nicht gespeichert. | keine |
| Container-Tabs (`session.target`) | kein Login: `session.login` wird nur ohne `target` und ohne `kube` gesetzt. | explizit in `connect()` |
| Pod-Terminals (`session.kube`), SFTP, lokale Shells, KI-CLI, RDP | nein | – |
| Verbindungstest (`connection-test.ts`) | öffnet keine Shell → unberührt | keine |
| KI-Assistent, Workflows (`shellOf` `terminal-tabs.ts:57-63`) | sehen eine normale `ssh`-Shell | keine |

## 4. Sicherheit

- **Befehle im Vault:** Klartext im verschlüsselten Vault, gleiche Schutzklasse wie Passwörter auf der Platte; im entsperrten Renderer wie alle Verbindungsdaten. Sie sind keine Geheimnisse; das Handbuch sagt: keine Passwörter oder Tokens in Startbefehle (sie wären in der History und im Terminal sichtbar). Zusätzlich werden sie aus Katalog und gesperrtem Renderer redigiert (2.3).
- **IPC-Grenze:** Nur `skipLogin: boolean` kommt vom Renderer, `PrepareSchema` bleibt strict. Befehle liest Main aus dem Vault-Snapshot; Schreiben läuft über den vorhandenen Vault-Pfad mit `ConnectionNodeSchema` (`src/main/index.ts:246`) und `VaultSchema.parse` (`src/main/vault/session.ts:93`).
- **Keine Shell-Injektion durch Befehle:** Die Zeilen sind nie Teil des `exec`-Strings; sie werden erst nach dem Start der Shell als Tastatureingabe geschrieben, ohne Quoting. Der `exec`-String enthält nur Marker (gegen `SUDO_MARKER` geprüft) und den `mainT`-Hinweis, den `shellJoin` in einfache Anführungszeichen setzt.
- **Keine Steuerzeichen:** Zod verbietet `\x00-\x1f` und `\x7f`, damit keine zusätzlichen Enter, Escape-Sequenzen oder Terminal-Antworten eingeschleust werden können. Tab löst in jeder interaktiven Shell die Vervollständigung aus und würde den Befehl verändern, deshalb ebenfalls verboten.
- **Passwort:** Nur auf den Marker-Prompt, höchstens einmal, Ablehnung über `SudoRejections` gemerkt (fingerprintgebunden bis zur Änderung der Anmeldedaten), Passwort nie in Events oder Logs (bestehende Tests `session.test.ts:325-332, 340-342`). Im manuellen Modus wird kein gespeichertes Passwort angefasst.
- **auth.log:** Jedes `sudo -v`/`sudo -i` wird vom Host geloggt. Normal; steht wie bei den Container-Tabs im Handbuch (`handbuch.md:236-237`).
- **Timeout ohne Befehle:** Nach `sudoGaveUp` werden Befehle nicht nachgeschoben.

## 5. Regeln und Risiken – was ausdrücklich nicht getan wird

- Keine Prompt-Erkennung, kein Warten zwischen Befehlen, keine Erkennung von Vollbildprogrammen in Main.
- Kein eigenes sudo-Passwortfeld, kein Senden des SSH-Passworts an einen anderen Prompt als den Marker, nie zweimal.
- Keine Ausführung der Befehle über `exec`/`-c`; sie werden getippt.
- Kein Tab, kein `\r`/`\n`, keine Escape-Sequenzen in Befehlen (Schema).
- Keine Anwendung auf Container-Tabs, Pod-Terminals, SFTP, lokale Shells; kein Versionssprung des Vaults.
- Keine neue Fehlerkarte: sudo-Fehler nutzen die Codes `containers.sudoRejected`, `containers.sudoNotCached`, `containers.passwordLineBreak` (Texte in `errors/containers.json`), angezeigt als Karte `unknown` mit dem codierten Text.

Risiken, die bleiben:

- Shells oder Startskripte, die die Eingabewarteschlange leeren (`tcflush`, selten), verlieren die Startbefehle still; kein Wiederholen. Handbuch-Hinweis.
- Ein Startbefehl, der die Shell beendet (`exit`, `ssh … && exit`), endet mit `typed = false` als „der Server hat sie beendet“. `typed` darf nicht gesetzt werden, weil sonst die `sudoNotCached`-Erkennung (`ended()` `:360`) ausfiele. Kosmetisch, Minor.
- Shell-Besonderheiten gelten wie beim Tippen (History-Expansion mit `!`, Aliase, `set -o vi`). Gewollt.
- `exit` in der Root-Shell schließt den Tab, kein MOTD (exec). Dokumentiert.
- Mit `use_pty` in sudoers bleibt alles funktionsfähig (sudo relayt Eingabe und Fenstergröße).

## 6. Rulings-Vorschläge

- **R1** Root-Shell als `exec` mit Marker-Skript (`sudo -p MARKER -v && printf READY && sudo -n -i`), nicht als getipptes `sudo -i` — erprobter Pfad, kein History-Eintrag, keine Prompt-Erkennung — Kosten, falls falsch: kein MOTD, `exit` schließt den Tab.
- **R2** Startbefehle dürfen keinerlei Steuerzeichen enthalten, auch kein Tab — Tab ist in interaktiven Shells Vervollständigung — Kosten: Nutzer schreibt Leerzeichen.
- **R3** „Ohne Startbefehle verbinden“ übergeht den ganzen Block (auch `sudo -i`), gilt für einen Versuch, ist immer aktiv und beendet eine laufende Sitzung ohne Rückfrage — es ist die Notbremse, wenn sudo oder ein Befehl die Shell blockiert — Kosten: wer nur die Befehle weglassen will, tippt `sudo -i` selbst.
- **R4** Schlüssel/Agent ohne NOPASSWD: Hinweis per `printf` im Skript, dann sudos eigener Prompt (`sudo -v`), Eingabe frei, kein Timer, kein Gate; nach READY laufen die Befehle doch noch — der Nutzer tippt genau einmal sein Passwort, dann passiert, was eingestellt ist — Kosten: ohne Eingabe bleibt der Tab beim Prompt stehen.
- **R5** Letzter Schritt immer `sudo -n -i` — ein unerwarteter Prompt darf nie Befehle als Passwort lesen; `timestamp_timeout=0` endet mit `containers.sudoNotCached` wie bei Container-Tabs.
- **R6** `redactSecrets` entfernt `login` — Nebenfenster und gesperrter Renderer brauchen es nicht — Kosten: keine.
- **R7** Formularblock „Nach dem Anmelden“ sichtbar im SSH-Teil, nicht in „Weitere Angaben“ — Auffindbarkeit, Fehlerfokus ohne Details-Öffnen — Kosten: ~90 px mehr Formularhöhe.
- **R8** Grenzen 20 Zeilen à 500 Zeichen — passt in einen `write`, bleibt lesbar — Kosten: keine bekannten.

## 7. Zerlegung in Tasks (exklusive Dateien)

**Welle 1 – Vertrag (ein Agent, klein, blockiert alles andere):**

- **T1 Shared-Modell und IPC-Vertrag:** `src/shared/vault/types.ts`, `src/shared/vault/schema.ts`, `src/shared/vault/schema.test.ts`, `src/shared/vault/connections.ts` (Redaktion), `src/shared/vault/connections.test.ts`, `src/shared/ssh.ts` (`skipLogin`), `src/main/ssh/validation.ts`, `src/main/ssh/validation.test.ts`.

**Welle 2 – parallel (drei Agenten), abhängig von T1:**

- **T2 Main-Sitzung:** `src/main/ssh/login.ts` (neu: `rootShellCommand`, `loginInput`), `src/main/ssh/login.test.ts` (neu), `src/main/ssh/session.ts`, `src/main/ssh/session.test.ts` (Fake-Zweige: Marker-Skript mit `-i`, manueller Modus mit Umschalter NOPASSWD/Prompt, Shell ohne sudo, `skipLogin`), `src/main/containers/commands.ts` (`sudoSetting(connection, enabled)`, `export SUDO_MARKER`), `src/main/containers/commands.test.ts`, `src/shared/locales/de-DE/main.json`, `src/shared/locales/en-US/main.json`.
- **T3 Formular:** `src/renderer/src/connection-form.ts`, `src/renderer/src/connection-form.test.ts`, `src/renderer/src/components/ConnectionForm.tsx`, `src/shared/locales/de-DE/connection.json`, `src/shared/locales/en-US/connection.json`.
- **T4 Tab-Menü und Versuchsflag:** `src/renderer/src/components/TerminalTabs.tsx`, `src/renderer/src/components/SplitTerminalArea.tsx`, `src/renderer/src/components/TerminalPanel.tsx`, `src/shared/locales/de-DE/terminal.json`, `src/shared/locales/en-US/terminal.json`.

Prüfung nach Welle 2: `npm run typecheck`, `npx vitest run` (i18n-Katalog-Parität, Design-Tokens, alle neuen Tests).

**Welle 3 – parallel (zwei Agenten), erst nach dem Commit des parallelen Ablaufs, abhängig von T2–T4:**

- **T5 Doku und Version:** `docs/handbuch.md`, `docs/manual.md`, `CHANGELOG.md`, `CHANGELOG.en.md`, `package.json`/`package-lock.json` über `npm run version:minor` (0.16.0), ein Satz in `README.md`.
- **T6 run-app:** `.claude/skills/run-app/sshd.mjs`, `fakes.test.mjs`, `demo-setup.mjs`, `screens.mjs`, `SKILL.md`; danach Screenshot `login-commands.png` ansehen.

Danach Review des Branches, Fix-Welle, Nachprüfung.

## 8. Minimale erste Stufe gegenüber Extras

**Stufe 1 (dieses Feature):** T1–T6 wie oben: Vault-Feld, Formularblock, Root-Shell per Marker-Skript in drei Modi, Startbefehle als Typeahead, `skipLogin` + Tab-Menü mit einem Eintrag, Doku, run-app-Szene.

**Extras, nicht jetzt:**

- Eigener Fehlerkarten-Code für sudo (Titel „sudo abgelehnt“ statt „Verbindung fehlgeschlagen“ + Text).
- Verbindungstest prüft `sudo -n -v`.
- Startbefehle für lokale Shells oder Container-Tabs.
- Weitere Tab-Menü-Einträge (Neu verbinden, Schließen, Duplizieren).
- `{{Platzhalter}}` wie in Workflows.

## 9. Abnahme

- `session.test.ts`: (1) Passwort-Modus: `execCommands[0]` passt auf `sudo -p '[terminus-sudo-…]' -v && printf %s '[terminus-ready-…]' && sudo -n -i`, `sudoInput` = `synthetic-password\n` + `uptime\rdf -h /\r`, Ausgabe ohne `terminus-`, Passwort nie in Events. (2) Falsches Passwort → `containers.sudoRejected`, Rejection gemerkt. (3) Schlüssel-Login mit NOPASSWD-Fake → READY, Befehle. (4) Schlüssel-Login ohne NOPASSWD → Hinweistext in der Ausgabe, Eingabe erlaubt, nach dem manuellen Passwort READY und Befehle. (5) Nur Befehle ohne sudo → `shell`-Request, Befehle als Eingabe am Fake-Shell-Stream. (6) `skipLogin: true` → `shell`, keine Eingabe. (7) Timeout im Passwort-Modus → Hinweis, keine Befehle. (8) Container-Tab derselben Verbindung ignoriert `login`.
- `login.test.ts`: Skripte für `password`/`manual`, Marker-Prüfung, `loginInput` mit `\r`.
- `schema.test.ts`: Grenzen, Tab und `\x1b` abgelehnt, Vault ohne `login` unverändert. `connections.test.ts`: Redaktion entfernt `login`.
- `connection-form.test.ts`: Hin- und Rückweg, Leerzeilen weg, Fehlerfelder. `validation.test.ts`: `skipLogin` erlaubt, Fremdfelder weiter abgelehnt.
- run-app: `ops-01` verbinden, auf `root@web-01` im `.xterm` warten, Screenshot; Rechtsklick auf den Tab → „Ohne Startbefehle verbinden“ → Prompt `demo@web-01` ohne getippte Befehle.
