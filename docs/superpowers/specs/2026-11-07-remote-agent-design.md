# Fernzugriff (Entwicklung), Meilenstein 1: Bildschirm ansehen – Design

> Übernommen aus dem Konzept (Fable, `.superpowers/sdd/2026-11-07-remote-agent-research.md`, dort Fundstellen und Begründungen). Bindend geht `2026-11-07-remote-agent-validation.md` vor. Wellen und Task-Zuschnitt: `docs/superpowers/plans/2026-11-07-remote-agent.md`.

Branch `claude/feature/remote-agent`, gestapelt auf `feature/docker-rendezvous-server` (`ede843a`). **Keine Versionsänderung, kein Push, kein PR** (Nutzervorgabe). Signaturen, Fehlercodes und Kanalnamen unten sind wörtlich zu übernehmen.

## 1. Ziel

Zwei Shellherd-Instanzen, die sich am selben selbst gehosteten Rendezvous-Server anmelden, können nach vollständigem Fingerprint-Vergleich und **sichtbarer Zustimmung am Ziel** den Bildschirm des Ziels ansehen. Das Bild läuft per Electron-WebRTC (DTLS-SRTP) direkt zwischen den Geräten; SDP geht ausschließlich über den bestehenden E2EE-Rendezvous-Kanal. Das Ziel zeigt währenddessen dauerhaft eine Leiste „Bildschirm wird angesehen … Beenden“.

Nur Entwicklung: aktiv nur ungepackt mit `SHELLHERD_SYNC_LAB=1` (wie Sync-Lab).

## 2. Umfang

**M1 (diese Pipeline):**
1. Server: `POST /v1/refresh` (Token verlängern).
2. Shared: Vertrag `remote-lab.ts`, Signal-Codec `remote-signal.ts`.
3. Main: persistente Identität (`safeStorage`), Präsenzschleife, `RemoteLabHost`, IPC, Capture-Gate, Lock-Reset.
4. Renderer: Controller für WebRTC, Dialog „Fernzugriff“, Zustimmungsdialog, dauerhafte Leiste, Einstieg in den Einstellungen.
5. run-app: Rendezvous-Fake, Fake-Capture, Zwei-Instanzen-Szene mit Pixelprüfung.
6. Doku: Handbuch-Abschnitt „Fernzugriff (Entwicklung)“, Planstand in `docs/plans/selfhosted-e2ee.md` und `docs/plans/docker-rendezvous.md`. **Kein CHANGELOG-Eintrag und kein `version:minor`**: `CHANGELOG.md` verlangt je Abschnitt eine Version, und Versionsänderungen sind vom Nutzer ausgeschlossen; die Funktion ist reine Entwicklung hinter Flag.

**Nicht in M1 (Extras, ausdrücklich nicht bauen):** Maus/Tastatur (`control`), TURN/coturn/STUN, Sitzungsverlängerung, Viewer als Tab, Monitorauswahl, OS-Benachrichtigung, Audio, Zwischenablage, Dateien, Aufzeichnung, Dienst/Session 0/Sperrbildschirm/UAC, CI-Lauf der Szene, Forward-Secrecy-Umbau des E2EE-Kanals.

## 3. Sicherheitsregeln (bindend)

- **R1** Keine Annahme ohne Klick am Ziel. Kein „immer erlauben“, keine Auto-Annahme über „bekannte Geräte“ oder Servernamen.
- **R2** Viewer fragt nur an, wenn der Nutzer `compared: true` bestätigt hat; der Fingerprint wird vollständig (64 Hex, 8 Gruppen à 8) angezeigt. Ziel zeigt den vollen Fingerprint des Anfragenden in der Zustimmung.
- **R3** `scope !== 'view'` wird am Ziel sofort abgelehnt (`DELETE /sessions/:id`), ohne Dialog. Der Viewer kann nur `view` anfragen. `RemoteScope` ist im Typ nur `'view'`.
- **R4** Capture nur mit Grant: `setDisplayMediaRequestHandler` liefert eine Quelle **nur**, wenn `RemoteLabHost.consumeCaptureGrant(webContentsId)` eine gültige, nicht verbrauchte Freigabe für genau diesen `webContents` zurückgibt; sonst `callback({})`. Grant ist einmalig, 15 s gültig, an Owner und Session gebunden.
- **R5** „Beenden“ wirkt lokal sofort (Tracks `stop()`, PeerConnection `close()`), unabhängig vom Server; danach `bye` best effort und `channel.close()`.
- **R6** Vault-Sperre, Auto-Sperre, Fensterschließen des Owners und App-Ende beenden alles (`reset()` bzw. `closeOwner()`), inkl. Abmeldung best effort.
- **R7** Identität: nur speichern, wenn `safeStorage.isEncryptionAvailable()` und Backend ≠ `basic_text`. Nie `setUsePlainTextEncryption`. Sonst RAM-only mit sichtbarem Hinweis. Beschädigte Datei wird **nicht** überschrieben → Fehler `identity`.
- **R8** Keine ICE-Server (`iceServers: []`), keine öffentlichen STUN/TURN. `checkSdp` lehnt `typ relay`-Kandidaten ab. Nur im Lab: `disable-features=WebRtcHideLocalIpsWithMdns`.
- **R9** Kein Medienrelay: Server-Limits (8 KiB/Frame, 32 Frames, 600 req/min) bleiben unverändert. Polling minimal 1 s (nur im Aufbau), sonst 5 s.
- **R10** Main sendet keine Freitexte an den Renderer; Fehler sind Codes, Texte über `t()` im Renderer.
- **R11** Während einer Freigabe `setContentProtection(true)` auf allen eigenen Fenstern und `setBackgroundThrottling(false)` auf dem Hauptfenster; beides beim Ende zurück (Schutz nur zurück, wenn der Vault entsperrt ist und vorher kein Schutz aktiv war – vorhandene `protectWindows`-Logik in `src/main/index.ts` nutzen).
- **R12** Fake-Capture (`SHELLHERD_REMOTE_CAPTURE_FAKE=1`) nur ungepackt und nur mit Lab-Flag; es durchläuft trotzdem `armCapture` (Grant wird verbraucht, R4 bleibt testbar).

## 4. Server: Token-Refresh

`scripts/sync-prototype/account-auth.mjs` – `accountAuth()` bekommt `refresh(header)`:
- Gültige Session (Bearer wie bei `isActive`) → `expiresAt = min(now + 900000, created + 43200000)`; Token bleibt **gleich** (Rendezvous bindet an den Session-Hash). Rückgabe `{ expiresAt }`.
- Abgelaufen/unbekannt/absolute Grenze erreicht (`now >= created + 43200000`) → wirft wie bisher 401-Pfad.
- `server.mjs`: `POST /v1/refresh` (leerer Body `{}`), nur bei Passwortauthentifizierung, zählt zum globalen Request-Limit, Antwort `{ expiresAt }`.
- `account-transport.mjs`: `AccountStore.refresh(): Promise<{ expiresAt: number }>`.
- Tests in `rendezvous.test.mjs` (Fake-Clock): verlängert; 12-h-Grenze → 401; abgelaufen → 401; Präsenz/Sitzung überlebt mit Refresh die 15-min-Marke und endet ohne.
- `server/README.md`: Endpunkt in der API-Liste.

## 5. Vertrag

### 5.1 `src/shared/remote-lab.ts`

```ts
export type RemoteScope = 'view';
export interface RemoteDevice { id: string; name: string; known?: { firstSeen: number } }   // id == fingerprint (64 hex)
export type RemoteEndReason = 'stopped' | 'remote' | 'expired' | 'locked' | 'declined' | 'failed' | 'scope';
export type RemoteErrorCode = 'unavailable' | 'invalid' | 'stale' | 'identity' | 'locked' | 'connection' | 'authentication' | 'expired' | 'declined' | 'mismatch' | 'signal' | 'media' | 'peer' | 'scope' | 'limit';
export type RemoteLabRequest = { clientId: string } & (
  | { kind: 'status' } | { kind: 'close' }
  | { kind: 'connect'; serverUrl: string }
  | { kind: 'signIn'; username: string; password: string }
  | { kind: 'goOnline'; deviceName: string } | { kind: 'goOffline' }
  | { kind: 'request'; target: string; compared: true }
  | { kind: 'armCapture'; sessionId: string }
  | { kind: 'accept'; sessionId: string } | { kind: 'decline'; sessionId: string }
  | { kind: 'signal'; sessionId: string; part: RemoteSignalPart }
  | { kind: 'stop'; sessionId: string });
export interface RemoteSignalPart { kind: 'offer' | 'answer' | 'bye'; part: number; of: number; data: string }
export interface RemoteLabSession { id: string; role: 'viewer' | 'agent'; peer: RemoteDevice; scope: RemoteScope; state: 'requesting' | 'consent' | 'connecting' | 'active'; expiresAt: number; startedAt?: number }
export interface RemoteLabState {
  phase: 'idle' | 'serverReady' | 'signedIn' | 'online';
  server?: { serverUrl: string; serverId: string };
  account?: { username: string; validUntil: number };
  identity?: { fingerprint: string; persistent: boolean };
  devices?: RemoteDevice[];            // other online devices, never self
  session?: RemoteLabSession;          // at most one session at a time in M1
}
export type RemoteLabEvent =
  | { kind: 'state'; state: RemoteLabState }
  | { kind: 'signal'; sessionId: string; part: RemoteSignalPart }
  | { kind: 'ended'; sessionId: string; reason: RemoteEndReason };
export type RemoteLabReply = { ok: true; state: RemoteLabState } | { ok: false; code: RemoteErrorCode };
export const REMOTE_LAB_LIMITS = { deviceName: 80, signalPart: 6144, signalParts: 4, sdp: 24576, captureGrantMs: 15000, requestMs: 60000, sessionMs: 300000 } as const;
```

Zeitwerte (`expiresAt`, `validUntil`, `startedAt`, `firstSeen`) sind Epoch-ms; Anzeige nur über `src/shared/format.ts`.

### 5.2 `src/shared/remote-signal.ts` (rein)

- `splitSignal(kind, data): RemoteSignalPart[]` – UTF-8-Bytes ≤ 6144 je Teil, `of ≤ 4`, sonst `throw`. `bye` = ein Teil mit `data: ''`.
- `class SignalCollector { push(part): { kind, data } | null }` – Teile einer Nachricht in Reihenfolge `part = 1..of`, gleiches `kind`/`of`; Lücke, Doppel, Wechsel → `throw`. Nach vollständiger Nachricht Reset.
- `checkSdp(sdp, kind: 'offer' | 'answer'): void` – wirft, wenn: Länge > 24576; nicht genau ein `m=video`; irgendein `m=audio` oder `m=application`; kein `a=fingerprint:sha-256 `; irgendein `a=candidate` mit ` typ relay`.
- `formatFingerprint(hex64): string` – 8 Gruppen à 8, durch Leerzeichen getrennt; ungültige Eingabe → `throw`.

### 5.3 IPC

- Kanal `remote-lab:action` (invoke, `windowRegistry.requireMain`), Push `remote-lab:event` nur an das Hauptfenster (`webContents` des Owners).
- In `IPC_CHANNELS`: `remoteLabAction: 'remote-lab:action'`, `remoteLabEvent: 'remote-lab:event'`.
- `DesktopApi` (`src/shared/ipc.ts`) und Preload:
  ```ts
  remoteLabEnabled: boolean;            // --shellherd-remote-lab=1
  remoteCaptureFake: boolean;           // --shellherd-remote-capture-fake=1
  remoteLabAction: (request: RemoteLabRequest) => Promise<RemoteLabReply>;
  onRemoteLabEvent: (listener: (event: RemoteLabEvent) => void) => () => void;
  ```

### 5.4 Main: `src/main/remote/`

**`identity.ts`**
```ts
export interface IdentityCipher { available(): boolean; encrypt(plain: Buffer): Buffer; decrypt(cipher: Buffer): Buffer }
export interface RemoteIdentity { privateKey: KeyObject; publicKey: string; id: string }   // same shape as rendezvous-client createRendezvousIdentity()
export class RemoteIdentityStore {
  constructor(file: string, cipher: IdentityCipher, generate: () => RemoteIdentity, derive: (pkcs8: Buffer) => RemoteIdentity);
  load(): { identity: RemoteIdentity; persistent: boolean };   // throws Error('identity') on corrupt/undecryptable file; never overwrites
  known(fingerprint: string): { firstSeen: number } | undefined;
  remember(fingerprint: string, name: string, now: number): void;   // max 64, oldest lastSeen dropped; no-op write when not persistent (RAM list)
}
export function safeStorageCipher(): IdentityCipher;   // available() = isEncryptionAvailable() && backend !== 'basic_text' (non-Linux: backend check skipped)
```
Datei `userData/remote-identity.json`: `{ version: 1, identity: base64(cipher), knownDevices: [{ fingerprint, name, firstSeen, lastSeen }] }`, Modus 0600, Schreiben atomar (tmp im selben Ordner, fsync, rename). `derive` baut aus PKCS8-DER die Identität (`createPrivateKey` + `createPublicKey(...).export(spki der)` + `deviceId`); `generate`/`derive` werden von `lab-ipc.ts` aus dem Prototyp-Modul gebaut, damit `identity.ts` keine `.mjs` importiert.

**`presence.ts`**
```ts
export interface PresenceTransport { register(name: string): Promise<unknown>; sessions(): Promise<unknown[]>; devices(): Promise<unknown[]>; refresh(): Promise<{ expiresAt: number }>; unregister(): Promise<unknown> }
export interface PresenceTimers { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(handle: unknown): void; now(): number }
export class PresenceLoop {
  constructor(transport: PresenceTransport, name: string, timers: PresenceTimers, handlers: { onSessions(list: unknown[]): void; onDevices(list: unknown[]): void; onValidUntil(ms: number): void; onOffline(code: 'authentication' | 'connection'): void });
  start(): Promise<void>;   // register once (throws on failure), then schedule
  stop(): Promise<void>;    // cancels timers, unregister() best effort, idempotent
}
```
Takt: Lease (`register`) alle 30 s, `sessions()`+`devices()` alle 5 s, `refresh()` alle 5 min. Fehler mit Status 401 → `onOffline('authentication')` und Stopp; sonstige Fehler: Wiederholung mit Backoff (5 s, 10 s, 20 s), nach 60 s ohne erfolgreichen Lease → `onOffline('connection')`. Kein Takt läuft parallel zu sich selbst.

**`lab-host.ts`** – `RemoteLabHost` (Zustandsautomat, testbar ohne Electron; alle Abhängigkeiten injiziert):
```ts
export interface RemoteDeps {
  probe(serverUrl: string, signal: AbortSignal): Promise<{ serverUrl: string; serverId: string; authentication: string; rendezvous?: boolean }>;
  createAccount(info: unknown, signal: AbortSignal): RemoteAccount;            // AccountStore
  createPeer(account: RemoteAccount, identity: RemoteIdentity): RemotePeer;    // RendezvousPeer
  identity(): RemoteIdentityStore;
  presence(transport: PresenceTransport, name: string, handlers: ConstructorParameters<typeof PresenceLoop>[3]): Pick<PresenceLoop, 'start' | 'stop'>;
  timers: PresenceTimers;
  isUnlocked(): boolean;
}
export class RemoteLabHost {
  constructor(deps?: RemoteDeps);                       // without deps: enabled === false, every action → 'unavailable'
  get enabled(): boolean;
  action(owner: number, raw: unknown): Promise<RemoteLabReply>;   // zod-strict per kind, dispatch
  onEvent(listener: (owner: number, event: RemoteLabEvent) => void): () => void;
  consumeCaptureGrant(webContentsId: number): string | null;      // returns sessionId, single use
  readonly sharing: boolean;                            // agent session in state 'active' or 'connecting' after accept
  onSharingChange(listener: (sharing: boolean) => void): () => void;
  closeOwner(owner: number): void;
  reset(reason?: 'locked'): void;                       // ends session (event ended/locked), stops presence, disposes
}
```
`RemoteAccount`/`RemotePeer` sind schmale Interfaces über `AccountStore` und `RendezvousPeer`/`RendezvousChannel` (Methoden wie in `scripts/sync-prototype/*.mjs`, plus `refresh()`). Regeln:
- Owner/clientId-Bindung wie `SyncLabHost`: erster `connect` legt sie fest; fremder Owner/clientId → `stale`. `clientId` ist UUID.
- `goOnline` nur wenn `isUnlocked()` (sonst `locked`), Name 1–80 Zeichen, `PresenceLoop.start()`; Fehler `identity` aus `load()` durchreichen.
- `request`: nur `phase === 'online'`, keine laufende Session, Ziel in aktueller Geräteliste; Public Key aus der Liste, Kanal mit `peer.channel(session, pk, target, 'view')`. Ziel-Fingerprint = Ziel-ID; der Nutzer hat ihn verglichen (`compared: true`).
- Eingehend (aus `onSessions`): Session `to === self`, `state === 'pending'`. `scope !== 'view'` → `DELETE` + kein Dialog (R3). Bereits eine Session aktiv → `DELETE` (busy). Sonst `session.state = 'consent'`, Peer-Name aus Geräteliste, `known` aus Identity-Store, Event `state`.
- `armCapture`: nur Agent-Session in `consent`; setzt Grant `{ owner(webContentsId), sessionId, until: now + 15000, used: false }`; kein Netzwerk.
- `accept`: nur Agent-Session in `consent`; `channel.accept()`; danach `state = 'connecting'`, `sharing = true`. Fehler → `failed`.
- `decline`: Agent in `consent` → `DELETE`, Event `ended/declined`.
- `signal`: Teil prüfen (Größe, `of ≤ 4`), sendet `{ part }` über `channel.send`; Sends werden **seriell** in einer Queue abgearbeitet. `bye` beendet danach lokal.
- Empfangen: solange eine Session mit Kanal existiert, `channel.receive()` alle 1 s bis `active`, danach alle 5 s; jeder Wert, der ein gültiger `RemoteSignalPart` ist, → Event `signal`; anderes → `failed`. Erster empfangener `answer`-/`offer`-Abschluss setzt nichts automatisch – `active` setzt der Host, wenn auf Viewer-Seite die erste `offer`-Nachricht vollständig ist bzw. auf Agent-Seite die erste `answer` vollständig ist (`SignalCollector`). Nach `active`: `remember(peer)`.
- Ablauf: Session-Deadline `expiresAt` (Anfrage 60 s, aktiv 300 s ab Annahme – Werte aus Serverantwort, sonst Limits) → `ended/expired`. 404/Fehler im Kanal → `ended/remote`. `bye` empfangen → `ended/remote`.
- `stop` (beide Rollen) und `reset`: lokal sofort Zustand leeren, Events `ended`, dann `bye`/`close()` best effort ohne auf das Netz zu warten.
- Zu jeder Zustandsänderung Event `state` an den Owner.

**`lab-ipc.ts`** – `registerRemoteLabIpc(options: { isUnlocked(): boolean; mainWindow(): BrowserWindow | undefined }): Promise<RemoteLabHost>`:
- Nur ungepackt + `SHELLHERD_SYNC_LAB=1`: lädt `http-common.mjs`, `account-transport.mjs`, `rendezvous-client.mjs`, `rendezvous.mjs` (für `deviceId`) per dynamischem Import wie `src/main/sync-prototype/lab-ipc.ts`; Fehler → Host ohne Deps.
- Registriert `remote-lab:action` und leitet `onEvent` an `webContents.fromId(owner)?.send('remote-lab:event', event)`.
- `session.defaultSession.setDisplayMediaRequestHandler((request, callback) => …)`: Owner = `webContents.fromFrame(request.frame)?.id`; `consumeCaptureGrant(id)` null → `callback({})`; sonst `desktopCapturer.getSources({ types: ['screen'] })` → erste Quelle → `callback({ video: source })`, Fehler → `callback({})`.
- Identity-Datei: `join(app.getPath('userData'), 'remote-identity.json')`, Cipher `safeStorageCipher()`.

**`src/main/index.ts`** (nur Bootstrap):
- Vor `app.whenReady()`, nur wenn `!app.isPackaged && SHELLHERD_SYNC_LAB === '1'`: `app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns')` – bestehende `disable-features`-Werte mit Komma zusammenführen, nicht überschreiben.
- `remoteLabHost = await registerRemoteLabIpc(...)` neben `registerSyncLabIpc`.
- Preload-Argumente `--shellherd-remote-lab=${remoteLabHost?.enabled ? '1' : '0'}`, `--shellherd-remote-capture-fake=${remoteLabHost?.enabled && process.env.SHELLHERD_REMOTE_CAPTURE_FAKE === '1' ? '1' : '0'}`.
- `remoteLabHost?.reset('locked')` überall dort, wo `syncLabHost?.reset()` steht (closeAllSessions, onLock, Auto-Lock); `closeOwner` wie `syncLabHost`.
- `remoteLabHost.onSharingChange(sharing => …)`: R11.

### 5.5 Renderer

**`src/renderer/src/remote-lab.ts`** (rein): `errorKey(code: RemoteErrorCode): string` (Map mit vollen Literalen `remoteLab.errors.*`), `endKey(reason)`, `secondsLeft(expiresAt, now)`, `groupFingerprint` = Re-Export von `formatFingerprint`.

**`src/renderer/src/remote-peer.ts`** – `RemoteSessionController` (kein React):
```ts
export interface PeerFactory { create(config: RTCConfiguration): RTCPeerConnection }
export interface CaptureSource { capture(): Promise<MediaStream> }   // real: navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }); fake: canvas pattern
export class RemoteSessionController {
  constructor(api: Pick<DesktopApi, 'remoteLabAction' | 'onRemoteLabEvent'>, clientId: string, peers: PeerFactory, capture: CaptureSource, timers?: { setTimeout; clearTimeout });
  subscribe(listener: (view: { state: RemoteLabState; stream?: MediaStream; error?: RemoteErrorCode; ended?: RemoteEndReason }) => void): () => void;
  act(request: Omit<RemoteLabRequest, 'clientId'>): Promise<RemoteLabReply>;
  share(sessionId: string): Promise<void>;   // MUST be called synchronously from the consent click handler
  stop(): void;                               // local immediately (tracks, pc), then action 'stop'
  dispose(): void;
}
```
- `share`: `act(armCapture)` → `capture.capture()` (Fehler → `act(decline)`, `error: 'media'`) → `act(accept)` (Fehler → Tracks stoppen) → PC mit `iceServers: []`, Track hinzufügen, `createOffer` → `setLocalDescription` → warten bis `iceGatheringState === 'complete'` oder 2000 ms → `checkSdp(localDescription.sdp, 'offer')` → `splitSignal('offer', sdp)` → je Teil `act(signal)`.
- Viewer: bei vollständigem `offer` (Collector) → `checkSdp` → PC (`iceServers: []`) → `setRemoteDescription` → `createAnswer` → `setLocalDescription` → Gathering wie oben → `answer` senden; `ontrack` → `stream` im View.
- Agent: bei vollständigem `answer` → `checkSdp` → `setRemoteDescription`.
- `connectionState === 'failed'` → `error: 'peer'`, `stop()`. Ungültiges SDP/Collector-Fehler → `error: 'signal'`, `stop()`.
- Event `ended` → lokal alles schließen, `ended` im View.
- Fake-Capture (`src/renderer/src/remote-capture-fake.ts`, nur genutzt wenn `desktop.remoteCaptureFake`): 640×360-Canvas mit vier festen Farbfeldern (Werte nur in dieser Datei, Kommentar „test pattern, not UI“, `i18n-ignore`/Token-Ausnahme mit Grund), `captureStream(10)`, zeichnet per `setInterval` neu.

**`components/RemoteLabDialog.tsx`** (`<dialog>` + `useNativeSurfaceBlock`, Muster `SyncLabDialog`): Server-URL → Verbinden; Benutzername/Serverpasswort → Anmelden; eigener Fingerprint (gruppiert, Monospace) + Hinweis `identityTemporary` wenn nicht persistent; Gerätename → „Dieses Gerät online melden“/„Offline gehen“; Geräteliste mit vollem Fingerprint je Gerät, Checkbox `compared`, Knopf „Bildschirm ansehen“; Warten (Hinweis erst nach 400 ms); Viewer `<video autoPlay muted playsInline>` mit `srcObject`, Statuszeile mit Restzeit, „Verbindung beenden“. Fehler über `errorKey`.

**`components/RemoteConsentDialog.tsx`**: modal, `.confirm-dialog`; Titel, Body mit Name, voller Fingerprint, „Bekannt seit …“/„Noch nicht bekanntes Gerät“, Restzeit, Linux-Hinweis (wenn `platform === 'linux'`), Knöpfe „Bildschirm freigeben“ (ruft `controller.share(id)` direkt im Click-Handler) und „Ablehnen“ (Default-Fokus auf „Ablehnen“).

**`components/RemoteShareBar.tsx`**: Leiste oben im Hauptfenster, solange Agent-Session `connecting|active`: „Bildschirm wird angesehen von {{name}} · seit {{time}}“ + „Beenden“. Keine Bewegung. Rolle `status`, `aria-live="polite"`.

**`App.tsx`**: legt bei `desktop.remoteLabEnabled` genau einen `RemoteSessionController` an (clientId `crypto.randomUUID()`), rendert Consent (bei Agent-Session `consent`) und Leiste global, Dialog bei Einstieg. Fenstertitel-Zusatz während Freigabe über bestehenden Titelmechanismus (Text `remoteLab.bar.title`).

**`SettingsDialog.tsx`**: Knopf `remoteLab.entry` unter dem Sync-Lab-Knopf, nur wenn `remoteLabEnabled`.

**`remote-lab.css`**: Präfix `.remote-`, nur Tokens, keine Transitions/Animationen.

### 5.6 Texte (Namespace `remoteLab`, de-DE und en-US)

Keys und deutscher Wortlaut wie in der Recherche Abschnitt 2/Frage 5, plus:
- `remoteLab.signIn` „Anmelden“, `remoteLab.connect` „Verbinden“, `remoteLab.serverUrl` „Server-Adresse“, `remoteLab.username` „Benutzername“, `remoteLab.password` „Serverpasswort“, `remoteLab.close` „Schließen“
- `remoteLab.bar.title` „Bildschirm wird angesehen“
- `remoteLab.ended.stopped` „Verbindung beendet.“, `.remote` „Das andere Gerät hat die Verbindung beendet.“, `.expired` „Die Sitzung ist nach fünf Minuten abgelaufen. Stelle eine neue Anfrage.“, `.locked` „Die Verbindung wurde beendet, weil der Vault gesperrt wurde.“, `.declined` „Das andere Gerät hat die Anfrage abgelehnt.“, `.failed` „Die Verbindung ist fehlgeschlagen.“, `.scope` „Steuerung wird noch nicht unterstützt. Nur Ansehen ist möglich.“
- `remoteLab.errors.authentication` „Anmeldung fehlgeschlagen oder abgelaufen.“, `.connection` „Der Server ist nicht erreichbar.“, `.invalid` „Die Eingabe ist ungültig.“, `.stale` „Der Vorgang ist nicht mehr aktuell. Lade den Dialog neu.“
`remoteLab.consent.title` wie Recherche. en-US sinngemäß. Platzhalter `{{name}}`, `{{time}}`, `{{date}}`, `{{seconds}}`, `{{username}}`.

## 6. Nachweis

1. `npm run typecheck`, `npx vitest run` grün (inkl. `design-tokens.test.ts`, `i18n-catalog.test.ts`).
2. Neue Tests: `rendezvous.test.mjs` (Refresh), `remote-signal.test.ts` (Codec, SDP, Round-Trip über echten `createSyncServer` + zwei `RendezvousPeer`), `identity.test.ts`, `presence.test.ts`, `lab-host.test.ts` (inkl. R1, R3, R4, R5, R6), `remote-peer.test.ts` (Fake-PC, Reihenfolge, 2-s-Timeout, Fehler→stop), `remote-lab.test.ts`.
3. run-app: `rendezvous.mjs` Fake (127.0.0.1:8788, synthetisches Konto `demo` / Passwort aus dem Skript, nur synthetisch), Szene `remote-scene.mjs` mit zwei Instanzen (getrennte `SHELLHERD_RUN_DIR`, `DRIVER_PORT` 9333/9336): online, Fingerprint-Vergleich, Anfrage, Zustimmung, Pixelprüfung des Testmusters am Viewer, Screenshots `remote-consent.png`, `remote-bar.png`, `remote-viewer.png`, Beenden am Ziel → Viewer sieht Ende ≤ 5 s; Ablehnen-Pfad.
4. Manuell (nicht automatisiert): echtes Capture mit Wayland-Portal.
