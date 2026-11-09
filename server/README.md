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
(Antwort 429 mit `retry-after`). Hinter dem Proxy auf dem Host erscheinen
Clients im Container als Adresse des Docker-Gateways (nicht `127.0.0.1`), also
als eine einzige Quelle. Deshalb setzt `compose.yaml` aktiv
`SHELLHERD_SERVER_TRUSTED_PROXY: "1"`: Der Server nimmt das letzte Element von
`X-Forwarded-For` als Quelle. Das ist nur sicher, solange der Port wie
vorgegeben auf `127.0.0.1` gebunden ist und ausschließlich der Proxy ihn
erreicht. Das Flag entfernen, wenn der Server direkt ohne Proxy betrieben wird
(etwa nur im WireGuard-Netz, siehe „Privates Netz“); sonst könnten Clients ihre
Quelle per Header fälschen.

Optional und außerhalb dieses Repos kann fail2ban wiederholte 429-Antworten oder
Fehlanmeldungen auf Firewall-Ebene sperren. Gegen verteilte Floods hilft nur ein
privates Netz (Tailscale/WireGuard), siehe nächster Abschnitt.

## Privates Netz

Ein privates Netz nimmt den Server aus dem öffentlichen Internet. Dann erreichen
nur Mitglieder des Netzes den Port. Zwei Wege, in dieser Reihenfolge empfohlen:

### Tailscale `serve` (zuerst)

Der Port bleibt wie in `compose.yaml` an `127.0.0.1` gebunden, `TRUSTED_PROXY=1`
bleibt gesetzt. `tailscale serve` übernimmt TLS (Tailnet-Zertifikat) und leitet
lokal weiter:

```sh
tailscale serve --bg 8787
```

Die Server-URL für die Clients ist dann `https://<host>.<tailnet>.ts.net/`; die
Option „Privates Netz“ ist dafür nicht nötig. Annahme, noch im Lab einmal real
zu prüfen: `tailscale serve` setzt `X-Forwarded-For`, so dass die Limits pro
Quelle je Tailnet-Gerät greifen. Ohne diesen Header erscheinen alle Clients als
eine Quelle. Kein `tailscale funnel`, denn das würde den Server öffentlich machen.

### WireGuard

Der Server lauscht ausschließlich auf der WireGuard-Adresse des Hosts und
verwendet kein TLS. Verschlüsselung und Peer-Authentifizierung übernimmt der
Tunnel. Dafür dient die eigenständige Datei `compose.wireguard.yaml`. Sie ist
keine Override-Datei, denn Compose hängt `ports` nur an und behielte
`127.0.0.1` und den Proxy-Modus. Sie enthält dieselben Härtungen wie
`compose.yaml` (schreibgeschütztes Root-Dateisystem, `cap_drop: [ALL]`,
`no-new-privileges`, Limits, Volume), aber **kein** `TRUSTED_PROXY`:

```sh
export SHELLHERD_BIND_ADDR=10.8.0.1   # WireGuard-Adresse des Hosts
docker compose -f server/compose.wireguard.yaml build
docker compose -f server/compose.wireguard.yaml run --rm server init
docker compose -f server/compose.wireguard.yaml up -d
curl --fail http://10.8.0.1:8787/v1/info
```

`SHELLHERD_BIND_ADDR` ist Pflicht; ohne Wert bricht Compose ab. Beide Dateien
verwenden denselben Projektnamen und damit dasselbe Volume `server-data`. Nicht
beide Varianten gleichzeitig starten (genau eine Instanz pro Datenvolume).
Hinweise:

- Das WireGuard-Interface muss vor Docker aktiv sein, sonst scheitert der Start
  mit `cannot assign requested address`. Unter systemd `wg-quick@…` vor
  `docker.service` ordnen; `restart: unless-stopped` ersetzt das nicht sicher.
- Die Quelladresse bleibt mit iptables-DNAT erhalten, die Limits pro Quelle
  greifen dann je Tunnel-IP. Mit dem Userland-Proxy von Docker ist das nicht
  der Fall und alle Clients wären eine Quelle. Im Lab prüfen.
- Kein `TRUSTED_PROXY`, kein Reverse-Proxy davor.
- Im Desktop-Client die Option „Privates Netz“ aktivieren. Nur dann akzeptiert
  er `http://` zu einer numerischen privaten Adresse (`10/8`, `172.16/12`,
  `192.168/16`, `100.64/10`, IPv6 `fc00::/7`). Namen, `169.254/16`, Link-Local
  und öffentliche Adressen bleiben abgelehnt.
- Klartext-HTTP im Tunnel ist nur so vertrauenswürdig wie der Tunnel. Die
  Fernsteuerungskanäle sind zusätzlich Ende-zu-Ende verschlüsselt.

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
meldet zusätzlich `rendezvous: true` und `rendezvousNoise: true` (Noise-Frames,
siehe unten). Clients lehnen Server ohne `rendezvousNoise` ab; es gibt keinen
Rückfall auf ein älteres Protokoll. `DELETE /v1/vaults/<namespace>/objects/<id>`
(64 Hex-Zeichen) entfernt ein Vault-Objekt, ausschließlich bei Anmeldung mit dem
Serverkonto (im Gerätemodus 405); Antwort `{removed: true}`, unbekannte ID 404.
Alle folgenden Endpunkte verlangen
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
| `POST /v1/rendezvous/sessions/:id/messages` | `{sequence, frame}` einstellen; `frame` ist ein Base64-Noise-Frame (1 bis 8208 Byte) |
| `GET /v1/rendezvous/sessions/:id/messages?after=N` | Nicht quittierte Frames lesen |
| `POST /v1/rendezvous/sessions/:id/ack` | `{through: N}` quittieren |

Ein Gerät pro Anmeldung, maximal 32 Geräte. Präsenz spätestens alle 30 Sekunden
erneuern, Lease 60 Sekunden. Ausloggen, Ablauf des Tokens (15 Minuten, ohne `POST /v1/refresh`) oder der
Präsenz entfernen auch die betreffenden Sitzungen beim nächsten Request.
Anfragen laufen nach 60 Sekunden ab, angenommene Sitzungen nach fünf Minuten.
Danach neu anfragen und lokal freigeben. Maximal vier Sitzungen pro Gerät und
64 insgesamt. Kein automatischer Zugriff nach Wiederanmeldung.

Nachrichten enthalten ausschließlich `{sequence, frame}`. `frame` ist ein
Base64-kodierter Noise-Frame von 1 bis 8208 Byte (8 KiB Nutzlast plus
Handshake-/Tag-Overhead), `sequence` höchstens 4294967295. Maximal 32 offene Frames pro Richtung.
Reihenfolge ist streng; exakte Retries der letzten 32 Frames sind idempotent, auch nach
Quittierung. Quittierung erfolgt erst nach erfolgreicher Entschlüsselung. Es
gibt keine unbegrenzten Warteschlangen oder freien Proxyziele. Globales
Requestlimit: 600/Minute, daher mit mindestens fünf Sekunden Pollingintervall
und wenigen aktiven Geräten beginnen. Das ist ein Signalisierungsrelay, kein
für Video oder Massendaten freigegebener Relaydienst.

## Kompaktierung der Vault-Historie

Jede Synchronisation legt eine neue unveränderliche Version an. Damit der Server
nicht unbegrenzt wächst, kompaktiert der Desktop-Client die **eigene** Historie
nach erfolgreichem Sync:

- Es bleiben die 16 jüngsten Generationen ab dem einzigen Kopf (`SYNC_RETAIN = 16`).
  Die Kompaktierung beginnt erst bei mehr als 32 vorhandenen Versionen
  (`SYNC_COMPACT_AT = 32`), nur bei genau einem Kopf und ohne offene lokale Änderung.
- Der Client schreibt eine neue Version, die in `compacts` kumulativ die IDs aller
  entfernten Versionen nennt (höchstens 256 Einträge), lädt sie hoch und löscht
  die älteren Objekte per `DELETE …/objects/:id`. Andere Geräte erkennen anhand
  von `compacts`, dass fehlende Vorgänger gewollt fehlen, und löschen übrig
  gebliebene Objekte bei ihrem nächsten Sync nach. Ein Abbruch mittendrin ist
  folgenlos: der nächste Lauf setzt fort.
- Ein Serverkonto enthält genau einen Vault. Der Client löscht nie Objekte, die er
  als Teil derselben Historie lesen kann, außer durch diese Kompaktierung.
  Objekte, die sich mit dem entsperrten Vault-Schlüssel nicht öffnen lassen
  (anderer Vault im selben Konto), löscht er nur auf ausdrücklichen Auftrag des
  Kontoinhabers im Sync-Dialog („Fremde Objekte entfernen“), nach erneutem
  Lesen und nur wenn sie tatsächlich unlesbar sind.
- Löschen verlangt die Anmeldung mit dem Serverkonto. Ein Gerät im Gerätemodus
  erhält 405.
- **Vor der ersten Kompaktierung alle Geräte mit Sync-Lab gemeinsam auf denselben
  Stand der App aktualisieren.** Ein altes Gerät kennt `compacts` nicht, würde
  fehlende Vorgänger als Historienbruch werten und den Sync verweigern.
- Kompaktierung ersetzt kein Backup: gelöschte Versionen sind nicht
  wiederherstellbar, außer aus einer Serversicherung (siehe „Backup und Wiederherstellung“).

## Ende-zu-Ende-Prüfung im Referenzclient

`scripts/sync-prototype/rendezvous-client.mjs` exportiert `RendezvousPeer` und
`createRendezvousIdentity`. Ein Peer verwendet einen angemeldeten `AccountStore`.
Die Identität bleibt lokal. Das Beispiel erzeugt sie neu im RAM; dauerhafte
Agentidentitäten benötigen später einen geschützten lokalen Schlüsselspeicher.
Das Paket `noise-handshake` (mit `sodium-*`) wird nur vom Client geladen; der
Server und sein Image enthalten keine Kryptobibliothek und sehen nur Frames.

Der Kanal ist ein Noise-XX-Handshake (`Noise_XX_25519_ChaChaPoly_BLAKE2b`,
Prolog `shellherd-rendezvous-noise-v1`) über die Server-Nachrichten. Die
statischen Schlüssel beider Seiten sind die X25519-Geräteschlüssel. Danach
laufen die Nutzdaten verschlüsselt mit den Transportschlüsseln des Handshakes.
Nach dem Handshake wird die Sitzung durch eine authentisierte, verschlüsselte
Annahme des Ziels bestätigt.

`peer.channel(session, expectedFingerprint, scope)` übernimmt den Schlüssel der
Gegenseite nicht aus der Geräteliste. Er entsteht erst im Handshake; `channel`
vergleicht den daraus abgeleiteten Fingerprint mit `expectedFingerprint` und
bricht bei Abweichung mit `code: 'mismatch'` ab. Der erwartete Wert muss daher
**unabhängig** (anderer Kanal, Mensch zu Mensch) beschafft werden, **nicht**
automatisch aus der Server-Geräteliste. Gerätenamen und Online-Status sind keine
Identitätsnachweise. In der App genügt der Vergleich der ersten 16 Hex-Zeichen
(zwei Gruppen) des Fingerabdrucks; der Client prüft dann gegen den vollständigen
Wert aus dem Handshake. Ein Konto-Inhaber kann Anfragen erzeugen und öffentliche
Gerätemetadaten sehen; Kontoanmeldung allein autorisiert keine Fernsteuerung.

Das Ziel ruft `channel.accept()` erst nach bewusster lokaler Zustimmung auf.
Beide Seiten treiben den Handshake mit `channel.receive()` voran (typisch zwei
Runden), bis `channel.ready` gilt. Erst danach ist `channel.send(value)` erlaubt.
Ein vom Server gefälschter Status reicht nicht. Frames einer anderen Sitzung
oder Richtung, Wiederholungen und Umordnung scheitern an Sequenz und Noise-Zustand.
Ein Verarbeitungsfehler vergiftet den Kanal; weitere `receive()`-Aufrufe werfen
sofort. `retry()` wiederholt einen fehlgeschlagenen Sendeversuch mit demselben
Frame. `receive()` kann nach verlorener Quittierungsantwort ohne doppelte
Auslieferung wiederholt werden. `close()` beendet die Sitzung, `dispose()`
verwirft lokal die abgeleiteten Schlüssel.

Noise XX liefert Forward Secrecy: Ein späterer Verlust des statischen
Geräteschlüssels entschlüsselt aufgezeichneten Verkehr früherer Sitzungen nicht.
Der Handshake ist ein begrenztes Referenzprotokoll ohne unabhängigen Review.
Der Server kann Verbindungen verhindern, Nachrichten zurückhalten und Metadaten
sehen. Er kann mit lokal geprüften Gegenstellenschlüsseln keine gültigen
Nachrichten oder Zustimmung erzeugen. `view`/`control` werden an die Sitzung
gebunden; erst der spätere Agent muss die erlaubten OS-Aktionen durchsetzen.
Weder unbeaufsichtigter Zugriff noch Bildschirm-/Eingabedaten produktiver
Systeme werden durch diesen Referenzclient freigegeben.
