# Block 1: Protokollentscheidung und Offline-Sync

Stand: 2026-10-31. Architekturentscheidung und Linux-Entwicklungsprototyp; keine produktiv freigegebene oder auditierte Protokollimplementierung. Verknüpft mit [Plan](selfhosted-e2ee.md) und [Bedrohungsmodell](selfhosted-threat-model.md).

Aktuelle Sync-Entscheidung: Server-URL, Benutzername und Serverpasswort genügen für den Speicherzugriff. Das andere Vault-Passwort bleibt ausschließlich lokal; Fingerprintvergleich und Gerätefreigabe entfallen im normalen Sync. Der [Kontotransport](../../scripts/sync-prototype/README.md) implementiert gehashte Serverzugangsdaten, zeitlich begrenzte Sitzungen und unveränderliche verschlüsselte Objekte. Manueller `.term`-Abgleich, Import, authentifizierte Vorgänger und Offline-Konsolidierung sind im explizit aktivierten Linux-Entwicklungsprototyp angebunden. Produktivfreigabe, Windows und allgemeine Konflikt-/Pfadfreigaben fehlen noch. Die nachfolgenden Noise-/Geräte-Mitgliedschaftsabschnitte dokumentieren frühere, weiterhin isoliert getestete Experimente für mögliche spätere Freigaben. Sie sind keine Voraussetzung oder Produktivfreigabe des Kontosyncs.

### Implementiertes Passwort-Sync-Profil

`vault-sync.ts` verschlüsselt Versionen mitsamt Vorgänger-Hashes und portablen Vault-Daten. HKDF-SHA-256 leitet aus dem lokalen Vault-Schlüssel getrennte AES-256-GCM-Schlüssel für Versionen und lokalen Zustand ab; Server-ID, Namespace, Format, Zweck und KDF-Profil sind gebunden. Es gibt keine Gerätesignatur oder individuelle Gerätewiderrufe in diesem Kontomodus. Wer den Vault-Schlüssel besitzt, kann Versionen erzeugen; Serverpasswort allein genügt nicht. Diese Anwendungskomposition benötigt unabhängigen Review.

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
