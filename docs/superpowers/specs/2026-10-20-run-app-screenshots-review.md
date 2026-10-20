# run-app: Screenshots aller Komponenten – Review (Stufe 7)

Geprüft: `git diff b6cf707..HEAD` (HEAD dcaab1c) gegen Spec `2026-10-20-run-app-screenshots-design.md` und den bindenden Anhang `2026-10-20-run-app-screenshots-validation.md`. Ledger: `.superpowers/sdd/2026-10-20-run-app-screenshots/progress.md`.

**Urteil: ready after fixes.** 0 Blocker, 1 Major, 5 Minor. Die Sicherheit der Fakes passt zum Anhang. Offen ist nur das Bild `sftp.png`: Es zeigt echte Daten des Rechners. Eine Fix-Welle mit zwei Tasks reicht.

Gate auf HEAD: `npm run typecheck` grün. `npx vitest run` 121 Dateien / 1675 Tests grün (8,1 s). `fakes.test.mjs` allein: 5/5 grün in 2,7 s, Kubernetes-Teil lief (openssl gefunden). Die Einzeltests dauern 22 ms bis 961 ms, der KI-Stream mit 40-ms-Takt ist der längste.

---

## Sicherheit (geprüft)

| Punkt | Befund | Beleg |
|---|---|---|
| Bindung | Alle vier Dienste lauschen nur auf `127.0.0.1`. `netstat` zeigt 2222/9334/9335 nur auf 127.0.0.1. | `sshd.mjs` `server.listen(port, '127.0.0.1')`, `kube-fake.mjs` und `ai-fake.mjs` dito, `driver.mjs:100` |
| tcpip | Erlaubt ist nur `destIP === 'k8s-cp1' && destPort === 6443`, alles andere wird abgelehnt. Es gibt keinen `request`-Listener, also kein `tcpip-forward`. Der Test belegt die Ablehnung von `k8s-cp1:22` und `127.0.0.1:6443`. | `sshd.mjs` tcpip-Handler, `fakes.test.mjs:90-91` |
| SFTP-Wurzel | `local()` lehnt `\` und `:` ab. Danach folgen `posix.normalize('/'+p)`, `join` und eine Präfixprüfung mit `root + path.sep`. `..` klemmt an `/`. UNC, Laufwerksbuchstaben und ADS (`:`) sind ausgeschlossen. NUL-Bytes werfen in `fs`, `guard` macht daraus FAILURE. Symlinks: Der Seed legt keine an (E4). Für `SYMLINK`/`READLINK` gibt es keinen Listener, ssh2 antwortet dann `OP_UNSUPPORTED` (`ssh2/lib/protocol/SFTP.js:3206 ff.`). Ein Client kann also keinen Link anlegen, über den `statSync`/`openSync` die Wurzel verlassen. Ist `root` relativ oder mit `/` angegeben, schlägt die Präfixprüfung fehl, und alles wird zu ENOENT. Der Fehler geht also zur sicheren Seite. | `sshd.mjs:50-57` |
| Exec | `execReply` vergleicht nur Teilstrings und Regexe. Nichts wird ausgeführt oder als Pfad genutzt. `inspect(ref)` ist ein reiner Array-Lookup. Unbekannte Befehle bekommen Exit 127. | `sshd.mjs` `execReply`, `fakes.test.mjs:56` |
| Schlüssel und Zugangsdaten | Alle sind synthetisch: `synthetic-demo`, `synthetic-kube-token`, `sk-synthetic-demo`. Der Host-Schlüssel liegt in `<RUN_DIR>/sshd-host-key`, Zertifikat und Schlüssel in `<RUN_DIR>/kube`, im Test unter `mkdtemp` (wird gelöscht). Im Diff ist keine PEM-Datei und kein PNG. Kein CORS-Header. Kubernetes antwortet bei jeder Nicht-GET-Anfrage mit 403, Bearer ist Pflicht (E3). | `git diff --stat` |
| Treiber-Token | Unverändert. `driver.mjs` ist nicht im Diff, und `screens.mjs` liest `<RUN_DIR>/token` je Aufruf. | `screens.mjs:13` |
| openssl | Aufruf nur über `execFileSync` mit Argument-Array, ohne Shell und mit MSYS-Schutz (K5). Fehlt openssl, wird der Kubernetes-Fake mit Warnung übersprungen, der Test mit `skipIf`. | `kube-fake.mjs` |

## Bilder (Abnahmetabelle des Anhangs)

| Bild | Ergebnis |
|---|---|
| `sftp.png` | Remote `/home/demo` mit 5 Einträgen: **ok**. Lokale Spalte: **nicht ok**, siehe M1. Sie zeigt `C:\` mit 22 echten Einträgen (u. a. `devkitPro`, `WCH.CN`, `OneDriveTemp`, `workspace`, `inetpub`, Zeitstempel). Ein Benutzername ist nicht zu sehen, aber Daten des Rechners. |
| `containers.png` | 6 Container, Projekt `shop`, Töne ok (grün), muted (`migrate`), bad (`cron-legacy`): **ok** |
| `kubernetes.png` | „bereit über web-01“, drei Node-Kacheln mit CPU/RAM (w2 rot), Problembanner „3 Probleme“, Badge „Produktion“ und roter Rahmen am Baumeintrag: **ok**. Der Banner ist eingeklappt, deshalb sind die Namen k8s-w2/checkout/report nicht zu lesen (m4). |
| `settings.png` | Drei Abschnitte (Allgemein, Vault, KI-Assistent), „1 Anbieter, Standard: Demo-KI“: **ok** |
| `ai-settings.png` | „Demo-KI · OpenAI-kompatibel · gpt-4o-mini · Standard“: **ok** |
| `assistant.png` | Antworttext, Befehlsblock `du -xh …`, Knöpfe „Eintippen“, „Kopieren“ und „Als Workflow“, Terminal mit `df -h /`: **ok** |

---

## Befunde

### Major

**M1 – `sftp.png` zeigt die echte Laufwerkswurzel. Außerdem prüft die Benutzernamen-Erkennung den falschen Wert.** `.claude/skills/run-app/screens.mjs:53-65`
- **Fall 1:** Mit dem Standard-`RUN_DIR` (`%TEMP%` = `C:\Users\<name>\…`) greift der X4-Fallback, und die lokale Spalte zeigt `C:\` mit echten Ordner- und Dateinamen samt Zeitstempeln. Diese Bilder sind für README und Review gedacht, das verletzt den Zweck von X4 und Ruling 6 („keine echten Daten“). Der Fallback ist bindend vorgeschrieben (X4), aber unbrauchbar.
- **Fall 2:** Zeile 55 vergleicht mit `os.userInfo().username`. Der Name des Profilordners kann davon abweichen, etwa nach einer Kontoumbenennung, bei Microsoft-Konten mit gekürztem Ordner oder bei Domänenprofilen `name.DOMAIN`. Dann gilt `C:\Users\altername\…\shellherd-run\local` als „ohne Benutzernamen“, und die Pfadleiste zeigt ihn.
- **Kleinste Korrektur (Ruling, ersetzt X4-Fallback):**
  - Liegt `RUN_DIR` außerhalb von `os.homedir()`, bleibt `<RUN_DIR>\local` wie bisher.
  - Sonst kommt der synthetische Ordner nach `%PUBLIC%\shellherd-demo-local` (`C:\Users\Public\…`). Der Ordner ist für jeden lokalen Benutzer beschreibbar, wird nicht mit OneDrive synchronisiert und enthält keinen Benutzernamen.
  - Gibt es keinen solchen Ort, wirft der Block einen Fehler. Es entsteht dann kein Bild statt eines Bilds mit echten Daten.
  - Der Laufwerkswurzel-Fallback entfällt.
  ```js
  // Synthetic folder for the local pane; never under the user profile (path bar would show the profile name).
  function localTarget() {
    const home = os.homedir().toLowerCase();
    const outside = dir => dir && !dir.toLowerCase().startsWith(home);
    const base = outside(RUN_DIR) ? RUN_DIR : process.env.PUBLIC;
    if (!outside(base)) throw new Error('kein Ordner außerhalb des Benutzerprofils (SHELLHERD_RUN_DIR setzen)');
    const dir = path.join(base, outside(RUN_DIR) ? 'local' : 'shellherd-demo-local');
    fs.mkdirSync(dir, { recursive: true });
    // … die drei writeFileSync unverändert …
    return { target: dir, segment: path.basename(dir) };
  }
  ```
- **Bewertete Alternativen:**
  - **Standard-`RUN_DIR` ohne Benutzernamen**, z. B. `C:\shellherd-run`: Das ändert `driver.mjs`, `demo-setup.mjs`, alle Fakes, SKILL.md und README (Token-Pfad `%TEMP%\shellherd-run\token` an vielen Stellen). Schreibrechte im Laufwerksstamm fehlen auf verwalteten Rechnern oft. Das Profil mit den bestehenden `demo.term`/`known-hosts.json` zöge um. Der Umfang ist zu groß.
  - **Pfadleiste verbergen** (per `/eval` CSS setzen): Das zeigt weiter die echte Liste von `C:\` und löst den Kern nicht. Außerdem ist es ein Eingriff in die Darstellung, der das Bild verfälscht.
  - **Synthetischer Ordner unter `C:\` direkt:** Schreibrechte sind dort nicht garantiert, und es bliebe Müll im Laufwerksstamm.
- **Seiteneffekte der Empfehlung:**
  - Im Standardlauf bleiben drei kleine Dateien in `C:\Users\Public\shellherd-demo-local`. Sie werden bei jedem Lauf überschrieben und nicht gelöscht. Das gehört in SKILL.md.
  - Die Pfadleiste zeigt `C: / Users / Public / shellherd-demo-local`.
  - Die Wartebedingung (`segment`) funktioniert unverändert.
  - Andere Blöcke sind nicht betroffen.
- **Danach:** das alte `sftp.png` mit echten Daten unter `%TEMP%\shellherd-run\shots` neu erzeugen. Es ist nicht im Repo.

### Minor

**m1 – Der Testserver-Hauptblock hat keinen Stopp-Weg, und ein verwaister Prozess blockiert alle drei Ports.** `.claude/skills/run-app/sshd.mjs:192-205`, `.claude/skills/run-app/SKILL.md:26`
- **Fall:** Wird `npm run drive:sshd` über den npm-Wrapper beendet (Hintergrund-Shell), läuft das Node-Kind weiter. So geschehen im Ledger („alter sshd-Prozess seit 07:32“). Zum Prüfzeitpunkt lauscht PID 23224 aus Welle 3 noch auf 2222/9334/9335.
- **Folge beim zweiten Lauf:**
  - Der Kubernetes-Fake meldet „übersprungen: EADDRINUSE“, und `startAiFake` wirft danach unbehandelt.
  - Gefährlicher: Läuft noch ein alter Prozess mit *altem* Code, testet man unbemerkt gegen ihn.
- **Kleinste Korrektur:** nur Doku. In SKILL.md Zeile 26 bzw. in den Stolpersteinen einen Satz ergänzen: hängender Testserver → `netstat -ano | findstr ":2222 "` und `taskkill /PID <pid> /F`. Kein Code.
- **An den Aufrufer:** PID 23224 jetzt beenden (der Prüfer ändert nichts).

**m2 – SKILL.md beschreibt das alte Verhalten der lokalen Spalte.** `.claude/skills/run-app/SKILL.md:101`
- **Fall:** „zeigt sonst den Windows-Benutzernamen im Pfad“ ist falsch. Der Code zeigt die Laufwerkswurzel, und nach M1 einen Ordner unter `%PUBLIC%`.
- **Korrektur, wörtlich:**
  > - **Lokale SFTP-Spalte:** `screens.mjs` legt drei synthetische Dateien in `<RUN_DIR>\local` an, oder in `%PUBLIC%\shellherd-demo-local`, wenn der Run-Ordner im Benutzerprofil liegt (sonst stünde der Profilname in der Pfadleiste). Der Ordner unter `%PUBLIC%` bleibt nach dem Lauf liegen.

**m3 – `fakes.test.mjs` legt den Temp-Ordner schon beim Sammeln an, auch wenn die Suite übersprungen wird.** `.claude/skills/run-app/fakes.test.mjs:25`
- **Fall:** Unter Linux/macOS ist `describe.runIf(false)` ein Skip. Vitest führt den Rumpf trotzdem zum Sammeln aus, also laufen `mkdtempSync` und `findOpenssl()`. `afterAll` läuft nicht, und je Lauf bleibt ein leerer `shellherd-fakes-*` zurück.
- CI (`windows-latest`) ist nicht betroffen.
- **Korrektur (optional):** `base` in einem `beforeAll` anlegen, oder akzeptieren. Empfehlung: **akzeptieren**, nicht in die Fix-Welle.

**m4 – Problembanner in `kubernetes.png` ist eingeklappt.** `.claude/skills/run-app/screens.mjs` Block `kubernetes`
- **Fall:** Die Abnahme nennt k8s-w2, checkout und report. Zu sehen ist nur „3 Probleme“. Inhaltlich stimmt das, der Banner ist da.
- **Korrektur:** keine, akzeptieren. Das Aufklappen kostet einen Klick mehr, und die Tabelle rutscht nach unten.

**m5 – Kleinigkeiten in den Fakes, akzeptiert.**
- `sshd.mjs:83` legt bei `READ` einen Puffer in der vom Client gewünschten Länge an. Das ist nur auf Loopback und mit Passwort möglich, und der Client ist die App.
- Windows-Gerätenamen (`CON`, `COM1`) als letzter Pfadteil werden nicht gefiltert. Das ist harmlos auf Loopback, bleibt aber erwähnt.
- `demo-setup.mjs` `addAiProvider` prüft die `waitFor`-Ergebnisse nicht (Ledger-Minor). Ein Fehler zeigt sich erst am nächsten Klick-Timeout.
- **Korrektur:** keine.

## Zusammenspiel und Abdeckung

- **V1–V7, X1–X5, K1–K12 umgesetzt.** Abweichungen:
  - Die Laufwerkswurzel nach X4 (siehe M1).
  - `closeTabs` schließt vorher offene Dialoge und das Assistent-Panel (`screens.mjs:41-43`). Das ist sinnvoll, weil Zustand zwischen Läufen bleibt.
  - SKILL.md nennt den known-hosts-Pfad korrekt `profile\Shellherd\known-hosts.json`. Der Anhang hatte `profile\known-hosts.json`, die Datei liegt tatsächlich unter `profile\Shellherd\`.
- **Die Exec-Weiche passt zu den Befehlen der App.** Das belegt der Selbsttest mit dem echten `PROBE_COMMAND`, `inventoryBatchCommand`, `readKubeconfig`, `openTunnel`, `createKubeApi` und `streamChat`.
- **Unnötiger Code:** keiner gefunden.
  - Die dynamischen Importe im Hauptblock von `sshd.mjs` waren für parallele Tasks gedacht. Heute ist nur noch der `try` um den Kubernetes-Fake nötig (Fehler bei fehlendem openssl). Der dynamische Import selbst könnte statisch sein, das ist aber Kosmetik und keine Änderung wert.
- **Doku:** README entspricht K11, plus die `screens.mjs`-Zeile (Ruling im Ledger). Die SKILL.md-Ports, Demo-Tabelle und Exec-Liste stimmen mit dem Code überein, bis auf m2.

## Fix-Welle (Vorschlag)

| Task | Datei (nur diese) | Inhalt |
|---|---|---|
| F1 | `.claude/skills/run-app/screens.mjs` | M1: `localTarget()` wie oben. Den Laufwerkswurzel-Fallback und die Hinweiszeile entfernen. Danach `screens.mjs sftp` laufen lassen und `sftp.png` ansehen. Abnahme: Pfadleiste `C: / Users / Public / shellherd-demo-local` (oder `…/local`), drei Dateien, kein echter Ordner. |
| F2 | `.claude/skills/run-app/SKILL.md` | m2 (Text wörtlich oben), m1 (Satz zum hängenden Testserver mit `netstat`/`taskkill`). |

Gate: `npm run typecheck` und `npx vitest run` grün (121/1675). m3, m4 und m5 sind akzeptiert.
