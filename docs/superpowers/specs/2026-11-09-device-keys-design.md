# Spec: Sicherheitshärtung H3 (Geräteschlüssel statt Serverpasswort, zufälliger Sync-Schlüssel)

Status: Design, Meilenstein H3. Baut auf H1 und H2 auf (beide in staging gemergt); deren Regeln, Verträge und Rulings gelten weiter, soweit hier nichts anderes steht. Bindend geht `…-validation.md` vor.

## 0. Umfang und Rulings

Umfang H3 = Minimalstufe aus Abschnitt 9 **plus** die Extras Autorenstempel (T3 Stufe 2 + Anzeige in T9) und `regenerateRecoveryCode` (T3/T7/T9). Nicht in H3: Roster-TOFU-Hinweis „Neues Gerät im Konto“, Einschreibecodes, `K_sync`-Rotation, Per-Gerät-Keybox, Noise-Pairing für den Schlüssel, TOTP, OPAQUE, Ablösung des alten Gerätemodus (alles H4 oder später).

- Ruling R-H3-1: Die 22 Entscheidungen aus Abschnitt 11 werden wie empfohlen übernommen. Ausnahme Nr. 13: Der Autorenstempel ist in H3 enthalten (nicht nur optional), weil er die Quarantäne von Versionen widerrufener Geräte liefert — das ist der eigentliche Nutzen eines Widerrufs für den Sync.
- Ruling R-H3-2: Keine eigene Kryptografie. Nur Node-`crypto` (Ed25519, X25519, HKDF-SHA256, AES-256-GCM, `randomBytes`) und die bestehende Sync-AEAD-Komposition. Kein libsodium im Main-Bundle.
- Ruling R-H3-3: Lab-Bruch erlaubt. H2-Clients und H3-Server (und umgekehrt) scheitern sichtbar (`unavailable`), kein Downgrade. Alle Lab-Geräte und der Server werden gemeinsam aktualisiert.
- Ruling R-H3-4: Kein CHANGELOG, keine Version im Lab-Branch (wie H1/H2).

Branch `claude/feature/device-keys` von `staging` @ `29f9293`.

---

Konzeptgrundlage: `.superpowers/sdd/2026-11-09-device-keys-research.md`. Branch `claude/feature/device-keys` von `staging` @ `29f9293` (H1 #44 und H2 #45 gemergt). Reines Lesekonzept, kein Code geändert. Bindend bleiben: R1–R12 aus `docs/superpowers/specs/2026-11-07-remote-agent-design.md`, SEC-01…SEC-12 aus `docs/plans/selfhosted-threat-model.md`, die Validierungen von H1 und H2 (`…-validation.md`, insbesondere H2 E2–E5 zur Kompaktierung, E11 zu Pins) sowie R-H1…R-H3 (H1) und R-H2-1…R-H2-3 (H2).

Leitentscheidung bleibt: **keine eigene Kryptografie.** H3 nutzt Node-`crypto` (Ed25519 `generateKeyPairSync`/`sign`/`verify`, X25519, HKDF-SHA256, AES-256-GCM, `randomBytes`) und die bestehende AEAD-Komposition des Syncs (`vault-sync-crypto.ts:30-54`). Der Server verifiziert Ed25519 bereits heute mit Node (`server.mjs:36,155`, `server-access.mjs:13-23`). Kein libsodium im Main-Bundle, kein PAKE, kein OPAQUE, kein TOTP, kein Sealed-Box-Eigenbau.

---

## 1. Bestand und Lücken

| Thema | Bestand (`datei:zeile`) | Lücke |
| --- | --- | --- |
| Anmeldung im Kontomodus | `account-transport.mjs:14-20` sendet Benutzername + Passwort im TLS-Body an `POST /v1/login` (`server.mjs:96-106`); `account-auth.mjs:41-60` scrypt + Backoff; Token 256 Bit, 15 min, `refresh` bis 12 h (`:57-58,65`) | Das Passwort geht bei **jeder** Anmeldung über die Leitung (M3-Pfad, I8). Es gibt keine Geräteidentität im Kontomodus: jeder Passwortbesitzer ist „das Konto“, kein Gerät ist einzeln sperrbar |
| Signierte Requests (alter Gerätemodus) | `http-proof.mjs:2-5` kanonischer Nachweis `['shellherd-sync-http-v1', serverId, serverUrl, method, path, nonce, deviceId, sha256(body)]`; `http-transport.mjs:16-26` Challenge + Ed25519-Signatur je Request; Server: Nonce-Map 30 s, einmalig, ≤ 128 (`server.mjs:119-123,135-138`), Verifikation `:149-155`; Roster mit Admin-Signatur, Enrollment-Dokument `server-access.mjs:16-23`, atomare `access.json` `:105-113` | Alles nur im Modus `account === null` (`server.mjs:28-29`), mit eigenem Objektformat (`shellherd-lab-snapshot-v1`, `:46-54`) und libsodium im Client. Rendezvous verlangt Login-Modus (`server.mjs:30-31`). Zwei Welten, die nicht zusammenpassen |
| Geräteidentität im Client | `identity.ts:14-18` nur X25519 (`privateKey`, SPKI, `id = sha256(SPKI)`), Datei v2 mit MAC (`:50-55,37-44`), safeStorage ohne `basic_text` (`:238-249`), Laden erst bei `goOnline` (`remote/lab-host.ts:249-251`); Sync-Lab hat **keine** Identität | Kein Signaturschlüssel. `docs/plans/selfhosted-protocol.md` (Tabelle „Getrennte Schlüssel“) verlangt einen eigenen Ed25519-Signaturschlüssel je Gerät, getrennt von der Noise-Identität |
| Sync-Schlüssel | `vault-sync-crypto.ts:30-33` `K_version = HKDF(vaultKey, [serverId, namespace], 'shellherd-vault-sync-version-v1')`; Serverobjekte im Format `terminus-encrypted-vault` mit dem **Vault-KDF samt Salt** (`:35-43`, `vault-file-wire.mjs`); `openDocument` verlangt KDF-Gleichheit (`:45`); Import leitet den Schlüssel aus dem Vault-Passwort ab (`vault-sync.ts:238-247`) | I1: Serverbackup = Salt + Chiffrat → Offline-Raten des Vault-Passworts mit Argon2id 64 MiB/3. I2: Vault-Schlüssel ist zugleich AES-Schlüssel der Datei und HKDF-IKM. Nebenbefund: ein Vault-Passwortwechsel (neuer Salt) macht alle Serverobjekte `wrongVault` |
| Löschen | `server.mjs:170-181` `DELETE` nur mit Token; H2-Ruling 11: Konto = Löschrecht | Nicht einem Gerät zuzuordnen; ein 15-min-Token-Dieb löscht anonym |
| Verlaufsschutz | `vault-sync.ts:97-110` `acked ⊆ listing ∪ compacted`, fehlender Parent nur wenn kompaktiert (`:59-68`); Versionen content-adressiert und AEAD-authentifiziert | I3: Zurückhalten **nie gesehener** Objekte (konsistenter Schnitt) ist nicht erkennbar; ein frisches Gerät hat keinen Vergleichspunkt. Keine Zuordnung „welches Gerät hat diese Version erzeugt“ |
| Rendezvous-Registrierung | `rendezvous.mjs:72-86` Besitznachweis (statisch-ephemer), ein Gerät je Token-Owner | Der Server kennt kein Verzeichnis erlaubter Gerätesch­lüssel; jeder Kontobesitzer registriert beliebige Schlüssel (N2 nur „Besitz“, nicht „Zugehörigkeit“) |
| run-app | `driver.mjs:41` `--password-store=basic` ⇒ Identität nur im RAM (`SKILL.md:88`), neuer Fingerabdruck je Start; Fake-Server frisch je Szene (`run-app/rendezvous.mjs:12-17`) | Mit einem Geräte-Roster würde jede Szeneninstanz eine dauerhafte Roster-Leiche hinterlassen, wenn der Server persistent wäre |

Gut und unverändert: Noise-XX-Kanal (H2), 16-Hex-Prüfung, Pins, Permission-Handler/CSP, Kompaktierung mit `compacts`, Limits pro Quelle, Besitznachweis bei der Registrierung, atomare Dateischreibmuster, `O_NOFOLLOW`/`nlink`-Prüfungen.

---

## 2. Bewertung der fünf H3-Punkte

### 2.1 Gerätesignaturen statt Serverpasswort (Kern)

**Zwei Wege, eine Entscheidung.** (a) Jeder Request signiert (wie `http-transport.mjs:16-26`): zwei Roundtrips je Request (Challenge + Request), der Rendezvous-Broker müsste `owner` vom Token-Digest auf Geräte-ID umstellen (`rendezvous.mjs:42,57`), Presence-Loop und `refresh` ändern sich, Poll alle 5 s verdoppelt den Verkehr. (b) **Sitzung per signierter Challenge**: `GET /v1/challenge` (vorhanden, `server.mjs:119-123`) → `POST /v1/session {device, nonce, signature}` → heutiges 15-min-Token, serverseitig an das Gerät gebunden. Objekte, Rendezvous, `refresh`, `logout`, Presence bleiben byteidentisch. **Entscheidung: (b).** Ehrlich benannt: Das Token ist weiterhin ein Inhaberausweis für 15 min; das ist dieselbe Klasse wie der private Schlüssel im Main-RAM (beides liegt im selben Prozess). Gewinn gegenüber (a) entfällt nur bei einem kompromittierten TLS-Terminator, der in unserem Betrieb auf demselben Host wie der Server läuft. Gewinn gegenüber heute: **kein Passwort mehr auf der Leitung im Normalbetrieb**, jede Sitzung einem Gerät zugeordnet, Widerruf wirkt sofort (`authorize` prüft das Roster bei jedem Request).

**Rolle des Passworts: nur Einschreibung.** `POST /v1/devices` trägt einmal je Gerät Benutzername + Passwort + ein selbstsigniertes Einschreibedokument (Muster `server-access.mjs:16-23`). Danach weist sich das Gerät nur noch mit seinem Ed25519-Schlüssel aus. `POST /v1/login` entfällt ersatzlos (kein Downgrade, SEC-04). Die M3-Prüfung „Serverpasswort ≠ Vault-Passwort“ läuft weiter vor dem Senden (`sync-prototype/lab-host.ts:61-63`, `remote/lab-host.ts:228-230`). Abgelehnt: Einschreibecodes, die ein bereits eingeschriebenes Gerät ausstellt (würde das Passwort ganz entbehrlich machen) – richtiger nächster Schritt, aber ein zweiter Einschreibepfad plus UI auf beiden Geräten; **nicht jetzt** (§9).

**Welche Schlüssel, eine Identität.** Das Gerät behält den X25519-Schlüssel (Noise-Statik, Fingerabdruck, Pins) und bekommt einen **zusätzlichen Ed25519-Signaturschlüssel**; beide liegen in derselben Identitätsdatei (v3). Keine Umrechnung X25519↔Ed25519 (Eigenbau). Der **Fingerabdruck bleibt `sha256(SPKI X25519)`** – er ist heute Geräte-ID im Rendezvous, Pin, Anzeige und Szenenprüfung. Das Einschreibedokument bindet Signaturschlüssel und Noise-Schlüssel an diese ID; der Server speichert beides im Roster. Folge: `PUT /v1/rendezvous/devices` kann verlangen, dass der registrierte `publicKey` dem Noise-Schlüssel des Sitzungsgeräts entspricht – N2 ist damit nicht nur „Besitz“, sondern „Zugehörigkeit“. Das Sync-Lab lädt dieselbe Identität (eine Store-Instanz für beide Labs, in `index.ts` erzeugt).

**Roster am Server:** `devices.json` im Datenverzeichnis (Muster `access.json`, atomar, 0600), Einträge `{id, name, signingKey, noiseKey, enrolledAt, revokedAt|null}`, höchstens 16 aktive, widerrufene bleiben (Obergrenze 64 Einträge, 64 KiB), damit ältere Versionen zuordenbar bleiben. `GET /v1/devices` (Token) listet; `DELETE /v1/devices/:id` **signiert** (Challenge + `x-shellherd-*`-Header wie `http-transport.mjs:22-24`, zusätzlich Token) – Rosteränderungen tragen immer eine Gerätesignatur, ein Token-Dieb kann nicht aussperren. Widerruf löscht die Sitzungen und die Rendezvous-Präsenz des Geräts sofort. Ein widerrufenes Gerät darf mit Passwort erneut eingeschrieben werden (Besitzer-Autorität; gleicher Schlüssel → `revokedAt = null`).

**Replay, Uhr, Body, Limits.** Nonce einmalig, 30 s, serverseitig erzeugt → kein Zeitstempel, keine Uhrabweichung. Sitzungsnachweis bindet `serverId` + `namespace` + Nonce + Geräte-ID, nicht die URL (hinter Caddy kennt der Server seine öffentliche URL nicht sicher; `publicUrl` ist optional). Gegen Relay (Server A reicht Challenge von B weiter) pinnt der **Client je Einschreibung `serverUrl`** in der Identitätsdatei und signiert für eine `serverId` nur gegenüber der gepinnten URL. Body-Bindung ist nur beim signierten `DELETE /v1/devices/:id` nötig (leerer Body, Pfad im Nachweis). Limits: `enroll:`/`session:` je Quelle wie `login` (5/min + Backoff, `rate-limit.mjs:3`), neu `deviceWrites` 60/min je Gerät für `PUT`/`DELETE` auf Objekten, `challenge:` je Quelle wie `info` (30/min).

**Temporäre Identität (`--password-store=basic`).** Ohne OS-Schlüsselablage bleibt die Identität im RAM (`identity.ts:165-177`). Eine Einschreibung würde das Roster bei jedem Start füllen. Entscheidung: Der Client sendet `ephemeral: true`, wenn die Identität nicht persistent ist; der Server hält solche Geräte **nur im RAM** (≤ 8, Ablauf 12 h nach der letzten Sitzung, weg bei Neustart), zeigt sie in der Liste als `ephemeral`. Beide Labs zeigen den vorhandenen Hinweis „Temporäre Geräteidentität“ ergänzt um die Folge. Die run-app-Szenen laufen damit unverändert gegen den frischen Fake-Server. Kein Klartext-Fallback (N5-Regel bleibt).

### 2.2 DELETE an Geräte binden

Mit (b) ist **jede** Sitzung eine Gerätesitzung; `DELETE …/objects/:id` ist damit zugeordnet, sofort widerrufbar und per Gerät gedrosselt. Eine zusätzlich signierte Löschung, die andere Clients prüfen, bringt nichts: andere Clients sehen gelöschte Objekte nicht, sondern die `compacts`-Liste in der Kompaktierungsversion `C` – AEAD unter dem Sync-Schlüssel, also nur von einem Schlüsselinhaber erzeugbar. Wer kompaktiert hat, wird mit den Autorensignaturen (§2.3, Stufe 2) nachweisbar. **Keine signierten Tombstones, kein neues Objekt.**

### 2.3 Verlaufsanker – ehrlich bewertet, stark gekürzt

Was der DAG heute schon leistet: Jede Version ist content-adressiert, AEAD-authentifiziert und listet ihre Parents (= die Sicht ihres Autors). `acked` erkennt jedes Zurückdrehen gesehener Objekte; ein fehlender Parent ist nur erlaubt, wenn kompaktiert. Eine Version, die ein Gerät erzeugt, ist für dieses Gerät bereits ein „Anker“: fehlt sie später, kommt `history`.

Was ein signierter Anker (Gerät, Zähler, gesehene Köpfe, Vektoruhr) **zusätzlich** leisten würde, habe ich durchgespielt:
- Rollback eigener Objekte: schon abgedeckt (`acked`).
- Fork durch den Server: Der Server kann keine Versionen erzeugen (kein Sync-Schlüssel); „Fork“ ist nur Partition (A sieht X, B nicht). Sobald irgendeine Version X referenziert, muss X da sein (`validate`). Nicht referenzierte, zurückgehaltene Köpfe sind von einem offline-Gerät nicht zu unterscheiden – mit oder ohne Vektoruhr.
- Frisches Gerät: Ein alter konsistenter Schnitt ist ohne externen Vergleichspunkt nicht erkennbar (Threat-Model „Historie“); ein Anker mit Zähler hilft nicht, weil der Server ältere Anker konsistent zeigen kann. Der Import erkennt das Lügen erst, wenn das betrogene Gerät später auf die vollständige Sicht trifft – dann als Konflikt, nicht als Alarm, weil es von „war offline“ ununterscheidbar ist.
- Konsistenter Schnitt (Freeze aller Geräte): grundsätzlich nur mit zweitem Kanal oder vertrauter Zeit erkennbar. Bleibt dokumentierte Grenze.

**Entscheidung:** Keine Vektoruhren, keine Anker-Objekte. Stattdessen **Autorenstempel in der Version** (Stufe 2, abtrennbar, §9): `author: { device, signature }` mit Ed25519 über `['shellherd-sync-author-v1', serverId, namespace, parents, compacts ?? [], sha256(stable(portable)), device]`. Nutzen: Zuordnung jeder Version und jeder Kompaktierung zu einem Gerät, Prüfung gegen das Roster beim Empfang, **Quarantäne neuer Versionen widerrufener Geräte** (Protokollplan: „Ein wiederkehrendes entzogenes Gerät darf keine automatische Konsolidierung erzwingen“) und auf dem frischen Gerät die Regel „der importierte Kopf stammt von einem eingeschriebenen Gerät“. Unbekannter Autor (Eintrag verloren, temporäres Gerät abgelaufen) → Version bleibt gültig (die AEAD bürgt für einen Schlüsselinhaber), wird gezählt und gemeldet, nicht verworfen – sonst bricken abgelaufene temporäre Geräte die Historie. Sicherheitswert bescheiden, Kosten klein, deshalb Stufe 2 und nicht Pflicht.

### 2.4 Zufälliger Sync-Schlüssel und Übergabe

**Schlüssel:** `K_sync` = 32 Zufallsbytes, erzeugt vom ersten Gerät beim ersten Abgleich eines leeren Kontos. Versionsschlüssel `HKDF-SHA256(K_sync, salt = utf8(JSON([serverId, namespace])), info = 'shellherd-sync-version-v2', 32)`. Serverobjekte tragen **kein KDF mehr** → neues Hüllformat `shellherd-sync-object` (§5). I1: Backup = Chiffrat + Keybox unter 128-Bit-Code → 2^128, unabhängig vom Vault-Passwort. I2: Der Vault-Schlüssel verschlüsselt keine Serverobjekte mehr; lokal bleibt `HKDF(vaultKey, …, 'state')` für den Checkpoint (`vault-sync-state.ts:38,42`) – Schlüsseltrennung per HKDF ist der Zweck von HKDF, akzeptiert. `K_sync` liegt im Checkpoint (`.sync-state` v2, verschlüsselt unter dem Vault-Schlüssel, dieselbe Schutzklasse wie der Vault selbst).

**Übergabe:** Drei Wege geprüft. (1) **Wiederherstellungscode**: 16 Zufallsbytes, Anzeige als 32 Hex in acht Vierergruppen (passt zur Hex-Konvention der Fingerabdrücke); Keybox = AES-256-GCM(`HKDF(code, salt wie oben, 'shellherd-sync-keybox-recovery-v1')`, `K_sync`) als Serverobjekt `kind: 'keybox'`. 128 Bit Zufall brauchen kein Argon2 (Raten ist unabhängig von der KDF-Kosten unmöglich); HKDF genügt. (2) Pro Gerät gewrappt unter dessen X25519-Schlüssel: Node hat keine Sealed Box; ECIES aus X25519 + HKDF + GCM wäre Eigenkomposition (R-H3) → nein. (3) Noise-Pairing über den H2-Kanal: beide Geräte gleichzeitig online, Sync-Lab bräuchte Presence, Anfrage, Zustimmungsdialog → Umfangsexplosion. **Entscheidung: nur (1).** Der Code wird genau einmal im Renderer gezeigt (wie ein Fingerabdruck) und ist nie Teil von `SyncLabState` (nur in der einen Antwort). Jedes Gerät mit `K_sync` kann einen neuen Code erzeugen (neue Keybox, alte gelöscht). Der Import braucht den Code **und** ein neues lokales Vault-Passwort (die Datei wird neu angelegt); die M3-Importprüfung (`samePasswordImport`) bleibt sinnvoll und bleibt.

**Rotation von `K_sync`** (nach Geräteverlust): nicht jetzt. Ein widerrufenes Gerät behält seine Kopie; der Widerruf verhindert neue Downloads, nicht das Lesen bereits geladener Daten (Threat-Model, T04-Grenze). Dokumentiert.

### 2.5 TOTP bei der Einschreibung

**Nein, nicht jetzt.** Gründe: Einschreibung ist selten (einmal je Gerät); das Passwort hat ≥ 16 Zeichen oder ist generiert (H1), Backoff je Quelle; ein zweites Servergeheimnis (TOTP-Seed) plus Provisionierung/QR/Uhrabgleich ist Aufwand ohne Reviewgewinn, solange ein gestohlenes Passwort ohnehin **sichtbar** wird (Roster, §9 Extra „Neues Gerät“-Hinweis) und ohne Code keinen Zugriff auf Klartext gibt. Der bessere zweite Faktor ist der Einschreibecode eines eingeschriebenen Geräts (H4).

---

## 3. Empfehlung je Fläche

| Fläche | Empfehlung | Wert | Aufwand |
| --- | --- | --- | --- |
| Server-Auth (`server.mjs`, `account-auth.mjs`) | `POST /v1/devices` (Passwort + signiertes Dokument), `GET /v1/challenge` auch im Kontomodus, `POST /v1/session` signiert → Token mit Gerät, `authorize` prüft Roster, `/v1/login` weg, `GET /v1/devices`, signiertes `DELETE /v1/devices/:id`, Budgets je Gerät | ★★★ | Server-Skript |
| Roster (`device-roster.mjs`, neu) | persistente `devices.json`, temporäre Geräte im RAM, atomare Schreibmuster | ★★★ | Server-Skript |
| Rendezvous (`rendezvous.mjs`) | registrierter `publicKey` = Noise-Schlüssel des Sitzungsgeräts | ★★ | eine Prüfung |
| Objektformat (`sync-object-wire.mjs`, neu) | `shellherd-sync-object` v1 für `version` und `keybox`; Altformat nur lesbar | ★★★ | Server + Client |
| Client-Transport (`account-transport.mjs`, `device-proof.mjs`) | `enroll`, `openSession`, `devices`, `revoke`; `login` entfällt | ★★★ | Skript |
| Identität (`identity.ts`) | Datei v3: X25519 + Ed25519 + Einschreibungen je Server, MAC über alles; reine Node-Schlüsselerzeugung ohne Skriptimport | ★★★ | kleine Main-Änderung |
| Sync-Kern (`vault-sync.ts`, `vault-sync-crypto.ts`, `vault-sync-state.ts`) | `K_sync`, Keybox, Code erzeugen/eingeben, Checkpoint v2, Keyboxen nie „fremd“, Autorenstempel (Stufe 2) | ★★★ | Main |
| Sync-Lab (Host, IPC, Dialog) | Einschreiben statt Anmelden, Auto-Sitzung, Code-Anzeige einmalig, Code-Eingabe, Import mit Code + neuem Passwort, Geräteliste mit Entfernen | ★★★ | Main + Renderer |
| Remote-Lab (Host, IPC, Dialog) | Einschreiben statt Anmelden, Identität schon beim Anmelden laden, Gerätename ins Anmeldeformular, temporäre Einschreibung | ★★★ | Main + Renderer |
| Betrieb/Doku | README-Abschnitt „Geräte“, API-Tabelle, Handbuch, Threat-Model-Stand H3, Protokollplan, Szenen | ★★ | Doku |
| „Neues Gerät im Konto“-Hinweis (Roster-TOFU im Client) | Extra | ★★ | Main + Renderer |
| Vektoruhren/Anker-Objekte, Noise-Pairing für den Schlüssel, Per-Gerät-Keybox, `K_sync`-Rotation, Einschreibecodes, TOTP, OPAQUE | **nicht jetzt** | – | – |

---

## 4. Verträge und Signaturen (wörtlich zu übernehmen)

### 4.1 `scripts/sync-prototype/device-proof.mjs` (neu, T1; Server und Client importieren es)

```js
export const DEVICE_ENROLLMENT = 'shellherd-device-enrollment-v1';
export const DEVICE_SESSION = 'shellherd-device-session-v1';
export const DEVICE_REQUEST = 'shellherd-device-request-v1';
/** Body of the self-signed enrollment document; `deviceId` = sha256 hex of the X25519 SPKI DER (rendezvous deviceId). */
export function enrollmentBody(serverId, namespace, deviceId, signingKeyB64 /* 32 raw */, noiseKeyB64 /* 60-char SPKI */, name) // → JSON string
export function sessionProof(serverId, namespace, nonce, deviceId) // → JSON string of [DEVICE_SESSION, serverId, namespace, nonce, deviceId]
export function requestProofV2(serverId, namespace, method, path, nonce, deviceId) // → JSON string of [DEVICE_REQUEST, serverId, namespace, method, path, nonce, deviceId]
export function ed25519Spki(raw32) // → Buffer DER with prefix 302a300506032b6570032100
```
`http-proof.mjs` bleibt unverändert für den alten Gerätemodus.

### 4.2 `scripts/sync-prototype/sync-object-wire.mjs` (neu, T1)

```js
export const SYNC_OBJECT_KINDS = ['version', 'keybox'];
/** Strict envelope: exactly format,version,kind,cipher,payload; canonical (JSON.stringify(parsed) === wire); payload base64 ≤ 1 MiB; nonce 12, authTag 16. Throws on legacy or anything else. */
export function validateSyncObject(wire) // → { kind }
/** True for the H1/H2 format (terminus-encrypted-vault); used by the server only to tolerate old files on disk. */
export function isLegacyVaultObject(wire)
```
Server: beim Start (`server.mjs:64-70`) `validateSyncObject(wire)` **oder** `isLegacyVaultObject(wire)`; `PUT` nur `validateSyncObject` (Altformat → 400); `GET` liefert beides (der Client überspringt Altformat als unlesbar; „Fremde Objekte entfernen“ räumt es weg).

### 4.3 `scripts/sync-prototype/device-roster.mjs` (neu, T1)

```js
export async function createDeviceRoster({ directory, serverId, namespace, clock }) // lädt devices.json (0600, nlink 1, ≤ 64 KiB), sonst leer
// entries: { id, name, signingKey, noiseKey, enrolledAt, revokedAt: number|null, ephemeral: boolean }
roster.enroll({ document, ephemeral }) // prüft Dokument (parseEnrollment-Muster), bindet deviceId === sha256(noiseKey DER); gleicher Eintrag → idempotent; gleiche id, andere Schlüssel → 409; aktive persistente ≤ 16 → sonst 429; schreibt atomar (persistent) oder RAM (ephemeral, ≤ 8)
roster.revoke(id)            // revokedAt = now, schreibt atomar; ephemeral → entfernt
roster.signingKeyOf(id)      // KeyObject oder undefined (auch widerrufene, für Signaturprüfung)
roster.isActive(id)          // eingeschrieben, nicht widerrufen, ephemeral nicht abgelaufen
roster.noiseKeyOf(id); roster.list() // [{ id, name, enrolledAt, revokedAt, ephemeral }]
roster.touch(id)             // ephemeral: letzte Sitzung = now (12 h Ablauf)
roster.assertHealthy()       // 503 bei ungewissem Schreibausgang (wie access.json)
```

### 4.4 `scripts/sync-prototype/account-auth.mjs` (T1)

```js
export function accountAuth(account, clock, limits, roster)
auth.verifyPassword(body, source) // { username, password } wie login(), gibt true oder wirft 401 (zählt Fehlschläge, Backoff, nur eine Prüfung parallel)
auth.openSession(deviceId)       // → { token, expiresAt }; sessions.set(digest, { created, expiresAt, device })
auth.authorize(header)           // zusätzlich check(roster.isActive(session.device), 401) → sonst Sitzung löschen
auth.deviceOf(key)               // Geräte-ID der Sitzung
auth.dropDevice(deviceId)        // alle Sitzungen des Geräts löschen
// login() entfällt; refresh/logout/isActive/fail unverändert
```

### 4.5 `scripts/sync-prototype/server.mjs` (T1)

- `/v1/info`: `authentication: login ? 'enrolled-device' : 'device'`, zusätzlich `deviceSessions: Boolean(login)`. Alte Clients lesen `'enrolled-device'` nicht als `'password'` → `unavailable`. Neue Clients verlangen `deviceSessions === true`.
- `GET /v1/challenge` auch bei `login` (Nonce-Map `server.mjs:119-123` unverändert, Budget `challenge:source` = `limits.info`).
- `POST /v1/devices`: JSON ≤ 16 KiB, Felder exakt `username,password,enrollment,ephemeral?`; Budget `enroll:source` = `limits.login`; `login.verifyPassword` → `roster.enroll` → `201 { device: {id, name, enrolledAt, ephemeral} }` (idempotent 200). Keine Sitzung in der Antwort.
- `POST /v1/session`: Felder exakt `device,nonce,signature`; Budget `session:source` = `limits.login`; Nonce einmalig (auch bei falscher Signatur verbraucht), `verify(null, sessionProof(...), roster.signingKeyOf(device), sig)` und `roster.isActive(device)` → sonst `login.fail(source)`, 401 → `200 { token, expiresAt, device }`; `roster.touch(device)`.
- `POST /v1/login` → 404 (Pfad existiert nicht mehr).
- `GET /v1/devices` (Token): `{ devices: roster.list().map(d => ({ ...d, self: d.id === login.deviceOf(authorized) })) }`.
- `DELETE /v1/devices/:id`: Token **und** Header `x-shellherd-device` (= Sitzungsgerät), `x-shellherd-nonce` (einmalig), `x-shellherd-signature` über `requestProofV2(serverId, namespace, 'DELETE', path, nonce, device)`; `content-length` 0; `roster.revoke(id)`, `login.dropDevice(id)`, `broker?.dropDevice(id)` → `200 { revoked: true }`. Unbekannt → 404.
- Objekte: `PUT`/`DELETE` zusätzlich `budget('device:' + login.deviceOf(authorized), limits.deviceWrites)`; `opaque()` im Login-Modus = `validateSyncObject`.
- `rate-limit.mjs:3`: `deviceWrites: 60` ergänzen.
- `createSyncServer`: `roster = login ? await createDeviceRoster({...}) : null`; `accountAuth(account, clock, limits, roster)`; Startprüfung toleriert `devices.json` neben `access.json` (`server.mjs:66-67`).

### 4.6 `scripts/sync-prototype/rendezvous.mjs` (T1)

`createRendezvous({ authorize, isActive, deviceOf, noiseKeyOf, clock, serverId })`: bei `PUT /devices` zusätzlich `fail(body.publicKey === noiseKeyOf(deviceOf(owner)), 403)` und `fail(key === deviceOf(owner), 403)`; neu `dropDevice(id)` entfernt Gerät und seine Sitzungen. Besitznachweis bleibt.

### 4.7 `scripts/sync-prototype/account-transport.mjs` (T2)

```js
export class AccountStore {
  constructor(info, { signal })            // verlangt info.authentication === 'enrolled-device' && info.deviceSessions === true
  async enroll(identity, { username, password, name, ephemeral }) // POST /v1/devices; prüft Antwort device.id === identity.id
  async openSession(identity)              // GET /v1/challenge → sign(sessionProof) → POST /v1/session; setzt #token; → { signedIn: true, expiresAt, device }
  async devices()                          // GET /v1/devices → Liste validiert (≤ 64, id hex64, name ≤ 80)
  async revoke(identity, id)               // Challenge + signierte Header + Token → DELETE /v1/devices/:id
  // request/list/put/get/remove/refresh/logout/close unverändert; put/get validieren mit validateSyncObject statt validateVaultFile
}
```
`identity` hat die Form aus §4.8 (`id`, `publicKey`, `privateKey`, `signingKey`, `signingPublicKey`). Signieren mit `sign(null, Buffer.from(proof), identity.signingKey)`.

`http-common.mjs` `probeSyncServer`: `authentication: ['password','device','enrolled-device'].includes(info.authentication) ? info.authentication : 'device'`, `deviceSessions: info.deviceSessions === true`.

### 4.8 `src/main/remote/identity.ts` (T4)

```ts
export interface RemoteIdentity { privateKey: KeyObject; publicKey: string; id: string; signingKey: KeyObject; signingPublicKey: string /* base64 raw 32 */ }
export interface Enrollment { serverId: string; namespace: string; serverUrl: string; username: string; name: string; enrolledAt: number }
export class RemoteIdentityStore {
  constructor(file: string, cipher: IdentityCipher) // generate/derive sind jetzt intern (Node crypto), kein Skriptimport
  load(): { identity: RemoteIdentity; persistent: boolean }
  enrollment(serverId: string): Enrollment | undefined
  rememberEnrollment(e: Enrollment): void      // ≤ 16, ersetzt gleiche serverId; persistiert mit MAC
  forgetEnrollment(serverId: string): void
  // known/renamed/remember unverändert
}
export function deviceFingerprint(spkiBase64: string): string // bytegleich zu rendezvous.mjs deviceId()
```
Datei v3: `identity` = safeStorage(`JSON.stringify(['shellherd-device-identity-v3', b64(pkcs8 X25519), b64(pkcs8 Ed25519), b64(macKey)])`), `knownDevices` unverändert, neu `enrollments: Enrollment[]`, `mac` über `[MAC_DOMAIN_V3, identity, devices…, enrollments…]`. Migration v2 → v3: X25519 behalten (Pins bleiben, E11), Ed25519 erzeugen, ein atomarer Schreibvorgang; v1 → v3 wie bisher über v2-Regeln. Nicht persistente Identität: `enrollments` nur im RAM.

### 4.9 `src/main/sync-prototype/vault-sync-crypto.ts`, `vault-sync.ts`, `vault-sync-state.ts` (T3)

```ts
export interface SyncContext { serverId: string; namespace: string; device?: { id: string; sign(data: Buffer): Buffer; keyOf(id: string): KeyObject | undefined; revoked(id: string): boolean } }
export class SyncFailure { code: … | 'syncKey' | 'recoveryCode' | 'migrate' }
export function generateRecoveryCode(): string            // 32 hex lower
export function normalizeRecoveryCode(input: string): string | null // strips non-hex, lower-cases; exactly 32 hex or null
export function sealSyncObject(kind: 'version'|'keybox', document: unknown, key: Buffer, context: SyncContext): string // wire (canonical)
export function openSyncObject(wire: string, kind, key, context): unknown                       // throws wrongVault
export function keyboxWrapKey(code: string, context: SyncContext): Buffer                      // HKDF(codeBytes, salt=JSON([serverId,namespace]), 'shellherd-sync-keybox-recovery-v1')
export const SYNC_OBJECT_FORMAT = 'shellherd-sync-object';
```
- Versionsschlüssel `HKDF(K_sync, salt, 'shellherd-sync-version-v2')`; AAD `stable([SYNC_OBJECT_FORMAT, 1, kind, context.serverId, context.namespace])`.
- `VaultSyncResult` ergänzt `recoveryCode?: string` (nur in der Antwort, nie im Zustand), `unknownAuthors?: number`, `quarantined?: number` (Stufe 2).
- `synchronizeVault(sessions, remote, context, signal, options?: { keepLocalRevision?: string; recoveryCode?: string })`: Checkpoint v2 lesen (`kind: 'shellherd-sync-state-v2'`, Feld `syncKey` base64); v1-Checkpoint → `migrate`. Ohne `syncKey`: Listing laden, Objekte mit `kind: 'keybox'` sammeln; gibt es keine **und** keine Versionen → `K_sync` erzeugen, Code erzeugen, Keybox hochladen, `syncKey` persistieren, `recoveryCode` zurückgeben; gibt es Keyboxen und keinen Code → `syncKey`; mit Code: jede Keybox öffnen, Treffer → `syncKey` persistieren, sonst `recoveryCode`.
- `pull()`: Keyboxen nie als `foreign`, nie als Version; Altformat/Unlesbares → `foreign` wie heute.
- `importSyncedVault(sessions, remote, context, recoveryCode, newPassword, signal, selectPath)`: Code → Keybox → `K_sync`; Vault-Datei mit **neuem KDF** (`encryptVault(vault, newPassword)`-Parameter wie `vault/crypto.ts` Standard) schreiben; Checkpoint mit `syncKey`.
- `regenerateRecoveryCode(sessions, remote, context, signal)`: neue Keybox hochladen, alte Keyboxen löschen, Code zurückgeben.
- `removeForeignObjects`: Kandidaten mit `kind: 'keybox'` werden nie gelöscht.
- Stufe 2: `create()` signiert mit `context.device.sign`; `tryAdd` prüft Signatur über `context.device.keyOf(author.device)`; unbekannt → gültig + `unknownAuthors++`; widerrufen und nicht in `acked`/Vorfahren bekannter Köpfe → `null` + `quarantined++`.

### 4.10 `src/shared/sync-lab.ts`, `remote-lab.ts` (T5)

```ts
// sync-lab.ts
| { kind: 'signIn'; username: string; password: string; deviceName: string }   // = einschreiben + Sitzung
| { kind: 'openSession' }                                                        // bereits eingeschrieben
| { kind: 'synchronize'; recoveryCode?: string }
| { kind: 'importVault'; recoveryCode: string; password: string }
| { kind: 'regenerateCode' } | { kind: 'revokeDevice'; id: string } | { kind: 'listDevices' }
server?: { …; authentication?: 'password' | 'device' | 'enrolled-device'; deviceSessions?: boolean }
account?: { signedIn: true; username: string; device: { fingerprint: string; name: string; persistent: boolean } }
devices?: { id: string; name: string; enrolledAt: number; revokedAt: number | null; ephemeral: boolean; self: boolean }[]
enrolled?: { username: string; name: string }   // vor der Sitzung: Einschreibung bekannt
sync?: { …; unknownAuthors?: number; quarantined?: number }
SyncLabReply ok: { …; recoveryCode?: string }
code: … | 'identity' | 'syncKey' | 'syncRecoveryCode' | 'syncMigrate'
// remote-lab.ts
| { kind: 'signIn'; username: string; password: string; deviceName: string }
account?: { username: string; validUntil: number; device: { fingerprint: string; name: string; persistent: boolean } }
state.enrolled?: { username: string; name: string }
```

### 4.11 `src/main/sync-prototype/lab-host.ts`, `lab-ipc.ts` (T7)

- Konstruktor bekommt `identity?: () => RemoteIdentityStore`; `AccountDriver` = §4.7-Form (`enroll`, `openSession`, `devices`, `revoke`, …; `login` entfällt).
- `connect`: nach Probe `store.load()` (Fehler → `identity`), `enrolled = store.enrollment(info.serverId)` wenn `enrollment.serverUrl === info.serverUrl`, sonst ignorieren (Relay-Schutz) → Zustand `enrolled`.
- `signIn`: M3-Prüfung wie heute; `account.enroll(identity, { username, password, name: deviceName, ephemeral: !persistent })` → `openSession` → `store.rememberEnrollment` (nur persistent) → Passwort-Digest halten (E3) → `account`, dann `listDevices`.
- `openSession`: nur mit `enrolled`; `account.openSession(identity)`; 401 → `store.forgetEnrollment`, Code `authentication`.
- `performSync`: `synchronize` reicht `recoveryCode` durch; Antwort mit `recoveryCode` einmalig, danach nie in `current.sync`; `regenerateCode` ebenso; `importVault` mit `recoveryCode` + `password` (M3-Importprüfung bleibt); Code-Map ergänzt `syncKey`, `recoveryCode: 'syncRecoveryCode'`, `migrate: 'syncMigrate'`.
- `revokeDevice`: `account.revoke(identity, id)`; danach `devices` neu laden; eigenes Gerät → anschließend `close`-Semantik (Sitzung ist weg).
- `lab-ipc.ts`: `buildSyncLabHost(transport, account, { sessions, identity })`; `SyncContext.device` aus der Identität (`sign` mit `signingKey`, `keyOf` aus der letzten Geräteliste, `revoked` aus `revokedAt`); `registerSyncLabIpc({ sessions, identity, onSynced })`.

### 4.12 `src/main/remote/lab-host.ts`, `lab-ipc.ts`, `src/main/index.ts` (T8)

- `RemoteAccount`: `enroll`, `openSession`, `devices`, `revoke`, `request`, `refresh`, `logout`, `close`.
- `#connect`: verlangt `info.authentication === 'enrolled-device' && info.deviceSessions && rendezvous && rendezvousProof && rendezvousNoise`; lädt Identität (`identity` bei Fehler), setzt `state.enrolled`.
- `#signIn(username, password, deviceName)`: wie heute M3, dann `enroll` + `openSession`; `#openSession()` ohne Passwort. `#goOnline(name)` nutzt den Gerätenamen aus der Einschreibung, wenn das Feld leer ist; Identität ist bereits geladen.
- `lab-ipc.ts`: `registerRemoteLabIpc({ isUnlocked, matchesVaultPassword, identity })`; Store-Erzeugung wandert nach `index.ts:265-266`: `const identity = new RemoteIdentityStore(join(app.getPath('userData'), 'remote-identity.json'), safeStorageCipher())`, an beide Register-Funktionen übergeben (eine Instanz, eine Datei).

---

## 5. Wire-Formate

**Hülle (Server sieht genau das):**
```json
{ "format": "shellherd-sync-object", "version": 1, "kind": "version", "cipher": { "algorithm": "aes-256-gcm", "nonce": "<b64 12>", "authTag": "<b64 16>" }, "payload": "<b64>" }
```
ID = `sha256(wire)` wie heute. `kind` ∈ `version | keybox`. Keine weiteren Felder, kanonisch.

**Version (Klartext):** `{ kind: 'shellherd-sync-version-v2', parents, portable, compacts?, author?: { device, signature } }`. Schlüssel `HKDF(K_sync, utf8(JSON([serverId, namespace])), 'shellherd-sync-version-v2', 32)`, AAD `stable(['shellherd-sync-object', 1, 'version', serverId, namespace])`.

**Keybox (Klartext):** `{ kind: 'shellherd-sync-keybox-v1', method: 'recovery', syncKey: '<b64 32>', createdBy: '<device hex64>' }`. Schlüssel `HKDF(codeBytes16, utf8(JSON([serverId, namespace])), 'shellherd-sync-keybox-recovery-v1', 32)`, AAD `stable(['shellherd-sync-object', 1, 'keybox', serverId, namespace])`.

**Checkpoint (lokal):** außen `['shellherd-private-sync-state-v2', <terminus-encrypted-vault wie heute>]`, innen `{ kind: 'shellherd-sync-state-v2', syncKey, versions, acked, localHeads, working, projection, pending? }`; Schlüssel unverändert `HKDF(vaultKey, …, 'shellherd-vault-sync-state-v1')`.

**Einschreibedokument:** `[[ 'shellherd-device-enrollment-v1', serverId, namespace, deviceId, signingKey(b64 32), noiseKey(SPKI b64 60), name ], signature(b64 64)]`, Signatur Ed25519 über `JSON.stringify(body)`.

**Sitzungsnachweis:** `JSON.stringify(['shellherd-device-session-v1', serverId, namespace, nonce, deviceId])`, Signatur im Body `signature` (b64 64).

**Signierter Request:** `JSON.stringify(['shellherd-device-request-v1', serverId, namespace, method, path, nonce, deviceId])`, Header `x-shellherd-device`, `x-shellherd-nonce`, `x-shellherd-signature`.

**Wiederherstellungscode:** 32 Hex, Anzeige `xxxx-xxxx-xxxx-xxxx-xxxx-xxxx-xxxx-xxxx`, Eingabe tolerant (Leerraum, Bindestriche, Großschreibung).

Ablauf Gerät B (neu) im Sync-Lab: Verbinden → Einschreiben (Passwort einmal, Gerätename) → Sitzung → „Vault vom Server laden“ mit Code + neuem Vault-Passwort → Keybox öffnen → Versionen laden → Datei schreiben → Checkpoint mit `syncKey`. Danach nur noch Sitzung per Signatur.

---

## 6. Migration und Kompatibilität (Lab-only, Bruch erlaubt)

| Bestand | Verhalten nach H3 |
| --- | --- |
| Clients H2 gegen Server H3 | `POST /v1/login` → 404 → `connection`; `authentication` ist `'enrolled-device'` → beide Labs `unavailable`. Bewusst, dokumentiert |
| Clients H3 gegen Server H2 | `deviceSessions` fehlt → `unavailable`. Kein Downgrade |
| `server.json` | unverändert (`account,namespace,serverId`, `server/main.mjs:19`); `init`/`rotate-password` bleiben und betreffen nur die Einschreibe-Berechtigung. Passwortwechsel widerruft **keine** Geräte (README sagt es; Widerruf ist eine eigene Aktion) |
| Objekte H2 auf der Platte | Server startet (Altformat lesbar), `PUT` im Altformat → 400; Clients sehen sie als unlesbar (`skipped`) und entfernen sie mit „Fremde Objekte entfernen“. README: „Vor H3 Konto leeren oder danach einmal Fremde Objekte entfernen“ |
| `.sync-state` v1 | `syncMigrate` mit Anleitung (Datei löschen, der lokale Vault wird als neue Wurzel hochgeladen). Keine stille Weiterverwendung alter Versionen |
| `remote-identity.json` v2 | automatisch v3; Fingerabdruck, Pins (E11) und Rendezvous-ID bleiben |
| Alter Gerätemodus (`account === null`, `server-access.mjs`, `client-access.mjs`, `device-enrollment.mjs`, `protocol.mjs`, `/v1/enrollments`, `/v1/access`) | unberührt. Namensvorsicht: dort heißt es `enrollment`/`deviceEnrollment`; neu ist `devices`/`deviceSessions` |
| run-app `remote-scene.mjs` | Anmeldeformular hat ein Gerätename-Feld; Identität temporär → `ephemeral`; Fake-Server frisch je Lauf |
| `server/smoke.mjs` | zwei Identitäten einschreiben (Passwort), Sitzungen, Rendezvous wie heute, Roster, Widerruf |

---

## 7. Regeln und Risiken – was ausdrücklich nicht getan wird

- **Kein PAKE, kein OPAQUE, kein TOTP, keine Einschreibecodes, keine Sealed Box aus X25519, keine Schlüsselumrechnung.** Nur Node-`crypto`; libsodium bleibt in den Skripten des alten Gerätemodus.
- **Keine Signatur je Request im Normalbetrieb** (nur Sitzungsaufbau und Rosteränderungen). Der Token bleibt 15 min gültig und ist derselbe Risikoklasse wie der Schlüssel im Main-RAM.
- **Keine Vektoruhren, keine Anker-Objekte, keine signierten Tombstones.** Der konsistente Schnitt bleibt unerkennbar; Threat-Model-Grenze „Historie“ bleibt wörtlich bestehen.
- **Keine Rotation von `K_sync`, keine Per-Gerät-Keyboxen, kein Noise-Pairing für den Schlüssel.** Ein widerrufenes Gerät behält seine Schlüsselkopie und seine lokalen Daten (T04-Grenze, dokumentiert).
- **Kein Klartext-Fallback der Identität.** Temporäre Identität ⇒ temporäre Einschreibung am Server.
- **Keine Server-GC des Rosters, keine Heuristik.** Widerrufene Einträge bleiben bis zur Obergrenze 64.
- Risiko Passwort bei der Einschreibung: Es geht genau einmal je Gerät über TLS/Tunnel. Ein in diesem Moment bösartiger Server kennt es danach – und kann damit Geräte einschreiben (sichtbar im Roster), aber ohne Code keinen Klartext lesen. M3 verhindert weiter, dass es das Vault-Passwort ist.
- Risiko Code-Verlust: Ohne Code und ohne Gerät mit `K_sync` ist das Konto nicht ladbar (SEC-11, gewollt). Jedes Gerät mit Schlüssel kann einen neuen Code erzeugen; der Text sagt das beim ersten Anzeigen.
- Risiko Code im Renderer: wird einmal angezeigt wie ein Fingerabdruck, nie in `SyncLabState`, nie geloggt; der Renderer gilt ohnehin als Angriffsfläche, Vault-Passwörter werden dort heute schon getippt.
- Risiko unbekannter Autor (Stufe 2): Versionen bleiben gültig; nur widerrufene Autoren werden quarantänisiert. Ein bösartiger Server kann durch Roster-Fälschung höchstens Verfügbarkeit stören (Quarantäne legitimer Versionen), nie Inhalte erzeugen.
- Risiko Relay: ohne URL im Nachweis schützt nur der Client-Pin `serverUrl` je Einschreibung; ein Nutzer, der dieselbe Identität bewusst an zwei Servern einschreibt, ist durch den Pin je `serverId` weiterhin geschützt.
- Risiko Umfang: zehn Tasks, drei Wellen, zwei Szenen. Stufe 2 (Autorenstempel), Roster-TOFU-Hinweis und `regenerateCode`-UI sind abtrennbar (§9).
- Bewegung/Design: keine neue Bewegung; neue Elemente nutzen bestehende Klassen (`.sync-server-form`, `.settings-hint`, `.secondary-button`, `.remote-lab-fingerprint` für den Code, `.sync-lab-notice`); Tokens unverändert.

---

## 8. Zerlegung in Tasks und Wellen (dateidisjunkt)

Jeder Task arbeitet test-first, ändert nur eigene Dateien, committet nicht. Nach jeder Welle `npm run typecheck` und `npx vitest run` grün. Welle 1 ist grün erst mit T1 **und** T2 zusammen (Integrationstests in `account.test.mjs` nutzen `AccountStore`; Vorgehen H2-E8).

### Welle 1 (parallel)

| Task | Dateien | Pflichtpunkte | Pflichttests |
| --- | --- | --- | --- |
| **T1 Server** | `scripts/sync-prototype/server.mjs`, `account-auth.mjs`, `rendezvous.mjs`, `rate-limit.mjs`, neu `device-proof.mjs`, `device-roster.mjs`, `sync-object-wire.mjs`; Tests `account.test.mjs`, `server.test.mjs`, `server-vault.test.mjs`, `rendezvous.test.mjs`, neu `device-roster.test.mjs`, `sync-object-wire.test.mjs`; `server/smoke.mjs`, `server/main.mjs` (nur falls Roster-Pfad nötig) | §4.1–4.6, §5 | Einschreiben mit falschem Passwort → 401 + Backoff; falsche Dokumentsignatur → 401; `deviceId ≠ sha256(noiseKey)` → 400; idempotent 200, gleiche id/andere Schlüssel → 409; 17. aktives Gerät → 429; Sitzung: falsche Signatur → 401 und Nonce verbraucht; Nonce zweimal → 401; abgelaufen (31 s) → 401; Nachweis mit anderer `serverId`/`namespace` → 401; widerrufen → `POST /v1/session` 401 **und** laufende Sitzung sofort 401 **und** Rendezvous-Gerät weg; `DELETE /v1/devices/:id` ohne Signatur → 401, mit Token eines anderen Geräts aber fremder Signatur → 401; Selbstwiderruf → eigene Sitzung 401; Neustart: Roster persistent, temporäres Gerät weg; temporär 12 h Ablauf; `/v1/login` → 404; `info.authentication === 'enrolled-device'`, `deviceSessions`; Altformat auf Platte → Start ok, `GET` liefert, `PUT` → 400; neues Format validiert strikt (Feld zu viel, Nonce 11 Byte, nicht kanonisch → 400); Keybox-`PUT` zählt im Kontingent; `deviceWrites` 61. PUT/min → 429; Rendezvous `PUT /devices` mit fremdem `publicKey` → 403; Smoke: zwei Einschreibungen, Handshake wie H2, Roster-Liste, Widerruf B → B 401 |
| **T2 Client-Transport** | `account-transport.mjs`, `http-common.mjs`, neu `account-transport.test.mjs` (Fake-`fetch` über `globalThis.fetch`-Stub) | §4.7 | Konstruktor lehnt `authentication !== 'enrolled-device'`/`deviceSessions !== true` ab; `enroll` sendet exakt `username,password,enrollment,ephemeral`; `openSession` holt Challenge, signiert `sessionProof`, prüft `device === identity.id`; `revoke` setzt drei Header + Token; `put`/`get` validieren neues Format, Altformat → wirft; `probeSyncServer` reicht `deviceSessions` durch |
| **T3 Sync-Kern** | `src/main/sync-prototype/vault-sync.ts`, `vault-sync-crypto.ts`, `vault-sync-state.ts`, `vault-sync.test.ts`, neu `vault-sync-crypto.test.ts` | §4.9, §5 | Leeres Konto → `recoveryCode` zurück, Keybox auf Server, `syncKey` im Checkpoint, zweiter Lauf ohne Code `synced`; zweites Gerät ohne Code → `syncKey`; falscher Code → `recoveryCode`, nichts geschrieben; richtiger Code → `synced`, Keybox nicht in `skipped`; Import mit Code + neuem Passwort → Datei mit neuem Salt lesbar, Checkpoint mit `syncKey`; `removeForeignObjects` lässt Keyboxen stehen, löscht Altformat; v1-Checkpoint → `migrate`; `regenerateRecoveryCode` ersetzt Keybox (alte weg); Kompaktierung läuft unter `K_sync` wie H2 (bestehende Tests portiert, keiner gestrichen ohne Ersatz); AAD-Bindung: Objekt unter anderem `namespace` → `wrongVault`; HKDF-Vektoren fest; Stufe 2: signierte Version verifiziert, manipulierter `author` → `null`, unbekannter Autor → gültig + Zähler, widerrufener Autor neu → quarantänisiert, als Vorfahr bekannt → gültig |
| **T4 Identität** | `src/main/remote/identity.ts`, `identity.test.ts` | §4.8 | v2 → v3 ein Schreibvorgang, X25519 bytegleich, Ed25519 32/64 Byte, Pins bleiben `verified`; v3 Rückweg: fehlerhafter MAC → `identity`; `enrollments` ≤ 16, MAC deckt sie; nicht persistent → `enrollments` nur RAM; `deviceFingerprint` bytegleich zu `rendezvous.mjs deviceId()` (Testvektor); Signatur mit `signingKey` verifiziert gegen `signingPublicKey` via `ed25519Spki` |
| **T5 Shared + Texte** | `src/shared/sync-lab.ts`, `src/shared/remote-lab.ts`, `src/shared/locales/{de-DE,en-US}/syncLab.json`, `remoteLab.json`, `src/renderer/src/remote-lab.ts` (Fehler-Map), `i18n-catalog.test.ts` nur falls Ausnahmen nötig | §4.10, §10 | Fehler-Maps vollständig (`satisfies`), Katalogtest grün, keine dynamischen Keys |
| **T6 Betrieb** | `server/README.md`, `scripts/sync-prototype/README.md` | Abschnitt „Geräte“ (Einschreiben, Sitzung, Liste, Entfernen, temporäre Geräte, Passwortwechsel ≠ Widerruf, Altobjekte), API-Tabelle (`/v1/devices`, `/v1/challenge`, `/v1/session`, `/v1/login` entfällt, Objektformat), Backup-Abschnitt um `devices.json` ergänzt | Prosa-Konsistenz gegen §4/§5 |

### Welle 2 (nach Welle 1, parallel; typecheck-grün erst mit T7+T8+T9 zusammen, H2-E8)

| Task | Dateien | Pflichtpunkte | Pflichttests |
| --- | --- | --- | --- |
| **T7 Sync-Lab Host/IPC** | `src/main/sync-prototype/lab-host.ts`, `lab-host.test.ts`, `lab-ipc.ts`, `lab-ipc.test.ts` | §4.11 | `connect` mit Einschreibung (gleiche URL) → `enrolled`; andere URL gleiche `serverId` → nicht `enrolled`; `signIn` gleiches Vault-Passwort → `samePassword`, nichts gesendet; `signIn` → `enroll` dann `openSession` dann `rememberEnrollment` (nur persistent), Geräteliste geladen; `openSession` 401 → `forgetEnrollment` + `authentication`; `synchronize` mit `recoveryCode` in der Antwort → nicht in `state.sync`, zweite `status`-Abfrage ohne Code; `syncKey`/`syncRecoveryCode`/`syncMigrate` gemappt; `revokeDevice` fremd → Liste ohne Gerät; selbst → Verbindung geschlossen; `SyncContext.device.sign` nutzt `signingKey`; Identitätsfehler → `identity` |
| **T8 Remote-Lab Host/IPC + Wiring** | `src/main/remote/lab-host.ts`, `lab-host.test.ts`, `lab-ipc.ts`, `lab-ipc.test.ts`, `src/main/index.ts` (nur Zeilen 265-266 + Store-Erzeugung) | §4.12 | `connect` ohne `deviceSessions` → `unavailable`; `connect` lädt Identität, Fehler → `identity`; `signIn` mit `deviceName` → `enroll`+`openSession`, `ephemeral` bei nicht persistenter Identität; `openSession` ohne Passwort bei Einschreibung; `goOnline` ohne Namen nimmt Einschreibungsnamen; 401 in Presence → `#dropAccount` + `forgetEnrollment`; bestehende Tests angepasst, keiner gestrichen ohne Ersatz |
| **T9 Renderer** | `SyncLabDialog.tsx`, `RemoteLabDialog.tsx`, `sync-lab.css`, `remote-lab.css` (nur Tokens), Komponententests | §10 | Sync-Lab: Schritt 2 heißt „Dieses Gerät anmelden“, Formular Benutzername/Serverpasswort/Gerätename, Knopf „Gerät anmelden“; bei `enrolled` Knopf „Sitzung öffnen“ ohne Passwort; Code-Anzeige mit „Ich habe den Code notiert“ (lokaler State, danach nie wieder); Code-Eingabefeld bei `syncKey`; Import: Code + neues Passwort + Wiederholung (Submit nur bei Gleichheit, Prüfung im Renderer); Abschnitt „Geräte dieses Kontos“ mit „dieses Gerät“, „temporär“, „entfernt“ und Knopf „Entfernen“ (nicht beim eigenen); „Neuen Wiederherstellungscode erzeugen“ (Extra). Remote-Lab: Gerätename im Anmeldeformular, „Sitzung öffnen“ bei Einschreibung, Hinweis temporär; `maxLength` Code 39 |

### Welle 3

| Task | Dateien | Pflichtpunkte |
| --- | --- | --- |
| **T10 Doku + Szenen** | `docs/handbuch.md` (§„Fernzugriff (Entwicklung)“, §„Privates Netz und Sync-Lab (Entwicklung)“), `docs/plans/selfhosted-e2ee.md`, `selfhosted-threat-model.md` (Stand H3: M3 geschlossen für den Normalbetrieb, I1/I2 behoben, I3 unverändert mit Begründung, neue Grenzen), `selfhosted-protocol.md` (Geräteeinschreibung, Sitzungsnachweis, Objekthülle, Keybox, Autorenstempel), `.claude/skills/run-app/remote-scene.mjs` (Gerätename im Anmeldeformular), neu `.claude/skills/run-app/sync-scene.mjs`, `SKILL.md`, `package.json` (nur `drive:sync-scene`) | Sync-Szene: zwei Instanzen gegen den Fake-Server; A einschreiben → synchronisieren → Code aus dem DOM lesen → „notiert“; B einschreiben → „Vault vom Server laden“ mit Code + neuem Passwort → Vault offen, Verbindungsliste sichtbar; A listet zwei Geräte → entfernt B → B: nächster Abgleich `authentication`; Screenshots `sync-enroll`, `sync-code`, `sync-devices`; Prüfung, dass der Code nach „notiert“ nirgends mehr im DOM steht |

### Abschluss (Lead)

- `npm run typecheck`, `npx vitest run`, `node server/smoke.mjs`, `npx electron-vite build`.
- run-app: `remote-scene.mjs` (Gate für T8/T9) und `sync-scene.mjs` (Gate für T3/T7/T9) mit `/console`-Prüfung.
- `node scripts/check-server-container.mjs`, wenn Docker vorhanden.
- Kein CHANGELOG, keine Version im Lab-Branch (wie H1/H2).

---

## 9. Minimale erste Stufe gegenüber Extras

**Minimal (ohne das ist H3 nicht erfüllt):** T1 (ohne nichts), T2, T3 ohne Stufe 2 und ohne `regenerateRecoveryCode`, T4, T5, T6, T7 (ohne `regenerateCode`), T8, T9 (ohne Knopf „Neuen Wiederherstellungscode erzeugen“), T10.

**Extras innerhalb von H3 (abtrennbar, in dieser Reihenfolge):** Autorenstempel (T3 Stufe 2 + Anzeige `unknownAuthors`/`quarantined` in T9), `regenerateRecoveryCode` (T3/T7/T9), Roster-TOFU „Neues Gerät im Konto: {{name}}“ mit Bestätigen (T4 `enrollments[].roster`, T7, T9).

**Wandert nach H4:** Einschreibecodes aus einem eingeschriebenen Gerät (Passwort entfällt ganz), `K_sync`-Rotation nach Widerruf, Per-Gerät-Keybox oder Noise-Pairing für den Schlüssel, TOTP, Ablösung des alten Gerätemodus.

---

## 10. Texte (wörtlich, de-DE / en-US)

`syncLab.json` (T5):

| Key | de-DE | en-US |
| --- | --- | --- |
| `stepAuthorize` (geändert) | 2 · Dieses Gerät anmelden | 2 · Enroll this device |
| `deviceName` | Name dieses Geräts | Name of this device |
| `enroll` | Gerät anmelden | Enroll device |
| `enrolling` | Gerät wird angemeldet … | Enrolling device … |
| `openSession` | Sitzung öffnen | Open session |
| `enrolledHint` | Dieses Gerät ist am Server angemeldet. Die Sitzung wird mit seinem Schlüssel geöffnet, ohne Passwort. | This device is enrolled at the server. The session opens with its key, no password needed. |
| `passwordHint` (geändert) | Nur für die einmalige Anmeldung dieses Geräts. Danach weist sich das Gerät mit seinem Schlüssel aus. Verwende ein anderes Passwort als für deinen Vault. | Only for enrolling this device once. Afterwards the device authenticates with its key. Use a different password than for your vault. |
| `signedInDevice` | Angemeldet als Gerät {{name}} · Konto {{username}} | Signed in as device {{name}} · account {{username}} |
| `identityTemporary` | Temporäre Geräteidentität: Ohne Schlüsselablage des Betriebssystems gilt die Anmeldung dieses Geräts nur bis zum Neustart des Servers oder zwölf Stunden. | Temporary device identity: without an operating-system key store this device's enrollment lasts only until the server restarts or for twelve hours. |
| `recoveryCodeTitle` | Wiederherstellungscode | Recovery code |
| `recoveryCodeNew` | Notiere diesen Code jetzt. Er wird nur einmal angezeigt. Ein weiteres Gerät braucht ihn, um deinen Vault vom Server zu laden. Der Server kennt ihn nicht. | Write this code down now. It is shown only once. Another device needs it to load your vault from the server. The server does not know it. |
| `recoveryCodeNoted` | Ich habe den Code notiert | I have written the code down |
| `recoveryCodeLabel` | Wiederherstellungscode (32 Zeichen) | Recovery code (32 characters) |
| `recoveryCodeHint` | Vom ersten Gerät notiert. Er entschlüsselt den Sync-Schlüssel ausschließlich lokal. | Written down on the first device. It unlocks the sync key locally only. |
| `recoveryCodeRegenerate` (Extra) | Neuen Wiederherstellungscode erzeugen | Generate a new recovery code |
| `syncKeyNeeded` | Dieses Gerät hat den Sync-Schlüssel noch nicht. Gib den Wiederherstellungscode ein. | This device does not have the sync key yet. Enter the recovery code. |
| `newVaultPassword` | Neues Vault-Passwort für die lokale Datei | New vault password for the local file |
| `repeatPassword` | Passwort wiederholen | Repeat password |
| `localVaultHint` (geändert) | Zum erstmaligen Laden auf diesem Gerät: Wiederherstellungscode vom ersten Gerät und ein neues Passwort für die lokale Vault-Datei. Beides bleibt lokal. Empfangene Verbindungen starten deaktiviert. | For the first load on this device: the recovery code from the first device and a new password for the local vault file. Both stay local. Received connections start disabled. |
| `devicesTitle` | Geräte dieses Kontos | Devices of this account |
| `deviceSelf` | dieses Gerät | this device |
| `deviceEphemeral` | temporär | temporary |
| `deviceRevoked` | entfernt | removed |
| `revokeDevice` | Entfernen | Remove |
| `revokeHint` | Ein entferntes Gerät verliert sofort den Zugriff auf den Server. Seinen lokalen Vault und den Sync-Schlüssel behält es. | A removed device loses server access immediately. It keeps its local vault and the sync key. |
| `unknownAuthors_one` (Extra) | {{count}} Version stammt von einem Gerät, das der Server nicht mehr kennt. | {{count}} version comes from a device the server no longer knows. |
| `unknownAuthors_other` (Extra) | {{count}} Versionen stammen von Geräten, die der Server nicht mehr kennt. | {{count}} versions come from devices the server no longer knows. |
| `quarantined_one` (Extra) | {{count}} Version eines entfernten Geräts wurde nicht übernommen. | {{count}} version from a removed device was not applied. |
| `quarantined_other` (Extra) | {{count}} Versionen entfernter Geräte wurden nicht übernommen. | {{count}} versions from removed devices were not applied. |
| `errors.unavailable` (geändert) | Dieser Server unterstützt die Geräteanmeldung nicht oder der Entwicklungs-Prototyp ist nicht verfügbar. | This server does not support device enrollment or the development prototype is unavailable. |
| `errors.authentication` (geändert) | Benutzername oder Serverpasswort ist falsch, oder dieses Gerät wurde am Server entfernt. | Username or server password is wrong, or this device was removed at the server. |
| `errors.identity` | Die Geräteidentität ist beschädigt oder nicht lesbar. Sie wurde nicht ersetzt. | The device identity is damaged or unreadable. It was not replaced. |
| `errors.syncKey` | Für den Abgleich fehlt der Wiederherstellungscode. | The recovery code is required for this sync. |
| `errors.syncRecoveryCode` | Der Wiederherstellungscode ist falsch oder passt nicht zu diesem Konto. Es wurde nichts geändert. | The recovery code is wrong or does not belong to this account. Nothing was changed. |
| `errors.syncMigrate` | Der lokale Sync-Zustand stammt aus einer älteren Lab-Version. Lösche die Datei „.sync-state“ neben dem Vault und starte den Abgleich erneut. | The local sync state comes from an older lab version. Delete the “.sync-state” file next to the vault and start the sync again. |

`remoteLab.json` (T5):

| Key | de-DE | en-US |
| --- | --- | --- |
| `signIn` (geändert) | Gerät anmelden | Enroll device |
| `openSession` | Sitzung öffnen | Open session |
| `enrolledHint` | Dieses Gerät ist am Server angemeldet; der Server kennt nur seinen öffentlichen Schlüssel. | This device is enrolled at the server; the server knows only its public key. |
| `identityTemporary` (geändert) | Temporäre Geräteidentität: Dieser Rechner hat keine Schlüsselablage des Betriebssystems. Fingerabdruck und Anmeldung gelten nur bis zum nächsten Start. | Temporary device identity: this computer has no operating-system key store. Fingerprint and enrollment last only until the next start. |
| `errors.authentication` (geändert) | Anmeldung fehlgeschlagen, abgelaufen oder dieses Gerät wurde am Server entfernt. | Sign-in failed, expired, or this device was removed at the server. |

Keine dynamischen Keys; Fehler-Maps bleiben volle Literale (`SyncLabDialog.tsx:63-69`, `remote-lab.ts:4-32`). `serverPassword`, `username`, `privateNetwork.*`, `compacted_*`, `removeForeign*`, `samePassword*` bleiben.

---

## 11. Offene Entscheidungen mit Empfehlung

1. **Sitzungstoken per signierter Challenge oder Signatur je Request?** Token. Rendezvous, Presence, `refresh` bleiben unverändert; Gewinn von „je Request“ nur gegen einen kompromittierten TLS-Terminator auf demselben Host.
2. **Rolle des Passworts:** nur Einschreibung, einmal je Gerät; `/v1/login` entfällt. Einschreibecodes und TOTP nicht jetzt.
3. **Ein Schlüssel für beide Labs?** Eine Identitätsdatei, zwei Schlüssel: X25519 bleibt Noise-Statik und Fingerabdruck, Ed25519 neu fürs Signieren. Keine Umrechnung.
4. **Geräte-ID am Server:** der heutige X25519-Fingerabdruck; das Einschreibedokument bindet den Signaturschlüssel daran.
5. **Temporäre Identität (`--password-store=basic`):** Einschreibung mit `ephemeral: true`, Server hält sie nur im RAM (≤ 8, 12 h). Kein Klartext-Fallback, kein Roster-Müll.
6. **Roster-Persistenz:** `devices.json`, widerrufene bleiben (≤ 64 Einträge); Widerruf nur signiert; Selbstwiderruf erlaubt; Wieder-Einschreiben eines widerrufenen Geräts mit Passwort erlaubt.
7. **Widerruf-Wirkung:** sofort (Roster-Prüfung in `authorize`), Sitzungen und Präsenz weg.
8. **Relay-Schutz:** Nachweis bindet `serverId` + `namespace`, nicht die URL; der Client pinnt `serverUrl` je Einschreibung.
9. **Objektformat:** neue Hülle `shellherd-sync-object` v1 für `version` und `keybox`; Altformat am Server nur lesbar, `PUT` → 400.
10. **Schlüsselübergabe:** nur Wiederherstellungscode (32 Hex, HKDF, Keybox als Objekt). Noise-Pairing und Per-Gerät-Keybox nicht jetzt.
11. **Code-Anzeige:** einmal in der Antwort, nie im Zustand; Bestätigung „notiert“ im Renderer.
12. **Checkpoint:** v2 mit `syncKey`; v1 → `syncMigrate`; Zustandsschlüssel bleibt `HKDF(vaultKey)`.
13. **Autorenstempel:** Extra (T3 Stufe 2); unbekannter Autor gültig + gezählt, widerrufener Autor neu → Quarantäne.
14. **Vektoruhren/Anker-Objekte:** nein (kein Gewinn gegenüber DAG + `acked`; konsistenter Schnitt bleibt Grenze).
15. **DELETE:** Gerätesitzung + Budget je Gerät; keine signierten Tombstones.
16. **Roster-UI:** nur im Sync-Lab; „Neues Gerät“-Hinweis als Extra.
17. **Rendezvous-Registrierung:** `publicKey` muss dem Noise-Schlüssel des Sitzungsgeräts entsprechen.
18. **Passwortwechsel (`rotate-password`):** widerruft keine Geräte; Widerruf ist eine eigene Aktion. Empfehlung: so lassen, dokumentieren.
19. **Limits:** `enroll`/`session` je Quelle wie `login`; `deviceWrites` 60/min je Gerät; `challenge` wie `info`.
20. **Ed25519-Implementierung:** Node-`crypto` in Main und Skripten; kein libsodium im Bundle.
21. **Zweite run-app-Szene:** `sync-scene.mjs` (zwei Instanzen) als Gate für T3/T7/T9. Empfehlung: ja, sie ist der einzige End-to-End-Nachweis für Code und Widerruf.
22. **CHANGELOG/Version:** wie H1/H2 nicht im Lab-Branch; Lead entscheidet beim Stapel-Abschluss.
