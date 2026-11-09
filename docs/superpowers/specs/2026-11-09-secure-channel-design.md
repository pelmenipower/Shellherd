# Spec: Sicherheitshärtung H2 (Noise-Kanal, privates Netz, Kompaktierung)

Status: Design, Meilenstein H2 von drei. Baut auf H1 (`2026-11-09-security-hardening-design.md` mit Validierung) auf; deren Regeln, Verträge und Rulings gelten weiter, soweit hier nichts anderes steht. Bindend geht `…-validation.md` vor.

## 0. Umfang und Rulings

Umfang H2 = Abschnitt 8 vollständig, inklusive der Extras aus Abschnitt 9 (Permissions-Verschärfung, Dialog-Throw, M3 beim Import, „Fremde Objekte entfernen“). Nicht in H2: Ed25519-Gerätesignaturen, Verlaufsanker, Sync-Schlüssel-Transfer, Geräte-Roster, signierte Requests (H3); eigene CA/Pinning, SAS, PAKE, TOTP (nie bzw. später).

- Ruling R-H2-1: Die 15 Entscheidungen aus Abschnitt 11 werden wie empfohlen übernommen (16 Hex, alte Pins behalten, Agent = Initiator, Host wartet auf Handshake, opakes Frame ohne Downgrade, privates Netz als nicht persistentes Opt-in nur für numerische Tunneladressen, keine eigene CA, `compacts` im Versionsdokument, Retention 16/32, fremde Objekte nur explizit, DELETE per Konto, Legacy-Desktop-`getUserMedia` zu, Dialog-Throw → `unavailable`, M3-Import per Digest, kein CHANGELOG/Version).
- Ruling R-H2-2: Keine eigene Kryptografie. Nur `noise-handshake` (XX, `Cipher`) und Node-`crypto`.
- Ruling R-H2-3: Gestapelt auf H1 (PR #44); H2 wird nach dem Merge von #44 auf staging rebased.

Branch `claude/feature/secure-channel`, gestapelt auf H1 (`claude/feature/security-hardening`, PR #44, HEAD `aa1b4d1`). Reines Lesekonzept, kein Code geändert. Bindend bleiben: R1–R12 aus `docs/superpowers/specs/2026-11-07-remote-agent-design.md`, SEC-01…SEC-12 aus `docs/plans/selfhosted-threat-model.md`, die H1-Validierung `docs/superpowers/specs/2026-11-09-security-hardening-validation.md` (insbesondere §2 Vertrag, E6 „Fingerabdruck der Gegenseite nur auf deren Bildschirm“, K20, E10) sowie die Rulings R-H1…R-H3 der H1-Spec.

Leitentscheidung bleibt: **keine eigene Kryptografie.** H2 nutzt ausschließlich `noise-handshake` 4.2.0 (vorhanden, `package.json:63`, Nutzung in `scripts/sync-prototype/pairing.mjs:2-3,59-61,75-76`), Node-`crypto` und die bestehende AES-256-GCM/HKDF-Komposition des Syncs (`vault-sync-crypto.ts:30-54`). Kein SAS, kein PAKE, keine eigene CA, kein Zertifikats-Pinning.

Geprüft (nicht nur gelesen): `noise-handshake` lädt und vollendet einen XX-Handshake in Node 22.22 **und** in Electrons Node 24.21 (`ELECTRON_RUN_AS_NODE=1`, Electron 44.4.2, N-API 10) ohne Rebuild; `sodium-native` 5.2.0 liefert N-API-Prebuilds für linux/win32/darwin (`node_modules/sodium-native/prebuilds/`). Nachrichtengrößen XX: 32 / 96 / 64 Byte, Handshake-Hash 64 Byte, Transport-Tag 16 Byte. Node exportiert den X25519-Rohskalar per `privateKey.export({ format: 'jwk' }).d` (base64url, 32 Byte); `rs` des Handshakes ist bytegleich mit dem JWK-`x` des Peers.

---

## 1. Bestand und Lücken

| Thema | Bestand (`datei:zeile`) | Lücke |
| --- | --- | --- |
| Kanal | `rendezvous-client.mjs:62-64` statisch-statisches X25519-DH → HKDF; `:67` zweiter HKDF-Schritt mit Accept-Nonce; `:73-77,108-110` AES-GCM mit AAD Richtung+Sequenz | Keine Forward Secrecy (N3): Verlust eines Geräteschlüssels entschlüsselt alle mitgeschnittenen Sitzungen. Der Kanal bindet den **Server-gelieferten** `peerPublicKey` (`lab-host.ts:341,529` via `s.peerKey` aus `deviceSchema`, `:71,486`); nur der Fingerprint-Vergleich schützt. Keine explizite Schlüsselbestätigung |
| Server-Frames | `rendezvous.mjs:132-136` erzwingt `{ciphertext,nonce(12),sequence,tag(16)}`; `:117` Nachrichten nur im Zustand `active`; `:138-146` idempotente Retries | Format ist an AES-GCM gebunden; Noise-Handshake-Frames (32/96/64 Byte, kein eigener Nonce) passen nicht hinein |
| Prüfung | `remote-signal.ts:90-102` genau 12 Hex, konstantzeitig; `remote-lab.ts:52` `verificationHex: 12`; Pins `identity.ts:136-163` | 48-Bit-Präfix: ein Betreiber braucht 2^48 Schlüsselerzeugungen je Opfer (≈ 325 GPU-Tage bei 10^7 Keygen/s, parallelisierbar) – H1-Validierung §7 benennt es als Restrisiko |
| Transport-URL | `sync-server-url.mjs:7` HTTP nur `127.0.0.1`/`[::1]`; Aufrufer `lab-ipc.ts:104`, `sync-prototype/lab-ipc.ts:32`, `account-transport.mjs:11`, `RemoteLabDialog.tsx:30`, `SyncLabDialog.tsx:19` | Ein Server im WireGuard-/Tailscale-Netz (`10.x`, `100.64/10`) ist per HTTP nicht erreichbar; `server.mjs:211` `listen` erlaubt nur `127.0.0.1`/`0.0.0.0` |
| Betrieb | `server/compose.yaml:17-21` Port an `127.0.0.1`, `TRUSTED_PROXY=1`; `Caddyfile.example`; README `server/README.md:46-53,62-78` | Keine Compose-Variante für ein privates Netz; README verweist nur auf „H2“ |
| Sync-Kontingent | Server `server.mjs:69,183` hart 100 Objekte / 32 MiB, **kein DELETE** (`:129` nur `GET`,`PUT`); Client `vault-sync.ts:45` gleiche Grenzen; `pull` `:80` `acked ⊆ listing` sonst `history`; `Graph.validate` `:56` jeder Parent muss vorhanden sein | Nach ~100 Abgleichen ist das Konto voll (507), unabhängig von fremden Objekten. Jedes Löschen eines je bestätigten Objekts wäre für alle Geräte ununterscheidbar von Server-Rollback (`history`). Fremde Objekte (`:85`, `skipped`) belegen das Kontingent dauerhaft |
| M4-Rest | `permissions.ts:18-24`: `media` mit leerer `mediaTypes` ⇒ wie Display-Capture erlaubt (nach Zustimmung) | Nach Zustimmung kann ein kompromittierter Renderer per Legacy-`getUserMedia({chromeMediaSource:'desktop', chromeMediaSourceId:…})` **jede** Quelle (anderes Fenster, zweiter Bildschirm) und Desktop-Audio anfordern, am `desktopCapturer.getSources()[0]`-Pfad (`lab-ipc.ts:41`) vorbei |
| Dialog-Fehler | `lab-ipc.ts:63-65` `catch → 'declined'` | Eine Ausnahme von `showMessageBox` (kein Nutzerentscheid) beendet die Sitzung mit `declined` **und** stummt das Gerät 10 min (`lab-host.ts:166`) |
| M3 beim Import | `sync-prototype/lab-host.ts:55-57`: bei gesperrtem Vault (`undefined`) entfällt die Prüfung (Ruling R-H1 Nr. 6); `importSyncedVault` `vault-sync.ts:165` bekommt das Vault-Passwort | Serverpasswort = Vault-Passwort wird im Importfall nie erkannt, obwohl beide im selben Dialog eingegeben werden |

Gut und unverändert: Besitznachweis bei jeder Registrierung (`rendezvous.mjs:15-22,73-80`), Paar-Sperre und Stummschaltung, nativer Zustimmungsdialog, Permission-Handler deny-by-default, CSP, Notbremse, Identitätsdatei v2 mit MAC, Content-Hash-IDs, Checkpoint-Verschlüsselung.

---

## 2. Bewertung der vier H2-Punkte

### 2.1 Rendezvous-Kanal auf Noise

**Was Noise bringt:** Forward Secrecy je Sitzung (ephemere Schlüssel, N3 geschlossen), explizite Schlüsselbestätigung (jede Seite beweist Besitz ihres statischen Schlüssels im Handshake), KCI-Resistenz, ein analysiertes Transkript (`h`), Prologue-Bindung von Server-ID, Sitzung, Nonce, Scope und Rollen, und – wichtig für den Review – der statische Schlüssel der Gegenseite kommt **aus dem Handshake** (`noise.rs`), nicht mehr aus der Server-Geräteliste. `peerPublicKey` verschwindet als Eingabe des Kanals; die Serverliste liefert nur noch Name und Fingerprint für die Anzeige.

**Was Noise nicht bringt – ehrlich:** Es ändert nichts an der Frage, *wessen* statischer Schlüssel am anderen Ende steht. Ein bösartiger Server kann zwei XX-Handshakes führen (A↔M, M↔B) und beiden Seiten eigene statische Schlüssel präsentieren. Erkannt wird das nur, wenn der Fingerprint von `rs` gegen etwas Unabhängiges geprüft wird: den getippten Präfix beim Erstkontakt oder den Pin danach. Die 48-Bit-Grenze aus H1 bleibt also exakt bestehen; Noise löst sie nicht.

**SAS aus dem Handshake-Hash ohne Commitment ist nicht sicher.** Auch wenn der Server keine DH-Geheimnisse der Parteien mehr kennt, kontrolliert er als MITM in **beiden** Handshakes eigene Schlüssel und kann grinden: Als Initiator gegenüber B wählt er `e`/`s` seiner dritten Nachricht frei, nachdem `h` der anderen Sitzung feststeht. Als Responder gegenüber A kennt er den registrierten statischen Schlüssel von A (Geräteliste) und damit vorab den gesamten Transkript von A↔M bis einschließlich Nachricht 3; er grindet dann seine Nachricht 2. Ein 6-stelliger SAS braucht ≈ 10^6 Versuche, Millisekunden. Das Gegenmittel (Hash-Commitment auf `e` vor dem Vergleich, ZRTP-Stil) wäre eine eigene Protokollkomposition und ist nach R-H3 verboten. **Kein SAS in H2.**

**Empfehlung zur Prüfung (entschieden):** **16 Hex-Zeichen (64 Bit) beim Erstkontakt**, danach nur noch der Pin, der im Noise-Handshake mit vollen 256 Bit bestätigt wird.
- 64 Bit heißt 2^64 Schlüsselerzeugungen je Opfer (≈ 58 000 GPU-Jahre bei 10^7/s). Das liegt außerhalb jedes Betreibers, auch mit großer Farm. 12 Hex waren 65 536-mal schwächer.
- 16 Hex sind genau die ersten zwei Achtergruppen der heutigen Anzeige (`formatFingerprint`, `remote-signal.ts:84-87`): „die ersten zwei Gruppen“ ist gut ablesbar und tippbar.
- Vollvergleich (64 Hex) scheidet aus: nicht tippbar, und ein Sichtvergleich wird wieder zur Checkbox (H1 B10).
- Abgelehnt: PAKE (keine gepflegte Node-Bibliothek, Eigenbau verboten); „teurer“ Fingerprint über Argon2id (ändert das Fingerprint-Format, Server-IDs, Pins und ist eine Eigenkomposition).
- Pins aus H1 (`verified: true`, 48-Bit-geprüft) bleiben gültig: H1 lief nie außerhalb des Labs, ein Zwangs-Nachtippen bringt nichts. Keine Identitätsmigration (Datei v2 bleibt).

**XX statt IK:** IK bräuchte den statischen Schlüssel der Gegenseite vor dem Handshake (aus der Serverliste, unauthentifiziert) und zwei Pfade (bekannt/unbekannt) mit Downgrade-Entscheidung. XX ist ein Muster für alle Fälle, ohne 0-RTT-Fragen; das Pairing nutzt es bereits. **Nur `Noise_XX_25519_ChaChaPoly_BLAKE2b`, kein Profilwechsel.**

**Rollen:** Der **Agent (`session.to`) ist Noise-Initiator**, der Viewer Responder. Grund: Die Server-Warteschlange öffnet erst mit `POST …/accept` durch das Ziel (`rendezvous.mjs:112-117`); das Ziel kann Nachricht 1 im selben `accept()` einstellen, der Viewer findet sie beim nächsten Poll bereits vor. Das spart eine Pollrunde. Identitätsverbergen ist kein Ziel (der Server kennt beide Fingerprints ohnehin).

**Kosten:** Der Aufbau dauert ≈ 2 Pollrunden länger (≈ 3–4 s statt ≈ 2 s). Der Host wartet in `#accept` bzw. `#pollTick`, bis der Kanal `ready` ist, bevor er `connecting` meldet; der Renderer bleibt unverändert (er beginnt den Offer erst nach `accept`-Antwort, `remote-peer.ts:95-112`).

### 2.2 WireGuard/Tailscale als empfohlener Standard

Bewertung der drei Wege:

| Weg | Client-Änderung | Sicherheit | Betrieb | Urteil |
| --- | --- | --- | --- | --- |
| **Tailscale mit `tailscale serve`** (HTTPS mit gültigem Zertifikat auf `<host>.<tailnet>.ts.net`, nur im Tailnet erreichbar) | keine | TLS + Tailnet-ACL; der Server bleibt an `127.0.0.1` | kein Caddy, kein DNS, kein eigenes Zertifikat | **Empfohlener Standard** für Tailscale-Nutzer |
| **WireGuard + HTTP im Tunnel** | `privateNetwork`-Opt-in beim Verbinden | WG authentifiziert und verschlüsselt den Peer-Pfad; HTTP im Tunnel ist dann vertretbar. Risiko: der Client kann nicht prüfen, dass die Route wirklich durch WG geht (ein `10.x`-Server im fremden WLAN wäre Klartext) → ausdrückliche Bestätigung, nur numerische Tunneladressen | Compose-Variante bindet den Port an die WG-Adresse; `TRUSTED_PROXY` aus, Limits greifen pro Tunnel-IP | **Zweiter Weg**, Opt-in |
| Eigene CA / SPKI-Pinning | groß: `fetch` (undici) im Main hat keinen CA-/Socket-Zugriff; `NODE_EXTRA_CA_CERTS` ist in Electron nicht verlässlich; Pinning verlangt Transport-Umbau auf `https.request` | gut, aber Betriebslast (CA verteilen, Rotation) ohne Reviewgewinn gegenüber WG/Tailscale | hoch | **nicht jetzt** (H1 I8 bleibt dokumentiert) |

**Entscheidung:** README-Abschnitt „Privates Netz“ mit beiden Wegen in dieser Reihenfolge, `compose.wireguard.yaml`, Client-Option `privateNetwork` (HTTP nur zu **numerischen** Adressen aus `10/8`, `172.16/12`, `192.168/16`, `100.64/10` (CGNAT, Tailscale), `fc00::/7` (ULA, enthält Tailscale `fd7a:115c:a1e0::/48`); nie Link-Local, nie Hostnamen, nie öffentliche Adressen), nur nach ausdrücklicher Bestätigung per Checkbox im Dialog, nicht persistent (Lab). Der Internet-Weg über Caddy bleibt unverändert bestehen.

### 2.3 Kompaktierung und Tombstones

**Warum jetzt und nicht erst H3:** Das Kontingent ist mit 100 Objekten nach ≈ 100 Abgleichen voll, auch ohne fremde Objekte (`server.mjs:183` → 507). Das ist ein Funktionsblocker des Labs, unabhängig von Sicherheitsfragen.

**Welcher Schlüssel, solange Ed25519 pro Gerät (H3) fehlt:** Keiner neu. Ein Tombstone muss zwei Dinge leisten: (a) einem zurückkehrenden Gerät beweisen, dass fehlende, einst bestätigte Objekte **absichtlich von einem Vault-Inhaber** entfernt wurden und nicht vom Server (T05-Unterscheidung); (b) dem Server sagen, was er löschen darf. Für (a) genügt die bestehende Version-AEAD: Die Liste der entfernten IDs steht **im Versionsdokument** (`compacts`), verschlüsselt und authentifiziert unter dem Versionsschlüssel (`sealDocument`, `vault-sync-crypto.ts:35-43`). Der Server kann so etwas nicht fälschen. Ein HMAC wäre doppelt, Ed25519 kommt in H3 obendrauf (dann ist zusätzlich *welches Gerät* gelöscht hat nachweisbar). Für (b) gibt es keine servermäßig prüfbare Autorität außer dem Konto – wie bei jedem Upload heute. Deshalb:

**Was der Server löschen darf:** Nichts von sich aus. Nur `DELETE /v1/vaults/<ns>/objects/<id>` durch ein angemeldetes Konto, ein Objekt je Aufruf, nur im Passwortmodus. Keine serverseitige GC, keine Heuristik, keine Alterslöschung.

**Entwurf (kein neues Objektformat, keine Kind-Änderung):**
- Versionsdokument bekommt `compacts?: string[]` (IDs, ≤ 256). AAD unverändert.
- `Graph` führt `compacted = ⋃ compacts`. `validate()` erlaubt einen fehlenden Parent genau dann, wenn er in `compacted` liegt; `ancestors()` überspringt fehlende; `base()` kann dadurch `undefined` liefern → bestehender Konfliktpfad (explizite Auflösung, wie `selfhosted-protocol.md` „Ohne gemeinsame Basis bleibt die Konfliktauflösung ausdrücklich“ vorsieht).
- `pull()`: fehlende `acked`-IDs sind erlaubt, wenn sie nach dem Laden aller Objekte in `graph.compacted` liegen; sonst weiter `history`. Danach `graph.prune()` entfernt kompaktierte Versionen lokal (nie eigene, noch nicht bestätigte Köpfe), `state.acked` und `state.versions` werden bereinigt.
- Auslöser: am Ende eines erfolgreichen `synchronizeVault` mit genau einem Kopf, ohne `pending`, wenn `graph.values.size > COMPACT_AT (32)`: neue Version `C` mit gleichem `portable` wie der Kopf, `parents: [head]`, `compacts` = alle Versionen außerhalb der letzten `RETAIN (16)` Ebenen ab Kopf. Reihenfolge (absturzfest): `C` in den Checkpoint → Upload → ack → je ID `remote.remove` (404 ist Erfolg) → `prune` → Checkpoint. Bricht es zwischen Löschen und `prune` ab, repariert der nächste `pull` über `compacts`.
- Fremde Objekte: nicht automatisch. Explizite Aktion „Fremde Objekte entfernen“ im Sync-Lab, die jedes Kandidatenobjekt **erneut lädt und mit dem aktuellen Vault-Schlüssel zu lesen versucht**; nur Unlesbares wird gelöscht. Regel (dokumentiert): ein Konto trägt genau einen Vault. Das ist ein Extra (§9).

**Risiko, benannt:** Ein Konto-Inhaber (oder ein 15-min-Token-Dieb) kann künftig Objekte löschen (Verfügbarkeit). Vertraulichkeit und Integrität bleiben unberührt; Clients halten die volle Historie im verschlüsselten Checkpoint und die Vault-Datei lokal; `history` erkennt unautorisiertes Löschen. Das Bedrohungsmodell garantiert Verfügbarkeit gegenüber dem Betreiber ohnehin nicht. H3 bindet Löschungen an Gerätesignaturen.

### 2.4 H1-Restpunkte

| Punkt | Entscheidung | Wert / Aufwand |
| --- | --- | --- |
| Desktop-Audio / beliebige `chromeMediaSourceId` | `media`-**Request** mit leerer `mediaTypes` (Legacy-Desktop-`getUserMedia`) wird **abgelehnt**; `display-capture` bleibt der einzige Freigabepfad; `media`-**Check** nur mit `mediaType === 'video'` erlaubt (bleibt für die Pipeline von `getDisplayMedia`). Gate: `remote-scene.mjs` muss den nativen Dialog weiterhin erreichen. Scheitert die Szene, gilt die H1-Rückfallregel (§7 der H1-Validierung): nur `media`-Checks mit `video` dürfen gelockert werden, der Request bleibt zu | ★★ / nur `permissions.ts` + Test + Szene |
| `showMessageBox` wirft | `catch → 'unavailable'` (kein Nutzerentscheid: weder `declined` noch Stummschaltung; Anfrage bleibt bis zur Frist, Wiederholung möglich) | ★ / `lab-ipc.ts:64` + Test |
| M3 beim Import (gesperrter Vault) | Sync-Lab merkt sich nach einer **ungeprüften** Anmeldung (Vault gesperrt) `sha256(NFKC(serverPassword))` im RAM der Verbindung; `importVault` vergleicht konstantzeitig mit `sha256(NFKC(vaultPassword))` und bricht bei Gleichheit **vor** dem Entschlüsseln mit `samePasswordImport` ab. Ehrlich: Das Passwort ist dann schon beim Server gewesen; der Text sagt das und fordert Passwortwechsel auf dem Ursprungsgerät und am Server. Digest wird bei `close`, `reset`, Serverwechsel und nach dem ersten Importversuch genullt | ★★ (Erkennung, keine Verhinderung) / kleine Main-Änderung |

Alle drei passen in H2: klein, dateidisjunkt, ohne Abhängigkeit zu Noise.

---

## 3. Empfehlung je Fläche

| Fläche | Empfehlung | Wert | Aufwand |
| --- | --- | --- | --- |
| Rendezvous-Kanal (`rendezvous-client.mjs`) | Noise XX, Agent = Initiator, Prologue-Bindung, `rs`-Fingerprint-Prüfung, Transport mit `Cipher(tx/rx)`, erst nach Handshake `accepted` | ★★★ | Server-Skript + Main (Host) |
| Server-Frames (`rendezvous.mjs`) | Opaker Frame `{sequence, frame}`, `/v1/info.rendezvousNoise`, kein Downgrade | ★★★ | Server-Skript |
| Getippte Prüfung | 16 Hex = zwei Achtergruppen, beidseitig; Pins bleiben | ★★★ | Renderer + `remote-signal.ts` + Konstante |
| Privates Netz | README „Privates Netz“ (Tailscale serve zuerst, dann WireGuard+HTTP), `compose.wireguard.yaml`, `privateNetwork`-Checkbox, numerische Tunnelbereiche | ★★★ | Doku + kleine Main-/Renderer-Änderung |
| Kompaktierung eigener Historie | `compacts` im Versionsdokument, `DELETE` am Server, Retention 16/32, automatisch nach erfolgreichem Abgleich | ★★★ | Main (`vault-sync.ts`) + Server |
| Fremde Objekte entfernen | explizite Aktion mit erneuter Leseprüfung | ★★ | Main + Renderer (Extra) |
| Permissions-Rest | Legacy-Desktop-`getUserMedia` zu | ★★ | nur `permissions.ts` |
| Dialog-Throw | `'unavailable'` | ★ | nur `lab-ipc.ts` |
| M3 beim Import | Digest-Vergleich, `samePasswordImport` | ★★ | kleine Main-Änderung |
| Eigene CA / Pinning, TOTP, Ed25519-Signaturen, Verlaufsanker, Sync-Schlüssel-Transfer | **nicht jetzt** → H3 bzw. nie | – | – |

---

## 4. Verträge und Signaturen (wörtlich zu übernehmen)

### 4.1 `scripts/sync-prototype/rendezvous-client.mjs` (T1)

```js
export const RENDEZVOUS_NOISE_PROFILE = 'Noise_XX_25519_ChaChaPoly_BLAKE2b';
export const RENDEZVOUS_PROLOGUE = 'shellherd-rendezvous-noise-v1';
/** Raw X25519 key pair for noise-handshake from a Node KeyObject (JWK d/x, 32 bytes each); caller zeroes secretKey. */
export function noiseKeyPair(privateKey /* KeyObject */) // → { publicKey: Buffer(32), secretKey: Buffer(32) }
/** SPKI base64 (60 chars) of a raw X25519 public key. */
export function spkiOf(raw32) // → string
export class RendezvousPeer {
  // register, devices, sessions, request, unregister: unverändert (H1)
  channel(session, expectedFingerprint, scope) // peerPublicKey entfällt; expectedFingerprint aus Tipp-Prüfung oder Pin
}
class RendezvousChannel {
  get ready()            // handshake complete && rs verified && (initiator: accepted sent | responder: accepted received)
  async accept()         // nur session.to: POST …/accept, dann Handshake-Nachricht 1 als Frame (sequence 1)
  async receive()        // treibt Handshake und Transport; liefert nur Daten-Werte (Handshake/accepted ergeben [])
  async send(value)      // nur ready
  async retry()          // unverändert
  async close(); dispose()
}
```

Pflichtsemantik:
- Konstruktor: Prüfungen wie heute (`:56-59`) ohne `peerPublicKey`; `initiator = (peer.identity.id === session.to)`; `noise = new Noise('XX', initiator, noiseKeyPair(peer.identity.privateKey))`; `check(noise.protocol.toString() === RENDEZVOUS_NOISE_PROFILE)`; `noise.initialise(Buffer.from(JSON.stringify([RENDEZVOUS_PROLOGUE, RENDEZVOUS_NOISE_PROFILE, serverId, session.id, session.nonce, scope, session.from, session.to])))`. Beide Seiten bauen den Prologue aus **ihrer** Sicht der Sitzung (der Viewer aus `#requests`, `:43-44`); weicht der Server ab, scheitert Nachricht 2.
- Handshake-Frames tragen **keinen Payload** (`noise.send()` ohne Argument; `noise.recv()` muss leeren Payload liefern, sonst `check(false)`), Größe ≤ 512 Byte.
- Nach `noise.complete`: `check(deviceId(spkiOf(noise.rs)) === expectedFingerprint)`, sonst `fail` → Host beendet mit `failed`/Fehler `mismatch`. Dann `tx = new Cipher(noise.tx)`, `rx = new Cipher(noise.rx)` (`noise-handshake/cipher.js`), AD leer; Ordnung sichert der implizite Zähler plus die bestehende Sequenzprüfung (`message.sequence === received + 1`).
- Initiator sendet nach Nachricht 3 sofort den ersten Transport-Frame `{ kind: 'accepted', scope }` (sequence 3). Responder verlangt als ersten Transport-Frame genau dieses `accepted` mit `scope === session.scope`; alles andere `check(false)`.
- Datenframes: `{ kind: 'data', value }`, Klartext ≤ 8192 Byte, höchstens 4096 Frames je Richtung.
- `receive()` behält wie heute eine Lieferung bis zur erfolgreichen Quittung (`#delivery`); Noise-Zustand wird beim Verarbeiten fortgeschrieben (irreversibel; ein Prozessabsturz beendet die Sitzung ohnehin).
- `dispose()`: `tx?._clear()`, `rx?._clear()`, `noise.s.secretKey.fill(0)` (eigene Kopie), vorhandene `_clear` der Bibliothek läuft bei `final()`.

### 4.2 `scripts/sync-prototype/rendezvous.mjs`, `server.mjs`, `http-common.mjs`, `account-transport.mjs`, `server/main.mjs` (T2)

- Nachrichten (`rendezvous.mjs:132-136`): `exact(body, 'frame,sequence')`; `frame` base64 kanonisch, dekodiert 1…8208 Byte; Digest über `JSON.stringify([body.sequence, body.frame])`. Alles andere (Zustand `active`, Sequenzregel, 32 offene Frames, Quittung) unverändert.
- `/v1/info` (`server.mjs:93`) ergänzt `rendezvousNoise: Boolean(broker)`; `probeSyncServer` liefert `rendezvousNoise: info.rendezvousNoise === true`.
- `probeSyncServer(serverUrl, { allowLoopbackHttp = false, allowPrivateHttp = false, signal })` → `normalizeSyncServerUrl(serverUrl, { loopback: allowLoopbackHttp, private: allowPrivateHttp })`.
- `AccountStore`-Konstruktorprüfung: `normalizeSyncServerUrl(info.serverUrl, { loopback: true, private: true }) === info.serverUrl` (das Gate liegt beim Verbinden).
- `AccountStore.remove(id)`: `DELETE /v1/vaults/<ns>/objects/<id>`; `check(result.removed === true)`.
- Server `DELETE` auf Objektpfad (`server.mjs:129`: Objektpfad `['GET','DELETE']`, Sammlung `['GET','PUT']`): nur `login`-Modus (Gerätemodus → 405), authentifiziert, `content-length` 0, `check(!busy, 409)`, `check(objects.has(id), 404)`, `unlink` (ENOENT zählt als entfernt), Verzeichnis-`sync`, `objects.delete`, `total -= bytes`, `send(200, { removed: true })`.
- `listen(port, host)` (`server.mjs:211`): `check(net.isIP(host))` statt der Zweierliste; Rückgabe-URL nutzt weiterhin `127.0.0.1`, wenn `host` `0.0.0.0`/`::` ist, sonst `host`. `main.mjs` reicht `SHELLHERD_SERVER_HOST` unverändert durch.

### 4.3 `src/shared/sync-server-url.mjs` (T3)

```js
/** options: boolean (legacy: loopback) or { loopback?: boolean; private?: boolean }. Plain HTTP only to numeric loopback or, with private, to numeric tunnel ranges. */
export function normalizeSyncServerUrl(input, options = false)
export function isPrivateTunnelAddress(hostname) // numeric only: 10/8, 172.16/12, 192.168/16, 100.64/10, fc00::/7 (brackets stripped); false for names, link-local, public
```

### 4.4 `src/shared/remote-lab.ts` und `remote-signal.ts` (T7)

```ts
// remote-lab.ts
| { kind: 'connect'; serverUrl: string; privateNetwork?: boolean }
export const REMOTE_LAB_LIMITS = { …, verificationHex: 16, … } as const;
// remote-signal.ts
/** Strips whitespace, lower-cases; exactly REMOTE_LAB_LIMITS.verificationHex hex chars or null. */
export function normalizeVerification(input: string): string | null;
export function verifyFingerprintPrefix(input: string, fingerprint: string): boolean; // vergleicht verificationHex Zeichen, konstantzeitig, rein
```

`lab-host.test.ts:14` wird in T7 auf `'b'.repeat(REMOTE_LAB_LIMITS.verificationHex)` geändert (einzige Zeile; ab Welle 2 gehört die Datei T8).

### 4.5 `src/main/remote/lab-host.ts` (T8)

```ts
export interface RemoteServerInfo { …; rendezvousProof: boolean; rendezvousNoise: boolean }
export interface RemotePeer { …; channel(session: RemoteSessionWire, expectedFingerprint: string, scope: 'view'): RemoteChannel }
export interface RemoteDeps { probe(serverUrl: string, allowPrivateHttp: boolean, signal: AbortSignal): Promise<RemoteServerInfo>; … }
```
- `#connect(owner, clientId, serverUrl, privateNetwork)`: `normalizeSyncServerUrl(serverUrl, { loopback: true, private: privateNetwork })`; `unavailable`, wenn `info.rendezvousNoise !== true` (zusätzlich zu `rendezvousProof`). Kein Downgrade.
- `Sess.peerKey` entfällt; `deviceSchema.publicKey` bleibt nur für die Schemaprüfung der Liste.
- Neu `#establish(s): Promise<boolean>`: ruft `s.channel.receive()` alle `L.setupPollMs`, bis `channel.ready`, `s.ended`, Frist (`s.deadline`) oder Fehler; Werte aus `receive()` während des Handshakes müssen leer sein, sonst `failed`. Bei Frist → `#end(s,'expired')`, bei Fehler → `#end(s,'failed')` und Fehler `mismatch`, wenn die Ausnahme aus der `rs`-Prüfung stammt (Kanal wirft `Error('Rendezvous peer verification failed')`, wie heute `check`).
- `#accept`: nach `channel.accept()` → `await #establish(s)`; erst bei `true`: `connecting`, `deadline = now + sessionMs`, `#setSharing(true)`, `#startLoop`. Während `#establish` bleibt der Zustand `granted` (Renderer-Knöpfe gesperrt, „Ablehnen“ aktiv, K13); `#decline`/`#stop` beenden die Sitzung, `#establish` sieht `s.ended`.
- `#pollTick` (Viewer): bei `state === 'active'` Kanal bauen, `await #establish(s)`, dann `connecting`.
- `#signal` verlangt weiterhin `s.channel.ready`.

### 4.6 `src/main/sync-prototype/vault-sync.ts` (T4)

```ts
export interface VaultRemote { list(): Promise<string[]>; get(id: string): Promise<string>; put(wire: string): Promise<string>; remove(id: string): Promise<void> }
export interface VaultSyncResult { …; skipped?: number; /** Versions compacted away in this run. */ compacted?: number; /** Ids of unreadable account objects seen in this run (main-only, never sent to the renderer). */ foreign?: string[] }
interface Version { kind: 'shellherd-sync-version-v1'; parents: string[]; portable: PortableVault; compacts?: string[] }
export const SYNC_RETAIN = 16; export const SYNC_COMPACT_AT = 32;
/** Re-reads each candidate with the unlocked vault key; deletes only objects that are still unreadable. Returns the number removed. */
export async function removeForeignObjects(sessions: VaultSessionManager, remote: VaultRemote, context: SyncContext, ids: string[], signal: AbortSignal): Promise<number>;
```
- `versionSchema`: `compacts: z.array(hex64).max(256).optional()`; `Graph.create(portable, parents, compacts?)`.
- `Graph.compacted: Set<string>`, `Graph.validate()`/`ancestors()`/`base()` wie §2.3; `Graph.prune(keep: Set<string>)` entfernt kompaktierte Versionen außer `keep` (lokale Köpfe) und gibt Bytes frei.
- `pull()`: `missing = acked.filter(id => !listing.includes(id))`; nach dem Laden `ensure(missing.every(id => graph.compacted.has(id)), 'history')`; `received` wie heute.
- `synchronizeVault`: nach `synced` (ein Kopf, kein `pending`) Kompaktierung wie §2.3; `state.acked` nach `prune` = `acked ∩ graph.values ∪ …`.
- `importSyncedVault`: `pull(remote, graph, [], check)` tolerant gegenüber kompaktierten Parents (gleiche Graph-Regeln).

### 4.7 `src/shared/sync-lab.ts`, `sync-prototype/lab-host.ts`, `lab-ipc.ts` (T9)

```ts
// sync-lab.ts
| { kind: 'connect'; serverUrl: string; privateNetwork?: boolean }
| { kind: 'removeForeign' }
sync?: { …; skipped?: number; compacted?: number; removedForeign?: number }
code: … | 'samePassword' | 'samePasswordImport'
// lab-host.ts
export interface AccountDriver { …; remove?(id: string): Promise<void> }
constructor(…, syncVault?: (account, info, signal, request: … | { kind: 'removeForeign'; ids: string[] }) => Promise<VaultSyncResult | undefined>, matchesVaultPassword?)
```
- `connect`: `privateNetwork` → `probe(url, privateNetwork, signal)`; `normalizeSyncServerUrl(url, { loopback: true, private: privateNetwork })`.
- `signIn`: ist `same === undefined`, wird `current.unchecked = sha256(NFKC(password))` (Buffer) gehalten; sonst nichts.
- `performSync('importVault')`: ist `current.unchecked` gesetzt und `timingSafeEqual(sha256(NFKC(request.password)), current.unchecked)` → `{ ok: false, code: 'samePasswordImport' }`, Import läuft nicht; danach `unchecked.fill(0)` und löschen (in jedem Fall nach dem ersten Importversuch).
- `performSync('removeForeign')`: nur wenn `current.foreign` (aus dem letzten Ergebnis, `result.foreign`) nicht leer; ruft `syncVault(..., { kind: 'removeForeign', ids })`; Ergebnis `removedForeign`. `foreign` wird nie in `SyncLabState` kopiert (Destrukturierung wie `snapshot`).
- `lab-ipc.ts`: `transport.remove = id => remote.remove!(id)`; `removeForeign` → `removeForeignObjects(sessions, transport, info, ids, signal)`; `probeSyncServer(url, { allowLoopbackHttp: true, allowPrivateHttp, signal })`.

### 4.8 `src/main/permissions.ts` (T5)

```ts
/** Screen capture: display-capture, or media checks for video while granted. Legacy desktop getUserMedia (media request, no device types) is never allowed. */
function isScreenCapture(permission: string, details: PermissionDetails, kind: 'request' | 'check'): boolean
```
Regeln: `display-capture` → Grant-Prüfung; `media` + `kind === 'request'` → **immer false**; `media` + `kind === 'check'` → nur `details.mediaType === 'video'` → Grant-Prüfung; alles andere false. Signaturen der exportierten Funktionen unverändert.

### 4.9 `src/main/remote/lab-ipc.ts` (T6)

`confirmCaptureDialog`: `catch { return 'unavailable'; }` (`:64`). Sonst unverändert.

---

## 5. Wire-Format des Noise-Kanals

Server-Frame (`POST …/messages`, Antwort und `GET` unverändert):

```json
{ "sequence": 1, "frame": "<base64, 1…8208 Byte>" }
```

Ablauf einer Sitzung (A = Agent/`to`/Initiator, V = Viewer/`from`/Responder; `seq` je Richtung):

| Schritt | Wer | Server | Frame-Inhalt | Nach dem Schritt |
| --- | --- | --- | --- | --- |
| 0 | V | `POST /sessions` | – | Sitzung `pending`; V pollt `GET /sessions/<id>` |
| 1 | A | `POST …/accept`, dann `POST …/messages` A→V seq 1 | Noise msg 1: `e` (32 B) | Sitzung `active` |
| 2 | V | `GET …/messages`, `POST …/ack`, `POST …/messages` V→A seq 1 | Noise msg 2: `e, ee, s, es` (96 B) | V: `rs` = A statisch, noch nicht `complete` |
| 3 | A | `GET`, `ack`, `POST` A→V seq 2 | Noise msg 3: `s, se` (64 B) | A: `complete`, prüft `rs` gegen Fingerprint, Ciphers |
| 4 | A | `POST` A→V seq 3 | `tx.encrypt(JSON {kind:'accepted',scope})` (≈ 45 B) | A `ready` |
| 5 | V | `GET` (msg 3 und accepted im selben Batch), `ack` | – | V: `complete`, prüft `rs`, verlangt `accepted` → V `ready` |
| 6+ | beide | wie heute | `{kind:'data', value:{part}}` je Richtung, Noise-Zähler implizit | Signalisierung (Offer von A, Answer von V, `bye`) |

Prologue (beide identisch, sonst scheitert Schritt 2 bzw. 3): `["shellherd-rendezvous-noise-v1","Noise_XX_25519_ChaChaPoly_BLAKE2b",serverId,sessionId,nonce,scope,from,to]` als JSON-UTF-8.

Statische Noise-Identität = heutiger X25519-Geräteschlüssel (Rohskalar aus PKCS8/JWK); Fingerprint = SHA-256 über die SPKI-Kodierung von `rs`, also unverändert `deviceId()`. Alte Pins, Server-Geräte-IDs und der Besitznachweis aus H1 bleiben gültig.

Was der Server sieht: Längen (32/96/64/≈45/…), Zeiten, Sequenzen, Teilnehmer, Scope. Was er nicht kann: Nachrichten einer anderen Sitzung/Richtung einspeisen (Prologue und Schlüsseltrennung), `accepted` fälschen, Frames umsortieren oder auslassen (impliziter Zähler), Sitzungsinhalte nachträglich entschlüsseln (ephemere Schlüssel, FS).

---

## 6. Migration und Kompatibilität

| Bestand | Verhalten nach H2 |
| --- | --- |
| Clients H1 gegen Server H2 | Registrierung und Anfrage laufen; der erste `POST …/messages` im alten Format → 400 → Remote-Lab `connection`. Bewusst, Lab-only, dokumentiert |
| Clients H2 gegen Server H1 | `rendezvousNoise` fehlt → `unavailable` beim Verbinden (wie H1 mit `rendezvousProof`). Kein Downgrade (SEC-04) |
| `remote-identity.json` v2, Pins `verified: true` (48 Bit) | bleiben gültig; keine Dateiänderung; der Noise-Handshake bestätigt den Pin mit 256 Bit |
| Sync-Objekte ohne `compacts` | lesbar (optionales Feld). Clients H1 lesen Versionen **mit** `compacts` nicht (`strict`), überspringen sie und scheitern nach der ersten Kompaktierung mit `history` → gemeinsame Aktualisierung aller Lab-Geräte vor der ersten Kompaktierung; dokumentieren |
| `.sync-state` v1 | Schema unverändert; nach `prune` kleiner |
| `server.json`, Objekte auf der Platte | unverändert; `DELETE` entfernt nur angeforderte `<id>.blob` |
| `compose.yaml` (Caddy) | unverändert; `compose.wireguard.yaml` kommt hinzu |
| `allowLoopbackHttp: true`-Aufrufer | `normalizeSyncServerUrl(url, true)` bleibt gültig (boolean = loopback) |
| run-app `remote-scene.mjs` | 16 statt 12 Zeichen (`FIRST_12`, `:121`); der Fake-Server (`.claude/skills/run-app/rendezvous.mjs`) nutzt den echten Server → automatisch Noise |

---

## 7. Regeln und Risiken – was ausdrücklich nicht getan wird

- **Kein SAS, kein PAKE, kein Hash-Commitment, kein eigener Handshake-Code.** Nur `noise-handshake` mit XX; `Cipher` aus derselben Bibliothek für den Transport; keine zusätzliche HKDF-Stufe (die alte Accept-Nonce-Ableitung `:67,86` entfällt ersatzlos, weil der Handshake frisch ist).
- **Kein IK, kein Profilwechsel, kein 0-RTT, kein Payload in Handshake-Nachrichten.**
- **Keine eigene CA, kein Pinning, kein `NODE_TLS_REJECT_UNAUTHORIZED`.** HTTP nur zu numerischen Tunneladressen nach ausdrücklicher Bestätigung.
- **Keine serverseitige GC, keine Löschung ohne Konto-Auftrag, keine automatische Löschung fremder Objekte.**
- **Keine Ed25519-Gerätesignaturen, keine Verlaufsanker, kein Sync-Schlüssel-Transfer** (H3). Keine Migration der Identitätsdatei.
- Risiko Native-Addon: `sodium-native` ist ein N-API-Addon. Geprüft unter Linux x64 in Node 22 und Electron 44; Windows/macOS haben Prebuilds, sind hier aber nicht ausgeführt. Der Lab ist ungepackt und Linux-zentriert (Szene nur Linux). Fehlt das Addon, bleibt der Host ohne `deps` (`lab-ipc.ts:116` fängt den Import ab) → `unavailable`, kein Absturz.
- Risiko Latenz: ≈ 2 Pollrunden mehr beim Aufbau; Fristen (55 s Zustimmung, 60 s Anfrage) sind weit genug.
- Risiko Kompaktierung: Geräte, die länger als `RETAIN` Abgleiche offline waren, verlieren die gemeinsame Basis → expliziter Konflikt statt Auto-Merge. Das ist der dokumentierte, sichere Ausgang. Keine Daten gehen verloren (beide Köpfe bleiben).
- Risiko Löschrecht per Konto/Token: Verfügbarkeit, nicht Vertraulichkeit; `history` erkennt unautorisiertes Löschen; lokaler Checkpoint hält die Historie. H3 bindet Löschungen an Geräte.
- Risiko `privateNetwork` im fremden WLAN: Serverpasswort, Token und Ciphertext im Klartext. Text im Dialog sagt es; M3 verhindert weiterhin, dass das Vault-Passwort dabei ist.
- Risiko Permissions-Verschärfung: Falls `getDisplayMedia` auf einer Plattform als `media`-Request mit leerer Liste ankommt, scheitert die Freigabe. Gate ist die Szene; Rückfall nur nach H1-Validierung §7.
- `prefers-reduced-motion`/Motion-Gate unberührt: H2 fügt keine Bewegung hinzu. Neue UI-Elemente (Checkbox, Hinweis, ein Knopf, zwei Zeilen) nutzen bestehende Klassen `.remote-lab-caption`, `.remote-lab-warning`, `.sync-lab-notice`, `.secondary-button`; keine neuen Werte, keine Inline-Styles.

---

## 8. Zerlegung in Tasks und Wellen (dateidisjunkt)

Jeder Task arbeitet test-first, ändert nur eigene Dateien, committet nicht. Nach jeder Welle müssen `npm run typecheck` und `npx vitest run` grün sein. Innerhalb von Welle 1 passen T1 und T2 ihre Tests gegen den gemeinsamen Vertrag (§4.1, §4.2, §5) an; grün ist die Welle erst mit beiden.

### Welle 1 (parallel)

| Task | Dateien | Pflichtpunkte | Pflichttests |
| --- | --- | --- | --- |
| **T1 Noise-Kanal** | `scripts/sync-prototype/rendezvous-client.mjs`, `rendezvous-client.test.mjs` (neu, In-Memory-Fake des `store.request` mit Warteschlange, Zustand `active` nach `accept`) | §4.1, §5; `noiseKeyPair`/`spkiOf`; Handshake-Treiber in `receive()`; `accepted` nach Handshake; AD leer; Limits | Handshake A/V bis `ready` beidseitig (Reihenfolge wie §5, Sequenzen 1,2,3 A→V, 1 V→A); `rs` ≠ erwarteter Fingerprint → wirft, nichts `ready`; falscher Prologue (anderer `scope`/`nonce`/`serverId`/vertauschte Rollen) → Nachricht 2 scheitert; Payload in Handshake-Frame → wirft; `send` vor `ready` → wirft; `accepted` mit anderem `scope` → wirft; Daten erst nach `accepted`; ausgelassener Frame (Server unterschlägt seq 2) → Entschlüsselung scheitert; Frame > 8208 Byte → abgelehnt; `noiseKeyPair` gegen `createPublicKey` (öffentlicher Teil bytegleich mit JWK `x`); `dispose` nullt Zähler-Schlüssel; Lieferung ohne Quittung wird nicht doppelt ausgeliefert |
| **T2 Server-Frames, Info, DELETE, Listen** | `rendezvous.mjs`, `rendezvous.test.mjs`, `server.mjs`, `server-vault.test.mjs` oder `server.test.mjs`, `http-common.mjs`, `account-transport.mjs`, `server/main.mjs`, `server/smoke.mjs` | §4.2; `rendezvousNoise`; `exact(body,'frame,sequence')`; DELETE-Semantik; `listen(net.isIP)`; Smoke treibt den Handshake (Schleife `receive()` beider Seiten bis `ready`, ≤ 6 Runden) | Altes Frame-Format → 400; `frame` 8209 Byte → 400; Retry mit identischem Frame → 200 idempotent, anderer Inhalt gleicher Sequenz → 409; `/v1/info.rendezvousNoise === true` nur mit Broker; Integrationstests (`pair()`, Zustimmung, Manipulation, Ablauf) auf den Handshake umgestellt, keiner gestrichen ohne Ersatz; DELETE: 200 + Listing kleiner + Datei weg + `total` sinkt (nächster PUT passt wieder); unbekannt → 404; ohne Token → 401; Gerätemodus → 405; Body → 400; nach Neustart konsistent; `listen('10.9.8.7')` wird akzeptiert (Bind-Fehler ist erlaubt, Prüfung über `check`), `listen('nicht-ip')` → wirft |
| **T3 URL-Regeln** | `src/shared/sync-server-url.mjs`, `sync-server-url.test.ts` | §4.3 | boolean bleibt loopback; `{private:true}`: `http://10.8.0.1:8787/` ok, `http://100.64.3.4/` ok, `http://[fd7a:115c:a1e0::1]/` ok, `http://192.168.1.5/` ok; `http://169.254.1.1/`, `http://[fe80::1]/`, `http://8.8.8.8/`, `http://server.lan/`, `http://sync.example.net/` → null; `https://` weiterhin überall; ohne `private` → null für alle Tunneladressen |
| **T4 Kompaktierung (Kern)** | `src/main/sync-prototype/vault-sync.ts`, `vault-sync.test.ts` | §4.6, §2.3 | Fake-Remote mit `remove`; 33 Abgleiche → genau eine Kompaktierungsversion, Server-Listing ≤ 17 + Kopf, `compacted > 0`, lokaler Checkpoint kleiner, zweiter Abgleich `synced`; zurückkehrendes Gerät mit `acked` auf kompaktierte IDs → `synced`, nicht `history`; Server löscht ein `acked`-Objekt **ohne** deckenden `compacts` → `history`; manipuliertes `compacts` (anderer Schlüssel) → ungelesen, `history`; Gerät mit Zweig auf kompaktierter Basis → `conflict` (kein Auto-Merge, nichts gelöscht); Kompaktierung bricht nach dem ersten `remove` ab → nächster Abgleich repariert ohne `history`; Import nach Kompaktierung → Erfolg, ein Kopf; keine Kompaktierung bei zwei Köpfen oder `pending`; `removeForeignObjects` löscht nur weiterhin Unlesbares, lesbares Objekt in `ids` bleibt (Zähler korrekt) |
| **T5 Permissions** | `src/main/permissions.ts`, `permissions.test.ts` | §4.8 | tabellengetrieben: `media` request mit `[]`, `['video']`, `['audio']` → false auch bei Grant; `display-capture` → Grant; `media` check `video` → Grant, `audio`/`undefined` → false; Rest unverändert |
| **T6 Dialog-Throw** | `src/main/remote/lab-ipc.ts`, `lab-ipc.test.ts` | §4.9 | `showMessageBox` wirft → `'unavailable'`; `lab-ipc.test.ts:142-147` entsprechend angepasst; alle anderen Fälle unverändert |
| **T7 Prüfung 16 Hex** | `src/shared/remote-lab.ts` (nur `verificationHex`, `connect.privateNetwork?`), `src/shared/remote-signal.ts`, `remote-signal.test.ts`, `src/main/remote/lab-host.test.ts` (nur `:14`) | §4.4 | `normalizeVerification`: 15/17 Zeichen → null, 16 mit Leerraum/Großschreibung → ok; `verifyFingerprintPrefix` 16 Zeichen true/false; bestehende Tests mit 12 auf die Konstante umgestellt |
| **T11 Betrieb** | `server/compose.wireguard.yaml` (neu), `server/README.md`, `scripts/sync-prototype/README.md`, `docs/plans/docker-rendezvous.md` | README „Privates Netz“ (Tailscale `serve` zuerst: Port bleibt `127.0.0.1`, Hinweis, dass `tailscale serve` `X-Forwarded-For` setzt und `TRUSTED_PROXY=1` bleibt – im Lab einmal real zu prüfen; dann WireGuard: `compose.wireguard.yaml` mit `ports: "${SHELLHERD_BIND_ADDR:?WireGuard-Adresse}:8787:8787"`, **ohne** `TRUSTED_PROXY`, Client-Checkbox „Privates Netz“), API-Tabelle (`{sequence, frame}`, `DELETE …/objects/:id`, `rendezvousNoise`), Abschnitt „Kompaktierung“ (Retention 16/32, Konto = ein Vault, Löschen nur auf Konto-Auftrag), Abschnitt „Ende-zu-Ende-Prüfung“ auf Noise XX umgeschrieben (Forward Secrecy, 16 Zeichen) | `docker compose -f server/compose.wireguard.yaml config` mit gesetzter Variable, sofern Docker vorhanden (sonst im Bericht) |

### Welle 2 (nach Welle 1, parallel)

| Task | Dateien | Pflichtpunkte | Pflichttests |
| --- | --- | --- | --- |
| **T8 RemoteLabHost** | `src/main/remote/lab-host.ts`, `lab-host.test.ts`, `src/main/remote/lab-ipc.ts` (nur `probe`-Verdrahtung mit `allowPrivateHttp`, `RemotePeer`-Typ) | §4.5 | connect ohne `rendezvousNoise` → `unavailable`; `privateNetwork:true` + `http://10.8.0.2:8787/` → probe mit `allowPrivateHttp`; ohne Flag → `invalid`; `channel(session, fingerprint, 'view')` ohne Serverkey; Agent: `accept` → `channel.accept()` → Fake-Kanal wird nach 2 `receive()` `ready` → `connecting`, `sharing`, Deadline = sessionMs; Fake wirft bei `receive` (Fingerprint) → `ended/failed` + Fehler `mismatch`; Frist während Handshake → `expired`; `decline` während Handshake → `declined`, kein `connecting`; Viewer: `active` → `#establish` → `connecting` erst bei `ready`; `signal` vor `ready` → `stale`; bestehende Tests angepasst, keiner gestrichen ohne Ersatz |
| **T9 Sync-Lab** | `src/shared/sync-lab.ts`, `src/main/sync-prototype/lab-host.ts`, `lab-host.test.ts`, `lab-ipc.ts`, `lab-ipc.test.ts` | §4.7 | `privateNetwork` → probe-Option; gesperrt + gleiches Passwort beim Import → `samePasswordImport`, `syncVault` nicht aufgerufen, Digest danach genullt (zweiter Import mit anderem Passwort läuft); entsperrt (geprüft) → kein Digest; `removeForeign` ohne `foreign` → `invalid`; mit `foreign` → Aufruf mit IDs, `removedForeign` im Zustand, `foreign` nie im Zustand; `compacted` wird durchgereicht; `reset`/`close` nullt den Digest |
| **T10 Renderer** | `RemoteLabDialog.tsx`, `RemoteConsentDialog.tsx`, `SyncLabDialog.tsx`, `remote-lab.css`, `sync-lab.css` (nur Tokens, falls nötig), `src/shared/locales/{de-DE,en-US}/remoteLab.json`, `syncLab.json`, `src/renderer/src/remote-lab.ts` (nur, wenn Keys dazukommen) | §10 Texte; Checkbox „Privates Netz“ in beiden Verbinden-Formularen (nur aktiv, wenn `isPrivateTunnelAddress(hostname)` **und** `http:`); `normalizeSyncServerUrl(url, { loopback: true, private: checked })` für den Knopf; `connect` mit `privateNetwork`; Feld-Label „Erste 16 Zeichen …“, `maxLength={23}` bleibt; Sync-Ergebnis: Zeile `compacted` (nur > 0), Knopf „Fremde Objekte entfernen“ nur bei `skipped > 0`, Ergebniszeile `removedForeign`; Fehlertext `samePasswordImport`; i18n-Katalogtest grün | bestehende Komponententests angepasst; `remote-lab.test.ts` Maps vollständig (`satisfies` bleibt) |

### Welle 3

| Task | Dateien | Pflichtpunkte |
| --- | --- | --- |
| **T12 Doku + Szene** | `docs/handbuch.md` §„Fernzugriff (Entwicklung)“ und Sync-Abschnitt, `docs/plans/selfhosted-e2ee.md`, `selfhosted-threat-model.md`, `selfhosted-protocol.md`, `.claude/skills/run-app/remote-scene.mjs` (`FIRST_12` → 16, Label-Text), `.claude/skills/run-app/SKILL.md` | Handbuch: 16 Zeichen = „die ersten zwei Gruppen“, Noise XX und Forward Secrecy, privates Netz (Checkbox, Warnhinweis), Kompaktierung (Retention, expliziter Konflikt nach langer Offline-Zeit, „Fremde Objekte entfernen“, ein Konto = ein Vault), `samePasswordImport`-Text, Permissions-Verschärfung; Threat-Model: Stand N3 behoben, M2-Restrisiko 48 Bit → 64 Bit, neue Tabelle „H2“, Löschrecht per Konto als benannte Grenze; Protokollplan: Rendezvous-Profil, Prologue, Rollen, Frame-Format, Kompaktierungsregeln; Szene prüft zusätzlich, dass die Verbindung nach der Zustimmung innerhalb von 8 s `connecting`/aktiv wird (Handshake-Latenz), und dass B bei A kein Fingerprint-Feld sieht, wenn der Pin geprüft ist (unverändert) |

### Abschluss (Lead)

- `npm run typecheck`, `npx vitest run`, `node server/smoke.mjs`.
- `npx electron-vite build`, run-app-Screens (`terminal`, `sftp`, `settings`) und `remote-scene.mjs` mit `/console`-Prüfung; die Szene ist das Gate für T5 (Permissions) und T8 (Handshake-Latenz).
- `node scripts/check-server-container.mjs`, wenn Docker verfügbar.
- Kein CHANGELOG, keine Version im Lab-Branch (wie H1); der Lead entscheidet beim Stapel-Abschluss.

---

## 9. Minimale erste Stufe gegenüber Extras

**Minimal (ohne das ist H2 nicht erfüllt):** T1, T2 (Frames, Info, DELETE, Listen), T3, T4 (Kompaktierung eigener Historie), T7, T8, T9 (Teil: `privateNetwork`, `compacted`), T10 (Teil: 16 Zeichen, Checkbox, `compacted`-Zeile), T11 (README Privates Netz, Compose-Variante), T12.

**Extras innerhalb von H2 (abtrennbar):** T5 Permissions-Verschärfung, T6 Dialog-Throw, M3 beim Import (`samePasswordImport`, Teil von T9/T10), „Fremde Objekte entfernen“ (`removeForeignObjects`, Teil von T4/T9/T10), Smoke-Handshake-Umbau in T2 (Pflicht, sobald T1 landet, aber klein).

**Wandert nach H3:** Ed25519-Gerätesignaturen auf Versionen, Löschungen und Verlaufsankern; Geräte-Roster am Server; signierte Requests statt Passwort; Sync-Schlüssel-Transfer per Noise-Pairing oder Wiederherstellungscode; Bindung von `DELETE` an ein Gerät statt ans Konto.

---

## 10. Texte (wörtlich, de-DE / en-US)

`remoteLab.json` (T10):

| Key | de-DE | en-US |
| --- | --- | --- |
| `verify.label` (geändert) | Erste 16 Zeichen des Fingerabdrucks vom anderen Gerät (die ersten zwei Gruppen) | First 16 characters of the fingerprint from the other device (the first two groups) |
| `privateNetwork.label` | Privates Netz (WireGuard/Tailscale): HTTP erlauben | Private network (WireGuard/Tailscale): allow HTTP |
| `privateNetwork.hint` | Nur für eine WireGuard- oder Tailscale-Adresse dieses Servers. Außerhalb eines solchen Tunnels könnte das Netz Serverpasswort und Daten mitlesen. Dein Vault-Passwort bleibt lokal. | Only for a WireGuard or Tailscale address of this server. Outside such a tunnel the network could read the server password and data. Your vault password stays local. |
| `connecting` | Verschlüsselte Verbindung wird aufgebaut … | Establishing the encrypted connection … |

`syncLab.json` (T10):

| Key | de-DE | en-US |
| --- | --- | --- |
| `privateNetwork.label` | Privates Netz (WireGuard/Tailscale): HTTP erlauben | Private network (WireGuard/Tailscale): allow HTTP |
| `privateNetwork.hint` | wie oben | as above |
| `serverHint` (geändert) | Trage deinen Server mit HTTPS ein. HTTP ist nur für 127.0.0.1, ::1 oder – nach Bestätigung – für eine WireGuard-/Tailscale-Adresse erlaubt. Keine Vault-Passwörter oder Schlüssel in die URL eintragen. | Enter your server with HTTPS. HTTP is allowed only for 127.0.0.1, ::1 or, after confirmation, for a WireGuard/Tailscale address. Never put vault passwords or keys into the URL. |
| `compacted_one` | {{count}} ältere Version wurde zusammengefasst und vom Server entfernt. | {{count}} older version was compacted and removed from the server. |
| `compacted_other` | {{count}} ältere Versionen wurden zusammengefasst und vom Server entfernt. | {{count}} older versions were compacted and removed from the server. |
| `removeForeign` | Fremde Objekte entfernen | Remove foreign objects |
| `removeForeignHint` | Entfernt nur Objekte, die sich mit deinem Vault-Passwort nicht lesen lassen. Ein Serverkonto trägt genau einen Vault. | Removes only objects that cannot be read with your vault password. A server account holds exactly one vault. |
| `removedForeign_one` | {{count}} fremdes Objekt wurde entfernt. | {{count}} foreign object was removed. |
| `removedForeign_other` | {{count}} fremde Objekte wurden entfernt. | {{count}} foreign objects were removed. |
| `errors.samePasswordImport` | Das Vault-Passwort ist zugleich dein Serverpasswort, und dieses wurde bereits an den Server gesendet. Der Import wurde abgebrochen. Ändere das Vault-Passwort auf dem Ursprungsgerät und wechsle das Serverpasswort. | The vault password is also your server password, and that one was already sent to the server. The import was cancelled. Change the vault password on the source device and rotate the server password. |

Keine dynamischen Keys; Fehlermaps bleiben volle Literale (`SyncLabDialog.tsx:63-69`, `remote-lab.ts:4-32`). Entfernt wird nichts; `verify.hint` bleibt.

---

## 11. Offene Entscheidungen mit Empfehlung

1. **Präfixlänge:** 16 Hex (64 Bit). Empfehlung: 16; 12 ist gegen eine GPU-Farm nicht haltbar, 20 unzumutbar, SAS grindbar, PAKE nicht ohne Eigenbau.
2. **Alte Pins (48 Bit) behalten oder neu tippen?** Behalten; H1 lief nur im Lab. Kosten, falls falsch: ein theoretisch 48-Bit-gegrindeter Pin bliebe – im Lab ohne reale Gegner irrelevant.
3. **Initiator-Rolle:** Agent. Spart eine Pollrunde; Identitätsverbergen ist kein Ziel.
4. **Host wartet im `accept` auf den Handshake vs. Renderer wartet auf `connecting`:** Host wartet (`#establish`). Renderer bleibt unverändert; IPC-Antwort verzögert sich um ≈ 2–3 s, die UI zeigt `granted` mit aktivem „Ablehnen“.
5. **Frame-Format:** opakes `{sequence, frame}` statt Doppelformat. Kein Downgrade, alte Clients scheitern sichtbar (400). Kosten: gleichzeitige Aktualisierung aller Lab-Geräte.
6. **Privates Netz:** Opt-in-Checkbox pro Verbindung, nur numerische Tunnelbereiche, nicht persistent. Empfehlung: ja; Tailscale `serve` als erster Weg ohne Client-Änderung.
7. **Eigene CA/Pinning:** nein (Betriebslast, `fetch` ohne CA-Steuerung, kein Reviewgewinn gegenüber Tunnel).
8. **Tombstone-Ort:** `compacts` im Versionsdokument statt eigener Objektart. Empfehlung: ja; kein neues Format, Server-seitig unsichtbar, H3 signiert dieselbe Version.
9. **Retention:** 16 behalten, kompaktieren ab 32. Empfehlung: ja; etwa jeder 16. Abgleich erzeugt eine Kompaktierungsversion; länger als 16 Abgleiche abwesende Geräte landen im expliziten Konflikt.
10. **Fremde Objekte löschen:** nur explizit, mit erneuter Leseprüfung, Regel „ein Konto = ein Vault“. Empfehlung: als Extra, nie automatisch.
11. **DELETE-Berechtigung:** Konto (wie Upload). Empfehlung: ja für H2; H3 bindet an Geräte.
12. **Permissions:** Legacy-Desktop-`getUserMedia` zu, Gate Szene. Empfehlung: ja, mit dem H1-Rückfall als einziger erlaubter Lockerung.
13. **Dialog-Throw:** `'unavailable'`. Empfehlung: ja.
14. **M3 beim Import:** Digest-Vergleich und Abbruch mit klarem Text. Empfehlung: ja; es ist Erkennung, keine Verhinderung, und der Text sagt das.
15. **CHANGELOG/Version:** wie H1 nicht im Lab-Branch. Empfehlung: Lead entscheidet beim Stapel-Abschluss.
