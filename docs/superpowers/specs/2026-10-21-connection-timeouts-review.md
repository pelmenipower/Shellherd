# Verbindungs-Timeouts und Vault-Auto-Sperre – Review

Geprüft am 2026-10-21: `claude/feature/connection-timeouts` (`b6d4700`) gegen `claude/feature/sftp-auto-upload`, also `git diff claude/feature/sftp-auto-upload...HEAD` (10 Commits, 62 Dateien). Grundlage sind die Spec `2026-10-21-connection-timeouts-design.md`, der bindende Anhang `2026-10-21-connection-timeouts-validation.md` (Vertrag 1.1–1.7, B1–B3, K1–K22) und das Ledger `.superpowers/sdd/2026-10-21-connection-timeouts/progress.md`.

Stand: `npm run typecheck` grün, `npx vitest run` mit 128 Dateien und 1815 Tests grün. Der Arbeitsbaum ist sauber.

**Urteil: ready after fixes.** 0 Critical, 0 Important, 4 Minor mit Fix, dazu 4 hingenommene Punkte. Der Branch erfüllt Vertrag, B1–B3 und alle K. Die Fix-Welle besteht aus Kosmetik, einem fehlenden Test und einer Härtung. Keiner der Punkte blockiert den Merge in `staging`.

---

## 1. Sicherheit

| Prüfpunkt | Ergebnis | Beleg |
|---|---|---|
| Schlüssel genullt | ja | `index.ts:271` `lockNow` → `vaultSessionManager.lock()` → `vault/session.ts:120` `key.fill(0)`. Das ist derselbe Weg wie beim manuellen Sperren (`vault/ipc.ts:217-218`). |
| Alle Sitzungen und Nebenfenster zu | ja | `closeAllSessions` (`index.ts:55`) schließt SSH, RDP, SFTP, KI, Container-Erkennung und Kube. `closeSecondaryWindows` (`:61-67`) schließt die Nebenfenster. Im Renderer setzt `afterLock` (`App.tsx:601-611`) Tabs, Formular, Dialog, `pendingVaultFile` und `busy` zurück. |
| Spätes Speichern | sicher | `encryptVaultWithKey` läuft in `vault/session.ts:82` synchron vor dem ersten `await`. Eine Sperre währenddessen kann also nicht mit genulltem Schlüssel verschlüsseln. Im Renderer prüft `persistVaultWith` (`usePersistVault.ts:27-36`) den Epoch nach dem `await`, im Erfolg wie im Fehler. Der Test deckt beide Ausgänge ab. B3 ist erfüllt. |
| `vault:activity`-Grenze | ja | `index.ts:285-287`: Es zählen nur registrierte Fenster (`roleOf`) aus dem Main-Frame. Der Handler liest keinen Payload, antwortet nicht und ist O(1). |
| Kann ein Renderer die Sperre auslösen? | nein | `vault:locked` geht nur von Main an das Hauptfenster (`index.ts:277`). Einen Renderer-Kanal, der die Auto-Sperre auslöst, gibt es nicht. |
| Kann ein Renderer die Sperre verhindern? | ja, gewollt | Ein Renderer, der Pings flutet, hält den Vault offen. Er hält aber ohnehin den entschlüsselten Vault. Das ist kein neues Risiko. |
| Rennen zwischen Entsperren und Tick | Restrisiko | Das ist Risiko 8 des Anhangs. `onSessionChange` ruft `touch()` (`index.ts:266`). `minutes()` liefert im gesperrten Zustand 0. Nach `lock` wird der Zeitstempel zurückgesetzt, deshalb gibt es keine Doppelsperre (Test `auto-lock.test.ts`). |
| Secrets in IPC/Logs | keine | `VaultLockedInfo` trägt nur `{ minutes }`. Die Zahlenfelder führen keine Geheimnisse. |
| Nur lesen, Exec nur per Klick, kubeconfig | nicht berührt | Der Diff ändert weder Kube-Aktionen noch Exec-Pfade noch das kubeconfig-Handling. `kubernetes/ipc.ts` bekommt nur das Timeout-Argument für `openRemoteHost`. |

## 2. Zusammenspiel und Abdeckung der Spec

- **Leerlauf SSH (K4):**
  - `armIdle` (`ssh/session.ts:453-464`) arbeitet mit genau einem Timer und dem Zeitstempel-Muster. `output()` stempelt in `:485`, `input()` in `:526`.
  - `finish` räumt in `:588` auf. Lokale Shells lesen keine Timeouts; der Test `local-shell.test.ts` prüft das.
  - Kube-Pods bekommen `idleMs` in `:232`. SSH und Container-Tabs bekommen ihn in `:239-240`. Die Weitergabe an `sshConnectConfig` steht in `:256`.
- **Leerlauf SFTP (K5):**
  - `owned()` stempelt in `:153`, `pump()` im `finally` in `:279`.
  - Die Prüfung „beschäftigt“ (`:138-148`) folgt K5 wörtlich: `running`, eingereihte Jobs, Syncs außer `error`, offene Bearbeitungen.
  - `finish` löscht zuerst den Timer (`:344`).
  - `syncs.list()` und `edits.list()` sind die echten Typen `AutoUploadManager`/`RemoteEdits`. Der Typecheck bindet `state` an `AutoUploadState`.
- **Timeouts (K2, K19, K20):** Alle vier Aufrufer von `sshConnectConfig` sind erfasst. `connection-test.ts` ist unverändert; ein Test prüft `readyTimeout: 120_000` und `keepaliveInterval: 0` trotz Override. Container und Kube reichen `effectiveTimeouts` durch, `files/ipc.ts` und `ssh/ipc.ts` verdrahten `getTimeouts`.
- **Renderer (K11, K12, K14, K15):**
  - Die Zahlenfelder übernehmen den Wert bei Blur oder Enter. Bei `busy` sind sie `readOnly`, der Fokus bleibt also erhalten (Abnahme OK).
  - Ein Fehlerwert erscheint als `.field-error` mit `role="alert"` und `aria-invalid`. `useEffect([value])` gleicht Rollback und Neuladen ab.
  - Esc verwirft den Entwurf, weil der Dialog schließt (Risiko 11).
  - `keepAutoUpload` behält `timeouts` (Test `connection-form.test.ts`).
  - Der Hinweis auf der Startseite verschwindet über `resetForm()`, also bei `navigateTo`, Entsperren, Anlegen und manuellem Sperren. Nach der Auto-Sperre bleibt er stehen, weil `setAutoLockedAfter(minutes)` nach `afterLock()` läuft (`App.tsx:614`).
- **Regeln:**
  - i18n: Parität und Plural `autoLocked_one/_other`, keine Literale, Test grün.
  - Token `--input-number` mit Rolle in `tokens.css:57` und Zeile in `design-system.md`.
  - Motion-Gate: Zeile für die Getrennt-Leiste angepasst, sonst keine neue Bewegung.
- **Doku (K18):** Alle Pflichtsätze stehen in Handbuch und CHANGELOG, die Version ist 0.14.0.

---

## 3. Befunde

### Critical

Keine.

### Important

Keine.

### Minor

**M1 – Doppelter Test-Block.** `src/renderer/src/connection-error-text.test.ts:62-73`
- Befund: `describe('connectionError idle', …)` steht zweimal wortgleich hintereinander. Das ist ein Merge- oder Kopierfehler und testet nichts zusätzlich.
- **Fix:** Den zweiten Block (`:68-73`) löschen.
- **Test:** Der verbleibende Block läuft weiter grün.

**M2 – SSH-Pfad: Weitergabe der Timeouts und Scharfschalten in `attachStream` ungetestet (Ledger 1B).** `src/main/ssh/session.ts:239-240, :256, :294`
- Befund: Die Idle-Tests laufen nur über Pod-Terminals (`startKubeTerminal`).
- Fehlerszenario: Ein späteres Refactoring entfernt `timeouts` aus dem Aufruf `sshConnectConfig(…, timeouts)` oder das `armIdle` in `attachStream`. Alles bleibt grün, SSH-Terminals ignorieren dann die Einstellungen still. Der Code ist heute korrekt.
- **Fix:** nur ein Test, kein Produktivcode. In `src/main/ssh/session.test.ts` kommt nach `describe('idle disconnect')` ein `describe('SSH timeouts')` mit einem Test (echter Testserver aus dem `beforeEach`):
  - `const connect = vi.spyOn(Client.prototype, 'connect');` (call-through; `Client` aus `ssh2` importieren) und `const timer = vi.spyOn(globalThis, 'setTimeout');`
  - `const getTimeouts = vi.fn(() => ({ idleMinutes: 1, keepaliveSeconds: 7, keepaliveCount: 2, connectSeconds: 30 }));`
  - `const timed = new SshSessionManager({ getConnection: () => structuredClone(connection), verifyHost: async () => true, spawnShell: noShell, getTimeouts, emit: (_owner, event) => events.push(event) });`
  - `const id = timed.prepare(1, { connectionId: connection.id, cols: 80, rows: 24 }).sessionId; await timed.connect(1, id); await waitFor(() => hasStatus('connected'));`
  - Erwartungen:
    - `expect(getTimeouts).toHaveBeenCalledWith(expect.objectContaining({ id: connection.id }));`
    - `expect(connect).toHaveBeenCalledWith(expect.objectContaining({ readyTimeout: 30_000, keepaliveInterval: 7_000, keepaliveCountMax: 2 }));`
    - `expect(timer).toHaveBeenCalledWith(expect.any(Function), 60_000);`
  - Im `finally`: `timed.closeAll(); connect.mockRestore(); timer.mockRestore();`

**M3 – Zahlenfelder im Einstellungsdialog nicht bündig (Abnahme, Kosmetik).** `src/renderer/src/settings-ui.css:15-17`, `src/renderer/src/components/SettingsDialog.tsx:56, :99-116`
- Befund: Jede `.settings-number` ist eine eigene Flex-Zeile. Das Feld beginnt deshalb dort, wo das Label endet, und die Label sind je Zeile (und je Sprache) verschieden breit.
- Bewertung: Der Fix lohnt sich, denn er ist klein, braucht keinen neuen Token und hat keine Bewegung. Eine feste Label-Breite als Token taugt nicht, weil die Labels in de-DE und en-US verschieden lang sind. Ein gemeinsames Grid mit `subgrid` richtet die Spalten nach dem längsten Label aus. Electron 44 (Chromium ≥ 117) unterstützt `subgrid`.
- **Fix:**
  - `SettingsDialog.tsx`: Die `NumberSetting`-Zeilen jedes Abschnitts kommen in `<div className="settings-numbers">…</div>`.
    - Abschnitt `vault`: nur die Zeile `autolock`, der Hint bleibt danach außerhalb.
    - Abschnitt `connections`: die vier Zeilen, `timeouts.hint` danach außerhalb.
    - `NumberSetting` selbst bleibt unverändert.
  - `settings-ui.css`: Die Zeilen 15–17 werden ersetzt durch:

    ```css
    .settings-numbers { display: grid; grid-template-columns: max-content var(--input-number) 1fr; align-items: center; gap: var(--space-8); margin-top: var(--space-8); color: var(--color-text); font-size: var(--fs-md); }
    .settings-number { display: grid; grid-column: 1 / -1; grid-template-columns: subgrid; align-items: center; }
    .settings-number input { width: var(--input-number); }
    .settings-number .field-error { grid-column: 2 / -1; margin: 0; }
    ```
  - Keine neuen Tokens, keine Bewegung. `design-system.md` bleibt unverändert, weil `--input-number` seine Rolle behält.
- **Test:**
  - `npx vitest run src/renderer/src/design-tokens.test.ts` grün.
  - Skill `run-app`, Screenshot `settings` in den Abschnitten Verbindungen und Vault: Die Feldkanten stehen bündig, auch mit sichtbarem Fehler unter einem Feld. Einmal in en-US prüfen.

**M4 – Auto-Sperre nicht ausnahmefest.** `src/main/index.ts:271-278`
- Befund: `lockNow` ruft `closeAllSessions(); closeSecondaryWindows(); vaultSessionManager.lock();` nacheinander auf.
- Fehlerszenario: Ein `closeAll` eines Managers wirft, zum Beispiel ein zerstörtes `webContents` beim Emit.
  - Die Ausnahme geht aus dem `setInterval`-Callback unbehandelt hoch.
  - Der Schlüssel wird nicht genullt, und das Hauptfenster bekommt kein `vault:locked`. Es zeigt also weiter den entschlüsselten Vault.
  - Beim nächsten Tick passiert dasselbe, denn `lastActivity` wurde vor `lock` schon zurückgesetzt.
  - Beim manuellen Sperren hat der Renderer wenigstens ein `finally`. Die Auto-Sperre hat niemanden, der eingreift.
- **Fix:**
  - `const lockNow = (): void => { try { closeAllSessions(); closeSecondaryWindows(); } finally { vaultSessionManager.lock(); } };`
  - Im `lock`-Callback läuft das Senden von `vault:locked` im `finally` nach `lockNow()`: `try { lockNow(); } finally { const main = …; if (main && !main.isDestroyed()) main.webContents.send(…); }`.
  - Sonst ändert sich nichts. Der manuelle Pfad in `vault/ipc.ts` ist alt und bleibt außerhalb dieses Branches.
- **Test:** `index.ts` hat keinen Test-Harness. Der Nachweis erfolgt per Diff in der Nachprüfung. Dazu kommen Typecheck und die vollständige Suite grün sowie Abnahmeschritt 2 (Auto-Sperre 1 min) in `run-app` erneut OK.

### Hingenommen (kein Fix, Begründung)

- **H1 – Lange SFTP-Einzeloperationen zählen nicht als beschäftigt.** `files/sftp-session.ts:174-191`: rekursives `delete`/`chmod` und großes `list` stempeln `lastIo` nur beim Start. Abbrechen kann das nur eine Operation, die länger dauert als die Leerlaufzeit (mindestens 1 min, typisch 15 min und mehr). Die Folge ist ein Fehler im Fenster und eine teilweise ausgeführte Aktion, die der Nutzer ohnehin wollte. Ein Zähler für laufende Aufrufe wäre neuer Code ohne Auftrag. Upgrade, wenn es gemeldet wird.
- **H2 – `minutes()` klont alle 30 s den ganzen Vault** (`index.ts:274` über `getSnapshot()`). Der Vault ist klein, und das Klartext-Objekt liegt ohnehin im Main-Speicher. Kein Fix.
- **H3 – Ledger 1G (Busy-Tests setzen interne Felder):** hinnehmen. Die Prüfung nutzt nur `list()` der echten Klassen, und der Typecheck bindet die Zustände an `AutoUploadState`. Ein Test mit echtem Auto-Upload braucht den Loopback-Server (`sftp-loopback.test.ts`), und das kostet mehr, als es bringt. Für echte Bindungen deckt das Handbuch R13 ab.
- **H4 – Ledger 1F (`afterLock` leert `pendingVaultFile` auch beim manuellen Sperren) und 0A (`fakes.test.mjs` flaky):** hinnehmen. 1F ist korrekt: Bei offenem Dialog ist das Sperren nicht erreichbar, und `onConfirm` leert vor `lockVault`. 0A liegt im Werkzeug `run-app` außerhalb dieses Branches und war in diesem Lauf grün.
- **Ledger 1B:** wird mit M2 behoben.

---

## 4. Fix-Welle (bindend)

Gate: `npm run typecheck` und `npx vitest run` grün, danach ein Commit pro Task. Umsetzer fassen nur ihre Dateien an und committen nicht selbst.

| Task | Dateien (exklusiv) | Befunde | Pflicht |
|---|---|---|---|
| **F1 Einstellungen bündig** | `src/renderer/src/components/SettingsDialog.tsx`, `src/renderer/src/settings-ui.css` | M3 | Wrapper `.settings-numbers`, CSS wörtlich aus M3, Screenshot `settings` (de-DE und en-US, einmal mit Fehlerzeile) |
| **F2 Tests und Härtung** | `src/main/ssh/session.test.ts`, `src/renderer/src/connection-error-text.test.ts`, `src/main/index.ts` | M1, M2, M4 | Doppelten Block löschen, SSH-Timeout-Test wörtlich aus M2, `try/finally` in `lockNow` und im `lock`-Callback |

Es gibt keine Abhängigkeit zwischen F1 und F2.
