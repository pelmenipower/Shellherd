# Pod- und Service-Port-Forward – Nachprüfung Runde 2

Grundlage:
- Review `2026-10-25-pod-port-forward-review.md` (I-1, M-1 bis M-3)
- Ledger `.superpowers/sdd/2026-10-25-pod-port-forward/progress.md`, Fix-Welle FA (I-1, M-2) und FB (M-3, M-1)
- Fix-Diff `2a1c4e1..2ef8e4a`: `67f1a55` (I-1, M-2: `client-api.ts`/`.test.ts`) und `2ef8e4a` (M-3: `forwards.ts`/`.test.ts`; M-1: `handbuch.md`, `manual.md`)

**Urteil: ready.** Alle 4 Befunde sind ADDRESSED, keiner ist PARTIAL oder NOT ADDRESSED. Neu sind 0 Critical, 0 Important und 2 Minor (N-1, N-2). N-1 ist eine Zeile in `forwards.ts` und sollte vor dem Release 0.27.0 mitkommen, blockiert aber nicht. N-2 kann in ein Folgepaket.

Gates:
- `npm run typecheck` ist grün.
- `npx vitest run` ist im ersten Lauf grün: 167 Dateien, 2 609/2 609 Tests, 4 mehr als im Review (`client-api.test.ts` +2, `forwards.test.ts` +2). Es trat kein Flake auf, auch nicht in `fakes.test.mjs`.
- `src/` und `scripts/` sind sauber, die Läufe gelten also für `2ef8e4a`.

Live:
- Ich habe keine eigene Treiber-Probe gemacht. Laut Ledger (run-app Runde 2) sind die Szenen `kube-forward` und `kubernetes` grün.
- Die Shots in `%TEMP%\shellherd-run\shots\` (`kube-forward*.png`, `kubernetes.png`) sind von 13:58, also nach dem Commit von 13:57. Ich habe `kube-forward-error.png` angesehen. Es zeigt drei Einträge: Pod `aktiv`, `svc/api:80` „über api-6d8f9b7c5-h5t8w:8080 aktiv“ und `svc/checkout:8080` mit „Der Service checkout hat keinen bereiten Pod.“, jeweils mit drei Knöpfen. Das ist unverändert gegenüber dem Review.
- Die Fixes liegen nur im Main-Pfad. Ihre Wirkung belegen die Probe und die Unit-Tests, nicht die Shots.
- Es wurde nichts nach `out/` gebaut und kein Cluster, kein echter Vault und kein `%APPDATA%\Shellherd` berührt.

**Verben (R-0):** Die Fix-Diffs enthalten keinen neuen API-Aufruf, also weder `api.*` noch `PortForward`, `Exec`, `Watch`, `patch`, `delete` oder `create`. Neu sind nur ein Wächter, ein Flag und ein Timer. Es bleibt bei `get` services, `list` pods und `create` auf `pods/portforward`.

---

## Befunde aus dem Review

### I-1 Pausierter WebSocket hängt 30 s nach – ADDRESSED
- **Fix:** `src/main/kubernetes/client-api.ts:160` lautet `if (!socket.writable) { callback(); return; }` und steht vor `socket.write`. Ein zerstörter oder beendeter lokaler Socket pausiert den WebSocket also nicht mehr. Damit kommt `open.resume()` aus dem `close`-Handler (`:174`) wirklich zum Tragen, und der Schließ-Handshake wird gelesen. Das entspricht wörtlich der Fix-Richtung aus dem Review.
- **Probe gegen den committeten Code:** `…\scratchpad\pfr\fix.probe.ts` läuft mit eigener Vitest-Config gegen den echten `createKubeApi` und einen lokalen `ws`-Kubelet.
  - Variante `guard=false` (ohne den Wächter der Probe, also nur der committete Code): WebSocket am Kubelet nach **58 ms** zu, vorher **30 035 ms**.
  - Variante `guard=true`: 63 ms.
  - `Stoppen` zerstört den Socket über `close(entry)` auf demselben Weg (`socket.destroy()`) und ist damit abgedeckt.
- **Test:** `client-api.test.ts`, „closes the WebSocket promptly when the local side ends while the stream is paused“. 16 MiB vom Kubelet, der Client liest nicht, nach 300 ms kommt `destroy`, `wss.clients.size` muss innerhalb von 2 s 0 sein. Das ist der Pflicht-Test aus dem Review. Ohne Fix bliebe er 30 s rot.
- **Gegenprüfung des normalen Endes:** `socket.writable` wird erst nach `end()` oder `destroy()` falsch. `open.on('close')` ruft `socket.end(…)` erst, wenn der WebSocket geschlossen ist. Danach kommen keine Frames mehr, also gehen keine Daten verloren. Pflicht-Test B (8 MiB vollständig) ist grün.

### M-1 Halb-Schließen verwirft die Antwort – ADDRESSED
- Die Fix-Richtung „jetzt“ ist umgesetzt: `docs/handbuch.md:593` und `docs/manual.md:582` enthalten unter „Grenzen“/„Limits“ wörtlich den Satz aus dem Review (de: „Programme, die nach dem Senden ihre Seite der Verbindung schließen (z. B. `nc -N`, `socat`), bekommen keine Antwort.“, en entsprechend).
- Der Umbau auf `PassThrough` war ausdrücklich als „später“ markiert und bleibt ein Folgepaket.

### M-2 Jeder Text auf Kanal 1 heißt „refused“ – ADDRESSED
- `client-api.ts:143` führt `delivered` ein. Das Flag wird gesetzt, sobald ein Block mit Länge > 0 kommt (`:158`), und zwar vor dem Wächter aus I-1. Ein Block, den der Wächter verwirft, zählt also trotzdem.
- In `errors.write` (`:148-150`) gilt: nach Daten `kubernetes.portForwardFailed` (ohne Parameter), vorher wie bisher `portForwardRefused` mit `port`.
- Das Port-Präfix auf Kanal 0 kommt bei client-node mit Länge 0 an und setzt `delivered` deshalb nicht. Ein Kubelet, das nach dem Präfix sofort ablehnt, bleibt also „refused“. Den Pfad sichert der bestehende Refused-Test.
- **Test:** „reports portForwardFailed when channel 1 carries text after data was delivered“. Erst `HTTP/1.1 200 OK` auf Kanal 0, dann Text auf Kanal 1. Erwartet wird `portForwardFailed`, und `10.244` darf in der Meldung nicht vorkommen. Damit gelangt der Server-Text weiter nicht nach außen.

### M-3 Hängender Handshake ohne Frist – ADDRESSED
- **Fix:** `forwards.ts:14` setzt `HANDSHAKE_WAIT_MS = 30_000`. `relay` (`:186-191`) startet je Versuch einen Timer. Läuft er ab, folgen `expired = true`, `socket.destroy()` und `fail(entry, { code: 'kubernetes.portForwardFailed' })`.
  - Der Timer wird in beiden Zweigen gelöscht (`:195`, `:202`).
  - Eine späte Antwort ändert den Status nicht mehr (`:196`, `:204`).
  - Ein WebSocket, der spät öffnet, schließt sich in `client-api.ts` über `if (socket.destroyed) { open.close(); return; }`.
- **Tests:** „gives up on a handshake that never answers after 30 seconds“ (29 999 ms ohne Fehler, bei 30 000 ms `portForwardFailed`, der Client wird geschlossen, `getTimerCount() === 0`) und „clears the handshake timer once the stream is open“.
- **Reihenfolge:** Die Fortsetzung nach `await` ist ein Microtask, der Timer ein Macrotask. Ein Handshake, der vor Ablauf fertig wird, löscht den Timer also immer, bevor dieser feuern kann. Einen Wettlauf zwischen Erfolg und Ablauf gibt es nicht.

**Meldung des Umsetzers 1: Der Timer einer gestoppten Weiterleitung läuft bis zu 30 s nach. Bewertung: harmlos.**
- *Keine Statusänderung, die jemand sieht:* `stop`/`stopView`/`stopAll` → `close(entry)` setzt `entry.closed = true` und nimmt den Eintrag aus `entries`. Feuert der Timer danach, schreibt `fail` zwar `entry.status` am verwaisten Objekt, aber `changed` sendet nur bei `!entry.closed` (`forwards.ts` `changed`). Den Eintrag liefert weder `list` noch `snapshot`. Weder Renderer noch Main sehen also etwas.
- *`socket.destroy()`* ist auf dem schon zerstörten Socket ein No-op.
- *Kein Leak:* Der Timer ist einmalig und hält höchstens 30 s lang den Abschluss mit `entry`, `socket` und `api`. Es gibt höchstens einen je offener Verbindung, also ≤ 32 je Weiterleitung und ≤ 320 insgesamt. Danach ist alles frei. Beim Beenden hält ein Timer Electron nicht auf (`app.quit` wartet nicht auf Timer).
- *Feuert er an einem **laufenden** Eintrag, nachdem der Client schon aufgegeben hat,* steht `portForwardFailed` an der Leiste. Das ist richtig, denn der Handshake hing wirklich 30 s. Die nächste gute Verbindung löscht den Fehler.

**Meldung des Umsetzers 2: Bei Services kein Neuversuch nach dem Timeout. Bewertung: richtig so, mit einem Rest (N-1).**
- Nach Ablauf ist die lokale Verbindung schon zerstört, es gibt also niemanden mehr, für den ein zweiter Versuch liefe. Ein Neuversuch hätte nach weiteren 30 s auch die Geduld jedes Clients überschritten. Der bestehende Neuversuch (`:199`) verlangt ebenfalls `!socket.destroyed` und hätte hier nie gegriffen.
- Der eigentliche Zweck des Neuversuchs, also einen ersetzten Pod neu aufzulösen, muss die **nächste** Verbindung übernehmen. Genau das verhindert der Timeout-Pfad aber, siehe N-1.

---

## Neue Befunde

### Critical
Keine.

### Important
Keine.

### Minor

**N-1 – Nach einem Timeout bleibt ein Service am hängenden Pod kleben**
- **Stelle:** `src/main/kubernetes/forwards.ts:186-197` und `:204`. Der Timer-Callback und beide `if (expired) return;` verlassen `relay`, ohne `entry.hop = undefined` zu setzen. Nur der Fehlerpfad ohne Ablauf (`:197`) setzt es zurück.
- **Fehlerszenario:**
  - Eine Service-Weiterleitung hat nach einer erfolgreichen Verbindung `entry.hop` auf Pod A gecacht (`:205`).
  - Der Knoten von Pod A fällt aus. Der API-Server erreicht das Kubelet nicht, und das Upgrade hängt bis zu seinem eigenen Dial-Timeout oder ganz.
  - Nach 30 s meldet die Leiste `portForwardFailed`, aber `entry.hop` zeigt weiter auf Pod A. Jede weitere Verbindung (`:183`, `entry.hop ?? resolveHop`) versucht wieder Pod A und hängt wieder 30 s, auch wenn der Service längst einen anderen bereiten Pod hat.
  - Erst `Stoppen` und neu starten hilft. Bevor die Frist kam, hätte eine späte Ablehnung `hop` zurückgesetzt und neu aufgelöst. Der Pfad mit `expired` verwirft genau diese Ablehnung.
- **Fix:** Im Timer-Callback `entry.hop = undefined;` vor `this.fail(…)` (eine Zeile; für Pods wirkungslos, weil `hop` dort nie gecacht wird). Test in `forwards.test.ts`: Service, erste Verbindung gut, dann `fake.hang = true`, Timer ablaufen lassen, `fake.hang = false`. Erwartet wird, dass die nächste Verbindung `resolveHop` erneut aufruft (`lists` wächst um 1).

**N-2 – Das hängende Upgrade selbst wird nicht abgebrochen**
- **Stelle:** `forwards.ts:187-191` zusammen mit client-node `WebSocketHandler.connect` (`node_modules/@kubernetes/client-node/dist/web-socket-handler.js:131-150`: `new WebSocket(uri, protocols, opts)` ohne `handshakeTimeout` und ohne Abbruch-API).
- **Fehlerszenario:** Die Frist gibt den lokalen Platz frei, aber die Upgrade-Anfrage über den Tunnel bleibt offen, bis der API-Server antwortet oder der Tunnel endet. Bei einem dauerhaft hängenden Proxy kann ein Client, der immer wieder verbindet, je Weiterleitung bis zu 32 solcher Anfragen pro 30 s erzeugen. Vor dem Fix blockierte die 32er-Grenze, bis der Client aufgab. Die Zahl ist also weiterhin unbegrenzt, sie wächst nur schneller. Das Review hatte diesen Rest schon unter M-3 genannt, die geforderte Fix-Richtung deckte ihn nicht ab.
- **Fix-Richtung (Folgepaket, Task B):** `openPortForward` gibt client-node einen `socketFactory` mit, der `new WebSocket(uri, protocols, { ...opts, handshakeTimeout: 30_000 })` baut. Dann bricht `ws` das Upgrade selbst ab, und der Timer in `relay` wird zur bloßen Absicherung. Test: Kubelet-Fake, der das Upgrade nie beantwortet; nach Ablauf muss die Serverseite die Verbindung verlieren.

---

## Manuelle Tests für den Nutzer (echter Test- oder Staging-Cluster, nur lesend)

Mit dem gebauten Paket (`npm run dist`). Shellherd ruft dabei nur `get` services, `list` pods und `create` auf `pods/portforward` auf, und kein Schritt ändert etwas im Cluster. Vorab lesend auf dem Zugangs-Host: `kubectl auth can-i create pods/portforward -n <ns>`.

1. **M1 Pod über HTTP (entscheidet über das Release):** Leite einen laufenden Pod mit HTTP-Port weiter, öffne ihn mit `Im Browser öffnen` und lade zehnmal neu; die Seite lädt jedes Mal, die Leiste zählt ohne Fehler, und bei einem Handshake-Fehler wird nicht veröffentlicht.
2. **M2 Service mit benanntem `targetPort`:** Leite einen Service weiter und prüfe, dass die Leiste „über <pod>:<port>“ mit dem richtigen Container-Port zeigt und die Seite lädt (Gegenprobe lesend mit `kubectl get svc/pod … -o yaml`).
3. **M3 Rollout (nur wenn eure Pipeline ohnehin ausrollt, nie durch Shellherd):** Nach dem Rollout lädt die Seite über dieselbe Weiterleitung wieder, und die Leiste nennt den neuen Pod.
4. **M4 Fehlendes Recht (optional, Konto nur mit `view`):** Die Leiste meldet „Keine Berechtigung für Port-Weiterleitungen in <ns> (pods/portforward, create).“
5. **M5 Port belegt:** Ein zweiter Start auf demselben lokalen Port meldet im offenen Dialog „Port … ist auf diesem Computer schon belegt.“, und mit leerem Feld läuft er auf einem freien Port.
6. **M6 Nur 127.0.0.1:** `netstat -ano | findstr <port>` zeigt nur `127.0.0.1:<port> … LISTENING`, und von einem anderen Rechner ist `<IP>:<port>` nicht erreichbar.
7. **M7 Lebenszyklus:** Gesperrt lädt die Seite weiter und es lässt sich keine neue Weiterleitung starten; nach Tab schließen, Fenster schließen oder `Andere Vault-Datei` zeigt `netstat` den Port nicht mehr.
8. **M8 Großer Download:** Eine große Datei kommt vollständig an (Größe oder Prüfsumme lesend gegen `kubectl exec … sha256sum`), und der Speicher von Shellherd steigt dabei nur um wenige MB.
9. **M9 Download abbrechen (I-1):** Bricht man einen großen Download nach wenigen Sekunden ab, verschwindet im Ressourcenmonitor (Netzwerk → TCP-Verbindungen, Prozess Shellherd) die zugehörige Verbindung innerhalb weniger Sekunden statt erst nach 30 s.
10. **M10 Datenbank lesend:** Postgres oder MySQL weiterleiten und mit dem eigenen Client und eigener Anmeldung nur `select 1` ausführen.
11. **M11 Produktion:** Bei einem Cluster mit „Produktion“ zeigt der Dialog die Produktionszeile, ohne Namenseingabe.
12. **M12 Neuverbinden:** VPN oder WLAN etwa 10 s trennen; die Leiste bleibt stehen, nach „Wieder verbunden“ lädt die Seite wieder, und eine zwischendurch geöffnete Verbindung endet nach höchstens 30 s.
13. **M13 Fehlerzustand und Neuversuch:** Ein Port, auf dem im Pod nichts lauscht, meldet „Im Pod nimmt niemand Verbindungen auf Port … an.“, und dieser Fehler verschwindet erst bei der nächsten Verbindung über einen richtigen Port.
14. **M14 Abbruch mitten im Strom (M-2, optional, nur wenn eure Pipeline den Pod ohnehin neu startet):** Endet der Pod während eines laufenden Downloads, meldet die Leiste „Die Port-Weiterleitung ist fehlgeschlagen.“ statt „Im Pod nimmt niemand Verbindungen auf Port … an.“
