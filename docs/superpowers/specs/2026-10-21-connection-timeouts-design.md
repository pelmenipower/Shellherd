# Verbindungs-Timeouts und Vault-Auto-Sperre – Design

Auftrag: „Wir brauchen Einstellmöglichkeiten, ab wann sich eine SSH-Verbindung sauber trennt oder andere Verbindungen, und ab wann sich der Vault automatisch schließt und verschlüsselt.“ Grundlage ist das Konzept `.superpowers/sdd/connection-timeouts-research.md`, ab „1. Bestand und Lücken“ hier vollständig als Spec übernommen. Plan: `docs/superpowers/plans/2026-10-21-connection-timeouts.md`.

## Nutzer-Entscheidungen (bindend)

- **N1** Einstellbar sind Leerlauf-Trennung (X Minuten ohne Ein- und Ausgabe, 0 = nie), Keepalive (Intervall und Fehlversuche) und Verbindungs-Timeout.
- **N2** Die Werte gelten global (Einstellungen) und lassen sich pro Verbindung optional überschreiben.
- **N3** Der Vault sperrt sich nach X Minuten ohne Maus oder Tastatur in Shellherd. Genutzt wird das vorhandene `autoLockMinutes`.
- **N4** Beim automatischen Sperren werden alle Sitzungen sauber getrennt, wie beim manuellen Sperren.

## Spec-Rulings (Stufe 3)

- **S1** Die Rulings R1–R15 aus Abschnitt 7 des Konzepts gelten.
- **S2** Der Umfang ist Stufe 1 aus Abschnitt 5. Die Extras entfallen.
- **S3** Version `0.14.0` über `npm run version:minor`. Der Changelog nennt ausdrücklich, dass bestehende Vaults ab jetzt nach 15 Minuten sperren (0 schaltet ab).
- **S4** Abnahme: Typecheck und `npx vitest run` grün, run-app nach 3.10 (Leerlauf-Trennung, Auto-Sperre, Gegenprobe), Screenshots ansehen.

## 1. Bestand und Lücken

### 1.1 `autoLockMinutes`

| Wo | Was | Fundstelle |
|---|---|---|
| Typ | `VaultSettings.autoLockMinutes: number` | `src/shared/vault/types.ts:250` |
| Schema | `z.number().int().min(0).max(1_440)`, Kommentar „0 deaktiviert“ | `src/shared/vault/schema.ts:197` |
| Default neuer Vault | `15` | `src/renderer/src/App.tsx:93`, `src/shared/vault/example.ts:59` |
| Einstellungsdialog | **fehlt**: Abschnitt „Vault“ zeigt nur `confirmBeforeClosingSession` | `src/renderer/src/components/SettingsDialog.tsx:54-60` |
| Setter | nur `withConfirmBeforeClosing` | `src/renderer/src/settings-sections.ts:21` |
| Wirkung | **keine**: kein Leser in `src/main`, kein Timer, kein `powerMonitor` | – (grep über `src/`) |
| Spec | Settings-Design hat es bewusst ausgeklammert | `docs/superpowers/specs/2026-10-19-settings-design.md:21` |

Folge: Jeder bestehende Vault trägt `autoLockMinutes: 15`. Sobald die Sperre wirkt, sperren sich alle vorhandenen Vaults nach 15 Minuten. Das ist gewollt (Ledger: „vorhandenes Feld nutzen“), muss aber im Changelog und Handbuch klar stehen (Ruling R3).

### 1.2 Manuelles Sperren heute

1. Kopfzeilen-Knopf `app:header.lock` → `navigateEditor` (ungespeicherter Editor fragt) → bei laufenden Sitzungen und `confirmBeforeClosingSession` der `ConfirmDialog` `lockVault` → sonst direkt `lockVault()` (`App.tsx:786-789`, `799-810`).
2. `lockVault()` (`App.tsx:586-599`): `busy`, `window.desktopApi.lockVault()`, dann im `finally` `setVault(null)`, `setVaultPath(null)`, `resetForm()` (schließt Editor, Tabs, Layout, Hinweise; `App.tsx:284-306`), `setScreen('home')`, `setAppDialog(null)`.
3. Main `vault:lock` (`src/main/vault/ipc.ts:214-220`): `onSessionChange()` dann `vaultSessionManager.lock()` (Schlüssel wird genullt, `session.ts:115-122`).
4. `onSessionChange` (`src/main/index.ts:263`) = `closeAllSessions()` (SSH, RDP, SFTP, Assistent, Container-Discovery, Kube; `index.ts:52`) plus `closeSecondaryWindows()` (`index.ts:58-64`: Sitzungen des Fensters schließen, `allowClose`, `close()`).
5. Nebenfenster erfahren von der Sperre nur durch ihr Schließen; sie haben keine Vault-Instanz (`SecondaryWindow.tsx`, Katalog aus `window-ipc.ts:80-83`).
6. Es gibt **keinen** Kanal, über den Main dem Hauptfenster „Vault ist gesperrt“ melden könnte. Alle Lock-Wege starten im Renderer. Für die Auto-Sperre fehlt genau dieser Rückkanal.

### 1.3 Feste Timeouts heute

| Wert | Fundstelle | Nutzer |
|---|---|---|
| `readyTimeout: 120_000`, `keepaliveInterval: 15_000`, `keepaliveCountMax: 3` | `src/main/ssh/client-config.ts:31-32` | `ssh/session.ts:230` (Terminal, Container-Tab), `files/sftp-session.ts:83` (SFTP), `containers/runner.ts:34` (`openRemoteHost`: Container-Discovery und Cluster-Zugangshost) |
| `readyTimeout: 120_000, keepaliveInterval: 0` als Override, eigener 15-s-Timer, pausiert im Host-Key-Dialog | `src/main/connection-test.ts:15`, `:108`, `:124`, `:136` | Verbindungstest; **bleibt unverändert** |
| Start-Abbruch 30 s, Nicht-Antworten 30 s (Ack-Rückstau) | `ssh/session.ts:192`, `:470` | technische Wächter, keine Nutzer-Einstellung |
| Discovery-Helfer-Verbindung idle 60 s | `containers/discovery.ts:237` | Cache, kein Nutzer-Tab; bleibt |
| Cluster-Sitzung idle 60 s nach letzter Ansicht/Terminal, Reconnect-Backoff | `kubernetes/session.ts:25`, `:492-498` | hält Tunnel (`tunnel.ts`); bleibt |
| RDP | `rdp/host.ts` – der Helfer/ActiveX-Control kennt keine ssh2-Parameter | exempt |

Kein Leerlauf-Timer existiert für Terminal- oder SFTP-Sitzungen. Eine Trennung durch den Server kommt als `code: 'closed-by-server'` (`ssh/session.ts:199`, `sftp-session.ts:75`) an und wird in der Getrennt-Leiste mit Grund gezeigt (`TerminalPanel.tsx:151`, `FilesPanel.tsx:322`, `DisconnectedBar.tsx:19-21`, Texte `terminal.json:143-151`).

## 2. Empfehlung je Fläche

| Fläche | Empfehlung | Wert | Aufwand |
|---|---|---|---|
| Einstellungen → Vault: „Automatisch sperren nach … Minuten“ | Zahlenfeld, Commit bei Blur/Enter, 0 = nie | ★★★ | nur Renderer |
| Vault-Auto-Sperre (Timer in Main, Aktivitäts-Pings aus allen Fenstern, Rückkanal `vault:locked`) | neu | ★★★ | kleine Main-Änderung (ein Modul, zwei IPC-Kanäle) |
| Einstellungen → neuer Abschnitt „Verbindungen“: Leerlauf, Keepalive (Intervall, Fehlversuche), Verbindungs-Timeout | Zahlenfelder, global für SSH und SFTP | ★★★ | nur Renderer plus `client-config.ts` |
| Leerlauf-Trennung für SSH-Terminal, Container-Tab, Pod-Terminal, SFTP | Timer je Sitzung in `ssh/session.ts` und `sftp-session.ts`, Grund `idle` in der Getrennt-Leiste | ★★★ | kleine Main-Änderung |
| Pro-Verbindung-Override (SSH, SFTP) unter „Weitere Angaben“ | vier optionale Felder, leer = Vorgabe | ★★ | nur Renderer plus Schema |
| Keepalive/Connect-Timeout für Container-Discovery und Cluster-Zugangshost | erben automatisch über `sshConnectConfig` | ★★ | kommt mit `client-config.ts` mit |
| Vorwarnung vor Leerlauf-Trennung oder Sperre | **nicht jetzt** (siehe 4) | ★ | nicht jetzt |
| Leerlauf für lokale Shells, RDP, Cluster-Sitzung, Tunnel | **nicht** (siehe 3.2) | – | – |

## 3. Entwurf

### 3.1 Datenmodell (ohne Versionssprung)

`src/shared/vault/types.ts`:

```ts
/** Timeouts of SSH-backed sessions; see docs/superpowers/specs/2026-10-21-connection-timeouts-design.md. */
export interface ConnectionTimeouts {
  /** Minutes without input or output before the session is closed; 0 = never. */
  idleMinutes: number;
  /** Seconds between ssh2 keepalive probes. */
  keepaliveSeconds: number;
  /** Unanswered probes before the connection counts as dead. */
  keepaliveCount: number;
  /** Seconds the SSH handshake may take. */
  connectSeconds: number;
}
export interface VaultSettings { theme; autoLockMinutes; confirmBeforeClosingSession; timeouts?: ConnectionTimeouts }
// SshConnectionNode und SftpConnectionNode:
timeouts?: Partial<ConnectionTimeouts>;
```

`timeouts` ist **optional**, damit alte Vaults, `example.ts`, `mutations.test.ts:408`, `settings-sections.test.ts:48` und `createEmptyVault` (`App.tsx:91-95`) unverändert gültig bleiben. Kein Versionssprung (`CURRENT_VAULT_VERSION` bleibt 2, `migrations.ts:6`). Ein älteres Shellherd ignoriert das Feld, weil die Objekt-Schemata nicht `.strict()` sind (gleiche Begründung wie `schema.ts:56`).

`src/shared/vault/schema.ts`:

```ts
export const ConnectionTimeoutsSchema = z.object({
  idleMinutes: z.number().int().min(0).max(1_440),
  keepaliveSeconds: z.number().int().min(5).max(300),
  keepaliveCount: z.number().int().min(1).max(10),
  connectSeconds: z.number().int().min(5).max(300),
});
// VaultSettingsSchema: timeouts: ConnectionTimeoutsSchema.optional()
// Ssh-/SftpConnectionNodeSchema: timeouts: ConnectionTimeoutsSchema.partial().optional()
```

Neu `src/shared/vault/timeouts.ts` (eine Datei, eine Funktion, von Main und Renderer genutzt):

```ts
export const DEFAULT_TIMEOUTS: ConnectionTimeouts = { idleMinutes: 0, keepaliveSeconds: 15, keepaliveCount: 3, connectSeconds: 120 };
export const TIMEOUT_LIMITS = { idleMinutes: [0, 1_440], keepaliveSeconds: [5, 300], keepaliveCount: [1, 10], connectSeconds: [5, 300] } as const;
/** Vault default, then the vault setting, then the connection's own values; undefined keys never override. */
export function effectiveTimeouts(settings?: Pick<VaultSettings, 'timeouts'>, connection?: ConnectionNode): ConnectionTimeouts;
```

Die Defaults sind exakt die heutigen Werte und Leerlauf 0 = nie. Ein Upgrade ändert das Verbindungsverhalten also nicht (R2).

**Warum Vault-Settings und nicht `app-settings.json`:** `app-settings.json` (`src/main/app-settings.ts:7`) kennt nur `language` und ist pro Rechner. Timeouts beschreiben die Server (NAT-Timeouts, langsame Hosts) und gehören zu den Verbindungen; sie reisen mit dem Vault. Main liest sie ohne neue Datei über `vaultSessionManager.getSnapshot().vault.settings`, so wie heute `confirmBeforeClosingSession` (`index.ts:118`). `autoLockMinutes` liegt schon dort.

### 3.2 Welche Verbindungsart bekommt was

| Art | Connect-Timeout | Keepalive | Leerlauf | Begründung |
|---|---|---|---|---|
| SSH-Terminal (`ssh/session.ts`, `session.client`) | ja | ja | **ja** | Kernfall |
| Container-Tab über SSH (gleiche Session mit `target`) | ja | ja | ja | gleiche Session, null Mehraufwand; Logs-Stream ist Ausgabe |
| Pod-Terminal (`session.kubeStream`) | – (Cluster-Sitzung) | – | ja | hält Tunnel und Cluster-Sitzung; `finish` schließt den Stream |
| Lokale Shell, KI-CLI, lokaler Container (`session.pty`) | – | – | **nein** | kein Netz, nichts zu sparen; Kill verliert nur Shell-Zustand (R4) |
| SFTP/Dateiansicht (`sftp-session.ts`) | ja | ja | ja | Aktivität = jeder Aufruf über `remote()`; beschäftigt = laufender Job, gebundener Auto-Upload, offene Bearbeitung (R5) |
| Container-Discovery (`openRemoteHost`) | ja (erbt) | ja (erbt) | nein, eigener 60-s-Cache bleibt | Helfer, kein Nutzer-Tab |
| Cluster-Zugangshost und Tunnel (`openRemoteHost`, `tunnel.ts`) | ja (erbt vom SSH-Knoten) | ja (erbt) | nein, eigener 60-s-Idle bleibt | Tunnel ist kein Leerlauf, solange Ansicht oder Pod-Terminal offen |
| RDP | – | – | nein | Helfer-Control; Serverrichtlinien regeln das |
| Verbindungstest (`connection-test.ts`) | nein (eigene 15 s) | nein (0) | – | bleibt, Regressionstest (R12) |
| Port-Forwards | nur der Kube-Tunnel, siehe oben | | | eigene Nutzer-Forwards gibt es nicht |

Wer bekommt die Werte: Einzig `sshConnectConfig` (`client-config.ts:28`) setzt ssh2-Parameter. Neue Signatur:

```ts
export async function sshConnectConfig(connection, hostVerifier, timeouts: ConnectionTimeouts = DEFAULT_TIMEOUTS)
// readyTimeout: timeouts.connectSeconds * 1000, keepaliveInterval: timeouts.keepaliveSeconds * 1000, keepaliveCountMax: timeouts.keepaliveCount
```

Aufrufer liefern `effectiveTimeouts(settings, connection)`:

- `ssh/session.ts`: `SshDependencies.getTimeouts?: (connection: ConnectionNode) => ConnectionTimeouts` (Default `() => DEFAULT_TIMEOUTS`, Tests unverändert); `ssh/ipc.ts:44` verdrahtet `connection => effectiveTimeouts(vaultSessionManager.getSnapshot().vault.settings, connection)`.
- `files/sftp-session.ts`: gleiches Dependency-Muster, `files/ipc.ts:72` verdrahtet.
- `containers/runner.ts:30`: `openRemoteHost(connection, verifyHost, createClient = …, timeouts = DEFAULT_TIMEOUTS)` (vierter Parameter, damit `runner.test.ts` unverändert bleibt); `containers/ipc.ts:22` und `kubernetes/ipc.ts:36` geben `effectiveTimeouts(…)` mit. Der Kommentar `runner.ts:39` (kein kürzerer readyTimeout wegen Host-Key-Dialog) bleibt sinngemäß: die Vorgabe sind 120 s, wer 5 s einstellt, bekommt beim ersten Host-Key-Dialog einen Timeout. Das ist die Entscheidung des Nutzers; Untergrenze 5 s hält die Schraube aus dem Absurden (R10).
- `connection-test.ts:136` überschreibt weiterhin `readyTimeout` und `keepaliveInterval: 0` nach dem Spread; kein Codewechsel, nur eine Assertion in `connection-test.test.ts`.

### 3.3 Leerlauf-Definition und Timer

**Terminal (`ssh/session.ts`):** neues Feld `idleTimer?` in `Session`. Scharf bei `phase = 'connected'` (`attachStream` `:286`, `startKubeTerminal` `:431`), nicht in `startLocalShell`/`startLocalContainer`. Rücksetzen in `output()` (`:452`) und `input()` (`:486`). Löschen in `finish()` (`:551`). Ablauf: `this.finish(session, 'closed', undefined, 'idle')`. Minuten aus `getTimeouts(connection).idleMinutes`, 0 = kein Timer. Zeit über injizierbares `schedule`/`cancel` wie in `kubernetes/session.ts:45-46`, damit der Test keinen echten Minuten-Timer braucht. Während `handover` (Fensterwechsel) sind die Streams pausiert; der Wechsel dauert Millisekunden, kein Sonderfall.

**SFTP (`sftp-session.ts`):** `idleTimer` in `Session`, scharf nach `status = 'connected'` (`:105`), Rücksetzen in `remote()` (`:130`, deckt Listing, mkdir, rename, delete, chmod, createFile, Transfer-Start, Edit ab) und in `transfer()`. Bei Ablauf gilt „beschäftigt“ und der Timer wird neu gestellt, wenn `session.running` gesetzt ist, `session.syncs.list().length > 0` (ein gebundener Auto-Upload überwacht und lädt; Ledger: darf nie Leerlauf sein) oder `session.edits.list().length > 0` (offene Bearbeitung pollt den Server, `remote-edit.ts`). Sonst `finish(session, 'closed', undefined, 'idle')`.

**Was der Nutzer sieht:** Dieselbe Getrennt-Leiste wie bei `closed-by-server`, mit Grund „wegen Leerlauf getrennt“ und `Neu verbinden` (Enter). Dazu:

- `src/shared/connection-errors.ts:3`: `ConnectionErrorCode` um `'idle'` erweitern (nur mit `status: 'closed'`, wie `closed-by-server`, Kommentar in `shared/ssh.ts:23` ergänzen).
- `TerminalPanel.tsx:151` und `FilesPanel.tsx:322`: `event.code === 'idle' ? 'idle'`. `DisconnectedBar.tsx:10,19-21`: Reason `'idle'` mit `terminal:disconnected.reasons.idle`. Motion: `data-instant` nur bei `session`/`cancel`; `idle` animiert wie `server` (Ereignis, keine Taste) und braucht keinen neuen Gate-Eintrag (gleiche Regel `.connect-closed`).
- `connection-error-text.ts:17-31`: `KEYS.idle` (Typ `Record<ConnectionErrorCode, …>` erzwingt es) mit `terminal:connectionError.idle.{title,body,next}`; der Fall tritt mit Status `closed` nie als Karte auf, die drei Strings halten nur den Typ und den Orphan-Test zusammen.

**Keine Vorwarnung** (R6): Eine Warnzeile im Terminal müsste über `output()` eingespielt werden (Muster `sudoGaveUp`, `session.ts:324`), würde Vollbildprogramme zerschießen und selbst als Ausgabe den Timer zurücksetzen. Standard ist 0 = nie, die Leiste erklärt den Grund, Enter verbindet neu.

### 3.4 Vault-Inaktivität

**Messung:** DOM-Ereignisse in jedem Shellherd-Fenster, nicht `powerMonitor.getSystemIdleTime()`. Systemweite Idle-Zeit wäre falsch, weil Arbeit in Outlook oder im Browser den Vault unbegrenzt offen hielte; der Ledger sagt „ohne Maus/Tastatur **in Shellherd**“. Terminal-**Ausgabe** zählt nicht: ein `tail -f` erzeugt keine DOM-Eingabe, Tastendrücke im xterm landen als `keydown` im `.xterm-helper-textarea` und zählen. Rechtsklick-Einfügen ist `pointerdown`.

Neu `src/renderer/src/activity.ts` (reine Funktion, testbar):

```ts
/** Capture listeners for keydown, pointerdown, pointermove and wheel; `send` runs at most once per `throttleMs`. */
export function reportActivity(target: Window, send: () => void, throttleMs = 10_000, now = Date.now): () => void;
```

Aufruf in `src/renderer/src/main.tsx` vor dem Render, für Haupt- und Nebenfenster gleichermaßen: `reportActivity(window, () => window.desktopApi.vaultActivity())`. Vor dem Entsperren sind die Pings wirkungslos (Main ignoriert sie im gesperrten Zustand). Höchstens sechs Pings pro Minute und Fenster.

**Timer in Main**, neu `src/main/vault/auto-lock.ts`:

```ts
export interface AutoLockDeps {
  /** 0 = off; read on every check so a settings change applies without restart. */
  minutes: () => number;
  lock: (minutes: number) => void;
  /** powerMonitor.getSystemIdleTime; only consulted while an RDP session is connected. */
  systemIdleSeconds: () => number;
  rdpConnected: () => boolean;
  now?: () => number; tickMs?: number; schedule?; cancel?;
}
export class AutoLock { constructor(deps); start(); touch(); check(); dispose(); }
```

Ein `setInterval` (30 s) vergleicht `now - lastActivity` mit `minutes * 60_000` statt eines je Ping neu gestellten `setTimeout`: robust gegen Schlafmodus (nach dem Aufwachen sperrt der nächste Tick sofort) und gegen eine zwischenzeitlich geänderte Einstellung. Timestamp statt Timer ist auch das, was man mit Fake-Timern am einfachsten testet.

**RDP-Sonderfall** (R8): Hat das RDP-Control den Fokus, gehen Maus und Tastatur am Renderer vorbei (`rdp/host.ts:101` kennt nur den Fokuswechsel). Ohne Regel würde eine aktive RDP-Sitzung nach X Minuten gesperrt. Regel: Solange eine RDP-Sitzung `connected` ist, gilt zusätzlich `powerMonitor.getSystemIdleTime() * 1000 >= minutes * 60_000` als Bedingung. `RdpSessionManager` bekommt `hasConnected(): boolean` (eine Zeile neben `hasOwner`). Kosten: Mit offenem RDP-Tab hält auch Arbeit in anderen Programmen den Vault offen. Das ist die kleinste ehrliche Lösung; ein Input-Hook im Helfer ist nicht jetzt.

**Verdrahtung `src/main/index.ts`:**

- `IPC_CHANNELS.vaultActivity = 'vault:activity'` per `ipcMain.on` (fire-and-forget, `ipcRenderer.send`): zulässig, wenn `windowRegistry.roleOf(event.sender.id)` gesetzt und `event.senderFrame === event.sender.mainFrame` (Muster `index.ts:207`). Kein Payload.
- `lock`: `closeAllSessions(); closeSecondaryWindows(); vaultSessionManager.lock(); windowRegistry.main()?.webContents.send(IPC_CHANNELS.vaultLocked, { minutes })`. Das ist exakt der Weg des manuellen Sperrens (`vault/ipc.ts:214-220` mit `onSessionChange`), nur plus Rückkanal.
- `minutes`: `try { return vaultSessionManager.getSnapshot().vault.settings.autoLockMinutes } catch { return 0 }`.
- `registerVaultIpcHandlers({ onSessionChange: () => { …; autoLock.touch(); } })`: Entsperren setzt den Zeitpunkt zurück, sonst sperrt ein alter Zeitstempel sofort nach dem Entsperren.
- `will-quit`: `autoLock.dispose()`.

**Renderer `App.tsx`:** Aus dem `finally` von `lockVault()` (`:590-598`) wird `afterLock()`; ein einmaliger Effekt `window.desktopApi.onVaultLocked(({ minutes }) => { afterLockRef.current(); notify.info(t('app:notices.autoLockedTitle'), { body: t('app:notices.autoLockedBody', { minutes }) }); })` (Ref-Muster wie `openVaultFileRef`, `:217-228`). Die Meldung kommt nach `resetForm()`, weil das `clearNotices()` ruft (`:305`). `onVaultLocked`-Listener nur im Hauptfenster; Nebenfenster werden von Main geschlossen.

**Offene Dialoge beim Sperren** (R9): Die Auto-Sperre fragt nichts, es ist niemand da. `confirmBeforeClosingSession` gilt nicht, der Ungespeichert-Dialog des Verbindungsformulars (`navigateEditor`, `App.tsx:601-605`) auch nicht: Ein ungespeichertes Formular geht verloren, genau wie beim Beenden von Windows. Das steht im Handbuch und in der Hint-Zeile der Einstellung. Native Dialoge (Host-Key) bleiben offen, bis sie beantwortet werden; die zugehörige Sitzung ist dann schon weg, `isActive()` liefert false (`known-hosts.ts`-Vertrag). Ein laufendes `saveCurrentVault` wird nach der Sperre mit `core.vaultLocked` abgewiesen und als „Vault nicht gespeichert“ gemeldet (`usePersistVault.ts`); gleiche Rennsituation wie beim manuellen Sperren, nicht neu.

**Vorwarnung:** keine in Stufe 1 (siehe 4).

### 3.5 Einstellungsdialog

`settings-sections.ts`: `SETTINGS_SECTIONS = ['general', 'vault', 'connections', 'assistant']`; neue reine Funktionen

```ts
export function withAutoLockMinutes(settings: VaultSettings, minutes: number): VaultSettings;
export function withTimeouts(settings: VaultSettings, patch: Partial<ConnectionTimeouts>): VaultSettings; // speichert das volle Objekt auf Basis von effectiveTimeouts(settings)
export function parseBounded(value: string, limits: readonly [number, number]): number | null;  // ganze Zahl im Bereich, sonst null
```

`SettingsDialog.tsx`: Abschnitt „Vault“ bekommt unter der Checkbox die Zeile *Automatisch sperren nach* `[15]` *Minuten ohne Eingabe (0: nie)*; neuer Abschnitt „Verbindungen“ mit drei Zeilen:

- *Leerlauf-Trennung nach* `[0]` *Minuten ohne Ein- und Ausgabe (0: nie)*
- *Keepalive alle* `[15]` *Sekunden, Trennung nach* `[3]` *Fehlversuchen*
- *Verbindungs-Timeout* `[120]` *Sekunden*
- Hint: „Gilt für SSH und SFTP dieses Vaults, auch für Container- und Cluster-Zugriffe über SSH. Einzelne Verbindungen können unter „Weitere Angaben“ abweichen.“

Zahlenfelder (`input type="number" inputMode="numeric" min max step=1`) halten einen lokalen Text-Entwurf und **committen bei Blur und Enter**, nicht pro Tastendruck (R13): `persistVault` setzt `busy`, das Feld würde `disabled` und verlöre den Fokus (`SettingsDialog.tsx:56`). Ungültig → `.field-error` unter dem Feld mit `aria-invalid`, Text `app:settings.rangeError` („Gib eine ganze Zahl von {{min}} bis {{max}} ein.“), Muster **Feld** aus `docs/design-system.md` Abschnitt Meldungen. Unverändert → kein Save.

CSS in `settings-ui.css`: eine Zeile `.settings-number { display: flex; align-items: center; gap: var(--space-8); }` und `.settings-number input { width: 6ch; }` (Breite ist kein geprüftes Maß; Höhe kommt vom globalen `input`). Keine Bewegung, kein neuer Token.

Der Dialog ist nur im Hauptfenster; Nebenfenster brauchen die Timeouts nicht (Sitzungen entstehen in Main mit den Vault-Settings; der Katalog `window-ipc.ts:80-83` bleibt unverändert).

### 3.6 Verbindungsformular

`connection-form.ts`: `ConnectionFields` plus `idleMinutes`, `keepaliveSeconds`, `keepaliveCount`, `connectSeconds` (Strings wie `port`, damit `ConnectionTextField` und `textField()` sie ohne neuen Pfad rendern). `fieldsFromConnection` füllt aus `connection.timeouts?.x ?? ''` (nur ssh/sftp). `connectionFromFields` (`:118-124`): je nicht-leerem Feld `parseBounded` mit `TIMEOUT_LIMITS`, sonst `ConnectionFieldError(field, t('connection:validation.timeoutRange', { min, max }))`; `timeouts` nur anhängen, wenn mindestens ein Wert gesetzt ist (kein leeres Objekt im Vault). `keepAutoUpload` bleibt, weil Timeouts im Formular editiert werden.

`ConnectionForm.tsx`: in `<details>` „Weitere Angaben“ (`:199-210`) für `sshAuth` eine Zeile mit den vier Feldern (Klasse `editor-host-row`, vorhandene Feldoptik) und `editor-hint` „Leer: Vorgabe aus den Einstellungen.“ `inputMode="numeric"` für diese Felder wie für `port` (`:122`). Die Öffnen-Bedingung des `details` bei Feldfehlern (`:112`) um die vier Felder erweitern, sonst springt der Fokus in ein zugeklapptes Feld. Kein neues CSS.

### 3.7 IPC und Preload

`src/shared/ipc.ts`: `vaultActivity: 'vault:activity'`, `vaultLocked: 'vault:locked'`; `DesktopApi`: `vaultActivity: () => void`, `onVaultLocked: (listener: (info: { minutes: number }) => void) => () => void`. `src/preload/index.ts`: `vaultActivity: () => ipcRenderer.send('vault:activity')`, `onVaultLocked: listener => subscribe('vault:locked', listener)`.

### 3.8 i18n (de-DE, en-US parallel)

`app.json` → `settings.sections.connections` „Verbindungen“; `settings.autoLock.label` „Automatisch sperren nach“, `.unit` „Minuten ohne Eingabe (0: nie)“, `.hint` „Trennt alle Sitzungen und sperrt den Vault, wenn in keinem Shellherd-Fenster Maus oder Tastatur benutzt wurde. Ungespeicherte Eingaben gehen dabei verloren.“; `settings.timeouts.idle.label/unit`, `settings.timeouts.keepalive.label` „Keepalive alle“, `.unit` „Sekunden, Trennung nach“, `.countUnit` „Fehlversuchen“, `settings.timeouts.connect.label/unit`, `settings.timeouts.hint`; `settings.rangeError`; `notices.autoLockedTitle` „Vault gesperrt“, `notices.autoLockedBody` „{{minutes}} Minuten ohne Eingabe. Alle Sitzungen wurden getrennt.“

`connection.json` → `form.fields.idleMinutes` „Leerlauf-Trennung (min)“, `form.fields.keepaliveSeconds` „Keepalive (s)“, `form.fields.keepaliveCount` „Keepalive-Fehlversuche“, `form.fields.connectSeconds` „Verbindungs-Timeout (s)“, `form.timeouts.hint` „Leer: Vorgabe aus den Einstellungen.“, `validation.timeoutRange` „Gib eine ganze Zahl von {{min}} bis {{max}} ein oder lass das Feld leer.“

`terminal.json` → `disconnected.reasons.idle` „wegen Leerlauf getrennt“; `connectionError.idle.title` „Wegen Leerlauf getrennt“, `.body` „Shellherd hat die Verbindung nach der eingestellten Leerlaufzeit beendet.“, `.next` „Neu verbinden oder die Leerlauf-Trennung in den Einstellungen anpassen.“

Alle Keys als volle Literale (`KEYS`, `REASON_KEYS`, Sektionstitel-Map in `SettingsDialog.tsx:24-28`), keine Zusammensetzung; `i18n-catalog.test.ts` (d) und (g) laufen mit.

### 3.9 Tests

| Datei | Prüft |
|---|---|
| neu `src/shared/vault/timeouts.test.ts` | Defaults = heutige Werte; `effectiveTimeouts` ignoriert `undefined`-Keys im Override; Schema nimmt fehlendes `timeouts`, lehnt `keepaliveSeconds: 4`, `connectSeconds: 301`, `idleMinutes: -1` ab; Partial-Override im Knoten |
| neu `src/main/ssh/client-config.test.ts` | `readyTimeout`/`keepaliveInterval`/`keepaliveCountMax` aus `timeouts`, Default ohne Argument |
| `src/main/connection-test.test.ts` | Assertion: `connect` erhält `keepaliveInterval: 0` und `readyTimeout: 120_000` unabhängig von `timeouts` |
| `src/main/ssh/session.test.ts` | mit injiziertem `schedule`: nach `connected` wird ein Timer mit `idleMinutes * 60_000` gestellt, `input`/`output` stellen ihn neu, Auslösen → `status closed, code 'idle'`; lokale Shell (`local-shell.test.ts`) stellt keinen; 0 stellt keinen |
| `src/main/files/sftp-session.test.ts` | Timer nach `connected`; Auslösen bei laufendem Job oder gebundenem Auto-Upload stellt neu statt zu schließen; sonst `closed`/`idle` |
| neu `src/main/vault/auto-lock.test.ts` | reine Klasse mit `now`/`schedule`: sperrt nach X min, `touch` setzt zurück, 0 nie, Wert wird je Tick neu gelesen, RDP-Guard mit `systemIdleSeconds`, `dispose` |
| `src/renderer/src/settings-sections.test.ts` | neue Sektionen, `withAutoLockMinutes`, `withTimeouts` schreibt volles Objekt, `parseBounded` (leer, Dezimal, außerhalb) |
| `src/renderer/src/connection-form.test.ts` | Round-Trip der vier Felder, leer → kein `timeouts`, Bereichsfehler nennt das Feld, Teil-Override bleibt Teil |
| neu `src/renderer/src/activity.test.ts` | Throttle: zwei Events in 10 s → ein `send`; Listener werden entfernt |
| automatisch | `design-tokens.test.ts`, `i18n-catalog.test.ts`, `version.test.ts` |

### 3.10 run-app

`node .claude/skills/run-app/screens.mjs settings` liefert `settings.png` mit beiden neuen Abschnitten ohne Skriptänderung (`screens.mjs:115-127`). Manuelle Prüfung im Review über den Treiber, kein neuer Szenario-Code:

1. Leerlauf: Einstellungen → Verbindungen → Leerlauf `1`, `web-01` verbinden, 60–70 s nichts tun → Leiste „Verbindung getrennt · … · wegen Leerlauf getrennt“, Enter verbindet neu. Screenshot `idle-disconnect`.
2. Auto-Sperre: Vault → Automatisch sperren `1`, Fenster nicht anfassen, nach ≤ 90 s (Tick 30 s) erscheint die Startkarte mit Meldung „Vault gesperrt“; Nebenfenster sind zu.
3. Gegenprobe: mit `/type` im Terminal alle 30 s tippen → keine Sperre.

Die Tests 1 und 2 dauern zusammen unter drei Minuten.

### 3.11 Doku, Changelog, Version

`docs/handbuch.md` → Abschnitt „### Vault“ (Zeile 87) um die Auto-Sperre, neuer „### Verbindungen“ nach „Vault“, Satz in „Meldungen und Verbindungszustand“ (Zeile 302) zum Grund „wegen Leerlauf“, „Prozessgrenzen und Lebenszyklus“ (Zeile 331, 339) um Leerlauf und Auto-Sperre. `docs/manual.md` spiegelt (Zeilen 72–92). `CHANGELOG.md`/`CHANGELOG.en.md` `## [0.14.0]` mit dem ausdrücklichen Satz, dass bestehende Vaults ab jetzt nach 15 Minuten sperren (0 schaltet ab). `npm run version:minor`.

## 4. Regeln und Risiken – was ausdrücklich nicht getan wird

- **Kein `powerMonitor` als Aktivitätsquelle**, außer dem RDP-Guard (R8). Keine Idle-Messung über andere Programme.
- **Keine Vorwarnung** vor Leerlauf-Trennung oder Sperre (R6). Extras-Liste.
- **Keine Rückfrage** bei der Auto-Sperre; weder `confirmBeforeClosingSession` noch der Ungespeichert-Dialog. Datenverlust im Formular ist dokumentiert (R9).
- **Kein Leerlauf** für lokale Shells, RDP, Discovery-Helfer, Cluster-Sitzung, Tunnel (R4). Die bestehenden 60-s-Caches in `discovery.ts:237` und `kubernetes/session.ts:25` bleiben Konstanten.
- **Keepalive nicht abschaltbar** (5–300 s), Fehlversuche 1–10, Verbindungs-Timeout 5–300 s, Leerlauf 0–1440 min (R10). Keine Sekundenauflösung beim Leerlauf.
- **`connection-test.ts` unverändert** (R12): eigener Timer, `keepaliveInterval: 0`, pausiert im Host-Key-Dialog. Nur eine Regressionsassertion.
- **Kein Versionssprung des Vault-Formats**, keine Migration; `timeouts` optional, Defaults = heute (R2). `autoLockMinutes` behält den gespeicherten Wert 15 (R3), Changelog nennt es.
- **Kein Override** für RDP, lokale Shells, Kube-Knoten; Cluster und Container erben vom genutzten SSH-Knoten (R11).
- **Keine neue Abstraktion** für Zeit außer dem schon vorhandenen `schedule`/`cancel`-Muster; `AutoLock` ist eine Klasse mit vier Methoden, kein Event-Bus.
- **Sicherheit:** `vault:activity` hat keinen Payload und wird nur von registrierten Fenstern (Main-Frame) angenommen; `vault:locked` geht nur ans Hauptfenster und trägt nur `minutes`. Timeouts gehen durch Zod an der IPC-Grenze (`ConnectionNodeSchema` bei `connection:test`, `VaultSchema.parse` in `session.save`). Keine Geheimnisse in neuen Events. Die Sperre nullt den Schlüssel wie bisher (`session.ts:120`).
- **Risiko Schlafmodus:** Nach dem Aufwachen sperrt der nächste 30-s-Tick, wenn die Zeit abgelaufen ist; Sitzungen sind dann meist ohnehin tot (Keepalive). Gewollt.
- **Risiko Handover:** Während eines Fensterwechsels pausiert die Ausgabe (`session.ts:530`); ein Leerlauf-Ablauf genau in diesem Moment ist theoretisch möglich und harmlos (Leiste mit Neu verbinden im Zielfenster).
- **Risiko Katalog-Parität:** `app.json` wird von Task 1D gepflegt, `App.tsx` (Task 1F) nutzt `app:notices.autoLocked*`. Der Orphan-Test ist erst nach der ganzen Welle grün; die Spec fixiert die Key-Namen aus 3.8.

## 5. Stufe 1 gegenüber Extras

**Stufe 1 (dieser PR):** Datenmodell 3.1, `sshConnectConfig` mit Timeouts für alle vier Aufrufer, Leerlauf für SSH-Terminal/Container-Tab/Pod-Terminal/SFTP mit Grund `idle`, Auto-Sperre (Main-Timer, Aktivitäts-Pings, Rückkanal, Meldung, RDP-Guard), Einstellungsdialog (Vault + Verbindungen), Override im Verbindungsformular, Tests, Doku, 0.14.0.

**Extras (bewusst weggelassen):**

- Vorwarnung 60 s vor der Sperre als Meldung mit „Angemeldet bleiben“ (reine Renderer-Erweiterung über ein `vault:lock-soon`-Event).
- Platzhalter mit dem wirksamen globalen Wert in den Override-Feldern (`ConnectionForm` bräuchte ein `defaults`-Prop).
- Leerlauf-Warnzeile im Terminal; Keepalive „aus“; Sekunden statt Minuten.
- RDP-Eingabe-Hook im Helfer statt `powerMonitor`-Guard.
- Anzeige der Leerlauf-Restzeit in der Statusleiste.

## 6. Zerlegung in parallele Tasks

Welle 0 ist klein und legt den Vertrag, auf dem alle anderen typsicher aufsetzen; danach fünf Tasks auf getrennten Dateien.

| Welle | Task | Dateien (exklusiv) | Abhängigkeit |
|---|---|---|---|
| 0 | **0A Vertrag** | `src/shared/vault/types.ts`, `src/shared/vault/schema.ts`, neu `src/shared/vault/timeouts.ts` + `timeouts.test.ts`, `src/shared/connection-errors.ts`, `src/shared/ssh.ts` (Kommentar), `src/shared/ipc.ts`, `src/preload/index.ts` | – |
| 1 | **1B Main SSH/SFTP** | `src/main/ssh/client-config.ts`, neu `client-config.test.ts`, `src/main/ssh/session.ts`, `src/main/ssh/session.test.ts`, `src/main/ssh/ipc.ts`, `src/main/files/sftp-session.ts`, `sftp-session.test.ts`, `src/main/files/ipc.ts`, `src/main/containers/runner.ts`, `src/main/containers/ipc.ts`, `src/main/kubernetes/ipc.ts`, `src/main/connection-test.test.ts` | 0A |
| 1 | **1C Main Auto-Sperre** | neu `src/main/vault/auto-lock.ts` + `auto-lock.test.ts`, `src/main/index.ts`, `src/main/rdp/host.ts` (`hasConnected`) | 0A |
| 1 | **1D Einstellungen** | `src/renderer/src/components/SettingsDialog.tsx`, `src/renderer/src/settings-sections.ts` + `.test.ts`, `src/renderer/src/settings-ui.css`, `src/shared/locales/{de-DE,en-US}/app.json` (inkl. `notices.autoLocked*` für 1F) | 0A |
| 1 | **1E Verbindungsformular** | `src/renderer/src/connection-form.ts` + `.test.ts`, `src/renderer/src/components/ConnectionForm.tsx`, `src/shared/locales/{de-DE,en-US}/connection.json` | 0A |
| 1 | **1F Renderer Sperre und Grund** | `src/renderer/src/main.tsx`, neu `src/renderer/src/activity.ts` + `.test.ts`, `src/renderer/src/App.tsx`, `src/renderer/src/components/TerminalPanel.tsx`, `FilesPanel.tsx`, `DisconnectedBar.tsx`, `src/renderer/src/connection-error-text.ts` (+ `.test.ts`), `src/shared/locales/{de-DE,en-US}/terminal.json` | 0A; Keys aus 1D laut Spec |
| 2 | **2A Doku und Version** | `docs/handbuch.md`, `docs/manual.md`, `CHANGELOG.md`, `CHANGELOG.en.md`, `package.json`, `package-lock.json` | Welle 1 |

Gate nach jeder Welle: `npm run typecheck`, `npx vitest run`; nach Welle 2 run-app-Prüfung nach 3.10.

## 7. Rulings-Vorschläge

- **R1** Timeouts liegen in `vault.settings.timeouts` — sie beschreiben die Server und reisen mit dem Vault; Main liest sie wie `confirmBeforeClosingSession` — Kosten: pro Rechner abweichende Werte gibt es nicht.
- **R2** Defaults sind die heutigen Werte (0 / 15 s / 3 / 120 s), `timeouts` optional, kein Vault-Versionssprung — ein Upgrade ändert kein Verbindungsverhalten — Kosten: jede Leserstelle geht über `effectiveTimeouts`.
- **R3** `autoLockMinutes` bleibt mit gespeichertem Wert (15) in Kraft — Ledger: vorhandenes Feld nutzen — Kosten: bestehende Vaults sperren nach dem Update nach 15 min; Changelog und Dialog zeigen es, 0 schaltet ab.
- **R4** Leerlauf nur für Sitzungen mit ssh2-Client oder Pod-Stream; lokale Shells, RDP, Helfer-Verbindungen, Cluster-Sitzung und Tunnel sind ausgenommen — nur Netzressourcen werden frei — Kosten: eine ewige lokale PowerShell.
- **R5** SFTP gilt als beschäftigt bei laufendem Job, gebundenem Auto-Upload oder offener Bearbeitung und wird dann nicht getrennt — Ledger: Auto-Upload und Transfers sind kein Leerlauf — Kosten: eine Dateiansicht mit Bindung trennt sich nie durch Leerlauf.
- **R6** Keine Vorwarnung in Stufe 1 — Terminal-Einspielung stört Vollbildprogramme und zählt selbst als Ausgabe — Kosten: der Nutzer sieht die Trennung erst in der Leiste.
- **R7** Aktivität sind `keydown`, `pointerdown`, `pointermove`, `wheel` in jedem Shellherd-Fenster, höchstens ein Ping je 10 s und Fenster; Terminal-Ausgabe zählt nicht; Timer und Sperre laufen in Main — ein Ort, alle Fenster, auch bei hängendem Renderer — Kosten: zwei neue IPC-Kanäle.
- **R8** Bei verbundener RDP-Sitzung gilt zusätzlich `powerMonitor.getSystemIdleTime` — Eingaben im RDP-Control gehen am Renderer vorbei — Kosten: mit offenem RDP-Tab hält Arbeit in anderen Programmen den Vault offen.
- **R9** Die Auto-Sperre fragt nichts, ungespeicherte Formulareingaben gehen verloren — niemand ist da, der antworten könnte — Kosten: Datenverlust im Editor, dokumentiert.
- **R10** Grenzen: Leerlauf 0–1440 min, Keepalive 5–300 s (nicht abschaltbar), Fehlversuche 1–10, Verbindungs-Timeout 5–300 s — Zod an der Grenze, UI nennt die Spanne — Kosten: wer 3-s-Keepalive will, bekommt 5.
- **R11** Override nur an SSH- und SFTP-Knoten, teilweise erlaubt; Cluster und Container erben vom genutzten SSH-Knoten — eine Quelle je Host — Kosten: keine eigenen Werte für den Kube-Knoten.
- **R12** `connection-test.ts` bleibt unverändert mit eigenem Timer und `keepaliveInterval: 0`, plus Regressionsassertion — der Test muss im Host-Key-Dialog warten können — Kosten: keine.
- **R13** Zahlenfelder im Einstellungsdialog committen bei Blur/Enter — `persistVault` setzt `busy` und würde pro Tastendruck Fokus und Datei-Schreibvorgang kosten — Kosten: ein lokaler Entwurfszustand je Feld.
- **R14** Neuer `ConnectionErrorCode` `'idle'` nur mit Status `closed`, Texte in `terminal.json` — gleiche Leiste wie `closed-by-server` — Kosten: drei Karten-Strings, die nie erscheinen, halten den Typ und den Orphan-Test.
- **R15** Version 0.14.0 — neue Funktion — Kosten: keine.
