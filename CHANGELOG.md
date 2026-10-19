# Changelog

Alle nennenswerten Änderungen an Terminus. Die Versionsnummer folgt [Semantic Versioning](https://semver.org/lang/de/):
MAJOR für inkompatible Änderungen (z. B. am Vault-Format), MINOR für neue Funktionen, PATCH für Fehlerbehebungen.
Jede Version braucht hier einen Abschnitt `## [x.y.z] – JJJJ-MM-TT`; der Build bricht sonst ab.

## [0.9.0] – 2026-10-18

- Container-Ansicht für Docker und Podman, pro SSH-Verbindung und für „Dieser Computer“: Rechtsklick → „Container-Ansicht öffnen“ (lokal „Lokale Container-Ansicht öffnen“). Reiter Container, Images, Volumes und Netzwerke mit Spaltenfiltern, Chips, Gruppierung, Sortierung, Kontextmenüs und Tastenkürzeln; Filter und Gruppierung gelten je Reiter. Die Liste aktualisiert sich alle 10 Sekunden, solange der Tab sichtbar ist, und mit `F5`.
- Dock mit Logs, Shell und Inspect; Inspect maskiert Env-Werte mit sensiblen Namen. Starten läuft ohne Nachfrage, Stoppen, Neu starten und Entfernen fragen vorher nach, beim Entfernen muss man den Namen eintippen.
- Container-Ansichten von SSH-Hosts werden in Workspaces gespeichert.

## [0.8.0] – 2026-10-18

- Kubernetes-Tabelle mit Spaltenfiltern: Text (enthält), Auswahl für Namespace, Status, Typ, Node und Rollen, Zahlen (`>3`, `<=5`, `3`) und Alter (`<10m`, `>1h`, `<2d`). `/` springt in den Namensfilter (Events: Meldung), `F` setzt alle Filter des Reiters zurück.
- „Gruppieren nach“ (z. B. Namespace, Node, Status, Owner) mit auf- und zuklappbaren Gruppen; Filter und Gruppierung bleiben je Reiter und im Workspace erhalten.
- Die Befehlszeile oben rechts (`/`-Suche und `:`-Befehle wie `:ns`, `:filter`, `:status`) entfällt. Namespaces ohne Pods erreicht man über „alle“ und den Namespace-Filter. Textfilter aus dem Kontextmenü (z. B. `app=api`) erscheinen als Chip „Filter: …“.
- Zuletzt geöffnete Vault-Datei wird beim Start vorausgewählt.
- Cluster-Tab startet ohne konfigurierten Namespace mit allen Namespaces.

## [0.7.0] – 2026-10-18

- Kubernetes-Suche: mehrere Begriffe (UND), `"Phrase"`, `!Ausschluss`, `key=value` und `key!=value` für Labels, `feld:wert`-Qualifier sowie Zahlenvergleiche (`restarts>3`, `count>=5`); die Hilfe (`?`) listet Syntax und Qualifier je Reiter.
- Chip-Leiste mit Status-Filtern und Zählern je Reiter; `w` zeigt nur Auffälliges, `F` setzt Suche und Chips zurück, `:filter` und `:status` setzen sie per Befehl, im Kontextmenü gibt es „Nur … anzeigen“. Suche und Chips bleiben pro Reiter erhalten.
- Jobs zeigen ihren Status, Pods auch Evicted und Unknown, Nodes einen Hinweis bei Druck.
- Events sind standardmäßig nach „Zuletzt“ absteigend sortiert.

## [0.6.0] – 2026-10-16

- Kubernetes-Kontextmenüs: Rechtsklick und `Shift+F10` auf Zeilen, Container, Node-Kacheln, Probleme, Spaltenköpfe, den unteren Bereich und den Hintergrund des Cluster-Tabs.
- Kopieren (Name, Namespace, `kubectl`-Befehle, YAML, Describe) und Sprünge zu Besitzer, Node, Namespace und beteiligtem Objekt; „SSH-Verbindung öffnen“ findet die passende Vault-Verbindung zur Node.
- Neue Aktionen mit Bestätigung: CronJob fortsetzen, anhalten und jetzt ausführen, Node sperren (cordon) und freigeben (uncordon); `drain` nur als kopierbarer Befehl.

## [0.5.0] – 2026-10-16

- Kubernetes-Cluster (Stufe 1): Einrichtung aus einer SSH-Verbindung („Als Kubernetes-Cluster einrichten…“), Zugang über SSH-Tunnel mit Failover über weitere Zugangs-Hosts; Cluster-Tab mit Live-Tabelle für Nodes, Workloads, Pods und Events, Drill-down, Logs, Shell, YAML, Describe, Restart, Scale und Löschen mit Bestätigung; Produktions- und Nur-lesen-Modus.

## [0.4.0] – 2026-10-15

- Verbindungen deaktivieren (Rechtsklick → „Deaktivieren“): ausgegraut, lassen sich nicht öffnen und werden bei „Alle verbinden“ und in Workspaces übersprungen; Zugangsdaten bleiben erhalten.

## [0.3.0] – 2026-10-14

- Container und VMs unter SSH-Verbindungen: Docker, Podman und Proxmox (LXC/VMs) werden beim Aufklappen erkannt; auf dem Server muss nichts installiert werden.
- Shell in Container und LXC per Doppelklick, Logs folgen, Starten/Stoppen/Neu starten; serielle Konsole für Proxmox-VMs.
- Lokales Docker Desktop oder Podman unter „Dieser Computer“.
- Option „Container-Befehle mit sudo ausführen“ (sudo -n) pro SSH-Verbindung.

## [0.2.0] – 2026-10-14

- Remotedesktop (RDP) direkt im Tab, ohne zusätzliche Installation, mit Tastenkombinationen wie Strg+Alt+Entf.
- Lokale PowerShell und Eingabeaufforderung als Verbindungsart.
- SFTP-Dateibrowser im WinSCP-Stil: links dieser Computer, rechts der Server, Warteschlange und Nachfrage bei vorhandenen Dateien.
- Serverdateien bearbeiten (Standardprogramm oder Notepad); jedes Speichern lädt automatisch hoch.
- Neue Dateien und Ordner anlegen, Rechte ändern (chmod), Dateien einer SSH-Verbindung öffnen.
- Tabs und ganze Ansichten in eigene Fenster abdocken und wieder andocken.
- Ansichten bündeln mehrere Bereiche; Workspaces speichern alle Ansichten und Fenster.
- KI-Assistent neben SSH-, PowerShell- und CMD-Tabs (Strg+Umschalt+K): liest das Terminal, erklärt, tippt Befehle in die Eingabezeile ohne sie auszuführen und deutet danach die Ausgabe.
- KI-Anbieter frei wählbar: OpenAI-kompatibel (auch Ollama, LM Studio, interne Gateways), Azure AI Foundry, Anthropic und Google Gemini; Schlüssel verschlüsselt im Vault.
- Workflows: gespeicherte Befehle mit Platzhaltern, per Palette (Strg+Umschalt+Leertaste) suchen und eintippen, ohne sie auszuführen.
- KI-CLIs als Tab: Claude Code, Codex CLI, Gemini CLI oder ein eigener Befehl, gestartet im gewählten Projektordner.
- Verbindung testen, bevor sie gespeichert wird.
- Verbindungen und Ordner per Drag & Drop verschieben; Rechtsklick auf einen Ordner → „Alle verbinden“.
- Willkommensseite statt leerem Formular beim Start.
- Vault-Dateien heißen jetzt `.term` und lassen sich in Windows per Doppelklick öffnen; `.terminus`-Dateien funktionieren weiter.
- Abgedockte Fenster trennen beim Schließen ihre Verbindungen.
- Vault-Format 2 mit automatischer Migration und verschlüsselter Sicherung der alten Datei.

## [0.0.1] – 2026-09-18

- Erste Version: verschlüsselter Vault, SSH-Terminals, Ordner, geteilte Bereiche und Workspaces.
