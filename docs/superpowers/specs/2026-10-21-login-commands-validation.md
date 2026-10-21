# Root-Shell und Startbefehle nach dem Anmelden – Validierung (Stufe 3)

Spec: `docs/superpowers/specs/2026-10-21-login-commands-design.md`. Plan: `docs/superpowers/plans/2026-10-21-login-commands.md`. Geprüft wurde gegen den Stand `ad6f7b0` auf `claude/feature/login-commands`. Der Arbeitsbaum ist sauber, der parallele Ablauf ist committet (S2). Die Basis ist grün: `npm run typecheck`, `npx vitest run` mit 128 Dateien und 1825 Tests.

**Dieser Anhang ist bindend und geht Spec und Plan vor.** N1–N5 und S1–S4 gelten unverändert. R1–R8 gelten in der hier präzisierten Fassung. Abweichungen sind: R4 mit `sudo -n true` statt `sudo -n -v` (B1), R3 mit Hinweis im Menü (K8) und R2 auch mit Verbot der C1-Steuerzeichen (K1).

**Urteil: ready after corrections.** Es gibt 1 Blocker und 11 Korrekturen.

Stichproben der Zeilenangaben, alle zutreffend (höchstens ±2 Zeilen):
- `session.ts:38,243,264-267,279-287,289-303,299,301,306-316,319-334,337-341,359-364,486,521-522,540`
- `commands.ts:15-17,28,30-39,50-56`
- `sudo.ts:4-6,13-72`, `sudo-rejections.ts:5-8,26-47`
- `validation.ts:8`, `shared/ssh.ts:9`, `ssh/ipc.ts:45-49`
- `types.ts:62-74`, `schema.ts:75-83`, `connections.ts:33-46`, `window-ipc.ts:82`
- `connection-form.ts:11-47,61-100,87,111-115,117-179,141`
- `ConnectionForm.tsx:113-116,199-200,208`
- `TerminalTabs.tsx:52-60`, `SplitTerminalArea.tsx:341,454-464`, `ContextMenu.tsx:5-8`
- `TerminalPanel.tsx:74-236,202-207,256-259`
- `design-system.md:212`, `handbuch.md:174,236-237`
- `session.test.ts:54-97,129`, `sshd.mjs:17-22,28-47,144-151,152-178`

---

## 1. Vertrag

Alle Signaturen sind wörtlich zu übernehmen. Kommentare stehen auf Englisch.

### 1.1 `src/shared/vault/types.ts` (T1)

```ts
// in SshConnectionNode, after `timeouts`
/** Root shell and typed start commands after login; see docs/superpowers/specs/2026-10-21-login-commands-design.md. */
login?: { sudo?: boolean; commands?: string[] };
```

### 1.2 `src/shared/vault/schema.ts` (T1)

```ts
/** Start commands after login: at most `lines` lines of at most `length` characters. */
export const LOGIN_LIMITS = { lines: 20, length: 500 } as const;
/** C0, DEL and C1 controls: no extra Enter, no Tab completion, no escape sequences or terminal replies. */
export const LOGIN_CONTROL = /[\x00-\x1f\x7f-\x9f]/;
const LoginLineSchema = z.string().min(1).max(LOGIN_LIMITS.length).refine(line => !LOGIN_CONTROL.test(line));

// in SshConnectionNodeSchema, after `timeouts`
login: z.object({
  sudo: z.boolean().optional(),
  commands: z.array(LoginLineSchema).max(LOGIN_LIMITS.lines).optional(),
}).optional(), // not .strict(), like AutoUploadBindingSchema
```

### 1.3 `src/shared/vault/connections.ts` (T1)

`redactSecrets` entfernt bei `ssh` zusätzlich `login`. `sftp` und `rdp` bleiben wie heute. Der Doc-Kommentar lautet dann: `/** Copy for windows that only display connections: SSH credentials and login block, RDP passwords removed. */`.

```ts
if (node.protocol === 'ssh') { const { login: _login, ...rest } = node; return { ...rest, authentication: { method: 'agent' } }; }
if (node.protocol === 'sftp') return { ...node, authentication: { method: 'agent' } };
```

### 1.4 IPC (T1)

```ts
// src/shared/ssh.ts
export interface SshPrepareRequest extends TerminalSize {
  connectionId: string; target?: TerminalTarget; kube?: KubeTerminalTarget;
  /** One attempt without the connection's login block (root shell and start commands); can only switch it off. */
  skipLogin?: boolean;
}
// src/main/ssh/validation.ts
export const PrepareSchema = z.object({ connectionId: …, target: …, kube: …, skipLogin: z.boolean().optional(), ...size }).strict();
```

### 1.5 `src/main/containers/commands.ts` (T2)

```ts
/** No `%` (sudo expands prompt escapes) and nothing a terminal could reinterpret. */
export const SUDO_MARKER = /^[A-Za-z0-9_[\]-]{8,64}$/;

/** How sudo is used for this connection; `enabled` defaults to the container setting. Prompt only with a stored password. */
export function sudoSetting(connection: SshConnectionNode, enabled = connection.containers?.sudo === true):
  { kind: 'none' } | { kind: 'noninteractive' } | { kind: 'prompt'; password: string }
// body: `if (!enabled) return { kind: 'none' };`, the rest stays unchanged
```

### 1.6 `src/main/ssh/login.ts` (neu, T2)

```ts
import { remoteCommand, shellJoin, SUDO_MARKER } from '../containers/commands';

/** password: the stored password answers the marker prompt once. manual: sudo -n, else sudo asks on the terminal and the user types. */
export type RootShellPlan =
  | { kind: 'password'; marker: string; ready: string }
  | { kind: 'manual'; ready: string; hint: string };

/** exec command that authenticates sudo, prints `ready` and then runs `sudo -n -i`; never contains the start commands. */
export function rootShellCommand(plan: RootShellPlan): string;

/** Start commands as typed lines; each ends with Enter (\r). */
export function loginInput(lines: readonly string[]): string;   // lines.map(line => `${line}\r`).join('')
```

Inhalt von `rootShellCommand`:
- `password`: `return remoteCommand(['-i'], { kind: 'prompt', marker: plan.marker, ready: plan.ready, stdin: false });`. Das ergibt `sh -c 'PATH=…; sudo -p MARKER -v && printf %s READY && sudo -n -i; exit $?'`. Der PATH-Präfix bleibt. Damit gibt es keine zweite Marker-Prüfung und keinen zweiten Quoting-Pfad.
- `manual`: Erst `SUDO_MARKER.test(plan.ready)` prüfen, sonst `throw new Error('Invalid sudo marker')`. Dann:
  ```ts
  const script = `{ sudo -n true 2>/dev/null || { echo ${shellJoin([plan.hint])}; sudo -v; }; } && printf %s ${shellJoin([plan.ready])} && sudo -n -i; exit $?`;
  return shellJoin(['sh', '-c', script]);
  ```
  `echo` statt `printf '%s\n'` hat einen Grund: Der exec-String enthält dann keinen Backslash. Das ist sicher für fish und tcsh als Login-Shell (siehe 5).

### 1.7 `src/main/ssh/session.ts` (T2)

```ts
interface Session {
  // …existing fields…
  /** prepare(): this attempt skips the login block ("Ohne Startbefehle verbinden"). */
  skipLogin?: boolean;
  /** Plain SSH terminal of a connection with a login block; never container, pod or local tabs. Commands are sent at most once. */
  login?: { sudo: boolean; commands: string[]; sent?: boolean };
  /** Container tab or root shell authenticating sudo; removed at the ready marker. manual: key/agent login, sudo asks
   *  the user itself, input stays open, no gate, no timer, no stored password. */
  sudo?: { watcher: SudoWatcher; password?: string; fingerprint: string; release?: () => void; timer?: ReturnType<typeof setTimeout>; manual?: boolean };
}
```

Die Änderungen sind abschließend:

| Stelle | Änderung |
|---|---|
| `prepare()` Session-Literal `:194-197` | `...(request.skipLogin ? { skipLogin: true } : {})` |
| `connect()` nach `:238` (nach der Protokollprüfung, also nie für Kube, lokale Shells und `LOCAL_CONTAINER_HOST`) | `const block = !session.target && !session.skipLogin ? connection.login : undefined;` `if (block && (block.sudo === true \|\| (block.commands?.length ?? 0) > 0)) session.login = { sudo: block.sudo === true, commands: [...(block.commands ?? [])] };` |
| `connect()` neben `:243` | `const root = session.login?.sudo ? this.rootShellPlan(session, connection) : undefined;` (vor `sshConnectConfig`, damit Ablehnung und `passwordLineBreak` ohne Hostkontakt scheitern) |
| `connect()` `:266-267` | `if (session.target && sudo) client.exec(remoteCommand(…), { pty }, attach); else if (root) client.exec(rootShellCommand(root), { pty }, attach); else client.shell(pty, attach);` |
| neu `rootShellPlan(session, connection): RootShellPlan` neben `sudoMode()` | `const setting = sudoSetting(connection, true); const fingerprint = connectionFingerprint(connection); const ready = createSudoMarker('ready');` Bei `prompt`: `isRejected` → `throw new AppError('ssh.loginSudoRejected')`, `marker = createSudoMarker('sudo')`, `session.sudo = { watcher: new SudoWatcher({ prompt: marker, ready }), password: setting.password, fingerprint }`, Rückgabe `{ kind: 'password', marker, ready }`. Sonst `session.sudo = { watcher: new SudoWatcher({ ready }), fingerprint, manual: true }`, Rückgabe `{ kind: 'manual', ready, hint: mainT('terminal.sudoNeedsPassword') }`. |
| `awaitSudoTurn()` `:281`, `:285` | `if (!pending \|\| pending.manual) return true;` und `throw new AppError(session.target ? SUDO_REJECTED : 'ssh.loginSudoRejected')` |
| `attachStream()` `:299` | `if (session.target \|\| session.login) stream.on('exit', …)` |
| `attachStream()` `:301` | Timer nur `if (session.sudo && !session.sudo.manual)` |
| `attachStream()` nach `:302` | `if (session.login && !session.login.sudo) this.sendLogin(session);` Die Bedingung ist ausdrücklich so zu schreiben, nicht `if (!session.sudo)` (K3). |
| `sudoOutput()` `:322-328` | Nach `this.output(session, result.output)`: `if (result.ready) { this.sendLogin(session); return; }`, danach `if (!result.prompts) return;`. Der Ablehnungscode heißt `session.target ? SUDO_REJECTED : 'ssh.loginSudoRejected'`. Der Rest bleibt wörtlich, auch „Passwort genau einmal“. |
| `sudoGaveUp()` `:340` | `session.login ? mainT('terminal.sudoGaveUpLogin') : mainT('terminal.sudoGaveUp')` |
| `output()` `:486` | `if (session.target \|\| session.login) session.tail = …` |
| `input()` `:522` | `if (session.sudo && !session.sudo.manual) return;` |
| neu `sendLogin()` | siehe unten |

```ts
/** Types the start commands once: plain shell right after attach, root shell only at sudo's ready marker, never after sudoGaveUp. */
private sendLogin(session: Session): void {
  const login = session.login;
  if (!login || login.sent || !this.active(session) || !session.stream) return;
  login.sent = true;
  const commands = login.commands;
  login.commands = [];
  // Not counted as typed: ended() must still recognise "sudo: a password is required" (containers.sudoNotCached).
  if (commands.length) session.stream.write(loginInput(commands));
}
```

`typed`, `inputBytes` und `lastIo` fasst `sendLogin` nicht an. `lastIo` setzt das Echo über `output()`.

### 1.8 Renderer (T3, T4)

```ts
// connection-form.ts, ConnectionFields (T3)
/** SSH only: become root after login (sudo -i). */
loginSudo: 'on' | 'off';
/** SSH only: start commands, one per line. */
loginCommands: string;

// TerminalTabs.tsx, props (T4)
/** Right-click, Shift+F10 or the menu key on a tab; the caller decides whether a menu opens. */
onTabMenu?: (id: string, x: number, y: number) => void;

// TerminalPanel.tsx, props (T4)
/** A new value starts one attempt without the login block; 0 or a value seen at mount does nothing. */
reconnectPlain?: number;
```

### 1.9 Texte (wörtlich)

| Datei | Key | de-DE | en-US |
|---|---|---|---|
| `main.json` | `terminal.sudoNeedsPassword` | `[Shellherd] sudo verlangt ein Passwort (kein NOPASSWD) – bitte eingeben.` | `[Shellherd] sudo needs a password (no NOPASSWD) – please enter it.` |
| `main.json` | `terminal.sudoGaveUpLogin` | `[Shellherd] sudo hat nicht wie erwartet geantwortet – bitte selbst eingeben. Die Startbefehle werden nicht gesendet.` | `[Shellherd] sudo did not respond as expected – please enter it yourself. The start commands are not sent.` |
| `errors/ssh.json` | `ssh.loginSudoRejected` | `sudo hat das gespeicherte Passwort abgelehnt. Shellherd versucht es erst nach einer Änderung der Anmeldedaten wieder. Ohne Root-Shell verbinden: Rechtsklick auf den Tab, dann „Ohne Startbefehle verbinden“.` | `sudo refused the stored password. Shellherd tries again only after the login data changes. To connect without the root shell: right-click the tab, then “Connect without start commands”.` |
| `connection.json` | `form.login.sudo` | `Nach dem Anmelden root werden (sudo -i)` | `Become root after login (sudo -i)` |
| `connection.json` | `form.login.commands` | `Startbefehle (eine Zeile je Befehl)` | `Start commands (one per line)` |
| `connection.json` | `form.login.hint` | `Werden nach dem Anmelden eingetippt, sichtbar und in der Shell-History. Keine Passwörter eintragen; ein Vollbildprogramm nur als letzte Zeile.` | `Typed after login, visible and in the shell history. Do not enter passwords; put a full-screen program only on the last line.` |
| `connection.json` | `validation.loginTooManyLines` | `Höchstens {{max}} Startbefehle.` | `At most {{max}} start commands.` |
| `connection.json` | `validation.loginLineTooLong` | `Zeile {{line}} ist länger als {{max}} Zeichen.` | `Line {{line}} is longer than {{max}} characters.` |
| `connection.json` | `validation.loginControlChars` | `Zeile {{line}} enthält ein Steuerzeichen wie Tab. Erlaubt sind nur sichtbare Zeichen und Leerzeichen.` | `Line {{line}} contains a control character such as a tab. Only visible characters and spaces are allowed.` |
| `terminal.json` | `tabMenu.label` | `Aktionen für {{name}}` | `Actions for {{name}}` |
| `terminal.json` | `tabMenu.withoutLogin` | `Ohne Startbefehle verbinden` | `Connect without start commands` |
| `terminal.json` | `tabMenu.endsSession` | `Beendet die laufende Sitzung` | `Ends the running session` |

---

## 2. Blocker

**B1 – `sudo -n -v` scheitert im Schlüssel-Modus genau auf den typischen NOPASSWD-Hosts (R4, N3).** `sudo -v` richtet sich nach `verifypw`, Standard `all`: Ohne Passwort geht es nur, wenn **alle** passenden sudoers-Einträge NOPASSWD haben. Auf Cloud-Images (Ubuntu, Debian) steht der Standardbenutzer in `%sudo ALL=(ALL:ALL) ALL` und hat zusätzlich `NOPASSWD:ALL` in `/etc/sudoers.d/90-cloud-init-users`. Dort scheitert `sudo -n -v`, obwohl `sudo -n -i` ohne Passwort liefe.
- **Fehlerszenario:** Schlüssel-Login, „root werden“ an. Es erscheint der Hinweis „sudo verlangt ein Passwort“, danach sudos Prompt. Der Benutzer hat oft gar kein Passwort, weil das Konto gesperrt ist. Er kommt nie an die Root-Shell, die mit `sudo -i` von Hand sofort ginge.
- **Fix:** Die Prüfung im manuellen Skript ist `sudo -n true` (Vertrag 1.6). Sie folgt den Befehlsregeln (letzter Treffer gewinnt) und nicht `verifypw`. Der Passwort-Modus bleibt bei `sudo -p MARKER -v`: Fragt `-v` dort unnötig, beantwortet Shellherd mit dem richtigen Login-Passwort, und das schadet nicht.
- **Test:** `login.test.ts` prüft `sudo -n true 2>/dev/null ||` im manuellen Skript und schließt `sudo -n -v` aus.

---

## 3. Korrekturen (bindend)

**K1 – C1-Steuerzeichen verbieten** (T1 `src/shared/vault/schema.ts`, T3 `src/renderer/src/connection-form.ts`)
- Das Verbot gilt für `[\x00-\x1f\x7f-\x9f]` statt `[\x00-\x1f\x7f]`.
- Grund: U+009B ist in xterm.js ein 8-Bit-CSI. Das Echo eines Startbefehls mit `\u009b6n` löste eine Statusabfrage aus, und die Antwort des Terminals landete als Tastendruck in der Shell. Genau das soll Spec 4 verhindern.
- Formular und Schema nutzen dieselbe exportierte Konstante `LOGIN_CONTROL` und `LOGIN_LIMITS`. Es gibt keine zweite Regex.
- **Test** in `schema.test.ts`: Tab, `\x1b`, `\x7f` und `\u009b` werden abgelehnt. 20 Zeilen à 500 Zeichen gehen durch, 21 Zeilen und 501 Zeichen nicht. Ein Vault ohne `login` bleibt nach `VaultSchema.parse` unverändert, und `login` überlebt den Parse.

**K2 – `login.ts` nutzt `remoteCommand` und enthält keinen Backslash** (T2 `src/main/ssh/login.ts`, `login.test.ts`)
- Umsetzung nach Vertrag 1.6.
- `login.test.ts` erzeugt für beide Modi und beide Hinweistexte (de-DE und en-US, gelesen aus `src/shared/locales/*/main.json`) den Befehl. Er prüft:
  - Ein Backslash kommt höchstens im Muster `'\''` vor, also `expect(cmd.replaceAll(`'\\''`, '')).not.toContain('\\')`.
  - Der Befehl enthält `sudo -n -i; exit $?`.
  - Der Passwort-Modus enthält `-v && printf %s`, der manuelle Modus `sudo -n true 2>/dev/null ||` und nicht `-v && printf`. Diese Abgrenzung braucht das Routing des Test-Fakes.
  - Ein Marker mit `%` oder Leerzeichen wirft.
  - `loginInput(['uptime', 'df -h /'])` ergibt `'uptime\rdf -h /\r'`, `loginInput([])` ergibt `''`.
- Die Hinweistexte enthalten weder `'`, `\`, `%`, `!`, `$`, `` ` `` noch `"`. Das prüft derselbe Test an den JSON-Werten.

**K3 – Invarianten der Startbefehle** (T2 `src/main/ssh/session.ts`)
- Startbefehle gehen nur über `sendLogin()` raus, höchstens einmal je Sitzung (`sent`). Danach ist die Liste leer.
- Im Root-Modus gehen sie nur bei `result.ready` aus `sudoOutput()`. Im reinen Befehlsmodus gehen sie nur über `session.login && !session.login.sudo` in `attachStream()`. Nach `sudoGaveUp()` gehen sie nie, auch nicht, wenn READY später roh ankommt. Das ist schon so, weil der Watcher dann weg ist.
- `sendLogin()` prüft `this.active(session)`, weil `output()` die Sitzung vorher beenden kann (`outputTooSlow`).
- **Tests** in `session.test.ts` zusätzlich zu Spec 9:
  - Im Passwort-Modus ist `sudoInput[0] === 'synthetic-password\n'`. Kein Startbefehl steht vor dem READY in `sudoInput`.
  - Im Timeout-Fall enthält `sudoInput` kein `uptime`. Die Ausgabe enthält `sudoGaveUpLogin`.
  - Zwei READY-Marker im Strom senden die Befehle nur einmal.

**K4 – Eigener Ablehnungstext für die Root-Shell** (T2 `src/main/ssh/session.ts`, `src/shared/locales/{de-DE,en-US}/errors/ssh.json`)
- An allen drei Stellen kommt `ssh.loginSudoRejected` statt `containers.sudoRejected`, wenn `!session.target`: `rootShellPlan`, `awaitSudoTurn`, `sudoOutput`. Die Karte bleibt `unknown`, ein neuer `ConnectionErrorCode` entsteht nicht.
- Grund: Nach einer Ablehnung scheitert jedes „Erneut verbinden“ sofort, weil sich das Gedächtnis die Ablehnung merkt. Der einzige Ausweg liegt im Rechtsklick-Menü, und der Text muss ihn nennen.
- Das Gedächtnis bleibt gemeinsam mit den Container-Tabs (gleicher Fingerprint, gleiches Passwort).

**K5 – Hinweis bei Aufgabe ohne Befehle** (T2 `src/main/ssh/session.ts`, `main.json` beider Sprachen)
- `sudoGaveUp()` nimmt bei `session.login` den Key `terminal.sudoGaveUpLogin` (Text in 1.9). Damit weiß der Nutzer, dass die Befehle nicht kommen.
- Der Ausdruck wird ausgeschrieben, ohne zusammengesetzten Key.

**K6 – Test-Fake und Erwartungen in `session.test.ts`** (T2 `src/main/ssh/session.test.ts`)
- Login-Befehle enthalten keinen Container-Namen. Der Fake schaltet deshalb über Testvariablen, die `beforeEach` zurücksetzt:
  - `loginSudo: 'prompt' | 'wrong' | 'nocache' | 'nopasswd'` für das Passwort-Skript über `simulateTtySudo`. `expected` und `answered` werden aus der Variable statt aus `command.includes(...)` abgeleitet, sobald `command.includes('sudo -n -i')`.
  - `manualSudo: 'nopasswd' | 'prompt'` für das neue Routing `command.includes('sudo -n true')`.
- Der manuelle Zweig schreibt bei `prompt` den Hinweis aus dem Befehl (Regex auf `echo '…'`) und `[sudo] password for synthetic-user: `. Er liest eine Zeile, die der Test per `manager.input` tippt. Danach schreibt er READY und wird zur Echo-Shell.
- Spec 9 (1) wird nicht wörtlich mit Quotes geprüft, weil die inneren Quotes im exec-String als `'\''` stehen. Die Prüfung ist stattdessen: `/sudo -p .*\[terminus-sudo-[0-9a-f]{16}\].* -v && printf %s .*\[terminus-ready-[0-9a-f]{16}\].* && sudo -n -i; exit \$\?/`.
- Spec 9 (4) prüft den Hinweis in der Ausgabe, wie ihn der Fake druckt, und dass `manager.input` vor READY ankommt.
- Für Schlüssel-Login gilt das Muster der vorhandenen Key-Tests: Schlüsseldatei im Temp-Verzeichnis, Server akzeptiert `publickey`.
- **Zusätzlich:**
  - Ein Container-Tab (`target`) derselben Verbindung mit `login.sudo` schickt kein `sudo -n -i` und keine Befehle.
  - `skipLogin: true` auf einer Container-Anfrage ändert nichts.
  - `ssh.loginSudoRejected` kommt nach einer Ablehnung, auch beim nächsten `prepare`/`connect` ohne Hostkontakt.
  - Im Modus `nocache` endet die Sitzung mit `containers.sudoNotCached`.

**K7 – `skipLogin` an den Versuch binden, nicht an einen Ref mit Zurücksetzen** (T4 `src/renderer/src/components/TerminalPanel.tsx`)
- Der Spec-Ansatz (Ref beim `sshPrepare` lesen, danach zurücksetzen) hat zwei Fehler:
  - Scheitert `sshPrepare`, etwa an `ssh.sessionLimit`, bleibt der Ref stehen. Das nächste „Erneut verbinden“ übergeht dann still die Root-Shell.
  - Ein Panel, das mit einer Nonce ungleich 0 montiert wird, verbindet sofort neu.
- Verbindlich ist diese Fassung:
  ```ts
  const plainAttempt = useRef(-1);
  const seenPlain = useRef(reconnectPlain ?? 0);
  useEffect(() => {
    if (!reconnectPlain || reconnectPlain === seenPlain.current) return;
    seenPlain.current = reconnectPlain;
    adoptRef.current = undefined;
    setAttempt(value => { plainAttempt.current = value + 1; return value + 1; });
  }, [reconnectPlain]);
  ```
- Im Session-Effekt steht synchron am Anfang `const skipLogin = plainAttempt.current === attempt;`. `sshPrepare` bekommt `...(skipLogin ? { skipLogin: true } : {})`.
- Die Lösung ist StrictMode-fest, weil die Zuweisung im Updater idempotent ist. Jeder spätere Versuch hat eine andere Nummer und läuft wieder mit Login (N5).

**K8 – Tab-Menü: Hinweis, Fokus und Tastatur** (T4 `src/renderer/src/components/SplitTerminalArea.tsx`, `TerminalTabs.tsx`)
- **`TerminalTabs`:** am Tab-Button `onContextMenu={event => { if (!onTabMenu || disabled) return; event.preventDefault(); … onTabMenu(tab.id, x, y); }}`. Für x und y gilt `event.clientX`/`clientY`. Sind beide 0, wie bei einem Tastatur-Auslöser ohne Koordinaten, nimmt man `rect.left`/`rect.bottom` von `event.currentTarget.getBoundingClientRect()`.
- **`SplitTerminalArea`, State:**
  - `tabMenu: { x; y; tabId } | null`.
  - `plainReconnect: { tabId: string; nonce: number } | null`. Die Nonce zählt global hoch, `(current?.nonce ?? 0) + 1`.
- **Wann das Menü öffnet:** nur wenn `!busy` und der Tab ein SSH-Terminal ist:
  ```ts
  tab.connection.protocol === 'ssh' && !tab.connection.view && !tab.connection.target && !tab.connection.kube && tab.connection.id !== LOCAL_CONTAINER_HOST
  ```
- **Einträge:** genau einer, `{ kind: 'item', label: t('terminal:tabMenu.withoutLogin'), hint: isRunning(tab) ? t('terminal:tabMenu.endsSession') : undefined, onSelect }`. Das Menü-Label ist `t('terminal:tabMenu.label', { name: tabLabel(tab, tabs) })`. R3 bleibt: keine Rückfrage, aber der Hinweis sagt es vorher.
- **Fokus:** `closeTabMenu` setzt den Fokus nach `requestAnimationFrame` auf `document.getElementById(`tab-${tabId}`)`, wenn er noch im Dokument ist. Das gilt auch für Escape. Das Ansicht-Menü bleibt unverändert.
- **Weitergabe:** `TerminalPanel` bekommt `reconnectPlain={plainReconnect?.tabId === tab.id ? plainReconnect.nonce : 0}` nur im `TerminalPanel`-Zweig (`:433`). `ContainerDock` und `DetailDock` bekommen nichts.
- **Regeln:** kein neues CSS und kein Motion-Eintrag (`design-system.md:212`). Es gibt keinen Unit-Test für die Komponente. Die Abnahme läuft über run-app (T6).

**K9 – Formular: Zeilen, Fehler, Beschreibung** (T3 `src/renderer/src/connection-form.ts`, `ConnectionForm.tsx`, `connection-form.test.ts`, `connection.json` beider Sprachen)
- **`fieldsFromConnection`:**
  - Standardwerte `loginSudo: 'off'`, `loginCommands: ''`.
  - Bei `ssh` gilt `loginSudo = login?.sudo ? 'on' : 'off'` und `loginCommands = (login?.commands ?? []).join('\n')`.
- **`connectionFromFields`** prüft nur für `ssh`:
  - Zerlegen mit `fields.loginCommands.split(/\r?\n/)`. Jede Zeile wird mit `trim()` gekürzt, leere Zeilen fallen weg.
  - Fehler-Reihenfolge je Zeile, mit der Zeilennummer **im Textfeld**, 1-basiert und mit Leerzeilen gezählt: zuerst `LOGIN_CONTROL` → `loginControlChars`, dann Länge → `loginLineTooLong`. Danach die Anzahl → `loginTooManyLines`.
  - Alle Fehler kommen als `ConnectionFieldError('loginCommands', …)`.
  - `login` wird nur geschrieben, wenn `loginSudo === 'on'` oder Befehle da sind, und zwar als `{ ...(sudo ? { sudo: true } : {}), ...(commands.length ? { commands } : {}) }`.
- **`ConnectionForm.tsx`**, direkt nach der Checkbox `containerSudo` und innerhalb von `protocol === 'ssh'`:
  - Checkbox `.editor-checkbox` mit `form.login.sudo`.
  - `<div className="editor-field">` mit `<label htmlFor={`${prefix}-loginCommands`}>` und `<textarea id={`${prefix}-loginCommands`} rows={3} spellCheck={false} autoComplete="off">`. Dazu `aria-invalid` wie bei `textField` und `aria-describedby` = Hinweis-ID `${prefix}-loginCommands-hint`, bei Fehler zusätzlich die Fehler-ID.
  - `<p className="editor-hint" id={`${prefix}-loginCommands-hint`}>` und der Fehlerabsatz wie `:135`.
  - Fokus über die vorhandene Logik `:115`. Die Details öffnen sich nicht.
- **Tests:**
  - Hin- und Rückweg mit `login`, `timeouts` und `containers` zusammen.
  - `keepAutoUpload(connectionFromFields(…), existing)` behält `autoUpload`, `login` kommt aus dem Formular.
  - Leerzeilen und Ränder werden entfernt.
  - Zeilennummer im Fehlertext (Zeile 3 bei einer Leerzeile davor).
  - Tab und `\u009b` werden abgelehnt.
  - Beim Protokoll `sftp` entsteht kein `login`.
  - `login` ohne sudo und ohne Befehle wird nicht geschrieben.
  - Das Literal `fields` in `connection-form.test.ts:7` bekommt die beiden neuen Felder, sonst bricht der Typecheck.

**K10 – Doku vorziehen und ergänzen** (T5, Welle 2)
- **Ablauf:** T5 läuft in Welle 2, weil alle Texte hier feststehen.
- **Handbuch:** `docs/handbuch.md` nach `:174` und `docs/manual.md` an der entsprechenden Stelle. Zusätzlich zu Spec 2.6 nennt das Handbuch:
  - Getippte Befehle können doppelt erscheinen: einmal als Echo vor dem Prompt, einmal an der Eingabezeile. Das ist das normale Verhalten bei vorab Getipptem.
  - Fragt der Server vor der Shell etwas ab (abgelaufenes Passwort, Auswahlmenü, Abfrage in `.bashrc`), landen die Startbefehle **ohne** „root werden“ dort.
  - Mit „root werden“ gehen die Befehle erst nach erfolgreichem sudo raus.
  - Mit Schlüssel prüft Shellherd `sudo -n true`. Das gilt für NOPASSWD-Regeln auch neben `%sudo`.
  - Nach einer Ablehnung hilft „Ohne Startbefehle verbinden“ oder eine Änderung der Anmeldedaten.
- **Changelog:** `CHANGELOG.md` und `CHANGELOG.en.md`, Abschnitt `## [0.16.0] – 2026-10-21`, ohne Fettdruck. Die deutschen Punkte wörtlich:
  - `- Neu: SSH-Verbindungen können nach dem Anmelden root werden (sudo -i). Bei Passwort-Anmeldung beantwortet Shellherd die sudo-Abfrage einmal mit dem gespeicherten Passwort; bei Schlüssel oder Agent fragt sudo im Terminal, falls kein NOPASSWD eingerichtet ist.`
  - `- Neu: Startbefehle je SSH-Verbindung, eine Zeile je Befehl. Sie werden nach dem Anmelden eingetippt, sichtbar und in der Shell-History.`
  - `- Neu: Rechtsklick auf einen SSH-Tab bietet Ohne Startbefehle verbinden. Das verbindet einmal ohne Root-Shell und ohne Startbefehle.`
  - `- Ältere Shellherd-Versionen entfernen diese Einstellungen beim Speichern.`
- **Version:** über `npm run version:minor`.
- **README:** ein Satz in der Funktionsliste.

**K11 – run-app: glaubwürdige Root-Shell** (T6 `.claude/skills/run-app/sshd.mjs`, `fakes.test.mjs`, `demo-setup.mjs`, `screens.mjs`, `SKILL.md`)
- **`sshd.mjs`:** Die Shell-Emulation `:152-178` wird zu `serveShell(stream, { prompt, banner })`. Der normale Zweig ruft `serveShell(stream, { prompt, banner: motd })`.
- **Neuer Zweig im `exec`-Handler** vor `execReply`, wenn `/\[terminus-sudo-[0-9a-f]{16}\]/` und `sudo -n -i` im Befehl stehen:
  1. Den Marker in zwei `write`s schreiben, als geteilten Chunk.
  2. Bytes bis `\n` sammeln, **ohne Echo**.
  3. Bei `synthetic-demo`: `\r\n` schreiben, dann den READY-Marker aus dem Befehl, dann `serveShell(stream, { prompt: 'root@web-01:~# ', banner: '' })`. Bytes, die im selben Chunk nach dem `\n` kamen, gehen an die Shell weiter.
  4. Sonst `\r\nSorry, try again.\r\n` und erneut den Marker. Shellherd bricht dann selbst ab.
  - `exit` beendet den Kanal mit 0, der Tab schließt (R1). Andere exec-Befehle bleiben unverändert.
- **`fakes.test.mjs`** treibt den Zweig mit dem echten `SshSessionManager` (`src/main/ssh/session.ts`) und einer Verbindung mit `login: { sudo: true, commands: ['uptime', 'df -h /'] }`. Erwartet werden:
  - `root@web-01:~# ` und `load average` in der Ausgabe, kein `terminus-`.
  - Mit `skipLogin: true` der Prompt `demo@web-01:~$ ` ohne `load average`.
  - Mit falschem Passwort im Vault: SSH-Auth scheitert beim Fake. Diesen Fall testet nur `session.test.ts`.
- **`demo-setup.mjs`:** Verbindung `ops-01` (SSH, Passwort `synthetic-demo`). Die Checkbox wird über den Labeltext `Nach dem Anmelden root werden (sudo -i)` gesetzt, das Textfeld über `textarea[id$="-loginCommands"]` mit `uptime` und `df -h /` gefüllt.
- **`screens.mjs`, Block `login`:**
  1. `ops-01` verbinden, auf `root@web-01` im `.xterm` warten.
  2. Screenshot `login-commands.png` aufnehmen.
  3. Rechtsklick auf den Tab, Menüpunkt „Ohne Startbefehle verbinden“.
  4. Auf `demo@web-01` warten, Screenshot `login-commands-plain.png`.
- **`SKILL.md`:** Tabellen ergänzen.

---

## 4. Wellen (endgültig)

Gate nach jeder Welle: `npm run typecheck` und `npx vitest run` grün. Umsetzer schreiben nur die genannten Dateien und committen nie. Je Task gibt es nach der Welle einen Commit.

| Welle | Task | Dateien (exklusiv) | Pflichtpunkte |
|---|---|---|---|
| 1 | **T1 Vertrag** | `src/shared/vault/types.ts`, `schema.ts`, `schema.test.ts`, `connections.ts`, `connections.test.ts`, `src/shared/ssh.ts`, `src/main/ssh/validation.ts`, `validation.test.ts` | Vertrag 1.1–1.4. K1 (Schema-Teil, Konstanten exportiert). `connections.test.ts`: `login` fehlt nach `redactSecrets` und `redactVault`, `containers`/`timeouts` bleiben. `validation.test.ts`: `skipLogin: true` erlaubt, `skipLogin: 'x'` und `commands: […]` abgelehnt. Alles optional, Welle bleibt grün. |
| 2 | **T2 Main** | `src/main/ssh/login.ts` (neu), `login.test.ts` (neu), `session.ts`, `session.test.ts`, `src/main/containers/commands.ts`, `commands.test.ts`, `src/shared/locales/{de-DE,en-US}/main.json`, `src/shared/locales/{de-DE,en-US}/errors/ssh.json` | Vertrag 1.5–1.7. B1, K2–K6. Texte aus 1.9. Spec-9-Fälle (1)–(8) plus die Zusätze aus K3 und K6. `commands.test.ts`: `sudoSetting(c, true)` ohne `containers.sudo` ergibt `prompt`/`noninteractive`, `sudoSetting(c)` bleibt wie bisher. |
| 2 | **T3 Formular** | `src/renderer/src/connection-form.ts`, `connection-form.test.ts`, `components/ConnectionForm.tsx`, `src/shared/locales/{de-DE,en-US}/connection.json` | Vertrag 1.8 (Felder). K1 (Formular-Teil), K9. Texte aus 1.9. |
| 2 | **T4 Tab-Menü** | `src/renderer/src/components/TerminalTabs.tsx`, `SplitTerminalArea.tsx`, `TerminalPanel.tsx`, `src/shared/locales/{de-DE,en-US}/terminal.json` | Vertrag 1.8 (Props). K7, K8. Texte aus 1.9. Kein CSS. |
| 2 | **T5 Doku und Version** | `docs/handbuch.md`, `docs/manual.md`, `CHANGELOG.md`, `CHANGELOG.en.md`, `package.json`, `package-lock.json`, `README.md` | Spec 2.6 und K10. `npm run version:minor` → 0.16.0, Changelog-Abschnitt in beiden Sprachen, damit `scripts/check-version.mjs` grün bleibt. |
| 3 | **T6 run-app** | `.claude/skills/run-app/sshd.mjs`, `fakes.test.mjs`, `demo-setup.mjs`, `screens.mjs`, `SKILL.md` | K11. Danach run-app starten und beide Screenshots ansehen (S4). |

Die Dateien überschneiden sich nicht. Die Locale-Dateien sind nach Namespace getrennt: T2 hat `main` und `errors/ssh`, T3 `connection`, T4 `terminal`. Jeder Task in Welle 2 bringt seine Keys zusammen mit der Verwendung. So bleiben der Verwaiste-Keys-Test (d) und die Parität (a) nach jeder Teilmenge grün. T3 und T4 hängen nur von T1 ab, nicht von T2.

---

## 5. Offene Risiken

Sicherheitsprüfung, Ergebnis je Fall:

| Fall | Ergebnis |
|---|---|
| sudo-Cache gültig | `sudo -v` fragt nicht, READY kommt, das Passwort wird nicht gesendet und mit `dropSudo` vergessen. |
| NOPASSWD | Im Passwort-Modus fragt es nicht oder wird korrekt beantwortet. Im manuellen Modus gilt B1. |
| Ablehnung | Zweiter Marker → Ende, `markRejected`, das Passwort geht nie zweimal raus (K4). |
| Timeout | Nach 20 s ist der Watcher weg. Ein späterer Marker oder READY erscheint roh, es gehen weder Passwort noch Befehle raus (K3, K5). |
| langsame oder geteilte Ausgabe | Der Watcher hält bis zu `marker.length - 1` Bytes zurück. Getestet ist das mit dem geteilten Marker in `simulateTtySudo`. |
| Marker vom Server selbst | `exec` druckt kein MOTD. Der Marker ist je Sitzung zufällig (64 Bit) und für Profil-Skripte nicht vorhersagbar. Ein bösartiger Server hat das Passwort ohnehin, denn er bekam es beim SSH-Login. |
| Startbefehle als Passwort | Im Root-Modus nie: Sie gehen erst nach READY raus, und danach läuft nur `sudo -n -i`, das nie fragt (R5). |
| Steuerzeichen | Zod im Vault-Schreibpfad (nur Hauptfenster, `requireMain`) und das Formular verbieten C0, DEL und C1 (K1). |
| `skipLogin` | Ist ein Boolean in einem strikten Schema. Main setzt damit nur `session.login` nicht. Befehle kommen ausschließlich aus dem Vault-Snapshot. |

Verbleibende Risiken:

1. **Marker-Einschleusung durch einen anderen lokalen Benutzer auf dem Host** (gilt seit jeher auch für Container-Tabs).
   - Der exec-String mit Marker steht in `ps` und `/proc/*/cmdline`. Bei `mesg y` könnte ein anderer Benutzer den Marker per `write` vor sudos Prompt in die pty schreiben.
   - Folge: Shellherd schreibt das Passwort, solange das Echo noch an ist. Es erscheint im **eigenen** Terminal und im `tail`, der Angreifer sieht es nicht. sudo verwirft die Eingabe beim Prompt, der echte Prompt zählt als zweiter, und die Sitzung endet mit „abgelehnt“ (DoS).
   - Abhilfe auf dem Host: `hidepid=2` und `mesg n`. Akzeptiert, Minor.
2. **Ohne „root werden“ gehen die Startbefehle sofort nach dem Shell-Start raus.**
   - Ein vorgeschalteter Dialog liest sie: Passwortwechsel bei abgelaufenem Konto (ein Fehlversuch bei `passwd`), Bastion-Menü, `read` in `.bashrc`.
   - Sie sind keine Geheimnisse. Bei einer Passwortabfrage zählen sie aber als ein Fehlversuch. Steht im Handbuch (K10), sonst akzeptiert.
3. **Shells, die beim Start die Eingabewarteschlange leeren oder sofort interaktiv fragen,** verlieren oder verbrauchen die Befehle. Beispiele sind `tcflush` und `zsh-newuser-install` bei root ohne `.zshrc`. Ein Wiederholen gibt es nicht. Die geprüften Fälle sind unkritisch:
   - bash/readline, zsh/ZLE und `stty` setzen mit `TCSADRAIN`, fish mit `TCSANOW`.
   - sudo leert die Eingabe nur nach dem eigenen Passwort-Prompt (`TCSAFLUSH`). Das liegt vor READY und betrifft die Befehle nicht.
4. **Doppeltes Echo** vorab getippter Befehle (tty-Echo vor dem Prompt plus Zeileneditor) ist kosmetisch und im Handbuch erklärt. Der Fake zeigt es nicht.
5. **Login-Shells**
   - Der exec-String ist `sh -c '<script>'`, nur dieses äußere Quoting sieht die Login-Shell.
   - bash, sh, dash und zsh sind POSIX-konform. fish behandelt in einfachen Quotes nur `\\` und `\'` besonders; tcsh und csh werten Variablen und Verlaufsersetzung in einfachen Quotes nicht nichtinteraktiv aus. Durch K2 kommt kein Backslash vor einem `'` vor. Diese Login-Shells funktionieren damit.
   - Nicht unterstützt sind nushell, xonsh, PowerShell und Windows-OpenSSH mit cmd: Der Kanal endet mit Fehlerausgabe, die Getrennt-Leiste erscheint.
   - Ebenso nicht unterstützt sind `ForceCommand` oder `command=`-Schlüssel, die das Kommando ignorieren: kein Marker, nach 20 s Hinweis, keine Befehle.
   - zsh mit `RC_QUOTES` ist unkritisch, weil der Befehl kein `''` enthält.
6. **PAM-Prompts ohne Marker** (OTP oder `passprompt_regex`, die den PAM-Prompt zeigen) führen zum Timeout und zum Hinweis. Der Nutzer tippt selbst, die Befehle kommen nicht. Das ist sicher, aber unbequem.
7. **Manueller Modus:** Hat der Nutzer sein sudo-Passwort getippt, ist `typed = true`. Ein späteres `sudo -n -i` mit `timestamp_timeout=0` zeigt dann nur die sudo-Meldung im Terminal und keine `sudoNotCached`-Karte. Kosmetisch.
8. **Ein Startbefehl, der die Shell beendet,** endet als „vom Server beendet“, weil `typed` false bleibt (Spec 5). Akzeptiert.
9. **Sperre:** Ein Sudo-Austausch und `sendLogin` einer vor der Sperre gestarteten Sitzung laufen während der Sperre zu Ende. Das passt zu „laufende Sitzungen bleiben“ (0.15.0). Neue Verbindungen gehen gesperrt nicht, weil `getConnection` wirft.
10. **Mehrere Root-Tabs derselben Verbindung:** sudo cached je tty (`timestamp_type=tty`). Jeder Tab beantwortet daher seinen eigenen Prompt einmal. Das Gate serialisiert sie, eine Ablehnung trifft nur den ersten Tab.
