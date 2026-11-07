# Handoff: Selfhosting, Docker und Rendezvous

Erstellt am 2026-11-07 (Europe/Berlin). Letzte Implementierung und Laufzeittests
am 2026-11-06. Git-Arbeitsstand am 2026-11-07 erneut geprüft.

## Auftrag und gewünschtes Endergebnis

Der Benutzer möchte Shellherd um einen selbst betreibbaren Docker-Server
erweitern. Dieser soll verschlüsselte Verbindungsdaten/Vaults speichern und als
Rendezvous-Server für spätere Fernsteuerung ähnlich Dameware dienen. Der Benutzer
hat Planung und Umsetzung mit „okay lass uns das zuende führen … bauen go“
beauftragt. Eigenständig sinnvoll weiterarbeiten; nicht erneut fragen, ob die
bereits beauftragte Implementierung fortgesetzt werden soll.

Der zuletzt abgeschlossene Meilenstein ist ein funktionierender und tatsächlich
im Dockercontainer geprüfter Storage-/Signalisierungsserver. Die komplette
Fernsteuerung ist **noch nicht fertig**. Windows-/Linux-Agenten,
Bildschirmübertragung, Maus/Tastatur, NAT-Traversal und Medienrelay fehlen.
Dieser Unterschied wurde dem Benutzer ausdrücklich mitgeteilt.

Letzte Benutzeranweisung: Erkenntnisse und aktuellen Stand in einer Datei sichern
und einen Handoff-Prompt liefern, damit mit frischem Kontext weitergearbeitet
werden kann. Diese Datei ist diese Sicherung.

## Repository und verbindliche Git-Regeln

- Repository: `/home/pelmenipower/Projekte/Shellherd`.
- Remote: `https://github.com/pelmenipower/Shellherd.git`.
- Aktueller Branch: `feature/docker-rendezvous-server`.
- HEAD: `b2f7915` — `Add development password vault sync with crash recovery checks`.
- Ausgangsbranch dieser Arbeit: `feature/selfhosted-security-plan`.
- Der neue Branch wurde davon erstellt; die vorherige Sync-Implementierung ist
  also bereits enthalten. Ein späterer PR gegen `staging` kann auch diesen
  Vorgängercommit enthalten, solange er dort nicht integriert wurde.
- **Alle neuen Docker-/Rendezvous-Änderungen sind noch uncommitted.** Es wurde
  nichts gepusht, kein PR angelegt, nichts gemergt und nichts veröffentlicht.
- `git status` war vor dieser Handoff-Datei unverändert gegenüber dem letzten
  Implementierungsstand; keine zusätzlichen fremden Änderungen entdeckt.
- `AGENTS.md` lesen und beachten: niemals direkt auf `main` arbeiten/committen/
  pushen. Eigene Feature-/Fix-Branches verwenden. PRs nur gegen `staging`.
  Benutzer übernimmt sämtliche Merges. Keine Versionsänderungen, Tags oder
  Releases ohne ausdrücklichen Auftrag. Vor jedem Commit und Push Branch prüfen.
  Vorhandene Änderungen nicht verwerfen.
- App-Version unverändert `0.31.0`.
- Keine Subagents verwendet. Ohne ausdrücklichen Auftrag oder entsprechende
  lokale Anweisung nicht delegieren.

Historischer GitHub-Stand aus der Abfrage vom 2026-11-06, **nicht neu verifiziert**:
ein offener PR #40, `Kubernetes: direct cluster access without SSH`, Branch
`claude/feature/k8s-direct`, Ziel `staging`; keine offenen Issues. Daraus nicht
ableiten, dass dies im neuen Kontext noch der aktuelle GitHub-Stand ist.

## Bereits vorhandener Sync-Prototyp

Vor dieser Arbeit vorhanden und weiterverwendet:

- `scripts/sync-prototype/server.mjs`: Node-HTTP-Server für unveränderliche,
  SHA-256-adressierte verschlüsselte Objekte; privater Dateispeicher mit
  Formatprüfung, Limits, fsync und atomarem Rename.
- `account-auth.mjs`: Benutzername/Serverpasswort, gesalzener scrypt-Hash,
  kurzlebige Bearer-Sitzungen. Serverpasswort ist **nicht** das Vault-Passwort.
- `account-init.mjs`: interaktive Einrichtung mit verdeckter Passworteingabe.
- `account-transport.mjs`: `AccountStore` für Anmeldung und Ciphertext-Transport.
- `src/main/sync-prototype/`: manueller Linux-Dateisync, Import und Offline-Merge
  mit verschlüsseltem lokalem Zustand und Wiederanlaufnachweisen.
- Der Sync-Entwicklungsdialog ist nur im ungepackten Linux-Checkout mit
  `SHELLHERD_SYNC_LAB=1` aktiv. Gepackte Apps aktivieren ihn auch mit Flag nicht.
- Normaler Sync-Einstieg: Server-URL, Benutzername, Serverpasswort; **keine**
  manuelle Fingerprintprüfung oder separate Gerätefreigabe für diesen Weg.
- Die früheren Noise-/Geräte-ACL-/Pairing-Experimente bleiben davon getrennt.

Offene Sync-Themen: allgemeine Konfliktauflösung, lokale Pfad-/Aktionsfreigaben,
Historienkompaktierung, dauerhafte Anmeldung, Hintergrund-Sync, Windows-Dateisync,
Vault-Passwort-/KDF-Wechsel und vollständige lokale Recovery.

## Was neu implementiert wurde

### Separater Server und Container

- `server/main.mjs`: eigenständiger Servereinstieg ohne Electron und ohne
  npm-Laufzeitabhängigkeiten. Modi `init`, `serve`, `rotate-password`.
- Konfiguration in `<dataDirectory>/server.json`, exakt `account`, `serverId`,
  `namespace`. Private reguläre Datei, Modus 0600, keine Symlinks/Hardlinks,
  begrenzte Lesegröße. Übergeordnetes Datenverzeichnis privat, Modus 0700.
- Objektdateien unter `<dataDirectory>/objects`.
- Passwortrotation schreibt neue Kontokonfiguration atomar mit fsync und erhält
  Server-ID, Namespace und Vault-Objekte. **Nur bei gestopptem Server ausführen.**
- Standard lokal: `./server-data`, `127.0.0.1:8787`.
- Konfigurationsvariablen: `SHELLHERD_SERVER_DATA`, `SHELLHERD_SERVER_PORT`,
  `SHELLHERD_SERVER_HOST`, `SHELLHERD_SERVER_PUBLIC_URL`.
- `server/Dockerfile`: `node:22-bookworm-slim`, nur benötigte Module im Image,
  UID/GID 1000, `/data`, Healthcheck über `/v1/info`. Im Container Listener auf
  `0.0.0.0`, damit Portmapping funktioniert. Vorhandener Prototyp bleibt
  standardmäßig auf Loopback.
- `server/compose.yaml`: nicht privilegiert, read-only Root-Dateisystem,
  Capabilities entfernt, `no-new-privileges`, CPU-/RAM-/PID-Limits, begrenzte Logs,
  tmpfs und persistentes benanntes Volume. Host-Port nur `127.0.0.1:8787`.
- `.dockerignore`: enger Buildkontext; keine Vaults, Testdaten, node_modules oder
  sonstige Repository-Dateien ins Image kopieren.
- `server/Caddyfile.example`: Beispiel für HTTPS-Proxy auf demselben Host,
  Domain muss angepasst werden. Kein öffentliches Deployment eingerichtet;
  Zertifikat/DNS/externes TLS wurden nicht praktisch geprüft.
- `server/README.md`: Einrichtung, Schnittstelle, Grenzen, Rotation und
  Backup-/Restore-Kommandos. Eine Instanz pro Datenvolume; keine Replikate.

### Rendezvous und begrenzte Nachrichtenweiterleitung

- `scripts/sync-prototype/rendezvous.mjs`: kontoauthentifizierte Gerätepräsenz,
  Sitzungsanfrage, ausdrückliche Annahme am Ziel, Ablehnen/Beenden und begrenzte
  Weiterleitung opaker verschlüsselter Frames.
- Registrierung ist an die konkrete Anmeldung gebunden. Geräte-ID ist der
  SHA-256-Fingerprint des öffentlichen X25519-Schlüssels. Präsenz beweist allein
  noch keinen privaten Schlüsselbesitz; die E2EE-Prüfung erfolgt im Client.
- Im Registry-Zustand werden nur Session-Hashes gehalten, keine rohen Bearer-
  Tokens. Dazu wurde `accountAuth().isActive(key)` ergänzt.
- `server.mjs` aktiviert diese Endpunkte nur mit `rendezvous: true` und
  Passwortauthentifizierung. Der neue Standalone-Einstieg schaltet sie an;
  bisherige Prototyp-Aufrufer behalten standardmäßig die alte Funktionalität.
- `/v1/info` ist kompatibel und enthält zusätzlich `rendezvous: true/false`.
- Geräte-/Sitzungszustand und Warteschlangen nur im RAM; Neustart invalidiert
  Token, Präsenz und Sitzungen. Konto-Hash und Vault-Dateien bleiben bestehen.
- Beim nächsten Request werden abgelaufene oder widerrufene Anmeldungen,
  Präsenzen und zugehörige Sitzungen bereinigt.

API unter `/v1/rendezvous` (alle Endpunkte benötigen Bearer-Anmeldung):

| Methode/Pfad | Zweck |
| --- | --- |
| `PUT /devices` | `{name, publicKey}` registrieren oder Präsenz erneuern |
| `GET /devices` | Online-Geräte des gemeinsamen Kontos anzeigen |
| `DELETE /devices` | Eigenes Gerät und Sitzungen entfernen |
| `POST /sessions` | `{target, scope, nonce}`; frische 256-Bit-Anfragenonce als Hex |
| `GET /sessions` | Eigene eingehende/ausgehende Sitzungen |
| `GET /sessions/:id` | Eigene Sitzung lesen |
| `POST /sessions/:id/accept` | `{}`, ausschließlich Zielteilnehmer |
| `DELETE /sessions/:id` | Ablehnen oder beenden |
| `POST /sessions/:id/messages` | `{sequence, nonce, ciphertext, tag}` einstellen |
| `GET /sessions/:id/messages?after=N` | Nachrichten wiederholbar abrufen |
| `POST /sessions/:id/ack` | `{through: N}` quittieren |

Limits:

- Ein gemeinsames Serverkonto, **keine Mehrbenutzerverwaltung**.
- Passwortprüfung: scrypt N=131072, r=8, p=1; mindestens zwölf Zeichen bei Anlage.
- Maximal zehn Loginversuche pro Minute, eine parallele Passwortprüfung,
  32 RAM-Sitzungstoken, Tokenlaufzeit 15 Minuten.
- Ein Gerät pro Anmeldung, maximal 32 Geräte. Präsenzlease 60 Sekunden;
  Referenzbetrieb sollte spätestens alle 30 Sekunden erneuern.
- Anfragen 60 Sekunden; aktive Sitzungen fünf Minuten. Danach neue lokale
  Freigabe. `scope` ist `view` oder `control`.
- Vier Sitzungen pro Gerät, 64 insgesamt.
- Maximal 8 KiB verschlüsselter Inhalt pro Frame und 32 offene Frames/Richtung.
  Strenge Sequenzen; identische Retries der letzten 32 Frames auch nach ACK
  idempotent. Keine beliebigen Proxyziele und keine unbegrenzten Queues.
- Global 600 HTTP-Requests/Minute. Polling zunächst mit mindestens fünf Sekunden
  Intervall und wenigen aktiven Geräten. Dies ist **kein Video-/Medienrelay**.
- Bestehender Serverspeicher: 1 MiB pro Objekt, 100 Objekte, 32 MiB insgesamt.
  Clientseitige Sync-Historie ist separat auf 64 Versionen/12 MiB begrenzt.

### E2EE-Referenzclient

- `scripts/sync-prototype/rendezvous-client.mjs` exportiert
  `createRendezvousIdentity` und `RendezvousPeer` auf einem angemeldeten
  `AccountStore`.
- X25519, HKDF-SHA256, AES-256-GCM über Node-Standardbibliothek. Dies ist eine
  neue, begrenzte Referenzkomposition, **nicht** der vorhandene Noise-Kanal.
- Öffentliche Gegenstellenschlüssel müssen über einen unabhängig verglichenen
  vollständigen Fingerprint geprüft werden. Nicht blind der Serverliste trauen.
  Dies betrifft Fernzugriff; den einfacheren Konto-Sync nicht damit vermischen.
- Sitzung bindet Server-ID, Teilnehmer, Scope, ID und lokal erzeugte Anfragenonce.
  Das Ziel ergänzt bei Zustimmung eine weitere frische Nonce und daraus den
  eigentlichen Nachrichtenschlüssel. Richtung und Sequenz sind authentisiert.
- `peer.channel(session, peerPublicKey, expectedFingerprint, scope)` erstellt
  einen Kanal. Für Initiatoren muss die Anfrage im selben Peer lokal bekannt
  sein; eine Anfrage lässt sich nur einmal in einen Kanal übernehmen.
- `channel.accept()` nur nach lokaler Zustimmung am Ziel. Der Initiator muss
  zuerst mit `receive()` eine gültige verschlüsselte Annahme erhalten. Ein
  gefälschter Serverstatus reicht nicht für `send()`.
- `retry()` wiederholt einen nicht bestätigten Sendeversuch mit identischem
  Frame. Empfangene entschlüsselte Batches bleiben bis zum erfolgreichen ACK
  lokal gehalten, damit verlorene ACK-Antworten keine doppelte Lieferung erzeugen.
- `close()` beendet serverseitig; `dispose()` verwirft lokalen Schlüsselzustand.
- Lokale Identitäten bisher nur im RAM; kein produktiver Agent-Schlüsselspeicher.
- **Kein unabhängiger Review, keine Forward-Secrecy-Zusage bei späterem Verlust
  des statischen Geräteschlüssels.** Vor produktiven Desktopdaten Komposition
  unabhängig prüfen bzw. etablierte geprüfte Protokollimplementierung evaluieren.
- Der Server kann Metadaten sehen, Zustellung verhindern und Daten zurückhalten.
  Er soll ohne geprüfte Gegenstellenschlüssel keine Zustimmung/Daten fälschen
  können. Tests sind funktionale Nachweise, keine unabhängige Sicherheitsfreigabe.
- `view`/`control` sind gebunden, werden aber erst von einem zukünftigen Agenten
  als konkrete OS-Berechtigungen durchgesetzt. Aktuell keine OS-Steuerung.

## Geänderte/neue Dateien

Bereits vorhandene Dateien geändert:

- `.github/workflows/ci.yml`: Linux-CI führt zusätzlich lokalen Server-Smoke,
  Docker-Compose-Build und Container-Smoke aus. Workflow noch nicht auf GitHub
  ausgeführt; nur Syntax lokal als YAML geparst.
- `.gitignore`: `server-data/` ignoriert.
- `README.md`: Entwicklungsserver verlinkt und verbleibende Agentgrenzen erklärt.
- `docs/plans/selfhosted-e2ee.md`: aktuellen Docker-Meilenstein ergänzt.
- `scripts/sync-prototype/README.md`: Docker-Kontoserver verlinkt, Server- und
  Vault-Passwortwechsel getrennt, veraltete Containergrenzen präzisiert.
- `scripts/sync-prototype/account-auth.mjs`: Session-Hash-Aktivitätsprüfung.
- `scripts/sync-prototype/server.mjs`: optionale Rendezvous-Integration und
  explizite Container-Bindadresse, Loopback bleibt Standard.

Neue Dateien, am Handoff-Zeitpunkt noch untracked:

- `.dockerignore`
- `docs/plans/docker-rendezvous.md`
- `scripts/check-server-container.mjs`
- `scripts/sync-prototype/rendezvous.mjs`
- `scripts/sync-prototype/rendezvous-client.mjs`
- `scripts/sync-prototype/rendezvous.test.mjs`
- `server/main.mjs`
- `server/Dockerfile`
- `server/compose.yaml`
- `server/Caddyfile.example`
- `server/README.md`
- `server/smoke.mjs`
- Diese Handoff-Datei.

Wichtig: `git diff --stat` zeigt ohne Staging **nicht** den Inhalt dieser
untracked Dateien. Zur Review auch diese Dateien direkt lesen. Änderungen
weder mit Checkout/Reset verwerfen noch wegen „untracked“ als fremd entfernen.

## Tatsächlich durchgeführte Prüfungen

Letzter vollständiger Lauf am 2026-11-06:

```sh
npm test -- --maxWorkers=4
```

Ergebnis: **206 Testdateien bestanden; 3.011 Tests bestanden, 35 übersprungen,
3.046 insgesamt**, Dauer ca. 49 Sekunden.

Weitere grüne Prüfungen:

- `npm run typecheck`.
- `git diff --check` (zuletzt auch am 2026-11-07, vor Anlage dieser Datei).
- `node server/smoke.mjs`: echter lokaler Server, persistierte Testkonfiguration,
  zwei Anmeldungen, simulierte unabhängige Prüfung und Zustimmung, verschlüsselte
  bidirektionale Nachrichten, Sitzungsende, anschließende Bereinigung.
- `npx vitest run scripts/sync-prototype/rendezvous.test.mjs --maxWorkers=1`:
  **13 Integrationstests**. U.a. Authentifizierung/Opt-in, Zustimmung vor Daten,
  falsche Keys/Scope, gefälschte Annahme, Nonce-Austausch, Kanalwiederverwendung,
  Teilnehmertrennung, Ablauf, Ressourcenlimits, verlorene Send-/ACK-/Consent-
  Antworten, Neustart, private Konfiguration und Kontorotation.
- Vor den letzten drei neuen Tests war außerdem die ganze Prototypsuite mit
  `npx vitest run scripts/sync-prototype --maxWorkers=2` grün (damals 67 Tests).
  Der spätere vollständige Lauf umfasst auch die zusätzlichen Tests.
- Docker-Image tatsächlich mit
  `docker compose -f server/compose.yaml build` gebaut. Kein npm install im Image.
- `node scripts/check-server-container.mjs` mehrfach mit tatsächlichem
  Dockerzugriff bestanden, zuletzt gegen das finale Image:
  1. UID 1000, read-only Root, loopbackveröffentlichter Port, Anmeldung und E2EE.
  2. Verschlüsselte synthetische Datei hochgeladen; Container ersetzt;
     Konto/Objekte erhalten, alte Token ungültig, Geräte-/Sitzungszustand leer.
  3. Tatsächlicher Image-Healthcheck ausgeführt.
  4. Tar-Backup in frisches Volume zurückgespielt; Rechte erhalten; Abruf und
     lokale Entschlüsselung erfolgreich; keine Klartext-Testmarker/Passwörter
     in Serverdateien gefunden.
  5. Kontorotation: altes Passwort abgewiesen, neuer Zugang erfolgreich, Objekte
     erhalten. Alle eindeutig benannten Testcontainer/-Volumes bereinigt.
- Zusätzlich **die dokumentierten interaktiven Compose-Befehle** geprüft:
  Einrichtung im echten TTY mit verdecktem Passwort und Wiederholung;
  `up -d --wait --wait-timeout 45` erfolgreich, Container `Healthy`.
  Isoliertes Testprojekt hieß `shellherd-cli-check-6f3a12`; danach mit
  projektspezifischem `down -v` vollständig entfernt. Nicht auf Nutzerdaten
  übertragen! Keine produktiven Konten eingerichtet.
- CI-Datei lokal mit PyYAML geparst; GitHub-CI noch nicht ausgeführt.

Tests verwenden ausschließlich synthetische Daten. Die Containerprüfung erzeugt
eine verschlüsselte synthetische Nutzlast im Vault-Dateicontainerformat und
prüft deren Wiederherstellung. Sie ersetzt keine App-Schemavalidierung; die
bisherigen `account.test.mjs` prüfen zusätzlich echte App-Vaults.

Nicht geprüft/fertig: externer HTTPS-Proxy mit realer Domain, Podman, Kubernetes,
Windows-Agenten, Remote-Desktop, Medienrelay, Hardware-Stromausfall, unabhängiges
Kryptografie-/Protokollaudit. Kein frisches Desktop-Paket gebaut, da diese Arbeit
Server/Referenzclient betraf; vorhandene App-Build-/UI-Nachweise stammen aus
früherer Arbeit und dürfen nicht als neue Prüfungen ausgegeben werden.

## Rechner, Installation und Berechtigungen

- Benutzer UID/GID 1000 (`pelmenipower`), Ubuntu 26.04.1 LTS.
- Host-Node bei Prüfung: v22.22.1. App-CI verwendet Node 24.
- Gebautes Serverimage: Node v22.23.4 aus `node:22-bookworm-slim`.
- Docker war zunächst nicht installiert. Mit Benutzerfreigabe installiert:
  `docker.io` und `docker-compose-v2`, einschließlich Abhängigkeiten
  containerd/runc, bridge-utils, pigz, ubuntu-fan.
- Verifizierte Versionen: Docker 29.1.3, Compose 2.40.3.
- Paketinstallation über `pkexec /usr/bin/apt-get install -y docker.io docker-compose-v2`.
  Dienste wurden von der Paketinstallation eingerichtet/aktiviert.
- `sudo -n` funktioniert nicht: Systemauthentifizierung erforderlich.
  Docker-Socket `root:docker`, Modus 0660. Der Benutzer hatte im geprüften
  Prozess **keinen direkten Docker-Socket-Zugriff**; keine Gruppen/ACLs geändert.
- Tatsächliche Docker-Tests deshalb über `pkexec /usr/bin/docker …` bzw.
  `pkexec /usr/bin/node /home/pelmenipower/Projekte/Shellherd/scripts/check-server-container.mjs`.
  Normale README-Befehle setzen entsprechend eingerichteten Dockerzugriff voraus;
  alternativ interaktiv `sudo` verwenden. Kein Passwort automatisiert beschaffen.
- Docker/Compose und lokales Image `shellherd-server:local` bleiben installiert.
  Nach den Tests keine von uns eingerichteten dauerhaft laufenden Testserver oder
  produktiven Serverkonfigurationen. Letzter Bereinigungsstand 2026-11-06;
  aktuelle Laufzeitlage vor weiteren Änderungen bei Bedarf erneut prüfen.
- Compose warnte, dass Buildx/Bake fehlt; Docker-Build fiel erfolgreich auf den
  vorhandenen Builder zurück. Kein Funktionsfehler, Buildx wurde nicht installiert.
- Aktuelle Session hatte zuletzt vollen Dateisystem-/Netzzugriff. Neue Session
  muss ihre tatsächlich geltenden Berechtigungen selbst beachten.

## Reproduzierbare Einstiege

Alle Befehle im Repository-Verzeichnis ausführen.

Lokaler funktionaler Nachweis ohne Docker:

```sh
node server/smoke.mjs
```

Eigenen Server neu einrichten (erst ausführen, wenn tatsächlich gewünscht;
erfordert einen vom Benutzer gewählten Zugang):

```sh
docker compose -f server/compose.yaml build
docker compose -f server/compose.yaml run --rm server init
docker compose -f server/compose.yaml up -d
```

Containerprüfung mit ausschließlich wegwerfbaren Testressourcen:

```sh
node scripts/check-server-container.mjs
```

Ausführliche Befehle einschließlich Rotation, Backup/Restore und API stehen in
`server/README.md`. Keine echten Zugangsdaten in Argumente, Umgebungsvariablen,
Logs oder Handoff-Dateien schreiben.

## Offene Arbeit und sinnvoller nächster Schritt

1. Zuerst aktuellen Branch, `AGENTS.md`, diese Datei und die relevanten neuen
   Server-/Clientmodule lesen. Bestehende uncommitted Arbeit erhalten.
2. Aktuellen Server-/Referenzclient kritisch reviewen; die Tests sind kein
   unabhängiger Sicherheitsreview. Insbesondere die neue E2EE-Komposition
   (frische Handshake-Bindung, Schlüsselablage, Replay, Zustimmung, Widerruf)
   vor produktiver Agentintegration prüfen. Bestehendes Noise-Experiment ist
   getrennt; nicht stillschweigend eine unabhängige Abnahme behaupten.
3. Für die gewünschte Dameware-artige Funktion einen konkreten nächsten
   durchgehenden Agenten-Meilenstein planen und umsetzen: lokal verankerte
   Identität, Online-Anmeldung/Lease, sichtbare Freigabe/Abbruch und erster
   tatsächlich geprüfter Bildschirm-/Eingabeweg. Plattformgrenzen Windows,
   Linux/Wayland/X11 sowie Sperrbildschirm/UAC berücksichtigen. Vorhandenes RDP
   nicht automatisch als den neuen Agenten oder Rendezvous-Nachweis darstellen.
4. Dauerhafte Agentidentitäten/vertrauenswürdige Bindungen und OS-Rechte fehlen.
   Keine unbeaufsichtigte Steuerung allein durch Serverentscheidung erlauben.
5. Für Medien NAT-Traversal/direkte Verbindung und begrenzten Relay-Fallback
   passend auswählen. Das bestehende 8-KiB-/Polling-Signaling nicht für Video
   aufblasen oder als fertigen Medienrelay bezeichnen.
6. App-UI für Geräte/Sitzungen, Zustimmung und Verbindung muss noch integriert
   werden. Benutzer-Sync und Remote-Zugriff sind verschiedene Berechtigungen.
7. Falls Veröffentlichung/Commit/PR gewünscht wird: zuerst Branch prüfen und
   auch untracked Dateien vollständig berücksichtigen. Nur eigener Branch,
   Ziel `staging`, niemals selbst mergen. Der bisherige Auftrag hat keine
   Release-/Versionsänderung autorisiert.

Nicht erneut von vorn beginnen, keine bereits grünen Prüfungen ohne relevante
Änderung endlos wiederholen. Bei neuem Code passende Prüfungen durchführen und
Fortschritt samt verbleibenden Grenzen klar benennen.

## Weitere zentrale Dokumente

- `AGENTS.md`
- `server/README.md`
- `docs/plans/docker-rendezvous.md`
- `docs/plans/selfhosted-e2ee.md`
- `docs/plans/selfhosted-protocol.md`
- `docs/plans/selfhosted-threat-model.md`
- `scripts/sync-prototype/README.md`
- `RDP_IMPLEMENTIERUNGSPLAN.md` (vorhandene RDP-Integration; nicht mit neuem
  eigenständigem Fernsteuerungsagenten gleichsetzen)
