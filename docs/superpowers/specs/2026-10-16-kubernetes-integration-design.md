# Kubernetes-Integration – Design (Stufe 1: Fundament)

Stand: 2026-10-16 · Stufe 1 von 3 · Vorbilder: k9s (Bedienung), Lens/Headlamp (Grafik). Wir übernehmen nur Ideen, keinen Code.

## Ziel

Der On-Prem-Cluster **k8s** (Control Planes `k8s-cp1` bis `cp3`, Worker `worker1` bis `worker3`) soll in Terminus so bedienbar sein,
dass man für den Alltag nicht mehr per SSH auf cp1 und dort zu `kubectl` greifen muss.
Terminus bekommt dafür einen eigenen **Cluster-Tab**. Er verbindet eine tastaturgesteuerte Tabelle im k9s-Stil
mit grafischen Elementen (Node-Streifen, Problem-Hinweis, Sparklines) und einem angedockten Terminal.

Headlamp ist bereits im Einsatz. Terminus soll **kein zweites Headlamp** werden. Der Mehrwert liegt woanders:

- Es ist dieselbe App, in der ohnehin per SSH gearbeitet wird. Man braucht keinen Browser und kein zusätzliches Login.
- Echte Terminals (Logs, Shell) stehen direkt neben der Tabelle.
- Später kommen KI-Diagnose, Argo-CD- und Harbor-Bezug hinzu (Stufe 2 und 3).

**Erfolgskriterien**

- Ein Cluster lässt sich aus einer bestehenden SSH-Verbindung zu cp1 einrichten. Weitere Daten braucht es nicht, es wird kein Secret gespeichert.
- Der Cluster-Tab zeigt Nodes, Workloads, Pods und Events **live**, ohne manuelles Neuladen.
- Ein crashender Pod ist im Problem-Hinweis sichtbar, ohne dass man ihn suchen muss.
- Logs, Logs des vorherigen Containers und eine Shell in einem Pod sind mit einer Taste erreichbar.
- Restart, Scale und Pod löschen funktionieren und fragen **immer** nach. Bei Produktion muss man den Namen eintippen.
- Fällt cp1 aus, verbindet Terminus über cp2 bzw. cp3.
- Alle Hotkeys und Befehle stehen in einer Hilfe-Übersicht (`?`).

## Gesamtbild: drei Stufen

Jede Stufe bekommt ihre eigene Spec, ihren eigenen Plan und ihre eigene Umsetzung. Diese Spec deckt **nur Stufe 1** ab.

| Stufe | Inhalt |
|---|---|
| **1 Fundament** (diese Spec) | Cluster-Eintrag, Zugang über SSH-Tunnel, Cluster-Tab mit Live-Tabelle, Node-Streifen, Problem-Hinweis, Logs/Shell/Events/YAML/Describe, Restart/Scale/Löschen, Hilfe-Übersicht |
| 2 Diagnose | Argo-CD-Status und Self-Heal-Warnung, KI-Diagnose „Warum crasht das?“, ConfigMaps/Secrets, Logs ganzer Workloads, RBAC-Vorabprüfung |
| 3 Power | Port-Forwards, YAML bearbeiten mit Diff, Harbor-CVEs am Pod, Dateien kopieren, Node-Debug, cordon/drain, Direktzugriff ohne SSH |

## Abgrenzung (nicht in Stufe 1)

- Alles aus Stufe 2 und 3
- Bearbeiten von Ressourcen (YAML ist nur lesbar), Anlegen von Ressourcen, Helm
- Secrets-Reiter
- Lokale kubeconfig (`~/.kube/config` auf diesem Rechner) und direkter Zugriff auf den API-Server ohne SSH
- Unterbaum mit Pods im Vault-Baum. Diese Aufgabe übernimmt der Cluster-Tab.
- Die Container-Integration (Docker, Podman, Proxmox) bleibt unverändert.

## Grundprinzip: API über einen SSH-Tunnel, Zugangsdaten live von cp1

Heute läuft der Zugriff per SSH auf cp1, dort mit `kubectl`. Terminus nutzt genau diesen Weg, aber ohne kubectl-Textausgabe:

1. Terminus verbindet sich per SSH zum ersten erreichbaren **Zugangs-Host** (cp1 → cp2 → cp3).
2. Dort liest es die kubeconfig (siehe *Kubeconfig-Quelle*).
3. Ein lokaler Listener auf `127.0.0.1:<zufällig>` leitet jede Verbindung per ssh2 `forwardOut` an den API-Server weiter,
   und zwar an die Adresse, die in der kubeconfig steht und die von cp1 aus aufgelöst wird.
4. Die kubeconfig wird **nur im Speicher** umgeschrieben: `server` zeigt auf `https://127.0.0.1:<port>`,
   `tls-server-name` bekommt den Original-Host, damit die Zertifikatsprüfung weiter greift.
5. `@kubernetes/client-node` spricht mit dieser kubeconfig direkt mit der API: Watches, Logs, Exec und Metrics.

Dabei kommt kein neues Secret auf den Rechner. Wer SSH auf cp1 hat, hat diesen Zugriff heute schon.
Die Zugangsdaten bleiben im Speicher des Main-Prozesses und werden beim Schließen der Session verworfen.

**Risiko TLS über den Tunnel.** Ob `client-node` `tls-server-name` über den Tunnel so beachtet, dass Hostname-Prüfung und Zertifikat zusammenpassen,
klärt ein **Spike als erste Aufgabe** des Plans. `@kubernetes/client-node` 2.0 reicht `tlsServerName` an HTTPS und WebSocket weiter. Fallback, falls der Original-Host nicht im Zertifikat steht:
`tls-server-name: kubernetes`, denn diesen Namen nimmt kubeadm immer in die SANs des API-Server-Zertifikats auf. Der Spike arbeitet nur lesend
(`list nodes`, ein Watch) und startet erst nach ausdrücklicher Freigabe. Sein Code wird verworfen.

## Vault-Modell

Neue Verbindungsart (`type: 'connection'`, `protocol: 'kubernetes'`) neben den bestehenden Verbindungen (`src/shared/vault/types.ts`, zod in `schema.ts`):

```ts
export interface KubernetesConnectionNode extends ConnectionBase {
  protocol: 'kubernetes';
  /** Ordered SSH connection ids; the first reachable one carries the tunnel. */
  accessHosts: string[];
  kubeconfig: { source: 'auto' } | { source: 'path'; path: string };
  /** Context name inside the kubeconfig; default is current-context. */
  context?: string;
  /** Namespace the tab opens with; default is "default". */
  namespace?: string;
  production: boolean;
  readOnly: boolean;
}
```

- Er erbt Name, Kommentar, Tags, Farbe, Icon und `disabled` wie jede Verbindung.
- Es ist eine neue Verbindungsart, deshalb ist **keine Migration** nötig. Bestehende Vaults bleiben gültig.
- `accessHosts` enthält mindestens einen Eintrag. Verweist eine ID auf eine gelöschte oder deaktivierte SSH-Verbindung,
  wird sie übersprungen und am Cluster-Eintrag erscheint ein Hinweis. Sind alle ungültig, öffnet der Tab mit einer Fehlermeldung.
- Die Schalter `production` und `readOnly` sind unabhängig voneinander.

**Kubeconfig-Quelle `auto`.** Die Quellen werden der Reihe nach auf dem Zugangs-Host geprüft. Die erste vorhandene gewinnt:

1. `$KUBECONFIG` der Login-Shell (nur die erste Datei der Liste)
2. `~/.kube/config`
3. `/etc/kubernetes/admin.conf` per sudo. Das läuft über den bestehenden sudo-Weg der Container
   (`SudoRejections`-Gate, gemerkte abgelehnte Passwörter) mit der Anmeldung der SSH-Verbindung, unabhängig vom Container-Schalter „mit sudo“:
   gespeichertes Passwort beantwortet die sudo-Abfrage, sonst `sudo -n`.

Kubeconfigs mit `exec`- oder `auth-provider`-Abschnitten lehnt Stufe 1 mit einer Meldung ab.
Diese Plugins würden auf diesem Rechner statt auf cp1 laufen.

## Einrichtung

- Das Kontextmenü einer SSH-Verbindung bekommt den Eintrag **„Als Kubernetes-Cluster einrichten…“**.
- Eine Probe auf dem Host prüft, ob eine kubeconfig nach der obigen Reihenfolge vorhanden ist, und liest die Contexts.
  Ohne kubeconfig erscheint eine Meldung mit den geprüften Pfaden.
- Ein Formular schlägt vor:
  - als Name den Cluster-Namen aus der kubeconfig,
  - als Zugangs-Hosts diese SSH-Verbindung, dazu weitere Vault-Verbindungen, deren Host im selben Namensmuster liegt (z. B. `k8s-cp2`, `k8s-cp3`), jeweils zum Abhaken,
  - als Context den `current-context`.
- „Produktion“ ist im Formular **vorausgewählt**. Abwählen ist eine bewusste Entscheidung.
- Ein Cluster lässt sich auch leer über „Neue Verbindung → Kubernetes-Cluster“ anlegen.

## Bedienung

### Vault-Baum

- Der Cluster ist ein eigener Eintrag mit Kubernetes-Icon. Bei Produktion trägt er einen roten Rand.
- Doppelklick öffnet den Cluster-Tab.
- Kontextmenü: Öffnen, Bearbeiten, Deaktivieren.

### Cluster-Tab (Layout „Hybrid“)

Von oben nach unten:

1. **Kopfzeile:** Cluster-Name, Badge „Produktion“ und Badge „Nur lesen“, Breadcrumb des Drill-downs,
   Namespace-Auswahl (inklusive „alle“), Leiste für `/` Filter und `:` Befehl, ein **?**-Symbol und der Verbindungsstatus
   (verbinde · bereit über k8s-cp1 · getrennt – verbinde neu…).
2. **Node-Streifen:** eine Kachel pro Node mit Ready-Status, CPU und RAM als Balken. Die Auslastung kommt aus `metrics.k8s.io`, das alle 15 s abgefragt wird.
   Fehlt die Metrics-API, zeigen die Kacheln nur den Status, dazu den dezenten Hinweis „Auslastung nicht verfügbar“.
   Ein Klick auf eine Kachel öffnet den Reiter Nodes mit Auswahl auf dieser Node.
3. **Problem-Hinweis:** höchstens eine Zeile („3 Probleme ▾“), die bei Klick zur Liste aufklappt. Ein Eintrag springt in den passenden
   Reiter und Namespace und setzt dort die Auswahl. Ohne Probleme ist der Hinweis ausgeblendet.
4. **Reiter und Tabelle:** Pods, Deployments, StatefulSets, DaemonSets, Jobs, CronJobs, Services, Ingress, Nodes, Events.
   Die Daten kommen live per Watch. Die Spalten sind per Klick sortierbar.
5. **Angedockter Bereich**, der der Auswahl folgt: Logs, Shell, Events, YAML, Describe.
   Er ist per Ziehen in der Höhe veränderbar und lässt sich mit `Ctrl+J` einklappen.

**Spalten**

| Reiter | Spalten |
|---|---|
| Pods | Name, Ready, Status, Restarts, CPU/RAM (Sparkline), Node, Alter |
| Deployments, StatefulSets, DaemonSets | Name, Ready/Desired, Up-to-date, Image, Alter |
| Jobs / CronJobs | Name, Completions bzw. Zeitplan, letzter Lauf, Alter |
| Services | Name, Typ, Cluster-IP, Ports, Alter |
| Ingress | Name, Hosts, Adresse, Alter |
| Nodes | Name, Status, Rollen, CPU/RAM, Pods, Kubelet-Version |
| Events | Typ, Grund, Objekt, Meldung, Anzahl, zuletzt. Warnungen stehen oben. |

**Drill-down:** Deployment, StatefulSet, DaemonSet oder Job führt zu seinen Pods (über den Label-Selector),
ein Pod zu seinen Containern, eine Node zu den Pods darauf, ein Service zu den Pods hinter ihm.
`Esc` geht eine Ebene zurück.

### Problem-Erkennung

Eine reine Funktion `problems(snapshot) → Problem[]`. Sie erkennt:

| Problem | Bedingung |
|---|---|
| CrashLoop | ein Container im Zustand `waiting.reason = CrashLoopBackOff` |
| OOMKilled | `lastState.terminated.reason = OOMKilled` innerhalb der letzten 60 min |
| Image | `waiting.reason` ∈ {`ImagePullBackOff`, `ErrImagePull`, `InvalidImageName`} |
| Pending | Phase `Pending` seit mehr als 5 min |
| Node | Bedingung `Ready` ≠ `True`, oder `MemoryPressure`/`DiskPressure`/`PIDPressure` = `True` |

Die Pods aller Namespaces laufen für die Erkennung immer mit, unabhängig vom gewählten Namespace.

### Angedockter Bereich

- **Logs:** Startet mit `tailLines 500` und Follow. Beim Hochscrollen pausiert die Anzeige und zeigt „↓ live“.
  `p` schaltet auf die Logs des vorherigen Containers um. Bei Pods mit mehreren Containern gibt es eine Auswahl.
- **Shell:** Öffnet erst bei `s` oder einem Klick, ein bloßes Bewegen der Auswahl startet keine Exec-Session.
  Es wird erst `bash`, dann `sh` versucht.
- **Events:** die Events des ausgewählten Objekts.
- **YAML:** nur lesbar. `data`/`stringData` von Secret-Objekten sind maskiert, `managedFields` sind ausgeblendet.
- **Describe:** eine Zusammenfassung mit Status, Conditions, Containern (Image, Ports, Limits, Restarts), Labels, Owner und den letzten Events.
- Wechselt die Auswahl, wird der vorige Log-Stream geschlossen.
- `Ctrl+Shift+T` löst Logs oder Shell **als eigenen Terminal-Tab** heraus. Der Tab läuft danach unabhängig weiter,
  zählt zum Session-Limit und kann wie andere Tabs abgekoppelt werden.

### Tastatur und Befehle

Die Tasten gelten, sobald der Fokus in der Tabelle liegt. Die Maus bietet überall dieselben Möglichkeiten.

| Taste | Aktion |
|---|---|
| `↑↓` / `j k` | Auswahl bewegen |
| `Enter` | Drill-down |
| `Esc` / `Backspace` | eine Ebene zurück |
| `/` | Filter nach Name oder Label (`app=api`), `Esc` leert ihn |
| `:` | Befehl, mit Autovervollständigung |
| `1`–`9`, `0` | Reiter direkt wählen |
| `l` `s` `e` `y` `d` | Bereich: Logs / Shell / Events / YAML / Describe |
| `p` | Logs des vorherigen Containers |
| `r` | Rollout neu starten |
| `S` | Skalieren |
| `Ctrl+D` | Pod löschen |
| `Ctrl+J` | Bereich ein- oder ausklappen |
| `Ctrl+Shift+T` | Logs oder Shell als Tab herauslösen |
| `?` | Hilfe-Übersicht |

Befehle: `:pods`, `:deploy`, `:sts`, `:ds`, `:jobs`, `:cronjobs`, `:svc`, `:ing`, `:nodes`, `:events`,
`:ns <name|all>`, `:restart`, `:scale <n>`, `:delete`, `:help`.

**Hilfe-Übersicht.** `?`, `:help` oder das **?**-Symbol öffnen eine Übersicht mit zwei Spalten: Hotkeys nach Bereich
(Navigation, Ansicht, Aktionen) und Befehle mit Syntax und Beispiel. Oben steht ein Suchfeld, `Esc` schließt die Übersicht.
Aktionen, die gerade nicht verfügbar sind (bei „Nur lesen“ oder im aktuellen Reiter), stehen ausgegraut da, jeweils mit Begründung.

Hotkeys, Befehle, Autovervollständigung und Hilfe kommen aus **einer** Registry (`kube-commands.ts`).
Jeder Eintrag hat eine ID, Tasten, gegebenenfalls einen Befehl, eine Beschreibung, eine Gruppe und eine Verfügbarkeitsfunktion.
So kann die Hilfe nie vom Verhalten abweichen.

### Aktionen und Bestätigung

| Aktion | Gilt für | Umsetzung |
|---|---|---|
| Rollout neu starten | Deployment, StatefulSet, DaemonSet | Patch der Annotation `kubectl.kubernetes.io/restartedAt` im Pod-Template |
| Skalieren | Deployment, StatefulSet | Merge-Patch auf `spec.replicas` |
| Pod löschen | Pod | `delete` mit Standard-Grace-Period |

- **Jede verändernde Aktion fragt nach.** Das gilt unabhängig von „Produktion“, und es gibt keine Option „nicht mehr fragen“.
- Der Dialog nennt Aktion, Ressource, Namespace und Cluster, beim Skalieren auch die Anzahl alt → neu.
- **Ist Produktion gesetzt, und auch bei jedem Scale auf 0**, muss man den Ressourcennamen eintippen. Erst dann wird der Knopf aktiv.
- Die Aktion läuft im Hintergrund. Das Ergebnis zeigt die Live-Tabelle, ein Fehler erscheint als kurze Meldung.
- Shell (exec) ist keine Aktion im Sinne dieser Tabelle und fragt nicht nach.

### Workspaces

Ein Workspace speichert für offene Cluster-Tabs: Cluster-ID, Namespace, Reiter, Drill-down, ausgewähltes Objekt und den Modus des Bereichs.
Beim Wiederherstellen verbindet sich der Tab neu. Eine Shell wird dabei nicht automatisch geöffnet.
Herausgelöste Log- und Shell-Tabs werden in Stufe 1 nicht wiederhergestellt.

## Architektur

### Main-Prozess: neues Modul `src/main/kubernetes/`

| Datei | Aufgabe |
|---|---|
| `access.ts` | Probiert die Zugangs-Hosts der Reihe nach und baut die SSH-Verbindung über die vorhandenen Bausteine aus `src/main/containers/runner.ts` auf. Liest die kubeconfig (siehe Quelle `auto`), parst sie mit `KubeConfig.loadFromString` und wählt den Context. |
| `tunnel.ts` | Lokaler `net.Server` auf `127.0.0.1:0`. Jede Verbindung geht per `forwardOut` zum API-Server. Dazu kommt das Umschreiben der kubeconfig im Speicher (`server`, `tls-server-name`). |
| `session.ts` | `ClusterSession` pro Cluster-ID mit `KubeConfig`, API-Clients, Informern und Status. Offene Tabs werden gezählt, nach dem letzten wird die Session 60 s später geschlossen. Übernimmt Neuverbindung und Failover. |
| `watch.ts` | Informer je (Ressourcenart, Namespace), nur für das, was gerade abonniert ist. Pods aller Namespaces, Nodes und Events laufen immer mit. Änderungen gehen gebündelt alle 250 ms als Upserts und Deletes an den Renderer. |
| `metrics.ts` | Fragt `metrics.k8s.io` alle 15 s ab (Nodes, Pods des sichtbaren Namespace) und hält eine kurze Historie für die Sparklines (20 Werte). |
| `problems.ts` | Reine Problem-Erkennung (siehe oben). |
| `actions.ts` | Restart, Scale und Delete. Lehnt jede Aktion ab, wenn der Cluster `readOnly` ist, und zwar unabhängig von der UI. |
| `streams.ts` | Logs und Exec über `client-node` (`Log`, `Exec`). Wird als neue Terminal-Quelle im bestehenden `SshSessionManager` angebunden, damit xterm, Resize, Flow-Control und Herauslösen wiederverwendet werden. |
| `describe.ts` | Baut aus Objekt und Events die Describe-Zusammenfassung. Maskiert Secret-Daten für die YAML-Ansicht. |
| `parsers.ts` | Wandelt API-Objekte in schmale Zeilen-Typen für die Tabelle (`PodRow`, `WorkloadRow`, …). Zum Renderer gehen nur diese Zeilen, keine vollen Objekte. |
| `ipc.ts`, `validation.ts` | IPC-Kanäle mit zod-Prüfung jeder Anfrage |

### IPC-Kanäle (`src/shared/ipc.ts`)

| Kanal | Richtung | Inhalt |
|---|---|---|
| `k8s:open` | Renderer → Main | Cluster-ID → Session-ID |
| `k8s:subscribe` | Renderer → Main | Session-ID, Reiter, Namespace, Drill-down |
| `k8s:detail` | Renderer → Main | Objekt-Ref, Modus (`yaml`, `describe`, `events`) → Text bzw. Liste |
| `k8s:action` | Renderer → Main | Objekt-Ref, Aktion, Parameter → Ergebnis oder Meldung |
| `k8s:close` | Renderer → Main | Session-ID |
| `k8s:update` | Main → Renderer | gebündelte Upserts und Deletes je Ressourcenart, Metrics, Problemliste |
| `k8s:status` | Main → Renderer | Verbindungsstatus, aktiver Zugangs-Host, Fehlermeldung |

Logs und Shell laufen über die bestehenden Terminal-Kanäle. `SshPrepareRequest` bekommt dafür neben dem Container-`target` ein `k8sTarget`
(Session-ID, Namespace, Pod, Container, Modus `logs | previous | shell`).

### Shared

- `src/shared/kubernetes.ts`: Zeilen-Typen, Objekt-Refs, Problem-Typ, Status
- `src/shared/kubernetes-schema.ts`: zod-Schemas für die IPC-Anfragen und den Vault-Knoten

### Renderer

| Datei | Aufgabe |
|---|---|
| `kube-view.ts` | Reiner Reducer: Zeilen je Reiter, Filter, Sortierung, Auswahl, Drill-down-Stapel, Status |
| `kube-commands.ts` | Registry für Hotkeys und Befehle (siehe oben) |
| `hooks/useClusterSession.ts` | `k8s:open`/`close`, Abonnements, Empfang von `k8s:update`/`k8s:status` |
| `components/kubernetes/ClusterView.tsx` | Gesamtes Layout |
| `components/kubernetes/NodeStrip.tsx` | Node-Kacheln |
| `components/kubernetes/ProblemBanner.tsx` | Problem-Hinweis |
| `components/kubernetes/ResourceTable.tsx` | Tabelle mit Tastaturbedienung, virtualisiert ab 200 Zeilen |
| `components/kubernetes/DetailDock.tsx` | Angedockter Bereich mit eingebettetem xterm |
| `components/kubernetes/HelpOverlay.tsx` | Hilfe-Übersicht |
| `components/kubernetes/ConfirmAction.tsx` | Bestätigung, bei Produktion mit Eintippen |
| `components/ClusterForm.tsx` | Formular des Vault-Eintrags |

Farben und Maße kommen aus den bestehenden Tokens in `styles.css`. Neue Stile liegen in `kubernetes-ui.css`.

### Datenfluss

1. Doppelklick auf den Cluster → `k8s:open`.
2. `access` verbindet zum ersten erreichbaren Zugangs-Host und liest die kubeconfig. `tunnel` startet, `session` legt die Clients an.
3. `k8s:status` meldet „bereit über k8s-cp1“. Nodes, Pods (alle Namespaces) und Events laufen an.
4. Der Renderer abonniert Reiter und Namespace per `k8s:subscribe`. Main startet die Informer, die dafür fehlen, und beendet die nicht mehr gebrauchten.
5. Änderungen kommen gebündelt über `k8s:update`. Der Reducer übernimmt sie, und die Tabelle rendert neu.

### Verbindungsabbruch und Failover

- Bricht die SSH-Verbindung ab, wechselt der Status auf „getrennt – verbinde neu…“. Die Daten bleiben sichtbar, aber grau.
- Neuverbindung mit Backoff (1 s, 2 s, 5 s, 10 s, dann alle 30 s). Jeder Versuch beginnt beim ersten Zugangs-Host und geht die Liste durch.
- Nach der Neuverbindung laden die Informer ihre Listen neu (relist). Offene Log-Streams im Bereich starten neu, eine Shell nicht.
- Ein Watch, der mit `410 Gone` oder einem Netzfehler endet, wird neu aufgebaut. Erst nach drei Fehlversuchen in Folge erscheint ein Hinweis.

## Sicherheit

- **Zugangsdaten:** Die kubeconfig liegt nur im Speicher des Main-Prozesses. Sie wird nicht auf die Platte geschrieben, nicht in den Renderer gegeben und nicht geloggt.
- **Tunnel:** Er lauscht ausschließlich auf `127.0.0.1`, auf einem zufälligen Port, und gilt nur für diese Session. Mit der Session wird er geschlossen.
- **Nur lesen:** Main lehnt `k8s:action` und Shell-Anfragen ab, die UI blendet sie zusätzlich aus. Logs, YAML und Describe bleiben erlaubt.
- **Bestätigung:** siehe *Aktionen und Bestätigung*. Jede verändernde Aktion fragt nach.
- **Secrets:** Es gibt keinen Secrets-Reiter. In der YAML-Ansicht sind `data`/`stringData` maskiert. Env-Werte aus `secretKeyRef` zeigt Describe nur als Verweis.
- **Eingaben:** Namespace-, Ressourcen- und Containernamen werden gegen das DNS-1123-Muster geprüft, bevor sie in API-Pfade oder Exec-Anfragen gehen.
- **Exec-Plugins:** Kubeconfigs mit `exec`/`auth-provider` werden abgelehnt (siehe Vault-Modell).
- **RBAC:** Läuft der Zugang über `admin.conf`, ist jede Aktion erlaubt. Ein 403 wird verständlich angezeigt, die Vorabprüfung kommt in Stufe 2.

## Fehler

Alle Meldungen sind auf Deutsch, nach dem Muster von `describeFailure` in `src/main/containers/parsers.ts`.

| Situation | Anzeige |
|---|---|
| Kein Zugangs-Host erreichbar | „Keiner der Zugangs-Hosts erreichbar (k8s-cp1: Timeout, k8s-cp2: …)“ mit dem Knopf „Erneut versuchen“ |
| Keine kubeconfig gefunden | „Keine kubeconfig auf k8s-cp1 gefunden (geprüft: $KUBECONFIG, ~/.kube/config, /etc/kubernetes/admin.conf)“ mit dem Hinweis, einen Pfad anzugeben |
| admin.conf, sudo verlangt ein Passwort (kein Passwort gespeichert, kein NOPASSWD) | „/etc/kubernetes/admin.conf braucht sudo, und sudo verlangt ein Passwort. Speichere das Passwort an der SSH-Verbindung, richte NOPASSWD ein oder lege die kubeconfig unter ~/.kube/config ab.“ |
| sudo abgelehnt oder belegt | dieselben Meldungen wie bei den Containern, über dasselbe Gate |
| Context nicht vorhanden | „Context ‚…‘ gibt es in der kubeconfig nicht (vorhanden: …)“ |
| Exec-Plugin in der kubeconfig | „Diese kubeconfig nutzt ein Login-Plugin. Das wird noch nicht unterstützt.“ |
| TLS-Fehler über den Tunnel | konkrete Meldung mit Zertifikats-Host und Ziel |
| 401 / 403 | „Nicht angemeldet“ bzw. „Keine Berechtigung: pods/delete in shop“ |
| Watch bricht ab | automatischer Neuaufbau, nach drei Fehlversuchen ein Hinweis |
| metrics-server fehlt | kein Fehler, nur „Auslastung nicht verfügbar“ |
| Kein Shell im Container | „Im Container gibt es weder bash noch sh.“ |
| Ressource verschwunden | Die Auswahl springt zurück, die Meldung lautet „… wurde gelöscht“. |

## Tests

**Automatisiert** (vitest, injizierte Abhängigkeiten, kein echter Cluster):

- `access`: Host-Failover, Reihenfolge der Kubeconfig-Quellen, sudo-Weg mit Gate und Abweisungen, Wahl des Contexts, Ablehnung von Exec-Plugins. Mit einem gefälschten ssh2-Client wie in `runner.test.ts`.
- `tunnel`: Umschreiben der kubeconfig, Bindung nur an `127.0.0.1`, Aufräumen beim Schließen.
- `problems`: Fixture-Snapshots für jede Regel, inklusive Grenzfällen (Pending genau 5 min, OOMKilled vor 61 min).
- `actions`: Patch-Bodies für Restart und Scale, Ablehnung bei `readOnly` im Main, Übersetzung von 403.
- `watch`: Bündeln, Auf- und Abbau der Informer beim Wechsel von Abonnements, Neuaufbau bei 410.
- `describe`: Maskierung von Secret-Daten.
- Vault-Schema: der neue Knotentyp ist gültig, bestehende Vaults bleiben unverändert gültig.
- Renderer: Reducer `kube-view` (Drill-down, Filter, Sortierung, Auswahl nach Löschung) und Registry `kube-commands`
  (jeder Eintrag hat eine Beschreibung, keine Taste ist doppelt belegt, die Verfügbarkeit bei `readOnly` stimmt).
- Bestätigung: Mit Produktion ist der Knopf erst nach korrektem Eintippen aktiv, ebenso bei Scale auf 0.

**Gegen k8s.** Es gibt keinen Test-Cluster, und am Produktiv-Cluster wird **nichts verändert, auch nicht zum Testen**.

- Spike (erste Aufgabe, nur lesend, erst nach Freigabe): Tunnel über cp1, TLS-Handshake, `list nodes`, ein Watch.
- Manueller Abnahmetest, nur lesend:
  - Einrichtung aus der Verbindung k8s-cp1
  - Failover: cp1 im Vault deaktivieren, dann muss die Verbindung über cp2 laufen
  - Live-Updates, Node-Streifen, Problem-Hinweis
  - Logs, Logs des vorherigen Containers, Shell
  - YAML und Describe
  - Hilfe-Übersicht
  - Workspace-Wiederherstellung
- Restart, Scale und Löschen werden nur bis zum Bestätigungsdialog geprüft und dort **abgebrochen**.
  Ihre Wirkung ist allein durch die automatisierten Tests abgedeckt.

## Dokumentation

- README: neuer Abschnitt „Kubernetes“. Der Satz „kein Kubernetes“ im Abschnitt „Container und VMs“ entfällt.
- CHANGELOG: Eintrag für die nächste Version.
- `2026-10-14-container-integration-design.md`: Hinweis bei „Abgrenzung“, dass Kubernetes jetzt eine eigene Spec hat.
