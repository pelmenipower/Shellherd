# Sperrbildschirm und Willkommens-Tab – Design

Auftrag: „Was ist, wenn wir das Autotrennen abwandeln und eine Sperre einbauen, das heißt die Tabs bleiben erhalten? Und die Willkommensseite ist ein eigener Tab in einer Ansicht, nicht ein Fenster.“ Grundlage ist das Konzept `.superpowers/sdd/lock-screen-research.md`, ab „1. Bestand und Lücken“ hier vollständig als Spec übernommen. Plan: `docs/superpowers/plans/2026-10-21-lock-screen.md`.

## Nutzer-Entscheidungen (bindend)

- **N1** Die Auto-Sperre trennt nicht mehr. Ein Sperrbildschirm legt sich über die App, Tabs und Sitzungen laufen weiter, das Vault-Passwort entsperrt.
- **N2** Der Knopf „Vault sperren“ verhält sich genauso. „Andere Vault-Datei“ auf dem Sperrbildschirm trennt.
- **N3** Die Willkommensseite ist ein Tab in der Ansicht. Er erscheint beim Öffnen eines Vaults ohne gespeicherten Workspace. Geschlossen bleibt er weg, ein Menüeintrag öffnet ihn wieder.
- **N4** Den Willkommens-Tab kann man nur schließen, nicht verschieben, teilen oder in ein Nebenfenster ziehen.

## Spec-Rulings (Stufe 3)

- **S1** Die Rulings R1–R16 aus Abschnitt 10 des Konzepts gelten. R1 hebt N4 und R9 der Spec `2026-10-21-connection-timeouts-design.md` auf.
- **S2** Der Umfang ist Stufe 1 aus Abschnitt 8.
- **S3** Version `0.15.0`. Der Changelog nennt, dass Sperren nicht mehr trennt.
- **S4** Abnahme: Typecheck und `npx vitest run` grün, run-app nach Abschnitt 6, Screenshots ansehen.

## 1. Bestand und Lücken

### 1.1 Sperren heute

| Schritt | Wo | Was passiert |
|---|---|---|
| Auto-Sperre (Timer) | `src/main/vault/auto-lock.ts:32-42` → `src/main/index.ts:272-282` | `lock(minutes)` ruft `lockNow()` (`index.ts:271`): `closeAllSessions()` (`:55`: SSH, RDP, SFTP, Assistent, Discovery, Kube), `closeSecondaryWindows()` (`:61-67`), dann `vaultSessionManager.lock()`; danach `vault:locked { minutes }` **nur** ans Hauptfenster (`:276-277`) |
| Manuelles Sperren (Knopf) | `src/renderer/src/App.tsx:801-804` | bei laufenden Sitzungen und `confirmBeforeClosingSession` der Dialog `pendingSshAction 'lockVault'` (`:814-825`, Texte `app:dialogs.lockVault`/`confirmLock`, `app.json:90,100`), sonst `lockVault()` |
| `lockVault()` Renderer | `App.tsx:591-598` | `busy`, `desktopApi.lockVault()`, im `finally` `afterLock()` |
| `afterLock()` | `App.tsx:600-611` | `lockEpoch++`, `setVault(null)`, `setVaultPath(null)`, `resetForm()` (`:288-311`: Editor, Tabs, Layout, Meldungen weg), `setScreen('home')`, Dialoge zu |
| `vault:lock` Main | `src/main/vault/ipc.ts:214-220` | `onSessionChange()` (= `closeAllSessions(); closeSecondaryWindows(); autoLock.touch()`, `index.ts:266`), dann `vaultSessionManager.lock()` (`session.ts:115-122`: `key.fill(0)`, `activeSession = undefined`) |
| Entsperren | `vault/ipc.ts:160-189` | `unlock()` liest die Datei neu, KDF, ersetzt die Session (`session.ts:40-70`), `lastVault.set`, `onSessionChange()` (`:182`!), `onVaultChange()` (`:183`: Katalog an Nebenfenster, KI-Katalog, RDP-Prewarm) |
| Speichern unter Sperre | `src/renderer/src/hooks/usePersistVault.ts:27-36` | Epoch-Vergleich: ein Save, der unter anderem Epoch zurückkommt, setzt nichts (Timeouts-Validierung B3/K10/K11, bleibt bindend) |
| Nebenfenster | `src/renderer/src/SecondaryWindow.tsx` | kennen keinen Vault, nur den redigierten Katalog (`src/main/window-ipc.ts:80-83`); erfahren von der Sperre nur durch ihr Schließen |

Lücken: (a) `onSessionChange` wird bei **jedem** Entsperren gerufen, auch bei derselben Datei. (b) `vault:locked` erreicht Nebenfenster nicht. (c) Der Renderer wirft beim Sperren seinen gesamten Zustand weg. (d) Es gibt keinen Rückkanal „entsperrt“ für Nebenfenster.

### 1.2 Main-Pfade, die den Vault zur Laufzeit lesen

Alle gehen über `vaultSessionManager.getSnapshot()` und werfen gesperrt `core.vaultLocked` (`session.ts:124-131`).

| Leser | Wann | Verhalten während der Sperre | Bewertung |
|---|---|---|---|
| SSH `getConnection`/`getTimeouts` (`src/main/ssh/ipc.ts:45-51`) | `prepare` (`ssh/session.ts:183`) und `connect` (`:228`): neue Verbindung und „Neu verbinden“ | wirft → Fehlerkarte im (verdeckten) Terminal. Reconnect ist nur manuell (`TerminalPanel.tsx:256`), per `inert` unerreichbar | gewollt: neu/reconnect gesperrt, laufend bleibt |
| SFTP `handle`-Wächter (`src/main/files/ipc.ts:65`) | **jeder** Datei-Kanal, auch sitzungsgebundene (`sftpList`, `sftpState` …) | `FilesPanel` ruft ohne Nutzer `refresh('remote')` nach Auto-Upload (`FilesPanel.tsx:171`) und nach Bearbeiten (`:161`) → `sftpList` scheitert → Fehlerzeile bleibt nach dem Entsperren bis F5 | Wächter für sitzungsgebundene Kanäle lockern (Besitzprüfung `owned()` reicht); siehe 3.1 |
| SFTP `open`/`syncStart` (`files/sftp-session.ts:73,203`) | Öffnen, Bindung starten | wirft; nur Nutzeraktion | gewollt |
| Kube `getCluster` (`src/main/kubernetes/ipc.ts:42-46`) | `establish()` (`kubernetes/session.ts:243-244`) beim Verbinden **und** im Reconnect-Backoff (`:317-344`); `status()` (`:474`) mit `try/catch` | ein Reconnect während der Sperre scheitert mit `core.vaultLocked`, zählt `attempt++` und versucht mit Backoff weiter; nach dem Entsperren greift der nächste Versuch | akzeptabel, dokumentieren |
| Container-Discovery (`src/main/containers/ipc.ts:18-24`, `discovery.ts:194-195`) | `containersInventory` vom Poller alle 10 s (`inventory-scheduler.ts:7`, `fail` `:51`) | Statuszeile der Container-Ansicht zeigt „Es ist kein Vault entsperrt.“ (verdeckt); Poller läuft weiter und heilt binnen 10 s nach dem Entsperren; lokaler Host liest den Vault nicht | akzeptabel |
| KI `settings()` (`src/main/ai/ipc.ts:26`, `assistant.ts:48,51`) | Katalog und `ask` | nur Nutzeraktion; laufende Streams enden nicht | gewollt |
| RDP `getTarget` (`src/main/rdp/ipc.ts:36-42`) | `open` | Nutzeraktion | gewollt |
| Fenster-IPC (`window-ipc.ts:81,132,144,206`) | Katalog für neue Nebenfenster, Tab-/View-Transfer, Workspace-Fenster | wirft; Nebenfenster entstehen gesperrt nicht | gewollt |
| Schließen-Wächter (`index.ts:121,151`) | Fenster schließen | `confirm` fällt auf `true` → native Rückfrage, dann Ende | gewollt |
| Verbindungstest, Zwischenablage (`index.ts:245,252,257`) | Nutzeraktion | wirft | gewollt |

### 1.3 Zugangsdaten im Speicher (bewusstes Risiko)

Laufende Sitzungen halten ihre Zugangsdaten bereits jetzt außerhalb des Vault-Objekts: der `ssh2`-Client (Passwort/Key in der Connect-Konfiguration), der RDP-Helfer (`rdp/ipc.ts:41` übergibt `password`), Discovery-Helferverbindungen (`discovery.ts`, 60-s-Cache), Cluster-Zugangshost und Tunnel. Nach dem Nullen des Schlüssels bleiben diese Prozess-Speicherbereiche bestehen, solange die Sitzung lebt. Der Sperrbildschirm schützt vor Walk-up-Zugriff und Bildschirminhalt, nicht vor Speicherforensik am laufenden Prozess. Das ist die Nutzerentscheidung „offene Verbindungen behalten ihre Zugangsdaten“ und steht so ins Handbuch.

### 1.4 Renderer-Zustand beim Sperren

- Das entschlüsselte `vault` (mit SSH-Passwörtern, RDP-Passwörtern, KI-Schlüsseln `types.ts:11,16,102,192`) liegt als React-State in `App.tsx:127`. Es darf während der Sperre nicht im Renderer bleiben, aber der Komponentenbaum braucht ein `vault`, sonst fällt der Render-Zweig `screen === 'vault' && vault` (`App.tsx:777`) auf die Startkarte und alles wird unmontiert.
- `redactSecrets(nodes)` (`src/shared/vault/connections.ts:33-40`) existiert bereits für Nebenfenster: SSH/SFTP-Auth → `agent`, RDP-Passwort weg. KI-Schlüssel (`vault.ai`) deckt es nicht ab.
- `ConnectionForm` (`:66`) und `FolderEditor` (`:19-21`) initialisieren ihren Entwurf **einmal** aus den Props; ein späterer Prop-Wechsel setzt nichts zurück. Eine redigierte Kopie als `vault` hält also Formulare samt Entwurf am Leben.
- Sperr-Epoch (`App.tsx:171-175`, `usePersistVault.ts:14-15,30,36`): ein Save, der nach dem Sperren zurückkommt, darf weder `setVault(result.vault)` (unredigiert!) noch einen Fehler zeigen. Der Epoch-Mechanismus bleibt deshalb genau so.

### 1.5 Dialoge, Top-Layer, Tastenkürzel, native Flächen

- Elf Komponenten öffnen `<dialog>` per `showModal()` (Bestätigungen, Einstellungen, KI-Anbieter, Palette, Rechte, Auto-Upload, Release Notes …). Top-Layer liegt über jedem `z-index`, auch über `--layer-toast`. Ein Sperrbildschirm als `div` mit `z-index` läge **unter** einem offenen Bestätigungsdialog („Tab „web-01“ schließen?“) – ein Leck. Ein später geöffneter modaler Dialog liegt im Top-Layer über allen früheren.
- `ConfirmDialog.tsx:37-40` fängt `cancel` ab (`preventDefault`). Chromes Close-Watcher lässt ein zweites Escape ohne zwischenzeitliche Nutzeraktivierung trotzdem durch (`close` ohne `cancel`): für Bestätigungen harmlos, für einen Sperrbildschirm ein Bypass. Gegenmittel: `close` → sofort wieder `showModal()`, plus `inert` auf der App-Shell.
- Globale Kürzel laufen in der Capture-Phase auf `window` (`hooks/useShortcut.ts:14`): `Strg+Umschalt+Leertaste` öffnet die Workflow-Palette (`App.tsx:125`, `SecondaryWindow.tsx:100`) als modalen Dialog → läge über dem Sperrbildschirm und tippt in Terminals. `Strg+,` ist durch `settingsShortcutAction` (`shortcut-match.ts:15-19`) blockiert, sobald irgendein `dialog[open]` existiert. `Strg+Umschalt+K` (`useAssistantToggle.ts:17`) schaltet nur ein Panel in der inerten Shell.
- RDP zeichnet native Fenster **über** dem DOM; `useNativeSurfaceBlock(true)` (`native-surface.ts:10-16`) lässt `RdpPanel` die Fläche verstecken (`RdpPanel.tsx:40-41,121`). Ohne das läge der Remote-Desktop über dem Sperrbildschirm.
- DevTools sind in jedem Fenster aus (`index.ts:84` `devTools: false`), neue Fenster und Navigation sind verboten (`:92-93`).
- Taskleisten-Vorschau: DWM zeigt den zusammengesetzten Fensterinhalt. Mit undurchsichtigem Sperrbildschirm und versteckter RDP-Fläche ist das der Sperrbildschirm. Terminal-Ausgabe läuft in verdeckten xterm-Canvases weiter; nichts davon ist sichtbar.
- Meldungen (`ToastStack`, `--layer-toast`) liegen unter dem Top-Layer und werden erst nach dem Entsperren sichtbar.

### 1.6 Willkommensseite und Tab-Modell heute

| Bestand | Fundstelle |
|---|---|
| `WelcomePage` statt Tabs, wenn keine Tabs, kein Editor, kein externes Hover | `App.tsx:868-870`; `terminal-area` dabei `hidden` (`:860`), `visible={tabs.length > 0}` (`:862`), Klasse `no-terminals` (`:859`), CSS `styles.css:83,104-116` |
| Props: Vault-Name, Version, Release Notes, Anzahl Verbindungen, Workspaces, `onNewConnection`, `onOpenWorkspace` | `components/WelcomePage.tsx:8-20` |
| Tab = `{ id, connection: TabConnection, ordinal, status, adopt?, kubeView? }`; `TabConnection.view?: 'files' \| 'containers'` | `terminal-tabs.ts:82-90`, `src/shared/windows.ts:9-19` |
| Reducer: `open` setzt `status: 'connecting'`, kappt bei `MAX_SSH_SESSIONS` (16, `shared/ssh.ts:6`); `retainConnections` behält `LOCAL_CONTAINER_HOST` | `terminal-tabs.ts:109-114,132-137` |
| Neue Tabs landen im fokussierten Bereich der aktiven Ansicht | `terminal-views.ts:36-47` (`syncViews`), `terminal-layout.ts:44-63` |
| Workspace-Speichern filtert lokale Container- und Pod-Tabs | `terminal-layout.ts:160-161` |
| Transfer-Schema akzeptiert nur `view: 'files' \| 'containers'` | `window-ipc.ts:24` |
| Tab-Leiste: Statuspunkt, Verbindungs-Icon, Titel `label · address · status`, Schließen-Knopf | `components/TerminalTabs.tsx:50-63` |
| Drag beginnt in `beginTabDrag` (`SplitTerminalArea.tsx:206-212`) und über die Kopfleiste (`:352-355`); Layout-Menü: Teilen verschiebt den aktiven Tab (`:387-389`), „Aktiven Tab verschieben“ (`:392-395`), „Als eigene Ansicht“ (`:397-399`) | |
| Leerer Bereich: `.empty-pane` mit Hinweis und „Hier verbinden“ | `SplitTerminalArea.tsx:403-404`, `terminal.json area.emptyHint` |
| „+“-Picker je Bereich: Suche, Treffer, Limit-Hinweis | `components/ConnectionPicker.tsx:58-96`, Texte `vault:picker.*` |
| Ansichtstransfer sendet alle Tabs der Ansicht | `hooks/useTabTransfer.ts:48-67` |
| Vault-Start öffnet keinen Workspace automatisch | `handleOpenVault` `App.tsx:391-394`, `handleCreateVault` `:354-357` |

## 2. Empfehlung je Fläche

| Fläche | Empfehlung | Wert | Aufwand |
|---|---|---|---|
| Sperren ohne Trennen (Auto und Knopf) | Main nullt nur Schlüssel und Vault; `onSessionChange` nur beim Wechsel der Datei; `vault:locked`/`vault:unlocked` an alle Fenster | ★★★ | kleine Main-Änderung (`session.ts`, `vault/ipc.ts`, `index.ts`, `shared/ipc.ts`, Preload) |
| Sperrbildschirm Hauptfenster | modaler `<dialog>`, undurchsichtig, `inert` auf der Shell, Passwortfeld, Grund, Sitzungszahl, „Andere Vault-Datei“ | ★★★ | nur Renderer |
| Redigierte Vault-Kopie während der Sperre | `redactVault()` neben `redactSecrets` | ★★★ | eine Funktion in `shared/vault/connections.ts` |
| Nebenfenster sperren statt schließen | gleicher Dialog ohne Passwortfeld | ★★★ | nur Renderer plus Broadcast |
| Native RDP-Fläche verstecken | `useNativeSurfaceBlock(true)` im Sperrbildschirm | ★★★ | eine Zeile |
| Palette-Kürzel während der Sperre aus | Bedingung in beiden Fenstern | ★★★ | zwei Zeilen |
| SFTP-Wächter für sitzungsgebundene Kanäle lockern | Dateiansicht bleibt hinter der Sperre aktuell | ★★ | eine Bedingung in `files/ipc.ts` |
| Fokus nach dem Entsperren zurückgeben | Muster `settingsReturnFocus` | ★ | drei Zeilen |
| Willkommens-Tab als `view: 'welcome'` | nicht gespeichert, nicht ziehbar, nicht übertragbar, Status `closed` | ★★★ | nur Renderer |
| Menüeintrag „Willkommensseite“ im „+“-Picker | fester Eintrag unter den Treffern; fokussiert einen offenen Tab | ★★★ | nur Renderer |
| Bühne immer sichtbar, `.no-terminals` weg | leerer Bereich zeigt `.empty-pane` | ★★ | nur Renderer |
| Merken „Willkommen nie wieder zeigen“ | **nicht jetzt** | ★ | nicht jetzt |
| Pausieren der Poller während der Sperre | **nicht jetzt** (heilt sich binnen 10 s) | ★ | nicht jetzt |
| „Hauptfenster anzeigen“-Knopf im gesperrten Nebenfenster | **nicht jetzt** (bräuchte neuen Kanal) | ★ | nicht jetzt |

## 3. Entwurf A: Sperrbildschirm

### 3.1 Main

**`src/main/vault/session.ts`:** `lock()` merkt sich den Pfad der gesperrten Session (ein String, kein Geheimnis); `unlock()` löscht ihn nach Erfolg.

```ts
private lockedPath: string | undefined;
/** Path of the vault locked last, until the next unlock; lets a resume keep its sessions. */
public lockedFilePath(): string | undefined { return this.lockedPath; }
// lock(): this.lockedPath = this.activeSession.filePath; key.fill(0); activeSession = undefined
// unlock(): nach dem Zuweisen der neuen Session this.lockedPath = undefined
```

**`src/main/vault/ipc.ts`:** `VaultIpcOptions` bekommt `onLock` und `onUnlock`; `onSessionChange` behält seine Bedeutung („Sitzungen des vorigen Vaults müssen enden“), wird aber nur noch gerufen, wenn sie enden müssen.

```ts
export interface VaultIpcOptions {
  /** A new vault, another file, or an explicit disconnect: sessions of the previous vault must end. */
  onSessionChange?: () => void;
  /** After every unlock (resume or switch). */
  onUnlock?: () => void;
  /** After a manual lock: windows show the lock screen. */
  onLock?: () => void;
  onVaultChange?: () => void;
  guard?: (event: IpcMainInvokeEvent) => void;
}
// unlockVault: const resumed = vaultSessionManager.lockedFilePath() === request.filePath;
//   snapshot = await unlock(...); lastVault.set; if (!resumed) onSessionChange(); onUnlock(); onVaultChange();
// saveVault (neuer Vault): onSessionChange(); onUnlock();
// lockVault(request?: { disconnect?: boolean }): if (request?.disconnect === true) onSessionChange(); vaultSessionManager.lock(); onLock();
```

Bei `disconnect: true` merkt sich `lock()` den Pfad trotzdem; ein folgender `unlock` derselben Datei gilt als Wiederaufnahme und lässt `onSessionChange` aus – es gibt aber nichts mehr zu halten, `onSessionChange` lief schon beim Sperren. Kein zusätzlicher Zustand nötig.

**`src/main/index.ts`:**

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
// AutoLock.lock: try { vaultSessionManager.lock(); } finally { announce(IPC_CHANNELS.vaultLocked, { minutes }); }
```

`lockNow` (`index.ts:271`) entfällt. `will-quit` (`:304-309`) bleibt. `autoLock.touch()` wandert aus `onSessionChange` nach `onUnlock`, sonst sperrt ein alter Zeitstempel sofort nach dem Entsperren (gleiche Begründung wie Timeouts-Spec 3.4).

**`src/shared/ipc.ts` / `src/preload/index.ts`:** `VaultLockedInfo { minutes?: number }` (ohne `minutes` = manuell), neuer Kanal `vaultUnlocked: 'vault:unlocked'`, `onVaultUnlocked: (listener: () => void) => () => void`, `lockVault: (request?: LockVaultRequest) => Promise<void>` mit `LockVaultRequest { disconnect?: boolean }`. Main prüft `request?.disconnect === true` (kein Zod nötig: ein Boolean, jeder andere Wert gilt als `false`).

**`src/main/files/ipc.ts:62-69`:** Der Wächter `vaultSessionManager.getSnapshot()` gilt nur noch für Kanäle ohne Sitzungsbesitz:

```ts
// Session-bound channels are guarded by ownership (`owned()`): the session only exists if the vault was unlocked when it opened.
const sessionBound = channel.startsWith('sftp:') && channel !== IPC_CHANNELS.sftpOpen;
if (!sessionBound) vaultSessionManager.getSnapshot();
```

`sftpOpen` und `syncStart` lesen den Vault weiterhin über `getConnection` (`files/ipc.ts:73-77`, `sftp-session.ts:203`), `local*` bleiben gewächtert.

### 3.2 Renderer Hauptfenster (`App.tsx`)

Zustand: `const [locked, setLocked] = useState<{ minutes?: number; vaultId: string } | null>(null)`, dazu `lockedRef` für die Kürzel. `Screen` bleibt `'home' | 'create' | 'open' | 'vault'`; die Sperre ist ein Overlay im Zustand `'vault'`.

**Sperren** (`afterLock(minutes?)`, ersetzt `App.tsx:600-611`):

```ts
lockEpoch.current += 1;                       // in-flight saves must not bring the plain vault back
lockReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
setVault(current => current && redactVault(current));
setLocked({ minutes, vaultId: vault.id });
setAppDialog(null); settingsReturnFocus.current = null; setPaletteOpen(false);
```

`lockVault()` (`:591-598`) wird `setBusy(true); try { await desktopApi.lockVault(); } finally { setBusy(false); afterLock(); }`. Der Knopf (`:801-804`) ruft `lockVault()` direkt: kein `navigateEditor`, kein `pendingSshAction 'lockVault'` (Typ `:181`, Dialogzweige `:815-821`, Keys `dialogs.lockVault`, `dialogs.confirmLock` entfallen). `onVaultLocked` (`:614`) ruft `afterLock(info.minutes)`; `autoLockedAfter` (`:174,309,925`) und `home.autoLocked_*` entfallen, der Grund steht auf dem Sperrbildschirm.

**Entsperren** (vom Sperrbildschirm, `onUnlock(password)`; wirft bei Fehler, der Dialog zeigt `errorText(error, t('app:errors.vaultFailed'))`):

```ts
const result = await window.desktopApi.unlockVault({ filePath: vaultPath, password });
if (result.vault.id !== locked.vaultId) { openFresh(result); return; }   // same path, other vault: like opening a new file
setVault(result.vault); setVaultPath(result.filePath); setSaved(false);
terminals.retainConnections(connectionIds(result.vault.nodes));          // tabs of connections deleted elsewhere close, as deleteSelectedNode does (App.tsx:486)
if (selectedNodeId && !findNode(result.vault.nodes, selectedNodeId)) { setSelectedNodeId(null); setEditorOpen(false); setEditorDirty(false); }
setLocked(null);
requestAnimationFrame(() => { const target = lockReturnFocus.current; lockReturnFocus.current = null; if (target?.isConnected) target.focus(); });
```

`openFresh(result)` = der gemeinsame Pfad von `handleOpenVault`/`handleCreateVault` (`setVault`, `setVaultPath`, `setScreen('vault')`, `resetForm()`, `openWelcome()`), ergänzt um `closeSecondaryWindows()`; bei abweichender Vault-ID beenden die unmontierten Panels ihre Sitzungen (Muster `closeWorkspace`, `App.tsx:585-587`).

**Wechsel** („Andere Vault-Datei“ auf dem Sperrbildschirm und der Explorer-Dialog `pendingVaultFile`, `:271-278`):

```ts
function switchVault(filePath?: string): void {
  void window.desktopApi.lockVault({ disconnect: true }).catch(() => {});   // main ends sessions and secondary windows, keys stay nulled
  setLocked(null); setVault(null); setVaultPath(null); navigateTo('open');
  if (filePath) setSelectedVaultPath(filePath); else void handleSelectVaultFile();
}
```

Bei laufenden Sitzungen fragt der Sperrbildschirm vorher mit `ConfirmDialog` (`app:lock.switchTitle`, `switchDescription`, `switchConfirm`); der Explorer-Dialog fragt wie heute. Der Öffnen-Bildschirm bleibt unverändert (`:1024-1096`); „Zurück“ führt zur Startkarte, Main ist dann gesperrt – wie heute.

**Kürzel:** `App.tsx:125` → `if (screenRef.current === 'vault' && !lockedRef.current)`. `Strg+,` braucht nichts (1.5).

**Render:** Der Vault-Zweig liefert ein Fragment: `<main className="vault-shell" inert={locked !== null}>…</main>{locked && <LockScreen … />}`. Der Dialog ist **Geschwister** der Shell, nicht Kind (sonst wäre er selbst inert). `settingsVault` (`:771`) bleibt.

**Willkommens-Tab beim Öffnen:** `openWelcome()` nach `resetForm()` in `handleOpenVault`, `handleCreateVault` und `openFresh` (siehe 4.4). Nicht nach einer Wiederaufnahme.

### 3.3 Komponente `LockScreen` (neu `src/renderer/src/components/LockScreen.tsx`, CSS `src/renderer/src/lock-ui.css`)

```tsx
interface Props {
  vaultName: string; minutes?: number; running: number; hasRunning: boolean;
  /** Rejects with the unlock error; the dialog shows it under the field. */
  onUnlock?: (password: string) => Promise<void>;   // absent in secondary windows
  onSwitch?: () => void;
}
```

- `<dialog className="lock-screen" aria-labelledby aria-describedby onCancel={e => e.preventDefault()} onClose={() => ref.current?.showModal()}>` – Effekt beim Mount: `showModal()`, Passwortfeld `autoFocus`. `useNativeSurfaceBlock(true)`.
- Inhalt in `.welcome-card` (vorhandene Karte der Startkarte, `styles.css:45`): `.brand.large-brand` mit `.brand-mark` (36 px, erlaubte Größe laut Design-Doku), `h1` `app:lock.title` („Vault „{{name}}“ gesperrt“), bei `minutes` eine Zeile `app:lock.autoLocked` (`role="status"`), Zeile `app:lock.sessions` („{{count}} Sitzungen laufen weiter.“), Formular: `app:open.password`, `.error-message` `role="alert"`, `.form-actions` mit Sekundärknopf `app:lock.switch` („Andere Vault-Datei“) und Primärknopf `app:lock.unlock` („Entsperren“; während `pending` `app:open.submitting`). Enter sendet ab. Kein „Zurück“, kein Einstellungen-Link.
- Nebenfenster (`onUnlock` fehlt): statt Formular nur `app:lock.secondary` („Entsperre den Vault im Hauptfenster.“).
- Eigener `pending`-State im Dialog, nicht das globale `busy` (ein abgebrochener Save könnte `busy` mitten im Entsperren zurücksetzen).
- `ConfirmDialog` für den Wechsel wird innerhalb von `LockScreen` gerendert (verschachtelter Dialog liegt im Top-Layer darüber).
- CSS, nur Tokens, keine Bewegung:

```css
/* Lock screen: opaque over the whole window and every other dialog; no motion (security surface, Enter unlocks). */
.lock-screen[open] { position: fixed; inset: 0; display: grid; place-items: center; width: 100%; height: 100%; max-width: none; max-height: none; margin: 0; padding: var(--space-24); border: 0; background: var(--color-bg-app); color: var(--color-text); }
.lock-screen::backdrop { background: var(--color-bg-app); }
.lock-screen .form-actions { justify-content: space-between; }
```

`[open]` ist nötig: ohne die Bedingung wäre der Dialog vor `showModal()` sichtbar. Hintergrund bewusst `--color-bg-app` (undurchsichtig), nicht `--color-backdrop` (72 %), sonst scheinen Terminals durch.

**Barrierefreiheit:** `showModal()` macht alles außerhalb inert, `inert` auf der Shell hält das auch bei einem (theoretisch) geschlossenen Dialog; Tab-Reihenfolge Feld → Andere Datei → Entsperren; `aria-labelledby` Titel, `aria-describedby` Grund/Sitzungszeile; Fehler als `role="alert"`. Escape tut nichts.

### 3.4 Nebenfenster (`SecondaryWindow.tsx`)

`const [locked, setLocked] = useState(false)`; Effekte `onVaultLocked(() => setLocked(true))`, `onVaultUnlocked(() => setLocked(false))`. Render wie im Hauptfenster: `<main className="vault-shell secondary-shell" inert={locked}>…</main>{locked && <LockScreen vaultName={…} … />}` – den Vault-Namen kennt das Nebenfenster nicht; `vaultName` ist dort optional und der Titel lautet `app:lock.titlePlain` („Vault gesperrt“). Palette-Kürzel (`:100`) mit `!locked`. Katalog bleibt im Speicher (ohnehin redigiert), `broadcastCatalog` nach dem Entsperren frischt ihn auf. Fenster schließen während der Sperre: nativer Dialog wie heute (`index.ts:151` fällt auf `confirm = true`).

### 3.5 Sicherheit

- **Schlüssel und Klartext in Main** sind nach dem Sperren weg (`session.ts:120-121`, unverändert). Alle Vault-Leser werfen `core.vaultLocked`.
- **Renderer** hält nur `redactVault(vault)`: `nodes` über `redactSecrets`, `ai` entfernt; Workflows und Workspaces bleiben (keine Geheimnisse). Formular-Entwürfe bleiben im Komponentenzustand – darunter ein vom Nutzer selbst getipptes Passwort; das ist seine Eingabe, kein Vault-Geheimnis.
- **Entsperren** ist derselbe Pfad wie das Öffnen (`vault:unlock`, `requirePassword`, Datei lesen, Argon2id): kein neuer Kanal, kein Passwort-Caching. Brute-Force-Kosten sind die KDF, wie beim Öffnen; einen Zähler gibt es heute nicht und er kommt nicht.
- **Keine Leck-Pfade:** Top-Layer-Dialog über allen Dialogen und Meldungen; `inert` auf der Shell; Close-Watcher-Bypass durch `onClose → showModal()`; RDP-Fläche versteckt; Palette-Kürzel aus; `Strg+,` blockiert; DevTools aus; Fenstertitel fest („Shellherd“); Taskleisten-Vorschau zeigt den undurchsichtigen Dialog.
- **Nebenfenster** haben kein Passwortfeld (`unlockVault` ist ohnehin `requireMain`, `index.ts:268`).
- **Was bleibt:** Speicher laufender Sitzungen (1.3); eine offene native Rückfrage (Host-Schlüssel) läuft unabhängig; ein in Flug befindlicher Save endet mit dem lokalen Schlüssel (`session.ts:102-103`) und wird vom Renderer per Epoch ignoriert.

### 3.6 Entsperren und Dateistand

`unlock()` liest die Datei immer neu. Regel: **Nach dem Entsperren gilt die Datei.** Hat ein anderes Programm sie geändert, übernimmt der Renderer `result.vault`; Tabs gelöschter Verbindungen schließen (`retainConnections`), ein verwaistes Editor-Ziel schließt den Editor, der aktive Workspace wird „ungespeichert“, wenn er fehlt. Andere Vault-ID (Datei ersetzt) → Behandlung wie neues Öffnen (Tabs, Layout, Nebenfenster weg, Willkommens-Tab). Datei weg oder defekt → der Fehler erscheint auf dem Sperrbildschirm, Sitzungen laufen weiter, „Andere Vault-Datei“ bleibt der Ausweg. Ein ungespeicherter Formular-Entwurf überlebt die Wiederaufnahme und speichert später gegen den neuen Stand (`persistVault` arbeitet immer auf `vaultRef.current`).

### 3.7 Verhalten während der Sperre (Übersicht)

| Was | Verhalten |
|---|---|
| SSH/Container-/Pod-Terminals, RDP, SFTP, Cluster, Assistent | laufen weiter; Ausgabe in verdeckte Panels |
| Neue Verbindung, Reconnect, Tab-/View-Transfer, Workspace-Fenster | gesperrt (`core.vaultLocked`), per `inert` ohnehin unerreichbar |
| Auto-Upload, Remote-Bearbeitung | laufen in Main weiter; die Dateiansicht aktualisiert sich dank 3.1 auch weiter |
| Container-Inventar-Poller | Fehlerzeile bis zum Entsperren, heilt binnen 10 s |
| Cluster-Reconnect | scheitert, versucht mit Backoff weiter |
| Leerlauf-Trennung, Keepalive | unverändert aktiv; eine Getrennt-Leiste wartet verdeckt |
| Auto-Sperre | `minutes()` liefert gesperrt 0, kein zweites Sperren; Entsperren setzt `touch()` |
| Meldungen | erscheinen erst nach dem Entsperren |

## 4. Entwurf B: Willkommens-Tab

### 4.1 Modell (`terminal-tabs.ts`, `src/shared/windows.ts`)

`TabConnection.view?: 'files' | 'containers' | 'welcome'` (`windows.ts:12`). Neu in `terminal-tabs.ts`:

```ts
export const WELCOME_HOST = 'welcome';
/** The welcome page as a tab: no session, never saved, never transferred. */
export const welcomeConnection = (): TerminalConnection => ({ id: WELCOME_HOST, name: t('terminal:tabs.welcome'), protocol: 'cmd', address: '', view: 'welcome' });
export const isWelcomeTab = (tab: Pick<TerminalTab, 'connection'>): boolean => tab.connection.view === 'welcome';
```

- Reducer `open` (`:109-114`): `status: action.connection.view === 'welcome' ? 'closed' : 'connecting'` → `isRunning` false, kein Trenn-Dialog beim Schließen, zählt nicht zu „aktive Sessions“.
- `retainConnections` (`:134`): zusätzlich `tab.connection.view === 'welcome'` behalten.
- `shellOf` (`:53`): `view === 'welcome'` → `null` (Assistent und Palette sehen keinen Shell-Kontext).
- `savedLayout` (`terminal-layout.ts:161`): Filter um `tab.connection.view !== 'welcome'` erweitern → nie im Workspace.
- `useTabTransfer.transferView` (`:49-50`): Tabs der Ansicht ohne Willkommens-Tab senden; nach Erfolg schließen weiterhin alle Tabs der Ansicht (`:65`) – der Willkommens-Tab verschwindet, statt zu reisen. `remapLayout` lässt den unbekannten Schlüssel fallen (`terminal-views.ts:186-192`).
- `window-ipc.ts:24` bleibt bei `['files', 'containers']`: Main lehnt einen Willkommens-Transfer ab, der Renderer sendet ihn nie.
- `protocol: 'cmd'` wie die lokale Container-Ansicht (`:38`); alle Protokoll-Weichen (`'ssh'` Dateien-Knopf, `'rdp'` Tasten, `'kubernetes'`, `'sftp'`) greifen nicht.

### 4.2 Rendering

**`SplitTerminalArea.tsx`:** neues Prop `welcomePanel?: ReactNode`. Im `tabs.map` (`:407-425`) vor den Protokoll-Weichen:

```tsx
if (tab.connection.view === 'welcome') return <section key={tab.id} className="terminal-panel welcome-panel" id={`terminal-${tab.id}`} role="tabpanel"
  aria-labelledby={`tab-${tab.id}`} hidden={!panel.visible} style={panel.style} onPointerDown={panel.onFocus}>{welcomePanel}</section>;
```

`.split-terminal-stage > .terminal-panel` (`terminal-ui.css:28`) liefert Position und Bühne; `.welcome-page { flex: 1; overflow: auto }` (`styles.css:104`) füllt die Spalte. Kein neues CSS außer `.terminal-tab[data-fixed] { cursor: default; }` für den Tab-Knopf.

**`App.tsx`** gibt `welcomePanel={<WelcomePage vaultName={vault.name} version={version} … />}` mit den heutigen Props (`:868-870`) und entfernt den direkten Render. `WelcomePage.tsx` bleibt unverändert.

**`TerminalTabs.tsx:50-63`:** für `isWelcomeTab(tab)` kein Statuspunkt, kein `ConnectionIcon`, Titel nur `label`, `data-fixed` am Knopf. Schließen-Knopf wie bei jedem Tab.

### 4.3 Nur schließen: was gesperrt ist

| Aktion | Wo | Regel |
|---|---|---|
| Ziehen (Andocken, Umsortieren, Tear-off, auf Ansichts-Tab) | `beginTabDrag` `SplitTerminalArea.tsx:206-212`, Kopfleiste `:352-355` | `isWelcomeTab` → kein Drag-Start; Klick wählt weiterhin |
| Teilen (verschiebt den aktiven Tab) | Layout-Menü `:387-389` | `disabled`, wenn der aktive Tab der Pane ein Willkommens-Tab ist |
| „Aktiven Tab verschieben“ | `:392-395` | nicht rendern, wenn aktiver Tab Willkommen |
| Ansicht in anderes Fenster | `useTabTransfer.transferView` | Willkommens-Tab wird nicht gesendet und schließt |
| Transfer-IPC | `window-ipc.ts:24` | Schema lehnt `view: 'welcome'` ab |
| Workspace speichern | `savedLayout` | ausgefiltert |
| Bereich zusammenführen, „Als eigene Ansicht“, Ansicht schließen | unverändert | bewegen die ganze Pane bzw. alle Tabs, nicht den Tab allein |

### 4.4 Öffnen

- `openWelcome()` in `App.tsx`: `const open = reusableTab(terminals.tabs, terminals.activeTabId, welcomeConnection()); if (open) terminals.select(open.id); else terminals.open(welcomeConnection());` – `sameTarget` (`terminal-tabs.ts:62-65`) erkennt den offenen Tab über `id`/`view`. Der neue Tab landet per `syncViews` im fokussierten Bereich der aktiven Ansicht.
- **Beim Öffnen eines Vaults:** nach `resetForm()` in `handleOpenVault` (`:391-394`), `handleCreateVault` (`:354-357`) und `openFresh` (3.2). Nicht nach einer Wiederaufnahme vom Sperrbildschirm. Ein geöffneter Workspace ersetzt die Tabs (`terminals.restore`, `:570`) und damit den Willkommens-Tab; er kommt nicht zurück, bis der Nutzer ihn öffnet.
- **Menüeintrag:** im „+“-Picker jedes Bereichs (`ConnectionPicker.tsx`) unter den Treffern ein fester Knopf `connection-picker-option connection-picker-welcome` mit `vault:picker.welcome` („Willkommensseite“), `disabled={disabled || limitReached}`, Prop `onWelcome?: () => void` (Nebenfenster lassen es weg → Eintrag fehlt dort). `SplitTerminalArea` reicht `onWelcome` durch (`:360-361`); App setzt `terminalLayout.setFocused(paneId)` und ruft `openWelcome()`. Die Suche filtert den Eintrag nicht (er steht unter der Trefferliste, auch bei „Keine passende Verbindung“).
- Hinweis im leeren Bereich (`terminal:area.emptyHint`): „Verbindung aus der Liste öffnen, einen Tab hier ablegen oder über + die Willkommensseite zeigen.“

### 4.5 Leerer Bereich

`terminal-area` ist immer sichtbar: `hidden` (`App.tsx:860`), `visible={…}` (`:862`) und die Klasse `no-terminals` (`:859`, CSS `styles.css:83`) entfallen. Ohne Tabs zeigt die Wurzel-Pane `.empty-pane` („Leerer Bereich“, Hinweis, „Hier verbinden“, `SplitTerminalArea.tsx:359,403-404`) plus „+“-Picker. Der Editor ist dann ein Seitenpanel neben der leeren Bühne statt voller Breite; auf schmalen Fenstern verdeckt er die Bühne wie bisher (`styles.css:92`).

### 4.6 Workspace-Bezug

`hasTabs` für `WorkspaceControls` (`App.tsx:794`) und der Fallback von `workspaceDirty` (`:783`) zählen nur `!isWelcomeTab`; die JSON-Vergleiche nutzen `savedLayout` und sehen den Tab ohnehin nicht. „Workspace schließen“ setzt Tabs zurück (`:585`) – der Willkommens-Tab geht mit; das ist die Nutzerdefinition „geschlossen bleibt er weg“.

## 5. i18n, Tokens, Motion-Gate

**`app.json` (de-DE/en-US):**

| Key | de | en |
|---|---|---|
| `lock.title` | Vault „{{name}}“ gesperrt | Vault “{{name}}” locked |
| `lock.titlePlain` | Vault gesperrt | Vault locked |
| `lock.autoLocked_one/_other` | Automatisch gesperrt nach {{count}} Minute(n) ohne Eingabe. | Locked automatically after {{count}} minute(s) without input. |
| `lock.sessions_one/_other` | {{count}} Sitzung läuft weiter. / {{count}} Sitzungen laufen weiter. | {{count}} session keeps running. / {{count}} sessions keep running. |
| `lock.unlock` | Entsperren | Unlock |
| `lock.switch` | Andere Vault-Datei | Other vault file |
| `lock.switchTitle` | Andere Vault-Datei öffnen? | Open another vault file? |
| `lock.switchDescription` | Alle Verbindungen in allen Fenstern werden getrennt. Danach wählst du die Datei aus und gibst ihr Passwort ein. | All connections in all windows will be disconnected. Then you choose the file and enter its password. |
| `lock.switchConfirm` | Trennen und wechseln | Disconnect and switch |
| `lock.secondary` | Entsperre den Vault im Hauptfenster. | Unlock the vault in the main window. |
| `settings.autoLock.hint` (ändern) | Sperrt den Vault, wenn in keinem Shellherd-Fenster Maus oder Tastatur benutzt wurde. Offene Sitzungen und ungespeicherte Eingaben bleiben erhalten. | Locks the vault when neither mouse nor keyboard was used in any Shellherd window. Open sessions and unsaved input are kept. |
| entfernen | `dialogs.lockVault`, `dialogs.confirmLock`, `home.autoLocked_one/_other` | |

Wiederverwendet: `app:open.password`, `app:open.submitting`, `app:errors.vaultFailed`, `app:openVaultFile.*`. `terminal.json`: `tabs.welcome` „Willkommen“ / “Welcome”, `area.emptyHint` angepasst. `vault.json`: `picker.welcome` „Willkommensseite“ / “Welcome page”. Alle Keys als volle Literale; `i18n-catalog.test.ts` (d) meldet die entfernten Keys, wenn sie nicht aus beiden Katalogen verschwinden.

**Tokens:** `lock-ui.css` nutzt nur `var(--…)`; `.welcome-card`, `.brand-mark`, `.error-message`, `.form-actions`, `.primary-button`/`.secondary-button` kommen aus `styles.css`. Kein neuer Token.

**Motion-Gate (`docs/design-system.md`):** neue Zeile „Sperrbildschirm (`.lock-screen`) | Timer oder Klick, Entsperren per Enter | nicht | Sicherheitsfläche erscheint sofort, Tastatur schließt sie | – | –“ und „Willkommens-Tab (`.welcome-panel`) | Tab | nicht | wie Tabs | – | –“. Unter „Ebenen“ ein Satz: „Der Sperrbildschirm ist ein modaler `<dialog>` im Top-Layer und liegt über allen Ebenen, auch über `--layer-toast`.“ `design-tokens.test.ts` R7 verlangt keinen `prefers-reduced-motion`-Block, weil die Datei keine Bewegung enthält.

## 6. Tests und run-app

| Datei | Prüft |
|---|---|
| `src/main/vault/session.test.ts` | `lockedFilePath()` ist nach `lock()` der Pfad, nach `unlock()` `undefined`; Schlüssel bleibt genullt (bestehender Test) |
| `src/shared/vault/connections.test.ts` | `redactVault`: keine SSH-/RDP-Geheimnisse, kein `ai`, Workflows/Workspaces/Settings bleiben, Eingabe unverändert |
| `src/renderer/src/terminal-tabs.test.ts` | Willkommens-Tab öffnet mit `closed`, `isRunning` false, `reusableTab` findet ihn, `retainConnections` behält ihn, `shellOf` null, keine Zugangsdaten |
| `src/renderer/src/terminal-layout.test.ts` | `savedLayout` lässt den Willkommens-Tab aus (wie lokale Container-Tabs) |
| `src/main/window-ipc.test.ts` | `tabs:transfer` lehnt `view: 'welcome'` ab (`core.invalidWindowRequest`) |
| `src/renderer/src/hooks/usePersistVault.test.ts`, `auto-lock.test.ts` | unverändert grün (Epoch, Timer) |
| automatisch | `design-tokens.test.ts`, `i18n-catalog.test.ts`, `ui-text.test.ts`, `version.test.ts` (0.15.0) |

**run-app (`.claude/skills/run-app/screens.mjs`):** zwei Blöcke, Passwort `synthetic-vault-demo` wie in `demo-setup.mjs`.

- `lock`: `web-01` verbinden, `.lock-button` klicken, `waitFor('dialog.lock-screen[open]')`, Screenshot `lock-screen`; Gegenprobe `document.querySelector('.vault-shell').inert === true`; Passwort füllen, `.lock-screen .primary-button`, `waitFor(!dialog.lock-screen[open])`, dann `count('.terminal-tab-close') >= 1` und `.xterm` noch da (Sitzung überlebt). Falsches Passwort zuerst → `.lock-screen .error-message` sichtbar.
- `welcome`: nach `closeTabs()` `.terminal-tab-add` klicken, `.connection-picker-welcome` klicken, `waitFor('.welcome-page')`, Screenshot `welcome`; Drag-Gegenprobe nicht nötig (reiner Code-Pfad).
- `closeTabs()` (`screens.mjs:39-50`) schließt den Willkommens-Tab über seinen Schließen-Knopf ohne Dialog – keine Anpassung. `SKILL.md` listet `lock-screen.png` und `welcome.png`.
- Manuell im Review: Auto-Sperre mit 1 Minute → Sperrbildschirm nennt den Grund, Terminal-Tab lebt weiter; Nebenfenster per Tear-off öffnen, sperren → Nebenfenster zeigt den Hinweis, entsperren → beide frei; Escape zweimal auf dem Sperrbildschirm → bleibt.

## 7. Regeln und Risiken: was ausdrücklich nicht getan wird

- **Kein Pausieren** von Pollern, Reconnects oder Streams während der Sperre; Fehler heilen sich (3.7). Einzige Main-Ausnahme ist der gelockerte SFTP-Wächter.
- **Kein neuer Unlock-Kanal**, kein Passwort-Cache, kein Fehlversuchszähler. Entsperren = Öffnen.
- **Kein Löschen** von Zugangsdaten laufender Sitzungen (1.3); kein Schließen von Discovery-Helfern, Cluster-Sitzungen oder Assistent-Streams.
- **Keine Animation** des Sperrbildschirms; kein `--color-backdrop` (durchscheinend).
- **Kein Willkommens-Tab in Nebenfenstern**, kein Speichern im Workspace, kein Merken „nicht mehr zeigen“.
- **Kein neuer Protokollwert**: `view: 'welcome'` statt `protocol: 'welcome'`, damit `PROTOCOLS`, Labels, Schemata und Formulare unberührt bleiben.
- **Kein eigener Tab-Typ**: ein Willkommens-Tab zählt zum 16-Tab-Limit (`MAX_SSH_SESSIONS`). Mit 15 Sitzungen und offenem Willkommens-Tab meldet die 16. Verbindung das Limit; schließen hilft. Dokumentieren.
- **Sperrknopf ohne Rückfrage**: es wird nichts getrennt, nichts geht verloren.
- **Explorer-Öffnen und „Andere Vault-Datei“ trennen** weiterhin alles (Nutzerentscheidung) – über `lockVault({ disconnect: true })`, nicht über Unmount-Nebenwirkungen.
- **Bindende Punkte früherer Specs:** Sperr-Epoch (Timeouts-Validierung B3/K10/K11) bleibt; `vault:activity` ohne Payload bleibt; Auto-Lock-Klasse unverändert. **Aufgehoben** durch die Nutzerentscheidung: N4 („alle Sitzungen sauber getrennt“) und R9 („Formulareingaben gehen verloren“) der Timeouts-Spec sowie die Handbuch-Sätze dazu (`handbuch.md:61-62,91-97,363`, `manual.md:62-63,88-96,361`).
- **Risiko Close-Watcher:** die `onClose → showModal()`-Schleife ist die Absicherung; ein Review prüft zweimal Escape.
- **Risiko RDP:** der Helfer versteckt die Fläche per `rdpVisible(false)` (`RdpPanel.tsx:121`); bricht diese IPC-Kette, bliebe der Remote-Desktop sichtbar, denn kein DOM-Element kann eine native Fläche verdecken. run-app deckt RDP nicht ab (SKILL.md), deshalb manuell prüfen.
- **Risiko Katalog-Parität:** `app.json` (Task 1C), `terminal.json`/`vault.json` (Task 1B) und `App.tsx` (2A) nutzen die Keys aus Abschnitt 5; der Orphan-Test ist erst nach Welle 2 grün.

## 8. Stufe 1 gegenüber Extras

**Stufe 1:** Main-Sperre ohne Trennen (3.1), `redactVault`, `LockScreen` in Haupt- und Nebenfenster, Wechsel über `disconnect`, Palette-Kürzel aus, SFTP-Wächter, Willkommens-Tab mit Picker-Eintrag und Einschränkungen (4.1–4.6), Texte, Design-Doku-Zeilen, Tests, run-app-Blöcke, Handbuch/Manual, CHANGELOG, 0.15.0.

**Extras (bewusst weggelassen):** „Willkommen nicht mehr zeigen“ merken; Poller pausieren (`vault:locked` im Scheduler); „Hauptfenster anzeigen“-Knopf im gesperrten Nebenfenster (neuer Kanal); Fehlversuchszähler/Verzögerung beim Entsperren; Tastenkürzel „Vault sperren“; Sperrgrund „manuell“ als Zeile; Willkommens-Tab ohne Limit-Anrechnung; Welcome-Tab-Icon (die Marke gibt es nur in 24/36 px).

## 9. Zerlegung in parallele Tasks

| Welle | Task | Dateien (exklusiv) | Abhängigkeit |
|---|---|---|---|
| 1 | **1A Main Sperre** | `src/main/vault/session.ts` + `session.test.ts`, `src/main/vault/ipc.ts`, `src/main/index.ts`, `src/main/files/ipc.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/shared/vault/connections.ts` + `connections.test.ts` (`redactVault`) | – |
| 1 | **1B Tab-Modell Willkommen** | `src/shared/windows.ts`, `src/renderer/src/terminal-tabs.ts` + `.test.ts`, `terminal-layout.ts` + `.test.ts`, `hooks/useTabTransfer.ts`, `components/TerminalTabs.tsx`, `components/SplitTerminalArea.tsx`, `components/ConnectionPicker.tsx`, `terminal-ui.css`, `src/main/window-ipc.test.ts` (Assertion), `src/shared/locales/{de-DE,en-US}/{terminal,vault}.json` | – |
| 1 | **1C Sperrbildschirm** | neu `components/LockScreen.tsx`, neu `lock-ui.css`, `src/shared/locales/{de-DE,en-US}/app.json` (alle Keys aus 5, inkl. Löschungen), `docs/design-system.md` (Gate-Zeilen, Ebenen-Satz) | – (Prop-Vertrag aus 3.3) |
| 1 | **1D Doku und Version** | `docs/handbuch.md`, `docs/manual.md`, `CHANGELOG.md`, `CHANGELOG.en.md`, `package.json`, `package-lock.json`, `.claude/skills/run-app/screens.mjs`, `.claude/skills/run-app/SKILL.md` | – (Verhalten aus Spec) |
| 2 | **2A Hauptfenster** | `src/renderer/src/App.tsx`, `src/renderer/src/styles.css` (`.no-terminals` weg) | 1A, 1B, 1C |
| 2 | **2C Nebenfenster** | `src/renderer/src/SecondaryWindow.tsx` | 1A, 1C |

Gate nach jeder Welle: `npm run typecheck`, `npx vitest run`. Nach Welle 1 schlagen `i18n-catalog` (verwaiste/fehlende Keys bis 2A) und `typecheck` (neue `DesktopApi`-Methoden ohne Nutzer sind erlaubt; `WelcomePage`-Import in `App.tsx` bleibt bis 2A) nur dort an, wo 2A den Vertrag schließt – die Validierung sollte das Gate für Welle 1 auf `typecheck` plus die Tests der geänderten Module begrenzen oder 1C die alten Keys erst in 2A löschen lassen. Empfehlung: **1C behält `dialogs.lockVault`, `dialogs.confirmLock`, `home.autoLocked_*` und 2A löscht sie** – dann ist jede Welle vollständig grün. Nach Welle 2: run-app nach Abschnitt 6.

## 10. Rulings-Vorschläge

- **R1** Sperren nullt nur den Schlüssel und verwirft das Klartext-Vault-Objekt in Main; Sitzungen, Nebenfenster, Helfer, Cluster und Assistent laufen weiter — Nutzerentscheidung; hebt N4/R9 der Timeouts-Spec auf — Kosten: Zugangsdaten laufender Sitzungen bleiben im Prozessspeicher (1.3), dokumentiert.
- **R2** Der Renderer hält während der Sperre `redactVault(vault)` (SSH/SFTP-Auth → agent, RDP-Passwort und `ai` weg); Formular-Entwürfe bleiben im Komponentenzustand — Komponentenbaum lebt weiter, keine Geheimnisse im Renderer — Kosten: ein getippter Entwurf bleibt im Speicher (eigene Eingabe).
- **R3** Sperrbildschirm ist ein modaler `<dialog>` im Top-Layer, undurchsichtig (`--color-bg-app`), `inert` auf der Shell, `cancel` abgefangen, `close` → sofort `showModal()`, keine Animation — nur der Top-Layer liegt sicher über offenen Dialogen und Meldungen; Close-Watcher-Bypass — Kosten: eine Dialog-Regel, eine CSS-Datei.
- **R4** `useNativeSurfaceBlock(true)` im Sperrbildschirm — native RDP-Flächen lägen sonst darüber — Kosten: keine.
- **R5** Nebenfenster sperren mit (ohne Passwortfeld, Hinweis aufs Hauptfenster); `vault:locked`/`vault:unlocked` gehen an alle Fenster — Nutzerentscheidung „nicht schließen“ — Kosten: ein Kanal `vault:unlocked`, zwei Listener.
- **R6** Entsperren ist `vault:unlock` mit demselben Pfad; Main vergleicht mit `lockedFilePath()`: gleich → `onSessionChange` entfällt; der Renderer übernimmt den Dateistand, schließt Tabs gelöschter Verbindungen, behandelt eine andere Vault-ID wie ein neues Öffnen — Datei gilt, kein zweiter Pfad — Kosten: ein gemerkter Pfadstring in Main.
- **R7** „Andere Vault-Datei“ und Explorer-Öffnen laufen über `lockVault({ disconnect: true })` (Main trennt alles und schließt Nebenfenster) und den vorhandenen Öffnen-Bildschirm — deterministisch statt Unmount-Nebenwirkung — Kosten: ein optionales Flag am bestehenden Kanal.
- **R8** Der Sperrknopf fragt nicht mehr nach; `pendingSshAction 'lockVault'`, `dialogs.lockVault`, `dialogs.confirmLock`, `home.autoLocked_*` entfallen — nichts wird getrennt, nichts geht verloren — Kosten: keine.
- **R9** Palette-Kürzel ist während der Sperre in beiden Fenstern aus; `Strg+,` ist durch `settingsShortcutAction` schon blockiert — ein modaler Dialog über dem Sperrbildschirm wäre ein Leck — Kosten: zwei Bedingungen.
- **R10** Sitzungsgebundene SFTP-Kanäle verlangen keinen entsperrten Vault mehr (Besitzprüfung reicht); `sftpOpen`, `syncStart`, `local*` bleiben gewächtert — Dateiansicht bleibt hinter der Sperre aktuell — Kosten: eine Bedingung in `files/ipc.ts`.
- **R11** Poller und Reconnects werden nicht pausiert; Fehler heilen sich nach dem Entsperren — kleinste Lösung — Kosten: kurzzeitig „kein Vault entsperrt“ in der Container-Statuszeile nach dem Entsperren (≤ 10 s).
- **R12** Willkommens-Tab = `TerminalTab` mit `view: 'welcome'`, `id 'welcome'`, `protocol 'cmd'`, Status `closed`; nicht gespeichert, nicht gesendet (Schema lehnt ab), nicht ziehbar; Teilen und „Tab verschieben“ bei aktivem Willkommens-Tab aus; Ansichtstransfer lässt ihn zurück und schließt ihn — ganze Tab-Maschine wiederverwendet — Kosten: zählt zum 16-Tab-Limit.
- **R13** Der Willkommens-Tab öffnet bei jedem frischen Öffnen oder Anlegen eines Vaults (heute wird nie ein Workspace automatisch wiederhergestellt), nicht nach einer Wiederaufnahme; ein geöffneter Workspace ersetzt ihn — Lesart von „ohne gespeicherten Workspace“ als „ohne wiederhergestellten Workspace“; die Alternative „nur bei Vaults ohne Workspaces“ würde die Workspace-Liste der Seite verstecken — Kosten: wer ihn nie will, schließt ihn je Start.
- **R14** Menüeintrag „Willkommensseite“ als fester Eintrag im „+“-Picker jedes Bereichs; ein offener Tab wird fokussiert statt verdoppelt — der Picker ist die Stelle für „hier etwas öffnen“ und existiert auch im leeren Bereich — Kosten: ein Prop durch `SplitTerminalArea`.
- **R15** Die Bühne ist immer sichtbar, `.no-terminals` entfällt; der leere Bereich zeigt den vorhandenen `.empty-pane`-Hinweis mit Verweis auf die Willkommensseite — ein Zustand weniger — Kosten: der Editor hat ohne Tabs keine volle Breite mehr.
- **R16** Version 0.15.0 — neue Funktion — Kosten: keine.
