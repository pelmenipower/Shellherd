# Changelog

Alle nennenswerten Änderungen an Shellherd (bis 0.9.0 unter dem Namen Terminus). Die Versionsnummer folgt [Semantic Versioning](https://semver.org/lang/de/):
MAJOR für inkompatible Änderungen (z. B. am Vault-Format), MINOR für neue Funktionen, PATCH für Fehlerbehebungen.
Jede Version braucht hier einen Abschnitt `## [x.y.z] – JJJJ-MM-TT`; der Build bricht sonst ab.

## [0.12.1] – 2026-10-20

- Behoben: Downloads aus der Dateiansicht landen nur im gewählten Zielordner; Namen, die Windows nicht speichern kann (`\`, `:`, Gerätenamen, Punkt oder Leerzeichen am Ende), werden übersprungen oder mit Hinweis abgelehnt.
- Behoben: Beim Überschreiben bleibt die alte Datei erhalten, bis die neue vollständig angekommen ist.
- Geändert: `Bearbeiten` öffnet nur Text-, Konfigurations- und Quelltextdateien im Standardprogramm; Skripte und alles andere in Notepad, auch lokal.
- Geändert: Der KI-Assistent tippt Befehle nicht mehr selbst ein; `Eintippen` schreibt den Vorschlag in die Eingabezeile.
- Behoben: Die Vault-Datei wird vor dem Umbenennen auf die Platte geschrieben; Speichern während des Sperrens liefert kein falsches Ergebnis; nach dem Anhängen von `.term` merkt sich Shellherd den neuen Pfad.
- Behoben: Fehlgeschlagene RDP-Verbindungen zeigen den Fehler statt dauerhaft „Verbindet“.
- Behoben: Verschieben einer Ansicht in ein anderes Fenster lässt keine Sitzung zurück, wenn eine davon gerade endete.
- Behoben: Cluster-Ansicht zeigt nur die Ereignisse des gewählten Objekts; Kubeconfig-Suche funktioniert trotz Login-Banner; das Pod-Terminal nennt die Ursache.
- Behoben: Der Verbindungstest wartet, solange der Server-Schlüssel-Dialog offen ist; die Spracheinstellung meldet, wenn sie nicht gespeichert werden kann.
- Behoben: Zahlen in Meldungen folgen der Sprache (z. B. „1.000 übersprungen“); die Drag-Vorschau in anderen Fenstern verschwindet auch, wenn die Ansicht während des Ziehens geschlossen wird.

## [0.12.0] – 2026-10-19

- Shellherd gibt es jetzt auf Deutsch und Englisch. Standard ist die Windows-Anzeigesprache; unter Einstellungen (Zahnrad in der Kopfzeile, `Strg+,`, auch auf der Startkarte) stellt „Sprache“ auf System, Deutsch oder English um. Der Wechsel gilt sofort in allen Fenstern, offene Sitzungen laufen weiter.
- Neuer Dialog „Einstellungen“: Sprache, die Dateiverknüpfung mit `.term`, die Nachfrage vor dem Trennen laufender Sitzungen (pro Vault, bisher ohne Schalter) und der Einstieg zu den KI-Anbietern an einem Ort.
- Fehlermeldungen, Dialoge, Fenstertitel und der KI-Assistent folgen der eingestellten Sprache; der Assistent antwortet in dieser Sprache.
- Datum, Zahlen, Dateigrößen, Sortierung und Suche richten sich nach der Sprache. Die Ausgabe von „Beschreiben“ in der Cluster-Ansicht nutzt jetzt die englischen Feldnamen wie `kubectl describe`.
- Der Installer zeigt seine Texte auf Deutsch oder Englisch, passend zur Windows-Sprache. Release-Notes und Handbuch gibt es in beiden Sprachen (`docs/manual.md`).

## [0.11.0] – 2026-10-19

- Neue Farbwelt „Berner Kupfer“: Der Akzent ist jetzt Kupfer statt Cyan, passend zum Shellherd-Zeichen. Flächen und Text sind einen Hauch wärmer; Kupfer steht nur für Fokus, Auswahl und Aktionen, Gelb, Grün und Rot nur für Zustände.
- Verbindungsaufbau mit Schritten: Dauert das Verbinden länger als 0,4 Sekunden, zeigt das Terminal „Server erreichen“, „Server-Schlüssel prüfen“, „Anmelden“ und „Shell öffnen“ mit der Zeit je Schritt und einem Hinweis bei langsamer Antwort. `Esc` bricht ab.
- Verständliche Verbindungsfehler: Eine Karte im Terminal nennt Ursache und nächsten Schritt (Anmeldung abgelehnt, Server antwortet nicht, Server-Schlüssel geändert und weitere) und bietet `Verbindung bearbeiten`, `Erneut verbinden` oder `Fingerprint kopieren`; `Details` zeigt den Rohtext.
- Getrennte Sitzungen: Die Ausgabe bleibt stehen, eine Leiste zeigt, wie lange die Trennung her ist, und `Neu verbinden` (`Enter`) startet neu. Das gilt auch für RDP und die Dateiansicht.
- Meldungen unten rechts gibt es in drei Stufen: Fehler bleiben, bis man sie schließt, Hinweise und Erfolge verschwinden nach 5 bzw. 3 Sekunden (Balken zeigt die Restzeit). Fehlermeldungen stehen direkt am Feld oder im Bereich statt nur oben im Fenster.
- Speichern-Knöpfe zeigen „Speichert …“ und „Gespeichert“, ohne die Breite zu ändern. Schreibfehler der Vault-Datei nennen den Grund (schreibgeschützt, gesperrt, Ordner fehlt, Laufwerk voll).
- Cluster-Ansicht: Beim Neuverbinden bleibt die Tabelle lesbar. Eine Statusleiste zeigt „Live“ mit dem Alter der Daten, beim Neuverbinden den Host und den Versuch und danach „Wieder verbunden über …“. Aktionen sind bis dahin gesperrt.
- Container-Ansicht: Läuft eine Aktion, zeigt die Status-Zelle den Zielzustand („stoppt“, „startet neu“) statt die Zeile auszublassen.
- Einheitliche Texte: Aufforderungen ohne „Bitte“, „…“ als ein Zeichen, ein Statuswörterbuch für Tabs, Terminal, RDP und Dateiansicht. Statuspunkte haben überall dieselbe Größe, Pfeile an Bannern und Docks sind Symbole statt Textzeichen.
- Wartet der Verbindungsaufbau auf die Bestätigung des Server-Schlüssels, sagt die Karte das, statt vor einer langsamen Verbindung zu warnen.
- Behoben: Release-Notes zeigen `Tasten` und Knöpfe als Code statt mit rohen Backticks; der Punkt in Meldungen steht auf Höhe des Titels; „Details“ in der Fehlerkarte ändert die Breite nicht mehr; Checkboxen und Optionsfelder in Formularen haben wieder ihre normale Größe.

## [0.10.0] – 2026-10-19

- Erste öffentliche Version auf GitHub: Installer (`Shellherd-Setup-0.10.0.exe`) und portable Version (`Shellherd-Portable-0.10.0.exe`) für Windows x64, Lizenz MIT.
- Terminus heißt jetzt Shellherd: neues Programmsymbol in Fenster, Taskleiste, Kopfzeile und Startkarte, neuer Name in allen Texten. Vault-Dateien (`.term`, ältere `.terminus`) und ihr Format bleiben unverändert.
- Einstellungen ziehen beim ersten Start automatisch um: bekannte SSH-Hostschlüssel und die zuletzt geöffnete Vault-Datei werden aus dem alten Terminus-Ordner übernommen; der alte Ordner bleibt bestehen.
- Dateiverknüpfung: „Mit Shellherd öffnen“ ersetzt beim nächsten Verknüpfen den alten Eintrag; `.term` zeigt im Explorer das Shellherd-Symbol.
- Der RDP-Helfer heißt `Shellherd.RdpHost.exe`; die Entwickler-Schalter heißen `SHELLHERD_RDP_DEBUG`, `SHELLHERD_RDP_MODE` und `SHELLHERD_RDP_SMARTSIZE`.
- Lokale Oberflächen-Vorlieben (gewählter KI-Anbieter, Assistent offen, gesehene Release-Notes) starten nach dem Umzug einmal neu.

## [0.9.0] – 2026-10-18

- Container-Ansicht für Docker und Podman, pro SSH-Verbindung und für „Dieser Computer“: Rechtsklick → „Container-Ansicht öffnen“ (lokal „Lokale Container-Ansicht öffnen“). Reiter Container, Images, Volumes und Netzwerke mit Spaltenfiltern, Chips, Gruppierung, Sortierung, Kontextmenüs und Tastenkürzeln; Filter und Gruppierung gelten je Reiter. Die Liste aktualisiert sich alle 10 Sekunden, solange der Tab sichtbar ist, und mit `F5`.
- Dock mit Logs, Shell und Inspect; Inspect maskiert Env-Werte mit sensiblen Namen. Starten läuft ohne Nachfrage, Stoppen, Neu starten und Entfernen fragen vorher nach, beim Entfernen muss man den Namen eintippen.
- Container-Ansichten von SSH-Hosts werden in Workspaces gespeichert.
- Seitenleiste: Unter SSH-Verbindungen und „Dieser Computer“ erscheinen statt Container-Listen die Einträge „Docker-Ansicht“ und „Podman-Ansicht“ (nur für installierte Laufzeiten). Ein Klick öffnet die Ansicht oder fokussiert den offenen Tab; „Docker-Ansicht öffnen“ im Kontextmenü öffnet einen weiteren. Die Tabs sind fest auf ihre Laufzeit gesetzt und werden mit ihr im Workspace gespeichert. Proxmox-Gäste bleiben unverändert.
- Container-Ansicht: Mit `sudo` im Passwortmodus meldet sich jeder Poll nur noch einmal an, die vier Listen laufen in einem Befehl. Ein fester Docker- oder Podman-Tab zeigt bei fehlender Laufzeit einen Fehler, statt im Hintergrund die andere Laufzeit abzufragen. Inspect maskiert in nicht parsbarer Ausgabe auch Geheimnisse hinter anderen Einträgen derselben Zeile.
- Einheitliches Erscheinungsbild: Farben, Schatten und Ebenen kommen aus einem gemeinsamen Designsystem. Dialoge, der Verbindungs-Picker sowie das Workspace- und das Layout-Menü blenden kurz ein, Buttons geben beim Klicken leicht nach. Sind die Windows-Animationseffekte ausgeschaltet, bleibt nur das Einblenden. Die Hilfe in Cluster- und Container-Ansicht liegt jetzt über der Kopfzeile.
- Fehlermeldungen erscheinen als Hinweis unten rechts und verschieben das Terminal nicht mehr. Leisten, Knöpfe, Schriftgrößen und Abstände folgen einer festen Skala; Chip-Leiste und Panelköpfe sind kompakter.

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
