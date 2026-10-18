# Kubernetes-Kontextmenüs – Design

Stand: 2026-10-16 · Erweiterung von Stufe 1 (`2026-10-16-kubernetes-integration-design.md`) · Analyse: Fable, validiert durch Opus

## Ziel

Im Cluster-Tab bietet die Maus per Rechtsklick dasselbe wie die Tastatur. Dazu kommt, was sich mit einer Taste nicht ausdrücken lässt: Kopieren
(Namen, Images, DNS-Namen, kubectl-Befehle), Sprünge zu verwandten Objekten (Owner, Node, beteiligtes Objekt eines Events) und Aktionen auf Zielen,
die gerade nicht die Tabellenauswahl sind (Node-Kachel, Problem-Eintrag). Außerdem kommen vier kleine, umkehrbare Aktionen dazu:
Job löschen, Node sperren/freigeben (cordon/uncordon), CronJob anhalten/fortsetzen und CronJob jetzt ausführen.

**Erfolgskriterien**

- Jede Fläche aus Abschnitt „Menüs je Fläche“ öffnet ihr Menü per Rechtsklick und per `Shift+F10` bzw. die `ContextMenu`-Taste.
- Menüs entstehen an genau einer Stelle (`kube-menus.ts`) und sind ohne DOM getestet.
- Hilfe-Overlay, Hotkey, `:`-Befehl und Menü nennen für dieselbe Aktion immer dieselbe Verfügbarkeit und dieselbe Begründung.
- Keine verändernde Aktion umgeht den Bestätigungsdialog. Bei Produktion muss der Name eingetippt werden, „Nur lesen“ wird weiter im Main durchgesetzt.
- Kein Eintrag kopiert gezielt Env-Werte, Secret-Werte, Tokens, Server-URLs oder kubeconfig-Inhalte. YAML/Describe kopieren genau den angezeigten, maskierten Text.

## Festgelegte Entscheidungen

| Frage | Entscheidung |
|---|---|
| Umfang | Alle Flächen A–D, H–K und N aus der Tabelle unten, alle neuen Zeilenfelder und Aktionen einschließlich „Jetzt ausführen“ |
| Nicht in dieser Spec | URL im Browser öffnen (Ingress), drain ausführen (nur als kopierbarer Befehl), Tab-Leisten-Menü, „Als Datei speichern“, Untermenüs, Argo-Sync, Harbor-Links, Löschen anderer Kinds als Pod/Job |
| Deaktivierte Einträge | bleiben sichtbar und zeigen die Begründung im `hint`, wie das Hilfe-Overlay. Das gilt auch bei „Nur lesen“. |
| Modell | neues reines Modul `src/renderer/src/kube-menus.ts` (`menuFor`). Verfügbarkeit von Aktionen teilt es über das ref-basierte `actionReason` aus `kube-commands.ts`. |
| kubectl-Befehle | reines Modul `src/renderer/src/kube-kubectl.ts`. Format immer `kubectl -n <ns> …` ohne `--context`. Jeder Name wird gegen `KUBE_NAME` geprüft, Labels gegen `LABEL_KEY`/`LABEL_VALUE`. Schlägt die Prüfung fehl, liefert der Builder `null` und der Eintrag ist deaktiviert („Name enthält ungültige Zeichen.“). |
| Dock-Terminal | behält Rechtsklick = Einfügen. Dort gibt es kein Menü. |
| Bestehende Komponente | `ContextMenu.tsx` wird unverändert wiederverwendet |

## Menüs je Fläche

Konventionen für alle Menüs:

- Reihenfolge der Gruppen: **Öffnen/Navigation → Ansicht → Kopieren → Aktionen**. Aktionen stehen immer unten, mit „…“ im Label (es folgt der Dialog).
- `hint` zeigt den Hotkey aus `KUBE_COMMANDS.keys` (z. B. `l`, `Ctrl+d`). Ist ein Eintrag deaktiviert, zeigt `hint` stattdessen die Begründung – exakt wie im Hilfe-Overlay (`READ_ONLY_MESSAGE`, „Nur für Pods.“ …).
- Verbindungsstatus ≠ `ready` (reconnecting/error): Ansicht-, Terminal- und Aktions-Einträge deaktiviert mit „Der Cluster ist gerade nicht verbunden.“ – Navigation und Kopieren bleiben aktiv.
- Kopieren-Einträge tragen die Überschrift „Kopieren“ und knappe Labels; nach dem Kopieren erscheint die Statusmeldung `Kopiert: <Text gekürzt>` über `say()`.
- Bei `kubectl`-Befehlen gilt immer die Form `kubectl -n <ns> …`, ohne `--context` (der Renderer kennt den Context nicht; die Befehle sind für die Shell auf cp1 gedacht, wo der Context der Standard ist).

### A1 · Pods

| Eintrag | Hotkey | Verfügbar wenn | Aufwand | Wert |
|---|---|---|---|---|
| Container anzeigen | Enter | immer | (a) `drill` | ★★ |
| Pods auf Node `<node>` anzeigen | – | `row.node` vorhanden | (a*) neue Reducer-Aktion `openQuery` (Query + Crumb, s. u.) | ★★ |
| `<Kind> <owner>` anzeigen (z. B. „Deployment api anzeigen“) | – | `row.owner` vorhanden und Kind ∈ KUBE_KINDS | (b) `rows.ts`: `owner?: KubeRef`; ReplicaSet-Owner wird per `pod-template-hash` zum Deployment aufgelöst (`<rs-name>` endet auf `-<hash>` → Deployment = Name ohne Suffix); Job → CronJob direkt | ★★★ |
| Namespace `<ns>` anzeigen | – | nur in „alle Namespaces“ (`query.namespace === null`) | (a) `setNamespace` | ★★ |
| Filtern: `app=api` (bis zu 3 Einträge; Reihenfolge `app`, `app.kubernetes.io/name`, `app.kubernetes.io/instance`, `app.kubernetes.io/component`, sonst die ersten Labels) | – | Label vorhanden | (a) `filter` | ★★ |
| — | | | | |
| Logs | l | Pod hat Container | (a) | ★★★ |
| Logs des vorherigen Containers | p | wie Logs | (a) | ★★★ |
| Shell öffnen | s | nicht readOnly; Status läuft (nicht Completed/Terminating → sonst Begründung „Der Pod läuft nicht.“) | (a) armt wie `s` | ★★★ |
| Events | e | immer | (a) | ★★ |
| YAML | y | immer | (a) | ★★ |
| Describe | d | immer | (a) | ★★ |
| Logs als Tab öffnen / Shell als Tab öffnen | Ctrl+Shift+T | `onPopout` vorhanden (sonst „Hier lässt sich kein Tab öffnen.“); Shell zusätzlich nicht readOnly | (a) `onPopout` direkt mit Target, ohne Umweg über das Dock | ★★★ (mehrere Pod-Logs nebeneinander) |
| — Kopieren — | | | | |
| Name | – | immer | (a) | ★★★ |
| Namespace/Name (`shop/api-1`) | – | immer | (a) | ★★ |
| Image (bei mehreren Containern: `name=image` je Zeile) | – | `image:*`-Zellen vorhanden | (a) | ★★★ (Harbor-Nachschlagen) |
| Labels (`k=v`, eine je Zeile) | – | Labels vorhanden | (a) | ★★ |
| Pod-IP | – | `row.ip` vorhanden | (b) `rows.ts`: `ip?: string` aus `status.podIP` | ★ |
| `kubectl logs -f …` (`kubectl -n shop logs -f api-1 -c api`) | – | immer | (a) Builder | ★★★ |
| `kubectl exec …` (`kubectl -n shop exec -it api-1 -c api -- sh`) | – | immer (auch readOnly: ist nur Text) | (a) Builder | ★★ |
| `kubectl describe pod …` | – | immer | (a) | ★ |
| — | | | | |
| Pod löschen… | Ctrl+d | nicht readOnly | (a) `startAction('delete')` mit der Zeile des Menüs | ★★★ |

Bei Pods mit mehreren Containern nutzen Logs/Shell den ersten Container (wie heute `l`/`s`); der `hint` zeigt dann `Container api`. Weitere Container erreicht man über „Container anzeigen“ und das Menü B.

### A2 · Deployments, StatefulSets, DaemonSets

| Eintrag | Hotkey | Verfügbar wenn | Aufwand | Wert |
|---|---|---|---|---|
| Pods anzeigen | Enter | `row.selector` vorhanden | (a) `drill` | ★★★ |
| Namespace `<ns>` anzeigen | – | nur „alle Namespaces“ | (a) | ★★ |
| — | | | | |
| Events / YAML / Describe | e / y / d | immer | (a) | ★★ |
| — Kopieren — | | | | |
| Name · Namespace/Name | – | immer | (a) | ★★ |
| Image(s) (`cells.image`, kommagetrennt → eine je Zeile) | – | vorhanden | (a) | ★★★ |
| Selector (`app=api,tier=web`, kubectl-`-l`-Form) | – | vorhanden | (a) | ★★ |
| Labels | – | vorhanden | (a) | ★ |
| `kubectl rollout restart …` | – | Deployment/StatefulSet/DaemonSet | (a) | ★★ |
| `kubectl scale … --replicas=<n>` (n = aktuelle Replicas) | – | Deployment/StatefulSet | (a) | ★ |
| `kubectl rollout status …` | – | immer | (a) | ★★ |
| — | | | | |
| Rollout neu starten… | r | nicht readOnly | (a) `startAction('restart')` | ★★★ |
| Skalieren… | S | nicht readOnly, nicht DaemonSet („Nur für Deployments und StatefulSets.“) | (a) `startAction('scale')` | ★★★ |

Nicht aufnehmen: „Rollout-Status anzeigen“ als eigene Funktion – die Spalten Ready/Aktuell sind live, und „Pods anzeigen“ zeigt den Fortschritt. Nur der kubectl-Befehl wird kopierbar. „Logs aller Pods“ ist Stufe 2 (c).

**Argo-CD-Hinweis (billig, (a), ★★):** Trägt die Zeile das Label `argocd.argoproj.io/instance` (Standard-Tracking von Argo CD), bekommt das Menü oben eine Überschrift `Argo CD: App <wert>` und unter Kopieren „Argo-App-Name“. Mehr nicht: Argo-URL und Self-Heal-Warnung im Dialog sind Stufe 2. Harbor: „Image kopieren“ reicht; „In Harbor öffnen“ braucht eine Harbor-URL im Cluster-Eintrag → (c).

### A3 · Jobs

| Eintrag | Hotkey | Verfügbar wenn | Aufwand | Wert |
|---|---|---|---|---|
| Pods anzeigen | Enter | `row.selector` (sonst „Dieser Job hat keinen Selector.“) | (a) | ★★ |
| `CronJob <owner>` anzeigen | – | `row.owner` Kind CronJob | (b) wie A1 Owner | ★★ |
| Namespace anzeigen | – | nur „alle“ | (a) | ★ |
| Events / YAML / Describe | e / y / d | immer | (a) | ★★ |
| — Kopieren — Name · Namespace/Name · `kubectl logs job/<name>` · `kubectl describe job …` | – | immer | (a) | ★★ |
| — | | | | |
| Job löschen… | – | nicht readOnly | (b) `ACTION_KINDS.delete` um `jobs` erweitern; `client-api.remove` mit `propagationPolicy: 'Background'` (sonst bleiben die Pods als Waisen); `confirm-action.ts`: Titel „Job löschen?“, Text „… und seine Pods werden gelöscht.“ | ★★★ (fehlgeschlagene/alte Jobs aufräumen ist Routine) |

### A4 · CronJobs

| Eintrag | Hotkey | Verfügbar wenn | Aufwand | Wert |
|---|---|---|---|---|
| Jobs anzeigen | Enter | immer | (a) `setKind('jobs')` + `filter` = CronJob-Name (Jobs heißen `<cronjob>-<zeit>`); Crumb „CronJob <name>“ | ★★ |
| Events / YAML / Describe | e / y / d | immer | (a) | ★★ |
| — Kopieren — Name · Zeitplan · `kubectl create job --from=cronjob/<name> <name>-manual-<unixzeit>` · `kubectl patch cronjob <name> -p '{"spec":{"suspend":true}}'` | – | immer | (a) | ★★★ (manuelles Auslösen heute ohne Mutation möglich) |
| — | | | | |
| Anhalten… / Fortsetzen… (je nach `row.suspended`) | – | nicht readOnly | (b) neue Aktionen `suspend`/`resume`: `mergePatch({ spec: { suspend } })`; `rows.ts`: `suspended?: boolean`; Dialog „CronJob anhalten?“ – Produktion = Name tippen | ★★ (Wartungsfenster) |
| Jetzt ausführen… | – | nicht readOnly | (b, mittel) neue `KubeApi.createJobFrom(cronRef, jobName)`: liest den CronJob, legt einen Job aus `spec.jobTemplate` mit `ownerReference` (controller: true) und Annotation `cronjob.kubernetes.io/instantiate: manual` an (Name `<cronjob>-manual-<unix>`, auf 63 Zeichen gekürzt, ohne Bindestrich am Ende); Aktion `trigger` mit Dialog | ★★, in dieser Spec |

### A5 · Services

| Eintrag | Hotkey | Verfügbar wenn | Aufwand | Wert |
|---|---|---|---|---|
| Pods anzeigen | Enter | `row.selector` nicht leer (sonst „Dieser Service hat keinen Selector, z. B. ExternalName.“) | (a) | ★★★ |
| Events / YAML / Describe | e / y / d | immer | (a) | ★★ |
| — Kopieren — Name · Cluster-IP · DNS-Name (`<svc>.<ns>.svc.cluster.local`) · Ports · Selector · `kubectl port-forward svc/<name> <port>:<port>` (erster Port) | – | je Feld vorhanden | (a) | ★★★ (DNS-Name und Port-Forward-Befehl sind Alltag; Port-Forward selbst ist Stufe 3) |

Keine Aktionen.

### A6 · Ingress

| Eintrag | Hotkey | Verfügbar wenn | Aufwand | Wert |
|---|---|---|---|---|
| Events / YAML / Describe | e / y / d | immer | (a) | ★★ |
| — Kopieren — Name · Hosts · URL(s) (`https://<host>`, eine je Zeile) · Adresse | – | je Feld | (a) | ★★ |
| ~~URL im Browser öffnen~~ | – | – | nicht in dieser Spec | – |

Kein Drill-down (Ingress hat keinen Pod-Selector); „Backend-Services anzeigen“ bräuchte Regel-Parsing → (c).

### A7 · Nodes

| Eintrag | Hotkey | Verfügbar wenn | Aufwand | Wert |
|---|---|---|---|---|
| Pods auf dieser Node anzeigen | Enter | immer | (a) `drill` | ★★★ |
| Events / YAML / Describe | e / y / d | immer | (a) | ★★ |
| SSH-Verbindung öffnen (`hint`: Name der Vault-Verbindung) | – | Vault hat eine aktive SSH-Verbindung, deren `host` = Node-Name, = interne IP oder deren `name` = Node-Name/Kurzname; sonst deaktiviert „Keine SSH-Verbindung für worker2 im Vault.“ | (b, nur Renderer) reine Funktion `sshConnectionForNode(nodes, node)` + Prop `onOpenSsh` von `App` über `SplitTerminalArea` nach `ClusterView` | ★★★ (On-Prem: der nächste Schritt ist fast immer SSH auf die Node) |
| — Kopieren — Name · Interne IP · Kubelet-Version · `kubectl describe node …` · `kubectl drain <node> --ignore-daemonsets --delete-emptydir-data` · `kubectl cordon/uncordon <node>` | – | IP: `row.ip` | (b) `rows.ts`: `ip?` aus `status.addresses[type=InternalIP]`; `NodeTile.ip` ebenso (`toNodeTile`) | ★★ (drain bleibt bewusst nur Text) |
| — | | | | |
| Node sperren (cordon)… / Node freigeben (uncordon)… (je nach `row.unschedulable`) | – | nicht readOnly | (b) neue Aktionen `cordon`/`uncordon`: `mergePatch({ spec: { unschedulable } })`; `actions.ts` erlaubt für `nodes` fehlenden Namespace; `rows.ts`: `unschedulable?: boolean`; Dialog „Node sperren?“, Produktion = Name tippen | ★★ – **Empfehlung: cordon/uncordon vorziehen** (ein Merge-Patch, umkehrbar, gleiche Bestätigung). **drain bleibt Stufe 3.** |

### A8 · Events

| Eintrag | Hotkey | Verfügbar wenn | Aufwand | Wert |
|---|---|---|---|---|
| `<Kind> <name>` anzeigen (Sprung zum beteiligten Objekt) | – | `row.involved` Kind ∈ KUBE_KINDS; sonst deaktiviert „ReplicaSets zeigt Terminus nicht an.“ (analog PVC, HPA …) | (b, winzig) `rows.ts`: `involved?: { kind; name; ref? }` aus `involvedObject` (Kind → KubeKind-Mapping im Main, Namespace = Event-Namespace). Fallback (a): `cells.object` „Kind/name“ parsen | ★★★ |
| Events des Objekts | – | wie oben | (a) `jump` + `dock('events')` | ★★ |
| Describe des Objekts | – | wie oben | (a) `jump` + `dock('describe')` | ★★ |
| Logs des Pods | l | Kind = Pod | (a) `jump` + `dock('logs')` | ★★★ (Warning-Event → sofort Logs) |
| — Kopieren — Meldung · Objekt (`Pod/api-1`) · Grund | – | immer | (a) | ★★ |

YAML/Describe des Events selbst (heute über `e`/`y`/`d` auf der Event-Zeile): bleibt erreichbar, aber nicht im Menü – Mehrwert gering.

### B · Container-Zeilen (Drill-down eines Pods)

| Eintrag | Hotkey | Verfügbar wenn | Aufwand | Wert |
|---|---|---|---|---|
| Logs · Logs des vorherigen Containers · Shell öffnen | l · p · s | wie A1, Shell nicht readOnly | (a) `selectContainer` + `dock` | ★★★ |
| Logs als Tab öffnen · Shell als Tab öffnen | Ctrl+Shift+T | `onPopout` | (a) | ★★★ |
| Events / YAML / Describe des Pods | e / y / d | immer | (a) | ★ |
| — Kopieren — Container-Name · Image (`cells['image:<name>']`) · `kubectl logs -f … -c <name>` · `kubectl exec -it … -c <name> -- sh` | – | immer | (a) | ★★★ |
| — | | | | |
| Pod löschen… | Ctrl+d | nicht readOnly | (a) mit `containersOf.ref` | ★★ |

### C · Node-Kacheln

| Eintrag | Hotkey | Verfügbar wenn | Aufwand | Wert |
|---|---|---|---|---|
| Node anzeigen | – (Klick) | immer | (a) `jump` | ★★ |
| Pods auf dieser Node anzeigen | – | immer | (a*) `openQuery({ kind:'pods', namespace:null, selector:{ node } }, Crumb „Node <name>“)` | ★★★ |
| Describe / Events / YAML | d / e / y | immer | (a) `jump` + `dock(mode)` | ★★ |
| SSH-Verbindung öffnen | – | wie A7 | (b Renderer) | ★★★ |
| — Kopieren — Name · Interne IP | – | `tile.ip` | (b) `NodeTile.ip` | ★★ |
| — | | | | |
| Node sperren (cordon)… / freigeben… | – | nicht readOnly; `tile.unschedulable` entscheidet | (b) wie A7 | ★★ |

Die Kachel kennt über `NodeTile` `ready`, `pressure`, `unschedulable`; der Menü-Kopf (heading) kann den Zustand nennen: „worker2 · nicht bereit, DiskPressure“.

### D · Problem-Hinweis, Einträge (je `problem.kind`)

| Eintrag | Für | Hotkey | Aufwand | Wert |
|---|---|---|---|---|
| Anzeigen | alle | – (Klick) | (a) `jump` | ★★ |
| Logs des vorherigen Containers | crashloop, oomkilled | p | (a) `jump` + `setPrevious(true)` + `dock('logs')` – das Dock folgt der Auswahl, sobald die Zeilen eintreffen | ★★★ (**der** Eintrag für „warum crasht das?“) |
| Logs | crashloop, oomkilled, image, pending | l | (a) | ★★★ |
| Describe | alle | d | (a) `jump` + `dock('describe')` | ★★★ (bei image/pending steht der Grund im Describe/Events) |
| Events | alle | e | (a) | ★★ |
| Pods auf dieser Node anzeigen | node | – | (a*) `openQuery` | ★★ |
| SSH-Verbindung öffnen | node | – | (b Renderer) | ★★ |
| — Kopieren — Name · Namespace/Name · Meldung · `kubectl logs --previous …` (crashloop/oomkilled; Container = erster Container des Pods ist hier **nicht** bekannt → Befehl ohne `-c`) | alle | – | (a) | ★★ |
| — | | | | |
| Pod löschen… | crashloop, oomkilled, image, pending | Ctrl+d | (a) `setPending({ ref: problem.ref, action: 'delete' })` direkt aus dem Ref – die Verfügbarkeitsprüfung muss dafür **ref-basiert** sein (siehe Abschnitt 3), nicht auf `state.query.kind` | ★★ |

### E, F, G · Breadcrumb, Namespace-Auswahl, Reiter-Leiste

Kein Kontextmenü. Begründung: Der Klick tut bereits das Einzige, was sinnvoll ist (zurückspringen, Namespace/Reiter wechseln). Ein Menü mit „Pfad kopieren“ hätte keinen Alltagswert. Rechtsklick auf diese Flächen darf **nicht** das Hintergrundmenü (I) öffnen – `preventDefault` ohne Menü wie in `ContainerChildren.wrap`.

### H · Tabellenkopf (★, nice-to-have)

Aufsteigend sortieren · Absteigend sortieren · Sortierung aufheben (hint: „Standard: Reihenfolge des Eintreffens“). Nur „Sortierung aufheben“ bringt etwas Neues (heute nur durch Reiterwechsel möglich). (a*) Reducer-Aktion `sortBy` mit `{ key, descending } | null` ergänzen (`sort` bleibt unverändert).

### I · Leere Tabellenfläche (★, nice-to-have)

Filter leeren (deaktiviert ohne Filter, hint „Kein Filter gesetzt.“) · Alle Namespaces / Zurück zu `<ns>` · Sortierung aufheben · Hilfe… (`?`). Billig, bündelt die Funktionen, die sonst kein Mausziel haben. Wer das weglässt, verliert nichts Wesentliches.

### J · Dock-Leiste

| Eintrag | Hotkey | Verfügbar wenn | Aufwand | Wert |
|---|---|---|---|---|
| Logs · Shell · Events · YAML · Describe | l s e y d | wie Hotkeys | (a) `onMode` | ★ (Reiter sind schon klickbar; drin wegen Vollständigkeit) |
| Logs des vorherigen Containers / Aktuelle Logs | p | Modus Logs | (a) `setPrevious` | ★★ |
| Container: `<name>` (ein Eintrag je Container, Häkchen-Markierung über hint „aktiv“) | – | Pod mit > 1 Container | (a*) Reducer: `container` auch außerhalb des Drill-downs beachten (heute ist `container` ohne Drill fest `containers[0]`, `ClusterView.tsx` Zeile 58) | ★★ (Sidecars) |
| Logs neu starten | – | Modus Logs, Terminal vorhanden | (a) lokaler `reload`-Zähler, der in `dockTerminalKey` eingeht (wie `epoch`) | ★★ (Stream beendet, Pod neu) |
| Als Tab öffnen | Ctrl+Shift+T | Logs/Shell, `onPopout` | (a) | ★★ |
| Panel einklappen | Ctrl+j | immer | (a) | ★ |

### K · Dock-Inhalt (YAML, Describe, Events-Tabelle)

| Eintrag | Verfügbar wenn | Aufwand | Wert |
|---|---|---|---|
| YAML kopieren / Describe kopieren (gesamter Text) | `currentResult.data.text` vorhanden | (a) | ★★★ (Ticket, Chat, Diff) |
| Markierung kopieren | Textauswahl im `pre` | (a) `window.getSelection()` | ★ (Ctrl+C geht auch) |
| Events-Zeile: Meldung kopieren · zum Objekt springen | Zeile unter dem Cursor | (a) | ★ |
| Als Datei speichern… | – | (c) braucht Save-Dialog-IPC | – |

Die Secret-Maskierung gilt schon im Text (`toYaml`), also kopiert „YAML kopieren“ nie Secret-Werte.

### L · Dock-Terminal

**Kein Kontextmenü.** `TerminalPanel.tsx` belegt Rechtsklick mit Einfügen und kopiert Markierungen automatisch – das ist in allen Terminals von Terminus so und darf im Dock nicht anders sein. Der `onContextMenu`-Handler des Docks darf deshalb nur auf `.kube-dock-bar` und `.kube-dock-body > pre/table` liegen, nie auf `.kube-dock-terminal`.

### N · Cluster-Eintrag im Vault-Baum

Bestand bleibt (Verbinden, Bearbeiten, Umbenennen, (De)aktivieren, Neue Verbindung daneben; „Verbinden“ statt „Öffnen“ aus der Spec – Konsistenz mit den anderen Verbindungen ist wichtiger). Ergänzen:

| Eintrag | Verfügbar wenn | Aufwand | Wert |
|---|---|---|---|
| Zugangs-Host per SSH öffnen (hint: Name des ersten aktiven `accessHosts`) | ein Zugangs-Host aktiv; sonst deaktiviert mit `NO_ACCESS_MESSAGE`-Logik aus `cluster-form.ts` | (a) `VaultTree` hat `nodes` und `onConnect(id)` | ★★ |

Nicht ergänzen: „Nur lesen umschalten“ / „Produktion umschalten“ – Sicherheitsschalter gehören ins Formular, nicht in einen Ein-Klick-Eintrag.

### O · Cluster-Tab in der Tab-Leiste

(c) Kein Tab in `TerminalTabs.tsx` hat ein Kontextmenü. Ein Tab-Menü (Schließen, andere schließen, in neues Fenster) wäre ein allgemeines Feature für alle Tabs und gehört nicht in diese Spec. Kube-spezifisch gäbe es nur „Cluster bearbeiten“, das der Vault-Baum schon bietet.

---

## Interaktionsregeln

1. **Rechtsklick wählt zuerst aus.** Auf Tabellenzeilen: `dispatch({ type: 'select', key })`, dann Menü öffnen – mit dem **Zeilenobjekt des Events**, nicht mit `state.selected` (der Reducer-Stand ist im selben Event noch alt). Container-Zeilen: `selectContainer`. Node-Kacheln und Problem-Einträge ändern die Auswahl **nicht** (ihr Klick springt; das Menü arbeitet mit dem Ziel des Eintrags, erst der gewählte Menüpunkt springt).
2. **Ein Menü-Zustand** liegt in `ClusterView` (`{ x, y, target: MenuTarget }`); Kinder bekommen `onMenu(target, x, y)`. So ist immer höchstens ein Menü offen, und `modal` (Hilfe, Bestätigung) blockiert es.
3. **Tastatur.** `ContextMenu`-Taste und `Shift+F10` öffnen das Menü der ausgewählten Zeile, verankert an der Zeile (`rect.left + 24, rect.bottom`, wie `ContainerChildren`). Dafür ein Registry-Eintrag `menu` in `KUBE_COMMANDS` (Gruppe Navigation, `keys: ['Shift+F10']`, `description: 'Kontextmenü der Zeile öffnen'`), damit die Hilfe ihn zeigt. Achtung `bindingOf`: Shift wird nur mit einem weiteren Modifier in den Binding-String aufgenommen – `Shift+F10` ergibt heute `F10`. Empfehlung: `bindingOf` so erweitern, dass Shift bei Tasten mit `key.length > 1` erhalten bleibt (`'Shift+F10'`); Einzelzeichen wie `S` bleiben unverändert. Test ergänzen. Node-Kacheln und Problem-Einträge sind Buttons und bekommen denselben `onKeyDown`-Handler.
4. **`ContextMenu.tsx` wiederverwenden**, unverändert. `hint` trägt Hotkey oder Begründung; deaktivierte Einträge bleiben sichtbar (wie das Hilfe-Overlay; die Spec-Formulierung „blendet aus“ bei Nur-lesen ist damit als „ausgegraut mit Begründung“ zu lesen – Discoverability und Konsistenz mit `?`).
5. **Erzeugung an einer Stelle: neues reines Modul `src/renderer/src/kube-menus.ts`.** Nicht in `kube-commands.ts` falten: Befehle sind auswahl- und tabellenbezogen („die ausgewählte Zeile im aktuellen Reiter“), Menüs sind zielbezogen (beliebige Zeile, Kachel, Problem, Dock) und brauchen Zeilendaten (Labels, Images, Owner). Beide müssen aber **dieselbe Verfügbarkeitslogik** nutzen:
   - `kube-commands.ts`: `actionUnavailable` zu einer exportierten, **ref-basierten** Funktion `actionReason(action, { ref, readOnly, connected })` umbauen; der Registry-Eintrag ruft sie mit der ausgewählten Zeile. Damit stimmen Hilfe, Hotkey, `:`-Befehl und Menü immer überein, und Problem-Einträge können Aktionen auf ein Ref auslösen, das nicht im aktuellen Reiter liegt.
   - `kube-menus.ts`: `menuFor(target: MenuTarget, context: MenuContext): MenuEntry[]`. `MenuTarget` = `{ type: 'row', row } | { type: 'container', pod, name } | { type: 'node', tile } | { type: 'problem', problem } | { type: 'dock', mode, pod?, container?, text? } | { type: 'header', column } | { type: 'background' }`. `MenuContext` = `{ state, status (readOnly, production, state), canPopout, sshForNode?: (node) => { id, name } | undefined }`. `MenuEntry` = `{ kind: 'item', id, label, hint?, disabled?, run: MenuAction } | heading | separator`. `MenuAction` ist eine diskriminierte Union: `view(KubeViewAction)`, `copy(text, label)`, `kubeAction(ref, action, replicas?)` (läuft über `startAction`/`setPending`), `popout(target)`, `ssh(connectionId)`, `dockReload`. `ClusterView` hat genau einen `runMenu(action)`-Switch und mappt `MenuEntry` → `ContextMenuEntry`.
   - Tests ohne DOM (vitest, wie `kube-commands.test.ts`): Reihenfolge und Labels je Ziel, Begründungen bei readOnly/nicht verbunden/Completed-Pod, Namespace-Eintrag nur bei „alle“, Owner-Eintrag nur mit Owner, Argo-Überschrift nur mit Label, kein Eintrag ruft eine Aktion ohne `kubeAction`-Weg auf.
6. **kubectl-/Clipboard-Builder in `src/renderer/src/kube-kubectl.ts`** (rein): `logs`, `logsPrevious`, `exec`, `describe`, `getYaml`, `deletePod`, `rolloutRestart`, `rolloutStatus`, `scale`, `logsJob`, `createJobFromCron`, `patchSuspend`, `cordon`, `uncordon`, `drain`, `portForward`, `serviceDns`, `labelsText`, `selectorText`. Alle Namen gegen `KUBE_NAME` prüfen, Label-Schlüssel/-Werte gegen `LABEL_KEY`/`LABEL_VALUE`; schlägt die Prüfung fehl, liefert der Builder `null` und der Eintrag ist deaktiviert („Name enthält ungültige Zeichen.“). Kein Shell-Quoting nötig, weil die Muster keine Metazeichen zulassen – das ist im Test festzuhalten.
7. **Clipboard** über `window.desktopApi.writeClipboardText`; Erfolg → `say('Kopiert: …')`, Fehler → `say('Kopieren fehlgeschlagen.')`.
8. **Reducer-Ergänzungen** (`kube-view.ts`, rein, testbar): `openQuery(query, crumbLabel)` (Pods einer Node/eines Selectors aus beliebigem Kontext, mit Crumb), explizites `sortBy(key, descending | null)`, `container` gilt für den ausgewählten Pod auch ohne Drill-down (zurücksetzen bei Auswahlwechsel).

---

## Sicherheit, Risiken und Ausschlüsse

- **Kein Exec ohne ausdrücklichen Klick.** „Shell öffnen“ im Menü armt die Shell genau wie `s`; Hover, Auswahl oder das Öffnen des Menüs starten nie eine Exec-Session. Shell-Einträge bei readOnly deaktiviert; Main lehnt zusätzlich ab (`openTerminal`).
- **Keine Secrets kopieren.** Es gibt keinen Secrets-Reiter; „YAML kopieren“ kopiert den maskierten Text aus `toYaml`; Describe zeigt `secretKeyRef` nur als Verweis. Kein Eintrag kopiert gezielt Env-Werte, Tokens, Server-URLs oder kubeconfig-Inhalte; YAML/Describe kopieren genau den angezeigten, maskierten Text (Describe zeigt Env-Werte im Klartext, wie die Anzeige). kubectl-Befehle enthalten nur Namespace, Namen, Container, Labels.
- **Jede verändernde Aktion läuft durch `startAction`/`setPending` → `ConfirmAction` → `confirmationFor`.** Kein Menüeintrag ruft `action()` direkt auf; keine „ohne Nachfrage“-Varianten; kein Doppelklick-Shortcut für Aktionen. Neue Aktionen (Job löschen, cordon/uncordon, suspend/resume, trigger) bekommen Titel/Label in `confirm-action.ts`, Produktion = Name tippen, und werden in `actions.ts` **nach** der readOnly-Prüfung und mit Kind-Prüfung (`ACTION_KINDS`) sowie im zod-Enum `KubeActionRequestSchema` ergänzt. Fehlt eines davon, wirft Main „Diese Aktion ist hier nicht möglich.“ – fail-safe.
- **readOnly:** Einträge ausgegraut mit `READ_ONLY_MESSAGE`; Main bleibt die Instanz, die ablehnt (`KubeSessions.action` liest den Vault bei jedem Aufruf).
- **Nicht vorziehen:** `drain` (nur als kopierbarer Befehl), Löschen von Deployments/Services/Ingress/Nodes, YAML bearbeiten, Port-Forward ausführen, „Logs aller Pods“, Argo-Sync, Harbor-Links. Alles Stufe 2/3 oder bewusst ausgeschlossen.
- **Dock-Terminal:** kein `onContextMenu` auf dem Terminal-Container; Rechtsklick = Einfügen bleibt. Kein Menü auf Breadcrumb/Namespace/Reitern, aber `preventDefault`, damit nicht das Hintergrundmenü erscheint.
- **Veraltete Zeile:** Die Zeile im Menü kann während des Öffnens verschwinden (Pod gelöscht). Aktionen enden dann mit 404-Meldung aus Main – akzeptabel; der Dialog zeigt bei Scale `currentReplicas` der Zeile zum Zeitpunkt des Rechtsklicks.
- **Nicht verbunden:** `status.state !== 'ready'` deaktiviert Ansicht/Terminal/Aktionen mit Begründung; `detail()`/`action()` würden sonst nur die generische „nicht verbunden“-Meldung werfen.
- **Menülänge:** höchstens ~14 Einträge je Menü; Kopieren-Gruppe mit Überschrift; keine Untermenüs (ContextMenu kann keine). Lieber Einträge weglassen als nachrüsten.
- **Events → fremde Kinds** (ReplicaSet, PVC, HPA, Lease): Sprung deaktiviert mit Begründung, nicht versteckt.
- **SSH-Zuordnung Node → Vault:** nur exakte Treffer (`host` = Name/IP, `name` = Name/Kurzname), bei mehreren der erste aktive; nie Verbindungen anlegen; Treffer im hint nennen, damit der Nutzer sieht, wohin er verbindet.
- **`bindingOf`-Änderung** darf `S` (Shift+s) nicht brechen; Test für `Shift+F10`, `S`, `Ctrl+Shift+T`.
- **Keine Pod-IP/Node-IP im Problem-Eintrag** – `KubeProblem` trägt nur das Ref; dort nicht nachbauen, sondern „Anzeigen“ nutzen.

---


## Tests

- `kube-menus.test.ts` prüft je Ziel Reihenfolge, Labels, Hints, Begründungen (readOnly, nicht verbunden, Completed-Pod, fehlender Selector, fremdes Kind im Event) sowie Namespace-, Owner- und Argo-Einträge nur unter ihrer Bedingung. Außerdem prüft er, dass jede verändernde Aktion als `kubeAction` modelliert ist.
- `kube-kubectl.test.ts` prüft jeden Builder, die Ablehnung ungültiger Namen und dass keine Shell-Metazeichen durchkommen.
- `kube-commands.test.ts` prüft `actionReason` (gleiche Texte wie bisher), `menu`-Eintrag und `bindingOf('Shift+F10')`, ohne `S` und `Ctrl+Shift+T` zu brechen.
- `rows.test.ts` prüft Owner-Auflösung (ReplicaSet → Deployment, Job → CronJob), Pod-/Node-IP, `suspended`, `unschedulable` und `involved`.
- `actions.test.ts` und `client-api.test.ts` prüfen die neuen Aktionen inklusive readOnly zuerst, Kind-Prüfung, Nodes ohne Namespace, `propagationPolicy: 'Background'` und `createJobFrom` mit Namen, Kürzung auf 63 Zeichen und ownerReference.
- `confirm-action.test.ts` prüft die Texte der neuen Aktionen und dass bei Produktion der Name eingetippt werden muss.
- `kube-view.test.ts` prüft `openQuery`, explizites `sortBy` und Container-Wahl ohne Drill-down.
- `kube-ssh.test.ts` prüft die Zuordnung Node → SSH-Verbindung (nur exakte Treffer, erster aktiver).
- Manuell, nur lesend: Menüs auf allen Flächen öffnen, Kopieren prüfen, verändernde Aktionen nur bis zum Dialog und dann abbrechen.
