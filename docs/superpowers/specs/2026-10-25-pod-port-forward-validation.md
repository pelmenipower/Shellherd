# Pod- und Service-Port-Forward – Validierung (bindend)

Urteil: **ready after corrections** (go-with-fixes). 2 Blocker (beide mit Fix), 9 Korrekturen, 9 Rulings. Dieser Anhang geht Spec `2026-10-25-pod-port-forward-design.md` und Plan vor. Was hier nicht geändert wird, gilt aus der Spec **wörtlich**.

Geprüft gegen `617e3c3` samt Arbeitsbaum (Node 24.20, TypeScript 5.9, Vitest 5.0.1, zod 4.6.5, `@kubernetes/client-node` 2.0.0, `ws` 8.22.0). Ausgangslage: `npm run typecheck` grün, `npx vitest run` 165 Dateien und 2 568 Tests grün.

**Belege aus dem Scratchpad** (`…\scratchpad\pfv\`, Kopie des Arbeitsbaums mit Junction auf `node_modules`, nie gegen einen echten Cluster):
- Der **gesamte Vertrag samt allen Korrekturen und Pflicht-Tests dieses Anhangs** wurde eingespielt.
  - Stand nach Welle 1 (A, B, C, D, E, H, F): `tsc` für Node und Web grün, `vitest run` 166 Dateien grün.
  - Stand nach Welle 2 (I1, I2, G): `tsc` grün, `vitest run` **167 Dateien und 2 605 Tests grün**, darin `i18n-catalog.test.ts` (a bis g), `design-tokens.test.ts`, `version.test.ts` und der neue Ende-zu-Ende-Test in `fakes.test.mjs` (echter SSH-Fake, echter TLS-Tunnel, echter `KubeForwards`).
  - `forwards.test.ts`, `session.test.ts`, `client-api.test.ts` und `fakes.test.mjs` liefen fünfmal hintereinander grün (86 Tests je Lauf).
- **Spec 3.6 `forwards.ts` ist unverändert übernommen** und besteht alle Pflicht-Tests.
- **Gegendruck und Datenverlust**, gemessen mit dem Spec-Code aus 3.5 gegenüber K1:

  | Messung | Spec 3.5 | K1 |
  |---|---|---|
  | 64 MiB Download über den echten SSH-Tunnel, Leser 1,5 s pausiert | **384 KiB** kommen an, RSS +85 MB | 64 MiB vollständig |
  | 8 MiB Download, Leser 0,3 s pausiert (Unit-Test) | 393 216 Byte, Puffer 8 MiB | 8 MiB vollständig, Puffer < 0,1 MiB |
  | 8 MiB Upload, Pod-Seite 0,3 s pausiert | lokaler Socket liest alles in den Speicher (8 MiB) | liest höchstens ~1 MiB, danach vollständig zugestellt |
- **Lockfile:** Die Handänderung aus K5 ist identisch mit dem, was `npm install --package-lock-only --offline` erzeugt (`diff` leer). `npm ls ws` zeigt danach `ws@8.22.0` als direkte Abhängigkeit, ohne Konflikt.

## 1. Vertrag: was bindend ist

- **Kompiliert gegen den echten Code ohne Abweichung:** Spec 3.1, 3.2, 3.3, 3.4, 3.6 (`forwards.ts` vollständig), 3.7 (mit K3), 3.8, 3.9, 3.10 (mit K4), 3.11, 3.12, 3.13, 3.14, 3.15, 3.16, 3.17 (mit K5), 3.18 (mit K5).
- **Ersetzt durch diesen Anhang:**
  - Spec 3.5 `client-api.ts` (alles nach dem Import) und der Doc-Kommentar in `api.ts` → K1
  - Spec 3.5 `FakeApi` in `overview.test.ts`/`watch.test.ts` → K2
  - Spec 3.7 `startForward` → K3
  - Spec 3.10 `useClusterSession.ts`, Dispatch im `.then` → K4
  - Spec 3.17 `ws`-Import mit Shortcut-Kommentar, Spec 6.2 Stolperstein-Satz zu `ws`, Spec 7 „Keine neue npm-Abhängigkeit“, Risiko 9 → K5
  - Spec 10.1 bis 10.8 (Testideen) → K6 (wörtliche Pflicht-Tests). 10.9 gilt wörtlich aus 3.17.
  - Spec 5 englische Texte und genaue Fundstellen → K7
  - Spec 6.2 Listenänderungen → K8
  - Spec 1j, Risiko 2, Abschnitt 8 „Extras: Gegendruck“, M8 → K9
- **Typ-Fakt, der die Spec betrifft:** `@types/ws` ist nicht installiert. Damit ist der Rückgabetyp von `PortForward.portForward` für TypeScript `any` (geprüft: Zuweisung an einen beliebigen Typ kompiliert). Der Spec-Code `typeof opened === 'function' ? opened() : opened` und alle `ws.on(…)` waren deshalb **ungeprüft**. K1 führt ein lokales Interface `ForwardSocket` ein, das genau die benutzten `ws`-Methoden typisiert. `ws` 8.22 hat alle (`pause`, `resume`, `isPaused`, `bufferedAmount`, `ping(data, mask, cb)`; `node_modules/ws/lib/websocket.js:149`, `:360`, `:441`).
- **Fakten aus dem Code, die die Spec stützen:**
  - `applyEvent` (`kube-view.ts:296-304`) hat kein `default`; ohne den Fall `forwards` meldet `tsc` einen fehlenden Rückgabewert. E gehört deshalb in Welle 1 (bestätigt).
  - `getCluster` liest `vaultSessionManager.getSnapshot()` (`kubernetes/ipc.ts:36-43`) und wirft gesperrt `core.vaultLocked`. Ein Start bei Sperre wird also in Main abgelehnt; der Pflicht-Test in K6 (H) belegt das.
  - `requireSshSender` (`ssh/ipc.ts:20-26`) lässt nur den Hauptframe eines Shellherd-Fensters zu; `viewOf` bindet die Anfrage an Besitzer und View.
  - `KubeNameSchema` ist DNS-1123 (`shared/kubernetes.ts:5`); Namespace und Name können also keine `/` oder `?` in den Pfad `…/namespaces/<ns>/pods/<pod>/portforward` schmuggeln. Den aufgelösten Pod-Namen liefert der API-Server.
  - `openExternal` verlangt einen entsperrten Vault und lässt nur `http:`/`https:` ohne Benutzerdaten zu (`index.ts:344-350`, `links.ts:3-10`).
  - Der Tunnel (`tunnel.ts:22-29`) verbindet per `pipe`; Gegendruck aus K1 wirkt dadurch bis in das ssh2-Fenster. Die ssh2-Eigenheit (`destroy` braucht `resume`) behandelt `dropChannel` (`tunnel.ts:9-12`) für jede WebSocket-Verbindung; Port-Forward öffnet selbst keinen ssh2-Kanal.
- **Zeilenanker der Spec:** stimmen bis auf diese, ohne Belang für die Umsetzung:
  - `KubeApiError` steht in `api.ts:18-20`, nicht `:121-123`.
  - Der `handle`-Wrapper in `kubernetes/ipc.ts` steht bei `:25-33`, nicht `ipc.ts:166-174`.
  - `closeAll` läuft bei Vault-Wechsel über `onSessionChange` (`index.ts:366`) und beim Beenden (`index.ts:434`), nicht `:357`.
  - Der `ConfirmAction`-Block in `ClusterView.tsx` steht bei `:372-375`; `FakeApi` in `session.test.ts` bei `:66`.
- **i18n (`i18n-catalog.test.ts`).** Alle Texte aus Spec 3.4, 3.11 und 3.16 bestehen (a) bis (g), im Scratchpad gelaufen.
  - (d) Fehler-Keys: B nutzt `portForwardForbidden`, `PodGone`, `NotRunning`, `Refused`; D nutzt `NoSelector`, `NoPort`, `NoReadyPod`, `TooMany`, `Busy`, `Failed`. Alle stehen nach Welle 1 als Literal im Code.
  - `port` steht nicht in `COUNT_KEYS` (`i18n.ts:9`); Ports laufen also nie über `formatNumber`. `max` wird formatiert (32, 10 – ohne Tausenderpunkt).
- **Design (`design-tokens.test.ts`):** grün. Einzige CSS-Änderung ist der Selektor `.kube-field select`; keine Tokens, keine Bewegung. `.kube-confirm` erscheint ohne Animation.

## 2. Blocker

### B1 – Datenverlust und unbegrenzte Puffer im Port-Forward-Strom (Spec 3.5)
- **Datenverlust:** `ws.on('close', () => socket.destroy())` verwirft alles, was noch im Schreibpuffer des lokalen Sockets liegt. Das trifft jede Antwort, die der Server mit einem Verbindungsende abschließt (`Connection: close`, Datei-Downloads, Datenbank-Dumps), sobald der lokale Leser langsamer ist als der Tunnel.
  - Beleg über den echten SSH-Tunnel: 384 KiB von 64 MiB kommen an.
  - Der Client sieht ein sauberes Ende und hält die Datei womöglich für vollständig.
- **Kein Gegendruck, in beiden Richtungen:**
  - client-node schreibt jeden Frame ohne Rückgabeprüfung in den Socket (`portforward.js:40`).
  - Es schickt jeden gelesenen Block ohne Blick auf `bufferedAmount` (`web-socket-handler.js:55-58`).
  - Ein langsamer Leser oder ein langsamer Pod puffert damit die ganze Übertragung im Hauptprozess (gemessen +85 MB RSS bei 64 MiB).
  - Das Konzept verschiebt das auf M8. Ein Dokumentieren als Grenze reicht hier nicht, weil der Verlust ohne Gegendruck **nicht** auf große Downloads beschränkt ist.

**Fix:** K1. Der Fix besteht aus drei Teilen:
- **Pod → lokal:** Liefert `socket.write` den Wert `false`, kommt `ws.pause()`. Bei `drain` folgt `ws.resume()`.
- **Lokal → pod:** Liegt `ws.bufferedAmount` über 1 MiB, wird der lokale Socket pausiert. Fortgesetzt wird er im Callback von `ws.ping()`, also wenn alle davor eingereihten Frames geschrieben sind.
- **Ende:** `socket.end(() => socket.destroy())` statt `destroy`.

Beleg: Die beiden Gegendruck-Tests in K6 (B) schlagen mit dem Spec-Code fehl (393 216 statt 8 388 608 Byte; der Upload wird ganz in den Speicher gelesen) und sind mit K1 grün.

### B2 – Der Fake verlässt sich still auf eine transitive Abhängigkeit (Spec 3.17, Risiko 9)
`ws` ist keine Projekt-Abhängigkeit. Es liegt nur hochgezogen unter `node_modules/ws`, weil `@kubernetes/client-node` es braucht. Die Spec importiert es im Fake mit einem Shortcut-Kommentar und schreibt in Abschnitt 7 ausdrücklich „keine neue npm-Abhängigkeit“. Das verletzt die bindende Vorgabe dieses Auftrags. Auch die Pflicht-Tests in K6 (B) brauchen `ws` als Gegenstelle.

**Fix:** K5. `"ws": "8.22.0"` kommt als devDependency in `package.json` und `package-lock.json` (Task F, Welle 1). Es ist dieselbe Version, die schon im Baum liegt; installiert wird nichts Neues. Der Shortcut-Kommentar entfällt. `@types/ws` kommt **nicht** dazu (Ruling V2).

## 3. Korrekturen (wörtlicher Ersatz)

### K1 – `src/main/kubernetes/api.ts` und `client-api.ts` (Task B), ersetzt Spec 3.5 außer den Testfakes
**`api.ts`:** Ganz oben `import type { Duplex } from 'node:stream';` (vor `import type { CodedError } …`). In `KubeApi` direkt nach der Zeile `openTerminal(…): Promise<KubeStream>;`:
```ts
  /**
   * Opens one port-forward stream (WebSocket) to a pod port and pipes `socket` through it both ways, with back-pressure;
   * resolves once it is open. The caller pauses `socket`; this resumes it. A port the pod refuses later destroys `socket`
   * with a KubeApiError (kubernetes.portForwardRefused). Handshake failures reject with a mapped KubeApiError.
   */
  portForward(namespace: string, pod: string, port: number, socket: Duplex): Promise<void>;
```
**`client-api.ts`:**
- Zeile 6 wird zu `import { Exec, KubernetesObjectApi, Metrics, PatchStrategy, PortForward, Watch } from '@kubernetes/client-node';`.
- Direkt nach Zeile 5 (`import { PassThrough, Writable } from 'node:stream';`) kommt `import type { Duplex } from 'node:stream';`.
- Direkt nach dem Ende von `function forbiddenError(…) { … }` (vor `/** Runs one client call …`) kommt dieser Block:
```ts

/** Handshake failures of a port-forward WebSocket; ws reports only "Unexpected server response: <status>", without the body. */
export function portForwardError(error: unknown, namespace: string, pod: string): KubeApiError {
  const e = asRecord(error);
  const message = [e.message, asRecord(e.error).message].find((text): text is string => typeof text === 'string') ?? '';
  const status = Number(/Unexpected server response: (\d{3})/.exec(message)?.[1]);
  if (status === 403) return new KubeApiError('Forbidden: pods/portforward', 403, { code: 'kubernetes.portForwardForbidden', params: { namespace } });
  if (status === 404) return new KubeApiError('Pod not found', 404, { code: 'kubernetes.portForwardPodGone', params: { name: pod } });
  if (status === 400) return new KubeApiError('Pod is not running', 400, { code: 'kubernetes.portForwardNotRunning', params: { name: pod } });
  // ws wraps network and TLS failures in an ErrorEvent; the Error with its code sits in `error`.
  return toApiError(Number.isFinite(status) ? { code: status } : e.error ?? error);
}

/** The parts of ws's WebSocket used here; client-node's own type is any because @types/ws is not installed. */
interface ForwardSocket {
  readonly bufferedAmount: number;
  readonly isPaused: boolean;
  on(event: 'close' | 'error', listener: () => void): unknown;
  close(): void;
  pause(): void;
  resume(): void;
  ping(data: undefined, mask: undefined, callback: () => void): void;
}

/** Unsent bytes a forward stream may hold before the local socket stops reading. */
const FORWARD_HIGH_WATER = 1024 * 1024;

/** Port forward over the API server (WebSocket, v4.channel.k8s.io): one stream per local connection, with back-pressure both ways. */
async function openPortForward(config: KubeConfig, namespace: string, pod: string, port: number, socket: Duplex): Promise<void> {
  let ws: ForwardSocket | undefined;
  // Channel 1 carries the kubelet's error text (e.g. nothing listens on the port); the text itself is not passed on.
  const errors = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      if (chunk.length > 0) socket.destroy(new KubeApiError('The pod refused the port', undefined, { code: 'kubernetes.portForwardRefused', params: { port } }));
      callback();
    },
  });
  // Pod to local: a slow local reader pauses the WebSocket instead of buffering the whole download in main.
  const output = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      if (!socket.write(chunk) && ws && !ws.isPaused) {
        const paused = ws;
        paused.pause();
        socket.once('drain', () => paused.resume());
      }
      callback();
    },
  });
  try {
    ws = await new PortForward(config).portForward(namespace, pod, [port], output, errors, socket) as ForwardSocket;
  } catch (error) {
    throw portForwardError(error, namespace, pod);
  }
  const open = ws;
  // end, not destroy: what the pod sent may still wait in the local socket's buffer.
  open.on('close', () => socket.end(() => socket.destroy()));
  open.on('error', () => socket.destroy());
  // resume: a paused WebSocket could not read the closing handshake.
  socket.once('close', () => { open.resume(); open.close(); });
  // Local to pod: client-node sends without looking at the buffer; stop reading until the queued frames are written.
  let waiting = false;
  socket.on('data', () => {
    if (waiting || open.bufferedAmount <= FORWARD_HIGH_WATER) return;
    waiting = true;
    socket.pause();
    open.ping(undefined, undefined, () => { waiting = false; socket.resume(); });
  });
  if (socket.destroyed) { open.close(); return; }
  socket.resume();
}
```
- In `createKubeApi` direkt nach dem Block `async openTerminal(target, size, io) { … },`:
```ts

    portForward(namespace, pod, port, socket) {
      return openPortForward(config, namespace, pod, port, socket);
    },
```
- `ws.ping` geht als Kontrollframe zum Kubelet und wird dort mit `pong` beantwortet. client-node wertet nur `message` aus; `pong` stört nicht.

### K2 – `overview.test.ts` und `watch.test.ts` (Task B), ersetzt die Fake-Zeilen aus Spec 3.5
- `overview.test.ts`: direkt nach `  openTerminal(): never { throw new Error('unused'); }` die Zeile `  portForward(): never { throw new Error('unused'); }`.
- `watch.test.ts`: direkt nach `  openTerminal(): Promise<KubeStream> { throw new Error('unused'); }` die Zeile `  portForward(): Promise<void> { throw new Error('unused'); }`.

### K3 – `src/main/kubernetes/session.ts` (Task H), ersetzt `startForward` aus Spec 3.7
Spec 3.7 gilt sonst wörtlich (Importe, Feld `forwards`, Konstruktorzeile, `stopForward`, `stopView` in `close`, `stopAll` in `closeAll`).

Der Grund für die Änderung: `forwards.start` wartet auf `listen`. Wird in dieser Zeit der Tab geschlossen oder der Vault gewechselt, hat `stopView`/`stopAll` den Eintrag noch nicht gesehen. Ein Port bliebe dann offen, ohne Leiste und bis zum Beenden. Das ist genau der vergessene offene Port, den R4.5 ausschließen soll.
```ts
  /** Port forward of a view to a pod or service port. Reading access: allowed on read-only clusters, refused on disabled ones. */
  async startForward(ownerId: number, viewId: string, target: KubeForwardTarget, localPort: number): Promise<KubeForwardStatus> {
    const view = this.viewOf(ownerId, viewId);
    // Read at each call; reading the vault also refuses while it is locked.
    if (this.deps.getCluster(view.session.clusterId).disabled) throw new AppError(DISABLED);
    view.session.requireApi();
    const status = await this.forwards.start({ ownerId, viewId, api: () => view.session.waitReady() }, target, localPort);
    // The view closed while the listener opened: its forwards must not outlive it.
    if (this.views.get(viewId) !== view) {
      this.forwards.stopView(viewId);
      throw new AppError(NOT_AVAILABLE);
    }
    return status;
  }
```

### K4 – `src/renderer/src/hooks/useClusterSession.ts` (Task E), ersetzt den Dispatch aus Spec 3.10
Die Zeilen „`// A reopened view starts without forwards; …`“ und `dispatch(… forwards: [] …)` im `.then` von `kubeOpen` entfallen.

Grund: Scheitert nach `Erneut versuchen` das neue `kubeOpen`, etwa weil der Cluster deaktiviert ist, liefe das `.then` nie. Die Leiste zeigte dann tote Weiterleitungen, und `Stoppen` täte nichts.

Stattdessen im Cleanup des Open-Effekts, direkt nach `setViewId(null);`:
```ts
      // Main stops the forwards of a closed view without an event; the bar must not keep showing them.
      dispatch({ type: 'event', event: { type: 'forwards', viewId: '', forwards: [] } });
```
Alles andere aus Spec 3.10 gilt wörtlich (Typ-Import, `startForward`, `stopForward`, Rückgabe).

### K5 – `ws` als devDependency (Tasks F, G, J)
- **F, `package.json`:** In `devDependencies` wird die letzte Zeile `"vitest": "5.0.1"` zu `"vitest": "5.0.1",`, danach folgt die neue Zeile `"ws": "8.22.0"`. Die Version wird wie in Spec 3.18 zu `0.27.0`.
- **F, `package-lock.json`:** Beide `"version": "0.26.0",` oben werden zu `"0.27.0"`. In `packages[""].devDependencies` (der Block, der mit `"vitest": "5.0.1"` endet) wird `"vitest": "5.0.1"` zu `"vitest": "5.0.1",`, danach folgt `"ws": "8.22.0"`. Sonst ändert sich nichts; der Eintrag `node_modules/ws` bleibt, wie er ist.
  - Kein `npm install` ausführen. Die Handänderung ist im Scratchpad gegen `npm install --package-lock-only --offline` geprüft.
- **G, `kube-fake.mjs`:** Die Import-Ergänzung aus Spec 3.17 lautet ohne Shortcut-Kommentar:
  ```js
  import http from 'node:http';
  import net from 'node:net';
  import { WebSocketServer } from 'ws';
  ```
  - Die Zeile `import https from 'node:https';` wird zu den drei Zeilen `import http from 'node:http';`, `import https from 'node:https';`, `import net from 'node:net';`.
  - `import { WebSocketServer } from 'ws';` steht direkt vor `import { buildCluster } from './kube-fixtures.mjs';`.
- **J, `SKILL.md`:** Im neuen Stolperstein aus Spec 6.2 wird der Satz „`ws` kommt über `@kubernetes/client-node` mit; fehlt es, startet der Kubernetes-Fake nicht.“ ersetzt durch: „`ws` ist eine devDependency (dieselbe Version, die `@kubernetes/client-node` mitbringt).“

### K6 – Pflicht-Tests, wörtlich (ersetzt Spec 10.1 bis 10.8)
Alle sind im Scratchpad grün gelaufen. Wo „am Dateiende anfügen“ steht, kommt der Block nach der letzten Zeile der Datei.

**A – `src/shared/kubernetes-schema.test.ts`:** Zeile 3 wird zu
`import { KubeActionRequestSchema, KubeForwardStartRequestSchema, KubeForwardStopRequestSchema, KubeQuerySchema, KubeRefSchema, KubeTerminalTargetSchema, KubeViewSnapshotSchema } from './kubernetes-schema';`. Am Dateiende anfügen:
```ts

describe('port-forward requests', () => {
  const viewId = '6f1c2b0e-8a4d-4c1e-9f3a-2b7d5e8c9a10';
  const target = { kind: 'pods', namespace: 'shop', name: 'api-1', port: 8080 };
  const start = (patch: Record<string, unknown> = {}, targetPatch: Record<string, unknown> = {}) =>
    KubeForwardStartRequestSchema.safeParse({ viewId, target: { ...target, ...targetPatch }, localPort: 0, ...patch }).success;

  it('accepts a pod or service target and any local port from 0', () => {
    expect(start()).toBe(true);
    expect(start({ localPort: 65_535 }, { kind: 'services', port: 1 })).toBe(true);
  });

  it('rejects other kinds, bad ports, bad names and extra fields such as a bind address', () => {
    expect(start({}, { kind: 'deployments' })).toBe(false);
    expect(start({}, { port: 0 })).toBe(false);
    expect(start({}, { port: 65_536 })).toBe(false);
    expect(start({ localPort: -1 })).toBe(false);
    expect(start({ localPort: 1.5 })).toBe(false);
    expect(start({}, { namespace: 'A_B' })).toBe(false);
    expect(start({ bind: '0.0.0.0' })).toBe(false);
    expect(start({}, { host: '0.0.0.0' })).toBe(false);
    expect(start({ viewId: 'v1' })).toBe(false);
  });

  it('stops only by uuid', () => {
    expect(KubeForwardStopRequestSchema.safeParse({ viewId, forwardId: viewId }).success).toBe(true);
    expect(KubeForwardStopRequestSchema.safeParse({ viewId, forwardId: 'f1' }).success).toBe(false);
  });
});
```

**B – `src/main/kubernetes/client-api.test.ts`:**
- Die Zeilen 1 bis 3 (`import { createServer } from 'node:http';`, `import { PassThrough } from 'node:stream';` und `import type { AddressInfo } from 'node:net';`) werden ersetzt durch:
```ts
import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { createRequire } from 'node:module';
import { connect, createServer as createNetServer } from 'node:net';
import type { AddressInfo, Socket } from 'node:net';
import { PassThrough } from 'node:stream';
import type { Duplex } from 'node:stream';
```
- Im Import aus `./client-api` kommt `portForwardError` dazu (zwischen `openLogs` und `resourcePath`).
- Am Dateiende anfügen:
```ts

describe('portForwardError', () => {
  it('maps handshake statuses and wrapped network errors, never the server text', () => {
    expect(portForwardError({ message: 'Unexpected server response: 403' }, 'shop', 'p').coded).toEqual({ code: 'kubernetes.portForwardForbidden', params: { namespace: 'shop' } });
    expect(portForwardError({ error: { message: 'Unexpected server response: 404' } }, 'shop', 'p').coded).toEqual({ code: 'kubernetes.portForwardPodGone', params: { name: 'p' } });
    expect(portForwardError({ message: 'Unexpected server response: 400' }, 'shop', 'p').coded).toEqual({ code: 'kubernetes.portForwardNotRunning', params: { name: 'p' } });
    expect(portForwardError({ message: 'Unexpected server response: 401' }, 'shop', 'p').coded).toEqual({ code: 'kubernetes.unauthorized' });
    expect(portForwardError({ message: 'boom' }, 'shop', 'p').coded).toEqual({ code: 'kubernetes.apiError' });
    expect(portForwardError({ message: 'read ECONNRESET', error: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }) }, 'shop', 'p').coded)
      .toEqual({ code: 'kubernetes.connectionReset' });
    expect(portForwardError({ cause: { code: 'ERR_TLS_CERT_ALTNAME_INVALID' } }, 'shop', 'p').coded).toEqual({ code: 'kubernetes.tlsAltname' });
  });
});

/** The parts of ws's server side the fake kubelet below uses; ws ships without types. */
interface FakeKubeletSocket { send(data: Buffer): void; close(): void; pause(): void; resume(): void; on(event: 'message', listener: (data: Buffer) => void): void }
interface FakeKubeletServer {
  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer, done: (ws: FakeKubeletSocket) => void): void;
  close(): void;
}
const { WebSocketServer } = createRequire(import.meta.url)('ws') as {
  WebSocketServer: new (options: { noServer: true; handleProtocols: (protocols: Set<string>) => string | false }) => FakeKubeletServer;
};

describe('createKubeApi.portForward', () => {
  const SIZE = 8 * 1024 * 1024;
  // Large against loopback kernel buffers (several MiB on Linux), so only back-pressure keeps the read count low.
  const UPLOAD = 32 * 1024 * 1024;
  const portPrefix = (channel: number) => Buffer.from([channel, 8080 & 0xff, 8080 >> 8]);
  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  /** A kubelet stand-in behind a plain HTTP API server, and a local listener that hands each connection to portForward like KubeForwards. */
  async function kubelet(pod: string, run: (ws: FakeKubeletSocket) => void) {
    const wss = new WebSocketServer({ noServer: true, handleProtocols: protocols => (protocols.has('v4.channel.k8s.io') ? 'v4.channel.k8s.io' : false) });
    const server = createServer();
    server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      if (request.url?.includes('/pods/forbidden/')) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return; }
      wss.handleUpgrade(request, socket, head, ws => { ws.send(portPrefix(0)); ws.send(portPrefix(1)); run(ws); });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const api = createKubeApi(testConfig(`http://127.0.0.1:${(server.address() as AddressInfo).port}`));
    const accepted: Socket[] = [];
    const results: Promise<unknown>[] = [];
    const local = createNetServer(socket => {
      socket.pause();
      socket.on('error', () => {});
      accepted.push(socket);
      results.push(api.portForward('shop', pod, 8080, socket).then(() => undefined, (error: unknown) => { socket.destroy(); return error; }));
    });
    await new Promise<void>(resolve => local.listen(0, '127.0.0.1', resolve));
    const close = () => { local.close(); wss.close(); server.closeAllConnections(); server.close(); };
    return { port: (local.address() as AddressInfo).port, accepted, results, close };
  }

  it('hands a slow reader everything the pod sent, without buffering it all in main, then ends cleanly', async () => {
    const fake = await kubelet('p', ws => {
      const chunk = Buffer.alloc(64 * 1024, 7);
      for (let sent = 0; sent < SIZE; sent += chunk.length) ws.send(Buffer.concat([Buffer.from([0]), chunk]));
      ws.close();
    });
    try {
      const client = connect(fake.port, '127.0.0.1');
      client.pause();
      let received = 0;
      client.on('data', (data: Buffer) => { received += data.length; });
      const closed = new Promise(resolve => client.on('close', resolve));
      await wait(300);
      expect(fake.accepted[0].writableLength).toBeLessThan(2 * 1024 * 1024);
      client.resume();
      await closed;
      expect(received).toBe(SIZE);
    } finally {
      fake.close();
    }
  });

  it('stops reading from a fast local sender while the pod side is slow, then delivers everything', async () => {
    let received = 0;
    let resumePod = (): void => {};
    const fake = await kubelet('p', ws => {
      ws.pause();
      resumePod = () => ws.resume();
      ws.on('message', data => { received += data.length - 1; });
    });
    try {
      const client = connect(fake.port, '127.0.0.1', () => {
        const chunk = Buffer.alloc(64 * 1024, 3);
        let sent = 0;
        const pump = (): void => {
          while (sent < UPLOAD) {
            sent += chunk.length;
            if (!client.write(chunk)) { client.once('drain', pump); return; }
          }
        };
        pump();
      });
      client.on('error', () => {});
      await wait(300);
      expect(fake.accepted[0].bytesRead).toBeLessThan(UPLOAD / 2);
      resumePod();
      for (const end = Date.now() + 10_000; received < UPLOAD && Date.now() < end;) await wait(20);
      expect(received).toBe(UPLOAD);
      client.destroy();
    } finally {
      fake.close();
    }
  });

  it('destroys the local socket with portForwardRefused, without the kubelet text', async () => {
    const fake = await kubelet('p', ws => {
      ws.send(Buffer.concat([Buffer.from([1]), Buffer.from('error forwarding port 8080 to pod 10.244.1.7: connect: connection refused')]));
      ws.close();
    });
    try {
      const client = connect(fake.port, '127.0.0.1');
      client.on('error', () => {});
      await new Promise(resolve => client.on('close', resolve));
      for (const end = Date.now() + 2000; !fake.accepted[0]?.destroyed && Date.now() < end;) await wait(10);
      const error = fake.accepted[0].errored;
      expect(error).toMatchObject({ coded: { code: 'kubernetes.portForwardRefused', params: { port: 8080 } } });
      expect((error as Error).message).not.toContain('10.244');
    } finally {
      fake.close();
    }
  });

  it('rejects a forbidden handshake with portForwardForbidden', async () => {
    const fake = await kubelet('forbidden', () => {});
    try {
      const client = connect(fake.port, '127.0.0.1');
      client.on('error', () => {});
      await new Promise(resolve => client.on('close', resolve));
      expect(await fake.results[0]).toMatchObject({ coded: { code: 'kubernetes.portForwardForbidden', params: { namespace: 'shop' } } });
    } finally {
      fake.close();
    }
  });
});
```

**C – `src/main/kubernetes/rows.test.ts`**, am Dateiende anfügen:
```ts

describe('ports', () => {
  it('lists the TCP container ports of a pod once, with their names', () => {
    const row = toRow('pods', pod({ phase: 'Running' }, { containers: [
      { name: 'api', ports: [{ name: 'http', containerPort: 8080 }, { containerPort: 9090, protocol: 'UDP' }] },
      { name: 'sidecar', ports: [{ containerPort: 8080 }] },
    ] }));
    expect(row?.ports).toEqual([{ port: 8080, name: 'http' }]);
    expect(toRow('pods', pod({ phase: 'Running' }))).not.toHaveProperty('ports');
  });

  it('lists the TCP ports of a service and keeps the ports cell', () => {
    const row = toRow('services', { metadata: { name: 'web', namespace: 'shop', uid: 'sv1' },
      spec: { selector: { app: 'web' }, ports: [{ name: 'http', port: 80, targetPort: 'http' }, { port: 53, protocol: 'UDP' }] } });
    expect(row?.ports).toEqual([{ port: 80, name: 'http' }]);
    expect(row?.cells.ports).toBe('80/TCP,53/UDP');
  });
});
```

**D – `src/main/kubernetes/forwards.test.ts` (neu), vollständig.** Die Bindung wird per Spion auf `Server.prototype.listen` geprüft, nicht über eine LAN-Adresse. Ein Verbindungsversuch auf eine fremde Schnittstelle wäre je nach Rechner (VPN, Hyper-V-Adapter) langsam oder flackernd.
```ts
import { Server, connect } from 'node:net';
import type { Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../shared/errors';
import type { KubeForwardStatus, KubeForwardTarget } from '../../shared/kubernetes';
import { KubeApiError } from './api';
import type { KubeApi, KubeObject } from './api';
import { KubeForwards, MAX_FORWARD_CONNECTIONS, MAX_KUBE_FORWARDS, containerPort, podReady, resolveHop } from './forwards';

const POD: KubeForwardTarget = { kind: 'pods', namespace: 'shop', name: 'api-1', port: 8080 };
const SERVICE: KubeForwardTarget = { kind: 'services', namespace: 'shop', name: 'api', port: 80 };
const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });

function podObject(name: string, options: { ready?: boolean; phase?: string; deleting?: boolean } = {}): KubeObject {
  return {
    metadata: { name, namespace: 'shop', ...(options.deleting ? { deletionTimestamp: '2026-10-25T00:00:00Z' } : {}) } as KubeObject['metadata'],
    spec: { containers: [{ name: 'main', ports: [{ name: 'http', containerPort: 8080 }] }] },
    status: { phase: options.phase ?? 'Running', conditions: [{ type: 'Ready', status: options.ready === false ? 'False' : 'True' }] },
  };
}

/** Pod stream stand-in: echoes, or fails like the API server and the kubelet would. */
class Fake {
  service: KubeObject = { metadata: { name: 'api', namespace: 'shop' }, spec: { selector: { app: 'api' }, ports: [{ port: 80, targetPort: 'http', protocol: 'TCP' }] } };
  pods: KubeObject[] = [];
  gone = new Set<string>();
  refuse = false;
  hang = false;
  calls: { pod: string; port: number }[] = [];
  list = vi.fn(async () => ({ items: this.pods, resourceVersion: '1' }));
  readonly api = {
    read: async () => this.service,
    list: this.list,
    portForward: async (_namespace: string, pod: string, port: number, socket: Duplex): Promise<void> => {
      this.calls.push({ pod, port });
      if (this.hang) return new Promise<void>(() => {});
      if (this.gone.has(pod)) throw new KubeApiError('gone', 404, { code: 'kubernetes.portForwardPodGone', params: { name: pod } });
      if (this.refuse) {
        socket.destroy(new KubeApiError('refused', undefined, { code: 'kubernetes.portForwardRefused', params: { port } }));
        return;
      }
      socket.on('data', chunk => socket.write(chunk));
      socket.resume();
    },
  } as unknown as KubeApi;
}

function setup() {
  const fake = new Fake();
  const lists: KubeForwardStatus[][] = [];
  const forwards = new KubeForwards((_ownerId, _viewId, list) => { lists.push(list); });
  cleanups.push(() => forwards.stopAll());
  const view = { ownerId: 1, viewId: 'v1', api: async () => fake.api };
  const latest = (): KubeForwardStatus | undefined => lists.at(-1)?.[0];
  return { fake, forwards, view, lists, latest };
}

/** Sends text over a new connection and resolves with what comes back. */
function echo(port: number, text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => socket.write(text));
    socket.once('data', data => { resolve(data.toString()); socket.end(); });
    socket.once('error', reject);
  });
}

/** A connection that stays open; the caller destroys it. */
function open(port: number): Promise<Socket> {
  return new Promise(resolve => {
    const socket = connect(port, '127.0.0.1', () => resolve(socket));
    socket.on('error', () => {});
  });
}

/** Connects and resolves once the forward has closed the connection. */
function dropped(port: number): Promise<void> {
  return new Promise(resolve => {
    const socket = connect(port, '127.0.0.1');
    socket.on('error', () => {});
    socket.on('close', () => resolve());
  });
}

async function until(check: () => boolean): Promise<void> {
  for (const end = Date.now() + 3000; !check(); await new Promise(resolve => setTimeout(resolve, 10))) {
    if (Date.now() > end) throw new Error('condition not reached');
  }
}

describe('KubeForwards', () => {
  it('listens on 127.0.0.1 only and pipes a connection through the pod stream', async () => {
    const listen = vi.spyOn(Server.prototype, 'listen');
    cleanups.push(() => listen.mockRestore());
    const { fake, forwards, view, latest } = setup();
    const status = await forwards.start(view, POD, 0);
    expect(listen.mock.calls.at(-1)?.slice(0, 2)).toEqual([0, '127.0.0.1']);
    expect(status.localPort).toBeGreaterThan(0);
    expect(status).toMatchObject({ target: POD, open: 0 });
    const client = await open(status.localPort);
    await until(() => latest()?.open === 1);
    client.destroy();
    await until(() => latest()?.open === 0);
    expect(await echo(status.localPort, 'ping')).toBe('ping');
    expect(fake.calls.at(-1)).toEqual({ pod: 'api-1', port: 8080 });
    expect(latest()).toMatchObject({ pod: 'api-1', podPort: 8080 });
  });

  it('refuses a local port that is taken and keeps no entry', async () => {
    const { forwards, view } = setup();
    const first = await forwards.start(view, POD, 0);
    await expect(forwards.start(view, POD, first.localPort)).rejects.toMatchObject({ code: 'ssh.forwardPortInUse', params: { port: first.localPort } });
    expect(forwards.list('v1')).toHaveLength(1);
  });

  it('starts at most 10 forwards', async () => {
    const { forwards, view } = setup();
    for (let index = 0; index < MAX_KUBE_FORWARDS; index++) await forwards.start(view, POD, 0);
    await expect(forwards.start(view, POD, 0)).rejects.toMatchObject({ code: 'kubernetes.portForwardTooMany', params: { max: 10 } });
  });

  it('resolves a service to the first ready pod by name, remembers it and looks again when it is gone', async () => {
    const { fake, forwards, view, latest } = setup();
    fake.pods = [podObject('b'), podObject('a'), podObject('c', { ready: false }), podObject('0-old', { deleting: true })];
    const status = await forwards.start(view, SERVICE, 0);
    expect(await echo(status.localPort, 'one')).toBe('one');
    expect(fake.list).toHaveBeenCalledWith('pods', 'shop', { labels: { app: 'api' } });
    expect(fake.calls).toEqual([{ pod: 'a', port: 8080 }]);
    expect(latest()).toMatchObject({ pod: 'a', podPort: 8080 });
    expect(await echo(status.localPort, 'two')).toBe('two');
    expect(fake.list).toHaveBeenCalledTimes(1);
    fake.gone.add('a');
    fake.pods = fake.pods.filter(pod => pod.metadata?.name !== 'a');
    expect(await echo(status.localPort, 'three')).toBe('three');
    expect(fake.list).toHaveBeenCalledTimes(2);
    expect(fake.calls.slice(-2)).toEqual([{ pod: 'a', port: 8080 }, { pod: 'b', port: 8080 }]);
    expect(latest()).toMatchObject({ pod: 'b', podPort: 8080 });
    expect(latest()?.error).toBeUndefined();
  });

  it('keeps listening when the pod is gone and tries again with the next connection', async () => {
    const { fake, forwards, view, latest } = setup();
    fake.gone.add('api-1');
    const status = await forwards.start(view, POD, 0);
    await dropped(status.localPort);
    await until(() => latest()?.error?.code === 'kubernetes.portForwardPodGone');
    fake.gone.clear();
    expect(await echo(status.localPort, 'back')).toBe('back');
    expect(fake.calls).toHaveLength(2);
    expect(latest()?.error).toBeUndefined();
  });

  it('shows a refused port and clears it with the next good connection', async () => {
    const { fake, forwards, view, latest } = setup();
    fake.refuse = true;
    const status = await forwards.start(view, POD, 0);
    await dropped(status.localPort);
    await until(() => latest()?.error?.code === 'kubernetes.portForwardRefused');
    expect(latest()?.error).toEqual({ code: 'kubernetes.portForwardRefused', params: { port: 8080 } });
    fake.refuse = false;
    expect(await echo(status.localPort, 'ok')).toBe('ok');
    expect(latest()?.error).toBeUndefined();
  });

  it('refuses the 33rd connection at once while 32 are opening', async () => {
    const { fake, forwards, view, latest } = setup();
    fake.hang = true;
    const status = await forwards.start(view, POD, 0);
    const clients = await Promise.all(Array.from({ length: MAX_FORWARD_CONNECTIONS }, () => open(status.localPort)));
    cleanups.push(() => { for (const client of clients) client.destroy(); });
    await until(() => latest()?.open === MAX_FORWARD_CONNECTIONS);
    await dropped(status.localPort);
    await until(() => latest()?.error !== undefined);
    expect(latest()?.error).toEqual({ code: 'kubernetes.portForwardBusy', params: { max: 32 } });
    expect(fake.calls).toHaveLength(MAX_FORWARD_CONNECTIONS);
  });

  it('closes a connection when the cluster does not come back and shows why', async () => {
    const { forwards, latest } = setup();
    const view = { ownerId: 1, viewId: 'v1', api: async (): Promise<KubeApi> => { throw new AppError('kubernetes.reconnecting'); } };
    const status = await forwards.start(view, POD, 0);
    await dropped(status.localPort);
    await until(() => latest()?.error?.code === 'kubernetes.reconnecting');
  });

  it('stop closes the listener and its connections; a foreign view stops nothing', async () => {
    const { forwards, view, lists } = setup();
    const keep = await forwards.start(view, POD, 0);
    const status = await forwards.start(view, POD, 0);
    const client = await open(status.localPort);
    const closed = new Promise(resolve => client.once('close', resolve));
    forwards.stop('v2', status.id);
    expect(forwards.list('v1')).toHaveLength(2);
    forwards.stop('v1', status.id);
    expect(lists.at(-1)?.map(forward => forward.id)).toEqual([keep.id]);
    await closed;
    // The port is free again: a new forward can take it.
    const again = await forwards.start(view, POD, status.localPort);
    expect(again.localPort).toBe(status.localPort);
  });

  it('stopView and stopAll end the forwards without any further event', async () => {
    const { forwards, view, lists } = setup();
    const status = await forwards.start(view, POD, 0);
    const other = await forwards.start({ ...view, viewId: 'v2' }, POD, 0);
    const client = await open(status.localPort);
    await until(() => lists.at(-1)?.[0]?.open === 1);
    const count = lists.length;
    const closed = new Promise(resolve => client.once('close', resolve));
    forwards.stopView('v1');
    await closed;
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(lists).toHaveLength(count);
    expect(forwards.list('v1')).toEqual([]);
    expect(forwards.list('v2')).toHaveLength(1);
    forwards.stopAll();
    expect(forwards.list('v2')).toEqual([]);
    expect(lists).toHaveLength(count);
    expect((await forwards.start(view, POD, other.localPort)).localPort).toBe(other.localPort);
  });
});

describe('resolveHop', () => {
  const api = (spec: object, pods: KubeObject[]) =>
    ({ read: async () => ({ metadata: { name: 'api' }, spec }), list: async () => ({ items: pods, resourceVersion: '1' }) }) as unknown as KubeApi;
  const selector = { app: 'api' };

  it('names what is missing', async () => {
    await expect(resolveHop(api({ ports: [{ port: 80 }] }, []), SERVICE)).rejects.toMatchObject({ code: 'kubernetes.portForwardNoSelector', params: { name: 'api' } });
    await expect(resolveHop(api({ selector, ports: [{ port: 80 }] }, [podObject('a')]), { ...SERVICE, port: 81 }))
      .rejects.toMatchObject({ code: 'kubernetes.portForwardNoPort', params: { port: 81 } });
    await expect(resolveHop(api({ selector, ports: [{ port: 80, protocol: 'UDP' }] }, [podObject('a')]), SERVICE)).rejects.toMatchObject({ code: 'kubernetes.portForwardNoPort' });
    await expect(resolveHop(api({ selector, ports: [{ port: 80 }] }, [podObject('a', { ready: false }), podObject('b', { phase: 'Pending' })]), SERVICE))
      .rejects.toMatchObject({ code: 'kubernetes.portForwardNoReadyPod', params: { name: 'api' } });
    await expect(resolveHop(api({ selector, ports: [{ port: 80, targetPort: 'metrics' }] }, [podObject('a')]), SERVICE))
      .rejects.toMatchObject({ code: 'kubernetes.portForwardNoPort', params: { port: 80 } });
  });

  it('takes the service port without targetPort and passes pod targets through', async () => {
    expect(await resolveHop(api({ selector, ports: [{ port: 80 }] }, [podObject('a')]), SERVICE)).toEqual({ pod: 'a', port: 80 });
    expect(await resolveHop(api({}, []), POD)).toEqual({ pod: 'api-1', port: 8080 });
  });

  it('reads container ports and readiness', () => {
    const pod: KubeObject = { spec: { containers: [{ ports: [{ containerPort: 9090 }] }, { ports: [{ name: 'http', containerPort: 8080 }] }] } };
    expect(containerPort(pod, 8080)).toBe(8080);
    expect(containerPort(pod, '8080')).toBe(8080);
    expect(containerPort(pod, 'http')).toBe(8080);
    expect(containerPort(pod, 'grpc')).toBeUndefined();
    expect(containerPort(pod, undefined)).toBeUndefined();
    expect(podReady(podObject('a'))).toBe(true);
    expect(podReady(podObject('a', { phase: 'Pending' }))).toBe(false);
    expect(podReady(podObject('a', { ready: false }))).toBe(false);
    expect(podReady(podObject('a', { deleting: true }))).toBe(false);
  });
});
```

**E – `src/renderer/src/kube-view.test.ts`**, am Dateiende anfügen:
```ts

describe('port forwards', () => {
  it('starts empty, takes the list main sends and never saves it', () => {
    const state = initialKubeView('shop');
    expect(state.forwards).toEqual([]);
    const forwards = [{ id: 'f1', target: { kind: 'pods' as const, namespace: 'shop', name: 'api-1', port: 8080 }, localPort: 8080, open: 1 }];
    const next = kubeViewReducer(state, { type: 'event', event: { type: 'forwards', viewId: 'v1', forwards } });
    expect(next.forwards).toEqual(forwards);
    expect(kubeViewReducer(next, { type: 'event', event: { type: 'forwards', viewId: 'v1', forwards: [] } }).forwards).toEqual([]);
    expect(snapshotOf(next)).not.toHaveProperty('forwards');
    expect(snapshotOf(next)).toEqual(snapshotOf(state));
  });
});
```

**H – `src/main/kubernetes/session.test.ts`:**
- Vor Zeile 1 kommen `import { connect } from 'node:net';` und `import type { Duplex } from 'node:stream';`.
- Vor `import type { KubernetesConnectionNode } …` kommt `import { AppError } from '../../shared/errors';`.
- In `class FakeApi` folgt nach `  streams: { close: Mock }[] = [];` die Zeile `  forwards: { namespace: string; pod: string; port: number }[] = [];`.
- Nach der Methode `openTerminal` (als letzte Methode der Klasse) kommt:
```ts

  async portForward(namespace: string, pod: string, port: number, socket: Duplex): Promise<void> {
    this.forwards.push({ namespace, pod, port });
    socket.on('data', chunk => socket.write(chunk));
    socket.resume();
  }
```
- Am Dateiende anfügen. `eventsOf` aus Spec 10.5 gibt es nicht; der Test filtert selbst.
```ts

suite('port forwards of a view', () => {
  const target = { kind: 'pods' as const, namespace: 'shop', name: 'p1', port: 8080 };
  const forwardsOf = (world: World, viewId: string) => world.events
    .filter(entry => entry.ownerId === 1)
    .map(entry => entry.event)
    .filter((event): event is Extract<KubeEvent, { type: 'forwards' }> => event.type === 'forwards' && event.viewId === viewId)
    .map(event => event.forwards);
  const echo = (port: number, text: string) => new Promise<string>((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => socket.write(text));
    socket.once('data', data => { resolve(data.toString()); socket.end(); });
    socket.once('error', reject);
  });

  it('forwards through the session of the view, also on a read-only cluster', async () => {
    const world = setup();
    world.cluster.readOnly = true;
    const { viewId } = world.sessions.open(1, 'c1');
    await settle();
    const status = await world.sessions.startForward(1, viewId, target, 0);
    expect(await echo(status.localPort, 'ping')).toBe('ping');
    expect(world.api.forwards).toEqual([{ namespace: 'shop', pod: 'p1', port: 8080 }]);
    expect(forwardsOf(world, viewId).at(-1)?.[0]).toMatchObject({ id: status.id, pod: 'p1', podPort: 8080 });
    world.sessions.stopForward(1, viewId, status.id);
    expect(forwardsOf(world, viewId).at(-1)).toEqual([]);
  });

  it('refuses a session that is not ready, other owners, a locked vault and disabled clusters', async () => {
    const world = setup();
    const { viewId } = world.sessions.open(1, 'c1');
    await expect(world.sessions.startForward(1, viewId, target, 0)).rejects.toMatchObject({ code: 'kubernetes.notConnected' });
    await settle();
    await expect(world.sessions.startForward(2, viewId, target, 0)).rejects.toMatchObject({ code: 'kubernetes.viewUnavailable' });
    vi.mocked(world.deps.getCluster).mockImplementationOnce(() => { throw new AppError('core.vaultLocked'); });
    await expect(world.sessions.startForward(1, viewId, target, 0)).rejects.toMatchObject({ code: 'core.vaultLocked' });
    world.cluster.disabled = true;
    await expect(world.sessions.startForward(1, viewId, target, 0)).rejects.toMatchObject({ code: 'kubernetes.disabled' });
    expect(world.api.forwards).toEqual([]);
  });

  it('ends the forwards of a view with the view, silently, and all of them with closeAll', async () => {
    const world = setup();
    const first = world.sessions.open(1, 'c1').viewId;
    const second = world.sessions.open(1, 'c1').viewId;
    await settle();
    const a = await world.sessions.startForward(1, first, target, 0);
    const b = await world.sessions.startForward(1, second, target, 0);
    const before = forwardsOf(world, first).length;
    world.sessions.close(1, first);
    expect(forwardsOf(world, first)).toHaveLength(before);
    expect(await echo(b.localPort, 'still')).toBe('still');
    // A closed listener frees its port: the next forward can take it.
    expect((await world.sessions.startForward(1, second, target, a.localPort)).localPort).toBe(a.localPort);
    world.sessions.closeAll();
    const third = world.sessions.open(1, 'c1').viewId;
    await settle();
    expect((await world.sessions.startForward(1, third, target, b.localPort)).localPort).toBe(b.localPort);
    world.sessions.closeAll();
  });

  it('drops a forward whose view closed while it started', async () => {
    const world = setup();
    const { viewId } = world.sessions.open(1, 'c1');
    await settle();
    const starting = world.sessions.startForward(1, viewId, target, 0);
    world.sessions.close(1, viewId);
    await expect(starting).rejects.toMatchObject({ code: 'kubernetes.viewUnavailable' });
  });
});
```

**I1 – `src/renderer/src/kube-menu-run.test.ts`:**
- In `runner()` wird `help: vi.fn(),` zu `help: vi.fn(), forward: vi.fn(),`.
- Nach der Zeile `const ref = { kind: 'deployments' as const, namespace: 'shop', name: 'api' };` kommt:
  `const forwardRow = { uid: 'p', ref: { kind: 'pods', namespace: 'shop', name: 'api-1' }, cells: { status: 'Running' }, tone: 'ok', labels: {} } as KubeRow;`
- In `cases` kommt nach `[{ type: 'help' }, 'help', []],` die Zeile `      [{ type: 'forward', row: forwardRow }, 'forward', [forwardRow]],`.

**I1 – `src/renderer/src/kube-menus.test.ts`:**
- Pod-Liste (`:94`, Test `lists the groups in order for a running two-container pod`): `'Shell als Tab öffnen', '---',` wird zu `'Shell als Tab öffnen', 'Port weiterleiten…', '---',`. Die Stelle ist eindeutig.
- Service-Liste (**nur** `:369`, Test `lists the service menu without actions`; `:252` bleibt unverändert): `'Pods anzeigen', '---',` wird zu `'Pods anzeigen', 'Port weiterleiten…', '---',`.
- Am Dateiende anfügen:
```ts

describe('port forward entry', () => {
  const service = (patch: Partial<KubeRow> = {}) => row('services', 'web', { cells: { ports: '80/TCP' }, selector: { app: 'web' }, ports: [{ port: 80 }], ...patch });

  it('opens the dialog for a running pod, also on a read-only cluster', () => {
    const target = pod();
    expect(find(rowMenu(target), 'forward')).toMatchObject({ label: 'Port weiterleiten…', run: { type: 'forward', row: target } });
    expect(find(rowMenu(target), 'forward').disabled).toBeUndefined();
    expect(find(rowMenu(target, withStatus(READ_ONLY)), 'forward').disabled).toBeUndefined();
  });

  it('explains why it is not available', () => {
    expect(find(rowMenu(pod({ cells: { status: 'Pending' } })), 'forward')).toMatchObject({ disabled: true, hint: 'Der Pod läuft nicht.' });
    expect(find(rowMenu(pod(), withStatus(RECONNECTING)), 'forward')).toMatchObject({ disabled: true, hint: RECONNECTING_MESSAGE });
    expect(find(rowMenu(service({ ports: undefined })), 'forward')).toMatchObject({ disabled: true, hint: 'Dieser Service hat keinen TCP-Port.' });
    expect(find(rowMenu(service({ selector: undefined })), 'forward')).toMatchObject({ disabled: true, hint: 'Dieser Service hat keinen Selector, z. B. ExternalName.' });
    expect(find(rowMenu(service()), 'forward').disabled).toBeUndefined();
  });
});
```

**I2 – `src/renderer/src/kube-forward.test.ts` (neu), vollständig:**
```ts
import { describe, expect, it } from 'vitest';
import type { KubeForwardStatus, KubeRow } from '../../shared/kubernetes';
import { forwardAddress, forwardTargetOf, forwardUrl, parsePort, portLabel, targetText } from './kube-forward';

const status = (port: number): KubeForwardStatus => ({ id: 'f1', target: { kind: 'pods', namespace: 'shop', name: 'api-1', port }, localPort: 18080, open: 0 });
const row = (kind: KubeRow['ref']['kind'], namespace?: string): KubeRow => ({ uid: 'u', ref: { kind, ...(namespace ? { namespace } : {}), name: 'api' }, cells: {}, tone: 'ok', labels: {} });

describe('kube-forward helpers', () => {
  it('parses ports from form fields', () => {
    expect(parsePort('8080', false)).toBe(8080);
    expect(parsePort(' 80 ', false)).toBe(80);
    expect(parsePort('', true)).toBe(0);
    expect(parsePort('', false)).toBeNaN();
    for (const text of ['0', '65536', '8o', '-1', '1e3', '123456']) expect(parsePort(text, true), text).toBeNaN();
  });

  it('writes targets like kubectl and addresses with 127.0.0.1, never localhost', () => {
    expect(targetText({ kind: 'pods', namespace: 'shop', name: 'api-1', port: 8080 })).toBe('api-1:8080');
    expect(targetText({ kind: 'services', namespace: 'shop', name: 'api', port: 80 })).toBe('svc/api:80');
    expect(forwardAddress(status(80))).toBe('127.0.0.1:18080');
    expect(forwardUrl(status(80))).toBe('http://127.0.0.1:18080/');
    expect(forwardUrl(status(443))).toBe('https://127.0.0.1:18080/');
    expect(forwardUrl(status(8443))).toBe('https://127.0.0.1:18080/');
  });

  it('offers targets for namespaced pods and services only and labels ports', () => {
    expect(forwardTargetOf(row('pods', 'shop'), 8080)).toEqual({ kind: 'pods', namespace: 'shop', name: 'api', port: 8080 });
    expect(forwardTargetOf(row('services', 'shop'), 80)).toEqual({ kind: 'services', namespace: 'shop', name: 'api', port: 80 });
    expect(forwardTargetOf(row('deployments', 'shop'), 80)).toBeNull();
    expect(forwardTargetOf(row('pods'), 80)).toBeNull();
    expect(portLabel({ port: 8080, name: 'http' })).toBe('8080 (http)');
    expect(portLabel({ port: 8080 })).toBe('8080');
  });
});
```

**G:** Der Test aus Spec 3.17 gilt wörtlich. Er lief mit K1 dreimal grün, über den echten SSH-Fake und TLS.

### K7 – Doku (Task F): genaue Fundstellen und englische Texte
Die `>`-Zeichen in Spec 5 sind nur Zitat. Im Handbuch steht der Text als normales Markdown, ohne `>`. Ein Absatz darf eine einzige lange Zeile sein.

**`docs/handbuch.md`:**
1. `:435-436`: Die zwei Zeilen „- Pods und Services im Cluster sind hier nicht enthalten; der Cluster-Bereich zeigt“ / „  weiter den `kubectl port-forward`-Befehl zum Kopieren.“ werden ersetzt durch die eine Zeile `- Pods und Services im Cluster leitest du im Cluster-Tab weiter, siehe „Kubernetes → Port weiterleiten“.`
2. `:542-543`: Im Satz, der über den Zeilenumbruch geht, wird „Events und Describe bleiben erlaubt.“ zu „Events, Describe und `Port weiterleiten…` bleiben erlaubt.“ Der Rest der beiden Zeilen bleibt.
3. Neuer Unterabschnitt `### Port weiterleiten` mit dem Text aus Spec 5 Punkt 3, direkt vor der Zeile `## Dateiansicht: Tastatur und Übertragungen` (`:584`), mit einer Leerzeile davor und danach.

**`docs/manual.md`:**
1. `:425-426`: Die zwei Zeilen „- Pods and services in the cluster are not included; the cluster view still offers“ / „  the `kubectl port-forward` command to copy.“ werden ersetzt durch: `- Pods and services in the cluster are forwarded from the cluster tab, see “Kubernetes → Forward port”.`
2. `:531-532`: „events and describe stay allowed.“ wird zu „events, describe and `Forward port…` stay allowed.“
3. Direkt vor `## File view: keyboard and transfers` (`:573`) kommt, mit einer Leerzeile davor und danach:
```markdown
### Forward port

Right-click a running pod or a service → `Forward port…`. In the dialog you pick the port in the pod (the ports named in the manifest or `Other port…`) or the service port, and the local port. The same port is suggested; if you leave the field empty, Shellherd picks a free one. `Forward` starts the forward. The “Port forwards” bar at the bottom of the cluster tab shows `127.0.0.1:<port> → <target>`, the open connections and the last error, with `Open in browser`, `Copy address` and `Stop`.

- **127.0.0.1 only:** The port can only be reached from this computer, never from the network. There is no field for it.
- **Service:** Shellherd reads the selector and connects to the first ready pod (by name), on its `targetPort`, also when the port has a name. If the pod goes away, for example during a rollout, the next connection finds a new one by itself; running connections to the old pod end. Unlike `kubectl port-forward svc/…`, nothing has to be restarted. The bar names the pod (“via api-…:8080”). All connections go to this one pod; there is no load balancing.
- **Pod:** The forward stays with this pod name. After a container restart it keeps working, as it does for StatefulSet pods that come back under the same name. If the pod is replaced, the bar reports “Pod … does not exist (any more).” For Deployments, use the service instead.
- **Lifetime:** A forward belongs to its cluster tab. Closing the tab or the window, opening another vault or quitting Shellherd stops it. If the cluster reconnects, the local port stays open: new connections wait up to 30 seconds for the cluster, existing ones end. While locked, forwards keep running; new ones can only be started after unlocking. Nothing is saved, not even in the workspace.
- **“Read-only” and production:** A port forward changes nothing in the cluster and is therefore allowed under “Read-only” too. For production clusters the dialog names what becomes reachable; there is no name to type. Through the forward, programs can still read and write data, for example in a database, with that database's own login.
- **Permissions:** Kubernetes requires `create` on `pods/portforward` in the namespace (older versions `get`). The `edit` role has it, `view` does not. Services also need `get` on the service and `list` on pods. Without the permission the bar reports “No permission for port forwards in …”.
- **Limits:** At most 10 forwards at a time, at most 32 simultaneous connections per forward, TCP only. `Open in browser` uses `http`, for ports 443 and 8443 `https`.
- **Who reaches the port:** Every program and every user on this computer, including web pages in the browser through tricks such as DNS rebinding. There is no login on the port, just as with `kubectl port-forward`. So keep forwards open only as long as you need them, and on shared computers (terminal servers) do not forward to sensitive services.
```

**`CHANGELOG.md`:** Die beiden Punkte aus Spec 5 stehen unter `## [0.27.0] – 2026-10-25`, direkt vor `## [0.26.0] – 2026-10-25`, mit Leerzeile davor und danach.

**`CHANGELOG.en.md`:** an derselben Stelle:
```markdown
## [0.27.0] – 2026-10-25

- New: Port forwards to pods and services. Right-click in the cluster tab → `Forward port…` picks the port and the local port. The “Port forwards” bar at the bottom of the cluster tab lists them with `Open in browser`, `Copy address` and `Stop`. A service goes to a ready pod and finds the next one by itself after a rollout.
- Security: Port forwards listen on 127.0.0.1 only, live only as long as their cluster tab and are never saved. Shellherd changes nothing in the cluster for them, so “Read-only” allows them too. They need the `create` permission on `pods/portforward`.
```
**`README.md:50`:** wie Spec 5, wörtlich.

### K8 – run-app-Listen (Task J), wörtlich statt „in die Liste“
- `screens.mjs:2` und `SKILL.md:24`: `kubernetes|settings` wird zu `kubernetes|kube-forward|settings`.
- `SKILL.md:24`, gleiche Zeile: Vor „ (vault-path ohne Shot, nur Prüfungen)“ kommt „, kube-forward erzeugt kube-forward-dialog.png, kube-forward.png und kube-forward-error.png“.
- `SKILL.md:34`: Nach „`kubernetes.png`, “ kommt „`kube-forward-dialog.png`, `kube-forward.png`, `kube-forward-error.png`, “.
- `SKILL.md:46` (Zeile 9334): Vor „ | `kube-fake.mjs` |“ kommt „; beantwortet auch `pods/<name>/portforward` per WebSocket (Port 8080 laufender Pods liefert eine synthetische Textseite)“.
- Neuer Stolperstein wie Spec 6.2, mit dem `ws`-Satz aus K5. Er wird als letzter Punkt unter `## Stolpersteine` angefügt.
- Der Block `kube-forward` (Spec 6.1) steht in `screens.mjs` direkt nach dem Block `async kubernetes() { … },`.

### K9 – Überholte Spec-Aussagen
- 1j „Gegendruck … nicht jetzt“, Risiko 2 und das Extra „Gegendruck im WebSocket-Pfad“ sind durch K1 erledigt. Der Shortcut-Kommentar aus Spec 3.5 entfällt.
- Abschnitt 7 „Keine neue npm-Abhängigkeit (`ws` ist schon da)“ und Risiko 9 sind durch K5 ersetzt.
- **M8** prüft jetzt den Fix:
  - Während eines großen Downloads steigt der Speicher von Shellherd nur um wenige MB, nicht um die Dateigröße.
  - Die heruntergeladene Datei ist vollständig. Zur Gegenprobe die Größe vergleichen, z. B. `curl -o` und Prüfsumme gegen `kubectl exec … sha256sum` auf dem Zugangs-Host, nur lesend.

## 4. Rulings

- **V1 Gegendruck wird jetzt behoben, nicht dokumentiert.** Ohne ihn gehen Daten verloren (B1), nicht nur Speicher. Der Fix sind rund 20 Zeilen ohne eigene Stream-Brücke.
  - Grenze lokal → Pod: 1 MiB `bufferedAmount`.
  - Pod → lokal: Grenze ist die `highWaterMark` des Sockets (16 KiB), über `drain`.
- **V2 `ws` als devDependency `8.22.0`, exakt.** Das ist dieselbe Version wie im Lockfile, also kein neuer Code im Baum. `@types/ws` kommt nicht dazu:
  - Produktivcode typisiert über `ForwardSocket` (K1).
  - Der Test über `createRequire` mit lokalen Interfaces.
  - So braucht kein Umsetzer Netzwerk für `npm install`.
- **V3 Ende einer Verbindung:**
  - WebSocket `close` → lokaler Socket `end`, dann `destroy`. WebSocket `error` und Kanal 1 → `destroy`.
  - Auch ein abgerissener Tunnel (1006) endet sauber: Ausgelieferte Daten gehen nie verloren. Protokolle mit Längenangabe (HTTP, Datenbanken) erkennen einen Abbruch selbst.
- **V4 Sperre:** Laufende Weiterleitungen laufen weiter, Starten lehnt Main ab (`core.vaultLocked`, Pflicht-Test H). `Stoppen` braucht den Vault nicht; Stoppen ist die sichere Richtung. Das passt zu den anderen Paketen:
  - **Haertung:** Port-Forward löst keine Rückfrage aus. Ein Reconnect während der Sperre scheitert am Broker; neue Verbindungen enden dann mit `kubernetes.reconnecting`.
  - **Fensterschutz:** `setContentProtection` gilt nur für Fenster.
  - **ssh-pro:** gleiche Regel wie für SSH-Weiterleitungen (`:315`).
  - **Lock-Screen R1:** Der Dialog liegt wie `ConfirmAction` unter dem Sperrbildschirm im Top-Layer.
- **V5 „Nur lesen“ erlaubt Port-Forward (Spec R6.2 bestätigt).** Das Nutzer-Ruling R-0 nennt `create` auf `pods/portforward` ausdrücklich als erlaubt. Bei Produktion steht die Hinweiszeile im Dialog.
- **V6 Ziele des Renderers:** Er darf jeden Namespace, Pod und Service **im Cluster seiner View** angeben, nie einen anderen Cluster. Die View legt den Cluster fest (`viewOf`, Besitzer-Prüfung). Die Grenze setzt RBAC, wie bei Tabelle, YAML und Logs.
  - Main prüft per zod `.strict()`: `kind` nur `pods|services`, Namen DNS-1123, Ports ganzzahlig 1–65535, lokal 0–65535, UUIDs. Eine Bind-Adresse lehnt das Schema ab (Pflicht-Test A).
- **V7 Verb-Prüfung (Nutzer-Ruling).** Neu sind genau diese Aufrufe:

  | Aufruf | Verb |
  |---|---|
  | `api.read({ kind: 'services' … })` | `get` services |
  | `api.list('pods', ns, { labels })` | `list` pods |
  | `PortForward.portForward` (WebSocket-GET auf `pods/<pod>/portforward`) | `create` (ältere Server: `get`) auf `pods/portforward` |

  - Kein `watch`, `patch`, `delete`, kein `create` auf Objekte, kein `exec`. `portForwardService` und `portForwardDeployment` aus client-node werden nicht benutzt.
  - Der Fake erlaubt keinen schreibenden Weg: Nicht-GET bleibt 403, und Upgrades gehen nur auf `…/portforward`.
  - **Kein Blocker.**
- **V8 Lebenszyklus:**
  - Tab-Ende, `Erneut versuchen`, Fenster schließen oder abstürzen, Neuladen (`did-start-navigation`), Vault-Wechsel und Beenden schließen die Weiterleitungen (`close`/`closeOwner`/`closeAll`). K3 schließt die Lücke während `listen`.
  - Für Cluster gibt es keine Leerlauf-Trennung (`ssh/session.ts:112-115` gilt nur für Terminals). Den Zugangs-Host hält der SSH-Keepalive.
  - Reconnect: Der Listener bleibt, `waitReady` wartet bis 30 s, bestehende Verbindungen enden (V3).
  - Die ssh2-Eigenheit behandelt `dropChannel` im Tunnel.
- **V9 Risiko 8 (11 statt 10 Weiterleitungen bei gleichzeitigem Start) bleibt hingenommen.** Es betrifft nur dieselbe View in derselben Millisekunde, und K3 verhindert verwaiste Einträge.

## 5. Sicherheitsprüfung

| Punkt | Befund | Beleg |
|---|---|---|
| Bindung nur `127.0.0.1` | fest in `listen(port, '127.0.0.1')`, kein Feld, Schema `.strict()` | Pflicht-Tests D (Spion auf `listen`) und A (`bind`, `host` abgelehnt) |
| Grenzen 10 / 32 | in `start` und `accept` | Pflicht-Tests D |
| Schließen bei Tab-Ende, Vault-Wechsel, Beenden | `stopView` in `close`, `stopAll` in `closeAll`; K3 für den Start-Wettlauf | Pflicht-Tests H, D |
| Sperre | läuft weiter, Start abgelehnt | Pflicht-Test H (`core.vaultLocked`), V4 |
| Renderer-Ziele | nur der Cluster der eigenen View; zod in Main | V6, Pflicht-Test A |
| Bestätigungspfad / keine Exec ohne Klick | Start nur über den Dialog-Knopf → IPC; kein `exec`; nichts startet automatisch, nichts wird gespeichert (`snapshotOf` unverändert) | Pflicht-Test E |
| Keine Secrets, kubeconfig verlässt Main nie | `KubeConfig` bleibt in `createKubeApi`; `KubeForwards` sieht nur `KubeApi`. Der Status trägt Ziel, Pod, Port, Zähler und `CodedError`. Kubelet-Text auf Kanal 1 wird verworfen | Pflicht-Test B (`10.244` nicht in der Meldung) |
| Gegendruck / Speicher | K1 | Pflicht-Tests B, Messung oben |
| Lokale Erreichbarkeit, DNS-Rebinding | prinzipbedingt, Hinweis im Handbuch (R5.1) | hingenommen |
| `Im Browser öffnen` | `webLinkHref` nur `http:`/`https:`, Vault muss entsperrt sein | `index.ts:344-350` |

## 6. Wellen und Tasks (endgültig, exklusive Dateien)

Nach **jeder** Welle müssen `npm run typecheck` und `npx vitest run` vollständig grün sein. Im Scratchpad ist das für Welle 1 und Welle 2 mit genau dieser Aufteilung belegt.
- Innerhalb einer Welle darf ein Task auf den Vertrag eines Nachbar-Tasks verweisen.
- Umsetzer schreiben nur ihre eigenen Dateien, führen kein `npm install` aus und committen nie.
- Der Projektcode ist CRLF; Ersetzungen gelten zeilenweise.

| Welle | Task | Dateien (exklusiv) | Inhalt |
|---|---|---|---|
| 1 | **A** Vertrag | `src/shared/kubernetes.ts`, `src/shared/kubernetes-schema.ts`, `src/shared/kubernetes-schema.test.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/shared/locales/de-DE/errors/kubernetes.json`, `src/shared/locales/en-US/errors/kubernetes.json` | Spec 3.1–3.4; Test K6 (A) |
| 1 | **B** Client | `src/main/kubernetes/api.ts`, `src/main/kubernetes/client-api.ts`, `src/main/kubernetes/client-api.test.ts`, `src/main/kubernetes/overview.test.ts`, `src/main/kubernetes/watch.test.ts` | K1, K2; Test K6 (B) |
| 1 | **C** Zeilen | `src/main/kubernetes/rows.ts`, `src/main/kubernetes/rows.test.ts` | Spec 3.9; Test K6 (C) |
| 1 | **D** Weiterleitungen | `src/main/kubernetes/forwards.ts` (neu), `src/main/kubernetes/forwards.test.ts` (neu) | Spec 3.6 wörtlich; Test K6 (D) |
| 1 | **E** Renderer-Zustand | `src/renderer/src/kube-view.ts`, `src/renderer/src/kube-view.test.ts`, `src/renderer/src/hooks/useClusterSession.ts` | Spec 3.10 mit K4; Test K6 (E) |
| 1 | **H** Sessions und IPC | `src/main/kubernetes/session.ts`, `src/main/kubernetes/session.test.ts`, `src/main/kubernetes/ipc.ts` | Spec 3.7 mit K3, Spec 3.8; Test K6 (H) |
| 1 | **F** Doku, Version, `ws` | `docs/handbuch.md`, `docs/manual.md`, `CHANGELOG.md`, `CHANGELOG.en.md`, `README.md`, `package.json`, `package-lock.json` | Spec 3.18 und 5 mit K5 und K7 |
| 2 | **I1** Menüs | `src/renderer/src/kube-menus.ts`, `src/renderer/src/kube-menus.test.ts`, `src/renderer/src/kube-menu-run.ts`, `src/renderer/src/kube-menu-run.test.ts`, `src/shared/locales/de-DE/kubeActions.json`, `src/shared/locales/en-US/kubeActions.json` | Spec 3.11; Test K6 (I1) |
| 2 | **I2** Dialog und Leiste | `src/renderer/src/kube-forward.ts` (neu), `src/renderer/src/kube-forward.test.ts` (neu), `src/renderer/src/components/kubernetes/KubeForwardDialog.tsx` (neu), `src/renderer/src/components/kubernetes/KubeForwardBar.tsx` (neu), `src/renderer/src/components/kubernetes/ClusterView.tsx`, `src/renderer/src/kubernetes-ui.css`, `src/shared/locales/de-DE/kubernetes.json`, `src/shared/locales/en-US/kubernetes.json` | Spec 3.12–3.16; Test K6 (I2) |
| 2 | **G** Fake | `.claude/skills/run-app/kube-fake.mjs`, `.claude/skills/run-app/kube-fixtures.mjs`, `.claude/skills/run-app/fakes.test.mjs` | Spec 3.17 mit K5 |
| 3 | **J** Abnahme | `.claude/skills/run-app/screens.mjs`, `.claude/skills/run-app/SKILL.md` | Spec 6 mit K5 und K8, danach run-app ausführen und die drei Shots ansehen |

Warum diese Schnitte:
- **B, D und H in Welle 1:** B erweitert `KubeApi`. Alle drei Fakes bekommen `portForward` in derselben Welle (B: `overview`, `watch`; H: `session`).
- **A und E in Welle 1:** A ergänzt `KubeEvent`, E behandelt den neuen Fall.
- **F in Welle 1:** F hält `version.test.ts` grün, weil Version und CHANGELOG gemeinsam geändert werden. Das `ws` aus F nutzen B (Test) und G.
- **I1 und I2 in Welle 2:** I1 macht `MenuRunner.forward` zur Pflicht, I2 implementiert es in `ClusterView`. Erst beide zusammen typprüfen grün. Die UI-Keys entstehen und werden benutzt in derselben Welle; (d) des Katalogtests bleibt grün.
- **G** hängt von B und D ab.
- **J** braucht den gebauten Stand aller Wellen.

## 7. Nicht geprüft

- run-app (Task J) in der echten App: Der Block ist gegen die Treiber-Helfer gelesen (`rclick`, `menuItem`, `fill` mit leerem Wert, `closeTabs` klickt bei offenem `compact-confirm` den Primärknopf), aber nicht ausgeführt.
- Ein echter API-Server mit Kubelet (M1) und die Wirkung von `ping` hinter Proxys wie Rancher oder Teleport. Das bleibt bei M1 und M11.
