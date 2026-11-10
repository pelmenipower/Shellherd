# H5 – Fernansicht-Isolation (Design und Plan)

Stand: 2026-11-10. Branch `claude/feature/remote-isolation`, gestapelt auf `claude/feature/key-epochs` (PR #48), dieser auf #47 und #46.

## 0. Rulings (Lead)

- **R-H5-1 Konzept übernommen:** Ab Abschnitt „Konzept“ ist die Recherche des Konzept-Agenten mit den Entscheidungen D1–D14 aus §9 verbindlicher Teil dieser Spec.
- **R-H5-2 Umfang:** Pflicht sind V5 (Medienfenster) mit V8 und der Neufassung von V9 (Stopp = Fenster zerstören), V6 (RDP-Schutz unter Windows) und die Windows-Paketprüfung in `release.yml`. A11 geht nach H6. Inspect- und asar-Fuses bleiben offene PR-Punkte mit Rezept (§4.2).
- **R-H5-3 R1 zuerst:** T2 prüft vor allem anderen, ob `executeJavaScript(…, true)` für `getDisplayMedia` im versteckten Medienfenster reicht. Reicht es nicht, gilt ohne Rückfrage der Rückfallweg aus §3.9 R1 (`chromeMediaSourceId` vom Main). Das Ergebnis kommt als Ruling ins Ledger.
- **R-H5-4 Lab-Bruch:** erlaubt wie in D12. Server, Rendezvous-Protokoll, Identität und Pins bleiben unverändert. Kein erneutes Einschreiben.
- **R-H5-5:** Kein CHANGELOG, keine Version (Lab-Branch).
- **R-H5-6 Wellen:** wie in §7. Die bindende Validierung kann sie ersetzen.

---

## Konzept

Stand: 2026-11-10. Branch `claude/feature/remote-isolation`, gestapelt auf `claude/feature/key-epochs` (H4, HEAD `7d00a30`). Reines Lesekonzept, kein Code geändert. Bindend bleiben: SEC-01…SEC-12 (`docs/plans/selfhosted-threat-model.md:184-195`), R1…R12 aus `2026-11-07-remote-agent-design.md:25-37`, R-H3-*, R-H31-* und R-H4-* samt Validierungen. Wo dieses Konzept eine ältere Regel ersetzt (R4 „Grant je webContents“, R11 „Schutzende“, K12 „Empfangsbestätigung“), steht das ausdrücklich bei der Entscheidung.

## 0. Kurzurteil

**H5 = „Fremde Medien laufen nie im Vault-Renderer, und Stopp heißt Prozessende.“**

Hinein kommen:

1. **V5 (Pflicht, ★★★):** Fernansicht und Bildschirmaufnahme wandern in ein eigenes `BrowserWindow` mit eigener Partition und eigenem Minimal-Preload. Das Hauptfenster behält Dialog, Prüfcode, Zustimmungsklick und Leiste. Der Host im Main prüft ab jetzt auch den SDP-Inhalt in beiden Richtungen, bevor er ihn weiterreicht.
2. **V8 (klein, ★★):** `armed` im Sitzungszustand sperrt den Knopf sofort; der Systemdialog erscheint frühestens 600 ms nach dem Klick. Beides liegt in Dateien, die V5 ohnehin anfasst.
3. **V6 (Pflicht, ★★, Windows):** Der RDP-Helfer bekommt ein Kommando `protect`, das `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` auf alle Flächen anwendet; `applyProtection` spiegelt den Zustand. Kompiliert in CI (`windows-latest` baut den Helfer mit `csc /warnaserror+`), Laufzeit bleibt manuell.
4. **Release (klein, ★★):** `scripts/check-win-package.mjs` liest die Fuses aus `dist/win-unpacked/Shellherd.exe` und prüft die Ressourcen (`rdp-host`, `hello`). Läuft in `release.yml` ohne GUI.

**Bereits erledigt (H3.1, T3):** V7 (globale Bremse, `lab-host.ts:53-55,531-533,721-727`, Test `lab-host.test.ts:1350`) und V9 (`stopsPending`/`onStopsSettled`, `lab-host.ts:125-129,212-215`, `index.ts:268-293`, Test `lab-host.test.ts:1412`). H5 baut V9 um (Abschnitt 3.6), weil die Empfangsbestätigung mit einem zerstörbaren Fenster überflüssig wird; die Schutzlogik aus `index.ts` wird dabei in ein testbares Modul gezogen.

**Nicht in H5:** A11 (`DeviceSessionClient`, → H6, Abschnitt 4.1), Inspect-/asar-Fuses (brauchen den Windows-Signaturtest des Nutzers, Abschnitt 4.2), `WebContentsView` statt Fenster (Abschnitt 3.1), Eingabekanal oder Audio (bleibt „nur Ansehen“).

Lab-Bruch ist erlaubt (wie R-H31-2): Das IPC-Protokoll zwischen Main und Renderer ändert sich (`accept`, `stopped` entfallen, neue Medienkanäle). Server, Rendezvous-Protokoll, Nachweise, Identitätsdatei und Pins bleiben unverändert. Geräte schreiben sich nicht neu ein.

---

## 1. Bestand und Lücken

| Thema | Bestand (`datei:zeile`) | Lücke |
| --- | --- | --- |
| Wo liegen Schlüssel und Handshake | Noise XX, Pins, Fingerabdruckprüfung, Zustimmung: alles im Main (`lab-host.ts:371-415` Anfrage, `:449-469` Prüfung, `:645-669` Handshake über `RendezvousPeer.channel`, `lab-ipc.ts:89-95` lädt `rendezvous-client.mjs` im Main) | Keine. Der Renderer sieht nur SDP-Teile, Zustandsobjekte und Medien. **V5 muss nichts Kryptografisches verschieben.** |
| Was der Vault-Renderer heute tut | `RTCPeerConnection` für beide Rollen (`remote-peer.ts:12,104,241`), `getDisplayMedia` (`:14`), Decoder und `<video>` (`RemoteLabDialog.tsx:163`), SDP-Prüfung `checkSdp` (`remote-peer.ts:227,259`) | DTLS/SRTP/ICE/Decoder laufen im Prozess mit `desktopApi` (Vault, SSH, Kube). Ein Decoder-Fehler eines geprüften, aber kompromittierten Geräts trifft den Vault-Renderer (V5). |
| SDP-Inhaltsprüfung | Nur im Renderer (`remote-peer.ts:227` eingehend, `:259` ausgehend). Der Host prüft nur Form (`isSignalPart`, `lab-host.ts:498,693`) und Anzahl (`:698`) | Ein kompromittierter Renderer kann `m=application` oder `a=sendrecv` senden; die Gegenseite prüft zwar selbst, aber unser Host reicht Ungeprüftes weiter. |
| Capture-Freigabe | Display-Media-Handler auf `session.defaultSession` (`lab-ipc.ts:107`), Permission-Handler ebenfalls (`index.ts:267`), Grant je `webContentsId` (`lab-host.ts:161-170`), Dialog aus dem Permission-Request heraus (`permissions.ts:181-182` → `requestCapture`) | Der Vault-Renderer kann den Systemdialog jederzeit auslösen (M4-Rest, Threat-Model `:17`). Die Default-Session darf überhaupt Bildschirm aufnehmen. |
| Stopp und Notbremse | `stopped`-Beleg je Sitzung (`lab-host.ts:194-210`), Notbremse crasht und lädt das **Hauptfenster** neu (`lab-ipc.ts:68-71`, `lab-host.ts:729-733`); Handbuch nennt das als Grenze (`handbuch.md`, „Notbremse“) | Die Notbremse kostet alle SSH-/RDP-/SFTP-Sitzungen des Fensters. Der Beleg ist Kooperation des Renderers, kein Beweis. |
| Fensterschutz | `applyProtection` nur für `BrowserWindow`s aus der Registry (`index.ts:76-78`), V9-Ende über `onStopsSettled` und Obergrenze (`:268-293`), nicht getestet (kein `index.test.ts`) | RDP-Helfer-Fenster ohne `SetWindowDisplayAffinity` (`NativeSurface.cs:24-56,58-91`, kein `WDA_` in `native/`). Variante B („Owned“) ist Standard (`rdp/ipc.ts:34-36`): eigenes Top-Level-Fenster, also nicht von Shellherds Schutz gedeckt. |
| Doppelklick | Knopf nach 1 s frei (`RemoteConsentDialog.tsx:197`), `canAccept` ohne Sperre nach dem Klick (`:206-210`); Systemdialog folgt sofort nach `armCapture` + `getDisplayMedia` | Zweiter Klick eines Doppelklicks kann auf „Bildschirm freigeben“ im Systemdialog landen (V8). |
| Fenster-Registry | `WindowRole = 'main' \| 'secondary'` (`windows.ts:214`), `windowAt` zählt alle sichtbaren Einträge als Drop-Ziel (`:273-281`), `resolvePromptTarget` nimmt jedes registrierte Fenster (`index.ts:84`) | Ein weiteres registriertes Fenster würde Tab-Drops und Auth-Prompts empfangen. Das Medienfenster darf **nicht** in die Registry. |
| Build | Eine Renderer-HTML (`src/renderer/index.html`), ein Preload (`electron.vite.config.ts`), CSP als Meta per Plugin (`csp.ts`) | Zweiter HTML-Eintrag und zweiter Preload fehlen. |
| i18n im Renderer | `initialLocale()` liest `window.desktopApi?.initialLocale` mit Optional Chaining (`i18n.ts:15-16`) | Die Medienseite braucht eine zweite Quelle für die Sprache. |
| Szene | `remote-scene.mjs` prüft Video-Pixel im Hauptdialog von B (`:238-247`), Fensterschutz über alle Fenster (`:229-236,255-262`); Treiber kann Fenster wechseln (`driver.mjs:120-121` `windows`/`use`) | Pixelprüfung muss ins Medienfenster, Titelprüfung aufs Hauptfenster; Konsole wird nur für die erste Seite gesammelt. |
| Release-Prüfung | Linux: Fuses aus der Binärdatei (`smoke-linux.mjs:44-46`), Lab-Marker (`:13-21`); Windows: nur Installer-Skripte in CI (`ci.yml:29-36`), keine Paketprüfung in `release.yml` | Windows-Paket wird nie auf Fuses, Ressourcen oder Lab-Marker geprüft. |
| Geräteanmeldung doppelt | Remote `lab-host.ts:239-322`, Sync `sync-prototype/lab-host.ts:85-113,155-300` (seit H4 mit Einladungen und Roster-TOFU) | A11 unverändert; der Sync-Host hat in H4 deutlich mehr Verantwortung bekommen. |

Gut und unverändert: Zustimmungspfad mit Systemdialog im Main, Deny-by-default-Permissions, `sendonly`/`recvonly` (V4), eine Nachricht je Sitzung (V1), früher Beleg (V2), globale Bremse (V7), Pins nur nach authentifiziertem Kanal.

---

## 2. Bewertung je Kandidat

| Kandidat | Wert | Aufwand | Entscheidung |
| --- | --- | --- | --- |
| V5 Medienfenster | ★★★ (schließt die größte verbleibende Angriffsfläche; verkleinert M4-Rest, weil die Default-Session keine Aufnahme mehr bekommt; Notbremse trifft nicht mehr das Hauptfenster) | groß: Main (Host, IPC, Fenster), Preload, Build, Medienseite, Hauptfenster-Renderer, Szene, Doku | **H5 Pflicht** |
| V8 Doppelklick | ★★ (realer Bedienfehler, einfache Abhilfe) | nur Renderer + 1 Timer im Host | **H5**, in V5-Dateien |
| V6 RDP-Flächen | ★★ (echtes Leck unter Windows, sobald Fernzugriff dort läuft) | klein: C# (3 Dateien), `rdp/host.ts`, 1 Aufruf in `index.ts`; Laufzeit nicht in der Pipeline prüfbar | **H5**, mit dokumentiertem manuellen Test |
| V7/V9 | erledigt | – | Nur Umbau durch V5 (3.6) |
| A11 `DeviceSessionClient` | ★ (Wartbarkeit, kein Sicherheitsgewinn) | mittel bis groß, kollidiert dateilich mit V5 (`remote/lab-host.ts`) und mit dem frischen H4-Sync-Host | **nicht jetzt** (H6) |
| Release Windows-Fuse-Prüfung | ★★ (Beleg, dass der Windows-Build die gesetzten Fuses trägt) | klein, kein GUI | **H5** |
| Inspect-/asar-Fuses | ★★ | braucht Signaturtest des Nutzers; Inspect-Fuse bricht die Playwright-Smokes (`electron-builder.yml:64`) | **nur Bewertung** (4.2) |

---

## 3. Entwurf

### 3.1 Medienfenster (D2, D3)

**Ein `BrowserWindow` je Sitzung**, Rolle `viewer` (sichtbar, Titel „Shellherd – Fernansicht von {{name}}“) oder `agent` (`show: false`, Titel „Shellherd – Bildschirmfreigabe“). Kein `WebContentsView`: Das Bild einer Fernansicht gehört ohnehin in ein eigenes, frei skalierbares Fenster (Dameware-Muster), und eine eingebettete View bräuchte Geometrie-Sync wie die RDP-Flächen. Die Aufnahmeseite braucht gar keine Fläche.

`webPreferences`: `preload: out/preload/remote-media.cjs`, `partition: 'remote-media'` (ohne `persist:`, also flüchtig), `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, `devTools: false`, `backgroundThrottling: false`, `additionalArguments: [--shellherd-locale=…, --shellherd-remote-capture-fake=0|1]`. Außerdem `setWindowOpenHandler → deny`, `will-navigate → preventDefault`, `setContentProtection(true)` immer (das Fenster zeigt fremde Bildschirme oder nimmt auf; es gehört nie in eine Aufnahme).

**Nicht in `windowRegistry`.** Dadurch gelten automatisch: `requireMain` lehnt ab, `windowAt`, `resolvePromptTarget`, `announce`, `localeStore.subscribe` ignorieren es. Die Verwaltung liegt in einem eigenen Modul `src/main/remote/media-window.ts`:

```ts
export interface MediaWindows {
  open(input: { role: 'viewer' | 'agent'; title: string }): Promise<number>; // webContents id nach did-finish-load, sonst reject (Timeout mediaReadyMs)
  send(id: number, event: RemoteMediaEvent): void;
  capture(id: number): Promise<boolean>;      // executeJavaScript('globalThis.shellherdRemoteMedia.capture()', true)
  destroy(id: number): void;                  // window.destroy(); idempotent
  sessionOf(webContentsId: number): boolean;  // für den IPC-Absendercheck
  onGone(listener: (id: number, reason: 'closed' | 'crashed') => void): () => void;
}
```

Die Fabrik (`BrowserWindow`, Locale, Preload-Pfad) wird injiziert, damit `media-window.test.ts` mit einem Fake-Fenster läuft.

### 3.2 Minimal-Preload und Medienseite (D3, D14)

`src/preload/remote-media.ts` legt genau das offen:

```ts
contextBridge.exposeInMainWorld('remoteMedia', {
  locale: 'de-DE' | 'en-US',
  captureFake: boolean,
  action: (request: RemoteMediaAction) => ipcRenderer.invoke('remote-media:action', request),
  onEvent: (listener: (event: RemoteMediaEvent) => void) => () => void,
});
```

Kein `desktopApi`, keine Vault-, SSH-, Kube- oder Fenster-IPC.

`src/renderer/remote-media.html` + `src/renderer/src/remote-media/main.ts` (ohne React): `<video autoplay muted playsinline>`, eine Statuszeile (`remoteLab:connecting`, `remoteLab:viewing`), ein Knopf `remoteLab:stop`. Die Peer-Logik (Offer/Answer, `sendonly`/`recvonly`, Gathering mit `gatherMs`) wandert aus `remote-peer.ts:99-118,240-279` nach `remote-media/media-peer.ts` und bleibt mit Fake-`PeerFactory` testbar. `remote-capture-fake.ts` zieht nach `remote-media/` um (gleiches Testmuster, die Szene braucht es). Die Seite registriert `globalThis.shellherdRemoteMedia = { capture }`; `capture()` ruft `getDisplayMedia({ video: true, audio: false })` (oder das Fake-Muster) und liefert `true`/`false`.

Sprache: `i18n.ts:16` liest zusätzlich `window.remoteMedia?.locale`. Damit laufen `t()`-Aufrufe und der Katalogtest unverändert. Styles nur aus `tokens.css` (`remote-media.css`: Stage-Hintergrund `--color-bg-stage`, Abstände `--space-*`, keine Bewegung).

CSP: `contentSecurityPolicy(mode, 'remoteMedia')` liefert `default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self' data:; media-src mediastream: blob:; connect-src 'none'; img-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'` (Dev-Modus wie bisher mit `'unsafe-inline'` und `ws://localhost`). Das Vite-Plugin injiziert je Eintrag die passende Variante (`transformIndexHtml` kennt den Dateinamen).

### 3.3 Vertrauen: Zustimmung bleibt im Hauptfenster, Systemdialog direkt nach `armCapture` (D4, D5)

Die getippte Prüfung und der Klick „Bildschirm freigeben“ bleiben im Hauptfenster: Dort arbeitet der Nutzer, und der Trust-Anker ist ohnehin der Systemdialog im Main, nicht ein Renderer. Ein zusätzliches Zustimmungsfenster wäre nur ein zweiter Renderer ohne Mehrwert.

Neuer Ablauf (Agent):

1. Hauptfenster → `armCapture {sessionId, verification}`. Host prüft wie heute (`lab-host.ts:449-469`), setzt `s.armed = true`, antwortet sofort `ok` (State mit `session.armed: true`).
2. Host wartet `nativeDelayMs = 600` (V8), zeigt dann `confirmCapture` (Systemdialog, Elternfenster = Hauptfenster des Owners, Abbruch über `s.abort` bei `decline`/Ende). Ablehnen → `#mute`, `#end('declined')` wie heute.
3. Angenommen → `s.state = 'granted'`, `s.captured = true`, `media.open({ role: 'agent' })`, dann `media.capture(id)`. Der Display-Media-Handler auf der **Medien-Session** liefert die Quelle nur, wenn `grantedSession(mediaId) === s.id` (Grant hängt jetzt an der Medien-`webContents`, Ersatz für R4).
4. `capture()` → `true`: Host führt den heutigen `#accept` intern aus (`channel`, `accept`, `#establish`), danach `connecting`, `setSharing(true)`, `media.send({ kind: 'accepted' })`. Medienseite erzeugt Offer und schickt Teile über `remote-media:action { kind: 'signal' }`. `capture()` → `false` oder Timeout → `#end('failed')` (Code `media` als Ereignis an den Owner).
5. Permission-Handler auf der Medien-Session sind reine Checks (`captureGranted(mediaId)`). `decidePermissionRequest` ruft **keinen** Dialog mehr auf; `requestCapture` entfällt. Die Default-Session bekommt `remoteLabEnabled: false` → alles verweigert. Damit kann der Vault-Renderer keinen Systemdialog mehr auslösen (M4-Rest schrumpft auf „Medien-Renderer fordert nach Grant eine andere Quelle an“, und dieser Renderer kennt keinen Vault).

Benutzeraktivierung: `getDisplayMedia` braucht eine transiente Aktivierung. `webContents.executeJavaScript(code, true)` erteilt sie (Electron-Doku, `userGesture`). Der Main ist dafür die richtige Instanz: Die Aktivierung folgt dem bestätigten Systemdialog, nicht einem Renderer-Klick. **Risiko R1** (3.9) nennt den Rückfallweg.

Viewer: `request` wie heute; sobald der Kanal steht (`#pollTick`, `lab-host.ts:619-629`), öffnet der Host das sichtbare Medienfenster, leitet das geprüfte Angebot als Ereignis hinein und die Antwort zurück. Die `<video>`-Fläche und der Stopp-Knopf liegen im Medienfenster; der Hauptdialog zeigt `remoteLab:viewerWindow` und `remoteLab:stop`.

### 3.4 SDP-Prüfung im Host, beide Richtungen (D6)

`checkSdp` aus `remote-signal.ts` läuft künftig im Host: Eingehend sammelt der Host die Teile im vorhandenen `s.collector` und emittiert sie **erst nach** vollständiger, geprüfter Nachricht an das Medienfenster (heute `lab-host.ts:699` je Teil). Ausgehend sammelt ein zweiter Collector die Teile der Medienseite, prüft `checkSdp(sdp, s.role === 'agent' ? 'offer' : 'answer')` und sendet dann alle Teile über den Kanal. Fehler → `#end('failed')`. Ein kompromittierter Medien-Renderer kann damit weder einen DataChannel noch `sendrecv` zur Gegenseite bringen. Die Medienseite prüft zusätzlich lokal (Defense in depth, wie heute), aber der Host ist die maßgebliche Stelle.

### 3.5 IPC-Verträge (D5, D12)

`src/shared/remote-lab.ts` (T1 besitzt die Datei, der Wortlaut ist für T2/T3 bindend):

```ts
export type RemoteMediaAction =
  | { kind: 'signal'; part: RemoteSignalPart }   // eigene Offer-/Answer-Teile
  | { kind: 'stop' };                             // Knopf im Fenster
export type RemoteMediaEvent =
  | { kind: 'hello'; role: 'viewer' | 'agent'; peerName: string; expiresAt: number }
  | { kind: 'accepted' }                          // Agent: Offer jetzt erzeugen
  | { kind: 'signal'; part: RemoteSignalPart };   // geprüfte Teile der Gegenseite
export interface RemoteLabSession { …; armed?: true }  // Konsent gerüstet, Systemdialog folgt
export const REMOTE_LAB_LIMITS = { …, nativeDelayMs: 600, mediaReadyMs: 5000 };
```

`RemoteLabCommand` verliert `accept`, `stopped` und `signal`: Signalteile kommen ausschließlich vom Medienfenster. Es bleiben `status`, `close`, `connect`, `signIn`, `openSession`, `goOnline`, `goOffline`, `request`, `armCapture`, `decline`, `stop`. `RemoteLabEvent` behält `state`, `ended`, `error`; `signal` entfällt für das Hauptfenster.

`src/shared/ipc.ts`: `remoteMediaAction: 'remote-media:action'`, `remoteMediaEvent: 'remote-media:event'`, Typ `RemoteMediaApi`. `DesktopApi` verliert `remoteCaptureFake` (gehört jetzt zum Medienfenster).

Absendercheck in `lab-ipc.ts`: `ipcMain.handle(remoteMediaAction)` verlangt `event.senderFrame === event.sender.mainFrame` und `media.sessionOf(event.sender.id)`; der Host bindet die Aktion über `s.media.id === event.sender.id`, sonst `stale`. Keine Sitzungs-ID im Argument nötig, keine Geheimnisse in Prozessargumenten (SEC-08).

### 3.6 Stopp = Fenster zerstören (D7, ersetzt K12-Beleg, V2-Beleg und V9-Timer)

`#end(s, reason)` ruft synchron `media.destroy(s.media.id)`. Damit enden Aufnahme-Tracks, Encoder, Decoder, DTLS und ICE mit dem Prozess, ohne Kooperation des Renderers. Es gibt keinen `stopped`-Beleg, keine `#pendingStops`, keine Notbremse mit Reload des Hauptfensters mehr; `emergencyReload` (`lab-ipc.ts:68-71`) entfällt. SEC-07 („Stoppen wirkt am Quellgerät sofort“) wird stärker erfüllt als heute.

Schutzende (V9 neu): `remoteSharing` fällt erst, wenn `sharing === false` **und** kein Medienfenster mit Rolle `agent` mehr lebt. `media-window.ts` meldet `destroyed` je Fenster; `sharing-protection.ts` (neues, Electron-freies Modul mit Test) hält den Zustand `{ captureBlocked, remoteSharing, agentWindowsAlive }` und liefert `protect: boolean`. Die Obergrenze (`byeMs + 1000`) bleibt als Fail-safe, falls `destroyed` ausbleibt.

Unerwartetes Fensterende: `onGone(id, 'closed')` bei Viewer → `#end(s, 'stopped')` (Nutzer hat das Fenster geschlossen); `'crashed'` oder `agent` → `#end(s, 'failed')`. Hauptfenster schließt/navigiert/crasht → `closeOwner` → `#teardown` → alle Medienfenster zerstört (R6 bleibt).

`grantedSession`, `captureGranted`, `isGranted` arbeiten mit der Medien-`webContents`-ID. `s.acked` und die V2-Logik entfallen; der zugehörige Test (`lab-host.test.ts:1325`) wird durch „destroy wird genau einmal gerufen, auch bei Ende vor Kanalaufbau“ ersetzt.

### 3.7 V8 (D8)

- Renderer: `RemoteConsentDialog` deaktiviert „Bildschirm freigeben“ sobald `session.armed === true` und zeigt `remoteLab:consent.armedHint`. `useNativeSurfaceBlock(true)` bleibt.
- Host: Systemdialog frühestens `nativeDelayMs` nach `armCapture` (3.3 Schritt 2), mit Fake-Timer testbar: „Dialog nicht vor 600 ms, danach genau einmal; `decline` in der Wartezeit zeigt keinen Dialog“.
- `defaultId: 0`/`cancelId: 0` („Ablehnen“) bleibt (`lab-ipc.ts:59`).

### 3.8 V6 Windows-RDP-Flächen (D9)

Helfer (`native/Shellherd.RdpHost`):

- `Native.cs`-Teil in `NativeSurface.cs`: `[DllImport("user32.dll", SetLastError = true)] static extern bool SetWindowDisplayAffinity(IntPtr hwnd, uint affinity);` mit `WDA_NONE = 0x0`, `WDA_MONITOR = 0x1`, `WDA_EXCLUDEFROMCAPTURE = 0x11`.
- `RdpSession.ApplyProtection(bool on)`: nur in `SurfaceMode.Owned` und `Window` (Top-Level-HWND). In `Child` ist die Fläche Teil von Shellherds Top-Level-Fenster, dessen Affinität Electron setzt; dort kein Aufruf. Reihenfolge: `WDA_EXCLUDEFROMCAPTURE`, bei Fehlschlag (Windows vor 2004) `WDA_MONITOR`, bei `off` `WDA_NONE`. Ergebnis als `Status("protected", …)`-Zeile zurück, damit der Main es protokollieren kann (nur im Debug-Log).
- `Program.cs`: Kommando `{"type":"protect","protect":true|false}` ohne `sessionId`, setzt ein globales Flag und wendet es auf alle offenen Sitzungen an; `Open` und `Reparent` wenden das Flag auf die neue/umgehängte Fläche an.
- `Protocol.Version` bleibt 1 (abwärtskompatibel: unbekannte Typen enden heute mit Fehlerzeile `unknown type`? → Prüfen in T4; falls der Helfer auf unbekannte Typen mit `error` antwortet, muss der Main die `error`-Zeile ohne `sessionId` weiterhin nur loggen, `host.ts:200-203` tut das).

Main (`src/main/rdp/host.ts`): `protect(on: boolean)`: merkt `this.protected = on`; läuft der Helfer, `send({ type: 'protect', protect: on })`; `ensureHelper()` schickt beim Start `protect` vor allem anderen, wenn `protected === true`; `open()` schickt nichts Zusätzliches (der Helfer wendet das Flag selbst an). `index.ts:76-78` `applyProtection` ruft zusätzlich `rdpSessionManager.protect(captureBlocked || remoteSharing)`.

Testbar ohne Windows: `host.test.ts` (Fake-`spawn`, vorhanden `:7-12`) prüft „protect vor open beim Helferstart“, „protect(true/false) sendet genau eine Zeile“, „protect ohne Helfer startet ihn nicht“. CI `windows-latest` kompiliert den Helfer (`ci.yml:38` → `npm run build` → `build:rdp-host`, `/warnaserror+`). Laufzeit: Handbuch bekommt einen Abschnitt „Manuell prüfen (Windows)“: RDP-Tab öffnen, Bildschirm freigeben, am Viewer muss die RDP-Fläche fehlen; alternativ Snipping Tool/OBS während `captureBlocked` (gesperrter Vault). Threat-Model führt „V6: implementiert, Laufzeit ungeprüft“ bis zum Test.

Verworfen: RDP-Flächen während der Freigabe verbergen (`visible:false`). Das nähme dem Nutzer die eigene Sitzung, obwohl er sie weiter bedienen will; der Schutz soll die Aufnahme ausnehmen, nicht die Anzeige.

### 3.9 Risiken und Rückfallwege

- **R1 `executeJavaScript(userGesture)` reicht nicht für `getDisplayMedia`.** Rückfall ohne Architekturänderung: Main ermittelt die Quelle (`desktopCapturer.getSources`) und schickt `chromeMediaSourceId` im `capture()`-Aufruf; die Medienseite nutzt `getUserMedia({ video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId } } })`, das keine Aktivierung braucht und über den Permission-Request-Handler (`isScreenCapture` `kind:'request'`, `permissions.ts:156`) läuft. Der Grant bleibt an der Medien-`webContents`. T2 prüft den Hauptweg als Erstes (Linux-Szene, Fake-Modus und echter Modus mit `SHELLHERD_REMOTE_CAPTURE_FAKE=0` auf X11).
- **R2 Verstecktes Fenster und Wayland-Portal.** Unter Wayland löst `desktopCapturer.getSources` den Portal-Dialog aus; heute ungeprüft, bleibt ungeprüft (Handbuch sagt das).
- **R3 `partition` und `setDisplayMediaRequestHandler`.** Der Handler muss auf `session.fromPartition('remote-media')` sitzen, nicht auf `defaultSession`. Die Permission-Handler für die Default-Session müssen verweigern. `registerPermissionHandlers` registriert heute auch `app.on('web-contents-created')` (`permissions.ts:203`); das wird in `registerGlobalDeviceGuards()` herausgelöst, damit zwei Sessions keinen doppelten App-Hook erzeugen.
- **R4 Treiber/Szene.** Playwright sieht alle Fenster (`app.windows()`); die Szene wechselt mit `use?i=` auf das Fenster mit URL `remote-media.html`. Die Konsolen-Sammlung des Treibers muss `app.on('window')` abonnieren, sonst fehlt der CSP-Check für das Medienfenster.
- **R5 Bundle.** `remote-media.html` zieht `i18n.ts` und damit `react-i18next` mit. Akzeptiert: Ziel ist Isolation von IPC und Vault, nicht Bundle-Größe. Alternative (eigene Mini-`t()`) würde den Katalogtest umgehen und ist verworfen.
- **R6 Hidden Window und `getDisplayMedia` liefert 0×0.** In Fake-Modus irrelevant; im echten Modus liefert der Handler die Bildschirmquelle unabhängig vom Fenster. Falls Chromium für unsichtbare Fenster drosselt: `backgroundThrottling: false` ist gesetzt; `show: true` mit `setBounds` außerhalb des Bildschirms ist der Rückfall (nicht bevorzugt).

### 3.10 Was ausdrücklich nicht getan wird

- Kein Eingabekanal, kein Audio, kein DataChannel. `checkSdp` bleibt streng (eine `m=video`, Richtung exakt).
- Keine Verlagerung von Noise, Pins, Fingerabdruckprüfung oder Zustimmung in das Medienfenster. Es sieht nur SDP, ICE-Kandidaten und Bild.
- Kein `desktopApi` im Medienfenster, keine gemeinsame Partition mit dem Hauptfenster.
- Keine Registrierung des Medienfensters in `windowRegistry`, kein Tab-Drop, kein Auth-Prompt dorthin.
- Keine Server-, Protokoll- oder Identitätsänderung. `RendezvousPeer`, Nachweise, Roster bleiben.
- Keine Änderung an Default-Fuses außer der Prüfung; kein `enableNodeCliInspectArguments: false` (bricht Playwright-Smokes), kein asar-Fuse ohne Signaturtest.
- Keine Bewegung in der Medienseite, keine festen Farben außer dem bestehenden Testmuster (`remote-capture-fake.ts`, bereits als Ausnahme kommentiert).
- Kein A11-Umbau.

---

## 4. Bewertungen ohne Umsetzung

### 4.1 A11 `DeviceSessionClient` (D10: nicht jetzt)

Nutzen: Eine Zustandsmaschine für Probe, Einschreibung (Passwort und seit H4 Anmeldecode), `openSession` mit B6, `enrolledElsewhere`, Fehlerabbildung. Jede Härtung müsste nur einmal erfolgen.

Risiko jetzt: Beide Hosts haben große, grüne Testsuiten (`remote/lab-host.test.ts` 1477 Zeilen, Sync-Tests), die auf ihren heutigen Signaturen stehen. Der Sync-Host hat in H4 Einladungen, Roster-TOFU und Rotation dazubekommen und ist noch frisch; der Remote-Host wird in H5 durch V5 umgebaut. Ein gleichzeitiger Zusammenzug beider bedeutet zwei Refaktorierungen in derselben Datei (`remote/lab-host.ts`) in einem Branch und ohne Sicherheitsgewinn.

Empfehlung: **H6**, nach Abschluss und Review von H5. Dann als `src/main/remote/device-session.ts`:

```ts
export class DeviceSessionClient {
  constructor(deps: { probe; createAccount; identity(): RemoteIdentityStore; now(): number });
  connect(url, privateNetwork): Promise<{ info; enrolled?; enrolledElsewhere? } | Failure>;
  enroll(input: { username; password; name } | { inviteCode; name }, confirmElsewhere?: true): Promise<Account | Failure>;
  open(): Promise<Account | Failure>;   // 1× Retry bei 401, 2. 401 → forgetEnrollment (B6)
}
```

Die bewusste Abweichung „gesperrter Vault: Sync prüft nicht, Remote verweigert (A8)“ bleibt als Parameter (`requireUnlocked`). Für H5 wird in der Spec nur festgehalten, dass die H5-Änderungen am Remote-Host den Anmeldeteil (`#connect`, `#signIn`, `#openSession`) nicht anfassen, damit H6 eine stabile Basis hat.

### 4.2 Fuses (D11)

- `EnableNodeOptionsEnvironmentVariable: false` beidseitig, `RunAsNode: false` nur Linux (node-pty-ConPTY-Fork, Validierung H3.1 `:20`). Windows-Prüfung fehlt → `check-win-package.mjs` (4.3).
- `EnableNodeCliInspectArguments: false`: Playwright (`_electron.launch`) startet Electron mit `--inspect=0`; die gepackten Linux-Smokes (`smoke-linux.mjs`, `toolbar-smoke.mjs`) würden brechen. Erst, wenn die Smokes auf einen anderen Startweg umgestellt sind. Offen lassen.
- `EnableEmbeddedAsarIntegrityValidation`, `OnlyLoadAppFromAsar`: Nur mit Windows-Signaturtest durch den Nutzer (R-H31-6). Rezept für den Nutzer: `npm run dist:win` lokal mit beiden Fuses in `linux-after-pack.cjs` aktiviert, Setup installieren, Start prüfen, eine Datei in `resources/app.asar` ändern und erwarten, dass der Start verweigert wird; danach signieren und erneut starten. Bis dahin bleibt es ein PR-Punkt.

### 4.3 Release-Prüfung Windows (D11)

`scripts/check-win-package.mjs` (kein GUI, läuft in `release.yml` nach `dist:win`):

- `getCurrentFuseWire('dist/win-unpacked/Shellherd.exe')`: `EnableNodeOptionsEnvironmentVariable === DISABLE`, `RunAsNode === ENABLE` (ausdrücklich, mit Kommentar node-pty), `EnableNodeCliInspectArguments === ENABLE` (ausdrücklich offen).
- Ressourcen vorhanden: `resources/rdp-host/Shellherd.RdpHost.exe`, `resources/hello/**`, `resources/icon.ico`.
- Lab-Marker nicht in `resources/app.asar` (Marker wie `smoke-linux.mjs:18`; `asar` liest über `@electron/asar` aus den devDependencies oder einfacher: vor dem Packen `out/main` prüfen, wie die Linux-Smoke es tut, da `dist:win` denselben `out/` nutzt).
- `release.yml`: Schritt `if: runner.os == 'Windows'` → `node scripts/check-win-package.mjs`. Der Linux-Zweig bleibt.

---

## 5. Texte (de-DE; en-US analog, T7 legt alle an)

`src/shared/locales/de-DE/main.json` → `window`:
- `remoteViewer`: „Shellherd – Fernansicht von {{name}}“
- `remoteAgent`: „Shellherd – Bildschirmfreigabe“

`src/shared/locales/de-DE/remoteLab.json`:
- `viewerWindow`: „Das Bild erscheint in einem eigenen Fenster „Fernansicht“. Es hat keinen Zugriff auf deinen Vault; Schließen beendet die Verbindung.“
- `consent.armedHint`: „Der Systemdialog erscheint gleich. Bestätige dort noch einmal.“
- `consent.windowsHint`: „Unter Windows bleiben Shellherd-Fenster und RDP-Flächen aus dem Bild ausgenommen.“ (ersetzt für Windows den bisherigen Linux-Hinweis, der bleibt)
- `errors.media` bleibt; neuer Code `mediaWindow`: „Das Fenster für die Fernansicht konnte nicht geöffnet werden.“

Wiederverwendet in der Medienseite: `remoteLab:connecting`, `remoteLab:viewing`, `remoteLab:stop`, `remoteLab:bar.viewing` entfällt dort (Leiste bleibt im Hauptfenster).

Handbuch `docs/handbuch.md` (Abschnitt „Fernzugriff (Entwicklung)“): Schritt 5 ergänzen („Das Bild erscheint in einem eigenen Fenster „Fernansicht“ …“), Grenze „Notbremse“ ersetzen durch „Beenden schließt das Fenster der Fernansicht bzw. der Freigabe sofort; dein Hauptfenster bleibt unberührt“, Grenze „Windows und macOS ungeprüft“ um V6 ergänzen, Abschnitt „Manuell prüfen (Windows)“. `docs/manual.md` spiegeln. Threat-Model: Abschnitt „Stand H5“ mit V5 (behoben), V6 (implementiert, Laufzeit ungeprüft), V8, M4-Rest neu formuliert, A11/Fuses offen.

---

## 6. Testideen

- `lab-host.test.ts` (Fake-`media`): Agent-Ablauf armCapture → (600 ms) Dialog → granted → open → capture → accept → accepted-Ereignis → Offer-Teile → checkSdp → Relay; `decline` während der Wartezeit zeigt keinen Dialog; `capture=false` endet mit `failed` und `destroy`; Viewer-Ablauf mit Angebot erst nach vollständiger geprüfter Nachricht; ausgehendes `a=sendrecv` oder `m=application` endet die Sitzung vor dem Senden; Fensterende (`onGone`) → `stopped`/`failed`; `#end` ruft `destroy` genau einmal; `closeOwner` zerstört alle Fenster; Grant hängt an Medien-ID (Hauptfenster-ID bekommt nie eine Quelle).
- `media-window.test.ts` (Fake-`BrowserWindow`): Partition, Preload, `sandbox`, `contextIsolation`, `devTools: false`, `setContentProtection(true)`, `show` je Rolle, Timeout `mediaReadyMs`, `onGone` bei `closed`/`render-process-gone`, `capture` ruft `executeJavaScript(…, true)`.
- `lab-ipc.test.ts`: Display-Media-Handler nur auf der Medien-Session; Default-Session verweigert; `remote-media:action` lehnt fremde `webContents` und Subframes ab.
- `permissions.test.ts`: Request-Handler zeigt keinen Dialog mehr; `registerGlobalDeviceGuards` einmalig.
- `sharing-protection.test.ts`: Schutz an bei `sharing`, aus erst bei `sharing=false && agentWindowsAlive=0`, Obergrenze.
- `media-peer.test.ts`: aus `remote-peer.test.ts:106-240,306-340` übernommen (sendonly, recvonly, gather-Timeout, Offer genau einmal).
- `remote-peer.test.ts` (Hauptfenster): nur noch State-Controller, `armCapture` ohne Capture, `armed` sperrt.
- `host.test.ts` (RDP): `protect`-Zeilen wie 3.8.
- `csp.test.ts`: Medien-CSP ohne `connect-src 'self'`, ohne `img-src`, mit `media-src mediastream: blob:`.
- `RemoteLabDialog.test.ts`/Consent: kein `<video>` mehr; `armed` → Knopf disabled, Hinweis sichtbar.
- Szene `remote-scene.mjs` (Linux): nach Zustimmung muss auf B ein Fenster `remote-media.html` existieren; Pixelprüfung dort; Hauptfenster-Titel auf A geprüft (Index per URL); alle Fenster `isContentProtected()` außerhalb Linux; nach Beenden existiert kein `remote-media.html`-Fenster mehr und der Schutz ist innerhalb 4 s weg; CSP-Konsole für alle Fenster leer; `remote-viewer.png` aus dem Medienfenster.
- CI: `windows-latest` kompiliert den Helfer; `release.yml` ruft `check-win-package.mjs`.

---

## 7. Zerlegung in Tasks und Wellen (dateidisjunkt)

Jede Task besitzt nur ihre Dateien; Tests daneben gehören dazu. Welle 1 ist erst mit T1+T2+T3 zusammen typecheck-grün (gemeinsamer Vertrag aus 3.5, wörtlich in der Spec), wie bei H3/H4 üblich.

### Welle 1 (parallel)

- **T1 Host-Zustandsmaschine (Main, Electron-frei):** `src/main/remote/lab-host.ts`, `lab-host.test.ts`, `src/shared/remote-lab.ts` (Verträge 3.5, `armed`, Limits), ggf. `src/shared/remote-signal.ts` (nur falls ein Export fehlt). Inhalt: 3.3 (Host-seitig), 3.4, 3.6, 3.7 (Timer), Entfernen von `accept`/`stopped`/`pendingStops`/`acked`/`emergency`, neue `media`-Deps, `mediaGone(id, reason)`. Anmeldeteil (`#connect`, `#signIn`, `#openSession`) bleibt unberührt (4.1).
- **T2 Medienfenster, Preload, Build (Main/Electron):** `src/main/remote/media-window.ts` (+ Test), `src/preload/remote-media.ts`, `electron.vite.config.ts` (zweiter Preload-Eintrag, zweiter Renderer-Input, CSP je Datei), `src/renderer/remote-media.html`, `src/renderer/csp.ts` (+ `csp.test.ts`), `src/shared/ipc.ts` (Kanäle, `RemoteMediaApi`, `remoteCaptureFake` aus `DesktopApi` entfernen). Erster Schritt: R1 prüfen (3.9) und das Ergebnis im Report nennen.
- **T3 Medienseite (Renderer, ohne React):** `src/renderer/src/remote-media/main.ts`, `media-peer.ts` (+ Test), `remote-media.css`, `remote-media/api.d.ts` (`window.remoteMedia`), Umzug `remote-capture-fake.ts` → `remote-media/capture-fake.ts`, `src/renderer/src/i18n.ts` (eine Zeile: Locale aus `remoteMedia`). Keine neuen Texte anlegen (T7), nur die in Abschnitt 5 genannten Keys verwenden.
- **T4 RDP-Schutz (V6):** `native/Shellherd.RdpHost/NativeSurface.cs`, `RdpSession.cs`, `Program.cs`, `src/main/rdp/host.ts`, `host.test.ts`. Der Aufruf aus `index.ts` kommt in T6.
- **T5 Release:** `scripts/check-win-package.mjs`, `.github/workflows/release.yml`, Kommentar in `electron-builder.yml` (Zeile 63-64: Stand der Fuses aktualisieren).

### Welle 2 (parallel, braucht Welle 1)

- **T6 Verdrahtung Main:** `src/main/remote/lab-ipc.ts` (+ Test: Medien-Session, Absendercheck, Dialog nur noch aus dem Host), `src/main/permissions.ts` (+ Test), `src/main/remote/sharing-protection.ts` (+ Test), `src/main/index.ts` (applyProtection inkl. `rdp.protect` und Medienfenster, Schutzende über `sharing-protection`, Entfernen von `emergency`/`unprotectTimer`-Logik), `src/main/labs.ts`.
- **T7 Hauptfenster-Renderer und Texte:** `src/renderer/src/remote-peer.ts` (+ Test; nur noch Zustand und Kommandos), `components/RemoteLabDialog.tsx` (+ Test; kein `<video>`, Hinweis `viewerWindow`), `components/RemoteConsentDialog.tsx` (`armed`), `components/RemoteShareBar.tsx` (unverändert oder Stopp-Text), `App.tsx` (keine `browserPeers`/`displayCapture`/`fakeCapture`), `remote-lab.css`, `remote-lab.ts` (neuer Fehlercode `mediaWindow`), **alle Locale-Dateien** `src/shared/locales/*` (Abschnitt 5; T1–T6 melden weitere Keys im Report).

### Welle 3

- **T8 Szene, Treiber, Doku:** `.claude/skills/run-app/remote-scene.mjs`, `driver.mjs` (Konsole aller Fenster), `SKILL.md`, `docs/handbuch.md`, `docs/manual.md`, `docs/plans/selfhosted-threat-model.md` („Stand H5“), `README`-Stellen zum Fernzugriff falls vorhanden.

Nach jeder Welle `npm run typecheck` und `npx vitest run` grün, je Task ein Commit. Am Ende zusätzlich `remote-scene.mjs` unter Linux (Fake-Capture) und einmal mit echtem Capture auf X11 (`SHELLHERD_REMOTE_CAPTURE_FAKE=0`, manuell, Ergebnis im PR).

---

## 8. Minimale erste Stufe gegenüber Extras

**Minimal (muss):** T1, T2, T3, T6, T7, T8 (V5 mit V8 und der V9-Neufassung). Ohne T8 ist die Szene rot, also kein Abtrennen.

**Extras (abtrennbar, je ein Commit):** T4 (V6) und T5 (Release-Prüfung). Beide sind dateilich disjunkt und können bei Zeitnot in einen Folge-PR, ohne dass V5 davon abhängt. Der Aufruf `rdp.protect` in T6 ist dann ein no-op, bis T4 da ist (Methode existiert mit leerem Rumpf) – besser: T4 bleibt in Welle 1, weil es klein ist.

**Verschoben:** A11 (H6), Inspect-/asar-Fuses (PR-Punkt mit Rezept 4.2), Wayland/Windows-Capture-Laufzeittest (manuell, Handbuch).

---

## 9. Entscheidungen

- **D1 Umfang:** V5, V8, V6 und die Windows-Paketprüfung kommen in H5. V7 und V9 sind seit H3.1 umgesetzt; V9 wird durch D7 ersetzt. A11 und die restlichen Fuses nicht.
- **D2 Medienfenster:** Ein `BrowserWindow` je Sitzung (Viewer sichtbar, Agent versteckt), kein `WebContentsView`. Nicht in `windowRegistry`; eigene Verwaltung in `media-window.ts`. Immer `setContentProtection(true)`.
- **D3 Partition und Preload:** Partition `remote-media` (flüchtig), Preload `remote-media.cjs` mit genau `locale`, `captureFake`, `action`, `onEvent`. Display-Media- und Permission-Handler nur auf dieser Session; die Default-Session verweigert jede Aufnahme.
- **D4 Zustimmung:** Prüfcode und Klick bleiben im Hauptfenster. Der Systemdialog läuft im Host direkt nach `armCapture`, nicht mehr aus dem Permission-Request; Permission-Handler sind reine Checks. Grant hängt an der Medien-`webContents` (ersetzt R4).
- **D5 Capture-Auslösung:** Main ruft `executeJavaScript('globalThis.shellherdRemoteMedia.capture()', true)`. Rückfall: `getUserMedia` mit `chromeMediaSourceId` vom Main (R1).
- **D6 SDP-Prüfung:** `checkSdp` läuft im Host für beide Richtungen vor dem Relay; Teile werden erst nach vollständiger, geprüfter Nachricht weitergereicht.
- **D7 Stopp:** `#end` zerstört das Medienfenster synchron. `stopped`-Beleg, `pendingStops`, Notbremse und Reload des Hauptfensters entfallen. Schutzende, wenn kein Agent-Medienfenster mehr lebt (Ereignis `destroyed`), Obergrenze bleibt. Ersetzt K12, V2 und V9.
- **D8 V8:** `session.armed` sperrt den Knopf sofort; Systemdialog frühestens `nativeDelayMs = 600` nach dem Klick; `decline` in der Wartezeit zeigt keinen Dialog.
- **D9 V6:** Helfer-Kommando `protect` (global), `WDA_EXCLUDEFROMCAPTURE` mit Fallback `WDA_MONITOR`, nur Owned/Window; `RdpSessionManager.protect` spiegelt den Zustand und sendet ihn beim Helferstart; Unit-Tests mit Fake-Helfer; CI kompiliert; Laufzeit manuell mit Rezept im Handbuch.
- **D10 A11:** nicht in H5. H5 lässt den Anmeldeteil des Remote-Hosts unverändert, damit H6 beide Hosts zusammenführen kann.
- **D11 Release:** `check-win-package.mjs` prüft Fuses (`NODE_OPTIONS` aus, `RunAsNode` ausdrücklich an, Inspect ausdrücklich an) und Ressourcen. Inspect-/asar-Fuses bleiben offene PR-Punkte mit Rezept.
- **D12 Lab-Bruch:** erlaubt; nur das Main↔Renderer-Protokoll ändert sich. Server, Rendezvous, Identität, Pins unverändert.
- **D13 Szene:** Pixelprüfung und Screenshot im Medienfenster von B; Titelprüfung am Hauptfenster von A; Treiber sammelt Konsolen aller Fenster.
- **D14 Design:** Medienseite ohne React, Styles nur aus `tokens.css`, keine Bewegung, Texte nur über `t()`.
