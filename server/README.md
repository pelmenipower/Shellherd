# Shellherd Storage- und Rendezvous-Server

Separater Node-Server ohne Electron oder npm-Laufzeitabhängigkeiten. Er speichert
einen Konto-Hash und verschlüsselte Vault-Versionen dauerhaft und vermittelt
explizit freigegebene Sitzungen mit verschlüsselten Signalisierungsnachrichten.
Der vorhandene Linux-Sync-Entwicklungsdialog kann denselben Server verwenden.

Die Desktop-Fernsteuerung ist noch nicht implementiert: Dieser Server erfasst
keine Bildschirme und führt keine Tastatur-/Mauseingaben aus. Der Referenzclient
demonstriert die Vermittlung. Eine Integration in Windows-/Linux-Agenten und
ein unabhängiges Review des E2EE-Sitzungsprotokolls stehen noch aus.

## Docker Compose

Aus dem Repository-Verzeichnis, mit Docker Engine und Compose v2:

```sh
docker compose -f server/compose.yaml build
docker compose -f server/compose.yaml run --rm server init
docker compose -f server/compose.yaml up -d
docker compose -f server/compose.yaml ps
curl --fail http://127.0.0.1:8787/v1/info
```

`init` benötigt ein interaktives Terminal und fragt Benutzername sowie ein
wahlweise ein generiertes Serverpasswort (24 Zeichen, einmalig angezeigt, jetzt
notieren) oder ein eigenes verdecktes Passwort mit mindestens 16 Zeichen und
Wiederholung ab. Kein Passwort in Kommandozeile,
Compose-Datei oder Umgebungsvariable. Das Vault-Passwort bleibt ein separates,
ausschließlich lokal verwendetes Geheimnis. Ein erneutes `init` überschreibt
keine bestehende Konfiguration.

Das benannte Volume `server-data` enthält `/data/server.json` (Modus 0600 mit
gesalzenem scrypt-Hash, Server-ID, Namespace) und `/data/objects` (0700 mit
verschlüsselten unveränderlichen Objekten). Kontozugang ist ein einzelnes
gemeinsames Serverkonto, keine Mehrbenutzerverwaltung. Geräte, Sitzungen und
Sitzungstoken bleiben im RAM. Neustart verwirft diese; der Konto-Hash und die
Vault-Versionen bleiben erhalten.

Der Container läuft als UID/GID 1000 ohne zusätzliche Capabilities, mit
schreibgeschütztem Root-Dateisystem und Ressourcenlimits. Neue benannte Volumes
übernehmen die vorbereiteten Verzeichnisrechte aus dem Image. Bei Bind-Mounts
müssen Besitzer UID 1000 und Verzeichnismodus 0700 vorher passen. Genau eine
Serverinstanz pro Datenvolume betreiben; keine horizontalen Replikate.

Der Host-Port ist auf `127.0.0.1` begrenzt. Für andere Rechner HTTPS über einen
Reverse-Proxy einrichten, etwa mit [Caddyfile.example](Caddyfile.example) und
einem eigenen Domainnamen. Den Proxy auf demselben Host betreiben, DNS und
Firewall für HTTPS konfigurieren. Der Serverport bleibt intern. Keine
öffentliche Klartext-Anmeldung, keine deaktivierte Zertifikatsprüfung.
Zugriffslogs sind im Beispiel ausgeschaltet; externe Proxy-/Monitoringdienste
dürfen keine Authorization-Header oder Request-Inhalte protokollieren.

`Caddyfile.example` setzt `read_body 10s`. Das setzt eine Mindestrate von etwa
100 KB/s für einen 1-MiB-Body voraus; langsamere Clients werden getrennt.

Podman: Das Dockerfile ist ein normales OCI-Buildrezept. Mit einer vorhandenen
Compose-Implementierung können dieselben Dateien verwendet werden. Eine
Podman-Freigabe muss gesondert mit der jeweiligen Installation geprüft werden.

## Limits pro Quelle

Der Server begrenzt Anfragen, Anmeldungen und Verbindungen pro Quelladresse
(IPv6 je /64) und bremst fehlgeschlagene Anmeldungen mit wachsendem Backoff
(Antwort 429 mit `retry-after`). Hinter dem Caddy-Proxy sieht der Server nur
`127.0.0.1`. Dann in `compose.yaml` den auskommentierten Eintrag
`SHELLHERD_SERVER_TRUSTED_PROXY: "1"` aktivieren: Der Server nimmt das letzte
Element von `X-Forwarded-For` als Quelle. Das nur setzen, wenn der Port wie
vorgegeben auf `127.0.0.1` gebunden ist und ausschließlich der Proxy ihn erreicht.

Optional und außerhalb dieses Repos kann fail2ban wiederholte 429-Antworten oder
Fehlanmeldungen auf Firewall-Ebene sperren. Gegen verteilte Floods hilft nur ein
privates Netz (WireGuard/Tailscale), siehe H2.

## Image aktualisieren

Das Dockerfile pinnt das Basisimage per Digest. Zum Erneuern den Digest des
Tags `node:22-bookworm-slim` auflösen (`docker buildx imagetools inspect
node:22-bookworm-slim`), in der `FROM`-Zeile und im Kommentar darüber (Tag,
Datum) ersetzen, neu bauen und `node scripts/check-server-container.mjs`
ausführen. Danach `docker compose -f server/compose.yaml up -d --build`.

## Lokal ohne Container

```sh
node server/main.mjs init
node server/main.mjs serve
```

Standard: privates `./server-data`, Listener `127.0.0.1:8787`. Optionale
Umgebungsvariablen: `SHELLHERD_SERVER_DATA`, `SHELLHERD_SERVER_PORT`,
`SHELLHERD_SERVER_HOST` (`127.0.0.1` oder `0.0.0.0`) und
`SHELLHERD_SERVER_PUBLIC_URL` (normalisierte HTTPS-Basis-URL).
Im Image ist der Listener `0.0.0.0`, damit das Container-Portmapping funktioniert.

Funktionsnachweis mit zwei synthetischen Clients und simulierter Zustimmung:

```sh
node server/smoke.mjs
npx vitest run scripts/sync-prototype --maxWorkers=2
```

Der Smoke-Test startet einen echten lokalen Server, verwendet eine temporäre
private Konfiguration und löscht seine Testdaten anschließend. Er ersetzt keinen
Test der Fernsteuerung oder einen Sicherheitstest durch unabhängige Prüfer.

## Passwort wechseln

Server stoppen, vollständiges Backup anlegen, interaktiv einen neuen Kontozugang
einrichten und wieder starten:

```sh
docker compose -f server/compose.yaml stop server
docker compose -f server/compose.yaml run --rm server rotate-password
docker compose -f server/compose.yaml up -d
```

Die Rotation ersetzt die Kontokonfiguration atomar und erhält Server-ID,
Namespace und Objekte. Der abgefragte Benutzername kann gleich bleiben. Erst
beim folgenden Start gilt der neue Zugang. Alte RAM-Sitzungen sind durch den
Stop verworfen. Auch lokal `rotate-password` ausschließlich bei gestopptem
Server ausführen. Ohne Zugriff auf das Host-Volume gibt es kein Passwort-Reset.
Eine Kontoänderung ändert oder entschlüsselt keinen Vault und widerruft keine
bereits heruntergeladenen Daten.

## Backup und Wiederherstellung

Server stoppen und das **gesamte** Datenvolume mit privaten Dateirechten sichern.
Die Sicherung enthält den Konto-Hash und verschlüsselte Vaults; sie bleibt
schutzbedürftig. Beispiel aus einem Container in dasselbe benannte Volume:

```sh
docker compose -f server/compose.yaml stop server
docker compose -f server/compose.yaml run --rm -T --entrypoint tar server -C /data -czf - . > shellherd-server-backup.tgz
docker compose -f server/compose.yaml up -d
```

Die Host-Datei vorab mit `umask 077` schützen. Wiederherstellung in ein **leeres**
Volume mit derselben Compose-Projektidentität, bei gestopptem Server:

```sh
docker compose -f server/compose.yaml run --rm -T --entrypoint tar server -C /data -xzf - < shellherd-server-backup.tgz
docker compose -f server/compose.yaml up -d
```

Danach Anmeldung und Abruf eines bekannten Vault-Objekts prüfen. Kein
`docker compose down -v` auf einem erhaltenswerten Datenbestand. Ohne lokale
Vault-Schlüssel oder Vault-Passwort kann auch der Server das Backup nicht öffnen.
Ein alter Serverbackupstand beweist gegenüber Clients keinen neuesten Stand.

## Vermittlungsablauf und API

Die bestehende API bleibt kompatibel: `GET /v1/info`, `POST /v1/login`,
`POST /v1/logout` und die authentifizierten Vault-Objektendpunkte. `/v1/info`
meldet zusätzlich `rendezvous: true`. Alle folgenden Endpunkte verlangen
`Authorization: Bearer …` aus der Anmeldung:

| Methode und Pfad | Funktion |
| --- | --- |
| `POST /v1/refresh` | Leerer Body; verlängert die Anmeldung um 15 Minuten, höchstens 12 Stunden ab Login. Token bleibt gleich. |
| `PUT /v1/rendezvous/devices` | `{name, publicKey}` registrieren/Präsenz erneuern |
| `GET /v1/rendezvous/devices` | Aktive Geräte des gemeinsamen Serverkontos |
| `DELETE /v1/rendezvous/devices` | Eigenes Gerät und dessen Sitzungen entfernen |
| `POST /v1/rendezvous/sessions` | `{target, scope, nonce}`; `view` oder `control` anfragen, frische 256-Bit-Client-Nonce als Hex |
| `GET /v1/rendezvous/sessions` | Nur eigene eingehende/ausgehende Anfragen |
| `GET /v1/rendezvous/sessions/:id` | Eigene Sitzung abrufen |
| `POST /v1/rendezvous/sessions/:id/accept` | `{}`; ausschließlich am Ziel annehmen |
| `DELETE /v1/rendezvous/sessions/:id` | Ablehnen oder beenden, beide Teilnehmer |
| `POST /v1/rendezvous/sessions/:id/messages` | Verschlüsselten Frame einstellen |
| `GET /v1/rendezvous/sessions/:id/messages?after=N` | Nicht quittierte Frames lesen |
| `POST /v1/rendezvous/sessions/:id/ack` | `{through: N}` quittieren |

Ein Gerät pro Anmeldung, maximal 32 Geräte. Präsenz spätestens alle 30 Sekunden
erneuern, Lease 60 Sekunden. Ausloggen, Ablauf des Tokens (15 Minuten, ohne `POST /v1/refresh`) oder der
Präsenz entfernen auch die betreffenden Sitzungen beim nächsten Request.
Anfragen laufen nach 60 Sekunden ab, angenommene Sitzungen nach fünf Minuten.
Danach neu anfragen und lokal freigeben. Maximal vier Sitzungen pro Gerät und
64 insgesamt. Kein automatischer Zugriff nach Wiederanmeldung.

Nachrichten enthalten ausschließlich `{sequence, nonce, ciphertext, tag}`.
Maximal 8 KiB verschlüsselter Inhalt, 32 offene Frames pro Richtung. Reihenfolge
ist streng; exakte Retries der letzten 32 Frames sind idempotent, auch nach
Quittierung. Quittierung erfolgt erst nach erfolgreicher Entschlüsselung. Es
gibt keine unbegrenzten Warteschlangen oder freien Proxyziele. Globales
Requestlimit: 600/Minute, daher mit mindestens fünf Sekunden Pollingintervall
und wenigen aktiven Geräten beginnen. Das ist ein Signalisierungsrelay, kein
für Video oder Massendaten freigegebener Relaydienst.

## Ende-zu-Ende-Prüfung im Referenzclient

`scripts/sync-prototype/rendezvous-client.mjs` exportiert `RendezvousPeer` und
`createRendezvousIdentity`. Ein Peer verwendet einen angemeldeten `AccountStore`.
Die Identität bleibt lokal. Das Beispiel erzeugt sie neu im RAM; dauerhafte
Agentidentitäten benötigen später einen geschützten lokalen Schlüsselspeicher.

Vor `peer.channel(session, peerPublicKey, expectedFingerprint, scope)` den
vollständigen SHA-256-Fingerprint des öffentlichen X25519-Schlüssels unabhängig
vergleichen. **Nicht** automatisch einen Wert aus der Server-Geräteliste als
vertrauenswürdig übernehmen. Gerätenamen und Online-Status sind keine
Identitätsnachweise. Ein Konto-Inhaber kann Anfragen erzeugen und öffentliche
Gerätemetadaten sehen; Kontoanmeldung allein autorisiert keine Fernsteuerung.

Das Ziel ruft `channel.accept()` erst nach bewusster lokaler Zustimmung auf.
Die anfragende Seite muss `channel.receive()` ausführen und eine authentisierte,
verschlüsselte Annahme erhalten, bevor `channel.send(value)` erlaubt ist. Ein
vom Server gefälschter Status reicht nicht. HKDF-SHA256 bindet den X25519-Schlüssel
an Server-ID, Sitzung und eine lokal erzeugte Anfragenonce. Das Ziel ergänzt
bei jeder lokalen Zustimmung eine zweite frische Nonce für den eigentlichen
Nachrichtenschlüssel; eine alte Zustimmung oder alte Daten können dadurch
nicht einfach als neue Sitzung wiederholt werden. AES-256-GCM bindet Teilnehmer,
Umfang und Sequenz.
Frames einer anderen Sitzung oder Richtung können nicht übernommen werden.
`retry()` wiederholt einen fehlgeschlagenen Sendeversuch mit demselben Frame.
`receive()` kann nach verlorener Quittierungsantwort ohne doppelte Auslieferung
wiederholt werden. `close()` beendet die Sitzung, `dispose()` verwirft lokal den
abgeleiteten Schlüssel.

Dies ist ein begrenztes Referenzprotokoll ohne unabhängigen Review und ohne
Forward-Secrecy-Zusage bei späterem Verlust des statischen Geräteschlüssels.
Der Server kann Verbindungen verhindern, Nachrichten zurückhalten und Metadaten
sehen. Er kann mit lokal geprüften Gegenstellenschlüsseln keine gültigen
Nachrichten oder Zustimmung erzeugen. `view`/`control` werden kryptografisch
gebunden; erst der spätere Agent muss die erlaubten OS-Aktionen durchsetzen.
Weder unbeaufsichtigter Zugriff noch Bildschirm-/Eingabedaten produktiver
Systeme werden durch diesen Referenzclient freigegeben.
