# Windows Hello – Nachprüfung Runde 2

Grundlage:
- Review `2026-10-25-windows-hello-review.md` (I-1, M-1 bis M-4)
- Ledger `.superpowers/sdd/2026-10-25-windows-hello/progress.md`. Fix-Welle FA (I-1, M-3) und FB (M-1, M-2). M-4 bleibt als manueller Test M5/M6 geführt.
- Fix-Diff `18b2373..aae657b`: `08dc83a` (I-1, M-3, Szene 5b) und `aae657b` (M-1, M-2)

**Urteil: ready.** Von 5 Befunden sind 4 ADDRESSED und 1 ACCEPTED (M-4), keiner ist PARTIAL oder NOT ADDRESSED. Neu sind 0 Critical, 0 Important und 2 Minor (N-1, N-2). N-1 ist eine CSS-Zeile und sollte vor dem Release 0.26.0 mitkommen, blockiert aber nicht.

Gates: `npm run typecheck` ist grün. `npx vitest run` ist grün mit 165 Dateien und 2565/2565 Tests, 2 mehr als im Review (`hello.test.ts` und `ipc.test.ts` je +1). Kein Flake trat auf. `src/` und `scripts/` sind sauber, die Läufe gelten also für `aae657b`.

Live: Ich habe keine eigene Treiber-Probe gemacht. Szene `hello` mit Schritt 5b ist laut Ledger (run-app Runde 2) grün. Die Shots in `%TEMP%\shellherd-run\shots\` sind von 10:58 und damit vom Stand des Fixes. Ich habe `hello-setting.png` angesehen. Es wurde kein Hello-Dialog ausgelöst und weder ein echter Vault noch `%APPDATA%\Shellherd` geöffnet. Nach `out/` wurde nichts gebaut.

---

## Befunde aus dem Review

### I-1 Veralteter Hello-Status auf dem Sperrbildschirm – ADDRESSED
**Hauptfix (`src/renderer/src/hello.ts:21`)**: Fehlt der Pfad, ruft der Hook `setState(null)` auf. `App.tsx:198` übergibt `locked ? vaultPath : null`. Der Status wird also beim Entsperren verworfen, und beim nächsten Sperren startet der Sperrbildschirm mit `null`. Der Knopf fehlt dann, bis die frische Antwort `enrolled: true` meldet.
- Damit ist die Ursache behoben, nicht nur die Folge.
- Die Rückgabe ist nach `helloStatusOf` (`:12-13`) ausgelagert, mit Test `keeps a cached status only for its own vault path`.
- `refresh()` behält den alten Wert weiter. Das ist richtig, denn der Pfad bleibt gleich.

**Absicherung (`LockScreen.tsx:39-42`)**: Verschwindet der Knopf und liegt der Fokus auf `body`, geht er ins Passwortfeld.

**Die Fälle aus dem Auftrag:**

| Fall | Ablauf | Ergebnis |
|---|---|---|
| Status kommt asynchron nach dem ersten Render, Hello an | Der erste Render hat `helloOffered = false` und `autoFocus` im Feld. Die Antwort setzt `true`, und der erste Zweig fokussiert den Knopf, solange kein Passwort getippt ist. | wie R3.2 |
| Status kommt asynchron, Hello aus (Szenario M10) | `helloOffered` bleibt `false`, der Effekt läuft nicht erneut, der Fokus bleibt im Feld. Mit dem Hauptfix gibt es kein Aufblitzen mehr. | Szene 5b prüft es: kein Knopf, `activeElement` ist das Passwortfeld |
| Knopf fokussiert, dann ungültig (stale, `refresh`) | `LockScreen.tsx:74` setzt den Fokus schon im Fehlerpfad ins Feld. Der Effekt findet danach `activeElement` gleich Feld, nicht `body`, und tut nichts. | Feld |
| Knopf verschwindet, Fokus lag auf ihm | Chromium setzt `activeElement` auf `body` (im Review belegt). Der zweite Zweig greift. | Feld |
| Nutzer hat bewusst etwas anderes fokussiert, z. B. „Andere Vault-Datei“, und der Knopf verschwindet | Der zweite Zweig greift nur bei `activeElement === document.body`. Der Fokus bleibt also, wo der Nutzer ihn hingelegt hat. | bleibt bei „Andere Vault-Datei“ |
| Bestätigung „Andere Vault-Datei“ ist offen | Die Elemente außerhalb des obersten Modals sind inert, also bleibt jedes `focus()` ohne Wirkung. | Fokus bleibt im Bestätigungsdialog |
| Erster Mount, `activeElement` ist `body` | `field.focus()` läuft vor `showModal()` (Effekt-Reihenfolge) und bleibt ohne Wirkung. Danach setzt `autoFocus` den Fokus. | Feld, harmlos |

Ein Rest bleibt im **ersten** Zweig, und der ist älter als dieser Fix (N-2).

Den Rückfallzweig prüft kein automatischer Test, denn nach dem Hauptfix tritt der Fall in der Szene nicht mehr auf. Das ist hinnehmbar, weil er nur eine Absicherung ist.

### M-1 Rückfallpfad `C:Windows` – ADDRESSED
- `scripts/build-hello.mjs:18` lautet jetzt `'C:\\Windows'`. Die Bytes habe ich mit `od -c` geprüft: zwei Backslashes. Damit gleicht die Zeile `build-rdp-host.mjs:18` (K6).

### M-2 Kein Test für gleichen Salt mit falschem Schlüssel – ADDRESSED
- `src/main/vault/ipc.test.ts:130-137`, Test `drops the entry when the same salt does not open the file`:
  - Die Datei wird mit `encryptVaultWithKey(exampleVault, randomBytes(32), file.kdf)` ersetzt, also mit demselben KDF-Salt und einem anderen Schlüssel.
  - Erwartet wird `core.helloStale`, danach meldet `helloStatus` `enrolled: false`.
- Der Test trifft den Zweig `ipc.ts:248-257`. Der Salt-Vergleich in `hello.ts:130` passt, GCM öffnet, erst `unlockVaultWithKey` scheitert. Laut Ledger war der Code schon richtig, der Test sperrt jetzt Regressionen.

### M-3 Ausschnitt von `hello-setting.png` – ADDRESSED
- `.claude/skills/run-app/screens.mjs:918-920` scrollt die Überschrift „Vault“ nach oben und bricht mit einer Meldung ab, wenn der Abschnitt fehlt.
- Im Shot sind „VAULT“, „Vor dem Trennen laufender Sitzungen nachfragen“, die Auto-Sperre und das gesetzte Hello-Kästchen mit „Windows Hello ist für diesen Vault eingeschaltet.“ zu sehen. Dabei fiel N-1 auf.

### M-4 Abfrage bleibt nach Sperre oder Zeitlimit stehen – ACCEPTED
- Wie im Review festgelegt, ist das nur am Gerät prüfbar. Es gehört zu M5 (Zeitlimit, Schließen) und M6 (Auto-Sperre während des Einschaltens), siehe Liste unten.
- Sicher ist es in jedem Fall, denn ohne Signatur an Main entsteht nichts. Ein Satz im Handbuch kommt nur, wenn M5 oder M6 am Gerät auffallen.

---

## Neue Befunde

### Critical
Keine.

### Important
Keine.

### Minor

**N-1 – Hello-Kästchen klebt am Hinweis zur Auto-Sperre (Beobachtung des Orchestrators bestätigt)**
- **Stelle**: `src/renderer/src/components/SettingsDialog.tsx:152-153` mit `src/renderer/src/settings-ui.css:7-8`.
  - Auf `<p class="settings-hint">` (Auto-Sperre) folgt direkt `<label class="settings-check">` aus `HelloSetting.tsx:24`.
  - `.settings-hint` hat nur `margin-top: var(--space-4)`, `.settings-check` hat gar keinen Außenabstand. Der Abstand ist also 0.
  - Alle anderen Bedienelemente nach einem Hinweis bringen ihren Abstand selbst mit: `.settings-numbers` und `.settings-field` haben `margin-top: var(--space-8)`, und `Server-Schlüssel verwalten` hat ebenfalls einen.
- **Folge**: Im Shot liegt „Mit Windows Hello entsperren …“ ohne Luft unter „… Tabs bleiben erhalten.“ Die Zeile wirkt so, als gehöre sie zum Auto-Sperre-Hinweis. Die Gruppierung leidet, die Funktion nicht.
- **Fix, Token-konform, eine Zeile in `src/renderer/src/settings-ui.css` nach Zeile 8**:
  ```css
  .settings-hint + .settings-check { margin-top: var(--space-8); }
  ```
  - `var(--space-8)` ist derselbe Abstand wie bei `.settings-numbers` und `.settings-field` nach einem Hinweis. Ein neues Token ist nicht nötig.
  - Der Selektor trifft heute nur diese Stelle. Das erste Kästchen im Abschnitt folgt auf `h3`, und „Cursor blinkt“ folgt auf `.settings-field`.
  - Keine Bewegung, also kein Motion-Gate. `design-tokens.test.ts` bleibt grün.
- **Am Rand**: „Cursor blinkt“ (`SettingsDialog.tsx:195`) klebt aus demselben Grund am Cursor-Feld. Das ist älter und nicht Teil dieses Pakets. Wer es mitnehmen will, ergänzt den Selektor um `.settings-field + .settings-check`.
- **Probe nach dem Fix**: Szene `hello`, Shot `hello-setting.png`.
- **Eigentümer**: `src/renderer/src/settings-ui.css`.

**N-2 – Der erste Fokus-Zweig kann einen bewusst gesetzten Fokus übernehmen (älter als der Fix, optional)**
- **Stelle**: `LockScreen.tsx:40`. Kommt `enrolled: true` erst an, nachdem der Nutzer schon per Tab auf „Andere Vault-Datei“ gegangen ist und das Feld noch leer ist, springt der Fokus auf den Hello-Knopf.
- **Zeitfenster**: Das ist die Laufzeit des Status-Helfers, laut Review rund 200 ms und bei kaltem Start eventuell länger. Es wird nichts ausgelöst, R3.3 ist also nicht berührt.
- **Fix-Richtung, optional**: Den Fokus nur dann übernehmen, wenn er noch auf dem Feld oder auf `body` liegt:
  ```ts
  if (helloOffered && field.current?.value === '' && (document.activeElement === field.current || document.activeElement === document.body)) helloRef.current?.focus();
  ```
- **Eigentümer**: `src/renderer/src/components/LockScreen.tsx`.

---

## Manuelle Tests für den Nutzer (echte Hello-Hardware)

Die Tests laufen mit dem gepackten Build (`npm run dist`) und einem Test-Vault, nicht mit dem Arbeits-Vault.

1. **M1 Einschalten:** Setze in Einstellungen → Vault das Hello-Kästchen. Windows fragt zweimal vor Shellherd, danach steht „Windows Hello ist für diesen Vault eingeschaltet.“ da.
2. **M2 Sperren und entsperren:** Nach `Vault sperren` liegt der Fokus kurz darauf auf dem Hello-Knopf. `Enter` und die PIN entsperren, und offene Sitzungen laufen weiter.
3. **M3 Determinismus (entscheidet über das Release):** Wiederhole M2 zweimal, starte Shellherd neu und öffne mit `Mit Windows Hello öffnen`. Kommt dabei einmal „passt nicht mehr“, wird nicht veröffentlicht.
4. **M4 Gesicht oder Finger:** Wiederhole M2, falls vorhanden, mit Gesicht oder Finger statt PIN.
5. **M5 Abbrechen, Zeitlimit, Schließen:** Ein Abbruch bleibt still, und der Fokus liegt danach auf dem Knopf. Nach 2 Minuten erscheint „Windows Hello hat nicht geantwortet.“, und eine späte Bestätigung entsperrt nicht. Notiere, ob der Windows-Dialog nach dem Zeitlimit oder nach dem Schließen von Shellherd offen bleibt.
6. **M6 Auto-Sperre:** Nach 1 Minute erscheint der Sperrbildschirm mit Grund und Hello-Knopf, ohne dass Shellherd von selbst fragt. Lässt du eine Einschalt-Abfrage über die Auto-Sperre hinaus offen, bleibt Hello danach aus.
7. **M7 Aus dem Hintergrund:** Hole ein anderes Programm nach vorn, klicke dann Shellherd an und starte Hello. Die Abfrage erscheint vorn und nicht nur in der Taskleiste.
8. **M8 Freigabe:** Während einer Bildschirmaufnahme ist Shellherd beim Entsperren unsichtbar. Die Windows-Abfrage darf zu sehen sein.
9. **M9 Datei ersetzt:** Ersetzt ein anderer Vault die Datei am selben Pfad, zeigt Shellherd „passt nicht mehr“ ohne Windows-Abfrage. Der Knopf verschwindet, und der Fokus liegt im Passwortfeld.
10. **M10 Ausschalten:** Entferne das Kästchen und sperre. Es erscheint kein Hello-Knopf, auch nicht kurz, und der Fokus liegt im Passwortfeld. In `hello-unlock.json` steht kein Eintrag mehr.
11. **M11 Paket ignoriert den Fake:** Starte den gepackten Build mit `set SHELLHERD_HELLO_FAKE=ok`. Trotzdem kommt die echte Windows-Abfrage.
12. **M12 Hello neu eingerichtet (optional, verändert Windows):** Nach dem Zurücksetzen der PIN meldet der Knopf „passt nicht mehr“ und löscht alle Einträge. Danach lässt sich Hello mit zwei Abfragen neu einschalten.
13. **M13 Remotedesktop:** Über RDP fehlt der Knopf, oder es erscheint „hat nicht geantwortet“ oder „passt nicht mehr“. Das Passwort funktioniert immer.
