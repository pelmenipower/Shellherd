# SSH-Pro – Review (Stufe 7)

Branch `claude/feature/ssh-pro` gegen `origin/staging` (15 Commits, 1e39a15..7b6556c). Grundlage: Spec `2026-10-24-ssh-pro-design.md`, bindender Anhang `2026-10-24-ssh-pro-validation.md`, Ledger `.superpowers/sdd/2026-10-24-ssh-pro/progress.md`.

Prüfläufe: `npm run typecheck` grün, `npx vitest run` grün (137 Dateien, 2076 Tests). run-app wurde in diesem Review **nicht** ausgeführt (nur lesen); Selektoren in `screens.mjs` und der Dialog mit `mfa-01` sind weiter ungeprüft.

**Urteil: ready after fixes.** 0 Critical, 2 Important, 9 Minor.

## 1. Sicherheit – geprüft und in Ordnung

| Punkt | Befund |
|---|---|
| Antworten nie gespeichert/geloggt/in `detail` | `auth-prompts.ts` hält Antworten nur bis `resolve`, `client-config.ts:59-66` reicht sie an `finish` weiter; kein `console`/Log im Diff; Fehler sind reine Codes (`promptCancelled`, `promptInvalid`) ohne Parameter. |
| Auto-Passwort nur nach Spec 3.3 | `autoPasswordAnswer` (`client-config.ts:37-42`): `method === 'password'`, ungenutzt, genau ein Feld, `echo` falsch, Regex aus der Spec. Getestet. |
| `tryKeyboard` nur mit Handler | `client-config.ts:82-85`: `Boolean(client && keyboard)`, Listener am selben `client`. |
| Abbruch/Runden-Limit K4 | `client-config.ts:44-66`: `null` + aktiv → `emit('error', promptCancelled)` + `destroy`; inaktiv → nur `destroy`; > 6 Runden → `promptInvalid` + `destroy`; nie `finish([])`. |
| Broker: Absender, `promptId`, Länge | `auth-prompts.ts:54-64`: nur offene Frage mit passender `promptId`, nur `target.id === senderId`, Anzahl und ≤ 1024 Zeichen; IPC zusätzlich Zod `AuthPromptAnswerSchema` + `requireSshSender` (`ssh/ipc.ts:94`). |
| Kein Dialog bei Sperre | `auth-prompts.ts:83` (`isUnlocked`), `cancelAll` vor `announce` in **beiden** Pfaden (`index.ts` `onLock` und `autoLock.lock` im `finally`), außerdem in `closeAllSessions`; `cancelOwner` in `closeOwnerSessions` (deckt auch an das Fenster gerichtete Fragen ohne Besitzer über `open.target.id`). |
| Polling ohne Timer-Leck | `setInterval` wird in `settle` gelöscht; jeder Weg (Antwort, Abbruch, Inaktivität, Sendefehler) läuft über `settle`. |
| Renderer-Dialog | `AuthPromptDialog.tsx:48` lehnt bei `locked` ab, `:56` und `:61` brechen beim Sperren ab; Server-Texte nur als React-Text, nie HTML; `autoComplete="off"`, Felder werden nach dem Senden geleert. |
| Sprunghost in allen Produktionspfaden | `openJump` gesetzt in Terminal (`ssh/ipc.ts:51`), SFTP (`files/ipc.ts:85`), Container und Cluster (`containers/ipc.ts:21-42`, `kubernetes/ipc.ts:37`), Test (`index.ts:276`). Kein weiterer Aufrufer von `sshConnectConfig`/`openRemoteHost` ohne Hop. |
| Host-Key beider Hops | beide über dieselbe `KnownHosts`-Instanz, jeder unter eigenem `host:port`. |
| Ein-Hop-Regel, Selbstbezug | `jump.ts:28` zur Laufzeit (nicht SSH, deaktiviert, eigener `jumpHost`, gleiche Id). |
| Hop in jedem Ende-Pfad zu | Terminal: `finish` (`session.ts:673`), Ende während `openJump` (`session.ts:271`); SFTP analog (`sftp-session.ts:104`, `:395`); Test `finish` (`connection-test.ts:122`); Container/Cluster über `close()` des Wrappers bzw. bei Fehler (`containers/ipc.ts:29-32`). |
| Weiterleitungen | lokal (`tunnel.ts` → `127.0.0.1`) und SOCKS (`forwards.ts:224`) nur Loopback; Renderer schickt nur `forwardId` (uuid); `forward()` mit `owned()` und `phase === 'connected'`; Doppelklick: zweiter `start` kehrt bei `starting`/`active` zurück; `stopAll` entfernt `tcp connection`-Listener, Registry-Abo, Listener, Sockets, Kanäle und ruft `unforwardIn` vor `client.destroy`; SOCKS 10 s / 512 Byte (`forwards.ts:237`, `:248`). |
| Secrets in Events | `AuthPromptRequest` und `ForwardStatus` tragen keine Zugangsdaten; keine neue Exec ohne Klick (Auto-Start nur bei vom Nutzer geöffneter Sitzung und `auto: true`). |

## 2. Important

### I1 Nach einem Fenstertransfer verschwindet die Leiste „Weiterleitungen“
- **Ort:** `src/main/ssh/session.ts:637-643` (`attach`), Folge in `src/renderer/src/components/TerminalPanel.tsx:283`.
- **Szenario:** Tab mit laufender Weiterleitung in ein anderes Fenster ziehen. Das neue `TerminalPanel` startet mit `forwardList = null`; Main sendet die Liste nur bei Zustands- oder Kanaländerungen. Die Weiterleitung läuft weiter, ist aber unsichtbar und lässt sich nicht stoppen, bis zufällig ein Kanal auf- oder zugeht. Spec 5.2 („Ereignisse gehen an den neuen Besitzer“) ist damit nur formal erfüllt; das Handbuch („Sie erscheint, sobald die Verbindung steht“) stimmt nicht mehr.
- **Fix-Richtung:** In `attach` nach dem Ausliefern der gehaltenen Ausgabe `if (session.forwards) this.dependencies.emit(session.ownerId, { type: 'forwards', sessionId: session.id, forwards: session.forwards.list() })`. Ein Test in `session.test.ts` (transferOwner → attach → Ereignis `forwards` an den neuen Besitzer).

### I2 Die 2FA-Frage des Sprunghosts überlebt das Schließen des Tabs
- **Ort:** `src/main/ssh/ipc.ts:51-54`, `src/main/files/ipc.ts:85-89` (Hop-`openRemote` ohne Sitzungsbezug), `src/main/containers/runner.ts:47` (`isActive: () => !closed`).
- **Szenario:** Verbindung mit 2FA-Sprunghost öffnen, Dialog „Anmeldung bei <Sprunghost>“ erscheint, Tab schließen (nicht das Fenster). `finish` kann den Hop nicht schließen (`session.jump` ist noch nicht gesetzt), und `isActive` der Frage ist das `!closed` des Hop-Clients, nicht die Sitzung. Der Dialog bleibt offen, der Broker-Poll (Fix 5ec4563) greift nicht, und die Warteschlange blockiert alle anderen Rückfragen bis zum `readyTimeout` des Sprunghosts (Vorgabe 120 s). Beantwortet der Nutzer, meldet sich der Hop noch an und wird erst danach geschlossen. Dasselbe gilt für SFTP-Tabs. Die native Host-Key-Rückfrage des Hops hat dieselbe Lücke.
- **Fix-Richtung:** `JumpDependencies.openRemote` und `RemoteExtras` bekommen ein `isActive?: () => boolean`; `openJump(connection, deps, ownerId, isActive)` reicht es durch, `runner.ts` nutzt `() => !closed && (extras.isActive?.() ?? true)` für Keyboard und `verifyHost`. Terminal und SFTP übergeben `() => this.active(session)`. Test in `jump.test.ts`/`session.test.ts`: Sitzung endet während der Hop-Frage → `ask` liefert `null`, kein `connect` am Ziel.

## 3. Minor

- **M1 Stilles Umgehen bei fehlender Dependency** – `src/main/ssh/session.ts:268`, `src/main/files/sftp-session.ts:102`, `src/main/connection-test.ts:79-80`. Fehlt `openJump`, wird `jumpHost` ignoriert und direkt verbunden (bzw. der Name lokal aufgelöst). Alle Produktionspfade setzen es heute, aber das Muster widerspricht Spec 6 („keine stille Umstellung auf direkt“). Fix: bei `connection.jumpHost && !openJump` mit `AppError('ssh.jumpHostUnusable', { name: connection.jumpHost })` abbrechen, oder `openJump` in den Dependencies Pflicht machen.
- **M2 Fehlschritt im Test nennt die Id statt des Namens** – `src/main/connection-test.ts:97-98`. K9 verlangt den Vault-Namen, falls vorhanden. Fix: Name über `getConnection` bzw. aus den `params` des `AppError` (`jumpHostUnusable`/`jumpHostFailed` tragen ihn) lesen. Zeile 98 ist unerreichbar (`openJump` liefert mit `jumpHost` nie `undefined`) und kann entfallen.
- **M3 „Hier starten“ scheitert immer** – `src/renderer/src/components/ForwardBar.tsx:18`, `src/main/ssh/forwards.ts:99-103`. Im Zustand `elsewhere` hält ein anderer Tab den Schlüssel, `start` wirft also garantiert `ssh.forwardElsewhere` und zeigt einen Fehler-Toast. Sobald der andere Tab freigibt, wechselt die Leiste über K12 ohnehin auf „Starten“. Fix: im Zustand `elsewhere` keinen Knopf zeigen (oder deaktiviert), Key `startHere` dann entfernen; alternativ Übernahme (anderen Tab stoppen) als eigene Entscheidung.
- **M4 Start/Stopp-Wettlauf** – `src/main/ssh/forwards.ts:110-118`, `:196-201`. Start → Stopp → Start während „startet …“: der späte Abschluss des ersten Laufs setzt `entry.close` und ruft `halt(entry)`, was Listener und Streams des zweiten Laufs schließen kann (bzw. der zweite Lauf bekommt `EADDRINUSE`). Fix: `open` gibt das `close` zurück statt `entry.close` zu setzen; nur der Lauf mit gültigem Token übernimmt es, ein verspäteter Lauf schließt nur sein eigenes.
- **M5 Besitzer der Rückfrage wird beim Verbinden eingefroren** – `src/main/ssh/session.ts:287`, `src/main/files/sftp-session.ts:116`. `ownerId: session.ownerId` ist ein Wert; wird ein verbindender Tab verschoben, während seine Frage noch in der Warteschlange steht, geht sie an das alte Fenster (bzw. Fallback), und `cancelOwner(alt)` beim Schließen des alten Fensters bricht die Anmeldung des verschobenen Tabs ab. Fix: `ownerId` im Broker als Getter (`owner: () => session.ownerId`) oder beim Transfer neu zuordnen.
- **M6 Hop der Container-/Cluster-Verbindung hängt nur an `close()`** – `src/main/containers/ipc.ts:34-39`. Spec 4.2 bindet das Schließen auch an `client.on('close')` des Ziels. Endet nur das Ziel, bleibt der Sprunghost-Client offen, bis Discovery (`drop`) oder Cluster (`teardownLive`) `close()` rufen. Fix: im Wrapper beim ersten Lesen von `closed === true` bzw. über ein `onClose` aus `openRemoteHost` den Hop schließen.
- **M7 Wiederholte Hop-Verdrahtung** – identische `openJump`/`openRemoteHost`-Blöcke in `src/main/ssh/ipc.ts:51-55`, `src/main/files/ipc.ts:85-89`, `src/main/index.ts:276-280`, `src/main/containers/ipc.ts:21-26`. Eine Hilfsfunktion `jumpOpener(knownHosts, prompts)` neben `openRemoteWithJump` senkt das Risiko, dass ein Pfad bei I2 vergessen wird.
- **M8 Formular/Leiste: Barrierefreiheit** – `src/renderer/src/components/ConnectionForm.tsx:251`: Fehler `forwards` hat kein Ziel für Fokus (`${prefix}-forwards` existiert nicht) und keine `aria-describedby`-Verknüpfung. `src/renderer/src/components/ForwardBar.tsx:49`: mehrere Knöpfe „Starten“/„Stoppen“ ohne unterscheidenden Namen. Fix: Fokus auf die erste fehlerhafte Zeile (`${prefix}-forward-<id>-listenPort`), Knöpfe mit `aria-label` inkl. `forwardText(forward)` (neuer Key mit Platzhalter).
- **M9 Doku weicht vom Code ab** (Umsetzer N schrieb aus der Spec):
  - `docs/manual.md` „With "Start on connect", Shellherd starts the forward after sign-in if the port is free“ – der Code prüft nur, ob die Weiterleitung in keinem anderen Tab läuft; ein belegter Port führt zum Fehlerzustand. Deutsch („wenn sie frei ist“) ist richtig, Englisch angleichen („if it is not running in another tab“).
  - `docs/handbuch.md`/`docs/manual.md`: „öffnet sich der Dialog … im Fenster des Tabs“ gilt für Terminal und SFTP; bei Containern und Clustern geht er an das zuletzt fokussierte Fenster (Ruling Task K). Halbsatz ergänzen.
  - „Sie erscheint, sobald die Verbindung steht“ ist nach einem Fenstertransfer falsch, bis I1 behoben ist.
  - „Läuft sie in einem anderen Tab … lässt sich hier erst starten, wenn …“ beschreibt den Code richtig, widerspricht aber dem angebotenen Knopf „Hier starten“ (M3).
  - Changelog de/en und README stimmen mit dem Code überein.

## 4. Zusammenspiel und Spec-Abdeckung

| Punkt | Stand |
|---|---|
| Signaturen Anhang 2/3 | eingehalten (`sshConnectConfig`, `AuthPrompts`, `openJump(…, ownerId)`, `openRemoteHost(…, extras)`, `SessionForwards`, `ForwardRegistry.subscribe`, Register-Signaturen mit `prompts`). |
| K1–K14 | umgesetzt; K9 mit Abweichung M2. |
| R-B Schnappschuss | `session.ts:261` (`structuredClone` beim Verbinden), kein `forwardNotFound`. |
| K11 Leerlauf | wörtlich (`session.ts:529-530`). |
| Verbindungskarte `jump` | `session.ts:269`, `TerminalPanel.tsx:275-276`, `connect-timeline.ts`. |
| Formular K10, Löschhinweis | `connection-form.ts` `validateJumpHost`/`jumpHostReferences` getestet; Hinweis nur bei Zahl > 0. |
| Fenstertransfer | Ereignisse gehen an den neuen Besitzer, aber ohne Neusendung (I1). |
| i18n | alle neuen Texte über `t()`, de/en vorhanden, Ports als `port`, Katalogtest grün; en-US „starting…“ nach Ruling G. |
| Design-Tokens | `auth-prompt.css` und `forward-ui.css` nur Tokens (Breiten-`min()` wie bestehende Dialoge), keine Animation, Design-Test grün. |

## 5. Urteil

**ready after fixes** – I1 und I2 beheben (je ein kleiner Main-Eingriff mit Test), M1–M9 nach Ermessen in derselben Fix-Welle; danach run-app mit `mfa-01` und `app-intern` (Dialog, Sprunghost-Schritt, Leiste vor und nach Fenstertransfer).
