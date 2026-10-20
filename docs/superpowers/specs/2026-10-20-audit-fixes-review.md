# Audit-Fixes – Review (Stufe 7)

Branch `claude/feature/audit-fixes`, Diff `79d6628..eeb34f6` (83 Dateien). Grundlage: Spec `2026-10-20-audit-fixes-design.md`, bindender Anhang `2026-10-20-audit-fixes-validation.md`, Ledger `.superpowers/sdd/2026-10-19-audit-fixes/`.

**Urteil: ready after fixes.** 0 Blocker, 2 Major, 5 Minor. Ein Major (M1) ist neu durch #3 entstanden, der andere (M2) ist älter, liegt aber auf derselben Codezeile und wird durch #3 bei jedem Überschreiben ausgelöst. Beide sind klein und gehören in eine Fix-Welle.

## Gate

- `npm run typecheck`: grün.
- `npx vitest run`: 119 Dateien und 1661 Tests grün, gleich wie im Ledger.
- Der RDP-Helfer wurde nachgeprüft, weil Abnahme K6 im Ledger offen war (Minor D). `node scripts/build-rdp-host.mjs --out <scratchpad>` kompiliert ohne Warnung. `printf '{"type":"open","sessionId":"abc"}\n{"type":"focus","sessionId":"zzz"}\n' | Shellherd.RdpHost.exe` liefert `{"type":"error","sessionId":"abc","message":"Missing field: server"}`. Der Fehler aus `focus` liefert dagegen `{"type":"error","message":"Sitzung nicht gefunden."}` ohne `sessionId`. Das erfüllt V9. `out/rdp-host` wurde nicht angefasst, `npm run build` und `npm run dev` bauen ihn neu.
- Preload (K18): `out/preload/index.cjs` vom 2026-10-20 07:31 enthält nur `require("electron")`. `LOCALE_ARG` ist eingebündelt, `shared/locale.ts` hat keine Laufzeit-Importe.

## Sicherheit

- **Ausführung nur nach Klick:** Gilt jetzt durchgehend. `typeIntoTerminal` hat nur noch zwei Aufrufer: den Klick „Eintippen“ (`AssistantPanel.tsx:217`) und `WorkflowPalette.tsx:39`, ebenfalls ein Klick. Der Zweig, der beim Streamen selbst tippte, ist entfernt (#8).
- **Bearbeiten (#2):** Es gilt jetzt eine Allow-Liste. `openForEditing` ist der einzige Weg zu `shell.openPath` (`files/ipc.ts:56`); `localOpen` und `RemoteEdits` laufen beide darüber. `evil.bat.`, `evil.bat ` und Dateien ohne Endung landen in Notepad.
- **Pfadausbruch (#1/#2):** Geprüft wird an allen drei Stellen, an denen ein Servername zu einem lokalen Pfad wird: `transfer.ts:34` (Unterordner), `transfer.ts:50` (oberste Ebene) und `remote-edit.ts:55`, dort vor `mkdtemp`.
- **Dev-Treiber (#5):** Die Token-Prüfung steht als erste Anweisung des Handlers, vor `/quit` (`driver.mjs:88`). `Origin` wird gesperrt, das Token wird vor `listen` geschrieben.
- **kubeconfig und Secrets:** Keine Änderung an den Pfaden. #13 ändert nur, wie die Kopfzeile gefunden wird; der YAML-Text bleibt im Main. #21 kürzt KI-Fehlerdetails auf 500 Zeichen.

## Befunde

### Major

**M1 – #3: `.part` mit anschließendem Umbenennen ersetzt beim Überschreiben auf dem Server Symlinks und ändert den Besitzer.** Betroffen ist `src/main/files/transfer.ts:113-128`.
- Fall 1: `/etc/nginx/sites-enabled/shop` ist ein Link auf `../sites-available/shop`. Der Nutzer lädt eine neue `shop` hoch und wählt „Überschreiben“. `stat` folgt dem Link (`runTransfer:76`), der erste `rename` scheitert unter OpenSSH an der vorhandenen Datei. `removeFile(item.target)` löscht dann den **Link**, und der zweite `rename` legt eine normale Datei an seine Stelle. `sites-available/shop` bleibt alt, der Link ist weg, ohne Hinweis. Vorher schrieb `createWriteStream` durch den Link in die echte Datei.
- Fall 2: Eine Datei gehört `www-data:www` mit `g+w`, und der Nutzer `admin` überschreibt sie. Die neue Datei gehört danach `admin:admin`, Hardlinks sind getrennt. Liegt die Datei in einem Ordner, in dem nur die Datei selbst schreibbar ist, scheitert jetzt schon das Anlegen von `.part` mit „Zugriff verweigert“. Das ist sichtbar, und die alte Datei bleibt erhalten.
- Kein Test deckt das ab: Die Memory-FS ersetzt beim Umbenennen stillschweigend (`transfer.test.ts:32`).
- **Kleinste Korrektur:** Bei einem vorhandenen Ziel auf den echten Pfad auflösen und `.part` dort anlegen und umbenennen.
  - In `FileSystem` kommt `realpath: (path: string) => Promise<string>` dazu. Lokal ist das `realpath` aus `node:fs/promises`, für SFTP ist es schon vorhanden (`sftp-file-system.ts:47`), die Memory-FS bekommt `async path => path`.
  - In `runTransfer` vor `copyFile`: `const target = existing ? await to.realpath(item.target) : item.target;`. `copyFile` und `setModified` nutzen dann `target`.
  - Besitzer, Gruppe und Hardlinks bleiben ACCEPTED: Das kostet der „alte Datei bleibt bis zum Schluss“-Schutz aus #3. Der fehlende Schreibzugriff auf den Ordner ist ebenfalls ACCEPTED, weil der Fehler sichtbar ist und die alte Datei erhalten bleibt.
  - Test: Memory-FS mit `realpath`, das `/target/link` auf `/target/real` abbildet. Danach ist `/target/real` neu und `/target/link` bleibt erhalten.

**M2 – Älter als der Branch, über #3 aber bei jedem Überschreiben aktiv: Hochgeladene Dateien werden für alle beschreibbar (0666).** Betroffen ist `src/main/files/sftp-file-system.ts:61`.
- `sftp.createWriteStream(path)` ohne Optionen: ssh2 setzt `mode` auf `0o666` (`node_modules/ssh2/lib/protocol/SFTP.js:3853`) und ruft nach dem Öffnen immer `fchmod(handle, this.mode)` auf (`SFTP.js:3947`). `fchmod` beachtet keine umask.
- Fall: Eine `~/.env` mit 0600 wird per Upload überschrieben und steht danach auf `-rw-rw-rw-`. Mit #3 trifft das jetzt auch jede überschriebene Datei, weil jede eine neu angelegte `.part` ist.
- **Kleinste Korrektur:** In `FileSystem` wird `write` zu `write: (path: string, mode?: number) => Writable`. SFTP: `sftp.createWriteStream(path, { mode: mode ?? 0o644 })`, lokal wird `mode` ignoriert. `copyFile` bekommt `existing?.mode` aus `runTransfer` und reicht es an `to.write(partial, mode)` weiter. Das Edit-Hochladen in `remote-edit.ts:90` bleibt bei `write(path)` und damit bei 0644. Wer dort die alte Mode will, ergänzt `this.fs.write(path, info.mode)`; das ist optional.
- Test: eine Fake-`SFTPWrapper`, deren `createWriteStream` die Optionen mitschreibt. Ohne Ziel wird `0o644` erwartet, mit vorhandenem Ziel (`mode: 0o600`) wird `0o600` erwartet. Ohne Fix ist der Test rot, weil keine Optionen übergeben werden.
- Hinweis zum Auftrag: Der Befund gehört nicht zu den 25. Er steht hier, weil M1 dieselben Zeilen anfasst und #3 ihn auf jedes Überschreiben ausdehnt. Wird er vertagt, braucht er einen eigenen Ledger-Eintrag.

### Minor

**m1 – #10: Der Marker wird im State-Updater angelegt.** Betroffen ist `src/renderer/src/components/AssistantPanel.tsx:103`. `access.mark()` steht im `update(...)`-Updater. `main.tsx:19` nutzt `React.StrictMode`, das Updater in der Entwicklung doppelt ausführt. Dabei entstehen zwei Marker, und der verworfene wird nie entsorgt. Auch ein Re-Run durch React in Produktion kann das auslösen. Schließt sich das Panel bei wartendem `awaiting`, bleibt der Marker bis zum Ende des Terminals bestehen. Spürbar ist der Schaden nicht, xterm entsorgt die Marker mit dem Terminal; er widerspricht aber dem Ruling „Lebensdauer = awaiting“.
**Korrektur:** `setTimeout(() => { const mark = access.mark(); update(tabId, current => ({ ...clearAwaiting(current), output: undefined, awaiting: { mark, command: result.typed } })); }, 400)`.

**m2 – #11: `catch` schluckt jeden Fehler, auch nach einer Teiländerung.** Betroffen ist `src/main/window-ipc.ts:71-78`. `rdp.transferOwner` setzt zuerst `session.ownerId = toOwner` (`rdp/host.ts:124`) und ruft danach `window.getNativeWindowHandle()` auf (`:129`). Wird das Zielfenster genau dann zerstört, entsteht ein „geschlossener Tab“, obwohl die RDP-Sitzung weiterläuft. Sie gehört dann einem Fenster ohne Tab und bleibt unsichtbar bis zu `closeOwner`. Auch echte Programmierfehler verschwinden still.
**Korrektur:** Statt `try/catch` vorab `if (tab.session && !{ terminal: owners.ssh, rdp: owners.rdp, sftp: owners.sftp }[tab.session.kind].owns(from, tab.session.sessionId)) return closedTab;`. Danach normal übertragen; Fehler steigen dann auf wie vorher. Der Test bleibt gleich, der Fake braucht für „vanished“ `owns: () => false`.

**m3 – #16: Werte im Test sind knapper als vorgegeben.** Betroffen ist `src/main/connection-test.test.ts:56`. Der Test nutzt `timeout: 300` und 600 ms Dialog, K13 verlangt 1000 und 2000. Nach dem Dialog bleiben 300 ms für Handshake und Login gegen einen echten ssh2-Server, und die Suite startet 119 Worker parallel. Unter Last kann der Test deshalb zufällig rot werden. **Korrektur:** `timeout: 1_000` mit 2000 ms im Dialog.

**m4 – #3: Der Ausweichpfad beim Umbenennen ist ungetestet.** Betroffen sind `src/main/files/transfer.ts:122-128` und `transfer.test.ts:32`. Die Memory-FS ersetzt beim `rename`, deshalb laufen „Ziel löschen, dann umbenennen“ und „Ziel gesperrt, `.part` verwerfen“ nie. Das ist neue Verzweigungslogik mit Datenverlust-Risiko. **Korrektur:** zwei Tests mit einem `rename`, das bei vorhandenem Ziel ablehnt:
- (a) Das Ziel wird ersetzt und `.part` ist weg.
- (b) Ist zusätzlich `removeFile(target)` gesperrt, bleibt das alte Ziel, `.part` ist weg und der Fehler wird gemeldet.

**m5 – Deutscher Code-Kommentar.** Betroffen ist `src/main/files/transfer.ts:112`: `// shortcut: ein echter Name x.part kollidiert; …`. Die Validierung (V2) hat den Wortlaut so vorgegeben, CLAUDE.md verlangt aber englische Code-Kommentare. **Korrektur:** `// shortcut: a real file named x.part collides (and is removed on failure); upgrade when someone reports it.` Der Zusatz „removed on failure“ nennt den eigentlichen Schaden: Der `catch` in `:117` löscht eine echte `x.part` des Nutzers.

### Abweichungen ohne Folgen (ACCEPTED, kein Fix)

- `host.test.ts` ruft das private `receive` direkt auf, statt die Zeile über `stdout` einzuspeisen (K7). Der Pfad über `createInterface` ist unverändert, der Test prüft die richtige Verzweigung.
- C hat den `grep` aus dem #7-Risiko nicht gemacht. Nachgeprüft: `encryptVaultWithKey` parst schon mit `VaultSchema` (`crypto.ts:103`). Ein ungültiger Vault wirft also an derselben Stelle denselben ZodError wie vorher. Unbekannte Felder fehlen jetzt sofort statt erst nach dem nächsten Entsperren; das ist ACCEPTED laut Anhang.

## Alle 25 Befunde

„Rot ohne Fix“ heißt: Der neue Test schlägt fehl, wenn nur der Fix fehlt.

| # | Ursache behoben | Test prüft das Richtige / rot ohne Fix | Neue Fehler |
|---|---|---|---|
| 1 | ja, Unterordner werden übersprungen, oberste Ebene wirft | ja / ja (alle vier Namen landeten im Ziel) | keine; Uploads bleiben unberührt (lokale Namen sind sicher) |
| 2 | ja, Allow-Liste und Prüfung vor `mkdtemp` | ja / ja (`evil.bat.` und `x.py` lieferten `default`; `mkdtemp` wurde aufgerufen) | keine |
| 3 | ja, ein Lesefehler lässt das Ziel stehen | ja / ja (das Ziel wurde gelöscht) | **M1**, **M4**; dazu M2 über diesen Pfad. Verschieben löscht die Quelle erst nach erfolgreichem `copyFile`; beim Abbruch wird `.part` entfernt. |
| 4 | ja, `sync` vor `rename` | ja / ja | keine |
| 5 | ja | Abnahme laut Ledger (403/403/200) | keine |
| 6 | ja, C# und Main; Helfer gebaut und geprüft (siehe Gate) | ja / ja (vorher kein `emit`) | keine; das Renderer-`.catch` fängt `rdpBounds`/`rdpVisible` auf die gelöschte Sitzung ab (`RdpPanel.tsx:55,86,121`) |
| 7 | ja | ja / ja | keine (siehe oben) |
| 8 | ja, ersatzlos | Review: einziger Tippweg ist der Klick | keine |
| 9 | ja, `awaiting` nur nach `typed` | – (UI) | Verhaltensänderung nach K9 gewollt |
| 10 | ja, Marker | ja / ja (`mark` fehlte) | **m1** |
| 11 | ja | ja / ja (Funktion war nicht exportiert und warf) | **m2** |
| 12 | ja | ja / ja | keine |
| 13 | ja | ja / ja | keine |
| 14 | ja, Ergebnis aus lokalen Werten | ja / ja (`core.vaultLocked`) | keine; ein Rennen mit Sperren und Wiederöffnen im Renderer gab es schon vorher, die Rücknahme setzte auch dort den Vault |
| 15 | ja | Abnahme laut Ledger | keine; `LastVaultFile.set` wirft nie (`last-vault.ts:20`) |
| 16 | ja, Timer pausiert und `readyTimeout` auf 120 s | ja / ja (mit Abhängigkeit) | Timerwechsel ohne Rennen: `finish` liest das aktuelle `timer`, `resume` prüft `finished`; **m3** |
| 17 | ja | ja / ja | keine; `KubeApiError` ist kein `AppError` (`kubernetes/api.ts:18`), die Reihenfolge der Prüfungen passt |
| 18 | ja, erst schreiben, dann Zustand ändern | ja / ja | keine; `index.ts:214` gibt den `AppError` an `LanguageSetting.tsx:20` weiter |
| 19 | ja, Verhalten gleich | ja / – (Modul neu) | keine; dieselbe `set*`-Reihenfolge, Retry liest den aktuellen Vault über `vaultRef` |
| 20 | ja | Gate | keine; Fehlercodes je IPC gleich wie vorher, `fail` und `errorText` mit identischen Fallbacks, Preload gebündelt |
| 21 | ja | ja / ja (X3 berücksichtigt) | keine |
| 22 | ja | Review | keine; `stage.current?.` ist beim Unmount null-sicher |
| 23 | ja | Review | keine |
| 24 | ja, Formatter-Modul | ja / ja | keine; nur Zahlen bei Zähl-Keys werden formatiert, `{{port}}` und Strings bleiben roh, der Katalog nutzt keine `{{x, fmt}}`; `max`/`total`/`shown`/`selected` sind alles Zählwerte |
| 25 | ja | Gate | keine |

## CLAUDE.md

- **Texte:** Genau zwei Keys sind neu (`files.unsafeName`, `core.settingsWriteFailed`) und drei Texte geändert, alle in de und en mit den Wortlauten aus K12. `i18n-catalog.test.ts` ist grün. Im Main gibt es keine neuen Literale (RDP-`console.warn` gab es schon vorher).
- **format.ts:** #24 nutzt `formatNumber`, es gibt kein `Intl` in Komponenten.
- **Design-Tokens:** keine CSS- oder Style-Änderungen.
- **Kommentare:** eine Ausnahme, siehe m5.
- **Code ohne Nutzen:** keiner gefunden. `TransferTab`, `fail` in `FilesPanel` und `IPC_PREFIX` werden je mehrfach genutzt. Doku und CHANGELOG entsprechen K19; die Labels `Bearbeiten`/`Edit` gibt es so (`common:actions.edit`).

## Fix-Welle (Vorschlag, 2 Tasks, disjunkte Dateien)

| Task | Befunde | Dateien |
|---|---|---|
| F1 Dateien | M1, M2, m4, m5 | `src/main/files/file-system.ts`, `src/main/files/sftp-file-system.ts`, `src/main/files/transfer.ts`, `src/main/files/transfer.test.ts`, `src/main/files/sftp-file-system.test.ts` (neu, falls nötig), `CHANGELOG.md`, `CHANGELOG.en.md` (nur M2-Eintrag) |
| F2 Fenster/Assistent/Test | m1, m2, m3 | `src/renderer/src/components/AssistantPanel.tsx`, `src/main/window-ipc.ts`, `src/main/window-ipc.test.ts`, `src/main/connection-test.test.ts` |

- F1 arbeitet test-first: zuerst der Symlink-Test (M1), der Mode-Test (M2) und die beiden Tests zum Ausweichpfad (m4), dann der Fix.
- Wird M2 vertagt, kommt er als eigener Ledger-Punkt unter „Minors/Offen“ mit Verweis auf `SFTP.js:3947`.
- Danach das Gate (`npm run typecheck`, `npx vitest run`). M2 gehört als „Behoben: Hochgeladene Dateien behalten beim Überschreiben ihre Rechte; neue Dateien bekommen 0644 statt 0666.“ in beide CHANGELOGs unter 0.12.1, mit gleicher Eintragszahl. Das macht F1 mit.
