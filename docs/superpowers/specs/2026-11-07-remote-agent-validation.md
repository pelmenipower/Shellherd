# Fernzugriff (Entwicklung), Meilenstein 1: Validierung (bindend)

Prüfer: Opus, 2026-11-07. Grundlage: Spec `2026-11-07-remote-agent-design.md`, Plan `docs/superpowers/plans/2026-11-07-remote-agent.md` und Recherche `.superpowers/sdd/2026-11-07-remote-agent-research.md`, jeweils gegen den Code auf `claude/feature/remote-agent` (`45c5766`) geprüft. Ausgangslage: `npm run typecheck` ist grün, `npx vitest run` ebenfalls (206 Dateien, 3011 Tests bestanden, 35 übersprungen).

**Urteil: ready after corrections.** Es gibt 6 Blocker, 24 Korrekturen und 9 Entscheidungen.

Dieser Anhang geht Spec und Plan vor. Was hier nicht steht, gilt aus der Spec weiter. Verweise wie `K7` beziehen sich auf die Abschnitte unten.

---

## 1. Blocker (jeder mit Fix, bindend)

**B1: Der Viewer pollt `receive()` auf einer noch nicht angenommenen Sitzung, der Server antwortet mit 409, und der Host beendet die Sitzung sofort.**
- Beleg: `scripts/sync-prototype/rendezvous.mjs:216` (`fail(session.state === 'active', 409)` steht vor `messages`/`ack`). Spec 5.4 verlangt „`channel.receive()` alle 1 s“ und wertet „404/Fehler im Kanal“ als `ended/remote`. Die Spec legt außerdem den Kanal direkt beim `request` an. Damit endet jede Viewer-Sitzung nach der ersten Sekunde.
- Dazu kommt die Frist: `rendezvous-client.mjs:57` setzt `deadline = performance.now() + 300_000` ab Erstellung des Kanals. Der Server zählt die 300 s erst ab der Annahme (`rendezvous.mjs:213`). Ein Viewer-Kanal, der beim Anfragen entsteht, stirbt also bis zu 60 s zu früh.
- Fix:
  - Der Viewer legt nach `peer.request()` **noch keinen Kanal** an. Er pollt alle 1000 ms `account.request('GET', '/v1/rendezvous/sessions/<id>')`.
  - Liefert der Server `state === 'active'`, ruft er `peer.channel(<diese Antwort>, publicKey, target, 'view')` auf und setzt den Zustand auf `connecting`. Ab dann läuft die Empfangsschleife (1 s, nach `active` 5 s).
  - Antwortet der Server vorher mit 404: Ist die lokale Anfragefrist noch nicht erreicht, endet die Sitzung mit `ended/declined`, sonst mit `ended/expired`.
  - Der Agent legt seinen Kanal erst im `accept` an, unmittelbar vor `channel.accept()`.
  - Seine Empfangsschleife startet erst, wenn `accept()` erfolgreich zurückkam. Vorher würde `rendezvous-client.mjs:109` werfen.

**B2: Unter run-app findet der Fernzugriff die Prototyp-Skripte nicht, der Host bleibt ohne Deps, und die Szene ist unmöglich.**
- Beleg: Die Spec übernimmt das Muster aus `src/main/sync-prototype/lab-ipc.ts:17` (`join(app.getAppPath(), 'scripts/…')`). Unter dem Treiber ist `app.getAppPath()` aber `<RUN_DIR>/app` (`.claude/skills/run-app/driver.mjs:27-28`, `boot.mjs`), nicht das Repo.
- Fix: `src/main/remote/lab-ipc.ts` löst die Skripte relativ zum Main-Bundle auf. Main läuft aus `out/main/`, sowohl unter `electron-vite dev` als auch unter dem Treiber.
  ```ts
  const script = (file: string): string => pathToFileURL(join(__dirname, '..', '..', 'scripts', 'sync-prototype', file)).href;
  ```
  `src/main/index.ts:120` verwendet `__dirname` bereits. Am Sync-Lab wird nichts geändert.

**B3: Task T in Welle 1 macht `i18n-catalog.test.ts` (d) rot, und getypte Keys brechen den Typecheck, wenn sie in einer anderen Welle stehen.**
- Beleg: `src/shared/locales/i18n-catalog.test.ts:100-118` (verwaiste Keys). `src/shared/i18n.d.ts` typisiert `t()` über die Ressourcen, und `mainT` ist über `getFixedT(null,'main')` ebenfalls getypt (`src/main/i18n.ts:23`). Ohne den Namespace kompiliert `t('remoteLab:…')` nicht. Die Regel aus der Pipeline lautet: Typecheck und Tests bleiben nach jeder Welle grün.
- Fix:
  - T kommt in **dieselbe Welle wie alle Nutzer der Keys** (Welle 3, siehe §6) und legt genau die Keys aus §4 an, nicht mehr und nicht weniger.
  - Die Fehler- und Ende-Maps in `src/renderer/src/remote-lab.ts` (G, Welle 2) sind reine `as const`-Literale ohne `t()`-Aufruf und kompilieren deshalb schon vorher.

**B4: Der Vertrag aus Spec 5.5 kompiliert nicht.**
- `Omit<RemoteLabRequest, 'clientId'>` ist auf der Union nicht distributiv. Übrig bleibt `{ kind: … }`, und `act({ kind: 'connect', serverUrl })` scheitert an der Prüfung überschüssiger Eigenschaften.
- `timers?: { setTimeout; clearTimeout }` hat implizites `any` und scheitert unter `strict`.
- Fix: der Vertrag in §2.1 und §2.6, mit `RemoteLabCommand` und `ControllerTimers`.

**B5: Die Probe- und Kontodaten passen nicht zu `AccountStore`.**
- `probeSyncServer` liefert kein `rendezvous` (`http-common.mjs:21`).
- `AccountStore` verlangt `info.namespace` (`account-transport.mjs:11`), aber `RemoteDeps.probe` in Spec 5.4 hat kein `namespace`.
- `AccountStore.login()` gibt nur `{ signedIn: true }` zurück (`account-transport.mjs:19`). Damit gibt es keinen Wert für `account.validUntil`.
- Fix (Task B, siehe §6):
  - `probeSyncServer` gibt zusätzlich `rendezvous: info.rendezvous === true` zurück.
  - `AccountStore.login` gibt `{ signedIn: true, expiresAt: result.expiresAt }` zurück.
  - Beide Änderungen sind additiv. Bestehende Tests prüfen nur mit `toMatchObject` oder einzelnen Feldern (`account.test.mjs:34`, `access.test.mjs:36`).
  - `RemoteServerInfo` in §2.5 enthält `namespace` und `rendezvous`.

**B6: Ein Round-Trip-Test in `src/shared/remote-signal.test.ts`, der `scripts/sync-prototype/*.mjs` importiert, bricht `npm run typecheck`.**
- Beleg: `tsconfig.node.json` und `tsconfig.web.json` schließen `src/shared/**/*.ts` ein, also auch die Tests, und `allowJs` ist `false`. Für die Prototyp-Module gibt es keine `.d.ts`, und unter `strict` entsteht TS7016.
- Fix: Der Round-Trip kommt in eine neue Datei `scripts/sync-prototype/remote-signal.test.mjs` (Task A). Sie importiert `../../src/shared/remote-signal.ts`; vitest transformiert das, und `vitest.config` schließt `scripts/**/*.test.mjs` ein. Wie in `rendezvous.test.mjs:12` gilt `it.runIf(process.platform === 'linux')`. `src/shared/remote-signal.test.ts` bleibt rein und importiert keine `.mjs`.

---

## 2. Vertrag (wörtlich übernehmen, ersetzt Spec 5.1 bis 5.5, soweit hier genannt)

### 2.1 `src/shared/remote-lab.ts` (Task A)

```ts
export type RemoteScope = 'view';
/** id is the device fingerprint: SHA-256 of the SPKI DER, 64 lowercase hex. */
export interface RemoteDevice { id: string; name: string; known?: { firstSeen: number } }
export type RemoteEndReason = 'stopped' | 'remote' | 'expired' | 'locked' | 'declined' | 'failed' | 'scope';
export type RemoteErrorCode = 'unavailable' | 'invalid' | 'stale' | 'identity' | 'locked' | 'connection' | 'authentication' | 'expired'
  | 'declined' | 'mismatch' | 'signal' | 'media' | 'peer' | 'scope' | 'limit';
/** Wire part inside the E2EE channel. 'bye' is host-internal and never crosses IPC. */
export interface RemoteSignalPart { kind: 'offer' | 'answer' | 'bye'; part: number; of: number; data: string }
export type RemoteLabCommand =
  | { kind: 'status' } | { kind: 'close' }
  | { kind: 'connect'; serverUrl: string }
  | { kind: 'signIn'; username: string; password: string }
  | { kind: 'goOnline'; deviceName: string } | { kind: 'goOffline' }
  | { kind: 'request'; target: string; compared: true }
  | { kind: 'armCapture'; sessionId: string }
  | { kind: 'accept'; sessionId: string } | { kind: 'decline'; sessionId: string }
  | { kind: 'signal'; sessionId: string; part: RemoteSignalPart }
  | { kind: 'stop'; sessionId: string };
export type RemoteLabRequest = RemoteLabCommand & { clientId: string };
export interface RemoteLabSession {
  id: string; role: 'viewer' | 'agent'; peer: RemoteDevice; scope: RemoteScope;
  state: 'requesting' | 'consent' | 'connecting' | 'active';
  /** Local epoch ms (see K3), never the server clock. */
  expiresAt: number; startedAt?: number;
}
export interface RemoteLabState {
  phase: 'idle' | 'serverReady' | 'signedIn' | 'online';
  server?: { serverUrl: string; serverId: string };
  account?: { username: string; validUntil: number };
  identity?: { fingerprint: string; persistent: boolean };
  devices?: RemoteDevice[];
  session?: RemoteLabSession;
}
export type RemoteLabEvent =
  | { kind: 'state'; state: RemoteLabState }
  | { kind: 'signal'; sessionId: string; part: RemoteSignalPart }
  | { kind: 'ended'; sessionId: string; reason: RemoteEndReason }
  | { kind: 'error'; code: RemoteErrorCode };
export type RemoteLabReply = { ok: true; state: RemoteLabState } | { ok: false; code: RemoteErrorCode };
export const REMOTE_LAB_LIMITS = {
  deviceName: 80, signalPart: 6144, signalParts: 4, sdp: 24576,
  captureGrantMs: 15000, requestMs: 60000, consentMs: 55000, sessionMs: 300000,
  setupPollMs: 1000, activePollMs: 5000, gatherMs: 2000, acceptDelayMs: 1000, byeMs: 2000,
} as const;
```
- `{ kind: 'error' }` ist neu (K9).
- `'scope'` bleibt in `RemoteEndReason` und `RemoteErrorCode` für M2 reserviert. In M1 wird beides nie gesendet; die Maps in G enthalten die Werte trotzdem.

### 2.2 `src/shared/remote-signal.ts` (Task A, rein, ohne `Buffer`, mit `TextEncoder`)

```ts
import type { RemoteSignalPart } from './remote-lab';
/** UTF-8 byte length of JSON.stringify(data) without the two quotes: the size the part adds inside the channel frame. */
export function signalBytes(data: string): number;
export function splitSignal(kind: RemoteSignalPart['kind'], data: string): RemoteSignalPart[];
export function isSignalPart(value: unknown): value is RemoteSignalPart;
export class SignalCollector {
  push(part: RemoteSignalPart): { kind: RemoteSignalPart['kind']; data: string } | null;
  reset(): void;
}
export function checkSdp(sdp: string, kind: 'offer' | 'answer'): void;
export function formatFingerprint(hex64: string): string;
```
- `splitSignal`:
  - Teilt nach Codepoints, nie innerhalb eines Surrogatpaars, sodass für jeden Teil `signalBytes(data) <= 6144` gilt (K1). `part` läuft 1-basiert.
  - Mehr als 4 Teile, `data === ''` bei `offer`/`answer` oder `data !== ''` bei `bye` führen zu `throw`.
  - `bye` ergibt genau `[{ kind: 'bye', part: 1, of: 1, data: '' }]`.
- `isSignalPart`: `kind` aus dem Enum, ganzzahlig `1 <= part <= of <= 4`, `data` ist ein String mit `signalBytes <= 6144`, keine weiteren Schlüssel. Bei `bye` gilt `of === 1 && data === ''`.
- `SignalCollector` wirft bei folgenden Fehlern und setzt sich danach zurück:
  - Der erste Teil hat `part !== 1`.
  - Auf einen Teil folgt einer, dessen `part` nicht um genau 1 höher ist.
  - Innerhalb einer Nachricht ändern sich `kind` oder `of`.
- Ist die Nachricht vollständig, gibt `SignalCollector` sie zurück und setzt sich zurück.
- `checkSdp` wirft, wenn eine der folgenden Bedingungen zutrifft:
  - `sdp.length > 24576`.
  - Die Zahl der Zeilen, die mit `m=` beginnen, ist nicht 1, oder diese Zeile beginnt nicht mit `m=video `.
  - Keine Zeile passt (ohne Groß- und Kleinschreibung) auf `/^a=fingerprint:sha-256 (?:[0-9a-f]{2}:){31}[0-9a-f]{2}$/i`.
  - Eine Zeile beginnt mit `a=candidate` und enthält ` typ relay`.
  - Zeilen werden an `/\r?\n/` getrennt. `kind` dient nur der Fehlermeldung, die Prüfungen gelten für beide Arten.
- `formatFingerprint`: Eingabe muss `/^[a-f0-9]{64}$/` erfüllen, sonst `throw`. Ausgabe sind 8 Gruppen à 8 Zeichen, mit einem Leerzeichen getrennt.

### 2.3 IPC (Task A)

- `src/shared/ipc.ts`:
  - `IPC_CHANNELS` bekommt `remoteLabAction: 'remote-lab:action'` und `remoteLabEvent: 'remote-lab:event'`.
  - `DesktopApi` bekommt die folgenden Felder, nach dem Muster der bestehenden `syncLab*`-Felder über `import('./remote-lab')`:
    ```ts
    remoteLabEnabled: boolean;
    remoteCaptureFake: boolean;
    remoteLabAction: (request: import('./remote-lab').RemoteLabRequest) => Promise<import('./remote-lab').RemoteLabReply>;
    onRemoteLabEvent: (listener: (event: import('./remote-lab').RemoteLabEvent) => void) => () => void;
    ```
- `src/preload/index.ts`:
  ```ts
  remoteLabEnabled: process.argv.includes('--shellherd-remote-lab=1'),
  remoteCaptureFake: process.argv.includes('--shellherd-remote-capture-fake=1'),
  remoteLabAction: request => ipcRenderer.invoke('remote-lab:action', request),
  onRemoteLabEvent: listener => subscribe('remote-lab:event', listener),
  ```

### 2.4 `src/main/remote/identity.ts` (Task C) und `presence.ts` (Task D)

`identity.ts`: die Signaturen aus Spec 5.4 und zusätzlich:
- `load()` cacht. Ein zweiter Aufruf gibt **dasselbe** Identitätsobjekt zurück, auch im RAM-Modus, sodass der Fingerprint bis zum App-Ende stabil bleibt.
- Datei fehlt: Bei `cipher.available()` wird eine Identität erzeugt und atomar geschrieben (`persistent: true`), sonst nur im RAM (`persistent: false`).
- Datei vorhanden: Die folgenden Fälle führen alle zu `throw Error('identity')`, und die Datei wird **nie** überschrieben:
  - JSON ungültig,
  - `version !== 1`,
  - Datei größer als 64 KiB,
  - `knownDevices` ungültig,
  - `cipher.available() === false`,
  - `decrypt` wirft,
  - `derive` wirft.
- Atomares Schreiben: `<file>.<16 hex>.tmp` im selben Ordner wird mit `open(…, 'wx', 0o600)` angelegt, dann folgen `write`, `fsync`, `close` und `rename`. Unter POSIX wird anschließend der Ordner ge-fsynct, unter `win32` entfällt das. Bei einem Fehler wird die tmp-Datei gelöscht.
- `remember(fingerprint, name, now)` arbeitet so:
  - Ist der Eintrag neu, setzt es `firstSeen = now`.
  - Es setzt immer `lastSeen = now` und `name` (höchstens 80 Zeichen).
  - Sind es mehr als 64 Einträge, fliegt der mit dem kleinsten `lastSeen`.
  - Geschrieben wird nur im persistenten Modus.
  - Vor `load()` passiert nichts.
- `safeStorageCipher()`:
  - `available()` ist `safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text')`.
  - `encrypt(b)` ist `safeStorage.encryptString(b.toString('base64'))`, `decrypt(c)` ist `Buffer.from(safeStorage.decryptString(c), 'base64')`.
  - `setUsePlainTextEncryption` wird nie aufgerufen.
- Die Tests prüfen den Modus 0600 nur, wenn `process.platform !== 'win32'`.

`presence.ts`:
```ts
export interface PresenceTransport { register(name: string): Promise<unknown>; sessions(): Promise<unknown[]>; devices(): Promise<unknown[]>; refresh(): Promise<{ expiresAt: number }>; unregister(): Promise<unknown> }
export interface PresenceTimers { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(handle: unknown): void; now(): number }
export interface PresenceHandlers { onSessions(list: unknown[]): void; onDevices(list: unknown[]): void; onValidUntil(ms: number): void; onOffline(code: 'authentication' | 'connection'): void }
export const PRESENCE_TIMING = { leaseMs: 30000, pollMs: 5000, refreshMs: 300000, backoffMs: [5000, 10000, 20000], offlineMs: 60000 } as const;
export class PresenceLoop {
  constructor(transport: PresenceTransport, name: string, timers: PresenceTimers, handlers: PresenceHandlers);
  start(): Promise<void>;
  stop(): Promise<void>;
}
```
Regeln (ersetzen den Absatz „Takt“ aus der Spec):
- `start()` ruft einmal `register(name)` auf und gibt einen Fehler unverändert weiter. Danach pollt es **sofort** einmal und plant drei unabhängige Ketten über `setTimeout`. Es gibt kein `setInterval`, und jede Kette plant erst nach Abschluss neu:
  - Lease alle 30 s,
  - Poll alle 5 s (`sessions()` und `devices()` nacheinander, dann `onSessions` und `onDevices`),
  - Refresh alle 300 s (`onValidUntil(expiresAt)`).
- Hat ein Fehler `status === 401`, egal aus welcher Kette, folgt einmal `onOffline('authentication')`, danach `stop()`.
- Lease-Fehler mit anderem Status: Wiederholung nach 5 s, 10 s, 20 s, 20 s und so weiter. Gilt dabei `now() - lastLeaseOk >= 60000`, folgt einmal `onOffline('connection')`, danach `stop()`.
- Poll-Fehler mit anderem Status: Die Kette läuft normal nach 5 s weiter.
- Refresh-Fehler mit anderem Status: Wiederholung nach 5 s, 10 s und 20 s, danach wieder normal.
- `stop()` ist idempotent. Es löscht alle Timer, ruft `unregister()` best effort auf (Fehler werden geschluckt) und darf danach keine Handler mehr aufrufen, auch nicht aus Antworten, die noch unterwegs sind.

### 2.5 `src/main/remote/lab-host.ts` (Task E)

```ts
import type { KeyObject } from 'node:crypto';
import type { RemoteLabEvent, RemoteLabReply } from '../../shared/remote-lab';
import type { RemoteIdentity, RemoteIdentityStore } from './identity';
import type { PresenceHandlers, PresenceTimers, PresenceTransport } from './presence';

export interface RemoteServerInfo { serverUrl: string; serverId: string; namespace: string; authentication: 'password' | 'device'; rendezvous: boolean }
export interface RemoteSessionWire { id: string; from: string; to: string; nonce: string; scope: string; state: string; expiresAt: number }
export interface RemoteChannel { readonly ready: boolean; accept(): Promise<void>; send(value: unknown): Promise<unknown>; receive(): Promise<unknown[]>; close(): Promise<void>; dispose(): void }
export interface RemotePeer {
  readonly identity: { id: string; publicKey: string; privateKey: KeyObject };
  register(name: string): Promise<unknown>; devices(): Promise<unknown[]>; sessions(): Promise<unknown[]>; unregister(): Promise<unknown>;
  request(target: string, scope: 'view'): Promise<RemoteSessionWire>;
  channel(session: RemoteSessionWire, peerPublicKey: string, expectedFingerprint: string, scope: 'view'): RemoteChannel;
}
export interface RemoteAccount {
  login(username: string, password: string): Promise<{ signedIn: true; expiresAt: number }>;
  request(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: string): Promise<unknown>;
  refresh(): Promise<{ expiresAt: number }>;
  logout(): Promise<void>; close(): void;
}
export interface RemoteDeps {
  probe(serverUrl: string, signal: AbortSignal): Promise<RemoteServerInfo>;
  createAccount(info: RemoteServerInfo, signal: AbortSignal): RemoteAccount;
  createPeer(account: RemoteAccount, identity: RemoteIdentity): RemotePeer;
  identity(): RemoteIdentityStore;
  presence(transport: PresenceTransport, name: string, handlers: PresenceHandlers): { start(): Promise<void>; stop(): Promise<void> };
  timers: PresenceTimers;
  isUnlocked(): boolean;
}
export class RemoteLabHost {
  constructor(deps?: RemoteDeps);
  get enabled(): boolean;
  action(owner: number, raw: unknown): Promise<RemoteLabReply>;
  onEvent(listener: (owner: number, event: RemoteLabEvent) => void): () => void;
  consumeCaptureGrant(webContentsId: number): string | null;
  get sharing(): boolean;
  onSharingChange(listener: (sharing: boolean) => void): () => void;
  closeOwner(owner: number): void;
  reset(reason?: 'locked'): void;
}
```
Verhalten im Einzelnen: siehe K2 bis K12.

### 2.6 Renderer (Task G)

`src/renderer/src/remote-peer.ts`:
```ts
import type { DesktopApi } from '../../shared/ipc';
import type { RemoteEndReason, RemoteErrorCode, RemoteLabCommand, RemoteLabReply, RemoteLabState } from '../../shared/remote-lab';
export interface RemoteView { state: RemoteLabState; stream?: MediaStream; error?: RemoteErrorCode; ended?: RemoteEndReason }
export interface PeerFactory { create(config: RTCConfiguration): RTCPeerConnection }
export interface CaptureSource { capture(): Promise<MediaStream> }
export interface ControllerTimers { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(handle: unknown): void }
/** Lazily touches globals, so Node tests can import the module. */
export const browserPeers: PeerFactory;      // create: config => new RTCPeerConnection(config)
export const displayCapture: CaptureSource;  // capture: () => navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
export class RemoteSessionController {
  constructor(api: Pick<DesktopApi, 'remoteLabAction' | 'onRemoteLabEvent'>, clientId: string, peers: PeerFactory, capture: CaptureSource, timers?: ControllerTimers);
  get view(): RemoteView;
  subscribe(listener: (view: RemoteView) => void): () => void;   // calls listener immediately with the current view
  act(command: RemoteLabCommand): Promise<RemoteLabReply>;        // ok → view.state = reply.state, error cleared; !ok → view.error = code; IPC throw → 'connection'
  share(sessionId: string): Promise<void>;                        // MUST be called synchronously from the consent click handler
  stop(): void;
  clearError(): void;
  dispose(): void;
}
```

`src/renderer/src/remote-lab.ts`:
```ts
export const REMOTE_ERROR_KEYS = { unavailable: 'remoteLab:errors.unavailable', /* … every RemoteErrorCode, full literal … */ } as const satisfies Record<RemoteErrorCode, string>;
export const REMOTE_END_KEYS = { stopped: 'remoteLab:ended.stopped', /* … every RemoteEndReason … */ } as const satisfies Record<RemoteEndReason, string>;
export function errorKey<C extends RemoteErrorCode>(code: C): (typeof REMOTE_ERROR_KEYS)[C];
export function endKey<R extends RemoteEndReason>(reason: R): (typeof REMOTE_END_KEYS)[R];
export function secondsLeft(expiresAt: number, now: number): number;   // Math.max(0, Math.ceil((expiresAt - now) / 1000))
export { formatFingerprint as groupFingerprint } from '../../shared/remote-signal';
```
- Jeder Map-Wert steht als **volles Literal** im Code (`'remoteLab:errors.limit'`), damit Test (d) ihn findet.

`src/renderer/src/remote-capture-fake.ts`:
- Signatur: `export function fakeCapture(): CaptureSource`.
- Testbild 640×360, vier Quadranten:
  - links oben `rgb(230, 40, 40)`,
  - rechts oben `rgb(40, 190, 80)`,
  - links unten `rgb(40, 90, 230)`,
  - rechts unten `rgb(240, 200, 40)`.
- Dazu kommt ein 16 px hoher Streifen am unteren Rand, der je Zeichnung zwischen Schwarz und Weiß wechselt. Er erzwingt neue Frames und ist von der Pixelprüfung ausgenommen.
- `captureStream(10)` und `setInterval(draw, 100)`. Stoppt der Track (`ended`/`stop`), endet auch das Intervall.
- Kopfkommentar: `// Test pattern for the run-app scene only, not UI: fixed colours are intentional (no design tokens).`
- Die Datei enthält keine Umlaute.

### 2.7 Komponenten (Task H, I): Props wörtlich

```ts
// H: src/renderer/src/components/RemoteLabDialog.tsx
export function RemoteLabDialog(props: { controller: RemoteSessionController; onClose: () => void }): JSX.Element;
// H: src/renderer/src/components/RemoteConsentDialog.tsx
export function RemoteConsentDialog(props: { controller: RemoteSessionController; session: RemoteLabSession }): JSX.Element;
// I: src/renderer/src/components/RemoteShareBar.tsx
export function RemoteShareBar(props: { session: RemoteLabSession; onStop: () => void }): JSX.Element;
```
CSS-Klassen, die H in `remote-lab.css` anlegt und I verwendet: `.remote-share-bar`, `.remote-share-bar-text`. I schreibt kein CSS.

---

## 3. Korrekturen (bindend)

**K1: Größe der Signalteile.** In der Spec bezieht sich „UTF-8-Bytes ≤ 6144“ auf die rohen Daten. Im Rahmen landen sie aber JSON-escaped (`\r\n` wird zu 4 Bytes, Steuerzeichen zu bis zu 6). Maßgeblich ist deshalb `signalBytes(data)` (§2.2).
- Die Hülle `{"kind":"data","value":{"part":{"kind":"answer","part":4,"of":4,"data":"…"}}}` kostet höchstens 90 Bytes. 6144 + 90 bleibt unter den 8192 Bytes aus `rendezvous-client.mjs:67`.
- Der Host sendet genau `channel.send({ part })` (K6).
- Der Test in `remote-signal.test.ts` prüft für jeden Teil eines SDP mit 23 KiB und vielen CRLF: `Buffer.byteLength(JSON.stringify({kind:'data',value:{part}})) <= 8192`.

**K2: Owner, `close` und `status`.**
- Der erste `connect` bindet Owner und clientId.
- Ist der Host nicht gebunden, beantworten `status` und `close` jeden Aufrufer mit `{ ok: true, state: { phase: 'idle' } }`.
- Ist er gebunden, bekommt ein fremder Owner oder eine fremde clientId bei **jeder** Aktion `stale`.
- `close` wirkt wie `reset()` ohne Grund `locked` (Ende-Grund `stopped`) und gibt die Bindung frei.
- `connect` ist nur ohne Bindung erlaubt, sonst kommt `stale`. Den Server wechselt der Renderer mit `close`, dann `connect`.
- **Der Dialog sendet beim Schließen kein `close`** (anders als `SyncLabDialog.tsx:22`). Sonst ginge der Agent offline, sobald der Dialog zu ist, und die Zustimmung braucht ein Online-Gerät. `close` gibt es nur über einen expliziten Knopf („Anderen Server“ entfällt in M1). In M1 sendet niemand `close`; reset passiert über Sperre, `closeOwner` oder App-Ende.

**K3: Fristen nur nach lokaler Uhr.** Serverwerte für `expiresAt` stammen von der Serveruhr und gehen nicht in den Zustand. Abweichungen der Uhren im LAN wären sonst sichtbar. Es gelten diese lokalen Fristen (`timers.now()`):
- Viewer `requesting`: `requestedAt + 60000`.
- Agent `consent`: `seenAt + 55000`. Fünf Sekunden Abzug, weil der Poll bis zu 5 s verzögert.
- `connecting` und `active` (beide Rollen): `channelCreatedAt + 300000`. Für den Viewer ist das der Zeitpunkt, an dem er `active` sah (B1), für den Agent der Zeitpunkt von `accept`.
- `startedAt` ist die lokale Zeit des Übergangs nach `active`.
- Erreicht eine Frist ihr Ende, folgt `ended/expired` (in `consent` bevorzugt vor einem DELETE durch den Server).
- `account.validUntil` ist die einzige Serverzeit im Zustand. Sie dient nur der Anzeige und wird bei jedem `refresh` aktualisiert.

**K4: Eingehende Anfragen** kommen aus `onSessions`. Die Liste wird gegen ein zod-Schema für `RemoteSessionWire` geprüft; ungültige Einträge werden ignoriert. Eine Sitzung ist eingehend, wenn `to === self && state === 'pending'`. Bereits verarbeitete IDs (Set, höchstens 64) werden ignoriert.
- `scope !== 'view'`: `account.request('DELETE', '/v1/rendezvous/sessions/<id>')` best effort. Es gibt kein Event und keinen Dialog (R3).
- Es läuft schon eine Sitzung in irgendeiner Rolle oder einem Zustand: ebenso DELETE, die Anfrage gilt als „busy“.
- `from` fehlt in der aktuellen Geräteliste (kein publicKey): diese Runde überspringen und die ID noch **nicht** als verarbeitet markieren.
- Sonst: Sitzung `{ role: 'agent', state: 'consent', peer: { id: from, name, known } }` anlegen, mit `known = identity.known(from)`, und ein `state`-Event senden.
- Taucht die Sitzung in `consent` nicht mehr in `onSessions` auf, endet sie mit `ended/remote`.

**K5: Aktionen und ihre Vorbedingungen.** Ist eine Vorbedingung nicht erfüllt, kommt `stale`, sofern unten nichts anderes steht.
- `connect`: `probe` aufrufen. `authentication !== 'password'` oder `!rendezvous` ergibt `unavailable`, ein Fehler `connection`, Erfolg `phase: 'serverReady'`.
- `signIn`: zod wie in `src/main/sync-prototype/lab-host.ts` (signIn). `createAccount(info, signal)` und `login`. Ein Fehler mit 401 ergibt `authentication`, 429 ergibt `limit`, alles andere `connection`. Das Passwort wird weder gespeichert noch in den Zustand übernommen. Erfolg: `phase: 'signedIn'`, `account: { username, validUntil: expiresAt }`.
- `goOnline`:
  - Vorbedingungen: `phase === 'signedIn'`, `isUnlocked()` (sonst `locked`), Name passt auf `/^[^\x00-\x1f\x7f]{1,80}$/` (sonst `invalid`).
  - `identity().load()`; wirft das, kommt `identity`.
  - `createPeer`, `presence(…)` und `start()`. Fehler werden zu Codes: 401 `authentication`, 429 `limit`, 409 und andere `connection`.
  - Erfolg: `phase: 'online'`, `identity: { fingerprint: identity.id, persistent }`.
- `goOffline`: laufende Sitzung lokal beenden (`stopped`, K8), `presence.stop()`, `phase: 'signedIn'`, `devices` leeren.
- `request`:
  - Vorbedingungen: `phase === 'online'`, `isUnlocked()` (sonst `locked`), keine Sitzung, `target` passt auf `/^[a-f0-9]{64}$/`, `compared === true` (zod), Ziel steht in der aktuellen Geräteliste.
  - `peer.request(target, 'view')`. Ein 429 oder ein lokaler Prüffehler ergibt `limit` bzw. `connection`.
  - Danach Sitzung `requesting`.
- `armCapture`: nur für eine Agent-Sitzung in `consent` mit genau dieser ID, nur `isUnlocked()`, nur einmal je Sitzung. Setzt den Grant `{ owner, sessionId, until: now + 15000, used: false, armed: true }`, ohne Netzwerk.
- `accept`:
  - Vorbedingungen: Agent in `consent`, `isUnlocked()` (sonst `locked`), **für diese Sitzung wurde `armCapture` aufgerufen** (Grant benutzt oder unbenutzt), Frist nicht erreicht (sonst `expired`).
  - Danach wird der Grant **gelöscht**.
  - Kanal anlegen: `peer.channel(sessionWire, devicePublicKey, from, 'view')`. Wirft das, kommt `mismatch`, und die Sitzung endet mit `failed`.
  - `await channel.accept()`. Bei einem Fehler endet die Sitzung mit `failed`, Code `connection` (bzw. `expired`, wenn die Frist erreicht ist).
  - Danach `state: 'connecting'`, `sharing = true` und die Empfangsschleife starten.
- `decline`: Agent in `consent`. Der Zustand wird lokal sofort geleert, Event `ended/declined`, dann DELETE best effort.
- `signal`:
  - Vorbedingungen: Sitzung mit Kanal in `connecting` oder `active` und `channel.ready`.
  - Teil per `isSignalPart` prüfen. Ist `kind` gleich `'bye'`, kommt `invalid` (bye ist nur host-intern).
  - Der Agent darf nur `offer` senden, der Viewer nur `answer`, sonst `invalid`.
  - In die Send-Queue einreihen; der Reply wartet, bis der eigene Send fertig ist. Schlägt ein Send fehl, endet die Sitzung mit `failed`, Code `connection`.
- `stop`: K8.
- `status`: aktueller Zustand.
- Gleichzeitig darf höchstens **eine** Netzwerkaktion aus `connect`, `signIn`, `goOnline`, `goOffline`, `request` und `accept` laufen. Eine zweite bekommt `stale`.

**K6: Empfangsschleife und Signale.**
- Es gibt eine Schleife je Sitzung, verkettet über `timers.setTimeout`. Sie läuft nie parallel (`rendezvous-client.mjs:96` wirft bei parallelem `receive`).
- Takt: 1000 ms bis `active`, danach 5000 ms.
- Jeder empfangene Wert muss genau `{ part: RemoteSignalPart }` sein (zod oder `isSignalPart`), sonst endet die Sitzung mit `failed`.
- `bye` beendet mit `ended/remote`.
- `offer`- und `answer`-Teile gehen als Event `signal` an den Owner und zusätzlich in einen host-eigenen `SignalCollector`. Ein Collector-Fehler beendet mit `failed`.
- Nach `active`, wenn auf Viewer-Seite der erste vollständige `offer` bzw. auf Agent-Seite die erste vollständige `answer` vorliegt: `state: 'active'`, `startedAt` setzen, `identity.remember(peer.id, peer.name, now)`.
- Fehlerzuordnung im Empfang:
  - `error.status === 404`: `ended/remote`.
  - Lokale Frist erreicht: `ended/expired`.
  - Alles andere: `ended/failed`.
- Gesendet wird immer `channel.send({ part })`. Die Queue ist seriell, weil `rendezvous-client.mjs:66` bei parallelem Send wirft.

**K7: Capture-Gate (lab-ipc, R4).**
- `session.defaultSession.setDisplayMediaRequestHandler` wird **nur** registriert, wenn `host.enabled`.
- Im Handler gilt:
  ```ts
  const contents = request.frame ? webContents.fromFrame(request.frame) : undefined;
  if (!contents || request.frame !== contents.mainFrame || !request.videoRequested) return callback({});
  const sessionId = host.consumeCaptureGrant(contents.id);
  if (!sessionId) return callback({});
  desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
    .then(sources => sources[0] ? callback({ video: sources[0] }) : callback({}))
    .catch(() => callback({}));
  ```
- Jeder `callback` steht in `try/catch`, weil er bei zerstörtem Frame wirft (`electron.d.ts`, `setDisplayMediaRequestHandler`).
- `audio` wird nie gesetzt.
- Typen in Electron 44.4.2:
  - `request.frame: WebFrameMain | null`,
  - `request.videoRequested`, `request.userGesture`,
  - `webContents.fromFrame(frame): WebContents | undefined`,
  - `Streams.video?: Video | WebFrameMain`, wobei `DesktopCapturerSource` als `Video` passt.
- `consumeCaptureGrant(id)` gibt die `sessionId` nur zurück, wenn alle folgenden Bedingungen gelten, und setzt dann `used = true`; sonst `null`:
  - der Grant existiert,
  - `owner === id`,
  - `!used`,
  - `now < until`,
  - die Sitzung ist noch dieselbe Agent-Sitzung in `consent`.
- Ein Grant verfällt bei Sitzungsende, `decline`, `accept`, `stop`, `reset` und `closeOwner`.

**K8: Ende (R5, R6).** `stop(sessionId)` (beide Rollen), `goOffline`, `close`, `reset(reason)` und `closeOwner(owner)` laufen in dieser Reihenfolge ab:
1. Synchron: Grant löschen, Timer der Sitzung stoppen, Sitzung aus dem Zustand entfernen und `sharing = false` setzen (`onSharingChange` nur beim Wechsel).
2. Event `ended` mit `stopped` bzw. `locked` senden, danach `state`.
3. Asynchron und ohne Warten: Ist `channel.ready` und die Send-Queue leer, `channel.send({ part: bye })`, begrenzt auf 2000 ms. Danach immer `channel.close()` (DELETE). Fehler werden geschluckt. Ohne Kanal (Viewer `requesting`, Agent `consent`) folgt nur das DELETE der Sitzung.

`reset` und `closeOwner` beenden zusätzlich `presence.stop()`, dann `account.logout()` best effort, und geben die Bindung frei. `closeOwner` wirkt nur, wenn `owner` der gebundene Owner ist.

**K9: Asynchrone Fehler** schickt der Host als Event `{ kind: 'error', code }`:
- `onOffline('authentication')`: Sitzung `failed`, Konto verwerfen, `phase: 'serverReady'`, Code `authentication`.
- `onOffline('connection')`: Sitzung `failed`, `phase: 'signedIn'`, Code `connection`.

Der Controller setzt daraufhin `view.error`.

**K10: Events nur bei Änderung.** Ein `state`-Event geht nur raus, wenn sich `JSON.stringify(state)` gegenüber dem zuletzt gesendeten Zustand geändert hat. Grund: Der Gerätepoll alle 5 s würde sonst ständig Events erzeugen. `devices` wird nach `name` sortiert, über `compareText` aus `src/shared/format.ts`, das in Main importierbar ist. Das eigene Gerät ist nicht enthalten. Jedes Gerät braucht `deviceId`-Format (64 hex), einen `name` aus 1 bis 80 Zeichen und einen `publicKey` als String. Der publicKey bleibt im Host und erscheint **nie** im Zustand.

**K11: Sperre und Fensterschutz (R11) in `src/main/index.ts`.**
- Modul-Variable `let remoteSharing = false;` und `const applyProtection = (): void => { for (const target of [windowRegistry.main(), ...windowRegistry.secondaries()]) if (target && !target.isDestroyed()) target.setContentProtection(captureBlocked || remoteSharing); };`.
- Diese Funktion liegt auf Modulebene. `protectWindows(on)` setzt nur noch `captureBlocked = on` und ruft dann `applyProtection()` auf.
- `createWindow` (Zeile 129) prüft `if (captureBlocked || remoteSharing)`.
- Begründung: `syncVaultChanged` ruft `protectWindows(false)` auf (Zeile 376). Mit der alten Logik würde ein Sync während einer Freigabe den Schutz aufheben, und ein Nebenfenster, das während der Freigabe aufgeht, wäre ungeschützt.
- Handler für `onSharingChange`:
  ```ts
  remoteSharing = sharing; applyProtection();
  const main = windowRegistry.main();
  if (main && !main.isDestroyed()) { main.webContents.setBackgroundThrottling(!sharing); main.setTitle(mainWindowTitle()); }
  ```
  mit `const mainWindowTitle = (): string => mainT(remoteSharing ? 'window.mainSharing' : 'window.main');`.
- `localeStore.subscribe` (Zeile 305) verwendet für das Hauptfenster `mainWindowTitle()`.
- `createWindow` setzt `title` für `role === 'main'` ebenfalls über `mainWindowTitle()`.

**K12: Titelzusatz.** Einen „bestehenden Titelmechanismus“ im Renderer gibt es nicht: `src/main/index.ts:132` unterdrückt `page-title-updated`. Der Titel kommt deshalb aus Main (K11) über den neuen Key `main:window.mainSharing` (Task T). `remoteLab.bar.title` entfällt, App.tsx setzt keinen Titel.

**K13: Bootstrap in `src/main/index.ts`.**
- Direkt nach Zeile 240 und vor `app.whenReady()`:
  ```ts
  if (!app.isPackaged && process.env.SHELLHERD_SYNC_LAB === '1') {
    const disabled = app.commandLine.getSwitchValue('disable-features');
    app.commandLine.appendSwitch('disable-features', [disabled, 'WebRtcHideLocalIpsWithMdns'].filter(Boolean).join(','));
  }
  ```
  Im Code gibt es heute keinen eigenen `disable-features`-Switch, nur `disable-direct-composition`. Zusammengeführt wird mit einem eventuell von außen übergebenen Wert.
- `let remoteLabHost: RemoteLabHost | undefined;`. In `whenReady` folgt direkt nach `registerSyncLabIpc` die Zeile `remoteLabHost = await registerRemoteLabIpc({ isUnlocked: () => vaultSessionManager.isUnlocked() });` und danach `remoteLabHost.onSharingChange(…)` (K11).
- `remoteLabHost?.closeOwner(ownerId)` kommt in `closeOwnerSessions`.
- `remoteLabHost?.reset('locked')` kommt in `closeAllSessions`, in `onLock` (vor `protectWindows(true)`) und im `lock`-Callback von `AutoLock`.
- Preload-Argumente in `additionalArguments`:
  - `--shellherd-remote-lab=${remoteLabHost?.enabled ? '1' : '0'}`,
  - `--shellherd-remote-capture-fake=${remoteLabHost?.enabled && process.env.SHELLHERD_REMOTE_CAPTURE_FAKE === '1' ? '1' : '0'}`.
- `registerRemoteLabIpc(options: { isUnlocked(): boolean }): Promise<RemoteLabHost>`. `mainWindow` aus der Spec entfällt, weil es unbenutzt bleibt.

**K14: `lab-ipc.ts`.**
- Dynamische Imports (B2): `http-common.mjs`, `account-transport.mjs`, `rendezvous-client.mjs`, `rendezvous.mjs`.
- `probe`: `probeSyncServer(url, { allowLoopbackHttp: true, signal })` mit B5. Davor wird die URL mit `normalizeSyncServerUrl(raw, true)` geprüft (wie in `src/main/sync-prototype/lab-host.ts` bei `connect`); `null` ergibt `invalid` im Host.
- `createAccount`: `new AccountStore(info, { signal })`.
- `createPeer`: `new RendezvousPeer(account, identity)`.
- `presence`: `new PresenceLoop(transport, name, timers, handlers)`.
- `timers`: `{ setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: handle => clearTimeout(handle as NodeJS.Timeout), now: () => Date.now() }`.
- Für die Identität:
  - `generate`: `createRendezvousIdentity()`.
  - `derive(pkcs8)`: `const privateKey = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' }); const publicKey = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).toString('base64'); return { privateKey, publicKey, id: deviceId(publicKey) };`
  - Der `RemoteIdentityStore` wird **einmal** gebaut und gecacht (`identity()` gibt immer dieselbe Instanz zurück).
- Wirft irgendein Import, entsteht der Host ohne Deps.
- IPC:
  - `ipcMain.handle(IPC_CHANNELS.remoteLabAction, (event, raw) => { windowRegistry.requireMain(event); return host.action(event.sender.id, raw); })`.
  - Events: `host.onEvent((owner, event) => { const target = webContents.fromId(owner); if (target && !target.isDestroyed()) target.send(IPC_CHANNELS.remoteLabEvent, event); })`.
- Typen der dynamischen Imports werden per `as { … }` auf die Interfaces aus §2.5 gecastet, wie im Sync-Lab.

**K15: Renderer-Ablauf im Controller.**
- `share(id)`:
  1. `act({kind:'armCapture', sessionId: id})`. Ist das nicht `ok`, wird abgebrochen.
  2. `capture.capture()`. Bei einem Fehler folgt `act({kind:'decline', sessionId: id})`, und `view.error = 'media'`.
  3. `act({kind:'accept', sessionId: id})`. Ist das nicht `ok`, werden alle Tracks gestoppt (`view.error` kommt aus dem Reply).
  4. `peers.create({ iceServers: [] })` und `addTrack`.
  5. `createOffer`, dann `setLocalDescription`.
  6. Warten bis `iceGatheringState === 'complete'` oder bis 2000 ms vergangen sind (`timers`).
  7. `checkSdp(pc.localDescription.sdp, 'offer')`.
  8. `splitSignal('offer', sdp)` und je Teil seriell `act({kind:'signal', sessionId: id, part})`.
- Vor `capture.capture()` steht genau **ein** `await`, nämlich armCapture. Siehe E3.
- Der Viewer reagiert auf Events `signal` mit `kind === 'offer'`, der Agent auf `answer`. Andere Arten führen zu `error: 'signal'` und `stop()`.
- Der Collector arbeitet im Controller. Eine vollständige Nachricht wird mit `checkSdp` geprüft.
- Viewer: `create({ iceServers: [] })`, `ontrack` setzt `view.stream = event.streams[0] ?? new MediaStream([event.track])`. Dann `setRemoteDescription`, `createAnswer`, `setLocalDescription`, Gathering wie oben, `checkSdp(…, 'answer')`, `splitSignal('answer')` und `act(signal)`.
- Agent mit vollständiger `answer`: `setRemoteDescription`.
- `pc.connectionState === 'failed'`: `error: 'peer'`, dann `stop()`.
- Fehler aus `checkSdp`, `splitSignal` oder dem Collector: `error: 'signal'`, dann `stop()`.
- `stop()` läuft so ab:
  1. Synchron: alle Tracks des lokalen Streams per `stop()` beenden, `pc.close()` aufrufen, `view.stream` entfernen.
  2. Dann `act({kind:'stop', sessionId})` ohne `await`.
  3. Danach `view.ended = 'stopped'`.
- Event `ended`: lokal alles schließen wie bei `stop`, ohne `act`, und `view.ended = reason` setzen.
- `dispose()` beendet das Event-Abo und schließt lokal alles.

**K16: Zustimmungsdialog.**
- Der Knopf „Bildschirm freigeben“ ist in den ersten 1000 ms nach dem Öffnen `disabled`. Das ist eine Sicherheitsverzögerung gegen versehentliches Klicken oder Tippen; es gibt keine Animation.
- Der Default-Fokus liegt auf „Ablehnen“.
- Escape oder `onCancel` lösen `act({kind:'decline'})` aus.
- Der Click-Handler ruft `void controller.share(session.id)` **synchron** auf.
- Restzeit: `secondsLeft(session.expiresAt, Date.now())` über einen 1-s-Timer (`setInterval`). Das ist ein Textupdate, keine Bewegung.
- Bekannt seit: `formatDateTime(session.peer.known.firstSeen, 'short')`.
- Der volle Fingerprint steht in `groupFingerprint(session.peer.id)`, in Monospace über ein Token, analog zu `.sync-lab-fingerprint`.
- Der Linux-Hinweis erscheint, wenn `window.desktopApi.capabilities.platform === 'linux'`.

**K17: Dialog „Fernzugriff“ (H).**
- Muster wie `SyncLabDialog`: `<dialog className="confirm-dialog remote-lab-dialog">`, `useNativeSurfaceBlock(true)`, `showModal()`. Beim Unmount sendet der Dialog **kein** `close` (K2).
- Ist eine Viewer-Sitzung aktiv und der Dialog wird geschlossen, ruft er `controller.stop()` auf.
- Ablauf:
  1. Server-Adresse eingeben und „Verbinden“ (`connect`).
  2. Benutzername und Serverpasswort eingeben und „Anmelden“. Das Passwortfeld wird danach geleert.
  3. `signedInAs` anzeigen, Gerätename eingeben, „Online melden“ bzw. „Offline gehen“.
  4. Wenn online: eigenen Fingerprint anzeigen, bei `!persistent` zusätzlich `identityTemporary`.
  5. Geräteliste je Gerät: Name, voller Fingerprint, Checkbox `compared` und Knopf `requestView` (deaktiviert ohne Haken). Ändert sich die Liste oder das Ziel, wird der Haken zurückgesetzt.
  6. Ist die Viewer-Sitzung `requesting`, erscheint `waiting` erst nach 400 ms.
  7. Ist ein Stream da: `<video autoPlay muted playsInline>` mit `srcObject` aus einem Ref-Effect, `viewing` mit `formatDateTime(expiresAt, 'time')` und der Knopf `stop`.
- Fehler: `t(errorKey(view.error))` in `.field-error`, `role="alert"`. Ende: `t(endKey(view.ended))`.

**K18: Leiste und App (I).**
- `App.tsx`: `const remote = useMemo(() => window.desktopApi.remoteLabEnabled ? new RemoteSessionController(window.desktopApi, crypto.randomUUID(), browserPeers, window.desktopApi.remoteCaptureFake ? fakeCapture() : displayCapture) : null, []);`. Der Controller wird beim Unmount mit `dispose` aufgeräumt. Das Abo läuft über `useEffect`, `subscribe` und `setRemoteView`.
- `remoteLabOpen` folgt dem Muster von `syncLabOpen`, einschließlich des Rücksprungs in die Einstellungen beim Schließen. `SettingsDialog` bekommt die Prop `onRemoteLab?: () => void` mit Knopf `t('remoteLab:entry')` direkt unter dem Sync-Lab-Knopf (`SettingsDialog.tsx:140`).
- Zustimmungsdialog und Leiste erscheinen **nur im Vault-Zweig** (`screen === 'vault' && vault`), weil online nur entsperrt geht:
  - `RemoteConsentDialog`, wenn `session.role === 'agent' && session.state === 'consent'`.
  - `RemoteShareBar` als erstes Kind von `<main>` im Vault-Zweig, wenn `role === 'agent'` und `state` gleich `connecting` oder `active` ist. `onStop` ruft `remote.stop()` auf.
- Die Leiste zeigt `t('remoteLab:bar.viewing', { name, time: formatDateTime(startedAt ?? Date.now(), 'time') })` und einen Knopf `t('remoteLab:bar.stop')`, `role="status"`, `aria-live="polite"`.

**K19: run-app-Treiber (J).**
- `driver.mjs` setzt **nicht** pauschal `SHELLHERD_SYNC_LAB` oder `SHELLHERD_REMOTE_CAPTURE_FAKE`. Sonst würden alle Szenen den Sync- und den Fernzugriffsknopf zeigen, `settings.png` und die README-Bilder ändern sich. Die Variablen kommen über `...process.env` (Zeile 43) vom Aufrufer.
- J ergänzt in `args` unter Linux unbedingt `--password-store=basic` vor `APP_DIR`. So greift die Identität unter run-app nie auf den echten Schlüsselbund des Entwicklers zu, sondern läuft im RAM-only-Pfad (`identityTemporary`). Andere `safeStorage`-Nutzer gibt es in `src/` nicht.
- Die Einzelinstanz-Sperre ist kein Problem: `boot.mjs` setzt `userData` je `SHELLHERD_RUN_DIR`, und `requestSingleInstanceLock` gilt je userData (`src/main/index.ts:222`, SKILL „Stolpersteine“).

**K20: Rendezvous-Fake (J).**
- `.claude/skills/run-app/rendezvous.mjs` exportiert `startRendezvousFake({ port, dir }): Promise<{ port: number; url: string; close(): Promise<void> }>`.
- Aufbau: `createAccount('demo', 'synthetic-rendezvous-demo')` und `createSyncServer({ directory: dir, serverId: randomBytes(32).toString('hex'), namespace: 'demo', account, rendezvous: true })`, dann `listen(port)`.
- `sshd.mjs` startet den Fake mit `port: Number(process.env.RENDEZVOUS_FAKE_PORT ?? 8788)` und `dir: join(RUN_DIR, 'rendezvous')` in `try/catch`. Bei Erfolg schreibt es `rendezvous-fake ready on <port> (demo / synthetic-rendezvous-demo)`, bei einem Fehler `rendezvous-fake skipped`. Unter Windows scheitert die 0700-Prüfung in `server.mjs:120`.
- Der Test in `fakes.test.mjs` läuft mit `runIf(linux)` und Port 0. Er prüft `probeSyncServer(...).rendezvous === true` und den Login mit dem Demo-Konto.

**K21: Szene (K).** `.claude/skills/run-app/remote-scene.mjs`:
- Zwei Treiber mit den Umgebungsvariablen `A_RUN_DIR`/`A_PORT` (Vorgabe `<tmp>/shellherd-run`, 9333) und `B_RUN_DIR`/`B_PORT` (Vorgabe `<tmp>/shellherd-run-b`, 9336). Token aus `<RUN_DIR>/token`.
- Voraussetzungen, die der Lead herstellt:
  - beide Treiber gestartet mit `SHELLHERD_SYNC_LAB=1 SHELLHERD_REMOTE_CAPTURE_FAKE=1`,
  - `demo-setup.mjs` je Instanz mit passenden `SHELLHERD_RUN_DIR` und `DRIVER_PORT`,
  - `drive:sshd` läuft.
- Ablauf:
  1. **Nacheinander** anmelden: erst A, dann B. `accountAuth` lehnt einen gleichzeitigen Login mit 429 ab (`account-auth.mjs:25`, `!active`).
  2. A online, B online.
  3. B sieht A, vergleicht A's Fingerprint aus dem Dialog von A, setzt den Haken und fragt an.
  4. A zeigt die Zustimmung mit Bs vollem Fingerprint; Screenshot `remote-consent.png`.
  5. Mindestens 1100 ms warten (K16), dann bei A „Bildschirm freigeben“ per `/click`. Echte Playwright-Eingabe; das Fake-Capture braucht aber keine Nutzeraktivierung.
  6. A zeigt die Leiste; Screenshot `remote-bar.png`. Per `/main` prüfen, dass `BrowserWindow.getAllWindows().every(w => w.isContentProtected())` gilt.
  7. Bei B auf `video.readyState >= 2 && video.videoWidth > 0` warten (höchstens 20 s).
  8. Das Bild in eine Canvas zeichnen und vier Punkte bei (25 %, 25 %), (75 %, 25 %), (25 %, 75 %) und (75 %, 75 %) gegen die Farben aus §2.6 prüfen, je Kanal mit einer Toleranz von ±48. Screenshot `remote-viewer.png`.
  9. A klickt „Beenden“. B zeigt innerhalb von **8 s** (5-s-Takt plus Latenz) den Ende-Text.
  10. A's Leiste ist weg, und `isContentProtected()` ist wieder `false`.
  11. Ablehnen-Pfad: B fragt erneut an, A klickt „Ablehnen“, B zeigt `ended.declined` innerhalb von 8 s.
- `finally`: A und B gehen offline.
- Risiko, im Handbuch und in SKILL.md zu nennen: WebRTC nutzt nur Host-Kandidaten (`iceServers: []`), und Chromium lässt Loopback-Kandidaten weg. Die Szene braucht deshalb eine Nicht-Loopback-Schnittstelle (LAN-IP). Unter einem `xvfb-run` ohne Netz scheitert sie mit `errors.peer`.

**K22: Server-Refresh (B).**
- Ergänzung in `account-auth.mjs`:
  ```js
  refresh(header) { const key = this.authorize(header); const session = sessions.get(key); session.expiresAt = Math.min(clock() + 900000, session.created + 43200000); return { expiresAt: session.expiresAt }; },
  ```
  `authorize` ruft `expire()` auf. Ist die 12-h-Grenze erreicht, gilt `expiresAt <= now` und die Sitzung ist schon entfernt, was 401 ergibt.
- `server.mjs`, direkt nach dem Logout-Block (Zeile 174-177), mit leerem Body wie bei Logout (die Spec sagte „`{}`“, das ist korrigiert):
  ```js
  if (login && path === '/v1/refresh') {
    check(request.method === 'POST' && Number(request.headers['content-length'] ?? 0) === 0);
    send(200, login.refresh(request.headers.authorization)); return;
  }
  ```
  Er zählt automatisch zum globalen Limit (Zeile 159-160).
- `account-transport.mjs`: `async refresh() { const result = await this.request('POST', '/v1/refresh'); check(Number.isSafeInteger(result.expiresAt)); return { expiresAt: result.expiresAt }; }`. Dazu B5 (login gibt `expiresAt` zurück).
- `http-common.mjs`: B5 (`rendezvous` in `probeSyncServer`).
- **Verträgt sich das mit der Rendezvous-Bindung?** Ja. Das Gerät ist an `owner = digest(token)` gebunden (`account-auth.mjs:38`, `rendezvous.mjs:192`). Refresh ändert nur `expiresAt` im selben Map-Eintrag, `isActive(owner)` bleibt wahr, und es entsteht kein 409 aus `rendezvous.mjs:189-190`.
- Tests in `rendezvous.test.mjs` mit `ctx.advance`:
  1. Refresh verlängert, und der Rückgabewert ist `now + 900000`.
  2. Kette aus Refresh und Lease (je 30 s `register`, je 5 min `refresh`) bis über 12 h: der Refresh ab 12 h ergibt 401.
  3. Ohne Refresh ergibt der nächste Request nach 15 min 401.
  4. Präsenz überlebt mit Refresh die 15-min-Marke; dabei alle 30 s `register`, weil die Lease 60 s dauert. Ohne Refresh verschwindet das Gerät aus `devices()` des anderen Kontos.
  5. Refresh ohne Token oder mit Body ergibt 401 bzw. 400.
- `server/README.md`: Tabellenzeile `| POST /v1/refresh | Leerer Body; verlängert die Anmeldung um 15 Minuten, höchstens 12 Stunden ab Login. Token bleibt gleich. |` (vor den Rendezvous-Zeilen, im Absatz über die bestehende API). Außerdem wird der Satz „Ablauf des Tokens (15 Minuten)“ um „ohne `POST /v1/refresh`“ ergänzt.

**K23: Texte.** `remoteLab.close` und `remoteLab.bar.title` aus Spec 5.6 entfallen. Der Schließen-Knopf nutzt `common:actions.close` (wie `SyncLabDialog`), der Titel kommt über K12. Neu sind `remoteLab.signedInAs`, `remoteLab.consent.fingerprint` und `main:window.mainSharing`. Die vollständige Liste steht in §4.

**K24: Doku (K).**
- Der Handbuch-Abschnitt kommt in `docs/handbuch.md` **und** in `docs/manual.md`, das englische Gegenstück ist im Plan vergessen worden. Er steht jeweils vor „Prozessgrenzen und Lebenszyklus“ bzw. „Process boundaries and lifecycle“.
- Kein CHANGELOG-Eintrag und keine Versionsänderung, wie in der Spec. `version.test.ts` bleibt grün, weil die Version unverändert bleibt.
- README: kein Eintrag, weil die Funktion nur in der Entwicklung hinter einem Flag verfügbar ist.

---

## 4. Texte (Task T, vollständig, wörtlich)

`src/shared/locales/de-DE/remoteLab.json`:
```json
{
  "entry": "Fernzugriff einrichten (Entwicklung)",
  "badge": "Entwicklung · Fernzugriff",
  "title": "Bildschirm eines anderen Shellherd-Geräts ansehen",
  "notice": "Beide Geräte melden sich am selben Rendezvous-Server an. Das Bild läuft verschlüsselt direkt zwischen den Geräten; der Server sieht nur Vermittlungsdaten.",
  "serverUrl": "Server-Adresse",
  "connect": "Verbinden",
  "username": "Benutzername",
  "password": "Serverpasswort",
  "signIn": "Anmelden",
  "signedInAs": "Angemeldet als {{username}}",
  "deviceName": "Name dieses Geräts",
  "goOnline": "Dieses Gerät online melden",
  "goOffline": "Offline gehen",
  "online": "Online als {{name}} · Anmeldung gültig bis {{time}}",
  "fingerprintOwn": "Fingerabdruck dieses Geräts",
  "identityTemporary": "Temporäre Geräteidentität: Dieser Rechner hat keine Schlüsselablage des Betriebssystems. Der Fingerabdruck ändert sich beim nächsten Start.",
  "devices": "Online-Geräte",
  "noDevices": "Kein anderes Gerät ist online.",
  "compared": "Ich habe den Fingerabdruck auf dem anderen Gerät verglichen",
  "requestView": "Bildschirm ansehen",
  "waiting": "Warten auf Zustimmung am anderen Gerät …",
  "viewing": "Bildschirm von {{name}} · Sitzung endet {{time}}",
  "stop": "Verbindung beenden",
  "consent": {
    "title": "Bildschirm freigeben?",
    "body": "{{name}} möchte den Bildschirm dieses Geräts ansehen. Vergleiche den Fingerabdruck auf dem anderen Gerät.",
    "fingerprint": "Fingerabdruck des anfragenden Geräts",
    "known": "Bekannt seit {{date}}",
    "unknown": "Noch nicht bekanntes Gerät",
    "expires": "Anfrage verfällt in {{seconds}} s",
    "linuxHint": "Unter Linux bleibt auch das Shellherd-Fenster im übertragenen Bild sichtbar.",
    "accept": "Bildschirm freigeben",
    "decline": "Ablehnen"
  },
  "bar": {
    "viewing": "Bildschirm wird angesehen von {{name}} · seit {{time}}",
    "stop": "Beenden"
  },
  "ended": {
    "stopped": "Verbindung beendet.",
    "remote": "Das andere Gerät hat die Verbindung beendet.",
    "expired": "Die Sitzung ist nach fünf Minuten abgelaufen. Stelle eine neue Anfrage.",
    "locked": "Die Verbindung wurde beendet, weil der Vault gesperrt wurde.",
    "declined": "Das andere Gerät hat die Anfrage abgelehnt.",
    "failed": "Die Verbindung ist fehlgeschlagen.",
    "scope": "Steuerung wird noch nicht unterstützt. Nur Ansehen ist möglich."
  },
  "errors": {
    "unavailable": "Der Fernzugriff ist in diesem Build nicht verfügbar.",
    "invalid": "Die Eingabe ist ungültig.",
    "stale": "Der Vorgang ist nicht mehr aktuell. Schließe den Dialog und öffne ihn erneut.",
    "identity": "Die gespeicherte Geräteidentität ist beschädigt oder nicht lesbar. Sie wurde nicht ersetzt.",
    "locked": "Entsperre deinen Vault, um dieses Gerät online zu melden.",
    "connection": "Der Server ist nicht erreichbar.",
    "authentication": "Anmeldung fehlgeschlagen oder abgelaufen.",
    "expired": "Die Anfrage ist abgelaufen. Stelle sie erneut.",
    "declined": "Das andere Gerät hat die Anfrage abgelehnt.",
    "mismatch": "Die Geräteprüfung ist fehlgeschlagen. Es wurde nichts übertragen.",
    "signal": "Die Verbindungsdaten sind ungültig oder zu groß. Es wurde nichts übertragen.",
    "media": "Die Bildschirmaufnahme wurde abgebrochen oder ist nicht verfügbar.",
    "peer": "Keine direkte Verbindung möglich. Beide Geräte müssen im selben Netz sein.",
    "scope": "Steuerung wird noch nicht unterstützt. Nur Ansehen ist möglich.",
    "limit": "Zu viele Anfragen oder Geräte. Warte kurz und versuche es erneut."
  }
}
```

`src/shared/locales/en-US/remoteLab.json`:
```json
{
  "entry": "Set up remote access (development)",
  "badge": "Development · Remote access",
  "title": "View the screen of another Shellherd device",
  "notice": "Both devices sign in to the same rendezvous server. The picture travels encrypted directly between the devices; the server only sees connection data.",
  "serverUrl": "Server address",
  "connect": "Connect",
  "username": "Username",
  "password": "Server password",
  "signIn": "Sign in",
  "signedInAs": "Signed in as {{username}}",
  "deviceName": "Name of this device",
  "goOnline": "Announce this device online",
  "goOffline": "Go offline",
  "online": "Online as {{name}} · sign-in valid until {{time}}",
  "fingerprintOwn": "Fingerprint of this device",
  "identityTemporary": "Temporary device identity: this computer has no operating system key store. The fingerprint changes on the next start.",
  "devices": "Online devices",
  "noDevices": "No other device is online.",
  "compared": "I compared the fingerprint on the other device",
  "requestView": "View screen",
  "waiting": "Waiting for approval on the other device…",
  "viewing": "Screen of {{name}} · session ends {{time}}",
  "stop": "End connection",
  "consent": {
    "title": "Share your screen?",
    "body": "{{name}} wants to view the screen of this device. Compare the fingerprint on the other device.",
    "fingerprint": "Fingerprint of the requesting device",
    "known": "Known since {{date}}",
    "unknown": "Device not seen before",
    "expires": "Request expires in {{seconds}} s",
    "linuxHint": "On Linux, the Shellherd window also stays visible in the shared picture.",
    "accept": "Share screen",
    "decline": "Decline"
  },
  "bar": {
    "viewing": "Screen is being viewed by {{name}} · since {{time}}",
    "stop": "End"
  },
  "ended": {
    "stopped": "Connection ended.",
    "remote": "The other device ended the connection.",
    "expired": "The session expired after five minutes. Make a new request.",
    "locked": "The connection ended because the vault was locked.",
    "declined": "The other device declined the request.",
    "failed": "The connection failed.",
    "scope": "Control is not supported yet. Only viewing is possible."
  },
  "errors": {
    "unavailable": "Remote access is not available in this build.",
    "invalid": "The input is invalid.",
    "stale": "This action is out of date. Close the dialog and open it again.",
    "identity": "The stored device identity is damaged or unreadable. It was not replaced.",
    "locked": "Unlock your vault to announce this device online.",
    "connection": "The server cannot be reached.",
    "authentication": "Sign-in failed or expired.",
    "expired": "The request expired. Make it again.",
    "declined": "The other device declined the request.",
    "mismatch": "Device verification failed. Nothing was transferred.",
    "signal": "The connection data is invalid or too large. Nothing was transferred.",
    "media": "Screen capture was canceled or is not available.",
    "peer": "No direct connection possible. Both devices must be on the same network.",
    "scope": "Control is not supported yet. Only viewing is possible.",
    "limit": "Too many requests or devices. Wait a moment and try again."
  }
}
```

`main.json` bekommt in `window` je einen Eintrag: de-DE `"mainSharing": "Shellherd – Bildschirm wird angesehen"`, en-US `"mainSharing": "Shellherd – Screen is being viewed"`.

`src/shared/locales/index.ts`: Imports `remoteLabDe` und `remoteLabEn`, `'remoteLab'` am Ende von `NAMESPACES` und je `remoteLab: …` in beiden Ressourcen-Objekten.

**Welche Datei nutzt welchen Key** (Test (d) verlangt, dass jeder Key als volles Literal `'remoteLab:<key>'` vorkommt):

| Keys | Datei (Task) |
|---|---|
| `errors.*` (15), `ended.*` (7) | `src/renderer/src/remote-lab.ts` (G, Welle 2) |
| `badge`, `title`, `notice`, `serverUrl`, `connect`, `username`, `password`, `signIn`, `signedInAs`, `deviceName`, `goOnline`, `goOffline`, `online`, `fingerprintOwn`, `identityTemporary`, `devices`, `noDevices`, `compared`, `requestView`, `waiting`, `viewing`, `stop` | `RemoteLabDialog.tsx` (H) |
| `consent.*` (9) | `RemoteConsentDialog.tsx` (H) |
| `entry` | `SettingsDialog.tsx` (I) |
| `bar.viewing`, `bar.stop` | `RemoteShareBar.tsx` (I) |
| `main:window.mainSharing` (als `'window.mainSharing'`) | `src/main/index.ts` (F) |

---

## 5. Prüfung der Sicherheitsregeln R1 bis R12

| Regel | Befund | Maßnahme |
|---|---|---|
| R1 Klick am Ziel | Die Zustimmung entsteht nur im Renderer. Main kann einen Klick nicht beweisen; ein kompromittierter Renderer könnte `armCapture` und `accept` selbst senden. | Entscheidung E1. Gegenmittel, soweit möglich: `accept` nur nach `armCapture` (K5), 1 s Sperre am Knopf (K16), Default-Fokus „Ablehnen“. |
| R2 Fingerprint | Der Server kann einen falschen publicKey liefern, aber `peer.channel` prüft `deviceId(pk) === fingerprint` (`rendezvous-client.mjs:54`). Der angezeigte Fingerprint ist die ID, gegen die der Kanal kryptografisch geprüft wird. | Fehler bei `channel()` ergeben `mismatch` (K5). |
| R3 Scope | Der Scope geht in die HKDF-Info ein (`rendezvous-client.mjs:59`). Lügt der Server über den Scope, schlägt die Entschlüsselung fehl. | Wie spezifiziert, ergänzt um K4. |
| R4 Grant | In der Spec fehlten die Prüfung auf den Main-Frame (Iframe-Warnung in `electron.d.ts`), `videoRequested` und das Löschen bei `accept`. | K7 |
| R5 Beenden | Ohne Kanal fehlte der Pfad, und der Renderer sollte ein `bye` senden. | K8, K5 (`bye` nur host-intern) |
| R6 Sperre | Die Spec war vollständig. Es fehlte, dass `goOffline` und `close` ebenfalls lokal zuerst beenden. | K8, K13 |
| R7 Identität | Bei vorhandener Datei ohne verfügbaren Cipher war das Verhalten unklar; ein stiller Neuanfang wäre möglich gewesen. | §2.4 (ergibt `identity`) |
| R8 kein Relay | `checkSdp` ist für beide Seiten verbindlich. | §2.2 |
| R9 Last | Bei zwei Geräten etwa 52 Requests pro Minute Grundlast, im Aufbau bis zu etwa 120 je Gerät für höchstens 60 s, alles unter 600. Der Viewer-Poll aus B1 (1 s, höchstens 60 s) ist eingerechnet. | keine |
| R10 keine Freitexte | Asynchrone Fehler hatten keinen Kanal. | K9 (`{kind:'error', code}`) |
| R11 Fensterschutz | `protectWindows(false)` aus `syncVaultChanged` und neue Fenster hebelten den Schutz aus. | K11 |
| R12 Fake | „Grant wird verbraucht“ stimmt nicht: Das Fake-Capture ruft kein `getDisplayMedia` auf, also läuft der Handler nicht. Der Grant wird bei `accept` gelöscht (K5, K7). Das Gate wird in `lab-host.test.ts` geprüft (einmalig, 15 s, Owner, Sitzung) und manuell im echten Pfad. | Text von R12 entsprechend korrigiert |
| Server fälscht Zustimmung? | Nein. Der Viewer wird erst mit dem verschlüsselten `accepted`-Frame des Agenten bereit (`rendezvous-client.mjs:108-110`). Den kann der Server ohne den Schlüssel des Agenten nicht erzeugen. Setzt der Server die Sitzung selbst auf `active` (B1-Poll), legt der Viewer zwar einen Kanal an, sendet aber nichts, bis `accepted` entschlüsselt ist (`send` prüft `#ready`). Ein Angebot kommt nur vom Agenten. | keine |
| Busy | Fehlte in der Spec teilweise: Auch eine eigene laufende Viewer-Anfrage zählt als busy. | K4 |
| Geheimnisse | Das Serverpasswort wird nicht gehalten, und weder Token, privater Schlüssel noch publicKey erreichen den Renderer. | K5, K10 |

---

## 6. Endgültige Wellen und Dateizuschnitt (ersetzt die Plan-Tabellen)

Jede Datei gehört genau einer Task. `App.tsx`, `src/main/index.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/shared/locales/index.ts` und `main.json` haben je genau einen Besitzer. Nach jeder Welle müssen `npm run typecheck` und `npx vitest run` grün sein, und der Lead committet je Task.

### Welle 1 (unabhängig, parallel)

| Task | Dateien (exklusiv) | Inhalt | Tests |
|---|---|---|---|
| A Vertrag | `src/shared/remote-lab.ts`, `src/shared/remote-signal.ts`, `src/shared/remote-signal.test.ts`, `scripts/sync-prototype/remote-signal.test.mjs` (neu), `src/shared/ipc.ts`, `src/preload/index.ts` | §2.1 bis §2.3, K1 | Codec (Grenzen, Reihenfolge, Doppel, Wechsel, Surrogate), `checkSdp` (je Regel ein Fall), `formatFingerprint`, Rahmengröße aus K1. Im `.mjs`-Test (B6): 20-KiB-Payload in Teilen über `createSyncServer({ rendezvous: true })` und zwei `RendezvousPeer`, Muster aus `rendezvous.test.mjs:17-37`, mit `runIf(linux)` |
| B Server | `scripts/sync-prototype/account-auth.mjs`, `server.mjs`, `account-transport.mjs`, `http-common.mjs`, `rendezvous.test.mjs`, `server/README.md` | K22, B5 | die fünf Tests aus K22, dazu `probeSyncServer(...).rendezvous` und `login().expiresAt` |
| C Identität | `src/main/remote/identity.ts`, `src/main/remote/identity.test.ts` | §2.4 | Fake-Cipher, tmp-Ordner. Speichern und Laden mit gleichem Fingerprint; 0600 (nicht win32); keine tmp-Reste; korrupt, `version` 2 oder nicht entschlüsselbar ergeben `identity`, und die Datei ist byte-gleich; Cipher nicht verfügbar ergibt RAM-only, auch bei zweimal `load` dieselbe ID; Datei vorhanden und Cipher nicht verfügbar ergibt `identity`; `remember` mit höchstens 64 Einträgen und Verdrängung nach `lastSeen`; `known` |
| D Präsenz | `src/main/remote/presence.ts`, `src/main/remote/presence.test.ts` | §2.4 | Fake-Timer und -Transport: sofortiger Poll, Takte 30 s / 5 s / 300 s, keine Überlappung (ein hängender Poll blockiert nur seine Kette), 401 aus jeder Kette, Lease-Backoff 5/10/20/20 s, `connection` bei 60 s, `stop` idempotent ohne späte Handler |
| J run-app-Fakes | `.claude/skills/run-app/rendezvous.mjs` (neu), `driver.mjs`, `sshd.mjs`, `fakes.test.mjs` | K19, K20 | Fake-Test aus K20 |

### Welle 2 (braucht A, C, D)

| Task | Dateien | Inhalt |
|---|---|---|
| E Host | `src/main/remote/lab-host.ts`, `src/main/remote/lab-host.test.ts` | §2.5 und K2 bis K10 mit Fake-Deps. Pflichttests: R1 (`accept` ohne `armCapture` ergibt `stale`), R3 (control ergibt DELETE ohne Event), busy (zweite Anfrage und eigene Viewer-Anfrage ergeben DELETE), R4 (Grant einmalig, 15 s, fremder Owner `null`, nach `accept`/`stop` `null`), R5 (`stop` gibt sofort `ended`, auch wenn `close()` nie auflöst), R6 (`reset('locked')` und `closeOwner`), B1 (Viewer baut den Kanal erst bei `active`, 404 bei `requesting` ergibt `declined`), K3-Fristen, Serien-Queue (zweiter Send erst nach dem ersten), `bye` vom Renderer ergibt `invalid`, Rollenprüfung offer/answer, Event-Dedupe K10, Fehler-Event K9 |
| G Renderer-Logik | `src/renderer/src/remote-lab.ts`, `src/renderer/src/remote-lab.test.ts`, `src/renderer/src/remote-peer.ts`, `src/renderer/src/remote-peer.test.ts`, `src/renderer/src/remote-capture-fake.ts` | §2.6, K15. Tests mit Fake-PC und Fake-API: Reihenfolge armCapture, capture, accept, offer; nur ein `await` vor `capture`; 2-s-Timeout; Capture-Fehler ergibt decline und `media`; accept-Fehler stoppt Tracks; Viewer offer ergibt answer; `failed` ergibt `peer` und stop; ungültiges SDP ergibt `signal`; `ended`-Event schließt alles; `iceServers: []` |

### Welle 3 (braucht E und G, parallel)

| Task | Dateien | Inhalt |
|---|---|---|
| F IPC und Bootstrap | `src/main/remote/lab-ipc.ts`, `src/main/index.ts` | B2, K7, K11, K13, K14 |
| T Texte | `src/shared/locales/de-DE/remoteLab.json`, `src/shared/locales/en-US/remoteLab.json`, `src/shared/locales/index.ts`, `src/shared/locales/de-DE/main.json`, `src/shared/locales/en-US/main.json` | §4 wörtlich |
| H Dialoge | `src/renderer/src/components/RemoteLabDialog.tsx`, `src/renderer/src/components/RemoteConsentDialog.tsx`, `src/renderer/src/remote-lab.css` | §2.7, K16, K17. CSS: Präfix `.remote-`, nur Tokens, keine Transition oder Animation, kein z-index, inklusive `.remote-share-bar*` für I |
| I Leiste und Einstieg | `src/renderer/src/components/RemoteShareBar.tsx`, `src/renderer/src/App.tsx`, `src/renderer/src/components/SettingsDialog.tsx` | §2.7, K18 |

### Welle 4

| Task | Dateien | Inhalt |
|---|---|---|
| K Szene und Doku | `.claude/skills/run-app/remote-scene.mjs` (neu), `.claude/skills/run-app/SKILL.md`, `docs/handbuch.md`, `docs/manual.md`, `docs/plans/selfhosted-e2ee.md`, `docs/plans/docker-rendezvous.md` | K21, K24. In `SKILL.md`: Port 8788 in der Tabelle, zweite Instanz (9336, eigener `SHELLHERD_RUN_DIR`), Flags beim Aufrufer, `--password-store=basic`, sequentieller Login, Voraussetzung LAN-IP. Handbuch mit den Grenzen aus Plan K und dem LAN-IP-Hinweis |

Danach führt der Lead die Szene aus, und es folgen Review, eine Fix-Welle und die Nachprüfung, wie im Plan beschrieben.

---

## 7. Entscheidungen (Rulings)

- **E1: Die Zustimmung bleibt ein Renderer-Klick, ohne nativen Main-Dialog.**
  - Warum: Das entspricht allen bestehenden Bestätigungen, und `getDisplayMedia` braucht ohnehin die Aktivierung im Renderer.
  - Kosten, falls falsch: Ein kompromittierter Renderer (XSS) könnte ohne Klick freigeben. Abgemildert durch K5, K16 und die Leiste. Zu benennen im Handbuch („Entwicklungsfunktion ohne Sicherheitsreview“).
- **E2: Der Viewer pollt `GET /sessions/:id` bis `active` und baut erst dann den Kanal (B1).**
  - Warum: Ohne Serveränderung sonst nicht lösbar (409), und die Frist ist richtig ausgerichtet.
  - Kosten: bis zu 60 zusätzliche Requests je Anfrage.
- **E3: `request.userGesture` wird im Handler nicht erzwungen.**
  - Warum: Die Freigabe ist der Grant aus dem Klickpfad. Chromiums transiente Aktivierung hält etwa 5 s, und vor `getDisplayMedia` liegt genau ein IPC-Roundtrip (armCapture), was reicht. Die Spec-Reihenfolge armCapture, capture, accept hat nur **einen** Roundtrip vor dem Capture, nicht zwei.
  - Kosten, falls Chromium die Aktivierung doch strenger prüft: Die manuelle Prüfung mit echtem Portal schlägt mit `media` fehl. Dann wird das Capture vor `armCapture` gestartet, und der Handler wartet bis zu 1 s auf den Grant.
- **E4: Lokale Uhr für alle Sitzungsfristen (K3).**
  - Warum: Die Uhren im LAN können abweichen.
  - Kosten: Die Anzeige kann bis zu 5 s von der Serverwahrheit abweichen; der Server bleibt maßgeblich (404).
- **E5: Refresh mit leerem Body wie Logout (K22).**
  - Warum: Gleiche Form wie der vorhandene Endpunkt, und `AccountStore.request` ohne Body funktioniert bereits.
  - Kosten: keine.
- **E6: Der Treiber setzt die Lab-Flags nicht selbst (K19).**
  - Warum: Bestehende Szenen und README-Bilder bleiben unverändert.
  - Kosten: Die Flags müssen beim Start der Szene von Hand gesetzt werden.
- **E7: `--password-store=basic` im Treiber unter Linux.**
  - Warum: run-app berührt den echten Schlüsselbund nicht.
  - Kosten: Der persistente Identitätspfad läuft nur im Unit-Test, nicht in der Szene.
- **E8: Vier Wellen statt drei.**
  - Warum: E braucht A, C und D, G braucht A, und die Keys aus T müssen in derselben Welle wie ihre Nutzer stehen (B3).
  - Kosten: eine Welle mehr Laufzeit.
- **E9: `'scope'` bleibt in den Typen und Texten reserviert, wird in M1 aber nie gesendet.**
  - Warum: Die Spec nennt es, und die Maps sind vollständig.
  - Kosten: zwei Texte, die in M1 tot sind.
