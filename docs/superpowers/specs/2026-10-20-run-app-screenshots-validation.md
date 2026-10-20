# run-app: Screenshots aller Komponenten – Validierung (bindend)

Spec: `docs/superpowers/specs/2026-10-20-run-app-screenshots-design.md` · Plan: `docs/superpowers/plans/2026-10-20-run-app-screenshots.md` · Stand: HEAD 9baddb9, Baseline `npx vitest run` 120 Dateien / 1670 Tests grün.

**Urteil: ready after corrections.** 5 Blocker, 14 Korrekturen, 6 Entscheidungen. Dieser Anhang geht Spec und Plan vor. Wo er schweigt, gilt die Spec.

## Geprüft und bestätigt (keine Änderung nötig)

- **Container-Sonde:** `PROBE_COMMAND` = `sh -c '…for c in docker podman pct qm…'` (`commands.ts:12,19`). Der Teilstring `for c in docker podman pct qm` steht wörtlich im Befehl. `parseProbe` erwartet Zeilen `has:docker` (`parsers.ts:21-29`). Exit ≠ 0 wird zum Fehler (`discovery.ts:43-49`).
- **Inventar-Batch:** Ohne sudo ist das `sh -c 'PATH=…; docker ps -a --no-trunc --format '\''{{json .}}'\''; c=$?; echo; echo '\''[terminus-list-<16hex>]:containers:'\''"$c"; echo >&2; echo … >&2; …'` (`inventory-batch.ts:17-25`). Der Marker steht wörtlich im Befehl, die Regex `/\[terminus-list-[0-9a-f]{16}\]/` trifft ihn. Reihenfolge der Kinds: `containers, images, volumes, networks`. `splitInventoryBatch` sucht `^<marker>:<kind>:<code>$` je Zeile, nur in dieser Reihenfolge, auf stdout und stderr getrennt (`inventory-batch.ts:33-75`). Das Format aus Spec 2.2 passt. Für jede Liste kommt `<json-zeilen>\n` + `\n` + `<marker>:<kind>:0\n` auf stdout, auf stderr `\n<marker>:<kind>:0\n`. Ohne `containers.sudo` gibt es keinen sudo-Pfad (`sudoSetting`, `commands.ts:51`).
- **Inspect:** `PATH="$PATH:/usr/sbin:/sbin" docker container inspect <ref>` (`remoteCommand` none, `inspectArgv`). Ohne `sh -c`.
- **AUTO_SCRIPT:** `sh -lc '<AUTO_SCRIPT>'` mit dem Teilstring `KUBECONFIG%%` (`access.ts:15-21,57`). Die Antwort `src:/home/demo/.kube/config\n<yaml>` mit Exit 0 wird so gelesen (`access.ts:58-63,79`). `src:none` ergibt `kubernetes.kubeconfigNotFound`. Formular-Sonde: `ipc.ts:75-87`, derselbe Weg.
- **kubeconfig:** `parseKubeconfig` (`kubeconfig.ts:36-64`, die Zeilennummern der Spec stimmen nicht) verlangt `https:` und lehnt `exec`/`authProvider` sowie Dateireferenzen ab. `certificate-authority-data` ist erlaubt. `build()` übernimmt `{...cluster}` samt `caData`/`skipTLSVerify` und setzt `tlsServerName` = Host aus der URL (`k8s-cp1`).
- **TLS mit Selbst-signiert über `certificate-authority-data`:** Das funktioniert. client-node 2.0.0 legt `caData` als `ca` und `tlsServerName` als `servername` in den undici-Dispatcher (`config.js:520-560,587-595`). Probe auf diesem Rechner: `openssl req -x509 … -subj /CN=k8s-cp1 -addext subjectAltName=DNS:k8s-cp1` per `execFileSync` aus Node, dann `https.get({servername:'k8s-cp1', ca})` ergibt „ok“. Die Altname-Wiederholung mit `kubernetes` (`session.ts:275-286`) wird nicht gebraucht.
- **Tunnel:** `openTunnel` öffnet pro Socket `client.forwardOut('127.0.0.1', 0, 'k8s-cp1', 6443)` (`tunnel.ts`, `runner.ts:52-59`). ssh2 1.17.0 meldet das serverseitig als `client.on('tcpip', (accept, reject, info))` mit `info.destIP`/`info.destPort` (`ssh2/lib/server.js:608-642`). Ohne Listener wird abgelehnt.
- **client-node 2.0.0, was die App wirklich aufruft:**
  - `list`: Discovery `GET /api/v1` bzw. `/apis/<g>/<v>`, gecacht je Objekt-API-Instanz (`object.js:377-399`). Danach `GET <pfad>` mit `fieldSelector`/`labelSelector`. Der Pfad wird komplett **lowercased** (`object.js` `specUriPath`, `.toLowerCase()`).
  - Antwort: `Content-Type` ist Pflicht, sonst wirft `ObjectSerializer.parse` „No Content-Type“. Typ aus `apiVersion`+`kind` der Antwort (`util.js:170`).
  - `read`: `GET …/<name>`.
  - `watch`: undici-`fetch`, wartet auf die Antwort-Header, dann ndjson zeilenweise. Ende durch Schließen, kein Fehler (`watch.js`). Die App setzt `requestTimeoutMs` auf 600 s und `timeoutSeconds=300`.
  - Metrics: `fetch` + `response.json()` **vor** der Statusprüfung (`metrics.js`). Jeder Body muss also JSON sein, auch bei 404.
  - Health-Checks per HTTP gibt es nicht. `checkHealth` prüft nur `host.closed` (`session.ts:302-310`).
  - Logs: eigener `https.request` mit `applyToHTTPSOptions` (`client-api.ts:205-230`).
- **KI:** OpenAI-Art `POST <baseUrl>/chat/completions`, `authorization: Bearer …`, Body `{model, stream:true, messages:[system, …]}` (`providers.ts:47-52`). `sseData` liest `data:`-Zeilen und überspringt `[DONE]`. `deltaText` liest `choices[0].delta.content` (`providers.ts:62-87,113-120`). 401/403 ergibt `ai.keyRejected`. Der Test-Knopf schickt den System-Prompt „Antworte nur mit dem Wort OK.“ mit der Nutzernachricht „Verbindungstest“ (en: „Connection test“) (`assistant.ts:86-98`, `main.json:53-56`). `http://127.0.0.1:9335/v1` besteht `z.string().url()`.
- **Selektoren im Renderer, die stimmen:**
  - `.file-pane-remote`/`.file-pane-local` (`FilePane.tsx:194`, Klasse `file-pane-${side}`)
  - `[role=row][data-name]` (`FilePane.tsx:250`)
  - `nav[aria-label="Pfad"]` (`FilePane.tsx:213`, `files.json:29`)
  - `.kube-table` (`ContainerTable.tsx:161`, `ResourceTable.tsx:178`)
  - `.assistant-typing` (`AssistantPanel.tsx:223`)
  - `.ai-provider-list` (`AiSettingsDialog.tsx:84`)
  - `.settings-button` (`App.tsx:782`)
  - `.assistant-toggle` (`App.tsx:776`)
  - `dialog.settings-dialog` (`SettingsDialog.tsx:45`)
  - `.terminal-tab-close` (`TerminalTabs.tsx:59`)
  - Statustext „bereit über {{host}}“ (`kubernetes.json:177`)
- **Cluster-Formular:** `setupCluster` (`App.tsx:618-636`) öffnet das Formular vorbefüllt. Name = `clusterName` aus der Sonde (hier `prod`), `production: true`, `readOnly: false` (`cluster-form.ts:36-46`). Das Namensfeld hat die ID `<prefix>-name` (`ConnectionForm.tsx:141`), das Kontextfeld `<prefix>-context` (`ClusterForm.tsx:103`). Der Knopf heißt „Verbindung speichern“ (`connection.json:112`). Schlägt die Sonde fehl, kommt nur eine Meldung und kein Formular (`App.tsx:622-626`).
- **SFTP-Formular:** Es hat dieselben Felder wie SSH (`ConnectionForm.tsx:63`, `sshAuth` für ssh und sftp). Der Menüeintrag heißt „SFTP (Dateien)“ (`vault.json:8`).
- **Testumgebung:**
  - Vitest 5.0.1 / Vite 7.3.6: Die Default-Excludes sind nur `node_modules` und `.git`, `tinyglobby` findet `.claude/skills/run-app/*.mjs`. `import.meta.dirname` wird vom Module-Runner gesetzt.
  - `runner.ts`, `access.ts`, `kubeconfig.ts`, `client-api.ts`, `tunnel.ts` und `providers.ts` haben eigene Vitest-Tests, lassen sich also ohne Electron importieren.
  - `tsconfig*` schließt `.claude/` nicht ein. Typecheck ist nicht betroffen.
  - CI: `windows-latest`, Node 24, `npx vitest run` (`ci.yml`).
- **openssl unter Windows:**
  - Git Bash liefert `/mingw64/bin/openssl` (OpenSSL 3.5.4, nativ, kein MSYS) und zusätzlich `usr/bin/openssl.exe` (MSYS).
  - Aufruf per `execFile` aus Node (kein Shell): `-subj /CN=k8s-cp1` kommt unverändert an, nicht-interaktiv, ohne `-config` (geprüft).
  - Die MSYS-Pfadumwandlung greift nur, wenn eine MSYS-Shell ein natives Programm startet, also beim Tippen in Git Bash. Deshalb nie über die Shell aufrufen (K5).

---

## Blocker

**X1 – KI-Antwort im falschen Format, der Knopf „Eintippen“ erscheint nie.** Befehle erkennt die App an `<command>…</command>`, nicht an Markdown-Zäunen (`assistant-chat.ts:7-26`, `AssistantPanel.tsx:212-219`). Mit dem Zaun aus Spec 2.4 zeigt das Bild nur Text.
**Fix:** Die Standardantwort des KI-Fakes lautet wörtlich (Zeilenumbrüche als `\n`):
```
Der Dienst läuft, aber die Platte ist zu 42 % belegt. Prüfe die größten Ordner:
<command>du -xh --max-depth=1 /var | sort -h | tail -5</command>
```
Sie wird in Deltas von 6–12 Zeichen alle 40 ms gestreamt. Die Tags dürfen dabei über Deltas zerteilt werden, der Parser kommt damit klar (`assistant-chat.ts:14`).

**X2 – Das Anbieter-Formular hat keine Feld-IDs.** `field()` in `AiSettingsDialog.tsx:69-77` rendert `<label class="ai-field"><span>…</span><span class="ai-field-input"><input></span></label>` ohne `id`. `input[id$="-name"]` trifft dort nichts (bzw. in anderen offenen Formularen das falsche Feld). Der Knopf heißt „OpenAI-kompatibel“ (`assistant.json` `providers.openai.label`), nicht „OpenAI“.
**Fix:** Die Selektoren sind verbindlich (Reihenfolge für `openai`: Anzeigename, Modell, Basis-URL, API-Schlüssel). `has-text("Modell")` ist verboten, denn „API-Schlüssel (leer für lokale Modelle)“ enthält „Modell“.
| Schritt | Selektor |
|---|---|
| Neuer Anbieter | `dialog.ai-settings-dialog .ai-add button:has-text("OpenAI-kompatibel")` |
| Anzeigename | `dialog.ai-settings-dialog .ai-form .ai-field-input input >> nth=0` → `Demo-KI` |
| Modell | `… input >> nth=1` → `gpt-4o-mini` |
| Basis-URL | `… input >> nth=2` → `http://127.0.0.1:9335/v1` (Vorgabe `https://api.openai.com/v1` wird per `/fill` ersetzt) |
| API-Schlüssel | `… input >> nth=3` → `sk-synthetic-demo` |
| Speichern | `dialog.ai-settings-dialog .ai-form button[type=submit]` |
| Schließen | `dialog.ai-settings-dialog > .form-actions .primary-button` („Fertig“) |

**X3 – Ohne `metadata.uid` bleibt die Kubernetes-Tabelle leer.** `ResourceWatcher.store` verwirft Objekte ohne `uid` (`watch.ts:180-184`). Davon hängen Overview und Tabelle ab, und die Wartebedingung von `kubernetes.png` wird nie wahr. Außerdem fehlen in der Spec drei Pflichtteile der Antwortform: `Content-Type`, `kind`/`apiVersion` der Listen und `containers[].usage` bei Pod-Metriken (Belege oben).
**Fix:** Die Antwortformen in V3 sind bindend. Jedes Fixture-Objekt hat eine eindeutige `metadata.uid` (`uid-<kind>-<name>`), `metadata.name` (klein, DNS-tauglich) und `metadata.creationTimestamp` als ISO-String.

**X4 – Der lokale Pfad zeigt den Windows-Benutzernamen.** `%TEMP%` ist `C:\Users\<name>\AppData\Local\Temp`. Die Pfadleiste der lokalen Spalte zeigt nach der Navigation `C:\Users\<name>\…\shellherd-run\local`. Das bricht Ruling 6.
**Fix:** `screens.mjs` legt `<RUN_DIR>\local` mit den drei Dateien an (V6). Das Ziel der lokalen Spalte ist `<RUN_DIR>\local`, wenn `RUN_DIR.toLowerCase()` den Wert `os.userInfo().username.toLowerCase()` nicht enthält. Sonst ist das Ziel die Laufwerkswurzel `path.parse(RUN_DIR).root` (z. B. `C:\`), und das Skript gibt aus: `Hinweis: SHELLHERD_RUN_DIR ohne Benutzernamen setzen (z. B. C:\shellherd-run), dann zeigt die lokale Spalte synthetische Dateien.`

**X5 – Nach jedem Neustart von `sshd.mjs` schlagen alle Verbindungen fehl.** Der Host-Schlüssel entsteht pro Start neu (`sshd.mjs:10`). `known-hosts.json` liegt im dauerhaften Profil, und ein abweichender Fingerabdruck wirft `ssh.hostKeyChanged` ohne Dialog (`known-hosts.ts:52-55`). Welle 3 startet den Testserver nach Korrekturen neu. Dann scheitern SSH, SFTP, Container und Cluster.
**Fix:** `startSshd` liest den Schlüssel aus `<dir>/sshd-host-key` oder erzeugt ihn einmal dort (`utils.generateKeyPairSync('ed25519').private`, `writeFileSync(…, { mode: 0o600 })`). Der Schlüssel ist synthetisch und liegt nur im Run-Ordner.

---

## Entscheidungen

- **E1 – TLS über `certificate-authority-data` statt `insecure-skip-tls-verify`.**
  - Grund: Das ist der echte Prüfpfad der App und vom Aufwand her gleich.
  - Das Zertifikat bekommt `-addext subjectAltName=DNS:k8s-cp1`. Die kubeconfig entsteht pro Start mit dem Zertifikat. Deshalb liefert `startKubeFake` den Text zurück, und das statische `export const KUBECONFIG` aus Spec 4 entfällt.
  - Die Weiche zu skip-verify wird nicht eingebaut.
- **E2 – Ohne Kubernetes-Fake beantwortet die Exec-Weiche das AUTO_SCRIPT mit `src:none\n`, Exit 0.** Gilt, wenn `kubeconfig` undefined ist. Die App meldet dann „kubeconfig nicht gefunden“ (realistisch), und `demo-setup` überspringt den Cluster.
- **E3 – Der Kubernetes-Fake verlangt `Authorization: Bearer synthetic-kube-token`.** Ohne den Header kommt 401 `Status`. Das sind zwei Zeilen, sie entsprechen dem echten API-Server, und der Selbsttest beweist so, dass das Token aus der kubeconfig benutzt wird.
- **E4 – Kein Symlink im SFTP-Baum.** `sites-enabled` wird ein normaler Ordner mit der Datei `default`. Grund: Symlinks unter Windows brauchen Entwicklermodus oder Admin.
- **E5 – Umfang: genau sechs Bilder** (Spec S2): `sftp.png`, `containers.png`, `kubernetes.png`, `settings.png`, `ai-settings.png`, `assistant.png`. „neun PNGs“ in Spec 6/7 ist überholt. Die ★-Zeilen der Tabelle in Spec 3 entfallen, ebenso die Shell-Ergänzung `docker logs`/`docker exec` (Spec 8).
- **E6 – Die Antwort auf den Verbindungstest lautet „OK“, nicht „Bereit.“.** So passt sie zum System-Prompt der App.

---

## Vertrag (verbindliche Schnittstellen)

Alle Dateien liegen unter `.claude/skills/run-app/`. Sie sind ESM, ohne neue Abhängigkeit, und Code-Kommentare sind englisch. `ssh2` wird überall als `import ssh2 from 'ssh2'; const { Server, utils } = ssh2;` geladen. `RUN_DIR` = `process.env.SHELLHERD_RUN_DIR ?? path.join(os.tmpdir(), 'shellherd-run')`. Jedes Modul mit Hauptblock nutzt diese Weiche, die nie wirft:
```js
const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
```
Beim Import (Vitest) startet nichts. Alle Server lauschen nur auf `'127.0.0.1'`. Jedes `close()` gibt ein Promise zurück und beendet offene Verbindungen, bei HTTP(S) mit `server.closeAllConnections()`.

**V1 – `fixtures.mjs` (Task 1A)**
```js
export const CONTAINERS; // 6 Docker `{{json .}}`-Objekte, Felder wie `docker ps -a --format '{{json .}}'`:
                         // ID (64 hex), Names, Image, ImageID? , State, Status, Labels ("k=v,k2=v2"), Ports, CreatedAt ("2026-10-18 10:00:00 +0200 CEST"),
                         // Size ("142MB"), Mounts ("pgdata"), Networks ("shop_default")
export const IMAGES;     // 5: ID ("sha256:…"), Repository, Tag, Size, CreatedAt; eins mit Repository/Tag "<none>"
export const VOLUMES;    // 3: Name, Driver "local", Mountpoint, Labels
export const NETWORKS;   // 3: ID, Name, Driver, Scope, Internal (false), CreatedAt, Labels
export function inspect(ref);  // → Array mit einem Objekt (Id, Name "/api", State{Status,Running,StartedAt}, Config{Image,Env:["NODE_ENV=production"]}, Mounts, NetworkSettings) oder undefined
export function seedSftp(root); // rmSync(root,{recursive,force}) und Neuaufbau (Inhalt Spec 2.1 mit E4)
```
- **Container:** `api` running, `worker` running, `redis` running, `db` running (Ports `0.0.0.0:5432->5432/tcp`, Mount `pgdata`), `migrate` „Exited (0) 2 hours ago“, `cron-legacy` „Exited (137) 3 days ago“.
- **Compose:** Vier Container (`api`, `worker`, `redis`, `db`) tragen `com.docker.compose.project=shop`.
- **Status-Texte:** Die Status-Texte laufender Container sind „Up 3 days“. `containerTone` liest daraus `(unhealthy)`. Ein Container darf „Up 3 days (unhealthy)“ haben, wenn der Ton `bad` zu sehen sein soll. Pflicht ist das nicht.

**V2 – `sshd.mjs` (Task 1A)**
```js
export async function startSshd({ port = 2222, dir = RUN_DIR, sftpRoot = path.join(dir, 'sftp'), kubeconfig, kubePort } = {});
// → { port: number /* tatsächlicher Port, auch bei 0 */, close(): Promise<void> }
```
- **Host-Schlüssel:** aus `<dir>/sshd-host-key` (X5).
- **SFTP-Wurzel:** `seedSftp(sftpRoot)` beim Start.
- **Authentifizierung:** Passwort `demo`/`synthetic-demo` wie bisher.
- **Session-Handler:**
  - `pty`/`env`/`window-change`/`shell` bleiben unverändert (bestehender Code samt `outputs`).
  - `sftp` kommt dazu (K3), ebenso `exec` (K1).
- **Connection-Handler:** `tcpip` (K2), aber kein `request`-Listener, also kein `tcpip-forward`.
- **Hauptblock (`npm run drive:sshd`):**
  1. Kubernetes-Fake starten: `startKubeFake({ port: Number(process.env.KUBE_FAKE_PORT ?? 9334), dir: path.join(RUN_DIR, 'kube') })`. Steht in `try`, bei Fehler `console.warn('Kubernetes-Fake übersprungen: ' + error.message)`.
  2. KI-Fake starten: `startAiFake({ port: Number(process.env.AI_FAKE_PORT ?? 9335) })`.
  3. Testserver starten: `startSshd({ port: Number(process.env.SSHD_PORT ?? 2222), dir: RUN_DIR, kubeconfig: kube?.kubeconfig, kubePort: kube?.port })`.
  4. Je eine Zeile ausgeben: `sshd ready on 2222 (demo / synthetic-demo)`, `kube-fake ready on 9334` bzw. die Warnung, `ai-fake ready on 9335`.

**V3 – `kube-fixtures.mjs` und `kube-fake.mjs` (Task 1B)**
```js
// kube-fixtures.mjs
export function buildCluster(now = Date.now());
// → { nodes, pods, deployments, statefulsets, daemonsets, jobs, cronjobs, services, ingresses, events, namespaces,
//     nodeMetrics, podMetrics }   // Schlüssel = Plural-Ressourcenname wie im URL-Pfad; Werte = Arrays ohne apiVersion/kind je Item
// kube-fake.mjs
export const KUBE_SERVER = 'https://k8s-cp1:6443';
export const KUBE_TOKEN = 'synthetic-kube-token';
export function findOpenssl();  // → Pfad oder null; Reihenfolge: process.env.OPENSSL, 'openssl' (PATH, Probe `openssl version`),
                                //   C:\Program Files\Git\mingw64\bin\openssl.exe, C:\Program Files\Git\usr\bin\openssl.exe
export async function startKubeFake({ port = 9334, dir });
// → { port, kubeconfig: string, close(): Promise<void> }; wirft Error('openssl nicht gefunden …') bzw. Error('openssl fehlgeschlagen: …')
```
- **Zertifikat:** `execFileSync(openssl, ['req','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:prime256v1','-nodes','-subj','/CN=k8s-cp1','-addext','subjectAltName=DNS:k8s-cp1','-days','2','-keyout',<dir>\key.pem,'-out',<dir>\cert.pem], { stdio: 'pipe', env: { ...process.env, MSYS2_ARG_CONV_EXCL: '*', MSYS_NO_PATHCONV: '1' } })`. Nie über eine Shell, `dir` wird vorher mit `mkdirSync({recursive:true})` angelegt.
- **kubeconfig:** Inhalt wie Spec 2.3, aber `certificate-authority-data: <base64 von cert.pem>` statt `insecure-skip-tls-verify`, Token `synthetic-kube-token`, Kontext `prod` mit Namespace `shop`.
- **Antwortkopf:** Jede Antwort hat `content-type: application/json` und einen JSON-Body.
- **Routen:** Die Routen arbeiten auf `pathname` und `searchParams`. Pfade kommen kleingeschrieben an.

| Anfrage | Antwort |
|---|---|
| ohne `authorization: Bearer synthetic-kube-token` | 401 `{"kind":"Status","apiVersion":"v1","status":"Failure","reason":"Unauthorized","code":401}` |
| Methode ≠ GET | 403 `{"kind":"Status","apiVersion":"v1","status":"Failure","reason":"Forbidden","code":403,"message":"<verb> is forbidden: User \"admin\" cannot <verb> resource \"<resource>\" in API group \"\" in the namespace \"<ns>\""}` (Anzeige in der App: nur „Forbidden“, weil `KubernetesObjectApi` den Body als String liefert; reicht) |
| `GET /api/v1` | `{"kind":"APIResourceList","apiVersion":"v1","groupVersion":"v1","resources":[…]}` mit `pods/Pod/true`, `services/Service/true`, `nodes/Node/false`, `events/Event/true`, `namespaces/Namespace/false`; jedes mit `name`, `singularName`, `namespaced`, `kind`, `verbs:["get","list","watch"]` |
| `GET /apis/apps/v1`, `/apis/batch/v1`, `/apis/networking.k8s.io/v1` | dito: `deployments/Deployment`, `statefulsets/StatefulSet`, `daemonsets/DaemonSet` · `jobs/Job`, `cronjobs/CronJob` · `ingresses/Ingress` (alle namespaced) |
| `GET /api/v1/<res>` bzw. `/api/v1/namespaces/<ns>/<res>` (dito `/apis/<g>/<v>/…`), ohne `watch` | `{"kind":"<Kind>List","apiVersion":"<g/v>","metadata":{"resourceVersion":"1"},"items":[…]}`; mit Namespace nur Items dieses Namespace; `labelSelector` (`k=v,…`) und `fieldSelector` (`pfad.mit.punkten=wert,…`, z. B. `spec.nodeName=…`, `involvedObject.name=…`) als UND aller Terme auf dem Item |
| dito mit `watch=true` | `writeHead(200, {'content-type':'application/json'})` + `flushHeaders()` sofort; optional eine Zeile `{"type":"BOOKMARK","object":{"kind":"<Kind>","apiVersion":"<g/v>","metadata":{"resourceVersion":"1"}}}\n`; offen halten; nach `min(timeoutSeconds, 300)` s `end()`; Timer bei `close` der Anfrage löschen |
| `GET …/<res>/<name>` | das Item plus `apiVersion` und `kind`; fehlt es: 404 `Status` |
| `GET /api/v1/namespaces/<ns>/pods/<name>/log` | `content-type: text/plain`, 15 Logzeilen; bei `follow=true` danach offen halten (wie Watch) |
| `GET /apis/metrics.k8s.io/v1beta1/nodes` | `{"kind":"NodeMetricsList","apiVersion":"metrics.k8s.io/v1beta1","items":[{"metadata":{"name":"k8s-cp1"},"usage":{"cpu":"420m","memory":"2831Mi"}},…]}` (3 Nodes) |
| `GET /apis/metrics.k8s.io/v1beta1/pods` bzw. `/namespaces/<ns>/pods` | `{"kind":"PodMetricsList",…,"items":[{"metadata":{"name":…,"namespace":…},"containers":[{"name":…,"usage":{"cpu":"35m","memory":"120Mi"}}]}]}` nur laufende Pods |
| sonst | 404 `{"kind":"Status","apiVersion":"v1","status":"Failure","reason":"NotFound","code":404}` |

**Fixture-Regeln (zusätzlich zu Spec 2.3):**
- **Pod-Grundfelder:** Jeder Pod hat `spec.nodeName`, `spec.containers[{name,image}]`, `status.phase` und `status.containerStatuses[{name, ready: bool, restartCount: number, state:{running|waiting|terminated:{…}}}]`.
- **Deployment-Pods:** Sie tragen das Label `pod-template-hash: <hash>` und `ownerReferences:[{kind:'ReplicaSet', name:'<deploy>-<hash>', controller:true, apiVersion:'apps/v1', uid}]` (`rows.ts:31-45`).
- **Problem-Pods:**
  - `checkout`: `state.waiting.reason: 'CrashLoopBackOff'`, `restartCount: 14`.
  - `report`: `phase: 'Pending'`, `creationTimestamp` = now − 20 min.
- **Nodes:**
  - Jeder Node hat `status.allocatable {cpu:'4', memory:'16Gi'}`, `status.addresses [{type:'InternalIP', address:'10.0.0.x'}]` und `status.conditions [{type:'Ready', status:'True'|'False'}]`.
  - `k8s-cp1` trägt das Label `node-role.kubernetes.io/control-plane: ''`.
  - `k8s-w2` ist `Ready=False`.
- **Typen:** Zahlen bleiben Zahlen, Zeiten sind ISO-Strings.

**V4 – `ai-fake.mjs` (Task 1C)**
```js
export const AI_KEY = 'sk-synthetic-demo';
export async function startAiFake({ port = 9335 } = {}); // → { port, close(): Promise<void> }
```
- **Weg:** Nur `POST /v1/chat/completions`. Andere Pfade oder Methoden ergeben 404 `{"error":{"message":"not found"}}`.
- **Schlüssel:** Stimmt `authorization` nicht exakt mit `Bearer sk-synthetic-demo` überein, kommt 401 `{"error":{"message":"Incorrect API key provided"}}`.
- **Antwort:** Body als JSON lesen, letzte Nachricht mit `role === 'user'` nehmen. Ist ihr Inhalt getrimmt `Verbindungstest` oder `Connection test`, ist die Antwort `OK` (E6), sonst die Antwort aus X1.
- **Stream:**
  - Kopf: `200`, `content-type: text/event-stream`, `cache-control: no-cache`.
  - Je Delta eine Zeile `data: {"id":"chatcmpl-demo","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"…"}}]}\n\n`.
  - Ende: `data: [DONE]\n\n`, dann `end()`.
  - Bricht der Client ab (`close`), Timer löschen.
- **Kein CORS-Header.**

**V5 – `demo-setup.mjs` (Task 1D)**
- **Formular-Helfer:** `addSsh` wird zu `addConnection(menuLabel, name, port, password)`, `addSsh = (…) => addConnection('SSH', …)`, `addSftp = (…) => addConnection('SFTP (Dateien)', …)`. Der Rumpf ist unverändert.
- **Reihenfolge im „neu“-Zweig** (siehe K7):
  1. `addSsh('web-01', 2222, 'synthetic-demo')`
  2. `addSftp('files-01', 2222, 'synthetic-demo')`
  3. `addCluster()`
  4. `addSsh('db-main', …)`
  5. `addSsh('legacy-app', …)`
  6. Ordner `Staging` wie bisher
  7. `addAiProvider()`
  8. Editor schließen wie bisher
- **`addCluster()`:**
  1. Sicherstellen, dass nichts offen ist: „Alle Verbindungen“ anklicken wie in `addSsh`.
  2. `call('rclick', 'text=web-01 >> nth=0')`, dann `menuItem('Als Kubernetes-Cluster einrichten')`.
  3. Bis 20 s (alle 250 ms) auf `!!document.querySelector('input[id$="-context"]')` warten. Kommt es nicht, `console.log('Cluster übersprungen (Testserver ohne Kubernetes).')`, Escape drücken, `return`.
  4. Sonst `fill('input[id$="-name"]', 'prod-k8s')` und `click('button:has-text("Verbindung speichern")')`, dann `pause(800)`.
  5. Produktion bleibt an (Vorgabe), Nur-Lesen aus, Namespace aus der kubeconfig.
- **`addAiProvider()`:**
  1. `click('.settings-button')`.
  2. Auf `dialog.settings-dialog[open]` warten, dann `click('dialog.settings-dialog button:has-text("Anbieter verwalten")')`.
  3. Auf `dialog.ai-settings-dialog[open]` warten.
  4. Schritte aus X2.
  5. Auf `.ai-provider-list li` warten, dann „Fertig“.
- **Abschlussmeldung:** `Demo-Vault angelegt: web-01, files-01, prod-k8s, db-main, legacy-app, Ordner Staging, KI-Anbieter Demo-KI.` (`prod-k8s` nur, wenn angelegt).
- **Warten:** Ein lokaler Helfer `waitFor(expression, timeout)` per `/eval`-Polling ersetzt dort, wo gewartet wird, das blinde `pause`. Die bestehenden `pause`-Aufrufe bleiben.

**V6 – `screens.mjs` (Task 2A)**
```text
node .claude/skills/run-app/screens.mjs [sftp|containers|kubernetes|settings|assistant …]   // ohne Argument alle; `settings` erzeugt settings.png und ai-settings.png
```
- **Vorbedingung:** `.workspace-save` sichtbar. Sonst Abbruch mit `Vault nicht offen – zuerst demo-setup.mjs ausführen.` und Exit 2.
- **Helfer:** `call`, `waitFor(step, expression, {timeout=20000, every=250})`, `shot(name)` = `GET /ss?name=<name>&crop=status`, `closeTabs()`. `closeTabs` geht so: solange `.terminal-tab-close` existiert, den ersten anklicken. Erscheint `dialog.compact-confirm[open]`, dessen `.primary-button, .danger-button` anklicken. Am Ende auf 0 Tabs warten, Timeout 10 s.
- **Blöcke:** Vor jedem Block steht `closeTabs()`. Fehler werden je Block gemeldet (`✗ <block>: <step>`), Exit 1, wenn einer fehlte.

| Block | Schritte | Warten vor `shot` |
|---|---|---|
| `sftp` | `<RUN_DIR>\local` anlegen (`readme.txt`, `deploy.sh`, `notes.md`, je ein paar Zeilen); `click('text=files-01 >> nth=0')`, `key Enter`; warten auf Remote-Liste; lokale Spalte (Ziel nach X4): `/eval` `document.querySelector('.file-pane-local nav[aria-label="Pfad"]').dispatchEvent(new MouseEvent('dblclick', {bubbles:true}))` (kein `/dblclick`, das träfe einen Segment-Knopf), `fill('.file-pane-local input[aria-label="Pfad"]', ziel)`, `key Enter` | `.file-pane-remote [role=row][data-name]` ≥ 5 und `.file-pane-remote nav[aria-label="Pfad"]` enthält `demo` und `.file-pane-local nav[aria-label="Pfad"]` enthält das letzte Segment des Ziels (bzw. Wurzel) → `sftp` |
| `containers` | `rclick('text=web-01 >> nth=0')`, `menuItem('Container-Ansicht öffnen')` | `.kube-table tbody tr` ≥ 6 → `containers` |
| `kubernetes` | prüfen, ob `prod-k8s` im Baum ist, sonst Block mit Hinweis überspringen (kein Fehler); `click('text=prod-k8s >> nth=0')`, `key Enter` | `document.body.innerText.includes('bereit über web-01')` und `.kube-table tbody tr` ≥ 5, dann 1500 ms für die erste Metrik-Runde → `kubernetes` |
| `settings` | `click('.settings-button')`; Bild; `click('dialog.settings-dialog button:has-text("Anbieter verwalten")')`; Bild; „Fertig“ | `dialog.settings-dialog[open]` → `settings`; `.ai-provider-list li` ≥ 1 → `ai-settings` |
| `assistant` | `click('text=web-01 >> nth=0')`, `key Enter`; warten auf `.xterm`; `click('.xterm-helper-textarea >> nth=0')`, `type('df -h /')`, `key Enter`; `click('.assistant-toggle')`; `fill('.assistant-input textarea', 'Ist die Platte zu voll?')`; `click('.assistant-input button[type=submit]')` | `!document.querySelector('.assistant-typing')` und `[...document.querySelectorAll('.assistant-message.is-assistant .assistant-command code')].some(c => c.textContent.includes('du -xh'))` → `assistant` |

Am Ende gibt es eine Zeile je Bild mit Pfad. Der Umsetzer prüft jeden Selektor im Code, bevor er ihn nutzt. Weicht ein Selektor ab, gilt der Code, und die Abweichung kommt in den Abschlussbericht.

**V7 – `fakes.test.mjs` und `vitest.config.ts` (Task 1E)**

`vitest.config.ts`, genau diese Zeile ersetzt die `include`-Zeile:
```ts
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs', '.claude/skills/run-app/*.test.mjs'],
```

**Testdatei:** `describe.runIf(process.platform === 'win32')`, Timeout 20 s je Test. Alles läuft auf Port 0 mit `mkdtempSync(join(tmpdir(), 'shellherd-fakes-'))` als `dir`. `afterAll` schließt alles und löscht den Ordner. Importe aus der App: `openRemoteHost` (`src/main/containers/runner.ts`), `PROBE_COMMAND` (`commands.ts`), `parseProbe` (`parsers.ts`), `inventoryBatchCommand`/`splitInventoryBatch`/`BATCH_OUTPUT_LIMIT` (`inventory-batch.ts`), `parseContainerRows` (`inventory-parsers.ts`), `createSudoMarker` (`sudo.ts`), `SudoRejections` (`sudo-rejections.ts`), `readKubeconfig` (`kubernetes/access.ts`), `parseKubeconfig` (`kubeconfig.ts`), `openTunnel` (`tunnel.ts`), `createKubeApi` (`client-api.ts`), `streamChat` (`ai/providers.ts`).

Verbindung: `{ id:'t', type:'connection', name:'web-01', tags:[], protocol:'ssh', host:'127.0.0.1', port, username:'demo', authentication:{ method:'password', password:'synthetic-demo' } }` und `verifyHost = async () => true`.

1. **Container:**
   - `parseProbe((await host.run(PROBE_COMMAND, 10000)).stdout).has('docker')`.
   - Batch mit `{kind:'none'}`, `splitInventoryBatch` ergibt vier Kinds mit `code === 0`, `parseContainerRows('docker', r.containers.stdout).length === 6`.
   - `host.run('rm -rf /', 5000)` gibt `code 127`.
2. **Kubernetes** (`it.skipIf(!findOpenssl())`):
   - `startKubeFake`, dann `startSshd({ kubeconfig, kubePort })`.
   - `readKubeconfig(host, conn, {source:'auto'}, new SudoRejections())` liefert `source === '/home/demo/.kube/config'`.
   - `parseKubeconfig(text).server` ist `{host:'k8s-cp1', port:6443}`.
   - Über `openTunnel((h,p) => host.forward(h,p), server)`: `createKubeApi(parsed.build(tunnel.port))`, `list('nodes', null)` hat 3 Items, alle mit `metadata.uid`. `list('pods','shop')` hat ≥ 5 Items. `nodeMetrics()` hat 3 Samples, `podMetrics('shop')` ist nicht `null`.
   - `watch('pods','shop',undefined,'1',…)` resolved binnen 3 s, danach `stop()`.
   - **Sicherheit:** `host.forward('k8s-cp1', 22)` und `host.forward('127.0.0.1', 6443)` werden abgelehnt.
   - Ohne Kubernetes (zweiter `startSshd` ohne `kubeconfig`): `readKubeconfig` wirft `code === 'kubernetes.kubeconfigNotFound'`.
3. **KI:**
   - `streamChat({ id:'t', name:'t', kind:'openai', model:'gpt-4o-mini', baseUrl:`http://127.0.0.1:${port}/v1`, apiKey:'sk-synthetic-demo' }, { system:'s', messages:[{ role:'user', content:'Ist die Platte zu voll?' }] }, text => out += text, new AbortController().signal)` liefert einen Text, der `<command>du -xh` enthält.
   - Mit `content:'Verbindungstest'` ist der Text `OK`.
   - Mit falschem Schlüssel wirft der Aufruf `code === 'ai.keyRejected'`.
4. **SFTP:** `seedSftp(dir/sftp)` erzeugt `home/demo/notes.md`. Ein SFTP-`readdir('/home/demo')` über `ssh2.Client` liefert ≥ 5 Einträge. `stat('/../../x')` endet nicht außerhalb der Wurzel (`NO_SUCH_FILE`). `stat('/home/..\\..\\..\\x')` wird abgelehnt (K3).

---

## Korrekturen

**K1 – Exec-Weiche (`sshd.mjs`).**
- **Prüfreihenfolge:** (1) `command.includes('for c in docker podman pct qm')` → stdout `has:docker\n`, Exit 0. (2) Marker `/\[terminus-list-[0-9a-f]{16}\]/` → Batch nach dem bestätigten Format, Listen aus V1 als JSON-Zeilen, Exit 0. (3) `/docker container inspect ([A-Za-z0-9_.-]+)\s*$/` → `JSON.stringify(inspect(ref), null, 2)`, Exit 0; unbekannt → stderr `Error: No such container: <ref>\n`, Exit 1. (4) `command.includes('KUBECONFIG%%')` → `src:/home/demo/.kube/config\n` + kubeconfig (E2 ohne), Exit 0. (5) sonst stderr `sh: 1: <erstes Wort>: not found\n`, Exit 127.
- **Abschluss:** immer `stream.exit(code)`, dann `stream.end()`, und zwar nach dem Schreiben von stdout (`stream.write`) und stderr (`stream.stderr.write`).
- **Sicherheit:** Kein Teil des Befehls wird ausgeführt oder in einen Pfad übernommen.

**K2 – `tcpip` (`sshd.mjs`).**
```js
client.on('tcpip', (accept, reject, info) => {
  if (!kubePort || info.destIP !== 'k8s-cp1' || info.destPort !== 6443) return reject();
  const socket = net.connect(kubePort, '127.0.0.1');
  socket.once('error', () => reject());
  socket.once('connect', () => { const channel = accept(); socket.removeAllListeners('error');
    socket.on('error', () => channel.destroy()); channel.on('error', () => socket.destroy());
    channel.pipe(socket).pipe(channel); channel.on('close', () => socket.destroy()); socket.on('close', () => channel.destroy()); });
});
```
Den Listener am `client` in der Verbindungs-Callback registrieren, nicht erst in `ready`. Kein `client.on('request')`.

**K3 – SFTP-Handler (`sshd.mjs`).**
- **Grundlage:** Er wird aus `sftp-loopback.test.ts:17-55` übernommen, mit diesen Abweichungen.
- **`local(p)`:**
  - Pfade mit `\` oder `:` lösen `NO_SUCH_FILE` aus (unter Windows würde `join` Backslashes als Trenner lesen und die Wurzel verlassen).
  - Danach `const full = path.join(root, path.posix.normalize('/' + p))`, und `full === root || full.startsWith(root + path.sep)` ist Pflicht, sonst ebenfalls `NO_SUCH_FILE`.
  - Die Prüfung steckt in `guard`, also wird jeder Fehler zum Status, nicht zum Absturz.
- **`REALPATH`:** `'.'` und `''` werden zu `/home/demo`, sonst gilt `posix.normalize('/' + p)` (doppelte führende `/` auf einen kürzen).
- **`attrs`:** `mode: (info.mode & 0o170000) | (info.isDirectory() ? 0o755 : 0o644)`.
- **`READDIR`:** Bei einem fehlenden Handle kommt `FAILURE`-Status statt `!`-Zugriff.
- **Keine Symlinks** (E4).

**K4 – Kubernetes-Fake-Details.**
- **Watch-Antworten:** Sie halten `res` in einem `Set`, `close()` beendet sie.
- **Lebenszeit:** `server.keepAliveTimeout` bleibt Standard, `server.requestTimeout = 0`, damit Watches nicht nach 300 s Node-intern abbrechen.
- **Namespaces:** `/api/v1/namespaces` liefert `NamespaceList` aus `namespaces`, `GET /api/v1/namespaces/<ns>` das Objekt. Unterpfade unter `/api/v1/namespaces/<ns>/<res>` gehen vor.
- **Pfadschema:** `^/(api/v1|apis/[^/]+/[^/]+)(?:/namespaces/([^/]+))?/([^/]+)(?:/([^/]+))?(?:/(log))?$`. Ressourcen ohne `namespaced` ignorieren den Namespace-Teil nicht, sie kommen dort aber nicht vor.
- **Groß-/Kleinschreibung:** Der Fake vergleicht kleingeschrieben.

**K5 – openssl.** Nur `execFileSync` mit Argument-Array und ohne `shell`. Die Umgebung bekommt `MSYS2_ARG_CONV_EXCL: '*'` und `MSYS_NO_PATHCONV: '1'` (wirkungslos bei nativem openssl, schützt bei MSYS-Ketten). `findOpenssl` probt `<kandidat> version` mit `stdio:'pipe'` und Timeout 5 s. Ohne openssl läuft alles außer Kubernetes (Ruling 1). Der Selbsttest überspringt den Teil (V7.2). Auf `windows-latest` liegt Git for Windows samt `mingw64\bin\openssl.exe` bei. Falls nicht, wird übersprungen, nicht rot.

**K6 – Modulvertrag aus Spec 4 ersetzt.**
- `startSshd` bekommt `dir`, `sftpRoot` hat eine Vorgabe.
- `startKubeFake` gibt `kubeconfig` zurück (E1), `KUBECONFIG` entfällt.
- `fixtures.mjs` exportiert `inspect(ref)` statt `INSPECT`.
- `findOpenssl`, `KUBE_TOKEN`, `KUBE_SERVER` und `AI_KEY` kommen dazu.
- Es gilt allein V1–V7.

**K7 – Reihenfolge im Demo-Vault.** Den Cluster vor `db-main`/`legacy-app` anlegen. `suggestAccessHosts` nimmt alle aktiven SSH-Verbindungen mit gleichem Host-Muster (`cluster-form.ts:22-34`; `127.0.0.1` ergibt Präfix `127.0.0.`, Nummer 1). Später angelegt, ständen `db-main` (falsches Passwort) und `legacy-app` (Port 1) als Ausweich-Zugangshosts im Cluster.

**K8 – Szenario-Selektoren.** Die Spalte „Schritte“ in Spec 3 ist durch V6 ersetzt, insbesondere:
- Pfadfeld per `dispatchEvent` statt `/dblclick`
- KI-Dialog über „Fertig“ statt Escape ×2
- Assistent-Prüfung auf `.assistant-command code`

**K9 – Hauptblock-Weiche.** `pathToFileURL(process.argv[1])` wirft, wenn `argv[1]` fehlt. Die Form aus der Vertragseinleitung ist Pflicht für `sshd.mjs`, `kube-fake.mjs` und `ai-fake.mjs`. `kube-fake.mjs`/`ai-fake.mjs` allein gestartet nutzen `RUN_DIR/kube` bzw. Port 9335 und geben `… ready on <port>` aus.

**K10 – Bestandsverhalten der Shell bleibt bitgleich.** Die vier `outputs`, `exit` und `sudo reboot` bleiben unverändert. `SKILL.md` und `README` verweisen darauf.

**K11 – README (Task 2C), drei Stellen:**
- Zeile 90: `| \`npm run drive:sshd\` | Local SSH/SFTP test server plus Kubernetes API and AI fakes, all synthetic, for \`drive\` |`.
- Zeile 94: Halbsatz nach „a local SSH test server“: `, plus local fakes for SFTP, Docker, Kubernetes and the AI assistant`.
- Zeile 100: Kommentar `# demo vault with web-01, files-01, prod-k8s, Demo-KI, …`.

Sonst ändert sich in der README nichts.

**K12 – SKILL.md (Task 2B), Pflichtinhalte:**
- **Ports:** Tabelle der Gegenstellen 9333/2222/9334/9335 mit Datei und „nur 127.0.0.1“.
- **Ablauf:** Er bekommt die Zeile `node .claude/skills/run-app/screens.mjs` mit den Blocknamen und den sechs Dateinamen.
- **Demo-Vault-Tabelle:** dazu kommen `files-01`, `prod-k8s` (Produktion an, Zugang über web-01) und `Demo-KI` (OpenAI-kompatibel, `http://127.0.0.1:9335/v1`).
- **Exec-Befehle:** Liste der beantworteten Befehle (K1) mit dem Satz „alles andere: Exit 127, nichts wird ausgeführt“.
- **Stolpersteine:**
  - Neue Einträge: `profile\demo.term` löschen und `demo-setup.mjs` neu laufen lassen.
  - Host-Schlüssel steht in `shellherd-run\sshd-host-key`. Wer ihn löscht, muss auch `profile\known-hosts.json` löschen.
  - openssl fehlt: Kubernetes wird übersprungen, gesucht wird in (Liste aus V3).
  - „Dieser Computer“ erscheint in der Seitenleiste, wenn Docker lokal installiert ist.
  - Lokale Spalte und Benutzername (X4).
- **Letzte Zeile:** Sie wird zu „RDP und lokale Container brauchen echte Gegenstellen und sind mit dem Testserver nicht abgedeckt.“
- **Kopf:** Die `description` im Frontmatter nennt SFTP, Container, Kubernetes und KI.

**K13 – Welle-1-Gate.** Umsetzer der Welle 1 prüfen nur ihre Datei: `node --check <datei>`, Fakes mit kurzem Start/`curl`. `fakes.test.mjs` muss erst am Ende von Welle 1 grün sein, wenn 1A–1C vorliegen. Danach muss `npx vitest run` mit 121 Dateien grün sein (Baseline 120 plus `fakes.test.mjs`).

**K14 – Spec-Zeilenverweise.** `kubeconfig.ts:162,163,168,176` aus Spec 2.3 ist `kubeconfig.ts:44,45,50,58`. Der Rest der Verweise wurde stichprobenartig geprüft und stimmt. Das hat keine Auswirkung auf die Umsetzung.

---

## Sicherheit (geprüft, bindend)

- **Netz:** Alle vier Dienste binden `127.0.0.1`. `tcpip` nur nach `k8s-cp1:6443`, kein `tcpip-forward`, kein `streamlocal`.
- **Treiber-Token:** unverändert. `screens.mjs` liest `<RUN_DIR>/token` wie `demo-setup.mjs:13`.
- **Fakes:** Sie setzen keine CORS-Header. Der KI-Fake verlangt den Bearer-Schlüssel, der Kubernetes-Fake das Token (E3).
- **Exec:** Die Exec-Weiche führt nie etwas aus.
- **SFTP:** schreibt nur unter `sftpRoot` (K3).
- **Kubernetes:** Er beantwortet jede Nicht-GET-Anfrage mit 403.
- **Schlüssel und Zertifikat:** Host-Schlüssel, Zertifikat und privater Schlüssel liegen nur im Run-Ordner und nie im Repo. Kein Testcode schreibt sie ins Repo.
- **Zugangsdaten:** Es gibt nur synthetische: `synthetic-demo`, `synthetic-vault-demo`, `synthetic-kube-token`, `sk-synthetic-demo`.
- **Bilder:** Die Screenshots zeigen keinen Benutzernamen (X4, `crop=status`).

---

## Wellen und Tasks (endgültig)

Die Dateien sind je Task disjunkt. Kein Task ändert `src/`, `package.json`, CHANGELOG oder Handbuch. Gate nach jeder Welle: `npm run typecheck` und `npx vitest run` grün. Umsetzer committen nicht.

**Welle 1 (parallel, 5 Tasks)**

| Task | Dateien (nur diese) | Inhalt |
|---|---|---|
| 1A SSH-Testserver | `.claude/skills/run-app/sshd.mjs`, `.claude/skills/run-app/fixtures.mjs` | V1, V2, X5, K1, K2, K3, K9, K10 |
| 1B Kubernetes-Fake | `.claude/skills/run-app/kube-fake.mjs`, `.claude/skills/run-app/kube-fixtures.mjs` | V3, X3, E1, E3, K4, K5, K9 |
| 1C KI-Fake | `.claude/skills/run-app/ai-fake.mjs` | V4, X1, E6, K9 |
| 1D Demo-Vault | `.claude/skills/run-app/demo-setup.mjs` | V5, X2, K7 |
| 1E Selbsttest | `.claude/skills/run-app/fakes.test.mjs`, `vitest.config.ts` (nur die `include`-Zeile) | V7 |

**Welle 2 (parallel, 3 Tasks)**

| Task | Dateien (nur diese) | Inhalt |
|---|---|---|
| 2A Szenario | `.claude/skills/run-app/screens.mjs` | V6, X4, K8, E5 |
| 2B Doku | `.claude/skills/run-app/SKILL.md` | K12 |
| 2C README | `README.md` | K11 |

**Welle 3 (1 Task): Gesamtlauf**
1. `npx electron-vite build`.
2. `profile\demo.term` und `profile\known-hosts.json` im Run-Ordner löschen.
3. `npm run drive:sshd` starten, Ausgabe: drei „ready“-Zeilen.
4. `npm run drive` starten.
5. `demo-setup.mjs` ausführen, Meldung inkl. `prod-k8s` und `Demo-KI`.
6. `screens.mjs` ausführen: sechs PNGs, jedes mit Read ansehen.
7. Gate.

Den Testserver nach einer Korrektur neu zu starten ist erlaubt (X5). Korrekturen gehen nur in die Datei des Fehlers.

**Abnahme der Bilder** (Prüfer, Stufe 6):

| Bild | Pflichtinhalt |
|---|---|
| `sftp.png` | Remote `/home/demo` mit ≥ 5 Einträgen, lokale Spalte ohne Benutzernamen |
| `containers.png` | 6 Container mit Projekt `shop` und Tönen ok/muted/bad |
| `kubernetes.png` | „bereit über web-01“, Node-Kacheln mit CPU/RAM, Problembanner (k8s-w2, checkout, report), roter Produktionsrahmen |
| `settings.png` | drei Abschnitte, KI-Zeile mit Demo-KI |
| `ai-settings.png` | Liste mit Demo-KI · OpenAI-kompatibel · gpt-4o-mini · Standard |
| `assistant.png` | Antwort mit Befehlsblock und Knopf „Eintippen“ |
