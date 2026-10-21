---
name: run-app
description: Shellherd (Electron) starten, per Playwright durchklicken und Screenshots machen – mit isoliertem Profil, synthetischem Demo-Vault und lokalen Gegenstellen (SSH, SFTP, Docker, Kubernetes, KI). Laden, wenn die App laufen, eine Änderung in der echten App geprüft oder Screenshots (z. B. für README oder Review) gemacht werden sollen.
---

# Shellherd starten und bedienen

Die App läuft aus `out/` unter Playwright. Ein kleiner HTTP-Treiber auf `127.0.0.1:9333` nimmt Befehle per `curl` oder `fetch` entgegen. Nichts davon berührt echte Daten:

- **Profil isoliert:** `appData`/`userData` liegen unter `%TEMP%\shellherd-run\profile` (Override: `SHELLHERD_RUN_DIR`). `%APPDATA%\Shellherd` (Hostschlüssel, zuletzt geöffneter Vault) bleibt unberührt.
- **Nur synthetische Zugangsdaten:** Demo-Vault `demo.term` mit Passwort `synthetic-vault-demo`, Testserver `demo` / `synthetic-demo`. Nie einen echten Vault öffnen.
- **Native Dialoge ersetzt:** Speichern/Öffnen liefern `profile\demo.term`, Nachfragen (auch „Unbekannter SSH-Server“) antworten mit ihrem letzten Knopf. Sonst gehen Windows-Dialoge auf dem echten Desktop auf und blockieren den Treiber. Abschalten mit `SHELLHERD_RUN_REAL_DIALOGS=1`.

Getestet unter Windows 11. Unter Linux braucht Electron zusätzlich `xvfb-run` und `--no-sandbox` (nicht erprobt).

## Ablauf

```bash
npx electron-vite build          # out/ muss aktuell sein; nach jedem Build den Treiber neu starten
npm run drive:sshd               # Hintergrund: SSH/SFTP-Server, Kubernetes- und KI-Fake (drei "ready"-Zeilen)
npm run drive                    # Hintergrund: App + Treiber, meldet "driver ready on 9333"
node .claude/skills/run-app/demo-setup.mjs   # Demo-Vault anlegen oder entsperren
node .claude/skills/run-app/screens.mjs [sftp|containers|kubernetes|settings|assistant|lock|lock-secondary|login-commands|welcome …]   # ohne Argument alle; sftp erzeugt zusätzlich sftp-typeahead.png, sftp-transfer-canceled.png, sftp-transfer.png, sftp-transfer-verified.png, sftp-auto-upload-dialog.png und sftp-auto-upload.png, settings erzeugt settings.png und ai-settings.png
T="x-driver-token: $(cat "$TEMP/shellherd-run/token")"   # nach dem Start des Treibers
curl -s -H "$T" "http://127.0.0.1:9333/ss?name=start&crop=status"
curl -s -H "$T" http://127.0.0.1:9333/quit          # am Ende; Testserver-Prozess ebenfalls beenden
```

Bereitschaft abwarten: `for i in $(seq 1 60); do curl -sf -m 2 -H "x-driver-token: $(cat "$TEMP/shellherd-run/token" 2>/dev/null)" http://127.0.0.1:9333/windows && break; sleep 1; done` (`-f`, weil ein altes Token sonst mit 403 die Schleife beendet).

**Treiber-Token:** Der Treiber schreibt bei jedem Start ein neues Token nach `%TEMP%\shellherd-run\token`. Jede Anfrage braucht den Header `x-driver-token` (ohne Header oder mit `Origin`: 403), sonst könnte jede Website per `POST` an `127.0.0.1:9333` Code in der App ausführen. Alle `curl`-Beispiele unten verwenden `-H "$T"`.

`screens.mjs` schreibt `sftp.png`, `sftp-typeahead.png`, `sftp-transfer-canceled.png`, `sftp-transfer.png`, `sftp-transfer-verified.png`, `sftp-auto-upload-dialog.png`, `sftp-auto-upload.png`, `containers.png`, `kubernetes.png`, `settings.png`, `ai-settings.png`, `assistant.png`, `lock-screen.png`, `lock-secondary.png`, `login-commands.png`, `login-plain.png` und `welcome.png`. Endet der `lock`- oder `lock-secondary`-Block mit einem Fehler, bleibt die App gesperrt: dann `demo-setup.mjs` neu starten (die App neu starten, falls es das Passwortfeld nicht findet).

Screenshots landen in `%TEMP%\shellherd-run\shots` (Override: `SCREENSHOT_DIR`). **Screenshot immer ansehen** (Read auf die PNG) – ein leeres Fenster ist ein Startfehler.

## Gegenstellen

Alle lauschen nur auf `127.0.0.1`.

| Port | Dienst | Datei |
|---|---|---|
| 9333 | HTTP-Treiber der App | `driver.mjs` |
| 2222 | SSH/SFTP-Testserver (`demo` / `synthetic-demo`) | `sshd.mjs` (Daten in `fixtures.mjs`) |
| 9334 | Kubernetes-API-Fake (HTTPS; die App erreicht ihn nur per SSH-Tunnel `k8s-cp1:6443` über 2222) | `kube-fake.mjs` |
| 9335 | OpenAI-kompatibler KI-Fake (Schlüssel `sk-synthetic-demo`) | `ai-fake.mjs` |

Ports per `SSHD_PORT`, `KUBE_FAKE_PORT`, `AI_FAKE_PORT` änderbar.

**Nachher-Messung (Übertragungstempo):** `SSHD_LATENCY_MS=10 npm run drive:sshd` verzögert jede READ- und WRITE-Antwort des Testservers um 10 ms. Der sftp-Block gibt dann `Rate: …` im Protokoll aus (vor und nach dem Fortsetzen). Er bricht eine 512-MiB-Zufallsdatei ab, setzt sie fort, vergleicht SHA-256 lokal gegen `RUN_DIR/sftp/home/demo/big.bin` und klickt „Prüfen“. Wird das Abbruchfenster zu knapp, die Datei in `screens.mjs` auf 1 GiB setzen.

## Demo-Vault (`demo-setup.mjs`)

| Eintrag | Ziel | Zeigt |
|---|---|---|
| `web-01` | `127.0.0.1:2222`, richtiges Passwort | erfolgreiche Sitzung, Befehle `uptime`, `df -h /`, `systemctl status nginx --no-pager \| head -3`, `docker ps --format "table {{.Names}}\t{{.Status}}"` |
| `ops-01` | `127.0.0.1:2222`, richtiges Passwort, „root werden“ und Startbefehle `cd /var/www`, `uptime` | Root-Shell `root@web-01:~# ` und Ausgabe der Startbefehle (`login-commands.png`); Tab-Menü „Ohne Startbefehle verbinden“ gibt den Prompt `demo@web-01:~$ ` ohne Startbefehle (`login-plain.png`). Falsches Passwort am sudo-Prompt: der Fake fragt ein zweites Mal, die App bricht ab. `demo-setup.mjs` trägt ihn auch in einem bestehenden Demo-Vault nach |
| `files-01` | `127.0.0.1:2222`, SFTP | Dateiansicht `/home/demo` |
| `prod-k8s` | Cluster über `web-01`, Produktion an | Kubernetes-Ansicht mit rotem Produktionsrahmen |
| `Demo-KI` | KI-Anbieter, OpenAI-kompatibel, `http://127.0.0.1:9335/v1` | Einstellungen und Assistent |
| `db-main` | `127.0.0.1:2222`, falsches Passwort | Fehlerkarte „Anmeldung abgelehnt“ |
| `legacy-app` | `127.0.0.1:1` | Fehlerkarte „Verbindung abgelehnt“ |
| Ordner `Staging` | leer | Hinweis „Nichts zu verbinden“ über Rechtsklick → „Alle verbinden“ |

Beantwortete Exec-Befehle (Container- und Cluster-Erkennung): `for c in docker podman pct qm …` (Antwort `has:docker`), der Listen-Batch mit Marker `[terminus-list-…]`, `docker container inspect <name>` und der Kubeconfig-Abruf (`KUBECONFIG%%`). Alles andere: Exit 127, nichts wird ausgeführt.

Im Testserver beendet `exit` die Sitzung, `sudo reboot` simuliert einen Abbruch durch den Server (Leiste „Verbindung getrennt“).

## Befehle des Treibers

| Route | Body / Query | Wirkung |
|---|---|---|
| `POST /click` | Playwright-Selektor | Linksklick |
| `POST /rclick`, `POST /dblclick` | Selektor | Rechts-/Doppelklick |
| `POST /fill` | `Selektor\nWert` | Eingabefeld setzen (React-tauglich) |
| `POST /type` | Text | Tippen in das fokussierte Element (xterm) |
| `GET /key?k=Enter` | Playwright-Tastenname | Taste drücken |
| `POST /eval` | JS (Funktionsrumpf, `return` erlaubt) | im Renderer ausführen, Ergebnis als JSON |
| `POST /main` | JS mit `electron` | im Main-Prozess ausführen |
| `POST /text` | Selektor (leer = `body`) | sichtbarer Text |
| `GET /ss?name=x&crop=status` | – | Screenshot; `crop=status` schneidet die Statusleiste (Vault-Pfad) ab |
| `GET /windows`, `GET /use?i=1` | – | Fenster auflisten / wechseln (Nebenfenster) |
| `GET /quit` | – | App schließen, Treiber beenden |

Häufige Wege:

- **Verbinden:** `POST /click` mit `text=web-01 >> nth=0`, dann `GET /key?k=Enter`.
- **Im Terminal tippen:** `POST /click` mit `.xterm-helper-textarea >> nth=0` (Bereich wählen), dann `/type` und `/key?k=Enter`.
- **Menüeinträge** tragen Hinweise in Unter-Spans; per `/eval` über den Textanfang klicken: `[...document.querySelectorAll('[role=menuitem]')].find(i => i.textContent.trim().startsWith('Alle verbinden')).click()`.
- **Bereich teilen:** Knopf `aria-label^="Layout für Bereich"`, dann Knopf mit Text „Nebeneinander teilen“.

## Stolpersteine

- **Umlaute in `curl --data-binary` unter Git Bash** kommen kaputt an (`Vault öffnen` trifft nichts). In Selektoren `text-matches("Vault .ffnen")` nutzen oder Schritte als Node-Skript mit `fetch` schreiben wie `demo-setup.mjs`.
- **`/type` in normale Eingabefelder** verliert Zeichen, wenn React neu rendert. Für Felder immer `/fill`, `/type` nur fürs Terminal.
- **BusyButtons** enthalten unsichtbare Platzhalter-Labels (`aria-hidden`); `:text-is("Speichern")` trifft sie nicht. Über die Klasse wählen, z. B. `.workspace-save`.
- **Nach einem Build** lädt `location.reload()` nicht zuverlässig das neue Bundle. Treiber mit `/quit` beenden und neu starten.
- **Einzelinstanz-Sperre:** Ein zweiter Treiber auf demselben Profil beendet sich sofort. Eine normal laufende Shellherd-Instanz (anderes Profil) stört nicht.
- **README-Screenshots** immer mit `crop=status` – die Statusleiste zeigt den Vault-Pfad mit dem Windows-Benutzernamen.
- **Neue Demo-Einträge** erscheinen nur in einem neuen Vault: `profile\demo.term` **und** `profile\Shellherd\known-hosts.json` löschen, den Treiber neu starten und `demo-setup.mjs` neu laufen lassen.
- **Host-Schlüssel** liegt in `shellherd-run\sshd-host-key`. Nach einem neuen Schlüssel `profile\Shellherd\known-hosts.json` löschen (und `demo.term`, s. o.), sonst lehnt die App den Server als „Schlüssel geändert“ ab.
- **openssl fehlt:** Der Kubernetes-Fake wird übersprungen (kein `prod-k8s`). Gesucht wird `$OPENSSL`, `openssl` im PATH, dann `C:\Program Files\Git\mingw64\bin` und `C:\Program Files\Git\usr\bin`.
- **„Dieser Computer“** erscheint in der Seitenleiste, wenn Docker lokal installiert ist.
- **Lokale SFTP-Spalte:** Liegt der Run-Ordner außerhalb des Benutzerprofils, nutzt `screens.mjs` `<RUN_DIR>\local`. Sonst weicht es auf `%PUBLIC%\shellherd-demo-local` aus (drei kleine Dateien bleiben dort liegen). Geht auch das nicht, bricht der sftp-Block ab, statt echte Ordner zu fotografieren. Tipp: `SHELLHERD_RUN_DIR` außerhalb des Profils setzen (z. B. `C:\shellherd-run`).
- **Testserver hängt:** Der npm-Wrapper endet, der Node-Kindprozess kann weiterlaufen und die Ports 2222/9334/9335 belegen. Beenden: `Get-CimInstance Win32_Process | ? CommandLine -like '*run-app*sshd.mjs*' | % { Stop-Process -Id $_.ProcessId }`, danach mit `Get-NetTCPConnection -LocalPort 2222,9334,9335 -ErrorAction SilentlyContinue` prüfen, dass die Ports frei sind.
- RDP und lokale Container brauchen echte Gegenstellen und sind mit dem Testserver nicht abgedeckt.
