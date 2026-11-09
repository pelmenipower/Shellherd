# Spec: Sicherheitshärtung H1 (Sync, Storage-/Rendezvous-Server, Fernzugriff)

Status: Design, Meilenstein H1 von drei (H1 Härtung + Gerätebindung, H2 Noise/WireGuard/Tombstones, H3 gerätegebundene Anmeldung). Quelle: internes Security-Review vom 2026-11-09 (Befunde M1–M4, N1–N7, I1–I8; Zusammenfassung in Abschnitt 1 unten). Bindend geht `…-validation.md` vor.

## 0. Umfang und Rulings

Umfang H1 = Abschnitt 4 vollständig, inklusive der Extras aus Abschnitt 9 (T8/N1, `generatePassword`, Mute-Zähler, Caddy-Timeouts). Nicht in H1: Noise, PAKE/SAS, WireGuard-Compose, Tombstones, zufälliger Sync-Schlüssel, Electron-Fuses, Zertifikats-Pinning, TOTP.

- Ruling R-H1: Die acht offenen Entscheidungen aus Abschnitt 10 werden wie empfohlen übernommen (12 Hex, nativer Dialog im Display-Media-Handler, Reload-Notbremse, statisch-ephemerer DH-Besitznachweis, Client-Limits auf 100/32 MiB, Sync-Lab-Sign-in bei gesperrtem Vault ohne M3-Prüfung, Consent-Hook nur ungepackt + Lab, kein TOTP).
- Ruling R-H2: Die Regeln R1–R12 der Spec `2026-11-07-remote-agent-design.md` gelten weiter; R4 wird nur in der Mechanik geändert (Grant ausschließlich aus nativer Zustimmung im Main).
- Ruling R-H3: Keine eigene Kryptografie. Nur Node-`crypto`, `hash-wasm`-Argon2id, Electron-Bordmittel.

Leitentscheidung: **keine eigene Kryptografie**. Alles in H1 ist Node-`crypto` (X25519-DH, HKDF-SHA-256, HMAC-SHA-256, AES-256-GCM, `timingSafeEqual`), `hash-wasm`-Argon2id (bereits im Einsatz) und Electron-Bordmittel (`dialog`, `session`-Handler, `safeStorage`). H2 nutzt `noise-handshake` 4.2.0 (vorhanden, `package.json:63`).

---

## 1. Bestand und Lücken

| Befund | Bestand (`datei:zeile`) | Lücke |
| --- | --- | --- |
| M1 | `scripts/sync-prototype/server.mjs:68,76-77` (600 req/min global), `:181` (32 Verbindungen, 15 s), `account-auth.mjs:24-25` (10 Logins/min global, `active`-Mutex) | Keine Quelle bekannt; hinter Caddy nur eine IP. Caddy ohne Plugin hat **kein** Rate-Limit-Modul. `Caddyfile.example:4` nur `max_size 1MB` |
| M2 | Viewer: `RemoteLabDialog.tsx:115-117` Checkbox → `compared: true`; Host nimmt den Fingerprint ungeprüft aus der Serverliste (`lab-host.ts:233-236`). Agent: `RemoteConsentDialog.tsx:39` zeigt den Fingerprint nur an; `lab-host.ts:271` baut den Kanal mit `s.peerKey` aus der Serverliste. `remote-signal.ts:78` prüft „mindestens eine“ Fingerprint-Zeile | Beide Seiten bestätigen nur per Klick; ein bösartiger Server kann beiden Seiten eigene Schlüssel unterschieben. Pinning (`identity.ts:99-119`) ist unverifiziertes TOFU |
| M3 | Remote `lab-host.ts:171-184`, Sync `sync-prototype/lab-host.ts:44-64`: Passwort geht direkt in `account.login`; `account-transport.mjs:17` sendet es im Body; `account-init.mjs:15` warnt nur. Argon2id-Ableitung existiert: `vault-sync-crypto.ts:55-59` (`keyFromPassword`), Session-Key: `vault/session.ts:88-90` (`keyCopy`) | Keine Gleichheitsprüfung vor dem Senden |
| M4 | `lab-host.ts:293-300` `armCapture` setzt den Grant allein per IPC; `lab-ipc.ts:28-40` Handler nimmt `sources[0]`; `#end` `lab-host.ts:466-480` kann Tracks nicht beenden; `src/main/index.ts` ohne `setPermissionRequestHandler`/`setPermissionCheckHandler`; `src/renderer/index.html` ohne CSP | Renderer entscheidet allein über Capture-Start und -Stopp; Kamera/Mikro-Permission ist Chromium-Default |
| N1 | `vault-sync.ts:36-43` `Graph.add` wirft `wrongVault` bei erstem fremden Objekt; Limits 64 / 12 MiB (`:25,:38`) gegen Server 100 / 32 MiB (`server.mjs:67,167`) | Ein fremdes Objekt im Konto blockiert den Sync dauerhaft |
| N2 | `rendezvous.mjs:52-57` `PUT /devices` nimmt `publicKey` ohne Besitznachweis | Zweiter Kontoinhaber registriert fremde Schlüssel |
| N4 | `account-auth.mjs:10` Mindestlänge 12, `:24-25` 10/min global, `:30` Username-Vergleich mit `===` | Brute-Force 14.400/Tag; Aussperren des Besitzers möglich |
| N5 | `identity.ts:157-160` `knownDevices` im Klartext neben verschlüsseltem Schlüssel | Pins manipulierbar |
| N6 | `server/Dockerfile:1` `FROM node:22-bookworm-slim` | Kein Digest |
| N7 | `rendezvous.mjs:64-69` max. 4 Sitzungen pro Gerät, `lab-host.ts:359-367` zeigt jede neue Anfrage | Nach Ablehnen sofort neue Anfrage |
| I4 | `rendezvous-client.mjs:55` `[from,to].includes(fingerprint)` ohne Rollenbindung | Vertauschte Rollen werden nicht erkannt (folgenlos) |
| I5 | `Caddyfile.example:4` `1MB` = 1 000 000 Byte (Caddy nutzt go-humanize, SI) | Objekte nahe 1 MiB scheitern am Proxy |

Gut und unverändert: Content-Hash-IDs, `O_NOFOLLOW`, atomares Schreiben, Container-Härtung, Richtung+Sequenz in AAD, `accepted` nicht fälschbar, Sandbox/`contextIsolation`/`will-navigate` (`index.ts:130-148`), Lab-Gating (`lab-ipc.ts:43-45`).

---

## 2. Meilensteine

| Meilenstein | Inhalt | Wert | Aufwand |
| --- | --- | --- | --- |
| **H1 Härtung + Gerätebindung** (dieser Branch) | M1–M4, N1, N2, N4–N7, I4, I5; Besitznachweis für Registrierung; getippte Fingerprint-Prüfung + Pinning; native Zustimmung; Permission-Handler; CSP; Notbremse; Caddy/Compose/Digest | ★★★ | Server-Skripte + Main + Renderer, 13 Tasks in 3 Wellen |
| **H2 Protokoll** | Rendezvous-Kanal auf `Noise_XX_25519_ChaChaPoly_BLAKE2b` (Forward Secrecy, N3), Prologue bindet Server-ID/Sitzung/Scope, Pinning der Noise-Statik; WireGuard/Tailscale-Betrieb als Standard (Doku + Compose-Variante); Kompaktierung mit signierten Tombstones | ★★★ | eigener Branch, Lab-only |
| **H3 Gerätegebundene Anmeldung** | Ed25519-Request-Signaturen (`http-proof.mjs`, `server-access.mjs` existieren) für alle API-Aufrufe; Passwort nur noch zur Geräteaufnahme; Verlaufsanker pro Gerät signiert; zufälliger Sync-Schlüssel mit Transfer per Pairing oder Wiederherstellungscode (I1/I2) | ★★★ | eigener Branch, Migration der Kontodatei |

Reihenfolge ist fest: H1 ist ohne Protokollwechsel umsetzbar und schließt die vier Mittel-Befunde. H2 ersetzt dann *einen* klar abgegrenzten Baustein (`rendezvous-client.mjs` Kanal), H3 die Anmeldung.

---

## 3. MFA am Server – ehrliche Bewertung

Was das Serverpasswort heute schützt: Lesen/Schreiben von **Ciphertext** (Offline-Raten I1, Sync-Blockade N1), Rendezvous (Präsenz, Anfragen, Consent-Spam N7, Fremdregistrierung N2). Es schützt **nicht** den Inhalt (E2EE) und **nicht** vor dem Server selbst.

| Angriff | TOTP | Passkey/WebAuthn | Gerätegebundene Schlüssel + Kopplung (H1 N2 → H3) |
| --- | --- | --- | --- |
| Passwort erraten/geleakt (N4) | hilft, aber 6 Ziffern sind selbst ein Brute-Force-Ziel → braucht genau die Rate-Limits aus M1 | hilft | hilft; kein Geheimnis zum Raten |
| Kompromittierter Server | **nichts** – der TOTP-Seed liegt auf dem Server, der Server sieht ohnehin alles | nichts gegen Datenabfluss; Server hat nur Public Keys | Server kennt nur Public Keys; kann kein Gerät „nachspielen“ |
| M3 (Vault-Passwort = Serverpasswort) | **nichts** – das Passwort wird weiterhin gesendet | nur, wenn das Passwort ganz entfällt | Passwort wird nur noch einmal pro Gerät (Aufnahme) gesendet, M3-Prüfung bleibt |
| DoS (M1) | nichts; zusätzlicher Verifikationsaufwand | nichts | nichts |
| E2EE / Inhaltsvertraulichkeit | nichts | nichts | nichts (ist Aufgabe des Vault-Schlüssels) |
| Verlorenes Gerät | Seed ist auf jedem Gerät kopiert → kein echter zweiter Faktor pro Gerät | pro Gerät, aber Electron-Renderer unter `file://` hat keine RP-ID → in dieser App nicht nutzbar | pro Gerät widerrufbar, Schlüssel in `safeStorage` |

**Empfehlung:** Kein TOTP in H1 und H2. Der bessere zweite Faktor ist *Besitz eines gekoppelten Geräts*: H1 führt den Besitznachweis des Geräteschlüssels bei der Registrierung ein (N2), H3 macht ihn zur Anmeldung. Passkeys scheiden für den Electron-Renderer technisch aus (kein Origin mit registrierbarer Domain; kein WebAuthn-Client in Node). Falls nach H3 die Passwort-Anmeldung für die Geräteaufnahme bestehen bleibt und der Nutzer MFA ausdrücklich will: TOTP nach RFC 6238 mit Node-`crypto` HMAC-SHA1 ohne Zusatzbibliothek als `init --totp`/`rotate-password --totp`, Prüfung nur auf dem Aufnahmeweg, Fenster ±1 Schritt, 5 Versuche/10 min pro Quelle. Das ist ein Komfort-Add-on, kein Sicherheitsgewinn gegen die Befunde M1–M4.

---

## 4. H1 im Detail

### 4.1 M3 – Serverpasswort darf nicht das Vault-Passwort sein (Main)

**Entscheidung:** Prüfung im Main **vor** jedem Netzaufruf, nur bei entsperrtem Vault, konstantzeitig gegen den Session-Key. Bei gesperrtem Vault (Sync-Lab-Import auf frischem Gerät) gibt es nichts zu vergleichen; der Remote-Lab verlangt `isUnlocked()` künftig schon beim `signIn` (bisher erst `goOnline`, `lab-host.ts:188`).

- `src/main/vault/session.ts`: neu `async matchesPassword(password: string): Promise<boolean>` – `requireSession()`, Key per `deriveKey` aus `vault/crypto.ts` (die bestehende private Funktion wird exportiert; dieselbe NFKC-Normalisierung wie `unlockVault`), Vergleich `timingSafeEqual(candidate, session.key)`, `candidate.fill(0)` im `finally`. Wirft `AppError('core.vaultLocked')` bei gesperrtem Vault.
- `src/main/remote/lab-host.ts`: `RemoteDeps` erhält `matchesVaultPassword(password: string): Promise<boolean>`. `#signIn`: `if (!deps.isUnlocked()) return { ok:false, code:'locked' }; if (await deps.matchesVaultPassword(password)) return { ok:false, code:'samePassword' }` vor `createAccount`.
- `src/main/sync-prototype/lab-host.ts`: Konstruktor bekommt optional `matchesVaultPassword?: (password) => Promise<boolean | undefined>` (`undefined` = gesperrt, Prüfung entfällt). `signIn`: Prüfung vor `createAccount`; Code `samePassword`.
- Verdrahtung: `src/main/remote/lab-ipc.ts:70-78` und `src/main/sync-prototype/lab-ipc.ts:21-33` reichen `sessions.matchesPassword` durch (Sync: `try/catch` → `undefined` bei `core.vaultLocked`).
- Fehlercodes: `RemoteErrorCode` + `SyncLabReply.code` um `'samePassword'`. Texte (de/en): `remoteLab.errors.samePassword` / `syncLab.errors.samePassword` „Das Serverpasswort darf nicht dein Vault-Passwort sein. Es wurde nichts an den Server gesendet.“
- Argon2id (64 MiB, ≈150 ms) läuft einmal pro Klick; akzeptabel.

Tests: `session.test.ts` (gleich/verschieden/gesperrt, Key danach unverändert), `remote/lab-host.test.ts` und `sync-prototype/lab-host.test.ts`: gleiches Passwort → `samePassword` und `login` **nicht** aufgerufen; gesperrt → Remote `locked`, Sync läuft ohne Prüfung.

### 4.2 M4 – Zustimmung, Capture-Kontrolle, Permission-Handler, CSP, Notbremse

**4.2a Native Zustimmung setzt den Grant.** Der Renderer-Dialog bleibt als Informations- und Eingabefläche (Countdown, „Bekannt seit“, Linux-Hinweis, Fingerprint-Eingabe aus 4.3). Die *Freigabe* entscheidet aber ein nativer `dialog.showMessageBox` im Main, und zwar **innerhalb des Display-Media-Handlers**, damit die Chromium-User-Activation von `getDisplayMedia` bereits verbraucht ist und der Dialog beliebig lange offen sein darf:

1. Renderer-Klick „Bildschirm freigeben“ → `armCapture` (prüft Fingerprint-Eingabe, setzt nur `s.armed = true`, **keinen** Grant mehr) → `getDisplayMedia` wie bisher (`remote-peer.ts:65-79`).
2. `createDisplayMediaHandler(host, confirm)` in `lab-ipc.ts`: Main-Frame-Prüfung wie heute (`:33`), dann `host.captureCandidate(contents.id)` → `{ sessionId, name, fingerprint, verified, signal } | null`. Bei `null` → `callback({})`.
3. `confirm(candidate, parentWindow)` = `dialog.showMessageBox(window, { type:'warning', title, message, detail, buttons:[decline, accept], defaultId:0, cancelId:0, noLink:true, signal })`. Rückgabe `response === 1`.
4. Ja → `host.grantCapture(sessionId)` (Zustand `consent` → `granted`, einmalig) → `desktopCapturer.getSources({types:['screen']})` → `callback({ video: sources[0] })`. Nein/Abbruch → `host.refuseCapture(sessionId)` → `#end(s,'declined')` → `callback({})`.
5. `#accept` verlangt `s.state === 'granted'` statt `s.armed`.

`signal` ist ein `AbortSignal` aus dem Host; Deadline (`consentMs`), Sperre, `reset`, `closeOwner` und Serverseitiges Verschwinden der Anfrage brechen den nativen Dialog ab (Electron ≥ 20 unterstützt `signal` in `showMessageBox`). `consumeCaptureGrant` entfällt (Vertragsänderung gegenüber Spec 2026-11-07 §5.4, R4 bleibt inhaltlich: Quelle nur mit Grant, Grant nur aus nativer Zustimmung).

Texte für `mainT` in `src/shared/locales/{de-DE,en-US}/main.json`: `dialogs.remoteConsent.title` „Bildschirm freigeben?“, `.message` „{{name}} möchte den Bildschirm dieses Geräts ansehen. Nur Ansehen, höchstens fünf Minuten.“, `.detail` „Fingerabdruck des anfragenden Geräts:\n{{fingerprint}}\n\nÜbertragen wird der gesamte Hauptbildschirm, bis du auf „Beenden“ klickst.“, `.confirm` „Bildschirm freigeben“, `.decline` „Ablehnen“.

**4.2b Permission-Handler, deny-by-default.** Neue Datei `src/main/permissions.ts` mit reiner Entscheidungsfunktion und Registrierung:

```ts
export type PermissionContext = { remoteLabEnabled: boolean; isMainFrame: boolean; captureArmed(webContentsId: number): boolean };
export function decidePermission(permission: string, details: { mediaTypes?: string[]; requestingUrl?: string }, webContentsId: number, ctx: PermissionContext): boolean;
export function registerPermissionHandlers(session: Electron.Session, ctx: PermissionContext): void;
```

Regeln: `display-capture` nur wenn `remoteLabEnabled && isMainFrame && captureArmed(id)`; `media` mit `mediaTypes` Kamera/Mikro immer `false`; alles andere (`notifications`, `geolocation`, `midi`, `pointerLock`, `keyboardLock`, `fullscreen`, `clipboard-read`, `clipboard-sanitized-write`, `idle-detection`, `hid`, `serial`, `usb`, `bluetooth`) `false`. Der Renderer nutzt heute keine dieser APIs (Grep: nur `navigator.mediaDevices.getDisplayMedia` in `remote-peer.ts:14`). Zusätzlich `setDevicePermissionHandler(() => false)` und `webContents.on('select-bluetooth-device', e => e.preventDefault())`. Registrierung in `src/main/index.ts` direkt nach `registerRemoteLabIpc` (`index.ts:265`). `setPermissionCheckHandler` mit derselben Funktion. Test: `permissions.test.ts` tabellengetrieben.

**4.2c CSP.** Da Vites React-Plugin im Dev-Modus ein Inline-Preamble einfügt, wird die Policy als `<meta http-equiv="Content-Security-Policy">` über ein kleines `transformIndexHtml`-Plugin in `electron.vite.config.ts` (Renderer) injiziert; Policy-Text aus `src/renderer/csp.ts`:

```ts
export function contentSecurityPolicy(mode: 'development' | 'production'): string
```

Produktion: `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src blob: mediastream:; connect-src 'self'; worker-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`. Entwicklung ergänzt `'unsafe-inline'` in `script-src` und `ws://localhost:* http://localhost:*` in `connect-src`. `style-src 'unsafe-inline'` ist nötig (16 berechnete Inline-Geometrien, xterm). Test `csp.test.ts`: Produktion ohne `unsafe-inline`/`unsafe-eval` in `script-src`, ohne `*`, mit `object-src 'none'`. Pflicht: `run-app` Screens (`terminal`, `sftp`, `settings`, `remote-scene`) müssen ohne CSP-Verstöße laufen; der Umsetzer prüft die Konsole des Drivers.

**4.2d Notbremse.** Main kann Tracks nicht selbst stoppen. Deshalb: Nach `#end` einer Agent-Sitzung, die `connecting|active` war, erwartet der Host innerhalb `REMOTE_LAB_LIMITS.byeMs` (2000 ms) die neue IPC-Aktion `{ kind:'stopped', sessionId }` vom Renderer (gesendet, nachdem `track.stop()` und `pc.close()` durch sind, `remote-peer.ts:150-151`). Bleibt sie aus → `deps.emergency(owner)`; `lab-ipc.ts` implementiert das wie den Crash-Pfad `index.ts:149`: `closeOwnerSessions(owner)` + `webContents.reload()`. Reload beendet deterministisch alle MediaStreams und PeerConnections. Das ist bewusst hart und greift nur, wenn der Renderer nicht kooperiert. Test mit Fake-Timern in `lab-host.test.ts`.

### 4.3 M2 – Aktive Fingerprint-Prüfung beidseitig, Pinning, genau ein DTLS-Fingerprint

**Warum kein SAS in H1:** Ein kurzer SAS aus dem Kanalschlüssel ist ohne Commitment-Runde durch den Server grindbar (er kennt beide DH-Geheimnisse und wählt den zweiten Schlüssel bzw. die Accept-Nonce passend; 10^6 HKDF-Versuche sind Millisekunden). Ein Commitment-Protokoll wäre Eigenkomposition. Der robuste, bibliotheksfreie Weg ist der Vergleich der **langfristigen** Fingerprints, aber **aktiv** statt per Checkbox:

- **Erstkontakt beidseitig getippt.** Die anfragende Seite tippt die ersten **12 Hex-Zeichen** des Fingerprints, den das Zielgerät auf seinem eigenen Bildschirm unter „Fingerabdruck dieses Geräts“ zeigt (`RemoteLabDialog.tsx:103-104`); die Zielseite tippt die ersten 12 Hex-Zeichen des Fingerprints des Anfragenden (ebenfalls aus dessen eigener Anzeige). Der eigene Fingerprint stammt nie vom Server. Ein Server müsste pro Seite einen X25519-Schlüssel mit identischem 48-Bit-Präfix finden (2^48 Schlüsselerzeugungen) – außerhalb des Bedrohungsmodells eines bösartigen Betreibers ohne Spezialhardware; dokumentieren.
- **Pinning.** `identity.ts` `knownDevices` bekommt `verified: boolean`. Nur ein per Eingabe verifiziertes Gerät gilt als „bekannt“; dann entfällt die Eingabe (Dialog zeigt „Geprüft am {{date}}“). Gleicher Name mit anderem Fingerprint → Hinweis „Der Fingerabdruck von {{name}} hat sich geändert“ und Eingabe erneut Pflicht. Bestehende v1-Einträge werden bei der Migration (4.8) auf `verified:false` gesetzt → einmalig neu tippen.
- Vertrag: `{ kind:'request'; target; verification: string | null }` und `{ kind:'armCapture'; sessionId; verification: string | null }`. `null` ist nur erlaubt, wenn der Peer verifiziert-bekannt ist. Prüfung im Main: `verifyFingerprintPrefix(input, fingerprint)` in `src/shared/remote-signal.ts` (normalisiert Leerzeichen/Groß-Klein, verlangt genau 12 Hex, `timingSafeEqual` über die Bytes). Fehlversuche: 3 pro Sitzung, danach `#end(s,'mismatch')`; Fehlercode `mismatch` (vorhanden), neuer `RemoteEndReason` `'mismatch'`. Renderer: `RemoteConsentDialog.tsx` bekommt ein Eingabefeld (Monospace, `inputMode="text"`, `autoComplete="off"`), „Bildschirm freigeben“ erst aktiv bei 12 gültigen Zeichen **und** nach `acceptDelayMs`; `RemoteLabDialog.tsx:115-117` ersetzt die Checkbox durch dasselbe Feld.
- Texte (de): `remoteLab.verify.label` „Erste 12 Zeichen des Fingerabdrucks vom anderen Gerät“, `remoteLab.verify.hint` „Lies sie auf dem anderen Gerät unter „Fingerabdruck dieses Geräts“ ab.“, `remoteLab.verify.verified` „Geprüft am {{date}}“, `remoteLab.verify.changed` „Der Fingerabdruck von {{name}} hat sich geändert. Prüfe ihn erneut.“, `remoteLab.ended.mismatch` „Die Prüfung ist dreimal fehlgeschlagen. Die Anfrage wurde abgelehnt.“ en-US sinngemäß.
- `checkSdp` (`remote-signal.ts:72-80`): genau **eine** `a=fingerprint:`-Zeile (jede Variante, nicht nur sha-256), genau eine `a=setup:`-Zeile, sonst `fail('fingerprint')`. Test erweitern.
- `remember()` (`lab-host.ts:460`) wird zu `remember(id, name, now, verified)`; `verified = true` nur, wenn in dieser Sitzung getippt oder bereits verifiziert war.

### 4.4 M1 + N4 (Server) – Limits pro Quelle, Backoff, vertrauenswürdiger Proxy

**Entscheidung:** Limits pro Quelle im Server selbst, weil Standard-Caddy kein Rate-Limiting hat. Quelle = `request.socket.remoteAddress`, oder bei `SHELLHERD_SERVER_TRUSTED_PROXY=1` das **letzte** Element von `X-Forwarded-For` (Caddy hängt den Peer an; der Port ist auf `127.0.0.1` gebunden, nur der Proxy erreicht ihn). Fehlt der Header trotz Flag → Socket-Adresse (kein Hard-Fail bei Fehlkonfiguration, aber Log-Zeile einmalig).

Neue Datei `scripts/sync-prototype/rate-limit.mjs` (Node-only):

```js
export function createLimiter({ clock, maxSources = 4096 })   // Token-Bucket je Schlüssel, LRU-Verdrängung
limiter.take(key, { capacity, perMinute }) → boolean
export function sourceOf(request, { trustedProxy }) → string  // IPv6 normalisiert, IPv4-mapped entpackt
```

Budgets (`server.mjs` nach `:76`): `/v1/info` 30/min/IP; alle anderen Pfade 120/min/IP; global 600/min bleibt als Obergrenze. Login (`account-auth.mjs:24-25`): 5/min/IP **und** exponentieller Backoff pro IP nach Fehlversuchen (1 s, 2 s, 4 s … max 60 s, Antwort 429 mit `retry-after`); globaler Zähler wird durch `active`-Mutex (bereits vorhanden, scrypt-CPU) ersetzt, **kein** globales Aussperren mehr (verhindert das Aussperren des Besitzers). `server.maxConnections` 32 bleibt; zusätzlich `server.on('connection')` zählt Verbindungen pro IP (max. 8, sonst `socket.destroy()`). Username-Vergleich konstantzeitig über SHA-256 beider Werte. Rendezvous: zusätzlich 60/min/IP für `GET …/messages` und `GET /devices`/`/sessions` zusammen (Polling-Takt 1 s/5 s aus Spec R9 passt: ≤ 36/min pro Gerät beim Aufbau).

`server/Caddyfile.example` neu:

```
{
    servers {
        timeouts { read_header 5s  read_body 10s  write 30s  idle 60s }
    }
}
shellherd.example.org {
    request_body { max_size 1MiB }
    @api path /v1/*
    handle @api {
        reverse_proxy 127.0.0.1:8787 {
            transport http { dial_timeout 2s  response_header_timeout 20s }
        }
    }
    handle { respond 404 }
    header -Server
    # Access logging is deliberately not enabled.
}
```

`server/compose.yaml`: `environment: SHELLHERD_SERVER_TRUSTED_PROXY: "1"` als auskommentiertes Beispiel; README-Abschnitt „Limits pro Quelle“ mit fail2ban-Hinweis (optional, außerhalb des Repos) und dem klaren Satz: „Gegen verteilte Floods hilft nur ein privates Netz (WireGuard/Tailscale), siehe H2.“

Tests (`server.test.mjs`, `account.test.mjs`, neu `rate-limit.test.mjs`, Fake-Clock): 31. `/v1/info` von derselben IP → 429, andere IP → 200; 6. Login/min → 429, Backoff wächst, andere IP unbetroffen; XFF nur mit Flag; LRU bei 4097 Quellen; 9. Verbindung einer IP wird geschlossen.

### 4.5 N1 – Sync überspringt fremde Objekte, Limits angleichen

- `vault-sync.ts` `pull()` (`:70-74`): Objekte, die nicht in `acked` liegen und bei `openDocument`/`validatePortableVault`/`document.id` scheitern, werden **übersprungen und gezählt** statt `wrongVault` zu werfen; `acked`-Objekte scheitern weiterhin hart (`history`). Rückgabe `VaultSyncResult.skipped: number`.
- Limits: Client `Graph` 100 Versionen / 32 MiB (an Server angleichen, `vault-sync.ts:25,38`, `stateSchema` `versions.max(100)`); `ids` max 100 (`account-transport.mjs:28` bereits 100).
- `importVault` (`:149`): erstes lesbares Objekt statt `listing[0]`; wenn keines lesbar → `wrongVault`.
- UI: `SyncLabState.sync.skipped`, Text `syncLab.skipped` „{{count}} fremde oder nicht lesbare Objekte wurden übersprungen.“ (de/en). Kompaktierung/Tombstones → H2.
- Tests `vault-sync.test.ts`: fremdes Objekt im Konto → Sync `synced`, `skipped: 1`; manipuliertes `acked`-Objekt → `history`; 100 Versionen akzeptiert, 101 → `limit`.

### 4.6 N2 + I4 – Registrierung mit Besitznachweis, Rollenbindung

**Entscheidung:** Besitznachweis per **statisch-ephemerem X25519-DH** mit Server-Challenge; die Geräteidentität (X25519, Fingerprint = SHA-256 der SPKI) bleibt unverändert → keine Migration der Identitätsdatei, Pins bleiben gültig.

- `GET /v1/rendezvous/challenge` (authentifiziert): Server erzeugt `generateKeyPairSync('x25519')`, speichert `{ id: hex32, privateKey, created }` (RAM, ≤ 128 offen, 30 s, pro Anmeldung max. 4), antwortet `{ challenge: id, serverKey: spkiBase64, expiresAt }`.
- `PUT /v1/rendezvous/devices` Body `{ name, publicKey, challenge, proof }`. Client: `secret = diffieHellman(devicePriv, serverKey)`; `k = hkdf('sha256', secret, serverId, 'shellherd-rendezvous-pop-v1', 32)`; `proof = HMAC-SHA256(k, JSON.stringify(['shellherd-rendezvous-pop-v1', serverId, challenge, publicKey, name]))` hex. Server rechnet dasselbe mit seinem ephemeren Private-Key, `timingSafeEqual`, löscht die Challenge (einmalig). Lease-Erneuerung derselben Anmeldung (`previous.owner === owner`, `rendezvous.mjs:54`) braucht **keinen** neuen Nachweis.
- `/v1/info` ergänzt `rendezvousProof: true`; `probeSyncServer` liefert es durch; `RemoteLabHost.#connect` (`lab-host.ts:161`) verlangt `info.rendezvousProof === true`, sonst `unavailable` (kein Downgrade). `protocol: 1` bleibt.
- `RendezvousPeer.register(name)` (`rendezvous-client.mjs:19-22`) holt die Challenge selbst; Signatur bleibt gleich → `PresenceTransport` unverändert.
- I4: `RendezvousChannel`-Konstruktor (`:55`): `session.from === self ? fingerprint === session.to : fingerprint === session.from`.
- Tests `rendezvous.test.mjs`: Registrierung ohne/mit falschem Proof → 400; fremder Public Key mit eigener Anmeldung → 400; Challenge zweimal → 400; abgelaufen → 400; Rollentausch im Kanal → wirft.

### 4.7 N4 (Init) – Passwortqualität

`account-init.mjs`: Vorschlag eines generierten Passworts (24 Zeichen aus `randomBytes`, Alphabet ohne verwechselbare Zeichen, einmalig angezeigt, Frage „Generiertes Passwort verwenden? [J/n]“). Eigenes Passwort: Mindestlänge **16**; Hinweistext bleibt „NICHT das Vault-Passwort“. `createAccount` (`account-auth.mjs:10`) behält 12 als Untergrenze für bestehende Konten (Kompatibilität der Konfig), die 16 gilt nur bei `init`/`rotate-password`. Test: `account.test.mjs` prüft die Generatorfunktion (Länge, Alphabet) – ausgelagert nach `account-auth.mjs` als `generatePassword()`.

### 4.8 N5 – Bekannte Geräte authentifiziert

`identity.ts` Datei-Version 2: `{ version: 2, identity: base64(safeStorage(pkcs8 ‖ macKey32)), knownDevices: [...], mac: hex(HMAC-SHA256(macKey, stable(knownDevices))) }`. `macKey` wird beim Anlegen erzeugt und liegt im selben `safeStorage`-Blob wie der private Schlüssel (Linux-`safeStorage` ist AES-CBC ohne Authentifizierung, daher der explizite MAC). Laden: MAC falsch → `fail()` (Fehler `identity`, Datei bleibt unangetastet, R7). Migration v1 → v2: v1 wird gelesen (wie heute), `macKey` erzeugt, Einträge `verified:false`, einmal atomar als v2 geschrieben; nur, wenn v1 fehlerfrei entschlüsselt wurde. `knownSchema` + `verified: z.boolean()`. RAM-only unverändert. Tests `identity.test.ts`: Round-Trip, manipuliertes `knownDevices` → `identity`, v1-Migration, `verified`-Persistenz.

### 4.9 N6 + I5 – Image-Digest, Caddy-Größe

- `server/Dockerfile:1`: `FROM node:22-bookworm-slim@sha256:<digest>` mit Kommentarzeile des aufgelösten Tags und Datum. Den Digest holt der Umsetzer zur Umsetzungszeit (`docker buildx imagetools inspect node:22-bookworm-slim`); ohne Netz bleibt die Zeile als `TODO` markiert und die Spec gilt als nicht erfüllt. README: Abschnitt „Image aktualisieren“ (Digest erneuern, `scripts/check-server-container.mjs` laufen lassen). Kein Renovate/Dependabot-Setup im Repo (`.github/` hat nur `workflows`) → nur Doku, kein Bot in H1.
- `Caddyfile.example`: `1MiB` (siehe 4.4).

### 4.10 N7 – Consent-Spam

- Agent (`lab-host.ts` `#onSessions` `:359-367`): `Online.muted: Map<fingerprint, until>`; nach `decline`/`mismatch` 10 min; eingehende Anfrage eines stummen Geräts → sofort `DELETE`, kein Dialog, Zähler `RemoteLabState.muted: number` für eine stille Zeile im Dialog („{{count}} Anfragen stummgeschaltet“).
- Server (`rendezvous.mjs:64-69`): höchstens **eine** offene Anfrage pro Paar `(from,to)`; nach `DELETE` durch das Ziel 30 s Sperre für dasselbe Paar → 429.
- Tests beidseitig.

---

## 5. Vertragsänderungen (wörtlich zu übernehmen)

`src/shared/remote-lab.ts`:

```ts
export type RemoteEndReason = 'stopped' | 'remote' | 'expired' | 'locked' | 'declined' | 'failed' | 'scope' | 'mismatch';
export type RemoteErrorCode = … | 'samePassword';
export interface RemoteDevice { id: string; name: string; known?: { firstSeen: number; verified: boolean } }
export type RemoteLabCommand = …
  | { kind: 'request'; target: string; verification: string | null }
  | { kind: 'armCapture'; sessionId: string; verification: string | null }
  | { kind: 'stopped'; sessionId: string }   // renderer ack after tracks/pc are closed
  …;
export interface RemoteLabSession { …; state: 'requesting' | 'consent' | 'granted' | 'connecting' | 'active'; attemptsLeft?: number }
export interface RemoteLabState { …; muted?: number }
export const REMOTE_LAB_LIMITS = { …, verificationHex: 12, verificationAttempts: 3, muteMs: 600000 } as const;
```

`src/main/remote/lab-host.ts` (Host-API):

```ts
captureCandidate(webContentsId: number): { sessionId: string; name: string; fingerprint: string; verified: boolean; signal: AbortSignal } | null;
grantCapture(sessionId: string): boolean;     // consent → granted, single use
refuseCapture(sessionId: string): void;       // ends with 'declined'
```

`RemoteDeps` + `matchesVaultPassword(password: string): Promise<boolean>; emergency(owner: number): void`.

`src/shared/sync-lab.ts`: `SyncLabReply.code` + `'samePassword'`; `SyncLabState.sync.skipped: number`.

`src/shared/remote-signal.ts`: `verifyFingerprintPrefix(input: string, fingerprint: string): boolean`, `checkSdp` wie 4.3.

Server-API: `GET /v1/rendezvous/challenge`, `PUT /v1/rendezvous/devices {name, publicKey, challenge, proof}`, `/v1/info.rendezvousProof`, 429 mit `retry-after`.

---

## 6. Migration

| Bestand | Verhalten nach H1 |
| --- | --- |
| `server.json` (Konto, scrypt) | unverändert lesbar; `rotate-password` empfiehlt generiertes Passwort |
| Server ohne `SHELLHERD_SERVER_TRUSTED_PROXY` | Limits greifen pro Socket-Adresse (hinter Caddy = eine Quelle, also wie heute, aber mit Backoff statt Aussperren). README fordert das Flag für Proxy-Betrieb |
| Clients v0.32 gegen Server H1 | `PUT /devices` ohne Proof → 400 → Remote-Lab meldet `connection`; Sync-Lab (Vault-Objekte) unverändert kompatibel |
| Clients H1 gegen Server v0.32 | `rendezvousProof` fehlt → `unavailable` (bewusst, kein Downgrade) |
| `remote-identity.json` v1 | wird einmal zu v2 migriert; Fingerprint bleibt; bekannte Geräte `verified:false` → einmal tippen |
| `.sync-state` | Schema `versions.max(100)` ist abwärtskompatibel |
| run-app `rendezvous.mjs`/`remote-scene.mjs` | Fake nutzt den echten Server → automatisch Proof; Szene muss das 12-Zeichen-Feld füllen (liest den Fingerprint der jeweils anderen Instanz aus deren DOM) und den nativen Dialog bestätigen (Driver: `dialog`-Hook im Boot-Skript, analog zu bestehenden Dialog-Stubs; falls nicht vorhanden, Test-Hook `SHELLHERD_REMOTE_CONSENT_AUTO=1` nur ungepackt + Lab-Flag, der `confirm` im Handler durch „ja nach 200 ms“ ersetzt – in Produktion unerreichbar, analog R12) |

---

## 7. Regeln und Risiken – was ausdrücklich nicht getan wird

- Kein SAS, kein PAKE, kein Noise in H1 (siehe 4.3; Noise kommt in H2).
- Kein TOTP/WebAuthn (Abschnitt 3).
- Kein Caddy-Plugin, kein fail2ban im Repo; Limits liegen im Server.
- Keine Kompaktierung/Tombstones, kein zufälliger Sync-Schlüssel (H2/H3; ohne Pairing-Transfer oder Wiederherstellungscode bringt ein gewrappter Schlüssel gegen I1 nichts).
- Keine Electron-Fuses (I7) in H1: Build-Pipeline-Thema, eigener kleiner PR.
- Keine Zertifikats-Pinning-Logik (I8): mit M3 und H3 sinkt die Kritikalität; Pinning im Lab wäre Betriebslast ohne Reviewgewinn.
- `desktopCapturer.getSources()[0]` bleibt (Hauptbildschirm), der native Dialog benennt das. Kein OS-Picker.
- Risiko Notbremse: `reload()` verwirft Renderer-Zustand; durch `closeOwnerSessions` wie beim Crash konsistent. Nur im Fehlpfad.
- Risiko CSP: Dev-Preamble braucht `'unsafe-inline'` im Dev-Modus; Produktion strikt. Pflichtprüfung mit run-app.
- Risiko Argon2id-Zeit bei M3: ≈150 ms pro Anmeldeklick, im Main-Thread via WASM; akzeptiert.
- Risiko 48-Bit-Präfix: gegen Betreiber mit GPU-Farm nicht ausreichend; im Handbuch benannt, H2-Pinning der Noise-Statik plus Vollvergleich bei Verdacht.
- Renderer-Kompromittierung: Kann weiterhin Anfragen stellen und Dialoge zeigen, aber weder den 12-Zeichen-Code kennen (steht nur auf dem anderen Gerät) noch den nativen Klick erzeugen.

---

## 8. Zerlegung in Tasks und Wellen

Welle 1 (unabhängig, getrennte Dateien):

| Task | Dateien | Befund |
| --- | --- | --- |
| T1 Server-Limits | `scripts/sync-prototype/rate-limit.mjs` (neu), `server.mjs`, `account-auth.mjs`, `server.test.mjs`, `account.test.mjs`, `rate-limit.test.mjs` (neu) | M1, N4 |
| T2 Rendezvous-Proof + Spam + I4 | `rendezvous.mjs`, `rendezvous-client.mjs`, `rendezvous.test.mjs`, `http-common.mjs` (`rendezvousProof`) | N2, N7, I4 |
| T3 Vault-Passwort-Prüfung | `src/main/vault/crypto.ts` (`deriveKey` exportieren), `src/main/vault/session.ts`, `session.test.ts` | M3-Kern |
| T4 Identität v2 | `src/main/remote/identity.ts`, `identity.test.ts` | N5, Pinning-Basis |
| T5 CSP + Permissions | `electron.vite.config.ts`, `src/renderer/csp.ts` + Test, `src/main/permissions.ts` + Test, `src/main/index.ts` (nur Registrierung) | M4b/c |
| T6 Signal-Helfer | `src/shared/remote-signal.ts`, `remote-signal.test.ts`, `src/shared/remote-lab.ts` (Vertrag), `src/shared/sync-lab.ts` (Codes) | M2c, Vertrag |
| T7 Betrieb | `server/Caddyfile.example`, `server/Dockerfile`, `server/compose.yaml`, `server/README.md`, `account-init.mjs` + `generatePassword` in `account-auth.mjs` | I5, N6, N4-Init, M1-Doku |
| T8 Sync-Toleranz | `src/main/sync-prototype/vault-sync.ts`, `vault-sync.test.ts` | N1 |

Welle 2 (nach T2, T3, T4, T6):

| Task | Dateien | Abhängig von |
| --- | --- | --- |
| T9 RemoteLabHost | `src/main/remote/lab-host.ts`, `lab-host.test.ts` (signIn-Guard, Verifikation, `granted`, Mute, `stopped`-Ack/Notbremse, `rendezvousProof`) | T3, T4, T6, T2 |
| T10 SyncLabHost | `src/main/sync-prototype/lab-host.ts`, `lab-host.test.ts`, `lab-ipc.ts` (Verdrahtung), `skipped` durchreichen | T3, T6, T8 |
| T11 Lab-IPC + nativer Dialog | `src/main/remote/lab-ipc.ts`, `lab-ipc.test.ts`, `src/shared/locales/*/main.json` | T9-Signaturen (aus Vertrag T6), T5 (`captureArmed`) |

Welle 3 (nach Welle 2):

| Task | Dateien |
| --- | --- |
| T12 Renderer | `RemoteConsentDialog.tsx`, `RemoteLabDialog.tsx`, `remote-peer.ts` (`stopped`-Ack), `remote-lab.ts` (Keys), `SyncLabDialog.tsx` (`skipped`, `samePassword`), `locales/*/remoteLab.json`, `syncLab.json`, `remote-lab.css` (nur Tokens) |
| T13 Doku + Szene | `docs/handbuch.md` §„Fernzugriff (Entwicklung)“, `docs/plans/selfhosted-e2ee.md`, `docker-rendezvous.md`, `.claude/skills/run-app/remote-scene.mjs`, `boot.mjs` (Consent-Hook), `SKILL.md` |

Abschluss: `npm run typecheck`, `npx vitest run`, `node server/smoke.mjs`, `remote-scene.mjs`, `scripts/check-server-container.mjs` (wenn Docker verfügbar).

---

## 9. Minimale erste Stufe gegenüber Extras

Minimal (ohne das ist H1 nicht erfüllt): T1, T2, T3, T4, T6, T9, T11, T12 (M1–M4, N2, N5, N7, I4) sowie I5/N6 aus T7.

Extras innerhalb von H1 (wertvoll, aber abtrennbar, falls die Welle zu groß wird): T8 (N1), `generatePassword` (N4-Init), Mute-Zähler in der UI, Caddy-`servers`-Timeouts.

Nicht in H1: Noise, WireGuard-Compose, Tombstones, Sync-Schlüssel, Fuses, TOTP.

---

## 10. Offene Entscheidungen mit Empfehlung

1. **Länge der getippten Prüfung:** 12 Hex (48 Bit). Empfehlung: 12; 8 wäre GPU-grindbar, 16 zu lästig.
2. **Native Zustimmung im Display-Media-Handler vs. vor `getDisplayMedia`:** im Handler, weil die User-Activation sonst verfällt. Empfehlung: Handler.
3. **Notbremse Reload vs. Fenster schließen:** Reload + `closeOwnerSessions` (Crash-Pfad). Empfehlung: Reload.
4. **Proof-Verfahren N2:** statisch-ephemeres DH (keine Identitätsmigration) statt zusätzlichem Ed25519. Empfehlung: DH; Ed25519 kommt in H3 als eigener Signaturschlüssel mit neuem Fingerprint-Format.
5. **Client-Limits N1:** auf Serverwerte (100/32 MiB) anheben statt Server senken. Empfehlung: anheben; der Server zählt kontoweit.
6. **Gesperrter Vault beim Sync-Lab-Sign-in:** erlauben ohne M3-Prüfung (Import-Fall). Empfehlung: erlauben, Hinweistext im Dialog bleibt.
7. **Consent-Hook für run-app:** `SHELLHERD_REMOTE_CONSENT_AUTO=1` nur ungepackt + Lab. Empfehlung: ja, analog R12, Test in `lab-ipc.test.ts`, dass er gepackt unwirksam ist.
8. **TOTP:** nicht jetzt (Abschnitt 3).

---

## 11. H2 und H3 – Skizze für die Folgebranches

**H2 Protokoll (Lab):**
- `rendezvous-client.mjs`: Kanal auf `Noise_XX_25519_ChaChaPoly_BLAKE2b` (`noise-handshake`, `pairing.mjs:7,55-58` zeigt die Nutzung). Prologue `['shellherd-rendezvous-noise-v1', serverId, sessionId, nonce, scope]`. Statische Noise-Identität = heutiger X25519-Geräteschlüssel (gleicher Fingerprint). Handshake-Nachrichten laufen als Frames über die bestehende Server-Queue; erst nach Handshake `accepted`. Forward Secrecy je Sitzung (N3). Transkript-Hash `h` wird im Pin gespeichert, Pin-Vergleich ersetzt den 12-Zeichen-Tipp für bekannte Geräte vollständig.
- Betrieb: README-Abschnitt „Nur über WireGuard/Tailscale“, Compose-Variante `compose.wireguard.yaml` mit `ports: "10.x.y.z:8787:8787"` (Bind nur ans WG-Interface) und ohne Caddy; HTTP in privatem Netz ist dann zulässig, weil der Client `allowLoopbackHttp` erweitert werden muss → neue Option `allowPrivateHttp` mit expliziter Nutzerbestätigung. Caddy-Variante bleibt für Internet-Exposition.
- Kompaktierung: signierte Tombstones (Ed25519 pro Gerät aus H3 oder vorerst HMAC mit Sync-Schlüssel) als Objektart; Server löscht nur referenzierte IDs; Client behält Anker.

**H3 Gerätegebundene Anmeldung:**
- Jede API-Anfrage signiert (`http-proof.mjs` Format, Nonce von `/v1/challenge`, bereits im Server für den Gerätemodus `server.mjs:102-138`). Konto bekommt Geräte-Roster (`server-access.mjs` Admin-Freigabe). Passwort nur noch für `POST /v1/enrollments`; erstes Gerät per einmaligem Aufnahme-Code aus `init`.
- Verlaufsanker: jedes Gerät veröffentlicht `['anchor', vaultId, heads, counter]` signiert; Rollback/Fork anderer Geräte wird erkennbar (T05 teilweise).
- Zufälliger Sync-Schlüssel im Vault-Dokument; Transfer an neue Geräte per Noise-Pairing (H2) **oder** per 128-Bit-Wiederherstellungscode (HKDF → AES-GCM-Wrap als Objekt auf dem Server). Damit erledigen sich I1 und I2.
- OPAQUE wird nicht gebraucht: nach H3 ist das Passwort kein dauerhaftes Anmeldegeheimnis mehr.
