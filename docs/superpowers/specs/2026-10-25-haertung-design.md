# Härtung: Sperrschutz, Vault-Pfad-Freigabe, Server-Schlüssel – Design

> Übernommen aus dem Konzept (Opus, `.superpowers/sdd/haertung-research.md`). Bindend geht `2026-10-25-haertung-validation.md` vor.

Branch `claude/feature/haertung`, gestapelt auf 0.23.0, Ziel **0.24.0**. Die Umsetzer sind Haiku-Modelle; Signaturen, Texte und Fehlercodes unten sind wörtlich zu übernehmen.


Branch `claude/feature/haertung`, gestapelt auf sftp-komfort (0.23.0), Ziel **0.24.0**.

Drei Teile:
1. Fensterinhalt beim Sperren schützen (`setContentProtection`)
2. Freigabeliste für Vault-Pfade (Härtung A4 aus start-ui)
3. known_hosts importieren und verwalten

Die Umsetzer sind Haiku-Modelle. Signaturen, Texte, Fehlercodes und Code-Blöcke unten sind verbindlich und wörtlich zu übernehmen.

---

## 0. Bestand (mit Fundstellen)

### 0.1 Sperre und Fenster
- Sperren trennt nicht (Spec `2026-10-21-lock-screen-design.md`, N1). Main meldet die Sperre per `announce` an Haupt- und Nebenfenster (`src/main/index.ts:345-348`).
  - Manuell: `onLock` (`index.ts:351`), ausgelöst von `vault:lock` ohne `disconnect` (`src/main/vault/ipc.ts:224-233`).
  - Automatisch: `AutoLock.lock` (`index.ts:358`).
  - Entsperren: `onUnlock` (`index.ts:352`), auch nach `saveVault` (`vault/ipc.ts:122-123`).
  - Wechsel („Andere Vault-Datei“): `lockVault({ disconnect: true })` ruft `onSessionChange` (`index.ts:350`) und **kein** `onLock` (`vault/ipc.ts:229-232`).
- Fenster entstehen nur in `createWindow` (`index.ts:99-142`), Rollen `main` und `secondary` im `windowRegistry`. Das Drag-Geisterfenster ist nicht registriert (`index.ts:273`). Neue Nebenfenster entstehen gesperrt nicht (Fenster-IPC liest den Vault, Lock-Spec 1.2).
- Der RDP-Helfer zeichnet ein eigenes, nur *besessenes* Top-Level-Fenster eines anderen Prozesses (`rdpSurfaceMode() === 'owned'`, `src/main/rdp/ipc.ts:23-25`). Während der Sperre versteckt `useNativeSurfaceBlock(true)` es (Lock-Spec 1.5).
- Native Rückfragen (`dialog.showMessageBox`, Server-Schlüssel) sind eigene Fenster und können über dem Sperrbildschirm stehen (`docs/handbuch.md:75`).
- **`setContentProtection` gibt es nirgends im Code.** Die Lock-Validierung nennt es als kleinsten Folgeschritt für Risiko O1 (`docs/superpowers/specs/2026-10-21-lock-screen-validation.md:465-470`). Review M6 hat O1 mit dem Treiber nicht prüfen können und ACCEPTED (`.superpowers/sdd/2026-10-21-lock-screen/progress.md:33`).
- Electron 44.4.2: `setContentProtection(enable)` und `isContentProtected()` sind vorhanden (`node_modules/electron/electron.d.ts:6134`, `:5713`). Unter Windows ruft es `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)`. Ab Windows 10 2004 fehlt das Fenster dann in Aufnahmen ganz; ältere Versionen zeigen es schwarz.

**Was heute in Taskleisten-Vorschau und Alt+Tab während der Sperre zu sehen ist:**
- **Sichtbares Fenster:** DWM zeigt live den zusammengesetzten Inhalt, also den undurchsichtigen Sperrbildschirm. Die RDP-Fläche ist versteckt. Das ist dicht.
- **Minimiertes Fenster:** Chromium malt keine neuen Frames. Vorschau und Wiederherstellen-Animation zeigen das **letzte Bild vor dem Minimieren**, also Terminal-Inhalt von vor der Sperre (Lock-Validierung O1). Das ist ungeprüft und offen.
- **Bildschirmfreigabe und Aufnahme** (Teams, Zoom, Snipping Tool, Rekorder): Sie erfassen heute den Sperrbildschirm. Er zeigt nur den Vault-Namen und die Sitzungszahl.

### 0.2 Vault-Pfade
`unlockVault({ filePath, password })` nimmt **jeden** String-Pfad an (`vault/ipc.ts:168-199`). Geprüft werden nur Typ und Länge (`:176-182`), danach folgen sofort `vaultSessionManager.unlock` → `readEncryptedVaultFile(filePath)` (`session.ts:54-59`) und `recent.touch` (`:189`).

Woher die Pfade im Renderer kommen:

| Quelle | Fundstelle | Kennt Main den Pfad? |
|---|---|---|
| Datei-Dialog `selectVaultFile` | `vault/ipc.ts:132-166`, `App.tsx:420-438` | ja, aus dem nativen Dialog |
| `Zuletzt benutzt` / Startsprung `lastVaultFile` | `recent-vaults.ts:40-56`, `App.tsx:246-258`, `RecentVaults.tsx:26` | ja, aus `settings.json` |
| Explorer-Start (argv) | `index.ts:213`, `:237-243` | ja |
| Zweite Instanz (argv) | `index.ts:214-221` → `vault:open-file` | ja |
| Ziehen und Ablegen | `App.tsx:270-279` über `webUtils.getPathForFile` (`preload/index.ts:128`) | **nein**, der Pfad kommt nur aus dem Renderer |
| Sperrbildschirm | `App.tsx:636` (`vaultPath` der gesperrten Session) | ja, `lockedVault()` (`session.ts:46`) |
| Neuer Vault | Speichern-Dialog in Main (`vault/ipc.ts:76-130`) | ja |

Angriffswege:
- **Kompromittierter Renderer** (XSS etwa über Release Notes, Servernamen oder Terminal-Links) ruft `desktopApi.unlockVault({ filePath: '\\\\angreifer\\s\\x.term', password: 'x' })` auf. Schon `readFile` auf den UNC-Pfad löst eine SMB-Verbindung mit impliziter NTLM-Anmeldung aus, und der Net-NTLMv2-Hash des Windows-Kontos fließt zum Angreifer. Dafür braucht es weder Passwort noch Klick, und es gelingt auch auf dem Startbildschirm ohne entsperrten Vault.
- Schrägstrich-Formen (`//srv/s/x.term`, `\/srv\s`) sind unter win32 ebenfalls UNC. `RecentVaults.missing()` erkennt nur `\\` (`recent-vaults.ts:60-63`, Recheck N1 in `2026-10-25-start-ui-recheck.md:43-45`).
- **Persistenz:** Kennt der Angreifer das Passwort eines eigenen Vaults auf seiner Freigabe, landet der Pfad nach dem erfolgreichen Entsperren in `recentVaults`. `list()` und `latest()` prüfen ihn dann bei jedem Start per `stat` (Review M2, `2026-10-25-start-ui-review.md:86`). Die Schrägstrich-Form umgeht den UNC-Schutz (N1).
- **Gerätepfade** (`\\?\UNC\srv\s`, `\\.\pipe\…`) haben dieselbe Wirkung.
- **Grenze:** Ein Renderer mit *entsperrtem* Vault hat weitere Wege zu UNC: `privateKeyPath` im Vault, das lokale Dateifenster, Auto-Upload-Bindungen. Die Freigabeliste schließt den Weg über `unlockVault`. Er ist der einzige, der **ohne** entsperrten Vault funktioniert. Die anderen Wege sind ein eigenes Extra (A5, Abschnitt 8).

### 0.3 Server-Schlüssel (known hosts)
- Speicher `known-hosts.json` im Benutzerdatenordner, Schema `{ version: 1, hosts: Record<'["host",port]', 'SHA256:…'> }` (`src/main/ssh/known-hosts.ts:8-11`).
  - Pro Adresse gibt es **einen** Fingerprint und **keinen Schlüsseltyp**.
  - Die Datei hat ein Lese-Limit von 1 MiB (`:32`).
  - Geschrieben wird atomar über eine `.tmp`-Datei (`:62-71`). Schreibt der Code, legt er nur `{ version: 1, hosts }` ab (`:66`); weitere Felder gingen dabei verloren.
- `verify` ist serialisiert über `queue` (`:40-45`). Ablauf: Treffer → `true`, Abweichung → `HostKeyError('ssh.hostKeyChanged', 'changed', …)`, unbekannt → native Rückfrage (`createKnownHosts`, `src/main/ssh/ipc.ts:29-42`), danach erneut lesen und schreiben.
- `hostFingerprint(key)` = `SHA256:` + base64 ohne `=` (`known-hosts.ts:15-17`).
- **Es gibt keine Oberfläche.** Das Handbuch sagt wörtlich: „OpenSSHs `known_hosts` wird noch nicht importiert … eine Oberfläche zur gezielten Verwaltung vertrauter Hosts folgt später“ (`docs/handbuch.md:611-622`).
  - Ein gewollter Schlüsselwechsel lässt sich heute **nur durch Löschen der Datei** annehmen.
  - Die Fehlerkarte rät nur „Kläre den Schlüsselwechsel mit dem Administrator“ (`src/shared/locales/de-DE/terminal.json:204-208`).
- Fehlerkarten: `hostkey-changed` zeigt die Fingerprints (`src/main/ssh/session.ts:160-166`). Alle anderen `HostKeyError` landen in der Karte `hostkey-store`, deren Text der Fehlercode bestimmt (`src/renderer/src/connection-error-text.ts:63-64`).
- Wortwahl in der UI: **„Server-Schlüssel“**, nicht „Host-Schlüssel“ (`errors/ssh.json:6-10`, `terminal.json`).
- Einstellungen: eine Seite mit Abschnitten `general | vault | connections | terminal | assistant` (`settings-sections.ts:6`). Alles außer „Allgemein“ braucht einen Vault. Unterdialoge folgen dem Muster `Anbieter verwalten` → `AiSettingsDialog` mit Rücksprung (`SettingsDialog.tsx:191-194`, `App.tsx:85-86,831-834,958-960`).
- Lehren aus Paket 3 (import-update):
  - Größenlimit `MAX_IMPORT_BYTES` = 4 MiB (`src/shared/import.ts:10`), `decodeImport` erkennt UTF-16LE mit BOM (`src/main/import-source.ts:69-72`).
  - Der Parser läuft im Worker mit 5 s Zeitlimit und 256 MB Heap (`import-source.ts:23,94-142`), weil der ssh-config-Parser Regex und Include-Logik hat.
  - Die Dateiwahl läuft über den nativen Dialog mit `defaultPath` (`:155-170`).
  - Main liest nichts ohne Klick.

### 0.4 run-app
- Der Treiber ersetzt `dialog.showOpenDialog` und `showSaveDialog` durch den Demo-Vault. `showMessageBox` antwortet mit dem letzten Knopf, also „vertrauen“ (`.claude/skills/run-app/driver.mjs:52-62`). `screens.mjs:107` setzt den Dialog je Szene um (`setOpenDialog`).
- Screenshots entstehen über `page.screenshot` (`driver.mjs:77-84`), also per CDP `Page.captureScreenshot` aus dem Chromium-Compositor und nicht als Bildschirmaufnahme des Betriebssystems.
- Import-Fixtures: `.claude/skills/run-app/import-fixtures.mjs:113-126` (synthetisch, nach `%TEMP%\shellherd-run\import`).
- Der Demo-SSH-Server läuft auf `127.0.0.1:2222` (`sshd.mjs:285`). Seinen Schlüssel bestätigt der Treiber beim ersten Verbinden per gestubbter Rückfrage. Danach steht `["127.0.0.1",2222]` in `profile\Shellherd\known-hosts.json`.

---

## 1. Empfehlungen

| # | Fläche / Funktion | Wert | Aufwand |
|---|---|---|---|
| 1a | Während der Sperre (manuell und automatisch) alle registrierten Fenster per `setContentProtection(true)` aus Aufnahmen und Freigaben nehmen. Entsperren, Vault-Wechsel und Trennen heben das auf. | ★★ | kleine Main-Änderung (`index.ts`) |
| 1b | Dauerhafte Einstellung „Fenster von Bildschirmaufnahmen ausschließen“ | ★ | nicht jetzt (R1.2) |
| 2a | Main führt eine Freigabeliste. `unlockVault` öffnet nur Pfade aus dem nativen Dialog, aus Explorer-argv, aus `recentVaults`, die gesperrte Session oder einen per Main geprüften Drop. | ★★★ | kleine Main-Änderung |
| 2b | Drop nur von Laufwerksbuchstaben. UNC- und Gerätepfade lehnt Main ab, der Nutzer nimmt dafür den Dialog. | ★★★ | kleine Main-Änderung plus 6 Zeilen Renderer |
| 2c | UNC-Erkennung in `RecentVaults.missing()` auch für `//` (Recheck N1) | ★★ | eine Zeile |
| 3a | Verwaltungsansicht „Server-Schlüssel“: Liste, Suche, `Entfernen`, SHA256-Fingerprint, Herkunft. Erreichbar über Einstellungen → Verbindungen. | ★★★ | Renderer plus kleine Main-Änderung |
| 3b | Import einer `known_hosts`-Datei über den nativen Dialog: Klartext-Namen, `[host]:port`, gehashte `\|1\|`-Namen, mehrere Schlüsseltypen, `@revoked` | ★★★ | Main (Parser und Speicher) |
| 3c | Hinweis in der Fehlerkarte „Server-Schlüssel hat sich geändert“ auf `Entfernen` | ★★★ | nur Text |
| 3d | `@cert-authority`, Muster (`*`, `?`, `!`), Zertifikate und `sk-…`-Typen | ★ | nicht jetzt, sie werden gezählt und übersprungen (R3.4) |
| 3e | Eigene Fehlerkarte für widerrufene Schlüssel | ★ | nicht jetzt (Risiko 9.7) |

---

## 2. Rulings (Entscheidungen mit Begründung)

### 1 – Fensterinhalt beim Sperren

**R1.1 Content Protection nur während der Sperre, immer an, ohne Einstellung.**
- Eingeschaltet wird sie in `onLock` und in `AutoLock.lock`, jeweils **vor** `announce`. Ausgeschaltet wird sie in `onUnlock` und in `onSessionChange`, also beim Trennen oder Vault-Wechsel. Sonst bliebe der Startbildschirm nach „Andere Vault-Datei“ geschützt.
- Begründung: Niemand muss einen Sperrbildschirm teilen oder aufnehmen. Eine Einstellung wäre Code ohne Nutzen.
- Wirkung, die sicher ist: Teams, Zoom, OBS, das Snipping Tool, `PrintScreen` und die Windows Graphics Capture erfassen Shellherd während der Sperre nicht. An der Stelle erscheint der Hintergrund.

**R1.2 Keine dauerhafte Variante (nicht jetzt).**
- Admins teilen Terminals bewusst in Teams oder für Support-Screenshots. Ein dauerhaft geschütztes Fenster verschwindet aus jeder Freigabe, und Nutzer halten das für einen Fehler.
- Während der Arbeit sieht ohnehin jeder Zuschauer am Bildschirm dasselbe. Der Gewinn ist klein.
- Wird es später gewünscht, kommt es als `settings.json`-Schalter (Gerät, nicht Vault) unter Allgemein mit dem Standard **aus**.

**R1.3 Geltungsbereich: Haupt- und Nebenfenster.**
- Es gilt dieselbe Schleife wie bei `announce` über `windowRegistry.main()` und `windowRegistry.secondaries()`.
- Das Drag-Geisterfenster bleibt außen vor. Es zeigt nur eine Tab-Beschriftung und existiert nur während eines Drags.
- Das RDP-Fenster (anderer Prozess) und native Rückfragen deckt WDA nicht ab. Das RDP-Fenster ist während der Sperre versteckt. Die Server-Schlüssel-Rückfrage zeigt nur Host und Fingerprint, so steht es schon im Handbuch.

**R1.4 Taskleisten-Vorschau und Alt+Tab: nichts versprechen, manuell prüfen.**
- Laut Microsoft erscheint ein Fenster mit `WDA_EXCLUDEFROMCAPTURE` nur auf dem Monitor. Ob DWM-Vorschauen (Taskleiste, Alt+Tab) dazu zählen und ob die Vorschau eines *minimierten* Fensters (O1) damit leer wird, ist nicht belegt.
- Der Orchestrator prüft das von Hand auf Windows 11 und trägt das Ergebnis ins Ledger ein (Abschnitt 6, Schritt M1):
  1. Fenster minimieren, Auto-Sperre auf 1 Minute.
  2. Nach der Sperre über das Taskleistensymbol fahren, dann Alt+Tab.
- Handbuch und CHANGELOG versprechen nur „Bildschirmaufnahmen und -freigaben“.

**R1.5 run-app und Playwright.**
- `page.screenshot` liest aus dem Chromium-Compositor und nicht über die Bildschirmaufnahme von Windows. Die Abnahme-Screenshots, auch `lock-screen.png` während der Sperre, entstehen deshalb weiter normal. Das ist erwartet; Schritt 6.1 belegt es, denn der Shot wird angesehen und darf nicht leer sein.
- Prüfbar ist `isContentProtected()` über die `main`-Route: während der Sperre `true`, danach `false`.
- Eine Aufnahme von Hand mit dem Snipping Tool zeigt während der Sperre den Desktop. Das ist so gewollt. Für die Abnahme zählen nur Treiber-Shots.

### 2 – Freigabeliste für Vault-Pfade

**R2.1 Freigegeben ist ein Pfad, wenn er (nach `recentKey`, also `win32.resolve` und Kleinschreibung) aus einer dieser Quellen stammt:**
1. **Nativer Dialog:** `selectVaultFile` gibt den Pfad nach `grant` zurück.
2. **Explorer-argv:** `launchFile` beim Start und `second-instance` werden in `index.ts` freigegeben, bevor sie den Renderer erreichen.
3. **`recentVaults`:** `RecentVaults.has()` liest `settings.json` ohne Dateizugriff. Dorthin kommt ein Pfad nur nach erfolgreichem Entsperren oder Speichern.
4. **Gesperrte Session:** `lockedVault().filePath`, für den Sperrbildschirm.
5. **Drop:** Er kommt über den neuen Kanal `vault:drop-file`, und Main prüft dort selbst (R2.2).

Alles andere lehnt Main **vor jedem Dateizugriff** mit `core.vaultPathNotAllowed` ab. Die Freigaben gelten nur im Speicher für diesen Lauf, denn alles Dauerhafte steht schon in `recentVaults`.

**R2.2 Drop nur von Laufwerken.**
- `droppedVaultPath()` akzeptiert nur `X:\…` beziehungsweise `X:/…` mit der Endung `.term` oder `.terminus`, nach `win32.resolve`.
- Abgelehnt werden UNC (`\\`, `//`), Gerätepfade und relative Pfade.
- Begründung: Den Drop sieht Main nicht. Ein kompromittierter Renderer könnte jeden String als „gezogen“ ausgeben. Lokale Laufwerkspfade lösen keine Anmeldung bei fremden Servern aus.
- Gemappte Netzlaufwerke (`Z:\`) bleiben erlaubt. Die Zuordnung hat der Nutzer selbst angelegt (Recheck start-ui).
- Eine Vault-Datei auf einer Freigabe öffnet der Nutzer einmal über `Vault-Datei auswählen`. Danach steht sie in `Zuletzt benutzt`.

**R2.3 Kein neuer Kanal mit Id statt Pfad.** `unlockVault` behält seine Signatur (R-A3 start-ui). Die Prüfung sitzt in Main, deshalb muss der Renderer nichts umbauen. Nur der Drop ruft vorher `dropVaultFile`.

**R2.4 N1 mit erledigen.** `missing()` erkennt UNC per `/^[\\/]{2}/`. Damit prüft ein gespeicherter `//srv/…`-Eintrag beim Start nicht mehr per `stat`.

**R2.5 Fehlertext und Meldung.**
- `core.vaultPathNotAllowed`: „Shellherd öffnet diese Datei nur über „Vault-Datei auswählen“.“ Der Text passt für den Drop und für einen abgelehnten Entsperrversuch.
- Ein abgelehnter Drop erscheint als Meldung mit dem Titel `app:notices.vaultPathRefusedTitle` („Vault-Datei nicht geöffnet“).

### 3 – known_hosts importieren und verwalten

**R3.1 Ort: Einstellungen → Verbindungen, Knopf `Server-Schlüssel verwalten`**, darunter ein Hinweis. Der Knopf öffnet den eigenen Dialog `KnownHostsDialog`; beim Schließen geht es zurück in die Einstellungen, der Fokus liegt dann auf dem Knopf. Das ist das Muster von `Anbieter verwalten`.
- Der Dialog braucht einen entsperrten Vault, denn die Liste verrät, mit welchen Servern man arbeitet.
- Die Kanäle prüfen `requireMain` und `getSnapshot()`, wie `import:read`.
- Beim Sperren schließt `afterLock` alle App-Dialoge, also auch diesen.

**R3.2 Datenmodell: dieselbe Datei, `version: 1`, zwei neue optionale Felder** (Vertrag 3.4):
- `imported[]`: Einträge mit Typ, als Klartext `{ name, port, type, fingerprint }` oder gehasht `{ salt, hash, type, fingerprint }`.
- `revoked[]`: `{ type, fingerprint }`.
- `hosts` bleibt unverändert für die bestätigten Schlüssel. Es gibt keine Migration und keinen Versionssprung.
- Ein Downgrade auf 0.23.0 liest die Datei weiter, denn zod entfernt unbekannte Felder. Beim nächsten Bestätigen eines Schlüssels verliert die alte Version dann die importierten Einträge. Das wird hingenommen (Risiko 9.5).
- **Pflicht:** Jeder Schreibvorgang nimmt `...stored` mit. Heute schreibt `verifyNext` nur `{ version, hosts }` (`known-hosts.ts:66`), das muss sich ändern.

**R3.3 Prüfregeln in `verify`, in dieser Reihenfolge:**
1. Steht der Fingerprint in `revoked`, folgt `HostKeyError('ssh.hostKeyRevoked')`. Das gilt immer, auch für einen bestätigten Schlüssel.
2. Gibt es einen bestätigten Eintrag (`hosts[address]`), gilt **nur er**, genau wie heute: Treffer → `true`, Abweichung → `hostKeyChanged` mit Fingerprints. **Eigene Bestätigungen gehen dem Import vor.** Ein veralteter Schlüssel aus einer alten `known_hosts` kann einen bestätigten Server also nie übersteuern.
3. Sonst gelten die importierten Einträge, die zum Host passen. Bei Klartext müssen `name` und `port` gleich sein. Bei gehashten Einträgen wird HMAC-SHA1(salt, `host` bei Port 22, sonst `[host]:port`) berechnet.
   - Passt ein Fingerprint, ist das Ergebnis `true`.
   - Gibt es einen Eintrag **gleichen Typs** mit anderem Fingerprint, folgt `hostKeyChanged` mit `expected` = dessen Fingerprint.
   - Gibt es nur Einträge anderer Typen, gilt der Server als unbekannt. Das ist OpenSSH-Verhalten: ssh2 hat ausgehandelt, und der Typ fehlt in der Datei.
4. Unbekannt → Rückfrage wie heute, danach ein bestätigter Eintrag in `hosts`.

**R3.4 Import-Parser: Was übernommen wird.**
- Klartext-Namen, auch mehrere pro Zeile mit Komma getrennt (`host,ip`). `[host]:port`. Gehashte `|1|salt|hash`-Namen. Die Typen `ssh-ed25519`, `ecdsa-sha2-nistp256/384/521` und `ssh-rsa`.
- Mehrere Typen pro Host sind erlaubt.
- `@revoked` gilt **für alle Hosts**. Das ist strenger als OpenSSH und deshalb sicher.
- **Übersprungen und gezählt** werden:
  - `@cert-authority`: ssh2 prüft keine Host-Zertifikate.
  - Unbekannte Markierungen.
  - Muster mit `*`, `?` oder `!`: Shellherd vergleicht Namen nur exakt.
  - Zertifikats- und `sk-…`-Typen, DSA.
  - Kaputtes base64.
  - Ein Schlüssel-Blob, dessen innerer Typ nicht zum Typfeld passt.
  - Zeilen über 16 KiB.
  - Alles über 1 000 Schlüssel pro Import.
- Kommentare und Leerzeilen zählen nicht.

**R3.5 Konflikte beim Import: Der Import fügt nur hinzu und ersetzt nie etwas.**
- Klartext-Zeile für einen Host mit bestätigtem Eintrag: Sie zählt als „schon bekannt“ und wird nicht gespeichert, die Bestätigung bleibt.
  - Enthält die Datei für diese Adresse **keinen** Schlüssel, der zur Bestätigung passt, steht die Adresse in `conflicts`. Die Meldung lautet dann: „Shellherd kennt für diese Server einen anderen Schlüssel und behält ihn: web-01:2222“. So erfährt der Nutzer von der Abweichung und kann sie klären.
  - Prüfen und bei Bedarf entfernen kann er im Dialog.
- Gleicher Eintrag schon importiert (gleiche Id): zählt als „schon bekannt“.
- Ein Schlüssel, der in der Datei oder im Speicher widerrufen ist, wird nie als vertrauenswürdig übernommen und zählt als übersprungen.
- Gehashte Zeilen werden nicht gegen bestätigte Einträge geprüft. Das kostete pro Zeile ein HMAC je bestätigtem Host. Sie werden übernommen und durch R3.3 Punkt 2 ohnehin überdeckt.
- Es gibt **keine Vorschau mit Bestätigung**. Die Dateiwahl im Dialog ist der Klick. Der Import erweitert Vertrauen nur für Server, die Shellherd noch nicht bestätigt hat, und jeder Eintrag lässt sich einzeln entfernen.
- Es wird nur geschrieben, wenn sich etwas ändert.

**R3.6 Kein Worker, dafür harte Limits und nur lineare Muster.**
- Der Parser zerlegt mit `split` und `indexOf`. Er nutzt nur Regex ohne verschachtelte Quantoren, kein Include und keine Rekursion.
- Die Eingabe ist auf 4 MiB begrenzt (`MAX_IMPORT_BYTES`, `core.importTooLarge`), Zeilen auf 16 KiB, Schlüssel auf 1 000.
- Die Laufzeit ist damit linear und klein. Ein Test mit einer bösartigen 4-MiB-Datei verlangt weniger als 1 s.
- Der Worker aus Paket 3 war für den ssh-config-Parser nötig (Regex, Includes). Hier wäre er zusätzlicher Code ohne Gewinn.
- Die Datei wählt der Nutzer im nativen Dialog, vorgeschlagen ist `%USERPROFILE%\.ssh\known_hosts`. Main liest `~/.ssh` **nie ohne diesen Klick** und schreibt `known_hosts` nie.

**R3.7 Ansicht.**
- Eine Zeile pro Eintrag:
  - Name: `host` bei Port 22, sonst `host:port`, bei IPv6 `[::1]:2222`. Gehashte Einträge heißen „Gehashter Hostname“, widerrufene „Alle Hosts“.
  - Darunter klein Typ und Herkunft: „Bestätigt“, „Importiert“ oder „Widerrufen“. Bestätigte Einträge haben keinen Typ.
  - Darunter der Fingerprint in Monospace, markierbar.
  - Rechts `Entfernen`.
- Sortierung:
  1. Benannte Einträge nach `compareText`
  2. Gehashte Einträge
  3. Widerrufene Einträge
- Suche „enthält“ per `foldCase` auf Name, Typ und Fingerprint.
- Fußzeile „N von M“ über `formatNumber`.
- `Entfernen` wirkt **ohne Rückfrage**:
  - Ein entfernter bestätigter Schlüssel wird beim nächsten Verbinden wieder abgefragt. Das ist umkehrbar und genau der Weg, einen gewollten Schlüsselwechsel anzunehmen.
  - Nach dem Entfernen geht der Fokus ins Suchfeld.
- Gerendert wird ohne Virtualisierung: Es sind höchstens 1 000 importierte Einträge plus die bestätigten.

**R3.8 Fehlerkarte.** `terminal:connectionError.hostkey-changed.next` nennt den Weg über `Entfernen` (Vertrag 3.9). Der Zusatz kommt nur in die Karte. Der Fehlertext `ssh.hostKeyChanged` bleibt unverändert.

### Allgemein
- **R4** Keine Bewegung und keine neuen Tokens. CSS nutzt nur vorhandene `var(--…)`. Die Rahmen schreiben `1px solid var(--color-border)` wie die übrigen Komponenten.
- **R5** Alle Texte laufen über `t()` und `mainT`. Neue Keys kommen in de-DE und en-US als volle Literale. Platzhalter heißen **nie** `{{count}}` (keine Plural-Keys). Zahlen kommen über `formatNumber`, Sortierung über `compareText`.
- **R6** Version 0.24.0.

---

## 3. Vertrag (wörtlich)

### 3.1 `src/shared/known-hosts.ts` (neu, Task A)
```ts
/** Where a trusted or revoked server key comes from. */
export type KnownHostOrigin = 'confirmed' | 'imported' | 'revoked';

/** One row of the server key list; host/port null for hashed names and revoked keys, type null for confirmed keys. */
export interface KnownHostView {
  /** 16 hex chars, stable for the same entry; the only thing the renderer sends back. */
  id: string;
  host: string | null;
  port: number | null;
  type: string | null;
  fingerprint: string;
  origin: KnownHostOrigin;
}

/** Counts of one known_hosts import; conflicts are confirmed hosts whose key the file does not contain (at most 20). */
export interface KnownHostsImportResult { added: number; known: number; revoked: number; skipped: number; conflicts: string[] }

export type KnownHostsImportReply =
  | { canceled: true }
  | { canceled: false; result: KnownHostsImportResult; hosts: KnownHostView[] };

/** `host` on port 22, else `host:port`; IPv6 addresses get brackets. */
export function hostLabel(host: string, port: number): string {
  if (port === 22) return host;
  return host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`;
}
```
Test `src/shared/known-hosts.test.ts`: `hostLabel('web-01', 22)` → `web-01`; `('web-01', 2222)` → `web-01:2222`; `('::1', 2222)` → `[::1]:2222`.

### 3.2 `src/shared/ipc.ts` und `src/preload/index.ts` (Task A)
In `IPC_CHANNELS` (nach `removeRecentVault`):
```ts
  vaultDropFile: 'vault:drop-file',
  knownHostsList: 'known-hosts:list',
  knownHostsRemove: 'known-hosts:remove',
  knownHostsImport: 'known-hosts:import',
```
In `DesktopApi` (nach `removeRecentVault`), Import der Typen aus `./known-hosts`:
```ts
  /** Main checks a dropped vault path (local drives only) and returns it normalized; rejects with core.vaultPathNotAllowed. */
  dropVaultFile: (filePath: string) => Promise<string>;
  knownHostsList: () => Promise<KnownHostView[]>;
  knownHostsRemove: (id: string) => Promise<KnownHostView[]>;
  /** Native file dialog, then import; nothing is read without that click. */
  knownHostsImport: () => Promise<KnownHostsImportReply>;
```
Preload (gleicher Stil wie die Nachbarn, Literale):
```ts
  dropVaultFile: filePath => ipcRenderer.invoke('vault:drop-file', filePath),
  knownHostsList: () => ipcRenderer.invoke('known-hosts:list'),
  knownHostsRemove: id => ipcRenderer.invoke('known-hosts:remove', id),
  knownHostsImport: () => ipcRenderer.invoke('known-hosts:import'),
```

### 3.3 `src/main/ssh/known-hosts-parse.ts` (neu, Task B)
```ts
import { createHash, createHmac } from 'node:crypto';

/** Host key formats ssh2 verifies; certificates, security keys and DSA are skipped. */
const KEY_TYPES = new Set(['ssh-ed25519', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521', 'ssh-rsa']);
/** Longer lines are skipped (an RSA-16384 key is about 2.8 KiB). */
export const MAX_KNOWN_HOSTS_LINE = 16_384;
/** Keys taken from one file; the rest counts as skipped. */
export const MAX_PARSED_KEYS = 1000;
// Linear patterns only: one character class, one bounded quantifier, no nesting.
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const HOST = /^[a-z0-9._:%-]{1,253}$/;
const PORT = /^\d{1,5}$/;

export type ParsedHostKey =
  | { kind: 'plain'; name: string; port: number; type: string; fingerprint: string }
  | { kind: 'hashed'; salt: string; hash: string; type: string; fingerprint: string }
  | { kind: 'revoked'; type: string; fingerprint: string };
export interface ParsedKnownHosts { keys: ParsedHostKey[]; skipped: number }

/** Type name at the start of an SSH public key blob, or null if the blob is malformed. */
export function keyType(blob: Buffer): string | null {
  if (blob.length < 4) return null;
  const length = blob.readUInt32BE(0);
  if (length < 1 || length > 64 || 4 + length > blob.length) return null;
  return blob.toString('latin1', 4, 4 + length);
}

/** OpenSSH `|1|` entry: HMAC-SHA1 keyed with the salt over `host` (port 22) or `[host]:port`. */
export function hashedNameMatches(salt: string, hash: string, host: string, port: number): boolean {
  const name = port === 22 ? host : `[${host}]:${port}`;
  return createHmac('sha1', Buffer.from(salt, 'base64')).update(name).digest().equals(Buffer.from(hash, 'base64'));
}

const fingerprintOf = (blob: Buffer): string => `SHA256:${createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')}`;

/** `host` (port 22) or `[host]:port`, lowercased; null for patterns, negations and anything else. */
function plainName(raw: string): { name: string; port: number } | null {
  let name = raw.toLowerCase();
  let port = 22;
  if (name.startsWith('[')) {
    const end = name.indexOf(']:');
    const portText = end < 0 ? '' : name.slice(end + 2);
    if (!PORT.test(portText)) return null;
    port = Number(portText);
    if (port < 1 || port > 65535) return null;
    name = name.slice(1, end);
  }
  return HOST.test(name) ? { name, port } : null;
}

/** 20-byte base64 value, normalized to padded base64; null otherwise. */
function base64Of20(text: string | undefined): string | null {
  if (!text || !BASE64.test(text)) return null;
  const bytes = Buffer.from(text, 'base64');
  return bytes.length === 20 ? bytes.toString('base64') : null;
}

/** Parses an OpenSSH known_hosts text. Untrusted input: linear, bounded, never throws. */
export function parseKnownHosts(text: string): ParsedKnownHosts {
  const keys: ParsedHostKey[] = [];
  let skipped = 0;
  const add = (key: ParsedHostKey): void => { if (keys.length < MAX_PARSED_KEYS) keys.push(key); else skipped += 1; };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.length > MAX_KNOWN_HOSTS_LINE) { skipped += 1; continue; }
    const fields = line.split(/[ \t]+/);
    const marker = fields[0]!.startsWith('@') ? fields.shift() : undefined;
    const [names, type, data] = fields;
    if ((marker !== undefined && marker !== '@revoked') || !names || !type || !data || !KEY_TYPES.has(type) || !BASE64.test(data)) { skipped += 1; continue; }
    const blob = Buffer.from(data, 'base64');
    if (keyType(blob) !== type) { skipped += 1; continue; }
    const fingerprint = fingerprintOf(blob);
    if (marker === '@revoked') { add({ kind: 'revoked', type, fingerprint }); continue; }
    if (names.startsWith('|')) {
      const [empty, magic, saltText, hashText, ...rest] = names.split('|');
      const salt = base64Of20(saltText);
      const hash = base64Of20(hashText);
      if (empty !== '' || magic !== '1' || rest.length > 0 || !salt || !hash) { skipped += 1; continue; }
      add({ kind: 'hashed', salt, hash, type, fingerprint });
      continue;
    }
    for (const part of names.split(',')) {
      const plain = plainName(part);
      if (plain) add({ kind: 'plain', ...plain, type, fingerprint });
      else skipped += 1;
    }
  }
  return { keys, skipped };
}
```

### 3.4 `src/main/ssh/known-hosts.ts` (Task F)
**Schema** ersetzt `KnownHostsSchema` (`:8-11`):
```ts
/** Imported and revoked entries are capped so the store stays well below the 1 MiB read limit. */
export const MAX_STORED_IMPORTED = 1000;
export const MAX_STORED_REVOKED = 200;
const FINGERPRINT = z.string().regex(/^SHA256:[A-Za-z0-9+/]{43}$/);
const KEY_TYPE = z.string().regex(/^[a-z0-9][a-z0-9.@-]{0,63}$/);
const BASE64_20 = z.string().regex(/^[A-Za-z0-9+/]{27}=$/);
const PlainSchema = z.object({ name: z.string().min(1).max(253), port: z.number().int().min(1).max(65535), type: KEY_TYPE, fingerprint: FINGERPRINT }).strict();
const HashedSchema = z.object({ salt: BASE64_20, hash: BASE64_20, type: KEY_TYPE, fingerprint: FINGERPRINT }).strict();
const KnownHostsSchema = z.object({
  version: z.literal(1),
  hosts: z.record(z.string(), FINGERPRINT),
  // Both optional: files of 0.23.0 and earlier have neither; older versions drop them on their next write.
  imported: z.array(z.union([PlainSchema, HashedSchema])).max(MAX_STORED_IMPORTED).optional(),
  revoked: z.array(z.object({ type: KEY_TYPE, fingerprint: FINGERPRINT }).strict()).max(MAX_STORED_REVOKED).optional(),
});
type Stored = z.infer<typeof KnownHostsSchema>;
type Imported = NonNullable<Stored['imported']>[number];

const entryId = (parts: unknown[]): string => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 16);
const confirmedId = (address: string): string => entryId(['confirmed', address]);
const revokedId = (fingerprint: string): string => entryId(['revoked', fingerprint]);
const importedId = (entry: Imported): string =>
  entryId('name' in entry ? ['imported', entry.name, entry.port, entry.fingerprint] : ['imported', entry.salt, entry.hash, entry.fingerprint]);

/** `["host",port]` key of `hosts`, or null if it is not one. */
function addressOf(address: string): { host: string; port: number } | null {
  try {
    const [host, port] = JSON.parse(address) as unknown[];
    return typeof host === 'string' && typeof port === 'number' ? { host, port } : null;
  } catch { return null; }
}
```
Neue Importe: `AppError` (vorhanden), `hostLabel` und die Typen aus `../../shared/known-hosts`, `hashedNameMatches`, `keyType` und `ParsedKnownHosts` aus `./known-hosts-parse`.

**Klasse `KnownHosts`.** `read()` bleibt. `verify` und die neuen Methoden laufen über `enqueue`:
```ts
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task);
    // Keep the queue usable even when one task fails.
    this.queue = result.then(() => {}, () => {});
    return result;
  }

  verify(host: string, port: number, key: Buffer, isActive: () => boolean): Promise<boolean> {
    return this.enqueue(() => this.verifyNext(host, port, key, isActive));
  }

  /** Atomic replace; always writes the whole store so imported and revoked entries survive. */
  private async write(next: Stored): Promise<void> {
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(temporary, JSON.stringify(next), { mode: 0o600, flag: 'wx' });
      await rename(temporary, this.filePath);
    } finally { await rm(temporary, { force: true }); }
  }

  private async verifyNext(host: string, port: number, key: Buffer, isActive: () => boolean): Promise<boolean> {
    const fingerprint = hostFingerprint(key);
    const name = host.toLowerCase();
    const address = JSON.stringify([name, port]);
    let stored = await this.read();
    if (!isActive()) return false;
    if (stored.revoked?.some(entry => entry.fingerprint === fingerprint)) throw new HostKeyError('ssh.hostKeyRevoked');
    const previous = stored.hosts[address];
    if (previous) {
      if (previous !== fingerprint) throw new HostKeyError('ssh.hostKeyChanged', 'changed', { expected: previous, received: fingerprint });
      return true;
    }
    // Imported keys count only for servers Shellherd has not confirmed itself.
    const matches = (stored.imported ?? []).filter(entry => 'name' in entry
      ? entry.name === name && entry.port === port
      : hashedNameMatches(entry.salt, entry.hash, name, port));
    if (matches.some(entry => entry.fingerprint === fingerprint)) return true;
    const sameType = matches.find(entry => entry.type === keyType(key));
    if (sameType) throw new HostKeyError('ssh.hostKeyChanged', 'changed', { expected: sameType.fingerprint, received: fingerprint });
    if (!await this.confirm({ host, port, fingerprint }) || !isActive()) return false;
    // Re-read after the dialog so a concurrent change cannot be overwritten.
    stored = await this.read();
    if (stored.hosts[address] && stored.hosts[address] !== fingerprint) {
      throw new HostKeyError('ssh.hostKeyChangedMeanwhile', 'changed', { expected: stored.hosts[address], received: fingerprint });
    }
    try {
      await this.write({ ...stored, hosts: { ...stored.hosts, [address]: fingerprint } });
    } catch {
      throw new HostKeyError('ssh.hostKeySaveFailed');
    }
    return isActive();
  }

  /** Confirmed, imported and revoked entries, in store order. */
  async list(): Promise<KnownHostView[]> {
    const stored = await this.read();
    const views: KnownHostView[] = [];
    for (const [address, fingerprint] of Object.entries(stored.hosts)) {
      const parsed = addressOf(address);
      if (parsed) views.push({ id: confirmedId(address), host: parsed.host, port: parsed.port, type: null, fingerprint, origin: 'confirmed' });
    }
    for (const entry of stored.imported ?? []) {
      views.push({ id: importedId(entry), host: 'name' in entry ? entry.name : null, port: 'name' in entry ? entry.port : null,
        type: entry.type, fingerprint: entry.fingerprint, origin: 'imported' });
    }
    for (const entry of stored.revoked ?? []) {
      views.push({ id: revokedId(entry.fingerprint), host: null, port: null, type: entry.type, fingerprint: entry.fingerprint, origin: 'revoked' });
    }
    return views;
  }

  private async save(next: Stored): Promise<void> {
    try { await this.write(next); } catch { throw new AppError('ssh.hostKeysSaveFailed'); }
  }

  /** Removes one entry by id; unknown id → core.invalidRequest. The next connection asks again. */
  remove(id: string): Promise<KnownHostView[]> {
    return this.enqueue(async () => {
      const stored = await this.read();
      const hosts = Object.fromEntries(Object.entries(stored.hosts).filter(([address]) => confirmedId(address) !== id));
      const imported = (stored.imported ?? []).filter(entry => importedId(entry) !== id);
      const revoked = (stored.revoked ?? []).filter(entry => revokedId(entry.fingerprint) !== id);
      const removed = Object.keys(stored.hosts).length - Object.keys(hosts).length
        + (stored.imported ?? []).length - imported.length + (stored.revoked ?? []).length - revoked.length;
      if (removed === 0) throw new AppError('core.invalidRequest');
      await this.save({ ...stored, hosts, imported, revoked });
      return this.list();
    });
  }

  /** Adds parsed keys; never replaces or removes anything. Confirmed hosts keep their key (R3.5). */
  importKeys(parsed: ParsedKnownHosts): Promise<{ result: KnownHostsImportResult; hosts: KnownHostView[] }> {
    return this.enqueue(async () => {
      const stored = await this.read();
      const imported = [...(stored.imported ?? [])];
      const revoked = [...(stored.revoked ?? [])];
      const result: KnownHostsImportResult = { added: 0, known: 0, revoked: 0, skipped: parsed.skipped, conflicts: [] };
      const revokedPrints = new Set([...revoked.map(entry => entry.fingerprint),
        ...parsed.keys.flatMap(key => key.kind === 'revoked' ? [key.fingerprint] : [])]);
      const importedIds = new Set(imported.map(importedId));
      // Confirmed address -> fingerprints the file lists for it.
      const filePrints = new Map<string, Set<string>>();
      for (const key of parsed.keys) {
        if (key.kind === 'revoked') {
          if (revoked.some(entry => entry.fingerprint === key.fingerprint)) result.known += 1;
          else if (revoked.length >= MAX_STORED_REVOKED) result.skipped += 1;
          else { revoked.push({ type: key.type, fingerprint: key.fingerprint }); result.revoked += 1; }
          continue;
        }
        if (revokedPrints.has(key.fingerprint)) { result.skipped += 1; continue; }
        if (key.kind === 'plain') {
          const address = JSON.stringify([key.name, key.port]);
          if (stored.hosts[address]) {
            filePrints.set(address, (filePrints.get(address) ?? new Set<string>()).add(key.fingerprint));
            result.known += 1;
            continue;
          }
        }
        const entry: Imported = key.kind === 'plain'
          ? { name: key.name, port: key.port, type: key.type, fingerprint: key.fingerprint }
          : { salt: key.salt, hash: key.hash, type: key.type, fingerprint: key.fingerprint };
        const id = importedId(entry);
        if (importedIds.has(id)) { result.known += 1; continue; }
        if (imported.length >= MAX_STORED_IMPORTED) { result.skipped += 1; continue; }
        imported.push(entry);
        importedIds.add(id);
        result.added += 1;
      }
      for (const [address, prints] of filePrints) {
        const parsedAddress = addressOf(address);
        if (parsedAddress && !prints.has(stored.hosts[address]!) && result.conflicts.length < 20) {
          result.conflicts.push(hostLabel(parsedAddress.host, parsedAddress.port));
        }
      }
      if (result.added > 0 || result.revoked > 0) await this.save({ ...stored, imported, revoked });
      return { result, hosts: await this.list() };
    });
  }
```
Das alte Feld `queue` bleibt, die alte `verify`-Methode entfällt (ersetzt durch die neue oben).

### 3.5 `src/main/ssh/known-hosts-ipc.ts` (neu, Task F)
```ts
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { BrowserWindow, dialog, ipcMain } from 'electron';
import type { IpcMainInvokeEvent, OpenDialogOptions } from 'electron';

import { AppError } from '../../shared/errors';
import { MAX_IMPORT_BYTES } from '../../shared/import';
import { IPC_CHANNELS } from '../../shared/ipc';
import type { KnownHostsImportReply } from '../../shared/known-hosts';
import { mainT } from '../i18n';
import { decodeImport } from '../import-source';
import { vaultSessionManager } from '../vault/ipc';
import { windowRegistry } from '../windows';
import type { KnownHosts } from './known-hosts';
import { parseKnownHosts } from './known-hosts-parse';

const ID = /^[0-9a-f]{16}$/;

/** Server key list for the main window, only while a vault is unlocked: host names reveal what the user works on. */
export function registerKnownHostsIpc(knownHosts: KnownHosts): void {
  const guard = (event: IpcMainInvokeEvent): void => { windowRegistry.requireMain(event); vaultSessionManager.getSnapshot(); };
  ipcMain.handle(IPC_CHANNELS.knownHostsList, event => { guard(event); return knownHosts.list(); });
  ipcMain.handle(IPC_CHANNELS.knownHostsRemove, (event, id: unknown) => {
    guard(event);
    if (typeof id !== 'string' || !ID.test(id)) throw new AppError('core.invalidRequest');
    return knownHosts.remove(id);
  });
  // Reads only the file picked in the native dialog; ~/.ssh is a suggestion, never read on its own.
  ipcMain.handle(IPC_CHANNELS.knownHostsImport, async (event): Promise<KnownHostsImportReply> => {
    guard(event);
    const parent = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      title: mainT('dialogs.importKnownHosts.title'),
      defaultPath: join(homedir(), '.ssh', 'known_hosts'),
      properties: ['openFile', 'showHiddenFiles'],
    };
    const picked = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    const file = picked.filePaths[0];
    if (picked.canceled || !file) return { canceled: true };
    let bytes: Buffer;
    try {
      if ((await stat(file)).size > MAX_IMPORT_BYTES) throw new AppError('core.importTooLarge');
      bytes = await readFile(file);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('core.importUnreadable');
    }
    return { canceled: false, ...(await knownHosts.importKeys(parseKnownHosts(decodeImport(bytes)))) };
  });
}
```
`src/main/index.ts` (Task F, eine Zeile direkt nach `const knownHosts = createKnownHosts();`, `:292`):
```ts
  registerKnownHostsIpc(knownHosts);
```
Dazu kommt der Import `import { registerKnownHostsIpc } from './ssh/known-hosts-ipc';`.

Texte (Task F):

| Datei | Key | de-DE | en-US |
|---|---|---|---|
| `errors/ssh.json` (nach `hostKeyRejected`) | `hostKeyRevoked` | Der Server-Schlüssel ist als widerrufen markiert (@revoked aus einer importierten known_hosts). Verbindung abgebrochen. | The server key is marked as revoked (@revoked from an imported known_hosts). Connection aborted. |
| `errors/ssh.json` | `hostKeysSaveFailed` | Die Server-Schlüssel konnten nicht gespeichert werden. | The server keys could not be saved. |
| `main.json`, Block `dialogs` (nach `importMRemoteNg`) | `importKnownHosts.title` | known_hosts-Datei auswählen | Select known_hosts file |

### 3.6 Vault-Freigabe Main (Task C)

**`src/main/vault/path-grants.ts` (neu):**
```ts
import { win32 } from 'node:path';
import { isVaultFile } from '../file-association';
import { recentKey } from './recent-vaults';

/** Vault paths main may open in this run, keyed like the recent list (resolved, case-insensitive on Windows). */
export class VaultPathGrants {
  private readonly keys = new Set<string>();
  grant(filePath: string): void { this.keys.add(recentKey(filePath)); }
  has(filePath: string): boolean { return this.keys.has(recentKey(filePath)); }
}

/** Grants of this run: native dialog, Explorer argv and checked drops. */
export const vaultPathGrants = new VaultPathGrants();

/** A dropped vault file on a drive letter, resolved; UNC, device and relative paths give null (no SMB without a dialog). */
export function droppedVaultPath(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 4096 || !/^[A-Za-z]:[\\/]/.test(raw)) return null;
  const resolved = win32.resolve(raw);
  return /^[A-Za-z]:\\/.test(resolved) && isVaultFile(resolved) ? resolved : null;
}

/** Open only what came from a grant, the locked session or the recent list; checked before any file access. */
export async function vaultPathAllowed(filePath: string, grants: VaultPathGrants, lockedPath: string | undefined,
  inRecent: (filePath: string) => Promise<boolean>): Promise<boolean> {
  if (grants.has(filePath)) return true;
  if (lockedPath !== undefined && recentKey(lockedPath) === recentKey(filePath)) return true;
  return inRecent(filePath);
}
```

**`src/main/vault/recent-vaults.ts`:**
- In `missing()` (`:61`) ersetzen:
  ```ts
  // Any two leading slashes are UNC on Windows (\\srv, //srv, \/srv): never probe them.
  if (/^[\\/]{2}/.test(filePath)) return false;
  ```
- Neue Methode nach `latest()`:
  ```ts
  /** True if filePath is in the stored list (same recentKey). Reads settings.json only, never the file itself. */
  async has(filePath: string): Promise<boolean> {
    const key = recentKey(filePath);
    return (await this.entries()).some(entry => recentKey(entry.filePath) === key);
  }
  ```

**`src/main/vault/ipc.ts`:**
- Import: `import { droppedVaultPath, vaultPathAllowed, vaultPathGrants } from './path-grants';`
- `selectVaultFile`: direkt vor dem abschließenden `return { canceled: false, filePath }` die Zeile `vaultPathGrants.grant(filePath);`.
- `unlockVault`: Direkt nach `const previous = vaultSessionManager.lockedVault();` (`:184`) und vor `vaultSessionManager.unlock(...)`:
  ```ts
  // Renderer paths are untrusted: a UNC path alone would send the Windows login hash to its server.
  if (!await vaultPathAllowed(request.filePath, vaultPathGrants, previous?.filePath, path => recent.has(path))) {
    throw new AppError('core.vaultPathNotAllowed');
  }
  ```
- Neuer Handler nach `removeRecentVault` (`:67`):
  ```ts
  handle(IPC_CHANNELS.vaultDropFile, (_event, raw: unknown) => {
    const filePath = droppedVaultPath(raw);
    if (!filePath) throw new AppError('core.vaultPathNotAllowed');
    vaultPathGrants.grant(filePath);
    return filePath;
  });
  ```
  `guard` (nur das Hauptfenster) greift über `handle` automatisch.

**Texte** in `src/shared/locales/{de-DE,en-US}/errors/core.json`, nach `vaultFileMissing`:
- de: `"vaultPathNotAllowed": "Shellherd öffnet diese Datei nur über „Vault-Datei auswählen“."`
- en: `"vaultPathNotAllowed": "Shellherd opens this file only via “Select vault file”."`

### 3.7 `src/main/index.ts` (Task D)
- Import: `import { vaultPathGrants } from './vault/path-grants';`
- `:213` ersetzen:
  ```ts
  let launchFile = vaultFileFromArgs(process.argv);
  // Explorer passed it: the user's click, so main may open it.
  if (launchFile) vaultPathGrants.grant(launchFile);
  ```
- In `second-instance` (`:219-220`): `if (file) { vaultPathGrants.grant(file); main.webContents.send(IPC_CHANNELS.vaultOpenFile, file); }`
- Direkt nach `announce` (`:348`) einfügen:
  ```ts
  // While locked, every Shellherd window is left out of screen capture and sharing (Windows: WDA_EXCLUDEFROMCAPTURE).
  const protectWindows = (on: boolean): void => {
    for (const target of [windowRegistry.main(), ...windowRegistry.secondaries()]) if (target && !target.isDestroyed()) target.setContentProtection(on);
  };
  ```
- `registerVaultIpcHandlers` (`:349-355`):
  ```ts
    onSessionChange: () => { closeAllSessions(); closeSecondaryWindows(); protectWindows(false); },
    onLock: () => { protectWindows(true); authPrompts?.cancelAll(); announce(IPC_CHANNELS.vaultLocked, {} satisfies VaultLockedInfo); },
    onUnlock: () => { protectWindows(false); autoLock?.touch(); announce(IPC_CHANNELS.vaultUnlocked); },
  ```
- `AutoLock.lock` (`:358`):
  ```ts
    lock: minutes => { try { vaultSessionManager.lock(); } finally { protectWindows(true); authPrompts?.cancelAll(); announce(IPC_CHANNELS.vaultLocked, { minutes } satisfies VaultLockedInfo); } },
  ```
  `protectWindows` muss vor `autoLock = new AutoLock(...)` definiert sein. Das ist erfüllt, wenn es direkt nach `announce` steht.

### 3.8 Renderer (Tasks H1 und H2)

**`src/renderer/src/known-hosts-view.ts` (neu, H1):**
```ts
import { compareText, foldCase } from '../../shared/format';
import { hostLabel } from '../../shared/known-hosts';
import type { KnownHostOrigin, KnownHostView } from '../../shared/known-hosts';
import { t } from './i18n';

/** Shown name: host[:port]; hashed names and revoked keys get a fixed text. */
export function knownHostName(view: KnownHostView): string {
  if (view.origin === 'revoked') return t('app:hostKeys.anyHost');
  return view.host === null || view.port === null ? t('app:hostKeys.hashed') : hostLabel(view.host, view.port);
}

/** Full literals, so unused keys can be found by search. */
export const originLabel = (origin: KnownHostOrigin): string => ({
  confirmed: t('app:hostKeys.origin.confirmed'),
  imported: t('app:hostKeys.origin.imported'),
  revoked: t('app:hostKeys.origin.revoked'),
})[origin];

const rank = (view: KnownHostView): number => view.origin === 'revoked' ? 2 : view.host === null ? 1 : 0;

/** Named entries by name, then hashed, then revoked; store order inside the last two groups. */
export function sortKnownHosts(list: readonly KnownHostView[]): KnownHostView[] {
  return [...list].sort((a, b) => rank(a) - rank(b) || (rank(a) === 0 ? compareText(knownHostName(a), knownHostName(b)) : 0));
}

/** "Contains" on name, type and fingerprint, ignoring case; an empty query matches everything. */
export function matchesKnownHost(view: KnownHostView, query: string): boolean {
  const needle = foldCase(query.trim());
  return !needle || [knownHostName(view), view.type ?? '', view.fingerprint].some(text => foldCase(text).includes(needle));
}
```

**`src/renderer/src/components/KnownHostsDialog.tsx` (neu, H1):**
```tsx
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KnownHostView } from '../../../shared/known-hosts';
import { formatNumber } from '../../../shared/format';
import { errorText } from '../error-text';
import { useNativeSurfaceBlock } from '../native-surface';
import { useT } from '../i18n';
import { knownHostName, matchesKnownHost, originLabel, sortKnownHosts } from '../known-hosts-view';
import '../settings-ui.css';

export interface KnownHostsDialogProps { busy: boolean; onClose: () => void }

/** Confirmed, imported and revoked server keys: search, remove, import a known_hosts file. */
export function KnownHostsDialog({ busy, onClose }: KnownHostsDialogProps) {
  const { t } = useT();
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [hosts, setHosts] = useState<KnownHostView[] | null>(null);
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean; conflicts?: string } | null>(null);
  useNativeSurfaceBlock(true);
  useEffect(() => {
    dialogRef.current?.showModal();
    searchRef.current?.focus();
    void window.desktopApi.knownHostsList().then(setHosts, error => {
      setHosts([]);
      setMessage({ text: errorText(error, t('app:hostKeys.loadFailed')), error: true });
    });
  }, []);
  const sorted = useMemo(() => sortKnownHosts(hosts ?? []), [hosts]);
  const shown = useMemo(() => sorted.filter(view => matchesKnownHost(view, query)), [sorted, query]);
  const locked = busy || pending;

  async function importFile(): Promise<void> {
    setPending(true);
    setMessage(null);
    try {
      const reply = await window.desktopApi.knownHostsImport();
      if (reply.canceled) return;
      const { added, known, revoked, skipped, conflicts } = reply.result;
      setHosts(reply.hosts);
      setMessage({
        text: t('app:hostKeys.importDone', { added: formatNumber(added), known: formatNumber(known), revoked: formatNumber(revoked), skipped: formatNumber(skipped) }),
        error: false,
        conflicts: conflicts.length ? t('app:hostKeys.conflicts', { hosts: conflicts.join(', ') }) : undefined,
      });
    } catch (error) {
      setMessage({ text: errorText(error, t('app:hostKeys.importFailed')), error: true });
    } finally {
      setPending(false);
    }
  }

  async function remove(view: KnownHostView): Promise<void> {
    setPending(true);
    setMessage(null);
    try {
      setHosts(await window.desktopApi.knownHostsRemove(view.id));
    } catch (error) {
      setMessage({ text: errorText(error, t('app:hostKeys.removeFailed')), error: true });
    } finally {
      setPending(false);
      searchRef.current?.focus();
    }
  }

  return (
    <dialog ref={dialogRef} className="confirm-dialog settings-dialog known-hosts-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-intro`}
      onCancel={event => { event.preventDefault(); if (!locked) onClose(); }}>
      <h2 id={`${id}-title`}>{t('app:hostKeys.title')}</h2>
      <p className="settings-hint" id={`${id}-intro`}>{t('app:hostKeys.intro')}</p>
      <div className="known-hosts-tools">
        <input ref={searchRef} type="text" spellCheck={false} maxLength={256} value={query}
          aria-label={t('app:hostKeys.search')} placeholder={t('app:hostKeys.searchPlaceholder')}
          onChange={event => setQuery(event.target.value)} />
        <button type="button" className="secondary-button" disabled={locked} onClick={() => void importFile()}>{t('app:hostKeys.import')}</button>
      </div>
      {message && <div className={message.error ? 'field-error known-hosts-message' : 'settings-hint known-hosts-message'} role={message.error ? 'alert' : 'status'}>
        <p>{message.text}</p>
        {message.conflicts && <p>{message.conflicts}</p>}
      </div>}
      {hosts && (shown.length > 0
        ? <ul className="known-hosts-list">
          {shown.map(view => <li key={view.id}>
            <div>
              <strong>{knownHostName(view)}</strong>
              <small>{view.type ? `${view.type} · ${originLabel(view.origin)}` : originLabel(view.origin)}</small>
            </div>
            <code>{view.fingerprint}</code>
            <button type="button" className="danger-button" disabled={locked}
              aria-label={t('app:hostKeys.removeLabel', { host: knownHostName(view) })} onClick={() => void remove(view)}>{t('app:hostKeys.remove')}</button>
          </li>)}
        </ul>
        : <p className="settings-hint">{hosts.length ? t('app:hostKeys.noMatch') : t('app:hostKeys.empty')}</p>)}
      <div className="form-actions">
        <span className="settings-hint">{t('app:hostKeys.shown', { shown: formatNumber(shown.length), total: formatNumber(hosts?.length ?? 0) })}</span>
        <button type="button" className="primary-button" disabled={locked} onClick={onClose}>{t('common:actions.close')}</button>
      </div>
    </dialog>
  );
}
```

**`src/renderer/src/settings-ui.css` (H1), am Ende:**
```css
/* Server keys: search row, one row per key; fingerprints stay selectable for comparison. No motion. */
.settings-host-keys { margin-top: var(--space-12); }
.known-hosts-tools { display: flex; gap: var(--space-8); margin: var(--space-12) 0 var(--space-8); }
.known-hosts-tools input { flex: 1; min-width: 0; }
.known-hosts-message p { margin: 0 0 var(--space-4); }
.known-hosts-list { display: grid; gap: var(--space-6); margin: 0; padding: 0; list-style: none; }
.known-hosts-list li { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: var(--space-4) var(--space-8); padding: var(--space-8) var(--space-10); border: 1px solid var(--color-border); border-radius: var(--radius-md); }
.known-hosts-list li > div { display: grid; min-width: 0; }
.known-hosts-list strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-text); font-size: var(--fs-md); }
.known-hosts-list small { color: var(--color-text-muted); font-size: var(--fs-sm); }
.known-hosts-list code { grid-column: 1; overflow-wrap: anywhere; user-select: text; color: var(--color-text-muted); font-family: var(--font-mono); font-size: var(--fs-sm); }
.known-hosts-list button { grid-column: 2; grid-row: 1 / span 2; min-height: var(--control-sm); height: var(--control-sm); padding: 0 var(--space-10); font-size: var(--fs-sm); }
.known-hosts-dialog .form-actions { justify-content: space-between; align-items: center; }
```

**`SettingsDialog.tsx` (H2):**
- In den Props kommt `onManageHostKeys: () => void;` dazu. `initialFocus` wird zu `'close' | 'manageAi' | 'manageHostKeys'`.
- Neu ist `const hostKeysRef = useRef<HTMLButtonElement>(null);`.
- Fokus im Mount-Effekt:
  ```ts
  const first = initialFocus === 'manageAi' ? manageRef.current : initialFocus === 'manageHostKeys' ? hostKeysRef.current : null;
  (first ?? closeRef.current)?.focus();
  ```
- Im Abschnitt `connections`, direkt nach `<p … id={`${id}-timeouts-hint`}>` (`:163`):
  ```tsx
  <button ref={hostKeysRef} type="button" className="secondary-button settings-host-keys" disabled={busy}
    aria-describedby={`${id}-hostkeys-hint`} onClick={onManageHostKeys}>{t('app:settings.hostKeys.manage')}</button>
  <p className="settings-hint" id={`${id}-hostkeys-hint`}>{t('app:settings.hostKeys.hint')}</p>
  ```

**`App.tsx` (H2):**
- `AppDialog` (`:85-87`): `focus: 'close' | 'manageAi' | 'manageHostKeys'` und eine neue Variante `| { kind: 'hostKeys' }`.
- `settingsDialog` (`:831-834`): `onManageHostKeys={() => { if (settingsVault) setAppDialog({ kind: 'hostKeys' }); }}`.
- Nach dem `AiSettingsDialog`-Block (`:958-960`):
  ```tsx
  {appDialog?.kind === 'hostKeys' && <KnownHostsDialog busy={busy}
    onClose={() => setAppDialog({ kind: 'settings', instant: true, focus: 'manageHostKeys' })} />}
  ```
  Dazu der Import `import { KnownHostsDialog } from './components/KnownHostsDialog';`.
- Drop (`:275-278`) ersetzen:
  ```ts
  const file = [...event.dataTransfer!.files].find(item => isVaultFileName(item.name));
  const path = file ? window.desktopApi.pathForFile(file) : '';
  if (!path) { notify.info(t('app:notices.notVaultFileTitle'), { body: t('app:errors.onlyVaultFiles') }); return; }
  // Main grants dropped files on local drives only; network paths go through the file dialog.
  void window.desktopApi.dropVaultFile(path).then(
    granted => openVaultFileRef.current(granted),
    error => notify.info(t('app:notices.vaultPathRefusedTitle'), { body: errorText(error) }));
  ```
  `errorText` ist in `App.tsx` schon importiert. Falls nicht, kommt der Import aus `./error-text`.

### 3.9 Texte (H1 legt alle `app.json`-Keys an, H1/H2 benutzen sie)

`src/shared/locales/{de-DE,en-US}/app.json`. Neuer Block `hostKeys` auf oberster Ebene, `settings.hostKeys` im Block `settings`, `notices.vaultPathRefusedTitle` im Block `notices`:

| Key | de-DE | en-US |
|---|---|---|
| `settings.hostKeys.manage` | Server-Schlüssel verwalten | Manage server keys |
| `settings.hostKeys.hint` | Bestätigte und importierte Server-Schlüssel ansehen, durchsuchen und entfernen; OpenSSH-known_hosts übernehmen. | View, search and remove confirmed and imported server keys; import an OpenSSH known_hosts. |
| `notices.vaultPathRefusedTitle` | Vault-Datei nicht geöffnet | Vault file not opened |
| `hostKeys.title` | Server-Schlüssel | Server keys |
| `hostKeys.intro` | Shellherd vertraut diesen Schlüsseln beim Verbinden. Entfernst du einen, fragt Shellherd beim nächsten Verbinden wieder nach. | Shellherd trusts these keys when connecting. Remove one and Shellherd asks again on the next connection. |
| `hostKeys.search` | Server-Schlüssel durchsuchen | Search server keys |
| `hostKeys.searchPlaceholder` | Host, Typ oder Fingerprint … | Host, type or fingerprint… |
| `hostKeys.import` | Aus known_hosts importieren … | Import from known_hosts… |
| `hostKeys.importDone` | Import: {{added}} neu, {{known}} schon bekannt, {{revoked}} widerrufen, {{skipped}} übersprungen. | Import: {{added}} new, {{known}} already known, {{revoked}} revoked, {{skipped}} skipped. |
| `hostKeys.conflicts` | Shellherd kennt für diese Server einen anderen Schlüssel und behält ihn: {{hosts}} | Shellherd knows a different key for these servers and keeps it: {{hosts}} |
| `hostKeys.hashed` | Gehashter Hostname | Hashed host name |
| `hostKeys.anyHost` | Alle Hosts | All hosts |
| `hostKeys.origin.confirmed` | Bestätigt | Confirmed |
| `hostKeys.origin.imported` | Importiert | Imported |
| `hostKeys.origin.revoked` | Widerrufen | Revoked |
| `hostKeys.remove` | Entfernen | Remove |
| `hostKeys.removeLabel` | {{host}} entfernen | Remove {{host}} |
| `hostKeys.empty` | Noch keine Server-Schlüssel gespeichert. | No server keys stored yet. |
| `hostKeys.noMatch` | Keine Treffer. | No matches. |
| `hostKeys.shown` | {{shown}} von {{total}} | {{shown}} of {{total}} |
| `hostKeys.loadFailed` | Die Server-Schlüssel konnten nicht geladen werden. | The server keys could not be loaded. |
| `hostKeys.importFailed` | Der Import ist fehlgeschlagen. | The import failed. |
| `hostKeys.removeFailed` | Der Schlüssel konnte nicht entfernt werden. | The key could not be removed. |

`src/shared/locales/{de-DE,en-US}/terminal.json` (H2), nur `connectionError.hostkey-changed.next` ändern:
- de: „Kläre den Schlüsselwechsel mit dem Administrator. Ist er gewollt, entferne den alten Schlüssel unter Einstellungen → Verbindungen → Server-Schlüssel verwalten und verbinde neu.“
- en: “Clarify the key change with the administrator. If it is intended, remove the old key under Settings → Connections → Manage server keys and connect again.”

---

## 4. Zerlegung (exklusive Dateien, Wellen)

Gate nach **jeder** Welle: `npm run typecheck` und `npx vitest run` vollständig grün. Innerhalb einer Welle dürfen Tasks auf den Vertrag eines Nachbar-Tasks derselben Welle verweisen; geprüft wird erst nach der Welle. Umsetzer schreiben nur ihre Dateien und committen nie.

| Task | Dateien (exklusiv) | Inhalt | Welle | hängt ab von |
|---|---|---|---|---|
| **A** Vertrag | `src/shared/known-hosts.ts` (neu) + `.test.ts` (neu), `src/shared/ipc.ts`, `src/preload/index.ts` | 3.1, 3.2 | 1 | – |
| **B** Parser | `src/main/ssh/known-hosts-parse.ts` (neu) + `.test.ts` (neu) | 3.3, Tests 10.1 | 1 | – |
| **C** Vault-Freigabe | `src/main/vault/path-grants.ts` (neu) + `.test.ts` (neu), `src/main/vault/recent-vaults.ts` + `.test.ts`, `src/main/vault/ipc.ts`, `src/shared/locales/{de-DE,en-US}/errors/core.json` | 3.6, Tests 10.3 | 1 | A (`IPC_CHANNELS.vaultDropFile`) |
| **D** Fensterschutz | `src/main/index.ts` | 3.7 | 1 | C (`vaultPathGrants`) |
| **E** Doku | `docs/handbuch.md`, `docs/manual.md`, `CHANGELOG.md`, `CHANGELOG.en.md`, `package.json` + `package-lock.json` (nur Root-Version 0.24.0) | Abschnitt 5 | 1 | – |
| **F** Speicher und IPC | `src/main/ssh/known-hosts.ts` + `.test.ts`, `src/main/ssh/known-hosts-ipc.ts` (neu), `src/main/index.ts` (nur die Zeile aus 3.5 und ihr Import), `src/shared/locales/{de-DE,en-US}/errors/ssh.json`, `src/shared/locales/{de-DE,en-US}/main.json` | 3.4, 3.5, Tests 10.2 | 2 | A, B |
| **H1** Dialog | `src/renderer/src/known-hosts-view.ts` (neu) + `.test.ts` (neu), `src/renderer/src/components/KnownHostsDialog.tsx` (neu), `src/renderer/src/settings-ui.css`, `src/shared/locales/{de-DE,en-US}/app.json` | 3.8 (ohne Settings und App), 3.9 `app.json` | 2 | A |
| **H2** Einbindung | `src/renderer/src/components/SettingsDialog.tsx`, `src/renderer/src/App.tsx`, `src/shared/locales/{de-DE,en-US}/terminal.json` | 3.8 (Settings, App), 3.9 `terminal.json` | 2 | A, H1 (Keys, Komponente) |
| **I** Demo | `.claude/skills/run-app/import-fixtures.mjs`, `.claude/skills/run-app/screens.mjs`, `.claude/skills/run-app/SKILL.md` | Abschnitt 6 | 3 | alle |

- `index.ts` ändern D (Welle 1) und F (Welle 2) nacheinander, also nie gleichzeitig.
- Die Keys `settings.hostKeys.*` und `notices.vaultPathRefusedTitle` legt H1 an, benutzt werden sie in H2 (dieselbe Welle). Der Orphan-Test läuft erst am Wellenende.
- Die Fehlertexte kommen jeweils mit dem Task, der den Code wirft (C: `core`, F: `ssh`), damit kein Key verwaist.
- Nach Welle 3 folgen run-app nach Abschnitt 6 und die manuelle Prüfung M1. Alle Screenshots werden angesehen.

---

## 5. Doku (Task E)

**Handbuch `docs/handbuch.md`:**

1. Abschnitt „Zuletzt benutzte Vaults“ (`:64-66`): Am Ende einen Absatz anhängen:
   > Shellherd öffnet eine Vault-Datei nur, wenn sie über `Vault-Datei auswählen`, per Doppelklick im Explorer, aus `Zuletzt benutzt` oder per Ziehen von einem lokalen Laufwerk kommt. Eine Vault-Datei auf einer Netzwerkfreigabe (`\\server\…`) öffnest du einmal über `Vault-Datei auswählen`; danach steht sie in `Zuletzt benutzt`. Ziehen von einer Netzwerkfreigabe lehnt Shellherd ab. So kann eingeschleuster Code Shellherd keine Netzwerkanmeldung an einem fremden Server auslösen lassen.
2. Abschnitt „Sperren und Willkommens-Tab“, Liste nach „Zugangsdaten im Speicher“ (`:72`): einen Punkt einfügen:
   > - **Bildschirmaufnahmen:** Während der Sperre nimmt Shellherd alle seine Fenster aus Bildschirmaufnahmen und -freigaben heraus (Teams, Zoom, Snipping Tool); dort erscheint stattdessen der Hintergrund. Nach dem Entsperren ist das wieder aufgehoben. Fotos des Bildschirms und die Vorschau eines minimierten Fensters in der Taskleiste deckt das nicht sicher ab.

   Den letzten Satz passt der Orchestrator nach dem Ergebnis von M1 an. Ist die Vorschau leer, lautet er „Fotos des Bildschirms deckt das nicht ab.“
3. Abschnitt „Server-Schlüssel“ (`:611-622`) ersetzen durch:
   > Beim ersten Kontakt den angezeigten SHA-256-Fingerprint mit einer vertrauenswürdigen Quelle vergleichen. Nur ausdrücklich bestätigte Schlüssel werden in `known-hosts.json` im Electron-Benutzerdatenverzeichnis gespeichert. Diese Datei enthält Hosts, Ports und öffentliche Fingerprints, keine Zugangsdaten. Sie liegt unter `%APPDATA%\Shellherd\known-hosts.json`; beim ersten Start übernimmt Shellherd sie einmalig aus `%APPDATA%\Terminus`. Abweichende Schlüssel und beschädigte Vertrauensdateien brechen die Verbindung ab.
   >
   > Einstellungen → Verbindungen → `Server-Schlüssel verwalten` zeigt alle bestätigten und importierten Schlüssel mit Host, Port, Typ und SHA-256-Fingerprint. Das Suchfeld filtert nach Host, Typ oder Fingerprint. `Entfernen` löscht einen Eintrag sofort; beim nächsten Verbinden fragt Shellherd wieder nach. So nimmst du einen gewollten Schlüsselwechsel an: alten Eintrag entfernen, neu verbinden, den neuen Fingerprint prüfen und bestätigen.
   >
   > `Aus known_hosts importieren …` liest eine OpenSSH-Datei, die du im Dialog wählst (vorgeschlagen: `%USERPROFILE%\.ssh\known_hosts`, höchstens 4 MiB). Übernommen werden Hostnamen, `[host]:port` und gehashte Namen (`|1|…`) mit Ed25519-, ECDSA- und RSA-Schlüsseln, auch mehrere je Server. Gehashte Einträge zeigt die Liste als „Gehashter Hostname“. `@revoked`-Zeilen gelten für alle Hosts: Einen so markierten Schlüssel nimmt Shellherd nie an, auch nicht nach Rückfrage. Übersprungen werden `@cert-authority`, Muster wie `*.example.com` oder `!host`, Zertifikate und Sicherheitsschlüssel (`sk-…`). Der Import ändert keinen Schlüssel, den du in Shellherd bestätigt hast: Für solche Server gilt weiter Shellherds Eintrag, und weicht die Datei davon ab, nennt das Ergebnis den Server. Shellherd liest `known_hosts` nur nach diesem Klick und schreibt sie nie.

**Manual `docs/manual.md`:** dieselben drei Stellen auf Englisch, mit den englischen UI-Texten aus 3.9 (`Manage server keys`, `Import from known_hosts…`, `Select vault file`, „Hashed host name“). Die Stelle „Server keys“ steht bei `:600-610`.

**CHANGELOG.md**, Abschnitt `## [0.24.0] – <Datum des Merges>`:
- Neu: Einstellungen → Verbindungen → `Server-Schlüssel verwalten` listet alle bestätigten und importierten Server-Schlüssel mit SHA-256-Fingerprint, mit Suche und `Entfernen`. Ein gewollter Schlüsselwechsel lässt sich so annehmen.
- Neu: Import aus OpenSSH `known_hosts`, auch mit gehashten Namen, `[host]:port` und mehreren Schlüsseltypen. `@revoked` wird beachtet, `@cert-authority` und Muster werden übersprungen. In Shellherd bestätigte Schlüssel ändert der Import nie.
- Sicherheit: Während der Sperre sind alle Shellherd-Fenster aus Bildschirmaufnahmen und -freigaben herausgenommen.
- Sicherheit: Shellherd öffnet Vault-Dateien nur aus dem Dateidialog, dem Explorer, `Zuletzt benutzt` oder per Ziehen von einem lokalen Laufwerk. Netzwerkpfade aus anderen Quellen werden abgelehnt.

**CHANGELOG.en.md**: dieselben vier Punkte auf Englisch.

---

## 6. run-app-Szenen (Task I, Abnahme)

Es gibt nur synthetische Daten. Weder der echte `~/.ssh/known_hosts` noch `%APPDATA%\Shellherd` wird je gelesen. Die Fixture liegt in `%TEMP%\shellherd-run\import\known_hosts`, die App läuft mit dem isolierten Profil.

### 6.0 Fixture in `import-fixtures.mjs`
Oben ergänzen:
```js
import { createHash, createHmac } from 'node:crypto';
```
Vor `writeImportFixtures`:
```js
// Synthetic known_hosts: deterministic made-up keys, one line per parser case (see haertung research 6.0).
const bytes = (label, length) => Buffer.concat([0, 1, 2, 3, 4].map(i => createHash('sha512').update(`${label}:${i}`).digest())).subarray(0, length);
const sshString = value => { const head = Buffer.alloc(4); const body = Buffer.from(value); head.writeUInt32BE(body.length); return Buffer.concat([head, body]); };
const keyBlob = (type, ...parts) => Buffer.concat([sshString(type), ...parts.map(sshString)]).toString('base64');
const ed25519 = label => keyBlob('ssh-ed25519', bytes(label, 32));
const SALT = bytes('salt', 20);
const KNOWN_HOSTS = [
  '# Synthetic demo data only',
  `build-01,10.20.0.11 ssh-ed25519 ${ed25519('build-01')} demo`,
  `[db-01]:2200 ecdsa-sha2-nistp256 ${keyBlob('ecdsa-sha2-nistp256', 'nistp256', Buffer.concat([Buffer.from([4]), bytes('db-01', 64)]))}`,
  `|1|${SALT.toString('base64')}|${createHmac('sha1', SALT).update('legacy-01').digest('base64')} ssh-ed25519 ${ed25519('legacy-01')}`,
  `[127.0.0.1]:2222 ssh-ed25519 ${ed25519('demo-conflict')}`,
  `@revoked * ssh-rsa ${keyBlob('ssh-rsa', Buffer.from([1, 0, 1]), Buffer.concat([Buffer.from([0]), bytes('revoked', 256)]))}`,
  `@cert-authority *.example.internal ssh-ed25519 ${ed25519('ca')}`,
  `*.internal ssh-ed25519 ${ed25519('pattern')}`,
  'web-02 ssh-ed25519 !!!notbase64',
].join('\n') + '\n';
```
In `writeImportFixtures`: `knownHosts: path.join(dir, 'known_hosts')` in `files` aufnehmen und `fs.writeFileSync(files.knownHosts, KNOWN_HOSTS, 'utf8');` schreiben.

Erwartetes Ergebnis, wenn `127.0.0.1:2222` schon bestätigt ist:
- 4 neu: `build-01`, `10.20.0.11`, `db-01:2200` und der gehashte `legacy-01`
- 1 schon bekannt (Demo-Server), als Konflikt `127.0.0.1:2222`
- 1 widerrufen
- 3 übersprungen

Ist der Demo-Server noch nicht bestätigt: 5 neu, 0 schon bekannt, kein Konflikt.

### 6.1 Block `lock` erweitern (Fensterschutz)
- Nach `waitFor('Sperrbildschirm', …)` (`screens.mjs:330`):
  ```js
  const protectedNow = await call('main', 'return electron.BrowserWindow.getAllWindows().filter(w => !w.isDestroyed() && w.isVisible()).map(w => w.isContentProtected())');
  if (!protectedNow.length || protectedNow.includes(false)) throw new Error(`Fensterschutz fehlt während der Sperre: ${JSON.stringify(protectedNow)}`);
  ```
- Der vorhandene Shot `lock-screen.png` bleibt unverändert. **Ansehen:** Er muss den Sperrbildschirm zeigen und darf nicht schwarz oder leer sein. Das belegt R1.5.
- Nach dem erfolgreichen Entsperren (`:364`) folgt dieselbe Abfrage mit der Erwartung `every(v => v === false)`, sonst `throw new Error('Fensterschutz bleibt nach dem Entsperren')`.
- Diagnose ohne Gate, die Ausgabe geht ins Log und ins Ledger:
  ```js
  console.log('Capture-Probe:', await call('main', "const s = await electron.desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 64, height: 40 } }); return s.map(x => x.name);"));
  ```
  Einmal während und einmal nach der Sperre ausführen. Erwartet ist, dass während der Sperre kein Shellherd-Fenster oder nur ein leeres in der Liste steht.

### 6.2 Block `lock-secondary` erweitern
Nach `waitFor('Sperrbildschirm im Nebenfenster', …)` dieselbe Abfrage wie 6.1. Es müssen mindestens 2 Werte kommen, alle `true`. Nach `waitFor('Nebenfenster entsperrt', …)` müssen alle `false` sein.

### 6.3 Neuer Block `vault-path` (ohne Screenshot, nur Prüfungen; Vault entsperrt)
```js
async 'vault-path'() {
  // UNC to 127.0.0.1 only: even a broken check would not reach a foreign server.
  const result = await evaluate(`(async () => {
    const msg = p => p.then(() => 'ok', e => String(e?.message ?? e));
    return [
      await msg(window.desktopApi.unlockVault({ filePath: '\\\\\\\\127.0.0.1\\\\nope\\\\x.term', password: 'x' })),
      await msg(window.desktopApi.unlockVault({ filePath: '//127.0.0.1/nope/x.term', password: 'x' })),
      await msg(window.desktopApi.unlockVault({ filePath: 'C:\\\\nope\\\\never-granted.term', password: 'x' })),
      await msg(window.desktopApi.dropVaultFile('\\\\\\\\127.0.0.1\\\\nope\\\\x.term')),
      await window.desktopApi.dropVaultFile('C:/nope/x.term'),
    ];
  })()`);
  if (!result.slice(0, 4).every(text => text.includes('vaultPathNotAllowed'))) throw new Error(`Freigabeliste greift nicht: ${JSON.stringify(result)}`);
  if (result[4] !== 'C:\\nope\\x.term') throw new Error(`Drop vom Laufwerk nicht freigegeben: ${result[4]}`);
},
```
Der Zugang über `Zuletzt benutzt` ist schon durch `demo-setup.mjs` belegt, denn der vorausgewählte `demo.term` muss sich weiter öffnen lassen. Die Blöcke `lock` und `recent` belegen den Sperrbildschirm und die Liste.

### 6.4 Neuer Block `host-keys` (drei Shots)
1. **Aufräumen vorab** (falls ein Lauf abgebrochen ist):
   ```js
   const cleanup = () => evaluate(`(async () => { for (const h of await window.desktopApi.knownHostsList()) if (h.origin !== 'confirmed') await window.desktopApi.knownHostsRemove(h.id); })()`);
   await cleanup();
   ```
2. Den Demo-Server einmal bestätigen lassen, falls noch nicht geschehen: Ist `knownHostsList()` ohne `confirmed`-Eintrag, `web-01` öffnen (wie im Block `lock`: `click('text=web-01 >> nth=0')`, `key('Enter')`, auf `connectedTab` warten) und dann `closeTabs()`.
3. `click('.settings-button')` → `click('dialog.settings-dialog button:has-text("Server-Schlüssel verwalten")')` → warten auf `dialog.known-hosts-dialog[open]` und `${count('.known-hosts-list li')} >= 1`. `pause(300)`, Shot **`host-keys.png`**.
4. `await setOpenDialog(path.join(IMPORT_DIR, 'known_hosts'));` und `try { … } finally { await setOpenDialog(VAULT_FILE); await cleanup(); }` um die Schritte 4 bis 6.
   - `click('dialog.known-hosts-dialog button:has-text("Aus known_hosts importieren")')`.
   - Warten, bis `document.querySelector('.known-hosts-dialog [role=status]')?.textContent.includes('übersprungen')`.
   - Den Text prüfen: Er muss `1 widerrufen` und `3 übersprungen` enthalten, außerdem entweder `4 neu` zusammen mit `1 schon bekannt` und `127.0.0.1:2222` oder `5 neu`. Sonst `throw`.
   - `pause(300)`, Shot **`host-keys-import.png`**.
5. `fill('dialog.known-hosts-dialog .known-hosts-tools input', 'build')` → warten auf `${count('.known-hosts-list li')} === 1`. Shot **`host-keys-search.png`**.
6. `fill(…, '')`. Prüfen, dass ein Eintrag mit „Gehashter Hostname“ und einer mit „Alle Hosts“ in der Liste stehen.
7. Schließen: `click('dialog.known-hosts-dialog > .form-actions .primary-button')` → warten, bis `dialog.settings-dialog[open]` wieder da ist und `document.activeElement` den Text „Server-Schlüssel verwalten“ hat. Danach `key('Escape')` und warten, bis die Einstellungen geschlossen sind.

**Pflicht:** `setOpenDialog(VAULT_FILE)` im `finally`. Sonst antwortet der Dialog in späteren Blöcken mit der known_hosts-Datei, und `Vault-Datei auswählen` scheitert.

### 6.5 `SKILL.md`
- In beide Listen (`:24` und `:34`) kommen `host-keys.png`, `host-keys-import.png` und `host-keys-search.png`, in die Blockliste `vault-path` und `host-keys`.
- Unter „Stolpersteine“ kommt ein Punkt:
  > Während der Sperre ist jedes Shellherd-Fenster aus Bildschirmaufnahmen herausgenommen. Treiber-Shots (`/ss`, `page.screenshot`) betrifft das nicht; eine Aufnahme mit dem Snipping Tool zeigt dann den Desktop. Für die Abnahme zählen nur Treiber-Shots.

### 6.6 Manuelle Prüfung M1 (Orchestrator, nicht Haiku)
1. App aus run-app starten, Auto-Sperre auf 1 Minute, Fenster minimieren und warten.
2. Über das Taskleistensymbol fahren und Alt+Tab drücken. Ins Ledger kommt: Ist die Vorschau leer, schwarz oder zeigt sie den alten Inhalt? Danach den Handbuchsatz aus Abschnitt 5 anpassen.
3. Während der Sperre `Win+Umschalt+S`: Shellherd darf nicht erscheinen.

---

## 7. Was ausdrücklich nicht getan wird

- Keine dauerhafte Content Protection und keine Einstellung dafür (R1.2).
- Kein Schutz des RDP-Helferfensters und der nativen Rückfragen per WDA, denn sie sind versteckt oder harmlos (R1.3).
- Kein neuer `unlockVault`-Kanal mit Id. Die Signatur bleibt (R2.3).
- Kein Drop von UNC- oder Gerätepfaden. Kein `stat` auf UNC-Pfade ohne Klick (R2.2, R2.4).
- Keine Freigabeliste für `privateKeyPath`, das lokale Dateifenster und Auto-Upload. Das ist Extra A5.
- `known_hosts` wird nie ohne Dialog gelesen und nie geschrieben. Es gibt keinen Export.
- Keine Host-Zertifikate (`@cert-authority`), keine Muster, keine `sk-…`-Schlüssel und kein DSA (R3.4).
- Der Import ersetzt oder löscht nie einen Eintrag. Bestätigte Schlüssel gehen importierten immer vor (R3.3, R3.5).
- Kein Worker für den known_hosts-Parser (R3.6).
- Keine Rückfrage beim Entfernen und keine Vorschau vor dem Import (R3.5, R3.7).
- Keine Änderung der Reihenfolge der Host-Key-Algorithmen in ssh2.
- Keine Bewegung und keine neuen Tokens.

## 8. Minimale erste Stufe und Extras

**Stufe 1 (dieses Paket):** 1a, 2a bis 2c, 3a bis 3c.
- Main: drei kleine Änderungen (`index.ts`, `vault/ipc.ts`, `recent-vaults.ts`) und zwei neue Module (`path-grants.ts`, `known-hosts-parse.ts`).
- `known-hosts.ts` wird ausgebaut und bekommt eine kleine IPC-Datei.
- Renderer: ein Dialog, eine Hilfsdatei, drei kleine Einbindungen.

**Extras für später:**
- **A5:** Freigabeliste und UNC-Sperre auch für `privateKeyPath` (Schlüssel wird beim Verbinden gelesen), Auto-Upload-Pfade und das lokale Dateifenster. Das ist der verbleibende NTLM-Weg bei *entsperrtem* Vault.
- Dauerhafte Einstellung „Fenster von Bildschirmaufnahmen ausschließen“ (Gerät, Standard aus).
- Eine eigene Fehlerkarte `hostkey-revoked` mit passendem nächsten Schritt.
- `algorithms.serverHostKey` je Host nach bekannten Typen sortieren, wie OpenSSH. Dann fragt ein nur mit RSA importierter Host nicht nach Ed25519.
- `Fingerprint kopieren` je Zeile.
- Suche findet gehashte Einträge über das HMAC der Eingabe.
- `Alle importierten entfernen`.
- Import aus `%ProgramData%\ssh\ssh_known_hosts`.
- Drop von UNC-Vaults mit nativer Rückfrage statt Ablehnung.

## 9. Risiken

1. **Vorschau eines minimierten Fensters (O1):** Ob WDA die DWM-Vorschau leert, ist ungeprüft. M1 klärt es. Doku und CHANGELOG versprechen es nicht.
2. **WDA unter älterem Windows** (vor 10 2004): In Aufnahmen erscheint ein schwarzes Fenster statt keinem. Das ist ebenfalls geschützt.
3. **Vergessener Schutz:** Endet die Sperre auf einem Weg ohne `onUnlock` oder `onSessionChange`, etwa beim Beenden der App, ist das harmlos: Die Fenster schließen ohnehin. Ein neues Fenster nach dem Entsperren startet ungeschützt, und das ist richtig so.
4. **Freigabeliste, Bedienung:** Wer bisher eine Vault-Datei von einer Freigabe gezogen hat, bekommt jetzt „Shellherd öffnet diese Datei nur über „Vault-Datei auswählen“.“ Das ist einmalig nötig und steht im Handbuch. 8.3-Kurznamen und `\\?\`-Schreibweisen gelten als andere Pfade und werden abgelehnt (sichere Richtung).
5. **Downgrade:** 0.23.0 liest `known-hosts.json` weiter, verwirft aber beim nächsten Bestätigen `imported` und `revoked`.
6. **Größe von `known-hosts.json`:** 1 000 importierte (je höchstens ca. 360 B) plus 200 widerrufene Einträge plus die bestätigten liegen unter dem Lese-Limit von 1 MiB. Ab etwa 3 000 bestätigten Hosts wird es eng. Das ist nicht neu.
7. **Widerrufen in der Karte `hostkey-store`:** Der Titel „Server-Schlüssel nicht geprüft“ passt. Der Fehlertext nennt den Widerruf. Die Zeile „Prüfe die Zugriffsrechte …“ führt aber in die Irre. Hingenommen, Extra.
8. **Typ-Aushandlung:** ssh2 verhandelt den Schlüsseltyp ohne Blick auf die bekannten Typen. Ein Host, der nur mit RSA importiert ist und Ed25519 anbietet, gilt als unbekannt und wird abgefragt. Danach gilt die Bestätigung. Sicher, aber eine Rückfrage mehr. Extra.
9. **HMAC je Verbindung:** höchstens 1 000 HMAC-SHA1 pro `verify`, das sind wenige Millisekunden.
10. **Sprunghosts:** Dieselbe interne Adresse hinter zwei Sprunghosts teilt sich weiter einen Eintrag (`handbuch.md:348`). Der Import ändert daran nichts.
11. **Grenze der Freigabeliste:** Ein Renderer mit entsperrtem Vault kann weiter UNC-Pfade über `privateKeyPath` und andere Wege anstoßen (A5).

## 10. Testideen (Pflicht = **fett**)

### 10.1 Parser (`known-hosts-parse.test.ts`, Task B)
- **Klartext** `host` → Port 22; `[Host]:2222` → `host`/2222 (kleingeschrieben); `host,10.0.0.1` → zwei Schlüssel; `[::1]:2222` → `::1`/2222.
- **Gehasht:** Mit einem im Test erzeugten Salt und HMAC entsteht `kind: 'hashed'`, Salt und Hash als gepaddetes base64. Ein Salt mit 19 Byte, `|2|…` und `|1|a|b|c` werden übersprungen.
- **`@revoked`** ergibt `kind: 'revoked'`. **`@cert-authority`**, `@foo`, `*.x`, `!x`, `h?st`, `[h]` ohne Port, Port 0 und 70000 werden übersprungen.
- **Typ:** `sk-ssh-ed25519@openssh.com`, `ssh-ed25519-cert-v01@openssh.com` und `ssh-dss` werden übersprungen. Ein Blob mit innerem Typ `ssh-rsa` unter dem Typfeld `ssh-ed25519` wird übersprungen. Kaputtes base64 wird übersprungen.
- **Fingerprint** ist gleich `hostFingerprint(blob)` aus `known-hosts.ts` (Kreuzvergleich im Test).
- CRLF-Zeilen, Tabs als Trenner, Kommentare und Leerzeilen zählen nicht als übersprungen.
- **Limits:** Eine Zeile mit 16 385 Zeichen wird übersprungen. Bei 1 001 gültigen Zeilen gilt `keys.length === 1000` und `skipped === 1`.
- **Laufzeit:** 4 MiB aus `'|'.repeat`, `'['.repeat` und `'a,'.repeat` sowie eine Zeile aus Leerzeichen brauchen jeweils weniger als 1 000 ms und werfen nicht.
- `keyType`: zu kurzer Buffer, Länge 0, Länge größer als der Buffer, Länge über 64 → `null`.
- **`hashedNameMatches`**: Port 22 nutzt `host`, Port 2222 nutzt `[host]:2222`, ein falscher Host liefert `false`.

### 10.2 Speicher (`known-hosts.test.ts`, Task F)
- **Eine Datei ohne `imported` und `revoked` (0.23.0) lädt, verifiziert und listet wie bisher.**
- **Regression:** Wird ein neuer Server bestätigt, bleiben `imported` und `revoked` in der Datei erhalten.
- **Importierter Klartext-Treffer:** `verify` liefert `true` ohne `confirm`. Ein gehashter Treffer ebenso.
- **Gleicher Typ, anderer Fingerprint:** `hostKeyChanged` mit `expected` = importierter Fingerprint. Anderer Typ: `confirm` wird gerufen.
- **Widerrufen:** `hostKeyRevoked` kommt auch dann, wenn `hosts` den Fingerprint bestätigt hat.
- **Bestätigt geht vor:** Ein bestätigtes X und ein importiertes Y für denselben Host, der Server zeigt Y → `hostKeyChanged` (`expected` X).
- **`importKeys` mit der Fixture-Struktur aus 6.0** ergibt genau `added 4, known 1, revoked 1`, und `conflicts` ist `['127.0.0.1:2222']`.
- **Ein zweiter Import derselben Daten** ergibt `added 0` und schreibt nicht (Datei-mtime oder Spion auf `write`).
- Ein Schlüssel, der in derselben Datei widerrufen ist, wird nicht als vertrauenswürdig übernommen.
- Obergrenzen `MAX_STORED_IMPORTED` und `MAX_STORED_REVOKED` werden als übersprungen gezählt.
- **`remove`** entfernt je einen bestätigten, importierten und widerrufenen Eintrag. Eine unbekannte Id ergibt `core.invalidRequest`. Nach dem Entfernen des bestätigten Eintrags ruft `verify` wieder `confirm`.
- `list` liefert stabile Ids (zweimal gleich) und `host: null` für gehashte Einträge.
- Parallel gestartete `importKeys` und `verify`/`confirm` verlieren keinen Schreibvorgang (Queue).

### 10.3 Vault-Freigabe (`path-grants.test.ts`, `recent-vaults.test.ts`, Task C)
- **`droppedVaultPath`:**

  | Eingabe | Ergebnis |
  |---|---|
  | `C:\a\v.term` | unverändert |
  | `c:/a/v.TERM` | `c:\a\v.TERM` |
  | `C:\a\..\v.terminus` | `C:\v.terminus` |
  | `\\srv\s\v.term`, `//srv/s/v.term`, `\\?\C:\v.term`, `\\.\pipe\v.term` | `null` |
  | `v.term`, `C:v.term`, `C:\a\v.txt` | `null` |
  | `42`, `null` | `null` |
  | ein String mit 5 000 Zeichen | `null` |
- **`VaultPathGrants`:** Nach `grant('C:\\A\\v.term')` liefert `has('c:\\a\\V.term')` `true` (win32, CI läuft auf windows-latest) und `has('C:\\b.term')` `false`.
- **`vaultPathAllowed`:**
  - Freigegeben → `true`, ohne `inRecent` aufzurufen.
  - `lockedPath` in anderer Schreibweise → `true`.
  - Sonst entscheidet `inRecent`.
  - Ein Spion zeigt, dass für einen UNC-Pfad weder `stat` noch `readFile` läuft. `inRecent` ist reine Listensuche.
- **`RecentVaults.has`** ist ohne Probe-Aufruf `true` für einen gespeicherten Pfad in anderer Schreibweise und `false` für einen fremden.
- **`missing()`:** `//srv/s/v.term` und `\/srv\s\v.term` werden nicht geprüft (Probe-Spion), Recheck N1.

### 10.4 Renderer (`known-hosts-view.test.ts`, Task H1)
- `sortKnownHosts`: benannte Einträge alphabetisch, dann gehashte, dann widerrufene.
- `matchesKnownHost`: `'WEB'` findet `web-01:2222`, `'ed25519'` findet über den Typ, ein Teil des Fingerprints findet, `'  '` findet alles.
- `knownHostName`: Port 22 ohne Suffix, gehasht → „Gehashter Hostname“, widerrufen → „Alle Hosts“.

### 10.5 Ohne Komponententest (keine DOM-Testumgebung)
`KnownHostsDialog`, die Einbindung in `SettingsDialog` und `App` sowie der Drop werden über run-app 6.3 und 6.4 abgesichert. Der Fensterschutz läuft über 6.1, 6.2 und M1.
