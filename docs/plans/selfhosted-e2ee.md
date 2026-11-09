# Selfhosting, E2EE-Sync und Fernzugriff

Status: Plan mit isolierten Entwicklungsprototypen. Keine produktive Integration oder Sicherheitsfreigabe.

Stand 2026-11-06: Ein [separater Storage-/Rendezvous-Server](../../server/README.md)
mit Dockerfile und Compose ist implementiert und im Container geprüft. Er nutzt
den bestehenden Kontozugang und Ciphertext-Speicher und ergänzt Gerätepräsenz,
explizite Sitzungsannahme und begrenzte verschlüsselte Signalisierung. Containerwechsel,
Backup/Restore in ein frisches Volume und Kontopasswortwechsel sind geprüft.
Der Referenzclient ist noch kein Fernsteuerungsagent: Windows-/Linux-Dienste,
Bildschirm-/Eingabeübertragung, Medienrelay und unabhängiger Protokollreview
stehen aus. Podman und Kubernetes wurden damit nicht freigegeben.

Stand 2026-11-07: Meilenstein 1 des Fernzugriffs (nur Ansehen) ist als Entwicklungsfunktion hinter `SHELLHERD_REMOTE_LAB=1` umgesetzt: Gerätepräsenz, lokale Zustimmung mit Fingerprint-Vergleich, WebRTC-Bildübertragung (nur Host-Kandidaten, kein TURN) und Sitzungen von höchstens fünf Minuten. Der Server hat dafür den Endpunkt `POST /v1/refresh` (verlängert die Anmeldung um 15 Minuten, höchstens 12 Stunden ab Login). Nachweis: Szene `.claude/skills/run-app/remote-scene.mjs` mit zwei Instanzen. Die Szene überträgt ein Testbild (Fake-Capture); echtes Capture (Wayland-Portal, Windows `desktopCapturer`, inklusive der Frame-Prüfung `request.frame !== contents.mainFrame` im Handler) und der Fensterschutz unter Windows und macOS sind noch nicht manuell geprüft. Offen bleiben Eingabe (Maus/Tastatur), TURN-Relay und Verbindungen über Netzgrenzen, ein Betriebssystemdienst (Zugriff ohne angemeldeten Nutzer, Sperrbildschirm, UAC), Wayland-Feinheiten und der unabhängige Sicherheitsreview. Nutzerhinweise stehen im Handbuch unter „Fernzugriff (Entwicklung)“.

Stand 2026-11-09: Härtung H1 (Spec `docs/superpowers/specs/2026-11-09-security-hardening-design.md`, Validierungs-Anhang geht vor) umgesetzt, ohne Sicherheitsfreigabe:

- **Fernzugriff:** Die Checkbox ist durch eine getippte Prüfung ersetzt (damals die ersten 12 Hex-Zeichen des Fingerabdrucks, beidseitig; geprüfte Geräte werden gepinnt; seit H2 sind es 16). Die Aufnahme gibt nur der native Systemdialog im Main frei, mit vollem Fingerabdruck. Display-Capture und alle anderen Browser-Berechtigungen sind per Permission-Handler gesperrt, solange keine Freigabe gerüstet ist. Der Renderer hat eine CSP. Beendet der Renderer eine Freigabe nicht binnen 2 s, lädt das Fenster neu (Notbremse). Nach einem Ablehnen schaltet der Agent das Gerät 10 min stumm.
- **Server:** Limits pro Quelladresse (Proxy-Betrieb mit `SHELLHERD_SERVER_TRUSTED_PROXY=1`), Backoff statt globaler Login-Sperre, Besitznachweis des Geräteschlüssels bei jeder Registrierung, höchstens eine offene Anfrage je Paar mit 30 s Sperre nach Ablehnen, Rollenbindung im Kanal. Dockerfile mit Image-Digest, Caddyfile mit `1MiB` und Timeouts.
- **Sync:** Fremde oder nicht lesbare Objekte im Konto werden übersprungen und gezählt statt den Sync zu blockieren. Das Serverpasswort darf nicht das Vault-Passwort sein (Prüfung vor dem Senden). `account-init` schlägt ein generiertes Passwort vor und verlangt mindestens 16 Zeichen.
- **Grenzen (Stand H1):** Das 48-Bit-Präfix schützt nicht gegen einen Betreiber mit großer Rechenleistung, und gegen einen kompromittierten Renderer schützt allein der native Dialog (siehe Handbuch). Gegen verteilte Floods hilft nur ein privates Netz (WireGuard/Tailscale). Weiter kein unabhängiger Sicherheitsreview.

Stand 2026-11-09: Härtung H2 (Spec `docs/superpowers/specs/2026-11-09-secure-channel-design.md`, Validierungs-Anhang geht vor) umgesetzt, ohne Sicherheitsfreigabe:

- **Kanal:** Der Rendezvous-Kanal läuft auf `Noise_XX_25519_ChaChaPoly_BLAKE2b` mit den vorhandenen X25519-Geräteschlüsseln als Statik. Forward Secrecy je Sitzung, der Schlüssel der Gegenseite kommt aus dem Handshake und wird vor Nachricht 3 gegen den geprüften Fingerabdruck (256 Bit) verglichen. Der Prologue bindet Server-ID, Sitzung, Nonce, Zweck und Rollen. Details im [Protokollplan](selfhosted-protocol.md).
- **Prüfung:** 16 Hex-Zeichen (64 Bit, die ersten zwei Gruppen) statt 12. H1-Pins bleiben gültig.
- **Privates Netz:** Option für HTTP zu einer WireGuard-/Tailscale-Adresse mit Warnhinweis, Server-Variante `compose.wireguard.yaml`.
- **Sync:** Kompaktierung (Aufbewahrung der jüngsten 16 Versionen, kumulative `compacts`-Liste, Löschen per `DELETE` am Server), „Fremde Objekte entfernen“ als bewusste Aktion, Abbruch des Imports bei gleichem Vault- und Serverpasswort.
- **Permissions:** Nur der `media`-Check ist verschärft (nur `video`). Die Anfrage-Regel bleibt, weil `getDisplayMedia` und Legacy-Desktop-`getUserMedia` in Electron 44 nicht unterscheidbar sind. Der Legacy-Desktop-Pfad nach erteilter Zustimmung bleibt ein benanntes Restrisiko.
- **Offen:** Löschrecht gilt je Konto, Tombstones fehlen (Freeze noch nie gesehener Objekte bleibt unerkennbar, H3), gerätegebundene Anmeldung (H3), ein H1-Server ohne `DELETE`, `sodium-native` nur unter Linux x64 ausgeführt. Weiter kein unabhängiger Sicherheitsreview.

Block 0 ist im [Bedrohungsmodell](selfhosted-threat-model.md) ausgearbeitet. Block 1 liegt als [Protokoll- und Offline-Sync-Entwurf](selfhosted-protocol.md) vor; technische Nachweise und Review stehen aus.

Aktuelle Entscheidung: Der normale Sync-Einstieg verwendet Server-URL, Benutzername und Serverpasswort. Keine manuelle Fingerprintprüfung oder Gerätefreigabe. Das gesonderte Vault-Passwort bleibt lokal. Der Server speichert ausschließlich verschlüsselte Versionen und einen Hash des Serverpassworts; die Anmeldung verarbeitet dieses kurzzeitig über den geschützten Transport. Der Linux-Entwicklungsprototyp unterstützt Anmeldung, begrenzte RAM-Sitzungen, manuellen Abgleich des geöffneten `.term`-Vaults, Import auf einem neuen Gerät und Offline-Merge mit verschlüsseltem lokalem Sync-Zustand. Es gibt noch keine Produktivfreigabe, keinen automatischen Hintergrund-Sync und keinen Windows-Dateisync. Frühere Noise-/Geräte-ACL-Experimente sind davon getrennt. Testablauf, Wiederanlauf und Grenzen stehen in der [Prototyp-Anleitung](../../scripts/sync-prototype/README.md).

## Ziel

Ein selbst betreibbarer Server vermittelt Geräte, speichert verschlüsselte Sync-Daten und leitet bei Bedarf verschlüsselte Sitzungen weiter. Windows- und Linux-Agenten ermöglichen Bildschirmansicht, Maus und Tastatur. Später lassen sich ausgewählte Shellherd-Sitzungen mit weiteren Personen teilen.

Alle Geräte synchronisieren ausschließlich über einen gezielt gewählten zentralen Server. Einstieg: Server-URL + Benutzername + Serverpasswort → anmelden → verschlüsselt synchronisieren. Kein anderer PC muss für den regelmäßigen Sync online bleiben. Die lokale verschlüsselte Vault-Datei bleibt offline nutzbar. Wieder online konsolidieren berechtigte Clients die Änderungen mehrerer Geräte anhand gemeinsamer Vorgänger. Unabhängige Änderungen werden zusammengeführt, widersprüchliche Varianten bleiben zur expliziten Auflösung erhalten. Der Server muss dafür nichts entschlüsseln; seine Ablage als Dateien oder Datenbank ist austauschbar.

Am Ende stehen versionierte Installationsartefakte mit dokumentierten Docker-, Podman- und Kubernetes-Befehlen. Images und Befehle werden erst als funktionsfähig bezeichnet, wenn sie tatsächlich gebaut und geprüft wurden.

## Verbindliche Sicherheitsanforderungen

- Nutzdaten werden auf dem sendenden Endgerät verschlüsselt und ausschließlich auf berechtigten Endgeräten entschlüsselt. TLS schützt zusätzlich den Transport; TLS allein ist keine E2EE.
- Server, Relay, Datenbank, Backups und Betreiber erhalten keine privaten Geräteschlüssel, Vault-Schlüssel, Wiederherstellungsgeheimnisse oder unverschlüsselten Nutzdaten. Öffentliche Schlüssel dürfen ausgetauscht werden.
- Kein Klartext von Credentials, Verbindungsdaten, Bildschirmdaten oder Tastatureingaben in persistenten Dateien, Telemetrie, Logs oder Crash-Berichten. Geheimnisse nicht in Prozessargumenten oder URLs transportieren. Notwendiger Klartext im Arbeitsspeicher berechtigter Endgeräte wird begrenzt; vollständige Speicherlöschung in JavaScript lässt sich nicht garantieren.
- Sync, Geräteidentität und einzelne Sitzungen erhalten getrennte Schlüssel und Berechtigungen. Teilnehmer einer geteilten Sitzung erhalten weder Vault-Zugriff noch dessen Schlüssel.
- Ein kompromittierter Server darf keine Geräte unbemerkt austauschen, Teilnehmer hinzufügen oder Berechtigungen erhöhen. Bereits bekannte alte Zustände müssen erkannt werden; Grenzen bei neuen/zurückgesetzten Geräten und aufgespaltener Historie sind im Bedrohungsmodell beschrieben.
- Serveranmeldung und E2EE-Vault-Geheimnis bleiben strikt getrennt. Keine eigene Kryptografie erfinden. Protokoll und gepflegte Implementierung werden anhand dokumentierter Anforderungen ausgewählt und vor produktiver Nutzung unabhängig geprüft.
- Freigaben sind konkret: Zielgerät beziehungsweise Sitzung, Empfänger, Zuschauen oder Steuern und Gültigkeitsdauer. Standardmäßig keine Zwischenablage, Dateiübertragung oder Aufzeichnung.
- Unbeaufsichtigter Zugriff erfordert eine gesonderte lokale Einrichtung. Ein Agent erlaubt keine Steuerung nur aufgrund einer Serverentscheidung.
- Lokaler Widerruf beendet betroffene laufende Berechtigungen am autorisierenden Gerät. Für entfernte/offline Geräte muss das Protokoll die maximale Restgültigkeit begrenzen; Schlüsselwechsel schützen künftige Daten. Bereits gesehene oder kopierte Daten lassen sich nicht zurückholen.
- Kein Herstellerkonto erforderlich; Geräte arbeiten mit kryptografischen Identitäten. Metadaten minimieren und ihre Aufbewahrung festlegen. IP-Adressen, Zeitpunkte und Datenmengen bleiben teilweise sichtbar: keine Zusage vollständiger Anonymität.
- Kein serverseitiges Zurücksetzen, das Verschlüsselung umgeht. Ohne berechtigtes Gerät oder lokal gehaltenes Wiederherstellungsgeheimnis sind verschlüsselte Daten verloren.

## Ausgangslage im Repository

Electron-/TypeScript-Anwendung mit lokalem Vault. `src/main/vault/crypto.ts` verwendet derzeit Argon2id und AES-256-GCM. Diese Feststellung ist kein Audit. Vorhandene lokale Verschlüsselung ersetzt weder authentifizierten Schlüsselaustausch noch Geräteverwaltung, Mehrbenutzerrechte oder Replay-Schutz.

## Arbeitsblöcke und Abnahmekriterien

Jeder Block liefert eine nachvollziehbare Änderung, passende Prüfungen und dokumentierte Grenzen. Erst nach erfüllter Abnahme folgt der darauf aufbauende Block. Sicherheitskritische Lücken bleiben sichtbar und sperren eine Produktivfreigabe.

| Block | Ergebnis | Abnahme |
| --- | --- | --- |
| 0 – Bedrohungsmodell | Datenflüsse, Vertrauensgrenzen, Angreifer, Metadateninventar und Sicherheitsregeln | Kompromittierter Server, fremdes Gerät, gestohlene Einladung, verlorenes Gerät und manipulierte Updates durchgespielt; MVP festgelegt |
| 1 – Protokollentscheidung | Vergleich bestehender Protokolle/Bibliotheken; Geräteidentität, verifiziertes Pairing, Schlüsseltrennung, Rotation und Recovery spezifiziert | Aktive Serverangriffe, Replay, Downgrade, Wiederverbindung und Offline-Widerruf beschrieben; unabhängiger Review eingeplant |
| 2 – Minimaler Server | Zentraler Ciphertext-Speicher mit authentifizierter Geräte-API; Registrierung und Vermittlung schrittweise; kein produktiver Vault-Sync | Unberechtigte Zugriffe, Größenlimits, Rate Limits, Ablaufzeiten und Ressourcenerschöpfung geprüft; keine offenen Relays |
| 3 – Verschlüsselter Sync | Zuerst eigene Geräte über dasselbe Serverkonto; verschlüsselte Vault-Versionen mit Konfliktbehandlung und Offline-Betrieb | Manipulation und veraltete Versionen erkannt; parallele Änderungen verlieren keine Daten; Server- und Backup-Inspektion findet keine Klartext-Nutzdaten |
| 4 – Agent-Grundlage | Windows-/Linux-Agent mit verifizierter Gerätebindung, minimalen Rechten und sicherem Updatepfad | Entkoppelung, Widerruf, lokale Freigabe, Dienstinstallation und Berechtigungstrennung geprüft; unterstützte Betriebssystemfälle benannt |
| 5 – Remote-Desktop | Zunächst ein Betrachter/Steuernder, dann belastbare Wiederverbindung; direkte Verbindung und Relay | Bild, Maus und Tastatur unter Windows und Linux geprüft; Freigabestopp wirkt sofort; Plattformgrenzen wie Wayland, Sperrbildschirm und UAC explizit getestet |
| 6 – Shellherd-Sitzung teilen | Ausgewählte Sitzung, explizite Empfänger, Zuschauen/Steuern, Entzug | Keine Vault-Schlüssel oder unfreigegebenen Tabs zugänglich; Teilnehmerwechsel und Kontrollübergabe geprüft; sichtbare Sitzungsinhalte als Offenlegung erklärt |
| 7 – Betrieb und Distribution | OCI-Image, Docker-/Podman-Anleitung, Kubernetes-Manifeste oder Helm-Chart; TLS, persistente verschlüsselte Daten, Updates, Backup/Restore | Frische Installation auf allen drei Wegen, Neustart, Upgrade und Restore getestet; Container ohne unnötige Rechte, Ressourcenlimits und dokumentierte Netzwerkports |
| 8 – Sicherheitsfreigabe | Unabhängiger Review, behobene Befunde, Betriebshandbuch und Sicherheitsmeldestelle | Keine offenen kritischen/hohen Befunde; Sicherheits- und Wiederherstellungstests bestanden; dokumentierte verbleibende Grenzen |

Containerfähigkeit wird ab Block 2 berücksichtigt; Block 7 vervollständigt und prüft die Betriebswege.

## Noch gemeinsam festzulegen – Block 0

1. MVP-Vorschlag: eigene Geräte koppeln und verschlüsselt synchronisieren; anschließend Fernzugriff mit lokaler Bestätigung. Unbeaufsichtigter Zugriff folgt als eigener Schritt.
2. Recovery: separates, offline verwahrtes Wiederherstellungsgeheimnis anbieten oder bewusst ohne Wiederherstellung starten?
3. Was bedeutet „gesamte Shellherd-Session“ konkret: ausgewählte Terminal-/Desktop-Sitzungen oder die komplette Oberfläche? Vorschlag: ausgewählte Sitzungen; komplette Oberfläche kann Credentials und andere Verbindungen offenlegen.
4. Unterstützte Windows-/Linux-Versionen und Desktopumgebungen bestimmen; insbesondere Wayland, X11, UAC und Zugriff ohne angemeldeten Nutzer getrennt bewerten.
5. Metadaten und notwendige Betriebslogs mit Zweck, Inhalt und Löschfristen festhalten. Inhalts- und Eingabelogs bleiben ausgeschlossen.

## Vorgehen im Repository

Eigene Feature-/Fix-Branches, PRs gegen `staging`. Keine automatischen Merges, Versionsänderungen, Tags oder Releases. Dieser Plan autorisiert noch keine Veröffentlichung oder Bereitstellung eines erreichbaren Dienstes.
