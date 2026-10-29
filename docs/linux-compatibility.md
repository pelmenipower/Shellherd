# Linux-Kompatibilität: Implementierung und Prüfung

Stand: 27. Oktober 2026, Version unverändert 0.30.0.

## Umfang und Architektur

Geprüft wurden die Plattformstellen in Main, Preload, Renderer, Shared-Schemas, nativen Helfern, Build-Skripten, Ressourcen, Tests und GitHub-Workflows. Das Arbeitsverzeichnis war zu Beginn sauber. Es wurden keine Tags, Commits, Pushes oder Releases erstellt.

`src/main/platform/index.ts` bündelt Capabilities, native lokale Pfadoperationen und sichere Suche nach ausführbaren Programmen. Main übergibt die Capabilities beim Fensterstart an den sandboxed Preload; der Renderer verwendet dieselben Daten für angebotene Verbindungstypen. Die Autorisierung und Plattformprüfung bleiben im Main-Prozess. Bestehende Session-, Transport- und Dateisystemabstraktionen werden weiterverwendet.

| Bereich | Befund und Umsetzung |
| --- | --- |
| Lokale Shells | Windows-Systempfade für CMD/PowerShell bleiben erhalten. Linux erkennt Bash/Zsh/Fish anhand ausführbarer Dateien in absoluten PATH-Verzeichnissen. PTY-Start, I/O, Resize, Exit, Close und Fensterübergaben verwenden den bestehenden Session-Manager. |
| Native Module | node-pty wird erst beim lokalen Terminalstart geladen; ein defektes Modul verhindert nicht mehr den gesamten App-Start. electron-builder baut native Module auf dem Zielsystem gegen Electron neu. Native PTYs wurden auch mit dem Electron-Runtime beider Linux-Pakete ausgeführt. |
| SSH/SFTP | ssh2, Passwort-/Schlüsselanmeldung, SSH_AUTH_SOCK, Host-Key-Prüfung, Jump-Hosts und Weiterleitungen bleiben gemeinsame Logik. Die zuvor Windows-beschränkten echten SFTP-Loopback-Tests laufen auch unter Linux. |
| Dateien | Lokale Dateisystem-, IPC-, Prüfsummen-, Auto-Upload- und Rendererpfade verwenden native Semantik. Linux berücksichtigt Groß-/Kleinschreibung bei Grants, Ordnerüberlappungen und Migration. Remote-Pfade bleiben POSIX. |
| Vault | AES-256-GCM, Argon2id, AAD und Verschlüsselungsformat v1 bleiben unverändert; keine Migration. Ein festes synthetisches Fixture enthält Windows- und Linux-Pfade und wird auf beiden CI-Systemen geöffnet und erneut verschlüsselt. Vault-Dateien werden exklusiv temporär mit 0600 angelegt und atomar ersetzt. Settings und temporäre Remote-Edit-Dateien erhalten ebenfalls 0600. |
| Windows Hello | Native Helfer werden ausschließlich unter Windows verwendet. Der bestehende ausdrücklich aktivierte Entwicklungstest-Fake bleibt für Tests erhalten. Keine neue Linux-Geräteauthentifizierung. |
| Docker/Podman | Bestehende lokale execFile-Aufrufe sind plattformunabhängig. Linux-Programmsuche und lokale Container-PTYs sind ergänzt; direkte Argumentlisten ohne implizite Shell. Zugriff auf den lokalen Dienst bleibt Voraussetzung. |
| Kubernetes/Proxmox | Bestehende SSH-/API-Transporte verwenden keine lokalen Windows-Programme. Kubernetes bleibt an SSH-Zugriffshosts gebunden, Proxmox an die entfernten pct/qm-Werkzeuge. Keine neue lokale Proxmox-Implementierung. |
| RDP | Bestehender nativer Windows-Host unverändert. Main und UI erkennen Linux als nicht unterstützt; auch der Verbindungstest lehnt vor Netzwerkzugriff ab. Keine externen RDP-Credentials in Argumenten oder unsicheren Shell-Aufrufe. |
| Import | OpenSSH-Schlüsselpfade bleiben unter Linux POSIX. Windows-Registry-Imports werden dort nicht angeboten und im Main vor Prozessstart abgelehnt. mRemoteNG-Dateiimport verwendet weiter die vorhandenen Parser. |
| Remote-Editor | Linux startet einen erkannten grafischen Texteditor mit Argumentliste. Kein Ausführen unbekannter Remote-Dateien über Desktop-Assoziationen. Fehlender oder nicht startbarer Editor liefert einen lokalisierten Fehler. |
| Main/Preload/Renderer | Kontextisolation, sandboxed Preload und deaktivierte Node-Integration bleiben erhalten. Neue Shell-Protokolle sind in Schema, IPC, Verbindungserfassung und KI-Kontext berücksichtigt. |
| Ressourcen/Packaging | Windows EXE-Targets bleiben erhalten; Windows-Helfer sind plattformspezifische Ressourcen. Linux erhält AppImage x86_64 und DEB amd64, Icon, Desktop-Eintrag, Kategorie und Laufzeitabhängigkeiten. Entwicklungswerkzeuge werden nicht ausgeliefert. |

## RDP-Entscheidung

[FreeRDP dokumentiert stdin für Zugangsdaten](https://pub.freerdp.com/api/client_2common_2cmdline_8h_source.html). Eine sichere Integration ist prinzipiell möglich. Für Shellherds bestehendes eingebettetes RDP-Modell fehlen aber eine implementierte und geprüfte Linux-Fensteranbindung, Zertifikatsdialoge und Sitzungssteuerung. Daher wurde kein ungetesteter externer Launcher eingebaut. Linux meldet RDP ausdrücklich als nicht verfügbar. Eine spätere Integration darf die Zertifikatsprüfung nicht umgehen und keine Kennwörter in Prozessargumente schreiben.

## Sandbox und Pakete

Der installierte electron-builder 26.17.0 erzeugt standardmäßig einen AppImage-Starter mit automatischem `--no-sandbox`-Fallback. Der eigene After-Pack-Hook liefert stattdessen einen einfachen AppRun, der unverändert an Electron übergibt. Zusätzlich verhindert `appImage.executableArgs: []` den entsprechenden Desktop-Standardparameter. Die tatsächlichen extrahierten Pakete werden darauf geprüft.

Für DEB bleibt die Installer-Logik des gepinnten electron-builder aktiv: Sandbox-Helfer und auf unterstützten Systemen ein AppArmor-Profil für `/opt/Shellherd/shellherd`. Das Profil erlaubt User-Namespaces für diesen festen Programmpfad. Das AppImage benötigt funktionierende unprivilegierte User-Namespaces; bei AppArmor-Einschränkungen ist das DEB der vorgesehene Installationsweg. Es wird keine globale Kernel-/AppArmor-Einstellung geändert.

## CI und Veröffentlichung

CI und Release haben verpflichtende Windows-/Ubuntu-Jobs. Die bestehende Versionsprüfung, zweisprachigen Changelogs und Release-Notes bleiben erhalten. Beide Plattformen bauen mit eigenen nativen Abhängigkeiten. Der Linux-Release-Job prüft Pakete, installiert das DEB und startet es unter Xvfb mit aktivierter Renderer-Sandbox. CI prüft zusätzlich den entpackten Programmstart.

Nur der nachgelagerte gemeinsame Release-Job hat `contents: write`. Alle vier Installationsdateien müssen vorliegen. Uploads erfolgen in einen Draft; erst danach wird der gemeinsame Release veröffentlicht und automatisch getaggt. Ein fehlgeschlagener Pflicht-Build führt nicht zum Release-Job. Bestehende Drafts können wieder aufgenommen werden; die globale Release-Concurrency verhindert doppelte gleichzeitige Releases.

## Lokale Prüfergebnisse und Grenzen

- `npm run typecheck`: erfolgreich.
- `npm run build`: erfolgreich; Windows-Helfer wurden erwartungsgemäß übersprungen.
- `npm test -- --maxWorkers=4`: 182 Testdateien erfolgreich, 2.842 Tests erfolgreich, 35 übersprungen; keine Fehler.
- AppImage und DEB: erfolgreich erzeugt; Version 0.30.0 unverändert.
- `node scripts/check-linux-package.mjs`: extrahiert beide Pakete, prüft Architektur, Starter, Desktop-Eintrag, Icon, AppArmor-Profil, Produktionsabhängigkeiten und native PTYs im gebündelten Electron. Erfolgreich, auch nach dem abschließenden Paket-Build.
- GUI-Smoke-Test: Nach Installation des DEBs über den neuen Shell-Installer im interaktiven Desktop-Terminal erfolgreich. Fenster, Preload, Linux-Capabilities und aktivierte Renderer-Sandbox wurden mit einem isolierten Profil geprüft. Der installierte Desktop-Eintrag wurde zusätzlich aufgerufen. Die Sandbox wurde nicht abgeschaltet.
- Windows-Build/-Start, Windows Hello und echter Windows-RDP-Host konnten auf diesem Linux-Host nicht ausgeführt werden. Native Windows-Quellen bleiben unverändert; die Windows-Tests bleiben in der Matrix erhalten.
- Live-Tests gegen produktive SSH-Agenten, Docker-/Podman-Dienste, Kubernetes-/Proxmox-Hosts sowie RDP-Server wurden nicht durchgeführt. Die Suite verwendet lokale synthetische SSH/SFTP-Server sowie Transport-/Infrastruktur-Fakes. Bash wurde nativ ausgeführt; Zsh/Fish benötigen einen zusätzlichen Live-Test, wenn installiert.

Vor dem ersten öffentlichen Linux-Release sind die vorbereiteten CI-Jobs auf beiden Betriebssystemen auszuführen, der DEB-Start auf einem frischen Ubuntu-Desktop zu bestätigen und ein AppImage auf einem System mit zulässiger Namespace-Sandbox zu starten. Anschließend sind echte Agent-, Zsh/Fish- und Infrastruktur-Verbindungen nach der jeweiligen Umgebung zu prüfen. Der installierte GUI-Start ist auf diesem bestehenden Ubuntu-System bestätigt; eine frische Ubuntu-Installation und die plattformübergreifende CI stehen weiterhin aus.

Das vorhandene Windows-orientierte Screenshot-/Demo-Werkzeug unter `.claude/skills/run-app` wurde nicht vollständig auf Linux umgestellt. Für den neuen Linux-Starttest gibt es `scripts/smoke-linux.mjs`; der RDP-Prototyp meldet auf Linux ausdrücklich die Plattformgrenze.

## Shell-Installer

`install.sh` installiert lokale DEBs über `--package` oder veröffentlichte Linux-Releases. Downloads müssen mit SHA256SUMS übereinstimmen, bevor APT startet. Der Release-Workflow fügt Installer und Prüfsummen hinzu. Der Online-Einzeiler wird erst nach Veröffentlichung dieser Assets nutzbar. Die drei Installer-Tests sind erfolgreich; APT/sudo werden darin simuliert.

## Geänderte Dateien

- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`
- `README.md`
- `docs/linux-compatibility.md`
- `electron-builder.yml`
- `package.json`
- `scripts/check-linux-package.mjs`
- `scripts/linux-after-pack.cjs`
- `scripts/linux-packaging.test.mjs`
- `scripts/rdp-try.mjs`
- `scripts/smoke-linux.mjs`
- `src/main/ai/assistant.ts`
- `src/main/ai/ipc.ts`
- `src/main/app-settings.ts`
- `src/main/connection-test.test.ts`
- `src/main/connection-test.ts`
- `src/main/file-association.test.ts`
- `src/main/files/auto-upload.test.ts`
- `src/main/files/auto-upload.ts`
- `src/main/files/file-system.test.ts`
- `src/main/files/file-system.ts`
- `src/main/files/ipc.ts`
- `src/main/files/remote-edit.test.ts`
- `src/main/files/remote-edit.ts`
- `src/main/files/sftp-loopback.test.ts`
- `src/main/files/transfer.test.ts`
- `src/main/files/verify.ts`
- `src/main/import-source.test.ts`
- `src/main/import-source.ts`
- `src/main/index.ts`
- `src/main/platform/index.ts`
- `src/main/platform/platform.test.ts`
- `src/main/rdp/ipc.ts`
- `src/main/ssh/ipc.ts`
- `src/main/ssh/local-shell.test.ts`
- `src/main/ssh/locate.ts`
- `src/main/ssh/session-transfer.test.ts`
- `src/main/ssh/session.test.ts`
- `src/main/ssh/session.ts`
- `src/main/user-data.test.ts`
- `src/main/user-data.ts`
- `src/main/vault/cross-platform.test.ts`
- `src/main/vault/hello-helper.ts`
- `src/main/vault/hello.test.ts`
- `src/main/vault/ipc.test.ts`
- `src/main/vault/path-grants.test.ts`
- `src/main/vault/path-grants.ts`
- `src/main/vault/recent-vaults.test.ts`
- `src/main/vault/recent-vaults.ts`
- `src/main/vault/storage.test.ts`
- `src/main/vault/storage.ts`
- `src/main/window-ipc.ts`
- `src/preload/index.ts`
- `src/renderer/src/App.tsx`
- `src/renderer/src/auto-upload-form.ts`
- `src/renderer/src/components/ConnectionForm.tsx`
- `src/renderer/src/components/FilePane.tsx`
- `src/renderer/src/components/FileTypeSetting.tsx`
- `src/renderer/src/components/VaultTree.tsx`
- `src/renderer/src/components/WelcomePage.tsx`
- `src/renderer/src/components/WorkflowPalette.tsx`
- `src/renderer/src/components/WorkflowsDialog.tsx`
- `src/renderer/src/connection-form.ts`
- `src/renderer/src/connection-labels.ts`
- `src/renderer/src/file-browser.ts`
- `src/renderer/src/platform-paths.test.ts`
- `src/renderer/src/platform.ts`
- `src/renderer/src/terminal-broadcast.ts`
- `src/renderer/src/terminal-tabs.ts`
- `src/shared/ai.ts`
- `src/shared/import-openssh.test.ts`
- `src/shared/import-openssh.ts`
- `src/shared/ipc.ts`
- `src/shared/locales/de-DE/connection.json`
- `src/shared/locales/de-DE/errors/core.json`
- `src/shared/locales/de-DE/errors/files.json`
- `src/shared/locales/de-DE/errors/ssh.json`
- `src/shared/locales/de-DE/main.json`
- `src/shared/locales/de-DE/vault.json`
- `src/shared/locales/en-US/connection.json`
- `src/shared/locales/en-US/errors/core.json`
- `src/shared/locales/en-US/errors/files.json`
- `src/shared/locales/en-US/errors/ssh.json`
- `src/shared/locales/en-US/main.json`
- `src/shared/locales/en-US/vault.json`
- `src/shared/platform.ts`
- `src/shared/vault/connections.ts`
- `src/shared/vault/schema.ts`
- `src/shared/vault/types.ts`
- `src/test/fixtures/cross-platform-v1.term`
- `install.sh`
- `scripts/installer.test.mjs`
