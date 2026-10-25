# Logs aller Pods und RBAC-Vorabprüfung – Nachprüfung Runde 2

Grundlage:
- Review `2026-10-25-k8s-logs-rbac-review.md` (I-1, M-1 bis M-5)
- Ledger `.superpowers/sdd/2026-10-25-k8s-logs-rbac/progress.md`, Fix-Welle FA (I-1, M-1) und FB (M-2 bis M-5), M-2 vom Orchestrator vervollständigt
- Fix-Diff `b0d2aae..7d84eec`:
  - `46e3559`: I-1 und M-1 (`ContextMenu.tsx`/`.test.ts`, `navigation-ui.css`, `kubernetes.json` de/en)
  - `b54436e`: M-2 bis M-5 (`workload-logs.ts`/`.test.ts`, `session.ts`/`.test.ts`, `useClusterSession.ts`/`.test.ts`, `WorkloadLogs.tsx`, `shared/kubernetes.ts`, `kube-view.test.ts`, `screens.mjs`)
  - `7d84eec`: Szene zeichnet die Rechte-Antworten am Main-Handler auf (`screens.mjs`)

**Urteil: ready.** Alle 6 Befunde sind ADDRESSED, keiner ist PARTIAL oder NOT ADDRESSED. Neu sind 0 Critical, 0 Important und 3 Minor (N-1 bis N-3). Keiner blockiert das Release 0.28.0. N-2 (zwei Sätze Doku) sollte mitkommen, N-1 und N-3 können ins Folgepaket.

Gates:
- `npm run typecheck` ist grün.
- `npx vitest run` ist im ersten Lauf grün: 173 Dateien, 2 704/2 704 Tests, 9 mehr als im Review (`ContextMenu.test.ts` +4, `useClusterSession.test.ts` +3, `workload-logs.test.ts` +1, `session.test.ts` +1). Kein Flake, auch nicht in `fakes.test.mjs`.
- `src/` und `.claude/skills/run-app/` sind gegenüber `7d84eec` sauber, die Läufe gelten also für den Fix-Stand.

Live:
- Keine eigene Treiber-Probe. Laut Ledger (run-app Runde 2) sind `kube-logs`, `kubernetes`, `kube-forward` und `login-commands` grün, und das Menü wurde live gemessen: `bottom` 896 bei `innerHeight` 900, `max-height` 892 px, `overflow` auto.
- Shot `%TEMP%\shellherd-run\shots\kube-rbac-menu.png` (15:50) angesehen: Das Menü beginnt bei y ≈ 368, darunter die gesperrten Einträge mit Grund. Der Shot ist 874 px hoch und schneidet die unteren 26 px des Fensters (Statusleiste) ab. Rechnerisch passt das Menü: 900 − 4 − 368 ≈ 528 px Höhe, also unter `max-height`, und ganz im Fenster. Dass „Skalieren“ im Bild halb abgeschnitten ist, liegt am Bildausschnitt, nicht am Menü. Ein Bildbeleg für I-1 ist der Shot damit nicht (siehe N-1).
- Nichts nach `out/` gebaut, kein Cluster, kein echter Vault, kein `%APPDATA%\Shellherd` berührt.

**Verben (R-0):** Die Fix-Diffs unter `src/` enthalten keinen neuen API-Aufruf, also weder `api.*` noch `makeApiClient`, `Watch`, `Exec`, `PortForward`, `patch`, `delete`, `create` oder `fetch`. `access` ruft weiter nur `api.rulesReview` (`create` auf `selfsubjectrulesreviews`, speichert nichts), jetzt hinter einer zusätzlichen Sperre. M-2 ändert nur das Zählen in `sync`, nicht das Öffnen. Es bleibt bei `list`/`watch` pods, `get` pods/log und der Rules-Review.

**Sicherheit sonst:** Bestätigungspfad, `actions.ts`, `ConfirmAction` und `KubeSessions.action` sind im Fix-Diff unverändert. Die kubeconfig bleibt im Main. Zum Renderer kommt nur das neue Zahlfeld `full`. Keine Exec, keine Secrets. Der Eingriff in `ipcMain` steht nur in der Szene (`screens.mjs`), nicht im Produktcode.

---

## Befunde aus dem Review

### I-1 Kontextmenü wächst aus dem Fenster – ADDRESSED
- **CSS:** `navigation-ui.css:48` setzt `max-height: calc(100vh - 8px); overflow-y: auto;`, wie im Review vorgeschlagen. `calc()` ist nach der Lint-Regel erlaubt, `design-tokens.test.ts` ist grün.
- **Klemmung:** `ContextMenu.tsx:19-24` zieht die Rechnung in die reine Funktion `clampMenuPosition`. Der Layout-Effekt (`:31-45`) ruft `place()` einmal, hängt einen `ResizeObserver` an das Menü und setzt den Fokus wie bisher.
- **Springen oder Fokusverlust?** Nein.
  - Der Fokus wird nur im Effekt mit `[x, y]` gesetzt, also beim Öffnen und bei neuen Koordinaten. Der Observer ruft nur `place()` und fasst den Fokus nicht an. Ein per Pfeiltaste gewählter Eintrag bleibt fokussiert, wenn die Gründe eintreffen.
  - Der Observer feuert nur bei Größenänderung. `place()` ändert nur `left`/`top`, nicht die Größe, also gibt es keine Schleife. `left` bleibt ≤ `innerWidth − width − 4`, deshalb kann sich die Schrumpfbreite eines fixen Menüs nicht ändern.
  - Bestehende Menüs ohne späte Änderung (Vault-Baum, Dateien, Container, Terminal) messen sich nach dem Öffnen nicht mehr um. Der erste Observer-Aufruf nach `observe` liefert dieselbe Größe und dieselbe Position, sichtbar ist das nicht.
  - Das einzige echte „Springen“ ist gewollt: Ein Menü, das durch die Gründe wächst, rückt nach oben. Vorher wuchs es nach unten aus dem Fenster. Schreibende Einträge öffnen auch dann nur `ConfirmAction`, ein Fehlklick ist also folgenlos.
- **Getrennt?** Ja. Die Cleanup-Funktion `() => observer.disconnect()` (`:45`) läuft beim Schließen (Unmount) und vor jedem neuen `[x, y]`. Ein alter Observer bleibt nicht hängen.
- **`box-sizing` auf andere Menüs?** Wirkungslos. `styles.css:6` setzt schon global `* { box-sizing: border-box; }`. Die Zeile ist redundant, aber harmlos. Mit `max-height: calc(100vh − 8px)` ergibt das genau 4 px Rand oben und unten.
- **Test:** `ContextMenu.test.ts` deckt die Klemmung ab, auch den Fall „nach dem Wachsen“ (`top 16`). Den Observer-Pfad und den Fokus testet er nicht, siehe N-1. Das Live-Maß im Ledger belegt den Pfad in der echten App.

### M-1 Holpriger Satz und fehlende Pluralformen – ADDRESSED
- `de-DE/kubernetes.json:191` trägt wörtlich den Satz aus dem Review („Startet erst auf Knopfdruck, weil Shellherd dafür …“). en bleibt wie gefordert.
- `waiting`, `dropped` und `olderHidden` gibt es jetzt als `_one`/`_other`, in de und en, wörtlich wie im Review. Der Renderer ruft weiter `t('kubernetes:logsAll.waiting', { count, … })`, und i18next wählt die Form. Der Katalogtest (Parität, Platzhalter, verwaiste Keys) ist grün.

### M-2 Ab 100 Quellen heißt es „warten“ – ADDRESSED
- `workload-logs.ts:151-153` trennt die beiden Gründe: Ein neuer Container über `MAX_LOG_SOURCES` zählt als `full`, die Stream-Grenze weiter als `waiting`. Die Reihenfolge stimmt: Die Quellen-Grenze wird zuerst geprüft, damit ein solcher Container nie als „wartend“ gezählt wird.
- `full` steht im Batch (`:265`), im Typ `KubeEvent` (`shared/kubernetes.ts:151`) und in der Anzeige (`WorkloadLogs.tsx:86`) mit eigenem Text „N weitere Container bleiben außen vor (höchstens 100 Quellen)“ in de und en (`_one`/`_other`).
- **Test:** `workload-logs.test.ts`, „counts containers beyond 100 sources as full, not as waiting“: 101 Pods, nach 80 sauberen Enden gibt es 100 Quellen, `p100` ist nicht dabei, `full === 1`, `waiting === 0`.
- Das falsche Versprechen („rücken nach“) ist damit aus der Anzeige verschwunden. Freie Plätze für beendete Quellen bleiben wie im Review vorgesehen ein Folgepaket. Die Handbücher nennen die Grenze noch nicht, siehe N-2.

### M-3 Rechte-Anfrage über einen Reconnect – ADDRESSED
- `useClusterSession.ts:105-151`: Die Anfragen stehen jetzt in `accessRequests` mit einer Generation. `reset()` erhöht sie und leert `pending`. Der Effekt `:111` ruft `reset()` bei jedem Status ≠ `ready`.
- **Ist die Generation korrekt?** Ja.
  - Eine alte Antwort (`asked !== generation`) wird verworfen, **ohne** `pending.delete`. Damit löscht sie nicht den Platz einer neuen Anfrage für denselben Namespace aus der neuen Generation.
  - Nach `reset()` ist `pending` leer. Der K7-Effekt in `ClusterView` fragt bei `ready` sofort neu, und `ensure` lässt die Anfrage durch.
  - Eine alte Antwort, die noch vor dem `reset()` (zwischen Commit und Effekt) eintrifft, verwirft der Reducer, weil `access` nur bei `status.state === 'ready'` übernommen wird (`kube-view.ts:102`).
  - **Kann eine alte Antwort den neuen Cache füllen?** Nur, wenn React `reconnecting` und `ready` in **einem** Render zusammenfasst, sodass der Effekt nie einen Zustand ≠ `ready` sieht. Die beiden Status kommen als getrennte IPC-Nachrichten, und dazwischen liegt mindestens ein SSH-Tunnelaufbau. Praktisch ist das ausgeschlossen. Selbst dann wäre das Ergebnis fail-open, also kein Befund.
  - Beim Mount ist der Status `null`, also ruft der Effekt einmal `reset()` auf leerem Zustand. Das ist harmlos.
- **Test:** `useClusterSession.test.ts` mit drei Fällen, darunter genau der Review-Fall: Anfrage, `reset`, zweite Anfrage, zwei `ask`-Aufrufe, die alte Antwort wird verworfen, die neue übernommen.

### M-4 `access` ohne `disabled`/Vault-Prüfung – ADDRESSED
- `session.ts:628-630`: `access` liest bei jedem Aufruf `getCluster` und wirft bei `disabled` `AppError('kubernetes.disabled')`. Bei gesperrtem Vault wirft `getCluster` selbst `core.vaultLocked`. Das entspricht dem bindenden Anhang §5 („abgelehnt“) und `startLogs` (`:611`), statt wie im Review vorgeschlagen `null` zu liefern. Die Abweichung ist begründet und im Ledger festgehalten.
- **Wird ein Wurf im Renderer wirklich fail-open und nicht zu einem sichtbaren Fehler?** Ja.
  - `kubeAccess` ruft nur `accessRequests` (`useClusterSession.ts:106`). Andere Aufrufer gibt es nicht (`grep kubeAccess`).
  - `ask(...).catch(() => null)` (`:139`) macht jede Ablehnung zu `null`. `answer` dispatcht `{ denied: null }`, und das bedeutet „nichts gesperrt“.
  - Kein Toast, keine Statuszeile, kein `unhandledrejection`. Der Main-Wrapper `handle` serialisiert den `AppError`, er protokolliert ihn höchstens im Main-Log.
- **Test:** `session.test.ts`, „refuses the pre-check on a disabled cluster or a locked vault without asking the cluster“: beide Codes, `rulesReview` wird nicht gerufen. Den Weg „Wurf → `null`“ im Renderer prüft kein Test, siehe N-3.

### M-5 Monitoring-Prüfung besteht auch ohne Antwort – ADDRESSED
- `screens.mjs:389-411`: Die Szene hängt einen Wrapper um den Main-Handler `k8s:access`, zeichnet die Antworten auf und wartet bis zu 10 s (50 × 200 ms), bis eine Antwort für `monitoring` vorliegt. Erst danach prüft sie `enabled('Rollout neu starten')`. Die feste Pause von 3 s ist weg.
- **Private API `ipcMain._invokeHandlers`:** Ja, die Szene nutzt sie. Als Test-Werkzeug ist das akzeptabel:
  - Sie steht nur in `screens.mjs`, läuft nur im isolierten run-app-Lauf über den vorhandenen `call('main', …)`-Weg und hat dort Vorbilder (`setOpenDialog` überschreibt `electron.dialog.showOpenDialog`, `:111`, `:873`).
  - Fehlt die Map in einer künftigen Electron-Version, liefert `h?.get(…)` `undefined`, und die Szene bricht laut mit „kubeAccess nicht erfassbar“ ab. Sie besteht also nicht stillschweigend.
  - Der Grund steht im Kommentar und im Commit: Die `contextBridge`-API ist eingefroren, ein Wrapper im Renderer ging nicht.
- **Sicher zurückgesetzt?** Ja. Der Wrapper wird erst nach dem erfolgreichen Einbau aktiv, und alles danach steht in `try { … } finally { __accessRestore?.() }`. Das `?.` fängt den Fall ab, dass `__accessRestore` fehlt. Der Wrapper gibt den Rückgabewert und Würfe des Originals unverändert weiter (`await orig(…)`). Ein Wurf landet also nicht in `__accessAnswers`, und die Szene scheitert nach 10 s mit klarer Meldung.
- Rest ohne Befund: Die Szene prüft nicht, dass die Antwort `null` ist, und macht keine Gegenprobe in `shop`. Die Sperre in `shop` beweist Schritt 1 der Szene aber schon, und eine Antwort mit Sperren für `monitoring` würde die anschließende `enabled`-Prüfung rot machen.

---

## Neue Befunde

### Critical
Keine.

### Important
Keine.

### Minor

**N-1 – I-1 hat keinen Regressionsschutz für den eigentlichen Pfad**
- **Stelle:** `src/renderer/src/components/ContextMenu.test.ts` testet nur `clampMenuPosition`, nicht den `ResizeObserver` in `ContextMenu.tsx:41` und nicht den Fokus. `.claude/skills/run-app/screens.mjs:370-374` hat die vom Review vorgeschlagene Prüfung `menu.getBoundingClientRect().bottom <= innerHeight` nicht. Das Live-Maß steht nur im Ledger.
- **Fehlerszenario:** Jemand entfernt den Observer oder das `max-height`, etwa bei einem Umbau des Menüs. Alle Tests bleiben grün, und der Shot `kube-rbac-menu.png` sieht wegen des 874-px-Ausschnitts genauso „abgeschnitten“ aus wie vorher. Der Fehler aus I-1 käme unbemerkt zurück.
- **Fix-Richtung:** In `screens.mjs` direkt nach `waitFor('Neustart und Skalieren gesperrt', …)` eine Zeile `waitFor('Menü im Fenster', "document.querySelector('.context-menu').getBoundingClientRect().bottom <= innerHeight")`. Optional ein Komponententest mit gemocktem `ResizeObserver`: Callback auslösen, `style.top` neu, `document.activeElement` unverändert.

**N-2 – Die Handbücher nennen die neue Quellen-Grenze nicht**
- **Stelle:** `docs/handbuch.md:605` und `docs/manual.md:594`. Dort steht unter „Grenzen“/„Limits“ weiter nur „weitere warten und rücken nach“. Die Anzeige sagt jetzt „bleiben außen vor (höchstens 100 Quellen)“.
- **Fehlerszenario:** Ein Nutzer sieht die neue Meldung bei einer lange offenen Ansicht und findet im Handbuch weder die Grenze noch den Weg, die Ansicht neu zu starten.
- **Fix, wörtlich nach dem Review (M-2):** de anhängen: „Nach 100 Containern in einer Ansicht kommen keine neuen mehr dazu; `Kompakt`/`Roh` umschalten startet die Ansicht neu.“ en: “After 100 containers in one view no new ones join; switching `Compact`/`Raw` starts the view again.”

**N-3 – Der Weg „Main wirft → nichts gesperrt“ ist im Renderer ungetestet, der JSDoc veraltet**
- **Stelle:** `src/renderer/src/hooks/useClusterSession.test.ts:47`. „counts a failed request as unknown“ löst mit `null` auf, statt abzulehnen. Das `.catch(() => null)` in `useClusterSession.ts:139`, auf das M-4 jetzt angewiesen ist, prüft kein Test. Dazu sagt `session.ts:626` „null whenever the answer cannot be trusted“, obwohl `access` bei `disabled` und gesperrtem Vault jetzt wirft.
- **Fehlerszenario:** Ein Umbau entfernt das `catch`. Dann bleibt bei einem deaktivierten Cluster oder gesperrtem Vault der Namespace für immer in `pending`, der Cache bleibt leer, und es gibt eine unbehandelte Ablehnung. Das bleibt fail-open, aber Tests merken es nicht.
- **Fix-Richtung:** Im Test `ask` einmal ablehnen lassen (`Promise.reject(new Error('kubernetes.disabled'))`). Erwartet wird `answers === [{ namespace: 'shop', denied: null }]`, und ein zweites `ensure` fragt neu. JSDoc ergänzen: „throws on a disabled cluster or a locked vault, like the other entries“.

---

## Manuelle Tests für den Nutzer (echter Test- oder Staging-Cluster, nur lesend)

Mit dem gebauten Paket (`npm run dist`). Shellherd ruft dabei nur `list`/`watch` pods, `get` pods/log und `create` auf `selfsubjectrulesreviews` auf (eine Abfrage, die nichts speichert). Kein Schritt ändert etwas im Cluster: **Keine gesperrte oder freigegebene Schreibaktion anklicken, jeden geöffneten Dialog mit `Abbrechen` schließen.** Vorab lesend auf dem Zugangs-Host: `kubectl auth can-i --list -n <ns>`.

1. **M1 Logs aller Pods (entscheidet über das Release):** Rechtsklick auf ein Deployment mit mindestens 2 Replikas und `Logs aller Pods`: Je Pod erscheint ein Chip in eigener Farbe, „Live: n von n Containern“, die Zeilen sind nach Zeit gemischt, und `kubectl logs <pod> --timestamps --tail=5` zeigt für zwei Pods dieselben UTC-Zeiten in derselben Reihenfolge.
2. **M2 Ruhiger Pod:** Bleibt ein Pod ohne Ausgabe länger als eine Minute offen, ist er weiter live oder nach höchstens 5 s wieder live.
3. **M3 Eingeschränktes Konto (nur `view`):** Im Menü eines Deployments sind „Rollout neu starten…“ und „Skalieren…“ gesperrt mit „Keine Berechtigung: patch auf deployments in <ns>“, „Logs aller Pods“ ist frei, und `kubectl auth can-i patch deployments -n <ns>` sagt `no`.
4. **M4 Konto mit vollen Rechten:** Im selben Menü ist nichts gesperrt.
5. **M5 Unvollständige Antwort (falls GKE/AKS mit Azure-RBAC oder EKS Access Entries verfügbar):** Nichts ist gesperrt.
6. **M6 Menü-Höhe (I-1):** Fenster auf etwa 760 px Höhe verkleinern, Namespace wechseln und sofort ein Deployment rechtsklicken: Das Menü bleibt nach dem Eintreffen der Gründe ganz im Fenster, lässt sich scrollen, und alle Einträge sind mit der Maus und per Pfeiltasten erreichbar, ohne dass der Fokus springt.
7. **M7 Andere Menüs:** Rechtsklick im Verbindungsbaum, in einer Dateiliste und auf einen Terminal-Reiter öffnet die Menüs an derselben Stelle wie vor dem Update, mit dem ersten Eintrag fokussiert.
8. **M8 Tasten:** Mit dem `view`-Konto ein Deployment wählen und `r` sowie `S` drücken: Die Kopfzeile zeigt denselben Grund wie das Menü, und es öffnet sich kein Dialog.
9. **M9 Lebenszyklus:** Eine andere Zeile wählen beendet die Ansicht; nach `YAML` und zurück startet sie erst wieder per Knopf; `Kompakt`/`Roh` startet sie neu; nach dem Schließen des Tabs sinkt im Ressourcenmonitor (Netzwerk → TCP-Verbindungen, Prozess Shellherd) die Zahl der Verbindungen zum Tunnel-Port.
10. **M10 Reconnect (M-3):** VPN oder WLAN etwa 10 s trennen: Die Ansicht zeigt den letzten Stand, startet nach „Wieder verbunden“ mit leerem Puffer neu, und die gesperrten Einträge sind im ersten Menü danach sofort wieder gesperrt statt erst nach einer Minute.
11. **M11 Deaktivierter Cluster (M-4):** Bei offenem Tab den Cluster in den Einstellungen deaktivieren und ein Menü öffnen: Es erscheint keine Fehlermeldung, und kein Eintrag wird wegen der Vorabprüfung neu gesperrt.
12. **M12 Rollout (nur, wenn eure Pipeline ohnehin ausrollt, nie durch Shellherd):** Neue Pods kommen von selbst dazu, alte bleiben als „beendet“, und nach einem Container-Neustart gibt es keine doppelten Zeilen (Gegenprobe `kubectl logs <pod> --previous --tail=3`).
13. **M13 Viele Container (M-2, nur falls ein DaemonSet auf mehr als 100 Container kommt):** Die Leiste zeigt „… bleiben außen vor (höchstens 100 Quellen)“ statt „warten“.
14. **M14 Last:** Ein gesprächiges Deployment (etwa ein Ingress-Controller) fünf Minuten offen lassen: Der Speicher von Shellherd im Task-Manager bleibt stabil, und „Zeilen ausgelassen“ erscheint nur bei echter Flut.
15. **M15 Ortszeit-Node (falls vorhanden):** Zeilen eines Nodes mit `+02:00`-Runtime sortieren sich korrekt zwischen die Zeilen der UTC-Nodes ein.
