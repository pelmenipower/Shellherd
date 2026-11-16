# H4 – Schlüsselepochen, Anmeldecodes, Roster-TOFU (Design und Plan)

Stand: 2026-11-10. Branch `claude/feature/key-epochs`, gestapelt auf `claude/feature/holistic-hardening` (PR #47), dieser auf `claude/feature/device-keys` (PR #46).

## 0. Rulings (Lead)

- **R-H4-1 Konzept übernommen:** Ab Abschnitt „Konzept“ unten ist die Recherche des Konzept-Agenten mit allen 18 Empfehlungen aus §11 verbindlicher Teil dieser Spec.
- **R-H4-2 Umfang:**
  - Pflicht: Schlüsselepochen mit `rotateSyncKey` statt `regenerateRecoveryCode`, Anmeldecodes mit `invite-only` per `lock-enrollment` und Roster-TOFU im Sync-Lab.
  - Extras in diesem Branch: Unix-Socket (S3-Rest), Build-Konstante `__SHELLHERD_LABS__` und die Sync-Szene in CI. Die CI-Szene fliegt raus, wenn sie in CI flaky ist (Ruling im Ledger).
- **R-H4-3 Lab-Bruch:** erlaubt, wie in §5 beschrieben. Geräte müssen sich nicht neu einschreiben, aber das erste Gerät gleicht neu ab (Epoche 1, neuer Code).
- **R-H4-4 Nach H5:** TOTP ist endgültig gestrichen. V5, V6, V8, A11 und der Rest der Fuses gehen nach H5.
- **R-H4-5:** Kein CHANGELOG, keine Version.
- **R-H4-6 Wellen:** wie in §8. Die bindende Validierung kann sie ersetzen.

---

## Konzept

Stand: 2026-11-10. Branch `claude/feature/holistic-hardening` (H3 und H3.1 umgesetzt, HEAD `3cec95c`). Reines Lesekonzept, kein Code geändert. Bindend bleiben: SEC-01…SEC-12 (`docs/plans/selfhosted-threat-model.md`), R-H3-1…R-H3-4 und E1…E11 aus `2026-11-09-device-keys-validation.md`, R-H31-1…R-H31-9 und E1…E14 aus `2026-11-10-holistic-hardening-validation.md`. Leitentscheidung unverändert: **keine eigene Kryptografie**, nur Node-`crypto` (HKDF-SHA256, AES-256-GCM, Ed25519, `randomBytes`) und die bestehende AEAD-Komposition.

## 0. Kurzurteil

**H4 = „Niemand liest Neues mit, niemand kommt ohne eingeschriebenes Gerät hinein.“** Drei Dinge gehören hinein, in dieser Reihenfolge:

1. **Schlüsselepochen** (`K_sync` je Epoche, Rotation beim Widerruf und beim neuen Code; ersetzt `regenerateRecoveryCode`). Das ist der größte offene Sicherheitspunkt (C2/T04: ein widerrufenes Gerät oder ein geleakter Code liest sonst dauerhaft, Threat-Model `:66,:86`). Nur Client-Kern plus Hüllenformat, der Server bleibt dumm.
2. **Anmeldecodes von einem eingeschriebenen Gerät** plus Server-Schalter „nur mit Anmeldecode“. Das Serverpasswort wird reiner Bootstrap, und der einzige online ratbare Wert verschwindet aus dem Normalbetrieb (S4-Rest, Threat-Model `:60,:83`). Ein Code genügt dem neuen Gerät für Einschreibung **und** Sync-Schlüssel (zwei HKDF-Ableitungen aus einem 128-Bit-Zufall; der Server sieht nur die Einschreibe-Ableitung).
3. **Roster-TOFU** im Sync-Lab (Geräteliste in der Identitätsdatei gepinnt; neues Gerät wird gemeldet, Schlüsselwechsel eines bekannten Geräts ist ein harter Fehler, ein „vergessener“ Widerruf zählt weiter). Schließt den offenen Satz im Threat-Model `:145` („noch nicht erfüllt“) und macht einen Passwort-Leck-Eindringling sichtbar.

**Nicht in H4:** TOTP (endgültig nein), V5/V6/V8 (Fernansicht-Isolation, Windows-Aufnahmeschutz, Doppelklick → **H5 „Fernansicht-Isolation“**), A11 (Zustandsmaschinen vereinheitlichen → H5, dann mit beiden Hosts), restliche Fuses (brauchen den Windows-Signaturtest des Nutzers, nicht pipeline-fähig), Per-Gerät-Keybox über X25519 (ECIES-Eigenkomposition, R-H3-2).

**Kleine Extras in H4, abtrennbar:** Unix-Socket für den Server hinter Caddy (S3-Rest `:82`), Build-Konstante für Release-Bundles ohne Lab-Pfade (A5-Option), Sync-Szene in CI (A12).

Lab-Bruch ist erlaubt (wie R-H3-3/R-H31-2): Hülle v2 mit Epoche, Keybox v2, Autorenstempel v2, Nachweis v4 mit Body-Digest, Checkpoint v3, Identitätsdatei v4. Geräte schreiben sich **nicht** neu ein (Einschreibedokument und Roster-Schlüssel unverändert); das erste Gerät gleicht neu ab und zeigt einen Code, die weiteren laden neu.

---

## 1. Bestand und Lücken

| Thema | Bestand (`datei:zeile`) | Lücke |
| --- | --- | --- |
| Sync-Schlüssel | Ein `K_sync` je Konto, Versionsschlüssel `HKDF(K_sync, [serverId,namespace], 'shellherd-sync-version-v2')` (`vault-sync-crypto.ts:89-92`), Hülle `format,version,kind,cipher,payload` ohne Epoche (`:78-87`, Server `sync-object-wire.mjs:12-20`), AAD `[format,1,kind,serverId,namespace]` (`:98`) | Keine Rotation. `regenerateRecoveryCode` (`vault-sync.ts:467-503`) verpackt denselben Schlüssel neu; der Text sagt das ehrlich (`syncLab.json` `recoveryCodeRegenerateHint`, R-H31-7). Ein widerrufenes Gerät behält `K_sync` (Threat-Model `:66`), ein alter Code plus alte Serverkopie liest weiter (`:86`) |
| Keybox | `{kind:'shellherd-sync-keybox-v1', method:'recovery', syncKey, createdBy}` (`vault-sync.ts:53`), Wrap `HKDF(code16, salt, 'shellherd-sync-keybox-recovery-v1')` (`vault-sync-crypto.ts:93-97`), höchstens 8 probiert (`:156-165`) | Nur ein Weg zum Schlüssel (Code tippen); keine Epoche in der Keybox |
| Bootstrap-Marker | Pending-Marker `state.keybox`, `settle` löscht ihn erst mit der Antwort (`vault-sync.ts:227-256,276`), Wiederholungspfad ersetzt die Keybox nach Absturz (`:243-256`) | Gutes Muster; die Rotation kann es wörtlich wiederverwenden (E13-Rest wird damit erledigt) |
| Adoption fremder Stände | Lokale Änderungen seit `projection` werden auf `working` gemerged (`vault-sync.ts:282-285`) | Genau diese Stelle trägt die Epochenübernahme eines anderen Geräts (Abschnitt 4.1) |
| Autorenstempel | `['shellherd-sync-author-v1', serverId, namespace, parents, compacts, digest, device, at]` (`vault-sync.ts:59-60`), Prüfung `stance` (`:94-103`) | Ohne Epoche |
| Einschreibung | `POST /v1/devices` nur mit Passwort (`server.mjs:158-173`), `verifyPassword` mit globaler Sperre (`account-auth.mjs:83-100`), Roster-Eintrag `id,name,signingKey,noiseKey,enrolledAt,revokedAt` (`device-roster.mjs:26`, `VERSION = 2` `:10`) | Kein zweiter Einschreibepfad; das Passwort ist der einzige online ratbare Wert und kann nicht abgeschaltet werden; kein Vermerk, wer ein Gerät eingeschrieben hat |
| Signierte Requests | `requestProofV2 = [tag, serverId, namespace, origin, method, path, nonce, device]` (`device-proof.mjs:45-48`), nur für `DELETE /v1/devices/:id` mit leerem Body (`server.mjs:194-213`) | Kein Body-Digest; ein signierter `POST` mit Inhalt (Einladung) braucht ihn |
| Roster im Client | Frisch je Lauf vom Server, eigener Eintrag streng (`lab-host.ts:107-114`), `revokedAt`/`keyOf` ungeprüft übernommen (`:115-125`) | Kein Pin: Server kann einen Widerruf „vergessen“ (Threat-Model `:145`), ein Passwort-Eindringling fällt nur beim Blick in die Liste auf |
| Identitätsdatei | v3 mit `enrollments[] = {serverId, namespace, serverUrl, username, name, enrolledAt}`, MAC über alles (`identity.ts:29-36,63-74,94-100`) | Kein Platz für einen Roster-Schnappschuss |
| Server-Netz | TCP-Port, `trustedProxy` als CIDR (`server.mjs:321-330`, `rate-limit.mjs`), Compose mit festem Projektnetz | Lokale Prozesse auf dem Homeserver erreichen `127.0.0.1:8787` als Gateway-Quelle und setzen XFF (`threat-model.md:82`) |
| Paket | Fuses `RunAsNode` (Linux) und `NODE_OPTIONS` aus (`linux-after-pack.cjs:11-15`), Smoke liest die Wire (`smoke-linux.mjs:35-38`); Lab-Hosts liegen vollständig im Release-Bundle (`index.ts:267-270` registriert sie immer) | Inspect-/asar-Fuses offen (Windows-Test fehlt, E1); kein Build-Schalter, der die Lab-Pfade aus `dist*` entfernt |
| Fernansicht | WebRTC und Decoder im Vault-Renderer (`remote-peer.ts:12`, `RemoteLabDialog.tsx:163`), Fensterschutz nur für `BrowserWindow`s (`index.ts:79-80`) | V5/V6/V8 unverändert (bewusst H5) |
| Szenen | `sync-scene.mjs` nur manuell; CI baut und startet nur das gepackte Paket (`ci.yml`) | Kein E2E-Gate in CI |

Gut und unverändert: Origin-Bindung, zustandslose Nonces, Quarantäne mit Vorfahren-/`acked`-Schutz, Keybox-Bootstrap mit Marker, Opt-in für fremde Versionen, strikte Hüllenprüfung beidseitig.

---

## 2. Bewertung der Kandidaten

### 2.1 Schlüsselepochen (Kandidat 2) – **H4, Pflicht**

Sicherheitsgewinn ★★★: Nach Widerruf oder Codewechsel liest ein widerrufenes Gerät, ein alter Code und eine alte Serverkopie **nichts Neues** mehr. Das ist das T04-Versprechen („alte Berechtigungen gewähren keine neuen Daten“) und schließt C2 wirklich. Aufwand: Sync-Kern (Main) plus Hüllenformat (Server-Validator, Client-Parser). Risiko: Zwei-Wurzeln-Problem bei Geräten mit ungesyncten Änderungen; wird durch die Adoptionsregel (4.1) auf einen normalen Konflikt reduziert.

Verworfen: Schlüsselverteilung an bestehende Geräte über ihre X25519-Schlüssel aus dem Roster (Server liefert die Schlüssel; bis Roster-TOFU gepinnt ist, wäre das eine Hintertür für einen Server, der Schlüssel tauscht; außerdem ECIES-Eigenbau, R-H3-2). Andere Geräte übernehmen die neue Epoche **nur** durch Eintippen des neuen Wiederherstellungscodes. Bei zwei bis vier Geräten am Homeserver ist das zumutbar, und der Text sagt es vorher.

### 2.2 Anmeldecodes (Kandidat 1) – **H4, Pflicht**, mit Server-Schalter

Sicherheitsgewinn ★★★ zusammen mit dem Schalter `invite-only`: Es gibt dann keinen Request mehr, den man mit Raten beantwortet bekommt (S4 und der Besitzer-Aussperr-Nebeneffekt der globalen Sperre entfallen im gesperrten Zustand). Ohne Schalter ★★ (Komfort, Passwort seltener auf der Leitung). Aufwand: Server (eine Route, ein Body-Zweig, Roster-Feld), Client-Transport, Sync-Kern (Einladungs-Keybox), Sync-Host und Dialog.

Entscheidung „ein Code“: Das einladende Gerät erzeugt 16 Zufallsbytes. Daraus `HKDF(…, 'shellherd-invite-enroll-v1')` für den Server (Einschreibe-Nachweis) und `HKDF(…, 'shellherd-sync-keybox-invite-v1')` für eine Einladungs-Keybox mit `K_sync` der aktuellen Epoche. Der Server kennt nur die erste Ableitung und kann die Keybox nicht öffnen (HKDF ist eine Einwegfunktion, getrennte `info`). Das neue Gerät tippt einen Code und hat danach Einschreibung **und** Schlüssel. Der Wiederherstellungscode bleibt die Offline-Sicherung. Verworfen: zwei Codes (Anmeldecode + Wiederherstellungscode) als Pflichtweg, weil das zweite Gerät sonst den langlebigen Code abtippen muss, den man eigentlich im Safe lassen will. Abtrennbar bleibt die Keybox-Hälfte (Extra, Abschnitt 9).

Verworfen: Server-erzeugte Codes (der Server kennt dann den Code), Kurzcodes mit 6–8 Ziffern (Entropie, Ratelimit-Konzept nötig), QR (keine Kamera im Lab).

### 2.3 Roster-TOFU (Kandidat 3) – **H4, Stufe 1**, nur Sync-Lab

Sicherheitsgewinn ★★: Ein Gerät, das mit Passwort eingeschrieben wurde, ohne dass dieses Gerät es eingeladen hat, erscheint als Meldung mit Bestätigung; ein Server, der für ein bekanntes Gerät einen anderen Signaturschlüssel liefert, wird hart abgewiesen (`syncRoster`); ein Widerruf, den der Server „vergisst“, gilt im Client weiter (Quarantäne nutzt `max(gespeichert, Server)`). Aufwand: `identity.ts` (v4), Sync-Host, Dialog, Texte. Das Remote-Lab lädt kein Konto-Roster (nur Rendezvous-Präsenz, dort gelten die Pins) und braucht nichts.

### 2.4 TOTP (Kandidat 4) – **nein, endgültig**

Mit `invite-only` gibt es im Normalbetrieb keinen Passwortrequest mehr, den ein zweiter Faktor schützen müsste. TOTP brächte ein zweites Servergeheimnis, Uhrabgleich und Provisionierung für den Bootstrap-Einzelfall. Streichen.

### 2.5 V5/V6/V8 (Kandidat 5) – **H5 „Fernansicht-Isolation“**

V5 (eigene `WebContentsView`/Fenster ohne Vault-Preload) ist die wichtigste Architekturaufgabe der Fernansicht (Decoder-/WebRTC-CVE im Vault-Renderer), aber ein eigener Umbau: neue Fensterrolle in `windows.ts`, Minimal-Preload, Event-Routing an das neue `webContents`, `requireMain` erweitern, Consent-Dialog und Share-Bar bleiben im Hauptfenster. Das sprengt H4 (schon sieben Tasks) und ist dateilich fast disjunkt zu allem hier, also sauber als H5 zu fahren. V6 verlangt Windows-Tests (RDP-Helfer, `SetWindowDisplayAffinity`), die diese Pipeline nicht leisten kann. V8 ist ein Nit, der zu V5 passt (Accept-Knopf nach dem Klick sperren). Alle drei zusammen nach H4.

### 2.6 A11, A12, Build-Konstante, Fuses (Kandidat 6)

- **A11** (gemeinsamer `DeviceSessionClient` für beide Hosts): Wartbarkeit, kein direkter Sicherheitsgewinn, Regressionsrisiko in zwei Zustandsmaschinen. **H5**, nach den H4-Änderungen am Sync-Host (sonst wird das Zusammenlegen zweimal gemacht).
- **A12** (Sync-Szene in CI): H4 ändert den Einrichtungsfluss grundlegend (Anmeldecode, Rotation); die Szene ist der einzige E2E-Nachweis. **H4 Extra** (Welle 3, abtrennbar, weil Flake-Risiko im Linux-Job).
- **Build-Konstante** (`__SHELLHERD_LABS__`): ★★ bei kleinem Aufwand, entfernt Hosts, Vault-Sync und Lab-IPC aus `dist*`. **H4 Extra** im Paket-Task.
- **Fuses-Rest** (Inspect, asar): hängt am Windows-Signaturtest des Nutzers (E1). Bleibt offener PR-Punkt, kein Task.
- **Unix-Socket** (S3-Rest): ★★, Server-Task. **H4 Extra**.

---

## 3. Empfehlung je Fläche

| Fläche | Empfehlung | Wert | Aufwand |
| --- | --- | --- | --- |
| Hülle und Schlüsselableitung (`vault-sync-crypto.ts`, `sync-object-wire.mjs`) | Hülle v2 mit `epoch`; Epoche in AAD, HKDF-Salt und Autorenstempel; Keybox v2 mit `epoch` und `method: 'recovery' \| 'invite'` | ★★★ | Main + Server-Skript |
| Sync-Kern (`vault-sync.ts`, `vault-sync-state.ts`) | `rotateSyncKey` ersetzt `regenerateRecoveryCode`; Epochenübernahme (`syncRotated`); Alt-Epochen-Aufräumen; `createInvite`; Import/Sync mit Einladungscode; Checkpoint v3 | ★★★ | Main |
| Server (`server.mjs`, `device-roster.mjs`, `account-auth.mjs`, `main.mjs`) | `POST /v1/invites` (signiert, Body-Digest), Einschreibung mit `invite`, `enrolledBy` im Roster (v3, additive Migration), Schalter `enrollment: 'password' \| 'invite-only'` mit Offline-Befehlen `lock-enrollment`/`unlock-enrollment`, Einladungs-Keybox-Löschung bei Verfall | ★★★ | Server-Skript |
| Nachweise (`device-proof.mjs`) | `requestProofV3 = [tag v4, …, nonce, device, sha256(body)]`; Parität in `lab-host.ts` unnötig (Client signiert über `account-transport.mjs`) | ★★ | Skript |
| Client-Transport (`account-transport.mjs`, `http-common.mjs`) | `invite(identity, {secret, object})`, `enrollWithInvite(identity, {secret, name, ephemeral})`, `devices()` mit `enrolledBy`, Probe verlangt `info.invites === true && info.objectEpochs === true` | ★★★ | Skript |
| Identität (`identity.ts`) | Datei v4: `enrollments[].roster` (Schnappschuss ≤ 64, MAC gedeckt), `acknowledged` je Gerät | ★★ | kleine Main-Änderung |
| Sync-Host/IPC (`lab-host.ts`, `lab-ipc.ts`, `shared/sync-lab.ts`) | Aktionen `invite`, `signInWithInvite`, `rotateKey`, `acknowledgeDevice`; Roster-Vergleich; `rotationAdvised` nach Widerruf; Einladungscode wie Passwort-Digest nur im Main gehalten | ★★★ | Main |
| Dialog (`SyncLabDialog.tsx`, `sync-lab-view.ts`, Locale) | Schritt 2 mit Umschalter „Anmeldecode / Serverpasswort“; „Gerät einladen“ mit Code-Anzeige (bestehende `RecoveryCodeNotice`-Form, eigene Texte); „Sync-Schlüssel erneuern“ statt „Neuen Wiederherstellungscode erzeugen“; Hinweis „Neues Gerät im Konto“ mit Bestätigen | ★★★ | Renderer |
| Server-Netz (`server.mjs`, `main.mjs`, Compose, Caddyfile) | `SHELLHERD_SERVER_SOCKET`: Unix-Socket statt TCP, XFF dann immer vom Proxy | ★★ | Server-Skript, Extra |
| Paket (`electron.vite.config.ts`, `index.ts`, `smoke-linux.mjs`, `package.json`) | `__SHELLHERD_LABS__` über `SHELLHERD_RELEASE=1` in `dist*`; Lab-Register nur per dynamischem Import unter der Konstante | ★★ | klein, Extra |
| CI (`ci.yml`, `sync-scene.mjs`) | Sync-Szene im Linux-Job nach dem Build | ★ | Extra |
| Doku | Threat-Model „Stand H4“, Protokollplan, Handbuch/Manual, Server-README (Anmeldecode, Schalter, Rotation, Leck-Ablauf mit Schritt 6), SKILL.md | ★★ | Doku |
| TOTP, Per-Gerät-Keybox, V5/V6/V8, A11, Fuses-Rest | **nicht jetzt** | – | – |

---

## 4. Protokoll- und Datenformat-Skizzen

### 4.1 Schlüsselepochen

**Formate (alle wörtlich):**

- Hülle v2 (Server sieht genau das): `{ "format": "shellherd-sync-object", "version": 2, "kind": "version" | "keybox", "epoch": <int ≥ 1>, "cipher": {...}, "payload": "<b64>" }`. Kanonisch, exakt diese Schlüssel in dieser Reihenfolge. ID weiter `sha256(wire)`. `validateSyncObject` (Server) und `parseSyncEnvelope` (Client) prüfen `version === 2` und `Number.isSafeInteger(epoch) && epoch >= 1 && epoch <= 1_000_000`; Hülle v1 gilt nur noch als „Altformat“ (`isLegacyVaultObject` erweitert), auf der Platte lesbar, `PUT` → 400.
- AAD: `stable(['shellherd-sync-object', 2, kind, epoch, serverId, namespace])`.
- Versionsschlüssel: `HKDF-SHA256(K_sync_e, salt = utf8(JSON([serverId, namespace, e])), info = 'shellherd-sync-version-v3', 32)`.
- Keybox v2 (Klartext): `{ kind: 'shellherd-sync-keybox-v2', method: 'recovery' | 'invite', epoch, syncKey: <b64 32>, createdBy: <hex64|null> }`. Wrap `recovery`: `HKDF(code16, salt wie oben mit Epoche, 'shellherd-sync-keybox-recovery-v2')`; Wrap `invite`: siehe 4.2. **Ein Code öffnet genau eine Epoche**; die Epoche steht in der Hülle, der Client probiert den Code also nur gegen Keyboxen dieser Epoche (höchstens 8, sortiert).
- Autorenstempel: `['shellherd-sync-author-v2', serverId, namespace, epoch, parents, compacts ?? [], digest, device, at]`.
- Checkpoint v3 (innen): `{ kind: 'shellherd-sync-state-v3', epoch, syncKey, keybox?, versions, acked, localHeads, working, projection, pending? }`. Ein v2-Checkpoint ohne `epoch` → `migrate` (bestehender Text `syncMigrate` passt wörtlich). Bootstrap legt Epoche 1 an.

**Rotation `rotateSyncKey(sessions, remote, context, signal)`** (ersetzt `regenerateRecoveryCode`, `vault-sync.ts:467-503`; `lab-ipc.ts:45` ruft sie):

1. Vorbedingung aus dem Checkpoint: genau ein Kopf, `localHeads == heads`, `samePortable(local.portable, state.projection)` (keine ungesyncten Änderungen), kein `pending`. Sonst `SyncFailure('rotateBlocked')`. Zusätzlich dieselbe Fremdschlüssel-Probe wie heute (`:477-484`, ergibt `foreignKey`).
2. `K' = randomBytes(32)`, `code' = generateRecoveryCode()`, `e' = e + 1`. Neue Wurzel `V'` = Inhalt des Kopfs, `parents: []`, Autorenstempel mit `e'`, versiegelt unter `K'`. Keybox `recovery` für `e'`.
3. Checkpoint **zuerst**: `{ epoch: e', syncKey: K', keybox: id(keybox'), versions: [V'], acked: [], localHeads: [id(V')], working: head.portable, projection: unverändert }` (Pending-Marker wie beim Bootstrap, `:235-237`).
4. `PUT keybox'`, `PUT V'`, dann Listing: taucht eine fremde Hülle mit `epoch ≥ e'` auf, die nicht eigene ist → Rennen zweier Rotationen → eigene Objekte zurücknehmen, Checkpoint auf den alten Stand setzen (dafür den alten Zustand im Speicher halten) → `SyncFailure('rotateRaced')` → Text verlangt neuen Abgleich. (Selten, zwei Geräte rotieren gleichzeitig; sauber behandelt statt zwei Wurzeln.)
5. `acked = [id(V')]`, danach **Alt-Epochen-Aufräumen**: jedes Objekt im Listing mit `epoch < e'` per `remove`, Housekeeping-Semantik wie `removeAll` (`:331-337`: leise abbrechen, der nächste Lauf repariert). Budget `deviceWrites` 60/min reicht für kompaktierte Konten (≤ ~20 Objekte); größere Reste räumt der nächste Lauf.
6. `settle` löscht den Marker und liefert `{ recoveryCode: code' }`. Geht der Host dazwischen `stale`, zeigt der nächste Lauf über den bestehenden Wiederholungspfad (`:243-256`) einen frischen Code: **E13 erledigt**.

**Aufräumen in jedem Lauf (`synchronizeVault`):** Objekte mit `epoch < state.epoch` werden vor `pull` aus `listing` genommen und best effort gelöscht (nicht `foreign`, nicht `history`). Objekte mit `epoch > state.epoch` (Version **oder** Keybox) → vor allem anderen `SyncFailure('rotated')`; es wird nichts hochgeladen, der lokale Vault bleibt. Fälscht ein Server eine höhere Epoche, blockiert er nur (Verfügbarkeit, konnte er schon durch Löschen); der Code öffnet nichts → `recoveryCode`.

**Epochenübernahme auf Gerät B** (`synchronize` mit `recoveryCode` bei vorhandenem Checkpoint niedrigerer Epoche; heute wird der Code bei vorhandenem Checkpoint ignoriert, `:228`): Code öffnet eine Keybox der höheren Epoche `e'` → `K'`. Neuer Graph aus den `e'`-Objekten; Wurzel-Kopf `V'` muss genau einen Kopf ergeben, sonst `conflict`. Zustand: `epoch: e'`, `syncKey: K'`, `versions`/`acked` aus `e'`, `localHeads: [head']`, `working: head'.portable`, **`projection` bleibt** (letzter lokaler Dateistand). Dann läuft der normale Pfad weiter: `!samePortable(local.portable, state.projection)` (`:282`) erkennt B's lokale Änderungen seit dem letzten Abgleich und merged sie als Kind von `head'` (`mergePortableVaults(projection, local, working)`), echte Widersprüche werden ein normaler Konflikt mit Basis. Ohne lokale Änderungen wird `head'` materialisiert. **Kein Zwei-Wurzeln-Problem.** Beim Import eines frischen Geräts (`importSyncedVault`) bestimmt die geöffnete Keybox die Epoche; liegen Objekte höherer Epoche vor → `rotated` (Text: Code veraltet).

**Widerruf → Rotation:** `devices(revokeDevice)` (`lab-host.ts:223-230`) setzt nach erfolgreichem Widerruf eines **persistenten** Geräts `c.rotationAdvised = true` (im Zustand sichtbar bis zur nächsten Rotation oder Trennung). Der Dialog zeigt den Hinweis mit Knopf „Sync-Schlüssel erneuern“. Keine automatische Rotation (sie braucht einen sauberen Abgleich; der Nutzer kann erst mehrere Geräte entfernen).

**Was die Rotation nicht kann (dokumentieren):** Alte Serverkopien plus alter Code lesen weiter die **alten** Daten (unvermeidbar). Ein nicht widerrufenes, aber heimlich kompromittiertes Gerät liest weiter. Der Server lernt die Epochenzahl (Metadatum, hingenommen).

### 4.2 Anmeldecodes

**Ableitungen (Client, `vault-sync-crypto.ts`, Parität in `device-proof.mjs` für Skripte/Tests):**

- `code` = 16 Zufallsbytes, Anzeige wie der Wiederherstellungscode (32 Hex in Vierergruppen; `src/shared/recovery-code.ts` wird wiederverwendet, Kommentar verallgemeinert).
- `enrollSecret = hex(HKDF(code16, salt = utf8(JSON([serverId, namespace])), info = 'shellherd-invite-enroll-v1', 32))` → geht an den Server.
- `inviteWrap = HKDF(code16, salt = utf8(JSON([serverId, namespace, epoch])), info = 'shellherd-sync-keybox-invite-v1', 32)` → verschlüsselt die Einladungs-Keybox (`method: 'invite'`, Epoche aktuell).

**Server:**

- `/v1/info` zusätzlich `invites: true`, `objectEpochs: true`, `enrollment: 'password' | 'invite-only'`. Clients verlangen die beiden Booleans (sonst `unavailable`).
- `POST /v1/invites`: Token **und** Header `x-shellherd-device`, `x-shellherd-nonce`, `x-shellherd-signature` über `requestProofV3(serverId, namespace, origin, 'POST', '/v1/invites', nonce, device, sha256(body))`; Body exakt `{ secret: <hex64>, object: <hex64 | null> }` (≤ 4 KiB). Der Server speichert **nur im RAM** `{ digest: sha256(secret), issuer, object, createdAt, expiresAt = now + 600_000 }`. Grenzen: ≤ 4 offene je Aussteller, ≤ 16 gesamt (429), Budget `invite:<device>` 10/min. Antwort `201 { expiresAt }`. Verfällt eine Einladung ungenutzt und `object` ist gesetzt, löscht der Server dieses Objekt (gleicher Pfad wie `DELETE …/objects/:id`, `server.mjs:277-289`, als Funktion herausgezogen); der Server kennt den Inhalt nicht, nur die ID, die der Aussteller nannte. `object` muss zum Zeitpunkt des `POST` im Listing stehen (sonst 400).
- `POST /v1/devices` nimmt zwei Body-Formen: `enrollment,password,username[,ephemeral]` (wie heute) **oder** `enrollment,invite[,ephemeral]` mit `invite: <hex64>` (= `enrollSecret`). Einladungspfad: Strukturprüfung → `sessionGate(source)` → Vergleich `sha256(invite)` gegen alle offenen Einladungen mit `timingSafeEqual` über die ganze Menge (konstante Zeit, ≤ 16) → Treffer wird **immer** verbraucht (auch wenn danach `roster.enroll` 409/429 liefert) → `roster.enroll({ document, ephemeral, origin, enrolledBy: issuer })` → 201 mit `device` wie heute. Fehlschlag → `failSession(source)` + 401 (nicht die Passwort-Sperre, K27-Logik). Ist `enrollment === 'invite-only'` und der Body trägt ein Passwort → 403 (vor scrypt, zählt nirgends). Beim ersten erfolgreichen Einschreiben wird `initial-password.txt` wie heute gelöscht.
- Roster v3 (`devices.json`): Einträge zusätzlich `enrolledBy: <hex64 | null>` (null = Passwort). **Additive Migration:** eine v2-Datei wird gelesen, jedem Eintrag `enrolledBy: null` gegeben und beim nächsten Schreiben als v3 abgelegt (anders als E5, weil kein Nachweisformat wechselt; `list-devices`/`revoke-device` ebenso). `GET /v1/devices` liefert `enrolledBy` mit; der Client prüft es (`hex64 | null`).
- `server.json` bekommt optional `enrollment: 'password' | 'invite-only'` (`readConfig` Schlüsselmenge erweitern, `main.mjs:24-25`). Offline-Befehle `main.mjs lock-enrollment` / `unlock-enrollment` (gleicher atomarer Schreibpfad wie `replaceAccount`). `init` setzt nichts (Bootstrap braucht das Passwort); README empfiehlt `lock-enrollment` direkt nach dem ersten Gerät und nimmt es in „Nach einem Passwortleck“ auf. `rotate-password` ändert den Schalter nicht.

**Client-Ablauf Gerät A (eingeladen wird):** Dialog „Gerät einladen“ → Host `invite`: Sync-Kern `createInvite(sessions, remote, context, signal)` liest Checkpoint (Schlüssel, Epoche), erzeugt `code`, versiegelt die Einladungs-Keybox, `PUT`, liefert `{ code, enrollSecret, keyboxId }`; dann `account.invite(identity, { secret: enrollSecret, object: keyboxId })`; scheitert das, wird die Keybox zurückgenommen. Der Code steht nur in der einen Antwort (K13-Regel), Anzeige mit „Ich habe den Code übertragen“. A's Geräteliste zeigt das neue Gerät beim nächsten Laden mit „eingeladen von diesem Gerät“. Vorbedingung: Sync-Schlüssel im Checkpoint (sonst `syncKey`-Fehler mit bestehendem Text).

**Client-Ablauf Gerät B (neu):** Schritt 2 „Dieses Gerät anmelden“ mit Umschalter. Mit Anmeldecode: Felder Code + Gerätename → Host `signInWithInvite`: `enrollSecret` ableiten → `account.enrollWithInvite` → `openSession` → `rememberEnrollment` → Code als `inviteCode` im Main halten (wie `passwordDigest`, `#wipe` löscht; nie im Zustand). Schritt 3: bei geschlossenem Vault „Vault vom Server laden“ nur mit neuem lokalen Passwort (kein Codefeld, Host reicht den gehaltenen Code durch); bei offenem Vault „Jetzt synchronisieren“ mit gehaltenem Code (Epochenübernahme 4.1). Der Sync-Kern öffnet mit `inviteWrap` die Einladungs-Keybox (`method: 'invite'`, Epoche aus der Hülle) und löscht sie nach Erfolg best effort. Danach wird der Code gewischt; ein späterer Sync läuft ohne Code. Die M3-Prüfung („Serverpasswort ≠ Vault-Passwort“) entfällt auf diesem Pfad, weil kein Passwort gesendet wird (`samePasswordImport` nur bei Passwort-Einschreibung, E6 bleibt).

**Rendezvous/Remote-Lab:** nichts. Ein per Anmeldecode eingeschriebenes Gerät ist im Roster und in der Identitätsdatei bekannt, das Remote-Lab zeigt wie heute „Sitzung öffnen“.

### 4.3 Nachweis v4 mit Body-Digest

`DEVICE_REQUEST = 'shellherd-device-request-v4'`, `requestProofV3(serverId, namespace, origin, method, path, nonce, device, bodySha256Hex)`. `DELETE /v1/devices/:id` signiert `sha256('')`, `POST /v1/invites` den exakten Body. Server rechnet den Digest über die gelesenen Bytes. `requestProofV2` entfällt (Lab-Bruch). Nur so ist ein signierter Request mit Inhalt an genau diesen Inhalt gebunden; heute wäre es nicht nötig (DELETE ohne Body), für die Einladung ist es Pflicht.

### 4.4 Roster-TOFU

- Identitätsdatei v4: `enrollments[]` zusätzlich `roster: { id, signingKey, revokedAt: number|null, enrolledBy: string|null, acknowledged: boolean }[]` (≤ 64) und `rosterAt: number`. MAC-Domäne `shellherd-remote-identity-v4`, Tupel der Geräte in den MAC. Migration v3 → v4 in einem Schreibvorgang (`roster: []`), fail-closed wie bisher. Temporäre Identität: nur RAM.
- `#roster(c, strict)` (`lab-host.ts:107-114`) vergleicht nach dem Laden mit dem Schnappschuss der Einschreibung:
  - bekannte `id`, anderer `signingKey` → `throw failure('roster')` (neuer Code `syncRoster`), Sitzung bleibt, kein Abgleich;
  - gespeichert `revokedAt: number`, Server `null` → Gerät gilt lokal weiter als widerrufen (`revokedAt` für `#deviceOf` = gespeicherter Wert), Zustand `revived: [{ id, name }]` als Hinweis;
  - neue `id`, nicht `acknowledged` und `enrolledBy !== identity.id` → Zustand `newDevices: [{ id, name, enrolledBy: name|null }]`; eigene Einladungen gelten als bestätigt;
  - erster Lauf ohne Schnappschuss → still übernehmen (TOFU), alles `acknowledged`.
  - Schnappschuss nach jedem Vergleich fortschreiben (neue Einträge mit `acknowledged: false`, verschwundene Einträge entfernen; Verschwinden ist kein Alarm).
- Aktion `acknowledgeDevice { id }` setzt `acknowledged: true`. Der Hinweis blockiert den Abgleich nicht (Verfügbarkeit), bleibt aber bis zur Bestätigung sichtbar.

### 4.5 Unix-Socket (Extra)

`SHELLHERD_SERVER_SOCKET=/run/shellherd/server.sock` schließt `SHELLHERD_SERVER_PORT/HOST/TRUSTED_PROXY` aus (Startfehler mit Hinweis). `listen(path)` statt `listen(port, host)` (`server.mjs:331-338`), Socket-Modus 0660, Verzeichnis per Compose-Volume mit Caddy geteilt, Caddyfile `reverse_proxy unix//run/shellherd/server.sock`. Hinter dem Socket ist jede Verbindung der Proxy: XFF zählt immer, das Verbindungslimit je Quelle entfällt (wie bei `trustedProxy`). Kein TCP-Port mehr auf dem Homeserver, kein lokaler Prozess kann XFF setzen. Die Listen-Origin für Tests bleibt TCP.

### 4.6 Build-Konstante (Extra)

`electron.vite.config.ts` `main.define = { __SHELLHERD_LABS__: JSON.stringify(process.env.SHELLHERD_RELEASE !== '1') }`; `package.json` `dist`, `dist:linux`, `dist:win` setzen `SHELLHERD_RELEASE=1` (per `cross-env` oder `node -e`-Wrapper; Windows-Shell beachten). `index.ts:264-270`: `const labs = __SHELLHERD_LABS__ ? await import('./labs') : undefined` mit einem kleinen Modul `src/main/labs.ts`, das `registerSyncLabIpc`/`registerRemoteLabIpc`/`RemoteIdentityStore` bündelt; ohne Labs werden die Permission-Handler mit `remoteLabEnabled: false` registriert und die Flags `--shellherd-*-lab=0`. `smoke-linux.mjs` prüft zusätzlich, dass `out/main/index.js` im Release-Build weder `SHELLHERD_SYNC_LAB` noch `SyncLabHost` enthält. Der run-app-Treiber startet `out/` aus `npm run build` ohne die Variable und bleibt unberührt.

---

## 5. Migration und Kompatibilität (Lab-only, Bruch erlaubt)

| Bestand | Verhalten nach H4 |
| --- | --- |
| Clients H3.1 gegen Server H4 | `PUT` Hülle v1 → 400 → `connection`; Probe ohne `invites`/`objectEpochs` nur bei altem Server relevant. Doku: gemeinsam aktualisieren |
| Clients H4 gegen Server H3.1 | `invites`/`objectEpochs` fehlen → `unavailable`. Kein Downgrade |
| Objekte Hülle v1 auf der Platte | Server startet, `GET` liefert, `PUT` → 400; Clients zählen sie als Altformat (`skipped`), „Fremde Objekte entfernen“ löscht sie ohne Opt-in (wie `terminus-encrypted-vault`) |
| `.sync-state` v2 ohne `epoch` | `syncMigrate` (Text passt wörtlich: löschen, erstes Gerät neu abgleichen → Epoche 1 und neuer Code, weitere Geräte neu laden). Reihenfolge wie K17 |
| `devices.json` v2 | Additive Migration auf v3 beim nächsten Schreiben; **keine** Neueinschreibung |
| `remote-identity.json` v3 | Automatisch v4 (`roster: []`); Pins und Einschreibungen bleiben |
| `server.json` ohne `enrollment` | gilt als `'password'`; Warnung beim Start „Einschreibung mit Passwort offen, `lock-enrollment` empfohlen“, sobald mindestens ein persistentes Gerät eingeschrieben ist |
| Nachweis `shellherd-device-request-v3` | entfällt; alte Clients bekommen 401 beim Widerruf |
| `regenerateCode`-Aktion, Texte `recoveryCodeRegenerate*` | entfallen, ersetzt durch `rotateKey` und `rotateKey*`-Texte |
| run-app `sync-scene.mjs` | neuer Ablauf: A einschreiben (Passwort) → synchronisieren → Code notiert → A lädt ein → B mit Anmeldecode einschreiben → B lädt mit neuem Passwort → A entfernt B → A erneuert Schlüssel → B meldet `syncRotated` |
| `server/smoke.mjs`, `check-server-container.mjs` | Einladung, Einschreibung per Einladung, `lock-enrollment` → Passwort 403 |

---

## 6. Regeln und Risiken: was ausdrücklich nicht getan wird

- **Keine Schlüsselverteilung über X25519 (ECIES/HPKE-Eigenbau), kein libsodium im Main, kein TOTP, kein OPAQUE.** Neue Epochen erreichen bestehende Geräte nur über das Eintippen des neuen Wiederherstellungscodes; neue Geräte über den Anmeldecode.
- **Keine automatische Rotation beim Widerruf.** Sie ist ein eigener Klick mit Hinweis, weil sie einen konfliktfreien, vollständig abgeglichenen Stand voraussetzt.
- **Keine serverseitige Kenntnis von Codes.** Der Server sieht nur `enrollSecret` (HKDF-Ableitung) und Hash davon; Keyboxen bleiben für ihn Chiffrat.
- **Kein Kurzcode, kein QR, kein Kopieren-Knopf** (E3 gilt weiter).
- **Keine Änderung der Einschreibedokumente, der Sitzungsnachweise und der Geräte-IDs.** Geräte bleiben eingeschrieben.
- **Keine Quarantäne-Verschärfung.** Die Epoche löst das Problem widerrufener Geräte an der Wurzel (sie haben den neuen Schlüssel nicht); die bestehende Quarantäne bleibt für die Übergangszeit zwischen Widerruf und Rotation.
- **Kein Zwang zu `invite-only`.** Der Schalter ist Betreiberentscheidung (Offline-Befehl), die Doku empfiehlt ihn.
- Risiko Rotation bei ungesyncten Geräten: lokale Änderungen bleiben in der Datei und werden nach Codeeingabe als Kind der neuen Wurzel gemerged; echte Widersprüche werden ein normaler Konflikt. Text sagt es vor dem Erneuern.
- Risiko Anmeldecode über die Schulter: 10 Minuten, einmal verwendbar, sichtbar im Roster (`enrolledBy`), Keybox nach Gebrauch oder Verfall weg. Wer Code **und** Serverkopie in diesem Fenster hat, kennt den aktuellen Schlüssel (wie beim Wiederherstellungscode); Ausweg ist die Rotation.
- Risiko Rennen zweier Rotationen: erkannt über das Listing nach dem Upload, Verlierer nimmt zurück (`rotateRaced`). Zwei Geräte, die gleichzeitig offline rotieren und später beide hochladen, ergeben zwei Epochen `e+1` mit verschiedenen Schlüsseln; der zweite sieht beim Listing fremde `e+1`-Objekte → Rücknahme. Dauerhaft unlösbar nur, wenn beide zwischen Upload und Listing abbrechen; dann hilft „Fremde Objekte entfernen“ mit Opt-in (bestehender Text).
- Risiko Server fälscht höhere Epoche: blockiert den Abgleich (Verfügbarkeit, konnte er schon). Kein Datenverlust, kein Downgrade (niedrigere Epochen werden ignoriert und gelöscht).
- Risiko `deviceWrites` 60/min beim Aufräumen großer Konten: Housekeeping-Semantik, nächster Lauf repariert; kein Fehler für den Nutzer.
- Risiko Roster-TOFU-Fehlalarm: Nach einem Serverreset mit neuem Roster (`devices.json` weggeschoben) meldet der Client alle Geräte als neu, mit `syncRoster` nur bei gleichem Gerät mit anderem Schlüssel. Der Ausweg (Einschreibung vergessen, neu einschreiben) steht im Text.
- Bewegung/Design: keine neue Bewegung, nur bestehende Klassen (`.sync-result`, `.sync-lab-code`, `.sync-lab-confirm`, `.sync-lab-notice`, `.settings-hint`, `.secondary-button`, `.primary-button`); ein Umschalter nutzt zwei `secondary-button`s mit `aria-pressed`. Tokens unverändert.

---

## 7. Testideen

**Sync-Kern (`vault-sync.test.ts`, `vault-sync-crypto.test.ts`):**
- HKDF-Vektoren fest für Version v3, Keybox recovery v2, Keybox invite v1, `enrollSecret`.
- Rotation: Nach `rotateSyncKey` liegen genau eine Keybox und eine Wurzel mit `epoch 2` auf dem Fake-Server, alle `epoch 1`-Objekte sind gelöscht, der alte Code öffnet nichts, der neue Code öffnet `K'`; Checkpoint `epoch 2`, `acked = [V']`; `recoveryCode` in der Antwort, `keybox`-Marker weg. Abbruch nach dem Keybox-`PUT` → nächster Lauf zeigt neuen Code (Wiederholungspfad). Vorbedingungen: zwei Köpfe → `rotateBlocked`; lokale Änderung → `rotateBlocked`; fremde Version → `foreignKey`. Rennen: Fake-Remote schiebt eine fremde `epoch 2`-Keybox zwischen `PUT` und Listing → `rotateRaced`, eigene Objekte und Checkpoint zurück auf Epoche 1.
- Übernahme: Gerät B (Epoche 1, lokale Änderung an Verbindung X) sieht `epoch 2` → `rotated`, nichts hochgeladen; mit neuem Code → `synced`, Kopf ist Kind von `V'` und enthält X; ohne lokale Änderung → Vault = `V'`-Inhalt; Änderung an derselben Eigenschaft wie in `V'` → `conflict` mit Basis. Import frisches Gerät mit altem Code bei vorhandener `epoch 2` → `rotated`.
- Aufräumen: `epoch 0`-Objekt im Listing wird gelöscht, nicht als `foreign` gezählt, kein `history`, obwohl in `acked`-fremd.
- Server-Fälschung: Hülle `epoch 99` ohne passende Keybox → `rotated`, Code → `recoveryCode`, nichts geändert.
- Einladung: `createInvite` liefert Code, `enrollSecret` passt zum Server-Digest, Keybox `method: 'invite'` mit aktueller Epoche; `importSyncedVault` mit `inviteCode` öffnet sie, löscht sie danach; falscher Code → `recoveryCode`.
- AAD: Objekt gleicher Epoche mit vertauschtem `epoch`-Feld → unlesbar; Autorenstempel ohne Epoche → `suspect`.
- Hüllen-Parität (K15) um `epoch`-Fälle erweitert (fehlend, 0, 1.5, zu groß, Schlüsselreihenfolge).

**Server (`account.test.mjs`, `server.test.mjs`, `device-roster.test.mjs`, neu `invites.test.mjs`):**
- `POST /v1/invites` ohne Signatur → 401; mit Signatur über anderen Body → 401; fünfte offene Einladung desselben Geräts → 429; 17. gesamt → 429; `object` nicht im Listing → 400.
- Einschreibung mit Einladung → 201, `enrolledBy = issuer`, Einladung verbraucht (zweiter Versuch 401); falsches Secret → 401 + `failSession`, Passwort-Sperre unberührt; Einladung mit 409 (fremde Schlüssel für bekannte ID) → trotzdem verbraucht; Verfall nach 10 min → 401 und `object` gelöscht; Neustart → Einladungen weg.
- `invite-only`: Passwort-Einschreibung → 403 **vor** scrypt (Zeitmessung oder Zähler), Einladung weiter 201; `lock-enrollment`/`unlock-enrollment` offline schreiben `server.json` atomar; `init` setzt den Schalter nicht.
- Roster v2 → v3 additive Migration: Datei nach dem ersten Schreiben v3 mit `enrolledBy: null`; `list-devices` zeigt die Spalte.
- Nachweis v4: `DELETE` mit v3-Nachweis → 401; Body-Digest über leeren Body.
- Hülle v2 Pflicht bei `PUT` (v1 → 400), v1 auf Platte → Start ok, `GET` liefert.
- Unix-Socket (Extra): Start mit `SHELLHERD_SERVER_SOCKET` plus `PORT` → Startfehler mit Hinweis; XFF vom Socket zählt; Socket-Modus 0660.

**Transport (`account-transport.test.mjs`):** `invite` setzt drei Header + Token, signiert Body-Digest; `enrollWithInvite` sendet exakt `enrollment,invite[,ephemeral]`; `devices()` verlangt `enrolledBy`; Probe lehnt `invites: false` ab.

**Identität (`identity.test.ts`):** v3 → v4 ein Schreibvorgang, MAC deckt `roster`; manipulierter `roster` → `identity`; Schnappschuss ≤ 64; temporär nur RAM.

**Sync-Host (`lab-host.test.ts`):** `invite` → Code nur in der Antwort, nie in `status`; `signInWithInvite` → `enrollWithInvite`, `openSession`, `rememberEnrollment`, Code gehalten, nach erfolgreichem Import gewischt; `importVault` ohne Codefeld bei gehaltenem Code; Roster-TOFU: neues Gerät mit `enrolledBy = self` → kein Hinweis, mit `null` → `newDevices`; bekannte ID mit anderem Schlüssel → `syncRoster`, kein Abgleich; Server setzt `revokedAt` auf `null` → `#deviceOf.revokedAt` liefert den gespeicherten Wert, Zustand `revived`; `acknowledgeDevice` räumt den Hinweis; `revokeDevice` persistentes Gerät → `rotationAdvised: true`, temporäres → nicht; `rotateKey` ohne `confirmed: true` → `invalid`; Fehlercodes `syncRotated`, `syncRotateBlocked`, `syncRotateRaced`, `syncRoster`, `invite`, `enrollmentLocked` gemappt.

**Renderer (`SyncLabDialog.test.tsx`, `sync-lab-view.test.ts`):** Umschalter wechselt die Felder; Anmeldecode-Feld `maxLength 64`, Absenden nur bei 32 Hex; Code aus `invite` nach „übertragen“ nicht mehr im DOM; „Sync-Schlüssel erneuern“ nur mit Bestätigung; Hinweis „Neues Gerät“ mit Knopf; Design-Token-Test grün.

**Szene (`sync-scene.mjs`):** Ablauf aus Abschnitt 5, Screenshots `sync-invite`, `sync-rotate`, `sync-new-device`; `/console` ohne Codes.

---

## 8. Zerlegung in Tasks und Wellen (dateidisjunkt)

Jede Task besitzt nur ihre Dateien, Tests daneben gehören dazu, kein Commit durch Umsetzer. Nach jeder Welle `npm run typecheck` und `npx vitest run` grün; Welle 1 ist wie bei H3 erst mit T1+T2 zusammen grün (`account.test.mjs` nutzt `AccountStore`).

### Welle 1 (parallel)

| Task | Dateien | Pflichtpunkte |
| --- | --- | --- |
| **T1 Server, Nachweise, Roster, Hülle** | `scripts/sync-prototype/{server.mjs, device-roster.mjs, device-proof.mjs, account-auth.mjs, sync-object-wire.mjs, rate-limit.mjs}` (+ Tests, neu `invites.test.mjs`), `server/{main.mjs, smoke.mjs, README.md}` (nur Server-Abschnitte), `scripts/check-server-container.mjs`; **Extra:** Unix-Socket in `server.mjs`/`main.mjs`, `server/compose.yaml`, `server/Caddyfile.example` | 4.1 Hülle v2 (Validator), 4.2 Server, 4.3, Schalter + Offline-Befehle, 4.5 (Extra) |
| **T2 Client-Transport** | `scripts/sync-prototype/{account-transport.mjs, http-common.mjs}` (+ Tests) | 4.2 `invite`/`enrollWithInvite`, `devices()` mit `enrolledBy`, Probe-Felder, Nachweis v4 |
| **T3 Sync-Kern** | `src/main/sync-prototype/{vault-sync.ts, vault-sync-crypto.ts, vault-sync-state.ts}` (+ Tests), `src/shared/recovery-code.ts` (nur Kommentar/Export-Namen), `scripts/sync-prototype/password-sync.test.mjs` | 4.1 vollständig (Epochen, `rotateSyncKey`, Übernahme, Aufräumen), 4.2 `createInvite`, Keybox v2, Import/Sync mit `inviteCode`, Checkpoint v3; `regenerateRecoveryCode` entfällt. Neue `SyncFailure`-Codes als Literale: `rotated`, `rotateBlocked`, `rotateRaced` |
| **T4 Identität** | `src/main/remote/identity.ts` (+ Test) | 4.4 Datei v4 mit Roster-Schnappschuss, API `rosterOf(serverId, url)`, `rememberRoster(...)`, `acknowledgeDevice(...)` |
| **T5 Paket (Extra)** | `electron.vite.config.ts`, `src/main/labs.ts` (neu), `src/main/index.ts` (nur `:264-270` und Flag-Argumente `:138-140`), `scripts/smoke-linux.mjs`, `package.json` (nur `dist*`-Skripte) | 4.6 |

### Welle 2 (parallel, braucht Welle 1)

| Task | Dateien | Pflichtpunkte |
| --- | --- | --- |
| **T6 Sync-App-Fläche** | `src/main/sync-prototype/{lab-host.ts, lab-ipc.ts}` (+ Tests), `src/shared/sync-lab.ts`, `src/renderer/src/components/SyncLabDialog.tsx` (+ Test), `src/renderer/src/sync-lab-view.ts` (+ Test), `src/renderer/src/sync-lab.css` (nur falls nötig, Tokens), **alle** `src/shared/locales/**` | Aktionen `invite`, `signInWithInvite`, `rotateKey { confirmed: true }`, `acknowledgeDevice`; `regenerateCode` weg; Roster-TOFU-Vergleich; `rotationAdvised`; Code-Handling im Main; Texte Abschnitt 10 |
| **T7 Remote-App-Fläche** | `src/main/remote/lab-host.ts` (nur Probe-Felder `invites`/`objectEpochs` in `#connect`, falls die Probe sie verlangt), `src/main/remote/lab-host.test.ts` (Fakes) | Minimal; sonst keine Änderung |

### Welle 3

| Task | Dateien | Pflichtpunkte |
| --- | --- | --- |
| **T8 Doku + Szenen** | `docs/plans/selfhosted-threat-model.md` (Stand H4: C2 behoben, T04 für neue Daten erfüllt, `:145` erfüllt mit Grenze, S4 bei `invite-only` geschlossen), `docs/plans/selfhosted-protocol.md` (Epochen, Keybox v2, Einladung, Nachweis v4), `docs/handbuch.md`, `docs/manual.md`, `scripts/sync-prototype/README.md`, `server/README.md` (Rest: Setup-Reihenfolge mit `lock-enrollment`, Leck-Ablauf Schritt 6 „Sync-Schlüssel erneuern“), `.claude/skills/run-app/{sync-scene.mjs, SKILL.md}`; **Extra A12:** `.github/workflows/ci.yml` (Sync-Szene im Linux-Job, `xvfb-run`) | Doku = Code; Szene als Gate für T3/T6 |

Abhängigkeiten: T6 liest den T3-Report (Codes, Signaturen von `rotateSyncKey`/`createInvite`), den T4-Report (Identitäts-API) und T2 (`AccountDriver`-Erweiterung). T8 liest alle. T5 ist unabhängig.

Abschluss (Lead): `npm run typecheck`, `npx vitest run`, `node server/smoke.mjs`, `npx electron-vite build`; `sync-scene.mjs` und `remote-scene.mjs` (Skill `run-app`); `node scripts/check-server-container.mjs`, wenn Docker vorhanden; Paket mit `SHELLHERD_RELEASE=1` und `smoke-linux.mjs`. Kein CHANGELOG, keine Version (R-H3-4). Offene PR-Punkte: Fuses-Rest (E1), Windows-Fuse-Prüfung (m2-Rest), H5-Liste.

---

## 9. Minimale erste Stufe gegenüber Extras

**Minimal (ohne das ist H4 nicht erfüllt):** T1 ohne Unix-Socket, T2, T3, T4, T6, T7, T8 ohne CI. Das heißt: Epochen mit Rotation (ersetzt den Codewechsel), Anmeldecode mit Einladungs-Keybox, `invite-only`-Schalter, Roster-TOFU im Sync-Lab, Nachweis v4.

**Extras innerhalb von H4 (abtrennbar, in dieser Reihenfolge):** (1) Build-Konstante T5; (2) Unix-Socket in T1; (3) Sync-Szene in CI (T8). Falls die Einladungs-Keybox den Rahmen sprengt: Anmeldecode nur für die Einschreibung (Server + Transport + Host), Gerät B tippt zusätzlich den Wiederherstellungscode wie heute; die HKDF-Ableitung `enrollSecret` bleibt dieselbe, damit das Format später nicht wechselt.

**Wandert nach H5 („Fernansicht-Isolation und Vereinheitlichung“):** V5 (eigene `WebContentsView` ohne Vault-Preload), V6 (Aufnahmeschutz RDP-Flächen, Windows), V8 (Doppelklick), A11 (`DeviceSessionClient`), Fuses-Rest nach dem Windows-Test, Per-Gerät-Keybox (nur wenn Roster-TOFU sich bewährt hat und die Komposition reviewt ist).

---

## 10. Texte (wörtlich, de-DE / en-US; T6 legt alle an)

Die UI sagt „anmelden“ für die Einschreibung („Gerät anmelden“, „Dieses Gerät anmelden“); der Code heißt deshalb **Anmeldecode**, nicht Einschreibecode.

`syncLab.json` (neu):

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
| `newDevice` | Neues Gerät im Konto: {{name}} ({{how}}). Hast du es nicht selbst angemeldet, entferne es, wechsle das Serverpasswort und erneuere den Sync-Schlüssel. | New device in the account: {{name}} ({{how}}). If you did not enroll it yourself, remove it, change the server password and renew the sync key. |
| `acknowledgeDevice` | Zur Kenntnis genommen | Acknowledged |
| `deviceRevived` | {{name}} war entfernt und ist laut Server wieder aktiv. Dieses Gerät behandelt es weiter als entfernt. | {{name}} was removed and is active again according to the server. This device keeps treating it as removed. |
| `errors.invite` | Der Anmeldecode ist falsch, abgelaufen oder schon verwendet. Erzeuge auf dem angemeldeten Gerät einen neuen. | The enrollment code is wrong, expired or already used. Create a new one on the enrolled device. |
| `errors.enrollmentLocked` | Dieser Server nimmt neue Geräte nur mit Anmeldecode an. Erzeuge ihn auf einem angemeldeten Gerät. | This server accepts new devices only with an enrollment code. Create it on an enrolled device. |
| `errors.syncRotated` | Der Sync-Schlüssel wurde auf einem anderen Gerät erneuert. Gib den neuen Wiederherstellungscode ein. Dein lokaler Vault bleibt unverändert. | The sync key was renewed on another device. Enter the new recovery code. Your local vault stays unchanged. |
| `errors.syncRotateBlocked` | Vor dem Erneuern muss der Abgleich ohne Konflikte und ohne offene lokale Änderungen abgeschlossen sein. Synchronisiere zuerst. | Before renewing, the sync must be complete without conflicts and without pending local changes. Sync first. |
| `errors.syncRotateRaced` | Ein anderes Gerät hat den Sync-Schlüssel gleichzeitig erneuert. Es wurde nichts geändert. Synchronisiere und versuche es erneut. | Another device renewed the sync key at the same time. Nothing was changed. Sync and try again. |
| `errors.syncRoster` | Die Geräteliste des Servers widerspricht der zuletzt gespeicherten: Ein bekanntes Gerät hat einen anderen Schlüssel. Es wurde nichts abgeglichen. Prüfe den Server. | The server’s device list contradicts the one stored last: a known device has another key. Nothing was synced. Check the server. |

`syncLab.json` (geändert): `recoveryCodeNew` ergänzt „Er öffnet nur den aktuellen Sync-Schlüssel; nach „Sync-Schlüssel erneuern“ gilt ein neuer Code.“ / “It opens only the current sync key; after “Renew sync key” a new code applies.” `revokeHint` → „Ein entferntes Gerät verliert sofort den Zugriff auf den Server. Seinen lokalen Vault behält es. Erneuere danach den Sync-Schlüssel, damit es neue Daten nicht mehr lesen kann.“ / “A removed device loses server access immediately. It keeps its local vault. Renew the sync key afterwards so it can no longer read new data.”

`syncLab.json` (entfernt): `recoveryCodeRegenerate`, `recoveryCodeRegenerateHint`, `recoveryCodeRegenerateConfirm`, `recoveryCodeRegenerateYes`.

Keine dynamischen Keys; Fehler-Map in `SyncLabDialog.tsx` bleibt `satisfies Record<SyncLabErrorCode, string>`. `{{how}}` wird aus `deviceEnrolledBy`/`deviceEnrolledByPassword` zusammengesetzt (zwei `t()`-Aufrufe, kein Key-Bau).

Server-Logs bleiben englisch (E11). Startwarnung: `Warning: password enrollment is open although devices are enrolled; run lock-enrollment to accept new devices only with an enrollment code.`

---

## 11. Offene Entscheidungen mit Empfehlung

1. **Ein Code oder zwei für ein neues Gerät?** Ein Code: Anmeldecode trägt über zwei HKDF-Ableitungen Einschreibung und Sync-Schlüssel; der Wiederherstellungscode bleibt Offline-Sicherung. Zwei Codes nur als Rückfall-Extra.
2. **Wer erzeugt den Anmeldecode?** Das einladende Gerät. Der Server sieht nur `enrollSecret` und speichert dessen Hash im RAM.
3. **Gültigkeit und Grenzen der Einladung:** 10 Minuten, genau einmal, ≤ 4 offen je Aussteller, ≤ 16 gesamt, nur RAM, Budget 10/min je Gerät.
4. **`invite-only` automatisch nach dem ersten Gerät?** Nein. Offline-Befehl `lock-enrollment`, Startwarnung solange offen, README empfiehlt es. Bootstrap und Totalverlust aller Geräte brauchen den Passwortweg.
5. **Rotation automatisch beim Widerruf?** Nein. Hinweis `rotationAdvised` mit Knopf; Vorbedingung sauberer Abgleich.
6. **`regenerateRecoveryCode` behalten?** Nein, durch `rotateSyncKey` ersetzt. Ein halber Codewechsel ohne Schlüsselwechsel verwirrt und widerspricht dem Ziel.
7. **Epochenübernahme bestehender Geräte:** nur per neuem Wiederherstellungscode; lokale Änderungen werden als Kind der neuen Wurzel gemerged (Adoptionsregel 4.1). Keine X25519-Verteilung.
8. **Epoche im Klartext der Hülle?** Ja (Server sieht die Zahl). Nur so unterscheidet der Client „alte Epoche, aufräumen“ von „fremder Schlüssel“ und „Server dreht zurück“.
9. **Alt-Epochen-Aufräumen:** Housekeeping durch jedes Gerät der aktuellen Epoche in jedem Lauf; die Rotation selbst löscht best effort.
10. **`devices.json` v3:** additive Migration ohne Neueinschreibung (anders als E5, weil kein Nachweis wechselt).
11. **Nachweis v4 mit Body-Digest:** Ja, für `POST /v1/invites` Pflicht; `DELETE` zieht nach (Lab-Bruch ohnehin).
12. **Roster-TOFU-Semantik:** neues Gerät = Hinweis (außer selbst eingeladen); Schlüsselwechsel = harter Fehler; „vergessener“ Widerruf = Hinweis plus lokal weiter widerrufen. Nur Sync-Lab.
13. **Unix-Socket:** Extra in T1; schließt TCP-Variablen aus; XFF dann immer vom Proxy.
14. **Build-Konstante:** Extra T5; `SHELLHERD_RELEASE=1` nur in `dist*`; Lab-Module nur per dynamischem Import unter der Konstante.
15. **Sync-Szene in CI:** Extra in T8 (Linux-Job, `xvfb-run`), abtrennbar bei Flakes.
16. **TOTP:** nein, endgültig.
17. **V5/V6/V8, A11, Fuses-Rest:** H5 bzw. offener PR-Punkt (Windows-Test).
18. **CHANGELOG/Version:** wie H1–H3.1 nicht im Lab-Branch.
