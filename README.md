# Terminus

Lokaler SSH-Verbindungsmanager mit verschlüsselten, portablen `.terminus`-Vaults.

## Lokal starten

```powershell
npm install
npm run dev
```

DevTools sind im App-Fenster deaktiviert, auch beim Entwicklungsstart.

## Qualität prüfen

```powershell
npm run typecheck
npm test
npm run build
```

## Aktueller Stand

Vaults erstellen, öffnen und sperren; verschachtelte Ordner und SSH-Verbindungen
anlegen, bearbeiten und löschen. Änderungen werden verschlüsselt gespeichert.
Bis zu 16 SSH-Sessions können als Terminal-Tabs gleichzeitig laufen, auch mehrere
Sessions derselben Verbindung. Doppelklick oder Enter auf einer Verbindung startet
eine Session im fokussierten Bereich. Ein einfacher Klick wählt nur aus.
Die Suche findet Namen, Hosts, Benutzer, Tags und Ordnerpfade. Ordner sind
einklappbar; die Verbindungsliste lässt sich verstellen und ausblenden.

`Neu` → `Neue Verbindung` öffnet das kompakte Formular. `Speichern und verbinden`
speichert verschlüsselt und startet anschließend SSH. Kommentar, Tags, Farbe und
Zielordner stehen unter `Weitere Angaben`; Schlüsseldateien lassen sich auswählen.
Unter `Symbol und Farbe` sind sechs Symbole und eine frei wählbare Farbe pro
Verbindung verfügbar. Sie erscheinen in Verbindungsliste, Terminal-Tabs und
Verbindungsauswahl. Änderungen gelten auch für bereits laufende Tabs und werden
im verschlüsselten Vault gespeichert; bestehende Vaults verwenden das Terminalsymbol.
Über das Bearbeiten-Symbol einer Zeile öffnest du die Eigenschaften. Ungespeicherte
Eingaben sind beim Wechsel geschützt. Ordner lassen sich über F2 direkt umbenennen.
Rechtsklick → `Deaktivieren` graut eine Verbindung aus: Sie lässt sich nicht mehr
öffnen, `Alle verbinden` und Workspaces überspringen sie, Zugangsdaten bleiben
erhalten. Bereits laufende Tabs bleiben offen. `Aktivieren` gibt sie wieder frei.
Hintergrund-Tabs bleiben verbunden und
verarbeiten ihre Ausgabe weiter. Im Tabstreifen wechseln Pfeiltasten sowie
Home/End zwischen Tabs. Das Schließen eines Tabs beendet nur seine Session.
Die Vault-Sperre beendet alle Sessions. Gespeicherte Workspaces lassen sich nach
dem Entsperren gezielt öffnen; dabei starten neue SSH-Sessions.

Text im Terminal markieren kopiert die Auswahl automatisch in die Zwischenablage.
Rechtsklick fügt den Text aus der Zwischenablage in das angeklickte Terminal ein.
Das Einfügen läuft über xterm und berücksichtigt den Bracketed-Paste-Modus des
Servers. Die üblichen Kopier- und Einfüge-Tastenkürzel bleiben verfügbar.

## Split-Ansichten und Workspaces

Ziehe einen Terminal-Tab oder die freie Titelleiste an den linken, rechten, oberen
oder unteren Rand eines Bereichs. Eine halbtransparente Vorschau zeigt die neue
Aufteilung vor dem Loslassen. In der Mitte wird der Tab in den bestehenden
Bereich verschoben. Escape bricht das Ziehen ab. Bis zu vier Bereiche sind möglich;
unzulässige Aufteilungen werden in der Vorschau gekennzeichnet. Leer gezogene
Quellbereiche werden automatisch zusammengeführt. Jeder Bereich hat eigene Tabs.
Das `+` direkt neben den Tabs öffnet eine durchsuchbare Auswahl gespeicherter
Verbindungen und startet die gewählte Verbindung als neuen Tab in diesem Bereich.
Enter öffnet den ersten Treffer, Pfeiltasten wählen aus und Escape schließt die
Auswahl. Das `×` innerhalb der gemeinsamen Tab-Fläche schließt dessen Session.
Im Tabstreifen zeigt eine Einfügelinie, wo der Tab einsortiert wird. So lassen
sich bestehende Bereiche wieder zusammenführen und Tabs innerhalb ihrer Leiste
umordnen. Die freie Titelleiste zieht den aktiven Tab des Bereichs. Das funktioniert
auch nach mehreren Aufteilungen und Verschiebungen; Escape oder Loslassen
außerhalb der Terminalfläche verwirft die Vorschau.

Im Drei-Punkte-Menü jedes Bereichs bleiben `Nebeneinander teilen`,
`Untereinander teilen`, `Aktiven Tab verschieben` und `Bereich zusammenführen`
als Tastaturalternative erreichbar. Trennlinien lassen sich direkt ziehen oder
fokussieren und mit Pfeiltasten verstellen; Doppelklick setzt gleiche Größen.
Das Maximieren-Symbol vergrößert einen Bereich vorübergehend. Diese Aktionen
erhalten laufende Sessions und ihre Terminalausgabe. Im kleinen Fenster füllt
der Editor den Arbeitsbereich, während die Terminals im Hintergrund weiterlaufen.

`Speichern` in der Kopfzeile aktualisiert den aktiven Workspace oder fragt beim
ersten Speichern nach einem Namen. Änderungen sind dort mit `geändert` markiert.
Das Workspace-Menü enthält Öffnen, Umbenennen, Löschen und `Speichern unter …`.
Gespeichert werden die Aufteilung, Größenverhältnisse, Verbindungsreferenzen
und aktive Verbindung je Bereich im verschlüsselten Vault. Terminalausgabe
wird nicht gespeichert. `Speichern unter …` erstellt eine weitere Definition;
die Auswahl im Menü ändert den aktiven Workspace erst beim Öffnen.
`Workspace öffnen` ersetzt die aktuellen Tabs und startet maximal 16 Sessions.
Bei laufenden Sessions erscheint entsprechend der Vault-Einstellung eine
Bestätigung. `Workspace schließen` beendet alle Tabs, erhält aber das gespeicherte
Layout. `Workspace löschen` entfernt nur die gespeicherte Definition.
Mehrere Tabs derselben Verbindung werden wiederhergestellt; ihre aktive Instanz
wird innerhalb eines Bereichs auf die erste Instanz dieser Verbindung gesetzt.

Die Terminals unterstützen Passwort, privaten Schlüssel mit optionaler
Passphrase sowie SSH-Agent. Unter Windows wird ohne `SSH_AUTH_SOCK` der
OpenSSH-Agent unter `\\.\pipe\openssh-ssh-agent` verwendet; der Dienst muss laufen
und den passenden Schlüssel enthalten. Auf Unix muss `SSH_AUTH_SOCK` gesetzt sein.
Agent-Forwarding ist deaktiviert. Interaktive MFA-/Keyboard-Interactive-Anmeldung
folgt in einem weiteren Schritt.

## Container und VMs

Beim Aufklappen einer SSH-Verbindung erkennt Terminus Docker- und Podman-Container
sowie Proxmox-LXC-Container und -VMs. Jedes Aufklappen lädt die Liste neu. Auf dem
Server wird nichts installiert. Doppelklick oder Enter öffnet eine Shell nur in
laufenden Containern und LXC-Containern. VMs bieten über das Kontextmenü
`Serielle Konsole` an; das funktioniert nur mit einer seriellen Schnittstelle.
Das Kontextmenü enthält `Shell öffnen`, bei Docker und Podman `Logs folgen`, bei
Containern `Starten`, `Stoppen` und `Neu starten` sowie bei Proxmox `Starten`,
`Herunterfahren` und `Stoppen`. Ein hartes Stoppen einer VM fragt vorher nach.

`Dieser Computer` zeigt lokales Docker Desktop oder Podman, sofern es antwortet.
Das wird nach dem Entsperren des Vaults geprüft und lässt sich über das Kontextmenü
der freien Fläche im Verbindungsbaum (`Lokale Container suchen`) wiederholen.

Der SSH-Benutzer braucht Zugriff auf Docker über die Gruppe `docker`; für Proxmox
muss er die Befehle als root ausführen können. Alternativ führt die Option
`Container-Befehle mit sudo ausführen` die Befehle pro SSH-Verbindung mit sudo aus.
Meldet sich die Verbindung per Passwort an, beantwortet Terminus die sudo-Abfrage
einmal mit dem gespeicherten Passwort, aber nur, wenn sudo tatsächlich fragt. Bei
Anmeldung per Schlüssel oder Agent läuft `sudo -n`; dafür ist eine NOPASSWD-Regel
für diesen Benutzer nötig. Lehnt sudo das Passwort ab, sendet Terminus es erst
wieder, wenn die Verbindungseinstellungen geändert wurden.

Container-Tabs von SSH-Hosts werden in Workspaces gespeichert, lokale Container-Tabs
nicht. Diese Version bietet keinen Datei-Browser in Containern und keine Proxmox-API.
Kubernetes hat einen eigenen Abschnitt.

## Kubernetes

Ein Cluster wird aus einer bestehenden SSH-Verbindung eingerichtet: Im Kontextmenü
`Als Kubernetes-Cluster einrichten…` wählen. Terminus liest auf dem Host die kubeconfig
und schlägt Name, Context und weitere Zugangs-Hosts vor, etwa `k8s-cp2` und
`k8s-cp3` im selben Namensmuster. Die Zugangs-Hosts werden der Reihe nach
probiert. Fällt einer aus, verbindet Terminus über den nächsten neu; der Status zeigt,
über welchen Host der Cluster gerade erreichbar ist.

Die kubeconfig wird in dieser Reihenfolge gesucht: `$KUBECONFIG` der Login-Shell
(erste Datei), `~/.kube/config`, dann `/etc/kubernetes/admin.conf`. Die Datei unter
`/etc/kubernetes` liest Terminus per sudo mit der Anmeldung der SSH-Verbindung:
Ist ein Passwort gespeichert, beantwortet Terminus die sudo-Abfrage damit, sonst
nutzt es `sudo -n` (dafür braucht der Benutzer NOPASSWD). Kubeconfigs mit `exec`- oder
`auth-provider`-Abschnitten lehnt Terminus ab, weil deren Plugins auf diesem Rechner
statt auf dem Server laufen würden.

Im Einrichtungsformular ist „Produktion“ vorausgewählt; abwählen ist eine bewusste
Entscheidung. „Nur lesen“ sperrt Restart, Scale, Löschen und die Shell; Logs, YAML,
Events und Describe bleiben erlaubt. Jede verändernde Aktion fragt nach. Bei
Produktion muss man den Ressourcennamen eintippen, bevor der Knopf aktiv wird.

Der Cluster-Tab zeigt Nodes, Workloads, Pods und Events live. `Enter` führt per
Drill-down etwa von einem Deployment über seine Pods zu den Containern, `Esc` geht
eine Ebene zurück. Unten öffnet sich ein Bereich für Logs (`l`), Shell (`s`), Events
(`e`), YAML (`y`) und Describe (`d`). `/` filtert, `:` führt Befehle aus wie `:ns all`
oder `:deploy`, und `?` zeigt die Hilfe mit allen Hotkeys und Befehlen.

Rechtsklick oder `Shift+F10` öffnet im Cluster-Tab ein Kontextmenü, auch auf Node-Kacheln,
Problemen und dem unteren Bereich. Es kopiert Namen, Namespace, `kubectl`-Befehle sowie
YAML und Describe (so maskiert, wie sie angezeigt werden), springt zu Besitzer, Node und
beteiligtem Objekt und öffnet über `SSH-Verbindung öffnen` die passende Vault-Verbindung
zur Node. Neu sind Fortsetzen, Anhalten und `Jetzt ausführen…` für CronJobs sowie
`Node sperren (cordon)…` und `Node freigeben (uncordon)…`; alle fragen nach und sind bei
„Nur lesen“ gesperrt. `drain` gibt es nur als kopierbaren Befehl.

Die kubeconfig liegt nur im Speicher des Hauptprozesses und wird nicht auf die
Festplatte geschrieben. Der Tunnel zum API-Server lauscht nur auf `127.0.0.1`.
Secret-Daten sind in der YAML-Ansicht maskiert.

## Server-Schlüssel

Beim ersten Kontakt den angezeigten SHA-256-Fingerprint mit einer
vertrauenswürdigen Quelle vergleichen. Nur ausdrücklich bestätigte Schlüssel
werden in `known-hosts.json` im Electron-Benutzerdatenverzeichnis gespeichert.
Diese Datei enthält Hosts, Ports und öffentliche Fingerprints, keine Zugangsdaten.
Sie ist eine eigene Terminus-Vertrauensdatei; OpenSSHs `known_hosts` wird noch
nicht importiert. Abweichende Schlüssel und beschädigte Vertrauensdateien brechen
die Verbindung ab. Ein Schlüsselwechsel muss mit dem Server-Administrator geklärt
werden; eine Oberfläche zur gezielten Verwaltung vertrauter Hosts folgt später.

## Prozessgrenzen und Lebenszyklus

- Main: verschlüsselte Dateien, Vault-Session-Key, `ssh2`, Host-Key-Prüfung.
- Preload: explizite, typisierte IPC-Methoden; Events ohne Electron-Eventobjekt.
- Renderer: React und xterm.js; kein Node-, Dateisystem- oder Socket-Zugriff.
- SSH-Anfragen verwenden gespeicherte Connection-IDs und besitzgebundene Session-IDs.
- Ausgabe pausiert bei ausstehenden xterm-Bestätigungen; Eingaben und Scrollback
  sind begrenzt. Terminalausgabe wird nicht auf Platte protokolliert.
- Trennen, Vault-Sperre, Fensterende und Renderer-Ausfall beenden die SSH-Session.
  Bei aktiven Sessions wird das Schließen entsprechend der Vault-Einstellung bestätigt.

Die SSH-Tests betreiben einen lokalen `ssh2`-Server mit zur Laufzeit erzeugten
Testschlüsseln und synthetischen Zugangsdaten. Sie prüfen echte Handshakes,
Shell-I/O, Resize, Fehler, Besitzgrenzen, parallele Sessions und Backpressure.
Weitere Tests sichern die Tab-Auswahl und das Schließen einzelner Tabs sowie
serialisierte Host-Key-Bestätigungen ab.
