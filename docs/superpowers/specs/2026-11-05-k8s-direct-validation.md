# k8s-direct – Validierung (bindend)

Prüft `2026-11-05-k8s-direct-design.md` (Rulings D-1…D-8 eingeschlossen). **Dieser Anhang geht Spec und Plan vor.** Wo er schweigt, gilt die Spec.

## Urteil

**ready after corrections** – 4 Blocker (alle mit Fix unten), 24 Korrekturen (K-1…K-24), 4 akzeptierte Restrisiken.

Geprüft am Code-Stand `76dfc05`: `npm run typecheck` grün. Zeilenangaben der Spec stimmen bis auf K-23. zod ist 4.6.5. Dort bleibt `.refine` am `ZodObject` ein `ZodObject` (Beleg: `AiCliConnectionNodeSchema`, `schema.ts:140-146`, steht schon in der Union). Der Fallback aus §2/Risiko 8 entfällt.

---

## Blocker

### B-1 (Critical, Sicherheit, betrifft auch den heutigen SSH-Weg): `token-file` wird beim Parsen lokal gelesen
`@kubernetes/client-node` liest in `loadFromString` für **jeden** User sofort `fs.readFileSync(user['token-file'])` (`node_modules/@kubernetes/client-node/dist/config_types.js:119-127`, aus `userIterator` :88-107). Das gilt auch für nicht gewählte Contexts und für YAML-escapte Schlüssel. Nachgewiesen mit `{"token\x2dfile": <lokale Datei>}`: Der Dateiinhalt landet in `user.token`.

Folgen:
- Eine eingefügte kubeconfig, und **heute schon** jede kubeconfig von einem SSH-Host (`k8s:probe` → `listContexts`, `Session.establish` → `parseKubeconfig`), liest beliebige lokale Dateien.
- Der Inhalt geht als `Authorization: Bearer …` an den `server` der Config, also an den, der die Config geschrieben hat.
- `token-file: /dev/zero` blockiert den Main-Prozess.

**Fix (T2):**
- Sämtliches Parsen mit client-node läuft über das private `load()` in `kubeconfig.ts`, auch in `listContexts` und `kubeconfigSecrets`. Niemand ruft `loadFromString` direkt auf.
- `load()` parst zuerst selbst mit `import { load as parseYaml } from 'js-yaml'` (dieselbe Datei `node_modules/js-yaml` 5.5.0, die client-node nutzt).
- Hat irgendein Element von `users[]` ein Objekt `user` mit eigenem Schlüssel `token-file`, folgt `KubeInputError('kubernetes.tokenFileUnsupported')`. Das gilt für **alle** Policies (ssh, inline, file).
- Erst danach kommt `config.loadFromString(text)`.
- Kommentar: `// shortcut: js-yaml is client-node's transitive copy; the test pins that both resolve to the same file`.
- Test: Beide `require.resolve('js-yaml')` (von uns und von `@kubernetes/client-node` aus) ergeben dieselbe Datei. Außerdem eine kubeconfig mit `token-file` auf eine vorhandene Temp-Datei, in einem **nicht gewählten** User und mit escaptem Schlüssel: Das Ergebnis ist `tokenFileUnsupported`, kein Token.

### B-2 (Sicherheit): eingefügte kubeconfig in Zweitfenstern und im gesperrten Renderer
`redactSecrets` (`src/shared/vault/connections.ts:39-48`) entfernt SSH/RDP-Geheimnisse, aber nicht `kubeconfig.text`. Der Katalog für Zweitfenster (`src/main/window-ipc.ts:84`) und die Sperre (`App.tsx:655` → `redactVault`) würden die kubeconfig samt Token weitergeben bzw. behalten.

**Fix (T1):** In `redactSecrets` gibt ein Kubernetes-Knoten mit `kubeconfig.source === 'inline'` → `{ ...node, kubeconfig: { source: 'inline', text: '' } }` zurück (auch `execConsent` fällt weg). Test in `connections.test.ts`.

### B-3: Der Wellenplan der Spec hält Typecheck und Tests nicht grün
- `ClusterAccess.host` wird in Welle 1 optional (T2). Damit bricht `session.ts:270,272,329,382` und `kubernetes/ipc.ts:46` im Typecheck, die erst T4 in Welle 2 anfasst.
- `KubeProbeRequest` wird in Welle 1 zur Union (T1). Damit bricht `kubernetes/ipc.ts:122` (`.connectionId` auf der Union).
- Alle Locale-Keys in Welle 1 lassen `i18n-catalog.test.ts` (d) „no orphaned keys“ bis Welle 2 rot werden.
- `fakes.test.mjs` liegt in T3 und T7. T3 kann in Welle 1 `openDirect` noch nicht nutzen.

**Fix:** Wellenplan unten. Jede Datei hat je Welle genau einen Besitzer. Ein Key kommt in derselben Welle wie sein erster Nutzer.

### B-4: Import-Zyklus `vault/schema.ts` ↔ `kubernetes-schema.ts`
`schema.ts` importiert `KubeNameSchema` aus `../kubernetes-schema` (`schema.ts:18`). Würde `kubernetes-schema.ts` `KUBECONFIG_LOCAL_PATH`/`KUBECONFIG_TEXT_MAX` aus `vault/schema.ts` holen (Spec §3.5), wäre die Konstante beim Laden undefiniert (TDZ).

**Fix (T1):** Die drei Konstanten leben in `src/shared/kubernetes.ts`. Diese Datei hat nur einen Typ-Import (`./errors`). Alle anderen importieren von dort.

---

## Bindender Vertrag

### Shared (T1, Welle 1)
```ts
// src/shared/kubernetes.ts (additions only in wave 1)
export const KUBECONFIG_TEXT_MAX = 65_536;
export const EXEC_CONSENT_MAX = 4096;
/** Drive path, POSIX root or `~/` / `~\`; never UNC or device paths (K-3). */
export const KUBECONFIG_LOCAL_PATH = /^(?:~[\\/]|\/(?!\/)|[A-Za-z]:[\\/])/;

// src/shared/vault/types.ts
export type KubeconfigSource =
  | { source: 'auto' }
  | { source: 'path'; path: string }
  /** Pasted text inside the encrypted vault; execConsent: the approved command line (execCommandLine). */
  | { source: 'inline'; text: string; execConsent?: string }
  /** File on this computer, read again at every connect; `~/` means the home directory. */
  | { source: 'file'; path: string };
// KubernetesConnectionNode.kubeconfig: KubeconfigSource; accessHosts comment: "SSH ids for 'auto'/'path'; empty for 'inline'/'file'."

// src/shared/vault/connections.ts
export function isDirectKubeconfig(source: KubeconfigSource): source is Extract<KubeconfigSource, { source: 'inline' | 'file' }>;

// src/shared/vault/schema.ts (KubernetesConnectionNodeSchema)
accessHosts: z.array(z.string().min(1).max(256)).max(8),
kubeconfig: z.discriminatedUnion('source', [
  z.object({ source: z.literal('auto') }),
  z.object({ source: z.literal('path'), path: z.string().min(1).max(1024).refine(path => !/[\r\n\0]/.test(path)) }),
  z.object({ source: z.literal('inline'), text: z.string().min(1).max(KUBECONFIG_TEXT_MAX).refine(text => !text.includes('\0')),
    execConsent: z.string().min(1).max(EXEC_CONSENT_MAX).refine(noLineBreak).optional() }),
  z.object({ source: z.literal('file'), path: z.string().min(1).max(32_767).regex(KUBECONFIG_LOCAL_PATH).refine(noLineBreak) }),
]),
// …unchanged fields…
}).refine(node => isDirectKubeconfig(node.kubeconfig) ? node.accessHosts.length === 0 : node.accessHosts.length >= 1,
  { message: 'accessHosts', path: ['accessHosts'] });

// src/shared/ipc.ts
IPC_CHANNELS.kubeSelectConfigFile = 'k8s:select-config-file';   // one name everywhere (K-19)
DesktopApi.kubeSelectConfigFile: () => Promise<SelectVaultFileResult>;
// src/preload/index.ts
kubeSelectConfigFile: () => ipcRenderer.invoke('k8s:select-config-file'),
```

### Main-Kern (T2, Welle 1)
```ts
// src/main/kubernetes/kubeconfig.ts
export type KubeconfigPolicy =
  | { source: 'ssh' }
  | { source: 'inline'; execConsent?: string }
  | { source: 'file'; dir: string };                 // K-1: folder of the file, not loadFromFile
export const EXEC_TIMEOUT_MS = 60_000;
export interface ParsedKubeconfig { /* unchanged fields */ build(localPort: number | null, tlsServerName?: string): KubeConfig }
export function parseKubeconfig(text: string, contextName?: string, policy: KubeconfigPolicy = { source: 'ssh' }): ParsedKubeconfig;
export function execCommandLine(user: User): string | undefined;           // K-7
export function listContexts(text: string): { contexts: string[]; currentContext?: string; clusterName?: string; execCommands: Record<string, string> };
export function kubeconfigSecrets(text: string): string[];                 // K-20; [] on any error
// private: function load(text: string, dir?: string): KubeConfig          // B-1 scan, then loadFromString, then makePathsAbsolute(dir) if dir

// src/main/kubernetes/direct.ts (new)
export const DIRECT_FILE_MAX_BYTES = 1_048_576;
export interface DirectAccess { kubeconfig: string; source: string; policy: KubeconfigPolicy }
export interface LocalFiles { stat(path: string): Promise<{ isFile(): boolean; size: number }>; readFile(path: string, encoding: 'utf8'): Promise<string> }
export function expandHome(path: string, home = os.homedir()): string;   // /^~[\\/]/ → path.join(home, rest); else unchanged
export async function readLocalKubeconfig(path: string, files?: LocalFiles): Promise<{ text: string; path: string }>; // path = expanded
export async function openDirect(cluster: KubernetesConnectionNode, files?: LocalFiles): Promise<DirectAccess>;
// default files: { stat: p => fs.promises.stat(p), readFile: (p, e) => fs.promises.readFile(p, e) }
```

**Regeln in `parseKubeconfig`.** Reihenfolge nach Context-, Cluster- und User-Auflösung (unverändert). Unbekannte Fälle lehnen ab.

| Prüfung | `ssh` | `inline` | `file` |
|---|---|---|---|
| `user.authProvider` truthy (auch `name: exec` und `config.exec`, die `ExecAuth.isAuthProvider` sonst ausführt) | `loginPluginUnsupported` (wie heute: `exec \|\| authProvider`) | `authProviderUnsupported` | `authProviderUnsupported` |
| `user.exec` mit `command` kein nichtleerer String, oder `args`/`env` vorhanden, aber kein Array | ↑ | `loginPluginUnsupported` | `loginPluginUnsupported` |
| `exec.command` mit `/` oder `\`, nicht absolut (`path.isAbsolute`) | ↑ | `loginPluginNotStarted { command }` | in `build` zu `path.resolve(dir, command)` (wie kubectl) |
| `user.exec` sonst | ↑ | nur wenn `policy.execConsent === execCommandLine(user)`, sonst `loginPluginNeedsConsent { command }` | erlaubt |
| `caFile`/`certFile`/`keyFile` ohne `…Data` | `certFilesUnsupported` | `certFilesUnsupported` | erlaubt (absolut über `makePathsAbsolute(dir)`) |
| URL/https | wie heute | wie heute | wie heute |
| `cluster.skipTLSVerify === true` | durchgereicht | `tlsVerifyRequired` | `tlsVerifyRequired` |
| `cluster.proxyUrl` | durchgereicht | `proxyUnsupported` | `proxyUnsupported` |
| `token-file` (B-1, in `load`) | `tokenFileUnsupported` | `tokenFileUnsupported` | `tokenFileUnsupported` |

`{ command }` in Fehlern ist immer `String(exec.command).slice(0, 200)`, **nie** die ganze Zeile mit env (K-9).

**`build(localPort, tlsServerName?)`:**
- Zahl: `server = https://127.0.0.1:<port>`, `tlsServerName = tlsServerName ?? cluster.tlsServerName ?? host` (unverändert).
- `null`: `server` bleibt. `tlsServerName = tlsServerName ?? cluster.tlsServerName`, nur gesetzt, wenn definiert, also nie die IP aus der URL (K-17).
- Policy ≠ `file`: Im gebauten Cluster und User sind `caFile`, `certFile` und `keyFile` `undefined` (K-5).
- Hat der User `exec`, wird die Exec-Absicherung K-6 eingehängt.

### Main-Session (T4, Welle 2)
```ts
// src/main/kubernetes/access.ts
export interface ClusterAccess { kubeconfig: string; source: string; host?: RemoteHost; connection?: SshConnectionNode; policy?: KubeconfigPolicy }
// src/shared/kubernetes.ts
export type KubeProbeRequest = { connectionId: string } | { text: string } | { path: string };
export interface KubeProbeResult { source: string; contexts: string[]; currentContext?: string; clusterName?: string; execCommands?: Record<string, string> }
// src/shared/kubernetes-schema.ts
export const KubeProbeRequestSchema = z.union([
  z.object({ connectionId: z.string().min(1).max(256) }).strict(),
  z.object({ text: z.string().min(1).max(KUBECONFIG_TEXT_MAX) }).strict(),
  z.object({ path: z.string().min(1).max(32_767).regex(KUBECONFIG_LOCAL_PATH).refine(path => !/[\0\r\n]/.test(path)) }).strict(),
]);
```
- `session.ts` `establish()`:
  - `if (this.disposed) { access.host?.close(); throw … }`
  - `this.hostName = access.connection?.name`
  - `parseKubeconfig(access.kubeconfig, cluster.context, access.policy ?? { source: 'ssh' })`
  - Tunnel nur `if (access.host)`, sonst `port = null`
  - `probe(parsed, port: number | null)`
  - `checkHealth`: `this.access?.host?.closed`
  - `teardownLive`: `this.access?.host?.close()`
  - Sonst keine Änderung; `readOnly`- und Bestätigungs-Gates bleiben unberührt.
- `kubernetes/ipc.ts`:
  - `openAccess: (cluster, onTry) => isDirectKubeconfig(cluster.kubeconfig) ? openDirect(cluster) : openAccess(cluster, { getConnection, openRemote, sudoRejections }, onTry)`
  - `openTunnel`: `const host = access.host; if (!host) throw new AppError('kubernetes.tunnelFailed');` (K-18)
- `k8s:probe`: K-11.
- `k8s:select-config-file`:
  - `requireSshSender(event)`, `vaultSessionManager.getSnapshot()`
  - `dialog.showOpenDialog({ title: mainT('dialogs.kubeconfig.title'), properties: ['openFile', 'showHiddenFiles'] })`
  - Muster wie `vault/ipc.ts:102-108` (Elternfenster), Rückgabe `SelectVaultFileResult`.

### Renderer (T5, T6, Welle 2)
`ConnectionFields` (es gibt **kein** Feld `access`, K-12):
```ts
/** Kubernetes only. 'inline'/'file' = direct access. */
kubeconfigSource: KubeconfigSource['source'];
/** 'path': on the access host; 'file': on this computer. */
kubeconfigPath: string;
/** 'inline' only: the pasted kubeconfig. */
kubeconfigText: string;
/** 'inline' only: approved login-plugin command line; '' = none. */
execConsent: string;
```
Standard in `fieldsFromConnection`: `kubeconfigSource: 'inline'`, `kubeconfigText: ''`, `execConsent: ''` (D-3). Ein bestehender Knoten überschreibt das. `emptyCluster`/`newClusterFromSsh` bleiben `auto`, also SSH.

---

## Korrekturen

- **K-1** `file` lädt **nicht** per `loadFromFile`. Die Spec irrt: `makePathsAbsolute(rootDirectory)` ist öffentlich (`config.d.ts:83`). Ablauf:
  - `openDirect` liest die Datei einmal (K-4).
  - `load(text, dir)` ruft nach `loadFromString` `config.makePathsAbsolute(dir)` auf.
  - Policy `{ source: 'file'; dir }`.
  - Das vermeidet synchrones Lesen ohne Größenlimit im Main-Prozess und doppeltes Lesen.
- **K-2** Kein `policyFor`: `openDirect` liefert die Policy in `DirectAccess.policy`:
  - inline: `{ source: 'inline', ...(execConsent ? { execConsent } : {}) }`
  - file: `{ source: 'file', dir: path.dirname(expanded) }`
  - Die Session nimmt `access.policy ?? { source: 'ssh' }`. Fehlt die Policy, gilt die strengste.
- **K-3** UNC-Pfade (`\\server\share`) sind für `file` ausgeschlossen, Regex siehe Vertrag. Grund: Eine Datei auf einer fremden Freigabe würde Exec-Plugins ohne Freigabe (D-5) ausführen, und schon das Lesen schickt NTLM-Anmeldedaten an den Server. „Datei auf diesem Rechner“ heißt lokal. `~\` ist zusätzlich erlaubt (Windows).
- **K-4** `readLocalKubeconfig(path, files)`:
  - Ablehnen ohne Dateizugriff, wenn `KUBECONFIG_LOCAL_PATH` nicht passt oder `[\0\r\n]` enthalten ist.
  - Sonst `stat(expanded)`. Ist es keine reguläre Datei oder größer als `DIRECT_FILE_MAX_BYTES`, wird abgelehnt, **ohne** `readFile` aufzurufen (`/dev/zero`, FIFOs).
  - Dann `readFile(expanded, 'utf8')`.
  - Jeder Fehler → `KubeInputError('kubernetes.kubeconfigFileUnreadable', { path })`, mit dem Pfad, wie er eingetragen ist.
  - Kein `$KUBECONFIG`, keine Suche.
  - `openDirect` nutzt diese Funktion.
- **K-5** `bufferFromFileOrString` bevorzugt die Datei vor `…-data` (`config.js:646-650`). Eine Config mit `certificate-authority: <lokaler Pfad>` **und** `-data` besteht die heutige Prüfung und liest trotzdem lokal. Fix: `build()` setzt bei Policy ≠ `file` die drei `*File`-Felder auf `undefined`, dann gewinnt `-data`. Das ändert am SSH-Weg nur diesen Doppelfall.
- **K-6** Exec-Absicherung in `build()`, wenn `user.exec` gesetzt ist:
  ```ts
  // shortcut: client-node 2.0.0 (exact pin) keeps ExecAuth private; the test fails if the field moves
  const auth = (built as unknown as { authenticators?: object[] }).authenticators?.find(item => 'execFn' in item) as { execFn: unknown } | undefined;
  if (!auth) throw new KubeInputError('kubernetes.loginPluginUnsupported');
  auth.execFn = (command: string, args: string[] | undefined, options: SpawnOptions) =>
    spawn(command, args ?? [], { ...options, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: EXEC_TIMEOUT_MS });
  ```
  Ohne das öffnet unter Windows jedes Plugin ein Konsolenfenster. Ein Device-Code-Plugin hielte die Sitzung unbegrenzt in „verbinde“.
- **K-7** `execCommandLine` muss eindeutig sein. Sonst ergeben `["a b"]` und `["a","b"]` oder env- und Befehls-Token dieselbe Freigabe:
  ```ts
  const SAFE = /^[A-Za-z0-9_@%+:,./\\-]+$/;          // no '=', no space, no quotes
  const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
  const word = (value: unknown): string => { const text = String(value); return SAFE.test(text) ? text : JSON.stringify(text); };
  // env entries in kubeconfig order, then command, then args, joined by ' ':
  // `${ENV_NAME.test(name) ? name : JSON.stringify(name)}=${word(value)}` … `${word(command)}` `${word(arg)}` …
  ```
  Ohne `exec` oder ohne nichtleeren String-`command` → `undefined`. `EXEC_CONSENT_MAX` wird 4096, weil env zur Zeile gehört (D-2).
- **K-8** Relative Exec-Befehle (mit Trennzeichen, nicht absolut): Bei `file` löst `build` sie gegen `dir` auf, wie kubectl. Bei `inline` werden sie mit `loginPluginNotStarted` abgelehnt (es gibt keinen Bezugsordner, `spawn` nähme das Arbeitsverzeichnis von Electron). Die Freigabe-Zeile nutzt immer den Originaltext.
- **K-9** Der Parameter `command` von `loginPluginNeedsConsent` ist nur der Programmname/-pfad (≤ 200 Zeichen). env-Werte gehören nicht in Fehler.
- **K-10** D-7 in `client-api.ts` `toApiError`, vor dem generischen Fallback, für `e` und `e.cause`:
  - `code ∈ {ENOENT, EACCES, EPERM}` und `path` ist ein String:
  - `String(syscall).startsWith('spawn')` → `KubeApiError('Login plugin could not be started', undefined, { code: 'kubernetes.loginPluginNotStarted', params: { command: path.slice(0, 200) } })`
  - sonst → `{ code: 'kubernetes.kubeconfigFileUnreadable', params: { path: path.slice(0, 1024) } }`
  - Keine Rohmeldung, kein stderr.
- **K-11** `k8s:probe` (`requireSshSender` und `vaultSessionManager.getSnapshot()` für alle drei Formen):
  - `{ connectionId }` wie heute, aber **ohne** `execCommands` im Ergebnis.
  - `{ text }` → `{ source: 'inline', ...listContexts(text) }`, mit `execCommands`.
  - `{ path }` → `readLocalKubeconfig(path)`, dann `{ source: <expanded>, contexts, currentContext?, clusterName? }`, **ohne** `execCommands`.
  - Die Probe ruft nie `build`/`createKubeApi` auf. Es läuft also kein Plugin und es wird keine weitere Datei gelesen.
- **K-12** Kein Feld `access`. „Direkt“ = `kubeconfigSource ∈ {inline, file}`. Das Radio „Zugang“ setzt:
  - auf SSH: `{ kubeconfigSource: 'auto', kubeconfigPath: '', execConsent: '' }`
  - auf Direkt: `{ kubeconfigSource: 'inline', kubeconfigPath: '', execConsent: '' }`
  - `accessHosts` bleiben im Formular stehen; gespeichert wird bei Direkt `[]`.
- **K-13** Es gibt keine Prüfung `execConsentMissing` beim Speichern: `connectionFromFields` kennt das Probe-Ergebnis nicht. Der Key entfällt, beim Verbinden greift das Main-Gate. `ClusterForm` setzt `execConsent: ''` bei jeder Änderung von `kubeconfigText` oder `context` und beim Wechsel auf `file`.
- **K-14** Der Knopf „Entfernen“ entfällt; ein leerer Text ist nicht speicherbar, „Ersetzen“ genügt. `kubeconfig.stored` wird `stored_one`/`stored_other` mit `{{count}}` (formatiert über COUNT_KEYS). Neu kommt `validation.kubeconfigTextTooLong` mit `{{max}}` für Texte > `KUBECONFIG_TEXT_MAX`.
- **K-15** Texte in Fehlern schreiben „kubeconfig“ klein (wie der Bestand). Die wörtlichen Texte stehen in der Tabelle unten und sind bindend, die Texte aus Spec §5.4 sind ersetzt.
- **K-16** `KubeSessions.open`/`openTerminal` bekommen **keine** eigene Prüfung auf `noAccessHost`. `openAccess` wirft sie schon (`access.ts:113`).
- **K-17** `build(null)` setzt `tlsServerName` nie auf den Host aus der URL (sonst setzt Node eine IP als SNI). Der Altname-Retry mit `'kubernetes'` bleibt auch beim direkten Zugang.
- **K-18** `openTunnel` in `ipc.ts` wirft ohne `access.host` `kubernetes.tunnelFailed`. Die Session ruft es dann ohnehin nicht auf.
- **K-19** Der Kanal heißt einheitlich `k8s:select-config-file`; Spec §1 nennt `k8s:select-kubeconfig-file`. Der Dialog nutzt `showHiddenFiles` (`~/.kube`).
- **K-20** `kubeconfigSecrets` läuft über das geschützte `load()` und liefert je User `token`, `password`, `keyData` sowie aus `authProvider.config` die String-Werte von `id-token`, `refresh-token`, `client-secret` und `access-token`. Bei jedem Fehler kommt `[]`. env-Werte werden nicht maskiert (zu viele Fehltreffer).
- **K-21** run-app:
  - **Nie** `~/` und nie „Datei wählen …“ in Demo oder Szenen. Das läse die echte `~/.kube/config` des Entwicklerrechners.
  - Nur der absolute Pfad `path.join(RUN_DIR, 'kube', KUBE_DIRECT_FILE)`.
  - Die Fakes wandern von T3 in Welle 2.
- **K-22** Der Standard `kubeconfigSource: 'inline'` ändert die Fixtures in `connection-form.test.ts` (`:138-205`, Cluster-Fälle mit `accessHosts`). T5 setzt dort `kubeconfigSource: 'auto'`, damit die bestehenden Aussagen gleich bleiben. Keine Aussage wird gelöscht.
- **K-23** Faktenkorrekturen:
  - `ClusterView.tsx` liegt unter `src/renderer/src/components/kubernetes/ClusterView.tsx:370`.
  - CHANGELOG-Hinweise in Spec §2 und Risiko 1 entfallen nach D-1; der Text steht im PR.
  - §4.2 „Kubeconfig-Inhalt bleibt in Main“ gilt für `file` und SSH. Eine eingefügte kubeconfig ist Vault-Inhalt und liegt wie Passwörter im Haupt-Renderer, nicht in Zweitfenstern und nicht im gesperrten Zustand (B-2).
- **K-24** Doku-Pflichtinhalte (T8) siehe Task T8.

### Texte (bindend, de-DE / en-US)

| Key | de-DE | en-US |
|---|---|---|
| `connection:cluster.access.mode.legend` | Zugang | Access |
| `…access.mode.ssh` | Über SSH | Through SSH |
| `…access.mode.direct` | Direkt | Direct |
| `…access.mode.directHint` | Shellherd spricht den API-Server von diesem Rechner aus an. Es wird keine SSH-Verbindung gebraucht. | Shellherd talks to the API server from this computer. No SSH connection is needed. |
| `…kubeconfig.inline` | Eingefügt (im Vault gespeichert) | Pasted (stored in the vault) |
| `…kubeconfig.file` | Datei auf diesem Rechner | File on this computer |
| `…kubeconfig.textLabel` | Kubeconfig | Kubeconfig |
| `…kubeconfig.textHint` | Wird verschlüsselt im Vault gespeichert und wandert mit ihm. | Stored encrypted in the vault and travels with it. |
| `…kubeconfig.stored_one` | Kubeconfig gespeichert · {{count}} Zeichen | Kubeconfig stored · {{count}} character |
| `…kubeconfig.stored_other` | Kubeconfig gespeichert · {{count}} Zeichen | Kubeconfig stored · {{count}} characters |
| `…kubeconfig.replace` | Ersetzen | Replace |
| `…kubeconfig.fileLabel` | Pfad auf diesem Rechner | Path on this computer |
| `…kubeconfig.fileHint` | Wird bei jedem Verbinden neu gelesen. | Read again at every connect. |
| `…kubeconfig.pickFile` | Datei wählen … | Choose file… |
| `…kubeconfig.pickFailed` | Die Datei konnte nicht gewählt werden. | The file could not be chosen. |
| `…context.execConsent` | Login-Programm beim Verbinden ausführen: {{command}} | Run login program when connecting: {{command}} |
| `…context.execHint` | Dieses Programm läuft auf diesem Rechner mit deinen Rechten. Nur bestätigen, wenn die kubeconfig aus vertrauenswürdiger Hand stammt. | This program runs on this computer with your permissions. Only confirm if the kubeconfig comes from a trusted source. |
| `…validation.kubeconfigTextEmpty` | Füge eine Kubeconfig ein. | Paste a kubeconfig. |
| `…validation.kubeconfigTextTooLong` | Die Kubeconfig ist zu groß (höchstens {{max}} Zeichen). | The kubeconfig is too large (at most {{max}} characters). |
| `…validation.kubeconfigLocalPath` | Gib einen absoluten Pfad oder ~/ an. | Enter an absolute path or ~/. |
| `vault:address.clusterDirect` | Cluster · direkt | Cluster · direct |
| `main:dialogs.kubeconfig.title` | Kubeconfig wählen | Choose kubeconfig |
| `errors kubernetes.kubeconfigFileUnreadable` | Die Datei „{{path}}“ konnte nicht gelesen werden. | The file “{{path}}” could not be read. |
| `…loginPluginNeedsConsent` | Diese kubeconfig startet das Programm „{{command}}“. Bestätige es im Cluster-Eintrag unter Context. | This kubeconfig starts the program “{{command}}”. Confirm it in the cluster entry under Context. |
| `…loginPluginNotStarted` | Das Login-Programm „{{command}}“ konnte nicht gestartet werden. Prüfe den Pfad in der kubeconfig. | The login program “{{command}}” could not be started. Check its path in the kubeconfig. |
| `…authProviderUnsupported` | Diese kubeconfig nutzt einen auth-provider. Nutze stattdessen ein exec-Plugin oder ein Token. | This kubeconfig uses an auth-provider. Use an exec plugin or a token instead. |
| `…tlsVerifyRequired` | Diese kubeconfig schaltet die TLS-Prüfung ab (insecure-skip-tls-verify). Beim direkten Zugang wird das nicht unterstützt. | This kubeconfig turns off TLS verification (insecure-skip-tls-verify). Direct access does not support that. |
| `…proxyUnsupported` | Diese kubeconfig nutzt proxy-url. Das wird nicht unterstützt. | This kubeconfig uses proxy-url. That is not supported. |
| `…tokenFileUnsupported` | Diese kubeconfig liest ein Token aus einer Datei (token-file). Das wird nicht unterstützt. Trage das Token ein oder nutze ein exec-Plugin. | This kubeconfig reads a token from a file (token-file). That is not supported. Enter the token itself or use an exec plugin. |
| `…certFilesUnsupported` (geändert) | Die kubeconfig verweist auf Zertifikatsdateien. Nutze eine kubeconfig mit eingebetteten Zertifikaten (…-data) oder „Datei auf diesem Rechner“. | The kubeconfig refers to certificate files. Use a kubeconfig with embedded certificates (…-data) or “File on this computer”. |
| `…loginPluginUnsupported` (geändert) | Diese kubeconfig nutzt ein Login-Plugin, das hier nicht unterstützt wird. Login-Plugins laufen nur beim direkten Zugang. | This kubeconfig uses a login plugin that is not supported here. Login plugins only run with direct access. |

`…` = `connection:cluster.`. Der Key `validation.execConsentMissing` aus der Spec entfällt (K-13).

---

## Wellenplan (Dateien je Welle disjunkt)

Nach jeder Welle müssen `npm run typecheck` und `npx vitest run` grün sein. Umsetzer laufen nur ihre eigenen Tests, Typecheck und Gesamtlauf macht der Orchestrator nach der Welle.

| Welle | Task | Dateien (exklusiv) |
|---|---|---|
| 1 | **T1 Shared** | `src/shared/kubernetes.ts` (nur 3 Konstanten), `src/shared/vault/types.ts`, `src/shared/vault/connections.ts`, `src/shared/vault/connections.test.ts`, `src/shared/vault/schema.ts`, `src/shared/vault/schema.test.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/shared/locales/de-DE/errors/kubernetes.json`, `src/shared/locales/en-US/errors/kubernetes.json` |
| 1 | **T2 Main-Kern** | `src/main/kubernetes/kubeconfig.ts`, `kubeconfig.test.ts`, `direct.ts` (neu), `direct.test.ts` (neu), `client-api.ts`, `client-api.test.ts`, `src/main/ai/secret-mask.ts`, `src/main/ai/secret-mask.test.ts` |
| 2 | **T4 Main-Session** | `src/main/kubernetes/access.ts`, `access.test.ts`, `session.ts`, `session.test.ts`, `ipc.ts`, `src/shared/kubernetes.ts`, `src/shared/kubernetes-schema.ts`, `src/shared/kubernetes-schema.test.ts`, `src/shared/locales/{de-DE,en-US}/main.json` |
| 2 | **T5 Renderer-Logik** | `src/renderer/src/connection-form.ts`, `connection-form.test.ts`, `cluster-form.ts`, `cluster-form.test.ts`, `connection-labels.ts`, `connection-labels.test.ts`, `cluster-bar.test.ts`, `components/VaultTree.tsx`, `src/shared/locales/{de-DE,en-US}/connection.json`, `src/shared/locales/{de-DE,en-US}/vault.json` |
| 2 | **T6 Renderer-Form** | `src/renderer/src/components/ClusterForm.tsx` |
| 2 | **T3 Fakes** | `.claude/skills/run-app/kube-fake.mjs`, `.claude/skills/run-app/fakes.test.mjs` |
| 3 | **T7 run-app** | `.claude/skills/run-app/demo-setup.mjs`, `screens.mjs`, `SKILL.md` |
| 3 | **T8 Doku** | `docs/handbuch.md`, `docs/manual.md`, `README.md` |

Warum es grün bleibt:
- **Welle 1:**
  - Die Union mit `inline`/`file` kompiliert im Bestand (`readKubeconfig` fällt in den `auto`-Zweig, `Object.assign` in `connection-form.ts:114` prüft nicht).
  - `direct.ts` liefert `DirectAccess` und braucht `ClusterAccess` noch nicht.
  - Jeder neue Fehler-Key wird in Welle 1 von T2 genutzt: `kubeconfigFileUnreadable` in direct/client-api, `loginPluginNotStarted` in client-api/kubeconfig, die übrigen in kubeconfig.
  - `kubeSelectConfigFile` ist additiv.
- **Welle 2:** Jeder neue UI-Key wird in derselben Welle genutzt (T5/T6/T4).

Abhängigkeiten:
- T4, T5, T6 und T3 brauchen T1 und T2.
- T6 baut gegen den Feldvertrag oben (T5) und gegen `KubeProbeRequest` (T4).
- T7 braucht alles aus Welle 2.
- T8 braucht nichts außer diesem Anhang.
- Kein Task fasst `package.json`, `package-lock.json`, `CHANGELOG*` oder `version` an (D-1).

---

## Pflichtpunkte je Task

### T1 Shared (Welle 1)
1. Vertrag „Shared“ wörtlich: Konstanten in `src/shared/kubernetes.ts` (B-4). `schema.ts` importiert sie von `'../kubernetes'` und `isDirectKubeconfig` von `'./connections'`.
2. `.refine` am `KubernetesConnectionNodeSchema` (in der Union, wie AiCli). `accessHosts` nur `.max(8)`.
3. `redactSecrets` leert `inline.text` und lässt `execConsent` weg (B-2).
4. IPC-Kanal und Preload `kubeSelectConfigFile` (K-19).
5. Fehler-Locales (de + en): 7 neue Keys und 2 geänderte Texte laut Tabelle. Keine Plural-Keys in `errors`.
6. Tests in `schema.test.ts`:
   - Gültig: inline, file (`~/.kube/config`, `~\.kube\config`, `C:\u\.kube\config`, `/home/u/.kube/config`).
   - Ungültig:
     - inline mit Hosts
     - auto ohne Hosts
     - file mit Hosts
     - Text > 65 536 Zeichen
     - Text mit `\0`
     - `execConsent` > 4096 Zeichen oder mit Zeilenumbruch
     - Pfade `\\?\x`, `\\server\share\c`, `//server/c`, `rel/c`
   - Im Bestand bleibt `accessHosts: []` bei auto ungültig.
7. Test in `connections.test.ts`: Redaktion von inline, file bleibt unverändert, `JSON.stringify` enthält den Token nicht.

### T2 Main-Kern (Welle 1)
1. B-1 vollständig: `load()` mit Scan per js-yaml, alle Parse-Pfade darüber, Resolve-Test für js-yaml.
2. Policy-Tabelle samt Reihenfolge, K-5, K-6, K-7, K-8, K-9, K-17. `build(port)` verhält sich wie bisher, die bestehenden Tests bleiben unverändert grün.
3. `listContexts.execCommands` je Context, dessen User `exec` hat (`execCommandLine`).
4. `kubeconfigSecrets` (K-20).
5. `direct.ts` laut Vertrag, K-1, K-2, K-4, kein `fs.watch`.
6. `client-api.ts` K-10.
7. `secret-mask.ts`: `if (node.protocol === 'kubernetes' && node.kubeconfig.source === 'inline') for (const value of kubeconfigSecrets(node.kubeconfig.text)) add(value);`
8. Tests:
   - `kubeconfig.test.ts`:
     - Policy-Matrix: exec bei ssh, bei inline ohne, mit falscher und mit richtiger Freigabe, bei file. auth-provider (auch `name: exec`) überall. Bei file Zertifikatsdateien mit relativem `client-key` aus einem Temp-Ordner; nach `build(null)` ist `keyFile` absolut. skip-tls und proxy-url bei inline/file abgelehnt, bei ssh durchgereicht.
     - token-file (B-1).
     - Datei plus `-data` bei inline: der gebaute User hat kein `keyFile`.
     - `build(null)`: `server` und `tlsServerName` unverändert, bzw. `undefined`.
     - Relativer Exec-Befehl: bei file aufgelöst, bei inline `loginPluginNotStarted`.
     - Eindeutigkeit von `execCommandLine`: `["a b"]` ≠ `["a","b"]`, env-Reihenfolge, `=` im Wert und im Befehl.
     - `execFn` ersetzt.
     - Keine Secrets in Fehlermeldungen, auch nicht bei inline und nicht in `loginPluginNeedsConsent` (env-Wert taucht nicht auf).
     - `JSON.stringify(listContexts(text))` enthält weder Token noch `-data`-Werte.
   - `direct.test.ts` (nur injiziertes `LocalFiles`, injizierter `home`, kein echtes Home):
     - `~/` und `~\` werden aufgelöst.
     - ENOENT → `kubeconfigFileUnreadable { path }`.
     - Kein reguläres File oder > 1 MiB → abgelehnt ohne `readFile`.
     - UNC → abgelehnt ohne `stat`.
     - inline liefert Text und Policy.
   - `client-api.test.ts`: ENOENT von `open` (auch als `cause`) bzw. von `spawn` liefert die beiden Codes.
   - `secret-mask.test.ts`: Token und id-token einer inline-kubeconfig werden zu `[SECRET_n]`. file und unlesbarer Text liefern nichts.

### T4 Main-Session (Welle 2)
1. Vertrag „Main-Session“ wörtlich. `ClusterAccess` bekommt `policy?` (K-2).
2. `session.ts` nur die genannten Stellen. `readOnly`, `action`, `openTerminal` und die Bestätigungen bleiben unberührt (D-8). K-16.
3. `ipc.ts`: Weiche, K-18, Probe nach K-11, Dateidialog. `main.json` (de + en) `dialogs.kubeconfig.title`.
4. Tests:
   - `session.test.ts`:
     - Direkte Sitzung: `openTunnel` wird nie aufgerufen, `status.host` fehlt, `createApi` bekommt eine Config mit dem Original-`server`.
     - Altname-Retry ohne Tunnel.
     - Health-Tick ohne Host: kein `reconnecting`.
     - `dispose` und `teardownLive` ohne Host werfen nicht.
     - Eine Policy aus `access.policy` erreicht `parseKubeconfig`: inline-Exec ohne Freigabe → Status `error` mit `kubernetes.loginPluginNeedsConsent`.
   - `kubernetes-schema.test.ts`: Probe-Union. Zusätzliche Keys, UNC- und Device-Pfade sowie Text > Maximum werden abgelehnt.
   - `access.test.ts` nur anpassen, falls der Typ es verlangt.

### T5 Renderer-Logik (Welle 2)
1. `ConnectionFields` laut Vertrag. Kein `access` (K-12). Standardwerte nach D-3.
2. `fieldsFromConnection` und `connectionFromFields` (Kubernetes):
   - Hosts nur bei SSH Pflicht, bei Direkt wird `accessHosts: []` gespeichert.
   - inline: `kubeconfigTextEmpty`/`kubeconfigTextTooLong` auf Feld `kubeconfigText`. Der Text wird unverändert gespeichert. `execConsent` nur, wenn nicht leer.
   - file: leerer Pfad → bestehendes `validation.kubeconfigEmpty`. Regex oder Steuerzeichen → `kubeconfigLocalPath` auf Feld `kubeconfigPath`. Gespeichert wird der getrimmte Pfad.
   - path/auto wie heute.
3. `validateCluster`: Host-Prüfungen nur bei `!isDirectKubeconfig`. `emptyCluster` und `newClusterFromSsh` bleiben `auto`.
4. `connection-labels.ts`: `clusterDirect`. `VaultTree.tsx`: Menüeintrag „Zugangs-Host per SSH öffnen“ nur bei `!isDirectKubeconfig(node.kubeconfig)`.
5. Locales `connection.json`/`vault.json` (de + en) laut Tabelle, alle Keys, auch die, die nur T6 nutzt.
6. Tests:
   - Rundreise direct/inline (mit und ohne Freigabe) und direct/file.
   - Leerer und zu langer Text → Feldfehler.
   - UNC-Pfad → Feldfehler.
   - Direkt mit stehengebliebenen `accessHosts` speichert `[]`.
   - Bestehende Fixtures nach K-22.
   - `validateCluster`: Direkt ohne Hosts → `null`, SSH ohne Hosts → Fehler.
   - Adresszeile direkt.
   - `cluster-bar.test.ts`: `ready` ohne `host` → `live`.

### T6 Renderer-Form (Welle 2)
1. Reihenfolge nach Spec §5.2 mit K-12, K-13, K-14:
   - Radio „Zugang“ (`name=${idPrefix}-access`) mit Hinweis unter „Direkt“.
   - Bei SSH die heutigen zwei Fieldsets, unverändert.
   - Bei Direkt das Fieldset „Kubeconfig“ (`legend` = bestehender Key `kubeconfig.legend`) mit den Radios inline/file (`name=${idPrefix}-kubeconfig`).
2. inline:
   - Ist `kubeconfigText` leer oder ist `replacing` gesetzt, erscheint `<textarea id={`${idPrefix}-kubeconfigText`} rows={8} spellCheck={false} autoComplete="off">` mit dem Platzhalter `'apiVersion: v1\nkind: Config\n…'`, Hinweis, `aria-invalid`/`aria-describedby` und `fieldError('kubeconfigText')`.
   - Sonst eine `editor-hint`-Zeile `stored` (`count = text.length`) und der Knopf „Ersetzen“: `replacing = true`, `{ kubeconfigText: '', execConsent: '' }`.
3. file:
   - Eingabe `id=${idPrefix}-kubeconfigPath`, Platzhalter `~/.kube/config`, als `editor-input-group` mit Knopf `pickFile`.
   - Der Knopf ruft `kubeSelectConfigFile()`. Bei Erfolg `{ kubeconfigPath }`, bei Fehler eine `field-error`-Zeile mit `pickFailed`.
   - Dazu Hinweis und `fieldError('kubeconfigPath')`.
4. „Contexts lesen“:
   - Aktiv bei SSH mit `firstHost`, bei inline mit Text und bei file mit Pfad.
   - Anfrage `{ connectionId } | { text } | { path: trimmed }`.
   - Der lokale Zustand hält `contexts`, `currentContext`, `execCommands`.
   - Im Direkt-Modus wird `currentContext` bei leerem `context` eingetragen.
   - Der Reset-Effekt hängt an `[firstHost, kubeconfigSource, kubeconfigText, kubeconfigPath]`.
5. Freigabe nur bei inline:
   - `command = execCommands[context.trim() || currentContext || ''] ?? (fields.execConsent || undefined)`.
   - Checkbox `id=${idPrefix}-execConsent`, `checked = fields.execConsent === command`, Text `context.execConsent { command }` und Hinweis `execHint`.
   - Eine Änderung am Context-Feld setzt `execConsent: ''`.
6. Nur vorhandene Klassen, keine neuen CSS-Werte, keine Bewegung, alle Texte über `t()` und volle Key-Literale.

### T3 Fakes (Welle 2)
1. `kube-fake.mjs`:
   - `export const KUBE_DIRECT_FILE = 'kubeconfig-direct.yaml'`.
   - `startKubeFake` gibt zusätzlich `directKubeconfig` und `directFile` zurück.
   - `directKubeconfig`: Context/Cluster `direct`, `server: https://127.0.0.1:<tatsächlicher Port>`, `tls-server-name: k8s-cp1`, dieselbe CA-Data, Token `KUBE_TOKEN`, Namespace `shop`.
   - Die Datei wird nach `path.join(dir, KUBE_DIRECT_FILE)` geschrieben (Run-Dir).
2. `fakes.test.mjs` (nur gegen die Fakes):
   - `openDirect` inline → `parseKubeconfig(text, undefined, access.policy)` → `createKubeApi(parsed.build(null)).list('nodes', null)` liefert Knoten.
   - Dasselbe mit `file` auf `directFile`.
   - Exec-End-to-end: kubeconfig als JSON-Text, User `exec: { command: process.execPath, args: ['-e', <script, das ein ExecCredential mit KUBE_TOKEN ausgibt>] }`.
     - Ohne Freigabe → `loginPluginNeedsConsent`.
     - Mit `execConsent = execCommandLine(user)` → `list('nodes')` klappt. Prüft auch das Quoting bei Leerzeichen im Node-Pfad.
   - Der Request-Log enthält keine schreibenden Verben.

### T7 run-app (Welle 3)
1. `demo-setup.mjs`: neuer Schritt `addDirectCluster()`.
   - Übersprungen, wenn `RUN_DIR/kube/kubeconfig-direct.yaml` fehlt oder `lokal-k8s` schon existiert.
   - Ablauf: Neue Verbindung → Kubernetes-Cluster → (Direkt ist vorgewählt) → Radio „Datei auf diesem Rechner“ → `input[id$="-kubeconfigPath"]` mit dem **absoluten** Pfad füllen → Name `lokal-k8s` → „Contexts lesen“ → warten, bis Context `direct` gesetzt ist → speichern.
   - K-21: kein `~/`, kein Dateidialog.
2. `screens.mjs` Szene `kube-direct` (nicht in `--readme`):
   - Bearbeiten-Formular von `lokal-k8s` → Shot `kube-direct-form.png`.
   - Danach den Tab öffnen und warten, bis `.kube-view:not([hidden]) .kube-status` den Text genau `bereit` hat und mindestens 5 Tabellenzeilen da sind → Shot `kube-direct.png` → Tabs schließen.
   - Die Szene `kubernetes` bleibt grün („bereit über web-01“).
3. `SKILL.md`: Szene, Shots und den Hinweis aus K-21 nennen. Screenshots ansehen.

### T8 Doku (Welle 3)
1. `docs/handbuch.md`, Abschnitt Kubernetes (`:519`), und `docs/manual.md` (`:498`, englisch). Unterabschnitt „Direkter Zugang“:
   - Eingefügt oder Datei.
   - Die Datei wird bei jedem Verbinden gelesen (Tab schließen und öffnen).
   - Login-Programme: inline nur mit Freigabe, Datei ohne. Kein TTY, 60-s-Limit. Unter Windows starten `.cmd`/`.bat` nicht, ein `.exe` oder der volle Pfad geht. Relative Pfade gelten relativ zum Ordner der Datei.
   - Nicht unterstützt: token-file, auth-provider, proxy-url, insecure-skip-tls-verify, UNC-Pfade.
   - Kein automatisches Wiederverbinden.
   - Ältere Shellherd-Versionen öffnen einen Vault mit Direkt-Eintrag nicht.
2. `README.md`:
   - Zeile 40: „… through an existing SSH connection or directly from a pasted or local kubeconfig …“.
   - Zeile 155: Proxmox läuft weiter über SSH; Kubernetes geht auch direkt.
   - Ein Punkt je Feature, von Hand geschrieben.
3. Kein CHANGELOG, kein Versionssprung (D-1). Der CHANGELOG-Entwurf de/en geht an den Orchestrator für den PR-Text.

---

## Akzeptierte Restrisiken (Minor)

1. Ein Renderer kann über `k8s:probe { path }` prüfen, ob eine lokale Datei existiert bzw. eine kubeconfig ist. Er hält ohnehin den entsperrten Vault, Inhalte gehen nicht zurück.
2. Ein Exec-Befehl als reiner Programmname wird unter Windows von libuv zuerst im Arbeitsverzeichnis gesucht. Das ist das Installationsverzeichnis, kein Nutzerordner.
3. env-Werte von Login-Plugins stehen im Klartext in der Freigabe-Zeile (Formular, Vault). Das ist gewollt nach D-2/D-4.
4. `js-yaml` ist eine transitive Abhängigkeit ohne Eintrag in `package.json`. Ein Test hält sie an dieselbe Datei wie bei client-node gebunden; sie wird beim nächsten Abhängigkeits-Update ausdrücklich aufgenommen.
