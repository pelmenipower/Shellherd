# SSH-Pro – Nachprüfung Runde 2

Grundlage: Review `2026-10-24-ssh-pro-review.md`, Ledger `.superpowers/sdd/2026-10-24-ssh-pro/progress.md` (Runde 1, I0, Rulings M5–M7). Fix-Diff: `git diff 7b6556c..HEAD -- src .claude docs/handbuch.md docs/manual.md` (Commits 64c601b, b1bcee4, 0f6dfa3, e5b5ff4, 40e1dfc).

Prüfläufe: `npm run typecheck` grün, `npx vitest run` grün (137 Dateien, 2093 Tests). run-app in dieser Nachprüfung **nicht** ausgeführt (nur lesen).

**Urteil: ready to merge.** 11 Befunde: 9 ADDRESSED, 3 ACCEPTED (M5, M6, M7), 0 NOT ADDRESSED. Neu: 0 Critical, 0 Important, 2 Minor.

## 1. Befunde

| Befund | Status | Beleg |
|---|---|---|
| I0 Kanal schließt nach Socket-Ende nie | ADDRESSED | `src/main/kubernetes/tunnel.ts:9-12` `dropChannel` = `destroy()` + `resume()`; genutzt in `tunnel.ts:23`, `:25`, `forwards.ts:189` (halt, Sockets und Kanäle), `:272`, `:289`, `:293`. Tests: `forwards.test.ts` (lokal und SOCKS, „only ends once read“), `tunnel.test.ts`. |
| I1 Leiste nach Fenstertransfer weg | ADDRESSED | `src/main/ssh/session.ts:649-650`: `attach` sendet `forwards` an den neuen Besitzer, nur bei aktiver Sitzung (Ruling F2b). Test „sends the forward list to the new owner when a window attaches“. |
| I2 Hop-2FA überlebt Tab-Ende | ADDRESSED | Kette Terminal: `session.ts:275` → `ssh/ipc.ts:51-55` → `jump.ts:33` → `runner.ts:41` (`!closed && extras.isActive()`), genutzt für `verifyHost` (`runner.ts:43`) und Keyboard (`runner.ts:49`). SFTP: `sftp-session.ts:105` → `files/ipc.ts:85-89` → gleiche Kette. Broker-Poll `auth-prompts.ts:102` beendet die Frage binnen 500 ms; `client-config.ts:65` bricht ohne Fehlercode ab. Zusätzlich `jump.ts:37-41`: Sitzung weg nach Hop-Login → Hop zu, kein `forward`. Host-Key: `known-hosts.ts:51/57/72` prüft `isActive` vor und nach dem nativen Dialog (der Dialog selbst bleibt offen wie im Direktpfad, Ergebnis wird verworfen). |
| M1 Stilles Umgehen ohne `openJump` | ADDRESSED | Terminal `session.ts:269-272`, SFTP `sftp-session.ts:104`, Test `connection-test.ts:96`. Kein Produktionspfad bricht falsch ab: `openJump` ist gesetzt in `ssh/ipc.ts:51`, `files/ipc.ts:85`, `index.ts:276`; Container/Cluster rufen `openJump` direkt (`containers/ipc.ts:23`); Kube-Terminals verlassen `connect` vor der Prüfung (`session.ts:251-254`), lokale Shells ebenso (`:257`). |
| M2 Fehlschritt nennt Id | ADDRESSED | `connection-test.ts:99-104` liest `name` aus `jumpHostUnusable`/`jumpHostFailed`; bei `jumpHostMissing` (`jump.ts:26`) gibt es keinen Vault-Namen, die Id ist dort korrekt. Unerreichbarer Zweig ersetzt durch `jumpHostUnusable` (`:105`). |
| M3 „Hier starten“ scheitert immer | ADDRESSED | `ForwardBar.tsx:49-54` kein Knopf bei `elsewhere`; Key `startHere` in de/en entfernt. |
| M4 Start/Stopp-Wettlauf | ADDRESSED | `forwards.ts:109-121`: `open` liefert sein eigenes `close`; ein verspäteter Lauf schließt nur das eigene. Test „lets a late start from before a stop leave the newer run …“. Restrisiko bei `remote` siehe N1. |
| M5 Besitzer der Rückfrage eingefroren | ACCEPTED | Ruling Runde 1 vertretbar: nur Transfer eines Tabs **während** der Anmeldefrage; Folge ist falsches Fenster bzw. Abbruch mit Fehlermeldung, kein Datenleck, Antwort bleibt an `promptId` + Absender gebunden. |
| M6 Container-Hop nur an `close()` | ACCEPTED | Vertretbar: Discovery (`drop`) und Cluster (`teardownLive`) rufen `close()` in jedem Ende-Pfad; Folge ist ein kurz offener Hop ohne Kanal. |
| M7 Verdrahtung dupliziert | ACCEPTED | Vertretbar als reine Struktur. Hinweis: das befürchtete Risiko trat ein – `index.ts:278` und `containers/ipc.ts:23` reichen kein `isActive` durch (siehe N2), dort gibt es aber auch keinen Tab, der enden könnte. |
| M8 Barrierefreiheit Formular/Leiste | ADDRESSED | `ConnectionForm.tsx:121-123` Fokus auf `…-forward-<id>-listenPort` (existiert, `ForwardsEditor.tsx:47`), `aria-describedby` am Fieldset (`ForwardsEditor.tsx:34`) mit `…-forwards-error` (`ConnectionForm.tsx:254`); Knöpfe mit `aria-label` `startLabel`/`stopLabel` inkl. `forwardText`. Fokus geht auf die **erste** Zeile, nicht die fehlerhafte – der Validator (`connection-form.ts:151`) liefert keinen Index, daher hinnehmbar. |
| M9 Doku weicht ab | ADDRESSED | `manual.md:277-281` („if it is not running in another tab“, „only … running in another tab“), `handbuch.md:176-178`/`manual.md:176-177` (Fenster je Ansicht), `handbuch.md:289-290`. „Erscheint, sobald die Verbindung steht“ stimmt nach I1. Dazu `screens.mjs:350-352` ohne ungültiges `:text-is` im `querySelector`. |

## 2. Gezielte Fragen

- **`dropChannel` + `resume`:** ssh2 überschreibt `Channel.destroy()` mit `end()` + `close()` (`node_modules/ssh2/lib/Channel.js:214-218`); der Stream wird nicht als zerstört markiert, `resume()` lässt nur den Rest bis `end` laufen, worauf `onCHANNEL_CLOSE` (`ssh2/lib/utils.js:84`) `close` sendet. Ist der Kanal noch an einen bereits zerstörten Socket gepipt (`forwards.ts:289`: erst `dropChannel`, dann `socket.destroy()` im selben Tick; `resume` wirkt erst im nächsten Tick), schreibt `pipe` in einen zerstörten Writable: Node liefert `ERR_STREAM_DESTROYED` nur an den Callback, `errorOrDestroy` ist bei schon zerstörtem Stream ein No-op, außerdem hat der Socket einen `error`-Listener. Kein Wurf, kein Datenabfluss. Auf `net.Socket` (in `halt`) und `PassThrough` (Tests) ist `resume()` nach `destroy()` ein No-op. Kube-Tunnel: gleiche Semantik, unbedenklich.
- **M4 `unforwardIn` des verspäteten Laufs:** siehe N1, Minor.
- **I2:** bis zur Host-Key- und Keyboard-Rückfrage des Hops durchgereicht (Terminal und SFTP), Ende über Broker-Poll – siehe Tabelle.
- **M1:** kein Produktionspfad bricht fälschlich ab – siehe Tabelle.

## 3. Neue Befunde (nur Fix-Diff)

### N1 (Minor) Verspäteter `remote`-Lauf hebt die Bindung per Port auf
- **Ort:** `src/main/ssh/forwards.ts:119` mit `:216-218`.
- **Szenario:** Entfernte Weiterleitung: Start → Stopp → Start, bevor die erste `forwardIn`-Antwort kommt. Globale Requests werden in Reihenfolge beantwortet; Lauf 1 bindet, Lauf 2 bekommt bei OpenSSH meist „Adresse belegt“ → Zustand Fehler, danach hebt Lauf 1 per `unforwardIn('localhost', port)` die Bindung auf. Ergebnis: Fehleranzeige, kein Leck. Erlaubt ein Server die Doppelbindung, entfernt `unforwardIn` die Bindung (und den Eintrag in ssh2s Forward-Tabelle, Schlüssel `adresse:port`) auch für Lauf 2, der dann „aktiv“ ohne Wirkung anzeigt. Vor dem Fix bestand dasselbe Risiko (`halt` rief das gleiche `unforwardIn`), es ist also nicht neu verschlechtert.
- **Fix-Richtung (optional):** im späten Lauf `close()` für `remote` nur rufen, wenn kein neuerer Lauf denselben Port hält (`entry.run === undefined`), sonst die Bindung dem neuen Lauf überlassen; oder `start` während `starting` eines älteren Laufs mit `remote` ablehnen.

### N2 (Minor) Verbindungstest und Container reichen kein `isActive` an den Hop
- **Ort:** `src/main/index.ts:278`, `src/main/containers/ipc.ts:23`.
- **Szenario:** Hop-2FA beim Verbindungstest bzw. bei einer Container-/Cluster-Verbindung: wird die aufrufende Ansicht verlassen, bleibt der Dialog bis zur Antwort oder zum `readyTimeout` stehen und blockiert die Warteschlange. Es gibt dort keine Sitzung mit Tab-Ende, und das Ruling zu M6/Task K deckt die fehlende Bindung ab; daher nur Minor.
- **Fix-Richtung:** mit M7 (gemeinsamer `jumpOpener`) später nachziehen.

## 4. Urteil

**ready to merge** – I0, I1, I2 und M1–M4, M8, M9 behoben und getestet; M5–M7 per vertretbarem Ruling akzeptiert; zwei neue Minor ohne Merge-Blocker. Vor dem Merge laut Review noch run-app mit `mfa-01` und `app-intern` (Dialog, Sprunghost-Schritt, Leiste vor und nach Fenstertransfer) – in dieser Nachprüfung nicht ausgeführt.
