# H4 Schlüsselepochen, Anmeldecodes, Roster-TOFU: Validierung (bindend)

Prüfer: Opus, 2026-11-10. Geprüft wurde `2026-11-10-key-epochs-design.md` gegen den Code auf `claude/feature/key-epochs` (`3b1f3ae`): `scripts/sync-prototype`, `server/`, `src/main/sync-prototype`, `src/main/remote`, `src/main/index.ts`, `src/shared`, `SyncLabDialog.tsx`, `remote-lab.ts`, `.github/workflows/{ci,release}.yml`, `.claude/skills/run-app`. Den Ist-Stand geben die Validierungen von H3 und H3.1.

Ausgangslage: `npm run typecheck` ist grün. `npx vitest run` hat 231 Dateien, davon 230 grün. Rot ist nur `src/main/files/sftp-loopback.test.ts` („opens a server file for editing …“), und der Test ist unter Last flaky und hat mit H4 nichts zu tun. Die Umsetzer behandeln ihn als bekannten Ausreißer.

**Urteil: ready after corrections.** Es gibt 10 Blocker, 31 Korrekturen und 18 Entscheidungen.

Dieser Anhang geht Spec und Plan vor. Was hier nicht steht, gilt aus der Spec weiter. §6 ersetzt Spec §8 vollständig, und §5 ersetzt Spec §10 vollständig.

---

## 1. Blocker (jeder mit Fix, bindend)

**B1: Die Rotation kann Daten anderer Geräte still verlieren.**
- Beleg: Die Vorbedingung der Spec (§4.1 Schritt 1) liest nur den eigenen Checkpoint, also einen Kopf, `localHeads == heads` und keine lokalen Änderungen. Hat Gerät B nach A's letztem Abgleich eine Version `V_B` in Epoche `e` hochgeladen, kennt A sie nicht. Das Aufräumen löscht `V_B` dann mit allen Objekten der Epoche `e`. Liegt B's Upload zeitlich zwischen A's Listing und dem Aufräumen, hilft auch keine Prüfung vor dem Upload.
- Folge: B übernimmt später die neue Epoche nach der Adoptionsregel der Spec. Dabei bleibt `projection` gleich dem letzten lokalen Stand, und der enthält `V_B` schon. `samePortable(local, projection)` ist wahr, es wird nichts gemerged, und `head'` wird materialisiert. **B's Änderungen aus `V_B` sind weg, ohne Konflikt und ohne Hinweis.**
- Fix, alle Teile bindend:
  1. **Vorbedingung:** `rotateSyncKey` holt das Listing und alle unbekannten Objekte. Liegt eine Version der aktuellen Epoche vor, die sich öffnen lässt und weder im Graph noch in `graph.compacted` steht, endet die Rotation mit `rotateBlocked`.
  2. **Nach dem Upload:** Taucht im zweiten Listing eine solche unbekannte Version der Epoche `e` auf, folgt dieselbe Rücknahme wie bei `rotateRaced`, aber mit dem Code `rotateBlocked` (Vertrag §2.3, R-Schritt 11).
  3. **`adopts`:** Die neue Epoche trägt eine Liste `adopts`. Sie enthält alle Versions-IDs, die A beim Rotieren kannte, also `graph.values` ∪ `graph.compacted` der alten Epoche, eindeutig, sortiert, höchstens 512. Die Liste steht in **jeder Keybox** der Epoche (recovery und invite) und im Checkpoint v3. Sie steht nicht in der Version, weil Kompaktierung die Wurzel entfernen kann.
  4. **Zweistufige Adoption:** B übernimmt nach dem Algorithmus in §2.3 (A-Schritte), mit einer echten Basis aus den gemeinsamen Vorfahren. Damit wird `V_B` gemerged, ist `V_B` in `adopts`, ist das Ergebnis identisch mit der Spec-Regel.

**B2: Aufräumen und Wiederholungspfad zerstören eine unterbrochene Rotation.**
- Beleg: Die Spec lässt Objekte mit `epoch < state.epoch` in jedem Lauf **vor** `pull` löschen. Nach einem Absturz zwischen dem Checkpoint-Schreiben (Rotation Schritt 3) und `PUT V'` läuft beim nächsten Abgleich Folgendes ab:
  1. Das Aufräumen löscht die ganze alte Epoche, bevor `V'` auf dem Server liegt. Andere Geräte sehen dann ein leeres Konto, und ihr `acked` ergibt `syncHistory`.
  2. Der Wiederholungspfad (`vault-sync.ts:243-256`) ruft `confirmKeybox` auf. Das wertet jede parsebare Hülle als Rivalen (`:172`), also auch die alten Objekte der Epoche `e`.
  3. Es folgt `abortBootstrap`, das den Checkpoint löscht (`:225`). `K'` ist verloren, und das Gerät verlangt einen Code, den es nie gezeigt hat.
- Fix:
  - Objekte mit `epoch < state.epoch` werden am Laufanfang nur aus dem Listing genommen.
  - Gelöscht werden sie erst am Ende eines Laufs mit Status `synced`, nach Upload und Kompaktierung und vor dem letzten `settle`, mit Housekeeping-Semantik.
  - `confirmKeybox` ignoriert Hüllen mit `epoch < state.epoch`.
  - In der Rotation löscht erst R-Schritt 12 (nach `acked = [V']`).

**B3: Die Identitätsdatei sprengt mit Roster-Schnappschüssen ihr eigenes Limit.**
- Beleg: `identity.ts:38` setzt `MAX_FILE_BYTES = 64 * 1024`, und `read` endet über dem Limit mit `fail()` (`:323`). Ein Pin ist als JSON etwa 270 Byte groß. Mit 16 Einschreibungen zu je 64 Pins sind das etwa 280 KB.
- Folge: Die Datei lässt sich nicht mehr lesen. Beide Labs melden dauerhaft `identity`, und die Datei wird nie ersetzt.
- Fix: `MAX_FILE_BYTES = 512 * 1024`. Je Einschreibung gibt es höchstens 64 Pins (Verdrängung siehe §2.4). Ein Test mit 16 Einschreibungen zu je 64 Pins schreibt und liest die Datei erfolgreich.

**B4: Nach Welle 1 sind Typecheck und Tests rot.**
- Beleg: T3 entfernt `regenerateRecoveryCode` und ändert `importSyncedVault`. `src/main/sync-prototype/lab-ipc.ts:8,40,45` und `lab-ipc.test.ts:8,65-77` nutzen beide, gehören laut Spec aber erst T6 in Welle 2.
- Fix: T3 besitzt in Welle 1 genau diese Stellen:
  - In `lab-ipc.ts` die Importzeile `:8`, den Import-Aufruf `:40` (4. Argument wird `{ recoveryCode: request.recoveryCode }`) und die Zeile `:45` (`rotateSyncKey` statt `regenerateRecoveryCode`, die Request-Art bleibt vorerst `regenerateCode`).
  - In `lab-ipc.test.ts` die Zeilen `:8` und `:65-77` (Mock-Name und Erwartungen).
- In Welle 2 gehören beide Dateien wieder ganz T6.

**B5: Der CI-Paket-Smoke scheitert mit der Build-Konstante.**
- Beleg: `ci.yml` baut mit `npm run build` (Labs drin) und packt danach mit `npx electron-builder --linux --dir`, nicht mit `npm run dist:linux`. Die neue Prüfung „keine Lab-Pfade“ in `smoke-linux.mjs` schlägt deshalb in CI immer fehl.
- Zusätzlich: `cross-env` ist keine Abhängigkeit, und `SHELLHERD_RELEASE=1 npm …` läuft unter Windows-`cmd` nicht (`dist`, `dist:win` in `release.yml:66`).
- Fix:
  - T5 legt `scripts/with-release.mjs` an. Es setzt `SHELLHERD_RELEASE=1` und startet die übergebenen Argumente mit `spawnSync`. Unter Windows nutzt es `npm.cmd` mit `shell: true` und reicht den Exit-Code durch.
  - `dist*` rufen `node scripts/with-release.mjs npm run build && electron-builder …` auf.
  - In `ci.yml` beginnt der Schritt „Check packaged Linux startup“ mit `SHELLHERD_RELEASE=1 npx electron-vite build`. Erst dann folgt `electron-builder`.
  - `smoke-linux.mjs` durchsucht **alle** `out/main/**/*.js`, nicht nur `index.js` (Chunks). Siehe §2.5.

**B6: Der Unix-Socket ist im Container so nicht startbar.**
- Beleg: `server/Dockerfile` setzt `ENV SHELLHERD_SERVER_HOST=0.0.0.0` und `SHELLHERD_SERVER_PORT=8787`, und Compose kann Image-ENV nicht entfernen. Die Spec-Regel „Socket schließt PORT/HOST aus (Startfehler)“ macht den Socket-Betrieb im Image damit unmöglich.
- Außerdem prüft der `HEALTHCHECK` fest `http://127.0.0.1:8787`, und der Container wäre im Socket-Betrieb dauerhaft `unhealthy`.
- Fix (E3, E4): Ist `SHELLHERD_SERVER_SOCKET` gesetzt, werden `PORT`, `HOST` und `TRUSTED_PROXY` ignoriert. Dazu kommt einmal der Log-Hinweis aus §5.3. Der Healthcheck kann beides. Der Socket-Betrieb ist ein Override `server/compose.socket.yaml`, die Standard-`compose.yaml` bleibt TCP.

**B7: Einladungs-Keyboxen (sie enthalten `K_sync`) bleiben unter Umständen für immer liegen.**
- Beleg: Die Spec löscht das `object` nur, wenn eine Einladung **ungenutzt** verfällt. Ein Fall fehlt: B schreibt sich ein, importiert aber nicht (Absturz, Dialog zu). Außerdem sind Einladungen nur im RAM gespeichert, und ein Serverneustart vergisst die Löschpflicht.
- Folge: Wer den Code später erfährt (Notizzettel, Foto) und eine Serverkopie hat, liest den aktuellen Schlüssel. Das widerspricht Spec §6: „Keybox nach Gebrauch oder Verfall weg“.
- Fix:
  - Der Server löscht `object` zum Zeitpunkt `max(expiresAt, consumedAt + 600_000)`, ob verbraucht oder nicht.
  - Der Aussteller führt seine Einladungs-Keyboxen im Checkpoint (`invites: {id, at}[]`). Jeder erfolgreiche Abgleich entfernt Einträge, die älter als 20 Minuten sind, nach dem Prinzip best effort.
  - Die Rotation räumt sie ohnehin mit der alten Epoche weg.

**B8: Roster-TOFU lässt sich umgehen, und die Quarantäne-Regel zeigt in die falsche Richtung.**
- Beleg und Fix:
  1. „Verschwundene Einträge entfernen“: Ein Server lässt den widerrufenen Eintrag einfach weg, statt `revokedAt` auf `null` zu setzen. Dann liefert `keyOf` `undefined`, `stance` ergibt `'unknown'`, und die Version wird angenommen (`vault-sync.ts:97`). Der Widerruf ist damit ausgehebelt (Threat-Model `:64`, `:145`). **Fix:** Pins mit `revokedAt !== null` bleiben erhalten, auch wenn der Eintrag verschwindet, und liefern weiter Schlüssel und `revokedAt` an `#deviceOf`.
  2. Die Spec nimmt `max(gespeichert, Server)`. Ein späterer `revokedAt` lässt aber **mehr** Versionen durch, weil `at >= revokedAt` als `suspect` gilt. **Fix:** Sind beide Werte Zahlen, gilt das Minimum.
  3. Ein legitim neu eingeschriebenes Gerät (`device-roster.mjs:102-108` setzt `revokedAt: null`) gälte nach der Spec für immer als widerrufen. Alle seine Versionen landeten dann dauerhaft in der Quarantäne. **Fix (E11):** Die Wiederbelebung wird als Hinweis mit „Zur Kenntnis genommen“ gemeldet, und erst die Bestätigung setzt den Pin auf `revokedAt: null`.

**B9: Die Einschreibung per Anmeldecode hat keinen Benutzernamen.**
- Beleg: `rememberEnrollment` verlangt `username` mit `/^[a-zA-Z0-9_.-]{1,64}$/` (`identity.ts:86-93`). `SyncLabState.account.username` und `enrolled.username` sind Pflicht. Der Einladungspfad sendet keinen Namen.
- Fix (E9): Der Server antwortet auf `POST /v1/devices` mit Einladung `{ device, username }`, also mit dem Kontonamen. `enrollWithInvite` prüft das Format und gibt den Namen zurück.

**B10: Die Keybox-Obergrenze 8 verfehlt gültige Einladungen.**
- Beleg: `SYNC_KEYBOXES_MAX = 8` (`vault-sync.ts:43,160`). Mit bis zu 16 offenen Einladungen, einer recovery-Keybox und Resten aus dem Wiederholungspfad hat eine Epoche oft mehr als 8 Keyboxen. Liegt die richtige außerhalb der ersten 8 nach ID, meldet der Import fälschlich einen falschen Code. Das bekannte DoS aus dem Threat-Model (`:63`) bleibt außerdem offen.
- Fix (E7): Es werden **alle** Keyboxen der Ziel-Epoche probiert, sortiert nach ID, höchstens 100 (Kontolimit). Dafür gibt es eine HKDF je Code und höchstens 100 AES-GCM-Versuche. `SYNC_KEYBOXES_MAX` entfällt.

---

## 2. Vertrag je Task (Pflichtpunkte, wörtlich umsetzen)

Gemeinsame Werte (alle Tasks):

| Name | Wert |
| --- | --- |
| Hülle v2 (Wire, Schlüsselreihenfolge exakt) | `{"format":"shellherd-sync-object","version":2,"kind":"version"\|"keybox","epoch":<int>,"cipher":{"algorithm":"aes-256-gcm","nonce":<b64 12>,"authTag":<b64 16>},"payload":<b64 ≥1>}`, kanonisch (`JSON.stringify(parse(w)) === w`), ≤ 1 MiB, `Number.isSafeInteger(epoch) && 1 <= epoch <= 1_000_000` |
| AAD | `Buffer.from(stable(['shellherd-sync-object', 2, kind, epoch, serverId, namespace]))` |
| Salt mit Epoche | `Buffer.from(JSON.stringify([serverId, namespace, epoch]))` (epoch als JSON-Zahl) |
| Versionsschlüssel | `hkdfSync('sha256', K_sync, saltEpoch, 'shellherd-sync-version-v3', 32)` |
| Keybox-Wrap recovery | `hkdfSync('sha256', code16, saltEpoch, 'shellherd-sync-keybox-recovery-v2', 32)` |
| Keybox-Wrap invite | `hkdfSync('sha256', code16, saltEpoch, 'shellherd-sync-keybox-invite-v1', 32)` |
| `enrollSecret` (K1) | `hex(hkdfSync('sha256', code16, Buffer.from(JSON.stringify([serverId, namespace, origin])), 'shellherd-invite-enroll-v1', 32))`, `origin` = `new URL(serverUrl).origin` |
| Autorenstempel v2 | `Buffer.from(JSON.stringify(['shellherd-sync-author-v2', serverId, namespace, epoch, parents, compacts ?? [], digest, device, at]))` |
| Nachweis v4 | `DEVICE_REQUEST = 'shellherd-device-request-v4'`; `requestProofV3(serverId, namespace, origin, method, path, nonce, device, bodySha256Hex)` = `JSON.stringify([DEVICE_REQUEST, serverId, namespace, origin, method, path, nonce, device, bodySha256Hex])` |
| Leerer Body | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |

Testvektoren (fest, `code16 = 000102030405060708090a0b0c0d0e0f`, `serverId = 'ab'.repeat(32)`, `namespace = 'ns'`):

| Ableitung | Ergebnis (hex) |
| --- | --- |
| `enrollSecret`, origin `https://sync.example.net` | `5792f83741f1740cd38f0039dfb03e44ab40757e0dc67ae50719894dabf55b4e` |
| invite-Wrap, Epoche 1 | `1426e5ff6328e609ac4cdf281528c8ba64f4a43d16b926afe9f958dcb1455bc1` |
| recovery-Wrap, Epoche 1 | `a239835a67dd6e2c7dca3a2b438a3b236bfcf169cabec680a9c8609c3adbadb0` |
| recovery-Wrap, Epoche 2 | `e9987ee4f4301378bbdd5375d5cec7f5ff75144ce59144f1189b85cc386b1b18` |
| Versionsschlüssel, `K_sync = 0x11 × 32`, Epoche 1 | `ec0608780c1af701de0d23791dd93a1d7485acf6c1a1753f10b622f5d6fad6de` |

### 2.1 T1 Server, Nachweise, Roster, Hülle (Welle 1)

Dateien: siehe §6. Server-Logs bleiben englisch (E11 aus H3).

- **T1-1 `sync-object-wire.mjs`:**
  - `validateSyncObject(wire)` prüft Hülle v2 wie oben und gibt `{ kind, epoch }` zurück.
  - `isLegacyVaultObject(wire)` ist wahr für das Vault-Dateiformat **oder** eine strikt gültige Hülle v1 (`format,version,kind,cipher,payload`, `version === 1`). `readObject` (`server.mjs:70`) listet damit v1-Altobjekte weiter. `PUT` nimmt nur v2 an, v1 ergibt 400.
- **T1-2 `device-proof.mjs`:**
  - `DEVICE_REQUEST = 'shellherd-device-request-v4'` und `requestProofV3(…)` wie oben. `bodySha256Hex` muss hex64 sein, die übrigen Prüfungen wie bisher.
  - `requestProofV2` entfällt.
  - Neu ist `export function inviteEnrollSecret(code, serverId, namespace, origin)`. `code` sind genau 32 Kleinbuchstaben-Hex, sonst `throw`. Rückgabe hex64 laut Tabelle, für Skripte, Szenen und den Paritätstest.
- **T1-3 `device-roster.mjs`:**
  - `VERSION = 3`. Die Wire-Reihenfolge je Eintrag ist `id,name,signingKey,noiseKey,enrolledAt,revokedAt,enrolledBy`, mit `enrolledBy` hex64 oder `null`.
  - Eine Datei `version: 2` wird gelesen: Schlüsselmenge ohne `enrolledBy`, Kanonik-Vergleich gegen die v2-Wire, `known = hash(text)`. Jeder Eintrag bekommt `enrolledBy: null`. Der nächste `write` schreibt v3.
  - `version: 1` bricht weiter mit dem bisherigen Hinweis ab.
  - `enroll({ document, ephemeral, origin, enrolledBy = null })`: `enrolledBy` ist `null` oder hex64. Ein neuer Eintrag speichert ihn. Bei einer Wiedereinschreibung eines bekannten persistenten Eintrags (Namenswechsel oder Wiederbelebung, `:103-108`) wird `enrolledBy` mit dem neuen Wert überschrieben. Der Früh-Return bei gleichem Namen und aktivem Eintrag (`:101`) bleibt unverändert.
  - Ephemere Einträge tragen `enrolledBy` ebenso.
  - `view()` liefert `enrolledBy` mit.
  - Neu ist `activeCount()`: Zahl der persistenten Einträge mit `revokedAt === null`.
- **T1-4 `rate-limit.mjs`:** `DEFAULT_LIMITS` bekommt `invite: 10`.
- **T1-5 `server.mjs` Optionen:** `createSyncServer({ …, enrollment = 'password' })`. Nur `'password' | 'invite-only'` ist erlaubt, sonst `check(false)`. `/v1/info` ergänzt im Kontomodus `invites: true, objectEpochs: true, enrollment`, sonst `invites: false, objectEpochs: false`.
- **T1-6 `POST /v1/devices` (zwei Bodyformen):**
  - Erlaubt sind die Schlüsselmengen `enrollment,password,username` mit optionalem `ephemeral` und `enrollment,invite` mit optionalem `ephemeral`. `invite` ist hex64.
  - **Passwortform bei `invite-only`:** 403 direkt nach `readJson`, vor jeder weiteren Prüfung. Weder `fail` noch `failSession` wird aufgerufen.
  - **Einladungsform:** Dokumentprüfung wie heute (`:163-166`, ein Fehler führt zu `login.failSession(source)`).
    - Danach folgen `login.sessionGate(source)` und das Abräumen abgelaufener Einladungen (T1-8).
    - `d = sha256(utf8(invite))` wird mit `timingSafeEqual` gegen **jede** offene Einladung verglichen, ohne frühen Abbruch.
    - Ohne Treffer folgt `login.failSession(source)` und 401.
    - Mit Treffer wird die Einladung **sofort** als verbraucht markiert (`consumedAt = now`, nicht mehr einlösbar). Danach wird `roster.isActive(issuer)` geprüft, sonst 401 (K2).
    - Es folgen `roster.assertHealthy()`, `roster.enroll({ document, ephemeral, origin, enrolledBy: issuer })` und `login.clearSession(source)`.
    - Antwort `201|200 { device: { id, name, enrolledAt, ephemeral }, username: account.username }` (B9).
    - Die Löschung von `initial-password.txt` erfolgt wie heute.
  - Das Budget `enroll:` gilt für beide Formen (`:132`).
- **T1-7 `POST /v1/invites`** (vor dem `collection`-404-Check):
  - Ablauf:
    1. `check(method === 'POST', 405)` und `login.sessionGate(source)`.
    2. Die Nonce aus `x-shellherd-nonce` wird zuerst und immer verbraucht.
    3. `authorize` (scheitert es, folgt `failSession`), dann das Budget `'invite:' + deviceOf(key)` mit `limits.invite`.
    4. Body lesen, höchstens 4096 Byte. Ein Formfehler führt zu `failSession`.
    5. `bodySha = sha256(rohe Bodybytes)`.
    6. Signatur prüfen gegen `requestProofV3(serverId, namespace, origin, 'POST', '/v1/invites', nonce, device, bodySha)`. Dabei muss `device === deviceOf(key)` gelten, sonst `failSession` und 401.
    7. `clearSession(source)`, erneut `authorize(...) === key`, `roster.isActive(device)`.
    8. Body exakt `{secret, object}`, mit `secret` hex64 und `object` hex64 oder `null`.
    9. Ist `object` nicht `null`, muss `objects.has(object)` gelten, und `validateSyncObject(await readObject(object)).kind === 'keybox'` (K3), sonst 400.
    10. Limits: Ist `sha256(utf8(secret))` schon offen, folgt 409. Höchstens 4 offene Einladungen je Aussteller und 16 insgesamt, sonst 429.
  - Speicher (nur RAM): `{ digest, issuer: device, object, createdAt: now, expiresAt: now + 600_000, consumedAt: null }`.
  - Antwort `201 { expiresAt }`.
- **T1-8 Verfall:**
  - `sweepInvites(now)` läuft am Anfang jedes Requests und über ein `setInterval(…, 60_000).unref()`.
  - Einträge mit `consumedAt === null && now >= expiresAt` oder `consumedAt !== null && now >= max(expiresAt, consumedAt + 600_000)` werden entfernt (B7). Ihr `object` wird über die herausgezogene Funktion `removeObject(id)` gelöscht, die auch `DELETE …/objects/:id` nutzt.
  - Ist `busy`, wird der Eintrag beim nächsten Lauf erneut versucht. Ein 404 (Objekt fehlt) gilt als erledigt.
  - Nach `roster.revoke(id)` werden alle Einladungen des Ausstellers `id` entfernt und ihre Objekte gelöscht (K2).
  - `close()` stoppt das Intervall.
- **T1-9 Widerruf:** `DELETE /v1/devices/:id` prüft `requestProofV3(…, 'DELETE', request.url, nonce, device, EMPTY_SHA)`.
- **T1-10 `main.mjs`:**
  - `readConfig` erlaubt zusätzlich den optionalen Schlüssel `enrollment ∈ {'password','invite-only'}` in jeder bisherigen Kombination (Schlüsselmenge als Set prüfen).
  - `export async function setEnrollment(dataDirectory, mode)` nutzt denselben atomaren Schreibpfad wie `replaceAccount` (gemeinsame Hilfsfunktion `writeConfig`) und behält alle übrigen Schlüssel.
  - Neue Modi `lock-enrollment` und `unlock-enrollment`, Argumentlänge 3, mit den Ausgaben aus §5.3.
  - `startServer({ …, socket })` übergibt `enrollment: config.enrollment ?? 'password'`.
  - Startwarnung (§5.3), wenn `enrollment === 'password' && service.activeDevices() > 0`.
  - `init` und `rotate-password` ändern den Schalter nicht. `replaceAccount` behält ihn (Spread, Test).
  - `listDevices` hängt die Spalte `password` oder `invite:<issuer-id>` an, vor der optionalen Spalte `ephemeral`.
- **T1-11 Unix-Socket (Extra, E3/E4):**
  - `serveConfig(env)` liefert zusätzlich `socket`, wenn `SHELLHERD_SERVER_SOCKET` gesetzt ist. Der Wert muss absolut sein, sonst ein Startfehler mit dem Hinweis aus §5.3.
  - Im Socket-Betrieb werden `port`, `host` und `trustedProxy` ignoriert (einmal die Hinweiszeile aus §5.3).
  - `createSyncServer` liefert `listenSocket(path)`:
    - `origin` muss gesetzt sein, sonst `check(false)`.
    - Eine vorhandene Datei am Pfad wird per `lstat` geprüft: Ist sie ein Socket, wird sie entfernt, sonst folgt ein Startfehler.
    - Danach folgen `listen(path)` und `chmod(path, 0o660)`.
    - `trustedProxy = () => true`, und das Verbindungslimit je Quelle (`:321-330`) entfällt.
  - Die Listen-Origin für Tests bleibt TCP.
- **T1-12 `server/Dockerfile`:**
  - `COPY` nimmt jede neue Servermodul-Datei auf, die T1 anlegt (zum Beispiel `invites.mjs`). `check-server-container.mjs` belegt das.
  - `HEALTHCHECK` als `node -e`-Skript: Ist `SHELLHERD_SERVER_SOCKET` gesetzt, fragt es `http.get({ socketPath, path: '/v1/info' })`, sonst `http://127.0.0.1:8787/v1/info`. Zeitlimit 3 s, und `rendezvous === true` ist Pflicht.
- **T1-13 `server/compose.socket.yaml` (neu, Override):**
  - `SHELLHERD_SERVER_SOCKET: /run/shellherd/server.sock`, `ports: !reset []` und das Bind-Mount `/run/shellherd:/run/shellherd`.
  - Kommentar: Das Verzeichnis legt der Host vorab an (`install -d -o 1000 -g caddy -m 2750 /run/shellherd`).
  - `Caddyfile.example` bekommt eine auskommentierte Alternative `reverse_proxy unix//run/shellherd/server.sock`.
- **T1-14 `scripts/check-server-container.mjs`:**
  - Das Test-Objekt wird Hülle v2 mit `"epoch":1` (`:72`).
  - Neue Prüfungen: Ein Gerät lädt ein (`object: null`), ein zweites schreibt sich per Einladung ein, und `devices()` zeigt `enrolledBy`.
  - Offline läuft `setEnrollment('/data','invite-only')` über `docker run … node -e`, danach der Neustart: Die Passwort-Einschreibung ergibt 403, die Einladung weiter 201.
  - Neu ist `docker compose -f compose.yaml -f compose.socket.yaml config`: Die Socket-Variable ist gesetzt, es gibt keine `ports`. Fehlt `!reset` in der Compose-Version, ist das ein Hinweis und kein Fehler.
- **T1-15 `server/smoke.mjs`:** Einladung (`object: null`), Einschreibung per Einladung (`enrolledBy`), danach `setEnrollment(dir, 'invite-only')` und Neustart. Die Passwort-Einschreibung ergibt 403, `info.enrollment === 'invite-only'`.
- **T1-16 Tests** (alle `scripts/sync-prototype/*.test.mjs`, die durch T1 brechen, außer `account-transport.test.mjs` (T2) und `password-sync.test.mjs` (T3)): Spec §7 „Server“ plus diese Fälle:
  - Verbrauchte Einladung: Das Objekt ist nach `consumedAt + 10 min` weg.
  - Widerruf des Ausstellers: Seine offenen Einladungen ergeben 401, ihr Objekt ist weg.
  - Ein inaktiver Aussteller zum Einlösezeitpunkt ergibt 401.
  - `object` ist eine Version und keine Keybox, ergibt 400.
  - Doppeltes `secret` ergibt 409.
  - Passwortform bei `invite-only`: 403, ohne Zählung in `fail` und `failSession` (Zähler), scrypt wird nicht aufgerufen.
  - Hülle v1 auf der Platte wird gelistet und per `GET` geliefert, `PUT v1` ergibt 400.

### 2.2 T2 Client-Transport (Welle 1)

- **T2-1 `probeSyncServer`:** liefert zusätzlich `invites: info.invites === true`, `objectEpochs: info.objectEpochs === true` und `enrollment: info.enrollment === 'invite-only' ? 'invite-only' : 'password'`. Die Probe **wirft nicht** wegen fehlender Felder (E2). Die Prüfung macht der Sync-Host.
- **T2-2 `AccountStore`:**
  - `enrollWithInvite(identity, { secret, name, ephemeral })`:
    - Body ist `JSON.stringify({ enrollment, invite: secret, ephemeral })`.
    - Die Antwort muss `device.id === identity.id` erfüllen, dazu `isDeviceName(device.name)`, sichere Ganzzahlen und `typeof username === 'string' && /^[a-zA-Z0-9_.-]{1,64}$/.test(username)`.
    - Rückgabe `{ id, name, enrolledAt, ephemeral, username }`.
  - `invite(identity, { secret, object })`:
    - `secret` ist hex64, `object` hex64 oder `null`, und ein Token muss da sein.
    - Body exakt `JSON.stringify({ secret, object })`.
    - Header: `authorization`, `content-type: application/json`, `x-shellherd-device`, `x-shellherd-nonce` (frische Challenge) und `x-shellherd-signature` über `requestProofV3(…, 'POST', '/v1/invites', nonce, identity.id, sha256hex(body))`.
    - Die Antwort muss `Number.isSafeInteger(expiresAt)` erfüllen, Rückgabe `{ expiresAt }`.
  - `revoke` signiert `requestProofV3(…, 'DELETE', path, nonce, identity.id, EMPTY_SHA)`.
  - `devices()`: Die Schlüsselmenge ist `enrolledAt,enrolledBy,ephemeral,id,name,revokedAt,self,signingKey`, und `enrolledBy` ist `null` oder hex64. Die Rückgabe enthält `enrolledBy`.
- **T2-3 Tests** (`account-transport.test.mjs`): wie Spec §7 „Transport“, dazu eine Hülle v2 in den Fixtures und den Nachweis v4 im Widerruf.

### 2.3 T3 Sync-Kern (Welle 1)

**Exporte `vault-sync-crypto.ts`** (Signaturen bindend):

```ts
export class SyncFailure extends Error {
  constructor(public readonly code: 'locked' | 'changed' | 'history' | 'conflict' | 'bindings' | 'wrongVault' | 'recovery' | 'limit' | 'syncKey'
    | 'recoveryCode' | 'migrate' | 'foreignKey' | 'otherServer' | 'platform' | 'rotated' | 'rotateBlocked' | 'rotateRaced' | 'inviteKey') { … }
}
export const SYNC_EPOCH_MAX = 1_000_000;
export function parseSyncEnvelope(wire: string): { kind: 'version' | 'keybox'; epoch: number } | null;
export function versionKey(syncKey: Buffer, context: SyncContext, epoch: number): Buffer;
export function keyboxWrapKey(code: string, context: SyncContext, epoch: number): Buffer;   // recovery-v2
export function inviteWrapKey(code: string, context: SyncContext, epoch: number): Buffer;   // invite-v1
export function inviteEnrollSecret(code: string, context: SyncContext, origin: string): string; // hex64
export function sealSyncObject(kind: 'version' | 'keybox', document: unknown, key: Buffer, context: SyncContext, epoch: number): string;
export function openSyncObject(wire: string, kind: 'version' | 'keybox', key: Buffer, context: SyncContext, epoch: number): unknown; // Hüllen-Epoche ≠ epoch → 'wrongVault'
```

Ein ungültiger Code führt zu `SyncFailure('recoveryCode')` bei `keyboxWrapKey` und zu `SyncFailure('inviteKey')` bei `inviteWrapKey`/`inviteEnrollSecret`. `origin` muss `originOk`-kanonisch sein (`https://…` ohne Slash), sonst `'wrongVault'`.

**Exporte `vault-sync.ts`:**

```ts
export interface SyncOptions { keepLocalRevision?: string; recoveryCode?: string; inviteCode?: string } // höchstens einer der beiden Codes
export function synchronizeVault(sessions, remote, context, signal, options?: SyncOptions): Promise<VaultSyncResult>;
export function importSyncedVault(sessions, remote, context, secret: { recoveryCode: string } | { inviteCode: string }, newPassword: string, signal, selectPath): Promise<VaultSyncResult | undefined>;
export function rotateSyncKey(sessions, remote, context, signal): Promise<{ recoveryCode: string }>;
export function createInvite(sessions, remote, context, origin: string, signal): Promise<{ code: string; enrollSecret: string; keyboxId: string }>;
export function removeForeignObjects(…): Promise<number>; // Signatur unverändert
// regenerateRecoveryCode entfällt.
```

**Formate innen:**
- Version: `{ kind: 'shellherd-sync-version-v2', parents, portable, compacts?, author? }`, unverändert bis auf den Stempel v2 (E1).
- Keybox v2: `{ kind: 'shellherd-sync-keybox-v2', method: 'recovery' | 'invite', epoch, syncKey: b64(32), createdBy: hex64 | null, adopts: hex64[] }`. Das Schema ist strikt, `adopts` hat höchstens 512 eindeutige Einträge, und `epoch` muss der Hüllen-Epoche gleichen. Der recovery-Wrap öffnet nur `method: 'recovery'`, der invite-Wrap nur `method: 'invite'` (K4).
- Checkpoint v3:

  ```
  { kind: 'shellherd-sync-state-v3', epoch, syncKey, adopts: hex64[] (≤512), keybox?: hex64, invites?: { id: hex64; at: number }[] (≤16),
    versions, acked, localHeads, working, projection, pending? }
  ```

  Bootstrap legt `epoch: 1, adopts: []` an. Ein gelesener innerer Stand mit `kind: 'shellherd-sync-state-v2'` ergibt `SyncFailure('migrate')` **vor** `stateSchema.parse` (K5).
- Graph: Der Konstruktor bekommt `epoch`. `tryAdd` gibt `null` zurück, wenn `parseSyncEnvelope(wire)?.epoch !== epoch`.

**Ablauf `synchronizeVault`** (Reihenfolge bindend):

1. Den Checkpoint wie heute lesen und validieren (Graph mit `state.epoch`).
2. Listing holen, alle unbekannten Objekte holen, die Epoche jeder parsebaren Hülle bestimmen. `lower` ist die Menge der IDs mit `epoch < state.epoch`. Sie werden aus dem weiteren Listing genommen und nicht als `foreign` gezählt (B2).
3. Gibt es eine Hülle mit `epoch > state.epoch` (Version oder Keybox): ohne `recoveryCode`/`inviteCode` folgt `SyncFailure('rotated')`, und es wird nichts geschrieben. Mit Code folgt die **Adoption** (A-Schritte unten), danach weiter mit Schritt 6.
4. Wiederholungspfad bei `state.keybox` wie heute. Die neue Keybox ist eine recovery-Keybox mit `state.epoch` und `state.adopts`. `confirmKeybox(…, epoch)` ignoriert Hüllen mit kleinerer Epoche, alles andere bleibt wie heute.
5. Ohne Checkpoint gilt: Bootstrap wie heute (Epoche 1). Mit Code folgt die Import-Logik „Code öffnen“ (siehe `importSyncedVault`), mit `adopts` aus der Keybox und Epoche aus der Hülle.
6. `pending` auflösen (wie `:259-267`). **Bei der Adoption geschieht das vor A1** (K6).
7. Weiter wie heute (`pull`, Merge, Upload, Materialisieren, Kompaktieren).
8. Nur bei `synced`, nach der Kompaktierung: Housekeeping mit Semantik wie `removeAll`, also beim ersten Fehler leise stoppen, Abbruchsignale weiterreichen.
   - (a) Alle IDs aus `lower` entfernen.
   - (b) Einträge aus `state.invites`, die älter als `20 * 60_000` ms sind, entfernen. Ein erfolgreicher Versuch oder ein 404 streicht den Eintrag, danach `persist`.
   - Dann `settle`.
9. Wurde ein `inviteCode` benutzt, wird die geöffnete Einladungs-Keybox nach Erfolg best effort entfernt, ohne Zählung in `compacted`.

**Adoption (A-Schritte, B1):**

- **A1:** Ziel-Epoche `E` ist die größte Hüllen-Epoche im Listing. Der Code öffnet Keyboxen der Epoche `E` mit passender Methode, alle nach ID sortiert (B10). Liefert das kein `K'`:
  - Öffnet der Code eine Keybox einer Epoche `state.epoch < x < E`, folgt `'rotated'`.
  - Sonst folgt `'recoveryCode'` bzw. `'inviteKey'`.
  - Es wird nichts geschrieben.
- **A2:** `G' = new Graph(versionKey(K', ctx, E), ctx, vault.id)`. `pull` läuft über alle Objekte der Epoche `E` mit `acked = []`, die Quarantäne gilt. Ist `heads(G').length !== 1`, folgt `SyncFailure('conflict')`, ohne Schreiben. `H'` ist dieser Kopf.
- **A3:** `L = state.localHeads`, `P = state.projection`, `W = state.working`, `A = new Set(keybox.adopts)`.
  - `W_B = samePortable(local.portable, P) ? W : mergePortableVaults(P, local.portable, W).portable`. Ist das `null`, folgt `'conflict'`.
- **A4:** Die Basis ergibt sich so:
  - `L.every(id => A.has(id))` liefert `base = W`.
  - Sonst ist die Kandidatenmenge `{ x ∈ G_alt.values : A.has(x) und x ist Vorfahre-oder-gleich eines l ∈ L }`. Ihre maximalen Elemente (kein anderes Element hat sie als Vorfahren) bilden die Menge. Genau eines liefert `base = portable(x)`, sonst folgt `'conflict'`.
- **A5:**
  - Bei `samePortable(W_B, base)` gilt `localHeads = [H']`, `working = H'.portable`.
  - Sonst `m = mergePortableVaults(base, W_B, H'.portable).portable` (ist `m === null`, folgt `'conflict'`), dann `localHeads = [G'.create(m, [H'])]` und `working = m`.
  - In beiden Fällen `projection = local.portable`.
- **A6:** Neuer Zustand ist `{ kind v3, epoch: E, syncKey: K', adopts: keybox.adopts, versions: G'-Wires, acked: von G' empfangene IDs, localHeads, working, projection }` ohne `keybox`, `invites` und `pending`. Danach folgt Schritt 7 ohne erneuten Lokal-Merge (`projection` ist gesetzt), und der alte Schlüssel wird genullt.

**`rotateSyncKey` (R-Schritte):**

- **R1:** Linux-Pflicht, `remote.remove` Pflicht (sonst `'limit'`). Lease, Lock und Checkpoint v3 lesen (fehlt er, folgt `'syncKey'`).
- **R2:** Bei `state.pending` oder `state.keybox` folgt `'rotateBlocked'`.
- **R3:** `local = split(vault)`. Ist `!samePortable(local.portable, state.projection)`, folgt `'rotateBlocked'`. Ist `heads.length !== 1` oder `stable(localHeads) !== stable(heads)`, folgt `'rotateBlocked'`.
- **R4:** Listing holen, Unbekanntes holen.
  - Eine Epoche größer `e` ergibt `'rotated'`.
  - Eine Version der Epoche `e`, die sich nicht öffnen lässt, ergibt `'foreignKey'`.
  - Eine Version der Epoche `e`, die sich öffnen lässt, aber weder im Graph noch in `graph.compacted` steht, ergibt `'rotateBlocked'` (B1).
  - Fehlt ein `acked` im Listing und ist es nicht kompaktiert, folgt `'history'`.
  - Hat das Listing mehr als 98 Objekte, folgt `'limit'` (K7).
- **R5:** `K' = randomBytes(32)`, `code' = generateRecoveryCode()`, `e' = e + 1` (über `SYNC_EPOCH_MAX` folgt `'limit'`), `adopts' = sort(unique([...graph.values.keys(), ...graph.compacted]))`. Mehr als 512 Einträge ergeben `'limit'`.
- **R6:** `V' = G'.create(head.portable, [])` mit dem Stempel v2 für `e'`. `keybox'` ist eine recovery-Keybox mit `{ epoch: e', adopts: adopts' }`.
- **R7:** `old = structuredClone(state)`.
- **R8:** `checkpoint.write({ kind v3, epoch: e', syncKey: K', adopts: adopts', keybox: id(keybox'), versions: [wire(V')], acked: [], localHeads: [id(V')], working: head.portable, projection: state.projection })`.
- **R9:** `PUT keybox'`, dann `PUT V'`.
- **R10:** Zweites Listing und Unbekanntes holen.
- **R11:** Prüfung auf Rennen:
  - Gibt es eine Hülle mit Epoche `≥ e'`, die nicht `keybox'` oder `V'` ist, gilt das als Rennen.
  - Gibt es eine unbekannte, lesbare Version der Epoche `e`, gilt das als Überholt.
  - In beiden Fällen: `remote.remove` für `keybox'` und `V'` (best effort), `checkpoint.write(old, { ignoreAbort: true })`, dann `'rotateRaced'` bzw. `'rotateBlocked'`.
- **R12:** `acked = [id(V')]` und `persist`. Dann Housekeeping: Jede ID aus Listing 2 mit Epoche `< e'` wird entfernt (Keyboxen, Einladungen, Versionen). Die Semantik ist wie `removeAll`, nur dass ein Abbruchsignal die Rotation **nicht** zurücknimmt (der Marker bleibt).
- **R13:** `settle()` (Marker löschen, `ignoreAbort`) und Rückgabe `{ recoveryCode: code' }`.

**`createInvite`:**
- Linux, Lease, Lock, Checkpoint v3 (fehlt er, folgt `'syncKey'`). Bei `state.keybox` folgt `'rotateBlocked'` (K8).
- Im Listing ergibt eine Epoche größer `state.epoch` `'rotated'`.
- `state.invites` wird zuerst bereinigt (Einträge älter als 20 min best effort entfernen). Mehr als 16 Einträge ergeben `'limit'`.
- `code = generateRecoveryCode()`. Die Keybox ist eine invite-Keybox `{ epoch, adopts: state.adopts, createdBy: device?.id ?? null }`. `state.invites.push({ id, at: Date.now() })`.
- **Erst den Checkpoint schreiben**, dann `PUT`.
- Rückgabe `{ code, enrollSecret: inviteEnrollSecret(code, ctx, origin), keyboxId: id }`.

**`importSyncedVault`:**
- Ziel-Epoche und Code laufen wie A1, ohne vorhandenen Checkpoint. Objekte anderer Epochen werden ignoriert und nicht als `foreign` gezählt.
- Der Zustand ist v3 `{ epoch: E, adopts: keybox.adopts, … }`.
- Eine Einladungs-Keybox wird nach Erfolg best effort entfernt.

**`removeForeignObjects` (K9):**
- Der Checkpoint muss v3 sein (`checkpointKey` liest `syncKey` **und** `epoch` aus dem strikten v3-Schema, sonst `'migrate'` bzw. `'syncKey'`).
- Eine `null`-Hülle wird immer gelöscht.
- Eine Keybox wird nie gelöscht.
- Eine Version mit `epoch < state.epoch` wird gelöscht (ohne Opt-in).
- Eine Version mit `epoch > state.epoch` wird nie gelöscht.
- Eine Version mit `epoch === state.epoch` folgt der bisherigen Regel (Opt-in `versions`).

**`src/shared/recovery-code.ts`:** Nur der Kommentar wird verallgemeinert („recovery and enrollment codes“). Exportnamen bleiben.

**`stance`/`trustedAt`** nutzen den Stempel v2 mit `graph.epoch`.

**Tests:** Spec §7 „Sync-Kern“ mit diesen Änderungen:
- Der Aufräumtest nutzt ein Objekt der Epoche 1 bei Zustand Epoche 2. Eine Epoche 0 ist ungültig, also `null`-Hülle und damit `foreign` (K10).
- Neu sind diese Tests:
  - B1-Szenario: B lädt `V_B` zwischen A's Rotation und dem Aufräumen hoch. Nach der Adoption enthält B's Kopf die Änderungen aus `V_B`.
  - Unbekannte Version vor der Rotation ergibt `rotateBlocked`.
  - B2-Szenario: Absturz nach R8. Der nächste Lauf löscht die alte Epoche nicht vor dem Upload, das Ergebnis ist `synced` mit `recoveryCode`.
  - `adopts` steht in der recovery- und der invite-Keybox.
  - Eine recovery-Keybox öffnet keine invite-Keybox und umgekehrt.
  - 20 Keyboxen, die richtige mit größter ID, werden gefunden.
  - Die Parität `inviteEnrollSecret` TS gegen `device-proof.mjs` gegen den Vektor.
  - Ein `.sync-state` mit innerem v2-Stand ergibt `migrate`, auch in `removeForeignObjects`.
- `password-sync.test.mjs` wird auf die Hülle v2 und die neuen Signaturen angepasst.
- In `vault-sync-crypto.test.ts` stehen alle Vektoren aus §2.

### 2.4 T4 Identität (Welle 1)

```ts
export interface RosterPin { id: string; signingKey: string; revokedAt: number | null; enrolledBy: string | null; acknowledged: boolean }
export interface RosterSnapshot { pins: RosterPin[]; at: number | null }
// RemoteIdentityStore, zusätzlich:
rosterOf(serverId: string, serverUrl: string): RosterSnapshot | undefined          // undefined: keine Einschreibung (gleiche serverId + Origin)
rememberRoster(serverId: string, serverUrl: string, pins: RosterPin[], at: number): void // ohne Einschreibung no-op; validiert; persistiert nur bei persistent
```

- `Enrollment` (öffentlicher Typ) bleibt unverändert. Intern speichert jede Einschreibung zusätzlich `roster: RosterPin[]` (höchstens 64, `id` hex64, `signingKey` als 44 Zeichen Base64, `revokedAt` sicher-ganzzahlig ≥ 0 oder `null`, `enrolledBy` hex64 oder `null`) und `rosterAt: number | null`.
- `rememberEnrollment` behält `roster`/`rosterAt` eines bestehenden Eintrags mit gleicher `serverId`, Origin **und** `namespace`, sonst gilt `[]`/`null` (K11). Bei mehr als 64 Pins verwirft `rememberRoster` zuerst Pins mit `revokedAt !== null` und kleinstem `revokedAt`.
- Datei v4: `{ version: 4, identity, knownDevices, enrollments: (Enrollment & { roster, rosterAt })[], mac }`.
  - MAC-Domäne `'shellherd-remote-identity-v4'`.
  - Die Nachricht ist `JSON.stringify([domain, identity, deviceTuples(known), enrollments.map(e => [e.serverId, e.namespace, e.serverUrl, e.username, e.name, e.enrolledAt, e.rosterAt, e.roster.map(p => [p.id, p.signingKey, p.revokedAt, p.enrolledBy, p.acknowledged])])])`.
- v3 → v4: Die v3-MAC wird geprüft, dann folgen `roster: []` und `rosterAt: null`. Danach wird **best effort** über `save()` geschrieben (E12, es entsteht kein neues Geheimnis). v1/v2 migrieren direkt nach v4.
- `MAX_FILE_BYTES = 512 * 1024` (B3).
- Bei einer temporären Identität bleibt alles im RAM.
- Tests: Spec §7 „Identität“. Dazu kommen der B3-Größentest, die Erhaltung der Pins bei `rememberEnrollment` mit gleichem Namespace und ihr Verlust bei anderem Namespace.

### 2.5 T5 Paket (Extra, Welle 1)

- `electron.vite.config.ts`: `main: { plugins: [...], define: { __SHELLHERD_LABS__: JSON.stringify(process.env.SHELLHERD_RELEASE !== '1') } }`.
- `src/main/labs-flag.d.ts` (neu): `declare const __SHELLHERD_LABS__: boolean;`.
- `vitest.config.ts`: `define: { __SHELLHERD_LABS__: 'true' }`.
- `src/main/labs.ts` (neu): `export async function registerLabs(options: { sessions: VaultSessionManager; onSynced: (s: VaultSessionSnapshot) => void }): Promise<{ sync: SyncLabHost; remote: RemoteLabHost }>`. Das Modul legt den `RemoteIdentityStore` an (gleiche Datei wie heute) und ruft `registerSyncLabIpc` und `registerRemoteLabIpc` auf.
- `src/main/index.ts` (T5 besitzt die ganze Datei):
  - Die statischen Importe `./sync-prototype/lab-ipc`, `./remote/lab-ipc` und `./remote/identity` entfallen. Typimporte (`import type`) bleiben.
  - `:258` wird zu `if (__SHELLHERD_LABS__ && !app.isPackaged && process.env.SHELLHERD_REMOTE_LAB === '1')`.
  - `:264-270` wird zu `const labs = __SHELLHERD_LABS__ ? await (await import('./labs')).registerLabs({ … }) : undefined; syncLabHost = labs?.sync; remoteLabHost = labs?.remote;`.
  - `registerPermissionHandlers` bekommt `remoteLabEnabled: remoteLabHost?.enabled ?? false`.
  - Die Freigabe-Verdrahtung (`onStopsSettled`, `onSharingChange`, `:271-296`) läuft nur in `if (remoteLabHost)`.
  - Die Flag-Argumente `:138-140` bleiben wie sie sind (`?.` ergibt `'0'`).
- `scripts/with-release.mjs` (neu, B5).
- `package.json`: nur `dist`, `dist:linux` und `dist:win` werden zu `node scripts/with-release.mjs npm run build && electron-builder …`.
- `scripts/smoke-linux.mjs`: Rekursiv `out/main/**/*.js` (relativ zum Repo-Wurzelverzeichnis) lesen. Keine Datei darf `SyncLabHost`, `RemoteLabHost`, `SHELLHERD_SYNC_LAB` oder `SHELLHERD_REMOTE_LAB` enthalten, sonst schlägt die Prüfung mit `'Release bundle must not contain lab code (build with SHELLHERD_RELEASE=1)'` fehl.
- `.github/workflows/ci.yml` (Welle 1): Im Schritt „Check packaged Linux startup“ steht als erste Zeile `SHELLHERD_RELEASE=1 npx electron-vite build`.
- Nachweis im Report:
  - `SHELLHERD_RELEASE=1 npx electron-vite build && grep -rl SyncLabHost out/main` ist leer.
  - `npx electron-vite build` (ohne Variable) erzeugt einen Lab-Chunk **direkt in `out/main/`**. `lab-ipc.ts:62` löst `__dirname/../../scripts` auf, und ein Unterordner würde das brechen.
- `npm run typecheck` ist grün.

### 2.6 T6 Sync-App-Fläche (Welle 2)

**`src/shared/sync-lab.ts`:**

```ts
export type SyncLabRequest = { clientId: string } & (
  | { kind: 'status' | 'close' }
  | { kind: 'connect'; serverUrl: string; privateNetwork?: boolean }
  | { kind: 'signIn'; username: string; password: string; deviceName: string; confirmElsewhere?: true }
  | { kind: 'signInWithInvite'; code: string; deviceName: string; confirmElsewhere?: true }
  | { kind: 'openSession' } | { kind: 'listDevices' } | { kind: 'revokeDevice'; id: string } | { kind: 'acknowledgeDevice'; id: string }
  | { kind: 'invite' } | { kind: 'rotateKey'; confirmed: true }
  | { kind: 'synchronize'; recoveryCode?: string }
  | { kind: 'keepLocal'; reviewed: true; revision: string }
  | { kind: 'importVault'; password: string; recoveryCode?: string }
  | { kind: 'removeForeign'; versions?: true });
export interface SyncLabState {
  // bisherige Felder, zusätzlich:
  server?: { …bisher…; invites?: boolean; objectEpochs?: boolean; enrollment?: 'password' | 'invite-only' };
  devices?: { …bisher…; enrolledVia: 'password' | 'invite'; invitedBy?: string }[];
  /** A held enrollment code carries the sync key; never the code itself. */
  inviteKey?: true;
  rotationAdvised?: true;
  newDevices?: { id: string; name: string; enrolledVia: 'password' | 'invite'; invitedBy?: string }[];
  revived?: { id: string; name: string }[];
}
export type SyncLabErrorCode = …bisher… | 'invite' | 'enrollmentLocked' | 'syncRotated' | 'syncRotateBlocked' | 'syncRotateRaced' | 'syncRoster' | 'syncInviteKey';
export type SyncLabReply = { ok: true; state: SyncLabState; vaultChanged?: …; recoveryCode?: string; inviteCode?: string } | { ok: false; code: SyncLabErrorCode; state?: SyncLabState };
```

`invitedBy` ist der Name des Ausstellers aus der aktuellen Liste. Er fehlt, wenn der Aussteller unbekannt ist (Text `deviceEnrolledByUnknown`).

**`lab-host.ts`:**
- `DeviceEntry` bekommt `enrolledBy: string | null`.
- `AccountDriver` bekommt `enrollWithInvite(identity, { secret: string; name: string; ephemeral: boolean }): Promise<{ username: string } & Record<string, unknown>>` und `invite(identity, { secret: string; object: string | null }): Promise<{ expiresAt: number }>`.
- `SyncVaultRequest`:

  ```ts
  | { kind: 'synchronize'; recoveryCode?: string; inviteCode?: string } | { kind: 'importVault'; password: string; recoveryCode: string }
  | { kind: 'importVault'; password: string; inviteCode: string } | { kind: 'rotateKey' } | { kind: 'createInvite'; origin: string } | …
  ```

  `regenerateCode` entfällt.
- `SyncVaultOutcome` bekommt `{ code: string; enrollSecret: string; keyboxId: string }`.
- `syncCodes` bekommt `rotated: 'syncRotated', rotateBlocked: 'syncRotateBlocked', rotateRaced: 'syncRotateRaced', inviteKey: 'syncInviteKey'`.
- `Failure['code']` bekommt `'syncRoster' | 'invite' | 'enrollmentLocked'`.
- `connect` verlangt `info.invites === true && info.objectEpochs === true`, sonst `unavailable`.
- `signIn`: 403 aus `enroll` ergibt `'enrollmentLocked'`.
- `signInWithInvite`:
  1. Prüfungen wie `signIn`, ohne Passwortprüfung. `code` wird mit `normalizeRecoveryCode` geprüft (`null` ergibt `invalid`, ohne Netz).
  2. `secret = inviteEnrollSecret(code, info, new URL(info.serverUrl).origin)`.
  3. Danach `enrollWithInvite`, dann `openSession`. Es folgt `rememberEnrollment({ …, username: result.username, … })`.
  4. Der Code wird als `Buffer.from(code, 'hex')` in `c.inviteCode` gehalten (K12). Danach folgen `list()` und `#roster(c, false)`.
  5. 401 ergibt `'invite'`, 429 `'limit'`, alles andere `'connection'`.
- `#wipe` nullt `passwordDigest` **und** `inviteCode`.
- `performSync`:
  - `importVault` ohne `recoveryCode` verlangt einen gehaltenen `inviteCode`, sonst `invalid`. Der Code wird als `{ inviteCode: hex }` weitergereicht.
  - `synchronize` ohne `recoveryCode` reicht einen gehaltenen `inviteCode` mit.
  - Nach `synced` oder erfolgreichem Import mit Einladungscode und nach `syncInviteKey` wird `inviteCode` gewischt.
  - `rotateKey { confirmed: true }` gibt `{ ok, state, recoveryCode }` zurück und löscht `rotationAdvised`.
  - `invite`:
    1. `syncVault(createInvite)` liefert `{code, enrollSecret, keyboxId}`.
    2. `account.invite(identity, { secret: enrollSecret, object: keyboxId })`.
    3. Scheitert das, folgt best effort `account.remove(keyboxId)` und dann die Fehlerabbildung.
    4. Bei Erfolg `c.invitesIssued += 1`, Antwort `{ ok, state, inviteCode: code }`. Der Code steht nie in `state`, `current` oder `status` (K13 aus H3).
- `devices`:
  - `revokeDevice` (nicht selbst) setzt `c.rotationAdvised = true` für **jedes** Gerät (K14). Danach erhält der Pin `revokedAt ??= Date.now()` (K15).
  - Neu ist `acknowledgeDevice { id }`. Es braucht kein Netz und keinen `busy`-Konflikt: Der Pin wird `acknowledged: true`. Ist der Pin wiederbelebt (Pin `revokedAt !== null`, Server `null`), wird zusätzlich `revokedAt: null` gesetzt (B8/E11). Danach `rememberRoster`, und die Hinweise werden neu berechnet.
- `#roster` vergleicht mit dem Schnappschuss. Neue Datei `src/main/sync-prototype/roster-pins.ts` (pure Funktion, eigener Test):
  1. `rosterOf` ergibt `undefined` oder `at === null`: Alle Pins werden ohne Hinweis übernommen (`acknowledged: true`, `revokedAt` vom Server).
  2. Ein bekannter `id` mit anderem `signingKey` führt zu `throw failure('syncRoster')`. Die Pins bleiben unverändert. In `performSync`, `devices` und `invite` bleibt die Sitzung bestehen (`#failed`), in `signIn`/`openSession` wird sie wie bei jedem Fehler geschlossen.
  3. Ein neuer `id` bekommt `acknowledged = false`. Eine Ausnahme gilt bei `enrolledBy === identity.id && c.invitesIssued > 0`: Dann ist der Pin `true`, und `invitesIssued` sinkt um 1 (E10). `enrolledBy` wird gepinnt und danach nicht mehr überschrieben.
  4. Pin `revokedAt` ist eine Zahl und der Server meldet `null`: Der Pin behält `revokedAt` und wird `acknowledged = false` (wiederbelebt).
  5. Fehlende IDs: Pins mit `revokedAt === null` werden entfernt, widerrufene bleiben (B8).
  6. Effektive Liste für `#deviceOf`: Serverliste plus behaltene widerrufene Pins. Sind beide Werte Zahlen, ist `revokedAt` das Minimum, sonst der vorhandene Wert. Bei einem wiederbelebten, nicht bestätigten Pin gilt der Pin-Wert.
  7. `newDevices` enthält Pins mit `acknowledged === false` und Server-`revokedAt === null`, deren Pin `revokedAt === null` ist. `revived` enthält solche, deren Pin `revokedAt !== null` ist. Pins, die der Server als widerrufen meldet, erzeugen keinen Hinweis.
  8. Hat sich etwas geändert oder ist `at === null`, folgt `rememberRoster(pins, Date.now())`.

**`lab-ipc.ts`:**
- `kindSchema` bekommt `signInWithInvite`, `invite`, `rotateKey` und `acknowledgeDevice`, `regenerateCode` entfällt.
- `invite` und `rotateKey` gehen an `performSync`, `acknowledgeDevice` an `devices`, `signInWithInvite` an `host.signInWithInvite`.
- `buildSyncLabHost`:
  - `rotateKey` ruft `rotateSyncKey` auf.
  - `createInvite` ruft `createInvite(…, request.origin, signal)` auf.
  - `importVault` ruft `importSyncedVault(…, 'inviteCode' in request ? { inviteCode } : { recoveryCode }, …)` auf.
  - `synchronize` reicht `recoveryCode` bzw. `inviteCode` durch.

**`sync-lab-view.ts`:**
- `needsRecoveryCode(code)` gilt zusätzlich für `'syncRotated' | 'syncInviteKey'`.
- `importReady(code, password, repeat, inviteKey = false)`.
- `inviteReady(code, deviceName, elsewhereConfirmed = true)`.

**`SyncLabDialog.tsx`:**
- Schritt 2 hat einen Umschalter mit zwei `secondary-button` und `aria-pressed` in `.sync-lab-toggle`. Vorauswahl ist `invite` bei `server.enrollment === 'invite-only'`, sonst `password`.
- Formular Anmeldecode: Code-Feld (`inviteCodeLabel`, `maxLength={RECOVERY_CODE_INPUT_MAX}`, Hinweis `inviteCodeHint`), Gerätename, `EnrolledElsewhere`, Knopf `enrollInvite`. Das Feld wird nach dem Absenden geleert.
- Bei offenem Vault:
  - „Gerät einladen“ plus `inviteDeviceHint`. Danach `InviteCodeNotice` (Titel `inviteCodeTitle`, Text `inviteCodeNew`, `.sync-lab-code` mit `formatRecoveryCode`, Knopf `inviteCodeDone`). Der Code verschwindet nach dem Klick aus dem DOM.
  - `rotationAdvised` als `.sync-lab-notice` mit Knopf `rotateKey`.
  - „Sync-Schlüssel erneuern“ öffnet `RotateConfirm` (`rotateKeyConfirm`, `rotateKeyYes`, Abbrechen) mit `rotateKeyHint`.
  - `RegenerateConfirm` entfällt.
- Import bei geschlossenem Vault: Bei `state.inviteKey` gibt es kein Code-Feld, dafür Hinweis `importWithInviteHint`.
- Hinweise `newDevice` (mit `{{how}}` aus genau einem `t()` von `deviceEnrolledBy`/`deviceEnrolledByPassword`/`deviceEnrolledByUnknown`) und `deviceRevived` mit Knopf `acknowledgeDevice`.
- In der Geräteliste steht hinter dem Datum das passende `deviceEnrolledBy*` als `.sync-lab-caption`.
- Die Fehler-Map bleibt `satisfies Record<SyncLabErrorCode, string>`.

**`sync-lab.css`** (nur Tokens):
- `.sync-lab-toggle { display: flex; gap: var(--space-8); }`
- `.sync-lab-toggle button[aria-pressed='true'] { border-color: var(--color-accent); background: var(--color-bg-selected); }`

Keine Bewegung.

**Locales:** alle Texte aus §5, auch `remoteLab.json` `errors.enrollmentLocked` für T7.

**Tests:** Spec §7 „Sync-Host“ und „Renderer“, dazu diese Fälle:
- Pin bleibt nach dem Verschwinden eines widerrufenen Eintrags erhalten, die Version des Geräts landet in der Quarantäne (B8).
- `min` der beiden `revokedAt`.
- Wiederbelebung: Hinweis, Bestätigung, Pin `null`.
- Eigene Einladung im selben Verbindungslauf: kein Hinweis. Nach dem Schließen gibt es einen Hinweis.
- `signIn` 403 ergibt `enrollmentLocked`.
- `signInWithInvite` 401 ergibt `invite`.
- `inviteCode` steht nach `#wipe` als nur Nullen im Buffer.
- `importVault` ohne Code und ohne gehaltenen Code ergibt `invalid`.

### 2.7 T7 Remote-App-Fläche (Welle 2)

- `src/shared/remote-lab.ts`: `RemoteErrorCode` bekommt `'enrollmentLocked'`.
- `src/main/remote/lab-host.ts`: `wireError` bildet 403 auf `'enrollmentLocked'` ab, nur im Pfad `#signIn` (die übrigen Pfade bleiben).
- `src/renderer/src/remote-lab.ts`: `enrollmentLocked: 'remoteLab:errors.enrollmentLocked'`.
- `src/main/remote/lab-host.test.ts`: 403 beim Einschreiben ergibt `enrollmentLocked`.
- Die Probe-Felder ändern sich nicht (E2). Sonst ändert sich nichts.

### 2.8 T8 Doku und Szenen (Welle 3)

- Doku:
  - `docs/plans/selfhosted-threat-model.md` mit Stand H4 und den Restrisiken aus §7. `:63` (8-Keybox-DoS) wird durch E7 behoben, `:66` durch die Epochen. `:145` gilt als erfüllt, mit der Grenze „erst bestätigte Wiederbelebung; TOFU ab erstem Lauf“.
  - `docs/plans/selfhosted-protocol.md` (Hülle v2, Keybox v2 mit `adopts`, Checkpoint v3, Adoption, Einladung, Nachweis v4).
  - `docs/handbuch.md` und `docs/manual.md`.
  - `scripts/sync-prototype/README.md`.
  - **`server/README.md` ganz** (K16): Setup-Reihenfolge mit `lock-enrollment`, Totalverlust mit `unlock-enrollment`, Leckablauf mit Schritt 6 „Sync-Schlüssel erneuern“ und ein Abschnitt Unix-Socket mit `compose.socket.yaml` und Host-Caddy.
- `.claude/skills/run-app/sync-scene.mjs`, Ablauf (K17):
  1. A schreibt sich per Passwort ein, gleicht ab und notiert den Code.
  2. A lädt ein, der Code wird gelesen und die Notiz bestätigt.
  3. B schreibt sich per Anmeldecode ein und lädt mit neuem Passwort, ohne Code-Feld.
  4. Die Szene schreibt mit `AccountStore` ein drittes synthetisches Gerät per Passwort ein. A lädt die Liste neu, der Hinweis „Neues Gerät“ erscheint (Shot `sync-new-device`), A bestätigt.
  5. A erneuert den Schlüssel (Shot `sync-rotate`) und notiert den neuen Code.
  6. B gleicht ab, `syncRotated` erscheint, B gibt den neuen Code ein, Ergebnis `synced`.
  7. A entfernt B. B öffnet die Sitzung neu und erhält `authentication`.
  - Shot `sync-invite`.
  - `/console` von A und B enthält weder Codes noch `Content Security Policy`.
  - Die Szene bricht mit Exit 2 und der Meldung `out/ ohne Lab-Code (Release-Build). Neu bauen: npx electron-vite build` ab, wenn `out/main` keinen Lab-Chunk enthält. `remote-scene.mjs` macht dieselbe Prüfung (K18).
- `.claude/skills/run-app/SKILL.md`: neuer Ablauf, Hinweis auf den Release-Build, CI-Orchestrator.
- **Extra A12:**
  - Neu ist `.claude/skills/run-app/ci-sync-scene.mjs`:
    1. Treiber A starten (`SHELLHERD_SYNC_LAB=1`, `SHELLHERD_RUN_NO_SANDBOX=1`, eigenes Temp-`SHELLHERD_RUN_DIR`, Port 9333), auf `token` warten, `demo-setup.mjs`.
    2. Treiber B starten (eigenes leeres Run-Dir, `DRIVER_PORT=9336`).
    3. `sync-scene.mjs` starten.
    4. Beide Treiber beenden, den Exit-Code durchreichen. Gesamttimeout 6 min.
  - `ci.yml`, Linux: neuer Schritt nach `npx vitest run` und **vor** „Check packaged Linux startup“: `xvfb-run -a node .claude/skills/run-app/ci-sync-scene.mjs`.

---

## 3. Korrekturen (bindend)

- **K1 Relay-Bindung:** `enrollSecret` bindet die Origin (Salt `[serverId, namespace, origin]`). Ohne die Origin könnte ein falscher Server mit gleicher `serverId` den abgeleiteten Wert an den echten Server weiterreichen und dort ein eigenes Gerät einschreiben (Relay, C1-Muster).
- **K2 Widerrufene Aussteller:** Beim Einlösen muss der Aussteller aktiv sein. Ein Widerruf verwirft seine offenen Einladungen und löscht deren Objekte. Sonst schreibt eine vor dem Widerruf erzeugte Einladung noch zehn Minuten lang neue Geräte ein.
- **K3:** `object` einer Einladung muss eine `keybox`-Hülle sein. Der Server löscht später genau dieses Objekt.
- **K4:** Die Keybox-`method` muss zum Wrap passen. Recovery- und Invite-Codes teilen sich den Probierlauf.
- **K5:** Ein v2-Checkpoint wird explizit als `migrate` erkannt. `stateSchema.parse` würfe sonst einen `ZodError` und den Fehler `connection`.
- **K6:** Bei der Adoption wird `pending` vor dem Epochenwechsel aufgelöst, denn `pending.localHeads` verweist auf den alten Graph. Der `keybox`-Marker der alten Epoche fällt weg.
- **K7:** Die Rotation braucht Platz für zwei Objekte im 100er-Kontingent (höchstens 98 im Listing, sonst `limit`). Andernfalls bliebe sie bei 507 im Wiederholungspfad hängen.
- **K8:** `createInvite` verlangt einen Checkpoint ohne `keybox`-Marker. Die Markersemantik „kein Code hat das Gerät verlassen“ (`vault-sync.ts:221`) muss gelten, sonst löscht `abortBootstrap` Daten, die ein Eingeladener schon hält.
- **K9:** `removeForeignObjects` beachtet die Epochen (§2.3). `checkpointKey` (`:439-442`) nimmt per `passthrough` auch v2-Zustände an.
- **K10:** Spec §7 „`epoch 0`-Objekt wird gelöscht“ ist falsch. Epoche 0 ist ungültig, also eine `null`-Hülle und damit `foreign`. Gemeint ist Epoche `< state.epoch`.
- **K11:** `rememberEnrollment` behält die Pins bei gleicher `serverId`, Origin und `namespace`. Sonst würde eine Einschreibung im Fernzugriff-Lab die Sync-Lab-Pins still zurücksetzen.
- **K12:** Der gehaltene Anmeldecode ist ein `Buffer` und wird genullt (wie `passwordDigest`).
- **K13:** „E13 erledigt“ (Spec §4.1 Schritt 6) stimmt nicht. `settle` löscht den Marker **vor** der Antwort, und wird der Host danach `stale`, ist der Code weg. Es bleibt ein Restrisiko mit Ausweg: erneut „Sync-Schlüssel erneuern“ (die Vorbedingungen gelten auf diesem Gerät weiter). E14.
- **K14:** `rotationAdvised` gilt nach dem Entfernen **jedes** fremden Geräts. Auch ein temporäres Gerät hatte `K_sync`, und die Spec-Einschränkung auf persistente Geräte wird gestrichen.
- **K15:** Nach eigenem Widerruf bekommt der Pin `revokedAt ??= Date.now()`. Temporäre Geräte verschwinden beim Widerruf aus dem Server-Roster (`device-roster.mjs:140`), und so bleibt ihr Widerruf lokal wirksam.
- **K16:** `server/README.md` gehört ganz T8. Eine Aufteilung „Server-Abschnitte“ ist nicht dateidisjunkt prüfbar.
- **K17:** Die Szenenreihenfolge der Spec (§5: erst entfernen, dann erneuern, dann `syncRotated` auf B) geht nicht. Ein entferntes B bekommt 401 (`authentication`) und sieht keine neue Epoche. Die Reihenfolge aus §2.8 gilt.
- **K18:** Wer nach `npm run dist*` die Szenen startet, hätte ein `out/` ohne Labs. Die Szenen erkennen das und brechen klar ab (§2.8).
- **K19:** CI-Reihenfolge: Die Sync-Szene läuft vor dem Release-Neubau, sonst fehlt ihr der Lab-Code.
- **K20:** `smoke-linux.mjs` prüft alle Chunks, nicht nur `index.js`, denn der Lab-Code liegt in einem dynamischen Chunk.
- **K21:** `check-server-container.mjs:72` lädt eine Hülle v1 hoch und gehört deshalb zu T1 (sonst 400 in CI).
- **K22:** Startwarnung und `activeDevices()` stehen in T1-10. Die Spec sagt nicht, woher `main.mjs` die Geräteanzahl kennt.
- **K23:** Für den Body-Digest zählen die rohen Bytes. `readJson` gibt nur das geparste Objekt zurück, und T1 erweitert es um den Text.
- **K24:** Unbekannte Versionen der alten Epoche im zweiten Listing der Rotation führen zur Rücknahme mit `rotateBlocked` (B1 Teil 2).
- **K25:** `confirmKeybox` und `abortBootstrap` sind epochenbewusst (B2).
- **K26:** Die Einladungsliste im Checkpoint (B7) ist begrenzt (höchstens 16) und wird bei Rotation und Adoption geleert.
- **K27:** `list-devices` zeigt die Einschreibeart als Spalte (Format T1-10). Die Tests in `server-main.test.mjs` werden angepasst.
- **K28:** Das Remote-Lab meldet unter `invite-only` sonst `connection`. T7 bildet 403 auf `enrollmentLocked` ab.
- **K29:** Der Umschalter braucht einen sichtbaren gedrückten Zustand. `secondary-button` hat keinen, deshalb gibt es die `.sync-lab-toggle`-Regel mit bestehenden Tokens.
- **K30:** Die Wiederbelebung ist bestätigungspflichtig (B8 Teil 3). Der Text `deviceRevived` bekommt den Knopf `acknowledgeDevice`.
- **K31:** Die Dateizuordnung ergänzt `src/main/labs-flag.d.ts`, `vitest.config.ts`, `scripts/with-release.mjs`, `server/compose.socket.yaml`, `src/main/sync-prototype/roster-pins.ts` (+Test), `src/shared/remote-lab.ts`, `src/renderer/src/remote-lab.ts` und `.claude/skills/run-app/{remote-scene.mjs, ci-sync-scene.mjs}`. Die Spec nennt sie nicht.

---

## 4. Entscheidungen (Rulings)

- **E1:** Die innere Version behält `kind: 'shellherd-sync-version-v2'` und hat kein Feld `adopts`, denn die Kompaktierung darf die Wurzel entfernen. `adopts` lebt in der Keybox und im Checkpoint (B1).
- **E2:** `probeSyncServer` wirft nicht wegen fehlender H4-Felder. Der Sync-Host verlangt `invites && objectEpochs` (`unavailable`). Das Remote-Lab verlangt nichts Neues.
- **E3:** Im Socket-Betrieb werden `PORT`, `HOST` und `TRUSTED_PROXY` ignoriert, mit Hinweiszeile statt Startfehler (B6). Grund: Image-ENV lässt sich nicht entfernen, und `TRUSTED_PROXY` ist hinter dem Socket bedeutungslos.
- **E4:** Socket-Betrieb nur per Override `server/compose.socket.yaml` mit Host-Caddy und Bind-Mount `/run/shellherd`. Der Standard bleibt TCP auf `127.0.0.1:8787`.
- **E5:** Die Adoption folgt den A-Schritten aus §2.3. Gibt es keine eindeutige gemeinsame Basis oder einen Widerspruch, folgt `syncConflict` ohne Schreiben. Der lokale Vault bleibt unverändert.
- **E6:** Ein neuer Fehlercode `syncInviteKey` steht für „Einladungs-Keybox weg“. Das betroffene Gerät ist schon eingeschrieben und kann keinen neuen Anmeldecode eingeben, und der Text verweist auf den Wiederherstellungscode.
- **E7:** Alle Keyboxen der Ziel-Epoche werden probiert (höchstens 100), `SYNC_KEYBOXES_MAX` entfällt (B10).
- **E8:** Bei `invite-only` ist im Umschalter der Anmeldecode vorausgewählt. Die Passwortform bleibt wählbar und ergibt `enrollmentLocked`.
- **E9:** Der Server liefert den Kontonamen in der Einladungsantwort. `/v1/info` bleibt ohne Namen, damit kein Ratehinweis für das Passwort entsteht.
- **E10:** Eigene Einladungen gelten nur innerhalb derselben Verbindung als bestätigt (Zähler `invitesIssued`). Der Server kann `enrolledBy` frei behaupten und soll damit keine Hinweise unterdrücken können.
- **E11:** Eine Wiederbelebung wird erst durch „Zur Kenntnis genommen“ wirksam. Bis dahin gilt der Pin-Wert.
- **E12:** Die Migration v3 → v4 der Identität ist best effort (kein neues Geheimnis). v1/v2 → v4 schreibt fail-closed wie bisher.
- **E13:** `rotationAdvised` bleibt bis zur nächsten erfolgreichen Rotation oder bis zum Schließen der Verbindung bestehen (nicht persistent).
- **E14:** E13-Rest aus H3.1 bleibt Restrisiko (K13). Eine zweiphasige Codeübergabe kommt nicht.
- **E15:** Die CI-Szene läuft über `ci-sync-scene.mjs`. Ist sie in CI flaky, gilt das Lead-Ruling „raus“ aus R-H4-2 (Schritt und Orchestrator entfernen, Szene bleibt manuell).
- **E16:** Der Release-Schalter kommt über `scripts/with-release.mjs` statt über `cross-env`. Es gibt keine neue Abhängigkeit.
- **E17:** Konsumierte Einladungen bleiben bis `consumedAt + 10 min` als Löschauftrag im RAM. B importiert direkt nach der Einschreibung.
- **E18:** Die Rotation verlangt `remote.remove` (wie bisher `regenerateRecoveryCode`). Ein H1-Server ohne `DELETE` ergibt `syncLimit`.

---

## 5. Texte (wörtlich; ersetzt Spec §10; T6 legt alle in de-DE und en-US an)

### 5.1 `syncLab.json` neu

| Key | de-DE | en-US |
| --- | --- | --- |
| `enrollWithPassword` | Mit Serverpasswort | With server password |
| `enrollWithInvite` | Mit Anmeldecode | With enrollment code |
| `inviteCodeLabel` | Anmeldecode (32 Zeichen) | Enrollment code (32 characters) |
| `inviteCodeHint` | Von einem bereits angemeldeten Gerät über „Gerät einladen“ erzeugt. Gilt zehn Minuten und genau einmal. Er bringt diesem Gerät die Anmeldung und den Sync-Schlüssel; ein Serverpasswort ist nicht nötig. | Created on an already enrolled device via “Invite device”. Valid for ten minutes and exactly once. It gives this device the enrollment and the sync key; no server password is needed. |
| `enrollInvite` | Mit Anmeldecode anmelden | Enroll with code |
| `inviteDevice` | Gerät einladen | Invite device |
| `inviteDeviceHint` | Erzeugt einen Anmeldecode für ein neues Gerät. Gib ihn dort unter „Mit Anmeldecode“ ein. Der Server kennt den Code nicht. | Creates an enrollment code for a new device. Enter it there under “With enrollment code”. The server does not know the code. |
| `inviteCodeTitle` | Anmeldecode für ein neues Gerät | Enrollment code for a new device |
| `inviteCodeNew` | Gib diesen Code innerhalb von zehn Minuten auf dem neuen Gerät ein. Er wird nur einmal angezeigt und gilt genau einmal. | Enter this code on the new device within ten minutes. It is shown only once and is valid exactly once. |
| `inviteCodeDone` | Ich habe den Code übertragen | I have entered the code there |
| `importWithInviteHint` | Dieses Gerät wurde mit einem Anmeldecode angemeldet und kennt den Sync-Schlüssel. Wähle nur ein neues Passwort für die lokale Vault-Datei. | This device was enrolled with an enrollment code and holds the sync key. Choose only a new password for the local vault file. |
| `rotateKey` | Sync-Schlüssel erneuern | Renew sync key |
| `rotateKeyHint` | Erzeugt einen neuen Sync-Schlüssel und einen neuen Wiederherstellungscode. Alle Daten werden damit neu auf dem Server abgelegt, die alten entfernt. Entfernte Geräte, alte Codes und alte Serverkopien lesen danach nichts Neues mehr. Deine anderen Geräte brauchen beim nächsten Abgleich den neuen Code. | Creates a new sync key and a new recovery code. All data is stored on the server again under the new key, the old data is removed. Removed devices, old codes and old server copies can no longer read anything new. Your other devices need the new code at their next sync. |
| `rotateKeyConfirm` | Sync-Schlüssel erneuern? Deine anderen Geräte brauchen danach den neuen Wiederherstellungscode. Synchronisiere vorher auf allen Geräten, damit nichts im Konflikt endet. | Renew the sync key? Your other devices will need the new recovery code afterwards. Sync on all devices first so nothing ends in a conflict. |
| `rotateKeyYes` | Jetzt erneuern | Renew now |
| `rotationAdvised` | Ein Gerät wurde entfernt. Erneuere den Sync-Schlüssel, damit es neue Daten nicht mehr lesen kann. | A device was removed. Renew the sync key so it can no longer read new data. |
| `deviceEnrolledBy` | angemeldet mit Anmeldecode von {{name}} | enrolled with a code from {{name}} |
| `deviceEnrolledByPassword` | angemeldet mit Serverpasswort | enrolled with the server password |
| `deviceEnrolledByUnknown` | angemeldet mit Anmeldecode eines nicht mehr bekannten Geräts | enrolled with a code from a device that is no longer known |
| `newDevice` | Neues Gerät im Konto: {{name}} ({{how}}). Hast du es nicht selbst angemeldet, entferne es, wechsle das Serverpasswort und erneuere den Sync-Schlüssel. | New device in the account: {{name}} ({{how}}). If you did not enroll it yourself, remove it, change the server password and renew the sync key. |
| `acknowledgeDevice` | Zur Kenntnis genommen | Acknowledged |
| `deviceRevived` | {{name}} war entfernt und ist laut Server wieder aktiv. Dieses Gerät behandelt es weiter als entfernt, bis du das bestätigst. | {{name}} was removed and is active again according to the server. This device keeps treating it as removed until you confirm. |
| `errors.invite` | Der Anmeldecode ist falsch, abgelaufen oder schon verwendet. Erzeuge auf dem angemeldeten Gerät einen neuen. | The enrollment code is wrong, expired or already used. Create a new one on the enrolled device. |
| `errors.enrollmentLocked` | Dieser Server nimmt neue Geräte nur mit Anmeldecode an. Erzeuge ihn auf einem angemeldeten Gerät. | This server accepts new devices only with an enrollment code. Create it on an enrolled device. |
| `errors.syncRotated` | Der Sync-Schlüssel wurde auf einem anderen Gerät erneuert. Gib den neuen Wiederherstellungscode ein. Dein lokaler Vault bleibt unverändert. | The sync key was renewed on another device. Enter the new recovery code. Your local vault stays unchanged. |
| `errors.syncRotateBlocked` | Vor dem Erneuern muss der Abgleich ohne Konflikte und ohne offene lokale Änderungen abgeschlossen sein. Synchronisiere zuerst. | Before renewing, the sync must be complete without conflicts and without pending local changes. Sync first. |
| `errors.syncRotateRaced` | Ein anderes Gerät hat den Sync-Schlüssel gleichzeitig erneuert. Es wurde nichts geändert. Synchronisiere und versuche es erneut. | Another device renewed the sync key at the same time. Nothing was changed. Sync and try again. |
| `errors.syncRoster` | Die Geräteliste des Servers widerspricht der zuletzt gespeicherten: Ein bekanntes Gerät hat einen anderen Schlüssel. Es wurde nichts abgeglichen. Prüfe den Server. | The server’s device list contradicts the one stored last: a known device has another key. Nothing was synced. Check the server. |
| `errors.syncInviteKey` | Der Sync-Schlüssel aus dem Anmeldecode liegt nicht mehr auf dem Server, etwa weil zehn Minuten vergangen sind oder der Schlüssel erneuert wurde. Gib den Wiederherstellungscode ein. | The sync key from the enrollment code is no longer on the server, for example because ten minutes have passed or the key was renewed. Enter the recovery code. |

### 5.2 `syncLab.json` geändert und entfernt

- `recoveryCodeNew`:
  - de: „Notiere diesen Code jetzt. Er wird nur einmal angezeigt. Ein weiteres Gerät braucht ihn, um deinen Vault vom Server zu laden. Der Server kennt ihn nicht. Er öffnet nur den aktuellen Sync-Schlüssel; nach „Sync-Schlüssel erneuern“ gilt ein neuer Code.“
  - en: “Write this code down now. It is shown only once. Another device needs it to load your vault from the server. The server does not know it. It opens only the current sync key; after “Renew sync key” a new code applies.”
- `revokeHint`:
  - de: „Ein entferntes Gerät verliert sofort den Zugriff auf den Server. Seinen lokalen Vault behält es. Erneuere danach den Sync-Schlüssel, damit es neue Daten nicht mehr lesen kann.“
  - en: “A removed device loses server access immediately. It keeps its local vault. Renew the sync key afterwards so it can no longer read new data.”
- Entfernt: `recoveryCodeRegenerate`, `recoveryCodeRegenerateHint`, `recoveryCodeRegenerateConfirm` und `recoveryCodeRegenerateYes`.

### 5.3 `remoteLab.json` und Server-Logs

- `remoteLab.json` neu, `errors.enrollmentLocked`:
  - de: „Dieser Server nimmt neue Geräte nur mit Anmeldecode an. Melde dieses Gerät zuerst im Sync-Lab mit einem Anmeldecode an.“
  - en: “This server accepts new devices only with an enrollment code. Enroll this device in the sync lab with an enrollment code first.”
- Server-Logs (englisch, wörtlich):
  - Startwarnung: `Warning: password enrollment is open although devices are enrolled; run lock-enrollment to accept new devices only with an enrollment code.`
  - `lock-enrollment`: `Enrollment set to invite-only: new devices need an enrollment code. Start the server to apply.`
  - `unlock-enrollment`: `Enrollment set to password: the server password can enroll new devices again. Start the server to apply.`
  - Socket-Hinweis: `Note: SHELLHERD_SERVER_PORT, SHELLHERD_SERVER_HOST and SHELLHERD_SERVER_TRUSTED_PROXY are ignored while SHELLHERD_SERVER_SOCKET is set.`
  - Socket-Startzeile: `Shellherd storage and rendezvous listening on unix socket <path>`
  - Socket-Hinweis bei Fehler: `SHELLHERD_SERVER_SOCKET must be an absolute path, e.g. /run/shellherd/server.sock`

Es gibt keine dynamischen Keys. `{{how}}` entsteht aus genau einem `t()`-Aufruf auf einen der drei `deviceEnrolledBy*`-Keys.

---

## 6. Wellen und Tasks (ersetzt Spec §8; dateidisjunkt je Welle)

Nach jeder Welle müssen `npm run typecheck` und `npx vitest run` grün sein. Ausgenommen ist der bekannte Ausreißer `sftp-loopback`. Welle 1 ist erst mit T1+T2+T3 zusammen grün (`account.test.mjs`, `password-sync.test.mjs`). Umsetzer committen nicht.

### Welle 1 (parallel)

| Task | Dateien (Tests daneben gehören dazu) | Pflicht |
| --- | --- | --- |
| **T1 Server** | `scripts/sync-prototype/{server.mjs, device-roster.mjs, device-proof.mjs, account-auth.mjs, sync-object-wire.mjs, rate-limit.mjs}` + `{server,account,device-roster,device-proof,sync-object-wire,rate-limit,server-main}.test.mjs`, neu `invites.test.mjs` (ggf. `invites.mjs`), jede weitere `scripts/sync-prototype/*.test.mjs`, die durch T1 bricht (außer T2/T3-Dateien); `server/{main.mjs, smoke.mjs, Dockerfile, Caddyfile.example}`, neu `server/compose.socket.yaml`; `scripts/check-server-container.mjs` | §2.1, B6, B7, K1–K3, K21–K23, K27 |
| **T2 Transport** | `scripts/sync-prototype/{account-transport.mjs, http-common.mjs}` + `account-transport.test.mjs` | §2.2 |
| **T3 Sync-Kern** | `src/main/sync-prototype/{vault-sync.ts, vault-sync-crypto.ts, vault-sync-state.ts}` + Tests; `src/shared/recovery-code.ts` (nur Kommentar); `scripts/sync-prototype/password-sync.test.mjs`; **nur** `src/main/sync-prototype/lab-ipc.ts:8,40,45` und `lab-ipc.test.ts:8,65-77` (B4) | §2.3, B1, B2, B10, K4–K10, K24–K26 |
| **T4 Identität** | `src/main/remote/{identity.ts, identity.test.ts}` | §2.4, B3, K11 |
| **T5 Paket (Extra)** | `electron.vite.config.ts`, `vitest.config.ts`, `package.json` (nur `dist*`), `src/main/index.ts`, neu `src/main/{labs.ts, labs-flag.d.ts}`, `scripts/smoke-linux.mjs`, neu `scripts/with-release.mjs`, `.github/workflows/ci.yml` (nur die Release-Neubauzeile) | §2.5, B5, K20 |

### Welle 2 (parallel, braucht Welle 1)

| Task | Dateien | Pflicht |
| --- | --- | --- |
| **T6 Sync-App-Fläche** | `src/main/sync-prototype/{lab-host.ts, lab-ipc.ts}` + Tests, neu `src/main/sync-prototype/roster-pins.ts` + Test, `src/shared/sync-lab.ts`, `src/renderer/src/components/SyncLabDialog.tsx` + Test, `src/renderer/src/sync-lab-view.ts` + Test, `src/renderer/src/sync-lab.css`, **alle** `src/shared/locales/**` | §2.6, §5, B8, B9, K11–K15, K29, K30 |
| **T7 Remote-App-Fläche** | `src/main/remote/lab-host.ts` + `lab-host.test.ts`, `src/shared/remote-lab.ts`, `src/renderer/src/remote-lab.ts` (+ Test, falls vorhanden) | §2.7, K28 |

### Welle 3

| Task | Dateien | Pflicht |
| --- | --- | --- |
| **T8 Doku + Szenen** | `docs/plans/{selfhosted-threat-model.md, selfhosted-protocol.md}`, `docs/{handbuch.md, manual.md}`, `scripts/sync-prototype/README.md`, `server/README.md` (ganz), `.claude/skills/run-app/{sync-scene.mjs, remote-scene.mjs, SKILL.md}`, neu `.claude/skills/run-app/ci-sync-scene.mjs`; **Extra A12:** `.github/workflows/ci.yml` (Szenenschritt) | §2.8, K16–K19 |

Abhängigkeiten:
- T6 liest die Reports von T2 (Driver-Methoden), T3 (Signaturen, Codes) und T4 (API).
- T7 nutzt den Key aus T6.
- T8 liest alle Reports.
- T5 ist unabhängig. Es darf in Welle 1 `labs.ts` gegen die bestehenden `register*LabIpc` schreiben, deren Signaturen sich nicht ändern.

Abschluss (Lead):
- `npm run typecheck`, `npx vitest run`, `node server/smoke.mjs`, `npx electron-vite build`.
- `sync-scene.mjs` und `remote-scene.mjs` (Skill `run-app`).
- `node scripts/check-server-container.mjs` (mit Docker).
- `SHELLHERD_RELEASE=1 npx electron-vite build`, `electron-builder --linux --dir`, `xvfb-run -a node scripts/smoke-linux.mjs`, danach ein Neubau ohne Variable.
- Kein CHANGELOG, keine Version.
- Offene PR-Punkte: Fuses-Rest (E1 aus H3.1), H5-Liste.

---

## 7. Restrisiken (zur Kenntnis, keine Aufgabe)

- **Zurückhalten der neuen Epoche:** Ein bösartiger Server kann einem Gerät, das die neue Epoche noch nicht übernommen hat, die neue Epoche dauerhaft vorenthalten. Das Gerät schreibt dann weiter unter dem alten Schlüssel, und den lesen widerrufene Geräte und alte Codes. T04 gilt nur für Geräte, die übernommen haben. Ein Zurückdrehen nach der Übernahme fällt dagegen auf (`acked` fehlt → `syncHistory`, kleinere Epochen werden ignoriert).
- **Fälschung einer höheren Epoche:** Sie blockiert den Abgleich (`syncRotated`, danach `syncRecoveryCode`). Es entsteht kein Datenverlust.
- **Löschen durch den Server:** Das Aufräumen löscht nur IDs von Hüllen, deren Hash geprüft ist und deren Epoche kleiner ist. Aktuelle Objekte haben andere IDs. Mehr als mit eigenem `DELETE` erreicht der Server damit nicht.
- **Verlorener Code:** Der neue Code geht verloren, wenn der Host zwischen `settle` und Antwort `stale` wird (K13). Ausweg ist eine erneute Rotation.
- **Rennen nach Absturz:** Eine unterbrochene Rotation und eine gleichzeitige fremde Rotation führen im Wiederholungspfad zu `abortBootstrap`, das den Checkpoint löscht. Das Gerät braucht dann den Code des Gewinners. Der lokale Vault bleibt erhalten.
- **Adoption ohne eindeutige Basis:** Gibt es bei der Adoption keine eindeutige gemeinsame Basis oder mehrere Köpfe in der neuen Epoche, meldet das Gerät `syncConflict`. Der Ausweg ist manuell (`.sync-state` löschen und neu laden; eigene ungesyncte Änderungen trägt man dann von Hand nach).
- **Abgefangener Anmeldecode:** Wer ihn binnen zehn Minuten abfängt, erhält Einschreibung und aktuellen Schlüssel (sichtbar über `enrolledBy` und den Hinweis). Ausweg sind Entfernen und Rotation.
- **Einladungsreste:** Nach einem Serverneustart bleiben Einladungs-Keyboxen liegen, bis der Aussteller abgleicht (20 min) oder rotiert.
- **Fehlermeldung bei altem Code:** Ein frisches Gerät mit altem Code nach abgeschlossenem Aufräumen sieht `syncRecoveryCode` statt `syncRotated`.
- **TOFU:**
  - Der erste Lauf vertraut der Liste.
  - Eigene Einladungen erscheinen nach einem Neustart einmal als „Neues Gerät“ (E10).
  - Temporäre Identitäten (Szenen, CI, Systeme ohne Schlüsselablage) halten Pins nur im RAM.
- **Metadaten:** Der Server sieht die Epochenzahl und die Anzahl der Einladungen.
- **Socket-Betrieb:** Er ignoriert TCP-Variablen still bis auf eine Hinweiszeile.
- **Dead-Code-Elimination:** Die Build-Konstante verlässt sich darauf, dass Rollup tote Zweige entfernt. Der Smoke prüft das.
- **CI-Szene:** Sie kann im Linux-Job flaky sein (E15).

