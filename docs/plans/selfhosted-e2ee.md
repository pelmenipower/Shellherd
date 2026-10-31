# Selfhosting, E2EE-Sync und Fernzugriff

Status: Plan mit isolierten Entwicklungsprototypen. Keine produktive Integration oder Sicherheitsfreigabe.

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
