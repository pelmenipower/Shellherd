# Import von Verbindungen und Update-Hinweis – Design

> Übernommen aus dem Konzept (Opus, `.superpowers/sdd/import-update-research.md`). Bindend geht `2026-10-24-import-update-validation.md` vor. Die Validierung holt WinSCP und mRemoteNG in Stufe 1.


Konzept-Agent, 2026-10-24. Grundlage: `CLAUDE.md`, `docs/design-system.md`, Specs `2026-10-19-settings-*`, `2026-10-24-ssh-pro-*` (Sprunghost/Weiterleitungen, bindend), `2026-10-24-terminal-komfort-*` (`webLinkHref`), Code wie unten zitiert.

## 0. Entscheidungen auf einen Blick (Rulings)

| # | Ruling |
|---|---|
| R1 | Stufe 1 importiert **OpenSSH `~/.ssh/config`** und **PuTTY-Sitzungen** (Registry). WinSCP und mRemoteNG kommen **nicht jetzt** (Stufe 2). |
| R2 | **Passwörter werden nie importiert**, aus keiner Quelle, auch nicht in Stufe 2. Die Quelle (WinSCP-Verschleierung, mRemoteNG-Standardschlüssel) ist praktisch Klartext. Ein Import würde Geheimnisse ohne Zutun des Nutzers aus einer ungeschützten Datei kopieren und den Anschein erwecken, das sei sicher. Der Nutzer tippt das Passwort einmal im Formular. Das ist auch eine Gelegenheit, alte Passwörter zu ersetzen. |
| R3 | Main liest die Quelle **nur nach Klick**. OpenSSH über den Datei-Dialog (Vorbelegung `%USERPROFILE%\.ssh\config`), PuTTY über `reg.exe export` des eigenen HKCU-Schlüssels in eine Temp-Datei. Fester absoluter Pfad, feste Argumente, nur Lesen. Ein Datei-Import einer `.reg` ist für Umsteiger zu umständlich und bringt keinen Sicherheitsgewinn: Gelesen wird derselbe Benutzer-Hive, und die Daten laufen durch denselben Parser. |
| R4 | Schlüsseldateien werden **nie gelesen**, nur ihr Pfad übernommen (`authentication: { method: 'privateKey', keyPath }`). Ohne Schlüssel gilt `{ method: 'agent' }`, wie die Vorbelegung im Formular (`connection-form.ts:75`). Pfade aus `Include` werden nicht verfolgt. |
| R5 | `.ppk` wird als Pfad übernommen und bekommt einen Hinweis. Ssh2 1.17 liest nur PPK Version 2 mit `ssh-rsa`/`ssh-dss` (`node_modules/ssh2/lib/protocol/keyParser.js:1010`). PuTTY ab 0.75 speichert standardmäßig Version 3. |
| R6 | Importierte Weiterleitungen bekommen immer `auto: false`. Die Konfiguration kann viele Listener enthalten; der Nutzer startet sie bewusst per Klick. |
| R7 | Sprunghost nur, wenn `ProxyJump` genau **ein** Alias aus **derselben Quelle** ist, das Ziel selbst keinen Sprunghost hat und es mit ausgewählt ist. Das entspricht der Ein-Hop-Regel aus `2026-10-24-ssh-pro-design.md:17-18,208`. Sonst wird er weggelassen und gemeldet. |
| R8 | Duplikat = vorhandene SSH- oder SFTP-Verbindung (oder früherer Kandidat) mit gleichem Host (ohne Groß-/Kleinschreibung), Port und Benutzer (fehlend = `''`). Duplikate werden **markiert und vorab abgewählt**, nicht verborgen. |
| R9 | Ziel ist standardmäßig ein **neuer Ordner** „OpenSSH-Import“ bzw. „PuTTY-Import“ auf oberster Ebene. Wahlweise geht es in einen vorhandenen Ordner oder auf die oberste Ebene. Ein Fehlimport lässt sich so mit einem Löschvorgang zurücknehmen. |
| R10 | Der Renderer baut die Knoten und speichert über den vorhandenen `persistVault` (`App.tsx:188`). Main schreibt den Vault beim Import nicht. Jeder Knoten läuft durch `SshConnectionNodeSchema` (`schema.ts:95`), beim Speichern zusätzlich durch die bestehende Prüfung in Main. Vault bleibt Version 2, keine neuen Felder. |
| R11 | Update-Hinweis **Opt-out (Standard an)**. Begründung: Builds sind unsigniert und ohne Auto-Update. Ohne Hinweis laufen Nutzer dauerhaft auf Versionen ohne Sicherheitskorrekturen. Die Anfrage enthält nur IP und `User-Agent: Shellherd/<version>`, keine Kennung und nichts aus dem Vault. GitHub ist ohnehin die Download-Quelle. Der Schalter steht unter Einstellungen → Allgemein und nennt genau, was gesendet wird. Changelog und README sagen es. |
| R12 | Der Abruf läuft **erst nach dem Entsperren**: Die Statusleiste fragt Main einmal pro Laden nach dem Status, Main ruft höchstens alle 24 h ab. Vor dem Entsperren gibt es keinen Netzverkehr. Endpunkt ist die GitHub-API `releases/latest`: dokumentierter Vertrag, schließt Entwürfe und Vorabversionen aus, und 60 Anfragen pro Stunde reichen bei 1 pro Tag. Gegen den Redirect spricht, dass er nicht dokumentiert ist. Zeitlimit 5 s, Fehler still, Zeitstempel nur bei Erfolg. |
| R13 | Die Release-URL baut Main selbst aus der geprüften Versionsnummer (`https://github.com/pelmenipower/Shellherd/releases/tag/v<x.y.z>`), nie aus `html_url` der Antwort. Geöffnet wird sie über den vorhandenen Kanal `openExternal` mit `webLinkHref` (`index.ts:309-315`, `links.ts:51`). |
| R14 | Netzabruf über Electron `net.fetch`. Das nutzt den System-Proxy, wichtig im Firmennetz; der KI-Pfad nutzt Node-`fetch`. |
| R15 | Testhaken, nur Main, analog zu `SHELLHERD_RDP_MODE`: `SHELLHERD_PUTTY_REG_FILE` (liest diese `.reg` statt `reg.exe`) und `SHELLHERD_UPDATE_URL` (nur angenommen, wenn er mit `http://127.0.0.1:` beginnt). Der Demo-Stack liest nie die echte Registry und ruft nie GitHub ab. |

## 1. Bestand und Lücken

| Fläche | Bestand | Lücke |
|---|---|---|
| Vault-Modell | SSH mit `host/port/username/authentication/jumpHost/forwards` (`src/shared/vault/types.ts:62-86`), Schema `schema.ts:20-35,78-109` | nichts zu ergänzen |
| Einfügen | `addNode(nodes, node, parentFolderId?)` (`mutations.ts:19`); App speichert per `persistVault` (`App.tsx:188,466-473,511-520`) | Einfügen mehrerer Knoten: Schleife über `addNode`, keine neue Mutation |
| Konsistenz | `validateVaultConsistency` prüft doppelte Ids und Workspace-Referenzen (`consistency.ts:7-54`) | neue UUIDs, also nichts zu tun |
| Einstiege | Menü „Neu“ in der Seitenleiste (`App.tsx:871-883`), Willkommensseite „Neue Verbindung“ (`WelcomePage.tsx:40-47`) | kein Import |
| Datei-Dialoge | Muster `selectPrivateKeyFile` (`main/vault/ipc.ts:67-73`), Treiber ersetzt `dialog.showOpenDialog` (`run-app/driver.mjs:38-44`) | Import-Dialog fehlt |
| PPK | ssh2 nur PPK v2 RSA/DSS (`keyParser.js:1010`); Schlüssel liest Main erst beim Verbinden (`ssh/client-config.ts:27,88-94`) | Hinweis im Import |
| Agent | `agentSocket` nutzt die OpenSSH-Pipe, nicht Pageant (`client-config.ts:21-25`) | PuTTY-Nutzer mit Pageant: Hinweis über Formular, kein Pageant (nicht jetzt) |
| Gerätespezifische Einstellungen | `settings.json` in userData: `language`, `mainWindow` (`main/app-settings.ts:9-44`) | Felder für das Update |
| Versionsvergleich | `compareVersions(a, b)` nur `x.y.z` (`src/shared/version.ts:34`) | wird wiederverwendet, keine neue Abhängigkeit |
| Link öffnen | `openExternal` + `webLinkHref` (`index.ts:309-315`, `links.ts:51-58`) | wird wiederverwendet |
| Statusleiste | Version-Knopf (`App.tsx:944-946`, CSS `styles.css:85-87`) | Update-Knopf |
| Meldungen | `notify.ok/info/error` mit höchstens einer Aktion, Info blendet sich aus (`notice-store.ts:62-66`, `Toast.tsx:54-56`) | Update-Hinweis braucht zwei Aktionen und Dauer, deshalb Statusleiste plus `ContextMenu` statt Toast |
| Demo | KI-Fake HTTP auf 9335 (`run-app/ai-fake.mjs:47-48`), Profil isoliert (`boot.mjs`) | Import-Beispieldateien, Release-Fake |

## 2. Empfehlung je Funktion

| Funktion | Wert | Aufwand | Stufe |
|---|---|---|---|
| OpenSSH-Import (Host, HostName, Port, User, IdentityFile, ProxyJump, Local/Remote/DynamicForward, Muster-Vorgaben aus `Host *`) | ★★★ | kleine Main-Änderung | 1 |
| PuTTY-Import aus der Registry (HostName, PortNumber, UserName, PublicKeyFile, PortForwardings) | ★★★ | kleine Main-Änderung | 1 |
| Vorschau mit Häkchen, Duplikat-Markierung, Zielordner, Ergebnis-Meldung | ★★★ | nur Renderer | 1 |
| Update-Hinweis in der Statusleiste mit „Release-Notes ansehen“ und „Diese Version überspringen“ | ★★★ | kleine Main-Änderung | 1 |
| Schalter „Nach neuen Versionen suchen“ | ★★★ | nur Renderer + IPC | 1 |
| `Include` verfolgen (nur unter `~/.ssh`) | ★★ | kleine Main-Änderung | nicht jetzt |
| WinSCP (`WinSCP.ini`/Registry), ohne Passwörter | ★★ | kleine Main-Änderung | nicht jetzt |
| mRemoteNG `confCons.xml` mit Ordnern, SSH und RDP, ohne Passwörter | ★ | kleine Main-Änderung | nicht jetzt |
| `.reg`-Datei manuell wählen | ★ | nur Renderer | nicht jetzt (Parser kann es schon) |
| Pageant als Agent | ★★ | kleine Main-Änderung | nicht jetzt |
| Update-Hinweis auf dem Startbildschirm vor dem Entsperren | ★ | nein, widerspricht R12 | nie |
| Auto-Update | – | – | nie (unsigniert) |

## 3. Vertrag

### 3.1 `src/shared/import.ts` (neu, wörtlich)

```ts
import { SshConnectionNodeSchema } from './vault/schema';
import type { FolderNode, PortForward, SshConnectionNode, VaultNode } from './vault/types';

export type ImportSource = 'openssh' | 'putty';

/** At most this many candidates per preview; the rest counts as skipped 'tooMany'. */
export const MAX_IMPORT_CANDIDATES = 500;
/** Largest source file main reads (ssh config or .reg export). */
export const MAX_IMPORT_BYTES = 4 * 1024 * 1024;

/** A forward without id and auto; buildImportNodes adds both. */
export type ImportForward =
  | { kind: 'local'; localPort: number; targetHost: string; targetPort: number }
  | { kind: 'remote'; remotePort: number; targetHost: string; targetPort: number }
  | { kind: 'dynamic'; localPort: number };

export type ImportNoteCode = 'ppkKey' | 'jumpUnsupported' | 'proxyDropped' | 'forwardsDropped' | 'keyUnresolved';
export type ImportSkipCode = 'match' | 'include' | 'notSsh' | 'invalid' | 'tooMany';

export interface ImportCandidate {
  /** Unique within one preview: the Host alias (OpenSSH) or the decoded session name (PuTTY). */
  key: string;
  name: string;
  host: string;
  port: number;
  username?: string;
  /** Path only; the file is never read. */
  keyPath?: string;
  /** Key of another candidate in the same preview to hop through; that candidate has no jumpKey itself. */
  jumpKey?: string;
  forwards: ImportForward[];
  /** Each code at most once, in the order found. */
  notes: ImportNoteCode[];
}

export interface ImportPreview {
  source: ImportSource;
  /** Absolute path of the read file; absent for the PuTTY registry. */
  file?: string;
  candidates: ImportCandidate[];
  /** Only codes with count > 0. */
  skipped: { code: ImportSkipCode; count: number }[];
}

export type ImportReadResult = { canceled: true } | { canceled: false; preview: ImportPreview };

/** Shared host check of both parsers: 1–253 chars, no whitespace or control characters. */
export function validImportHost(host: string): boolean {
  return host.length > 0 && host.length <= 253 && !/[\s\x00-\x1f\x7f]/.test(host);
}

/** Keys of candidates that match an existing SSH/SFTP connection or an earlier candidate (host case-insensitive, port, user). */
export function importDuplicates(candidates: ImportCandidate[], nodes: VaultNode[]): Set<string>;

/** One SSH node per selected candidate, in preview order; ids from newId. See 3.4. */
export function buildImportNodes(candidates: ImportCandidate[], selected: ReadonlySet<string>,
  newId?: () => string): { nodes: SshConnectionNode[]; invalid: number; jumpsDropped: number };

/** Folder with the given children; name is trimmed. */
export function importFolder(name: string, children: SshConnectionNode[], newId?: () => string): FolderNode;
```

Standard für `newId` ist `() => crypto.randomUUID()`. Das gibt es global in Renderer und Node 20+.

### 3.2 `src/shared/import-openssh.ts` (neu)

```ts
import type { ImportPreview } from './import';
/** Pure; `home` is the user profile without trailing separator, e.g. C:\Users\demo. */
export function parseOpenSshConfig(text: string, home: string): Omit<ImportPreview, 'source' | 'file'>;
```

Regeln (OpenSSH-Semantik, erster Wert gewinnt):
1. Den Text an `/\r?\n/` in Zeilen teilen und jede Zeile trimmen. Leere Zeilen und Zeilen, die mit `#` beginnen, entfallen. Das Schlüsselwort ist die Zeichenfolge bis zum ersten Leerzeichen oder `=`, ohne Rücksicht auf Groß-/Kleinschreibung. Die Argumente werden an Leerzeichen getrennt, Text in `"…"` bleibt ein Argument (die Anführungszeichen entfallen).
2. Zeilen vor dem ersten `Host` bilden einen Block mit Muster `*`. `Host p1 p2 …` beginnt einen Block. `Match …` beginnt einen übersprungenen Block (`match`+1), dessen Zeilen bis zum nächsten `Host`/`Match` ignoriert werden. `Include …` zählt `include`+1 und wird ignoriert.
3. Ein Muster ist konkret, wenn es weder `*`, `?` noch `!` enthält. Jeder konkrete Alias (Reihenfolge des ersten Auftretens, jeder nur einmal) wird ein Kandidat mit `key = name = Alias`.
4. Für jeden Alias gelten alle Blöcke in Dateireihenfolge, deren Muster passt: mindestens ein nicht negiertes Muster passt als Glob (`*` = beliebig viele Zeichen, `?` = ein Zeichen, ganze Zeichenkette, ohne Groß-/Kleinschreibung), und kein `!muster` passt. Für einwertige Schlüssel gewinnt der erste Wert. `LocalForward`, `RemoteForward` und `DynamicForward` sammeln sich über alle passenden Blöcke.
5. `HostName`: `%h` → Alias, `%%` → `%`. Fehlt der Wert, gilt der Alias.
6. `Port`: nur Ziffern, 1–65535, Standard 22. Bei ungültigem Port oder ungültigem Host (`validImportHost`) wird der Kandidat verworfen (`invalid`+1).
7. `User`: enthält er `%`, entfällt er. `IdentityFile`: nur der erste Wert. `%d` und ein führendes `~` werden zu `home`, `%%` zu `%`. Bleibt danach ein `%`, entfällt der Schlüssel und es gibt die Notiz `keyUnresolved`. Ein Pfad ohne Laufwerk (`^[A-Za-z]:`) und ohne `\\`-Präfix, der relativ ist, wird zu `${home}\.ssh\${pfad}`. Alle `/` werden zu `\`.
8. `ProxyJump`: Bei `none` gibt es keinen Sprunghost. Ist der Wert genau ein Token ohne `,`, `@` und `:`, das ein konkreter Alias derselben Datei ist und dessen eigenes aufgelöstes `ProxyJump` fehlt oder `none` ist, dann gilt `jumpKey` = dieser Alias. Sonst Notiz `jumpUnsupported`. `ProxyCommand` außer `none` gibt die Notiz `proxyDropped`.
9. Weiterleitungen: Der Port ist der Teil nach dem letzten `:`, Ziffern 1–65535. Ziel ist `host:port` bzw. `[v6]:port` (Klammern entfernen). Der Host muss `validImportHost` erfüllen. Eine `bind_address` wird ignoriert.
   - `LocalForward <[bind:]port> <host:port>` → local. `RemoteForward <[bind:]port> <host:port>` → remote. `DynamicForward <[bind:]port>` → dynamic.
   - Unix-Socket-Pfade (enthalten `/`), `RemoteForward` mit nur einem Argument und alles Ungültige entfallen mit der Notiz `forwardsDropped`. Ab der 17. Weiterleitung ebenso (`MAX_FORWARDS`, `schema.ts:78`).
10. Ab dem 501. Kandidaten wird verworfen (`tooMany`+1).

### 3.3 `src/shared/import-putty.ts` (neu)

```ts
import type { ImportPreview } from './import';
/** Pure; text of a `reg export` of HKCU\Software\SimonTatham\PuTTY\Sessions (already decoded). */
export function parsePuttyReg(text: string): Omit<ImportPreview, 'source' | 'file'>;
```

Regeln:
1. Eine Abschnittszeile `[HKEY_CURRENT_USER\Software\SimonTatham\PuTTY\Sessions\<roh>]` mit `<roh>` ohne `\` gilt (Vergleich ohne Groß-/Kleinschreibung). Alle anderen Abschnitte werden ignoriert.
2. Name = `<roh>` mit `%XX` → Zeichen (`String.fromCharCode(parseInt(XX, 16))`). `Default Settings` wird still übersprungen.
3. Werte: `"Name"="text"` (Escapes `\\` → `\`, `\"` → `"`) und `"Name"=dword:xxxxxxxx` (hex). Andere Typen und deren Fortsetzungszeilen (die vorige Zeile endet mit `\`) werden ignoriert.
4. `Protocol` fehlt oder ist `ssh` → weiter, sonst `notSsh`+1.
5. `HostName`: Enthält er `@`, ist der Teil vor dem letzten `@` der Benutzer und der Rest der Host. Ein ungültiger Host gibt `invalid`+1. `PortNumber` ist der dword-Wert, Standard 22; außerhalb 1–65535 gibt es `invalid`+1. `UserName` hat Vorrang vor dem Benutzer aus HostName.
6. `PublicKeyFile` nicht leer → `keyPath`. Endet er auf `.ppk` (ohne Groß-/Kleinschreibung), gibt es die Notiz `ppkKey`.
7. `ProxyMethod` als dword ungleich 0 gibt die Notiz `proxyDropped`.
8. `PortForwardings` an `,` trennen. Pro Eintrag gilt `^([LRD])[46]?(.*)$`. Bei L/R wird der Rest am ersten `=` geteilt: links `[bind:]port` (Port nach dem letzten `:`), rechts `host:port`. Bei D ist der Rest `[bind:]port`. Ungültiges oder mehr als 16 Einträge gibt `forwardsDropped`.
9. `key = name` = dekodierter Name, `jumpKey` nie gesetzt. Grenze 500 wie oben.

### 3.4 `buildImportNodes`, genau

1. `ids = Map<key, id>` für jeden ausgewählten Kandidaten, in Vorschau-Reihenfolge.
2. Erster Durchlauf ohne Sprunghost. Für jeden ausgewählten Kandidaten:
   ```ts
   { id, type: 'connection', name, tags: [], protocol: 'ssh', host, port, ...(username ? { username } : {}),
     authentication: keyPath ? { method: 'privateKey', keyPath } : { method: 'agent' },
     ...(forwards.length ? { forwards: forwards.map(f => ({ ...f, id: newId(), auto: false })) } : {}) }
   ```
   Schlägt `SshConnectionNodeSchema.safeParse` fehl, gilt `invalid`+1 und der Knoten entfällt.
3. Zweiter Durchlauf: Hat ein gültiger Knoten einen `jumpKey`, dessen Kandidat ausgewählt **und** gültig ist, gilt `jumpHost = ids.get(jumpKey)`. Hat er einen `jumpKey` ohne gültiges Ziel, gilt `jumpsDropped`+1.

### 3.5 IPC (`src/shared/ipc.ts`, `src/preload/index.ts`)

```ts
// IPC_CHANNELS
importRead: 'import:read',
updateStatus: 'app:update-status',
updateSetEnabled: 'app:update-set-enabled',
updateSkip: 'app:update-skip',

/** Version check state for the main window; see docs/superpowers/specs/…-import-update-design.md. */
export interface UpdateStatus { enabled: boolean; current: string; available: { version: string; url: string } | null }

// DesktopApi
/** Opens the source after a click: file dialog (OpenSSH) or registry export (PuTTY). Main window, unlocked vault. */
importRead: (source: ImportSource) => Promise<ImportReadResult>;
/** Runs the check when enabled and due (at most every 24 h), else returns the stored state. */
updateStatus: () => Promise<UpdateStatus>;
updateSetEnabled: (enabled: boolean) => Promise<UpdateStatus>;
updateSkip: (version: string) => Promise<UpdateStatus>;
```
Preload: `importRead: source => ipcRenderer.invoke('import:read', source)`, entsprechend die drei Update-Kanäle.

### 3.6 Main Import (`src/main/import-source.ts`, neu)

```ts
export async function readImport(source: ImportSource, parent: BrowserWindow | null): Promise<ImportReadResult>;
```
- Handler in `index.ts`: `windowRegistry.requireMain(event); vaultSessionManager.getSnapshot();`. `source` wird mit `z.enum(['openssh','putty'])` geprüft, sonst `AppError('core.invalidRequest')`.
- openssh: `dialog.showOpenDialog(parent, { title: mainT('dialogs.importOpenSsh.title'), defaultPath: join(homedir(), '.ssh', 'config'), properties: ['openFile'] })`. Bei Abbruch `{ canceled: true }`. Dann `stat`: Größe > `MAX_IMPORT_BYTES` → `AppError('core.importTooLarge')`. Lesen als UTF-8; jeder fs-Fehler → `AppError('core.importUnreadable')`. Ergebnis `{ source:'openssh', file, ...parseOpenSshConfig(text, homedir()) }`.
- putty: Ist `process.env.SHELLHERD_PUTTY_REG_FILE` gesetzt, wird diese Datei gelesen. Sonst `mkdtemp(join(app.getPath('temp'), 'shellherd-import-'))` und `execFile(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'reg.exe'), ['export', 'HKCU\\Software\\SimonTatham\\PuTTY\\Sessions', tmp, '/y'], { timeout: 10_000, windowsHide: true })`. Exit-Code ungleich 0 → `{ canceled:false, preview:{ source:'putty', candidates:[], skipped:[] } }` (Schlüssel fehlt). Die Datei wird gelesen (Größenprüfung wie oben), `rm(dir, { recursive: true, force: true })` steht im `finally`. Dekodieren: Beginnt der Puffer mit `FF FE`, gilt `utf16le` ohne BOM, sonst `utf8`.
- Keine Protokollierung von Inhalten.

### 3.7 Main Update (`src/main/update-check.ts`, neu; `src/main/app-settings.ts` erweitert)

`app-settings.ts`:
```ts
export interface UpdateSettings { enabled: boolean; /** ms since epoch of the last successful check */ checkedAt?: number; latest?: string; skipped?: string }
export interface AppSettings { language: LanguageSetting; mainWindow?: MainWindowState; update: UpdateSettings }
export const DEFAULT_APP_SETTINGS: AppSettings = { language: 'system', update: { enabled: true } };
```
Schema: `enabled` boolean; `checkedAt` int ≥ 0; `latest`/`skipped` `/^\d{1,4}\.\d{1,4}\.\d{1,4}$/`. Ist es ungültig, gilt `{ enabled: true }`.

`update-check.ts`:
```ts
export const UPDATE_URL = 'https://api.github.com/repos/pelmenipower/Shellherd/releases/latest';
export const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const UPDATE_TIMEOUT_MS = 5000;
export const releaseUrl = (version: string): string => `https://github.com/pelmenipower/Shellherd/releases/tag/v${version}`;
/** x.y.z from a releases/latest body, else null (draft or prerelease → null). */
export function parseReleaseTag(body: unknown): string | null;   // tag_name /^v?(\d{1,4}\.\d{1,4}\.\d{1,4})$/
/** True without checkedAt, after 24 h, or when checkedAt lies in the future. */
export function updateDue(checkedAt: number | undefined, now: number): boolean;
/** latest when newer than current (compareVersions) and not skipped, else null. */
export function availableVersion(current: string, latest: string | undefined, skipped: string | undefined): string | null;
export interface UpdateCheckerDeps { current: string; settingsFile: string; url: string; now: () => number; isUnlocked: () => boolean;
  fetch: (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<Response> }
export class UpdateChecker {
  constructor(deps: UpdateCheckerDeps);
  /** Shares one in-flight check; never rejects. */
  status(): Promise<UpdateStatus>;
  setEnabled(enabled: boolean): UpdateStatus;   // writes settings; false → available null
  skip(version: string): UpdateStatus;           // validates x.y.z, else AppError('core.invalidRequest')
}
```
- Für `status()` gilt: Wenn `enabled`, `isUnlocked()` und `updateDue`, wird abgerufen mit den Headern `accept: application/vnd.github+json` und `user-agent: Shellherd/<current>` sowie `signal: AbortSignal.timeout(UPDATE_TIMEOUT_MS)`. Weiter geht es nur bei `response.ok`, Text ≤ 1 MiB, `JSON.parse` und `parseReleaseTag` ungleich null. Dann wird `writeAppSettings(file, { update: { ...u, checkedAt: now, latest } })` geschrieben. Jeder Fehler ist still, ohne Schreiben. Rückgabe `{ enabled, current, available: v ? { version: v, url: releaseUrl(v) } : null }`.
- `index.ts`: `new UpdateChecker({ current: app.getVersion(), settingsFile, url: testUrl ?? UPDATE_URL, now: Date.now, isUnlocked: () => vaultSessionManager.isUnlocked(), fetch: (u, i) => net.fetch(u, i) })`, wobei `testUrl` = `SHELLHERD_UPDATE_URL`, nur wenn der Wert mit `http://127.0.0.1:` beginnt. Alle drei Handler laufen über `windowRegistry.requireMain(event)`. `updateSetEnabled` prüft `typeof enabled === 'boolean'`.

### 3.8 Fehlercodes (`errors/core.json`)

| Key | de-DE | en-US |
|---|---|---|
| `core.importTooLarge` | Die Importquelle ist zu groß (höchstens 4 MiB). | The import source is too large (at most 4 MiB). |
| `core.importUnreadable` | Die Importquelle konnte nicht gelesen werden. | The import source could not be read. |

### 3.9 Texte (wörtlich)

`main.json`: `dialogs.importOpenSsh.title` = „OpenSSH-Konfiguration auswählen“ / „Select OpenSSH configuration“.

`vault.json` → `import`:

| Key | de-DE | en-US |
|---|---|---|
| `import.heading` | Importieren | Import |
| `import.openssh` | Aus OpenSSH (~/.ssh/config) … | From OpenSSH (~/.ssh/config) … |
| `import.putty` | Aus PuTTY … | From PuTTY … |
| `import.title.openssh` | Verbindungen aus OpenSSH importieren | Import connections from OpenSSH |
| `import.title.putty` | Verbindungen aus PuTTY importieren | Import connections from PuTTY |
| `import.reading` | Wird gelesen … | Reading … |
| `import.sourceFile` | Quelle: {{file}} | Source: {{file}} |
| `import.sourceRegistry` | Quelle: PuTTY-Sitzungen in der Windows-Registry | Source: PuTTY sessions in the Windows registry |
| `import.empty` | Keine SSH-Verbindungen gefunden. | No SSH connections found. |
| `import.selectAll` | Alle auswählen | Select all |
| `import.duplicate` | Schon vorhanden | Already saved |
| `import.via` | über {{name}} | via {{name}} |
| `import.keyFile` | Schlüsseldatei | Key file |
| `import.forwards_one` / `_other` | {{count}} Weiterleitung / {{count}} Weiterleitungen | {{count}} forward / {{count}} forwards |
| `import.notes.ppkKey` | PuTTY-Schlüssel (.ppk) funktioniert nur im Format 2 mit RSA. Sonst in PuTTYgen als OpenSSH-Schlüssel exportieren. | A PuTTY key (.ppk) works only in format 2 with RSA. Otherwise export it as an OpenSSH key in PuTTYgen. |
| `import.notes.jumpUnsupported` | Sprunghost nicht übernommen: nur ein Hop zu einem Host aus derselben Quelle. | Jump host not imported: only one hop to a host from the same source. |
| `import.notes.proxyDropped` | Proxy nicht übernommen. | Proxy not imported. |
| `import.notes.forwardsDropped` | Nicht alle Weiterleitungen übernommen. | Not all forwards imported. |
| `import.notes.keyUnresolved` | Schlüsselpfad mit Platzhaltern nicht übernommen, Anmeldung über den SSH-Agent. | Key path with tokens not imported; signs in with the SSH agent. |
| `import.skipped.match_one` / `_other` | {{count}} Match-Block übersprungen / {{count}} Match-Blöcke übersprungen | {{count}} Match block skipped / {{count}} Match blocks skipped |
| `import.skipped.include_one` / `_other` | {{count}} Include-Zeile nicht gelesen / {{count}} Include-Zeilen nicht gelesen | {{count}} Include line not read / {{count}} Include lines not read |
| `import.skipped.notSsh_one` / `_other` | {{count}} Sitzung ohne SSH übersprungen (Telnet, Serial, Raw) / {{count}} Sitzungen ohne SSH übersprungen (Telnet, Serial, Raw) | {{count}} non-SSH session skipped (Telnet, Serial, Raw) / {{count}} non-SSH sessions skipped (Telnet, Serial, Raw) |
| `import.skipped.invalid_one` / `_other` | {{count}} Eintrag ohne gültigen Host oder Port übersprungen / {{count}} Einträge ohne gültigen Host oder Port übersprungen | {{count}} entry without a valid host or port skipped / {{count}} entries without a valid host or port skipped |
| `import.skipped.tooMany_one` / `_other` | {{count}} weiterer Eintrag nicht gezeigt (höchstens 500) / {{count}} weitere Einträge nicht gezeigt (höchstens 500) | {{count}} more entry not shown (at most 500) / {{count}} more entries not shown (at most 500) |
| `import.target` | Zielordner | Target folder |
| `import.targetNew` | Neuer Ordner „{{name}}“ | New folder “{{name}}” |
| `import.targetRoot` | Oberste Ebene | Top level |
| `import.folder.openssh` | OpenSSH-Import | OpenSSH import |
| `import.folder.putty` | PuTTY-Import | PuTTY import |
| `import.hint` | Passwörter werden nie importiert. Schlüsseldateien bleiben, wo sie sind; Shellherd speichert nur den Pfad. Weiterleitungen starten erst per Klick. | Passwords are never imported. Key files stay where they are; Shellherd only stores the path. Forwards start only on click. |
| `import.submit_one` / `_other` | {{count}} Verbindung importieren / {{count}} Verbindungen importieren | Import {{count}} connection / Import {{count}} connections |
| `import.done_one` / `_other` | {{count}} Verbindung importiert / {{count}} Verbindungen importiert | {{count}} connection imported / {{count}} connections imported |
| `import.resultSkipped_one` / `_other` | {{count}} übersprungen. | {{count}} skipped. |
| `import.resultJumps_one` / `_other` | {{count}} ohne Sprunghost, weil er nicht mit ausgewählt war. | {{count}} without jump host because it was not selected. |

`app.json`:

| Key | de-DE | en-US |
|---|---|---|
| `welcome.import` | Importieren | Import |
| `update.available` | Version {{version}} verfügbar | Version {{version}} available |
| `update.title` | Shellherd {{version}} ist verfügbar | Shellherd {{version}} is available |
| `update.notes` | Release-Notes ansehen | View release notes |
| `update.skip` | Diese Version überspringen | Skip this version |
| `update.setting.label` | Nach neuen Versionen suchen | Check for new versions |
| `update.setting.hint` | Höchstens einmal am Tag fragt Shellherd nach dem Entsperren bei GitHub nach der neuesten Version und zeigt sie in der Statusleiste. Gesendet wird nur die Anfrage selbst, nichts aus dem Vault. Installieren musst du selbst. | At most once a day, after unlocking, Shellherd asks GitHub for the latest version and shows it in the status bar. Only the request itself is sent, nothing from the vault. You install updates yourself. |

Die Ergebnis-Meldung lautet `notify.ok(t('vault:import.done', { count }), { body })`. Der Body besteht aus `resultSkipped` (wenn `skipped > 0`) und `resultJumps` (wenn `jumpsDropped > 0`), verbunden mit `' '`. Dabei ist `skipped` = Kandidaten − importierte Knoten + Summe aller `preview.skipped[].count`.

### 3.10 UI

- **Menü „Neu“** (`App.tsx:876-883`): Nach „Neuer Ordner“ folgen `{ kind:'separator' }`, `{ kind:'heading', label: t('vault:import.heading') }` und die Einträge `vault:import.openssh` und `vault:import.putty`. Die Einträge rufen `setAppDialog({ kind: 'import', source })` auf. `AppDialog` bekommt `| { kind: 'import'; source: ImportSource }`. Beim Sperren schließt `afterLock` den Dialog schon (`App.tsx:618`).
- **Willkommensseite**: neue Sektion `<section aria-labelledby="welcome-import">` mit `<h2>{t('app:welcome.import')}</h2>` und zwei Knöpfen wie bei „Neue Verbindung“. Neue Prop `onImport: (source: ImportSource) => void`.
- **`ImportDialog.tsx`** (neu): `<dialog className="confirm-dialog import-dialog">` mit `showModal()` und `useNativeSurfaceBlock(true)` wie `SettingsDialog`.
  ```ts
  export interface ImportDialogProps { source: ImportSource; nodes: VaultNode[]; busy: boolean; onClose: () => void;
    /** Adds the nodes under parentId (undefined = top level) and saves; false when saving failed. */
    onImport: (nodes: VaultNode[], parentId: string | undefined) => Promise<boolean> }
  ```
  - Beim Öffnen wird `importRead(source)` aufgerufen. `canceled` ruft `onClose()` auf. Ein Fehler zeigt `errorText(error)` mit `role="alert"` und dem Knopf „Schließen“.
  - Inhalt: Titel, Quellzeile und dann die Liste `<ul className="import-list">`. Jede Zeile enthält eine Checkbox mit `<label>` und Name, darunter klein `user@host:port` (ohne `user@`, wenn kein Benutzer gesetzt ist). Dazu kommen nacheinander die Zusätze „über X“ (Name des Ziels), Weiterleitungsanzahl, „Schlüsseldatei“ (`title` = Pfad) und gegebenenfalls das Badge „Schon vorhanden“. Die Notizen folgen als `<small className="field-hint">`, eine Zeile je Code.
  - Darüber steht „Alle auswählen“ (Tri-State über `indeterminate`). Darunter folgen die Skip-Zeilen, `import.hint` und `<select>` „Zielordner“ mit den Optionen: neuer Ordner (Standard, Wert `__new__`), „Oberste Ebene“ (Wert `''`) und `folderOptions(nodes)` (`connection-form.ts:222`).
  - Vorauswahl: alle Kandidaten außer `importDuplicates`.
  - Der Knopf „{{count}} … importieren“ (`primary-button`) ist bei 0 oder `busy` deaktiviert.
  - Absenden: `buildImportNodes`. Beim Ziel `__new__` gilt `[importFolder(t(folder.<source>), nodes)]` mit `undefined`, sonst `nodes` mit `parentId || undefined`. Bei `true` folgen `notify.ok` und `onClose()`.
- **App**: `onImport={(list, parentId) => { let next = vault.nodes; for (const node of list) next = addNode(next, node, parentId); return persistVault({ ...vault, nodes: next }); }}`.
- **`UpdateBadge.tsx`** (neu) steht in der Statusleiste vor dem Version-Knopf. Beim Mount wird einmal `updateStatus()` aufgerufen. Ohne `available` gibt es `null` zurück. Sonst zeigt ein `<button className="update-button" aria-haspopup="menu">` den Text `update.available`. Ein Klick öffnet `ContextMenu` mit `label = update.title`, Überschrift `update.title` und den Einträgen „Release-Notes ansehen“ (`openExternal(url)`; ein Fehler geht an `notify.error(errorText(e))`) und „Diese Version überspringen“ (`updateSkip(version)`, danach ausblenden).
- **`UpdateSetting.tsx`** (neu) steht in `SettingsDialog.tsx:128` unter dem `settings-stack` von „Allgemein“ und erscheint auch ohne Vault. Aufbau wie `LanguageSetting`: `label.settings-check` mit Checkbox (Text `update.setting.label`) und `p.settings-hint` (`update.setting.hint`). Beim Mount liest sie `updateStatus()`, Änderungen gehen über `updateSetEnabled(checked)`. Ein Fehler wird als `errorText` mit `role="alert"` angezeigt. Main ruft in `status()` **nur bei entsperrtem Vault** ab (`vaultSessionManager.isUnlocked()`, als Dependency `isUnlocked: () => boolean` in `UpdateCheckerDeps`). Sonst kommt der gespeicherte Stand ohne Netz zurück. Damit löst der Einstellungsdialog auf dem Startbildschirm nie einen Abruf aus.
- **CSS**: `src/renderer/src/import-ui.css` (Liste mit `max-height` als Token, Zeilenabstände, Badge) und `.update-button` in derselben Datei. Nur `var(--…)`. Fehlt eine Höhe, kommt `--import-list-max` mit Rolle in `tokens.css` und `docs/design-system.md`. Keine Bewegung, also kein Motion-Gate-Eintrag.

## 4. Regeln und Risiken (ausdrücklich nicht)

- Keine Passwörter, keine Passphrasen und keine Schlüsselinhalte importieren. Key-Dateien und `Include`-Ziele nicht öffnen.
- Keine neue Abhängigkeit (kein Registry-Modul, kein SemVer-Paket, kein XML-Parser).
- Kein Registry-Zugriff außer `reg.exe export` auf genau `HKCU\Software\SimonTatham\PuTTY\Sessions`, nie schreiben.
- Der Renderer bekommt nur `ImportPreview` und `UpdateStatus`, nie Pfade zum Öffnen. Die Release-URL kommt nie aus der Antwort.
- Kein Netz vor dem Entsperren und keins bei `enabled: false`. Kein Abruf öfter als alle 24 h nach Erfolg. Keine Fehlermeldung bei Netzfehlern.
- Importierte Weiterleitungen nie automatisch (`auto: false`).
- Keine Vault-Felder, keine Version 3, keine neue Mutation, kein neuer `VaultConsistencyIssueCode`.
- Der Demo-Stack liest nie die echte Registry und ruft nie `api.github.com` ab (R15). Risiko: Wer `screens.mjs` ohne den neuen Treiber startet, liest die echte Registry beim Klick auf „Aus PuTTY …“. Gegenmaßnahme: Der Block `import` prüft vorher per `/main`, dass `process.env.SHELLHERD_PUTTY_REG_FILE` gesetzt ist, und bricht sonst ab.
- Risiko PPK: Viele PuTTY-Nutzer haben PPK v3 oder Ed25519. Die Verbindung scheitert dann mit der vorhandenen Schlüsselfehlermeldung. Der Import sagt es vorher per Notiz.
- Risiko Opt-out: Der Abruf ist neuer Netzverkehr. Gegenmaßnahmen: Hinweistext, Changelog-Zeile, README-Abschnitt Datenschutz, Schalter auch ohne Vault erreichbar.

## 5. Zerlegung in Tasks (exklusive Dateien)

**Welle 1 (parallel, keine gegenseitigen Abhängigkeiten außer dem wörtlichen Vertrag oben)**

| Task | Dateien | Inhalt |
|---|---|---|
| T1 Import-Kern | `src/shared/import.ts`, `src/shared/import.test.ts` | 3.1, 3.4; Tests: Duplikate (Groß-/Kleinschreibung, fehlender Benutzer, Batch), Agent oder Schlüssel, Sprunghost gesetzt, Sprunghost gestrichen (Ziel nicht ausgewählt oder ungültig), Weiterleitungen mit `auto:false` und UUID, ungültiger Knoten zählt `invalid` |
| T2 OpenSSH-Parser | `src/shared/import-openssh.ts`, `src/shared/import-openssh.test.ts` | 3.2; synthetische Configs im Test: `Host *`-Vorgaben, Negation, Match, Include, `%h`, `~`/relativ/`%r`, ProxyJump-Fälle, alle drei Forward-Arten, Socket-Pfad, 17 Forwards, ungültiger Port |
| T3 PuTTY-Parser | `src/shared/import-putty.ts`, `src/shared/import-putty.test.ts` | 3.3; Test-Text mit Default Settings, Telnet, `user@host`, `%20` im Namen, `.ppk`, ProxyMethod, PortForwardings L/R/D/ungültig |
| T4 Update-Kern | `src/main/update-check.ts`, `src/main/update-check.test.ts`, `src/main/app-settings.ts`, `src/main/app-settings.test.ts` | 3.7; Tests mit Fake-`fetch`/`now`: fällig/nicht fällig/Zukunft, Entwurf, ungültiger Tag, Timeout still, Überspringen, aus, ein Abruf bei parallelen `status()` |
| T5 Texte | alle `src/shared/locales/{de-DE,en-US}/{app,vault,main}.json`, `errors/core.json` | 3.8, 3.9 wörtlich |
| T6 IPC-Vertrag | `src/shared/ipc.ts`, `src/preload/index.ts` | 3.5 |
| T7 Demo-Fakes | `.claude/skills/run-app/import-fixtures.mjs` (neu), `driver.mjs`, `ai-fake.mjs`, `fakes.test.mjs` | Siehe 6. |

**Welle 2 (nach Welle 1)**

| Task | Dateien | Inhalt |
|---|---|---|
| T8 Main-Verdrahtung | `src/main/import-source.ts`, `src/main/import-source.test.ts` (Dekodierung UTF-16LE/UTF-8, Größengrenze; `reg.exe` per injiziertem `run`), `src/main/index.ts` | 3.6, Handler aus 3.7 |
| T9 Import-Dialog | `src/renderer/src/components/ImportDialog.tsx`, `src/renderer/src/import-ui.css`, ggf. `tokens.css` + `docs/design-system.md` | 3.10 |
| T10 Update-Oberfläche | `src/renderer/src/components/UpdateBadge.tsx`, `UpdateSetting.tsx`, `SettingsDialog.tsx` | 3.10 (CSS-Klasse `.update-button` steht in T9s `import-ui.css`; T10 importiert sie nicht, T11 importiert die CSS einmal in `App.tsx`) |
| T12 Doku und Version | `package.json`/`package-lock.json` → 0.21.0, `CHANGELOG.md` (`## [0.21.0] – 2026-10-24`), `README.md` (Import; Abschnitt Datenschutz: einzige Netzanfragen sind KI-Anbieter und der abschaltbare Versionscheck) | – |

**Welle 3**

| Task | Dateien | Inhalt |
|---|---|---|
| T11 App-Einbau | `src/renderer/src/App.tsx`, `src/renderer/src/components/WelcomePage.tsx` | Menü, `AppDialog`, `onImport`, `UpdateBadge` in der Statusleiste, `import './import-ui.css'` |
| T13 Screenshots | `.claude/skills/run-app/screens.mjs`, `SKILL.md` | Blöcke `import` und `update` (siehe 6.) |

## 6. Demo-Stack

- `import-fixtures.mjs`: `writeImportFixtures(dir)` schreibt `ssh_config` (UTF-8) und `putty.reg` (UTF-16LE mit BOM, Kopf `Windows Registry Editor Version 5.00`).
  - `ssh_config`: `Host *` mit `User demo`. `web-01` (127.0.0.1:2222) erscheint als „Schon vorhanden“. Dazu `build-01` (10.20.0.11, `IdentityFile ~/.ssh/id_ed25519`), `db-01` (`ProxyJump build-01`, `LocalForward 15433 db-internal:5432`), `legacy` (`ProxyJump a,b`), `Host *.internal`, `Match host x` und `Include config.d/*`.
  - `putty.reg`: `Default%20Settings`, `router` (telnet), `jenkins` (`.ppk`), `monitoring` (`L3000=localhost:3000`) und `web%2001` (Leerzeichen im Namen).
- `driver.mjs`: Der Treiber ruft beim Start `writeImportFixtures(path.join(WORK,'import'))` auf. In `env` kommen `SHELLHERD_PUTTY_REG_FILE` und `SHELLHERD_UPDATE_URL: 'http://127.0.0.1:9335/releases/latest'`. Kein Demo-Lauf erreicht GitHub.
- `ai-fake.mjs`: `GET /releases/latest`. Existiert `RUN_DIR/update-available`, antwortet die Route mit `{ tag_name: 'v<major>.<minor+1>.0', draft:false, prerelease:false }` (aus `package.json`), sonst mit der aktuellen Version. So zeigen andere Screenshots keinen Badge.
- `screens.mjs`:
  - **`import`:** Zuerst die Prüfung aus Abschnitt 4. Dann `dialog.showOpenDialog` per `/main` auf `ssh_config` umbiegen, Menü „Neu“ → „Aus OpenSSH …“, Aufnahme `import-openssh.png`. Absenden, Aufnahme `import-result.png` (Toast und Baum). Danach „Aus PuTTY …“ mit `import-putty.png`, Abbrechen. Zum Schluss den Dialog-Stub zurück auf den Vault setzen.
  - **`update`:** `update-available` anlegen, in `profile/Shellherd/settings.json` `update.checkedAt` löschen, `location.reload()`, entsperren wie `demo-setup.mjs`, auf `.update-button` warten. Aufnahmen `update-hint.png` und nach dem Klick `update-menu.png`. Dann die Flag-Datei löschen und „Diese Version überspringen“ klicken.

## 7. Minimale erste Stufe und Extras

Stufe 1 = alles in den Abschnitten 3 und 5: OpenSSH und PuTTY mit Vorschau, Duplikaten, Zielordner und Ergebnis, dazu Update-Hinweis und Schalter. Extras, benannt und nicht jetzt: `Include` unter `~/.ssh`, WinSCP, mRemoteNG (beide ohne Passwörter), manuelle `.reg`-Auswahl, Pageant, Sprunghost-Ketten, Hinweis vor dem Entsperren.
