# Shellherd – Handbuch

<img src="../resources/icon.png" width="96" alt="Shellherd">

Ausführliche Beschreibung der Funktionen. Kurzüberblick, Download und Installation stehen in der [README](../README.md). English version: [manual.md](manual.md).

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
Sperren trennt nicht: Die Sitzungen laufen im Hintergrund weiter, und nach dem Entsperren sind alle Tabs wieder da. Neue Verbindungen und `Neu verbinden` gehen erst nach dem Entsperren. `Andere Vault-Datei` im Sperrbildschirm fragt immer nach und trennt alles. Gespeicherte Workspaces lassen sich nach
dem Entsperren gezielt öffnen; dabei starten neue SSH-Sessions.

### Sperren und Willkommens-Tab

Der Sperrknopf in der Kopfzeile sperrt ohne Rückfrage. Ein undurchsichtiger Sperrbildschirm deckt das Fenster ab; die Tastatur erreicht nichts dahinter. Nebenfenster werden mitgesperrt und zeigen ihren eigenen Sperrbildschirm (ohne Passwortfeld); entsperrt wird im Hauptfenster.

- **Zugangsdaten im Speicher:** Die Zugangsdaten offener Sitzungen bleiben während der Sperre im Speicher von Shellherd. Ein geänderter, ungespeicherter Verbindungseditor behält seinen Inhalt, auch das gespeicherte Passwort der Verbindung; ein unveränderter Editor schließt beim Sperren. Gegen das Auslesen des Arbeitsspeichers schützt die Sperre nicht.
- **Leerlauf-Trennung:** Sie läuft während der Sperre weiter. Eine lange Sperre kann Sitzungen trennen; die Getrennt-Leiste wartet dann nach dem Entsperren.
- **Assistent:** Automatische Rückfragen des Assistenten (gelesene Ausgabe) scheitern während der Sperre mit „Es ist kein Vault entsperrt.“
- **Host-Schlüssel:** Eine offene Host-Schlüssel-Rückfrage kann über dem Sperrbildschirm erscheinen. Sie zeigt nur Host und Fingerabdruck.
- **Willkommens-Tab:** Beim Öffnen eines Vaults erscheint die Willkommensseite als Tab. Du öffnest sie wieder über das `+`-Menü (`Willkommensseite`). Der Tab lässt sich nur schließen: nicht ziehen, nicht teilen, nicht in ein anderes Fenster verschieben. Er wird nicht im Workspace gespeichert und zählt zum Limit von 16 Tabs.

Text im Terminal markieren kopiert die Auswahl automatisch in die Zwischenablage.
Rechtsklick fügt den Text aus der Zwischenablage in das angeklickte Terminal ein.
Das Einfügen läuft über xterm und berücksichtigt den Bracketed-Paste-Modus des
Servers. Die üblichen Kopier- und Einfüge-Tastenkürzel bleiben verfügbar.

Im Terminal suchst du mit `Strg+Umschalt+F`. `Enter` sucht weiter, `Umschalt+Enter` zurück, `Esc` schließt die Suche. Groß- und Kleinschreibung spielen keine Rolle. Treffer werden über die Auswahl markiert und nicht in die Zwischenablage kopiert. In den Terminals der Docks in Container- und Cluster-Ansicht gibt es keine Suche; dort geht `Strg+Umschalt+F` an das Terminal.

Links öffnest du mit `Strg+Klick`. Erlaubt sind nur `http`- und `https`-Adressen bis 2048 Zeichen ohne Benutzername und Passwort; alles andere bleibt Text. Beim Überfahren eines Links zeigt das Terminal einen Hinweis, der das Ziel nennt: „Strg+Klick öffnet <Host> im Browser“. Erscheint ein Link unter der ruhenden Maus, bewege die Maus kurz auf eine andere Zeile.

Ein Tab, dessen Terminal gerade nicht sichtbar ist, zeigt mit neuer Ausgabe einen Ring nach dem Namen; der Name wird hell und fett. Sobald du den Tab siehst, verschwindet die Markierung.

Das Hauptfenster merkt sich beim Schließen Größe, Position und Maximierung. Die Angaben stehen in `settings.json` im Benutzerdatenordner, nicht im Vault. Ein minimiert geschlossenes Fenster behält die bisherige Position.

Dateiansicht: `Bearbeiten` öffnet nur Text-, Konfigurations- und Quelltextdateien im Standardprogramm, alles andere in Notepad.

### Tastenkürzel

| Kürzel | Wirkung |
|---|---|
| `Strg+,` | Einstellungen öffnen |
| `Strg+Umschalt+K` | KI-Assistenten ein- oder ausblenden |
| `Strg+Umschalt+Leertaste` | Workflow-Palette öffnen |
| `Strg+Umschalt+F` | Suche im Terminal |
| `Strg+Klick` | Link im Terminal öffnen (nur http und https) |
| `Strg+Tab` | Nächsten Tab im fokussierten Bereich wählen |
| `Strg+Umschalt+Tab` | Vorherigen Tab im fokussierten Bereich wählen |
| `Strg+Umschalt+T` | Verbindungsauswahl des fokussierten Bereichs öffnen |
| `Strg+Umschalt+W` | Aktiven Tab des fokussierten Bereichs schließen (mit Rückfrage) |

`Strg+F`, `Strg+T` und `Strg+W` bleiben der Shell (ein Zeichen vor, Zeichen tauschen, Wort löschen), deshalb die Umschalt-Varianten. Die Tab-Kürzel wirken nicht, solange ein Dialog offen ist oder du in einem Textfeld tippst; im Terminal selbst funktionieren sie. `Strg+Umschalt+T` und `Strg+Umschalt+W` wiederholen sich nicht, wenn du die Taste gedrückt hältst.

### Eingabe an alle

Im Menü des Bereichskopfs schaltet `Eingabe an alle Bereiche senden` ein; der Eintrag erscheint ab zwei Bereichen. Was du tippst, geht dann an alle verbundenen SSH- und lokalen Terminals der angezeigten Ansicht. Container, Pods, RDP, SFTP, Cluster und die Willkommensseite bleiben aus. Workflows und der Assistent schreiben weiter nur in einen Tab. Die Bereiche der Mitglieder zeigen eine Warnlinie und den Knopf `An alle`; ein Klick darauf beendet die Eingabe. Sie endet auch beim Ansichtswechsel und wenn weniger als zwei Terminals übrig sind.

## Einstellungen

Das Zahnrad rechts in der Kopfzeile öffnet die Einstellungen, ebenso `Strg+,`. Vor dem Entsperren führt der Link `Einstellungen` unten auf der Startkarte dorthin. Alle Werte gelten sofort, ein „Speichern“ gibt es nicht. Nebenfenster haben keine eigenen Einstellungen; Sprache und Vault-Einstellung gelten dort trotzdem. Hat eine RDP-Sitzung den Fokus, gehen Tastenkürzel an den entfernten Rechner, auch `Strg+,`.

### Sprache

Shellherd gibt es auf Deutsch und Englisch. Standard ist die Systemsprache: Bei deutscher Windows-Anzeigesprache startet Shellherd auf Deutsch, sonst auf Englisch.

Die Einstellung `Sprache` unter Einstellungen → Allgemein bietet `System`, `Deutsch` und `English`. Der Wechsel gilt sofort in allen Fenstern, ohne Neustart; offene Sitzungen laufen weiter. Die Wahl liegt in `settings.json` im Benutzerdatenordner (`%APPDATA%\Shellherd`).

Fehlermeldungen, Dialoge und Fenstertitel folgen der Sprache, ebenso Datum, Zahlen, Dateigrößen, Sortierung und Suche. Der KI-Assistent antwortet in der gewählten Sprache. Ausgaben im Stil von `kubectl` (etwa `Beschreiben` in der Cluster-Ansicht) und Rohstatus von Servern bleiben englisch. Der Installer folgt der Windows-Sprache.

### Dateiverknüpfung

`In Windows einbinden` unter Einstellungen → Allgemein verknüpft `.term`-Dateien mit Shellherd: Doppelklick im Explorer oder Rechtsklick → „Mit Shellherd öffnen“ öffnet den Vault. Die Verknüpfung gilt nur für den angemeldeten Benutzer (HKCU) und braucht keine Administratorrechte. `Verknüpfung entfernen` nimmt sie wieder heraus.

### Updates

`Nach neuen Versionen suchen` unter Einstellungen → Allgemein ist standardmäßig an. Höchstens einmal am Tag fragt Shellherd nach dem Entsperren bei GitHub nach der neuesten Version (`releases/latest`) und zeigt sie in der Statusleiste. Ein Klick öffnet die Release-Notes oder überspringt diese Version. Gesendet wird nur die Anfrage selbst, also deine IP-Adresse und `User-Agent: Shellherd/<Version>`, nichts aus dem Vault. Vor dem Entsperren gibt es keine Netzanfrage, bei abgeschaltetem Schalter gar keine. Der Schalter steht auch ohne Vault bereit. Shellherd installiert keine Updates; Download und Installation machst du selbst.

### Vault

`Vor dem Trennen laufender Sitzungen nachfragen` (Standard: an) fragt nach, bevor das Schließen eines Tabs oder Fensters oder ein Workspace-Wechsel laufende Sitzungen beendet. Die Einstellung gehört zum Vault und wird verschlüsselt mit ihm gespeichert; sie erscheint erst nach dem Entsperren.

`Automatisch sperren nach … Minuten ohne Eingabe (0: nie)` sperrt den Vault, wenn in keinem Shellherd-Fenster Maus oder Tastatur benutzt wurde (Bereich 0 bis 1.440, Standard 15). Offene Sitzungen und Tabs bleiben erhalten. Der Wert wird bei Blur oder `Enter` übernommen und gilt sofort.

- **Was zählt:** Nur Maus und Tastatur in Shellherd-Fenstern. Terminal-Ausgabe zählt nicht: Wer nur einen langen Lauf beobachtet, wird gesperrt. Arbeit in anderen Programmen zählt ebenfalls nicht.
- **RDP:** Solange eine RDP-Sitzung verbunden ist, zählt zusätzlich jede Eingabe am Rechner, denn Maus und Tastatur im RDP-Fenster gehen an Shellherd vorbei.
- **Nichts wird gefragt:** Die Sperre arbeitet wie das manuelle Sperren, ohne Rückfrage. Offene Einstellungs- und Anbieter-Dialoge schließen sich. Nebenfenster werden mitgesperrt, nicht geschlossen. Nach der Sperre nennt der Sperrbildschirm den Grund.
- **Ungenauigkeit:** Die Sperre kommt bis zu 10 Sekunden früher oder bis zu 30 Sekunden später als eingestellt; nach dem Aufwachen aus dem Ruhezustand sperrt Shellherd sofort, wenn die Zeit abgelaufen ist.
- **Bestehende Vaults:** Jeder Vault trägt den Wert 15. Sie sperren sich daher ab dieser Version nach 15 Minuten; `0` schaltet die Sperre ab.

### Verbindungen

Unter Einstellungen → Verbindungen (erst nach dem Entsperren) stehen vier Werte für SSH und SFTP dieses Vaults. Sie gelten auch für Container- und Cluster-Zugriffe über SSH und werden mit dem Vault gespeichert. Jedes Feld übernimmt seinen Wert bei Blur oder `Enter`; eine Zahl außerhalb der Grenzen steht als Fehler unter dem Feld.

| Wert | Standard | Grenzen |
|---|---|---|
| `Leerlauf-Trennung nach … Minuten ohne Ein- und Ausgabe (0: nie)` | 0 | 0 bis 1.440 |
| `Keepalive alle … Sekunden` | 15 | 5 bis 300 |
| `Trennen nach … unbeantworteten Keepalives` | 3 | 1 bis 10 |
| `Verbindungs-Timeout … Sekunden` | 120 | 5 bis 300 |

- **Gilt ab der nächsten Verbindung.** Offene Sitzungen behalten ihre Werte; `Neu verbinden` übernimmt die neuen.
- **Leerlauf:** Eingabe oder Ausgabe setzt die Zeit zurück. Danach zeigt die Leiste „wegen Leerlauf getrennt“ und `Neu verbinden` (`Enter`). Das gilt für SSH-Terminals, Container-Tabs, Pod-Terminals und die Dateiansicht. Lokale Shells, RDP und Cluster-Ansichten haben keinen Leerlauf. Eine Dateiansicht mit laufendem Transfer, aktivem Auto-Upload oder offener Bearbeitung trennt sich nicht durch Leerlauf.
- **Pro Verbindung:** Unter `Weitere Angaben` einer SSH- oder SFTP-Verbindung lassen sich die vier Werte einzeln überschreiben (`Leerlauf-Trennung (min)`, `Keepalive (s)`, `Keepalive-Fehlversuche`, `Verbindungs-Timeout (s)`). Leer heißt: Vorgabe aus den Einstellungen. Container und Cluster erben die Werte des genutzten SSH-Knotens.
- **Kurzer Verbindungs-Timeout:** Er läuft auch, solange die Rückfrage zum Server-Schlüssel offen ist. Bei sehr kurzem Wert scheitert das Annehmen eines neuen Schlüssels, wenn du länger liest. Nimm neue Schlüssel dann über `Verbindung testen` an (dessen Zeitmesser pausiert in der Rückfrage) oder stelle einen größeren Wert ein.

### Terminal

Unter Einstellungen → Terminal (nach dem Entsperren) stehen Schriftart, Schriftgröße, Verlauf, Cursorform und Blinken. Die Werte gelten sofort für alle offenen Terminals dieses Vaults und werden mit ihm gespeichert. Ältere Shellherd-Versionen entfernen sie beim Speichern.

| Wert | Standard | Grenzen |
|---|---|---|
| `Schriftart` | Consolas | höchstens 64 Zeichen: Buchstaben, Ziffern, Leerzeichen, `.`, `_`, `-` |
| `Schriftgröße` | 14 Pixel | 8 bis 32 |
| `Verlauf` | 5.000 Zeilen | 1.000 bis 50.000 |
| `Cursor` | Block | Block, Strich oder Unterstrich |
| `Cursor blinkt` | ja | ja oder nein |

- **Schriftart:** Ein Name, keine Liste der installierten Schriften. Leer oder auf diesem Computer nicht installiert, nimmt Shellherd Consolas, danach Cascadia Mono und eine Standard-Festbreitenschrift.
- **Verlauf:** Jede Zeile belegt Speicher; 10.000 Zeilen brauchen etwa 15 MB je Terminal, bei 16 offenen Terminals bis zu 240 MB. Ein kleinerer Wert kürzt den Verlauf offener Terminals.

### KI-Anbieter

Unter Einstellungen → KI-Assistent stehen Zahl und Standard der eingerichteten Anbieter. `Anbieter verwalten` öffnet die Anbieterliste, `Fertig` führt zurück in die Einstellungen. Dieselbe Liste öffnet auch das Zahnrad im Assistenten-Panel; die Schlüssel liegen verschlüsselt im Vault.

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

Agent-Forwarding ist deaktiviert.

Fragt der Server bei der Anmeldung nach weiteren Angaben (Einmalcode, PIN, zweites
Passwort), öffnet sich der Dialog „Anmeldung bei …“ bei Terminal und Dateiansicht im Fenster des
Tabs, bei Containern, Clustern und dem Verbindungstest im zuletzt benutzten Shellherd-Fenster. Die
Antworten gehen nur an diesen Server, werden nicht gespeichert und nicht
protokolliert. Fragt der Server genau einmal nach einem Passwort und hat die
Verbindung ein gespeichertes Passwort, setzt Shellherd es einmal automatisch ein;
jede andere Frage kommt in den Dialog. Höchstens 6 Abfragen je Verbindung, danach
bricht sie mit einer Meldung ab. Abbrechen im Dialog beendet den Versuch. Die
Verbindungszeit (Einstellungen → Verbindungen) läuft während der Rückfrage weiter;
bei 2FA den Verbindungs-Timeout auf mindestens 60 s setzen. Der Dialog erscheint
nie über dem Sperrbildschirm; beim Sperren wird eine offene Rückfrage abgebrochen.
Mehrere Tabs mit Rückfragen fragen nacheinander.


### Nach dem Anmelden

Pro SSH-Verbindung lässt sich im Formular festlegen, was nach dem Anmelden
passiert. Beides gilt bei jedem Verbinden, auch bei `Neu verbinden` und beim
Wiederherstellen eines Workspaces.

- `Nach dem Anmelden root werden (sudo -i)` startet die Shell als root. Bei
  Passwort-Anmeldung beantwortet Shellherd die sudo-Abfrage genau einmal mit dem
  gespeicherten Passwort; das Passwort und der sudo-Aufruf stehen nicht in der
  History. Bei Schlüssel oder SSH-Agent prüft Shellherd mit `sudo -n true`, ob
  sudo ohne Passwort geht (NOPASSWD, auch neben einer `%sudo`-Regel). Wenn nicht,
  erscheint im Terminal ein Hinweis, und sudo fragt selbst: Sie tippen das
  Passwort einmal, danach geht es weiter. Ein eigenes sudo-Passwortfeld gibt es
  nicht. Lehnt sudo das gespeicherte Passwort ab, versucht Shellherd es erst
  nach einer Änderung der Anmeldedaten wieder.
- `Startbefehle` sind Freitext, eine Zeile je Befehl: höchstens 20 Zeilen mit je
  höchstens 500 Zeichen, ohne Steuerzeichen und ohne Tab (stattdessen
  Leerzeichen). Leerzeilen fallen weg. Shellherd tippt sie nach dem Anmelden
  ein, wie Sie es täten. Sie sind sichtbar und stehen in der Shell-History.
  Schreiben Sie keine Passwörter oder Tokens hinein.

Mit `root werden` gehen die Startbefehle erst nach erfolgreichem sudo raus, in
der Root-Shell. Ohne `root werden` gehen sie sofort nach dem Start der Shell
raus. Fragt der Server vorher etwas ab (abgelaufenes Passwort, Auswahlmenü,
eine Abfrage in `.bashrc`), landen die Startbefehle dort. Ein Startskript auf
dem Server, das die vorab gesendete Eingabe verwirft, lässt die Befehle
verschwinden; Shellherd wiederholt sie nicht. Ein Vollbild- oder
Eingabeprogramm (`vim`, `top`, `ssh`) gehört nur in die letzte Zeile, sonst
liest es die folgenden Zeilen als Tastendrücke. Getippte Befehle können doppelt
erscheinen, einmal als Echo vor dem Prompt und einmal an der Eingabezeile; das
ist bei vorab Getipptem normal.

Die Root-Shell startet ohne Begrüßung (kein MOTD, kein `Last login`), und
`exit` darin schließt den Tab, statt zur Benutzer-Shell zurückzukehren. Jeder
sudo-Aufruf steht im auth.log des Servers; das ist normal.

Ältere Shellherd-Versionen entfernen die Einstellungen beim Speichern der
Verbindung.

Rechtsklick auf einen Tab (Shift+F10 oder die Menütaste gehen auch) bietet
`Umbenennen`. Der Name gilt nur für diesen Tab, nicht für die gespeicherte
Verbindung, und er wandert mit dem Tab in andere Fenster. Ein leerer Name
stellt den Verbindungsnamen wieder her. Ein Workspace speichert ihn nicht.

## Sprunghost

Eine SSH- oder SFTP-Verbindung kann über eine andere SSH-Verbindung laufen
(Sprunghost, Bastion). Im Formular wählst du unter `Weitere Angaben` bei
`Sprunghost` die Verbindung. Shellherd verbindet zuerst mit dem Sprunghost und
von dort mit Host und Port aus dem Formular; diese gelten vom Sprunghost aus.

- Genau ein Hop. Der Sprunghost darf selbst keinen Sprunghost haben und nicht die
  Verbindung selbst sein. Ketten gehen noch nicht. Das Formular lehnt beides ab,
  Shellherd prüft es beim Verbinden noch einmal.
- Deaktivierte SSH-Verbindungen sind markiert; als Sprunghost gewählt, lässt sich
  die Verbindung nicht speichern.
- Der Sprunghost nutzt seine eigenen Zugangsdaten, Timeouts und seine
  Host-Schlüssel-Prüfung. Fragt er nach 2FA, nennt der Dialog seinen Namen.
- Der Sprunghost wirkt bei Terminal, Dateiansicht, Container, Cluster und
  Verbindungstest. Der Verbindungstest zeigt dafür den Schritt „Sprunghost … verbunden“.
- Löschen: Die Auswahl in den anderen Verbindungen bleibt stehen, der Löschdialog
  nennt ihre Zahl. Diese Verbindungen scheitern mit einer Meldung, bis du dort einen
  anderen Sprunghost oder `Keiner` wählst. Shellherd stellt nicht stillschweigend
  auf direkte Verbindung um, denn das würde am Bastion vorbeiführen.
- Ein geänderter Schlüssel des Sprunghosts erscheint als Ursache in der Fehlerkarte,
  ohne Fingerabdrücke. `Verbindung testen` am Sprunghost zeigt sie.

Risiken:

- **known-hosts:** Dieselbe interne Adresse (z. B. `10.0.0.5:22`) hinter zwei
  verschiedenen Sprunghosts teilt sich in Shellherd einen Schlüssel-Eintrag. Die
  zweite Verbindung meldet dann „Schlüssel geändert“. Shellherd kennt keinen Alias
  wie OpenSSH `HostKeyAlias`. Verbindungen mit gleicher Zieladresse hinter
  verschiedenen Sprunghosts deshalb vermeiden.
- **Mehrere 2FA-Hosts:** Öffnest du einen Workspace mit vielen Verbindungen über
  2FA-Sprunghosts, kommen die Rückfragen nacheinander. Hintere Sitzungen können
  über den Verbindungs-Timeout ablaufen; dann hilft `Neu verbinden`.
- **Keine Teilung:** Jeder Tab baut seinen Sprunghost-Hop selbst auf und fragt
  dessen 2FA erneut.
- **Ältere Versionen** (0.18 und älter) entfernen das Feld beim Speichern.

## Port-Weiterleitungen

Unter `Weitere Angaben` einer SSH-Verbindung legst du Port-Weiterleitungen fest
(höchstens 16). Sie gehören zu einer Terminal-Sitzung dieser Verbindung.

| Art | Was passiert |
|---|---|
| Lokal (-L) | Lauscht nur auf 127.0.0.1 dieses Computers. Das Ziel (Host und Port) gilt vom Server aus. |
| Entfernt (-R) | Lauscht auf dem Server an `localhost`. Andere Rechner erreichen den Port nur mit `GatewayPorts` in der `sshd_config`. Das Ziel gilt von diesem Computer aus. |
| Dynamisch (-D) | SOCKS5-Proxy ohne Anmeldung auf 127.0.0.1. Im Browser oder Programm als SOCKS-Proxy eintragen. Nur TCP, kein UDP. |

- Die Leiste „Weiterleitungen“ unter dem Terminal zeigt jede Weiterleitung mit ihrem
  Zustand und einem Knopf zum Starten oder Stoppen. Sie erscheint, sobald die
  Verbindung steht.
- Mit „Beim Verbinden starten“ startet Shellherd die Weiterleitung nach dem
  Anmelden, wenn sie frei ist. Das passiert nur bei einer Verbindung, die du selbst
  öffnest.
- Eine Weiterleitung läuft app-weit höchstens einmal. Läuft sie in einem anderen
  Tab, zeigt die Leiste nur „läuft in anderem Tab“. Sobald der andere Tab sie stoppt
  oder schließt, erscheint hier „Starten“.
- Änderungen an der Liste gelten ab der nächsten Verbindung; `Neu verbinden`
  übernimmt sie.
- Ende der Sitzung (Tab schließen, Trennen, Leerlauf) stoppt ihre Weiterleitungen.
  Offene Verbindungen über eine Weiterleitung halten die Sitzung gegen Leerlauf wach.
- Gesperrt laufen bestehende Weiterleitungen weiter, Starten geht nicht.
- Ist der Port auf diesem Computer belegt, sagt die Leiste das. Lehnt der Server
  ab, liegt es meist an `AllowTcpForwarding` oder einem belegten Port auf dem Server.
- Pods und Services im Cluster sind hier nicht enthalten; der Cluster-Bereich zeigt
  weiter den `kubectl port-forward`-Befehl zum Kopieren.
- **Risiko entfernt:** Mit `GatewayPorts yes` auf dem Server ist der Port für das
  Netz erreichbar. Shellherd verhindert das nicht; ohne diese Einstellung bleibt er
  auf `localhost` des Servers.
- **Ältere Versionen** (0.18 und älter) entfernen die Weiterleitungen beim Speichern.

## Verbindungen importieren

`Neu` → `Importieren` (oder die Willkommensseite) übernimmt Verbindungen aus anderen Programmen. Die Quelle wird erst nach dem Klick gelesen; eine Vorschau mit Häkchen zeigt alle Funde, bevor etwas gespeichert wird. Bestehende Verbindungen bleiben unverändert. Das Lesen läuft getrennt vom Rest der App und bricht nach 5 Sekunden ab, damit eine beschädigte Datei Shellherd nicht blockiert.

- **OpenSSH:** die Datei `~/.ssh/config`, über den Dateidialog gewählt (Vorgabe `%USERPROFILE%\.ssh\config`).
- **PuTTY:** die Sitzungen unter `HKCU\Software\SimonTatham\PuTTY\Sessions`, per `reg.exe export` nur gelesen.
- **WinSCP:** die Sitzungen unter `HKCU\Software\Martin Prikryl\WinSCP 2\Sessions`, ebenfalls nur gelesen. Sitzungen aus einer portablen `WinSCP.ini` liest Shellherd nicht. SFTP-Sitzungen werden zu Dateiverbindungen, SCP-Sitzungen zu SFTP.
- **mRemoteNG:** die Datei `confCons.xml`, über den Dateidialog gewählt (Vorgabe `%APPDATA%\mRemoteNG\confCons.xml`). Ist die Datei vollständig verschlüsselt, bricht der Import mit Hinweis ab. RDP-Verbindungen kommen als Remotedesktop-Verbindung mit Domain an, ohne Passwort.

Übernommen werden Host, Port, Benutzer, Schlüsselpfad, Weiterleitungen und bei WinSCP und mRemoteNG die Ordner. Nicht übernommen werden Passwörter, Passphrasen und Schlüsselinhalte. Schlüsseldateien werden nie geöffnet; Shellherd speichert nur den Pfad. PuTTY-Schlüssel (`.ppk`) bekommen einen Hinweis, weil Shellherd nur Format 2 mit RSA liest.

- **Duplikate:** Eine Verbindung mit gleichem Host, Port und Benutzer wie eine vorhandene SSH- oder SFTP-Verbindung ist markiert und vorab abgewählt; RDP wird mit RDP verglichen. Du kannst sie trotzdem wählen.
- **Sprunghost:** Er wird nur übernommen, wenn er genau ein Hop zu einem anderen Eintrag derselben Quelle ist und mit ausgewählt ist. Bei WinSCP und mRemoteNG entfällt er.
- **Weiterleitungen** starten nach dem Import nicht automatisch, sondern erst per Klick.
- **Zielordner:** standardmäßig ein neuer Ordner „OpenSSH-Import“, „PuTTY-Import“, „WinSCP-Import“ oder „mRemoteNG-Import“ auf oberster Ebene. Wahlweise geht es in einen vorhandenen Ordner oder auf die oberste Ebene. Ein neuer Importordner lässt sich mit einem Löschvorgang zurücknehmen.
- **Nicht übernommen:** Sitzungen anderer Protokolle wie FTP, Telnet oder VNC. Die Vorschau nennt die Anzahl.

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
probiert. Fällt einer aus, verbindet Shellherd über den nächsten neu; die Statusleiste
unter dem Kopf zeigt, über welchen Host der Cluster gerade erreichbar ist.

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

Der Cluster-Tab zeigt Nodes, Workloads, Pods und Events live. Eine Statusleiste unter dem
Kopf nennt den Zustand: „Live“ mit dem Alter der Daten („Stand vor 12 s“), beim Neuverbinden
gelb den Host und den Versuch („Verbinde über k8s-cp2 … (Versuch 2)“), danach kurz grün
„Wieder verbunden über …“. Die Tabelle bleibt dabei unverändert lesbar und wird nicht mehr
ausgegraut; Aktionen, die verändern oder eine Verbindung brauchen, sind gesperrt, bis der
Cluster wieder erreichbar ist. `Enter` führt per
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

## Dateiansicht: Tastatur und Übertragungen

Tippen in der Dateiliste springt zum nächsten Eintrag, dessen Name so beginnt. Gesucht wird in der angezeigten Reihenfolge, Ordner zuerst. Schnell weitergetippt sucht Shellherd nach dem ganzen Anfang (`no` findet `notes.md`); derselbe Buchstabe mehrmals geht zum jeweils nächsten Treffer. Nach einer Sekunde Pause beginnt die Suche neu. Groß- und Kleinschreibung spielt keine Rolle. Das gilt für die lokale und die Server-Seite. Die Leertaste, Kombinationen mit `Strg` oder `Alt` und Zeichen, die nur mit `AltGr` entstehen (etwa `@`), springen nicht.

Laufende Übertragungen zeigen nach der ersten Sekunde ihre Geschwindigkeit hinter dem Fortschritt (`12 MB/s`), geglättet über die letzten Sekunden. Solange die Frage nach einer vorhandenen Datei offen ist und bei fertigen Übertragungen steht keine Geschwindigkeit. Auto-Upload zeigt keine. Shellherd hält dabei knapp vier Megabyte an Anfragen gleichzeitig unterwegs und kopiert bei Ordnern bis zu vier Dateien parallel; die Zeile nennt die gerade laufenden Dateien.

Abgebrochene oder fehlgeschlagene Übertragungen lassen sich mit `Fortsetzen` wieder aufnehmen, auch nach `Neu verbinden`. Das gilt für Upload und Download. Jede Datei wird zuerst als `name.part` geschrieben und ersetzt das Ziel erst am Ende. Überträgst du dieselbe Datei später noch einmal, setzt Shellherd automatisch fort; ein automatisches Neuverbinden gibt es nicht.

Vor dem Fortsetzen prüft Shellherd die liegen gebliebene `.part`: Sie darf nicht größer und nicht älter als die Quelle sein, und das letzte Megabyte vor der Fortsetzungsstelle muss mit der Quelle übereinstimmen. Fortgesetzt wird knapp vier Megabyte vor dem Ende der Teildatei, weil bis dahin noch Daten unterwegs gewesen sein können; das letzte Megabyte davor wird mit der Quelle verglichen. Die Zeile zeigt dann „fortgesetzt ab 4,1 GB“. Passt die Teildatei nicht, beginnt die Übertragung von vorn, und die Zeile sagt es. Eine Teildatei bis knapp vier Megabyte wird ohne Prüfung und ohne Hinweis neu geschrieben.

`Abbrechen` behält die Teildatei. `Teildatei verwerfen` löscht sie (lokal in den Papierkorb) und ist gesperrt, solange eine Übertragung läuft. Mit Upload-Teildateien geht das nur mit Verbindung. Wer von vorn beginnen will, verwirft die Teildatei und überträgt erneut. Bei Ordnern fragt Shellherd nach schon fertigen Dateien wie gewohnt; `Nur wenn neuer` mit `Für alle` überspringt sie. Fortgesetzt wird pro Datei. Auto-Upload räumt seine Teildateien weiterhin selbst auf.

`Prüfen` an einer fertigen, fortgesetzten Übertragung berechnet die SHA-256-Prüfsumme jeder Datei lokal und mit `sha256sum` (oder `shasum` auf macOS) auf dem Server und zeigt, ob sie übereinstimmen. Das braucht eine Shell auf dem Server; reine SFTP-Konten melden, dass keine Prüfsumme möglich ist. Dateinamen mit Zeichen wie `&`, `$`, `\` oder `'` lassen sich nicht prüfen. `Prüfen` gibt es nicht beim Verschieben, höchstens für 10 000 Dateien je Übertragung und nur in der Sitzung, in der die Übertragung lief.

Grenzen: Ändert sich die Quelle während einer fortgesetzten Übertragung und wird kürzer, bleibt die Zieldatei zu lang; `Prüfen` deckt das auf. Teildateien mit dem Namen `name.part` behandelt Shellherd als seine eigenen. Ein Ordner mit diesem Namen wird nie angefasst, die Übertragung meldet stattdessen einen Fehler.

## Dateiansicht: Auto-Upload

Auto-Upload spiegelt einen lokalen Ordner in einen Server-Ordner, solange die Dateiansicht der Verbindung offen ist. Eingerichtet wird es im lokalen Bereich: Das Zahnrad ⚙ in der Kopfzeile öffnet `Neue Datei`, `Neuer Ordner` und `Auto-Upload` für den gerade angezeigten Ordner. Alternativ geht es per Rechtsklick auf einen Ordner. Der Dialog fragt den lokalen Ordner, den Server-Ordner (vorbelegt mit dem aktuellen Server-Ordner) und die Ausschlüsse ab. Mit `Auto-Upload starten` beginnt der Abgleich; darunter zeigt eine Liste je Bindung „Überwacht“, „Gleicht ab …“ oder den Fehler. Die Bindung wird im Vault gemerkt und startet beim nächsten Öffnen der Dateiansicht von selbst.

**Regeln:**

- **Nur lokal → Server.** Es wird nichts heruntergeladen, Änderungen auf dem Server holt Shellherd nie zurück.
- **Nie löschen.** Löschst oder benennst du lokal eine Datei um, bleibt die alte auf dem Server liegen (auch bei `Foo` → `foo`: der Server hat danach beide).
- **Beim Start** werden Größe und Änderungszeit verglichen: Fehlende und lokal neuere Dateien gehen einmal hoch, danach nur noch Änderungen.
- **Server neuer:** Eine Datei, die auf dem Server neuer ist oder dort von jemand anderem geändert wurde, wird übersprungen. Die Zeile nennt die Zahl („2 übersprungen, auf dem Server neuer“), eine Meldung die Namen. `Trotzdem überschreiben` ersetzt alle übersprungenen Dateien durch die lokalen.
- **Anhalten, Fortsetzen, Bearbeiten, Entfernen** stehen an der Zeile. `Entfernen` löscht nur die Bindung, keine Dateien.
- **Verbindungsabbruch:** Die Bindung pausiert mit der Verbindung. Nach `Neu verbinden` startet sie neu und holt alles Verpasste nach.

**Ausschlüsse** sind eine Liste von Mustern, eines je Zeile, wie bei `.gitignore`. Vorbelegt sind `.git`, `node_modules/`, `~$*`, `*.swp`, `*.tmp` und `.DS_Store`.

| Muster | Wirkt auf |
|---|---|
| `.git` | jede Datei oder jeden Ordner `.git` auf jeder Ebene, samt Inhalt |
| `node_modules/` | nur Ordner dieses Namens (mit `/` am Ende) |
| `*.log` | alle Dateien mit Endung `.log`, auch versteckte |
| `/build/` | nur den Ordner `build` direkt im gebundenen Ordner, nicht `src/build` |
| `secrets/**/*.pem` | `.pem`-Dateien unter `secrets` in beliebiger Tiefe, nur ab dem gebundenen Ordner |

Ohne `/` gilt ein Muster auf jeder Ebene, mit führendem oder innerem `/` nur ab dem gebundenen Ordner, mit abschließendem `/` nur für Ordner. `\` zählt wie `/`. Groß- und Kleinschreibung ist egal (`Build/` schließt auch `build` aus). Ausnahmen mit `!` gibt es nicht. Ausgeschlossene Ordner werden nicht durchlaufen.

**Gut zu wissen:**

- **Geheimnisse ausschließen:** Die Vorgaben schließen `.env`, Schlüssel und Zugangsdateien nicht aus. Schließe sie selbst aus (etwa `.env` und `*.pem`), sonst landen sie auf dem Server, neue Dateien mit den Rechten 0644.
- **Ordner umbenennen:** Solange die Dateiansicht mit aktiver Bindung offen ist, lässt Windows den übergeordneten Ordner nicht umbenennen oder verschieben. Hilfe: Bindung anhalten oder die Dateiansicht schließen.
- **Nicht lesbare Unterordner:** Kann Shellherd einen lokalen Unterordner nicht lesen, bricht der Abgleich ab und die Bindung steht auf Fehler. Schließe den Ordner mit einem Muster aus.
- **Zwei Bindungen, ein Server-Ordner:** Das ist erlaubt. Sie überschreiben einander nicht still, sondern überspringen mit Hinweis.
- **Pfade sind rechnerspezifisch:** Der lokale Pfad gilt nur auf dem Computer, der die Bindung angelegt hat. Auf einem anderen Rechner meldet die Zeile, dass der Ordner fehlt; dort kannst du sie bearbeiten oder entfernen.
- **Nur im Hauptfenster einrichten:** Einrichten, Bearbeiten, Anhalten und Entfernen gehen nur im Hauptfenster. In einem anderen Fenster laufen Bindungen weiter, und `Trotzdem überschreiben` geht überall.
- **Netzlaufwerke:** Über Freigaben werden Änderungen unzuverlässig gemeldet; Verpasstes holt erst der nächste Start nach.

## Meldungen und Verbindungszustand

Shellherd zeigt Probleme dort, wo sie entstehen.

- **Am Feld:** Eine falsche Eingabe steht rot direkt unter dem Feld, der Fokus springt dorthin.
- **Im Bereich:** Scheitert etwas in einem Bereich (Seitenleiste, Menü, Terminal), erscheint dort eine Karte mit Titel, Ursache und Knopf.
- **Unten rechts:** Ereignisse im Hintergrund erscheinen als Meldung. Fehler bleiben, bis du sie schließt. Hinweise (5 Sekunden) und Erfolgsmeldungen (3 Sekunden) verschwinden von selbst; ein schmaler Balken zeigt die Restzeit, mit der Maus darüber oder bei verstecktem Fenster pausiert er. Höchstens drei Meldungen sind sichtbar.

**Verbindungsaufbau:** Dauert das Verbinden länger als 0,4 Sekunden, zeigt der Bereich die Schritte „Server erreichen“, „Server-Schlüssel prüfen“, „Anmelden“ und „Shell öffnen“ mit der Zeit je Schritt. `Esc` oder `Abbrechen` bricht ab. Antwortet der Server langsam, steht ein Hinweis dabei.

**Fehler:** Scheitert die Verbindung, nennt die Karte die Ursache (etwa „Anmeldung abgelehnt“, „Server antwortet nicht“, „Server-Schlüssel hat sich geändert“) und den nächsten Schritt. Je nach Fall stehen `Verbindung bearbeiten`, `Erneut verbinden` oder `Fingerprint kopieren` zur Wahl; `Details` zeigt den Rohtext des Servers.

**Getrennt:** Beendet der Server die Sitzung oder bricht sie ab, bleibt die Ausgabe sichtbar. Eine Leiste am unteren Rand sagt, wie lange das her ist, und bietet `Neu verbinden` (`Enter`). Das gilt auch für RDP und die Dateiansicht. Hat Shellherd die Sitzung wegen der eingestellten Leerlaufzeit beendet (siehe Einstellungen → Verbindungen), nennt die Leiste den Grund „wegen Leerlauf getrennt“.

**Speichern:** Knöpfe zeigen „Speichert …“ und danach kurz „Gespeichert“, ohne ihre Breite zu ändern. Scheitert das Speichern der Vault-Datei, nennt die Meldung den Grund (schreibgeschützt, von einem anderen Programm gesperrt, Ordner fehlt, Laufwerk voll). Bei Container-Aktionen steht in der Status-Spalte der Zielzustand („stoppt“, „startet neu“), bis die Liste aktualisiert ist.

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
- Trennen, Leerlauf-Trennung, Fensterende, `Andere Vault-Datei` und Renderer-Ausfall beenden die SSH-Session. Die Vault-Sperre (manuell oder automatisch) beendet sie nicht; die Zugangsdaten offener Sitzungen bleiben dafür im Speicher.
  Bei aktiven Sessions wird das Schließen entsprechend der Vault-Einstellung bestätigt.

Die SSH-Tests betreiben einen lokalen `ssh2`-Server mit zur Laufzeit erzeugten
Testschlüsseln und synthetischen Zugangsdaten. Sie prüfen echte Handshakes,
Shell-I/O, Resize, Fehler, Besitzgrenzen, parallele Sessions und Backpressure.
Weitere Tests sichern die Tab-Auswahl und das Schließen einzelner Tabs sowie
serialisierte Host-Key-Bestätigungen ab.
