# Fernzugriff (Entwicklung), Meilenstein 1: Review (Stufe 7)

Prüfer: Opus, 2026-11-07. Gegenstand: `git diff ede843a..HEAD` auf `claude/feature/remote-agent` (HEAD `009f15a`). Maßstab: Spec `2026-11-07-remote-agent-design.md`, bindender Anhang `2026-11-07-remote-agent-validation.md`, `CLAUDE.md`, `AGENTS.md` und Ledger `.superpowers/sdd/2026-11-07-remote-agent/progress.md`.

Eigene Läufe: `npx vitest run` auf die Remote-Dateien (9 Dateien, 144 Tests) ist grün. Typecheck und die ganze Suite (214 Dateien) sind laut Lead grün; ich habe sie nicht erneut ausgeführt. Code wurde nicht geändert.

**Urteil: Fixes nötig (not ready).** Es gibt 1 Blocker, 3 Major und 9 Minor. Dazu kommen 3 Punkte, die per Ruling oder Validierung akzeptiert sind (ACCEPTED).

Der Sicherheitskern hält. Ohne Grant gibt es kein Capture, der Grant ist korrekt gebunden, `control` wird abgelehnt, der Server kann weder Zustimmung noch Signal fälschen, und die kubeconfig sowie andere Secrets bleiben unberührt. Die Befunde betreffen den Lebenszyklus im Renderer, die Reihenfolge beim Ende und eine Sackgasse beim Ablauf der Anmeldung.

---

## 1. Sicherheitsprüfung (R1 bis R12, Validierung)

| Punkt | Ergebnis | Beleg |
|---|---|---|
| Capture ohne lokalen Klick | Kein Pfad von außen. `consumeCaptureGrant` liefert nur nach `armCapture` vom Owner-Main-Frame (`requireMain`) für eine Agent-Sitzung in `consent`, die vom Server stammt. Ein kompromittierter Renderer bleibt ein Restrisiko, das per E1 akzeptiert ist. | `lab-host.ts:129-136`, `283-290`; `lab-ipc.ts:28-40`, `78-81` |
| Grant-Bindung | Erfüllt: Owner (`webContentsId`), Haupt-Frame mit `videoRequested`, einmalig (`used`), 15 s, gleiche Sitzung in `consent`. Gelöscht wird er bei accept (`:259`), bei `#end` (`:460`, deckt decline, stop und Ablauf ab) und bei teardown (`:502`, deckt reset, close und closeOwner ab). `accept` verlangt `armed` (`:257`). | `lab-host.ts` |
| Server fälscht Zustimmung oder Signal | Nicht möglich. `accepted` und die Daten sind E2EE, und der Scope geht in HKDF ein (`rendezvous-client.mjs:59`, `108-110`). Setzt der Server die Sitzung fälschlich auf `active`, baut der Viewer nur einen Kanal, und `send` bleibt ohne `ready` gesperrt. Ein falscher publicKey ergibt `mismatch` (`rendezvous-client.mjs:54`). | – |
| `control` | Wird abgelehnt: DELETE ohne Event und ohne Dialog (`lab-host.ts:341`). Der Viewer kann nur `view` senden (zod ohne Scope, `:51`, `:238`), und der Kanal nutzt fest `'view'`. | Test `lab-host.test.ts:228` |
| Lock, Auto-Lock, Owner-Close, Quit | Beenden alles: `reset('locked')` in onLock, AutoLock und `closeAllSessions` (dort auch `will-quit`), `closeOwner` in `closeOwnerSessions` (closed, gone, destroyed, Navigation). `goOnline`, `request`, `armCapture` und `accept` prüfen `isUnlocked()`. | `index.ts:97,102,407,414` |
| `applyProtection` | Hebt den Sperrschutz nie auf (`captureBlocked \|\| remoteSharing`). Ein Sync (`protectWindows(false)`) mitten in einer Freigabe hebt den Schutz ebenfalls nicht mehr auf. Neue Fenster werden geschützt (`index.ts:141`). **Aber:** Beim Ende wird der Schutz aufgehoben, bevor der Renderer seine Tracks stoppt (M2). | `index.ts:75-78` |
| Identität auf Platte | Nur `safeStorage`-Chiffrat (base64), Modus 0600, atomar geschrieben. Eine korrupte oder nicht entschlüsselbare Datei, `version` ungleich 1, zu groß oder ohne Cipher ergibt `identity`. `create()` läuft nur bei `ENOENT`, die Datei wird also nie überschrieben. Ein Schreibfehler beim Anlegen führt zum RAM-Fallback mit `persistent: false`, das korrekt gemeldet wird, und der Dialog zeigt dann `identityTemporary`. Siehe m4 zum Wortlaut. | `identity.ts:87-147` |
| R8 kein Relay | Erfüllt: `iceServers: []` auf beiden Seiten, `checkSdp` für offer und answer, der mDNS-Switch nur ungepackt mit Lab-Flag und zusammengeführt. | `remote-peer.ts:81,198,214`; `index.ts:254-258` |
| R10 keine Freitexte | Erfüllt: Main sendet nur Codes und Daten (Gerätenamen, Server-URL). | – |
| R12 Fake | Erfüllt: Der Fake ist nur aktiv mit `remoteLabHost.enabled` (ungepackt plus Lab-Flag) und `SHELLHERD_REMOTE_CAPTURE_FAKE=1`. `armCapture` und `accept` werden auch im Fake durchlaufen. | `index.ts:137` |
| Secrets | Erfüllt: Das Passwort wird nicht gehalten (Feld wird geleert, nicht im Zustand), Token, privater Schlüssel und publicKey erreichen den Renderer nicht (`#state`, `:522-534`). Die kubeconfig wird nicht berührt. Run-app nutzt nur ein synthetisches Konto. | – |

## 2. Server-Refresh

- **12-h-Grenze:** Korrekt. `refresh` ruft `authorize`, also `expire()`, auf, und `expiresAt` ist durch `min(now+15 min, created+12 h)` gedeckelt. Ab 12 h kommt deshalb 401 (`account-auth.mjs:40`, Test `rendezvous.test.mjs` „refresh stops at the 12 hour limit“).
- **Rate-Limit:** Der Endpunkt liegt hinter dem globalen Zähler (`server.mjs:73-74`). Es gibt keinen Token-Leak, die Antwort ist nur `{ expiresAt }`. Mit Body kommt 400, ohne Token 401.
- **Kompatibilität:** `login()` und `probeSyncServer` sind nur additiv geändert. `server/smoke.mjs` ist nicht betroffen, und `server/Dockerfile` kopiert `account-auth.mjs` und `server.mjs` bereits. `scripts/check-server-container.mjs` ist **nicht gelaufen**, weil Docker pkexec braucht (Ledger). Siehe m9.

## 3. Befunde

### Blocker

**B1: Der Controller ist unter `npm run dev` (React StrictMode) tot.**
- Ort: `src/renderer/src/App.tsx:152-160`, `src/renderer/src/remote-peer.ts:107-112`, `main.tsx:23` (StrictMode).
- Szenario:
  - Im Dev-Modus führt StrictMode den Effekt doppelt aus. Der Cleanup ruft `remote.dispose()` auf, und `disposed = true` ist endgültig.
  - Beim Remount abonniert der Effekt denselben, schon entsorgten Controller. Danach kommen keine IPC-Events mehr an (`unsubscribe` ist gelaufen), und `update()` macht nichts mehr.
  - Folge: Der Dialog bleibt bei jedem `act` auf `idle`, und Zustimmung und Leiste erscheinen nie.
  - Die Szene läuft auf dem Produktions-Build (`driver.mjs:20`, `out/`) und sieht das deshalb nicht. Die Funktion ist aber gerade für ungepackte Dev-Läufe gedacht.
  - Der Fehler kommt aus dem Muster der Validierung K18.
- Fix (Umsetzer 2):
  - Den Controller **im Effekt** anlegen und entsorgen, nicht in `useMemo`, etwa so: `const [remote, setRemote] = useState<RemoteSessionController | null>(null); useEffect(() => { if (!window.desktopApi.remoteLabEnabled) return; const c = new RemoteSessionController(…, crypto.randomUUID(), …); setRemote(c); const off = c.subscribe(setRemoteView); return () => { off(); c.dispose(); setRemote(null); setRemoteView(null); }; }, []);`.
  - Eine neue clientId pro Mount ist unkritisch, weil Main erst beim `connect` bindet.
  - Test in `remote-peer.test.ts`: Nach `dispose()` erreicht ein neu gebauter Controller Events und Updates. Damit ist dokumentiert, dass `dispose` endgültig ist und die App pro Mount neu baut.

### Major

**M1: Der Zustimmungsdialog behält bei einem Sitzungswechsel seinen Zustand, und die 1-s-Sperre und der Fokus auf „Ablehnen“ greifen nicht.**
- Ort: `App.tsx:908-909` (kein `key`), `RemoteConsentDialog.tsx:20-28` (`useEffect(..., [])`, `armed` bleibt `true`).
- Szenario:
  - Anfrage X von Gerät P wartet auf Zustimmung. P bricht ab, und kurz darauf fragt Q an (oder P erneut).
  - Ein Poll in `#onSessions` (`lab-host.ts:338-349`) beendet X und legt Y im selben Durchlauf an. Main sendet zwei `state`-Events direkt hintereinander.
  - React fasst die beiden Updates zusammen, und dieselbe Dialog-Instanz zeigt nun Y. Der Knopf „Bildschirm freigeben“ ist **sofort aktiv**, und der Fokus wurde nicht neu gesetzt.
  - Ein Klick, der für X gedacht war, gibt damit für ein anderes Gerät mit anderem Fingerprint frei. Das unterläuft K16 und den Sinn von R1/R2.
- Fix (Umsetzer 2): `<RemoteConsentDialog key={remoteSession.id} … />` in `App.tsx`. Zusätzlich setzt `RemoteConsentDialog` bei Änderung von `session.id` die Werte `armed=false`, den Timer und den Fokus neu (Effekt-Abhängigkeit `[session.id]`). Da es keine Komponententests gibt, wird das in der Szene geprüft: Nach erneuter Anfrage ist der Knopf in den ersten 1000 ms `disabled`.

**M2: Der Fensterschutz endet, bevor der Renderer die Aufnahme stoppt (R11), und beim Sperren wird er kurz aufgehoben.**
- Ort: `src/main/remote/lab-host.ts:462-463` (`#setSharing(false)` vor dem `ended`-Event), `src/main/index.ts:265-269`, `:407`, `:414`.
- Szenario:
  - Bei Ablauf (`expired`), `bye` des Viewers, `goOffline` oder `stop` hebt Main den Schutz synchron auf (`remoteSharing=false`, dann `applyProtection()`).
  - Die Tracks des Agent-Renderers laufen weiter, bis das `ended`-Event per IPC ankommt und `closeLocal()` läuft. Ist der Renderer beschäftigt, dauert das länger.
  - In diesem Fenster gehen unter Windows und macOS Frames mit ungeschützten Shellherd-Fenstern (Vault, Terminals) an den Viewer.
  - In `onLock` und AutoLock läuft `reset('locked')` **vor** `protectWindows(true)`. Für einen Moment ist der Schutz aus und wird gleich wieder eingeschaltet.
- Fix (Umsetzer 1):
  - In `index.ts` schaltet `onSharingChange(true)` sofort ein und löscht einen eventuell geplanten Abbau.
  - `onSharingChange(false)` setzt den Titel sofort zurück, hebt Schutz und `setBackgroundThrottling` aber erst nach `REMOTE_LAB_LIMITS.byeMs` (2000 ms) auf, und nur, wenn `remoteLabHost?.sharing` dann noch `false` ist.
  - In `onLock` und im AutoLock-`lock` kommt `protectWindows(true)` **vor** `remoteLabHost?.reset('locked')`.
  - In `remote-scene.mjs` wird die Prüfung `after.flags` als `waitFor` mit höchstens 4 s formuliert (heute sofort, `remote-scene.mjs:178-179`). Unter Linux ist das ohne Wirkung, weil der Aufruf dort ein No-op ist; unter Windows und macOS bliebe die Szene sonst rot.

**M3: Eine abgelaufene Anmeldung führt in eine Sackgasse, aus der nur Sperren oder ein Neustart herausführt.**
- Ort: `src/main/remote/lab-host.ts:209-216` (`#goOnline`, catch) und `:238-239` (`#request`).
- Szenario:
  - Angemeldet, aber nicht online: Ohne Präsenzschleife gibt es keinen Refresh, und das Token läuft nach 15 min ab. Dasselbe gilt nach `goOffline` und 15 min Wartezeit.
  - `goOnline` bekommt dann 401 und meldet `authentication`, die Phase bleibt aber `signedIn` mit totem Konto.
  - `signIn` verlangt `serverReady` und antwortet `stale`. `close` sendet nach K2 niemand.
  - Der Nutzer kommt nur durch Sperren des Vaults oder einen Neustart weiter.
- Fix (Umsetzer 1):
  - Bei Status 401 in `#goOnline` und `#request` dasselbe wie `#onOffline('authentication')` (`:362-365`) ohne Event: Konto verwerfen (`logout` best effort, dann `close`), `#user` leeren, `phase: 'serverReady'`, Antwort `{ ok: false, code: 'authentication' }`.
  - Tests in `lab-host.test.ts`: 401 bei `goOnline` führt zu `serverReady`, und ein anschließendes `signIn` ist erlaubt. Dasselbe gilt für `request`.

### Minor

- **m1** `RemoteLabDialog.tsx:102`: Nach dem erneuten Öffnen des Dialogs ist `deviceName` leer, und die Zeile lautet „Online als  · …“. Fix (U2): Der Controller merkt sich den Namen aus dem letzten erfolgreichen `goOnline` (Feld `deviceName?: string` in `RemoteSessionController`, gesetzt in `act`, wenn `command.kind === 'goOnline' && reply.ok`). Der Dialog initialisiert `deviceName` daraus.
- **m2** `RemoteLabDialog.tsx:93`: `role="status"` liegt auf der ganzen Konto-Sektion, samt Formular und Geräteliste. Dadurch wird jede Änderung der Geräteliste (Poll alle 5 s) vorgelesen. Fix (U2): `role="status"` nur auf die Zeilen `signedInAs`/`online` setzen.
- **m3** `remote-peer.ts:75-76`: `share()` schickt `accept` auch dann, wenn der Controller während `capture()` entsorgt wurde. Main geht dann auf `connecting` und `sharing=true`, ohne dass es eine PeerConnection gibt (Schutz und Leiste bleiben bis zum Ablauf). Fix (U2): Nach `capture()` und vor `accept` prüfen, ob `this.disposed`. Wenn ja, Tracks stoppen und `decline` senden.
- **m4** `identity.ts:130-133` mit `remoteLab:identityTemporary`: Ein Schreibfehler beim Anlegen wird korrekt als `persistent:false` gemeldet. Der Text behauptet aber „keine Schlüsselablage des Betriebssystems“. Fix (U2, nur Doku): Im Handbuch (de/en) bei den Grenzen ergänzen: „auch, wenn die Identitätsdatei nicht geschrieben werden kann“. Die Keys bleiben unverändert (§4 der Validierung ist wörtlich).
- **m5** `docs/plans/selfhosted-e2ee.md:14`: „Nachweis: Szene … mit zwei Instanzen“ unterschlägt, dass die Szene ein **Testbild** (Fake-Capture) überträgt. Echtes Capture (Wayland-Portal, Windows `desktopCapturer`) und der Fensterschutz unter Windows und macOS sind ungeprüft (Ledger Z. 50). Fix (U2): diesen Satz ergänzen. Im Handbuch und Manual bei den Grenzen ergänzen: „Unter Windows und macOS ist der Fensterschutz während der Freigabe noch nicht manuell geprüft.“
- **m6** `lab-host.ts:428-431`: Ein 429 in `receive()` (globales Serverlimit 600/min, das mit Sync-Lab und weiteren Geräten geteilt wird) beendet eine laufende Sitzung als `failed`. Fix (U1): Bei Status 429 im `#loopTick` ohne Ende mit dem nächsten Takt weitermachen, solange die Frist läuft. Dazu ein Test.
- **m7** `RemoteShareBar.tsx:185`: Während `connecting` zeigt „seit {{time}}“ bei jedem Render die aktuelle Uhrzeit. Fix (U2): Den Zeitpunkt beim ersten Render per `useState(() => session.startedAt ?? Date.now())` festhalten und `startedAt` bevorzugen, sobald er gesetzt ist.
- **m8** `lab-ipc.ts:33`: `request.frame !== contents.mainFrame` beruht auf der Objektidentität von `WebFrameMain`. Unit-Tests nutzen Mocks, und der Fake-Capture umgeht den Handler. Die Prüfung schlägt sicher zu (im Zweifel kommt `media`), ist aber im echten Pfad nie gelaufen. Fix: keine Codeänderung. Den Punkt in die manuelle Prüfung „echtes Capture“ aufnehmen (U2 im Planstand-Satz aus m5).
- **m9** `scripts/check-server-container.mjs` ist nicht gelaufen. Laut Dockerfile sind alle nötigen Dateien kopiert, also besteht kein Codefehler. Fix: vor einem Merge einmal mit Docker laufen lassen (Lead, keine Umsetzer-Task).

### ACCEPTED (kein Fix)

- **A1** E1: Die Zustimmung bleibt ein Renderer-Klick. Ein kompromittierter Renderer kann `armCapture` und `accept` selbst senden. Das Handbuch nennt die fehlende Sicherheitsfreigabe.
- **A2** K13: `closeAllSessions` meldet auch beim Schließen oder Wechseln des Vaults und beim Beenden `ended/locked`, Text „weil der Vault gesperrt wurde“. Laut Validierung so gewollt.
- **A3** K2: Ein Serverwechsel ist in M1 nicht möglich, weil niemand `close` sendet. Bleibt bei einem falsch, aber gültig eingegebenen Server bis zur Sperre bestehen. M3 behebt nur den Fall der abgelaufenen Anmeldung.

## 4. Weitere Prüfpunkte ohne Befund

- **Host-Automat:**
  - stop, decline oder reset während `await channel.accept()` liefert `stale`, und der Kanal wird geschlossen.
  - Sends laufen seriell (`tail`), und `bye` geht nur bei `pending===0` raus.
  - Die Empfangsschleife läuft nie parallel. Timer werden in `#end` gelöscht (`handles`), und `#capped` löscht sein Timeout ebenfalls.
  - `#exclusive` mit `#gen` verhindert hängende `busy`-Zustände nach einem teardown.
  - Hängende Netzaufrufe sind durch die Transport-Timeouts begrenzt, und Logout erfolgt spätestens nach 2,5 s.
- **Polling-Last:**
  - Pro Online-Gerät etwa 26 Requests/min.
  - Im Aufbau etwa 60 bis 120 Requests/min je Seite für höchstens 60 s, aktiv etwa 12 bis 24 Requests/min.
  - Zwei Geräte im Aufbau zusammen etwa 350/min, also unter 600. Siehe m6 für den 429-Fall.
- **Präsenz:** Ketten ohne Überlappung, 401 führt zu `authentication`, Backoff 5/10/20/20 s mit `connection` nach 60 s, und `stop` ist idempotent ohne späte Handler.
- **Renderer:**
  - Tracks und PeerConnection werden bei `stop`, `ended` und `fail` geschlossen. `gather` löst nach 2 s spätestens auf.
  - Es gibt keine Bewegung (`data-instant`, keine Transition), CSS nur mit Tokens nach dem `sync-lab.css`-Präzedenzfall (design-tokens-Test grün), i18n nur mit vollen Literalen.
  - a11y: `role="alert"` für Fehler, Leiste mit `role="status" aria-live="polite"`, Default-Fokus auf „Ablehnen“.
- **Doku:** Grenzen sind ehrlich genannt (LAN, kein TURN, Linux ohne Fensterschutz, 5 min, temporäre Identität, keine Sicherheitsfreigabe). Ausnahme ist m5. Es gibt keine Änderung an CHANGELOG oder Version (`git diff` leer für `CHANGELOG.md` und `package.json`).

---

## 5. Priorisierte Fix-Liste (zwei Umsetzer, getrennte Dateien, parallel)

Nach beiden Tasks müssen `npm run typecheck` und `npx vitest run` grün sein. Danach führt der Lead die Szene erneut aus, auch auf dem Dev-Server für B1 (`npm run dev` mit `SHELLHERD_SYNC_LAB=1`; Dialog verbinden, Zustand ändert sich).

| Prio | Befund | Umsetzer | Dateien |
|---|---|---|---|
| 1 | B1 Controller-Lebenszyklus | **U2** | `src/renderer/src/App.tsx`, `src/renderer/src/remote-peer.ts`, `src/renderer/src/remote-peer.test.ts` |
| 2 | M1 `key` und Neu-Arming im Zustimmungsdialog | **U2** | `src/renderer/src/App.tsx`, `src/renderer/src/components/RemoteConsentDialog.tsx` |
| 3 | M2 verzögerter Schutzabbau und Lock-Reihenfolge | **U1** | `src/main/index.ts`, `.claude/skills/run-app/remote-scene.mjs` |
| 4 | M3 401 führt zu `serverReady` | **U1** | `src/main/remote/lab-host.ts`, `src/main/remote/lab-host.test.ts` |
| 5 | m6 429 in der Empfangsschleife | **U1** | `src/main/remote/lab-host.ts`, `src/main/remote/lab-host.test.ts` |
| 6 | m3 Dispose während Capture | **U2** | `src/renderer/src/remote-peer.ts`, `src/renderer/src/remote-peer.test.ts` |
| 7 | m1 Gerätename merken, m2 `role="status"` | **U2** | `src/renderer/src/remote-peer.ts`, `src/renderer/src/components/RemoteLabDialog.tsx` |
| 8 | m7 Zeit in der Leiste | **U2** | `src/renderer/src/components/RemoteShareBar.tsx` |
| 9 | m4, m5, m8 Doku | **U2** | `docs/handbuch.md`, `docs/manual.md`, `docs/plans/selfhosted-e2ee.md` |
| – | m9 Container-Check | Lead | – |

**U1 (Main und Szene), exklusiv:** `src/main/index.ts`, `src/main/remote/lab-host.ts`, `src/main/remote/lab-host.test.ts`, `.claude/skills/run-app/remote-scene.mjs`.
**U2 (Renderer und Doku), exklusiv:** `src/renderer/src/App.tsx`, `src/renderer/src/remote-peer.ts`, `src/renderer/src/remote-peer.test.ts`, `src/renderer/src/components/RemoteConsentDialog.tsx`, `src/renderer/src/components/RemoteLabDialog.tsx`, `src/renderer/src/components/RemoteShareBar.tsx`, `docs/handbuch.md`, `docs/manual.md`, `docs/plans/selfhosted-e2ee.md`.

Es gibt keine Vertragsänderung in `src/shared/`, keine neuen i18n-Keys und keine Änderung an Version oder CHANGELOG. Die beiden Tasks haben keine gemeinsamen Dateien und keine Typabhängigkeit.
