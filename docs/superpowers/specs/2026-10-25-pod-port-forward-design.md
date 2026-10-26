# Pod- und Service-Port-Forward – Design

> Übernommen aus dem Konzept (Opus, `.superpowers/sdd/pod-port-forward-research.md`). Bindend geht `2026-10-25-pod-port-forward-validation.md` vor.

Branch `claude/feature/pod-port-forward`, gestapelt auf 0.26.0, Ziel **0.27.0**. Nutzer-Ruling: nur lesend, keine schreibenden Cluster-Aktionen. Die Umsetzer sind Haiku-Modelle; Signaturen, Texte und Fehlercodes unten sind wörtlich zu übernehmen.


Branch `claude/feature/pod-port-forward`, Basis 0.26.0, Ziel **0.27.0**, CHANGELOG-Datum wörtlich `2026-10-25`.

Ziel: Im Cluster-Tab leitet `Port weiterleiten…` einen Port eines Pods oder eines Service auf `127.0.0.1` dieses Computers weiter. Eine Leiste unten im Cluster-Tab zeigt die Weiterleitungen mit `Im Browser öffnen`, `Adresse kopieren` und `Stoppen`.

**Bindendes Nutzer-Ruling R-0:** Neue Kubernetes-Funktionen lesen oder analysieren nur. Es kommt keine schreibende Cluster-Aktion dazu. Port-Forward verändert keine Workloads und ist erlaubt. Die vollständige Liste der neuen API-Aufrufe mit ihren Verben steht in R7.1.

Die Umsetzer sind Haiku-Modelle. Signaturen, Texte, Fehlercodes und Code-Blöcke unten sind verbindlich und wörtlich zu übernehmen. Der Kern ist im Scratchpad ausgeführt (0.7): client-node `PortForward` gegen einen `v4.channel.k8s.io`-Server, Fehlerkanal und 403 im Handshake.

---

## 0. Bestand (mit Fundstellen)

### 0.1 Weg zum API-Server
- `openTunnel(forward, target, port = 0)` lauscht auf `127.0.0.1` und trägt jede Verbindung per `forward(host, port)` über den SSH-Host (`src/main/kubernetes/tunnel.ts:15-39`, Bindung `:33`). `dropChannel` zerstört einen ssh2-Kanal und ruft `resume()` auf, sonst kommt kein `close` (`:9-12`).
- Die Session öffnet den Zugang, liest die kubeconfig, öffnet den Tunnel zu `parsed.server` (z. B. `k8s-cp1:6443`) und baut den Client (`src/main/kubernetes/session.ts:243-272`).
- `parseKubeconfig(...).build(localPort, tlsServerName)` erzeugt eine `KubeConfig` gegen `https://127.0.0.1:<Tunnelport>`. Als `tlsServerName` setzt sie den echten Servernamen (`kubeconfig.ts:94-101`). Bei einem Fehler im Zertifikatsnamen folgt ein zweiter Versuch mit `kubernetes` (`session.ts:275-286`).
- **Der WebSocket-Weg funktioniert durch diesen Tunnel schon heute:**
  - Die Pod-Shell nutzt `new Exec(config)` (`client-api.ts:262-309`), also denselben `WebSocketHandler` wie `PortForward`.
  - client-node setzt für WebSockets `servername` aus `tlsServerName` (`node_modules/@kubernetes/client-node/dist/config.js:590-592`).
  - Den `Authorization`-Header setzt client-node ebenfalls (`:611-636`).

### 0.2 Session, Views, Lebenszyklus
- `KubeSessions` teilt eine `Session` pro Cluster zwischen allen Views und Terminals (`session.ts:509-642`).
- Die Session endet 60 s nach der letzten View und dem letzten Terminal (`maybeIdle`, `:492-498`, `DEFAULT_IDLE_MS` `:25`). Terminals halten sie über `holdTerminal` wach (`:165-174`).
- Fällt der Zugangs-Host aus, baut `reconnect` Tunnel und API neu auf (`:317-347`). `teardownLive` schließt dabei den Tunnel (`:350-364`). `waitReady()` liefert die neue API und wartet höchstens 30 s auf den Reconnect (`:182-201`, `READY_WAIT_MS` `:35`).
- `close(ownerId, viewId)`, `closeOwner` und `closeAll` stehen in `:574-598`.
  - `closeAll` läuft bei Vault-Wechsel und Beenden (`src/main/index.ts:86`, `:357`).
  - `closeOwner` läuft beim Schließen eines Fensters (`index.ts:80-83`).
  - Beim Sperren läuft keiner der drei, denn Cluster laufen weiter (Lock-Screen-Spec R1, `docs/superpowers/specs/2026-10-21-lock-screen-design.md:429`, Tabelle `:276`).
- `action()` liest den Vault bei jedem Aufruf und lehnt `readOnly` ab (`session.ts:566-572`). `openTerminal` lehnt bei `readOnly` nur die Shell ab (`:604`).
- Die Leerlauf-Trennung aus dem Paket connection-timeouts gilt nur für SSH- und Pod-Terminals (`src/main/ssh/session.ts:112-115`, `:527-537`). Der Zugangs-Host eines Clusters hat keinen Leerlauf-Timer.
- Fehler laufen so:
  - `KubeApiError(message, code, coded)` (`api.ts:121-123`).
  - `toApiError` bildet 401, 403, 404, 410, TLS-Fehler und Verbindungsabbrüche ab (`client-api.ts:81-101`).
  - `userError` lässt nur `AppError` und `KubeApiError` zum Renderer durch (`session.ts:77-81`, `ipc.ts:166-174`).
- Drei Test-Fakes implementieren `KubeApi`: `overview.test.ts:38`, `session.test.ts:67` und `watch.test.ts:17`. Eine neue Pflichtmethode in `KubeApi` muss in allen dreien ergänzt werden.

### 0.3 client-node 2.0.0 `PortForward`
- `PortForward.portForward(ns, pod, [port], output, err, input)` öffnet **einen** WebSocket auf `/api/v1/namespaces/<ns>/pods/<pod>/portforward?ports=<port>` (`dist/portforward.js:11-48`). Pro lokaler TCP-Verbindung braucht es deshalb einen eigenen WebSocket. SPDY gibt es nicht.
- client-node bietet die Subprotokolle `v5.channel.k8s.io`, `v4.channel.k8s.io`, `v3.channel.k8s.io`, `v2.channel.k8s.io` und `channel.k8s.io` an (`dist/web-socket-handler.js:2-8`). Der Port-Forward des Kubelets kennt `v4.channel.k8s.io`, die Base64-Variante und das leere Protokoll. Ausgehandelt wird also `v4`.
- Protokoll:
  - Kanal 0 trägt die Daten, Kanal 1 die Fehler.
  - Jeder Kanal beginnt mit 2 Byte Portnummer. client-node schneidet sie ab (`portforward.js:27-36`).
  - Es gibt keinen Gegendruck: `input.on('data')` ruft `ws.send` auf, und `output.write(buff)` prüft den Rückgabewert nicht (`web-socket-handler.js:55-70`, `portforward.js:40`).
- Endet der lokale Socket, schließt client-node den WebSocket (`:59-68`). Endet umgekehrt der WebSocket, tut client-node nichts am lokalen Socket. Das muss der Aufrufer verdrahten.
- Fehler im Handshake landen nur vor dem Öffnen in `reject` (`:150-154`). `ws` meldet dabei nur `Unexpected server response: <Status>`, ohne Body.
- `portForwardService` und `portForwardDeployment` (`portforward.js:61-96`) taugen für Shellherd nicht:
  - Sie nehmen den **Service-Port als Pod-Port**, ohne `targetPort` und ohne benannte Ports.
  - Sie lösen den Pod nur einmal auf.
  
  Die Auflösung übernimmt Shellherd deshalb selbst (R1.2).

### 0.4 SSH-Weiterleitungen (Paket ssh-pro)
- `SessionForwards` (`src/main/ssh/forwards.ts:64-319`) verwaltet die Weiterleitungen einer Terminal-Sitzung. `ForwardRegistry` (`:16-47`) sorgt dafür, dass ein Vault-Eintrag app-weit nur einmal läuft.
- `listenFailure` macht aus `EADDRINUSE` und `EACCES` die Codes `ssh.forwardPortInUse` und `ssh.forwardPortDenied`, jeweils mit `{ port }` (`:322-327`). Die Texte stehen in `errors/ssh.json:59-60`.
- `busy()` hält eine SSH-Sitzung gegen Leerlauf wach (`:145-147`, `ssh/session.ts:534`).
- Die Leiste ist `ForwardBar` (`src/renderer/src/components/ForwardBar.tsx:22-60`).
  - CSS: `forward-ui.css:1-10`. Eingebunden ist sie unter dem Terminal (`TerminalPanel.tsx:366-367`).
  - Texte unter `terminal:forwards.*` (`locales/de-DE/terminal.json:135-153`), darunter `label` („Weiterleitungen“), `stop`, `stopLabel`, `state.active` und `open_one/_other`.
- Diese Regeln aus ssh-pro gelten hier weiter:
  - Bindung fest an `127.0.0.1`, ohne Feld dafür (`2026-10-24-ssh-pro-design.md:23`, `:303`).
  - Gesperrt laufen Weiterleitungen weiter, Starten geht nicht (`:315`).
  - Ports nie über `formatNumber` (`:273`).
- Das Handbuch sagt heute ausdrücklich, dass Pods und Services nicht dabei sind: `docs/handbuch.md`, Abschnitt „Port-Weiterleitungen“, vorletzter Punkt, und `docs/manual.md:425-426`.

### 0.5 Renderer der Kubernetes-Ansicht
- Kontextmenüs sind reine Daten (`src/renderer/src/kube-menus.ts`).
  - Pods: `podRowGroups` (`:170-198`). Services: `serviceGroups` (`:283-302`).
  - Der Service bietet heute nur `kubectl port-forward svc/<name> <port>:<port>` zum Kopieren (`:300`, Builder `kube-kubectl.ts:57-59`).
  - Die Kontextmenü-Spec nennt Port-Forward „Stufe 3“ (`2026-10-16-kubernetes-context-menus-design.md:126`, `:279`).
- `runMenuAction` verteilt die Aktionen auf `MenuRunner` (`kube-menu-run.ts:8-36`). Der Test prüft den Runner per `satisfies MenuRunner` (`kube-menu-run.test.ts:6-8`). Eine neue Runner-Methode muss dort ergänzt werden.
- Die Menütests vergleichen die Beschriftungen der Pod- und Service-Menüs wörtlich (`kube-menus.test.ts:90-96`, `:366-371`).
- `ClusterView` (`components/kubernetes/ClusterView.tsx`):
  - Runner: `:207-220`.
  - `say()` für kurze Meldungen in der Kopfzeile: `:92-97`.
  - Dialog `ConfirmAction`: `:354-357`.
  - Aufbau: `.kube-view` ist ein Spalten-Flex (`kubernetes-ui.css:3`), darin `.kube-body` (`:341-351`).
- `ConfirmAction` ist das Dialog-Muster (`ConfirmAction.tsx:26-94`): Klassen `confirm-dialog compact-confirm kube-confirm`, dazu `kube-field`, `BusyButton` und `useNativeSurfaceBlock`. `.kube-confirm` erscheint ohne Animation (`styles.css:148-150`, Motion-Gate `design-system.md:255`).
- `useClusterSession` hält `viewId` und bietet `detail` und `action` (`hooks/useClusterSession.ts:63-77`). Der Reducer `applyEvent` ist ein vollständiger `switch` ohne `default` (`kube-view.ts:296-304`). Eine neue Ereignisart muss dort behandelt werden.
- `KubeRow` kennt keine Ports. Services haben nur die Zelle `ports` als Text (`rows.ts:243-247`), Pods gar nichts.
- `openExternal` nimmt `http:` und `https:` ohne Benutzerdaten an, also auch `http://127.0.0.1:<port>/` (`src/shared/links.ts:3-10`, `index.ts:345-351`).

### 0.6 run-app
- `kube-fake.mjs` ist ein HTTPS-Server auf `127.0.0.1:9334`, nur lesend und mit Token-Prüfung (`:44-159`).
  - Die App erreicht ihn nur über den SSH-Fake als `k8s-cp1:6443` (`sshd.mjs:201-207`).
  - WebSocket-Upgrades beantwortet er heute nicht. Auch die Pod-Shell geht im Fake nicht.
- Fixtures (`kube-fixtures.mjs`):
  - Pods haben weder `status.conditions` noch `containerPort` (`:34-45`).
  - Die Services `api` (Port 80) und `checkout` (Port 8080) haben kein `targetPort` (`:104-107`).
  - `checkout` hat nur einen nicht bereiten Pod (`:57-61`). `report-0` ist Pending (`:62`).
- `fakes.test.mjs` treibt den echten App-Code gegen die Fakes, auch über den SSH-Tunnel (`:93-122`). Der Test läuft nur unter Windows (`:28`). vitest nimmt `.claude/skills/run-app/*.test.mjs` mit (`vitest.config.ts`).
- `ws` 8.22.0 liegt hochgezogen in `node_modules/ws`. Es ist eine Abhängigkeit von `@kubernetes/client-node`, keine direkte Projekt-Abhängigkeit.

### 0.7 Geprüfte Annahmen
Die Probe liegt im Scratchpad unter `C:\Users\alexa\AppData\Local\Temp\claude\C--workspace-Shellherd\821585cb-09d8-4824-863b-740c14694f7a\scratchpad\pf\probe.mjs`. Sie verbindet:
- einen `ws`-Server mit der Fake-Logik aus 3.17,
- client-node 2.0.0 `PortForward`,
- die Verdrahtung aus 3.5.

Ergebnis:
1. Ausgehandelt wird `v4.channel.k8s.io`.
2. Zwei HTTP-GETs über denselben lokalen Port liefern `synthetic pod page /hello` und `synthetic pod page /again`. Der zweite läuft über dieselbe Keep-Alive-Verbindung.
3. Port ohne Dienst: Der Fehlerkanal schreibt, und `socket.destroy(err)` erreicht den `error`-Listener des lokalen Sockets mit genau diesem Fehler. Der Client bekommt eine leere Antwort.
4. 403 im Handshake: Der `reject` trägt `Unexpected server response: 403`, der lokale Socket wird geschlossen.
5. Nach `pause()` braucht der lokale Socket ausdrücklich `resume()`. Ein `data`-Listener allein bringt ihn nicht wieder in Fluss.

Nicht geprüft ist ein echter API-Server samt Kubelet. Das klärt M1 (Abschnitt 11).

---

## 1. Empfehlungen

| # | Fläche / Funktion | Wert | Aufwand |
|---|---|---|---|
| 1a | Pod-Port weiterleiten: Kontextmenü an Pod-Zeilen, Dialog mit den deklarierten Ports und `Anderer Port …` | ★★★ | kleine Main-Änderung (neues Modul) plus Renderer |
| 1b | Service-Port weiterleiten: je Verbindung aufgelöst auf einen bereiten Pod mit `targetPort` (auch benannt), übersteht Rollouts ohne Neustart | ★★★ | Main (im selben Modul) |
| 1c | Leiste „Weiterleitungen“ unten im Cluster-Tab: Ziel, aufgelöster Pod, offene Verbindungen, letzter Fehler, `Im Browser öffnen`, `Adresse kopieren`, `Stoppen` | ★★★ | nur Renderer (CSS der `ForwardBar` wiederverwendet) |
| 1d | Bindung nur an `127.0.0.1`, lokaler Port frei wählbar oder leer (dann ein freier Port) | ★★★ | Main |
| 1e | Fehler als `AppError`-Codes: Pod weg, Pod läuft nicht, Port abgelehnt, 403, kein bereiter Pod, Port belegt, Grenzen | ★★★ | Main plus Texte |
| 1f | run-app: Fake beantwortet `pods/portforward` per WebSocket; Abnahme per HTTP-GET über den lokalen Port; Ende-zu-Ende-Test in `fakes.test.mjs` | ★★★ | run-app |
| 1g | Produktionshinweis im Dialog (eine Zeile, keine Namenseingabe) | ★★ | Renderer |
| 1h | Deployment oder StatefulSet als Ziel | ★ | nicht jetzt (R1.3) |
| 1i | Gespeicherte oder automatisch startende Cluster-Weiterleitungen | ★ | nicht jetzt (R4.5) |
| 1j | Gegendruck (Backpressure) im WebSocket-Pfad | ★★ | nicht jetzt (Risiko 2) |

---

## 2. Rulings (Entscheidungen mit Begründung)

### 1 – Ziele

**R1.1 Pod: Jeder TCP-Port geht, vorgeschlagen werden die deklarierten `containerPort`s.**
- `containerPort` ist im Manifest nur eine Angabe. Der Kubelet leitet auf jeden Port im Pod-Netz weiter.
- Der Dialog bietet deshalb die deklarierten TCP-Ports aller Container zur Auswahl an, dazu `Anderer Port …` mit freiem Zahlenfeld. Hat der Pod keine deklarierten Ports, steht nur das Zahlenfeld da.
- Die Weiterleitung bleibt an diesem **Pod-Namen**:
  - Startet der Container neu, geht es danach weiter.
  - Ein StatefulSet-Pod kommt mit demselben Namen zurück; auch dann geht es weiter.
  - Ist der Pod weg, zeigt die Leiste `kubernetes.portForwardPodGone`. Der lokale Port bleibt offen, bis der Nutzer `Stoppen` drückt. Ein automatisches Ende wäre bei StatefulSets falsch.
- Das Menü bietet den Eintrag nur für Pods mit Status `Running` an.

**R1.2 Service: Auflösung wie bei `kubectl`, aber neu bei jeder Verbindung, die über den bekannten Pod nicht klappt.**

Ablauf:
1. `get` Service: `spec.selector` und der Service-Port, für den `port === gewählter Port` gilt und dessen Protokoll TCP ist.
2. `list` Pods mit dem Selector als `labelSelector`.
3. Bereit heißt: `phase === 'Running'`, Bedingung `Ready=True`, kein `deletionTimestamp`. Unter den bereiten Pods gewinnt der erste nach Namen. Das macht die Wahl deterministisch.
4. Der Pod-Port ist der `targetPort`: eine Zahl direkt, ein Name über `containers[].ports[].name`. Fehlt `targetPort`, gilt der Service-Port.

Wiederholung und Rollouts:
- Der ermittelte Pod wird gemerkt (`hop`).
- Schlägt das Öffnen über ihn fehl (404, 400 oder anderes), löst Shellherd einmal sofort neu auf.
- So übersteht eine Service-Weiterleitung Rollouts von selbst. Das kann `kubectl port-forward svc/…` nicht.

Bewusst **nicht** über EndpointSlices:
- Pods `list` braucht die App ohnehin für die Pod-Tabelle. EndpointSlices fehlen dagegen in manchen `view`-Rollen. So kommt weder eine neue Ressource noch ein neues Recht dazu.
- Benannte `targetPort`s löst der Pod direkt auf.

Grenze:
- Services ohne Selector (ExternalName, manuelle Endpoints) gehen nicht.
- Das Menü begründet das mit dem vorhandenen Text `kubeActions:reasons.noSelectorService`.

**R1.3 Kein Deployment- oder StatefulSet-Ziel in diesem Paket.**
- Für jedes Deployment, das Traffic bekommt, gibt es praktisch immer einen Service, und der Service-Weg deckt Rollouts schon ab.
- Ein Deployment-Ziel wäre dieselbe Auflösung mit `matchLabels`. Es kommt als Extra, falls jemand es vermisst.

**R1.4 Ein Port pro Weiterleitung, nur TCP.** Kubernetes leitet ohnehin nur TCP weiter. Mehrere Ports sind mehrere Weiterleitungen.

### 2 – Lokaler Port

**R2.1 Vorschlag ist derselbe Port wie im Pod oder Service. Leer heißt: freier Port.**
- Das entspricht `kubectl port-forward` und ist leicht zu merken.
- Solange der Nutzer das Feld nicht selbst ändert, folgt es dem gewählten Pod- oder Service-Port.
- Darunter steht immer der Hinweis „Nur auf diesem Computer erreichbar (127.0.0.1). Leer lassen: Shellherd wählt einen freien Port.“
- Konflikte:
  - Main kann den Port nicht binden und meldet `ssh.forwardPortInUse` bzw. `ssh.forwardPortDenied`. Die Texte kommen aus ssh-pro.
  - Der Dialog bleibt offen und zeigt den Text.
  - Eine Vorabprüfung „frei?“ gibt es nicht, sie wäre ein Wettlauf.
- Ports unter 1024 lassen sich unter Windows ohne Rechte binden. Sind sie belegt (80, 443, 445), kommt dieselbe Meldung.

**R2.2 Nur `127.0.0.1`, nie `0.0.0.0`, und kein Feld dafür.**
- Eine Weiterleitung trägt die Cluster-Rechte des Nutzers: das Token aus der kubeconfig und den SSH-Zugang.
- Auf `0.0.0.0` erreicht jeder Rechner im WLAN oder LAN die interne Datenbank oder Admin-Oberfläche. RBAC, NetworkPolicies und SSH-Zugang wären still umgangen.
- Dazu kommt eine Rückfrage der Windows-Firewall, die Nutzer gewohnheitsmäßig bestätigen.
- Es gilt dieselbe Regel wie bei den SSH-Weiterleitungen (ssh-pro) und dem API-Tunnel (`tunnel.ts:33`).
- IPv6 `::1` wird nicht gebunden. `Im Browser öffnen` und `Adresse kopieren` nennen deshalb immer `127.0.0.1`, nie `localhost`.

### 3 – UI

**R3.1 Kontextmenü `Port weiterleiten…`.**
- Pod-Zeile: am Ende der Gruppe Logs/Shell/Ansichten/Tab, nach `Shell als Tab öffnen`.
- Service-Zeile: in der ersten Gruppe nach `Pods anzeigen`.
- In diesen Fällen ist der Eintrag gesperrt, mit Begründung:

  | Fall | Begründung |
  |---|---|
  | nicht verbunden | vorhandener `connectedReason` |
  | Pod nicht `Running` | `kubeActions:reasons.notRunning` |
  | Service ohne Selector | `kubeActions:reasons.noSelectorService` |
  | Service ohne TCP-Port | neu `kubeActions:reasons.noTcpPort` |

- `Nur lesen` sperrt den Eintrag **nicht** (R6.2).
- Es gibt kein Tastenkürzel.
- Der Container-Drilldown bekommt keinen Eintrag, denn Ports gehören zum Pod.
- Der kopierbare `kubectl port-forward`-Befehl bleibt.

**R3.2 Dialog `Port weiterleiten`.**
- Ein kleiner Dialog im Muster von `ConfirmAction`, Klassen `confirm-dialog compact-confirm kube-confirm kube-forward`. Wie alle Kube-Dialoge erscheint er ohne Animation, ein Eintrag im Motion-Gate entfällt also.
- Felder:
  - eine Port-Auswahl (`select name="port"`);
  - bei `Anderer Port …` ein Zahlenfeld (`name="remote"`);
  - `Lokaler Port` (`name="local"`);
  - Hinweise als `field-hint`.
- Knöpfe: `Abbrechen` (sekundär) und `Weiterleiten` (primär, `BusyButton`).
- `Enter` in einem Feld startet die Weiterleitung. `Esc` schließt den Dialog, solange nichts läuft.
- Nach dem Start schließt der Dialog, und die Kopfzeile meldet per `say()` „Weiterleitung aktiv: 127.0.0.1:8080“.

**R3.3 Eigene Leiste `KubeForwardBar` unten im Cluster-Tab, mit dem CSS und den Grundtexten der `ForwardBar`.**
- Die Kubernetes-Ansicht hat kein Terminal. Die Leiste sitzt deshalb als letztes Kind von `.kube-view` unter `.kube-body` und erscheint nur, wenn es Weiterleitungen gibt.
- Die Komponente `ForwardBar` selbst wird **nicht** wiederverwendet:
  - Sie kennt `start` und `elsewhere` und ruft `sshForward` auf.
  - Hier gibt es kein „Starten“, denn eine gestoppte Weiterleitung verschwindet. Dafür gibt es `Im Browser öffnen` und `Adresse kopieren`.
  - Ein gemeinsamer Umbau würde zwei fertige Flächen anfassen.
- Wiederverwendet werden:
  - die Klassen `forward-bar`, `forward-bar-label`, `forward-list`, `forward-item`, `forward-text`, `forward-state`, `forward-open`, `forward-error` und `forward-button`;
  - die Texte `terminal:forwards.label`, `.stop`, `.stopLabel`, `.state.active` und `.open`.
  
  So sieht die Leiste aus wie die im Terminal und braucht kein neues CSS.
- Je Weiterleitung zeigt sie:
  - `127.0.0.1:<lokal> → <Ziel>`; das Ziel ist `pod:port` oder `svc/name:port`, geschrieben wie die kubectl-Argumente;
  - bei Services `über <pod>:<port>`;
  - `aktiv` oder den letzten Fehler in Rot;
  - `n Verbindungen offen`;
  - drei Knöpfe.

**R3.4 `Im Browser öffnen`** öffnet `http://127.0.0.1:<port>/` über das vorhandene `openExternal`. Bei Ziel-Port 443 oder 8443 nimmt es `https`. Ob der Dienst HTTP spricht, weiß Shellherd nicht. Der Knopf steht deshalb immer da; spricht der Dienst kein HTTP, zeigt der Browser den Fehler.

**R3.5 `Adresse kopieren`** kopiert `127.0.0.1:<port>` über `writeClipboardText`. Die Bestätigung „Kopiert: …“ nutzt den vorhandenen Text `kubernetes:view.copied`.

### 4 – Lebenszyklus

**R4.1 Eine Weiterleitung gehört ihrer View, also ihrem Cluster-Tab.**

| Ereignis | Folge |
|---|---|
| `Stoppen` | Listener und alle Verbindungen zu, Eintrag weg |
| Cluster-Tab schließen, `Erneut versuchen` (neue View) | `KubeSessions.close` ruft `stopView`: Listener und Verbindungen zu, danach kein Ereignis mehr |
| Fenster schließen oder abstürzen | `closeOwner` ruft `close` für jede View (wie oben) |
| Anderer Vault, Beenden | `closeAll` ruft `stopAll` |
| Vault sperren, manuell oder automatisch | **läuft weiter**, wie SSH-Weiterleitungen und Cluster (Lock-Screen R1). Starten geht nicht: Die UI ist `inert`, und Main liest beim Start den Vault (`getCluster`) und lehnt im gesperrten Zustand ab |
| Zugangs-Host fällt aus (Reconnect) | Der Listener bleibt. Bestehende Verbindungen brechen mit dem Tunnel ab. Neue Verbindungen warten über `waitReady()` bis zu 30 s auf den Cluster, sonst enden sie mit `kubernetes.reconnecting` als letztem Fehler |
| Cluster dauerhaft im Fehler | Neue Verbindungen enden sofort, der Fehler steht in der Leiste |

**R4.2 Kein eigenes Wachhalten nötig.**
- Die Session lebt, solange die View lebt (`maybeIdle`).
- Weiterleitungen enden mit ihrer View, ein `holdTerminal` brauchen sie also nicht.
- Für die Leerlauf-Trennung gibt es nichts zu tun, denn sie gilt nicht für Cluster (0.2).

**R4.3 Offene Weiterleitungen zählen nicht als Aktivität für die Auto-Sperre.** Die Sperre stoppt sie nicht (R4.1), also gibt es keinen Grund, sie aufzuhalten. Für SSH-Weiterleitungen gilt dieselbe Regel.

**R4.4 Ein Fehler ist ein Zustand, kein Abbruch.**
- Jeder Verbindungsfehler wird als letzter Fehler am Eintrag gespeichert und in der Leiste gezeigt. Die nächste erfolgreiche Verbindung löscht ihn.
- Der Listener bleibt offen.
- Fehler schon beim Start kommen als Rückweisung von `kubeForwardStart` in den Dialog: Port belegt, Grenze erreicht, nicht verbunden, deaktiviert.

| Fall | Erkennung | Code (Parameter) |
|---|---|---|
| Den Pod gibt es nicht (mehr) | Handshake 404 | `kubernetes.portForwardPodGone` (`name`) |
| Pod läuft nicht (z. B. Pending) | Handshake 400 | `kubernetes.portForwardNotRunning` (`name`) |
| RBAC-Recht fehlt | Handshake 403 | `kubernetes.portForwardForbidden` (`namespace`) |
| Im Pod lauscht nichts auf dem Port | Daten auf Kanal 1 | `kubernetes.portForwardRefused` (`port`) |
| Service ohne Selector | Auflösung | `kubernetes.portForwardNoSelector` (`name`) |
| Port fehlt am Service, oder benannter `targetPort` unbekannt | Auflösung | `kubernetes.portForwardNoPort` (`port`) |
| Kein bereiter Pod | Auflösung | `kubernetes.portForwardNoReadyPod` (`name`) |
| Lokaler Port belegt oder verboten | `EADDRINUSE` / `EACCES` | `ssh.forwardPortInUse` / `ssh.forwardPortDenied` (`port`) |
| Mehr als 10 Weiterleitungen | beim Start | `kubernetes.portForwardTooMany` (`max`) |
| Mehr als 32 gleichzeitige Verbindungen | bei der Annahme | `kubernetes.portForwardBusy` (`max`) |
| 401, TLS, Abbruch, Sonstiges | Handshake | über `toApiError` (`kubernetes.unauthorized` …) |
| Unbekannt | – | `kubernetes.portForwardFailed` |

Den Fehlertext des Kubelets auf Kanal 1 gibt Shellherd **nicht** weiter. Er kann Pod-IPs und interne Namen enthalten und hilft dem Nutzer nicht mehr als „Im Pod nimmt niemand Verbindungen auf Port … an.“

**R4.5 Nichts wird gespeichert.**
- Weiterleitungen stehen weder im Vault noch im Workspace-Snapshot; `snapshotOf` bleibt unverändert.
- Es gibt kein automatisches Starten.
- Grund: Das Hauptrisiko ist ein vergessener offener Port auf eine Produktionsdatenbank. Jede Weiterleitung beginnt deshalb mit einem bewussten Klick.

### 5 – Sicherheit

**R5.1 Verbinden kann sich jeder Prozess und jeder Benutzer dieses Computers. Ein Hinweis genügt, zusammen mit diesen Begrenzungen.**
- `127.0.0.1` schützt vor dem Netz, aber nicht:
  - vor anderen lokalen Konten, etwa auf einem Terminalserver;
  - vor Webseiten: Eine Seite kann per DNS-Rebinding Anfragen an `127.0.0.1:<port>` schicken und die Antworten lesen.
- Eine Anmeldung am Port ist für beliebiges TCP nicht möglich.
- Eine Prüfung des `Host`-Headers würde Dienste ohne HTTP brechen, ebenso Clients mit eigenem Host-Header.
- `kubectl port-forward` und die SSH-Weiterleitung `-L` verhalten sich genauso.
- Was das Risiko trotzdem eingrenzt:
  - Start nur per Klick (R3.1);
  - Lebensdauer an den Tab gebunden (R4.1);
  - nichts gespeichert (R4.5);
  - feste Grenzen (R5.2);
  - Chromium-Browser fragen inzwischen nach, bevor eine öffentliche Seite auf lokale Adressen zugreift.
- Der Hinweis steht im Handbuch (Abschnitt 5). Er empfiehlt, Weiterleitungen nur so lange offen zu lassen, wie man sie braucht, und auf geteilten Rechnern nicht zu sensiblen Diensten weiterzuleiten.

**R5.2 Grenzen: höchstens 10 Weiterleitungen app-weit und 32 gleichzeitige Verbindungen je Weiterleitung.**
- Jede Verbindung ist ein WebSocket durch den SSH-Tunnel und eine Anfrage am API-Server.
- Ein Browser öffnet 6 Verbindungen je Host. 32 reichen auch für Web-Oberflächen, die viel parallel laden, und für Datenbank-Pools.
- Jede weitere Verbindung wird sofort geschlossen, und der Eintrag zeigt `kubernetes.portForwardBusy`.

### 6 – Produktionsrahmen und „Nur lesen“

**R6.1 Keine Namenseingabe bei Produktion.**
- Eine Weiterleitung ändert nichts im Cluster. Die Namenseingabe ist für Aktionen da, die etwas zerstören oder umbauen.
- Der Dialog selbst ist schon die bewusste Handlung.
- Bei Produktion steht im Dialog eine zusätzliche Zeile: „Produktions-Cluster: Programme auf diesem Computer erreichen damit <Ziel>.“ So ist der Datenzugriff benannt, ohne den Ablauf zu bremsen.

**R6.2 Bei „Nur lesen“ erlaubt.**
- Das Nutzer-Ruling R-0 erlaubt Port-Forward ausdrücklich.
- Schreibschutz heißt in Shellherd: Shellherd verändert keine Objekte. Was ein Programm über die Weiterleitung tut, etwa SQL mit der eigenen Anmeldung des Zieldienstes, entscheidet dieser Dienst.
- Das Handbuch sagt das in einem Satz.
- Main prüft `readOnly` beim Start bewusst **nicht**; ein Test belegt das.
- Ist der Cluster deaktiviert (`disabled`), lehnt Main ab (`kubernetes.disabled`).

### 7 – Neue API-Aufrufe und ihre Verben

**R7.1 Vollständige Liste.** Sie erfüllt R-0: nur `get`, `list` und `create` auf `pods/portforward`; `watch` kommt nicht neu dazu.

| Aufruf | REST | RBAC-Verb | Wo |
|---|---|---|---|
| Service lesen (nur Service-Ziel) | `GET /api/v1/namespaces/{ns}/services/{name}` | `get` services | `resolveHop` über `api.read` |
| Pods des Selectors (nur Service-Ziel) | `GET /api/v1/namespaces/{ns}/pods?labelSelector=…` | `list` pods | `resolveHop` über `api.list` |
| Port-Forward-Stream | `GET` mit WebSocket-Upgrade auf `/api/v1/namespaces/{ns}/pods/{pod}/portforward?ports=N` | `create` auf `pods/portforward` | `api.portForward` |

- Verb beim WebSocket-Upgrade:
  - Neuere API-Server verlangen `create` (Feature-Gate `AuthorizePodWebsocketUpgradeCreatePermission`).
  - Ältere prüften beim WebSocket-GET `get` auf der Subressource.
  - Die Standardrolle `edit` hat beides, `view` keins von beiden. So steht es auch im Handbuch.
- Nicht dabei sind `patch`, `delete`, `create` auf Objekte und `exec`. `mergePatch`, `remove` und `createJobFrom` bleiben unberührt.
- Der Prüfer kontrolliert das mit `grep -n "portForward\|resolveHop" src/main/kubernetes/*.ts`: Neu sein dürfen nur die drei Wege oben.

### 8 – Testbarkeit

**R8.1 Der run-app-Fake beantwortet `pods/<name>/portforward` wie ein Kubelet**, mit `v4.channel.k8s.io` und Port-Präfix auf Kanal 0 und 1.
- Laufende Pods leiten Port 8080 auf eine synthetische Textseite weiter.
- Jeder andere Port meldet auf Kanal 1 „connection refused“.
- Pending-Pods ergeben 400, unbekannte Pods 404, ein falsches Token 401.
- Nur synthetische Daten, nur `127.0.0.1`.

**R8.2 Der Ende-zu-Ende-Beleg ist der Test in `fakes.test.mjs`.**
- Er nutzt den echten `KubeForwards`, `createKubeApi` und den SSH-Tunnel und ruft `fetch` über den lokalen Port.
- Er läuft in vitest, wie die Nachbartests nur unter Windows.
- Die run-app-Szene wiederholt das in der echten App, mit Screenshots.

**R8.3 `KubeForwards` bekommt die API injiziert.** Die Unit-Tests nutzen echte Sockets auf `127.0.0.1:0` und einen Echo-`portForward`, ganz ohne Cluster.

### Allgemein
- **R9** Kein neues CSS bis auf einen Selektor: `.kube-field select` erbt die Textfarbe wie `.kube-field input`. Keine neuen Tokens, keine Bewegung.
- **R10** Alle Texte über `t()`, neue Keys in de-DE und en-US. Ports nie über `formatNumber`.
- **R11** Version 0.27.0.

---

## 3. Vertrag (wörtlich)

### 3.1 `src/shared/kubernetes.ts` (Task A)

Direkt vor `export interface KubeRow`:
```ts
/** A TCP port of a pod container or a service, with its name when the manifest names it. */
export interface KubePort { port: number; name?: string }
```
In `KubeRow` nach dem Feld `involved`:
```ts
  /** Pods: TCP ports of all containers; services: TCP service ports. Absent when there are none. */
  ports?: KubePort[];
```
In `KubeEvent` als letzte Variante (das abschließende `;` wandert von der `trouble`-Zeile hierher):
```ts
  /** The port forwards of the view, complete; sent on every change. */
  | { type: 'forwards'; viewId: string; forwards: KubeForwardStatus[] };
```
Nach `KubeProbeResult`:
```ts
/** Port-forward target: a pod port, or a service port that main resolves to a ready pod. */
export interface KubeForwardTarget { kind: 'pods' | 'services'; namespace: string; name: string; port: number }
/** localPort 0 = any free port; the listener is always 127.0.0.1. */
export interface KubeForwardStartRequest { viewId: string; target: KubeForwardTarget; localPort: number }
export interface KubeForwardStopRequest { viewId: string; forwardId: string }
/** One running port forward of a cluster view, as main reports it. */
export interface KubeForwardStatus {
  id: string;
  target: KubeForwardTarget;
  /** The port on 127.0.0.1. */
  localPort: number;
  /** Pod and port the last opened connection reached; for services where they resolved to. */
  pod?: string;
  podPort?: number;
  /** Connections open right now, including those still opening. */
  open: number;
  /** Why the last connection failed; cleared by the next one that opens. */
  error?: CodedError;
}
```

### 3.2 `src/shared/kubernetes-schema.ts` (Task A)
Import um `KubeForwardTarget` erweitern (`import type { DockMode, KubeForwardTarget, KubeQuery, … }`). Nach `KubeProbeRequestSchema`:
```ts
const portNumber = z.number().int().min(1).max(65_535);
export const KubeForwardTargetSchema: z.ZodType<KubeForwardTarget> = z.object({
  kind: z.enum(['pods', 'services']), namespace: KubeNameSchema, name: KubeNameSchema, port: portNumber,
}).strict();
export const KubeForwardStartRequestSchema = z.object({ viewId, target: KubeForwardTargetSchema, localPort: z.number().int().min(0).max(65_535) }).strict();
export const KubeForwardStopRequestSchema = z.object({ viewId, forwardId: z.string().uuid() }).strict();
```

### 3.3 `src/shared/ipc.ts` und `src/preload/index.ts` (Task A)
- In `IPC_CHANNELS` nach `kubeProbe`:
  ```ts
    kubeForwardStart: 'k8s:forward-start',
    kubeForwardStop: 'k8s:forward-stop',
  ```
- Im Import aus `./kubernetes` zusätzlich `KubeForwardStartRequest, KubeForwardStatus, KubeForwardStopRequest`.
- In `DesktopApi` nach `kubeProbe`:
  ```ts
    /** Listens on 127.0.0.1 only and forwards to a pod or service port of the view's cluster; resolves with the running forward. */
    kubeForwardStart: (request: KubeForwardStartRequest) => Promise<KubeForwardStatus>;
    kubeForwardStop: (request: KubeForwardStopRequest) => Promise<void>;
  ```
- In `src/preload/index.ts` nach `kubeProbe`:
  ```ts
    kubeForwardStart: request => ipcRenderer.invoke('k8s:forward-start', request),
    kubeForwardStop: request => ipcRenderer.invoke('k8s:forward-stop', request),
  ```

### 3.4 Fehlertexte (Task A), `src/shared/locales/{de-DE,en-US}/errors/kubernetes.json`, Block `kubernetes`, nach `containerConnectionFailed`

| Key | de-DE | en-US |
|---|---|---|
| `portForwardForbidden` | Keine Berechtigung für Port-Weiterleitungen in {{namespace}} (pods/portforward, create). | No permission for port forwards in {{namespace}} (pods/portforward, create). |
| `portForwardPodGone` | Den Pod {{name}} gibt es nicht (mehr). | Pod {{name}} does not exist (any more). |
| `portForwardNotRunning` | Der Pod {{name}} läuft nicht. | Pod {{name}} is not running. |
| `portForwardRefused` | Im Pod nimmt niemand Verbindungen auf Port {{port}} an. | Nothing in the pod accepts connections on port {{port}}. |
| `portForwardNoSelector` | Der Service {{name}} hat keinen Selector, z. B. ExternalName. | Service {{name}} has no selector, e.g. ExternalName. |
| `portForwardNoPort` | Port {{port}} gibt es an diesem Service oder Pod nicht. | Port {{port}} does not exist on this service or pod. |
| `portForwardNoReadyPod` | Der Service {{name}} hat keinen bereiten Pod. | Service {{name}} has no ready pod. |
| `portForwardTooMany` | Höchstens {{max}} Port-Weiterleitungen gleichzeitig. | At most {{max}} port forwards at a time. |
| `portForwardBusy` | Mehr als {{max}} gleichzeitige Verbindungen, weitere werden abgewiesen. | More than {{max}} simultaneous connections; further ones are refused. |
| `portForwardFailed` | Die Port-Weiterleitung ist fehlgeschlagen. | The port forward failed. |

### 3.5 `src/main/kubernetes/api.ts` und `client-api.ts` (Task B)

**`api.ts`:** oben `import type { Duplex } from 'node:stream';`. In `KubeApi` nach `openTerminal`:
```ts
  /**
   * Opens one port-forward stream (WebSocket) to a pod port and pipes `socket` through it both ways; resolves once it is open.
   * The caller pauses `socket`; this resumes it. A port the pod refuses later destroys `socket` with a KubeApiError
   * (kubernetes.portForwardRefused). Handshake failures reject with a mapped KubeApiError.
   */
  portForward(namespace: string, pod: string, port: number, socket: Duplex): Promise<void>;
```

**`client-api.ts`:**
- Import erweitern: `import { Exec, KubernetesObjectApi, Metrics, PatchStrategy, PortForward, Watch } from '@kubernetes/client-node';`
- Dazu `import type { Duplex } from 'node:stream';`. Hinweis: `PassThrough` und `Writable` sind schon importiert.
- Nach `forbiddenError`:
```ts
/** Handshake failures of a port-forward WebSocket; ws reports only "Unexpected server response: <status>", without the body. */
export function portForwardError(error: unknown, namespace: string, pod: string): KubeApiError {
  const e = asRecord(error);
  const message = [e.message, asRecord(e.error).message].find((text): text is string => typeof text === 'string') ?? '';
  const status = Number(/Unexpected server response: (\d{3})/.exec(message)?.[1]);
  if (status === 403) return new KubeApiError('Forbidden: pods/portforward', 403, { code: 'kubernetes.portForwardForbidden', params: { namespace } });
  if (status === 404) return new KubeApiError('Pod not found', 404, { code: 'kubernetes.portForwardPodGone', params: { name: pod } });
  if (status === 400) return new KubeApiError('Pod is not running', 400, { code: 'kubernetes.portForwardNotRunning', params: { name: pod } });
  return toApiError(Number.isFinite(status) ? { code: status } : error);
}

/** Port forward over the API server (WebSocket, v4.channel.k8s.io): one stream per local connection. */
async function openPortForward(config: KubeConfig, namespace: string, pod: string, port: number, socket: Duplex): Promise<void> {
  // Channel 1 carries the kubelet's error text (e.g. nothing listens on the port); the text itself is not passed on.
  const errors = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      if (chunk.length > 0) socket.destroy(new KubeApiError('The pod refused the port', undefined, { code: 'kubernetes.portForwardRefused', params: { port } }));
      callback();
    },
  });
  let opened: Awaited<ReturnType<PortForward['portForward']>>;
  try {
    // shortcut: client-node sends and writes without back-pressure; a huge download buffers in main. Upgrade with a bounded stream if M8 shows it.
    opened = await new PortForward(config).portForward(namespace, pod, [port], socket, errors, socket);
  } catch (error) {
    throw portForwardError(error, namespace, pod);
  }
  const ws = typeof opened === 'function' ? opened() : opened;
  if (!ws) { socket.destroy(); return; }
  ws.on('close', () => socket.destroy());
  ws.on('error', () => socket.destroy());
  socket.once('close', () => ws.close());
  if (socket.destroyed) { ws.close(); return; }
  socket.resume();
}
```
- In `createKubeApi` nach `openTerminal`:
```ts
    portForward(namespace, pod, port, socket) {
      return openPortForward(config, namespace, pod, port, socket);
    },
```
- In `overview.test.ts` und `watch.test.ts` bekommt `FakeApi` jeweils:
```ts
  async portForward(): Promise<void> {
    throw new Error('not used');
  }
```

### 3.6 `src/main/kubernetes/forwards.ts` (neu, Task D)
```ts
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import type { Server, Socket } from 'node:net';
import { AppError } from '../../shared/errors';
import type { CodedError } from '../../shared/errors';
import type { KubeForwardStatus, KubeForwardTarget } from '../../shared/kubernetes';
import { KubeApiError } from './api';
import type { KubeApi, KubeObject } from './api';

/** App-wide cap on running forwards, and per forward on connections open at once. */
export const MAX_KUBE_FORWARDS = 10;
export const MAX_FORWARD_CONNECTIONS = 32;

type Dict = Record<string, unknown>;
const rec = (value: unknown): Dict => (value && typeof value === 'object' && !Array.isArray(value) ? value as Dict : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** Where one connection goes. */
export interface ForwardHop { pod: string; port: number }

/** The view a forward belongs to; `api` waits through a reconnect (Session.waitReady). */
export interface ForwardView { ownerId: number; viewId: string; api: () => Promise<KubeApi> }

interface Entry {
  ownerId: number;
  viewId: string;
  api: () => Promise<KubeApi>;
  server: Server;
  sockets: Set<Socket>;
  status: KubeForwardStatus;
  /** Services: the hop that opened last; dropped when a connection through it fails to open. */
  hop?: ForwardHop;
  closed: boolean;
}

/** A pod that serves traffic: Running, condition Ready=True, not being deleted. */
export function podReady(pod: KubeObject): boolean {
  const status = rec(pod.status);
  if (status.phase !== 'Running' || rec(pod.metadata).deletionTimestamp) return false;
  return list(status.conditions).some(condition => rec(condition).type === 'Ready' && rec(condition).status === 'True');
}

/** Container port for a service targetPort: a number as is, a name looked up in the ports of all containers. */
export function containerPort(pod: KubeObject, targetPort: unknown): number | undefined {
  if (typeof targetPort === 'number') return targetPort;
  if (typeof targetPort !== 'string') return undefined;
  if (/^\d+$/.test(targetPort)) return Number(targetPort);
  for (const container of list(rec(pod.spec).containers)) {
    const match = list(rec(container).ports).map(rec).find(port => port.name === targetPort);
    if (match && typeof match.containerPort === 'number') return match.containerPort;
  }
  return undefined;
}

/** Pod and port for a target. Services: the first ready pod of the selector by name, on the service port's targetPort. */
export async function resolveHop(api: KubeApi, target: KubeForwardTarget): Promise<ForwardHop> {
  if (target.kind === 'pods') return { pod: target.name, port: target.port };
  const service = await api.read({ kind: 'services', namespace: target.namespace, name: target.name });
  const spec = rec(service.spec);
  const selector = Object.fromEntries(Object.entries(rec(spec.selector)).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  if (Object.keys(selector).length === 0) throw new AppError('kubernetes.portForwardNoSelector', { name: target.name });
  const servicePort = list(spec.ports).map(rec).find(port => port.port === target.port && (port.protocol ?? 'TCP') === 'TCP');
  if (!servicePort) throw new AppError('kubernetes.portForwardNoPort', { port: target.port });
  const ready = (await api.list('pods', target.namespace, { labels: selector })).items
    .filter(podReady)
    .sort((a, b) => ((a.metadata?.name ?? '') < (b.metadata?.name ?? '') ? -1 : 1));
  const pod = ready[0];
  const name = pod?.metadata?.name;
  if (!pod || !name) throw new AppError('kubernetes.portForwardNoReadyPod', { name: target.name });
  const port = containerPort(pod, servicePort.targetPort ?? servicePort.port);
  if (port === undefined) throw new AppError('kubernetes.portForwardNoPort', { port: target.port });
  return { pod: name, port };
}

function codedOf(error: unknown): CodedError {
  if (error instanceof AppError) return error.toCoded();
  if (error instanceof KubeApiError) return error.coded;
  return { code: 'kubernetes.portForwardFailed' };
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') reject(new AppError('ssh.forwardPortInUse', { port }));
      else if (error.code === 'EACCES') reject(new AppError('ssh.forwardPortDenied', { port }));
      else reject(new AppError('kubernetes.portForwardFailed'));
    });
    // Loopback only, never 0.0.0.0: the forward carries the user's cluster rights, on all interfaces the network would share them.
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address !== 'string') resolve(address.port);
      else { server.close(); reject(new AppError('kubernetes.portForwardFailed')); }
    });
  });
}

/** Port forwards of all cluster views: one listener on 127.0.0.1 each, one WebSocket per accepted connection. */
export class KubeForwards {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly emit: (ownerId: number, viewId: string, forwards: KubeForwardStatus[]) => void) {}

  async start(view: ForwardView, target: KubeForwardTarget, localPort: number): Promise<KubeForwardStatus> {
    if (this.entries.size >= MAX_KUBE_FORWARDS) throw new AppError('kubernetes.portForwardTooMany', { max: MAX_KUBE_FORWARDS });
    let entry: Entry | undefined;
    const server = createServer(socket => { if (entry) this.accept(entry, socket); else socket.destroy(); });
    const port = await listen(server, localPort);
    const created: Entry = {
      ownerId: view.ownerId, viewId: view.viewId, api: view.api, server, sockets: new Set(), closed: false,
      status: { id: randomUUID(), target, localPort: port, open: 0 },
    };
    entry = created;
    this.entries.set(created.status.id, created);
    // A listener that breaks later ends its forward instead of leaving a dead entry behind.
    server.on('error', () => this.stop(created.viewId, created.status.id));
    this.changed(created);
    return this.snapshot(created);
  }

  stop(viewId: string, id: string): void {
    const entry = this.entries.get(id);
    if (!entry || entry.viewId !== viewId) return;
    this.close(entry);
    this.emit(entry.ownerId, viewId, this.list(viewId));
  }

  /** The view is gone; no event, its renderer no longer listens. */
  stopView(viewId: string): void {
    for (const entry of [...this.entries.values()]) if (entry.viewId === viewId) this.close(entry);
  }

  stopAll(): void {
    for (const entry of [...this.entries.values()]) this.close(entry);
  }

  list(viewId: string): KubeForwardStatus[] {
    return [...this.entries.values()].filter(entry => entry.viewId === viewId).map(entry => this.snapshot(entry));
  }

  private snapshot(entry: Entry): KubeForwardStatus {
    return { ...entry.status, open: entry.sockets.size };
  }

  private close(entry: Entry): void {
    entry.closed = true;
    this.entries.delete(entry.status.id);
    entry.server.close();
    for (const socket of entry.sockets) socket.destroy();
    entry.sockets.clear();
  }

  private changed(entry: Entry): void {
    if (!entry.closed) this.emit(entry.ownerId, entry.viewId, this.list(entry.viewId));
  }

  private fail(entry: Entry, error: CodedError): void {
    entry.status = { ...entry.status, error };
    this.changed(entry);
  }

  private accept(entry: Entry, socket: Socket): void {
    socket.on('error', error => { if (error instanceof KubeApiError) this.fail(entry, error.coded); });
    if (entry.closed) { socket.destroy(); return; }
    if (entry.sockets.size >= MAX_FORWARD_CONNECTIONS) {
      socket.destroy();
      this.fail(entry, { code: 'kubernetes.portForwardBusy', params: { max: MAX_FORWARD_CONNECTIONS } });
      return;
    }
    socket.pause(); // nothing the client sends may be lost before the stream to the pod is open
    entry.sockets.add(socket);
    socket.once('close', () => { entry.sockets.delete(socket); this.changed(entry); });
    this.changed(entry);
    void this.relay(entry, socket);
  }

  private async relay(entry: Entry, socket: Socket): Promise<void> {
    const { target } = entry.status;
    try {
      const api = await entry.api();
      for (let attempt = 0; ; attempt++) {
        const hop = entry.hop ?? await resolveHop(api, target);
        if (socket.destroyed || entry.closed) { socket.destroy(); return; }
        try {
          await api.portForward(target.namespace, hop.pod, hop.port, socket);
        } catch (error) {
          entry.hop = undefined;
          // A service gets one fresh lookup: its pod may have been replaced since the last connection.
          if (target.kind === 'services' && attempt === 0 && !socket.destroyed) continue;
          throw error;
        }
        if (target.kind === 'services') entry.hop = hop;
        const next: KubeForwardStatus = { ...entry.status, pod: hop.pod, podPort: hop.port };
        delete next.error;
        entry.status = next;
        this.changed(entry);
        return;
      }
    } catch (error) {
      socket.destroy();
      this.fail(entry, codedOf(error));
    }
  }
}
```

### 3.7 `src/main/kubernetes/session.ts` (Task H)
- Imports:
  - `import { KubeForwards } from './forwards';`
  - im Typ-Import aus `../../shared/kubernetes` zusätzlich `KubeForwardStatus, KubeForwardTarget`.
- `KubeSessions`:
```ts
  private readonly forwards: KubeForwards;
```
  im Konstruktor nach `this.options = {…};`:
```ts
    this.forwards = new KubeForwards((ownerId, viewId, forwards) => deps.emit(ownerId, { type: 'forwards', viewId, forwards }));
```
- Nach `action(…)`:
```ts
  /** Port forward of a view to a pod or service port. Reading access: allowed on read-only clusters, refused on disabled ones. */
  async startForward(ownerId: number, viewId: string, target: KubeForwardTarget, localPort: number): Promise<KubeForwardStatus> {
    const view = this.viewOf(ownerId, viewId);
    // Read at each call; reading the vault also refuses while it is locked.
    if (this.deps.getCluster(view.session.clusterId).disabled) throw new AppError(DISABLED);
    view.session.requireApi();
    return this.forwards.start({ ownerId, viewId, api: () => view.session.waitReady() }, target, localPort);
  }

  stopForward(ownerId: number, viewId: string, forwardId: string): void {
    this.viewOf(ownerId, viewId);
    this.forwards.stop(viewId, forwardId);
  }
```
- In `close(…)` zwischen `this.views.delete(viewId);` und `view.session.detach(view);`:
```ts
    this.forwards.stopView(viewId);
```
- In `closeAll()` als erste Zeile: `this.forwards.stopAll();`
- `session.test.ts`: `FakeApi` bekommt (Import `import type { Duplex } from 'node:stream';`):
```ts
  forwards: { namespace: string; pod: string; port: number }[] = [];

  async portForward(namespace: string, pod: string, port: number, socket: Duplex): Promise<void> {
    this.forwards.push({ namespace, pod, port });
    socket.on('data', chunk => socket.write(chunk));
    socket.resume();
  }
```

### 3.8 `src/main/kubernetes/ipc.ts` (Task H)
Import aus `../../shared/kubernetes-schema` um `KubeForwardStartRequestSchema, KubeForwardStopRequestSchema` erweitern. Nach dem Handler `kubeClose`:
```ts
  handle(IPC_CHANNELS.kubeForwardStart, (event, request) => {
    const ownerId = requireSshSender(event);
    const parsed = parseRequest(KubeForwardStartRequestSchema, request);
    return sessions.startForward(ownerId, parsed.viewId, parsed.target, parsed.localPort);
  });
  handle(IPC_CHANNELS.kubeForwardStop, (event, request) => {
    const ownerId = requireSshSender(event);
    const parsed = parseRequest(KubeForwardStopRequestSchema, request);
    sessions.stopForward(ownerId, parsed.viewId, parsed.forwardId);
  });
```

### 3.9 `src/main/kubernetes/rows.ts` (Task C)
Import `KubePort` aus `../../shared/kubernetes`. Nach den Helfern (`count`, `:12`):
```ts
/** TCP ports with their names, each port once: container ports of a pod, service ports of a service. */
function tcpPorts(entries: unknown[], key: 'containerPort' | 'port'): KubePort[] | undefined {
  const ports = entries.map(rec).flatMap((entry): KubePort[] => {
    const port = count(entry[key]);
    if (port === undefined || (text(entry.protocol) ?? 'TCP') !== 'TCP') return [];
    const name = text(entry.name);
    return [name ? { port, name } : { port }];
  });
  const unique = ports.filter((entry, index) => ports.findIndex(other => other.port === entry.port) === index);
  return unique.length > 0 ? unique : undefined;
}
```
- Im Fall `pods` nach `if (podIp) row.ip = podIp;`:
  ```ts
        const podPorts = tcpPorts(list(spec.containers).flatMap(container => list(rec(container).ports)), 'containerPort');
        if (podPorts) row.ports = podPorts;
  ```
- Im Fall `services` nach `row.selector = labelMap(spec.selector);`:
  ```ts
        const servicePorts = tcpPorts(list(spec.ports), 'port');
        if (servicePorts) row.ports = servicePorts;
  ```

### 3.10 Renderer-Zustand (Task E)

**`src/renderer/src/kube-view.ts`:**
- `KubeForwardStatus` in den Typ-Import aus `../../shared/kubernetes` aufnehmen.
- In `KubeViewState` nach `updatedAt`:
  ```ts
    /** Port forwards of this view, as main reports them; never saved. */
    forwards: KubeForwardStatus[];
  ```
- In `initialKubeView` am Ende des Objekts `forwards: []` ergänzen.
- In `applyEvent` als letzten Fall:
  ```ts
      case 'forwards': return { ...state, forwards: event.forwards };
  ```
- `snapshotOf` bleibt unverändert.

**`src/renderer/src/hooks/useClusterSession.ts`:**
- Typ-Import um `KubeForwardStatus, KubeForwardTarget` erweitern.
- Im `.then` von `kubeOpen` nach dem `overview`-Dispatch:
  ```ts
      // A reopened view starts without forwards; main stopped those of the old view without an event.
      dispatch({ type: 'event', event: { type: 'forwards', viewId: id, forwards: [] }, at: Date.now() });
  ```
- Nach `action`:
  ```ts
    const startForward = useCallback((target: KubeForwardTarget, localPort: number): Promise<KubeForwardStatus> => {
      const id = viewIdRef.current;
      if (!id) return Promise.reject(new Error(t('kubernetes:viewNotOpen')));
      return window.desktopApi.kubeForwardStart({ viewId: id, target, localPort });
    }, []);

    const stopForward = useCallback((forwardId: string): Promise<void> => {
      const id = viewIdRef.current;
      if (!id) return Promise.resolve();
      return window.desktopApi.kubeForwardStop({ viewId: id, forwardId });
    }, []);
  ```
- Die Rückgabe lautet `return { state, dispatch: …, viewId, retry, detail, action, startForward, stopForward };`.

### 3.11 Menüs (Task I1)

**`src/renderer/src/kube-menus.ts`:**
- In `MenuAction` nach `kubeAction`:
  ```ts
    | { type: 'forward'; row: KubeRow }
  ```
- Nach `popoutItems`:
```ts
/** "Port weiterleiten…": running pods; services with a selector and a TCP port. Read-only clusters allow it (it changes nothing). */
function forwardItem(env: Env, row: KubeRow): MenuEntry {
  const reason = connectedReason(env) ?? (row.ref.kind === 'pods'
    ? (row.cells.status === 'Running' ? undefined : t('kubeActions:reasons.notRunning'))
    : !hasSelector(row) ? t('kubeActions:reasons.noSelectorService')
      : (row.ports?.length ?? 0) === 0 ? t('kubeActions:reasons.noTcpPort') : undefined);
  return item(env, 'forward', t('kubeActions:menu.forward'), { type: 'forward', row }, { reason });
}
```
- `podRowGroups`: Die zweite Gruppe wird zu `[...terminalItems(env, row, first, prefix, extra), ...viewItems(env, [select(row)]), ...popoutItems(env, row, first, extra), forwardItem(env, row)]`.
- `serviceGroups`: Die erste Gruppe wird zu `[item(env, 'drill', …unverändert…), forwardItem(env, row)]`.

**`src/renderer/src/kube-menu-run.ts`:**
- `KubeRow` ist dort schon importiert.
- In `MenuRunner` nach `confirm`:
  ```ts
    /** Opens the port-forward dialog for a pod or service row. */
    forward(row: KubeRow): void;
  ```
- In `runMenuAction` nach `kubeAction`:
  ```ts
      case 'forward': runner.forward(action.row); return;
  ```

**Texte `src/shared/locales/{de-DE,en-US}/kubeActions.json`:**

| Key | de-DE | en-US |
|---|---|---|
| `menu.forward` (nach `popoutShell`) | Port weiterleiten… | Forward port… |
| `reasons.noTcpPort` (nach `noSelectorService`) | Dieser Service hat keinen TCP-Port. | This service has no TCP port. |

### 3.12 `src/renderer/src/kube-forward.ts` (neu, Task I2)
```ts
import type { KubeForwardStatus, KubeForwardTarget, KubePort, KubeRow } from '../../shared/kubernetes';

/** Port typed in a form field: 1..65535. Empty is 0 (any free port) where allowed; anything else invalid is NaN. */
export function parsePort(text: string, emptyIsAny: boolean): number {
  const trimmed = text.trim();
  if (trimmed === '') return emptyIsAny ? 0 : NaN;
  if (!/^\d{1,5}$/.test(trimmed)) return NaN;
  const port = Number(trimmed);
  return port >= 1 && port <= 65_535 ? port : NaN;
}

/** Target as kubectl writes it: `pod:port` or `svc/name:port`. */
export function targetText(target: KubeForwardTarget): string {
  return target.kind === 'services' ? `svc/${target.name}:${target.port}` : `${target.name}:${target.port}`;
}

export const forwardAddress = (status: KubeForwardStatus): string => `127.0.0.1:${status.localPort}`;

// shortcut: only the usual TLS ports open as https; a port named "https" elsewhere opens as http. Upgrade with the port name if users ask.
export const forwardUrl = (status: KubeForwardStatus): string =>
  `${status.target.port === 443 || status.target.port === 8443 ? 'https' : 'http'}://${forwardAddress(status)}/`;

/** Target a pod or service row offers; null for other kinds and rows without a namespace. */
export function forwardTargetOf(row: KubeRow, port: number): KubeForwardTarget | null {
  const namespace = row.ref.namespace;
  if (!namespace || (row.ref.kind !== 'pods' && row.ref.kind !== 'services')) return null;
  return { kind: row.ref.kind, namespace, name: row.ref.name, port };
}

/** Option text of a port: "8080 (http)" or "8080". */
export const portLabel = (port: KubePort): string => (port.name ? `${port.port} (${port.name})` : String(port.port));
```

### 3.13 `src/renderer/src/components/kubernetes/KubeForwardDialog.tsx` (neu, Task I2)
```tsx
import { useEffect, useId, useRef, useState } from 'react';
import type { KubeForwardStatus, KubeForwardTarget, KubeRow } from '../../../../shared/kubernetes';
import { errorText } from '../../error-text';
import { useNativeSurfaceBlock } from '../../native-surface';
import { useT } from '../../i18n';
import { forwardTargetOf, parsePort, portLabel, targetText } from '../../kube-forward';
import { BusyButton } from '../BusyButton';

interface KubeForwardDialogProps {
  row: KubeRow;
  production: boolean;
  start: (target: KubeForwardTarget, localPort: number) => Promise<KubeForwardStatus>;
  onStarted: (status: KubeForwardStatus) => void;
  onClose: () => void;
}

const OTHER = 'other';

/** Picks the pod or service port and the local port; the forward runs in main and shows up in the bar. */
export function KubeForwardDialog({ row, production, start, onStarted, onClose }: KubeForwardDialogProps) {
  const { t } = useT();
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const ports = row.ports ?? [];
  const isService = row.ref.kind === 'services';
  const first = ports[0] ? String(ports[0].port) : '';
  const [choice, setChoice] = useState(first || OTHER);
  const [otherText, setOtherText] = useState('');
  const [localText, setLocalText] = useState(first);
  const [localEdited, setLocalEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useNativeSurfaceBlock(true);

  const remote = choice === OTHER ? parsePort(otherText, false) : Number(choice);
  const local = parsePort(localText, true);
  const target = Number.isNaN(remote) ? null : forwardTargetOf(row, remote);
  const canStart = target !== null && !Number.isNaN(local) && !busy;

  useEffect(() => {
    dialogRef.current?.showModal();
    dialogRef.current?.querySelector<HTMLElement>('select, input')?.focus();
  }, []);

  // The local port follows the chosen remote port until the user types one.
  const follow = (text: string) => { if (!localEdited) setLocalText(text); };

  const submit = async () => {
    if (!canStart || !target) return;
    setBusy(true);
    setError(null);
    try {
      onStarted(await start(target, local));
      onClose();
    } catch (caught) {
      setError(errorText(caught));
      setBusy(false);
    }
  };

  return (
    <dialog ref={dialogRef} className="confirm-dialog compact-confirm kube-confirm kube-forward" aria-labelledby={`${id}-title`} aria-describedby={`${id}-body`}
      onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'Enter' && event.target instanceof HTMLInputElement && canStart) { event.preventDefault(); void submit(); }
      }}>
      <h2 id={`${id}-title`}>{t('kubernetes:forward.title')}</h2>
      <p id={`${id}-body`}>{t(isService ? 'kubernetes:forward.service' : 'kubernetes:forward.pod', { name: row.ref.name, namespace: row.ref.namespace ?? '' })}</p>
      {ports.length > 0 && (
        <label className="kube-field">
          <span>{t(isService ? 'kubernetes:forward.servicePort' : 'kubernetes:forward.podPort')}</span>
          <select name="port" value={choice} disabled={busy}
            onChange={event => { setChoice(event.target.value); follow(event.target.value === OTHER ? otherText : event.target.value); }}>
            {ports.map(port => <option key={port.port} value={String(port.port)}>{portLabel(port)}</option>)}
            {!isService && <option value={OTHER}>{t('kubernetes:forward.otherPort')}</option>}
          </select>
        </label>
      )}
      {choice === OTHER && (
        <label className="kube-field">
          <span>{ports.length > 0 ? t('kubernetes:forward.portNumber') : t('kubernetes:forward.podPort')}</span>
          <input name="remote" type="number" inputMode="numeric" min={1} max={65535} step={1} value={otherText} disabled={busy}
            aria-invalid={otherText !== '' && Number.isNaN(remote)}
            onChange={event => { setOtherText(event.target.value); follow(event.target.value); }} />
        </label>
      )}
      <label className="kube-field">
        <span>{t('kubernetes:forward.localPort')}</span>
        <input name="local" type="number" inputMode="numeric" min={0} max={65535} step={1} value={localText} disabled={busy}
          aria-invalid={Number.isNaN(local)} aria-describedby={`${id}-local`}
          onChange={event => { setLocalEdited(true); setLocalText(event.target.value); }} />
      </label>
      <p id={`${id}-local`} className="field-hint">{t('kubernetes:forward.localHint')}</p>
      {isService && <p className="field-hint">{t('kubernetes:forward.serviceHint')}</p>}
      {production && target && <p className="field-hint">{t('kubernetes:forward.production', { target: targetText(target) })}</p>}
      {error && <p className="error-message" role="alert">{error}</p>}
      <div className="form-actions">
        <button className="secondary-button" type="button" disabled={busy} onClick={onClose}>{t('common:actions.cancel')}</button>
        <BusyButton className="primary-button" type="button" busy={busy} disabled={!canStart} idleLabel={t('kubernetes:forward.start')} onClick={() => void submit()} />
      </div>
    </dialog>
  );
}
```

### 3.14 `src/renderer/src/components/kubernetes/KubeForwardBar.tsx` (neu, Task I2)
```tsx
import type { KubeForwardStatus } from '../../../../shared/kubernetes';
import { errorText } from '../../error-text';
import { useT } from '../../i18n';
import { targetText } from '../../kube-forward';
import '../../forward-ui.css';

interface KubeForwardBarProps {
  forwards: KubeForwardStatus[];
  onOpen: (forward: KubeForwardStatus) => void;
  onCopy: (forward: KubeForwardStatus) => void;
  onStop: (forward: KubeForwardStatus) => void;
}

/** Bar at the bottom of the cluster view with the port forwards of this view; looks like the terminal's bar. */
export function KubeForwardBar({ forwards, onOpen, onCopy, onStop }: KubeForwardBarProps) {
  const { t } = useT();
  const text = (forward: KubeForwardStatus): string => t('kubernetes:forwards.item', { port: forward.localPort, target: targetText(forward.target) });
  return (
    <div className="forward-bar" role="group" aria-label={t('terminal:forwards.label')}>
      <span className="forward-bar-label">{t('terminal:forwards.label')}</span>
      <ul className="forward-list">
        {forwards.map(forward => (
          <li key={forward.id} className="forward-item">
            <span className="forward-text">{text(forward)}</span>
            {forward.target.kind === 'services' && forward.pod && forward.podPort !== undefined && (
              <span className="forward-state">{t('kubernetes:forwards.via', { pod: forward.pod, port: forward.podPort })}</span>
            )}
            {forward.error
              ? <span className="forward-error">{errorText(forward.error)}</span>
              : <span className="forward-state">{t('terminal:forwards.state.active')}</span>}
            {forward.open > 0 && <span className="forward-open">{t('terminal:forwards.open', { count: forward.open })}</span>}
            <button type="button" className="forward-button" aria-label={t('kubernetes:forwards.openLabel', { forward: text(forward) })}
              onClick={() => onOpen(forward)}>{t('kubernetes:forwards.open')}</button>
            <button type="button" className="forward-button" aria-label={t('kubernetes:forwards.copyLabel', { forward: text(forward) })}
              onClick={() => onCopy(forward)}>{t('kubernetes:forwards.copy')}</button>
            <button type="button" className="forward-button" aria-label={t('terminal:forwards.stopLabel', { forward: text(forward) })}
              onClick={() => onStop(forward)}>{t('terminal:forwards.stop')}</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

### 3.15 `ClusterView.tsx` (Task I2)

1. Imports ergänzen:
   ```tsx
   import type { KubeForwardStatus, KubeRow } from '../../../../shared/kubernetes';
   import { forwardAddress, forwardUrl } from '../../kube-forward';
   import { KubeForwardBar } from './KubeForwardBar';
   import { KubeForwardDialog } from './KubeForwardDialog';
   ```
   `KubeRow` lässt sich auch in den bestehenden Import aus `shared/kubernetes` aufnehmen.
2. Hook: `const { state, dispatch, retry, detail, action, startForward, stopForward } = useClusterSession(connection.id, initialView, null);`
3. Zustand nach `pending`: `const [forwardRow, setForwardRow] = useState<KubeRow | null>(null);`
4. `modal` wird zu `const modal = help || pending !== null || menu !== null || forwardRow !== null;`
5. In `runnerFor` nach `confirm`: `forward: row => setForwardRow(row),`
6. Nach `runnerFor`:
   ```tsx
   const openForward = (forward: KubeForwardStatus) => {
     window.desktopApi.openExternal(forwardUrl(forward)).catch((caught: unknown) => say(errorText(caught)));
   };
   const copyForward = (forward: KubeForwardStatus) => {
     const address = forwardAddress(forward);
     window.desktopApi.writeClipboardText(address).then(() => say(t('kubernetes:view.copied', { text: address })), () => say(t('kubernetes:view.copyFailed')));
   };
   const stopForwardOf = (forward: KubeForwardStatus) => {
     stopForward(forward.id).catch((caught: unknown) => say(errorText(caught)));
   };
   ```
7. Direkt nach dem schließenden `</div>` von `.kube-body`:
   ```tsx
   {state.forwards.length > 0 && <KubeForwardBar forwards={state.forwards} onOpen={openForward} onCopy={copyForward} onStop={stopForwardOf} />}
   ```
8. Nach dem `ConfirmAction`-Block:
   ```tsx
   {forwardRow && (
     <KubeForwardDialog row={forwardRow} production={production} start={startForward}
       onStarted={status => say(t('kubernetes:forward.started', { address: forwardAddress(status) }))} onClose={() => setForwardRow(null)} />
   )}
   ```

**`src/renderer/src/kubernetes-ui.css` `:139`:** `.kube-field input { color: var(--color-text); }` wird zu `.kube-field input, .kube-field select { color: var(--color-text); }`.

### 3.16 Texte `src/shared/locales/{de-DE,en-US}/kubernetes.json` (Task I2), zwei neue Blöcke nach `view`

| Key | de-DE | en-US |
|---|---|---|
| `forward.title` | Port weiterleiten | Forward port |
| `forward.pod` | Pod {{name}} in {{namespace}} | Pod {{name}} in {{namespace}} |
| `forward.service` | Service {{name}} in {{namespace}} | Service {{name}} in {{namespace}} |
| `forward.podPort` | Port im Pod | Port in the pod |
| `forward.servicePort` | Port des Service | Service port |
| `forward.otherPort` | Anderer Port … | Other port… |
| `forward.portNumber` | Portnummer | Port number |
| `forward.localPort` | Lokaler Port | Local port |
| `forward.localHint` | Nur auf diesem Computer erreichbar (127.0.0.1). Leer lassen: Shellherd wählt einen freien Port. | Reachable from this computer only (127.0.0.1). Leave empty: Shellherd picks a free port. |
| `forward.serviceHint` | Jede neue Verbindung geht an einen bereiten Pod des Service. Ist er weg, nimmt Shellherd den nächsten. | Each new connection goes to a ready pod of the service. If it is gone, Shellherd takes the next one. |
| `forward.production` | Produktions-Cluster: Programme auf diesem Computer erreichen damit {{target}}. | Production cluster: programs on this computer can reach {{target}} through it. |
| `forward.start` | Weiterleiten | Forward |
| `forward.started` | Weiterleitung aktiv: {{address}} | Port forward active: {{address}} |
| `forwards.item` | 127.0.0.1:{{port}} → {{target}} | 127.0.0.1:{{port}} → {{target}} |
| `forwards.via` | über {{pod}}:{{port}} | via {{pod}}:{{port}} |
| `forwards.open` | Im Browser öffnen | Open in browser |
| `forwards.openLabel` | {{forward}} im Browser öffnen | Open {{forward}} in browser |
| `forwards.copy` | Adresse kopieren | Copy address |
| `forwards.copyLabel` | Adresse von {{forward}} kopieren | Copy address of {{forward}} |

### 3.17 run-app-Fake (Task G)

**`.claude/skills/run-app/kube-fake.mjs`:**
- Kopfkommentar Zeile 1 wird zu: `// Synthetic Kubernetes API server for the run-app skill. HTTPS on 127.0.0.1 only, read-only (writes get 403); pods/portforward over WebSocket.`
- Imports ergänzen:
  ```js
  import http from 'node:http';
  import net from 'node:net';
  // shortcut: ws comes hoisted from @kubernetes/client-node; add it as a devDependency if npm stops hoisting it.
  import { WebSocketServer } from 'ws';
  ```
- Nach `KUBE_TOKEN`:
  ```js
  // Running pods serve one synthetic text page on this port; every other port is refused like by a kubelet.
  export const POD_HTTP_PORT = 8080;
  ```
- In `startKubeFake` nach `const open = new Set();`:
```js
  const podPage = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`synthetic pod page ${req.url}\n`);
  });
  await new Promise((resolve, reject) => { podPage.once('error', reject); podPage.listen(0, '127.0.0.1', resolve); });
  // Port forward like the kubelet (v4.channel.k8s.io): channel 0 data, channel 1 errors, each opened with the port (2 bytes, little endian).
  const forwards = new WebSocketServer({ noServer: true, handleProtocols: protocols => (protocols.has('v4.channel.k8s.io') ? 'v4.channel.k8s.io' : false) });
  const portFrame = (channel, port) => Buffer.from([channel, port & 0xff, port >> 8]);
  const relay = (ws, port) => {
    ws.on('error', () => ws.terminate());
    ws.send(portFrame(0, port));
    ws.send(portFrame(1, port));
    if (port !== POD_HTTP_PORT) {
      ws.send(Buffer.concat([Buffer.from([1]), Buffer.from(`error forwarding port ${port} to pod: connect: connection refused`)]));
      ws.close();
      return;
    }
    const upstream = net.connect(podPage.address().port, '127.0.0.1');
    upstream.on('data', chunk => ws.send(Buffer.concat([Buffer.from([0]), chunk])));
    upstream.on('close', () => ws.close());
    upstream.on('error', () => ws.close());
    ws.on('message', data => {
      const frame = Buffer.from(data);
      if (frame[0] === 0 && frame.length > 1) upstream.write(frame.subarray(1));
    });
    ws.on('close', () => upstream.destroy());
  };
  const upgrade = (req, socket, head) => {
    socket.on('error', () => socket.destroy());
    const refuse = code => socket.end(`HTTP/1.1 ${code} ${http.STATUS_CODES[code]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    if (req.headers.authorization !== `Bearer ${KUBE_TOKEN}`) return refuse(401);
    const url = new URL(req.url ?? '/', 'https://k8s-cp1');
    const match = /^\/api\/v1\/namespaces\/([^/]+)\/pods\/([^/]+)\/portforward$/.exec(url.pathname);
    const pod = match && data.pods.find(item => item.metadata.namespace === match[1] && item.metadata.name === match[2]);
    if (!pod) return refuse(404);
    // A pod without a running container cannot be reached; the API server answers 400 (report-0 is Pending).
    if (pod.status.phase !== 'Running') return refuse(400);
    const port = Number(url.searchParams.get('ports'));
    if (!Number.isInteger(port) || port < 1 || port > 65535) return refuse(400);
    forwards.handleUpgrade(req, socket, head, ws => relay(ws, port));
  };
```
- Nach `server.requestTimeout = 0;`: `server.on('upgrade', upgrade);`
- In `close` vor `server.close(…)`:
  ```js
      for (const client of forwards.clients) client.terminate();
      podPage.closeAllConnections();
      podPage.close();
  ```

**`.claude/skills/run-app/kube-fixtures.mjs`:**
- Nach `const DAY = …`: `const HTTP_PORTS = [{ name: 'http', containerPort: 8080, protocol: 'TCP' }];`
- `addPod` bekommt den Parameter `ports`:
  - Signatur `({ name, namespace = 'shop', node, labels = {}, owner, image, phase = 'Running', ready = true, restarts = 0, state, age, running = true, ports })`.
  - `spec: { nodeName: node, containers: [{ name: 'main', image, ...(ports ? { ports } : {}) }] },`
  - In `status` nach `phase,`: `conditions: [{ type: 'Ready', status: phase === 'Running' && ready ? 'True' : 'False' }],`
- `deployPods` bekommt den fünften Parameter `ports` und reicht ihn an `addPod` weiter: `const deployPods = (deploy, hash, image, count, nodesToUse, ports) => …` mit `addPod({ …, ports })`.
- `deployPods('api', …, ['k8s-w1', 'k8s-w1', 'k8s-w2'], HTTP_PORTS);`. Der checkout-Pod bekommt `ports: HTTP_PORTS`.
- Services:
  ```js
      { metadata: meta('service', 'api', 'shop', 30 * DAY), spec: { type: 'ClusterIP', clusterIP: '10.96.12.40', ports: [{ name: 'http', port: 80, targetPort: 'http', protocol: 'TCP' }], selector: { app: 'api' } } },
      { metadata: meta('service', 'checkout', 'shop', 30 * DAY), spec: { type: 'ClusterIP', clusterIP: '10.96.33.7', ports: [{ port: 8080, targetPort: 8080, protocol: 'TCP' }], selector: { app: 'checkout' } } },
  ```

**`.claude/skills/run-app/fakes.test.mjs`:**
- Import `import { KubeForwards } from '../../../src/main/kubernetes/forwards';`
- Nach dem Test „serves the Kubernetes API through the SSH tunnel …“:
```js
  it.skipIf(!findOpenssl())('forwards a pod and a service port through the SSH tunnel to the pod page', async () => {
    const kube = await startKubeFake({ port: 0, dir: join(base, 'kube-forward') });
    cleanup.push(() => kube.close());
    const { host } = await connect((await start('kube-forward', { kubeconfig: kube.kubeconfig, kubePort: kube.port })).port);
    const parsed = parseKubeconfig(kube.kubeconfig);
    const tunnel = await openTunnel((h, p) => host.forward(h, p), parsed.server);
    cleanup.push(async () => tunnel.close());
    const api = createKubeApi(parsed.build(tunnel.port));
    const latest = new Map();
    const forwards = new KubeForwards((_owner, _view, list) => { for (const forward of list) latest.set(forward.id, forward); });
    cleanup.push(async () => forwards.stopAll());
    const view = { ownerId: 1, viewId: 'v', api: async () => api };
    const get = async port => (await fetch(`http://127.0.0.1:${port}/check`, { headers: { connection: 'close' } })).text();
    const until = async (id, test) => {
      for (const end = Date.now() + 5000; !test(latest.get(id)); await new Promise(resolve => setTimeout(resolve, 50))) {
        if (Date.now() > end) throw new Error(`forward ${id}: ${JSON.stringify(latest.get(id))}`);
      }
    };

    const pod = await forwards.start(view, { kind: 'pods', namespace: 'shop', name: 'api-6d8f9b7c5-x7k2p', port: 8080 }, 0);
    expect(await get(pod.localPort)).toContain('synthetic pod page /check');

    const service = await forwards.start(view, { kind: 'services', namespace: 'shop', name: 'api', port: 80 }, 0);
    expect(await get(service.localPort)).toContain('synthetic pod page /check');
    await until(service.id, forward => forward?.pod === 'api-6d8f9b7c5-h5t8w' && forward.podPort === 8080);

    const refused = await forwards.start(view, { kind: 'pods', namespace: 'shop', name: 'api-6d8f9b7c5-x7k2p', port: 9999 }, 0);
    await get(refused.localPort).catch(() => '');
    await until(refused.id, forward => forward?.error?.code === 'kubernetes.portForwardRefused');

    const pending = await forwards.start(view, { kind: 'pods', namespace: 'shop', name: 'report-0', port: 8080 }, 0);
    await get(pending.localPort).catch(() => '');
    await until(pending.id, forward => forward?.error?.code === 'kubernetes.portForwardNotRunning');

    const noReady = await forwards.start(view, { kind: 'services', namespace: 'shop', name: 'checkout', port: 8080 }, 0);
    await get(noReady.localPort).catch(() => '');
    await until(noReady.id, forward => forward?.error?.code === 'kubernetes.portForwardNoReadyPod');
  });
```
Zur erwarteten Pod-Wahl: `api-6d8f9b7c5-h5t8w` ist unter `x7k2p`, `q9m4d` und `h5t8w` der erste nach Namen (R1.2). Damit belegt der Test die deterministische Wahl.

### 3.18 Version (Task F)
- `package.json` `"version": "0.27.0"`. Dasselbe gilt für die Root-Version in `package-lock.json` (beide Stellen oben).
- `src/shared/version.test.ts` prüft Version und CHANGELOG gemeinsam, deshalb gehören beide in einen Task.

---

## 4. Zerlegung (exklusive Dateien, Wellen)

Nach **jeder** Welle müssen `npm run typecheck` und `npx vitest run` vollständig grün sein. Innerhalb einer Welle darf ein Task auf den Vertrag eines Nachbar-Tasks derselben Welle verweisen; geprüft wird erst am Wellenende. Umsetzer schreiben nur ihre eigenen Dateien und committen nie.

| Task | Dateien (exklusiv) | Inhalt | Welle | hängt ab von |
|---|---|---|---|---|
| **A** Vertrag | `src/shared/kubernetes.ts`, `src/shared/kubernetes-schema.ts`, `src/shared/kubernetes-schema.test.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/shared/locales/{de-DE,en-US}/errors/kubernetes.json` | 3.1–3.4, Tests 10.1 | 1 | – |
| **B** Client | `src/main/kubernetes/api.ts`, `client-api.ts`, `client-api.test.ts`, `overview.test.ts`, `watch.test.ts` | 3.5, Tests 10.2 | 1 | A (Codes) |
| **C** Zeilen | `src/main/kubernetes/rows.ts`, `rows.test.ts` | 3.9, Tests 10.3 | 1 | A (`KubePort`) |
| **D** Weiterleitungen | `src/main/kubernetes/forwards.ts` (neu), `forwards.test.ts` (neu) | 3.6, Tests 10.4 | 1 | A, B (`KubeApi.portForward`) |
| **H** Sessions und IPC | `src/main/kubernetes/session.ts`, `session.test.ts`, `src/main/kubernetes/ipc.ts` | 3.7, 3.8, Tests 10.5 | 1 | A, B, D |
| **E** Renderer-Zustand | `src/renderer/src/kube-view.ts`, `kube-view.test.ts`, `src/renderer/src/hooks/useClusterSession.ts` | 3.10, Tests 10.6 | 1 | A |
| **F** Doku und Version | `docs/handbuch.md`, `docs/manual.md`, `CHANGELOG.md`, `CHANGELOG.en.md`, `README.md`, `package.json`, `package-lock.json` | 3.18, Abschnitt 5 | 1 | – |
| **I1** Menüs | `src/renderer/src/kube-menus.ts`, `kube-menus.test.ts`, `kube-menu-run.ts`, `kube-menu-run.test.ts`, `src/shared/locales/{de-DE,en-US}/kubeActions.json` | 3.11, Tests 10.7 | 2 | A, C (`row.ports`) |
| **I2** Dialog und Leiste | `src/renderer/src/kube-forward.ts` (neu) + `.test.ts` (neu), `components/kubernetes/KubeForwardDialog.tsx` (neu), `components/kubernetes/KubeForwardBar.tsx` (neu), `components/kubernetes/ClusterView.tsx`, `src/renderer/src/kubernetes-ui.css`, `src/shared/locales/{de-DE,en-US}/kubernetes.json` | 3.12–3.16, Tests 10.8 | 2 | A, E, I1 (`MenuRunner.forward`) |
| **G** Fake | `.claude/skills/run-app/kube-fake.mjs`, `kube-fixtures.mjs`, `fakes.test.mjs` | 3.17, Test 10.9 | 2 | B, D |
| **J** Abnahme | `.claude/skills/run-app/screens.mjs`, `.claude/skills/run-app/SKILL.md` | Abschnitt 6 | 3 | alle |

Hinweise zur Zerlegung:
- **B** ändert `KubeApi`, und damit brechen die drei Fakes. B pflegt `overview.test.ts` und `watch.test.ts`, H pflegt `session.test.ts`. Beide liegen in Welle 1, also ist die Welle am Ende grün.
- **A** fügt `KubeEvent` die Variante `forwards` hinzu. `applyEvent` muss sie behandeln, sonst schlägt der Typecheck fehl. Deshalb liegt **E** in Welle 1.
- Die Fehlertexte (A) werden in Welle 1 von B und D benutzt. So meldet der Katalogtest keine verwaisten Keys.
  - B benutzt `portForwardForbidden`, `portForwardPodGone`, `portForwardNotRunning` und `portForwardRefused`.
  - D benutzt den Rest.
- Die UI-Keys aus I1 und I2 entstehen in Welle 2 und werden in derselben Welle benutzt.
- Die Version (F) und der CHANGELOG (F) liegen in einem Task, denn `src/shared/version.test.ts` prüft beide gemeinsam.
- Nach Welle 3 folgen run-app nach Abschnitt 6 und die manuellen Tests aus Abschnitt 11 durch den Nutzer.

---

## 5. Doku (Task F)

**Handbuch `docs/handbuch.md`:**

1. Abschnitt „Port-Weiterleitungen“: Den Punkt „Pods und Services im Cluster sind hier nicht enthalten; der Cluster-Bereich zeigt weiter den `kubectl port-forward`-Befehl zum Kopieren.“ ersetzen durch:
   > - Pods und Services im Cluster leitest du im Cluster-Tab weiter, siehe „Kubernetes → Port weiterleiten“.
2. Abschnitt „Kubernetes“: Den Satz „„Nur lesen“ sperrt Restart, Scale, Löschen und die Shell; Logs, YAML, Events und Describe bleiben erlaubt.“ ersetzen durch:
   > „Nur lesen“ sperrt Restart, Scale, Löschen und die Shell; Logs, YAML, Events, Describe und `Port weiterleiten…` bleiben erlaubt.
3. Neuer Unterabschnitt `### Port weiterleiten`, ans Ende des Abschnitts „Kubernetes“, direkt vor `## Dateiansicht: Tastatur und Übertragungen`:
   > Rechtsklick auf einen laufenden Pod oder einen Service → `Port weiterleiten…`. Im Dialog wählst du den Port im Pod (die im Manifest genannten Ports oder `Anderer Port …`) bzw. den Port des Service, dazu den lokalen Port. Vorgeschlagen ist derselbe Port; lässt du das Feld leer, wählt Shellherd einen freien. `Weiterleiten` startet die Weiterleitung. Die Leiste „Weiterleitungen“ unten im Cluster-Tab zeigt `127.0.0.1:<Port> → <Ziel>`, die offenen Verbindungen und den letzten Fehler, mit `Im Browser öffnen`, `Adresse kopieren` und `Stoppen`.
   >
   > - **Nur 127.0.0.1:** Der Port ist nur von diesem Computer aus erreichbar, nie aus dem Netz. Ein Feld dafür gibt es nicht.
   > - **Service:** Shellherd liest den Selector und verbindet zum ersten bereiten Pod (nach Name), auf dessen `targetPort`, auch wenn der Port einen Namen hat. Verschwindet der Pod, etwa bei einem Rollout, sucht die nächste Verbindung von selbst einen neuen; laufende Verbindungen zum alten Pod enden. Anders als bei `kubectl port-forward svc/…` muss man nichts neu starten. Die Leiste nennt den Pod („über api-…:8080“). Alle Verbindungen gehen an diesen einen Pod, es gibt keine Lastverteilung.
   > - **Pod:** Die Weiterleitung bleibt an diesem Pod-Namen. Nach einem Neustart des Containers geht es weiter, ebenso bei StatefulSet-Pods, die mit gleichem Namen zurückkommen. Wird der Pod ersetzt, meldet die Leiste „Den Pod … gibt es nicht (mehr).“ Für Deployments deshalb besser den Service nehmen.
   > - **Lebensdauer:** Eine Weiterleitung gehört zu ihrem Cluster-Tab. Tab schließen, Fenster schließen, einen anderen Vault öffnen oder Shellherd beenden stoppt sie. Verbindet sich der Cluster neu, bleibt der lokale Port offen: Neue Verbindungen warten bis zu 30 Sekunden auf den Cluster, bestehende brechen ab. Gesperrt laufen Weiterleitungen weiter, starten lassen sie sich erst nach dem Entsperren. Gespeichert wird nichts, auch nicht im Workspace.
   > - **„Nur lesen“ und Produktion:** Eine Port-Weiterleitung ändert nichts im Cluster und ist deshalb auch bei „Nur lesen“ erlaubt. Bei Produktion nennt der Dialog, was danach erreichbar ist; eine Namenseingabe gibt es nicht. Über die Weiterleitung können Programme aber Daten lesen und schreiben, etwa in einer Datenbank, mit deren eigener Anmeldung.
   > - **Rechte:** Kubernetes verlangt `create` auf `pods/portforward` im Namespace (ältere Versionen `get`). Die Rolle `edit` hat das, `view` nicht. Für Services braucht es zusätzlich `get` auf den Service und `list` auf Pods. Fehlt das Recht, meldet die Leiste „Keine Berechtigung für Port-Weiterleitungen in …“.
   > - **Grenzen:** Höchstens 10 Weiterleitungen gleichzeitig, je Weiterleitung höchstens 32 gleichzeitige Verbindungen, nur TCP. `Im Browser öffnen` nimmt `http`, bei Port 443 und 8443 `https`.
   > - **Wer den Port erreicht:** Jedes Programm und jeder Benutzer auf diesem Computer, auch Webseiten im Browser über Tricks wie DNS-Rebinding. Eine Anmeldung am Port gibt es nicht, genau wie bei `kubectl port-forward`. Lass Weiterleitungen deshalb nur so lange offen, wie du sie brauchst, und leite auf geteilten Rechnern (Terminalserver) nicht zu sensiblen Diensten weiter.

**Manual `docs/manual.md`:** dieselben drei Stellen auf Englisch.
- „Port forwards“: Den Punkt `:425-426` ersetzen durch „Pods and services in the cluster are forwarded from the cluster tab, see “Kubernetes → Forward port”.“
- „Kubernetes“: Den Satz zu “Read-only” um „and `Forward port…`“ ergänzen.
- Neuer Unterabschnitt `### Forward port` vor `## File view: keyboard and transfers` (Überschrift dort prüfen), mit den englischen UI-Texten aus 3.11, 3.16 und 3.4: `Forward port…`, `Other port…`, `Forward`, `Open in browser`, `Copy address`, `Stop`, “Port forwards”, “via api-…:8080”, “Pod … does not exist (any more).”, “No permission for port forwards in …”.

**CHANGELOG.md**, ganz oben, Abschnitt `## [0.27.0] – 2026-10-25`:
- Neu: Port-Weiterleitung zu Pods und Services. Rechtsklick im Cluster-Tab → `Port weiterleiten…` wählt den Port und den lokalen Port. Die Leiste „Weiterleitungen“ unten im Cluster-Tab zeigt die Weiterleitungen mit `Im Browser öffnen`, `Adresse kopieren` und `Stoppen`. Ein Service geht an einen bereiten Pod und findet nach einem Rollout von selbst den nächsten.
- Sicherheit: Weiterleitungen lauschen nur auf 127.0.0.1, leben nur so lange wie ihr Cluster-Tab und werden nicht gespeichert. Shellherd ändert dafür nichts im Cluster, auch „Nur lesen“ erlaubt sie. Nötig ist das Recht `create` auf `pods/portforward`.

**CHANGELOG.en.md**: dieselben zwei Punkte auf Englisch, gleiches Datum `2026-10-25`. Die Parität prüft `version.test.ts`.

**README.md `:50`** (Punkt „Kubernetes“): nach „logs, shell, YAML and describe“ den Text „, and port forwards to pods and services on 127.0.0.1“ einfügen.

---

## 6. run-app-Szenen (Task J, Abnahme)

Der Treiber braucht nichts Neues. Der Block arbeitet nur gegen den Kubernetes-Fake über den SSH-Fake, nie gegen einen echten Cluster.

### 6.1 Neuer Block `kube-forward` in `screens.mjs` (drei Shots, nach `kubernetes`)
```js
  // Port forwards from the cluster tab: pod dialog, pod and service forward proven by an HTTP GET, a service without a ready pod, stop.
  async 'kube-forward'() {
    if (!await evaluate(`document.body.innerText.includes('prod-k8s')`)) { console.log('Port-Weiterleitung übersprungen: prod-k8s fehlt im Baum.'); return; }
    const dialogOpen = `!!document.querySelector('dialog.kube-forward[open]')`;
    const items = () => evaluate(`[...document.querySelectorAll('.kube-view:not([hidden]) .forward-item')].map(item => item.innerText)`);
    // Local port of the bar entry whose target text is `target` (e.g. "svc/api:80").
    const portOf = async target => {
      const line = (await items()).find(text => text.includes(`→ ${target}`));
      const port = Number(/127\.0\.0\.1:(\d+)/.exec(line ?? '')?.[1]);
      if (!port) throw new Error(`Leiste ohne ${target}: ${JSON.stringify(await items())}`);
      return port;
    };
    const get = async port => (await fetch(`http://127.0.0.1:${port}/run-app`, { headers: { connection: 'close' } })).text();
    // Starts a forward from the row menu; an empty local port lets Shellherd pick a free one.
    const forward = async (rowText, step) => {
      await rclick(`.kube-table tbody tr:has-text("${rowText}")`);
      await menuItem('Port weiterleiten');
      await waitFor(`Dialog ${step}`, dialogOpen);
      await fill('dialog.kube-forward input[name=local]', '');
      await click('dialog.kube-forward .primary-button');
      await waitFor(`Weiterleitung ${step}`, `!(${dialogOpen})`);
    };
    try {
      await click('text=prod-k8s >> nth=0');
      await key('Enter');
      await waitFor('Kubernetes-Ansicht', `document.body.innerText.includes('bereit über web-01') && ${count('.kube-table tbody tr')} >= 5`);
      // 1. Pod: the dialog offers the declared port and names the production cluster.
      await rclick('.kube-table tbody tr:has-text("api-6d8f9b7c5-x7k2p")');
      await menuItem('Port weiterleiten');
      await waitFor('Dialog Pod', `${dialogOpen} && document.querySelector('dialog.kube-forward select[name=port]')?.value === '8080' && document.querySelector('dialog.kube-forward')?.innerText.includes('Produktions-Cluster')`);
      await pause(300);
      await shot('kube-forward-dialog');
      await fill('dialog.kube-forward input[name=local]', '');
      await click('dialog.kube-forward .primary-button');
      await waitFor('Leiste mit Pod', `(document.querySelector('.kube-view:not([hidden]) .forward-bar')?.innerText ?? '').includes('api-6d8f9b7c5-x7k2p:8080')`);
      const podPort = await portOf('api-6d8f9b7c5-x7k2p:8080');
      if (!(await get(podPort)).includes('synthetic pod page /run-app')) throw new Error('Pod-Weiterleitung liefert die Seite nicht');
      // 2. Service api:80 resolves to the first ready api pod on its named targetPort.
      await click('.kube-kind-tabs button:has-text("Services")');
      await waitFor('Services', `${count('.kube-table tbody tr')} >= 2`);
      await forward('10.96.12.40', 'Service api');
      const servicePort = await portOf('svc/api:80');
      if (!(await get(servicePort)).includes('synthetic pod page /run-app')) throw new Error('Service-Weiterleitung liefert die Seite nicht');
      await waitFor('Service aufgelöst', `(document.querySelector('.kube-view:not([hidden]) .forward-bar')?.innerText ?? '').includes('über api-6d8f9b7c5-h5t8w:8080')`);
      await pause(300);
      await shot('kube-forward');
      // 3. checkout has no ready pod: the connection fails and the bar says why.
      await forward('10.96.33.7', 'Service checkout');
      await get(await portOf('svc/checkout:8080')).catch(() => '');
      await waitFor('Fehler in der Leiste', `(document.querySelector('.kube-view:not([hidden]) .forward-bar')?.innerText ?? '').includes('keinen bereiten Pod')`);
      await pause(300);
      await shot('kube-forward-error');
      // 4. Stop: every entry goes, the bar disappears and the pod port refuses connections.
      for (const end = Date.now() + 10000; await evaluate(count('.kube-view:not([hidden]) .forward-bar')) > 0; await pause(200)) {
        if (Date.now() > end) throw new Error('Weiterleitungen lassen sich nicht stoppen');
        await click('.kube-view:not([hidden]) .forward-item button:has-text("Stoppen") >> nth=0');
      }
      if (await get(podPort).then(() => true, () => false)) throw new Error('Port antwortet nach dem Stoppen noch');
    } finally {
      await closeTabs();
    }
  },
```
**Ansehen:**
- `kube-forward-dialog.png`: Auswahl `8080 (http)`, lokaler Port 8080, Hinweis zu 127.0.0.1, Produktionszeile, `Weiterleiten`.
- `kube-forward.png`: Leiste mit zwei Einträgen, beim Service „über api-6d8f9b7c5-h5t8w:8080“.
- `kube-forward-error.png`: dritter Eintrag mit „Der Service checkout hat keinen bereiten Pod.“ in Rot.

### 6.2 `SKILL.md`
- In die Blockliste (Kopf von `screens.mjs` `:2` und `SKILL.md:24`) kommt `kube-forward`, mit dem Zusatz „kube-forward erzeugt kube-forward-dialog.png, kube-forward.png und kube-forward-error.png“. In die Bildliste `:34` kommen dieselben drei Dateien.
- Die Tabelle „Gegenstellen“, Zeile 9334, bekommt den Zusatz „; beantwortet auch `pods/<name>/portforward` per WebSocket (Port 8080 laufender Pods liefert eine synthetische Textseite)“.
- Neuer Punkt unter „Stolpersteine“:
  > **Port-Weiterleitung (`kube-forward`):** Der Kubernetes-Fake beantwortet `pods/<name>/portforward` per WebSocket (`v4.channel.k8s.io`). Laufende Pods leiten Port 8080 auf eine synthetische Textseite weiter. Jeder andere Port meldet wie ein Kubelet „connection refused“, `report-0` (Pending) antwortet 400. Der Block lässt den lokalen Port leer (freier Port) und prüft per HTTP-GET aus `screens.mjs`. Am Ende stoppt er alle Weiterleitungen und schließt den Tab. `ws` kommt über `@kubernetes/client-node` mit; fehlt es, startet der Kubernetes-Fake nicht. Nie gegen einen echten Cluster laufen lassen.

---

## 7. Was ausdrücklich nicht getan wird

- Keine schreibende Cluster-Aktion. Neu sind nur die drei Aufrufe aus R7.1 (R-0).
- Keine Bindung an `0.0.0.0`, `::` oder eine wählbare Adresse (R2.2).
- Kein Deployment- oder StatefulSet-Ziel (R1.3), kein UDP, nicht mehrere Ports pro Weiterleitung (R1.4).
- Kein Speichern, kein automatisches Starten, nichts im Workspace (R4.5).
- Keine Namenseingabe bei Produktion, keine Sperre bei „Nur lesen“ (R6).
- Kein Weiterreichen des Kubelet-Fehlertexts (R4.4).
- Keine Lastverteilung über mehrere Pods eines Service (R1.2).
- Kein Umbau der `ForwardBar` und der SSH-Weiterleitungen; die `ForwardRegistry` wird nicht benutzt (R3.3).
- Kein Tastenkürzel, keine Bewegung, keine neuen Tokens, nur ein CSS-Selektor (R9).
- Keine neue npm-Abhängigkeit (`ws` ist schon da).
- Kein SPDY und keine eigene WebSocket-Implementierung in der App.

## 8. Minimale erste Stufe und Extras

**Stufe 1 (dieses Paket):** 1a bis 1g.
- Main: ein neues Modul `forwards.ts` (rund 170 Zeilen), dazu kleine Erweiterungen in `api.ts`, `client-api.ts`, `rows.ts`, `session.ts` und `ipc.ts`.
- Renderer: ein Helfer, ein Dialog, eine Leiste, ein Menüeintrag.
- run-app: rund 50 Zeilen Fake, ein Ende-zu-Ende-Test, ein Block.

**Extras für später:**
- Deployment- und StatefulSet-Ziel über `matchLabels` (gleiche Auflösung).
- Gegendruck im WebSocket-Pfad mit einer begrenzten eigenen Stream-Brücke statt `PortForward`, falls M8 Speicherprobleme zeigt.
- `https` anhand des Portnamens (`https`, `*-tls`).
- Gespeicherte Lieblings-Weiterleitungen je Cluster, nur mit ausdrücklichem Klick zum Starten.
- Weniger Ereignisse bei vielen kurzen Verbindungen (Drosselung der `forwards`-Ereignisse auf etwa 4/s).

## 9. Risiken

1. **WebSocket-Port-Forward am echten Cluster:**
   - Belegt ist es nur gegen den Fake (0.7).
   - Neuere API-Server übersetzen für `kubectl` das Protokoll `v2.portforward.k8s.io`. Andere WebSocket-Protokolle reichen sie zum Kubelet durch, das `v4.channel.k8s.io` kann. Davon geht Shellherd aus; Lens und andere client-node-Werkzeuge nutzen denselben Weg.
   - Proxys vor dem API-Server (Rancher, Teleport) könnten WebSockets anders behandeln.
   - **M1 entscheidet.** Fällt M1 aus, wird das Paket nicht veröffentlicht.
2. **Kein Gegendruck:** client-node schreibt ohne Rückgabeprüfung (0.3). Ein großer Download über eine langsame lokale Gegenstelle puffert im Hauptprozess. Der Shortcut ist im Code markiert, M8 misst. Für HTTP-Oberflächen und Datenbankabfragen ist das unkritisch.
3. **RBAC-Verb beim Upgrade:** Je nach Version ist `get` oder `create` auf `pods/portforward` nötig (R7.1). Die Meldung nennt `create`. Wer nur `get` hat, bekommt auf neueren Clustern 403; das ist dann korrekt.
4. **Pod-Ziel nach einem Rollout:** Die Leiste zeigt den Fehler, der Port bleibt offen. Der Nutzer muss stoppen und neu starten oder den Service nehmen. Das Handbuch sagt das.
5. **Lokale Erreichbarkeit und DNS-Rebinding:** Das bleibt prinzipbedingt (R5.1). Abhilfe schaffen Hinweis, kurze Lebensdauer und Grenzen.
6. **Viele Ereignisse:** Jede geöffnete und geschlossene Verbindung schickt die Liste an den Renderer. Bei Browsern sind das Dutzende pro Sekunde; die Liste ist klein (höchstens 10 Einträge). Eine Drosselung ist ein Extra.
7. **Reconnect:** Während eines Reconnects warten neue Verbindungen bis zu 30 s. Browser zeigen dann „lädt“, Datenbank-Clients laufen eventuell vorher in ihren eigenen Timeout. Das ist akzeptabel und dokumentiert.
8. **Gleichzeitige Starts:** Zwei Starts im selben Moment können beide die Grenze von 10 passieren (Prüfung vor `await listen`). Im schlimmsten Fall laufen 11. Bewusst hingenommen.
9. **`ws` im Fake** ist nur hochgezogen (Shortcut-Kommentar). Ändert npm das Hochziehen, startet der Kubernetes-Fake nicht, und `fakes.test.mjs` scheitert sichtbar. Dann kommt `ws` als devDependency dazu.
10. **Fixtures mit `conditions`:** Die Pod-Fixtures bekommen `Ready`-Bedingungen. `rows.ts` liest bei Pods keine Bedingungen (`conditions` nur bei Nodes und Jobs, `rows.ts:84`, `:145`). Tabellen und Screenshots ändern sich deshalb nicht. Der Block `kubernetes` bestätigt das.
11. **Zweiter Eintrag in langen Menüs:** Das Pod-Menü hat schon mehr als 14 Einträge. Ein weiterer ist vertretbar, weil er in eine bestehende Gruppe kommt (Kontextmenü-Spec `:283`).

## 10. Testideen (Pflicht = **fett**)

### 10.1 Schema (`kubernetes-schema.test.ts`, Task A)
- **`KubeForwardStartRequestSchema`:**
  - nimmt `{ viewId: <uuid>, target: { kind: 'pods', namespace: 'shop', name: 'api-1', port: 8080 }, localPort: 0 }` an;
  - lehnt ab: `kind: 'deployments'`, `port: 0`, `port: 65536`, `localPort: -1`, `localPort: 1.5`, `namespace: 'A_B'`, ein Zusatzfeld `bind: '0.0.0.0'` (wegen `.strict()`).
- `KubeForwardStopRequestSchema` lehnt eine `forwardId` ab, die keine UUID ist.

### 10.2 Client (`client-api.test.ts`, Task B)
- **`portForwardError`:**

  | Eingabe | Ergebnis |
  |---|---|
  | `{ message: 'Unexpected server response: 403' }` | `kubernetes.portForwardForbidden` mit `{ namespace: 'shop' }` |
  | `{ error: { message: 'Unexpected server response: 404' } }` | `kubernetes.portForwardPodGone` mit `{ name: 'p' }` |
  | `… 400` | `kubernetes.portForwardNotRunning` |
  | `… 401` | `kubernetes.unauthorized` |
  | `{ message: 'boom' }` | `kubernetes.apiError` |
  | `{ cause: { code: 'ERR_TLS_CERT_ALTNAME_INVALID' } }` | `kubernetes.tlsAltname` |

- Kein Ergebnis enthält den Originaltext als `detail`.

### 10.3 Zeilen (`rows.test.ts`, Task C)
- **Pod mit Containern:**
  - Ports `[{ name: 'http', containerPort: 8080 }, { containerPort: 9090, protocol: 'UDP' }]` und ein zweiter Container mit `{ containerPort: 8080 }` ergeben `ports: [{ port: 8080, name: 'http' }]`.
  - Ein Pod ohne Ports hat kein Feld `ports`.
- **Service** mit `[{ name: 'http', port: 80, targetPort: 'http' }, { port: 53, protocol: 'UDP' }]` ergibt `[{ port: 80, name: 'http' }]`. Die Zelle `ports` bleibt `80/TCP,53/UDP`.

### 10.4 Weiterleitungen (`forwards.test.ts`, Task D)
Aufbau:
- Echte Sockets auf `127.0.0.1:0`.
- `FakeApi` mit `portForward(ns, pod, port, socket)`: echo (`socket.on('data', d => socket.write(d)); socket.resume();`), protokolliert die Aufrufe, wirft für Pods aus `gone` ein `KubeApiError(…, 404, { code: 'kubernetes.portForwardPodGone', params: { name } })`.
- `read`/`list` liefern Service und Pods aus Feldern.
- `emit` sammelt die Listen.

Pflichtfälle:
- **Bindung:** Nach `start(…, 0)` gilt `server.address().address === '127.0.0.1'`. Prüfen über einen Spion auf `net.createServer().listen` oder per Verbindung auf `127.0.0.1` (geht) und auf die LAN-Adresse aus `os.networkInterfaces()` (`ECONNREFUSED`, falls eine vorhanden ist). `localPort > 0`.
- **Echo** über den lokalen Port: `ping` kommt zurück. `portForward` bekam `('shop', 'api-1', 8080)`. Ein emittierter Stand zeigt `open: 1`, nach dem Schließen `open: 0`.
- **Port belegt:** Ein zweites `start` auf denselben Port lehnt mit `ssh.forwardPortInUse` und `{ port }` ab. Es entsteht kein Eintrag.
- **Grenze:** Das 11. `start` ergibt `kubernetes.portForwardTooMany` (`max: 10`).
- **Service-Auflösung:**
  - Ausgangslage: Selector `{ app: 'api' }`, Port 80 mit `targetPort: 'http'`, Pods `b` und `a` bereit, `c` nicht bereit, `d` mit `deletionTimestamp`, und bei `a` heißt der `containerPort` 8080 `http`.
  - Die erste Verbindung geht an `('a', 8080)`, und der Stand zeigt `pod: 'a', podPort: 8080`.
  - Die zweite Verbindung ruft `list` **nicht** erneut auf (gemerkter Pod).
  - Danach steht `a` in `gone` und ist aus der Liste entfernt. Die nächste Verbindung ruft `list` erneut auf, geht an `b` und funktioniert.
- **Pod-Ziel weg:** Der Stand zeigt `error.code === 'kubernetes.portForwardPodGone'`. Der Listener nimmt weiter an, und eine spätere Verbindung ruft `portForward` erneut auf.
- **Abgelehnt:** `portForward` zerstört den Socket mit `KubeApiError` `kubernetes.portForwardRefused`, und der Stand zeigt genau diesen Code. Die nächste erfolgreiche Verbindung löscht `error`.
- **Verbindungsgrenze:** `portForward` hängt (Promise ohne Auflösung). Die 33. Verbindung wird sofort geschlossen, der Stand zeigt `kubernetes.portForwardBusy` (`max: 32`).
- **`stop`:** Listener zu (Verbinden ergibt `ECONNREFUSED`), offene Sockets zu, emittierte Liste ohne den Eintrag.
- **`stopView`:** Es kommt **kein** weiteres Ereignis für die View, auch nicht von schließenden Sockets.
- `stopAll` schließt alles. `stop` mit fremder `viewId` bewirkt nichts.
- `resolveHop`-Fehler: kein Selector ergibt `portForwardNoSelector`, Port 81 ergibt `portForwardNoPort`, nur nicht bereite Pods ergeben `portForwardNoReadyPod`, ein unbekannter benannter `targetPort` ergibt `portForwardNoPort`.
- `containerPort`: `8080` ergibt 8080, `'8080'` ergibt 8080, ein Name findet den Port im zweiten Container, `undefined` ergibt `undefined`.
- `podReady`: `Pending` ist `false`, `Ready=False` ist `false`, mit `deletionTimestamp` ist es `false`.
- `entry.api()` wirft `AppError('kubernetes.reconnecting')`: Der Socket wird geschlossen, und der Stand zeigt diesen Code.

### 10.5 Sessions und IPC (`session.test.ts`, Task H)
- **Weiterleitung einer View:** `open(1, 'c1')`, `settle()`, dann `startForward(1, viewId, pod p1 8080, 0)`. Echo über den Port. Die letzte Liste kommt in `eventsOf(world, 'forwards', viewId)` an Besitzer 1.
- **„Nur lesen“ erlaubt:** Bei `cluster.readOnly = true` gelingt `startForward`.
- **Deaktiviert:** `cluster.disabled = true` ergibt `kubernetes.disabled`.
- **Vor `ready`** (ohne `settle`): `kubernetes.notConnected`.
- **Fremder Besitzer:** `startForward(2, viewId, …)` ergibt `kubernetes.viewUnavailable`.
- **`close(1, viewId)`** schließt den Port (Verbinden ergibt `ECONNREFUSED`). `closeAll()` tut dasselbe für alle Views.
- `stopForward` emittiert eine Liste ohne den Eintrag.
- Die bestehenden Tests bleiben unverändert grün (`FakeApi` hat jetzt `portForward`).

### 10.6 Renderer-Zustand (`kube-view.test.ts`, Task E)
- `initialKubeView('shop').forwards` ist `[]`.
- Das Ereignis `forwards` ersetzt die Liste.
- **`snapshotOf` enthält keine `forwards`.**

### 10.7 Menüs (`kube-menus.test.ts`, `kube-menu-run.test.ts`, Task I1)
- **Die Beschriftungslisten werden angepasst:**
  - Pod: `'Port weiterleiten…'` direkt nach `'Shell als Tab öffnen'`.
  - Service: `['Pods anzeigen', 'Port weiterleiten…', '---', …]`.
- **Laufender Pod:** `forward` ist aktiv, `run` ist `{ type: 'forward', row }`. Mit `cells.status: 'Pending'` ist der Eintrag gesperrt mit „Der Pod läuft nicht.“.
- **Service:** Ohne `ports` ist er gesperrt mit „Dieser Service hat keinen TCP-Port.“, ohne Selector mit dem Selector-Text. Mit `ports: [{ port: 80 }]` und Selector ist er aktiv.
- **Bei `READ_ONLY` ist `forward` für einen laufenden Pod aktiv. Bei `RECONNECTING` ist er gesperrt mit dem Reconnect-Grund.**
- `runMenuAction({ type: 'forward', row }, r)` ruft genau `r.forward(row)` auf. Der Runner im Test bekommt `forward: vi.fn()`.

### 10.8 Helfer (`kube-forward.test.ts`, Task I2)
- `parsePort`:

  | Eingabe | Ergebnis |
  |---|---|
  | `'8080'` | 8080 |
  | `' 80 '` | 80 |
  | `''` mit `emptyIsAny` | 0 |
  | `''` ohne `emptyIsAny` | NaN |
  | `'0'`, `'65536'`, `'8o'`, `'-1'`, `'1e3'` | NaN |

- `targetText`: Pod ergibt `api-1:8080`, Service ergibt `svc/api:80`.
- `forwardUrl`: Port 80 ergibt `http://127.0.0.1:<l>/`, 443 und 8443 ergeben `https`.
- `forwardTargetOf`: Eine Deployment-Zeile und eine Zeile ohne Namespace ergeben `null`.
- `portLabel`: `{ port: 8080, name: 'http' }` ergibt `8080 (http)`.

### 10.9 Ende zu Ende (`fakes.test.mjs`, Task G)
- **Der Test aus 3.17:**
  - Pod und Service liefern die Seite.
  - Der Service löst auf `api-6d8f9b7c5-h5t8w:8080` auf.
  - Port 9999 ergibt `portForwardRefused`, `report-0` ergibt `portForwardNotRunning`, `checkout` ergibt `portForwardNoReadyPod`.
- Der bestehende Kubernetes-Test bleibt grün, obwohl die Fixtures jetzt Bedingungen und Ports haben.

### 10.10 Ohne Komponententest
Dialog, Leiste, `ClusterView`-Verdrahtung, Fokus, `Enter` und `Esc` deckt die run-app-Szene 6.1 ab. Den echten Cluster prüfen die manuellen Tests.

---

## 11. Manuelle Tests für den Nutzer (echter Cluster, nur lesend)

Mit dem gebauten Paket (`npm run dist`) und einem Test- oder Staging-Cluster. Kein Schritt ändert etwas im Cluster. Für M4 und M6 hilft vorab ein lesender Rechte-Check auf dem Zugangs-Host: `kubectl auth can-i create pods/portforward -n <ns>`.

1. **M1 Pod über HTTP (entscheidet über das Release):**
   - Bei einem laufenden Pod mit HTTP-Port (z. B. Grafana, Prometheus, eine eigene Web-App) Rechtsklick → `Port weiterleiten…` → `Weiterleiten`.
   - `Im Browser öffnen` lädt die Seite. Die Seite zehnmal neu laden, mehrere Unterseiten öffnen.
   - Die Leiste zählt Verbindungen und zeigt keinen Fehler.
   - Klappt das nicht (Fehler beim Handshake), nicht veröffentlichen und die Meldung ins Ledger schreiben.
2. **M2 Service mit benanntem `targetPort`:**
   - Einen Service weiterleiten, dessen `targetPort` ein Name ist. Die Leiste zeigt „über <pod>:<port>“ mit dem richtigen Container-Port, und die Seite lädt.
   - Gegenprobe lesend: `kubectl get svc <name> -o yaml` und `kubectl get pod <pod> -o yaml`.
3. **M3 Rollout überleben (nur, wenn ohnehin ausgerollt wird, nicht durch Shellherd):**
   - Während eine Service-Weiterleitung offen ist, rollt eure normale Pipeline das Deployment neu aus.
   - Danach lädt die Seite wieder, und die Leiste nennt den neuen Pod.
4. **M4 Fehlendes Recht (optional, wenn es ein Konto nur mit `view` gibt):**
   - Weiterleiten, dann die Seite öffnen. Die Leiste meldet „Keine Berechtigung für Port-Weiterleitungen in <ns> (pods/portforward, create).“
5. **M5 Port belegt:**
   - Dieselbe Weiterleitung zweimal mit demselben lokalen Port starten. Der zweite Dialog zeigt „Port … ist auf diesem Computer schon belegt.“ und bleibt offen.
   - Feld leeren, `Weiterleiten`: Es läuft auf einem freien Port.
6. **M6 Nur 127.0.0.1:**
   - `netstat -ano | findstr <port>` zeigt nur `127.0.0.1:<port> … LISTENING`.
   - Von einem anderen Rechner im Netz auf `<IP dieses Rechners>:<port>` verbinden: Das geht nicht.
7. **M7 Lebenszyklus:**
   - Vault sperren: Die Seite lädt weiter. Entsperren.
   - Cluster-Tab schließen: `netstat` zeigt den Port nicht mehr.
   - Neu öffnen, weiterleiten, Fenster schließen: Der Port ist weg.
8. **M8 Großer Download (Risiko 2):**
   - Über eine Weiterleitung eine große Datei laden, etwa ein großes Artefakt aus einem Repository-Pod oder `/metrics` eines großen Prometheus.
   - Im Task-Manager steigt der Speicher von Shellherd nicht dauerhaft um mehr als die Dateigröße und fällt danach wieder.
9. **M9 Datenbank lesend:** Postgres oder MySQL weiterleiten und mit dem eigenen Client und eigener Anmeldung nur `select 1` ausführen.
10. **M10 Produktion:** Bei einem Cluster mit „Produktion“ zeigt der Dialog die Produktionszeile. Eine Namenseingabe wird nicht verlangt.
11. **M11 Neuverbinden:** Während eine Weiterleitung läuft, VPN oder WLAN für etwa 10 s trennen. Die Leiste bleibt stehen. Nach „Wieder verbunden“ lädt die Seite wieder.
