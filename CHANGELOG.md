# Changelog

Alle nennenswerten Änderungen an Shellherd (bis 0.9.0 unter dem Namen Terminus). Die Versionsnummer folgt [Semantic Versioning](https://semver.org/lang/de/):
MAJOR für inkompatible Änderungen (z. B. am Vault-Format), MINOR für neue Funktionen, PATCH für Fehlerbehebungen.
Jede Version braucht hier einen Abschnitt `## [x.y.z] – JJJJ-MM-TT`; der Build bricht sonst ab.

## [0.25.0] – 2026-10-25

- Sicherheit: Der KI-Assistent maskiert Geheimnisse, bevor etwas an den Anbieter geht: Passwörter, Passphrasen und API-Schlüssel aus dem Vault, private Schlüssel, `password=`- und `secret:`-Werte, Passwörter in Adressen, Bearer- und Basic-Header, Schlüssel von AWS, GitHub, Slack, OpenAI, Anthropic, Google und Azure, JWTs und die Daten von Kubernetes-Secrets. Derselbe Wert behält im Verlauf denselben Platzhalter (`[SECRET_1]`), echte Werte setzt Shellherd nie zurück in Antworten oder Befehle.
- Neu: Unter der Frage steht, wie viele vertrauliche Werte maskiert wurden. Befehle mit Platzhalter tragen einen Hinweis. Die Maskierung ist für jeden Anbieter an, auch für lokale Modelle, und lässt sich je Anbieter abschalten.
- Behoben: Der Assistent liest umbrochene Terminalzeilen als eine Zeile und kürzt lange Ausgaben nur an Zeilengrenzen.

## [0.24.0] – 2026-10-25

- Neu: Einstellungen → Verbindungen → `Server-Schlüssel verwalten` listet alle bestätigten und importierten Server-Schlüssel mit SHA-256-Fingerprint, mit Suche und `Entfernen`. Ein gewollter Schlüsselwechsel lässt sich so annehmen.
- Neu: Import aus OpenSSH `known_hosts`, auch mit gehashten Namen, `[host]:port` und mehreren Schlüsseltypen. `@revoked` wird beachtet, `@cert-authority` und Muster werden übersprungen. In Shellherd bestätigte Schlüssel ändert der Import nie.
- Sicherheit: Während der Sperre sind alle Shellherd-Fenster aus Bildschirmaufnahmen und -freigaben herausgenommen.
- Sicherheit: Shellherd öffnet Vault-Dateien nur aus dem Dateidialog, dem Explorer, `Zuletzt benutzt` oder per Ziehen von einem lokalen Laufwerk. Netzwerkpfade aus anderen Quellen werden abgelehnt.

## [0.23.0] – 2026-10-25

- Neu: Pfadfeld in der Dateiansicht mit `Strg+L`, auch über ⚙ → `Gehe zu …`; der Doppelklick geht wie bisher. Es versteht `~`, Pfade ab dem aktuellen Ordner und lokal `/` statt `\`. Fehler wie „Die Datei oder der Ordner wurde nicht gefunden.“ oder „Das ist kein Ordner.“ stehen am Feld, der bisherige Ordner bleibt.
- Neu: Filter nach Name mit `Strg+F` in der Dateiliste, je Seite. Er prüft „enthält“, ohne Groß- und Kleinschreibung, und endet beim Ordnerwechsel. Kopieren, Verschieben, Löschen und `Strg+A` wirken nur auf sichtbare Einträge.
- Neu: ⚙ → `Versteckte Dateien ausblenden/anzeigen`, je Seite, für Namen mit Punkt am Anfang. Standard bleibt: alles anzeigen. Die Fußzeile zählt die ausgeblendeten Einträge.
- Sicherheit: Die lokale Dateiansicht öffnet keine Gerätepfade (`\\?\`, `\\.\`) mehr.

## [0.22.0] – 2026-10-25

- Neu: `Vault öffnen` zeigt die bis zu acht zuletzt benutzten Vault-Dateien mit Datum und Ordner. Ein Klick wählt eine Datei aus; fehlende Dateien sind markiert und lassen sich mit `×` aus der Liste nehmen. Gespeichert werden nur Pfade und Zeitpunkte in `settings.json`, nie Inhalte.
- Neu: Helles Theme. Einstellungen → Allgemein → `Darstellung` bietet `System`, `Dunkel` und `Hell`, Standard bleibt `Dunkel`. Der Wechsel gilt sofort in allen Fenstern, auch für Fensterrahmen und Windows-Dialoge; im hellen Terminal hebt Shellherd zu blasse Farben auf lesbaren Kontrast an.
- Doku: Kapitel „Workflows“ im Handbuch (Palette, Platzhalter, Verwalten, Übernahme aus dem Assistenten).

## [0.21.0] – 2026-10-24

- Neu: Verbindungen importieren aus OpenSSH (`~/.ssh/config`, Datei wählen), PuTTY und WinSCP (Sitzungen aus der Windows-Registry, nicht aus einer portablen `WinSCP.ini`) und mRemoteNG (`confCons.xml`, Datei wählen). Zu finden unter `Neu` → `Importieren` und auf der Willkommensseite. Eine Vorschau zeigt alle gefundenen Verbindungen mit Häkchen, bevor etwas gespeichert wird. Bestehende Verbindungen bleiben unverändert. Das Lesen läuft getrennt vom Rest der App und bricht nach 5 Sekunden ab, damit eine beschädigte Datei Shellherd nicht blockiert.
- Neu: Übernommen werden Host, Port, Benutzer, Schlüsselpfad, Weiterleitungen sowie die Ordner aus WinSCP und mRemoteNG. Nicht übernommen werden Passwörter, Passphrasen und Schlüsselinhalte: Schlüsseldateien werden nie geöffnet, nur ihr Pfad wird gespeichert. Das Passwort tippst du einmal im Formular ein. WinSCP-Sitzungen mit SCP kommen als SFTP, Sitzungen anderer Protokolle (etwa FTP, Telnet oder VNC) bleiben außen vor. PuTTY-Schlüssel (`.ppk`) bekommen einen Hinweis, weil Shellherd nur Format 2 mit RSA lesen kann. RDP-Verbindungen aus mRemoteNG kommen als Remotedesktop-Verbindung mit Domain an, ohne Passwort.
- Neu: Duplikate, also Verbindungen mit gleichem Host, Port und Benutzer wie eine vorhandene SSH- oder SFTP-Verbindung (RDP wird mit RDP verglichen), sind markiert und vorab abgewählt. Ein Sprunghost wird nur übernommen, wenn er genau ein Hop zu einem anderen Eintrag derselben Quelle ist und mit ausgewählt ist; bei WinSCP und mRemoteNG entfällt er. Weiterleitungen starten nach dem Import nicht automatisch, sondern nur per Klick.
- Neu: Zielordner ist standardmäßig ein neuer Ordner „OpenSSH-Import“, „PuTTY-Import“, „WinSCP-Import“ oder „mRemoteNG-Import“ auf oberster Ebene. Wahlweise geht es in einen vorhandenen Ordner oder auf die oberste Ebene. Ein neuer Importordner lässt sich mit einem Löschvorgang zurücknehmen.
- Neu: Update-Hinweis. Höchstens einmal am Tag fragt Shellherd nach dem Entsperren bei GitHub nach der neuesten Version und zeigt sie in der Statusleiste. Dort öffnest du die Release-Notes oder überspringst diese Version. Der Hinweis ist standardmäßig an und lässt sich unter Einstellungen → Allgemein abschalten. Gesendet wird nur die Anfrage an GitHub mit deiner IP-Adresse und der Shellherd-Version, nichts aus dem Vault. Ein Auto-Update gibt es nicht; installieren musst du selbst.

## [0.20.0] – 2026-10-24

- Neu: Suche im Terminal mit `Strg+Umschalt+F`. `Enter` sucht weiter, `Umschalt+Enter` zurück, `Esc` schließt die Suche. Groß- und Kleinschreibung spielen keine Rolle. Treffer werden über die Auswahl markiert und nicht in die Zwischenablage kopiert. In den Terminals der Container- und Cluster-Docks gibt es keine Suche; dort geht `Strg+Umschalt+F` an das Terminal.
- Neu: Links im Terminal öffnen sich mit `Strg+Klick` im Browser. Erlaubt sind nur `http`- und `https`-Adressen bis 2048 Zeichen, ohne Benutzername und Passwort. Alles andere bleibt Text. Beim Überfahren zeigt das Terminal einen Hinweis.
- Neu: Tab-Kürzel im fokussierten Bereich: `Strg+Tab` und `Strg+Umschalt+Tab` wechseln den Tab, `Strg+Umschalt+T` öffnet die Verbindungsauswahl, `Strg+Umschalt+W` schließt den aktiven Tab mit der üblichen Rückfrage. `Strg+F`, `Strg+T` und `Strg+W` bleiben der Shell (ein Zeichen vor, Zeichen tauschen, Wort löschen), deshalb die Umschalt-Varianten.
- Neu: Einstellungen → Terminal (nach dem Entsperren) für Schriftart, Schriftgröße (8 bis 32 Pixel, Standard 14), Verlauf (1.000 bis 50.000 Zeilen, Standard 5.000), Cursorform und Blinken. Die Werte gelten sofort für alle offenen Terminals des Vaults; ein kleinerer Verlauf kürzt offene Terminals.
- Neu: Das Hauptfenster merkt sich beim Schließen Größe, Position und Maximierung in `settings.json`, nicht im Vault. Beim nächsten Start öffnet es dort, wenn der Platz noch sichtbar ist. Minimiert geschlossen bleibt die gespeicherte Position.
- Neu: Ein Tab, dessen Terminal nicht sichtbar ist, zeigt mit neuer Ausgabe einen Ring nach dem Namen; der Name wird hell und fett. Sobald der Tab sichtbar wird, verschwindet die Markierung.
- Neu: Eingabe an alle Bereiche, im Menü des Bereichskopfs (ab zwei Bereichen). Was du tippst, geht an alle verbundenen SSH- und lokalen Terminals der angezeigten Ansicht. Container, Pods, RDP, SFTP, Cluster und die Willkommensseite bleiben aus. Die Bereiche zeigen eine Warnlinie und den Knopf „An alle“, der die Eingabe beendet. Beim Ansichtswechsel endet sie, ebenso unter zwei Terminals.
- Hinweis: Ältere Shellherd-Versionen entfernen die Terminal-Einstellungen beim Speichern.

## [0.19.0] – 2026-10-24

- Neu: Server, die bei der Anmeldung nachfragen (Einmalcode, PIN, zweites Passwort, 2FA), öffnen einen Dialog „Anmeldung bei …“. Fragt der Server nur nach dem Passwort, setzt Shellherd das gespeicherte Passwort einmal automatisch ein. Antworten werden nie gespeichert.
- Neu: Sprunghost für SSH- und SFTP-Verbindungen (genau ein Hop). Shellherd verbindet erst mit dem Sprunghost und von dort weiter, im Terminal, in der Dateiansicht, bei Containern, Clustern und im Verbindungstest. Die Auswahl steht unter „Weitere Angaben“.
- Neu: Port-Weiterleitungen an SSH-Verbindungen: lokal (-L), entfernt (-R) und SOCKS-Proxy (-D). Lokal und SOCKS hören nur auf 127.0.0.1. Die Leiste „Weiterleitungen“ unter dem Terminal startet und stoppt sie; eine Weiterleitung läuft app-weit nur in einem Tab. Änderungen gelten ab der nächsten Verbindung.
- Ältere Shellherd-Versionen entfernen Sprunghost und Weiterleitungen beim Speichern.

## [0.18.1] – 2026-10-22

- Der Installer ist rund 14 MB kleiner. Im Paket liegen nur noch die Chromium-Sprachpakete für Deutsch und Englisch, keine Sourcemaps, TypeScript-Quellen und doppelten Oberflächen-Bibliotheken mehr.

## [0.18.0] – 2026-10-21

- Neu: Abgebrochene oder fehlgeschlagene Übertragungen lassen sich mit Fortsetzen an der Stelle wieder aufnehmen, an der sie stehen geblieben sind, auch nach Neu verbinden. Eine liegen gebliebene Teildatei wird beim erneuten Übertragen derselben Datei weiterverwendet, wenn sie zur Quelle passt.
- Abbrechen behält jetzt die Teildatei, Teildatei verwerfen löscht sie (lokal in den Papierkorb). Auto-Upload räumt seine Teildateien weiterhin selbst auf.
- Übertragungen schicken jetzt viele Anfragen gleichzeitig statt einer nach der anderen und kopieren bei Ordnern bis zu vier Dateien parallel. Über das Internet sind sie dadurch um ein Vielfaches schneller.
- Neu: Prüfen vergleicht nach einer fortgesetzten Übertragung die SHA-256-Prüfsumme jeder Datei lokal und auf dem Server.
- Neu: Rechtsklick auf einen Tab bietet Umbenennen. Der Name gilt nur für den Tab, nicht für die gespeicherte Verbindung.
- Entfernt: Ohne Startbefehle verbinden im Tab-Menü.

## [0.17.0] – 2026-10-21

- Neu: In der Dateiansicht springt ein getippter Buchstabe zum nächsten Eintrag mit diesem Anfang. Schnell weitergetippt wird daraus ein Namensanfang, derselbe Buchstabe mehrmals geht zum nächsten Treffer. Das gilt für die lokale und die Server-Seite.
- Neu: Übertragungen zeigen nach der ersten Sekunde ihre Geschwindigkeit (etwa 12 MB/s) hinter dem Fortschritt.

## [0.16.0] – 2026-10-21

- Neu: SSH-Verbindungen können nach dem Anmelden root werden (sudo -i). Bei Passwort-Anmeldung beantwortet Shellherd die sudo-Abfrage einmal mit dem gespeicherten Passwort; bei Schlüssel oder Agent fragt sudo im Terminal, falls kein NOPASSWD eingerichtet ist.
- Neu: Startbefehle je SSH-Verbindung, eine Zeile je Befehl. Sie werden nach dem Anmelden eingetippt, sichtbar und in der Shell-History.
- Neu: Rechtsklick auf einen SSH-Tab bietet Ohne Startbefehle verbinden. Das verbindet einmal ohne Root-Shell und ohne Startbefehle.
- Ältere Shellherd-Versionen entfernen diese Einstellungen beim Speichern.

## [0.15.0] – 2026-10-21

- Neu: Sperren trennt nicht mehr. Ein Sperrbildschirm deckt das Fenster ab; Sitzungen und Tabs laufen weiter und sind nach dem Entsperren wieder da. Neue Verbindungen und Neu verbinden gehen erst nach dem Entsperren. Die Zugangsdaten offener Sitzungen bleiben dabei im Speicher.
- Neu: Nebenfenster sperren mit und zeigen einen eigenen Sperrbildschirm; entsperrt wird im Hauptfenster. Die automatische Sperre schließt keine Nebenfenster mehr.
- Neu: Im Sperrbildschirm wechselt Andere Vault-Datei nach Rückfrage die Datei und trennt dabei alle Sitzungen.
- Der Sperrknopf sperrt ohne Rückfrage.
- Neu: Die Willkommensseite ist ein Tab. Sie erscheint beim Öffnen eines Vaults, ist über das +-Menü (Willkommensseite) wieder erreichbar und lässt sich nur schließen.
- Ohne Tabs zeigt die Bühne den leeren Bereich statt der Willkommensseite.
- Die lokale Eingabeaufforderung heißt jetzt cmd (lokal).

## [0.14.0] – 2026-10-21

- Neu: Der Vault sperrt sich automatisch. `Automatisch sperren nach … Minuten ohne Eingabe` unter Einstellungen → Vault zählt Maus und Tastatur in allen Shellherd-Fenstern; Terminal-Ausgabe zählt nicht. Alle Sitzungen werden getrennt, Nebenfenster geschlossen, die Startkarte nennt den Grund. Ungespeicherte Eingaben im Verbindungsformular gehen dabei verloren.
- Bestehende Vaults sperren ab jetzt nach 15 Minuten ohne Eingabe (der Wert war schon gespeichert, wirkte aber nicht). `0` schaltet die Sperre ab.
- Bei verbundener RDP-Sitzung zählt jede Eingabe am Rechner, weil das RDP-Fenster an Shellherd vorbeigeht.
- Neu: Einstellungen → Verbindungen mit Leerlauf-Trennung (Standard: nie), Keepalive-Intervall und -Fehlversuchen und Verbindungs-Timeout. Die Werte gelten für SSH und SFTP, auch für Container und Cluster über SSH, ab der nächsten Verbindung.
- Neu: Unter `Weitere Angaben` einer SSH- oder SFTP-Verbindung lassen sich die vier Werte einzeln überschreiben.
- Neu: Nach Leerlauf zeigt die Getrennt-Leiste „wegen Leerlauf getrennt“. Lokale Shells, RDP und Cluster-Ansichten haben keinen Leerlauf; eine Dateiansicht mit Transfer, Auto-Upload oder offener Bearbeitung trennt sich nicht.
- Hinweis: Der Verbindungs-Timeout läuft auch während der Server-Schlüssel-Rückfrage; bei kurzem Wert neue Schlüssel über `Verbindung testen` annehmen. Ein älteres Shellherd entfernt die neuen Werte beim Speichern des Vaults.

## [0.13.0] – 2026-10-20

- Neu: Auto-Upload in der Dateiansicht. Ein lokaler Ordner wird in einen Server-Ordner gespiegelt, solange die Dateiansicht offen ist; eingerichtet über das Zahnrad ⚙ im lokalen Bereich (`Auto-Upload`). Die Bindung wird im Vault gemerkt und startet von selbst.
- Auto-Upload lädt nur lokal → Server hoch und löscht auf dem Server nie. Ist eine Datei dort neuer, wird sie übersprungen; `Trotzdem überschreiben` ersetzt sie.
- Ausschlüsse sind Muster wie bei `.gitignore` (z. B. `node_modules/`, `*.log`, `/build/`), beim Einrichten festlegbar und später änderbar. Die Vorgaben schließen `.env` und Schlüssel nicht aus.
- Nach einem Verbindungsabbruch holt `Neu verbinden` verpasste Änderungen nach; Einrichten und Bearbeiten gehen nur im Hauptfenster.

## [0.12.1] – 2026-10-20

- Behoben: Downloads aus der Dateiansicht landen nur im gewählten Zielordner; Namen, die Windows nicht speichern kann (`\`, `:`, Gerätenamen, Punkt oder Leerzeichen am Ende), werden übersprungen oder mit Hinweis abgelehnt.
- Behoben: Beim Überschreiben bleibt die alte Datei erhalten, bis die neue vollständig angekommen ist.
- Behoben: Hochgeladene Dateien behalten beim Überschreiben ihre Rechte; neue Dateien bekommen 0644 statt 0666.
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
