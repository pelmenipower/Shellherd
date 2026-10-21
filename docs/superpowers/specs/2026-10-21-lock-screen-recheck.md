# Sperrbildschirm und Willkommens-Tab – Nachprüfung (Stufe 5b)

Geprüft: `git diff da3301d..HEAD` auf `claude/feature/lock-screen`, also `e7d2c7f` (Code) und `15cfa31` (run-app, Doku), 11 Dateien. Maßstab: Review `2026-10-21-lock-screen-review.md`, Ledger `.superpowers/sdd/2026-10-21-lock-screen/progress.md`, Abschnitt „Abnahme nach Fix-Welle“.

Gates:
- `npm run typecheck` ist grün.
- `npx vitest run` lief zweimal, beide Male mit 128 Dateien und 1825 Tests grün. Das ist ein Test mehr als vor der Welle, nämlich `resumesLocked`.
- Der Arbeitsbaum unter `src/` und `screens.mjs` ist sauber. Die Gegenprobe für I2 wurde also zurückgenommen.

**Urteil: mergebar, ja.** 10 Befunde: 9 ADDRESSED, 1 ACCEPTED, 0 NOT ADDRESSED. Neu: 0 Critical, 0 Important, 1 Minor.

---

## 1. Befunde aus dem Review

| Befund | Status | Beleg |
|---|---|---|
| **I1** Fokus nach Fehlversuch | ADDRESSED | `LockScreen.tsx:74` setzt `readOnly={pending}` statt `disabled`, das `focus()` im `finally` bleibt. Absenden ist weiter über den Wächter in `submit` (`pending \|\| password === ''`) gesperrt. In `screens.mjs` `lock` wird nach dem Fehlversuch geprüft, dass `activeElement` das Passwortfeld ist und `value === ''`. Der Lauf ist laut Ledger grün. |
| **I2** Sitzung überlebt die Sperre | ADDRESSED | Vor der Sperre wartet `screens.mjs` auf `connectedTab` (mit `:not([data-fixed])`, `web-01`, `.tab-status-connected`) und setzt dann `data-lock-probe`. Die Entsperr-Bedingung verlangt den markierten Knoten, `connectedTab` und `.vault-shell.inert === false`, wie in Review I2 Punkte 1 bis 4 gefordert. Die Gegenprobe mit `if (true) onSessionChange()` ist laut Ledger rot. |
| **I3** Nebenfenster-Sperre nie gelaufen | ADDRESSED, mit neuem Minor N1 | Der Block `lockSecondary` deckt alle Schritte 1 bis 8 ab: neue Ansicht, Verschieben, Fensterwahl über `role=secondary`, `inert`, kein `form`, Ctrl+Shift+Space ohne Palette, Screenshot, Entsperren im Hauptfenster, Probe-Knoten plus Status im Nebenfenster und Aufräumen im `finally`. Der Ledger meldet den Lauf grün und hält fest, dass der Screenshot angesehen wurde. Allerdings ist der Block nicht wie gefordert einzeln über `lock-secondary` aufrufbar (siehe N1). |
| **I4** Wiederaufnahme ungetestet | ADDRESSED | `session.ts:33-36` übernimmt `resumesLocked` wörtlich nach dem Review, und `vault/ipc.ts:189` nutzt die Funktion. `session.test.ts:230-237` testet alle vier Fälle. Der Kommentar steht jetzt an der Funktion. |
| **M1** „Another vault file“ | ADDRESSED | `docs/manual.md:62,371` und `CHANGELOG.en.md:11` lauten jetzt `Other vault file`. |
| **M2** Veraltete Explorer-Rückfrage | ADDRESSED | `App.tsx:645` ruft `setPendingVaultFile(null)` in `switchVault` auf. Der Explorer-Pfad gibt seine Datei weiter als `filePath` mit, der Fall bleibt also abgedeckt. |
| **M3** Neuanhebung verschüttet die Wechsel-Rückfrage | ADDRESSED | `LockScreen.tsx:40` ruft `setConfirmSwitch(false)` im Observer-Zweig auf. In `screens.mjs` `lock` wird geprüft: Rückfrage öffnen, Probe-Dialog, Rückfrage zu, erneut öffnen, Escape, Probe entfernen. Auch im Fehlerzweig wird die Probe aufgeräumt. |
| **M4** Fokus im Nebenfenster | ADDRESSED | `SecondaryWindow.tsx:47-54`: `returnFocus` merkt sich das aktive Element vor `setLocked(true)`, also bevor `inert` greift. Nach dem Entsperren fokussiert ein `requestAnimationFrame` das Element, falls es `isConnected` ist. Geprüft wird das in `lockSecondary` über den Klick ins Terminal vor der Sperre und `waitFor` auf `xterm-helper-textarea`. |
| **M5** cmd-Umbenennung im CHANGELOG | ADDRESSED | Je ein Punkt in `CHANGELOG.md:15` und `CHANGELOG.en.md:15`, wörtlich nach dem Review. Die Anzahl ist gleich, und die Changelog-Tests sind grün. |
| **M6** O1/O2 manuell | ACCEPTED, als Restpunkt an den Nutzer | Siehe Abschnitt 2. |

## 2. Bewertung der Orchestrator-Entscheidungen

**`encodeURIComponent` im `key`-Helfer (`screens.mjs:21`): richtig, keine Regression.**
- Ursache: Ohne Kodierung liest `URLSearchParams` (`driver.mjs:71`) jedes `+` als Leerzeichen. `Control+Shift+Space` kam dadurch als `Control Shift Space` an. Playwright hätte dann einen unbekannten Tastennamen gemeldet, oder die Prüfung wäre ins Leere gelaufen.
- Folgen für bestehende Aufrufe: keine. `Enter` und `Escape` bleiben beim Kodieren unverändert.
- `demo-setup.mjs:58,117` baut die Query eigenständig, aber nur mit `Escape` und `Enter`. Das ist unkritisch.

**M6 als ACCEPTED: vertretbar, aber nur als offener Restpunkt an den Nutzer, nicht als erledigt.**
- Der Treiber kann tatsächlich nicht auf die Taskleiste hovern, und die Demo-Umgebung hat kein RDP-Ziel (`driver.mjs` bietet weder Taskleiste noch DWM-Vorschau).
- O1 und O2 sind laut Anhang aber ausdrücklich *manuelle* Prüfungen (`validation.md:466-472`). Der Review hat den Orchestrator nur als ausführende Stelle genannt.
- Beide Risiken zeigen kein Vault-Geheimnis:
  - O1 zeigt höchstens das letzte Terminalbild vor dem Minimieren.
  - O2 betrifft nur den Fokus in einer bereits verbundenen RDP-Sitzung.
- Beide sind im Anhang als bekannte Risiken beschrieben. Den Merge blockieren sie deshalb nicht.
- Sie gehören aber in die Restpunkte an den Nutzer (Abschnitt 4), damit sie nicht als geprüft gelten.

## 3. Neue Befunde (nur im Fix-Diff)

### Minor

**N1 – `lock-secondary` ist als Blockname nicht aufrufbar.**
- Stelle: `.claude/skills/run-app/screens.mjs:194` (Schlüssel `lockSecondary`) gegen `:2`, `SKILL.md:23,33` und Review I3 („einzeln über `lock-secondary` aufrufbar“).
- Ursache: `screens.mjs:255` prüft `name in blocks`.
- Szenario: `node screens.mjs lock-secondary` endet mit „Unbekannter Block: lock-secondary“ und Exit 2. Der Lauf ohne Argument sowie `lockSecondary` funktionieren. Der Ledger nennt genau diesen Namen, deshalb ist der Fehler bei der Abnahme nicht aufgefallen. Wer der Doku folgt, kann den Block nicht einzeln starten.
- Fix-Richtung: Den Block als `'lock-secondary'() {…}` benennen. So entspricht auch der Screenshot-Name dem Blocknamen. Alternativ Doku und Usage-Zeile auf `lockSecondary` umstellen.

Sonst ist im Fix-Diff nichts Neues zu beanstanden:
- `readOnly` lässt Tippen nicht durch, und der Knopf bleibt während `pending` deaktiviert.
- `setConfirmSwitch(false)` im Observer läuft nur, wenn ein fremder Dialog öffnet.
- Das `finally` in `lockSecondary` schluckt nur Fehler beim Aufräumen, die eigentliche Ausnahme läuft weiter.
- `use(0)` danach ist korrekt, weil nach dem Schließen des Nebenfensters nur das Hauptfenster übrig ist.
- Am Sicherheitsbild aus Review Abschnitt 1 ändert sich nichts. Main ist nur in `vault/ipc.ts` berührt, und zwar mit identischer Logik.

## 4. Urteil

**Mergebar: ja.** Den Restpunkt N1 kann der Nutzer vor dem Merge mit einer Zeile beheben, er hängt aber an keinem Gate.

Restpunkte an den Nutzer:
1. **O1 (manuell):** Fenster minimieren, Auto-Sperre auf 1 Minute stellen, nach der Sperre über das Taskleistensymbol hovern. Zeigt die Vorschau Terminalinhalt, ist der Folgeschritt `setContentProtection` laut Anhang O1.
2. **O2 (manuell, mit echtem RDP-Ziel):** RDP-Fläche fokussieren und die Auto-Sperre abwarten. Tastendrücke dürfen danach nicht an die Remote-Sitzung gehen.
3. **N1:** Blockname `lock-secondary` angleichen.
4. Bekannt und dokumentiert: Bricht der `lock`- oder `lock-secondary`-Block ab, bleibt die App gesperrt, und der nächste Lauf braucht einen Neustart (`SKILL.md:33`).
