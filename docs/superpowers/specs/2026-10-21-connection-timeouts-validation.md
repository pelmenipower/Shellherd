# Verbindungs-Timeouts und Vault-Auto-Sperre – Validierung

Spec: `docs/superpowers/specs/2026-10-21-connection-timeouts-design.md`, Plan: `docs/superpowers/plans/2026-10-21-connection-timeouts.md`. Geprüft am 2026-10-21 gegen `claude/feature/connection-timeouts` (`e7b8955`, gestapelt auf `claude/feature/sftp-auto-upload`, PR #10). Ausgangslage: `npm run typecheck` grün, `npx vitest run` 124 Dateien und 1770 Tests grün.

**Dieser Anhang ist bindend und geht Spec und Plan vor.** Wo er schweigt, gilt die Spec. N1–N4 bleiben unverändert.

**Urteil: ready after corrections.** 3 Blocker, 22 Korrekturen, 14 offene Risiken.

Die Zeilenangaben der Spec stimmen bis auf K22 (Stichproben: `App.tsx:586-599`, `:284-306`, `:217-228`, `vault/ipc.ts:214-220`, `vault/session.ts:115-122`, `index.ts:52`, `:58-64`, `:118`, `:207`, `:263`, `client-config.ts:28-33`, `session.ts:192/230/286/431/452/470/486/551`, `sftp-session.ts:75/83/105/130`, `runner.ts:30/39`, `connection-test.ts:136`, `ConnectionForm.tsx:112/122/199-210`, `SettingsDialog.tsx:24-28/54-60`). Alle Aufrufer von `sshConnectConfig` (`ssh/session.ts:230`, `files/sftp-session.ts:83`, `containers/runner.ts:34`, `connection-test.ts:123`) und von `openRemoteHost` (`containers/ipc.ts:22`, `kubernetes/ipc.ts:36-37`, nur Tests sonst) sind erfasst.

---

## 1. Vertrag (exakt, Welle 0)

### 1.1 `src/shared/vault/types.ts`

```ts
/** Timeouts of SSH-backed sessions; see docs/superpowers/specs/2026-10-21-connection-timeouts-design.md. */
export interface ConnectionTimeouts {
  /** Minutes without input or output before the session is closed; 0 = never. */
  idleMinutes: number;
  /** Seconds between ssh2 keepalive probes. */
  keepaliveSeconds: number;
  /** Unanswered probes before the connection counts as dead. */
  keepaliveCount: number;
  /** Seconds the SSH handshake may take, including an open host-key prompt. */
  connectSeconds: number;
}
export interface VaultSettings {
  theme: 'dark' | 'light' | 'system';
  autoLockMinutes: number;
  confirmBeforeClosingSession: boolean;
  /** Absent in older vaults: DEFAULT_TIMEOUTS apply. */
  timeouts?: ConnectionTimeouts;
}
// SshConnectionNode and SftpConnectionNode each get:
  /** Per-connection override; absent keys fall back to the vault setting. */
  timeouts?: Partial<ConnectionTimeouts>;
```

### 1.2 `src/shared/vault/timeouts.ts` (neu)

```ts
import type { ConnectionNode, ConnectionTimeouts, VaultSettings } from './types';

/** Today's fixed values; idle 0 = never, so an upgrade changes no connection behaviour. */
export const DEFAULT_TIMEOUTS: ConnectionTimeouts = { idleMinutes: 0, keepaliveSeconds: 15, keepaliveCount: 3, connectSeconds: 120 };
export const TIMEOUT_LIMITS = {
  idleMinutes: [0, 1_440], keepaliveSeconds: [5, 300], keepaliveCount: [1, 10], connectSeconds: [5, 300],
} as const satisfies Record<keyof ConnectionTimeouts, readonly [number, number]>;
export const AUTO_LOCK_LIMITS = [0, 1_440] as const;

/** Defaults, then the vault setting, then the ssh/sftp connection's own keys; undefined keys never override, other protocols have no override. */
export function effectiveTimeouts(settings?: Pick<VaultSettings, 'timeouts'>, connection?: ConnectionNode): ConnectionTimeouts;

/** Trimmed decimal digits only (/^\d+$/) within [min, max] inclusive, else null ('' → null, '1.5' → null, '-1' → null). */
export function parseBounded(value: string, limits: readonly [number, number]): number | null;
```

`parseBounded` liegt hier und nicht in `settings-sections.ts`, weil Einstellungen (1D) und Verbindungsformular (1E) es parallel brauchen (Blocker B2).

### 1.3 `src/shared/vault/schema.ts`

```ts
export const ConnectionTimeoutsSchema = z.object({
  idleMinutes: z.number().int().min(TIMEOUT_LIMITS.idleMinutes[0]).max(TIMEOUT_LIMITS.idleMinutes[1]),
  keepaliveSeconds: z.number().int().min(TIMEOUT_LIMITS.keepaliveSeconds[0]).max(TIMEOUT_LIMITS.keepaliveSeconds[1]),
  keepaliveCount: z.number().int().min(TIMEOUT_LIMITS.keepaliveCount[0]).max(TIMEOUT_LIMITS.keepaliveCount[1]),
  connectSeconds: z.number().int().min(TIMEOUT_LIMITS.connectSeconds[0]).max(TIMEOUT_LIMITS.connectSeconds[1]),
}); // not .strict(), like AutoUploadBindingSchema
// VaultSettingsSchema: timeouts: ConnectionTimeoutsSchema.optional()
// SshConnectionNodeSchema and SftpConnectionNodeSchema: timeouts: ConnectionTimeoutsSchema.partial().optional()
```

`autoLockMinutes` bleibt `z.number().int().min(0).max(1_440)`. Kein Versionssprung.

### 1.4 `src/main/ssh/client-config.ts`

```ts
export async function sshConnectConfig(connection: SshConnectionNode | SftpConnectionNode,
  hostVerifier: (key: Buffer, callback: (valid: boolean) => void) => void,
  timeouts: ConnectionTimeouts = DEFAULT_TIMEOUTS): Promise<{ config: ConnectConfig; key?: Buffer }>;
// readyTimeout: timeouts.connectSeconds * 1000, keepaliveInterval: timeouts.keepaliveSeconds * 1000, keepaliveCountMax: timeouts.keepaliveCount
```

### 1.5 Fehlercode und Getrennt-Leiste

```ts
// src/shared/connection-errors.ts
export type ConnectionErrorCode = 'auth' | 'timeout' | 'hostkey-changed' | 'hostkey-rejected' | 'hostkey-store'
  | 'refused' | 'not-found' | 'key-file' | 'agent' | 'limit' | 'closed-by-server' | 'idle' | 'unknown';
// src/shared/ssh.ts:23 comment: "only with status 'error', or 'closed-by-server'/'idle' with status 'closed'."

// src/renderer/src/components/DisconnectedBar.tsx
export type DisconnectReason = 'server' | 'idle' | 'session' | 'cancel';
export interface DisconnectedBarProps { reason: DisconnectReason; … }
// data-instant only for 'session' and 'cancel'; 'server' and 'idle' animate.
```

### 1.6 IPC und Preload

```ts
// src/shared/ipc.ts, IPC_CHANNELS
vaultActivity: 'vault:activity',
vaultLocked: 'vault:locked',
export interface VaultLockedInfo { minutes: number }
// DesktopApi
vaultActivity: () => void;
onVaultLocked: (listener: (info: VaultLockedInfo) => void) => () => void;

// src/preload/index.ts
vaultActivity: () => ipcRenderer.send('vault:activity'),
onVaultLocked: listener => subscribe('vault:locked', listener),
```

### 1.7 Verträge der Welle 1 (je Task, hier fixiert)

```ts
// src/main/ssh/session.ts – SshDependencies
  /** Effective timeouts of a connection; default () => DEFAULT_TIMEOUTS. */
  getTimeouts?: (connection: ConnectionNode) => ConnectionTimeouts;
// Session: idleMs?: number; lastIo?: number; idleTimer?: ReturnType<typeof setTimeout>;

// src/main/files/sftp-session.ts – SftpDependencies
  getTimeouts?: (connection: ConnectionNode) => ConnectionTimeouts;
// Session: idleMs?: number; lastIo?: number; idleTimer?: ReturnType<typeof setTimeout>;

// src/main/containers/runner.ts
export async function openRemoteHost(connection: SshConnectionNode, verifyHost: VerifyHost,
  createClient = () => new Client(), timeouts: ConnectionTimeouts = DEFAULT_TIMEOUTS): Promise<RemoteHost>;

// src/main/vault/auto-lock.ts (neu)
export interface AutoLockDeps {
  /** 0 = off; read on every check, so a changed setting applies without restart. */
  minutes: () => number;
  lock: (minutes: number) => void;
  /** powerMonitor.getSystemIdleTime (seconds); only consulted while an RDP session is connected. */
  systemIdleSeconds: () => number;
  rdpConnected: () => boolean;
  now?: () => number;   // default Date.now
  tickMs?: number;      // default 30_000
}
export class AutoLock {
  constructor(deps: AutoLockDeps);
  /** Sets the timestamp to now and starts the interval; a second call is a no-op. */
  start(): void;
  /** O(1): lastActivity = now(). */
  touch(): void;
  /** Locks when minutes() > 0, now - lastActivity >= minutes * 60_000 and (no RDP connected or systemIdleSeconds() * 1000 >= minutes * 60_000); then lastActivity = now() before lock(minutes). */
  check(): void;
  dispose(): void;
}

// src/main/rdp/host.ts – RdpSessionManager
hasConnected(): boolean; // some session.status === 'connected'

// src/renderer/src/activity.ts (neu)
/** Capture listeners (passive) for keydown, pointerdown, pointermove and wheel; `send` runs on the first event and then at most once per `throttleMs`. Returns the remover. */
export function reportActivity(target: Window, send: () => void, throttleMs = 10_000, now: () => number = Date.now): () => void;

// src/renderer/src/hooks/usePersistVault.ts – PersistDeps
  /** Increases when the vault is locked; a save that settles under another epoch changes nothing. */
  epoch: () => number;
export function usePersistVault(vault: Vault | null,
  setters: Pick<PersistDeps, 'setVault' | 'setVaultPath' | 'setBusy' | 'setSaved' | 'epoch'>): (updatedVault: Vault, failureTitle?: string) => Promise<boolean>;

// src/renderer/src/settings-sections.ts
export const SETTINGS_SECTIONS = ['general', 'vault', 'connections', 'assistant'] as const;
export function withAutoLockMinutes(settings: VaultSettings, minutes: number): VaultSettings;
/** Stores the full object, based on effectiveTimeouts(settings). */
export function withTimeouts(settings: VaultSettings, patch: Partial<ConnectionTimeouts>): VaultSettings;

// src/renderer/src/connection-form.ts – ConnectionFields
  /** SSH/SFTP only; '' = default from the settings. */
  idleMinutes: string; keepaliveSeconds: string; keepaliveCount: string; connectSeconds: string;
```

---

## 2. Blocker

**B1 – Typecheck ist nach Welle 0 rot.** 0A erweitert `ConnectionErrorCode` um `'idle'`. `connection-error-text.ts:48` indiziert `KEYS[code]`; `KEYS` ist ein `as const`-Objekt ohne `idle` (es ist **nicht** als `Record<ConnectionErrorCode, …>` typisiert, wie die Spec in 3.3 behauptet). `tsc` meldet TS7053, und die Datei gehört in der Spec zu 1F. **Fix (K3):** `connection-error-text.ts` mit Test, `DisconnectedBar.tsx` und beide `terminal.json` wandern in 0A. Die neuen Keys werden dort sofort über `KEYS` und `REASON_KEYS` benutzt. So bleiben auch die Prüfungen auf Parität und verwaiste Keys grün.

**B2 – Abhängigkeit innerhalb von Welle 1.** `parseBounded` liegt laut Spec in `settings-sections.ts` (1D). `connection-form.ts` (1E) braucht es aber parallel. **Fix (K1):** `parseBounded` und die Grenzen kommen nach `src/shared/vault/timeouts.ts` (0A).

**B3 – Die Auto-Sperre während eines laufenden Speicherns holt den Vault in den Renderer zurück.** Die Spec schreibt in 3.4: „Ein laufendes `saveCurrentVault` wird nach der Sperre mit `core.vaultLocked` abgewiesen … nicht neu“. Das stimmt nicht.
- `VaultSessionManager.save` (`vault/session.ts:75-103`) holt die Sitzung vor dem ersten `await` und schreibt dann fertig.
- `persistVaultWith` (`hooks/usePersistVault.ts:26-32`) ruft danach `setVault(result.vault)`, im Fehlerfall `setVault(previousVault)` plus Fehlermeldung.

Kommt `vault:locked` vor der Antwort, zeigt das Hauptfenster danach wieder den entschlüsselten Vault mit allen Geheimnissen, obwohl Main gesperrt ist. Beim manuellen Sperren kann das nicht passieren, denn der Knopf ist bei `busy` gesperrt (`App.tsx:786`). Die Auto-Sperre wartet auf niemanden.

**Fix (K10, K11):** ein Sperr-Epoch. Ein Speichern, das unter einem anderen Epoch zurückkommt, setzt weder Vault noch Pfad noch Gespeichert-Status und meldet nichts.

---

## 3. Korrekturen (bindend)

**K1 – `src/shared/vault/timeouts.ts`, `timeouts.test.ts`.** Vertrag aus 1.2.
- `effectiveTimeouts` übernimmt aus `connection.timeouts` nur Keys mit `!== undefined` und nur bei `protocol === 'ssh' | 'sftp'`.
- Das Ergebnis ist immer ein neues Objekt; `DEFAULT_TIMEOUTS` wird nie mutiert.
- Tests:
  - Defaults entsprechen 0/15/3/120.
  - Teil-Override mit `undefined`-Keys.
  - Kube- und RDP-Knoten ignorieren Felder.
  - `parseBounded`: `''`, `' 15 '`, `'1.5'`, `'-1'`, `'1e3'`, Grenzen inklusive.
  - Schema: ohne `timeouts` gültig; `keepaliveSeconds: 4`, `connectSeconds: 301`, `idleMinutes: -1` und `1.5` werden abgelehnt; Teil-Override am SSH-Knoten gültig.

**K2 – `src/main/ssh/client-config.ts`, neu `client-config.test.ts`, in 0A.** Signatur aus 1.4; kein Aufrufer ändert sich in Welle 0, weil der Parameter einen Default hat. Test: Werte aus `timeouts` und Default ohne Argument, mit `authentication: { method: 'password' }`, damit kein Agent und keine Datei gebraucht wird.

**K3 – Fehlercode `idle` vollständig in 0A** (`connection-errors.ts`, `ssh.ts` Kommentar, `connection-error-text.ts` + Test, `DisconnectedBar.tsx`, `terminal.json` de/en).
- `KEYS` bekommt `idle: { title: 'terminal:connectionError.idle.title', body: 'terminal:connectionError.idle.body', next: 'terminal:connectionError.idle.next' }`.
- `KEYS` bleibt schlichtes `as const`. Kein `satisfies Record<…>`: die Excess-Property-Prüfung würde `bodyWithUser` und `bodyWithPort` ablehnen. Die Vollständigkeit erzwingt schon der Index `KEYS[code]` (`:48`).
- Im `switch` kommt `case 'idle':` direkt zu `case 'closed-by-server':` (gleiche Form, `primary: 'retry'`).
- `connection-error-text.test.ts:6` bekommt `'idle'` in die Liste der Codes.
- `DisconnectedBar`: `DisconnectReason` exportieren, `REASON_KEYS.idle = 'terminal:disconnected.reasons.idle'`, `data-instant={reason === 'server' || reason === 'idle' ? undefined : ''}`.

**K4 – Leerlauf im Terminal (`ssh/session.ts`), ohne Timer-Neustart pro Chunk.** Ausgabestürme liefern tausende Chunks pro Sekunde. Deshalb gilt das Zeitstempel-Muster statt `clearTimeout`/`setTimeout` je Chunk:
- In `connect()` liest der Code nach `getConnection` einmal `session.idleMs = (this.dependencies.getTimeouts ?? (() => DEFAULT_TIMEOUTS))(connection).idleMinutes * 60_000`. Das gilt für SSH (auch Container-Tab mit `target`) und für Kube-Pod-Terminals, nie für `startLocalShell`/`startLocalContainer`. Derselbe Aufruf liefert das `timeouts`-Argument für `sshConnectConfig`.
- Scharf schalten in `attachStream` und `startKubeTerminal` direkt nach `phase = 'connected'`: `armIdle(session)` setzt `lastIo = Date.now()` und stellt bei `idleMs > 0` einen `setTimeout(check, idleMs)`.
- `touchIdle(session)` heißt nur `session.lastIo = Date.now()`:
  - in `output()` direkt nach dem `active`/`length`-Guard (`:453`), vor dem Handover-Zweig;
  - in `input()` nach `if (!bytes) return;` (`:493`).
- `check`:
  - `!active` → Ende;
  - `elapsed = now - lastIo`; ist `elapsed >= idleMs` → `this.finish(session, 'closed', undefined, 'idle')`;
  - sonst neuer Timer über `idleMs - elapsed`.
- `finish()` ruft `clearTimeout(session.idleTimer)`.
- Keine neuen `schedule`/`cancel`/`now`-Dependencies. Tests nutzen `vi.useFakeTimers()`, das `setTimeout` und `Date` mitfälscht.
- `resize` zählt nicht als Aktivität.
- Der Wert gilt ab dem nächsten Verbinden. Eine geänderte Einstellung wirkt nicht auf offene Sitzungen (Handbuch, K18).

**K5 – Leerlauf in SFTP (`files/sftp-session.ts`).** Gleiches Muster wie K4.
- `idleMs` wird in `connect()` aus `getTimeouts(connection)` gelesen. Dasselbe Objekt geht als drittes Argument an `sshConnectConfig`.
- Scharf nach `session.status = 'connected'` (`:105`).
- `touchIdle` an diesen Stellen:
  - in `owned()`; das deckt jeden Aufruf aus dem Fenster ab: Listing, mkdir, rename, delete, chmod, createFile, Bearbeitungen, `transfer`, `syncStart`/`syncStop`/`syncForce`, `cancel`, `resolveConflict`, `state` bei der Übernahme;
  - im `finally` von `pump()`, damit nach einem langen Transfer wieder die volle Leerlaufzeit gilt.
- „Beschäftigt“ gilt bei Ablauf, wenn mindestens eines davon zutrifft:
  - `session.running`;
  - ein Job mit `state === 'queued'` in `session.jobs`;
  - `session.syncs?.list().some(s => s.state !== 'error')`; eine Bindung im Zustand `error` lädt nicht und hält die Sitzung nicht offen;
  - `(session.edits?.list().length ?? 0) > 0`.
  - Dann `touchIdle` und ein neuer Timer über die volle Zeit `idleMs`. Sonst `finish(session, 'closed', undefined, 'idle')`.
- `finish()` löscht `idleTimer` als Erstes.

**K6 – SFTP wird eigene Task 1G.** Die Spec-Task 1B hat zwölf Dateien. SSH (1B) und SFTP (1G) sind nach K2 unabhängig.

**K7 – `src/main/vault/auto-lock.ts`, Vertrag aus 1.7.**
- `start()` nutzt `setInterval(() => this.check(), tickMs)`, `dispose()` nutzt `clearInterval`. Keine `schedule`/`cancel`-Injektion; Tests rufen `check()` mit injiziertem `now` oder nutzen Fake-Timer.
- Tests:
  - sperrt nach X min, nicht davor;
  - `touch` setzt zurück;
  - 0 sperrt nie;
  - `minutes` wird je `check` neu gelesen;
  - RDP: DOM-Leerlauf plus System nicht leer → keine Sperre; beide leer → Sperre;
  - nach `lock` kein zweites `lock` im nächsten `check`, solange `minutes()` 0 liefert;
  - `dispose` stoppt das Intervall.

**K8 – Verdrahtung in `src/main/index.ts` (wörtlich im Ablauf).**
- Auf Modulebene: `let autoLock: AutoLock | undefined;`.
- In `whenReady` nach `registerVaultIpcHandlers`:

  ```ts
  const lockNow = (): void => { closeAllSessions(); closeSecondaryWindows(); vaultSessionManager.lock(); };
  autoLock = new AutoLock({
    minutes: () => vaultSessionManager.isUnlocked() ? vaultSessionManager.getSnapshot().vault.settings.autoLockMinutes : 0,
    lock: minutes => {
      lockNow();
      const main = windowRegistry.main();
      if (main && !main.isDestroyed()) main.webContents.send(IPC_CHANNELS.vaultLocked, { minutes } satisfies VaultLockedInfo);
    },
    systemIdleSeconds: () => powerMonitor.getSystemIdleTime(),
    rdpConnected: () => rdpSessionManager.hasConnected(),
  });
  autoLock.start();
  powerMonitor.on('resume', () => autoLock?.check());
  ipcMain.on(IPC_CHANNELS.vaultActivity, event => {
    if (windowRegistry.roleOf(event.sender.id) && event.senderFrame === event.sender.mainFrame) autoLock?.touch();
  });
  ```
- `onSessionChange` wird zu `() => { closeAllSessions(); closeSecondaryWindows(); autoLock?.touch(); }`. `registerVaultIpcHandlers` steht vor `new AutoLock`, deshalb `autoLock?.`.
- `will-quit`: `autoLock?.dispose();`.
- Der Handler für `vault:activity` liest keinen Payload, klont keinen Vault, wirft nicht und antwortet nicht. Eine Flut kostet O(1) je Nachricht.
- Der Sperrweg ist identisch zum manuellen (`vault/ipc.ts:216-218`): Sitzungen schließen, Nebenfenster schließen, Schlüssel nullen (`session.ts:120`). Neu ist nur der Rückkanal.

**K9 – `src/main/rdp/host.ts`, `host.test.ts`.** `hasConnected(): boolean { return [...this.sessions.values()].some(session => session.status === 'connected'); }` neben `hasOwner` (`:142`). Der RDP-Zustand liegt in `Session.status` und wird bei `loginComplete` auf `'connected'` gesetzt (`:233`). Ein Test: `false` ohne Sitzung, `true` nach dem Status `loginComplete`.

**K10 – `src/renderer/src/hooks/usePersistVault.ts` + Test (B3).**
- `persistVaultWith` merkt sich `const epoch = deps.epoch()` vor `await deps.save(…)`.
- Nach dem `await`, im Erfolg wie im `catch`: Ist `deps.epoch() !== epoch`, dann `return false` ohne `setVault`, `setVaultPath`, `setSaved` und ohne `notify`.
- Das `finally` setzt `inProgress` und `busy` weiter zurück.
- `usePersistVault` reicht `epoch` aus den Setters durch.
- Tests: Ein Speichern, das nach einem Epoch-Wechsel erfolgreich oder fehlerhaft endet, ruft weder `setVault` noch `notify`.

**K11 – `src/renderer/src/App.tsx`: ein Sperrabschluss für beide Wege, Hinweis auf der Startkarte statt Meldung.** Eine Info-Meldung verschwindet nach `--notice-ttl-info` (5 s, `toast-ui.css:18`, `Toast.tsx:55`). Bei der Auto-Sperre ist niemand da, die Meldung wäre weg, bevor jemand zurückkommt. Deshalb entfällt die Meldung aus Spec 3.4/3.8 (`app:notices.autoLocked*`).
- `const lockEpoch = useRef(0);` und `usePersistVault(vault, { setVault, setVaultPath, setBusy, setSaved, epoch: () => lockEpoch.current })`.
- `afterLock()` ersetzt das `finally` in `lockVault()`:

  ```ts
  function afterLock(): void {
    lockEpoch.current += 1;
    setVault(null); setVaultPath(null); resetForm(); setScreen('home'); setAppDialog(null);
    settingsReturnFocus.current = null; setPendingVaultFile(null); setBusy(false);
  }
  ```
  `lockVault()` bleibt sonst gleich: `setBusy(true)`, `await window.desktopApi.lockVault()`, `finally afterLock()`.
- Neuer State `const [autoLockedAfter, setAutoLockedAfter] = useState<number | null>(null);`. `resetForm()` setzt ihn auf `null`.
- Effekt einmalig, Ref-Muster wie `openVaultFileRef`:

  ```ts
  const afterLockRef = useRef(afterLock); afterLockRef.current = afterLock;
  useEffect(() => window.desktopApi.onVaultLocked(({ minutes }) => { afterLockRef.current(); setAutoLockedAfter(minutes); }), []);
  ```
- Auf der Startkarte (`screen === 'home'`) direkt nach `<p className="subtitle">…</p>`: `{autoLockedAfter !== null && <p className="subtitle" role="status">{t('app:home.autoLocked', { count: autoLockedAfter })}</p>}`. Kein neues CSS, keine Bewegung.
- `pendingVaultFile` wird geleert, weil sein Dialog sonst nach dem nächsten Entsperren wieder aufgeht.
- `onVaultLocked` wird nur in `App.tsx` abonniert, nie in `SecondaryWindow.tsx`.

**K12 – Einstellungsdialog `SettingsDialog.tsx`.**
- Internes Zahlenfeld je Wert:
  - `<label htmlFor>` mit Label-Text, `input`, `<span id>` mit Einheit;
  - `input` mit `type="text"` (wie `port` im Verbindungsformular, kein Spinner), `inputMode="numeric"`, `autoComplete="off"`, `spellCheck={false}`;
  - `aria-describedby` zeigt auf Einheit, Hint und gegebenenfalls Fehler.
- Lokaler Entwurf (`useState(String(value))`), Abgleich mit `useEffect(() => setDraft(String(value)), [value])`, damit Rollback und Neuladen den Entwurf richtigstellen.
- Commit bei `onBlur` und bei `Enter` (`onKeyDown`, `preventDefault`):
  - `parseBounded(draft, limits)`;
  - `null` → `.field-error` unter der Zeile mit `id`, `role="alert"`, `aria-invalid` am Feld, Text `t('app:settings.rangeError', { min, max })`, kein Save;
  - Wert gleich gespeichertem Wert → kein Save und Fehler weg;
  - sonst `onSaveSettings(withAutoLockMinutes(…))` bzw. `onSaveSettings(withTimeouts(vault.settings, { [key]: n }))`.
- **Die Zahlenfelder sind bei `busy` `readOnly`, nicht `disabled`.** Mit `disabled` verliert beim Tab von Feld zu Feld das nächste Feld den Fokus, sobald der Blur-Commit `busy` setzt. Das ist das R13-Problem in neuer Form.
- Abschnitt `vault`: unter dem bestehenden Hint die Zeile `autoLock` mit `AUTO_LOCK_LIMITS` und eigenem Hint `app:settings.autoLock.hint`.
- Abschnitt `connections` mit vier Zeilen und Grenzen aus `TIMEOUT_LIMITS`:
  - `idle` → `idleMinutes`;
  - `keepalive` → `keepaliveSeconds`;
  - `keepaliveCount` → `keepaliveCount`;
  - `connect` → `connectSeconds`.

  Darunter `app:settings.timeouts.hint`. Angezeigt wird `effectiveTimeouts(vault.settings)`.
- `sectionTitle` bekommt `connections: t('app:settings.sections.connections')`. Der Abschnitt erscheint nur mit Vault (`settingsSections`).
- `settings-sections.test.ts`:
  - neue Reihenfolge `['general', 'vault', 'connections', 'assistant']`;
  - `withAutoLockMinutes` ändert nur das Feld;
  - `withTimeouts` auf Vault ohne `timeouts` → volles Objekt mit Defaults plus Patch;
  - `withTimeouts` auf vorhandenem Objekt → nur der Patch-Key ändert sich.

**K13 – `width: 6ch` ist ein harter Wert und zu schmal.**
- Nach `docs/design-system.md` („Erlaubte Literale …“) und `CLAUDE.md` („Fehlt ein Wert, kommt er zuerst als Token“) ist `6ch` nicht erlaubt. Der Lint (R14/R16) prüft `width` zwar nicht, das macht den Wert aber nicht zulässig.
- Mit `box-sizing: border-box` (`styles.css:6`) und `padding: var(--space-8)` (`styles.css:15`) blieben rund 2–3 Ziffern sichtbar; „1440“ passt nicht.
- **Fix:** neuer Token in `src/renderer/src/tokens.css` im Block nach `--toast-text-min`:

  ```css
  /* Short number inputs (settings): four digits plus padding and border */
  --input-number: calc(6ch + 2 * var(--space-8) + 2px);
  ```
- `settings-ui.css`:

  ```css
  .settings-number { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-8); color: var(--color-text); font-size: var(--fs-md); }
  .settings-number input { flex: 0 0 auto; width: var(--input-number); }
  .settings-number .field-error { flex-basis: 100%; margin: 0; }
  ```
- `docs/design-system.md`: eine Zeile in der Tabelle „Statuspunkt und Meldungsdauer“ mit `--input-number` | Breite kurzer Zahlenfelder in den Einstellungen | `calc(6ch + 2 * var(--space-8) + 2px)` | `.settings-number input`.
- Keine Bewegung.

**K14 – `ConnectionForm.tsx`.**
- In `<details>` „Weitere Angaben“ nach `color`, nur bei `sshAuth`, zwei Zeilen mit der vorhandenen Klasse `editor-auth-row` (zwei gleiche Spalten, schmal einspaltig, `editor-ui.css:20/42`):
  - `[idleMinutes, connectSeconds]`;
  - `[keepaliveSeconds, keepaliveCount]`.
- **Nicht** `editor-host-row`: deren Spalten sind `1fr 84px`, vier Felder würden ungleich umbrechen.
- Darunter `<p className="editor-hint">{t('connection:form.timeouts.hint')}</p>`.
- `inputMode="numeric"` für `port` und die vier Felder: `const NUMERIC_FIELDS = new Set<ConnectionTextField>(['port', 'idleMinutes', 'keepaliveSeconds', 'keepaliveCount', 'connectSeconds'])`.
- Die Öffnen-Bedingung `:112` umfasst `color`, `workingDirectory` und die vier Felder.
- Kein neues CSS.

**K15 – `connection-form.ts` + Test.**
- `fieldsFromConnection`: bei ssh/sftp `String(connection.timeouts?.x ?? '')`, sonst `''`.
- `connectionFromFields`, nur im Zweig ssh/sftp:
  - je Feld getrimmt; leer → kein Key;
  - sonst `parseBounded(value, TIMEOUT_LIMITS[key])`, bei `null` `throw new ConnectionFieldError(key, t('connection:validation.timeoutRange', { min, max }))`;
  - `timeouts` nur anhängen, wenn mindestens ein Key gesetzt ist.
- `keepAutoUpload` bleibt unverändert. Die Override-Felder gehen beim Speichern nicht verloren:
  - Das Formular trägt sie als Felder.
  - `saveAutoUpload` (`App.tsx:489-494`) und `toggleDisabled`/`renameNode` spreizen den Knoten und behalten `timeouts`.
  - `ConnectionNodeSchema.safeParse` (`:159`) behält den Key, weil 0A ihn ins Schema aufnimmt. Ohne das würde Zod ihn still entfernen.
- Tests:
  - Round-Trip aller vier Felder;
  - alle leer → kein `timeouts`-Key;
  - Teil-Override bleibt Teil;
  - `'4'` bei `keepaliveSeconds` → `ConnectionFieldError` mit `field === 'keepaliveSeconds'`;
  - RDP ignoriert die Felder;
  - `keepAutoUpload` behält `autoUpload` und die neuen `timeouts` aus dem Formular;
  - der Fixture-Literal `fields` (`connection-form.test.ts:7`) bekommt die vier Felder als `''`.

**K16 – i18n-Keys (wörtlich; de-DE / en-US; volle Literale, keine Zusammensetzung).**

`terminal.json` (0A):

| Key | de-DE | en-US |
|---|---|---|
| `disconnected.reasons.idle` | wegen Leerlauf | idle timeout |
| `connectionError.idle.title` | Wegen Leerlauf getrennt | Disconnected while idle |
| `connectionError.idle.body` | Shellherd hat die Verbindung nach der eingestellten Leerlaufzeit beendet. | Shellherd ended the connection after the configured idle time. |
| `connectionError.idle.next` | Verbinde neu oder passe die Leerlauf-Trennung in den Einstellungen an. | Reconnect or change the idle disconnect in the settings. |

`app.json` (1D):

| Key | de-DE | en-US |
|---|---|---|
| `settings.sections.connections` | Verbindungen | Connections |
| `settings.autoLock.label` | Automatisch sperren nach | Lock automatically after |
| `settings.autoLock.unit` | Minuten ohne Eingabe (0: nie) | minutes without input (0: never) |
| `settings.autoLock.hint` | Trennt alle Sitzungen und sperrt den Vault, wenn in keinem Shellherd-Fenster Maus oder Tastatur benutzt wurde. Ungespeicherte Eingaben gehen dabei verloren. | Disconnects all sessions and locks the vault when neither mouse nor keyboard was used in any Shellherd window. Unsaved input is lost. |
| `settings.timeouts.idle.label` | Leerlauf-Trennung nach | Disconnect when idle after |
| `settings.timeouts.idle.unit` | Minuten ohne Ein- und Ausgabe (0: nie) | minutes without input or output (0: never) |
| `settings.timeouts.keepalive.label` | Keepalive alle | Keepalive every |
| `settings.timeouts.keepalive.unit` | Sekunden | seconds |
| `settings.timeouts.keepaliveCount.label` | Trennen nach | Disconnect after |
| `settings.timeouts.keepaliveCount.unit` | unbeantworteten Keepalives | unanswered keepalives |
| `settings.timeouts.connect.label` | Verbindungs-Timeout | Connection timeout |
| `settings.timeouts.connect.unit` | Sekunden | seconds |
| `settings.timeouts.hint` | Gilt für neue SSH- und SFTP-Verbindungen dieses Vaults, auch für Container- und Cluster-Zugriffe über SSH. Der Verbindungs-Timeout läuft auch, solange die Rückfrage zum Host-Schlüssel offen ist. Einzelne Verbindungen können unter „Weitere Angaben“ abweichen. | Applies to new SSH and SFTP connections of this vault, including container and cluster access over SSH. The connection timeout keeps running while the host key prompt is open. Single connections can differ under “More options”. |
| `settings.rangeError` | Gib eine ganze Zahl von {{min}} bis {{max}} ein. | Enter a whole number from {{min}} to {{max}}. |
| `home.autoLocked_one` | Automatisch gesperrt nach {{count}} Minute ohne Eingabe. Alle Sitzungen wurden getrennt. | Locked automatically after {{count}} minute without input. All sessions were disconnected. |
| `home.autoLocked_other` | Automatisch gesperrt nach {{count}} Minuten ohne Eingabe. Alle Sitzungen wurden getrennt. | Locked automatically after {{count}} minutes without input. All sessions were disconnected. |

`connection.json` (1E):

| Key | de-DE | en-US |
|---|---|---|
| `form.fields.idleMinutes` | Leerlauf-Trennung (min) | Idle disconnect (min) |
| `form.fields.keepaliveSeconds` | Keepalive (s) | Keepalive (s) |
| `form.fields.keepaliveCount` | Keepalive-Fehlversuche | Keepalive misses |
| `form.fields.connectSeconds` | Verbindungs-Timeout (s) | Connection timeout (s) |
| `form.timeouts.hint` | Leer: Vorgabe aus den Einstellungen. | Empty: default from the settings. |
| `validation.timeoutRange` | Gib eine ganze Zahl von {{min}} bis {{max}} ein oder lass das Feld leer. | Enter a whole number from {{min}} to {{max}} or leave the field empty. |

- `app:notices.autoLockedTitle`/`autoLockedBody` aus Spec 3.8 entfallen (K11).
- Der Pluralfall braucht `count`, sonst steht „1 Minuten“.
- `max`/`count` laufen durch `formatNumber` (`i18n.ts:9`): „1.440“ in de-DE ist gewollt.

**K17 – Motion-Gate (`docs/design-system.md`, 1D).** Die Zeile „Getrennt-Leiste (`.connect-closed`)“ heißt in der Spalte Entscheidung: „animieren bei Server- und Leerlauf-Trennung, sofort nach Abbrechen/Esc (`data-instant`)“. Keine neue Regel, keine neue Bewegung. Startkarten-Hinweis, Zahlenfelder und Formularzeilen bewegen sich nicht.

**K18 – Doku und Changelog (2A), Pflichtsätze.**
- Handbuch und Manual:
  - Auto-Sperre misst nur Maus und Tastatur in Shellherd-Fenstern; Terminal-Ausgabe zählt nicht.
  - Mit verbundener RDP-Sitzung zählt jede Eingabe am Rechner.
  - Ungespeicherte Formulareingaben gehen verloren.
  - Nach der Sperre zeigt die Startkarte den Grund.
  - Leerlauf und Keepalive gelten ab dem nächsten Verbinden.
  - Der Verbindungs-Timeout läuft auch während der Host-Key-Rückfrage; wer einen kurzen Wert einstellt, nimmt neue Host-Schlüssel über `Verbindung testen` an.
  - Eine Dateiansicht mit laufendem Transfer, aktivem Auto-Upload oder offener Bearbeitung trennt sich nicht durch Leerlauf.
  - Lokale Shells, RDP und Cluster-Ansichten haben keinen Leerlauf.
- CHANGELOG de/en `## [0.14.0] – 2026-10-21` mit dem Satz aus S3: bestehende Vaults sperren ab jetzt nach 15 Minuten ohne Eingabe, 0 schaltet ab.
- Weitere CHANGELOG-Hinweise: Ein älteres Shellherd entfernt `timeouts` beim Speichern, wie beim Auto-Upload.
- `npm run version:minor` → 0.14.0.

**K19 – `connection-test.ts` bleibt Byte für Byte unverändert (R12).** 1B ergänzt in `connection-test.test.ts` eine Assertion: `connect` wird mit `readyTimeout: 120_000` und `keepaliveInterval: 0` aufgerufen, auch wenn der Knoten `timeouts: { connectSeconds: 5, keepaliveSeconds: 5 }` trägt.

**K20 – Aufrufer der Timeouts (1B).**
- `ssh/ipc.ts`: `getTimeouts: connection => effectiveTimeouts(vaultSessionManager.getSnapshot().vault.settings, connection)`.
- `containers/ipc.ts:22` und `kubernetes/ipc.ts:36-37`: `openRemoteHost(connection, verify, undefined, effectiveTimeouts(vaultSessionManager.getSnapshot().vault.settings, connection))`.
- `runner.ts` gibt `timeouts` an `sshConnectConfig` weiter.
- Der Kommentar `runner.ts:39` bleibt und bekommt den Zusatz: „The user's connect timeout spans the prompt too.“
- `files/ipc.ts` (1G) verdrahtet `getTimeouts` gleich.

**K21 – Tests, die die Spec-Tabelle 3.9 nicht nennt.**
- `src/main/ssh/local-shell.test.ts` (1B): keine Trennung nach Ablauf mit `getTimeouts` → `idleMinutes: 1` und Fake-Timern.
- `src/main/ssh/session.test.ts` (1B):
  - nach `connected` und 60 s ohne I/O `status closed, code 'idle'`;
  - Ausgabe nach 59 s verlängert;
  - `idleMinutes: 0` stellt keinen Timer;
  - nach `close()` feuert nichts mehr (kein Leck): `vi.getTimerCount()` vor und nach.
- `src/main/files/sftp-session.test.ts` (1G):
  - Ablauf bei `running`, gebundener Sync (`watching`) und offener Bearbeitung stellt neu;
  - Sync in `error` trennt;
  - ohne alles `closed`/`idle`;
  - kein Timer nach `finish`.
- `src/main/rdp/host.test.ts` (1C).
- `src/renderer/src/hooks/usePersistVault.test.ts` (1F).
- `src/renderer/src/activity.test.ts` (1F):
  - erstes Ereignis sendet sofort;
  - zweites innerhalb von 10 s nicht, nach 10 s wieder;
  - der Remover entfernt alle vier Listener; ein Fake-Target mit `addEventListener`/`removeEventListener` genügt.

**K22 – Kleinere Fakten in der Spec.**
- `docs/manual.md` „### Vault“ steht in Zeile 86, nicht 72–92.
- `kubernetes/ipc.ts` 36–37.
- `KEYS` in `connection-error-text.ts` ist nicht `Record`-typisiert (siehe B1).
- Der Satz in 3.4 zum laufenden Speichern ist falsch (B3).
- Die Aktivitätspings vor dem Entsperren sind nicht „wirkungslos“, sie setzen nur einen Zeitstempel, der beim Entsperren ohnehin neu gesetzt wird. Harmlos.

---

## 4. Wellen (endgültig)

Gate nach jeder Welle: `npm run typecheck` und `npx vitest run` grün, danach ein Commit pro Task. Umsetzer fassen nur ihre Dateien an, committen nie. Jede Datei, auch jede Locale-Datei, gehört je Welle genau einer Task.

| Welle | Task | Dateien (exklusiv) | Pflichtpunkte |
|---|---|---|---|
| 0 | **0A Vertrag** | `src/shared/vault/types.ts`, `src/shared/vault/schema.ts`, neu `src/shared/vault/timeouts.ts` + `timeouts.test.ts`, `src/main/ssh/client-config.ts`, neu `src/main/ssh/client-config.test.ts`, `src/shared/connection-errors.ts`, `src/shared/ssh.ts` (Kommentar), `src/shared/ipc.ts`, `src/preload/index.ts`, `src/renderer/src/connection-error-text.ts` + `.test.ts`, `src/renderer/src/components/DisconnectedBar.tsx`, `src/shared/locales/de-DE/terminal.json`, `src/shared/locales/en-US/terminal.json` | 1.1–1.6, K1, K2, K3, Terminal-Keys aus K16. Nach der Welle grün: Kein Aufrufer muss sich ändern, alle neuen Keys sind benutzt. |
| 1 | **1B Main SSH** | `src/main/ssh/session.ts`, `src/main/ssh/session.test.ts`, `src/main/ssh/local-shell.test.ts`, `src/main/ssh/ipc.ts`, `src/main/containers/runner.ts`, `src/main/containers/runner.test.ts`, `src/main/containers/ipc.ts`, `src/main/kubernetes/ipc.ts`, `src/main/connection-test.test.ts` | K4, K19, K20 (ohne `files/ipc.ts`), K21 SSH-Teil |
| 1 | **1G Main SFTP** | `src/main/files/sftp-session.ts`, `src/main/files/sftp-session.test.ts`, `src/main/files/ipc.ts` | K5, K20 SFTP-Teil, K21 SFTP-Teil |
| 1 | **1C Main Auto-Sperre** | neu `src/main/vault/auto-lock.ts` + `auto-lock.test.ts`, `src/main/index.ts`, `src/main/rdp/host.ts`, `src/main/rdp/host.test.ts` | K7, K8, K9 |
| 1 | **1D Einstellungen** | `src/renderer/src/components/SettingsDialog.tsx`, `src/renderer/src/settings-sections.ts` + `.test.ts`, `src/renderer/src/settings-ui.css`, `src/renderer/src/tokens.css`, `docs/design-system.md`, `src/shared/locales/de-DE/app.json`, `src/shared/locales/en-US/app.json` | K12, K13, K17, App-Keys aus K16 **einschließlich `home.autoLocked_one/_other` für 1F** |
| 1 | **1E Verbindungsformular** | `src/renderer/src/connection-form.ts` + `.test.ts`, `src/renderer/src/components/ConnectionForm.tsx`, `src/shared/locales/de-DE/connection.json`, `src/shared/locales/en-US/connection.json` | K14, K15, Connection-Keys aus K16 |
| 1 | **1F Renderer Sperre und Grund** | `src/renderer/src/main.tsx`, neu `src/renderer/src/activity.ts` + `.test.ts`, `src/renderer/src/App.tsx`, `src/renderer/src/hooks/usePersistVault.ts` + `.test.ts`, `src/renderer/src/components/TerminalPanel.tsx`, `src/renderer/src/components/FilesPanel.tsx` | K10, K11, K21 Renderer-Teil. Außerdem:<br>• `main.tsx` ruft vor `createRoot` einmal `reportActivity(window, () => window.desktopApi.vaultActivity())` für beide Fensterrollen.<br>• `TerminalPanel.tsx:43` nutzt `reason: DisconnectReason`, `:151` setzt `event.code === 'idle' ? 'idle'`.<br>• `FilesPanel.tsx:322` macht dasselbe.<br>• Bekannte Abhängigkeit: `t('app:home.autoLocked', …)` kompiliert erst, wenn 1D fertig ist. Das ist erwartet und erst am Wellenende grün. |
| 2 | **2A Doku und Version** | `docs/handbuch.md`, `docs/manual.md`, `CHANGELOG.md`, `CHANGELOG.en.md`, `package.json`, `package-lock.json` | K18, S3, `npm run version:minor` |

Die einzige Abhängigkeit innerhalb einer Welle ist 1F → 1D (ein Key). Sonst gibt es keine Kreuzabhängigkeiten. Nach Welle 2 gilt die Abnahme nach Spec 3.10. Zusätzlich:
- Schritt 2: Die Startkarte zeigt den Hinweis auch noch nach über 10 s (K11).
- Schritt 4: Speichern in den Einstellungen und sofort per Tab ins nächste Zahlenfeld; der Fokus bleibt im Feld (K12).

---

## 5. Offene Risiken (akzeptiert, im Review nicht erneut aufzuwerfen)

1. **Native Dialoge zählen nicht als Aktivität.** Host-Key-Rückfrage, Dateiauswahl und Schließen-Bestätigung erzeugen keine DOM-Ereignisse. Bei sehr kurzer Sperrzeit kann die Sperre einen offenen Host-Key-Dialog überholen. Die Sitzung ist dann weg, `isActive()` liefert false, und der Schlüssel wird nicht gespeichert (`known-hosts.ts:57,72`).
2. **Wer nur Ausgabe liest, wird gesperrt** (N3, Terminal-Ausgabe zählt nicht). Das steht im Handbuch.
3. **RDP-Guard (R8):** Mit verbundener RDP-Sitzung hält jede Eingabe am Rechner den Vault offen, auch in anderen Programmen. `powerMonitor.getSystemIdleTime()` liefert Sekunden und wird erst nach `app.whenReady` aufgerufen. Das ist korrekt.
4. **Unschärfe der Sperrzeit:**
   - bis zu 10 s früher, weil der Throttle die erste Eingabe meldet und spätere schluckt;
   - bis zu 30 s später durch den Tick;
   - nach dem Aufwachen sofort, über `powerMonitor` `resume`.
5. **Kurzer Verbindungs-Timeout mit Host-Key-Rückfrage:** ssh2s `readyTimeout` läuft im Dialog weiter. Bei 5 s scheitert das Annehmen eines neuen Schlüssels, wenn man länger liest. Ausweg: `Verbindung testen` (eigener, pausierter Timer, R12) oder ein größerer Wert; Hint und Handbuch sagen es.
6. **Downgrade:** Ein älteres Shellherd entfernt `timeouts` beim Speichern (Zod-Strip, wie bei `autoUpload`).
7. **Leerlauf und Keepalive wirken erst beim nächsten Verbinden**, Auto-Sperre sofort (`minutes()` je Tick).
8. **Entsperren gegen Tick:** Zwischen `vaultSessionManager.unlock` und `onSessionChange` (`vault/ipc.ts:176-182`, ein `await lastVault.set`) könnte ein Tick mit altem Zeitstempel sperren. Praktisch ausgeschlossen, weil die Passworteingabe Sekunden vorher einen Ping auslöst.
9. **Handover:** Läuft der Leerlauf genau während eines Fensterwechsels ab, geht die Leiste an das Zielfenster. Dessen `attach` kann `ssh.notAvailable` bekommen. Harmlos.
10. **Speichern, das nach der Sperre fertig wird:** Die Datei ist geschrieben, der Renderer zeigt nichts (K10). Daten gehen nicht verloren.
11. **Einstellungsdialog:** Ein Klick auf `Schließen` direkt nach einer Eingabe löst erst den Blur-Commit aus. Der Knopf ist dann für die Dauer des Speicherns `disabled`, also braucht es eventuell einen zweiten Klick. Esc verwirft einen nicht bestätigten Entwurf.
12. **Screenshot `settings`:** Der Dialog wird höher; `max-height` mit Scrollen kann den unteren Abschnitt abschneiden. Im Review ansehen, kein Blocker.
13. **SFTP mit aktiver Auto-Upload-Bindung** trennt sich nie durch Leerlauf (R5).
14. **Nebenfenster mit offenem nativen Dialog:** `closeSecondaryWindows()` schließt das Fenster, der modale Dialog kann bis zur Antwort stehen bleiben. Die Antwort wirkt nicht mehr (Risiko 1).
