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

### Zuletzt benutzte Vaults

`Vault öffnen` zeigt unter `Zuletzt benutzt` bis zu acht Vault-Dateien, die du zuletzt geöffnet, angelegt oder gespeichert hast, die neueste oben, mit Datum und Ordner. Ein Klick wählt die Datei aus, danach fehlt nur das Passwort. Beim Start ist die neueste vorhandene Datei vorausgewählt. Ist eine Datei nicht mehr da (verschoben, gelöscht oder Netzlaufwerk getrennt), steht `Datei nicht gefunden` darunter, und der Eintrag lässt sich nicht wählen; er bleibt, bis du ihn entfernst. Das `×` neben einem Eintrag nimmt ihn nur aus der Liste, die Datei bleibt unberührt. Die Liste enthält nur Pfade und Zeitpunkte, nie Passwörter oder Inhalte, und liegt in `settings.json` im Benutzerdatenordner. Die Pfade zeigen den Ordner und damit oft deinen Windows-Benutzernamen; denk daran, bevor du einen Screenshot des Startbildschirms teilst.

Shellherd öffnet eine Vault-Datei nur, wenn sie über `Vault-Datei auswählen`, per Doppelklick im Explorer, aus `Zuletzt benutzt` oder per Ziehen von einem lokalen Laufwerk kommt. Eine Vault-Datei auf einer Netzwerkfreigabe (`\\server\…`) öffnest du einmal über `Vault-Datei auswählen`; danach steht sie in `Zuletzt benutzt`. Ziehen von einer Netzwerkfreigabe lehnt Shellherd ab. So kann eingeschleuster Code Shellherd keine Netzwerkanmeldung an einem fremden Server auslösen lassen.

### Sperren und Willkommens-Tab

Der Sperrknopf in der Kopfzeile sperrt ohne Rückfrage. Ein undurchsichtiger Sperrbildschirm deckt das Fenster ab; die Tastatur erreicht nichts dahinter. Nebenfenster werden mitgesperrt und zeigen ihren eigenen Sperrbildschirm (ohne Passwortfeld); entsperrt wird im Hauptfenster.

- **Zugangsdaten im Speicher:** Die Zugangsdaten offener Sitzungen bleiben während der Sperre im Speicher von Shellherd. Ein geänderter, ungespeicherter Verbindungseditor behält seinen Inhalt, auch das gespeicherte Passwort der Verbindung; ein unveränderter Editor schließt beim Sperren. Gegen das Auslesen des Arbeitsspeichers schützt die Sperre nicht.
- **Bildschirmaufnahmen:** Während der Sperre nimmt Shellherd alle seine Fenster aus Bildschirmaufnahmen und -freigaben heraus (Teams, Zoom, Snipping Tool); dort erscheint stattdessen der Hintergrund. Nach dem Entsperren ist das wieder aufgehoben. Fotos des Bildschirms und die Vorschau eines minimierten Fensters in der Taskleiste deckt das nicht sicher ab.
- **Windows Hello:** Ist es für den Vault eingeschaltet, steht über dem Passwortfeld `Mit Windows Hello entsperren`, auch nach der automatischen Sperre. Siehe „Windows Hello“.
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

### Windows Hello

Einstellungen → Vault → `Mit Windows Hello entsperren (PIN, Gesicht oder Fingerabdruck)` schaltet für den offenen Vault das Entsperren per Windows Hello ein. Windows fragt dabei einmal nach PIN, Gesicht oder Fingerabdruck, beim allerersten Mal zweimal, weil Shellherd dann seinen Windows-Hello-Schlüssel anlegt. Danach zeigt der Sperrbildschirm `Mit Windows Hello entsperren` und `Vault öffnen` für diese Datei `Mit Windows Hello öffnen`, auch nach einem Neustart. Shellherd fragt nie von selbst, erst nach einem Klick oder `Enter` auf dem Knopf. Das Passwort funktioniert immer weiter; brichst du die Windows-Abfrage ab, bleibt einfach das Passwortfeld.

- **Was gespeichert wird:** nicht das Passwort, sondern der daraus abgeleitete Schlüssel dieses Vaults, verschlüsselt mit einem Schlüssel, den nur eine Windows-Hello-Signatur erzeugt. Er liegt in `hello-unlock.json` im Benutzerdatenordner, für höchstens acht Vaults. Den privaten Windows-Hello-Schlüssel hält Windows, mit TPM im Sicherheitschip; Shellherd sieht ihn nie.
- **Gilt nur hier:** für diese Vault-Datei, auf diesem Gerät, in diesem Windows-Konto. Auf einem anderen Rechner oder mit einer Kopie des Benutzerdatenordners geht es nicht.
- **Wann es endet:** Ausschalten in den Einstellungen und `×` unter `Zuletzt benutzt` löschen den gespeicherten Schlüssel. Wird die Vault-Datei ersetzt oder neu angelegt oder richtest du Windows Hello neu ein (etwa nach dem Zurücksetzen der PIN), meldet Shellherd „Windows Hello passt nicht mehr zu diesem Vault …“ und löscht den Eintrag. Du entsperrst dann mit dem Passwort und kannst Windows Hello wieder einschalten. Der leere Windows-Hello-Schlüssel von Shellherd bleibt in Windows, bis du die PIN zurücksetzt; ohne Eintrag öffnet er nichts.
- **Wogegen es schützt:** gegen Menschen an deinem Gerät, die das Vault-Passwort nicht kennen, und gegen das Auslesen des gespeicherten Schlüssels ohne deine Bestätigung, mit TPM auch von einer Kopie der Festplatte.
- **Wogegen nicht:** Schadsoftware unter deinem Windows-Konto kann eine Windows-Hello-Abfrage auslösen; bestätige nur Abfragen, die du selbst angestoßen hast. Gegen Schadsoftware, die den Arbeitsspeicher eines entsperrten Shellherd liest oder dein Passwort mitschneidet, hilft Windows Hello nicht. Ohne TPM (etwa in manchen virtuellen Maschinen) schützt Windows den Schlüssel nur per Software.
- **Grenzen:** Nebenfenster entsperren weiter nur über das Hauptfenster. In einer Remotedesktop-Sitzung steht Windows Hello meist nicht zur Verfügung. Die Windows-Abfrage ist ein Fenster von Windows und gehört nicht zum Fensterschutz der Sperre; sie zeigt nichts aus dem Vault.

### Tastenkürzel

| Kürzel | Wirkung |
|---|---|
| `Strg+,` | Einstellungen öffnen |
| `Strg+Umschalt+K` | KI-Assistenten ein- oder ausblenden |
| `Strg+Umschalt+F` | Suche im Terminal |
| `Strg+Klick` | Link im Terminal öffnen (nur http und https) |
| `Strg+Tab` | Nächsten Tab im fokussierten Bereich wählen |
| `Strg+Umschalt+Tab` | Vorherigen Tab im fokussierten Bereich wählen |
| `Strg+Umschalt+T` | Verbindungsauswahl des fokussierten Bereichs öffnen |
| `Strg+Umschalt+W` | Aktiven Tab des fokussierten Bereichs schließen (mit Rückfrage) |

`Strg+F`, `Strg+T` und `Strg+W` bleiben der Shell (ein Zeichen vor, Zeichen tauschen, Wort löschen), deshalb die Umschalt-Varianten. Die Tab-Kürzel wirken nicht, solange ein Dialog offen ist oder du in einem Textfeld tippst; im Terminal selbst funktionieren sie. `Strg+Umschalt+T` und `Strg+Umschalt+W` wiederholen sich nicht, wenn du die Taste gedrückt hältst.

### Eingabe an alle

Im Menü des Bereichskopfs schaltet `Eingabe an alle Bereiche senden` ein; der Eintrag erscheint ab zwei Bereichen. Was du tippst, geht dann an alle verbundenen SSH- und lokalen Terminals der angezeigten Ansicht. Container, Pods, RDP, SFTP, Cluster und die Willkommensseite bleiben aus. Der Assistent schreibt weiter nur in einen Tab. Die Bereiche der Mitglieder zeigen eine Warnlinie und den Knopf `An alle`; ein Klick darauf beendet die Eingabe. Sie endet auch beim Ansichtswechsel und wenn weniger als zwei Terminals übrig sind.

## Einstellungen

Das Zahnrad rechts in der Kopfzeile öffnet die Einstellungen, ebenso `Strg+,`. Vor dem Entsperren führt der Link `Einstellungen` unten auf der Startkarte dorthin. Alle Werte gelten sofort, ein „Speichern“ gibt es nicht. Nebenfenster haben keine eigenen Einstellungen; Sprache, Darstellung und Vault-Einstellung gelten dort trotzdem. Hat eine RDP-Sitzung den Fokus, gehen Tastenkürzel an den entfernten Rechner, auch `Strg+,`.

### Sprache

Shellherd gibt es auf Deutsch und Englisch. Standard ist die Systemsprache: Bei deutscher Windows-Anzeigesprache startet Shellherd auf Deutsch, sonst auf Englisch.

Die Einstellung `Sprache` unter Einstellungen → Allgemein bietet `System`, `Deutsch` und `English`. Der Wechsel gilt sofort in allen Fenstern, ohne Neustart; offene Sitzungen laufen weiter. Die Wahl liegt in `settings.json` im Benutzerdatenordner (`%APPDATA%\Shellherd`).

Fehlermeldungen, Dialoge und Fenstertitel folgen der Sprache, ebenso Datum, Zahlen, Dateigrößen, Sortierung und Suche. Der KI-Assistent antwortet in der gewählten Sprache. Ausgaben im Stil von `kubectl` (etwa `Beschreiben` in der Cluster-Ansicht) und Rohstatus von Servern bleiben englisch. Der Installer folgt der Windows-Sprache.

### Darstellung

`Darstellung` unter Einstellungen → Allgemein bietet `System`, `Dunkel` und `Hell`; Standard ist `Dunkel`. `System` folgt dem Windows-Farbmodus für Apps und wechselt mit, wenn du ihn umstellst. Der Wechsel gilt sofort in allen Fenstern, ohne Neustart; offene Sitzungen laufen weiter. Fensterrahmen und Windows-Dialoge folgen ebenfalls. Im hellen Modus sind auch Terminal, Manifeste und Code hell; zu blasse Terminalfarben hebt Shellherd dort auf mindestens 4,5:1 Kontrast an. Das Bild einer Remotedesktop-Sitzung bleibt unverändert. Die Wahl liegt wie die Sprache in `settings.json` im Benutzerdatenordner, nicht im Vault, damit sie schon vor dem Entsperren gilt.

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

`Mit Windows Hello entsperren (PIN, Gesicht oder Fingerabdruck)` gilt nur für diesen Vault auf diesem Gerät und wird nicht im Vault gespeichert. Ist Windows Hello nicht eingerichtet, steht hier stattdessen ein Hinweis. Siehe „Windows Hello“.

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

### Maskierung im KI-Assistenten

Bevor der Assistent etwas an einen Anbieter schickt, ersetzt Shellherd Geheimnisse durch Platzhalter wie `[SECRET_1]`. Das gilt für deine Frage, den Terminalausschnitt, gelesene Ausgaben und den mitgeschickten Verlauf. Derselbe Wert bekommt in einem Verlauf immer denselben Platzhalter, so kann sich das Modell darauf beziehen. Ein einmal erkannter Wert bleibt im ganzen Verlauf verdeckt, auch an Stellen ohne erkennbares Muster; Shellherd merkt sich dafür je Verlauf die letzten 1.000 erkannten Werte, Vault-Werte immer. `Verlauf leeren` beginnt neu.

Erkannt werden:
- Passwörter, Passphrasen und API-Schlüssel, die in diesem Vault gespeichert sind (ab 6 Zeichen), wo immer sie im Text stehen,
- private Schlüssel (`-----BEGIN … PRIVATE KEY-----`), auch angeschnitten und base64-kodiert,
- Werte hinter Namen wie `password`, `DB_PASSWORD`, `secret`, `token`, `api_key`, `client_secret` oder `AccountKey`, mit `=` oder `:` und als Option (`--password …`),
- Passwörter in Adressen (`postgres://app:…@db`),
- `Authorization: Bearer …` und `Basic …`,
- Schlüssel von AWS (`AKIA…`), GitHub (`ghp_…`, `github_pat_…`), Slack (`xox…`, Webhooks), OpenAI und Anthropic (`sk-…`) und Google (`AIza…`), GitLab (`glpat-…`), Stripe (`sk_live_…`, `rk_live_…`), npm (`npm_…`), Azure-Signaturen (`sig=`) und JWTs,
- Passwörter in `.netrc` (`password …`, auch über mehrere Zeilen) und die Zeichenkette von `ConvertTo-SecureString`,
- Werte unter `data:` und `stringData:`, wenn der Text ein Kubernetes-Secret (`kind: Secret`) enthält.

Unter deiner Frage steht dann „Vertrauliche Werte maskiert: 2“. Die Antwort zeigt die Platzhalter unverändert. Shellherd setzt nie echte Werte in Antworten oder Befehle ein, sonst könnte eingeschleuster Terminaltext das Modell dazu bringen, dein Passwort in einen Befehl zu schreiben. Steht in einem vorgeschlagenen Befehl ein Platzhalter, steht darunter „Enthält maskierte Werte. Setze sie vor Enter selbst ein.“

Die Maskierung ist für jeden Anbieter an, auch für lokale Modelle, denn ein lokaler Endpunkt kann Anfragen protokollieren oder weiterleiten. Abschalten lässt sie sich je Anbieter unter `Anbieter verwalten` → `Bearbeiten` → `Geheimnisse vor dem Senden maskieren`. Der Assistent zeigt dann „Maskierung ist für diesen Anbieter aus“. Für `Mit KI analysieren` im Cluster-Tab bleibt sie immer an. Lässt sich ein Text nicht prüfen, sendet Shellherd nichts.

**Grenzen.** Die Maskierung erkennt Muster und bekannte Werte, sie versteht keinen Inhalt. Nicht erkannt werden zum Beispiel:
- Passwörter ohne erkennbaren Namen, etwa direkt hinter einer Kurzoption (`mysql -pGeheim`, `sshpass -p Geheim`, `curl -u admin:Geheim`) oder im Fließtext, solange sie nicht im Vault stehen,
- Vault-Passwörter unter 6 Zeichen, das Vault-Passwort selbst und Eingaben aus Anmelde-Rückfragen,
- abgewandelte Werte: base64 oder Hex kodiert, in Teilen oder mit Leerzeichen, `;` oder `&` ohne Anführungszeichen (dann nur bis zu diesem Zeichen),
- Passwörter in Adressen, die `/`, `?` oder `#` unkodiert enthalten, und Werte über 4.096 Zeichen (dann nur der Anfang),
- Schlüssel ohne festes Format, etwa reine Hex-Schlüssel von Azure, außer sie stehen hinter einem Namen wie `api-key`,
- Kubernetes-Secrets als JSON (`-o json`),
- Cookies (`Cookie: …`, `Set-Cookie: …`) und PuTTY-Schlüssel im Format `.ppk`,
- mehr als 256 Verläufe in einer Sitzung: Shellherd vergisst dann die Platzhalter des ältesten. Dort früher erkannte Werte werden in späteren Fragen nur noch durch die Regeln und die Vault-Werte maskiert,
- eine einzelne Zeile, die länger ist als der mitgeschickte Ausschnitt (6 000 bzw. 8 000 Zeichen); sie wird angeschnitten.

Hashes, Commit-IDs und UUIDs bleiben absichtlich stehen. KI-Kommandozeilen in eigenen Tabs (Claude Code, Codex …) senden selbst und laufen nicht über diese Maskierung. Stehen sensible Ausgaben auf dem Bildschirm, leere ihn (`clear`), bevor du den Assistenten fragst.


## Terminal-Toolbar

Unter jedem normalen SSH-Terminal liegt eine anpassbare Toolbar. `＋` legt ein Element an. Rechtsklick bietet Bearbeiten, Duplizieren, Deaktivieren, Verschieben und Löschen; die Reihenfolge lässt sich außerdem per Ziehen ändern. Konfigurationen liegen verschlüsselt im Vault. Ein Element gilt für alle SSH-Verbindungen oder nur für die aktuelle Verbindung. Nebenfenster zeigen dieselbe Konfiguration; bearbeitet wird sie im Hauptfenster.

### Befehlsbuttons

Name, Symbol, Farbe, kurzer Text und Beschreibung sind frei wählbar. Der Enter-Schalter rechts in der Leiste schaltet das sofortige Ausführen ein oder aus; sein Tooltip nennt den aktuellen Modus. Die Einstellung gilt für alle Befehlsbuttons im Vault: **Eintippen** sendet den Befehl ohne Enter; **Ausführen** hängt Enter an. Optional verlangt ein Button zuvor eine Bestätigung mit Verbindungsname und vollständigem Befehl. Eingaben betreffen ausschließlich den jeweiligen Terminal-Tab, auch wenn „Eingabe an alle“ aktiv ist. In erkannten Vollbildprogrammen werden sie abgelehnt. Shellherd kann nicht zuverlässig erkennen, ob die Shell gerade eine andere Eingabe erwartet; die Toolbar ist für normale Shell-Eingaben gedacht.

Beispiel: `clear && cd /`. Ein Skript auf dem Server wird über seinen Pfad aufgerufen, etwa `/opt/scripts/check-container-updates.sh`; sein normaler Output bleibt dabei im Terminal.

### Dynamische Anzeigen

Dynamische Anzeigen führen ihren Hintergrundbefehl über einen separaten Ausführungskanal derselben SSH-Verbindung aus. Weder Befehl noch Ausgabe erscheinen im Terminal. Sie verwenden den ursprünglichen SSH-Benutzer und übernehmen weder ein interaktives `cd` noch `sudo -i` aus dem Terminal. Prüfbefehle müssen ohne interaktive Rückfragen auskommen.

Du bestimmst frei, welche Rückgabewerte welches Symbol, welche Farbe und welchen Text anzeigen. Die Werte können beispielsweise eine Auswahl, eine Information oder ein Ergebnis beschreiben. Die Symbole wählst du direkt aus einer sichtbaren Icon-Auswahl – auch für jede Zuordnung und unbekannte Werte.

Der minimale Vertrag lautet:

```json
{"value":"banana","message":"Optionaler Text für den Tooltip"}
```

- stdout enthält genau ein JSON-Objekt. `value` ist eine Zeichenfolge; etwa `"1"`, nicht `1`. `message` ist optional. Zusätzliche Felder sind erlaubt und werden ignoriert.
- Exitcode 0 bedeutet, dass die Prüfung ausgeführt wurde. Auch ein gestoppter Dienst kann mit Exitcode 0 und `"value":"stopped"` gemeldet werden.
- Eigene exakte, groß-/kleinschreibungssensitive Zuordnungen bestimmen Symbol, Farbe und Text. Unbekannte Werte haben eine eigene einstellbare Darstellung.
- Aktualisierung per Klick, Intervall oder beidem. Intervalle sind von 100 ms bis zu einem Tag einstellbar, Zeitlimits von 100 ms bis zu fünf Minuten. Intervallprüfungen starten nach dem Verbinden beziehungsweise Aktivieren einmal sofort. Jeder Terminal-Tab besitzt eigene Prüfungen.
- Bereits laufende Prüfungen werden übersprungen. Pro SSH-Sitzung laufen höchstens vier Prüfbefehle gleichzeitig; weitere fällige Anzeigen warten auf einen freien Kanal. Ausgaben sind zusammen auf 32 KiB begrenzt. Es gibt maximal 64 Toolbar-Elemente und 100 Zuordnungen je Element.
- Technische Fehler, ungültiges JSON, Zeitüberschreitungen und getrennte Verbindungen erscheinen grau; sie übernehmen keine grüne Wert-Zuordnung. Tooltip: Fehlermeldung, Prüfzeitpunkt und letzter erfolgreicher Lauf. stderr wird bei fehlgeschlagenen Prüfungen begrenzt angezeigt.
- Beim Sperren des Vaults, Schließen oder Trennen einer Sitzung enden die Prüfungen. Laufende Kanäle erhalten TERM und werden geschlossen. Die Behandlung selbst gestarteter Hintergrundprozesse bleibt Aufgabe des entfernten Skripts.

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
- Pods und Services im Cluster leitest du im Cluster-Tab weiter, siehe „Kubernetes → Port weiterleiten“.
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
nutzt es `sudo -n` (dafür braucht der Benutzer NOPASSWD). Über SSH lehnt Shellherd
Kubeconfigs mit `exec`- oder `auth-provider`-Abschnitten ab, weil deren Plugins auf diesem Rechner
statt auf dem Server laufen würden.

### Direkter Zugang

Ein Cluster-Eintrag braucht keine SSH-Verbindung. Neue Cluster-Einträge starten unter „Zugang“ auf „Direkt“;
Einträge über SSH stellst du dort auf „Direkt“ um. Dann spricht Shellherd den API-Server von diesem Rechner
aus an. Die kubeconfig kommt aus einer von zwei Quellen:

- „Eingefügt (im Vault gespeichert)“: Du fügst den Text ein. Er liegt verschlüsselt im
  Vault und wandert mit ihm. Ein gespeicherter Text zeigt „Kubeconfig gespeichert · … Zeichen“;
  mit „Ersetzen“ tauschst du ihn aus.
- „Datei auf diesem Rechner“: Du gibst einen absoluten Pfad oder `~/…` an oder wählst
  die Datei mit „Datei wählen …“. Die Datei wird bei jedem Verbinden neu gelesen. Nach
  einer Änderung schließt du den Cluster-Tab und öffnest ihn wieder. UNC-Pfade werden
  nicht unterstützt.

Aus der kubeconfig wählst du den Context aus der Liste. Shellherd verbindet beim direkten
Zugang nicht automatisch neu; bei einem Abbruch öffnest du den Tab erneut.

Enthält der gewählte Context ein Login-Programm (`exec`), läuft es auf diesem Rechner mit
deinen Rechten, ohne Terminal (kein TTY) und mit höchstens 60 s Laufzeit. Bei einer
eingefügten kubeconfig startet es nur, wenn du unter Context „Login-Programm beim
Verbinden ausführen: …“ bestätigst; ändert sich Text oder Context, verfällt die
Bestätigung. Die Bestätigung erscheint, nachdem du „Contexts lesen“ geklickt hast. Bei einer Datei auf diesem Rechner ist keine Bestätigung nötig. Relative
Programmpfade gelten relativ zum Ordner der Datei (bei eingefügtem Text sind sie nicht
erlaubt). Unter Windows startet Shellherd keine `.cmd`- oder `.bat`-Dateien; nutze eine
`.exe` (Programmname oder voller Pfad).

Nicht unterstützt sind `token-file`, `auth-provider`, `proxy-url` und
`insecure-skip-tls-verify`; `token-file` gilt jetzt auch für Cluster über SSH. Verweist die
kubeconfig auf Zertifikatsdateien, nutze eingebettete Zertifikate (`…-data`) oder
„Datei auf diesem Rechner“.

Ältere Shellherd-Versionen öffnen einen Vault mit direktem Cluster-Eintrag nicht.

### Einrichtung und Bedienung

Im Einrichtungsformular ist „Produktion“ vorausgewählt; abwählen ist eine bewusste
Entscheidung. „Nur lesen“ sperrt Restart, Scale, Löschen und die Shell; Logs, `Logs aller Pods`, YAML,
Events, Describe, `Port weiterleiten…` und `Mit KI analysieren` bleiben erlaubt. Jede verändernde Aktion fragt nach. Bei
Produktion muss man den Ressourcennamen eintippen, bevor der Knopf aktiv wird. Unter „Weboberflächen (optional)“ lassen sich die Adressen von Argo CD und Harbor hinterlegen (siehe „Argo CD und Harbor“).

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

### Port weiterleiten

Rechtsklick auf einen laufenden Pod oder einen Service → `Port weiterleiten…`. Im Dialog wählst du den Port im Pod (die im Manifest genannten Ports oder `Anderer Port …`) bzw. den Port des Service, dazu den lokalen Port. Vorgeschlagen ist derselbe Port; lässt du das Feld leer, wählt Shellherd einen freien. `Weiterleiten` startet die Weiterleitung. Die Leiste „Weiterleitungen“ unten im Cluster-Tab zeigt `127.0.0.1:<Port> → <Ziel>`, die offenen Verbindungen und den letzten Fehler, mit `Im Browser öffnen`, `Adresse kopieren` und `Stoppen`.

- **Nur 127.0.0.1:** Der Port ist nur von diesem Computer aus erreichbar, nie aus dem Netz. Ein Feld dafür gibt es nicht.
- **Service:** Shellherd liest den Selector und verbindet zum ersten bereiten Pod (nach Name), auf dessen `targetPort`, auch wenn der Port einen Namen hat. Verschwindet der Pod, etwa bei einem Rollout, sucht die nächste Verbindung von selbst einen neuen; laufende Verbindungen zum alten Pod enden. Anders als bei `kubectl port-forward svc/…` muss man nichts neu starten. Die Leiste nennt den Pod („über api-…:8080“). Alle Verbindungen gehen an diesen einen Pod, es gibt keine Lastverteilung.
- **Pod:** Die Weiterleitung bleibt an diesem Pod-Namen. Nach einem Neustart des Containers geht es weiter, ebenso bei StatefulSet-Pods, die mit gleichem Namen zurückkommen. Wird der Pod ersetzt, meldet die Leiste „Den Pod … gibt es nicht (mehr).“ Für Deployments deshalb besser den Service nehmen.
- **Lebensdauer:** Eine Weiterleitung gehört zu ihrem Cluster-Tab. Tab schließen, Fenster schließen, einen anderen Vault öffnen oder Shellherd beenden stoppt sie. Verbindet sich der Cluster neu, bleibt der lokale Port offen: Neue Verbindungen warten bis zu 30 Sekunden auf den Cluster, bestehende brechen ab. Gesperrt laufen Weiterleitungen weiter, starten lassen sie sich erst nach dem Entsperren. Gespeichert wird nichts, auch nicht im Workspace.
- **„Nur lesen“ und Produktion:** Eine Port-Weiterleitung ändert nichts im Cluster und ist deshalb auch bei „Nur lesen“ erlaubt. Bei Produktion nennt der Dialog, was danach erreichbar ist; eine Namenseingabe gibt es nicht. Über die Weiterleitung können Programme aber Daten lesen und schreiben, etwa in einer Datenbank, mit deren eigener Anmeldung.
- **Rechte:** Kubernetes verlangt `create` auf `pods/portforward` im Namespace (ältere Versionen `get`). Die Rolle `edit` hat das, `view` nicht. Für Services braucht es zusätzlich `get` auf den Service und `list` auf Pods. Fehlt das Recht, meldet die Leiste „Keine Berechtigung für Port-Weiterleitungen in …“.
- **Grenzen:** Höchstens 10 Weiterleitungen gleichzeitig, je Weiterleitung höchstens 32 gleichzeitige Verbindungen, nur TCP. `Im Browser öffnen` nimmt `http`, bei Port 443 und 8443 `https`. Programme, die nach dem Senden ihre Seite der Verbindung schließen (z. B. `nc -N`, `socat`), bekommen keine Antwort.
- **Wer den Port erreicht:** Jedes Programm und jeder Benutzer auf diesem Computer, auch Webseiten im Browser über Tricks wie DNS-Rebinding. Eine Anmeldung am Port gibt es nicht, genau wie bei `kubectl port-forward`. Lass Weiterleitungen deshalb nur so lange offen, wie du sie brauchst, und leite auf geteilten Rechnern (Terminalserver) nicht zu sensiblen Diensten weiter.

### Logs aller Pods

Rechtsklick auf ein Deployment, StatefulSet, DaemonSet, einen Job oder einen Service → `Logs aller Pods`. Der Reiter **Logs** im unteren Bereich zeigt dann die Logs aller zugehörigen Container zusammen. Ist die Zeile nur ausgewählt, startet `Logs aller Pods anzeigen` die Ansicht; durchs Blättern allein öffnet Shellherd keine Streams.

- **Sortierung:** nach dem Zeitstempel, den Kubernetes an jede Zeile hängt, in UTC (`HH:MM:SS.mmm`), auch wenn ein Node in Ortszeit läuft. Davor steht `pod/container` in einer von vier Farben. Laufen die Uhren der Nodes auseinander, kann die Reihenfolge zwischen Pods um diesen Versatz abweichen.
- **Filtern und Quellen:** Das Feld `Filtern` zeigt nur Zeilen, die den Text enthalten, im Präfix oder in der Meldung; Treffer sind markiert. Ein Klick auf einen Container-Chip blendet ihn aus und wieder ein.
- **Folgen:** Neue Zeilen erscheinen unten. Scrollst du nach oben, bleibt die Ansicht stehen, und `Folgen (12 neu)` zeigt, was dazugekommen ist; ein Klick springt ans Ende.
- **Rollouts:** Neue Pods kommen von selbst dazu, sobald ihr Container läuft. Beendete Pods bleiben mit „beendet“ stehen. Startet ein Container neu, liest Shellherd ab der letzten Zeile weiter. Beendet ein Proxy oder Load Balancer einen ruhigen Stream, liest Shellherd nach 5 Sekunden weiter. Bricht ein Stream mit Fehler ab, zeigt der Chip „Fehler“ mit dem Grund im Tooltip; `Kompakt`/`Roh` umschalten startet die Ansicht neu.
- **Kompakt / Roh** gilt wie bei einzelnen Logs; Farben aus der App werden entfernt. `Kopieren` nimmt alle Treffer mit, auch die nicht angezeigten.
- **Grenzen:** höchstens 20 Container gleichzeitig (weitere warten und rücken nach), je Container die letzten 200 Zeilen, insgesamt 10 000 Zeilen, angezeigt die neuesten 2 000 Treffer. Zeilen über 4 000 Zeichen werden gekürzt. Kommen mehr als 8 000 Zeilen pro Sekunde, lässt Shellherd welche aus und sagt es. Nur `matchLabels` des Selectors zählen, wie bei „Pods anzeigen“; Init-Container sind nicht dabei. Nach 100 Containern in einer Ansicht kommen keine neuen mehr dazu; `Kompakt`/`Roh` umschalten startet die Ansicht neu.
- **Rechte:** `list` und `watch` auf Pods und `get` auf `pods/log`. „Nur lesen“ erlaubt die Ansicht. Wechselst du die Zeile, den Reiter oder die Darstellung, endet sie; nach einem Neuverbinden beginnt sie neu.

### Rechte-Vorabprüfung

Shellherd fragt je Namespace einmal ab, was das Kubernetes-Konto darf (`SelfSubjectRulesReview`, eine reine Abfrage ohne Wirkung auf den Cluster). Einträge im Kontextmenü, die das Konto nicht ausführen darf, sind dann vorab gesperrt und nennen das fehlende Recht, etwa „Keine Berechtigung: patch auf deployments in shop“. Das gilt für Neustart, Skalieren, Löschen, cordon/uncordon, Anhalten, Fortsetzen und `Jetzt ausführen…`, für Logs, Shell, `Logs aller Pods` und `Port weiterleiten…`. Die Tasten `r`, `S`, `Strg+D`, `s`, `l` und `p` melden denselben Grund.

- Shellherd fragt höchstens einmal pro Minute und Namespace nach, solange der Cluster-Tab sichtbar ist, und sofort nach einem Neuverbinden. Ein gerade neu vergebenes Recht kann also bis zu einer Minute gesperrt erscheinen.
- Kann der Cluster die Frage nicht vollständig beantworten (etwa mit einem externen Autorisierer wie bei GKE oder Azure-RBAC), ist sie verboten, meldet sie einen Auswertungsfehler (etwa eine Bindung an eine gelöschte Rolle) oder dauert sie länger als 10 Sekunden, sperrt Shellherd nichts; ein fehlendes Recht zeigt sich dann wie bisher erst beim Ausführen.
- Regeln, die nur für bestimmte Objektnamen gelten, zählen als Erlaubnis. Gesperrt wird nur, was sicher nicht geht.
- Nodes prüft Shellherd mit den Regeln des Standard-Namespace des Clusters.

### Mit KI analysieren

Rechtsklick auf einen Pod, ein Deployment, StatefulSet, DaemonSet, einen Job oder ein Event → `Mit KI analysieren`. Bei Pod-Problemen in der roten Leiste reicht `Analysieren` daneben. Der KI-Assistent öffnet sich mit einer passenden Frage, etwa „Warum startet dieser Pod immer wieder neu?“, die du ändern kannst, und einer Vorschau dessen, was Shellherd mitschicken will. Gesendet wird erst mit `Analyse senden`. `Verwerfen` bricht ab, ohne dass etwas hinausgeht.

- **Was mitgeht:** Status, Conditions und Spezifikation des Objekts (Images, Befehl, Ressourcen, Probes, Env, Volumes), die letzten 15 Events und die letzten 100 Logzeilen der auffälligen Container. Nach einem Neustart kommen die Logzeilen des vorherigen Containers dazu, außerdem Owner-Workload und Node. Bei einem Workload kommen seine Pods dazu, mit Events und Logs des auffälligsten Pods. Bei einem Event gehen das Event selbst und das betroffene Objekt mit. `Gesendeten Text anzeigen` zeigt alles wörtlich, die Vorschau nennt die Größe.
- **Was nie mitgeht:**
  - Secrets: Shellherd liest keine Secrets und keine ConfigMaps.
  - Env-Werte aus `secretKeyRef`: Sie stehen nur als Verweis da (`<Secret checkout-db/password>`).
  - Werte von Variablen mit Namen wie `PASSWORD`, `TOKEN` oder `KEY`: Sie erscheinen als `<hidden>`.
  - Annotations.

  Was danach noch nach Geheimnis aussieht, etwa ein Passwort in einer Logzeile, ersetzt die Maskierung durch Platzhalter. Für Analysen ist sie immer an.
- **Nur lesen:**
  - Shellherd liest dafür nur (`get`, `list` und `get` auf `pods/log`) und führt nie aus, was die KI vorschlägt. Befehle in der Antwort haben keinen Knopf.
  - Ändert ein Befehl den Cluster (etwa `delete`, `scale`, `rollout restart`, `apply`), steht darunter „Ändert den Cluster. Nur zur Information, Shellherd führt das nicht aus.“
  - „Nur lesen“ erlaubt die Analyse.
- **Rechte:** Darf das Konto Logs, Events, Owner oder Node nicht lesen, fehlt nur dieser Teil. Die Vorschau sagt, welcher und warum.
- **Rückfragen:** Nach dem Senden kannst du weiterfragen. Shellherd schickt den Kontext jedes Mal wieder mit, damit das Modell ihn kennt. `Verlauf leeren` oder eine neue Analyse beginnt von vorn.
- **Größe und Kosten:**
  - höchstens 16.000 Zeichen, etwa 4.000 Tokens je Anfrage;
  - jede Rückfrage kostet mindestens so viel wie die erste;
  - für Modelle mit kleinem Kontextfenster (unter 8.000 Tokens) ist eine Analyse zu groß.
- **Grenzen:**
  - Die KI sieht nur diesen Ausschnitt: keine Metriken, keine Services, Ingress oder Netzwerk-Policies, keine anderen Namespaces, keine Logs vor den letzten 100 Zeilen und keinen Inhalt von ConfigMaps und Secrets.
  - Ihre Antwort ist eine Vermutung aus diesen Daten. Prüfe sie mit den vorgeschlagenen lesenden Befehlen.
  - Logs können personenbezogene Daten enthalten. Bei Produktions-Clustern weist die Vorschau eigens darauf hin.

### Argo CD und Harbor

Im Cluster-Eintrag (`Bearbeiten` → „Weboberflächen (optional)“) kannst du die Adresse von Argo CD und von Harbor hinterlegen, etwa `https://argocd.example.com` und `https://harbor.example.com`. Erlaubt sind nur `https`-Adressen ohne Benutzername.

- **Argo CD erkennen:** Trägt ein Objekt die Annotation `argocd.argoproj.io/tracking-id` (Standard ab Argo CD 3) oder das Label `argocd.argoproj.io/instance`, zeigt sein Kontextmenü oben „Argo CD: App …“. Das Label `app.kubernetes.io/instance` wertet Shellherd nicht aus, weil Helm es ebenfalls setzt.
- **`In Argo CD öffnen`** öffnet die App im Browser. Ohne hinterlegte Adresse ist der Eintrag gesperrt und sagt, warum.
- **Self-Heal-Hinweis:** Skalieren, Anhalten, Fortsetzen und Job löschen an einem Objekt, das Argo CD verwaltet, sagen im Bestätigungsdialog, ob Argo CD die Änderung zurücksetzt, mit Sync- und Health-Stand der App. Dafür liest Shellherd die Application im Cluster (`get` auf `applications.argoproj.io`, im Namespace `argocd` oder dem Namespace vor `_` im App-Namen). Darf das Konto das nicht, läuft Argo CD in einem anderen Cluster oder antwortet der Cluster nicht binnen 5 Sekunden, steht dort „möglicherweise“. Bei einem Neustart sagt der Dialog, dass Argo CD ihn in der Regel nicht zurücksetzt.
- **`In Harbor öffnen`** gibt es an Pods, Containern, Deployments, StatefulSets und DaemonSets, wenn der Registry-Host des Images der Harbor-Adresse entspricht. Bei Pods führt der Link zum laufenden Artefakt (mit Schwachstellen-Scan, falls Harbor scannt), sofern der Cluster dessen Digest meldet; sonst und bei Workloads führt er zur Repository-Seite mit allen Tags. Liegt das Image woanders, ist der Eintrag gesperrt: „Image liegt nicht in harbor.example.com.“
- **Nur lesen, nur Links:** Shellherd löst kein Sync, kein Refresh, kein Rollback und keinen Scan aus und fragt weder Argo CD noch Harbor selbst ab. Es öffnet nur den Browser; Anmeldung und Rechte regeln Argo CD und Harbor dort wie gewohnt. Der Host eines Links kommt immer aus dem Cluster-Eintrag. Labels, Annotationen und Image-Namen aus dem Cluster bestimmen nur den Pfad.
- **Grenzen:** Liegen die Applications in einem anderen Namespace als `argocd` (etwa `openshift-gitops`), sagt der Dialog „möglicherweise“. Die Harbor-Links nutzen den Projektnamen statt der internen Projekt-ID. Öffnet Harbor statt des Artefakts die Projektliste oder eine Fehlerseite, nimmt deine Harbor-Version den Namen nicht an.

## Dateiansicht: Tastatur und Übertragungen

Tippen in der Dateiliste springt zum nächsten Eintrag, dessen Name so beginnt. Gesucht wird in der angezeigten Reihenfolge, Ordner zuerst. Schnell weitergetippt sucht Shellherd nach dem ganzen Anfang (`no` findet `notes.md`); derselbe Buchstabe mehrmals geht zum jeweils nächsten Treffer. Nach einer Sekunde Pause beginnt die Suche neu. Groß- und Kleinschreibung spielt keine Rolle. Das gilt für die lokale und die Server-Seite. Die Leertaste, Kombinationen mit `Strg` oder `Alt` und Zeichen, die nur mit `AltGr` entstehen (etwa `@`), springen nicht.

`Strg+L` in der Dateiliste, ein Doppelklick auf die Pfadleiste oder ⚙ → `Gehe zu …` macht aus der Pfadleiste ein Eingabefeld. `Enter` öffnet den Ordner, `Esc` bricht ab. Auf dem Server führen `~` und `~/…` in den Basisordner; ein Pfad ohne führenden `/` gilt ab dem aktuellen Ordner. Lokal gehen Laufwerkspfade (`D:\Projekte`, auch mit `/`), Netzwerkfreigaben (`\\server\freigabe`), `~` und Pfade ab dem aktuellen Ordner, Gerätepfade wie `\\?\` nicht. Fehlt der Ordner, ist es eine Datei oder fehlen Rechte, steht der Fehler unter dem Feld und der bisherige Ordner bleibt.

`Strg+F` in der Liste oder ⚙ → `Filtern …` blendet ein Filterfeld ein. Es zeigt nur Einträge, deren Name den Text enthält; Groß- und Kleinschreibung spielt keine Rolle. `Enter` oder `↓` geht zurück in die Liste. `Esc`, `×` oder ein Ordnerwechsel entfernen den Filter.

⚙ → `Versteckte Dateien ausblenden` blendet Namen mit Punkt am Anfang aus (`.bashrc`, `.git`). Das gilt für die lokale und die Server-Seite getrennt und wird für alle Verbindungen gemerkt. Lokal zählt nur der Punkt, nicht das Windows-Attribut „Versteckt“. Standard ist: alles anzeigen.

Ausgeblendete und weggefilterte Einträge lassen sich weder auswählen noch kopieren, verschieben oder löschen; `Strg+A` wählt nur, was zu sehen ist. Ein Ordner wird dabei immer vollständig kopiert oder gelöscht, mit den versteckten Dateien darin. Die Fußzeile zeigt, wie viele Einträge ausgeblendet sind. Aus der Dateiansicht lässt sich nichts in den Explorer ziehen. Zum Herunterladen wählst du links den Zielordner (etwa mit `Strg+L`) und drückst `F5`.

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

Beim ersten Kontakt den angezeigten SHA-256-Fingerprint mit einer vertrauenswürdigen Quelle vergleichen. Nur ausdrücklich bestätigte Schlüssel werden in `known-hosts.json` im Electron-Benutzerdatenverzeichnis gespeichert. Diese Datei enthält Hosts, Ports und öffentliche Fingerprints, keine Zugangsdaten. Sie liegt unter `%APPDATA%\Shellherd\known-hosts.json`; beim ersten Start übernimmt Shellherd sie einmalig aus `%APPDATA%\Terminus`. Abweichende Schlüssel und beschädigte Vertrauensdateien brechen die Verbindung ab.

Einstellungen → Verbindungen → `Server-Schlüssel verwalten` zeigt alle bestätigten und importierten Schlüssel mit Host und Port (gehashte Einträge: „Gehashter Hostname“), Typ bei importierten Einträgen und SHA-256-Fingerprint. Das Suchfeld filtert nach Host, Typ oder Fingerprint. `Entfernen` löscht einen Eintrag sofort; beim nächsten Verbinden fragt Shellherd wieder nach. So nimmst du einen gewollten Schlüsselwechsel an: alten Eintrag entfernen, neu verbinden, den neuen Fingerprint prüfen und bestätigen. Einen gehashten Eintrag findest du über den Fingerprint, den die Fehlerkarte als `expected` nennt.

`Aus known_hosts importieren …` liest eine OpenSSH-Datei, die du im Dialog wählst (vorgeschlagen: `%USERPROFILE%\.ssh\known_hosts`, höchstens 4 MiB). Übernommen werden Hostnamen, `[host]:port` und gehashte Namen (`|1|…`) mit Ed25519-, ECDSA- und RSA-Schlüsseln, auch mehrere je Server. Gehashte Einträge zeigt die Liste als „Gehashter Hostname“. `@revoked`-Zeilen gelten für alle Hosts: Einen so markierten Schlüssel nimmt Shellherd nie an, auch nicht nach Rückfrage. Übersprungen werden `@cert-authority`, Muster wie `*.example.com` oder `!host`, Zertifikate und Sicherheitsschlüssel (`sk-…`). Der Import ändert keinen Schlüssel, den du in Shellherd bestätigt hast: Für solche Server gilt weiter Shellherds Eintrag, und weicht die Datei davon ab, nennt das Ergebnis den Server. Shellherd liest `known_hosts` nur nach diesem Klick und schreibt sie nie.

## Fernzugriff (Entwicklung)

Nur in einem ungepackten Entwicklungs-Build mit `SHELLHERD_REMOTE_LAB=1` (unabhängig vom Sync-Lab-Flag `SHELLHERD_SYNC_LAB`), ausdrücklich ohne Sicherheitsfreigabe: Die Funktion hat keinen unabhängigen Sicherheitsreview. Nicht für echte Geräte oder echte Zugangsdaten einsetzen.

**Ablauf:**

1. Beide Geräte: Einstellungen → `Fernzugriff einrichten (Entwicklung)`, Server-Adresse eintragen, `Verbinden`, dann das Gerät mit Benutzername, Serverpasswort und einem Namen für dieses Gerät anmelden (`Gerät anmelden`). Das ist die Einschreibung: Das Passwort geht genau einmal je Gerät an den Server, der Server speichert die öffentlichen Schlüssel des Geräts. Danach meldet sich das Gerät nur noch mit seinem Schlüssel an, ohne Passwort. Der Vault muss entsperrt sein. Das Serverpasswort darf nicht das Vault-Passwort sein: Shellherd prüft das vor dem Senden und meldet „Das Serverpasswort darf nicht dein Vault-Passwort sein. Es wurde nichts an den Server gesendet.“ Der Gerätename hat 1–64 Zeichen: Buchstaben, Ziffern, Leerzeichen und `- _ . , ( ) '`; eine Folge von 8 oder mehr Zeichen aus 0–9 und a–f ist verboten, auch durch Leerzeichen getrennt, weil sie wie ein Prüfcode aussieht. Ist das Gerät schon für diesen Server unter einer anderen Adresse eingeschrieben, verlangt die Anmeldung zuerst den Haken `Ich habe die Adresse geprüft und melde dieses Gerät hier neu an.` Ein bereits eingeschriebenes Gerät zeigt stattdessen `Sitzung öffnen`; es braucht kein Passwort. Ohne Schlüsselablage des Betriebssystems (Hinweis `Temporäre Geräteidentität`) gilt die Einschreibung nur bis zum Neustart des Servers oder zwölf Stunden nach der letzten Sitzung.
2. `Dieses Gerät online melden` (der Name aus der Einschreibung wird verwendet). Der Dialog zeigt unter `Fingerabdruck dieses Geräts` den Fingerabdruck dieses Geräts.
3. Am ansehenden Gerät erscheint das andere Gerät unter `Online-Geräte`, zunächst ohne Fingerabdruck. Lies am anderen Gerät dessen `Fingerabdruck dieses Geräts` ab und tippe die ersten 16 Zeichen (die ersten zwei Gruppen) in das Feld `Erste 16 Zeichen des Fingerabdrucks vom anderen Gerät (die ersten zwei Gruppen)` (Groß- und Kleinschreibung und Leerzeichen sind egal). Erst dann ist `Bildschirm ansehen` aktiv. Den Fingerabdruck liest du nur vom Bildschirm des anderen Geräts ab, nie vom Server, aus dem eigenen Dialog oder aus einem Gerätenamen.
4. Am anderen Gerät fragt `Bildschirm freigeben?` im Fenster von Shellherd. Beim ersten Kontakt tippst du dort die ersten 16 Zeichen des Fingerabdrucks des Anfragenden, abgelesen auf dessen Bildschirm. Der Fingerabdruck steht im Fenster nicht. `Bildschirm freigeben` ist in der ersten Sekunde gesperrt und erst mit 16 gültigen Zeichen aktiv.
5. Nach dem Klick fragt Shellherd in einem Systemdialog noch einmal, mit dem vollen Fingerabdruck des Anfragenden in Achtergruppen, den Knöpfen `Ablehnen` und `Bildschirm freigeben` und dem Hinweis, dass der gesamte Hauptbildschirm übertragen wird. Erst dieser Klick gibt die Aufnahme frei. Danach zeigt der Dialog `Verschlüsselte Verbindung wird aufgebaut …`, bis der verschlüsselte Kanal steht (höchstens 20 s, sonst Verbindungsfehler). Solange das Bild läuft, zeigt eine Leiste, wer zusieht, mit `Beenden`.
6. Beide Seiten können jederzeit beenden (`Verbindung beenden` bzw. `Beenden`). Sperren des Vaults beendet die Verbindung ebenfalls.

**Prüfung und Pins:**

- Die Signalisierung (Angebot, Antwort, Kandidaten) läuft über einen verschlüsselten Kanal zwischen den beiden Geräten: Noise XX (`Noise_XX_25519_ChaChaPoly_BLAKE2b`) mit den statischen Geräteschlüsseln, ephemeren Schlüsseln je Sitzung (Forward Secrecy) und festem Prologue aus Server-ID, Sitzung, Nonce und Zweck. Der Server vermittelt nur Frames und sieht keinen Klartext. Der Handshake bestätigt den Schlüssel des anderen Geräts gegen den geprüften Fingerabdruck (volle 256 Bit); passt er nicht, endet die Sitzung mit einem Fehler, bevor etwas gesendet wird. Ein Server ohne dieses Verfahren (`rendezvousNoise`) wird abgelehnt, es gibt kein Downgrade.
- Ein Gerät gilt erst als geprüft, wenn die getippte Prüfung gelungen ist. Danach merkt sich Shellherd Name und Fingerabdruck, zeigt `Geprüft am …` und verlangt kein Feld mehr. Einmal geprüfte Geräte erscheinen mit vollem Fingerabdruck.
- Ändert sich der Fingerabdruck eines bekannten Namens, meldet Shellherd „Der Fingerabdruck von … hat sich geändert. Prüfe ihn erneut.“ und verlangt das Feld wieder.
- Drei falsche Eingaben je Sitzung lehnen die Anfrage ab (`Die Prüfung ist dreimal fehlgeschlagen. Die Anfrage wurde abgelehnt.`).
- Wer eine Anfrage ablehnt oder die Prüfung dreimal verfehlt, schaltet dieses Gerät für 10 Minuten stumm. Weitere Anfragen löscht Shellherd ohne Dialog. Der Dialog zählt sie als `… Anfragen stummgeschaltet`. Der Server lässt nach einem Ablehnen zusätzlich 30 s lang keine neue Anfrage desselben Paars zu.
- Die Pins liegen in der Identitätsdatei und sind mit einem Schlüssel aus der Schlüsselablage des Betriebssystems authentifiziert. Eine veränderte Datei wird abgelehnt (Fehler zur Geräteidentität), nicht ersetzt. Eine ältere Datei aus der Zeit vor diesem Stand wird übernommen, alle Geräte gelten danach als ungeprüft.

**Grenzen:**

- Nur Ansehen. Maus und Tastatur werden nicht übertragen.
- Nur im selben Netz (LAN), ohne TURN-Relay. Die Signalisierung über den Server funktioniert auch über WireGuard oder Tailscale (siehe „Privates Netz“), die Bildverbindung selbst bleibt auf direkte Host-Kandidaten beschränkt. Es gibt nur direkte Verbindungen über Host-Kandidaten; hinter NAT oder über getrennte Netze scheitert der Aufbau mit „Keine direkte Verbindung möglich“.
- Eine Sitzung dauert höchstens fünf Minuten, danach ist eine neue Anfrage nötig.
- Sperrbildschirm, UAC-Abfragen und Anmeldemaske werden nicht übertragen.
- Unter Linux gibt es keinen Fensterschutz: Auch das Shellherd-Fenster ist im Bild sichtbar. Unter Wayland zeigt das System eine eigene Auswahl, was freigegeben wird.
- Notbremse: Beendet das Fenster eine Freigabe nicht innerhalb von zwei Sekunden sauber, lädt Shellherd das Fenster neu. Das beendet jede laufende Aufnahme, setzt aber auch den Zustand dieses Fensters zurück.
- Die Geräteidentität bleibt nur mit Schlüsselablage des Betriebssystems erhalten. Ohne sie ist sie temporär, und der Fingerabdruck ändert sich beim nächsten Start. Das gilt auch, wenn die Identitätsdatei nicht geschrieben werden kann.
- Ein Rückspielen einer älteren gültigen Identitätsdatei bringt alte Pins zurück. Eine Datei im alten Format stuft alle Pins auf ungeprüft zurück. Fälschen lassen sich die Pins damit nicht.
- Eine bestehende Bildverbindung läuft nach dem Entfernen eines Geräts weiter, weil sie direkt zwischen den Geräten besteht (höchstens bis zum Ende der Sitzung nach fünf Minuten). Neue Anfragen des entfernten Geräts lehnt der Server ab.
- Ein Wechsel der Server-Adresse verlangt eine neue Einschreibung. Ist das Gerät für eine andere Adresse eingeschrieben, warnt der Dialog („Ein fremder Server kann sich als dein Server ausgeben, indem er dieselbe Server-ID meldet. …“), und die Anmeldung geht nur nach dem Haken `Ich habe die Adresse geprüft und melde dieses Gerät hier neu an.` Die Pins sind je Server-ID und Adresse getrennt. Die eigentliche Absicherung leistet der Server: Nachweise sind an seine Origin gebunden (siehe „Privates Netz und Sync-Lab (Entwicklung)“).
- Die Namensregel erkennt nur eine kleine Tabelle von Lookalikes. Lateinische Verwechslungen (`O`/`0`, `l`/`1`) und Trenn-Buchstaben außerhalb von 0–9 und a–f lassen sich nicht ausschließen. Verlasse dich auf den Fingerabdruck am anderen Gerät, nie auf den Namen.
- Fremde Objekte im Konto, die kein Vault dieses Kontos sind, überspringt der Sync und meldet sie. Sie belegen weiter das Serverkontingent (100 Objekte, 32 MiB), bis du sie bewusst entfernst (siehe „Privates Netz und Sync-Lab (Entwicklung)“).
- Bestehende Pins aus der Zeit vor dem 16-Zeichen-Stand (48 Bit) bleiben gültig und geprüft. Die Prüfung beim Handshake vergleicht trotzdem den vollen Fingerabdruck.
- Bisher wurde nur ein Testbild übertragen (Szene mit Fake-Capture). Echtes Capture (Wayland-Portal, Windows) ist nicht manuell geprüft, ebenso nicht der Fensterschutz unter Windows und macOS während der Freigabe.
- Für die Szene `remote-scene.mjs` und echte Tests braucht jedes Gerät eine Netzwerkschnittstelle mit LAN-Adresse; Loopback allein reicht für WebRTC nicht.

**Was die Prüfung schützt, und was nicht:**

- Die getippte Prüfung schützt gegen einen bösartigen Server bei ehrlichem Renderer: Schiebt er einem Gerät einen fremden Schlüssel unter, passt dessen Fingerabdruck nicht zur getippten Eingabe, und die Anfrage scheitert.
- Gegen einen kompromittierten Renderer schützt sie nicht. Dieser kennt den Fingerabdruck und kann das Feld selbst füllen. Der native Dialog mit dem vollen Fingerabdruck sichert den regulären Ablauf ab: Die Bildschirmfreigabe läuft über Berechtigungs- und Bildschirmquellen-Handler im Hauptprozess, die ohne Zustimmung des Dialogs für die aktuelle Sitzung nichts freigeben. Verbleibendes Risiko: Ein vollständig kompromittierter Renderer kann den Dialog nicht anklicken, aber er kann die Aufnahme jederzeit auslösen und damit den Dialog selbst aufrufen. Ob freigegeben wird, entscheidet dann allein die Person vor dem Rechner im Dialog.
- Die getippte Prüfung vergleicht 16 Hex-Zeichen, also 64 Bit. Wer den Server betreibt, kennt die Fingerabdrücke aller Geräte und kann vorab rechnen, um für ein Gerät einen Schlüssel mit gleichem Anfang zu finden. Das erfordert 2^64 Schlüsselerzeugungen, ist also deutlich teurer als bei den früheren 48 Bit, aber kein Beweis gegen einen Angreifer mit sehr großer Rechenleistung. Dafür bestätigt der Noise-Handshake den Schlüssel des anderen Geräts gegen den vollen Fingerabdruck. Ein früher gepinntes 48-Bit-Gerät bleibt gültig; ein in der Zwischenzeit im Lab theoretisch erzeugter Pin würde vom Handshake „bestätigt“. Wer Zweifel hat, entfernt den Pin und prüft neu.
- Die Berechtigungsregeln für Medien sind nur im Check verschärft: Der Main-Prozess meldet für Medien-Checks nur `video` als erlaubt, solange eine Freigabe gerüstet ist. Die Anfrage selbst läuft wie zuvor über den Dialog, weil `getDisplayMedia` und ein Legacy-`getUserMedia` mit Desktop-Quelle in Electron 44 im Handler nicht zu unterscheiden sind. Restrisiko: Nach erteilter Zustimmung kann ein kompromittierter Renderer für diese Sitzung weiter eine andere Quelle oder Desktop-Audio anfordern. Es bleiben Zustimmung je Sitzung, nur Hauptframe, CSP und Notbremse.

## Privates Netz und Sync-Lab (Entwicklung)

Der Sync-Lab (Einstellungen → `Selfhosted Sync einrichten (Entwicklung)`) gibt es nur in einem ungepackten Entwicklungs-Build mit `SHELLHERD_SYNC_LAB=1` (unabhängig vom Fernzugriff-Flag `SHELLHERD_REMOTE_LAB`), nur unter Linux und ausdrücklich ohne Sicherheitsfreigabe: Die Funktion hat keinen unabhängigen Sicherheitsreview. Nicht für echte Vaults oder echte Zugangsdaten einsetzen. Unter anderen Systemen meldet der Dialog „Der Abgleich ist in diesem Entwicklungsstand nur unter Linux verfügbar.“ Gepackte Builds schalten beide Labs aus.

**Privates Netz (WireGuard/Tailscale):** Im Fernzugriff- und im Sync-Dialog erlaubt die Option `Privates Netz (WireGuard/Tailscale): HTTP erlauben` HTTP für die Adresse eines privaten Tunnels (10/8, 172.16/12, 192.168/16, 100.64/10, IPv6 `fc00::/7`; keine Namen, kein `fe80::`, keine öffentlichen Adressen). Die Option ist nur für eine WireGuard- oder Tailscale-Adresse dieses Servers gedacht: Außerhalb eines solchen Tunnels könnte das Netz Serverpasswort und Daten mitlesen. Das Vault-Passwort bleibt lokal. Ohne Haken bleibt HTTP nur für `127.0.0.1` und `::1` erlaubt. **Achtung bei 100.64/10:** Dieser Bereich ist erlaubt, weil Tailscale ihn nutzt. Viele Provider nutzen ihn aber auch für Carrier-NAT (CGNAT); dann liegen fremde Kunden im selben „privaten“ Netz und könnten Serverpasswort und Daten mitlesen. Nutze die Option nur mit Tailscale oder WireGuard, nicht in einem Provider-NAT. Der Server-Betrieb steht im Server-README (`compose.wireguard.yaml`).

**Kompaktierung:** Jede Version trägt ihre Vorgänger. Hat der Sync nach einem erfolgreichen Lauf genau einen Kopf, keine ausstehende Änderung und mehr als 32 Versionen, lädt er eine Zusammenfassung des Kopfs hoch, behält die jüngsten 16 Versionen und entfernt die übrigen auf dem Server. Die Zusammenfassung führt die entfernten Versionen als kumulative Liste (höchstens 256 Einträge, die ältesten fallen zuerst weg). Der Dialog meldet das Ergebnis (`{{count}} ältere Versionen wurden zusammengefasst und vom Server entfernt.`).

- Ein Gerät, das nach langer Abwesenheit mit einer lokal noch vorhandenen, inzwischen kompaktierten Version zurückkehrt, führt über die kompaktierte Basis zusammen, statt einen Verlauf-Fehler zu melden.
- Kehrt es nach so langer Abwesenheit zurück, dass die Liste die gemeinsame Basis schon abgeschnitten hat, kommt eine Meldung zum Verlauf. Dann hilft Neu-Laden vom Server.
- Setzt ein Gerät eine Änderung auf eine inzwischen kompaktierte Basis, kann diese auf anderen Geräten bis zu seinem nächsten Abgleich als Konflikt ohne gemeinsame Basis erscheinen.
- Hat ein Konto zwei Köpfe ohne berechenbare gemeinsame Basis, bleibt es wie bisher ein Konflikt ohne Auflösungsweg, und es läuft keine Kompaktierung.
- Ein H1-Server ohne Löschen lässt das Konto mit einem H2-Client weiter wachsen, bis der Server 507 meldet. Aktualisiere Server und Clients gemeinsam.
- Das Löschrecht hat jede Anmeldung des Kontos (Token, 15 min). Wer es missbraucht, kann Objekte entfernen. Der Sync erkennt das Löschen bereits bestätigter Objekte (Meldung zum Verlauf). Noch nie gesehene Objekte lassen sich so unbemerkt zurückhalten.

**Geräte einschreiben (Sync-Lab):** Einstellungen → `Selfhosted Sync einrichten`, Server-URL, `Verbinden` (der Server wird nur geprüft, Fortschritt „Server wird geprüft …“), dann Benutzername, Serverpasswort und Gerätename, `Gerät anmelden`. Das Passwort geht einmal je Gerät über die Leitung (TLS oder privates Netz). Danach öffnet `Sitzung öffnen` eine Sitzung mit dem Schlüssel des Geräts, ohne Passwort. Es gibt keinen Passwort-Login mehr. Die eingegebene Adresse muss genau die sein, die der Server als `SHELLHERD_SERVER_ORIGIN` kennt (Schema und Host, ohne Pfad); Einschreibung, Sitzung und Widerruf sind an diese Origin gebunden. Weicht sie ab, meldet der Dialog beim `Verbinden`, dass der Server nicht bestätigt werden konnte. Ist das Gerät für diesen Server schon unter einer anderen Adresse eingeschrieben, verlangt `Gerät anmelden` zuerst den Haken `Ich habe die Adresse geprüft und melde dieses Gerät hier neu an.` Der Gerätename hat 1–64 Zeichen (Buchstaben, Ziffern, Leerzeichen und `- _ . , ( ) '`); eine Folge von 8 oder mehr Zeichen aus 0–9 und a–f ist verboten, auch durch Leerzeichen getrennt. Ein Server oder Client auf dem Stand vor diesem Verfahren ist nicht kompatibel: Der Dialog meldet, dass der Server die Geräteanmeldung nicht unterstützt. Das Serverpasswort darf nicht das Vault-Passwort sein. Diese Prüfung vor dem Senden läuft **nur bei entsperrtem Vault**: Bei gesperrtem Vault gibt es nichts zu vergleichen, und die Anmeldung wird nicht blockiert. Entsperre den Vault vorher oder wähle bewusst ein anderes Passwort.

**Mit Anmeldecode einschreiben:** Im Schritt „Dieses Gerät anmelden“ wählst du oben `Mit Anmeldecode` statt `Mit Serverpasswort`. Dann gibst du den Anmeldecode (32 Zeichen) und einen Gerätenamen ein, `Mit Anmeldecode anmelden`; ein Serverpasswort ist nicht nötig. Den Code erzeugt ein bereits angemeldetes Gerät (siehe „Gerät einladen“). Meldet der Server `invite-only` (Betreiber hat `lock-enrollment` ausgeführt, siehe Server-README), ist `Mit Anmeldecode` vorausgewählt. Die Passwortform bleibt wählbar, endet aber mit „Dieser Server nimmt neue Geräte nur mit Anmeldecode an. Erzeuge ihn auf einem angemeldeten Gerät.“ Ist der Code falsch, abgelaufen oder schon verwendet, erscheint „Der Anmeldecode ist falsch, abgelaufen oder schon verwendet. Erzeuge auf dem angemeldeten Gerät einen neuen.“

**Gerät einladen:** Auf einem angemeldeten Gerät mit offenem Vault erzeugt `Gerät einladen` einen Anmeldecode. Er steht in Vierergruppen im Dialog, genau einmal; `Ich habe den Code übertragen` entfernt ihn. Es gibt keinen Kopieren-Knopf. Der Code gilt **zehn Minuten und genau einmal**, auch wenn das Einschreiben danach scheitert. Aus ihm leitet das einladende Gerät zwei getrennte Werte ab: eines für den Server (die Einschreibung) und eines, das eine Einladungs-Keybox mit dem Sync-Schlüssel öffnet. Der Server kennt nur die Einschreibe-Ableitung und kann die Keybox nicht lesen. Das neue Gerät hat damit Einschreibung **und** Sync-Schlüssel mit einem Code; den Wiederherstellungscode braucht es nicht. Voraussetzung am einladenden Gerät ist ein vorhandener Sync-Schlüssel (sonst `Für den Abgleich fehlt der Wiederherstellungscode.`) und ein abgeschlossener Bootstrap. Höchstens 4 Einladungen sind je Gerät und 16 insgesamt offen, zehn Anfragen je Minute. Die Geräteliste zeigt beim neuen Gerät `angemeldet mit Anmeldecode von <Name>`, bei Passwort-Einschreibung `angemeldet mit Serverpasswort`.

**Wiederherstellungscode:** Der Sync verschlüsselt die Versionen mit einem zufälligen Sync-Schlüssel, nicht mehr mit einem Schlüssel aus dem Vault-Passwort. Beim ersten Abgleich eines leeren Kontos erzeugt das erste Gerät einen Wiederherstellungscode (32 Zeichen, Anzeige in Vierergruppen) und legt eine Keybox mit dem Sync-Schlüssel auf dem Server ab. Der Dialog zeigt den Code genau einmal; `Ich habe den Code notiert` entfernt ihn aus der Oberfläche. Es gibt bewusst keinen Kopieren-Knopf (Zwischenablage-Verläufe). Der Server kennt den Code nicht. Ohne Code und ohne ein Gerät mit dem Sync-Schlüssel lässt sich das Konto nicht laden. Der Code öffnet genau den **aktuellen** Sync-Schlüssel (die aktuelle Epoche); nach `Sync-Schlüssel erneuern` gilt ein neuer Code und der alte öffnet nichts Neues. Einen neuen Code allein ohne neuen Schlüssel gibt es nicht mehr (`Neuen Wiederherstellungscode erzeugen` ist entfallen). Liegen im Konto Versionen eines anderen Sync-Schlüssels, erneuert Shellherd den Schlüssel nicht, sondern meldet das.

**Sync-Schlüssel erneuern (Schlüsselepoche):** `Sync-Schlüssel erneuern` erzeugt einen neuen zufälligen Sync-Schlüssel und einen neuen Wiederherstellungscode. Alle Daten werden unter dem neuen Schlüssel neu auf dem Server abgelegt (Epoche +1), die der alten Epoche entfernt. Entfernte Geräte, alte Codes und alte Serverkopien lesen danach **nichts Neues** mehr. Das ersetzt den früheren, ehrlich begrenzten Codewechsel. Vor dem Erneuern fragt der Dialog nach („Synchronisiere vorher auf allen Geräten, damit nichts im Konflikt endet.“, `Jetzt erneuern`). Die Vorbedingung: Der Abgleich ist vollständig und ohne Konflikt, es gibt keine ungesyncten lokalen Änderungen und kein anderes Gerät hat seit deinem letzten Abgleich etwas hochgeladen; sonst `Vor dem Erneuern muss der Abgleich ohne Konflikte und ohne offene lokale Änderungen abgeschlossen sein. Synchronisiere zuerst.` Der neue Code erscheint genau einmal wie der erste. Nach dem Entfernen eines Geräts (auch eines temporären) zeigt der Dialog `Ein Gerät wurde entfernt. Erneuere den Sync-Schlüssel, damit es neue Daten nicht mehr lesen kann.`; die Rotation läuft nie automatisch.

Jedes andere Gerät meldet beim nächsten Abgleich `Der Sync-Schlüssel wurde auf einem anderen Gerät erneuert. Gib den neuen Wiederherstellungscode von dem Gerät ein, das erneuert hat. Ein alter Code öffnet den neuen Schlüssel nicht. Dein lokaler Vault bleibt unverändert.` Du gibst den neuen Code ein, und das Gerät übernimmt die neue Epoche, aber nur, wenn eine Version dieser Epoche den gültigen Autorenstempel eines bekannten, nicht entfernten und bestätigten Geräts trägt. Ein Gerät mit offenem Hinweis „Neues Gerät“ zählt dafür noch nicht, bis du es bestätigst. Auf einem frisch angemeldeten Gerät stammt die erste Geräteliste allerdings ungeprüft vom Server. Sonst meldet es, dass ein neuer Schlüssel von keinem bekannten Gerät stammt, und übernimmt nichts. Lokale Änderungen seit dem letzten Abgleich gehen dabei nicht verloren: Sie werden aus einer gemeinsamen Basis mit dem Stand der neuen Epoche zusammengeführt, ein echter Widerspruch wird ein normaler Konflikt. Gibt es keine eindeutige gemeinsame Basis, meldet das Gerät den Konflikt, ohne etwas zu schreiben (Ausweg: `.sync-state` löschen und neu laden, ungesyncte Änderungen von Hand nachtragen). Rotieren zwei Geräte gleichzeitig, gewinnt eines; das andere meldet `Ein anderes Gerät hat den Sync-Schlüssel gleichzeitig erneuert. Es wurde nichts geändert. Synchronisiere und versuche es erneut.` Die Rotation verlangt einen Server mit Löschen (ein H1-Server ergibt die Meldung zum Größen- und Versionsprofil). Beendet der Host die Verbindung zwischen dem Abschluss der Rotation und der Anzeige, geht der neue Code verloren; dann hilft ein erneutes `Sync-Schlüssel erneuern`. **Was die Rotation nicht kann:** Eine alte Serverkopie samt altem Code liest weiter die alten Daten. Ein nicht entferntes, aber heimlich kompromittiertes Gerät liest weiter mit. Ein bösartiger Server kann einem Gerät, das die neue Epoche noch nicht übernommen hat, sie vorenthalten; dieses schreibt dann weiter unter dem alten Schlüssel. Der Server sieht die Epochenzahl.

**Vault auf einem zweiten Gerät laden:** Auf dem zweiten Gerät einschreiben, bei geschlossenem Vault `Wiederherstellungscode` und ein neues Vault-Passwort für die lokale Datei eingeben (Wiederholung nötig), `Vault vom Server laden`. Wurde das Gerät mit einem Anmeldecode angemeldet, gibt es **kein** Codefeld („Dieses Gerät wurde mit einem Anmeldecode angemeldet und kennt den Sync-Schlüssel. Wähle nur ein neues Passwort für die lokale Vault-Datei.“); der Code bleibt bis zum erfolgreichen Import im Hauptprozess (nie im Dialog) und wird danach gewischt. Fehlt die Einladungs-Keybox inzwischen (zehn Minuten vorbei oder Schlüssel erneuert), meldet der Dialog `Der Sync-Schlüssel aus dem Anmeldecode liegt nicht mehr auf dem Server, …`; dann hilft der Wiederherstellungscode. Dasselbe gilt beim Abgleich eines offenen Vaults mit gehaltenem Code. Das Passwort bleibt lokal und darf ein anderes sein als auf dem ersten Gerät. Empfangene Verbindungen starten deaktiviert. Beim Abgleich eines geöffneten Vaults auf einem Gerät ohne Sync-Schlüssel fragt der Dialog nach dem Code.

**Geräte verwalten:** Unter `Geräte dieses Kontos` stehen alle eingeschriebenen Geräte mit Name, Zeitpunkt und den Markierungen `dieses Gerät`, `temporär` und `entfernt`. `Entfernen` widerruft ein anderes Gerät: Es verliert sofort den Zugriff auf den Server und das Rendezvous, ohne weiteres Bestätigen (das Wiedereinschreiben mit Passwort ist möglich). Das eigene Gerät lässt sich in der Oberfläche nicht entfernen. Ein Passwortwechsel am Server widerruft keine Geräte. Neben jedem Gerät steht, wie es angemeldet wurde.

**Neues Gerät im Konto (Roster-TOFU):** Das Gerät pinnt je Einschreibung die Geräteliste des Servers (in der Identitätsdatei, höchstens 64 Einträge). Beim ersten Lauf übernimmt es die Liste still. Danach erscheint ein Hinweis `Neues Gerät im Konto: <Name> (<wie>). Hast du es nicht selbst angemeldet, entferne es, wechsle das Serverpasswort und erneuere den Sync-Schlüssel.` mit `Zur Kenntnis genommen`, sobald ein Gerät auftaucht, das nicht von diesem Gerät eingeladen wurde. Ein Gerät, das sich in derselben Verbindung mit einem eigenen Anmeldecode angemeldet hat, erscheint als Info `Mit deinem Anmeldecode angemeldet: <Name>. Wenn du das nicht selbst warst, entferne das Gerät, wechsle das Serverpasswort und erneuere den Sync-Schlüssel.` und wird ebenfalls bestätigt (so fällt ein abgefangener Code auf). Der Hinweis blockiert den Abgleich nicht. Ein bekanntes Gerät mit **anderem Signaturschlüssel** ist ein harter Fehler: `Die Geräteliste des Servers widerspricht der zuletzt gespeicherten: Ein bekanntes Gerät hat einen anderen Schlüssel. Es wurde nichts abgeglichen. Prüfe den Server.` Ein Widerruf, den der Server „vergisst“ oder aufhebt, gilt lokal weiter; es erscheint `<Name> war entfernt und ist laut Server wieder aktiv. Dieses Gerät behandelt es weiter als entfernt, bis du das bestätigst.`, und erst `Zur Kenntnis genommen` hebt den lokalen Widerruf auf. Nach einem Serverreset mit neuem Roster meldet das Gerät alle Geräte als neu; der Ausweg bei gleichem Gerät mit anderem Schlüssel ist, die Einschreibung zu vergessen und neu einzuschreiben. Temporäre Identitäten halten die Pins nur im RAM.

**Versionen entfernter Geräte:** Jede Version trägt einen Autorenstempel (Gerät und Signatur). Eine Version eines entfernten Geräts, die nach dem Entfernen entstand, übernimmt der Sync nicht automatisch; der Dialog meldet `{{count}} Versionen entfernter Geräte wurden nicht übernommen.` Versionen von Geräten, die der Server nicht mehr kennt (etwa abgelaufene temporäre Geräte), bleiben gültig und werden gezählt (`… stammen von Geräten, die der Server nicht mehr kennt`).

**Fremde Objekte entfernen:** Ein Serverkonto trägt genau einen Vault. Meldet der Sync fremde Objekte, entfernt `Fremde Objekte entfernen` nur Objekte, die sich mit dem Sync-Schlüssel dieses Kontos nicht lesen lassen (Linux, Vault entsperrt), darunter Objekte im Format vor diesem Stand. Lesbare Objekte, auch von neueren Clients, bleiben erhalten. Das Ergebnis lautet `{{count}} fremde Objekte wurden entfernt.` (bei null: nichts wird gelöscht). Verschlüsselte **Versionen** mit einem anderen Sync-Schlüssel entfernt Shellherd nur auf ausdrückliche Anforderung: Der Haken `Auch verschlüsselte Versionen entfernen, die mit einem anderen Sync-Schlüssel erstellt wurden` warnt, dass ein Gerät, das noch mit diesem Schlüssel abgleicht, seine Serverhistorie verliert (sein lokaler Vault bleibt).

**Anderer Server (`.sync-state`):** Der Sync-Zustand neben dem Vault merkt sich die Server-ID. Gehört er zu einem anderen Server, endet der Abgleich ohne Änderung mit „Der Sync-Zustand dieses Vaults gehört zu einem anderen Server. …“. Um den Vault mit diesem Server zu verbinden, lösche die Datei `.sync-state` neben dem Vault (vorher sichern; bei mehreren Geräten gilt die Reihenfolge aus „Migration“).

**Upgrade auf H3.1 (Lab-Bruch):** Das Nachweisformat ändert sich (Bindung an die Server-Origin). Es gibt keinen Kompatibilitätspfad: Alle Geräte schreiben sich neu ein. Am Server `SHELLHERD_SERVER_ORIGIN` setzen und eine `devices.json` der Vorstufe wegschieben (der Server meldet das beim Start). Auf jedem Gerät scheitert `Sitzung öffnen` danach mit der Meldung zur Anmeldung (Benutzername oder Serverpasswort falsch, oder das Gerät wurde entfernt); Shellherd vergisst dann die alte Einschreibung, und du schreibst das Gerät mit dem Passwort neu ein. Die alte `.sync-state` eines Vaults bleibt lesbar. Gleiche zuerst auf dem führenden Gerät ab, dann auf den anderen. Schritte und Befehle stehen im Server-README („Upgrade auf H3.1“).

**Server verwalten:** Bei gestopptem Server zeigt `node server/main.mjs list-devices` (im Container `docker compose -f server/compose.yaml run --rm server list-devices`) alle Geräte, `revoke-device <id>` widerruft eines. `lock-enrollment` und `unlock-enrollment` (ebenfalls nur bei gestopptem Server) schalten die Einschreibung mit Passwort ab oder wieder an. **Empfehlung:** direkt nach dem ersten Gerät `lock-enrollment` ausführen; dann nimmt der Server weitere Geräte nur mit Anmeldecode an (Passwortform: 403, vor der Passwortprüfung), und es gibt keinen online ratbaren Wert mehr. Beim Start warnt `serve`, solange Geräte eingeschrieben sind und die Einschreibung mit Passwort noch offen ist. Wer alle Geräte verliert, ruft `unlock-enrollment` auf und schreibt ein Gerät mit dem Passwort ein. Nach einem Passwortleck: Server stoppen, `rotate-password`, unbekannte Geräte erkennen und widerrufen, `lock-enrollment`, Server starten und in der App `Sync-Schlüssel erneuern` (Server-README, „Nach einem Passwortleck“). Ein Passwortwechsel allein widerruft keine Geräte. Ein optionaler Unix-Socket statt TCP-Port (`SHELLHERD_SERVER_SOCKET`, Override `compose.socket.yaml`) beschränkt das Setzen von `X-Forwarded-For` auf Prozesse mit Zugriff auf den Socket (Gruppe des Proxys, root) (Server-README, „Unix-Socket hinter Caddy“). Eine **globale Passwortsperre** begrenzt das Raten: Nach 20 falschen Serverpasswörtern in 10 Minuten antwortet der Server allen mit 429 bis zum Fensterende. Das kann auch den Besitzer an der Neueinschreibung hindern, wenn jemand die Sperre absichtlich auslöst. Eingeschriebene Geräte sind nicht betroffen, ein Neustart des Servers hebt die Sperre auf. Eigene Serverpasswörter brauchen mindestens 20 Zeichen, der Standard ist ein generiertes Passwort.

**Import mit gleichem Passwort:** Wurde das Gerät in derselben Verbindung mit Passwort eingeschrieben und ist das neue Vault-Passwort beim Import zugleich dieses Serverpasswort, bricht der Import ab: „Das Vault-Passwort ist zugleich dein Serverpasswort, und dieses wurde bereits an den Server gesendet. Der Import wurde abgebrochen. Ändere das Vault-Passwort auf dem Ursprungsgerät und wechsle das Serverpasswort.“ Nach einer passwortlosen Sitzung gibt es diese Prüfung nicht, weil Shellherd das Passwort nicht hält.

**Upgrade auf H4 (Lab-Bruch):** Hülle, Keybox, Autorenstempel, Nachweis, Sync-Zustand und Identitätsdatei bekommen neue Formate (Schlüsselepochen, Body-Digest im Nachweis, Roster-Schnappschuss). Geräte schreiben sich **nicht** neu ein, die Identitätsdatei wird beim ersten Lesen automatisch v4. Alle Geräte und der Server werden gemeinsam aktualisiert (ein Client vor H4 bekommt am neuen Server 400 und 401, ein neuer Client am alten Server `unavailable`). Reihenfolge wie bei der Migration unten: vorher überall abgleichen, auf dem ersten Gerät `.sync-state` löschen und neu abgleichen (Epoche 1, neuer Wiederherstellungscode), auf jedem weiteren Gerät den Vault neu vom Server laden. Der alte Zustand ergibt `Der lokale Sync-Zustand stammt aus einer älteren Lab-Version. …`. Danach am Server `lock-enrollment` ausführen.

**Prüfung der App (Szenen):** Die Szene `sync-scene.mjs` (Skill `run-app`) zeigt den Ablauf mit zwei Instanzen: Einschreibung mit Passwort, Anmeldecode, Laden mit Code, Hinweis „Neues Gerät“, Schlüssel erneuern, Übernahme mit neuem Code, Entfernen. Sie läuft auch in CI (Linux, `xvfb-run`). Ein Release-Build (`npm run dist*`, `SHELLHERD_RELEASE=1`) enthält den Lab-Code nicht mehr; die Szenen brechen dort mit der Meldung `out/ ohne Lab-Code (Release-Build). Neu bauen: npx electron-vite build` ab.

**Migration von einem Stand vor H3:** Der Sync-Zustand (`.sync-state`) und die Serverobjekte haben ein neues Format. Reihenfolge bei mehreren Geräten: Vorher alle Geräte mit dem alten Stand abgleichen. Dann auf dem ersten Gerät die Datei `.sync-state` löschen und neu abgleichen (der lokale Vault wird als neue Wurzel hochgeladen, der Wiederherstellungscode erscheint). Auf jedem weiteren Gerät den Vault nicht abgleichen, sondern über `Vault vom Server laden` neu laden. Wer mehrere Geräte unabhängig neu abgleicht, erzeugt zwei Wurzeln ohne gemeinsame Basis und damit einen Konflikt ohne Auflösungsweg. Alte Objekte auf dem Server lassen sich mit `Fremde Objekte entfernen` löschen.

**Grenzen (Stand H4):**

- Wer das Serverpasswort kennt, kann Geräte einschreiben, alle anderen widerrufen und Objekte löschen. Klartext liest er ohne den Code nicht. Ausweg: Server stoppen, Passwort wechseln (`rotate-password`), mit `list-devices` unbekannte Geräte erkennen und mit `revoke-device` widerrufen, die eigenen Geräte bei Bedarf neu einschreiben.
- Die Einschreibung beweist den Besitz des Signaturschlüssels, nicht den des Noise-Schlüssels. Wer das Passwort kennt, kann eine fremde, noch nicht eingeschriebene Geräte-ID belegen (sichtbar in der Liste; das echte Gerät bekommt dann einen Konflikt).
- Ein entferntes Gerät behält den Sync-Schlüssel und seine lokalen Daten. Neue Daten liest es erst nach `Sync-Schlüssel erneuern` nicht mehr. Die Rotation läuft nie automatisch.
- Der Anmeldecode gilt zehn Minuten und einmal. Wer ihn in dieser Zeit abfängt, erhält Einschreibung und aktuellen Schlüssel (sichtbar über „Neues Gerät“ und die Einschreibeart); Ausweg sind Entfernen und Rotation. Nach einem Serverneustart bleiben Einladungs-Keyboxen liegen, bis das einladende Gerät abgleicht oder rotiert.
- Der erste Lauf des Roster-Vergleichs vertraut der Geräteliste (TOFU).
- Ein bösartiger Server kann die neue Epoche einem Gerät vorenthalten, das sie noch nicht übernommen hat; eine gefälschte höhere Epoche blockiert nur den Abgleich. Ein frisches Gerät mit altem Code sieht nach dem Aufräumen `Der Wiederherstellungscode ist falsch …` statt der Meldung zur Erneuerung.
- Die Quarantäne gilt für entfernte dauerhafte Geräte. Entfernte temporäre Geräte verschwinden aus der Geräteliste, ihre Versionen werden angenommen und als „unbekannter Autor“ gezählt. Nach dem Entfernen können sie nichts mehr hochladen, weil ihre Sitzung weg ist.
- Die Quarantäne ist umgehbar: Ein Gerät mit Sync-Schlüssel kann einen unbekannten Autor eintragen, dann wird die Version angenommen. Sie hält nur ehrliche, veraltete oder später zurückgespielte Versionen entfernter Geräte auf. Der Stempel nutzt die Uhr des Autors; eine vorgehende Uhr kann eine Version kurz vor dem Entfernen zurückhalten, sperrt aber nie.
- Das Zurückhalten noch nie gesehener Objekte (konsistenter Schnitt) bleibt unerkennbar.

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
