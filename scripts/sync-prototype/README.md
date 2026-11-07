# Isolierter E2EE-Sync-Prototyp

Entwicklungsprototyp ausschließlich für künstliche Testdaten. Der optionale Linux-Entwicklungsdialog ist jetzt an echte lokale `.term`-Dateien angebunden: manueller Upload, erstmaliger Import und Offline-Konsolidierung. Keine produktive Nutzung oder Sicherheitsfreigabe. Ein zentraler HTTP-Transport mit Benutzername/Serverpasswort ist als Loopback-Prototyp vorhanden; weiterhin keine Produktivfreigabe. `libsodium-wrappers` 0.8.4 und `noise-handshake` 4.2.0 sind ausschließlich exakt versionierte Entwicklungsabhängigkeiten.

Aus dem Repository-Verzeichnis:

```sh
node scripts/sync-prototype/demo.mjs
node scripts/sync-prototype/persistence-demo.mjs
npx vitest run scripts/sync-prototype --maxWorkers=2
npx vitest run src/main/sync-prototype/vault-merge.test.ts scripts/sync-prototype/vault-integration.test.mjs --maxWorkers=2
```

Die Demo koppelt zwei Identitäten über Noise XX. Sie **simuliert den unabhängigen menschlichen Fingerprintvergleich** und bestätigt beide Seiten, verbraucht die Einladung lokal einmal und überträgt erst dann die signierte Mitgliedschaft. Beide erhalten eine gemeinsame Basis, ändern unterschiedliche Datensätze offline und tauschen anschließend verschlüsselte Snapshots über einen simulierten undurchsichtigen Speicher aus. Ein Client konsolidiert beide Versionen und veröffentlicht den Merge. Die Ausgabe enthält keine Credentials oder privaten Schlüssel.

## Zentralen Server ausprobieren

**Der Sync läuft immer über einen gewählten zentralen Server.** Alle Geräte verwenden dieselbe Server-URL. Sie laden dort ausschließlich verschlüsselte Versionen hoch und holen sie später wieder ab. Die Konsolidierung erfolgt auf den Clients. Andere PCs müssen nicht gleichzeitig online sein. Pairing ist Geräteautorisierung und Schlüsselprüfung, keine dauerhafte PC-zu-PC-Sync-Verbindung.

Der normale Einstieg verwendet **Server-URL, Benutzername und Serverpasswort**. Kein Fingerprint und kein Verwaltungsgerät sind für diesen Weg erforderlich. Das Serverpasswort erlaubt Speicherzugriff; das andere Vault-Passwort entschlüsselt ausschließlich lokal. Das Serverpasswort wird für die Anmeldung kurzzeitig im Server-RAM verarbeitet, aber nur als gesalzener Hash provisioniert. Es ist kein E2EE-Geheimnis.

Temporären Testserver mit öffentlichen Testzugangsdaten starten:

```sh
node scripts/sync-prototype/account-demo.mjs
```

In einem zweiten Terminal:

```sh
SHELLHERD_SYNC_LAB=1 npm run dev
```

**Einstellungen → Selfhosted Sync einrichten → URL `http://127.0.0.1:8787/`, Benutzername `demo`, Serverpasswort `ONLY_TEST_SERVER_PASSWORD` → Anmelden.** Der Dialog prüft Protokoll, Anmeldung und tatsächlichen Speicherzugriff. Die Anmeldung fragt kein Vault-Passwort ab und lädt keinen Vault hoch. Erst ein gesonderter Klick auf „Jetzt synchronisieren“ gleicht den geöffneten Vault ab; ohne geöffneten Vault kann „Vault vom Server laden“ nach Eingabe des ausschließlich lokal verwendeten Vault-Passworts eine neue lokale Datei erzeugen. Er speichert Zugangsdaten bisher nicht dauerhaft. Beim Schließen wird der lokale Sitzungstoken verworfen; serverseitige Sitzungen verfallen spätestens nach 15 Minuten. Es gibt keinen automatischen oder produktiv freigegebenen Hintergrund-Sync.

Eigene Konfiguration für einen dauerhaften **Entwicklungstest** erstellen:

```sh
node scripts/sync-prototype/account-init.mjs /privater/pfad/sync-config.json
node scripts/sync-prototype/server.mjs /privater/pfad/sync-config.json /privater/pfad/sync-daten 8787
```

Die interaktive Einrichtung fragt Benutzernamen und ein verdecktes Serverpasswort mit Wiederholung ab. Das Passwort benötigt mindestens zwölf Zeichen und gehört weder in Prozessargumente noch Umgebungsvariablen. Die neue Konfigurationsdatei wird exklusiv mit Modus `0600` angelegt und enthält `serverId`, eine opake `namespace` und `account` mit `username`, `algorithm: scrypt-v1`, `salt` und `hash`. Kein Klartextpasswort. Der Node-Standardbibliothek-scrypt verwendet N=131072, r=8, p=1 und einen zufälligen 16-Byte-Salt; diese Parameter entsprechen der [OWASP-scrypt-Empfehlung](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt). Kein zusätzliches Kryptografiepaket wird für den Anmeldeserver geladen.

Außerhalb des numerischen Loopbacks ist clientseitig HTTPS erforderlich. Der Entwicklungsserver bindet nur an `127.0.0.1`. Der [separate Servereinstieg](../../server/README.md) ergänzt einen geprüften Docker-/Compose-Betrieb für den Kontomodus und ein HTTPS-Proxy-Beispiel. Keine Zugangsdaten in URLs, keine Redirects, keine abgeschaltete Zertifikatsprüfung. Anfragezeit, Antwortgröße und Ressourcen sind begrenzt. Der Dialog ist in gepackten Apps auch mit Umgebungsflag nicht aktivierbar.

`POST /v1/login` prüft die Zugangsdaten und gibt einen zufälligen 256-Bit-Bearer-Sitzungstoken zurück. Dieser bleibt ausschließlich im Main-Prozess-RAM; der Renderer erhält nur Anmeldestatus und Benutzernamen. Server hält nur Token-Hashes im RAM; Neustart invalidiert alle Sitzungen. `POST /v1/logout` widerruft die aktuelle Sitzung. Grenzen: zehn Anmeldeversuche pro Minute global, maximal eine parallele Passwortprüfung und 32 Sitzungen. Es gibt zunächst genau ein Konto mit einer eigenen Namespace pro Serverinstanz; Konto-/Passwortverwaltung und Mehrmandantenbetrieb fehlen noch.

Die Objekt-API speichert im Kontomodus unveränderliche, SHA-256-adressierte **verschlüsselte Vault-Dateien**. Sie verlangt das bestehende `terminus-encrypted-vault`-Format mit Argon2id (64 MiB/3/1) und AES-256-GCM und weist Klartext-Vault-Dokumente, lokale Geräteschlüssel-Checkpoints und zusätzliche Felder ab. Die äußere Formatprüfung beweist nicht, dass ein bösartiger berechtigter Client seine Nutzdaten wirklich verschlüsselt hat. Parallele Uploads erzeugen getrennte Versionen; es gibt kein Überschreiben per Zeitstempel. Andere KDF-Profile werden derzeit abgewiesen. Der Linux-Dateisync bindet gemeinsame Vorgänger im verschlüsselten Versionsinhalt und verwendet den lokalen Merge-Adapter; alte/fremde Vaults werden nicht stillschweigend übernommen. Serverlisten sind kein vertrauenswürdiger Aktualitätsnachweis.

Die Integrationstests laden echte verschlüsselte Vault-Testdaten hoch, starten den Server neu und laden auf einem zweiten Client mit denselben Serverzugangsdaten. Nur das lokale Vault-Passwort kann die Datei öffnen; das Serverpasswort kann dies nicht. Serverseitige Dateien enthalten weder Test-Credentials noch Vault-Passwort oder Serverpasswort. Der zusätzliche Test `password-sync.test.mjs` prüft reale lokale Vault-Dateien mit verschlüsseltem Sync-Zustand über denselben Kontotransport, verlorene Upload-Bestätigungen, Offline-Merge und Server-Neustart. Kein Hintergrund-Sync produktiver `.term`-Dateien wird damit behauptet.

Der sandboxed Electron-Test prüft Anmeldung, falsches Server- und Vault-Passwort, Passwortfeld-Löschung, Abbruch, manuellen Upload, erstmaligen Import in ein zweites isoliertes Profil, deaktivierte importierte Verbindungen und die deaktivierte Entwicklungsfunktion:

```sh
node scripts/sync-lab-smoke.mjs /pfad/zum/electron-checkout-wrapper
```

Screenshots: `/tmp/shellherd-sync-server-url.png`, `/tmp/shellherd-sync-server-ready.png`, `/tmp/shellherd-sync-vault-published.png` und `/tmp/shellherd-sync-vault-imported.png`.

## Manueller Linux-Dateisync und Wiederanlauf

Der Kontomodus ist im ungepackten Linux-Checkout nur mit `SHELLHERD_SYNC_LAB=1` aktiv. Eine Anmeldung allein verändert den Vault nicht. „Jetzt synchronisieren“ verwendet den entsperrten lokalen Vault und dessen Schlüssel ausschließlich im Main-Prozess. Beim Import auf einem weiteren Gerät muss der lokale Vault geschlossen sein; das Vault-Passwort wird separat und nur lokal verarbeitet. Der Dateidialog muss eine neue Datei auswählen; vorhandene Dateien werden nicht überschrieben. Eine empfangene Verbindung startet deaktiviert, bis sie lokal freigegeben wird. Pfade zu privaten Schlüsseln und kubeconfigs benötigen lokale Bindungen; die allgemeine Einrichtung dafür fehlt noch.

Neben `name.term` liegen `name.term.sync-state` und während des Abgleichs `name.term.sync-state.lock`. Der Zustand enthält die verschlüsselte Historie, bekannte Uploads, lokale Zweige und gegebenenfalls eine noch nicht abgeschlossene Übernahme. Er ist kein Serverobjekt und darf nicht hochgeladen werden. Vor Upload wird der Ausgangszustand dauerhaft gespeichert. Vor Ersetzen des lokalen Vaults entstehen eine verschlüsselte `sync-backup`-Datei und ein verschlüsselter Vorher-/Nachher-Nachweis. Linux-Datei und Verzeichnis werden vor Abschluss geflusht.

Bei einem Fehler nach Upload kann erneut synchronisiert werden: bereits geschriebene Objekte sind idempotent, und noch nicht bestätigte Uploads bleiben lokal vorgemerkt. Nach einer unterbrochenen lokalen Übernahme erkennt der nächste Lauf entweder den alten oder den übernommenen Vault. Nach erfolgreichem Wiederanlauf wird der aktuelle Vault erneut an die Oberfläche übergeben. Abbruch und lokale Änderungen werden vor dem abschließenden Rename nochmals geprüft. Ein bereits ausgeführter Rename lässt sich durch einen danach eintreffenden Abbruch nicht zurücknehmen. Nach einem unklaren Schreibfehler kann der Vault daher bereits aktualisiert sein; die Dateien vor weiteren Änderungen sichern und den Abgleich erneut prüfen.

Eine vorhandene Sperrdatei sperrt einen zweiten Abgleich und wird nicht automatisch gelöscht. Nach einem Prozessabsturz zuerst alle Shellherd-Prozesse schließen, Vault, `.sync-state`, `.lock` und Sicherungen gemeinsam sichern und erst dann ausschließlich die verwaiste `.lock` entfernen. `.sync-state` nicht löschen oder durch eine leere Datei ersetzen: Dadurch ginge der lokale Nachweis bekannter Historie verloren. Leere/beschädigte Zustände und unbekannte Zwischenstände werden abgewiesen. Ein fehlgeschlagener Erstimport kann einen verschlüsselten Sync-Zustand neben der angefragten Datei zurücklassen; vor Wiederverwendung des Pfads sichern und prüfen. Das ist noch kein allgemeiner Wiederherstellungsassistent.

Bei zwei konkurrierenden Zweigen mit gemeinsamer Basis werden unabhängige Änderungen zusammengeführt. Reine Verbindungskonflikte können ausdrücklich mit „meine Verbindungsdaten behalten“ aufgelöst werden; unabhängige Serveränderungen bleiben erhalten. Die Auswahl gilt ausschließlich für den geprüften lokalen Stand und die geprüfte Historie. Andere Konfliktarten, mehr als zwei Köpfe oder mehrere gemeinsame Basen bleiben zur späteren allgemeinen Auflösung erhalten. Es wird kein Gewinner nach Zeitstempel bestimmt.

Grenzen: 64 Versionen, 12 MiB verschlüsselte Historie im Client, keine Historienkompaktierung, kein Windows-Dateisync, kein Vault-Passwort-/KDF-Wechsel, keine dauerhafte Anmeldung, kein Hintergrund-Sync und keine individuelle Gerätewiderrufsfunktion im Passwortmodus. Neue Geräte können ohne vertrauenswürdigen lokalen Vergleichspunkt keinen global neuesten Stand gegen einen bösartigen Server beweisen. Windows-Dateisync, vollständige lokale Recovery und unabhängige Sicherheitsabnahme bleiben offen. Der separate Kontoserver hat einen geprüften Docker-Betrieb, Serverbackup/Restore und Serverpasswortwechsel; dies ändert keine Vault-Schlüssel. Ein Stromausfall auf realer Hardware wurde nicht simuliert.

Prüfstand 2026-10-31: `npm run build` erfolgreich; vollständige Testsuite 205 Dateien grün, 2.998 Tests bestanden und 35 übersprungen. Der sandboxed App-Test hat Anmeldung, falsche Passwörter, Abbruch sowie Upload und Import mit zwei isolierten Profilen bestanden. `password-sync.test.mjs` prüft zusätzlich verlorene Upload-Bestätigung, Offline-Merge und Server-Neustart über den tatsächlichen Kontotransport.

## Frühere Geräteprotokoll-Experimente

Die folgenden Geräte-ACL-, Noise- und Empfängerschlüssel-Experimente bleiben isolierte Tests für mögliche spätere Freigaben. Sie sind **keine Voraussetzung** für den vereinbarten Passwort-Sync und werden vom aktuellen Einrichtungsdialog nicht geladen. Der Gerätemodus und der Kontomodus sind ausdrücklich getrennt und dürfen nicht gemischt konfiguriert werden. `server-demo.mjs --serve` demonstriert weiterhin ausschließlich den früheren Verwaltungsweg.

## Zentraler Speicher und HTTP-Transport

`server.mjs` enthält ausschließlich Node-Standardmodule und keine Entschlüsselungsfunktionen. Der Loopback-Prototyp unterstützt eine konfigurierte Sync-Namespace mit maximal 16 vorab bekannten öffentlichen Gerätesignaturschlüsseln. Keine privaten Geräte-/Vault-/Wiederherstellungsschlüssel werden provisioniert. Eine Server-ACL ersetzt keine Ende-zu-Ende-Mitgliedschaft oder Schlüsselprüfung auf dem Client.

- Öffentliche Erreichbarkeitsprüfung: `GET /v1/info`.
- Frische einmalige Anfrage-Challenge: `GET /v1/challenge`.
- Authentifizierte Liste/Abruf/Upload: `GET /v1/vaults/<namespace>/objects`, `GET .../objects/<sha256>`, `PUT .../objects`.
- Jeder authentifizierte Request ist mit einem Geräteschlüssel signiert. Der Nachweis bindet Protokollzweck, Server-ID, ausgewählte Basis-URL, Methode, Pfad, einmalige Nonce, Geräte-ID und Body-Hash. Die Nonce verfällt nach 30 Sekunden. Die Anwendungskomposition ist noch nicht unabhängig geprüft.
- Das Serverformat akzeptiert ausschließlich verschlüsselte Snapshot-Umschläge, keine lokalen Checkpoints. Der Server prüft Transportberechtigung und äußeres Format; E2EE-Signatur, Empfänger, Inhalt und Historie werden weiterhin auf den Clients geprüft.
- Immutable Objekte tragen SHA-256-Adressen, werden vor der Quittierung mit fsync und atomarem Rename dauerhaft geschrieben und beim Lesen erneut auf Integrität geprüft. Nach Server-Neustart wird der begrenzte Objektbestand erneut validiert. Ein Fehler nach Rename blockiert weitere Uploads bis zum Neustart, statt einen ungewissen Speicherstand fortzuschreiben.
- Limits: 1 MiB pro Objekt, 100 Objekte, 32 MiB Nutzdaten, 128 offene Challenges, 600 Requests pro Minute global, 32 Verbindungen, 8 KiB Header und begrenzte Anfragezeiten. Keine Zugriffs-/Inhaltslogs, keine CORS-Freigabe oder freien Relays. Der Client lädt ohne Redirects und mit begrenzter Antwortgröße/Zeit.
- `RemoteStore.pull` lädt ausschließlich vom Server und ordnet die authentifizierte Historie anhand ihrer Vorgänger. Vorhandene lokale Zweige werden nie durch die Serverliste ersetzt. Das beweist keinen global neuesten Stand gegen einen bösartig zurückhaltenden Server.

Für einen dauerhaften **Entwicklungstest** kann eine eigene Konfiguration mit ausschließlich öffentlichen Daten verwendet werden:

```sh
node scripts/sync-prototype/server.mjs PUBLIC_CONFIG.json PRIVATE_DATA_DIR 8787
```

Konfigurationsstruktur: `serverId` (64 zufällige Hexzeichen), `namespace` (opake ASCII-ID), `devices` (Liste aus `id` und `signingKey`, dem Base64-kodierten öffentlichen Ed25519-Geräteschlüssel). Optional `publicUrl` als exakt normalisierte HTTPS-Basis-URL für einen späteren Reverse-Proxy; sie bindet die Request-Signatur an diese Adresse. Ohne diese Einstellung ist die lokale Listener-Adresse die Audience. Das Datenverzeichnis muss privat sein. Der Listener bindet absichtlich nur `127.0.0.1`; öffentliche Bereitstellung, TLS-Betrieb, produktive Geräteverwaltung, Mehrmandantenbetrieb, Docker/Podman/Kubernetes und deren Freigabe sind noch ausstehend.

**Der zentrale Transport verlangt keinen zweiten eingeschalteten PC und keine Online-Verwaltungsautorität pro Upload.** Die frühere fünfminütige `Authority.authorize`-Chargenfreigabe bleibt ein isoliertes Sicherheits-Experiment und ist nicht die Voraussetzung dieses Serverwegs. Das sichere Aktualitäts-/Widerrufsmodell für dynamische E2EE-Mitgliedschaften muss vor Produktivbetrieb festgelegt und geprüft werden. Der Transport testet eine feste, bereits verifizierte E2EE-Geräte-Mitgliedschaft und eine separat dynamisch verwaltbare serverseitige ACL. Entfernte/verlorene Geräte und ein bösartiger Server dürfen später nicht durch veraltete Mitgliedschaftsstände weitere Schlüsselpakete erhalten; diese Produktionsanforderung bleibt offen.

## Gerätezugriff am zentralen Server

Die Testdemo mit `--serve` unterstützt nun folgende Verwaltungsbefehle:

```text
list
approve ANFRAGE_ID VOLLSTAENDIGER_FINGERPRINT
revoke GERAETE_ID
quit
```

Im früheren Verwaltungsversuch den vollständigen Fingerprint aus dem anfragenden Gerät über einen unabhängigen vertrauenswürdigen Weg vergleichen. `list` liefert die offenen Anfragen; `approve` verlangt den bewusst verglichenen Fingerprint. Eine bloße Übernahme aus der Serverliste ersetzt den Vergleich nicht. Danach im Dialog den Status aktualisieren. Der reguläre Sync benötigt diese Verwaltung nur bei Aufnahme/Entzug, nicht pro Upload.

Optionale öffentliche Serverkonfiguration: `adminPublicKey` ist ein separater öffentlicher Ed25519-Verwaltungsschlüssel; `adminDevices` nennt bereits konfigurierte Geräte-IDs, deren Transportschlüssel Verwaltungsrequests stellen dürfen. Beide Prüfungen sind erforderlich. Der private Verwaltungsschlüssel bleibt auf dem Verwaltungsclient und kann samt lokal gepinnten Freigabeständen ausschließlich im verschlüsselten `LocalState.deviceData` gesichert werden. Der anfängliche Gerätebestand wird unabhängig lokal verankert, nicht aus einer ungeprüften Serverantwort übernommen.

Neue Endpunkte: `POST /v1/enrollments`, administratives `GET /v1/enrollments/pending`, eigener Status/Abbruch unter `GET`/`DELETE /v1/enrollments/<request-id>` und administratives `GET`/`PUT /v1/access`. Anfragen besitzen selbstsignierte vollständige Schlüsselbindungen, einmalige signierte Transportnachweise, maximal fünf Minuten Laufzeit und eine Obergrenze von 16 offenen Anfragen. Offene Anfragen bleiben nur im RAM und verfallen beim Neustart. Bestätigte Freigaben und Entzüge stehen als signierte, verkettete Revisionen atomar in `access.json`; ein ungewisser Schreibausgang sperrt authentifizierte Zugriffe bis zur geprüften Wiederöffnung. Die Datei enthält ausschließlich öffentliche Zugriffsdaten. Verwaltungsclients erkennen Rückschritte gegenüber ihren bekannten Vergleichspunkten; ein vollständiger Server-/Clientreset besitzt damit noch keinen globalen Rollbackschutz.

**Serverzugriff ist keine E2EE-Vault-Freigabe.** Ein aufgenommenes Gerät erhält keine Entschlüsselungsschlüssel. Der frühere Geräteversuch erzeugt ausdrücklich nur eine temporäre Entwicklungsidentität: Schließen verwirft ihre privaten Schlüssel; eine schon bestätigte Serverfreigabe muss der Verwalter separat entziehen. Ausstehende Anfragen laufen aus. Dauerhafte Identitäten, E2EE-Schlüsselzustellung, Verwaltungsübertragung/Recovery und Schlüsselrotation sind weitere Schritte. Bootstrap-Verwaltungsgeräte sind derzeit gegen Entzug gesperrt. Die Demo hält Verwaltungsclient und Server zur Demonstration im selben Testprozess; sie ist kein produktives Betriebsmodell.

## Implementiert

- Separate Ed25519-Signatur- und X25519-Empfängerschlüssel je Gerät; gesonderte Verwaltungsautorität.
- Noise-XX-Pairing mit separatem Noise-Schlüsselpaar je Versuch. Signierte Identitätsnachweise binden Handshake-Hash, Rollen, Geräte-Schlüssel, Noise-Schlüssel, Verwaltungsschlüssel, Sync-Kontext und Einladung. Erst nach vollständigem 256-Bit-Fingerprintvergleich und beidseitigen verschlüsselten Bestätigungen sind Anwendungsdaten und vertrauenswürdige Peerinformationen zugänglich.
- Lokale Einladungsverwaltung mit Einmalverbrauch, fünf Minuten Gültigkeit und maximal 16 offenen Einladungen. Nach Neustart sind vorherige Einladungen ungültig. Der administrative Aufrufer muss die Einladung vor Geräteaufnahme über `consume` verbrauchen; ein Serverflag wird nicht vertraut.
- Fail-closed-Verhalten bei ungültigen/vertauschten Nachrichten, Abbruch und Ablauf. Pro Paarungsversuch maximal fünf Minuten, 1.000 Transportframes je Richtung und 16 KiB pro Frame; keine Nutzdaten im Handshake.
- Vollständige Snapshot-Verschlüsselung mit frischem XChaCha20-Poly1305-Schlüssel und Nonce je Objekt; versiegelte Schlüsselpakete pro Empfänger. Der lokale Vault-Schlüssel wird nicht übertragen.
- Versionierte feste JSON-Tupel. Ausschließlich ihre exakte kompakte Kodierung wird akzeptiert; Header, Empfängerpakete, Nonce und Ciphertext sind signiert. Zusätzlich bindet AEAD den Header.
- Gepinnte, signierte Mitgliedschaft; Ablehnung von Geräteersetzung, alten Mitgliedschaftsständen und widersprüchlichen Ständen derselben Version.
- Authentifizierte Vorgänger, idempotente Zustellung, Erhalt konkurrierender Köpfe und Erkennung vom Server ausgelassener **bereits lokal bekannter** Zweige.
- Einmalige Uploadfreigabe, gebunden an Objekt, Kontext, Mitgliedschaft und zufällige Anfrage. Maximal fünf Minuten monotone Laufzeit, kein Wiederverwenden nach Client-Neustart.
- Konservativer Dreiwege-Merge für künstliche flache Datensätze mit stabilen IDs: ganze Datensätze sind atomar. Konfliktvarianten werden getrennt zurückgegeben und brauchen bewusste Auflösung. Der Aufrufer darf sie nicht verwerfen.
- Separater typgeprüfter Adapter für das echte Vault-v2-Schema: Ordner/Verbindungen nach ID, defensive Konfigurationsgruppen, Struktur-/Referenzprüfung sowie Trennung von portablen Daten und lokalen Freigaben. Der Integrationstest verschlüsselt echte Vault-Dokumente und konsolidiert sie nach einem Neustart.
- Optionale Dateispeicherung ausschließlich verschlüsselter Umschläge mit Integritätsadresse, temporärer Datei, Dateimodus `0600`, fsync und atomarem Rename. Der Linux-Dateitest öffnet den Speicher erneut und lädt Basis und Offline-Änderung in einen neuen Client.
- Größen-/Anzahllimits für Umschläge, Empfänger, Vorgänger, gespeicherte Clientobjekte, offene Publikationsanfragen und In-Memory-Serverspeicher.
- Passwortgeschützter lokaler Checkpoint mit Geräteschlüsseln, optionaler Verwaltungsautorität, geprüften Mitgliedschaftsständen, Snapshot-Historie, bekannten Köpfen, Upload-Warteschlange und ungelösten Merge-Konflikten. Nach Neustart wird die Historie mit Signatur-/Empfängerprüfung erneut aufgebaut. Offene Uploadfreigaben und Einladungen werden nicht gespeichert.
- Kontrolliertes Sperren überschreibt gehaltene Geräte-/Verwaltungs- und lokale Verschlüsselungsschlüsselbuffer und verwirft Clientzustand. Gehaltene JavaScript-Kopien können dadurch nicht garantiert gelöscht werden.
- Ein-Datei-Checkpoint mit Schreibsperre, Prüfung auf externe Änderungen, fsync und atomarem Dateiaustausch. Tests prüfen Schreibfehler, parallele Instanzen und einen wirklich per SIGKILL abgebrochenen Schreibprozess.

## Lokaler Checkpoint

`LocalState.create` übernimmt einen initialisierten Client und optional die zugehörige Verwaltungsautorität. `save` speichert den beim Aufruf erfassten Zustand und quittiert dessen Köpfe und Uploadanzahl; danach erfolgte Änderungen brauchen ein weiteres `save`. `lock` sperrt das Handle und zerstört dessen gehaltene Schlüsselbuffer. `LocalState.unlock` benötigt Passwort und erwarteten Sync-Kontext, optional zusätzlich den unabhängig bekannten Verwaltungsschlüssel. Die Passworteingabe wird als exaktes UTF-8 ohne Normalisierung verwendet. Beide Demos verwenden ausschließlich öffentliche Testpassphrasen aus dem Quelltext; echte Passwörter gehören weder in Kommandozeilenargumente noch Umgebungsvariablen oder Logs.

**Diese lokale Datei enthält verschlüsselte private Schlüssel und darf niemals auf den Sync-Server geladen werden.** Sie hat einen eigenen lokalen Format-/Zweckbezeichner. Die Test-Speicheradapter akzeptieren ausschließlich Snapshot-Umschläge und lehnen lokale Checkpoints ab. Das ist eine Typ-/Routingprüfung, keine serverseitige Authentifizierung.

Das Dateiformat verwendet festes Argon2id (64 MiB, drei Iterationen, Parallelität eins, 16-Byte-Salt) über das bereits vorhandene `hash-wasm`, einen 32-Byte-Schlüssel und XChaCha20-Poly1305 mit frischer 24-Byte-Nonce pro Speichern. Header einschließlich KDF und zufälliger Datei-ID ist als AAD gebunden; abweichende KDF-Parameter werden vor der Ableitung abgewiesen. Der entschlüsselte Zustand ist auf 16 MiB begrenzt, die Datei auf 24 MiB. Es gibt keinen Klartext-Fallback oder automatische Neugenerierung von Schlüsseln bei einem Ladefehler. Sicherheit gegen Passwortversuche hängt weiterhin von der Passphrase ab.

Der aktuelle Dateipfad ist ausschließlich für Linux freigegeben. Er verlangt ein privates Verzeichnis (`0700`), private reguläre Dateien (`0600`), Eigentümerschaft des aktuellen Nutzers und keine Symlinks/Mehrfachverlinkung der Zustandsdatei. Das übergeordnete Dateisystem muss vertrauenswürdig sein. Dateien werden mit begrenzter Lesegröße geladen. Windows-ACLs, OS-Schlüsselablage und Passwortwechsel sind noch nicht implementiert.

Nach einem Fehler **vor** dem Rename bleibt die vorherige bestätigte Datei erhalten. Nach einem Fehler **nach** dem Rename wird der Ausgang als ungewiss behandelt: erneut speichern ist mit diesem Handle gesperrt, erneutes Entsperren prüft die tatsächlich vorhandene vollständige Datei. Ein realer Prozessabbruch kann eine verschlüsselte temporäre Datei und eine leere `.lock`-Datei zurücklassen. Laden ignoriert diese Nebenartefakte und liest nur den endgültigen Dateipfad; Speichern entfernt eine fremde/verwaiste Sperre niemals automatisch. Eine spätere Wiederherstellungsoberfläche muss nach Prüfung, dass kein Schreiber mehr aktiv ist, die Sperre kontrolliert behandeln. Die Tests beseitigen ausschließlich ihre eigenen temporären Verzeichnisse.

Ein alter, aber vollständig gültiger lokaler Checkpoint lässt sich ohne externen Vertrauensanker nach vollständiger Rücksetzung nicht allgemein erkennen. Der Dateivergleich verhindert Überschreiben durch veraltete gleichzeitig offene Handles, ersetzt aber keinen manipulationsgeschützten monotonen Zähler. Bewusste Backups bleiben eigenständige Recoveryvorgänge. Es besteht noch keine Transaktion mit der produktiven `.term`-Datei.

## Adapter für echte Vaults

Der reine [TypeScript-Adapter](../../src/main/sync-prototype/vault-merge.ts) ist weder an IPC noch an produktives Speichern oder Sitzungsstart angeschlossen. Er nutzt das bestehende Vault-Schema, prüft vorab JSON-Größe und Tiefe und lehnt unbekannte/normalisierte Felder ausdrücklich ab, statt beim Sync Daten still zu verwerfen. Begrenzungen: 512 KiB, 20.000 JSON-Werte, JSON-Tiefe 48, maximal 1.000 Knoten und Ordner-Tiefe 24. Schemafehler führen zu Ablehnung; ein erst durch Konsolidierung ungültiger Stand bleibt ein Konflikt.

- `splitVaultForSync` liefert getrennt `portable` und `local`. Nur `portable` wird an `Client.snapshot` übergeben. `local` gehört im lokalen Checkpoint nach `deviceData` und **niemals** in den Server-Sync. Ein eigener innerer Payload-Bezeichner kennzeichnet Checkpoints mit Gerätebindungen; bisherige Checkpoints ohne Zusatzdaten bleiben lesbar.
- `mergePortableVaults` prüft drei Versionen derselben Vault-ID und desselben Erstellungszeitpunkts. Verschiedene Knoten und unabhängige Anzeigeattribute können zusammengeführt werden. Ziel, Protokoll, Credentials, sonstige Verbindungskonfiguration und Ordnerzuordnung eines Knotens bilden eine gekoppelte Einheit. Zwei unterschiedliche Änderungen daran erzeugen einen Konflikt. Workspaces mit ihren Layouts sowie globale Einstellungen und AI-Konfiguration sind jeweils atomare Einheiten. Zeitstempel wählen keinen Gewinner; `updatedAt` bleibt bis zum späteren bewussten Speichern beim Basiswert.
- Ordnerstruktur und Reihenfolge werden gesondert geprüft. Einseitige Reihenfolgeänderungen bleiben erhalten; gleichzeitig hinzugefügte/verschobene Einträge werden bei gleichbleibender gemeinsamer Reihenfolge nach ID angehängt. Widersprüchliche Änderungen der gemeinsamen Reihenfolge, Zyklen, verwaiste Einträge, ID-Kollisionen sowie ungültige Workspace-/Jump-Host-/Cluster-/Provider-Verweise verhindern einen Merge.
- Bei Konflikten ist `portable` null. `variants` enthält alle drei vollständigen portablen Alternativen, während `conflicts` nur Verweise auf die betroffenen Einheiten enthält. Die authentifizierten Snapshot-Köpfe bleiben im Checkpoint erhalten; der Integrationstest berechnet den echten Vault-Konflikt daraus nach Neustart erneut. `resolveVaultConfigurationConflicts` nimmt eine vollständige explizite Auswahl für bestehende, nicht verschobene Verbindungskonfigurationen entgegen und bewahrt unabhängige Metadaten/andere Änderungen. Andere Konflikttypen bleiben gesperrt. Die generischen `Client.stageMerge`/`resolveMerge` bleiben ausschließlich für die bisherigen flachen Fixtures vorgesehen; eine allgemeine dauerhafte Auswahl pro Konflikt für echte Vaults fehlt noch.
- `materializeVault` ist eine lokale Vorschau/Projektion. Neue oder sicherheitsrelevant geänderte Verbindungen sind `disabled`, bis lokale Freigaben für genau diese Konfiguration vorliegen. Eine reine Umbenennung übernimmt keine neuen Rechte und erhält eine vorhandene Freigabe. Bei fehlendem erforderlichem Key-/kubeconfig-Pfad gibt es überhaupt keinen schema-validen Vault zurück; die Liste `needsBindings` benennt den Bedarf. Keine zurückgegebenen Platzhalterpfade.

Gerätespezifisch bleiben SSH-Keypfad samt Key-Passphrase, kubeconfig-Pfad, Arbeitsverzeichnisse, Auto-Upload-Bindungen, Login-Aktionen, Portweiterleitungen, Container-Sudo-Einstellung, Deaktivierungsstatus, Clipboard-Zustimmung, Toolbar, separate Fenster und alte Workflowdaten. Globale Sperr-/Schließ-/Timeoutregeln bleiben ebenfalls lokal; portable Dokumente enthalten feste sichere Ausgangswerte (15 Minuten Sperre, Schließbestätigung, keine globalen Timeoutüberschreibungen). AI-Konfiguration bleibt portabel verschlüsselt, wird aber ohne passende lokale Freigabe nicht in der ausführbaren Projektion aktiviert.

Die lokalen Freigaben sind an den Konfigurationsinhalt und die Ordner-ID gebunden. Andere Ziele, Credentials oder Verschieben einer Verbindung verwerfen deren lokale Aktionen/Bindungen für die Projektion. Toolbar/Fenster werden nach jeder Änderung des zugehörigen portablen Gesamtdokuments vorsorglich zurückgehalten. Vorhandene lokale Daten werden dadurch nicht gelöscht. Eine spätere Oberfläche muss die Freigabe und Bindung bewusst einrichten. Unterschiedliche Keypfade von Windows und Linux ergeben dasselbe portable Dokument, ohne gegenseitig die lokalen Pfade zu ersetzen.

Portables Dokument und lokale Projektion müssen getrennt erhalten bleiben. Die Projektion darf nicht blind als neue Sync-Wahrheit exportiert werden: Sie enthält bewusst deaktivierte oder zurückgehaltene Funktionen. Auch freie Texte/Befehle können beliebige Pfadzeichenfolgen enthalten; die Trennung behandelt definierte Schemafelder und garantiert keine inhaltliche Erkennung jeder Pfadangabe in Freitext.

## Bewusste Grenzen

Die aktuelle Oberfläche prüft Server-URL und Kontozugang; sie zeigt keine Geräteanfragen mehr an. Dynamischer Serverzugriff ist implementiert; dynamische E2EE-Vault-Freigabe und ein produktiver Verwaltungsdienst fehlen weiterhin. `confirm` muss im späteren echten Betrieb ausschließlich nach einem unabhängigen Vergleich beider Geräte ausgelöst werden. Einen vom Vermittlungsserver gelieferten Fingerprint automatisch zu bestätigen wäre unsicher. Pairing verifiziert den Gegenpart, ersetzt aber keine bewusste Entscheidung über dessen Rechte. `OpaqueStore` und `FileStore` sind Testadapter ohne Zugriffskontrolle; niemals als öffentliche Dienste verwenden.

Das Node-Profil verwendet **BLAKE2b** statt des ursprünglich vorgeschlagenen BLAKE2s. Es wird kein stiller Profilwechsel ausgehandelt. `noise-handshake` ist Apache-2.0-lizenziert und verwendet hier `sodium-native` als Backend. Unter Linux/Node geprüft; native Electron-/Windows-Builds und ein gemeinsamer Rust-/Agent-Kern sind weiterhin offen. Der transportinterne Bibliothekszähler verarbeitet nur 32 Bit; deshalb begrenzt dieser Prototyp die Frames strikt auf 1.000, statt sich auf den gesamten Noise-Zählerraum zu verlassen. Für produktive Dauersitzungen ist eine gesondert geprüfte Transportimplementierung/-strategie nötig.

Die generischen Methoden `stageMerge`/`resolveMerge` bleiben für flache Testdatensätze vorgesehen. Der echte Vault-Adapter unterstützt das bestehende Schema und ist im explizit aktivierten Linux-Entwicklungsdialog an den manuellen Dateisync angebunden. Ausschließlich synthetische Test-Vaults verwenden. Eine allgemeine Konfliktauswahl pro Feld und produktive Freigabe sind noch offen. Es gibt keine generische Auflösung mehrerer gemeinsamer Basen oder automatische Auswahl bei mehr als zwei konkurrierenden Köpfen.

Die Neustarttests entschlüsseln und rekonstruieren die gespeicherte Geräteidentität, Mitgliedschaft und Historie. `acknowledgePublication` entfernt einen nach bestätigter Übertragung quittierten Eintrag aus der persistenten Upload-Warteschlange; eine Quittierung beweist keine dauerhafte Verfügbarkeit bei einem bösartigen Server. Vor dem Neustart erteilte Publikationsfreigaben sind danach ungültig. Der Snapshot-Dateiadapter `FileStore` bleibt von der strengeren lokalen Checkpointverwaltung getrennt und braucht vor Betriebsnutzung zusätzlich Quoten und Regeln für fremde Dateien/Symlinks. Echter Stromausfall und Windows-Dateisemantik wurden nicht geprüft.

Nach einer Mitgliedschaftsrotation können bereits lokal bekannte alte Objekte als Vorgänger dienen und aus dem lokalen Checkpoint mit archivierten signierten Mitgliedschaftsständen wiederhergestellt werden. Der Live-Abruf historischer Objekte aus alten Epochen sowie die Rotation des eigenen Geräteschlüssels sind noch nicht implementiert. Alte Uploads müssen vor erneuter Publikation für die aktuelle Empfängerliste neu verschlüsselt werden. Neue Objekte verwenden frische Schlüssel und enthalten keine Pakete für entfernte Empfänger; bereits empfangene Objekte bleiben für deren ehemalige Empfänger lesbar. Uploadfreigaben für bereits bestätigte Chargen bleiben bis zu fünf Minuten nutzbar. Es gibt keinen Anspruch auf Forward Secrecy gespeicherter Snapshots.

Die Schlüsselbuffer für temporäre Objektverschlüsselung und die von `lock` gehaltenen Schlüssel werden überschrieben. Export-/Restoremethoden enthalten vorübergehend auch private Schlüssel als JavaScript-Werte. Sie sind ausschließlich für den lokalen verschlüsselten Speicherpfad gedacht und dürfen weder geloggt noch übertragen werden. Extern gehaltene entschlüsselte JavaScript-Objekte, Passwörter als Strings und Kopien können nicht zuverlässig gelöscht werden; Swap-/Dump-Schutz bleibt eine separate Voraussetzung für Produktivbetrieb. `LocalState.lock` schließt keine extern gehaltenen Pairingkanäle automatisch; diese muss der Aufrufer separat schließen. Ein ehrlicher Client benötigt die Verwaltungsautorität für neue Publikationen; ein bösartiger berechtigter Client kann Daten, die er schon lesen darf, selbst weitergeben.

## Nachweise und nächste Arbeiten

Tests prüfen Offline-Merge, widersprüchliche Credentials, Löschen gegen Bearbeiten, Umschlagmanipulation, gefälschte Mitgliedschaft, fehlende Vorgänger, Replay, bekannte Rollbacks, Publikationsablauf, Objektbindung, Geräteentzug und verschlüsselte Dateien nach Wiederöffnung. Pairingtests prüfen den [unabhängigen Noise-C-Referenzvektor](fixtures/README.md), die Sperre vor beidseitiger Bestätigung, einen Vermittler mit zwei getrennten Kanälen, Identitätsnachweis-Manipulation, Einladungswiederverwendung, Ablauf und Framegrenzen. Das ist ein funktionaler Prototypnachweis, kein Audit der Kryptografie oder der Anwendungskomposition.

Als Nächstes im Passwort-Sync: allgemeine Konfliktauswahl und lokale Pfad-/Aktionsfreigaben, sichere Historienkompaktierung, Windows-Nachweis sowie produktive Betriebs- und Recovery-Verfahren. Authentifizierte Versionsbeziehungen, lokale Konsolidierung und manueller Vault-Arbeitsablauf sind als Linux-Entwicklungsprototyp implementiert. Die unabhängige Geräteprüfung muss dann mit echter Vermittlung statt der lokalen Zwei-Geräte-Simulation laufen. Der [Block-1-Entwurf](../../docs/plans/selfhosted-protocol.md) bleibt bis zu diesen Nachweisen und dem unabhängigen Protokollreview offen.

Beim Online-Abhängigkeitscheck am 2026-10-29 wurden sieben Paketbefunde (vier hoch, drei moderat) für bestehende Pakete gemeldet: Electron, Vite, Vitest/@vitest/mocker, Zod, Undici und fast-uri. Libsodium wurde nicht als betroffen aufgeführt. Diese Bestandsbefunde wurden hier nicht durch ungeprüfte globale Updates verändert und sind vor einer Produktivintegration zu bearbeiten. Ein Offline-Audit ist kein Nachweis ihrer Behebung.
