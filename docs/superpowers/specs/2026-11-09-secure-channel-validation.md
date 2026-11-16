# Sicherheitshärtung H2: Validierung (bindend)

Prüfer: Opus, 2026-11-09. Geprüft wurden Spec `2026-11-09-secure-channel-design.md` und Plan `docs/superpowers/plans/2026-11-09-secure-channel.md` gegen den Code auf `claude/feature/secure-channel` (`21ea3c0`, gestapelt auf H1/PR #44) und gegen die echte Bibliothek `node_modules/noise-handshake` 4.2.0 (`noise.js`, `cipher.js`, `symmetric-state.js`, `dh.js`) mit `sodium-universal` 5.0.1 / `sodium-native` 5.2.0. Kontext: H1-Spec und H1-Validierung (gelten weiter), `docs/plans/selfhosted-{threat-model,protocol,e2ee}.md`, `CLAUDE.md`, Skills `feature-pipeline` und `run-app`.

Ausgangslage: `npm run typecheck` grün. `npx vitest run`: 219 Dateien; ein Lauf mit einem Fehlschlag in `rendezvous.test.mjs › bounds pending requests, payloads, sequence order…` (nur unter Volllast, Einzellauf 3× grün, Wiederholung des Volllaufs grün). Das ist eine vorbestehende Zeit-Flake (siehe K21).

Selbst ausgeführt (Skript im Scratchpad, nicht im Repo):
- XX-Handshake mit statischen Schlüsseln aus Node-`KeyObject` in Node 22.22.1 **und** in Electron 44.4.2 (`ELECTRON_RUN_AS_NODE=1`, Node 24.21.0, ABI 149, N-API 10): läuft ohne Rebuild. Größen 32/96/64 Byte, `hash` 64 Byte, `{"kind":"accepted","scope":"view"}` verschlüsselt 50 Byte.
- PKCS8-DER eines X25519-Schlüssels ist 48 Byte mit festem Präfix `302e020100300506032b656e04220420`; die letzten 32 Byte sind gleich JWK-`d`; `crypto_scalarmult_base(d)` ist gleich JWK-`x` und gleich dem SPKI-Ende. `noise.rs` ist bytegleich mit dem rohen öffentlichen Schlüssel der Gegenseite.
- `Cipher.decrypt` erhöht den Zähler nur bei Erfolg; ein übersprungener Frame scheitert mit `could not verify data`, danach geht die richtige Reihenfolge weiter.
- Nachricht 1 trägt Payload **im Klartext** (`send(Buffer.from('hi'))` → Empfänger liest `hi`); `recv` akzeptiert zusätzliche Bytes als Payload.
- Falscher Prologue scheitert beim Initiator an Nachricht 2; manipulierte Nachricht 3 scheitert beim Responder; Low-Order-`e` (32 Nullbytes) wirft (`status: -1`).
- `final()` → `_clear()` **überschreibt `re` mit Nullen, und `re` ist ein `subarray` des empfangenen Frame-Puffers.** `s.secretKey` löscht die Bibliothek nie. `recv` nach `complete` wirft einen `TypeError`. `_clear()` wirft, wenn `e` noch `null` ist.
- Die Bibliothek wird im Electron-Main nicht gebündelt: `rendezvous-client.mjs` lädt nur per `import(/* @vite-ignore */ pathToFileURL(join(__dirname,'..','..','scripts','sync-prototype',…)))` (`src/main/remote/lab-ipc.ts:18,90`). Die Auflösung von `noise-handshake` läuft zur Laufzeit von `scripts/sync-prototype/` nach `<repo>/node_modules`. Auch die run-app-Szene lädt `out/main/index.js` aus dem Repo (`driver.mjs:47`). `externalizeDepsPlugin` ist dafür nicht relevant, `noise-handshake` als `devDependency` ist zulässig, weil der Lab nie gepackt wird (`remoteLabRequested`).

**Urteil: ready after corrections.** Es gibt 7 Blocker, 22 Korrekturen und 11 Entscheidungen.

Dieser Anhang geht Spec und Plan vor. Was hier nicht steht, gilt aus der Spec weiter. Die Wellen- und Dateizuordnung in §6 ersetzt Spec §8 und den Plan vollständig.

---

## 1. Blocker (jeder mit Fix, bindend)

**B1: T5 bricht `getDisplayMedia`.**
- Beleg: H1-Validierung B4 (`…-security-hardening-validation.md:44-46`) und der Kommentar in `permissions.ts:17`: Electron leitet **jede** Medienanfrage über `RequestMediaAccessPermission` als Permission `media`; `mediaTypes` enthält nur `DEVICE_*`-Typen. `getDisplayMedia` kommt deshalb als `media`-Request mit leerer Liste an, genau wie Legacy-`getUserMedia({chromeMediaSource:'desktop'})`. Die Details (`electron.d.ts:9479-9490`) unterscheiden beide nicht. Spec §4.8 („`media` + `request` → immer false“) sperrt damit die Bildschirmfreigabe. Der Rückfall aus H1 §7 erlaubt nur, **Checks** zu lockern, und hilft hier nicht.
- Fix (E1): Die Request-Regel bleibt wie H1 (`media` ohne `audio`/`video` in `mediaTypes` → Grant-Prüfung). T5 verschärft nur den **Check**: `media` + `check` nur bei `mediaType === 'video'`. Gate ist die Szene. Scheitert sie, setzt die Fix-Welle die Check-Regel auf H1 zurück, nichts weiter. Der Legacy-Desktop-Pfad nach erteilter Zustimmung bleibt ein benanntes Restrisiko (§7). T12 dokumentiert es so.

**B2: Dateizuordnung lässt Welle 1 rot oder ohne Besitzer.**
- Beleg:
  - `scripts/sync-prototype/remote-signal.test.mjs:29-30`, `scripts/check-server-container.mjs:52-54` und `server/smoke.mjs:24-26` rufen `channel(session, peerPublicKey, …)` auf. Die ersten beiden haben in Spec §8 keinen Besitzer, `remote-signal.test.mjs` läuft in `vitest` (`vitest.config.ts:5`) und wird rot.
  - `rendezvous.test.mjs` (T2) testet fast nur den Client (`pair()` `:31-38`, Kanaltests `:55-176,310-316`). T2 kann ihn ohne T1-Code weder schreiben noch ausführen. Der Frame-Prüfcode in `rendezvous.mjs:132-138` gehört fachlich zum Client-Vertrag.
  - `src/shared/sync-server-url.d.mts` (Typvertrag, `normalizeSyncServerUrl(input: unknown, allowLoopbackHttp?: boolean)`) fehlt bei T3. Ohne ihn kompilieren T8/T9/T10 mit Optionsobjekt nicht.
  - `lab-host.test.ts` nutzt 12-Zeichen-Eingaben nicht nur in `:14`, sondern auch in `:421,423,425,923,931` (`'c'.repeat(12)`). Mit 16 liefern sie `invalid` statt `mismatch`; T7 darf laut Spec nur `:14` ändern.
  - `docs/manual.md` (englisches Handbuch, `:746ff`, `:785` „12 hex characters“) fehlt bei T12.
- Fix: neue Zuordnung in §6. T1 besitzt das ganze Rendezvous-Protokoll (Client, Frame-Prüfung in `rendezvous.mjs`, `rendezvous.test.mjs`, `remote-signal.test.mjs`, `smoke.mjs`, Kanalteil von `check-server-container.mjs`). T2 besitzt den Server ohne Rendezvous-Frames (`/v1/info`, DELETE, `listen`) mit eigenen Tests in `server.test.mjs` und `account.test.mjs`. T3 bekommt `sync-server-url.d.mts`. T7 ändert in `lab-host.test.ts` alle Prüf-Literale (`:14,421,423,425,923,931`), sonst nichts. T12 bekommt `docs/manual.md`.

**B3: `VaultRemote.remove` als Pflichtfeld macht den Typecheck nach Welle 1 rot.**
- Beleg: `src/main/sync-prototype/lab-ipc.ts:36` baut `transport = { list, get, put }` und übergibt es an `synchronizeVault`. Mit einem Pflicht-`remove` in `VaultRemote` (T4, Welle 1) kompiliert die Datei (T9, Welle 2) nicht.
- Fix (E4): `remove?(id: string): Promise<boolean>` ist optional. Ohne `remove` läuft keine Kompaktierung und `removeForeignObjects` wirft `SyncFailure('limit')`. T9 verdrahtet `remove` verbindlich (Pflichtpunkt und Review).

**B4: Die Kompaktierung meldet nach zwei Zyklen fälschlich `history` und kann das Konto dauerhaft sperren.**
- Beleg:
  - `Graph.compacted = ⋃ compacts` (Spec §2.3) gilt nur über **vorhandene** Versionen. Kompaktiert `C2` später die Trägerversion `C1`, verschwindet deren Liste. Ein Gerät, das zuletzt vor `C1` abgeglichen hat, hält in `acked` IDs, die nur `C1` nannte: Sie fehlen im Listing und stehen nicht in `compacted`, also `history` (`vault-sync.ts:80`). Das ist ein Fehlalarm „Server-Rollback“ für jedes Gerät, das länger als etwa 32 Abgleiche fehlt.
  - Ein solches Gerät mit lokaler Änderung lädt seinen Zweig hoch (`:123-128` vor der Kopfauswertung) und landet in `base() === undefined` → `conflict` mit `canKeepLocal: false` (`:134-135`). Es gibt keinen Pfad, der zwei Köpfe ohne Basis zusammenführt; jedes Gerät sieht danach dauerhaft zwei Köpfe, und mit zwei Köpfen läuft auch keine Kompaktierung mehr. Nach etwa 100 Versionen kommt 507. Spec §7 („expliziter Konflikt … keine Daten gehen verloren“) beschreibt so einen Endzustand ohne Ausweg.
  - `prune()` direkt in `pull()` (Spec §2.3) entfernt genau die lokale Basisversion, die ein Merge noch bräuchte.
  - Ein Server kann kompaktierte Objekte, die er aufbewahrt hat, wieder ausliefern. Ohne Regel werden sie zu Köpfen.
- Fix: Algorithmus in §2.6 (kumulative `compacts`, Basis über kompaktierte Vorfahren, `heads()` ohne kompaktierte IDs, Zombies verwerfen, `prune` erst am Ende eines `synced`, Reparatur-Löschung je Lauf).

**B5: Der Kanalvertrag legt Nonce, Reihenfolge und Wiederholung nicht fest, und `mismatch` ist nicht unterscheidbar.**
- Beleg:
  - `Cipher.encrypt` erhöht den Zähler bei jedem Aufruf (`cipher.js:27-30`). Verschlüsselt ein Retry neu, passt der Zähler nicht mehr, oder der Server lehnt mit 409 ab (`rendezvous.mjs:139-141`, Digest über den Frame). `noise.send()` ist ebenso irreversibel.
  - Der Initiator muss in `receive()` nach Nachricht 2 zwei Frames senden (Nachricht 3, `accepted`). Heute erlaubt der Kanal nur einen offenen Frame (`#pending`, `rendezvous-client.mjs:70`). Scheitert der POST, verarbeitet der nächste `receive()` Nachricht 2 erneut und zerstört den Noise-Zustand (`recv` nach `shift`).
  - Ein Fehler mitten in einem Batch hat den Noise- und Cipher-Zustand schon fortgeschrieben. Heute wäre der Kanal danach wieder benutzbar.
  - Spec §4.5 verlangt `mismatch` nur bei der `rs`-Prüfung. Der Kanal wirft aber für jede Prüfung dieselbe Meldung (`check`, `:5`).
- Fix: Vertrag §2.1 (Outbox mit einmal verschlüsselten Frames, feste Reihenfolge ack → flush → GET, Vergiftung bei jedem Verarbeitungsfehler, `error.code === 'mismatch'` nur aus der `rs`-Prüfung).

**B6: `#establish` verwirft gültige Daten und kann den Host dauerhaft blockieren.**
- Beleg:
  - Spec §4.5: „Werte aus `receive()` während des Handshakes müssen leer sein, sonst `failed`“. Der Viewer kann Nachricht 3, `accepted` und den ersten Offer-Teil im selben Batch erhalten (der Agent ist nach dem POST von `accepted` `ready`, startet den Offer, der Viewer pollt nur jede Sekunde). H1 testet genau diesen Fall bereits (`rendezvous.test.mjs:99`).
  - Wartet `#establish` mit einem Timer aus `s.handles`, löscht `#end` (`lab-host.ts:577`) den Timer, das Promise bleibt hängen. `#accept` läuft in `#exclusive` (`:132,195-201`), `#busy` bleibt dann bis zum Teardown `true`, und jede weitere Aktion meldet `stale`.
  - Ohne eigene Obergrenze blockiert ein hängender Handshake `#exclusive` bis zur Zustimmungsfrist (bis 55 s).
- Fix: Vertrag §2.4 (`#sleep` endet auch bei Abbruch, Werte werden gepuffert und nach `connecting` verarbeitet, `handshakeMs` = 20 s).

**B7: Zwei neue Texte machen den i18n-Katalogtest rot.**
- Beleg: `i18n-catalog.test.ts:92` verbietet in en-US ein Leerzeichen vor `…`; die Spec hat „Establishing the encrypted connection …“. `remoteLab:connecting` hat in der Spec keine Verwendung, Test (d) „no orphaned keys“ (`:100`) schlägt dann fehl.
- Fix: en-US „Establishing the encrypted connection…“ (§5). Verwendung in §2.8 (T10).

---

## 2. Vertrag (wörtlich übernehmen, ersetzt Spec §4 und §5, soweit hier genannt)

### 2.1 `scripts/sync-prototype/rendezvous-client.mjs` (T1, Welle 1)

Importe: `import Noise from 'noise-handshake';` und `import Cipher from 'noise-handshake/cipher.js';` (mit `.js`; das Paket hat kein `exports`-Feld, wie `pairing.mjs:2-3`). Keine anderen neuen Abhängigkeiten. `node:crypto` bleibt für Identität und Nonces.

```js
export const RENDEZVOUS_NOISE_PROFILE = 'Noise_XX_25519_ChaChaPoly_BLAKE2b';
export const RENDEZVOUS_PROLOGUE = 'shellherd-rendezvous-noise-v1';
/** Raw X25519 key pair from a Node KeyObject via PKCS8 DER (fixed 16-byte prefix); public key equals the SPKI tail. Caller zeroes secretKey. */
export function noiseKeyPair(privateKey) // → { publicKey: Buffer(32), secretKey: Buffer(32) }
/** SPKI DER base64 (60 chars) of a raw 32-byte X25519 public key. */
export function spkiOf(raw32) // → string
export function createRendezvousIdentity() // unverändert
export class RendezvousPeer {
  // constructor, register, devices, sessions, request, unregister: unverändert (H1)
  channel(session, expectedFingerprint, scope) // peerPublicKey entfällt
}
class RendezvousChannel {
  get ready()
  async accept()
  async receive()     // → unknown[] (nur Datenwerte)
  async send(value)
  async retry()       // = #flush()
  async close()
  dispose()
}
```

`noiseKeyPair`:
- `der = privateKey.export({ format: 'der', type: 'pkcs8' })`, `check(der.length === 48 && der.subarray(0,16).toString('hex') === '302e020100300506032b656e04220420')`.
- `secretKey = Buffer.from(der.subarray(16))` (eigene Kopie), danach `der.fill(0)`.
- `publicKey = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(12)` als Kopie.
- Kein JWK: dessen `d` ist ein unveränderlicher String, den niemand nullen kann (K1).

`spkiOf(raw)`: `check(Buffer.isBuffer(raw) && raw.length === 32)`, Ergebnis `Buffer.concat([Buffer.from('302a300506032b656e032100','hex'), raw]).toString('base64')`.

Konstruktor `RendezvousChannel(peer, session, expectedFingerprint, scope)`:
- Prüfungen aus `:56-57` unverändert.
- `check(hex(expectedFingerprint) && expectedFingerprint !== peer.identity.id && expectedFingerprint === (session.from === peer.identity.id ? session.to : session.from))`.
- `initiator = (peer.identity.id === session.to)`.
- `keys = noiseKeyPair(peer.identity.privateKey)`; `noise = new Noise('XX', initiator, keys)`; `check(noise.protocol.toString() === RENDEZVOUS_NOISE_PROFILE)`.
- `noise.initialise(Buffer.from(JSON.stringify([RENDEZVOUS_PROLOGUE, RENDEZVOUS_NOISE_PROFILE, peer.store.info.serverId, session.id, session.nonce, scope, session.from, session.to])))`.
- Der Viewer baut den Prologue aus der Sitzung, die `RendezvousPeer.channel` gegen `#requests` geprüft hat (`:42-44`). Schlägt danach etwas fehl, wird `keys.secretKey` genullt.

Zustand: `#outbox` (Array `{ sequence, frame }`, `frame` als base64-**String**), `#queued` (zuletzt vergebene Sequenz), `#sent` (vom Server bestätigte Sequenz), `#received`, `#delivery`, `#failed`, `#closed`, `#acceptPosted`, `#msg1Queued`, `#acceptedSeq` (Initiator), `#acceptedSeen` (Responder), `#acceptedAcked`, `#tx`/`#rx` (`Cipher`), Zähler je Richtung.

Pflichtsemantik:
1. **Einmal verschlüsseln:** Jeder ausgehende Frame entsteht genau einmal (`noise.send()` bzw. `#tx.encrypt(...)`) und liegt mit fester Sequenz in `#outbox`, bis der Server `{ sequence }` bestätigt. Wiederholungen senden **denselben String** (Server-Idempotenz über Digest). Nie neu verschlüsseln.
2. **`#flush()`:** sendet die Outbox der Reihe nach (`POST …/messages`, Body `{ sequence, frame }`), prüft `result.sequence === sequence`, entfernt den Eintrag, setzt `#sent`. Netzwerkfehler werfen, ohne den Kanal zu vergiften.
3. **`receive()`:** `#assert(); check(!#receiving && !#failed)`.
   - (a) Liegt `#delivery` vor: `values = await #acknowledge(); await #flush(); return values`.
   - (b) Sonst `await #flush()`, dann `GET …/messages?after=#received`, prüfen `Array.isArray(messages) && messages.length <= 32`.
   - (c) Jede Nachricht in Reihenfolge verarbeiten (Punkt 4). Neue ausgehende Frames kommen in die Outbox. Die Werte und Flags landen in `#delivery`, dann `#acknowledge()`, dann `#flush()`, dann `return values`.
   - Jeder Fehler in (c) setzt `#failed = true` (Kanal unbrauchbar, nur `close`/`dispose` bleiben) und wird weitergeworfen. Fehler aus GET, ack und flush vergiften nicht.
4. **Verarbeitung je Nachricht:** `check(exact(message,'frame,sequence') && message.sequence === seq + 1 && typeof message.frame === 'string')`. Dann `bytes = Buffer.from(message.frame, 'base64')` als **frischer Puffer** (die Bibliothek nullt `re` darin), `check(bytes.toString('base64') === message.frame && bytes.length >= 1 && bytes.length <= 8208)`. Weiter nach Zustand:
   - Responder, erwartet Nachricht 1: `check(bytes.length === 32)`; `check(noise.recv(bytes).length === 0)`; Nachricht 2 `noise.send()` in die Outbox.
   - Initiator, erwartet Nachricht 2 (nur nach `#msg1Queued`): `check(bytes.length === 96)`; `check(noise.recv(bytes).length === 0)`. **Sofort danach**, vor dem Senden, die `rs`-Prüfung (Punkt 5). Dann `msg3 = noise.send()`, `check(noise.complete)`, Ciphers anlegen, Nachricht 3 und `#tx.encrypt(JSON {kind:'accepted', scope})` in die Outbox (`#acceptedSeq` = deren Sequenz).
   - Responder, erwartet Nachricht 3: `check(bytes.length === 64)`; `check(noise.recv(bytes).length === 0 && noise.complete)`; `rs`-Prüfung; Ciphers anlegen.
   - Transport: `plain = #rx.decrypt(bytes)`, JSON parsen, `plain.fill(0)`. Responder ohne `#acceptedSeen`: `check(exact(p,'kind,scope') && p.kind === 'accepted' && p.scope === session.scope)`, `#acceptedSeen = true`. Sonst `check(exact(p,'kind,value') && p.kind === 'data')`, `values.push(p.value)`. Der Initiator nimmt nie `accepted` an.
   - Mehr als 4096 Frames je Richtung → `check(false)`. `noise.recv` wird nie nach `complete` aufgerufen.
5. **`rs`-Prüfung:** `deviceId(spkiOf(noise.rs)) === expectedFingerprint`. Bei Abweichung oder Ausnahme: `throw Object.assign(new Error('Rendezvous peer fingerprint mismatch'), { code: 'mismatch' })`. Kein anderer Pfad setzt `code: 'mismatch'`.
6. **Ciphers:** `#tx = new Cipher(noise.tx)`, `#rx = new Cipher(noise.rx)`, AD leer. Keine eigene HKDF-Stufe; `#trafficKey` und die Accept-Nonce entfallen ersatzlos.
7. **`accept()`:** `#assert(); check(initiator && !#failed)`. `POST …/accept` mit `'{}'` (serverseitig idempotent), danach `#acceptPosted = true`. Nur beim ersten Mal (`!#msg1Queued`) kommt Nachricht 1 `noise.send()` in die Outbox, dann `#msg1Queued = true`. Danach `await #flush()`.
8. **`send(value)`:** `#assert(); check(this.ready && #outbox.length === 0 && !#sending)`, Klartext JSON `{kind:'data', value}` mit höchstens 8192 Byte, einmal verschlüsseln, Klartext nullen, Outbox, `#flush()`.
9. **`ready`:** `!#closed && !#failed && performance.now() < deadline && noise.complete && #outbox.length === 0 && (initiator ? #sent >= #acceptedSeq : #acceptedAcked)`. `#acceptedAcked` wird erst in `#acknowledge()` gesetzt, wenn der Batch mit `accepted` quittiert ist (wie heute `:129`).
10. **`dispose()`:** wirft nie. `#closed = true`; `#tx?._clear()`, `#rx?._clear()`; `keys.secretKey.fill(0)`. Bei unvollständigem Handshake zusätzlich `noise.e?.secretKey?.fill(0)`, `noise.key?.fill(0)`, `noise.chainingKey?.fill(0)`, `noise.digest?.fill(0)`, jeweils mit `try`. Nie `noise._clear()` aufrufen, das wirft bei `e === null`. Outbox und `#delivery` leeren.
11. Keine Protokollierung von Frames, Schlüsseln oder Klartext.

Serverseite in derselben Task (`rendezvous.mjs:132-138` ersetzen):
```js
fail(exact(body, 'frame,sequence') && Number.isSafeInteger(body.sequence) && body.sequence > 0 && body.sequence <= 0xffffffff && typeof body.frame === 'string');
const decoded = Buffer.from(body.frame, 'base64'); fail(decoded.toString('base64') === body.frame && decoded.length >= 1 && decoded.length <= 8208);
const digest = createHash('sha256').update(JSON.stringify([body.sequence, body.frame])).digest('hex');
```
Alles Weitere in `rendezvous.mjs` bleibt unverändert. Der Server importiert weder `noise-handshake` noch `sodium-*` (das Docker-Image hat kein `node_modules`, `server/Dockerfile:8-10`).

### 2.2 Server, Transport (T2, Welle 1)

- `server.mjs:93`: `/v1/info` ergänzt `rendezvousNoise: Boolean(broker)`.
- `http-common.mjs`: `probeSyncServer(serverUrl, { allowLoopbackHttp = false, allowPrivateHttp = false, signal } = {})` → `normalizeSyncServerUrl(serverUrl, { loopback: allowLoopbackHttp, private: allowPrivateHttp })`; Rückgabe ergänzt `rendezvousNoise: info.rendezvousNoise === true`.
- `account-transport.mjs`:
  - Konstruktor: `normalizeSyncServerUrl(info.serverUrl, { loopback: true, private: true }) === info.serverUrl`.
  - Neu `async remove(id)`: `check(/^[a-f0-9]{64}$/.test(id))`, `DELETE /v1/vaults/<ns>/objects/<id>`. Bei `status === 404` → `false`. Sonst `check(result.removed === true)` → `true`.
- `server.mjs` DELETE, gilt nur für den Objektpfad:
  - `methods`: Objektpfad im Login-Modus `['GET','DELETE']`, im Gerätemodus `['GET']` (DELETE → 405). Die Sammlung bleibt `['GET','PUT']`.
  - Die bestehenden Prüfungen bleiben (`:141` Body leer, `:147` erneute Autorisierung, `:155` `assertHealthy`).
  - Danach: `check(!uncertain, 503); check(!busy, 409); check(objects.has(id), 404); busy = true;` dann `try { unlink(join(directory, id + '.blob')) }`, wobei `ENOENT` als entfernt zählt. Darauf `const bytes = objects.get(id); objects.delete(id); total -= bytes;`, danach Verzeichnis-`sync`. Scheitert dieser `sync`, wird `uncertain = true` gesetzt und der Fehler geworfen. `finally busy = false`. Antwort `send(200, { removed: true })`.
  - PUT auf den Objektpfad liefert dann 405 statt 400. Betroffene Tests werden angepasst.
- `listen(port = 0, host = '127.0.0.1')`: `check(typeof host === 'string' && net.isIP(host) !== 0)` (`import net from 'node:net'`). Rückgabe: `127.0.0.1`, wenn `host` `0.0.0.0` oder `::` ist; bei IPv6 sonst `[host]`; bei IPv4 sonst `host`. Format `http://<h>:<port>/`.
- `server/main.mjs`: reicht `SHELLHERD_SERVER_HOST` unverändert durch (bereits so, `:65-66`). Keine neue Datei im Server-Importgraph (sonst `Dockerfile:9` nachziehen).

### 2.3 `src/shared/sync-server-url.mjs` und `.d.mts` (T3, Welle 1)

```ts
// sync-server-url.d.mts
export interface SyncServerUrlOptions { loopback?: boolean; private?: boolean }
export function normalizeSyncServerUrl(input: unknown, options?: boolean | SyncServerUrlOptions): string | null;
export function isPrivateTunnelAddress(hostname: string): boolean;
/** True only for plain HTTP to a numeric tunnel address, i.e. a URL that needs the privateNetwork opt-in. */
export function needsPrivateNetwork(input: unknown): boolean;
```
Regeln:
- Reines JS ohne `node:*`, denn der Renderer importiert die Datei.
- `options === true` bedeutet `{ loopback: true }`, `false` oder fehlend bedeutet `{}`. Es zählt nur `=== true`.
- HTTP ist erlaubt, wenn `(loopback && ['127.0.0.1','[::1]'].includes(url.hostname)) || (private && isPrivateTunnelAddress(url.hostname))`. HTTPS bleibt wie heute.
- `isPrivateTunnelAddress` arbeitet auf dem WHATWG-kanonischen `url.hostname`. Dezimal-, Oktal-, Hex- und Kurzformen von IPv4 sind dort schon aufgelöst. Erlaubt sind:
  - IPv4 mit genau vier Dezimaloktetten ohne führende Null, jeweils höchstens 255: `10/8`, `172.16/12`, `192.168/16`, `100.64/10`.
  - IPv6 in Klammern oder ohne: Das erste Hextett muss explizit sein (`/^\[?([0-9a-f]{1,4}):/i`) und `(wert & 0xfe00) === 0xfc00` erfüllen.
  - Alles andere ist `false`: Namen, `::`-Präfix (also `::ffff:…` IPv4-mapped, `::1`), `fe80::/10`, `fec0::/10`, `64:ff9b::/96`, `169.254/16`, `0.0.0.0`, öffentliche Adressen.
- `needsPrivateNetwork(input)`: `normalizeSyncServerUrl(input, { private: true }) !== null && normalizeSyncServerUrl(input, { loopback: true }) === null`.

### 2.4 `src/main/remote/lab-host.ts` (T8, Welle 2)

```ts
export interface RemoteServerInfo { serverUrl: string; serverId: string; namespace: string; authentication: 'password' | 'device'; rendezvous: boolean; rendezvousProof: boolean; rendezvousNoise: boolean }
export interface RemotePeer { …unverändert…; channel(session: RemoteSessionWire, expectedFingerprint: string, scope: 'view'): RemoteChannel }
export interface RemoteDeps { probe(serverUrl: string, allowPrivateHttp: boolean, signal: AbortSignal): Promise<RemoteServerInfo>; …unverändert… }
// requestSchema connect:
z.object({ kind: z.literal('connect'), clientId: uuid, serverUrl: z.string().max(2048), privateNetwork: z.boolean().optional() }).strict()
```
- `#connect(owner, clientId, serverUrl, privateNetwork: boolean)`: `normalizeSyncServerUrl(serverUrl, { loopback: true, private: privateNetwork })`; ohne Ergebnis `invalid`. `probe(url, privateNetwork, signal)`. `unavailable`, wenn `info.authentication !== 'password' || !info.rendezvous || info.rendezvousProof !== true || info.rendezvousNoise !== true`. Kein Downgrade.
- `Sess.peerKey` entfällt, ebenso der Parameter in `#newSession`. `PeerDevice.publicKey` und `deviceSchema` bleiben.
- `#sleep(s, ms): Promise<void>`: löst auf, wenn der Timer feuert **oder** `s.abort.signal` abbricht. Der Handle steht in `s.handles` und wird beim Auflösen entfernt; ist `s.ended` schon gesetzt, löst es sofort auf.
- `#establish(s): Promise<{ ok: true; values: unknown[] } | { ok: false; code: RemoteErrorCode }>`:
  - `limit = Math.min(s.deadline, now + L.handshakeMs)`. Der erste `receive()` läuft sofort, danach alle `L.setupPollMs` über `#sleep`.
  - Gelieferte Werte werden **gepuffert**, nie als Fehler gewertet. Sobald `channel.ready`, endet die Schleife mit `{ ok: true, values }`.
  - Endet `s.ended` oder ist `this.#session !== s`: `{ ok: false, code: 'stale' }`.
  - Fehlerzuordnung:
    - `error.code === 'mismatch'` → `#end(s,'failed')`, Code `mismatch`.
    - Status 404 → `#end(s,'remote','remote')`, Code `stale`.
    - 429 vor `limit` → weiter pollen.
    - Sonst → `#end(s, now >= s.deadline ? 'expired' : 'failed')`, Code `expired` bzw. `connection`.
  - `limit` erreicht: ist `now >= s.deadline`, dann `expired`, sonst `#end(s,'failed')` mit Code `connection`.
- `#consume(s, values): boolean`: das bisherige Schleifeninnere von `#loopTick` (`:553-569`), unverändert. `#loopTick` ruft es auf.
- `#accept`: Kanal mit `channel(s.wire, s.peer.id, 'view')`, dann `channel.accept()` mit der Fehlerbehandlung wie heute (`:344-350`), dann `r = await #establish(s)`. Bei `!r.ok` → `{ ok: false, code: r.code }`. Bei Erfolg, falls `this.#session === s`: `connecting`, `deadline = now + L.sessionMs`, `#startDeadline`, `#setSharing(true)`, `#consume(s, r.values)`, `#startLoop(s)`, `#ok()`. Während `#establish` bleibt der Zustand `granted`; `#decline`/`#stop` beenden.
- Viewer `#pollTick`: Ist der Zustand `active`, dann `channel(parsed.data, s.peer.id, 'view')` (eine Ausnahme ergibt `failed` plus Event `mismatch`, wie `:530`). Danach `r = await #establish(s)`. Bei `!r.ok` und `r.code === 'mismatch'` folgt Event `{ kind: 'error', code: 'mismatch' }`. Bei Erfolg `connecting`, `deadline`, `#startDeadline`, `#publish`, `#consume(s, r.values)`, `#startLoop`.
- `#signal` verlangt weiter `s.channel.ready`.

### 2.5 `src/shared/remote-lab.ts`, `remote-signal.ts` (T7, Welle 1)

```ts
| { kind: 'connect'; serverUrl: string; privateNetwork?: boolean }
export const REMOTE_LAB_LIMITS = { …, verificationHex: 16, verificationAttempts: 3, muteMs: 600000, handshakeMs: 20000 } as const;
/** Strips whitespace, lower-cases; exactly REMOTE_LAB_LIMITS.verificationHex hex chars or null. */
export function normalizeVerification(input: string): string | null;
/** Constant-time (pure JS) check of the input against fingerprint.slice(0, REMOTE_LAB_LIMITS.verificationHex). */
export function verifyFingerprintPrefix(input: string, fingerprint: string): boolean;
```
`remote-signal.ts` importiert `REMOTE_LAB_LIMITS` aus `./remote-lab`. Dort gibt es keinen Rückimport, also keinen Zyklus. Weder `Buffer` noch `node:crypto`. Die Kommentare nennen keine feste 12 mehr.

### 2.6 `src/main/sync-prototype/vault-sync.ts` (T4, Welle 1)

```ts
export interface VaultRemote { list(): Promise<string[]>; get(id: string): Promise<string>; put(wire: string): Promise<string>; /** true = removed, false = already absent (404). */ remove?(id: string): Promise<boolean> }
export interface VaultSyncResult { …; skipped?: number; /** Server objects removed by compaction in this run (removed or already absent). */ compacted?: number; /** Ids of unreadable account objects of this run; main-only, never copied into renderer state. */ foreign?: string[]; snapshot?: VaultSessionSnapshot }
interface Version { kind: 'shellherd-sync-version-v1'; parents: string[]; portable: PortableVault; compacts?: string[] }
export const SYNC_RETAIN = 16; export const SYNC_COMPACT_AT = 32; export const SYNC_COMPACTS_MAX = 256;
/** Re-reads each candidate; deletes only objects that do not AEAD-open under the unlocked vault key. Returns the number actually removed. */
export async function removeForeignObjects(sessions: VaultSessionManager, remote: VaultRemote, context: SyncContext, ids: string[], signal: AbortSignal): Promise<number>;
```

Schema und Graph:
- `versionSchema` ergänzt `compacts: z.array(hex64).max(SYNC_COMPACTS_MAX).refine(unique).optional()`. In `tryAdd`: Enthält `compacts` einen eigenen Parent oder die eigene ID, gibt es `null` (unlesbar).
- `create(portable, parents, compacts?)` schreibt `compacts` nur, wenn das Array nicht leer ist. Ohne Kompaktierung bleibt das Dokument bytegleich zu H1.
- `get compacted(): Set<string>` ist die Vereinigung über alle **vorhandenen** Versionen und wird bei jeder Abfrage oder nach `add`/`prune` neu berechnet.
- `compactedBy(id)` = Vereinigung der `compacts` aller Versionen in `ancestors(id)`.
- `validate()`: Ein fehlender Parent ist nur erlaubt, wenn `compacted.has(parent)`, sonst `history`. Die Zyklusprüfung bleibt.
- `ancestors()` überspringt fehlende Parents.
- `heads()` = IDs, die kein vorhandener Version-Parent sind **und** nicht in `compacted` liegen.
- `base(l, r)`:
  - `common = ancestors(l) ∩ ancestors(r)` ergänzt um `ancestors(l) ∩ compactedBy(r)` und `ancestors(r) ∩ compactedBy(l)`. Ein ehrliches Gerät nennt in `compacts` nur eigene Vorfahren, also ist ein lokal noch vorhandener, von der Gegenseite kompaktierter Vorfahr ein gemeinsamer Vorfahr.
  - Danach maximale Elemente wie heute. Genau eines → Basis, sonst `undefined`.
- `prune(keep: Set<string>): number` entfernt jede vorhandene Version mit `compacted.has(id) && !keep.has(id)` aus `values`/`wires` und gibt den Platz in `bytes` frei. Rückgabe ist die Anzahl.

`pull(remote, graph, acked, check)` → `{ received, skipped, foreign: string[], stale: string[] }`:
- Listing laden, alle fehlenden Objekte laden (`tryAdd`). Unlesbare zählen zu `skipped` und `foreign`. Ein unlesbares Objekt in `acked` ergibt `history` (wie heute).
- **Zombies:** Danach werden neu geladene IDs (vor `pull` nicht in `graph`), die in `graph.compacted` liegen, sofort wieder aus dem Graph entfernt. Sie gelangen nicht in `received`.
- `missing = acked.filter(id => !listing.includes(id))`; `ensure(missing.every(id => graph.compacted.has(id)), 'history')`. Dann `graph.validate()`.
- `stale = listing.filter(id => graph.compacted.has(id))`.
- Kein `prune` in `pull`.

`synchronizeVault`, Ablauf ab dem bestehenden Erfolgspfad (`:151-160`); nur bei Rückgabe `synced`, nie bei `conflict`/`bindings`:
1. Bisheriger Commit und `persist`, wie heute.
2. **Reparatur:** Ist `remote.remove` vorhanden, wird für jede ID aus `stale` `remote.remove(id)` aufgerufen. `true`/`false` zählt zu `compacted`. Netzwerk- oder HTTP-Fehler (außer `check()`) beenden die Schleife still (E5).
3. `keep = new Set([...graph.heads(), ...state.localHeads])`; `graph.prune(keep)`; `state.acked = state.acked.filter(id => graph.values.has(id))`; `persist`.
4. **Kompaktierung**, nur wenn alle Bedingungen gelten: `remote.remove` vorhanden, `graph.heads().length === 1`, kein `state.pending` und `graph.values.size > SYNC_COMPACT_AT`.
   - `head` = einziger Kopf. `retain` = Breitensuche über Parents ab `head` mit Abstand `< SYNC_RETAIN` (Kopf = 0), nur vorhandene IDs.
   - `removeNow = [...graph.values.keys()].filter(id => !retain.has(id)).sort()`.
   - `compacts = unique([...removeNow, ...[...graph.compacted].filter(id => !removeNow.includes(id)).sort()]).slice(0, SYNC_COMPACTS_MAX)`. `removeNow` steht vorn, damit Kürzungen nie die Parents behaltener Versionen treffen.
   - `C = graph.create(graph.value(head).portable, [head], compacts)`; `persist` (C im Checkpoint, noch nicht `acked`), dann `upload()` (put, ack, persist). Danach `state.localHeads = [C]`, `state.working` unverändert, `persist`.
   - Je ID aus `removeNow`: `remote.remove(id)`, gezählt wie in Schritt 2, Fehler beenden die Schleife still.
   - Danach `graph.prune(new Set([C]))`, `state.acked` filtern, `persist`.
5. Ergebnis `synced` mit `compacted` (Summe aus Schritt 2 und 4; nur gesetzt, wenn > 0), `skipped`, `foreign` (nur wenn nicht leer).

Absturzfestigkeit: Vor dem Upload liegt `C` im Checkpoint, der nächste Lauf lädt ihn hoch. Nach einem Teil-Löschen decken `compacts` die fehlenden `acked`-IDs, Schritt 2 löscht den Rest. Vor dem Prune-`persist` enthält der Checkpoint noch alles. Jede Reihenfolge endet ohne `history`.

`importSyncedVault`: `pull(remote, graph, [], check)` mit denselben Regeln; danach `ensure(graph.heads().length === 1, 'conflict')`, so dass kompaktierte IDs nicht als Köpfe zählen. Ergebnis mit `foreign`. Keine Kompaktierung, keine Löschung.

`removeForeignObjects`:
- `ensure(process.platform === 'linux', 'limit')`; `ensure(remote.remove, 'limit')`.
- `lease = await sessions.captureForSync()`, `check = () => { ensure(!signal.aborted, 'locked'); lease.assertCurrent(); }`.
- `ids` mit dem `ids`-Schema prüfen; `listing = await remote.list()`.
- Je `id` aus `ids ∩ listing`: `wire = await remote.get(id)`, `ensure(hashWire(wire) === id)`. **Lesbar** heißt: `openDocument(encryptedFile(wire), lease.key, lease.kdf, context, 'version')` wirft nicht, unabhängig von Schema, `vaultId` oder `compacts`. Lesbares bleibt. Nur Unlesbares wird per `remote.remove(id)` gelöscht. Nur `true` zählt.
- `finally lease.key.fill(0)`.

### 2.7 `src/shared/sync-lab.ts`, Sync-Host, Sync-IPC (T9, Welle 2)

```ts
// sync-lab.ts
| { kind: 'connect'; serverUrl: string; privateNetwork?: boolean }
| { kind: 'removeForeign' }
sync?: { status: 'synced' | 'conflict' | 'bindings'; versions: number; conflicts: number; canKeepLocal: boolean; conflictRevision?: string; approvals: number; skipped?: number; compacted?: number; removedForeign?: number };
// SyncLabReply ok:false code ergänzt: | 'samePasswordImport'
// lab-host.ts
export interface AccountDriver { login(username: string, password: string): Promise<unknown>; list(): Promise<unknown>; get?(id: string): Promise<string>; put?(wire: string): Promise<string>; remove?(id: string): Promise<boolean>; close(): void }
export type SyncVaultRequest = { kind: 'synchronize' } | { kind: 'keepLocal'; reviewed: true; revision: string } | { kind: 'importVault'; password: string } | { kind: 'removeForeign'; ids: string[] };
export type SyncVaultOutcome = VaultSyncResult | { removedForeign: number };
constructor(createDriver?: () => LabDriver,
  probe?: (serverUrl: string, allowPrivateHttp: boolean, signal: AbortSignal) => Promise<ServerInfo>,
  createEnrollment?: (info: ServerInfo) => EnrollmentDriver,
  createAccount?: (info: ServerInfo, signal: AbortSignal) => AccountDriver,
  syncVault?: (account: AccountDriver, info: ServerInfo, signal: AbortSignal, request: SyncVaultRequest) => Promise<SyncVaultOutcome | undefined>,
  matchesVaultPassword?: (password: string) => Promise<boolean | undefined>)
```
- `connect`: Das Schema ergänzt `privateNetwork: z.boolean().optional()`. `url = normalizeSyncServerUrl(serverUrl, { loopback: true, private: privateNetwork === true })`, dann `probe(url, privateNetwork === true, signal)`.
- Verbindung ergänzt `foreign?: string[]` und `passwordDigest?: { key: Buffer; digest: Buffer }`.
- `signIn`: Nach erfolgreichem `login` und `list`, sofern `same !== true` (also auch bei geprüftem Passwort, E3), wird ein Digest abgelegt. `key = randomBytes(32)`, `digest = createHmac('sha256', key).update(password.normalize('NFKC')).digest()`.
- `performSync('importVault')`: Liegt `passwordDigest` vor, wird `createHmac('sha256', key)` über `request.password.normalize('NFKC')` gebildet. Gilt `timingSafeEqual(…, digest)`, kommt `{ ok: false, code: 'samePasswordImport', state }`, und `syncVault` wird nicht aufgerufen. In jedem Fall werden `key` und `digest` danach mit `fill(0)` gelöscht und das Feld entfernt. Gelöscht wird auch bei `close`, `reset`, `closeOwner` und einem neuen `connect`.
- Ergebnis von `synchronize`/`keepLocal`/`importVault`: `const { snapshot: _s, foreign, ...summary } = result; current.sync = summary; current.foreign = foreign?.length ? foreign : undefined;`. `foreign` darf nie im Zustand landen. TypeScript erzwingt das nicht (strukturelle Typen), deshalb ist es ein Pflichttest.
- `performSync('removeForeign')`: Das Schema ergänzt `z.object({ kind: z.literal('removeForeign'), clientId: token }).strict()`.
  - Ohne `current.foreign?.length` → `invalid`.
  - Sonst `syncVault(…, { kind: 'removeForeign', ids: current.foreign })` → `n = 'removedForeign' in r ? r.removedForeign : 0`.
  - Danach `current.foreign = undefined; current.sync = { ...current.sync!, skipped: 0, removedForeign: n }`. Fehler werden wie bei `synchronize` abgebildet.
- `lab-ipc.ts` (Sync):
  - Dispatch-Liste `['synchronize','keepLocal','importVault','removeForeign']`.
  - `probe: (url, allowPrivateHttp, signal) => transport.probeSyncServer(url, { allowLoopbackHttp: true, allowPrivateHttp, signal })`.
  - `transport.remove = (id: string) => remote.remove!(id)`, wenn `remote.remove` existiert.
  - Bei `removeForeign` → `{ removedForeign: await removeForeignObjects(options.sessions, transport, info, request.ids, signal) }`.

### 2.8 Renderer (T10, Welle 2)

- Beide Verbinden-Formulare: `const privateCandidate = needsPrivateNetwork(serverUrl)`. Die Checkbox (`<label className="remote-lab-check">` bzw. `sync-lab-check`, `<input type="checkbox">`) mit `privateNetwork.label` und darunter `privateNetwork.hint` (`remote-lab-warning` bzw. `sync-lab-notice`) erscheint nur bei `privateCandidate`. Sie ist standardmäßig aus und wird bei jeder URL-Änderung zurückgesetzt; nichts wird gespeichert.
- Knopf-Freigabe: `normalizeSyncServerUrl(serverUrl, { loopback: true, private: privateCandidate && checked })`. `connect` sendet `privateNetwork: true` nur bei gesetzter Checkbox, sonst ohne Feld.
- `RemoteLabDialog`: Bei `viewerSession?.state === 'connecting' && !view.stream` steht `<p className="remote-lab-caption" role="status">{t('remoteLab:connecting')}</p>`.
- `SyncLabDialog`:
  - Ergebniszeile `t('syncLab:compacted', { count })` nur bei `compacted > 0`.
  - Bei `skipped > 0`: Knopf `secondary-button` „Fremde Objekte entfernen“ mit Hinweis `removeForeignHint`, sendet `{ kind: 'removeForeign', clientId }`.
  - Ergebniszeile `removedForeign` bei Wert ≥ 0 nach der Aktion.
  - Die Fehlermap ergänzt `samePasswordImport`.
- Neue CSS-Regeln (`.remote-lab-check`, `.sync-lab-check`) nur mit Tokens (`display:flex; align-items:center; gap: var(--space-8)`), keine Inline-Styles, keine Bewegung.

---

## 3. Korrekturen (bindend)

- **K1** `noiseKeyPair` nutzt PKCS8-DER statt JWK (§2.1); Test gegen `createPublicKey` (SPKI-Ende) und gegen falsches Präfix.
- **K2** `dispose()` nutzt das Wipe aus §2.1/10 statt `_clear` der Bibliothek bei unvollständigem Handshake. Test: `dispose` nach Nachricht 1 wirft nicht.
- **K3** Eingehende Frames werden je Frame frisch dekodiert und nie wiederverwendet (die Bibliothek nullt `re` im Eingabepuffer).
- **K4** Spec §5, Tabellenzeile 2 ist falsch. Nach Nachricht 1 kennt V noch kein `rs`. A erfährt `rs` (V statisch) beim Empfang von Nachricht 2 und prüft ihn **vor** Nachricht 3 (§2.1/4). V erfährt `rs` bei Nachricht 3. Größe von `accepted`: 50 statt ≈ 45 Byte.
- **K5** Handshake-Frames haben exakte Längen 32/96/64 und leere Payload. Transport-JSON verlangt `exact`-Schlüssel. Mehr Bytes in Nachricht 1 wären Klartext.
- **K6** `AccountStore.remove` → `boolean` (404 → `false`); `VaultRemote.remove` optional mit `boolean`.
- **K7** Server-DELETE setzt `busy`, prüft `uncertain`, aktualisiert `objects`/`total` nach `unlink` und setzt `uncertain` bei fehlgeschlagenem Verzeichnis-`sync` (§2.2).
- **K8** `listen`-Rückgabe setzt IPv6 in Klammern; `::` → `127.0.0.1`.
- **K9** URL-Regeln auf dem kanonischen Hostnamen, reines JS, `needsPrivateNetwork`, `.d.mts` (§2.3).
- **K10** „Fremde Objekte“: lesbar heißt AEAD-öffnbar unter dem aktuellen Schlüssel. So bleiben Versionen neuerer Clients (unbekanntes Schema) erhalten. Nur Kandidaten aus dem letzten Ergebnis und dem frischen Listing; 404 zählt nicht.
- **K11** M3-Digest als HMAC-SHA256 mit Zufallsschlüssel je Verbindung statt nacktem SHA-256 eines Passworts im RAM.
- **K12** `foreign` wird beim Übernehmen in `current.sync` ausdrücklich entfernt (Pflichttest).
- **K13** `handshakeMs: 20000`; Zeitüberschreitung → `failed`/`connection`, nicht `expired` (deren Text spricht von fünf Minuten).
- **K14** `compose.wireguard.yaml` ist eine **eigenständige** Datei (alle Härtungsoptionen aus `compose.yaml`, `build.context: ..`, ohne `SHELLHERD_SERVER_TRUSTED_PROXY`, `ports: ["${SHELLHERD_BIND_ADDR:?WireGuard-Adresse}:8787:8787"]`) und keine Override-Datei, denn Compose hängt `ports` an und behielte `127.0.0.1` und den Proxy-Modus. Die README nennt: Das WG-Interface muss vor Docker oben sein (sonst `cannot assign requested address`). Die Quell-IP bleibt mit iptables-DNAT erhalten, Limits greifen dann pro Tunnel-IP; mit Userland-Proxy nicht (im Lab prüfen).
- **K15** `remoteLab:connecting` en-US ohne Leerzeichen vor `…`, Verwendung nach §2.8.
- **K16** T12 umfasst auch `docs/manual.md` (`:746ff`, `:785`), `docs/handbuch.md:800` (H2-Verweis auf Kompaktierung) und `:808` (48 Bit), `docs/plans/selfhosted-e2ee.md:18,21`, `selfhosted-threat-model.md:15` (M2) und `.claude/skills/run-app/SKILL.md:81`.
- **K17** Statische Importe von `noise-handshake`/`sodium-*` in `src/**` sind verboten. Nur `scripts/sync-prototype/rendezvous-client.mjs` importiert die Bibliothek, und diese Datei wird ausschließlich dynamisch geladen.
- **K18** `RemoteLabHost` prüft `rendezvousNoise` zusätzlich zu `rendezvousProof`. Alle Probe-Fakes in `lab-host.test.ts` (`:85,163,195,909`) bekommen das Feld.
- **K19** Kanalfehler vergiften den Kanal (§2.1/3). Ein zweiter `receive()` nach einem Verarbeitungsfehler wirft sofort.
- **K20** In `#loopTick` wird nichts verändert außer der Auslagerung nach `#consume`. Die Reihenfolge Zustand → Events → Netzwerk (K8 aus H1) bleibt.
- **K21** Rendezvous-Integrationstests treiben Runden direkt (Schleife `receive()` beider Seiten bis `ready`, höchstens 6 Runden, ohne `sleep`). Kanal- und Integrationstests mit Netzwerk setzen ein ausdrückliches Test-Timeout von 20 s (die H1-Flake zeigt die Lastempfindlichkeit).
- **K22** Server- und Client-Code verwenden kein `localeCompare`/`Intl`. UI-Texte nur über `t()`. Das Hauptprozess-Mapping bleibt bei `AppError`-Codes.

---

## 4. Entscheidungen (Rulings)

- **E1** Ruling: T5 verschärft nur den `media`-Check auf `video`, der Request bleibt wie H1. Grund: `getDisplayMedia` und Legacy-Desktop-`getUserMedia` sind in Electron 44 im Permission-Handler ununterscheidbar. Kosten, falls falsch: Nach erteilter Zustimmung kann ein kompromittierter Renderer weiter eine andere Quelle oder Desktop-Audio anfordern (Restrisiko §7).
- **E2** Ruling: Kumulative `compacts` (höchstens 256, aktuelle Löschungen vorn) und eine Basis über kompaktierte Vorfahren. Grund: Ohne beides gibt es Fehlalarm-`history` und eine dauerhaft gesperrte Kontohistorie. Kosten: ein Gerät, das länger als etwa 15 Kompaktierungszyklen (≈ 240 Versionen) fehlt, sieht `history` und muss neu laden.
- **E3** Ruling: Der M3-Digest wird nach jedem erfolgreichen Login gehalten, auch bei geprüftem Passwort. Grund: Der Import zielt auf einen gesperrten und möglicherweise anderen Vault. Kosten: keine (RAM, HMAC mit Zufallsschlüssel).
- **E4** Ruling: `VaultRemote.remove` ist optional. Grund: Welle 1 bleibt grün. Kosten, falls T9 die Verdrahtung vergisst: keine Kompaktierung (Review-Pflichtpunkt).
- **E5** Ruling: Löschfehler beenden die Löschschleife still, der Abgleich bleibt `synced`, der nächste Lauf repariert. Grund: Die Löschung ist Platzpflege, kein Integritätsschritt. Kosten: Ein Server ohne DELETE (H1) füllt sich weiter bis 507; dokumentiert (gemeinsame Aktualisierung).
- **E6** Ruling: „Fremde Objekte entfernen“ braucht keinen zusätzlichen Bestätigungsdialog. Grund: Lab, nur unlesbare Objekte, ausdrücklicher Klick mit Hinweis. Kosten: Fremde Vaults im selben Konto gehen verloren; Regel „ein Konto = ein Vault“ dokumentiert.
- **E7** Ruling: `handshakeMs = 20000`. Grund: `#exclusive` darf nicht bis zur Zustimmungsfrist blockieren. Kosten: Ein extrem langsamer Server bricht ab, dann ist eine erneute Anfrage nötig.
- **E8** Ruling: Welle 2 (T8, T9, T10) arbeitet parallel gegen §2.4/§2.7/§2.8 und ist erst mit allen dreien typecheck-grün; `vitest` ist je Task allein grün. Das ist das Vorgehen aus H1 (H1-B1).
- **E9** Ruling: `mismatch` wird über `error.code === 'mismatch'` erkannt (Duck-Typing über den dynamischen Import), nicht über die Meldung.
- **E10** Ruling: Die Checkbox „Privates Netz“ erscheint nur, wenn die URL sie braucht (`needsPrivateNetwork`). Grund: kein Rauschen für HTTPS und Loopback. Kosten: keine.
- **E11** Ruling: H1-Pins (48 Bit, `verified: true`) bleiben gültig (Spec R-H2-1 Nr. 2 bestätigt). Kosten: siehe §7.

---

## 5. Texte (wörtlich, de-DE / en-US, ersetzt Spec §10)

`remoteLab.json`:

| Key | de-DE | en-US |
| --- | --- | --- |
| `verify.label` (geändert) | Erste 16 Zeichen des Fingerabdrucks vom anderen Gerät (die ersten zwei Gruppen) | First 16 characters of the fingerprint from the other device (the first two groups) |
| `privateNetwork.label` | Privates Netz (WireGuard/Tailscale): HTTP erlauben | Private network (WireGuard/Tailscale): allow HTTP |
| `privateNetwork.hint` | Nur für eine WireGuard- oder Tailscale-Adresse dieses Servers. Außerhalb eines solchen Tunnels könnte das Netz Serverpasswort und Daten mitlesen. Dein Vault-Passwort bleibt lokal. | Only for a WireGuard or Tailscale address of this server. Outside such a tunnel the network could read the server password and data. Your vault password stays local. |
| `connecting` | Verschlüsselte Verbindung wird aufgebaut … | Establishing the encrypted connection… |

`syncLab.json`:

| Key | de-DE | en-US |
| --- | --- | --- |
| `privateNetwork.label` | Privates Netz (WireGuard/Tailscale): HTTP erlauben | Private network (WireGuard/Tailscale): allow HTTP |
| `privateNetwork.hint` | Nur für eine WireGuard- oder Tailscale-Adresse dieses Servers. Außerhalb eines solchen Tunnels könnte das Netz Serverpasswort und Daten mitlesen. Dein Vault-Passwort bleibt lokal. | Only for a WireGuard or Tailscale address of this server. Outside such a tunnel the network could read the server password and data. Your vault password stays local. |
| `serverHint` (geändert) | Trage deinen Server mit HTTPS ein. HTTP ist nur für 127.0.0.1, ::1 oder – nach Bestätigung – für eine WireGuard-/Tailscale-Adresse erlaubt. Keine Vault-Passwörter oder Schlüssel in die URL eintragen. | Enter your server with HTTPS. HTTP is allowed only for 127.0.0.1, ::1 or, after confirmation, for a WireGuard/Tailscale address. Never put vault passwords or keys into the URL. |
| `compacted_one` | {{count}} ältere Version wurde zusammengefasst und vom Server entfernt. | {{count}} older version was compacted and removed from the server. |
| `compacted_other` | {{count}} ältere Versionen wurden zusammengefasst und vom Server entfernt. | {{count}} older versions were compacted and removed from the server. |
| `removeForeign` | Fremde Objekte entfernen | Remove foreign objects |
| `removeForeignHint` | Entfernt nur Objekte, die sich mit deinem Vault-Passwort nicht lesen lassen. Ein Serverkonto trägt genau einen Vault. | Removes only objects that cannot be read with your vault password. A server account holds exactly one vault. |
| `removedForeign_one` | {{count}} fremdes Objekt wurde entfernt. | {{count}} foreign object was removed. |
| `removedForeign_other` | {{count}} fremde Objekte wurden entfernt. | {{count}} foreign objects were removed. |
| `errors.samePasswordImport` | Das Vault-Passwort ist zugleich dein Serverpasswort, und dieses wurde bereits an den Server gesendet. Der Import wurde abgebrochen. Ändere das Vault-Passwort auf dem Ursprungsgerät und wechsle das Serverpasswort. | The vault password is also your server password, and that one was already sent to the server. The import was cancelled. Change the vault password on the source device and rotate the server password. |

Für `removedForeign` mit `count` 0 greift `_other` („0 fremde Objekte wurden entfernt.“). Keine dynamischen Keys; die Fehlermap in `SyncLabDialog.tsx:63-69` bleibt ein Objektliteral mit vollen Literalen. Nichts wird entfernt.

---

## 6. Wellen und Tasks (ersetzt Spec §8 und Plan)

Jede Task arbeitet test-first, ändert nur ihre Dateien und committet nicht. Nach jeder Welle müssen `npm run typecheck` und `npx vitest run` grün sein.

### Welle 1 (parallel, dateidisjunkt)

| Task | Dateien | Pflichtpunkte | Pflichttests |
| --- | --- | --- | --- |
| **T1 Noise-Kanal und Rendezvous-Frames** | `scripts/sync-prototype/rendezvous-client.mjs`, `rendezvous-client.test.mjs` (neu, In-Memory-Fake von `store.request` mit echter `createRendezvous`-Warteschlange oder gleichwertigem Fake: Zustand `active` nach `accept`, Idempotenz per Digest, 409 bei anderem Inhalt), `rendezvous.mjs` (nur `:132-138`), `rendezvous.test.mjs`, `remote-signal.test.mjs`, `server/smoke.mjs`, `scripts/check-server-container.mjs` (nur Kanalzeilen `:49-54`) | §2.1 vollständig, K1–K5, K17, K19, K21 | Handshake A/V bis beidseitig `ready`, Sequenzen A→V 1,2,3 und V→A 1. `rs` ≠ erwarteter Fingerprint → Fehler mit `code === 'mismatch'`, nichts `ready`; beim Initiator vor dem Senden von Nachricht 3 (Outbox bleibt ohne Nachricht 3). Prologue-Abweichung je Feld (`serverId`, `nonce`, `scope`) → Initiator scheitert an Nachricht 2. Nachricht 1 mit 33 Byte → wirft. `send` vor `ready` → wirft. `accepted` mit anderem `scope` → wirft. Daten vor `accepted` → wirft. Server lässt einen Datenframe aus und nummeriert um → Entschlüsselung scheitert, Kanal vergiftet. `frame` mit 8209 Byte → 400. Altes Format `{ciphertext,nonce,sequence,tag}` → 400. Retry mit identischem Frame → 200, anderer Inhalt gleicher Sequenz → 409. Verlorene POST-Antwort bei Nachricht 3 → nächster `receive()` sendet denselben String, Handshake endet. Verlorene ACK-Antwort → keine Doppelauslieferung. Nachricht 3, `accepted` und Daten im selben Batch → Daten werden geliefert. `noiseKeyPair` bytegleich SPKI-Ende, falsches Präfix wirft. `dispose` nach Nachricht 1 wirft nicht; `dispose` nach `ready` ruft `Cipher.prototype._clear` zweimal (Spy). Alle bisherigen Kanaltests umgestellt, keiner ohne Ersatz gestrichen. `node server/smoke.mjs` grün. |
| **T2 Server: Info, DELETE, Listen, Transport** | `scripts/sync-prototype/server.mjs`, `server.test.mjs`, `account.test.mjs`, `http-common.mjs`, `account-transport.mjs`, `server/main.mjs` | §2.2, K6–K8 | `/v1/info.rendezvousNoise` true nur mit Broker. `probeSyncServer` reicht `allowPrivateHttp` durch und liefert `rendezvousNoise`. DELETE: 200 `{removed:true}`, Listing kleiner, Datei weg, `total` sinkt (ein vorher mit 507 abgelehnter PUT passt danach). Unbekannt → 404, `AccountStore.remove` → `false`. Ohne Token → 401. Gerätemodus → 405. Mit Body → 400. Während `busy` → 409. Nach Neustart konsistent. PUT auf den Objektpfad → 405. `listen('10.9.8.7')` passiert die `check`-Prüfung (Bind-Fehler erlaubt, Status ≠ 400). `listen('nicht-ip')` → 400. Rückgabe für `::1` als `http://[::1]:<port>/`. |
| **T3 URL-Regeln** | `src/shared/sync-server-url.mjs`, `sync-server-url.d.mts`, `sync-server-url.test.ts` | §2.3, K9 | Boolean bleibt Loopback, alle bisherigen Fälle unverändert. Mit `{private:true}` ok: `http://10.8.0.1:8787/`, `http://100.64.3.4/`, `http://100.127.255.255/`, `http://172.16.0.1/`, `http://172.31.255.254/`, `http://192.168.1.5/`, `http://[fd7a:115c:a1e0::1]/`, `http://[fc00::1]/`. Kanonisierung: `http://167772161/` → `http://10.0.0.1/`, `http://0xa.0.0.1/` → `http://10.0.0.1/`, `http://10.1/` → `http://10.0.0.1/`; `http://010.8.0.1/` (oktal = 8.8.0.1) → null. Null für: `http://100.63.255.255/`, `http://100.128.0.0/`, `http://172.15.0.1/`, `http://172.32.0.1/`, `http://169.254.1.1/`, `http://8.8.8.8/`, `http://0.0.0.0/`, `http://[fe80::1]/`, `http://[fec0::1]/`, `http://[fbff::1]/`, `http://[::ffff:10.0.0.1]/`, `http://[64:ff9b::a00:1]/`, `http://server.lan/`, `http://10.0.0.1.nip.io/`. `https://` überall wie heute. Ohne `private` null für alle Tunneladressen. `{private:true}` ohne `loopback` → `http://127.0.0.1/` null. Ports bleiben im Ergebnis. `needsPrivateNetwork` true nur für HTTP-Tunneladressen. |
| **T4 Kompaktierung** | `src/main/sync-prototype/vault-sync.ts`, `vault-sync.test.ts` | §2.6, B4, E2, E5, K10 | Fake-Remote mit `remove`. 33 ändernde Abgleiche → genau eine Kompaktierungsversion, Listing = 17, `compacted > 0`, Checkpoint kleiner; danach `synced`. Zurückkehrendes Gerät, dessen `acked` von C1 kompaktiert wurde, das seinerseits von C2 kompaktiert wurde → `synced`, nicht `history`. Dasselbe Gerät mit lokaler Änderung → Merge über kompaktierte Basis (`synced`, ein Kopf). Ist die Änderung echt widersprüchlich, kommt `conflict` wie heute, nichts wird gelöscht. Server löscht ein `acked`-Objekt ohne deckende `compacts` → `history`. Server löscht die `acked` Trägerversion → `history`. Fremdschlüssel-`compacts` → unlesbar, bei `acked` `history`. Server liefert ein kompaktiertes Objekt erneut → kein Kopf, Reparatur löscht es, kein `history`. Abbruch nach dem ersten `remove` (Fehler) → `synced`; der nächste Lauf repariert, Listing = 17. Abbruch zwischen Upload von C und `remove` → der nächste Lauf repariert. Import nach Kompaktierung → Erfolg, ein Kopf. Keine Kompaktierung bei zwei Köpfen, `pending` oder fehlendem `remove`. `compacts` ≤ 256 und Parents behaltener Versionen nie gekürzt. Versionen ohne Kompaktierung enthalten kein `compacts`-Feld. `removeForeignObjects`: unlesbares Objekt wird gelöscht, lesbares Objekt mit fremdem Schema bleibt, ID nicht im Listing wird nicht angefasst, 404 zählt nicht, Zählung korrekt. |
| **T5 Permissions** | `src/main/permissions.ts`, `permissions.test.ts` | §1 B1, E1 | Request-Regeln unverändert (bestehende Tests bleiben). Check `media` mit `video` → Grant; `audio`, `unknown` und `undefined` → false auch bei Grant. `display-capture` unverändert. |
| **T6 Dialog-Throw** | `src/main/remote/lab-ipc.ts` (nur `:63-65`), `lab-ipc.test.ts` | Spec §4.9 | `showMessageBox` wirft → `'unavailable'` (`lab-ipc.test.ts:142-147` angepasst); Abbruch während des Dialogs bleibt `'declined'`. |
| **T7 Prüfung 16 Hex** | `src/shared/remote-lab.ts`, `src/shared/remote-signal.ts`, `remote-signal.test.ts`, `src/main/remote/lab-host.test.ts` (nur `:14,421,423,425,923,931` auf `REMOTE_LAB_LIMITS.verificationHex`) | §2.5, K13 | `normalizeVerification`: 15 und 17 Zeichen → null; 16 mit Leerraum und Großschrift → ok; zwei Achtergruppen „aaaaaaaa bbbbbbbb“ → ok. `verifyFingerprintPrefix` true bei passenden 16 und false bei Abweichung im 13.–16. Zeichen. `handshakeMs === 20000`. |
| **T11 Betrieb** | `server/compose.wireguard.yaml` (neu), `server/README.md`, `scripts/sync-prototype/README.md`, `docs/plans/docker-rendezvous.md` | Spec T11 plus K14. API-Tabelle: `{sequence, frame}`, `DELETE …/objects/:id` (nur Login-Modus), `rendezvousNoise`. Abschnitt „Kompaktierung“: 16/32, kumulative Liste mit höchstens 256 Einträgen, ein Konto = ein Vault, Löschen nur per Konto-Auftrag, gemeinsame Aktualisierung aller Lab-Geräte vor der ersten Kompaktierung. | `docker compose -f server/compose.wireguard.yaml config` mit gesetztem `SHELLHERD_BIND_ADDR`, sofern Docker vorhanden; sonst im Bericht. |

### Welle 2 (nach Welle 1, parallel, dateidisjunkt; typecheck-grün erst mit allen drei, E8)

| Task | Dateien | Pflichtpunkte | Pflichttests |
| --- | --- | --- | --- |
| **T8 RemoteLabHost** | `src/main/remote/lab-host.ts`, `lab-host.test.ts`, `src/main/remote/lab-ipc.ts` (nur `probe`-Verdrahtung `:103`) | §2.4, B6, K13, K18, K20 | `connect` ohne `rendezvousNoise` → `unavailable`. `privateNetwork:true` mit `http://10.8.0.2:8787/` → `probe(url, true, …)`; ohne Flag → `invalid`. `channel(session, fingerprint, 'view')` ohne Schlüssel. Agent: `accept` → Fake wird nach zwei `receive()` `ready` → `connecting`, `sharing`, Deadline = `sessionMs`. Fake wirft `{code:'mismatch'}` → `ended/failed`, Antwort `mismatch`. Frist während des Handshakes → `expired`. `handshakeMs` überschritten → `failed`. `decline` während des Handshakes → `declined`, kein `connecting`, **und danach ist `#busy` frei** (eine Folgeaktion ist nicht `stale`). Viewer: `active` → `#establish` → `connecting` erst bei `ready`. Werte im letzten Handshake-`receive()` (Offer-Teil) werden nach `connecting` verarbeitet, nicht `failed`. Viewer-`mismatch` → Event `error/mismatch`. `signal` vor `ready` → `stale`. 404 während des Handshakes → `remote`. Bestehende Tests angepasst, keiner ohne Ersatz gestrichen. |
| **T9 Sync-Lab** | `src/shared/sync-lab.ts`, `src/main/sync-prototype/lab-host.ts`, `lab-host.test.ts`, `src/main/sync-prototype/lab-ipc.ts`, `lab-ipc.test.ts` | §2.7, B3, E3, K11, K12 | `privateNetwork` → Probe mit `allowPrivateHttp`. HTTP-Tunnel-URL ohne Flag → `invalid`. Gesperrt und gleiches Passwort beim Import → `samePasswordImport`, `syncVault` nicht aufgerufen, Digest danach genullt (zweiter Import mit anderem Passwort läuft). Geprüft-ungleich beim Login und gleiches Passwort beim Import → ebenfalls `samePasswordImport`. `close`/`reset` nullen den Digest (Spy auf `fill`). `removeForeign` ohne `foreign` → `invalid`; mit `foreign` → Aufruf mit IDs, `removedForeign` im Zustand, `skipped` 0. `foreign` erscheint nie im Zustand (`JSON.stringify(state)` enthält keine Objekt-ID). `compacted` wird durchgereicht. |
| **T10 Renderer** | `src/renderer/src/components/RemoteLabDialog.tsx`, `RemoteConsentDialog.tsx` (nur falls nötig), `SyncLabDialog.tsx`, `src/renderer/src/remote-lab.css`, `src/renderer/src/sync-lab.css`, `src/shared/locales/{de-DE,en-US}/remoteLab.json`, `src/shared/locales/{de-DE,en-US}/syncLab.json` | §2.8, §5, B7, K15, E10 | i18n-Katalogtest grün (Parität, Platzhalter, keine verwaisten Keys, en-US-Ellipse). Design-Token-Test grün. `remote-lab.test.ts` unverändert grün (`satisfies` bleibt). |

### Welle 3

| Task | Dateien | Pflichtpunkte |
| --- | --- | --- |
| **T12 Doku und Szene** | `docs/handbuch.md` (§„Fernzugriff (Entwicklung)“ `:769ff`, Sync-Abschnitt inkl. `:800`, `:808`), `docs/manual.md` (`:746ff`, `:785`, Sync-Abschnitt), `docs/plans/selfhosted-e2ee.md`, `docs/plans/selfhosted-threat-model.md`, `docs/plans/selfhosted-protocol.md`, `.claude/skills/run-app/remote-scene.mjs`, `.claude/skills/run-app/SKILL.md` | Spec T12 plus K16. 16 Zeichen = „die ersten zwei Gruppen“; Noise XX, Forward Secrecy; Bedienung „privates Netz“ mit Warnhinweis; Kompaktierung (Retention, kumulative Liste, Rückkehr nach langer Abwesenheit: Merge über kompaktierte Basis bzw. Neu-Laden nach sehr langer Abwesenheit); „Fremde Objekte entfernen“; `samePasswordImport`-Text. Permissions ehrlich nach E1: nur der Check ist verschärft, der Legacy-Pfad bleibt Restrisiko. Threat-Model: N3 behoben, M2 48 → 64 Bit, Tabelle „H2“, Löschrecht per Konto als Grenze, M4-Rest. Protokollplan: Profil, Prologue (Feldreihenfolge), Rollen, Frame-Format, exakte Handshake-Längen, Outbox-Regel, Kompaktierungsregeln aus §2.6. Szene: `FIRST_16` (`slice(0,16)`), Log-Texte „erste 16 Zeichen“, Prüfung `connecting`/aktiv binnen 8 s nach Zustimmung, kein Prüffeld bei geprüftem Pin (unverändert). |

### Abschluss (Lead)

- `npm run typecheck`, `npx vitest run`, `node server/smoke.mjs`.
- `npx electron-vite build`, run-app-Screens (`terminal`, `sftp`, `settings`) und `remote-scene.mjs` mit `/console`-Prüfung. Die Szene ist das Gate für T5 (Check-Verschärfung) und T8 (Handshake-Latenz). Scheitert die Szene an T5, wird nur die Check-Regel auf H1 zurückgesetzt (E1).
- `node scripts/check-server-container.mjs`, sofern Docker verfügbar.
- Einmal real im Lab prüfen (oder im Bericht offen lassen): `tailscale serve` setzt `X-Forwarded-For`; Quell-IP mit `compose.wireguard.yaml`.
- Kein CHANGELOG, keine Version (wie H1).

---

## 7. Restrisiken (zur Kenntnis, keine Aufgabe)

- **Legacy-Desktop-`getUserMedia` nach Zustimmung (M4-Rest)** bleibt offen (E1). Mit Electron 44 ist er im Permission-Handler nicht von `getDisplayMedia` zu unterscheiden. Es bleiben: Zustimmung je Sitzung, nur Hauptframe, CSP, Notbremse.
- **48-Bit-Pins aus H1** bleiben gültig (E11). Ein im Lab theoretisch gegrindeter Pin würde vom Handshake mit 256 Bit „bestätigt“.
- **`compacts`-Kürzung bei 256:** Nach sehr langer Abwesenheit kommt Fehlalarm-`history`, Ausweg ist Neu-Laden. Zwei Köpfe ohne berechenbare Basis bleiben wie heute ein Konflikt ohne Auflösungspfad (vorbestehend).
- **Löschrecht per Konto oder Token (15 min):** betrifft die Verfügbarkeit; `history` erkennt unautorisiertes Löschen bestätigter Objekte. Löschen oder Zurückhalten noch nie gesehener Objekte bleibt unerkennbar (Freeze, bis H3).
- **H1-Server ohne DELETE:** Mit H2-Clients wächst das Konto weiter bis 507 (E5). Gemeinsame Aktualisierung ist dokumentiert.
- **Native Addon:** `sodium-native` ist nur unter Linux x64 ausgeführt. Unter Windows/macOS gibt es Prebuilds, ungeprüft. Fehlt das Addon, ist der Fernzugriff `unavailable` (`lab-ipc.ts:115`). Würde der Lab je gepackt, müssten `noise-handshake` in `dependencies` und `sodium-native` in `asarUnpack`.
- **Bibliotheks-Interna:** Der Wipe in `dispose` nutzt Felder von `noise-handshake` 4.2.0 (`e`, `key`, `chainingKey`, `digest`). Die Version ist exakt gepinnt (`package.json:63`). Die übrigen HKDF-Bytes neben `tx`/`rx` und JS-Strings bleiben bis zur GC im Speicher.
- **Privates Netz im fremden WLAN:** Serverpasswort, Token und Chiffrat liegen im Klartext; der Hinweistext sagt es. Ein kompromittierter Renderer kann `privateNetwork:true` ohne Klick senden. Das gleicht der freien URL-Wahl und wird angenommen.
- **Tailscale `serve`/Docker-Quell-IP:** Annahmen ungeprüft, siehe Abschluss.
- **Fehlertext bei altem Server:** `rendezvousNoise` fehlt → „Der Fernzugriff ist in diesem Build nicht verfügbar.“ ist ungenau (wie H1 bei `rendezvousProof`).
- **Vorbestehende Test-Flake** in `rendezvous.test.mjs` unter Volllast (K21 mildert).

---

## Zusammenfassung

Urteil **ready after corrections**: 7 Blocker, 22 Korrekturen, 11 Entscheidungen.
- Der Noise-XX-Einsatz ist im Kern korrekt: Profil, Prologue, Agent als Initiator, `rs` aus dem Handshake, `Cipher` aus derselben Bibliothek, keine Eigenkomposition. Er läuft nachweislich im Electron-Main dieses Projekts (dynamischer Import aus `scripts/`, N-API-Prebuild, kein Bündeln).
- Blocker:
  - die Permissions-Regel, die `getDisplayMedia` brechen würde (B1);
  - Dateizuordnung und Wellen-Grün (B2, B3);
  - die Kompaktierung, die ohne kumulative `compacts` und kompaktierte Basis Fehlalarme und eine dauerhaft gesperrte Kontohistorie erzeugt (B4);
  - der Kanalvertrag zu Nonce, Outbox und Retry sowie die `mismatch`-Unterscheidung (B5);
  - `#establish`, das gültige Daten verwirft und `#busy` blockieren kann (B6);
  - zwei i18n-Verstöße (B7).
