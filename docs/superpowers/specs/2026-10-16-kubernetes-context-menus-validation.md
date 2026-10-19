# Validation: Kubernetes-Kontextmenüs (Spec + Plan vs. Code)

Stand: 2026-10-16 · Geprüft: `docs/superpowers/specs/2026-10-16-kubernetes-context-menus-design.md`, `docs/superpowers/plans/2026-10-16-kubernetes-context-menus.md`,
Parent-Spec, und der Code auf `claude/feature/kubernetes-context-menus` (efd8556).

**Verdict: ready after corrections.** 5 Blockers, 34 Corrections (C1–C34; C25 verweist nur auf B1, C18 sammelt die Testlücken), 10 Nice-to-have.

---

## Blockers (vor der Implementierung im Plan beheben)

### B1 · Kein Task baut die neuen Zeilenfelder in `rows.ts`
Task 1 deklariert nur die Typen `owner`, `ip`, `suspended`, `unschedulable`, `involved` und `NodeTile.ip`. Kein Task ändert
`src/main/kubernetes/rows.ts` (`toRow`, `toNodeTile`) oder `rows.test.ts`. Task 2, die Spec-Tabellen A1, A3, A4, A7, A8 und C sowie der
Abschnitt Tests der Spec (`rows.test.ts`) brauchen diese Felder aber.

**Fix:** Neuer **Task 4b (Welle 2)**. Files: `src/main/kubernetes/rows.ts`, `src/main/kubernetes/rows.test.ts`. Regeln (exakt):
- `owner` (Pods): nimm die ownerReference mit `controller: true`.
  - `ReplicaSet` → `{ kind: 'deployments', namespace, name: rsName ohne '-<hash>' }`, aber nur wenn `labels['pod-template-hash']` gesetzt ist und `rsName.endsWith('-' + hash)`. Sonst gibt es kein Owner-Feld.
  - `StatefulSet` / `DaemonSet` / `Job` → entsprechender KubeKind, Namespace des Pods.
  - `Node` (statische Pods) → `{ kind: 'nodes', name }` **ohne** Namespace.
  - Jedes andere Kind → kein Owner-Feld.
- `owner` (Jobs): Controller-Ref `CronJob` → `{ kind: 'cronjobs', namespace, name }`.
- `ip`: bei Pods `status.podIP`, bei Nodes die erste Adresse `status.addresses[type=InternalIP].address`. `toNodeTile` setzt `ip` genauso.
- `suspended`: bei CronJobs `spec.suspend === true`.
- `unschedulable`: bei Nodes `facts.unschedulable`.
- `involved` (Events):
  - `kind` und `name` aus `involvedObject`.
  - `ref` nur, wenn es einen KubeKind `k` mit `KIND_INFO[k].kind === involvedObject.kind` gibt.
  - `ref.namespace = involvedObject.namespace || event.metadata.namespace`, aber **nur wenn `KIND_INFO[k].namespaced`**. Node-Events liegen in `default`. Mit Namespace wäre `refKey` = `nodes/default/x` und würde keine Zeile treffen (`kube-view.ts:83-84`, `refKey`).
- Tests: alle obigen Fälle, auch RS-Name ohne passenden Hash, Node-Event ohne Namespace und `toNodeTile` mit IP.

### B2 · Tastatur im Menü läuft in die Hotkeys von ClusterView
`ContextMenu.tsx:45-46` ruft `preventDefault` auf, aber nicht `stopPropagation`. Wird das Menü irgendwo im React-Baum von `ClusterView` gerendert (auch per Portal), landet jedes keydown in `ClusterView.onKeyDown` (`ClusterView.tsx:183-203`). Dort prüft der Handler nur `modal = help || pending !== null` (`:52`). Folgen:
- `ArrowDown`/`ArrowUp` bewegen zusätzlich die Tabellenauswahl.
- `Escape` schließt das Menü und führt zusätzlich `back` aus.
- `Enter` auf einem Menüeintrag wird zu `drill`. Weil der Handler `event.preventDefault()` aufruft, wird der Klick auf den Button unterdrückt. **Mit Enter lässt sich also kein Eintrag wählen.**

**Fix (Task 7):** `const modal = help || pending !== null || menu !== null;`. Zusätzlich am Anfang von `onKeyDown`: `if ((event.target as HTMLElement).closest?.('.context-menu')) return;`. Weil `modal` dann das Menü einschließt, gibt der vorhandene Fokus-Effekt (`:73-78`) den Fokus beim Schließen an die Tabelle zurück. Sonst wäre der Fokus nach dem Schließen auf `body` und kein Hotkey ginge mehr. Das muss der Plan ausdrücklich sagen.

### B3 · Die Wellen brechen `npm run typecheck` zwischen den Commits
- **Welle 1:** Task 1 erweitert `KubeAction` (`shared/kubernetes.ts:129`). `confirm-action.ts:6-7` hat `TITLES`/`LABELS: Record<KubeAction, string>`, die web-Typprüfung schlägt also bis Task 6 fehl. **Fix:** Task 1 fügt Platzhalter-Einträge in `TITLES`/`LABELS` ein, oder Task 6 kommt in Welle 1 (nach Task 1, gleiche Welle wie der Vertrag).
- **Welle 2:** Task 4 erweitert das Interface `KubeApi` (`createJobFrom`, `remove(ref, options?)`). `tsconfig.node.json` schließt `src/main/**/*.ts` ein, also auch die Tests. `class FakeApi implements KubeApi` in `overview.test.ts:38`, `session.test.ts:67` und `watch.test.ts:16` kompilieren dann nicht mehr. **Fix:** Diese drei Dateien in die Files von Task 4 aufnehmen (`createJobFrom(): never { throw new Error('unused'); }`, bei session.test eine aufzeichnende Variante).
- **Welle 4:** Task 7 (ClusterView übergibt `onMenu` an NodeStrip/ProblemBanner/DetailDock und `podRow` an DetailDock, siehe C12), Task 8 (fügt diese Props hinzu) und Task 9b (SplitTerminalArea übergibt `sshForNode`/`onOpenSsh` an ClusterView, die Task 7 hinzufügt) hängen gegenseitig voneinander ab. **Fix:**
  - Welle 4 = Task 8 + VaultTree-Teil von 9b
  - Welle 5 = Task 7
  - Welle 6 = Verdrahtung in SplitTerminalArea aus 9b (siehe C23)
  - Welle 7 = Task 10

### B4 · `runAction` ist nicht fail-safe, wie der Plan behauptet
`actions.ts:18-35`: Der `switch` hat keinen `default`. Steht eine Aktion in `ACTION_KINDS` und im zod-Enum, aber ohne `case`, kehrt `runAction` ohne Fehler zurück. Die UI meldet dann Erfolg, obwohl nichts passiert ist. Genau das passiert zwischen Welle 1 und Task 4 für `suspend`/`resume`/`trigger`. Die Zeile im Plan „Fehlt eine davon, schlägt die Aktion fehl“ stimmt also nicht.

**Fix (Task 4):** `default: { const unknown: never = action; throw new Error('Diese Aktion ist hier nicht möglich.'); }`. Test: ein Cast `'drain' as KubeAction` wirft den Fehler.

### B5 · `manualJobName` – „auf 63 Zeichen kürzen“ schneidet den Zeitstempel ab
Ein CronJob-Name darf bis 52 Zeichen lang sein. Dazu kommen `-manual-` (8) und Unix-Sekunden (10), zusammen 70 Zeichen. Kürzt man das Ende, fällt der Zeitstempel weg. Jeder Auslöser erzeugt dann denselben Namen (409 ab dem zweiten Mal), und die Prüfung „endet nicht auf `-`“ bleibt Zufall.

**Fix (Task 1, exakter Text):** „`suffix = '-manual-' + unix`; `prefix = cron.slice(0, 63 - suffix.length).replace(/[-.]+$/, '')`; Ergebnis `prefix + suffix`. Der Suffix bleibt immer vollständig erhalten.“ Tests:
- 52 Zeichen langer Name, der an der Schnittstelle auf `-` endet
- Länge ≤ 63
- passt auf `KUBE_NAME`
- endet auf `-manual-<unix>`
- zwei verschiedene `unix` ergeben zwei verschiedene Namen

---

## Corrections (Entscheidung bzw. Ersatztext je Punkt)

### Vertrag und Verfügbarkeit (Task 1)

**C1 · Reihenfolge in `actionReason` bricht die Hilfe und einen bestehenden Test.** Der Plan legt die Reihenfolge readOnly → connected → ref → kind fest. Heute gilt readOnly → kind (aus `query.kind`) → Auswahl (`kube-commands.ts:28-33`). Mit der neuen Reihenfolge würde die Hilfe im Pods-Reiter für `r` „Wähle zuerst eine Zeile.“ zeigen statt „Nur für Deployments, …“. Außerdem kommt `kube-commands.test.ts:32` (Status `null`) jetzt bei „nicht verbunden“ heraus. **Ersatztext:**
```ts
export interface ActionContext { ref: KubeRef | null; readOnly: boolean; connected: boolean; /** Kind of the current table, used when ref is null. */ kind?: KubeKind }
/** Order: readOnly, connected, kind (ref.kind, else context.kind), ref. */
```
- Der Registry-Wrapper übergibt `kind: state.containersOf ? 'pods' : state.query.kind`.
- Bestehende Tests: Fixtures bekommen `status: { state: 'ready', … }`. Neu dazu kommt ein Test „ohne Status → readOnly-Text zuerst, sonst nicht verbunden“.

**C2 · Job löschen per Hotkey.** Mit `ACTION_KINDS.delete = ['pods','jobs']` löschen `Ctrl+d` und `:delete` ab Task 1 auch Jobs. Laut Spec A3 hat der Eintrag aber keinen Hotkey („–“). **Entscheidung:** erlaubt, weil Erfolgskriterium 3 dieselbe Verfügbarkeit fordert.
- Registry: `description: 'Pod oder Job löschen'`.
- A3: Hotkey `Ctrl+d`.
- `ParsedCommand`/`:delete` bleiben unverändert.

**C3 · Shell bei Pods, die nicht laufen.** Der Menüeintrag ist mit „Der Pod läuft nicht.“ deaktiviert, die Taste `s` prüft das aber nicht (`kube-commands.ts:51-52`). Das widerspricht Erfolgskriterium 3. **Entscheidung:** Nicht laufend heißt `row.cells.status ∈ {'Completed','Terminating'}`, wie in der Spec. Der Registry-Eintrag `shell` prüft dieselbe Bedingung an der ausgewählten Pod-Zeile bzw. an `containersOf`. Eine gemeinsame Hilfsfunktion `podNotRunning(row)` in `kube-commands.ts` exportieren.

**C4 · „Nicht verbunden“ bei Ansicht-Einträgen.** Im Menü sind Ansicht und Terminal bei fehlender Verbindung deaktiviert, die Hotkeys `l/e/y/d` dagegen nicht. **Entscheidung:** Erfolgskriterium 3 gilt für verändernde Aktionen und Shell. Ersatztext in der Spec: „… nennen für dieselbe **verändernde Aktion und die Shell** immer dieselbe Verfügbarkeit …“. Dass Ansicht-Einträge im Menü bei getrennter Verbindung grau sind, ist eine bewusste Abweichung.

**C5 · Liste der Begründungstexte unvollständig.** Die Global Constraints sagen „exakt so“, es fehlen aber Texte aus der Spec. Ergänzen:
- „Dieser Job hat keinen Selector.“
- „Dieser Service hat keinen Selector, z. B. ExternalName.“
- „Dieser Workload hat keinen Selector.“ (siehe C6)
- „Keine SSH-Verbindung für <node> im Vault.“
- „Kein Filter gesetzt.“
- „Kein aktiver Zugangs-Host.“
- „Objekte vom Typ <Kind> zeigt Terminus nicht an.“ (Events → fremdes Kind; `<Kind>` = `involved.kind`)
- `READ_ONLY_MESSAGE` (Text steht in `shared/kubernetes.ts:9`)

**C19 · Cluster-weite Ziele.** Statt `CLUSTER_SCOPED_ACTIONS` am Kind prüfen: In `runAction` ist der Namespace genau dann Pflicht, wenn `KIND_INFO[ref.kind].namespaced` gilt. Bei Kinds ohne Namespace wird ein mitgeschickter Namespace abgelehnt. Diese Regel ist strenger und hängt nicht an einer zweiten Liste. `CLUSTER_SCOPED_ACTIONS` aus dem Vertrag streichen. Test: `{ kind:'nodes', name:'w1' }` cordon ok; `{ kind:'nodes', namespace:'x', name:'w1' }` abgelehnt; `{ kind:'pods', name:'a' }` delete abgelehnt.

### Reducer (Task 5)

**C6 · Leere Selector-Map lässt den Drill-down auf alle Pods springen.** `rows.ts:206` setzt `row.selector = labelMap(spec.selector)` bei Services immer, auch als `{}`. `workloadCells` (`:126`) macht es genauso. `drill()` prüft nur `!row.selector` (`kube-view.ts:211`), `{}` gilt also als vorhanden. Damit zeigt Enter alle Pods des Namespace. **Fix (Task 5):** `drill` gibt den Zustand unverändert zurück, wenn `Object.keys(row.selector ?? {}).length === 0`. Das Menü nutzt dieselbe Prüfung. Test dazu.

**C9 · CronJob „Jobs anzeigen“ mit Enter.** `drill()` tut bei CronJobs nichts (kein Selector), der Hint „Enter“ wäre also falsch. Außerdem leert `setKind` die Crumbs, der Crumb „CronJob <name>“ ginge so verloren. **Entscheidung:**
- Der Menüeintrag ist `view: [openQuery({ kind:'jobs', namespace: row.ref.namespace }, 'CronJob <name>'), filter(<name>)]`.
- `drill` bei CronJobs macht in Task 5 dasselbe (Crumb + Filter), dann stimmt der Hint `Enter`.
- Ist das nicht gewollt: Hint weglassen.

**C10 · `openQuery` genau festlegen (Task 5):**
`{ ...withQuery(state, action.query, [...state.crumbs, { label: action.crumb, query: state.query }]), filter: '' }`. Der Zustand `containersOf` wird dabei verlassen. `sort` bleibt; `visibleRows` ignoriert unbekannte Spalten. Test: `openQuery` → `back` stellt die alte Query wieder her.

**C11 · Container-Wahl.**
- Task 5 schreibt „selectContainer now also works without containersOf“. Das gilt schon heute (`kube-view.ts:88`). Neu ist nur der Reset.
- Reset nur bei **geändertem** Key: `select` mit demselben Key behält `container`. Auch wenn `keepSelection` die Auswahl verschiebt, wird zurückgesetzt.
- Ersatz für „ClusterView nutzt `state.container ?? selectedRow.containers[0]`“: neue reine Funktion in `kube-view.ts`: `export function dockContainer(podRow: KubeRow | null, chosen: string | null): string | null` → `chosen`, wenn es in `podRow.containers` vorkommt, sonst `podRow?.containers?.[0] ?? null`.
- `ClusterView.tsx:58` nutzt dann `dockContainer(podRow, state.container)`. Gemeint ist `podRow`, nicht `selectedRow`.
- Test in Task 5 (deckt Review Focus 3 ab).

### Menümodell (Task 2)

**C7 · Hint bei mehreren Containern.** Die Spec verlangt „hint zeigt `Container api`“, der Plan „hint = Hotkey“. **Entscheidung:** `hint = 'l · api'` (Hotkey · Containername), nur wenn der Pod mehr als einen Container hat. Gilt für Logs, Logs des vorherigen Containers, Shell und Als-Tab-Einträge in A1.

**C8 · Hotkey-Hints bei Zielen außerhalb der Auswahl.** Bei Problem (D), Node-Kachel (C) und den Sprung-Einträgen der Events (A8) wirkt der Hotkey auf die Auswahl, nicht auf das Ziel des Menüs. **Entscheidung:** Dort keine Hotkey-Hints. Hints gibt es nur für die Ziele `row`, `container` und `dock`. Die Hotkey-Spalten der Spec-Tabellen C, D und A8 entsprechend auf „–“ setzen.

**C13 · `MenuContext` braucht `now: number`** (Unix-Millisekunden). Damit baut `createJobFromCron` den Kopiertext und die Tests bleiben deterministisch. `menuFor` ruft nie `Date.now()` auf. ClusterView übergibt `Date.now()`, wenn das Menü öffnet. Dieser Wert wird im Menü-Zustand gespeichert, damit der Text beim Re-Render stabil bleibt.

**C14 · Menüs hängen nie von `state.selected` ab.**
- Bei `row`-Zielen beginnt jede `view`-Aktionsliste mit `{ type:'select', key: refKey(row.ref) }`.
- Bei `container`-Zielen beginnt sie mit `selectContainer(name)`. Bei Pods außerhalb des Drill-downs kommt vorher `select` der Pod-Zeile.
- `kubeAction.ref` ist immer `target.row.ref` bzw. `problem.ref` bzw. `{ kind:'nodes', name: tile.name }`.
- Test für Review Focus 1 in **Task 2**: `menuFor(row B)` bei `state.selected = A`. Der Test von `rowMenuTarget` in Task 7 ist trivial und deckt den Fokus nicht ab.

**C21 · Test auf Metazeichen zu breit.** Kopiertexte wie Meldung, Zeitplan (`*/5 * * * *`), Images, YAML und `patchSuspend` (`'{"spec":…}'`) enthalten legitim Sonderzeichen. **Ersatztext:** „Jeder Ausgabewert eines kubectl-Builders außer `patchSuspend` passt auf `/^kubectl( [-a-zA-Z0-9.\/=:,_]+)+$/`. `patchSuspend` ist bis auf `<ns>`/`<name>` ein fester Literal-String.“

**C26 · Hintergrund-Menü „Zurück zu <ns>“.** Den vorherigen Namespace hält der State nicht. **Entscheidung:** Bei `query.namespace === null` steht dort „Zurück zu `<status.namespace ?? 'default'>`“ (`setNamespace`), sonst „Alle Namespaces“. „Sortierung aufheben“ ist ohne `state.sort` deaktiviert, mit Hint „Standard: Reihenfolge des Eintreffens“.

**C27 · Node-Kachel und Problem `node`.**
- Kachel: Die erste Zeile ist immer eine `heading` `<name> · bereit|nicht bereit[, <pressure…>][, gesperrt]`.
- Problem `node`: Die IP für `sshForNode` stammt aus `state.nodes.find(tile => tile.name === problem.ref.name)?.ip`.

**C28 · Argo-Überschrift.** Sie gilt für alle Zeilen-Kinds, die das Label tragen, nicht nur für A2. Sie steht als erstes Element, danach folgt der normale erste Gruppen-Block (kein Separator direkt nach einer Überschrift). „Argo-App-Name“ ist der letzte Eintrag der Kopier-Gruppe.

**C29 · Menülänge.** „höchstens ~14 Einträge je Menü“ (Spec, Risiken) widerspricht A1 mit rund 24 Einträgen. **Entscheidung:** Die Tabellen sind bindend, die Faustregel aus der Spec wird gestrichen.

### Verdrahtung (Tasks 7 und 8)

**C12 · Ziel `dock` braucht eine `KubeRow`, DetailDock kennt aber nur `podRef`** (`DetailDock.tsx:31-34`). Der Eintrag „Container: <name>“ braucht `pod.containers`. **Fix:** Neue Prop `podRow: KubeRow | null` in DetailDock (Task 8). ClusterView übergibt `podRow` (Task 7). `dockText.text` stammt aus `currentResult.data.text`, die Daten liegen lokal in DetailDock. Das ist dort korrekt, im Plan aber so festzuhalten.

**C15 · `runner.confirm` prüft erneut.** Ein Menü kann offen bleiben, während Status oder readOnly wechseln. In ClusterView soll `confirm(ref, action, currentReplicas)` zuerst `actionReason(action, { ref, readOnly, connected })` prüfen. Liefert das eine Begründung, ruft es `say(reason)` auf und setzt `pending` nicht. Auch `startAction` (`ClusterView.tsx:113-123`) nutzt `actionReason` mit dem Ref der Auswahl (`containersOf ?? selectedRow`). `ContextMenuEntry.onSelect` bei `disabled` ist ein no-op.

**C16 · Race zwischen Scharfschalten und Auswahl.** `useEffect(() => setArmed(false), [selectedKey, container])` (`:70`) läuft **nach** einem Render, in dem Auswahl/Container wechseln und gleichzeitig `setArmed(true)` gesetzt wurde. Folge: Die Shell aus dem Menü schaltet sich sofort wieder ab, sobald `view.actions` die Auswahl tatsächlich ändern. **Entscheidung:** `armed` wird zu `armedFor: string | null` (`${refKey(podRef)}/${container}`). `armed = armedFor === aktueller Schlüssel`. `arm()` setzt den Schlüssel des Menü-Ziels. Der Effekt entfällt. Die Reconnect-Logik (`:96`) setzt `armedFor` auf `null`. Dadurch bleibt das Scharfschalten weiterhin nur per Klick möglich.

**C17 · `Shift+F10`/`ContextMenu`, genau festgelegt:**
- `runKey` `case 'menu'`: Ohne Auswahl `say('Wähle zuerst eine Zeile.')`. Im Container-Modus Ziel `container` (`containersOf`, `state.container`), verankert am `tr[aria-selected="true"]`. Sonst Ziel `row`, verankert an `.kube-row-selected` in `tableRef`. Fallback ist das Rechteck von `tableRef`.
- NodeStrip, ProblemBanner und die Dock-Leiste rufen in ihrem eigenen `onKeyDown` `event.preventDefault(); event.stopPropagation()` auf. Sonst öffnet das Bubbling zu `ClusterView.onKeyDown` zusätzlich das Zeilenmenü.
- Chromium kann nach der Taste zusätzlich ein natives `contextmenu`-Event auf das fokussierte Element (`.kube-table-focus`) schicken. Deshalb liegt der Hintergrund-Handler nur auf `.kube-table-scroll`. Handler ignorieren `contextmenu`, wenn `event.target === tableRef.current` gilt. In die manuelle Prüfung aufnehmen: beide Tasten auf Zeile, Kachel und Dock-Leiste, das Menü erscheint jeweils nur einmal.
- Kein `onContextMenu` auf `section.kube-view`, `.kube-dock` oder `.kube-dock-body`. Nur `.kube-dock-bar`, `pre.kube-manifest` und `table.kube-events tr`.

**C34 · Statusmeldung beim Kopieren.** Bei mehrzeiligem Text `Kopiert: <label>` statt der ersten 60 Zeichen. Bei einzeiligem Text bleibt es bei `Kopiert: <text, auf 60 Zeichen gekürzt>`.

### Main (Task 4)

**C20 · Aufrufe in client-node, genau:**
- `remove`: `objects().delete(headerOf(ref) as KubernetesObject, undefined, undefined, undefined, undefined, options?.propagationPolicy)`. Die Policy steht an Position 6 (`object.d.ts:72`).
- `create`: `objects().create(body, undefined, undefined, 'terminus')`.
- Reinen Builder `export function manualJobBody(cron: KubeObject, jobName: string): KubeObject` aus `client-api.ts` exportieren. Er wirft einen `KubeApiError` mit einer sicheren Meldung, wenn `metadata.uid` oder `spec.jobTemplate.spec` fehlt.
- Von `jobTemplate.metadata` werden nur `labels` und `annotations` übernommen. Fehlen sie, entfällt der Schlüssel. `namespace` kommt vom CronJob.
- Sonst nichts kopieren: kein resourceVersion, keine Felder des CronJobs.
- Ein Test mit dem vorhandenen Spy auf `makeApiClient` (`client-api.test.ts:279ff`) prüft die Argumente von `delete` und `create`.

**C22 · „Keine Env-Werte kopieren“ widerspricht K.** `describe.ts:62-64` gibt Klartext-Env-Werte aus. `toYaml` maskiert nur Secret-Objekte und last-applied. „YAML/Describe kopieren“ kopiert also Env-Werte. **Entscheidung:** erlaubt, weil es derselbe Text wie in der Anzeige ist. **Ersatztext** der Global Constraint: „Kein Eintrag kopiert gezielt Env-Werte, Secret-Werte, Tokens, Server-URLs oder kubeconfig-Inhalte. YAML/Describe kopieren genau den angezeigten, maskierten Text.“

**C25** ist Teil von B1 (Regeln für `owner`/`involved`).

**C31 · Bestätigungstexte (Task 6).** Der Titel hängt bei `delete` vom Kind ab, nicht nur von der Aktion. Für Pods bleiben Titel, Body und Knopf wörtlich wie heute (Test). Bei Nodes kommt `where` ohne „im Namespace -“ aus, die Tabelle hat dafür eigene Bodies.

### SSH und Vault-Baum (Tasks 9a und 9b)

**C23 · `onOpenSsh` umgeht die Schutzprüfungen von App.** Der Plan schreibt `terminals.open(toTerminalConnection(findNode(id)))`. Damit entfallen die Prüfungen in `connectNode` (`App.tsx:635-644`): deaktivierte Verbindung, `MAX_SSH_SESSIONS`, ungespeicherter Editor (`navigateEditor`). Außerdem hat `findNode` zwei Parameter. **Fix:** App bleibt unverändert. `SplitTerminalArea` hat schon `nodes` und `onConnect(connectionId, paneId)` (`SplitTerminalArea.tsx:28`). Beim Rendern von ClusterView (`:398`) übergibt es `sshForNode={node => sshConnectionForNode(nodes, node)}` und `onOpenSsh={id => onConnect(id, panel.id)}` (bzw. die Pane-ID dort). So funktioniert es auch in `SecondaryWindow.tsx:99`. Task 9b: Files = `SplitTerminalArea.tsx`, `VaultTree.tsx`; App.tsx entfällt.

**C24 · `sshConnectionForNode` mit Rang statt nur Baumreihenfolge.** Sonst schlägt ein Kurzname-Treffer weiter oben einen exakten Host-Treffer weiter unten. Das wäre eine SSH-Verbindung zum falschen Host. **Ersatztext:**
- Rang 1 `host` = IP, Rang 2 `host` = Node-Name, Rang 3 `name` = Node-Name, Rang 4 Kurzname.
- Kurzname heißt: der Teil nach dem letzten `-` des einen Namens ist gleich dem ganzen anderen Namen, mindestens 2 Zeichen lang.
- Innerhalb eines Rangs gilt der erste Treffer in Baumreihenfolge. Nur `protocol === 'ssh'` und `!disabled`. Groß- und Kleinschreibung spielen keine Rolle.
- Test: exakter Treffer weiter unten schlägt Kurzname weiter oben.

**C32 · Vault-Baum N.** `accessHosts` sind Verbindungs-IDs. Aufgelöst wird über `findNode`; es zählt die erste Verbindung mit `ssh` und `!disabled`. Der Text „Kein aktiver Zugangs-Host.“ aus dem Plan gilt; die Spec-Zeile „`NO_ACCESS_MESSAGE`-Logik“ wird ersetzt, denn `NO_ACCESS_MESSAGE` ist ein Formulartext. Der Eintrag ist unabhängig davon, ob der Cluster-Eintrag selbst deaktiviert ist.

**C33 · SSH-Einträge im Cluster-Tab** hängen nicht von readOnly oder „nicht verbunden“ ab, weil es keine Cluster-Aktion ist. Deaktiviert sind sie nur ohne Treffer oder ohne `onOpenSsh`. Die Begründung lautet dann „Hier lässt sich keine Verbindung öffnen.“ oder der Text aus C5.

### Spec an den Plan angleichen

**C30 · Spec und Plan weichen in drei Namen ab.** Der Plan gilt, die Spec wird angepasst:
- `involved?: { kind; name; ref? }` statt `involved?: KubeRef`
- `MenuAction` ohne `command(id)`
- `sortBy` statt erweitertem `sort`

Der Plan setzt die Spec in diesen drei Punkten ausdrücklich außer Kraft.

### Testlücken gegenüber dem Review Focus (als Ergänzung der Tasks)

**C18 (Testlücken):**
- RF1 → C14 (Test in Task 2).
- RF2 → Task 2: Fixture mit Zustand `deployments`/Namespace `other`. Problem-Pod in `shop` → „Pod löschen…“ ist aktiv mit `ref = problem.ref`. Task 7: `runMenuAction(kubeAction)` → `confirm(problem.ref, 'delete')`.
- RF3 → `dockContainer`-Test (C11) und Dock-Menü mit 2 Containern.
- RF4 → Tests aus B5. Dazu: `runAction` `trigger` nutzt `options.now`.
- Fehlt außerdem:
  - `runAction`: default wirft, uncordon patcht `unschedulable: false`, Job delete mit `'Background'`, Pod delete ohne Policy
  - Node-Ref mit Namespace wird abgelehnt
  - Pod-Body in confirm-action unverändert
  - `kube-ssh`: Ränge
  - `rows.test` (B1)
  - `bindingOf` für `ContextMenu` (ohne Shift) und `Shift+ContextMenu`

---

## Nice-to-have

1. `toApiError`: 409 auf „Ein Objekt mit diesem Namen gibt es schon.“ abbilden. Das ist bei „Jetzt ausführen“ zweimal in derselben Sekunde möglich.
2. `forbiddenMessage` (`client-api.ts:102-107`) erkennt nur Meldungen mit Namespace. Bei cordon (cluster-weit) kommt nur „Keine Berechtigung.“. Ein Muster ohne Namespace ergänzen.
3. `serviceDns` nimmt `cluster.local` an. In der Spec als Annahme festhalten.
4. Ingress-URLs: Wildcard-Hosts (`*.x`) auslassen.
5. Die Änderung an `bindingOf` macht `Shift+ArrowDown`/`Shift+Enter`/`Shift+Escape` unbelegt; vorher wirkten sie wie ohne Shift. Bewusst akzeptieren und testen.
6. „Markierung kopieren“ nur, wenn Anfang und Ende der Auswahl im `pre` liegen.
7. Parent-Spec anpassen: cordon wandert aus Stufe 3 vor (Zeile 36). Die Aktionstabelle (Zeile ~221) und `actions.ts` in der Komponententabelle nennen nur Restart/Scale/Delete.
8. Argo-Tracking: Der Standard von Argo CD ist das Label `app.kubernetes.io/instance` (≤2.x) bzw. die Annotation `argocd.argoproj.io/tracking-id` (ab 3.x). `argocd.argoproj.io/instance` ist eine eigene Konfiguration. Vor dem Bau auf k8s prüfen, welches Label gesetzt ist. Die Spec-Aussage „Standard-Tracking“ korrigieren.
9. „Jobs anzeigen“ filtert per Namens-Teilstring. Er trifft auch Jobs anderer CronJobs mit gleichem Präfix (`backup` und `backup-db`). Später über `owner` filtern.
10. Dass `.kube-dock-terminal` keinen `contextmenu`-Handler bekommt, ist heute geschützt: `TerminalPanel.tsx:87-96` ruft in der Capture-Phase `stopImmediatePropagation` auf. Diese Annahme im Plan festhalten und als manuellen Prüfpunkt aufnehmen.
