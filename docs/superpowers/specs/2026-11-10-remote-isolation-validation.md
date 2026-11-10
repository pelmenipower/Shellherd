# H5 Fernansicht-Isolation: Validierung (bindend)

Prüfer: Opus, 2026-11-10. Geprüft wurde `2026-11-10-remote-isolation-design.md` gegen den Code auf `claude/feature/remote-isolation` (`cf714f0`): `src/main/{index.ts, permissions.ts, windows.ts, labs.ts, window-ipc.ts}`, `src/main/remote/*`, `src/main/ssh/ipc.ts`, `src/main/ai/ipc.ts`, `src/main/rdp/{host.ts, ipc.ts}`, `src/preload/index.ts`, `src/shared/{remote-lab.ts, remote-signal.ts, ipc.ts, locale.ts}`, `src/renderer/{csp.ts, index.html}`, `src/renderer/src/{remote-peer.ts, remote-capture-fake.ts, remote-lab.ts, i18n.ts, App.tsx}`, `components/Remote*.tsx`, `native/Shellherd.RdpHost/*.cs`, `scripts/{smoke-linux.mjs, check-linux-package.mjs, linux-after-pack.cjs, build-rdp-host.mjs}`, `electron.vite.config.ts`, `electron-builder.yml`, `.github/workflows/{ci,release}.yml`, `.claude/skills/run-app/{driver.mjs, remote-scene.mjs}`, `node_modules/electron/electron.d.ts` (44.4.2), `node_modules/electron-vite` (4.0.1), `@electron/fuses` (1.8.0). Bindend geprüft gegen SEC-01…SEC-12, R1…R12 (`2026-11-07-remote-agent-design.md:25-37`), R-H31-*, R-H4-* und deren Validierungen (V2, V9 fail-closed: `2026-11-10-holistic-hardening-validation.md:293-317`).

Ausgangslage: `npm run typecheck` ist grün. `npx vitest run`: 233 Dateien, 3796 Tests grün, 36 übersprungen.

**Urteil: ready after corrections.** Es gibt 8 Blocker, 29 Korrekturen und 14 Entscheidungen.

Dieser Anhang geht Spec und Plan vor. Was hier nicht steht, gilt aus der Spec weiter. §2 ersetzt Spec §3.1, §3.5 und die Schnittstellen in §3.6. §5 ersetzt Spec §5. §6 ersetzt Spec §7 und §8 vollständig.

---

## 1. Blocker (jeder mit Fix, bindend)

**B1: Das Medienfenster erreicht fast die gesamte Vault-, SSH-, Kube-, RDP- und Zwischenablage-IPC.**
- Beleg: `requireSshSender` (`src/main/ssh/ipc.ts:22-28`) prüft nur `BrowserWindow.fromWebContents(event.sender)` und den Hauptframe. Das Medienfenster ist ein `BrowserWindow` und besteht diese Prüfung. Die Funktion schützt rund 60 Handler: `ssh:*` (Öffnen mit Vault-Zugangsdaten), `files`/`sftp`, `kube*` (`kubernetes/ipc.ts:62-98`), `rdp*` (`rdp/ipc.ts:49-67`), `containers*`, `ai*`, `window:connection-catalog` (Verbindungsliste aus dem Vault), `clipboard:read/write` und `openExternal` (`index.ts:389-406`), `tabs:transfer` (`window-ipc.ts:103-216`).
- Folge: Ein kompromittierter Medien-Renderer (genau das Szenario von V5) kann den Inhalt der Zwischenablage lesen, mit gespeicherten Zugangsdaten SSH-, Kube- oder RDP-Sitzungen öffnen, die er selbst besitzt, und den Verbindungskatalog lesen. Diese Sitzungen räumt `closeOwnerSessions` nie ab, weil der Aufräumhaken nur in `createWindow` hängt (`index.ts:148-153`). Die Isolation aus V5 wäre damit wirkungslos.
- Fix: `requireSshSender` verlangt zusätzlich `windowRegistry.roleOf(event.sender.id) !== undefined` (Allow-List, Import aus `../windows`). Die Fehlermeldung bleibt `ssh.senderNotAllowed`. Test in `ssh/ipc.test.ts`: Ein Absender mit gültigem `BrowserWindow`, aber ohne Registry-Eintrag, wird abgelehnt. Ein registrierter Absender wird angenommen. Zusätzlich gilt K9 (Broadcast der KI-Liste).

**B2: Zwei Preload-Einträge erzeugen gemeinsame Chunks, und die brechen in der Sandbox.**
- Beleg: electron-vite 4.0.1 kennt keine isolierten Preload-Einträge (`node_modules/electron-vite/dist/chunks/lib-ClgyQuZx.js:368-470`, keine `isolatedEntries`). Mit `rollupOptions.input` aus zwei Einträgen legt Rollup jedes Modul, das beide importieren, in `out/preload/chunks/*.js` ab. `src/preload/index.ts` importiert zur Laufzeit `../shared/ipc` und `../shared/locale` (`:9,:11`). Importiert der Medien-Preload eines davon, wie die Spec es nahelegt (`IPC_CHANNELS`, `LOCALE_ARG`), entsteht ein Chunk. Ein Preload mit `sandbox: true` kann kein relatives `require('./chunks/…')` laden.
- Folge: **Der Haupt-Preload bricht ebenfalls**, die App startet ohne `desktopApi`.
- Fix:
  - `src/preload/remote-media.ts` importiert zur Laufzeit nur `electron` und `../shared/remote-media` (§2.1). Typimporte sind erlaubt.
  - `src/shared/remote-media.ts` hat **keine** Laufzeitimporte.
  - `src/preload/index.ts` und `src/shared/ipc.ts` importieren `remote-media.ts` nie zur Laufzeit. Typimporte sind erlaubt.
  - Die Werte, die auch im Haupt-Preload vorkommen (`--shellherd-locale=`), stehen als eigene Konstanten in `remote-media.ts`. Ein Test sichert die Gleichheit mit `LOCALE_ARG` (§2.2, T2).
  - Abnahme (Lead und Szene, K19): Nach `npx electron-vite build` enthält `out/preload/` genau `index.cjs` und `remote-media.cjs`. Es gibt kein `out/preload/chunks/`, und keine der beiden Dateien enthält `require("./`.

**B3: Nach Welle 1 der Spec sind Typecheck und Tests rot.**
- Beleg:
  - T1 entfernt `emergency`, `requestCapture`, `stopsPending` und `onStopsSettled` aus `lab-host.ts`. Diese Namen nutzen `lab-ipc.ts:25,37,102` und `index.ts:267,276,281`, beide erst in Welle 2 (T6).
  - T1 entfernt `accept`, `stopped` und `signal` aus `RemoteLabCommand` (`shared/remote-lab.ts:18-22`). Sie stehen in `remote-peer.ts:97,124,182,262` und dem zugehörigen Test (T7, Welle 2).
  - T2 entfernt `remoteCaptureFake` aus `DesktopApi` (`shared/ipc.ts:223`). Das Feld nutzen `preload/index.ts:25`, eine Datei ohne Besitzer, und `App.tsx:156` (T7).
  - T3 verschiebt `remote-capture-fake.ts`, obwohl `App.tsx:91` die Datei importiert.
  - Die Spec-Aussage „Welle 1 ist mit T1+T2+T3 zusammen grün“ stimmt deshalb nicht.
- Fix: Die Wellen stehen neu in §6.
  - Welle 1 ist **rein additiv**: neue Module, ein neuer Vertrag in einer neuen Datei und die Schutzmodule. Nichts Bestehendes wird entfernt, und die App läuft danach unverändert auf dem alten Pfad.
  - Welle 2 vollzieht den Wechsel (Host, Verdrahtung, Hauptfenster) und ist erst am Wellenende grün.

**B4: Die Release-Builds packen Medienseite und Medien-Preload mit, und der CI-Smoke bricht.**
- Beleg:
  - `electron.vite.config.ts` hat feste Einträge für Renderer und Preload. Spec §3.2 fügt zwei weitere hinzu, ohne Bezug auf `SHELLHERD_RELEASE`. Damit liegen `remote-media.html` und `remote-media.cjs` auch im Release-Paket (`electron-builder.yml:10` `out/**/*`). Das widerspricht „Release-Bundles enthalten den Lab-Code gar nicht mehr“ (Threat-Model `:102`).
  - `scripts/smoke-linux.mjs:35-36` erwartet `deepEqual(labs, { sync: false, remote: false, fake: false })` mit `fake: window.desktopApi.remoteCaptureFake`. Ohne das Feld ergibt sich `undefined`, und „Check packaged Linux startup“ (`ci.yml:58-66`) und `release.yml:72` werden rot. Die Datei gehört in der Spec keinem Task.
- Fix (T2, T5):
  - In `electron.vite.config.ts` gilt `const labs = process.env.SHELLHERD_RELEASE !== '1'`. Die Einträge `remote-media` für Preload und Renderer gibt es nur bei `labs`. `__SHELLHERD_LABS__` nutzt dieselbe Konstante.
  - `smoke-linux.mjs` prüft nur noch `{ sync, remote }`, beide `false`. Außerdem prüft er, dass `out/preload/remote-media.cjs` und `out/renderer/remote-media.html` **nicht** existieren, und nimmt den Marker `remote-media.cjs` in die Liste für `out/main/**` auf (`:18`).
  - `check-win-package.mjs` prüft dasselbe (§2.5).

**B5: Mit der Stopp-Semantik der Spec kann ein Fenster überleben, und „Prozessende“ ist nicht garantiert.**
- Beleg:
  - `open(): Promise<number>` liefert die ID erst nach `did-finish-load` (Spec §3.1). Endet die Sitzung während des Ladens (Ablehnen, Sperre, Ablauf, `closeOwner`), kennt `#end` keine ID und kann nichts zerstören.
  - Ein verstecktes Agentenfenster bleibt dann bestehen. `agentWindowsAlive > 0` hält den Schutz für immer, und weil ein Fenster lebt, löst `window-all-closed` (`index.ts:490-494`) nicht mehr aus. Die App beendet sich nach dem Schließen des Hauptfensters nicht.
  - `BrowserWindow.destroy()` beendet den Renderer-Prozess asynchron. „Stopp heißt Prozessende“ (Spec §0) gilt damit nicht.
- Fix (§2.3, T1 und T7):
  - `open()` erzeugt das Fenster **synchron** und gibt sofort die `webContents`-ID zurück. `ready(id)` meldet das Laden getrennt.
  - `destroy(id)` arbeitet synchron und idempotent. Es entfernt zuerst die eigenen Ende-Listener, ruft dann `webContents.forcefullyCrashRenderer()` (falls nicht zerstört) und danach `window.destroy()` auf.
  - `#end` ruft `destroy` unmittelbar nach `s.ended = true` auf.
  - Jeder Abbruch nach `open` endet die Sitzung (K8).

**B6: Die Obergrenze hebt den Schutz auf, obwohl das Agentenfenster noch lebt (fail-open).**
- Beleg: Spec §3.6 sagt: „Die Obergrenze (`byeMs + 1000`) bleibt als Fail-safe, falls `destroyed` ausbleibt.“ Bisher galt V9 ausdrücklich fail-closed (`index.ts:268-269`; Validierung H3.1 T3-5: „Solange Stopps ausstehen, bleibt der Schutz bestehen“).
- Folge: Fehlt `destroyed`, gibt die Obergrenze Shellherd-Fenster für eine möglicherweise noch laufende Aufnahme frei.
- Fix (E4, §2.4): Bei Ablauf der Obergrenze fragt `SharingProtection` live `agentsAlive()` ab, also die Zahl der Agentenfenster mit `!isDestroyed()`.
  - Ist sie 0, fällt der Schutz.
  - Sonst ruft sie `destroyAgents()` auf, startet die Obergrenze neu und **bleibt geschützt**.

**B7: Der Test für R1 kann nichts entscheiden, und der Grant ist nicht einmalig.**
- Beleg:
  - Der Fake-Pfad schluckt jede Ablehnung von `getDisplayMedia` (`remote-capture-fake.ts:16-19`) und liefert trotzdem das Testmuster. Die Linux-Szene (Fake-Modus) ist deshalb auch grün, wenn `executeJavaScript(…, true)` **keine** Aktivierung erteilt und der Handler nie läuft. T2 kann R1 so nicht beurteilen (R-H5-3).
  - `grantedSession` bleibt wahr, solange die Sitzung lebt (`lab-host.ts:161-163`). Ein Medien-Renderer, der später kompromittiert wird (nach der ersten SDP oder dem ersten Frame der Gegenseite), kann erneut Quellen anfordern, auch per Legacy-`getUserMedia` mit Desktop-Quelle (M4-Rest, Threat-Model `:17`). R4 verlangte ursprünglich einen einmaligen Grant (`remote-agent-design.md:30`).
- Fix (E1, E3, §2.3, §2.6):
  - Der Grant ist **einmalig**. Im Pfad A verbraucht ihn der Display-Media-Handler (`consumeCaptureGrant`). Die Permission-Handler prüfen nur „erteilt und nicht verbraucht“. Im Rückfallpfad B verbraucht ihn der erste Permission-Request.
  - Der Host verlangt nach `capture() === true` zusätzlich `s.grantConsumed === true`, sonst folgt `media` und `#end(s, 'failed')`. Damit fällt die Fake-Szene durch, wenn die Aktivierung fehlt.
  - T1 führt zuerst die Probe aus E1 aus und meldet Pfad A oder B.

**B8: Antworten an das Medienfenster würden den vollen Lab-Zustand offenlegen.**
- Beleg: Die Spec lässt den Antworttyp von `remote-media:action` offen. Der naheliegende Weg über `#ok()` (`lab-host.ts:813`) liefert `RemoteLabState` mit Server-URL, Kontonamen, eigenem Fingerabdruck, Geräteliste samt Pins und Stummschaltungen. Das widerspricht Spec §3.10 („Es sieht nur SDP, ICE-Kandidaten und Bild“).
- Fix: `RemoteMediaReply = { ok: true } | { ok: false; code: 'stale' | 'invalid' }` (§2.1). `mediaAction` gibt nie Zustand zurück, und Ereignisse an das Medienfenster sind nur die drei aus §2.1. Test in T7: Keine Antwort von `mediaAction` hat mehr Schlüssel als `ok` und `code`.

---

## 2. Vertrag (wörtlich umsetzen)

### 2.1 `src/shared/remote-media.ts` (neu, T1, Welle 1; keine Laufzeitimporte, B2)

```ts
import type { RemoteSignalPart } from './remote-lab';
import type { Locale } from './locale';

export const REMOTE_MEDIA_CHANNELS = { action: 'remote-media:action', event: 'remote-media:event' } as const;
/** Same value as LOCALE_ARG in ./locale; duplicated so the media preload shares no runtime module with the main preload (B2). */
export const REMOTE_MEDIA_LOCALE_ARG = '--shellherd-locale=';
export const REMOTE_MEDIA_FAKE_ARG = '--shellherd-remote-capture-fake=';
/** Evaluated by main with userGesture = true; constant, never interpolated (path A). */
export const REMOTE_MEDIA_CAPTURE_SCRIPT = 'globalThis.shellherdRemoteMedia.capture()';
export type RemoteMediaRole = 'viewer' | 'agent';
export type RemoteMediaFailure = 'peer' | 'signal' | 'media';
export type RemoteMediaAction =
  | { kind: 'signal'; part: RemoteSignalPart }      // own offer (agent) or answer (viewer) parts
  | { kind: 'stop' }                                 // stop button, or the capture track ended
  | { kind: 'failed'; code: RemoteMediaFailure };    // connection failed, description failed, capture lost
export type RemoteMediaEvent =
  | { kind: 'hello'; role: RemoteMediaRole; peerName: string; expiresAt: number }
  | { kind: 'accepted' }                             // agent: create the offer now
  | { kind: 'signal'; part: RemoteSignalPart };     // checked parts of the other side, only after a complete checked message
export type RemoteMediaReply = { ok: true } | { ok: false; code: 'stale' | 'invalid' };
export interface RemoteMediaApi {
  readonly locale: Locale;
  readonly captureFake: boolean;
  action(request: RemoteMediaAction): Promise<RemoteMediaReply>;
  onEvent(listener: (event: RemoteMediaEvent) => void): () => void;
}
/** Registered by the media page on globalThis; sourceId only in fallback path B (E1). */
export interface RemoteMediaPageHook { capture(sourceId?: string): Promise<boolean> }
```

`src/shared/ipc.ts` bekommt **keine** Medienkanäle (E5).

### 2.2 Preload, Build, CSP (T2, Welle 1)

- `src/preload/remote-media.ts`:
  - Ruft genau `contextBridge.exposeInMainWorld('remoteMedia', api)` mit `api: RemoteMediaApi` auf.
  - `locale` kommt aus `process.argv` (`REMOTE_MEDIA_LOCALE_ARG`). Ist der Wert `'en-US'`, gilt `'en-US'`, sonst `'de-DE'`.
  - `captureFake` ist `process.argv.includes(REMOTE_MEDIA_FAKE_ARG + '1')`.
  - `action` ruft `ipcRenderer.invoke(REMOTE_MEDIA_CHANNELS.action, request)` auf.
  - `onEvent` hängt einen Listener an `REMOTE_MEDIA_CHANNELS.event` und gibt eine Abmeldefunktion zurück.
  - Es gibt weder `desktopApi` noch einen anderen Kanal.
- `electron.vite.config.ts`, `const labs = process.env.SHELLHERD_RELEASE !== '1'` (B4):
  - Main: `define: { __SHELLHERD_LABS__: JSON.stringify(labs) }`.
  - Preload: `build.rollupOptions.input = { index: resolve('src/preload/index.ts'), ...(labs ? { 'remote-media': resolve('src/preload/remote-media.ts') } : {}) }`. `output` bleibt wie heute (`cjs`, `[name].cjs`).
  - Renderer: `build.rollupOptions.input = { index: resolve('src/renderer/index.html'), ...(labs ? { 'remote-media': resolve('src/renderer/remote-media.html') } : {}) }`. `resolve` kommt aus `node:path` und arbeitet relativ zum Repo-Wurzelverzeichnis.
  - CSP-Plugin: `transformIndexHtml: (_html, ctx) => [{ …, content: contentSecurityPolicy(cspMode, ctx.filename.endsWith('remote-media.html') ? 'remoteMedia' : 'main') }]`.
- `src/renderer/csp.ts`: `export function contentSecurityPolicy(mode: 'development' | 'production', page: 'main' | 'remoteMedia' = 'main'): string`. Die Hauptseite bleibt Byte für Byte gleich (bestehender Test).
  - `remoteMedia`, production, wörtlich: `default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self' data:; media-src mediastream: blob:; connect-src 'none'; img-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`
  - `remoteMedia`, development, wörtlich (K23): `default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; media-src mediastream: blob:; connect-src 'self' ws://localhost:* http://localhost:* ws://127.0.0.1:* http://127.0.0.1:*; img-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`
- `src/renderer/remote-media.html`:
  - `<!doctype html>`, `lang`-loses `<html>`, `<meta charset="UTF-8" />`, `<title>Shellherd</title>`.
  - Im Body `<main id="stage"><video id="video" autoplay muted playsinline></video><p id="status" role="status"></p><button id="stop" type="button"></button></main>`.
  - `<script type="module" src="/src/remote-media/main.ts"></script>`.
  - Kein sichtbarer Text im HTML.

### 2.3 Medienfenster im Main (T1, Welle 1): `src/main/remote/media-window.ts`

```ts
import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';
import type { RemoteMediaEvent, RemoteMediaRole } from '../../shared/remote-media';
import type { Locale } from '../../shared/locale';

export const REMOTE_MEDIA_PARTITION = 'remote-media';
export interface MediaTimers { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(handle: unknown): void }
export interface MediaWindowFactory {
  create(options: BrowserWindowConstructorOptions): BrowserWindow;
  load(window: BrowserWindow): Promise<void>;           // loadURL(dev server)/loadFile(out/renderer/remote-media.html)
  preload: string;                                       // absolute path of out/preload/remote-media.cjs
  locale(): Locale;
  captureFake: boolean;
  title(role: RemoteMediaRole, peerName: string): string;
  background(): string;
  icon?: string;
  timers: MediaTimers;
  readyMs: number;                                       // REMOTE_LAB_LIMITS.mediaReadyMs
  captureMs: number;                                     // REMOTE_LAB_LIMITS.captureMs
}
/** What RemoteLabHost sees (Electron-free). */
export interface MediaPort {
  /** Creates the window synchronously; returns its webContents id. At most one window lives; older ones are destroyed first. */
  open(input: { role: RemoteMediaRole; peerName: string }): number;
  /** true after did-finish-load within readyMs; false on timeout, did-fail-load, crash, close or unknown id. Never rejects. */
  ready(id: number): Promise<boolean>;
  /** No-op for unknown or destroyed ids. */
  send(id: number, event: RemoteMediaEvent): void;
  /** true only if the page returned exactly `true` within captureMs. Never rejects. */
  capture(id: number, sourceId?: string): Promise<boolean>;
  /** Synchronous, idempotent: drops own listeners, forcefullyCrashRenderer, destroy. Never calls onGone. */
  destroy(id: number): void;
}
export class MediaWindows implements MediaPort {
  constructor(factory: MediaWindowFactory);
  open(input: { role: RemoteMediaRole; peerName: string }): number;
  ready(id: number): Promise<boolean>;
  send(id: number, event: RemoteMediaEvent): void;
  capture(id: number, sourceId?: string): Promise<boolean>;
  destroy(id: number): void;
  destroyAll(): void;
  owns(webContentsId: number): boolean;                  // live media window (not destroyed)
  role(webContentsId: number): RemoteMediaRole | undefined;
  agentsAlive(): number;                                 // agent windows with !isDestroyed(), counted live
  /** Unexpected end only: user closed the window, renderer gone, navigation after load. */
  onGone(listener: (id: number, reason: 'closed' | 'crashed') => void): () => void;
  /** After every open and every webContents 'destroyed': current agentsAlive(). */
  onAlive(listener: (agents: number) => void): () => void;
  onDestroyed(listener: (id: number, role: RemoteMediaRole) => void): () => void;
}
```

Pflichtverhalten:
- `webPreferences`, wörtlich:
  ```ts
  { preload, partition: REMOTE_MEDIA_PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false,
    nodeIntegrationInSubFrames: false, webviewTag: false, devTools: false, spellcheck: false, backgroundThrottling: false,
    additionalArguments: [`${REMOTE_MEDIA_LOCALE_ARG}${locale}`, `${REMOTE_MEDIA_FAKE_ARG}${captureFake ? '1' : '0'}`] }
  ```
- Viewer: `width: 1280, height: 800, minWidth: 480, minHeight: 320, show: false, autoHideMenuBar: true`, dazu `title`, `backgroundColor` und `icon`. Angezeigt wird es per `once('ready-to-show', () => window.show())`.
- Agent: `width: 640, height: 360, show: false, paintWhenInitiallyHidden: true, skipTaskbar: true, focusable: false`, dazu `title` und `backgroundColor`. Es wird nie gezeigt. Der R6-Rückfall steht in E2.
- Immer gilt:
  - `window.removeMenu()` und `window.setContentProtection(true)`.
  - `webContents.setWindowOpenHandler(() => ({ action: 'deny' }))`.
  - `will-navigate` und `will-attach-webview` rufen `preventDefault` auf.
  - `page-title-updated` ruft `preventDefault` auf.
- Ereignisse:
  - Nach dem ersten `did-finish-load` gilt das Fenster als geladen. Ein späteres `did-start-navigation` mit `isMainFrame` führt zu `onGone(id, 'crashed')` (K11).
  - `render-process-gone` führt zu `onGone(id, 'crashed')`.
  - `closed` führt zu `onGone(id, 'closed')`.
  - `webContents` `destroyed` führt zu `onDestroyed` und `onAlive`.
  - Ein Ende, das `destroy` selbst auslöst, ruft **kein** `onGone` auf.
- `capture`:
  - Nur geladene Agentenfenster.
  - Pfad A: `wc.executeJavaScript(REMOTE_MEDIA_CAPTURE_SCRIPT, true)`.
  - Pfad B: `wc.executeJavaScript(\`globalThis.shellherdRemoteMedia.capture(${JSON.stringify(sourceId)})\`, true)`, wobei `sourceId` auf `/^screen:[0-9]+:[0-9]+$/` geprüft ist.
  - Ergebnis `=== true`, sonst `false`. Ein Timeout ergibt `false` (K18).
- Die Fabrik wird injiziert. `media-window.test.ts` läuft mit Fake-`BrowserWindow` und Fake-Timern. Das Modul importiert `electron` nur als Typ.

### 2.4 Schutz (T4, Welle 1)

`src/main/remote/sharing-protection.ts` (Electron-frei):

```ts
export interface ProtectionTimers { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(handle: unknown): void }
export class SharingProtection {
  constructor(deps: { apply(protect: boolean): void; agentsAlive(): number; destroyAgents(): void; timers: ProtectionTimers; capMs: number });
  /** locked || sharing || agents > 0 || cap still pending with live agents. */
  get protect(): boolean;
  setLocked(locked: boolean): void;
  setSharing(sharing: boolean): void;
  setAgents(alive: number): void;
  dispose(): void;
}
```

- `apply` läuft nur bei einer Änderung von `protect`.
- Der Schutz geht an, sobald `agents > 0` ist, also schon beim Öffnen des Agentenfensters und vor der Aufnahme (K4).
- Fällt `sharing` auf `false`, während `agents > 0` ist, startet ein Timer mit `capMs`. Bei Ablauf wirkt B6 (fail-closed).
- `setAgents(0)` löscht den Timer.

`src/main/rdp/host.ts`: `RdpSessionManager.protect(on: boolean): void`.
- Die Methode merkt `this.protected = on`.
- Ist der Wert unverändert, passiert nichts.
- Läuft der Helfer (`this.helper` gesetzt), schreibt sie genau eine Zeile `{"type":"protect","protect":<on>}`. Sonst startet sie ihn **nicht** (K14).
- `ensureHelper()` schreibt diese Zeile direkt nach `spawn` als erste, wenn `this.protected === true`.

### 2.5 Release (T5, Welle 1)

`scripts/check-win-package.mjs`:
- Exportiert `checkWinPackage({ wire, resources, asarFiles, mainTexts, outFiles })`. Die Funktion gibt `string[]` zurück (Problemliste, leer bedeutet OK). Der Hauptblock läuft nur bei direktem Aufruf (`import.meta.url === pathToFileURL(process.argv[1]).href`).
- Liest:
  - `getCurrentFuseWire('dist/win-unpacked/Shellherd.exe')`.
  - `readdir` von `dist/win-unpacked/resources`, rekursiv für `rdp-host` und `hello`.
  - `listPackage('dist/win-unpacked/resources/app.asar')` über `createRequire(require.resolve('app-builder-lib/package.json'))('@electron/asar')`, wie `check-linux-package.mjs:7-8`.
  - Den Text aller `out/main/**/*.js`.
  - Die Existenz von `out/preload/remote-media.cjs` und `out/renderer/remote-media.html`.
- Prüft mit numerischen Konstanten wie `smoke-linux.mjs:11` (`0x30` aus, `0x31` an, K29):
  - Fuses: `EnableNodeOptionsEnvironmentVariable === 0x30`, `RunAsNode === 0x31` (Kommentar: node-pty ConPTY), `EnableNodeCliInspectArguments === 0x31` (Kommentar: Playwright-Smokes, offen).
  - Ressourcen: `rdp-host/Shellherd.RdpHost.exe`, `hello/Shellherd.Hello.exe`, `icon.ico`, `icon.png`, `app.asar`.
  - Lab-freies Bundle:
    - Keiner der Marker `SyncLabHost`, `RemoteLabHost`, `SHELLHERD_SYNC_LAB`, `SHELLHERD_REMOTE_LAB` und `remote-media.cjs` steht in `out/main/**`.
    - Die asar-Liste enthält weder `/out/preload/remote-media.cjs` noch `/out/renderer/remote-media.html`.
    - Beide Dateien fehlen auch in `out/`.
- Bei Problemen gibt das Skript sie zeilenweise aus und endet mit Code 1. Sonst gibt es eine Zeile `Windows package verified: fuses, resources, lab-free bundle.` aus.

`release.yml`: neuer Schritt direkt nach `- run: npm run ${{ matrix.command }}`:
```yaml
      - if: runner.os == 'Windows'
        name: Verify Windows package
        run: node scripts/check-win-package.mjs
```

### 2.6 Host (T7, Welle 2): `src/main/remote/lab-host.ts`, `src/shared/remote-lab.ts`

`src/shared/remote-lab.ts`, Änderungen:
- `RemoteErrorCode` bekommt zusätzlich `'mediaWindow'`.
- `RemoteLabCommand` verliert `accept`, `signal` und `stopped`. Es bleiben `status`, `close`, `connect`, `signIn`, `openSession`, `goOnline`, `goOffline`, `request`, `armCapture`, `decline` und `stop`.
- `RemoteLabSession` bekommt `/** Agent: consent armed, the native dialog follows (V8). */ armed?: true`.
- `RemoteLabEvent` verliert `signal`.
- `REMOTE_LAB_LIMITS` bekommt `nativeDelayMs: 600, mediaReadyMs: 5000, captureMs: 20000`. Die übrigen Werte bleiben.

`RemoteDeps`:
- `emergency` entfällt.
- Neu ist `media: MediaPort` (Typimport aus `./media-window`).
- Neu ist `captureSource?(): Promise<string | null>`, nur für Pfad B. Die Funktion liefert die `id` der ersten Bildschirmquelle aus `desktopCapturer`. Fehlt sie, gilt Pfad A.

Öffentliche API von `RemoteLabHost` (alles andere ist privat):
```ts
get enabled(): boolean; get sharing(): boolean;
onEvent(listener: (owner: number, event: RemoteLabEvent) => void): () => void;
onSharingChange(listener: (sharing: boolean) => void): () => void;
action(owner: number, raw: unknown): Promise<RemoteLabReply>;
mediaAction(webContentsId: number, raw: unknown): Promise<RemoteMediaReply>;
mediaGone(webContentsId: number, reason: 'closed' | 'crashed'): void;
/** Agent session in state 'granted' whose media window is this one, grant not consumed, not ended. */
grantedSession(webContentsId: number): string | null;
/** Same condition as grantedSession; marks the grant consumed (once). */
consumeCaptureGrant(webContentsId: number): string | null;
/** The live captured agent session with this media window (consumed or not), for the check after getSources. */
isCaptureSession(webContentsId: number, sessionId: string): boolean;
closeOwner(owner: number): void;
reset(reason?: 'locked'): void;
```
Es entfallen `captureGranted`, `isGranted`, `requestCapture`, `stopsPending`, `onStopsSettled`, `#stopped`, `#pendingStops`, `#settled`, `Sess.acked` und `#signal`. `#accept` wird intern (siehe unten).

Pflichtablauf Agent:
1. `armCapture`: Die Prüfung bleibt wie heute (`:449-466`). Dann folgen `s.armed = true` und `#after(s, L.nativeDelayMs, () => void this.#prompt(s))`, Antwort `#ok()`. `#state()` setzt `armed: true`, solange `s.armed && s.state === 'consent'`.
2. `#prompt(s)` hat dieselben Vorbedingungen wie heute `requestCapture` (`:177`), ohne Owner-Bezug. Dann `confirmCapture` wie bisher.
   - `unavailable` ergibt `s.armed = false; #publish()` (K7).
   - `declined` ergibt `#mute` und `#end(s, 'declined')`.
   - `accepted`: Lock und Deadline werden erneut geprüft wie `:187-188`, dann `s.state = 'granted'; s.captured = true; #publish()`.
3. `s.media = media.open({ role: 'agent', peerName: s.peer.name })`.
   - Ist `await media.ready(id)` falsch, folgen `#emit({ kind: 'error', code: 'mediaWindow' })` und `#end(s, 'failed')`.
   - Sonst `media.send(id, { kind: 'hello', role: 'agent', peerName, expiresAt: s.deadline })`.
4. `ok = await media.capture(id, await deps.captureSource?.() ?? undefined)`. Ist `!ok || !s.grantConsumed`, folgen `#emit error 'media'` und `#end(s, 'failed')` (B7).
5. Der bisherige `#accept`-Rumpf läuft intern (`channel`, `accept`, `#establish`, `connecting`, `sessionMs`, `#startDeadline`, `#setSharing(true)`). Danach `media.send(id, { kind: 'accepted' })`, die Frist aus K6 und `#consume(s, r.values)` mit `#startLoop`.
6. Nach jedem `await` gilt: Ist `s.ended || this.#session !== s`, wird ohne weitere Aktion zurückgekehrt. Jeder andere Abbruch ab Schritt 3 endet über `#end` (K8).

Pflichtablauf Viewer:
- In `#pollTick` nach `#establish`, `connecting` und dem neuen `s.deadline`: `s.media = media.open({ role: 'viewer', peerName })`, dann `#publish()`, dann `#consume(s, r.values)` und `#startLoop`.
- Parallel wird `ready` erwartet. Ist es falsch, folgen `mediaWindow` und `#end(s, 'failed')`.
- Ist es wahr: `s.mediaReady = true`, dann `hello` mit `expiresAt: s.deadline`, dann wird ein gepuffertes Angebot zugestellt und die Frist aus K6 gestartet (K5).

`#consume` (beide Rollen):
- Frame, `bye`, Art und V1 werden wie heute geprüft (`:690-698`). Es gibt **kein** `#emit` je Teil.
- Die Teile werden gesammelt. Bei vollständiger Nachricht läuft `checkSdp(message.data, s.role === 'viewer' ? 'offer' : 'answer')`. Ein Fehler ergibt `#emit error 'signal'` und `#end(s, 'failed')`.
- Danach `s.messages++` und der Übergang `connecting → active` mit dem Pin wie heute.
- Ist das Fenster bereit, werden alle Teile in Reihenfolge als `{ kind: 'signal', part }` an das Medienfenster gesendet, sonst in `s.inbound` gepuffert.

`mediaAction(id, raw)`:
- Schema, strikt:
  ```ts
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('signal'), part: z.unknown() }).strict(),
    z.object({ kind: z.literal('stop') }).strict(),
    z.object({ kind: z.literal('failed'), code: z.enum(['peer', 'signal', 'media']) }).strict(),
  ])
  ```
- Ohne Treffer, oder wenn `s.media !== id` oder `s.ended`, lautet die Antwort `{ ok: false, code: 'stale' }`. Ein Schemafehler bei passender Sitzung ergibt `#end(s, 'failed')` und `invalid`.
- `stop` ergibt `#end(s, 'stopped')`.
- `failed` ergibt zuerst `#emit error <code>`, dann `#end(s, 'failed')`.
- `signal`:
  - Verlangt sind ein bereiter Kanal, Zustand `connecting|active` und noch nichts gesendet (`!s.sent`). Der Agent braucht außerdem `accepted` gesendet, der Viewer ein zugestelltes Angebot. Fehlt etwas, lautet die Antwort `stale`.
  - `isSignalPart` und die Art (`agent → 'offer'`, `viewer → 'answer'`) werden geprüft, ebenso der Collector. Ein Fehler ergibt `#end(s, 'failed')` und `invalid`.
  - Bei vollständiger Nachricht: `checkSdp(data, kind)`. Ein Fehler ergibt `signal` und `#end(s, 'failed')` vor jedem Senden.
  - Danach gilt `s.sent = true`, und alle Teile gehen in Reihenfolge über `s.tail` mit `s.pending` hinaus, wie bisher in `#signal` (`:502-511`). Scheitert das Senden, folgt `#end(s, 'failed')`.
- Die Antwort ist immer nur `{ ok }` oder `{ ok, code }` (B8).

`mediaGone(id, reason)`:
- Gilt nur, wenn `s.media === id && !s.ended`.
- Viewer mit `'closed'` ergibt `#end(s, 'stopped')`.
- Alles andere ergibt `#end(s, 'failed')`.

`#end`:
- Direkt nach `s.ended = true` folgt `if (s.media !== undefined) try { deps.media.destroy(s.media) } catch {}`.
- Der Notbremsen-Block (`:729-733`) entfällt.
- Der Rest bleibt in seiner Reihenfolge erhalten.

### 2.7 Verdrahtung (T8, Welle 2)

`src/main/permissions.ts`:
```ts
export interface PermissionContext {
  remoteLabEnabled: boolean;
  /** Granted and not yet consumed for this webContents. */
  captureGranted(webContentsId: number): boolean;
  /** Fallback path B only: a screen-capture request consumes the grant; true once. */
  consumeCapture?(webContentsId: number): boolean;
}
export function decidePermission(permission: string, details: PermissionDetails, webContentsId: number | null, kind: 'request' | 'check', ctx: PermissionContext): boolean; // unchanged
export function decidePermissionRequest(permission: string, details: PermissionDetails, webContentsId: number | null, ctx: PermissionContext): boolean; // synchronous, never opens a dialog
export function registerPermissionHandlers(target: Session, ctx: PermissionContext): void; // no app hook; !remoteLabEnabled also sets a deny display-media handler
export function registerGlobalDeviceGuards(): void; // app.on('web-contents-created') bluetooth guard; idempotent
```
`decidePermissionRequest` ist im Pfad A gleich `decidePermission(…, 'request', ctx)`. Im Pfad B ruft die Funktion danach `ctx.consumeCapture`. `requestCapture` entfällt.

`src/main/remote/lab-ipc.ts`: `registerRemoteLabIpc(options)` gibt `Promise<{ host: RemoteLabHost; media?: MediaWindows }>` zurück.
- Ist `host.enabled`:
  - `const mediaSession = session.fromPartition(REMOTE_MEDIA_PARTITION)`, darauf `registerPermissionHandlers(mediaSession, { remoteLabEnabled: true, captureGranted: id => media.role(id) === 'agent' && host.grantedSession(id) !== null })`.
  - `mediaSession.setDisplayMediaRequestHandler(createDisplayMediaHandler(host, { fake }))` und `mediaSession.setSpellCheckerEnabled(false)` (K12).
  - `media.onGone((id, r) => host.mediaGone(id, r))` und `media.onDestroyed(() => void mediaSession.clearStorageData().catch(() => undefined))` (E6).
  - `app.on('will-quit', () => media.destroyAll())`.
- `createDisplayMediaHandler(host: CaptureHost, options: { fake: boolean })`, mit `CaptureHost = Pick<RemoteLabHost, 'consumeCaptureGrant' | 'isCaptureSession'>`:
  - Frame- und Video-Prüfung bleiben wie `:32-34`.
  - Dann `id = host.consumeCaptureGrant(contents.id)`. Bei `null` oder `fake` folgt `{}`.
  - Sonst `getSources` und die Antwort mit `host.isCaptureSession(contents.id, id)` wie `:39-40`.
- `remote-media:action`:
  ```ts
  ipcMain.handle(REMOTE_MEDIA_CHANNELS.action, (event, raw: unknown) =>
    event.senderFrame === event.sender.mainFrame && media.owns(event.sender.id)
      ? host.mediaAction(event.sender.id, raw) : { ok: false, code: 'stale' } satisfies RemoteMediaReply);
  ```
  Ereignisse gehen über `media.send` an `webContents.send(REMOTE_MEDIA_CHANNELS.event, event)`.
- Fabrik:
  - `preload: join(__dirname, '../preload/remote-media.cjs')`.
  - `load`: `ELECTRON_RENDERER_URL` ergibt `loadURL(\`${url}/remote-media.html\`)`, sonst `loadFile(join(__dirname, '../renderer/remote-media.html'))`.
  - `title`: `mainT('window.remoteViewer', { name })` bzw. `mainT('window.remoteAgent')`.
  - `locale: () => localeStore.get().effective`, `captureFake: process.env.SHELLHERD_REMOTE_CAPTURE_FAKE === '1'`, `background` aus den Optionen, `icon: brandIconPath()`.
- `emergencyReload` entfällt. Die Default-Session fasst `lab-ipc.ts` nicht mehr an.

`src/main/labs.ts`:
- `registerLabs(options: { sessions; onSynced; background: () => string })` gibt `{ sync, remote, media?: MediaWindows }` zurück.
- `index.ts` importiert `media-window.ts` **nur als Typ** (K24).

`src/main/index.ts`:
- Das Argument `--shellherd-remote-capture-fake` entfällt (`:137`).
- `registerGlobalDeviceGuards()` wird einmal aufgerufen, dazu `registerPermissionHandlers(session.defaultSession, { remoteLabEnabled: false, captureGranted: () => false })` (K16).
- `const protection = new SharingProtection({ apply: () => applyProtection(), agentsAlive: () => labs?.media?.agentsAlive() ?? 0, destroyAgents: () => labs?.media?.destroyAll(), timers, capMs: REMOTE_LAB_LIMITS.byeMs + 1000 })`.
  - `applyProtection` setzt `setContentProtection(protection.protect)` auf Main- und Nebenfenster und ruft `rdpSessionManager?.protect(protection.protect)` auf.
  - `createWindow` setzt den Schutz beim Erzeugen nach `protection.protect` (`:141`).
  - `protectWindows(on)` ruft `protection.setLocked(on)` auf.
  - `remoteLabHost?.onSharingChange(s => { protection.setSharing(s); <Titel wie heute> })` und `labs?.media?.onAlive(n => protection.setAgents(n))`.
  - Es entfallen `captureBlocked`, `remoteSharing` (als Schutzquelle), `unprotectTimer`, `maybeUnprotect`, `onStopsSettled` und `applySharingWindow` (K4).

---

## 3. Korrekturen (bindend)

- **K1 Zeilenangaben:** Mehrere Stellen der Spec sind falsch. Richtig sind:
  - `permissions.ts`: Dialog `:48`, Request-Regel `:22`, App-Hook `:69` (nicht `:181-182`, `:156`, `:203`).
  - `windows.ts`: `WindowRole` `:5`, `windowAt` `:64-72` (nicht `:214`, `:273-281`).
  - `RemoteConsentDialog.tsx`: Sperre `:28`, `canAccept` `:37` (nicht `:197`, `:206-210`).
  - `rdp/host.ts`: Fehlerzeile ohne Sitzung `:213-215` (nicht `:200-203`).
  - `driver.mjs`: `windows`/`use` `:115-116` (nicht `:120-121`).
- **K2 Treiber (Spec R4):** Die Konsole wird schon für alle Fenster gesammelt, über `app.context().on('console')` (`driver.mjs:63-66`). `driver.mjs` bleibt unverändert. Die Szene prüft die CSP-Meldungen wie heute.
- **K3 Ende und Fehler aus dem Medienfenster:** Der Vertrag bekommt die Aktion `{ kind: 'failed'; code }`.
  - Ein fehlgeschlagener `RTCPeerConnection`-Zustand meldet `peer`, ein Fehler bei Angebot oder Antwort `signal`, ein unerwartet endender Aufnahme-Track `stop`.
  - So bleibt `errors.peer` („Beide Geräte müssen im selben Netz sein“) für den Nutzer erhalten. Die Spec hätte nur `stop` gekannt.
- **K4 Schutz vor der Aufnahme, R11 angepasst:**
  - Der Schutz geht an, sobald ein Agentenfenster lebt (§2.4), nicht erst mit `sharing` nach dem Handshake.
  - `setBackgroundThrottling(false)` auf dem Hauptfenster (`index.ts:271-274`) entfällt, weil das Hauptfenster keine Medien mehr verarbeitet. Das Medienfenster hat `backgroundThrottling: false`. Das ersetzt diesen Teil von R11.
- **K5 Viewer-Zeitpunkt:**
  - Das Fenster öffnet nach `#establish` und nach dem Setzen von `s.deadline`, damit `hello.expiresAt` die Sitzungsfrist zeigt.
  - Ein Angebot aus `r.values` wird gepuffert, bis `ready` wahr ist.
- **K6 Frist für die eigene Beschreibung:** Liegt `L.handshakeMs` nach `accepted` (Agent) bzw. nach dem zugestellten Angebot (Viewer) keine vollständige eigene Beschreibung vor, folgen `#emit error 'signal'` und `#end(s, 'failed')`. Bisher gab es dafür nur die Fünf-Minuten-Frist.
- **K7 `unavailable`:** Ohne Fenster für den Systemdialog setzt der Host `armed` zurück, statt zu warten. Den Wiederholungsweg über den Renderer gibt es nicht mehr.
- **K8 Abbruch nach `open`:** Jeder Fehlerpfad nach `media.open` ruft `#end` auf. Es gibt kein `return { code: 'stale' }` ohne Ende, wie heute in `#accept:429,434,438`, denn sonst bliebe das Fenster (B5).
- **K9 KI-Liste:** `ai/ipc.ts:54` sendet `aiCatalogChanged` an `BrowserWindow.getAllWindows()` und damit auch an das Medienfenster und das Drag-Ghost-Fenster. Die Liste enthält Vault-Daten (Anbieter, Modelle). Neu gilt nur `[registry.main(), ...registry.secondaries()]`.
- **K10 Host-Key-Dialog:** `createKnownHosts` nimmt als Elternfenster `BrowserWindow.getFocusedWindow()` (`ssh/ipc.ts:33`), das kann das Fernansichtsfenster sein. Neu gilt: das fokussierte Fenster nur mit `windowRegistry.roleOf(id)`, sonst `windowRegistry.main()`.
- **K11 Menü, Reload, Navigation:**
  - Ohne `removeMenu()` hätte das Medienfenster das Standardmenü mit `Strg+R` (Reload).
  - Ein Reload löst kein `will-navigate` aus. Deshalb gilt `did-start-navigation` nach dem ersten Laden als Ende `crashed` (§2.3).
- **K12 Rechtschreibprüfung:** `spellcheck: false` und `setSpellCheckerEnabled(false)` verhindern, dass die neue Partition Wörterbücher aus dem Netz lädt.
- **K13 C#:**
  - `csc` aus .NET Framework 4.8 (`build-rdp-host.mjs:19-20`) kann nur **C# 5**. Nicht erlaubt sind String-Interpolation, `?.`, `nameof`, `out var` und Ausdrucksrümpfe.
  - Konstanten: `public const uint WDA_NONE = 0x0, WDA_MONITOR = 0x1, WDA_EXCLUDEFROMCAPTURE = 0x11;`.
  - P/Invoke: `[DllImport("user32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool SetWindowDisplayAffinity(IntPtr window, uint affinity);`.
  - `RdpSession.ApplyProtection(bool on)` gibt `"exclude"`, `"monitor"`, `"none"`, `"skipped"` (Child-Modus) oder `"failed"` zurück. Der Aufruf läuft auf dem UI-Thread (`Drain`).
  - Im Konstruktor wird der Schutz **vor** `window.Show()` angewandt, nach Erzeugen des Handles. Im Window-Modus wird `window.Handle` dafür vorher gelesen. `OpenRequest.Protect` kommt aus dem globalen Flag, nicht aus der Nachricht.
  - Die Rückmeldung je Sitzung ist `{"type":"protected","sessionId":…,"mode":…}`, **nicht** `status`. `host.ts:228` ignoriert jeden Typ außer `status` und loggt nur bei `SHELLHERD_RDP_DEBUG`.
  - `case "protect"` verlangt das Feld `protect` als bool (fehlt es, folgt `FormatException`).
  - Ein alter Helfer antwortet auf `protect` mit einer Fehlerzeile ohne `sessionId` (`Program.cs:118,125`). Der Main schreibt sie als `console.warn` (`host.ts:215`) und tut sonst nichts. Das ist akzeptiert.
- **K14 `protect` ohne Helfer:** `send()` startet den Helfer (`host.ts:205`). `protect` darf deshalb nicht `send` nutzen, wenn `this.helper` fehlt (§2.4).
- **K15 `check-win-package`:** Die Prüflogik ist eine reine Funktion mit Test (§2.5). Sonst liefe das Skript zum ersten Mal beim Release auf `main` und könnte ihn ungeprüft blockieren.
- **K16 Default-Session:**
  - Ein ausdrücklicher Deny-Handler für Display-Media, statt sich auf das Fehlen eines Handlers zu verlassen.
  - `registerGlobalDeviceGuards()` wird genau einmal aufgerufen. Sonst hängen zwei Sessions zwei `web-contents-created`-Haken an.
- **K17 Windows-Hinweis:**
  - Bedingung: `capabilities.platform === 'win32'`.
  - Der Text behauptet nur, was Electron schon heute leistet, plus V6 (§5). Der Linux-Hinweis bleibt für `linux`.
- **K18 `executeJavaScript`:**
  - Der Code ist konstant (`REMOTE_MEDIA_CAPTURE_SCRIPT`). Pfad B nutzt nur `JSON.stringify` einer geprüften Quellen-ID.
  - Als Ergebnis zählt nur strikt `=== true`.
  - Die Frist ist `captureMs = 20000`. Ein Wayland-Portal braucht eine Auswahl, und diese Laufzeit bleibt ungeprüft.
- **K19 Szene:**
  - Die Titelprüfung (`remote-scene.mjs:230-233`) akzeptiert jeden Titel außer `Shellherd`. Mit dem Agentenfenster „Shellherd – Bildschirmfreigabe“ wäre sie trivial wahr. Neu wird nur das Hauptfenster geprüft (URL endet auf `index.html`, ohne `role=secondary`), und zwar auf genau „Shellherd – Bildschirm wird angesehen“.
  - Die Szene prüft V8 (Systemdialog frühestens 550 ms nach dem Klick, Zeitstempel im Recorder).
  - Sie prüft den Pfad „Viewer schließt das Fenster“ (§2.8).
  - `requireLabBuild` prüft auch B2 (keine Chunks) und die Existenz der Medienseite.
- **K20 Echter Modus:** Mit `SHELLHERD_REMOTE_CAPTURE_FAKE=0` prüft die Szene unter `xvfb` (X11) nur `videoWidth > 0` statt der Pixel. Das ist der R1-Nachweis aus R-H5-3 für Pfad A.
- **K21 Umzug Fake-Capture:** T3 legt `remote-media/capture-fake.ts` neu an (Welle 1). T9 löscht `remote-capture-fake.ts` samt Test (Welle 2). Kein Task verschiebt eine Datei, die ein anderer noch importiert.
- **K22 Doku M4-Rest:**
  - `handbuch.md:814` und Threat-Model `:17,:39` nennen M4-Rest als offen. Mit E3 gilt er für das Agentenfenster als geschlossen.
  - Die neue Grenze lautet: Der Medien-Renderer ist vor der Aufnahme nicht angreifbar, weil er bis dahin keine Daten der Gegenseite verarbeitet hat. Danach ist der Grant verbraucht.
  - T10 schreibt beides um.
- **K23 Dev-CSP:** Vite fügt CSS im Dev-Modus per `<style>` ein. Die Medien-CSP braucht dort deshalb `style-src 'unsafe-inline'` (§2.2).
- **K24 Release-Marker:** `index.ts` importiert `media-window.ts` und `sharing-protection.ts` so:
  - `sharing-protection.ts` ist Electron-frei und lab-unabhängig, darf also normal importiert werden.
  - `media-window.ts` nur als `import type`. Der Pfad `remote-media.cjs` darf in Release-Bundles nicht vorkommen (§2.5).
- **K25 Text `mediaWindow`:** Der Fehler trifft auch die Agentenseite. Der Text ist deshalb allgemein (§5).
- **K26 Konfiguration als ESM:** `package.json` hat `"type": "module"`. `electron.vite.config.ts` nutzt `resolve(…)` aus `node:path`, nicht `__dirname`.
- **K27 Hauptdialog Viewer:**
  - Solange `viewerSession.state === 'connecting'`, bleibt `remoteLab:connecting` mit dem Knopf `remoteLab:stop`, wie heute (`RemoteLabDialog.tsx:160,167`).
  - Bei `active` zeigt der Dialog `remoteLab:viewerWindow` und den Knopf `remoteLab:stop`.
  - `<video>` und `remoteLab:viewing` verschwinden aus dem Hauptdialog.
- **K28 `#accept` ohne Renderer-Kommando:** Der interne Ablauf prüft `this.#online`, `isUnlocked()` und die Deadline wie `:419-422`. Jeder Fehlschlag endet die Sitzung (K8), statt `stale` an einen Renderer zu melden, der nicht fragt.
- **K29 Fuses:** `FuseState` ist zur Laufzeit nicht exportiert (`smoke-linux.mjs:10`). `check-win-package.mjs` nutzt `0x30`/`0x31` und `FuseV1Options` aus `@electron/fuses`.

---

## 4. Entscheidungen (Rulings)

- **E1 R1 (bindendes Verfahren):** T1 führt **vor** der Umsetzung eine Probe aus. Sie liegt nur im Scratchpad, wird nicht committet und läuft mit `xvfb-run -a node_modules/electron/dist/electron probe.mjs`.
  - Aufbau: Eine Partition `probe` mit protokollierendem Permission-Request- und Display-Media-Handler (`cb({})`). Ein Fenster `show: false` mit `sandbox`.
  - Fall 1: Die Seite ruft `getDisplayMedia({ video: true })` ohne Aktivierung auf, per `executeJavaScript(code, false)`.
  - Fall 2: Derselbe Aufruf mit `true`.
  - **Pfad A** gilt, wenn der Display-Media-Handler in Fall 2 aufgerufen wird. Der Report nennt außerdem die Reihenfolge Permission-Request gegen Display-Handler, `request.userGesture` in beiden Fällen und den Fehlernamen in Fall 1.
  - **Pfad B** gilt sonst, ohne Rückfrage (R-H5-3):
    - T8 setzt `deps.captureSource` (erste Bildschirmquelle aus `desktopCapturer`) und `consumeCapture` im `PermissionContext` der Medien-Session.
    - Der Display-Media-Handler der Medien-Session antwortet immer mit `{}`.
    - Die Seite nutzt `getUserMedia({ audio: false, video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId } } })`.
  - Der Lead trägt das Ergebnis als Ruling ins Ledger. Der echte Nachweis folgt in Welle 3 (K20).
- **E2 R6:** Hauptweg ist `show: false` mit `paintWhenInitiallyHidden: true` und `backgroundThrottling: false`. Mit diesen Werten bleibt die Page Visibility laut Electron „visible“ (`electron.d.ts:19425`).
  - Die Probe aus E1 prüft zusätzlich: Ein `canvas.captureStream(10)`-Track geht über ein lokales `RTCPeerConnection`-Paar, und nach 5 s ist `framesEncoded > 0`.
  - Ist das nicht der Fall, gilt der Rückfall: Agentenfenster `width: 1, height: 1, frame: false, skipTaskbar: true, focusable: false`, unten rechts in der `workArea` des Hauptbildschirms, `setIgnoreMouseEvents(true)`, angezeigt per `showInactive()`.
  - Das Verschieben außerhalb des Bildschirms ist verworfen, weil X11-Fenstermanager das Fenster zurückholen.
- **E3 Einmaliger Grant und M4-Rest:**
  - Pfad A: Der Display-Handler verbraucht den Grant. Die Permission-Handler lassen nur „erteilt und nicht verbraucht“ zu.
  - Pfad B: Der erste Permission-Request verbraucht den Grant.
  - In beiden Pfaden hat der Medien-Renderer vor dem Verbrauch noch keine Daten der Gegenseite gesehen, denn das Angebot entsteht erst nach `accepted`, die Antwort folgt später. Danach sind weitere Anforderungen abgelehnt. Das stellt den einmaligen Grant aus R4 wieder her und schließt M4-Rest für die Fernansicht (K22).
- **E4 Schutzende fail-closed:** B6. Bleibt `destroyed` aus, bleibt der Schutz an, bis `isDestroyed()` stimmt. Dazu wird erneut zerstört.
- **E5 Vertrag in einer neuen Datei:** `src/shared/remote-media.ts` statt `ipc.ts`. Gründe: B2 (kein gemeinsamer Laufzeitmodul-Import beider Preloads) und B3 (Welle 1 additiv).
- **E6 Eine Partition:** Es gibt eine flüchtige Partition `remote-media` für alle Medienfenster, immer nur ein Fenster gleichzeitig. Nach jedem Ende folgt `clearStorageData()` als best effort. Eine eigene Partition je Sitzung ist verworfen, weil sie Handler je Session und nie freigegebene Sessions bedeutet.
- **E7 Dialog schließen:** Schließen des Hauptdialogs beendet eine Viewer-Sitzung weiterhin (`RemoteLabDialog.tsx:48`). Das Schließen des Fernansichtsfensters beendet sie mit `stopped`.
- **E8 Keine Sprach- und Theme-Nachführung:** Medienfenster bekommen die Sprache beim Öffnen. Titel und Texte folgen keinem späteren Sprachwechsel (es steht nicht in der Registry, `index.ts:348-356`). Das Farbschema folgt `prefers-color-scheme` über `tokens.css`, der Fensterhintergrund nicht.
- **E9 Lab-Gating:** Die Medieneinträge gibt es nur, wenn `SHELLHERD_RELEASE !== '1'` (B4). Medienfenster entstehen nur bei aktivem Host (`remoteLabRequested`, ungepackt).
- **E10 Prozessende:** `forcefullyCrashRenderer()` vor `destroy()`. Erst damit ist „Stopp heißt Prozessende“ wahr. Die Partition teilt keinen Prozess mit Haupt- oder Nebenfenstern.
- **E11 Kein Netzfilter:** Es gibt keinen `webRequest`-Filter für die Medien-Session. Die CSP sperrt `connect-src`. Ein kompromittierter Medien-Renderer kann per eigenem WebRTC nur senden, was er ohnehin sieht. Das ist ein Restrisiko (§7).
- **E12 Fuse-Prüfung:** `RunAsNode` und `EnableNodeCliInspectArguments` werden **ausdrücklich als an** geprüft. Wer sie später abschaltet, muss die Prüfung und den Kommentar in `electron-builder.yml:63-64` mitändern.
- **E13 Medienseite:** Sie hat kein React, nutzt aber `i18n.ts` (R5 der Spec akzeptiert). Dazu kommen keine eigene `t()`, kein `innerHTML` (nur `textContent`) und keine Bewegung.
- **E14 Lab-Bruch:** wie R-H5-4. Nur das Protokoll zwischen Main und Renderer ändert sich, ohne Kompatibilitätspfad. Server, Rendezvous, Identität und Pins bleiben unverändert.

---

## 5. Texte (wörtlich; ersetzt Spec §5; T9 legt alle in de-DE und en-US an)

| Datei | Key | de-DE | en-US |
| --- | --- | --- | --- |
| `main.json` | `window.remoteViewer` | Shellherd – Fernansicht von {{name}} | Shellherd – Remote view of {{name}} |
| `main.json` | `window.remoteAgent` | Shellherd – Bildschirmfreigabe | Shellherd – Screen sharing |
| `remoteLab.json` | `viewerWindow` | Das Bild erscheint in einem eigenen Fenster „Fernansicht“. Es hat keinen Zugriff auf deinen Vault; Schließen beendet die Verbindung. | The picture appears in a separate “Remote view” window. It has no access to your vault; closing it ends the connection. |
| `remoteLab.json` | `consent.armedHint` | Der Systemdialog erscheint gleich. Bestätige dort noch einmal. | The system dialog appears in a moment. Confirm there once more. |
| `remoteLab.json` | `consent.windowsHint` | Unter Windows nimmt Shellherd seine Fenster und RDP-Flächen aus dem übertragenen Bild aus. | On Windows, Shellherd leaves its windows and RDP surfaces out of the shared picture. |
| `remoteLab.json` | `errors.mediaWindow` | Das Fenster für die Fernansicht oder Freigabe konnte nicht geöffnet werden. Es wurde nichts übertragen. | The window for the remote view or sharing could not be opened. Nothing was transferred. |

- Medienseite (nur bestehende Keys):
  - `remoteLab:connecting`, bis ein Track da ist.
  - Danach `remoteLab:viewing` mit `{ name: hello.peerName, time: formatDateTime(hello.expiresAt, 'time') }`.
  - Der Knopf heißt `remoteLab:stop`.
  - Das Agentenfenster zeigt keinen Text.
- `remoteLab:viewing` wird im Hauptdialog nicht mehr genutzt, bleibt aber durch die Medienseite belegt.
- T9 prüft mit dem Katalogtest, dass kein Key verwaist (`video`, `stream` im Hauptdialog entfallen).
- Es gibt keine dynamischen Keys. `errors.mediaWindow` steht in `REMOTE_ERROR_KEYS` als volles Literal.

---

## 6. Wellen und Tasks (ersetzt Spec §7 und §8; dateidisjunkt je Welle)

Nach jeder Welle müssen `npm run typecheck` und `npx vitest run` grün sein. Welle 1 ist mit T1+T2+T3 zusammen grün (T2 und T3 importieren den Vertrag aus T1). T4, T5 und T6 sind einzeln grün. Welle 2 ist erst mit T7+T8+T9 zusammen grün. Umsetzer committen nicht.

### Welle 1 (parallel, rein additiv; die App läuft danach unverändert auf dem alten Pfad)

| Task | Dateien (Tests daneben gehören dazu) | Pflicht | Pflicht-Tests |
| --- | --- | --- | --- |
| **T1 Vertrag + Medienfenster** | neu `src/shared/remote-media.ts`, neu `src/main/remote/media-window.ts` + `media-window.test.ts`; Probe nur im Scratchpad | §2.1, §2.3, B5, E1, E2, E10, K11, K12, K18 | `webPreferences` und Fensteroptionen je Rolle wörtlich; `removeMenu`, `setContentProtection(true)`, Open-Handler deny, `will-navigate` und `will-attach-webview` verhindert; `open` synchron, zweites `open` zerstört das erste; `ready` wahr nach `did-finish-load`, falsch nach `readyMs`, `did-fail-load` und Crash; `capture` ruft `executeJavaScript(REMOTE_MEDIA_CAPTURE_SCRIPT, true)`, `'yes'`/`1`/Timeout ergeben `false`; Pfad B lehnt eine ungültige Quellen-ID ab; `destroy` ruft `forcefullyCrashRenderer` vor `destroy`, ist idempotent und löst kein `onGone` aus; `onGone` bei `closed`, `render-process-gone` und Navigation nach dem Laden, nicht beim ersten Laden; `onAlive` und `agentsAlive` zählen live; `owns` ist nach `destroyed` falsch. **Report:** Ergebnis der Probe (Pfad A/B, R6). |
| **T2 Preload, Build, CSP** | neu `src/preload/remote-media.ts` + `src/preload/remote-media.test.ts`, `electron.vite.config.ts`, neu `src/renderer/remote-media.html`, `src/renderer/csp.ts` + `csp.test.ts` | §2.2, B2, B4 (Konfiguration), K23, K26 | Preload legt genau `remoteMedia` mit den vier Schlüsseln offen (Mock `contextBridge`); `locale` aus argv, Rückfall `de-DE`; `captureFake` nur bei `…=1`; `action` nutzt `remote-media:action`; `REMOTE_MEDIA_LOCALE_ARG === LOCALE_ARG`; Preload-Quelltext importiert zur Laufzeit nur `electron` und `../shared/remote-media` (Text-Test); Medien-CSP prod und dev als Literal; prod ohne `unsafe-inline`, `connect-src 'none'`, `img-src 'none'`; Haupt-CSP unverändert. Lead: Build-Abnahme aus B2. |
| **T3 Medienseite** | neu `src/renderer/src/remote-media/{main.ts, media-peer.ts, media-peer.test.ts, capture-fake.ts, capture-fake.test.ts, api.d.ts, remote-media.css}`; `src/renderer/src/i18n.ts` (nur `initialLocale`: `window.desktopApi?.initialLocale ?? window.remoteMedia?.locale`) | §2.1 (Seite), K3, E13; `api.d.ts` deklariert `interface Window { remoteMedia?: RemoteMediaApi }` | `media-peer.test.ts` aus `remote-peer.test.ts:106-240,306-340` übertragen: Agent `sendonly`-Transceiver, Angebot genau einmal nach `accepted`, `checkSdp` lokal vor dem Senden, Gathering-Timeout `gatherMs`; Viewer `recvonly` nach SRD, zweite vollständige Nachricht ergibt `failed{signal}` ohne zweite PC; `connectionState 'failed'` ergibt `failed{peer}`; Track-Ende ergibt `stop`; `capture()` im Fake-Modus ruft erst das echte `getDisplayMedia` auf, dann das Muster, Rückgabe `true`; echter Modus mit Ablehnung ergibt `false`; Pfad B ruft `getUserMedia` mit `chromeMediaSourceId` auf. `capture-fake.test.ts` wie `remote-capture-fake.test.ts`. CSS nur Tokens (`design-tokens.test.ts`). |
| **T4 Schutz** | `native/Shellherd.RdpHost/{NativeSurface.cs, RdpSession.cs, Program.cs}`, `src/main/rdp/host.ts` + `host.test.ts`, neu `src/main/remote/sharing-protection.ts` + Test | §2.4, B6, E4, K13, K14 | `host.test.ts`: `protect(true)` ohne Helfer startet keinen Prozess; beim Helferstart ist `protect` die erste Zeile; `protect(true/false)` bei laufendem Helfer gibt genau eine Zeile; gleicher Wert gibt keine Zeile; Zeile `{"type":"protected",…}` erzeugt kein `emit`. `sharing-protection.test.ts`: an bei gesperrt, bei `sharing`, bei `agents > 0` vor `sharing`; aus erst bei `sharing=false` und `agents=0`; Obergrenze mit `agentsAlive()=0` schaltet ab; mit lebendem Fenster ruft sie `destroyAgents`, bleibt an und startet neu; `apply` nur bei Änderung. CI `windows-latest` kompiliert den Helfer (`/warnaserror+`). |
| **T5 Release + Paket** | neu `scripts/check-win-package.mjs` + `scripts/check-win-package.test.mjs`, `.github/workflows/release.yml`, `electron-builder.yml` (nur Kommentar `:63-64`: „Still open after H5: …“), `scripts/smoke-linux.mjs` | §2.5, B4 (Smoke), K15, K29, E12 | `checkWinPackage` leer für ein gutes Paket; je ein Problem bei falscher Fuse, fehlender Ressource, Marker in `out/main`, Medienseite in asar und Medienseite in `out/`. Der Smoke prüft `{ sync, remote }` und die Abwesenheit der Medien-Dateien. |
| **T6 Absendergrenzen** | `src/main/ssh/ipc.ts` + `ipc.test.ts`, `src/main/ai/ipc.ts` (+ neuer Test `ai/ipc.test.ts`) | B1, K9, K10 | Unregistrierter `BrowserWindow`-Absender wird von `requireSshSender` abgelehnt, registrierter angenommen; Subframe abgelehnt wie bisher; `broadcast` sendet nur an Registry-Fenster; Host-Key-Dialog nimmt kein unregistriertes Fokusfenster als Eltern. |

### Welle 2 (parallel, braucht Welle 1 und den Probe-Report von T1)

| Task | Dateien | Pflicht | Pflicht-Tests |
| --- | --- | --- | --- |
| **T7 Host** | `src/main/remote/lab-host.ts` + `lab-host.test.ts`, `src/shared/remote-lab.ts` | §2.6, B7, B8, K5–K8, K28; Anmeldeteil (`#connect`, `#signIn`, `#openSession`) unverändert | Mit Fake-`media`: Ablauf Agent armCapture → kein Dialog vor 600 ms → genau ein Dialog → granted → `open` → `ready` → `hello` → `capture` → `grantConsumed` → Kanal → `accepted` → Angebotsteile → `checkSdp` → Relay erst nach vollständiger Nachricht; `decline` in der Wartezeit zeigt keinen Dialog; `unavailable` setzt `armed` zurück; `ready=false` ergibt `mediaWindow` + `failed` + `destroy`; `capture=false` und `capture=true` ohne Verbrauch ergeben `media` + `failed`; Ende während `ready`/`capture` ergibt `destroy` genau einmal und kein `capture`; Viewer: Fenster erst nach Kanal, Angebot gepuffert bis `ready`, Zustellung erst nach geprüfter vollständiger Nachricht, `a=sendrecv`/`m=application` ergeben `signal` + `failed` ohne Zustellung; ausgehend: `a=sendrecv`, `m=application`, falsche Art, zweite Nachricht, Teil vor `accepted` ergeben Ende bzw. `stale` vor jedem `channel.send`; `mediaAction` fremder ID ergibt `stale`; Antwort ohne Zustand (B8); `failed{peer}` emittiert `peer`; `mediaGone` Viewer `closed` ergibt `stopped`, sonst `failed`; K6-Frist; `#end` ruft `destroy` genau einmal, auch vor dem Kanalaufbau; `closeOwner` und `reset('locked')` zerstören; Grant nur für die Medien-ID, `consumeCaptureGrant` einmalig, Hauptfenster-ID bekommt nie einen Grant. Die alten Tests zu Beleg und Notbremse (`:1325-1350`, `:1413-1454`) entfallen. V1, V7 und V10 bleiben grün. |
| **T8 Verdrahtung Main** | `src/main/remote/lab-ipc.ts` + `lab-ipc.test.ts`, `src/main/permissions.ts` + `permissions.test.ts`, `src/main/index.ts`, `src/main/labs.ts` | §2.7, E1 (Pfad nach Report), E3, E6, K4, K12, K16, K24 | Display-Handler verbraucht den Grant einmal; zweiter Aufruf ergibt `{}`; Fake ergibt `{}` nach Verbrauch; Prüfung nach `getSources` bleibt; `remote-media:action` lehnt Hauptfenster-ID, fremde `webContents` und Subframes mit `stale` ab, ohne den Host zu rufen; Medien-Session hat Permission- und Display-Handler; Default-Session verweigert jede Aufnahme und hat einen Deny-Display-Handler; `decidePermissionRequest` öffnet nie einen Dialog; `registerGlobalDeviceGuards` idempotent; Pfad B: Request verbraucht einmal. Tests zu `emergencyReload` entfallen. |
| **T9 Hauptfenster + Texte** | `src/renderer/src/remote-peer.ts` + `remote-peer.test.ts`, `components/{RemoteLabDialog.tsx, RemoteLabDialog.test.ts, RemoteConsentDialog.tsx, RemoteShareBar.tsx}`, `App.tsx`, `remote-lab.css`, `remote-lab.ts` + `remote-lab.test.ts`, löschen `remote-capture-fake.ts` + Test, `src/preload/index.ts` (nur `remoteCaptureFake` raus), `src/shared/ipc.ts` (nur `remoteCaptureFake` raus), alle `src/shared/locales/**` | §5, K17, K21, K27; `RemoteSessionController(api, clientId, timers?)` ohne Peers und Capture, `share()` sendet nur `armCapture` | Controller sendet nie `accept`/`signal`/`stopped`; `ended` setzt `ended`; Consent: `armed` sperrt „Bildschirm freigeben“ und zeigt `armedHint`; `windowsHint` nur bei `win32`, `linuxHint` nur bei `linux`; Hauptdialog ohne `<video>`, `active` zeigt `viewerWindow`; Katalogtest (Parität, Platzhalter, keine verwaisten Keys) grün. |

### Welle 3

| Task | Dateien | Pflicht |
| --- | --- | --- |
| **T10 Szene + Doku** | `.claude/skills/run-app/{remote-scene.mjs, SKILL.md}`, `docs/handbuch.md`, `docs/manual.md`, `docs/plans/selfhosted-threat-model.md` | §2.8, K19, K20, K22 |

### 2.8 Szene und Doku (T10, Welle 3)

Szene, Pflicht:
1. `requireLabBuild`:
   - `out/preload/remote-media.cjs` und `out/renderer/remote-media.html` existieren.
   - `out/preload/chunks` existiert nicht.
   - Keine `out/preload/*.cjs` enthält `require("./`.
2. Der Annahmepfad wie heute.
3. Der Recorder speichert `at: Date.now()` je Dialog. `dialogs[0].at - consentAt >= 550`.
4. Bei A liegt während der Freigabe genau ein Fenster mit URL `remote-media.html` vor (`/windows`).
5. Hauptfenster-Titel (K19):
   - Unter Linux prüft die Szene den Titel des Hauptfensters.
   - Sonst prüft sie `isContentProtected()` für alle Fenster.
6. Bei B erscheint ein Fenster `remote-media.html` binnen 10 s.
   - Die Szene wechselt mit `use?i=` dorthin.
   - Dort laufen die Videoprüfung und `PIXEL_CHECK` auf `document.querySelector('video')`, und `remote-viewer.png` wird aufgenommen.
   - Danach wechselt sie zurück auf das Hauptfenster (Index per URL).
7. Ende bei A:
   - B meldet ≤ 8 s `ended.remote`.
   - Bei A existiert ≤ 2 s kein `remote-media.html` mehr.
   - Schutz und Titel sind ≤ 4 s zurück.
8. Der Ablehnpfad wie heute.
9. **Neu, Fensterende:**
   - Dritte Anfrage mit geprüften Pins, Annahme.
   - B schließt das Fernansichtsfenster (`/main`: `BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('remote-media.html')).close()`).
   - B zeigt `ended.stopped`, A verliert die Leiste ≤ 8 s.
10. CSP-Konsole leer auf A und B.
11. Mit `SHELLHERD_REMOTE_CAPTURE_FAKE=0` (K20) entfällt die Pixelprüfung, und `videoWidth > 0` reicht.

`SKILL.md` beschreibt beide Modi.

Doku:
- `handbuch.md` „Fernzugriff (Entwicklung)“:
  - Schritt 5: Das Bild erscheint im Fenster „Fernansicht“, ohne Vault-Zugriff.
  - Die Grenze „Notbremse“ (`:798`) wird ersetzt durch: „Beenden schließt das Fenster der Fernansicht bzw. der Freigabe sofort und beendet dessen Prozess; dein Hauptfenster bleibt unberührt.“
  - `:814` wird nach K22 umgeschrieben.
  - Die Windows-Grenze bekommt V6 (implementiert, Laufzeit ungeprüft).
  - Neuer Unterabschnitt „Manuell prüfen (Windows)“: RDP-Tab öffnen, Bildschirm freigeben, am Viewer fehlen Shellherd-Fenster und RDP-Fläche. Alternativ mit gesperrtem Vault per Snipping Tool oder OBS.
  - „Prozessgrenzen und Lebenszyklus“ (`:879`) nennt das Medienfenster: eigene Partition, kein `desktopApi`, Ende mit Sitzung, Sperre, Hauptfenster.
- `manual.md` spiegelt das.
- Threat-Model: Abschnitt „Stand H5“ (V5 behoben, V6 implementiert mit ungeprüfter Laufzeit, V8 behoben, M4-Rest nach E3, B1 als behobener Fund) und Restrisiken aus §7. A11 und die Fuses bleiben offen.

Abhängigkeiten:
- T7, T8 und T9 lesen den Report von T1 (Pfad A/B, R6).
- T8 nutzt die API aus §2.6 wörtlich.
- T9 nutzt die Keys aus §5, und T8 nutzt `window.remoteViewer`/`remoteAgent` aus T9 (gleiche Welle).
- T10 liest alle Reports.

Abschluss (Lead):
- `npm run typecheck`, `npx vitest run`, `npx electron-vite build` mit der Prüfung aus B2.
- `SHELLHERD_RELEASE=1 npx electron-vite build`, danach existiert keine Medien-Datei und kein Marker. Danach folgt ein Neubau ohne Variable.
- `remote-scene.mjs` im Fake-Modus und einmal mit `SHELLHERD_REMOTE_CAPTURE_FAKE=0` unter `xvfb` (Ergebnis im PR).
- `sync-scene.mjs` als Regressionstest für B1 und B2 (Haupt-Preload).
- `electron-builder --linux --dir` und `xvfb-run -a node scripts/smoke-linux.mjs`.
- Kein CHANGELOG, keine Version (R-H5-5).
- Offene PR-Punkte:
  - Laufzeittest V6 unter Windows (Handbuch-Rezept).
  - Inspect- und asar-Fuses (Spec §4.2).
  - A11 (H6).

---

## 7. Restrisiken (zur Kenntnis, keine Aufgabe)

- **GPU- und Netzwerkprozess:** V5 isoliert den Renderer. Videodekodierung kann je nach Hardware im GPU-Prozess laufen, und der ist mit dem Hauptfenster geteilt. Ein Decoder-Fehler dort ist nicht isoliert.
- **Eigenes WebRTC:** Ein kompromittierter Medien-Renderer kann eine eigene `RTCPeerConnection` zu einer beliebigen Adresse öffnen (die CSP greift dort nicht). Er hat dabei nur das Bild, das er ohnehin sieht oder sendet, und keinen Vault-Zugriff (nach B1).
- **Pfad B:** Die Quellen-ID wählt die Seite. Sie ist zu diesem Zeitpunkt noch nicht angreifbar (E3). Ein Fehler in der eigenen Seitenlogik würde trotzdem eine andere Quelle wählen können.
- **Speicher der Partition:** Er wird nur best effort geleert (E6).
- **Sprache und Theme:** Kein Sprachwechsel im offenen Medienfenster (E8).
- **V6:** Die Laufzeit ist ungeprüft. Unter Windows vor 2004 gibt es nur `WDA_MONITOR` (schwarze Fläche statt Ausnahme). Der Child-Modus verlässt sich auf die Affinität des Electron-Fensters.
- **Wayland:** Portal und Laufzeit sind weiter ungeprüft. `captureMs` kann eine langsame Auswahl abbrechen.
- **Frühes Ende:** Endet die Sitzung genau zwischen `forcefullyCrashRenderer` und dem Prozessende, können bereits gepufferte RTP-Pakete noch abgehen (Millisekunden).
