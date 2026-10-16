# Kubernetes-Kontextmenüs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rechtsklick-Kontextmenüs auf allen sinnvollen Flächen des Cluster-Tabs. Dazu kommen kopierbare kubectl-Befehle, Sprünge zu verwandten Objekten, SSH zur Node und vier neue Aktionen: Job löschen, cordon/uncordon, CronJob anhalten/fortsetzen und CronJob jetzt ausführen.

**Architecture:**
- Ein reines Modul `kube-menus.ts` erzeugt alle Menüs aus Ziel und Kontext (`menuFor`). Es nutzt die ref-basierte Verfügbarkeit `actionReason` aus `kube-commands.ts` und die kubectl-Builder aus `kube-kubectl.ts`.
- `ClusterView` hält genau einen Menü-Zustand und einen `runMenu`-Switch. Kinder melden nur `onMenu(target, x, y)`.
- Main bekommt zusätzliche Zeilenfelder (Owner, IP, Flags, beteiligtes Objekt) und die neuen Aktionen. Die Aktionen laufen durch dieselbe readOnly- und Kind-Prüfung wie die bestehenden.

**Tech Stack:** Electron 44, React 19, TypeScript 5.9, `@kubernetes/client-node` 2.0.0, zod 4, vitest 5.

**Spec:** `docs/superpowers/specs/2026-10-16-kubernetes-context-menus-design.md` (bindend; die Menütabellen dort sind die Anforderungen je Fläche)

## Global Constraints

- **Keine neuen npm-Abhängigkeiten.** `ContextMenu.tsx` bleibt unverändert.
- **Sprache:** UI-Texte auf Deutsch, Code-Kommentare auf Englisch, knapp wie im bestehenden Code.
- **Bestätigung:** Jede verändernde Aktion läuft über `startAction`/`setPending` → `ConfirmAction` → `confirmationFor`. Kein Menüeintrag ruft `action()` direkt auf. Bei Produktion oder Scale auf 0 muss man den Namen eintippen. Eine Option „nicht mehr fragen“ gibt es nicht.
- **Nur lesen:** `readOnly` lehnt im Main weiterhin ab (`runAction` prüft zuerst readOnly, dann Kind). Neue Aktionen müssen in `ACTION_KINDS`, im zod-Enum `KubeActionRequestSchema` und in `runAction` stehen. Fehlt eine davon, schlägt die Aktion fehl (fail-safe).
- **Sicherheit beim Kopieren:** Es werden keine Secret-Werte, Env-Werte, Tokens, Server-URLs oder kubeconfig-Inhalte kopiert. kubectl-Befehle enthalten nur Namespace, Namen, Container und Labels, jeweils gegen `KUBE_NAME`, `LABEL_KEY` und `LABEL_VALUE` geprüft.
- **Shell:** Eine Shell startet nur nach ausdrücklichem Klick (das Menü „armt“ sie wie die Taste `s`). Das Dock-Terminal bekommt kein Kontextmenü, dort bleibt Rechtsklick = Einfügen.
- **Ohne Status:** Fehlt der Status (`null`), gilt der Cluster als readOnly, als Produktion und als nicht verbunden.
- **Begründungstexte**, exakt so zu verwenden:
  - „Der Cluster ist gerade nicht verbunden.“
  - „Wähle zuerst eine Zeile.“
  - „Nur für Pods und Jobs.“
  - „Nur für Nodes.“
  - „Nur für CronJobs.“
  - „Nur für Deployments, StatefulSets und DaemonSets.“
  - „Nur für Deployments und StatefulSets.“
  - „Name enthält ungültige Zeichen.“
  - „Hier lässt sich kein Tab öffnen.“
  - „Der Pod läuft nicht.“
- **Befehle:** `npm test`, `npm run typecheck`, Einzeltest mit `npx vitest run <pfad>`.
- **Branch und Commits:** Branch `claude/feature/kubernetes-context-menus`. Agenten committen nicht und führen kein `git add` aus. Der Orchestrator committet pro Task im Format aus `~/.claude/CLAUDE.md`, ohne Co-Authored-By-Zeile.

## Review Focus

1. **Rechtsklick auf eine nicht ausgewählte Zeile:** Das Menü muss mit der angeklickten Zeile arbeiten, nicht mit der alten Auswahl. Test in Task 7 über eine reine Hilfsfunktion.
2. **Problem-Eintrag auf einen Pod, der nicht im aktuellen Reiter oder Namespace liegt:** „Pod löschen…“ muss genau dieses Ref bestätigen und löschen. Test in Task 2.
3. **Pod mit mehreren Containern:** Logs und Shell aus der Zeile nutzen den ersten Container. Das Dock-Menü erlaubt die Container-Wahl, ohne dass ein Drill-down nötig ist. Tests in Tasks 2 und 5.
4. **CronJob-Name nahe 52 Zeichen:** Der Job-Name von „Jetzt ausführen“ ist höchstens 63 Zeichen lang, entspricht DNS-1123 und endet nicht auf `-`. Test in Task 4.
5. **`Shift+F10` gegenüber `S` und `Ctrl+Shift+T`:** Alle drei Bindings bleiben eindeutig. Test in Task 1.

## Bindende Korrekturen aus der Opus-Validierung

`docs/superpowers/specs/2026-10-16-kubernetes-context-menus-validation.md` ist **bindend**. Ihre Blocker B1–B5 und Korrekturen C1–C34
gehen dem Text dieses Plans und der Spec vor. Wo die Validierung eine „Entscheidung“ nennt, gilt diese. Die Abschnitte „Nice-to-have“ dort werden **nicht** umgesetzt.
Jeder Task liest die Punkte, die seine Dateien betreffen:

| Task | Pflichtpunkte aus der Validierung |
|---|---|
| 1 (+ 6) | B5, C1, C2, C3, C4, C5, C19, C31 (Task 6 läuft im selben Auftrag wie Task 1, damit `Record<KubeAction, …>` typprüft) |
| 3 | C21 |
| 4 | B3 (FakeApi in overview/session/watch-Tests ergänzen), B4, C19, C20 |
| 4b (neu) | B1, C25: `src/main/kubernetes/rows.ts` + `rows.test.ts` |
| 5 | C6, C9, C10, C11 |
| 9a | C24 |
| 2 | C7, C8, C13, C14, C21, C26, C27, C28, C29, C33, C18 (Testlücken) |
| 8 | C12, C17; alle neuen Props optional |
| 7 (+ 9b-Verdrahtung) | B2, C12, C13, C15, C16, C17, C23, C34; 9b-Verdrahtung in `SplitTerminalArea.tsx` gehört zu Task 7, App.tsx bleibt unverändert |
| 9b (nur VaultTree) | C32 |
| 10 | C22 (Doku-Formulierung), C30 (Spec-Namen angleichen) |

### Wellen (ersetzt die Tabelle oben)

| Welle | Tasks |
|---|---|
| 1 | Task 1 + Task 6 (ein Auftrag) |
| 2 | Tasks 3, 4, 4b, 5, 9a parallel |
| 3 | Task 2 |
| 4 | Task 8 und 9b (VaultTree) parallel |
| 5 | Task 7 inklusive Verdrahtung in SplitTerminalArea |
| 6 | Task 10 |

---

## Wellen (ursprünglich, ersetzt)

| Welle | Tasks |
|---|---|
| 1 | Task 1 (Vertrag) |
| 2 | Tasks 3, 4, 5, 6, 9a parallel |
| 3 | Task 2 (Menümodell) |
| 4 | Tasks 7, 8, 9b parallel |
| 5 | Task 10 (Doku) |

---

### Task 1: Gemeinsamer Vertrag und ref-basierte Verfügbarkeit

**Files:** `src/shared/kubernetes.ts`, `src/shared/kubernetes-schema.ts` (+ Test), `src/renderer/src/kube-commands.ts` (+ Test)

**Produces (exakt):**

```ts
// src/shared/kubernetes.ts
export type KubeAction = 'restart' | 'scale' | 'delete' | 'cordon' | 'uncordon' | 'suspend' | 'resume' | 'trigger';
export const ACTION_KINDS: Record<KubeAction, KubeKind[]> = {
  restart: ['deployments', 'statefulsets', 'daemonsets'], scale: ['deployments', 'statefulsets'], delete: ['pods', 'jobs'],
  cordon: ['nodes'], uncordon: ['nodes'], suspend: ['cronjobs'], resume: ['cronjobs'], trigger: ['cronjobs'],
};
/** Kinds without namespace that actions may target. */
export const CLUSTER_SCOPED_ACTIONS: KubeAction[] = ['cordon', 'uncordon'];
export const NOT_CONNECTED_MESSAGE = 'Der Cluster ist gerade nicht verbunden.';
// KubeRow additions (all optional):
//   owner?: KubeRef                 — pods: Deployment (via ReplicaSet), StatefulSet, DaemonSet, Job; jobs: CronJob
//   ip?: string                     — pods: status.podIP; nodes: InternalIP
//   suspended?: boolean             — cronjobs
//   unschedulable?: boolean         — nodes
//   involved?: { kind: string; name: string; ref?: KubeRef }  — events; ref only when the kind maps to a KubeKind
// NodeTile addition: ip?: string
/** Name of a job started by hand from a CronJob: `<cron>-manual-<unix>`, cut to 63 chars, DNS-1123, never ending in '-'. */
export function manualJobName(cron: string, unix: number): string;
```

`KubeActionRequestSchema.action` → `z.enum(['restart','scale','delete','cordon','uncordon','suspend','resume','trigger'])`. `KubeRefSchema` bleibt.

```ts
// src/renderer/src/kube-commands.ts
export interface ActionContext { ref: KubeRef | null; readOnly: boolean; connected: boolean }
/** Undefined when the action may run on ref; otherwise the German reason. Order: readOnly, connected, ref, kind. */
export function actionReason(action: KubeAction, context: ActionContext): string | undefined;
```

- Die bestehenden `unavailable`-Funktionen für restart, scale und delete rufen `actionReason` mit der ausgewählten Zeile auf. Die Zeile wird über `visibleRows` und `selected` gefunden, im Container-Modus über `containersOf`.
- `connected` ist `state.status?.state === 'ready'`.
- Bei delete heißt der Kind-Text jetzt „Nur für Pods und Jobs.“. Den bestehenden Test entsprechend anpassen.
- Neuer Registry-Eintrag: `{ id: 'menu', group: 'Navigation', description: 'Kontextmenü der Zeile öffnen', keys: ['Shift+F10'], bindings: ['Shift+F10', 'ContextMenu'] }`. `CommandId` um `'menu'` erweitern.
- `bindingOf`: Shift bleibt erhalten, wenn `key.length > 1` ist (Beispiel `Shift+F10`). Einzelzeichen bleiben wie bisher: `S` bleibt `S`, `Ctrl+Shift+T` bleibt `Ctrl+Shift+T`.
- Tests:
  - `manualJobName`: kurzer Name, 60-Zeichen-Name, Ergebnis passt auf `KUBE_NAME`, kein `-` am Ende.
  - `actionReason` für alle 8 Aktionen: readOnly zuerst, dann nicht verbunden, dann keine Zeile, dann falsches Kind.
  - `bindingOf` ergibt `'Shift+F10'`, `'S'` und `'Ctrl+Shift+T'`.
  - Keine Bindung ist doppelt vergeben, auch nicht mit `menu`.
  - Schema akzeptiert `cordon`/`trigger` und lehnt `drain` ab.

---

### Task 2: Menümodell `kube-menus.ts` (Welle 3)

**Files:** `src/renderer/src/kube-menus.ts`, `src/renderer/src/kube-menus.test.ts`

**Consumes:** `actionReason`, `KUBE_COMMANDS` (Hotkey-Hints über `keys`), Builder aus Task 3, `KubeViewAction` inklusive `openQuery`/`sortBy`/`selectContainer` aus Task 5, `KubeRow`-Felder aus Task 1.

**Produces (exakt):**

```ts
export type MenuTarget =
  | { type: 'row'; row: KubeRow }
  | { type: 'container'; pod: KubeRow; name: string }
  | { type: 'node'; tile: NodeTile }
  | { type: 'problem'; problem: KubeProblem }
  | { type: 'dock'; mode: DockMode; pod: KubeRow | null; container: string | null; previous: boolean }
  | { type: 'dockText'; mode: 'yaml' | 'describe'; text: string; selection: string }
  | { type: 'dockEvent'; row: KubeRow }
  | { type: 'header'; column: ColumnInfo }
  | { type: 'background' };
export type MenuAction =
  | { type: 'view'; actions: KubeViewAction[]; previous?: boolean; armShell?: boolean }
  | { type: 'copy'; text: string; label: string }
  | { type: 'kubeAction'; ref: KubeRef; action: KubeAction; currentReplicas?: number }
  | { type: 'popout'; target: KubeTerminalTarget }
  | { type: 'ssh'; connectionId: string }
  | { type: 'dockReload' }
  | { type: 'help' };
export type MenuEntry =
  | { kind: 'item'; id: string; label: string; hint?: string; disabled?: boolean; run: MenuAction }
  | { kind: 'heading'; label: string }
  | { kind: 'separator' };
export interface MenuContext {
  state: KubeViewState;
  status: ClusterStatus | null;
  canPopout: boolean;
  /** SSH connection in the vault for a node, see kube-ssh.ts. */
  sshForNode: (node: { name: string; ip?: string }) => { id: string; name: string } | undefined;
}
export function menuFor(target: MenuTarget, context: MenuContext): MenuEntry[];
```

- Inhalt, Reihenfolge, Labels, Hints und Verfügbarkeit stehen in den Tabellen A1–A8, B, C, D, H, I, J, K der Spec. Diese Tabellen sind bindend.
- Ausnahme A6: „URL im Browser öffnen“ entfällt.
- Ein deaktivierter Eintrag hat `disabled: true` und als `hint` die Begründung. Ein aktiver Eintrag hat als `hint` den Hotkey aus `KUBE_COMMANDS[...].keys[0]`, falls es einen gibt.
- Verändernde Einträge enden auf „…“, sind immer `kubeAction` und prüfen ihre Verfügbarkeit über `actionReason`. Bei Ref-Zielen (Problem, Node-Kachel) ist das Ref des Ziels gemeint, nicht die Auswahl.
- Leere Gruppen fallen weg, ebenso doppelte und randständige Trenner.
- Kopieren: Die Gruppe beginnt mit `heading` „Kopieren“. Gibt ein Builder `null` zurück, ist der Eintrag deaktiviert mit „Name enthält ungültige Zeichen.“.
- Argo: Trägt die Zeile das Label `argocd.argoproj.io/instance`, steht ganz oben `heading` „Argo CD: App <wert>“, und unter Kopieren kommt „Argo-App-Name“ hinzu.
- Tests decken jede Spec-Tabelle mit mindestens einem Fixture ab:
  - laufender Pod mit zwei Containern, Completed-Pod, Pod mit Owner, Deployment mit Argo-Label, DaemonSet
  - Job mit und ohne Selector, CronJob angehalten und nicht angehalten, Service ohne Selector, Ingress
  - Node mit unschedulable und mit und ohne SSH-Treffer, Event mit ReplicaSet und Event mit Pod
  - Container-Ziel, Node-Kachel, jedes `problem.kind`, Dock (Logs, Shell), dockText, Header, Background
  - jeweils unter readOnly, nicht verbunden, Status `null` und Produktion
- Außerdem wird geprüft: Kein Eintrag mit `kubeAction` ist aktiv, wenn `actionReason` eine Begründung liefert. Kein Kopiertext enthält Leerzeichen-Injektionen wie `;`, `|`, `$`, Backtick oder `&`.

---

### Task 3: kubectl- und Kopier-Builder (Welle 2)

**Files:** `src/renderer/src/kube-kubectl.ts`, `src/renderer/src/kube-kubectl.test.ts`

**Produces:** Alle Funktionen sind rein und geben `string | null` zurück. `null` bedeutet, dass ein Name nicht gültig ist.

```ts
logs(ns, pod, container?, previous = false)   // kubectl -n shop logs -f api-1 -c api | previous: kubectl -n shop logs --previous api-1 -c api
exec(ns, pod, container?)                     // kubectl -n shop exec -it api-1 -c api -- sh
describe(kind: KubeKind, ns: string | undefined, name)   // kubectl -n shop describe pod api-1 | nodes: kubectl describe node worker1
getYaml(kind, ns, name)                       // kubectl -n shop get deployment api -o yaml
rolloutRestart(kind, ns, name) / rolloutStatus(kind, ns, name)
scale(kind, ns, name, replicas)               // kubectl -n shop scale deployment api --replicas=3
logsJob(ns, name)                             // kubectl -n shop logs job/name
createJobFromCron(ns, cron, unix: number)     // kubectl -n shop create job --from=cronjob/backup backup-manual-1792131952
patchSuspend(ns, cron, suspend: boolean)      // kubectl -n shop patch cronjob backup -p '{"spec":{"suspend":true}}'
cordon(node) / uncordon(node) / drain(node)   // drain: kubectl drain worker1 --ignore-daemonsets --delete-emptydir-data
portForward(ns, service, port: number)        // kubectl -n shop port-forward svc/web 8080:8080
serviceDns(ns, service)                       // web.shop.svc.cluster.local
labelsText(labels)                            // one k=v per line, sorted; null if any key/value invalid
selectorText(selector)                        // app=api,tier=web
```

- Die Singular-Namen für die Kind-Argumente kommen aus `KIND_INFO[kind].kind.toLowerCase()`.
- Tests: jeder Builder; `null` bei Großbuchstaben, `;` und Leerzeichen.
- `createJobFromCron` nutzt `manualJobName` aus `src/shared/kubernetes.ts` (Task 1). Main importiert nie aus dem Renderer.

---

### Task 4: Main – neue Aktionen und API (Welle 2)

**Files:** `src/main/kubernetes/actions.ts` (+ Test), `src/main/kubernetes/api.ts`, `src/main/kubernetes/client-api.ts` (+ Test)

- `KubeApi.remove(ref, options?: { propagationPolicy?: 'Background' | 'Foreground' | 'Orphan' })`. Jobs werden immer mit `'Background'` gelöscht.
- `KubeApi.createJobFrom(cron: KubeRef, jobName: string): Promise<void>`:
  - liest den CronJob
  - erzeugt `batch/v1` Job `{ metadata: { name: jobName, namespace, labels: jobTemplate.metadata.labels, annotations: { ...jobTemplate.metadata.annotations, 'cronjob.kubernetes.io/instantiate': 'manual' }, ownerReferences: [{ apiVersion: 'batch/v1', kind: 'CronJob', name, uid, controller: true, blockOwnerDeletion: true }] }, spec: jobTemplate.spec }`
  - Fehler laufen über `toApiError`
- `runAction`:
  - prüft weiterhin readOnly zuerst, dann `ACTION_KINDS`
  - Namespace ist Pflicht, außer bei `CLUSTER_SCOPED_ACTIONS`
  - cordon/uncordon: `mergePatch(ref, { spec: { unschedulable: true|false } })`
  - suspend/resume: `mergePatch(ref, { spec: { suspend: true|false } })`
  - trigger: `createJobFrom(ref, manualJobName(ref.name, unix(now)))`
  - delete bei jobs: `remove(ref, { propagationPolicy: 'Background' })`, bei pods unverändert `remove(ref)`
- Tests: jede Aktion, readOnly lehnt ohne API-Aufruf ab, falsches Kind wird abgelehnt, Nodes ohne Namespace sind erlaubt, Pods ohne Namespace weiter abgelehnt. Für `createJobFrom` den Body prüfen (Fake-Client per Injection oder über einen reinen Body-Builder `manualJobBody(cron, jobName)`, exportieren und testen).

---

### Task 5: Reducer-Ergänzungen (Welle 2)

**Files:** `src/renderer/src/kube-view.ts` (+ Test)

```ts
| { type: 'openQuery'; query: KubeQuery; crumb: string }       // push current query as crumb, switch to query, select null
| { type: 'sortBy'; sort: { key: string; descending: boolean } | null }
// selectContainer now also works without containersOf: sets `container` for the selected pod row.
// `container` resets to null when the selection changes (select/move/jump/setKind/setNamespace/drill/back).
```

- `ClusterView` nutzt `state.container ?? selectedRow.containers[0]`. Das ist Sache von Task 7, Task 5 dokumentiert es nur im Report.
- Tests: `openQuery` mit anschließendem `back`, `sortBy(null)` stellt die Reihenfolge des Eintreffens wieder her, `selectContainer` ohne Drill-down, Reset beim Auswahlwechsel.

---

### Task 6: Bestätigungstexte (Welle 2)

**Files:** `src/renderer/src/confirm-action.ts` (+ Test)

| Aktion | Titel | Body | Knopf |
|---|---|---|---|
| delete bei jobs | „Job löschen?“ | „Job <name> im Namespace <ns> auf <cluster> und seine Pods werden gelöscht.“ | „Löschen“ |
| cordon | „Node sperren?“ | „Auf Node <name> auf <cluster> werden keine neuen Pods mehr geplant. Laufende Pods bleiben.“ | „Sperren“ |
| uncordon | „Node freigeben?“ | „Node <name> auf <cluster> nimmt wieder neue Pods an.“ | „Freigeben“ |
| suspend | „CronJob anhalten?“ | „CronJob <name> im Namespace <ns> auf <cluster> startet keine neuen Jobs mehr.“ | „Anhalten“ |
| resume | „CronJob fortsetzen?“ | „CronJob <name> im Namespace <ns> auf <cluster> startet wieder nach Zeitplan.“ | „Fortsetzen“ |
| trigger | „CronJob jetzt ausführen?“ | „Aus CronJob <name> im Namespace <ns> auf <cluster> wird sofort ein Job gestartet.“ | „Ausführen“ |

- Bei Produktion gilt `requireTyping = ref.name`, wie bei den bestehenden Aktionen.
- Tests: jede Zeile der Tabelle, Produktion an und aus.

---

### Task 7: Verdrahtung in ClusterView und ResourceTable (Welle 4)

**Files:** `src/renderer/src/components/kubernetes/ClusterView.tsx`, `ResourceTable.tsx`, neu `src/renderer/src/kube-menu-run.ts` (+ Test)

Menü-Zustand in `ClusterView`: `{ x, y, target } | null`. Mit `ContextMenu.tsx` gerendert, Abbildung `MenuEntry` → `ContextMenuEntry`. Gesperrt, solange Hilfe oder Bestätigung offen ist.

**`kube-menu-run.ts`** ist rein und testbar:

```ts
export function rowMenuTarget(row: KubeRow): MenuTarget;  // Rechtsklick nutzt die angeklickte Zeile, nicht state.selected
export interface MenuRunner {
  dispatch(a: KubeViewAction): void; setPrevious(v: boolean): void; arm(): void; copy(text: string, label: string): void;
  confirm(ref: KubeRef, action: KubeAction, currentReplicas?: number): void; popout(t: KubeTerminalTarget): void;
  ssh(id: string): void; reloadDock(): void; help(): void;
}
export function runMenuAction(action: MenuAction, runner: MenuRunner): void;
```

- Test: Jede `MenuAction` ruft genau die passende Runner-Methode auf. `kubeAction` ruft nur `confirm` auf, niemals direkt eine Aktion.

**ResourceTable:**
- Rechtsklick auf eine Zeile wählt sie aus und meldet danach `onMenu({type:'row', row}, x, y)`.
- Container-Zeilen: `selectContainer`, danach `onMenu({type:'container'…})`.
- Tabellenkopf: `header`. Leere Fläche: `background`.
- Auf Breadcrumb, Namespace-Auswahl und Reitern nur `preventDefault`, ohne Menü.
- Die Tastatur-Befehle `menu` (`Shift+F10`/`ContextMenu`) öffnen das Menü der ausgewählten Zeile, verankert an `rect.left + 24, rect.bottom`.

**ClusterView:**
- `copy` nutzt `window.desktopApi.writeClipboardText`, danach `say('Kopiert: …')` (Text auf 60 Zeichen gekürzt) bzw. „Kopieren fehlgeschlagen.“.
- `confirm` setzt `pending` mit Ref, Aktion und `currentReplicas`. Dafür `PendingAction` und `ConfirmAction` so erweitern, dass sie jede `KubeAction` darstellen. Die Texte kommen aus `confirmationFor`.
- `reloadDock` zählt einen Zähler hoch, der zum `epoch` des Docks addiert wird. `dockTerminalKey` ignoriert `epoch` für die Shell bereits.
- Neue optionale Props `sshForNode` und `onOpenSsh(connectionId)`. Fehlen sie, liefert `sshForNode` `undefined`.
- Container-Wahl: `state.container ?? selectedRow.containers[0]`.

---

### Task 8: Weitere Flächen

**Files (Welle 4):** `NodeStrip.tsx`, `ProblemBanner.tsx`, `DetailDock.tsx`

- Jede Komponente bekommt die Prop `onMenu?: (target: MenuTarget, x: number, y: number) => void` und öffnet sie per Rechtsklick sowie per `Shift+F10`/`ContextMenu` auf dem fokussierten Button.
- Node-Kacheln und Problem-Einträge ändern beim Rechtsklick die Auswahl nicht.
- DetailDock:
  - `onContextMenu` nur auf `.kube-dock-bar` (Ziel `dock`) und auf `pre.kube-manifest` (Ziel `dockText` mit `window.getSelection()?.toString() ?? ''`)
  - Zeilen der Events-Tabelle melden `dockEvent`
  - **niemals** ein Handler auf `.kube-dock-terminal`

---

### Task 9: SSH zur Node und Vault-Baum

**9a (Welle 2) Files:** `src/renderer/src/kube-ssh.ts` (+ Test)

`export function sshConnectionForNode(nodes: VaultNode[], node: { name: string; ip?: string }): { id: string; name: string } | undefined`:
- nur aktive SSH-Verbindungen
- ein Treffer bei `host` = Node-Name, bei `host` = IP, bei `name` = Node-Name oder bei `name` = Kurzname (Präfix bis zum letzten `-`, z. B. `worker2` für `k8s-worker2`, und umgekehrt)
- es zählt der erste Treffer in Baum-Reihenfolge, Groß- und Kleinschreibung spielen keine Rolle

**9b (Welle 4) Files:** `src/renderer/src/App.tsx`, `src/renderer/src/components/SplitTerminalArea.tsx`, `src/renderer/src/components/VaultTree.tsx`

- App reicht `sshForNode={node => sshConnectionForNode(vault.nodes, node)}` und `onOpenSsh={id => terminals.open(toTerminalConnection(findNode(id)))}` über `SplitTerminalArea` an `ClusterView` durch. Die Props von SplitTerminalArea sind optional, SecondaryWindow übergibt sie nicht.
- VaultTree: Ein Cluster-Eintrag bekommt den Menüpunkt „Zugangs-Host per SSH öffnen“. Als `hint` dient der Name des ersten aktiven `accessHosts`. Gibt es keinen, ist der Eintrag deaktiviert mit „Kein aktiver Zugangs-Host.“. Er ruft `onConnect(id)` der SSH-Verbindung auf.

---

### Task 10: Doku (Welle 5)

**Files:** `README.md`, `CHANGELOG.md`, `package.json` (Version `0.6.0` über `npm run version:minor`)

- README, Abschnitt Kubernetes, neuer Absatz „Kontextmenüs“: Rechtsklick und `Shift+F10`, Kopieren, Sprünge, SSH zur Node, die neuen Aktionen mit Bestätigung, drain nur als kopierbarer Befehl.
- CHANGELOG: Eintrag `0.6.0`.
- Prüfen: `npm run check:version`, `npm test`, `npm run typecheck`.
