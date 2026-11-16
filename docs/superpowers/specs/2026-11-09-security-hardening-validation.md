# Sicherheitshärtung H1: Validierung (bindend)

Prüfer: Opus, 2026-11-09. Geprüft wurden Spec `2026-11-09-security-hardening-design.md` und Plan `docs/superpowers/plans/2026-11-09-security-hardening.md` gegen den Code auf `claude/feature/security-hardening` (`0f55426`). Kontext: `2026-11-07-remote-agent-design.md` mit Validierung, `docs/plans/selfhosted-threat-model.md`, `CLAUDE.md` und die Skills `feature-pipeline` und `run-app`.

Ausgangslage: `npm run typecheck` ist grün. `npx vitest run` ist grün mit 215 Dateien, 3203 bestandenen und 36 übersprungenen Tests. Electron ist 44.4.2. `dialog.showMessageBox` kennt `signal?: AbortSignal` (`electron.d.ts:22579`), `Streams.video` akzeptiert `WebFrameMain`, und `PermissionRequest`/`PermissionCheckHandlerHandlerDetails` tragen `isMainFrame`.

**Urteil: ready after corrections.** Es gibt 13 Blocker, 24 Korrekturen und 12 Entscheidungen.

Dieser Anhang geht Spec und Plan vor. Was hier nicht steht, gilt aus der Spec weiter. Die Wellen- und Dateizuordnung in §6 ersetzt Spec §8 und den Plan vollständig.

---

## 1. Blocker (jeder mit Fix, bindend)

**B1: Die Wellenaufteilung macht Typecheck und Tests nach Welle 1 und Welle 2 rot.**
- Beleg:
  - T6 ändert `src/shared/remote-lab.ts` in Welle 1 (`request.verification` statt `compared: true`, `armCapture.verification`, neue Union-Mitglieder). Die Verbraucher `src/main/remote/lab-host.ts:51-52,391,545`, `lab-host.test.ts:107,113,224`, `RemoteLabDialog.tsx:66`, `remote-peer.ts:67` und die erschöpfenden Maps `src/renderer/src/remote-lab.ts:4-30` (`satisfies Record<RemoteErrorCode|RemoteEndReason, string>`) kompilieren erst nach Welle 2 bzw. 3 wieder.
  - T6 erweitert `SyncLabReply.code` um `'samePassword'`. Die Fehlermap in `SyncLabDialog.tsx:63-69` ist ein Objektliteral, das mit `[error]` indiziert wird, und bricht damit (T12, Welle 3).
  - T5 trägt die Registrierung in `src/main/index.ts` ein und braucht dafür `captureArmed` vom Host (T9, Welle 2).
  - T4 ändert `remember()` auf vier Pflichtparameter, Aufrufer ist `lab-host.ts:463` (T9).
  - T8 macht `VaultSyncResult.skipped` zur Pflicht, und der Literal-Fake `sync-prototype/lab-host.test.ts:8` (T10) bricht.
  - T1 und T7 besitzen beide `account-auth.mjs` (`generatePassword`). `/v1/info.rendezvousProof` liegt in `server.mjs` (T1), steht aber bei T2. `server/main.mjs` (Env `SHELLHERD_SERVER_TRUSTED_PROXY`) hat keinen Besitzer.
- Fix: neue Zuordnung in §6, nämlich:
  - Der `remote-lab.ts`-Vertrag geht an T9 (Welle 2).
  - Der Renderer-Teil T12 rückt in Welle 2 und arbeitet parallel gegen den Vertrag aus §2.1.
  - `sync-lab.ts`, `SyncLabDialog.tsx` und `syncLab.json` gehen an T10.
  - `index.ts` geht an T11.
  - `remember(…, verified = false)` bekommt einen Default-Parameter.
  - `skipped?: number` wird optional.
  - `generatePassword`, `main.mjs` und `/v1/info.rendezvousProof` gehen an T1.
  - Nach jeder Welle müssen beide Prüfungen grün sein. Innerhalb von Welle 2 darf der Typecheck rot sein, bis T9 `remote-lab.ts` geschrieben hat. T9 schreibt den Vertrag deshalb als ersten Schritt.

**B2: `verifyFingerprintPrefix` mit `timingSafeEqual` in `src/shared/remote-signal.ts` bricht den Renderer.**
- Beleg: Das Modul ist rein und wird vom sandboxed Renderer importiert (`remote-peer.ts:4`). Wer `node:crypto` importiert, scheitert im Renderer-Bundle.
- Fix: Der Vergleich ist reines JS mit konstanter Laufzeit (XOR-Akkumulator über die 12 Zeichencodes), ohne `Buffer` und ohne `node:crypto` (§2.3).

**B3: Fake-Capture umgeht den Display-Media-Handler, die Szene erreicht `granted` nie.**
- Beleg: Mit `SHELLHERD_REMOTE_CAPTURE_FAKE=1` liefert `remote-capture-fake.ts` direkt einen Canvas-Stream (`App.tsx:155`). `getDisplayMedia` wird nicht aufgerufen, also kommt weder die native Zustimmung noch ein Grant zustande. `#accept` verlangt künftig `state === 'granted'`, deshalb scheitert die Szene beim Annehmen.
- Fix:
  - Renderer: `fakeCapture().capture()` ruft zuerst `navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })` auf. Liefert der Aufruf einen Stream, stoppt es alle Tracks. Einen Fehler fängt es ab und gibt danach den Canvas-Stream zurück.
  - Main: Im Fake-Modus antwortet der Handler nach erteilter nativer Zustimmung mit `callback({})`, ohne `desktopCapturer`.
  - Wer zugestimmt hat, entscheidet weiterhin allein der Main, weil `#accept` `granted` verlangt. R12 bleibt so erfüllt: Fake-Capture durchläuft Permission-Handler, Display-Media-Handler und nativen Dialog.

**B4: Die Permission-Regeln blockieren `getDisplayMedia`, und `isMainFrame` steht am falschen Ort.**
- Beleg: Electron leitet Medienanfragen über `RequestMediaAccessPermission` als Permission `media`. `mediaTypes` enthält dabei nur `DEVICE_*`-Typen, bei Display-Capture ist die Liste also leer. Nach Spec 4.2b fällt `media` ohne Kamera/Mikro unter „alles andere → false“. `isMainFrame` gehört je Anfrage in `details` (`electron.d.ts:10892, 23395`), nicht in einen statischen `PermissionContext`.
- Fix: Vertrag und Regeln aus §2.6.

**B5: N1-Überspringen lässt fremde IDs in `acked` laufen. Ab dem zweiten Sync blockiert alles wieder hart.**
- Beleg:
  - `pull()` gibt die vollständige Serverliste zurück (`vault-sync.ts:72-75`), und `state.acked = [...acked, ...received]` (`:109`) übernimmt damit auch übersprungene IDs. Beim nächsten Lauf scheitert ein solches Objekt als `acked` hart an `history`.
  - `importSyncedVault` übergibt `listing` als `acked` an `pull` (`:161`). Jedes fremde Objekt endet so sofort in `history`.
- Fix: in §4 T8.

**B6: Die Client-Grenze 32 MiB passt nicht in den Sync-Checkpoint.**
- Beleg: Der Checkpoint speichert alle Versionen (`vault-sync.ts:98`). Die Klartextgrenze für `state` liegt bei 16 MiB (`vault-sync-crypto.ts:38,51`), die Dateigrenze bei 24 MiB (`vault-sync-state.ts:25-26,43`). Mit mehr als ungefähr 15 MiB Versionen scheitert `persist()` an `limit`.
- Fix: Die Grenzen werden angehoben (E7, §4 T8).

**B7: Die Notbremse feuert im Normalbetrieb oder gar nicht.**
- Beleg:
  - `#teardown` (bei `close`, `reset('locked')`, `closeOwner`) löscht `#binding` (`lab-host.ts:522`). Ein danach gesendetes `{ kind: 'stopped' }` endet an der Bindungsprüfung (`:108-112`) als `stale`. Damit lädt jede Vault-Sperre während einer Freigabe das Fenster neu.
  - `closeOwner` (Absturz, Navigation, Zerstören) würde einen toten oder gerade navigierenden Renderer neu laden.
  - Eine Sitzung, die nach erteilter Quelle in `granted` endet, ist nicht abgedeckt. Die Spec nennt nur `connecting|active`, der Renderer hält aber schon einen Track.
  - `webContents.reload()` lässt sich durch einen `beforeunload`-Handler des Renderers verhindern, gerade bei einem nicht kooperierenden Renderer.
- Fix: in §2.2 (Notbremse) und E3.

**B8: Die 30-s-Paarsperre nach jedem DELETE durch das Ziel bricht die Szene und normales Wiederverbinden.**
- Beleg: Am Ende des Annahme-Pfads der Szene schließt A die aktive Sitzung (`channel.close()` → `DELETE` durch das Ziel). Gleich danach stellt B die Ablehnungs-Anfrage (`remote-scene.mjs:174-175`) und bekäme 429. Außerdem legt `rendezvous.test.mjs:129` absichtlich vier Sitzungen je Paar an.
- Fix:
  - Die Sperre greift nur, wenn das Ziel eine Sitzung im Zustand `pending` löscht, also bei Ablehnung oder Stummschaltung.
  - Je Paar `(from,to)` darf höchstens eine Sitzung bestehen, `pending` oder `active`.
  - T2 passt den Test bei `:129` an: Die zweite Anfrage an dasselbe Ziel ergibt 429. Die Grenze von vier Sitzungen je Gerät wird mit verschiedenen Zielen geprüft.

**B9: Die IP-Budgets sind für zwei Geräte hinter einer Adresse zu knapp (run-app: beide auf 127.0.0.1; typischer Heim-NAT).**
- Beleg:
  - Pro Gerät laufen im Aufbau `GET …/messages` im Sekundentakt (60/min, `REMOTE_LAB_LIMITS.setupPollMs`), dazu Presence mit 24/min (`presence.ts:23`), dazu beim Viewer `GET /sessions/<id>` mit 60/min bis zur Annahme.
  - Für zwei Geräte zusammen sind das 120 bis 180/min, gegen 60/min für Polling und 120/min für alle Pfade. Die Begründung in Spec 4.4 („≤ 36/min pro Gerät“) stimmt nicht.
- Fix: Budgets und Schlüssel in §3.1 (E4).

**B10: Der Renderer zeigt den Fingerabdruck, den der Prüfende abtippen soll, direkt neben dem Eingabefeld.**
- Beleg: Die Geräteliste zeigt den vollen, vom Server gelieferten Fingerabdruck (`RemoteLabDialog.tsx:113`), und der Zustimmungsdialog den des Anfragenden (`RemoteConsentDialog.tsx:39`). Wer abtippt, kopiert ihn von dort statt vom anderen Gerät. Die Prüfung wird damit wieder zur Checkbox, und M2 bleibt offen.
- Fix (E6, R2 aus 2026-11-07 wird geändert):
  - Für **unverifizierte** Geräte zeigt der Renderer keinen Fingerabdruck der Gegenseite, weder in der Geräteliste noch im Zustimmungsdialog.
  - Sichtbar bleiben der eigene Fingerabdruck sowie der von **verifiziert bekannten** Geräten.
  - Den vollen Fingerabdruck des Anfragenden zeigt der native Dialog, und zwar erst nach der Eingabe.

**B11: Das Container-Image startet nicht mehr.**
- Beleg: `server.mjs` importiert künftig `./rate-limit.mjs`, aber `server/Dockerfile:8` kopiert die Datei nicht.
- Fix: T7 nimmt `scripts/sync-prototype/rate-limit.mjs` in die `COPY`-Zeile auf.

**B12: Für den Besitznachweis kennt `rendezvous.mjs` die Server-ID nicht.**
- Beleg: `createRendezvous({ authorize, isActive, clock })` (`server.mjs:28`) erhält kein `serverId`. HKDF-Salt und Proof-Nachricht brauchen es aber.
- Fix:
  - Der Vertrag lautet `createRendezvous({ authorize, isActive, clock, serverId })`.
  - T1 übergibt `serverId` in `server.mjs:28`, T2 nutzt es.

**B13: Die Vorgabe „run-app ohne CSP-Verstöße“ lässt sich wegen zod nicht erfüllen.**
- Beleg: zod 4.6.5 testet beim ersten Objekt-Parse `new Function("")` (`node_modules/zod/v4/core/util.js:218-226`). Unter `script-src 'self'` meldet Chromium das als `securitypolicyviolation`, obwohl die Ausnahme gefangen wird. Der Renderer nutzt zod über `src/shared/*-schema.ts`.
- Fix: T5 setzt in `src/renderer/src/main.tsx` vor `ReactDOM.createRoot` den Aufruf `z.config({ jitless: true });`, importiert aus `zod`. Der Probe läuft lazy, ein Aufruf auf Modulebene genügt also.

---

## 2. Vertrag (wörtlich übernehmen, ersetzt Spec §5 und 4.2a/4.2b/4.3)

### 2.1 `src/shared/remote-lab.ts` (T9, Welle 2)

```ts
export type RemoteScope = 'view';
/** Pin of a device in the local identity file; verified only after a typed prefix check. */
export interface RemoteKnown { firstSeen: number; verified: boolean; verifiedAt?: number }
/** id is the device fingerprint: SHA-256 of the SPKI DER, 64 lowercase hex. changed: a verified device with the same name has another fingerprint. */
export interface RemoteDevice { id: string; name: string; known?: RemoteKnown; changed?: true }
export type RemoteEndReason = 'stopped' | 'remote' | 'expired' | 'locked' | 'declined' | 'failed' | 'scope' | 'mismatch';
export type RemoteErrorCode = 'unavailable' | 'invalid' | 'stale' | 'identity' | 'locked' | 'connection' | 'authentication' | 'expired'
  | 'declined' | 'mismatch' | 'signal' | 'media' | 'peer' | 'scope' | 'limit' | 'samePassword';
/** Wire part inside the E2EE channel. 'bye' is host-internal and never crosses IPC. */
export interface RemoteSignalPart { kind: 'offer' | 'answer' | 'bye'; part: number; of: number; data: string }
export type RemoteLabCommand =
  | { kind: 'status' } | { kind: 'close' }
  | { kind: 'connect'; serverUrl: string }
  | { kind: 'signIn'; username: string; password: string }
  | { kind: 'goOnline'; deviceName: string } | { kind: 'goOffline' }
  | { kind: 'request'; target: string; verification: string | null }
  | { kind: 'armCapture'; sessionId: string; verification: string | null }
  | { kind: 'accept'; sessionId: string } | { kind: 'decline'; sessionId: string }
  | { kind: 'signal'; sessionId: string; part: RemoteSignalPart }
  | { kind: 'stop'; sessionId: string }
  /** Renderer ack: all tracks of this agent session are stopped and its RTCPeerConnection is closed. */
  | { kind: 'stopped'; sessionId: string };
export type RemoteLabRequest = RemoteLabCommand & { clientId: string };
export interface RemoteLabSession {
  id: string; role: 'viewer' | 'agent'; peer: RemoteDevice; scope: RemoteScope;
  state: 'requesting' | 'consent' | 'granted' | 'connecting' | 'active';
  /** Local epoch ms, never the server clock. */
  expiresAt: number; startedAt?: number;
  /** Agent only, while verification is required: remaining typed attempts. */
  attemptsLeft?: number;
}
export interface RemoteLabState {
  phase: 'idle' | 'serverReady' | 'signedIn' | 'online';
  server?: { serverUrl: string; serverId: string };
  account?: { username: string; validUntil: number };
  identity?: { fingerprint: string; persistent: boolean };
  devices?: RemoteDevice[];
  session?: RemoteLabSession;
  /** Incoming requests suppressed since going online (only when > 0). */
  muted?: number;
}
export type RemoteLabEvent = /* unchanged */
  | { kind: 'state'; state: RemoteLabState }
  | { kind: 'signal'; sessionId: string; part: RemoteSignalPart }
  | { kind: 'ended'; sessionId: string; reason: RemoteEndReason }
  | { kind: 'error'; code: RemoteErrorCode };
export type RemoteLabReply = { ok: true; state: RemoteLabState } | { ok: false; code: RemoteErrorCode };
export const REMOTE_LAB_LIMITS = {
  deviceName: 80, signalPart: 6144, signalParts: 4, sdp: 24576,
  requestMs: 60000, consentMs: 55000, sessionMs: 300000,
  setupPollMs: 1000, activePollMs: 5000, gatherMs: 2000, acceptDelayMs: 1000, byeMs: 2000,
  verificationHex: 12, verificationAttempts: 3, muteMs: 600000,
} as const;
```
- `captureGrantMs` entfällt, ebenso `consumeCaptureGrant`.
- Die zod-Schemas im Host lauten:
  - `request`: `{ kind, clientId, target: hex64, verification: z.string().max(64).nullable() }.strict()`
  - `armCapture`: `{ kind, clientId, sessionId, verification: z.string().max(64).nullable() }.strict()`
  - `stopped`: `{ kind, clientId: uuid, sessionId }.strict()`

### 2.2 `src/main/remote/lab-host.ts` (T9, Welle 2)

```ts
export interface RemoteServerInfo { serverUrl: string; serverId: string; namespace: string; authentication: 'password' | 'device'; rendezvous: boolean; rendezvousProof: boolean }
/** What the native consent dialog shows; fingerprint is the full 64-hex id of the requester. */
export interface CapturePrompt { name: string; fingerprint: string; verified: boolean }
export interface RemoteDeps {
  /* … all existing members unchanged … */
  /** Constant-time check against the unlocked vault; rejects (any error) when the vault is locked. */
  matchesVaultPassword(password: string): Promise<boolean>;
  /** Native consent in main; resolves false on decline, abort or missing parent window. Never throws. */
  confirmCapture(owner: number, prompt: CapturePrompt, signal: AbortSignal): Promise<boolean>;
  /** Renderer did not ack 'stopped' in time: kill its process and reload (see E3). */
  emergency(owner: number): void;
}
export class RemoteLabHost {
  /* existing: enabled, sharing, onEvent, onSharingChange, action, closeOwner, reset */
  /** For the permission handler: owner matches, agent session armed and in 'consent' or 'granted'. */
  captureArmed(webContentsId: number): boolean;
  /** Display-media gate: runs the native consent once per session; resolves the session id after consent → 'granted', else null. */
  requestCapture(webContentsId: number): Promise<string | null>;
}
```

Pflichtsemantik:
- **`#connect`:** Ist `info.authentication !== 'password' || !info.rendezvous || info.rendezvousProof !== true`, ist das Ergebnis `unavailable`.
- **`#signIn` (M3), in dieser Reihenfolge:**
  1. Phase prüfen.
  2. Gilt `!deps.isUnlocked()`, ist das Ergebnis `locked`.
  3. `same = await deps.matchesVaultPassword(password)`. Bei einer Ausnahme ist das Ergebnis `locked`.
  4. Hat sich `#gen` geändert, ist das Ergebnis `stale`.
  5. Ist `same` wahr, ist das Ergebnis `samePassword`.
  6. Erst danach `createAccount` und `login`. In den Fällen 2 bis 5 wird `createAccount` nie aufgerufen.
- **`Sess` neu:** `owner: number`, `verified: boolean`, `attempts: number`, `prompting: boolean`, `captured: boolean`, `abort: AbortController`.
  - `#end` ruft `s.abort.abort()` auf. Damit schließen Frist, Sperre, `reset`, `closeOwner`, das serverseitige Verschwinden einer Anfrage, `goOffline`, `stop` und `decline` den nativen Dialog.
- **`#request(target, verification)` (Viewer):**
  - Ist das Gerät unbekannt, ist das Ergebnis `stale`.
  - Ist `verification === null`, muss `store.known(target)?.verified === true` gelten, sonst `invalid`.
  - Ist `verification` gesetzt, aber `normalizeVerification(verification) === null`, ist das Ergebnis `invalid`. Das zählt nicht als Versuch.
  - Liegt `ctx.attempts.get(target)` bei 3 oder mehr, ist das Ergebnis `mismatch`, ohne Vergleich und ohne Netz. Der Zähler gilt bis zum nächsten `goOnline`.
  - Ist der Vergleich falsch, erhöht sich der Zähler, und das Ergebnis ist `mismatch` ohne Netzaufruf.
  - Ist er richtig, wird der Zähler gelöscht und `s.verified = true` gesetzt.
- **`#armCapture(owner, id, verification)` (Agent):**
  - Voraussetzungen sind die bisherigen: `consent`, nicht `armed`, entsperrt.
  - Ist `verification === null`, muss `s.peer.known?.verified === true` gelten, sonst `invalid`.
  - Ist die Eingabe ungültig, ist das Ergebnis `invalid` und zählt nicht als Versuch.
  - Ist der Vergleich falsch, erhöht sich `s.attempts`, `attemptsLeft` wird publiziert, und das Ergebnis ist `mismatch`. Beim dritten Fehlversuch folgt zusätzlich `#end(s, 'mismatch')` und eine Stummschaltung (siehe unten).
  - Ist er richtig, gelten `s.verified = true` und `s.armed = true`.
  - `armCapture` setzt **keinen** Grant.
- **`requestCapture(id)`:**
  - Voraussetzungen:
    - die Bindung gehört zu `id`;
    - es gibt eine Agent-Sitzung im Zustand `consent` mit `armed`;
    - `!prompting`, entsperrt, `now < deadline`.
  - Ist eine davon verletzt, ist das Ergebnis `null`.
  - Ablauf:
    1. `prompting = true`
    2. `ok = await deps.confirmCapture(s.owner, { name, fingerprint: s.peer.id, verified: s.verified || known?.verified }, s.abort.signal)`. Bei einer Ausnahme gilt `false`.
    3. Ist die Sitzung inzwischen beendet oder nicht mehr aktuell, ist das Ergebnis `null`.
    4. Ist `ok` falsch, folgen `#end(s, 'declined')` und `null`.
    5. Ist der Vault gesperrt oder die Frist überschritten, folgt `#end(s, locked ? 'locked' : 'expired')` und `null`.
    6. Sonst: `s.state = 'granted'`, `s.captured = true`, publizieren, Ergebnis ist `s.id`.
- **`captureArmed(id)`:** Liefert `true` genau dann, wenn die Bindung `id` gehört und die Sitzung eine Agent-Sitzung mit `armed` ist, nicht `ended`, im Zustand `consent` oder `granted`.
- **Zustand `granted`:**
  - `#accept` verlangt `s.state === 'granted'`, sonst `stale`. Die Prüfung über `armed` und `#grant` entfällt.
  - `#decline` akzeptiert `consent` und `granted`.
  - `#onSessions` beendet eine Agent-Sitzung in `consent` oder `granted` mit `remote`, sobald die Anfrage verschwindet (bisher nur `consent`, `:349`).
- **Stummschalten (N7):** `Online.muted: Map<string, number>` (Fingerabdruck → bis), höchstens 64 Einträge mit FIFO-Verdrängung.
  - Gesetzt wird der Eintrag nach `#decline`, nach dem dritten `mismatch` und nach `false` aus `confirmCapture`, jeweils für `muteMs`.
  - In `#onSessions` gilt für eine `pending`-Anfrage eines stummen `wire.from`: `#markProcessed`, `#delete(wire.id)` und `ctx.mutedCount++`, und zwar ohne Sitzung, ohne Dialog und ohne Ereignis.
  - `RemoteLabState.muted = ctx.mutedCount` erscheint nur bei einem Wert über 0.
- **Pinning:**
  - `#newSession` und `#state()` übernehmen `known` vollständig (`{ firstSeen, verified, verifiedAt? }`) und `changed: true`, wenn `store.renamed(id, name)` gilt.
  - `#loopTick` ruft beim Übergang nach `active` `store.remember(s.peer.id, s.peer.name, now, s.verified || known?.verified === true)` auf.
- **Notbremse (B7):**
  - `#pendingStops: Map<string, { owner: number; handle: unknown }>`.
  - In `#end(s, …)` startet für `s.role === 'agent' && s.captured` ein eigener Timer `deps.timers.setTimeout(…, L.byeMs)`, der nicht in `s.handles` liegt. Beim Ablauf wird der Eintrag gelöscht und `deps.emergency(s.owner)` aufgerufen.
  - `action()` behandelt `stopped` **vor** der Bindungsprüfung:
    1. Schema prüfen.
    2. Gilt `#pendingStops.get(id)?.owner !== owner`, ist das Ergebnis `stale`.
    3. Sonst `clearTimeout`, Eintrag löschen und antworten: `{ ok: true, state }` bei bestehender Bindung, ohne Bindung `{ ok: true, state: { phase: 'idle' } }`.
  - `closeOwner(owner)` beendet wie bisher und verwirft **danach** alle `#pendingStops` dieses Owners ohne `emergency`. `reset()` verwirft nichts, denn der Renderer lebt und soll quittieren.
- **Fehlercodes für den Renderer:** `mismatch` (falsche Eingabe), `invalid` (Format), `samePassword`.

### 2.3 `src/shared/remote-signal.ts` (T6, Welle 1; rein, kein `Buffer`, kein `node:crypto`)

```ts
/** Strips all whitespace, lower-cases; returns exactly 12 hex chars or null. */
export function normalizeVerification(input: string): string | null;
/** Constant-time (pure JS, XOR accumulator) comparison of the normalized input with fingerprint.slice(0, 12); false on any format error. */
export function verifyFingerprintPrefix(input: string, fingerprint: string): boolean;
export function checkSdp(sdp: string, kind: 'offer' | 'answer'): void;
```
- `fingerprint` muss `/^[a-f0-9]{64}$/` erfüllen, sonst ist das Ergebnis `false`.
- `normalizeVerification` verwirft alles mit weniger oder mehr als 12 Hex-Zeichen nach dem Entfernen von Leerraum.
- `checkSdp`, zusätzlich zur heutigen Prüfung:
  - Es gibt genau eine Zeile, die mit `a=fingerprint:` beginnt, egal welcher Algorithmus. Sie muss `FINGERPRINT_LINE` (sha-256) erfüllen.
  - Es gibt genau eine Zeile, die mit `a=setup:` beginnt.
  - Sonst `fail('fingerprint')`.

### 2.4 `src/main/remote/identity.ts` (T4, Welle 1)

```ts
known(fingerprint: string): { firstSeen: number; verified: boolean; verifiedAt?: number } | undefined;
/** verified=true marks the pin verified (verifiedAt=now on first verification); false never downgrades. */
remember(fingerprint: string, name: string, now: number, verified?: boolean): void; // default false
/** True when fingerprint itself is not verified and a verified entry with the same name has another fingerprint. */
renamed(fingerprint: string, name: string): boolean;
```
- Datei v2, wörtlich: `{ "version": 2, "identity": base64(cipher.encrypt(pkcs8 ‖ macKey)), "knownDevices": [...], "mac": hex64 }`.
  - `macKey` sind 32 Zufallsbytes.
  - `mac = HMAC-SHA256(macKey, JSON.stringify(['shellherd-remote-identity-v2', identity, knownDevices.map(d => [d.fingerprint, d.name, d.firstSeen, d.lastSeen, d.verified, d.verifiedAt ?? null])]))`.
  - Der Vergleich läuft mit `timingSafeEqual` über die Bytes.
- Lesen: Klartext → `macKey = plain.subarray(-32)`, `pkcs8 = plain.subarray(0, -32)`. Es muss `plain.length > 32` gelten. Ein falscher MAC löst `fail()` aus, die Datei bleibt unangetastet (R7).
- `knownSchema` + `verified: z.boolean()`, `verifiedAt: z.number().finite().optional()`.
- Migration v1 zu v2:
  - Der v1-Pfad akzeptiert den Klartext nur, wenn `derive(plain).privateKey.export({ format:'der', type:'pkcs8' }).equals(plain)` gilt. Damit lässt sich kein v2-Blob als v1 ausgeben.
  - Alle Einträge werden zu `verified:false`. Danach folgt genau ein atomarer v2-Schreibvorgang.
  - Scheitert der Schreibvorgang, bleibt der Zustand im RAM (`persistent: true`, neuer `macKey`). Das nächste `remember` schreibt v2, und v1 bleibt bis dahin unverändert.
- Neue Identitäten werden direkt als v2 angelegt.

### 2.5 `src/main/vault/session.ts` und `crypto.ts` (T3, Welle 1)

```ts
// crypto.ts: the existing private function, exported unchanged (NFKC inside)
export async function deriveKey(password: string, salt: Uint8Array, memoryKiB: number, iterations: number, parallelism: number): Promise<Buffer>;
// session.ts, VaultSessionManager
public async matchesPassword(password: string): Promise<boolean>;
```
- `matchesPassword` läuft so:
  1. `const session = this.requireSession()` (wirft `AppError('core.vaultLocked')`).
  2. Ist `password.length === 0`, ist das Ergebnis `false`.
  3. `candidate = await deriveKey(password, Buffer.from(session.kdf.salt, 'base64'), kdf.memoryKiB, kdf.iterations, kdf.parallelism)`.
  4. Gilt nach dem `await` `this.activeSession !== session`, wirft die Methode `AppError('core.vaultLocked')`.
  5. Der Vergleich ist `candidate.length === session.key.length && timingSafeEqual(candidate, session.key)`.
  6. Im `finally` folgt `candidate.fill(0)`.
- `session.key` wird nie verändert.

### 2.6 `src/main/permissions.ts` (T5, Welle 1)

```ts
export interface PermissionContext { remoteLabEnabled: boolean; captureArmed(webContentsId: number): boolean }
export interface PermissionDetails { isMainFrame?: boolean; mediaTypes?: readonly string[]; mediaType?: string }
export function decidePermission(permission: string, details: PermissionDetails, webContentsId: number | null, kind: 'request' | 'check', ctx: PermissionContext): boolean;
export function registerPermissionHandlers(target: Electron.Session, ctx: PermissionContext): void;
```
Regeln, in dieser Reihenfolge:
1. Ist `webContentsId === null`, ist das Ergebnis `false`.
2. Für `armed` gilt: `ctx.remoteLabEnabled && details.isMainFrame === true && ctx.captureArmed(webContentsId)`.
3. `'display-capture'` ergibt `armed`.
4. `'media'` mit `kind === 'request'`:
   - Enthält `mediaTypes` `'audio'` oder `'video'`, ist das Ergebnis `false` (Kamera und Mikrofon).
   - Sonst (leere oder fehlende Liste, also Display-Capture) ergibt es `armed`.
5. `'media'` mit `kind === 'check'`:
   - Bei `mediaType === 'audio'` ist das Ergebnis `false`.
   - Sonst ergibt es `armed`. Das betrifft nur Prüfungen, während eine Freigabe scharf ist; die Kamera bleibt über Regel 4 gesperrt.
6. Alle anderen Permissions ergeben `false`.

Registrierung:
- `setPermissionRequestHandler((wc, p, cb, d) => cb(decidePermission(p, d, wc.id, 'request', ctx)))`
- `setPermissionCheckHandler((wc, p, _o, d) => decidePermission(p, d, wc?.id ?? null, 'check', ctx))`
- `setDevicePermissionHandler(() => false)`
- `target.on('select-hid-device' | 'select-serial-port' | 'select-usb-device', (e, _d, cb) => { e.preventDefault(); cb(); })`
- `app.on('web-contents-created', (_e, wc) => wc.on('select-bluetooth-device', (e, _l, cb) => { e.preventDefault(); cb(''); }))`. Ohne `cb('')` wählt Electron das erste Gerät.

### 2.7 `src/main/remote/lab-ipc.ts` (T11, Welle 2)

```ts
export interface CaptureHost { captureArmed(webContentsId: number): boolean; requestCapture(webContentsId: number): Promise<string | null> }
export function createDisplayMediaHandler(host: CaptureHost, options: { fake: boolean }): (request: DisplayMediaRequestHandlerHandlerRequest, callback: (streams: Streams) => void) => void;
export function confirmCaptureDialog(owner: number, prompt: CapturePrompt, signal: AbortSignal): Promise<boolean>;
export async function registerRemoteLabIpc(options: { isUnlocked(): boolean; matchesVaultPassword(password: string): Promise<boolean> }): Promise<RemoteLabHost>;
```
- **Handler:**
  - Die Hauptframe- und Videoprüfung bleibt wie heute.
  - Danach `id = await host.requestCapture(contents.id)`. Bei `null` folgt `reply({})`.
  - Mit `fake` folgt `reply({})` ohne `desktopCapturer`.
  - Sonst `getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })`. Vor `reply({ video: sources[0] })` muss `host.captureArmed(contents.id)` noch gelten, sonst `reply({})`.
  - Alle Fehler enden in `reply({})`, `reply` fängt Ausnahmen ab.
- **`confirmCaptureDialog`:**
  - `parent = BrowserWindow.fromWebContents(webContents.fromId(owner))`. Fehlt es oder ist es zerstört, ist das Ergebnis `false` **ohne** Dialog (macOS ignoriert `signal` ohne Parent).
  - Ist `signal.aborted`, ist das Ergebnis `false`.
  - Danach `const { response } = await dialog.showMessageBox(parent, { type: 'warning', title: mainT('dialogs.remoteConsent.title'), message: mainT('dialogs.remoteConsent.message', { name }), detail: mainT('dialogs.remoteConsent.detail', { fingerprint: formatFingerprint(fingerprint) }), buttons: [mainT('dialogs.remoteConsent.decline'), mainT('dialogs.remoteConsent.confirm')], defaultId: 0, cancelId: 0, noLink: true, signal })`.
  - Das Ergebnis ist `response === 1 && !signal.aborted`. Jede Ausnahme ergibt `false`.
  - `dialog.showMessageBox` wird zur Aufrufzeit über die Eigenschaft gelesen. Kein Destrukturieren beim Laden, denn der run-app-Treiber ersetzt die Funktion zur Laufzeit.
- **Deps:**
  - `matchesVaultPassword: options.matchesVaultPassword`
  - `confirmCapture: confirmCaptureDialog`
  - `emergency: owner => { const wc = webContents.fromId(owner); if (wc && !wc.isDestroyed()) { wc.forcefullyCrashRenderer(); wc.reload(); } }`
- `fake = host.enabled && process.env.SHELLHERD_REMOTE_CAPTURE_FAKE === '1'`. Das ist dieselbe Bedingung wie `index.ts:138`; `remoteLabRequested()` schließt gepackte Builds bereits aus.

### 2.8 `src/shared/sync-lab.ts` und Sync-Host (T10, Welle 2), `vault-sync.ts` (T8, Welle 1)

```ts
// sync-lab.ts
export type SyncLabReply = { ok: true; state: SyncLabState; vaultChanged?: { filePath: string; vault: Vault } }
  | { ok: false; code: /* existing … */ | 'samePassword'; state?: SyncLabState };
// SyncLabState.sync gains: skipped?: number
// vault-sync.ts
export interface VaultSyncResult { /* existing */ skipped?: number }
// sync-prototype/lab-host.ts, constructor, 6th positional parameter
private readonly matchesVaultPassword?: (password: string) => Promise<boolean | undefined>
```
- In `signIn` folgt nach `current.busy = true` und vor `createAccount`:
  - `same = await this.matchesVaultPassword?.(password)`.
  - Ist `#connection` nicht mehr dieselbe, ist das Ergebnis `stale`.
  - Ist `same === true`, ist das Ergebnis `samePassword`.
  - `undefined` bedeutet gesperrt, dann entfällt die Prüfung.
- Verdrahtung in `sync-prototype/lab-ipc.ts`:
  ```ts
  async password => { try { return await sessions.matchesPassword(password); } catch (e) { if (e instanceof AppError && e.code === 'core.vaultLocked') return undefined; throw e; } }
  ```
  Eine andere Ausnahme lässt `signIn` mit `connection` enden.

### 2.9 Server (T1, T2, Welle 1; Node-only `.mjs`)

```js
// rate-limit.mjs (T1, new)
export const DEFAULT_LIMITS = Object.freeze({ global: 600, source: 240, info: 30, login: 5, loginFailuresGlobal: 30, rendezvousToken: 180, connectionsPerSource: 8, maxKeys: 4096 });
export function createLimiter({ clock = Date.now, maxKeys = 4096 } = {}) // token bucket per key, LRU eviction by last use
//   .take(key, { capacity, perMinute }) → { ok: true } | { ok: false, retryAfter }   // retryAfter: whole seconds ≥ 1
export function sourceOf(request, { trustedProxy = false } = {}) // → '4:1.2.3.4' | '6:2001:db8:1:2::/64'
// server.mjs (T1)
createSyncServer({ …existing, trustedProxy = false, limits = {} }) // limits: Partial<DEFAULT_LIMITS>, merged
// account-auth.mjs (T1)
accountAuth(account, clock = Date.now, limits = DEFAULT_LIMITS).login(body, source = 'local')
export function generatePassword() // 24 chars, alphabet 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789', rejection sampling on randomBytes
// main.mjs (T1)
startServer({ …existing, trustedProxy = false }) // main(): trustedProxy = process.env.SHELLHERD_SERVER_TRUSTED_PROXY === '1'
// rendezvous.mjs (T2)
createRendezvous({ authorize, isActive, clock, serverId })
export function registrationProof({ privateKey, peerKey, serverId, challenge, publicKey, name }) // → 64 hex
```
- **`registrationProof`:**
  1. `secret = diffieHellman({ privateKey, publicKey: createPublicKey(spki(peerKey)) })`
  2. `k = hkdfSync('sha256', secret, Buffer.from(serverId,'hex'), 'shellherd-rendezvous-pop-v1', 32)`
  3. HMAC-SHA256 über `JSON.stringify(['shellherd-rendezvous-pop-v1', serverId, challenge, publicKey, name])`, ausgegeben als hex.
  4. `secret` und `k` werden genullt.
  - Client und Server nutzen dieselbe Funktion: der Client mit Geräte-Private-Key und `serverKey`, der Server mit ephemerem Private-Key und Geräte-`publicKey`.
- **HTTP:**
  - `GET /v1/rendezvous/challenge` ist authentifiziert, ohne Query und ohne Body. Antwort: `200 { challenge: hex64, serverKey: spkiBase64(60), expiresAt }`.
  - `PUT /v1/rendezvous/devices` erwartet genau die Keys `challenge,name,proof,publicKey`, mit `proof` als `/^[a-f0-9]{64}$/`.
  - `/v1/info` erhält `rendezvousProof: Boolean(broker)` (T1, `server.mjs:82`), und `probeSyncServer` liefert `rendezvousProof: info.rendezvousProof === true` (T2).
  - Jede 429 aus den Limits trägt `retry-after: <s>`.

---

## 3. Korrekturen (bindend)

### 3.1 Server-Limits (T1)
- **K1 Budgets (ersetzt Spec 4.4):**
  - Global bleiben 600/min (`server.mjs:76-77` unverändert).
  - Je Quelle gelten 240/min über alle Pfade, zusätzlich 30/min für `/v1/info` und 5/min für `/v1/login`.
  - Authentifizierte `/v1/rendezvous/*` haben zusätzlich 180/min **je Token** (Schlüssel = `sha256(token)`; die Prüfung erfolgt in `server.mjs` vor `broker.handle`, nur wenn `login.authorize` gelingt).
  - Das eigene IP-Budget von 60/min für Polling entfällt (B9).
- **K2 Login-Backoff:**
  - Jeder 401 und jeder Body mit falschem Format zählt als Fehlschlag der Quelle. Ein Erfolg setzt den Zähler `f` zurück.
  - Ab dem dritten Fehlschlag in Folge ist die Quelle bis `lastFailure + min(60, 2^(f-3))` s gesperrt und erhält 429 mit `retry-after`.
  - Aufrufe ohne Fehlschlag erzeugen keinen Backoff. So bleibt `account.test.mjs:46-51` (zwei Fehlschläge, dann Erfolg) grün.
  - Der globale Fehlschlag-Deckel liegt bei 30/min (E5). Ist er erschöpft, erhalten nur Quellen mit `f > 0` 429. Saubere Quellen dürfen weiter anmelden, damit der Besitzer nicht ausgesperrt wird.
  - Der `active`-Mutex bleibt (`!active` → 429, `retry-after: 1`). Den alten Zähler „10 global“ gibt es nicht mehr.
- **K3 Quelle:**
  - Ohne Flag gilt `socket.remoteAddress`.
  - Mit `trustedProxy` gilt das letzte durch Komma getrennte, getrimmte Element von `x-forwarded-for` (Node verbindet Mehrfach-Header mit `, `), sofern `net.isIP` es akzeptiert. Sonst gilt die Socket-Adresse, und es erscheint einmal pro Prozess eine Log-Zeile ohne Header-Inhalt.
  - `::ffff:a.b.c.d` wird zu IPv4 entpackt. IPv6 wird auf das /64-Präfix normalisiert, sonst bekommt ein Angreifer 2^64 Quellen.
  - Der Verbindungszähler von 8 je Quelle (`server.on('connection')`, Abbau bei `'close'`) ist mit `trustedProxy` **aus**, weil alle Sockets vom Proxy kommen. `maxConnections` 32 bleibt.
- **K4:** Der Benutzername wird über die SHA-256-Digests mit `timingSafeEqual` verglichen. scrypt läuft weiterhin vor dem Vergleich, auch bei falschem Namen.
- **K5 Testbarkeit:** Die Option `limits` erlaubt Tests höhere Budgets. Bestehende Tests bleiben ohne Override grün. Falls nicht, nennt der Umsetzer jeden Override mit Grund im Bericht. Höchstens 5 Logins je Serverinstanz und Minute ohne Override.

### 3.2 Rendezvous (T2)
- **K6 Challenges:**
  - Sie sind an `owner` gebunden. Höchstens 4 je Owner und 128 insgesamt sind offen, sonst 429. Lebensdauer 30 s.
  - Jeder `PUT`, der eine Challenge nennt, verbraucht sie, auch bei falschem Nachweis.
  - Der Nachweis ist **immer** Pflicht, auch beim Erneuern des Leases (E10). Der Client holt bei jedem `register()` eine neue Challenge.
  - Scheitert `diffieHellman` (etwa am Punkt niedriger Ordnung), ist das Ergebnis 400.
  - Fremde Challenge, fremder Owner, Ablauf, zweite Verwendung oder falscher Nachweis ergeben jeweils 400.
- **K7:** Die Route-Regex in `rendezvous.mjs:167` wird um `challenge` erweitert, ohne ID und ohne Aktion. `exact(body, 'challenge,name,proof,publicKey')` ersetzt `'name,publicKey'`.
- **K8 N7:**
  - Je geordnetem Paar `(from,to)` besteht höchstens eine Sitzung, sonst 429.
  - Löscht `to` eine Sitzung in `pending`, ist das Paar 30 s gesperrt (429). Die Sperrliste umfasst höchstens 256 Einträge und läuft ab.
  - Ein DELETE von `from` oder einer aktiven Sitzung sperrt nicht (B8).
- **K9 I4:** Wörtlich nach Spec. `check(session.from === peer.identity.id ? fingerprint === session.to : fingerprint === session.from)`.

### 3.3 Main und Renderer
- **K10 (Spec 4.2a):** `captureCandidate`, `grantCapture` und `refuseCapture` werden durch `requestCapture` mit `deps.confirmCapture` ersetzt (E2). Die Zustandsmaschine liegt komplett im Host und ist testbar. Der Electron-Teil bleibt in `lab-ipc.ts`.
- **K11 Einmaligkeit:** Gesichert durch `prompting` und die Zustandsprüfung `consent`. Zwei parallele `getDisplayMedia` erzeugen höchstens einen nativen Dialog. Der zweite Aufruf erhält `{}`.
- **K12 Renderer-Quittung (`remote-peer.ts`):**
  - `share(sessionId, verification: string | null)` merkt sich die Sitzung in `shares: Map<string, { stream?: MediaStream; capturing: boolean; ended: boolean }>`.
  - Für jede Agent-Sitzung mit gestartetem `share()` sendet der Renderer **genau ein** `{ kind: 'stopped', sessionId }`, und zwar nachdem alle Tracks gestoppt und `pc.close()` gelaufen sind. Das gilt auch ohne Stream, etwa nach Ablehnung im nativen Dialog.
  - Kommt `ended`, während `capture()` noch läuft, quittiert `share()` nach dem Stoppen des verspätet gelieferten Streams.
  - Ohne `share()` wird nicht quittiert. Die Antwort `stale` wird ignoriert.
- **K13 Zustimmungsdialog:**
  - Feld: `<input className="remote-lab-verify" maxLength={23} autoComplete="off" spellCheck={false} inputMode="text">`, in Monospace über `var(--font-mono)`.
  - „Bildschirm freigeben“ ist erst aktiv, wenn `normalizeVerification(value) !== null` gilt und `REMOTE_LAB_LIMITS.acceptDelayMs` abgelaufen ist (statt der lokalen Konstante `ACCEPT_DELAY_MS`).
  - Bei verifiziert bekanntem Peer gibt es kein Feld. Angezeigt werden `verify.verified` und der Fingerabdruck.
  - Im Zustand `granted` bleiben beide Knöpfe deaktiviert, „Ablehnen“ bleibt aktiv.
  - Nach `mismatch` wird das Feld geleert.
- **K14 Geräteliste:**
  - Der Viewer sieht je Gerät `<li className="remote-lab-device">` mit `<strong>` Name. Bei unverifizierten Geräten folgt ein Feld `input.remote-lab-verify` und der Knopf `button.primary-button`, aktiv bei gültiger Eingabe. Bei verifizierten Geräten folgen `verify.verified`, der Fingerabdruck und der Knopf ohne Feld; gesendet wird dann `verification: null`.
  - Bei `changed` erscheint `verify.changed` als `.remote-lab-warning`.
  - Die Checkbox und der Key `remoteLab:compared` entfallen.
- **K15:** Der Notbremse-Test nutzt Fake-Timer in `lab-host.test.ts` mit den Fällen aus §5. `forcefullyCrashRenderer` + `reload` wird in `lab-ipc.test.ts` mit Mocks geprüft.
- **K16 CSP-Plugin (`electron.vite.config.ts`, nur `renderer.plugins`):**
  ```ts
  { name: 'shellherd-csp', configResolved(c) { mode = c.command === 'serve' ? 'development' : 'production'; }, transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: contentSecurityPolicy(mode) }, injectTo: 'head-prepend' }] }
  ```
  - Produktion: wörtlich wie in Spec 4.2c.
  - Entwicklung: `script-src 'self' 'unsafe-inline'` und `connect-src 'self' ws://localhost:* http://localhost:* ws://127.0.0.1:* http://127.0.0.1:*`, sonst identisch.
  - `src/renderer/csp.ts` hat keine Imports.
- **K17 M3 Sync:** wie in §2.8. Der Hinweis im Dialog `syncLab:passwordHint` bleibt.
- **K18 N1, Details in §4 T8:**
  - Ein Hash-Mismatch (`hashWire(wire) !== id`) bleibt hart (`history`), denn das ist Servermanipulation, kein fremdes Objekt.
  - Die Kapazitätsgrenze von `Graph` (`limit`) bleibt hart.
  - Übersprungen werden nur Objekte, die nicht in `acked` liegen.
- **K19 `importVault`:**
  - Die Kandidaten werden in Listenreihenfolge durchlaufen.
  - Für jeden Kandidaten zuerst `encryptedFile(wire)`; `validateKdf` greift darin.
  - Ein Schlüssel wird je **eindeutigem** KDF-Parametersatz einmal abgeleitet und im Speicher gehalten, höchstens für 8 verschiedene Sätze. Alle abgeleiteten Schlüssel außer dem verwendeten werden mit `fill(0)` überschrieben.
  - Das erste Objekt, das `Graph.tryAdd` akzeptiert, gilt als Anker. Gibt es keins, ist das Ergebnis `wrongVault`.
  - Danach folgt `pull(remote, graph, [], check)`. Die eigentliche Annahme ist das Ziel; `acked` wird nur aus `graph.values.keys()` gebildet (B5).
- **K20 Spec §7, letzter Punkt, ist falsch:** Ein kompromittierter Renderer kennt den Fingerabdruck (`RemoteDevice.id`) und kann das Feld selbst füllen. Die getippte Prüfung schützt gegen einen bösartigen **Server** bei ehrlichem Renderer. Gegen einen kompromittierten Renderer schützt der native Klick mit vollem Fingerabdruck. T13 dokumentiert es so.
- **K21 Caddyfile:**
  - Je Zeile genau eine Unterdirektive. `timeouts { read_header 5s  read_body 10s … }` auf einer Zeile ist ungültiges Caddyfile, ebenso `transport http { … }` und `request_body { … }`.
  - Die Fassung aus Spec 4.4 wird mehrzeilig geschrieben.
  - Die README nennt, dass `read_body 10s` eine Mindestrate von etwa 100 KB/s für 1 MiB voraussetzt.
- **K22 Dockerfile:**
  - Zur `COPY`-Zeile kommt `rate-limit.mjs` hinzu (B11).
  - Der Digest steht als `FROM node:22-bookworm-slim@sha256:<digest>`, darüber eine Kommentarzeile mit Tag und Datum.
  - Ohne Netz heißt die Zeile wörtlich `# TODO(H1): pin digest` über dem unveränderten `FROM`. Der Umsetzer meldet das im Bericht, und der Lead führt es als offenen Punkt.
- **K23:** `generatePassword` liegt in `account-auth.mjs` (T1). `account-init.mjs` (T7) importiert die Funktion.
  - Init-Ablauf:
    1. Benutzername.
    2. `Generiertes Passwort verwenden? [J/n] ` mit `J` als Standard.
    3. Bei J: einmalige Anzeige `Serverpasswort (einmalig, jetzt notieren): <pw>`, ohne Wiederholung.
    4. Bei n: verdeckte Eingabe mit mindestens 16 Zeichen und Wiederholung.
  - Der Hinweistext „NICHT das Vault-Passwort“ bleibt. `createAccount` behält 12 als Untergrenze.
- **K24 Locale-Pflicht (T11, T12, T10):** Neue Keys gibt es nur in §5. Keys, die nicht mehr genutzt werden, müssen im selben Task raus, sonst schlägt `i18n-catalog.test.ts` (d) an: `remoteLab:compared`, `remoteLab:consent.known` und `remoteLab:consent.unknown`. Zählkeys nutzen `_one`/`_other`.

---

## 4. Entscheidungen (Rulings)

- **E1:** Kein `SHELLHERD_REMOTE_CONSENT_AUTO`. Der run-app-Treiber ersetzt `dialog.showMessageBox` bereits und antwortet mit dem letzten Knopf (`driver.mjs:57-66`), also mit „Bildschirm freigeben“. Ein Test-Hook im Produktivcode entfällt damit. Kosten, falls falsch: Die Szene braucht später einen eigenen Hook.
- **E2:** Host-API `requestCapture` mit `deps.confirmCapture` statt drei Einzelmethoden. Begründung: ein Ort für die Zustandsmaschine, deterministisch testbar und ohne Lücke zwischen Kandidat und Grant.
- **E3:** Die Notbremse ruft `forcefullyCrashRenderer()` und dann `reload()` auf. `beforeunload` kann den Abbruch nicht verhindern, und Medien und PeerConnection enden mit dem Prozess. `render-process-gone` → `closeOwnerSessions` läuft über den bestehenden Pfad (`index.ts:149`).
- **E4:** Budgets für authentifiziertes Rendezvous gelten je Token, nicht je IP (B9). Quellenlimits bleiben für alles Unauthentifizierte.
- **E5:** Globaler Fehlschlag-Deckel von 30/min, saubere Quellen sind ausgenommen. Das begrenzt Brute-Force auf höchstens 43.200 Versuche pro Tag (heute 14.400), ohne den Besitzer auszusperren. Kosten: Ein verteilter Angreifer mit wechselnden, noch sauberen Quellen erhält je neuer Quelle 3 freie Versuche.
- **E6:** Fingerabdrücke unverifizierter Gegenseiten sind im Renderer unsichtbar (B10). R2 aus 2026-11-07 wird ersetzt: „Der Viewer fragt nur mit getippter Prüfung oder bei verifiziertem Pin an, der Fingerabdruck der Gegenseite steht nur auf deren eigenem Bildschirm, im nativen Dialog und bei verifizierten Pins.“
- **E7:** Die Grenzen des Sync-Checkpoints werden angehoben: Klartext für `state` auf 40 MiB (`vault-sync-crypto.ts:38,51`), Datei auf 56 MiB (`vault-sync-state.ts:25-26,43`). `version` bleibt bei 768 KiB.
- **E8:** `skipped` ist optional in `VaultSyncResult` und `SyncLabState.sync`. Der Code setzt den Wert immer, die UI zeigt ihn bei einem Wert über 0.
- **E9:** Der Präfixvergleich mit konstanter Laufzeit ist reines JS (B2). Die Spec-Vorgabe `timingSafeEqual` entfällt, der Effekt ist gleichwertig.
- **E10:** Der Besitznachweis ist bei jedem `PUT /devices` Pflicht, auch beim Erneuern. Das ist einfacher und hat keine Ausnahmeregel. Es kostet einen zusätzlichen Request pro 30 s je Gerät.
- **E11:** Fake-Capture läuft über `getDisplayMedia` und den echten Handler (B3). Der Main antwortet im Fake-Modus nach der Zustimmung mit `{}`.
- **E12:** Welle 2 umfasst T9, T10, T11 und T12 parallel, Welle 3 nur T13. Der Plan hatte T12 in Welle 3, das widerspricht der Pipeline-Regel „Typecheck grün nach jeder Welle“.

---

## 5. Texte (wörtlich, de-DE / en-US)

`main.json` (T11, unter `dialogs.remoteConsent`):

| Key | de-DE | en-US |
| --- | --- | --- |
| `title` | Bildschirm freigeben? | Share your screen? |
| `message` | {{name}} möchte den Bildschirm dieses Geräts ansehen. Nur Ansehen, höchstens fünf Minuten. | {{name}} wants to view the screen of this device. View only, five minutes at most. |
| `detail` | Fingerabdruck des anfragenden Geräts:\n{{fingerprint}}\n\nÜbertragen wird der gesamte Hauptbildschirm, bis du auf „Beenden“ klickst. | Fingerprint of the requesting device:\n{{fingerprint}}\n\nThe entire primary screen is shared until you click “End”. |
| `confirm` | Bildschirm freigeben | Share screen |
| `decline` | Ablehnen | Decline |

`remoteLab.json` (T12):

| Key | de-DE | en-US |
| --- | --- | --- |
| `verify.label` | Erste 12 Zeichen des Fingerabdrucks vom anderen Gerät | First 12 characters of the fingerprint from the other device |
| `verify.hint` | Lies sie auf dem anderen Gerät unter „Fingerabdruck dieses Geräts“ ab. | Read them on the other device under “Fingerprint of this device”. |
| `verify.verified` | Geprüft am {{date}} | Verified on {{date}} |
| `verify.changed` | Der Fingerabdruck von {{name}} hat sich geändert. Prüfe ihn erneut. | The fingerprint of {{name}} has changed. Verify it again. |
| `consent.body` (geändert) | {{name}} möchte den Bildschirm dieses Geräts ansehen. | {{name}} wants to view the screen of this device. |
| `consent.nativeHint` | Nach dem Klick fragt Shellherd in einem Systemdialog noch einmal nach. | After the click, Shellherd asks once more in a system dialog. |
| `ended.mismatch` | Die Prüfung ist dreimal fehlgeschlagen. Die Anfrage wurde abgelehnt. | Verification failed three times. The request was declined. |
| `errors.samePassword` | Das Serverpasswort darf nicht dein Vault-Passwort sein. Es wurde nichts an den Server gesendet. | The server password must not be your vault password. Nothing was sent to the server. |
| `muted_one` | {{count}} Anfrage stummgeschaltet | {{count}} request muted |
| `muted_other` | {{count}} Anfragen stummgeschaltet | {{count}} requests muted |

Entfernt werden `compared`, `consent.known` und `consent.unknown`. `consent.fingerprint` bleibt und wird nur noch bei verifizierten Pins angezeigt. In `src/renderer/src/remote-lab.ts` kommen `samePassword: 'remoteLab:errors.samePassword'` und `mismatch: 'remoteLab:ended.mismatch'` hinzu.

`syncLab.json` (T10):

| Key | de-DE | en-US |
| --- | --- | --- |
| `errors.samePassword` | Das Serverpasswort darf nicht dein Vault-Passwort sein. Es wurde nichts an den Server gesendet. | The server password must not be your vault password. Nothing was sent to the server. |
| `skipped_one` | {{count}} fremdes oder nicht lesbares Objekt wurde übersprungen. | {{count}} foreign or unreadable object was skipped. |
| `skipped_other` | {{count}} fremde oder nicht lesbare Objekte wurden übersprungen. | {{count}} foreign or unreadable objects were skipped. |

Keine dynamischen Keys. Fehlermaps bleiben volle Literale.

---

## 6. Wellen und Tasks (ersetzt Spec §8 und Plan)

Jeder Task arbeitet test-first, ändert nur eigene Dateien, committet nicht und liefert einen Bericht. Nach jeder Welle müssen `npm run typecheck` und `npx vitest run` grün sein.

### Welle 1 (parallel, dateidisjunkt)

| Task | Dateien | Pflichtpunkte | Pflichttests |
| --- | --- | --- | --- |
| **T1** Server-Limits | `scripts/sync-prototype/rate-limit.mjs` (neu), `rate-limit.test.mjs` (neu), `server.mjs`, `account-auth.mjs`, `server.test.mjs`, `account.test.mjs`, `server/main.mjs` | §2.9 (Limiter, `sourceOf`, Optionen, `generatePassword`, `trustedProxy` aus Env in `main()`); K1–K5; `/v1/info.rendezvousProof`; `createRendezvous({…, serverId})` (B12); `retry-after` auf jeder 429; der Fehlerpfad `send(status, body, retryAfter)` | Fake-Clock: 31. `/v1/info` derselben Quelle → 429 mit `retry-after`, andere Quelle → 200; 6. Login/min → 429; Backoff 1 s, 2 s, 4 s ab dem 3. Fehlschlag, Reset nach Erfolg; zwei Fehlschläge, dann Erfolg sofort → 200; globaler Fehlschlag-Deckel erschöpft → saubere Quelle 200, schmutzige 429; XFF nur mit Flag, letztes Element, ungültig → Socket; `::ffff:` entpackt, IPv6 → /64; LRU bei 4097 Schlüsseln; 9. Verbindung einer Quelle wird geschlossen, mit `trustedProxy` nicht; Rendezvous-Token-Budget 181 → 429; `generatePassword` (Länge 24, Alphabet, 100 Ziehungen verschieden); konstantzeitiger Namensvergleich (falscher Name → 401) |
| **T2** Proof, N7, I4 | `rendezvous.mjs`, `rendezvous-client.mjs`, `http-common.mjs`, `rendezvous.test.mjs` | §2.9 (`registrationProof`, Challenge-Route); K6–K9; `register()` holt die Challenge selbst | ohne Proof, falscher Proof, fremder Public Key mit eigener Anmeldung → 400; Challenge zweimal, abgelaufen (31 s), fremder Owner → 400; 5. offene Challenge eines Owners → 429; Punkt niedriger Ordnung (SPKI-Präfix + 32 Nullbytes) wird abgelehnt (400 von `deviceId` oder DH); Erneuern nur mit neuem Proof; zweite Sitzung je Paar → 429; Ziel löscht `pending` → 30 s 429, nach 30 s 201; Ziel löscht `active` → keine Sperre; Rollentausch im Kanal wirft; `probeSyncServer` liefert `rendezvousProof`; Test `:129` angepasst (B8) |
| **T3** Vault-Passwort | `src/main/vault/crypto.ts` (nur `export`), `src/main/vault/session.ts`, `src/main/vault/session.test.ts` | §2.5 | gleich → true, verschieden → false, leer → false, gesperrt → `core.vaultLocked`, Sperre während der Ableitung → `core.vaultLocked`; `session.key` danach bytegleich; NFKC-Variante → true |
| **T4** Identität v2 | `src/main/remote/identity.ts`, `identity.test.ts` | §2.4 | Round-Trip v2; manipuliertes `knownDevices` → `identity`, Datei unverändert (Bytes gleich); manipuliertes `mac` → `identity`; v1 → v2 mit `verified:false`, genau ein Schreibvorgang, Fingerabdruck gleich; v1 mit v2-Blob (pkcs8‖macKey) → `identity`; `remember(…, true)` setzt `verifiedAt` einmal, `false` stuft nicht herab; `renamed` true/false; RAM-only weiterhin ohne Datei; fehlgeschlagene Migration → im RAM v2, nächstes `remember` schreibt v2 |
| **T5** CSP + Permissions | `electron.vite.config.ts`, `src/renderer/csp.ts` (neu), `src/renderer/csp.test.ts` (neu), `src/main/permissions.ts` (neu), `src/main/permissions.test.ts` (neu), `src/renderer/src/main.tsx` | §2.6; K16; B13 (`z.config({ jitless: true })`); **nicht** `index.ts` | `csp.test.ts`: Produktion wörtlich, ohne `unsafe-inline`/`unsafe-eval` in `script-src`, ohne `*` außer in Dev-Hosts, mit `object-src 'none'` und `base-uri 'none'`; Entwicklung enthält `ws://localhost:*`. `permissions.test.ts` tabellengetrieben: jede Permission aus der Electron-Union außer `display-capture`/`media` → false; `display-capture` nur bei lab+mainFrame+armed; `media` request mit `['video']`/`['audio']` → false, mit `[]` → armed; check `mediaType:'audio'` → false; `webContentsId: null` → false; Registrierung mit Fake-Session ruft alle drei Setter auf, Bluetooth-Callback erhält `''` |
| **T6** Signal-Helfer | `src/shared/remote-signal.ts`, `src/shared/remote-signal.test.ts` | §2.3, rein; **keine** Änderung an `remote-lab.ts` | `normalizeVerification`: Leerraum, Großschreibung, 11/13 Zeichen, Nicht-Hex → null; `verifyFingerprintPrefix` true/false, ungültiger Fingerabdruck → false; `checkSdp`: zwei `a=fingerprint` (sha-256 + sha-1) → wirft; Session- und Media-Ebene doppelt → wirft; null oder zwei `a=setup:` → wirft; gültiges Chrome-SDP → ok |
| **T7** Betrieb | `server/Caddyfile.example`, `server/Dockerfile`, `server/compose.yaml`, `server/README.md`, `scripts/sync-prototype/account-init.mjs` | K21–K23; B11; README-Abschnitte „Limits pro Quelle“ (mit dem Satz aus Spec 4.4, fail2ban optional) und „Image aktualisieren“; `compose.yaml`: `# environment:\n#   SHELLHERD_SERVER_TRUSTED_PROXY: "1"` als Kommentar | `node --check` für `account-init.mjs`; `docker compose -f server/compose.yaml config` sofern Docker vorhanden (sonst im Bericht vermerken) |
| **T8** Sync-Toleranz | `src/main/sync-prototype/vault-sync.ts`, `vault-sync.test.ts`, `vault-sync-crypto.ts` (nur Grenzen), `vault-sync-state.ts` (nur Grenzen), `vault-sync-state.test.ts` | B5, B6, E7, E8, K18, K19; `Graph` 100 Versionen / 32 MiB; `ids` `.max(100)`; `stateSchema.versions.max(100)`; `Graph.tryAdd(wire): string \| null` (`null` = nicht lesbar oder fremd; Kapazität wirft `limit`); `pull()` gibt `{ received: string[]; skipped: number }` zurück, mit `received` = nur IDs, die im Graph liegen | fremdes Objekt (anderes Passwort) im Konto → `synced`, `skipped: 1`, **zweiter** Sync ebenfalls `synced` (B5); manipuliertes `acked`-Objekt → `history`; Hash-Mismatch eines neuen Objekts → `history`; Import mit fremdem Objekt an Position 0 → Erfolg; Import nur mit fremden Objekten → `wrongVault`; 100 Versionen akzeptiert, 101 → `limit`; Checkpoint mit ~20 MiB Versionen wird geschrieben und gelesen |

### Welle 2 (nach Welle 1, parallel, dateidisjunkt)

T9 schreibt zuerst `src/shared/remote-lab.ts` wörtlich nach §2.1. T11 und T12 arbeiten gegen §2.1, §2.2 und §2.7.

| Task | Dateien | Pflichtpunkte | Pflichttests |
| --- | --- | --- | --- |
| **T9** RemoteLabHost | `src/shared/remote-lab.ts`, `src/main/remote/lab-host.ts`, `lab-host.test.ts` | §2.1, §2.2 vollständig | signIn: gesperrt → `locked`; gleiches Passwort → `samePassword`, `createAccount` und `login` nicht aufgerufen; `matchesVaultPassword` wirft → `locked`. connect ohne `rendezvousProof` → `unavailable`. Viewer: null ohne Pin → `invalid`, falsch → `mismatch` ohne `peer.request`, 4. Versuch → `mismatch` ohne Vergleich, richtig → Anfrage, verifizierter Pin + null → Anfrage. Agent: dreimal falsch → `ended/mismatch` + Stummschaltung, Folgeanfrage desselben Geräts → DELETE ohne Sitzung, `muted: 1`. `requestCapture`: ohne `armed` null, falscher Owner null, zweiter paralleler Aufruf null (ein `confirmCapture`), `false` → `declined` + Stummschaltung, Abbruch durch Frist → Signal abgebrochen, null; Erfolg → `granted`; `accept` vor `granted` → `stale`. `captureArmed` in consent/granted, nicht nach Ende. Notbremse: captured + Ende ohne `stopped` → nach 2000 ms genau ein `emergency(OWNER)`; mit `stopped` → keins; nach `reset('locked')` + `stopped` ohne Bindung → ok, keins; `closeOwner` → keins; nicht captured → keins; `stopped` vom fremden Owner → `stale`, `emergency` folgt. `remember(…, verified)` beim Übergang nach `active`. `changed` im Zustand. Bestehende Tests an den neuen Vertrag angepasst, keiner gestrichen ohne Ersatz |
| **T10** Sync-Lab | `src/shared/sync-lab.ts`, `src/main/sync-prototype/lab-host.ts`, `lab-host.test.ts`, `src/main/sync-prototype/lab-ipc.ts`, `lab-ipc.test.ts`, `src/renderer/src/components/SyncLabDialog.tsx`, `src/shared/locales/{de-DE,en-US}/syncLab.json` | §2.8; §5 (syncLab); `skipped` wird durchgereicht und bei einem Wert über 0 als Zeile im Ergebnis gezeigt | gleiches Passwort → `samePassword`, `login` nicht aufgerufen; gesperrt (`undefined`) → Anmeldung läuft; Verbindungswechsel während der Prüfung → `stale`; `skipped` erscheint im Zustand; `lab-ipc`: `core.vaultLocked` → `undefined` |
| **T11** Lab-IPC + nativer Dialog | `src/main/remote/lab-ipc.ts`, `lab-ipc.test.ts`, `src/main/index.ts`, `src/shared/locales/{de-DE,en-US}/main.json` | §2.7; §5 (main); `index.ts`: `registerRemoteLabIpc({ isUnlocked, matchesVaultPassword: p => vaultSessionManager.matchesPassword(p) })` und direkt danach `registerPermissionHandlers(session.defaultSession, { remoteLabEnabled: remoteLabHost.enabled, captureArmed: id => remoteLabHost?.captureArmed(id) ?? false })` (vor jedem Fenster) | Handler: Subframe, kein Frame, kein Video → `{}` ohne `requestCapture`; `null` → `{}` ohne `getSources`; Erfolg → `{ video: sources[0] }`; `captureArmed` false nach `getSources` → `{}`; `fake` → `{}` ohne `getSources`; werfendes Callback bricht nichts. `confirmCaptureDialog`: Optionen exakt (`type`, Knopfreihenfolge, `defaultId: 0`, `cancelId: 0`, `noLink`, `signal`, Parent); `response 1` → true, `0` → false; kein Parent → false ohne Dialog; abgebrochenes Signal → false; `showMessageBox` wird zur Aufrufzeit gelesen (Mock nach Import ersetzt). `emergency` ruft `forcefullyCrashRenderer` vor `reload`, zerstörte Contents → nichts. Flag-Tests unverändert |
| **T12** Renderer Fernzugriff | `src/renderer/src/remote-peer.ts`, `remote-peer.test.ts`, `remote-capture-fake.ts`, `src/renderer/src/remote-lab.ts`, `remote-lab.test.ts`, `components/RemoteConsentDialog.tsx`, `components/RemoteLabDialog.tsx`, `remote-lab.css`, `src/shared/locales/{de-DE,en-US}/remoteLab.json` | B3 (Fake), B10/E6, K12–K14, K24; §5 (remoteLab); CSS nur Tokens; Stummschalt-Zeile `t('remoteLab:muted', { count })` als `.remote-lab-caption`, wenn `state.muted` gesetzt ist | `share(id, v)` sendet `armCapture` mit `verification` und hat genau ein `await` vor `capture()`; Ende → nach `track.stop()` und `pc.close()` genau ein `stopped`; `ended` während `capture()` → Stream gestoppt, dann `stopped`; Ablehnung ohne Stream → `stopped`; ohne `share()` → kein `stopped`; `mismatch`-Antwort → kein `capture()`; Maps vollständig (`satisfies` bleibt) |

### Welle 3

| Task | Dateien | Pflichtpunkte |
| --- | --- | --- |
| **T13** Doku + Szene | `docs/handbuch.md` §„Fernzugriff (Entwicklung)“, `docs/plans/selfhosted-e2ee.md`, `docs/plans/docker-rendezvous.md`, `docs/plans/selfhosted-threat-model.md`, `.claude/skills/run-app/remote-scene.mjs`, `.claude/skills/run-app/driver.mjs`, `.claude/skills/run-app/SKILL.md` | Siehe unten |

Pflichtpunkte für T13:
- **Szene, erster Lauf:**
  - B liest den eigenen Fingerabdruck von A aus dessen DOM (`.remote-lab-account > code.remote-lab-fingerprint`, Leerraum entfernt, die ersten 12 Zeichen). B tippt ihn in `li.remote-lab-device` mit `strong` = `Gerät A` → `input.remote-lab-verify` und klickt `button.primary-button`.
  - A tippt die ersten 12 Zeichen von B in `dialog.remote-consent-dialog input.remote-lab-verify`.
  - Vor dem Klick ersetzt die Szene per `/main` `electron.dialog.showMessageBox` durch eine Aufzeichnung. Sie legt `globalThis.__shellherdDialogs.push(options)` an und antwortet mit dem letzten Knopf.
  - Danach prüft sie, dass `detail` den gruppierten Fingerabdruck von B enthält und dass `buttons` `['Ablehnen','Bildschirm freigeben']` lautet.
  - Die Prüfung `dialogText.includes(fingerprintB)` im Renderer-Dialog entfällt. Stattdessen gilt: Der Renderer-Dialog enthält den Fingerabdruck von B **nicht** (E6).
- **Szene, zweiter Lauf (Ablehnung):**
  - Beide Pins sind jetzt verifiziert. B sieht bei A `Geprüft am` und kein Feld, A sieht im Zustimmungsdialog kein Feld.
  - Die Szene prüft beides und lehnt dann wie bisher ab.
- **Treiber:** neue Route `console`. Sie gibt alle seit dem Start gesammelten Konsolenmeldungen vom Typ `error`/`warning` als JSON zurück (`page.on('console')`, auch für Fenster, die über `use` gewählt werden).
- **SKILL.md:** Es dokumentiert:
  - die Route und die Pflichtprüfung „keine Meldung mit `Content Security Policy`“ nach `screens.mjs` (Screens `terminal`, `sftp`, `settings`) und nach `remote-scene.mjs`;
  - den Ablauf mit 12 Zeichen;
  - die 30-s-Paarsperre bei sofortiger Wiederholung der Szene;
  - dass es keinen Consent-Hook gibt (E1).
- **Handbuch:**
  - Ablauf mit 12 Zeichen, nativer Dialog, „Geprüft am“, Stummschaltung 10 min.
  - Fehlertext für gleiches Passwort.
  - Notbremse (Fenster lädt neu, wenn die Freigabe nicht sauber endet).
  - Grenzen des 48-Bit-Präfixes und K20.
- **Pläne und Threat-Model:**
  - Proof, Limits, `SHELLHERD_SERVER_TRUSTED_PROXY`.
  - Die Aussage „gegen verteilte Floods nur WireGuard/Tailscale (H2)“.
  - Status von M1–M4, N1, N2, N4–N7, I4, I5.

### Abschluss (Lead)

- `npm run typecheck` und `npx vitest run`.
- `node server/smoke.mjs`.
- `npx electron-vite build`, danach run-app-Screens und `remote-scene.mjs`, jeweils mit Prüfung der Route `/console` auf CSP-Meldungen.
- `node scripts/check-server-container.mjs`, wenn Docker verfügbar ist.
- Kein CHANGELOG und keine Version (Plan).

---

## 7. Restrisiken (zur Kenntnis, keine Aufgabe)

- **Electron leitet die Display-Capture-Permission versionsabhängig.** Die Regeln in §2.6 decken `display-capture` und `media` mit leerer Liste ab. Erreicht die Szene den nativen Dialog nicht (Aufzeichnung leer, Fehler `media`), gilt die Permission-Regel als fehlerhaft. Die Fix-Welle darf dann ausschließlich in `permissions.ts` `media`-Checks mit `mediaType: 'video'` an `armed` binden. Andere Lockerungen sind nicht erlaubt.
- **Das 48-Bit-Präfix ist gegen einen Betreiber mit großer Rechenleistung schwach.** Der Server kennt die Fingerabdrücke aller Geräte und kann je Gerät vorab rechnen. Dokumentiert in K20 und im Handbuch, H2 löst das.
- **Rollback der Identitätsdatei.** Eine ältere gültige v2-Datei bringt alte Pins zurück. Eine v1-Datei stuft alle Pins auf unverifiziert zurück. Fälschen lässt sich keins von beidem.
- **Fremde Objekte füllen weiter das Serverkontingent (100/32 MiB).** Erst die Kompaktierung in H2 behebt das.
