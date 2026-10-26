# Import und Update-Hinweis – Review (Stufe 7)

Geprüft wurde Branch `claude/feature/import-update` gegen `claude/feature/terminal-komfort`: 11 Commits, 52 Dateien. Grundlage sind die Spec `2026-10-24-import-update-design.md`, der bindende Anhang `…-validation.md` (R-A bis R-D, V1–V8) und das Ledger `.superpowers/sdd/2026-10-24-import-update/progress.md`.

**Urteil: ready after fixes.** 0 Critical, 2 Important, 7 Minor.

Gates: `npm run typecheck` grün, `npx vitest run` grün (151 Dateien, 2299 Tests). Die echte App hat der Orchestrator parallel geprüft (Ledger „run-app Runde 1“). Zusätzlich habe ich die Regex-Laufzeiten der Parser mit Node 24 (V8, wie in Electron) gemessen, siehe I1 und I2.

## 1. Sicherheit

| Punkt | Befund |
|---|---|
| Passwörter | **OpenSSH:** Es gibt keine Passwortfelder. **WinSCP:** Die Whitelist `WANTED` (`import-winscp.ts:6`) enthält `Password` und `TunnelPassword` nicht, beide landen also nicht in der Map. **mRemoteNG:** `READ` (`import-mremoteng.ts:10`) liest nur die benannten Attribute, `Password` wird nie dekodiert. **PuTTY:** `parseRegSections` legt alle String- und Dword-Werte eines Abschnitts in eine Map, darunter `ProxyPassword`. Sie verlässt den Parser nicht und erreicht weder Kandidat noch Renderer, siehe **M4**. In Fehlern und Logs taucht nichts auf, denn es gibt kein `console.*` im Importpfad. Der rohe Quelltext liegt beim Parsen zwangsläufig im Speicher. i.O. |
| Schlüssel- und Include-Dateien | `keyPath` wird nur als Text übernommen. `Include` zählt nur `include`+1 und wird nie geöffnet (`import-openssh.ts:145-146`). Geöffnet werden ausschließlich die im Dialog gewählte Datei, der Testhaken oder die eigene Temp-Datei. i.O. |
| `reg.exe` | Aufruf über `execFile` (keine Shell) mit festem Programm `%SystemRoot%\System32\reg.exe` und festen Argumenten `export <PUTTY_KEY oder WINSCP_KEY> <tmp> /y`, Zeitlimit 10 s, `windowsHide` (`import-source.ts:46,116`). Es gibt genau zwei HKCU-Schlüssel und keinen Schreibzugriff auf die Registry. Die Temp-Datei liegt in einem eigenen `mkdtemp`-Verzeichnis. Das `rm` im `finally` läuft auch bei Fehlern und bei frühem `return` (`import-source.ts:121-124`). Bleibt ein Rest: Bei einem harten Prozessabbruch zwischen Export und `rm` bleibt der Export samt WinSCP-Passwort-Verschleierung in `%TEMP%` liegen. Das ist bei R3 bewusst in Kauf genommen und nur für den Benutzer selbst lesbar. i.O. |
| Testhaken | `SHELLHERD_PUTTY_REG_FILE`/`SHELLHERD_WINSCP_REG_FILE` lassen Main eine beliebige Datei lesen, die der Benutzer ohnehin lesen darf. Der Renderer sieht davon nur die geparsten Kandidaten. Wer die Umgebung des Prozesses setzt, gewinnt damit nichts, was er nicht schon hat (das gilt genauso für `SystemRoot`, den Pfad zu `reg.exe`). Das Risiko ist also vertretbar wie bei `SHELLHERD_RDP_MODE`. `SHELLHERD_UPDATE_URL` lässt sich mit `http://127.0.0.1:@host/` umgehen, siehe **M3**. Die Folgen bleiben klein, weil die Release-URL lokal gebaut wird. |
| Renderer-Grenze | `importRead` liefert nur `ImportPreview` (Kandidaten, Skip-Zähler, gewählter Dateipfad), `update*` nur `UpdateStatus`. Der Renderer kann keinen Pfad zum Öffnen übergeben, denn `source` wird mit `z.enum` geprüft (`index.ts:350`). i.O. |
| Schema der importierten Knoten | `buildImportNodes` prüft jeden Knoten gegen `Ssh/Sftp/RdpConnectionNodeSchema`, dazu Host und Ordnersegmente (`import.ts:307-314`). Beim Speichern prüft Main über `persistVault` zusätzlich wie bisher. RDP-Knoten bekommen nie `password`. i.O. |
| Update-Abruf | Abgerufen wird nur bei `enabled && isUnlocked() && updateDue` (`update-check.ts:77`), mit `AbortSignal.timeout(5000)`. Die Größengrenze von 1 MiB greift erst nach dem vollen Lesen; das ist als shortcut markiert und im Ledger akzeptiert. Die Antwort von api.github.com über TLS ist vertrauenswürdig. Gespeichert werden nur Versionen im Format `x.y.z`, und `releaseUrl` baut die URL lokal. Den Link öffnet `openExternal` über den bestehenden Handler mit `requireSshSender`, `getSnapshot` und `webLinkHref`. Netzabruf über `net.fetch` (System-Proxy). i.O. |
| IPC-Absender | `import:read` und alle drei `app:update-*` laufen über `windowRegistry.requireMain(event)`. `import:read` verlangt zusätzlich einen entsperrten Vault (`getSnapshot`). Die Argumente prüft zod (enum, boolean, Versions-Regex). i.O. |

## 2. Issues

### Important

**I1 – mRemoteNG: Regex-Scan mit quadratischer Laufzeit friert den Main-Prozess ein.** `src/shared/import-mremoteng.ts:6-8` (`NODE_TAG`, `ROOT_TAG`, `ATTR`), aufgerufen synchron in `src/main/import-source.ts:67`.
- Scheitert `<Node\b([^>]*?)(\/?)>` an einer Startposition, läuft der Versuch bis zum nächsten `>`. Ohne `>` ist das das Dateiende. Viele `<Node`-Anfänge ohne `>` kosten deshalb O(n²). Dasselbe gilt für `<Connections\b([^>]*)>`.
- `(\w+)="` setzt an jeder Position eines langen Wortlaufs neu an und probiert jedes Mal den ganzen Lauf durch (O(k²)).
- Gemessen: `'<Node '.repeat(80000)` (480 KB) braucht 12,3 s, `'<Connections '`×40000 (520 KB) 19,2 s, ein Attributtext aus 80 000 × `a` 6,6 s. Die Laufzeit wächst quadratisch. Bis zur zulässigen Grenze von 4 MiB wären es Minuten bis Stunden.
- **Fehlerszenario:** Ein Kollege gibt eine kaputte oder präparierte `confCons.xml` weiter (solche Dateien werden in Teams geteilt), und der Nutzer importiert sie. Der Main-Thread blockiert, alle Fenster frieren ein, SSH/SFTP-Datenströme stehen, der Auto-Lock-Timer läuft nicht. Nur ein Abbruch des Prozesses hilft.
- **Fix-Richtung:**
  - Den Tag-Inhalt mit `[^<>]*?` bzw. `[^<>]*` begrenzen. Dann endet jeder Fehlversuch am nächsten `<`, und die Laufzeit wird linear.
  - Das Attribut-Muster mit einer Wortgrenze verankern: `/\b(\w+)="([^"]*)"/g`. Wer ganz sicher gehen will, schreibt einen Scanner mit `indexOf`.
  - Regressionstest: Eine 4-MiB-Eingabe aus `<Node ` bzw. `a` muss unter etwa 1 s geparst sein.

**I2 – OpenSSH: Glob als Backtracking-Regex mit exponentieller Laufzeit.** `src/shared/import-openssh.ts:18-21` (`globToRegExp`), angewendet in `:166-168`.
- Jedes `*` wird zu `.*`. Ein Muster mit k Sternen, das nicht passt, kostet etwa O(n^k).
- Gemessen gegen einen Alias mit 40 Zeichen: `*a`×8+`*b` braucht 5,6 s, `*a`×10+`*b` 58 s. Eine einzige Zeile `Host *a*a*a*a*a*a*a*a*a*a*b` neben einem langen Alias reicht also.
- Zusätzlich prüft der Parser alle Blöcke gegen jeden der bis zu 500 Aliasse. Bei 4 MiB mit Hunderttausenden `Host`-Zeilen sind das Hunderte Millionen Regex-Tests. Diese Zahl ist geschätzt, nicht gemessen.
- **Fehlerszenario:** Die Folge ist wie bei I1 ein Einfrieren des Main-Prozesses, ausgelöst durch eine im Dialog gewählte fremde oder kaputte Datei. Bei der eigenen `~/.ssh/config` ist das unwahrscheinlich, die Folge ist aber dieselbe.
- **Fix-Richtung:**
  - Den Glob ohne Regex abgleichen: Iterativer Wildcard-Abgleich mit Rücksprung nur auf den letzten `*`, Laufzeit O(n·m). Er passt in zehn Zeilen.
  - Die Blockzahl begrenzen, etwa die Zeilen nach dem 500. Alias nicht mehr sammeln, oder `MAX_IMPORT_BYTES` für OpenSSH kleiner wählen.
  - Regressionstest mit dem Muster oben.

### Minor

**M1 – `reg.exe`-Fehler werden zu „Keine SSH-Verbindungen gefunden.“** `src/main/import-source.ts:117-119`.
- Laut Spec gilt bei Exit ≠ 0 „Schlüssel fehlt“. Der `catch` fängt aber auch `ENOENT` (kein `reg.exe`), den Abbruch nach 10 s (`killed`) und `reg.exe`, das per Gruppenrichtlinie gesperrt ist („Registry editing has been disabled“, ebenfalls Exit 1).
- **Szenario:** Im Firmennetz mit gesperrten Registry-Tools hält der Nutzer seine PuTTY- oder WinSCP-Sitzungen für nicht vorhanden.
- **Fix-Richtung:** `error.code === 'ENOENT'` und `error.killed` als `AppError('core.importUnreadable')` melden, nur einen normalen Exit 1 als leere Vorschau behandeln. Für Exit 1 optional prüfen, ob `stderr` leer ist.

**M2 – Rohe Fehler aus `mkdtemp` erreichen den Renderer.** `src/main/import-source.ts:111`.
- Fehler außerhalb von `readText` (`mkdtemp`, etwa EPERM bei vollem oder gesperrtem Temp) wandern als englischer Fremdfehler über IPC. `errorText` zeigt dann die OS-Meldung mit dem Temp-Pfad und keinen deutschen Text.
- **Fix-Richtung:** `mkdtemp` in `try` setzen und bei Fehlern `AppError('core.importUnreadable')` werfen. Das Ledger nennt den Punkt schon.

**M3 – Präfixprüfung von `SHELLHERD_UPDATE_URL` umgehbar.** `src/main/index.ts:360`.
- `http://127.0.0.1:@evil.example/x` beginnt mit `http://127.0.0.1:`, die URL zeigt aber auf `evil.example` (`127.0.0.1:` ist hier der Userinfo-Teil).
- **Szenario:** Wer die Umgebung setzen kann, bekommt täglich IP und Version und kann einen Update-Hinweis erzwingen. Dessen Link führt zwar nur auf `github.com/pelmenipower/Shellherd/releases/tag/v…`, verliert aber an Glaubwürdigkeit. Die Wirkung bleibt gering.
- **Fix-Richtung:** Mit `new URL()` prüfen: `protocol === 'http:' && hostname === '127.0.0.1' && !username && !password`.

**M4 – Der PuTTY-Parser hält `ProxyPassword` in der Werte-Map.** `src/shared/import-putty.ts:227-229`.
- Anders als WinSCP (`WANTED`) und mRemoteNG (`READ`) sammelt `parseRegSections` alle Werte eines Abschnitts. R-B („auch nicht im Speicher“, so die Prüfvorgabe) ist nur im Ergebnis erfüllt, nicht im Zwischenstand.
- **Fix-Richtung:** Eine Whitelist `HostName, PortNumber, UserName, Protocol, PublicKeyFile, ProxyMethod, PortForwardings` vor dem `set`. Dazu ein Test: Ein Abschnitt mit `ProxyPassword` darf keinen Wert in der Map hinterlassen.

**M5 – Der Update-Badge fragt nur einmal beim Mount.** `src/renderer/src/components/UpdateBadge.tsx:13-17`.
- Der Badge mountet mit dem Vault-Bildschirm, also erst nach dem Entsperren. Er fragt nicht zu früh, das ist korrekt.
- Er bleibt aber über Sperren und Entsperren und über mehrere Tage hinweg gemountet und fragt nie wieder (Ledger U1).
- Schaltet der Nutzer den Check in den Einstellungen ab, bleibt ein schon sichtbarer Badge bis zum Neuladen stehen. `setEnabled(false)` liefert `available: null` nur an `UpdateSetting`.
- **Fix-Richtung:** Den Status in App halten (oder ein kleines Store-Ereignis) und neu abfragen, sobald `locked` auf `null` wechselt. `UpdateSetting` meldet sein Ergebnis an dieselbe Stelle.

**M6 – Die Doku nennt die Duplikatregel und den RDP-Import unvollständig.** `docs/handbuch.md:363`, `docs/manual.md:353`, `CHANGELOG.md:11`, `CHANGELOG.en.md:11`.
- Laut Text werden nur SSH- und SFTP-Verbindungen abgeglichen. Nach V1 und `import.ts:257-258` wird RDP aus mRemoteNG gegen RDP abgeglichen.
- Dass mRemoteNG-RDP-Verbindungen als Remotedesktop-Verbindungen (mit Domain) ankommen, steht in Handbuch, Manual und Changelog nicht. Es steht nur, was nicht übernommen wird.
- Ebenso fehlt, dass WinSCP nur aus der Registry gelesen wird. Wer WinSCP portabel mit `WinSCP.ini` nutzt, findet nichts. Der Parser könnte ini lesen, Main bietet es nach V4 aber nicht an.
- Auch der Text bei leerer Vorschau (`vault.json` `import.empty` „Keine SSH-Verbindungen gefunden.“) passt für WinSCP und RDP nur halb.
- **Fix-Richtung:**
  - Die Duplikat-Sätze ergänzen: „… SSH- oder SFTP-Verbindung (RDP mit RDP)“.
  - Einen Satz zu RDP aus mRemoteNG aufnehmen, ebenso den Hinweis „WinSCP: nur Registry-Speicherung“.
  - `import.empty` neutral fassen: „Keine Verbindungen gefunden.“ / „No connections found.“

**M7 – Harter Wert im Komponenten-CSS.** `src/renderer/src/import-ui.css:12` `flex: 1 1 200px`.
- CLAUDE.md verbietet harte Werte. `width: min(560px, …)` in Zeile 2 folgt dem bestehenden Dialogmuster (settings-, release-notes- und workflows-Dialog) und ist deshalb tolerierbar. Die Flex-Basis von 200px ist dagegen ein neuer Einzelwert. Der Design-Test fängt ihn nicht.
- **Fix-Richtung:** Ein Token mit Rolle in `tokens.css` und `docs/design-system.md` anlegen (etwa `--import-name-min`), oder `flex: 1 1 0` mit `min-width` aus einem bestehenden Token verwenden.

## 3. Parser-Korrektheit (gegen Spec 3.2, 3.3, V2, V3)

- **OpenSSH:**
  - Regeln 1–10 stimmen: Block vor dem ersten `Host` mit `*`, Match bis zum nächsten Host/Match übersprungen, Include gezählt, konkrete Aliasse in Reihenfolge, erster Wert gewinnt, `%h`/`%%`, Port nur Ziffern, `User` mit `%` entfällt.
  - `IdentityFile`: `%d`/`~`, relativ wird `home\.ssh\…`, `/` wird `\`, `keyUnresolved`.
  - ProxyJump als ein Token ohne `,@:`, Ziel gültig und selbst ohne Sprunghost.
  - Weiterleitungen: Socket-Pfad und mehr als 16 ergeben `forwardsDropped`. Mehr als 500 Aliasse ergeben `tooMany`.
  - Abweichung ohne Folgen: `Match` setzt `skipping`, und ein späteres `Host` beendet es wie verlangt.
- **PuTTY:** Abschnittsprüfung ohne Groß-/Kleinschreibung, `Default Settings` still, Fortsetzungszeilen übersprungen, `user@host` am letzten `@`, `UserName` hat Vorrang, `.ppk`-Notiz, `ProxyMethod`, L/R/D mit optionaler 4/6. Die Lesart `L4000` als Port 4000 ist im Ledger akzeptiert. i.O.
- **WinSCP (V2):** reg- und ini-Kopf, `%XX` als UTF-8 (Ledger akzeptiert), `/` bildet Ordner, FSProtocol 0 ergibt `scpAsSftp`, 1/2 ergibt `sftp`, alles andere `unsupported`. Host- und Portprüfung, `Tunnel=1` ergibt `jumpUnsupported`, Grenze 500, doppelte Abschnitte nur einmal. i.O.
- **mRemoteNG (V3):**
  - `FullFileEncryption="true"` ergibt `core.importEncrypted`. Der Container-Stapel bildet `folder`.
  - SSH1/SSH2 werden zu ssh (Port 22), RDP zu rdp (3389, Domain). Andere Protokolle zählen als `unsupported`.
  - Entitäten und `&#…;` werden dekodiert. Doppelte Schlüssel bekommen `#n`.
  - Fachlich i.O., Laufzeit siehe **I1**.
  - Vererbte Werte (`InheritUsername`) werden nicht aufgelöst. Die Spec verlangt das nicht, deshalb kein Befund.
- **Größengrenzen:** `stat` prüft vor dem Lesen, für Dialogdateien, Testhaken und Registry-Export gleich (`import-source.ts:72-82`). Dekodiert wird UTF-16LE mit BOM, sonst UTF-8 ohne BOM. i.O.
- **Leerer oder fehlender Registry-Schlüssel:** ergibt eine leere Vorschau, wie in der Spec verlangt. Stille Fehler bei ENOENT/Timeout siehe **M1**: Schweregrad Minor, weil nichts verloren geht und nichts preisgegeben wird. Der Nutzer wird nur in die Irre geführt.

## 4. Zusammenspiel

- **`buildImportNodes`:**
  - Erster Durchlauf mit Schemaprüfung.
  - Zweiter Durchlauf mit der Sprunghost-Regel: Das Ziel muss gewählt und gültig sein und darf selbst keinen `jumpKey` haben, sonst gilt `jumpsDropped`. RDP bekommt keinen Sprunghost.
  - Dritter Durchlauf baut Ordner beim ersten Kind. Gleiche Pfade nutzen denselben Ordner, leere Ordner entstehen nicht, die Reihenfolge folgt der Vorschau.
  - Duplikate: ssh/sftp bilden eine Gruppe, rdp eine eigene. Frühere Kandidaten zählen mit. i.O.
- **Import-Dialog:**
  - Vorauswahl ohne Duplikate.
  - Tri-State über `indeterminate`.
  - Zielauswahl: Neuer Ordner (Standard), oberste Ebene oder vorhandene Ordner aus `folderOptions`.
  - `imported = selected − invalid`.
  - Die Ergebnis-Meldung zählt `skipped` wie in Spec 3.9, die Sprunghost-Zeile steht in der Fassung des Orchestrators.
  - Abbruch im Dateidialog schließt den Dialog. Fehler zeigt `role="alert"` mit „Schließen“.
  - Beim Sperren schließt `afterLock` den Dialog über `setAppDialog(null)` (`App.tsx:621`). Ein noch laufendes `importRead` wird über `current=false` verworfen.
  - Der StrictMode-Doppelmount ist per `setTimeout` abgefangen. i.O.
- **Update-Badge:** Er steht im Footer des Vault-Bildschirms (`App.tsx:969`) und mountet erst nach erfolgreichem `unlockVault`. Zu diesem Zeitpunkt liefert `isUnlocked()` in Main `true`, er fragt also nicht vor dem Entsperren und dann nie wieder. Er fragt einmal pro Mount (Spec R12: „einmal pro Laden“). Die Grenzen dieses Verhaltens stehen in **M5**.
- **Einstellung ohne Vault:** `UpdateSetting` steht außerhalb der `vault`-Bedingung. `status()` ruft bei gesperrtem Vault nicht ab und liefert den gespeicherten Stand, `setEnabled` schreibt ohne Vault in `settings.json`. Felder werden einzeln gelesen, aus ist nur ein explizites `false`. i.O.
- **Menü und Willkommensseite:** vier Einträge in der Reihenfolge von V7, als volle Literal-Maps. i.O.

## 5. Doku

- Handbuch und Manual: Abschnitte „Updates“ und „Verbindungen importieren“. Die Angaben zu Registry-Pfaden, Dateidialog-Vorgaben, Verschlüsselungsabbruch, Passwörtern und Schlüsseln, Sprunghost, Weiterleitungen und Zielordner stimmen mit dem Code überein. Lücken siehe **M6**.
- Changelog (de/en) 0.21.0 und README: Import-Zeile und Abschnitt **Privacy** (nur KI-Anbieter und Update-Check, IP und `User-Agent: Shellherd/<version>`, abschaltbar). Das deckt sich mit `update-check.ts:89` (Header `accept`, `user-agent`, kein weiterer Inhalt). Version 0.21.0 steht in `package.json` und `package-lock.json`. i.O.

## 6. i18n und Tokens

- Alle neuen Texte laufen über `t()`/`mainT`, die Keys stehen in de-DE und en-US. Die Maps verwenden volle Literale. `i18n-catalog.test.ts` ist grün (Parität, Platzhalter, keine verwaisten Keys). `'XML'` als Filtername im Dateidialog (`import-source.ts:96`) ist ein Formatname und kein übersetzbarer Text, deshalb kein Befund.
- Ein neuer Token `--import-list-max` mit Rolle steht in `tokens.css` und `design-system.md`. `.update-button` ist in der `:not()`-Liste in `styles.css` und in der Doku eingetragen. Keine Bewegung, also kein Motion-Gate nötig. Der harte Wert ist unter **M7** erfasst.

## Rulings dieses Reviews

- Die Testhaken-Variablen sind als Risiko vertretbar, analog zu `SHELLHERD_RDP_MODE`. Die Umgebung zu kontrollieren bringt keinen Gewinn über den Benutzerkontext hinaus. M3 härtet nur die URL-Prüfung.
- Stille `reg.exe`-Fehler (M1) sind Minor, nicht Important: Es gehen keine Daten verloren und keine werden preisgegeben.
- Die Regex-Laufzeit (I1, I2) ist Important, weil eine im Dialog gewählte Datei den gesamten Main-Prozess samt laufender Sitzungen blockiert.
