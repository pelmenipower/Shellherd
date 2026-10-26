# Kubernetes: Logs aller Pods und RBAC-Vorabprüfung – Design

> Übernommen aus dem Konzept (Opus, `.superpowers/sdd/k8s-logs-rbac-research.md`). Bindend geht `2026-10-25-k8s-logs-rbac-validation.md` vor.

Branch `claude/feature/k8s-logs-rbac`, gestapelt auf 0.27.0, Ziel **0.28.0**. Nutzer-Ruling: nur lesend, keine schreibenden Cluster-Aktionen. Die Umsetzer sind Haiku-Modelle; Signaturen, Texte und Fehlercodes unten sind wörtlich zu übernehmen.


Branch `claude/feature/k8s-logs-rbac`, Basis 0.27.0 (Paket Port-Forward), Ziel **0.28.0**, CHANGELOG-Datum wörtlich `2026-10-25`.

Ziel des Pakets, zwei Teile:
1. **Logs aller Pods.** Für ein Deployment, StatefulSet, DaemonSet, einen Job oder einen Service mit Selector zeigt der untere Bereich die Logs aller zugehörigen Container zusammen: nach Zeit sortiert, mit farbigem Präfix `pod/container`, mit Filter, Quellen-Schaltern und `Folgen`. Neue Pods eines Rollouts kommen von selbst dazu.
2. **RBAC-Vorabprüfung.** Kontextmenü-Einträge und Tasten, die das Kubernetes-Konto nicht ausführen darf, sind vorab gesperrt und nennen das fehlende Recht. Das gilt für die schreibenden Aktionen (Neustart, Skalieren, Löschen, cordon/uncordon, Anhalten/Fortsetzen, Jetzt ausführen) und für Logs, Shell und Port-Forward.

**Bindendes Nutzer-Ruling R-0:** Das Paket liest und analysiert nur. Es kommt keine schreibende Cluster-Aktion dazu, und die bestehenden schreibenden Aktionen ändern sich nicht; sie werden nur vorab eingegrenzt. Erlaubt sind `get`, `list`, `watch`, `get` auf `pods/log` sowie `create` auf `selfsubjectrulesreviews`/`selfsubjectaccessreviews`. Die vollständige Liste der neuen API-Aufrufe steht in R7.1.

Die Umsetzer sind Haiku-Modelle. Signaturen, Texte, Konstanten und Code-Blöcke unten sind verbindlich und wörtlich zu übernehmen. Wo „ergänzen“ steht, bleibt der übrige Code unverändert.

---

## 0. Bestand (mit Fundstellen)

### 0.1 Pod-Logs heute
- Pod-Logs laufen **als Terminal**: Die Dock-Ansicht baut ein `KubeTerminalTarget` mit `mode: 'logs' | 'previous'` (`src/renderer/src/components/kubernetes/DetailDock.tsx:93-97`) und rendert ein eingebettetes `TerminalPanel` (`:178-183`). Main öffnet es über die SSH-Sitzungsverwaltung (`src/main/ssh/session.ts`, `startKubeTerminal`) und `KubeSessions.openTerminal` (`src/main/kubernetes/session.ts:626-660`).
- Der Log-Stream ist ein eigener GET, nicht die `Log`-Klasse von client-node, weil diese ohne Fehlerbehandlung pipet (`src/main/kubernetes/client-api.ts:280-340`). URL: `logUrl` mit `follow`, `previous`, `tailLines=500`, `timestamps=false` (`:262-273`). Der Body läuft durch `LogFormatter` (`:293`, `:305-313`).
- `LogFormatter` (`src/main/kubernetes/log-format.ts:148-209`) macht CRLF und die Kompakt-Form für JSON-Zeilen; `formatLogLine` färbt per ANSI (`:5-8`, `:77-82`, `:118-144`). Kompakt/Roh ist Teil des Terminal-Keys (`kube-view.ts` `dockTerminalKey`, Spec `2026-10-18-kubernetes-log-view-design.md` Abschnitte 2–3).
- Nach einem Reconnect startet der Log-Stream neu, weil `epoch` im Key steckt (`ClusterView.tsx:120-131`, `DetailDock.tsx:180`).
- Kopieren im Dock: `copyText` liest bei Terminals den Puffer (`DetailDock.tsx:122-135`), `capText` begrenzt auf 4 MiB (`:25`, `:133`).
- Die Shell startet nur auf Knopfdruck („armed“): `settleArm` (`kube-view.ts`, Ende der Datei), `armedFor` in `ClusterView.tsx:60` und `:84-87`, Platzhalter mit Knopf in `DetailDock.tsx:170-177`. Bei „Nur lesen“ ist der Knopf `disabled` mit `title` und sichtbarem Grund (`:173-176`). Dieses Muster übernimmt R3.2 für „Logs aller Pods“.
- „Logs aller Pods“ ist in der Kontextmenü-Spec als Stufe 2 vermerkt (`docs/superpowers/specs/2026-10-16-kubernetes-context-menus-design.md:93`, `:279`), in der Integrations-Spec als „Logs ganzer Workloads“ (`2026-10-16-kubernetes-integration-design.md:35`). Kopierbar gibt es heute nur `kubectl logs job/…` (`kube-menus.ts:257`).

### 0.2 Was schon da ist und wiederverwendet wird
- `ResourceWatcher` hält eine Liste plus Watch aktuell, mit Batching, Relist bei 410 und Meldung bei 401/403 (`src/main/kubernetes/watch.ts:34-120`). Die Option `onObjects` liefert nach jeder Liste und jedem Batch **die vollständige Objektmenge** (`:24-25`, `:101`, `:206`). Damit bekommt das neue Modul die Pods eines Selectors ohne eigenen Watch-Code.
- Ein `KubeSelector` mit `labels` wird zu `labelSelector=k=v,…` (`client-api.ts:29-36`).
- `KubeRow.selector` trägt bei Workloads und Jobs `matchLabels`, bei Services `spec.selector` (`src/main/kubernetes/rows.ts:172`, `:236-237`, `:260`). `matchExpressions` werden nicht gelesen; „Pods anzeigen“ arbeitet genauso.
- `KubeForwards` verwaltet die Weiterleitungen pro View. `KubeSessions` verdrahtet Start, Stopp, `close`, `closeAll` und das Ereignis `forwards` (`session.ts:514-524`, `:577-604`, `:618-623`). Dasselbe Muster bekommt das neue Modul `workload-logs.ts`.
- Ereignisse gehen per `k8s:event` an das Fenster der View (`ipc.ts:48-51`); `useClusterSession` reicht sie in den Reducer (`hooks/useClusterSession.ts:49-54`). `applyEvent` ist ein vollständiger `switch` ohne `default` (`kube-view.ts:298-306`); eine neue Ereignisart muss dort stehen.
- Drei Test-Fakes implementieren `KubeApi`: `overview.test.ts:38`, `session.test.ts:70` und `watch.test.ts:17`. Neue Pflichtmethoden müssen in allen dreien ergänzt werden.
- i18n-Keys sind typisiert (`src/shared/i18n.d.ts`). Die Parameter `count`, `total`, `shown` und `max` formatiert `countFormatter` (`src/renderer/src/i18n.ts:9-13`).

### 0.3 Gesperrte Menüeinträge heute
- Menüs sind reine Daten (`src/renderer/src/kube-menus.ts`). Ein Eintrag mit `reason` wird `disabled` und zeigt den Grund als `hint` (`:59-64`).
- `ContextMenu` rendert den Grund sichtbar als `<small>` neben dem Eintrag und setzt `disabled` (`src/renderer/src/components/ContextMenu.tsx:57-58`). Die Pfeiltasten überspringen gesperrte Einträge (`:49`). Das Menü ist bis 320 px breit, der Grund bricht um (`components/navigation-ui.css:47-51`).
- Gründe heute: „Nur lesen“, nicht verbunden, falsche Art, kein Selector, Pod läuft nicht (`kube-menus.ts:82-84`, `:137-164`; `kube-commands.ts:49-56`, `:63-68`).
- Tasten (`r`, `S`, `Strg+D`, `s`, `l`, `p`) prüfen `unavailable` und melden den Grund in der Kopfzeile (`ClusterView.tsx:305-310`). Die Hilfe zeigt dieselben Gründe ausgegraut.
- Schreibende Aktionen laufen über `ConfirmAction` und `runAction` (`src/main/kubernetes/actions.ts:6-55`). Die Verben je Aktion:
  - Restart und Scale: `patch` auf das Workload-Objekt (`:21-30`);
  - Delete: `delete` auf `pods`/`jobs` (`:31-34`);
  - cordon: `patch` auf `nodes` (`:35-37`);
  - Suspend/Resume: `patch` auf `cronjobs` (`:38-41`);
  - Trigger: `get` CronJob plus `create` Job (`client-api.ts:467-472`).
- Ein 403 wird heute erst nach dem Versuch verständlich angezeigt (`client-api.ts:104-111`, Text `forbiddenResource` in `errors/kubernetes.json`). Die Integrations-Spec verschiebt die Vorabprüfung ausdrücklich auf später (`2026-10-16-kubernetes-integration-design.md:316`).

### 0.4 client-node 2.0.0
- `AuthorizationV1Api` ist exportiert (`node_modules/@kubernetes/client-node/dist/gen/index.d.ts`, `ObjectAuthorizationV1Api as AuthorizationV1Api`). Es hat `createSelfSubjectRulesReview({ body })` (`dist/gen/types/ObjectParamAPI.d.ts:10981`) und wird mit `config.makeApiClient(AuthorizationV1Api)` erzeugt (`dist/config.d.ts:82`). Es braucht **keine** Discovery, anders als `KubernetesObjectApi.create`.
- `V1SubjectRulesReviewStatus` hat `resourceRules[]`, `incomplete: boolean` und `evaluationError?` (`dist/gen/models/V1SubjectRulesReviewStatus.d.ts:15-33`). Die Doku dort sagt: „Because authorization rules are additive, if a rule appears in a list it's safe to assume the subject has that permission, even if that list is incomplete.“
- `V1ResourceRule` hat `verbs`, `apiGroups?`, `resources?` und `resourceNames?` (`dist/gen/models/V1ResourceRule.d.ts:19-31`).

### 0.5 Design-System
- „Was gefärbt ist, ist ein Zustand“, Ampelfarben nie dekorativ (`docs/design-system.md:7`, `:12`). Für Quellen-Präfixe gibt es heute **kein** Token. Bunte Pod-Präfixe brauchen deshalb eine neue, eng begrenzte Rolle (R3.5).
- `design-tokens.test.ts` verlangt jedes `--color-*` im dunklen und im hellen Block (R19, `:195-205`) und prüft die Liste `COLORS` (`:63-66`).
- Die Bühne (`--color-bg-stage`) trägt Terminal, Code und Manifest; `.kube-manifest` ist das Muster für Text auf der Bühne (`kubernetes-ui.css:115`).

### 0.6 run-app
- `kube-fake.mjs` beantwortet `pods/log` für jeden Pod mit 15 festen Zeilen. Bei `follow=true` hält es die Antwort offen, schickt aber nichts nach (`:164-170`). Zeitstempel-Präfixe (`timestamps=true`) und `tailLines` kennt es nicht.
- Jede Nicht-GET-Anfrage bekommt 403 (`:128-132`); eine Rules-Review gibt es nicht.
- Fixtures:
  - Deployment `api` mit drei laufenden Pods (`kube-fixtures.mjs:56`), `worker` mit zwei (`:57`);
  - `checkout` im CrashLoop (`:58-62`);
  - Job-Pod `image-migrate-4kq8l` beendet, aber ohne `startedAt` (`:36`, `:64-67`);
  - Kontext-Namespace `shop` (`kube-fake.mjs:193`).
- Der Demo-Cluster `prod-k8s` ist Produktion und nicht „Nur lesen“ (`src/renderer/src/cluster-form.ts:44`, `demo-setup.mjs:95-107`).
- `fakes.test.mjs` treibt echten App-Code über den SSH-Tunnel gegen den Fake (`:94-162`), nur unter Windows.

---

## 1. Empfehlungen

| # | Fläche / Funktion | Wert | Aufwand |
|---|---|---|---|
| 1a | „Logs aller Pods“ im Kontextmenü von Deployment, StatefulSet, DaemonSet, Job und Service; Ansicht im Dock-Reiter **Logs** | ★★★ | Renderer plus neues Main-Modul |
| 1b | Zusammenführen nach Server-Zeitstempel (`timestamps=true`), Präfix `pod/container` in vier Quellenfarben | ★★★ | Main (Parsen) plus Renderer (Einsortieren) |
| 1c | Folgen, Filterfeld mit Markierung, Quellen ein- und ausblenden, Kopieren | ★★★ | nur Renderer |
| 1d | Neue Pods beim Rollout erscheinen, neu gestartete Container lesen weiter (`sinceTime`) | ★★★ | Main (`ResourceWatcher.onObjects`) |
| 1e | Grenzen: 20 Streams gleichzeitig, 200 Zeilen Rückblick je Container, 10 000 Zeilen Puffer, 2 000 sichtbar | ★★★ | Main plus Renderer |
| 2a | RBAC-Vorabprüfung über **SelfSubjectRulesReview je Namespace**, 60 s gültig, unbekannt = nichts sperren | ★★★ | kleine Main-Änderung plus reines Shared-Modul |
| 2b | Gesperrte Einträge und Tasten mit Grund „Keine Berechtigung: patch auf deployments in shop“ | ★★★ | nur Renderer (Menüdaten, Befehle) |
| 2c | Dock: Shell-Knopf und „Logs aller Pods anzeigen“ gesperrt mit Grund | ★★ | nur Renderer |
| 3 | run-app: Fake mit Zeitstempeln, `tailLines`, Folgen und Rules-Review (`shop` fest, `monitoring` unvollständig, sonst 403); Ende-zu-Ende-Test; Szene | ★★★ | run-app |
| 4a | SelfSubjectAccessReview je Aktion | ★ | nicht jetzt (R2.2) |
| 4b | Logs aller Pods als eigener Tab, `l` auf Workload-Zeilen, vorherige Container | ★★ | nicht jetzt (Extras) |
| 4c | `aria-disabled` statt `disabled` im gemeinsamen `ContextMenu` | ★★ | nicht jetzt (R5.3) |

---

## 2. Rulings (Entscheidungen mit Begründung)

### 1 – Logs aller Pods: Umfang

**R1.1 Arten: Deployment, StatefulSet, DaemonSet, Job, Service – immer über deren Selector.**
- Die Arten stehen in der Konstante `LOGS_ALL_KINDS` (3.1). CronJobs gehören nicht dazu: Ihre Pods gehören zu wechselnden Jobs, und der Job selbst hat den Eintrag.
- Ohne Selector ist der Eintrag gesperrt, mit den vorhandenen Gründen `noSelectorWorkload`, `noSelectorJob` und `noSelectorService`.
- Main lehnt einen leeren Selector ab (Schema, 3.2). Ein leerer `labelSelector` würde **alle** Pods des Namespace verfolgen.
- Es gilt nur `matchLabels`, wie bei „Pods anzeigen“ (0.2). `matchExpressions` bleiben außen vor (Nicht-Ziel, Risiko 3).

**R1.2 Main löst die Pods selbst auf und hält sie aktuell.**
- Das Modul `workload-logs.ts` startet einen eigenen `ResourceWatcher` auf `{ kind: 'pods', namespace, selector: { labels } }` und liest die Objekte über `onObjects`. Das sind `list` und `watch` auf `pods`; beide Aufrufe gibt es schon.
- Neue Pods eines Rollouts kommen über den Watch. Alte Pods enden, wenn der Server ihren Stream schließt; ihre Zeilen bleiben stehen, und die Quelle zeigt „beendet“.
- Shellherd schließt einen Stream **nicht**, wenn der Pod gelöscht wird. Sonst gingen die letzten Zeilen eines endenden Pods verloren. Der Server beendet den Stream ohnehin, wenn der Container stoppt.

**R1.3 Ein Container gilt als gestartet, wenn `state.running`, `state.terminated` oder `lastState.terminated` ein `startedAt` hat.**
- Pending-Pods und Container in `ContainerCreating` bekommen keinen Stream, sonst antwortet der Kubelet mit 400. Sie erscheinen, sobald der Watch sie als gestartet meldet.
- Ein Container im CrashLoop hat `lastState.terminated`. Sein letzter Lauf ist lesbar, wie bei `kubectl logs`.
- Init- und Ephemeral-Container sind nicht dabei (Nicht-Ziel).
- Die „Instanz“ eines Containers ist `restartCount/startedAt`.
  - Endet ein Stream und meldet der Watch später eine neue Instanz, öffnet Shellherd neu, mit `sinceTime` (R1.6).
  - Für dieselbe Instanz öffnet Shellherd nie zweimal. Das verhindert Schleifen bei beendeten Containern.

**R1.4 Grenzen.**

| Grenze | Wert | Warum |
|---|---|---|
| Streams gleichzeitig je View | `MAX_LOG_STREAMS = 20` | Jeder Stream ist ein langlebiger GET durch den SSH-Tunnel und belastet API-Server und Kubelet. 20 reicht für typische Deployments (bis 10 Replikas mit je 2 Containern). |
| Quellen insgesamt je Lauf | `MAX_LOG_SOURCES = 100` | Beendete Quellen bleiben sichtbar; bei vielen Rollouts wächst die Liste trotzdem nicht unbegrenzt. |
| Rückblick je Container | `LOG_TAIL_LINES = 200` | 20 × 200 = 4 000 Zeilen zum Start, das passt in den Puffer. Einzel-Pod-Logs bleiben bei 500. |
| Puffer im Renderer | `MAX_BUFFER_LINES = 10 000` | Ältere Zeilen fallen vorne heraus. |
| Angezeigt | `DISPLAY_LINES = 2 000` (neueste Treffer) | Ohne Virtualisierung flüssig. Bei mehr Treffern steht darüber „… ältere Treffer nicht angezeigt; Kopieren nimmt alle mit.“ |
| Zeile | `MAX_LINE_CHARS = 4 000`, dann `…` | Eine Megabyte-JSON-Zeile darf die Ansicht nicht sprengen. |
| Batch an den Renderer | alle 250 ms, höchstens `MAX_BATCH_LINES = 2 000` | Schutz vor Fluten: Main hält nie mehr als zwei Batches, der Rest zählt als „ausgelassen“. |

- Sind mehr als 20 Container gestartet, laufen die ersten 20 nach Pod-Name. Die Leiste meldet dann „n weitere warten (höchstens 20 gleichzeitig)“. Endet ein Stream, rückt der nächste nach.
- Speicher:
  - Main hält je Quelle nur die angefangene Zeile (höchstens 64 KiB) und bis zum nächsten Batch höchstens 4 000 Zeilen.
  - Der Renderer hält höchstens 10 000 Zeilen mit je höchstens 4 000 Zeichen. Typisch sind das 2 bis 5 MB.
- Es gibt einen Lauf je View. Ein neuer Start (andere Zeile, anderes Format, Reconnect) stoppt den alten.

**R1.5 Sortierung nach Server-Zeitstempel, im Renderer einsortiert.**
- Main fordert `timestamps=true` an. Der Kubelet setzt dann vor jede Zeile einen Zeitstempel nach RFC 3339, mit bis zu neun Nachkommastellen und gekürzten Nullen.
- Main füllt die Nachkommastellen auf **genau neun Stellen** auf (`splitTimestamp`). Dann sortieren die Zeichenketten nach Zeit.
- Main sortiert nicht. Der Renderer fügt jede Zeile hinter der letzten Zeile mit gleicher oder älterer Zeit ein (`mergeLines`). Das ist stabil bei gleicher Zeit und meist ein Anhängen am Ende. So landen auch Zeilen richtig, die eine Quelle verspätet liefert.
- Zeilen ohne Zeitstempel (die es nicht geben sollte) bekommen die Zeit der vorigen Zeile ihrer Quelle.
- Angezeigt wird `HH:MM:SS.mmm` in UTC, wie in der Kompakt-Form der Einzel-Logs.

**R1.6 Neustart eines Containers: weiterlesen ohne Dubletten.**
- `sinceTime` kennt nur ganze Sekunden. Main öffnet den neuen Stream ab der Sekunde der letzten gelesenen Zeile.
- Danach überspringt Main alle Zeilen, deren Zeit höchstens gleich der letzten gelesenen ist (`skipUntil`), bis eine neuere kommt.

**R1.7 Format: Kompakt/Roh wie im Dock, aber ohne ANSI.**
- Der vorhandene Umschalter `Kompakt / Roh` gilt auch hier und startet den Lauf neu.
- Kompakt nutzt `formatLogLine`.
- Die Ansicht ist kein Terminal. Deshalb entfernt `cleanLogText`:
  - die Escape-Sequenzen der App;
  - die ANSI-Farben von `formatLogLine`.
  
  Übrige Steuerzeichen werden zu `U+FFFD`. React rendert die Zeilen als Text, nie als HTML.

**R1.8 Folgen, Filter, Quellen, Kopieren.**
- **Folgen** ist beim Start an: Die neueste Zeile bleibt sichtbar.
  - Scrollt der Nutzer nach oben oder drückt `Folgen`, friert die Ansicht ein.
  - Neue Zeilen laufen weiter in den Puffer, und der Knopf zeigt „Folgen (12 neu)“.
  - Erneutes Drücken springt ans Ende.
- **Filter:** ein Textfeld. Es durchsucht Präfix und Text, ohne Rücksicht auf Groß- und Kleinschreibung (`foldCase`). Treffer sind mit `<mark>` markiert.
  - Ein eigenes „Suchen mit Weiter/Zurück“ gibt es nicht. In einer zusammengeführten Ansicht ist das Filtern die Analyse, das Markieren übernimmt die Suche.
- **Quellen:** je Container ein Chip in seiner Farbe (`aria-pressed`). Ein Klick blendet die Quelle aus und wieder ein.
  - Beendete Quellen zeigen „beendet“.
  - Quellen mit Fehler zeigen „Fehler“, mit dem Fehlertext im `title`.
- **Kopieren:** Der vorhandene Dock-Knopf kopiert alle Treffer, nicht nur die 2 000 sichtbaren, im Format `pod/container HH:MM:SS.mmm Text`. Die Meldung lautet wie gewohnt „Kopiert: Logs aller Pods (n Zeilen)“.

**R1.9 Lebenszyklus.**

| Ereignis | Folge |
|---|---|
| Auswahl wechselt auf eine andere Zeile, Dock-Reiter wechselt, Format wechselt | Die Komponente unmountet oder bekommt einen neuen Key. Daraufhin ruft sie `kubeLogsStop`, und Main schließt Watcher und Streams. |
| Reconnect (zurück auf `ready`) | `epoch` steckt im Key: Neustart mit leerem Puffer, wie bei den Einzel-Logs |
| Cluster-Tab oder Fenster schließen | `KubeSessions.close` ruft `logs.stopView` |
| Anderer Vault, Beenden | `closeAll` ruft `logs.stopAll` |
| Sperren | Läuft weiter, wie Cluster und Weiterleitungen. Starten geht nicht: Die UI ist `inert`, und `getCluster` scheitert. |
| „Nur lesen“ | erlaubt (lesend) |
| Cluster deaktiviert | Main lehnt ab (`kubernetes.disabled`) |

Nichts wird gespeichert, auch nicht im Workspace-Snapshot.

### 2 – RBAC-Vorabprüfung: Mechanik

**R2.1 SelfSubjectRulesReview je Namespace, einmal geladen, 60 s gültig.**

| | SelfSubjectRulesReview (SSRR) | SelfSubjectAccessReview (SSAR) |
|---|---|---|
| Anfragen | **1 je Namespace** | 1 je Verb, Ressource und Namespace: hier 13 je Namespace, mit Objektnamen mehr |
| Genauigkeit bei RBAC | vollständig, Wildcards und aggregierte ClusterRoles sind aufgelöst | vollständig |
| Webhook- und externe Autorisierer (GKE-IAM, AKS mit Azure-RBAC, Rancher) | `incomplete: true`, Shellherd sperrt dann nichts | autoritativ |
| `resourceNames` | Die Regel ist sichtbar; Shellherd wertet sie als Erlaubnis (R2.3) | mit Namen exakt |
| Menü synchron renderbar | ja, aus dem Cache | nur mit einem Batch vorab, sonst flackert das Menü |

Entscheidung: **SSRR**.
- Das Zielumfeld (kubeadm, `admin.conf`, RBAC plus Node-Autorisierer) liefert vollständige Regeln.
- Kann ein Autorisierer keine Regeln aufzählen, meldet die API `incomplete: true`, und Shellherd verhält sich wie heute. Der Node-Autorisierer tut das nur für Node-Identitäten.
- Falsches Sperren ist damit ausgeschlossen. Falsches Freigeben endet wie heute im 403.

**R2.2 SSAR nicht in diesem Paket.** Sie wäre nur bei Webhook-Clustern genauer und kostet 13 Anfragen je Namespace. Sie bleibt ein Extra, falls jemand auf GKE oder AKS mit Azure-RBAC arbeitet.

**R2.3 Auswertung wie der RBAC-Autorisierer, im Zweifel erlaubt.**
- Eine Regel passt so:
  - Verb: `*` oder gleich;
  - Gruppe: `*` oder gleich (`''` ist die Core-Gruppe);
  - Ressource: `*`, gleich (etwa `pods/log`) oder `*/<Unterressource>` (etwa `*/log`). `pods/*` ist in RBAC **kein** Muster und zählt nicht.
- `resourceNames` werden ignoriert: Eine Regel nur für bestimmte Objekte gilt als Erlaubnis. Sonst würde Shellherd Einträge sperren, die für genau dieses Objekt gehen.
- Eine Funktion hat Alternativen. Eine Alternative ist erlaubt, wenn alle ihre Prüfungen erlaubt sind (`ACCESS_CHECKS` in 3.1):
  - Shell und Port-Forward: `create` (ab Kubernetes 1.31 mit WebSocket verlangt) **oder** `get` (ältere Cluster) auf `pods/exec` bzw. `pods/portforward`.
  - Jetzt ausführen: `create` auf `jobs` **und** `get` auf `cronjobs`.
  - Logs aller Pods: `get` auf `pods/log` **und** `list` und `watch` auf `pods`.
- Clusterweite Arten (Nodes) prüft Shellherd mit den Regeln des Standard-Namespace der Ansicht (`status.namespace`, sonst `default`).
  - Regeln aus ClusterRoleBindings stehen in der Antwort für jeden Namespace.
  - Regeln einer RoleBinding auf `nodes` würden fälschlich als Erlaubnis zählen. Das endet wie heute im 403.

**R2.4 Cache im Renderer, je View und je Namespace.**
- Ein Eintrag ist `{ at, denied }`; `denied: null` heißt unbekannt.
- Ein Eintrag ist **veraltet** nach `ACCESS_TTL_MS = 60 000` ms.
- Neu geladen wird nur bei Bedarf, nie periodisch. Bedarf entsteht:
  - für den Namespace der Ansicht;
  - für den Namespace der ausgewählten Zeile;
  - für den Standard-Namespace (für Nodes);
  - beim Öffnen eines Kontextmenüs für den Namespace des Ziels.
- Bis die Antwort da ist, bleibt der alte Eintrag gültig; ohne Eintrag ist nichts gesperrt.
- Ein offenes Menü aktualisiert sich, sobald die Antwort eintrifft. Es wird bei jedem Render neu berechnet (`ClusterView.tsx:238-247`).
- **Namespace-Wechsel:** Der neue Namespace wird geladen, die anderen bleiben im Cache.
- **Reconnect oder Fehler:** Jeder Status außer `ready` leert den Cache. Nach `ready` wird neu geladen.
- Warum 60 s statt 5 min:
  - Bekommt ein Konto ein neues Recht, bleibt der Eintrag höchstens eine Minute zu Unrecht gesperrt.
  - Das kostet höchstens eine Anfrage je Namespace und Minute, und nur, wenn der Nutzer etwas tut.
- Doppelte Anfragen verhindert ein Satz laufender Namespaces im Hook.

**R2.5 Rückfall: Shellherd sperrt nichts, wenn die Review verboten, nicht vorhanden, unvollständig oder fehlerhaft ist oder länger als 10 s braucht.**
- Main liefert dann `null`.
- Die Oberfläche zeigt keinen Hinweis. Für den Nutzer ändert sich gegenüber heute nichts.

**R2.6 Main wertet aus, der Renderer bekommt nur das Ergebnis.**
- `k8s:access` liefert `KubeDenied[] | null`, also je gesperrter Funktion `{ id, verb, resource }`. Die erste fehlende Prüfung nennt den Grund.
- Die Regeln selbst verlassen Main nicht. Das hält Payload und Schema klein.

### 3 – UI

**R3.1 Einstieg: Kontextmenü-Eintrag `Logs aller Pods`.**
- Er steht bei Deployment, StatefulSet, DaemonSet, Job und Service als **erster Eintrag der Ansichten-Gruppe**, vor `Events`, `YAML` und `Describe`.
- Er ist gesperrt, mit Grund, wenn:
  - der Cluster nicht verbunden ist;
  - die Zeile keinen Selector hat;
  - das Recht `logsAll` fehlt.
- Es gibt kein Tastenkürzel. `l` bleibt „Nur für Pods“ (Extra in Abschnitt 8).

**R3.2 Ort: der vorhandene Dock-Reiter `Logs`, kein eigener Tab.**
- Ist heute eine Workload-, Job- oder Service-Zeile ausgewählt und der Reiter `Logs` offen, zeigt das Dock „Wähle einen Pod, um Logs zu sehen.“. Hat die Zeile einen Selector, stehen dort künftig:
  - der Text „Logs aller Pods von {{name}}: startet erst auf Knopfdruck, weil dafür bis zu 20 Log-Streams gleichzeitig öffnen.“;
  - der Knopf `Logs aller Pods anzeigen`.
- Gestartet wird wie bei der Shell nur auf Wunsch, über den Knopf oder den Menüeintrag. Wechselt die Auswahl, ist der Lauf vorbei (`settleArm`). Blättern mit `j`/`k` öffnet so nie 20 Streams.
- Warum kein eigener Tab:
  - Tabs sind heute Terminals (`TerminalConnection`). Ein Tab mit React-Ansicht bräuchte eine neue Tab-Art, einen Eintrag im Workspace-Snapshot und den Fensterwechsel.
  - Das Dock lässt sich auf 70 % der Höhe ziehen.
  - Den eigenen Tab gibt es als Extra.
- Der Popout-Knopf und die Container-Einträge im Dock-Menü erscheinen hier nicht, weil sie einen Pod brauchen.

**R3.3 Aufbau der Ansicht** (Klassen in 3.14):
1. Leiste (`.kube-logs-bar`):
   - Filterfeld (`type="search"`, Platzhalter `Filtern`);
   - Knopf `Folgen` (`aria-pressed`);
   - rechts der Zustand, etwa „Live: 3 von 3 Containern · 2 weitere warten (höchstens 20 gleichzeitig)“, oder der Fehler.
2. Quellen-Chips (`.kube-logs-sources`): Sie brechen um und sind höchstens 64 px hoch, darüber scrollbar.
3. Zeilen auf der Bühne (`.kube-logs-lines`, `role="log"`, `aria-live="off"`, fokussierbar):
   - Jede Zeile hat das Präfix in der Quellenfarbe, die Zeit gedämpft und den Text mit Markierung.
   - `white-space: pre`, kein Umbruch, waagerecht scrollbar.

**R3.4 Keine Bewegung, kein Eintrag im Motion-Gate.** Neue Zeilen erscheinen sofort. Der Sprung ans Ende setzt `scrollTop`, ohne `smooth`.

**R3.5 Vier neue Farb-Tokens mit eng begrenzter Rolle.**
- `--color-source-1` bis `--color-source-4` sind **nur Textfarbe** für die Herkunft einer Zeile (Präfix und Chip) in „Logs aller Pods“. Sie sind nie Zustand, nie Fläche, nie Rand.
- Die Farben liegen bewusst weit weg von Kupfer und Ampel: Blau, Violett, Türkis, Magenta.
- Ab der fünften Quelle wiederholen sie sich. Die eigentliche Kennung bleibt der Name im Präfix.

| Token | dunkel | Kontrast Bühne / Panel | hell | Kontrast Bühne / Panel |
|---|---|---|---|---|
| `--color-source-1` | `#7cb7ff` | 9,15 / 8,12 | `#1d5fb8` | 6,21 / 5,76 |
| `--color-source-2` | `#c4a5ff` | 9,24 / 8,20 | `#6b3fb8` | 6,93 / 6,43 |
| `--color-source-3` | `#5fd4d4` | 10,76 / 9,55 | `#0f6f73` | 5,93 / 5,50 |
| `--color-source-4` | `#e59af0` | 9,27 / 8,23 | `#9a2f8f` | 6,61 / 6,13 |

**R3.6 Gesperrte Einträge: sichtbarer Grund, `disabled` wie heute.**
- Der Grund steht als Hinweis im Menüeintrag, wie alle anderen Gründe. Das ist besser als ein Tooltip, weil er auch ohne Maus sichtbar ist.
- Text bei Ressourcen im Namespace: „Keine Berechtigung: patch auf deployments in shop“.
- Text bei clusterweiten Ressourcen: „Keine Berechtigung: patch auf nodes (clusterweit)“.
- Tasten melden denselben Grund in der Kopfzeile. Die Hilfe zeigt ihn ausgegraut, über `unavailable`.
- Im Dock bekommen der Shell-Knopf und der Knopf `Logs aller Pods anzeigen` `disabled`, `title` und den Grund als Zeile darunter. Das ist das Muster des „Nur lesen“-Knopfs (`DetailDock.tsx:173-176`).
- Reihenfolge der Gründe:
  1. „Nur lesen“;
  2. nicht verbunden;
  3. falsche Art, Pod läuft nicht oder kein Selector;
  4. fehlendes Recht.

  Das fehlende Recht kommt zuletzt, weil die anderen Gründe konkreter sind.
- Die Dock-Reiter selbst sowie Events, YAML und Describe werden nicht gesperrt (Nicht-Ziel).

### 4 – Sicherheit und R-0

**R4.1 Warum `create` auf den Reviews nichts schreibt.**
- `selfsubjectrulesreviews` und `selfsubjectaccessreviews` sind virtuelle Ressourcen. Beim `create` wertet der API-Server nur die Autorisierer für den anfragenden Benutzer aus und gibt das Ergebnis in der Antwort zurück.
- Dabei wird kein Objekt in etcd gespeichert, kein Watch-Ereignis ausgelöst und nichts im Cluster verändert. Nur das Audit-Log vermerkt die Anfrage, wie jede andere.
- Die Standard-ClusterRole `system:basic-user` erlaubt das jedem angemeldeten Benutzer.

**R4.2 Keine Maskierung.** Nichts aus den Logs geht an die KI. Die Maskierung kommt mit Paket 11.

**R4.3 Logs sind Anzeige, kein Code.** Es gibt kein `dangerouslySetInnerHTML`, Steuerzeichen und Escape-Sequenzen werden entfernt (R1.7), und die Länge ist begrenzt (R1.4).

**R4.4 Eingaben aus dem Renderer werden geprüft (3.2):**
- der Namespace nach DNS-1123;
- Schlüssel und Werte des Selectors nach `LABEL_KEY`/`LABEL_VALUE`, mit 1 bis 32 Paaren;
- die Lauf-ID als UUID.

### 5 – Was bewusst bleibt

**R5.1 Die bestehenden Aktionen bleiben unverändert.**
- `actions.ts`, `ConfirmAction`, die Bestätigung bei Produktion und die Prüfung auf „Nur lesen“ in Main bleiben, wie sie sind.
- Die Vorabprüfung ist nur ein zusätzlicher Grund im Renderer. Main verlässt sich nie darauf: Was der Renderer freigibt, scheitert wie heute mit 403.

**R5.2 Kein eigener Hinweis bei unbekannten Rechten.** Unbekannt bedeutet: wie heute.

**R5.3 `ContextMenu` bleibt bei `disabled`.**
- Eine Umstellung auf `aria-disabled` (fokussierbar und für Screenreader lesbar) gälte für alle Menüs der App, auch im Vault-Baum und bei den Containern. Sie gehört in ein eigenes kleines Paket.
- Der Grund ist schon heute sichtbar.

### 7 – Neue API-Aufrufe und ihre Verben

**R7.1 Vollständige Liste.** Sie erfüllt R-0.

| Aufruf | REST | RBAC-Verb | Wo |
|---|---|---|---|
| Pods des Selectors auflisten | `GET /api/v1/namespaces/{ns}/pods?labelSelector=…` | `list` `pods` | `workload-logs.ts` über `ResourceWatcher` |
| Pods des Selectors beobachten | `GET /api/v1/namespaces/{ns}/pods?watch=true&labelSelector=…` | `watch` `pods` | dito |
| Log je Container folgen | `GET /api/v1/namespaces/{ns}/pods/{pod}/log?container=…&follow=true&timestamps=true&tailLines=200` bzw. `&sinceTime=…` | `get` `pods/log` | `client-api.ts` `followLog` |
| Rechte je Namespace | `POST /apis/authorization.k8s.io/v1/selfsubjectrulesreviews` | `create` `selfsubjectrulesreviews` (reine Abfrage, R4.1) | `client-api.ts` `rulesReview` |

Es gibt keine SelfSubjectAccessReview. Es gibt kein `patch`, `update` oder `delete` und kein neues `create` auf echten Objekten.

### 8 – Testbarkeit

**R8.1** Die Logik steckt in reinen Funktionen, jede mit eigenem Test:
- Main: `splitTimestamp`, `cleanLogText`, `startedContainers`;
- Shared: `ruleAllows`, `deniedAccess`, `actionAccess`;
- Renderer: `mergeLines`, `shownLines`, `highlightParts`, `logsText`, `toggleSource`;
- Renderer: `accessNamespace`, `accessStale`, `refAccessReason`.

**R8.2** `KubeWorkloadLogs` bekommt die Zeitgeber (`schedule`/`cancel`) als Abhängigkeit, wie `ResourceWatcher`.

**R8.3** Der Ende-zu-Ende-Test führt echten App-Code (`createKubeApi`, `KubeWorkloadLogs`, `deniedAccess`) über den SSH-Tunnel gegen den Fake aus.

---

## 3. Vertrag (wörtlich)

### 3.1 Shared (Task A)

**`src/shared/kubernetes.ts`** – ergänzen. Diese Konstanten und Typen stehen hinter `KubeForwardStatus`:

```ts
/** Kinds whose pods "Logs aller Pods" shows, found by the row's selector. */
export const LOGS_ALL_KINDS: readonly KubeKind[] = ['deployments', 'statefulsets', 'daemonsets', 'jobs', 'services'];
/** Log streams open at once per view, container sources kept per run, lines read back per container at the start. */
export const MAX_LOG_STREAMS = 20;
export const MAX_LOG_SOURCES = 100;
export const LOG_TAIL_LINES = 200;
/** One line of the logs of all pods. `source` indexes the sources of the run; `time` is the server timestamp with nine fraction digits, '' when unknown. */
export interface KubeLogLine { source: number; time: string; text: string }
/** One container of the logs of all pods. live: its stream is open; error: why its stream ended early. */
export interface KubeLogSource { pod: string; container: string; live: boolean; error?: CodedError }
/** `id` is chosen by the renderer (UUID), so events of an old run can be told apart. */
export interface KubeLogsStartRequest { viewId: string; id: string; namespace: string; selector: Record<string, string>; format: 'compact' | 'raw' }
export interface KubeLogsStopRequest { viewId: string; id: string }
export interface KubeAccessRequest { viewId: string; namespace: string }
```

In `KubeEvent` nach der Variante `forwards` ergänzen (das bisherige `;` hinter `forwards` entfällt):

```ts
  /** A batch of the logs of all pods of run `id`: sources complete, lines new since the last batch, dropped = lines skipped so far. */
  | { type: 'logs'; viewId: string; id: string; lines: KubeLogLine[]; sources: KubeLogSource[]; waiting: number; dropped: number; error?: CodedError };
```

**`src/shared/kube-access.ts`** (neu):

```ts
/** RBAC pre-check: which functions of the cluster tab the account may use; see .superpowers/sdd/k8s-logs-rbac-research.md. */
import type { KubeAction, KubeKind } from './kubernetes';

/** One rule of a SelfSubjectRulesReview. RBAC only grants: a missing rule means "not allowed". */
export interface KubeResourceRule { verbs: string[]; apiGroups: string[]; resources: string[]; resourceNames?: string[] }
/** One request the API server would authorize; a subresource is written `pods/log`. */
export interface KubeAccessCheck { verb: string; group: string; resource: string }

export const KUBE_ACCESS_IDS = ['logs', 'logsAll', 'shell', 'forward', 'patchDeployments', 'patchStatefulSets', 'patchDaemonSets',
  'patchCronJobs', 'patchNodes', 'deletePods', 'deleteJobs', 'trigger'] as const;
export type KubeAccessId = typeof KUBE_ACCESS_IDS[number];
/** A function the account may not use, with the first missing check (for the reason text). */
export interface KubeDenied { id: KubeAccessId; verb: string; resource: string }
/** Answer for one namespace. denied null = unknown (review forbidden, not served, incomplete or slow): nothing is greyed out. at = Date.now(). */
export interface KubeAccessEntry { at: number; denied: KubeDenied[] | null }
/** An answer older than this is fetched again on the next need. */
export const ACCESS_TTL_MS = 60_000;

const check = (verb: string, group: string, resource: string): KubeAccessCheck => ({ verb, group, resource });
/**
 * Alternatives per function; one alternative is allowed when all of its checks are.
 * Exec and port forward need `create` since Kubernetes 1.31 (WebSocket) and `get` before.
 */
export const ACCESS_CHECKS: Record<KubeAccessId, KubeAccessCheck[][]> = {
  logs: [[check('get', '', 'pods/log')]],
  logsAll: [[check('get', '', 'pods/log'), check('list', '', 'pods'), check('watch', '', 'pods')]],
  shell: [[check('create', '', 'pods/exec')], [check('get', '', 'pods/exec')]],
  forward: [[check('create', '', 'pods/portforward')], [check('get', '', 'pods/portforward')]],
  patchDeployments: [[check('patch', 'apps', 'deployments')]],
  patchStatefulSets: [[check('patch', 'apps', 'statefulsets')]],
  patchDaemonSets: [[check('patch', 'apps', 'daemonsets')]],
  patchCronJobs: [[check('patch', 'batch', 'cronjobs')]],
  patchNodes: [[check('patch', '', 'nodes')]],
  deletePods: [[check('delete', '', 'pods')]],
  deleteJobs: [[check('delete', 'batch', 'jobs')]],
  trigger: [[check('create', 'batch', 'jobs'), check('get', 'batch', 'cronjobs')]],
};

const has = (values: string[], value: string): boolean => values.includes('*') || values.includes(value);

/** RBAC resource matching: `*`, the exact resource, or `*/<subresource>`. `pods/*` is no RBAC pattern. */
function resourceMatches(resources: string[], resource: string): boolean {
  if (resources.includes('*') || resources.includes(resource)) return true;
  const slash = resource.indexOf('/');
  return slash > 0 && resources.includes(`*${resource.slice(slash)}`);
}

/** True when the rule grants the check. resourceNames are ignored: a rule for named objects counts as allowed, so nothing is greyed out that might work. */
export function ruleAllows(rule: KubeResourceRule, wanted: KubeAccessCheck): boolean {
  return has(rule.verbs, wanted.verb) && has(rule.apiGroups, wanted.group) && resourceMatches(rule.resources, wanted.resource);
}

export function allows(rules: KubeResourceRule[], wanted: KubeAccessCheck): boolean {
  return rules.some(rule => ruleAllows(rule, wanted));
}

/** Functions the complete rules of a namespace do not allow, each with the first missing check of its first alternative. */
export function deniedAccess(rules: KubeResourceRule[]): KubeDenied[] {
  return KUBE_ACCESS_IDS.flatMap(id => {
    const alternatives = ACCESS_CHECKS[id];
    if (alternatives.some(all => all.every(wanted => allows(rules, wanted)))) return [];
    const missing = alternatives[0].find(wanted => !allows(rules, wanted)) ?? alternatives[0][0];
    return [{ id, verb: missing.verb, resource: missing.resource }];
  });
}

/** The function a cluster action needs on a kind; undefined for pairs ACTION_KINDS does not allow. */
export function actionAccess(action: KubeAction, kind: KubeKind): KubeAccessId | undefined {
  switch (action) {
    case 'restart':
    case 'scale':
      return kind === 'deployments' ? 'patchDeployments' : kind === 'statefulsets' ? 'patchStatefulSets' : kind === 'daemonsets' ? 'patchDaemonSets' : undefined;
    case 'delete': return kind === 'pods' ? 'deletePods' : kind === 'jobs' ? 'deleteJobs' : undefined;
    case 'cordon':
    case 'uncordon': return kind === 'nodes' ? 'patchNodes' : undefined;
    case 'suspend':
    case 'resume': return kind === 'cronjobs' ? 'patchCronJobs' : undefined;
    case 'trigger': return kind === 'cronjobs' ? 'trigger' : undefined;
  }
}
```

### 3.2 `src/shared/kubernetes-schema.ts` (Task A)

`LABEL_KEY` und `LABEL_VALUE` sind schon importiert. Diese Schemas kommen ans Ende der Datei:

```ts
const LabelMapSchema = z.record(z.string().max(317).regex(LABEL_KEY), z.string().max(63).regex(LABEL_VALUE));
export const KubeLogsStartRequestSchema = z.object({
  viewId, id: z.string().uuid(), namespace: KubeNameSchema,
  // An empty selector would follow every pod of the namespace.
  selector: LabelMapSchema.refine(labels => { const count = Object.keys(labels).length; return count > 0 && count <= 32; }, { message: 'selector' }),
  format: z.enum(['compact', 'raw']),
}).strict();
export const KubeLogsStopRequestSchema = z.object({ viewId, id: z.string().uuid() }).strict();
export const KubeAccessRequestSchema = z.object({ viewId, namespace: KubeNameSchema }).strict();
```

### 3.3 `src/shared/ipc.ts` und `src/preload/index.ts` (Task A)

In `IPC_CHANNELS` nach `kubeForwardStop`:

```ts
  kubeLogsStart: 'k8s:logs-start',
  kubeLogsStop: 'k8s:logs-stop',
  kubeAccess: 'k8s:access',
```

In `DesktopApi` nach `kubeForwardStop`. Dazu die Imports ergänzen: `KubeLogsStartRequest`, `KubeLogsStopRequest` und `KubeAccessRequest` aus `./kubernetes`, `KubeDenied` aus `./kube-access`.

```ts
  /** Starts the logs of all pods of a selector for the view (one run per view); batches arrive as `logs` events with the same id. */
  kubeLogsStart: (request: KubeLogsStartRequest) => Promise<void>;
  kubeLogsStop: (request: KubeLogsStopRequest) => Promise<void>;
  /** RBAC pre-check of one namespace; null = unknown, grey out nothing. */
  kubeAccess: (request: KubeAccessRequest) => Promise<KubeDenied[] | null>;
```

Im Preload nach `kubeForwardStop`:

```ts
  kubeLogsStart: request => ipcRenderer.invoke('k8s:logs-start', request),
  kubeLogsStop: request => ipcRenderer.invoke('k8s:logs-stop', request),
  kubeAccess: request => ipcRenderer.invoke('k8s:access', request),
```

### 3.4 `src/main/kubernetes/api.ts` und `client-api.ts` (Task B)

**api.ts:** Den Import `import type { KubeResourceRule } from '../../shared/kube-access';` ergänzen. Vor `KubeApi`:

```ts
/** Start of a followed log: the newest `tailLines`, or everything since `sinceTime` (RFC 3339, whole seconds). */
export interface LogFollowOptions { tailLines?: number; sinceTime?: string }
/** Result of a SelfSubjectRulesReview; incomplete = the rules cannot be trusted to be complete. */
export interface KubeRulesReview { incomplete: boolean; rules: KubeResourceRule[] }
```

In `KubeApi` nach `portForward`:

```ts
  /** Follows one container log with server timestamps (`timestamps=true`); `io.data` gets the raw bytes, always asynchronously. */
  followLog(target: KubeTerminalTarget, options: LogFollowOptions, io: TerminalIo): KubeStream;
  /** SelfSubjectRulesReview of one namespace: a query, nothing is stored in the cluster. */
  rulesReview(namespace: string): Promise<KubeRulesReview>;
```

**client-api.ts:** Die Imports um `AuthorizationV1Api` (aus `@kubernetes/client-node`) und `LogFollowOptions` (aus `./api`) erweitern. Neue Funktion hinter `logUrl`:

```ts
/** URL of a followed workload log: server timestamps on, the newest `tailLines` or everything since `sinceTime`. */
export function followLogUrl(server: string, target: KubeTerminalTarget, options: LogFollowOptions): string {
  const path = `/api/v1/namespaces/${encodeURIComponent(target.namespace)}/pods/${encodeURIComponent(target.pod)}/log`;
  const url = new URL(server + path);
  const params = url.searchParams;
  params.set('container', target.container);
  params.set('follow', 'true');
  params.set('timestamps', 'true');
  if (options.sinceTime) params.set('sinceTime', options.sinceTime);
  else params.set('tailLines', String(options.tailLines ?? 200));
  return url.toString();
}
```

`openLogs` bekommt einen fünften Parameter. Diese Stellen ändern sich, der Rest bleibt:

```ts
export function openLogs(config: KubeConfig, target: KubeTerminalTarget, io: TerminalIo, sendRequest: LogRequest = requestLogs, follow?: LogFollowOptions): KubeStream {
  // …finish as before…
  // Followed workload logs pass the raw bytes on: workload-logs.ts splits and cleans the lines itself.
  const formatter = follow ? undefined : new LogFormatter(target.format ?? 'compact');

  const run = async () => {
    // …cluster and options as before…
    const url = new URL(follow ? followLogUrl(cluster.server, target, follow) : logUrl(cluster.server, target));
    // …request and status check as before…
    for await (const chunk of response.body) {
      if (finished) break;
      const bytes = Buffer.from(chunk);
      if (!formatter) { io.data(bytes); continue; }
      const text = formatter.feed(bytes);
      if (text) io.data(Buffer.from(text));
    }
    if (!finished) {
      const rest = formatter?.flush();
      if (rest) io.data(Buffer.from(rest));
    }
    finish(0);
  };
  // In run().catch: `const rest = formatter?.flush();` instead of `formatter.flush()`.
```

In `createKubeApi` nach `portForward`:

```ts
    followLog(target, options, io) {
      return openLogs(config, target, io, requestLogs, options);
    },

    async rulesReview(namespace) {
      return call(async () => {
        const review = await config.makeApiClient(AuthorizationV1Api).createSelfSubjectRulesReview({
          body: { apiVersion: 'authorization.k8s.io/v1', kind: 'SelfSubjectRulesReview', spec: { namespace } },
        });
        const status = review.status;
        return {
          // A missing status counts as incomplete: then nothing is greyed out.
          incomplete: status?.incomplete !== false,
          rules: (status?.resourceRules ?? []).map(rule => ({
            verbs: rule.verbs ?? [], apiGroups: rule.apiGroups ?? [], resources: rule.resources ?? [],
            ...(rule.resourceNames?.length ? { resourceNames: rule.resourceNames } : {}),
          })),
        };
      });
    },
```

**Fakes** in `overview.test.ts` und `watch.test.ts` (Task B), als Methoden der Klasse `FakeApi`. Die Imports `KubeRulesReview` und `KubeStream` ergänzen.

```ts
  followLog(): KubeStream { throw new Error('followLog is not used here'); }
  async rulesReview(): Promise<KubeRulesReview> { return { incomplete: true, rules: [] }; }
```

### 3.5 `src/main/kubernetes/workload-logs.ts` (neu, Task D)

```ts
import { StringDecoder } from 'node:string_decoder';
import type { CodedError } from '../../shared/errors';
import { LOG_TAIL_LINES, MAX_LOG_SOURCES, MAX_LOG_STREAMS } from '../../shared/kubernetes';
import type { KubeLogLine, KubeLogSource, KubeLogsStartRequest } from '../../shared/kubernetes';
import type { KubeApi, KubeObject, KubeStream } from './api';
import { formatLogLine } from './log-format';
import { ResourceWatcher, defaultCancel, defaultSchedule } from './watch';

/** Lines go to the renderer every LOG_BATCH_MS; a batch carries at most MAX_BATCH_LINES (the newest), the rest counts as dropped. */
export const LOG_BATCH_MS = 250;
export const MAX_BATCH_LINES = 2000;
/** Longer lines are cut with an ellipsis; a partial line longer than MAX_PENDING_CHARS is passed on as a line. */
export const MAX_LINE_CHARS = 4000;
const MAX_PENDING_CHARS = 64 * 1024;

type Dict = Record<string, unknown>;
const rec = (value: unknown): Dict => (value && typeof value === 'object' && !Array.isArray(value) ? value as Dict : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export type LogsRequest = Omit<KubeLogsStartRequest, 'viewId'>;
/** The view a run belongs to; `api` waits through a reconnect (Session.waitReady). */
export interface LogsView { ownerId: number; viewId: string; api: () => Promise<KubeApi> }
export interface LogsBatch { id: string; lines: KubeLogLine[]; sources: KubeLogSource[]; waiting: number; dropped: number; error?: CodedError }
export type LogsEmit = (ownerId: number, viewId: string, batch: LogsBatch) => void;
export interface LogsTimers { schedule: (fn: () => void, ms: number) => unknown; cancel: (handle: unknown) => void }

/** Server timestamp of a `timestamps=true` line, padded to nine fraction digits so that the strings sort by time. */
export function splitTimestamp(line: string): { time: string; text: string } | undefined {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z (.*)$/s.exec(line);
  if (!match) return undefined;
  return { time: `${match[1]}.${(match[2] ?? '').padEnd(9, '0')}Z`, text: match[3] };
}

const ESCAPES = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g;
/** Text that is safe to show and short: escape sequences removed, tabs as a space, other control characters as U+FFFD, capped. */
export function cleanLogText(text: string): string {
  const clean = text.replace(ESCAPES, '').replace(/\t/g, ' ').replace(/[\x00-\x1f\x7f-\x9f]/g, '�');
  return clean.length > MAX_LINE_CHARS ? `${clean.slice(0, MAX_LINE_CHARS)}…` : clean;
}

/** Containers of a pod that have started at least once (running, terminated or a terminated last run), with a key per container instance. */
export function startedContainers(pod: KubeObject): { container: string; instance: string }[] {
  const statuses = list(rec(pod.status).containerStatuses).map(rec);
  return list(rec(pod.spec).containers).map(rec).flatMap(container => {
    const name = typeof container.name === 'string' ? container.name : '';
    const status = statuses.find(item => item.name === name);
    const state = rec(status?.state);
    const started = rec(state.running).startedAt ?? rec(state.terminated).startedAt ?? rec(rec(rec(status?.lastState).terminated)).startedAt;
    if (!name || typeof started !== 'string') return [];
    return [{ container: name, instance: `${String(status?.restartCount ?? 0)}/${started}` }];
  });
}

interface Source {
  key: string;
  info: KubeLogSource;
  /** Restart count and start time of the container instance read last. */
  instance?: string;
  stream?: KubeStream;
  /** Identifies the current stream; callbacks of an older stream are ignored. */
  token?: symbol;
  decoder: StringDecoder;
  pending: string;
  /** Normalised server time of the newest line, for sinceTime on a reopen. */
  lastTime: string;
  /** After a reopen: lines up to this time were read before and are skipped. */
  skipUntil?: string;
}

const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** One run of "Logs aller Pods": a pod watcher for the selector and one log stream per started container. */
class LogRun {
  stopped = false;
  private api?: KubeApi;
  private watcher?: ResourceWatcher;
  private readonly sources: Source[] = [];
  private pods: KubeObject[] = [];
  private lines: KubeLogLine[] = [];
  private waiting = 0;
  private dropped = 0;
  private error?: CodedError;
  /** The renderer has not seen the current state; true at the start, so the first sync reports even without pods. */
  private dirty = true;
  private timer: unknown;
  private timed = false;

  constructor(readonly view: LogsView, readonly request: LogsRequest, private readonly emit: LogsEmit, private readonly timers: LogsTimers) {}

  start(api: KubeApi): void {
    this.api = api;
    this.watcher = new ResourceWatcher(api, { kind: 'pods', namespace: this.request.namespace, selector: { labels: this.request.selector } },
      () => {},
      error => { this.error = error; this.dirty = true; this.touch(); },
      { schedule: this.timers.schedule, cancel: this.timers.cancel, onObjects: objects => { this.pods = objects; this.sync(); } });
    void this.watcher.start();
  }

  stop(): void {
    this.stopped = true;
    this.watcher?.stop();
    for (const source of this.sources) {
      const stream = source.stream;
      source.token = undefined;
      source.stream = undefined;
      stream?.close();
    }
    if (this.timed) this.timers.cancel(this.timer);
    this.timed = false;
  }

  /** Opens a stream for every started container that has none, pods by name, at most MAX_LOG_STREAMS at once. */
  private sync(): void {
    if (this.stopped || !this.api) return;
    const named = this.pods
      .map(pod => ({ pod, name: typeof pod.metadata?.name === 'string' ? pod.metadata.name : '' }))
      .filter(entry => entry.name !== '')
      .sort((a, b) => byName(a.name, b.name));
    let waiting = 0;
    for (const { pod, name } of named) {
      for (const { container, instance } of startedContainers(pod)) {
        const key = `${name}/${container}`;
        const known = this.sources.find(source => source.key === key);
        // Live, or this container instance was already read to its end.
        if (known?.stream || known?.instance === instance) continue;
        if (this.openStreams() >= MAX_LOG_STREAMS || (!known && this.sources.length >= MAX_LOG_SOURCES)) { waiting++; continue; }
        this.open(known ?? this.add(key, name, container), instance);
      }
    }
    if (waiting !== this.waiting) { this.waiting = waiting; this.dirty = true; }
    this.touch();
  }

  private add(key: string, pod: string, container: string): Source {
    const source: Source = { key, info: { pod, container, live: false }, decoder: new StringDecoder('utf8'), pending: '', lastTime: '' };
    this.sources.push(source);
    return source;
  }

  private openStreams(): number {
    return this.sources.filter(source => source.stream !== undefined).length;
  }

  private open(source: Source, instance: string): void {
    const api = this.api;
    if (!api) return;
    const { pod, container } = source.info;
    const token = Symbol('stream');
    source.token = token;
    source.instance = instance;
    source.info = { pod, container, live: true };
    source.decoder = new StringDecoder('utf8');
    source.pending = '';
    // A restarted container continues after the newest line read; sinceTime has whole seconds, so addLine skips what was read before.
    source.skipUntil = source.lastTime || undefined;
    const start = source.lastTime ? { sinceTime: `${source.lastTime.slice(0, 19)}Z` } : { tailLines: LOG_TAIL_LINES };
    this.dirty = true;
    const stream = api.followLog({ namespace: this.request.namespace, pod, container, mode: 'logs' }, start, {
      data: chunk => { if (source.token === token) this.feed(source, chunk); },
      end: (_code, error) => {
        if (source.token !== token || this.stopped) return;
        this.flushPending(source);
        source.token = undefined;
        source.stream = undefined;
        source.info = { pod, container, live: false, ...(error ? { error } : {}) };
        this.dirty = true;
        // A waiting container may take the free slot.
        this.sync();
      },
    });
    if (source.token === token) source.stream = stream;
  }

  private feed(source: Source, chunk: Buffer): void {
    if (this.stopped) return;
    const parts = (source.pending + source.decoder.write(chunk)).split('\n');
    source.pending = parts.pop() ?? '';
    if (source.pending.length > MAX_PENDING_CHARS) { parts.push(source.pending); source.pending = ''; }
    for (const part of parts) this.addLine(source, part);
    this.touch();
  }

  private flushPending(source: Source): void {
    const rest = source.pending + source.decoder.end();
    source.pending = '';
    if (rest !== '') this.addLine(source, rest);
  }

  private addLine(source: Source, raw: string): void {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const stamped = splitTimestamp(line);
    if (source.skipUntil !== undefined) {
      if (stamped && stamped.time <= source.skipUntil) return;
      source.skipUntil = undefined;
    }
    if (stamped) source.lastTime = stamped.time;
    const body = stamped ? stamped.text : line;
    const text = cleanLogText(this.request.format === 'compact' ? formatLogLine(body) : body);
    // A flood is cut here already, so main never holds more than two batches of lines.
    if (this.lines.length >= 2 * MAX_BATCH_LINES) {
      this.dropped += MAX_BATCH_LINES;
      this.lines = this.lines.slice(MAX_BATCH_LINES);
    }
    this.lines.push({ source: this.sources.indexOf(source), time: stamped ? stamped.time : source.lastTime, text });
    this.dirty = true;
  }

  private touch(): void {
    if (!this.dirty || this.stopped || this.timed) return;
    this.timed = true;
    this.timer = this.timers.schedule(() => this.flush(), LOG_BATCH_MS);
  }

  private flush(): void {
    this.timed = false;
    if (this.stopped) return;
    let lines = this.lines;
    this.lines = [];
    if (lines.length > MAX_BATCH_LINES) {
      this.dropped += lines.length - MAX_BATCH_LINES;
      lines = lines.slice(-MAX_BATCH_LINES);
    }
    this.dirty = false;
    this.emit(this.view.ownerId, this.view.viewId, {
      id: this.request.id, lines, sources: this.sources.map(source => source.info), waiting: this.waiting, dropped: this.dropped,
      ...(this.error ? { error: this.error } : {}),
    });
  }
}

/** "Logs aller Pods" of every view: at most one run per view; reading only (list/watch pods, get pods/log). */
export class KubeWorkloadLogs {
  private readonly runs = new Map<string, LogRun>();

  constructor(private readonly emit: LogsEmit, private readonly timers: LogsTimers = { schedule: defaultSchedule, cancel: defaultCancel }) {}

  /** Replaces the view's run. Resolves once the run has its API client; rejects when the cluster does not get ready. */
  async start(view: LogsView, request: LogsRequest): Promise<void> {
    this.stopView(view.viewId);
    const run = new LogRun(view, request, this.emit, this.timers);
    this.runs.set(view.viewId, run);
    let api: KubeApi;
    try {
      api = await view.api();
    } catch (error) {
      if (this.runs.get(view.viewId) === run) this.stopView(view.viewId);
      throw error;
    }
    if (!run.stopped) run.start(api);
  }

  /** Stops the run `id` of a view; a newer run of the view stays. */
  stop(viewId: string, id: string): void {
    if (this.runs.get(viewId)?.request.id === id) this.stopView(viewId);
  }

  stopView(viewId: string): void {
    this.runs.get(viewId)?.stop();
    this.runs.delete(viewId);
  }

  stopAll(): void {
    for (const viewId of [...this.runs.keys()]) this.stopView(viewId);
  }
}
```

### 3.6 `src/main/kubernetes/session.ts` und `ipc.ts` (Task H)

**session.ts:**
- Imports ergänzen:
  - `deniedAccess` und `type KubeDenied` aus `../../shared/kube-access`;
  - `KubeWorkloadLogs` und `type LogsRequest` aus `./workload-logs`.
- Konstante neben `READY_WAIT_MS`:

```ts
/** A rules review that takes longer counts as unknown: nothing is greyed out. */
const ACCESS_TIMEOUT_MS = 10_000;
```

In `KubeSessions` das Feld `private readonly logs: KubeWorkloadLogs;` anlegen. Im Konstruktor nach `this.forwards = …`:

```ts
    this.logs = new KubeWorkloadLogs((ownerId, viewId, batch) => deps.emit(ownerId, { type: 'logs', viewId, ...batch }),
      { schedule: this.options.schedule, cancel: this.options.cancel });
```

Neue Methoden nach `stopForward`:

```ts
  /** Logs of all pods of a selector in a view. Reading: allowed on read-only clusters, refused on disabled ones. */
  async startLogs(ownerId: number, viewId: string, request: LogsRequest): Promise<void> {
    const view = this.viewOf(ownerId, viewId);
    // Read at each call; reading the vault also refuses while it is locked.
    if (this.deps.getCluster(view.session.clusterId).disabled) throw new AppError(DISABLED);
    view.session.requireApi();
    await this.logs.start({ ownerId, viewId, api: () => view.session.waitReady() }, request);
    // The view closed while the run started: it must not outlive the view.
    if (this.views.get(viewId) !== view) {
      this.logs.stopView(viewId);
      throw new AppError(NOT_AVAILABLE);
    }
  }

  stopLogs(ownerId: number, viewId: string, id: string): void {
    this.viewOf(ownerId, viewId);
    this.logs.stop(viewId, id);
  }

  /** RBAC pre-check of one namespace. null whenever the answer cannot be trusted: forbidden, not served, incomplete, failed or slow. */
  async access(ownerId: number, viewId: string, namespace: string): Promise<KubeDenied[] | null> {
    const api = this.viewOf(ownerId, viewId).session.requireApi();
    let timer: unknown;
    const late = new Promise<null>(resolve => { timer = this.options.schedule(() => resolve(null), ACCESS_TIMEOUT_MS); });
    try {
      return await Promise.race([
        api.rulesReview(namespace).then(review => (review.incomplete ? null : deniedAccess(review.rules)), () => null),
        late,
      ]);
    } finally {
      this.options.cancel(timer);
    }
  }
```

In `close` nach `this.forwards.stopView(viewId);` ergänzen: `this.logs.stopView(viewId);`. In `closeAll` nach `this.forwards.stopAll();` ergänzen: `this.logs.stopAll();`.

**ipc.ts:** Die drei Schemas importieren. Nach dem Handler `kubeForwardStop`:

```ts
  handle(IPC_CHANNELS.kubeLogsStart, (event, request) => {
    const ownerId = requireSshSender(event);
    const parsed = parseRequest(KubeLogsStartRequestSchema, request);
    return sessions.startLogs(ownerId, parsed.viewId, { id: parsed.id, namespace: parsed.namespace, selector: parsed.selector, format: parsed.format });
  });
  handle(IPC_CHANNELS.kubeLogsStop, (event, request) => {
    const ownerId = requireSshSender(event);
    const parsed = parseRequest(KubeLogsStopRequestSchema, request);
    sessions.stopLogs(ownerId, parsed.viewId, parsed.id);
  });
  handle(IPC_CHANNELS.kubeAccess, (event, request) => {
    const ownerId = requireSshSender(event);
    const parsed = parseRequest(KubeAccessRequestSchema, request);
    return sessions.access(ownerId, parsed.viewId, parsed.namespace);
  });
```

In `session.test.ts` (Task H) bekommt `FakeApi` die Methoden `followLog` und `rulesReview` (siehe 10.5).

### 3.7 Renderer-Zustand (Task E)

**`src/renderer/src/kube-access.ts`** (neu):

```ts
import { ACCESS_TTL_MS, type KubeAccessEntry, type KubeAccessId } from '../../shared/kube-access';
import { KIND_INFO, type ClusterStatus, type KubeRef } from '../../shared/kubernetes';
import { t } from './i18n';

/** Answers of the RBAC pre-check per namespace, as kept in KubeViewState.access. */
export type KubeAccessMap = Record<string, KubeAccessEntry>;

/** Namespace whose rules apply: the object's own; cluster-scoped kinds use the cluster's default namespace (ClusterRoleBindings show in every namespace). */
export function accessNamespace(ref: KubeRef, status: ClusterStatus | null): string {
  return KIND_INFO[ref.kind].namespaced && ref.namespace ? ref.namespace : status?.namespace ?? 'default';
}

/** True when the namespace has no answer yet or one older than ACCESS_TTL_MS. */
export function accessStale(access: KubeAccessMap, namespace: string, now: number): boolean {
  const entry = access[namespace];
  return entry === undefined || now - entry.at > ACCESS_TTL_MS;
}

/** Why the account may not use `id` on `ref`; undefined when it may or when nothing is known. */
export function refAccessReason(access: KubeAccessMap, status: ClusterStatus | null, ref: KubeRef, id: KubeAccessId): string | undefined {
  const namespace = accessNamespace(ref, status);
  const denied = access[namespace]?.denied?.find(item => item.id === id);
  if (!denied) return undefined;
  return KIND_INFO[ref.kind].namespaced
    ? t('kubeActions:reasons.forbidden', { verb: denied.verb, resource: denied.resource, namespace })
    : t('kubeActions:reasons.forbiddenClusterWide', { verb: denied.verb, resource: denied.resource });
}
```

**`src/renderer/src/kube-logs.ts`** (neu):

```ts
import { foldCase } from '../../shared/format';
import type { KubeLogLine, KubeLogSource } from '../../shared/kubernetes';

/** A received line with its arrival number: React key and tie-break for equal times. */
export interface LogEntry extends KubeLogLine { seq: number }
export const MAX_BUFFER_LINES = 10_000;
export const DISPLAY_LINES = 2_000;
/** Number of --color-source-* tokens; sources beyond reuse them. */
export const SOURCE_COLORS = 4;

/** Inserts lines after the last line with the same or an older time (stable; lines without time go to the end) and keeps the newest `max`. */
export function mergeLines(buffer: readonly LogEntry[], lines: readonly KubeLogLine[], firstSeq: number, max: number): LogEntry[] {
  const out = buffer.slice();
  lines.forEach((line, index) => {
    let at = out.length;
    if (line.time !== '') while (at > 0 && out[at - 1].time > line.time) at--;
    out.splice(at, 0, { ...line, seq: firstSeq + index });
  });
  return out.length > max ? out.slice(out.length - max) : out;
}

export const sourceLabel = (source: KubeLogSource | undefined): string => (source ? `${source.pod}/${source.container}` : '?');

/** Lines of shown sources that contain `filter` (in prefix or text, case-insensitive); the newest `limit`, and how many matches were left out. */
export function shownLines(lines: readonly LogEntry[], sources: readonly KubeLogSource[], hidden: ReadonlySet<number>, filter: string,
  limit: number = DISPLAY_LINES): { lines: LogEntry[]; hiddenOlder: number } {
  const needle = foldCase(filter.trim());
  const matches = lines.filter(line => !hidden.has(line.source)
    && (needle === '' || foldCase(`${sourceLabel(sources[line.source])} ${line.text}`).includes(needle)));
  return matches.length > limit ? { lines: matches.slice(matches.length - limit), hiddenOlder: matches.length - limit } : { lines: matches, hiddenOlder: 0 };
}

/** HH:MM:SS.mmm of a server timestamp, UTC like the compact log format; '' without one. */
export const logTime = (time: string): string => time.slice(11, 23);

/** Text split around the case-insensitive matches of `filter`. shortcut: no marks when case folding changes the length (rare scripts); matching lines are still filtered. */
export function highlightParts(text: string, filter: string): { text: string; mark: boolean }[] {
  const needle = foldCase(filter.trim());
  const folded = foldCase(text);
  if (needle === '' || folded.length !== text.length) return [{ text, mark: false }];
  const parts: { text: string; mark: boolean }[] = [];
  let from = 0;
  for (let at = folded.indexOf(needle); at >= 0; at = folded.indexOf(needle, at + needle.length)) {
    if (at > from) parts.push({ text: text.slice(from, at), mark: false });
    parts.push({ text: text.slice(at, at + needle.length), mark: true });
    from = at + needle.length;
  }
  if (from < text.length) parts.push({ text: text.slice(from), mark: false });
  return parts.length > 0 ? parts : [{ text, mark: false }];
}

/** Lines as plain text for the clipboard: `<pod>/<container> <HH:MM:SS.mmm> <text>`. */
export function logsText(lines: readonly LogEntry[], sources: readonly KubeLogSource[]): string {
  return lines.map(line => `${sourceLabel(sources[line.source])} ${logTime(line.time)} ${line.text}`).join('\n');
}

export function toggleSource(hidden: ReadonlySet<number>, index: number): ReadonlySet<number> {
  const next = new Set(hidden);
  if (next.has(index)) next.delete(index);
  else next.add(index);
  return next;
}
```

**`src/renderer/src/kube-view.ts`:**
- Imports: `type KubeAccessEntry` aus `../../shared/kube-access`, `type KubeAccessMap` aus `./kube-access`.
- `KubeViewState` ergänzen:

```ts
  /** RBAC pre-check per namespace; never saved, emptied whenever the cluster is not ready. */
  access: KubeAccessMap;
```

- `KubeViewAction` ergänzen: `| { type: 'access'; namespace: string; entry: KubeAccessEntry }`.
- `initialKubeView`: `access: {}` ergänzen.
- `reduce`: `case 'access': return { ...state, access: { ...state.access, [action.namespace]: action.entry } };`.
- `applyEvent`: `case 'logs': return state;`. Die Zeilen holt sich `WorkloadLogs` selbst (3.10).
- In `applyStatus` die erste Zeile ersetzen durch:

```ts
  // Rights are asked again after a reconnect: an answer from before may be out of date.
  const next = { ...state, status, ...(status.state !== 'ready' && Object.keys(state.access).length > 0 ? { access: {} } : {}) };
```

**`src/renderer/src/hooks/useClusterSession.ts`:**
- Den Import `KubeLogsStartRequest` ergänzen.
- Den Ereignis-Listener ersetzen durch:

```ts
    return window.desktopApi.onKubeEvent(event => {
      // Log batches go straight to WorkloadLogs; the reducer would only return the same state.
      if (event.viewId === viewId && event.type !== 'logs') dispatch({ type: 'event', event, at: Date.now() });
    });
```

- Nach `stopForward`:

```ts
  const startLogs = useCallback((request: Omit<KubeLogsStartRequest, 'viewId'>): Promise<void> => {
    const id = viewIdRef.current;
    if (!id) return Promise.reject(new Error(t('kubernetes:viewNotOpen')));
    return window.desktopApi.kubeLogsStart({ ...request, viewId: id });
  }, []);

  const stopLogs = useCallback((logsId: string): Promise<void> => {
    const id = viewIdRef.current;
    if (!id) return Promise.resolve();
    return window.desktopApi.kubeLogsStop({ viewId: id, id: logsId });
  }, []);

  // One request per namespace at a time; a failed request counts as unknown (nothing greyed out) until it is stale.
  const accessPending = useRef(new Set<string>());
  const ensureAccess = useCallback((namespace: string): void => {
    const id = viewIdRef.current;
    if (!id || accessPending.current.has(namespace)) return;
    accessPending.current.add(namespace);
    void window.desktopApi.kubeAccess({ viewId: id, namespace }).catch(() => null).then(denied => {
      accessPending.current.delete(namespace);
      dispatch({ type: 'access', namespace, entry: { at: Date.now(), denied } });
    });
  }, []);
```

- Die Rückgabe um `startLogs, stopLogs, ensureAccess` ergänzen.

**Texte (Task E)** in `src/shared/locales/{de-DE,en-US}/kubeActions.json`, im Block `reasons` nach `noTcpPort`:

| Key | de-DE | en-US |
|---|---|---|
| `forbidden` | `Keine Berechtigung: {{verb}} auf {{resource}} in {{namespace}}` | `No permission: {{verb}} on {{resource}} in {{namespace}}` |
| `forbiddenClusterWide` | `Keine Berechtigung: {{verb}} auf {{resource}} (clusterweit)` | `No permission: {{verb}} on {{resource}} (cluster-wide)` |

### 3.8 Tokens (Task T)

**`src/renderer/src/tokens.css`**, im dunklen `:root` nach `--color-danger-border`:

```css
  /* Source colours: only the text colour of a log line's origin in "Logs aller Pods" (prefix and chip); never a state, surface or border. */
  --color-source-1: #7cb7ff;
  --color-source-2: #c4a5ff;
  --color-source-3: #5fd4d4;
  --color-source-4: #e59af0;
```

Im hellen Block nach `--color-danger-border`:

```css
    --color-source-1: #1d5fb8;
    --color-source-2: #6b3fb8;
    --color-source-3: #0f6f73;
    --color-source-4: #9a2f8f;
```

**`design-tokens.test.ts`:** In `COLORS` nach `'danger-border'` die Namen `'source-1', 'source-2', 'source-3', 'source-4'` ergänzen.

**`src/renderer/src/styles.css`:** In der `:not()`-Liste der Druckregel am Dateiende `.kube-logs-chip` ergänzen. Der Chip ist ein flacher Umschalter wie `.kube-filter-chip`.

**`docs/design-system.md`:**
- „Roter Faden“, Punkt 3, am Ende ergänzen: „Einzige Ausnahme sind die vier Quellenfarben `--color-source-1` bis `-4`: Sie unterscheiden nur die Herkunft einer Logzeile in „Logs aller Pods“ und sind nie Zustand, Fläche oder Rand.“
- Farbtabelle: vier Zeilen nach `--color-danger-border`, Rolle „Herkunft einer Logzeile (nur Text)“, Beispiel `.kube-logs-src-0` bis `-3`.
- Tabelle „Helles Theme“: vier Zeilen mit den Werten und Kontrasten aus R3.5.
- „Ausnahmeliste für das Druck-Feedback“: `.kube-logs-chip` ergänzen.

### 3.9 Menüs und Befehle (Task I1)

**`kube-menus.ts`:**
- Imports ergänzen: `type KubeAccessId` aus `../../shared/kube-access` und `refAccessReason` aus `./kube-access`.
- In `MenuAction` nach `forward` ergänzen: `| { type: 'logsAll'; row: KubeRow }`.
- Helfer hinter `hasSelector` (`:84`):

```ts
const forbidden = (env: Env, ref: KubeRef, id: KubeAccessId): string | undefined => refAccessReason(env.ctx.state.access, env.ctx.status, ref, id);
const NO_SELECTOR_KEYS = {
  deployments: 'kubeActions:reasons.noSelectorWorkload', statefulsets: 'kubeActions:reasons.noSelectorWorkload', daemonsets: 'kubeActions:reasons.noSelectorWorkload',
  jobs: 'kubeActions:reasons.noSelectorJob', services: 'kubeActions:reasons.noSelectorService',
} as const;
```

- `kubeActionItem` (`:97-99`): `actionReason(action, { ref, readOnly: env.readOnly, connected: env.connected, reconnecting: env.reconnecting, access: env.ctx.state.access, status: env.ctx.status })`.
- `terminalItems` (`:137-145`), die zwei Gründe:

```ts
  const logsReason = (container ? connectedReason(env) : t('kubeActions:reasons.noContainer')) ?? forbidden(env, pod.ref, 'logs');
  const shellReason = (env.readOnly ? readOnlyReason() : connectedReason(env) ?? (podNotRunning(pod) ? t('kubeActions:reasons.notRunning') : undefined) ?? (container ? undefined : t('kubeActions:reasons.noContainer')))
    ?? forbidden(env, pod.ref, 'shell');
```

- `popoutItems` (`:147-156`): An `logsReason` `?? forbidden(env, pod.ref, 'logs')` anhängen, an `shellReason` `?? forbidden(env, pod.ref, 'shell')`, beide Male in Klammern wie oben.
- `forwardItem` (`:158-164`): Den Ausdruck für `reason` in Klammern setzen und `?? forbidden(env, row.ref, 'forward')` anhängen.
- Neue Funktion hinter `forwardItem`:

```ts
/** "Logs aller Pods": workloads, jobs and services with a selector. Reading, so read-only clusters allow it. */
function logsAllItem(env: Env, row: KubeRow): MenuEntry {
  const kind = row.ref.kind as keyof typeof NO_SELECTOR_KEYS;
  const reason = connectedReason(env) ?? (hasSelector(row) ? forbidden(env, row.ref, 'logsAll') : t(NO_SELECTOR_KEYS[kind]));
  return item(env, 'logs-all', t('kubeActions:menu.logsAll'), { type: 'logsAll', row }, { reason });
}
```

- In `workloadGroups`, `jobGroups` und `serviceGroups` wird die Gruppe `viewItems(env, [select(row)])` zu `[logsAllItem(env, row), ...viewItems(env, [select(row)])]`.
- `eventGroups`, Eintrag `involved-logs`: `{ reason: viaConnection ?? (ref ? forbidden(env, ref, 'logs') : undefined) }`.
- `problemMenu`: Bei `previous` und `logs` lautet der Grund `reason ?? forbidden(env, ref, 'logs')`.
- `dockMenu`:
  - `mode-logs` und `previous` bekommen den Grund `podOnly ?? reason ?? (pod ? forbidden(env, pod.ref, 'logs') : undefined)`.
  - An `shellReason` `?? (pod ? forbidden(env, pod.ref, 'shell') : undefined)` anhängen.

**`kube-menu-run.ts`:** In `MenuRunner` nach `forward`:

```ts
  /** Selects the row, opens the Logs tab of the dock and starts the logs of all its pods. */
  logsAll(row: KubeRow): void;
```

In `runMenuAction` ergänzen: `case 'logsAll': runner.logsAll(action.row); return;`.

**`kube-commands.ts`:**
- Imports:
  - `type ClusterStatus` aus `../../shared/kubernetes`;
  - `actionAccess` aus `../../shared/kube-access`;
  - `refAccessReason` und `type KubeAccessMap` aus `./kube-access`.
- `ActionContext` ergänzen:

```ts
  /** RBAC pre-check per namespace; absent or unknown = allowed. */
  access?: KubeAccessMap;
  status?: ClusterStatus | null;
```

- In `actionReason` die letzte Zeile `return undefined;` ersetzen durch:

```ts
  const id = context.access ? actionAccess(action, context.ref.kind) : undefined;
  return id && context.access ? refAccessReason(context.access, context.status ?? null, context.ref, id) : undefined;
```

  Die Doku-Zeile über `actionReason` endet nun mit „…, ref, rights.“
- `actionUnavailable`: im Objekt `access: context.state.access, status: context.state.status` ergänzen.
- Hinter `onlyForPods`:

```ts
const accessOfSelection = (context: CommandContext, id: 'logs' | 'shell'): string | undefined => {
  const row = selectedRow(context.state);
  return row ? refAccessReason(context.state.access, context.state.status, row.ref, id) : undefined;
};
```

- Letzte Zeile von `shellUnavailable`: `return onlyForPods(context) ?? (podNotRunning(selectedRow(context.state)) ? t('kubeActions:reasons.notRunning') : undefined) ?? accessOfSelection(context, 'shell');`
- Befehle `logs` und `previous`: `unavailable: context => onlyForPods(context) ?? accessOfSelection(context, 'logs')`.

**Texte (Task I1)** in `kubeActions.json`, Block `menu`, nach `forward`:

| Key | de-DE | en-US |
|---|---|---|
| `logsAll` | `Logs aller Pods` | `Logs of all pods` |

### 3.10 `src/renderer/src/components/kubernetes/WorkloadLogs.tsx` (neu, Task I2)

```tsx
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { MAX_LOG_STREAMS, type KubeLogSource, type KubeLogsStartRequest, type KubeRow } from '../../../../shared/kubernetes';
import { errorText } from '../../error-text';
import { useT } from '../../i18n';
import { MAX_BUFFER_LINES, SOURCE_COLORS, highlightParts, logTime, logsText, mergeLines, shownLines, sourceLabel, toggleSource, type LogEntry } from '../../kube-logs';

/** Below this many pixels from the end, the list counts as following. */
const SCROLL_SLACK = 8;

interface WorkloadLogsProps {
  viewId: string | null;
  row: KubeRow;
  format: 'compact' | 'raw';
  start: (request: Omit<KubeLogsStartRequest, 'viewId'>) => Promise<void>;
  stop: (id: string) => Promise<void>;
  /** Set to a function that returns all matching lines as text, for the dock's copy button. */
  textRef: MutableRefObject<(() => string) | null>;
}

/** "Logs aller Pods": one run per mount; the dock remounts it (key) for another row, another format or after a reconnect. */
export function WorkloadLogs({ viewId, row, format, start, stop, textRef }: WorkloadLogsProps) {
  const { t } = useT();
  const [log, setLog] = useState<{ entries: LogEntry[]; received: number }>({ entries: [], received: 0 });
  const [sources, setSources] = useState<KubeLogSource[]>([]);
  const [waiting, setWaiting] = useState(0);
  const [dropped, setDropped] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState('');
  const [hidden, setHidden] = useState<ReadonlySet<number>>(() => new Set());
  // Not following: the lines as they were when following stopped, and how many had arrived by then.
  const [frozen, setFrozen] = useState<{ entries: LogEntry[]; received: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const namespace = row.ref.namespace ?? '';
  const selectorKey = JSON.stringify(row.selector ?? {});

  useEffect(() => {
    if (!viewId) return;
    const id = crypto.randomUUID();
    const off = window.desktopApi.onKubeEvent(event => {
      if (event.type !== 'logs' || event.viewId !== viewId || event.id !== id) return;
      setLog(current => ({ entries: mergeLines(current.entries, event.lines, current.received, MAX_BUFFER_LINES), received: current.received + event.lines.length }));
      setSources(event.sources);
      setWaiting(event.waiting);
      setDropped(event.dropped);
      setError(event.error ? errorText(event.error) : null);
      setLoaded(true);
    });
    start({ id, namespace, selector: JSON.parse(selectorKey) as Record<string, string>, format }).catch((caught: unknown) => setError(errorText(caught)));
    return () => {
      off();
      void stop(id).catch(() => {});
    };
  }, [viewId, namespace, selectorKey, format, start, stop]);

  const current = frozen ?? log;
  const { lines, hiddenOlder } = useMemo(() => shownLines(current.entries, sources, hidden, filter), [current.entries, sources, hidden, filter]);
  const following = frozen === null;
  const newer = frozen ? log.received - frozen.received : 0;

  useEffect(() => {
    textRef.current = () => logsText(shownLines(current.entries, sources, hidden, filter, Number.POSITIVE_INFINITY).lines, sources);
    return () => { textRef.current = null; };
  }, [textRef, current.entries, sources, hidden, filter]);

  // Following keeps the newest line in view; no smooth scrolling (motion gate).
  useLayoutEffect(() => {
    const list = listRef.current;
    if (following && list) list.scrollTop = list.scrollHeight;
  }, [lines, following]);

  const freeze = () => setFrozen({ entries: log.entries, received: log.received });
  const onScroll = () => {
    const list = listRef.current;
    if (following && list && list.scrollHeight - list.scrollTop - list.clientHeight > SCROLL_SLACK) freeze();
  };

  const live = sources.filter(source => source.live).length;
  const stateText = error ?? (!loaded ? t('kubernetes:logsAll.loading')
    : sources.length === 0 ? t('kubernetes:logsAll.noPods')
    : [
      t('kubernetes:logsAll.summary', { shown: live, total: sources.length }),
      ...(waiting > 0 ? [t('kubernetes:logsAll.waiting', { count: waiting, max: MAX_LOG_STREAMS })] : []),
      ...(dropped > 0 ? [t('kubernetes:logsAll.dropped', { count: dropped })] : []),
    ].join(' · '));

  return (
    <div className="kube-logs">
      <div className="kube-logs-bar">
        <input type="search" className="kube-logs-filter" value={filter} placeholder={t('kubernetes:logsAll.filter')} aria-label={t('kubernetes:logsAll.filterLabel')}
          onChange={event => { setFilter(event.target.value); if (frozen) freeze(); }} />
        <button type="button" className="kube-logs-follow" aria-pressed={following} onClick={() => (following ? freeze() : setFrozen(null))}>
          {newer > 0 ? t('kubernetes:logsAll.followNew', { count: newer }) : t('kubernetes:logsAll.follow')}
        </button>
        <span className={error ? 'kube-logs-state error-message' : 'kube-muted kube-logs-state'} role="status">{stateText}</span>
      </div>
      {sources.length > 0 && (
        <div className="kube-logs-sources" role="group" aria-label={t('kubernetes:logsAll.sources')}>
          {sources.map((source, index) => (
            <button key={sourceLabel(source)} type="button" aria-pressed={!hidden.has(index)} title={source.error ? errorText(source.error) : undefined}
              className={`kube-logs-chip kube-logs-src-${index % SOURCE_COLORS}${source.live ? '' : ' kube-logs-chip-ended'}`}
              onClick={() => setHidden(value => toggleSource(value, index))}>
              {source.live ? sourceLabel(source) : `${sourceLabel(source)} · ${source.error ? t('kubernetes:logsAll.failed') : t('kubernetes:logsAll.ended')}`}
            </button>
          ))}
        </div>
      )}
      <div ref={listRef} className="kube-logs-lines" role="log" aria-live="off" aria-label={t('kubernetes:logsAll.linesLabel')} tabIndex={0} onScroll={onScroll}>
        {hiddenOlder > 0 && <p className="kube-muted kube-logs-more">{t('kubernetes:logsAll.olderHidden', { count: hiddenOlder })}</p>}
        {lines.map(line => (
          <div key={line.seq} className="kube-logs-line">
            <span className={`kube-logs-src kube-logs-src-${line.source % SOURCE_COLORS}`}>{sourceLabel(sources[line.source])}</span>
            <span className="kube-logs-time">{logTime(line.time)}</span>
            <span>{highlightParts(line.text, filter).map((part, index) => (part.mark ? <mark key={index}>{part.text}</mark> : part.text))}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

### 3.11 `DetailDock.tsx` (Task I2)

- Imports ergänzen (`useRef` ist schon da):
  - `MAX_LOG_STREAMS` und `type KubeLogsStartRequest` aus Shared;
  - `WorkloadLogs` aus `./WorkloadLogs`.
- Props ergänzen:

```ts
  viewId: string | null;
  /** Selected workload, job or service with a selector: the Logs tab shows the logs of all its pods. */
  workload: KubeRow | null;
  /** The logs of all pods of `workload` were started (menu or button); dropped when the selection moves. */
  logsAllArmed: boolean;
  /** Why "Logs aller Pods anzeigen" is blocked (not connected, no permission). */
  logsAllReason?: string | undefined;
  onArmLogsAll: () => void;
  startLogs: (request: Omit<KubeLogsStartRequest, 'viewId'>) => Promise<void>;
  stopLogs: (id: string) => Promise<void>;
  /** Missing RBAC permission for the shell of the selected pod. */
  shellForbidden?: string | undefined;
```

- Im Rumpf nach `const currentResult = …`:

```ts
  const workloadText = useRef<(() => string) | null>(null);
  const workloadShown = mode === 'logs' && workload !== null;
  const shellBlocked = readOnly ? t('errors:kubernetes.readOnly') : shellForbidden;
```

- `copyLabel` beginnt mit `workloadShown ? t('kubernetes:logsAll.linesLabel') : …`.
- `copyText` beginnt mit `if (workloadShown) return workloadText.current?.() ?? '';`.
- `nothingToCopy` wird zu `workloadShown ? !logsAllArmed : (bisheriger Ausdruck)`.
- Im Body vor `{terminalKind ? (` diesen Zweig einsetzen:

```tsx
        {workloadShown && workload ? (
          logsAllArmed ? (
            <WorkloadLogs key={`${refKey(workload.ref)}/${logFormat}/${epoch}`} viewId={viewId} row={workload} format={logFormat}
              start={startLogs} stop={stopLogs} textRef={workloadText} />
          ) : (
            <div className="kube-placeholder">
              <p>{t('kubernetes:logsAll.onDemand', { name: workload.ref.name, max: MAX_LOG_STREAMS })}</p>
              <button type="button" className="primary-button" disabled={Boolean(logsAllReason)} title={logsAllReason} onClick={onArmLogsAll}>
                {t('kubernetes:logsAll.start')}
              </button>
              {logsAllReason && <p className="kube-muted">{logsAllReason}</p>}
            </div>
          )
        ) : terminalKind ? (
```

- Shell-Platzhalter (`:173-176`):
  - Der Knopf bekommt `disabled={Boolean(shellBlocked)} title={shellBlocked}`.
  - Statt der `readOnly`-Zeile steht darunter `{shellBlocked && <p className="kube-muted">{shellBlocked}</p>}`.

### 3.12 `ClusterView.tsx` (Task I2)

- Imports: `LOGS_ALL_KINDS` aus Shared; `accessNamespace`, `accessStale` und `refAccessReason` aus `../../kube-access`.
- Aus `useClusterSession` zusätzlich `viewId, startLogs, stopLogs, ensureAccess` übernehmen.
- Die Zeile `const statusState = status?.state;` direkt unter `const status = state.status;` verschieben, weil der Code unten sie früher braucht.
- Neuer State: `const [logsAllFor, setLogsAllFor] = useState<string | null>(null);`
- Nach `if (armedFor !== null && !armed) setArmedFor(null);`:

```ts
  // "Logs aller Pods" follows the selected workload, job or service. Like the shell it starts only on demand and ends when the selection moves.
  const workloadRow = !state.containersOf && selectedRow && LOGS_ALL_KINDS.includes(selectedRow.ref.kind) && Object.keys(selectedRow.selector ?? {}).length > 0 ? selectedRow : null;
  const logsAllArmed = settleArm(logsAllFor, workloadRow ? refKey(workloadRow.ref) : null) !== null;
  if (logsAllFor !== null && !logsAllArmed) setLogsAllFor(null);

  // RBAC pre-check: the view's namespace, the selected row's and the default one (cluster-wide kinds); fetched again when stale.
  const accessKey = [state.query.namespace, selectedRow ? accessNamespace(selectedRow.ref, status) : null, status?.namespace ?? 'default']
    .filter((name): name is string => !!name).join(' ');
  useEffect(() => {
    if (statusState !== 'ready') return;
    for (const namespace of new Set(accessKey.split(' '))) if (accessStale(state.access, namespace, Date.now())) ensureAccess(namespace);
  }, [statusState, accessKey, state.access, state.now, ensureAccess]);
```

- `confirm` und `startAction`: im Kontext von `actionReason` `access: state.access, status` ergänzen.
- `openMenu` ersetzen:

```ts
  const openMenu = (target: MenuTarget, x: number, y: number) => {
    // The menu is computed on every render, so an answer that arrives while it is open updates it.
    const ref = target.type === 'row' ? target.row.ref : target.type === 'container' ? target.pod.ref : target.type === 'problem' ? target.problem.ref
      : target.type === 'node' ? { kind: 'nodes' as const, name: target.tile.name } : null;
    if (ref && statusState === 'ready') {
      const namespace = accessNamespace(ref, status);
      if (accessStale(state.access, namespace, Date.now())) ensureAccess(namespace);
    }
    setMenu({ x, y, target, now: Date.now() });
  };
```

- In `runnerFor` ergänzen:

```ts
    logsAll: row => {
      setLogsAllFor(refKey(row.ref));
      setPrevious(false);
      dispatch({ type: 'select', key: refKey(row.ref) });
      dispatch({ type: 'dock', mode: 'logs' });
    },
```

- An `<DetailDock …>` ergänzen:

```tsx
          viewId={viewId} workload={workloadRow} logsAllArmed={logsAllArmed} onArmLogsAll={() => { if (workloadRow) setLogsAllFor(refKey(workloadRow.ref)); }}
          logsAllReason={statusState !== 'ready' ? t('errors:kubernetes.notConnected') : workloadRow ? refAccessReason(state.access, status, workloadRow.ref, 'logsAll') : undefined}
          startLogs={startLogs} stopLogs={stopLogs} shellForbidden={podRow ? refAccessReason(state.access, status, podRow.ref, 'shell') : undefined}
```

### 3.13 Texte `src/shared/locales/{de-DE,en-US}/kubernetes.json` (Task I2), neuer Block `logsAll` nach `forward`

| Key | de-DE | en-US |
|---|---|---|
| `onDemand` | `Logs aller Pods von {{name}}: startet erst auf Knopfdruck, weil dafür bis zu {{max}} Log-Streams gleichzeitig öffnen.` | `Logs of all pods of {{name}}: starts only on a button press, because it opens up to {{max}} log streams at once.` |
| `start` | `Logs aller Pods anzeigen` | `Show logs of all pods` |
| `filter` | `Filtern` | `Filter` |
| `filterLabel` | `Logs filtern (Text oder Pod)` | `Filter logs (text or pod)` |
| `follow` | `Folgen` | `Follow` |
| `followNew` | `Folgen ({{count}} neu)` | `Follow ({{count}} new)` |
| `sources` | `Quellen` | `Sources` |
| `ended` | `beendet` | `ended` |
| `failed` | `Fehler` | `error` |
| `loading` | `Suche Pods …` | `Looking for pods…` |
| `noPods` | `Noch kein Container gestartet.` | `No container has started yet.` |
| `summary` | `Live: {{shown}} von {{total}} Containern` | `Live: {{shown}} of {{total}} containers` |
| `waiting` | `{{count}} weitere warten (höchstens {{max}} gleichzeitig)` | `{{count}} more waiting (at most {{max}} at once)` |
| `dropped` | `{{count}} Zeilen ausgelassen (zu viele auf einmal)` | `{{count}} lines skipped (too many at once)` |
| `olderHidden` | `{{count}} ältere Treffer nicht angezeigt; Kopieren nimmt alle mit.` | `{{count}} older matches not shown; Copy includes them.` |
| `linesLabel` | `Logs aller Pods` | `Logs of all pods` |

Es gibt keine `_one`/`_other`-Keys. Die Zahlen formatiert der vorhandene `countFormatter` (0.2).

### 3.14 CSS `src/renderer/src/kubernetes-dock.css` (Task I2), ans Ende

```css
/* Logs of all pods: filter bar, source chips and the merged lines on the stage. No motion. */
.kube-logs { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.kube-logs-bar { flex: none; display: flex; align-items: center; gap: var(--space-6); padding: var(--space-4) var(--space-8); }
.kube-logs-filter { flex: 0 1 220px; min-height: var(--control-xs); padding: var(--space-2) var(--space-8); font-size: var(--fs-sm); }
.kube-logs-follow { min-height: var(--control-xs); padding: var(--space-2) var(--space-8); font-size: var(--fs-sm); }
.kube-logs-follow[aria-pressed="true"] { background: var(--color-bg-selected); }
.kube-logs-state { margin-left: auto; font-size: var(--fs-sm); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.kube-logs-sources { flex: none; display: flex; flex-wrap: wrap; gap: var(--space-4); max-height: 64px; overflow: auto; padding: 0 var(--space-8) var(--space-4); }
.kube-logs-chip { min-height: var(--control-xs); padding: var(--space-2) var(--space-8); border-radius: var(--radius-pill); background: var(--color-bg-raised); font: var(--fs-xs) var(--font-mono); }
.kube-logs-chip[aria-pressed="false"] { opacity: .5; text-decoration: line-through; }
.kube-logs-chip-ended { font-style: italic; }
.kube-logs-lines { flex: 1; min-height: 0; overflow: auto; padding: var(--space-4) var(--space-10); background: var(--color-bg-stage); color: var(--color-text-code); font: var(--fs-sm)/1.45 var(--font-mono); }
.kube-logs-line { white-space: pre; }
.kube-logs-line > span + span { margin-left: var(--space-8); }
.kube-logs-src { font-weight: 600; }
.kube-logs-time { color: var(--color-text-muted); }
.kube-logs-src-0 { color: var(--color-source-1); }
.kube-logs-src-1 { color: var(--color-source-2); }
.kube-logs-src-2 { color: var(--color-source-3); }
.kube-logs-src-3 { color: var(--color-source-4); }
.kube-logs-line mark { background: var(--color-selection-bg); color: var(--color-selection-text); }
.kube-logs-more { margin: 0 0 var(--space-4); font-size: var(--fs-sm); }
```

### 3.15 run-app-Fake (Task G)

**`kube-fixtures.mjs`:**
- In `addPod` wird der Zustand für `phase === 'Succeeded'` zu `{ terminated: { reason: 'Completed', exitCode: 0, startedAt: ago(age), finishedAt: ago(age - 2 * MIN) } }`.
- Ans Ende der Datei:

```js
// Rules of the synthetic account in shop: read everything, logs, exec and port forward, delete pods, CronJobs.
// No patch on Deployments, StatefulSets, DaemonSets and Nodes, no delete on Jobs: restart, scale, cordon and job delete are greyed out.
export const SHOP_RULES = [
  { verbs: ['get', 'list', 'watch'], apiGroups: ['*'], resources: ['*'] },
  { verbs: ['create'], apiGroups: [''], resources: ['pods/exec', 'pods/portforward'] },
  { verbs: ['delete'], apiGroups: [''], resources: ['pods'] },
  { verbs: ['patch'], apiGroups: ['batch'], resources: ['cronjobs'] },
  { verbs: ['create'], apiGroups: ['batch'], resources: ['jobs'] },
];
```

**`kube-fake.mjs`:**
- `SHOP_RULES` importieren.
- Im Kopfkommentar (Zeile 1) ergänzen: „…; pods/log with timestamps and follow; a SelfSubjectRulesReview.“
- In `handle` direkt vor `if (req.method !== 'GET') {`:

```js
    if (req.method === 'POST' && pathname === '/apis/authorization.k8s.io/v1/selfsubjectrulesreviews') return rulesReview(req, res);
```

- Funktion vor `handle`:

```js
  // SelfSubjectRulesReview: shop has fixed rules, monitoring answers incomplete (like a webhook authorizer), every other namespace is forbidden.
  const rulesReview = (req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let namespace;
      try { namespace = JSON.parse(body).spec?.namespace; } catch { namespace = undefined; }
      if (namespace !== 'shop' && namespace !== 'monitoring') {
        return json(res, 403, status(403, 'Forbidden', `selfsubjectrulesreviews.authorization.k8s.io is forbidden in namespace "${namespace}"`));
      }
      const result = namespace === 'shop'
        ? { incomplete: false, resourceRules: SHOP_RULES, nonResourceRules: [] }
        : { incomplete: true, evaluationError: 'webhook authorizer does not support user rule resolution', resourceRules: [], nonResourceRules: [] };
      json(res, 201, { apiVersion: 'authorization.k8s.io/v1', kind: 'SelfSubjectRulesReview', spec: { namespace }, status: result });
    });
  };
```

- Im Log-Zweig direkt nach dem 404 für unbekannte Pods:

```js
      // timestamps=true (logs of all pods): RFC 3339 with nine digits like the kubelet, tailLines respected, one new line every 2 s while following.
      if (query.get('timestamps') === 'true') {
        const podIndex = data.pods.indexOf(pod);
        const base = Date.now() - 60_000;
        const stamp = i => new Date(base + i * 4000 + podIndex * 900).toISOString().replace(/Z$/, '456789Z');
        const text = i => `${stamp(i)} ${i % 5 === 4 ? 'ERROR' : 'INFO'} ${pod.metadata.name} handled request ${1000 + i} in ${12 + (i % 40)} ms\n`;
        const tail = Math.min(Number(query.get('tailLines') ?? 15), 15);
        const first = Array.from({ length: tail }, (_, k) => text(15 - tail + k)).join('');
        if (query.get('follow') !== 'true') return json(res, 200, first, 'text/plain');
        hold(res, req, 300, 'text/plain', first);
        let next = 15;
        const timer = setInterval(() => res.write(text(next++)), 2000);
        res.on('close', () => clearInterval(timer));
        return;
      }
```

**`fakes.test.mjs`:**
- Imports: `KubeWorkloadLogs` aus `../../../src/main/kubernetes/workload-logs`, `deniedAccess` aus `../../../src/shared/kube-access`.
- Neuer Test nach dem Port-Forward-Test:

```js
  it.skipIf(!findOpenssl())('follows the logs of all api pods with timestamps and answers the rules review', async () => {
    const kube = await startKubeFake({ port: 0, dir: join(base, 'kube-logs') });
    cleanup.push(() => kube.close());
    const { host } = await connect((await start('kube-logs', { kubeconfig: kube.kubeconfig, kubePort: kube.port })).port);
    const parsed = parseKubeconfig(kube.kubeconfig);
    const tunnel = await openTunnel((h, p) => host.forward(h, p), parsed.server);
    cleanup.push(async () => tunnel.close());
    const api = createKubeApi(parsed.build(tunnel.port));
    const batches = [];
    const logs = new KubeWorkloadLogs((_owner, _view, batch) => batches.push(batch));
    cleanup.push(async () => logs.stopAll());
    const lines = () => batches.flatMap(batch => batch.lines);
    const until = async (what, test) => {
      for (const end = Date.now() + 8000; !test(); await new Promise(resolve => setTimeout(resolve, 50))) if (Date.now() > end) throw new Error(what);
    };

    await logs.start({ ownerId: 1, viewId: 'v', api: async () => api }, { id: 'run', namespace: 'shop', selector: { app: 'api' }, format: 'raw' });
    await until('three sources with their tails', () => (batches.at(-1)?.sources.length ?? 0) === 3 && lines().length >= 45);
    expect(batches.at(-1).sources.map(source => source.pod)).toEqual(['api-6d8f9b7c5-h5t8w', 'api-6d8f9b7c5-q9m4d', 'api-6d8f9b7c5-x7k2p']);
    for (const line of lines()) expect(line.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{9}Z$/);
    const count = lines().length;
    await until('following brings new lines', () => lines().length > count);

    const shop = await api.rulesReview('shop');
    expect(shop.incomplete).toBe(false);
    const denied = deniedAccess(shop.rules).map(item => item.id);
    expect(denied).toEqual(expect.arrayContaining(['patchDeployments', 'patchStatefulSets', 'patchDaemonSets', 'patchNodes', 'deleteJobs']));
    expect(denied).not.toContain('logsAll');
    expect(denied).not.toContain('shell');
    expect((await api.rulesReview('monitoring')).incomplete).toBe(true);
    await expect(api.rulesReview('kube-system')).rejects.toMatchObject({ code: 403 });
  });
```

### 3.16 Version (Task F)
`package.json` und `package-lock.json` (beide `version`-Felder der Wurzel) auf `0.28.0` setzen.

---

## 4. Zerlegung (exklusive Dateien, Wellen)

Nach **jeder** Welle müssen `npm run typecheck` und `npx vitest run` vollständig grün sein. Innerhalb einer Welle darf ein Task auf den Vertrag eines Nachbar-Tasks derselben Welle verweisen; geprüft wird am Wellenende. Umsetzer schreiben nur ihre eigenen Dateien und committen nie.

| Task | Dateien (exklusiv) | Inhalt | Welle | hängt ab von |
|---|---|---|---|---|
| **A** Vertrag | `src/shared/kubernetes.ts`, `src/shared/kube-access.ts` (neu), `src/shared/kube-access.test.ts` (neu), `src/shared/kubernetes-schema.ts`, `src/shared/kubernetes-schema.test.ts`, `src/shared/ipc.ts`, `src/preload/index.ts` | 3.1–3.3, Tests 10.1–10.2 | 1 | – |
| **B** Client | `src/main/kubernetes/api.ts`, `client-api.ts`, `client-api.test.ts`, `overview.test.ts`, `watch.test.ts` | 3.4, Tests 10.3 | 1 | A |
| **D** Workload-Logs | `src/main/kubernetes/workload-logs.ts` (neu), `workload-logs.test.ts` (neu) | 3.5, Tests 10.4 | 1 | A, B (`followLog`) |
| **H** Sessions und IPC | `src/main/kubernetes/session.ts`, `session.test.ts`, `src/main/kubernetes/ipc.ts` | 3.6, Tests 10.5 | 1 | A, B, D |
| **E** Renderer-Zustand | `src/renderer/src/kube-view.ts`, `kube-view.test.ts`, `hooks/useClusterSession.ts`, `src/renderer/src/kube-access.ts` (neu) + `.test.ts` (neu), `src/renderer/src/kube-logs.ts` (neu) + `.test.ts` (neu), `src/shared/locales/{de-DE,en-US}/kubeActions.json` | 3.7, Tests 10.6 | 1 | A |
| **T** Tokens | `src/renderer/src/tokens.css`, `src/renderer/src/design-tokens.test.ts`, `src/renderer/src/styles.css` (nur die `:not()`-Liste der Druckregel), `docs/design-system.md` | 3.8 | 1 | – |
| **F** Doku und Version | `docs/handbuch.md`, `docs/manual.md`, `CHANGELOG.md`, `CHANGELOG.en.md`, `README.md`, `package.json`, `package-lock.json` | 3.16, Abschnitt 5 | 1 | – |
| **I1** Menüs und Befehle | `src/renderer/src/kube-menus.ts`, `kube-menus.test.ts`, `kube-menu-run.ts`, `kube-menu-run.test.ts`, `kube-commands.ts`, `kube-commands.test.ts`, `src/shared/locales/{de-DE,en-US}/kubeActions.json` | 3.9, Tests 10.7 | 2 | A, E |
| **I2** Ansicht | `components/kubernetes/WorkloadLogs.tsx` (neu), `components/kubernetes/DetailDock.tsx`, `components/kubernetes/ClusterView.tsx`, `src/renderer/src/kubernetes-dock.css`, `src/shared/locales/{de-DE,en-US}/kubernetes.json` | 3.10–3.14 | 2 | A, E, T, I1 (`MenuRunner.logsAll`) |
| **G** Fake | `.claude/skills/run-app/kube-fake.mjs`, `kube-fixtures.mjs`, `fakes.test.mjs` | 3.15, Test 10.9 | 2 | A, B, D |
| **J** Abnahme | `.claude/skills/run-app/screens.mjs`, `.claude/skills/run-app/SKILL.md` | Abschnitt 6 | 3 | alle |

Hinweise zur Zerlegung:
- **A** fügt `KubeEvent` die Variante `logs` hinzu. `applyEvent` muss sie behandeln, sonst schlägt der Typecheck fehl. Deshalb liegt **E** in Welle 1.
- **B** ändert `KubeApi`, damit brechen die drei Fakes. B pflegt `overview.test.ts` und `watch.test.ts`, H pflegt `session.test.ts`. Alle drei liegen in Welle 1.
- `kubeActions.json` gehört in Welle 1 zu **E** und in Welle 2 zu **I1**:
  - E legt `reasons.forbidden` und `reasons.forbiddenClusterWide` an. `kube-access.ts` benutzt sie schon in Welle 1, und die Keys sind typisiert.
  - I1 legt `menu.logsAll` an und benutzt es in derselben Welle.
  
  So meldet der Katalogtest in keiner Welle verwaiste Keys.
- **T** liegt in Welle 1, damit die Quellenfarben existieren, bevor I2 sie in Welle 2 benutzt. Unbenutzte Tokens sind erlaubt. Die Druckregel in `styles.css` darf `.kube-logs-chip` schon vorher nennen.
- `ClusterView.tsx` (I2) muss `MenuRunner.logsAll` erfüllen, das I1 in derselben Welle einführt.
- Version und CHANGELOG (beide F) liegen in einem Task, weil `src/shared/version.test.ts` beide gemeinsam prüft.
- Nach Welle 3 folgen run-app nach Abschnitt 6 und die manuellen Tests aus Abschnitt 11.

---

## 5. Doku (Task F)

**Handbuch `docs/handbuch.md`:**
1. Abschnitt „Kubernetes“: „Logs, YAML, Events, Describe und `Port weiterleiten…` bleiben erlaubt.“ wird zu „Logs, `Logs aller Pods`, YAML, Events, Describe und `Port weiterleiten…` bleiben erlaubt.“
2. Zwei neue Unterabschnitte nach `### Port weiterleiten`, direkt vor `## Dateiansicht: Tastatur und Übertragungen`:

   > ### Logs aller Pods
   >
   > Rechtsklick auf ein Deployment, StatefulSet, DaemonSet, einen Job oder einen Service → `Logs aller Pods`. Der Reiter **Logs** im unteren Bereich zeigt dann die Logs aller zugehörigen Container zusammen. Ist die Zeile nur ausgewählt, startet `Logs aller Pods anzeigen` die Ansicht; durchs Blättern allein öffnet Shellherd keine Streams.
   >
   > - **Sortierung:** nach dem Zeitstempel, den Kubernetes an jede Zeile hängt (UTC, `HH:MM:SS.mmm`). Davor steht `pod/container` in einer von vier Farben. Laufen die Uhren der Nodes auseinander, kann die Reihenfolge zwischen Pods um diesen Versatz abweichen.
   > - **Filtern und Quellen:** Das Feld `Filtern` zeigt nur Zeilen, die den Text enthalten, im Präfix oder in der Meldung; Treffer sind markiert. Ein Klick auf einen Container-Chip blendet ihn aus und wieder ein.
   > - **Folgen:** Neue Zeilen erscheinen unten. Scrollst du nach oben, bleibt die Ansicht stehen, und `Folgen (12 neu)` zeigt, was dazugekommen ist; ein Klick springt ans Ende.
   > - **Rollouts:** Neue Pods kommen von selbst dazu, sobald ihr Container läuft. Beendete Pods bleiben mit „beendet“ stehen. Startet ein Container neu, liest Shellherd ab der letzten Zeile weiter.
   > - **Kompakt / Roh** gilt wie bei einzelnen Logs; Farben aus der App werden entfernt. `Kopieren` nimmt alle Treffer mit, auch die nicht angezeigten.
   > - **Grenzen:** höchstens 20 Container gleichzeitig (weitere warten und rücken nach), je Container die letzten 200 Zeilen, insgesamt 10 000 Zeilen, angezeigt die neuesten 2 000 Treffer. Zeilen über 4 000 Zeichen werden gekürzt. Kommen mehr als 8 000 Zeilen pro Sekunde, lässt Shellherd welche aus und sagt es. Nur `matchLabels` des Selectors zählen, wie bei „Pods anzeigen“; Init-Container sind nicht dabei.
   > - **Rechte:** `list` und `watch` auf Pods und `get` auf `pods/log`. „Nur lesen“ erlaubt die Ansicht. Wechselst du die Zeile, den Reiter oder die Darstellung, endet sie; nach einem Neuverbinden beginnt sie neu.
   >
   > ### Rechte-Vorabprüfung
   >
   > Shellherd fragt je Namespace einmal ab, was das Kubernetes-Konto darf (`SelfSubjectRulesReview`, eine reine Abfrage ohne Wirkung auf den Cluster). Einträge im Kontextmenü, die das Konto nicht ausführen darf, sind dann vorab gesperrt und nennen das fehlende Recht, etwa „Keine Berechtigung: patch auf deployments in shop“. Das gilt für Neustart, Skalieren, Löschen, cordon/uncordon, Anhalten, Fortsetzen und `Jetzt ausführen…`, für Logs, Shell, `Logs aller Pods` und `Port weiterleiten…`. Die Tasten `r`, `S`, `Strg+D`, `s`, `l` und `p` melden denselben Grund.
   >
   > - Die Antwort gilt eine Minute und wird bei Bedarf neu geholt, nach einem Neuverbinden sofort. Ein gerade neu vergebenes Recht kann also bis zu einer Minute gesperrt erscheinen.
   > - Kann der Cluster die Frage nicht vollständig beantworten (etwa mit einem externen Autorisierer wie bei GKE oder Azure-RBAC), ist sie verboten oder dauert sie länger als 10 Sekunden, sperrt Shellherd nichts; ein fehlendes Recht zeigt sich dann wie bisher erst beim Ausführen.
   > - Regeln, die nur für bestimmte Objektnamen gelten, zählen als Erlaubnis. Gesperrt wird nur, was sicher nicht geht.
   > - Nodes prüft Shellherd mit den Regeln des Standard-Namespace des Clusters.

**Manual `docs/manual.md`:** dieselben Stellen auf Englisch.
- Im Abschnitt „Kubernetes“ nennt der Satz zu “Read-only” zusätzlich „`Logs of all pods`“.
- Zwei neue Unterabschnitte `### Logs of all pods` und `### Permission pre-check` vor dem Abschnitt `## File view: …` (Überschrift dort prüfen).
- Die englischen UI-Texte kommen aus 3.9 und 3.13: `Logs of all pods`, `Show logs of all pods`, `Filter`, `Follow`, `Follow (12 new)`, “ended”, “No permission: patch on deployments in shop”.

**CHANGELOG.md**, ganz oben, Abschnitt `## [0.28.0] – 2026-10-25`:
- Neu: Logs aller Pods. Rechtsklick auf ein Deployment, StatefulSet, DaemonSet, einen Job oder Service → `Logs aller Pods` zeigt die Logs aller zugehörigen Container zusammen im unteren Bereich, nach Zeit sortiert und mit farbigem `pod/container`-Präfix. Mit `Filtern`, Container-Chips zum Ausblenden und `Folgen`; neue Pods eines Rollouts kommen von selbst dazu.
- Neu: Rechte-Vorabprüfung. Aktionen, die das Kubernetes-Konto nicht darf (Neustart, Skalieren, Löschen, cordon, Shell, Logs, Port-Weiterleitung und weitere), sind im Kontextmenü vorab gesperrt und nennen das fehlende Recht. Shellherd fragt dafür je Namespace die Rechte ab, ohne etwas im Cluster zu ändern; kann der Cluster das nicht beantworten, bleibt alles wie bisher.

**CHANGELOG.en.md**: dieselben zwei Punkte auf Englisch, gleiches Datum `2026-10-25`.

**README.md `:50`** (Punkt „Kubernetes“): nach „and port forwards to pods and services on 127.0.0.1“ einfügen: „, logs of all pods of a workload merged by time, and menu entries greyed out up front when RBAC forbids them“.

---

## 6. run-app-Szenen (Task J, Abnahme)

Die Szenen laufen nur gegen den Kubernetes-Fake über den SSH-Fake, nie gegen einen echten Cluster. Der Treiber braucht nichts Neues. Der Demo-Cluster `prod-k8s` ist nicht „Nur lesen“ (0.6). Gesperrt ist „Rollout neu starten…“ dort also nur wegen der Regeln aus `SHOP_RULES`.

### 6.1 Neuer Block `kube-logs` in `screens.mjs` (drei Shots, nach `kube-forward`)

Den Block auch in die Usage-Zeile (`:2`) aufnehmen.

```js
  // Logs of all pods of a deployment and the RBAC pre-check against the synthetic rules (shop: no patch on workloads).
  async 'kube-logs'() {
    if (!await evaluate(`document.body.innerText.includes('prod-k8s')`)) { console.log('Logs aller Pods übersprungen: prod-k8s fehlt im Baum.'); return; }
    const view = '.kube-view:not([hidden])';
    const disabledWith = (label, reason) => `[...document.querySelectorAll('[role=menuitem]')].some(i => i.disabled && i.textContent.includes(${JSON.stringify(label)}) && i.textContent.includes(${JSON.stringify(reason)}))`;
    const enabled = label => `[...document.querySelectorAll('[role=menuitem]')].some(i => !i.disabled && i.textContent.trim().startsWith(${JSON.stringify(label)}))`;
    try {
      await click('text=prod-k8s >> nth=0');
      await key('Enter');
      await waitFor('Kubernetes-Ansicht', `document.body.innerText.includes('bereit über web-01') && ${count('.kube-table tbody tr')} >= 5`);
      await click('.kube-kind-tabs button:has-text("Deployments")');
      await waitFor('Deployments', `${count('.kube-table tbody tr')} >= 3`);
      // 1. RBAC: restart and scale are greyed out with the reason from the synthetic rules.
      await rclick('.kube-table tbody tr:has-text("shop/api:2.4.1")');
      await waitFor('Neustart gesperrt', disabledWith('Rollout neu starten', 'Keine Berechtigung: patch auf deployments in shop'));
      await pause(300);
      await shot('kube-rbac-menu');
      // 2. Logs of all three api pods, merged by time, three colours.
      await menuItem('Logs aller Pods');
      await waitFor('drei Quellen', `${count(`${view} .kube-logs-chip`)} === 3 && ${count(`${view} .kube-logs-line`)} >= 45`);
      await waitFor('drei Farben', `new Set([...document.querySelectorAll('${view} .kube-logs-line .kube-logs-src')].map(e => e.className)).size === 3`);
      await pause(300);
      await shot('kube-logs-all');
      // 3. Following: new lines arrive every 2 s per pod.
      const before = await evaluate(count(`${view} .kube-logs-line`));
      await waitFor('neue Zeilen', `${count(`${view} .kube-logs-line`)} > ${before}`, { timeout: 8000 });
      // 4. Filter: only ERROR lines, matches marked.
      await fill(`${view} .kube-logs-filter`, 'ERROR');
      await waitFor('Filter', `${count(`${view} .kube-logs-line mark`)} > 0 && [...document.querySelectorAll('${view} .kube-logs-line')].every(l => l.textContent.includes('ERROR'))`);
      await pause(300);
      await shot('kube-logs-all-filter');
      // 5. Fallback: monitoring answers incomplete, so nothing is greyed out there.
      await evaluate(`(() => { const s = document.querySelector('${view} .kube-ns select'); s.value = 'monitoring'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
      await click('.kube-kind-tabs button:has-text("StatefulSets")');
      await waitFor('StatefulSets', `${count('.kube-table tbody tr')} >= 1`);
      await rclick('.kube-table tbody tr:has-text("postgres")');
      await waitFor('nichts gesperrt', enabled('Rollout neu starten'));
      await key('Escape');
    } finally {
      await closeTabs();
    }
  },
```

Die Helfer `fill`, `rclick`, `menuItem`, `count`, `waitFor` und `closeTabs` gibt es in `screens.mjs` schon; das Muster zeigt der Block `kube-forward`.

### 6.2 `SKILL.md`
- Den Block `kube-logs` mit seinen drei Shots in die Liste der Szenen aufnehmen.
- Einen Abschnitt zum Fake ergänzen. Er liefert `pods/log` mit `timestamps=true`, `tailLines` und einer neuen Zeile alle 2 s je Pod. Er beantwortet `selfsubjectrulesreviews` so:
  - `shop` mit festen Regeln: kein `patch` auf Workloads und Nodes, kein `delete` auf Jobs;
  - `monitoring` unvollständig;
  - alle anderen Namespaces mit 403.

---

## 7. Was ausdrücklich nicht getan wird

- Keine schreibende Cluster-Aktion. Neu sind nur die vier Aufrufe aus R7.1 (R-0). Bestehende Aktionen, Bestätigungen und die Prüfung auf „Nur lesen“ in Main ändern sich nicht (R5.1).
- Keine SelfSubjectAccessReview und keine Prüfung je Objektname (R2.2, R2.3).
- Keine Maskierung (das macht Paket 11); nichts geht an die KI.
- Für „Logs aller Pods“ gibt es:
  - keinen eigenen Tab und kein Popout;
  - kein Speichern im Workspace;
  - keine Logs vorheriger Container (`--previous`).
- Keine Init- und Ephemeral-Container, keine `matchExpressions`.
- Keine Umstellung des gemeinsamen `ContextMenu` auf `aria-disabled` (R5.3).
- Keine Vorabprüfung für Dock-Reiter, Events, YAML und Describe.
- Kein periodisches Abfragen der Rechte, kein Hinweis „Rechte unbekannt“.
- Keine Level-Farben in der zusammengeführten Ansicht (ANSI wird entfernt).
- Kein neues Tastenkürzel, keine Bewegung, keine neue npm-Abhängigkeit.
- Keine Änderung an den Einzel-Pod-Logs: Terminal-Weg, `timestamps=false` und 500 Zeilen bleiben.

## 8. Minimale erste Stufe und Extras

**Stufe 1 (dieses Paket):** 1a–1e, 2a–2c und 3.
- Main: ein neues Modul `workload-logs.ts` (rund 230 Zeilen), dazu `followLog` und `rulesReview` in `client-api.ts` und drei Methoden in `session.ts`.
- Shared: `kube-access.ts` (rund 80 Zeilen).
- Renderer: zwei reine Helfer, eine Komponente, Ergänzungen in Dock, View, Menüs und Befehlen.
- run-app: rund 50 Zeilen Fake, ein Ende-zu-Ende-Test, ein Block.

Müsste das Paket kleiner werden, fiele zuerst die RBAC-Prüfung in Dock und Tasten weg (2c und die Befehle); die Menüs blieben. Empfohlen ist aber das ganze Paket, denn der Rest kostet nur ein paar Zeilen.

**Extras für später:**
- `l` auf Workload-Zeilen öffnet den Platzhalter „Logs aller Pods“ (heute „Nur für Pods“).
- „Logs aller Pods“ als eigener Tab (neue Tab-Art).
- Level-Erkennung (ERROR/WARN) als Filter-Chips.
- SelfSubjectAccessReview als zweite Stufe, wenn SSRR `incomplete` meldet: genau für die 13 Prüfungen des Namespace. Damit ginge die Vorabprüfung auch auf GKE und AKS mit Azure-RBAC.
- `aria-disabled` im gemeinsamen `ContextMenu`, damit Screenreader den Grund hören.
- Den Cache sofort verwerfen, wenn eine Aktion mit 403 scheitert.
- `matchExpressions` in Selectoren, auch für „Pods anzeigen“.

## 9. Risiken

1. **SSRR-Genauigkeit.**
   - Bei RBAC ist das Ergebnis exakt.
   - Bei externen Autorisierern meldet die API `incomplete`, und Shellherd sperrt nichts.
   - Eine RoleBinding mit Regeln auf `nodes` zählt fälschlich als Erlaubnis (R2.3).
   - In allen Fehlfällen wird nur zu viel **erlaubt**, nie zu viel gesperrt. Das Ergebnis ist dann der heutige 403.
2. **Veraltete Antwort.** Bis zu 60 s nach einer Rechte-Änderung stimmt die Sperre nicht; das ist dokumentiert. Ein neuer Cluster-Tab fragt sofort neu.
3. **Nur `matchLabels`.** Ein Selector mit zusätzlichen `matchExpressions` zeigt eventuell zu viele Pods. Das ist selten, denn Helm und kubectl erzeugen `matchLabels`, und es verhält sich wie „Pods anzeigen“.
4. **Last.**
   - Pro Cluster-Tab laufen bis zu 20 lange GETs durch einen SSH-Tunnel, und jeder Kubelet streamt dafür von der Platte.
   - Bei DaemonSets auf vielen Nodes greift die Grenze.
   - M5 misst, ob die Tabelle bei laufender Ansicht flüssig bleibt.
5. **Uhrzeiten verschiedener Nodes.** Die Sortierung nutzt die Zeit der Container-Runtime je Node. Weichen die Uhren der Nodes voneinander ab, ist die Reihenfolge über Pods hinweg um diesen Versatz ungenau. Das steht im Handbuch.
6. **Renderer-Leistung.**
   - Bis zu 2 000 DOM-Zeilen ohne Virtualisierung werden alle 250 ms neu berechnet. Bei sehr gesprächigen Pods könnte das ruckeln.
   - M6 prüft das. Fällt es auf, wird `DISPLAY_LINES` kleiner; Virtualisierung ist ein Extra.
7. **Dubletten nach Neustart.** `sinceTime` kennt nur Sekunden. `skipUntil` überspringt bis zur zuletzt gelesenen Zeit. Zwei Zeilen mit **exakt** gleichem Zeitstempel unmittelbar an der Grenze können verloren gehen; das wird bewusst hingenommen.
8. **CrashLoop-Container** öffnen bei jedem Neustart einen neuen Stream, höchstens so oft, wie der Backoff erlaubt (bis 5 min).
9. **`exec`-Verb je Version.** Die Alternativen `create` und `get` decken alte und neue Cluster ab. Hat ein Konto nur das Verb, das der Cluster nicht verlangt, bleibt der Eintrag frei und liefert dann 403.
10. **Fake gegen echte API.** Die Form der SSRR-Antwort ist aus den client-node-Modellen übernommen. M2 prüft sie am echten Cluster.
11. **Menü wächst.** Workloads, Jobs und Services bekommen einen Eintrag mehr. Er kommt in eine bestehende Gruppe (Kontextmenü-Spec `:283`).

## 10. Testideen (Pflicht = **fett**)

### 10.1 Shared `kube-access.test.ts` (Task A)
- **`ruleAllows`:**
  - `*` passt bei Verb, Gruppe und Ressource;
  - die genaue Ressource `pods/log` passt;
  - `*/log` passt auf `pods/log`, `pods/*` passt **nicht**;
  - eine falsche Gruppe (`apps` gegen `''`) passt nicht;
  - eine Regel mit `resourceNames` gilt als Erlaubnis.
- **`deniedAccess`:**
  - Mit `[{ verbs: ['*'], apiGroups: ['*'], resources: ['*'] }]` ist die Liste leer.
  - Eine Rolle wie `view` (get/list/watch auf alles) sperrt `shell`, `forward`, alle `patch*`, `delete*` und `trigger`. Frei bleiben `logs` und `logsAll`, wenn `pods/log` das Verb `get` hat.
  - `shell` ist auch mit nur `get pods/exec` erlaubt (alter Cluster).
  - `trigger` mit nur `create jobs` meldet `{ verb: 'get', resource: 'cronjobs' }`.
  - `logsAll` ohne `watch pods` meldet `watch` auf `pods`.
- **`actionAccess`:** liefert für jedes Paar aus `ACTION_KINDS` eine ID und für `restart` auf `pods` `undefined`.

### 10.2 Schema `kubernetes-schema.test.ts` (Task A)
- **`KubeLogsStartRequestSchema`:**
  - nimmt eine gültige Anfrage an;
  - lehnt einen leeren Selector und einen mit 33 Paaren ab;
  - lehnt einen Schlüssel mit Komma ab;
  - lehnt eine `id` ohne UUID ab;
  - lehnt ein unbekanntes Feld ab (`strict`).
- **`KubeAccessRequestSchema`:** lehnt einen Namespace mit Großbuchstaben ab.

### 10.3 Client `client-api.test.ts` (Task B)
- **`followLogUrl`:**
  - setzt `follow=true`, `timestamps=true`, `tailLines=200` und den Container;
  - mit `sinceTime` gibt es kein `tailLines`;
  - Namen werden kodiert.
- **`openLogs` mit `follow`:**
  - Eine JSON-Zeile kommt unverändert als Bytes an, ohne Formatter.
  - Eine Zeile ohne Zeilenende wird nicht zurückgehalten.
- **`openLogs` ohne `follow`:** Die bestehenden Tests bleiben grün.
- **`rulesReview`** (mit `vi.spyOn(KubeConfig.prototype, 'makeApiClient')` auf einen Fake mit `createSelfSubjectRulesReview`):
  - Die Regeln werden übernommen, `resourceNames` nur, wenn die Liste nicht leer ist.
  - Ein fehlender `status` gilt als `incomplete: true`.
  - Ein Fehler mit `code: 403` wird zu einem `KubeApiError` mit Code 403.

### 10.4 Workload-Logs `workload-logs.test.ts` (Task D)
Aufbau des Fakes:
- Der Fake-`KubeApi` hat `list` mit Pods, `watch` mit einem Handle und `followLog`. `followLog` speichert `io` und liefert einen `close`-Mock.
- Die Zeitgeber laufen über einen Fake-`schedule`.

Tests:
- **`splitTimestamp`:**
  - `2026-10-25T08:10:00.12Z text` wird zu `…00.120000000Z`.
  - Ohne Bruchteil wird `.000000000Z` angehängt.
  - Ohne Stempel kommt `undefined`.
  - Ein Text mit Leerzeichen bleibt ganz.
- **`cleanLogText`:**
  - `\x1b[31mERR\x1b[0m` wird zu `ERR`;
  - eine OSC-Sequenz wird entfernt;
  - ein Tab wird zum Leerzeichen, `\x07` zu `�`;
  - 5 000 Zeichen werden zu 4 000 plus `…`.
- **`startedContainers`:**
  - `running`, `terminated` mit `startedAt` und `lastState.terminated` zählen;
  - nur `waiting` zählt nicht;
  - `restartCount` ändert die Instanz.
- **Lauf:**
  - Zwei Pods mit absichtlich unsortierten Namen: Die Streams öffnen in Namensreihenfolge, mit `tailLines: 200`.
  - Die Daten kommen in zwei Chunks, mit einer geteilten Zeile.
  - Nach 250 ms kommt genau ein Batch mit zwei `sources` und Zeilen mit Quellindex und normalisierter Zeit.
- **Kompakt:** Die JSON-Zeile `{"level":"error","msg":"x"}` wird zu Text ohne Escape-Zeichen.
- **Erster Abgleich ohne Pods:** Er schickt einen Batch mit `sources: []`.
- **Grenze 20:**
  - Bei 25 gestarteten Containern gibt es 20 `followLog`-Aufrufe und `waiting: 5`.
  - Endet ein Stream, öffnet der nächste.
- **Ende mit Fehler:**
  - Die Quelle ist danach `live: false` und hat `error`.
  - Dieselbe Instanz öffnet beim nächsten Watch-Ereignis nicht neu.
  - Eine neue Instanz öffnet mit `sinceTime` = Sekunde der letzten Zeile. Zeilen, die höchstens so alt sind wie die letzte Zeit, werden übersprungen.
- **Flut:** Bei 2 500 Zeilen in einem Batch kommen 2 000 an, mit `dropped: 500`.
- **Stopp:**
  - schließt alle Streams und den Watcher;
  - spätere `io.data`, `io.end` und Timer erzeugen kein Ereignis;
  - `stop(viewId, andereId)` lässt den Lauf stehen;
  - `start` ersetzt den vorigen Lauf derselben View.
- **Watcher-Fehler:** Wirft `list` einen 403, erscheint er als `error` im Batch.
- **`start`:** Lehnt `api()` ab, ist kein Lauf mehr registriert, und der Fehler geht weiter.

### 10.5 Sessions und IPC `session.test.ts` (Task H)
`FakeApi` bekommt diese Ergänzungen:

```ts
  rules: KubeRulesReview | Error = { incomplete: false, rules: [] };
  logStreams: { target: KubeTerminalTarget; options: LogFollowOptions; io: TerminalIo; close: Mock }[] = [];
  followLog(target: KubeTerminalTarget, options: LogFollowOptions, io: TerminalIo): KubeStream {
    const close = vi.fn();
    this.logStreams.push({ target, options, io, close });
    return { write() {}, resize() {}, pause() {}, resume() {}, close };
  }
  async rulesReview(): Promise<KubeRulesReview> {
    if (this.rules instanceof Error) throw this.rules;
    return this.rules;
  }
```

- **`access`:**
  - Leere Regeln liefern alle IDs.
  - `incomplete: true` liefert `null`.
  - Eine Ablehnung liefert `null`.
  - Eine hängende Review liefert nach 10 s (Fake-Zeitgeber) `null`.
  - Eine fremde View wirft `kubernetes.viewUnavailable`.
- **`startLogs`:**
  - ist auf einem `readOnly`-Cluster erlaubt;
  - wird bei `disabled` abgelehnt;
  - liefert die Batches als Ereignis `{ type: 'logs', viewId, id, … }`.
- **Lebenszyklus:**
  - `close` der View schließt die Streams, `closeAll` ebenso.
  - `stopLogs` mit fremder ID schließt nichts.

### 10.6 Renderer-Zustand (Task E)
- **`kube-logs.test.ts`:**
  - `mergeLines`:
    - sortiert verschachtelte Quellen nach Zeit;
    - lässt gleiche Zeiten in Ankunftsreihenfolge;
    - setzt eine verspätete ältere Zeile an ihre Stelle;
    - hängt `''` ans Ende an;
    - lässt über `max` die ältesten Zeilen fallen; `seq` läuft durch.
  - `shownLines`:
    - filtert nach Text und nach Pod-Name im Präfix, ohne Rücksicht auf Groß- und Kleinschreibung;
    - lässt eine ausgeblendete Quelle weg;
    - liefert mit `limit` die neuesten Zeilen und `hiddenOlder`.
  - `highlightParts` findet mehrere Treffer und liefert bei leerem Filter einen einzigen Teil.
  - `logTime` und `logsText` haben das genaue Format, und `toggleSource` schaltet hin und her.
- **`kube-access.test.ts`:**
  - `accessNamespace`: Ein Pod in `shop` ergibt `shop`, eine Node `status.namespace`, ohne Status `default`.
  - `accessStale`: Ohne Eintrag `true`, nach 59 s `false`, nach 61 s `true`.
  - `refAccessReason`:
    - liefert den deutschen Text mit Verb, Ressource und Namespace;
    - bei einer Node mit „(clusterweit)“;
    - bei `denied: null` `undefined`.
- **`kube-view.test.ts`:**
  - `access` speichert je Namespace.
  - Der Status `reconnecting` leert `access`, `ready` lässt es stehen.
  - Das Ereignis `logs` gibt **dasselbe** State-Objekt zurück (`toBe`).
  - `snapshotOf` enthält kein `access`.

### 10.7 Menüs und Befehle (Task I1)
- **`kube-menus.test.ts`:**
  - Bei Deployment, StatefulSet, DaemonSet, Job und Service steht `Logs aller Pods` vor `Events`. Die bestehenden wörtlichen Listen werden angepasst.
  - Ohne Selector ist der Eintrag gesperrt, mit dem Grund der jeweiligen Art.
  - Mit `access.shop.denied = [{ id: 'patchDeployments', verb: 'patch', resource: 'deployments' }]` ist `Rollout neu starten…` gesperrt, mit „Keine Berechtigung: patch auf deployments in shop“. `Skalieren…` ebenso.
  - Mit `denied: null` ist nichts gesperrt.
  - „Nur lesen“ hat Vorrang vor dem Rechte-Grund.
  - Die Node-Kachel `Node sperren (cordon)…` zeigt „(clusterweit)“.
  - Bei Pods tragen `Logs`, `Shell öffnen`, `Port weiterleiten…` und `Logs als Tab öffnen` ihren Rechte-Grund.
  - Der Rechte-Grund steht hinter „Pod läuft nicht“.
- **`kube-menu-run.test.ts`:** `{ type: 'logsAll', row }` ruft `runner.logsAll(row)`. Der Fake-Runner bekommt `logsAll: vi.fn()`.
- **`kube-commands.test.ts`:**
  - `actionReason` mit `access` liefert den Rechte-Grund nach den anderen Gründen.
  - `unavailable` von `s` und `l` meldet den Rechte-Grund für den ausgewählten Pod.

### 10.8 Ohne Komponententest
`WorkloadLogs.tsx`, `DetailDock.tsx` und `ClusterView.tsx` werden über die reinen Helfer (10.6) und die run-app-Szene (6.1) geprüft, wie bisher bei Kube-Komponenten.

### 10.9 Ende zu Ende (`fakes.test.mjs`, Task G)
- **Der Test aus 3.15:**
  - drei `api`-Pods, Zeiten mit neun Stellen, Folgen bringt neue Zeilen;
  - Rules-Review: `shop` vollständig mit gesperrten Patches, `monitoring` unvollständig, `kube-system` mit 403.

---

## 11. Manuelle Tests für den Nutzer (echter Cluster, nur lesend)

Am Cluster wird **nichts** verändert. Keiner der Tests klickt eine schreibende Aktion an.

- **M1 Logs aller Pods:** Rechtsklick auf ein Deployment mit mindestens zwei Replikas → `Logs aller Pods`. Prüfen:
  - Jede Zeile hat ein farbiges Präfix `pod/container`.
  - Die Zeiten steigen.
  - Es gibt so viele Chips wie Container.
  - `Folgen` hält das Ende im Blick.
  - Nach oben scrollen friert die Ansicht ein, und `Folgen (n neu)` zählt mit.
- **M2 Rules-Review am echten Server** (mit `admin.conf`):
  - Kein Eintrag ist wegen Rechten gesperrt.
  - Gegenprobe auf dem Host: `kubectl auth can-i --list -n <ns>` zeigt `*` auf `*.*`.
- **M3 Eingeschränktes Konto** (nur, wenn es eines gibt, etwa mit der Rolle `view`), als zweiter Cluster-Eintrag:
  - `Rollout neu starten…`, `Skalieren…`, `Shell öffnen` und `Port weiterleiten…` sind gesperrt, mit „Keine Berechtigung: …“.
  - Logs und `Logs aller Pods` sind frei.
  - Gegenprobe mit dem Konto selbst: `kubectl auth can-i patch deployments -n <ns>`. Nichts ausführen.
- **M4 Namespace-Wechsel:**
  - Auf einen anderen Namespace und zurück wechseln: Nach höchstens einer Sekunde stimmen die Sperren im neuen Namespace.
  - Im Modus „alle Namespaces“ gilt für eine Zeile aus Namespace X die Sperre von X.
- **M5 Last:**
  - Ein DaemonSet öffnen, das auf allen Nodes läuft.
  - Bei mehr als 20 Containern steht „… weitere warten (höchstens 20 gleichzeitig)“, und die Tabelle oben reagiert weiter flüssig.
  - Den Tab schließen: Die Netzlast des Shellherd-Hauptprozesses im Task-Manager sinkt sofort.
- **M6 Gesprächige Pods:**
  - Einen Workload mit vielen Logzeilen 10 Minuten offen lassen.
  - Tippen im Filter bleibt flüssig.
  - Der Arbeitsspeicher von Shellherd wächst um nicht mehr als etwa 150 MB.
- **M7 Reconnect:**
  - Im Vault `k8s-cp1` deaktivieren, während die Ansicht offen ist.
  - Nach dem Neuverbinden über `k8s-cp2` beginnt die Ansicht neu, mit leerem Puffer wie bei Einzel-Logs.
  - Die Sperren werden neu geladen.
- **M8 Rollout beobachten** (nur, wenn ohnehin einer läuft, etwa durch die Pipeline; nicht selbst auslösen):
  - Neue Pods erscheinen als neue Chips.
  - Die alten Pods stehen danach auf „beendet“.
