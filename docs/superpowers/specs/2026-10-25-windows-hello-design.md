# Windows Hello: Vault per Hello-Schlüssel entsperren – Design

> Übernommen aus dem Konzept (Opus, `.superpowers/sdd/windows-hello-research.md`). Bindend geht `2026-10-25-windows-hello-validation.md` vor.

Branch `claude/feature/windows-hello`, gestapelt auf 0.25.0, Ziel **0.26.0**. Die Umsetzer sind Haiku-Modelle; Signaturen, Texte und Fehlercodes unten sind wörtlich zu übernehmen.


Branch `claude/feature/windows-hello`, Basis 0.25.0, Ziel **0.26.0**, CHANGELOG-Datum wörtlich `2026-10-25`.

Ziel: Ein gesperrter Vault (Sperrbildschirm, manuell oder automatisch) und ein Vault aus `Zuletzt benutzt` lassen sich per Windows Hello (PIN, Gesicht, Finger) öffnen. Das Passwort bleibt immer der Rückfall.

Die Umsetzer sind Haiku-Modelle. Signaturen, Texte, Fehlercodes und Code-Blöcke unten sind verbindlich und wörtlich zu übernehmen. Der C#-Helfer und das Build-Skript in 3.2 sind im Scratchpad wörtlich kompiliert und ausgeführt worden (Abschnitt 0.6).

---

## 0. Bestand (mit Fundstellen)

### 0.1 Vault-Format und Schlüssel
- KDF ist Argon2id mit 64 MiB, 3 Durchläufen und Parallelität 1 (`src/main/vault/crypto.ts:19-21`), Schlüssel 32 Byte, Salt 16 Byte (`:23-24`). Verschlüsselt wird mit AES-256-GCM und festem AAD (`:28-31`).
- **Der Salt entsteht nur in `encryptVault`** (`crypto.ts:68`), also beim Anlegen eines Vaults (`saveVault`, `storage.ts:116-130`). Normales Speichern nutzt den Session-Schlüssel und das KDF der Session weiter (`session.ts:97-101` → `encryptVaultWithKey`, `crypto.ts:98-107`). Der abgeleitete Schlüssel einer Vault-Datei bleibt also über alle Speichervorgänge gleich; nur eine neu angelegte Datei hat einen neuen Salt.
- **Es gibt keine Funktion „Passwort ändern“** (Suche nach `changePassword`/`newPassword` ohne Treffer). Ein „neues Passwort“ heißt heute: neue Datei, neuer Salt.
- `unlockVault(file, password)` leitet ab und entschlüsselt (`crypto.ts:168-201`). Die eigentliche Entschlüsselung `decryptVaultWithKey` ist privat (`:203-261`). Ein GCM-Fehler wird zu `core.wrongPassword` (`:244-247`).
- `VaultSessionManager` (`session.ts`) hält `filePath`, `vault`, `key`, `kdf` (`:17-24`). `unlock` liest die Datei, entschlüsselt und ersetzt erst danach die alte Session (`:54-85`). `lock()` merkt sich `{ filePath, vaultId }` und nullt den Schlüssel (`:130-138`). Nur derselbe Vault in derselben Datei setzt seine Sitzungen fort (`resumesLocked`, `:34-36`).

### 0.2 IPC und Sperre
- `vault:unlock` prüft Passwort und Pfad, dann `vaultPathAllowed` **vor jedem Dateizugriff** (`src/main/vault/ipc.ts:192-196`), dann `unlock`, `recent.touch`, `onSessionChange` nur bei Wechsel, `onUnlock`, `onVaultChange` (`:197-210`).
- `vault:save` legt eine neue Datei mit neuem Salt an und entsperrt sie (`ipc.ts:83-137`).
- Alle Vault-Kanäle laufen über `handle` mit `guard` = `windowRegistry.requireMain` (`ipc.ts:55-64`, `src/main/index.ts:370`).
- Sperren: `onLock` und die Auto-Sperre schalten den Fensterschutz ein, brechen Rückfragen ab und melden `vaultLocked` (`index.ts:360-376`). Manuelle und automatische Sperre zeigen **denselben** Sperrbildschirm; nur `minutes` unterscheidet sie (`LockScreen.tsx:12`, `:69`).

### 0.3 Renderer
- `LockScreen` (`src/renderer/src/components/LockScreen.tsx`): Passwortfeld mit `autoFocus` (`:74`), `submit` (`:47-54`), Formular nur im Hauptfenster; Nebenfenster zeigen „Entsperre den Vault im Hauptfenster.“ (`:84`).
- `App.tsx`: Vorauswahl über `lastVaultFile` (`:246-258`), `handleOpenVault` (`:392-423`), `unlockFromLock` (`:638-650`), Sperrbildschirm-Aufruf (`:984`), Formular „Vault öffnen“ (`:1104-1175`), `SettingsDialog` (`:835-840`). Alle Hooks stehen vor dem frühen `return` des Vault-Bildschirms.
- `RecentVaults` entfernt per `removeRecentVault(id)` (`RecentVaults.tsx:32-37`).
- Einstellungen → Vault: `Vor dem Trennen … nachfragen` und `Automatisch sperren nach …` (`SettingsDialog.tsx:138-150`). Selbstständige Einstellungs-Komponenten mit eigenem IPC gibt es schon (`FileTypeSetting.tsx`, `UpdateSetting`).
- Fehler kommen als `AppError`-Code; `codedFrom(error, fallback)` erkennt den Code auch in IPC-Fehlern (`src/shared/errors.ts:106-111`).

### 0.4 Geräteeinstellungen und Freigabeliste (Paket haertung)
- `settings.json` kennt nur `language`, `theme`, `mainWindow`, `update`, `recentVaults` (`src/main/app-settings.ts:17`). `writeAppSettings` behält fremde Schlüssel, schreibt ohne Dateirechte (`:83-90`).
- `recentKey`, `grantKey` (ASCII-Faltung) und `recentId` (`recent-vaults.ts:145-157`); `RecentVaults.has` liest nur `settings.json` (`:199-203`).
- `vaultPathAllowed(filePath, grants, lockedPath, inRecent)` (`path-grants.ts`): Freigabe, gesperrte Session oder `Zuletzt benutzt`.
- Fensterschutz: Während der Sperre `setContentProtection(true)` für Haupt- und Nebenfenster (`index.ts:360-364`), neue Fenster erben es (`:123`).

### 0.5 Helfer, Paketierung, CI
- RDP-Helfer: C# unter `native/Shellherd.RdpHost`, gebaut mit dem `csc.exe` aus .NET Framework 4.8 (`scripts/build-rdp-host.mjs`), Pfad `app.isPackaged ? resources\rdp-host\… : out\rdp-host\…` (`src/main/rdp/ipc.ts:30-32`), Protokoll JSON-Zeilen über stdin/stdout (`rdp/host.ts:182-205`).
- `electron-builder.yml`: `out/rdp-host` ist aus `files` ausgenommen und als `extraResources` nach `rdp-host` kopiert.
- `package.json`: `dev` und `build` rufen `build:rdp-host` auf; `build` baut **nach** `electron-vite build`.
- CI (`.github/workflows/ci.yml`) auf `windows-latest`: nur `npm ci`, `typecheck`, `vitest`. Der RDP-Helfer wird in CI nicht gebaut. Release (`release.yml`) baut mit `npm run dist` auf `windows-latest`.
- **Keine Codesignatur** im Projekt (keine `CSC_*`-Variablen, kein `signtool`). Auch der RDP-Helfer ist unsigniert.
- Test-Hooks über Umgebungsvariablen gibt es schon (`SHELLHERD_UPDATE_URL` nur für `127.0.0.1`, `import-source.ts:81-92`). run-app startet `electron.exe` mit dem Ordner der Skill (`driver.mjs:34-50`), also **ungepackt** (`app.isPackaged === false`), mit eigenem Profil (`boot.mjs`).

### 0.6 Geprüfte Annahmen (WinRT aus `csc.exe`), ohne Hello-Dialog
Alles im Scratchpad `C:\Users\alexa\AppData\Local\Temp\claude\C--workspace-Shellherd\821585cb-09d8-4824-863b-740c14694f7a\scratchpad\hello\`:
1. `csc.exe` ist Version 4.8.9221.0 und kann nur C# 5 (kein `$""`, kein `?.`, kein `nameof`).
2. **Der naheliegende Weg scheitert:** Mit `System.Runtime.WindowsRuntime.dll` (für `AsTask()` und `IBuffer.ToArray()`) bricht der Build mit `CS0012` ab. Die Fassade verlangt die vereinigte `Windows.winmd` aus dem Windows SDK (`Probe.cs`).
3. **Der Weg ohne SDK funktioniert:** Verweise auf `System32\WinMetadata\Windows.Foundation.winmd`, `Windows.Security.winmd` und `Windows.Storage.winmd` plus `System.Runtime.dll`. Warten über `IAsyncOperation<T>.Completed`, Puffer über `CryptographicBuffer.CreateFromByteArray`/`CopyToByteArray` (`Probe2.cs`). Ausgabe auf diesem Rechner:
   - `UserConsentVerifier.CheckAvailabilityAsync()` → `Available`
   - `KeyCredentialManager.IsSupportedAsync()` → `True`
   - `KeyCredentialManager.OpenAsync("<unbekannt>")` → `NotFound`, **ohne Dialog**
   - `IUserConsentVerifierInterop` (HWND-Variante) lässt sich über `RoGetActivationFactory` holen
   - Der Passport-KSP (`NCryptOpenStorageProvider("Microsoft Passport Key Storage Provider")`) öffnet sich.
4. Der Helfer aus 3.2 baut mit `/warnaserror+` zu 6,6 KB. `{"op":"status"}` antwortet `{"ok":true,"available":true}` in 119–143 ms. Kaputte Anfragen (`garbage`, leere Eingabe, falsche Challenge-Länge, unbekannte `op`) liefern `{"ok":false,"status":"failed"}`, ohne Dialog. Ein gültiges `sign` wurde **nicht** ausgeführt.
5. Das Build-Skript aus 3.2 lief wörtlich in einer Kopie der Ordnerstruktur (`repo\scripts\build-hello.mjs`): „Hello-Helfer gebaut … (Windows Hello verfügbar)“.
6. PowerShell 5.1 lädt den WinRT-Typ ebenfalls (`FullLanguage`), braucht aber 314 ms nur bis zum Typ, ohne Warten auf das Ergebnis.
7. Die Krypto aus 3.6 (HKDF-SHA256 aus der Signatur, AES-256-GCM, AAD mit Salt) ist in Node gegengeprüft. Der Rundlauf gelingt; eine andere Signatur oder ein anderer Salt werden abgelehnt.

---

## 1. Empfehlungen

| # | Fläche / Funktion | Wert | Aufwand |
|---|---|---|---|
| 1a | Helfer `Shellherd.Hello.exe` (C#, `csc.exe`, WinRT `KeyCredentialManager`): Er signiert eine gespeicherte Challenge; Main leitet daraus den Schlüssel ab, der den Vault-Schlüssel verpackt | ★★★ | kleine Main-Änderung plus Helfer |
| 1b | `Mit Windows Hello entsperren` auf dem Sperrbildschirm, manuell und nach Auto-Sperre | ★★★ | Renderer |
| 1c | `Mit Windows Hello öffnen` in `Vault öffnen` für die ausgewählte Datei, auch nach einem Neustart | ★★★ | Renderer |
| 1d | Einschalten und Ausschalten je Vault: Einstellungen → Vault → `Mit Windows Hello entsperren (PIN, Gesicht oder Fingerabdruck)` | ★★★ | Renderer |
| 1e | Automatisch ungültig: ersetzte oder neu angelegte Datei (anderer Salt), neu eingerichtetes Windows Hello, `×` in `Zuletzt benutzt` | ★★★ | Main |
| 1f | run-app-Fake `SHELLHERD_HELLO_FAKE`, wirkt nur ungepackt | ★★★ | Main (klein) |
| 1g | Helfer in CI bauen und ohne Dialog anstarten (Rauchtest) | ★★ | CI-Zeile |
| 1h | Angebot „Windows Hello einrichten?“ nach dem Entsperren mit Passwort | ★ | nicht jetzt (R3.6) |
| 1i | Automatische Hello-Abfrage beim Erscheinen des Sperrbildschirms | ★ | nie (R3.3) |
| 1j | Codesignatur für beide Helfer | ★★ | nicht jetzt (R6.3) |

---

## 2. Rulings (Entscheidungen mit Begründung)

### 1 – Technik

**R1.1 Gewählt: `KeyCredentialManager`, Signatur über eine gespeicherte Challenge, daraus per HKDF der Schlüssel, der den Vault-Schlüssel verpackt.** Weder `safeStorage` noch `UserConsentVerifier`.

Ehrlicher Vergleich:

| Variante | Wer erzwingt die Geste? | Schadsoftware unter demselben Konto | Kopie der Platte plus Windows-Passwort | Aufwand |
|---|---|---|---|---|
| `safeStorage` (DPAPI) allein | niemand | entschlüsselt still, jederzeit | entschlüsselbar (DPAPI-Masterkey hängt am Windows-Passwort bzw. Domänen-Backup-Key) | klein |
| `UserConsentVerifier` (Ja/Nein) + `safeStorage` | nur Shellherds eigener Code | ruft `CryptUnprotectData` selbst auf, die Geste ist umgangen | entschlüsselbar | mittel |
| **`KeyCredentialManager`, Signatur → HKDF** | **Windows** (privater Schlüssel im TPM, jede Signatur braucht PIN, Gesicht oder Finger) | muss eine **sichtbare** Hello-Abfrage auslösen, und der Nutzer muss sie bestätigen | **nicht** entschlüsselbar: Der TPM-Schlüssel verlässt den Rechner nicht | mittel |
| NCrypt Passport-KSP direkt (RSA-Entschlüsselung) | Windows | wie oben | wie oben | höher: Schlüsselnamensformat `<SID>//…` ist nicht dokumentiert |

- Das Ja/Nein von `UserConsentVerifier` ist eine Rückfrage, keine Schutzschicht. Sie schützt nur vor Menschen am entsperrten Windows, die das Vault-Passwort nicht kennen; das kann die Signaturvariante genauso.
- Was die Signaturvariante **zusätzlich** bringt, ist echt:
  1. Kein stilles Entschlüsseln durch Schadsoftware. Sie muss eine Abfrage auslösen, die der Nutzer sieht.
  2. Kein Offline-Angriff auf eine Kopie von `%APPDATA%`, auch nicht mit dem Windows-Passwort.
  3. Der PIN-Hammerschutz des TPM gilt.
- Was sie **nicht** bringt (gehört so ins Handbuch):
  - Schadsoftware, die den Arbeitsspeicher eines entsperrten Shellherd liest oder das Passwort mitschneidet, gewinnt weiter.
  - Eine Abfrage zur passenden Zeit, etwa während der Nutzer selbst entsperren will, kann sie ihm unterschieben. Die Windows-Abfrage nennt die App nicht verlässlich.
  - Ohne TPM (manche VMs) liegt der Hello-Schlüssel nur softwaregeschützt.

**R1.2 „Nicht wiederholbare Challenge“: nein, die Challenge ist gespeichert und bleibt gleich.**
- Zur Schlüsselableitung muss dieselbe Eingabe dieselbe Signatur ergeben. Eine frische Challenge pro Entsperren ergäbe jedes Mal einen anderen Schlüssel.
- Frische schützt vor Wiedereinspielen bei einem *Prüfer*, etwa einem Server. Lokal gibt es keinen Prüfer, der Frische auswerten könnte.
- Die Sicherheit kommt allein daher, dass nur der TPM-Schlüssel nach einer Geste diese Signatur erzeugt. Die Challenge darf öffentlich in der Datei stehen.
- **Voraussetzung:** Die Signatur ist deterministisch. Das gilt für RSASSA-PKCS1-v1_5, und Hello-Schlüssel sind RSA-2048. Nach meinem Kenntnisstand nutzt KeePassXC für seinen Windows-Hello-Schnellzugang genau dieses Verfahren.
  - Geprüft ist das hier nicht, denn das hätte einen Dialog ausgelöst. Der manuelle Test **M3** entscheidet vor dem Release.
  - Fällt M3 durch, meldet jedes Entsperren „passt nicht mehr“ (sicher, aber nutzlos). Dann wird das Paket **nicht** veröffentlicht.

**R1.3 Eigener C#-Helfer, nicht PowerShell.**
- Dafür spricht:
  - `csc.exe` reicht. Der Weg ist belegt (0.6) und braucht keine neue Abhängigkeit.
  - Der Helfer ist 6,6 KB groß und startet in etwa 140 ms.
  - Es ist dasselbe Muster wie beim RDP-Helfer.
- Gegen PowerShell spricht:
  - In verwalteten Umgebungen sind Constrained Language Mode, AppLocker und AMSI üblich und verhindern das Laden von WinRT-Typen.
  - Mit 314 ms ist PowerShell schon für den bloßen Typ-Load langsamer.
  - Warten auf `IAsyncOperation` geht dort nur über Reflection auf `AsTask`.
  - Skripttext in der Befehlszeile ist schlechter prüfbar.

**R1.4 Einmal-Prozess statt Dauerläufer.**
- Pro Anfrage kommt eine JSON-Zeile hinein und eine heraus, danach endet der Prozess.
- Es gibt keinen Zustand, keinen Neustart und keine Lebenszyklus-Kopplung wie beim RDP-Helfer.
- Ein Shellherd-Schlüssel `Shellherd.VaultUnlock` gilt für alle Vaults. Jeder Vault hat seine eigene Challenge.

**R1.5 Vordergrund der Abfrage.**
- `RequestSignAsync` hat keinen Fensterparameter, und unter Win32 kann die Abfrage hinter Shellherd aufgehen.
- Der Helfer sucht deshalb bis zu 5 s nach dem Fenster der Klasse `Credential Dialog Xaml Host` und holt es mit `SetForegroundWindow` nach vorn.
- Das ist erlaubt, weil der Vordergrundprozess (Shellherd) den Helfer gestartet hat. Die Wirkung prüft **M1**/**M7**.
- Die dokumentierte HWND-Schnittstelle `IUserConsentVerifierInterop` gibt es nur für das Ja/Nein, das in R1.1 verworfen ist.

### 2 – Was gespeichert wird

**R2.1 Gespeichert wird der abgeleitete Vault-Schlüssel (32 Byte), nie das Passwort.**
- Das Passwort ist oft anderswo wiederverwendet.
- Der Schlüssel öffnet nur diese eine Datei mit ihrem Salt.
- Eine neue Datei (neuer Salt) macht ihn von selbst wertlos.
- Ehrliche Grenze: Wer den Schlüssel einmal hat, entschlüsselt auch alle späteren Speicherstände dieser Datei, denn der Salt bleibt (0.1). Das gilt genauso für das Passwort. Abhilfe wäre ein späteres „Passwort ändern“ mit neuem Salt (Extra).

**R2.2 Eigene Datei `hello-unlock.json` im Benutzerdatenordner, nicht `settings.json`.**
- Gründe:
  - Geheimes Material liegt getrennt von harmlosen Einstellungen.
  - Die Datei hat ein eigenes Schema und eigene Rechte (`0o600`).
  - Sie lässt sich gezielt löschen.
  - `writeAppSettings` schreibt ohne Rechte und wird bei jedem Fenster- und Sprachwechsel geschrieben.
- Inhalt: `{ version: 1, vaults: [{ filePath, salt, challenge, nonce, tag, wrapped }] }`, neuester Eintrag vorn, höchstens 8 (`MAX_RECENT_VAULTS`). Ist die Datei kaputt, gilt sie als leer.
- Verpackung:
  - Schlüssel = HKDF-SHA256(Signatur, Salt = Challenge, Info `shellherd-hello-v1`, 32 Byte)
  - Verfahren AES-256-GCM mit AAD `shellherd-hello:v1:<kdf.salt der Vault-Datei>`

**R2.3 Ungültig wird ein Eintrag so:**

| Ereignis | Erkennung | Folge |
|---|---|---|
| Datei ersetzt oder neu angelegt (anderer `kdf.salt`) | Salt-Vergleich **vor** der Abfrage | Eintrag gelöscht, `core.helloStale`, keine Hello-Abfrage |
| Neuer Vault über `Speichern` am selben Pfad | `vault:save` | Eintrag sofort gelöscht |
| Gleicher Salt, Schlüssel öffnet die Datei nicht | GCM `core.wrongPassword` | Eintrag gelöscht, `core.helloStale` |
| Hello neu eingerichtet (PIN-Reset), Schlüssel fehlt | Helfer meldet `notFound` | **alle** Einträge gelöscht, `core.helloStale` |
| Hello-Schlüssel neu, gleicher Name | andere Signatur → GCM-Fehler | Eintrag gelöscht, `core.helloStale` |
| Hello abgeschaltet | `available: false` | Knopf ausgeblendet, Einträge bleiben, Ausschalten in den Einstellungen geht |
| Anderes Windows-Konto | eigener `%APPDATA%`, eigener Schlüssel | nichts zu tun |
| `×` in `Zuletzt benutzt` | `removeRecentVault` | Eintrag gelöscht |
| Ausschalten in den Einstellungen | `helloDisable` | Eintrag gelöscht |

**R2.4 Der Windows-Hello-Schlüssel `Shellherd.VaultUnlock` wird nie gelöscht.**
- Ohne Einträge in `hello-unlock.json` ist er wertlos.
- `DeleteAsync` ist ungeprüft; ob es eine Abfrage zeigt, ist nicht belegt.
- Er verschwindet mit dem Zurücksetzen der PIN. So steht es im Handbuch.

### 3 – Ablauf und UI

**R3.1 Einschalten nur in den Einstellungen**, unter Einstellungen → Vault nach der Auto-Sperre, als Kontrollkästchen `Mit Windows Hello entsperren (PIN, Gesicht oder Fingerabdruck)`.
- Der Hinweis darunter sagt, dass es nur für diesen Vault, dieses Gerät und dieses Windows-Konto gilt.
- Einschalten verlangt einen entsperrten Vault und eine Hello-Geste, aber **kein** Passwort. Der Schlüssel liegt ohnehin in der Session, und ohne Geste entsteht nichts.
- Beim allerersten Mal fragt Windows zweimal: einmal für das Anlegen des Shellherd-Schlüssels, einmal für die Signatur.
- Ist Hello nicht eingerichtet und der Vault nicht eingeschaltet, steht dort nur der Hinweis `app:hello.unavailable`.

**R3.2 Knopf statt Zusatzfeld.**
- **Sperrbildschirm:** `Mit Windows Hello entsperren` erscheint als `secondary-button` im Formular über dem Passwortfeld. Ist noch kein Passwort getippt, bekommt er den Fokus, sobald der Status da ist. `Enter` startet dann Hello; mit `Tab` erreicht man das Passwortfeld. `Entsperren` bleibt der einzige `primary-button`.
- **Vault öffnen:** `Mit Windows Hello öffnen` erscheint als `secondary-button` zwischen „Ausgewählte Datei“ und dem Passwortfeld, gleiche Fokusregel.
- Während der Abfrage lautet die Beschriftung `Warte auf Windows Hello …`. Der Knopf ist dann `aria-disabled` statt `disabled`, damit der Fokus bleibt.
- Kein neues CSS und keine Bewegung.

**R3.3 Keine automatische Abfrage, nirgends.**
- Ein Klick oder `Enter` genügt.
- Eine von selbst erscheinende Abfrage gewöhnt Nutzer daran, Abfragen zu bestätigen, die sie nicht selbst ausgelöst haben. Genau das wäre der Angriffsweg aus R1.1.

**R3.4 Abbruch, Rückfall, Fehler.**
- Abbruch im Windows-Dialog, auch „Passwort verwenden“ (`UserCanceled`, `UserPrefersPassword`), wird zu `core.helloCanceled`. Es erscheint **keine** Meldung; der Fokus geht auf den Hello-Knopf zurück.
- Alle anderen Fehler stehen als `error-message` unter dem Feld, wie ein falsches Passwort. Danach fragt der Renderer den Status neu ab. Bei `helloStale` verschwindet der Knopf, und der Fokus geht ins Passwortfeld.
- Codes:
  - `core.helloStale`
  - `core.helloUnavailable`
  - `core.helloFailed`: kein oder kaputtes Ergebnis, Zeitlimit 120 s, TPM gesperrt
  - `core.helloBusy`: eine zweite Abfrage, während eine läuft
- Ein fehlender Helfer (`ENOENT`) zählt als `helloUnavailable`. Die Statusabfrage liefert dann `available: false`.

**R3.5 Auto-Sperre: ja, gleich.** Der Sperrbildschirm ist derselbe, also gibt es denselben Knopf. Auch das Öffnen nach einem Neustart geht.

**R3.6 Kein Angebot nach dem Entsperren mit Passwort (nicht jetzt).** Es wäre eine neue Meldungsart mit Aktion, und es würde bei jedem Vault nerven. Den Weg nennen Handbuch und CHANGELOG. Wird es gewünscht, kommt es als Extra.

### 4 – Zusammenspiel

**R4.1 Freigabeliste:**
- `vault:hello-unlock` prüft `vaultPathAllowed` **vor** dem Lesen der Datei, genau wie `vault:unlock`.
- `vault:hello-status` liest die Vault-Datei nie und vergleicht nur mit `hello-unlock.json`.
- Einträge entstehen nur für den Pfad der entsperrten Session. Der war schon freigegeben.

**R4.2 Fensterschutz:**
- Die Hello-Abfrage ist ein Fenster eines Windows-Prozesses. `WDA_EXCLUDEFROMCAPTURE` auf Shellherds Fenstern betrifft sie nicht, sie erscheint normal über dem Sperrbildschirm.
- In einer Bildschirmfreigabe kann sie sichtbar sein. Sie zeigt nichts aus dem Vault.
- Es ändert sich nichts am Fensterschutz.

**R4.3 Nebenfenster:**
- Sie bekommen keinen Knopf, denn ihr Sperrbildschirm hat kein Formular (`LockScreen.tsx:84`).
- Alle Hello-Kanäle laufen über `guard` = `requireMain`.

**R4.4 Wechsel und Sitzungen:**
- Hello-Entsperren nutzt denselben Abschluss wie `vault:unlock` (`finishUnlock`).
- Derselbe Vault setzt seine Sitzungen fort, ein anderer beendet sie.

### 5 – Testbarkeit

**R5.1 Fake im Main-Prozess, nur ungepackt.**
- `SHELLHERD_HELLO_FAKE` wirkt nur bei `!app.isPackaged`. Der Wert wird bei **jedem** Aufruf neu gelesen, damit eine Szene ihn über die `main`-Route umschalten kann.
- Werte:
  - `ok`: Signatur = HMAC-SHA256 mit festem Schlüssel, deterministisch
  - `cancel`
  - `unavailable`
  - `reset`: andere HMAC-Signatur, steht für einen neu angelegten Hello-Schlüssel
- Kein Fake-Programm und keine `.cmd`, denn `spawn` ohne Shell startet keine Batchdateien.
- Im Paket ist `app.isPackaged` wahr; die Variable ist dann wirkungslos. Ein Unit-Test belegt das (`fakeHelloMode(true, …)`).

**R5.2 Unit-Tests ohne Hello.**
- `HelloVaults` bekommt den `HelloSigner` injiziert.
- `createHelloSigner` wird mit Fake und mit einem nicht vorhandenen Programm (ENOENT) getestet.
- Der IPC-Test nutzt den Fake (`process.env.SHELLHERD_HELLO_FAKE = 'ok'`, im Test ist `app.isPackaged` undefiniert).

**R5.3 Der echte Helfer wird bei jedem Build und in CI gebaut und mit `status` angestartet.** Das löst keinen Dialog aus. Ist Hello auf dem CI-Server nicht vorhanden, antwortet er `available: false` oder `ok: false`; beides ist gültiges JSON und grün.

### 6 – Paketierung

**R6.1** `out/hello/Shellherd.Hello.exe` kommt als `extraResources` nach `hello`. Main nutzt `resources\hello\…` im Paket und sonst `out\hello\…` (Muster `rdp/ipc.ts:30-32`).

**R6.2** `build:hello` läuft in `dev` und `build` direkt nach `build:rdp-host`, also nach `electron-vite build`. CI bekommt eine Zeile `npm run build:hello`.

**R6.3 Keine Signatur in diesem Paket.** Der RDP-Helfer ist auch unsigniert. Signieren gehört für App, Installer und beide Helfer zusammen in ein eigenes Paket.

### Allgemein
- **R7** Keine Bewegung, keine neuen Tokens, kein neues CSS.
- **R8** Alle Texte gehen über `t()`; neue Keys in de-DE und en-US, ohne `{{count}}`.
- **R9** Version 0.26.0.

---

## 3. Vertrag (wörtlich)

### 3.1 `src/shared/ipc.ts` und `src/preload/index.ts` (Task A)

In `IPC_CHANNELS` nach `knownHostsImport`:
```ts
  helloStatus: 'vault:hello-status',
  helloEnable: 'vault:hello-enable',
  helloDisable: 'vault:hello-disable',
  helloUnlock: 'vault:hello-unlock',
```
Typen nach `RecentVault`:
```ts
/** Windows Hello for one vault path on this device: available = Windows Hello is set up; enrolled = a wrapped key is stored for the path. */
export interface HelloStatus { available: boolean; enrolled: boolean }

export interface HelloUnlockRequest { filePath: string }
```
In `DesktopApi` nach `knownHostsImport`:
```ts
  /** Never prompts and never reads the vault file. Main window only. */
  helloStatus: (filePath: string) => Promise<HelloStatus>;
  /** Prompts Windows Hello and stores the key of the unlocked vault for this device; rejects with core.helloCanceled and other codes. */
  helloEnable: () => Promise<HelloStatus>;
  /** Deletes the stored key of the unlocked vault; no prompt. */
  helloDisable: () => Promise<HelloStatus>;
  /** Same path checks and result as unlockVault, with Windows Hello instead of the password. */
  helloUnlock: (request: HelloUnlockRequest) => Promise<UnlockVaultResult>;
```
Preload nach `knownHostsImport`:
```ts
  helloStatus: filePath => ipcRenderer.invoke('vault:hello-status', filePath),
  helloEnable: () => ipcRenderer.invoke('vault:hello-enable'),
  helloDisable: () => ipcRenderer.invoke('vault:hello-disable'),
  helloUnlock: request => ipcRenderer.invoke('vault:hello-unlock', request),
```

### 3.2 Helfer und Build (Task B)

**`native/Shellherd.Hello/Program.cs` (neu), wörtlich (kompiliert, siehe 0.6):**
```csharp
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;
using System.Web.Script.Serialization;
using Windows.Foundation;
using Windows.Security.Credentials;
using Windows.Security.Cryptography;

namespace Shellherd.Hello
{
    /// <summary>
    /// One JSON request on stdin, one JSON line on stdout, then exit.
    /// Signs a 32-byte challenge with the Windows Hello key "Shellherd.VaultUnlock"; the signature is the only secret it prints.
    /// </summary>
    public static class Program
    {
        private const string KeyName = "Shellherd.VaultUnlock";
        // Window class of the Windows Hello prompt; without help it may open behind Shellherd.
        private const string PromptClass = "Credential Dialog Xaml Host";

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern IntPtr FindWindow(string className, string windowName);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SetForegroundWindow(IntPtr window);

        public static int Main()
        {
            var json = new JavaScriptSerializer();
            Dictionary<string, object> reply;
            try
            {
                string line = Console.In.ReadLine();
                reply = Handle(line == null ? null : json.Deserialize<Dictionary<string, object>>(line));
            }
            catch (Exception)
            {
                reply = Failure("failed");
            }
            Console.Out.WriteLine(json.Serialize(reply));
            Console.Out.Flush();
            return 0;
        }

        private static Dictionary<string, object> Handle(Dictionary<string, object> request)
        {
            object op;
            if (request == null || !request.TryGetValue("op", out op)) return Failure("failed");
            if ("status".Equals(op))
            {
                var status = new Dictionary<string, object>();
                status["ok"] = true;
                status["available"] = Wait(KeyCredentialManager.IsSupportedAsync());
                return status;
            }
            if (!"sign".Equals(op)) return Failure("failed");

            object challengeText;
            object createValue;
            if (!request.TryGetValue("challenge", out challengeText) || !(challengeText is string)) return Failure("failed");
            byte[] challenge = Convert.FromBase64String((string)challengeText);
            if (challenge.Length != 32) return Failure("failed");
            bool create = request.TryGetValue("create", out createValue) && true.Equals(createValue);
            if (!Wait(KeyCredentialManager.IsSupportedAsync())) return Failure("unavailable");

            KeyCredentialRetrievalResult opened = Wait(KeyCredentialManager.OpenAsync(KeyName));
            if (opened.Status == KeyCredentialStatus.NotFound && create)
            {
                BringPromptForward();
                opened = Wait(KeyCredentialManager.RequestCreateAsync(KeyName, KeyCredentialCreationOption.FailIfExists));
            }
            if (opened.Status != KeyCredentialStatus.Success) return Failure(StatusText(opened.Status));

            BringPromptForward();
            KeyCredentialOperationResult signed = Wait(opened.Credential.RequestSignAsync(CryptographicBuffer.CreateFromByteArray(challenge)));
            if (signed.Status != KeyCredentialStatus.Success) return Failure(StatusText(signed.Status));
            byte[] signature;
            CryptographicBuffer.CopyToByteArray(signed.Result, out signature);
            var reply = new Dictionary<string, object>();
            reply["ok"] = true;
            reply["signature"] = Convert.ToBase64String(signature);
            return reply;
        }

        private static string StatusText(KeyCredentialStatus status)
        {
            if (status == KeyCredentialStatus.UserCanceled || status == KeyCredentialStatus.UserPrefersPassword) return "canceled";
            if (status == KeyCredentialStatus.NotFound) return "notFound";
            return "failed";
        }

        private static Dictionary<string, object> Failure(string status)
        {
            var reply = new Dictionary<string, object>();
            reply["ok"] = false;
            reply["status"] = status;
            return reply;
        }

        /// <summary>Blocks until the WinRT operation ends; Completed fires at once if it already has.</summary>
        private static T Wait<T>(IAsyncOperation<T> operation)
        {
            var done = new ManualResetEventSlim(false);
            operation.Completed = delegate { done.Set(); };
            done.Wait();
            return operation.GetResults();
        }

        /// <summary>Raises the Hello prompt once it exists (up to 5 s); allowed because Shellherd, the foreground process, started this one.</summary>
        private static void BringPromptForward()
        {
            var thread = new Thread(delegate ()
            {
                for (int attempt = 0; attempt < 50; attempt++)
                {
                    IntPtr prompt = FindWindow(PromptClass, null);
                    if (prompt != IntPtr.Zero) { SetForegroundWindow(prompt); return; }
                    Thread.Sleep(100);
                }
            });
            thread.IsBackground = true;
            thread.Start();
        }
    }
}
```

**`native/Shellherd.Hello/app.manifest` (neu):**
```xml
<?xml version="1.0" encoding="utf-8"?>
<assembly manifestVersion="1.0" xmlns="urn:schemas-microsoft-com:asm.v1">
  <assemblyIdentity version="0.0.1.0" name="Shellherd.Hello" type="win32" processorArchitecture="amd64" />
  <compatibility xmlns="urn:schemas-microsoft-com:compatibility.v1">
    <application>
      <!-- Windows 10 / 11 -->
      <supportedOS Id="{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}" />
    </application>
  </compatibility>
</assembly>
```

**`scripts/build-hello.mjs` (neu), wörtlich (ausgeführt, siehe 0.6):**
```js
// Builds the Windows Hello helper with the C# compiler that ships with Windows (.NET Framework 4.8).
// WinRT types come from the metadata in System32\WinMetadata: no SDK, NuGet or Visual Studio required.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') {
  console.log('Hello-Helfer wird nur unter Windows gebaut - übersprungen.');
  process.exit(0);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'native', 'Shellherd.Hello');
// --out <dir> builds elsewhere, e.g. while a running Shellherd locks out/hello.
const outFlag = process.argv.indexOf('--out');
const outputDir = outFlag > 0 && process.argv[outFlag + 1] ? resolve(process.argv[outFlag + 1]) : join(root, 'out', 'hello');
const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
const framework = join(systemRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319');
const metadata = join(systemRoot, 'System32', 'WinMetadata');
const csc = join(framework, 'csc.exe');
// System.Runtime.WindowsRuntime.dll (AsTask, ToArray) expects the SDK's merged Windows.winmd; Program.cs does without it on purpose.
const references = [
  ...['System.dll', 'System.Core.dll', 'System.Runtime.dll', 'System.Web.Extensions.dll'].map(file => join(framework, file)),
  ...['Windows.Foundation.winmd', 'Windows.Security.winmd', 'Windows.Storage.winmd'].map(file => join(metadata, file)),
];
for (const file of [csc, ...references]) {
  if (!existsSync(file)) {
    console.error(`Fehlt: ${file}`);
    process.exit(1);
  }
}

const executable = join(outputDir, 'Shellherd.Hello.exe');
mkdirSync(outputDir, { recursive: true });
execFileSync(csc, [
  '/nologo', '/noconfig', '/target:winexe', '/platform:x64', '/optimize+', '/warnaserror+',
  `/win32manifest:${join(source, 'app.manifest')}`,
  ...references.map(reference => `/reference:${reference}`),
  `/out:${executable}`,
  join(source, 'Program.cs'),
], { stdio: 'inherit' });

// Smoke test without a prompt: "status" only asks whether Windows Hello is set up.
const reply = JSON.parse(execFileSync(executable, [], { input: '{"op":"status"}\n', encoding: 'utf8', windowsHide: true, timeout: 30_000 }));
if (typeof reply.ok !== 'boolean') {
  console.error(`Hello-Helfer antwortet unerwartet: ${JSON.stringify(reply)}`);
  process.exit(1);
}
console.log(`Hello-Helfer gebaut: ${executable} (Windows Hello ${reply.available === true ? 'verfügbar' : 'nicht verfügbar'})`);
```

**`electron-builder.yml`:**
- In `files` nach `'!out/rdp-host/**'` die Zeile `  - '!out/hello/**'` einfügen.
- In `extraResources` nach dem Eintrag `out/rdp-host` diesen Eintrag ergänzen:
  ```yaml
  - from: out/hello
    to: hello
  ```
- Den Kommentar über `extraResources` ändern in: `# Read at runtime via process.resourcesPath (see src/main/brand.ts, src/main/rdp/ipc.ts and src/main/vault/ipc.ts).`

**`.github/workflows/ci.yml`:** nach `- run: npm ci` die Zeile `      - run: npm run build:hello` einfügen.

### 3.3 `package.json` (Task E, wegen `version.test.ts` zusammen mit dem CHANGELOG)
- `"version": "0.26.0"`, ebenso die Root-Version in `package-lock.json` (beide Stellen oben).
- Scripts:
  ```json
  "dev": "npm run build:rdp-host && npm run build:hello && electron-vite dev",
  "build": "npm run check:version && npm run typecheck && electron-vite build && npm run build:rdp-host && npm run build:hello",
  "build:hello": "node scripts/build-hello.mjs",
  ```
  `build:hello` steht direkt nach `build:rdp-host`.

### 3.4 `src/main/vault/crypto.ts` (Task C)
Nach `unlockVault` einfügen:
```ts
/**
 * Opens a vault with a stored vault key (Windows Hello). Takes ownership of key:
 * kept in the result on success, zeroed on failure. Only the main process may use it.
 */
export function unlockVaultWithKey(
  file: EncryptedVaultFile,
  key: Buffer,
): UnlockedVault {
  try {
    const { vault, migratedFrom } = decryptVaultWithKey(file, key);
    return { vault, key, kdf: { ...file.kdf }, ...(migratedFrom ? { migratedFrom } : {}) };
  } catch (error) {
    key.fill(0);
    throw error;
  }
}
```

### 3.5 `src/main/vault/session.ts` (Task C)
- Import ändern auf `import { encryptVaultWithKey, unlockVault, unlockVaultWithKey } from './crypto';` und `import type { UnlockedVault } from './crypto';` ergänzen.
- `unlock` (`:54-85`) ersetzen durch die folgenden vier Methoden. Der deutsche Kommentarblock bleibt wörtlich in `open` stehen.
```ts
  public async unlock(
    filePath: string,
    password: string,
  ): Promise<VaultSessionSnapshot> {
    const encryptedVault =
      await readEncryptedVaultFile(filePath);

    return this.open(filePath, await unlockVault(encryptedVault, password));
  }

  /** Windows Hello: the file was read before the prompt; takes ownership of key (kept on success, zeroed on failure). */
  public openWithKey(filePath: string, file: EncryptedVaultFile, key: Buffer): VaultSessionSnapshot {
    return this.open(filePath, unlockVaultWithKey(file, key));
  }

  /** Copy of the session key with its file and KDF salt, for Windows Hello enrollment; the caller zeroes key. */
  public keyCopy(): { filePath: string; salt: string; key: Buffer } {
    const session = this.requireSession();
    return { filePath: session.filePath, salt: session.kdf.salt, key: Buffer.from(session.key) };
  }

  private open(filePath: string, unlocked: UnlockedVault): VaultSessionSnapshot {
    /*
     * Die bestehende Session wird erst gelöscht,
     * nachdem der neue Vault erfolgreich geöffnet wurde.
     * Bei einem falschen Passwort bleibt die alte Session erhalten.
     */
    this.lock();

    this.activeSession = {
      filePath,
      vault: structuredClone(unlocked.vault),
      key: unlocked.key,
      kdf: {
        ...unlocked.kdf,
      },
      migratedFrom: unlocked.migratedFrom,
    };
    this.locked = undefined;

    return this.getSnapshot();
  }
```

### 3.6 `src/main/vault/hello-helper.ts` (neu, Task D)
```ts
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';

import { AppError } from '../../shared/errors';
import type { ErrorCode } from '../../shared/errors';

/** Talks to Windows Hello; the only place that knows the helper program or the run-app fake. */
export interface HelloSigner {
  /** Never prompts; false on any failure. */
  available(): Promise<boolean>;
  /** Prompts. create = make the Shellherd Hello key if it is missing (enrollment only). Throws core.hello* codes. */
  sign(challenge: Buffer, create: boolean): Promise<Buffer>;
}

/** The user may take a while at the prompt; after this the helper is killed and the request fails. */
export const HELLO_TIMEOUT_MS = 120_000;
const STATUS_TIMEOUT_MS = 30_000;
const MAX_REPLY = 16_384;

/** Error code for a failed helper status; unknown text is core.helloFailed. */
export function helloFailure(status: unknown): ErrorCode {
  if (status === 'canceled') return 'core.helloCanceled';
  if (status === 'notFound') return 'core.helloStale';
  if (status === 'unavailable') return 'core.helloUnavailable';
  return 'core.helloFailed';
}

/** Parses the helper's single output line; ok:false and anything unreadable throw a coded error. */
export function readHelloReply(text: string): { available?: unknown; signature?: unknown } {
  let reply: unknown;
  try { reply = JSON.parse(text.trim()); } catch { throw new AppError('core.helloFailed'); }
  if (typeof reply !== 'object' || reply === null) throw new AppError('core.helloFailed');
  const { ok, status } = reply as { ok?: unknown; status?: unknown };
  if (ok !== true) throw new AppError(helloFailure(status));
  return reply as { available?: unknown; signature?: unknown };
}

/** run-app hook: only an unpacked Shellherd reads SHELLHERD_HELLO_FAKE; a packaged build never does. */
export function fakeHelloMode(packaged: boolean, env: NodeJS.ProcessEnv): string | undefined {
  return packaged ? undefined : env.SHELLHERD_HELLO_FAKE;
}

/** Deterministic stand-in for the helper: 'ok' signs, 'reset' stands for a re-created Hello key, 'cancel' and 'unavailable' fail. */
function fakeSign(mode: string, challenge: Buffer): Buffer {
  if (mode === 'cancel') throw new AppError('core.helloCanceled');
  if (mode === 'unavailable') throw new AppError('core.helloUnavailable');
  return createHmac('sha256', mode === 'reset' ? 'shellherd-hello-fake-reset' : 'shellherd-hello-fake').update(challenge).digest();
}

/** Runs the helper once: one request line in, one line out; killed after the timeout (empty output → core.helloFailed). */
function runHelper(executable: string, request: object, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true, shell: false });
    let output = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { if (output.length < MAX_REPLY) output += chunk; });
    // A missing or blocked helper (ENOENT, EACCES) means Windows Hello cannot be used here.
    child.on('error', () => { clearTimeout(timer); reject(new AppError('core.helloUnavailable')); });
    child.on('close', () => { clearTimeout(timer); resolve(output); });
    child.stdin.on('error', () => { /* close reports the failure */ });
    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}

/** One prompt at a time; the fake is read on every call so a run-app scene can switch it. */
export function createHelloSigner(executable: string, packaged: boolean, env: NodeJS.ProcessEnv = process.env): HelloSigner {
  let busy = false;
  return {
    async available() {
      const mode = fakeHelloMode(packaged, env);
      if (mode !== undefined) return mode !== 'unavailable';
      try { return readHelloReply(await runHelper(executable, { op: 'status' }, STATUS_TIMEOUT_MS)).available === true; } catch { return false; }
    },
    async sign(challenge, create) {
      if (busy) throw new AppError('core.helloBusy');
      busy = true;
      try {
        const mode = fakeHelloMode(packaged, env);
        if (mode !== undefined) return fakeSign(mode, challenge);
        const { signature } = readHelloReply(await runHelper(executable, { op: 'sign', challenge: challenge.toString('base64'), create }, HELLO_TIMEOUT_MS));
        if (typeof signature !== 'string' || signature.length === 0 || signature.length > 4096) throw new AppError('core.helloFailed');
        return Buffer.from(signature, 'base64');
      } finally {
        busy = false;
      }
    },
  };
}
```

### 3.7 `src/main/vault/hello.ts` (neu, Task D)
```ts
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { z } from 'zod';

import { AppError } from '../../shared/errors';
import type { HelloStatus } from '../../shared/ipc';
import { MAX_RECENT_VAULTS } from '../app-settings';
import { grantKey, recentId } from './recent-vaults';
import type { HelloSigner } from './hello-helper';

const base64Of = (bytes: number) => z.string().max(64)
  .refine(text => /^[A-Za-z0-9+/]+={0,2}$/.test(text) && Buffer.from(text, 'base64').length === bytes);
const EntrySchema = z.object({
  filePath: z.string().min(1).max(4096),
  /** kdf.salt of the vault file the key belongs to; a replaced file has another one. */
  salt: z.string().min(1).max(64),
  challenge: base64Of(32),
  nonce: base64Of(12),
  tag: base64Of(16),
  wrapped: base64Of(32),
}).strict();
const StoreSchema = z.object({ version: z.literal(1), vaults: z.array(EntrySchema).max(MAX_RECENT_VAULTS) });
export type HelloEntry = z.infer<typeof EntrySchema>;

/** AES-256-GCM key derived from the Hello signature; the signature is zeroed. */
function wrappingKey(signature: Buffer, challenge: Buffer): Buffer {
  try {
    return Buffer.from(hkdfSync('sha256', signature, challenge, 'shellherd-hello-v1', 32));
  } finally {
    signature.fill(0);
  }
}

const aad = (salt: string): Buffer => Buffer.from(`shellherd-hello:v1:${salt}`, 'utf8');

/** Wraps a vault key for the file with this KDF salt. Exported for tests. */
export function sealVaultKey(filePath: string, salt: string, vaultKey: Buffer, challenge: Buffer, signature: Buffer): HelloEntry {
  const key = wrappingKey(signature, challenge);
  try {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(aad(salt));
    const wrapped = Buffer.concat([cipher.update(vaultKey), cipher.final()]);
    return {
      filePath, salt,
      challenge: challenge.toString('base64'),
      nonce: nonce.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      wrapped: wrapped.toString('base64'),
    };
  } finally {
    key.fill(0);
  }
}

/** Unwraps the vault key; another signature or salt gives core.helloStale. Exported for tests. */
export function openVaultKey(entry: HelloEntry, signature: Buffer): Buffer {
  const key = wrappingKey(signature, Buffer.from(entry.challenge, 'base64'));
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(entry.nonce, 'base64'));
    decipher.setAAD(aad(entry.salt));
    decipher.setAuthTag(Buffer.from(entry.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(entry.wrapped, 'base64')), decipher.final()]);
  } catch {
    throw new AppError('core.helloStale');
  } finally {
    key.fill(0);
  }
}

/** Wrapped vault keys for Windows Hello, per vault path, in hello-unlock.json next to settings.json. Never holds a password. */
export class HelloVaults {
  constructor(private readonly file: string, private readonly signer: HelloSigner) {}

  async status(filePath: string): Promise<HelloStatus> {
    return { available: await this.signer.available(), enrolled: this.find(filePath) !== undefined };
  }

  /** Prompts, then stores the wrapped key, newest first, at most 8 vaults. The caller zeroes vaultKey. */
  async enable(filePath: string, salt: string, vaultKey: Buffer): Promise<HelloStatus> {
    const challenge = randomBytes(32);
    const entry = sealVaultKey(filePath, salt, vaultKey, challenge, await this.signer.sign(challenge, true));
    const key = grantKey(filePath);
    this.write([entry, ...this.entries().filter(item => grantKey(item.filePath) !== key)].slice(0, MAX_RECENT_VAULTS));
    return { available: true, enrolled: true };
  }

  /** Removes the entry of filePath; throws core.settingsWriteFailed if the file cannot be written. */
  forget(filePath: string): void {
    const key = grantKey(filePath);
    const entries = this.entries();
    const kept = entries.filter(item => grantKey(item.filePath) !== key);
    if (kept.length !== entries.length) this.write(kept);
  }

  /** Best effort: an entry that cannot be removed is caught again by the salt check or the next unwrap. */
  forgetQuietly(filePath: string): void {
    try { this.forget(filePath); } catch { /* see above */ }
  }

  /** Same removal for an entry of the recent list (recentId); never throws. */
  forgetRecent(id: unknown): void {
    const entry = this.entries().find(item => recentId(item.filePath) === id);
    if (entry) this.forgetQuietly(entry.filePath);
  }

  /** Prompts and returns the vault key of filePath; the caller owns it. Stale entries are removed. */
  async unwrap(filePath: string, salt: string): Promise<Buffer> {
    const entry = this.find(filePath);
    if (!entry) throw new AppError('core.helloStale');
    // A replaced or new vault file: no prompt for a key that cannot fit.
    if (entry.salt !== salt) { this.forgetQuietly(filePath); throw new AppError('core.helloStale'); }
    let signature: Buffer;
    try {
      signature = await this.signer.sign(Buffer.from(entry.challenge, 'base64'), false);
    } catch (error) {
      // The Shellherd Hello key is gone (Windows Hello set up again): every stored entry is useless.
      if (error instanceof AppError && error.code === 'core.helloStale') {
        try { this.write([]); } catch { /* the next unlock reports the same */ }
      }
      throw error;
    }
    try {
      return openVaultKey(entry, signature);
    } catch (error) {
      this.forgetQuietly(filePath);
      throw error;
    }
  }

  private find(filePath: string): HelloEntry | undefined {
    const key = grantKey(filePath);
    return this.entries().find(entry => grantKey(entry.filePath) === key);
  }

  /** Missing, unreadable or invalid file → no entries; the next write replaces it. */
  private entries(): HelloEntry[] {
    try {
      const parsed = StoreSchema.safeParse(JSON.parse(readFileSync(this.file, 'utf8')));
      return parsed.success ? parsed.data.vaults : [];
    } catch {
      return [];
    }
  }

  private write(vaults: HelloEntry[]): void {
    const tmp = `${this.file}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify({ version: 1, vaults }, null, 2), { mode: 0o600 });
      renameSync(tmp, this.file);
    } catch {
      throw new AppError('core.settingsWriteFailed');
    }
  }
}
```

### 3.8 `src/main/vault/ipc.ts` (Task F)
Imports ergänzen:
```ts
import { readEncryptedVaultFile, saveVault } from './storage';   // replaces the saveVault-only import
import { HelloVaults } from './hello';
import { createHelloSigner } from './hello-helper';
import type { LockedVault, VaultSessionSnapshot } from './session';
```
Den Typ `HelloUnlockRequest` in den bestehenden `import type { … } from '../../shared/ipc'` aufnehmen.

Direkt nach `const recent = …` (`:65`):
```ts
  // Packaged builds ship the helper as an extra resource, like the RDP helper.
  const hello = new HelloVaults(join(app.getPath('userData'), 'hello-unlock.json'), createHelloSigner(
    app.isPackaged ? join(process.resourcesPath, 'hello', 'Shellherd.Hello.exe') : join(__dirname, '../hello/Shellherd.Hello.exe'),
    app.isPackaged));
  // Renderer paths are untrusted: a UNC path alone would send the Windows login hash to its server.
  const requireAllowedPath = async (filePath: string, previous: LockedVault | undefined): Promise<void> => {
    if (!await vaultPathAllowed(filePath, vaultPathGrants, previous?.filePath, path => recent.has(path))) {
      throw new AppError('core.vaultPathNotAllowed');
    }
  };
  // Shared end of every unlock (password or Windows Hello).
  const finishUnlock = async (previous: LockedVault | undefined, snapshot: VaultSessionSnapshot): Promise<UnlockVaultResult> => {
    await recent.touch(snapshot.filePath);
    if (!resumesLocked(previous, snapshot)) onSessionChange();
    onUnlock();
    onVaultChange();
    return { filePath: snapshot.filePath, vault: snapshot.vault };
  };
```
`removeRecentVault` (`:68`) ersetzen:
```ts
  handle(IPC_CHANNELS.removeRecentVault, async (_event, id: unknown) => {
    const list = await recent.remove(id);
    hello.forgetRecent(id);
    return list;
  });
```
In `saveVault` nach `await recent.touch(filePath);` einfügen:
```ts
      // A new vault file has a new salt: a stored Hello key for this path can never fit.
      hello.forgetQuietly(filePath);
```
In `unlockVault` ab `const previous = …` (`:192`) bis zum `return` ersetzen:
```ts
      const previous = vaultSessionManager.lockedVault();
      await requireAllowedPath(request.filePath, previous);
      return finishUnlock(previous, await vaultSessionManager.unlock(request.filePath, request.password));
```
Neue Handler vor `saveCurrentVault`:
```ts
  handle(IPC_CHANNELS.helloStatus, (_event, filePath: unknown) => {
    if (typeof filePath !== 'string' || filePath.length === 0 || filePath.length > 4096) throw new AppError('core.invalidRequest');
    return hello.status(filePath);
  });
  handle(IPC_CHANNELS.helloEnable, async () => {
    const { filePath, salt, key } = vaultSessionManager.keyCopy();
    try {
      return await hello.enable(filePath, salt, key);
    } finally {
      key.fill(0);
    }
  });
  handle(IPC_CHANNELS.helloDisable, () => {
    const { filePath } = vaultSessionManager.getSnapshot();
    hello.forget(filePath);
    return hello.status(filePath);
  });
  handle(IPC_CHANNELS.helloUnlock, async (_event, request: HelloUnlockRequest | undefined): Promise<UnlockVaultResult> => {
    const filePath = request?.filePath;
    if (typeof filePath !== 'string' || filePath.length === 0 || filePath.length > 4096) throw new AppError('core.vaultFileMissing');
    const previous = vaultSessionManager.lockedVault();
    await requireAllowedPath(filePath, previous);
    const file = await readEncryptedVaultFile(filePath);
    const key = await hello.unwrap(filePath, file.kdf.salt);
    let snapshot: VaultSessionSnapshot;
    try {
      snapshot = vaultSessionManager.openWithKey(filePath, file, key);
    } catch (error) {
      // Same salt, but the key does not open the file: the stored key is useless.
      if (error instanceof AppError && error.code === 'core.wrongPassword') {
        hello.forgetQuietly(filePath);
        throw new AppError('core.helloStale');
      }
      throw error;
    }
    return finishUnlock(previous, snapshot);
  });
```

### 3.9 Fehlertexte (Task D), `src/shared/locales/{de-DE,en-US}/errors/core.json`, Block `core`, nach `vaultPathNotAllowed`

| Key | de-DE | en-US |
|---|---|---|
| `helloCanceled` | Windows Hello wurde abgebrochen. | Windows Hello was canceled. |
| `helloUnavailable` | Windows Hello ist auf diesem Gerät nicht eingerichtet. | Windows Hello is not set up on this device. |
| `helloStale` | Windows Hello passt nicht mehr zu diesem Vault, etwa weil die Datei ersetzt oder Windows Hello neu eingerichtet wurde. Entsperre mit dem Passwort und schalte Windows Hello in den Einstellungen wieder ein. | Windows Hello no longer matches this vault, for example because the file was replaced or Windows Hello was set up again. Unlock with the password and turn Windows Hello on again in the settings. |
| `helloFailed` | Windows Hello hat nicht geantwortet. | Windows Hello did not respond. |
| `helloBusy` | Windows Hello wartet schon auf deine Bestätigung. | Windows Hello is already waiting for your confirmation. |

### 3.10 Renderer-Basis (Task G1)

**`src/renderer/src/hello.ts` (neu):**
```ts
import { useEffect, useState } from 'react';
import { codedFrom } from '../../shared/errors';
import type { HelloStatus } from '../../shared/ipc';

/** A canceled Windows Hello prompt: the password form simply stays, without a message. */
export const isHelloCancel = (error: unknown): boolean => codedFrom(error, 'core.unknown').code === 'core.helloCanceled';

/** Both conditions for offering the Hello button. */
export const helloReady = (status: HelloStatus | null): boolean => status !== null && status.available && status.enrolled;

/** Windows Hello state of one vault path; null while loading, without a path or after a failed query. refresh() asks again and keeps the old value meanwhile. */
export function useHelloStatus(filePath: string | null | undefined): [HelloStatus | null, () => void] {
  const [state, setState] = useState<{ filePath: string; status: HelloStatus } | null>(null);
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    if (!filePath) return;
    let current = true;
    void window.desktopApi.helloStatus(filePath).then(
      status => { if (current) setState({ filePath, status }); },
      () => { if (current) setState(null); });
    return () => { current = false; };
  }, [filePath, epoch]);
  return [filePath && state?.filePath === filePath ? state.status : null, () => setEpoch(value => value + 1)];
}
```

**`src/renderer/src/components/HelloSetting.tsx` (neu):**
```tsx
import { useId, useState } from 'react';
import { errorText } from '../error-text';
import { isHelloCancel, useHelloStatus } from '../hello';
import { useT } from '../i18n';

/** Vault section: unlock this vault with Windows Hello on this device. Stored outside the vault, in hello-unlock.json. */
export function HelloSetting({ filePath, busy }: { filePath: string; busy: boolean }) {
  const { t } = useT();
  const id = useId();
  const [status, refresh] = useHelloStatus(filePath);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const change = (enable: boolean): void => {
    setPending(true); setMessage(null);
    void (enable ? window.desktopApi.helloEnable() : window.desktopApi.helloDisable())
      .then(() => setMessage(enable ? t('app:hello.enabledMessage') : t('app:hello.disabledMessage')))
      .catch(cause => { if (!isHelloCancel(cause)) setMessage(errorText(cause)); })
      .finally(() => { setPending(false); refresh(); });
  };
  if (status === null) return null;
  if (!status.available && !status.enrolled) return <p className="settings-hint">{t('app:hello.unavailable')}</p>;
  return (<>
    <label className="settings-check">
      <input type="checkbox" checked={status.enrolled} disabled={busy || pending} aria-describedby={`${id}-hint`}
        onChange={event => change(event.target.checked)} />
      {t('app:hello.setting')}</label>
    <p className="settings-hint" id={`${id}-hint`}>{t('app:hello.hint')}</p>
    {message && <p className="settings-hint" role="status">{message}</p>}
  </>);
}
```

**`SettingsDialog.tsx`:**
- `import { HelloSetting } from './HelloSetting';`
- In `SettingsDialogProps` nach `vault`: `/** File of the unlocked vault (null without one); Windows Hello applies to it. */ vaultPath: string | null;`
- Die Prop destrukturieren.
- Im Abschnitt `vault` nach `<p className="settings-hint" id={`${id}-autolock-hint`}>…</p>` einfügen:
  ```tsx
  {vaultPath && <HelloSetting filePath={vaultPath} busy={busy} />}
  ```

**`app.json`**, neuer Block `hello` auf oberster Ebene:

| Key | de-DE | en-US |
|---|---|---|
| `hello.unlock` | Mit Windows Hello entsperren | Unlock with Windows Hello |
| `hello.open` | Mit Windows Hello öffnen | Open with Windows Hello |
| `hello.waiting` | Warte auf Windows Hello … | Waiting for Windows Hello… |
| `hello.setting` | Mit Windows Hello entsperren (PIN, Gesicht oder Fingerabdruck) | Unlock with Windows Hello (PIN, face or fingerprint) |
| `hello.hint` | Gilt nur für diesen Vault, auf diesem Gerät und in diesem Windows-Konto. Das Passwort funktioniert weiter. | Applies only to this vault, on this device and in this Windows account. The password keeps working. |
| `hello.unavailable` | Windows Hello ist auf diesem Gerät nicht eingerichtet. Einrichten unter Windows-Einstellungen → Konten → Anmeldeoptionen. | Windows Hello is not set up on this device. Set it up under Windows Settings → Accounts → Sign-in options. |
| `hello.enabledMessage` | Windows Hello ist für diesen Vault eingeschaltet. | Windows Hello is on for this vault. |
| `hello.disabledMessage` | Windows Hello ist ausgeschaltet, der gespeicherte Schlüssel ist gelöscht. | Windows Hello is off; the stored key has been deleted. |

### 3.11 Renderer-Einbindung (Task G2)

**`LockScreen.tsx`:**
- `import { isHelloCancel } from '../hello';`
- In `LockScreenProps` nach `onUnlock`:
  ```ts
  /** Main window with Windows Hello set up for this vault; rejects like onUnlock, a canceled prompt (core.helloCanceled) stays silent. */
  onHelloUnlock?: () => Promise<void>;
  ```
- Destrukturieren und neuen Zustand anlegen:
  ```tsx
  const helloRef = useRef<HTMLButtonElement>(null);
  const [waiting, setWaiting] = useState(false);
  const helloOffered = onHelloUnlock !== undefined;
  // The Hello status arrives after the first paint: take the focus only while no password was typed.
  useEffect(() => { if (helloOffered && field.current?.value === '') helloRef.current?.focus(); }, [helloOffered]);
  ```
- In `submit` wird die Prüfung zu `if (!onUnlock || pending || waiting || password === '') return;`.
- Neue Funktion nach `submit`:
  ```tsx
  async function unlockWithHello(): Promise<void> {
    if (!onHelloUnlock || pending || waiting) return;
    setWaiting(true); setError(null);
    try { await onHelloUnlock(); }
    catch (cause) {
      if (isHelloCancel(cause)) helloRef.current?.focus();
      else { setError(errorText(cause, t('app:errors.vaultFailed'))); field.current?.focus(); }
    }
    finally { setWaiting(false); }
  }
  ```
- Im `<form>` vor dem `<label>`:
  ```tsx
  {onHelloUnlock && <button ref={helloRef} type="button" className="secondary-button" aria-disabled={pending || waiting || undefined}
    onClick={() => void unlockWithHello()}>{waiting ? t('app:hello.waiting') : t('app:hello.unlock')}</button>}
  ```
- Passwortfeld: `readOnly={pending || waiting}`. `Andere Vault-Datei`: `disabled={pending || waiting}`. Absenden: `disabled={pending || waiting || password === ''}`.

**`App.tsx`:**
1. `import { helloReady, isHelloCancel, useHelloStatus } from './hello';`
2. Direkt nach `const lockReturnFocus = …` (`:195`):
   ```tsx
   // Windows Hello: for the locked vault and for the file selected on the open screen.
   const [lockHello, refreshLockHello] = useHelloStatus(locked ? vaultPath : null);
   const [openHello, refreshOpenHello] = useHelloStatus(screen === 'open' ? selectedVaultPath : null);
   const [helloWaiting, setHelloWaiting] = useState(false);
   const helloOpenRef = useRef<HTMLButtonElement>(null);
   const openHelloReady = helloReady(openHello);
   useEffect(() => { if (openHelloReady && !passwordInputRef.current?.value) helloOpenRef.current?.focus(); }, [openHelloReady]);
   ```
3. `unlockFromLock` (`:638`) bekommt eine Funktion statt des Passworts. Nur Kopf und erste Zeilen ändern sich, der Rest bleibt:
   ```tsx
   async function unlockFromLock(unlock: (filePath: string) => Promise<UnlockVaultResult>): Promise<void> {
     const current = lockedRef.current;
     if (!current || !vaultPath) throw new AppError('core.vaultFileMissing');
     const result = await unlock(vaultPath);
   ```
4. Nach `handleOpenVault`:
   ```tsx
   async function handleHelloOpen(): Promise<void> {
     if (!selectedVaultPath || busy) return;
     setFormError(null); setBusy(true); setHelloWaiting(true);
     try {
       openFresh(await window.desktopApi.helloUnlock({ filePath: selectedVaultPath }));
     } catch (caughtError) {
       if (!isHelloCancel(caughtError)) { setFormError(errorText(caughtError, t('app:errors.vaultFailed'))); refreshOpenHello(); }
     } finally {
       setBusy(false); setHelloWaiting(false);
     }
   }
   ```
5. Sperrbildschirm (`:984`):
   ```tsx
   {locked && <LockScreen vaultName={vault.name} minutes={locked.minutes} running={runningCount}
     onUnlock={password => unlockFromLock(filePath => window.desktopApi.unlockVault({ filePath, password }))}
     onHelloUnlock={helloReady(lockHello)
       ? () => unlockFromLock(filePath => window.desktopApi.helloUnlock({ filePath })).catch((error: unknown) => { refreshLockHello(); throw error; })
       : undefined}
     onSwitch={() => switchVault()} />}
   ```
6. Formular „Vault öffnen“: zwischen dem `selectedFile`-Label und dem Passwort-Label:
   ```tsx
   {openHelloReady && (
     <button ref={helloOpenRef} className="secondary-button" type="button" aria-disabled={busy || undefined}
       onClick={() => void handleHelloOpen()}>
       {helloWaiting ? t('app:hello.waiting') : t('app:hello.open')}
     </button>
   )}
   ```
7. `SettingsDialog` (`:836`): `vaultPath={settingsVault ? vaultPath : null}` ergänzen.

---

## 4. Zerlegung (exklusive Dateien, Wellen)

Nach **jeder** Welle müssen `npm run typecheck` und `npx vitest run` vollständig grün sein. Innerhalb einer Welle darf ein Task auf den Vertrag eines Nachbar-Tasks derselben Welle verweisen; geprüft wird am Wellenende. Umsetzer schreiben nur ihre Dateien und committen nie.

| Task | Dateien (exklusiv) | Inhalt | Welle | hängt ab von |
|---|---|---|---|---|
| **A** Vertrag | `src/shared/ipc.ts`, `src/preload/index.ts` | 3.1 | 1 | – |
| **B** Helfer und Paketierung | `native/Shellherd.Hello/Program.cs` (neu), `native/Shellherd.Hello/app.manifest` (neu), `scripts/build-hello.mjs` (neu), `electron-builder.yml`, `.github/workflows/ci.yml` | 3.2; danach `node scripts/build-hello.mjs` ausführen, Ausgabe ins Ledger | 1 | – |
| **C** Krypto und Session | `src/main/vault/crypto.ts`, `src/main/vault/crypto.test.ts`, `src/main/vault/session.ts`, `src/main/vault/session.test.ts` | 3.4, 3.5, Tests 10.1 | 1 | – |
| **D** Hello in Main | `src/main/vault/hello.ts` (neu) + `.test.ts` (neu), `src/main/vault/hello-helper.ts` (neu) + `.test.ts` (neu), `src/shared/locales/{de-DE,en-US}/errors/core.json` | 3.6, 3.7, 3.9, Tests 10.2, 10.3 | 1 | A (`HelloStatus`) |
| **E** Doku und Version | `docs/handbuch.md`, `docs/manual.md`, `CHANGELOG.md`, `CHANGELOG.en.md`, `package.json`, `package-lock.json` | 3.3, Abschnitt 5 | 1 | – |
| **F** IPC | `src/main/vault/ipc.ts`, `src/main/vault/ipc.test.ts` | 3.8, Tests 10.4 | 2 | A, C, D |
| **G1** Renderer-Basis | `src/renderer/src/hello.ts` (neu) + `.test.ts` (neu), `src/renderer/src/components/HelloSetting.tsx` (neu), `src/renderer/src/components/SettingsDialog.tsx`, `src/shared/locales/{de-DE,en-US}/app.json` | 3.10, Tests 10.5 | 2 | A |
| **G2** Einbindung | `src/renderer/src/components/LockScreen.tsx`, `src/renderer/src/App.tsx` | 3.11 | 2 | A, G1 (Hook, Keys, neue Prop) |
| **H** Demo | `.claude/skills/run-app/driver.mjs`, `.claude/skills/run-app/screens.mjs`, `.claude/skills/run-app/SKILL.md` | Abschnitt 6 | 3 | alle |

- Die Version (E) und der CHANGELOG (E) liegen in einem Task, denn `src/shared/version.test.ts` prüft beide gemeinsam.
- Die Fehlertexte kommen mit dem Task, der sie wirft (D). `app.json` legt G1 an; G1 und G2 benutzen die Keys in derselben Welle.
- G1 macht `vaultPath` zur Pflicht-Prop, G2 reicht sie durch. Der Typecheck läuft erst am Wellenende.
- Die Kette `ci.yml` (B) → `build:hello` (E) liegt in einer Welle.
- Nach Welle 3 folgen run-app nach Abschnitt 6 und die manuellen Tests aus Abschnitt 11 durch den Nutzer.

---

## 5. Doku (Task E)

**Handbuch `docs/handbuch.md`:**

1. Abschnitt „Sperren und Willkommens-Tab“: in der Liste nach dem Punkt „Bildschirmaufnahmen“ einfügen:
   > - **Windows Hello:** Ist es für den Vault eingeschaltet, steht über dem Passwortfeld `Mit Windows Hello entsperren`, auch nach der automatischen Sperre. Siehe „Windows Hello“.
2. Neuer Abschnitt `### Windows Hello` direkt vor `### Tastenkürzel`:
   > Einstellungen → Vault → `Mit Windows Hello entsperren (PIN, Gesicht oder Fingerabdruck)` schaltet für den offenen Vault das Entsperren per Windows Hello ein. Windows fragt dabei einmal nach PIN, Gesicht oder Fingerabdruck, beim allerersten Mal zweimal, weil Shellherd dann seinen Windows-Hello-Schlüssel anlegt. Danach zeigt der Sperrbildschirm `Mit Windows Hello entsperren` und `Vault öffnen` für diese Datei `Mit Windows Hello öffnen`, auch nach einem Neustart. Shellherd fragt nie von selbst, erst nach einem Klick oder `Enter` auf dem Knopf. Das Passwort funktioniert immer weiter; brichst du die Windows-Abfrage ab, bleibt einfach das Passwortfeld.
   >
   > - **Was gespeichert wird:** nicht das Passwort, sondern der daraus abgeleitete Schlüssel dieses Vaults, verschlüsselt mit einem Schlüssel, den nur eine Windows-Hello-Signatur erzeugt. Er liegt in `hello-unlock.json` im Benutzerdatenordner, für höchstens acht Vaults. Den privaten Windows-Hello-Schlüssel hält Windows, mit TPM im Sicherheitschip; Shellherd sieht ihn nie.
   > - **Gilt nur hier:** für diese Vault-Datei, auf diesem Gerät, in diesem Windows-Konto. Auf einem anderen Rechner oder mit einer Kopie des Benutzerdatenordners geht es nicht.
   > - **Wann es endet:** Ausschalten in den Einstellungen und `×` unter `Zuletzt benutzt` löschen den gespeicherten Schlüssel. Wird die Vault-Datei ersetzt oder neu angelegt oder richtest du Windows Hello neu ein (etwa nach dem Zurücksetzen der PIN), meldet Shellherd „Windows Hello passt nicht mehr zu diesem Vault …“ und löscht den Eintrag. Du entsperrst dann mit dem Passwort und kannst Windows Hello wieder einschalten. Der leere Windows-Hello-Schlüssel von Shellherd bleibt in Windows, bis du die PIN zurücksetzt; ohne Eintrag öffnet er nichts.
   > - **Wogegen es schützt:** gegen Menschen an deinem Gerät, die das Vault-Passwort nicht kennen, und gegen das Auslesen des gespeicherten Schlüssels ohne deine Bestätigung, mit TPM auch von einer Kopie der Festplatte.
   > - **Wogegen nicht:** Schadsoftware unter deinem Windows-Konto kann eine Windows-Hello-Abfrage auslösen; bestätige nur Abfragen, die du selbst angestoßen hast. Gegen Schadsoftware, die den Arbeitsspeicher eines entsperrten Shellherd liest oder dein Passwort mitschneidet, hilft Windows Hello nicht. Ohne TPM (etwa in manchen virtuellen Maschinen) schützt Windows den Schlüssel nur per Software.
   > - **Grenzen:** Nebenfenster entsperren weiter nur über das Hauptfenster. In einer Remotedesktop-Sitzung steht Windows Hello meist nicht zur Verfügung. Die Windows-Abfrage ist ein Fenster von Windows und gehört nicht zum Fensterschutz der Sperre; sie zeigt nichts aus dem Vault.
3. Abschnitt „Einstellungen → Vault“: nach dem Absatz mit der Liste zu `Automatisch sperren …` einen Absatz anhängen:
   > `Mit Windows Hello entsperren (PIN, Gesicht oder Fingerabdruck)` gilt nur für diesen Vault auf diesem Gerät und wird nicht im Vault gespeichert. Ist Windows Hello nicht eingerichtet, steht hier stattdessen ein Hinweis. Siehe „Windows Hello“.

**Manual `docs/manual.md`:** dieselben drei Stellen auf Englisch, mit den englischen UI-Texten aus 3.10 und 3.9.
- Stellen: „Locking and the welcome tab“, neuer Abschnitt `### Windows Hello` vor `### Keyboard shortcuts`, „Settings → Vault“.
- UI-Texte: `Unlock with Windows Hello`, `Open with Windows Hello`, `Unlock with Windows Hello (PIN, face or fingerprint)`, “Windows Hello no longer matches this vault …”, `Recently used`.

**CHANGELOG.md**, ganz oben, Abschnitt `## [0.26.0] – 2026-10-25`:
- Neu: Windows Hello. Einstellungen → Vault → `Mit Windows Hello entsperren (PIN, Gesicht oder Fingerabdruck)` schaltet es je Vault und Gerät ein. Danach entsperrt `Mit Windows Hello entsperren` den Sperrbildschirm, auch nach der automatischen Sperre, und `Mit Windows Hello öffnen` öffnet die Datei in `Vault öffnen`, auch nach einem Neustart. Das Passwort funktioniert immer weiter.
- Sicherheit: Shellherd speichert dafür nie das Passwort, sondern den Vault-Schlüssel, verschlüsselt mit einem Schlüssel, den nur eine Windows-Hello-Signatur erzeugt (mit TPM im Sicherheitschip). Eine ersetzte Vault-Datei oder ein neu eingerichtetes Windows Hello macht ihn ungültig; `×` unter `Zuletzt benutzt` löscht ihn.

**CHANGELOG.en.md**: dieselben zwei Punkte auf Englisch, gleiches Datum `2026-10-25`. Die Parität prüft `version.test.ts`.

---

## 6. run-app-Szenen (Task H, Abnahme)

Eine echte Hello-Abfrage erscheint nie. Der Treiber setzt den Fake, und den liest nur ein ungepacktes Shellherd.

### 6.1 `driver.mjs`
In `env` nach `SHELLHERD_UPDATE_URL`:
```js
    // Windows Hello stand-in (src/main/vault/hello-helper.ts); an unpacked Shellherd only, never a packaged build.
    SHELLHERD_HELLO_FAKE: 'ok',
```

### 6.2 Neuer Block `hello` in `screens.mjs` (vier Shots, als letzter Block)
```js
  // Windows Hello with the run-app fake: unavailable hint, enable, lock screen, cancel, unlock, stale key, open screen.
  async hello() {
    if (insideHome(RUN_DIR)) console.warn(`Warnung: RUN_DIR liegt im Benutzerordner (${RUN_DIR}). hello-open.png zeigt dann den Windows-Benutzernamen; Screenshot nicht teilen.`);
    const fake = mode => call('main', `process.env.SHELLHERD_HELLO_FAKE = ${JSON.stringify(mode)}; return true`);
    if (await call('main', 'return process.env.SHELLHERD_HELLO_FAKE ?? null') === null) throw new Error('hello: SHELLHERD_HELLO_FAKE fehlt – Treiber neu starten');
    const lockOpen = `!!document.querySelector('dialog.lock-screen[open]')`;
    const helloButton = text => `[...document.querySelectorAll('button')].find(b => b.textContent.includes(${JSON.stringify(text)}))`;
    const lockButton = helloButton('Mit Windows Hello entsperren');
    const unlockWithPassword = async () => {
      await fill('.lock-screen input[type=password]', 'synthetic-vault-demo');
      await click('.lock-screen .primary-button');
      await waitFor('Entsperren mit Passwort', `!document.querySelector('dialog.lock-screen[open]')`, { timeout: 30000 });
    };
    try {
      await fake('ok');
      await evaluate(`window.desktopApi.helloDisable()`);   // clean start after an aborted run
      // 1. Without Windows Hello: hint only.
      await fake('unavailable');
      await click('.settings-button');
      await waitFor('Hinweis ohne Windows Hello', `document.querySelector('dialog.settings-dialog[open]')?.textContent.includes('Windows Hello ist auf diesem Gerät nicht eingerichtet')`);
      await key('Escape');
      await waitFor('Einstellungen geschlossen', `!document.querySelector('dialog.settings-dialog[open]')`);
      // 2. Enable in the settings.
      await fake('ok');
      await click('.settings-button');
      await click('dialog.settings-dialog label:has-text("Mit Windows Hello entsperren") input');
      await waitFor('Eingeschaltet', `document.querySelector('dialog.settings-dialog [role=status]')?.textContent.includes('Windows Hello ist für diesen Vault eingeschaltet')`);
      await pause(300);
      await shot('hello-setting');
      await key('Escape');
      await waitFor('Einstellungen geschlossen', `!document.querySelector('dialog.settings-dialog[open]')`);
      // 3. Lock screen: the button takes the focus; a cancel stays silent.
      await click('.lock-button');
      await waitFor('Hello-Knopf', `${lockOpen} && !!${lockButton} && document.activeElement === ${lockButton}`);
      await pause(300);
      await shot('hello-lock');
      await fake('cancel');
      await evaluate(`${lockButton}.click()`);
      await waitFor('Abbruch verarbeitet', `!!${lockButton} && !${lockButton}.hasAttribute('aria-disabled')`);
      if (!await evaluate(`${lockOpen} && !document.querySelector('.lock-screen .error-message') && document.activeElement === ${lockButton}`)) throw new Error('Abbruch zeigt einen Fehler, entsperrt oder verliert den Fokus');
      // 4. Unlock with Windows Hello.
      await fake('ok');
      await evaluate(`${lockButton}.click()`);
      await waitFor('Mit Windows Hello entsperrt', `!${lockOpen}`, { timeout: 30000 });
      // 5. Re-created Hello key: message, button gone, password still works.
      await fake('reset');
      await click('.lock-button');
      await waitFor('Hello-Knopf', `${lockOpen} && !!${lockButton}`);
      await evaluate(`${lockButton}.click()`);
      await waitFor('Meldung', `document.querySelector('.lock-screen .error-message')?.textContent.includes('passt nicht mehr')`);
      await waitFor('Hello-Knopf weg', `!${lockButton}`);
      await pause(300);
      await shot('hello-stale');
      await fake('ok');
      await unlockWithPassword();
      // 6. Open screen: "Andere Vault-Datei" → the file dialog returns the demo vault → "Mit Windows Hello öffnen".
      await evaluate(`window.desktopApi.helloEnable()`);
      await click('.lock-button');
      await waitFor('Sperrbildschirm', lockOpen);
      // Not .secondary-button: the Hello button carries that class too and comes first.
      await click('.lock-screen button:has-text("Andere Vault-Datei")');
      await click('button:has-text("Trennen und wechseln")');
      await waitFor('Öffnen mit Hello', `!!${helloButton('Mit Windows Hello öffnen')}`);
      await pause(300);
      await shot('hello-open');
      await evaluate(`${helloButton('Mit Windows Hello öffnen')}.click()`);
      await waitFor('Vault offen', `!!document.querySelector('.lock-button')`, { timeout: 30000 });
    } finally {
      await fake('ok');
      if (await evaluate(lockOpen)) await unlockWithPassword();
      await evaluate(`window.desktopApi.helloDisable().catch(() => {})`);
    }
  },
```
**Ansehen:**
- `hello-setting.png`: Kästchen gesetzt, Meldung darunter.
- `hello-lock.png`: Knopf über dem Passwortfeld mit sichtbarem Fokusring.
- `hello-stale.png`: Fehlermeldung, kein Hello-Knopf.
- `hello-open.png`: Knopf zwischen Datei und Passwort.

Der Block `lock-secondary` belegt schon, dass Nebenfenster kein Formular haben (`screens.mjs:469`), also auch keinen Hello-Knopf.

### 6.3 `SKILL.md`
- In die Blockliste (`:2` im Kopf von `screens.mjs` und `SKILL.md:24`) kommt `hello`. Zu `hello` gehören die Bilder `hello-setting.png`, `hello-lock.png`, `hello-stale.png` und `hello-open.png`; sie stehen in beiden Listen (`:24`, `:34`).
- Neuer Punkt unter „Stolpersteine“:
  > **Windows Hello:** Der Treiber setzt `SHELLHERD_HELLO_FAKE=ok`. Nur ein ungepacktes Shellherd liest die Variable, eine echte Hello-Abfrage erscheint nie. Der Block `hello` schaltet den Fake über `/main` auf `cancel`, `unavailable` oder `reset` und am Ende zurück auf `ok`. Danach schaltet er Hello für den Demo-Vault wieder aus. Er wechselt einmal über `Andere Vault-Datei`; laufende Demo-Sitzungen enden dabei. Bricht der Treiber mitten im Block ab, bleibt Hello für den Demo-Vault an. Dann trifft `.lock-screen .secondary-button` im Block `lock` den Hello-Knopf; vor dem nächsten Lauf `window.desktopApi.helloDisable()` über `/eval` aufrufen.

---

## 7. Was ausdrücklich nicht getan wird

- Kein `safeStorage`/DPAPI und kein Ja/Nein über `UserConsentVerifier` als Schutz (R1.1).
- Kein Speichern des Passworts (R2.1).
- Keine automatische Hello-Abfrage, auch nicht bei der Auto-Sperre oder beim Start (R3.3).
- Kein Angebot nach dem Entsperren mit Passwort (R3.6).
- Kein Hello in Nebenfenstern (R4.3).
- Keine Änderung an Fensterschutz, Freigabeliste und Vault-Format. Der Vault weiß nichts von Hello.
- Kein Löschen des Windows-Hello-Schlüssels `Shellherd.VaultUnlock` (R2.4).
- Kein dauerhaft laufender Helfer, kein PowerShell, kein Windows SDK, kein NuGet (R1.3, R1.4).
- Keine Codesignatur in diesem Paket (R6.3).
- Keine Funktion „Passwort ändern“.
- Kein neues CSS, keine Bewegung, keine neuen Tokens.

## 8. Minimale erste Stufe und Extras

**Stufe 1 (dieses Paket):** 1a bis 1g.
- Main: zwei neue Module (`hello.ts`, `hello-helper.ts`), kleine Erweiterungen in `crypto.ts`, `session.ts`, `ipc.ts`.
- Helfer: 1 C#-Datei, Build-Skript, zwei Konfigzeilen.
- Renderer: ein Hook, eine Einstellung, zwei Knöpfe.

**Extras für später:**
- Angebot „Windows Hello einrichten?“ als Meldung nach dem ersten Entsperren mit Passwort.
- „Passwort ändern“ mit neuem Salt. Es entwertet alte Hello-Einträge von selbst.
- Codesignatur für App, Installer, RDP- und Hello-Helfer.
- Abfrage fest an das Shellherd-Fenster binden, sobald es eine dokumentierte HWND-Schnittstelle für `KeyCredential` gibt.
- Anzeige in `Zuletzt benutzt`, welche Vaults Hello nutzen (kleines Symbol).

## 9. Risiken

1. **Deterministische Signatur (R1.2):** Sie ist nicht belegt, ohne einen Dialog auszulösen. M3 entscheidet. Fällt M3 durch, wird nicht veröffentlicht.
2. **Abfrage hinter dem Fenster (R1.5):** Der `FindWindow`-Workaround hängt am Klassennamen `Credential Dialog Xaml Host`, und den kann Windows ändern. Dann erscheint die Abfrage eventuell nur in der Taskleiste. Das ist unbequem, aber nicht unsicher. Geprüft wird es mit M1 und M7.
3. **Untergeschobene Abfrage:** Andere Programme desselben Kontos können `OpenAsync("Shellherd.VaultUnlock")` und `RequestSignAsync` aufrufen. Der Nutzer sieht die Abfrage und muss sie bestätigen. Das steht im Handbuch; R3.3 vermeidet die Gewöhnung an Abfragen ohne eigenen Klick.
4. **Hello-Unterstützung im CI-Server:** `windows-latest` ist ein Windows Server. Der Helfer meldet dort `available: false` oder `ok: false`, beides ist grün. Bricht schon der Build wegen fehlender WinMetadata ab, zeigt CI das sofort. Dann wird die CI-Zeile entfernt, der Release-Build bleibt.
5. **Unsignierter Helfer:** SmartScreen oder Virenscanner könnten ein kleines unsigniertes Programm mit Hello-Aufrufen melden. Für den RDP-Helfer ist das bisher nicht aufgefallen.
6. **Austausch des Helfers:** Bei einer Installation pro Nutzer liegt `resources\hello` in einem Ordner, in den der Nutzer schreiben darf. Schadsoftware unter demselben Konto könnte den Helfer ersetzen und Signaturen abgreifen. Sie könnte aber genauso `app.asar` ersetzen; das Risiko ist nicht neu.
7. **Geleakter Vault-Schlüssel:** Er gilt für alle künftigen Speicherstände der Datei, weil der Salt bleibt (R2.1). Das gilt gleichermaßen für das Passwort.
8. **Remotedesktop und VMs:** Hello fehlt dort oft. `available: false` blendet den Knopf aus; ein Abbruch mitten in der Abfrage zeigt `helloFailed`.
9. **Gleichzeitige Abfragen:** Nur eine läuft zur Zeit (`core.helloBusy`). Die Statusabfragen laufen parallel und fragen nie nach.
10. **`__dirname` im Test:** `ipc.ts` nutzt es wie `rdp/ipc.ts`. Scheitert der IPC-Test daran, wird der Pfad in eine Funktion verlegt, die erst beim Aufruf auswertet. Das passiert im Task F selbst.

## 10. Testideen (Pflicht = **fett**)

### 10.1 Krypto und Session (Task C)
- **`unlockVaultWithKey`:** Der richtige Schlüssel öffnet den Vault, und die Rückgabe enthält denselben Buffer. Ein falscher 32-Byte-Schlüssel ergibt `core.wrongPassword`, ein 31-Byte-Schlüssel `core.vaultKeyLength`; danach ist der Schlüssel jeweils genullt.
- **`openWithKey`:** Danach gilt `isUnlocked()`, `lockedVault()` ist `undefined`, eine vorherige Session ist ersetzt. Bei falschem Schlüssel bleibt die alte Session erhalten.
- **`keyCopy`:** liefert `filePath`, `salt` = `kdf.salt` und eine Kopie. Das Nullen der Kopie ändert nichts an `save`, das danach mit dem Passwort weiter entschlüsselbar ist. Gesperrt kommt `core.vaultLocked`.
- `unlock` mit Passwort verhält sich unverändert, die bestehenden Tests bleiben grün.

### 10.2 Speicher und Verpackung (`hello.test.ts`, Task D)
Der Signer ist ein Test-Fake, `sign` liefert HMAC(challenge).
- **Rundlauf:** Nach `enable` liefert `unwrap(path, salt)` den Vault-Schlüssel byte-gleich.
- **Kein Klartext in der Datei:** Der Inhalt von `hello-unlock.json` enthält den Vault-Schlüssel weder als Base64 noch als Hex.
- **Anderer Salt:** `unwrap` ergibt `core.helloStale`, **ohne** `sign` aufzurufen (Spion), und der Eintrag ist weg.
- **Andere Signatur** (Fake wechselt den HMAC-Schlüssel): `core.helloStale`, Eintrag weg.
- **`sign` wirft `core.helloStale`** (Hello neu eingerichtet): Danach sind **alle** Einträge weg.
- **`sign` wirft `core.helloCanceled`:** Der Eintrag bleibt.
- `status`: `enrolled` gilt für dieselbe Datei in anderer Schreibweise (`C:\A\v.term` gegen `c:\a\v.term`) und nicht für eine fremde.
- `enable` für denselben Pfad ersetzt den Eintrag. Neun Vaults ergeben acht Einträge, der älteste fällt weg.
- `forget`, `forgetRecent(recentId(path))`, `forgetRecent(42)` (keine Wirkung, kein Wurf).
- Eine kaputte Datei (kein JSON, `version: 2`, ein Feld zu viel) gilt als leer, `enable` schreibt danach neu.
- `sealVaultKey`/`openVaultKey` direkt: Eine geänderte AAD (Salt) wird abgelehnt.

### 10.3 Helfer-Anbindung (`hello-helper.test.ts`, Task D)
- **`fakeHelloMode(true, { SHELLHERD_HELLO_FAKE: 'ok' })` ist `undefined`, `(false, …)` ergibt `'ok'`.**
- **Gepackt plus Fake-Variable plus nicht vorhandenes Programm:** `available()` ist `false`, `sign` ergibt `core.helloUnavailable`. Der Fake greift also nicht.
- **Fake `ok`:** zwei Signaturen derselben Challenge sind gleich, `reset` liefert eine andere. `cancel` ergibt `core.helloCanceled`, `unavailable` `core.helloUnavailable` und `available() === false`.
- **Exklusiv:** Zwei gleichzeitig gestartete `sign` ergeben eine Signatur und einmal `core.helloBusy`. Danach geht `sign` wieder.
- `readHelloReply`:
  - `{"ok":true,"available":true}` liefert das Objekt.
  - `{"ok":false,"status":"canceled"|"notFound"|"unavailable"|"x"}` → `helloCanceled`, `helloStale`, `helloUnavailable`, `helloFailed`.
  - `''`, `'garbage'`, `'null'`, `'[]'` → `helloFailed`.
- Der Fake liest die Umgebung bei jedem Aufruf neu: Das Umschalten des env-Objekts zwischen zwei Aufrufen wirkt.

### 10.4 IPC (`ipc.test.ts`, Task F)
Setup: `process.env.SHELLHERD_HELLO_FAKE = 'ok'`; `mocks.read` liefert eine echte Datei aus `encryptVault(exampleVault, pw, { memoryKiB: 16_384, iterations: 1, parallelism: 1 })`.
- **`helloUnlock` mit UNC-, Geräte- und unbekannten Pfaden** ergibt `core.vaultPathNotAllowed`, ohne dass `mocks.read` aufgerufen wird.
- **Ganzer Ablauf:**
  1. Drop freigeben, dann `unlockVault` mit Passwort.
  2. `helloEnable` liefert `{ available: true, enrolled: true }`.
  3. `lockVault` (ohne disconnect), dann `helloUnlock({ filePath })` liefert denselben Vault.
- **Anderer Salt:** Nach dem Einschalten liefert `mocks.read` eine neu verschlüsselte Datei (neuer Salt). `helloUnlock` ergibt `core.helloStale`, und `helloStatus` meldet danach `enrolled: false`.
- `helloDisable` meldet `enrolled: false`. `helloStatus(42)` ergibt `core.invalidRequest`. `helloEnable` ohne entsperrten Vault ergibt `core.vaultLocked`.
- `removeRecentVault(recentId(path))` entfernt auch den Hello-Eintrag.
- Die bestehenden Tests zu `unlockVault` bleiben unverändert grün; sie belegen den Umbau auf `finishUnlock`.

### 10.5 Renderer (`hello.test.ts`, Task G1)
- `isHelloCancel` ist `true` für `new AppError('core.helloCanceled')` und für `new Error("Error invoking remote method 'vault:hello-unlock': " + new AppError('core.helloCanceled').message)`. Für `core.helloStale` und für `new Error('x')` ist es `false`.
- `helloReady`: `null`, `{ available: false, enrolled: true }` und `{ available: true, enrolled: false }` ergeben `false`; nur `{ true, true }` ergibt `true`.

### 10.6 Ohne Komponententest
`LockScreen`, `HelloSetting`, die Knöpfe in `App` sowie Fokus und Abbruch deckt run-app 6.2 ab. Den echten Helfer prüfen der Rauchtest im Build und die manuellen Tests.

---

## 11. Manuelle Tests für den Nutzer (echte Hello-Hardware)

Mit dem gepackten Build (`npm run dist`, Setup oder Portable), einem Test-Vault, nicht dem Arbeits-Vault:

1. **M1 Einschalten, erstes Mal:** Einstellungen → Vault → Kästchen setzen.
   - Windows fragt zweimal (Schlüssel anlegen, dann bestätigen).
   - Die Abfrage steht **vor** Shellherd.
   - Danach steht „Windows Hello ist für diesen Vault eingeschaltet.“ unter dem Kästchen.
2. **M2 Sperren und entsperren:** Sperrknopf → Fokus liegt auf `Mit Windows Hello entsperren` → `Enter` → PIN. Der Vault ist entsperrt, offene Sitzungen laufen weiter.
3. **M3 Determinismus (entscheidet über das Release):** M2 noch zweimal wiederholen. Danach Shellherd beenden, neu starten, in `Vault öffnen` dieselbe Datei wählen und auf `Mit Windows Hello öffnen` klicken. Jedes Mal muss der Vault aufgehen. Kommt einmal „passt nicht mehr“, nicht veröffentlichen.
4. **M4 Gesicht oder Finger:** Wenn vorhanden, M2 damit statt mit PIN.
5. **M5 Abbrechen:** Im Windows-Dialog `Abbrechen` wählen, ein zweites Mal „Andere Option“/PIN-Rückfall. Shellherd zeigt keinen Fehler, der Fokus liegt auf dem Knopf. Mit Passwort entsperren geht.
6. **M6 Auto-Sperre:** `Automatisch sperren nach` auf 1 Minute stellen, warten. Auf dem Sperrbildschirm steht der Grund und der Hello-Knopf. Shellherd fragt **nicht** von selbst.
7. **M7 Fokus aus dem Hintergrund:** Shellherd sperren, ein anderes Programm in den Vordergrund holen, dann Shellherd anklicken und Hello starten. Die Abfrage erscheint vorn und nicht nur in der Taskleiste.
8. **M8 Freigabe:** Während einer Teams- oder Snipping-Tool-Aufnahme sperren und Hello starten. Shellherd ist in der Aufnahme unsichtbar; die Windows-Abfrage darf sichtbar sein.
9. **M9 Datei ersetzt:** Den Test-Vault durch eine Kopie eines anderen Vaults gleichen Namens ersetzen. `Mit Windows Hello öffnen` zeigt „passt nicht mehr …“ **ohne** Windows-Abfrage, der Knopf verschwindet. Das Passwort des neuen Vaults öffnet.
10. **M10 Ausschalten:** Kästchen entfernen. Der Knopf ist weg. `%APPDATA%\Shellherd\hello-unlock.json` hat keinen Eintrag für die Datei. Mit `×` in `Zuletzt benutzt` verschwindet ein Eintrag genauso.
11. **M11 Gepackt ignoriert den Fake:** Im Paketordner muss `resources\hello\Shellherd.Hello.exe` liegen. Shellherd aus einer Konsole mit `set SHELLHERD_HELLO_FAKE=ok` starten. Es kommt trotzdem die echte Windows-Abfrage.
12. **M12 (optional, verändert Windows):** Windows Hello unter Windows-Einstellungen → Konten → Anmeldeoptionen entfernen oder die PIN zurücksetzen.
    - Ohne Hello zeigen die Einstellungen den Hinweis „nicht eingerichtet“.
    - Mit neu eingerichtetem Hello meldet der Knopf „passt nicht mehr“, danach geht das Einschalten wieder.
13. **M13 Remotedesktop:** Per RDP auf den Rechner verbinden. Erwartet wird kein Hello-Knopf oder „Windows Hello hat nicht geantwortet.“; das Passwort geht immer.
