# UX-Audit v2 – Nachprüfung nach der Fix-Welle

Stand: 2026-10-19 · Branch `claude/feature/ux-audit-v2` · Fix-Diff `git diff cb311d2..HEAD` (`ae18736`, `6b806ca`).
Grundlage: [Review](2026-10-19-ux-audit-v2-review.md) (I1, I2, m1–m9), Umsetzer-Berichte `.superpowers/sdd/2026-10-19-ux-audit-v2/report-fix-1.md` und `report-fix-2.md`, Nachschärfung m7 durch den Orchestrator (zwei getrennte Hinweistexte).

Gate: `npm run typecheck` grün. `npx vitest run --exclude '.claude/**'` grün mit 96 Dateien und 1452 Tests (neu: `focus-guard.test.ts`). `design-tokens.test.ts` (R13) ist grün.

**Urteil: mergebereit.** 10 von 11 Befunden ADDRESSED, 1 NOT ADDRESSED (m4, Minor, nur die Animation), 0 ACCEPTED. Neue Fehler im Fix-Diff: 0 Critical, 0 Important, 2 Minor.

---

## 1. Befunde aus dem Review

| Befund | Status | Beleg |
|---|---|---|
| **I1** Getrennt-Leiste verdeckt die letzten Zeilen | **ADDRESSED** | `connection-ui.css:30`: `.connect-closed` hat kein `position: absolute` mehr, sondern `flex: 0 0 auto; margin-top`. In der Bühne ist das Panel eine Flex-Spalte (`terminal-ui.css:28`), `.terminal-container` hat `flex: 1; min-height: 0` (`terminal-ui.css:30`). Die Leiste steht als Geschwister hinter dem Container (`TerminalPanel.tsx:270,279-281`). Dadurch schrumpft der Container, der vorhandene `ResizeObserver` → `fit.fit()` (`TerminalPanel.tsx:175`) passt die Zeilenzahl an. xterm schiebt beim Verkleinern die oberen Zeilen in den Scrollback, die letzten Zeilen bleiben sichtbar. `sshResize` auf die tote Session wird abgefangen (`:173`). RDP: Leiste nach `.rdp-surface` (`RdpPanel.tsx:134-145`). `syncBounds` sendet bei `closed` nichts, weil `shown` false ist (`RdpPanel.tsx:37,46`). SFTP: Leiste nach `.files-commander` (`FilesPanel.tsx:224-232`), Abstand über `files-ui.css:8`. R13: Kein neuer Selektor mit Bühnenklasse deklariert `transform` oder `transition`. `.files-panel > .connect-closed` setzt nur `margin`, `.files-commander` nur `position`. Das `translateY` bleibt auf dem eigenen Selektor `.connect-closed:not([data-instant])` (`connection-ui.css:37-38`). Der Test ist grün. |
| **I2** Karte/Leiste ziehen Fokus aus anderen Eingaben | **ADDRESSED** | `focus-guard.ts:2-5` `mayTakeFocus`: Der Fokus wird nur übernommen, wenn `activeElement` null oder `body` ist oder im Panel liegt. `focus-guard.ts:8-12` `focusIfAllowed` sucht das Panel mit `root.closest('.terminal-panel')`. Alle drei Panels tragen die Klasse (`TerminalPanel.tsx:268`, `RdpPanel.tsx:131`, `FilesPanel.tsx:220`). Eingesetzt in `ConnectingCard.tsx:33`, `ConnectionErrorCard.tsx:32` und `DisconnectedBar.tsx:33`. Fokus im xterm-Textfeld des eigenen Panels: Die Hilfs-Textarea liegt in `.terminal-container` innerhalb der `section.terminal-panel`. `contains` ist dann true, der Fokus wird also übernommen. Docks: `cardActive = focused && visible && !embedded` (`TerminalPanel.tsx:263`), deshalb kommt es dort gar nicht zum Aufruf. Seitenleiste und Assistent liegen außerhalb jedes `.terminal-panel` und werden abgewiesen. Tests: `focus-guard.test.ts:8-20`. Folgewirkung siehe N2. |
| **m1** SFTP-Fehlerkarte überdeckt den lokalen Bereich | **ADDRESSED** | Die Karte ist jetzt Kind von `.files-commander` (`FilesPanel.tsx:224-229`), dieser hat `position: relative` (`files-ui.css:3`). `.files-commander > .connect-overlay { inset: 0 0 0 50% }` deckt nur die rechte Spalte ab, gestapelt nur die untere Zeile (`files-ui.css:6-7`). Die Container-Query bezieht sich auf `.files-panel` (`files-ui.css:9`), genau wie die vorhandene Stapelregel. |
| **m2** Datenalter der Cluster-Leiste geht nach | **ADDRESSED** | `useClusterSession.ts:30,31,35,48,56`: Alle fünf `dispatch` übergeben `at: Date.now()`. Typecheck grün. |
| **m3** Rest-Transition `.kube-stale` | **ADDRESSED** | Die Zeile mit dem Media-Block nach `kubernetes-ui.css:34` ist gelöscht. |
| **m4** Karte/Leiste werden bei Tabwechsel neu eingehängt | **NOT ADDRESSED** (teilweise) | Umgesetzt sind diese Punkte: `visible &&` ist entfernt (`TerminalPanel.tsx:271-281`, `RdpPanel.tsx:139-145`, `FilesPanel.tsx:225-232`). Der Tick läuft nur bei `ticking={visible}` (`ConnectingCard.tsx:27-32`, `DisconnectedBar.tsx:27-32`), und bei der Rückkehr setzt `setNow(Date.now())` sofort die Zeit. Der Fokus hängt weiter an `active` (`focused && visible`), deshalb nehmen versteckte Tabs keinen Fokus. **Das Symptom aus dem Review bleibt aber.** Der Tab ist `hidden` und damit `display: none !important` (`styles.css:8`, `terminal-ui.css:29`). Für Elemente in einem `display:none`-Teilbaum gibt es keinen before-change style. Laut CSS Transitions 2 greift `@starting-style` deshalb erneut, sobald der Tab wieder sichtbar wird. In Chromium ist das so, weil dort für `display:none`-Teilbäume kein Style gehalten wird. Die Leiste mit `reason: 'server'` fährt also beim Zurückschalten weiter von unten ein (`connection-ui.css:35,38`). Die Fehlerkarte skaliert weiter (`connection-ui.css:40,44`). Der Fix-Vorschlag im Review reichte dafür nicht aus. *Fix-Richtung:* Nach dem ersten sichtbaren Auftritt `data-instant` setzen, zum Beispiel über einen Zustand `settled`, der bei `transitionend` oder beim ersten `ticking=true`-Render plus `--dur-toast` gesetzt wird. Für `.connect-error` ebenso ein `:not([data-instant])` einführen. Im Feel-Check in Electron bestätigen. Minor, kein Merge-Blocker. |
| **m5** Spätes `connected` nach Abbrechen | **ADDRESSED** | `TerminalPanel.tsx:139-140`: Bei `cancelledRef.current` kommen nur `closed` und `error` durch. Damit entfallen bei `connected` auch `setStatus`, `connected = true` und `term.focus()` (`:141-149`). `cancelledRef` wird pro Versuch zurückgesetzt (`:73`). Main sendet nach `close` genau einmal `closed` (`session.ts:500-504,539-540`). Der Grund bleibt `cancel` (`TerminalPanel.tsx:146-147`). |
| **m6** Enter auf der Verbindungskarte bricht ab | **ADDRESSED** | `ConnectingCard.tsx:38`: Enter ruft `preventDefault()` und `stopPropagation()` auf. Der native Klick auf „Abbrechen“ entfällt. Esc, Leertaste und Klick funktionieren weiter. |
| **m7** „Erneut versuchen“ tut still nichts | **ADDRESSED** | `App.tsx:484-486`: Läuft `saveInProgress.current`, kommt `notify.info('Nicht erneut gespeichert', { body: 'Gerade läuft eine andere Speicherung. Versuche es danach noch einmal.' })`. Sonst wird bei unverändertem Vault gespeichert, andernfalls kommt der B9-Text wörtlich. Damit gibt es zwei getrennte Texte, wie nachgeschärft. Zum Inhalt des ersten Textes siehe N1. |
| **m8** `classifyError` bei `changed` ohne Fingerprints | **ADDRESSED** | `session.ts:124-125` liefert `hostkey-store` und hat einen Kommentar mit Verweis auf Vertrag 1.17. Test: `session.test.ts:767`. |
| **m9** Testpflicht „detail enthält authentication“ | **ADDRESSED** | `session.test.ts:708`. |

---

## 2. Neue Fehler im Fix-Diff

### Critical

Keine.

### Important

Keine.

### Minor

**N1 – Der neue m7-Text verspricht etwas, das nicht mehr geht.** `src/renderer/src/App.tsx:484`, `src/renderer/src/components/Toast.tsx:47`.
- *Szenario:* Eine Speicherung schlägt fehl, und der Fehler-Toast bietet „Erneut versuchen“ an. Der Nutzer legt einen Ordner an, die nächste Speicherung läuft, und er klickt währenddessen „Erneut versuchen“. Der Klick schließt den Fehler-Toast (`noticeStore.close(id); action.run()`). Es erscheint „Gerade läuft eine andere Speicherung. Versuche es danach noch einmal.“ Danach gibt es aber keinen Retry-Knopf mehr. Ein späterer Retry würde ohnehin an der B9-Regel scheitern, weil die laufende Speicherung `vault` ändert (`setVault(updatedVault)` in `persistVault`). Der Nutzer wartet also auf eine Möglichkeit, die es nicht gibt, und die fehlgeschlagene Änderung ist verloren.
- *Fix-Richtung:* Der Satz soll sagen, was zu tun ist, zum Beispiel: „Gerade läuft eine andere Speicherung. Wiederhole die Änderung danach.“ Den Text mit dem Orchestrator abstimmen, weil er die Nachschärfung vorgegeben hat.

**N2 – Nach einem Tabwechsel nehmen Karte und Leiste den Fokus nicht mehr.** `src/renderer/src/focus-guard.ts:2-5,8-12`.
- *Szenario:* Der Nutzer klickt im Pane-Kopf auf einen Tab, dessen Sitzung beendet ist. Der Tab-Button liegt in `.pane-chrome`, also außerhalb des `.terminal-panel`. Er hat jetzt den Fokus. `focusIfAllowed` lehnt deshalb ab, und Enter löst nicht „Neu verbinden“ aus, sondern klickt erneut auf den Tab. Ähnlich ist es beim Tab-Shortcut aus einem anderen Terminal. Liegt `activeElement` noch auf der xterm-Textarea des jetzt versteckten Tabs, wird ebenfalls abgelehnt. Spec 2 und `ConnectingCard`-Doku verlangen aber: „Der Button bekommt Fokus, wenn der Bereich fokussiert ist“. Andere Fokusquellen gibt es in diesem Zustand nicht, denn `term.focus()` läuft nur bei `connected` (`TerminalPanel.tsx:149,192`). Der Umsetzer nennt das im Bericht „gewollt nach I2“. I2 sollte aber nur fremde Eingaben schützen (Seitenleiste, Formulare, Assistent) und nicht den Terminalbereich selbst.
- *Fix-Richtung:* In `focusIfAllowed` auch dann erlauben, wenn `activeElement` im Terminalbereich liegt (`closest('.split-workspace')`, also Pane-Kopf und Bühne) oder nicht gerendert ist (`!activeElement.isConnected || activeElement.getClientRects().length === 0`). Einen Testfall in `focus-guard.test.ts` ergänzen.

---

## 3. Hinweise ohne Befund

- **Dock-Terminals:** In `.kube-dock-terminal` ist `.terminal-panel` kein Flex-Container (`kubernetes-ui.css:113-114`), `.terminal-container` hat dort keine Flex-Regel. Die Leiste steht jetzt im Blockfluss unter dem xterm statt absolut unten im Panel. Ist die Ausgabe höher als das Dock, erreicht man die Leiste erst durch Scrollen in `.kube-dock-body` (`overflow: auto`). Das gehört in die Sichtprüfung der Docks. Bestätigt sich das, `.kube-dock-terminal .terminal-panel { display: flex; flex-direction: column }` ergänzen (nur Layout, R13 erlaubt das).
- m5: Kommt vor dem `closed` aus dem Main noch ein echtes `error` an (Zeitlimit im selben Moment), ersetzt die Fehlerkarte die Leiste „abgebrochen“. Das entspricht der Fix-Richtung und ist sachlich richtig.
- Einen DOM- oder Layout-Test für I1 gibt es nicht. Der Umsetzer hat das offen benannt. Die Sichtprüfung im Feel-Check steht noch aus.

---

**Urteil: mergebereit.** I1, I2, m1–m3 und m5–m9 sind ADDRESSED, m4 ist NOT ADDRESSED (die Animation läuft beim Zurückschalten weiter, Minor). Neu: 0 Critical, 0 Important, 2 Minor (N1, N2). Empfohlen vor dem Merge: N2 und N1, beide klein. m4 kann mit dem `data-instant`-Ansatz nachgezogen oder im Ledger als bekannt vermerkt werden.
