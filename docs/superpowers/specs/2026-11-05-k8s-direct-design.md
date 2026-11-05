# k8s-direct – Design (Cluster ohne SSH)

> Grundlage: Konzept-Recherche (unten, übernommen). **Die Rulings in diesem Kasten gehen allem Folgenden vor.**
>
> - **D-1 Kein Versionssprung, kein CHANGELOG-Eintrag.** `AGENTS.md` erlaubt Versionen/Tags nur auf ausdrückliche Anfrage; ein CHANGELOG-Abschnitt ohne Bump bricht `version.test.ts`. Doku-Task schreibt nur Handbuch (de) + `docs/manual.md` (en, falls Kubernetes-Abschnitt vorhanden) + README-Punkt. Der CHANGELOG-Text (de/en) steht im PR-Text für die Release-Vorbereitung des Nutzers.
> - **D-2 Exec-Freigabe umfasst `env`.** `execCommandLine(user)` liefert `NAME=value … command arg …` (env-Einträge in Reihenfolge der kubeconfig, dann Befehl und Args, getrennt durch ein Leerzeichen). Damit ist Risiko 10.4 geschlossen; die Freigabe-Checkbox zeigt genau diese Zeile.
> - **D-3 Neue eigenständige Cluster starten mit „Direkt“ / „Eingefügt“.** Das ist der Wunsch des Nutzers (kein SSH-Eintrag vorab). „Als Kubernetes-Cluster einrichten“ aus einer SSH-Verbindung (`App.tsx` `setupCluster`) bleibt SSH/auto. Bestehende Einträge behalten ihre Zugangsart.
> - **D-4 Freigabe wandert mit dem Vault.** `execConsent` liegt im verschlüsselten Vault wie Startbefehle, die ebenfalls Befehle ausführen. Der Vault ist Vertrauensgrenze; ein fremder Vault ist so vertrauenswürdig wie seine Passwörter und Startbefehle.
> - **D-5 `file` braucht keine Freigabe** (eigene Datei, gleiches Verhalten wie kubectl); `auth-provider`, `proxy-url`, `insecure-skip-tls-verify` sind im Direkt-Modus abgelehnt (Tabelle 3.3).
> - **D-6 `refine` am Kubernetes-Schema** wie bei `AiCliConnectionNodeSchema` (steht ebenfalls in der Union). Fällt der Typecheck, Prüfung in `connectionFromFields`, `validateCluster` und Main.
> - **D-7 Referenzierte Zertifikatsdateien bei `file`:** `ENOENT`/`EACCES` aus `client-api.ts` `toApiError` werden auf `kubernetes.kubeconfigFileUnreadable` (ohne `path`-Parameter-Inhalt aus der Datei, nur der Pfad aus dem Fehler) abgebildet; ist das mehr als ein paar Zeilen, bleibt es beim generischen Fehler (Minor).
> - **D-8 Nur lesend:** kein neuer API-Aufruf, keine neue Aktion (R-0).

Branch `claude/feature/k8s-direct`, Basis 0.31.0. Ziel: Ein Cluster-Eintrag lässt sich **ohne SSH-Verbindung** anlegen. Die kubeconfig kommt entweder **eingefügt** (verschlüsselt im Vault, wandert mit) oder aus einer **Datei auf diesem Rechner** (z. B. `~/.kube/config`). Der bisherige Weg „Über SSH“ bleibt unverändert, bestehende Vaults bleiben gültig.

**Bindendes Nutzer-Ruling R-0: Nur lesende Analyse, nie schreibend.** Dieses Paket fügt **keinen** API-Aufruf hinzu. Direkt-Zugang nutzt dieselben Verben wie der Tunnel (list, watch, get, pods/log, pods/portforward, selfsubjectrulesreviews). `readOnly`-Gate und Bestätigungen in `session.ts` bleiben unberührt.

Die Umsetzer sind Sonnet-Modelle. Signaturen, Codes, Texte und Regeln unten sind verbindlich.

---

## 0. Bestand (mit Fundstellen)

### 0.1 Vault-Modell
- `KubernetesConnectionNode` (`src/shared/vault/types.ts:141-157`): `accessHosts: string[]` (geordnete SSH-IDs), `kubeconfig: { source: 'auto' } | { source: 'path'; path }` (Pfad **auf dem Host**), `context?`, `namespace?`, `production`, `readOnly`, `argoUrl?`, `harborUrl?`.
- Schema (`src/shared/vault/schema.ts:151-165`): `accessHosts: z.array(…).min(1).max(8)`; `kubeconfig` als `discriminatedUnion('source')`. Objekte bewusst nicht `.strict()` (`schema.ts:61`).
- Secrets liegen heute als Klartext **innerhalb** des AES-256-GCM-verschlüsselten Payloads (`authentication.password`, `AiProvider.apiKey`, `schema.ts:27-30`, `:261`). Eine eingefügte kubeconfig passt in dieses Muster.
- Tests: `src/shared/vault/schema.test.ts:44-49` (Cluster gültig, `accessHosts: []` ungültig).

### 0.2 Main-Prozess, Sitzungsablauf
- `KubeSessionDependencies` (`src/main/kubernetes/session.ts:46-56`): `openAccess(cluster, onTry) → ClusterAccess`, `openTunnel(access, target) → Tunnel`, `createApi(config)`.
- `ClusterAccess` (`access.ts:31`): `{ host: RemoteHost; connection: SshConnectionNode; kubeconfig: string; source: string }`. `RemoteHost` (`src/main/containers/runner.ts:23-30`): `run`, `forward`, `close`, `closed`.
- `Session.establish()` (`session.ts:262-291`): `openAccess` → `hostName = access.connection.name` → `parseKubeconfig(access.kubeconfig, cluster.context)` → `openTunnel(access, parsed.server)` → `probe(parsed, tunnel.port)` → `Overview` → Watcher.
- `probe()` (`:294-305`): `parsed.build(port)` → `list('nodes')`; bei `ERR_TLS_CERT_ALTNAME_INVALID` ein Retry mit `tlsServerName = 'kubernetes'`.
- Health (`:327-334`): Reconnect **nur**, wenn `access.host.closed`. Watcher-Fehler rufen `checkHealth()` (`:418`), lösen aber ohne geschlossenen Host nichts aus. Watcher retrien selbst (`watch.ts:8-16`: 1 s, 2 s, 5 s, dann 5 s; nach 3 Fehlern „Live-Aktualisierung gestört“, 401/403 alle 30 s).
- `teardownLive()` (`:369-384`): `tunnel.close()`, `access.host.close()`.
- `status()` (`:496-515`): `host` nur gesetzt, wenn `hostName` bekannt. Der Renderer behandelt fehlendes `host` schon: `ClusterView.tsx:370` zeigt dann `kubernetes:status.ready` („bereit“) statt `readyVia`; `cluster-bar.ts:39-41` zeigt „Live“ ohne Host. `recovered`/`hostSilent` brauchen `host`, treten im Direkt-Modus aber nie auf (kein `reconnecting`).
- `kubeconfig.ts:36-64` `parseKubeconfig(text, contextName?)`: lehnt `exec`/`authProvider` ab (`loginPluginUnsupported`, `:44`), lehnt `caFile`/`certFile`/`keyFile` ohne `…Data` ab (`certFilesUnsupported`, `:45-47`), verlangt `https:` (`:50`). `build(localPort, tlsServerName?)` schreibt `server` auf `https://127.0.0.1:<port>` um (`:55-62`). `listContexts(text)` (`:29-34`) liefert Namen, current-context, Cluster-Name. `insecure-skip-tls-verify` wird **nicht** geprüft; client-node setzt dann `rejectUnauthorized=false` (`node_modules/@kubernetes/client-node/dist/config.js:587-589`).
- `access.ts:88-118` `openAccess`: iteriert `accessHosts`, `openRemote`, `readKubeconfig` (auto-Script/sudo/Pfad).
- `ipc.ts:35-52` verdrahtet die Deps; `k8s:probe` (`:119-132`) nimmt `connectionId`, öffnet SSH, gibt `KubeProbeResult` ohne Secrets zurück.
- `client-api.ts:453-607` `createKubeApi(config)` nutzt nur `KubeConfig` (`makeApiClient`, `Watch`, `Metrics`, `Exec`, `applyToHTTPSOptions` `:361`). **Nichts** darin kennt den Tunnel. Direkt-Zugang braucht hier keine Änderung.
- `@kubernetes/client-node` 2.0.0 (`package.json:39`): Authenticator-Kette `AzureAuth, GoogleCloudPlatformAuth, ExecAuth, FileAuth, OpenIDConnectAuth` (`config.js:90-96`). `ExecAuth` startet `child_process.spawn(exec.command, exec.args, { env: process.env + exec.env })` (`exec_auth.js:72-83`), sammelt stdout/stderr, **kein TTY** – interaktive Plugins (Device-Code auf stderr) laufen blind. `loadFromFile` macht `certificate-authority`/`client-certificate`/`client-key` relativ zum Dateiordner absolut (`config.js:148-152`, `makePathsAbsolute`). `proxy-url` erzeugt Socks-/HTTP-Proxy-Agents (`config.js:485-501`).

### 0.3 Renderer
- `ConnectionFields` (`src/renderer/src/connection-form.ts:41-51`): `accessHosts`, `kubeconfigSource: 'auto' | 'path'`, `kubeconfigPath`, `context`, `namespace`, `production`, `readOnly`, `argoUrl`, `harborUrl`. Abbildung Knoten → Felder `:114-120`, Felder → Knoten `:202-223` (wirft `noAccessMessage()` bei leeren `accessHosts`, `:204`).
- `ClusterForm.tsx:24-147`: Fieldset „Zugang über SSH“ (Liste, ↑↓, Entfernen, Hinzufügen), Fieldset „Kubeconfig“ (auto/Pfad auf dem Host), Context mit „Contexts lesen“ (`kubeProbe({ connectionId: firstHost })`, `:44-55`), Namespace, Weboberflächen, Produktion, Nur lesen.
- `cluster-form.ts`: `emptyCluster` (`:41-46`, `accessHosts: []`), `validateCluster` (`:56-68`, verlangt Zugangs-Hosts), `firstActiveAccessHost` (`:71-78`), `kubeconfigPathError` (`:49-53`, `/` oder `~/`).
- `ConnectionForm.tsx:111-112` ruft `validateCluster` beim Speichern; `:169` bettet `ClusterForm` ein. Textareas gibt es schon (`:217` Startbefehle, `:232` Kommentar).
- `connection-labels.ts:48`: Adresse „Cluster · {{count}} Zugänge“ (`vault:address.cluster_*`).
- `VaultTree.tsx:159-162`: Kontextmenü „Zugangs-Host per SSH öffnen“ mit Hinweis „Kein aktiver Zugangs-Host.“ – für Direkt-Einträge sinnlos.
- `App.tsx:725-741` `setupCluster(sshId)`: Einrichtung aus SSH-Verbindung – unverändert.
- Texte: `src/shared/locales/*/connection.json:193-241`, `errors/kubernetes.json`, `vault.json:50-51,72-73`, `kubernetes.json:221-226,305-316`.

### 0.4 KI-Maskierung
- `vaultLiterals(vault)` (`src/main/ai/secret-mask.ts:288-309`) sammelt SSH/SFTP-Passwörter, Passphrasen, RDP-Passwörter, API-Keys. Kubeconfig-Token kämen nicht vor. Base64 eines PEM-Schlüssels (`client-key-data`) fängt Regel `LS0tLS1CRUdJTi…` (`:34`) schon; ein Bearer-Token ohne bekanntes Präfix nicht.

### 0.5 run-app
- `kube-fake.mjs:52-261`: HTTPS auf `127.0.0.1:9334`, Zertifikat `CN=k8s-cp1`, `subjectAltName=DNS:k8s-cp1` (`:59-60`), Token `synthetic-kube-token`. Rückgabe `kubeconfig` mit `server: https://k8s-cp1:6443` (`:241-246`) – nur über den SSH-Fake nutzbar (`sshd.mjs:78`, Forward auf `kubePort`).
- `demo-setup.mjs:95-108` legt `prod-k8s` über „Als Kubernetes-Cluster einrichten“ an. `screens.mjs:283-294` wartet auf „bereit über web-01“.
- `fakes.test.mjs:97-110` ruft `readKubeconfig`/`parseKubeconfig`/`openTunnel`/`createKubeApi` direkt gegen die Fakes.

### 0.6 Lücken
1. Kein Datenmodell für eine kubeconfig außerhalb eines SSH-Hosts.
2. `Session.establish` setzt Host + Tunnel voraus; `ClusterAccess` verlangt `host`/`connection`.
3. `parseKubeconfig` kennt nur eine Regel (SSH-Quelle); keine Freigabe für Exec-Plugins, keine Prüfung von `insecure-skip-tls-verify`, `proxy-url`.
4. `k8s:probe` liest nur über SSH.
5. Formular, Validierung, Adresszeile, Kontextmenü und Fakes nehmen `accessHosts.length ≥ 1` an.
6. KI-Maskierung kennt kubeconfig-Secrets nicht.

---

## 1. Empfehlung je Fläche

| Fläche | Empfehlung | Wert | Aufwand |
|---|---|---|---|
| Datenmodell | `kubeconfig.source` um `'inline'` und `'file'` erweitern; `accessHosts` darf bei diesen Quellen leer sein. Keine Migration. | ★★★ | Shared + Schema |
| Main: Direkt-Zugang | Neue Datei `direct.ts` liefert `ClusterAccess` ohne Host; `session.ts` macht Host/Tunnel optional. | ★★★ | kleine Main-Änderung |
| Main: Regeln je Quelle | `parseKubeconfig(text, context, policy)` mit Policy `ssh`/`inline`/`file`; Exec nur mit gespeicherter Freigabe (inline) oder frei (file). | ★★★ | kleine Main-Änderung |
| IPC Probe | `k8s:probe` nimmt `{ connectionId } \| { text } \| { path }`; Rückgabe bleibt ohne Secrets, plus Exec-Befehlszeilen je Context. Neuer Kanal `k8s:select-kubeconfig-file` (Dateidialog). | ★★★ | kleine Main-Änderung |
| Formular | Radio „Zugang: Über SSH / Direkt“; bei Direkt Radio „Eingefügt / Datei auf diesem Rechner“; Textarea bzw. Pfad + „Datei wählen…“; „Contexts lesen“ für alle Quellen; Freigabe-Checkbox für Login-Programm. | ★★★ | nur Renderer |
| KI-Maskierung | `vaultLiterals` nimmt Token/Passwort/Key-Data eingefügter kubeconfigs auf. | ★★ | kleine Main-Änderung |
| Adresszeile, Kontextmenü | „Cluster · direkt“; „Zugangs-Host per SSH öffnen“ nur bei SSH-Zugang. | ★★ | nur Renderer |
| run-app | Fake exportiert `directKubeconfig`; Demo-Vault bekommt `lokal-k8s` (Datei-Modus); Szene `kube-direct`. | ★★ | Skill-Dateien |
| Doku | Handbuch-Abschnitt, README-Satz (`:40`, `:155`), CHANGELOG. | ★★ | Doku |
| Datei-Überwachung (fs.watch) | nicht jetzt: Neu-Lesen bei jedem Verbinden reicht. | ★ | nicht jetzt |
| `insecure-skip-tls-verify` per Schalter erlauben | nicht jetzt; Direkt-Modus lehnt es ab. | ★ | nicht jetzt |
| `proxy-url`, `auth-provider` (oidc/gcp/azure), tokenFile | nicht jetzt; abgelehnt mit klarer Meldung. kubelogin per `exec` deckt OIDC ab. | ★ | nicht jetzt |
| Direkt-Eintrag aus `~/.kube/config` automatisch vorschlagen („Lokale Cluster importieren“) | nicht jetzt. | ★ | nicht jetzt |
| Session-Reconnect im Direkt-Modus (Backoff wie SSH) | nicht jetzt: Watcher retrien selbst; Status bleibt „Live“ mit Datenalter, Tabellen melden „Live-Aktualisierung gestört“. | ★ | nicht jetzt |

---

## 2. Datenmodell (verbindlich)

```ts
// src/shared/vault/types.ts
export type KubeconfigSource =
  | { source: 'auto' }                                   // on the SSH access host (unchanged)
  | { source: 'path'; path: string }                     // on the SSH access host (unchanged)
  /** Pasted text, stored inside the encrypted vault; travels with it. execConsent: the exact command line of the login plugin the user approved. */
  | { source: 'inline'; text: string; execConsent?: string }
  /** File on this computer, read again at every connect; `~/` means the home directory. */
  | { source: 'file'; path: string };

export interface KubernetesConnectionNode extends ConnectionBase {
  protocol: 'kubernetes';
  /** Ordered SSH connection ids for 'auto'/'path'; empty for 'inline'/'file'. */
  accessHosts: string[];
  kubeconfig: KubeconfigSource;
  // … rest unchanged
}

/** True for sources that need no SSH host. */
export function isDirectKubeconfig(source: KubeconfigSource): source is Extract<KubeconfigSource, { source: 'inline' | 'file' }> {
  return source.source === 'inline' || source.source === 'file';
}
```

`isDirectKubeconfig` lebt in `src/shared/vault/connections.ts` (dort stehen schon Protokoll-Helfer), damit Main und Renderer dieselbe Funktion nutzen.

```ts
// src/shared/vault/schema.ts
export const KUBECONFIG_TEXT_MAX = 65_536;
export const EXEC_CONSENT_MAX = 1024;
/** Drive path, UNC share, POSIX root or `~/`; never a device path. */
export const KUBECONFIG_LOCAL_PATH = /^(?:~\/|\/(?!\/)|[A-Za-z]:[\\/]|\\\\(?![?.](?:[\\/]|$)))/;
const noControl = (value: string) => !/[\0\r\n]/.test(value);

kubeconfig: z.discriminatedUnion('source', [
  z.object({ source: z.literal('auto') }),
  z.object({ source: z.literal('path'), path: z.string().min(1).max(1024).refine(noControl) }),
  z.object({ source: z.literal('inline'), text: z.string().min(1).max(KUBECONFIG_TEXT_MAX).refine(t => !t.includes('\0')),
    execConsent: z.string().min(1).max(EXEC_CONSENT_MAX).refine(noControl).optional() }),
  z.object({ source: z.literal('file'), path: z.string().min(1).max(32_767).regex(KUBECONFIG_LOCAL_PATH).refine(noControl) }),
]),
accessHosts: z.array(z.string().min(1).max(256)).max(8),
```
plus `.refine(node => isDirectKubeconfig(node.kubeconfig) ? node.accessHosts.length === 0 : node.accessHosts.length >= 1, { message: 'accessHosts', path: ['accessHosts'] })` am `KubernetesConnectionNodeSchema`. Achtung: `z.object(...).refine(...)` liefert `ZodEffects`; `ConnectionNodeSchema` ist eine `discriminatedUnion` und akzeptiert nur `ZodObject`. Deshalb `superRefine` **nicht** am Objekt, sondern die Regel in `VaultNodeSchema` bzw. als eigener Check in `connectionFromFields` und in `validateCluster` (Renderer) **und** in `KubeSessions.open`/`openTerminal` (Main: `kubernetes.noAccessHost` bei SSH-Quelle ohne Hosts, wie heute über `openAccess`). Gleiches Muster wie `AiCliConnectionNodeSchema.refine` (`schema.ts:146`) geht hier nicht, weil das Schema in der Union steht — der Umsetzer prüft, ob `AiCliConnectionNodeSchema` dort trotzdem funktioniert (es funktioniert, weil zod `ZodEffects` über `ZodObject` in `discriminatedUnion` seit 3.22 erlaubt; dann darf `.refine` auch hier stehen). **Ruling:** `.refine` am Kubernetes-Schema, Test in `schema.test.ts` sichert es.

- **Keine Migration.** Alte Einträge haben `auto`/`path` mit Hosts und bleiben gültig. Eine ältere Shellherd-Version öffnet einen Vault mit `inline`/`file` nicht (unbekannter Diskriminator) – das galt bei jeder neuen Verbindungsart (`kubernetes`, `aicli`) genauso. Hinweis im CHANGELOG.
- Größe: 64 KiB reichen für kubeconfigs mit eingebetteten Zertifikaten (typisch 6–12 KB).

---

## 3. Main-Prozess: Ablauf im Direkt-Modus

### 3.1 `src/main/kubernetes/direct.ts` (neu)
```ts
export const DIRECT_FILE_MAX_BYTES = 1_048_576;
/** `~/x` → <home>/x; everything else unchanged. */
export function expandHome(path: string, home = os.homedir()): string;
/** Reads the kubeconfig of a direct cluster: the stored text, or the file (read again at every call). */
export async function openDirect(cluster: KubernetesConnectionNode, readFile = fs.promises.readFile): Promise<ClusterAccess>;
```
- `inline` → `{ kubeconfig: text, source: 'inline' }`.
- `file` → liest `expandHome(path)`; Fehler `ENOENT`/`EACCES`/zu groß → `KubeInputError('kubernetes.kubeconfigFileUnreadable', { path })`. Es wird **genau diese Datei** gelesen, kein `$KUBECONFIG`, keine Suche.
- Kein `fs.watch`. Jeder `establish()` (erster Verbindungsaufbau; es gibt im Direkt-Modus keinen Session-Reconnect) liest neu. Ein Tab schließen und öffnen genügt für eine erneuerte Datei. Bei inline ohnehin Vault-Stand.

### 3.2 `access.ts`
```ts
export interface ClusterAccess {
  kubeconfig: string;
  source: string;
  /** SSH sources only. */
  host?: RemoteHost;
  connection?: SshConnectionNode;
}
```
`openAccess` unverändert (liefert `host`/`connection`).

### 3.3 `kubeconfig.ts`
```ts
export type KubeconfigPolicy =
  | { source: 'ssh' }                              // today's rules
  | { source: 'inline'; execConsent?: string }
  | { source: 'file' };

export function parseKubeconfig(text: string, contextName?: string, policy: KubeconfigPolicy = { source: 'ssh' }): ParsedKubeconfig;
/** `[command, ...args].join(' ')` of the user's exec section, or undefined. */
export function execCommandLine(user: User): string | undefined;
export function listContexts(text: string): { contexts: string[]; currentContext?: string; clusterName?: string; execCommands: Record<string, string> };
/** Secrets of every user in the text (token, password, client-key-data), for the AI masker; [] when unparsable. */
export function kubeconfigSecrets(text: string): string[];
```
`ParsedKubeconfig.build(localPort: number | null, tlsServerName?: string)`: bei `null` bleibt `server` wie in der kubeconfig; `tlsServerName` nur, wenn übergeben oder in der Config. Bestehende Aufrufe `build(port)` bleiben gültig.

**Regeln je Policy** (Fehlercodes neu in `errors/kubernetes.json`, de + en):

| Abschnitt | `ssh` (heute) | `inline` | `file` |
|---|---|---|---|
| `users[].exec` | ablehnen `loginPluginUnsupported` | nur wenn `policy.execConsent === execCommandLine(user)`, sonst `loginPluginNeedsConsent { command }` | erlaubt |
| `users[].auth-provider` (oidc, gcp, azure, tokenFile) | ablehnen `loginPluginUnsupported` | ablehnen `authProviderUnsupported` | ablehnen `authProviderUnsupported` |
| `certificate-authority` / `client-certificate` / `client-key` als Datei | ablehnen `certFilesUnsupported` | ablehnen `certFilesUnsupported` | erlaubt (Pfade sind lokal; `load()` nutzt `loadFromFile`, damit relative Pfade zum Ordner der Datei aufgelöst werden – minikube) |
| `server` nicht `https:` | ablehnen `httpsRequired` | gleich | gleich |
| `insecure-skip-tls-verify: true` | durchgereicht (unverändert, über Tunnel) | ablehnen `tlsVerifyRequired` | ablehnen `tlsVerifyRequired` |
| `proxy-url` | durchgereicht (unverändert) | ablehnen `proxyUnsupported` | ablehnen `proxyUnsupported` |
| `username`/`password`, `token`, `client-*-data`, `impersonate-user`, `tls-server-name` | erlaubt | erlaubt | erlaubt |

`load(text, policy)`: für `file` liest `openDirect` die Datei und `parseKubeconfig` bekommt zusätzlich `policy.dir` (Ordner der Datei) und ruft `config.loadFromString` + `makePathsAbsolute`-Äquivalent? client-node exportiert `makePathsAbsolute` nicht; stattdessen `loadFromFile(expandedPath)` direkt in `parseKubeconfig`, wenn `policy.source === 'file'` → Policy trägt `path` statt `dir`: `{ source: 'file'; path: string }`. `openDirect` liest die Datei dann nur zum Fehler-Check der Lesbarkeit und für `listContexts`; `parseKubeconfig` lädt per `loadFromFile`. **Ruling:** `{ source: 'file'; path }` in der Policy, `loadFromFile` in `load()`, damit relative Zertifikatspfade wie bei kubectl funktionieren. `text` wird für diese Quelle ignoriert (bleibt Parameter wegen Signatur).

Exec-Plugin mit Freigabe (`inline`) und bei `file`: `ExecAuth` nutzt `process.env`+`exec.env` und `spawn(command, args)` – PATH-Auflösung wie bei kubectl. Kein TTY: Plugins, die interaktiv Device-Codes ausgeben, scheitern mit `kubernetes.unauthorized` oder Timeout; Handbuch nennt das (kubelogin mit `--login azurecli` oder Token-Cache vorher per kubectl füllen).

### 3.4 `session.ts` (gezielt)
- `hostName`, `access`, `tunnel` optional nutzen: `this.hostName = access.connection?.name`; `teardownLive`: `access.host?.close()`.
- `establish()`:
  ```ts
  const policy = policyFor(cluster.kubeconfig);           // ssh | inline(+execConsent) | file(+path), in kubeconfig.ts
  const parsed = parseKubeconfig(access.kubeconfig, cluster.context, policy);
  const port = access.host ? (this.tunnel = await this.deps.openTunnel(access, parsed.server)).port : null;
  const api = await this.probe(parsed, port);
  ```
  `probe(parsed, port: number | null)` ruft `parsed.build(port)` / `build(port, 'kubernetes')`.
- `checkHealth()`: `if (this.access?.host?.closed) reconnect()` – im Direkt-Modus nie; Watcher und Overview retrien selbst. **Ruling:** kein Session-Backoff im Direkt-Modus (Stufe 1). Kosten, falls falsch: nach einem Netzwechsel bleibt der Tab bei „Live“ mit altem Datenalter, Tabellen zeigen „Live-Aktualisierung gestört“ bis die Watcher wieder greifen.
- `KubeSessionDependencies.openAccess` behält die Signatur; `ipc.ts` entscheidet:
  ```ts
  openAccess: (cluster, onTry) => isDirectKubeconfig(cluster.kubeconfig) ? openDirect(cluster) : openAccess(cluster, { getConnection, openRemote, sudoRejections }, onTry),
  ```
  `openTunnel` wird nur mit `access.host` aufgerufen (Session prüft).

### 3.5 `ipc.ts`
- `k8s:probe`:
  ```ts
  export const KubeProbeRequestSchema = z.union([
    z.object({ connectionId: z.string().min(1).max(256) }).strict(),
    z.object({ text: z.string().min(1).max(KUBECONFIG_TEXT_MAX) }).strict(),
    z.object({ path: z.string().min(1).max(32_767).regex(KUBECONFIG_LOCAL_PATH) }).strict(),
  ]);
  export interface KubeProbeResult { source: string; contexts: string[]; currentContext?: string; clusterName?: string; execCommands?: Record<string, string> }
  ```
  `text` → `listContexts(text)`; `path` → `openDirect({ kubeconfig: { source: 'file', path } })` dann `listContexts`. Antwort enthält nie Token/Zertifikate (Test: `JSON.stringify(result)` enthält weder Token noch `-data`-Werte).
- Neuer Kanal `IPC_CHANNELS.kubeSelectConfigFile = 'k8s:select-config-file'` → `SelectVaultFileResult`, Muster `vault/ipc.ts:102-108`, Titel `mainT('dialogs.kubeconfig.title')` („Kubeconfig wählen“). Preload `kubeSelectConfigFile`, `DesktopApi` in `src/shared/ipc.ts`.

### 3.6 KI-Maskierung (`secret-mask.ts:296-305`)
```ts
if (node.protocol === 'kubernetes' && node.kubeconfig.source === 'inline') for (const value of kubeconfigSecrets(node.kubeconfig.text)) add(value);
```
`kubeconfigSecrets` liegt in `kubernetes/kubeconfig.ts` (parst mit `KubeConfig.loadFromString`, gibt `token`, `password`, `keyData` jedes Users). Bei `file` nichts: die Datei liegt nicht im Vault; Terminal-Ausgaben, die den Token zeigen, fängt der Regelsatz (JWT, Bearer, PEM) wie bisher.

---

## 4. Sicherheitsregeln (verbindlich)

1. **Kein neues Verb.** Direkt-Zugang spricht dieselben Endpunkte wie der Tunnel. `readOnly` gilt unverändert (`session.ts:604-606`, `:747`).
2. **Kubeconfig-Inhalt bleibt in Main.** `k8s:probe` liefert nur Context-Namen, current-context, Cluster-Name und Exec-Befehlszeilen. Der Renderer hält den eingefügten Text nur als Formularfeld (wie heute SSH-Passwörter in `fields.password`, `connection-form.ts:97`); nach dem Speichern zeigt das Formular ihn nicht mehr an (siehe 5.2).
3. **Nichts auf Platte.** Main schreibt keine kubeconfig; `file` liest ausschließlich den eingetragenen Pfad (plus die darin referenzierten Zertifikatsdateien, wie kubectl). Kein `$KUBECONFIG`, kein Suchen.
4. **Login-Programme:** `inline` nur mit `execConsent`, der die vollständige Befehlszeile wörtlich nennt und in der Form vom Nutzer gesetzt wurde; Abweichung (Context gewechselt, Text ersetzt) → `kubernetes.loginPluginNeedsConsent` mit Programmname. `file` ohne Freigabe (eigene Datei, gleiches Verhalten wie kubectl). SSH-Quellen weiter ablehnen. `auth-provider` überall ablehnen.
5. **TLS:** `https` Pflicht; `insecure-skip-tls-verify` im Direkt-Modus abgelehnt; `tls-server-name`-Fallback `kubernetes` wie heute. `proxy-url` abgelehnt.
6. **Vault:** Text nur innerhalb des verschlüsselten Payloads; Größe begrenzt; `\0` abgelehnt.
7. **Fehlertexte** enthalten nie Config-Inhalt (Test `kubeconfig.test.ts:75-77` erweitern um `inline`-Fehler).
8. **Masker** kennt Token/Passwort/Key eingefügter kubeconfigs.
9. **Kein Logging** des Textes, auch nicht in `detail` von `AppError`.

Was ausdrücklich **nicht** getan wird: kein Schreiben in `~/.kube/config`, kein automatischer Import aller Contexts, kein Watch der Datei, kein Proxy, kein OIDC-Refresh in Shellherd, kein Schalter zum Abschalten der TLS-Prüfung, keine neuen Aktionen.

---

## 5. UI

### 5.1 Felder (`connection-form.ts`)
```ts
/** Kubernetes only. */
access: 'ssh' | 'direct';
kubeconfigSource: 'auto' | 'path' | 'inline' | 'file';
kubeconfigPath: string;    // 'path': on the host; 'file': on this computer
kubeconfigText: string;    // 'inline'
execConsent: string;       // '' = none
```
- `fieldsFromConnection`: `access = isDirectKubeconfig(k) ? 'direct' : 'ssh'`, Quelle/Pfad/Text/Consent aus dem Knoten.
- `connectionFromFields` (Kubernetes-Zweig): bei `access === 'direct'` → `accessHosts: []`; `inline` verlangt `kubeconfigText.trim()` (`ConnectionFieldError('kubeconfigText', t('connection:cluster.validation.kubeconfigTextEmpty'))`), `file` verlangt Pfad gemäß `KUBECONFIG_LOCAL_PATH` (`validation.kubeconfigLocalPath`: „Gib einen absoluten Pfad oder ~/ an.“); bei `ssh` wie heute. Wechsel `ssh`→`direct` mit `kubeconfigSource` `auto`/`path` setzt die Quelle auf `inline` (und umgekehrt auf `auto`) – im `onChange` des Radios in `ClusterForm`, nicht in der Abbildung.
- `validateCluster`: Host-Prüfungen nur bei `!isDirectKubeconfig`.
- Nach D-3: „Neue Verbindung → Kubernetes-Cluster“ startet mit `access: 'direct'`, Quelle `inline`; `setupCluster` aus einer SSH-Verbindung bleibt `ssh`/`auto`.

### 5.2 `ClusterForm.tsx` (Reihenfolge von oben)
1. Fieldset **„Zugang“** mit zwei Radios: „Über SSH“ · „Direkt“. Hinweis unter „Direkt“: „Shellherd spricht den API-Server von diesem Rechner aus an. Es wird keine SSH-Verbindung gebraucht.“
2. `ssh`: die heutigen Fieldsets „Zugang über SSH“ und „Kubeconfig“ (auto / Pfad auf dem Host), unverändert.
3. `direct`: Fieldset **„Kubeconfig“** mit Radios „Eingefügt (im Vault gespeichert)“ · „Datei auf diesem Rechner“.
   - `inline`: solange `kubeconfigText` leer oder `replacing` gesetzt: `<textarea rows=8 spellCheck=false autoComplete="off">` mit Platzhalter `apiVersion: v1\nkind: Config\n…`; Hinweis: „Wird verschlüsselt im Vault gespeichert und wandert mit ihm.“ Ist ein Text vorhanden und nicht `replacing`: Zeile „Kubeconfig gespeichert · {{count}} Zeichen“ + Knöpfe „Ersetzen“ (leert Feld, `replacing=true`) und „Entfernen“ (leert Feld). So steht kein Base64-Block dauerhaft im Formular und in Screenshots.
   - `file`: Textfeld „Pfad auf diesem Rechner“ (Platzhalter `~/.kube/config`) + Knopf „Datei wählen…“ (`kubeSelectConfigFile`). Hinweis: „Wird bei jedem Verbinden neu gelesen.“
4. **Context** wie heute; „Contexts lesen“ ist aktiv bei `ssh && firstHost`, `inline && text`, `file && path`; Anfrage je Quelle `{ connectionId } | { text } | { path }`. Ist `fields.context` leer und die Antwort hat `currentContext`, wird er eingetragen (nur im Direkt-Modus). Der `useEffect`, der Contexts bei Host-Wechsel leert (`:31`), leert sie auch bei Wechsel von Quelle/Text/Pfad.
   - Nur `inline`: hat `execCommands[context || currentContext]` einen Wert, erscheint unter dem Feld eine Checkbox „Login-Programm beim Verbinden ausführen: `{{command}}`“ mit Hinweis „Dieses Programm läuft auf diesem Rechner mit deinen Rechten. Nur bestätigen, wenn die kubeconfig aus vertrauenswürdiger Hand stammt.“ Haken → `execConsent = command`; abwählen → `''`. Beim Speichern mit bekanntem Exec und ohne Haken: `ConnectionFieldError('execConsent', validation.execConsentMissing)`. Ohne vorheriges „Contexts lesen“ greift das Main-Gate beim Verbinden (`loginPluginNeedsConsent`), dessen Text zum Formular verweist.
5. Namespace, Weboberflächen, Produktion (vorausgewählt), Nur lesen – unverändert.

Design-System: nur vorhandene Klassen (`editor-field`, `editor-hint`, `editor-checkbox`, `editor-input-group`, `secondary-button`, `field-error`), keine neuen Farben/Maße; die Textarea erbt die Stile der Kommentar-Textarea. Keine Bewegung.

### 5.3 Weitere Renderer-Stellen
- `connection-labels.ts:48`: `isDirectKubeconfig ? t('vault:address.clusterDirect') : t('vault:address.cluster', { count })`.
- `VaultTree.tsx:159-162`: Eintrag „Zugangs-Host per SSH öffnen“ nur bei `!isDirectKubeconfig(node.kubeconfig)`.
- `ClusterView.tsx:370`, `cluster-bar.ts`: keine Änderung nötig (fehlendes `host` wird schon behandelt). Prüfen per Test in `cluster-bar.test.ts`: `ready` ohne `host` → „Live“.

### 5.4 Texte (de-DE, en-US analog; alle neu)
`connection.json` → `cluster`:
- `access.mode.legend` „Zugang“, `access.mode.ssh` „Über SSH“, `access.mode.direct` „Direkt“, `access.mode.directHint` „Shellherd spricht den API-Server von diesem Rechner aus an. Es wird keine SSH-Verbindung gebraucht.“
- `kubeconfig.inline` „Eingefügt (im Vault gespeichert)“, `kubeconfig.file` „Datei auf diesem Rechner“, `kubeconfig.textLabel` „Kubeconfig“, `kubeconfig.textHint` „Wird verschlüsselt im Vault gespeichert und wandert mit ihm.“, `kubeconfig.stored` „Kubeconfig gespeichert · {{count}} Zeichen“, `kubeconfig.replace` „Ersetzen“, `kubeconfig.fileLabel` „Pfad auf diesem Rechner“, `kubeconfig.fileHint` „Wird bei jedem Verbinden neu gelesen.“, `kubeconfig.pickFile` „Datei wählen…“, `kubeconfig.pickFailed` „Die Datei konnte nicht gewählt werden.“
- `context.execConsent` „Login-Programm beim Verbinden ausführen: {{command}}“, `context.execHint` „Dieses Programm läuft auf diesem Rechner mit deinen Rechten. Nur bestätigen, wenn die kubeconfig aus vertrauenswürdiger Hand stammt.“
- `validation.kubeconfigTextEmpty` „Füge eine Kubeconfig ein.“, `validation.kubeconfigLocalPath` „Gib einen absoluten Pfad oder ~/ an.“, `validation.execConsentMissing` „Bestätige das Login-Programm oder wähle einen Context ohne Plugin.“
`vault.json`: `address.clusterDirect` „Cluster · direkt“.
`errors/kubernetes.json`: `kubeconfigFileUnreadable` „Die Kubeconfig „{{path}}“ konnte nicht gelesen werden.“, `loginPluginNeedsConsent` „Diese Kubeconfig startet das Programm „{{command}}“. Bestätige das im Cluster-Eintrag unter Context.“, `authProviderUnsupported` „Diese Kubeconfig nutzt einen auth-provider. Nutze stattdessen ein exec-Plugin oder ein Token.“, `tlsVerifyRequired` „Diese Kubeconfig schaltet die TLS-Prüfung ab (insecure-skip-tls-verify). Ohne SSH-Tunnel wird das nicht unterstützt.“, `proxyUnsupported` „Diese Kubeconfig nutzt proxy-url. Das wird nicht unterstützt.“
`main` (mainT): `dialogs.kubeconfig.title` „Kubeconfig wählen“.
`certFilesUnsupported` (bestehend) bekommt einen allgemeineren Text: „Die Kubeconfig verweist auf Zertifikatsdateien. Nutze eine Kubeconfig mit eingebetteten Zertifikaten (…-data) oder die Datei auf diesem Rechner.“

---

## 6. Stufe 1 gegenüber Extras

**Stufe 1 (dieses Paket):** Datenmodell, `direct.ts`, Policy in `parseKubeconfig`, Session ohne Host/Tunnel, Probe für Text/Datei, Dateidialog, Formular mit beiden Direkt-Quellen und Exec-Freigabe, Masker, Adresszeile/Kontextmenü, Fakes + Szene, Doku.

**Extras (nicht jetzt):** Datei-Überwachung; Session-Backoff im Direkt-Modus; `proxy-url`; `auth-provider`; Schalter für `insecure-skip-tls-verify`; Import aller Contexts aus `~/.kube/config` als mehrere Einträge; Einrichtungsassistent „Aus Zwischenablage“.

---

## 7. Änderungen je Datei

| Datei | Änderung |
|---|---|
| `src/shared/vault/types.ts` | `KubeconfigSource` mit `inline`/`file`; Kommentar `accessHosts` |
| `src/shared/vault/connections.ts` | `isDirectKubeconfig` |
| `src/shared/vault/schema.ts` | Union erweitern, Konstanten `KUBECONFIG_TEXT_MAX`, `EXEC_CONSENT_MAX`, `KUBECONFIG_LOCAL_PATH`; `accessHosts` `.max(8)` + `.refine` |
| `src/shared/vault/schema.test.ts` | inline/file gültig; inline mit Hosts ungültig; auto ohne Hosts ungültig; Grenzen |
| `src/shared/kubernetes.ts` | `KubeProbeRequest` Union, `KubeProbeResult.execCommands?` |
| `src/shared/kubernetes-schema.ts` (+ Test) | `KubeProbeRequestSchema` Union |
| `src/shared/ipc.ts`, `src/preload/index.ts` | Kanal + `kubeSelectConfigFile` |
| `src/main/kubernetes/direct.ts` (neu, + Test) | `expandHome`, `openDirect` |
| `src/main/kubernetes/access.ts` | `ClusterAccess.host/connection` optional |
| `src/main/kubernetes/kubeconfig.ts` (+ Test) | Policy, `execCommandLine`, `listContexts.execCommands`, `kubeconfigSecrets`, `build(null)`, `policyFor` |
| `src/main/kubernetes/session.ts` (+ Test) | optionaler Host/Tunnel, `probe(parsed, port \| null)`, Policy-Übergabe |
| `src/main/kubernetes/ipc.ts` | Weiche `openDirect`/`openAccess`; Probe-Union; Dateidialog |
| `src/main/ai/secret-mask.ts` (+ Test) | inline-Secrets |
| `src/main/vault/...` | nichts (Schema deckt Speichern ab) |
| `src/renderer/src/connection-form.ts` (+ Test) | Felder, Abbildung beide Richtungen, Validierung |
| `src/renderer/src/cluster-form.ts` (+ Test) | `validateCluster` ohne Hosts bei direct |
| `src/renderer/src/components/ClusterForm.tsx` | Layout aus 5.2 |
| `src/renderer/src/connection-labels.ts` (+ Test falls vorhanden) | „Cluster · direkt“ |
| `src/renderer/src/components/VaultTree.tsx` | Menüeintrag nur bei SSH |
| `src/shared/locales/de-DE|en-US/{connection,vault,main}.json`, `errors/kubernetes.json` | Texte aus 5.4 |
| `.claude/skills/run-app/kube-fake.mjs` | `directKubeconfig` (server `https://127.0.0.1:<port>`, `tls-server-name: k8s-cp1`, gleiche CA, gleicher Token) und Datei `RUN_DIR/kube/kubeconfig-direct.yaml` schreiben (Run-Dir, kein echter Vault) |
| `.claude/skills/run-app/demo-setup.mjs` | Eintrag `lokal-k8s`: Neue Verbindung → Kubernetes-Cluster → Direkt → Datei → Pfad der Fake-Datei → „Contexts lesen“ → speichern |
| `.claude/skills/run-app/screens.mjs` | Szene `kube-direct`: Formular-Shot `kube-direct-form.png` (Direkt, Datei) und Tab-Shot `kube-direct.png` (wartet auf „bereit“ ohne „über“, ≥ 5 Zeilen) |
| `.claude/skills/run-app/fakes.test.mjs` | inline-Pfad: `openDirect({ inline: directKubeconfig })` → `parseKubeconfig(…, { source: 'inline' })` → `build(null)` → `createKubeApi.list('nodes')`; exec ohne Consent abgelehnt |
| `.claude/skills/run-app/SKILL.md` | Szene und Shots nennen |
| `docs/handbuch.md` (Kubernetes), `README.md:40,155`, `CHANGELOG.md`, `CHANGELOG.en.md` | Doku nach D-1: kein CHANGELOG, kein Bump. |

---

## 8. Tests

- `schema.test.ts`: inline/file akzeptiert; inline + Hosts abgelehnt; auto ohne Hosts abgelehnt; `text` > 64 KiB, `\0`, `execConsent` > 1024, Pfad `\\?\x` abgelehnt; `~/.kube/config`, `C:\u\.kube\config`, `/home/u/.kube/config` akzeptiert.
- `kubeconfig.test.ts`: Policy-Matrix aus 3.3 (exec: ssh ablehnen, inline ohne/mit falschem/mit richtigem Consent, file erlaubt; auth-provider überall; Datei-Zertifikate bei file erlaubt via `loadFromFile` mit Temp-Datei und relativem `client-key`; skip-tls und proxy-url bei inline/file abgelehnt, bei ssh durchgereicht); `build(null)` behält `server`; `execCommandLine` fügt Args; `listContexts.execCommands`; `kubeconfigSecrets` (token, password, keyData; `[]` bei Müll); keine Secrets in Fehlermeldungen.
- `direct.test.ts`: inline liefert Text; file liest über injiziertes `readFile`, `~/` expandiert, ENOENT → `kubeconfigFileUnreadable` mit `path`; > 1 MiB abgelehnt.
- `session.test.ts`: Direkt-Session ohne `openTunnel`-Aufruf, `status.host` fehlt, `build` mit `null`; Altname-Retry im Direkt-Modus; Host-Drop löst im Direkt-Modus keinen Reconnect aus (kein Host); `teardownLive` ohne Host wirft nicht.
- `kubernetes-schema.test.ts`: Probe-Union, unbekannte Keys abgelehnt.
- `secret-mask.test.ts`: Token einer inline-kubeconfig wird zu `[SECRET_n]`; file-Eintrag liefert nichts.
- `connection-form.test.ts`: Rundreise direct/inline und direct/file; leerer Text → Feldfehler; Wechsel auf direct leert `accessHosts`; `execConsent` nur bei inline gespeichert.
- `cluster-form.test.ts`: `validateCluster` ohne Hosts bei direct ok, bei ssh Fehler.
- `cluster-bar.test.ts`: `ready` ohne `host` → „Live“ (Bestand absichern).
- `i18n-catalog.test.ts`, `design-tokens.test.ts`: grün (keine neuen Literale, keine neuen Werte).
- `fakes.test.mjs`: inline gegen den Kube-Fake (siehe 7).
- run-app-Abnahme: Szene `kube-direct` (Form + Tab), Szene `kubernetes` unverändert grün („bereit über web-01“).

---

## 9. Zerlegung in Wellen (getrennte Dateien)

**Welle 1 (parallel, 3 Tasks):**
- T1 Shared: `types.ts`, `connections.ts`, `schema.ts` + Test, `kubernetes.ts`, `kubernetes-schema.ts` + Test, `ipc.ts`, `preload/index.ts`, alle Locale-Dateien (alle Keys aus 5.4, damit spätere Tasks keine Locale-Konflikte haben).
- T2 Main-Kern: `kubeconfig.ts` + Test, `direct.ts` + Test, `access.ts` (nur Interface). Hängt von T1 nur über Typen → T2 definiert `KubeconfigPolicy` lokal und importiert `KubeconfigSource` erst nach T1 (oder beide in derselben Welle mit abgesprochener Signatur; die Signaturen stehen oben wörtlich).
- T3 Fakes: `kube-fake.mjs` (`directKubeconfig`, Datei), `fakes.test.mjs` (Vorbereitung ohne `openDirect`-Import bis Welle 2 — oder T3 in Welle 2).

**Welle 2 (parallel, 3 Tasks, nach T1+T2):**
- T4 Main-Session: `session.ts` + Test, `ipc.ts` (Weiche, Probe-Union, Dateidialog), `secret-mask.ts` + Test.
- T5 Renderer-Logik: `connection-form.ts` + Test, `cluster-form.ts` + Test, `connection-labels.ts`, `VaultTree.tsx`.
- T6 Renderer-Form: `ClusterForm.tsx` (braucht Feldnamen aus T5 → Signaturen oben sind verbindlich, parallel möglich).

**Welle 3 (parallel, 2 Tasks, nach allem):**
- T7 run-app: `demo-setup.mjs`, `screens.mjs`, `fakes.test.mjs` (inline-Test), `SKILL.md`; Screenshots ansehen.
- T8 Doku: `docs/handbuch.md`, `docs/manual.md`, `README.md` (nach D-1 kein CHANGELOG, kein Bump).

Abhängigkeiten: T4/T5/T6 ← T1, T2. T7 ← T4, T6. T8 ← nichts (Texte stehen fest), aber Version-Frage klären.

---

## 10. Risiken

1. **Ältere Shellherd-Versionen** öffnen einen Vault mit Direkt-Eintrag nicht (neuer Diskriminator). Wie bei jeder neuen Verbindungsart; CHANGELOG nennt es.
2. **Exec-Plugins ohne TTY:** Device-Code-Logins (kubelogin ohne Cache, `gke-gcloud-auth-plugin` ohne gcloud-Login) schlagen fehl; Fehler erscheint als `kubernetes.unauthorized` oder Timeout, nicht als Plugin-Ausgabe. Handbuch: Token-Cache vorher mit kubectl füllen. Extra: stderr des Plugins in den Fehler-Detail übernehmen (gekürzt, ohne Secrets) – nicht jetzt.
3. **Kein Session-Reconnect im Direkt-Modus:** Nach VPN-Wechsel kann der Tab lange „Live“ mit altem Datenalter zeigen; Tabellen melden Störung. Watcher retrien alle 5 s, erholen sich also. Akzeptiert für Stufe 1.
4. **Exec-Freigabe als Befehlszeile:** `exec.env` wird nicht Teil der Freigabe (nur `command`+`args`). Ein manipulierter `env`-Block könnte das Programm anders steuern. Mitigation: `env`-Namen im Hinweis mit anzeigen ist ein kleines Extra; Stufe 1 zeigt nur die Befehlszeile. Vertrauensmodell: Der Nutzer fügt die kubeconfig selbst ein.
5. **`loadFromFile` bei `file`:** liest Zertifikatsdateien erst zur Request-Zeit (`bufferFromFileOrString`); eine fehlende Datei erscheint als generischer Fehler. `openDirect` prüft deshalb vorab Lesbarkeit der Hauptdatei; für referenzierte Dateien bleibt es beim generischen `kubernetes.apiError` → Umsetzer mappt `ENOENT` in `toApiError` auf `kubeconfigFileUnreadable` (eine Zeile in `client-api.ts:82-102`), sonst Extra.
6. **Textarea mit Secrets im Renderer:** gleiche Klasse wie SSH-Passwort im Formular; nach dem Speichern eingeklappt. Screenshots der Szene zeigen die Datei-Variante.
7. **Windows-Pfad `~/`:** `expandHome` nutzt `os.homedir()`; `KUBECONFIG_LOCAL_PATH` lässt `~/` und Laufwerkspfade zu, keine Device-Pfade.
8. **`accessHosts`-Refine in der Union:** falls zod die `ZodEffects` in `discriminatedUnion` doch ablehnt (Typecheck), fällt T1 auf Prüfung in `connectionFromFields` + Main zurück (Ruling oben).
