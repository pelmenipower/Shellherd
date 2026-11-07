# Fernzugriff (Entwicklung), Meilenstein 1: Nachprüfung (Stufe 8)

Prüfer: Opus, 2026-11-07. Gegenstand: `git diff f1b3316..HEAD` (Fix-Commits `9aa5617` U1, `f110923` U2) gegen das Review `2026-11-07-remote-agent-review.md`. Code wurde nicht geändert.

Eigene Läufe: `npm run typecheck` ist grün. `npx vitest run` auf `src/main/remote` und `remote-peer.test.ts` ergibt 5 Dateien mit 104 Tests, alle grün. Die ganze Suite (214 Dateien, 3158 Tests) und die Zwei-Instanzen-Szene mit EXIT 0 sind laut Lead grün; ich habe sie nicht erneut ausgeführt.

**Urteil: ready (mit Restbefunden für den Nutzer).** B1, M1, M2, M3 und m1 bis m8 sind ADDRESSED. m9 bleibt offen (Lead, Docker). Im Fix-Diff gibt es keine Critical- oder Important-Regression. Es gibt 4 neue Minor-Befunde und 2 Testlücken. Sie gehen an den Nutzer, eine zweite Fix-Welle gibt es nicht.

---

## 1. Befunde aus dem Review

| Befund | Status | Beleg |
|---|---|---|
| **B1** Controller unter StrictMode | ADDRESSED | `App.tsx:150-159`: Der Controller wird im Effekt angelegt, abonniert und entsorgt, die Deps sind `[]`, im Cleanup stehen `setRemote(null)` und `setRemoteView(null)`. Test `remote-peer.test.ts:302`. |
| **M1** Zustimmungsdialog bei Sitzungswechsel | ADDRESSED | `App.tsx:908` `key={remoteSession.id}`, `RemoteConsentDialog.tsx:23-31` mit Neu-Arming, Fokus und Timer auf `[session.id]`. Die Szene prüft es nicht (siehe T1). |
| **M2** Schutzabbau verzögert, Lock-Reihenfolge | ADDRESSED | `index.ts:266-286` und `:424`, `:431` (`protectWindows(true)` steht vor `reset('locked')`), `remote-scene.mjs:178-181` (Warten bis 4 s). |
| **M3** 401 führt in eine Sackgasse | ADDRESSED | `lab-host.ts:214` (goOnline), `:240-250` (request), `:380-384` `#dropAccount`, `:373` (onOffline). Tests `lab-host.test.ts:436`, `:449`. Zum Restfall siehe N1. |
| **m1** Gerätename | ADDRESSED | `remote-peer.ts:36-37`, `:59`, `RemoteLabDialog.tsx:26`. Test `remote-peer.test.ts:335`. |
| **m2** `role="status"` | ADDRESSED | `RemoteLabDialog.tsx:93-102`: nur noch auf den Zeilen `signedInAs` und `online`. |
| **m3** Dispose während Capture | ADDRESSED | `remote-peer.ts:78`. Test `remote-peer.test.ts:321` (Tracks gestoppt, `decline` statt `accept`, keine PeerConnection). |
| **m4** Temporäre Identität, Doku | ADDRESSED | `handbuch.md:753`, `manual.md:732`. |
| **m5** Testbild statt echtem Capture, Doku | ADDRESSED | `handbuch.md:754`, `manual.md:733`, `selfhosted-e2ee.md:14`. |
| **m6** 429 in der Empfangsschleife | ADDRESSED | `lab-host.ts:446`: Wiederholung im nächsten Takt, solange die Frist läuft. Ein Test in `lab-host.test.ts:552-561` prüft, dass die Sitzung nicht endet und das nächste Signal ankommt. |
| **m7** Zeit in der Leiste | ADDRESSED | `RemoteShareBar.tsx:9-11`: Der Fallback wird beim Mount eingefroren, `startedAt` hat Vorrang. |
| **m8** Frame-Prüfung im echten Pfad | ADDRESSED (nur Doku) | Steht im Planstand-Satz unter `selfhosted-e2ee.md:14`. Die manuelle Prüfung steht aus. |
| **m9** Container-Check | NOT ADDRESSED | Kein Lauf von `scripts/check-server-container.mjs` belegt. Laut Review eine Lead-Aufgabe vor dem Merge. |
| A1 bis A3 | ACCEPTED | Unverändert. |

## 2. Gezielte Prüfungen

**M2: Die Verzögerung hebt den Sperrschutz nie auf.**
- `applyProtection` setzt weiterhin `captureBlocked || remoteSharing` (`index.ts:78`).
- Lock während des 2-s-Fensters: `onLock` und AutoLock setzen zuerst `captureBlocked = true` und rufen erst danach `reset('locked')` auf. Der spätere Timer setzt nur `remoteSharing = false`, `applyProtection()` liefert also weiter `true`.
- `onSessionChange` (`closeAllSessions()` und danach `protectWindows(false)`): Während des Fensters hält `remoteSharing = true` den Schutz. Erst der Timer hebt ihn auf. Das ist korrekt.
- Sharing `false → true` innerhalb von 2 s: Der Timer wird gelöscht (`:273`), der Schutz bleibt ohne Lücke. Zusätzlich prüft der Timer `remoteLabHost?.sharing`.
- Neue Fenster im Fenster bekommen Schutz, weil `remoteSharing` noch `true` ist (`:142`).

**Timer beim Beenden der App.**
- `will-quit` ruft `closeAllSessions()` auf, das plant einen Timer von 2 s.
- Node-Timer halten den Electron-Hauptprozess nicht am Leben, das Beenden wird also nicht verzögert.
- Läuft der Callback doch noch (macOS ohne Fenster), sind alle Fensterzugriffe mit `isDestroyed()` abgesichert (`:78`, `:269-270`).
- Kein Leck mit Wirkung.

**B1 unter StrictMode.**
- Der doppelte Effektaufruf erzeugt `c1` (clientId u1), entsorgt ihn und baut dann `c2` (u2).
- `c1` hat sein IPC-Abo im Konstruktor und hebt es in `dispose()` wieder auf. Danach sieht nur noch `c2` Events.
- Main bindet erst bei `connect` (`lab-host.ts:150-155`). Beim Erst-Mount gibt es also keine Bindung an u1, und `c2` arbeitet normal.
- Eine laufende Sitzung verliert dabei weder Owner noch clientId, weil es beim StrictMode-Doppelaufruf noch keine Sitzung gibt.
- Einen Restfall bei späterem Remount beschreibt N2.

**M3: `#dropAccount` während einer laufenden Sitzung.**
- `#onOffline`: beendet die Sitzung vor dem Drop. Korrekt.
- `#goOnline`: Während `presence.start()` kann keine Agent-Sitzung entstehen, weil `onSessions` vor `onDevices` läuft und die Geräteliste beim ersten Poll leer ist (`presence.ts:84-87`, `lab-host.ts:349`). Ein 401 im ersten Poll läuft über `onOffline('authentication')`. Das Ergebnis ist `stale` mit `serverReady`, also keine Sackgasse.
- `#request`: Hier gibt es einen Rest, siehe N1.

## 3. Neue Befunde im Fix-Diff (Minor)

**N1: Ein 401 in `#request` lässt eine parallel eingetroffene Agent-Sitzung ohne Konto stehen.**
- Ort: `src/main/remote/lab-host.ts:242-247`.
- Szenario:
  - Während `await ctx.peer.request(...)` liefert ein Präsenz-Poll eine Anfrage, und `#onSessions` legt eine Sitzung in `consent` an.
  - Danach kommt der 401. `#dropAccount` setzt `phase: 'serverReady'`, `#online` ist leer, aber `#session` bleibt bestehen.
  - Der Zustimmungsdialog bleibt bis zum Ablauf von `consentMs` offen. `armCapture` prüft `#online` nicht (`:292-298`), ein Klick startet also lokal `getDisplayMedia`, bevor `accept` mit `stale` scheitert und der Renderer die Tracks stoppt.
  - Es fließen keine Daten nach außen, weil es keinen Kanal gibt. Die Sitzung ist aber inkonsistent, und es gibt einen unnötigen Capture-Prompt.
- Fix-Richtung: Im 401-Zweig wie in `#onOffline` zuerst `if (this.#session) this.#end(this.#session, 'failed')`. Optional prüft `#armCapture` zusätzlich `this.#online`. Dazu ein Test: Sitzung in `consent`, dann 401 in `request`, danach muss `ended` kommen.

**N2: Ein späterer Remount (Fast Refresh von `App.tsx`) lässt Main an die alte clientId gebunden.**
- Ort: `src/renderer/src/remote-peer.ts:107-112` (`dispose` benachrichtigt Main nicht), `App.tsx:154-158`.
- Szenario:
  - Im Dev-Betrieb führt ein HMR-Edit den Effekt erneut aus. Der neue Controller hat eine neue clientId, Main hängt aber noch an der alten Bindung.
  - Jede Aktion liefert `stale`, auch `connect` (`lab-host.ts:151`). Eine laufende Agent-Sitzung verliert lokal ihre Tracks durch `closeLocal`, während Main bis zur Frist `sharing` und den Schutz hält.
  - Heraus führt nur Sperren oder ein Neustart.
  - Der Fall betrifft nur Dev und war vor dem Fix ebenso möglich. Er ist keine Regression des Fixes.
- Fix-Richtung: `dispose()` schickt best effort `close` mit der eigenen clientId (fire and forget). Beim StrictMode-Erst-Mount ist das harmlos, weil `close` ohne Bindung `idle` liefert.

**N3: Der Fenstertitel kann nach dem Ende kurz wieder „Freigabe“ zeigen.**
- Ort: `src/main/index.ts:282` gegenüber `:76`, `:126`, `:346`.
- Szenario: Main setzt den Titel sofort auf `window.main`. `mainWindowTitle()` liest aber `remoteSharing`, das noch 2 s `true` bleibt. Ein Sprachwechsel in diesem Fenster (`:346`) setzt `window.mainSharing` wieder, und der Timer korrigiert das nicht.
- Fix-Richtung: Der Timer setzt nach `remoteSharing = false` den Titel noch einmal mit `mainWindowTitle()`. Alternativ hängt `mainWindowTitle()` an `remoteLabHost?.sharing`.

**N4: Die verzögerte Aufhebung des Schutzes liegt außerhalb jedes Unit-Tests.**
- Ort: `src/main/index.ts:266-286`.
- Die Szene prüft unter Linux nur den No-op-Pfad.
- Fix-Richtung: Die Logik als kleine Funktion (etwa `createSharingProtection({ apply, timers })`) herausziehen und testen: Lock im Fenster, `true` im Fenster, Timer nach Teardown.

## 4. Testlücken

- **T1 (M1):** Die im Review geforderte Szenen-Prüfung, dass der Knopf in den ersten 1000 ms nach einer erneuten Anfrage `disabled` ist, fehlt (`remote-scene.mjs` nur `:178-181` geändert). Der Fix ist durch den `key` strukturell sicher, aber nicht automatisiert belegt.
- **T2 (B1):** `remote-peer.test.ts:302` belegt nur, dass ein neu gebauter Controller funktioniert. Der App-Effekt selbst ist ungetestet. Der vom Review geforderte Dev-Lauf (`npm run dev` mit `SHELLHERD_SYNC_LAB=1`) ist im Auftrag nicht als erledigt genannt.

## 5. Zusammenfassung für den Nutzer

- Die Fixes sind vollständig, und der Sicherheitskern ist unverändert intakt: kein Capture ohne Klick, der Sperrschutz wird nie aufgehoben, keine Secrets, die kubeconfig bleibt unberührt.
- Vor einem Merge offen: m9 (Container-Check mit Docker), der Dev-Lauf für B1 (T2) und die manuelle Prüfung von echtem Capture unter Windows und macOS (m5, m8).
- Die Restbefunde N1 bis N4 sind Minor und für einen Folgeschritt geeignet.
