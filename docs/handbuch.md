# Shellherd – Handbuch

<img src="../resources/icon.png" width="96" alt="Shellherd">

Ausführliche Beschreibung der Funktionen. Kurzüberblick, Download und Installation stehen in der [README](../README.md).

Lokaler Verbindungsmanager für SSH, RDP, Container und Kubernetes mit verschlüsselten, portablen Vault-Dateien (`.term`).

Shellherd hieß bis Version 0.9.0 Terminus; Vault-Dateien (`.term`, ältere `.terminus`) bleiben kompatibel. Beim ersten Start übernimmt Shellherd die Einstellungen (bekannte Hostschlüssel, zuletzt geöffnete Vault-Datei) einmalig aus `%APPDATA%\Terminus`; der alte Ordner bleibt unverändert. Repository: <https://github.com/pelmenipower/Shellherd>.

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

## Designsystem

Farben, Maße, Radien, Ebenen, Schatten und Bewegung kommen aus einer Datei: `src/renderer/src/tokens.css`. Die Regeln für neue Oberflächen stehen in [`docs/design-system.md`](design-system.md). Der Test `src/renderer/src/design-tokens.test.ts` prüft alle CSS-Dateien auf harte Farben und Maße, eingebaute Easings, feste Dauern und z-index-Werte sowie auf Bewegung ohne `prefers-reduced-motion`.

## Icons

Programmsymbol und Oberflächenzeichen entstehen aus `resources/brand/shellherd-master.png` und den Kleinvarianten in `resources/brand/`. `npm run icons` erzeugt daraus `resources/icon.png`, `resources/icon.ico` und `resources/mark-64.png`.

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

Beim Aufklappen einer SSH-Verbindung erkennt Shellherd, ob Docker und Podman
installiert sind, und zeigt je Laufzeit einen Eintrag `Docker-Ansicht` bzw.
`Podman-Ansicht`; ein Klick öffnet die Container-Ansicht oder wechselt zu einem
bereits offenen Tab. Ein weiterer Tab entsteht über das Kontextmenü des Eintrags
(`Docker-Ansicht öffnen`). Proxmox-LXC-Container und -VMs erscheinen weiterhin als
Liste. Jedes Aufklappen lädt neu. Auf dem Server wird nichts installiert.
Doppelklick oder Enter öffnet eine Shell nur in laufenden LXC-Containern. VMs
bieten über das Kontextmenü `Serielle Konsole` an; das funktioniert nur mit einer
seriellen Schnittstelle.
Das Kontextmenü der Proxmox-Gäste enthält `Shell öffnen`, `Starten`,
`Herunterfahren` und `Stoppen`. Ein hartes Stoppen einer VM fragt vorher nach.

`Dieser Computer` zeigt `Docker-Ansicht` und `Podman-Ansicht`, sofern die jeweilige
CLI installiert ist. Das wird nach dem Entsperren des Vaults geprüft und lässt sich
über das Kontextmenü der freien Fläche im Verbindungsbaum (`Lokale Laufzeiten suchen`)
wiederholen.

Der SSH-Benutzer braucht Zugriff auf Docker über die Gruppe `docker`; für Proxmox
muss er die Befehle als root ausführen können. Alternativ führt die Option
`Container-Befehle mit sudo ausführen` die Befehle pro SSH-Verbindung mit sudo aus.
Meldet sich die Verbindung per Passwort an, beantwortet Shellherd die sudo-Abfrage
einmal mit dem gespeicherten Passwort, aber nur, wenn sudo tatsächlich fragt. Bei
Anmeldung per Schlüssel oder Agent läuft `sudo -n`; dafür ist eine NOPASSWD-Regel
für diesen Benutzer nötig. Lehnt sudo das Passwort ab, sendet Shellherd es erst
wieder, wenn die Verbindungseinstellungen geändert wurden.

Container-Tabs von SSH-Hosts werden in Workspaces gespeichert, lokale Container-Tabs
nicht. Diese Version bietet keinen Datei-Browser in Containern und keine Proxmox-API.
Kubernetes hat einen eigenen Abschnitt.

### Container-Ansicht

Für Docker und Podman gibt es zusätzlich eine Ansicht im Stil des Cluster-Tabs. Sie
öffnet sich über das Kontextmenü einer SSH-Verbindung (`Container-Ansicht öffnen`)
oder für den eigenen Rechner über `Lokale Container-Ansicht öffnen` (Überschrift
`Dieser Computer` oder freie Fläche im Verbindungsbaum). Die Ansicht hat vier Reiter:
Container, Images, Volumes und Netzwerke. Jeder Reiter hat Spaltenfilter, Chips,
Gruppierung und Sortierung; Filter und Gruppierung bleiben je Reiter erhalten, `F`
setzt die Filter zurück. Ein Tab aus der Seitenleiste ist fest auf seine Laufzeit
gesetzt. Der freie Tab (`Container-Ansicht öffnen`, `Lokale Container-Ansicht öffnen`)
hat einen Umschalter im Kopf, wenn Docker und Podman installiert sind. Die Liste
aktualisiert sich alle 10 Sekunden, solange der Tab sichtbar ist, sowie nach jeder
Aktion und mit `F5`.

Das Dock unter der Tabelle zeigt Logs (`l`), eine Shell (`s`, startet erst auf
Knopfdruck, nur bei laufenden Containern) und Inspect (`i`). Bei Images, Volumes und
Netzwerken gibt es nur Inspect. Starten läuft ohne Nachfrage. Stoppen, Neu starten
und Entfernen öffnen einen Dialog; beim Entfernen von Containern, Images und Volumes
muss man den Namen bzw. die Referenz eintippen. Verwendete Images und Volumes lassen
sich nicht entfernen.

Grenzen:

- Inspect maskiert nur die Werte in `Config.Env`, deren Name sensibel klingt. Labels,
  `Cmd` und Mounts bleiben unverändert sichtbar, ein Geheimnis in `Cmd` ist also lesbar.
  Zugangsdaten in Werten wie `DATABASE_URL=postgres://u:p@…` werden nicht maskiert,
  weil nur die Namen geprüft werden.
- Ohne sudo zeigt Podman nur die Container des SSH-Benutzers (rootless).
- Ein zweiter Tab desselben Hosts pollt doppelt. Mit `sudo` im Passwortmodus meldet
  sich jeder Poll einmal per sudo an; das steht im Auth-Log des Hosts.
- Fehlt die Laufzeit eines festen Tabs auf dem Host, zeigt der Tab einen Fehler. Im
  Hintergrund prüft er nur noch ohne sudo, ob sie wieder da ist.

## Kubernetes

Ein Cluster wird aus einer bestehenden SSH-Verbindung eingerichtet: Im Kontextmenü
`Als Kubernetes-Cluster einrichten…` wählen. Shellherd liest auf dem Host die kubeconfig
und schlägt Name, Context und weitere Zugangs-Hosts vor, etwa `k8s-cp2` und
`k8s-cp3` im selben Namensmuster. Die Zugangs-Hosts werden der Reihe nach
probiert. Fällt einer aus, verbindet Shellherd über den nächsten neu; der Status zeigt,
über welchen Host der Cluster gerade erreichbar ist.

Die kubeconfig wird in dieser Reihenfolge gesucht: `$KUBECONFIG` der Login-Shell
(erste Datei), `~/.kube/config`, dann `/etc/kubernetes/admin.conf`. Die Datei unter
`/etc/kubernetes` liest Shellherd per sudo mit der Anmeldung der SSH-Verbindung:
Ist ein Passwort gespeichert, beantwortet Shellherd die sudo-Abfrage damit, sonst
nutzt es `sudo -n` (dafür braucht der Benutzer NOPASSWD). Kubeconfigs mit `exec`- oder
`auth-provider`-Abschnitten lehnt Shellherd ab, weil deren Plugins auf diesem Rechner
statt auf dem Server laufen würden.

Im Einrichtungsformular ist „Produktion“ vorausgewählt; abwählen ist eine bewusste
Entscheidung. „Nur lesen“ sperrt Restart, Scale, Löschen und die Shell; Logs, YAML,
Events und Describe bleiben erlaubt. Jede verändernde Aktion fragt nach. Bei
Produktion muss man den Ressourcennamen eintippen, bevor der Knopf aktiv wird.

Der Cluster-Tab zeigt Nodes, Workloads, Pods und Events live. `Enter` führt per
Drill-down etwa von einem Deployment über seine Pods zu den Containern, `Esc` geht
eine Ebene zurück. Unten öffnet sich ein Bereich für Logs (`l`), Shell (`s`), Events
(`e`), YAML (`y`) und Describe (`d`). `?` zeigt die Hilfe mit allen Tasten und Filterformen.

Jede Spalte der Tabelle hat unter dem Kopf ein Filterfeld: Text (enthält), Auswahl für
Namespace, Status, Typ, Node und Rollen, Zahlen (`>3`, `<=5`, `3`) und Alter (`<10m`,
`>1h`, `<2d`). Alle Filter gelten zusammen; ungültige Eingaben sind rot markiert und filtern
nicht. `/` springt in den Namensfilter (Events: Meldung), `F` setzt alle Filter des Reiters
zurück. Darüber zeigt eine Chip-Leiste Status-Filter mit Zähler (Pods etwa „Läuft“, „Wartet“,
„Fehler“, „Nicht bereit“, „Mit Neustarts“; Jobs „Läuft“, „Erfolgreich“, „Fehlgeschlagen“;
Events „Warning“, „Normal“, „Letzte 5 min“). Chips einer Gruppe verbinden sich mit ODER,
Gruppen untereinander mit UND; `w` zeigt nur Auffälliges (bei Events nur Warnungen).
Textfilter aus dem Kontextmenü (z. B. `app=api`) erscheinen als Chip „Filter: …“ und lassen
sich mit × entfernen. „Gruppieren nach“ (z. B. Namespace, Node, Status, Owner) fasst Zeilen
zu Gruppen zusammen, die sich per Klick auf- und zuklappen lassen. Filter und Gruppierung
merkt sich jeder Reiter, auch im Workspace. Namespaces ohne Pods erreicht man über „alle“
und den Namespace-Filter; ohne konfigurierten Namespace startet der Cluster-Tab mit allen
Namespaces. Events sind nach „Zuletzt“ absteigend sortiert; Jobs zeigen ihren Status, Pods
auch „Evicted“ und „Unknown“, Nodes einen Hinweis bei Druck.

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
Sie liegt unter `%APPDATA%\Shellherd\known-hosts.json`; beim ersten Start übernimmt
Shellherd sie einmalig aus `%APPDATA%\Terminus`. Sie ist eine eigene
Shellherd-Vertrauensdatei; OpenSSHs `known_hosts` wird noch
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
