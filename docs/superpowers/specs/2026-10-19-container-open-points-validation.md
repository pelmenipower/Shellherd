# Container – offene Punkte schließen – Validierung

Stand: 2026-10-19 · Branch `claude/fix/container-open-points` (HEAD `ac576d9`, Arbeitsbaum sauber) · Version bleibt 0.9.0
Geprüft: Spec `2026-10-19-container-open-points-design.md` (P1–P7, O1–O5), Plan `docs/superpowers/plans/2026-10-19-container-open-points.md`, Vorgänger `2026-10-18-container-view-validation.md` (B8, C32), `2026-10-18-container-view-entries-validation.md` (E1), `2026-10-14-container-integration-design.md` (sudo-Regeln), Code am HEAD.
Basis grün: `npm run typecheck` ok, `npx vitest run` 82 Dateien / 1158 Tests ok.

**Dieser Anhang ist bindend und geht Spec und Plan vor.** Wo er schweigt, gelten Spec, dann Plan.

## 0. Urteil

**ready after corrections.** 3 Blocker (B1–B3), 14 Korrekturen und Entscheidungen (C1–C14), 2 Wellen, 7 Tasks.

Sicherheit hält, sofern B1–B3 umgesetzt werden: Der Befehl besteht nur aus festen Teilen und einer geprüften Zufallsmarke, Host-Ausgabe kann nichts ausführen, der Passwortpfad (`runner.ts:90-99`, `SudoRejections`) bleibt unverändert, Kube-Pfade bleiben unberührt (nur ein optionaler Parameter an `RemoteHost.run`).

## 1. Sicherheitsprüfung (Ergebnis)

| Punkt | Befund |
|---|---|
| Shell-Quoting | Jeder Token geht durch `shellJoin`, das Skript als Ganzes noch einmal (`sh -c '<skript>'`, innere `'` → `'\''`). Das Muster ist dasselbe wie in `remoteCommand` (`commands.ts:36`), Rundreise-Tests bestehen am HEAD auch unter Windows (Git-Bash). Die Marke enthält `[`/`]`, wird daher gequotet: `'[terminus-list-…]:containers:'"$c"`. In Ordnung. |
| Marken-Erzeugung | `randomBytes(8)` → 64 Bit, hex. `createSudoMarker('list')` liefert `[terminus-list-<16 hex>]`, passt auf `LIST_MARKER` und `SUDO_MARKER`. Kein `%`, kein Quote. In Ordnung. |
| Spoofing durch Host-Ausgabe | Docker gibt JSON-Zeilen aus, die mit `{` beginnen. Podman gibt ein Array mit eingerückten Objekten aus. In JSON-Strings sind Zeilenumbrüche escapet. Eine Zeile, die mit `[terminus-list-` beginnt, kann deshalb nicht entstehen. Selbst eine gefälschte Marke verschiebt nur Segmente (Daten), sie führt nichts aus (O4). **Aber:** Die Regex aus dem Plan (`^<marker>:…$`) behandelt `[…]` als Zeichenklasse und trifft nie → **B3**. |
| `sudo -v`/`-n`-Ablauf | Einmal `sudo -S -p M -v`, dann `printf R`, dann `{ <body>; }`. Nach `R` entschärft der Runner beide Watcher (`disarm`, `runner.ts:70-74`). Ein späteres `sudo -n` fragt nie, ein Passwort wird höchstens einmal gesendet (`runner.ts:96-98`). Die Klammern verhindern, dass Listen nach gescheitertem `sudo -v` laufen. In Ordnung. |
| Abgelehntes Passwort / Lockout | Zweiter Prompt → `sudoRejected`, Stream zu, `markRejected` (`sudo-run.ts:29`). Folge-Polls: `isRejected` → kein `host.run`, alle vier Arten `SUDO_REJECTED`. Wie heute, nur in einem Lauf statt vier. In Ordnung. |
| Timeout je Batch | Plan: 15 s für vier Listen. Langsame, aber funktionierende Hosts (Podman, PAM-Verzögerung bei `sudo -v`) verlören damit regelmäßig die letzten Listen, heute hat jede Liste 15 s → **C1** (60 s, Parität zum heutigen Worst Case). |
| Ausgabegrenze | Spec O3 verlangt 4 MiB, Plan lässt 1 MiB („Nicht jetzt: Limit anheben“). Die Spec gilt → **B1**. Abgeschnittene Ausgabe ist im Plan nicht definiert → **C2**. |
| stderr-Zuordnung | Gleicher Marken-Algorithmus auf stderr, unabhängig von stdout. sudo-Meldungen vor der ersten Liste landen bei `containers` (akzeptiert, wie im Plan). Algorithmus exakt in **B3/C2**. |
| Exit-Codes | `c=$?` direkt nach jeder Liste, Marke `…:<kind>:<c>`. Eine Art ohne Marke darf **nie** `code: 0` bekommen (sonst „leer und erfolgreich“) → **C2** schreibt `code: null` fest. |
| sudo-Gate | `runWithSudo` hält das Gate von `acquire` bis Ready oder Ende, jetzt einmal je Poll statt viermal. Die Wartezeit zählt gegen den Batch-Timeout (`sudo-run.ts:26`). In Ordnung. |
| Ohne sudo / mit root | `none`: `sh -c 'PATH=…; docker …'`, kein `sudo`. Das ist robuster als heute (Login-Shell). Als root läuft `sudo -v` ohne Prompt, Ready kommt, kein Passwort. Fehlt `sudo` im Prompt-Modus, kommt Exit 127 ohne Marken, und alle vier Arten zeigen die letzte stderr-Zeile. In Ordnung. |
| Nur lesen im Main | Der Batch enthält nur `inventoryArgv` (ps/images/volume ls/network ls). Kein `-f`, `--force`, `prune`, kein `-v` außer `sudo -v`. In Ordnung. |
| Secrets | Das Passwort steht nie im Befehl. Es geht nur über stdin und wird einmal gesendet. Testpflicht in T7. In Ordnung. |
| Exec ohne Klick | Nicht berührt (Polling ist lesend). In Ordnung. |
| kubeconfig | `kubernetes/access.ts:64` ruft `runWithSudo` mit Array und ohne `outputLimit` auf. Das Verhalten bleibt bitgleich (Default 1 MiB). In Ordnung. |
| P6 strenger Modus | Text identisch mit dem Reducer (`container-view.ts:87`, `RUNTIME_LABEL`). `HostAccessError` → `readable` lässt ihn durch, `ipcMessage` entfernt das Electron-Präfix. Schema (`validation.ts:7`) und IPC bleiben unverändert. Renderer: `fail` behält `inventory` und `selected` (E1-Folge bleibt). Danach läuft nur noch die Probe ohne sudo. In Ordnung. |
| P4 Maske | Die Plan-Regexe bestehen ihren eigenen Testfall `HOME=/root,PASSWORD=x;SECRET=y` nicht (nachgerechnet: Ausgabe unverändert, beide Werte sichtbar). Ein unterminierter Wert wie `"TOKEN=abc def` (abgeschnittene Inspect-Ausgabe, genau der Fall des Fallbacks) bleibt sichtbar, heute wird er maskiert. Das ist eine Regression → **B2**. Nebenbefund: Die heutige Regex ist quadratisch (200 000 Namenszeichen ohne `=`: 68 s gemessen, Main friert ein). Die Lösung in B2 ist linear (1 ms). |

## 2. Vertrag (exakt)

### 2.1 `src/main/containers/sudo.ts` (T1)

```ts
export function createSudoMarker(kind: 'sudo' | 'ready' | 'list'): string; // Körper unverändert
```

### 2.2 `src/main/containers/runner.ts` (T1, B1)

```ts
const OUTPUT_LIMIT = 1024 * 1024; // unverändert, nicht exportiert
export interface RemoteHost {
  /** outputLimit: characters kept per stream (stdout, stderr each); default OUTPUT_LIMIT. */
  run(command: string, timeoutMs: number, sudo?: SudoPrompt, outputLimit?: number): Promise<RunResult>;
  forward(host: string, port: number): Promise<Duplex>;
  close(): void;
  readonly closed: boolean;
}
```
In `openRemoteHost(...).run(command, timeoutMs, sudo, outputLimit)`: `const limit = outputLimit ?? OUTPUT_LIMIT;`. `addStdout` und `addStderr` vergleichen mit `limit` statt mit `OUTPUT_LIMIT`. Sonst ändert sich nichts, auch `runLocal` nicht.

### 2.3 `src/main/containers/commands.ts` (T1)

`remoteCommand` bleibt wörtlich. Neu, direkt darunter:
```ts
/** Runs a fixed sh script; in prompt mode after one `sudo -v`, the script itself prefixes `sudo -n` where needed. */
export function remoteScript(body: string, sudo: SudoMode): string {
  if (sudo.kind !== 'prompt') return shellJoin(['sh', '-c', `${PATH_PREFIX}; ${body}`]);
  if (!SUDO_MARKER.test(sudo.marker) || !SUDO_MARKER.test(sudo.ready)) throw new Error('Invalid sudo marker');
  const validate = shellJoin(['sudo', ...(sudo.stdin ? ['-S'] : []), '-p', sudo.marker, '-v']);
  return shellJoin(['sh', '-c', `${PATH_PREFIX}; ${validate} && printf %s ${shellJoin([sudo.ready])} && { ${body}; }; exit $?`]);
}
```
`none` und `noninteractive` ergeben denselben String, denn das `sudo -n` setzt der Körper.

### 2.4 `src/main/containers/sudo-run.ts` (T1)

```ts
export async function runWithSudo(host: RemoteHost, connection: SshConnectionNode,
  command: string[] | ((sudo: SudoMode) => string), timeoutMs: number, rejections: SudoRejections,
  outputLimit?: number): Promise<RunResult>;
```
- `const render = (mode: SudoMode): string => typeof command === 'function' ? command(mode) : remoteCommand(command, mode);`
- Ohne Prompt: `return host.run(render(setting), timeoutMs, undefined, outputLimit);`
- Mit Prompt: `host.run(render({ kind: 'prompt', marker, ready, stdin: true }), remaining, { marker, ready, password: setting.password, onReady: release }, outputLimit)`. Der Aufruf liegt wie heute innerhalb des `try` nach `acquire`.
- Gate, Sperre, Marker und `markRejected` bleiben wörtlich. `import type { SudoMode } from './commands'`.

### 2.5 Neu: `src/main/containers/inventory-batch.ts` (T1, rein)

```ts
import { INVENTORY_KINDS } from '../../shared/containers';
import type { ContainerRuntime, InventoryKind } from '../../shared/containers';
import { inventoryArgv, remoteScript, shellJoin } from './commands';
import type { SudoMode } from './commands';
import type { RunResult } from './parsers';

export const LIST_MARKER = /^\[terminus-list-[0-9a-f]{16}\]$/;
/** O3: four times the 1 MiB a single list had. */
export const BATCH_OUTPUT_LIMIT = 4 * 1024 * 1024;
/** C1: four times LIST_TIMEOUT (15 s) a single list had. */
export const BATCH_TIMEOUT = 60_000;
/** Same text as runLocal's maxBuffer case (runner.ts:113). */
export const BATCH_TOO_LARGE = 'Die Ausgabe ist zu groß.';

/** One remote command for all four lists; after each list `<marker>:<kind>:<exit code>` is printed on its own line, on stdout and on stderr. */
export function inventoryBatchCommand(runtime: ContainerRuntime, marker: string, sudo: SudoMode): string;
/** Splits the batch output back into one RunResult per kind (B3, C2). */
export function splitInventoryBatch(result: RunResult, marker: string): Record<InventoryKind, RunResult>;
```

`inventoryBatchCommand` (normativ):
```ts
if (!LIST_MARKER.test(marker)) throw new Error('Invalid list marker');
const prefix = sudo.kind === 'none' ? [] : ['sudo', '-n'];
const part = (kind: InventoryKind): string => {
  const tag = `${shellJoin([`${marker}:${kind}:`])}"$c"`;
  return `${shellJoin([...prefix, ...inventoryArgv(runtime, kind)])}; c=$?; echo; echo ${tag}; echo >&2; echo ${tag} >&2`;
};
return remoteScript(INVENTORY_KINDS.map(part).join('; '), sudo);
```

`splitInventoryBatch`: siehe B3 (Schnitt) und C2 (Ergebnis je Art). Wirft `new Error('Invalid list marker')` bei ungültiger Marke.

### 2.6 `src/main/containers/inventory-parsers.ts` (T4)

Nur `maskEnvText` ändert sich, siehe B2. `SECRET_NAME`, `maskInspect` und alle Exporte bleiben.

### 2.7 `src/main/containers/discovery.ts` (T7)

`inventory(hostId, runtime?)` normativ (Rest der Klasse unverändert):
```ts
async inventory(hostId: ContainerHostId, runtime?: ContainerRuntime): Promise<ContainerInventory> {
  try {
    const connection = hostId === LOCAL_CONTAINER_HOST ? undefined : this.sshConnection(hostId);
    if (connection) sudoSetting(connection);
    const runtimes: ContainerRuntime[] = [];
    const build = async (lists: (rt: ContainerRuntime) => Promise<Record<InventoryKind, RunResult>>): Promise<ContainerInventory> => {
      // A requested runtime is strict: nothing runs for another one (P6).
      if (runtime && !runtimes.includes(runtime)) throw new HostAccessError(`${RUNTIME_LABEL[runtime]} wurde auf diesem Host nicht gefunden.`);
      if (runtimes.length === 0) throw new HostAccessError('Auf diesem Host wurde weder Docker noch Podman gefunden.');
      const rt = runtime ?? runtimes[0];
      const results = await lists(rt);
      const rows = emptyRows();
      const problems: ContainerInventory['problems'] = {};
      for (const kind of INVENTORY_KINDS) {
        const result = results[kind];
        if (result.code === 0) rows[kind] = INVENTORY_PARSERS[kind](rt, result.stdout);
        else problems[kind] = result.notFound ? `${rt} ist nicht installiert.` : describeFailure(rt, result);
      }
      return { /* return-Ausdruck wörtlich wie heute discovery.ts:120-121 */ };
    };
    if (!connection) {
      const local = (rt: ContainerRuntime, kind: InventoryKind): Promise<RunResult> => {
        const argv = inventoryArgv(rt, kind);
        return this.dependencies.runLocal(argv[0], argv.slice(1), LIST_TIMEOUT);
      };
      // Local has no probe: the container list doubles as one, a missing program means no runtime.
      const probed = new Map<ContainerRuntime, RunResult>();
      for (const rt of ['docker', 'podman'] as const) {
        const result = await local(rt, 'containers');
        if (result.notFound) continue;
        runtimes.push(rt);
        probed.set(rt, result);
      }
      return await build(async rt => ({ containers: probed.get(rt)!, images: await local(rt, 'images'),
        volumes: await local(rt, 'volumes'), networks: await local(rt, 'networks') }));
    }
    return await this.withHost(connection, async host => {
      const tools = parseProbe(probeOutput(await host.run(PROBE_COMMAND, LIST_TIMEOUT)));
      for (const rt of ['docker', 'podman'] as const) if (tools.has(rt)) runtimes.push(rt);
      return build(async rt => {
        const marker = createSudoMarker('list');
        const batch = await runWithSudo(host, connection, mode => inventoryBatchCommand(rt, marker, mode), BATCH_TIMEOUT, this.sudoRejections, BATCH_OUTPUT_LIMIT);
        return splitInventoryBatch(batch, marker);
      });
    });
  } catch (error) { throw readable(error); }
}
```
Neue Importe: `RUNTIME_LABEL` (`../../shared/containers`), `createSudoMarker` (`./sudo`), `BATCH_OUTPUT_LIMIT, BATCH_TIMEOUT, inventoryBatchCommand, splitInventoryBatch` (`./inventory-batch`). Die lokale Aufrufreihenfolge bleibt bitgleich (docker ps, podman ps, dann images, volumes, networks von `rt`). `list`, `action`, `inspect` und `inventoryAction` bleiben unverändert.

### 2.8 Neu: `src/renderer/src/inventory-scheduler.ts` (T2)

```ts
import type { ContainerInventory, ContainerRuntime } from '../../shared/containers';
import { ipcMessage } from './container-tree';
import type { ContainerViewAction } from './container-view';

/** Pause between the end of one request and the start of the next while the tab is visible. */
export const POLL_MS = 10_000;
export interface InventoryInput { hostId: string; runtime: ContainerRuntime | null }
export interface InventorySchedulerHooks {
  request: (input: InventoryInput) => Promise<ContainerInventory>;
  dispatch: (action: ContainerViewAction) => void;
  /** Default POLL_MS. */
  pollMs?: number;
}
export class InventoryScheduler {
  constructor(hooks: InventorySchedulerHooks); // no side effects (StrictMode may construct twice)
  start(): void;
  stop(): void;
  update(input: InventoryInput, visible: boolean): void;
  reload(): void;
}
```
Semantik normativ in C5.

### 2.9 `src/renderer/src/hooks/useContainerInventory.ts` (T2)

Signatur bleibt: `useContainerInventory(hostId: string, runtime: ContainerRuntime | null, visible: boolean, dispatch: (action: ContainerViewAction) => void): { reload: () => void }`. Körper in C5.

### 2.10 `src/renderer/src/terminal-tabs.ts` (T3)

Direkt nach `sameTarget`:
```ts
/** Open view of the same host and runtime: the active tab first, else the first match; undefined when none. */
export function reusableTab(tabs: readonly TerminalTab[], activeTabId: string | null, connection: TerminalConnection): TerminalTab | undefined {
  const matches = tabs.filter(tab => sameTarget(tab.connection, connection));
  return matches.find(tab => tab.id === activeTabId) ?? matches[0];
}
export type ContainerViewPlan = { kind: 'focus'; tabId: string } | { kind: 'limit' } | { kind: 'open' };
/** reuse → focus an open tab before the session limit applies; then MAX_SSH_SESSIONS; then open. */
export function planContainerView(tabs: readonly TerminalTab[], activeTabId: string | null, connection: TerminalConnection, reuse: boolean): ContainerViewPlan {
  if (reuse) {
    const open = reusableTab(tabs, activeTabId, connection);
    if (open) return { kind: 'focus', tabId: open.id };
  }
  return tabs.length >= MAX_SSH_SESSIONS ? { kind: 'limit' } : { kind: 'open' };
}
```
(`TerminalTab` ist unterhalb deklariert. Als Interface wird es gehoben, das ist zulässig.)

## 3. Blocker

### B1 · Ausgabegrenze 4 MiB (O3) braucht einen Parameter am Runner

**Problem.** Spec O3 bindet 4 MiB je Batch. Der Plan lässt `OUTPUT_LIMIT` bei 1 MiB („Nicht jetzt: Limit anheben“, §2 P1 Risiken und §4). `runner.ts` steht in keinem Task. Ohne Änderung verlieren große Hosts Listen, die heute laden (4 × 1 MiB → 1 MiB gesamt).
**Fix.** Vertrag 2.2 und 2.4: optionaler vierter Parameter `outputLimit` an `RemoteHost.run`, durchgereicht von `runWithSudo`. T7 übergibt `BATCH_OUTPUT_LIMIT`. `runner.ts` und `runner.test.ts` kommen in T1. Alle anderen Aufrufer (Kube, Aktionen, Inspect, Probe) übergeben nichts und behalten 1 MiB. Bestehende Fakes (`run(command, _timeout, prompt)`) bleiben zuweisbar, Typecheck bleibt grün.

### B2 · P4: Die Plan-Regexe erfüllen die eigenen Tests nicht und verschlechtern einen Fall

**Problem (nachgerechnet mit Node).** `BARE_ENV` mit `([^\s"]*)` verschluckt in `HOME=/root,PASSWORD=x;SECRET=y` den Rest der Zeile als Wert von `HOME`. Der Test aus dem Plan erwartet zwei maskierte Werte, die Ausgabe ist aber unverändert. Das Lookbehind mit `"` lässt einen unterminierten Quote-Wert wie `"TOKEN=abc def` (abgeschnittene Inspect-Ausgabe) ungemaskt, heute wird er maskiert.
**Fix (normativ).** Ein Durchgang, der nach jedem Namen weitersucht und nur Werte geheimer Namen überspringt:
```ts
/** Start of a NAME= pair; the lookbehind keeps the scan linear on long runs of name characters. */
const ENV_NAME = /(?<![A-Za-z0-9_.-])([A-Za-z_][A-Za-z0-9_.-]*)=/g;
/** Value right after a quote: runs to the closing quote or the line end, escapes included. */
const QUOTED_VALUE = /(?:\\.|[^"\\\r\n])*/y;
/** Value in free text: runs to whitespace or a quote. */
const BARE_VALUE = /[^\s"]*/y;

/** Fallback for unparsable input: masks values of secret-sounding NAME=value pairs; a non-secret value is searched for further pairs. */
function maskEnvText(text: string): string {
  let out = '';
  let from = 0;
  ENV_NAME.lastIndex = 0;
  for (let match = ENV_NAME.exec(text); match; match = ENV_NAME.exec(text)) {
    if (!SECRET_NAME.test(match[1])) continue;
    const value = match.index > 0 && text[match.index - 1] === '"' ? QUOTED_VALUE : BARE_VALUE;
    value.lastIndex = ENV_NAME.lastIndex;
    value.exec(text);
    out += `${text.slice(from, ENV_NAME.lastIndex)}***`;
    from = ENV_NAME.lastIndex = value.lastIndex;
  }
  return out + text.slice(from);
}
```
Ergebnisse (bindend, als Tests): siehe Testpflichten T4. Die Lösung ist idempotent und linear (1 MiB in Millisekunden).

### B3 · `splitInventoryBatch`: Marke als Regex und Segmentgrenzen

**Problem.** Der Plan schreibt die Regex `^<marker>:(containers|…):(\d+)$` mit der rohen Marke. `[terminus-list-…]` ist in einer Regex eine Zeichenklasse und trifft keine Markenzeile. Alle Arten liefen dann auf „ohne Marke“, und das Inventar wäre auf jedem SSH-Host leer und fehlerhaft. Außerdem sind „vorige Markenzeile“ und „erste Marke gewinnt“ mehrdeutig (Duplikate, falsche Reihenfolge).
**Fix (normativ).** Für stdout und stderr getrennt:
```ts
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** One leading and one trailing newline belong to the markers (`echo` before each tag, the tag line's own newline). */
const trim = (text: string): string => { const start = text.startsWith('\n') ? text.slice(1) : text; return start.endsWith('\n') ? start.slice(0, -1) : start; };
function cut(text: string, marker: string): { found: Map<InventoryKind, { segment: string; code: number }>; rest: string } {
  const line = new RegExp(`^${escapeRegExp(marker)}:(containers|images|volumes|networks):(\\d{1,3})$`, 'gm');
  const found = new Map<InventoryKind, { segment: string; code: number }>();
  let cursor = 0;
  let next = 0;
  for (const match of text.matchAll(line)) {
    if (next >= INVENTORY_KINDS.length) break;
    // Only the next expected kind counts; duplicates and out-of-order lines stay inside the segment.
    if (match[1] !== INVENTORY_KINDS[next]) continue;
    found.set(INVENTORY_KINDS[next], { segment: trim(text.slice(cursor, match.index)), code: Number(match[2]) });
    cursor = match.index! + match[0].length;
    next++;
  }
  const rest = next === 0 ? text : text.slice(cursor);
  return { found, rest: next === 0 ? rest : (rest.startsWith('\n') ? rest.slice(1) : rest) };
}
```
Das Ergebnis je Art regelt C2.

## 4. Korrekturen und Entscheidungen

**C1 · Batch-Timeout 60 s (Entscheidung, löst Plan §2 P1 „Timeout“ ab).** `BATCH_TIMEOUT = 60_000` (4 × `LIST_TIMEOUT`) für `runWithSudo` im Batch. Grund: Parität. Was heute in 4 × 15 s klappt, klappt weiter. Ein hängender Daemon kostet wie heute höchstens 60 s je Poll. Die Gate-Wartezeit zählt dagegen, also meldet `sudoBusy` erst nach bis zu 60 s. Die Probe behält `LIST_TIMEOUT`. Kosten, falls falsch: Ein hängender Host hält einen Poll länger als die 15 s des Plans, das Polling läuft trotzdem nie parallel.

**C2 · Ergebnis je Art (normativ, ergänzt B3).** `const out = cut(result.stdout, marker); const err = cut(result.stderr, marker);` Je Art in `INVENTORY_KINDS`:
- mit stdout-Marke: `{ code, stdout: segment, stderr: err.found.get(kind)?.segment ?? '', ...(result.sudoReady ? { sudoReady: true } : {}) }`
- ohne stdout-Marke: `{ code: null, stdout: '', stderr: result.stdout.length >= BATCH_OUTPUT_LIMIT ? BATCH_TOO_LARGE : err.rest, ...flags }`, wobei `flags` jedes gesetzte Feld von `timedOut`, `sudoRejected`, `sudoBusy`, `sudoNoPrompt`, `sudoReady` des Batches übernimmt (nur wenn `true`).
- Eine Art ohne stdout-Marke bekommt **nie** `code: 0`. `notFound` wird nie gesetzt.

Folgen über `describeFailure`: Ablehnung, Gate, Timeout und „kein Prompt“ ergeben die bekannten Texte. Eine abgeschnittene Ausgabe ergibt „Die Ausgabe ist zu groß.“, ein gescheitertes `sudo -v` (z. B. „not in the sudoers file“) die letzte stderr-Zeile bei allen vier Arten.

**C3 · Marken-Fehler.** `inventoryBatchCommand` und `splitInventoryBatch` werfen bei ungültiger Marke `new Error('Invalid list marker')` (kein `ContainerInputError`, also nicht für Nutzer gedacht, über `readable` → `publicError`). `remoteScript` wirft wie `remoteCommand` `new Error('Invalid sudo marker')`.

**C4 · Ablösungen (Rulings).**
- `2026-10-18-container-view-validation.md` B8 Schritt 3: „sonst `runtimes[0]`. Es gibt keinen Fehler.“ wird ersetzt durch `HostAccessError('<Docker|Podman> wurde auf diesem Host nicht gefunden.')`, geprüft vor „weder Docker noch Podman“.
- Dieselbe Validierung, B8 Schritt 4 („jede mit `LIST_TIMEOUT`“) und C32 („viermal“): Per SSH läuft ein Batch, mit `BATCH_TIMEOUT` (C1) und `BATCH_OUTPUT_LIMIT`. Der README-Satz lautet „einmal“.
- `2026-10-18-container-view-entries-validation.md` E1 („Main bleibt bei `discovery.ts:116`“): aufgehoben. Der Renderer-Teil von E1 (Reducer-Zweig, `inventory`/`selected` bleiben) gilt weiter.
- Plan §2 P1 Risiken und §4 „Nicht jetzt: `OUTPUT_LIMIT` anheben“: aufgehoben durch O3/B1, nur für den Batch.
- Neu: `RemoteHost.run` bekommt einen optionalen Parameter (B1). Das berührt `runner.ts`, das die Kube-Seite mitnutzt, deren Verhalten bleibt aber bitgleich. Die Regel „Kube-Dateien nicht anfassen“ bleibt eingehalten.

**C5 · P2 Scheduler-Semantik (normativ, bitgleich zum Hook am HEAD).**
```ts
export class InventoryScheduler {
  private alive = false;
  private inFlight = false;
  /** One follow-up request is remembered while another one runs. */
  private again = false;
  private sequence = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private key: string | null = null;
  private input: InventoryInput | null = null;
  private visible = false;
  constructor(private readonly hooks: InventorySchedulerHooks) {}
  start(): void { this.alive = true; }
  stop(): void { this.alive = false; clearTimeout(this.timer); }
  update(input: InventoryInput, visible: boolean): void {
    const key = `${input.hostId}|${input.runtime ?? ''}`;
    // Host or runtime change: whatever is in flight is outdated.
    if (this.key !== null && this.key !== key) this.sequence++;
    this.key = key;
    this.input = input;
    this.visible = visible;
    if (!visible) { clearTimeout(this.timer); return; }
    // An in-flight request schedules the next one itself (or repeats, when it is outdated).
    if (!this.inFlight) this.load(false);
  }
  reload(): void { this.load(false); }
  private load(quiet: boolean): void {
    clearTimeout(this.timer);
    if (this.inFlight) { this.again = true; return; }
    const input = this.input;
    if (!input) return;
    this.inFlight = true;
    const id = ++this.sequence;
    this.hooks.dispatch(quiet ? { type: 'loading', quiet: true } : { type: 'loading' });
    this.hooks.request(input).then(
      inventory => { if (this.alive && id === this.sequence) this.hooks.dispatch({ type: 'setInventory', inventory }); },
      error => { if (this.alive && id === this.sequence) this.hooks.dispatch({ type: 'fail', message: ipcMessage(error, 'Die Container konnten nicht geladen werden.') }); },
    ).finally(() => {
      this.inFlight = false;
      if (!this.alive) return;
      // A request that was overtaken by a newer wish (runtime change) is repeated at once.
      const stale = id !== this.sequence;
      if ((this.again || stale) && this.visible) { this.again = false; this.load(false); return; }
      this.again = false;
      if (this.visible) this.timer = setTimeout(() => this.load(true), this.hooks.pollMs ?? POLL_MS);
    });
  }
}
```
Festgehalten: `update` hat keine Deduplizierung, genau wie der heutige Effekt-Körper. React ruft es nur bei geänderten Deps auf, StrictMode zweimal beim Mount, dann läuft die erste Anfrage noch. `reload()` lädt auch unsichtbar, danach kommt kein Timer (wie heute). `stop()` setzt weder `again` noch `inFlight` zurück (wie heute). Einzige akzeptierte Abweichung: `visible` gilt ab dem Effekt statt ab dem Render.

Hook (normativ):
```ts
export function useContainerInventory(hostId: string, runtime: ContainerRuntime | null, visible: boolean,
  dispatch: (action: ContainerViewAction) => void): { reload: () => void } {
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;
  const [scheduler] = useState(() => new InventoryScheduler({
    request: input => window.desktopApi.containersInventory({ hostId: input.hostId, ...(input.runtime ? { runtime: input.runtime } : {}) }),
    dispatch: action => dispatchRef.current(action),
  }));
  // Order matters: start before the first update, as alive was set before the key effect.
  useEffect(() => { scheduler.start(); return () => scheduler.stop(); }, [scheduler]);
  useEffect(() => { scheduler.update({ hostId, runtime }, visible); }, [scheduler, hostId, runtime, visible]);
  const reload = useCallback(() => scheduler.reload(), [scheduler]);
  return { reload };
}
```
Der Doc-Kommentar des Hooks bleibt. `POLL_MS` steht nur noch im Scheduler.

**C6 · P3 `App.tsx:679-686` (normativ).**
```ts
const connection = containerViewConnection(hostId, name, address, runtime);
const plan = planContainerView(terminals.tabs, terminals.activeTabId, connection, reuse);
if (plan.kind === 'focus') { terminals.select(plan.tabId); setEditorOpen(false); setEditorDirty(false); setError(null); return; }
if (plan.kind === 'limit') { setError(`Maximal ${MAX_SSH_SESSIONS} Sessions. Schließe zuerst einen Tab.`); return; }
terminals.open(connection);
setEditorOpen(false); setEditorDirty(false); setError(null);
```
`sameTarget` wird in `App.tsx` sonst nicht genutzt (`App.tsx:29`, `:681`), also fällt der Import weg und `planContainerView` kommt dazu. `openContainer` (`:663`) bleibt unverändert.

**C7 · P4 Grenzen.** `--password=x` in `Cmd` bleibt auch im Fallback sichtbar. Das Lookbehind schließt `-` aus, wegen der Linearität. Das entspricht dem JSON-Pfad (C10, Test `:297`: `Cmd` bleibt). `FOO=TOKEN=abc` wird zu `FOO=TOKEN=***` (gewollte Übermaskierung). README `:161-164` bleibt richtig und wird nicht geändert.

**C8 · P5 (normativ).** Direkt nach `useReducer` (`ContainerView.tsx:48`): `const stateRef = useRef(state);` und `stateRef.current = state;`, in `:113` `if (row.uid === stateRef.current.selected) dispatch({ type: 'reloadDock' });`. Keine weitere Änderung.

**C9 · P6 Texte (wörtlich).** „Docker wurde auf diesem Host nicht gefunden.“ und „Podman wurde auf diesem Host nicht gefunden.“ entstehen über `RUNTIME_LABEL` und sind identisch mit `container-view.ts:87`. Freie Ansicht ohne Parameter: „Auf diesem Host wurde weder Docker noch Podman gefunden.“ (unverändert). Mit Parameter und ohne jede Laufzeit erscheint der laufzeitspezifische Text.

**C10 · Doku (wörtlich, T6).** Wie Plan §3 und P7, ohne Änderung:
- `README.md:149` → zwei Zeilen: „aktualisiert sich alle 10 Sekunden, solange der Tab sichtbar ist, sowie nach jeder“ / „Aktion und mit `F5`.“
- `README.md:165-166` → „- Ein zweiter Tab desselben Hosts pollt doppelt. Mit `sudo` im Passwortmodus meldet“ / „  sich jeder Poll einmal per sudo an; das steht im Auth-Log des Hosts.“
- `README.md:167-168` → „- Fehlt die Laufzeit eines festen Tabs auf dem Host, zeigt der Tab einen Fehler. Im“ / „  Hintergrund prüft er nur noch ohne sudo, ob sie wieder da ist.“
- `CHANGELOG.md`: neuer Punkt unter `## [0.9.0] – 2026-10-18` zwischen „Seitenleiste: …“ (`:12`) und „Einheitliches Erscheinungsbild: …“ (`:13`), wörtlich: „- Container-Ansicht: Mit `sudo` im Passwortmodus meldet sich jeder Poll nur noch einmal an, die vier Listen laufen in einem Befehl. Ein fester Docker- oder Podman-Tab zeigt bei fehlender Laufzeit einen Fehler, statt im Hintergrund die andere Laufzeit abzufragen. Inspect maskiert in nicht parsbarer Ausgabe auch Geheimnisse hinter anderen Einträgen derselben Zeile.“
- `package.json` bleibt `0.9.0`. Kein Datum ändern.

**C11 · sh-Tests laufen auch hier.** Der Plan sagt „unter Windows übersprungen“. Das stimmt nicht: Git-Bash liefert `sh`, und die Fake-sudo-Tests in `commands.test.ts` laufen auf diesem Rechner und bestehen. Die neue Rundreise in `inventory-batch.test.ts` muss deshalb unter Git-Bash bestehen. Dafür gilt dasselbe Muster wie `commands.test.ts:68-77`: Skripte mit `#!/bin/sh`, LF-Zeilenenden, `mode: 0o755`, `PATH: ${directory}:${process.env.PATH}`, Aufräumen in `finally`.

**C12 · Linearität der Maske als Test.** `maskInspect('a'.repeat(1024 * 1024))` und `maskInspect('x'.repeat(1024 * 1024) + 'TOKEN=y')` liefern in unter 1 s. Der alte Ausdruck brauchte für 200 000 Zeichen 68 s. Der Test sichert ab, dass niemand ihn zurückholt.

**C13 · Fake-Shell in `discovery.test.ts` (T7).** Ein Helfer, kein Raten:
```ts
/** Answers PROBE and the batch: reads the list marker from the command, checks the four lists in order, joins the answers with marker lines. */
function batchHost(probe: string, lists: Partial<Record<InventoryKind, RunResult>>, batch: Partial<RunResult> = {}, stopAfter?: InventoryKind): ReturnType<typeof fakeHost> & { limits: (number | undefined)[]; timeouts: number[] }
```
Verhalten: Für `PROBE` kommt `ok(probe)`. Sonst liest der Helfer die Marke mit `/\[terminus-list-[0-9a-f]{16}\]/` aus dem Befehl und prüft per `expect`, dass die vier `shellJoin(inventoryArgv(rt, kind))` in Reihenfolge enthalten sind (`rt` aus dem Befehl). Je Art bis einschließlich `stopAfter` hängt er `<stdout>` + `\n` + `<marker>:<kind>:<code>\n` an stdout an, ebenso stderr. Fehlende Arten bekommen `ok('')`. Das Ergebnis ist `{ code: 0, stdout, stderr, ...batch }`. Zusätzlich zeichnet der Helfer `timeoutMs` und den vierten Parameter von `run` auf.

**C14 · Abhängigkeiten und Gate.** Nach Welle 1 ist `discovery.ts` unverändert, und alle neuen Exporte sind unbenutzt, aber typisiert. Nach Welle 2: `rg "run\(rt, kind\)|runtimes\[0\] : " src/main/containers/discovery.ts` liefert keinen Treffer. Gate nach jeder Welle: `npm run typecheck` und `npx vitest run` grün, ein Commit je Task (Format laut CLAUDE.md, ohne Co-Authored-By).

## 5. Wellen und Tasks

Dateien je Welle disjunkt. Pfade unter `src/main/containers/`, sofern nicht anders angegeben.

| Welle | Task | Punkte | Dateien (exakt) | Hängt ab von |
|---|---|---|---|---|
| 1 | **T1** Batch-Bausteine | P1, B1, B3, C2, C3 | `sudo.ts`, `sudo.test.ts`, `commands.ts`, `commands.test.ts`, `runner.ts`, `runner.test.ts`, `sudo-run.ts`, `sudo-run.test.ts`, **neu** `inventory-batch.ts`, **neu** `inventory-batch.test.ts` | – |
| 1 | **T2** Scheduler | P2, C5 | **neu** `src/renderer/src/inventory-scheduler.ts`, **neu** `src/renderer/src/inventory-scheduler.test.ts`, `src/renderer/src/hooks/useContainerInventory.ts` | – |
| 1 | **T3** Trefferwahl | P3, C6 | `src/renderer/src/terminal-tabs.ts`, `src/renderer/src/terminal-tabs.test.ts`, `src/renderer/src/App.tsx` | – |
| 1 | **T4** Fallback-Maske | P4, B2, C7, C12 | `inventory-parsers.ts`, `inventory-parsers.test.ts` | – |
| 1 | **T5** stateRef | P5, C8 | `src/renderer/src/components/containers/ContainerView.tsx` | – |
| 1 | **T6** Doku | P7, C10 | `README.md`, `CHANGELOG.md` | – |
| 2 | **T7** Discovery | P1 (Verdrahtung), P6, C1, C9, C13 | `discovery.ts`, `discovery.test.ts` | T1 |

Nicht anfassen: `containers-schema.ts`, `validation.ts`, `ipc.ts`, Preload, `session.ts`, `TerminalPanel.tsx`, `src/main/kubernetes/**`, `container-view.ts`, `parsers.ts`, `package.json`.

## 6. Testpflichten

**T1**
- `sudo.test.ts`: `createSudoMarker('list')` passt auf `/^\[terminus-list-[0-9a-f]{16}\]$/`, 50 Aufrufe sind verschieden.
- `commands.test.ts`: `remoteScript('true', { kind: 'none' })` ist exakt `sh -c 'PATH="$PATH:/usr/sbin:/sbin"; true'`, `noninteractive` liefert denselben String. Prompt mit `stdin: true` ist exakt `` `sh -c 'PATH="$PATH:/usr/sbin:/sbin"; sudo -S -p '\\''${marker}'\\'' -v && printf %s '\\''${ready}'\\'' && { true; }; exit $?'` ``. Ungültige Marken (`%u`, leer, `x'y`) werfen. Die bestehenden `remoteCommand`-Exakttests bleiben grün und unverändert.
- `runner.test.ts`: Der Server schreibt viermal `'x'.repeat(65_536)` mit Pausen. `run(cmd, t, undefined, 100_000)` liefert `stdout.length >= 100_000` und `< 262_144`, ohne Parameter `262_144`.
- `sudo-run.test.ts`: Die Funktionsform bekommt `{ kind: 'none' }` bzw. `{ kind: 'noninteractive' }` bzw. `{ kind: 'prompt', marker, ready, stdin: true }` (Marker wie `createSudoMarker`), und ihr Ergebnis geht unverändert an `host.run`. `outputLimit` landet als viertes Argument (beide Modi), ohne Angabe als `undefined`. Abgelehnte Sperre und `sudoBusy` rufen die Funktion nicht auf und `host.run` nicht.
- `inventory-batch.test.ts`:
  - Befehl Docker `none` mit Marke `M = '[terminus-list-0123456789abcdef]'` ist exakt `shellJoin(['sh', '-c', `PATH="$PATH:/usr/sbin:/sbin"; ${parts.join('; ')}`])` mit `parts` je Art `` `${shellJoin(inventoryArgv('docker', kind))}; c=$?; echo; echo '${M}:${kind}:'"$c"; echo >&2; echo '${M}:${kind}:'"$c" >&2` ``.
  - Für Docker und Podman stehen alle vier `shellJoin(inventoryArgv(rt, kind))` in der Reihenfolge `INVENTORY_KINDS` im Befehl.
  - `none` ohne `sudo`, `noninteractive` und `prompt` mit `sudo -n ` vor jeder Liste. Im Prompt-Modus genau ein `-v` (`sudo -S -p … -v`), sonst keines. `M` kommt genau 8-mal vor. Kein `-f`, `--force`, `prune`.
  - Ungültige Marke (`%u`, leer, `x'y`, `[terminus-sudo-0123456789abcdef]`) wirft in beiden Funktionen.
  - Split: vier Segmente mit Codes 0. `images` mit Code 1 und stderr `Error response from daemon: x` → genau diese stderr, die anderen `code 0` und `stderr ''`. Ein leeres Listensegment ergibt `stdout ''`. Docker-JSON-Zeilen bleiben mit abschließendem `\n` intakt, ein Podman-Array mit Einrückung bleibt bytegleich.
  - Timeout nach `containers` (`timedOut: true`, nur die erste Marke) → `containers` mit Code 0 und ohne `timedOut`, die drei übrigen mit `code: null`, `timedOut: true`.
  - `sudoRejected` ohne Ausgabe → alle vier `sudoRejected`, `code: null`. `sudoBusy` und `sudoNoPrompt` ebenso. `sudoReady` steht auf allen vier Arten.
  - Batch mit `code: 1`, ohne Marken, stderr `sudo: admin is not in the sudoers file` → alle vier mit dieser stderr, `code: null`.
  - `stdout` mit `BATCH_OUTPUT_LIMIT` Zeichen und nur der ersten Marke → drei Arten mit stderr `Die Ausgabe ist zu groß.`.
  - Eine Markenzeile in Quotes (`"[terminus-list-…]:images:0"`), eine Markenzeile mit fremder Zufallszahl, ein Duplikat `M:containers:0` nach `containers` und eine `networks`-Marke vor `images` trennen nicht.
  - Keine Art ohne stdout-Marke hat `code: 0` (Eigenschaft über alle Fälle).
  - `it.runIf(hasSh())`: Rundreise `none` mit Fake-`docker` (gibt je Unterbefehl eine Zeile aus, `images` mit `exit 3` und stderr), dann Split. Die vier Codes und Segmente stimmen. Gilt auch unter Git-Bash (C11).

**T2** (`vi.useFakeTimers()`, steuerbare Promises, jeder Test ruft zuerst `start()`)
- Erstes `update(sichtbar)` → genau eine Anfrage mit `{ hostId, runtime }`, `dispatch` zuerst `{ type: 'loading' }`, nach der Antwort `setInventory`. `advanceTimersByTimeAsync(10_000)` → zweite Anfrage, davor `{ type: 'loading', quiet: true }`. `pollMs: 50` wird respektiert.
- Zwei `reload()` während einer Anfrage → nach der Antwort genau eine weitere Anfrage, nicht quiet.
- Laufzeitwechsel während der Anfrage → die alte Antwort löst kein `setInventory` aus, die neue Anfrage startet sofort mit der neuen Laufzeit.
- `update(unsichtbar)` als Erstes → keine Anfrage. Unsichtbar während des Timers → kein Poll nach 10 s. Wieder sichtbar → sofort eine Anfrage.
- Unsichtbar während der Anfrage → nach der Antwort weder Wiederholung noch Timer. Späteres `update(sichtbar)` lädt.
- Unsichtbar und Laufzeitwechsel während der Anfrage → keine Wiederholung, bis `update(sichtbar)`.
- `reload()` unsichtbar → eine Anfrage, danach kein Timer.
- StrictMode-Folge `start`, `update`, `stop`, `start`, `update` (gleiche Werte) → genau eine Anfrage, deren Antwort `setInventory` auslöst.
- `stop()` während der Anfrage → Antwort verworfen, kein Timer. `start()` und `update` danach laden wieder.
- Zweites `update` mit gleichem Schlüssel während der Anfrage → insgesamt eine Anfrage.
- Abgelehnt mit `new Error("Error invoking remote method 'x': Error: Boom")` → `fail` mit `Boom`. Abgelehnt mit einem Nicht-Error → `Die Container konnten nicht geladen werden.`

**T3** (`terminal-tabs.test.ts`, Describe `container view tabs`)
- `reusableTab`: Der aktive passende Tab gewinnt vor einem früheren passenden. Ohne aktiven Treffer gewinnt der erste. Ein Docker-Tab passt weder zu einer Podman- noch zu einer freien Ansicht. Datei- und Terminal-Tab desselben Hosts passen nie. Leer ergibt `undefined`.
- `planContainerView`: 16 Tabs mit Treffer und `reuse` → `focus` mit der Tab-ID. 16 Tabs ohne Treffer → `limit`. 16 Tabs mit Treffer und `reuse = false` → `limit`. Unter dem Limit ohne Treffer → `open`. Mit Treffer und `reuse = false` → `open`.

**T4** (`inventory-parsers.test.ts`, neben `:314-323`, über `maskInspect` mit nicht parsbarer Eingabe)
- `PATH=/usr/bin TOKEN=abc` → `PATH=/usr/bin TOKEN=***`
- `"TOKEN=a\"b"` (roh) → `"TOKEN=***"`
- `["TOKEN=a\\","b"]` (roh) → `["TOKEN=***","b"]`
- `"API_KEY=abc def"` → `"API_KEY=***"`
- `"PATH=/usr/bin TOKEN=abc"` → `"PATH=/usr/bin TOKEN=***"`
- `HOME=/root,PASSWORD=x;SECRET=y` → `HOME=/root,PASSWORD=***`
- `"TOKEN=abc def` (unterminiert) → `"TOKEN=***`
- `A=1\nTOKEN=z\n  SECRET=q w` → `A=1\nTOKEN=***\n  SECRET=*** w`
- `DATABASE_URL=postgres://u:p@h` bleibt unverändert. `["--password=x"]` bleibt unverändert (C7).
- Doppelte Anwendung ändert nichts (für alle Fälle oben).
- Bestehende Fälle `:311-323` bleiben unverändert grün.
- Linearität aus C12.

**T5** – kein Test (Komponente). Die manuelle Prüfung steht im PR.

**T6** – kein Test. Die bestehenden Changelog- und Versionsprüfungen bleiben grün.

**T7** (`discovery.test.ts`, `inventoryAnswers` und `cmd` für Inventar ersetzt durch `batchHost`, C13)
- Docker zuerst: `host.commands.length === 2` (Probe und Batch), `runtime 'docker'`, `user 'admin'`, `sudo false`, `containers` geparst. Timeout `60_000` und Limit `4 * 1024 * 1024` kommen als Argumente an `run`.
- Der Parameter `podman` gewinnt bei Probe mit beiden Laufzeiten.
- `images` mit Code 1 und stderr `Error response from daemon: x` → `problems` ist genau `{ images: 'Error response from daemon: x' }`, die drei anderen Arten sind geliefert.
- `stopAfter: 'containers'` mit `timedOut` → `problems` hat für `images`, `volumes`, `networks` je `Der Host hat nicht rechtzeitig geantwortet.`, `containers` ist geliefert.
- `noninteractive`: Der Befehl beginnt mit `sh -c `, enthält `sudo -n docker ps` und `sudo -n docker images`, kein Prompt-Objekt.
- Passwortmodus: Ein komplettes Inventar ergibt `host.sudo.filter(Boolean)` mit Länge 1, `password` ist `synthetic-password`, der Befehl enthält das Passwort nicht und genau ein ` -v `, `sudoReady` am Batch. Zwei Polls verwenden verschiedene List-Marken.
- `sudoRejected`-Batch → alle vier `problems` = `Das sudo-Passwort wurde abgelehnt.`, das Passwort wurde einmal gesendet. Der zweite Poll (Muster `:126-138`) sendet nichts und meldet wieder alle vier.
- P6 SSH: Probe `has:docker`, Parameter `podman` → wirft `Podman wurde auf diesem Host nicht gefunden.`, `host.commands` ist genau `[PROBE]`, kein sudo. Ersetzt `:382-384`. Probe `has:pct` ohne Parameter → `Auf diesem Host wurde weder Docker noch Podman gefunden.`, mit Parameter `docker` → `Docker wurde auf diesem Host nicht gefunden.`. Passwortmodus mit fehlender Laufzeit → `host.sudo.filter(Boolean)` ist leer.
- P6 lokal: `podman` mit `notFound`, Parameter `podman` → derselbe Podman-Text, `runLocal.mock.calls` sind genau die zwei Container-Listen (docker, podman).
- Die lokalen Tests `:412-427` bleiben unverändert grün. `list`, `action`, `inspect` und `inventoryAction` bleiben unverändert grün.

## 7. Manuelle Prüfung (im PR nennen)

Wie Plan §7. Ergänzung: Ein Host mit großem Inventar (> 1 MiB gesamt) lädt alle vier Reiter.
