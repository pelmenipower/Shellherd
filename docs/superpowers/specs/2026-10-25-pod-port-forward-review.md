# Pod- und Service-Port-Forward – Review (Stufe 5)

Branch `claude/feature/pod-port-forward` gegen `claude/feature/windows-hello` (13 Commits, `617e3c3..2a1c4e1`, Arbeitsbaum sauber).
Grundlage: Spec `2026-10-25-pod-port-forward-design.md`, der bindende Anhang `…-validation.md` (B1–B2, K1–K9, V1–V9) und das Ledger `.superpowers/sdd/2026-10-25-pod-port-forward/progress.md` mit Nutzer-Ruling R-0 (nur lesend).

**Urteil: ready after corrections** – 0 Critical, 1 Important, 3 Minor.
- I-1 ist eine Zeile plus ein Test in `client-api.ts` (Task B). Sie sollte vor dem Release 0.27.0 erledigt sein, weil sie jeden abgebrochenen Download trifft.
- Die Minor-Befunde können als Folgepaket kommen.
- Ohne Befund sind: Sicherheitskern (Bindung, Grenzen, Schema, Verben, Lebenszyklus), UI-Regeln, Fake und Szene.

**Gates:**
- `npm run typecheck`: grün.
- `npx vitest run`, erster Lauf: 2 Fehler in `fakes.test.mjs` (`serves a seeded SFTP tree …`: „Cannot parse privateKey: Malformed OpenSSH private key“ in `sshd.mjs:209`). Das ist ein Last-Flake außerhalb des Diffs, denn `sshd.mjs` ist auf dem Branch unverändert.
- Zweiter Gesamtlauf: **167 Dateien, 2 605/2 605 grün**. `fakes.test.mjs` danach einzeln dreimal grün (16/16), inklusive des neuen Ende-zu-Ende-Tests.
- Weder der mfa- noch der remote-forwards-Flake trat auf.

**Proben (nur synthetisch):**
- Skripte im Scratchpad `…\scratchpad\pfr\` (`stream.probe.ts`, `fix.probe.ts`), gestartet mit eigenem Vitest-Config gegen den echten `createKubeApi` und `KubeForwards`.
- Gegenstelle ist ein lokaler `ws`-Kubelet auf `127.0.0.1:0`. Kein Cluster, kein Vault, kein Build nach `out/`; Treiber und Demo-Server wurden nicht angefasst.

| Probe | Ergebnis |
|---|---|
| 300 kurze Verbindungen nacheinander (Echo, danach `destroy`) | Danach 0 WebSockets am Kubelet, `open` 0, aktive Handles 5 → 6 (der Listener). **Kein Leak.** |
| Halb-Schließen: Client schreibt `hello`, dann `end()`; Kubelet antwortet nach 100 ms | Antwort `""`, **geht verloren** (M-1) |
| Langsamer Leser (pausiert, 16 MiB unterwegs), dann `destroy` des Clients | WebSocket am Kubelet erst nach **30 035 ms** zu (I-1) |
| Wie oben, aber `Stoppen` statt Client-Abbruch | **30 018 ms** (I-1) |
| Wie oben, mit Wächter `socket.destroyed → write() true` | **61 ms**. Damit ist die Ursache von I-1 bestätigt |

**Shots:**
- `kube-forward-dialog.png`: Dialog „Port weiterleiten“, `8080 (http)` vorgewählt, lokaler Port 8080, Hinweis 127.0.0.1, Produktionszeile, Fokus im Select.
- `kube-forward-error.png`: drei Einträge. Pod `aktiv`, Service `über api-6d8f9b7c5-h5t8w:8080 aktiv`, `svc/checkout:8080` mit „Der Service checkout hat keinen bereiten Pod.“ in Rot, jeweils mit drei Knöpfen.

---

## 1. Sicherheit

### Verben (Nutzer-Ruling R-0)

Alle neuen Kubernetes-API-Aufrufe im Diff (gesucht nach `api.*`, `new PortForward|Exec|Watch`, `makeApiClient`, `patch`, `delete`, `create` in allen hinzugefügten Zeilen unter `src/`):

| Stelle | Aufruf | HTTP | RBAC-Verb |
|---|---|---|---|
| `forwards.ts:58` (`resolveHop`) | `api.read({ kind: 'services', … })` → `KubernetesObjectApi.read` | GET `…/services/<name>` | `get` services |
| `forwards.ts:64` (`resolveHop`) | `api.list('pods', ns, { labels })` → `KubernetesObjectApi.list` (`client-api.ts:391-405`, kein `watch`) | GET `…/pods?labelSelector=` | `list` pods |
| `client-api.ts:161` (`openPortForward`) | `new PortForward(config).portForward(…)` | WebSocket-GET `…/pods/<pod>/portforward?ports=` | `create` auf `pods/portforward` (ältere Server: `get`) |

- Sonst gibt es nichts Neues: kein `watch`, `patch`, `delete` oder `exec`, kein `create` auf Objekte.
- `portForwardService` und `portForwardDeployment` aus client-node werden nicht benutzt.
- `retryCount` bleibt 0, `restartableHandleStandardInput` (mit eigenem Neuaufbau) läuft also nie.
- **Kein Critical.**

### Bindung, Grenzen, Schema

- **127.0.0.1:** Fest in `forwards.ts:89` (`server.listen(port, '127.0.0.1', …)`); es gibt weder ein Feld noch einen Parameter dafür. Pflicht-Test D prüft das per Spion auf `Server.prototype.listen`. Die Fake-Seite (`kube-fake.mjs`) lauscht ebenfalls nur auf 127.0.0.1.
- **Grenzen 10/32:**
  - 10 gilt app-weit und wird vor `listen` geprüft (`forwards.ts:104`).
  - 32 gilt je Weiterleitung und wird in `accept` vor `pause` geprüft (`:164-168`). Die 33. Verbindung wird sofort zerstört, `portForwardBusy` steht dann am Eintrag.
  - Die Lücke „11 bei gleichzeitigem Start“ ist nach V9 hingenommen.
  - Pflicht-Tests D sind grün.
- **zod:**
  - `KubeForwardStartRequestSchema`, `KubeForwardTargetSchema` und `KubeForwardStopRequestSchema` sind alle `.strict()` (`kubernetes-schema.ts:21-25`).
  - `kind` ist nur `pods|services`. Namen sind DNS-1123 über `KubeNameSchema`, damit kommt kein `/` und kein `?` in den Pfad.
  - Ports sind ganzzahlig 1–65535, lokal 0–65535; `viewId`/`forwardId` sind UUIDs.
  - Felder wie `bind`/`host` werden abgelehnt (Pflicht-Test A).
  - `ipc.ts:74-83` parst vor jedem Zugriff, `requireSshSender` lässt nur den Hauptframe eines Shellherd-Fensters zu.
- **Ziele des Renderers:**
  - `startForward` holt die View über `viewOf(ownerId, viewId)` (`session.ts:578-579`). Damit sind Cluster und Besitzer festgelegt.
  - Der Renderer kann jeden Namespace und jeden Pod oder Service **dieses** Clusters nennen, aber keinen anderen Cluster und keine fremde View. Stoppen geht nur mit passender View (`forwards.ts:120`, Test „a foreign view stops nothing“).
  - Die Grenze innerhalb des Clusters setzt RBAC, wie bei Tabelle, YAML und Logs (V6). Eine Namespace-Einschränkung je Verbindung gibt es im Vault-Modell nicht (`vault/types.ts:142-153`), es wird also nichts umgangen.
- **kubeconfig und Secrets:**
  - `KubeConfig` bleibt in `createKubeApi`, `KubeForwards` sieht nur `KubeApi`.
  - Der Status enthält Ziel, Pod, Port, Zähler und einen `CodedError` mit festen Parametern.
  - Der Text des Kubelets auf Kanal 1 wird verworfen (Test: `10.244` kommt in der Meldung nicht vor).
  - Handshake-Fehler laufen über `portForwardError`/`toApiError` und tragen nie den Text des Servers.
- **Bestätigungspfad und Exec ohne Klick:**
  - Eine Weiterleitung startet nur über `Weiterleiten` im Dialog → IPC. Es gibt kein Autostart und nichts wird gespeichert (`snapshotOf` ohne `forwards`, Pflicht-Test E).
  - Es gibt keinen `exec`. Der Produktionshinweis steht im Dialog (Shot). Unter „Nur lesen“ ist die Weiterleitung erlaubt, das ist nach V5/R-0 so gewollt.
- **„Nur lesen“ im Main:**
  - `startForward` liest `getCluster(…).disabled` und lehnt einen deaktivierten Cluster ab.
  - `readOnly` wird bewusst nicht geprüft (V5).
  - Bestehende Schreibwege (`runAction`) sind unverändert.
- **`Im Browser öffnen`:** Läuft über das vorhandene `openExternal` (nur `http:`/`https:`, Vault entsperrt). Die URL baut `forwardUrl` aus dem lokalen Port, also nie aus Daten des Clusters.

---

## 2. Strom (`client-api.ts:113-181`, `forwards.ts:162-203`)

- **Pod → lokal:** Liefert `socket.write` den Wert `false`, folgt `ws.pause()`; bei `drain` folgt `resume()` (`:150-159`).
  - `ws` 8.22 verarbeitet nach `pause` höchstens den Rest eines Socket-Blocks (≤ 64 KiB).
  - Ein `drain`-Listener je Pause, weil er nur bei `!isPaused` angehängt wird. Damit wachsen die Listener nicht an.
  - Probe und Pflicht-Test B: 8 MiB kommen vollständig an, der Puffer bleibt < 2 MiB.
- **Lokal → Pod:** Nach dem `send` von client-node prüft der eigene `data`-Listener `bufferedAmount > 1 MiB`. Dann folgt `socket.pause()`; fortgesetzt wird im Callback von `ws.ping`.
  - Ein Ping nach dem Ende ruft den Callback mit Fehler im nächsten Tick auf (`sendAfterClose`), der Socket hängt also nie.
  - Pflicht-Test B ist grün.
- **Schließen ohne Verlust:**
  - WebSocket `close` → `socket.end(() => socket.destroy())` (V3). Daten im Schreibpuffer gehen damit nicht verloren.
  - Auch bei pausiertem WebSocket gilt das: `ws` liest beim Socket-Ende den Rest aus dem Lesepuffer (`websocket.js` `socketOnClose`).
  - Abbruch (1006) endet ebenfalls sauber. Das ist nach V3 hingenommen.
- **Pausierter WebSocket bei Ende auf der lokalen Seite:** Das ist **I-1**. `socket.once('close', () => { open.resume(); open.close(); })` (`:170`) wird durch den nächsten Frame sofort wieder aufgehoben.
- **Fehlerkanal:**
  - Der erste Frame auf Kanal 1 ist nur das Port-Präfix. client-node schneidet es ab, die Länge ist 0, es passiert nichts.
  - Jeder spätere Text zerstört den Socket mit `portForwardRefused`, und `accept` (`forwards.ts:162`) schreibt den Code an den Eintrag.
  - Ein späterer Fehler, nachdem schon Daten flossen, heißt ebenfalls „refused“: das ist M-2.
- **Leaks bei vielen kurzen Verbindungen:**
  - Alle Listener hängen am Socket der jeweiligen Verbindung (`error`, `close`, `data`, `end`) oder am WebSocket. Keiner hängt an einem langlebigen Emitter, außer genau einem `error` je Listener-Server.
  - `entry.sockets` verliert jede Verbindung bei `close`, `stop` leert die Menge.
  - Probe mit 300 Verbindungen: nichts bleibt übrig.
  - Einziger Rest: der 30-s-Hänger aus I-1 bei abgebrochenen Downloads.
- **Daten vor dem Handshake:** `pause()` in `accept` ist ein explizites Pausieren. Die `data`-Listener von client-node und K1 setzen den Fluss deshalb nicht in Gang. Was der Client früh schickt, bleibt im Lesepuffer und wird nach `resume()` gesendet.

## 3. Lebenszyklus

| Ereignis | Umsetzung | Ergebnis |
|---|---|---|
| Tab schließen, `Erneut versuchen` | Cleanup in `useClusterSession` → `kubeClose` → `close` → `stopView` (`session.ts:602`); K4 leert die Leiste | ok, Pflicht-Test H |
| Start während des Schließens | K3: Nach `listen` wird `views.get(viewId) !== view` geprüft, dann folgen `stopView` und `viewUnavailable` (`session.ts:585-588`) | ok, Test „drops a forward whose view closed while it started“ |
| Fenster schließen, Absturz, Neuladen | `closeOwnerSessions` → `closeOwner` → `close` je View (`index.ts:94`, `:130-134`) | ok |
| Vault-Wechsel, Beenden | `onSessionChange` bzw. `index.ts:434` → `closeAll` → `stopAll` vor `dispose` | ok |
| Sperre | `onLock` rührt die Sessions nicht an: Laufende Weiterleitungen bleiben, `getCluster` wirft beim Start `core.vaultLocked`. `Stoppen` geht ohne Vault | ok, Pflicht-Test H, V4 |
| Reconnect des SSH-Tunnels | `tunnel.close()` zerstört alle Tunnel-Sockets. Die WebSockets enden (1006) → lokaler Socket `end`. Neue Verbindungen warten über `waitReady` bis zu 30 s | ok (R4.1) |
| `channel.resume()` nach `destroy` | Port-Forward öffnet keinen eigenen ssh2-Kanal. Die Tunnel-Verbindung des WebSockets räumt `dropChannel` auf (`tunnel.ts:9-12`, unverändert). Bei `open.resume()` nach dem Ende auf der lokalen Seite gilt I-1 | siehe I-1 |
| Leerlauf-Trennung | Nur für SSH- und Pod-Terminals. Die Cluster-Session lebt, solange die View lebt (`maybeIdle`), und Weiterleitungen leben nie länger als ihre View | ok (R4.2) |

## 4. UI

- **Dialog** (`KubeForwardDialog.tsx`):
  - `showModal` öffnet ihn, der Fokus liegt auf dem ersten Select oder Feld. `Esc` schließt (nicht während `busy`), `Enter` im Zahlenfeld startet.
  - `useNativeSurfaceBlock` ist gesetzt, die Muster entsprechen `ConfirmAction`.
  - Nach dem Schließen holt `ClusterView.tsx:105-109` den Fokus in die Tabelle zurück, weil `modal` `forwardRow` umfasst.
  - Ein Fehler beim Start bleibt im Dialog (`role="alert"`).
- **Leiste** (`KubeForwardBar.tsx`): `role="group"` mit Label. Alle Knöpfe sind echte `button`s mit sprechendem `aria-label`, das CSS kommt aus der `ForwardBar`.
- **i18n:** Alle Texte laufen über `t()`/`useT()`, die Keys gibt es in de-DE und en-US, keine Key-Zusammensetzung. Main liefert nur Codes. Der Katalogtest ist grün.
- **Tokens:** Die einzige CSS-Änderung ist der Selektor `.kube-field select`. Keine harten Werte, keine Bewegung. `design-tokens.test.ts` ist grün.
- **Zahlen:** Ports laufen über `formatNumber(…, { useGrouping: false })` aus `format.ts` (`kube-forward.ts:5`), in der Leiste als rohe Zahl (`port` steht nicht in `COUNT_KEYS`). `max`/`count` werden formatiert. Es gibt kein `Intl` und kein `localeCompare` in Komponenten. `resolveHop` sortiert Pod-Namen mit `<`: Das ist Main, ordnet bytegenau wie `kubectl` und ist keine Sortierung für die Anzeige.
- **„Im Browser öffnen“ bei einem Eintrag im Fehlerzustand (Beobachtung des Orchestrators): kein Befund.**
  - Der Fehler gehört zur letzten **Verbindung**, nicht zur Weiterleitung. Der Listener bleibt offen (R4.4).
  - Der Klick öffnet eine neue Verbindung, also einen neuen Versuch. Ist der Pod wieder bereit oder lauscht jetzt jemand auf dem Port, verschwindet der Fehler (Pflicht-Tests D, „clears it with the next good connection“).
  - R3.4 verlangt den Knopf ausdrücklich „immer“.
  - Den Knopf auszublenden würde den einfachsten Weg zum Neuversuch wegnehmen. Bei dauerhaften Fehlern (403, kein Selector) zeigt der Browser einen Verbindungsfehler, und die Leiste nennt den Grund daneben.

## 5. Fake und Szene

- **Nur synthetisch:**
  - `kube-fake.mjs` lauscht auf 127.0.0.1 und verlangt `Bearer synthetic-kube-token`.
  - Ein Upgrade gibt es nur für `^/api/v1/namespaces/<ns>/pods/<pod>/portforward$`, alles andere bekommt 404/401/400.
  - Die Pod-Seite ist ein lokaler HTTP-Server mit festem Text, Nicht-8080 antwortet wie ein Kubelet mit „connection refused“.
  - Der Ende-zu-Ende-Test in `fakes.test.mjs` nutzt `port: 0` und ein eigenes Temp-Verzeichnis. Die Szene `kube-forward` läuft nur gegen `prod-k8s` des Demo-Vaults und schließt am Ende den Tab.
- **`ws`:**
  - `"ws": "8.22.0"` steht in `devDependencies`, im Lockfile nur in `packages[""].devDependencies`.
  - `node_modules/ws` ist **nicht** `dev: true`, bleibt also als Abhängigkeit von `@kubernetes/client-node` im Paket. Exec und Port-Forward brauchen es zur Laufzeit.
  - Der Fake importiert direkt (`import { WebSocketServer } from 'ws'`), der Unit-Test über `createRequire`. Ohne Shortcut-Kommentar, wie K5 verlangt.

---

## 6. Befunde

### Critical

Keine.

### Important

**I-1 – Ein pausierter WebSocket hängt nach dem Ende der lokalen Verbindung 30 s nach.**
- **Datei:** `src/main/kubernetes/client-api.ts:150-159` (zusammen mit `:170`). Eigentümer `client-api.ts` und `client-api.test.ts` (Task B).
- **Fehlerszenario:**
  - Ein Leser ist langsam: Der Browser lädt eine große Datei, der Client liest gerade nicht. Der WebSocket ist deshalb pausiert.
  - Dann endet die lokale Verbindung, weil der Nutzer den Download abbricht oder `Stoppen`, Tab-Ende oder `stopView` den Socket zerstört.
  - Der `close`-Handler ruft `open.resume()` und `open.close()`. Der nächste Datenframe läuft aber in `output.write`, und dort liefert `socket.write` auf dem zerstörten Socket `false`.
  - `ws.isPaused` ist gerade wieder `false`, also folgt erneut `ws.pause()`. Ein `drain` kommt nie.
  - Der Schließ-Handshake wird dadurch nicht gelesen. Erst der Schließ-Timer von `ws` (30 s) zerstört die Verbindung.
- **Folgen:**
  - Jede solche Verbindung hält 30 s lang einen WebSocket über den SSH-Tunnel, einen Stream im Kubelet und die Verbindung zum Pod.
  - Die Zahl ist unbegrenzt, weil die lokale Verbindung schon aus `entry.sockets` und damit aus der 32er-Grenze gefallen ist.
  - Der Pod sieht das Ende erst 30 s später. Das ist genau der Fall „Was passiert mit dem pausierten WebSocket?“, und der Kommentar `// resume: a paused WebSocket could not read the closing handshake.` wird so nicht erfüllt.
  - Gemessen: 30 035 ms (Client-Abbruch) und 30 018 ms (`Stoppen`); mit Wächter 61 ms.
- **Fix:**
  - In `output.write` vor dem Schreiben:
    ```ts
    write(chunk: Buffer, _encoding, callback) {
      // A closed local socket must not pause the stream again: the closing handshake has to be read.
      if (!socket.writable) { callback(); return; }
      if (!socket.write(chunk) && ws && !ws.isPaused) { … }
      callback();
    },
    ```
  - Pflicht-Test in `client-api.test.ts`, `describe('createKubeApi.portForward')`:
    - `FakeKubeletServer` bekommt `clients: Set<unknown>`.
    - Ein Kubelet sendet 16 MiB, der Client liest nicht (`client.pause()`). Nach 300 ms kommt `fake.accepted[0].destroy()`.
    - Erwartet wird, dass `wss.clients.size` innerhalb von 2 s 0 ist.
  - Ohne den Fix bleibt der Test 30 s rot. Die Vorlage liegt in `…\scratchpad\pfr\fix.probe.ts`.

### Minor

**M-1 – Halb-Schließen des Clients verwirft die Antwort.**
- **Datei:** `src/main/kubernetes/forwards.ts:106` (`createServer` mit `allowHalfOpen: false`) zusammen mit client-node `handleStandardInput` (`end` → `ws.close()`). Eigentümer: Doku `docs/handbuch.md`/`docs/manual.md` (Task F), optional ein Folgepaket für `client-api.ts`.
- **Fehlerszenario:**
  - Werkzeuge, die nach dem Senden ihre Schreibseite schließen, bekommen keine Antwort. Beispiele: `echo stats | nc -N 127.0.0.1 <port>`, `socat`, manche Skripte.
  - Node beendet die lokale Seite automatisch, client-node schließt den WebSocket, und was der Pod danach schickt, geht verloren.
  - Probe: Antwort `""`. Browser, curl, Datenbank-Clients und die meisten Programme schließen nicht halb und sind nicht betroffen.
  - v4.channel kennt kein Halb-Schließen, `kubectl` (SPDY) schon.
- **Fix:**
  - Jetzt: In beiden Handbüchern unter „Grenzen“/„Limits“ ergänzen.
    - de: „Programme, die nach dem Senden ihre Seite der Verbindung schließen (z. B. `nc -N`, `socat`), bekommen keine Antwort.“
    - en: “Programs that close their side of the connection after sending (for example `nc -N`, `socat`) get no reply.”
  - Später: `allowHalfOpen: true` und client-node nicht den Socket selbst, sondern einen `PassThrough` mit `end: false` geben. Damit endet der WebSocket erst, wenn der Pod schließt; Gegendruck aus K1 auf den `PassThrough` umziehen.

**M-2 – Jeder Text auf Kanal 1 heißt „Im Pod nimmt niemand Verbindungen auf Port … an“.**
- **Datei:** `src/main/kubernetes/client-api.ts:143-148`. Eigentümer `client-api.ts` und `client-api.test.ts` (Task B).
- **Fehlerszenario:** Das Kubelet schreibt auch Fehler mitten im Strom auf Kanal 1, etwa „error copying …: connection reset by peer“. Setzt der Pod eine laufende Verbindung zurück, meldet die Leiste deshalb „niemand nimmt Verbindungen an“, obwohl der Port eben noch antwortete. Das führt bei der Fehlersuche in die falsche Richtung.
- **Fix:**
  - In `output.write` `delivered = true` setzen, sobald ein Block mit Länge > 0 kommt.
  - In `errors.write` dann `delivered ? { code: 'kubernetes.portForwardFailed' } : { code: 'kubernetes.portForwardRefused', params: { port } }` verwenden.
  - Test: Das Kubelet sendet erst Daten auf Kanal 0, dann Text auf Kanal 1; erwartet wird `portForwardFailed`.

**M-3 – Ein hängender Handshake hat keine Frist.**
- **Datei:** `src/main/kubernetes/forwards.ts:184`. Eigentümer `forwards.ts` und `forwards.test.ts` (Task D).
- **Fehlerszenario:**
  - Antwortet der API-Server (oder ein Proxy wie Rancher/Teleport) auf das Upgrade nicht, wartet `api.portForward` unbegrenzt. client-node setzt kein `handshakeTimeout`.
  - Die lokale Verbindung belegt so lange einen der 32 Plätze, bis der Client aufgibt. Der halb offene WebSocket bleibt danach liegen, bis der Tunnel endet.
  - Die Leiste zeigt keinen Fehler. Der Fake-Fall `hang` in `forwards.test.ts` zeigt genau dieses Verhalten.
- **Fix:**
  - In `relay` einen Timer von 30 s setzen (dieselbe Frist wie `READY_WAIT_MS`). Läuft er ab, kommen `socket.destroy()` und `fail(entry, { code: 'kubernetes.portForwardFailed' })`; nach einem erfolgreichen `await` wird er gelöscht.
  - Ein spät geöffneter WebSocket schließt sich dann selbst über den vorhandenen Zweig `if (socket.destroyed) { open.close(); return; }` (`client-api.ts:179`).
  - Test mit `fake.hang = true` und Fake-Timern.

---

## 7. Spec-Abdeckung

| Punkt | Stand | Beleg |
|---|---|---|
| 1a Pod: Menü, Dialog mit deklarierten Ports und `Anderer Port …` | erfüllt | `kube-menus.ts:158-164`, `KubeForwardDialog.tsx`, Pflicht-Tests I1/I2, Shot |
| 1b Service: Auflösung je Verbindung, benannter `targetPort`, ein Neuversuch nach Rollout | erfüllt | `resolveHop`, `relay` (`forwards.ts:183-200`), Pflicht-Test D, E2E (`h5t8w`) |
| 1c Leiste mit Ziel, Pod, Verbindungen, Fehler, drei Knöpfen | erfüllt | `KubeForwardBar.tsx`, Shots |
| 1d Nur 127.0.0.1, Port frei oder leer | erfüllt | `forwards.ts:89`, `parsePort`, Pflicht-Tests A/D |
| 1e Fehler-Codes (Tabelle R4.4) | erfüllt (Text bei M-2 ungenau) | `portForwardError`, `codedOf`, Pflicht-Tests B/D |
| 1f run-app: Fake, HTTP-GET-Abnahme, E2E-Test | erfüllt | `kube-fake.mjs`, `screens.mjs` `kube-forward`, `fakes.test.mjs` |
| 1g Produktionshinweis ohne Namenseingabe | erfüllt | Dialog, Shot |
| 1h/1i Deployment-Ziel, Speichern/Autostart | bewusst nicht | – |
| 1j Gegendruck (durch B1/K1 Pflicht) | erfüllt, Lücke beim Schließen: I-1 | Pflicht-Tests B, Probe |
| R4.1 Lebenszyklus | erfüllt | Abschnitt 3 |
| R4.3 Weiterleitungen zählen nicht als Aktivität | erfüllt (kein `touch`) | – |
| R4.5 Nichts gespeichert | erfüllt | Pflicht-Test E |
| R5.2 Grenzen 10/32 | erfüllt | Pflicht-Tests D |
| R6.2 / V5 Erlaubt bei „Nur lesen“, abgelehnt bei deaktiviertem Cluster | erfüllt | Pflicht-Test H |
| R7.1 / V7 Verben | erfüllt | Abschnitt 1 |
| K1–K9, B1, B2 | umgesetzt wie vorgegeben | Diff gegen Anhang Zeile für Zeile; K4 Cleanup, K3 Wettlauf, K5 `ws`, K7 Doku-Fundstellen (`handbuch.md:435`, `:542`, `:583`; `manual.md:425`, `:531`, `:572`) |
| Version 0.27.0, CHANGELOG de/en, README | erfüllt | `version.test.ts` grün |

## 8. Manuelle Tests für den Nutzer (echter Cluster, nur lesend)

Mit dem gebauten Paket (`npm run dist`) und einem Test- oder Staging-Cluster. Kein Schritt ändert etwas im Cluster, Shellherd ruft nur `get`, `list` und `create` auf `pods/portforward` auf. Vorab lesend auf dem Zugangs-Host: `kubectl auth can-i create pods/portforward -n <ns>`.

1. **M1 Pod über HTTP (entscheidet über das Release):**
   - Laufender Pod mit HTTP-Port (Grafana, Prometheus, eigene Web-App) → Rechtsklick → `Port weiterleiten…` → `Weiterleiten`.
   - `Im Browser öffnen` lädt die Seite. Zehnmal neu laden und Unterseiten öffnen.
   - Die Leiste zählt Verbindungen, ohne Fehler.
   - Schlägt der Handshake fehl: nicht veröffentlichen, Meldung ins Ledger.
2. **M2 Service mit benanntem `targetPort`:** Die Leiste zeigt „über <pod>:<port>“ mit dem richtigen Container-Port, die Seite lädt. Gegenprobe lesend: `kubectl get svc <name> -o yaml`, `kubectl get pod <pod> -o yaml`.
3. **M3 Rollout (nur, wenn eure Pipeline ohnehin ausrollt, nie durch Shellherd):** Danach lädt die Seite wieder, die Leiste nennt den neuen Pod.
4. **M4 Fehlendes Recht (optional, Konto nur mit `view`):** Die Leiste meldet „Keine Berechtigung für Port-Weiterleitungen in <ns> (pods/portforward, create).“
5. **M5 Port belegt:**
   - Zweimal derselbe lokale Port: Der zweite Dialog meldet „Port … ist auf diesem Computer schon belegt.“ und bleibt offen.
   - Feld leeren → läuft auf einem freien Port.
6. **M6 Nur 127.0.0.1:**
   - `netstat -ano | findstr <port>` zeigt nur `127.0.0.1:<port> … LISTENING`.
   - Von einem anderen Rechner auf `<IP>:<port>`: Das geht nicht.
7. **M7 Lebenszyklus:**
   - Vault sperren: Die Seite lädt weiter. Im gesperrten Zustand lässt sich keine neue Weiterleitung starten. Entsperren.
   - Tab schließen → `netstat` zeigt den Port nicht mehr.
   - Neu öffnen, weiterleiten, Fenster schließen → Port weg.
   - Weiterleiten, dann `Andere Vault-Datei` → Port weg.
8. **M8 Großer Download (K9):**
   - Eine große Datei über die Weiterleitung laden. Der Speicher von Shellherd steigt nur um wenige MB.
   - Die Datei ist vollständig: Größe oder Prüfsumme gegen `kubectl exec … sha256sum` auf dem Zugangs-Host, nur lesend.
9. **M9 Download abbrechen (nach dem Fix von I-1):**
   - Einen großen Download im Browser nach wenigen Sekunden abbrechen.
   - Im Ressourcenmonitor (Netzwerk → TCP-Verbindungen, Prozess Shellherd) verschwindet die Verbindung zum Tunnel-Port innerhalb weniger Sekunden, nicht erst nach 30 s.
10. **M10 Datenbank lesend:** Postgres oder MySQL weiterleiten, mit dem eigenen Client und eigener Anmeldung nur `select 1`.
11. **M11 Produktion:** Bei einem Cluster mit „Produktion“ zeigt der Dialog die Produktionszeile, ohne Namenseingabe.
12. **M12 Neuverbinden:**
    - VPN oder WLAN für etwa 10 s trennen. Die Leiste bleibt stehen.
    - Nach „Wieder verbunden“ lädt die Seite wieder. Eine Verbindung, die in der Zwischenzeit aufgemacht wurde, endet nach höchstens 30 s mit „verbinde neu“.
13. **M13 Fehlerzustand und Neuversuch:**
    - Einen Port weiterleiten, auf dem im Pod nichts lauscht. Die Leiste meldet „Im Pod nimmt niemand Verbindungen auf Port … an.“
    - `Im Browser öffnen` versucht es erneut, der Fehler bleibt stehen. Mit einem richtigen Port verschwindet er bei der nächsten Verbindung.
