# Terminus: UI-Analyse und Verbesserungsplan

Analyse: 8. Oktober 2026. Umsetzung: 9. Oktober 2026. Die sechs Schritte sind umgesetzt; der folgende ursprüngliche Befund dokumentiert die Ausgangslage. Der Umsetzungs- und Prüfstand steht am Ende.

## 1. Befund und Ziel

Terminus wirkt klobig, weil große Bedienelemente, mehrfach dargestellte Informationen und dauerhaft sichtbare Verwaltungsfunktionen zusammen viel Platz beanspruchen. Die visuelle Gewichtung unterstützt die Hauptaufgabe noch zu wenig: Server finden, verbinden und im Terminal arbeiten.

Das Ziel ist eine kompakte Desktop-Arbeitsoberfläche mit klarer Hierarchie. Terminals erhalten den größten Raum. Verbindungen bleiben schnell erreichbar. Bearbeitung und seltene Verwaltungsaktionen erscheinen im jeweiligen Kontext. Die bestehende dunkle Farbwelt mit Cyan als Akzent kann dabei erhalten bleiben.

### Grundlage der Analyse

- Aktuellen Renderer-Code einschließlich Startseite, Vault-Formularen, Sidebar, Ordner- und Verbindungseditor, Workspaces, Tabs, Terminal, Split-Layout und Bestätigungen geprüft.
- Zwölf Zustände in einer isolierten Electron-Instanz mit synthetischem Vault und lokalem SSH-Testserver aufgenommen: Start, Vault erstellen, leerer Vault, Ordner bearbeiten, Verbindung anlegen, Formularfehler, Schlüssel-Anmeldung, einzelnes Terminal, geteilte Ansicht mit und ohne Layout-Steuerung, Schließbestätigung und kleines Fenster.
- Fenstergrößen: 1280 × 800 und 900 × 600. Die tatsächlich verfügbare Web-Fläche betrug dabei 1264 × 735 beziehungsweise 884 × 535 Pixel.
- Die Routine zum Öffnen bestehender Vaults wurde im Code geprüft. Belastung mit großen Beständen, Bildschirmvergrößerung und vollständige Screenreader-Nutzung sind Abnahmethemen für die Umsetzung, keine bereits nachgewiesenen Eigenschaften.
- Der statische Impeccable-Scan meldet nur die bestehende Schrift Inter. Ein Schriftwechsel würde die hier nachgewiesenen Platz- und Ablaufprobleme nicht lösen; er erhält deshalb keine Priorität.
- Screenshot-Belege dieser Prüfung liegen unter `C:\Users\user\AppData\Local\Temp\terminus-tabs-ui-DLqDG2`.

### Gemessene Ausgangslage

| Element | Aktuell | Bedeutung |
|---|---:|---|
| Globale Kopfzeile | 68 px hoch | Große dauerhafte Flächenbindung |
| Sidebar | 300 px breit, im kleinen Fenster 260 px | Wenig Breite für mehrere Terminals |
| Workspace-Verwaltung | 287 px hoch | Verdrängt die Verbindungsliste selbst ohne gespeicherten Workspace |
| Globaler Tabstreifen | 44 px hoch | Zusätzlich zu Vault-Überschrift und Bereichsköpfen |
| Bereichskopf | 37 px im großen Fenster, mit Umbruch höher | Name, Adresse, Status und großer Trennen-Button wiederholen Informationen |
| Standardbuttons | Mindestens 48 px hoch | Für häufige Desktop-Aktionen überdimensioniert |
| Formularfelder | 14 px vertikales Padding | Lange Formulare und viel notwendiges Scrollen |
| Verbindungsformular | Aufnahme ca. 1260 px hoch, mit Schlüssel ca. 1440 px | Häufig benötigte Felder und Speichern liegen weit auseinander |
| Zwei Terminalflächen | Je 450 × 361 px | Zusammen ca. 35 % der sichtbaren App-Fläche im großen Fenster |

Die 35 % beziehen sich auf die sichtbaren Terminalcontainer einschließlich Innenabstand und Rahmen, nicht auf reine Zeichenzellen. Vorschläge für neue Maße unten sind Zielwerte und müssen visuell geprüft werden.

## 2. Prüfung der einzelnen Elemente

Priorität: P1 = hoher Nutzen oder konkretes Bedienrisiko; P2 = nachgelagerte Verbesserung; P3 = Feinschliff. Im geprüften Ablauf trat kein neuer Start- oder Verbindungsblocker auf.

| Bereich | Beobachtung und Auswirkung | Geplante Verbesserung | Priorität |
|---|---|---|---|
| Startseite | 68-px-Titel, 48-px-Kartenpadding, große Abstände und technische Statusbox dominieren die Ansicht. | Kompakter Einstieg mit „Vault öffnen“ als Hauptaktion und „Neuer Vault“ daneben. Zuletzt verwendete Dateien als späteres, gezieltes Zusatzinkrement. | P2 |
| Vault erstellen/öffnen | Schon das Formular mit drei Feldern benötigt im großen Fenster Scrollen. Dateiauswahl und Passwort sind räumlich weit auseinander. | Schmaler, kompakter Formularbereich; Passwort einblendbar; Anforderungen am Feld; Fehler unmittelbar beim betroffenen Schritt. | P1 |
| App-Kopfzeile | Marke und Sperrbutton erhalten eine eigene hohe Zeile; Vault-Name und Sicherheitsstatus folgen nochmals darunter. | Eine gemeinsame 44–48-px-Leiste für Vault, aktiven Workspace und Sperren. Vault-Pfad in Details/Tooltip. | P1 |
| Typografie und Flächen | Viele Elemente sind fett, stark gerundet, umrandet und ähnlich auffällig. | Wenige Schriftgrößen und Gewichte; ruhigere Flächen; deutlicher Akzent für die aktuelle Auswahl und Hauptaktion. | P1 |
| Verbindungsliste | Jede Verbindung zeigt Name und Adresse dauerhaft. Lange Adressen umbrechen. Ordner sind immer aufgeklappt. Suche fehlt. | Kompakte Zeilen, einklappbare Ordner, Suchfeld, skalierbare Sidebar. Adresse als sekundäre Information bei Auswahl/Details. | P1 |
| Navigation | Klick auf eine Verbindung öffnet den Editor und blendet die Terminalansicht aus. Zum Verbinden folgt ein weiterer Klick. | Einfachklick wählt aus; Doppelklick oder Enter verbindet. Sichtbare Verbinden-Aktion bei Hover und Tastaturfokus; Bearbeiten über eigenes Menü. | P1 |
| Ordnerverwaltung | Große Bearbeitungsseite für Name und Kommentar; Löschbereich ist dauerhaft präsent. | Umbenennen direkt im Baum; weitere Eigenschaften im gemeinsamen Editor. Löschen im Kontextmenü mit vorhandener Bestätigung. | P2 |
| Verbindungsformular | Kommentar steht vor Host. Tags, Hex-Farbe und Zielordner vergrößern den Hauptablauf. Schlüsselpfad muss eingegeben werden. | Verbindung und Anmeldung zuerst; Details einklappbar. Farbauswahl statt reinem Hex-Feld, Dateiauswahl für Schlüssel. „Speichern und verbinden“ als kombinierte Aktion. | P1 |
| Formularfehler | Der Fehler zum fehlenden Namen steht am Ende des langen Formulars. | Feldbezogene Meldung, `aria-invalid`/Beschreibung, Fokus zum ersten Fehler. Speichern bleibt erreichbar. | P1 |
| Ungespeicherte Bearbeitung | Im Code remountet ein Wechsel der Auswahl den Editor über dessen `key`; ein Schutz für ungespeicherte Werte fehlt. | Änderungen im Speicher erhalten oder beim Verlassen ausdrücklich speichern/verwerfen/abbrechen. Geheimnisse nicht als unverschlüsselte Entwurfsdatei persistieren. | P1 |
| Workspace-Verwaltung | Zwei Eingaben und fünf Buttons sind ständig sichtbar. Ausgewählte Definition und tatsächlich geöffnetes Layout sind nicht klar gekoppelt. | Aktiven Workspace in der Kopfzeile anzeigen; Speichern als direkte Aktion. Öffnen, Speichern unter, Umbenennen, Löschen und Schließen in einem Menü. Ungespeichertes Layout kennzeichnen. | P1 |
| Tabs und Bereichsköpfe | Globale Tabs und separate Terminaltitel wiederholen Namen. Bei mehreren Bereichen ist die Tab-Zuordnung nicht unmittelbar erkennbar. | Jeder Bereich bekommt einen eigenen kompakten Tabstreifen. Tab enthält Name, Status und Schließen; Adresse in Tooltip/Details. | P1 |
| Drag-and-drop | Die Vorschau funktioniert. Der Erklärungstext bleibt dauerhaft sichtbar. Ein leer gezogener Quellbereich bleibt als große Platzhalterfläche stehen. | Erklärung beim ersten Gebrauch und während des Ziehens. Leere Quellbereiche nach erfolgreichem Verschieben automatisch zusammenführen. Zielvorschau bleibt bis zur Entscheidung stabil. | P1 |
| Größenänderung | Größen werden über nummerierte Regler in der Tastaturansicht verändert. Das ist vom eigentlichen Trennrand getrennt. | Trennlinie direkt ziehen; Doppelklick setzt gleiche Größen. Tastaturbedienbare Separatoren mit Pfeiltasten. | P1 |
| Kleine Fenster | Sidebar und Arbeitsbereich können zusätzlich zum Terminal scrollen. Übergeordnete Mindestgrößen erzeugen große virtuelle Layoutflächen. | App-Rahmen bleibt im Fenster. Sidebar, Editor und Terminalausgabe bekommen klar getrennte Scrollbereiche. Split-Grenzen aus den tatsächlich verfügbaren Pixeln ableiten. | P1 |
| Dialoge | Folgen und Abbrechen sind verständlich. Große Abstände und generische Sammeltexte kosten Platz. | Kompakter Dialog mit konkreter Anzahl betroffener Sessions. Fokus auf Abbrechen und sichere Schließbestätigungen erhalten. | P2 |
| Leerzustände | „Noch keine Ordner“ vermittelt eine unnötige Voraussetzung für Verbindungen. Leere Bereiche erhalten relativ große Anleitungstexte. | Handlungsorientierte Leerzustände: „Verbindung anlegen“, „Verbindung hier ablegen“. Kontextabhängig eine passende Aktion anbieten. | P2 |
| Footer und Rückmeldung | Der lange Dateipfad steht ständig unten. Statusänderungen beim Speichern sind nur begrenzt erkennbar. | Kleine Statusleiste oder Header-Rückmeldung: „Speichert“, „Gespeichert“, Fehler. Pfad und Versionsinformationen in Details. | P2 |

Positiv zu erhalten: verständliche deutsche Beschriftungen, vorhandene Tastatur-Tabnavigation, sichtbarer Fokus, bedingte Authentifizierungsfelder, explizite Host-Key-Bestätigung, verschlüsselte Workspace-Speicherung und stabile SSH-Sessions bei Layoutänderungen.

## 3. Vorgeschlagene Arbeitsfläche

```text
┌─────────────────────────────────────────────────────────────────┐
│ Vault-Auswahl   Workspace: Produktion • geändert   Speichern  🔒 │
├──────────────────┬──────────────────────────────────────────────┤
│ Suche            │ Webserver ×          │ Datenbank ×           │
│ Verbindungen  +  ├──────────────────────┼───────────────────────┤
│ ▾ Produktion     │                      │                       │
│   Webserver      │                      │                       │
│   Datenbank      │      Terminal        │       Terminal        │
│ ▸ Entwicklung    │                      │                       │
│                  │                      │                       │
├──────────────────┴──────────────────────┴───────────────────────┤
│ Verbindungs-/Speicherstatus                                      │
└─────────────────────────────────────────────────────────────────┘
```

Die Zeichen im Schema erklären nur die Anordnung. Die Umsetzung verwendet konsistente SVG-Symbole mit zugänglichen Beschriftungen.

Bearbeiten öffnet eine fokussierte Eigenschaftenansicht. Bei ausreichend Platz erscheint sie rechts neben dem Arbeitsbereich; im kleinen Fenster als passende Dialogansicht. Die SSH-Terminals bleiben technisch montiert und verbunden. Die neue Navigation darf Eingaben nicht durch einen Auswahlwechsel verlieren.

### Maßsystem als Ausgangspunkt

| Element | Vorgeschlagener Zielwert |
|---|---|
| App-Leiste | 44–48 px |
| Sidebar | Standard 240 px, verstellbar etwa 200–360 px |
| Verbindungszeile / Terminaltab | 30–32 px |
| Normaler Button | 32 px |
| Formulareingabe | 36 px |
| Icon | 16 px, mit 28–32-px-Bedienfläche |
| Interface-Schrift | Meist 13 px, sekundär 12 px |
| Überschriften im Arbeitsbereich | 18–20 px |
| Terminalschrift | Eigenständig, zunächst 14 px erhalten |
| Ecken | 4–6 px für normale Controls, 8 px für Dialoge |
| Abstände | Einheitliche Stufen 4 / 8 / 12 / 16 / 24 px |

Die Verdichtung erfolgt vor allem durch weniger Container, doppelte Informationen und Padding. Lesbarkeit, Fokusmarkierungen und zuverlässige Klickziele bleiben Abnahmekriterien.

## 4. Zielabläufe

### Bestehende Verbindung starten

Heute: Verbindung auswählen → Editor erscheint → „SSH verbinden“ → zurück zum Terminal.

Ziel: Verbindung suchen → Doppelklick oder Enter → neuer Tab im fokussierten Bereich. Einfachklick startet keine Netzwerkaktion. Mehrere Sessions derselben Verbindung bleiben möglich und eindeutig benannt.

### Neue Verbindung anlegen

Ziel: „Neu“ → Name, Host, Benutzer und Anmeldung ausfüllen → „Speichern und verbinden“. Kommentar, Tags und Farbe stehen unter „Weitere Angaben“. Vor dem SSH-Start muss das verschlüsselte Speichern erfolgreich abgeschlossen sein. Alternativ bleibt „Nur speichern“ verfügbar.

### Verbindung bearbeiten

Ziel: Kontextmenü → „Bearbeiten“ → Änderung → „Speichern“. Laufende Terminals bleiben verbunden. Wechsel zu einem anderen Datensatz erhält den Entwurf oder bietet Speichern/Verwerfen/Abbrechen. Eine Speicherfehlermeldung lässt alle Eingaben bestehen.

### Terminals anordnen

Ziel: Tab greifen → klarer Zielbereich erscheint → Rand teilt, Mitte fügt den Tab hinzu → Loslassen übernimmt. Ein dadurch leerer Quellbereich wird entfernt. Escape stellt das vorherige Layout wieder her. Die Trennlinie verändert direkt die Größe.

Tab-Wechsel, Ziehen und Vergrößern müssen dieselben Session- und Terminalinstanzen erhalten. Ein bewusstes Wiederöffnen eines gespeicherten Workspace startet dagegen neue SSH-Sessions.

### Workspace speichern und wechseln

Ziel: Kopfzeile zeigt „Ungespeicherter Workspace“ beziehungsweise Namen und Änderungsstatus. „Speichern“ aktualisiert den aktiven Workspace; beim ersten Speichern wird ein Name abgefragt. „Speichern unter“ erstellt eine weitere Definition. Wechseln erklärt bei laufenden Sessions konkret, welche beendet und neu geöffnet werden.

### Vault wieder öffnen

Ziel: Kompakte Dateiauswahl → Passwort → Arbeitsfläche. Optional später: zuletzt verwendete Vault-Dateien als Schnellzugriff. Dafür werden nur benötigte Dateiverweise gespeichert; Entsperren bleibt eine ausdrückliche Aktion.

## 5. Umsetzung in sechs überprüfbaren Schritten

| Schritt | Lieferumfang | Aufwand relativ | Abnahme |
|---|---|---|---|
| 1. Gemeinsame Größen und Controls | CSS-Tokens für Abstände, Schrift, Farben, Höhe und Radius; einheitliche Button-, Input-, Select- und Fokuszustände. | Klein–mittel | Alle Standardcontrols folgen dem Maßsystem; keine unlesbar kleinen Beschriftungen. |
| 2. Kompakter App-Rahmen | Gemeinsame Kopfzeile, kompakte Statusanzeige, kleinere verstellbare Sidebar, Workspace-Aktionen aus der dauerhaften Sidebar-Fläche entfernen. | Mittel | Im 1280×800-Test erhalten zwei Terminals mindestens 50 % der App-Fläche; Header und Standardaktionen bleiben bei 900×600 erreichbar. |
| 3. Navigation und Editoren | Suche, einklappbare Ordner, direktes Verbinden, gemeinsamer Eigenschaftenbereich, kurze Hauptformulare, Fehler am Feld und Entwurfsschutz. | Mittel–groß | Verbinden ohne Editorumweg; Hauptformular einschließlich Speicheraktionen bei 1280×800 sichtbar; keine verlorenen Entwürfe beim Wechsel. |
| 4. Terminalbereiche und Docking | Tabstreifen je Bereich, schlanke Bereichsköpfe, direkte Split-Handles, leere Quellbereiche zusammenführen, Hilfe kontextuell. | Groß | Verschieben/Skalieren erhält Session-IDs, xterm-Instanzen und Ausgabe; keine leeren Restflächen nach normalem Verschieben; Tastaturalternative vollständig. |
| 5. Workspace-Zustand | Eindeutiger aktiver Workspace, Änderungsanzeige, Speichern/Speichern unter, klare Wechsel- und Schließaktionen. | Mittel | Drag-Layout speichern, sperren, entsperren und identisch wiederherstellen; Fehlerspeicherung erhält zuletzt gültige Definition. |
| 6. Einstieg und Feinschliff | Kompakte Vault-Seiten, bessere Leerzustände, konkrete Bestätigungen, einheitliche Rückmeldungen, abschließende Zugänglichkeits- und Größenprüfung. | Klein–mittel | Erstellen/Öffnen ohne vermeidbares Scrollen; verständliche Fehler; vollständige Tastaturpfade und sichtbarer Fokus. |

Empfohlener Einstieg: Schritte 1 und 2 als erstes gemeinsames Inkrement. Sie adressieren den klobigen Gesamteindruck direkt. Danach Schritt 3 für die täglich wiederholten Abläufe. Die aufwendigere Umstellung der Terminalbereiche folgt auf einem stabilen App-Rahmen.

Die Angaben sind relative Größen, keine zugesagten Zeitaufwände. Schritt 4 hat das größte Regressionsrisiko, weil sichtbare Tab-Zuordnung und bestehender Session-Lebenszyklus zusammenpassen müssen.

## 6. Technische Leitplanken für die Umsetzung

- `styles.css`: gemeinsame Tokens und gezielte Komponentenklassen statt weiterer überlagernder Größenkorrekturen. App-Shell, Formulare und Terminal haben klar getrennte Layoutaufgaben.
- `App.tsx`: App-Rahmen, Sidebar, Eigenschaftenansicht und Workspace-Steuerung schrittweise extrahieren. Zentral bleiben nur die Zustandsübergänge, die mehrere Bereiche koordinieren.
- `VaultTree.tsx`: Auswahl, Aufklappen, Verbinden und Bearbeiten sind getrennte Aktionen. Suchergebnisse zeigen den Ordnerpfad und erhalten eine sinnvolle Tastaturreihenfolge.
- `ConnectionForm.tsx` / `FolderEditor.tsx`: Entwurfszustand und Validierung gezielt strukturieren. Der Dateidialog für Schlüssel wird über eine kleine typisierte Main-/Preload-Methode angebunden.
- `TerminalTabs.tsx` / `SplitTerminalArea.tsx`: Pane-Tabstreifen werden aus `tabIds` gerendert. Laufende `TerminalPanel`-Instanzen behalten stabile Schlüssel und ihren gemeinsamen Mount-Punkt; eine visuelle Verschiebung darf sie nicht in neue React-Eltern umhängen.
- `terminal-layout.ts`: Drop-Operation einschließlich Entfernen leerer Quellbereiche als atomare, pure Transformation berechnen. Vorschau und endgültiger Drop verwenden dieselbe Zielberechnung, damit die Vorschau zutrifft.
- Resize-Grenzen berücksichtigen reale Pixel, Terminal-Mindestmaße und verschachtelte Bereiche. Bei geringer Fläche zuerst Sidebar einklappen oder einen Bereich gezielt maximieren; notwendige Überläufe bewusst gestalten.
- `WorkspaceControls.tsx`: ausgewählte gespeicherte Definition, aktiver Workspace und geändertes Laufzeitlayout als unterschiedliche Zustände behandeln. Eine Auswahl allein darf keine unbemerkte Überschreibentscheidung auslösen.
- Main/Preload bleiben zuständig für Dateizugriff, Verschlüsselung und SSH. Vorhandene Bestätigungen beim Beenden aktiver Sessions sowie Host-Key-Prüfung bleiben Bestandteil der Abläufe.

## 7. Abnahme für das Gesamtvorhaben

1. Größen: 900×600, 1280×800 und ein großes Desktopfenster; zusätzlich 125 % und 150 % Skalierung. Nach dem Gesamtumbau sollen zwei Terminals bei 1280×800 mindestens 60 % der sichtbaren App-Fläche erhalten. App-Chrome bleibt stabil, langes Formular scrollt innerhalb seiner Ansicht, Terminals scrollen ihre Ausgabe.
2. Datenmengen: leerer Vault, etwa 20 und 100 Verbindungen, tiefe Ordner, lange Namen/Adressen; 1, 4 und 16 Sessions; bis zu vier Bereiche.
3. Hauptwege: Vault erstellen/öffnen, Verbindung anlegen und starten, bearbeiten während Sessions laufen, suchen, Ordner verwalten, Workspace speichern/wechseln und Vault sperren.
4. Fehler: Validierung, Speicherfehler, Authentifizierungsfehler, Verbindungsabbruch, fehlende Schlüsseldatei und Abbrechen jeder destruktiven Bestätigung. Meldungen müssen am passenden Ort erscheinen und Eingaben erhalten.
5. Bedienung: vollständige Tastaturwege, sichtbarer Fokus, verständliche Namen für Icon-Aktionen, Escape bei Menüs und Docking, zugeordnete Feldfehler. Kontraste messen; die gesamte UI darf nicht nur durch Farbe kommunizieren.
6. Regression: bestehende Tests für Vault, SSH und Layout ergänzen, soweit neue Zustandsübergänge entstehen. Typecheck und Produktionsbuild; tatsächliche Electron-Prüfung für Fokus, Drag-and-drop, Split-Resize und Session-Erhalt.

Die vorhandenen 92 grünen Tests sind eine gute technische Ausgangslage. Den Platzgewinn und die Bedienqualität beweisen erst die gemessenen und durchgespielten Zielabläufe.

## 8. Umsetzung und Prüfung vom 9. Oktober 2026

Die Oberfläche wurde mit drei Subagenten für Navigation, Formulare und Terminalbereiche umgesetzt und anschließend zentral integriert und geprüft.

- Gemeinsame 44-px-Kopfzeile, 32-px-Buttons und Tabs, 36-px-Eingaben, 13-px-Interface-Schrift. Die dunkle Farbwelt mit Cyan bleibt erhalten.
- Sidebar standardmäßig 240 px, per Maus und Tastatur verstellbar und ausblendbar. Suche nach Metadaten und Ordnerpfaden, einklappbare Ordner, direktes Umbenennen und Verbinden per Doppelklick/Enter.
- Eigenschaften rechts neben den Terminals; bei kleinen Fenstern im Arbeitsbereich. Die Terminals bleiben montiert. Kurzes Hauptformular mit einklappbaren Zusatzangaben, Schlüsseldateiauswahl, Feldfehlern und „Speichern und verbinden“.
- Schutz ungespeicherter Formulare beim Wechsel, Schließen und Sperren: Abbrechen erhält den Entwurf; Verwerfen setzt ihn auch beim erneuten Öffnen desselben Editors zurück. Speicherfehler erhalten die Eingaben.
- Eigene Tabstreifen je Bereich, aktiver Tab wird sichtbar gehalten. Drop-Vorschau, automatische Zusammenführung leer gezogener Quellbereiche, direkt ziehbare Trennlinien mit Tastaturalternative und Maximieren einzelner Bereiche.
- Workspace-Menü in der Kopfzeile, aktiver Name und Änderungsanzeige, Speichern und Speichern unter. Kompakter Einstieg, Statusleiste und Bestätigungen mit Anzahl aktiver Sessions.

### Nachgewiesene Ergebnisse

| Prüfung | Ergebnis |
|---|---|
| Terminalfläche bei 1280 × 800 | 66,6 % der verfügbaren 1264 × 735 px, zuvor ca. 35 %; Ziel von 60 % erreicht |
| Fenster 900 × 600 | Kopfzeile, Terminalbereiche und Editor ohne Überlauf des Dokumentrahmens; Editor besitzt eigenen Scrollbereich und erreichbare Speicheraktionen |
| Vergrößerung | 125 % und 150 % Electron-Zoom ohne Überlauf des Dokumentrahmens geprüft |
| Navigation/Formulare | Anlegen, Speichern und Verbinden, Suche, Feldvalidierung, Abbrechen/Verwerfen beim Wechsel und im selben Editor, Schlüsseldateiauswahl, Ordner umbenennen/einklappen bestanden |
| Fehlerbehandlung | Einmaliger Schreibfehler über den Main-IPC simuliert: Entwurf bleibt bestehen, keine SSH-Session startet; erneutes Speichern und Verbinden erfolgreich |
| Layout | HTML5-Drag-Events einschließlich Vorschau/Drop, Trennlinie per Maus/Tastatur, Doppelklick-Reset und Maximieren bestanden; vorhandene xterm-DOM-Instanzen, SSH-Sessions und Ausgabe erhalten |
| Workspaces | Änderungsanzeige, Speichern, Abbrechen beim Ersetzen, Wiederöffnen sowie verschlüsselte Persistenz nach Sperren/Entsperren bestanden |
| Datenmenge | 100 zusätzliche Verbindungen mit langen Namen und verschachtelten Ordnern; Suche über Host und Vorfahren; 16 Sessions und vier Bereiche; Limit verhindert die 17. Session |
| Automatische Tests | 100 Tests in 16 Dateien bestanden; TypeScript-Prüfung und Produktionsbuild erfolgreich |

Die Electron-Prüfung verwendete ausschließlich einen isolierten synthetischen Vault und einen lokalen SSH-Testserver. Screenshots der integrierten Oberfläche liegen unter `C:\Users\user\AppData\Local\Temp\terminus-tabs-ui-Tf7tVL`; das Prüfszenario unter `C:\Users\user\AppData\Local\Temp\terminus-ui-check\compact-ui.cjs`.

Grenzen der Prüfung: Automatisiertes natives Mausziehen blockierte den Windows-Testtreiber. Die Drop-Verarbeitung wurde daher über HTML5-Drag-Events geprüft; ein manueller Durchlauf des nativen Ziehens bleibt sinnvoll. Eine vollständige Screenreader-Prüfung und Windows-DPI-Wechsel sind nicht durchgeführt; Electron-Zoom ist kein Ersatz für einen DPI-Wechsel. Zuletzt verwendete Vault-Dateien bleiben das bereits als optional markierte spätere Inkrement.
