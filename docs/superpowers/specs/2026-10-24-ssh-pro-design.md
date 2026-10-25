# SSH-Pro: Keyboard-Interactive/2FA, Sprunghost, Port-Weiterleitungen – Design

> Übernommen aus dem Konzept (Opus, `.superpowers/sdd/ssh-pro-research.md`). Bindend geht der Anhang `2026-10-24-ssh-pro-validation.md` vor.


Stand 0.18.1, Branch `claude/feature/ssh-pro`. Zielversion **0.19.0**. Vault bleibt Version 2.

## 0. Entscheidungen auf einen Blick

| Frage | Entscheidung |
|---|---|
| Keyboard-Interactive | `tryKeyboard: true` nur dort, wo ein Antwort-Handler hängt; ein Prompt-Broker in Main schickt die Server-Fragen an einen Renderer-Dialog und wartet auf die Antwort |
| Gespeichertes Passwort | wird **einmal** automatisch eingesetzt, wenn die Runde genau eine verdeckte Frage enthält, die nach Passwort klingt (`/pass(word|wort)|kennwort/i`) und die Verbindung `method: 'password'` hat. Alles andere (TOTP, PIN, zweite Passwortfrage) fragt den Nutzer |
| Wie oft nachfragen | so oft der Server eine Runde schickt, höchstens **6 Runden** je Verbindung; danach `ssh.promptInvalid`. Kein eigener Neuversuch nach einem Fehlschlag |
| Timeout während der Rückfrage | läuft weiter (wie bei der Server-Schlüssel-Rückfrage, Changelog 0.14.0); nur der Verbindungstest pausiert seinen Timer |
| Sperre | Broker lehnt neue Rückfragen gesperrt ab und bricht offene beim Sperren ab; der Dialog öffnet nie über dem Sperrbildschirm |
| Sprunghost | optionales Feld `jumpHost: <id einer SSH-Verbindung>` an SSH- und SFTP-Verbindungen. **Genau ein Hop**, keine Ketten in Stufe 1 |
| Zyklen | entfallen durch die Ein-Hop-Regel: der Sprunghost darf selbst keinen `jumpHost` haben und nicht die Verbindung selbst sein |
| Löschen eines Sprunghosts | Referenz bleibt stehen (Vorbild `accessHosts`), Verbindung scheitert mit klarer Meldung; Löschdialog nennt die Zahl betroffener Verbindungen. **Kein** neuer `VaultConsistencyIssueCode` |
| Port-Weiterleitungen | Liste `forwards` an SSH-Verbindungen, Arten lokal/entfernt/dynamisch (alle drei in Stufe 1, damit das Schema später nicht bricht), gebunden an **eine** Terminal-Sitzung |
| Mehrere Tabs | eine Weiterleitung läuft app-weit höchstens einmal; die erste verbundene Sitzung startet die automatischen, andere Tabs zeigen „läuft in anderem Tab“ |
| Anzeige | schmale Leiste „Weiterleitungen“ unten im SSH-Terminal-Tab (im Fluss, wie die Getrennt-Leiste) |
| Bindung | lokal und SOCKS nur `127.0.0.1`, kein Feld dafür; entfernt auf dem Server an `localhost`, Hinweis auf `GatewayPorts` |
| Pod-/Service-Port-Forward | technisch über den bestehenden Tunnel machbar, aber **Extra** (eigene Spec) |

## 1. Bestand und Lücken

### 1.1 Anmeldung

| Bestand | Fundstelle |
|---|---|
| Gemeinsame Connect-Konfiguration für Terminal, SFTP, Container/Cluster, Test | `src/main/ssh/client-config.ts:29-46` |
| `tryKeyboard: false`, `agentForward: false` | `client-config.ts:34` |
| ssh2 1.17: Reihenfolge `none`, `password`, `publickey`, `agent`, `keyboard-interactive` (nur mit `tryKeyboard`), Teil-Erfolg wird durchgereicht | `node_modules/ssh2/lib/client.js:836-854`, `:372-428` |
| ssh2 ruft für jede Info-Anfrage `client.emit('keyboard-interactive', name, instructions, lang, prompts, finish)`; null Prompts beantwortet ssh2 selbst | `client.js:477-498`, `:903-908` |
| `readyTimeout` läuft von `connect()` bis `ready`, auch während Rückfragen | `client.js:1111-1119`; Kommentar `src/main/containers/runner.ts:41` |
| Host-Key-Rückfrage als Vorbild: nativer Dialog im fokussierten Fenster, serialisiert in `KnownHosts.verify`, `isActive()` verwirft späte Antworten | `src/main/ssh/ipc.ts:24-38`, `src/main/ssh/known-hosts.ts:37-70` |
| Vier Aufrufer von `sshConnectConfig` | Terminal `src/main/ssh/session.ts:253`, SFTP `src/main/files/sftp-session.ts:95`, Container/Cluster `src/main/containers/runner.ts:36` (über `containers/ipc.ts:23`, `kubernetes/ipc.ts:38`), Test `src/main/connection-test.ts:123` |
| Verbindungsschritte-Karte: `reach`, `hostkey`, `auth` („Anmelden“), `shell` | `src/shared/ssh.ts:18`, `src/renderer/src/components/TerminalPanel.tsx:45`, `src/renderer/src/connect-timeline.ts:9-11`, `terminal.json:115-121` |
| Test-Schritte | `src/shared/connection-test.ts:3-4`, Fehlerzuordnung `connection-test.ts:102-106` |
| Fehlerklassen | `publicError`/`classifyError` `session.ts:130-166`; `level === 'client-authentication'` → `ssh.authFailed` |
| Handbuch verspricht MFA „in einem weiteren Schritt“ | `docs/handbuch.md:173-174`, `docs/manual.md:172-173` |

**Lücke:** Server mit `AuthenticationMethods keyboard-interactive` oder `publickey,keyboard-interactive` (PAM, TOTP, Duo) scheitern mit `ssh.authFailed`. Electron hat keinen nativen Eingabedialog, das Host-Key-Muster (`dialog.showMessageBox`) reicht hier nicht: es braucht einen Renderer-Dialog und einen Rückkanal.

### 1.2 Sprunghost

| Bestand | Fundstelle |
|---|---|
| Schema SSH/SFTP ohne Sprunghost | `src/shared/vault/schema.ts:81-102`, Typen `src/shared/vault/types.ts:62-90` |
| Verbindung zu einem Ziel über einen SSH-Host: `RemoteHost.forward()` = `client.forwardOut` | `src/main/containers/runner.ts:31-62` |
| Cluster-Zugang über `accessHosts` (Ids von SSH-Verbindungen, deaktivierte werden übersprungen) | `schema.ts:132`, `src/main/kubernetes/access.ts:88-118` |
| Fehlende Zugangsverbindung: keine Bereinigung beim Löschen, Formular zeigt „(nicht mehr vorhanden)“, Validierung `accessGone` | `src/renderer/src/cluster-form.ts:56-66`, `connection.json` `cluster.access.missing`, `cluster.validation.accessGone` |
| Löschen entfernt nur Workspace-Referenzen | `src/shared/vault/mutations.ts:279-315` |
| Konsistenzprüfung läuft beim Entschlüsseln **und** Speichern und wirft | `src/main/vault/crypto.ts:104`, `:255`, `:306-318`; Codes `src/shared/vault/consistency.ts:7-10` |
| ssh2 nimmt einen beliebigen Duplex als `sock`, startet `readyTimeout` erst dann und meldet `connect` sofort | `client.js:290`, `:1159-1170` |
| Test löst den Namen lokal auf | `connection-test.ts:70-74` |

**Lücke:** kein Bastion-Weg. Ein neuer Konsistenz-Code wäre gefährlich: eine verwaiste Referenz würde den Vault beim Öffnen unbrauchbar machen (`crypto.ts:104`). Deshalb gilt das `accessHosts`-Muster.

### 1.3 Port-Weiterleitungen

| Bestand | Fundstelle |
|---|---|
| Lokaler Listener auf `127.0.0.1:0`, jede Verbindung über `forward()` | `src/main/kubernetes/tunnel.ts:7-33` |
| Nutzung für den API-Server | `src/main/kubernetes/ipc.ts:47` |
| Terminal-Sitzung hält `client`, Leerlauf nur über Terminal-I/O | `session.ts:64-101`, `:480-500`, `finish` `:621-635` |
| SFTP hält beschäftigte Sitzungen wach (Vorbild für „Weiterleitung mit offener Verbindung“) | `sftp-session.ts` `checkIdle` |
| Ereigniskanal je Sitzung `ssh:event` | `src/shared/ssh.ts:19-26`, `src/main/ssh/ipc.ts:30-33` |
| Tab-Kontextmenü hat nur „Umbenennen“ | `src/renderer/src/components/SplitTerminalArea.tsx:482-487` |
| Getrennt-Leiste als Muster für eine Leiste im Fluss | `src/renderer/src/components/DisconnectedBar.tsx` |
| Pod-Exec läuft schon per WebSocket über den Tunnel | `src/main/kubernetes/client-api.ts:6`, `:274` |
| Port-Forward im Cluster als Stufe 3 genannt | `docs/superpowers/specs/2026-10-16-kubernetes-integration-design.md:36`, `…-kubernetes-context-menus-design.md:126,279` |

**Lücke:** Nutzer können keine eigenen Tunnel bauen; der Demo-sshd lehnt `tcpip-forward` ab (`.claude/skills/run-app/sshd.mjs:192`).

## 2. Empfehlung je Fläche

| Fläche | Empfehlung | Wert | Aufwand |
|---|---|---|---|
| Prompt-Broker in Main (`auth-prompts.ts`) | eine Warteschlange, ein Dialog zur Zeit, Ziel-Fenster, Abbruch bei Sperre/Fensterende/Sitzungsende | ★★★ | kleine Main-Änderung |
| `sshConnectConfig` verdrahtet Keyboard-Interactive und `sock` | ein Ort für alle vier Aufrufer | ★★★ | kleine Main-Änderung |
| Renderer-Dialog „Anmeldung bei …“ | modaler `<dialog>`, Felder je Prompt, verdeckt bei `echo: false` | ★★★ | nur Renderer |
| Sprunghost-Hop (`jump.ts`) | `openRemoteHost(jump)` + `forward(host, port)` → `sock` | ★★★ | kleine Main-Änderung |
| Sprunghost in Terminal, SFTP, Container, Cluster | je Aufrufer vier bis acht Zeilen | ★★★ | kleine Main-Änderung |
| Sprunghost im Verbindungstest | Schritt `jumpHost`, lokale Namensauflösung entfällt | ★★★ | kleine Main-Änderung |
| Auswahl „Sprunghost“ unter „Weitere Angaben“ | `<select>` mit SSH-Verbindungen | ★★★ | nur Renderer |
| Löschhinweis für Sprunghosts | ein Satz im Löschdialog | ★★ | nur Renderer |
| Schritt „Sprunghost verbinden“ in der Verbindungskarte | erscheint nur, wenn Main ihn meldet | ★★ | nur Renderer + ein `SshStep` |
| Weiterleitungen L/R/D an der Terminal-Sitzung | `forwards.ts` mit Registry, SOCKS5-CONNECT ohne Auth | ★★★ (L), ★★ (D), ★ (R) | kleine Main-Änderung |
| Leiste „Weiterleitungen“ im SSH-Tab | Zustand, Fehler, Starten/Stoppen | ★★★ | nur Renderer |
| Editor „Port-Weiterleitungen“ im Formular | Liste wie Startbefehle/Auto-Upload | ★★★ | nur Renderer |
| Weiterleitung hält Sitzung gegen Leerlauf wach | offene Kanäle zählen als Aktivität | ★★ | eine Bedingung in `session.ts` |
| Pod-/Service-Port-Forward in Kubernetes | `PortForward` über den Tunnel, Kontextmenü an Pods/Services | ★★ | **nicht jetzt** (Extra) |
| Ketten (Sprunghost mit Sprunghost) | rekursiv, Tiefenlimit 3 | ★ | **nicht jetzt** |
| Eine Sprunghost-Verbindung für mehrere Tabs teilen (2FA nur einmal) | Referenzzählung | ★★ | **nicht jetzt** |
| Bind-Adresse ≠ Loopback | Feld `bindHost` | ★ | **nicht jetzt** (Sicherheitsrisiko) |
| Agent-Forwarding | – | – | **Nicht-Ziel**, bleibt `agentForward: false` |

## 3. Funktion 1: Keyboard-Interactive und 2FA

### 3.1 Vertrag (shared)

`src/shared/ssh.ts`:

```ts
export interface AuthPromptField { text: string; echo: boolean }
/** Server questions of one keyboard-interactive round; texts are server-controlled and already cleaned in Main. */
export interface AuthPromptRequest {
  promptId: string;            // randomUUID
  connectionName: string;      // name of the connection being logged into (the jump host for its own hop)
  host: string;                // host:port as configured
  title: string;               // server "name", may be ''
  instructions: string;        // may be ''
  fields: AuthPromptField[];   // 1..8
}
export interface AuthPromptAnswer { promptId: string; answers: string[] | null } // null = Abbrechen
```

Kanäle (`src/shared/ipc.ts`, Preload): `ssh:auth-prompt` (Main → Renderer, `AuthPromptRequest`), `ssh:auth-prompt-closed` (Main → Renderer, `{ promptId }`), `ssh:auth-prompt-answer` (invoke, `AuthPromptAnswer`). Preload: `onAuthPrompt`, `onAuthPromptClosed`, `answerAuthPrompt`.

### 3.2 Main: Broker `src/main/ssh/auth-prompts.ts` (neu, Sicherheit)

```ts
export type AskPrompts = (request: Omit<AuthPromptRequest, 'promptId'>, options: { ownerId?: number; isActive: () => boolean }) => Promise<string[] | null>;
export class AuthPrompts {
  constructor(deps: { send(ownerId: number | undefined, channel, payload): number | undefined /* returns webContents id or undefined */; isUnlocked(): boolean });
  ask: AskPrompts;
  answer(senderId: number, answer: AuthPromptAnswer): void; // ignores unknown ids and foreign senders
  cancelAll(): void;          // lock, quit
  cancelOwner(ownerId: number): void; // window gone
}
```

Regeln:
- **Eine Rückfrage zur Zeit** (Warteschlange wie `KnownHosts.queue`). Vor dem Senden und nach der Antwort `isActive()` prüfen; eine inaktive Anfrage löst `null` aus und schickt `ssh:auth-prompt-closed`.
- **Ziel:** `ownerId` (Terminal, SFTP), sonst das fokussierte registrierte Fenster, sonst das Hauptfenster (Host-Key-Vorbild).
- **Antwort annehmen** nur vom webContents, an das die Frage ging (`requireSshSender` plus Id-Vergleich), nur für die aktuelle `promptId`, `answers.length === fields.length`, jede Antwort String ≤ 1024 Zeichen. Alles andere wird verworfen, nicht beantwortet.
- **Gesperrt:** `isUnlocked() === false` → sofort `null`; `cancelAll()` beim Sperren (Hook in `index.ts` neben `announce(vaultLocked)`).
- **Reinigung der Server-Texte:** C0/C1-Steuerzeichen außer `\n` in `instructions` entfernen, `text` ≤ 256, `title` ≤ 128, `instructions` ≤ 1024 Zeichen; mehr als 8 Felder → `ssh.promptInvalid`.
- Antworten werden nie gespeichert, nie geloggt, nie in Fehler-`detail` übernommen; nach dem Weiterreichen an ssh2 hält Main keine Referenz.

### 3.3 Main: Verdrahtung in `client-config.ts` (Sicherheit)

```ts
export interface ConnectExtras {
  /** Keyboard-interactive: only with a handler, else ssh2 would wait for an answer until readyTimeout. */
  keyboard?: { client: Client; ask: AskPrompts; ownerId?: number; isActive: () => boolean };
  /** Stream from a jump host (jump.ts). */
  sock?: Duplex;
}
export async function sshConnectConfig(connection, hostVerifier, timeouts = DEFAULT_TIMEOUTS, extras: ConnectExtras = {}): Promise<{ config; key? }>
```

- `tryKeyboard: Boolean(extras.keyboard)`; Listener `client.on('keyboard-interactive', …)`.
- Pro Verbindung Zähler `rounds` (≤ 6) und Flag `passwordUsed`.
- Auto-Antwort: `auth.method === 'password' && !passwordUsed && fields.length === 1 && !fields[0].echo && /pass(word|wort)|kennwort/i.test(fields[0].text)` → `finish([password])`, `passwordUsed = true`. Begründung: dieselbe Gegenstelle (Host-Key geprüft) bekäme das Passwort ohnehin per Passwort-Methode; ein zweiter Passwort-Prompt bedeutet „falsch“ und geht an den Nutzer.
- `null` vom Broker → `client.destroy()` und Fehler `AppError('ssh.promptCancelled')` an den Aufrufer (über das normale `error`-Ereignis: ein eigenes `client.emit('error', …)` mit dieser AppError).
- Mehr als 6 Runden → `AppError('ssh.promptInvalid')`.

### 3.4 Aufrufer

| Aufrufer | `ownerId` | `isActive` | Besonderheit |
|---|---|---|---|
| Terminal `session.ts:253` | `session.ownerId` | `this.active(session)` | Schritt `auth` ist schon aktiv; nichts Neues in der Karte |
| SFTP `sftp-session.ts:95` | `session.ownerId` | `this.active(session)` | – |
| Container/Cluster `runner.ts:36` | keiner | `() => !closed` | neuer optionaler Parameter `extras` am Ende von `openRemoteHost` |
| Test `connection-test.ts:123` | keiner | `() => !finished` | `ask` pausiert den Test-Timer wie `verifyHost` (`:124-125`) |

Timeout: Die eingestellte Verbindungszeit (Vorgabe 120 s) umfasst Server-Schlüssel und Rückfrage. Bei einer Warteschlange (Workspace mit mehreren MFA-Hosts) kann eine hintere Sitzung ablaufen; sie zeigt die Timeout-Karte mit „Neu verbinden“. Dokumentieren, nicht lösen.

### 3.5 Renderer: `AuthPromptDialog.tsx` (neu)

- Gemountet in `App.tsx` und `SecondaryWindow.tsx`, abonniert `onAuthPrompt`/`onAuthPromptClosed`/`onVaultLocked`.
- Modaler `<dialog>` (`showModal`), vorhandene Dialog-Klassen; eigene Regeln nur in neuer `auth-prompt.css` mit Tokens. **Keine Animation** (kein Motion-Gate-Eintrag nötig).
- Öffnet nie, solange der Sperrbildschirm aktiv ist (Prop `locked`), schließt bei `vault:locked` mit `answers: null`. Sonst läge ein später geöffneter Modal-Dialog im Top-Layer über dem Sperrbildschirm (Lock-Screen-Spec 1.5, R3).
- Je Feld ein `<input>`: `type="password"` bei `echo: false`, sonst `text`; `autoComplete="off"`, `spellCheck={false}`; Label = Server-Text (React escaped, nie HTML). Erstes Feld fokussiert. Anzeigen/Verbergen mit den vorhandenen `connection:form.secret.*`.
- Enter = Anmelden, Escape/`cancel` = Abbrechen (`answers: null`). Nach dem Senden Felder leeren (State zurücksetzen).

Texte (`app.json`, de-DE / en-US):

| Key | de-DE | en-US |
|---|---|---|
| `app:authPrompt.title` | Anmeldung bei {{name}} | Sign in to {{name}} |
| `app:authPrompt.server` | {{host}} fragt nach weiteren Angaben. | {{host}} asks for more information. |
| `app:authPrompt.field` | Antwort {{index}} | Answer {{index}} |
| `app:authPrompt.hint` | Die Antworten gehen nur an diesen Server und werden nicht gespeichert. | Your answers go only to this server and are not stored. |
| `app:authPrompt.submit` | Anmelden | Sign in |
| `app:authPrompt.ariaLabel` | Anmeldeabfrage des Servers | Server sign-in prompt |

Abbrechen über `common:actions.cancel`.

### 3.6 Fehlercodes (`errors/ssh.json`)

| Code | de-DE | Karte |
|---|---|---|
| `ssh.promptCancelled` | Anmeldung abgebrochen. | `unknown` (Text des Fehlers, „Neu verbinden“) |
| `ssh.promptInvalid` | Der Server hat zu viele oder ungültige Anmeldeabfragen geschickt. | `unknown` |

Ein vom Server abgelehnter Code endet wie heute als `ssh.authFailed` (Karte `auth`).

## 4. Funktion 2: Sprunghost

### 4.1 Datenmodell

`schema.ts` an `SshConnectionNodeSchema` **und** `SftpConnectionNodeSchema`: `jumpHost: z.string().min(1).max(256).optional()`. `types.ts`: `jumpHost?: string`. Ältere Versionen verwerfen das Feld beim Speichern (Zod strippt unbekannte Schlüssel), wie bei 0.14 und 0.16; Changelog sagt es.

Gültig ist ein Sprunghost, wenn die referenzierte Verbindung existiert, `protocol === 'ssh'`, nicht `disabled`, **kein eigenes `jumpHost`** hat und nicht die Verbindung selbst ist. Kein `VaultConsistencyIssueCode` (würde das Öffnen blockieren, `crypto.ts:104`).

### 4.2 Main: `src/main/ssh/jump.ts` (neu, Sicherheit)

```ts
export interface Jump { sock: Duplex; close(): void }
export interface JumpDependencies {
  getConnection(id: string): ConnectionNode | undefined;
  /** openRemoteHost with the jump connection's own timeouts, host-key check and keyboard prompts. */
  openRemote(connection: SshConnectionNode): Promise<RemoteHost>;
}
/** undefined without jumpHost; one hop only. */
export async function openJump(connection: SshConnectionNode | SftpConnectionNode, deps: JumpDependencies): Promise<Jump | undefined>
```

- Prüft 4.1, sonst `ssh.jumpHostMissing { id }` bzw. `ssh.jumpHostUnusable { name }`.
- Fehler beim Öffnen des Sprunghosts → `AppError('ssh.jumpHostFailed', { name }, undefined, [{ label: name, error: publicError(error) }])` (Muster `access.ts:116`).
- `host.forward(connection.host, connection.port)`; Fehler → `ssh.jumpTargetUnreachable { host, port }`, `host.close()`.
- `close()` schließt Kanal und Sprunghost-Client.
- `openRemote` wird injiziert, damit `jump.ts` und `runner.ts` sich nicht gegenseitig importieren.

Aufrufer setzen `extras.sock = jump.sock` und schließen den Hop in **jedem** Ende-Pfad (`client.on('close')`, Fehler vor `connect`, `finish`).

| Regel | Festlegung |
|---|---|
| Host-Key | beide Hosts über dieselbe `KnownHosts`-Instanz, jeder unter seinem eigenen `host:port` aus dem Vault |
| Timeouts | je Hop die eigenen `effectiveTimeouts`; der Ziel-`readyTimeout` startet erst mit dem `sock` |
| Anmeldung | der Sprunghost nutzt seine eigenen Zugangsdaten und Keyboard-Interactive; der Dialog nennt seinen Namen |
| Namensauflösung | das Ziel wird **vom Sprunghost** aufgelöst (`forwardOut` mit Hostname) |
| Lebensdauer | ein Hop je Sitzung; Ende der Zielsitzung schließt den Hop, Ende des Hops schließt das Ziel (Kanal zu) |
| Sperre | `getConnection` liest den Vault und wirft gesperrt → kein neuer Hop während der Sperre |
| SFTP | gleiche Regel; SFTP-Verbindungen dürfen einen Sprunghost **haben**, aber keiner sein |
| Container/Cluster | `containers/ipc.ts:23` und `kubernetes/ipc.ts:37-39`: `openRemote = async c => openRemoteHost(c, …, { keyboard, sock: (jump = await openJump(c, …))?.sock })`, Hop-Schließen an `RemoteHost.close` und `client.on('close')` gebunden |

### 4.3 Verbindungsschritte

- `SshStep` bekommt `'jump'`. Terminal meldet `step: 'jump'` vor dem Hop, danach wie bisher `hostkey`/`auth`/`reach`.
- `TerminalPanel.tsx:269`: `steps = marks.some(mark => mark.step === 'jump') ? ['jump', ...SSH2_STEPS] : SSH2_STEPS`.
- `terminal:timeline.steps.jump` = „Sprunghost verbinden“ / „Connect jump host“.

### 4.4 Verbindungstest

- `ConnectionTestStepId` + `'jumpHost'`. Mit `jumpHost`: Schritt `nameResolved` entfällt (das Ziel löst der Sprunghost auf), stattdessen `jumpHost` mit `params: { name }`; Fehler → `note` = Fehler aus `openJump`. Danach `portReachable` (= `forwardOut` erfolgreich), `hostKey`, `login`, ggf. `sftp`.
- Der Test-Timer pausiert auch während Host-Key- und Keyboard-Rückfragen des Sprunghosts.
- `connection:test.steps.jumpHost` = „Sprunghost {{name}} verbunden“ / „Jump host {{name}} connected“.
- Der Renderer schickt nur die Id; die Zugangsdaten des Sprunghosts liest Main aus dem Vault.

### 4.5 Formular (unter „Weitere Angaben“, nur SSH und SFTP)

`<select>` „Sprunghost“, Optionen: „Keiner (direkt verbinden)“ und alle SSH-Verbindungen ohne eigenen Sprunghost außer der aktuellen, deaktivierte mit Zusatz; fehlende Id als „{{id}} (nicht mehr vorhanden)“. Feld `jumpHost: string` in `ConnectionFields` (leer = keiner).

| Key (`connection.json`) | de-DE | en-US |
|---|---|---|
| `form.jump.label` | Sprunghost | Jump host |
| `form.jump.none` | Keiner (direkt verbinden) | None (connect directly) |
| `form.jump.hint` | Verbindet zuerst mit dieser SSH-Verbindung und von dort weiter. Host und Port oben gelten vom Sprunghost aus. | Connects to this SSH connection first and continues from there. Host and port above are seen from the jump host. |
| `form.jump.missing` | {{id}} (nicht mehr vorhanden) | {{id}} (no longer exists) |
| `form.jump.disabled` | {{name}} (deaktiviert) | {{name}} (disabled) |
| `validation.jumpSelf` | Eine Verbindung kann nicht ihr eigener Sprunghost sein. | A connection cannot be its own jump host. |
| `validation.jumpGone` | Den Sprunghost „{{id}}“ gibt es nicht mehr. Wähle einen anderen. | The jump host "{{id}}" no longer exists. Choose another one. |
| `validation.jumpChained` | „{{name}}“ hat selbst einen Sprunghost. Das geht noch nicht. | "{{name}}" has a jump host of its own. This is not supported yet. |
| `validation.jumpDisabled` | Der Sprunghost „{{name}}“ ist deaktiviert. | The jump host "{{name}}" is disabled. |
| `form.deleteJumpHint_one` | Sie ist Sprunghost für {{count}} Verbindung. Diese verbindet erst wieder, wenn du dort einen anderen Sprunghost wählst. | It is the jump host of {{count}} connection, which will not connect until you choose another jump host there. |
| `form.deleteJumpHint_other` | Sie ist Sprunghost für {{count}} Verbindungen. Diese verbinden erst wieder, wenn du dort einen anderen Sprunghost wählst. | It is the jump host of {{count}} connections, which will not connect until you choose another jump host there. |

`count` muss in `COUNT_KEYS` stehen (tut es, Pluralmuster wie `home.autoLocked_*`). Ports nie über `formatNumber`.

Der Löschhinweis hängt an `deleteDescription` an (`ConnectionForm.tsx:252-253`), nur wenn die Zahl > 0.

### 4.6 Fehlercodes (`errors/ssh.json`)

| Code | de-DE |
|---|---|
| `ssh.jumpHostMissing` | Den Sprunghost „{{id}}“ gibt es nicht mehr. |
| `ssh.jumpHostUnusable` | „{{name}}“ kann nicht als Sprunghost dienen. Es muss eine aktive SSH-Verbindung ohne eigenen Sprunghost sein. |
| `ssh.jumpHostFailed` | Sprunghost „{{name}}“ nicht erreichbar. (Ursache als `causes`) |
| `ssh.jumpTargetUnreachable` | Der Sprunghost erreicht {{host}}:{{port}} nicht. |

Karten: alle `unknown` (Text + „Neu verbinden“ + „Bearbeiten“). Ein geänderter Schlüssel des Sprunghosts erscheint als Ursache ohne Fingerabdrücke; „Verbindung testen“ am Sprunghost zeigt sie.

## 5. Funktion 3: Port-Weiterleitungen

### 5.1 Datenmodell (nur SSH-Verbindungen)

```ts
const portSchema = z.number().int().min(1).max(65_535);
const forwardHost = z.string().min(1).max(253).refine(host => !/[\s\x00-\x1f\x7f]/.test(host));
export const PortForwardSchema = z.discriminatedUnion('kind', [
  z.object({ id: z.string().uuid(), kind: z.literal('local'),   localPort: portSchema, targetHost: forwardHost, targetPort: portSchema, auto: z.boolean() }),
  z.object({ id: z.string().uuid(), kind: z.literal('remote'),  remotePort: portSchema, targetHost: forwardHost, targetPort: portSchema, auto: z.boolean() }),
  z.object({ id: z.string().uuid(), kind: z.literal('dynamic'), localPort: portSchema, auto: z.boolean() }),
]); // not .strict(), like AutoUploadBindingSchema
forwards: z.array(PortForwardSchema).max(16).refine(list => new Set(list.map(f => f.id)).size === list.length).optional()
```

- Kein `bindHost`: lokal und SOCKS binden fest an `127.0.0.1`, entfernt fest an `localhost` auf dem Server. Ein späteres optionales Feld fiele in älteren Versionen weg und damit auf Loopback zurück, also in die sichere Richtung.
- Alle drei Arten jetzt im Schema: eine neue `kind` später würde ein älteres Shellherd am Öffnen hindern (Discriminated Union). **Regel:** weitere Arten nur mit einem neuen Feld.
- Doppelte lokale Ports innerhalb einer Verbindung lehnt das Formular ab (nicht das Schema).

### 5.2 Lebensdauer

- Weiterleitungen hängen an einer **SSH-Terminal-Sitzung** (nicht an Container-, Pod-, SFTP- oder Cluster-Sitzungen).
- Registry in Main: Schlüssel `connectionId:forwardId` → `sessionId`. Eine Weiterleitung läuft app-weit höchstens einmal.
- Nach `connected` startet Main die `auto`-Weiterleitungen, deren Schlüssel frei ist; der Rest ist `stopped` bzw. `elsewhere`.
- Klick „Starten“/„Stoppen“ in der Leiste. Main liest die Definition **aus dem Vault** (Renderer schickt nur `forwardId`).
- Sitzungsende (`finish`, `session.ts:621`) stoppt alle ihre Weiterleitungen: Listener zu, offene Sockets und Kanäle zerstört, Registry frei. Kein Umzug in andere Tabs; dort zeigt „Hier starten“ den Weg.
- Fenstertransfer: die Sitzung zieht mit, die Weiterleitungen auch (Ereignisse gehen an den neuen Besitzer).
- Sperre: laufende Weiterleitungen laufen weiter wie Sitzungen (Lock-Screen R1); Starten ist per `inert` unerreichbar.
- Leerlauf: eine Weiterleitung mit offener Verbindung zählt als Aktivität (Vorbild SFTP `checkIdle`).

### 5.3 Main: `src/main/ssh/forwards.ts` (neu, Sicherheit)

```ts
export type ForwardState = 'stopped' | 'starting' | 'active' | 'error' | 'elsewhere';
export interface ForwardStatus {          // shared/ssh.ts
  id: string; kind: 'local' | 'remote' | 'dynamic';
  localPort?: number; remotePort?: number; targetHost?: string; targetPort?: number;
  state: ForwardState; error?: CodedError; open: number; // open channels
}
export class SessionForwards {
  constructor(client: Client, connection: SshConnectionNode, registry: ForwardRegistry, emit: (list: ForwardStatus[]) => void);
  startAuto(): void; start(id: string): Promise<void>; stop(id: string): void; stopAll(): void; busy(): boolean;
}
```

- **Lokal:** `openTunnel` aus `kubernetes/tunnel.ts` mit neuem dritten Parameter `port = 0` (Kube-Aufruf unverändert). `forward = (h, p) => new Promise((res, rej) => client.forwardOut('127.0.0.1', 0, h, p, …))`.
- **Dynamisch:** eigener SOCKS5-Server auf `127.0.0.1:localPort`. Nur Version 5, nur Methode `0x00` (keine Auth), nur `CONNECT`, ATYP IPv4/Domain/IPv6. Handshake ≤ 10 s und ≤ 512 Byte, sonst Socket zu. Antwort `0x05` (Verbindung abgelehnt) bei `forwardOut`-Fehler, `0x07` bei anderen Kommandos. Kein `BIND`, kein `UDP ASSOCIATE`. Kleine, getestete Funktion; keine neue Abhängigkeit.
- **Entfernt:** `client.forwardIn('localhost', remotePort)`; ein Listener `client.on('tcp connection', (info, accept, reject) => …)` ordnet über `info.destPort` zu und verbindet lokal `net.connect(targetPort, targetHost)`; sonst `reject()`. Beim Stoppen `client.unforwardIn`.
- Fehler: `EADDRINUSE` → `ssh.forwardPortInUse { port }`, `EACCES` → `ssh.forwardPortDenied { port }`, `forwardIn`-Ablehnung → `ssh.forwardRemoteRefused { port }`, belegt in anderer Sitzung → `ssh.forwardElsewhere`, Id fehlt im Vault → `ssh.forwardNotFound`, sonst `ssh.forwardFailed`.
- Ereignis an den Besitzer: `{ type: 'forwards'; sessionId; forwards: ForwardStatus[] }` über `ssh:event`, immer die ganze Liste (≤ 16).
- IPC: `ssh:forward` invoke `{ sessionId, forwardId, run: boolean }` (Zod in `ssh/validation.ts`, `forwardId` uuid). Besitzprüfung über `owned()`; nur `connected`-Sitzungen ohne `target`/`kube`.

### 5.4 Renderer: Leiste „Weiterleitungen“ (`ForwardBar.tsx`, neu)

- Unter der Terminal-Ausgabe in `TerminalPanel.tsx`, im Fluss wie die Getrennt-Leiste; nur bei `status === 'connected'` und nicht leerer Liste aus dem letzten `forwards`-Ereignis.
- Je Eintrag: Beschreibung, Zustand, Knopf. Fehler in `--color-danger`-Text, Zustand nie nur über Farbe.
- Keine Animation, kein Motion-Gate-Eintrag. Neue CSS-Datei `forward-ui.css`, nur Tokens.

| Key (`terminal.json`) | de-DE | en-US |
|---|---|---|
| `forwards.label` | Weiterleitungen | Port forwards |
| `forwards.local` | localhost:{{port}} → {{target}} | localhost:{{port}} → {{target}} |
| `forwards.remote` | Server:{{port}} → {{target}} | Server:{{port}} → {{target}} |
| `forwards.dynamic` | SOCKS-Proxy localhost:{{port}} | SOCKS proxy localhost:{{port}} |
| `forwards.state.active` | aktiv | active |
| `forwards.state.stopped` | aus | off |
| `forwards.state.starting` | startet … | starting … |
| `forwards.state.elsewhere` | läuft in anderem Tab | running in another tab |
| `forwards.start` | Starten | Start |
| `forwards.startHere` | Hier starten | Start here |
| `forwards.stop` | Stoppen | Stop |
| `forwards.open_one` / `_other` | {{count}} Verbindung offen / {{count}} Verbindungen offen | {{count}} connection open / {{count}} connections open |
| `timeline.steps.jump` | Sprunghost verbinden | Connect jump host |

Fehlerzustand zeigt `errorText(error)`.

### 5.5 Renderer: Editor „Port-Weiterleitungen“ (`ForwardsEditor.tsx`, neu)

- In „Weitere Angaben“ von SSH-Verbindungen, eigene `<fieldset>`. Liste mit Art, Ports, Ziel, Checkbox „Beim Verbinden starten“, „Entfernen“; Knopf „Weiterleitung hinzufügen“ (Vorgabe: lokal, `auto: false`).
- Reine Logik in `forward-form.ts` (Strings ↔ `PortForward`, Validierung, neue `randomUUID` über `crypto.randomUUID()` im Renderer).

| Key (`connection.json`) | de-DE | en-US |
|---|---|---|
| `form.forwards.legend` | Port-Weiterleitungen | Port forwards |
| `form.forwards.kind` | Art | Type |
| `form.forwards.kinds.local` | Lokal (-L) | Local (-L) |
| `form.forwards.kinds.remote` | Entfernt (-R) | Remote (-R) |
| `form.forwards.kinds.dynamic` | Dynamisch, SOCKS (-D) | Dynamic, SOCKS (-D) |
| `form.forwards.localPort` | Lokaler Port | Local port |
| `form.forwards.remotePort` | Port auf dem Server | Port on the server |
| `form.forwards.targetHost` | Ziel-Host | Target host |
| `form.forwards.targetPort` | Ziel-Port | Target port |
| `form.forwards.auto` | Beim Verbinden starten | Start on connect |
| `form.forwards.add` | Weiterleitung hinzufügen | Add port forward |
| `form.forwards.remove` | Weiterleitung {{index}} entfernen | Remove port forward {{index}} |
| `form.forwards.hintLocal` | Lauscht nur auf 127.0.0.1 dieses Computers. Das Ziel gilt vom Server aus. | Listens on 127.0.0.1 of this computer only. The target is seen from the server. |
| `form.forwards.hintRemote` | Lauscht auf dem Server an localhost. Andere Rechner erreichen den Port nur mit GatewayPorts in der sshd_config. Das Ziel gilt von diesem Computer aus. | Listens on localhost on the server. Other machines reach the port only with GatewayPorts in sshd_config. The target is seen from this computer. |
| `form.forwards.hintDynamic` | SOCKS5-Proxy ohne Anmeldung auf 127.0.0.1. Im Browser oder Programm als SOCKS-Proxy eintragen. | SOCKS5 proxy without authentication on 127.0.0.1. Enter it as SOCKS proxy in your browser or program. |
| `form.forwards.hintTabs` | Eine Weiterleitung läuft immer nur in einem Tab dieser Verbindung. | A port forward runs in one tab of this connection at a time. |
| `validation.forwardTargetMissing` | Gib einen Ziel-Host ein. | Enter a target host. |
| `validation.forwardPortTwice` | Port {{port}} ist schon für eine andere Weiterleitung eingetragen. | Port {{port}} is already used by another port forward. |
| `validation.forwardTooMany` | Höchstens {{max}} Weiterleitungen. | At most {{max}} port forwards. |

Portbereich über die vorhandenen `validation.portInteger`/`portRange`.

### 5.6 Fehlercodes (`errors/ssh.json`)

| Code | de-DE |
|---|---|
| `ssh.forwardPortInUse` | Port {{port}} ist auf diesem Computer schon belegt. |
| `ssh.forwardPortDenied` | Port {{port}} darf auf diesem Computer nicht geöffnet werden. |
| `ssh.forwardRemoteRefused` | Der Server lehnt die Weiterleitung von Port {{port}} ab (AllowTcpForwarding oder Port belegt). |
| `ssh.forwardElsewhere` | Diese Weiterleitung läuft schon in einem anderen Tab. |
| `ssh.forwardNotFound` | Diese Weiterleitung gibt es nicht mehr. |
| `ssh.forwardFailed` | Die Weiterleitung konnte nicht gestartet werden. |

### 5.7 Pod-/Service-Port-Forward (Extra)

Geht mit dem bestehenden Tunnel: `PortForward` aus `@kubernetes/client-node` 2.0 nutzt denselben WebSocket-Weg wie `Exec` (`client-api.ts:274`) gegen den getunnelten API-Server. Es braucht aber eine eigene Fläche (Kontextmenü an Pods/Services, Service → Pod-Auflösung, RBAC `pods/portforward`, Regeln für `readOnly`/`production`, Anzeige ohne Terminal-Tab, Lebensdauer an der Cluster-Sitzung). **Empfehlung: eigene Spec nach 0.19.0**, Stufe 3 der Kubernetes-Spec bleibt bestehen; der kopierbare `kubectl port-forward`-Befehl bleibt bis dahin.

## 6. Regeln und Risiken: was ausdrücklich nicht getan wird

- **Kein Agent-Forwarding** (`agentForward: false` bleibt).
- **Kein Speichern** von Keyboard-Interactive-Antworten, kein Vorbelegen außer der einen Passwort-Regel aus 3.3, keine Antworten in Logs oder `detail`.
- **Kein Dialog über dem Sperrbildschirm**: Broker lehnt gesperrt ab, Renderer öffnet gesperrt nicht und schließt bei `vault:locked`.
- **Keine Ketten**, kein geteilter Sprunghost-Client zwischen Tabs (jeder Tab fragt die 2FA des Sprunghosts erneut).
- **Kein neuer `VaultConsistencyIssueCode`**, keine automatische Bereinigung beim Löschen: eine stille Umstellung auf „direkt“ würde am Bastion vorbeiführen.
- **Kein Binden an andere Adressen als Loopback** für lokal/SOCKS, keine SOCKS-Anmeldung, kein UDP.
- **Main startet nichts ohne Nutzeraktion**: automatische Weiterleitungen starten nur mit einer vom Nutzer gestarteten Verbindung und nur, wenn er „Beim Verbinden starten“ gesetzt hat.
- **Renderer schickt nur Ids** (`jumpHost`, `forwardId`); Zugangsdaten und Ziele liest Main aus dem Vault.
- **Weiterleitungen nur in SSH-Terminal-Tabs**, nicht in SFTP, Container-, Pod- oder Cluster-Sitzungen.
- **Kein eigener Timeout für Rückfragen**: die Verbindungszeit gilt; Handbuch nennt „bei 2FA mindestens 60 s“.
- Risiko **known-hosts**: dieselbe interne Adresse hinter zwei verschiedenen Sprunghosts teilt sich einen Eintrag und meldet „Schlüssel geändert“ (OpenSSH verhält sich gleich, dort hilft `HostKeyAlias`). Dokumentieren, Extra.
- Risiko **ältere Version**: 0.18 und älter verwerfen `jumpHost` und `forwards` beim Speichern. Changelog-Hinweis wie 0.14.0.
- Risiko **Schema-Evolution**: neue Weiterleitungsarten nur über ein neues Feld (5.1).
- Risiko **Warteschlange**: viele MFA-Hosts beim Workspace-Öffnen fragen nacheinander; hintere Sitzungen können ablaufen.
- Risiko **Auto-Antwort**: ein Prompt „Password:“, der in Wahrheit ein anderes Geheimnis meint, bekommt einmal das gespeicherte Passwort. Empfänger ist derselbe geprüfte Server, der es per Passwort-Methode ohnehin bekäme.

## 7. Stufe 1 gegenüber Extras

**Stufe 1 (0.19.0):** Broker, Dialog in beiden Fenstertypen, Keyboard-Interactive für Terminal, SFTP, Container, Cluster und Test; Sprunghost mit einem Hop für dieselben fünf Wege, Formularauswahl, Testschritt, Kartenschritt, Löschhinweis; Weiterleitungen L/R/D an SSH-Terminal-Sitzungen mit Registry, Leiste, Editor, Leerlauf-Regel; Fehlercodes, Texte de/en, Tests, run-app-Demo, Handbuch/Manual, Changelog, Version.

**Extras (benannt, nicht gebaut):** Pod-/Service-Port-Forward; Ketten mit Tiefenlimit; ein Sprunghost-Client für mehrere Tabs; `bindHost`; `HostKeyAlias`; Kartentext „Wartet auf deine Eingabe“ während der Rückfrage; Knopf „Adresse kopieren“ an der Leiste; Weiterleitungen ohne Terminal-Tab; Fingerabdrücke des Sprunghosts in der Fehlerkarte; Einträge im Tab-Kontextmenü.

## 8. Zerlegung in parallele Tasks

S = berührt Main-Prozess-Sicherheit.

| Welle | Task | Dateien (exklusiv) | Abhängigkeit |
|---|---|---|---|
| 1 | **A Vertrag** S | `src/shared/ssh.ts` (`AuthPrompt*`, `SshStep 'jump'`, `ForwardStatus`, Ereignis `forwards`, `SshForwardRequest`), `src/shared/ipc.ts` (Kanäle, `DesktopApi`), `src/preload/index.ts`, `src/shared/vault/schema.ts` + `schema.test.ts`, `src/shared/vault/types.ts`, `src/shared/connection-test.ts`, `src/shared/locales/{de-DE,en-US}/errors/ssh.json` (alle Codes aus 3.6, 4.6, 5.6) | – |
| 2 | **B Anmeldung und Hop** S | `src/main/ssh/client-config.ts` + `.test.ts`, neu `src/main/ssh/auth-prompts.ts` + `.test.ts`, neu `src/main/ssh/jump.ts` + `.test.ts` | A |
| 2 | **C Weiterleitungen Kern** S | neu `src/main/ssh/forwards.ts` + `.test.ts` (inkl. SOCKS5), `src/main/kubernetes/tunnel.ts` + `tunnel.test.ts` (Parameter `port`) | A |
| 2 | **D Prompt-Dialog** | neu `src/renderer/src/components/AuthPromptDialog.tsx`, neu `src/renderer/src/auth-prompt.css`, `src/renderer/src/App.tsx` (Mount), `src/renderer/src/SecondaryWindow.tsx` (Mount), `src/shared/locales/{de-DE,en-US}/app.json` | A |
| 2 | **E Formular und Sprunghost-Auswahl** | `src/renderer/src/components/ConnectionForm.tsx`, `src/renderer/src/connection-form.ts` + `.test.ts`, `src/shared/locales/{de-DE,en-US}/connection.json` (alle Keys aus 4.4, 4.5, 5.5) | A; bindet `ForwardsEditor` aus F per Prop-Vertrag `{ value: ForwardDraft[]; onChange; busy; error? }` |
| 2 | **F Weiterleitungs-Editor** | neu `src/renderer/src/components/ForwardsEditor.tsx`, neu `src/renderer/src/forward-form.ts` + `.test.ts` | A (Keys aus E per Spec) |
| 2 | **G Leiste und Karte** | neu `src/renderer/src/components/ForwardBar.tsx`, neu `src/renderer/src/forward-ui.css`, `src/renderer/src/components/TerminalPanel.tsx`, `src/renderer/src/connect-timeline.ts` + `.test.ts`, `src/shared/locales/{de-DE,en-US}/terminal.json`, `docs/design-system.md` (Zeile für die Leiste, kein Motion-Eintrag) | A |
| 2 | **H Demo-Stack** | `.claude/skills/run-app/sshd.mjs`, `fixtures.mjs`, `demo-setup.mjs`, `fakes.test.mjs`, `driver.mjs` | – |
| 3 | **I Terminal-Sitzung** S | `src/main/ssh/session.ts` + `session.test.ts`, `src/main/ssh/ipc.ts` + `ipc.test.ts` (Antwort-Kanal, `ssh:forward`), `src/main/ssh/validation.ts` + `.test.ts` | B, C |
| 3 | **J SFTP** S | `src/main/files/sftp-session.ts` + `sftp-session.test.ts`, `src/main/files/ipc.ts` | B |
| 3 | **K Container und Cluster** S | `src/main/containers/runner.ts` + `runner.test.ts`, `src/main/containers/ipc.ts`, `src/main/kubernetes/ipc.ts` | B |
| 3 | **L Verbindungstest** S | `src/main/connection-test.ts` + `connection-test.test.ts` | B |
| 3 | **M Verdrahtung** S | `src/main/index.ts` (eine `AuthPrompts`-Instanz, an alle `register*` und `testConnection`, `cancelAll()` beim Sperren und Beenden, `cancelOwner` in `closeOwnerSessions`) | B; Signaturen aus dieser Spec |
| 3 | **N Doku und Version** | `docs/handbuch.md` (Abschnitt um `:170-174` ersetzen, neue Abschnitte Sprunghost und Weiterleitungen), `docs/manual.md`, `CHANGELOG.md`, `CHANGELOG.en.md`, `README.md` (Funktionsliste), `package.json`, `package-lock.json`, `.claude/skills/run-app/screens.mjs`, `.claude/skills/run-app/SKILL.md` | Verhalten aus Spec |

Gate: nach Welle 1 `npm run typecheck`; nach Welle 2 Typecheck und die Tests der geänderten Module (der Orphan-Test für `errors/ssh.json` und die UI-Keys wird erst mit Welle 3 grün, wenn Main die Codes wirft); nach Welle 3 `npm run typecheck`, `npx vitest run`, dann run-app nach Abschnitt 9.

Signaturen, auf die Welle 3 vertraut: `sshConnectConfig(connection, hostVerifier, timeouts?, extras?)`, `AuthPrompts`/`AskPrompts` (3.2), `openJump(connection, deps)` (4.2), `SessionForwards` (5.3), `openRemoteHost(connection, verifyHost, createClient?, timeouts?, extras?)`, `registerSshIpcHandlers(knownHosts, prompts, sudoRejections?, openKubeTerminal?)`, `registerFileIpcHandlers(knownHosts, prompts)`, `registerContainerIpcHandlers(knownHosts, prompts, sudoRejections?)`, `registerKubernetesIpcHandlers(knownHosts, prompts, sudoRejections)`, `ConnectionTestDependencies` + `ask?`, `getConnection?`, `openRemote?`.

## 9. Demo-Stack (run-app)

- **sshd.mjs**
  - Benutzer `mfa`: nur `keyboard-interactive` (`context.reject(['keyboard-interactive'])` sonst). Runde 1: „Password: “ (`echo: false`) → `synthetic-demo`; Runde 2: „Verification code: “ (`echo: false`) → fester Code aus `fixtures.mjs` (`DEMO_TOTP = '246810'`).
  - `tcpip`-Ziele zusätzlich zu `k8s-cp1:6443`: `internal-01:22` → derselbe sshd (Ziel hinter dem Sprunghost), `db-internal:5432` → kleiner lokaler TCP-Echo-Server, `intranet.demo:80` → kleiner HTTP-Fake mit einer Seite (für SOCKS).
  - `client.on('request')`: `tcpip-forward` für `localhost` annehmen (Entfernt-Weiterleitung zeigt „aktiv“), alles andere ablehnen.
- **demo-setup.mjs**: `mfa-01` (SSH, Benutzer `mfa`, Passwort gespeichert → nur der Code wird gefragt), `app-intern` (SSH, Host `internal-01`, Port 22, Sprunghost `web-01`, Weiterleitungen: lokal 15432 → `db-internal:5432` automatisch, SOCKS 1080 per Klick).
- **screens.mjs**: Prompt-Dialog bei `mfa-01`; Formular `app-intern` mit „Weitere Angaben“ offen (Sprunghost, Weiterleitungen); Terminal `app-intern` mit Leiste (aktiv/aus); Verbindungskarte mit Schritt „Sprunghost verbinden“ (langsamer Fake oder Screenshot während des Hops); Test-Ergebnis mit Schritt „Sprunghost web-01 verbunden“; Fehler „Port 15432 ist auf diesem Computer schon belegt.“ (Treiber belegt den Port vorher).
- **fakes.test.mjs**: Keyboard-Interactive-Runden, die neuen `tcpip`-Ziele, `tcpip-forward`.
