# Block 1: Protokollentscheidung und Offline-Sync

Stand: 2026-11-10 (H4; Hülle, Keybox, Epochen, Anmeldecode und Nachweis siehe „Schlüsselepochen, Anmeldecodes und Nachweis v4 (H4)“, davor „Origin-Bindung und Nachweisformat (H3.1)“). Architekturentscheidung und Linux-Entwicklungsprototyp; keine produktiv freigegebene oder auditierte Protokollimplementierung. Verknüpft mit [Plan](selfhosted-e2ee.md) und [Bedrohungsmodell](selfhosted-threat-model.md).

Aktuelle Sync-Entscheidung: Server-URL, Benutzername und Serverpasswort genügen seit H3 nur noch für die einmalige Einschreibung eines Geräts (seit H4 alternativ ein Anmeldecode von einem eingeschriebenen Gerät, und mit `invite-only` nur noch dieser); danach genügt dessen Signaturschlüssel für den Speicherzugriff. Das andere Vault-Passwort bleibt ausschließlich lokal; Fingerprintvergleich und Gerätefreigabe entfallen im normalen Sync. Der [Kontotransport](../../scripts/sync-prototype/README.md) implementiert gehashte Serverzugangsdaten, zeitlich begrenzte Sitzungen und unveränderliche verschlüsselte Objekte. Manueller `.term`-Abgleich, Import, authentifizierte Vorgänger und Offline-Konsolidierung sind im explizit aktivierten Linux-Entwicklungsprototyp angebunden. Produktivfreigabe, Windows und allgemeine Konflikt-/Pfadfreigaben fehlen noch. Die nachfolgenden Noise-/Geräte-Mitgliedschaftsabschnitte dokumentieren frühere, weiterhin isoliert getestete Experimente für mögliche spätere Freigaben. Sie sind keine Voraussetzung oder Produktivfreigabe des Kontosyncs.

### Implementiertes Passwort-Sync-Profil

`vault-sync.ts` verschlüsselt Versionen mitsamt Vorgänger-Hashes und portablen Vault-Daten. Seit H3 (Abschnitt „Geräteschlüssel und Sync-Schlüssel (H3)“) leitet HKDF-SHA-256 den Versionsschlüssel aus einem zufälligen Sync-Schlüssel ab, nicht mehr aus dem lokalen Vault-Schlüssel. Der lokale Sync-Zustand bleibt unter einem getrennt abgeleiteten Schlüssel des Vault-Schlüssels. Server-ID, Namespace, Hüllenart und Zweck sind in der AAD gebunden. Jede Version trägt einen Autorenstempel des Geräts, das sie erzeugt hat. Wer den Sync-Schlüssel besitzt, kann Versionen erzeugen; Serverpasswort allein genügt nicht. Diese Anwendungskomposition benötigt unabhängigen Review.

Neben dem Vault liegen `.sync-state` (verschlüsselte Historie, bestätigte Uploads, lokale Zweige und Übernahmezustand) und während des Abgleichs `.sync-state.lock`. Vor Upload wird der lokale Ausgang dauerhaft gespeichert; vor lokaler Übernahme werden Vorher-/Nachher-Hashes im Zustand und eine verschlüsselte Vault-Sicherung geschrieben. Datei und Verzeichnis werden auf Linux vor Abschluss der Sync-Transaktion geflusht. Wiederanlauf unterscheidet den alten und bereits übernommenen Stand; unbekannte Zwischenstände sperren die Übernahme. Ein Stromausfall auf realer Hardware wurde damit noch nicht nachgewiesen.

Konflikte bleiben verschlüsselt erhalten. Für zwei Zweige mit gemeinsamer Basis ist die ausdrückliche Auswahl „lokale Verbindungsdaten behalten“ bei reinen Verbindungskonflikten möglich; sie ist an die geprüfte Historie und den lokalen Vault-Stand gebunden. Geänderte Stände verlangen erneute Bestätigung. Andere Konfliktarten, mehrere gemeinsame Basen und mehr als zwei Köpfe benötigen noch eine allgemeine Auflösung. Es gelten 64 Versionen und 12 MiB verschlüsselte Historie pro Client; sichere Kompaktierung ist offen. Der Server kann unbekannte Zweige weiterhin zurückhalten. Bekannte bestätigte, später fehlende Objekte werden erkannt.

## Entscheidung: Lokale Datei, Konsolidierung auf den Clients

Die lokale verschlüsselte `.term`-Datei bleibt nutzbar, auch ohne Server. Der Sync ist ausschließlich zentral: Alle Geräte verwenden dieselbe gewählte Server-URL, es gibt keinen PC-zu-PC-Sync. Geräteprüfung/Pairing ist davon getrennte Autorisierung. Offline lesen, verbinden und bearbeiten muss weiterhin funktionieren. Der Server ist Zusteller und Speicher verschlüsselter Versionen. Ob er Dateien oder Datenbankzeilen verwendet, ändert weder das Datenmodell noch die Sicherheitsgrenze.

Die Konsolidierung erfolgt nach dem Entschlüsseln auf einem berechtigten Client. Eine Datei nur anhand von Zeitstempeln auszutauschen, würde gleichzeitige Änderungen verlieren. Deshalb wird neben dem lokalen Vault ein **verschlüsselter Sync-Zustand** geführt: bekannte Vorgänger, noch nicht übertragene Änderungen, Konfliktvarianten, Mitgliedschaft und zuletzt verifizierte Vergleichspunkte. Dieser Zustand ist rekonstruierbar bzw. exportierbar; eine allein kopierte alte Vault-Datei wird nicht automatisch als aktuelle Sync-Historie akzeptiert.

MVP: vollständige verschlüsselte Snapshots mit authentifizierten Vorgängerbeziehungen statt sofort eines CRDT oder einer einzelnen überschreibbaren Serverdatei. Die Objektanzahl wird begrenzt; Aufbewahrung und sichere Kompaktierung folgen vor Produktivbetrieb. Fehlende Vorgänger bewirken Nachladen oder einen sichtbaren ungeprüften Zustand, keinen geratenen Merge.

### Konsolidierungsregeln

Verglichen werden gemeinsame Basis, lokaler Stand und empfangener Stand. Mehr als zwei konkurrierende Zweige bleiben als mehrere Köpfe erhalten; ein Merge nennt sämtliche übernommenen Vorgänger. Weder Serverzeit noch `updatedAt` entscheidet über den Gewinner.

| Änderung seit gemeinsamer Basis | Ergebnis |
| --- | --- |
| Nur eine Seite hat geändert | Änderung übernehmen |
| Beide Seiten erzeugen denselben Wert | Ein Wert; beide Ursprünge erhalten |
| Unterschiedliche Verbindungen wurden geändert | Nach stabilen IDs zusammenführen |
| Verschiedene unabhängige Eigenschaften einer Verbindung wurden geändert | Zusammenführen, sofern keine gekoppelte Sicherheits-/Schemaeinheit betroffen ist |
| Credentials, Ziel/Protokoll/Benutzer, Jump-Host, Befehle oder Weiterleitungen werden konkurrierend verändert | Betroffene zusammengehörige Konfiguration als Konflikt behandeln; keine neue Kombination automatisch erfinden |
| Dieselbe Eigenschaft erhält verschiedene Werte | Beide Werte verschlüsselt bewahren; Nutzer entscheidet |
| Löschen gegen Bearbeiten oder widersprüchliches Verschieben | Konflikt, keine stille Löschung oder Wiederherstellung |
| Reihenfolge, Layout, Toolbar oder komplexe Listen gleichzeitig verändert | Zunächst als vollständige Einheit konfliktbehaftet; keine generische Array-Verschmelzung |
| Gleiche ID wird unabhängig neu angelegt | Kollision als Konflikt; nichts überschreiben |

Konfliktbehaftete Verbindungen dürfen bis zur Auflösung nicht automatisch gestartet werden. Ein bestätigter Merge ist eine neue authentifizierte Version; jede Variante bleibt bis zur vereinbarten Aufbewahrungsgrenze wiederherstellbar. Unaufgelöste Konflikte sperren keine unabhängigen Änderungen.

Beispiel: Basis enthält Server A und B. Gerät 1 ändert offline A, Gerät 2 offline B. Nach Wiederverbindung enthält der Vault beide Änderungen. Ändern beide das Passwort von A unterschiedlich, zeigt Shellherd einen Konflikt mit maskierten Werten; keine Auswahl nach Uhrzeit.

Vor jedem Merge werden Schema und Vault-Konsistenz geprüft. Ordnerzyklen, doppelte IDs, verwaiste Workspace-/Jump-Host-Referenzen und nicht unterstützte Formate verhindern die Übernahme. Ein gültiges Format allein macht einen sicherheitskritischen Merge noch nicht zulässig.

### Lokale Bindungen und Speichern

- `authentication.keyPath`, lokale Uploadpfade, Arbeitsverzeichnisse und lokale kubeconfig-Pfade sind gerätespezifische Bindungen. Ein synchronisierter Pfad ist kein übertragener privater Schlüssel und keine Freigabe für automatischen Upload auf einem neuen Gerät.
- Neue Geräte müssen solche Bindungen explizit herstellen. Autoupload, Startbefehle und andere automatische Aktionen erhalten durch Sync keine neue Zustimmung. Die genaue Aufteilung in portable Daten und Geräteüberschreibungen ist eine Voraussetzung für Block 3.
- Zunächst Sync nur bei entsperrtem Vault. Gesperrt bleibt die zuletzt gespeicherte Datei nutzbar, aber es erfolgt keine automatische Entschlüsselung/Konsolidierung im Hintergrund.
- Lokales Speichern bestätigt erst nach dauerhaftem Schreiben. Vault und Sync-Zustand benötigen einen verschlüsselten, absturzsicheren Wiederanlaufmechanismus mit Transaktions-ID. Nach Stromausfall darf weder ein verlorener Upload als erledigt gelten noch eine lokale Änderung verschwinden.
- Uploads sind idempotent; ein wiederholtes Objekt erzeugt keine zweite Änderung. Erst geprüfter Serverabruf/Receipt bestätigt Übertragung, aber nicht dauerhafte Verfügbarkeit bei bösartigem Server. Lokale Backups bleiben erforderlich.
- Ein extern veränderter Vault wird als lokale neue Variante importiert, niemals ungeprüft über andere Geräte kopiert. Ohne gemeinsame Basis bleibt die Konfliktauflösung ausdrücklich statt automatisch.

## Vergleich bestehender Ansätze

| Ansatz | Eignung | Entscheidung für den Prototyp |
| --- | --- | --- |
| TLS allein | Schützt Transport zum Server; Server ist Endpunkt | Zusätzlich verwenden, ersetzt keine E2EE |
| Noise | Authentifizierter interaktiver Schlüsselaustausch und Transport; Anwendung muss Identitäten/Rechte prüfen | Pairing im Node-Prototyp implementiert; Dauer-/Remote-Sitzungen separat prüfen |
| MLS (RFC 9420) | Asynchrone Gruppen-Schlüsselverwaltung mit Epochen, FS und PCS | Spätere Mehrteilnehmersitzungen separat bewerten; löst Vault-Merges und Recovery nicht |
| Libsodium | Bestehende Signatur-, AEAD- und Empfängerverschlüsselungsbausteine | Für persistente verschlüsselte Snapshot-Umschläge und Signaturen auswählen, Integration noch nachweisen |
| Automerge | Replizierte Dokumente, Offline-Änderungen und Konfliktinformationen | Kein MVP-Zwang; semantische Sicherheitskonflikte müssten trotzdem explizit behandelt werden |

Quellen: [Noise-Spezifikation](https://noiseprotocol.org/noise.html), [MLS](https://www.rfc-editor.org/rfc/rfc9420.html), [Automerge-Konflikte](https://automerge.org/docs/reference/documents/conflicts/). Diese Auswahl ist eine Architekturabwägung, keine Aussage, dass die zusammengesetzte Anwendung dadurch automatisch sicher ist.

## Kryptografisches Profil für den Prototyp

### Getrennte Schlüssel und Zuständigkeiten

| Schlüssel | Aufgabe | Lebensdauer / Zugriff |
| --- | --- | --- |
| Lokaler Vault-Schlüssel | Lokale `.term`-Verschlüsselung | Bleibt lokal; vorhandenes AES-256-GCM-/Argon2id-Format zunächst beibehalten |
| Geräte-Signaturschlüssel | Gerätebesitz und Herkunft von Versionen | Pro Gerät eigener Ed25519-Schlüssel; nicht als Verschlüsselungsschlüssel verwenden |
| Geräte-Empfängerschlüssel | Verschlüsselte Zustellung von Objektgeheimnissen | Separates X25519-Schlüsselpaar pro Gerät, Rotation unabhängig von Signaturidentität |
| Noise-Identität und ephemere Schlüssel | Authentifizierte interaktive Kanäle | Separate statische Identität; ephemere Schlüssel je Handshake; keine Vault-Schlüssel ableiten |
| Objekt-Schlüssel | Verschlüsselung genau eines Snapshots | Frisch zufällig je Objekt; nur für aktuelle berechtigte Empfänger verpackt |
| Verwaltungsautorität | Geräte hinzufügen/entfernen, Schlüsselbindungen autorisieren | Separater Signaturschlüssel; im MVP genau ein ausdrücklich bestimmtes Verwaltungsgerät |
| Recovery-Geheimnis | Optionale Wiederherstellung | Separat erzeugt, offline beim Nutzer; kein Masterpasswort beim Server |

Verwaltungs- und Geräteidentität sind getrennt. Ein schreibberechtigtes Sync-Gerät darf keine weiteren Geräte einschleusen. Mehrere gleichberechtigte Verwaltungsgeräte und deren konkurrierende Mitgliedschaftsänderungen sind zunächst ausgeschlossen.

Für Snapshot-Inhalte ist `crypto_aead_xchacha20poly1305_ietf_*` mit frischem Objekt-Schlüssel und zufälliger 192-Bit-Nonce vorgesehen. Der Header wird als AAD gebunden. Libsodium dokumentiert diese AEAD und die Möglichkeit zufälliger Nonces: [XChaCha20-Poly1305](https://doc.libsodium.org/secret-key_cryptography/aead/chacha20-poly1305/xchacha20-poly1305_construction).

Der Objekt-Schlüssel wird für jeden berechtigten Empfänger separat mit `crypto_box_seal` verpackt. **Sealed boxes authentifizieren den Absender nicht.** Deshalb muss die Geräte-Signatur den kompletten Umschlag einschließlich Empfängerbindung, Schlüsselpaketen, Nonce, Header und Ciphertext erfassen. Die Autorisierung des Signaturschlüssels wird unabhängig geprüft: [Sealed boxes](https://doc.libsodium.org/public-key_cryptography/sealed_boxes).

Das ist ein noch zu reviewendes Anwendungsformat aus bestehenden Bausteinen. Es erhält vor dem Review keine Produktivfreigabe. Dauerhaft gespeicherte Snapshots mit wiederherstellbaren Objekt-Schlüsseln bieten keine pauschale Forward-Secrecy-Garantie. Der Diebstahl eines passenden Empfängerschlüssels kann gespeicherte frühere Umschläge gefährden. Sitzungsschlüssel und deren Löschung werden getrennt betrachtet.

### Authentifizierter Snapshot-Umschlag

Zu binden sind mindestens: Protokoll-/Formatversion, eindeutige zufällige Objekt-ID, opaker Vault-/Sync-Kontext, Autor, autorisierte Schlüsselversion, Mitgliedschaftsstand, Empfänger samt Schlüsselversion, Vorgänger-IDs, Cipher-Suite, Nonce, Schlüsselpakete und Ciphertext. Klartext-Inhalts-Hashes werden nicht veröffentlicht. Ein Hash des finalen Umschlags kann als Objektadresse dienen.

Vor Implementierung sind exakte Kodierung und Signaturbytes festzulegen: strikt versioniertes Schema, feste Größenlimits, eindeutig kanonische Bytes, keine doppelten Felder und keine Signatur über beliebig reserialisiertes JSON. Kontexttrennung muss Verwechslungen zwischen Sync, Pairing, Recovery und Sitzungen ausschließen. Server bekommt keine Verbindungstitel, Hosts, Credentials oder Konfliktinhalte; äußere Herkunft und Vorgängerbeziehungen sind trotzdem sichtbare Metadaten.

## Pairing und interaktive Sitzungen

Aktuelles Node-Prototypprofil: `Noise_XX_25519_ChaChaPoly_BLAKE2b` mit `noise-handshake` 4.2.0; ersetzt ausdrücklich den ursprünglichen Kandidaten mit BLAKE2s. Kein Downgrade oder automatischer Profilwechsel. Die Auswahl ermöglicht einen Node-Nachweis ohne hier nicht verfügbare Rust-Toolchain; der gemeinsame native Kern bleibt zu evaluieren. Der Handshake liefert zunächst einen verschlüsselten Kanal zu einem noch nicht verifizierten Gegenpart. Vor Übertragung von Vault-Daten, Objekt-Schlüsseln oder Verwaltungsrechten müssen beide Seiten Identität und Transkript unabhängig verifizieren.

MVP-Pairing benötigt beide Geräte gleichzeitig: QR-/vollständiger Fingerprintvergleich über einen unabhängigen Weg, mit Bindung an das konkrete Handshake-Transkript und die vollständigen getrennten öffentlichen Schlüssel. Ein Anzeigename, eine Geräte-ID oder ein vom Server gelieferter QR-Code genügt nicht. Kurze Zahlencodes sind erst nach spezifiziertem Entropie-/Ratelimit-Konzept zulässig. Eine Einladung dient zunächst nur dem Auffinden; sie ist kein Zugangsschlüssel.

Nach Verifikation autorisiert das Verwaltungsgerät die Gerätebindung mit konkretem Zweck und Zugriff. Neues Gerät bekommt einen authentifizierten Vergleichspunkt der Mitgliedschaft und Sync-Historie. Einladung verfällt nach fünf Minuten, ist einmal verwendbar und führt ohne Bestätigung niemals zur Datenfreigabe. Das sind vorgeschlagene Produktlimits, keine Protokolleigenschaften.

Für spätere bekannte Geräte werden gepinnte Identitäten geprüft; Wiederverbindung startet einen neuen Handshake ohne wiederverwendete ephemere Schlüssel. Keine Nutzdaten vor abgeschlossener Authentifizierung/Autorisierung, kein 0-RTT für Eingaben. Prologue bindet Anwendungsversion, Zweck und Kontext. Geordneter zuverlässiger Transport, begrenzte Frames und getrennte Richtungszustände; Medienoptimierung über UDP wäre eine eigene Entscheidung.

Noise liefert keine Zugriffsverwaltung. Bildschirm-/Eingaberechte bleiben am Quellgerät. Im MVP gilt ausschließlich lokale Zustimmung pro Remote-Sitzung; bestehende Verbindungen sind kein unbeaufsichtigter Zugriff.

## Mitgliedschaft, Widerruf und Offline-Änderungen

Mitgliedschaft ist eine von der Verwaltungsautorität signierte Folge mit Vorgängerbindung und monotoner Version. Clients pinnen den letzten bestätigten Vergleichspunkt. Der Server kann weder neue Empfänger noch höhere Rechte hinzufügen. Objekt-Autorisierung muss zum erlaubten Mitgliedschaftsstand passen; eine gültige Gerätesignatur allein genügt nicht.

**Aktualität ist eine eigene Anforderung:** Ein Server kann einen gültigen älteren Mitgliedschaftsstand zurückhalten. Der zunächst getestete fünfminütige Online-Publikationsnachweis je Charge bleibt ein isoliertes Sicherheits-Experiment. Er wird nicht als Voraussetzung des zentralen Sync übernommen: Der Regelbetrieb muss ohne einen zweiten eingeschalteten PC und ohne eine pro Upload verfügbare Verwaltungsautorität funktionieren.

Der HTTP-Transportprototyp nutzt bereits verifizierte, feste E2EE-Mitgliedschaften und separate serverseitige öffentliche Geräte-ACLs. Letztere unterstützen inzwischen selbstsignierte Geräteanfragen, unabhängigen vollständigen Fingerprintvergleich, signierte Verwaltungsfreigabe sowie persistenten Entzug. Anfragen verfallen nach fünf Minuten; bestätigte ACL-Revisionen werden atomar gespeichert und auf dem Verwaltungsclient gepinnt. Diese Transportfreigabe stellt keine Vault-Schlüssel zu und löst nicht das dynamische E2EE-Widerrufsmodell. Jeder Client kann seine signierten E2EE-Versionen unabhängig hochladen und vom Server abrufen. Die Verwaltungsautorität wird für Geräteaufnahme/-entzug gebraucht, nicht für jeden normalen Dateiabgleich. Private Verwaltungs- oder Vault-Schlüssel werden deshalb auch nicht auf dem Server abgelegt.

Vor Produktivfreigabe muss ein geprüftes Modell für signierte Mitgliedschaftsaktualität, maximal begrenzte Restgültigkeit und Widerruf gegen einen bösartig zurückhaltenden Server feststehen. Ohne neue vertrauenswürdige Information kann ein Offline-Client einen Entzug nicht erkennen. Konkrete Fristen/Erneuerungsregeln und die Behandlung zuvor offline erzeugter Versionen sind noch offen; der feste Testgerätebestand ist kein Nachweis dieser Produktionsanforderung.

Ein wiederkehrendes entzogenes Gerät darf keine automatische Konsolidierung erzwingen. Dessen Änderungen werden separat lokal quarantänisiert und nur nach expliziter Prüfung als neue Version übernommen. Zeitstempel beweisen nicht, dass diese Änderungen vor dem Widerruf entstanden. Serverseitiges Ablehnen ergänzt die Prüfung; die Endgeräte bleiben maßgeblich.

Das noch festzulegende Widerrufs-/Aktualitätsmodell betrifft neue Publikation. Für das Lesen alter Versionen ist keine Onlinefreigabe erforderlich. Der Server kann bekannte Vergleichspunkte nicht unbemerkt zurückdrehen; vollständige Resets benötigen Pairing oder Recovery. Ein global neuester Stand lässt sich gegen einen blockierenden Server nicht immer beweisen.

## Recovery, Schlüsselablage und Updates

Recovery ist für den ersten Verbindungs-/Sync-Prototyp deaktiviert. Geht die Verwaltungsautorität verloren, bleiben lokale Dateien lesbar, aber die Geräteverwaltung muss explizit neu aufgebaut werden. Vor Produktbetrieb wird die optionale Offline-Recovery spezifiziert: verschlüsseltes Recoverypaket, authentifizierte Historienanker und Rotation aller kompromittierbaren Berechtigungen. Ein neues Gerät allein mit Serverdaten wird niemals still zum Verwalter.

Private Geräte-/Verwaltungsschlüssel werden verschlüsselt lokal gespeichert und nur bei ausdrücklichem Entsperren genutzt. OS-Schlüsselablage ist eine optionale Schutzschicht nach Plattformprüfung; kein stiller Klartext-Fallback. Die vorhandene Vault-Verschlüsselung wird nicht ungeprüft um Geräteschlüssel erweitert. Speicherzugriff des Renderers und IPC-Rechte sind vor Integration zu überprüfen.

Agent-Updates benötigen einen gesonderten, im installierten Client verankerten Release-Verifikationsschlüssel. Der Rendezvous-Server ist keine Release-Autorität. Release-Metadaten binden Hash, Plattform, Version und zulässigen Kanal. Pakete werden vor Ausführung geprüft, bekannte Rückschritte abgewiesen. Schlüsselwechsel/-verlust, Betrieb ohne automatische Updates sowie reproduzierbare Prüfung werden vor Block 4 konkretisiert. Dafür wird eine etablierte Update-Lösung evaluiert; hier wird kein eigenes Updateformat freigegeben.

## Bibliotheken und Freigabeschritte

Kandidaten: [libsodium.js / libsodium-wrappers](https://github.com/jedisct1/libsodium.js) im Electron-Main-/isolierten Prozess, native Libsodium auf Agentseite; [snow](https://github.com/mcginty/snow) für Noise in einem gemeinsamen nativen Kern. Die Quellen dokumentieren WASM-/JavaScript-Wrapping beziehungsweise eine Rust-Noise-Implementierung. Im isolierten Node-Prototyp sind `libsodium-wrappers` 0.8.4 und [noise-handshake](https://github.com/holepunchto/noise-handshake) 4.2.0 als Entwicklungsabhängigkeiten installiert und funktional geprüft. Electron-/Agent-Plattformbuilds, Speicherverhalten, vollständiger Sicherheitsreview und ein gemeinsamer nativer Kern sind noch offen.

Der erste technische Schritt nach diesem Entwurf ist ein isolierter Interoperabilitätsprototyp, nicht sofort ein öffentlich erreichbarer Server:

1. Bibliotheksversionen und unterstützte Plattformen fixieren; Windows-/Linux-/Electron-Anbindung und bestehende Testvektoren prüfen.
2. Exakte Umschlagkodierung und Mitgliedschafts-/Publikationsnachweise festlegen; zwei Clients verschlüsseln, signieren und lesen gegenseitig. Kontexttausch, falscher Empfänger, manipulierte Pakete und Neustart/Replay müssen fehlschlagen.
3. Drei Offline-Clients gegen einen simulierten bösartigen Speicher testen: parallele Änderungen, mehrfache Köpfe, fehlende Basis, doppelte Zustellung, Konfliktauflösung und Absturz während Speichern.
4. Pairing-MITM und Schlüsselersetzung prüfen; vor Verifikation darf kein Vault-Geheimnis übertragen werden.
5. Entzug während Offlinebetrieb/Publikation, abgelaufene Freigabe und Server-Rollback prüfen. Limits als Tests statt bloßer Dokumentation festhalten.
6. Protokollzusammensetzung vor Implementierungsfreigabe unabhängig reviewen. Ein späterer externer Gesamtaudit bleibt zusätzlich erforderlich.

Block 1 ist damit als Entscheidungsentwurf ausgearbeitet. Die Abnahme bleibt bis zu Kodierung, Interoperabilitätsnachweis und Review offen. Block 2 darf noch keine ungeprüften produktiven Secrets übernehmen.

## Geräteschlüssel und Sync-Schlüssel (H3, Entwicklungsprototyp)

Spec `docs/superpowers/specs/2026-11-09-device-keys-design.md`, Validierungs-Anhang `…-validation.md` geht vor. Nur Node-`crypto`, keine neue Kryptografie-Bibliothek, keine Sicherheitsfreigabe. Der alte Gerätemodus (`account === null`) bleibt unberührt.

- **Identität:** Je Gerät ein X25519-Schlüssel (Noise-Statik, Fingerabdruck, Pins; die Geräte-ID ist `sha256(SPKI)` des X25519-Schlüssels) und zusätzlich ein Ed25519-Signaturschlüssel. Beide liegen in einer Identitätsdatei (v3), die beide Labs gemeinsam nutzen. Es gibt keine Umrechnung zwischen den Schlüsselarten.
- **Einschreibung:** `POST /v1/devices` mit Benutzername, Passwort und Einschreibedokument `[[ 'shellherd-device-enrollment-v2', serverId, namespace, origin, deviceId, signingKey, noiseKey, name ], signature]` (8-Tupel, seit H3.1 mit Origin). Die Signatur (Ed25519 über `JSON.stringify(body)`) beweist den Besitz des Signaturschlüssels, nicht des X25519-Schlüssels (der Besitz wird in der Rendezvous-Registrierung weiter geprüft). Erneutes Einschreiben mit gleichen Schlüsseln aktualisiert den Namen und hebt einen Widerruf auf; gleiche ID mit anderen Schlüsseln ergibt 409. Ein Gerät ohne Schlüsselablage meldet `ephemeral: true`; der Server hält es nur im RAM.
- **Sitzung:** `GET /v1/challenge` liefert eine einmalige Nonce (64 Hex-Zeichen, 30 s, wird auch bei falscher Signatur verbraucht; Format siehe H3.1). `POST /v1/session` mit Gerät und Signatur über `JSON.stringify(['shellherd-device-session-v2', serverId, namespace, origin, nonce, deviceId])` liefert das 15-Minuten-Token, an das Gerät gebunden. Der Client signiert nur gegenüber der bei der Einschreibung gepinnten URL. `POST /v1/login` gibt es nicht.
- **Roster und Widerruf:** `GET /v1/devices` listet Geräte mit Schlüsseln (der Client prüft sie und berechnet `self` lokal). `DELETE /v1/devices/<id>` ist zusätzlich signiert (`['shellherd-device-request-v3', serverId, namespace, origin, method, path, nonce, deviceId]` (8-Tupel), Header `x-shellherd-device`, `x-shellherd-nonce`, `x-shellherd-signature`, leerer Body). Der Widerruf entfernt die Sitzungen und die Rendezvous-Präsenz des Geräts sofort.
- **Objekthülle (seit H4 Version 2 mit `epoch`, siehe unten):** `{ format: 'shellherd-sync-object', version: 1, kind: 'version' | 'keybox', cipher: { algorithm: 'aes-256-gcm', nonce, authTag }, payload }`, kanonisches JSON, ID `sha256(wire)`. Kein KDF-Profil in der Hülle. Die AAD ist `stable(['shellherd-sync-object', 1, kind, serverId, namespace])`; Hüllenart, Server und Namespace sind damit gebunden. Das Altformat `terminus-encrypted-vault` lässt der Server beim Lesen zu, beim `PUT` nicht; Clients behandeln es als fremdes Objekt.
- **Sync-Schlüssel (seit H4 je Epoche, siehe unten):** `K_sync` sind 32 Zufallsbytes, vom ersten Gerät beim ersten Abgleich eines leeren Kontos erzeugt. Versionsschlüssel `HKDF-SHA256(K_sync, salt = JSON([serverId, namespace]), info = 'shellherd-sync-version-v2', 32)`.
- **Keybox (seit H4 v2 mit Epoche, Methode und `adopts`):** Klartext `{ kind: 'shellherd-sync-keybox-v1', method: 'recovery', syncKey, createdBy }`. Der Schlüssel ist `HKDF(code, salt, 'shellherd-sync-keybox-recovery-v1')` über einem 128-Bit-Wiederherstellungscode (32 Hex-Zeichen, Anzeige in Vierergruppen). 128 Bit Zufall brauchen kein Argon2. Der Code wird einmal angezeigt und ist nie Teil des Dialogzustands. Jedes Gerät mit `K_sync` konnte in H3 einen neuen Code ausstellen (`regenerateRecoveryCode`); seit H4 entfällt das, die Rotation ersetzt es. Der Bootstrap schreibt vor dem `PUT` einen Checkpoint und bestätigt danach per Listing, damit zwei Geräte nicht gleichzeitig Wurzeln anlegen.
- **Autorenstempel (seit H4 v2 mit Epoche):** `author: { device, at, signature }` in der Version, Ed25519 über `['shellherd-sync-author-v1', serverId, namespace, parents, compacts ?? [], sha256(stable(portable)), device, at]`. Die Roster-Prüfung beim Empfang ordnet jede Version und Kompaktierung einem Gerät zu. Versionen eines widerrufenen Geräts mit `at ≥ revokedAt` oder ungültiger Signatur werden zurückgehalten (Quarantäne), außer sie sind Vorfahren einer aktiven Version oder bereits bestätigt. Unbekannte Autoren bleiben gültig und werden gezählt.
- **Lokaler Zustand (seit H4 Checkpoint v3 innen):** `.sync-state` v3 (H3.1; v2 bleibt lesbar) trägt `syncKey`, unter einem aus dem Vault-Schlüssel abgeleiteten Schlüssel. Ein v1-Zustand führt zu `syncMigrate`. Seit H3.1 steht der Klartext-Kontext (Server-ID, Namespace) im äußeren Rahmen `['shellherd-private-sync-state-v3', context, sealed]` und wird vor dem Entschlüsseln verglichen; ein anderer Server ergibt `syncOtherServer`, ohne dass etwas geändert wird.
- **Grenzen:** Siehe Bedrohungsmodell „Stand H3“ und „Stand H3.1“. Keine Vektoruhren, keine signierten Tombstones. Die Rotation von `K_sync` kam mit H4.

## Origin-Bindung und Nachweisformat (H3.1, Entwicklungsprototyp)

Spec `docs/superpowers/specs/2026-11-10-holistic-hardening-design.md`, Validierungs-Anhang `…-validation.md` geht vor. Lab-Bruch: Alte Nachweise und Einschreibungen sind ungültig, es gibt keinen Kompatibilitätspfad.

- **Origin:** Der Server kennt seine öffentliche Origin ausschließlich aus `SHELLHERD_SERVER_ORIGIN` (Schema und Host in Kleinschreibung, ohne Standardport, ohne Pfad); im Modus `enrolled-device` ist sie Pflicht, nie wird der Host-Header genutzt. Die Bibliothek `createSyncServer` nimmt ohne `origin` die Listen-Origin (Tests, Szenen, Smoke auf Loopback). Der Client nimmt `new URL(url).origin` der eingegebenen URL.
- **Neue Tags und Tupel:** Einschreibung `shellherd-device-enrollment-v2` über `[tag, serverId, namespace, origin, deviceId, signingKey, noiseKey, name]`; Sitzung `shellherd-device-session-v2` über `[tag, serverId, namespace, origin, nonce, deviceId]`; Widerruf/Anfrage `shellherd-device-request-v3` über `[tag, serverId, namespace, origin, method, path, nonce, deviceId]` (seit H4 `-v4` mit Body-Digest, siehe unten). Die erhöhten Tags sorgen dafür, dass ein alter Nachweis nie als neuer gelten kann; die Origin sorgt dafür, dass ein Nachweis für Server A bei Server B (gleiche `serverId`) mit 401 scheitert. Der Server prüft die Origin im Dokument gegen die eigene. Der Rendezvous-Registrierungsnachweis bleibt an `serverId` gebunden, ohne Origin (er verlangt ein gültiges Token, und Tokens gibt es nur bei der echten Origin).
- **`/v1/info`:** liefert zusätzlich `origin`. Weicht sie von der eingegebenen Origin ab, meldet der Client sofort einen Verbindungsfehler („URL prüfen“), statt später eine irreführende Anmeldefehlermeldung zu zeigen.
- **Nonce:** zustandslos, 64 Hex-Zeichen aus Zeitstempel, Zufall und HMAC mit einem Schlüssel, der nur im RAM des Servers liegt. Gültigkeit 30 s, genau einmal; verbrauchte Nonces merkt der Server bis zum Ablauf (höchstens 4096; ist die Menge voll, antwortet der Server mit 429).
- **Roster v2 (seit H4 v3 mit `enrolledBy`):** `objects/devices.json` mit `version: 2`, Schema sonst unverändert. Eine Datei mit `version: 1` führt zu einem Startfehler mit Hinweis (Datei wegschieben, Geräte neu einschreiben); dasselbe gilt für `list-devices` und `revoke-device`.
- **Checkpoint v3:** siehe „Lokaler Zustand“ oben (Server-ID im Klartext-Rahmen).
- **Gerätename:** eine Regel für Server, Hosts und Renderer (`src/shared/device-name.ts`, Parität zu `scripts/sync-prototype/device-name.mjs`): Unicode-Buchstaben, Ziffern, Leerzeichen und `-_.,()'` nach NFC, 1–64 Codepoints; Steuer- und Formatzeichen sowie eine Folge von 8 oder mehr Hex-Zeichen (auch über Trennzeichen oder Lookalikes hinweg) sind verboten.

## Schlüsselepochen, Anmeldecodes und Nachweis v4 (H4, Entwicklungsprototyp)

Spec `docs/superpowers/specs/2026-11-10-key-epochs-design.md`, Validierungs-Anhang `…-validation.md` geht vor. Nur Node-`crypto`. Lab-Bruch: alte Hüllen, Zustände und Nachweise gelten nicht mehr; eingeschriebene Geräte bleiben eingeschrieben (Einschreibedokument, Roster-Schlüssel und Geräte-ID unverändert).

**Hülle v2.** `{ "format": "shellherd-sync-object", "version": 2, "kind": "version" | "keybox", "epoch": <ganze Zahl 1…1 000 000>, "cipher": {...}, "payload": "<b64>" }`, kanonisch in genau dieser Schlüsselreihenfolge, ID weiter `sha256(wire)`. Server (`validateSyncObject`) und Client (`parseSyncEnvelope`) prüfen `version === 2` und die Epoche. Hüllen v1 gelten als Altformat (auf der Platte lesbar, `PUT` gibt 400). AAD: `stable(['shellherd-sync-object', 2, kind, epoch, serverId, namespace])`.

**Schlüssel je Epoche.** Versionsschlüssel `HKDF-SHA256(K_sync_e, salt = JSON([serverId, namespace, e]), info = 'shellherd-sync-version-v3', 32)`. Der Bootstrap legt Epoche 1 an. Ein Wiederherstellungs- oder Anmeldecode öffnet genau eine Epoche; die Epoche steht in der Hülle, der Client probiert den Code gegen die Keyboxen dieser Epoche (sortiert nach ID, höchstens 100 = Kontolimit).

**Keybox v2.** Klartext `{ kind: 'shellherd-sync-keybox-v2', method: 'recovery' | 'invite', epoch, syncKey, createdBy, adopts }`; das Schema ist strikt, `epoch` gleicht der Hüllen-Epoche, `adopts` hat höchstens 512 eindeutige IDs. Wrap `recovery`: `HKDF(code16, salt = JSON([serverId, namespace, epoch]), 'shellherd-sync-keybox-recovery-v2')`. Wrap `invite`: `HKDF(code16, salt wie oben, 'shellherd-sync-keybox-invite-v1')`. Der recovery-Wrap öffnet nur `method: 'recovery'`, der invite-Wrap nur `method: 'invite'`. `adopts` enthält alle Versions-IDs (`graph.values` ∪ `graph.compacted`), die der Rotierende in der alten Epoche kannte; sie steht in **jeder** Keybox der Epoche und im Checkpoint, nicht in der Version (Kompaktierung darf die Wurzel entfernen).

**Autorenstempel v2.** Ed25519 über `['shellherd-sync-author-v2', serverId, namespace, epoch, parents, compacts ?? [], sha256(stable(portable)), device, at]`. Die innere Version behält `kind: 'shellherd-sync-version-v2'`.

**Checkpoint v3 (innen).** `{ kind: 'shellherd-sync-state-v3', epoch, syncKey, adopts, keybox?, invites?: {id, at}[] (≤ 16), versions, acked, localHeads, working, projection, pending? }`. Ein innerer v2-Zustand ergibt `migrate` (`syncMigrate`). `keybox` ist der Pending-Marker wie beim Bootstrap, `invites` führt die eigenen Einladungs-Keyboxen zum Aufräumen (nach 20 Minuten).

**Rotation `rotateSyncKey`.**

1. Vorbedingungen (sonst `rotateBlocked`): kein `pending` und kein `keybox`-Marker, genau ein Kopf, `localHeads == heads`, lokaler Vault gleicht `projection` (keine ungesyncten Änderungen). Im Listing: eine höhere Epoche ergibt `rotated`; eine nicht lesbare Version der aktuellen Epoche `foreignKey`; eine lesbare, aber weder im Graph noch in `compacted` bekannte Version `rotateBlocked` (ein anderes Gerät hat nach dem letzten Abgleich hochgeladen); mehr als 98 Objekte `limit` (Platz für zwei neue); `remote.remove` ist Pflicht.
2. `K' = randomBytes(32)`, neuer Wiederherstellungscode, `e' = e + 1`, `adopts'` aus Graph und `compacted`. Neue Wurzel `V'` = Inhalt des Kopfs, `parents: []`, unter `K'`; Keybox `recovery` für `e'`.
3. Checkpoint **zuerst** schreiben (Epoche `e'`, `K'`, `keybox`-Marker, `acked: []`), den alten Stand im Speicher halten.
4. `PUT` Keybox, `PUT` `V'`; zweites Listing. Eine fremde Hülle mit Epoche `≥ e'` ist ein Rennen (`rotateRaced`), eine unbekannte lesbare Version der Epoche `e` ein Überholen (`rotateBlocked`). In beiden Fällen nimmt die Rotation die eigenen Objekte zurück und setzt den Checkpoint auf den alten Stand.
5. `acked = [id(V')]`, dann Aufräumen aller Objekte mit Epoche `< e'` (Housekeeping: beim ersten Fehler leise stoppen; ein Abbruchsignal nimmt die Rotation nicht zurück, der Marker bleibt). `settle` löscht den Marker und liefert den Code.

**Aufräumen und Epochenprüfung in jedem Lauf.** Objekte mit Epoche `< state.epoch` werden am Laufanfang nur aus dem Listing genommen und erst am Ende eines Laufs mit Status `synced` best effort gelöscht (und `confirmKeybox` ignoriert sie). Eine Hülle mit Epoche `> state.epoch` ergibt ohne Code `rotated` (nichts wird geschrieben, der Vault bleibt), mit Code die Adoption.

**Adoption (Übernahme einer neuen Epoche auf einem bestehenden Gerät).** Der Code öffnet eine Keybox der größten Epoche `E` im Listing. Öffnet er stattdessen eine Epoche dazwischen, folgt `rotated`; sonst `recoveryCode` bzw. `inviteKey`. `pending` wird vorher aufgelöst. Der neue Graph aus den Objekten der Epoche `E` muss genau einen Kopf `H'` haben (sonst `conflict`, nichts wird geschrieben). Die Basis ergibt sich aus `adopts`: Sind alle `localHeads` in `adopts`, ist es `working`; sonst der einzige maximale gemeinsame Vorfahre in der alten Epoche (kein oder mehrere ergeben `conflict`). Sind lokaler Stand und Basis gleich, wird `H'` übernommen, sonst `mergePortableVaults(Basis, lokal, H')` als Kind von `H'`; ein Widerspruch ergibt `conflict` mit Basis. `projection` ist der lokale Dateistand. Es entsteht keine zweite Wurzel, und Änderungen anderer Geräte aus der alten Epoche gehen nicht verloren (B1).

**Einladung `createInvite`.** Verlangt einen Checkpoint ohne `keybox`-Marker. Erzeugt `code` (16 Zufallsbytes, Anzeige wie der Wiederherstellungscode), eine Keybox `method: 'invite'` für die aktuelle Epoche (mit `adopts`), schreibt den Checkpoint (`invites`) **zuerst** und lädt dann die Keybox hoch. Rückgabe `{ code, enrollSecret, keyboxId }` mit `enrollSecret = hex(HKDF(code16, salt = JSON([serverId, namespace, origin]), 'shellherd-invite-enroll-v1', 32))`. Die Origin ist kanonisch (HTTPS, oder HTTP für Loopback und private Adressen) und bindet das Secret an genau diesen Server (kein Relay an einen anderen Server mit gleicher `serverId`). Das Gerät sendet `POST /v1/invites` (`{ secret: <hex64>, object: <keyboxId> }`, höchstens 4 KiB, signierter Request v4 mit Body-Digest); scheitert das, nimmt es die Keybox zurück.

**Einschreibung mit Code.** Neues Gerät: `enrollSecret` ableiten, `POST /v1/devices` mit `{ enrollment, invite[, ephemeral] }` (`invite` = `enrollSecret`), Antwort `{ device, username }`. Der Code bleibt als `Buffer` im Main (wie der Passwort-Digest, `#wipe` nullt ihn). Der Import (`importSyncedVault`) und die Adoption öffnen die Einladungs-Keybox mit dem `invite`-Wrap und löschen sie nach Erfolg best effort. Danach ist der Code gewischt, spätere Läufe brauchen keinen. Fehlt die Keybox (zehn Minuten vorbei, Rotation), meldet der Client `syncInviteKey` und verweist auf den Wiederherstellungscode.

**Server-Seite.** `/v1/info` zusätzlich `invites: true`, `objectEpochs: true`, `enrollment: 'password' | 'invite-only'`. Einladungen nur im RAM: `{ sha256(secret), issuer, object, createdAt, expiresAt = +600 s, consumedAt }`, höchstens 4 offene je Aussteller, 16 gesamt (429), Budget 10 je Minute. `POST /v1/devices` vergleicht den Digest in konstanter Zeit über alle offenen Einladungen; ein Treffer ist verbraucht, auch wenn das Einschreiben danach scheitert. Der Aussteller muss aktiv sein (Widerruf verwirft seine Einladungen). `object` wird zu `max(expiresAt, consumedAt + 600 s)` gelöscht. Unter `invite-only` ergibt die Passwortform 403 vor der Passwortprüfung. Roster v3 trägt `enrolledBy`.

**Nachweis v4.** `DEVICE_REQUEST = 'shellherd-device-request-v4'`, Tupel `[tag, serverId, namespace, origin, method, path, nonce, deviceId, sha256(body)]`. `DELETE /v1/devices/<id>` signiert den Digest des leeren Bodys, `POST /v1/invites` den exakten Body (der Server rechnet über die gelesenen Bytes). Einschreibe- und Sitzungsnachweis bleiben `-v2`.

**Roster-TOFU (Sync-Lab).** Identitätsdatei v4: je Einschreibung ein Schnappschuss `roster: { id, signingKey, revokedAt, enrolledBy, acknowledged }[]` (höchstens 64) mit `rosterAt`, vom MAC gedeckt (Domäne `shellherd-remote-identity-v4`); die Migration v3 → v4 ist best effort. Der Vergleich nach dem Laden der Liste: bekannte `id` mit anderem `signingKey` → `syncRoster`; ein gespeicherter Widerruf bleibt (bei zwei Zahlen gilt das Minimum) und Pins widerrufener Geräte überleben das Verschwinden aus der Serverliste; eine Wiederbelebung (`revokedAt` am Server `null`) zeigt `revived` und wirkt erst nach `acknowledgeDevice`; eine neue `id` ohne Bestätigung und ohne eigene Einladung zeigt `newDevices`; der erste Lauf übernimmt alles still als bestätigt. Pins bleiben bei gleicher `serverId`, Origin und `namespace` erhalten. Temporäre Identität: nur RAM.

**Grenzen.** Siehe Bedrohungsmodell „Stand H4“.

## Rendezvous-Kanal (H2, Entwicklungsprototyp)

Der Fernzugriff-Kanal (`rendezvous-client.mjs`) nutzt `Noise_XX_25519_ChaChaPoly_BLAKE2b` (`noise-handshake` 4.2.0, exakt gepinnt). Kein Downgrade, kein Profilwechsel. Das ist ein Entwicklungsprototyp ohne Sicherheitsfreigabe.

- **Statische Schlüssel:** Der vorhandene X25519-Geräteschlüssel, roh aus dem PKCS8-Export. Der Fingerabdruck bleibt die Geräte-ID. Der Schlüssel der Gegenseite (`rs`) kommt aus dem Handshake und wird gegen den erwarteten Fingerabdruck geprüft: beim Initiator sofort nach Nachricht 2 und vor dem Senden von Nachricht 3, beim Responder nach Nachricht 3. Abweichung: Fehler `mismatch`, nichts wird bereit.
- **Prologue:** JSON-Array in fester Feldreihenfolge `[Prologue-Kennung 'shellherd-rendezvous-noise-v1', Profil, Server-ID, Sitzungs-ID, Nonce, Scope, from, to]`. Jede Abweichung lässt den Handshake scheitern.
- **Rollen:** Initiator ist die freigebende Seite (`session.to`, nach erteilter Zustimmung), Responder der Betrachter (`session.from`). Der Initiator beginnt den Handshake erst nach `accept()` und sendet danach `accepted` (mit Scope); der Responder nimmt vor `accepted` keine Daten an.
- **Frame-Format:** `{ sequence, frame }` mit `frame` als Base64 von 1 bis 8208 Byte, Sequenz lückenlos je Richtung, höchstens 4096 Frames je Richtung. Handshake-Frames haben exakte Längen 32 (Nachricht 1), 96 (2) und 64 (3) mit leerer Payload. Transportframes tragen JSON `{kind:'accepted',scope}` oder `{kind:'data',value}` bis 8192 Byte, ChaCha20-Poly1305 mit leerem AD, Schlüssel direkt aus dem Handshake (keine eigene HKDF-Stufe). Das alte Format `{ciphertext,nonce,sequence,tag}` wird abgelehnt.
- **Outbox-Regel:** Jeder ausgehende Frame wird genau einmal verschlüsselt und mit fester Sequenz in der Outbox gehalten, bis der Server ihn bestätigt. Wiederholungen senden denselben String (Server-Idempotenz über Digest, anderer Inhalt gleicher Sequenz: 409). Ein Fehler beim Verarbeiten eingehender Frames vergiftet den Kanal; Netzwerkfehler tun das nicht.
- **Aufräumen:** `dispose` nullt Schlüsselmaterial, auch bei unvollständigem Handshake, und wirft nie.

### Kompaktierung (H2)

Jede Version kann `compacts` tragen (IDs entfernter Versionen, höchstens 256, eindeutig, nie die eigene ID oder ein eigener Parent). Ohne Kompaktierung bleibt das Dokument bytegleich zu H1.

- **Auslöser:** Nach erfolgreichem Sync mit genau einem Kopf, ohne ausstehende Änderung und mehr als 32 Versionen. Die jüngsten 16 Versionen (Breitensuche ab dem Kopf) bleiben, der Rest wird entfernt.
- **Ablauf:** Zusammenfassungsversion `C` (Inhalt des Kopfs, Parent = Kopf, `compacts` = neu entfernte plus bereits kompaktierte IDs) hochladen und quittieren, danach die entfernten Objekte am Server löschen, dann lokal bereinigen. Jede Abbruchstelle endet ohne `history`; ein späterer Lauf repariert Reste (Löschen veralteter Server-Objekte).
- **Graph:** Ein fehlender Parent ist nur erlaubt, wenn er kompaktiert ist, sonst `history`. Köpfe sind Versionen, die weder Parent einer vorhandenen Version noch kompaktiert sind. Die Basis zweier Köpfe umfasst auch lokal vorhandene Vorfahren, die die Gegenseite kompaktiert hat. Neu geladene, schon kompaktierte Objekte („Zombies“) werden verworfen und nie als empfangen gezählt.
- **Grenzen:** Wird die Liste bei 256 gekürzt, kann nach sehr langer Abwesenheit ein `history`-Fehlalarm kommen; der Ausweg ist Neu-Laden. Zwei Köpfe ohne berechenbare Basis bleiben ein Konflikt ohne Auflösungsweg. Signierte Tombstones gibt es nicht; Zurückhalten noch nie gesehener Objekte bleibt unerkennbar (H3).
- **Fremde Objekte:** `Fremde Objekte entfernen` löscht ausschließlich Objekte, die sich unter dem Vault-Schlüssel nicht AEAD-öffnen lassen. Lesbare Objekte, auch mit unbekanntem Schema, bleiben.
