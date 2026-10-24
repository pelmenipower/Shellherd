# SSH-Pro – Validierung (bindend)

Urteil: **ready after corrections**. 0 Blocker, 14 Korrekturen (K1–K14), 3 Rulings zum Ablauf.
Dieser Anhang geht Spec (`2026-10-24-ssh-pro-design.md`) und Konzept vor. Was hier nicht geändert wird, gilt aus der Spec wörtlich (Texte, Fehlertexte, Regeln in Abschnitt 6).

## 0. Rulings zum Ablauf

- **R-A Orphan-Test zwischen den Wellen:** Nach Welle 1 und 2 darf `i18n-catalog.test.ts` (d) nur für die neuen `errors:ssh.*`-Keys aus K2 rot sein. Nach Welle 3 ist alles grün. Jede andere rote Prüfung ist ein Fehler der Welle.
- **R-B Weiterleitungen gelten ab der nächsten Verbindung** (wie Timeouts, Changelog 0.14.0). Eine Sitzung nimmt beim Verbinden einen Schnappschuss der `forwards`; spätere Vault-Änderungen wirken erst nach „Neu verbinden“. Deshalb entfällt `ssh.forwardNotFound`.
- **R-C Umsetzer arbeiten nur in ihren Dateien.** Typfehler in Dateien anderer Tasks derselben Welle sind erwartbar und werden gemeldet, nicht behoben.

## 1. Korrekturen

- **K1 `runner.ts` wandert in Welle 2 (Task B).** `jump.ts`, Terminal, SFTP und Test brauchen die neue Signatur von `openRemoteHost` in Welle 3. Task K behält nur `containers/ipc.ts` und `kubernetes/ipc.ts`.
- **K2 Fehlercodes (Task A, `errors/ssh.json` de-DE und en-US):** genau diese elf, Texte de-DE aus Spec 3.6, 4.6, 5.6; en-US sinngemäß:
  `promptCancelled`, `promptInvalid`, `jumpHostMissing` `{id}`, `jumpHostUnusable` `{name}`, `jumpHostFailed` `{name}`, `jumpTargetUnreachable` `{host}`,`{port}`, `forwardPortInUse` `{port}`, `forwardPortDenied` `{port}`, `forwardRemoteRefused` `{port}`, `forwardElsewhere`, `forwardFailed`. **Kein** `forwardNotFound` (R-B).
  en-US: „Sign-in cancelled.“, „The server sent too many or invalid sign-in prompts.“, „The jump host "{{id}}" no longer exists.“, „"{{name}}" cannot be used as a jump host. It must be an active SSH connection without a jump host of its own.“, „Jump host "{{name}}" is not reachable.“, „The jump host cannot reach {{host}}:{{port}}.“, „Port {{port}} is already in use on this computer.“, „Port {{port}} may not be opened on this computer.“, „The server refuses to forward port {{port}} (AllowTcpForwarding or port in use).“, „This port forward is already running in another tab.“, „The port forward could not be started.“
  Port-Platzhalter heißen `port`, nie `count` (keine Tausenderpunkte).
- **K3 Keyboard-Interactive-Verdrahtung** (Vertrag in 2.2): `sshConnectConfig` bekommt `extras` mit `client`, `keyboard`, `sock`. `tryKeyboard` ist `true` genau dann, wenn `extras.client` und `extras.keyboard` gesetzt sind. Der Listener wird an `extras.client` gehängt.
- **K4 Abbruch einer Rückfrage:** Liefert `ask` `null`, ruft der Handler `client.emit('error', new AppError('ssh.promptCancelled'))` und danach `client.destroy()`. Ist `isActive()` falsch, nur `client.destroy()`. Mehr als 6 Runden: `client.emit('error', new AppError('ssh.promptInvalid'))`, `client.destroy()`. Kein `finish([])` in diesen Fällen.
- **K5 Broker-Ziel:** Der Broker kennt keine Fenster. Er bekommt `resolveTarget(ownerId?)` (2.3). Task M implementiert es in `index.ts`: Besitzer-webContents, wenn lebendig; sonst `windowRegistry` zuletzt fokussiertes Fenster; sonst Hauptfenster.
- **K6 Sperre:** Task M ruft `authPrompts.cancelAll()` an **beiden** Stellen, an denen `IPC_CHANNELS.vaultLocked` angekündigt wird (`onLock` und `autoLock.lock`), jeweils **vor** `announce`. Außerdem in `closeAllSessions`/`before-quit`, falls vorhanden, und `authPrompts.cancelOwner(ownerId)` in `closeOwnerSessions`.
- **K7 Antwort-Kanal:** Handler für `ssh:auth-prompt-answer` registriert Task I in `src/main/ssh/ipc.ts` mit `requireSshSender(event)` und `AuthPromptAnswerSchema` aus `validation.ts` (2.4). Der Broker prüft zusätzlich Absender-Id, `promptId`, Länge.
- **K8 Sprunghost-Dialog im richtigen Fenster:** `openRemote` und `openJump` nehmen `ownerId?` (2.5), damit die 2FA-Frage des Sprunghosts im Fenster des Tabs erscheint.
- **K9 Testlauf mit Sprunghost:** Der Test-Timer startet erst **nach** `openJump`. Ohne Sprunghost unverändert. Mit Sprunghost: kein `nameResolved`; Erfolg → `{ step: 'jumpHost', ok: true, params: { name: jump.name } }`; Fehler → `{ step: 'jumpHost', ok: false, params: { name: <Name aus Vault oder die Id> }, note: publicError(error) }` und Ende.
- **K10 Ketten im Formular:** zusätzlich zu den Spec-Regeln lehnt das Formular einen Sprunghost ab, wenn die bearbeitete Verbindung selbst Sprunghost einer anderen ist. Neuer Key `connection:validation.jumpIsJumpHost` = „Diese Verbindung ist selbst Sprunghost für andere Verbindungen. Ketten gehen noch nicht.“ / „This connection is itself the jump host of other connections. Chains are not supported yet.“ Main prüft zur Laufzeit trotzdem (`ssh.jumpHostUnusable`).
- **K11 Leerlauf mit Weiterleitungen:** In `armIdle` wird `check` zu: `if (elapsed >= idleMs && !session.forwards?.busy()) finish(…'idle'); else session.idleTimer = setTimeout(check, elapsed >= idleMs ? idleMs : idleMs - elapsed);`
- **K12 Registry-Änderungen erreichen alle Tabs:** `ForwardRegistry` hat `subscribe`; jede `SessionForwards` sendet ihre Liste neu, wenn sich die Registry ändert (sonst bliebe „läuft in anderem Tab“ nach dem Stoppen stehen).
- **K13 SOCKS5 in eigener Datei** `src/main/ssh/socks5.ts` (Task C), reine Parser-Funktionen mit Test. Kein neues Paket.
- **K14 Formular-Helfer sind rein und getestet:** `jumpHostOptions`, `validateJumpHost`, `jumpHostReferences` in `connection-form.ts` (2.7); Weiterleitungs-Entwürfe in `forward-form.ts` (2.8).

## 2. Vertrag (wörtlich übernehmen)

### 2.1 Task A – shared

`src/shared/ssh.ts` ergänzt:

```ts
export type SshStep = 'jump' | 'reach' | 'hostkey' | 'auth' | 'shell';
export interface AuthPromptField { text: string; echo: boolean }
/** One keyboard-interactive round; server texts are cleaned in Main (control characters removed, lengths capped). */
export interface AuthPromptRequest {
  promptId: string;
  connectionName: string;
  /** `host:port` as configured. */
  host: string;
  title: string;
  instructions: string;
  fields: AuthPromptField[];
}
/** answers null = cancelled. */
export interface AuthPromptAnswer { promptId: string; answers: string[] | null }
export type ForwardKind = 'local' | 'remote' | 'dynamic';
export type ForwardState = 'stopped' | 'starting' | 'active' | 'error' | 'elsewhere';
export interface ForwardStatus {
  id: string; kind: ForwardKind;
  localPort?: number; remotePort?: number; targetHost?: string; targetPort?: number;
  state: ForwardState; error?: CodedError;
  /** Open channels right now. */
  open: number;
}
export interface SshForwardRequest extends SshSessionRequest { forwardId: string; run: boolean }
```
`SshEvent` bekommt die Variante `| { type: 'forwards'; sessionId: string; forwards: ForwardStatus[] }`.

`src/shared/ipc.ts`: Kanäle `sshAuthPrompt: 'ssh:auth-prompt'`, `sshAuthPromptClosed: 'ssh:auth-prompt-closed'`, `sshAuthPromptAnswer: 'ssh:auth-prompt-answer'`, `sshForward: 'ssh:forward'`. `DesktopApi`:
```ts
onAuthPrompt: (listener: (request: AuthPromptRequest) => void) => () => void;
onAuthPromptClosed: (listener: (event: { promptId: string }) => void) => () => void;
answerAuthPrompt: (answer: AuthPromptAnswer) => Promise<void>;
sshForward: (request: SshForwardRequest) => Promise<void>;
```
`src/preload/index.ts`: dieselben vier, nach dem Muster von `onSshEvent`/`sshClose`.

`src/shared/vault/schema.ts`: `jumpHost: z.string().min(1).max(256).optional()` an SSH **und** SFTP; `forwards` nur an SSH, `PortForwardSchema` exportiert, Definition aus Spec 5.1 wörtlich (inkl. `.max(16)` und Id-Eindeutigkeit). Export `MAX_FORWARDS = 16`.
`src/shared/vault/types.ts`:
```ts
export type PortForward =
  | { id: string; kind: 'local'; localPort: number; targetHost: string; targetPort: number; auto: boolean }
  | { id: string; kind: 'remote'; remotePort: number; targetHost: string; targetPort: number; auto: boolean }
  | { id: string; kind: 'dynamic'; localPort: number; auto: boolean };
```
`SshConnectionNode`: `jumpHost?: string; forwards?: PortForward[]`. `SftpConnectionNode`: `jumpHost?: string`.
`schema.test.ts`: je ein Test für gültigen `jumpHost`, gültige drei `forwards`-Arten, doppelte Id abgelehnt, 17 Einträge abgelehnt, Port 0 abgelehnt, `forwards` an SFTP wird verworfen (nicht abgelehnt).

`src/shared/connection-test.ts`: `ConnectionTestStepId` + `'jumpHost'`. Kommentar `params`: `jumpHost: { name }`.

`errors/ssh.json` (de-DE, en-US): K2.

### 2.2 Task B – `src/main/ssh/client-config.ts`

```ts
export interface KeyboardPrompts { ask: AskPrompts; ownerId?: number; isActive: () => boolean }
export interface ConnectExtras { client?: Client; keyboard?: KeyboardPrompts; sock?: Duplex }
export async function sshConnectConfig(connection: SshConnectionNode | SftpConnectionNode,
  hostVerifier: (key: Buffer, callback: (valid: boolean) => void) => void,
  timeouts: ConnectionTimeouts = DEFAULT_TIMEOUTS, extras: ConnectExtras = {}): Promise<{ config: ConnectConfig; key?: Buffer }>;
/** Pure: whether a round may take the stored password (spec 3.3). */
export function autoPasswordAnswer(connection: SshConnectionNode | SftpConnectionNode, fields: AuthPromptField[], used: boolean): string | undefined;
```
`config.sock = extras.sock` wenn gesetzt. Handler nach Spec 3.3 und K4; `rounds` und `passwordUsed` je Aufruf von `sshConnectConfig`. Request an `ask`: `{ connectionName: connection.name, host: \`${connection.host}:${connection.port}\`, title: name, instructions, fields: prompts.map(p => ({ text: p.prompt, echo: p.echo === true })) }` – das Reinigen macht der Broker.

### 2.3 Task B – `src/main/ssh/auth-prompts.ts`

```ts
export type AskPrompts = (request: Omit<AuthPromptRequest, 'promptId'>,
  options: { ownerId?: number; isActive: () => boolean }) => Promise<string[] | null>;
export interface PromptTarget { id: number; send(channel: string, payload: unknown): void }
export interface AuthPromptDependencies { resolveTarget(ownerId?: number): PromptTarget | undefined; isUnlocked(): boolean }
export class AuthPrompts {
  constructor(dependencies: AuthPromptDependencies);
  readonly ask: AskPrompts;           // arrow property, bound
  answer(senderId: number, answer: AuthPromptAnswer): void;
  cancelAll(): void;
  cancelOwner(ownerId: number): void;
}
export function cleanPromptRequest(request: Omit<AuthPromptRequest, 'promptId'>): Omit<AuthPromptRequest, 'promptId'> | undefined; // undefined = invalid (>8 fields or 0 fields)
```
Regeln aus Spec 3.2 wörtlich. Ein Prompt zur Zeit (Warteschlange). Kein Ziel → `null`. `cancelOwner` beendet laufende und wartende Fragen dieses Besitzers bzw. deren Ziel-webContents mit `null` und sendet `ssh:auth-prompt-closed` an das Ziel, wenn es lebt. Antworten nie loggen.

### 2.4 Task I – `src/main/ssh/validation.ts`

```ts
export const AuthPromptAnswerSchema = z.object({ promptId: z.string().uuid(), answers: z.array(z.string().max(1024)).max(8).nullable() }).strict();
export const ForwardSchema = z.object({ ...session, forwardId: z.string().uuid(), run: z.boolean() }).strict();
```

### 2.5 Task B – `src/main/ssh/jump.ts` und `src/main/containers/runner.ts`

```ts
// runner.ts
export interface RemoteExtras { ask?: AskPrompts; ownerId?: number; sock?: Duplex }
export async function openRemoteHost(connection: SshConnectionNode, verifyHost: VerifyHost, createClient = () => new Client(),
  timeouts: ConnectionTimeouts = DEFAULT_TIMEOUTS, extras: RemoteExtras = {}): Promise<RemoteHost>;
// passes { client, sock: extras.sock, keyboard: extras.ask ? { ask: extras.ask, ownerId: extras.ownerId, isActive: () => !closed } : undefined }

// jump.ts
export interface Jump { readonly name: string; readonly sock: Duplex; close(): void }
export interface JumpDependencies {
  getConnection(id: string): ConnectionNode | undefined;
  openRemote(connection: SshConnectionNode, ownerId?: number): Promise<RemoteHost>;
}
export async function openJump(connection: SshConnectionNode | SftpConnectionNode, dependencies: JumpDependencies, ownerId?: number): Promise<Jump | undefined>;
```
Fehler nach Spec 4.2 (`jumpHostMissing`, `jumpHostUnusable`, `jumpHostFailed` mit `causes`, `jumpTargetUnreachable`). `close()` ist idempotent und zerstört Kanal und Sprunghost.

### 2.6 Task C – `src/main/ssh/forwards.ts`, `socks5.ts`, `kubernetes/tunnel.ts`

```ts
// tunnel.ts
export function openTunnel(forward: …, target: …, port = 0): Promise<Tunnel>;  // Kube-Aufrufer unverändert
// forwards.ts
export class ForwardRegistry {
  claim(key: string, sessionId: string): boolean;     // false when another session holds it
  release(key: string, sessionId: string): void;      // only the holder releases
  holder(key: string): string | undefined;
  subscribe(listener: () => void): () => void;
}
export class SessionForwards {
  constructor(options: { client: Client; connectionId: string; sessionId: string; forwards: PortForward[];
    registry: ForwardRegistry; emit: (list: ForwardStatus[]) => void; connect?: typeof import('node:net').connect });
  startAuto(): void;
  start(id: string): Promise<void>;   // throws AppError ssh.forwardElsewhere | ssh.forward* (also sets state 'error')
  stop(id: string): void;
  stopAll(): void;                    // also unsubscribes from the registry
  busy(): boolean;                    // any open channel
  list(): ForwardStatus[];
}
// socks5.ts (pure)
export type SocksGreeting = { ok: true; rest: Buffer } | { ok: false } | { need: true };
export function parseGreeting(buffer: Buffer): SocksGreeting;   // v5, accepts only when method 0x00 is offered
export type SocksRequest = { ok: true; host: string; port: number; rest: Buffer } | { ok: false; reply: number } | { need: true };
export function parseRequest(buffer: Buffer): SocksRequest;      // CONNECT only, ATYP 1/3/4; other command → reply 0x07
export function reply(code: number): Buffer;                     // 10-byte reply with 0.0.0.0:0
```
Registry-Schlüssel `${connectionId}:${forwardId}`. Fehler-Mapping Spec 5.3 ohne `forwardNotFound`. Entfernt: ein `tcp connection`-Listener je `SessionForwards`, Zuordnung über `info.destPort`; unbekannter Port → `reject()`.

### 2.7 Task E – `src/renderer/src/connection-form.ts`

`ConnectionFields` + `jumpHost: string` (leer = keiner) + `forwards: ForwardDraft[]` (aus `forward-form.ts`).
```ts
export interface JumpHostOption { id: string; label: string }
/** SSH connections usable as jump host for selfId (not self, no own jumpHost); disabled ones labelled; a missing current id appended. */
export function jumpHostOptions(nodes: VaultNode[], selfId: string | undefined, current: string): JumpHostOption[];
/** Throws ConnectionFieldError('jumpHost', …) per spec 4.5 and K10; no-op for ''. */
export function validateJumpHost(jumpHost: string, selfId: string | undefined, nodes: VaultNode[]): void;
/** Number of connections whose jumpHost is id. */
export function jumpHostReferences(nodes: VaultNode[], id: string): number;
```
`fieldsFromConnection` / `connectionFromFields` übertragen `jumpHost` (SSH, SFTP) und `forwards` (SSH, über `forwardsFromDrafts`, Fehler als `ConnectionFieldError('forwards', message)`).

### 2.8 Task F – `src/renderer/src/forward-form.ts` und `ForwardsEditor.tsx`

```ts
export interface ForwardDraft { id: string; kind: ForwardKind; listenPort: string; targetHost: string; targetPort: string; auto: boolean }
export function newForwardDraft(): ForwardDraft;                       // kind 'local', auto false, crypto.randomUUID()
export function draftsFromForwards(forwards: PortForward[] | undefined): ForwardDraft[];
/** Throws Error(message) with the translated text (spec 5.5 keys, validation.portInteger/portRange). Duplicate local listen ports rejected. */
export function forwardsFromDrafts(drafts: ForwardDraft[]): PortForward[] | undefined; // [] → undefined
// ForwardsEditor.tsx
export function ForwardsEditor(props: { value: ForwardDraft[]; onChange: (value: ForwardDraft[]) => void; busy: boolean; idPrefix: string }): JSX.Element;
```
`listenPort` ist der lokale Port (lokal, dynamisch) bzw. der Server-Port (entfernt).

## 3. Wellen und Tasks

Dateien je Task exklusiv. S = Main-Sicherheit.

| Welle | Task | Dateien | Inhalt |
|---|---|---|---|
| 1 | **A** S | `src/shared/ssh.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/shared/vault/schema.ts`, `schema.test.ts`, `types.ts`, `src/shared/connection-test.ts`, `src/shared/locales/{de-DE,en-US}/errors/ssh.json` | 2.1, K2 |
| 2 | **B** S | `src/main/ssh/client-config.ts` + test, neu `auth-prompts.ts` + test, neu `jump.ts` + test, `src/main/containers/runner.ts` + `runner.test.ts` | 2.2, 2.3, 2.5, K3, K4 |
| 2 | **C** S | neu `src/main/ssh/forwards.ts` + test, neu `socks5.ts` + test, `src/main/kubernetes/tunnel.ts` + test | 2.6, K12, K13 |
| 2 | **D** | neu `components/AuthPromptDialog.tsx`, neu `auth-prompt.css`, `App.tsx`, `SecondaryWindow.tsx`, `locales/*/app.json` | Spec 3.5 |
| 2 | **E** | `components/ConnectionForm.tsx`, `connection-form.ts` + test, `locales/*/connection.json` | 2.7, Spec 4.4, 4.5, 5.5-Keys, K10 |
| 2 | **F** | neu `components/ForwardsEditor.tsx`, neu `forward-form.ts` + test | 2.8 |
| 2 | **G** | neu `components/ForwardBar.tsx`, neu `forward-ui.css`, `components/TerminalPanel.tsx`, `connect-timeline.ts` + test, `locales/*/terminal.json`, `docs/design-system.md` | Spec 4.3, 5.4 |
| 2 | **H** | `.claude/skills/run-app/sshd.mjs`, `fixtures.mjs`, `demo-setup.mjs`, `fakes.test.mjs` | Spec 9 |
| 3 | **I** S | `src/main/ssh/session.ts` + test, `src/main/ssh/ipc.ts` + test, `src/main/ssh/validation.ts` + test | Jump, Keyboard, Weiterleitungen, K7, K11, 2.4 |
| 3 | **J** S | `src/main/files/sftp-session.ts` + test, `src/main/files/ipc.ts` | Jump, Keyboard |
| 3 | **K** S | `src/main/containers/ipc.ts`, `src/main/kubernetes/ipc.ts` | `prompts` durchreichen, Jump für `openRemote` |
| 3 | **L** S | `src/main/connection-test.ts` + test | K9 |
| 3 | **M** S | `src/main/index.ts` | K5, K6, Signaturen |
| 3 | **N** | `docs/handbuch.md`, `docs/manual.md`, `CHANGELOG.md`, `CHANGELOG.en.md`, `README.md`, `package.json`, `package-lock.json`, `.claude/skills/run-app/screens.mjs`, `.claude/skills/run-app/SKILL.md` | 0.19.0 |

Register-Signaturen nach Welle 3: `registerSshIpcHandlers(knownHosts, prompts, sudoRejections?, openKubeTerminal?)`, `registerFileIpcHandlers(knownHosts, prompts)`, `registerContainerIpcHandlers(knownHosts, prompts, sudoRejections?)`, `registerKubernetesIpcHandlers(knownHosts, prompts, sudoRejections)`. `ConnectionTestDependencies` + `ask?: AskPrompts; openJump?: (node: SshConnectionNode | SftpConnectionNode) => Promise<Jump | undefined>`.
`SshDependencies` + `ask?: AskPrompts; openJump?: (connection, ownerId) => Promise<Jump | undefined>; forwardRegistry?: ForwardRegistry`. Gleiches Muster für `SftpDependencies` (ohne Registry).

Gates: Welle 1 Typecheck grün. Welle 2 Typecheck grün bis auf erwartete Aufrufer-Fehler aus K1 (keine, da `extras` optional) und Tests grün bis auf R-A. Welle 3: `npm run typecheck`, `npx vitest run` vollständig grün, dann run-app.
