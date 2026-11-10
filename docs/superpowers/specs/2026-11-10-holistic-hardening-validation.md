# H3.1 Ganzheitliche Härtung: Validierung (bindend)

Prüfer: Opus, 2026-11-10. Geprüft wurde die Spec `2026-11-10-holistic-hardening-design.md` gegen den Code auf `claude/feature/holistic-hardening` (`92eebc0`). Die Detailspezifikation liegt in `.superpowers/sdd/2026-11-10-holistic-review/{server,sync,remote,app}.md`. Kontext: `CLAUDE.md`, die Skills `feature-pipeline` und `run-app`, `.github/workflows/{ci,release}.yml`.

Ausgangslage: `npx vitest run` ist grün (229 Dateien). Node 22.22, Electron 44.4, electron-builder 26.17 mit `@electron/fuses` 1.8, node-pty 1.1.0, playwright-core.

**Urteil: ready after corrections.** Es gibt 11 Blocker, 30 Korrekturen und 14 Entscheidungen.

Dieser Anhang geht der Spec vor. Was hier nicht steht, gilt aus der Spec und den Befundberichten weiter. Die Wellen- und Dateizuordnung in §6 ersetzt Spec §2 vollständig.

---

## 1. Blocker (jeder mit Fix, bindend)

**B1: Die Fuse `enableNodeCliInspectArguments: false` bricht beide Paket-Smokes in CI und Release.**
- Beleg: `node_modules/playwright-core/lib/server/electron/electron.js:132` startet Electron immer mit `--inspect=0` und wartet auf den Inspector-Endpunkt. `scripts/smoke-linux.mjs` und `scripts/toolbar-smoke.mjs` nutzen `_electron.launch`. `toolbar-smoke.mjs:48` ruft zusätzlich `app.evaluate` im Main-Prozess auf (Dialog-Stubs), was ohne Inspector gar nicht geht. Beide laufen in `ci.yml` („Check packaged Linux startup“) und `release.yml:72-73` gegen das ausgelieferte Paket.
- Fix: `enableNodeCliInspectArguments` wird in H3.1 **nicht** gesetzt. Es wandert zu den offenen Punkten (H4, zusammen mit den asar-Fuses) mit der Begründung „Paket-Smokes brauchen einen Inspector-freien Harness (CDP über `--remote-debugging-port`)“. Siehe E1.

**B2: `runAsNode: false` bricht node-pty unter Windows.**
- Beleg: `node_modules/node-pty/lib/windowsPtyAgent.js:184` ruft beim Beenden einer ConPTY-Sitzung `child_process.fork(conpty_console_list_agent)` auf. `fork` braucht unter Electron `ELECTRON_RUN_AS_NODE`. Ist die Fuse aus, startet stattdessen eine zweite Shellherd-Instanz (die `second-instance` im ersten Prozess auslöst und das Fenster nach vorn holt), und node-pty fällt erst nach 5 s auf „nur Shell-PID beenden“ zurück. Kindprozesse lokaler Terminals bleiben dann stehen.
- Fix: `runAsNode: false` gilt nur für das Linux-Binary. Siehe E1 und §2.4.

**B3: `scripts/check-server-container.mjs` fehlt in der Dateizuordnung und bricht mit C1, S3 und R-H31-4.**
- Beleg: Das Skript läuft in `ci.yml:45`.
  - Es startet den Container mit zufälligem Host-Port (`-p 127.0.0.1::8787`, `:25`). Mit Pflicht-`SHELLHERD_SERVER_ORIGIN` startet der Server nicht, und die Origin ist vor dem Start unbekannt.
  - `docker compose … config` (`:39`) scheitert, sobald `compose.yaml` `${SHELLHERD_SERVER_ORIGIN:?…}` nutzt und die Variable fehlt.
  - Der Gerätename `'synthetic-' + identity.id.slice(0, 8)` (`:50`) enthält 8 Hex-Zeichen und verstößt gegen R-H31-4.
- Fix: Das Skript gehört zu T1. Pflichten stehen in §2.1 (T1-14).

**B4: Das Server-Image startet nicht, wenn `device-name.mjs` fehlt.**
- Beleg: `server/Dockerfile` kopiert die Skripte einzeln. `device-proof.mjs` und `rendezvous.mjs` importieren künftig `./device-name.mjs`, das in der Liste fehlt. Folge: `ERR_MODULE_NOT_FOUND` beim Start.
- Fix: T1 nimmt `scripts/sync-prototype/device-name.mjs` in die `COPY`-Zeile auf. `check-server-container.mjs` belegt das.

**B5: Nach Welle 1 ist die Testsuite rot (Paritätstest `DEVICE_NAME`).**
- Beleg: `src/main/sync-prototype/lab-host.test.ts:514-519` vergleicht `DEVICE_NAME.source` aus `lab-host.ts` mit `device-proof.mjs`. T1 entfernt bzw. ersetzt `DEVICE_NAME` in Welle 1, die Datei gehört laut Spec aber erst T5 in Welle 2.
- Fix: T1 besitzt in Welle 1 genau diesen Testblock (`it('uses the same device name rule …')`, Zeilen 514-519, endet vor `:520`) und löscht ihn. Den Paritätstest übernimmt `src/shared/device-name.test.ts` (T1). Den Block `weakEd25519` (`:520-533`) lässt T1 unverändert. In Welle 2 gehört die Datei wieder T5.

**B6: S4(b) „Altkonten unter 20 Zeichen“ ist nicht erkennbar.**
- Beleg: `server.json` enthält nur den scrypt-Hash (`account-auth.mjs:18-22`). Die Passwortlänge ist danach unbekannt.
- Fix: `account-init.mjs` schreibt ein Feld `passwordPolicy` (`'generated'` oder `'custom'`). Fehlt es, warnt der Server beim Start bei jedem Konto. Siehe §2.1 (T1-9).

**B7: Welle 2 kann die Texte nicht „melden und anlegen lassen“, weil T5 und T6 parallel laufen.**
- Beleg: Spec §2: „Neue Texte meldet T6 im Report, T5 legt sie an.“ T6 braucht aber neue Texte (Bestätigung bei `enrolledElsewhere`, Namenshinweis, Fehlercode).
- Fix: Alle Keys stehen wörtlich in §5. T5 legt sie an, T6 verwendet sie. Der Katalogtest (verwaiste Keys) ist erst nach Welle 2 grün. Das ist erlaubt, denn maßgeblich ist der Stand nach der Welle.

**B8: Das Löschen nur noch von Altformat-Objekten und die Verweigerung von `regenerateRecoveryCode` ergeben zusammen eine Sackgasse.**
- Beleg:
  - Nach der Spec löscht `removeForeignObjects` keine unlesbaren Versionsumschläge mehr. `regenerateRecoveryCode` verweigert aber genau dann, wenn ein solcher Umschlag im Konto liegt.
  - Solche Umschläge entstehen weiter auf drei Wegen: als Reste aus Zwei-Schlüssel-Konten vor H3.1, durch ein `abortBootstrap`, dessen Rücknahme scheitert (best effort, C3), und durch ein beliebiges eingeschriebenes Gerät, das Müll hochlädt.
  - Danach lässt sich der Code nie wieder erneuern. Die Objekte belegen dauerhaft Quota, und `skipped` bleibt für immer größer als 0.
- Fix: Unlesbare Versionsumschläge werden nur mit ausdrücklichem Opt-in gelöscht, über `removeForeign` mit `versions: true`, Checkbox und Warntext. Der Standard bleibt „nur Altformat“. Siehe K12, §2.2 und §5.

**B9: Werden verbrauchte Nonces verdrängt, öffnet das ein Replay-Fenster.**
- Beleg: S2 der Spec sagt: „Wird die Menge zu groß (4096), verdrängt der Server die älteste.“ Die Menge enthält aber die *verbrauchten* Nonces. Fliegt eine noch gültige Nonce hinaus, ist sie bis zum Ablauf ihrer 30 s erneut einlösbar. Der Befundbericht meinte mit Verdrängung die *ausgegebenen* Nonces, und die gibt es zustandslos nicht mehr.
- Fix: keine Verdrängung. Ist die Menge voll, werden zuerst abgelaufene Einträge entfernt. Ist sie danach noch voll, antwortet der einlösende Request mit 429 (fail-closed). Mit dem globalen Budget (600/min, also höchstens 300 Einlösungen in 30 s) wird der Deckel praktisch nie erreicht. Siehe §2.1 (T1-3).

**B10: Mit der strengeren Namensregel startet ein bestehender Server nicht mehr, und Gerätelisten scheitern im Client.**
- Beleg:
  - `device-roster.mjs:91` prüft beim Laden jeden Namen und bricht fail-closed mit 500 ab.
  - `account-transport.mjs:44` verwirft die ganze Geräteliste, sobald ein Name ungültig ist.
  - Bestehende `devices.json` können Namen enthalten, die gegen R-H31-4 verstoßen. Die Spec sagt dazu nichts.
- Fix: E5 setzt die Roster-Version auf 2. Eine Datei mit Version 1 führt zu einem gezielten Startfehler mit Hinweis. Das entspricht R-H31-2 („Geräte schreiben sich neu ein“), und nach S4 ist es auch der saubere Weg, unbekannte Altgeräte loszuwerden.

**B11: Wellenübergreifende API-Änderungen ohne Vertrag.**
- Beleg:
  - T6 ändert in Welle 2 `RemoteIdentityStore` (Pin über `(serverId, origin)`), T5 ruft die API im selben Durchlauf in `sync-prototype/lab-host.ts:107,152,237` auf.
  - T2 ändert in Welle 1 Funktionen, die `sync-prototype/lab-ipc.ts` aufruft (T5, Welle 2).
- Fix:
  - Die Identitäts-API steht wörtlich in §2.6.
  - Alle Signaturänderungen von T2 sind abwärtskompatibel (optionale Parameter), damit `lab-ipc.ts` nach Welle 1 unverändert kompiliert (§2.2).

---

## 2. Vertrag (Pflichtpunkte je Task, wörtlich umsetzen)

### 2.1 T1 Server, Transport, Gerätenamen (Welle 1)

**T1-1 Gerätenamen (R-H31-4, präzisiert, siehe auch K21).** `src/shared/device-name.ts` und `scripts/sync-prototype/device-name.mjs` sind reine Module, ohne `node:*`-Importe, und haben identische Exporte:

```ts
export const DEVICE_NAME_MAX = 64;
/** NFC plus trim of U+0020; what clients send. */
export function normalizeDeviceName(input: string): string;
/** True only for an already normalized name that satisfies the rule. */
export function isDeviceName(name: unknown): name is string;
```

`isDeviceName(name)` prüft in dieser Reihenfolge:
1. `typeof name === 'string'` und `name === name.normalize('NFC')`, ohne führendes oder abschließendes U+0020.
2. 1 ≤ `[...name].length` ≤ 64 (Codepoints).
3. `/^[\p{L}\p{Nd} \-_.,()']+$/u` passt, und keiner der Hangul-Füller U+115F, U+1160, U+3164 und U+FFA0 kommt vor.
4. `skeleton = name.normalize('NFKC')`, dann wird jedes Zeichen der Tabelle `{ 'а':'a', 'с':'c', 'е':'e', 'ԁ':'d', 'А':'A', 'В':'B', 'С':'C', 'Е':'E', 'Α':'A', 'Β':'B', 'Ε':'E' }` (Kyrillisch U+0430/0441/0435/0501/0410/0412/0421/0415, Griechisch U+0391/0392/0395) ersetzt und alle Zeichen aus `[ \-_.,()']` entfernt. Ergibt `/[0-9a-fA-F]{8}/.test(skeleton)` true, ist der Name ungültig.

Den Test `src/shared/device-name.test.ts` legt T1 an. Er enthält:
- einen Korpus mit Gültigen: `Laptop-2024`, `Büro-PC (alt)`, `Gerät A k3x9z`, `Ноутбук`, `O'Brien`;
- und Ungültigen: leer, 65 Zeichen, `\n`, U+202E, U+200B, U+3164, `á` (nicht NFC), `3f9a12c4`, `3f9a 12c4`, `ＡＢＣＤ１２３４` (Vollbreite), `3f9а12с4` (kyrillisch), `Cafe Bad Deck`, `20241110`;
- und die Parität: Für jeden Korpuseintrag liefern TS und mjs dasselbe Ergebnis (dynamischer Import der mjs wie in `lab-host.test.ts:516`).

Server (`enrollmentBody`, Roster-Laden, Rendezvous-Registrierung `rendezvous.mjs:74`) und Client (`account-transport.mjs` `enroll`/`devices`) nutzen `isDeviceName`. `DEVICE_NAME` entfällt in `device-proof.mjs`.

**T1-2 Origin-Bindung (C1, R-H31-3).**
- `device-proof.mjs` bekommt neue Domänen-Tags und neue Signaturen:
  ```js
  export const DEVICE_ENROLLMENT = 'shellherd-device-enrollment-v2';
  export const DEVICE_SESSION = 'shellherd-device-session-v2';
  export const DEVICE_REQUEST = 'shellherd-device-request-v3';
  export function enrollmentBody(serverId, namespace, origin, deviceId, signingKeyB64, noiseKeyB64, name); // 8-tuple
  export function sessionProof(serverId, namespace, origin, nonce, deviceId);
  export function requestProofV2(serverId, namespace, origin, method, path, nonce, deviceId);
  ```
- `origin` ist gültig, wenn `normalizeSyncServerUrl(origin + '/', { loopback: true, private: true }) === origin + '/'`. Also ohne Slash, ohne Pfad, in Kleinschreibung und ohne Standardport.
- Der Client (`AccountStore`) nimmt `new URL(info.serverUrl).origin`.
- `createSyncServer({ …, origin = null })`: Ist `origin` gesetzt, wird es so geprüft. Ist es `null`, setzt `listen()` es auf `new URL(listenUrl).origin` (Loopback-Vorgabe für Tests, Smoke und Szenen, siehe K1).
- Der Server vergleicht Einschreibung (`doc[0][3] === origin`, Tupellänge 8, auch in `device-roster.mjs` `enroll`), Sitzung und Widerruf **nur** gegen dieses `origin`, nie gegen den Host-Header.
- `/v1/info` liefert zusätzlich `origin`. `probeSyncServer` verlangt `info.origin === new URL(url).origin`, sonst schlägt die Probe fehl (K3).
- Test in `account.test.mjs`: zwei Server mit derselben `serverId` und demselben `namespace` (A und B, verschiedene Ports). D wird bei B eingeschrieben. Ein Sitzungsnachweis über die Origin von A an B ergibt 401, ebenso ein `DELETE`-Nachweis.

**T1-3 Zustandslose Nonces (S2).**
- Format: 32 Byte als 64 Hex-Zeichen (Kleinbuchstaben). Clients prüfen weiterhin `HEX64`.
  - `ts`: 8 Byte, uint64 BE, ms aus `clock()`.
  - `rand`: 8 Byte.
  - `mac`: die ersten 16 Byte von `HMAC-SHA256(secret, 'shellherd-nonce-v1' ‖ ts ‖ rand)`.
  - `secret = randomBytes(32)` je Prozess, nur im RAM.
- Einlösen (`consumeNonce`, ersetzt beide Map-Pfade einschließlich Legacy-Gerätemodus `server.mjs:202-203`):
  - gültig, wenn hex64, `mac` per `timingSafeEqual` stimmt, `ts ≤ now` und `now - ts < 30_000` gilt und die Nonce nicht in `spent` liegt;
  - jede gültige Nonce kommt sofort nach `spent` (`Map<nonce, ts>`), egal was danach scheitert;
  - ungültige Nonces kommen nie in die Menge;
  - Deckel 4096 ohne Verdrängung (B9).
- `GET /v1/challenge` hält keinen Zustand mehr. Das Budget `challenge` je Quelle bleibt, die Deckel 128 (global) und 8 (je Quelle) entfallen.
- Tests:
  - Replay derselben Nonce ergibt 401.
  - Eine abgelaufene Nonce (Clock +30 s) ergibt 401.
  - Eine gefälschte MAC ergibt 401 und landet nicht in `spent`.
  - 200 ausgegebene Challenges aus 16 Quellen blockieren keine weitere Quelle.

**T1-4 Grundlast (S1).**
- `http.createServer({ maxHeaderSize: 8192, connectionsCheckingInterval: 1000 }, …)` mit `headersTimeout = 5000`, `requestTimeout = 15000` und `maxConnections = 256`.
- Lesefrist für Bodies vor der Authentisierung (`POST /v1/devices`, `POST /v1/session`): Ab Handler-Start gilt ein Gesamt-Timer von 3000 ms. Läuft er ab, folgt `request.destroy()`, und der Versuch zählt als Formfehler (`fail` bzw. `failSession`).
- Nebenläufigkeit je Quelle (`sourceOf`, greift auch hinter dem Proxy):
  - neues Limit `limits.concurrentPerSource` (Standard 4);
  - der Zähler steigt am Handler-Anfang und sinkt bei `response.on('close')`;
  - ein Überschreiten ergibt 429 mit `retry-after: 1`;
  - Tests mit vielen parallelen Requests dürfen das Limit über `limits` anheben.
- Das Verbindungslimit je Adresse (`connectionsPerSource`) bleibt im Direktbetrieb.
- Tests:
  - Ein langsamer Body (`Content-Length: 4000`, 1 Byte) wird nach höchstens ≈ 4 s geschlossen, und `/v1/info` einer anderen Quelle bleibt währenddessen 200.
  - Der fünfte gleichzeitige Request derselben Quelle ergibt 429.

**T1-5 Vertrauenswürdiger Proxy (S3).**
- `rate-limit.mjs` exportiert `parseTrustedProxies(text: string): (address: string) => boolean`. Die Eingabe ist eine kommagetrennte Liste aus IPv4/IPv6-Adressen mit optionalem `/prefix`.
  - Abgelehnt mit Fehler und Hinweis werden: `1`, `true`, leere Einträge, Zonen-IDs, Präfix 0, Präfix über 32 bzw. 128 und gesetzte Host-Bits jenseits des Präfixes.
  - IPv4-mapped-Adressen (`::ffff:a.b.c.d`) werden wie IPv4 verglichen.
- `sourceOf(request, { trustedProxy })`: `trustedProxy` ist `false` oder ein Matcher. XFF (letzter Eintrag) zählt nur, wenn `socket.remoteAddress` passt. Kommt XFF von einem nicht vertrauten Gegenüber, schreibt der Server einmalig nach stderr: `Ignoring X-Forwarded-For from untrusted peer <adresse>` (nur die Adresse, als Diagnose für die Konfiguration).
- `createSyncServer({ trustedProxy: false | string })`: Ein String wird geparst, `true` wird abgelehnt.
- Tests: Spoofing von einem fremden Socket ergibt die Socket-Quelle. CIDR v4 und v6, mapped v4 und Ablehnung von `1`.

**T1-6 Passwortraten (S4a).**
- `DEFAULT_LIMITS.loginFailuresGlobal` entfällt. Neu ist `passwordFailuresGlobal: 20` mit festem Fenster `600_000` ms. Das Fenster beginnt mit dem ersten Fehlschlag nach Ablauf des vorigen.
- Gezählt werden **nur** scrypt-Fehlvergleiche in `verifyPassword` (Passwort oder Name falsch), keine Formfehler.
- Bei `count >= 20` antwortet `verifyPassword` für alle Quellen mit 429 und `retryAfter` bis zum Fensterende, und zwar vor scrypt. Backoff und Formfehler-Zählung je Quelle bleiben.
- Ein Neustart setzt den Zähler zurück (dokumentieren).
- Tests: 20 Fehlschläge aus 20 verschiedenen Quellen, danach ergibt das richtige Passwort aus einer neuen Quelle 429. Nach Fensterende (Clock) ergibt es 201.

**T1-7 Offline-Befehle (S5).**
- `node server/main.mjs list-devices` gibt je Gerät eine Zeile aus: `id`, `name`, `enrolledAt` (ISO), `revokedAt` (ISO oder `-`), dazu `ephemeral` nur bei RAM-Geräten (offline: keine).
- `node server/main.mjs revoke-device <hex64>` widerruft über `createDeviceRoster(...).revoke` (derselbe atomare Pfad). Unbekannte ID: Exit-Code 1 mit Meldung.
- Beide Befehle: `process.argv.length <= 4`, dieselbe Prüfung des Datenverzeichnisses wie `serve`, und sie laufen nur bei gestopptem Server (README).
- Schutz gegen einen parallel laufenden Server (K19): `device-roster.mjs` `write()` prüft vor dem `rename`, ob die Datei auf der Platte noch den Hash hat, den der Prozess geladen oder zuletzt geschrieben hat. Weicht er ab, wird `uncertain` gesetzt, und es folgt 503. Fremde Änderungen werden nie überschrieben.

**T1-8 Startpflege (S6).**
- Beim Start werden in `objects/` die Dateien `^[a-f0-9]{32}\.(tmp|devices-tmp|access-tmp)$` und im Datenverzeichnis (`server/main.mjs`) die Dateien `^[a-f0-9]{32}\.(account-tmp|password-setup)$` gelöscht, wenn ihre mtime älter als 1 h ist. Das geschieht vor der 256-Dateien-Prüfung.
- Ein `.blob` mit falschem Hash, falscher Hülle oder falschem Modus bzw. `nlink` wird übersprungen (nicht in `objects`, zählt nicht zur Quota). Der Server schreibt nach stderr `Skipping unreadable object <dateiname>`, nie den Inhalt.
- Quota-Überschreitung nach dem Laden bleibt fatal.

**T1-9 Konto-Einrichtung (S4b, S10, B6).**
- `account-init.mjs`:
  - Ein eigenes Passwort braucht ≥ 20 Zeichen (Prompt „mindestens 20 Zeichen“).
  - Ein generiertes Passwort geht nie nach stdout. Es wird atomar (tmp `wx 0600`, fsync, rename) nach `join(dirname(target), 'initial-password.txt')` geschrieben. Ausgegeben wird nur: `Serverpasswort liegt in <pfad> (nur für dich lesbar). Die Datei wird nach der ersten Geräteanmeldung gelöscht.`
  - `server.json` bzw. die Setup-Datei bekommt `passwordPolicy: 'generated' | 'custom'`.
- `createAccount` behält die Untergrenze 12 (Tests und Fixtures).
- `readConfig` akzeptiert die Schlüsselmengen `account,namespace,serverId` und `account,namespace,passwordPolicy,serverId` (Wert aus der Menge).
- `replaceAccount(dataDirectory, account, passwordPolicy?)` übernimmt die Policy. `rotate-password` liest sie aus der Setup-Datei.
- `startServer` gibt nur `account`, `serverId` und `namespace` an `createSyncServer` weiter. Fehlt `passwordPolicy`, schreibt `serve` nach stderr: `Warning: this account predates the H3.1 password policy; its password may be shorter than 20 characters. Run rotate-password.`
- `createSyncServer({ initialPasswordFile = null })`: Nach jeder erfolgreichen Einschreibung (201/200) folgt `unlink` als best effort (ENOENT und andere Fehler werden ignoriert). `startServer` setzt `join(dataDirectory, 'initial-password.txt')`.

**T1-10 `serve`-Konfiguration (R-H31-3, S3, K2, K13).**
- `SHELLHERD_SERVER_ORIGIN` ist Pflicht, mit oder ohne abschließenden Slash. Die Normalisierung folgt T1-2. Fehlt sie oder ist sie ungültig, startet der Server nicht.
- `SHELLHERD_SERVER_TRUSTED_PROXY` ist optional und wird über `parseTrustedProxies` gelesen.
- `SHELLHERD_SERVER_PUBLIC_URL` gesetzt: Startfehler mit dem Hinweis „use SHELLHERD_SERVER_ORIGIN“.
- Konfigurationsfehler tragen eine `hint`-Eigenschaft. Der `catch` in `main()` gibt sie aus, statt der Sammelmeldung. Alle Server-Logs sind englisch, wie bisher.
- `startServer({ …, origin = null, trustedProxy = false })` reicht beides durch.

**T1-11 Robustes `send` (S9).** `if (response.destroyed || response.headersSent || response.writableEnded) return;` und die Handler-Kette endet mit `.catch(…).catch(() => {})`.

**T1-12 Transport-Timeouts (C7).**
- `boundedJson(url, options, maxBytes, timeoutMs = 5000)`.
- `AccountStore.put` übergibt `Math.min(30_000, 5_000 + 1_000 * Math.ceil(Buffer.byteLength(wire) / 65_536))`, `AccountStore.get` übergibt 21_000 (Obergrenze für 1 MiB). Alle anderen Requests behalten 5 s.

**T1-13 Rendezvous-Client (V10).**
- `RendezvousPeer.forget(sessionId: string): void` entfernt den Eintrag aus `#requests` (unbekannte ID: no-op).
- Bei vollem `#requests` wirft `request()` `Object.assign(new Error('Rendezvous request limit'), { status: 429 })`.
- Tests: `forget` gibt einen Platz frei, und der 17. Request trägt `status === 429`.

**T1-14 Container-Check (B3).** `scripts/check-server-container.mjs`:
- Vor jedem `start()` holt das Skript einen freien Port (`net.createServer().listen(0, '127.0.0.1')`, dann schließen) und startet mit `-p 127.0.0.1:<port>:8787 -e SHELLHERD_SERVER_ORIGIN=http://127.0.0.1:<port>`.
- `docker compose … config` läuft mit `env: { ...process.env, SHELLHERD_SERVER_ORIGIN: 'https://shellherd.example.org' }`. Dazu kommt eine Assertion, dass `SHELLHERD_SERVER_TRUSTED_PROXY` das Gateway des festen Projektnetzes ist.
- Gerätenamen: `'synthetic-device-' + n` (n = laufende Nummer).

**T1-15 Compose, Dockerfile, README (S3, S7, B4).**
- `server/compose.yaml`:
  - `networks.default.ipam.config: [{ subnet: 172.31.87.0/24, gateway: 172.31.87.1 }]`;
  - `SHELLHERD_SERVER_TRUSTED_PROXY: "172.31.87.1"`;
  - `SHELLHERD_SERVER_ORIGIN: ${SHELLHERD_SERVER_ORIGIN:?Öffentliche Origin setzen, z. B. https://sync.example.home}`.
- `compose.wireguard.yaml`: dieselbe Origin-Pflicht, kein Proxy.
- Dockerfile: `device-name.mjs` aufnehmen.
- `server/README.md` angleichen:
  - Sitzungs-Backoff (10 freie Versuche, danach bis 60 s, getrennt vom Passwort), `deviceWrites` auch für `DELETE`, Verbindungs- und Nebenläufigkeitslimits, neue Variablen;
  - Hinweis auf Docker Engine ≥ 28 (direct routing) und darauf, dass lokale Prozesse über `127.0.0.1:8787` als Gateway gelten;
  - globale Passwortsperre, die ein Neustart aufhebt;
  - Ablauf nach Passwortleck: Server stoppen, `rotate-password`, `list-devices`, unbekannte Geräte mit `revoke-device` widerrufen, Server starten;
  - Upgrade-Schritt aus E5 und das Lesen von `initial-password.txt` nur mit `--rm`.

**T1-16 Aufräumen (A4).** `scripts/sync-prototype/device-enrollment.mjs` löschen.

### 2.2 T2 Sync-Kern (Welle 1)

Alle Signaturänderungen sind abwärtskompatibel (B11). Neue `SyncFailure`-Codes in `vault-sync-crypto.ts`: `'foreignKey' | 'otherServer' | 'platform'`. Bis T5 sie abbildet, landen sie im Host als `connection` (`Object.hasOwn(syncCodes, …)` ist dann false). Das ist für Welle 1 zulässig.

**T2-1 C3/C4 wörtlich nach `sync.md`.**
- `abortBootstrap(own: string, uploaded: string[] = [])` entfernt `own` und `uploaded` (jeweils `try { await remote.remove?.(id) } catch {}`), danach `await checkpoint!.remove()` und `throw new SyncFailure('syncKey')`. `versionsHeld` entfällt.
- Wiederholungspfad (`stateIn.keybox`) exakt wie der Codeblock in C4: `old` zuerst entfernen (nur, wenn `listing.includes(old)`; ohne `remove` wird `old` in `allowed` toleriert), dann neue Markierung, `put`, `confirmKeybox` mit `allowed = acked ∪ graphIn`-Schlüssel (ohne `old`), und bei Misserfolg `abortBootstrap(id, [...graphIn.values.keys()].filter(v => listing.includes(v)))`.
- Erstpfad: `abortBootstrap(id)`.
- Tests (aus `sync.md`): „R1 fixed“, „R2 fixed“, „own uploaded versions are taken back“. Der Test `vault-sync.test.ts:320-328` wird umgedreht: kein Checkpoint, keine Objekte von A.

**T2-2 `regenerateRecoveryCode` (C2/A1/R-H31-7).**
- Vor dem `put` werden alle gelisteten Objekte geholt. Liegt ein Versionsumschlag vor, der sich unter `versionKey(checkpointKey(raw))` nicht öffnen lässt (Probe wie `removeForeignObjects:426`), folgt `throw new SyncFailure('foreignKey')`, ohne `put` und ohne `remove`.
- Nach dem ersten erfolgreichen `remove` eines alten Keybox-Objekts wird `check()` nicht mehr aufgerufen. Das letzte `checkpoint.write` läuft mit `{ ignoreAbort: true }` (K12).
- Test: fremde Keybox plus unlesbare Version ergibt `foreignKey`, und beide Objekte bleiben erhalten. Ein Abbruch nach dem ersten `remove` liefert trotzdem den Code.

**T2-3 `removeForeignObjects(sessions, remote, context, candidates, signal, options: { versions?: boolean } = {})`.**
- Altformat-Objekte (`parseSyncEnvelope(wire) === null`) werden immer gelöscht.
- Unlesbare Versionsumschläge nur bei `options.versions === true`.
- Keyboxen und lesbare Versionen nie.
- Tests für beide Modi.

**T2-4 R3.**
- `StateFile.write(value: unknown, options?: { ignoreAbort?: boolean }): Promise<void>`. Bei `ignoreAbort` entfallen die beiden `check()`-Aufrufe in `write`, der `expected`-Hashvergleich bleibt.
- `settle()` schreibt mit `{ ignoreAbort: true }`, danach folgt kein `check()` mehr bis zum `return`.
- Test: Abbruch während `settle` (Signal nach dem Entfernen der Markierung), das Ergebnis enthält `recoveryCode`.

**T2-5 C5.**
- Neu ist `src/shared/vault-password.ts` mit `export const VAULT_PASSWORD_MIN_LENGTH = 8;`.
- `importSyncedVault`: `ensure(newPassword.length >= VAULT_PASSWORD_MIN_LENGTH && newPassword.length <= 1024, 'wrongVault')` steht vor jedem `remote`-Aufruf.
- Test: Mit 7 Zeichen kommt `wrongVault`, und `list` wurde nie aufgerufen.

**T2-6 C6 Sperrdatei.**
- Inhalt: `JSON.stringify({ pid: process.pid, boot, at: Date.now() })`. `boot` stammt aus `/proc/sys/kernel/random/boot_id` (getrimmt, bei Fehler `''`).
- Bei `EEXIST` wird gelesen: Inhalt und `lstat` (Datei, kein Symlink, `nlink === 1`).
- Verwaist ist die Sperre in diesen Fällen:
  - Der Inhalt ist unlesbar oder leer (Altformat), und die mtime ist älter als 10 min.
  - `boot` ist auf beiden Seiten nicht leer und weicht ab.
  - `pid !== process.pid`, und `process.kill(pid, 0)` wirft `ESRCH`.
  - `pid !== process.pid`, und die mtime ist älter als 10 min.
- `pid === process.pid` gilt nie als verwaist.
- Übernahme: erneut lesen. Sind Inhalt und mtime identisch, folgen `unlink` und noch einmal `open(lockPath, 'wx')`. `EEXIST` ergibt dann `recovery`. Das Restrennen ist durch den Single-Instance-Lock und den `expected`-Hash abgedeckt (E10).
- Tests:
  - Fremde PID, die nicht mehr lebt: der Lauf geht durch.
  - Fremde Boot-ID: der Lauf geht durch.
  - Eigene PID: `recovery`.
  - Eine frische, leere Sperre ergibt `recovery`, eine 11 min alte leere Sperre wird übernommen. Der bestehende Test `:23-29` erwartet jetzt JSON statt `''`.

**T2-7 C8 Checkpoint-Format.**
- Geschrieben wird immer `['shellherd-private-sync-state-v3', { serverId, namespace }, sealed]`.
- Lesen:
  - `v1` ergibt `migrate`.
  - `v2` (zweistellig) wird wie bisher gelesen.
  - `v3`: Ist der Klartext-Kontext ungleich `bound(context)`, folgt **vor** dem Entschlüsseln `otherServer`, sonst wird entschlüsselt.
- Tests: Kontextwechsel ergibt `otherServer`, `v2` bleibt lesbar, und der Test „writes the v2 outer tag“ wird auf v3 umgestellt.

**T2-8 C9.** Die Historienprüfung (`Graph.validate` `:107` und `pull` `:200`) nutzt `compacted` statt `compactedAll`. Der Test `vault-sync.test.ts:449` wird umgedreht: Eine zurückgehaltene Kompaktierung entschuldigt eine fehlende bestätigte Version nicht mehr, das ergibt `history`.

**T2-9 C10.** In `importSyncedVault` öffnet ein Vorlauf alle lesbaren Versionsumschläge. `vaultId` ist die `portable.document.id` der Version mit dem größten `author.at` (fehlend gilt als −1). Bei Gleichstand gewinnt die kleinere Objekt-ID (String-Vergleich). Danach folgt `new Graph(key, context, vaultId)`. Test: Bei zwei Vaults unter einem Schlüssel wählt der Import unabhängig von der Listenreihenfolge immer denselben.

**T2-10 A2.** Die vier `ensure(process.platform === 'linux', 'limit')` werden zu `'platform'`.

### 2.3 T3 Fernansicht (Welle 1)

**T3-1 V1.**
- Host (`#consume`): Je Sitzung zählt `s.messages` die vollständigen Nachrichten. Trifft nach der ersten vollständigen Nachricht noch irgendein Part ein, folgt `#end(s, 'failed')` **vor** dem `emit`. Das gilt für Viewer (Angebot) und Agent (Antwort).
- Renderer (`remote-peer.ts`): Kommt beim Viewer nach dem ersten verarbeiteten Angebot eine weitere vollständige Nachricht, folgt `fail(local, 'signal')`. Es wird keine zweite `RTCPeerConnection` angelegt (K4).
- Tests auf beiden Seiten.

**T3-2 V2.**
- `Sess.acked: boolean`.
- `#stopped(owner, id)`: Fehlt ein Pending-Eintrag, aber `this.#session` hat dieselbe `id`, `owner`, `role === 'agent'`, `captured` und ist nicht `ended`, dann gilt `s.acked = true` mit Antwort ok.
- `#end` legt den Notbremsen-Timer nur bei `captured && !acked` an.
- Test: `accept` ergibt `stale` nach der Zustimmung, dann ein früher Beleg, dann die Deadline. `emergency` wird nie aufgerufen.

**T3-3 V4 (K5).**
- Agent: `pc.addTransceiver(track, { direction: 'sendonly', streams: [stream] })` statt `addTrack`.
- Viewer: kein `addTransceiver` vor `setRemoteDescription`. Danach wird für jeden Transceiver vor `createAnswer` `direction = 'recvonly'` gesetzt.
- `checkSdp(sdp, kind)`: Die Zeilen, die auf `/^a=(sendrecv|sendonly|recvonly|inactive)$/` passen, müssen **genau eine** sein, beim Angebot `a=sendonly`, bei der Antwort `a=recvonly`. Sonst folgt `fail('direction')`.
- Fixtures in `remote-signal.test.ts` und `remote-peer.test.ts` bekommen die Richtungszeile. Neue Tests: `sendrecv`, `inactive`, zwei Richtungszeilen und die falsche Richtung je Art.

**T3-4 V7.**
- Lokale Konstanten in `lab-host.ts`: `BRAKE_COUNT = 3`, `BRAKE_WINDOW_MS = 600_000` (`remote-lab.ts` gehört in Welle 1 niemandem).
- `Online.refusals: number[]`. `#end` einer Agent-Sitzung mit Grund `declined` oder `expired`, deren Gegenseite weder `s.verified` noch `known.verified` ist, trägt `now` ein.
- Liegen mindestens 3 Einträge innerhalb des Fensters, verwirft `#onSessions` jede Anfrage eines nicht geprüften Geräts: `#markProcessed`, `#delete` und `mutedCount++`, ohne Sitzung.
- Ein neues `goOnline` erzeugt ein neues `Online`, das setzt die Bremse zurück.
- Tests: Die Bremse greift nach drei Ablehnungen, nimmt geprüfte Pins aus, und `goOnline` setzt zurück.

**T3-5 V9.**
- `RemoteLabHost` bekommt `get stopsPending(): boolean` und `onStopsSettled(listener: () => void): () => void`. Das Ereignis feuert, wenn `#pendingStops` leer wird (`#stopped`, Notbremse **nach** `deps.emergency(owner)`, `closeOwner`).
- `src/main/index.ts` (nur der Schutzblock `:271-290`):
  - `maybeUnprotect()` hebt den Schutz nur auf, wenn `!remoteLabHost.sharing && !remoteLabHost.stopsPending`;
  - Aufruf bei `onSharingChange(false)`, bei `onStopsSettled` und als Rückfall-Timer nach `REMOTE_LAB_LIMITS.byeMs + 1000`;
  - Solange Stopps ausstehen, bleibt der Schutz bestehen (fail-closed).
- Test am Host: Das Ereignis kommt nach dem Beleg und nach der Notbremse, mit der Reihenfolge `emergency` vor `settled`.

**T3-6 V10.**
- `RemotePeer` (Interface in `lab-host.ts`) bekommt `forget(sessionId: string): void`.
- `#end` ruft bei `role === 'viewer' && !s.channel` `this.#online?.peer.forget(s.id)` auf, im `try/catch`.
- Test-Fakes ergänzen. Die Abbildung 429 → `limit` gibt es schon (`#request`).

### 2.4 T4 Paket (Welle 1, E1)

- `scripts/linux-after-pack.cjs` flippt die Fuses über `await context.packager.addElectronFuses(context, config)`. Die Enums kommen aus `await import('@electron/fuses')` (`FuseVersion.V1`, `FuseV1Options`).
  - linux: `RunAsNode: false`, `EnableNodeOptionsEnvironmentVariable: false`;
  - win32: `EnableNodeOptionsEnvironmentVariable: false`.
  - Das bestehende AppRun-Schreiben bleibt.
- `electron-builder.yml` bekommt **kein** `electronFuses`, nur einen Kommentar mit Verweis auf das Hook und auf die offenen H4-Fuses (`enableNodeCliInspectArguments`, `enableEmbeddedAsarIntegrityValidation`, `onlyLoadAppFromAsar`).
- `scripts/smoke-linux.mjs`:
  1. `electron.launch` mit `env: { …, SHELLHERD_SYNC_LAB: '1', SHELLHERD_REMOTE_LAB: '1', SHELLHERD_REMOTE_CAPTURE_FAKE: '1' }`. Geprüft wird `window.desktopApi.syncLabEnabled === false`, `remoteLabEnabled === false` und `remoteCaptureFake === false`. Die bisherigen Prüfungen bleiben.
  2. RunAsNode-Probe: `spawn(executablePath, ['-e', 'process.exit(7)'], { env: { …, ELECTRON_RUN_AS_NODE: '1', XDG_CONFIG_HOME: <tmp> } })`, ohne weitere Argumente vor `-e`. Nach höchstens 15 s wird mit `SIGKILL` beendet. Erwartet wird ein Exit-Code ungleich 7.
  3. NODE_OPTIONS-Probe: Start mit `NODE_OPTIONS=--require=<tmp>/marker.cjs`, wobei `marker.cjs` eine Datei schreibt, und eigenem `XDG_CONFIG_HOME`. Nach 10 s wird beendet. Erwartet wird, dass die Markerdatei fehlt.
- T4 baut lokal `npx electron-builder --linux --dir --x64 --publish never` und lässt `xvfb-run -a node scripts/smoke-linux.mjs` und `xvfb-run -a node scripts/toolbar-smoke.mjs` grün laufen. Ist kein Build möglich, steht das als offener Punkt im Report.

### 2.5 T5 Sync-App-Fläche (Welle 2)

- **C1 (App):**
  - `signIn` akzeptiert `confirmElsewhere: z.literal(true).optional()`. Bei gesetztem `enrolledElsewhere` ohne Bestätigung antwortet es `{ ok: false, code: 'enrolledElsewhere' }`, und es geht kein Netzaufruf hinaus.
  - Dialog: Warntext `syncLab:enrolledElsewhere` und Checkbox `syncLab:enrolledElsewhereConfirm`. Erst die Checkbox schaltet „Gerät anmelden“ frei und sendet `confirmElsewhere: true`.
  - Der Host nutzt die Identitäts-API aus §2.6 (`enrollment(serverId, serverUrl)`, `enrolledElsewhere(serverId, serverUrl)`, `forgetEnrollment(serverId, serverUrl)`).
- **C2:**
  - `regenerateCode` verlangt `confirmed: z.literal(true)`.
  - Der Dialog zeigt vor dem Senden eine Rückfrage (`recoveryCodeRegenerateConfirm`, Knöpfe `recoveryCodeRegenerateYes` / `common:cancel`).
  - Die Abbildung `foreignKey → 'syncForeignKey'` kommt dazu.
- **B8:**
  - `removeForeign` nimmt `versions: z.literal(true).optional()` an.
  - Im Dialog gibt es die Checkbox `removeForeignVersions` mit dem Hinweis `removeForeignVersionsHint`.
  - `lab-ipc.ts` reicht `{ versions: request.versions === true }` an `removeForeignObjects` weiter.
- **R4:** `#renew` und `#roster` in `performSync` laufen in einem eigenen `try`. Ein Fehler geht über `#failed` (429 → `limit`). `syncLimit` bleibt nur für 429/507 aus dem eigentlichen Abgleich.
- **C5:**
  - `importVault.password` mit `.min(VAULT_PASSWORD_MIN_LENGTH)`.
  - `importReady` verlangt `password.length >= VAULT_PASSWORD_MIN_LENGTH`.
  - Bei kürzerer, nicht leerer Eingabe zeigt der Dialog `app:errors.passwordTooShort`.
  - `App.tsx:388` nutzt dieselbe Konstante (nur diese Zeile).
- **C8, A2:** Abbildungen `otherServer → 'syncOtherServer'` und `platform → 'syncPlatform'`.
- **A4:**
  - Entfernt werden `#active`, `request()`-Zweige `start/confirm/resolve`, `authorize()`, `createDriver`, `createEnrollment`, `LabDriver`, `EnrollmentDriver` und der Stub in `lab-ipc.ts:29`.
  - Neue Konstruktor-Reihenfolge: `(probe, createAccount, syncVault, matchesVaultPassword, identity)`. `enabled = Boolean(probe && createAccount && identity)`. `status` und `close` bleiben.
  - `shared/sync-lab.ts`: Phasen nur noch `'idle' | 'serverReady'`. Es entfallen `SyncLabRole`, `enrollment`, `sessionId`, `revision`, `expiresAt`, `peers`, `conflicts`, `preservedIndependentChanges`, die Request-Arten `start`, `requestAccess`, `refreshAccess`, `confirm`, `resolve` und die Codes `mismatch`, `expired`, `failed` samt Locale-Keys.
  - Die zehn CSS-Klassen aus A4 entfallen.
  - Dispatcher (K16): `z.object({ kind: z.enum([...alle gültigen kinds]) }).passthrough()`. Scheitert die Prüfung, kommt `{ ok: false, code: 'invalid' }`.
- **A9:** `IPC_CHANNELS.syncLabAction = 'sync-lab:action'` wird in `lab-ipc.ts` und `preload` verwendet. Die Kommentare in `shared/ipc.ts:217,220` werden korrigiert.
- **R-H31-4:**
  - `sync-prototype/lab-host.ts` ersetzt `DEVICE_NAME` durch `isDeviceName`.
  - `enrollReady` nutzt `isDeviceName(normalizeDeviceName(name))`, und der Dialog sendet `normalizeDeviceName(deviceName)`.
  - Eingabe `maxLength={64}`, darunter der Hinweis `syncLab:deviceNameHint`.
- **Locales:** alle Keys aus §5 (de-DE und en-US), auch die für T6.
- Tests: Host (`enrolledElsewhere` ohne und mit Bestätigung, `confirmed`, `versions`, R4 `limit`, Codes, A4 `invalid` für `start`), `sync-lab-view` (Name, Passwortlänge), Dialog (Checkbox, Rückfrage).

### 2.6 T6 Fernansicht-App-Fläche (Welle 2)

`src/main/remote/identity.ts`, wörtlich:

```ts
/** Entry with the same serverId whose stored serverUrl has the same origin as serverUrl. */
enrollment(serverId: string, serverUrl: string): Enrollment | undefined
/** serverUrl of another entry with the same serverId but a different origin, else undefined. */
enrolledElsewhere(serverId: string, serverUrl: string): string | undefined
/** Replaces only the entry with the same serverId and origin; keeps at most 16 (oldest enrolledAt drops). */
rememberEnrollment(e: Enrollment): void
forgetEnrollment(serverId: string, serverUrl: string): void
```

- Für den Origin-Vergleich gilt `new URL(x).origin` in `try/catch`, ein Fehler zählt als ungleich.
- Dateiformat, MAC und Schema bleiben unverändert, auch `MAX_NAME = 80` für das Lesen alter Dateien.
- Tests: zwei Einträge mit derselben `serverId` und verschiedener Origin koexistieren, `forget` trifft nur einen, und `enrolledElsewhere` liefert den anderen.

Weitere Pflichten:
- `remote/lab-host.ts`:
  - `deviceSchema.name` nutzt `isDeviceName`. Ungültige Geräte werden verworfen (sie erscheinen nicht und lösen keine Sitzung aus).
  - `NAME` wird durch `isDeviceName` ersetzt.
  - `#connect` nutzt die neue API.
  - `#signIn` mit `confirmElsewhere` folgt derselben Regel wie Sync (K29) und liefert den Code `'enrolledElsewhere'`.
  - `forgetEnrollment(info.serverId, info.serverUrl)`.
- `shared/remote-lab.ts`:
  - `RemoteErrorCode` bekommt `'enrolledElsewhere'`;
  - `signIn` bekommt `confirmElsewhere?: true`;
  - `REMOTE_LAB_LIMITS.deviceName = 64`.
- `RemoteLabDialog.tsx`:
  - `isDeviceName(normalizeDeviceName(...))`, `maxLength={64}` und der Hinweis `remoteLab:deviceNameHint`;
  - Checkbox `remoteLab:enrolledElsewhereConfirm` bei `enrolledElsewhere`;
  - Fehlertext `remoteLab:errors.enrolledElsewhere`.
- Die renderer-seitige Fehlermap (`src/renderer/src/remote-lab.ts`, `satisfies Record<RemoteErrorCode, …>`) wird ergänzt.
- `remote/lab-ipc.ts` ändert T6 nur, falls nötig.

### 2.7 T7 Doku (Welle 3)

- `docs/plans/selfhosted-threat-model.md`:
  - Kopf „Stand: 2026-11-10 (H3.1)“, `:190-192` als historisch (vor H3) markieren, `:110` als „noch nicht erfüllt (Roster vom Server)“ markieren;
  - S1-Hinweis (Limit je Adresse hinter Proxy durch Nebenläufigkeit je Quelle ersetzt), C9-Satz, C12/R-H31-8 (100.64/10 nur Tailscale, Risiko bei Provider-CGNAT);
  - C1 Origin-Bindung, S4 globale Sperre (Besitzer kann ausgesperrt werden, Neustart hebt auf), R-H31-7;
  - Restrisiken: Homoglyphen außerhalb der Tabelle, Inspect-Fuse offen.
- `docs/plans/selfhosted-protocol.md`: neue Tags, 8-Tupel, Origin in Sitzung und Widerruf, Nonce-Format, `/v1/info.origin`, Roster v2, Checkpoint v3 (K25).
- `docs/handbuch.md` und `docs/manual.md`, abschnittsgleich:
  - Vorspann wie beim Fernzugriff (ungepackt, `SHELLHERD_SYNC_LAB=1`, nur Linux, keine Sicherheitsfreigabe);
  - Eintrag mit „(Entwicklung)“;
  - „Prüfung vor dem Senden, nur bei entsperrtem Vault“;
  - R-H31-7-Text, Gerätenamensregel, Bestätigung bei anderer Adresse, Opt-in für fremde Versionen und `syncOtherServer`.
- `scripts/sync-prototype/README.md` (verwaiste Sperre wird jetzt erkannt, `:65` anpassen, Origin, Variablen) und `.claude/skills/run-app/SKILL.md` (Szenen brauchen keine Origin-Variable, `server/main.mjs` schon, Offline-Befehle).

---

## 3. Korrekturen (bindend)

- **K1:** Szenen, Smoke und Tests starten den Server über `createSyncServer`/`startServer` mit `origin = null`. Damit gilt die Listen-Origin (`http://127.0.0.1:<port>`), und die Clients verbinden sich genau dorthin (`sync-scene.mjs:192`, `rendezvous.mjs:15`, `remote-scene.mjs:18`, `server/smoke.mjs:17-18`). `.claude/skills/run-app/{rendezvous,sync-scene}.mjs` brauchen **keine** Änderung und fallen aus T1. Pflicht ist die Variable nur in `server/main.mjs serve`.
- **K2:** `SHELLHERD_SERVER_PUBLIC_URL` entfällt in `main.mjs`. Ist sie gesetzt, gibt es einen Startfehler mit Hinweis (R-H31-3 „ausschließlich ORIGIN“). `createSyncServer.publicUrl` bleibt nur für den Legacy-Gerätemodus.
- **K3:** `/v1/info.origin` und die Origin-Prüfung in der Probe. Eine falsch konfigurierte Origin führt sofort zum vorhandenen Text `connection` („URL … prüfen“), statt später zu einem irreführenden `authentication`.
- **K4:** V1: Ein zweites Angebot führt beim Viewer zum Abbruch, statt zu „alte PC schließen, neue anlegen“. Das ist fail-closed und deckungsgleich mit dem Host.
- **K5:** V4: Ein `addTransceiver('video', recvonly)` des Viewers vor `setRemoteDescription` würde in Unified Plan einen zweiten, unbenutzten Transceiver erzeugen, weil Transceiver aus `addTransceiver` bei einem Remote-Angebot nicht zugeordnet werden. Richtig ist das Setzen der Richtung nach SRD. Chromium erzeugt auf ein `sendonly`-Angebot ohnehin eine `recvonly`-Antwort. Die Exaktprüfung bestätigt das in `remote-scene.mjs`.
- **K6:** V9 wird wie in T3-5 präzisiert, ohne erzwungenes Aufheben bei ausstehenden Stopps.
- **K7:** V7: Die Konstanten liegen lokal in `lab-host.ts`, ohne Änderung an `remote-lab.ts` in Welle 1.
- **K8:** V10: Das Limit trägt `status: 429` und wird so zu `limit`.
- **K9:** C6 wird um Boot-ID, mtime und Eigen-PID ergänzt (T2-6). Allein mit „PID lebt“ würde nach einem Neustart eine wiederverwendete PID die Sperre 10 min halten.
- **K10:** C7: Das Timeout richtet sich nach der Art des Requests. Ein großer `GET` ist größenabhängig, aber vorher unbekannt.
- **K11:** C8: Der Klartext-Kontext steht im äußeren Rahmen (v3). Nur so ist eine Unterscheidung vor dem Entschlüsseln möglich.
- **K12:** R3 und A1: `StateFile.write` bekommt `ignoreAbort`. Ohne das prüft `write` selbst das Abbruchsignal (`vault-sync-state.ts:45,50`), und „nicht mehr prüfen“ wäre wirkungslos.
- **K13:** Spezifische Startfehler werden ausgegeben. `main.mjs:75` verschluckt heute jede Ursache, die Spec verlangt aber „Fehler beim Start mit Hinweis“.
- **K14:** C5: Eine Konstante „wiederverwenden“ gibt es nicht (`App.tsx:388` hat ein Literal). Sie entsteht in `src/shared/vault-password.ts` (T2).
- **K15:** C10: „Neueste“ heißt das größte `author.at`, bei Gleichstand die kleinere ID.
- **K16:** A4: Der Dispatcher prüft die `kind`-Menge per `z.enum` und leitet danach weiter. Die strikten Schemata je Handler bleiben (keine doppelte Union).
- **K17:** S6: Die tatsächlichen Muster stehen in `server.mjs` und `main.mjs`, nicht in `file-store.mjs` (T1-8).
- **K18:** S3: festes Projektnetz `172.31.87.0/24` mit Gateway `.1` als Proxy-Quelle (docker-proxy und hairpin-NAT liefern beide das Gateway), dazu das Diagnose-Log für fremde XFF-Gegenüber.
- **K19:** S5: Erkennung paralleler Änderungen beim Roster-Schreiben. Ohne sie würde ein noch laufender Server einen Offline-Widerruf beim nächsten Schreiben still zurückdrehen.
- **K20:** S10: Pfad, atomares Schreiben, Löschpfad und README-Lesebefehl werden festgelegt (T1-9, T1-15).
- **K21:** R-H31-4 ist präzisiert:
  - Codepoints statt UTF-16-Einheiten.
  - Das Hex-Verbot gilt über NFKC, eine Homoglyphentabelle und auch über die erlaubten Trennzeichen hinweg. Sonst umgehen `3f9a 12c4`, Vollbreite oder Kyrillisch die Regel, denn `normalizeVerification` entfernt Leerraum.
  - Hangul-Füller sind ausgeschlossen (unsichtbare `\p{L}`).
  - Auf der Leitung gilt strikte NFC-Gleichheit, der Client normalisiert.
  - Die Identitätsdatei bleibt beim Lesen tolerant.
  - Folgen für Bestandstexte: Namen wie „Laptop-2024“ und die Szenen-Namen „Gerät A <base36>“ bleiben gültig. Ungültig werden Daten wie „20241110“ und Wortfolgen wie „Cafe Bad Deck“. Das ist hingenommen, der Hinweistext nennt es.
- **K22:** T2-Signaturen sind abwärtskompatibel (B11).
- **K23:** `regenerateCode` verlangt `confirmed: true` (wie `reviewed`/`compared`). Die Rückfrage lässt sich damit nicht umgehen, ohne den Request bewusst zu bauen.
- **K24:** R4 nutzt den vorhandenen Code `limit` (Text „Zu viele Anmeldeversuche … Warte kurz …“), keinen neuen.
- **K25:** `docs/plans/selfhosted-protocol.md` gehört zu T7, denn es beschreibt die geänderten Nachweise.
- **K26:** Die Nebenläufigkeit je Quelle ist über `limits.concurrentPerSource` konfigurierbar, damit parallele Tests nicht flackern.
- **K27:** Die globale Passwortsperre zählt nur echte Fehlvergleiche. Müll-Requests sperren den Besitzer also nicht billiger aus als falsche Passwörter.
- **K28:** C1 erhöht die Domänen-Tags. So kann ein alter Nachweis nie als neuer gelten.
- **K29:** Lücke in der Spec: Auch `#signIn` des Remote-Hosts übergeht `#elsewhere` (`remote/lab-host.ts:236-261`). Dieselbe Bestätigungsregel gilt dort (T6).
- **K30:** C2/A1: Nach dem ersten erfolgreich entfernten alten Keybox-Objekt prüft `regenerateRecoveryCode` kein Abbruchsignal mehr (T2-2). Sonst wäre der alte Code ungültig, ohne dass der neue je erscheint.

---

## 4. Entscheidungen (Rulings)

- **E1 Fuses (ersetzt R-H31-6 „jetzt“):**
  - Linux bekommt `RunAsNode` und `EnableNodeOptionsEnvironmentVariable` aus, Windows nur `EnableNodeOptionsEnvironmentVariable`, beides über das afterPack-Hook.
  - `EnableNodeCliInspectArguments` und die asar-Fuses gehen nach H4 (offene Punkte im PR).
  - Warum: B1 und B2.
  - Kosten, falls falsch: `--inspect` bleibt am signierten Binary bis H4 möglich.
- **E2 Origin-Vorgabe in der Bibliothek:**
  - `createSyncServer` übernimmt ohne `origin` die Listen-Origin, nur `main.mjs serve` erzwingt die Variable.
  - Warum: Tests, Szenen und Smoke laufen mit zufälligem Port auf Loopback.
  - Kosten: Ein eigener Startpfad ohne Origin würde Loopback binden. Das ist auf Loopback harmlos.
- **E3 Nonce-Format:** 64 Hex-Zeichen bleiben (T1-3). Die Client-Prüfungen bleiben unverändert.
- **E4 Ohne Verdrängung:** Ein voller Spent-Deckel führt zu 429 (B9).
- **E5 Roster-Version 2:**
  - `devices.json` mit `version: 1` führt zu einem Startfehler mit dem Hinweis `devices.json is from an older version: stop the server, move objects/devices.json away and re-enroll all devices (H3.1)`. Dasselbe gilt für `list-devices` und `revoke-device`.
  - Neue Dateien bekommen `version: 2`, das Schema bleibt sonst gleich.
  - Warum: B10 und R-H31-2.
  - Kosten: Jeder Lab-Server muss einmal neu einschreiben.
- **E6 Passwort-Marker:** `passwordPolicy` in `server.json`. Konten ohne Marker bekommen immer die Warnung (B6).
- **E7 Fremde Versionen:** Sie werden nur per Opt-in mit Warnung gelöscht (B8).
- **E8 Pins:** Die Pins sind über `(serverId, origin)` geschlüsselt, und Einträge anderer Origins bleiben nach einer bestätigten Neuanmeldung bestehen. Die echte Absicherung leistet die Origin-Bindung am Server, die Bestätigung ist zusätzlicher Schutz und Klarheit für den Nutzer.
- **E9 Namensregel:**
  - Es gilt die Regel aus T1-1, einschließlich Trennzeichen-Überbrückung und Homoglyphentabelle.
  - Kosten: Einzelne echte Namen (Datum mit 8 Ziffern, „Cafe Bad Deck“) werden abgelehnt, der Hinweistext erklärt die Regel.
- **E10 Restrennen bei der Lock-Übernahme:** Es wird hingenommen, denn der Single-Instance-Lock (`index.ts:237`) und der `expected`-Hash im Checkpoint verhindern stilles Überschreiben.
- **E11 Logs des Servers:** Sie bleiben englisch, wie bisher. Die interaktiven Prompts von `account-init` bleiben deutsch, wie bisher.
- **E12 Registrierungsnachweis (Rendezvous):** Er bleibt an `serverId` gebunden, ohne Origin. Er verlangt ein gültiges Token, und Tokens gibt es nach C1 nur noch bei der echten Origin.
- **E13 R3-Rest:** Beendet der Host die Verbindung zwischen `settle` und der Antwort (`#live` → `stale`), geht der Code verloren. Ausweg ist „Neuen Code erzeugen“. Das kommt in die Restrisiken, die zweiphasige Lösung geht nach H4.
- **E14 Hex-Hinweis im Prüfdialog:** Der Fernzugriff ergänzt `verify.hint` um „nie aus einem Gerätenamen“ (V3-Rest, nur Text).

---

## 5. Texte (wörtlich, de-DE / en-US; T5 legt alle an)

**`syncLab` (geändert):**
- `entry`:
  - „Selfhosted Sync einrichten (Entwicklung)“
  - “Set up self-hosted sync (development)”
- `enrolledElsewhere`:
  - „Dieses Gerät ist für diesen Server unter {{url}} angemeldet. Ein fremder Server kann sich als dein Server ausgeben, indem er dieselbe Server-ID meldet. Melde dieses Gerät hier nur an, wenn du sicher bist, dass beide Adressen zu deinem Server gehören.“
  - “This device is enrolled for this server at {{url}}. A foreign server can pose as your server by reporting the same server ID. Enroll this device here only if you are sure that both addresses belong to your server.”
- `recoveryCodeRegenerateHint`:
  - „Erzeugt einen neuen Code. Der alte Code öffnet die Keybox nicht mehr. Wer eine alte Kopie der Serverdaten und den alten Code hat, kann weiter lesen. Echter Schutz erst mit Schlüsselrotation (H4).“
  - “Generates a new code. The old code no longer opens the keybox. Anyone with an old copy of the server data and the old code can still read. Real protection only comes with key rotation (H4).”
- `removeForeignHint`:
  - „Entfernt Objekte aus einer älteren Lab-Version, die sich mit dem Sync-Schlüssel dieses Kontos nicht lesen lassen. Ein Serverkonto trägt genau einen Vault.“
  - “Removes objects from an older lab version that cannot be read with this account's sync key. A server account holds exactly one vault.”

**`syncLab` (neu):**
- `enrolledElsewhereConfirm`:
  - „Ich habe die Adresse geprüft und melde dieses Gerät hier neu an.“
  - “I have checked the address and enroll this device here again.”
- `recoveryCodeRegenerateConfirm`:
  - „Neuen Wiederherstellungscode erzeugen? Der bisherige Code öffnet die Keybox danach nicht mehr. Notiere den neuen Code sofort, er wird nur einmal angezeigt.“
  - “Generate a new recovery code? The previous code will no longer open the keybox. Write the new code down at once; it is shown only once.”
- `recoveryCodeRegenerateYes`:
  - „Neuen Code erzeugen“
  - “Generate new code”
- `removeForeignVersions`:
  - „Auch verschlüsselte Versionen entfernen, die mit einem anderen Sync-Schlüssel erstellt wurden“
  - “Also remove encrypted versions created with another sync key”
- `removeForeignVersionsHint`:
  - „Solche Versionen stammen von einem Gerät mit eigenem Sync-Schlüssel oder aus einer abgebrochenen Einrichtung. Ein Gerät, das noch mit diesem anderen Schlüssel abgleicht, verliert damit seine Serverhistorie. Sein lokaler Vault bleibt erhalten.“
  - “Such versions come from a device with its own sync key or from an aborted setup. A device that still syncs with that other key loses its server history. Its local vault is kept.”
- `deviceNameHint`:
  - „1–64 Zeichen: Buchstaben, Ziffern, Leerzeichen und - _ . , ( ) '. Keine Folge von 8 oder mehr Zeichen aus 0–9 und a–f, auch nicht durch Leerzeichen getrennt, weil sie wie ein Prüfcode aussieht.“
  - “1–64 characters: letters, digits, spaces and - _ . , ( ) '. No run of 8 or more characters from 0–9 and a–f, not even separated by spaces, because it looks like a verification code.”
- `errors.enrolledElsewhere`:
  - „Dieses Gerät ist für diesen Server unter einer anderen Adresse angemeldet. Bestätige die Neuanmeldung ausdrücklich.“
  - “This device is enrolled for this server at another address. Confirm the new enrollment explicitly.”
- `errors.syncForeignKey`:
  - „Im Konto liegen Daten eines anderen Sync-Schlüssels. Kläre erst, welches Gerät führt, und entferne die fremden Versionen. Es wurde kein neuer Code erzeugt.“
  - “The account holds data of another sync key. First decide which device leads and remove the foreign versions. No new code was generated.”
- `errors.syncOtherServer`:
  - „Der Sync-Zustand dieses Vaults gehört zu einem anderen Server. Es wurde nichts geändert. Um diesen Vault mit diesem Server zu verbinden, lösche die Datei „.sync-state“ neben dem Vault.“
  - “The sync state of this vault belongs to another server. Nothing was changed. To connect this vault to this server, delete the file “.sync-state” next to the vault.”
- `errors.syncPlatform`:
  - „Der Abgleich ist in diesem Entwicklungsstand nur unter Linux verfügbar.“
  - “In this development stage, synchronization is available on Linux only.”

**`syncLab` (entfernt):** `errors.mismatch`, `errors.expired`, `errors.failed`.

**`remoteLab` (geändert):**
- `enrolledElsewhere`: Text wie `syncLab:enrolledElsewhere` (de/en).
- `verify.hint`:
  - „Lies sie auf dem anderen Gerät unter „Fingerabdruck dieses Geräts“ ab, nie aus einem Gerätenamen.“
  - “Read them on the other device under “Fingerprint of this device”, never from a device name.”

**`remoteLab` (neu):** `enrolledElsewhereConfirm`, `deviceNameHint` und `errors.enrolledElsewhere`, je mit dem Text der gleichnamigen `syncLab`-Keys.

Wiederverwendet werden `common:cancel` und `app:errors.passwordTooShort`. Es gibt keine dynamischen Keys, und die Fehlermaps bleiben `satisfies Record<…>`.

---

## 6. Wellen und Tasks (ersetzt Spec §2)

Jede Task besitzt nur ihre Dateien, die Tests daneben gehören dazu. Es gibt keinen Commit durch Umsetzer. Nach jeder Welle müssen `npm run typecheck` und `npx vitest run` grün sein, danach kommt ein Commit je Task.

### Welle 1 (parallel, dateidisjunkt)

| Task | Dateien |
|---|---|
| **T1** Server, Transport, Namen | `scripts/sync-prototype/**` (inkl. neuem `device-name.mjs`, Löschen von `device-enrollment.mjs`, alle `*.test.mjs`, README-Abschnitte zu Server und Variablen), `server/**` (main, smoke, Dockerfile, beide Compose-Dateien, Caddyfile, README), `scripts/check-server-container.mjs`, `src/shared/device-name.ts`, `src/shared/device-name.test.ts`, **nur** der Testblock `src/main/sync-prototype/lab-host.test.ts:514-519` (löschen, B5) |
| **T2** Sync-Kern | `src/main/sync-prototype/{vault-sync,vault-sync-state,vault-sync-crypto,vault-merge}.ts` und deren Tests, neu `src/shared/vault-password.ts` |
| **T3** Fernansicht | `src/renderer/src/remote-peer.ts` (+Test), `src/shared/remote-signal.ts` (+Test), `src/main/remote/lab-host.ts` (+Test; ohne `deviceSchema`, `NAME`, `#connect`/`#signIn`-Pinlogik), `src/main/remote/presence.ts` (+Test, nur falls nötig), `src/main/index.ts` (nur der Schutzblock `:271-290`) |
| **T4** Paket | `scripts/linux-after-pack.cjs`, `electron-builder.yml` (nur Kommentar), `scripts/smoke-linux.mjs` |

### Welle 2 (parallel, dateidisjunkt; braucht Welle 1)

| Task | Dateien |
|---|---|
| **T5** Sync-App-Fläche | `src/main/sync-prototype/lab-host.ts` (+Test), `src/main/sync-prototype/lab-ipc.ts` (+Test), `src/shared/sync-lab.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/renderer/src/components/SyncLabDialog.tsx` (+Test), `src/renderer/src/sync-lab.css`, `src/renderer/src/sync-lab-view.ts` (+Test), `src/renderer/src/App.tsx` (nur `:388`), **alle** `src/shared/locales/**` |
| **T6** Remote-App-Fläche | `src/main/remote/identity.ts` (+Test), `src/main/remote/lab-host.ts` (+Test; `deviceSchema`, `NAME`, Pin-API, `#signIn`-Bestätigung), `src/main/remote/lab-ipc.ts` (+Test, nur falls nötig), `src/shared/remote-lab.ts`, `src/renderer/src/remote-lab.ts`, `src/renderer/src/components/RemoteLabDialog.tsx` (+Test), `src/renderer/src/remote-lab.css` (nur falls nötig) |

Abhängigkeiten: T5 liest die T2-Codes aus §2.2, die Identitäts-API aus §2.6 und `device-name.ts`/`vault-password.ts` aus Welle 1. T6 nutzt die Keys aus §5 (T5).

### Welle 3

| Task | Dateien |
|---|---|
| **T7** Doku | `docs/plans/selfhosted-threat-model.md`, `docs/plans/selfhosted-protocol.md`, `docs/handbuch.md`, `docs/manual.md`, `scripts/sync-prototype/README.md` (Rest), `.claude/skills/run-app/SKILL.md` |

### Abschluss (Lead)

- `node server/smoke.mjs` und, falls Docker verfügbar, `docker compose -f server/compose.yaml build && node scripts/check-server-container.mjs`.
- Szenen: `sync-scene.mjs` und `remote-scene.mjs` (Skill `run-app`). Die Remote-Szene belegt V4 mit echtem Chromium (Richtungen).
- Paket: `npx electron-builder --linux --dir --x64 --publish never`, `xvfb-run -a node scripts/smoke-linux.mjs`, `xvfb-run -a node scripts/toolbar-smoke.mjs`.
- Offene Punkte im PR:
  - E1-Rest (Inspect- und asar-Fuses nach einem Windows-Signaturtest);
  - Upgrade-Schritt E5 für bestehende Lab-Server;
  - E13.

---

## 7. Restrisiken (zur Kenntnis, keine Aufgabe)

- Die Homoglyphentabelle ist bewusst klein: Lateinische Lookalikes (`O`/`0`, `l`/`1`) und nicht-hex Trenn-Buchstaben („3f9a x 12c4“) bleiben möglich. Gegenmittel sind der Hinweis im Prüfdialog (E14) und der Fingerabdruck am anderen Gerät.
- Die globale Passwortsperre lässt sich mit 20 Requests je 10 min zum Aussperren des Besitzers nutzen (gewollt nach R-H31-5). Laufende Geräte sind nicht betroffen, ein Neustart hebt die Sperre auf.
- Lokale Prozesse auf dem Homeserver erreichen `127.0.0.1:8787` als Gateway-Quelle und dürfen damit XFF setzen. Abhilfe wäre eine Unix-Socket-Anbindung (H4).
- Der Code geht verloren, wenn der Host nach `settle` `stale` wird (E13).
- Das signierte Binary bleibt bis H4 über `--inspect` debugbar (E1).
