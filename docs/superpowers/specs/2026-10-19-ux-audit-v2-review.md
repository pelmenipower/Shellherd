# UX-Audit v2 – Review nach dem Code (Stufe 5)

Stand: 2026-10-19 · Branch `claude/feature/ux-audit-v2` · `git diff main...HEAD` (16 Commits, `f1a1649` bis `b967d49`).
Grundlage: [Validierung](2026-10-19-ux-audit-v2-validation.md) (bindend), [Spec](2026-10-19-ux-audit-v2-design.md), [Prototyp](../design/2026-10-19-ux-audit-v2.html), `CLAUDE.md`, `docs/design-system.md`, Ledger `.superpowers/sdd/2026-10-19-ux-audit-v2/progress.md`.

Gate: `npm run typecheck` grün. `npx vitest run --exclude '.claude/**'` grün mit 95 Dateien und 1447 Tests. Die Basiszahl der Validierung (176/2496) enthielt den fremden Arbeitsbaum unter `.claude/worktrees/`.

**Urteil: mergebereit nach Fix-Welle.** 0 Critical, 2 Important, 9 Minor.

---

## 1. Sicherheit

Alle Punkte aus Validierung Abschnitt 4 sind eingehalten. Kein Befund.

| Punkt | Beleg |
|---|---|
| Schritt-Events an den Besitzer gebunden | `main/ssh/session.ts` `step()` sendet nur über `dependencies.emit(session.ownerId, …)` und nur bei `active(session)`. Es gibt keinen neuen Kanal. Nach `transferOwner` gehen die Events an den neuen Besitzer. |
| `code`/`detail` | `classifyError` setzt `detail = error.message.slice(0, DETAIL_LIMIT)` nur für Fremdfehler. Eigene Fehler (`LocalShellError`, `ContainerInputError`, `AgentError`, `HostKeyError` `store`) haben kein `detail`. Kein `stack`, kein `config`, kein `toString`. Kube-Terminal-Fehler werden in `LocalShellError` gekapselt (`session.ts:414`), dadurch gelangen kubeconfig-Fehlertexte nicht in `detail`. Tests: Länge 500 und `wrong-synthetic-secret` taucht in keinem Event auf (`session.test.ts:703`). |
| Fingerprints | Sie stehen nur in `detail` (`erwartet …\nerhalten …`). `known-hosts.ts` nimmt sie nicht in `message` auf. Test `failure.message` enthält kein `SHA256`. Der Kube-Pfad (`access.ts` `reason`) bleibt ohne sie. |
| Abbrechen | `TerminalPanel.cancel` ruft nur `sshClose`. Abbruch vor der Session-ID (K9): Nach `sshPrepare` folgt sofort `sshClose` (`TerminalPanel.tsx:198`), eine Session bleibt nicht verwaist. |
| Neu verbinden | `reconnect()` setzt `adoptRef.current = undefined` und erhöht `attempt`. Der Effekt holt mit `sshPrepare` und `sshConnect` eine neue ID. `sshAttach` wird nicht wiederholt. Dasselbe gilt in `RdpPanel` und `FilesPanel`. |
| Kube-Status | `attempt` ist eine Zahl, `trying` ist `connection.name` einer Vault-SSH-Verbindung (`session.ts` `establish`). Es werden keine kubeconfig-Inhalte, kein Server und kein Kontext übertragen. |
| Vault-Schreibfehler | `main/vault/ipc.ts` wirft nur feste Sätze aus `write-errors.ts`, ohne Pfad. Der Renderer reicht nur Texte durch, die `isVaultWriteMessage` erkennt. Alles andere wird zum Sammeltext. |
| edit-request | Der Bus ist modul-lokal und ohne IPC. `editNode` öffnet über `navigateEditor` nur den Editor, gespeichert wird erst per Klick. Im Nebenfenster gibt es keinen Handler, die Aktion entfällt dort. |
| B9 | `vaultRef.current === previousVault` steht vor dem Retry, sonst kommt `notify.info('Nicht erneut gespeichert', …)`. Das ist wörtlich wie in der Validierung (`App.tsx:484`). |
| Zwischenablage | „Fingerprint kopieren“ schreibt nur über `writeClipboardText(detail)`. |

---

## 2. Issues

### Critical

Keine.

### Important

**I1 – Die Getrennt-Leiste verdeckt die letzten Terminalzeilen (Ledger M5).**
`src/renderer/src/components/connection-ui.css:30`, `src/renderer/src/components/TerminalPanel.tsx:277-279`, `src/renderer/src/components/DisconnectedBar.tsx:19`, ebenso `FilesPanel.tsx:229-230`.
- *Szenario:* Der Server beendet die Sitzung, zum Beispiel nach `sudo reboot`. `.connect-closed` liegt `position: absolute; bottom: 4px` über dem xterm und ist etwa 46 px hoch. Das sind bei 14 px Schrift 2 bis 3 Zeilen. Genau diese Zeilen erklären meist das Ende, etwa eine Broadcast-Meldung, die Fehlerausgabe eines beendeten Containers oder der letzte Prompt. Man kann sie nicht hochscrollen, weil sie unten im Puffer stehen. Auch Markieren und Kopieren geht nicht. Das widerspricht dem eigenen Kommentar der Komponente („the screen content stays readable above it“) und dem Prototyp: Dort steht die Ausgabe in einer Flex-Spalte über der Leiste (`flex: 1`), die Leiste fließt darunter und verdeckt nichts. In `FilesPanel` verdeckt dieselbe Leiste die untersten Zeilen beider Dateilisten.
- *Fix-Richtung:* Die Leiste soll keine Fläche verdecken. Variante 1: Bei `status === 'closed'` bekommt das Panel eine Klasse, und `.terminal-container` verliert unten die Leistenhöhe (`margin-bottom` bzw. `bottom`). Der vorhandene `ResizeObserver` → `fit.fit()` passt dann die Zeilen an, die `sshResize` auf die tote Session wird bereits abgefangen. Variante 2: Die Leiste als Flex-Kind unter `.terminal-container` setzen, das Panel ist in der Bühne schon eine Flex-Spalte. Für `FilesPanel` gilt dasselbe für `.files-commander`.

**I2 – Fehlerkarte und Getrennt-Leiste ziehen den Fokus aus anderen Eingaben.**
`src/renderer/src/components/DisconnectedBar.tsx:27`, `src/renderer/src/components/ConnectionErrorCard.tsx:30`, `src/renderer/src/components/TerminalPanel.tsx:261`, `RdpPanel.tsx:128`, `FilesPanel.tsx:193`.
- *Szenario:* `active` ist `focused && visible`. `focused` ist der Layout-Fokus des Bereichs, nicht der DOM-Fokus. Der Nutzer tippt in der Seitenleiste („Verbindungen suchen“, Ordnerformular) oder im Assistenten. Währenddessen endet die Sitzung des fokussierten Bereichs, oder ein Verbindungsaufbau läuft nach 10 s in den Timeout. Die Leiste bzw. Karte wird eingehängt und ruft `focus()` auf ihren Button. Die nächsten Tasten gehen verloren, und Enter löst ungewollt „Neu verbinden“ bzw. „Erneut verbinden“ aus (oder „Verbindung bearbeiten“, wenn das die Primäraktion ist). Damit läuft eine neue SSH-Verbindung ohne bewusste Handlung. Das widerspricht Spec 2 („Esc/Enter wirken nur, wenn Karte oder Leiste den Fokus hat … xterm behält sonst alle Tasten“) und dem Grundsatz U5, dass Hintergrundereignisse das Tippen nicht unterbrechen. Für die Verbindungskarte gilt dasselbe, wenn ein Workspace wiederhergestellt wird.
- *Fix-Richtung:* Den Fokus nur nehmen, wenn er schon im eigenen Bereich liegt (`panelRef.current.contains(document.activeElement)`, also im xterm-Textfeld) oder auf `document.body` steht. Am einfachsten ein gemeinsamer Helfer `mayTakeFocus(panel)` in den drei Panels, der in `active` einfließt.

### Minor

**m1 – Die SFTP-Fehlerkarte überdeckt auch den lokalen Bereich (Ledger M7).** `FilesPanel.tsx:225-227`, `connection-ui.css:2`.
*Szenario:* `.connect-overlay` liegt mit `inset: 0` über dem ganzen `files-panel`. Die lokale Liste bleibt sichtbar, nimmt aber keine Klicks mehr an. Vorher stand der Hinweis nur im Server-Bereich. Ohne Server hat der Tab wenig Zweck, deshalb ist das nur Minor.
*Fix-Richtung:* Das Overlay auf den Server-Bereich begrenzen, also im entfernten `FilePane` rendern oder `.files-panel .connect-overlay` auf die rechte Spalte setzen. Alternativ bewusst hinnehmen und im Ledger als akzeptiert vermerken.

**m2 – Das Datenalter der Cluster-Leiste geht bis zu 10 s nach (Ledger M2).** `src/renderer/src/hooks/useClusterSession.ts:30-31,48`.
*Szenario:* Events kommen ohne `at` an. `updatedAt` fällt deshalb auf `state.now` zurück, das ist der 10-s-Tick. „gerade aktualisiert“ und „Stand vor n s“ liegen dadurch bis zu 10 s daneben.
*Fix-Richtung:* Wie im Ledger vorgesehen: `dispatch({ type: 'event', event, at: Date.now() })` an allen drei Stellen.

**m3 – Rest-Transition von `.kube-stale` (Ledger M8).** `src/renderer/src/kubernetes-ui.css:35`.
*Szenario:* `.kube-body > :not(.kube-dock) { transition: opacity }` hat kein Ziel mehr und ist toter Code. Laut Spec 2.5 fallen die Zeilen 35-36 ganz weg.
*Fix-Richtung:* Die Zeile löschen.

**m4 – Karte und Leiste werden bei jedem Tabwechsel neu eingehängt.** `TerminalPanel.tsx:269-279`, `FilesPanel.tsx:225-230`, `RdpPanel.tsx:139-144`.
*Szenario:* Wegen `visible && …` unmountet die Leiste beim Wegschalten. Beim Zurückschalten per Tastatur (Tab-Shortcut) greift `@starting-style` erneut. Die Leiste mit `reason: 'server'` fährt wieder von unten ein, die Fehlerkarte skaliert erneut. Das verletzt „Tastatur bewegt nie etwas“ (K5, K17).
*Fix-Richtung:* Die Komponenten unabhängig von `visible` eingehängt lassen (die Section ist ohnehin `hidden`). Den Tick über eine Prop nur bei `visible` laufen lassen (K17) und den Fokus weiter über `active` steuern.

**m5 – Ein nach dem Abbrechen eintreffendes `connected` blendet die Leiste kurz aus.** `TerminalPanel.tsx:138-147`.
*Szenario:* Esc kommt kurz vor `ready`. Main hat `status: 'connected'` schon gesendet, bevor `sshClose` ankommt. Das Panel springt auf `connected`, die Leiste verschwindet, und `term.focus()` läuft. Erst danach kommt `closed`.
*Fix-Richtung:* Solange `cancelledRef.current` gilt, nur `closed` und `error` übernehmen.

**m6 – Enter auf der Verbindungskarte bricht ab.** `ConnectingCard.tsx:32`.
*Szenario:* Nach Enter im Baum hat nach 400 ms „Abbrechen“ den Fokus. Ein zweites Enter, etwa ein Doppeltipp oder Enter für die nächste Verbindung, löst den nativen Klick aus und bricht ab. Die Karte zeigt dafür aber nur `Esc` an.
*Fix-Richtung:* Im `onKeyDown` der Karte bei Enter auch `preventDefault()` aufrufen. Abbrechen geht dann nur über Esc, Leertaste und Klick. Alternativ als bewusstes Verhalten hinnehmen.

**m7 – „Erneut versuchen“ tut still nichts, solange eine andere Speicherung läuft.** `App.tsx:464,484`.
*Szenario:* Der Klick schließt den Fehler-Toast. `persistVault` kehrt wegen `saveInProgress.current` sofort mit `false` zurück und gibt keine Rückmeldung. Die Änderung ist verloren, und der Nutzer merkt es nicht.
*Fix-Richtung:* Im Retry `saveInProgress.current` prüfen und dann `notify.info('Nicht erneut gespeichert', …)` melden, so wie bei B9.

**m8 – `classifyError` weicht für `HostKeyError` `changed` ohne Fingerprints ab.** `src/main/ssh/session.ts:124`.
*Szenario:* Laut Tabelle 1.17 ergibt dieser Fall `hostkey-store`, der Code liefert `hostkey-changed` ohne `detail`. In der Praxis kommt das nicht vor, denn beide Wurfstellen in `known-hosts.ts` übergeben Fingerprints. Die Karte fällt dann korrekt auf `retry` als Primäraktion zurück (E6).
*Fix-Richtung:* Dem Vertrag folgen (`hostkey-store`) oder die Abweichung als Absicht kommentieren.

**m9 – Eine Test-Pflicht aus 1D fehlt.** `src/main/ssh/session.test.ts:703`.
*Szenario:* Validierung 5 (1D) verlangt für den Auth-Fehler, dass `detail` „authentication“ enthält. Der Test prüft nur `code: 'auth'` und dass das Passwort fehlt. Eine Regression, bei der `detail` bei ssh2-Fehlern wegfällt, bliebe im Loopback-Test unbemerkt.
*Fix-Richtung:* `expect(statusEvents().at(-1)?.detail).toMatch(/authentication/i)` ergänzen.

---

## 3. Zusammenspiel

| Strecke | Befund |
|---|---|
| notice-store ↔ ToastStack ↔ App/SecondaryWindow | Im Renderer gibt es kein `setError` mehr für globale Meldungen (verbliebene `setError` sind lokale Formularzustände in `ConnectionForm` und `FolderEditor`). Die Bridge aus B1 ist entfernt, `toast-state.*` ist gelöscht. Fehler haben keinen Balken und bleiben stehen. Info läuft 5 s, ok läuft 3 s, gesteuert nur über CSS (`--notice-ttl-*`, K1). Höchstens 3 Meldungen gleichzeitig, eine gleiche Meldung wird neu gestartet (E1). `.toast-stack.is-held` gilt bei Hover und `document.hidden` (K2). `useNativeSurfaceBlock(notices.length > 0)` sperrt die RDP-Fläche (S3-2). Toasts nehmen keinen Fokus und reagieren nicht auf Escape. In App rendert `ToastStack` auf beiden Bildschirmen, im Nebenfenster einmal (K3). `clearNotices()` steht in `resetForm` (K4). |
| TerminalPanel ↔ Karten ↔ connect-timeline ↔ Main-Schritte | Reihenfolge `reach < hostkey < auth < shell < connected` ist per Loopback-Test belegt. Die Karte erscheint nach `WAIT_MS` (400 ms) ohne Übergang (K5). Die Fehlerkarte ersetzt die Karte (K8). Esc und Enter rufen `stopPropagation`, Esc zusätzlich `preventDefault` (B7). Dock-Terminals bekommen `embedded` (`DetailDock.tsx:173`, `ContainerDock.tsx:158`) und nehmen keinen Fokus. Die Fokusregel ist zu weit gefasst, siehe I2. `.error-message` ist aus `TerminalPanel` entfernt, `terminal-ui.css:32` bleibt (B5). |
| Cluster-Leiste ↔ Main | `attempt = this.attempt + 1` nur bei `reconnecting`. `trying` wird über `onTry` gesetzt und in `setReady`, `retryNow`/`connectFirst`-`catch` und `reconnect` gelöscht. Die Texte aus K23 sind wörtlich übernommen und in `cluster-bar.test.ts` abgedeckt. `RECONNECTING_MESSAGE` gilt in `actionReason`, `connectedReason` und `shellUnavailable` (K24, B8). `.kube-stale` ist entfernt, es bleibt eine Rest-Transition (m3). |
| BusyButton | Eingesetzt mit den Labels aus 3.7 in `ConnectionForm`, `FolderEditor`, `WorkspaceControls` (`doneKey` nach Erfolg) und in `ConfirmDialog`, `ConfirmAction`, `PermissionsDialog` (nur `busy`). `is-fresh` gibt es erst nach dem ersten Wechsel (K25). Der Punkt nutzt `currentColor` (K26). |
| Container | `busy` ist jetzt ein `Record` uid → Aktion. Die Statuszelle zeigt `BUSY_LABEL`, Arten ohne Status hängen ` · startet` an die erste Spalte. `.ctr-busy` behält nur `cursor: progress` (3.8). |
| Statuswörter | Tabs nutzen `short`, der Live-Span im Terminal `long` mit Name, RDP und SFTP `long` mit Protokoll. Die Texte stimmen mit 3.4 überein. |
| Tokens/Theme | Die Werte stimmen mit Spec 2.1 überein, die neuen Tokens haben Rollenkommentare. Kupfer markiert nirgends einen Zustand: `.container-state.is-busy` nutzt jetzt `--color-warn`, `.assistant-typing` den gedämpften Text, `.toast-dot` bei info `--color-text`, die Connbar `ok`/`warn`/`muted`. Akzent bleibt nur für Fokus, Auswahl, Aktion, Ordner-Glyph und Meter (laut Spec erlaubt). |

---

## 4. Abdeckung (Validierung Abschnitt 5, Blocker B1–B9)

| Task | Status |
|---|---|
| 1A Tokens + Theme | erfüllt (`tokens.css`, `terminal-theme.ts:3`, `ConnectionForm.tsx:136` → `#aeb3bc`, `navigation-ui.css` `--size-dot`/`--color-warn`, `assistant-ui.css`, `styles.css:112`) |
| 1B Notice-Store, Toast, Edit-Bus | erfüllt (1.7–1.9, K1, K2, E1–E3, B3 mit `translateX(-100%)` und `toast-bar-width` unter `reduce`) |
| 1C Shared-Verträge | erfüllt. Die Texte aus 3.3 sind wörtlich übernommen, `splitAddress` inklusive IPv6 |
| 1D Main SSH | erfüllt: K6, K12, K13, K19–K21, Limit-Texte. Die Testpflicht „detail enthält authentication“ fehlt (m9), `classifyError` weicht ab (m8) |
| 1E Main Kube | erfüllt (B4: `ipc.ts:44` reicht `onTry` durch, `ipc.ts:77` hat den neuen Text) |
| 1F Vault-Fehler | erfüllt (K22) |
| 2A App-Integration | erfüllt: Tabelle 3.1 ist wörtlich übernommen, außerdem K3, K4, B6, B9, `getErrorMessage`, Statusleiste und ok-Toast. M1 (`.sidebar-create-form .field-error`) ist akzeptiert |
| 2B Terminal-Karten | erfüllt mit I1, I2, m4–m6 |
| 2D Cluster-Leiste | erfüllt mit m2 und m3 |
| 2E BusyButton + Formulare | erfüllt. `.workspace-menu-error` entfernt, `.area-error` in `VaultTree` und `WorkspaceControls`. Es gibt keinen DOM-Test (M3, akzeptiert) |
| 2F Container | erfüllt |
| 3A Doku + Version | erfüllt (0.11.0, Gate-Zeile E9, Kupfer-Regel, Ausnahme `#aeb3bc`, Meldungs-Muster). `release-notes.ts` liest `CHANGELOG.md` und braucht keine Änderung |
| 3B Text-Lint | erfüllt |
| 3C RDP, SFTP, Tabs | erfüllt (K16) mit m1 |
| B1–B9 | alle umgesetzt. B1-Bridge ist entfernt, B5-Regel bleibt, B7 mit `embedded` und `stopPropagation`, B8-Tests sind umgestellt, B9 siehe Abschnitt 1 |

## 5. Einordnung der Ledger-Minors

| Ledger | Bewertung |
|---|---|
| M2 | Bleibt **Minor** (m2). Wie geplant in der Fix-Welle beheben, eine Zeile je Dispatch. |
| M5 | Wird **Important** (I1). Die Leiste verdeckt die Ausgabe, die das Ende erklärt. Das widerspricht dem Prototyp (Leiste im Fluss unter der Ausgabe) und dem Kommentar der Komponente. Der Fix ist klein und gehört in die Fix-Welle. |
| M7 | Bleibt **Minor** (m1). Der Tab hat ohne Server kaum Zweck. Entweder das Overlay auf den Server-Bereich begrenzen oder im Ledger als akzeptiert vermerken. |
| M8 | Bleibt **Minor** (m3). Toter Code ohne sichtbare Wirkung, in der Fix-Welle löschen. |

---

**Urteil: mergebereit nach Fix-Welle.** 0 Critical, 2 Important (I1, I2), 9 Minor (m1–m9). Pflicht in der Fix-Welle: I1, I2, m2, m3. Empfohlen: m4–m7, m9. Hinnehmbar mit Ledger-Vermerk: m1, m8.
