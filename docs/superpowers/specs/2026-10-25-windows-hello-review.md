# Windows Hello – Review (Stufe 5)

Branch `claude/feature/windows-hello` gegen `claude/feature/ki-maskierung` (11 Commits, `c9a5638..18b2373`).
Grundlage: Spec `2026-10-25-windows-hello-design.md`, der bindende Anhang `…-validation.md` (B1–B2, K1–K11, V-R1–V-R9) und das Ledger `.superpowers/sdd/2026-10-25-windows-hello/progress.md` mit Ruling R-1 (Passwortfeld auf dem Öffnen-Bildschirm während der Abfrage `disabled`).

**Urteil: ready after corrections** – 0 Critical, 1 Important, 4 Minor. I-1 ist eine kleine Renderer-Korrektur (zwei Dateien) und sollte vor dem Release 0.26.0 erledigt sein, weil sie genau den Ablauf von M10 trifft. Die Minor-Befunde können als Folgepaket kommen. Der Sicherheitskern (Krypto, Ablauf, IPC, Fake, Helfer) ist ohne Befund.

Gates: `npm run typecheck` grün, `npx vitest run` grün (165 Dateien, 2563/2563). Weder der mfa- noch der remote-forwards-Flake trat auf. Der Arbeitsbaum ist sauber, die Läufe gelten also für `18b2373`.

Proben (nur synthetisch, Skripte im Scratchpad):
- **Helfer** `out/hello/Shellherd.Hello.exe` (6 656 Byte, mtime neuer als `Program.cs`, `app.manifest` und `build-hello.mjs`), nur mit Anfragen ohne Dialog:

  | Eingabe | Antwort | Zeit |
  |---|---|---|
  | `{"op":"status"}` | `{"ok":true,"available":true}` | 189 ms |
  | `garbage`, `[]`, `null`, leere Zeile | `{"ok":false,"status":"failed"}` | 161–173 ms |
  | `{"op":"sign"}` (ohne Challenge) | `failed` | 176 ms |
  | `{"op":"sign","challenge":"!!!"}` (kein Base64) | `failed` | 185 ms |
  | `{"op":"sign","challenge":"AAAA"}` (3 Byte, scheitert an `Length != 32` vor jedem WinRT-Aufruf) | `failed` | 173 ms |

  Ein `sign` mit gültiger Challenge und ein `create` gab es nie.
- **Prozessende:** Node 24 startet ein Kind mit denselben `spawn`-Optionen wie `runHelper` und beendet sich nach 500 ms. Das Kind ist danach weg (libuv-Job-Objekt mit `KILL_ON_JOB_CLOSE`). Ein Helfer überlebt das Ende von Shellherd also nicht.
- **Treiber** (Port 9333, Fake `ok`): Ablauf aus I-1 nachgestellt. Einschalten, sperren, mit Hello entsperren, `helloDisable`, erneut sperren. Ein MutationObserver sah den Hello-Knopf kurz erscheinen, danach war er weg und `document.activeElement` war `BODY`. Anschließend mit dem Demo-Passwort entsperrt; Hello ist für den Demo-Vault aus, der Fake steht auf `ok` (Zustand wie vorher).
- Shots `hello-setting.png`, `hello-lock.png`, `hello-stale.png` und `hello-open.png` angesehen: Kästchen gesetzt mit „Windows Hello ist für diesen Vault eingeschaltet.“, Sperrbildschirm mit Knopf über dem Passwortfeld, „passt nicht mehr“ mit Fokus im Feld und ohne Knopf, Öffnen-Bildschirm mit „Mit Windows Hello öffnen“ zwischen Datei und Passwort.

Es wurde weder ein echter Vault noch `%APPDATA%\Shellherd` geöffnet, kein echter Hello-Dialog ausgelöst und nichts nach `out/` gebaut.

---

## 1. Sicherheit

### Krypto (`src/main/vault/hello.ts`)

Ergebnis: richtig parametriert, alle Schlüssel und Signaturen werden genullt.
- **HKDF** (`:26-32`): `hkdfSync('sha256', IKM = Signatur, salt = Challenge, info = 'shellherd-hello-v1', 32)`. Das entspricht RFC 5869; das Geheimnis steckt allein in der IKM. Die Challenge ist 32 Byte zufällig je Einschalten (`:88`) und darf öffentlich sein (R1.2).
- **AES-256-GCM**:
  - Nonce: `randomBytes(12)` bei jeder Verpackung (`:40`). Weil die Challenge je Einschalten neu ist, ist auch der Schlüssel neu; eine Wiederholung von Schlüssel und Nonce ist ausgeschlossen. Test `binds the wrapped key to the vault salt and uses a fresh nonce`.
  - Tag: `setAuthTag` vor `final()` (`:63-65`). Node akzeptiert sonst auch kürzere Tags; hier erzwingt das Schema genau 16 Byte (`base64Of(16)`, `:11-12`, `:19`). Ein manipulierter Tag ergibt `helloStale`.
  - AAD: `shellherd-hello:v1:<kdf.salt>` (`:34`), beim Verpacken und Entpacken gesetzt. Anderer Salt ergibt `helloStale` (Test).
- **Nullen**:
  - Signatur: in `wrappingKey` im `finally` (`:30`), also auch wenn HKDF wirft. In `enable` zusätzlich, wenn `takeKey` wirft (`:94`). Eine zu kurze Signatur nullt `helloSignature` selbst (`hello-helper.ts:45`).
  - Verpackungsschlüssel: `key.fill(0)` im `finally` von `sealVaultKey` und `openVaultKey` (`:52`, `:71`). `Buffer.from(ArrayBuffer)` teilt den Speicher, genullt wird also das HKDF-Ergebnis selbst.
  - Klartext-Zwischenpuffer von `decipher.update`: `plain?.fill(0)` (`:70`), auch bei GCM-Fehler.
  - Vault-Schlüssel beim Einschalten: `vaultKey.fill(0)` im `finally` (`:102`), auch wenn das Schreiben scheitert. Test `zeroes the key it was given`.
  - Vault-Schlüssel beim Entsperren: Er gehört nach `unwrap` dem Aufrufer. `unlockVaultWithKey` behält ihn bei Erfolg in der Session und nullt ihn bei jedem Fehler (`crypto.ts:211-218`). `session.lock()` nullt ihn später (`session.ts:151`). Zwischen `unwrap` und `openWithKey` liegt kein `await` (`ipc.ts:246-249`).
- **Mindestlänge der Signatur**: `MIN_SIGNATURE_BYTES = 256` (`hello-helper.ts:20`), durchgesetzt in `helloSignature` (`:41-49`) für jede echte Helfer-Antwort (`:98`). Obergrenze 4 096 Base64-Zeichen. Test `accepts only signatures of RSA-2048 size or more`. Der Fake liefert 32 Byte, ist aber nur ungepackt aktiv (siehe Fake).
- Hingenommen nach V-R7: Die Base64-Signatur liegt kurz als unveränderlicher V8-String vor. In `Program.cs:79-83` wird das `byte[]` nicht genullt; der Prozess endet sofort danach.

### Ablauf

Ergebnis: B2 ist umgesetzt, alle drei Fälle sind sicher.
- **`keyCopy` nach der Abfrage**: `ipc.ts:230-234` holt nur `helloTarget()` (Pfad und Salt, kein Schlüssel) und übergibt `() => vaultSessionManager.keyCopy(filePath, salt)`. `HelloVaults.enable` ruft das erst nach `await this.signer.sign(…)` auf (`hello.ts:89-92`). `keyCopy` prüft Pfad **und** Salt (`session.ts:74-78`).
- **Auto-Sperre während der Abfrage**:
  - Beim Einschalten: `lock()` nullt den Session-Schlüssel, `keyCopy` wirft `core.vaultLocked`, nichts wird gespeichert, die Signatur wird genullt. IPC-Test `stores nothing when the vault is locked during the enable prompt`, Unit-Test `stores nothing when takeKey throws`. Die Windows-Abfrage selbst bleibt offen; bestätigt der Nutzer sie, erscheint „Es ist kein Vault entsperrt.“ (V-R9). Siehe M6.
  - Beim Entsperren: Der Vault ist schon gesperrt, die Auto-Sperre hat nichts zu tun. `onUnlock` setzt danach den Zeitgeber zurück (`index.ts:368`).
- **Vault-Wechsel während der Abfrage**:
  - Beim Einschalten: anderer Pfad oder Salt → `core.vaultLocked`, nichts gespeichert (Session-Test mit `keyCopy` für fremden Pfad und Salt).
  - Beim Entsperren: Die UI lässt keinen Wechsel zu. Auf dem Sperrbildschirm sind `Andere Vault-Datei` und `Entsperren` `disabled`, das Feld ist `readOnly` (`LockScreen.tsx:95`, `:101-102`). Auf dem Öffnen-Bildschirm sind Liste, Dateiauswahl, Passwortfeld (R-1) und `Zurück` über `busy` gesperrt (`App.tsx:1140`, `:1147`, `:1186`, `:1197`).
- **Fenster-Ende während der Abfrage**: Das Hauptfenster beendet Shellherd. Der Helfer ist im libuv-Job-Objekt und endet mit (Probe oben). Nichts wird geschrieben, denn das Schreiben folgt erst auf die Signatur. Ob Windows den Dialog dann schließt, ist nur am Gerät prüfbar (M5).
- **Nur eine Abfrage**: `busy` in `createHelloSigner` (`hello-helper.ts:89-100`), im Fake mit einem `await` davor (B1, `:95`). Test `runs one prompt at a time`. `available()` läuft bewusst parallel und fragt nie (Spec-Risiko 9).

### IPC (`src/main/vault/ipc.ts`)

Ergebnis: Der Renderer kann weder einen Pfad einschleusen noch einen anderen Vault entsperren oder einen Schlüssel einbringen.
- **Wächter**: alle vier Kanäle über `handle` mit `guard` = `windowRegistry.requireMain` (`ipc.ts:57-66`, `index.ts:370`).
- **`helloUnlock`** (`:240-259`): Typ und Länge des Pfads geprüft (`:242`), dann `requireAllowedPath` **vor** `readEncryptedVaultFile` (`:244-245`). Diese Prüfung ist dieselbe wie bei `unlockVault` (`:75-79`, `:222`). Test `refuses network, device and unknown paths before any file access` mit UNC-, `//`-, `\\?\UNC`-, Pipe- und unbekanntem Pfad; `mocks.read` wird nicht aufgerufen.
- **Anderer Vault**: Ein Eintrag wirkt nur für den angefragten Pfad (`grantKey`), sein eigenes `filePath` wird nie geöffnet. Der Salt-Vergleich vor der Abfrage (`hello.ts:130`) und die AAD binden ihn an die Datei. Ein umgehängter Eintrag öffnet höchstens eine Kopie desselben Vaults und nur mit Geste.
- **`helloEnable`/`helloDisable`** nehmen keine Argumente; Pfad, Salt und Schlüssel kommen aus der Session.
- **`helloStatus`** prüft nur einen String bis 4 096 Zeichen und liest die Vault-Datei nie (V-R3).
- **Schema von `hello-unlock.json`** (`hello.ts:11-22`): Eintrag `.strict()`, alle Binärfelder mit Base64-Regex **und** exakter Bytelänge, `version: z.literal(1)`, höchstens 8 Einträge. Kaputtes JSON, `version: 2` oder ein Feld zu viel ergeben „leer“ (Test `treats a broken file as empty and writes it anew`). Ein manipulierter Eintrag führt also höchstens zu einem Ausfall, nie zu einem Dateizugriff.
- **Ungültige Einträge** werden gelöscht:

  | Fall | Stelle | Test |
  |---|---|---|
  | anderer Salt, ohne Abfrage | `hello.ts:130` | `drops the entry of another salt without a prompt`, IPC `drops the entry of a replaced file without a prompt` |
  | GCM-Fehler (andere Signatur) | `hello.ts:141-146` | `drops the entry when the signature changed`, IPC `… re-created Windows Hello key` |
  | `notFound` vom Helfer | `hello.ts:136-138` (alle) | `… drops every entry when the Hello key is gone` |
  | gleicher Salt, Schlüssel öffnet nicht | `ipc.ts:252-254` | **keiner** (M-2) |
  | neuer Vault über `vault:save` | `ipc.ts:150`, direkt nach `saveVault` (K4) | – |
  | `×` in `Zuletzt benutzt` | `ipc.ts:90-93`, alle Schreibweisen (`forgetRecent`) | IPC `forgets the entry with the recent-list entry` |
  | Abbruch | Eintrag bleibt | IPC `keeps the entry after a canceled prompt` |

  Eine ganz ungültige Datei wird nicht aktiv gelöscht. Sie gilt als leer und wird beim nächsten Einschalten ersetzt; sie enthält nur verpackte Schlüssel. Hingenommen.

### Fake

Ergebnis: im Paket wirkungslos.
- **Einzige Aufrufstelle**: `ipc.ts:71-73` übergibt `app.isPackaged` an `createHelloSigner`. `SHELLHERD_HELLO_FAKE` wird nur in `fakeHelloMode` gelesen (`hello-helper.ts:52-54`), und das liefert bei `packaged === true` immer `undefined`. Andere Leser gibt es im Quellbaum nicht (geprüft per Suche; Treffer nur in `driver.mjs:49` und `screens.mjs:894-895`).
- **Test** `ignores the run-app fake in a packaged build` (`hello-helper.test.ts:9`): Gepackt, mit gesetzter Variable und einem nicht vorhandenen Programm liefert `available()` `false`, und `sign` ergibt `core.helloUnavailable`. Der Fake greift also nicht.
- Die Grenze nach V-R2 (Umbenennen in `electron.exe`) bleibt hingenommen. Der Renderer kann die Variable nicht setzen. M11 belegt es am Paket.

### Helfer

Ergebnis: Das Protokoll ist robust, nur ein Prozess signiert zur Zeit, der Code ist sauber.
- **Main-Seite** (`hello-helper.ts:64-77`):
  - Zeitlimit: `kill()` nach 120 s (Abfrage) bzw. 30 s (Status), dann `close` → leere Ausgabe → `helloFailed`. `busy` wird erst im `finally` nach `close` frei.
  - Hängender Prozess: wie Zeitlimit. Ein Prozess, der nie endet, wird vom Job-Objekt spätestens mit Shellherd beendet.
  - Große Ausgabe: höchstens rund 16 KiB plus ein Block werden gesammelt, der Rest wird gelesen und verworfen. Die Pipe läuft also nicht voll.
  - Kaputte Ausgabe: `readHelloReply` wirft `helloFailed`. Fehlendes Programm: `error` → `helloUnavailable`. stdin-Fehler werden abgefangen. `shell: false`, keine Argumente, `stderr` verworfen.
  - Den Pfad bestimmt nur Main (`resourcesPath\hello` bzw. `out/hello`).
- **Fenster-Handle**: Es wird keins übergeben. Das ist so entschieden (V-R5, Spec R1.5): `KeyCredential` hat keine HWND-Schnittstelle. Stattdessen holt `BringPromptForward` (`Program.cs:112-125`) das Fenster der Klasse `Credential Dialog Xaml Host` bis zu 5 s lang nach vorn. M1 und M7 prüfen das.
- **`Program.cs`**:
  - Liest genau eine Zeile; jede Ausnahme ergibt `failed`. Exit-Code ist immer 0.
  - Prüft `challenge` auf String, Base64 und genau 32 Byte, **bevor** WinRT aufgerufen wird (`:62-64`).
  - `create` nur bei `true` (`:65`). `RequestCreateAsync` nur mit `create` und `NotFound` (`:69-73`), mit `FailIfExists`.
  - Statusabbildung `UserCanceled`/`UserPrefersPassword` → `canceled`, `NotFound` → `notFound`, sonst `failed` (`:87-92`).
  - `Wait` setzt `Completed` und wartet; `GetResults` wirft bei Fehlern, das fängt `Main`.
  - Kein Dateizugriff, keine Argumente, keine Umgebung. Gebaut mit `/warnaserror+`.

### Paketierung und Build

Ergebnis: vollständig. Einziger Befund ist M-1.
- `electron-builder.yml`: `'!out/hello/**'` hält den Helfer aus `app.asar`; `extraResources` `out/hello` → `hello`. Das passt zu `ipc.ts:72`.
- `package.json`: `build:hello` in `dev` und `build`, jeweils nach `build:rdp-host`. `dist` → `build`, damit läuft es auch im Release (`release.yml`, Job auf `windows-latest`, Kommentar nach K10).
- `ci.yml`: `npm run build:hello` auf `windows-latest`, mit Rauchtest `status`.
- **Inkrementelle Logik** in `build-hello.mjs:35-48` und `build-rdp-host.mjs:30-36`:
  - Fehlt die exe, ist `builtAt` 0 → es wird gebaut.
  - Sonst wird nur gebaut, wenn eine Quelle, das Manifest oder das Skript selbst eine neuere mtime hat (`<=`-Vergleich). `git checkout` setzt bei geänderten Dateien die mtime neu, also wird nach einem Branch-Wechsel gebaut.
  - Scheitert `csc` (z. B. `CS0016` bei gesperrter, veralteter exe), kommt eine verständliche Meldung und Exit 1. Eine alte exe bleibt mit alter mtime liegen, der nächste Lauf baut also erneut.
  - Der Rauchtest läuft beim Hello-Helfer auch, wenn die exe aktuell ist.
  - Grenze (V-R8, hingenommen): Eine beim Wechsel **gelöschte** RDP-Quelle ändert keine mtime; die alte exe bliebe dann aktuell.
- Ein Abweichen von K6 im Wortlaut ist M-1.

### Projektregeln
- Keine Exec ohne Klick: Ohne Klick startet der Helfer nur mit `status`, das nie fragt. Es gibt keine automatische Abfrage (R3.3): Beide Knöpfe reagieren nur auf `onClick`, die Fokus-Effekte rufen nur `focus()` auf.
- „Nur lesen“ im Main: Die Vault-Datei wird nur über die bestehende Freigabe gelesen. Hello schreibt nur `hello-unlock.json` im Benutzerdatenordner.
- Keine Secrets in Logs oder Fehlern: `AppError`-Codes ohne Parameter, kein `console.*` in den neuen Main-Modulen. Das Passwort wird nie gespeichert (IPC-Test prüft die Datei).
- kubeconfig: unberührt.

## 2. Befunde

### Critical
Keine.

### Important

**I-1 – Sperrbildschirm: veralteter Hello-Status zeigt den Knopf kurz, nimmt den Fokus und lässt ihn auf `body` fallen**
- **Stelle**: `src/renderer/src/hello.ts:13-23` (`useHelloStatus`), Folge in `src/renderer/src/components/LockScreen.tsx:38`.
- **Ursache**: Der Hook behält den letzten Status, solange `filePath` `null` ist (`if (!filePath) return;`, `:16`). `App.tsx:198` übergibt `locked ? vaultPath : null`; beim nächsten Sperren liefert der Hook sofort den **alten** Status für denselben Pfad, bis die neue Antwort kommt (echter Helfer: rund 200 ms).
- **Fehlerszenario (M10)**: Hello einschalten, sperren, entsperren. Dann in den Einstellungen ausschalten und erneut sperren.
  1. Der Knopf `Mit Windows Hello entsperren` erscheint mit dem alten Status `enrolled: true`, und der Effekt in `LockScreen.tsx:38` gibt ihm den Fokus.
  2. Die neue Antwort kommt, der Knopf verschwindet. `document.activeElement` ist danach `BODY` (mit dem Treiber belegt). Wer jetzt sein Passwort tippt, tippt ins Leere.
  3. Ein `Enter` im Zeitfenster ruft `helloUnlock` ohne Eintrag auf und zeigt „Windows Hello passt nicht mehr …“, obwohl der Nutzer Hello gerade bewusst ausgeschaltet hat. Es entsteht keine Abfrage, also kein Sicherheitsproblem.
- Der Öffnen-Bildschirm hat dasselbe Cache-Verhalten, fängt den Fokus aber über den K8-Effekt auf (`App.tsx:204-209`). Dem Sperrbildschirm fehlt dieser Rückfall; K8 hatte ihn nur für den Fehlerpfad als unnötig bewertet.
- **Fix**:
  1. `src/renderer/src/hello.ts`: Im Effekt den Status verwerfen, wenn der Pfad fehlt, sodass nach einer Pause nie ein alter Status gilt: `if (!filePath) { setState(null); return; }`. `refresh()` behält den alten Wert weiterhin (Pfad unverändert).
  2. `src/renderer/src/components/LockScreen.tsx`: Als Absicherung den Fokus ins Feld legen, wenn der Knopf verschwindet und der Fokus auf `body` liegt, analog zu K8: `useEffect(() => { if (helloOffered) helloRef.current?.focus(); else if (document.activeElement === document.body) field.current?.focus(); }, [helloOffered])` (die Bedingung „kein Passwort getippt“ für den ersten Zweig bleibt).
  - Probe nach dem Fix: Der Ablauf oben zeigt keinen Knopf, und der Fokus liegt im Passwortfeld.
- **Eigentümer**: `src/renderer/src/hello.ts` (Hauptfix), `src/renderer/src/components/LockScreen.tsx` (Absicherung).

### Minor

**M-1 – `build-hello.mjs` weicht von K6 ab: Rückfallpfad `C:Windows`**
- **Stelle**: `scripts/build-hello.mjs:18`, `process.env.SystemRoot ?? 'C:\Windows'` mit **einem** Backslash (Bytes geprüft). In JavaScript ist `\W` nur `W`, der Wert ist also `C:Windows`, ein relativer Pfad auf Laufwerk C. K6 schreibt `'C:\\Windows'` vor, wie `build-rdp-host.mjs:18`.
- **Fehlerszenario**: nur ohne `SystemRoot` (z. B. ein Aufruf mit geleerter Umgebung). Dann meldet das Skript „Fehlt: C:Windows\…\csc.exe“ statt zu bauen.
- **Fix**: `'C:\\Windows'`. Ursache ist vermutlich ein Heredoc, der Backslashes halbiert; mit dem Edit-Werkzeug schreiben.
- **Eigentümer**: `scripts/build-hello.mjs`.

**M-2 – Kein Test für „gleicher Salt, Schlüssel öffnet die Datei nicht“**
- **Stelle**: `src/main/vault/ipc.ts:248-257`. Der Zweig löscht den Eintrag und macht aus `core.wrongPassword` `core.helloStale` (R2.3, dritte Zeile). Kein Test deckt ihn ab.
- **Fehlerszenario**: Eine spätere Änderung an der Fehlerabbildung in `unlockVaultWithKey`/`decryptVaultWithKey` (anderer Code als `core.wrongPassword`) ließe den unbrauchbaren Eintrag stehen. Jedes Entsperren zeigte dann eine Hello-Abfrage und danach einen allgemeinen Fehler.
- **Fix**: IPC-Test, der nach `helloEnable` die gelesene Datei durch eine mit **demselben** `kdf` aber anderem Schlüssel ersetzt (z. B. `encryptVaultWithKey(exampleVault, randomBytes(32), file.kdf)`), dann `helloUnlock` → `core.helloStale` und `helloStatus` → `enrolled: false`.
- **Eigentümer**: `src/main/vault/ipc.test.ts`.

**M-3 – `hello-setting.png` schneidet die Abschnittsüberschrift ab**
- **Stelle**: `.claude/skills/run-app/screens.mjs:916-919`. Der Klick scrollt das Kästchen an den oberen Rand; Überschrift „Vault“ und Auto-Sperre fehlen im Shot (schon im Ledger notiert).
- **Fix**: Vor `shot('hello-setting')` das Kästchen mittig scrollen, z. B. `await evaluate("document.querySelector('dialog.settings-dialog [role=status]').scrollIntoView({ block: 'center' })")`.
- **Eigentümer**: `.claude/skills/run-app/screens.mjs`.

**M-4 – Abfrage bleibt nach Sperre oder Zeitlimit stehen (nur am Gerät prüfbar)**
- **Stelle**: `hello-helper.ts:68` (`kill()` nach 120 s); `index.ts:367` (`onLock` bricht Auth-Rückfragen ab, die Hello-Abfrage nicht).
- **Fehlerszenario**: Das Zeitlimit beendet den Helfer, der Windows-Dialog gehört aber zu einem Systemprozess und bleibt eventuell offen. Bestätigt der Nutzer ihn danach, passiert nichts. Ein neuer Klick öffnet eine zweite Abfrage. Ebenso nach einer Auto-Sperre während des Einschaltens: Die Bestätigung führt dann zu „Es ist kein Vault entsperrt.“ Sicher ist beides, denn ohne Signatur an Main entsteht nichts.
- **Fix**: Erst M5/M6 am Gerät beobachten. Bleibt der Dialog stehen, im Handbuch unter „Grenzen“ einen Satz ergänzen. Ein Abbruch der Abfrage bei Sperre (Helfer beenden) ist optional und würde den Dialog aus demselben Grund nicht sicher schließen.
- **Eigentümer**: `docs/handbuch.md`, `docs/manual.md` (nur bei Befund am Gerät).

## 3. Spec-Abdeckung

| Bereich | Stand | Beleg |
|---|---|---|
| Vertrag 3.1 (Kanäle, `HelloStatus`, `HelloUnlockRequest`, 4 `DesktopApi`-Methoden) | erfüllt | `shared/ipc.ts`, `preload/index.ts` |
| 3.2 Helfer, Manifest, `electron-builder.yml`, CI | erfüllt | siehe 1. Paketierung |
| K6 Build-Skripte inkrementell | erfüllt, Wortlaut-Abweichung M-1 | `build-hello.mjs`, `build-rdp-host.mjs` |
| K10 Release-Kommentar | erfüllt | `release.yml:59` |
| 3.4 `unlockVaultWithKey` | erfüllt | `crypto.ts:207-218`, Test |
| 3.5 + K3 `openWithKey`, `helloTarget`, `keyCopy(filePath, salt)` | erfüllt | `session.ts:63-78`, Test |
| K1 `hello-helper.ts` (B1, Mindestlänge) | wörtlich | Diff gegen Anhang ohne Abweichung |
| K2 `hello.ts` (B2, Nullen, `forgetRecent`, Salt bis 4096) | wörtlich | Diff gegen Anhang ohne Abweichung |
| K4 `ipc.ts` (`saveVault`-Stelle, `helloEnable`/`helloDisable`) | erfüllt | `ipc.ts:150`, `:230-239` |
| 3.9 Fehlertexte, Reihenfolge nach `vaultPathNotAllowed` | erfüllt | `errors/core.json` beider Sprachen |
| 3.10 + K7 Renderer-Basis, `HelloSetting` mit `aria-disabled` | erfüllt | `hello.ts`, `HelloSetting.tsx:49-50` |
| 3.11 + K8 Sperr- und Öffnen-Bildschirm | erfüllt bis auf I-1 | `LockScreen.tsx`, `App.tsx:198-209`, `:439-449`, `:1166-1171` |
| R-1 Passwortfeld auf dem Öffnen-Bildschirm `disabled` während der Abfrage | erfüllt | `App.tsx:1186` über `busy` |
| R3.2 Knopf über dem Feld, Fokus, `secondary-button`, `aria-disabled` | erfüllt | Shots `hello-lock`, `hello-open` |
| R3.3 keine automatische Abfrage | erfüllt | nur `onClick`; Treiber prüft Fokus, nicht Klick |
| R3.4 Abbruch still, Fokus auf den Knopf; Fehler unter dem Feld, Status neu | erfüllt | `LockScreen.tsx:64-73`, `App.tsx:439-449`; run-app Abbruch-Prüfung |
| R4.3 kein Knopf in Nebenfenstern | erfüllt | `SecondaryWindow.tsx:142` ohne `onUnlock`/`onHelloUnlock`; `requireMain` |
| R5.1 Fake nur ungepackt | erfüllt | siehe 1. Fake |
| K5 Pflicht-Tests (C, D, F, G1) | alle vorhanden und grün | 5 + 10 + 8 + 2 Tests, dazu `unlockVaultWithKey` und Session |
| K9 run-app (Selektoren, SKILL.md-Text) | erfüllt | `screens.mjs:415`, `:421`, `:950`; SKILL.md Stolperstein |
| K11 Zeilenenden | erfüllt | kein Ganz-Datei-Diff in CRLF-Dateien |
| Abschnitt 5 Doku, Version 0.26.0 | erfüllt | Handbuch, Manual, beide CHANGELOGs, `package.json`, `package-lock.json` |
| R7/R8 kein CSS, keine Bewegung, i18n | erfüllt | `design-tokens.test.ts`, `i18n-catalog.test.ts` grün; kein `localeCompare`/`Intl` neu |
| Nicht-Ziele (Abschnitt 7) | eingehalten | kein safeStorage, kein Passwort, kein Löschen von `Shellherd.VaultUnlock`, kein Dauer-Helfer |

## 4. Manuelle Tests für den Nutzer (echte Hello-Hardware)

Mit dem gepackten Build (`npm run dist`, Setup oder Portable) und einem Test-Vault, nicht dem Arbeits-Vault. Für M10 erst I-1 beheben, sonst gilt der dort genannte Zwischenstand.

1. **M1 Einschalten, erstes Mal:** Einstellungen → Vault → `Mit Windows Hello entsperren (PIN, Gesicht oder Fingerabdruck)` setzen.
   - Windows fragt zweimal: erst Schlüssel anlegen, dann bestätigen.
   - Beide Abfragen stehen **vor** Shellherd.
   - Während der Abfrage behält das Kästchen den Fokus, ein zweiter Klick tut nichts.
   - Danach steht „Windows Hello ist für diesen Vault eingeschaltet.“ unter dem Hinweis.
2. **M2 Sperren und entsperren:** `Vault sperren` → nach etwa 0,2 s liegt der Fokus auf `Mit Windows Hello entsperren` → `Enter` → PIN.
   - Während der Abfrage steht `Warte auf Windows Hello …`, das Passwortfeld nimmt keine Eingabe an, `Andere Vault-Datei` und `Entsperren` sind gesperrt.
   - Danach ist der Vault entsperrt, offene Sitzungen laufen weiter.
3. **M3 Determinismus (entscheidet über das Release):** M2 noch zweimal wiederholen. Dann Shellherd beenden, neu starten, in `Vault öffnen` dieselbe Datei wählen und `Mit Windows Hello öffnen` klicken. Während dieser Abfrage ist das Passwortfeld ausgegraut (R-1). Jedes Mal muss der Vault aufgehen. Kommt einmal „passt nicht mehr“: nicht veröffentlichen.
4. **M4 Gesicht oder Finger:** wenn vorhanden, M2 damit statt mit PIN.
5. **M5 Abbrechen und Zeitlimit:**
   - Im Windows-Dialog `Abbrechen` wählen, ein zweites Mal „Andere Option“/PIN-Rückfall. Das jeweils auf dem Sperrbildschirm und auf dem Öffnen-Bildschirm. Shellherd zeigt keine Meldung, der Fokus liegt auf dem Hello-Knopf, das Passwort öffnet.
   - Zusatz (M-4): Den Dialog über 2 Minuten offen lassen. Erwartet: „Windows Hello hat nicht geantwortet.“ unter dem Feld. Notieren, ob der Windows-Dialog danach noch offen ist. Ist er es, darin bestätigen: Shellherd darf nicht entsperren.
   - Zusatz: Während einer Abfrage Shellherd über die Taskleiste schließen. Notieren, ob der Windows-Dialog verschwindet. Nach dem Neustart öffnet `Mit Windows Hello öffnen` wie gewohnt.
6. **M6 Auto-Sperre:** `Automatisch sperren nach` auf 1 Minute stellen und warten. Auf dem Sperrbildschirm stehen der Grund und der Hello-Knopf; Shellherd fragt **nicht** von selbst.
   - Zusatz (B2): Hello ausschalten, wieder einschalten und die Windows-Abfrage offen lassen, bis die Auto-Sperre greift. Dann bestätigen. Erwartet: Hello bleibt aus (nach dem Entsperren mit Passwort ist das Kästchen leer), keine Entsperrung.
7. **M7 Fokus aus dem Hintergrund:** Shellherd sperren, ein anderes Programm in den Vordergrund holen, dann Shellherd anklicken und Hello starten. Die Abfrage erscheint vorn und nicht nur in der Taskleiste.
8. **M8 Freigabe:** Während einer Teams- oder Snipping-Tool-Aufnahme sperren und Hello starten. Shellherd ist in der Aufnahme unsichtbar; die Windows-Abfrage darf sichtbar sein.
9. **M9 Datei ersetzt:** Den Test-Vault durch eine Kopie eines anderen Vaults gleichen Namens am selben Pfad ersetzen. `Mit Windows Hello öffnen` zeigt „Windows Hello passt nicht mehr zu diesem Vault …“ **ohne** Windows-Abfrage, der Knopf verschwindet, der Fokus geht ins Passwortfeld. Das Passwort des neuen Vaults öffnet.
10. **M10 Ausschalten:** Kästchen entfernen. Es erscheint „Windows Hello ist ausgeschaltet, der gespeicherte Schlüssel ist gelöscht.“ Dann sperren: Der Hello-Knopf erscheint nicht, der Fokus liegt im Passwortfeld (vor dem Fix von I-1 blitzt der Knopf kurz auf und der Fokus geht verloren). `%APPDATA%\Shellherd\hello-unlock.json` hat keinen Eintrag mehr für die Datei. Mit `×` in `Zuletzt benutzt` verschwindet ein Eintrag genauso.
11. **M11 Gepackt ignoriert den Fake:** Im Paketordner liegt `resources\hello\Shellherd.Hello.exe`. Shellherd aus einer Konsole mit `set SHELLHERD_HELLO_FAKE=ok` starten. Es kommt trotzdem die echte Windows-Abfrage.
12. **M12 (optional, verändert Windows):** Windows Hello unter Windows-Einstellungen → Konten → Anmeldeoptionen entfernen oder die PIN zurücksetzen.
    - Ohne Hello und ohne Eintrag zeigen die Einstellungen „Windows Hello ist auf diesem Gerät nicht eingerichtet. …“. Mit Eintrag bleibt das Kästchen gesetzt und lässt sich ausschalten; der Entsperrknopf fehlt.
    - Mit neu eingerichtetem Hello meldet der Knopf „passt nicht mehr“. Dabei werden **alle** Hello-Einträge gelöscht (V-R6). Danach geht das Einschalten wieder, beim ersten Mal mit zwei Abfragen.
13. **M13 Remotedesktop:** Per RDP auf den Rechner verbinden. Erwartet wird einer von drei Fällen: kein Hello-Knopf, „Windows Hello hat nicht geantwortet.“ oder „passt nicht mehr“. Im dritten Fall sind danach alle Einträge gelöscht (V-R6) und Hello muss lokal neu eingeschaltet werden. Das Passwort geht immer.
