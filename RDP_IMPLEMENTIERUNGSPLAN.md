# RDP direkt in Terminus

**Umsetzungsplan · 12. Oktober 2026 · Status: Vorschlag, noch nicht umgesetzt**

> Ziel: RDP-Verbindungen wie SSH-Verbindungen verwalten und direkt in den vorhandenen Tabs und geteilten Bereichen verwenden. Dieser Plan beschreibt die Umsetzung; er startet keine Installation und verändert keine Anwendungsfunktionen.

## 1. Ergebnis der geplanten ersten Version

- Verbindungstyp **SSH oder RDP** beim Anlegen auswählen.
- RDP mit Host, Port, Benutzer, optionaler Domäne und Passwort konfigurieren.
- Verbindungen im bestehenden verschlüsselten Vault speichern; Icons und Farben weiterverwenden.
- RDP über Doppelklick, Enter oder das **+** eines Bereichs öffnen.
- Mehrere SSH- und RDP-Sitzungen nebeneinander verwenden.
- RDP-Tabs verschieben, zusammenführen, teilen und maximieren, ohne dadurch neu zu verbinden.
- Auflösungsänderungen, Tastaturfokus und Zwischenablage unterstützen.
- Verbindungen gezielt trennen und nach einem Abbruch erneut verbinden.
- Beim Sperren des Vaults oder Beenden der App sämtliche lokalen Sitzungen und Hilfsprozesse schließen.

**Zielplattform:** zunächst Windows x64. Das Sitzungslimit bleibt insgesamt bei 16, das Layoutlimit bei vier Bereichen. Eine belastbare Aussage zur Leistung von 16 gleichzeitigen RDP-Sitzungen erfordert einen eigenen Test.

**Spätere Erweiterungen:** RD Gateway, RemoteApp, mehrere Remote-Monitore, Audio, Laufwerks-/Drucker-/USB-Weiterleitung, Smartcards, Entra-/Web-Anmeldung, MFA sowie macOS/Linux. Ein vollständiger Ersatz für sämtliche Funktionen etablierter RDP-Clients ist nicht Bestandteil dieser ersten Version.

## 2. Ausgangslage im Projekt

| Bereits vorhanden | Für RDP zu ergänzen |
|---|---|
| Electron, React, TypeScript | Native RDP-Hilfskomponente |
| Verschlüsselte Vaults mit Session-Key | Protokollabhängige Verbindungsdaten und Formatmigration |
| SSH-Sitzungsverwaltung mit Besitzerprüfung | RDP-Sitzungsverwaltung und gemeinsames Sitzungslimit |
| Tabs, Suche, Icons, Farben, Verbindungsauswahl | RDP-Formular und Protokollkennzeichnung |
| Drag-and-drop, Split-Layout, Maximieren | Positionierung und Sichtbarkeit nativer RDP-Flächen |
| Workspace-Speicherung | Wiederherstellung gemischter SSH-/RDP-Workspaces |
| Unit-Tests und Electron-Prüfszenarien | Native Windows- und echte RDP-Integrationstests |

**Lokal geprüft:** `mstscax.dll` ist vorhanden. `dotnet` und .NET-Laufzeiten sind vorhanden; `dotnet --list-sdks` meldet derzeit kein SDK. Das passende SDK muss vor der Umsetzung bereitgestellt werden. Die Existenz der DLL beweist noch keine erfolgreiche COM-Aktivierung. Ein erreichbarer RDP-Testrechner und Testzugang wurden nicht geprüft.

## 3. Architekturvorschlag

**Empfehlung für den Prototyp:** kleine C#-/WinForms-Hilfskomponente mit Microsofts RDP-ActiveX-Control. Electron bleibt für Navigation, Vault und Layout zuständig. Der Helfer übernimmt die native RDP-Darstellung und Eingabe.

```text
React: Formulare, Tabs, Layout, RDP-Platzhalter
                    │ typisierte IPC-Aufrufe
                    ▼
Electron Main: Vault, Besitzerprüfung, Sitzungsverwaltung
                    │ private Prozess-Pipes
                    ▼
Terminus.RdpHost.exe: STA-Thread, COM-Control, native Fenster
                    │ RDP / NLA
                    ▼
                 Zielserver
```

Geplante Verantwortlichkeiten:

1. **Renderer:** sendet Verbindungs-ID, Zielbereich, Sichtbarkeit und Geometrie. Der RDP-Anzeigekomponente werden keine Passwörter übergeben.
2. **Main:** prüft Anfragen, liest gespeicherte Zugangsdaten aus dem entsperrten Vault und verwaltet den Helfer.
3. **Helfer:** erzeugt das Control, verbindet, verarbeitet native Eingaben und meldet Zustandsänderungen zurück.
4. **Transport:** gerahmte Nachrichten über private stdin/stdout-Pipes; stderr ausschließlich für bereinigte Diagnoseausgaben. Keine Passwörter in Prozessargumenten, Umgebungsvariablen oder temporären Dateien.
5. **Prozessmodell:** zunächst ein Helfer je App-Fenster mit mehreren Controls. Ein Helferabsturz betrifft dessen RDP-Sitzungen; SSH bleibt unabhängig. Diese Grenze muss in der Oberfläche verständlich behandelt werden.
6. **Gekoppelte Eingabeverarbeitung:** Wird ein Fenster des Helfers per `SetParent` zum Kind des Electron-Fensters, koppelt Windows die Eingabewarteschlangen beider Threads. Blockiert der Helfer-UI-Thread (COM-Aufruf, modaler Dialog, Hänger), kann dadurch auch das Terminus-Fenster einfrieren – inklusive SSH. „SSH bleibt unabhängig“ gilt dann nur bei einem Absturz, nicht bei einem Hänger. Siehe Varianten in Abschnitt 4.

Die technische Grundlage ist dokumentiert: Windows Forms bietet ActiveX-Hosting über [AxHost](https://learn.microsoft.com/en-us/dotnet/api/system.windows.forms.axhost?view=net-10.0), Microsoft stellt [RDP-Control-Schnittstellen](https://learn.microsoft.com/en-us/windows/win32/termserv/imsrdpclient9) bereit und Electron liefert über [getNativeWindowHandle](https://www.electronjs.org/docs/latest/api/base-window#wingetnativewindowhandle) das native Fensterhandle. **Die Kombination in unserer App ist ein zu prüfender Architekturvorschlag, keine bereits nachgewiesene Integration.**

## 4. Zuerst den schwierigsten Teil prüfen

Der erste Meilenstein ist eine echte RDP-Sitzung innerhalb des Terminus-Fensters. Er muss außerdem die folgenden Fragen beantworten:

| Problem | Geplanter Ansatz | Abnahme |
|---|---|---|
| Native Fläche liegt außerhalb des DOM | Native Child-Fläche an ein geprüftes Fensterhandle binden; Tab-Leiste bleibt React | RDP bleibt exakt innerhalb des vorgesehenen Bereichs |
| HTML-Menüs können hinter nativen Flächen liegen | Betroffene RDP-Flächen während Dialogen, Popovers und Drag-Vorschau vorübergehend ausblenden; Sitzung erhalten | +, Workspace-Menü, Bestätigungen und Drop-Vorschau bleiben sichtbar und bedienbar |
| Native Eingabe erreicht React nicht automatisch | Fokuswechsel ausdrücklich koordinieren; während Tab-Drag native Flächen rechtzeitig ausblenden | Mehrfaches Ziehen funktioniert auch über RDP-Bereichen |
| DPI und Electron-Zoom verwenden unterschiedliche Koordinaten | CSS-Pixel, Fensterkoordinaten und native Pixel zentral umrechnen | Keine Versätze bei 100/125/150 % und Monitorwechsel |
| Versteckte Sitzung soll weiterlaufen | Sichtbarkeit und Verbindung getrennt verwalten | Tabwechsel und Maximieren lösen keinen Neuaufbau aus |

| Hängender Helfer friert Terminus ein | Varianten A und B vergleichen (siehe unten); Hänger gezielt simulieren | Bei blockiertem Helfer bleibt die Electron-Oberfläche bedienbar oder das Verhalten ist dokumentiert und begrenzt |

Microsoft dokumentiert besondere DPI-Einschränkungen bei prozessübergreifendem [SetParent](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setparent). Deshalb wird dieser Teil **vor** Formularen, Migration und umfangreichen Umbauten getestet.

**Im Prototyp zu vergleichende Einbettungsvarianten:**

| Variante | Vorteil | Nachteil |
|---|---|---|
| **A – Kindfenster** (`SetParent` an das Electron-Fenster) | Fensterbewegung, Minimieren und Z-Reihenfolge übernimmt Windows | Gekoppelte Eingabewarteschlangen; DPI-Einschränkungen prozessübergreifend |
| **B – eigenes, Electron gehörendes Fenster** (Owner = Electron-Fenster, ohne Rahmen) | Eingabeverarbeitung bleibt getrennt; Hänger des Helfers friert Terminus nicht ein | Position bei Fensterbewegung, Monitorwechsel und Minimieren selbst nachführen; mögliches sichtbares Nachziehen |

**Entscheidung nach dem Prototyp:** Sind Darstellung, Fokus, Vorschau und Skalierung tragfähig, folgt die Integration. Bei grundlegenden Problemen wird der Ansatz neu bewertet.

Alternativen bei einem Scheitern des nativen Ansatzes:

- **Canvas-basierter RDP-Client** (z. B. IronRDP oder FreeRDP mit eigener Bildübertragung): Die Darstellung liegt im DOM. Overlay-, Drag-, DPI- und Zoomprobleme aus der Tabelle oben entfallen weitgehend. Dafür sind Leistung, NLA/CredSSP-Unterstützung, Eingabeabbildung und Zwischenablage selbst zu prüfen; ungeprüft, nur als Option vorgemerkt.
- **FreeRDP als nativer Client** mit eigenem Einbettungsaufwand.
- Ein separates mstsc-Fenster erfüllt das Ziel „RDP im Tab“ nicht und ersetzt es nicht stillschweigend.

## 5. Arbeitspakete und Zeitschätzung

Die Zeiten gelten für aktive Entwicklung mit Coding-Assistent, funktionierender Windows-Umgebung und verfügbarem Testserver. Sie sind Planungswerte, keine garantierten Laufzeiten. Installationswartezeiten, fehlende Zugänge und zusätzliche Produktwünsche sind nicht enthalten.

| Paket | Konkrete Arbeiten | Ergebnis / Abnahme | Ansatz |
|---|---|---|---:|
| **P1 – Voraussetzungen** | SDK bereitstellen, x64-Build festlegen, COM-Aktivierung prüfen, Testverbindung mit Windows-Client verifizieren | Reproduzierbar baubares Grundprojekt und geeigneter Testserver | 30–60 Min. |
| **P2 – Nativer RDP-Prototyp** | STA-Thread, ActiveX-Host, Connect/Disconnect, Benutzer/Domäne/Passwort, Statusereignisse | Echte interaktive RDP-Sitzung im Helfer | 45–90 Min. |
| **P3 – Einbettung** | Native Fläche an Electron anbinden, private Prozesskommunikation, Bounds, Fokus, Aus-/Einblenden; Overlay- und DPI-Risiken prüfen | Eingebettete Sitzung; dokumentierte Architekturentscheidung | 60–120 Min. |
| **P4 – Datenmodell und Formular** | SSH/RDP-Union, Validatoren, Altformatmigration, RDP-Felder, Icons/Farben und Protokollanzeige | RDP-Verbindung anlegen, bearbeiten und verschlüsselt wieder öffnen | 30–60 Min. |
| **P5 – Sitzungsverwaltung** | RDP-Manager, Besitzerprüfung, gemeinsames Limit, Status, Tabs, Schließen und Vault-Sperre | Mehrere gemischte Sitzungen mit zuverlässigem Cleanup | 30–60 Min. |
| **P6 – Eingabe und Anzeige** | Zwischenablage, Sondertasten, Fokuswechsel, dynamische Auflösung, Fehleranzeige | RDP lässt sich im Alltag bedienen | 45–90 Min. |
| **P7 – Docking und Workspaces** | Geometriesynchronisierung, native Sichtbarkeit bei Overlays (`ConfirmDialog`, `ConnectionPicker`, Layoutmenü, Drop-Vorschau, Editoransicht), wiederholtes Verschieben, Maximieren, gemischte Workspace-Wiederherstellung | Bestehender Terminus-Ablauf funktioniert mit RDP | 2–5 Std. |
| **P8 – Tests und Fehlerfälle** | Migration, IPC, Cleanup, falsche Anmeldung, Zertifikate, Netzwerkabbruch, Helferabsturz, SSH-Regressionen | Abnahmematrix bestanden und bekannte Grenzen dokumentiert | 1½–3 Std. |
| **P9 – Build und Auslieferung** | Helfer publizieren, Artefaktpfade für Dev/Build, Runtime-Strategie, Prüfung auf zweitem Rechner | Start außerhalb der Entwicklungsumgebung funktioniert | 30–90 Min. |

**Summe ohne Reserve: ca. 9–18 Stunden; realistisch eher 3–5 Arbeitstage. Prototyp P1–P3: ca. 2–5 Stunden.** Die niedrigen Werte setzen einen günstigen Verlauf voraus. Besonders P4, P7 und P9 können mehr Aufwand benötigen. Für Interop-, DPI-, Fokus- und Auslieferungsprobleme sind **zusätzlich 4–12 Stunden Reserve** sinnvoll. Nach P3 werden die übrigen Pakete anhand tatsächlicher Ergebnisse neu geschätzt.

Abhängigkeiten: `P1 → P2 → P3 → P4 → P5 → P6/P7 → P8 → P9`. Tests für ein Paket entstehen während seiner Umsetzung; P8 bündelt die abschließende Integration. Die Reserve wird nicht automatisch verbraucht.

## 6. Datenmodell und sichere Migration

### Vorgeschlagenes Modell

Gemeinsame Felder bleiben: ID, Name, Kommentar, Host, Port, Benutzer, Tags, Icon und Farbe.

```ts
type ConnectionNode = SshConnectionNode | RdpConnectionNode;

// SSH: protocol: 'ssh'; bestehende SSH-Authentifizierung.
// RDP: protocol: 'rdp'; passwordbasierte Anmeldung und RDP-Optionen.
interface RdpOptions {
  domain?: string;
  clipboard: boolean;
  display: 'dynamic' | 'fixed';
  width?: number;
  height?: number;
}
```

- SSH-Port standardmäßig 22, RDP-Port 3389; Port immer zwischen 1 und 65535 validieren.
- RDP erhält keine SSH-Agent- oder Schlüsseldateifelder.
- Anmeldung mit separater Domäne, `DOMAIN\\Benutzer` oder UPN eindeutig normalisieren; widersprüchliche Angaben am Feld erklären.
- Protokollwechsel bei einer bestehenden gespeicherten Verbindung zunächst nicht anbieten. Eine neue Verbindung vermeidet Konflikte mit laufenden Sitzungen.
- RDP-Start löst Zugangsdaten im Main-Prozess über die Verbindungs-ID auf. Bereits laufende Sitzungen behalten ihre Startkonfiguration; Metadaten wie Icon/Farbe dürfen sofort aktualisiert werden.

### Formatentscheidung

**Empfehlung: Vault-Inhalt auf Version 2 anheben, verschlüsselten Dateiumschlag auf Version 1 belassen.** Die vorhandene Verschlüsselung und deren AAD müssen dafür nicht geändert werden.

1. Bestehende v1-Dateien entschlüsseln und mit dem bisherigen Schema validieren.
2. Im Speicher jeder bisherigen Verbindung `protocol: 'ssh'` zuordnen und in das kanonische v2-Modell überführen.
3. IDs, Ordner, Icons, Farben, Zugangsdaten und Workspace-Referenzen unverändert übernehmen.
4. Beim Öffnen allein keine Datei überschreiben.
5. Vor dem ersten Speichern als v2 eine eindeutig benannte **verschlüsselte** Sicherung der ursprünglichen Datei erzeugen. Bestehende Sicherungen nicht überschreiben.
6. Schlägt Sicherung oder Speichern fehl, bleibt die Originaldatei erhalten und die Änderung gilt nicht als gespeichert.
7. Unbekannte Versionen verständlich ablehnen. Ältere Terminus-Versionen dürfen RDP-Daten nicht als SSH interpretieren oder beim Speichern stillschweigend entfernen. Für bestehende Versionen ist das bereits erfüllt: `VaultSchema` akzeptiert nur `version: 1` und lehnt eine v2-Datei beim Öffnen ab.

Die Migration gehört in `decryptVault` (`src/main/vault/crypto.ts`) zwischen `JSON.parse` und Schemaprüfung: Version lesen, bei v1 mit dem v1-Schema prüfen und migrieren, danach mit dem v2-Schema validieren.

Die Formatumstellung benötigt Tests für erfolgreiche Migration, alte SSH-Anmeldungen, verschachtelte Ordner, Workspaces, fehlgeschlagene Schreibvorgänge und Wiederherstellung aus der Sicherung.

## 7. Sitzungs- und Prozessverhalten

### Zustände

```text
vorbereitet → verbindet → verbunden → getrennt
                    ↘ Fehler        ↘ Fehler
getrennt / Fehler → ausdrücklich erneut verbinden
jeder Zustand → schließen → Ressourcen freigeben
```

- Tab-ID und native Sitzungs-ID bleiben über alle Layoutänderungen stabil.
- Wiederverbinden nach einem Abbruch erstellt einen neuen Verbindungsversuch; kein endloser automatischer Retry.
- Gemeinsames Limit von 16 Sitzungen im Main durchsetzen, einschließlich reservierter/verbindender Sitzungen. Ein zusätzliches unabhängiges RDP-Limit darf das Gesamtlimit nicht verdoppeln.
- Helfer mit festem aufgelöstem Pfad und ohne Shell starten. Protokollversion und unterstützte Fähigkeiten beim Start austauschen.
- Nachrichten erhalten Request-ID, Sitzungs-ID und bei Geometrieänderungen eine fortlaufende Revision. Veraltete Positionsupdates ignorieren.
- Nachrichtenlängen, Parameter und Besitzer prüfen; unvollständige Pipe-Nachrichten und Prozessabbruch behandeln.
- Fensterhandle ausschließlich im Main ermitteln und verlustfrei übertragen, nicht als ungenaue JavaScript-Zahl aus dem Renderer entgegennehmen.
- Jeder Start hat ein Timeout. Jeder Schließpfad ist mehrfach aufrufbar und beendet nur die zugehörige Sitzung.
- App-Ende, Renderer-Ausfall, Vault-Sperre, Verbindungs-/Ordnerlöschung und Workspace-Ersetzung müssen auch RDP berücksichtigen.
- Bei Pipe-Ende oder Tod des Hauptprozesses beendet sich der Helfer; zusätzlich ein getesteter Prozess-Cleanup, damit kein Remote-Fenster zurückbleibt.

## 8. Darstellung, Docking und Fokus

Die native RDP-Fläche ersetzt nur den Inhalt des Bereichs. Tabname, ×, +, Status und Layoutaktionen bleiben Bestandteile der vorhandenen Oberfläche.

- Eine `RdpPanel`-Komponente meldet das sichtbare Inhaltsrechteck unterhalb der Tab-Leiste.
- Geometrieänderungen bündeln; die Endposition einer Größenänderung zuverlässig übertragen.
- Versteckte Tabs behalten ihre Verbindung, ihre native Fläche wird verborgen.
- Beim Öffnen von Dialogen, Verbindungsauswahl oder Workspace-Menüs dürfen native Flächen keine Bedienelemente verdecken.
- Beim Drag-Start native Flächen rechtzeitig verbergen, damit Zeigerereignisse und Vorschau in Electron funktionieren. Anschließend dieselben Controls an der neuen Position einblenden.
- Für vorübergehend verdeckte Flächen genügt zunächst ein neutraler Platzhalter. Keine Remote-Screenshots dauerhaft speichern.
- Minimieren, Wiederherstellen, Fensterbewegung, Monitorwechsel, Sidebar-Resize und Editoröffnung berücksichtigen.
- Fokus in RDP über native Mechanismen setzen; aus RDP heraus müssen Tab-Leiste und App-Aktionen wieder erreichbar sein.
- Alt+Tab bleibt zunächst lokal; normale Eingaben gehen an den aktiven Remote-Desktop. Die tatsächlich unterstützten Einstellungen im Prototyp prüfen.
- Eine Aktion für die Remote-Sicherheitssequenz vorsehen und die unterstützte Control-Funktion testen; keine globale Tastaturüberwachung als Standardlösung.

**Wichtig für die Prüfung:** Ein Chromium-/Playwright-Screenshot beweist nicht, dass eine native Child-Fläche korrekt sichtbar ist. Für diesen Teil sind Windows-Fensteraufnahmen und tatsächliche native Eingabetests notwendig.

## 9. Anmeldung, Zertifikate und Zwischenablage

- CredSSP/NLA aktivieren; keine automatische Abschwächung bei Anmeldefehlern. Microsoft beschreibt die Steuerung über [EnableCredSspSupport](https://learn.microsoft.com/en-us/windows/win32/termserv/imsrdpclientadvancedsettings6-enablecredsspsupport).
- Serverauthentifizierung beibehalten. Zertifikatsfehler müssen sichtbar behandelt werden, nicht automatisch akzeptiert. Die mögliche Verwendung eines nativen Bestätigungsdialogs wird im Prototyp geprüft; ohne verlässlichen Dialog wird die Verbindung abgebrochen. [AuthenticationLevel](https://learn.microsoft.com/en-us/windows/win32/termserv/imsrdpclientadvancedsettings4-authenticationlevel) unterscheidet erforderliche Authentifizierung, Rückfrage und abgeschaltete Prüfung.
- RDP-Zertifikatsvertrauen nicht mit der bestehenden SSH-Host-Key-Datei vermischen.
- Passwörter im bestehenden verschlüsselten Vault speichern, nur für den Start an den Helfer geben und dort möglichst kurz halten. Vollständige Löschung aller String-/COM-Kopien im Speicher nicht versprechen.
- Keine automatische Ablage im Windows-Anmeldeinformationsmanager.
- Zwischenablage-Weiterleitung pro Verbindung ein-/ausschaltbar machen; erster Standard: eingeschaltet. Serverrichtlinien können sie begrenzen. Grundlage ist [RedirectClipboard](https://learn.microsoft.com/en-us/windows/win32/termserv/imsrdpclientadvancedsettings5-redirectclipboard).
- **RDP behält die normale Windows-Bedienung:** Rechtsklick öffnet das Remote-Kontextmenü. Das bestehende „Markieren kopiert, Rechtsklick fügt ein“ bleibt eine SSH-Terminalfunktion und wird nicht auf die gesamte Remote-Oberfläche übertragen.
- Datei-/Geräteweiterleitung bleibt in der ersten Version ausgeschaltet. Texttransfer in beide Richtungen ausdrücklich testen; keine reine Textbeschränkung behaupten, falls das Control weitere Clipboard-Formate überträgt.

## 10. Geplante Dateien und Änderungen

Die Namen neuer Dateien sind Vorschläge. Bestehende Dateien bleiben Ausgangspunkt; keine vollständige Neuschreibung des SSH-Clients.

| Bereich | Dateien / Aufgaben |
|---|---|
| Native Komponente | Neu: `native/Terminus.RdpHost/` mit Projektdatei, STA-Einstieg, RDP-Control, Nachrichtenprotokoll, Fenster-/DPI-Verwaltung und Lifecycle |
| Gemeinsames Modell | `src/shared/vault/types.ts`, `schema.ts`; neu: `migrations.ts` und Tests |
| RDP-Verträge | Neu: `src/shared/rdp.ts` für validierbare Requests, Status und Fähigkeiten |
| Main-Prozess | Neu: `src/main/rdp/host.ts`, `session.ts`, `ipc.ts`, `validation.ts` plus Tests |
| Gemeinsamer Lifecycle | `src/main/index.ts`; gemeinsames Sitzungslimit und Close-/Lock-Pfade für SSH/RDP |
| SSH-Abgrenzung | `src/main/ssh/session.ts` und IPC: ausdrücklich nur SSH-Verbindungen akzeptieren |
| Vault-Persistenz | `src/main/vault/crypto.ts`, `storage.ts`, `session.ts`: Versionsmigration, verschlüsselte Sicherung und Fehlerrücknahme |
| Preload | `src/shared/ipc.ts`, `src/preload/index.ts`: eng begrenzte RDP-Methoden und bereinigte Events |
| Verbindungseditor | `ConnectionForm.tsx`, `connection-form.ts`: Protokollwahl und RDP-Felder; gemeinsame Metadaten erhalten |
| Sitzungsanzeige | Neu: `RdpPanel.tsx`; `SplitTerminalArea.tsx`: passendes Panel auswählen und native Flächen koordinieren |
| Tabs und Workspaces | `terminal-tabs.ts`, `terminal-layout.ts`, zugehörige Hooks und `App.tsx`: Protokollinformation, gemischte Wiederherstellung, generische Beschriftungen |
| Native Sichtbarkeit | Neu: zentrale Koordination, z. B. `useNativeSurfaceVisibility.ts`; Anbindung an Dialoge, Popovers, Editor und Drag-Start |
| Build und Dokumentation | `package.json`, Build-Skripte, ggf. Packaging-Konfiguration, README und eigener RDP-Testleitfaden |

## 11. Abnahmematrix

| Test | Muss erfüllt sein |
|---|---|
| Alte Vault-Datei öffnen | Alle bisherigen SSH-Daten, Icons/Farben und Workspaces bleiben vorhanden |
| Migration und Schreibfehler | Sicherung vorhanden; Original bei Fehlschlag unverändert; kein falscher Erfolgshinweis |
| RDP speichern und neu öffnen | Host, Port, Benutzer, Domäne und Einstellungen korrekt wiederhergestellt |
| Falsches Passwort / unerreichbarer Host | Verständlicher Fehler im betroffenen Tab; App bleibt bedienbar |
| Zertifikatsproblem / Abbrechen | Keine stillschweigende Vertrauensentscheidung oder verdeckte Rückfrage |
| Zwei RDP-Sitzungen und SSH parallel | Eingabe erreicht jeweils nur die gewählte Sitzung |
| Tab über + in anderem Bereich öffnen | Neue Sitzung landet zuverlässig im gewählten Bereich |
| Zwanzig Layoutwechsel | Kein Neuaufbau, keine verwaisten Fenster, keine verloren gegangene Sitzung |
| Menüs, Dialoge und Drag-Vorschau | Native Flächen verdecken keine Bedienelemente |
| Kleine Fenster und Skalierung | 900×600, 1280×800, Electron-Zoom sowie Windows-DPI 100/125/150 % geprüft |
| Monitorwechsel / Minimieren | Position, Größe, Sichtbarkeit und Fokus werden korrekt wiederhergestellt |
| Clipboard ein / aus | Texttransfer in beide Richtungen nur gemäß Verbindungseinstellung und Serverrichtlinie |
| Netzwerkunterbrechung | Fehlerzustand und gezieltes Wiederverbinden ohne doppelte Prozesse |
| Helferabsturz | RDP-Tabs erhalten Fehlerstatus, SSH läuft weiter, erneuter Start möglich |
| Vault sperren / App schließen | Alle zugehörigen Sitzungen beendet; kein übrig gebliebener Helfer |
| Gemischten Workspace wiederherstellen | Protokolle, Bereiche, Größen und aktive Verbindungen stimmen |
| Sitzungslimit | 17. Sitzung wird auch bei konkurrierenden Starts verhindert |
| Zweiter Windows-Rechner | Auslieferung startet ohne SDK oder Entwicklungsverzeichnis |

Unit-Tests decken Migration, Validierung, Routing, Besitzergrenzen, Budget und Lifecycle ab. Echte RDP-Tests benötigen einen dafür freigegebenen Testserver; produktive Sitzungen sind kein Testmaterial. Fehlende Testumgebung wird im Abnahmebericht ausdrücklich als offen vermerkt.

## 12. Build, Auslieferung und Abschluss

- SDK-Version und NuGet-Abhängigkeiten festlegen; native Builds reproduzierbar machen.
- ActiveX-Interop so integrieren, dass ein Build keine manuell angeklickte Visual-Studio-Konfiguration voraussetzt. Die `dotnet`-CLI unterstützt keine `COMReference`-Einträge (Task `ResolveComReference` fehlt in der .NET-Variante von MSBuild). Deshalb die benötigten RDP-Schnittstellen per `[ComImport]` selbst deklarieren und das Control über eine eigene `AxHost`-Ableitung mit fester CLSID erzeugen. Damit genügt das .NET SDK; Visual Studio ist nicht erforderlich.
- Für die erste Auslieferung einen self-contained x64-Helfer prüfen; dadurch ist kein installiertes .NET-SDK beim Anwender erforderlich. Windows-RDP-Komponenten bleiben eine Voraussetzung.
- Den Helfer außerhalb eines möglichen ASAR-Archivs als ausführbare Ressource mitliefern. Dev- und Produktionspfade getrennt testen.
- Die aktuelle `package.json` enthält einen Produktionsbuild, aber noch keinen Installer-/Distributionsschritt. Ein vollständiger Installer ist gegebenenfalls ein zusätzliches Paket; P9 verspricht zunächst ein lauffähiges gebündeltes Artefakt.
- Fehlendes oder inkompatibles RDP-Control verständlich melden. SSH bleibt nutzbar.
- Prüfen, welche Interop-Artefakte mitgeliefert werden dürfen; die Windows-System-DLL nicht ungeprüft kopieren. Öffentliche Veröffentlichung und Signierung gesondert planen.
- Abschluss umfasst grüne TypeScript-/Unit-/Build-Prüfungen, dokumentierte native Abnahme und aktualisierte Bedienungsanleitung.

## 13. Startpunkt für eine spätere Umsetzung

- [ ] Windows-only und der Umfang aus Abschnitt 1 sind die Arbeitsgrundlage.
- [ ] Geeigneter RDP-Testserver und Testzugang sind verfügbar.
- [ ] Passendes SDK ist vorhanden oder wird bereitgestellt.
- [ ] P1–P3 werden zuerst umgesetzt und demonstriert.
- [ ] Danach werden Einbettungsansatz und verbleibender Aufwand anhand der Ergebnisse bestätigt.
- [ ] Erst anschließend folgen Formatmigration, vollständige UI-Anbindung und Auslieferung.

**Nächster konkreter Meilenstein:** Eine echte RDP-Sitzung in einem Terminus-Bereich, bei der Resize, Fokuswechsel und ein darüber geöffnetes Menü nachweislich funktionieren. Bis dahin bleibt dieser Plan die vorbereitete Arbeitsgrundlage.
