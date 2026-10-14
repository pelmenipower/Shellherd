# Changelog

Alle nennenswerten Änderungen an Terminus. Die Versionsnummer folgt [Semantic Versioning](https://semver.org/lang/de/):
MAJOR für inkompatible Änderungen (z. B. am Vault-Format), MINOR für neue Funktionen, PATCH für Fehlerbehebungen.
Jede Version braucht hier einen Abschnitt `## [x.y.z] – JJJJ-MM-TT`; der Build bricht sonst ab.

## [0.2.0] – 2026-10-14

- Remotedesktop (RDP) direkt im Tab, ohne zusätzliche Installation, mit Tastenkombinationen wie Strg+Alt+Entf.
- Lokale PowerShell und Eingabeaufforderung als Verbindungsart.
- SFTP-Dateibrowser im WinSCP-Stil: links dieser Computer, rechts der Server, Warteschlange und Nachfrage bei vorhandenen Dateien.
- Serverdateien bearbeiten (Standardprogramm oder Notepad); jedes Speichern lädt automatisch hoch.
- Neue Dateien und Ordner anlegen, Rechte ändern (chmod), Dateien einer SSH-Verbindung öffnen.
- Tabs und ganze Ansichten in eigene Fenster abdocken und wieder andocken.
- Ansichten bündeln mehrere Bereiche; Workspaces speichern alle Ansichten und Fenster.
- Verbindung testen, bevor sie gespeichert wird.
- Verbindungen und Ordner per Drag & Drop verschieben; Rechtsklick auf einen Ordner → „Alle verbinden“.
- Willkommensseite statt leerem Formular beim Start.
- Vault-Dateien heißen jetzt `.term` und lassen sich in Windows per Doppelklick öffnen; `.terminus`-Dateien funktionieren weiter.
- Abgedockte Fenster trennen beim Schließen ihre Verbindungen.
- Vault-Format 2 mit automatischer Migration und verschlüsselter Sicherung der alten Datei.

## [0.0.1] – 2026-09-18

- Erste Version: verschlüsselter Vault, SSH-Terminals, Ordner, geteilte Bereiche und Workspaces.
