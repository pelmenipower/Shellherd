# Signierte Releases und Update aus der App – Validierung (bindend)

Stand: 2026-11-16 · Prüfer (Opus) · Branch `claude/feature/signed-releases`
Geprüft: Spec `docs/superpowers/specs/2026-11-16-signed-releases-design.md` und Konzept `.superpowers/sdd/signed-releases-research.md` („K“). Abgeglichen mit dem echten Code: `.github/workflows/{release,ci}.yml`, `electron-builder.yml`, `package.json`, `scripts/*` (with-release, check-win-package(+test), check-linux-package, linux-after-pack, installer.test, test-windows-installer.ps1, release-notes), `install.sh`, `install.ps1`, `src/main/{update-check,index,import-source,brand}.ts`, `src/main/platform/index.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `UpdateBadge.tsx`, `ConfirmDialog.tsx`, Locales, i18n-Katalogtest, run-app (`driver.mjs`, `screens.mjs`, `SKILL.md`), `node_modules/app-builder-lib` 26.17.0 und HerdCtrl (`install.sh`, `release.yml`, `src/core/update.rs`, Validation 2026-11-15).

**Urteil: ready after corrections.** 8 Blocker, 19 Korrekturen, 7 Empfehlungen.

**Vorrang:** Dieser Anhang geht Spec und K vor. Wo K etwas anderes sagt, gilt dieser Text. Alles, was hier nicht geändert wird, gilt aus K weiter.

Ausgangslage: `npm run typecheck` ist grün. `npx vitest run`: 241/242 Dateien grün, rot ist nur `src/main/files/sftp-loopback.test.ts` („opens a server file for editing …“, Timing, unabhängig von diesem Feature und vorher schon rot). Der Orchestrator wertet diesen Test nach jeder Welle als bekannten Altbefund. `pwsh`/`powershell` gibt es lokal nicht (`which pwsh` ist leer). PowerShell-Tests laufen nur im CI-Windows-Job. Umsetzer von T1 und T3 melden das als Bedenken, nicht als Fehler.

---

## 1. Bestätigt (keine Änderung nötig)

- **`--prepackaged` überspringt `doPack` ganz** (`app-builder-lib/out/platformPackager.js:147-150`). Damit laufen in Phase 2 weder `afterPack` (Fuses, `linux-after-pack.cjs`) noch Resedit noch `signApp`, und `npmRebuild` entfällt ebenfalls (`packager.js:461`). Die Signaturen aus Phase 1 bleiben erhalten. **Einzige Ausnahme ist `elevate.exe`, siehe B1.** `scripts/linux-after-pack.cjs` wird **nicht** geändert (ein `prepackaged`-Schutz wäre toter Code). Damit fällt die Datei aus T1.
- `appOutDir` ist bei `--prepackaged` der übergebene Ordner (`platformPackager.js:93-96`). NSIS und Portable packen ihn nur, sie ändern ihn nicht (`NsisTarget.js:96`), abgesehen von B1.
- Ohne `signtoolOptions` signiert electron-builder nichts und scheitert nicht. Der lokale Build `npm run dist:win` bleibt unverändert.
- `SHA256SUMS` wird im Release-Job über die bereits signierten Windows-Dateien gebildet. Reihenfolge: signieren → Summen → cosign. Das ist korrekt.
- `secrets.*` in `if` muss über `env` laufen (K §3.3.4). Das ist korrekt; `vars.*` ist in `if` erlaubt.
- `localTestUrl` lässt nur `http://127.0.0.1` ohne Userinfo zu (`src/main/import-source.ts:84-95`).
- Release-Assetnamen: `Shellherd-<v>-x86_64.AppImage`, `Shellherd-<v>-amd64.deb`, `Shellherd-Setup-<v>.exe`, `Shellherd-Portable-<v>.exe` (wie `check-linux-package.mjs:14-15` und `electron-builder.yml`).

---

## 2. Blocker

**B1 – Phase 2 verändert den signierten Ordner und liefert eine unsignierte EXE aus.** `CopyElevateHelper.addToArchive` (`app-builder-lib/out/targets/nsis/nsisUtil.js:84-110`) packt bei jedem NSIS-Build `resources/elevate.exe` in das Installer-Archiv. Zusätzlich kopiert ein Finalize-Task die Datei nach `<appOutDir>/resources/elevate.exe`, bei `--prepackaged` also nach `dist/win-unpacked`. Folgen: Die Prüfung nach Phase 2 (`-Root`, „keine `.exe` NotSigned“) wird rot, und jede Installation legt eine unsignierte `elevate.exe` ab, also genau das, was Virenscanner melden.
Fix (T1): `electron-builder.yml` → `nsis: packElevateHelper: false`. Shellherd nutzt keinen electron-updater, und der Installer selbst erhöht die Rechte über das UAC-Plugin. Zusätzlich gilt **K10**: Hash-Manifest vor und nach Phase 2. `check-win-signatures.ps1 -InstallCheck` prüft im Installationsordner, dass **keine** `elevate.exe` existiert.

**B2 – Umgebungsvariablen erreichen das Skript bei Server-Terminals nicht.** GNOME Terminal und Ptyxis (über `xdg-terminal-exec` der Standard ab Ubuntu 25.04) starten die Shell mit der Umgebung des Terminal-Servers, nicht mit der des Aufrufers (HerdCtrl-Validation B15). Damit kommen `SHELLHERD_UPDATE_*` aus K §5.3 nicht an, und `--from-app` scheitert. Argumente (argv) reichen diese Terminals dagegen immer durch.
Fix (T2, T4): Unter Linux läuft der Vertrag **nur über argv**, ohne `bash -c` und ohne Env-Werte (Vertrag 3.3). Die Terminal-Befehlszeile ist `<terminal> <präfix> bash -- <skript> --from-app --version <v> --wait-pid <pid> [--appimage <pfad>]`. Den Pfad zum Neustart leitet das Skript selbst ab (siehe 3.4). Die Variablen `SHELLHERD_UPDATE_SCRIPT`, `SHELLHERD_UPDATE_VERSION`, `SHELLHERD_UPDATE_PID`, `SHELLHERD_UPDATE_TARGET`, `SHELLHERD_APPIMAGE` und `SHELLHERD_RELAUNCH` entfallen unter Linux. Der Text „Enter zum Schließen“ wandert aus dem Main ins Skript (siehe K8), damit es im Main kein deutsches Literal gibt.

**B3 – Das gebündelte `install.sh` liegt beim AppImage im FUSE-Mount, und der verschwindet beim Beenden.** `process.resourcesPath` zeigt bei AppImage auf `/tmp/.mount_…/resources`. Nach `app.quit()` hängt die AppImage-Laufzeit den Mount aus. Bash hält dann ein offenes Handle auf das Skript im Mount: Das Aushängen hängt oder scheitert, und Bash liest unter Umständen ins Leere.
Fix (T4): Unter Linux kopiert der Main das gebündelte Skript **vor** dem Start in einen privaten Ordner: `mkdtempSync(join(os.tmpdir(), 'shellherd-update-'))` (Modus 0700), Datei `install.sh` mit Modus 0600. Das gilt für `deb` und `appimage` gleich. Gestartet wird die Kopie. Unter Windows gibt es keine Kopie, `resources\install.ps1` wird direkt verwendet (PowerShell parst `-File` vollständig vor der Ausführung).

**B4 – Unter Windows ist das Fenster nicht verlässlich sichtbar, oder der Prozess stirbt mit der App.** libuv startet `detached: true` unter Windows mit `DETACHED_PROCESS`, eine Konsolen-App wie `powershell.exe` bekommt damit keine Konsole, und `Read-Host` scheitert. Ohne `detached` landet das Kind im libuv-Job-Objekt mit `KILL_ON_JOB_CLOSE` und stirbt beim `app.quit()`. K §5.3 (`detached: true, windowsHide: false`) erzeugt so kein sichtbares Fenster.
Fix (T4): Der Start läuft zweistufig, ausschließlich mit Konstanten:
1. Main: `spawn(<SystemRoot>\System32\WindowsPowerShell\v1.0\powershell.exe, ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', LAUNCHER_B64], { detached: true, stdio: 'ignore', windowsHide: true, cwd: os.tmpdir(), env })`.
2. `LAUNCHER_B64 = Buffer.from(WINDOWS_LAUNCHER, 'utf16le').toString('base64')`. Die Konstante lautet wörtlich:
```
$ErrorActionPreference = 'Stop'
$ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
Start-Process -FilePath $ps -WorkingDirectory $env:TEMP -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $env:SHELLHERD_UPDATE_SCRIPT + '"'), '-FromApp')
```
`Start-Process` (ShellExecute) öffnet eine neue, sichtbare Konsole. Das Enkelkind fällt aus dem Job (`SILENT_BREAKAWAY_OK`) und erbt die Umgebung. Windows-Pfade können kein `"` enthalten, und `…\install.ps1` endet nicht auf `\`, also ist das Quoting sicher. Alle veränderlichen Werte gehen als Umgebungsvariablen (Vertrag 3.5), nicht als argv.

**B5 – Der Handoff verliert Werte und blockiert sich am eigenen Lock.**
- Linux: Das Kind ruft `exec 9>…; flock -n 9` auf, während der Elternprozess die Sperre hält. Das Kind bricht also immer mit „Ein anderer Shellherd-Installer läuft bereits.“ ab.
  Fix (T2): Wie HerdCtrl (`HerdCtrl/install.sh:566`) schließt der Elternprozess direkt vor dem Kindstart `exec 9>&-`, und das Kind sperrt neu. Mit dem argv-Vertrag aus B2 reicht `"${orig_args[@]}"` alle Werte unverändert weiter.
- Windows: K entfernt die `SHELLHERD_*`-Werte nach dem Lesen aus `$env:`. Das Kind mit `-FromApp` findet dann nichts mehr.
  Fix (T3): Vor dem Handoff setzt der Elternprozess die **validierten** Werte erneut in `$env:` (plus `SHELLHERD_INSTALL_HANDOFF=1`), startet das Kind und entfernt sie danach wieder.
- Reihenfolge in beiden Skripten (bindend):
  1. Argumente prüfen.
  2. Lock.
  3. `SHA256SUMS` laden.
  4. Signatur prüfen.
  5. Handoff prüfen.
  6. Auf die PID warten.
  7. Asset laden und prüfen.
  8. Einspielen.
  9. Neustart.

  Der Handoff steht also vor dem Warten auf die PID: Das Kind wartet, der Elternprozess wartet nicht doppelt.
- Kein zweiter Handoff: `SHELLHERD_INSTALL_HANDOFF=1` schaltet den Handoff ab. Die App entfernt die Variable beim Start des Updaters (K3), und das Skript entfernt sie vor dem Neustart.

**B6 – Welle 1 wird rot, und K weist Dateien doppelt zu.**
- `src/renderer/src/update-store.test.ts:4` baut ein `UpdateStatus`-Literal. Ein neues Pflichtfeld `install` bricht `tsconfig.web.json` (der Test liegt im `include`).
  Fix: T4 besitzt diese Datei und ergänzt `install: null`.
- `scripts/check-win-package.test.mjs` (`good().resources`) wird rot, sobald `install.ps1` in `REQUIRED_RESOURCES` steht. Die Datei liegt schon bei T1, also passt T1 sie mit an.
- K §6 lässt die Tests von `check-win-signatures.ps1` wahlweise in `scripts/test-windows-installer.ps1` laufen. Die Datei gehört aber T3.
  Fix: T1 schreibt eine eigene Datei `scripts/check-win-signatures.test.ps1` und trägt sie in `.github/workflows/ci.yml` ein (T1 besitzt `ci.yml`).
- Die finale Dateizuordnung steht in Abschnitt 5. Jede Datei hat genau eine Task.

**B7 – Ein Dry-Run hätte Schreibrechte, und `workflow_dispatch` veröffentlicht von jedem Branch.** K hält Publish und Attestation in einem Job mit `contents: write` und schaltet sie nur über Schritt-`if` ab, sodass ein Fehler im Ausdruck direkt veröffentlicht. Der bestehende `workflow_dispatch` hat zudem keinen Ref-Filter. Ein Start auf einem Feature-Branch würde veröffentlichen, und dabei mit der Identität `…@refs/heads/<branch>` signieren, die jeder Installer ablehnt.
Fix (T1): Es gibt eine Job-Struktur mit Rechten je Job (Vertrag 3.8). `dry` ist `github.event_name == 'pull_request' || github.ref != 'refs/heads/main'`. Veröffentlichen und Attestieren gibt es nur im Job `publish`, und der läuft nur bei `dry == 'false'`. Kein anderer Job hat `contents: write` oder `attestations: write`.

**B8 – Der Test-Hook funktioniert so nicht und ist im Paket erreichbar.**
- Der run-app-Treiber startet das Entwicklungs-Electron mit einem synthetischen `APP_DIR` (`driver.mjs:26-45`). `<appPath>/install.sh` gibt es dort nicht.
- Im Hook ist `deb` erzwungen. Damit braucht der Plan ein Terminal, und die Szene scheitert auf Rechnern ohne eines (Windows, CI).
- K gibt den Hook auch in Paketen frei, sobald `SHELLHERD_UPDATE_URL` lokal ist.

Fix (T4): Der Hook gilt nur bei `!app.isPackaged && localTestUrl(process.env.SHELLHERD_UPDATE_URL) !== undefined && isAbsolute(process.env.SHELLHERD_UPDATE_LAUNCH_LOG ?? '')`. Im Hook gilt:
- Quellskript ist `join(__dirname, '../../install.sh')` bzw. `install.ps1` (das Repo, weil `out/main` aus dem Repo geladen wird).
- `kind` ist `deb` (Linux) bzw. `setup` (Windows).
- `findOnPath = name => '/usr/bin/' + name`, also deterministisch der erste Kandidat.
- Linux staged das Skript wie im echten Lauf (B3).
- Kein `spawn` und kein `quit`. Der Hook schreibt das Protokoll (Vertrag 3.6) mit Modus 0600 und gibt zurück.

---

## 3. Vertrag (exakt)

### 3.1 Geteilte Typen und IPC (T4)

`src/shared/ipc.ts`:
```ts
export type UpdateInstallKind = 'deb' | 'appimage' | 'setup' | 'portable';
export interface UpdateStatus { enabled: boolean; current: string; available: { version: string; url: string } | null; install: UpdateInstallKind | null }
// IPC_CHANNELS
updateInstall: 'app:update-install',
// DesktopApi
updateInstall: () => Promise<void>;
```
`src/preload/index.ts`: `updateInstall: () => ipcRenderer.invoke('app:update-install'),`

`src/main/update-check.ts`:
- `UpdateCheckerDeps` bekommt `installKind?: UpdateInstallKind | null` (optional, Standard `null`).
- `state()` wird **öffentlich** (`state(): UpdateStatus`, ohne `private`). Bisher ist sie privat (`update-check.ts:104`), K ruft sie aber von außen auf.
- `state()` liefert zusätzlich `install: this.deps.installKind ?? null`, unabhängig von `available`.

### 3.2 `src/main/update-launch.ts` (T4, rein, ohne Electron-Import)

```ts
import type { UpdateInstallKind } from '../shared/ipc';
export const UPDATE_VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
export const LINUX_TERMINALS: readonly { name: string; prefix: readonly string[] }[] = [
  { name: 'xdg-terminal-exec', prefix: [] },
  { name: 'x-terminal-emulator', prefix: ['-e'] },
  { name: 'gnome-terminal', prefix: ['--'] },
  { name: 'konsole', prefix: ['-e'] },
  { name: 'xterm', prefix: ['-e'] },
];
export const WINDOWS_LAUNCHER: string;            // wörtlich wie B4
export interface UpdateLaunchPlan {
  kind: UpdateInstallKind; version: string; script: string;
  command: string; args: string[]; env: Record<string, string>; quitAfter: boolean;
}
export function detectInstallKind(input: {
  platform: NodeJS.Platform; env: NodeJS.ProcessEnv; execPath: string; isPackaged: boolean; uninstallerExists: boolean;
}): UpdateInstallKind | null;
export function updateChildEnv(env: NodeJS.ProcessEnv): Record<string, string>;
export function shellQuote(value: string): string;   // POSIX: '…' mit '\'' für '
export function planUpdateLaunch(input: {
  kind: UpdateInstallKind; version: string; pid: number; script: string; execPath: string;
  env: NodeJS.ProcessEnv; findOnPath: (name: string) => string | null;
}): UpdateLaunchPlan;   // wirft AppError
```

**`detectInstallKind`** (K4):
- `!isPackaged` → `null`.
- Linux:
  - `appimage`, wenn `env.APPIMAGE` und `env.APPDIR` absolut sind (`posix.isAbsolute`) und `execPath === posix.join(env.APPDIR, 'shellherd')`.
  - sonst `deb`, wenn `execPath === '/opt/Shellherd/shellherd'`.
  - sonst `null`.
- Windows:
  - `portable`, wenn `env.PORTABLE_EXECUTABLE_DIR` gesetzt und `win32.isAbsolute` ist.
  - sonst `setup`, wenn `uninstallerExists`. Der Main setzt das als `existsSync(join(dirname(execPath), 'Uninstall Shellherd.exe'))`. So landet ein gestartetes `win-unpacked` nie im stillen Setup.
  - sonst `null`.
- Andere Plattformen → `null`.

**`updateChildEnv`** (K3): Das ist eine Kopie aller Einträge mit String-Wert. Entfernt werden Schlüssel, deren Großschreibung auf `/^(SHELLHERD_.*|ELECTRON_.*|NODE_OPTIONS|APPDIR|APPIMAGE|ARGV0|OWD)$/` passt (Windows-Schlüssel sind case-insensitiv). Danach fügt der Plan seine eigenen Schlüssel hinzu.

**`planUpdateLaunch`:**
- `version` muss `UPDATE_VERSION` erfüllen, sonst `AppError('core.invalidRequest')`. `pid` muss eine positive Ganzzahl sein, sonst ebenfalls `core.invalidRequest`.
- `deb`/`appimage`: Das erste `LINUX_TERMINALS`-Element mit `findOnPath(name) !== null` gilt.
  - `command` ist der gefundene absolute Pfad.
  - `args = [...prefix, 'bash', '--', script, '--from-app', '--version', version, '--wait-pid', String(pid)]`. Bei `appimage` kommen `'--appimage', env.APPIMAGE` dazu.
  - `env = updateChildEnv(env)` ohne weitere Schlüssel.
  - `quitAfter = true`.
  - Kein Terminal: `AppError('core.updateNoTerminal', { command })`. Für `deb` ist `command = 'bash ' + shellQuote(script) + ' --version ' + version`, für `appimage` ist es `'bash ' + shellQuote(script) + ' --appimage ' + shellQuote(env.APPIMAGE) + ' --version ' + version`.
- `setup`/`portable`:
  - `command = win32.join(env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')`.
  - `args = ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', <base64 utf16le von WINDOWS_LAUNCHER>]`.
  - `env = { ...updateChildEnv(env), SHELLHERD_UPDATE_SCRIPT: script, SHELLHERD_UPDATE_VERSION: version, SHELLHERD_UPDATE_PID: String(pid), SHELLHERD_UPDATE_TARGET: kind }`. Bei `setup` kommt `SHELLHERD_RELAUNCH: execPath` dazu, bei `portable` `SHELLHERD_PORTABLE_DIR: env.PORTABLE_EXECUTABLE_DIR`.
  - `quitAfter = kind === 'setup'`.

### 3.3 Aufrufvertrag `install.sh` (T2)

```
bash install.sh                                   neueste Version, DEB (wie heute)
bash install.sh --version X.Y.Z                    bestimmte Version, DEB
bash install.sh --package <datei.deb>              lokales Paket (wie heute, keine Prüfung, kein Handoff)
bash install.sh --appimage <pfad> [--version X.Y.Z]   AppImage-Datei ersetzen
bash install.sh --from-app --version X.Y.Z --wait-pid N [--appimage <pfad>]   nur aus der App
```
- `--from-app` verlangt `--version` und `--wait-pid`; `--package` ist damit verboten. `--wait-pid` ohne `--from-app` ist verboten.
- Prüfungen:
  - Version: `^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$`.
  - PID: `^[1-9][0-9]{0,9}$`.
  - `--appimage`: absolut, `-f`, **kein** Symlink (`! -L`), Ordner beschreibbar (`-w`). Sonst `fail 'Der Ordner der AppImage-Datei ist nicht beschreibbar: <ordner>'` bzw. `fail 'AppImage-Datei nicht gefunden: <pfad>'`.
- Neustartziel: Ohne `--appimage` ist es `/opt/Shellherd/shellherd`, das nach der Installation ausführbar sein muss. Mit `--appimage` ist es der Pfad. Es gibt keine Umgebungsvariable dafür.
- Umgebung: Gelesen wird nur `SHELLHERD_INSTALL_HANDOFF`, sonst keine `SHELLHERD_*`-Variable.

### 3.4 Neustart und Abschluss in `install.sh` (T2)

- Der Neustart läuft wie in K §5.5: `(cd "$HOME" && exec env -u SHELLHERD_INSTALL_HANDOFF setsid -f "$relaunch" </dev/null >/dev/null 2>&1 9>&-)`.
- In `--from-app` ohne `SHELLHERD_INSTALL_HANDOFF` hängt am EXIT-Trap (zusammen mit dem Aufräumen von `$work`) ein Abschluss. Er gilt nur, wenn `[[ -t 0 ]]`:
  - Bei Exit ≠ 0 kommt `printf '\nShellherd: Das Update ist fehlgeschlagen. Die bisherige Version bleibt installiert.\n'`.
  - Danach kommt immer `printf '\nEnter zum Schließen '; read -r _ || true`.
  - Im Test (stdin ist kein TTY) wird nie gewartet.

### 3.5 Aufrufvertrag `install.ps1` (T3)

Parameter: `-Version`, `-InstallerPath`, `-Silent` (wie heute), neu `-PortableDir <ordner>` und `-FromApp`.
- `-FromApp` darf mit keinem anderen Parameter kombiniert werden.
- `-FromApp` liest die Umgebungsvariablen und entfernt sie danach aus `$env:` (B5 regelt den Handoff):

| Variable | Pflicht | Prüfung |
|---|---|---|
| `SHELLHERD_UPDATE_VERSION` | ja | `^\d{1,4}\.\d{1,4}\.\d{1,4}$` |
| `SHELLHERD_UPDATE_PID` | ja | `^[1-9]\d{0,9}$` |
| `SHELLHERD_UPDATE_TARGET` | ja | `setup` oder `portable` |
| `SHELLHERD_RELAUNCH` | bei `setup` | absolut, `Test-Path -PathType Leaf`, Dateiname `Shellherd.exe` |
| `SHELLHERD_PORTABLE_DIR` | bei `portable` | absolut, `Test-Path -PathType Container` |
| `SHELLHERD_UPDATE_SCRIPT` | – | wird nur entfernt, nicht verwendet |
| `SHELLHERD_INSTALL_HANDOFF` | – | `'1'` schaltet den Handoff ab |

Ungültiger Wert: `throw 'Ungueltige Angaben der App. Installation abgebrochen.'`

### 3.6 Protokoll des Test-Hooks (T4 schreibt, T7 liest)

`SHELLHERD_UPDATE_LAUNCH_LOG` enthält JSON, `JSON.stringify(log, null, 2)`, Modus 0600:
```json
{ "kind": "deb", "version": "0.33.0", "script": "/tmp/shellherd-update-XXXX/install.sh",
  "command": "/usr/bin/xdg-terminal-exec", "args": ["bash", "--", "…/install.sh", "--from-app", "--version", "0.33.0", "--wait-pid", "1234"],
  "env": { }, "quitAfter": true }
```
`env` enthält **nur** die Schlüssel, die mit `SHELLHERD_` beginnen. Das schützt die Umgebung des Nutzers, sie gehört nicht in eine Datei.

### 3.7 IPC-Handler `app:update-install` (T4, `src/main/index.ts`)

Die Reihenfolge ist bindend:
1. `windowRegistry.requireMain(event)`.
2. `vaultSessionManager.getSnapshot()` (bei gesperrtem Vault kommt `core.vaultLocked`).
3. `const status = updates.state()`, `const version = status.available?.version`. Ohne Version oder ohne `UPDATE_VERSION` → `AppError('core.invalidRequest')`. Die Version kommt nie aus dem Renderer, denn der Kanal hat keine Parameter.
4. `kind` wurde einmal beim Start ermittelt (`detectInstallKind`, oder per Hook). Ist er `null`, kommt `AppError('core.updateUnsupported')`.
5. Bei `appimage`: `accessSync(dirname(process.env.APPIMAGE), W_OK)`. Schlägt das fehl, kommt `AppError('core.updateUnsupported')`, und die App bleibt offen (K5).
6. Bei `setup`/`portable` ist `script = join(process.resourcesPath, 'install.ps1')`. Bei Linux wird das Skript in einen privaten Ordner kopiert (B3); scheitert das, kommt `AppError('core.updateLaunchFailed')`.
7. `planUpdateLaunch(...)` mit `findOnPath = name => executableOnPath(name)` aus `src/main/platform/index.ts`.
8. Im Hook-Modus wird das Protokoll geschrieben, dann `return`.
9. Wurde in diesem Lauf bereits ein Update mit `quitAfter` gestartet, wird `return` ohne zweiten Start ausgeführt.
10. `spawn(plan.command, plan.args, { detached: true, stdio: 'ignore', shell: false, env: plan.env, cwd: os.homedir() (Linux) | os.tmpdir() (Windows), windowsHide: plan.kind === 'setup' || plan.kind === 'portable' })`. Danach wird auf `'spawn'` oder `'error'` gewartet. Bei `'error'` kommt `AppError('core.updateLaunchFailed')`, bei `'spawn'` folgt `unref()`.
11. Bei `quitAfter` werden das Modulflag `updateQuitting = true` und das Startflag gesetzt, dann folgt `setTimeout(() => { closeSecondaryWindows(); closeAllSessions(); app.quit(); }, 300)`. Die Antwort an den Renderer geht vorher hinaus.

`guardMainWindowClose` **und** `guardSecondaryWindowClose` prüfen `updateQuitting` als Erstes. Ist es gesetzt, schließen sie die Sitzungen des Besitzers und kehren ohne Dialog zurück (K2). `will-quit` bleibt unverändert und sperrt den Vault.

### 3.8 Workflow-Struktur `release.yml` (T1)

```yaml
on:
  push: { branches: [main] }
  workflow_dispatch:
  pull_request:
    branches: [staging, main]
    paths:
      - .github/workflows/release.yml
      - .github/signpath/**
      - .gitattributes
      - electron-builder.yml
      - package.json
      - install.sh
      - install.ps1
      - scripts/check-win-package.mjs
      - scripts/check-win-signatures.ps1
      - scripts/check-linux-package.mjs
      - scripts/release-notes.mjs
      - scripts/release-verify-notes.mjs
      - scripts/linux-after-pack.cjs
permissions: { contents: read }
concurrency:
  group: release-${{ github.event_name == 'pull_request' && format('pr-{0}', github.event.pull_request.number) || github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
```
GitHub-Pfadfilter kennen keine `{a,b}`-Klammern, deshalb steht jede Datei einzeln da (K9).

| Job | `needs` | `if` | `permissions` | Inhalt |
|---|---|---|---|---|
| `version` | – | – | `contents: read` | Ausgänge `tag`, `dry` und `exists`. Bei `dry == 'true'` ist `exists=false`, und `gh` fragt nichts ab. |
| `build-windows` | version | `exists == 'false'` | `contents: read`, `actions: read` | K §3.3 mit K10. Ausgang `signed: ${{ steps.signing.outputs.enabled }}`. Artefakt `windows-x64`. |
| `build-linux` | version | `exists == 'false'` | `contents: read` | wie heute plus `check-linux-package.mjs` (`install.sh`). Artefakt `linux-x64`. |
| `sign` | version, build-windows, build-linux | `exists == 'false'` | `contents: read`, `id-token: write` | Artefakte laden, `install.sh`/`install.ps1` kopieren, `SHA256SUMS` bilden, cosign `sign-blob` und `verify-blob` (Identität `…/release.yml@${GITHUB_REF}`), `sha256sum --check`. Dazu `release-notes.mjs` und `release-verify-notes.mjs "$TAG" "$SIGNED" >> release-notes.md`. Artefakt `release-files` (`dist/*` und `release-notes.md`, `retention-days: 7`). Bei Fork-PRs (`github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name != github.repository`) entfallen die cosign-Schritte, stattdessen kommt `::notice::Fork-PR: Sigstore übersprungen.` |
| `publish` | version, sign | `exists == 'false' && dry == 'false'` | `contents: write`, `id-token: write`, `attestations: write` | `release-files` laden, `sha256sum --check` und cosign `verify-blob` wiederholen, `actions/attest-build-provenance@v2` mit `subject-checksums: dist/SHA256SUMS`. Danach Entwurf, Upload und Veröffentlichung wie heute (Prüfungen `release.yml:104-108`). Der Upload enthält zusätzlich `dist/SHA256SUMS.sigstore.json`. |

- Der Schritt `id: signing` in `build-windows` setzt `enabled=true` nur bei `dry == 'false'`, gesetztem `env.SIGNPATH_API_TOKEN` (aus `secrets.SIGNPATH_API_TOKEN`) und gesetzten `vars.SIGNPATH_ORGANIZATION_ID` und `vars.SIGNPATH_PROJECT_SLUG`.
- Optionale Variablen sind `SIGNPATH_POLICY_SLUG` (Standard `release-signing`) und `SIGNPATH_WAIT_SECONDS` (Standard `7200`).
- Meldungen (Annotation und Step-Summary):
  - unsigniert: `Windows-Pakete werden unsigniert veröffentlicht: SignPath-Zugang nicht konfiguriert.`
  - im Dry-Run: `Dry-Run: SignPath übersprungen, Windows-Pakete unsigniert.`
- Build-Skripte (`package.json`, T1):
  - `"dist:win:dir": "node scripts/with-release.mjs npm run build && electron-builder --win --dir --x64 --publish never"`
  - `"dist:win:pack": "electron-builder --win nsis portable --x64 --prepackaged dist/win-unpacked --publish never"`
  - `dist:win` bleibt unverändert.

### 3.9 `check-win-signatures.ps1` (T1)

- Parameter: `-Root <ordner>`, `-Files <string[]>`, `-Expect Signed|Unsigned` (Pflicht), `-InstallCheck` (Schalter, nur mit `-Files`).
- Reine Funktion `Test-ShellherdSignatures -Entries <@{ Path; Status; HasTimestamp; Pinned }[]> -Expect …` gibt eine Liste von Problemtexten zurück.
- Die Regeln stehen in K §3.3.6 und §3.3.9, ergänzt um:
  - `-InstallCheck` verlangt, dass `resources\elevate.exe` im Installationsordner **fehlt** (B1).
  - `Uninstall Shellherd.exe` wird nur gemeldet, nie bewertet.
- Exit-Code 1 bei Problemen.
- PE-fremde `.node`-Dateien prüft das Skript über `signtool verify /pa`. Ist beides nicht prüfbar, gilt das als Fehler.

### 3.10 `release-verify-notes.mjs` (T5)

- Aufruf: `node scripts/release-verify-notes.mjs <tag> <signed|unsigned>`. `tag` muss `^v\d{1,4}\.\d{1,4}\.\d{1,4}$` erfüllen, der zweite Wert genau `signed` oder `unsigned`; sonst Exit 2 mit `Usage: node scripts/release-verify-notes.mjs <vX.Y.Z> <signed|unsigned>` auf stderr.
- Export `verifyNotes(tag: string, signed: boolean): string`. Ausgabe nach stdout, beginnend mit einer Leerzeile. Wortlaut (bindend, `<v>` = Tag ohne `v`):

````markdown

## Verify / Prüfen

**English.** Every file of this release is listed in `SHA256SUMS`. The release workflow signed it with Sigstore (`SHA256SUMS.sigstore.json`) and published a GitHub build attestation.

**Deutsch.** Alle Dateien dieses Releases stehen in `SHA256SUMS`. Der Release-Workflow hat sie mit Sigstore signiert (`SHA256SUMS.sigstore.json`) und eine GitHub-Build-Attestierung veröffentlicht.

```bash
cosign verify-blob --bundle SHA256SUMS.sigstore.json \
  --certificate-identity https://github.com/pelmenipower/Shellherd/.github/workflows/release.yml@refs/heads/main \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com SHA256SUMS
sha256sum --check --ignore-missing SHA256SUMS
gh attestation verify Shellherd-Setup-<v>.exe --repo pelmenipower/Shellherd
```
````
Danach kommt bei `signed`:
`Windows: signed with a certificate from the SignPath Foundation (free code signing provided by SignPath.io). The uninstaller is not signed yet.`
`Windows: signiert mit einem Zertifikat der SignPath Foundation (kostenlose Code-Signatur durch SignPath.io). Der Uninstaller ist noch nicht signiert.`

Bei `unsigned` kommt stattdessen:
`Windows: the files of this release are not code-signed. Verify them with SHA256SUMS; SmartScreen may warn on first start.`
`Windows: Die Dateien dieses Releases sind nicht signiert. Prüfe sie mit SHA256SUMS; SmartScreen kann beim ersten Start warnen.`

Beide Zeilen sind durch eine Leerzeile getrennt.

### 3.11 i18n-Keys (wörtlich, de-DE / en-US)

`errors/core.json` (T4, unter `core`):

| Key | de-DE | en-US |
|---|---|---|
| `updateNoTerminal` | Kein Terminal gefunden. Führe im Terminal aus: {{command}} | No terminal found. Run this in a terminal: {{command}} |
| `updateLaunchFailed` | Das Update konnte nicht gestartet werden. | The update could not be started. |
| `updateUnsupported` | Diese Installation kann sich nicht selbst aktualisieren. Lade die neue Version von der Release-Seite. | This installation cannot update itself. Download the new version from the releases page. |

`app.json` (T6, unter `update`, Verwendung nur als volle Literale `'app:update.…'`):

| Key | de-DE | en-US |
|---|---|---|
| `install` | Jetzt aktualisieren | Update now |
| `download` | Neue Version herunterladen | Download new version |
| `confirm.title` | Shellherd {{version}} installieren? | Install Shellherd {{version}}? |
| `confirm.titleDownload` | Shellherd {{version}} herunterladen? | Download Shellherd {{version}}? |
| `confirm.install` | Aktualisieren | Update |
| `confirm.download` | Herunterladen | Download |
| `confirm.deb` | Text K §5.4 `deb` (wörtlich) | Shellherd will close and open connections will end. A terminal window downloads the package, checks its signature and checksum and installs it through APT; it asks for your password. Shellherd then restarts. |
| `confirm.appimage` | Text K §5.4 `appimage` | Shellherd will close and open connections will end. A terminal window downloads the new AppImage file, checks its signature and checksum and replaces the current file. Shellherd then restarts. |
| `confirm.setup` | Text K §5.4 `setup` | Shellherd will close and open connections will end. A PowerShell window downloads the setup, checks its signature and checksum and installs it without questions. Shellherd then restarts. |
| `confirm.portable` | Text K §5.4 `portable` | A PowerShell window downloads the new portable EXE into the folder of the current file and checks its signature and checksum. Shellherd keeps running; start the new file afterwards. |
| `setting.hint` (geändert) | Höchstens einmal am Tag fragt Shellherd nach dem Entsperren bei GitHub nach der neuesten Version und zeigt sie in der Statusleiste. Gesendet wird nur die Anfrage selbst, nichts aus dem Vault. Das Update startest du selbst aus dem Hinweis in der Statusleiste. | At most once a day, after unlocking, Shellherd asks GitHub for the latest version and shows it in the status bar. Only the request itself is sent, nothing from the vault. You start the update yourself from the hint in the status bar. |

Die Beschreibung kommt aus einer Map mit vollen Literalen: `{ deb: 'app:update.confirm.deb', appimage: 'app:update.confirm.appimage', setup: 'app:update.confirm.setup', portable: 'app:update.confirm.portable' } as const`.

---

## 4. Korrekturen (bindend)

- **K1 – Typen:** `UpdateInstallKind` liegt in `src/shared/ipc.ts`, nicht in `update-launch.ts` (der Renderer braucht ihn). `UpdateChecker.state()` wird öffentlich, `installKind` ist eine optionale Abhängigkeit (Vertrag 3.1). `update-check.test.ts` erwartet überall `install: null` und prüft in einem neuen Fall `install: 'deb'`.
- **K2 – Schließ-Schutz:** Beide Guards prüfen `updateQuitting`. Vor `app.quit()` laufen `closeSecondaryWindows()` und `closeAllSessions()` (Vertrag 3.7, Punkt 11). Sonst fragt ein Nebenfenster mit Sitzung trotzdem und bricht das Beenden ab.
- **K3 – Umgebung des Kindprozesses:** `updateChildEnv` entfernt die Variablen aus dem AppImage-Start, `ELECTRON_*`, `NODE_OPTIONS` und alle `SHELLHERD_*`, einschließlich der Test-Hooks und `SHELLHERD_INSTALL_HANDOFF`.
- **K4 – Erkennung der Installationsart:** Die Regeln stehen in Vertrag 3.2. Wichtig ist der Nachweis des Uninstallers für `setup`, damit `win-unpacked` oder ein entpackter Build nie still in seinen eigenen Ordner installiert.
- **K5 – Schreibschutz beim AppImage:** Der Main prüft vor dem Beenden, ob der Ordner beschreibbar ist (Vertrag 3.7, Punkt 5). Sonst würde die App für ein Update beendet, das sicher scheitert.
- **K6 – Start:** Der Start wartet auf `'spawn'`/`'error'` (Muster `src/main/files/ipc.ts:70-75`). Das Arbeitsverzeichnis ist nie der Installationsordner: Unter Linux ist es `homedir`, unter Windows `tmpdir`, und `-WorkingDirectory $env:TEMP` gilt auch für das innere Fenster. Pro App-Lauf gibt es höchstens einen Start mit `quitAfter`.
- **K7 – `install.ps1`:**
  - (a) `$pid`/`$PID` ist in PowerShell eine schreibgeschützte automatische Variable. Der Name ist `$appPid`.
  - (b) `Read-Host 'Enter zum Schliessen'` steht nur im obersten `-FromApp`-Lauf (nicht bei `SHELLHERD_INSTALL_HANDOFF=1`), im Einstiegsblock über `try/catch/finally`. Ein Fehler wird mit `Write-Host -ForegroundColor Red` ausgegeben, danach folgen `Read-Host` und `exit 1`. Der Testlauf per Dot-Sourcing führt den Einstiegsblock nicht aus.
  - (c) Liegt `$installDir` nicht unter `$env:LOCALAPPDATA\`, war die Installation für alle Benutzer. Dann gibt es kein `/S`: Es kommt `Write-Host 'Shellherd ist fuer alle Benutzer installiert. Das Setup oeffnet sich und fragt nach Administratorrechten.'`, und `Start-Process` startet das Setup ohne Argumente (`-Wait -PassThru`). Sonst ist `ArgumentList` genau die eine Zeichenkette `"/S /D=$installDir"`.
  - (d) Nach `Wait-Process -Id $appPid -Timeout 60` wartet das Skript bis 15 s, bis kein Prozess mit `Path` unter `$installDir\` mehr läuft (z. B. der RDP-Helfer). Sonst: `throw 'Shellherd laeuft noch. Beende alle Shellherd-Fenster und starte das Update erneut.'`
  - (e) Der Handoff gibt es nur, wenn `$PSCommandPath` eine Datei ist. Beim Aufruf als Scriptblock aus der README ist er leer, dann entfällt der Handoff. Das Kind läuft mit `[Diagnostics.Process]::GetCurrentProcess().MainModule.FileName` (gleicher Host) und `-NoProfile -ExecutionPolicy Bypass -File <neu> <gleiche Parameter>`. Bei `$LASTEXITCODE -ne 0` kommt `throw "Der Installer von Shellherd $Version ist fehlgeschlagen (Exitcode $LASTEXITCODE)."`
  - (f) Authenticode und cosign gelten auch für das Portable-Asset.
- **K8 – `install.sh`:**
  - (a) Der Lock ist `exec 9>>"$lock"` (Anhängen, kein Kürzen über einen fremden Symlink).
  - (b) Die AppImage-Zwischendatei ist `mktemp "$dir/.Shellherd.AppImage.XXXXXX"` statt eines festen Namens.
  - (c) Der Handoff gibt es nur, wenn `${BASH_SOURCE[0]}` eine reguläre Datei ist. Bei `curl | bash` entfällt er.
  - (d) Pflichtprogramme je Modus:
    - DEB: `apt-get dpkg-deb dpkg sha256sum mktemp curl flock`, plus `sudo` ohne root.
    - AppImage: `sha256sum mktemp curl flock setsid`.
    - `--package`: wie heute plus `flock`.
  - (e) Root ist bei `--from-app` und `--appimage` verboten: `fail 'Bitte als normaler Benutzer ausführen, nicht mit sudo.'`
  - (f) Der Handoff-Elternprozess schließt `exec 9>&-` vor dem Kindstart (B5).
  - (g) Kein `read` außer dem Abschluss aus 3.4.
  - (h) Alle Kindprozesse außer `sudo` bekommen `</dev/null`.
- **K9 – Pfadfilter:** Die Dateien stehen einzeln da, ohne Klammer-Globs (Vertrag 3.8).
- **K10 – Ablauf mit SignPath:**
  - Kein `Compress-Archive`, kein ZIP im ZIP. `actions/upload-artifact@v4` lädt direkt `path: dist/win-unpacked/` hoch, bzw. für die Installer die zwei EXE-Dateien. Das GitHub-Artefakt ist selbst das ZIP, das SignPath verarbeitet. Die Referenz-XML beginnt deshalb mit `<zip-file>` und Pfaden relativ zur Artefaktwurzel.
  - Ausgabe nach `dist/signed-unpacked` bzw. `dist/signed-installers`. Liegt dort genau eine `.zip`, wird sie entpackt, sonst wird der Ordnerinhalt genommen. Danach wird `dist/win-unpacked` gelöscht und durch den signierten Inhalt ersetzt.
  - Nach `check-win-signatures.ps1 -Root` schreibt pwsh das SHA-256-Manifest aller Dateien unter `dist/win-unpacked` nach `dist/win-unpacked.manifest.json` (außerhalb des Ordners). Nach Phase 2 wird es erneut berechnet und muss identisch sein, also keine Datei neu, fehlend oder geändert. Erst danach kommt die `-Root`-Prüfung.
  - Input-Namen der Action und `actions: read` sind „zu prüfen“ (K §12). Abweichungen betreffen nur diese Schritte.
- **K11 – Zeilenenden:** `.gitattributes` bekommt `install.ps1 text eol=lf`. Der Windows-Runner checkt sonst mit CRLF aus, die gebündelte `install.ps1` weicht dann im Hash von der Release-Datei ab, die auf Ubuntu mit LF entsteht, und der Hash-Vergleich des Handoffs schlägt bei gleichem Inhalt fehl.
- **K12 – Release-Notes:** Vertrag 3.10. Der Workflow ruft das Skript nur im Job `sign` auf.
- **K13 – `ci.yml`:** Der Windows-Job bekommt die Schritte `./scripts/check-win-signatures.test.ps1` unter `shell: powershell` und `shell: pwsh`, direkt nach den bestehenden Installer-Tests.
- **K14 – i18n:** Nur die Keys aus 3.11. Keine dynamische Zusammensetzung, keine neuen Farben oder Abstände. Es gibt `ConfirmDialog` mit `destructive={false}`, `busy` während der Anfrage und `notify.error(errorText(error))` bei Fehlern. Bei `portable` schließt sich der Dialog nach Erfolg, bei den anderen Arten beendet sich die App.
- **K15 – Menü:** Der erste Eintrag kommt nach der Überschrift: `status.install === 'portable'` → `app:update.download`, sonst `app:update.install`. Bei `install === null` gibt es keinen Eintrag. Die bestehenden Einträge „Release-Notes ansehen“ und „Diese Version überspringen“ bleiben.
- **K16 – run-app:**
  - `driver.mjs` setzt `SHELLHERD_UPDATE_LAUNCH_LOG: path.join(WORK, 'update-launch.json')`.
  - `screens.mjs` liest dieselbe Datei über `RUN_DIR` (beide Werte stammen aus `SHELLHERD_RUN_DIR`; die Umsetzung stellt sicher, dass beide auf denselben Ordner zeigen).
  - Ablauf nach `update-menu.png`:
    1. Die Datei wird gelöscht.
    2. `menuItem('Jetzt aktualisieren')`, warten auf `dialog.confirm-dialog[open]`, Aufnahme `update-confirm.png`.
    3. Klick auf `.confirm-dialog .primary-button` und warten, bis die Datei existiert (bis 10 s).
    4. Prüfen:
       - `kind` ist `deb` bzw. `setup`.
       - `version` ist die angebotene Fake-Version.
       - `script` endet auf `install.sh`/`install.ps1`.
       - Linux: `args` enthält `--from-app`.
       - Windows: `env.SHELLHERD_UPDATE_SCRIPT === script` und `env.SHELLHERD_UPDATE_TARGET === 'setup'`.
    5. Die Datei wird gelöscht, das Menü wieder geöffnet, dann geht es weiter mit „Diese Version überspringen“ wie bisher.
  - `SKILL.md`: Die Liste der Bilder bekommt `update-confirm.png`, außerdem kommen der Hook (nur unverpackt, nur mit lokaler Update-URL) und die Protokolldatei dazu.
- **K17 – Re-Run:** Die Draft-Logik bleibt unverändert im Job `publish`. Ein Re-Run nach SignPath-Timeout baut alles neu. Das ist gewollt.
- **K18 – Doku (T8):** Nichts darf behaupten, dass die Windows-Dateien heute signiert sind. Der README-Satz `README.md:102` wird so formuliert, dass er vor und nach der Freigabe stimmt (K §7). „Portable builds“ in `README.md:182` wird neu geschrieben: AppImage über Hinweis oder `--appimage`, Portable-EXE über Hinweis (nur Download). Handbuch und Manual ersetzen „Shellherd installiert keine Updates …“ (`docs/handbuch.md:150`, `docs/manual.md:148`).
- **K19 – Kein Versionssprung, kein CHANGELOG** (Spec-Ruling). Der Release-Dry-Run nutzt die vorhandene CHANGELOG-Sektion der aktuellen Version.

---

## 5. Wellen und Tasks (final, bindend)

Nach jeder Welle müssen `npm run typecheck` und `npx vitest run` grün sein, bis auf den Altbefund `sftp-loopback.test.ts`.

| Welle | Task | Dateien (exklusiv) | Pflichtpunkte | Abhängig |
|---|---|---|---|---|
| 1 | **T1 Pipeline und Paket** | `.github/workflows/release.yml`, `.github/workflows/ci.yml`, `.github/signpath/win-unpacked.xml`, `.github/signpath/win-installers.xml`, `.gitattributes`, `electron-builder.yml`, `package.json`, `scripts/check-win-package.mjs`, `scripts/check-win-package.test.mjs`, `scripts/check-linux-package.mjs`, `scripts/check-win-signatures.ps1`, `scripts/check-win-signatures.test.ps1` | B1, B6, B7, Vertrag 3.8/3.9, K9, K10, K11, K13. In `electron-builder.yml`: `linux.extraResources: [{from: install.sh, to: install.sh}]`, `win.extraResources` + `{from: install.ps1, to: install.ps1}`, `nsis.packElevateHelper: false`. `check-win-package.mjs`: `install.ps1` in `REQUIRED_RESOURCES`, `install.sh` darf nicht vorkommen. `check-linux-package.mjs`: `install.sh` in beiden Wurzeln, `install.ps1` darf nicht vorkommen. | Aufrufvertrag 3.10 (T5) |
| 1 | **T2 `install.sh`** | `install.sh`, `scripts/installer.test.mjs` | K §5.5 mit B2, B5, Vertrag 3.3/3.4, K8. Tests nach K §6 (argv statt Env). Fälle für `--from-app`/`--appimage` mit `it.skipIf(process.getuid?.() === 0)`. Zusätzliche Fälle: Handoff-Kind bekommt den Lock, Handoff-Kind sieht exakt `orig_args`, `--wait-pid` ohne `--from-app` wird abgelehnt, `--appimage` auf einen Symlink wird abgelehnt. | – |
| 1 | **T3 `install.ps1`** | `install.ps1`, `scripts/test-windows-installer.ps1` | K §5.6 mit B5, Vertrag 3.5, K7. Tests nach K §6. Zusätzlich: Handoff setzt die validierten Env-Werte für das Kind, `-FromApp` mit ungültiger PID wird abgelehnt, Installation für alle Benutzer startet ohne `/S`. ASCII, PS 5.1. | – |
| 1 | **T4 Main und IPC** | `src/main/update-launch.ts`, `src/main/update-launch.test.ts`, `src/main/update-check.ts`, `src/main/update-check.test.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/index.ts`, `src/renderer/src/update-store.test.ts`, `src/shared/locales/de-DE/errors/core.json`, `src/shared/locales/en-US/errors/core.json` | B2, B3, B4, B8, Vertrag 3.1/3.2/3.6/3.7, Fehler-Keys 3.11, K1–K6. Tests: `detectInstallKind` (alle Zweige inkl. `uninstallerExists=false`), Terminal-Reihenfolge und Präfixe, appimage-Argumente, kein Terminal → `core.updateNoTerminal` mit gequotetem Befehl, `updateChildEnv` (entfernt `SHELLHERD_INSTALL_HANDOFF`, `APPDIR`, `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS`; Groß/klein), Windows-Plan (Pfad, `-EncodedCommand` dekodiert == `WINDOWS_LAUNCHER`, Env-Schlüssel je Art, `quitAfter`), ungültige Version/PID. | – |
| 1 | **T5 Release-Notes-Zusatz** | `scripts/release-verify-notes.mjs`, `scripts/release-verify-notes.test.mjs` | Vertrag 3.10 wörtlich. Tests: signed/unsigned, ungültiger Tag → Exit 2, Identity-String exakt. | – |
| 2 | **T6 Renderer** | `src/renderer/src/components/UpdateBadge.tsx`, `src/shared/locales/de-DE/app.json`, `src/shared/locales/en-US/app.json` | Vertrag 3.11 (app-Keys), K14, K15. Keine CSS-Änderung. | T4 |
| 2 | **T7 run-app** | `.claude/skills/run-app/driver.mjs`, `.claude/skills/run-app/screens.mjs`, `.claude/skills/run-app/SKILL.md` | K16, Beschriftungen aus 3.11 (de). | T4; T6 nur zur Laufzeit |
| 2 | **T8 Doku** | `README.md`, `docs/handbuch.md`, `docs/manual.md` | K §7, K18, Identity und Befehle wie 3.10, Variablen und Secret wie 3.8, Hinweis auf Dry-Run und unsignierten Uninstaller. | Wortlaut aus diesem Anhang |
| 3 | Orchestrator | – | `npm run typecheck`, `npx vitest run`, `bash -n install.sh`, run-app-Szene `update` (`update-confirm.png` ansehen), PR-Dry-Run des Release-Workflows grün (Windows als unsigniert gemeldet, cosign signiert und verifiziert, kein Release, keine Attestierung). PowerShell-Tests laufen nur im CI-Windows-Job. | W1, W2 |

In einer Welle gibt es keine Datei-Überschneidung. `scripts/linux-after-pack.cjs` ist keiner Task zugeordnet und bleibt unverändert.

---

## 6. Empfehlungen und Extras (nicht bindend)

- **E1** Die cosign-Version in `sigstore/cosign-installer@v3` pinnen (`cosign-release`), damit Bundle-Format und Verify-Verhalten nicht unbemerkt wechseln.
- **E2** Beim Warten auf die PID unter Linux einen Zombie (`/proc/$pid/stat`, Zustand `Z`) als beendet werten (HerdCtrl B7). Heute erntet das der Elternprozess der App sofort, die Gefahr ist also gering.
- **E3** Alte `shellherd-update-*`-Ordner in `tmpdir` beim nächsten Update-Start aufräumen (nur eigene, älter als 24 h).
- **E4** In README „Releasing“ erwähnen, dass Dry-Runs mit der Identität `…@refs/pull/N/merge` im öffentlichen Rekor-Log landen. Das ist harmlos, weil die Installer `refs/heads/main` pinnen.
- **E5** Die Erkennung `win-unpacked` oder per-machine zusätzlich in `UpdateStatus` sichtbar machen (z. B. Hinweis statt fehlendem Menüpunkt).
- **E6** Die Terminal-Liste um `ptyxis` (`--`) und `kgx` erweitern, falls `xdg-terminal-exec` fehlt.
- **E7** K §9 E1–E6 (Uninstaller-Signatur, Test-Signierung, Hintergrund-Download, Subject-Pinning, In-App-Terminal, Tag-Releases) bleiben Extras.
