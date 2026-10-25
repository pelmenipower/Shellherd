# Kubernetes: Logs aller Pods und RBAC-Vorabprüfung – Validierung (bindend)

Urteil: **ready after corrections** (go-with-fixes). 3 Blocker (alle mit Fix), 15 Korrekturen, 12 Rulings. Dieser Anhang geht Spec `2026-10-25-k8s-logs-rbac-design.md` und Plan vor. Was hier nicht geändert wird, gilt aus der Spec **wörtlich**.

Geprüft gegen `3a24912` (sauberer Arbeitsbaum). Umgebung: Node 24.20, TypeScript 5.9, zod 4, `@kubernetes/client-node` 2.0.0. Ausgangslage: `npm run typecheck` grün, `npx vitest run` 167 Dateien und 2 610 Tests grün.

**Belege aus dem Scratchpad** (`…\scratchpad\lrv\w`, `git archive` von `3a24912` mit Junction auf `node_modules`, nie gegen einen echten Cluster):
- Der **Spec-Code wurde wörtlich eingespielt** und danach jede Korrektur dieses Anhangs.
  - Spec 3.1 kompiliert **nicht**: `src/shared/kube-access.ts(41,77): error TS1005` (B2).
  - Mit dem Spec-Code aus 3.5 scheitert der Ende-zu-Ende-Test aus 3.15: `three sources with their tails`, 1 Batch, `sources: []` (B1). Ursache belegt: `api.list` liefert `startedAt` als `Date`.
  - Mit dem Spec-Code scheitern außerdem die drei wörtlichen Menülisten in `kube-menus.test.ts` (K11).
- **Stand nach Welle 1** (A, B, D, H, E, T, F samt Korrekturen und Pflicht-Tests, Welle-2-Dateien auf Ausgangsstand): `tsc` für Node und Web grün, `vitest run` **171 Dateien und 2 686 Tests grün**, darin `i18n-catalog.test.ts` (a bis g), `design-tokens.test.ts` und `version.test.ts`.
- **Stand nach Welle 2** (I1, I2, G): `tsc` grün, `vitest run` **171 Dateien und 2 696 Tests grün**, darin der neue Ende-zu-Ende-Test in `fakes.test.mjs` (echter SSH-Fake, echter TLS-Tunnel, echter `KubeWorkloadLogs`, echte Rules-Review).
- `workload-logs.test.ts`, `session.test.ts` und `fakes.test.mjs` liefen 12-mal hintereinander. Einmal scheiterte der bestehende Test `opens the extra tcpip targets…` mit `Cannot parse privateKey` im sshd-Fake. Das ist die bekannte Flake beim Host-Schlüssel und hat nichts mit diesem Paket zu tun.
- **Mutationsprobe B3:** Ohne den Aufruf `this.liveEnded(…)` aus K4 scheitert der Pflicht-Test H `ends the run … when the connection drops`.
- **Kontraste** nachgerechnet (WCAG 2.x): Die Werte der Spec R3.5 stimmen. Dazu kommt die Chip-Fläche `--color-bg-raised`:
  - dunkel 7,31 / 7,38 / 8,60 / 7,41;
  - hell 5,04 / 5,63 / 4,81 / 5,37.
  
  Alle Werte liegen über 4,5.

## 1. Vertrag: was bindend ist

- **Kompiliert gegen den echten Code ohne Abweichung:**
  - Spec 3.1 bis auf eine Kommentarzeile (K2);
  - 3.2, 3.3;
  - 3.4 (mit K3 und K5);
  - 3.6 (mit K4 und K5);
  - 3.7 (mit K6);
  - 3.8, 3.9, 3.10;
  - 3.11 (mit K8), 3.12 (mit K7), 3.13;
  - 3.14 (mit K9), 3.15 (mit K10), 3.16.
- **Ersetzt durch diesen Anhang:**
  - Spec 3.5 `workload-logs.ts`, die ganze Datei → K1
  - Spec 3.1, Doc-Kommentar über `resourceMatches` → K2
  - Spec 3.4 `rulesReview`, das Feld `incomplete` → K3
  - Spec 3.4 und 10.5, die Fakes und Imports in `overview.test.ts`, `watch.test.ts` und `session.test.ts` → K5
  - Spec 3.6 `session.ts`, zusätzlich der Abbau der Läufe mit der Verbindung → K4
  - Spec 3.7 `reduce`, der Fall `access` → K6
  - Spec 3.12, der Effekt der Vorabprüfung und `logsAllReason` → K7
  - Spec 3.11, die Destrukturierung der neuen Props → K8
  - Spec 3.14, die Regel `.kube-logs-chip[aria-pressed="false"]` → K9
  - Spec 3.15, das `setInterval` im Log-Zweig des Fakes → K10
  - Spec 10.1 bis 10.7 (Testideen) → K11 und K12 (wörtliche Pflicht-Tests). 10.9 gilt wörtlich aus 3.15.
  - Spec 5, die genauen Fundstellen, englischen Texte und Ergänzungen → K13
  - Spec 6.2 und 3.8 (Doku-Tabellen), die Listen- und Tabellenänderungen → K13, K14
  - Spec R2.4 „nie periodisch“, 10.1 „Rolle wie view“, R1.5 „gekürzte Nullen“, Risiko 7 und 8 → K15
- **Typ-Fakten aus dem Code, die die Spec betreffen:**
  - `KubernetesObjectApi.list` deserialisiert in die Modellklassen von client-node. Zeitfelder wie `status.containerStatuses[].state.running.startedAt` sind dort `Date`-Objekte. Ein Watch-Ereignis (`Watch.watch`) liefert dagegen das rohe JSON, also Zeichenketten.
    - `ResourceWatcher` mischt beides: die Liste beim Start, Relist und 410, dazu die Watch-Ereignisse.
    - `KubeMeta.creationTimestamp?: string | Date` (`api.ts:7`) zeigt das schon.
    - Der Spec-Code `typeof started !== 'string'` verwirft damit jeden Container der Liste (B1).
  - `AuthorizationV1Api` ist `ObjectAuthorizationV1Api` (`dist/gen/index.d.ts`).
    - `createSelfSubjectRulesReview({ body })` (`ObjectParamAPI.d.ts:10981`) akzeptiert 200, 201 und 202 als Erfolg.
    - 403 wirft `ApiException` mit `code: 403`; `toApiError` macht daraus `KubeApiError` 403.
    - `config.makeApiClient(…)` braucht keine Discovery.
    - Der Body als Objektliteral ist strukturell mit der Klasse `V1SelfSubjectRulesReview` verträglich (kompiliert).
  - `V1SubjectRulesReviewStatus.evaluationError` kann bei `incomplete: false` gesetzt sein. Der RBAC-Resolver meldet zum Beispiel eine Bindung an eine gelöschte Rolle als Fehler, aber nicht als unvollständig. R2.5 verlangt „fehlerhaft → nichts sperren“ (K3).
  - Der Kubelet schreibt `timestamps=true` mit genau neun Nachkommastellen (`RFC3339NanoFixed`). Die Zone ist die der Container-Runtime. Ein Node in Ortszeit liefert `+02:00` statt `Z`, und Spec 3.5 hätte dann gar keine Zeit erkannt (K1, V4).
  - `applyEvent` (`kube-view.ts:298-307`) hat kein `default`; der Fall `logs` muss in Welle 1 stehen (bestätigt, E).
  - Eine Testdatei, die `KubeStream` schon importiert (`watch.test.ts:4`), darf ihn nicht ein zweites Mal importieren; das wäre ein „Duplicate identifier“ (K5).
  - In `handbuch.md:541-542` und `manual.md:530-531` bricht der Satz zu „Nur lesen“ über zwei Zeilen um. Die Ersetzung der Spec ist dort nicht wörtlich auffindbar (K13).
- **Zeilenanker der Spec:** Sie stimmen bis auf wenige Zeilen Versatz ohne Belang (z. B. `applyEvent` `:298-307`, Nicht-GET-403 im Fake `:136-140`).
- **i18n (`i18n-catalog.test.ts`):** Alle Texte aus Spec 3.7, 3.9 und 3.13 bestehen (a) bis (g). Geprüft im Scratchpad in beiden Wellen.
  - Welle 1: E legt `kubeActions:reasons.forbidden` und `forbiddenClusterWide` an; `src/renderer/src/kube-access.ts` benutzt beide als Literal.
  - Welle 2: I1 legt `kubeActions:menu.logsAll` an und benutzt es in derselben Welle. I2 legt den Block `kubernetes:logsAll` an. Jeder seiner 16 Keys steht als Literal in `WorkloadLogs.tsx` oder `DetailDock.tsx`.
  - In K7 kommt `kubeActions:reasons.reconnecting` dazu (vorhanden).
  - `count`, `total`, `shown` und `max` formatiert `countFormatter`.
- **Design (`design-tokens.test.ts`):** grün.
  - Vier neue `--color-source-*` stehen im dunklen und im hellen Block (R19).
  - `COLORS` ist ergänzt.
  - Im CSS stehen nur Tokens (R1, R14 bis R16, R18 geprüft).
  - Es gibt keine Bewegung.

## 2. Blocker

### B1 – „Logs aller Pods“ öffnet am echten Client keinen einzigen Stream (Spec 3.5, `startedContainers`)
- `ResourceWatcher` liest die Pods mit `api.list` (`KubernetesObjectApi.list`). client-node gibt `startedAt` dort als `Date` zurück. `startedContainers` verlangt `typeof started === 'string'` und liefert für jeden gelisteten Pod `[]`.
- Erst ein Watch-Ereignis (rohes JSON) liefert Zeichenketten. Ein ruhiges Deployment bekommt aber keines: Die Ansicht bleibt bei „Noch kein Container gestartet.“.
- Beleg: Der Ende-zu-Ende-Test der Spec (3.15) scheitert mit `sources: []`. Ein Diagnose-`list` zeigt 3 Pods mit `state.running.startedAt`.
- Zweitfehler: Der Instanzschlüssel wechselte zwischen Liste (`Date`) und Watch (ISO-Text). Jeder Relist hätte beendete Instanzen erneut geöffnet.

**Fix:** K1, `startedContainers`. `Date` und Zeichenkette werden beide zu Epoch-Millisekunden; der Instanzschlüssel ist `restartCount/<ms>`. Pflicht-Test D `gives the same instance for a Date from a list and the string from a watch event`.

### B2 – Spec 3.1 kompiliert nicht (`src/shared/kube-access.ts`)
Der Doc-Kommentar ``/** … `*/<subresource>` … */`` schließt bei `*/` vorzeitig: `error TS1005: ';' expected`. Damit wären Typecheck und alle Tests der Welle 1 rot.

**Fix:** K2.

### B3 – Ein Lauf überlebt den Abbau der Verbindung und spricht weiter mit dem alten API-Client (Spec 3.5/3.6, R1.9)
- `LogRun` hält den `KubeApi` vom Start fest. Bei einem Reconnect stoppt `Session.teardownLive` Watcher und Overview und schließt den Tunnel. Der eigene `ResourceWatcher` des Laufs listet aber weiter, alle 1, 2 und 5 s, gegen `https://127.0.0.1:<alter Tunnel-Port>`, und zwar bis der Renderer nach `ready` neu mountet. Bleibt der Cluster im Zustand `reconnecting`, geschieht das beliebig lange.
- **Sicherheit:** Der freie Port kann von einem anderen lokalen Prozess belegt werden.
  - `parsed.build` übernimmt `insecure-skip-tls-verify` aus der kubeconfig (`kubeconfig.ts:58`).
  - Ohne TLS-Prüfung ginge damit das Bearer-Token an diesen Prozess.
  - Das verletzt „die kubeconfig verlässt den Main nie“. Kein anderes Modul tut das: Weiterleitungen holen den Client je Verbindung über `waitReady`.

**Fix:** K4. Die Session ruft beim Abbau `liveEnded(viewIds)`, und `KubeSessions` stoppt die Läufe dieser Views. Nach `ready` startet der Renderer neu, wie bisher über `epoch` (V6). Pflicht-Test H `ends the run … when the connection drops` (Mutationsprobe oben).

## 3. Korrekturen (wörtlicher Ersatz)

Der Projektcode ist CRLF; Ersetzungen gelten zeilenweise. Neue Dateien legt der Umsetzer mit CRLF an, wie die Nachbardateien.

### K1 – `src/main/kubernetes/workload-logs.ts` (Task D), ersetzt Spec 3.5 vollständig
Gegenüber der Spec:
- B1 (`Date`);
- Zonen-Offsets in `splitTimestamp` (V4);
- Zeilenumbrüche aus der Kompakt-Form werden in `cleanLogText` zu Leerzeichen, statt zu `��`;
- Wiederaufnahme eines laufenden Containers nach sauberem Ende (V3: `LOG_RESUME_MS`, `running`, `resume`, `resumeLater`, `resumeTimers`).

```ts
import { StringDecoder } from 'node:string_decoder';
import type { CodedError } from '../../shared/errors';
import { LOG_TAIL_LINES, MAX_LOG_SOURCES, MAX_LOG_STREAMS } from '../../shared/kubernetes';
import type { KubeLogLine, KubeLogSource, KubeLogsStartRequest } from '../../shared/kubernetes';
import type { KubeApi, KubeObject, KubeStream } from './api';
import { formatLogLine } from './log-format';
import { ResourceWatcher, defaultCancel, defaultSchedule } from './watch';

/** Lines go to the renderer every LOG_BATCH_MS; a batch carries at most MAX_BATCH_LINES (the newest), the rest counts as dropped. */
export const LOG_BATCH_MS = 250;
export const MAX_BATCH_LINES = 2000;
/** Longer lines are cut with an ellipsis; a partial line longer than MAX_PENDING_CHARS is passed on as a line. */
export const MAX_LINE_CHARS = 4000;
const MAX_PENDING_CHARS = 64 * 1024;
/** A stream that ended cleanly while its container still runs (proxy or load balancer idle timeout) is opened again after this pause. */
export const LOG_RESUME_MS = 5000;

type Dict = Record<string, unknown>;
const rec = (value: unknown): Dict => (value && typeof value === 'object' && !Array.isArray(value) ? value as Dict : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export type LogsRequest = Omit<KubeLogsStartRequest, 'viewId'>;
/** The view a run belongs to; `api` waits through a reconnect (Session.waitReady). */
export interface LogsView { ownerId: number; viewId: string; api: () => Promise<KubeApi> }
export interface LogsBatch { id: string; lines: KubeLogLine[]; sources: KubeLogSource[]; waiting: number; dropped: number; error?: CodedError }
export type LogsEmit = (ownerId: number, viewId: string, batch: LogsBatch) => void;
export interface LogsTimers { schedule: (fn: () => void, ms: number) => unknown; cancel: (handle: unknown) => void }

/**
 * Server timestamp of a `timestamps=true` line as UTC with nine fraction digits, so that the strings sort by time.
 * The kubelet writes the runtime's zone: a node in local time sends `+02:00` instead of `Z`.
 */
export function splitTimestamp(line: string): { time: string; text: string } | undefined {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2}) (.*)$/s.exec(line);
  if (!match) return undefined;
  let seconds = match[1];
  if (match[3] !== 'Z') {
    const utc = new Date(`${match[1]}${match[3]}`);
    if (Number.isNaN(utc.getTime())) return undefined;
    seconds = utc.toISOString().slice(0, 19);
  }
  return { time: `${seconds}.${(match[2] ?? '').padEnd(9, '0')}Z`, text: match[4] };
}

const ESCAPES = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g;
/** Text that is safe to show and short: escape sequences removed, inner line breaks and tabs as a space, other control characters as U+FFFD, capped. */
export function cleanLogText(text: string): string {
  const clean = text.replace(ESCAPES, '').replace(/\r?\n/g, ' ').replace(/\t/g, ' ').replace(/[\x00-\x1f\x7f-\x9f]/g, '�');
  return clean.length > MAX_LINE_CHARS ? `${clean.slice(0, MAX_LINE_CHARS)}…` : clean;
}

/**
 * Containers of a pod that have started at least once (running, terminated or a terminated last run), with a key per
 * container instance and whether it runs now.
 */
export function startedContainers(pod: KubeObject): { container: string; instance: string; running: boolean }[] {
  const statuses = list(rec(pod.status).containerStatuses).map(rec);
  return list(rec(pod.spec).containers).map(rec).flatMap(container => {
    const name = typeof container.name === 'string' ? container.name : '';
    const status = statuses.find(item => item.name === name);
    const state = rec(status?.state);
    const running = rec(state.running).startedAt;
    const started = running ?? rec(state.terminated).startedAt ?? rec(rec(rec(status?.lastState).terminated)).startedAt;
    // client-node's list returns Date objects, a watch event the JSON string: both become epoch milliseconds.
    const startedMs = started instanceof Date ? started.getTime() : typeof started === 'string' ? Date.parse(started) : Number.NaN;
    if (!name || !Number.isFinite(startedMs)) return [];
    return [{ container: name, instance: `${String(status?.restartCount ?? 0)}/${startedMs}`, running: running !== undefined }];
  });
}

interface Source {
  key: string;
  info: KubeLogSource;
  /** Restart count and start time of the container instance read last. */
  instance?: string;
  stream?: KubeStream;
  /** Identifies the current stream; callbacks of an older stream are ignored. */
  token?: symbol;
  decoder: StringDecoder;
  pending: string;
  /** Normalised server time of the newest line, for sinceTime on a reopen. */
  lastTime: string;
  /** After a reopen: lines up to this time were read before and are skipped. */
  skipUntil?: string;
  /** The stream ended cleanly LOG_RESUME_MS ago: the same instance may be opened again while it runs. */
  resume?: boolean;
}

const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** One run of "Logs aller Pods": a pod watcher for the selector and one log stream per started container. */
class LogRun {
  stopped = false;
  private api?: KubeApi;
  private watcher?: ResourceWatcher;
  private readonly sources: Source[] = [];
  private pods: KubeObject[] = [];
  private lines: KubeLogLine[] = [];
  private waiting = 0;
  private dropped = 0;
  private error?: CodedError;
  /** The renderer has not seen the current state; true at the start, so the first sync reports even without pods. */
  private dirty = true;
  private timer: unknown;
  private timed = false;
  private readonly resumeTimers = new Set<unknown>();

  constructor(readonly view: LogsView, readonly request: LogsRequest, private readonly emit: LogsEmit, private readonly timers: LogsTimers) {}

  start(api: KubeApi): void {
    this.api = api;
    this.watcher = new ResourceWatcher(api, { kind: 'pods', namespace: this.request.namespace, selector: { labels: this.request.selector } },
      () => {},
      error => { this.error = error; this.dirty = true; this.touch(); },
      { schedule: this.timers.schedule, cancel: this.timers.cancel, onObjects: objects => { this.pods = objects; this.sync(); } });
    void this.watcher.start();
  }

  stop(): void {
    this.stopped = true;
    this.watcher?.stop();
    for (const source of this.sources) {
      const stream = source.stream;
      source.token = undefined;
      source.stream = undefined;
      stream?.close();
    }
    if (this.timed) this.timers.cancel(this.timer);
    this.timed = false;
    for (const handle of this.resumeTimers) this.timers.cancel(handle);
    this.resumeTimers.clear();
  }

  /** Opens a stream for every started container that has none, pods by name, at most MAX_LOG_STREAMS at once. */
  private sync(): void {
    if (this.stopped || !this.api) return;
    const named = this.pods
      .map(pod => ({ pod, name: typeof pod.metadata?.name === 'string' ? pod.metadata.name : '' }))
      .filter(entry => entry.name !== '')
      .sort((a, b) => byName(a.name, b.name));
    let waiting = 0;
    for (const { pod, name } of named) {
      for (const { container, instance, running } of startedContainers(pod)) {
        const key = `${name}/${container}`;
        const known = this.sources.find(source => source.key === key);
        // Live, or this container instance was read to its end (a running one may resume after a clean end).
        if (known?.stream || (known?.instance === instance && !(running && known.resume))) continue;
        if (this.openStreams() >= MAX_LOG_STREAMS || (!known && this.sources.length >= MAX_LOG_SOURCES)) { waiting++; continue; }
        this.open(known ?? this.add(key, name, container), instance);
      }
    }
    if (waiting !== this.waiting) { this.waiting = waiting; this.dirty = true; }
    this.touch();
  }

  private add(key: string, pod: string, container: string): Source {
    const source: Source = { key, info: { pod, container, live: false }, decoder: new StringDecoder('utf8'), pending: '', lastTime: '' };
    this.sources.push(source);
    return source;
  }

  private openStreams(): number {
    return this.sources.filter(source => source.stream !== undefined).length;
  }

  private open(source: Source, instance: string): void {
    const api = this.api;
    if (!api) return;
    const { pod, container } = source.info;
    const token = Symbol('stream');
    source.token = token;
    source.instance = instance;
    source.resume = false;
    source.info = { pod, container, live: true };
    source.decoder = new StringDecoder('utf8');
    source.pending = '';
    // A reopened container continues after the newest line read; sinceTime has whole seconds, so addLine skips what was read before.
    source.skipUntil = source.lastTime || undefined;
    const start = source.lastTime ? { sinceTime: `${source.lastTime.slice(0, 19)}Z` } : { tailLines: LOG_TAIL_LINES };
    this.dirty = true;
    const stream = api.followLog({ namespace: this.request.namespace, pod, container, mode: 'logs' }, start, {
      data: chunk => { if (source.token === token) this.feed(source, chunk); },
      end: (_code, error) => {
        if (source.token !== token || this.stopped) return;
        this.flushPending(source);
        source.token = undefined;
        source.stream = undefined;
        source.info = { pod, container, live: false, ...(error ? { error } : {}) };
        this.dirty = true;
        if (!error) this.resumeLater(source);
        // A waiting container may take the free slot.
        this.sync();
      },
    });
    if (source.token === token) source.stream = stream;
  }

  /** After a clean end: allows one reopen of the same instance after LOG_RESUME_MS; sync decides whether it still runs. */
  private resumeLater(source: Source): void {
    const handle = this.timers.schedule(() => {
      this.resumeTimers.delete(handle);
      if (this.stopped || source.stream) return;
      source.resume = true;
      this.sync();
    }, LOG_RESUME_MS);
    this.resumeTimers.add(handle);
  }

  private feed(source: Source, chunk: Buffer): void {
    if (this.stopped) return;
    const parts = (source.pending + source.decoder.write(chunk)).split('\n');
    source.pending = parts.pop() ?? '';
    if (source.pending.length > MAX_PENDING_CHARS) { parts.push(source.pending); source.pending = ''; }
    for (const part of parts) this.addLine(source, part);
    this.touch();
  }

  private flushPending(source: Source): void {
    const rest = source.pending + source.decoder.end();
    source.pending = '';
    if (rest !== '') this.addLine(source, rest);
  }

  private addLine(source: Source, raw: string): void {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const stamped = splitTimestamp(line);
    if (source.skipUntil !== undefined) {
      if (stamped && stamped.time <= source.skipUntil) return;
      source.skipUntil = undefined;
    }
    if (stamped) source.lastTime = stamped.time;
    const body = stamped ? stamped.text : line;
    const text = cleanLogText(this.request.format === 'compact' ? formatLogLine(body) : body);
    // A flood is cut here already, so main never holds more than two batches of lines.
    if (this.lines.length >= 2 * MAX_BATCH_LINES) {
      this.dropped += MAX_BATCH_LINES;
      this.lines = this.lines.slice(MAX_BATCH_LINES);
    }
    this.lines.push({ source: this.sources.indexOf(source), time: stamped ? stamped.time : source.lastTime, text });
    this.dirty = true;
  }

  private touch(): void {
    if (!this.dirty || this.stopped || this.timed) return;
    this.timed = true;
    this.timer = this.timers.schedule(() => this.flush(), LOG_BATCH_MS);
  }

  private flush(): void {
    this.timed = false;
    if (this.stopped) return;
    let lines = this.lines;
    this.lines = [];
    if (lines.length > MAX_BATCH_LINES) {
      this.dropped += lines.length - MAX_BATCH_LINES;
      lines = lines.slice(-MAX_BATCH_LINES);
    }
    this.dirty = false;
    this.emit(this.view.ownerId, this.view.viewId, {
      id: this.request.id, lines, sources: this.sources.map(source => source.info), waiting: this.waiting, dropped: this.dropped,
      ...(this.error ? { error: this.error } : {}),
    });
  }
}

/** "Logs aller Pods" of every view: at most one run per view; reading only (list/watch pods, get pods/log). */
export class KubeWorkloadLogs {
  private readonly runs = new Map<string, LogRun>();

  constructor(private readonly emit: LogsEmit, private readonly timers: LogsTimers = { schedule: defaultSchedule, cancel: defaultCancel }) {}

  /** Replaces the view's run. Resolves once the run has its API client; rejects when the cluster does not get ready. */
  async start(view: LogsView, request: LogsRequest): Promise<void> {
    this.stopView(view.viewId);
    const run = new LogRun(view, request, this.emit, this.timers);
    this.runs.set(view.viewId, run);
    let api: KubeApi;
    try {
      api = await view.api();
    } catch (error) {
      if (this.runs.get(view.viewId) === run) this.stopView(view.viewId);
      throw error;
    }
    if (!run.stopped) run.start(api);
  }

  /** Stops the run `id` of a view; a newer run of the view stays. */
  stop(viewId: string, id: string): void {
    if (this.runs.get(viewId)?.request.id === id) this.stopView(viewId);
  }

  stopView(viewId: string): void {
    this.runs.get(viewId)?.stop();
    this.runs.delete(viewId);
  }

  stopAll(): void {
    for (const viewId of [...this.runs.keys()]) this.stopView(viewId);
  }
}
```

### K2 – `src/shared/kube-access.ts` (Task A)
In Spec 3.1 wird die Zeile

```ts
/** RBAC resource matching: `*`, the exact resource, or `*/<subresource>`. `pods/*` is no RBAC pattern. */
```

ersetzt durch (Zeilenkommentar, weil `*/` einen Block-Kommentar schließt):

```ts
// RBAC resource matching: `*`, the exact resource, or `*/<subresource>`. `pods/*` is no RBAC pattern.
```

Der Rest von Spec 3.1 gilt wörtlich.

### K3 – `src/main/kubernetes/client-api.ts` (Task B), in `rulesReview` aus Spec 3.4
Statt

```ts
          // A missing status counts as incomplete: then nothing is greyed out.
          incomplete: status?.incomplete !== false,
```

steht:

```ts
          // A missing status or an evaluation error (e.g. a binding to a missing role) counts as incomplete: then nothing is greyed out.
          incomplete: status?.incomplete !== false || Boolean(status?.evaluationError),
```

### K4 – `src/main/kubernetes/session.ts` (Task H), zusätzlich zu Spec 3.6
1. Konstruktor von `Session` (`:124-125`), alt:

```ts
  constructor(private readonly deps: KubeSessionDependencies, private readonly options: SessionOptions,
    readonly clusterId: string, private readonly forget: () => void) {}
```

neu:

```ts
  constructor(private readonly deps: KubeSessionDependencies, private readonly options: SessionOptions,
    readonly clusterId: string, private readonly forget: () => void,
    /** Called with the views whenever the live connection goes: their log runs hold the old API client and must end. */
    private readonly liveEnded: (viewIds: string[]) => void = () => {}) {}
```

2. In `teardownLive` direkt nach `for (const view of this.views.values()) view.key = undefined;` die Zeile `this.liveEnded([...this.views.keys()]);` einfügen.

3. In `sessionFor` wird

```ts
    const created: Session = new Session(this.deps, this.options, clusterId, () => {
      if (this.sessions.get(clusterId) === created) this.sessions.delete(clusterId);
    });
```

zu

```ts
    const created: Session = new Session(this.deps, this.options, clusterId, () => {
      if (this.sessions.get(clusterId) === created) this.sessions.delete(clusterId);
    }, viewIds => { for (const viewId of viewIds) this.logs.stopView(viewId); });
```

Die Imports aus Spec 3.6 stehen direkt nach `import { KubeForwards } from './forwards';`, in dieser Reihenfolge:

```ts
import { KubeWorkloadLogs, type LogsRequest } from './workload-logs';
import { deniedAccess, type KubeDenied } from '../../shared/kube-access';
```

### K5 – Test-Fakes (Tasks B und H), ersetzt die Fake-Zeilen aus Spec 3.4 und 10.5
- **`overview.test.ts` (B):** Nach `  portForward(): never { throw new Error('unused'); }` (`:65`) diese Zeilen einfügen; keine neuen Imports:

```ts
  followLog(): never { throw new Error('unused'); }
  rulesReview(): never { throw new Error('unused'); }
```

- **`watch.test.ts` (B):** Nach `  portForward(): Promise<void> { throw new Error('unused'); }` (`:48`) dieselben zwei Zeilen einfügen; keine neuen Imports.
- **`session.test.ts` (H):**
  - Zeile 11 wird zu `import type { KubeApi, KubeObject, KubeRulesReview, KubeStream, ListResult, LogFollowOptions, MetricsSample, TerminalIo, WatchHandle, WatchType } from './api';`.
  - Die Felder und Methoden aus Spec 10.5 kommen als letzte Mitglieder in die Klasse `FakeApi`, nach `portForward`.

### K6 – `src/renderer/src/kube-view.ts` (Task E), Fall `access` in `reduce`
Statt der Zeile aus Spec 3.7:

```ts
    // An answer that lands after the connection dropped may describe the old connection: dropped.
    case 'access': return state.status?.state === 'ready' ? { ...state, access: { ...state.access, [action.namespace]: action.entry } } : state;
```

Der Fall steht direkt nach `case 'event': …`. Der Rest von Spec 3.7 gilt wörtlich, auch die erste Zeile von `applyStatus`.

### K7 – `src/renderer/src/components/kubernetes/ClusterView.tsx` (Task I2), in Spec 3.12
- Der Effekt der Vorabprüfung wird zu:

```ts
  // state.now (10 s tick) refreshes a stale answer at most once a minute, and only while the tab is shown.
  useEffect(() => {
    if (statusState !== 'ready' || !visible) return;
    for (const namespace of new Set(accessKey.split(' '))) if (accessStale(state.access, namespace, Date.now())) ensureAccess(namespace);
  }, [statusState, visible, accessKey, state.access, state.now, ensureAccess]);
```

- `logsAllReason` an `<DetailDock …>` wird zu:

```tsx
          logsAllReason={statusState === 'reconnecting' ? t('kubeActions:reasons.reconnecting') : statusState !== 'ready' ? t('errors:kubernetes.notConnected') : workloadRow ? refAccessReason(state.access, status, workloadRow.ref, 'logsAll') : undefined}
```

- Wortlaut für die übrigen Punkte:
  - Die drei neuen Props-Zeilen aus Spec 3.12 stehen direkt nach der Zeile `logFormat={state.logFormat} onLogFormat={…} onSay={say}`.
  - Der Import `import { accessNamespace, accessStale, refAccessReason } from '../../kube-access';` steht nach `import { KubeForwardDialog } from './KubeForwardDialog';`.
  - `LOGS_ALL_KINDS` kommt in den bestehenden Import aus `../../../../shared/kubernetes`, direkt nach `KUBE_KINDS, `.
  - `const [logsAllFor, setLogsAllFor] = useState<string | null>(null);` steht direkt nach der Zeile mit `armedFor`.
  - Die Zeile `const statusState = status?.state;` steht direkt nach `const status = state.status;` und wird an ihrer alten Stelle (`:114`) gelöscht.
  - Im Objekt aus `runnerFor` steht `logsAll` direkt nach `forward: row => setForwardRow(row),`.

### K8 – `src/renderer/src/components/kubernetes/DetailDock.tsx` (Task I2), in Spec 3.11
- Die Destrukturierung (`:72`) endet nicht mehr mit `onCopy, onSay } = props;`, sondern mit:

```ts
logFormat, onLogFormat, onCopy, onSay,
    viewId, workload, logsAllArmed, logsAllReason, onArmLogsAll, startLogs, stopLogs, shellForbidden } = props;
```

- Imports:
  - Zeile 2 bekommt `MAX_LOG_STREAMS` nach `KIND_COLUMNS, ` und `type KubeLogsStartRequest` nach `type DockMode,`.
  - `import { WorkloadLogs } from './WorkloadLogs';` steht als letzter Import.
- Die neuen Props stehen am Ende von `DetailDockProps`, nach `onSay`.
- `nothingToCopy` lautet wörtlich:

```ts
  const nothingToCopy = workloadShown ? !logsAllArmed : (terminalKind ? !target || shellWaiting : !currentResult?.data || (currentResult.data.mode === 'events' ? currentResult.data.rows.length === 0 : currentResult.data.text === ''));
```

### K9 – `src/renderer/src/kubernetes-dock.css` (Task I2), in Spec 3.14
Statt `.kube-logs-chip[aria-pressed="false"] { opacity: .5; text-decoration: line-through; }` steht:

```css
.kube-logs-chip[aria-pressed="false"] { color: var(--color-text-muted); text-decoration: line-through; }
```

Mit `opacity: .5` sinkt der Chip-Text unter 4,5:1, und der Chip sieht aus wie `disabled`, obwohl er bedienbar ist. Gedämpft bleibt er bei mindestens 6:1.

### K10 – `.claude/skills/run-app/kube-fake.mjs` (Task G), in Spec 3.15
Statt `const timer = setInterval(() => res.write(text(next++)), 2000);` steht:

```js
        const timer = setInterval(() => { if (!res.writableEnded) res.write(text(next++)); }, 2000);
```

`hold` beendet die Antwort nach 300 s oder beim Schließen des Fakes. Zwischen `end()` und `close` würde ein Schreiben ein unbehandeltes `error` auslösen, und der Fake-Prozess oder Vitest stürzt ab.

### K11 – `src/renderer/src/kube-menus.test.ts` (Task I1), die drei wörtlichen Listen
- `:252`: `'Pods anzeigen', '---', 'Events', 'YAML', 'Describe', '---',` → `'Pods anzeigen', '---', 'Logs aller Pods', 'Events', 'YAML', 'Describe', '---',`
- `:305`: `'Pods anzeigen', 'CronJob backup anzeigen', '---', 'Events', 'YAML', 'Describe', '---',` → `'Pods anzeigen', 'CronJob backup anzeigen', '---', 'Logs aller Pods', 'Events', 'YAML', 'Describe', '---',`
- `:369`: `'Pods anzeigen', 'Port weiterleiten…', '---', 'Events', 'YAML', 'Describe', '---', 'Kopieren',` → `'Pods anzeigen', 'Port weiterleiten…', '---', 'Logs aller Pods', 'Events', 'YAML', 'Describe', '---', 'Kopieren',`

### K12 – Pflicht-Tests, wörtlich (ersetzt Spec 10.1 bis 10.7)
Alle Blöcke sind im Scratchpad grün gelaufen.

#### A – `src/shared/kube-access.test.ts` (neu), mit Wahrheitstabelle

```ts
import { describe, expect, it } from 'vitest';
import { ACTION_KINDS, type KubeAction } from './kubernetes';
import { KUBE_ACCESS_IDS, actionAccess, deniedAccess, ruleAllows, type KubeAccessCheck, type KubeResourceRule } from './kube-access';

const rule = (verbs: string[], apiGroups: string[], resources: string[], resourceNames?: string[]): KubeResourceRule =>
  ({ verbs, apiGroups, resources, ...(resourceNames ? { resourceNames } : {}) });
const check = (verb: string, group: string, resource: string): KubeAccessCheck => ({ verb, group, resource });
const ids = (rules: KubeResourceRule[]) => deniedAccess(rules).map(item => item.id);

// Truth table of ruleAllows against the Kubernetes RBAC matcher (verb, apiGroup, resource incl. `*/sub`; resourceNames ignored = allowed).
const TRUTH: [string, KubeResourceRule, KubeAccessCheck, boolean][] = [
  ['everything', rule(['*'], ['*'], ['*']), check('patch', 'apps', 'deployments'), true],
  ['* resource covers a subresource', rule(['get'], [''], ['*']), check('get', '', 'pods/log'), true],
  ['* verb', rule(['*'], [''], ['pods']), check('delete', '', 'pods'), true],
  ['* group', rule(['patch'], ['*'], ['deployments']), check('patch', 'apps', 'deployments'), true],
  ['exact subresource', rule(['get'], [''], ['pods/log']), check('get', '', 'pods/log'), true],
  ['*/log matches pods/log', rule(['get'], [''], ['*/log']), check('get', '', 'pods/log'), true],
  ['*/exec matches pods/exec', rule(['create'], [''], ['*/exec']), check('create', '', 'pods/exec'), true],
  ['pods/* is no RBAC pattern', rule(['*'], [''], ['pods/*']), check('get', '', 'pods/log'), false],
  ['pods does not cover pods/log', rule(['get'], [''], ['pods']), check('get', '', 'pods/log'), false],
  ['pods/log does not cover pods', rule(['list'], [''], ['pods/log']), check('list', '', 'pods'), false],
  ['*/log does not match a plain resource', rule(['get'], [''], ['*/log']), check('get', '', 'pods'), false],
  ['*/exec does not match pods/portforward', rule(['create'], [''], ['*/exec']), check('create', '', 'pods/portforward'), false],
  ['deployments/scale does not grant patch on deployments', rule(['patch'], ['apps'], ['deployments/scale']), check('patch', 'apps', 'deployments'), false],
  ['*/scale does not grant patch on deployments', rule(['patch'], ['apps'], ['*/scale']), check('patch', 'apps', 'deployments'), false],
  ['wrong group: apps against core', rule(['get'], ['apps'], ['pods/log']), check('get', '', 'pods/log'), false],
  ['wrong group: core against apps', rule(['patch'], [''], ['deployments']), check('patch', 'apps', 'deployments'), false],
  ['wrong verb', rule(['get', 'list', 'watch'], ['*'], ['*']), check('patch', 'apps', 'deployments'), false],
  ['get on pods/exec allows the old exec check', rule(['get'], [''], ['pods/exec']), check('get', '', 'pods/exec'), true],
  ['resourceNames count as allowed', rule(['patch'], ['apps'], ['deployments'], ['api']), check('patch', 'apps', 'deployments'), true],
  ['empty apiGroups match nothing', rule(['*'], [], ['*']), check('get', '', 'pods/log'), false],
  ['empty verbs match nothing', rule([], ['*'], ['*']), check('get', '', 'pods/log'), false],
];

describe('ruleAllows (truth table)', () => {
  it.each(TRUTH)('%s', (_name, given, wanted, expected) => {
    expect(ruleAllows(given, wanted)).toBe(expected);
  });
});

describe('deniedAccess', () => {
  it('denies nothing to * on *', () => {
    expect(deniedAccess([rule(['*'], ['*'], ['*'])])).toEqual([]);
  });

  it('denies everything with the first missing check when there are no rules', () => {
    expect(ids([])).toEqual([...KUBE_ACCESS_IDS]);
    expect(deniedAccess([]).find(item => item.id === 'patchDeployments')).toEqual({ id: 'patchDeployments', verb: 'patch', resource: 'deployments' });
    expect(deniedAccess([]).find(item => item.id === 'shell')).toEqual({ id: 'shell', verb: 'create', resource: 'pods/exec' });
  });

  it('leaves logs and logs of all pods to the view role and denies all writes, shell and forward', () => {
    // Like the built-in ClusterRole view: explicit resources, so no pods/exec or pods/portforward.
    const view = [rule(['get', 'list', 'watch'], [''], ['pods', 'pods/log', 'services', 'events']), rule(['get', 'list', 'watch'], ['apps'], ['deployments', 'statefulsets', 'daemonsets']),
      rule(['get', 'list', 'watch'], ['batch'], ['jobs', 'cronjobs'])];
    expect(ids(view)).toEqual(['shell', 'forward', 'patchDeployments', 'patchStatefulSets', 'patchDaemonSets', 'patchCronJobs', 'patchNodes', 'deletePods', 'deleteJobs', 'trigger']);
  });

  it('fails open: get on * also grants get on pods/exec and pods/portforward, which older clusters use', () => {
    expect(ids([rule(['get', 'list', 'watch'], ['*'], ['*'])])).toEqual(['patchDeployments', 'patchStatefulSets', 'patchDaemonSets', 'patchCronJobs', 'patchNodes', 'deletePods', 'deleteJobs', 'trigger']);
  });

  it('allows shell and forward with get only (older clusters) or create only (1.31+)', () => {
    expect(ids([rule(['get'], [''], ['pods/exec', 'pods/portforward'])])).not.toContain('shell');
    expect(ids([rule(['get'], [''], ['pods/exec', 'pods/portforward'])])).not.toContain('forward');
    expect(ids([rule(['create'], [''], ['pods/exec', 'pods/portforward'])])).not.toContain('shell');
    expect(ids([rule(['create'], [''], ['pods/exec'])])).toContain('forward');
  });

  it('names the missing get on cronjobs for trigger and the missing watch for logs of all pods', () => {
    const denied = deniedAccess([rule(['create'], ['batch'], ['jobs']), rule(['get', 'list'], [''], ['pods', 'pods/log'])]);
    expect(denied.find(item => item.id === 'trigger')).toEqual({ id: 'trigger', verb: 'get', resource: 'cronjobs' });
    expect(denied.find(item => item.id === 'logsAll')).toEqual({ id: 'logsAll', verb: 'watch', resource: 'pods' });
    expect(denied.find(item => item.id === 'logs')).toBeUndefined();
  });

  it('counts rules for named objects as allowed (nothing greyed out that might work)', () => {
    expect(ids([rule(['patch'], ['apps'], ['deployments'], ['api'])])).not.toContain('patchDeployments');
  });

  it('adds up several rules like RBAC', () => {
    expect(ids([rule(['get'], [''], ['pods/log']), rule(['list', 'watch'], [''], ['pods'])])).not.toContain('logsAll');
  });
});

describe('actionAccess', () => {
  it('maps every allowed action and kind pair, and nothing else', () => {
    for (const action of Object.keys(ACTION_KINDS) as KubeAction[]) {
      for (const kind of ACTION_KINDS[action]) expect(actionAccess(action, kind), `${action} ${kind}`).toBeDefined();
    }
    expect(actionAccess('restart', 'pods')).toBeUndefined();
    expect(actionAccess('delete', 'deployments')).toBeUndefined();
    expect(actionAccess('scale', 'statefulsets')).toBe('patchStatefulSets');
    expect(actionAccess('restart', 'daemonsets')).toBe('patchDaemonSets');
    expect(actionAccess('uncordon', 'nodes')).toBe('patchNodes');
    expect(actionAccess('resume', 'cronjobs')).toBe('patchCronJobs');
    expect(actionAccess('trigger', 'cronjobs')).toBe('trigger');
    expect(actionAccess('delete', 'jobs')).toBe('deleteJobs');
  });
});
```

#### A – `src/shared/kubernetes-schema.test.ts`
Zeile 3 importiert zusätzlich `KubeAccessRequestSchema, KubeLogsStartRequestSchema, KubeLogsStopRequestSchema, ` am Anfang der Klammer. Am Dateiende:

```ts
describe('logs and access requests', () => {
  const viewId = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
  const id = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
  const valid = { viewId, id, namespace: 'shop', selector: { app: 'api', 'app.kubernetes.io/instance': 'shop-api' }, format: 'compact' };
  it('accepts a valid start and rejects empty, oversized and malformed selectors', () => {
    expect(KubeLogsStartRequestSchema.safeParse(valid).success).toBe(true);
    expect(KubeLogsStartRequestSchema.safeParse({ ...valid, selector: {} }).success).toBe(false);
    expect(KubeLogsStartRequestSchema.safeParse({ ...valid, selector: Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`k${i}`, 'v'])) }).success).toBe(false);
    expect(KubeLogsStartRequestSchema.safeParse({ ...valid, selector: Object.fromEntries(Array.from({ length: 32 }, (_, i) => [`k${i}`, 'v'])) }).success).toBe(true);
    expect(KubeLogsStartRequestSchema.safeParse({ ...valid, selector: { 'a,b': 'c' } }).success).toBe(false);
    expect(KubeLogsStartRequestSchema.safeParse({ ...valid, selector: { app: 'a,b' } }).success).toBe(false);
    expect(KubeLogsStartRequestSchema.safeParse({ ...valid, selector: { app: 'x!=y' } }).success).toBe(false);
  });
  it('rejects a bad id, namespace or format and unknown fields', () => {
    expect(KubeLogsStartRequestSchema.safeParse({ ...valid, id: 'run-1' }).success).toBe(false);
    expect(KubeLogsStartRequestSchema.safeParse({ ...valid, namespace: 'Shop' }).success).toBe(false);
    expect(KubeLogsStartRequestSchema.safeParse({ ...valid, format: 'ansi' }).success).toBe(false);
    expect(KubeLogsStartRequestSchema.safeParse({ ...valid, container: 'app' }).success).toBe(false);
    expect(KubeLogsStopRequestSchema.safeParse({ viewId, id }).success).toBe(true);
    expect(KubeLogsStopRequestSchema.safeParse({ viewId, id: 'x' }).success).toBe(false);
  });
  it('accepts an access request only with a DNS-1123 namespace', () => {
    expect(KubeAccessRequestSchema.safeParse({ viewId, namespace: 'shop' }).success).toBe(true);
    expect(KubeAccessRequestSchema.safeParse({ viewId, namespace: 'Shop' }).success).toBe(false);
    expect(KubeAccessRequestSchema.safeParse({ viewId, namespace: '' }).success).toBe(false);
    expect(KubeAccessRequestSchema.safeParse({ viewId, namespace: 'shop', verb: 'patch' }).success).toBe(false);
  });
});
```

#### B – `src/main/kubernetes/client-api.test.ts`
- Zeile 8: `import { AuthorizationV1Api, KubeConfig, KubernetesObjectApi, Watch } from '@kubernetes/client-node';`
- Zeile 13: `followLogUrl, ` nach `createKubeApi, `.
- Am Dateiende:

```ts
describe('followed workload logs', () => {
  it('builds the URL with timestamps and either tailLines or sinceTime, names encoded', () => {
    expect(followLogUrl('https://k8s.example:6443', logsTarget, { tailLines: 200 }))
      .toBe('https://k8s.example:6443/api/v1/namespaces/shop/pods/api-1/log?container=app&follow=true&timestamps=true&tailLines=200');
    expect(followLogUrl('https://k8s.example:6443', logsTarget, { sinceTime: '2026-10-25T08:10:00Z' }))
      .toBe('https://k8s.example:6443/api/v1/namespaces/shop/pods/api-1/log?container=app&follow=true&timestamps=true&sinceTime=2026-10-25T08%3A10%3A00Z');
    expect(followLogUrl('https://k8s.example:6443', { ...logsTarget, pod: 'a b', container: 'c&d' }, {}))
      .toBe('https://k8s.example:6443/api/v1/namespaces/shop/pods/a%20b/log?container=c%26d&follow=true&timestamps=true&tailLines=200');
  });

  it('passes the raw bytes on, JSON unchanged and a partial last line without holding it back', async () => {
    const fake = fakeLogRequest();
    const io = fakeIo();
    openLogs(testConfig(), logsTarget, io, fake.sendRequest, { tailLines: 200 });
    await flush();
    expect(fake.calls[0].url).toContain('timestamps=true');
    fake.push('2026-10-25T08:10:00.1Z {"level":"info","msg":"one"}\n2026-10-25T08:10:01Z par');
    await flush();
    expect(Buffer.concat(io.data.mock.calls.map(call => call[0])).toString()).toBe('2026-10-25T08:10:00.1Z {"level":"info","msg":"one"}\n2026-10-25T08:10:01Z par');
    fake.end();
    await flush();
    expect(io.end).toHaveBeenCalledWith(0, undefined);
  });

  it('ends a failed followed log with the mapped error and nothing held back', async () => {
    const io = fakeIo();
    openLogs(testConfig(), logsTarget, io, fakeLogRequest(403).sendRequest, { tailLines: 200 });
    await flush();
    await flush();
    expect(io.data).not.toHaveBeenCalled();
    expect(io.end.mock.calls[0][1]).toMatchObject({ code: 'kubernetes.forbidden' });
  });
});

describe('createKubeApi.rulesReview', () => {
  const withReview = async (answer: () => Promise<unknown>) => {
    const create = vi.fn(answer);
    const spy = vi.spyOn(KubeConfig.prototype, 'makeApiClient').mockReturnValue({ createSelfSubjectRulesReview: create } as never);
    try {
      const result = await createKubeApi(testConfig()).rulesReview('shop');
      return { result, create, clients: spy.mock.calls.map(call => call[0]) };
    } finally {
      spy.mockRestore();
    }
  };

  it('sends one SelfSubjectRulesReview for the namespace through AuthorizationV1Api and takes the rules over', async () => {
    const { result, create, clients } = await withReview(async () => ({ status: { incomplete: false, nonResourceRules: [], resourceRules: [
      { verbs: ['get'], apiGroups: [''], resources: ['pods/log'], resourceNames: [] },
      { verbs: ['patch'], apiGroups: ['apps'], resources: ['deployments'], resourceNames: ['api'] },
    ] } }));
    expect(clients).toEqual([AuthorizationV1Api]);
    expect(create).toHaveBeenCalledWith({ body: { apiVersion: 'authorization.k8s.io/v1', kind: 'SelfSubjectRulesReview', spec: { namespace: 'shop' } } });
    expect(result).toEqual({ incomplete: false, rules: [
      { verbs: ['get'], apiGroups: [''], resources: ['pods/log'] },
      { verbs: ['patch'], apiGroups: ['apps'], resources: ['deployments'], resourceNames: ['api'] },
    ] });
  });

  it('counts a missing status, incomplete and an evaluation error as incomplete', async () => {
    expect((await withReview(async () => ({}))).result.incomplete).toBe(true);
    expect((await withReview(async () => ({ status: { incomplete: true, resourceRules: [], nonResourceRules: [] } }))).result.incomplete).toBe(true);
    expect((await withReview(async () => ({ status: { incomplete: false, evaluationError: 'role.rbac.authorization.k8s.io "gone" not found', resourceRules: [], nonResourceRules: [] } }))).result.incomplete).toBe(true);
  });

  it('maps a forbidden review to a KubeApiError with code 403', async () => {
    await expect(withReview(async () => { throw Object.assign(new Error('Unknown API Status Code!'), { code: 403, body: '{}' }); }))
      .rejects.toMatchObject({ code: 403 });
  });
});
```

#### D – `src/main/kubernetes/workload-logs.test.ts` (neu)

```ts
import { describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { KubeKind, KubeTerminalTarget } from '../../shared/kubernetes';
import { KubeApiError } from './api';
import type { KubeApi, KubeObject, KubeStream, ListResult, LogFollowOptions, TerminalIo, WatchHandle, WatchType } from './api';
import { KubeWorkloadLogs, LOG_BATCH_MS, LOG_RESUME_MS, MAX_LINE_CHARS, cleanLogText, splitTimestamp, startedContainers, type LogsBatch } from './workload-logs';

const settle = () => new Promise(resolve => setImmediate(resolve));

/** Fake timers: nothing runs until the test asks for it. */
class Clock {
  private next = 1;
  readonly tasks = new Map<number, { fn: () => void; ms: number }>();
  readonly schedule = (fn: () => void, ms: number): unknown => {
    const id = this.next++;
    this.tasks.set(id, { fn, ms });
    return id;
  };
  readonly cancel = (handle: unknown): void => { this.tasks.delete(handle as number); };
  /** Runs every pending task with this delay, oldest first. */
  run(ms: number): void {
    for (const [id, task] of [...this.tasks.entries()].filter(([, entry]) => entry.ms === ms)) {
      this.tasks.delete(id);
      task.fn();
    }
  }
}

interface Stream { target: KubeTerminalTarget; options: LogFollowOptions; io: TerminalIo; close: Mock }

class FakeApi implements KubeApi {
  pods: KubeObject[] = [];
  listError?: Error;
  streams: Stream[] = [];
  watchStops: Mock[] = [];
  onEvent?: (type: WatchType, object: KubeObject) => void;
  async list(_kind: KubeKind): Promise<ListResult> {
    if (this.listError) throw this.listError;
    return { items: this.pods, resourceVersion: '1' };
  }
  async watch(_kind: KubeKind, _namespace: string | null, _selector: unknown, _version: string,
    onEvent: (type: WatchType, object: KubeObject) => void): Promise<WatchHandle> {
    this.onEvent = onEvent;
    const stop = vi.fn();
    this.watchStops.push(stop);
    return { stop };
  }
  followLog(target: KubeTerminalTarget, options: LogFollowOptions, io: TerminalIo): KubeStream {
    const close = vi.fn();
    this.streams.push({ target, options, io, close });
    return { write() {}, resize() {}, pause() {}, resume() {}, close };
  }
  read(): never { throw new Error('unused'); }
  eventsFor(): never { throw new Error('unused'); }
  mergePatch(): never { throw new Error('unused'); }
  remove(): never { throw new Error('unused'); }
  createJobFrom(): never { throw new Error('unused'); }
  nodeMetrics(): never { throw new Error('unused'); }
  podMetrics(): never { throw new Error('unused'); }
  openTerminal(): never { throw new Error('unused'); }
  portForward(): never { throw new Error('unused'); }
  rulesReview(): never { throw new Error('unused'); }
}

const running = (startedAt = '2026-10-25T08:00:00Z') => ({ running: { startedAt } });
const pod = (name: string, containers: Record<string, object>, restartCount = 0, lastState?: object): KubeObject => ({
  metadata: { name, namespace: 'shop', uid: `uid-${name}`, resourceVersion: '1' },
  spec: { containers: Object.keys(containers).map(container => ({ name: container })) },
  status: { phase: 'Running', containerStatuses: Object.entries(containers).map(([container, state]) => ({ name: container, restartCount, state, ...(lastState ? { lastState } : {}) })) },
});

async function setup(pods: KubeObject[], format: 'compact' | 'raw' = 'raw') {
  const api = new FakeApi();
  api.pods = pods;
  const clock = new Clock();
  const batches: LogsBatch[] = [];
  const logs = new KubeWorkloadLogs((_owner, _view, batch) => batches.push(batch), clock);
  await logs.start({ ownerId: 1, viewId: 'v', api: async () => api }, { id: 'run', namespace: 'shop', selector: { app: 'api' }, format });
  await settle();
  return { api, clock, batches, logs };
}
const lines = (batches: LogsBatch[]) => batches.flatMap(batch => batch.lines);

describe('splitTimestamp', () => {
  it('pads the fraction to nine digits and keeps the text whole', () => {
    expect(splitTimestamp('2026-10-25T08:10:00.12Z text with  spaces')).toEqual({ time: '2026-10-25T08:10:00.120000000Z', text: 'text with  spaces' });
    expect(splitTimestamp('2026-10-25T08:10:00Z x')).toEqual({ time: '2026-10-25T08:10:00.000000000Z', text: 'x' });
    expect(splitTimestamp('2026-10-25T08:10:00.123456789Z ')).toEqual({ time: '2026-10-25T08:10:00.123456789Z', text: '' });
    expect(splitTimestamp('no stamp')).toBeUndefined();
    expect(splitTimestamp('2026-10-25T08:10:00.1234567890Z too many digits')).toBeUndefined();
  });

  it('turns a zone offset into UTC, so nodes in local time sort with the rest', () => {
    expect(splitTimestamp('2026-10-25T10:10:00.5+02:00 local')).toEqual({ time: '2026-10-25T08:10:00.500000000Z', text: 'local' });
    expect(splitTimestamp('2026-10-25T00:30:00-01:00 west')).toEqual({ time: '2026-10-25T01:30:00.000000000Z', text: 'west' });
    expect(splitTimestamp('2026-13-45T10:10:00+02:00 bad')).toBeUndefined();
  });

  it('sorts as strings in time order', () => {
    const a = splitTimestamp('2026-10-25T08:10:00.9Z a')?.time ?? '';
    const b = splitTimestamp('2026-10-25T08:10:00.10Z b')?.time ?? '';
    expect(b < a).toBe(true);
  });
});

describe('cleanLogText', () => {
  it('removes escape sequences and inner line breaks, replaces control characters and caps the length', () => {
    expect(cleanLogText('\x1b[31mERR\x1b[0m')).toBe('ERR');
    expect(cleanLogText('a\x1b]0;title\x07b')).toBe('ab');
    expect(cleanLogText('a\tb\x07c')).toBe('a b�c');
    expect(cleanLogText('one\r\n    two')).toBe('one     two');
    const long = cleanLogText('x'.repeat(5000));
    expect(long).toHaveLength(MAX_LINE_CHARS + 1);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('startedContainers', () => {
  it('counts running, terminated and a terminated last run; waiting alone does not count', () => {
    const object = pod('p', {
      a: running(), b: { terminated: { startedAt: '2026-10-25T07:00:00Z' } }, c: { waiting: { reason: 'ContainerCreating' } },
    });
    expect(startedContainers(object)).toEqual([
      { container: 'a', instance: `0/${Date.parse('2026-10-25T08:00:00Z')}`, running: true },
      { container: 'b', instance: `0/${Date.parse('2026-10-25T07:00:00Z')}`, running: false },
    ]);
    const crashing = pod('p', { a: { waiting: { reason: 'CrashLoopBackOff' } } }, 3, { terminated: { startedAt: '2026-10-25T07:00:00Z' } });
    expect(startedContainers(crashing)).toEqual([{ container: 'a', instance: `3/${Date.parse('2026-10-25T07:00:00Z')}`, running: false }]);
  });

  it('gives the same instance for a Date from a list and the string from a watch event', () => {
    const fromWatch = startedContainers(pod('p', { a: running('2026-10-25T08:00:00Z') }));
    const fromList = startedContainers(pod('p', { a: { running: { startedAt: new Date('2026-10-25T08:00:00Z') } } }));
    expect(fromList).toEqual(fromWatch);
    expect(startedContainers(pod('p', { a: running() }, 1))[0].instance).not.toBe(fromWatch[0].instance);
  });
});

describe('KubeWorkloadLogs', () => {
  it('opens one stream per started container, pods by name, and batches lines with source and normalised time', async () => {
    const { api, clock, batches } = await setup([pod('b-pod', { app: running() }), pod('a-pod', { app: running(), side: running() })]);
    expect(api.streams.map(stream => `${stream.target.pod}/${stream.target.container}`)).toEqual(['a-pod/app', 'a-pod/side', 'b-pod/app']);
    expect(api.streams.every(stream => stream.options.tailLines === 200 && stream.options.sinceTime === undefined)).toBe(true);
    expect(api.streams[0].target).toEqual({ namespace: 'shop', pod: 'a-pod', container: 'app', mode: 'logs' });
    api.streams[2].io.data(Buffer.from('2026-10-25T08:10:00.1Z first\n2026-10-25T08:10:0'));
    api.streams[2].io.data(Buffer.from('1Z second\n'));
    clock.run(LOG_BATCH_MS);
    expect(batches).toHaveLength(1);
    expect(batches[0].sources).toEqual([
      { pod: 'a-pod', container: 'app', live: true }, { pod: 'a-pod', container: 'side', live: true }, { pod: 'b-pod', container: 'app', live: true },
    ]);
    expect(batches[0].lines).toEqual([
      { source: 2, time: '2026-10-25T08:10:00.100000000Z', text: 'first' },
      { source: 2, time: '2026-10-25T08:10:01.000000000Z', text: 'second' },
    ]);
  });

  it('reports a first batch without pods and formats compact lines without escape sequences', async () => {
    const empty = await setup([]);
    empty.clock.run(LOG_BATCH_MS);
    expect(empty.batches).toEqual([{ id: 'run', lines: [], sources: [], waiting: 0, dropped: 0 }]);
    const compact = await setup([pod('a', { app: running() })], 'compact');
    compact.api.streams[0].io.data(Buffer.from('2026-10-25T08:10:00Z {"level":"error","msg":"x"}\n'));
    compact.clock.run(LOG_BATCH_MS);
    expect(lines(compact.batches)[0].text).toBe('ERROR x');
  });

  it('opens at most 20 streams, counts the rest as waiting and moves the next one up when a stream ends', async () => {
    const pods = Array.from({ length: 25 }, (_, i) => pod(`p${String(i).padStart(2, '0')}`, { app: running() }));
    const { api, clock, batches } = await setup(pods);
    expect(api.streams).toHaveLength(20);
    clock.run(LOG_BATCH_MS);
    expect(batches.at(-1)?.waiting).toBe(5);
    api.streams[0].io.end(0);
    expect(api.streams).toHaveLength(21);
    expect(api.streams[20].target.pod).toBe('p20');
    clock.run(LOG_BATCH_MS);
    expect(batches.at(-1)?.waiting).toBe(4);
  });

  it('keeps an instance that ended with an error, and reads a new instance from the second of the last line without duplicates', async () => {
    const { api, clock, batches } = await setup([pod('a', { app: running() })]);
    api.streams[0].io.data(Buffer.from('2026-10-25T08:10:05.5Z before\n'));
    api.streams[0].io.end(null, { code: 'kubernetes.connectionReset' });
    clock.run(LOG_BATCH_MS);
    expect(batches.at(-1)?.sources[0]).toEqual({ pod: 'a', container: 'app', live: false, error: { code: 'kubernetes.connectionReset' } });
    api.onEvent?.('MODIFIED', { ...pod('a', { app: running() }), metadata: { name: 'a', namespace: 'shop', uid: 'uid-a', resourceVersion: '2' } });
    clock.run(250);
    expect(api.streams).toHaveLength(1);
    expect(clock.tasks.size === 0 || [...clock.tasks.values()].every(task => task.ms !== LOG_RESUME_MS)).toBe(true);
    api.onEvent?.('MODIFIED', { ...pod('a', { app: running('2026-10-25T08:11:00Z') }, 1), metadata: { name: 'a', namespace: 'shop', uid: 'uid-a', resourceVersion: '3' } });
    clock.run(250);
    expect(api.streams).toHaveLength(2);
    expect(api.streams[1].options).toEqual({ sinceTime: '2026-10-25T08:10:05Z' });
    api.streams[1].io.data(Buffer.from('2026-10-25T08:10:05.2Z old\n2026-10-25T08:10:05.5Z same\n2026-10-25T08:10:05.6Z new\n2026-10-25T08:10:04Z later old\n'));
    clock.run(LOG_BATCH_MS);
    expect(lines(batches).map(line => line.text)).toEqual(['before', 'new', 'later old']);
  });

  it('resumes a running container after a clean end (idle timeout of a proxy), never a terminated one', async () => {
    const { api, clock } = await setup([pod('a', { app: running() }), pod('b', { app: { terminated: { startedAt: '2026-10-25T07:00:00Z' } } })]);
    expect(api.streams).toHaveLength(2);
    api.streams[0].io.data(Buffer.from('2026-10-25T08:10:05Z quiet\n'));
    api.streams[0].io.end(0);
    api.streams[1].io.end(0);
    expect(api.streams).toHaveLength(2);
    clock.run(LOG_RESUME_MS);
    expect(api.streams).toHaveLength(3);
    expect(api.streams[2].target.pod).toBe('a');
    expect(api.streams[2].options).toEqual({ sinceTime: '2026-10-25T08:10:05Z' });
    clock.run(LOG_RESUME_MS);
    expect(api.streams).toHaveLength(3);
  });

  it('drops the oldest lines of a flood and says how many', async () => {
    const { api, clock, batches } = await setup([pod('a', { app: running() })]);
    api.streams[0].io.data(Buffer.from(Array.from({ length: 2500 }, (_, i) => `2026-10-25T08:10:00Z line ${i}\n`).join('')));
    clock.run(LOG_BATCH_MS);
    expect(batches.at(-1)?.lines).toHaveLength(2000);
    expect(batches.at(-1)?.lines[0].text).toBe('line 500');
    expect(batches.at(-1)?.dropped).toBe(500);
    api.streams[0].io.data(Buffer.from(Array.from({ length: 4500 }, (_, i) => `2026-10-25T08:10:01Z more ${i}\n`).join('')));
    clock.run(LOG_BATCH_MS);
    expect(batches.at(-1)?.lines).toHaveLength(2000);
    expect(batches.at(-1)?.lines.at(-1)?.text).toBe('more 4499');
    expect(batches.at(-1)?.dropped).toBe(500 + 2500);
  });

  it('stops streams, watcher and timers; later data, ends and timers send nothing; stop with another id keeps the run', async () => {
    const { api, clock, batches, logs } = await setup([pod('a', { app: running() })]);
    logs.stop('v', 'other');
    expect(api.streams[0].close).not.toHaveBeenCalled();
    api.streams[0].io.data(Buffer.from('2026-10-25T08:10:00Z x\n'));
    logs.stop('v', 'run');
    expect(api.streams[0].close).toHaveBeenCalledTimes(1);
    expect(api.watchStops[0]).toHaveBeenCalledTimes(1);
    expect(clock.tasks.size).toBe(0);
    api.streams[0].io.data(Buffer.from('2026-10-25T08:10:01Z y\n'));
    api.streams[0].io.end(0);
    clock.run(LOG_BATCH_MS);
    clock.run(LOG_RESUME_MS);
    expect(batches).toEqual([]);
  });

  it('replaces the run of a view on a new start and reports a watcher error in the batch', async () => {
    const first = await setup([pod('a', { app: running() })]);
    await first.logs.start({ ownerId: 1, viewId: 'v', api: async () => first.api }, { id: 'run2', namespace: 'shop', selector: { app: 'api' }, format: 'raw' });
    expect(first.api.streams[0].close).toHaveBeenCalledTimes(1);
    const denied = new FakeApi();
    denied.listError = new KubeApiError('Forbidden', 403, { code: 'kubernetes.forbidden' });
    const clock = new Clock();
    const batches: LogsBatch[] = [];
    const logs = new KubeWorkloadLogs((_owner, _view, batch) => batches.push(batch), clock);
    await logs.start({ ownerId: 1, viewId: 'v', api: async () => denied }, { id: 'run', namespace: 'shop', selector: { app: 'api' }, format: 'raw' });
    await settle();
    clock.run(LOG_BATCH_MS);
    expect(batches.at(-1)?.error).toEqual({ code: 'kubernetes.forbidden' });
    logs.stopAll();
  });

  it('forgets the run when the cluster does not get ready and passes the error on', async () => {
    const api = new FakeApi();
    const logs = new KubeWorkloadLogs(() => {}, new Clock());
    await expect(logs.start({ ownerId: 1, viewId: 'v', api: async () => { throw new Error('not ready'); } }, { id: 'run', namespace: 'shop', selector: { app: 'api' }, format: 'raw' }))
      .rejects.toThrow('not ready');
    logs.stop('v', 'run');
    expect(api.streams).toEqual([]);
  });
});
```

#### H – `src/main/kubernetes/session.test.ts`, am Dateiende (dazu K5)

```ts
suite('logs of all pods and the rights pre-check of a view', () => {
  const request = { id: '1b4e28ba-2fa1-41d2-883f-0016d3cca427', namespace: 'shop', selector: { app: 'api' }, format: 'raw' as const };
  const logsOf = (world: World, viewId: string) => eventsOf(world, 'logs', viewId);

  it('answers the denied functions, and null when the review is incomplete, fails or hangs', async () => {
    const world = setup();
    const { viewId } = world.sessions.open(1, 'c1');
    await settle();
    expect((await world.sessions.access(1, viewId, 'shop'))?.map(item => item.id)).toContain('patchDeployments');
    world.api.rules = { incomplete: false, rules: [{ verbs: ['*'], apiGroups: ['*'], resources: ['*'] }] };
    expect(await world.sessions.access(1, viewId, 'shop')).toEqual([]);
    world.api.rules = { incomplete: true, rules: [] };
    expect(await world.sessions.access(1, viewId, 'shop')).toBeNull();
    world.api.rules = new KubeApiError('Forbidden', 403, { code: 'kubernetes.forbidden' });
    expect(await world.sessions.access(1, viewId, 'shop')).toBeNull();
    world.api.rulesReview = () => new Promise(() => {});
    const hanging = world.sessions.access(1, viewId, 'shop');
    world.clock.run(10_000);
    expect(await hanging).toBeNull();
    await expect(world.sessions.access(2, viewId, 'shop')).rejects.toMatchObject({ code: 'kubernetes.viewUnavailable' });
  });

  it('refuses the pre-check while the cluster is not ready', async () => {
    const world = setup();
    const { viewId } = world.sessions.open(1, 'c1');
    await expect(world.sessions.access(1, viewId, 'shop')).rejects.toMatchObject({ code: 'kubernetes.notConnected' });
  });

  it('starts on a read-only cluster, refuses a disabled one and sends the batches as logs events of the view', async () => {
    const world = setup();
    world.cluster.readOnly = true;
    world.api.pods = [pod('p1')];
    world.api.pods[0].status = { phase: 'Running', containerStatuses: [{ name: 'app', restartCount: 0, state: { running: { startedAt: '2026-10-25T08:00:00Z' } } }] };
    const { viewId } = world.sessions.open(1, 'c1');
    await settle();
    await world.sessions.startLogs(1, viewId, request);
    await settle();
    expect(world.api.logStreams.map(stream => stream.target)).toEqual([{ namespace: 'shop', pod: 'p1', container: 'app', mode: 'logs' }]);
    world.api.logStreams[0].io.data(Buffer.from('2026-10-25T08:10:00Z hello\n'));
    world.clock.run(250);
    world.clock.run(250);
    expect(logsOf(world, viewId).at(-1)).toMatchObject({ type: 'logs', viewId, id: request.id, lines: [{ source: 0, text: 'hello' }], sources: [{ pod: 'p1', container: 'app', live: true }] });
    world.cluster.disabled = true;
    await expect(world.sessions.startLogs(1, viewId, request)).rejects.toMatchObject({ code: 'kubernetes.disabled' });
  });

  it('ends the run with stopLogs of its id only, with the view, with closeAll and when the connection drops', async () => {
    const world = setup();
    world.api.pods = [pod('p1')];
    world.api.pods[0].status = { phase: 'Running', containerStatuses: [{ name: 'app', restartCount: 0, state: { running: { startedAt: '2026-10-25T08:00:00Z' } } }] };
    const first = world.sessions.open(1, 'c1').viewId;
    await settle();
    await world.sessions.startLogs(1, first, request);
    await settle();
    world.sessions.stopLogs(1, first, '2c5ea4c0-4067-11e9-8bad-9b1deb4d3b7d');
    expect(world.api.logStreams[0].close).not.toHaveBeenCalled();
    world.sessions.stopLogs(1, first, request.id);
    expect(world.api.logStreams[0].close).toHaveBeenCalledTimes(1);

    await world.sessions.startLogs(1, first, request);
    await settle();
    world.sessions.close(1, first);
    expect(world.api.logStreams[1].close).toHaveBeenCalledTimes(1);

    const second = world.sessions.open(1, 'c1').viewId;
    await world.sessions.startLogs(1, second, request);
    await settle();
    world.accesses[0].drop();
    world.clock.run(HEALTH_MS);
    // The old API client must not be used after a reconnect: the run ends with the live connection.
    expect(world.api.logStreams[2].close).toHaveBeenCalledTimes(1);

    const third = world.sessions.open(1, 'c1').viewId;
    world.clock.run(10);
    await settle();
    await world.sessions.startLogs(1, third, request);
    await settle();
    world.sessions.closeAll();
    expect(world.api.logStreams.at(-1)?.close).toHaveBeenCalledTimes(1);
  });

  it('drops a run whose view closed while it started', async () => {
    const world = setup();
    const { viewId } = world.sessions.open(1, 'c1');
    await settle();
    const starting = world.sessions.startLogs(1, viewId, request);
    world.sessions.close(1, viewId);
    await expect(starting).rejects.toMatchObject({ code: 'kubernetes.viewUnavailable' });
  });
});
```

#### E – `src/renderer/src/kube-logs.test.ts` (neu)

```ts
import { describe, expect, it } from 'vitest';
import type { KubeLogLine, KubeLogSource } from '../../shared/kubernetes';
import { highlightParts, logTime, logsText, mergeLines, shownLines, toggleSource, type LogEntry } from './kube-logs';

const T = (second: number, fraction = 0) => `2026-10-25T08:10:${String(second).padStart(2, '0')}.${String(fraction).padStart(9, '0')}Z`;
const line = (source: number, time: string, text: string): KubeLogLine => ({ source, time, text });
const texts = (entries: LogEntry[]) => entries.map(entry => entry.text);
const sources: KubeLogSource[] = [{ pod: 'api-x7k2p', container: 'main', live: true }, { pod: 'worker-q9m4d', container: 'main', live: false }];

describe('mergeLines', () => {
  it('sorts interleaved sources by time and keeps arrival order for equal times', () => {
    const merged = mergeLines([], [line(0, T(1), 'a1'), line(0, T(3), 'a3'), line(1, T(2), 'b2'), line(1, T(3), 'b3'), line(1, T(1), 'b1')], 0, 100);
    expect(texts(merged)).toEqual(['a1', 'b1', 'b2', 'a3', 'b3']);
    expect(merged.map(entry => entry.seq)).toEqual([0, 4, 2, 1, 3]);
  });

  it('puts a late older line in its place, appends lines without time and keeps the newest max', () => {
    const first = mergeLines([], [line(0, T(1), 'one'), line(0, T(5), 'five')], 0, 3);
    const second = mergeLines(first, [line(1, T(3), 'three'), line(1, '', 'no time')], 2, 3);
    expect(texts(second)).toEqual(['three', 'five', 'no time']);
    expect(second.map(entry => entry.seq)).toEqual([2, 1, 3]);
    expect(first).toHaveLength(2);
  });

  it('compares nine fraction digits as strings', () => {
    expect(texts(mergeLines([], [line(0, T(1, 900000000), 'later'), line(1, T(1, 100000000), 'earlier')], 0, 10))).toEqual(['earlier', 'later']);
  });
});

describe('shownLines', () => {
  const entries = mergeLines([], [line(0, T(1), 'GET /health ok'), line(1, T(2), 'ERROR job failed'), line(0, T(3), 'error: timeout'), line(1, T(4), 'done')], 0, 100);

  it('filters by text and by the pod in the prefix, ignoring case, and leaves out hidden sources', () => {
    expect(texts(shownLines(entries, sources, new Set(), 'Error').lines)).toEqual(['ERROR job failed', 'error: timeout']);
    expect(texts(shownLines(entries, sources, new Set(), 'WORKER-q9').lines)).toEqual(['ERROR job failed', 'done']);
    expect(texts(shownLines(entries, sources, new Set([1]), '').lines)).toEqual(['GET /health ok', 'error: timeout']);
    expect(texts(shownLines(entries, sources, new Set(), '  ').lines)).toHaveLength(4);
  });

  it('gives the newest matches up to the limit and counts the older ones', () => {
    expect(shownLines(entries, sources, new Set(), '', 3)).toEqual({ lines: entries.slice(1), hiddenOlder: 1 });
    expect(shownLines(entries, sources, new Set(), '', Number.POSITIVE_INFINITY).hiddenOlder).toBe(0);
  });
});

describe('text helpers', () => {
  it('marks every match and returns one part without a filter', () => {
    expect(highlightParts('Error and error', 'ERROR')).toEqual([
      { text: 'Error', mark: true }, { text: ' and ', mark: false }, { text: 'error', mark: true },
    ]);
    expect(highlightParts('abc', '')).toEqual([{ text: 'abc', mark: false }]);
    expect(highlightParts('abc', 'x')).toEqual([{ text: 'abc', mark: false }]);
  });

  it('shows the UTC time with milliseconds and copies prefix, time and text', () => {
    expect(logTime(T(7, 123456789))).toBe('08:10:07.123');
    expect(logTime('')).toBe('');
    const entries = mergeLines([], [line(0, T(1), 'one'), line(1, '', 'two')], 0, 10);
    expect(logsText(entries, sources)).toBe('api-x7k2p/main 08:10:01.000 one\nworker-q9m4d/main  two');
  });

  it('toggles a source', () => {
    const hidden = toggleSource(new Set(), 1);
    expect([...hidden]).toEqual([1]);
    expect([...toggleSource(hidden, 1)]).toEqual([]);
  });
});
```

#### E – `src/renderer/src/kube-access.test.ts` (neu)

```ts
import { describe, expect, it } from 'vitest';
import type { ClusterStatus } from '../../shared/kubernetes';
import { accessNamespace, accessStale, refAccessReason, type KubeAccessMap } from './kube-access';

const READY: ClusterStatus = { state: 'ready', name: 'c', production: false, readOnly: false, metrics: true, namespace: 'shop' };
const pod = { kind: 'pods' as const, namespace: 'shop', name: 'api-1' };
const node = { kind: 'nodes' as const, name: 'worker2' };

describe('accessNamespace', () => {
  it('uses the namespace of the object, the default namespace for cluster-wide kinds, else default', () => {
    expect(accessNamespace(pod, null)).toBe('shop');
    expect(accessNamespace(node, READY)).toBe('shop');
    expect(accessNamespace(node, { ...READY, namespace: undefined })).toBe('default');
    expect(accessNamespace(node, null)).toBe('default');
  });
});

describe('accessStale', () => {
  it('is stale without an answer and after 60 s', () => {
    const access: KubeAccessMap = { shop: { at: 1_000_000, denied: [] } };
    expect(accessStale(access, 'monitoring', 1_000_000)).toBe(true);
    expect(accessStale(access, 'shop', 1_000_000 + 59_000)).toBe(false);
    expect(accessStale(access, 'shop', 1_000_000 + 60_000)).toBe(false);
    expect(accessStale(access, 'shop', 1_000_000 + 61_000)).toBe(true);
  });
});

describe('refAccessReason', () => {
  const access: KubeAccessMap = {
    shop: { at: 1, denied: [{ id: 'shell', verb: 'create', resource: 'pods/exec' }, { id: 'patchNodes', verb: 'patch', resource: 'nodes' }] },
    monitoring: { at: 1, denied: null },
  };
  it('names verb, resource and namespace, cluster-wide for nodes', () => {
    expect(refAccessReason(access, READY, pod, 'shell')).toBe('Keine Berechtigung: create auf pods/exec in shop');
    expect(refAccessReason(access, READY, node, 'patchNodes')).toBe('Keine Berechtigung: patch auf nodes (clusterweit)');
  });
  it('blocks nothing that is allowed, unknown (null) or not asked yet', () => {
    expect(refAccessReason(access, READY, pod, 'logs')).toBeUndefined();
    expect(refAccessReason(access, READY, { ...pod, namespace: 'monitoring' }, 'shell')).toBeUndefined();
    expect(refAccessReason(access, READY, { ...pod, namespace: 'kube-system' }, 'shell')).toBeUndefined();
    expect(refAccessReason({}, READY, node, 'patchNodes')).toBeUndefined();
  });
});
```

#### E – `src/renderer/src/kube-view.test.ts`, am Dateiende

```ts
describe('rights pre-check and logs of all pods', () => {
  const ready = kubeViewReducer(initialKubeView('shop'), { type: 'event', event: { type: 'status', viewId: 'v1', status } });
  const entry = { at: 1, denied: [{ id: 'shell' as const, verb: 'create', resource: 'pods/exec' }] };

  it('keeps one answer per namespace while ready and ignores answers that land while not ready', () => {
    expect(initialKubeView('shop').access).toEqual({});
    const one = kubeViewReducer(ready, { type: 'access', namespace: 'shop', entry });
    const two = kubeViewReducer(one, { type: 'access', namespace: 'monitoring', entry: { at: 2, denied: null } });
    expect(two.access).toEqual({ shop: entry, monitoring: { at: 2, denied: null } });
    const notReady = kubeViewReducer(initialKubeView('shop'), { type: 'access', namespace: 'shop', entry });
    expect(notReady.access).toEqual({});
  });

  it('empties the answers whenever the cluster is not ready and keeps them on ready', () => {
    const filled = kubeViewReducer(ready, { type: 'access', namespace: 'shop', entry });
    expect(kubeViewReducer(filled, { type: 'event', event: { type: 'status', viewId: 'v1', status: { ...status, metrics: false } } }).access).toEqual({ shop: entry });
    expect(kubeViewReducer(filled, { type: 'event', event: { type: 'status', viewId: 'v1', status: { ...status, state: 'reconnecting' } } }).access).toEqual({});
  });

  it('returns the same state for a logs event and never saves the answers', () => {
    const filled = kubeViewReducer(ready, { type: 'access', namespace: 'shop', entry });
    const event: KubeEvent = { type: 'logs', viewId: 'v1', id: 'r', lines: [], sources: [], waiting: 0, dropped: 0 };
    expect(kubeViewReducer(filled, { type: 'event', event })).toBe(filled);
    expect(JSON.stringify(snapshotOf(filled))).not.toContain('access');
  });
});
```

#### I1 – `src/renderer/src/kube-menu-run.test.ts`
- Im Fake-Runner (`:7`) wird `help: vi.fn(), forward: vi.fn(),` zu `help: vi.fn(), forward: vi.fn(), logsAll: vi.fn(),`.
- In der Fallliste nach `[{ type: 'forward', row: forwardRow }, 'forward', [forwardRow]],` diese Zeile einfügen:

```ts
      [{ type: 'logsAll', row: forwardRow }, 'logsAll', [forwardRow]],
```

#### I1 – `src/renderer/src/kube-commands.test.ts`, am Dateiende

```ts
describe('rights pre-check in actions and keys', () => {
  const FORBIDDEN_PATCH = 'Keine Berechtigung: patch auf deployments in shop';
  const denied = (...items: { id: 'patchDeployments' | 'deleteJobs' | 'shell' | 'logs'; verb: string; resource: string }[]) => ({ shop: { at: 1, denied: items } });
  const command = (id: string) => KUBE_COMMANDS.find(c => c.id === id)!;

  it('puts the missing right after every other reason and blocks nothing when unknown', () => {
    const access = denied({ id: 'patchDeployments', verb: 'patch', resource: 'deployments' });
    const right = ref('deployments');
    expect(actionReason('restart', { ref: right, readOnly: false, connected: true, access, status: READY })).toBe(FORBIDDEN_PATCH);
    expect(actionReason('scale', { ref: right, readOnly: false, connected: true, access, status: READY })).toBe(FORBIDDEN_PATCH);
    expect(actionReason('restart', { ref: right, readOnly: true, connected: true, access, status: READY })).toBe('Dieser Cluster ist schreibgeschützt.');
    expect(actionReason('restart', { ref: ref('pods'), readOnly: false, connected: true, access, status: READY })).toMatch(/^Nur für /);
    expect(actionReason('restart', { ref: right, readOnly: false, connected: true, access: { shop: { at: 1, denied: null } }, status: READY })).toBeUndefined();
    expect(actionReason('restart', { ref: right, readOnly: false, connected: true, access: {}, status: READY })).toBeUndefined();
    expect(actionReason('restart', { ref: right, readOnly: false, connected: true })).toBeUndefined();
  });

  it('gives r, S, Ctrl+d, s, l and p the reason of the selected row', () => {
    const deployments = { ...withRow('deployments'), access: denied({ id: 'patchDeployments', verb: 'patch', resource: 'deployments' }) };
    expect(command('restart').unavailable?.({ state: deployments, readOnly: false })).toBe(FORBIDDEN_PATCH);
    expect(command('scale').unavailable?.({ state: deployments, readOnly: false })).toBe(FORBIDDEN_PATCH);
    const jobs = { ...withRow('jobs'), access: denied({ id: 'deleteJobs', verb: 'delete', resource: 'jobs' }) };
    expect(command('delete').unavailable?.({ state: jobs, readOnly: false })).toBe('Keine Berechtigung: delete auf jobs in shop');
    const pods = { ...withRow('pods', 'Running'), access: denied({ id: 'shell', verb: 'create', resource: 'pods/exec' }, { id: 'logs', verb: 'get', resource: 'pods/log' }) };
    expect(command('shell').unavailable?.({ state: pods, readOnly: false })).toBe('Keine Berechtigung: create auf pods/exec in shop');
    expect(command('logs').unavailable?.({ state: pods, readOnly: false })).toBe('Keine Berechtigung: get auf pods/log in shop');
    expect(command('previous').unavailable?.({ state: pods, readOnly: false })).toBe('Keine Berechtigung: get auf pods/log in shop');
    expect(command('shell').unavailable?.({ state: { ...pods, rows: [row('pods', 'Completed')] }, readOnly: false })).toBe('Der Pod läuft nicht.');
    expect(command('logs').unavailable?.({ state: { ...withRow('deployments'), access: pods.access }, readOnly: false })).toBe('Nur für Pods.');
  });
});
```

#### I1 – `src/renderer/src/kube-menus.test.ts`, dazu K11
Nach Zeile 2 `import type { KubeDenied } from '../../shared/kube-access';` einfügen. Am Dateiende:

```ts
describe('logs of all pods and the rights pre-check in menus', () => {
  const FORBIDDEN_PATCH = 'Keine Berechtigung: patch auf deployments in shop';
  const withAccess = (denied: KubeDenied[] | null, status: ClusterStatus = READY): MenuContext =>
    context({ status, state: state({ status, access: { shop: { at: NOW, denied } } }) });
  const job = row('jobs', 'backup-1', { selector: { 'job-name': 'backup-1' } });
  const service = row('services', 'web', { selector: { app: 'web' }, ports: [{ port: 80 }] });

  it('offers Logs aller Pods before Events for workloads, jobs and services, and runs logsAll', () => {
    for (const target of [deployment(), row('statefulsets', 'db', { selector: { app: 'db' } }), row('daemonsets', 'agent', { selector: { app: 'agent' } }), job, service]) {
      const labelsOf = labels(rowMenu(target));
      expect(labelsOf.indexOf('Logs aller Pods'), target.ref.kind).toBe(labelsOf.indexOf('Events') - 1);
      expect(find(rowMenu(target), 'logs-all')).toMatchObject({ run: { type: 'logsAll', row: target } });
      expect(find(rowMenu(target), 'logs-all').disabled).toBeUndefined();
    }
    expect(has(rowMenu(pod()), 'logs-all')).toBe(false);
    expect(has(rowMenu(row('cronjobs', 'nightly')), 'logs-all')).toBe(false);
  });

  it('greys it out without a selector, while not connected and without the right; read-only allows it', () => {
    expect(find(rowMenu(deployment({ selector: undefined })), 'logs-all').hint).toBe(t('kubeActions:reasons.noSelectorWorkload'));
    expect(find(rowMenu({ ...job, selector: undefined }), 'logs-all').hint).toBe(t('kubeActions:reasons.noSelectorJob'));
    expect(find(rowMenu({ ...service, selector: {} }), 'logs-all').hint).toBe(t('kubeActions:reasons.noSelectorService'));
    expect(find(rowMenu(deployment(), withStatus(RECONNECTING)), 'logs-all').hint).toBe(RECONNECTING_MESSAGE);
    expect(find(rowMenu(deployment(), withAccess([{ id: 'logsAll', verb: 'watch', resource: 'pods' }])), 'logs-all').hint).toBe('Keine Berechtigung: watch auf pods in shop');
    expect(find(rowMenu(deployment(), withStatus(READ_ONLY)), 'logs-all').disabled).toBeUndefined();
  });

  it('greys out restart and scale without patch, nothing when the rights are unknown, read-only first', () => {
    const entries = rowMenu(deployment(), withAccess([{ id: 'patchDeployments', verb: 'patch', resource: 'deployments' }]));
    expect(find(entries, 'restart')).toMatchObject({ disabled: true, hint: FORBIDDEN_PATCH });
    expect(find(entries, 'scale')).toMatchObject({ disabled: true, hint: FORBIDDEN_PATCH });
    const unknown = rowMenu(deployment(), withAccess(null));
    expect(find(unknown, 'restart').disabled).toBeUndefined();
    expect(find(unknown, 'scale').disabled).toBeUndefined();
    expect(find(rowMenu(deployment(), withAccess([{ id: 'patchDeployments', verb: 'patch', resource: 'deployments' }], READ_ONLY)), 'restart').hint).toBe(READ_ONLY_MESSAGE);
  });

  it('says cluster-wide for nodes and checks them with the default namespace', () => {
    const ctx = withAccess([{ id: 'patchNodes', verb: 'patch', resource: 'nodes' }]);
    expect(find(menu({ type: 'node', tile: tile() }, ctx), 'cordon').hint).toBe('Keine Berechtigung: patch auf nodes (clusterweit)');
    expect(find(rowMenu(node(), ctx), 'cordon').hint).toBe('Keine Berechtigung: patch auf nodes (clusterweit)');
  });

  it('gives logs, shell, forward and the tab entries of a pod their right, after Pod läuft nicht', () => {
    const ctx = withAccess([
      { id: 'logs', verb: 'get', resource: 'pods/log' }, { id: 'shell', verb: 'create', resource: 'pods/exec' }, { id: 'forward', verb: 'create', resource: 'pods/portforward' },
    ]);
    const entries = rowMenu(singlePod(), ctx);
    expect(find(entries, 'logs').hint).toBe('Keine Berechtigung: get auf pods/log in shop');
    expect(find(entries, 'previous').hint).toBe('Keine Berechtigung: get auf pods/log in shop');
    expect(find(entries, 'shell').hint).toBe('Keine Berechtigung: create auf pods/exec in shop');
    expect(find(entries, 'forward').hint).toBe('Keine Berechtigung: create auf pods/portforward in shop');
    expect(find(entries, 'popout-logs').hint).toBe('Keine Berechtigung: get auf pods/log in shop');
    expect(find(entries, 'popout-shell').hint).toBe('Keine Berechtigung: create auf pods/exec in shop');
    const stopped = rowMenu(pod({ containers: ['api'], cells: { status: 'Completed' } }), ctx);
    expect(find(stopped, 'shell').hint).toBe(t('kubeActions:reasons.notRunning'));
    expect(find(stopped, 'forward').hint).toBe(t('kubeActions:reasons.notRunning'));
  });

  it('checks the logs entries of problems, events and the dock', () => {
    const ctx = withAccess([{ id: 'logs', verb: 'get', resource: 'pods/log' }, { id: 'shell', verb: 'create', resource: 'pods/exec' }]);
    const reason = 'Keine Berechtigung: get auf pods/log in shop';
    expect(find(menu({ type: 'problem', problem: problem('crashloop') }, ctx), 'logs').hint).toBe(reason);
    expect(find(menu({ type: 'problem', problem: problem('crashloop') }, ctx), 'previous').hint).toBe(reason);
    const event = row('events', 'e1', { cells: { object: 'Pod/api-1' }, involved: { kind: 'Pod', name: 'api-1', ref: { kind: 'pods', namespace: 'shop', name: 'api-1' } } });
    expect(find(rowMenu(event, ctx), 'involved-logs').hint).toBe(reason);
    const dockEntries = menu({ type: 'dock', mode: 'logs', pod: singlePod(), container: 'api', previous: false }, ctx);
    expect(find(dockEntries, 'mode-logs').hint).toBe(reason);
    expect(find(dockEntries, 'previous').hint).toBe(reason);
    expect(find(dockEntries, 'mode-shell').hint).toBe('Keine Berechtigung: create auf pods/exec in shop');
  });
});
```

### K13 – Doku (Tasks F und T): Fundstellen, Texte, Tabellen
**Handbuch `docs/handbuch.md`:**
- `:541` wird zu ``Entscheidung. „Nur lesen“ sperrt Restart, Scale, Löschen und die Shell; Logs, `Logs aller Pods`, YAML,`` (Zeile 542 bleibt).
- Die zwei Unterabschnitte aus Spec 5 stehen nach dem Abschnitt `### Port weiterleiten` (`:583`), direkt vor `## Dateiansicht: Tastatur und Übertragungen` (`:596`), mit drei Änderungen:
  - **Rollouts:** Nach „Startet ein Container neu, liest Shellherd ab der letzten Zeile weiter.“ folgen zwei Sätze. Erstens: „Beendet ein Proxy oder Load Balancer einen ruhigen Stream, liest Shellherd nach 5 Sekunden weiter.“ Zweitens: „Bricht ein Stream mit Fehler ab, zeigt der Chip „Fehler“ mit dem Grund im Tooltip; `Kompakt`/`Roh` umschalten startet die Ansicht neu.“
  - **Sortierung:** Der erste Satz lautet „nach dem Zeitstempel, den Kubernetes an jede Zeile hängt, in UTC (`HH:MM:SS.mmm`), auch wenn ein Node in Ortszeit läuft.“
  - **Rechte-Vorabprüfung**, erster Punkt, ersetzt durch: „Shellherd fragt höchstens einmal pro Minute und Namespace nach, solange der Cluster-Tab sichtbar ist, und sofort nach einem Neuverbinden. Ein gerade neu vergebenes Recht kann also bis zu einer Minute gesperrt erscheinen.“ Der zweite Punkt nennt nach „ist sie verboten“ zusätzlich „, meldet sie einen Auswertungsfehler (etwa eine Bindung an eine gelöschte Rolle)“.

**Manual `docs/manual.md`:**
- `:530` wird zu ``decision. “Read-only” blocks restart, scale, delete and the shell; logs, `Logs of all pods`, YAML,``.
- Vor `## File view: keyboard and transfers` (`:585`), nach `### Forward port`, wörtlich:

> ### Logs of all pods
>
> Right-click a Deployment, StatefulSet, DaemonSet, Job or Service → `Logs of all pods`. The **Logs** tab in the bottom panel then shows the logs of all its containers together. With the row only selected, `Show logs of all pods` starts the view; scrolling through rows alone never opens streams.
>
> - **Order:** by the timestamp Kubernetes adds to every line, in UTC (`HH:MM:SS.mmm`), even when a node runs in local time. Each line starts with `pod/container` in one of four colours. If the node clocks drift apart, the order across pods can be off by that drift.
> - **Filter and sources:** `Filter` shows only lines that contain the text, in the prefix or the message; matches are marked. Clicking a container chip hides it and shows it again.
> - **Follow:** New lines appear at the bottom. Scroll up and the view stops; `Follow (12 new)` shows what came in, and a click jumps to the end.
> - **Rollouts:** New pods join by themselves as soon as their container runs. Ended pods stay with “ended”. When a container restarts, Shellherd reads on from the last line. When a proxy or load balancer ends a quiet stream, Shellherd reads on after 5 seconds. When a stream fails, its chip shows “error” with the reason in the tooltip; switching `Compact`/`Raw` starts the view again.
> - **`Compact` / `Raw`** work as for single logs; colours from the app are removed. `Copy` takes all matches, including those not shown.
> - **Limits:** at most 20 containers at once (more wait and move up), the last 200 lines per container, 10,000 lines in total, the newest 2,000 matches shown. Lines over 4,000 characters are cut. With more than 8,000 lines per second Shellherd skips some and says so. Only the selector’s `matchLabels` count, as with “Show pods”; init containers are not included.
> - **Permissions:** `list` and `watch` on pods and `get` on `pods/log`. “Read-only” allows the view. Changing the row, the tab or the format ends it; after a reconnect it starts again.
>
> ### Permission pre-check
>
> Shellherd asks once per namespace what the Kubernetes account may do (`SelfSubjectRulesReview`, a pure query with no effect on the cluster). Context menu entries the account may not run are greyed out up front and name the missing permission, e.g. “No permission: patch on deployments in shop”. This covers restart, scale, delete, cordon/uncordon, suspend, resume and `Run now…`, as well as logs, shell, `Logs of all pods` and `Forward port…`. The keys `r`, `S`, `Ctrl+D`, `s`, `l` and `p` report the same reason.
>
> - Shellherd asks at most once a minute per namespace while the cluster tab is visible, and right after a reconnect. A permission granted a moment ago can therefore look blocked for up to a minute.
> - If the cluster cannot answer completely (for example with an external authorizer as on GKE or with Azure RBAC), if the query is forbidden, reports an evaluation error (such as a binding to a deleted role) or takes longer than 10 seconds, Shellherd greys out nothing; a missing permission then shows up as before, when you run the action.
> - Rules that only cover certain object names count as allowed. Only what certainly fails is greyed out.
> - Nodes are checked with the rules of the cluster’s default namespace.

**CHANGELOG.en.md**, ganz oben, `## [0.28.0] – 2026-10-25`:
- New: logs of all pods. Right-click a Deployment, StatefulSet, DaemonSet, Job or Service → `Logs of all pods` shows the logs of all its containers together in the bottom panel, sorted by time and with a coloured `pod/container` prefix. With `Filter`, container chips to hide sources and `Follow`; new pods of a rollout join by themselves.
- New: permission pre-check. Actions the Kubernetes account may not run (restart, scale, delete, cordon, shell, logs, port forward and more) are greyed out in the context menu up front and name the missing permission. Shellherd asks for the permissions once per namespace without changing anything in the cluster; if the cluster cannot answer, everything stays as before.

**README.md:50:** wörtlich wie Spec 5.

**`docs/design-system.md` (Task T), wörtlich statt Spec 3.8:**
- „Roter Faden“, Punkt 3, am Ende: „Einzige Ausnahme sind die vier Quellenfarben `--color-source-1` bis `-4`: Sie unterscheiden nur die Herkunft einer Logzeile in „Logs aller Pods“ und sind nie Zustand, Fläche oder Rand.“
- Farbtabelle, nach der Zeile `--color-danger-border`:

```
| `--color-source-1` | Herkunft einer Logzeile (nur Text): Blau | `#7cb7ff` | `.kube-logs-src-0` |
| `--color-source-2` | Herkunft einer Logzeile (nur Text): Violett | `#c4a5ff` | `.kube-logs-src-1` |
| `--color-source-3` | Herkunft einer Logzeile (nur Text): Türkis | `#5fd4d4` | `.kube-logs-src-2` |
| `--color-source-4` | Herkunft einer Logzeile (nur Text): Magenta | `#e59af0` | `.kube-logs-src-3` |
```

- Tabelle „Helles Theme“, nach der Zeile `--color-danger-border`:

```
| `--color-source-1` | `#1d5fb8` | Herkunft (nur Text): 6,21 Bühne, 5,76 Panel, 5,04 erhöht (Chip); dunkel 9,15 / 8,12 / 7,31 |
| `--color-source-2` | `#6b3fb8` | Herkunft (nur Text): 6,93 Bühne, 6,43 Panel, 5,63 erhöht; dunkel 9,24 / 8,20 / 7,38 |
| `--color-source-3` | `#0f6f73` | Herkunft (nur Text): 5,93 Bühne, 5,50 Panel, 4,81 erhöht; dunkel 10,76 / 9,55 / 8,60 |
| `--color-source-4` | `#9a2f8f` | Herkunft (nur Text): 6,61 Bühne, 6,13 Panel, 5,37 erhöht; dunkel 9,27 / 8,23 / 7,41 |
```

- „Zustände“, Zeile „Gedrückt (`aria-pressed`)“, am Ende der Regel: „Quellen-Chip (`.kube-logs-chip`): an = Quellenfarbe, aus = `--color-text-muted` und durchgestrichen. `Folgen` an = `--color-bg-selected`.“
- Motion-Gate-Tabelle, nach der Zeile „Welcome-Liste, Release-Box“:

```
| „Logs aller Pods“: neue Zeilen, Sprung ans Ende (`.kube-logs-lines`) | laufend, bis 4×/s | nicht | Ausgabe wie Terminal; `Folgen` setzt `scrollTop` ohne `smooth` | – | – |
```

- „Ausnahmeliste für das Druck-Feedback“: nach „`.kube-filter-chip`, “ folgt „`.kube-logs-chip`, “.
- `src/renderer/src/styles.css:157`: `.kube-filter-chip, .kube-node,` → `.kube-filter-chip, .kube-logs-chip, .kube-node,` (Task T).

### K14 – run-app-Listen (Task J), wörtlich statt „in die Liste“
- In `screens.mjs:2` und `SKILL.md:24` wird `kube-forward|settings` zu `kube-forward|kube-logs|settings`.
- `SKILL.md:24`, gleiche Zeile: Vor „ (vault-path ohne Shot, nur Prüfungen)“ steht „, kube-logs erzeugt kube-rbac-menu.png, kube-logs-all.png und kube-logs-all-filter.png“.
- `SKILL.md:34`: Nach „`kube-forward-error.png`, “ steht „`kube-rbac-menu.png`, `kube-logs-all.png`, `kube-logs-all-filter.png`, “.
- `SKILL.md:46`: „liefert eine synthetische Textseite))“ wird zu „liefert eine synthetische Textseite); `pods/<name>/log` mit `timestamps=true` und `tailLines`; `selfsubjectrulesreviews` für `shop`, `monitoring` und sonst 403)“.
- Neuer letzter Punkt unter `## Stolpersteine`:

> - **Logs aller Pods und Rechte (`kube-logs`):** Der Kubernetes-Fake liefert `pods/<name>/log` mit `timestamps=true`: Zeitstempel mit neun Stellen, `tailLines` bis 15 und je Pod eine neue Zeile alle 2 s beim Folgen. `selfsubjectrulesreviews` beantwortet er so:
>   - `shop` mit festen Regeln (`SHOP_RULES` in `kube-fixtures.mjs`): kein `patch` auf Workloads und Nodes, kein `delete` auf Jobs. „Rollout neu starten…“ ist dort gesperrt, obwohl `prod-k8s` nicht „Nur lesen“ ist.
>   - `monitoring` unvollständig (wie ein Webhook-Autorisierer): nichts gesperrt.
>   - jeden anderen Namespace mit 403.
>
>   Nie gegen einen echten Cluster laufen lassen.

- Der Block `kube-logs` (Spec 6.1) steht in `screens.mjs` direkt nach dem Block `async 'kube-forward'() { … },`.

### K15 – Überholte Spec-Aussagen
- **R2.4 „Neu geladen wird nur bei Bedarf, nie periodisch“:** Der Code der Spec lädt über `state.now` periodisch. Das bleibt so und ist jetzt Ruling V5: höchstens einmal pro Minute und Namespace, nur bei sichtbarem Tab. Nur so hält die zugesagte Grenze „höchstens eine Minute zu Unrecht gesperrt“.
- **Spec 10.1 „Eine Rolle wie view (get/list/watch auf alles) sperrt shell, forward …“:** Das ist falsch. `get` auf `*` deckt nach RBAC auch `get pods/exec` und `get pods/portforward`; ältere Cluster lassen damit Shell und Port-Forward zu. Shellherd gibt deshalb frei (fail-open, Pflicht-Test A `fails open: …`). Die eingebaute ClusterRole `view` zählt Ressourcen einzeln auf und sperrt Shell und Forward (Pflicht-Test A).
- **R1.5 „bis zu neun Nachkommastellen und gekürzte Nullen“:** Der Kubelet schreibt genau neun Stellen; das Auffüllen schadet nicht. Neu ist der Zonen-Offset (V4).
- **R1.3/R1.6 und Risiko 7, 8:** „Für dieselbe Instanz öffnet Shellherd nie zweimal“ gilt nur nach einem Ende mit Fehler. Nach einem sauberen Ende eines laufenden Containers liest Shellherd nach 5 s weiter (V3). Dubletten verhindert dabei `skipUntil` wie beim Neustart.
- **R2.5:** „fehlerhaft“ umfasst `evaluationError` (K3).
- **R1.9 Reconnect:** Main beendet den Lauf schon beim Abbau der Verbindung (B3). Der Neustart mit leerem Puffer nach `ready` bleibt.

## 4. Rulings

- **V1 Fail-open der Vorabprüfung, genau so:**
  - `null` (nichts gesperrt) bei:
    - 403 oder anderem Fehler der Review;
    - fehlendem `status`;
    - `incomplete: true`;
    - `evaluationError`;
    - Timeout 10 s;
    - nicht bereiter Session (IPC wirft, der Hook macht `null`);
    - Antwort nach Verbindungsverlust (K6, verworfen).
  - Ohne Eintrag ist nichts gesperrt.
  - `resourceNames` gelten als Erlaubnis.
  - Bei Shell und Forward reicht `create` **oder** `get`.
  - Auswertung wie `rbac/v1` `VerbMatches`, `APIGroupMatches` und `ResourceMatches`: `*`, exakt, `*/<sub>`; `pods/*` zählt nicht.
  - `deployments/scale` erlaubt **kein** Skalieren, denn Shellherd patcht das Objekt selbst (Wahrheitstabelle).
  - Hingenommen: Ein Konto der Gruppe `system:masters` ohne RBAC-Bindung sähe gesperrte Einträge, die gingen. Die Bootstrap-ClusterRoleBinding `cluster-admin` → `system:masters` wird vom API-Server automatisch wiederhergestellt; praktisch tritt das nicht auf.
- **V2 Instanzschlüssel `restartCount/<Epoch-ms>`.** Er ist unabhängig davon, ob der Pod aus der Liste (`Date`) oder dem Watch (ISO-Text) kommt (B1).
- **V3 Weiterlesen nach sauberem Ende:**
  - Endet der Stream eines **laufenden** Containers ohne Fehler, öffnet Shellherd dieselbe Instanz nach `LOG_RESUME_MS = 5000` neu, mit `sinceTime` und `skipUntil`.
  - Grund: Load Balancer und Proxys beenden ruhige Streams. Die HAProxy-Vorlage der kubeadm-HA-Doku nutzt `timeout client/server 35s` im TCP-Modus.
  - Beendete Container und Enden mit Fehler öffnen nie neu; so gibt es keine Schleife.
  - Die Rate ist höchstens 1 Anfrage je 5 s und Quelle.
- **V4 Zeitzone:** `splitTimestamp` nimmt `Z` und `±hh:mm` an und rechnet in UTC um. Ein ungültiges Datum mit Offset zählt als „ohne Zeitstempel“.
- **V5 Auffrischen der Rechte:**
  - Höchstens einmal pro Minute und Namespace, nur bei `ready` **und** sichtbarem Tab.
  - Dazu beim Öffnen eines Kontextmenüs und sofort nach `ready` (der Cache ist dann leer).
  - Versteckte Tabs fragen nicht.
- **V6 Reconnect:**
  - Main stoppt beim Abbau alle Läufe der Session (B3).
  - Der Renderer zeigt bis `ready` den letzten Stand und startet dann über `epoch` neu.
  - `logsAllFor` bleibt beim Reconnect bestehen, anders als die Shell, wie Spec R1.9.
- **V7 Tasten:**
  - `r`, `S`, `Strg+D`, `s`, `l` und `p` sind **nicht still**: `unavailable` liefert den Rechte-Grund, `onKeyDown` zeigt ihn 6 s in der Kopfzeile (`say`).
  - Die Hilfe zeigt ihn ausgegraut. Reihenfolge und Text sind dieselben wie im Menü (Pflicht-Tests I1).
  - `Strg+Umschalt+T` (Popout) und die Dock-Reiter prüfen keine Rechte; das ist ein Nicht-Ziel. Ein fehlendes Recht zeigt sich dort wie heute als 403 im Tab.
- **V8 Dock-Menü:** `Logs` im Dock-Kontextmenü sagt bei Workloads weiterhin „Nur für Pods.“. Den Reiter `Logs` erreicht man per Klick oder über den Menüeintrag „Logs aller Pods“ (Spec R3.1, Extra `l`).
- **V9 Hingenommen, nur als Risiko dokumentiert:**
  - Lange Zeilen, die die Runtime teilt, können einen zweiten Zeitstempel mitten im Text tragen (Kubelet-Verhalten).
  - Bidi-Steuerzeichen im Logtext werden nicht entfernt; sie wirken nur innerhalb der eigenen Zeile, das Präfix steht in einem eigenen Span davor.
  - Der Treffer im Präfix wird nicht markiert, nur gefiltert.
- **V10 Chip „aus“:** `--color-text-muted` plus durchgestrichen, ohne `opacity` (K9).
- **V11 Verb-Prüfung (Nutzer-Ruling R-0):** **kein Blocker**, siehe Abschnitt 5.
- **V12 i18n über zwei Wellen:** Die Aufteilung von `kubeActions.json` (E in Welle 1, I1 in Welle 2) ist im Scratchpad in beiden Wellen grün (`(d)` ohne verwaiste Keys).

## 5. Sicherheitsprüfung

**Neue API-Aufrufe und ihre Verben (Nutzer-Ruling R-0):**

| Aufruf | REST | RBAC-Verb | Befund |
|---|---|---|---|
| `ResourceWatcher` → `api.list('pods', ns, { labels })` | `GET /api/v1/namespaces/{ns}/pods?labelSelector=…` | `list` pods | erlaubt; vorhandener Code |
| `ResourceWatcher` → `api.watch(…)` | `GET …/pods?watch=true&labelSelector=…` | `watch` pods | erlaubt; vorhandener Code |
| `followLog` → `openLogs(…, follow)` | `GET /api/v1/namespaces/{ns}/pods/{pod}/log?container=…&follow=true&timestamps=true&tailLines=200` bzw. `&sinceTime=…` | `get` pods/log | erlaubt |
| `rulesReview` → `AuthorizationV1Api.createSelfSubjectRulesReview` | `POST /apis/authorization.k8s.io/v1/selfsubjectrulesreviews`, Body nur `spec.namespace` | `create` selfsubjectrulesreviews | erlaubt, speichert nichts (unten) |

- **`create` auf SSRR speichert nichts:**
  - Die REST-Storage von `selfsubjectrulesreviews` (`pkg/registry/authorization/selfsubjectrulesreview/rest.go`) hat keinen etcd-Speicher.
  - `Create` ruft nur den Rule-Resolver für den anfragenden Benutzer auf und gibt das Ergebnis in der Antwort zurück. Es entsteht kein Objekt, kein Watch-Ereignis, kein `resourceVersion`; nur das Audit-Log vermerkt die Anfrage.
  - Ein leerer Namespace ergäbe 400; das Schema verlangt DNS-1123.
  - `system:basic-user` erlaubt die Abfrage jedem angemeldeten Konto.
- **Keine weiteren Aufrufe:**
  - Kein `patch`, `update`, `delete`, kein `create` auf Objekte, keine SelfSubjectAccessReview.
  - `actions.ts`, `ConfirmAction`, `runAction` und die Prüfung auf „Nur lesen“ in `KubeSessions.action` sind unverändert.
  - Die einzige Wirkung auf schreibende Aktionen ist die zusätzliche **Sperre** im Renderer (`actionReason`, Menü, Tasten).
- **Fake:** Nicht-GET bleibt 403. Einzige Ausnahme ist `POST …/selfsubjectrulesreviews`.

| Punkt | Befund | Beleg |
|---|---|---|
| Bestätigungspfad | unverändert: Aktionen nur über `ConfirmAction` → `runAction`; Main prüft „Nur lesen“ und 403 wie bisher und verlässt sich nie auf die Vorabprüfung | Code `actions.ts`, `session.ts:569-575` unverändert; Pflicht-Tests I1 (nur Sperren) |
| „Nur lesen“ im Main | `startLogs` und `access` sind lesend und auf „Nur lesen“ erlaubt, auf `disabled` abgelehnt; `action` lehnt „Nur lesen“ weiter ab | Pflicht-Test H (`readOnly`, `disabled`) |
| Keine Exec ohne Klick | kein `exec`; „Logs aller Pods“ startet nur per Menü oder Knopf (`settleArm`), endet beim Auswahlwechsel, wird nicht gespeichert (`snapshotOf` ohne `access` und ohne Lauf) | Pflicht-Test E (`snapshotOf`), Spec 3.12 |
| kubeconfig verlässt den Main nie | `KubeConfig` bleibt in `createKubeApi`; `KubeWorkloadLogs` sieht nur `KubeApi`. Zum Renderer gehen nur Zeilen, Pod- und Container-Namen, Zähler, `CodedError` und `KubeDenied` (die Regeln nicht). Der alte Client wird nach dem Abbau nie benutzt (B3, K4) | Pflicht-Tests H, Mutationsprobe |
| Keine Secrets | `toApiError` gibt nie Rohtexte weiter; Logzeilen nur zur Anzeige, nichts an die KI (R4.2), nichts gespeichert | Code, R4.2 |
| Eingaben aus dem Renderer | zod `.strict()`: Namespace DNS-1123, 1–32 Label-Paare nach `LABEL_KEY`/`LABEL_VALUE` (keine Kommas oder Operatoren im `labelSelector`), UUIDs, `format` nur `compact`/`raw` | Pflicht-Test A (Schema) |
| Anzeige von Logs | React-Text, kein `dangerouslySetInnerHTML`; ESC-Sequenzen und Steuerzeichen entfernt; 4 000 Zeichen je Zeile | Pflicht-Test D (`cleanLogText`) |
| Speicher und Last | Main: ≤ 2 × 2 000 Zeilen plus 64 KiB je Quelle; Renderer: ≤ 10 000 Zeilen; ≤ 20 Streams, ≤ 100 Quellen; Wiederaufnahme ≤ 1 je 5 s | Pflicht-Tests D (Grenze 20, Flut, Wiederaufnahme) |
| Lebenszyklus | Auswahl, Reiter, Format → Unmount → `kubeLogsStop`; Tab und Fenster → `close`; Vault-Wechsel und Beenden → `closeAll`; Reconnect → `liveEnded` | Pflicht-Tests H |

## 6. Wellen und Tasks (endgültig, exklusive Dateien)

Nach **jeder** Welle müssen `npm run typecheck` und `npx vitest run` vollständig grün sein. Im Scratchpad ist das für Welle 1 und Welle 2 mit genau dieser Aufteilung belegt.
- Innerhalb einer Welle darf ein Task auf den Vertrag eines Nachbar-Tasks verweisen.
- Umsetzer schreiben nur ihre eigenen Dateien, führen kein `npm install` aus und committen nie.

| Welle | Task | Dateien (exklusiv) | Inhalt |
|---|---|---|---|
| 1 | **A** Vertrag | `src/shared/kubernetes.ts`, `src/shared/kube-access.ts` (neu), `src/shared/kube-access.test.ts` (neu), `src/shared/kubernetes-schema.ts`, `src/shared/kubernetes-schema.test.ts`, `src/shared/ipc.ts`, `src/preload/index.ts` | Spec 3.1–3.3 mit K2; Tests K12 (A) |
| 1 | **B** Client | `src/main/kubernetes/api.ts`, `src/main/kubernetes/client-api.ts`, `src/main/kubernetes/client-api.test.ts`, `src/main/kubernetes/overview.test.ts`, `src/main/kubernetes/watch.test.ts` | Spec 3.4 mit K3, K5; Tests K12 (B) |
| 1 | **D** Workload-Logs | `src/main/kubernetes/workload-logs.ts` (neu), `src/main/kubernetes/workload-logs.test.ts` (neu) | K1; Tests K12 (D) |
| 1 | **H** Sessions und IPC | `src/main/kubernetes/session.ts`, `src/main/kubernetes/session.test.ts`, `src/main/kubernetes/ipc.ts` | Spec 3.6 mit K4, K5; Tests K12 (H) |
| 1 | **E** Renderer-Zustand | `src/renderer/src/kube-view.ts`, `src/renderer/src/kube-view.test.ts`, `src/renderer/src/hooks/useClusterSession.ts`, `src/renderer/src/kube-access.ts` (neu), `src/renderer/src/kube-access.test.ts` (neu), `src/renderer/src/kube-logs.ts` (neu), `src/renderer/src/kube-logs.test.ts` (neu), `src/shared/locales/de-DE/kubeActions.json`, `src/shared/locales/en-US/kubeActions.json` (nur `reasons.forbidden`, `reasons.forbiddenClusterWide`) | Spec 3.7 mit K6; Tests K12 (E) |
| 1 | **T** Tokens | `src/renderer/src/tokens.css`, `src/renderer/src/design-tokens.test.ts`, `src/renderer/src/styles.css` (nur `:157`), `docs/design-system.md` | Spec 3.8 mit K13 (Design-Teil) |
| 1 | **F** Doku und Version | `docs/handbuch.md`, `docs/manual.md`, `CHANGELOG.md`, `CHANGELOG.en.md`, `README.md`, `package.json`, `package-lock.json` (Zeilen 3 und 9) | Spec 3.16 und 5 mit K13 |
| 2 | **I1** Menüs und Befehle | `src/renderer/src/kube-menus.ts`, `src/renderer/src/kube-menus.test.ts`, `src/renderer/src/kube-menu-run.ts`, `src/renderer/src/kube-menu-run.test.ts`, `src/renderer/src/kube-commands.ts`, `src/renderer/src/kube-commands.test.ts`, `src/shared/locales/de-DE/kubeActions.json`, `src/shared/locales/en-US/kubeActions.json` (nur `menu.logsAll`) | Spec 3.9; K11; Tests K12 (I1) |
| 2 | **I2** Ansicht | `src/renderer/src/components/kubernetes/WorkloadLogs.tsx` (neu), `src/renderer/src/components/kubernetes/DetailDock.tsx`, `src/renderer/src/components/kubernetes/ClusterView.tsx`, `src/renderer/src/kubernetes-dock.css`, `src/shared/locales/de-DE/kubernetes.json`, `src/shared/locales/en-US/kubernetes.json` | Spec 3.10–3.14 mit K7, K8, K9 |
| 2 | **G** Fake | `.claude/skills/run-app/kube-fake.mjs`, `.claude/skills/run-app/kube-fixtures.mjs`, `.claude/skills/run-app/fakes.test.mjs` | Spec 3.15 mit K10 |
| 3 | **J** Abnahme | `.claude/skills/run-app/screens.mjs`, `.claude/skills/run-app/SKILL.md` | Spec 6 mit K14, danach run-app ausführen und die drei Shots ansehen |

Warum diese Schnitte:
- **A, B, D und H in Welle 1:**
  - A erweitert `KubeEvent`, B erweitert `KubeApi`.
  - Alle drei Fakes bekommen `followLog` und `rulesReview` in derselben Welle: B pflegt `overview` und `watch`, H pflegt `session`. Den Fake in `workload-logs.test.ts` pflegt D.
  - D braucht `followLog` aus B, H braucht D.
- **E in Welle 1:** E behandelt `logs` in `applyEvent`, sonst ist `tsc` rot. E legt die zwei `reasons`-Keys an und benutzt sie in `kube-access.ts`.
- **T in Welle 1:** Die Tokens existieren vor ihrer Nutzung in I2; unbenutzte Tokens und die Druckregel mit `.kube-logs-chip` sind erlaubt.
- **F in Welle 1:** Version und beide CHANGELOGs ändern sich gemeinsam (`version.test.ts`).
- **I1 und I2 in Welle 2:** I1 macht `MenuRunner.logsAll` zur Pflicht, I2 erfüllt es in `ClusterView`. Erst beide zusammen sind im Typecheck grün. `kubeActions.json` gehört in Welle 1 zu E und in Welle 2 zu I1, nie zwei Tasks gleichzeitig.
- **G** braucht B, D und A (Ende-zu-Ende über den echten Tunnel).
- **J** braucht den gebauten Stand aller Wellen.

## 7. Nicht geprüft

- **run-app (Task J) in der echten App:**
  - Der Block aus Spec 6.1 ist gegen die Treiber-Helfer gelesen (`rclick`, `menuItem` nur auf aktive Einträge, `fill`, `count`, `waitFor`, `closeTabs`, `.kube-ns select`), aber nicht ausgeführt.
  - Die Bedingung `>= 45` Zeilen setzt B1 voraus; mit dem Spec-Code aus 3.5 bliebe der Block bei 0 Quellen hängen.
- **Echter API-Server und Kubelet (M1–M8):**
  - Die Aussagen zu `RFC3339NanoFixed`, zur Zone der Runtime, zu `evaluationError` bei RBAC und zum Idle-Timeout von HAProxy stammen aus dem Kubernetes-Quelltext bzw. der kubeadm-Doku, nicht aus einem Clusterlauf.
  - Zusatz zu M1: einen ruhigen Pod länger als 1 Minute offen lassen. Er muss „live“ bleiben bzw. nach 5 s wieder live sein.
  - Zusatz zu M3: Ein Konto mit einer Bindung an eine gelöschte Rolle darf nichts gesperrt bekommen.
- Die Darstellung (Kontrast, Farben) ist nur rechnerisch geprüft, nicht im Screenshot.
