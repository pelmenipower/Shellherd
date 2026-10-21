# Sperrbildschirm und Willkommens-Tab – Review (Stufe 5)

Geprüft: `git diff claude/feature/connection-timeouts...HEAD` auf `claude/feature/lock-screen` (`70ba192`..`8996307`, 9 Commits, einschließlich der cmd-Umbenennung). Maßstab: Spec `2026-10-21-lock-screen-design.md`, bindender Anhang `2026-10-21-lock-screen-validation.md` (Vertrag 1.1–1.9, B1–B4, K1–K15), Ledger `.superpowers/sdd/2026-10-21-lock-screen/progress.md`, `CLAUDE.md`, `docs/design-system.md`.

Basis grün: `npm run typecheck`; `npx vitest run` mit 128 Dateien und 1824 Tests.

**Urteil: mergefähig nach der Fix-Welle unten.** 0 Critical, 4 Important, 6 Minor. Die Sicherheitsarchitektur hält. Kein IPC-Kanal liefert im gesperrten Zustand Vault-Geheimnisse, und der redigierte Vault erreicht die Platte auf keinem Weg. Lücken gibt es bei einer K6-Pflicht (Fokus) und bei der Absicherung: Das run-app-Szenario beweist das Weiterlaufen der Sitzung nicht, die Nebenfenster-Sperre wurde nie ausgeführt, und die Wiederaufnahme-Entscheidung in Main ist ungetestet.

---

## 1. Sicherheit – geprüft, ohne Befund

**Main nach der Sperre**
- `session.ts:125-133`: `lock()` nullt den Schlüssel und verwirft `activeSession`, also auch den Klartext-Vault. Danach bleiben nur Pfad und Vault-ID in `locked`.
- `save()` verschlüsselt synchron vor dem ersten `await` (`session.ts:90`). Ein Lock mitten im Speichern hängt nur noch an der abgekoppelten Session.

**Kanäle im gesperrten Zustand:** Alle laufen über `getSnapshot()`/`requireSession()` und werfen `core.vaultLocked`:
- Katalog: `window-ipc.ts:81`
- Transfer und Workspace-Fenster: `:132,144,206`
- `connection:test`: `index.ts:245`
- Zwischenablage: `:252,257`
- KI: `ai:catalog`, `ai:ask` über `settings()`, `ai:test` (`ai/ipc.ts:26,41`)
- RDP: `getTarget` (`rdp/ipc.ts:37`)
- Kube: `getCluster`/`getConnection`. `kube:action` liest `readOnly` bei jedem Aufruf neu und schlägt im gesperrten Zustand geschlossen fehl, „Nur lesen“ bleibt also gewahrt.
- SSH: `getConnection` (`ssh/session.ts:183,228`)
- `local:*`
- `sftp:open` und `sftp:sync-start`, über `getConnection` in `sftp-session.ts:203`

Die SFTP-Lockerung (`files/ipc.ts:66`) betrifft nur Kanäle, die an eine eigene Sitzung gebunden sind. Sie liefern keine Vault-Daten (O7). Die kubeconfig bleibt unverändert in Main.

**Wiederaufnahme**
- `vault/ipc.ts:182-192`: `previous` wird vor `unlock()` gelesen. `resumed` verlangt gleichen Pfad und gleiche Vault-ID. `onSessionChange` läuft sonst immer.
- Der Renderer vergleicht in `App.tsx:626` die ID. Der Pfad ist dort derselbe, nämlich `vaultPath` aus dem früheren Ergebnis.
- Ein fehlgeschlagenes Entsperren lässt `locked` stehen. Das ist getestet.

**Redigierter Vault**
- `redactVault` deckt alle Geheimnisfelder aus `types.ts` ab: SSH/SFTP-`authentication`, RDP-`password`, `ai.providers[].apiKey`.
- `usePersistVault(locked ? null : vault, …)` (`App.tsx:184`) sperrt jedes `persistVault` während der Sperre.
- Main lehnt `saveCurrentVault` im gesperrten Zustand zusätzlich ab.
- Der einzige direkte Speicheraufruf ist `saveVault` beim Anlegen.
- Retry-Toasts prüfen `deps.vault() === previousVault`. Nach dem Entsperren ist das ein neues Objekt.

**Wege am Sperrbildschirm vorbei**
- Tastatur:
  - Ctrl+Shift+Space ist gesperrt (`App.tsx:129`, `SecondaryWindow.tsx:109`).
  - Ctrl+, scheitert an `settingsShortcutAction`, weil `dialog.lock-screen[open]` zählt.
  - Ctrl+Shift+K schaltet nur das unsichtbare Assistenzpanel hinter `inert` um.
  - Escape wird über `onCancel` und `onClose` abgefangen.
- Palette: K8/K11 erfüllt.
- Kontextmenüs und Popover: unter `inert` nicht erreichbar. `showModal()` schließt offene Auto-Popover.
- Drag & Drop: Ein `.term` setzt `pendingVaultFile`, der Dialog liegt unter der Sperre (B1). Andere Dateien erzeugen einen Toast im inerten `<main>`.
- Toasts: Der Stack liegt in `<main inert>`, nicht im Top-Layer.
- `second-instance`: `focus` plus `vault:open-file` landet in derselben Logik.
- Dialoge: Der Observer hebt die Sperre wieder an (B1). Das ist im run-app-Lauf belegt.
- RDP: `useNativeSurfaceBlock(true)` in beiden Fenstern.
- DevTools: `devTools: false` (`index.ts:84`). Ein Neuladen per Standardmenü beendet nur Sitzungen und gibt nichts frei, denn der Renderer startet auf `home`.

**Idempotenz**
- `afterLock` ist über `lockedRef` idempotent und ignoriert späte Events außerhalb von `vault` (`App.tsx:608`).
- `lockVault({ disconnect: true })` sendet kein `onLock` (`vault/ipc.ts:229-232`, B3).
- `switchVault`, `openFresh` und `afterLock` erhöhen jeweils `lockEpoch`.
- Auto-Sperre nach manueller Sperre: `minutes()` liefert 0.

**Weitere geprüfte Punkte ohne Befund**
- Willkommens-Tab:
  - Ausgefiltert in `savedLayout` (getestet).
  - Wird nicht übertragen: Schema-Test, `transferView` filtert und bricht bei leerer Liste ab.
  - Kein Drag; die Kopfleiste läuft über `beginTabDrag`.
  - Teilen ist deaktiviert, „Tab verschieben“ ausgeblendet.
  - Er zählt zum 16er-Limit, getestet und mit Hinweis in `openWelcome`.
  - Status `closed`, also nicht in `runningCount`.
  - Schließen ohne Rückfrage; die Bühne zeigt danach den leeren Bereich.
- i18n: Die gelöschten Keys sind aus beiden Katalogen weg, die neuen wörtlich nach Spec 5 und K13.
- Tokens: `lock-ui.css` und `terminal-ui.css` nutzen nur `var(--…)`.
- Motion-Gate: Zeilen eingetragen; keine Bewegung, keine globale Dialog-Animation.
- Version 0.15.0.

---

## 2. Befunde

### Important

**I1 – Nach einem Fehlversuch landet der Fokus nicht im Passwortfeld (K6 verletzt).**
- Stelle: `src/renderer/src/components/LockScreen.tsx:53,74`.
- Fehler: Das Feld ist während `pending` auf `disabled={pending}` gesetzt. `finally { setPending(false); …; field.current?.focus(); }` läuft, bevor React neu rendert. `focus()` trifft also ein noch deaktiviertes Feld und tut nichts. Das Deaktivieren hat den Fokus bereits auf `<body>`/den Dialog geworfen.
- Szenario: Falsches Passwort, Enter, Fehlermeldung. Der Nutzer tippt sofort weiter, und nichts landet im Feld. Er muss erst klicken oder Tab drücken. Das betrifft die Sicherheitsfläche, die mehrmals täglich benutzt wird.
- **Fix (bindend):** Am `<input>` `disabled={pending}` durch `readOnly={pending}` ersetzen. Das Feld behält so den Fokus, und das `focus()` im `finally` bleibt als Absicherung. Absenden bleibt über den Knopf (`disabled={pending || password === ''}`) und den Wächter in `submit` gesperrt.
- **Test:** run-app `lock` nach dem Fehlversuch (siehe I2):
  ```js
  document.activeElement === document.querySelector('.lock-screen input[type=password]')
  ```
  Dazu `.value === ''`.

**I2 – Das run-app-Szenario `lock` beweist nicht, dass die Sitzung die Sperre überlebt.**
- Stelle: `.claude/skills/run-app/screens.mjs:171`.
- Fehler: `count('.terminal-tab-close') >= 1` zählt auch den Willkommens-Tab mit. `.xterm` steht auch im DOM eines getrennten oder neu montierten Terminals. Ein Regress, bei dem das Entsperren Tabs schließt, neu montiert oder trennt (etwa `onSessionChange` bei jeder Entsperrung), bleibt so grün. Laut O8 ist run-app aber die einzige Absicherung.
- **Fix (bindend)** im Block `lock`:
  1. Vor `.lock-button`, nachdem `.xterm` da ist, auf den verbundenen Tab warten:
     ```js
     [...document.querySelectorAll('.terminal-tab:not([data-fixed])')].some(b => b.querySelector('.tab-name')?.textContent === 'web-01' && b.querySelector('.tab-status-connected'))
     ```
     Dann das sichtbare Terminal markieren:
     ```js
     document.querySelector('.terminal-panel:not([hidden]) .xterm').dataset.lockProbe = '1'
     ```
  2. Nach dem Fehlversuch zusätzlich die Fokus- und Leerprüfung aus I1.
  3. Die Entsperr-Bedingung in Zeile 171 lautet:
     ```js
     !document.querySelector('dialog.lock-screen[open]')
       && document.querySelector('.xterm[data-lock-probe]')
       && [...document.querySelectorAll('.terminal-tab:not([data-fixed])')].some(b => b.querySelector('.tab-name')?.textContent === 'web-01' && b.querySelector('.tab-status-connected'))
     ```
     Der markierte Knoten belegt „nicht neu montiert“, der Status belegt „verbunden“, und `:not([data-fixed])` schließt den Willkommens-Tab aus.
  4. Danach `document.querySelector('.vault-shell').inert === false`.
- **Test:** Der Block selbst. Gegenprobe beim Umsetzen: Den Block einmal gegen eine absichtlich gebrochene Fassung laufen lassen, zum Beispiel lokal `if (!resumed)` → `if (true)` in `vault/ipc.ts`. Die Prüfung muss dann scheitern. Die Gegenprobe wird nicht committet und im Ledger vermerkt.

**I3 – Die Nebenfenster-Sperre (K11) wurde nie ausgeführt.**
- Stelle: `src/renderer/src/SecondaryWindow.tsx:46-53,111-129`. Laut Ledger nicht live geprüft. Der Code liest sich richtig: Listener vor dem Katalogabruf, `core.vaultLocked`-Fallback, `inert`, `LockScreen` ohne Formular. Er hat aber keinen einzigen Lauf hinter sich, und der Treiber kann Fenster wechseln (`driver.mjs:79-80`, Routen `windows` und `use?i=`).
- Szenario: Ein Fehler würde unbemerkt ausgeliefert, etwa wenn `announce` die Nebenfenster nicht erreicht oder `inert` am falschen Element sitzt. Das Nebenfenster bliebe dann während der Sperre voll bedienbar, mit laufenden SSH-Sitzungen ohne Passwort. Das ist der Kern des Features.
- **Fix (bindend):** Neuer Block `lockSecondary` in `screens.mjs`. Er läuft ohne Argument mit und ist einzeln über `lock-secondary` aufrufbar.
  1. `.view-add` klicken, in der neuen Ansicht `web-01` verbinden und auf den verbundenen Tab warten wie in I2.
  2. Rechtsklick auf den Tab der aktiven Ansicht, dann `menuItem('In neues Fenster verschieben')`.
  3. Mit `call('windows')` warten, bis eine URL `role=secondary` enthält. Die Indizes von Haupt- und Nebenfenster merken.
  4. `use` Hauptfenster, `.lock-button` klicken.
  5. `use` Nebenfenster:
     - `waitFor` auf `dialog.lock-screen[open]`
     - `document.querySelector('.vault-shell').inert === true`
     - `!document.querySelector('.lock-screen form')`
     - Ctrl+Shift+Space darf kein `.workflow-palette`/`dialog[open]` außer der Sperre öffnen; der Selektor wird beim Umsetzen aus `WorkflowPalette.tsx` übernommen.
     - Screenshot `lock-secondary`.
  6. `use` Hauptfenster, mit `synthetic-vault-demo` entsperren.
  7. `use` Nebenfenster: `!document.querySelector('dialog.lock-screen[open]')`, und der `web-01`-Tab ist `tab-status-connected`.
  8. Aufräumen: Im Nebenfenster `closeTabs()` aufrufen (das Fenster schließt mit dem letzten Tab), danach `use` Hauptfenster.

  `SKILL.md` listet `lock-secondary.png` und den Blocknamen.
- **Test:** Der Block selbst; der Screenshot wird angesehen.

**I4 – Die Wiederaufnahme-Entscheidung in Main ist ungetestet.**
- Stelle: `src/main/vault/ipc.ts:190`.
- Fehler: B2 war ein Blocker. Getestet ist nur `lockedVault()` (`session.test.ts:106-119`), nicht der Vergleich, der über `onSessionChange` entscheidet. Ein Regress fiele nicht auf, etwa ein Vergleich nur über den Pfad oder ein `||` statt `&&`. Eine ersetzte Datei würde dann alle Sitzungen des alten Vaults behalten.
- **Fix (bindend):** In `src/main/vault/session.ts` exportieren:
  ```ts
  /** Only the same vault in the same file keeps its sessions; a replaced file counts as a switch. */
  export function resumesLocked(previous: LockedVault | undefined, snapshot: { filePath: string; vault: { id: string } }): boolean {
    return previous?.filePath === snapshot.filePath && previous.vaultId === snapshot.vault.id;
  }
  ```
  `vault/ipc.ts:189-190` nutzt `const resumed = resumesLocked(previous, snapshot);`. Der Kommentar wandert an die Funktion.
- **Test** (`session.test.ts`):
  - gleicher Pfad und gleiche ID → `true`
  - gleicher Pfad, andere ID → `false`
  - anderer Pfad, gleiche ID → `false`
  - `undefined` → `false`

### Minor

**M1 – Die englische Doku nennt den Knopf falsch.**
- Stellen: `docs/manual.md:62,371` und `CHANGELOG.en.md:11` schreiben `Another vault file`. UI und Spec 5 sagen „Other vault file“ (`en-US/app.json` `lock.switch`). Die Minor aus dem Ledger („en-Zitate im Manual gegen Locales prüfen“) ist damit nicht erledigt.
- **Fix:** An allen drei Stellen `Other vault file`.
- **Test:** `grep -n "Another vault file" docs CHANGELOG.en.md` liefert nichts.

**M2 – Eine veraltete Explorer-Rückfrage überlebt den Vault-Wechsel.**
- Stelle: `src/renderer/src/App.tsx:642-647`. Das alte `afterLock` setzte `setPendingVaultFile(null)`. `switchVault` tut das nicht.
- Szenario: Während der Sperre kommt eine `.term` aus dem Explorer, der Dialog liegt korrekt unter der Sperre. Der Nutzer wählt „Andere Vault-Datei“ und öffnet einen anderen Vault. Danach erscheint „Vault-Datei X öffnen?“, und ein Klick würde sofort wieder trennen.
- **Fix:** In `switchVault` nach `setLocked(null)` den Aufruf `setPendingVaultFile(null);` einfügen. Der Explorer-Pfad gibt seine Datei ohnehin als `filePath` mit (K10).
- **Test:** keine DOM-Testumgebung (O8). Abnahme per Review des Diffs; der Typecheck bleibt grün.

**M3 – Die Neuanhebung verschüttet die eigene Wechsel-Rückfrage.**
- Stelle: `LockScreen.tsx:38-40,80,85-86`.
- Szenario: Die Rückfrage „Andere Vault-Datei öffnen?“ ist offen, und es öffnet ein fremder modaler Dialog (Konflikt, Explorer). Der Observer hebt den Sperrbildschirm über seine eigene Kind-Rückfrage. Sie ist dann unsichtbar unter der deckenden Fläche, und `confirmSwitch` bleibt `true`. Ein weiterer Klick auf „Andere Vault-Datei“ tut nichts mehr, der Wechsel ist bis zum Entsperren tot.
- **Fix:** Im Observer-Zweig nach `dialog.close(); dialog.showModal();` auch `setConfirmSwitch(false);` aufrufen. Die Rückfrage schließt, der nächste Klick öffnet sie neu oben.
- **Test:** run-app `lock`, nach der Neuanhebungs-Probe:
  1. `.lock-screen .secondary-button` klicken.
  2. Probe-Dialog wie in K14 Schritt 5 anhängen.
  3. `!document.querySelector('.lock-screen dialog[open]')` prüfen.
  4. Erneut klicken: `.lock-screen dialog[open]` ist da.
  5. `Escape` zum Abbrechen, Probe entfernen.

**M4 – Das Nebenfenster gibt den Fokus nach dem Entsperren nicht zurück.**
- Stelle: `SecondaryWindow.tsx:46-47`. Das Hauptfenster stellt den Fokus über `lockReturnFocus` wieder her (`App.tsx:633`), das Nebenfenster lässt ihn auf `<body>`. Die Tastatur geht danach ins Leere, bis man klickt.
- **Fix:** Wie im Hauptfenster:
  - Ein `useRef<HTMLElement | null>` merkt sich im `onVaultLocked`-Listener `document.activeElement`, wenn es ein `HTMLElement` ist.
  - `onVaultUnlocked` setzt `setLocked(false)` und fokussiert per `requestAnimationFrame` das Ziel, falls `isConnected`.
- **Test:** run-app `lockSecondary` Schritt 7, zusätzlich:
  ```js
  document.activeElement?.classList.contains('xterm-helper-textarea')
  ```
  Vorher in Schritt 1 ins Terminal klicken.

**M5 – Die cmd-Umbenennung fehlt im CHANGELOG.**
- Stelle: `70ba192` ist eine sichtbare Änderung (Verbindungsart, Menü „Neu“). Sie steht in keinem Punkt von 0.15.0.
- **Fix:** Je ein Punkt in `CHANGELOG.md` und `CHANGELOG.en.md` unter 0.15.0, gleiche Anzahl:
  - de: „Die lokale Eingabeaufforderung heißt jetzt cmd (lokal).“
  - en: “The local command prompt is now called cmd (local).”
- **Test:** `npx vitest run` (Changelog- und Versionstests) grün.

**M6 – Manuelle Prüfungen O1 und O2 aus dem Anhang sind offen.**
- Stelle: Ledger, Abschnitt „Abnahme run-app“. Weder die Taskleisten-Vorschau eines minimierten, automatisch gesperrten Fensters (O1) noch der Tastaturfokus nach dem Verstecken einer fokussierten RDP-Fläche (O2) sind vermerkt.
- **Fix:** Nach der Fix-Welle führt der Orchestrator beide Prüfungen mit run-app aus (Auto-Sperre 1 Minute, Fenster minimiert, Hover über das Taskleistensymbol) und trägt das Ergebnis ins Ledger ein: OK oder ACCEPTED mit Folgeschritt `setContentProtection` laut O1.
- **Test:** Eintrag im Ledger.

---

## 3. Fix-Welle

Gate danach: `npm run typecheck` und `npx vitest run` grün. Anschließend run-app mit `lock`, `lock-secondary` und `welcome`; die Screenshots `lock-screen.png`, `lock-secondary.png` und `welcome.png` werden angesehen. Zum Schluss M6 durch den Orchestrator. Umsetzer committen nicht.

| Task | Dateien (exklusiv) | Befunde |
|---|---|---|
| **F1 Code** | `src/renderer/src/components/LockScreen.tsx`, `src/renderer/src/App.tsx`, `src/renderer/src/SecondaryWindow.tsx`, `src/main/vault/session.ts`, `src/main/vault/session.test.ts`, `src/main/vault/ipc.ts` | I1 (`readOnly`), I4 (`resumesLocked` + 4 Tests), M2 (`setPendingVaultFile(null)`), M3 (`setConfirmSwitch(false)` im Observer), M4 (Fokus im Nebenfenster) |
| **F2 Prüfung und Doku** | `.claude/skills/run-app/screens.mjs`, `.claude/skills/run-app/SKILL.md`, `docs/manual.md`, `CHANGELOG.md`, `CHANGELOG.en.md` | I2 (Entsperr-Prüfung, Fokusprüfung, Probe-Marker, Gegenprobe), I3 (Block `lockSecondary`), Tests aus M3/M4 im Szenario, M1, M5 |

F1 und F2 berühren keine gemeinsame Datei. Die run-app-Prüfungen aus F2 für I1, M3 und M4 schlagen erst nach F1 an. Deshalb läuft run-app nach der Welle, nicht je Task.
