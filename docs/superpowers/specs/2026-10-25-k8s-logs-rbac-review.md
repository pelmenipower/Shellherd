# Logs aller Pods und RBAC-Vorabprüfung – Review (Stufe 5)

Branch `claude/feature/k8s-logs-rbac` gegen `claude/feature/pod-port-forward` (13 Commits, `3a24912..04f2d3e`, Arbeitsbaum sauber).
Grundlage: Spec `2026-10-25-k8s-logs-rbac-design.md`, der bindende Anhang `…-validation.md` (B1–B3, K1–K15, V1–V12) und das Ledger `.superpowers/sdd/2026-10-25-k8s-logs-rbac/progress.md` mit Nutzer-Ruling R-0 (nur lesend) und R-1 (Motion-Gate-Zeile bleibt).

**Urteil: ready after corrections** – 0 Critical, 1 Important, 5 Minor.
- I-1 (Kontextmenü wächst nach der Rechte-Antwort aus dem Fenster) ist klein und sollte vor dem Release 0.28.0 erledigt sein: Es ist der sichtbare Hauptweg der Vorabprüfung, der Shot `kube-rbac-menu.png` zeigt den Fehler.
- Die Minor-Befunde können als Folgepaket kommen; M-1 (Texte) ist billig und sollte mit I-1 gehen.
- Ohne Befund: Verben (R-0), Fail-open, Wahrheitstabelle, Lebenszyklus inkl. B3, Schema, kubeconfig, Tokens und Kontraste, Doku.

**Gates:**
- `npm run typecheck`: grün.
- `npx vitest run`: **171 Dateien, 2 695/2 695 grün** im ersten Lauf, kein Last-Flake in `fakes.test.mjs`.
- `src/main/kubernetes/workload-logs.ts` ist zeichengleich mit K1 (CRLF entfernt, `diff` leer).
- Kontraste nachgerechnet (WCAG 2.x), stimmen mit Anhang und `design-system.md` überein: dunkel 9,15/8,12/7,31 · 9,24/8,20/7,38 · 10,76/9,55/8,60 · 9,27/8,23/7,41; hell 6,21/5,76/5,04 · 6,93/6,43/5,63 · 5,93/5,50/4,81 · 6,61/6,13/5,37 (Bühne/Panel/erhöht). Chip „aus“ (`--color-text-muted` auf `--color-bg-raised`): 7,24 dunkel, 6,15 hell.
- Kein Cluster, kein Vault, kein Build nach `out/`. Treiber und Demo-Server nicht benutzt; Shots aus dem Lauf von Task J gelesen.

---

## 1. Sicherheit

### Verben (Nutzer-Ruling R-0)

Gesucht in allen hinzugefügten Zeilen unter `src/` (ohne Tests) nach `api.`, `makeApiClient`, `new Watch|Exec|PortForward|KubernetesObjectApi|ResourceWatcher`, `mergePatch`, `remove(`, `create*`, `followLog`, `rulesReview`, `sendRequest`, `fetch(`:

| Stelle | Aufruf | HTTP | RBAC-Verb |
|---|---|---|---|
| `workload-logs.ts:112` → `ResourceWatcher` → `api.list('pods', ns, { labels })` | `KubernetesObjectApi.list` | GET `/api/v1/namespaces/{ns}/pods?labelSelector=…` | `list` pods |
| dito → `api.watch(…)` | `Watch.watch` | GET `…/pods?watch=true&labelSelector=…` | `watch` pods |
| `workload-logs.ts:181` → `api.followLog` → `client-api.ts` `openLogs(…, follow)` → `requestLogs` | `https.request` GET | `/api/v1/namespaces/{ns}/pods/{pod}/log?container=…&follow=true&timestamps=true&tailLines=200` bzw. `&sinceTime=…` | `get` pods/log |
| `client-api.ts:536` `rulesReview` → `AuthorizationV1Api.createSelfSubjectRulesReview` | POST, Body nur `spec.namespace` | `/apis/authorization.k8s.io/v1/selfsubjectrulesreviews` | `create` selfsubjectrulesreviews (speichert nichts) |

- Sonst nichts Neues: kein `patch`, `update`, `delete`, `exec`, `portforward`, keine SSAR, kein `create` auf Objekte.
- `actions.ts`, `ConfirmAction` und `KubeSessions.action` sind im Diff unverändert. Die einzige Wirkung auf schreibende Aktionen ist die **zusätzliche Sperre** im Renderer (`actionReason` → `refAccessReason`, Menü, Tasten, Shell-Knopf). Main verlässt sich nie auf die Vorabprüfung.
- Der Fake erlaubt als einzige Nicht-GET-Anfrage `POST …/selfsubjectrulesreviews` (`kube-fake.mjs:145`), alles andere bleibt 403.
- **Kein Critical.**

### Bestätigungspfad, „Nur lesen“, Exec, Secrets, kubeconfig

- **Bestätigungspfad:** unverändert; Schreibaktionen nur über `ConfirmAction` → `runAction`, `confirm`/`startAction` prüfen zusätzlich `access` (`ClusterView.tsx:161`, `:173`).
- **„Nur lesen“ im Main:** `startLogs` erlaubt „Nur lesen“, lehnt `disabled` ab (`session.ts:611`). `access` prüft `disabled` nicht (M-4, harmlos, nur Abfrage).
- **Keine Exec ohne Klick:** kein `exec`. „Logs aller Pods“ startet nur per Menü (`runner.logsAll`) oder Knopf (`onArmLogsAll`), endet per `settleArm` beim Auswahlwechsel, wird nicht gespeichert.
- **kubeconfig verlässt den Main nie:** `KubeConfig` bleibt in `createKubeApi`; `KubeWorkloadLogs` sieht nur `KubeApi`. Zum Renderer gehen Zeilen, Pod-/Container-Namen, Zähler, `CodedError` und `KubeDenied` (`id`, `verb`, `resource`), nie Regeln oder Rohtexte des Servers.
- **B3 (Token an fremden Port):** `teardownLive` ruft `liveEnded` (`session.ts:363`), `KubeSessions` stoppt die Läufe der Views. Der Watcher des Laufs und alle Streams enden mit dem Tunnel. Der Pflicht-Test H ist grün; laut Ledger mit Mutationsprobe belegt.
- **Eingaben:** `KubeLogsStartRequestSchema`, `KubeLogsStopRequestSchema`, `KubeAccessRequestSchema` sind `.strict()`, Namespace DNS-1123, 1–32 Label-Paare nach `LABEL_KEY`/`LABEL_VALUE` (keine Kommas oder Operatoren), UUIDs, `format` nur `compact|raw`. `ipc.ts:84-98` parst vor jedem Zugriff hinter `requireSshSender`.
- **Anzeige:** React-Text, kein `dangerouslySetInnerHTML`; `cleanLogText` entfernt ESC/OSC, ersetzt Steuerzeichen, kürzt auf 4 000 Zeichen.

## 2. RBAC

### Fail-open in jedem Fehlerpfad

| Pfad | Ergebnis | Stelle |
|---|---|---|
| Review 403/404/Netzfehler | `null` | `session.ts:633` (`() => null`) |
| `status` fehlt, `incomplete: true`, `evaluationError` | `null` | `client-api.ts:542` (K3) |
| länger als 10 s | `null` | `session.ts:630`, Timer wird in `finally` gelöscht |
| Session nicht bereit | IPC wirft → Hook `.catch(() => null)` | `useClusterSession.ts:110` |
| Antwort nach Verbindungsverlust | verworfen | `kube-view.ts:102` (K6) |
| Status ≠ ready | Cache geleert | `kube-view.ts:321` |
| kein Eintrag | nichts gesperrt | `kube-access.ts:84` (`?.denied?.find`) |

Ergebnis: **fail-open in jedem Pfad.** Einziger Rest ist M-3 (eine alte `null`-Antwort lebt nach einem Reconnect bis zu 60 s), das ist ebenfalls offen, nicht geschlossen.

### Wahrheitstabelle (`src/shared/kube-access.ts`)

- `has` für Verben und Gruppen: `*` oder exakt (= `VerbMatches`, `APIGroupMatches`).
- `resourceMatches`: `*`, exakt, oder `*/<sub>` nur für Subressourcen (`slash > 0`), wie `ResourceMatches` in `rbac/v1/evaluation_helpers.go`. `pods/*` zählt nicht, `pods` deckt `pods/log` nicht, `*/exec` trifft nicht `pods/portforward`.
- `resourceNames` werden ignoriert → Erlaubnis (V1).
- Shell und Forward: Alternativen `create` **oder** `get` (Verb-Wechsel 1.31+/älter). `get` auf `*` gibt damit Shell und Forward frei (fail-open, Pflicht-Test A).
- `deployments/scale` erlaubt kein Skalieren, korrekt, weil `actions.ts:32` das Objekt selbst merge-patcht.
- Mapping gegen `actions.ts` geprüft: restart/scale → `patch` apps (`:24`, `:32`), delete → `delete` pods bzw. batch jobs (`:36-37`), cordon/uncordon → `patch` nodes (`:41`), suspend/resume → `patch` batch cronjobs (`:45`), trigger → `create` batch jobs plus `get` cronjobs (`:48`, liest die Vorlage).
- Leere `verbs`/`apiGroups` treffen nichts (RBAC-konform), `client-api.ts:544` macht aus fehlenden Feldern `[]`.
- Pflicht-Test A (21 Zeilen Wahrheitstabelle) grün.

### Cache

- Ablauf: `accessStale` → `now - at > 60 000` (`renderer/kube-access.ts:78`). Der Effekt (`ClusterView.tsx:101-104`) läuft über `state.now` (10-s-Takt) nur bei `ready` **und** sichtbarem Tab; also spätestens nach 70 s neu. Beim Öffnen eines Menüs zusätzlich (`:199-208`).
- Reconnect: Status ≠ ready leert `access`, nach `ready` fragt der Effekt sofort neu. Ausnahme M-3.
- Ein Request je Namespace gleichzeitig (`accessPending`).

### Tasten gegen Menü

| Funktion | Menü | Taste | gleich |
|---|---|---|---|
| Restart/Scale/Delete | `kubeActionItem` → `actionReason(…, access)` | `r`/`S`/`Strg+D` → `actionUnavailable` → `actionReason(…, access)` | ja, dieselbe Funktion |
| Shell | `terminalItems`: readOnly → verbunden → läuft → Container → `forbidden(shell)` | `s` → `shellUnavailable`: readOnly → reconnecting → verbunden → nur Pods → läuft → `shell` | ja |
| Logs/Vorherige | `forbidden(logs)` | `l`/`p` → `onlyForPods ?? accessOfSelection(logs)` | ja |
| Shell-Knopf im Dock | – | `shellForbidden` (`ClusterView.tsx:399`) | ja |

`Strg+Umschalt+T` und Dock-Reiter prüfen keine Rechte (V7, Nicht-Ziel).

## 3. Logs

- **Grenzen:** 20 Streams je View, 100 Quellen je Lauf, `tailLines` 200, 2 000 Zeilen je Batch (4×/s), Main hält ≤ 2 × 2 000 Zeilen plus 64 KiB Rest je Quelle, Renderer ≤ 10 000 Zeilen, angezeigt ≤ 2 000. Zeilen ≤ 4 000 Zeichen. Siehe M-2 zur Quellen-Grenze.
- **Ende bei Auswahlwechsel:** `settleArm` setzt `logsAllFor` zurück → `WorkloadLogs` unmountet → `kubeLogsStop(id)` → `run.stop()` stoppt Watcher, Streams und alle Timer. Reiter- oder Formatwechsel: Unmount bzw. neuer `key`. `start` ersetzt einen alten Lauf derselben View; ein spätes `stop(alteId)` trifft den neuen nicht (`workload-logs.ts:288`).
- **Tab-Ende, Fenster, Vault-Wechsel:** `close` → `logs.stopView`, `closeAll` → `logs.stopAll`. Start während des Schließens: `session.ts:615-618`.
- **Reconnect (B3):** Main stoppt beim Abbau, der Renderer startet über `epoch` neu (Teil des `key`, `DetailDock.tsx:187`).
- **Zeitstempel und Sortierung:** `splitTimestamp` normalisiert `Z` und `±hh:mm` auf UTC mit neun Stellen; String-Vergleich ist damit Zeitvergleich. `mergeLines` fügt stabil hinter der letzten gleich alten oder älteren Zeile ein, Zeilen ohne Zeit ans Ende.
- **Neustart mit `sinceTime`:** ganze Sekunde abgerundet, `skipUntil` verwirft alles `<=` der zuletzt gelesenen Zeit. Keine Dubletten; theoretischer Verlust nur bei zwei Zeilen mit identischem Nanosekunden-Stempel (hingenommen). Instanzschlüssel `restartCount/<ms>` gleich für Liste (`Date`) und Watch (Text), B1 erfüllt.
- **Speicher:** begrenzt wie oben. Mit gesetztem Filter läuft `shownLines` je Batch über bis zu 10 000 Zeilen (`foldCase`); messbar, aber begrenzt, kein Befund.

## 4. Beobachtungen des Orchestrators

1. **Kontextmenü ragt unten aus dem Fenster:** bestätigt und neu durch dieses Paket → **I-1**. Ursache ist nicht der Grund-Text allein, sondern dass die Rechte-Antwort *nach* dem Öffnen eintrifft und `ContextMenu` nur einmal positioniert. Im Shot steht das Menü bei `top ≈ 368`, oberhalb der angeklickten Zeile `api` (`y ≈ 457`). Es wurde also beim Öffnen schon geklemmt (Höhe damals ≈ 502 px) und ist danach um die Grund-Zeilen gewachsen. Das Menü scrollt nicht: `.context-menu` hat weder `max-height` noch `overflow`.
2. **`logTime` zeigt UTC per String-Slice:** **kein Befund.**
   - UTC ist eine bindende Entscheidung: K13 schreibt in beide Handbücher wörtlich „in UTC (`HH:MM:SS.mmm`), auch wenn ein Node in Ortszeit läuft“.
   - Die vorhandene Kompakt-Darstellung einzelner Logs zeigt ebenfalls UTC (`main/kubernetes/log-format.ts:52-73`). Beide Ansichten zeigen also dieselbe Uhr.
   - `slice(11, 23)` ist kein lokalisiertes Formatieren von Datum oder Zahl, sondern das Ausschneiden eines festen ISO-Felds. Damit gibt es weder `Intl`, `toLocale*` noch `localeCompare`.
   - Ortszeit wäre ein eigenes Ruling für beide Log-Ansichten zusammen. Das gehört in ein Folgepaket, nicht in diese Korrektur.
3. **`64px`/`220px` in `kubernetes-dock.css`:** **kein Befund.** Die Lint-Regel in `tokens.css:55` erlaubt Literale ≥ 48 px als Layout-Geometrie, `design-tokens.test.ts` ist grün. Es gibt Vorbilder (`files-ui.css:34` `flex: 1 1 200px`, `assistant-ui.css:45`, `kubernetes-ui.css:48` `min-width: 116px`).
4. **`logsAll.onDemand` holprig:** bestätigt → **M-1**, zusammen mit fehlenden Pluralformen.
5. **`SHOP_RULES` nach Quoting-Fehler:** **keine Reste.** `kube-fixtures.mjs:128-136` ist sauberes ESM. Das Modul lädt, und `SHOP_RULES` ergibt genau die fünf Regeln aus dem Kommentar. Es gibt keine Escape-Reste, und der Arbeitsbaum ist sauber. Gegen `deniedAccess` liefern die Regeln die erwarteten Sperren: patch auf Workloads und Nodes, delete auf Jobs.

---

## 5. Befunde

### Critical

Keine.

### Important

**I-1 – Das Kontextmenü wächst nach der Rechte-Antwort aus dem Fenster und lässt sich nicht scrollen.**
- **Datei:** `src/renderer/src/components/ContextMenu.tsx:23-29` (Positionierung nur bei `[x, y]`) und `src/renderer/src/components/navigation-ui.css:47` (kein `max-height`/`overflow`). Auslöser ist `ClusterView.tsx:199-208`: `openMenu` fragt die Rechte an, und der Kommentar dort verspricht, dass ein offenes Menü die Antwort übernimmt. Eigentümer: `ContextMenu.tsx`, `navigation-ui.css`; Test in `ContextMenu`-Tests oder `kube-menus`-nahe Komponententests.
- **Fehlerszenario:**
  - Erster Rechtsklick nach Ablauf des Cache, nach einem Namespace-Wechsel oder kurz nach `ready`. Das Menü misst sich ohne Gründe und wird geklemmt.
  - Danach kommt die Antwort, und gesperrte Einträge bekommen zweizeilige Gründe (`max-width: 320px`).
  - Das Menü wächst nach unten über den Fensterrand. Im Shot sind „Rollout neu starten…“ halb und „Skalieren…“ abgeschnitten.
  - Was unter dem Rand liegt, ist mit der Maus nicht erreichbar. Per Pfeiltaste fokussierte Einträge bleiben unsichtbar, denn `position: fixed` ohne Overflow scrollt nicht.
  - Auch ohne späte Antwort passt ein Workload-Menü mit Gründen in kleineren Fenstern (≈ 768 px) nicht mehr. Dieses Paket macht es um einen Eintrag und bis zu sechs Grund-Zeilen länger.
- **Fix:**
  - `navigation-ui.css:47`: `.context-menu` bekommt `max-height: calc(100vh - 8px); overflow-y: auto;`. `calc()` ist nach der Lint-Regel erlaubt, die 8 px entsprechen den 2 × 4 px Rand aus `ContextMenu.tsx:26-27`.
  - `ContextMenu.tsx`: Die Klemmung kommt aus dem bestehenden Layout-Effekt in eine Funktion `place()`. Der Effekt mit `[x, y]` ruft `place()` und setzt den Fokus wie bisher. Ein zweiter `useLayoutEffect` ohne Abhängigkeiten ruft nur `place()`, **ohne** Fokus, weil `entries` bei jedem Render neu ist und der Fokus sonst beim Navigieren springt. Alternativ ein `ResizeObserver` auf `menu.current`, der `place()` ruft.
  - Test: Das Menü mit drei Einträgen rendern und `getBoundingClientRect` mocken (Höhe 200, `innerHeight` 300, `y` 250). Danach mit sechs Einträgen und Höhe 280 neu rendern. Erwartet wird `style.top === '16px'`, der Fokus bleibt auf dem zuvor fokussierten Eintrag.
  - run-app: In `screens.mjs` `kube-logs` nach der Sperr-Prüfung `menu.getBoundingClientRect().bottom <= innerHeight` prüfen.

### Minor

**M-1 – Holpriger Satz und fehlende Pluralformen in `kubernetes:logsAll`.**
- **Datei:** `src/shared/locales/de-DE/kubernetes.json:191`, `:203-205` (en-US entsprechend). Eigentümer: beide Locale-Dateien, `WorkloadLogs.tsx` bleibt unverändert, weil i18next `count` auflöst.
- **Fehlerszenario:**
  - „…weil dafür bis zu 20 Log-Streams gleichzeitig öffnen.“: Dem Verb fehlt das Subjekt oder das Reflexivpronomen.
  - Bei `count = 1` steht „1 weitere warten“, „1 Zeilen ausgelassen“, „1 ältere Treffer“.
  - Der Katalog kennt Pluralformen bereits (`_one`, z. B. in `kubeActions.json`, `files.json`).
- **Fix, wörtlich:**
  - `onDemand`: „Logs aller Pods von {{name}}: Startet erst auf Knopfdruck, weil Shellherd dafür bis zu {{max}} Log-Streams gleichzeitig öffnet.“ / en bleibt.
  - `waiting_one`: „1 weiterer Container wartet (höchstens {{max}} gleichzeitig)“, `waiting_other`: „{{count}} weitere Container warten (höchstens {{max}} gleichzeitig)“; en `waiting_one`: “1 more container waiting (at most {{max}} at once)”, `waiting_other`: “{{count}} more containers waiting (at most {{max}} at once)”.
  - `dropped_one`: „1 Zeile ausgelassen (zu viele auf einmal)“, `dropped_other` wie bisher; en `dropped_one`: “1 line skipped (too many at once)”.
  - `olderHidden_one`: „1 älterer Treffer nicht angezeigt; Kopieren nimmt alle mit.“, `olderHidden_other` wie bisher; en `olderHidden_one`: “1 older match not shown; Copy includes it.”
  - Im Katalogtest prüfen, dass `_one`/`_other` als Paar akzeptiert werden, wie bei den vorhandenen Plural-Keys.

**M-2 – Nach 100 Quellen kommen neue Pods nie mehr dazu, die Anzeige sagt „warten“.**
- **Datei:** `src/main/kubernetes/workload-logs.ts:148` (K1, wörtlich übernommen). Beendete Quellen werden nie entfernt. Eigentümer: Doku `docs/handbuch.md:605`, `docs/manual.md:594` und `kubernetes.json` (Task F/I2); optional `workload-logs.ts` (Task D).
- **Fehlerszenario:**
  - Ein DaemonSet auf 60 Nodes hat nach dem ersten Rollout 120 Quellen. Ein Deployment mit 3 Replikas erreicht die Grenze nach etwa 33 Rollouts, etwa wenn die Ansicht einen Tag lang offen ist und CI ausrollt.
  - Ab der 101. Quelle zählt jeder neue Container als `waiting`. Die Ansicht zeigt „N weitere warten (höchstens 20 gleichzeitig)“, und das Handbuch sagt „weitere warten und rücken nach“.
  - Sie rücken aber nie nach, weil Slots nur für bekannte Quellen frei werden. Der Nutzer sieht die neuen Pods nicht und hält sie für wartend.
- **Fix (ohne Protokolländerung):**
  - In `sync` die beiden Gründe getrennt zählen: `waiting` (Stream-Grenze) und ein neues Feld `full` (Quellen-Grenze).
  - Einfacher Weg ohne Vertragsänderung: In beiden Handbüchern unter „Grenzen“/„Limits“ ergänzen.
    - de: „Nach 100 Containern in einer Ansicht kommen keine neuen mehr dazu; `Kompakt`/`Roh` umschalten startet die Ansicht neu.“
    - en: “After 100 containers in one view no new ones join; switching `Compact`/`Raw` starts the view again.”
  - Besser im Folgepaket: Beendete Quellen, deren Pod nicht mehr in `this.pods` steht, frei machen. Dabei bleibt der Index erhalten, damit alte Zeilen ihre Herkunft behalten: `info` wird ersetzt, nicht `splice`. Das braucht einen Hinweis im Renderer und gehört daher ins Folgepaket.

**M-3 – Eine Rechte-Anfrage, die über einen Reconnect läuft, blockiert die Neuabfrage und hinterlässt bis zu 60 s ein altes `null`.**
- **Datei:** `src/renderer/src/hooks/useClusterSession.ts:105-114`. Eigentümer: `useClusterSession.ts`, Test in `kube-view.test.ts`/Hook-Test (Task E).
- **Fehlerszenario:**
  - Die Anfrage läuft, der Tunnel fällt. Main antwortet erst mit Fehler oder nach dem 10-s-Timeout.
  - Der Reducer leert `access`. Nach `ready` ruft der Effekt `ensureAccess(ns)`, das wegen `accessPending.has(ns)` nichts tut.
  - Landet die alte Antwort (`null`) nach `ready`, übernimmt K6 sie mit `at = Date.now()`. Damit ist bis zu 60–70 s nichts gesperrt, obwohl die Spec „sofort nach einem Neuverbinden“ zusagt.
  - Das ist fail-open: Main lehnt weiter mit 403 ab, nichts Gefährliches wird möglich. Es widerspricht aber der Doku.
- **Fix:**
  - Eine Generation je Verbindung: `const accessEpoch = useRef(0)`. Ein Effekt auf `state.status?.state` erhöht sie bei jedem Wechsel weg von `ready` und leert `accessPending.current`.
  - `ensureAccess` merkt sich `const epoch = accessEpoch.current` und dispatcht nur bei `epoch === accessEpoch.current`. `delete` aus `accessPending` nur bei gleicher Generation.
  - Test: Anfrage starten, Status `reconnecting` → `ready`, `ensureAccess` erneut aufrufen. Erwartet werden zwei `kubeAccess`-Aufrufe, und die alte Antwort wird verworfen.

**M-4 – `KubeSessions.access` prüft `disabled` (und die Sperre) nicht.**
- **Datei:** `src/main/kubernetes/session.ts:627-638`. Eigentümer `session.ts`/`session.test.ts` (Task H).
- **Fehlerszenario:**
  - Anhang §5 sagt „`startLogs` und `access` … auf `disabled` abgelehnt“. Der Code entspricht aber Spec 3.6 und liest `getCluster` nicht.
  - Ein Cluster, der nach dem Öffnen deaktiviert wird, bekommt weiter Rules-Reviews, solange der Tab offen ist, ebenso bei gesperrtem Vault.
  - Das ist harmlos, weil es eine reine Abfrage ohne Speicherung ist und die Watcher der View ohnehin weiterlaufen. Es ist aber eine Abweichung vom bindenden Text.
- **Fix:**
  - Am Anfang `const view = this.viewOf(ownerId, viewId);`, danach `try { if (this.deps.getCluster(view.session.clusterId).disabled) return null; } catch { return null; }` (fail-open, auch bei gesperrtem Vault).
  - Test in `session.test.ts`: `world.cluster.disabled = true` → `access` liefert `null`, `rulesReview` wird nicht gerufen.

**M-5 – Die run-app-Prüfung „monitoring: nichts gesperrt“ besteht auch ohne Antwort.**
- **Datei:** `.claude/skills/run-app/screens.mjs:393-394`. Eigentümer `screens.mjs` (Task J).
- **Fehlerszenario:**
  - Nach `pause(3000)` wird nur geprüft, dass „Rollout neu starten“ aktiv ist. Das gilt auch, wenn die Review nie ankommt oder der Fake-Zweig `monitoring` kaputt ist.
  - Der Fall „unvollständig → nichts gesperrt“ ist damit in der App nicht belegt, nur im Unit-Test.
- **Fix:**
  - Nach dem Wechsel auf `monitoring` zuerst in `shop` gegenprüfen, dass die Sperre dort noch greift. Damit ist bewiesen, dass Antworten ankommen.
  - Für `monitoring` die Antwort im Fake zählen (`kube-fake.mjs` Zähler je Namespace, über einen vorhandenen Debug-Endpunkt oder einen Log) und erst danach `enabled('Rollout neu starten')` prüfen.
  - Wenn kein Debug-Weg gewünscht ist: den Kommentar ehrlich machen („prüft nur, dass nichts fälschlich gesperrt ist“).

---

## 6. Spec-Abdeckung

| Punkt | Stand | Beleg |
|---|---|---|
| R1.1 Arten über Selector | erfüllt | `LOGS_ALL_KINDS`, `logsAllItem`, `NO_SELECTOR_KEYS` |
| R1.2 Main löst Pods auf, hält sie aktuell | erfüllt | `ResourceWatcher` in `LogRun.start` |
| R1.3 gestartet = running/terminated/lastState | erfüllt, B1 | `startedContainers`, Pflicht-Test D |
| R1.4 Grenzen | erfüllt; Quellen-Grenze siehe M-2 | Konstanten in `shared/kubernetes.ts`, `workload-logs.ts`, `kube-logs.ts` |
| R1.5 Sortierung nach Server-Zeit | erfüllt (UTC, V4) | `splitTimestamp`, `mergeLines` |
| R1.6 Neustart ohne Dubletten (+ V3 Wiederaufnahme) | erfüllt | `sinceTime`, `skipUntil`, `resumeLater` |
| R1.7 Kompakt/Roh ohne ANSI | erfüllt | `formatLogLine` + `cleanLogText` |
| R1.8 Folgen, Filter, Quellen, Kopieren | erfüllt | `WorkloadLogs.tsx`, Shots `kube-logs-all(-filter).png` |
| R1.9 Lebenszyklus inkl. B3 | erfüllt | Abschnitt 3 |
| R2.1/R2.4 Review je Namespace, 60 s, V5 | erfüllt; Reconnect-Rest M-3 | `accessStale`, K7-Effekt, `openMenu` |
| R2.2 keine SSAR | eingehalten | – |
| R2.3 Auswertung wie RBAC, im Zweifel erlaubt | erfüllt | Abschnitt 2 |
| R2.5 Rückfall (inkl. `evaluationError`, 10 s) | erfüllt | Tabelle Abschnitt 2 |
| R2.6 Main wertet aus | erfüllt | `session.ts:633` |
| R3.1 Menüeintrag | erfüllt | `kube-menus.ts`, K11 |
| R3.2 Dock-Reiter Logs, Start auf Knopfdruck | erfüllt | `DetailDock.tsx:185-197` |
| R3.3 Aufbau | erfüllt | Shots |
| R3.4 keine Bewegung | erfüllt; Motion-Gate-Zeile nach R-1/K13 | `design-system.md`, `scrollTop` ohne `smooth` |
| R3.5 vier Tokens, hell/dunkel | erfüllt | `tokens.css`, Kontraste oben |
| R3.6 gesperrte Einträge mit Grund | erfüllt; Darstellung I-1 | Shot `kube-rbac-menu.png` |
| R4.1–R4.4 Sicherheit | erfüllt | Abschnitt 1 |
| R5.1 bestehende Aktionen unverändert | erfüllt (nur Sperre) | `actions.ts` ohne Diff |
| R5.2/R5.3 | eingehalten | – |
| R7.1 Verben | erfüllt | Abschnitt 1 |
| R8.1–R8.3 Tests, Zeitgeber, E2E | erfüllt | Pflicht-Tests A/B/D/E/H/I1, `fakes.test.mjs` |
| K1–K15 | umgesetzt | K1 zeichengleich; K4 `session.ts:363`, `:542`; K6 `kube-view.ts:102`; K7 `ClusterView.tsx:101-104`, `:398`; K9 CSS; K10 `kube-fake.mjs:196`; K13 Doku-Texte wörtlich; K14 `SKILL.md:24`, `:34`, `:124`, `screens.mjs:2`, `:358` |
| Version 0.28.0, CHANGELOG de/en, README | erfüllt | `version.test.ts` grün |

## 7. Manuelle Tests für den Nutzer (echter Cluster, nur lesend)

Mit dem gebauten Paket (`npm run dist`) und einem Test- oder Staging-Cluster. Shellherd ruft dabei nur `get`/`list`/`watch` auf Pods und `pods/log` sowie `create` auf `selfsubjectrulesreviews` auf (Abfrage ohne Speicherung). **Keine gesperrte oder freigegebene Schreibaktion anklicken.** Vorab lesend auf dem Zugangs-Host: `kubectl auth can-i --list -n <ns>`.

1. **M1 Logs aller Pods (entscheidet über das Release):**
   - Rechtsklick auf ein Deployment mit ≥ 2 Replikas → `Logs aller Pods`. Je Pod ein Chip in eigener Farbe, „Live: n von n Containern“, Zeilen nach Zeit gemischt.
   - Gegenprobe: `kubectl logs <pod> --timestamps --tail=5` für zwei Pods. Die Zeiten (UTC) und die Reihenfolge stimmen.
   - Einen ruhigen Pod länger als 1 Minute offen lassen: Er bleibt live oder ist nach 5 s wieder live (V3, Proxy-Idle).
2. **M2 Rechte-Vorabprüfung mit eingeschränktem Konto** (Konto nur mit `view`): Rechtsklick auf ein Deployment. „Rollout neu starten…“ und „Skalieren…“ sind gesperrt mit „Keine Berechtigung: patch auf deployments in <ns>“. „Logs aller Pods“ ist frei. Gegenprobe: `kubectl auth can-i patch deployments -n <ns>` → `no`.
3. **M3 Konto mit vollen Rechten:** Nichts ist gesperrt. Mit einer Bindung an eine gelöschte Rolle (nur falls vorhanden, nicht anlegen) darf ebenfalls nichts gesperrt sein.
4. **M4 GKE/AKS mit Azure-RBAC oder EKS Access Entries** (falls verfügbar): Nichts ist gesperrt (Review unvollständig).
5. **M5 Menü-Höhe (nach dem Fix von I-1):** Fenster auf etwa 760 px Höhe verkleinern, Namespace wechseln und sofort ein Deployment rechtsklicken. Das Menü bleibt im Fenster, lässt sich scrollen, und alle Einträge sind erreichbar, auch per Pfeiltasten.
6. **M6 Tasten:** Mit `view`-Konto Deployment wählen, `r` und `S` drücken. Die Kopfzeile zeigt denselben Grund wie das Menü, und kein Dialog öffnet sich.
7. **M7 Lebenszyklus:**
   - Andere Zeile wählen: Die Ansicht endet.
   - Reiter `YAML` wählen, dann zurück: Die Ansicht startet erst wieder per Knopf.
   - `Kompakt`/`Roh` umschalten: Die Ansicht startet neu.
   - Tab schließen. Im Ressourcenmonitor (Netzwerk → TCP-Verbindungen, Prozess Shellherd) sinkt die Zahl der Verbindungen zum Tunnel-Port.
8. **M8 Reconnect:**
   - VPN oder WLAN etwa 10 s trennen. Die Ansicht zeigt den letzten Stand.
   - Nach „Wieder verbunden“ startet sie mit leerem Puffer neu.
   - Gesperrte Einträge erscheinen spätestens nach einer Minute wieder (nach dem Fix von M-3 sofort).
9. **M9 Rollout (nur, wenn eure Pipeline ohnehin ausrollt, nie durch Shellherd):** Neue Pods kommen von selbst dazu, alte bleiben als „beendet“. Es gibt keine doppelten Zeilen nach einem Container-Neustart: Gegenprobe `kubectl logs <pod> --previous --tail=3`.
10. **M10 Last:** Ein gesprächiges Deployment (Ingress-Controller) 5 Minuten offen lassen. Der Speicher von Shellherd im Task-Manager bleibt stabil, „Zeilen ausgelassen“ erscheint nur bei echter Flut.
11. **M11 Ortszeit-Node** (falls vorhanden): Zeilen eines Nodes mit `+02:00`-Runtime sortieren sich korrekt zwischen UTC-Nodes ein.
