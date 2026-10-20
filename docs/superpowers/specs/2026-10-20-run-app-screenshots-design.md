# run-app: Screenshots aller Komponenten – Design

Auftrag: „.claude/skills/run-app/ sollte erweitert werden, dass auch Screenshots von allen Komponenten gemacht werden: SFTP, Kubernetes, Docker/Podman, Einstellungen und KI-Assistent." Grundlage ist das Konzept `.superpowers/sdd/run-app-screenshots-research.md`, das hier vollständig als Spec übernommen ist (ab „1. Bestand und Lücken"). Plan: `docs/superpowers/plans/2026-10-20-run-app-screenshots.md`.

## Spec-Rulings (Stufe 3)

- **S1** Die Rulings 1–8 aus Abschnitt 9 des Konzepts gelten.
- **S2** Umfang ist die minimale Stufe aus Abschnitt 8: Pflichtbilder `sftp.png`, `containers.png`, `kubernetes.png`, `settings.png`, `ai-settings.png`, `assistant.png`. Der README-Halbsatz kommt dazu. Die übrigen ★-Extras (`sftp-transfer`, `containers-tree`, `kubernetes-problems`, Container-Logs, Proxmox) entfallen.
- **S3** Docker/Podman: Gezeigt wird die Container-Ansicht mit Docker. Podman nutzt dieselbe Ansicht und Parser und bleibt außen vor.
- **S4** Kein `src/`-Code, keine neue Abhängigkeit, keine Version, kein CHANGELOG, kein Handbuch-Abschnitt (Entwicklerwerkzeug; die README ist der englische Kurzüberblick).
- **S5** Abnahme: Gesamtlauf auf frischem Profil, alle PNGs werden angesehen; `fakes.test.mjs` läuft in CI.

## 1. Bestand und Lücken

### 1.1 Skill-Dateien

| Datei | Bestand | Lücke |
|---|---|---|
| `driver.mjs` (100 Zeilen) | Playwright-Treiber, Routen `eval/main/ss/key/type/fill/click/rclick/dblclick/text/windows/use/quit`, Token-Schutz `driver.mjs:84-88`, Dialog-Stubs `driver.mjs:40-49`, Viewport 1440×900 `driver.mjs:53` | Keine Wartefunktion; `click`/`fill` haben 5 s Timeout, alles andere ist sofort. Bleibt so: Warten gehört ins Szenario-Skript über `/eval`. |
| `sshd.mjs` (55 Zeilen) | Passwort-Auth `demo`/`synthetic-demo` `sshd.mjs:21-23`, nur `session.on('shell')` `sshd.mjs:27`, vier Befehle mit fester Ausgabe `sshd.mjs:13-18`, `exit`/`sudo reboot` | Kein `sftp`-Subsystem, kein `exec`-Handler, kein `tcpip` (forwardOut). Genau diese drei Kanäle nutzt die App für SFTP (`sftp-session.ts:92`), Container (`runner.ts:64`) und den Kubernetes-Tunnel (`runner.ts:55`). |
| `demo-setup.mjs` (73 Zeilen) | Vault anlegen/entsperren, `addSsh` über das Formular `demo-setup.mjs:26-41`, Menüeinträge nach Textanfang `demo-setup.mjs:22-23` | Keine SFTP-Verbindung, kein Cluster, kein KI-Anbieter. Anlegen passiert nur im „neu"-Zweig `demo-setup.mjs:52-69`; ein bestehender Vault wird nur entsperrt. |
| `boot.mjs` | Profil-Isolation | vollständig |
| `SKILL.md` | Ablauf, Routen, Stolpersteine; letzte Zeile `SKILL.md:76`: „Cluster, Container, SFTP und RDP brauchen echte Gegenstellen" | Diese Zeile wird falsch; Abschnitt für die neuen Gegenstellen und `screens.mjs` fehlt. |
| `package.json:34-35` | `drive`, `drive:sshd` | Kein weiterer Script nötig, wenn `sshd.mjs` die beiden Fakes selbst startet (siehe 4). |

### 1.2 Was die App pro Komponente auf der Leitung tut

**SFTP** (`src/main/files/`): `client.sftp()` nach `ready` (`sftp-session.ts:92`), dann `realpath('.')` für Home (`sftp-session.ts:129`), `readdir` + `stat` für Links (`sftp-file-system.ts:47-54`), `lstat`, `mkdir`, `rename`, `unlink`, `rmdir`, `chmod`, `utimes`, Read-/Write-Streams (`sftp-file-system.ts:55-64`). `sftp-loopback.test.ts:17-62` enthält einen vollständigen Mini-SFTP-Server auf einem Temp-Ordner mit genau diesen Handlern (`REALPATH`, `STAT`, `LSTAT`, `FSTAT`, `OPENDIR`, `READDIR`, `OPEN`, `READ`, `WRITE`, `CLOSE`, `MKDIR`, `RMDIR`, `REMOVE`, `RENAME`, `SETSTAT`). Die lokale Seite der Dateiansicht zeigt `homedir()` (`file-system.ts:107`) – also den echten Windows-Benutzerordner.

**Container über SSH** (`src/main/containers/`): Alles läuft über `client.exec(command)` (`runner.ts:64`), nie über die Shell.
- Sonde: `sh -c 'PATH="$PATH:/usr/sbin:/sbin"; for c in docker podman pct qm; do command -v "$c" >/dev/null 2>&1 && echo "has:$c"; done; true'` (`commands.ts:12,19`), erwartet Zeilen `has:docker` (`parsers.ts:22-29`).
- Inventar: ein Batch-Skript mit vier Listen, Marker `[terminus-list-<16 hex>]` (`sudo.ts:5`, `inventory-batch.ts:8,17-25`). Nach jeder Liste kommt `\n<marker>:<kind>:<exit>\n` auf stdout **und** stderr. Listenformat Docker: `{{json .}}` je Zeile (`commands.ts:106-111`), Felder `ID`, `Names`, `State`, `Status`, `Image`, `Labels`, `Ports`, `CreatedAt`, `Size` usw. (`inventory-parsers.ts:102-120`).
- Inspect: `docker container inspect <ref>` (`commands.ts:121-124`), JSON.
- Container-Terminal (Logs/Shell) ohne sudo: normale Shell, der Befehl wird eingetippt (`ssh/session.ts:252`, `session.typed`), also `docker logs -f --tail 500 api` oder `docker exec -it api sh -c '…'` (`commands.ts:76-80`).
- sudo (`commands.ts:50-56`) nur, wenn die Verbindung `containers.sudo = true` hat. Im Demo-Vault bleibt das aus → kein sudo-Pfad nötig.
- **Lokal:** Beim Entsperren läuft einmal `docker --version` / `podman --version` auf dem Entwicklungsrechner (`App.tsx:174`, `discovery.ts:179-187`, `runner.ts:112`). Ist Docker Desktop installiert, erscheint „Dieser Computer" in der Seitenleiste (`LocalContainers.tsx:14`).

**Kubernetes** (`src/main/kubernetes/`): 
1. Zugang über den SSH-Host: `sh -lc '<AUTO_SCRIPT>'` (`access.ts:15-21,57`) erwartet `src:<pfad>\n<kubeconfig>`; Formular-Sonde nutzt denselben Befehl (`ipc.ts:75-87`).
2. `parseKubeconfig` verlangt `https:` (`kubeconfig.ts:168`), kein `exec`/`authProvider` (`kubeconfig.ts:162`), keine Datei-Referenzen (`kubeconfig.ts:163`). `insecure-skip-tls-verify: true` wird von client-node zu `rejectUnauthorized=false` (`node_modules/@kubernetes/client-node/dist/config.js:587`, `config_types.js:48`).
3. Tunnel: lokaler `net.Server` auf `127.0.0.1:0` (`tunnel.ts:11-27`), jede Verbindung geht per `client.forwardOut('127.0.0.1', 0, host, port)` (`runner.ts:55`) → der Testserver braucht `client.on('tcpip', …)` (ssh2 `server.js:608-642`).
4. API-Aufrufe: `list('nodes')` als Sonde (`session.ts:275-285`), dann Overview = Watch auf `pods` und `nodes` cluster-weit (`overview.ts:57-60`) + Metrics alle 15 s (`overview.ts:9`, `client-api.ts:388-417`: `/apis/metrics.k8s.io/v1beta1/nodes` und `/pods`; 404/503 = „keine Metriken"). Tabelle: `ResourceWatcher` = list + watch (`watch.ts:91,108`). `KubernetesObjectApi.list` macht vorher **Discovery** per `GET /api/v1` bzw. `/apis/<group>/<version>` und sucht `resources[].kind` (`object.js:377-399`). Watch: `GET …?watch=true&resourceVersion=…&timeoutSeconds=300`, Antwort 200 + ndjson, Ende = sauberes Schließen (`watch.js:48-70`, `client-api.ts:65-70`). Details: `read` (GET Objekt), `eventsFor` (`/api/v1/namespaces/<ns>/events?fieldSelector=involvedObject…`), Logs `GET /api/v1/namespaces/<ns>/pods/<pod>/log` (`client-api.ts:178-189`).
5. Was die Ansicht zeigt: Node-Kacheln (`rows.ts:84-115`: `status.conditions[Ready]`, `status.allocatable`, Labels `node-role.kubernetes.io/*`), Pod-Zeilen (`rows.ts:52-80`: `status.phase`, `containerStatuses[].ready/restartCount/state`), Problembanner (`problems.ts:41-71`: `CrashLoopBackOff`, `ImagePullBackOff`, `OOMKilled`, `Pending`, Node nicht Ready). Statuszeile „bereit über web-01" (`kubernetes.json:177`).

**KI-Assistent** (`src/main/ai/`): OpenAI-Art = `POST <baseUrl>/chat/completions` mit `authorization: Bearer <key>`, Body `{model, stream:true, messages}` (`providers.ts:49-52`); Antwort als SSE, je `data: {"choices":[{"delta":{"content":"…"}}]}`, Ende `data: [DONE]` (`providers.ts:72-87,116-122`). Fehlercodes nach HTTP-Status (`providers.ts:89-93`). `baseUrl` muss nur `z.string().url()` erfüllen (`vault/schema.ts:191`) → `http://127.0.0.1:9335/v1` ist gültig. Der Test-Knopf im Anbieter-Formular schickt dieselbe Anfrage (`assistant.ts:237-250`). Das Panel braucht einen aktiven SSH-/Shell-Tab, sonst ist das Textfeld gesperrt (`AssistantPanel.tsx:237`).

**Einstellungen**: reine UI. Zahnrad `.settings-button` (`App.tsx:782`), `<dialog class="confirm-dialog settings-dialog">` (`SettingsDialog.tsx:45`) mit Abschnitten Allgemein/Vault/KI-Assistent (`settings-sections.ts:4`), „Anbieter verwalten" öffnet `AiSettingsDialog` (`app.json:213`, `App.tsx:874`); Anbieter-Formular: Felder `name`, `model`, `baseUrl`, `apiKey` (`AiSettingsDialog.tsx:107-112`), Knöpfe „Testen"/„Speichern" (`assistant.json:92-93`).

### 1.3 UI-Einstiege (für Setup und Szenario)

| Ziel | Weg | Quelle |
|---|---|---|
| SFTP-Verbindung anlegen | „Neu" → Menüeintrag `SFTP (Dateien)` → gleiche Felder wie SSH | `vault.json:8`, `ConnectionForm.tsx:63` |
| Dateiansicht öffnen | SFTP-Knoten verbinden (Enter) oder Rechtsklick SSH-Knoten → „Dateien öffnen (SFTP)" | `vault.json:59`, `App.tsx:833` |
| Container-Ansicht | Rechtsklick SSH-Knoten → „Container-Ansicht öffnen"; Baum: „Laufzeiten anzeigen" | `vault.json:64`, `VaultTree.tsx:163` |
| Cluster anlegen | Rechtsklick SSH-Knoten → „Als Kubernetes-Cluster einrichten…" (Sonde + vorbefülltes Formular) → „Verbindung speichern" | `vault.json:62`, `App.tsx:619-636`, `connection.json:112` |
| Cluster öffnen | Cluster-Knoten verbinden (Enter) | `connection.json:39` |
| Einstellungen | `.settings-button` | `App.tsx:782` |
| KI-Anbieter | Einstellungen → „Anbieter verwalten" → Knopf „OpenAI" → Formular | `AiSettingsDialog.tsx:98-100` |
| Assistent | `.assistant-toggle` bei aktivem Terminal-Tab | `App.tsx:776` |

---

## 2. Empfehlung je Komponente

Wert: ★★★ unverzichtbar für den Auftrag, ★★ sinnvoll, ★ Extra. Aufwand: alles liegt in Skill-Dateien; „Main-Änderung" heißt hier Änderung an `src/`.

### 2.1 SFTP – ★★★, nur Skill-Dateien, geringes Risiko

**Gegenstelle:** `sshd.mjs` bekommt `session.on('sftp', …)`, 1:1 aus `sftp-loopback.test.ts:17-62` übernommen (JS statt TS, ~40 Zeilen). Wurzel ist `%TEMP%\shellherd-run\sftp` (Override `SHELLHERD_RUN_DIR`), beim Start neu befüllt:

```
/home/demo/.bashrc, .profile
/home/demo/www/index.html, style.css, app.js
/home/demo/backups/db-2026-10-18.sql.gz, db-2026-10-19.sql.gz  (je ~300 KB Zufallsbytes)
/home/demo/notes.md
/etc/nginx/nginx.conf, sites-enabled/ (Link → ../sites-available/default)
/var/log/nginx/access.log (~1 MB), error.log
```

Abweichung zur Testvorlage: `REALPATH '.'` liefert `/home/demo` statt `/`, damit die Home-Taste und der Pfad echt aussehen. Zugangsdaten bleiben `demo`/`synthetic-demo`, Port 2222. Rechte/Zeiten kommen aus `lstatSync` (Windows liefert 0666/0777 → im Listing `-rw-rw-rw-`; akzeptabel; wer es hübscher will, setzt im `attrs()` für Dateien 0o644 und Ordner 0o755 – empfohlen, zwei Zeilen).

**Lokale Seite:** Die lokale Spalte zeigt `C:\Users\<name>` (`file-system.ts:107`). `screens.mjs` navigiert vor dem Screenshot per Pfadfeld (`FilePane.tsx:211`, Doppelklick auf `nav[aria-label="Pfad"]` → `input` → `/fill` → Enter) nach `%TEMP%\shellherd-run\local` mit drei synthetischen Dateien. Sonst steht der Windows-Benutzername im Bild.

**Vault-Eintrag:** `files-01` (SFTP, `127.0.0.1:2222`, `demo`, Passwort). Zusätzlich zeigt der Rechtsklick auf `web-01` → „Dateien öffnen (SFTP)" denselben Weg; für den Screenshot reicht `files-01`.

### 2.2 Docker/Podman über SSH – ★★★, nur Skill-Dateien, geringes Risiko

**Gegenstelle:** `sshd.mjs` bekommt `session.on('exec', (accept, reject, { command }) => …)`. Der Handler erkennt den Befehl an festen Teilstrings – kein Shell-Interpreter:

| Erkennung (Teilstring/Regex) | Antwort |
|---|---|
| `for c in docker podman pct qm` | stdout `has:docker\n`, Exit 0 |
| `/\[terminus-list-[0-9a-f]{16}\]/` (Marker aus dem Befehl lesen) | je Kind `containers/images/volumes/networks`: `<json-zeilen>\n\n<marker>:<kind>:0\n` auf stdout und `\n<marker>:<kind>:0\n` auf stderr, Exit 0 (Format `inventory-batch.ts:22,31`) |
| `docker container inspect <ref>` | JSON-Array mit einem Objekt (Id, Name, State, Config.Image, Mounts, NetworkSettings) |
| `KUBECONFIG%%` (AUTO_SCRIPT) | `src:/home/demo/.kube/config\n` + kubeconfig-Text (siehe 2.3), Exit 0 |
| sonst | stderr `sh: <wort>: command not found`, Exit 127 |

Fixture (in `sshd.mjs` oder `fixtures.mjs`, Entscheidung: eigene Datei `fixtures.mjs`, damit `sshd.mjs` klein bleibt und die Welle-1-Tasks getrennte Dateien haben): 6 Container (`api` running, `worker` running, `redis` running, `db` running mit Port 5432, `migrate` exited(0), `cron-legacy` exited(137) – gibt Töne ok/muted/bad), 5 Images (inkl. `<none>`-Dangling), 3 Volumes, 3 Netzwerke, Compose-Labels `com.docker.compose.project=shop` auf vier Containern (Projekt-Gruppierung `inventory-parsers.ts:98-100`). Docker-Zeitformat `2026-10-18 10:00:00 +0200 CEST` (`inventory-parsers.ts:36`), Größen `142MB` (`inventory-parsers.ts:29-34`).

**Shell-Ergänzung** `sshd.mjs:13-18`: `docker logs -f --tail 500 api` (20 Zeilen Log, dann offen bleiben; `Ctrl+C` beendet nur die Zeile – reicht) und `docker exec -it api sh -c '…'` (Prompt `/app #`). Nur nötig, wenn der Container-Logs-Tab fotografiert wird (★, Extra).

**Nicht:** sudo-Pfad (`containers.sudo` bleibt aus), Podman (gleicher Parser, nur Format; bringt dem Screenshot nichts), Proxmox `pct`/`qm` (★ Extra, wäre zwei Zeilen in der Sonde + `pct list`-Text; weglassen, bis jemand es braucht).

**Lokale Container – bewusst ausgelassen.** Der lokale Pfad ruft `execFile('docker', ['--version'])` auf dem echten Rechner auf (`discovery.ts:179-187`). Mit Docker Desktop erscheint „Dieser Computer" in der Seitenleiste und die lokale Ansicht würde echte Container zeigen. Keine Screenshots davon; Seitenleisten-Bilder können je nach Rechner diesen Knoten enthalten – im SKILL.md vermerken. Keine PATH-Manipulation im Treiber (würde auch `where.exe`/ConPTY-Pfade treffen).

### 2.3 Kubernetes – ★★★, nur Skill-Dateien, **höchster Aufwand und einziges echtes Risiko**

**Gegenstelle A: kubeconfig** liegt als Text im Exec-Handler (2.2). Inhalt:

```yaml
apiVersion: v1
kind: Config
current-context: prod
clusters:
- name: prod
  cluster:
    server: https://k8s-cp1:6443
    insecure-skip-tls-verify: true
contexts:
- name: prod
  context: { cluster: prod, user: admin, namespace: shop }
users:
- name: admin
  user: { token: synthetic-kube-token }
```

`https:` ist Pflicht (`kubeconfig.ts:168`). `k8s-cp1:6443` statt `127.0.0.1` sorgt für einen realistischen Eintrag und erlaubt dem `tcpip`-Handler eine enge Regel (nur `destPort === 6443` → `net.connect(KUBE_PORT, '127.0.0.1')`, alles andere `reject()`), so wird der Testserver nie zum offenen Relay. `tlsServerName` wird dann `k8s-cp1` (`kubeconfig.ts:176`); mit skip-verify prüft niemand den Namen.

**Gegenstelle B: `kube-fake.mjs`**, HTTPS auf `127.0.0.1:9334`. Node hat keinen X.509-Generator; das Zertifikat kommt beim Start per `openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -subj /CN=k8s-cp1 -days 2 -keyout key.pem -out cert.pem` in den Run-Ordner (openssl liegt in Git Bash unter `C:\Program Files\Git\usr\bin\openssl.exe`, auf Linux/macOS systemweit). **Kein statisches PEM im Repo** (Secret-Scanner, und ein privater Schlüssel im Git ist auch synthetisch kein guter Stil). Fehlt openssl → `kube-fake.mjs` meldet es, `sshd.mjs` läuft ohne Cluster, `screens.mjs` überspringt die Kubernetes-Bilder mit Hinweis.

Endpunkte (Pfade aus `client-api.ts:21-26`, Discovery aus `object.js:377-399`):

| Pfad | Antwort |
|---|---|
| `GET /api/v1`, `/apis/apps/v1`, `/apis/batch/v1`, `/apis/networking.k8s.io/v1` | `APIResourceList` mit `resources[{name, kind, namespaced, verbs}]` für Pod, Service, Node, Event, Namespace, Deployment, StatefulSet, DaemonSet, Job, CronJob, Ingress |
| `GET /api/v1/pods`, `/api/v1/namespaces/<ns>/pods`, dito für alle Kinds (`resourcePath`) ohne `watch` | `{kind:'<Kind>List', apiVersion, metadata:{resourceVersion:'1'}, items:[…]}`; `labelSelector`/`fieldSelector` werden ehrlich ausgewertet (nur `spec.nodeName=` und `k=v`), ~15 Zeilen |
| dito mit `?watch=true` | 200, `Transfer-Encoding: chunked`, Header sofort senden, eine `BOOKMARK`-Zeile, Verbindung offen halten; nach `timeoutSeconds` (max 300 s) sauber schließen (Watcher setzt dann fort, `watch.ts:36`) |
| `GET /api/v1/namespaces/<ns>/pods/<name>` u. a. | das Objekt (für YAML/Describe) |
| `GET /api/v1/namespaces/<ns>/events?fieldSelector=…` | 3 Events |
| `GET /api/v1/namespaces/<ns>/pods/<name>/log` | 15 Logzeilen, dann Ende (bei `follow=true` offen halten) |
| `GET /apis/metrics.k8s.io/v1beta1/nodes`, `/pods`, `/namespaces/<ns>/pods` | `NodeMetricsList`/`PodMetricsList` mit `usage:{cpu:'420m', memory:'2831Mi'}` – gibt CPU/RAM in den Node-Kacheln |
| `PATCH`/`DELETE`/`POST` | 403 mit `Status`-Body (`cannot patch resource "deployments" … namespace "shop"`) – die App zeigt eine saubere Verbotsmeldung (`client-api.ts:103-110`); nichts wird verändert |
| sonst | 404 `Status` |

Fixture (in `kube-fixtures.mjs`, eigene Datei): 3 Nodes (`k8s-cp1` control-plane, `k8s-w1`, `k8s-w2`; `k8s-w2` mit `Ready=False` für das Problembanner), Namespaces `shop`, `monitoring`, `kube-system`; in `shop` 7 Pods (Deployment `api` 3/3, `worker` 2/2, `checkout` 1 Pod `CrashLoopBackOff` mit `restartCount 14`, `image-migrate` Job Completed, `report` Pending seit 20 min), Deployments/StatefulSet `postgres`/DaemonSet `node-exporter` in `monitoring`/CronJob `nightly-report`/2 Services/1 Ingress. `creationTimestamp` relativ zu `Date.now()` beim Start (Alter-Spalten).

**Risiken, ehrlich:** (1) client-node deserialisiert Listen über `ObjectSerializer`; fehlende Felder sind okay, falsche Typen (z. B. `restartCount` als String) werfen. (2) Der Watch läuft über undici mit eigenem Dispatcher; die Antwort muss Header sofort flushen, sonst hängt `watch.watch()` bis zum Timeout. (3) `/api/v1` wird einmal je `KubernetesObjectApi`-Instanz gelesen, bei der Sonde (`session.ts:277`) also früh – ein Fehler dort endet als „API-Fehler" in der Statuszeile. Deshalb gehört zu diesem Teil der Selbsttest (Abschnitt 6), der die Kette `readKubeconfig → parseKubeconfig → createKubeApi(list nodes)` einmal gegen den Fake laufen lässt. Aufwand realistisch: 250–350 Zeilen, der größte Einzeltask.

**Entscheidung:** Machen, als eigener Task in Welle 1, mit Selbsttest. Vereinfachung gegenüber „alles": keine `exec`-WebSocket-Shell in Pods (Shell-Dock bleibt Fehlerkarte „Verbindung zum Container fehlgeschlagen" – wird nicht fotografiert), keine Mutationen.

### 2.4 KI-Assistent – ★★★, nur Skill-Dateien, geringes Risiko

**Gegenstelle: `ai-fake.mjs`**, HTTP auf `127.0.0.1:9335`. `POST /v1/chat/completions`: ohne `authorization: Bearer sk-synthetic-demo` → 401 (zeigt, dass der Schlüssel benutzt wird); sonst SSE mit 10–15 Deltas im 40-ms-Takt (sichtbar „tippend"), Antwort deutsch mit Befehlsblock, damit der Knopf „Eintippen" erscheint (`AssistantPanel.tsx:218`):

> Der Dienst läuft, aber die Platte ist zu 42 % belegt. Prüfe die größten Ordner:
> ```
> du -xh --max-depth=1 /var | sort -h | tail -5
> ```

Die letzte Nutzer-Nachricht entscheidet über die Antwort: enthält sie `Test`/`test` (Testknopf, `assistant.test.user`) → kurzer Satz „Bereit."; sonst die Standardantwort. Alles andere (404 bei falschem Pfad, `[DONE]`) wie OpenAI.

**Vault-Eintrag:** Anbieter `OpenAI`, Name `Demo-KI`, Modell `gpt-4o-mini`, Basis-URL `http://127.0.0.1:9335/v1`, Schlüssel `sk-synthetic-demo`. Schlüssel liegt verschlüsselt im Demo-Vault im Temp-Profil, nie im Repo außer als Literal im Setup (ist kein echter Schlüssel). Anlegen im `demo-setup.mjs` über Einstellungen → „Anbieter verwalten" → „OpenAI" → `/fill` auf `input[id$="-name"]`, `-model`, `-baseUrl`, `-apiKey` → „Speichern". (Feld-IDs prüfen: `AiSettingsDialog.tsx` `field()`-Helfer; Umsetzer liest die Zeile und nimmt den tatsächlichen Präfix.)

### 2.5 Einstellungen – ★★, nur Szenario

Kein Backend. Zwei Bilder: `settings.png` (Dialog mit drei Abschnitten, KI-Zeile „1 Anbieter, Standard: Demo-KI") und `ai-settings.png` (Anbieterliste). Wartebedingung: `document.querySelector('dialog.settings-dialog')?.open`.

### 2.6 Bewusst weggelassen

- **RDP:** braucht einen echten RDP-Server und den nativen `Shellherd.RdpHost`; kein Fake ohne RDP-Protokollimplementierung. `SKILL.md:76` behält RDP als Ausnahme.
- **Lokale Container:** siehe 2.2.
- **Proxmox, Podman, sudo-Prompt, Container-Shell, Pod-Shell, Mutationen (Scale/Delete/Restart):** nichts davon ändert das Bild einer Übersicht; alles ist später je ~10–30 Zeilen Fixture, wenn ein Review es braucht.
- **Linux/xvfb:** unverändert nicht erprobt.

---

## 3. Szenario-Skript `screens.mjs`

Eigene Datei, Node ≥ 22, nutzt `fetch` wie `demo-setup.mjs`. Aufruf: `node .claude/skills/run-app/screens.mjs [name…]` (ohne Argument alle). Voraussetzung: Treiber läuft, Vault ist offen (Skript ruft nicht `demo-setup` auf, prüft nur `.workspace-save` und bricht sonst mit Hinweis ab).

**Helfer** (oben im Skript, ~25 Zeilen, keine Abhängigkeit zu `demo-setup.mjs`, dort bleibt `pause()` – Umbau ist nicht Teil des Auftrags):

```js
// Polls a renderer expression until it is truthy; the failure names the step, not just "timeout".
async function waitFor(step, expression, { timeout = 20000, every = 250 } = {}) { … via call('eval', `return !!(${expression})`) … }
const waitText = (selector, pattern) => waitFor(…, `[...document.querySelectorAll(${sel})].some(e => ${re}.test(e.textContent))`);
async function shot(name) { await call('ss', undefined, `?name=${name}&crop=status`); }
async function closeTabs() { … schließt alle Terminal-Tabs über ihre Schließen-Knöpfe, wartet bis 0 Tabs … }
```

**Schritte und feste Dateinamen** (alle `crop=status`):

| Datei | Schritte | Wartebedingung |
|---|---|---|
| `sftp.png` | `files-01` verbinden (Klick `text=files-01`, Enter); lokale Spalte per Pfadfeld auf `%TEMP%\shellherd-run\local` | `.file-pane-remote [role=row][data-name]` ≥ 5 **und** Pfad-Nav der Remote-Spalte enthält `/home/demo` |
| `sftp-transfer.png` (★) | Datei `backups/db-2026-10-19.sql.gz` markieren, F5 | Eintrag in `.transfer-queue` mit „fertig" |
| `containers.png` | Rechtsklick `web-01` → `Container-Ansicht öffnen` | `.kube-table tbody tr` ≥ 6 in der Container-Ansicht (Tab-Titel endet auf ` · Container`, `containers.ts:123`) |
| `containers-tree.png` (★) | Rechtsklick `web-01` → „Laufzeiten anzeigen" | Baum enthält `api` und `redis` |
| `kubernetes.png` | Cluster `prod-k8s` verbinden | Statuszeile `/bereit über web-01/` **und** `.kube-table tbody tr` ≥ 5 |
| `kubernetes-problems.png` (★) | Klick auf das Problembanner | Banner aufgeklappt (`ProblemBanner`-Liste sichtbar) |
| `settings.png` | `.settings-button` | `dialog.settings-dialog[open]` |
| `ai-settings.png` | Knopf „Anbieter verwalten" | Dialog mit `.ai-provider-list li` ≥ 1; danach Escape ×2 |
| `assistant.png` | `web-01` verbinden, Terminal `df -h /` + Enter, `.assistant-toggle`, Textfeld füllen „Ist die Platte zu voll?", Knopf „Fragen" | `.assistant-typing` nicht mehr vorhanden **und** letzte Antwort enthält „du -xh" |

Vor jedem Block `closeTabs()`, damit Tab-Leiste und Fokus deterministisch sind. Jeder Block ist eine `async`-Funktion in einer Map `{ sftp, containers, kubernetes, settings, assistant }`; die Argumente wählen Blöcke aus. Fehler eines Blocks werden gemeldet, das Skript macht mit dem nächsten weiter und endet mit Exit 1, wenn einer fehlte.

Selektoren wie `.file-pane-remote` (`FilePane.tsx:194`), `[role=row][data-name]` (`FilePane.tsx:250`), `.kube-table` (`ContainerTable.tsx:161`, `ResourceTable.tsx:161`), `.assistant-typing` (`AssistantPanel.tsx:223`), `.ai-provider-list` (`AiSettingsDialog.tsx:84`) sind Bestand; der Umsetzer verifiziert jeden im Code, bevor er ihn nutzt, und hält sich an die Regel „Felder mit `/fill`, Terminal mit `/type`" (`SKILL.md:71`).

---

## 4. Prozessmodell und Ports

Ein Hintergrundprozess bleibt: `npm run drive:sshd` startet `sshd.mjs`, das `startKubeFake()` und `startAiFake()` importiert und zuerst startet (kubeconfig-Text braucht nichts vom Fake außer dem Port, der ist fest). `package.json` bleibt unverändert.

| Dienst | Adresse | Datei |
|---|---|---|
| Treiber | `127.0.0.1:9333` (`DRIVER_PORT`) | `driver.mjs` |
| SSH/SFTP-Testserver | `127.0.0.1:2222` (`SSHD_PORT`) | `sshd.mjs` |
| Kubernetes-API-Fake | `127.0.0.1:9334` (`KUBE_FAKE_PORT`) | `kube-fake.mjs` |
| KI-Fake | `127.0.0.1:9335` (`AI_FAKE_PORT`) | `ai-fake.mjs` |

**Modulvertrag (fest, damit Welle 1 parallel laufen kann):**

```js
// kube-fake.mjs
export async function startKubeFake({ port = 9334, dir }) // → { port, close() } ; wirft Error('openssl fehlt …') wenn kein openssl
export const KUBECONFIG // Text mit server https://k8s-cp1:6443 (Port im Text ist fest 6443; der tcpip-Handler mappt)
// ai-fake.mjs
export async function startAiFake({ port = 9335 }) // → { port, close() }
// sshd.mjs
export async function startSshd({ port = 2222, sftpRoot, kubeconfig, kubePort }) // → { port, close() }
// fixtures.mjs: export const CONTAINERS, IMAGES, VOLUMES, NETWORKS, INSPECT (Docker-JSON-Objekte); export function seedSftp(root)
// kube-fixtures.mjs: export function buildCluster(now) → { nodes, pods, deployments, …, events, metrics }
```

Jede Datei läuft auch allein (`if (import.meta.url === pathToFileURL(process.argv[1]).href) …`), so lässt sich ein Fake isoliert mit `curl` prüfen.

---

## 5. Demo-Vault (`demo-setup.mjs`)

Im „neu"-Zweig (`demo-setup.mjs:52-69`) ergänzen, in dieser Reihenfolge:

1. `addSsh('web-01', 2222, 'synthetic-demo')` – bleibt; ist zugleich Container-Host und Kubernetes-Zugangshost.
2. `addSftp('files-01', 2222, 'synthetic-demo')` – wie `addSsh`, Menüeintrag `SFTP (Dateien)`.
3. Cluster: Rechtsklick `web-01` (`/rclick` mit `text=web-01 >> nth=0`) → `menuItem('Als Kubernetes-Cluster einrichten')` → warten bis `input[id$="-context"]` sichtbar und Zugangshost-Liste `web-01` enthält → Name `prod-k8s` (`input[id$="-name"]`), Namespace bleibt aus der kubeconfig (`shop`), Produktion **an** (roter Rahmen im Screenshot zeigt das Feature), Nur-Lesen aus → „Verbindung speichern". Setzt voraus, dass `sshd.mjs` mit Kube-Fake läuft; sonst bricht die Sonde ab → Setup meldet „Cluster übersprungen (Testserver ohne Kubernetes)" und macht weiter.
4. KI-Anbieter wie in 2.4.
5. `Staging`-Ordner und Editor schließen wie bisher.

**Bestehende Profile:** Der „entsperren"-Zweig legt nichts nach. Regel im SKILL.md: „Für die neuen Einträge `%TEMP%\shellherd-run\profile\demo.term` löschen und `demo-setup.mjs` erneut laufen lassen." Keine Migrationslogik im Setup – zu viel Code für ein Entwicklerwerkzeug.

Hinweis-Pflicht: Der Cluster-Eintrag speichert nur IDs und Einstellungen (`types.ts:94-105`), nie die kubeconfig – das Setup verhält sich wie ein Nutzer.

---

## 6. Regeln, Sicherheit, Prüfungen

**Sicherheit (bindend, aus `SKILL.md:8-12,30`, `2026-10-16-kubernetes-integration-design.md:310`, `2026-10-14-container-integration-design.md:210-216`):**
- Alle Fakes binden ausschließlich `127.0.0.1`. `tcpip`-Handler leitet nur `destPort 6443` auf `127.0.0.1:<KUBE_FAKE_PORT>`; jede andere Anfrage `reject()`. Kein `tcpip-forward` (Remote-Listener).
- Treiber-Token bleibt unverändert (`driver.mjs:84-88`); `screens.mjs` liest es wie `demo-setup.mjs:13`.
- Kein echter Vault, kein `%APPDATA%\Shellherd`; alles unter `%TEMP%\shellherd-run`. Der SFTP-Fake schreibt nur unterhalb seiner Wurzel (`posix.normalize` + `join(root, …)` wie `sftp-loopback.test.ts:19`).
- Keine echten API-Schlüssel: `sk-synthetic-demo` und `synthetic-kube-token` sind erkennbar synthetisch; der KI-Fake prüft nur Gleichheit.
- Nichts Veränderndes nach außen: der Kubernetes-Fake beantwortet Schreibzugriffe mit 403; der Container-Fake kennt keine `start/stop/rm`-Befehle (→ 127, die App zeigt „Befehl fehlgeschlagen"). Das ist gewollt: der Skill kann keine echten Systeme berühren, selbst wenn jemand im Screenshot-Lauf klickt.
- Zertifikat/Schlüssel entstehen pro Start im Run-Ordner, nie im Repo.

**CLAUDE.md-Regeln:** Es wird **kein** `src/`-Code geändert → i18n-Katalog-Test (`i18n-catalog.test.ts:28-44` scannt nur `src/`) und Design-Token-Test greifen nicht. Deutsche Selektor-Texte in `.mjs` sind wie in `demo-setup.mjs` zulässig. `mainT`/`AppError`: nicht betroffen. Design-System: nicht betroffen (keine UI).

**Tests:** Ponytail-Regel „neue nicht-triviale Logik bekommt einen kleinen Test": Marker-Parsing im Exec-Handler, Discovery/List/Watch im Kube-Fake und SSE im KI-Fake sind nicht trivial. Empfehlung: **eine** Testdatei `.claude/skills/run-app/fakes.test.mjs` plus eine Zeile in `vitest.config.ts:5` (`include` um `.claude/skills/run-app/*.test.mjs` ergänzen – einzige Änderung außerhalb des Skill-Ordners). Inhalt, ~80 Zeilen, Ports 0:
1. `startSshd` + `openRemoteHost` (echter App-Code aus `src/main/containers/runner.ts`) → `run(PROBE_COMMAND)` liefert `has:docker`; `inventoryBatchCommand` + `splitInventoryBatch` ergeben vier Listen mit Code 0 und ≥ 1 Zeile; `readKubeconfig` liefert `src:/home/demo/.kube/config`. `describe.runIf(win32)` wie `sftp-loopback.test.ts:64` (dort steht die Erfahrung, dass ssh2-Server-Tests auf Linux-CI wackeln).
2. `startKubeFake` + `parseKubeconfig(KUBECONFIG).build(port)` + `createKubeApi(...).list('nodes', null)` → 3 Items; `nodeMetrics()` → 3 Samples. Übersprungen, wenn `openssl` fehlt (`execFileSync('openssl', ['version'])` in `try`).
3. `startAiFake` + `streamChat({kind:'openai', baseUrl, apiKey}, …)` aus `src/main/ai/providers.ts` → Text enthält `du -xh`; falscher Schlüssel → `ai.keyRejected`.
Damit prüft der Test genau die Schnittstellen, über die die App spricht, mit dem echten App-Code als Client. Läuft in CI (`ci.yml` ruft vitest), Dauer < 5 s.

**Version/CHANGELOG:** Nicht nötig. `src/shared/version.test.ts:10-25` prüft nur, dass der oberste CHANGELOG-Eintrag der `package.json`-Version entspricht; beides bleibt. Die beiden bisherigen Skill-Commits (`002259e`, `3638b6f`) hatten keinen CHANGELOG-Eintrag. `README.md:94-105` beschreibt den Skill kurz – ein Halbsatz „… and local fakes for SFTP, containers, Kubernetes and the AI assistant" ist angemessen (★, Welle 2, gleiche Datei wie SKILL.md-Task? Nein: README ist eigene Datei, kann in Welle 2 parallel).

**App-Prüfung:** Die Screenshots selbst sind die Abnahme (`SKILL.md:32`: „Screenshot immer ansehen"). Der Prüfer in Stufe 4 sieht sich alle neun PNGs an.

---

## 7. Zerlegung in Tasks und Wellen

Alle Pfade unter `.claude/skills/run-app/`, außer wo genannt. Dateien je Task sind disjunkt.

**Welle 1 (parallel, 5 Tasks):**

| Task | Dateien | Inhalt | Abhängigkeit |
|---|---|---|---|
| 1A SSH-Testserver | `sshd.mjs`, `fixtures.mjs` | `startSshd` mit `sftp` (aus Loopback-Test), `exec` (Tabelle 2.2), `tcpip` (nur 6443), Shell-Ergänzung `docker logs`; Docker-Fixture; `seedSftp`; Main-Block startet beide Fakes nach Vertrag 4 | Vertrag 4 (importiert `./kube-fake.mjs`, `./ai-fake.mjs`) |
| 1B Kubernetes-Fake | `kube-fake.mjs`, `kube-fixtures.mjs` | HTTPS-Server, openssl-Zertifikat, Discovery, Listen, Watch, Objekt, Events, Logs, Metrics, 403 für Schreibzugriffe; `KUBECONFIG` | keine |
| 1C KI-Fake | `ai-fake.mjs` | SSE-Endpunkt, 401, Testantwort | keine |
| 1D Demo-Vault | `demo-setup.mjs` | `addSftp`, Cluster über Kontextmenü, KI-Anbieter, Überspringen bei fehlendem Kube | zum Ausprobieren 1A–1C, zum Schreiben nicht |
| 1E Selbsttest | `fakes.test.mjs`, `vitest.config.ts` (eine Zeile) | Abschnitt 6, gegen den Vertrag geschrieben | läuft erst grün, wenn 1A–1C fertig sind; schreiben parallel |

**Welle 2 (parallel, 3 Tasks, nach Welle 1):**

| Task | Dateien | Inhalt |
|---|---|---|
| 2A Szenario | `screens.mjs` | Abschnitt 3; verifiziert Selektoren im Renderer-Code; läuft einmal komplett und legt neun PNGs ab |
| 2B Doku | `SKILL.md` | Tabelle der Gegenstellen und Ports, Demo-Vault-Tabelle erweitern (files-01, prod-k8s, Demo-KI), `screens.mjs`-Aufruf, Hinweis „Profil löschen für neue Einträge", Zeile 76 ersetzen durch „RDP und lokale Container brauchen echte Gegenstellen", Stolperstein „Dieser Computer erscheint, wenn Docker lokal installiert ist", Stolperstein openssl |
| 2C README | `README.md:94-105` | ein Halbsatz zur Abdeckung |

**Welle 3 (ein Task):** Gesamtlauf nach SKILL.md-Ablauf: Build, `drive:sshd`, `drive`, `demo-setup.mjs` auf frischem Profil, `screens.mjs`, alle PNGs ansehen, `npm run typecheck`, `npx vitest run`. Korrekturen nur in den Dateien des jeweiligen Fehlers.

**Konflikte:** `sshd.mjs` wird nur von 1A angefasst; `demo-setup.mjs` nur von 1D; `SKILL.md` nur von 2B. `package.json` bleibt unberührt. `vitest.config.ts` nur 1E.

---

## 8. Minimale erste Stufe gegenüber Extras

**Minimal (erfüllt den Auftrag):** 1A ohne Shell-Ergänzung, 1B, 1C, 1D, 1E, 2A mit den fünf Pflichtbildern `sftp.png`, `containers.png`, `kubernetes.png`, `settings.png` (+ `ai-settings.png`, kostet nichts), `assistant.png`, 2B.

**Extras (★, nur wenn Zeit bleibt, je eigener kleiner Schritt):** `sftp-transfer.png`, `containers-tree.png`, `kubernetes-problems.png`, Container-Logs-Tab, README-Halbsatz, Proxmox-Zeilen in der Sonde, Podman-Variante.

**Nicht jetzt:** RDP, lokale Container, Pod-Shell (WebSocket-Exec), Mutationen, `pause()`-Umbau in `demo-setup.mjs`, Linux-Erprobung.

---

## 9. Offene Entscheidungen, hier festgelegt (Rulings für die Spec)

1. Kubernetes-Fake ist HTTPS mit openssl-Zertifikat zur Laufzeit; kein PEM im Repo; ohne openssl wird Kubernetes übersprungen, der Rest läuft.
2. kubeconfig zeigt auf `https://k8s-cp1:6443`; der `tcpip`-Handler mappt nur Port 6443 auf den Fake und lehnt alles andere ab.
3. Ein Hintergrundprozess (`npm run drive:sshd`) startet alle drei Gegenstellen; `package.json` bleibt unverändert.
4. Schreibende Kubernetes-Aufrufe liefern 403, unbekannte Exec-Befehle 127. Der Skill kann nichts verändern.
5. Lokale Container und RDP werden nicht fotografiert; „Dieser Computer" darf je nach Rechner in Seitenleisten-Bildern erscheinen.
6. Lokale Spalte der Dateiansicht wird vor dem Screenshot auf einen synthetischen Ordner navigiert (kein Windows-Benutzername im Bild).
7. Neue Vault-Einträge entstehen nur beim Anlegen des Demo-Vaults; bestehende Profile werden gelöscht, nicht migriert.
8. Ein Selbsttest `fakes.test.mjs` mit echtem App-Code als Client, aktiviert über eine Zeile in `vitest.config.ts`; keine Version, kein CHANGELOG.
