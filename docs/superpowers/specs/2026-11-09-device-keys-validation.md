# Sicherheitshärtung H3: Validierung (bindend)

Prüfer: Opus, 2026-11-09. Geprüft wurden Spec `2026-11-09-device-keys-design.md` und Plan `docs/superpowers/plans/2026-11-09-device-keys.md` gegen den Code auf `claude/feature/device-keys` (`bf6701b`, gestapelt auf H1/H2 aus `staging` @ `29f9293`). Gelesen wurden `scripts/sync-prototype/*.mjs` (Server, Auth, Rendezvous, Transport, Zugriff alter Gerätemodus), `server/{main,smoke}.mjs`, `server/Dockerfile`, `scripts/check-server-container.mjs`, `src/main/sync-prototype/*`, `src/main/remote/*`, `src/main/vault/{crypto,session}.ts`, `src/shared/{sync-lab,remote-lab,remote-signal}.ts`, die beiden Lab-Dialoge mit CSS, die Locale-Dateien und `i18n-catalog.test.ts`, `.claude/skills/run-app/{rendezvous,sshd,remote-scene,fakes.test}.mjs` und `SKILL.md`, `vitest.config.ts`, `.github/workflows/ci.yml`. Kontext: H1- und H2-Validierung (gelten weiter, soweit hier nichts anderes steht), `CLAUDE.md`.

Ausgangslage: `npm run typecheck` grün. `npx vitest run`: 220 Dateien, 3405 Tests grün, 36 übersprungen.

Selbst ausgeführt (Node 22.22.1, Skript im Scratchpad, nicht im Repo):
- Ed25519 aus Node-`crypto`: PKCS8-DER 48 Byte mit Präfix `302e020100300506032b657004220420`, SPKI-DER 44 Byte mit Präfix `302a300506032b6570032100`, Signatur 64 Byte, `sign`/`verify` mit `null`-Digest funktionieren.
- **OpenSSL nimmt einen Ed25519-Schlüssel im Identitätspunkt (`01` gefolgt von 31 Nullbytes) an, und die Signatur `01‖0⁶³` verifiziert dann für jede Nachricht.** Ohne Prüfung kann ein Einschreibender ein Gerät anlegen, für das jeder Dritte Nachweise fälschen kann (K5).
- `hkdfSync('sha256', 16 Byte, …, 32)` liefert 32 Byte. Ein 128-Bit-Zufallscode als HKDF-IKM ist in Ordnung.
- Grep über den Importgraph: `AccountStore.login` nutzen außer den Spec-Dateien auch `password-sync.test.mjs`, `remote-signal.test.mjs`, `rendezvous-client.test.mjs`, `.claude/skills/run-app/fakes.test.mjs` (alle in `vitest`) und `scripts/check-server-container.mjs` (CI). `server/Dockerfile:9` kopiert die Serverdateien einzeln.

**Urteil: ready after corrections.** Es gibt 9 Blocker, 24 Korrekturen und 11 Entscheidungen.

Die Architektur ist tragfähig. Sitzung per signierter Challenge, Ed25519 neben X25519 in einer Identitätsdatei, Roster am Server, neue Objekthülle mit `kind` in der AAD, `K_sync` mit HKDF-Keybox unter 128 Bit Zufall: alles nur mit Node-`crypto`, ohne Eigenkomposition. Die Signatureingaben sind domänengetrennt (eigenes Tag an Index 0, eigener Schlüssel nur für diese vier Nachrichten) und binden `serverId`, `namespace` und Geräte-ID. Was fehlt, sind Zustandsregeln: Quarantäne, Bootstrap, Sitzungsablauf, Altformat. Dazu kommen Lücken in der Dateizuordnung, die Welle 1 rot ließen.

Dieser Anhang geht Spec und Plan vor. Was hier nicht steht, gilt aus der Spec weiter. §6 ersetzt Spec §8 und den Plan vollständig.

---

## 1. Blocker (jeder mit Fix, bindend)

**B1: Dateizuordnung lässt Welle 1 rot oder ohne Besitzer.**
- Beleg:
  - `AccountStore.login` entfällt (T2). Folgende Dateien laufen in `vitest` (`vitest.config.ts:5`) oder in der CI (`ci.yml:43-45`) und haben in Spec §8 keinen Besitzer: `scripts/sync-prototype/password-sync.test.mjs:27`, `remote-signal.test.mjs:25`, `rendezvous-client.test.mjs:27`, `.claude/skills/run-app/fakes.test.mjs:557-562` (prüft `authentication: 'password'` und `login`) und `scripts/check-server-container.mjs:47,60-62`. Die Container-Prüfung lädt außerdem ein `terminus-encrypted-vault`-Objekt hoch, das nach H3 mit 400 abgelehnt wird.
  - `server/Dockerfile:9` kopiert jede Serverdatei einzeln. Ohne `device-proof.mjs`, `device-roster.mjs` und `sync-object-wire.mjs` startet das Image nicht, und die CI scheitert.
  - T4 ändert den Konstruktor von `RemoteIdentityStore` (Spec §4.8: `generate`/`derive` intern). `src/main/remote/lab-ipc.ts:95-101` ruft ihn mit vier Argumenten auf und gehört erst in Welle 2 zu T8, also ist der Typecheck nach Welle 1 rot.
  - T3 ändert die Signaturen von `synchronizeVault` (Optionsobjekt statt `keepLocalRevision`) und `importSyncedVault` (`recoveryCode`, `newPassword`). `src/main/sync-prototype/lab-ipc.ts:207,212` (T7, Welle 2) kompiliert dann nicht mehr.
  - T5 liegt in Welle 1. Neue Locale-Keys ohne Verwendung verletzen Katalogtest (d) „no orphaned keys“ (`i18n-catalog.test.ts:100`), weil die Verwendung erst mit T9 in Welle 2 kommt. Pflichtfelder in `SyncLabRequest`/`RemoteLabCommand` (`deviceName`) und in `account` brechen außerdem `SyncLabDialog.tsx:39`, `RemoteLabDialog.tsx` und `remote/lab-host.ts:699` (alle Welle 2).
  - `scripts/sync-lab-smoke.mjs` (Passwort-Login, Import mit Vault-Passwort) und `docs/manual.md:746ff` (englisches Handbuch) haben keinen Besitzer.
- Fix: neue Zuordnung in §6.
  - T1 besitzt alle Integrationstests, die Server und Transport zusammen treiben, außerdem Smoke, Container-Prüfung, Dockerfile und den Rendezvous-Block in `fakes.test.mjs`.
  - T3 besitzt `password-sync.test.mjs` und die Aufrufzeilen in `sync-prototype/lab-ipc.ts:202-212` sowie `SyncVaultRequest` in `sync-prototype/lab-host.ts:18` (mechanisch, §2.11 Welle-1-Teil).
  - T4 besitzt die Store-Erzeugung in `remote/lab-ipc.ts:90-101`.
  - T5 wandert in Welle 2.
  - T10 bekommt `docs/manual.md` und entfernt `scripts/sync-lab-smoke.mjs` samt README-Zeile (E11).
  - Welle 1 ist erst mit allen Tasks zusammen grün, Welle 2 ebenso (E7).

**B2: Die Quarantäne kann die Historie sperren und bricht den Hauptfall „Laptop verloren“.**
- Beleg: Spec §4.9 Stufe 2: „widerrufen und nicht in `acked`/Vorfahren bekannter Köpfe → `null` + `quarantined++`“, „manipulierter `author` → `null`“.
  - **Verlorenes Gerät:** Gerät A hat alle Versionen erzeugt und wird widerrufen. Gerät B lädt danach mit dem Code. Jede Version stammt von einem widerrufenen Autor und ist B unbekannt, also quarantänisiert B alles. Der Import ist unmöglich, und genau dafür gibt es den Widerruf.
  - **Kompaktierung eines später widerrufenen Geräts:** B kompaktiert vor dem Widerruf (`C` mit `compacts`, Objekte gelöscht). A sieht `C` erst danach und quarantänisiert es. Damit fehlen IDs aus `acked` im Listing und stehen nicht in `compacted` (`vault-sync.ts:221`), also `history` bei jedem Lauf, dauerhaft.
  - **Reihenfolge:** `tryAdd` arbeitet je Objekt. Ob eine Version Vorfahr einer später geladenen Version eines aktiven Geräts ist, steht erst nach dem Laden aller Objekte fest. Spec §4.9 legt keine zweite Phase fest.
  - **`null` bei falscher Signatur:** Die Signaturschlüssel kommen vom Server (Geräteliste). Ein bösartiger Server tauscht einen Schlüssel aus, damit wird eine bereits bestätigte Version „unlesbar“, und `pull` meldet `history` (`vault-sync.ts:217`). Das widerspricht Spec §7 („höchstens Verfügbarkeit … nie die Historie“) nicht formal, sperrt aber Geräte ohne Ausweg.
- Fix: Algorithmus §2.9.4. Der Autorenstempel trägt einen signierten Zeitpunkt `at` (E1). Quarantäne gilt nur für `at ≥ revokedAt` oder eine ungültige Signatur, nie für Checkpoint-, `acked`- oder Vorfahren-Versionen. Quarantänierte Versionen werden nicht verworfen, sondern zurückgehalten. Ihre `compacts` zählen für die `history`-Prüfung, aber nie für Zombie-Verwerfen, `stale`-Löschung oder `heads()`.

**B3: Die Geräteliste enthält keine Signaturschlüssel, `keyOf` ist nicht umsetzbar.**
- Beleg: Spec §4.3 `roster.list()` → `[{ id, name, enrolledAt, revokedAt, ephemeral }]`, §4.5 `GET /v1/devices` = `roster.list()` + `self`. Spec §4.11 verlangt aber `keyOf` „aus der letzten Geräteliste“ für die Prüfung der Autorenstempel.
- Fix: `GET /v1/devices` liefert je Eintrag zusätzlich `signingKey` (base64, 32 Byte roh). Der Client prüft die Liste (§2.7), berechnet `self` selbst (`id === identity.id`, der Serverwert wird ignoriert) und verlangt, dass der eigene Eintrag den eigenen `signingPublicKey` trägt, sonst `connection`.

**B4: Altformat-Objekte machen `pull` und „Fremde Objekte entfernen“ kaputt.**
- Beleg: Spec §4.2/§4.5 setzt im Login-Modus `opaque() = validateSyncObject`. `readObject` ruft `opaque` auch bei jedem `GET` auf (`server.mjs:61,185`), also liefert ein `GET` auf ein H2-Objekt 400 statt des Objekts. Spec §4.7 lässt `AccountStore.get` mit `validateSyncObject` prüfen, und T2 verlangt „Altformat → wirft“. Dann wirft `pull` beim ersten Altobjekt einen Transportfehler (`connection`) statt es als `foreign` zu zählen. `removeForeignObjects` holt jedes Objekt erst mit `get` (`vault-sync.ts:396`) und kann Altobjekte deshalb nie löschen. Spec §6 verspricht genau diesen Weg.
- Fix: Server `readObject` (Start **und** `GET`) toleriert `validateSyncObject(wire) || isLegacyVaultObject(wire)`; nur `PUT` ist strikt. `AccountStore.get` gibt beides zurück (`validateSyncObject` oder `isLegacyVaultObject`, sonst wirft es); `put` bleibt strikt. Der Sync-Kern klassifiziert über `parseSyncEnvelope` (§2.9.1): Altformat ist `foreign`.

**B5: Der `K_sync`-Bootstrap hat ein Rennen und zwei Absturzfenster ohne Ausweg.**
- Beleg: Spec §4.9 sagt nur: „gibt es keine [Keybox] und keine Versionen → `K_sync` erzeugen, Code erzeugen, Keybox hochladen, `syncKey` persistieren“.
  - **Rennen:** Zwei Geräte gleichen ein leeres Konto gleichzeitig ab. Beide erzeugen einen eigenen `K_sync` und laden eine eigene Keybox hoch. Danach liegen zwei Versionsfamilien unter verschiedenen Schlüsseln, und jede ist für die andere „fremd“. Löscht jemand „Fremde Objekte“, gehen die Wurzeln des anderen Geräts verloren.
  - **Absturz nach dem Keybox-Upload, vor dem Persistieren:** Danach liegt eine Keybox im Konto, deren Code niemand kennt, und kein Gerät hat `K_sync`. Jeder weitere Lauf meldet `syncKey`, kein Code passt, und „Fremde Objekte entfernen“ löscht Keyboxen nie (Spec §4.9). Das Konto ist ohne Serverzugriff nicht mehr nutzbar.
  - **Keine Keybox, aber Versionen** (z. B. vom Server entfernt): Das Verhalten ist nicht festgelegt. Ein naiver Bootstrap würde eine zweite Schlüsselfamilie erzeugen.
- Fix: Ablauf §2.9.3. Der Checkpoint wird vor dem Upload mit `syncKey` und `keybox` (ausstehende ID) geschrieben. Nach dem Upload folgt ein erneutes Listing; liegt dann eine andere Keybox oder eine Version vor, bricht das Gerät ab, nimmt die eigene Keybox zurück und entfernt den Checkpoint. Nach einem Absturz setzt der nächste Lauf mit einem neuen Code fort. „Keine Keybox, aber Versionen“ ergibt `syncKey` bzw. mit Code `recoveryCode`, ohne Bootstrap.

**B6: Ein normaler Sitzungsablauf erzwingt erneut das Passwort.**
- Beleg: Spec T8: „401 in Presence → `#dropAccount` + `forgetEnrollment`“. Die Presence-Schleife bekommt aber auch nach Ablauf der 12-h-Obergrenze von `refresh` ein 401 (`account-auth.mjs:64`). Danach wäre die Einschreibung vergessen, und das Passwort ginge erneut über die Leitung. Das ist genau das Gegenteil des H3-Ziels. Das Sync-Lab hat gar keine Erneuerung: Das Token gilt 15 Minuten (`account-auth.mjs:56`), danach ergibt jeder Abgleich 401. Spec T7 legt nur `openSession` 401 → `forgetEnrollment` fest, nicht 401 bei Abgleich, Liste oder Widerruf. Außerdem zählt eine abgelaufene Nonce (> 30 s, langsamer Client) als 401 und führt zum Vergessen.
- Fix (§2.11/§2.12):
  - `forgetEnrollment` gibt es nur, wenn `openSession` zweimal hintereinander mit frischer Challenge 401 liefert.
  - Jedes andere 401 verwirft nur die Sitzung. Die Einschreibung bleibt, der Zustand zeigt `enrolled`, und ein Klick auf „Sitzung öffnen“ genügt.
  - Das Sync-Lab öffnet vor jeder Serveraktion selbst eine neue Sitzung, wenn `Date.now() ≥ expiresAt − 60000` gilt, mit Signatur und ohne Passwort.

**B7: Die Checkpoint-AAD hängt am ganzen Kontextobjekt.**
- Beleg: `vault-sync-crypto.ts:34` `aad = stable(['shellherd-vault-sync', 1, purpose, context, kdf])`. `lab-ipc.ts:206-212` übergibt als `context` die ganze `ServerInfo` (u. a. `serverUrl`, `authentication`, `rendezvous*`). Schon heute macht ein URL-Wechsel den Checkpoint deshalb zu `wrongVault`. Mit H3 kommen `deviceSessions` und `context.device` (Objekt mit Funktionen; `stable` serialisiert sie als `undefined`) dazu. Ein Checkpoint, der mit Gerät geschrieben wurde, wäre ohne Gerät unlesbar, und jedes neue Info-Feld würde alle Checkpoints brechen.
- Fix: Jede AAD und jedes HKDF-Salz bauen den Kontext ausdrücklich als `{ serverId: context.serverId, namespace: context.namespace }` bzw. `[serverId, namespace]`, nie aus dem übergebenen Objekt (§2.9.1). Das gilt für Objekte (Spec §5) und für den Checkpoint.

**B8: Texte verletzen den Katalogtest, Fehlercodes fehlen.**
- Beleg: en-US `syncLab:enrolling` „Enrolling device …“ verstößt gegen Test (f) (`i18n-catalog.test.ts:92`, kein Leerzeichen vor `…`). `syncLab:localVaultPassword` wird nach dem Umbau der Importform nicht mehr verwendet und verstößt gegen Test (d). Dem Sync-Lab fehlen die Codes `identity` und `limit`: Spec §4.10 nennt `identity`, aber kein `limit`. Ein 429 bei der Einschreibung (17. Gerät, Backoff) würde als `connection` „Server nicht bestätigt“ erscheinen. `syncLab:removeForeignHint` sagt „mit deinem Vault-Passwort nicht lesen“, was nach H3 falsch ist.
- Fix: Texte §5. `localVaultPassword` wird in beiden Sprachen gelöscht. `errors.limit` und `errors.identity` kommen hinzu, die Fehlermap bekommt `satisfies Record<SyncLabErrorCode, string>`.

**B9: Die run-app-Gates scheitern reproduzierbar.**
- Beleg: Der Rendezvous-Fake läuft dauerhaft in `npm run drive:sshd` (`sshd.mjs:290-293`, Port 8788, Datenverzeichnis unter `RUN_DIR`), nicht frisch je Szene, wie Spec §1/§6 annimmt. Jede Instanz läuft mit `--password-store=basic` und schreibt sich also temporär ein. Bei höchstens 8 temporären Geräten und 12 h Ablauf meldet der fünfte Lauf der Fernzugriff-Szene 429. Eine Sync-Szene gegen denselben Fake findet beim zweiten Lauf Keybox und Versionen des ersten vor und kann keinen Bootstrap machen. Eine `drive:sync-scene`-Konvention gibt es nicht; `remote-scene.mjs` wird mit `node` gestartet (`SKILL.md:78`).
- Fix:
  - Bei vollem RAM-Kontingent verdrängt eine temporäre Einschreibung das temporäre Gerät mit der ältesten letzten Sitzung, das keine aktive Sitzung hat. Nur wenn alle 8 aktiv sind, gibt es 429 (§2.3).
  - `sync-scene.mjs` startet einen eigenen Server (`createSyncServer`, frisches Temp-Verzeichnis, Port 0, eigener Namespace) und beendet ihn am Ende.
  - Keine Änderung an `package.json`; Start mit `node .claude/skills/run-app/sync-scene.mjs`.

---

## 2. Vertrag (wörtlich übernehmen, ersetzt Spec §4 und §5, soweit hier genannt)

### 2.1 `scripts/sync-prototype/device-proof.mjs` (neu, T1)

```js
export const DEVICE_ENROLLMENT = 'shellherd-device-enrollment-v1';
export const DEVICE_SESSION = 'shellherd-device-session-v1';
export const DEVICE_REQUEST = 'shellherd-device-request-v1';
export const DEVICE_NAME = /^[^\x00-\x1f\x7f]{1,80}$/;
export function ed25519Spki(raw32)            // Buffer DER = 302a300506032b6570032100 ‖ raw; wirft bei raw.length !== 32
export function signingKeyOf(base64Raw32)     // KeyObject; wirft bei nicht kanonischem base64, Länge ≠ 32 oder schwachem Schlüssel (K5)
export function enrollmentBody(serverId, namespace, deviceId, signingKeyB64, noiseKeyB64, name) // → JSON.stringify([DEVICE_ENROLLMENT, serverId, namespace, deviceId, signingKeyB64, noiseKeyB64, name])
export function sessionProof(serverId, namespace, nonce, deviceId)            // → JSON.stringify([DEVICE_SESSION, serverId, namespace, nonce, deviceId])
export function requestProofV2(serverId, namespace, method, path, nonce, deviceId) // → JSON.stringify([DEVICE_REQUEST, serverId, namespace, method, path, nonce, deviceId])
/** Scripts/tests/smoke/scenes only (Node crypto). Same shape as the main-process RemoteIdentity. */
export function createDeviceIdentity()       // → { privateKey, publicKey (X25519 SPKI b64, 60), id (= deviceId(publicKey)), signingKey (Ed25519 KeyObject), signingPublicKey (b64 raw 32) }
```
- Jede Funktion prüft ihre Eingaben: `serverId`/`deviceId`/`nonce` hex64, `namespace` `/^[a-zA-Z0-9_-]{1,100}$/`, `method` ∈ `GET|POST|PUT|DELETE`, `path` beginnt mit `/v1/`, `name` passt auf `DEVICE_NAME`, `noiseKeyB64` 60 Zeichen.
- `deviceId` kommt aus `rendezvous.mjs` (`deviceId`, prüft X25519); `device-proof.mjs` importiert sie von dort.
- `http-proof.mjs` bleibt unverändert.

### 2.2 `scripts/sync-prototype/sync-object-wire.mjs` (neu, T1)

```js
export const SYNC_OBJECT_FORMAT = 'shellherd-sync-object';
export const SYNC_OBJECT_KINDS = ['version', 'keybox'];
export function validateSyncObject(wire) // → { kind }
export function isLegacyVaultObject(wire) // → boolean, wirft nie (try/catch um validateVaultFile)
```
`validateSyncObject` prüft:
- `typeof wire === 'string'` und `Buffer.byteLength(wire) ≤ 1048576`.
- `JSON.parse` und `JSON.stringify(parsed) === wire`.
- Schlüssel genau `format,version,kind,cipher,payload`.
- `format === SYNC_OBJECT_FORMAT`, `version === 1`, `kind ∈ SYNC_OBJECT_KINDS`.
- `cipher` mit genau `algorithm,nonce,authTag`, `algorithm === 'aes-256-gcm'`, `nonce` kanonisch base64 mit 12 Byte, `authTag` mit 16 Byte.
- `payload` kanonisch base64 mit mindestens 1 Byte.
- Die Schlüsselreihenfolge im Wire ist genau `format, version, kind, cipher{algorithm, nonce, authTag}, payload` (so erzeugt es `sealSyncObject`).

### 2.3 `scripts/sync-prototype/device-roster.mjs` (neu, T1)

```js
export async function createDeviceRoster({ directory, serverId, namespace, clock = Date.now, fault = async () => {} })
roster.enroll({ document, ephemeral })   // → { entry, created: boolean }
roster.revoke(id)                         // → { revoked: true }; unbekannt → 404
roster.entry(id)                          // → Eintrag oder undefined (inkl. widerrufener, ohne abgelaufene temporäre)
roster.signingKeyOf(id)                   // KeyObject | undefined (auch widerrufen)
roster.noiseKeyOf(id)                     // string | undefined
roster.isActive(id)                       // vorhanden, revokedAt === null, temporär nicht abgelaufen
roster.touch(id)                          // temporär: lastSession = now
roster.list()                             // [{ id, name, signingKey, enrolledAt, revokedAt, ephemeral }] sortiert nach enrolledAt, dann id
roster.assertHealthy()                    // 503 bei ungewissem Schreibausgang
```
- **Datei** `devices.json` im Objektverzeichnis, Inhalt kanonisch `JSON.stringify({ format: 'shellherd-device-roster', version: 1, serverId, namespace, devices: [{ id, name, signingKey, noiseKey, enrolledAt, revokedAt }] })`, höchstens 64 KiB.
- **Laden:**
  - `open(O_RDONLY|O_NOFOLLOW)`, Datei regulär, `nlink === 1`, Modus `& 0o077 === 0`, kanonisch.
  - `serverId`/`namespace` gleich der Konfiguration, sonst 500 (Server startet nicht).
  - Jeder Eintrag wird geprüft: `id === deviceId(noiseKey)`, `signingKeyOf(signingKey)`, Name passt auf `DEVICE_NAME`, `enrolledAt` sichere Ganzzahl ≥ 0, `revokedAt` `null` oder sichere Ganzzahl ≥ `enrolledAt`.
  - IDs eindeutig, höchstens 64 Einträge, höchstens 16 aktive.
  - Fehlt die Datei (`ENOENT`), ist das Roster leer.
- **Schreiben** (nur persistente Einträge), wie `server-access.mjs:252-260`:
  - Temp `<random>.devices-tmp` mit `wx` und `0o600`, schreiben, `fsync`, `fault('beforeDevicesRename')`, `rename`, `fault('afterDevicesRename')`, Verzeichnis-`fsync`.
  - Der RAM-Zustand wird erst danach übernommen. Scheitert etwas nach dem `rename`, ist der Ausgang ungewiss (`uncertain`); danach wirft `assertHealthy` 503.
  - Schreibvorgänge laufen nacheinander (Promise-Kette, kein 409).
- **`enroll`:**
  - `document` muss `[body, signature]` sein. `body` ist ein Array mit 7 Elementen; `JSON.stringify(body) === enrollmentBody(...body.slice(1))`. Dann `body[0] === DEVICE_ENROLLMENT`, `body[1] === serverId`, `body[2] === namespace` und `body[3] === deviceId(body[5])` (sonst 400).
  - `verify(null, Buffer.from(JSON.stringify(body)), signingKeyOf(body[4]), base64(signature, 64))`, sonst 401.
  - **Gleiche ID, gleiche beiden Schlüssel, gleiches `ephemeral`:** idempotent. `name` wird übernommen, `revokedAt = null` (Wiedereinschreibung hebt einen Widerruf auf). Persistiert nur bei einer Änderung, `created: false`.
  - **Gleiche ID mit anderem Schlüssel oder anderem `ephemeral`:** 409, auch wenn der Eintrag widerrufen ist (E9).
  - **Neu, persistent:**
    - Bei 16 aktiven persistenten Einträgen gibt es 429.
    - Bei 64 Einträgen fällt der widerrufene Eintrag mit dem ältesten `revokedAt` im selben Schreibvorgang weg. Gibt es keinen widerrufenen Eintrag, kommt 429.
  - **Neu, temporär** (nur RAM, `lastSession = now`):
    - Abgelaufen ist ein temporärer Eintrag nach `now − lastSession ≥ 12 h`; er wird bei jedem Zugriff entfernt.
    - Bei 8 temporären Einträgen wird der mit der ältesten `lastSession` verdrängt, der laut `hasSession(id)` keine aktive Sitzung hat. Gibt es keinen solchen, kommt 429 (B9). `hasSession` ist ein Callback, den `createSyncServer` nach dem Anlegen von `accountAuth` setzt.
- **`revoke`:**
  - Persistent: `revokedAt = now` und Schreiben. Ist der Eintrag schon widerrufen, idempotent ohne Schreiben.
  - Temporär: entfernen.
- Keine Protokollierung.

### 2.4 `scripts/sync-prototype/account-auth.mjs` (T1)

```js
export function accountAuth(account, clock = Date.now, limits = DEFAULT_LIMITS, roster = null)
auth.verifyPassword(body, source)   // body = { username, password }; Prüfung, Backoff, globales Fehlerbudget, Single-Flight und scrypt wie login(); → true oder wirft 401/429/400
auth.openSession(deviceId)          // → { token, expiresAt }; setzt sessions.set(digest, { created, expiresAt, device })
auth.authorize(header)              // wie heute + roster.isActive(session.device), sonst Sitzung löschen und 401
auth.isActive(key)                  // Sitzung vorhanden und roster.isActive(session.device)
auth.deviceOf(key)                  // Geräte-ID der Sitzung oder undefined
auth.hasSession(deviceId)           // mindestens eine nicht abgelaufene Sitzung
auth.dropDevice(deviceId)           // alle Sitzungen des Geräts löschen
auth.fail(source)                   // unverändert
// refresh, logout unverändert; login() entfällt
```
- `roster === null` ist erlaubt (Prüfaufruf in `server/main.mjs:34`). Dann werfen `openSession`/`authorize` 500.
- Sitzungen (K1): höchstens 4 je Gerät, beim fünften `openSession` fällt die älteste des Geräts weg. Global höchstens 64, sonst 429.

### 2.5 `scripts/sync-prototype/server.mjs` (T1)

Budgets (pro Quelle zuerst, vor dem globalen Zähler wie `:86-88`):
- `GET /v1/challenge` → `challenge:<source>` mit `limits.challenge`.
- `POST /v1/devices` → `enroll:<source>` mit `limits.login`.
- `POST /v1/session` → `session:<source>` mit `limits.session`.
- `rate-limit.mjs` `DEFAULT_LIMITS` ergänzt `challenge: 30, session: 20, deviceWrites: 60`.

Routen im Login-Modus, vor der Objektprüfung `:124-129`:
- `GET /v1/info`: `authentication: login ? 'enrolled-device' : 'device'`, `deviceSessions: Boolean(login)`, `objectFormat: login ? 'sync-object' : 'device-snapshot'`. Sonst unverändert.
- `GET /v1/challenge` (beide Modi, Body leer, kein Token nötig):
  - Abgelaufene Nonces entfernen. Höchstens 128 global und 8 je Quelle offen, sonst 429.
  - `nonces.set(nonce, { since: now, source })`.
  - Der alte Gerätemodus nutzt dieselbe Map; `:136-137` liest `since` aus dem Objekt.
- `POST /v1/devices`:
  - `content-type: application/json`, Länge 1–16384, kanonisches JSON.
  - Schlüssel genau `username,password,enrollment` plus optional `ephemeral` (boolesch).
  - Ein Formfehler zählt `login.fail(source)` und ergibt 400.
  - Danach `roster.assertHealthy()` → strukturelle Dokumentprüfung (400) → `login.verifyPassword({ username, password }, source)` → `roster.enroll(...)`.
  - Antwort `201`/`200 { device: { id, name, enrolledAt, ephemeral } }`, ohne Token.
- `GET /v1/devices` (Token): `{ devices: roster.list().map(d => ({ ...d, self: d.id === login.deviceOf(key) })) }`.
- `POST /v1/session`:
  - JSON höchstens 4096 Byte, Schlüssel genau `device,nonce,signature`.
  - **Zuerst** die Nonce nachschlagen und **immer** löschen, auch wenn danach etwas scheitert. Dann `now − since < 30000`, Gerät hex64, `key = roster.signingKeyOf(device)`, `roster.isActive(device)`, `verify(null, Buffer.from(sessionProof(serverId, namespace, nonce, device)), key, base64(signature, 64))`.
  - Jeder Fehlschlag: `login.fail(source)` und 401 (Formfehler 400).
  - Erfolg: `roster.touch(device)`, `200 { ...login.openSession(device), device }`.
- `DELETE /v1/devices/<hex64>`:
  - Token und `content-length` 0 oder fehlend.
  - Header `x-shellherd-device === login.deviceOf(key)`, `x-shellherd-nonce` (einmalig, sofort gelöscht, < 30 s), `x-shellherd-signature` (base64, 64 Byte).
  - Verifiziert wird über `requestProofV2(serverId, namespace, 'DELETE', path, nonce, device)` mit `path === request.url`, gegen `roster.signingKeyOf(device)`. Jeder Fehler ergibt 401.
  - Danach nochmals `login.authorize(header) === key`, dann `roster.assertHealthy()`, dann `await roster.revoke(id)`, `login.dropDevice(id)`, `broker?.dropDevice(id)`. Antwort `200 { revoked: true }`.
- `/v1/login` gibt es nicht mehr; der Pfad endet in der Objektprüfung mit 404.
- Objekte:
  - `PUT` und `DELETE` zusätzlich `budget('device:' + login.deviceOf(authorized), limits.deviceWrites)` nach der Autorisierung.
  - `opaque(body)` beim `PUT` im Login-Modus: `validateSyncObject`.
  - `readObject` beim Start und bei `GET`: `validateSyncObject || isLegacyVaultObject` (B4).
- Start: `devices.json` und `*.devices-tmp` neben `access.json` tolerieren (`:66-67`). `roster = login ? await createDeviceRoster(...) : null`, danach `roster.hasSession = id => login.hasSession(id)`.
- Keine Konsolenausgabe von Namen, Schlüsseln, Nonces, Tokens.
- `server/Dockerfile:9` ergänzt `device-proof.mjs device-roster.mjs sync-object-wire.mjs` (B1).

### 2.6 `scripts/sync-prototype/rendezvous.mjs` (T1)

`createRendezvous({ authorize, isActive, deviceOf, noiseKeyOf, clock, serverId })`:
- `PUT /devices` nach der bestehenden Besitzprüfung `:80`:
  - `fail(key === deviceOf(owner), 403)` und `fail(body.publicKey === noiseKeyOf(key), 403)`.
  - Übernahme (K3): `fail(!previous || previous.owner === owner || deviceOf(previous.owner) === key, 409)`. Dasselbe Gerät darf mit einer neuen Sitzung seine eigene Präsenz ersetzen.
- Neu `dropDevice(id)`: `devices.delete(id)`; Sitzungen mit `from === id || to === id` löschen.
- Alles Übrige bleibt unverändert, auch der Besitznachweis und die Noise-Frames aus H2.

### 2.7 `scripts/sync-prototype/account-transport.mjs`, `http-common.mjs` (T2)

```js
export class AccountStore {
  constructor(info, { signal } = {})   // URL-Prüfung wie heute; info.authentication === 'enrolled-device' && info.deviceSessions === true && namespace/serverId gültig
  async enroll(identity, { username, password, name, ephemeral })  // → { id, name, enrolledAt, ephemeral }; setzt kein Token
  async openSession(identity)          // → { signedIn: true, expiresAt, device }; ersetzt ein vorhandenes Token
  async devices()                      // → geprüfte Liste (s. u.)
  async revoke(identity, id)           // → { revoked: true }
  // request, list, put, get, remove, refresh, logout, close wie heute; put: validateSyncObject; get: validateSyncObject || isLegacyVaultObject (B4)
}
```
- `enroll`:
  - `body = enrollmentBody(info.serverId, info.namespace, identity.id, identity.signingPublicKey, identity.publicKey, name)`.
  - `enrollment = [JSON.parse(body), sign(null, Buffer.from(body), identity.signingKey).toString('base64')]`.
  - `POST v1/devices`, Body genau `{ username, password, enrollment, ephemeral }`.
  - Prüft `device.id === identity.id`.
- `openSession`: `GET v1/challenge` (ohne Token), `nonce` hex64 → `sign(sessionProof(...))` → `POST v1/session { device, nonce, signature }`. Die Antwort braucht `token` hex64, `expiresAt` sichere Ganzzahl und `device === identity.id`.
- `revoke`: `check(hex64(id))`, Challenge, Header `x-shellherd-device: identity.id`, `x-shellherd-nonce`, `x-shellherd-signature` über `requestProofV2(serverId, namespace, 'DELETE', '/v1/devices/' + id, nonce, identity.id)`, dazu `authorization`. Die Antwort braucht `revoked === true`.
- `devices` prüft und gibt zurück:
  - `devices` ist ein Array mit höchstens 64 Einträgen und genau den Schlüsseln `id,name,signingKey,enrolledAt,revokedAt,ephemeral,self`.
  - `id` hex64 und eindeutig, Name passt auf `DEVICE_NAME`, `signingKeyOf(signingKey)` wirft nicht (K5).
  - `enrolledAt` ist eine sichere Ganzzahl, `revokedAt` `null` oder eine sichere Ganzzahl, `ephemeral` boolesch.
  - Zurück gibt es die Einträge ohne `self` (B3).
- `probeSyncServer`: `authentication: ['password','device','enrolled-device'].includes(info.authentication) ? info.authentication : 'device'`, zusätzlich `deviceSessions: info.deviceSessions === true`.

### 2.8 `src/main/remote/identity.ts` (T4)

```ts
export interface RemoteIdentity { privateKey: KeyObject; publicKey: string; id: string; signingKey: KeyObject; signingPublicKey: string }
export interface Enrollment { serverId: string; namespace: string; serverUrl: string; username: string; name: string; enrolledAt: number }
export class RemoteIdentityStore {
  constructor(file: string, cipher: IdentityCipher)
  load(): { identity: RemoteIdentity; persistent: boolean }
  enrollment(serverId: string): Enrollment | undefined
  rememberEnrollment(e: Enrollment): void   // ersetzt gleiche serverId; ≤ 16 (älteste enrolledAt fällt weg); persistiert nur bei persistenter Identität, sonst RAM; Schreibfehler → RAM behalten
  forgetEnrollment(serverId: string): void
  known/renamed/remember: unverändert
}
export function deviceFingerprint(spkiBase64: string): string // sha256 hex der DER; wirft wie rendezvous.mjs deviceId()
export function generateRemoteIdentity(): RemoteIdentity       // generateKeyPairSync('x25519') + ('ed25519')
```
- **Datei v3:**
  - `{ version: 3, identity, knownDevices, enrollments, mac }`.
  - `identity = cipher.encrypt(Buffer.from(JSON.stringify(['shellherd-device-identity-v3', b64(pkcs8 X25519), b64(pkcs8 Ed25519), b64(macKey)]))).toString('base64')`.
  - PKCS8-Präfixe werden beim Laden geprüft: X25519 `302e020100300506032b656e04220420`, Ed25519 `302e020100300506032b657004220420`, je 48 Byte. `macKey` hat 32 Byte.
  - `mac = HMAC(macKey, JSON.stringify(['shellherd-remote-identity-v3', identity, devices-Tupel wie heute, enrollments.map(e => [e.serverId, e.namespace, e.serverUrl, e.username, e.name, e.enrolledAt])]))`.
- **Migration v2 → v3:** v2-MAC wie heute prüfen, X25519 und `macKey` behalten, Ed25519 erzeugen, `enrollments: []`, ein atomarer Schreibvorgang. **Scheitert er, wirft `load()` den Fehler `identity`** (K9). Die v2-Datei bleibt unverändert, kein RAM-Ersatz. Grund: Ein nur im RAM erzeugter Ed25519-Schlüssel würde nach der Einschreibung beim nächsten Start ersetzt, und die Wiedereinschreibung scheiterte dauerhaft mit 409.
- v1 → v3 über die v1-Regeln (Pins unbestätigt), dann ein v3-Schreibvorgang; ein Fehler wirft ebenfalls `identity`.
- Nicht persistente Identität (keine Schlüsselablage): beide Schlüssel und `enrollments` nur im RAM.
- `zod`-Schemas für v3: Für `enrollments` (höchstens 16) gelten `serverId` hex64, `namespace` ascii, `serverUrl` mit höchstens 2048 Zeichen, `username` `/^[a-zA-Z0-9_.-]{1,64}$/`, `name` mit höchstens 80 Zeichen, `enrolledAt` endlich.
- Der Konstruktoraufruf in `remote/lab-ipc.ts:95-101` wird in T4 auf zwei Argumente umgestellt; der dynamische Import von `rendezvous.mjs` wird dort nicht mehr für die Identität gebraucht.

### 2.9 Sync-Kern (T3)

#### 2.9.1 `vault-sync-crypto.ts`

```ts
export interface SyncDevice { id: string; sign(data: Buffer): Buffer; keyOf(id: string): KeyObject | undefined; revokedAt(id: string): number | null | undefined }
export interface SyncContext { serverId: string; namespace: string; device?: SyncDevice }
export class SyncFailure extends Error { code: 'locked'|'changed'|'history'|'conflict'|'bindings'|'wrongVault'|'recovery'|'limit'|'syncKey'|'recoveryCode'|'migrate' }
export const SYNC_OBJECT_FORMAT = 'shellherd-sync-object';
export function generateRecoveryCode(): string                         // randomBytes(16).toString('hex')
export function parseSyncEnvelope(wire: string): { kind: 'version' | 'keybox' } | null // TS-Spiegel von validateSyncObject; null für alles andere (auch Altformat)
export function versionKey(syncKey: Buffer, context: SyncContext): Buffer   // HKDF(syncKey, utf8(JSON.stringify([serverId, namespace])), 'shellherd-sync-version-v2', 32)
export function keyboxWrapKey(code: string, context: SyncContext): Buffer   // normalizeRecoveryCode → 16 Byte → HKDF(…, salt wie oben, 'shellherd-sync-keybox-recovery-v1', 32); ungültig → SyncFailure('recoveryCode')
export function sealSyncObject(kind: 'version' | 'keybox', document: unknown, key: Buffer, context: SyncContext): string
export function openSyncObject(wire: string, kind: 'version' | 'keybox', key: Buffer, context: SyncContext): unknown // SyncFailure('wrongVault'), 'limit' bei Übergröße
// unverändert exportiert (session.ts:3 importiert sie): hashWire, ensure, stable; dazu samePortable, validateKdf, encryptedFile, keyFromPassword, sealDocument/openDocument (nur noch für den Checkpoint)
```
- AAD der Objekte: `Buffer.from(stable([SYNC_OBJECT_FORMAT, 1, kind, context.serverId, context.namespace]))`. Klartext höchstens 768 KiB, Wire höchstens 1 MiB, Nonce mit 12 zufälligen Byte, Schlüssel nach Gebrauch `fill(0)`.
- Checkpoint-AAD (B7): `stable(['shellherd-vault-sync', 1, 'state', { serverId: context.serverId, namespace: context.namespace }, kdf])`.
- Die Hilfsfunktionen für den Code liegen rein in `src/shared/recovery-code.ts` (T3, neu, ohne `node:*`, K14):
  ```ts
  export const RECOVERY_CODE_HEX = 32; export const RECOVERY_CODE_INPUT_MAX = 64;
  export function normalizeRecoveryCode(input: string): string | null // entfernt Leerraum und '-', klein; genau 32 hex sonst null; andere Zeichen → null
  export function formatRecoveryCode(code: string): string             // 8 Gruppen à 4, '-' getrennt; wirft bei ungültigem Code
  ```

#### 2.9.2 Formen

- Version (Klartext): `{ kind: 'shellherd-sync-version-v2', parents, portable, compacts?, author?: { device, at, signature } }` (`zod` strict). `device` ist hex64, `at` eine sichere Ganzzahl ≥ 0, `signature` kanonisches base64 mit 64 Byte.
- Autorensignatur über `Buffer.from(JSON.stringify(['shellherd-sync-author-v1', serverId, namespace, parents, compacts ?? [], sha256hex(stable(portable)), device, at]))`. `parents` steht sortiert wie im Dokument, `compacts` in Dokumentreihenfolge.
  - Beim Erzeugen: `portable` = das validierte Objekt, das serialisiert wird.
  - Beim Prüfen: das entschlüsselte `raw.portable` vor `validatePortableVault`.
  - `create()` stempelt nur mit `context.device`: `device = context.device.id`, `at = Date.now()`.
- Keybox (Klartext): `{ kind: 'shellherd-sync-keybox-v1', method: 'recovery', syncKey: b64(32), createdBy: hex64 | null }`, strict.
- Checkpoint außen `['shellherd-private-sync-state-v2', <terminus-encrypted-vault>]`. Innen `{ kind: 'shellherd-sync-state-v2', syncKey: b64(32), keybox?: hex64, versions, acked, localHeads, working, projection, pending? }`. `syncKey` ist Pflicht; ein v2-Checkpoint ohne Schlüssel wird nie geschrieben. Außen `…-v1` → `SyncFailure('migrate')` vor jeder Entschlüsselung.
- `StateFile` ergänzt `remove(): Promise<void>`: dieselbe Hash-Prüfung wie `write`, dann `unlink` und Verzeichnis-`fsync`. Gebraucht wird es nur beim Bootstrap-Abbruch.

#### 2.9.3 `synchronizeVault(sessions, remote, context, signal, options: { keepLocalRevision?: string; recoveryCode?: string } = {})`

1. Lease und Checkpoint-Lock wie heute, `raw = checkpoint.read()` (v1 → `migrate`).
2. `listing` laden. Jedes Objekt, das nicht schon im Checkpoint steht, mit `get` holen (`hashWire` prüfen) und nach `parseSyncEnvelope` in Keyboxen `K`, Versionen `V` und Fremdes trennen. Die Wires werden für Schritt 5 behalten, damit nichts doppelt geladen wird.
3. Ohne Checkpoint (B5):
   - **Mit `options.recoveryCode`:** Höchstens 8 Keyboxen in sortierter ID-Reihenfolge mit `keyboxWrapKey` öffnen. Ein Treffer liefert `syncKey`, sonst `SyncFailure('recoveryCode')`.
   - **Ohne Code, `K` leer und `V` leer → Bootstrap:**
     - `syncKey = randomBytes(32)`, `code = generateRecoveryCode()`, `kb = sealSyncObject('keybox', …)`.
     - Checkpoint schreiben mit `{ syncKey, keybox: hashWire(kb), versions: [], acked: [], localHeads: [], working: local, projection: local }`, dann `put(kb)`.
     - **Bestätigung:** neues Listing. Liegt dort eine andere Keybox als `hashWire(kb)` oder ein Objekt mit Hülle `version`, folgt der Abbruch: `remove(kb-id)` mit Fehlern ignoriert, `checkpoint.remove()`, `syncKey.fill(0)`, `SyncFailure('syncKey')`.
     - Sonst `keybox` löschen, persistieren, `result.recoveryCode = code`.
   - **Ohne Code, sonst:** `SyncFailure('syncKey')`. Das gilt auch für „Versionen ohne Keybox“; mit Code gibt es dann `recoveryCode`.
4. Mit Checkpoint und gesetztem `keybox` (Absturz im Bootstrap, Code nie gezeigt): neuer Code und neue Keybox. Erst `keybox` auf die neue ID setzen und persistieren, dann `remove(alte ID)` (404 und Fehler ignoriert), dann `put(neu)`. Die Bestätigung läuft wie in Schritt 3; die alte ID gilt dabei nicht als fremd. `result.recoveryCode` ist der neue Code. Ein Code in `options` wird bei vorhandenem `syncKey` ignoriert.
5. `key = versionKey(syncKey)`. Danach folgt der H2-Ablauf (`pull`, Merge, Upload, Commit, Reparatur, Kompaktierung nach H2-Validierung §2.6) mit diesen Änderungen:
   - `tryAdd` öffnet nur Hüllen `version`.
   - Keyboxen sind nie `foreign`, nie Version und nie in `acked`.
   - Altformat und Unlesbares sind `foreign` wie heute.
   - `create()` signiert (§2.9.2).
   - Die Quarantäne läuft nach §2.9.4.
   - `recoveryCode` steht auch bei `conflict`/`bindings` im Ergebnis.
6. Ergebnis ergänzt `recoveryCode?`, `unknownAuthors?` und `quarantined?` (nur gesetzt, wenn > 0).

#### 2.9.4 Autorenprüfung und Quarantäne (B2, E1)

Gilt nur mit `context.device`. Ohne Gerät gibt es keine Prüfung und keine Zähler. Versionen aus dem Checkpoint (`validateState`) werden nie geprüft.

`Graph` ergänzt `held: Map<string, Version>` (zurückgehalten, nicht in `values`/`wires`, nie im Checkpoint), `get compactedAll()` = Vereinigung der `compacts` über `values` **und** `held`. `compacted` (vertrauenswürdig) bleibt die Vereinigung über `values`.

`pull`:
1. Alle neuen Objekte mit `tryAdd` laden (wie heute, ohne Prüfung).
2. Jede **neu geladene** Version `v` einstufen:
   - `author` fehlt oder `keyOf(author.device) === undefined` → `unknown`.
   - Signatur ungültig → `suspect`.
   - `r = revokedAt(author.device)`. Gilt `typeof r === 'number' && author.at >= r` → `suspect`.
   - Sonst `ok`.
3. `anchors` = Versionen im Graph vor `pull`, dazu `acked`, dazu neu geladene `ok`/`unknown`. `accepted` = `anchors` und alle Vorfahren über `parents`, auch über `suspect`-Knoten.
4. Jede `suspect`-Version außerhalb von `accepted` wandert nach `held` und wird aus `values` entfernt.
   - `quarantined = held.size`.
   - `unknownAuthors` = Anzahl neu geladener, angenommener `unknown`.
5. Zombies (H2) nur über `compacted`.
6. `history`-Prüfung `acked \ listing ⊆ compactedAll`. `validate()` erlaubt fehlende Parents, wenn `compactedAll` sie enthält.
7. `stale = listing ∩ compacted`, also ohne `held`. Löschungen entstehen nie aus einer zurückgehaltenen Version.

`heads()`, `base()` und `prune()` sehen `held` nicht. Zurückgehaltene Objekte bleiben auf dem Server. „Fremde Objekte entfernen“ und die Kompaktierung löschen sie nicht (E8). `importSyncedVault` nutzt dasselbe `pull` mit leerem Checkpoint und `acked = []`. Ohne angenommene Version folgt `history`.

#### 2.9.5 `importSyncedVault(sessions, remote, context, recoveryCode, newPassword, signal, selectPath)`

- `check` wie heute (Vault gesperrt).
- `normalizeRecoveryCode(recoveryCode)`; `null` → `SyncFailure('recoveryCode')`.
- `newPassword` mit 1–1024 Zeichen, sonst `wrongVault`.
- Listing, Keyboxen öffnen (höchstens 8) → `syncKey`, sonst `recoveryCode`.
- Graph mit `versionKey`, `pull` (§2.9.4), `heads().length === 1`, sonst `conflict`. `materializeVault`, `selectPath`, Reservierung wie heute.
- **Schlüssel (K11):**
  - `kdf = { algorithm: 'argon2id', salt: randomBytes(16).toString('base64'), memoryKiB: 65536, iterations: 3, parallelism: 1 }`, `key = await keyFromPassword(newPassword, kdf)`.
  - Nicht `encryptVault`: Das nullt den Schlüssel, bevor `openWithKey` ihn braucht.
- Checkpoint v2 mit `syncKey` unter `key`/`kdf`, dann `encryptVaultWithKey(vault, key, kdf)`, `writeEncryptedVaultFile`, `sessions.openWithKey(path, encrypted, Buffer.from(key))`. Im `finally` werden `key` und `syncKey` genullt.

#### 2.9.6 `regenerateRecoveryCode(sessions, remote, context, signal)` → `{ recoveryCode: string }`

- Wie `removeForeignObjects`: Lease, `ensure(remote.remove, 'limit')`, Checkpoint-Lock und Lesen. Ohne Checkpoint → `syncKey`.
- Neuen Code erzeugen, Keybox hochladen, Listing, jede andere Keybox mit `remove` löschen.
- Wirft dabei ein `remove` (außer 404 = `false`), wird der Fehler weitergeworfen, und der Code wird **nicht** zurückgegeben (K12). Die neue Keybox bleibt; ein erneuter Klick erzeugt eine weitere und räumt alle anderen ab.
- Der Checkpoint bleibt unverändert, außer dass ein gesetztes `keybox` gelöscht wird.

#### 2.9.7 `removeForeignObjects`

Checkpoint-Lock und Lesen für `syncKey` (ohne Checkpoint → `syncKey`). Lesbar ist eine Hülle `keybox` (immer behalten) oder eine Hülle `version`, die unter `versionKey` öffnet. Gelöscht wird nur Unlesbares, auch das Altformat.

### 2.10 `src/shared/sync-lab.ts`, `remote-lab.ts` (T5, Welle 2)

```ts
// sync-lab.ts (Ergänzungen)
| { kind: 'signIn'; username: string; password: string; deviceName: string }
| { kind: 'openSession' } | { kind: 'listDevices' } | { kind: 'revokeDevice'; id: string } | { kind: 'regenerateCode' }
| { kind: 'synchronize'; recoveryCode?: string }
| { kind: 'importVault'; recoveryCode: string; password: string }
server?: { serverUrl: string; serverId: string; namespace: string; enrollmentAvailable?: boolean; authentication?: 'password' | 'device' | 'enrolled-device'; deviceSessions?: boolean }
account?: { signedIn: true; username: string; device: { fingerprint: string; name: string; persistent: boolean } }
enrolled?: { username: string; name: string }
enrolledElsewhere?: string                       // alte serverUrl bei gleicher serverId (K10)
identity?: { fingerprint: string; persistent: boolean }
devices?: { id: string; name: string; enrolledAt: number; revokedAt: number | null; ephemeral: boolean; self: boolean }[]
sync?: { …wie heute…; unknownAuthors?: number; quarantined?: number }
export type SyncLabErrorCode = 'unavailable' | 'invalid' | 'stale' | 'mismatch' | 'expired' | 'failed' | 'connection' | 'authentication' | 'identity' | 'limit'
  | 'syncLocked' | 'syncChanged' | 'syncHistory' | 'syncWrongVault' | 'syncRecovery' | 'syncLimit' | 'syncConflict' | 'syncBindings'
  | 'syncKey' | 'syncRecoveryCode' | 'syncMigrate' | 'samePassword' | 'samePasswordImport';
export type SyncLabReply = { ok: true; state: SyncLabState; vaultChanged?: …; recoveryCode?: string } | { ok: false; code: SyncLabErrorCode; state?: SyncLabState };
// remote-lab.ts
| { kind: 'signIn'; username: string; password: string; deviceName: string } | { kind: 'openSession' }
RemoteLabState: account?: { username: string; validUntil: number; deviceName: string }; enrolled?: { username: string; name: string }; enrolledElsewhere?: string
// identity?: wie heute, aber ab connect gesetzt (K20)
```
Das Feld `recoveryCode` gibt es nur in `SyncLabReply` (ok) und nie in `SyncLabState`.

### 2.11 Sync-Host und Sync-IPC

**Welle-1-Teil (T3, mechanisch, sonst nichts):**
- `lab-host.ts:18`: `SyncVaultRequest` = `{ kind: 'synchronize'; recoveryCode?: string } | { kind: 'keepLocal'; reviewed: true; revision: string } | { kind: 'importVault'; password: string; recoveryCode?: string } | { kind: 'removeForeign'; ids: string[] }`.
- `lab-ipc.ts:206-212`: `importSyncedVault(sessions, vaultRemote, info, request.recoveryCode ?? '', request.password, signal, …)` und `synchronizeVault(…, signal, { keepLocalRevision: request.kind === 'keepLocal' ? request.revision : undefined, recoveryCode: request.kind === 'synchronize' ? request.recoveryCode : undefined })`.

**Welle 2 (T7):**
```ts
export interface DeviceEntry { id: string; name: string; signingKey: string; enrolledAt: number; revokedAt: number | null; ephemeral: boolean }
export interface AccountDriver {
  enroll(identity: RemoteIdentity, input: { username: string; password: string; name: string; ephemeral: boolean }): Promise<unknown>;
  openSession(identity: RemoteIdentity): Promise<{ signedIn: true; expiresAt: number; device: string }>;
  devices(): Promise<DeviceEntry[]>; revoke(identity: RemoteIdentity, id: string): Promise<unknown>;
  list(): Promise<unknown>; get?(id: string): Promise<string>; put?(wire: string): Promise<string>; remove?(id: string): Promise<boolean>; close(): void;
}
export type SyncVaultRequest = { kind: 'synchronize'; recoveryCode?: string } | { kind: 'keepLocal'; reviewed: true; revision: string }
  | { kind: 'importVault'; password: string; recoveryCode: string } | { kind: 'removeForeign'; ids: string[] } | { kind: 'regenerateCode' };
export type SyncVaultOutcome = VaultSyncResult | { removedForeign: number } | { recoveryCode: string };
constructor(createDriver?, probe?, createEnrollment?, createAccount?,
  syncVault?: (account: AccountDriver, info: ServerInfo, signal: AbortSignal, request: SyncVaultRequest, device: SyncDevice | undefined) => Promise<SyncVaultOutcome | undefined>,
  matchesVaultPassword?, identity?: () => RemoteIdentityStore)
// neue Methoden: openSession(owner, raw), devices(owner, raw) (listDevices | revokeDevice)
```
- **`connect`:**
  - Nach der Probe wird verlangt: `info.authentication === 'enrolled-device' && info.deviceSessions === true`, sonst `unavailable`.
  - `identity().load()`; ein Fehler ergibt `identity`, und die Verbindung wird verworfen.
  - `e = store.enrollment(info.serverId)`. Gilt `e.serverUrl === info.serverUrl && e.namespace === info.namespace`, wird `enrolled = { username, name }` gesetzt. Hat `e` eine andere URL, wird `enrolledElsewhere = e.serverUrl` gesetzt und **kein** `enrolled` (K10).
  - Der Zustand trägt `identity`.
- **`signIn`** (`deviceName` passt auf `DEVICE_NAME`, sonst `invalid`):
  - M3-Prüfung wie heute.
  - `enroll(identity, { username, password, name: deviceName, ephemeral: !persistent })` → `openSession` → `store.rememberEnrollment({ serverId, namespace, serverUrl: info.serverUrl, username, name: deviceName, enrolledAt: Date.now() })` (immer; der Store hält es bei temporärer Identität im RAM) → Digest (E3 H2) → `account.list()` → Geräteliste laden.
  - Danach `enrolledElsewhere` löschen.
  - Fehler: 401 → `authentication`, 429 → `limit`, sonst `connection`.
- **`openSession`:** Nur mit `enrolled`, nicht `busy`, ohne Sitzung. `account = createAccount(...)`, dann `openSession(identity)`. Bei 401 einmal neu versuchen, mit frischer Challenge über einen neuen `openSession`-Aufruf. Ein zweites 401 → `forgetEnrollment(serverId)`, `enrolled` löschen, Code `authentication` (B6). Bei Erfolg: `account.list()`, Geräteliste, `signedIn`.
- **Vor jeder Serveraktion** (`performSync`, `devices`): Gilt `Date.now() >= expiresAt - 60000`, erst `openSession` (B6).
- **401 aus einer Serveraktion:** `account.close()`, `signedIn`/`account` löschen, `enrolled` bleibt, Code `authentication`.
- **`SyncDevice` je Aufruf von `syncVault`** aus dem Host:
  - `{ id: identity.id, sign: data => sign(null, data, identity.signingKey), keyOf, revokedAt }`.
  - `keyOf`/`revokedAt` kommen aus einer **frisch** vor dem Aufruf geladenen Geräteliste (`account.devices()`). Die Schlüssel entstehen per `createPublicKey({ key: ed25519Spki(raw), format: 'der', type: 'spki' })` und sind nur im Main.
  - Fehlt der eigene Eintrag in der Liste, oder trägt er einen anderen `signingKey`, endet die Aktion mit `connection` (B3).
  - Nicht für `removeForeign`.
- **Ergebnisse:**
  - `const { snapshot: _s, foreign, recoveryCode, ...summary } = result; current.sync = summary;`.
  - Die Antwort trägt `recoveryCode` auf oberster Ebene, `current` nie (K13).
  - Für `regenerateCode` ist die Antwort `{ ok: true, state, recoveryCode }`, und `current.sync` bleibt unverändert.
- **Code-Map** ergänzt `syncKey: 'syncKey'`, `recoveryCode: 'syncRecoveryCode'`, `migrate: 'syncMigrate'`. HTTP 429 → `limit`.
- **`importVault`:**
  - `zod`: `recoveryCode: z.string().max(64)`, `password` wie heute.
  - `normalizeRecoveryCode` im Host; `null` → `invalid`.
  - Die M3-Importprüfung gegen den gehaltenen Digest bleibt (E6).
- **`devices`:**
  - `listDevices` → `current.devices` (mit `self` lokal berechnet).
  - `revokeDevice`: `id` ist hex64, sonst `invalid`; `account.revoke(identity, id)`. Bei `id === identity.id` folgt die `close`-Semantik der Verbindung samt `forgetEnrollment`, Antwort `{ ok: true, state: { phase: 'idle' } }`. Sonst wird die Liste neu geladen.
  - 404 → Liste neu laden, `ok`.
- **`lab-ipc.ts`:**
  - `buildSyncLabHost(transport, account, { sessions, identity })`; `registerSyncLabIpc({ sessions, identity, onSynced } = {})`.
  - Dispatch: `performSync` für `synchronize|keepLocal|importVault|removeForeign|regenerateCode`, außerdem `signIn`, `openSession` und `devices` für `listDevices|revokeDevice`.
  - `regenerateCode` ruft `regenerateRecoveryCode`.

### 2.12 Remote-Host, Remote-IPC, `index.ts` (T8)

```ts
export interface RemoteServerInfo { serverUrl: string; serverId: string; namespace: string; authentication: 'password' | 'device' | 'enrolled-device'; deviceSessions: boolean; rendezvous: boolean; rendezvousProof: boolean; rendezvousNoise: boolean }
export interface RemoteAccount {
  enroll(identity: RemoteIdentity, input: { username: string; password: string; name: string; ephemeral: boolean }): Promise<unknown>;
  openSession(identity: RemoteIdentity): Promise<{ signedIn: true; expiresAt: number; device: string }>;
  request(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: string): Promise<unknown>;
  refresh(): Promise<{ expiresAt: number }>; logout(): Promise<void>; close(): void;
}
// requestSchema: signIn + deviceName: z.string().max(1024) (NAME-Prüfung im Host); neu { kind: 'openSession', clientId }.strict()
```
- **`#connect`:**
  - Verlangt `authentication === 'enrolled-device' && deviceSessions && rendezvous && rendezvousProof && rendezvousNoise`, sonst `unavailable`.
  - Lädt die Identität (Fehler → `identity`, die Bindung wird verworfen) und hält sie in `#loaded`.
  - Setzt `enrolled`/`enrolledElsewhere` wie §2.11.
  - `state.identity` ab jetzt immer, solange `#loaded` existiert.
- **`#signIn(username, password, deviceName)`:** wie heute (gesperrter Vault → `locked`, M3), dann `enroll` + `openSession` + `rememberEnrollment` → `signedIn` mit `#user = { username, validUntil: expiresAt, deviceName }`. 429 → `limit`.
- **`#openSession()`:** nur mit `enrolled`. Ablauf wie §2.11 (ein Wiederholungsversuch, zweites 401 → `forgetEnrollment`).
- **`#goOnline(name)`:**
  - Ein leerer Name wird durch den Namen der Einschreibung ersetzt, danach greift die `NAME`-Prüfung.
  - `createPeer(account, #loaded.identity)`; kein zweites `load()`.
- **401 bei Präsenz, Anfrage oder Sitzung:** `#dropAccount()` wie heute. **Kein** `forgetEnrollment` (B6). Der Zustand ist danach `serverReady` mit `enrolled`.
- **`lab-ipc.ts`:** `registerRemoteLabIpc({ isUnlocked, matchesVaultPassword, identity })`; die Store-Erzeugung entfällt dort.
- **`index.ts`** (nur der Block `:264-266`): `const identity = new RemoteIdentityStore(join(app.getPath('userData'), 'remote-identity.json'), safeStorageCipher());`, an beide Register-Funktionen übergeben. Das ist eine Instanz für beide Labs; `load()` cacht.

### 2.13 Renderer (T9)

- **Sync-Lab, Schritt 2** (`stepAuthorize`):
  - Mit `enrolled`: `enrolledHint` und der Knopf „Sitzung öffnen“ (`openSession`).
  - Sonst das Formular mit `username`, `serverPassword`, `deviceName` (`maxLength` 80) und Knopf `enroll`/`enrolling`. Darüber steht `enrolledElsewhere` (mit `{{url}}`), falls gesetzt.
  - `identityTemporary` erscheint bei `identity.persistent === false`.
- **Code-Anzeige:**
  - Eine Antwort mit `recoveryCode` legt ihn in lokalem React-State ab und zeigt `recoveryCodeTitle`, `recoveryCodeNew` und `<code className="sync-lab-code">{formatRecoveryCode(code)}</code>`, dazu den Knopf `recoveryCodeNoted`.
  - Nach dem Klick wird der State gelöscht, der Code ist nicht mehr im DOM.
  - Kein Kopieren-Knopf (E3), keine Speicherung, kein Logging.
  - Schließen des Dialogs löscht den Code ebenfalls.
- **Code-Eingabe:**
  - Bei Fehler `syncKey` oder `syncRecoveryCode`: Feld mit Label `recoveryCodeLabel`, Hinweis `recoveryCodeHint`, `maxLength={RECOVERY_CODE_INPUT_MAX}`, `autoComplete="off"`, `spellCheck={false}`.
  - Absenden nur, wenn `normalizeRecoveryCode` nicht `null` ist. Gesendet wird `{ kind: 'synchronize', recoveryCode }`.
  - Das Feld wird nach dem Senden geleert.
- **Import:** Felder `recoveryCodeLabel`, `newVaultPassword`, `repeatPassword`. Absenden nur bei gültigem Code und gleichen, nicht leeren Passwörtern. Beide Felder werden nach dem Senden geleert. `localVaultHint` (neu) steht darunter.
- **Geräte** (nach Anmeldung):
  - Überschrift `devicesTitle`, Liste in Serverreihenfolge. Je Gerät der Name, dazu `deviceSelf`/`deviceEphemeral`/`deviceRevoked` als Badges.
  - Der Knopf `revokeDevice` (`secondary-button`) fehlt beim eigenen und bei widerrufenen Geräten; darunter `revokeHint`.
  - Wird `enrolledAt` angezeigt, dann nur über `src/shared/format.ts`.
- **Extra:** Knopf `recoveryCodeRegenerate` mit `recoveryCodeRegenerateHint`, nur bei geöffnetem Vault und Sitzung. Ergebniszeilen `unknownAuthors_*`/`quarantined_*` bei Werten > 0.
- **Remote-Lab:** Gerätename im Anmeldeformular (`remoteLab:deviceName`), dazu `enrolledHint` + `openSession` bei `enrolled`, `enrolledElsewhere` und `identityTemporary` schon vor dem Online-Gehen.
- **CSS:**
  - Neu nur `.sync-lab-code` in `sync-lab.css`: `display: block; font-family: var(--font-mono); user-select: text; overflow-wrap: anywhere; padding: var(--space-10); background: var(--color-bg-app); border-radius: var(--radius-sm)`.
  - Sonst bestehende Klassen; keine Inline-Styles, keine Bewegung, keine neuen Tokens.

---

## 3. Korrekturen (bindend)

- **K1** Sitzungen: höchstens 4 je Gerät (die älteste fällt weg), global 64 statt 32 (`account-auth.mjs:297`). Sync-Lab und Fernzugriff öffnen je eigene Sitzungen; mit 16 Geräten wäre 32 sonst zu knapp, und ein einzelnes Gerät könnte die Tabelle füllen.
- **K2** Nonces sind eine nicht authentifizierte Ressource: höchstens 8 offen je Quelle, 128 global, eigenes Budget `challenge` 30/min. `session` bekommt ein eigenes Budget von 20/min statt der 5 von `login`: Die Prüfung ist eine billige Ed25519-Verifikation, und zwei Labs auf einem Rechner plus zwei Szeneninstanzen teilen sich eine Quelle. Fehlschläge zählen weiter über `login.fail`.
- **K3** Die Rendezvous-Präsenz darf vom selben Gerät mit neuem Token übernommen werden (§2.6). `login.isActive(key)` prüft das Roster mit, so dass `expire()` im Broker widerrufene Geräte sofort entfernt.
- **K4** Roster-Grenzen: Bei 64 Einträgen fällt der älteste widerrufene Eintrag weg (seine Versionen gelten danach als `unknown`). Temporäre Einträge werden bei 8 verdrängt (§2.3, B9).
- **K5** Schwache Ed25519-Schlüssel: `signingKeyOf` (Server-Roster, Client-Geräteliste) verlangt, dass `verify(null, Buffer.from('shellherd-weak-key-probe'), key, Buffer.concat([Buffer.from([1]), Buffer.alloc(63)]))` `false` ergibt. Der Identitätspunkt wird damit abgewiesen (selbst geprüft, siehe Kopf). Andere Punkte kleiner Ordnung bleiben als Restrisiko (§7).
- **K6** Das Rosterformat, die Ladeprüfung und die serialisierten Schreibvorgänge stehen in §2.3. Ohne sie würden Umsetzer Format und Fehlerverhalten erraten.
- **K7** Einschreibe-Reihenfolge: zuerst die Strukturprüfung (billig, 400), dann das Passwort, dann die Dokumentsignatur und das Roster. Idempotenz, Namensänderung und Wiederaufnahme stehen in §2.3. `DELETE /v1/devices/:id` auf ein schon widerrufenes Gerät antwortet 200 ohne Schreiben.
- **K8** `accountAuth(account)` ohne Roster bleibt für `replaceAccount` (`server/main.mjs:34`) gültig.
- **K9** Identitätsmigration fail-closed (§2.8). `rememberEnrollment` wird auch bei temporärer Identität aufgerufen (der Store hält es im RAM). Damit entfällt der Widerspruch zwischen Spec §4.8 und T7.
- **K10** Relay-Schutz:
  - Der Client signiert einen Sitzungs- oder Widerrufsnachweis nur, wenn die Einschreibung für `serverId` dieselbe `serverUrl` und denselben `namespace` hat.
  - Eine abweichende URL für dieselbe `serverId` ergibt `enrolledElsewhere` statt `enrolled`; eine neue Einschreibung dort ersetzt den Pin erst nach dem sichtbaren Hinweis (E10).
  - `rememberEnrollment` wird nur nach erfolgreicher Einschreibung **und** Sitzung aufgerufen.
- **K11** Beim Import werden Schlüssel und KDF nach §2.9.5 abgeleitet; `encryptVault` passt nicht, weil es den Schlüssel nullt.
- **K12** `removeForeignObjects` und `regenerateRecoveryCode` lesen `syncKey` aus dem Checkpoint. `regenerate` gibt den Code nur zurück, wenn alle alten Keyboxen entfernt sind.
- **K13** `recoveryCode` landet nie in `current.sync`, in `status`-Antworten oder in Events. Weil TypeScript das strukturell nicht erzwingt, ist es ein Pflichttest.
- **K14** Die Code-Helfer liegen in `src/shared/recovery-code.ts` (rein, kein `node:*`); der Renderer importiert sie von dort. `maxLength` ist 64 statt 39, sonst schneidet eine eingefügte Eingabe mit Leerzeichen ab.
- **K15** Hüllen-Parität: Der Test in T3 (`vault-sync-crypto.test.ts`) importiert `scripts/sync-prototype/sync-object-wire.mjs` und prüft für einen Satz Fixtures (gültig, Feld zu viel, Nonce 11 Byte, nicht kanonisch, Altformat, `kind: 'other'`), dass `parseSyncEnvelope` und `validateSyncObject` gleich entscheiden.
- **K16** Der Autorenstempel trägt `at`; Signatureingabe und Prüfregeln stehen in §2.9.2. Ohne `context.device` gibt es keine Stempel und keine Prüfung.
- **K17** Die Migration auf mehreren Geräten führt ohne Anleitung zu zwei Wurzeln ohne Basis und damit zu einem dauerhaften Konflikt (H2-Restrisiko). Text `errors.syncMigrate` nach §5; T10 dokumentiert die Reihenfolge („vorher alle Geräte mit H2 abgleichen; erstes Gerät neu abgleichen, weitere Geräte neu laden“).
- **K18** `/v1/info.objectFormat` im Login-Modus ist `'sync-object'`. Clients werten nur `deviceSessions` aus.
- **K19** Die Geräteliste wird im Client geprüft und `self` lokal berechnet (B3). Der Server sortiert nach `enrolledAt`, `id`; der Client sortiert nicht (kein `localeCompare`).
- **K20** `RemoteLabState.account` bekommt `deviceName` statt eines zweiten `device`-Objekts. `identity` (Fingerabdruck, persistent) ist ab `connect` gesetzt, damit der Hinweis „temporär“ vor der Einschreibung sichtbar ist.
- **K21** `vault-sync-crypto.ts` exportiert `hashWire`, `ensure` und `stable` unverändert weiter (`vault/session.ts:3`).
- **K22** Doku (T10), zusätzlich zu Spec T10:
  - `docs/manual.md` (englisch).
  - Im Threat-Model als neue Grenzen:
    - Ein Passwortbesitzer kann ein Gerät einschreiben und dann alle anderen widerrufen; Ausweg ist `rotate-password` plus Wiedereinschreibung.
    - Eine bestehende WebRTC-Verbindung läuft nach einem Widerruf weiter, weil sie direkt zwischen den Geräten läuft.
    - Die Einschreibung beweist keinen X25519-Besitz (E5).
    - Ein Gerät mit `K_sync` kann die Quarantäne umgehen, indem es einen unbekannten Autor einträgt.
    - Ein widerrufenes Gerät behält `K_sync`.
    - Ein Wechsel der Server-URL verlangt eine neue Einschreibung (Hinweis `enrolledElsewhere`).
- **K23** Server und Client protokollieren weder Passwort, Code, `syncKey`, Token, Nonce, Signatur noch Einschreibedokument. Fehlermeldungen bleiben generisch (`request-rejected`).
- **K24** Einschreibung: 409 (gleiche ID, andere Schlüssel) wird im Client zu `connection`, 429 zu `limit` (B8).

---

## 4. Entscheidungen (Rulings)

- **E1** Ruling: Quarantäne nur für `at ≥ revokedAt` oder eine ungültige Signatur, mit Vorfahren- und `acked`-Schutz; zurückgehaltene `compacts` zählen nur für die `history`-Prüfung. Grund: Sonst bricht der Hauptfall des Widerrufs (verlorenes Gerät), und Kompaktierungen eines später widerrufenen Geräts sperren die Historie (B2). `at` ist die Uhr des Autors. Ein widerrufenes Gerät kann ohne Sitzung ohnehin nicht hochladen, und ein Schlüsselinhaber kann auch einen unbekannten Autor eintragen. Mehr als „Versionen nach dem Widerruf werden nicht automatisch übernommen“ versprechen wir nicht. Kosten: Eine Uhr, die vorgeht, kann eine kurz vor dem Widerruf erzeugte Version zurückhalten (nur nicht übernommen, nie gesperrt).
- **E2** Ruling: Keine automatische Sitzung beim Verbinden; „Sitzung öffnen“ ist ein Klick, die Erneuerung vor Ablauf passiert still (B6). Grund: kein Netzverkehr mit Signatur ohne Nutzeraktion im Dialog. Kosten: ein Klick nach dem Öffnen des Dialogs.
- **E3** Ruling: Kein Kopieren-Knopf für den Wiederherstellungscode. Grund: Zwischenablage-Historien. Kosten: 32 Zeichen abschreiben; das Feld bleibt markierbar.
- **E4** Ruling: „Entfernen“ ohne eigenen Bestätigungsdialog (Hinweistext `revokeHint` daneben). Das eigene Gerät ist in der UI nicht entfernbar, der Host unterstützt es dennoch (Tests). Grund: Lab, Wiedereinschreibung mit Passwort ist möglich. Kosten: Ein Fehlklick kostet eine Passworteingabe am anderen Gerät.
- **E5** Ruling: Das Einschreibedokument beweist nur den Besitz des Signaturschlüssels, nicht des X25519-Schlüssels. Grund: Ein Nachweis bräuchte eine DH-Komposition mit dem Server (wie der Rendezvous-PoP). Die Rendezvous-Präsenz prüft den Besitz weiter, und ein Squatter braucht das Passwort. Kosten: Ein Passwortbesitzer kann eine fremde, noch nicht eingeschriebene ID belegen (sichtbar im Roster, 409 für das echte Gerät). Dokumentiert (K22).
- **E6** Ruling: Die M3-Importprüfung (`samePasswordImport`) greift nur, wenn in derselben Verbindung mit Passwort eingeschrieben wurde. Nach einer passwortlosen Sitzung gibt es keinen Digest. Grund: Das Passwort wird absichtlich nicht mehr gehalten. Kosten: eine Prüfung weniger im seltenen Fall.
- **E7** Ruling: Welle 1 (T1, T2, T3, T4, T6) und Welle 2 (T5, T7, T8, T9) sind jeweils erst mit allen Tasks zusammen typecheck- und vitest-grün (Vorgehen H1-B1/H2-E8). Jede Task läuft ihre eigenen Unit-Tests allein grün.
- **E8** Ruling: Zurückgehaltene (quarantänierte) Objekte bleiben auf dem Server, werden nicht kompaktiert und nicht als fremd entfernt. Grund: Eine Wiedereinschreibung des Geräts macht sie wieder gültig. Kosten: Sie belegen Plätze im Kontingent (100 Objekte).
- **E9** Ruling: Gleiche Geräte-ID mit anderen Schlüsseln ergibt immer 409, auch bei einem widerrufenen Eintrag. Grund: Kein Überschreiben fremder Einträge. Kosten: Wer seine Identitätsdatei verliert, bekommt einen neuen Fingerabdruck (neue X25519), also ohnehin eine neue ID.
- **E10** Ruling: Gleiche `serverId` unter neuer URL bedeutet Hinweis und erneute Passwort-Einschreibung, kein stilles Signieren. Grund: Relay-Schutz ohne URL im Nachweis (Spec §2.1). Kosten: Wer seinen Server über zwei Adressen erreicht (Tailscale und HTTPS), schreibt sich je Adresswechsel neu ein.
- **E11** Ruling: `scripts/sync-lab-smoke.mjs` wird entfernt (die README-Zeile `scripts/sync-prototype/README.md:58` ebenso). Grund: `sync-scene.mjs` deckt den Ablauf ab, und die Datei prüft den abgeschafften Passwort-Login. Kosten: keine CI-Abdeckung betroffen (nicht in `ci.yml`).

---

## 5. Texte (wörtlich, de-DE / en-US; ergänzt und ändert Spec §10)

Spec §10 gilt mit diesen Änderungen:

`syncLab.json`:

| Key | de-DE | en-US |
| --- | --- | --- |
| `enrolling` (korrigiert) | Gerät wird angemeldet … | Enrolling device… |
| `enrolledElsewhere` | Dieses Gerät ist für diesen Server unter {{url}} angemeldet. Melde es hier nur an, wenn beide Adressen zu deinem Server gehören. | This device is enrolled for this server at {{url}}. Enroll it here only if both addresses belong to your server. |
| `recoveryCodeRegenerateHint` | Erzeugt einen neuen Code und macht den bisherigen ungültig. Dieses Gerät braucht dafür den Sync-Schlüssel. | Creates a new code and invalidates the previous one. This device needs the sync key for this. |
| `removeForeignHint` (geändert) | Entfernt nur Objekte, die sich mit dem Sync-Schlüssel dieses Kontos nicht lesen lassen, etwa aus einer älteren Lab-Version. Ein Serverkonto trägt genau einen Vault. | Removes only objects that cannot be read with this account's sync key, for example from an older lab version. A server account holds exactly one vault. |
| `errors.limit` | Zu viele Anmeldeversuche oder zu viele Geräte. Warte kurz oder entferne ein altes Gerät. | Too many sign-in attempts or too many devices. Wait a moment or remove an old device. |
| `errors.syncMigrate` (ersetzt Spec) | Der lokale Sync-Zustand stammt aus einer älteren Lab-Version. Lösche die Datei „.sync-state“ neben dem Vault. Gleiche danach auf dem ersten Gerät erneut ab und lade den Vault auf jedem weiteren Gerät mit dem Wiederherstellungscode neu vom Server. | The local sync state comes from an older lab version. Delete the “.sync-state” file next to the vault. Then sync again on the first device and load the vault from the server with the recovery code on every other device. |
| `localVaultPassword` | **gelöscht** | **gelöscht** |

`remoteLab.json`:

| Key | de-DE | en-US |
| --- | --- | --- |
| `enrolledElsewhere` | Dieses Gerät ist für diesen Server unter {{url}} angemeldet. Melde es hier nur an, wenn beide Adressen zu deinem Server gehören. | This device is enrolled for this server at {{url}}. Enroll it here only if both addresses belong to your server. |

Weitere Regeln:
- `syncLab:errors.identity` wie Spec §10.
- Die Fehlermap in `SyncLabDialog.tsx` wird ein Objektliteral mit vollen Literalen und `satisfies Record<SyncLabErrorCode, string>`. `REMOTE_ERROR_KEYS` bleibt vollständig (`satisfies`).
- Keine dynamischen Keys. Alle Spec-§10-Keys bekommen eine Verwendung in T9, sonst müssen sie gestrichen werden (Katalogtest d).
- `syncLab:deviceName`, `identityTemporary`, `openSession`, `enrolledHint` und `signedInDevice` werden in T9 verwendet. `signedInDevice` steht in der Statuszeile nach der Anmeldung statt des bisherigen Benutzernamens.

---

## 6. Wellen und Tasks (ersetzt Spec §8 und Plan)

Jede Task arbeitet test-first, ändert nur ihre Dateien und committet nicht. Nach jeder Welle müssen `npm run typecheck` und `npx vitest run` grün sein (E7: je Welle gemeinsam).

### Welle 1 (parallel, dateidisjunkt)

| Task | Dateien | Pflichtpunkte | Pflichttests (zusätzlich zu Spec T1–T6) |
| --- | --- | --- | --- |
| **T1 Server, Nachweise, Roster, Hülle** | `scripts/sync-prototype/{server.mjs, account-auth.mjs, rendezvous.mjs, rate-limit.mjs}`, neu `device-proof.mjs`, `device-roster.mjs`, `sync-object-wire.mjs`; Tests `account.test.mjs`, `server.test.mjs`, `rendezvous.test.mjs`, `rendezvous-client.test.mjs`, `remote-signal.test.mjs`, `rate-limit.test.mjs`, neu `device-proof.test.mjs`, `device-roster.test.mjs`, `sync-object-wire.test.mjs`; `server/smoke.mjs`, `server/Dockerfile` (nur `:9`), `scripts/check-server-container.mjs`, `.claude/skills/run-app/fakes.test.mjs` (nur Block `:549-570`) | §2.1–§2.6, B1, B3, B4, B9 (Roster-Teil), K1–K8, K18, K23 | **Session:** Nonce wird bei falscher Signatur, unbekanntem Gerät und widerrufenem Gerät verbraucht (zweiter Versuch mit derselben Nonce 401); Nonce nach 30 s → 401; 9. offene Nonce derselben Quelle → 429; fünfte Sitzung eines Geräts verdrängt die älteste (deren Token 401). **Einschreibung:** `body[3] ≠ deviceId(noiseKey)` → 400; Identitätspunkt-Schlüssel → 400; gleiche Schlüssel erneut → 200 + Name aktualisiert; widerrufen + gleiche Schlüssel → aktiv; gleiche ID, anderes `ephemeral` → 409; 65. Eintrag verdrängt den ältesten widerrufenen; neunter temporärer verdrängt den ältesten ohne Sitzung, sind alle aktiv → 429. **Persistenz:** `fault('afterDevicesRename')` → danach 503; Datei mit fremder `serverId` → Start scheitert; nicht kanonisch → Start scheitert; Neustart behält persistente, verliert temporäre. **Widerruf:** `x-shellherd-device` ≠ Sitzungsgerät → 401; Pfad im Nachweis anders → 401; Body nicht leer → 400/413; Präsenz und Rendezvous-Sitzungen des Geräts weg (`GET /devices` ohne Gerät); zweiter Widerruf → 200. **Rendezvous:** `PUT /devices` mit Schlüssel eines anderen eingeschriebenen Geräts → 403; dasselbe Gerät mit neuem Token übernimmt die Präsenz ohne 409. **Altformat:** `GET` eines Altobjekts → 200 mit Wire; `PUT` Altformat → 400. **Geräteliste:** enthält `signingKey`, sortiert. `/v1/login` → 404. Smoke: zwei `createDeviceIdentity()`, Einschreibung, Sitzung, Rendezvous wie H2, Roster-Liste, Widerruf B → B 401. Container-Prüfung mit neuem Objektformat und Einschreibung. `fakes.test.mjs` prüft `authentication: 'enrolled-device'`, `deviceSessions: true` und eine Einschreibung. |
| **T2 Client-Transport** | `scripts/sync-prototype/account-transport.mjs`, `http-common.mjs`, neu `account-transport.test.mjs` (Fake-`fetch` per `vi.stubGlobal`) | §2.7, B3, B4, K19 | Body von `enroll` genau vier Schlüssel, `enrollment[0]` gleich `JSON.parse(enrollmentBody(...))`, Signatur verifiziert; `openSession` ersetzt ein vorhandenes Token; Antwort mit fremdem `device` → wirft; `revoke` setzt drei Header + `authorization`, signiert genau `'/v1/devices/<id>'`; `devices()` lehnt 65 Einträge, doppelte IDs, schwachen Schlüssel und Zusatzfelder ab und gibt `self` nicht zurück; `get` akzeptiert Altformat, `put` lehnt es ab; Konstruktor lehnt `authentication: 'password'` und fehlendes `deviceSessions` ab. |
| **T3 Sync-Kern** | `src/main/sync-prototype/{vault-sync.ts, vault-sync-crypto.ts, vault-sync-state.ts, vault-sync.test.ts, vault-sync-state.test.ts}`, neu `vault-sync-crypto.test.ts`; neu `src/shared/recovery-code.ts` + `recovery-code.test.ts`; `scripts/sync-prototype/password-sync.test.mjs`; `src/main/sync-prototype/lab-ipc.ts` (nur `:202-212`, mechanisch nach §2.11) und `lab-host.ts` (nur `:18`) | §2.9 vollständig, B2, B4, B5, B7, K11–K17, K21 | **Bootstrap:** Leeres Konto → Code, Keybox, Checkpoint mit `syncKey` ohne `keybox`. Zweites Gerät hat die Keybox zwischen Put und Bestätigung hochgeladen (Fake-Remote) → `syncKey`, eigene Keybox entfernt, kein Checkpoint. Absturz nach dem Put (Fehler vor der Bestätigung) → nächster Lauf gibt einen neuen Code zurück, alte Keybox gelöscht, genau eine Keybox. „Versionen ohne Keybox“ → `syncKey`, mit Code → `recoveryCode`. Code bei vorhandenem `syncKey` → ignoriert. **AAD:** Objekt mit anderem `namespace` → `wrongVault`; Hülle `kind` vertauscht (Version als Keybox gelabelt) → unlesbar; Checkpoint mit anderem `context.device` und zusätzlichen Info-Feldern lesbar (B7). **Quarantäne:** verlorenes Gerät (alle Versionen von A, A widerrufen nach `at`) → Import gelingt, `quarantined` fehlt. Version von A mit `at ≥ revokedAt` als einziger neuer Kopf → zurückgehalten, `quarantined: 1`, Status `synced`, Kopf unverändert. Dasselbe als Vorfahr einer aktiven Version → angenommen. Ungültige Signatur einer `acked`-Version → kein `history`. Zurückgehaltenes `C` mit `compacts` über `acked`-IDs, Objekte gelöscht → kein `history`, keine Löschung aus `held` (`remove` nicht aufgerufen), keine Zombies verworfen. **Weitere:** HKDF-Vektoren fest (Version, Keybox); `regenerate` mit scheiterndem `remove` → wirft, kein Code; `removeForeignObjects` behält eine fremde Keybox (anderer Code) und löscht Altformat; v1-Checkpoint → `migrate` ohne Entschlüsselung; Import schreibt eine Datei mit neuem Salt, die mit `newPassword` entsperrt und deren Checkpoint lesbar ist; alle H2-Kompaktierungstests unter `K_sync` portiert, keiner ohne Ersatz gestrichen. Hüllen-Parität (K15). `password-sync.test.mjs` mit Einschreibung zweier `createDeviceIdentity()` und Code-Übergabe. |
| **T4 Identität** | `src/main/remote/identity.ts`, `identity.test.ts`; `src/main/remote/lab-ipc.ts` (nur Store-Erzeugung `:90-101`) | §2.8, K9 | v2 → v3: X25519 und Fingerabdruck bytegleich, Pins mit `verified` bleiben, ein Schreibvorgang. Schreibfehler bei der Migration → `load()` wirft, v2-Datei bytegleich, zweiter Start migriert. v3 mit manipuliertem `enrollments` → `identity`. Falsches PKCS8-Präfix → `identity`. `rememberEnrollment` ersetzt dieselbe `serverId`, 17. Eintrag verdrängt den ältesten. Temporär: Einschreibungen im RAM, keine Datei. `deviceFingerprint` gleich `rendezvous.mjs deviceId()`, Signatur gegen `ed25519Spki` aus `device-proof.mjs` verifiziert (Import des `.mjs` im Test). |
| **T6 Betrieb** | `server/README.md`, `scripts/sync-prototype/README.md` (ohne Zeile `:58`, die T10 entfernt) | Spec T6, K22 (Betriebsteil): Geräte, Limits (`challenge`, `session`, `deviceWrites`), `devices.json` im Backup, Altobjekte, Passwortwechsel ≠ Widerruf, Grenzen 16/64/8 | Prosa-Konsistenz gegen §2/§5 |

### Welle 2 (nach Welle 1, parallel, dateidisjunkt; grün erst mit allen vier, E7)

| Task | Dateien | Pflichtpunkte | Pflichttests |
| --- | --- | --- | --- |
| **T5 Shared + Texte** | `src/shared/sync-lab.ts`, `src/shared/remote-lab.ts`, `src/shared/locales/{de-DE,en-US}/{syncLab,remoteLab}.json`, `src/renderer/src/remote-lab.ts` | §2.10, §5, B8 | Katalogtest grün (mit T9), `REMOTE_ERROR_KEYS` vollständig |
| **T7 Sync-Lab Host/IPC** | `src/main/sync-prototype/lab-host.ts`, `lab-host.test.ts`, `lab-ipc.ts`, `lab-ipc.test.ts` | §2.11, B3, B6, K10, K13, K24 | Spec T7, zusätzlich: andere URL gleiche `serverId` → `enrolledElsewhere` und kein `openSession` möglich (`stale`); `openSession` 401 einmal → zweiter Versuch, Erfolg → Einschreibung bleibt; 401 zweimal → `forgetEnrollment`; 401 aus `synchronize` → Einschreibung bleibt, `enrolled` gesetzt; Erneuerung bei `expiresAt − 60 s` (fake timers); `recoveryCode` weder in `state.sync` noch in einer späteren `status`-Antwort noch nach `regenerateCode` in `current`; `SyncDevice.keyOf` aus frischer Liste, eigener Eintrag mit anderem Schlüssel → `connection`; `self` lokal berechnet, Serverwert `self: true` für fremde ID ignoriert; Selbstwiderruf → `idle`; 429 bei Einschreibung → `limit`; `deviceName` mit Steuerzeichen → `invalid`; ungültiger Code im Import → `invalid` ohne `syncVault`-Aufruf |
| **T8 Remote-Lab Host/IPC + Wiring** | `src/main/remote/lab-host.ts`, `lab-host.test.ts`, `lab-ipc.ts`, `lab-ipc.test.ts`, `src/main/index.ts` (nur `:264-266`) | §2.12, B6, K10, K20 | Spec T8, ersetzt: 401 in Präsenz → `#dropAccount`, Einschreibung **bleibt**, Zustand `serverReady` + `enrolled`, dann `openSession` ohne Passwort → `signedIn`. Zusätzlich: `identity` im Zustand ab `connect`; temporäre Identität → `enroll` mit `ephemeral: true`; `goOnline('')` nutzt den Einschreibungsnamen; `enrolledElsewhere` bei anderer URL; Probe-Fakes mit `authentication: 'enrolled-device'` und `deviceSessions: true` |
| **T9 Renderer** | `src/renderer/src/components/SyncLabDialog.tsx`, `RemoteLabDialog.tsx`, `src/renderer/src/sync-lab.css`, `remote-lab.css`, Komponententests (`SyncLabDialog.test.tsx`, `RemoteLabDialog.test.tsx`, neu falls nicht vorhanden) | §2.13, §5, E2–E4 | Spec T9, zusätzlich: Code nach „notiert“ nicht mehr im DOM (`container.textContent`), auch nicht nach Schließen und erneutem Öffnen; Code-Feld `maxLength` 64, Absenden gesperrt bei ungültigem Code; Import gesperrt bei ungleichen Passwörtern; kein „Entfernen“ beim eigenen und bei widerrufenen Geräten; `enrolledElsewhere` zeigt die URL; Design-Token-Test grün |

### Welle 3

| Task | Dateien | Pflichtpunkte |
| --- | --- | --- |
| **T10 Doku + Szenen** | `docs/handbuch.md` (§„Fernzugriff (Entwicklung)“, §„Privates Netz und Sync-Lab (Entwicklung)“), `docs/manual.md` (`:746ff` und Sync-Lab-Abschnitt), `docs/plans/selfhosted-{e2ee,threat-model,protocol}.md`, `.claude/skills/run-app/remote-scene.mjs`, neu `.claude/skills/run-app/sync-scene.mjs`, `.claude/skills/run-app/SKILL.md`, `scripts/sync-prototype/README.md` (nur `:58`), **gelöscht** `scripts/sync-lab-smoke.mjs` | Spec T10, B9, K17, K22, E11. **Remote-Szene:** Gerätename im Anmeldeformular; Hinweis „temporär“ sichtbar. **Sync-Szene:** startet den eigenen Server (Temp-Verzeichnis, Port 0, synthetisches Konto) und beendet ihn. Zwei Instanzen mit `SHELLHERD_SYNC_LAB=1`; A mit Demo-Vault, B ohne entsperrten Vault. Ablauf A einschreiben → synchronisieren → Code aus `.sync-lab-code` lesen → „notiert“ → Code nicht mehr im DOM. B einschreiben → „Vault vom Server laden“ mit Code + neuem Passwort → Vault offen. A listet zwei Geräte → entfernt B → B: nächster Abgleich `authentication`. Screenshots `sync-enroll`, `sync-code`, `sync-devices`; `/console` ohne CSP-Meldungen und ohne den Code. Keine Änderung an `package.json`. |

### Abschluss (Lead)

- `npm run typecheck`, `npx vitest run`, `node server/smoke.mjs`, `npx electron-vite build`.
- run-app: `remote-scene.mjs` (Gate T8/T9) zweimal hintereinander gegen dasselbe `drive:sshd` (B9), `sync-scene.mjs` (Gate T3/T7/T9), jeweils mit `/console`-Prüfung.
- `node scripts/check-server-container.mjs`, sofern Docker vorhanden; sonst bleibt die CI das Gate.
- Kein CHANGELOG, keine Version (R-H3-4).

---

## 7. Restrisiken (zur Kenntnis, keine Aufgabe)

- **Quarantäne ist umgehbar:** Ein Gerät mit `K_sync` kann einen unbekannten oder keinen Autor eintragen und wird dann angenommen und gezählt. Sie hält nur ehrliche, veraltete oder später zurückgespielte Versionen eines widerrufenen Geräts auf (E1).
- **Schwache Ed25519-Schlüssel:** K5 weist nur den Identitätspunkt ab. Weitere Punkte kleiner Ordnung kann nur ein Einschreibender mit Passwort setzen; er gewinnt dadurch nichts, was er nicht schon hat.
- **Passwortbesitzer** kann Geräte einschreiben, alle anderen widerrufen und Objekte löschen. Klartext liest er nicht ohne Code. Ausweg: `rotate-password` und Wiedereinschreibung.
- **Bestehende WebRTC-Verbindung** überlebt den Widerruf des Betrachters bis zum Ende der Sitzung (höchstens 5 min).
- **`K_sync` ohne Rotation:** Ein widerrufenes Gerät behält Schlüssel und lokale Daten (T04-Grenze, Spec §2.4).
- **Fernzugriff-Token** bleiben 15 min Inhaberausweise; der Widerruf wirkt, weil `authorize` das Roster prüft.
- **`at`** ist die Uhr des Autors; Uhrabweichung führt höchstens zum Zurückhalten, nie zur Sperre.
- **Konsistenter Schnitt / Zurückhalten nie gesehener Objekte** bleibt unerkennbar (I3, Spec §2.3).
- **Migration mehrerer Geräte** ohne vorherigen gemeinsamen Stand ergibt zwei Wurzeln ohne Basis, also einen Konflikt ohne Auflösungspfad (H2-Restrisiko, K17 dokumentiert die Reihenfolge).
- **JS-Strings:** `syncKey` (base64 im Checkpoint-Objekt), Code und Passwort liegen bis zur GC im Speicher.

---

## Zusammenfassung

Urteil **ready after corrections**: 9 Blocker, 24 Korrekturen, 11 Entscheidungen.

- Die Kryptografie ist solide. Signatureingaben sind getrennte, tagged JSON-Arrays mit `serverId`, `namespace` und Geräte-ID, die Nonce ist einmalig und wird auch bei Fehlschlag verbraucht, die Hülle bindet `kind` in der AAD, und die Keybox ist HKDF über 128 Bit Zufall. Alles läuft mit Node-`crypto`.
- Blocker:
  - Dateizuordnung und Wellen-Grün (B1);
  - eine Quarantäne, die den Widerruf selbst und kompaktierte Historien sperrt (B2);
  - die fehlenden Schlüssel in der Geräteliste (B3);
  - Altobjekte, die `pull` und „Fremde entfernen“ brechen (B4);
  - Rennen und Absturzfenster beim `K_sync`-Bootstrap (B5);
  - ein Sitzungsablauf, der das Passwort zurückholt (B6);
  - die Checkpoint-AAD über das ganze Kontextobjekt (B7);
  - i18n-Verstöße (B8);
  - run-app-Gates, die am temporären Kontingent und am geteilten Fake scheitern (B9).
