# Sperrbildschirm und Willkommens-Tab – Validierung (Stufe 3)

Spec: `docs/superpowers/specs/2026-10-21-lock-screen-design.md`. Plan: `docs/superpowers/plans/2026-10-21-lock-screen.md`. Geprüft wurde gegen den Stand `b719691` auf `claude/feature/lock-screen`. Die Basis ist grün: `npm run typecheck`, `npx vitest run` mit 128 Dateien und 1815 Tests.

**Dieser Anhang ist bindend und geht Spec und Plan vor.** Die Nutzer-Entscheidungen N1–N4 und die Spec-Rulings S1–S4 gelten unverändert. Wo Spec-Rulings R1–R16 hier präzisiert werden, gilt die Fassung dieses Anhangs.

**Urteil: ready after corrections.** Es gibt 4 Blocker und 14 Korrekturen.

Stichproben der Zeilenangaben, alle zutreffend:
- `index.ts:55,61-67,121,151,245-257,266-282`
- `vault/ipc.ts:160-189,214-220`
- `session.ts:115-131`
- `files/ipc.ts:62-69`
- `window-ipc.ts:24,81,132,144,206`
- `App.tsx:125,171-175,271-278,354-357,391-394,591-614,777,801-825,859-870`
- `SplitTerminalArea.tsx:206-212,352-355,387-399,403-425`
- `terminal-tabs.ts:53,62-65,109-114,132-137`
- `terminal-layout.ts:160-161`
- `useTabTransfer.ts:48-67`
- `ConnectionForm.tsx:66`
- `ConfirmDialog.tsx:37-40`
- `native-surface.ts:10-16`
- `RdpPanel.tsx:40-41,121`
- `styles.css:83,104`
- `terminal-ui.css:28`

Die Zahl der `showModal`-Komponenten (11) stimmt ebenfalls.

---

## 1. Vertrag

Alle Signaturen sind wörtlich zu übernehmen. Kommentare stehen auf Englisch.

### 1.1 `src/main/vault/session.ts`

```ts
export interface LockedVault { filePath: string; vaultId: string }

// in VaultSessionManager
private locked: LockedVault | undefined;

/** File and vault ID locked last, until the next successful unlock; only the same vault resumes its sessions. */
public lockedVault(): LockedVault | undefined { return this.locked; }

public lock(): void {
  if (!this.activeSession) return;
  this.locked = { filePath: this.activeSession.filePath, vaultId: this.activeSession.vault.id };
  this.activeSession.key.fill(0);
  this.activeSession = undefined;
}
// unlock(): unchanged order (read, KDF, this.lock(), assign); directly after assigning activeSession: this.locked = undefined;
```

`lockedVault()` ersetzt das `lockedFilePath()` der Spec (B2). Ein fehlgeschlagenes `unlock()` (Passwort, Datei) lässt `locked` stehen.

### 1.2 `src/main/vault/ipc.ts`

```ts
export interface VaultIpcOptions {
  /** A new vault, another file or vault, or an explicit disconnect: sessions of the previous vault must end. */
  onSessionChange?: () => void;
  /** After every successful unlock or new vault (resume or switch). */
  onUnlock?: () => void;
  /** After a lock that keeps sessions: windows show the lock screen. */
  onLock?: () => void;
  /** Called after the vault content changed (unlock or save). */
  onVaultChange?: () => void;
  /** Rejects senders that may not use vault commands (e.g. detached windows). */
  guard?: (event: IpcMainInvokeEvent) => void;
}
```

- **unlockVault:**
  ```ts
  const previous = vaultSessionManager.lockedVault();
  const snapshot = await vaultSessionManager.unlock(request.filePath, request.password);
  await lastVault.set(snapshot.filePath);
  // Only the same vault in the same file keeps its sessions; a replaced file counts as a switch.
  const resumed = previous?.filePath === snapshot.filePath && previous.vaultId === snapshot.vault.id;
  if (!resumed) onSessionChange();
  onUnlock();
  onVaultChange();
  ```
- **saveVault (neuer Vault):** `onSessionChange(); onUnlock();` an der Stelle des heutigen `onSessionChange()` (`:116`).
- **lockVault:**
  ```ts
  handle(IPC_CHANNELS.lockVault, (_event, request: LockVaultRequest | undefined) => {
    // Anything but a literal true keeps the sessions.
    const disconnect = request?.disconnect === true;
    if (disconnect) onSessionChange();
    vaultSessionManager.lock();
    // A switch announces nothing: secondary windows are closed and the main window navigates itself (B3).
    if (!disconnect) onLock();
  });
  ```

### 1.3 `src/main/index.ts`

```ts
// Lock and unlock reach every window; the main window learns its own unlock from the IPC result.
const announce = (channel: string, payload?: unknown): void => {
  for (const target of [windowRegistry.main(), ...windowRegistry.secondaries()])
    if (target && !target.isDestroyed() && !target.webContents.isDestroyed()) target.webContents.send(channel, payload);
};
registerVaultIpcHandlers({
  onSessionChange: () => { closeAllSessions(); closeSecondaryWindows(); },
  onLock: () => announce(IPC_CHANNELS.vaultLocked, {} satisfies VaultLockedInfo),
  onUnlock: () => { autoLock?.touch(); announce(IPC_CHANNELS.vaultUnlocked); },
  onVaultChange: () => { broadcastCatalog(); ai.broadcast(); rdpSessionManager.prewarm(); },
  guard: event => windowRegistry.requireMain(event),
});
// AutoLock deps.lock:
lock: minutes => { try { vaultSessionManager.lock(); } finally { announce(IPC_CHANNELS.vaultLocked, { minutes } satisfies VaultLockedInfo); } },
```

`lockNow` und der Kommentar `:270` entfallen. `will-quit` bleibt unverändert.

### 1.4 `src/shared/ipc.ts` und `src/preload/index.ts`

```ts
/** Sent to every window when the vault locks; without minutes = manual lock. */
export interface VaultLockedInfo { minutes?: number }
/** disconnect: end every session and close secondary windows (switching to another vault file). */
export interface LockVaultRequest { disconnect?: boolean }
// IPC_CHANNELS
vaultUnlocked: 'vault:unlocked',
// DesktopApi
lockVault: (request?: LockVaultRequest) => Promise<void>;
onVaultUnlocked: (listener: () => void) => () => void;
// preload
onVaultUnlocked: listener => subscribe('vault:unlocked', listener),
lockVault: (request) => ipcRenderer.invoke('vault:lock', request),
```

### 1.5 `src/main/files/ipc.ts` (wie Spec 3.1)

```ts
// Session-bound channels are guarded by ownership: the session only exists if the vault was unlocked when it opened.
if (!(channel.startsWith('sftp:') && channel !== IPC_CHANNELS.sftpOpen)) vaultSessionManager.getSnapshot();
```

`sftpSyncStart` liest den Vault weiter selbst (`sftp-session.ts:203`). `local:*` bleibt gewächtert.

### 1.6 `src/shared/vault/connections.ts`

```ts
/** Copy without secrets for the locked renderer: SSH/SFTP auth → agent, RDP password and AI settings removed. */
export function redactVault(vault: Vault): Vault {
  const { ai: _ai, ...rest } = vault;
  return { ...rest, nodes: redactSecrets(vault.nodes) };
}
```

### 1.7 `src/renderer/src/components/LockScreen.tsx` (neu) und `src/renderer/src/lock-ui.css` (neu)

```ts
export interface LockScreenProps {
  /** Absent in secondary windows: the title is app:lock.titlePlain. */
  vaultName?: string;
  /** Auto-lock reason in minutes; absent = manual lock or secondary window. */
  minutes?: number;
  /** Running sessions of this window; the line is hidden at 0. */
  running: number;
  /** Main window only; rejects with the unlock error, which the dialog shows under the field. */
  onUnlock?: (password: string) => Promise<void>;
  /** Main window only: after a confirmation, disconnect everything and pick another vault file. */
  onSwitch?: () => void;
}
export function LockScreen(props: LockScreenProps): JSX.Element;
```

Pflichtverhalten (K6):
- `useNativeSurfaceBlock(true)`.
- Beim Mount `showModal()` und einen `MutationObserver` registrieren:
  ```ts
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    // A modal opened later (conflict, Explorer file) would lie above in the top layer and block this one: re-raise in the same task, no frame in between.
    const observer = new MutationObserver(records => {
      if (records.some(record => record.target instanceof HTMLDialogElement && record.target !== dialog && !dialog.contains(record.target) && record.target.open)) {
        dialog.close(); dialog.showModal();
      }
    });
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
    return () => observer.disconnect();
  }, []);
  ```
- `onCancel={event => event.preventDefault()}`.
- `onClose={() => { const dialog = ref.current; if (dialog?.isConnected && !dialog.open) dialog.showModal(); }}`.
- Eigener `pending`-State, nicht das globale `busy`. Absenden ist gesperrt bei leerem Feld oder `pending`. Nach jedem Versuch wird das Feld geleert. Bei einem Fehler zeigt `.error-message` mit `role="alert"` den Text `errorText(error, t('app:errors.vaultFailed'))`, danach geht der Fokus zurück ins Feld.
- `onSwitch` fragt **immer** über `ConfirmDialog` nach (Texte `app:lock.switchTitle/switchDescription/switchConfirm`, `destructive`). Der Dialog wird innerhalb von `LockScreen` gerendert. Die Sitzungen in Nebenfenstern kennt das Hauptfenster nicht, deshalb hängt die Rückfrage nicht an `running`.
- Das Passwortfeld hat `type="password"`, `autoComplete="current-password"` und `autoFocus`. Das Label ist `app:open.password`.

CSS wie Spec 3.3, wörtlich.

### 1.8 Tab-Modell (`src/shared/windows.ts`, `src/renderer/src/terminal-tabs.ts`)

Wie Spec 4.1:
- `view?: 'files' | 'containers' | 'welcome'`
- `WELCOME_HOST`, `welcomeConnection()` und `isWelcomeTab()` wörtlich
- Reducer `open` mit `status: 'closed'` für `view === 'welcome'`
- `retainConnections` behält `view === 'welcome'`
- `shellOf` liefert dafür `null`

Den Doc-Kommentar von `view` in `windows.ts` ergänzen: `'welcome'` steht für die Willkommensseite und reist nie zwischen Fenstern.

`src/main/window-ipc.ts`: `TabConnectionSchema` bekommt `export`, sonst ändert sich nichts. Das Schema bleibt bei `['files', 'containers']`.

### 1.9 Props

- `SplitTerminalArea`: `welcomePanel?: ReactNode` und `onWelcome?: (paneId: string) => void`.
- `ConnectionPicker`: `onWelcome?: () => void`. Fehlt die Prop, fehlt der Eintrag.

---

## 2. Blocker

**B1 – Dialoge, die während der Sperre ohne Nutzeraktion aufgehen, liegen über dem Sperrbildschirm und blockieren ihn.** Ein später mit `showModal()` geöffneter Dialog liegt im Top-Layer oben und ist der blockierende modale Dialog. Damit wird der Sperrbildschirm inert. Der neue Dialog selbst liegt im `inert`-Baum der Shell und ist ebenfalls nicht bedienbar.

Wege dorthin ohne Klick:
- Explorer-Doppelklick auf eine `.term` (`second-instance` → `vault:open-file` → `setPendingVaultFile` → `ConfirmDialog`, `App.tsx:191-195,271`)
- Datei-Drop auf den Sperrbildschirm (der `drop`-Listener hängt an `window`, `App.tsx:236-243`)
- `ConflictDialog` eines laufenden Transfers (`FilesPanel.tsx:156,339`)
- jede andere Bestätigung, die ein Ereignis öffnet

Folgen: Inhalt wird über der Sperre sichtbar (Dateiname, Konfliktdaten), und Entsperren ist unmöglich, was die App bis zum Beenden festsetzt.

Fix: K6, der Observer hebt den Sperrbildschirm sofort wieder nach oben. Der Explorer-Dialog erscheint dadurch nach dem Entsperren, was gewollt ist (K10).

**B2 – Die Wiederaufnahme hängt nur am Pfad; eine ersetzte Datei behält in Main alle Sitzungen.** Spec R6 vergleicht nur `lockedFilePath() === request.filePath`. Liegt unter demselben Pfad ein anderer Vault, etwa weil die Datei ersetzt wurde oder ein Angreifer mit Dateizugriff einen eigenen Vault mit bekanntem Passwort hingelegt hat, ruft Main `onSessionChange` nicht auf. Das Abräumen hängt dann an Renderer-Unmounts und an einem Renderer-`closeSecondaryWindows()`, und das ist genau die „Unmount-Nebenwirkung“, die R7 ausschließen will.

Fix: K1 und K2. Main vergleicht Pfad **und** Vault-ID. `openFresh` im Renderer ruft kein `closeSecondaryWindows()` (K9).

**B3 – Echo von `vault:locked` beim Wechsel und doppeltes `afterLock`.** Nach Spec sendet `lockVault({ disconnect: true })` ebenfalls `onLock` und damit `vault:locked` ans Hauptfenster. `switchVault` hat zu diesem Zeitpunkt schon `setVault(null)` gesetzt und ist auf `'open'` gewechselt. `afterLock` liest dann `vault.id` von `null`, stürzt ab oder setzt `locked` auf dem Öffnen-Bildschirm. Beim normalen Sperren laufen außerdem `afterLock` aus dem `finally` und aus dem Event, in beliebiger Reihenfolge.

Fix:
- K2: kein `onLock` bei `disconnect`.
- K8: `afterLock` ist über einen synchron gesetzten Ref idempotent und tut nichts außerhalb von `screen === 'vault'` oder ohne Vault.

**B4 – Nach Welle 1 ist der Typecheck rot.** Weil `VaultLockedInfo.minutes` optional wird, bricht `App.tsx:614`: `setAutoLockedAfter(minutes)` mit `number | undefined` in `useState<number | null>`. App.tsx gehört laut Plan erst Welle 2.

Fix: Task 1A ändert in `App.tsx` genau diese Zeile auf `setAutoLockedAfter(minutes ?? null)`. Kein anderer Task der Welle 1 fasst App.tsx an.

---

## 3. Korrekturen (bindend)

**K1 – `src/main/vault/session.ts` (+ `session.test.ts`), B2.** Vertrag 1.1. Tests:
- (a) nach `unlock` und `lock` ist `lockedVault()` gleich `{ filePath, vaultId }`
- (b) nach einem erfolgreichen `unlock` ist es `undefined`
- (c) nach falschem Passwort bleibt es gesetzt
- (d) der Schlüssel bleibt genullt (bestehender Test)

**K2 – `src/main/vault/ipc.ts`, B2/B3.** Vertrag 1.2. Den Doc-Kommentar von `onSessionChange` ersetzen. Bei `disconnect` gibt es kein `onLock`.

**K3 – `src/main/index.ts`.** Vertrag 1.3. `autoLock?.touch()` wandert aus `onSessionChange` nach `onUnlock`.

**K4 – `src/shared/ipc.ts`, `src/preload/index.ts`, `src/renderer/src/App.tsx:614`, B4.** Vertrag 1.4, dazu die eine Zeile `minutes ?? null`.

**K5 – `src/shared/vault/connections.ts` (+ `connections.test.ts`).** Vertrag 1.6. Der Test prüft:
- keine `password`/`passphrase` und kein `privateKey` in SSH/SFTP
- kein RDP-`password`
- kein `ai`
- `workflows`, `workspaces`, `settings`, `id`, `name` bleiben
- `autoUpload` bleibt als dieselbe Array-Referenz
- die Eingabe bleibt unverändert

**K6 – `LockScreen.tsx`, B1.** Vertrag 1.7 mit Observer-Neuanhebung, `onClose`-Wächter `isConnected`, Rückfrage immer, Feld nach jedem Versuch leeren, Sitzungszeile nur bei `running > 0`.

Reihenfolge im Dialog:
1. Marke
2. `h1` (`app:lock.title` mit `{ name }`, ohne `vaultName` `app:lock.titlePlain`)
3. bei `minutes` die Zeile `app:lock.autoLocked` (`role="status"`)
4. bei `running > 0` `app:lock.sessions`
5. bei `onUnlock` das Formular, sonst `app:lock.secondary`
6. `.form-actions`: links `app:lock.switch` (nur mit `onSwitch`), rechts `app:lock.unlock` (während `pending` `app:open.submitting`)

`aria-labelledby` zeigt auf den Titel, `aria-describedby` auf Grund- und Sitzungszeile.

**K7 – `src/renderer/src/lock-ui.css`.** CSS wie Spec 3.3, nur Tokens, keine Bewegung, kein `@media`. Import aus `LockScreen.tsx` (`import '../lock-ui.css'`).

**K8 – `App.tsx` Sperren, B3.** Datenschutz:

```ts
type LockState = { minutes?: number; vaultId: string };
const [locked, setLockedState] = useState<LockState | null>(null);
const lockedRef = useRef<LockState | null>(null);
const setLocked = (value: LockState | null): void => { lockedRef.current = value; setLockedState(value); };

function afterLock(minutes?: number): void {
  if (lockedRef.current || screenRef.current !== 'vault' || !vault) return;   // idempotent; ignores late events
  lockEpoch.current += 1;
  lockReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  setLocked({ minutes, vaultId: vault.id });
  setVault(current => current && redactVault(current));
  setAppDialog(null); settingsReturnFocus.current = null; setPaletteOpen(false);
  // A clean editor holds the connection's stored secret in its draft; a dirty one is the user's unsaved input and stays.
  if (!editorDirty) setEditorOpen(false);
}
useEffect(() => window.desktopApi.onVaultLocked(info => afterLockRef.current(info.minutes)), []);
```

Weitere Punkte:
- `lockVault()`: `setBusy(true); try { await window.desktopApi.lockVault(); } finally { setBusy(false); afterLock(); }`.
- Der Knopf ruft `lockVault()` direkt auf, ohne `navigateEditor` und ohne Rückfrage.
- **Kein Speichern einer redigierten Kopie:** `usePersistVault(locked ? null : vault, …)`. Damit liefert jedes `persistVault` während der Sperre sofort `false`, und ein „Erneut versuchen“ aus einer Meldung meldet `retryChanged`. Der redigierte Vault kann so auf keinem Weg auf die Platte kommen.
- Palette: `useCtrlShiftShortcut('Space', () => { if (screenRef.current === 'vault' && !lockedRef.current) setPaletteOpen(open => !open); })`.
- Render: `return <><main className="vault-shell" inert={locked !== null}>…</main>{locked && <LockScreen vaultName={vault.name} minutes={locked.minutes} running={runningCount} onUnlock={unlockFromLock} onSwitch={() => switchVault()} />}</>;`
- Es entfallen:
  - `autoLockedAfter` mit State, Setzen in `resetForm` und Render `:925`
  - `pendingSshAction 'lockVault'` mit Typ und Zweigen
  - der `navigateEditor`-Umweg am Knopf

**K9 – `App.tsx` Entsperren und frisches Öffnen, B2.**

```ts
async function unlockFromLock(password: string): Promise<void> {
  const current = lockedRef.current;
  if (!current || !vaultPath) throw new AppError('core.vaultFileMissing');
  const result = await window.desktopApi.unlockVault({ filePath: vaultPath, password });
  if (result.vault.id !== current.vaultId) { openFresh(result); return; }   // main already ended the old sessions (B2)
  setVault(result.vault); setVaultPath(result.filePath); setSaved(false);
  // Tabs of connections deleted elsewhere close, the same filter as deleteSelectedNode.
  terminals.retainConnections(terminals.tabs.filter(tab => findNode(result.vault.nodes, tab.connection.id)?.type === 'connection').map(tab => tab.connection.id));
  if (selectedNodeId && !findNode(result.vault.nodes, selectedNodeId)) { setSelectedNodeId(null); setEditorOpen(false); setEditorDirty(false); }
  if (activeWorkspaceId && !result.vault.workspaces.some(item => item.id === activeWorkspaceId)) setActiveWorkspaceId(null);
  setLocked(null);
  requestAnimationFrame(() => { const target = lockReturnFocus.current; lockReturnFocus.current = null; if (target?.isConnected) target.focus(); });
}
function openFresh(result: UnlockVaultResult): void {
  lockEpoch.current += 1; setLocked(null);
  setVault(result.vault); setVaultPath(result.filePath); setScreen('vault'); resetForm();
  terminals.open(welcomeConnection());   // after reset: never reuse a tab of the old state
}
```

- Ist `AppError` im Renderer nicht importierbar, wirft die Funktion `new Error(t('app:errors.vaultFailed'))`.
- `handleOpenVault` und `handleCreateVault` rufen nach `resetForm()` ebenfalls `terminals.open(welcomeConnection())`, nicht `openWelcome()`. Der Grund: `terminals.tabs` ist im selben Handler noch der alte Stand, und `select` auf eine zurückgesetzte ID tut nichts.
- `openFresh` ruft **kein** `closeSecondaryWindows()` auf.

**K10 – `App.tsx` Wechsel.**

```ts
function switchVault(filePath?: string): void {
  lockEpoch.current += 1;   // a save in flight must not bring the old vault back on the open screen
  void window.desktopApi.lockVault({ disconnect: true }).catch(() => {});
  setLocked(null); setVault(null); setVaultPath(null); navigateTo('open');
  if (filePath) setSelectedVaultPath(filePath); else void handleSelectVaultFile();
}
```

Das `onConfirm` von `vaultFileDialog` wird zu `{ const filePath = pendingVaultFile; setPendingVaultFile(null); switchVault(filePath); }`. Kommt während der Sperre eine Datei aus dem Explorer, bleibt der Dialog unter dem Sperrbildschirm (B1/K6) und ist nach dem Entsperren bedienbar.

**K11 – `SecondaryWindow.tsx`.**
- `const [locked, setLocked] = useState(false)`.
- Effekte: `onVaultLocked(() => { setLocked(true); setPaletteOpen(false); })` und `onVaultUnlocked(() => setLocked(false))`.
- **Wettlauf beim Laden:** Ein Nebenfenster, das während der Sperre noch lädt, verpasst das Event. Deshalb setzt der `catch` von `connectionCatalog()` `setLocked(true)`, wenn `error instanceof Error && decodeError(error.message)?.code === 'core.vaultLocked'`; sonst bleibt die heutige Fehlermeldung. `decodeError` kommt aus `shared/errors`. Nach dem Entsperren kommen Katalog und `vault:unlocked` über die Broadcasts.
- Palette: `useCtrlShiftShortcut('Space', () => { if (!locked) setPaletteOpen(open => !open); })`.
- Render: `<><main className="vault-shell secondary-shell" inert={locked}>…</main>{locked && <LockScreen running={terminals.tabs.filter(isRunning).length} />}</>`, ohne `vaultName`, `onUnlock` und `onSwitch`.

**K12 – Willkommens-Tab (Task 1B, App-Teil in 2A).**
- `ConnectionPicker`: Der Eintrag `.connection-picker-option.connection-picker-welcome` ist nur `disabled={disabled}`, **nicht** bei `limitReached`, weil ein offener Tab nur fokussiert wird. Er steht unter `.connection-picker-results`, ist auch bei leerer Trefferliste sichtbar und ist per Pfeiltasten erreichbar (gleiche Klasse). Klick: `close(); onWelcome()`.
- `App.openWelcome(paneId)`:
  1. `terminalLayout.setFocused(paneId)`
  2. `const open = reusableTab(terminals.tabs, terminals.activeTabId, welcomeConnection())`
  3. `if (open) terminals.select(open.id); else if (terminals.tabs.length >= MAX_SSH_SESSIONS) notifySessionLimit(); else terminals.open(welcomeConnection());`
- `TerminalTabs`: Für `isWelcomeTab(tab)` lautet die Beschriftung `t('terminal:tabs.welcome')` (folgt dem Sprachwechsel), `title` ist nur die Beschriftung. Es gibt keinen Statuspunkt und kein `ConnectionIcon`, dafür `data-fixed` am Tab-Knopf.
- `SplitTerminalArea`:
  - `beginTabDrag` kehrt bei einem Willkommens-Tab sofort zurück. Der Klick wählt weiter über `onClick`.
  - Der Kopfleisten-Drag (`:352-355`) startet nicht, wenn der aktive Tab ein Willkommens-Tab ist.
  - Teilen ist `disabled`, „Aktiven Tab verschieben“ wird nicht gerendert, jeweils wenn der aktive Tab der Pane Willkommen ist.
  - Willkommens-Panel wie Spec 4.2.
- `terminal-ui.css`: direkt nach `:29` zwei Regeln:
  ```css
  /* Welcome tab: page background and its own padding instead of the terminal stage. */
  .split-terminal-stage > .welcome-panel { padding: 0; background: var(--color-bg-app); }
  .terminal-tab[data-fixed] { cursor: default; }
  ```
- `useTabTransfer.transferView`:
  - `tabs` ohne Willkommens-Tab (`!isWelcomeTab`) bilden `moving`.
  - Ist `moving` leer: `return false` ohne IPC und ohne Schließen. Eine Ansicht nur mit Willkommensseite wandert nicht.
  - Nach Erfolg schließen weiterhin alle Tabs der Ansicht, also auch der Willkommens-Tab.
- `window-ipc.test.ts`: `TabConnectionSchema.safeParse({ id: 'welcome', name: 'Willkommen', protocol: 'cmd', address: '', view: 'welcome' }).success === false`. Der deutsche Literal im Test ist erlaubt, Tests sind von (g) ausgenommen; sonst `name: 'x'`.
- `terminal-tabs.test.ts`: zusätzlich prüfen, dass das Limit gilt (16 Tabs → `open` ignoriert, auch für Willkommen).
- App (2A):
  - `hasTabs` und der `workspaceDirty`-Fallback zählen nur `!isWelcomeTab`.
  - `WelcomePage` bekommt `welcomePanel`.
  - `SplitTerminalArea` bekommt `onWelcome={openWelcome}`.
  - `hidden`/`visible`/`no-terminals` entfallen.
  - Der direkte `WelcomePage`-Render entfällt.

**K13 – Texte und Doku (bindend für 1C und 1D).**
- `app:settings.autoLock.hint` ersetzt die Spec-Fassung, weil Dialog-Entwürfe (Einstellungen, KI-Anbieter) beim Sperren schließen:
  - de: „Sperrt den Vault, wenn in keinem Shellherd-Fenster Maus oder Tastatur benutzt wurde. Offene Sitzungen und Tabs bleiben erhalten.“
  - en: “Locks the vault when neither mouse nor keyboard was used in any Shellherd window. Open sessions and tabs are kept.”
- Alle übrigen Keys stehen wörtlich wie in Spec 5. Die en-Texte nutzen “…” statt „…“ (Test f).
- Spec R2 und 3.5 sind falsch formuliert: Ein offener Verbindungseditor hält das **gespeicherte** Passwort der Verbindung in seinem Entwurf (`ConnectionForm.tsx:66-68`, auch in `savedSignature`), nicht nur getippte Eingaben. Gilt ab jetzt:
  - Ein unveränderter Editor schließt beim Sperren (K8).
  - Ein geänderter bleibt mit seinem Inhalt.
  - Das ist dieselbe Risikoklasse wie 1.3 und steht so im Handbuch.
- Spec 3.5 „Taskleisten-Vorschau zeigt den undurchsichtigen Dialog“ gilt nur für sichtbare Fenster, siehe Risiko O1.
- Handbuch/Manual (1D) nennen zusätzlich:
  - Leerlauf-Trennung läuft während der Sperre weiter. Eine lange Sperre kann Sitzungen trennen, die Getrennt-Leiste wartet.
  - Automatische Rückfragen des Assistenten (gelesene Ausgabe) scheitern während der Sperre mit „Es ist kein Vault entsperrt.“
  - Eine offene Host-Schlüssel-Rückfrage kann über dem Sperrbildschirm erscheinen. Sie zeigt nur Host und Fingerabdruck.
  - Der Willkommens-Tab zählt zum Limit von 16 Tabs.
  - „Andere Vault-Datei“ fragt immer nach und trennt alles.
- Die zu ersetzenden Handbuch-Sätze stehen in Spec 7 (`handbuch.md:61-62,91-97,363`, `manual.md:62-63,88-96,361`). 1D prüft die Zeilen vor dem Ersetzen.
- CHANGELOG 0.15.0 (de/en, gleiche Zahl an Punkten). Pflicht sind die Punkte:
  1. Sperren trennt nicht mehr, Sperrbildschirm
  2. Nebenfenster sperren mit
  3. Sperrknopf ohne Rückfrage
  4. Willkommensseite als Tab samt „+“-Eintrag
  5. Bühne ohne Tabs zeigt den leeren Bereich

  Kein Fettdruck (Commit `98d5ca1`).

**K14 – run-app (`.claude/skills/run-app/screens.mjs`, `SKILL.md`).** Block `lock` in dieser Reihenfolge:
1. `closeTabs()`, `web-01` verbinden, auf `.xterm` warten.
2. `.lock-button` klicken und auf `dialog.lock-screen[open]` warten.
3. Gegenprobe `document.querySelector('.vault-shell').inert === true`.
4. Zweimal `key('Escape')` mit Pause, dann `dialog.lock-screen[open]` muss bleiben.
5. **Neuanhebung (B1):** per `evaluate` einen `<dialog>` an `body` hängen und `showModal()` rufen. Danach `document.elementFromPoint(innerWidth/2, innerHeight/2)?.closest('dialog.lock-screen')` muss gesetzt sein. Den Test-Dialog danach entfernen.
6. Screenshot `lock-screen`.
7. Falsches Passwort → `.lock-screen .error-message` sichtbar.
8. Richtiges Passwort `synthetic-vault-demo` → `!document.querySelector('dialog.lock-screen[open]')`, `count('.terminal-tab-close') >= 1`, `.xterm` vorhanden.

Block `welcome` wie Spec 6. `SKILL.md` listet `lock-screen.png` und `welcome.png`. Endet der `lock`-Block mit einem Fehler, bleibt die App gesperrt. Deshalb steht in `SKILL.md` ein Satz: Dann `demo-setup.mjs` neu starten.

**K15 – `docs/design-system.md` (1C).** Gate-Zeilen und Ebenen-Satz wörtlich wie Spec 5.

Zusatz unter „Ebenen“: „Öffnet während der Sperre ein anderer modaler Dialog, hebt der Sperrbildschirm sich sofort wieder an die Spitze des Top-Layers.“

---

## 4. Wellen (endgültig)

Gate nach **jeder** Welle: `npm run typecheck` und `npx vitest run` vollständig grün. Es gibt keine Ausnahme und kein begrenztes Gate. Umsetzer schreiben nur ihre Dateien und committen nie.

| Welle | Task | Dateien (exklusiv) | Pflichtpunkte |
|---|---|---|---|
| 1 | **1A Main-Sperre** | `src/main/vault/session.ts` + `session.test.ts`, `src/main/vault/ipc.ts`, `src/main/index.ts`, `src/main/files/ipc.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/shared/vault/connections.ts` + `connections.test.ts`, **`src/renderer/src/App.tsx` nur Zeile 614** | Vertrag 1.1–1.6; K1–K5; B4 (`minutes ?? null`). Kein `lockedFilePath`. Kein `onLock` bei `disconnect`. |
| 1 | **1B Tab-Modell Willkommen** | `src/shared/windows.ts`, `src/renderer/src/terminal-tabs.ts` + `.test.ts`, `src/renderer/src/terminal-layout.ts` + `.test.ts`, `src/renderer/src/hooks/useTabTransfer.ts`, `src/renderer/src/components/TerminalTabs.tsx`, `src/renderer/src/components/SplitTerminalArea.tsx`, `src/renderer/src/components/ConnectionPicker.tsx`, `src/renderer/src/terminal-ui.css`, `src/main/window-ipc.ts` (nur `export`), `src/main/window-ipc.test.ts`, `src/shared/locales/{de-DE,en-US}/{terminal,vault}.json` | Vertrag 1.8/1.9; K12 (ohne App-Teil). Keys `terminal:tabs.welcome`, `terminal:area.emptyHint` (neu), `vault:picker.welcome` wörtlich nach Spec 5/4.4. Alle neuen Keys werden in 1B-Dateien benutzt (Orphan-Test). |
| 1 | **1C Sperrbildschirm** | neu `src/renderer/src/components/LockScreen.tsx`, neu `src/renderer/src/lock-ui.css`, `src/shared/locales/{de-DE,en-US}/app.json` (nur **hinzufügen** `lock.*` und `settings.autoLock.hint` ändern; **nicht löschen**), `docs/design-system.md` | Vertrag 1.7; K6, K7, K13 (Texte), K15. Jeder neue `app:lock.*`-Key kommt als volles Literal in `LockScreen.tsx` vor. Nutzt `onVaultUnlocked` nicht (das ist 2C). |
| 1 | **1D Doku und Version** | `docs/handbuch.md`, `docs/manual.md`, `CHANGELOG.md`, `CHANGELOG.en.md`, `package.json`, `package-lock.json` (nur Root-Version), `.claude/skills/run-app/screens.mjs`, `.claude/skills/run-app/SKILL.md` | K13 (Doku, CHANGELOG), K14; Version `0.15.0`; `version.test.ts` grün. |
| 2 | **2A Hauptfenster** | `src/renderer/src/App.tsx`, `src/renderer/src/styles.css`, `src/shared/locales/{de-DE,en-US}/app.json` (nur **löschen**: `dialogs.lockVault`, `dialogs.confirmLock`, `home.autoLocked_one`, `home.autoLocked_other`) | K8, K9, K10, K12 (App-Teil). `.no-terminals`-Regel `styles.css:83` weg. `WelcomePage` nur noch als `welcomePanel`. Orphan-Test grün. |
| 2 | **2C Nebenfenster** | `src/renderer/src/SecondaryWindow.tsx` | K11 |

Nach Welle 2 folgt run-app nach K14 und Spec 6. Die Screenshots werden angesehen.

Warum jede Welle grün bleibt:
- In Welle 1 sind alle neuen Props und Methoden optional oder haben schon Nutzer. Neue Keys werden in derselben Welle benutzt.
- App.tsx bekommt nur die B4-Zeile.
- Die alten Keys werden erst in 2A gelöscht, zusammen mit ihren Nutzern.
- `WelcomePage` bleibt bis 2A direkt gerendert. Die neuen `SplitTerminalArea`-Props sind optional.

---

## 5. Offene Risiken

**O1 – Taskleisten-Vorschau, Alt+Tab und Wiederherstellen-Animation bei minimiertem Fenster.** Bei einem sichtbaren Fenster zeigt DWM nach dem nächsten Frame den undurchsichtigen Sperrbildschirm. Bei einem **minimierten** Fenster rendert Chromium keine neuen Frames. Die Taskleisten-Vorschau und die Wiederherstellen-Animation zeigen das letzte Bild vor dem Minimieren, also Terminal-Inhalt von vor der Sperre.

Das ist kein Geheimnis aus dem Vault, aber genau der Walk-up-Fall. Manuelle Prüfung im Review:
1. Fenster minimieren und Auto-Sperre auf 1 Minute stellen.
2. Nach der Sperre über das Taskleistensymbol hovern.

Zeigt die Vorschau alten Inhalt, ist der kleinste Folgeschritt `BrowserWindow.setContentProtection(true)` in `onLock`/Auto-Sperre und `false` in `onUnlock`, nach Test auf Windows 11. Ob WDA auch die Minimiert-Vorschau abdeckt, ist ungeprüft. Das bleibt ein Extra und kommt nicht in diesen Umfang.

**O2 – Tastaturfokus im RDP-Helfer.** Die Auto-Sperre feuert bei verbundenem RDP nur, wenn das System im Leerlauf ist. Hatte das native RDP-Fenster den Fokus, versteckt `rdpVisible(false)` es, doch wohin Windows den Fokus gibt, ist ungeprüft. Manuell prüfen: Nach der Sperre gehen Tastendrücke nicht an die Remote-Sitzung. Hängt der Renderer, bleibt die RDP-Fläche sichtbar, denn das Verstecken läuft nur über den Renderer (Spec 7).

**O3 – Speichern und Entsperren im Wettlauf.** Läuft ein `writeEncryptedVaultFile` noch, während `unlock` die Datei liest, liest `unlock` den älteren Stand. Das ist praktisch ausgeschlossen, weil Passwort tippen plus Argon2id Sekunden dauert. Die Datei hat danach den neueren Stand, der Renderer den älteren, und das nächste Speichern überschreibt. Das wird akzeptiert.

**O4 – Tab-Drag im Moment der Sperre.** Ein laufender Drag mit Pointer-Capture bekommt unter `inert` kein `pointerup`. Ein Tear-off-Geist (`DragGhost`) kann bis zur nächsten Zeigeraktion nach dem Entsperren stehen bleiben. Er zeigt nur die Tab-Beschriftung. Das wird akzeptiert.

**O5 – Sitzungszahl im Sperrbildschirm.** Gezählt werden nur die Tabs des eigenen Fensters. Nebenfenster zeigen ihre eigene Zahl.

**O6 – Zugangsdaten im Speicher.** Betroffen sind laufende Sitzungen (Spec 1.3) und ein geänderter, ungespeicherter Verbindungseditor (K13). Das ist Nutzerentscheidung, im Handbuch dokumentiert. Kein Schutz gegen Speicherforensik.

**O7 – SFTP-Wächter gelockert.** Sitzungsgebundene `sftp:*`-Kanäle laufen ohne entsperrten Vault, wenn das Fenster die Sitzung besitzt. Sie liefern keine Vault-Geheimnisse. Der Renderer ist hinter `inert` ohnehin nicht bedienbar. Neue Sitzungen (`sftp:open`) und Bindungen (`sync-start`) bleiben gesperrt.

**O8 – Keine Komponententests für `LockScreen` und die Neuanhebung.** Es gibt keine DOM-Testumgebung. Abgesichert wird über run-app K14, Schritte 3–5 und 8. Ein Review muss diese Schritte im Lauf sehen.

**O9 – Zurückgelassener Sperrzustand bei run-app.** Bricht der `lock`-Block ab, findet `demo-setup.mjs` das Passwortfeld des Sperrbildschirms statt des Öffnen-Bildschirms. Dann die App neu starten (K14, `SKILL.md`).
