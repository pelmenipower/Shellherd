# Kubernetes-Integration (Stufe 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Einen Cluster-Eintrag im Vault, der über eine SSH-Verbindung zu `k8s-cp1` (Failover cp2/cp3) die Kubernetes-API tunnelt und einen Cluster-Tab mit Live-Tabelle, Node-Streifen, Problem-Hinweis, angedocktem Terminal (Logs/Shell/Events/YAML/Describe), Aktionen mit Bestätigung und Hilfe-Übersicht öffnet.

**Architecture:** Neues Main-Modul `src/main/kubernetes/`. `access.ts` liest die kubeconfig per SSH von einem Zugangs-Host, `tunnel.ts` leitet einen lokalen Port per ssh2 `forwardOut` zum API-Server, `client-api.ts` kapselt `@kubernetes/client-node` hinter dem schmalen Interface `KubeApi` (alles andere hängt nur an diesem Interface und ist mit Fakes testbar). `session.ts` hält eine Cluster-Session pro Cluster mit Views pro Tab und schickt gebündelte Updates per IPC. Der Renderer bekommt einen neuen Tab-Typ (`protocol: 'kubernetes'`) mit reinem Reducer `kube-view.ts`, Befehls-Registry `kube-commands.ts` und Komponenten unter `components/kubernetes/`. Logs und Shell laufen als neue Terminal-Quelle durch den bestehenden `SshSessionManager`.

**Tech Stack:** Electron 44, React 19, TypeScript 5.9 (ESM), ssh2, `@kubernetes/client-node` 2.0.0, zod 4, vitest 5, xterm.js 6.

**Spec:** `docs/superpowers/specs/2026-10-16-kubernetes-integration-design.md`

## Global Constraints

- Einzige neue Abhängigkeit: `"@kubernetes/client-node": "2.0.0"` (exakt gepinnt). Kein anderes Paket. YAML über `loadYaml`/`dumpYaml` aus `@kubernetes/client-node`.
- Keine Vault-Migration: `version` bleibt `2`, neue Felder/Arten sind optional bzw. neue Union-Mitglieder.
- UI-Texte und Fehlermeldungen auf Deutsch, Code-Kommentare auf Englisch, knapp wie im bestehenden Code.
- Die kubeconfig verlässt nie den Main-Prozess: nicht in den Renderer, nicht auf die Platte, nicht in Logs, nicht in Fehlermeldungen.
- Der Tunnel lauscht nur auf `127.0.0.1`, Port `0` (zufällig).
- Namen (Namespace, Pod, Workload, Container, Node) passen auf `KUBE_NAME` = `^[a-z0-9]([-a-z0-9.]{0,251}[a-z0-9])?$`. Alles andere wird vor jedem API-Aufruf abgewiesen.
- Der Renderer schickt nie Pfade, YAML oder Befehle, nur `KubeRef`, `KubeQuery`, das Enum `KubeAction` und `replicas` (Ganzzahl 0–1000).
- `readOnly` wird im Main durchgesetzt: `k8s:action` und Shell-Terminals werden abgelehnt mit „Dieser Cluster ist schreibgeschützt.“.
- Jede verändernde Aktion braucht im Renderer einen Bestätigungsdialog. Bei `production` oder `replicas === 0` muss der Ressourcenname exakt eingetippt werden. Keine Option „nicht mehr fragen“.
- Kubeconfigs mit `exec` oder `auth-provider` im User werden abgelehnt.
- Zeiten: Update-Bündelung 250 ms, Metrics alle 15 000 ms (Historie 20 Werte), Session schließt 60 000 ms nach der letzten View, Backoff 1 s, 2 s, 5 s, 10 s, dann 30 s, Pending-Schwelle 5 min, OOMKilled-Fenster 60 min, Watch-Hinweis nach 3 Fehlversuchen in Folge.
- Gegen den echten Cluster wird nichts Veränderndes ausgeführt, auch nicht zum Testen. Tests nur mit Fakes.
- Befehle: `npm test` (vitest), `npm run typecheck`. Einzeltest: `npx vitest run <pfad>`.
- Branch: `claude/feature/kubernetes`. Commit-Format laut `~/.claude/CLAUDE.md` (type(scope): summary, What/Why, Bullets, **keine** Co-Authored-By-Zeile).
- **Parallel arbeitende Agenten committen nicht** und führen kein `git add` aus. Sie fassen nur die Dateien ihrer Task an. Der Orchestrator prüft und committet pro Task.

## Review Focus

1. **Cluster-Eintrag verweist auf gelöschte oder deaktivierte SSH-Verbindung:** wird übersprungen, nächste wird versucht; sind alle ungültig, klare Meldung statt Absturz. Test in Task 4.
2. **Pod mit mehreren Containern, Init-Containern oder ohne Status (gerade geplant):** Zeile darf nicht crashen, Ready `0/2`, Status `Pending`. Test in Task 5.
3. **Watch endet mit 410 Gone mitten im Betrieb:** Liste wird neu geladen (`reset: true`), keine Geisterzeilen. Test in Task 13.
4. **Zwei Cluster-Tabs desselben Clusters (auch in zwei Fenstern):** nur eine SSH-Verbindung, ein Tunnel; Schließen eines Tabs beendet die Session nicht. Test in Task 15.
5. **Kubeconfig mit IP-Adresse als Server (`https://10.0.0.5:6443`):** Tunnel-Ziel ist die IP, `tlsServerName` ist die IP. Test in Task 3.

---

## Abhängigkeiten zwischen Tasks (Wellen)

| Welle | Tasks | parallel? |
|---|---|---|
| 1 | Task 1 (Vertrag) | nein, alles hängt daran |
| 2 | Tasks 2–12 | ja, disjunkte Dateien |
| 3 | Tasks 13, 14 | ja |
| 4 | Task 15 (Session + IPC + Main) | nein |
| 5 | Tasks 16, 17 | ja |
| 6 | Task 18 (Doku) | nein |

---

### Task 1: Gemeinsamer Vertrag, Vault-Verbindungsart, Abhängigkeit

**Files:**
- Modify: `package.json` (dependency)
- Create: `src/shared/kubernetes.ts`
- Create: `src/shared/kubernetes-schema.ts`
- Create: `src/shared/kubernetes-schema.test.ts`
- Modify: `src/shared/vault/types.ts`, `src/shared/vault/schema.ts`, `src/shared/vault/connections.ts`, `src/shared/vault/schema.test.ts`
- Modify: `src/shared/windows.ts` (`TabConnection.kube`), `src/shared/ssh.ts` (`SshPrepareRequest.kube`)
- Modify: `src/shared/ipc.ts`, `src/preload/index.ts` (Kanäle + `DesktopApi`)
- Modify: alle Stellen, die nach dem Hinzufügen von `'kubernetes'` zu `ConnectionProtocol` nicht mehr typprüfen

**Interfaces:**
- Produces: alles aus `src/shared/kubernetes.ts` (siehe Code), `KubernetesConnectionNode`, `KubernetesConnectionNodeSchema`, `KubeQuerySchema`, `KubeRefSchema`, `KubeTerminalTargetSchema`, `WorkspaceKubeTab`, IPC-Kanäle `kubeOpen`, `kubeSubscribe`, `kubeDetail`, `kubeAction`, `kubeClose`, `kubeProbe`, `kubeEvent`.

- [ ] **Step 1: Abhängigkeit installieren**

Run: `npm install --save-exact @kubernetes/client-node@2.0.0`
Expected: `package.json` enthält `"@kubernetes/client-node": "2.0.0"`.

- [ ] **Step 2: `src/shared/kubernetes.ts` anlegen**

```ts
/** Kubernetes cluster tab; see docs/superpowers/specs/2026-10-16-kubernetes-integration-design.md. */

/** DNS-1123 subdomain: namespaces, pods, workloads, containers and nodes. */
export const KUBE_NAME = /^[a-z0-9]([-a-z0-9.]{0,251}[a-z0-9])?$/;
/** Label key with optional prefix, and label value; no commas or operators. */
export const LABEL_KEY = /^([a-z0-9]([-a-z0-9.]{0,251}[a-z0-9])?\/)?[A-Za-z0-9]([-A-Za-z0-9_.]{0,61}[A-Za-z0-9])?$/;
export const LABEL_VALUE = /^([A-Za-z0-9]([-A-Za-z0-9_.]{0,61}[A-Za-z0-9])?)?$/;
export const MAX_REPLICAS = 1000;
export const READ_ONLY_MESSAGE = 'Dieser Cluster ist schreibgeschützt.';

export const KUBE_KINDS = ['pods', 'deployments', 'statefulsets', 'daemonsets', 'jobs', 'cronjobs', 'services', 'ingresses', 'nodes', 'events'] as const;
export type KubeKind = typeof KUBE_KINDS[number];

export interface KindInfo { label: string; apiVersion: string; kind: string; namespaced: boolean; command: string }
export const KIND_INFO: Record<KubeKind, KindInfo> = {
  pods: { label: 'Pods', apiVersion: 'v1', kind: 'Pod', namespaced: true, command: 'pods' },
  deployments: { label: 'Deployments', apiVersion: 'apps/v1', kind: 'Deployment', namespaced: true, command: 'deploy' },
  statefulsets: { label: 'StatefulSets', apiVersion: 'apps/v1', kind: 'StatefulSet', namespaced: true, command: 'sts' },
  daemonsets: { label: 'DaemonSets', apiVersion: 'apps/v1', kind: 'DaemonSet', namespaced: true, command: 'ds' },
  jobs: { label: 'Jobs', apiVersion: 'batch/v1', kind: 'Job', namespaced: true, command: 'jobs' },
  cronjobs: { label: 'CronJobs', apiVersion: 'batch/v1', kind: 'CronJob', namespaced: true, command: 'cronjobs' },
  services: { label: 'Services', apiVersion: 'v1', kind: 'Service', namespaced: true, command: 'svc' },
  ingresses: { label: 'Ingress', apiVersion: 'networking.k8s.io/v1', kind: 'Ingress', namespaced: true, command: 'ing' },
  nodes: { label: 'Nodes', apiVersion: 'v1', kind: 'Node', namespaced: false, command: 'nodes' },
  events: { label: 'Events', apiVersion: 'v1', kind: 'Event', namespaced: true, command: 'events' },
};

export interface KubeRef { kind: KubeKind; namespace?: string; name: string }
export const refKey = (ref: KubeRef): string => `${ref.kind}/${ref.namespace ?? ''}/${ref.name}`;

/** Drill-down narrowing: pods matching labels, or pods on a node. */
export interface KubeSelector { labels?: Record<string, string>; node?: string }
/** One table: a kind in a namespace (null = all namespaces), optionally narrowed. */
export interface KubeQuery { kind: KubeKind; namespace: string | null; selector?: KubeSelector }
export const queryKey = (query: KubeQuery): string => JSON.stringify([query.kind, query.namespace,
  Object.entries(query.selector?.labels ?? {}).sort(), query.selector?.node ?? null]);

export type RowTone = 'ok' | 'warn' | 'bad' | 'muted';
export interface KubeRow {
  uid: string;
  ref: KubeRef;
  /** Column key → value; keys from KIND_COLUMNS. Columns with `age` hold an ISO timestamp. */
  cells: Record<string, string | number>;
  tone: RowTone;
  labels: Record<string, string>;
  /** Pods: container names in spec order (no init containers). */
  containers?: string[];
  /** Workloads and services: the pod selector used for drill-down. */
  selector?: Record<string, string>;
  /** Pods: the node they run on. */
  node?: string;
  /** Deployments and StatefulSets: desired replicas, for scale. */
  replicas?: number;
}

export interface ColumnInfo { key: string; label: string; numeric?: boolean; age?: boolean; usage?: 'cpu' | 'memory' }
export const KIND_COLUMNS: Record<KubeKind, ColumnInfo[]> = {
  pods: [{ key: 'name', label: 'Name' }, { key: 'ready', label: 'Ready' }, { key: 'status', label: 'Status' },
    { key: 'restarts', label: 'Restarts', numeric: true }, { key: 'cpu', label: 'CPU', usage: 'cpu' }, { key: 'memory', label: 'RAM', usage: 'memory' },
    { key: 'node', label: 'Node' }, { key: 'age', label: 'Alter', age: true }],
  deployments: [{ key: 'name', label: 'Name' }, { key: 'ready', label: 'Ready' }, { key: 'upToDate', label: 'Aktuell', numeric: true },
    { key: 'image', label: 'Image' }, { key: 'age', label: 'Alter', age: true }],
  statefulsets: [{ key: 'name', label: 'Name' }, { key: 'ready', label: 'Ready' }, { key: 'upToDate', label: 'Aktuell', numeric: true },
    { key: 'image', label: 'Image' }, { key: 'age', label: 'Alter', age: true }],
  daemonsets: [{ key: 'name', label: 'Name' }, { key: 'ready', label: 'Ready' }, { key: 'upToDate', label: 'Aktuell', numeric: true },
    { key: 'image', label: 'Image' }, { key: 'age', label: 'Alter', age: true }],
  jobs: [{ key: 'name', label: 'Name' }, { key: 'completions', label: 'Abgeschlossen' }, { key: 'lastRun', label: 'Letzter Lauf', age: true },
    { key: 'age', label: 'Alter', age: true }],
  cronjobs: [{ key: 'name', label: 'Name' }, { key: 'schedule', label: 'Zeitplan' }, { key: 'lastRun', label: 'Letzter Lauf', age: true },
    { key: 'age', label: 'Alter', age: true }],
  services: [{ key: 'name', label: 'Name' }, { key: 'type', label: 'Typ' }, { key: 'clusterIp', label: 'Cluster-IP' },
    { key: 'ports', label: 'Ports' }, { key: 'age', label: 'Alter', age: true }],
  ingresses: [{ key: 'name', label: 'Name' }, { key: 'hosts', label: 'Hosts' }, { key: 'address', label: 'Adresse' }, { key: 'age', label: 'Alter', age: true }],
  nodes: [{ key: 'name', label: 'Name' }, { key: 'status', label: 'Status' }, { key: 'roles', label: 'Rollen' },
    { key: 'cpu', label: 'CPU', usage: 'cpu' }, { key: 'memory', label: 'RAM', usage: 'memory' }, { key: 'pods', label: 'Pods', numeric: true },
    { key: 'version', label: 'Kubelet' }],
  events: [{ key: 'type', label: 'Typ' }, { key: 'reason', label: 'Grund' }, { key: 'object', label: 'Objekt' },
    { key: 'message', label: 'Meldung' }, { key: 'count', label: 'Anzahl', numeric: true }, { key: 'last', label: 'Zuletzt', age: true }],
};

export interface NodeTile {
  name: string;
  ready: boolean;
  roles: string[];
  /** Conditions MemoryPressure / DiskPressure / PIDPressure that are True. */
  pressure: string[];
  unschedulable: boolean;
  /** Share of allocatable, 0..1; absent without metrics. */
  cpu?: number;
  memory?: number;
}

export interface Usage { cpuMilli: number; memoryBytes: number }
/** Samples per pod refKey, oldest first, at most 20. */
export type UsageHistory = Record<string, Usage[]>;

export type ProblemKind = 'crashloop' | 'oomkilled' | 'image' | 'pending' | 'node';
export interface KubeProblem { id: string; kind: ProblemKind; ref: KubeRef; message: string }

export type ClusterState = 'connecting' | 'ready' | 'reconnecting' | 'error';
export interface ClusterStatus {
  state: ClusterState;
  name: string;
  production: boolean;
  readOnly: boolean;
  /** Name of the SSH connection carrying the tunnel. */
  host?: string;
  message?: string;
  /** metrics.k8s.io answered. */
  metrics: boolean;
}

export type KubeEvent =
  | { type: 'status'; viewId: string; status: ClusterStatus }
  | { type: 'rows'; viewId: string; query: KubeQuery; reset: boolean; upserts: KubeRow[]; deletes: string[] }
  | { type: 'overview'; viewId: string; nodes: NodeTile[]; problems: KubeProblem[]; namespaces: string[] }
  | { type: 'usage'; viewId: string; pods: UsageHistory };

export type KubeDetailMode = 'yaml' | 'describe' | 'events';
export type KubeDetail = { mode: 'yaml' | 'describe'; text: string } | { mode: 'events'; rows: KubeRow[] };
export type KubeAction = 'restart' | 'scale' | 'delete';
export const ACTION_KINDS: Record<KubeAction, KubeKind[]> = {
  restart: ['deployments', 'statefulsets', 'daemonsets'], scale: ['deployments', 'statefulsets'], delete: ['pods'],
};

export interface KubeOpenRequest { clusterId: string }
export interface KubeViewRequest { viewId: string }
export interface KubeSubscribeRequest { viewId: string; query: KubeQuery }
export interface KubeDetailRequest { viewId: string; ref: KubeRef; mode: KubeDetailMode }
export interface KubeActionRequest { viewId: string; ref: KubeRef; action: KubeAction; replicas?: number }
export interface KubeProbeRequest { connectionId: string }
export interface KubeProbeResult { source: string; contexts: string[]; currentContext?: string; clusterName?: string }

export type KubeTerminalMode = 'logs' | 'previous' | 'shell';
export interface KubeTerminalTarget { namespace: string; pod: string; container: string; mode: KubeTerminalMode }

export type DockMode = 'logs' | 'shell' | 'events' | 'yaml' | 'describe';
/** Saved state of a cluster tab in a workspace. */
export interface KubeViewSnapshot { query: KubeQuery; crumbs: string[]; selected?: string; dock: DockMode }
```

- [ ] **Step 3: Failing schema test `src/shared/kubernetes-schema.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { KubeActionRequestSchema, KubeQuerySchema, KubeRefSchema, KubeTerminalTargetSchema } from './kubernetes-schema';

describe('kubernetes schemas', () => {
  it('accepts a namespaced ref and rejects bad names', () => {
    expect(KubeRefSchema.safeParse({ kind: 'pods', namespace: 'shop', name: 'api-7f9c-x2kq' }).success).toBe(true);
    expect(KubeRefSchema.safeParse({ kind: 'pods', namespace: 'shop', name: 'API' }).success).toBe(false);
    expect(KubeRefSchema.safeParse({ kind: 'pods', namespace: '../x', name: 'a' }).success).toBe(false);
    expect(KubeRefSchema.safeParse({ kind: 'secrets', name: 'a' }).success).toBe(false);
  });
  it('accepts queries with label and node selectors', () => {
    expect(KubeQuerySchema.safeParse({ kind: 'pods', namespace: null, selector: { labels: { 'app.kubernetes.io/name': 'api' }, node: 'worker1' } }).success).toBe(true);
    expect(KubeQuerySchema.safeParse({ kind: 'pods', namespace: null, selector: { labels: { app: 'a,b' } } }).success).toBe(false);
  });
  it('bounds replicas', () => {
    const ref = { kind: 'deployments', namespace: 'shop', name: 'api' };
    expect(KubeActionRequestSchema.safeParse({ viewId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d', ref, action: 'scale', replicas: 3 }).success).toBe(true);
    expect(KubeActionRequestSchema.safeParse({ viewId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d', ref, action: 'scale', replicas: 1001 }).success).toBe(false);
    expect(KubeActionRequestSchema.safeParse({ viewId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d', ref, action: 'scale', replicas: 1.5 }).success).toBe(false);
  });
  it('validates terminal targets', () => {
    expect(KubeTerminalTargetSchema.safeParse({ namespace: 'shop', pod: 'api-1', container: 'api', mode: 'shell' }).success).toBe(true);
    expect(KubeTerminalTargetSchema.safeParse({ namespace: 'shop', pod: 'api-1', container: 'api;rm', mode: 'shell' }).success).toBe(false);
  });
});
```

Run: `npx vitest run src/shared/kubernetes-schema.test.ts` → FAIL (module not found).

- [ ] **Step 4: `src/shared/kubernetes-schema.ts`**

```ts
import { z } from 'zod';
import { KUBE_KINDS, KUBE_NAME, LABEL_KEY, LABEL_VALUE, MAX_REPLICAS } from './kubernetes';
import type { DockMode, KubeQuery, KubeRef, KubeTerminalTarget, KubeViewSnapshot } from './kubernetes';

export const KubeNameSchema = z.string().max(253).regex(KUBE_NAME);
const viewId = z.string().uuid();
export const KubeRefSchema: z.ZodType<KubeRef> = z.object({ kind: z.enum(KUBE_KINDS), namespace: KubeNameSchema.optional(), name: KubeNameSchema }).strict();
export const KubeSelectorSchema = z.object({
  labels: z.record(z.string().max(317).regex(LABEL_KEY), z.string().max(63).regex(LABEL_VALUE)).optional(),
  node: KubeNameSchema.optional(),
}).strict();
export const KubeQuerySchema: z.ZodType<KubeQuery> = z.object({ kind: z.enum(KUBE_KINDS), namespace: KubeNameSchema.nullable(), selector: KubeSelectorSchema.optional() }).strict();
export const KubeOpenRequestSchema = z.object({ clusterId: z.string().min(1).max(256) }).strict();
export const KubeViewRequestSchema = z.object({ viewId }).strict();
export const KubeSubscribeRequestSchema = z.object({ viewId, query: KubeQuerySchema }).strict();
export const KubeDetailRequestSchema = z.object({ viewId, ref: KubeRefSchema, mode: z.enum(['yaml', 'describe', 'events']) }).strict();
export const KubeActionRequestSchema = z.object({ viewId, ref: KubeRefSchema, action: z.enum(['restart', 'scale', 'delete']),
  replicas: z.number().int().min(0).max(MAX_REPLICAS).optional() }).strict();
export const KubeProbeRequestSchema = z.object({ connectionId: z.string().min(1).max(256) }).strict();
export const KubeTerminalTargetSchema: z.ZodType<KubeTerminalTarget> = z.object({ namespace: KubeNameSchema, pod: KubeNameSchema, container: KubeNameSchema,
  mode: z.enum(['logs', 'previous', 'shell']) }).strict();
const DockModeSchema: z.ZodType<DockMode> = z.enum(['logs', 'shell', 'events', 'yaml', 'describe']);
export const KubeViewSnapshotSchema: z.ZodType<KubeViewSnapshot> = z.object({ query: KubeQuerySchema, crumbs: z.array(z.string().max(300)).max(8),
  selected: z.string().max(600).optional(), dock: DockModeSchema }).strict();
```

Run: `npx vitest run src/shared/kubernetes-schema.test.ts` → PASS.

- [ ] **Step 5: Vault-Typen erweitern (`src/shared/vault/types.ts`)**

- `ConnectionProtocol` um `'kubernetes'` erweitern.
- Neue Verbindungsart einfügen (nach `AiCliConnectionNode`):

```ts
/** Kubernetes cluster reached through SSH connections; see docs/superpowers/specs/2026-10-16-kubernetes-integration-design.md. */
export interface KubernetesConnectionNode extends ConnectionBase {
  protocol: 'kubernetes';
  /** Ordered SSH connection ids; the first reachable one carries the tunnel. */
  accessHosts: string[];
  kubeconfig: { source: 'auto' } | { source: 'path'; path: string };
  /** Context in the kubeconfig; default is current-context. */
  context?: string;
  /** Namespace the tab opens with; default is "default". */
  namespace?: string;
  production: boolean;
  readOnly: boolean;
}
```

- `export type ConnectionNode = RemoteConnectionNode | LocalConnectionNode | KubernetesConnectionNode;`
- `WorkspacePane` bekommt `kubeTabs?: WorkspaceKubeTab[];` mit
  `/** A cluster tab; `index` is its position in `connectionIds` (the cluster connection). */ export interface WorkspaceKubeTab { index: number; view: KubeViewSnapshot }` (Import `KubeViewSnapshot` aus `../kubernetes`).

- [ ] **Step 6: Vault-Schema (`src/shared/vault/schema.ts`)**

```ts
export const KubernetesConnectionNodeSchema = z.object({
    ...connectionBase,
    protocol: z.literal('kubernetes'),
    accessHosts: z.array(z.string().min(1).max(256)).min(1).max(8),
    kubeconfig: z.discriminatedUnion('source', [
        z.object({ source: z.literal('auto') }),
        z.object({ source: z.literal('path'), path: z.string().min(1).max(1024).refine(path => !/[\r\n\0]/.test(path)) }),
    ]),
    context: z.string().min(1).max(253).optional(),
    namespace: KubeNameSchema.optional(),
    production: z.boolean(),
    readOnly: z.boolean(),
});
```

In `ConnectionNodeSchema` aufnehmen. `WorkspacePaneSchema` bekommt
`kubeTabs: z.array(z.object({ index: z.number().int().min(0).max(63), view: KubeViewSnapshotSchema }).strict()).max(64).optional(),`.

Test in `src/shared/vault/schema.test.ts` ergänzen:

```ts
it('accepts a kubernetes connection and keeps old vaults valid', () => {
  const cluster = { id: 'k1', type: 'connection', name: 'k8s', tags: [], protocol: 'kubernetes', accessHosts: ['cp1'],
    kubeconfig: { source: 'auto' }, production: true, readOnly: false };
  expect(ConnectionNodeSchema.safeParse(cluster).success).toBe(true);
  expect(ConnectionNodeSchema.safeParse({ ...cluster, accessHosts: [] }).success).toBe(false);
  expect(ConnectionNodeSchema.safeParse({ ...cluster, namespace: 'Shop' }).success).toBe(false);
});
```

(Den bestehenden Testaufbau der Datei übernehmen; `ConnectionNodeSchema` ist dort bereits importierbar.)

- [ ] **Step 7: Verbindungs-Helfer (`src/shared/vault/connections.ts`)**

- `PROTOCOLS.kubernetes = { label: 'Kubernetes-Cluster', short: 'K8s', defaultIcon: 'network' }`.
- `NEW_CONNECTION_KINDS`: `{ protocol: 'kubernetes', label: PROTOCOLS.kubernetes.label }` nach `sftp`, vor `ftp`.
- `connectionAddress`: vor dem `isRemoteConnection`-Zweig
  `if (node.protocol === 'kubernetes') return \`Cluster · ${node.accessHosts.length === 1 ? '1 Zugang' : \`${node.accessHosts.length} Zugänge\`}\`;`
- `redactSecrets` bleibt unverändert (der Cluster-Eintrag enthält keine Secrets).

- [ ] **Step 8: Tab- und Terminal-Typen**

- `src/shared/windows.ts`: `TabConnection` bekommt `/** Logs or shell of a pod in the cluster `id`. */ kube?: KubeTerminalTarget;`
- `src/shared/ssh.ts`: `SshPrepareRequest` bekommt `kube?: KubeTerminalTarget`.
- `src/main/ssh/validation.ts`: `PrepareSchema` bekommt `kube: KubeTerminalTargetSchema.optional()`.

- [ ] **Step 9: IPC-Kanäle und DesktopApi (`src/shared/ipc.ts`, `src/preload/index.ts`)**

Kanäle: `kubeOpen: 'k8s:open'`, `kubeSubscribe: 'k8s:subscribe'`, `kubeDetail: 'k8s:detail'`, `kubeAction: 'k8s:action'`, `kubeClose: 'k8s:close'`, `kubeProbe: 'k8s:probe'`, `kubeEvent: 'k8s:event'`.

DesktopApi:

```ts
  /** Opens a view on a cluster; the session starts or is shared with other views. */
  kubeOpen: (request: KubeOpenRequest) => Promise<{ viewId: string }>;
  kubeSubscribe: (request: KubeSubscribeRequest) => Promise<void>;
  kubeDetail: (request: KubeDetailRequest) => Promise<KubeDetail>;
  kubeAction: (request: KubeActionRequest) => Promise<void>;
  kubeClose: (request: KubeViewRequest) => Promise<void>;
  /** Reads contexts of the kubeconfig on an SSH host; never returns the config itself. */
  kubeProbe: (request: KubeProbeRequest) => Promise<KubeProbeResult>;
  onKubeEvent: (listener: (event: KubeEvent) => void) => () => void;
```

Preload: `kubeOpen: request => ipcRenderer.invoke('k8s:open', request)` usw., `onKubeEvent: listener => subscribe('k8s:event', listener)`.

- [ ] **Step 10: Typecheck reparieren**

Run: `npm run typecheck`
Expected: Fehler an Stellen, die `ConnectionProtocol` erschöpfend behandeln. Jede Stelle minimal anpassen, damit der Cluster **nichts Falsches** tut:
- `src/main/ssh/session.ts` `prepare`: `if (connection?.protocol === 'kubernetes' && !request.kube) throw new Error('Cluster öffnen sich im Cluster-Tab.');` (der echte kube-Zweig kommt in Task 14).
- Renderer-Records über `ConnectionProtocol` (z. B. Labels/Icons): Eintrag für `kubernetes` mit Label „Kubernetes-Cluster“.
- `connection-form.ts`/`ConnectionForm.tsx`: vorerst kein Formular — wo ein Protokoll-Switch fehlt, `kubernetes` wie einen Typ ohne Felder behandeln (das richtige Formular kommt in Task 12).
- `connection-test`: Kubernetes liefert „Für Cluster gibt es noch keinen Verbindungstest.“ (Fehler-Ergebnis im vorhandenen Format).

Run: `npm run typecheck` → keine Fehler. `npm test` → alle bisherigen 341 Tests plus die neuen grün.

- [ ] **Step 11: Commit (Orchestrator)**

```bash
git add -A && git commit -m "feat(kubernetes): add the shared contract and the cluster connection kind" -m "What: Adds kubernetes types, schemas, IPC channels and the vault connection kind.
Why: Every later task builds on one fixed contract.

- Add src/shared/kubernetes.ts and kubernetes-schema.ts
- Add KubernetesConnectionNode with schema and workspace kubeTabs
- Add k8s IPC channels and DesktopApi methods
- Pin @kubernetes/client-node 2.0.0"
```

---

### Task 2: SSH-Weiterleitung und lokaler Tunnel

**Files:**
- Modify: `src/main/containers/runner.ts` (`RemoteHost.forward`)
- Modify: `src/main/containers/runner.test.ts`
- Create: `src/main/kubernetes/tunnel.ts`, `src/main/kubernetes/tunnel.test.ts`

**Interfaces:**
- Produces: `RemoteHost.forward(host: string, port: number): Promise<Duplex>`; `openTunnel(forward: (host: string, port: number) => Promise<Duplex>, target: { host: string; port: number }): Promise<Tunnel>`; `interface Tunnel { readonly port: number; close(): void }`.

- [ ] **Step 1: Failing test in `runner.test.ts`**

Den vorhandenen Fake-Client (`createClient`) um `forwardOut(srcIP, srcPort, dstIP, dstPort, cb)` erweitern und testen:

```ts
it('forwards a channel to the target through the SSH connection', async () => {
  const calls: unknown[][] = [];
  const channel = new PassThrough();
  const host = await openFakeHost({ forwardOut: (...args: unknown[]) => { calls.push(args.slice(0, 4)); (args[4] as (e: Error | undefined, s: unknown) => void)(undefined, channel); } });
  await expect(host.forward('10.0.0.5', 6443)).resolves.toBe(channel);
  expect(calls).toEqual([['127.0.0.1', 0, '10.0.0.5', 6443]]);
});
it('rejects forward with a readable error when the server refuses', async () => {
  const host = await openFakeHost({ forwardOut: (...args: unknown[]) => (args[4] as (e: Error) => void)(new Error('Connection refused')) });
  await expect(host.forward('10.0.0.5', 6443)).rejects.toThrow('Der API-Server ist vom Zugangs-Host aus nicht erreichbar (10.0.0.5:6443).');
});
```

(`openFakeHost` = Hilfsfunktion im Test, die `openRemoteHost` mit dem Fake-Client öffnet; an die bestehenden Helfer der Datei anlehnen.)

- [ ] **Step 2: Implementieren**

In `RemoteHost` ergänzen:

```ts
  /** A TCP channel to host:port as seen from the SSH server. */
  forward(host: string, port: number): Promise<Duplex>;
```

Implementierung im zurückgegebenen Objekt:

```ts
    forward(host, port) {
      return new Promise((resolve, reject) => {
        client.forwardOut('127.0.0.1', 0, host, port, (error, channel) => {
          if (error) reject(new HostAccessError(`Der API-Server ist vom Zugangs-Host aus nicht erreichbar (${host}:${port}).`));
          else resolve(channel);
        });
      });
    },
```

`HostAccessError` existiert bereits. `import type { Duplex } from 'node:stream';`.

- [ ] **Step 3: Failing test `tunnel.test.ts`**

```ts
import { connect } from 'node:net';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { openTunnel } from './tunnel';

describe('openTunnel', () => {
  it('listens on loopback only and pipes each connection to a forwarded channel', async () => {
    const targets: string[] = [];
    const remote = new PassThrough();
    const tunnel = await openTunnel(async (host, port) => { targets.push(`${host}:${port}`); return remote; }, { host: '10.0.0.5', port: 6443 });
    expect(tunnel.port).toBeGreaterThan(0);
    const socket = connect(tunnel.port, '127.0.0.1');
    socket.write('ping');
    const received = await new Promise<string>(resolve => remote.once('data', chunk => resolve(String(chunk))));
    expect(received).toBe('ping');
    expect(targets).toEqual(['10.0.0.5:6443']);
    socket.destroy(); tunnel.close();
  });
  it('closes the local socket when forwarding fails', async () => {
    const tunnel = await openTunnel(async () => { throw new Error('nope'); }, { host: 'h', port: 1 });
    const socket = connect(tunnel.port, '127.0.0.1');
    await new Promise(resolve => socket.once('close', resolve));
    tunnel.close();
  });
  it('stops accepting after close', async () => {
    const tunnel = await openTunnel(async () => new PassThrough(), { host: 'h', port: 1 });
    tunnel.close();
    const socket = connect(tunnel.port, '127.0.0.1');
    await expect(new Promise((_, reject) => socket.once('error', reject))).rejects.toThrow();
  });
});
```

- [ ] **Step 4: `tunnel.ts` implementieren**

```ts
import { createServer } from 'node:net';
import type { Socket } from 'node:net';
import type { Duplex } from 'node:stream';

export interface Tunnel { readonly port: number; close(): void }

/** Local listener on 127.0.0.1 that carries every connection through the SSH host to target. */
export function openTunnel(forward: (host: string, port: number) => Promise<Duplex>, target: { host: string; port: number }): Promise<Tunnel> {
  const sockets = new Set<Socket>();
  const server = createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => socket.destroy());
    socket.pause();
    forward(target.host, target.port).then(channel => {
      if (socket.destroyed) { channel.destroy(); return; }
      channel.on('error', () => socket.destroy());
      socket.on('close', () => channel.destroy());
      channel.on('close', () => socket.destroy());
      socket.pipe(channel).pipe(socket);
      socket.resume();
    }, () => socket.destroy());
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') { server.close(); reject(new Error('Der lokale Tunnel konnte nicht starten.')); return; }
      resolve({ port: address.port, close() { server.close(); for (const socket of sockets) socket.destroy(); } });
    });
  });
}
```

Run: `npx vitest run src/main/kubernetes/tunnel.test.ts src/main/containers/runner.test.ts` → PASS.

---

### Task 3: kubeconfig lesen, prüfen und für den Tunnel umschreiben

**Files:**
- Create: `src/main/kubernetes/kubeconfig.ts`, `src/main/kubernetes/kubeconfig.test.ts`

**Interfaces:**
- Produces:
```ts
export class KubeInputError extends Error {}   // message is safe to show
export interface ParsedKubeconfig {
  contextName: string;
  clusterName: string;
  /** Namespace of the context, if set. */
  namespace?: string;
  /** API server as written in the kubeconfig. */
  server: { host: string; port: number };
  /** Builds the in-memory config that talks to https://127.0.0.1:<localPort> with tlsServerName = original host. */
  build(localPort: number, tlsServerName?: string): KubeConfig;
}
export function parseKubeconfig(text: string, context?: string): ParsedKubeconfig;
export function listContexts(text: string): { contexts: string[]; currentContext?: string; clusterName?: string };
```

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { KubeInputError, listContexts, parseKubeconfig } from './kubeconfig';

const config = (server: string, user = 'client-certificate-data: Y2VydA==\n    client-key-data: a2V5') => `
apiVersion: v1
kind: Config
clusters:
- name: k8s
  cluster:
    server: ${server}
    certificate-authority-data: Y2E=
contexts:
- name: admin@k8s
  context: { cluster: k8s, user: admin, namespace: shop }
- name: other
  context: { cluster: k8s, user: admin }
current-context: admin@k8s
users:
- name: admin
  user:
    ${user}
`;

describe('parseKubeconfig', () => {
  it('reads the current context and the server', () => {
    const parsed = parseKubeconfig(config('https://k8s-vip:6443'));
    expect(parsed).toMatchObject({ contextName: 'admin@k8s', clusterName: 'k8s', namespace: 'shop', server: { host: 'k8s-vip', port: 6443 } });
  });
  it('defaults the port to 443 and keeps IP servers', () => {
    expect(parseKubeconfig(config('https://10.0.0.5')).server).toEqual({ host: '10.0.0.5', port: 443 });
  });
  it('builds a config pointing at the tunnel with the original host as TLS name', () => {
    const built = parseKubeconfig(config('https://10.0.0.5:6443')).build(51234);
    const cluster = built.getCurrentCluster()!;
    expect(cluster.server).toBe('https://127.0.0.1:51234');
    expect(cluster.tlsServerName).toBe('10.0.0.5');
    expect(cluster.caData).toBe('Y2E=');
    expect(built.getCurrentUser()?.certData).toBe('Y2VydA==');
  });
  it('honours an explicit TLS name override', () => {
    expect(parseKubeconfig(config('https://10.0.0.5:6443')).build(1, 'kubernetes').getCurrentCluster()!.tlsServerName).toBe('kubernetes');
  });
  it('selects another context', () => {
    expect(parseKubeconfig(config('https://h:6443'), 'other').contextName).toBe('other');
  });
  it('rejects unknown contexts, login plugins, plain http and broken yaml', () => {
    expect(() => parseKubeconfig(config('https://h:6443'), 'missing')).toThrow('Context „missing“ gibt es in der kubeconfig nicht (vorhanden: admin@k8s, other).');
    expect(() => parseKubeconfig(config('https://h:6443', 'exec:\n      command: kubelogin'))).toThrow('Diese kubeconfig nutzt ein Login-Plugin. Das wird noch nicht unterstützt.');
    expect(() => parseKubeconfig(config('http://h:8080'))).toThrow(KubeInputError);
    expect(() => parseKubeconfig(': : :')).toThrow('Die kubeconfig konnte nicht gelesen werden.');
  });
  it('never puts secrets into error messages', () => {
    try { parseKubeconfig(config('https://h:6443', 'token: SECRET-TOKEN'), 'missing'); } catch (error) { expect(String(error)).not.toContain('SECRET'); }
  });
});

describe('listContexts', () => {
  it('lists context names without credentials', () => {
    expect(listContexts(config('https://h:6443'))).toEqual({ contexts: ['admin@k8s', 'other'], currentContext: 'admin@k8s', clusterName: 'k8s' });
  });
});
```

- [ ] **Step 2: Implementieren**

```ts
import { KubeConfig } from '@kubernetes/client-node';

export class KubeInputError extends Error {}

function load(text: string): KubeConfig {
  const config = new KubeConfig();
  try { config.loadFromString(text); } catch { throw new KubeInputError('Die kubeconfig konnte nicht gelesen werden.'); }
  if (!config.getContexts().length) throw new KubeInputError('Die kubeconfig enthält keinen Context.');
  return config;
}

export function listContexts(text: string): { contexts: string[]; currentContext?: string; clusterName?: string } {
  const config = load(text);
  const current = config.getCurrentContext() || undefined;
  const context = config.getContexts().find(item => item.name === current);
  return { contexts: config.getContexts().map(item => item.name), ...(current ? { currentContext: current } : {}), ...(context ? { clusterName: context.cluster } : {}) };
}

export function parseKubeconfig(text: string, contextName?: string) {
  const config = load(text);
  const name = contextName ?? config.getCurrentContext();
  const context = config.getContexts().find(item => item.name === name);
  if (!context) throw new KubeInputError(`Context „${name}“ gibt es in der kubeconfig nicht (vorhanden: ${config.getContexts().map(item => item.name).join(', ')}).`);
  const cluster = config.getCluster(context.cluster);
  const user = config.getUser(context.user);
  if (!cluster || !user) throw new KubeInputError('Der Context verweist auf einen fehlenden Cluster oder Benutzer.');
  if (user.exec || user.authProvider) throw new KubeInputError('Diese kubeconfig nutzt ein Login-Plugin. Das wird noch nicht unterstützt.');
  let url: URL;
  try { url = new URL(cluster.server); } catch { throw new KubeInputError('Die Server-Adresse in der kubeconfig ist ungültig.'); }
  if (url.protocol !== 'https:') throw new KubeInputError('Der API-Server muss per HTTPS erreichbar sein.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const server = { host, port: url.port ? Number(url.port) : 443 };
  return {
    contextName: context.name, clusterName: context.cluster, ...(context.namespace ? { namespace: context.namespace } : {}), server,
    build(localPort: number, tlsServerName?: string): KubeConfig {
      const built = new KubeConfig();
      built.loadFromOptions({
        clusters: [{ ...cluster, server: `https://127.0.0.1:${localPort}`, tlsServerName: tlsServerName ?? cluster.tlsServerName ?? host }],
        users: [user], contexts: [context], currentContext: context.name,
      });
      return built;
    },
  };
}
export type ParsedKubeconfig = ReturnType<typeof parseKubeconfig>;
```

Hinweis: `caFile`, `certFile`, `keyFile` in der kubeconfig zeigen auf Pfade **auf cp1** und funktionieren lokal nicht. Wenn `cluster.caFile`, `user.certFile` oder `user.keyFile` gesetzt ist und das jeweilige `*Data` fehlt, `KubeInputError('Die kubeconfig verweist auf Zertifikatsdateien. Nutze eine kubeconfig mit eingebetteten Zertifikaten (z. B. /etc/kubernetes/admin.conf).')` werfen und dafür einen Test ergänzen.

Run: `npx vitest run src/main/kubernetes/kubeconfig.test.ts` → PASS.

---

### Task 4: Zugang über SSH-Hosts (Failover, kubeconfig-Quelle, sudo)

**Files:**
- Create: `src/main/containers/sudo-run.ts`, `src/main/containers/sudo-run.test.ts`
- Modify: `src/main/containers/discovery.ts` (private `runSudo` durch `runWithSudo` ersetzen, Verhalten unverändert)
- Create: `src/main/kubernetes/access.ts`, `src/main/kubernetes/access.test.ts`

**Interfaces:**
- Consumes: `RemoteHost` (Task 2), `sudoSetting`, `remoteCommand`, `shellJoin` aus `containers/commands.ts`, `SudoRejections`, `connectionFingerprint`, `createSudoMarker`, `publicError`, `KubernetesConnectionNode`.
- Produces:
```ts
// sudo-run.ts
export function runWithSudo(host: RemoteHost, connection: SshConnectionNode, argv: string[], timeoutMs: number, rejections: SudoRejections): Promise<RunResult>;
// access.ts
export interface AccessDependencies {
  getConnection: (id: string) => ConnectionNode | undefined;
  openRemote: (connection: SshConnectionNode) => Promise<RemoteHost>;
  sudoRejections: SudoRejections;
}
export interface ClusterAccess { host: RemoteHost; connection: SshConnectionNode; kubeconfig: string; source: string }
export function openAccess(cluster: KubernetesConnectionNode, dependencies: AccessDependencies): Promise<ClusterAccess>;
export function readKubeconfig(host: RemoteHost, connection: SshConnectionNode, source: KubernetesConnectionNode['kubeconfig'], rejections: SudoRejections): Promise<{ text: string; source: string }>;
export const AUTO_SCRIPT: string;
```

- [ ] **Step 1: `runWithSudo` herauslösen**

Den Rumpf von `ContainerDiscovery.runSudo` (discovery.ts:103-121) wörtlich nach `sudo-run.ts` als `runWithSudo(host, connection, argv, timeoutMs, rejections)` verschieben; `this.sudoRejections` → `rejections`. `ContainerDiscovery` ruft `runWithSudo(host, connection, argv, timeoutMs, this.sudoRejections)` auf. In `sudo-run.test.ts` die drei Fälle testen: ohne sudo direkter `run`, gemerkte Abweisung liefert `sudoRejected` ohne `run`, besetztes Gate liefert `sudoBusy`.

Run: `npx vitest run src/main/containers` → alle bisherigen Tests weiter grün.

- [ ] **Step 2: Failing tests `access.test.ts`**

Fake-Host-Helfer im Test:

```ts
function fakeHost(responses: Record<string, RunResult>, calls: string[] = []): RemoteHost {
  return { closed: false, close: vi.fn(), forward: vi.fn(),
    run: vi.fn(async (command: string) => { calls.push(command); const hit = Object.entries(responses).find(([key]) => command.includes(key));
      return hit ? hit[1] : { code: 1, stdout: '', stderr: 'unexpected' }; }) };
}
const ssh = (id: string, extra: Partial<SshConnectionNode> = {}): SshConnectionNode => ({ id, type: 'connection', name: `k8s-${id}`, tags: [], protocol: 'ssh',
  host: `k8s-${id}`, port: 22, username: 'admin', authentication: { method: 'agent' }, ...extra });
const cluster = (accessHosts: string[], kubeconfig: KubernetesConnectionNode['kubeconfig'] = { source: 'auto' }): KubernetesConnectionNode =>
  ({ id: 'k', type: 'connection', name: 'k8s', tags: [], protocol: 'kubernetes', accessHosts, kubeconfig, production: true, readOnly: false });
```

Tests:
1. `auto`: Host antwortet auf `AUTO_SCRIPT` mit `stdout: 'src:/home/admin/.kube/config\n<yaml>'` → `{ source: '/home/admin/.kube/config', kubeconfig: '<yaml>' }`.
2. `auto` mit `src:sudo` und `containers.sudo` nicht gesetzt → Fehler `/etc/kubernetes/admin.conf braucht sudo. Aktiviere „Container-Befehle mit sudo ausführen“ an der SSH-Verbindung oder gib einen Pfad an.`
3. `auto` mit `src:sudo` und `containers: { sudo: true }`, Agent-Auth → zweiter Befehl enthält `sudo -n cat -- /etc/kubernetes/admin.conf`, Ergebnis-Quelle `/etc/kubernetes/admin.conf (sudo)`.
4. `auto` mit `src:none` → `Keine kubeconfig auf k8s-cp1 gefunden (geprüft: $KUBECONFIG, ~/.kube/config, /etc/kubernetes/admin.conf).`
5. `path` `~/k/config` → Befehl `sh -c 'cat -- "$HOME"/'\''k/config'\'''` bzw. allgemein: Befehl enthält `cat --` und `"$HOME"`; `path` `/etc/x` → `cat -- /etc/x`.
6. Failover: `cp1` wirft beim Öffnen `Error('Timed out')`, `cp2` funktioniert → Ergebnis-Connection `cp2`, `cp1`-Host nie benutzt.
7. Alle scheitern → `Keiner der Zugangs-Hosts erreichbar (k8s-cp1: Zeitüberschreitung beim Verbindungsaufbau., k8s-cp2: …).` (Meldung pro Host über `publicError`).
8. Gelöschte/deaktivierte/Nicht-SSH-IDs werden übersprungen; nur solche → `Der Cluster hat keine gültige SSH-Verbindung als Zugang.`
9. Nach Fehler beim Lesen der kubeconfig wird der geöffnete Host geschlossen (`close` aufgerufen) und der nächste Host versucht.

- [ ] **Step 3: Implementieren**

```ts
/** Prints `src:<path>` then the file, or `src:sudo` when only admin.conf exists, or `src:none`. */
export const AUTO_SCRIPT = [
  'f="${KUBECONFIG%%:*}"',
  'if [ -n "$f" ] && [ -r "$f" ]; then printf "src:%s\\n" "$f"; cat -- "$f";',
  'elif [ -r "$HOME/.kube/config" ]; then printf "src:%s\\n" "$HOME/.kube/config"; cat -- "$HOME/.kube/config";',
  'elif [ -e /etc/kubernetes/admin.conf ]; then echo src:sudo;',
  'else echo src:none; fi',
].join(' ');
const ADMIN_CONF = '/etc/kubernetes/admin.conf';
const READ_TIMEOUT = 15_000;
```

- `auto`: `host.run(shellJoin(['sh', '-lc', AUTO_SCRIPT]), READ_TIMEOUT)`; erste Zeile bis `\n` ist die Quelle, Rest der Text. Bei `src:sudo`: `sudoSetting(connection).kind === 'none'` → Fehler (siehe Test 2), sonst `runWithSudo(host, connection, ['cat', '--', ADMIN_CONF], READ_TIMEOUT, rejections)`; `sudoRejected`/`sudoBusy`/Exit≠0 → `describeFailure`-artige Meldung: für `sudoRejected` die Konstante `SUDO_REJECTED` aus `containers/parsers.ts`, sonst letzte stderr-Zeile (max. 200 Zeichen).
- `path`: `~/` am Anfang → `sh -c 'cat -- "$HOME"/<rest gequotet>'` über `shellJoin(['sh', '-c', \`cat -- "$HOME"/${shellJoin([rest])}\`])`; sonst `shellJoin(['cat', '--', path])`.
- Exit ≠ 0 bei `path` → `Die kubeconfig „<path>“ auf <name> konnte nicht gelesen werden.`
- `openAccess`: Hosts der Reihe nach; ungültige überspringen; pro Host `openRemote` → `readKubeconfig`; bei Fehler: Host schließen, Meldung sammeln (`KubeInputError`/`HostAccessError` wörtlich, sonst `publicError(error)`), weiter. Fehler aus `readKubeconfig`, die die Konfiguration betreffen (`KubeInputError`), brechen **sofort** ab statt auf den nächsten Host zu gehen — auf cp2 liegt dieselbe falsche Einstellung. Nur Verbindungsfehler führen zum Failover.

Run: `npx vitest run src/main/kubernetes/access.test.ts src/main/containers` → PASS.

---

### Task 5: API-Objekte in Tabellenzeilen und Node-Kacheln umwandeln

**Files:**
- Create: `src/main/kubernetes/rows.ts`, `src/main/kubernetes/rows.test.ts`
- Create: `src/main/kubernetes/api.ts` (nur Typen — siehe unten; Task 8 implementiert sie)

**Interfaces:**
- Produces in `api.ts` (exakt so, Task 8/13/14/15 verwenden es):

```ts
import type { KubeKind, KubeRef, KubeSelector, KubeTerminalTarget } from '../../shared/kubernetes';

export interface KubeMeta {
  name?: string; namespace?: string; uid?: string; resourceVersion?: string; creationTimestamp?: string | Date;
  labels?: Record<string, string>; annotations?: Record<string, string>; ownerReferences?: { kind: string; name: string }[]; managedFields?: unknown;
}
export interface KubeObject { apiVersion?: string; kind?: string; metadata?: KubeMeta; [key: string]: unknown }
export interface ListResult { items: KubeObject[]; resourceVersion: string }
export type WatchType = 'ADDED' | 'MODIFIED' | 'DELETED' | 'BOOKMARK';
export interface WatchHandle { stop(): void }
/** code: HTTP status when there is one (401, 403, 404, 410 …). Message is safe to show. */
export class KubeApiError extends Error { constructor(message: string, readonly code?: number) { super(message); } }
export interface MetricsSample { namespace?: string; name: string; cpuMilli: number; memoryBytes: number }
export interface TerminalIo { data(chunk: Buffer): void; end(code: number | null, message?: string): void }
export interface KubeStream { write(data: string): void; resize(cols: number, rows: number): void; pause(): void; resume(): void; close(): void }
export interface KubeApi {
  list(kind: KubeKind, namespace: string | null, selector?: KubeSelector): Promise<ListResult>;
  watch(kind: KubeKind, namespace: string | null, selector: KubeSelector | undefined, resourceVersion: string,
    onEvent: (type: WatchType, object: KubeObject) => void, onEnd: (error?: KubeApiError) => void): Promise<WatchHandle>;
  read(ref: KubeRef): Promise<KubeObject>;
  eventsFor(ref: KubeRef): Promise<KubeObject[]>;
  mergePatch(ref: KubeRef, body: object): Promise<void>;
  remove(ref: KubeRef): Promise<void>;
  /** null: metrics.k8s.io is not served. */
  nodeMetrics(): Promise<MetricsSample[] | null>;
  podMetrics(namespace: string | null): Promise<MetricsSample[] | null>;
  openTerminal(target: KubeTerminalTarget, size: { cols: number; rows: number }, io: TerminalIo): Promise<KubeStream>;
}
```

- Produces in `rows.ts`:
```ts
export function toRow(kind: KubeKind, object: KubeObject): KubeRow | null;   // null when name/uid missing
export function toNodeTile(node: KubeObject, usage?: { cpuMilli: number; memoryBytes: number }): NodeTile;
export function parseCpu(value: string | undefined): number;     // → millicores
export function parseMemory(value: string | undefined): number;  // → bytes
export function podStatus(pod: KubeObject): { ready: string; status: string; restarts: number; tone: RowTone };
```

- [ ] **Step 1: Failing tests** (Fixtures als Objekt-Literale im Test)

```ts
const pod = (status: object, spec: object = { containers: [{ name: 'api' }], nodeName: 'worker2' }) =>
  ({ metadata: { name: 'api-1', namespace: 'shop', uid: 'u1', creationTimestamp: '2026-10-16T08:00:00Z', labels: { app: 'api' } }, spec, status });

it('maps a running pod', () => {
  const row = toRow('pods', pod({ phase: 'Running', containerStatuses: [{ name: 'api', ready: true, restartCount: 0, state: { running: {} } }] }));
  expect(row).toMatchObject({ uid: 'u1', ref: { kind: 'pods', namespace: 'shop', name: 'api-1' }, tone: 'ok', node: 'worker2', containers: ['api'],
    cells: { name: 'api-1', ready: '1/1', status: 'Running', restarts: 0, node: 'worker2', age: '2026-10-16T08:00:00Z' } });
});
it('shows the waiting reason of a crashing container', () => {
  const row = toRow('pods', pod({ phase: 'Running', containerStatuses: [{ name: 'api', ready: false, restartCount: 14, state: { waiting: { reason: 'CrashLoopBackOff' } } }] }));
  expect(row).toMatchObject({ tone: 'bad', cells: { ready: '0/1', status: 'CrashLoopBackOff', restarts: 14 } });
});
it('handles a freshly scheduled pod without statuses', () => {
  expect(toRow('pods', pod({ phase: 'Pending' }, { containers: [{ name: 'a' }, { name: 'b' }] }))).toMatchObject({ tone: 'warn', cells: { ready: '0/2', status: 'Pending', restarts: 0 } });
});
it('shows Terminating for pods with deletionTimestamp and Completed for succeeded pods', () => { /* deletionTimestamp → status 'Terminating', tone 'muted'; phase Succeeded → 'Completed', tone 'muted' */ });
it('maps a deployment with selector and replicas', () => {
  const row = toRow('deployments', { metadata: { name: 'api', namespace: 'shop', uid: 'd1', creationTimestamp: '2026-10-01T00:00:00Z' },
    spec: { replicas: 3, selector: { matchLabels: { app: 'api' } }, template: { spec: { containers: [{ image: 'harbor/shop/api:2.4.1' }] } } },
    status: { readyReplicas: 2, updatedReplicas: 3 } });
  expect(row).toMatchObject({ tone: 'warn', replicas: 3, selector: { app: 'api' }, cells: { ready: '2/3', upToDate: 3, image: 'harbor/shop/api:2.4.1' } });
});
it('maps nodes with roles and readiness', () => {
  const node = { metadata: { name: 'k8s-cp1', uid: 'n1', labels: { 'node-role.kubernetes.io/control-plane': '' } },
    status: { conditions: [{ type: 'Ready', status: 'True' }, { type: 'DiskPressure', status: 'True' }], allocatable: { cpu: '4', memory: '8Gi' }, nodeInfo: { kubeletVersion: 'v1.31.2' } } };
  expect(toRow('nodes', node)).toMatchObject({ ref: { kind: 'nodes', name: 'k8s-cp1' }, tone: 'warn', cells: { status: 'Ready', roles: 'control-plane', version: 'v1.31.2' } });
  expect(toNodeTile(node, { cpuMilli: 1000, memoryBytes: 4 * 1024 ** 3 })).toEqual({ name: 'k8s-cp1', ready: true, roles: ['control-plane'],
    pressure: ['DiskPressure'], unschedulable: false, cpu: 0.25, memory: 0.5 });
});
it('maps events with the involved object', () => {
  expect(toRow('events', { metadata: { name: 'e1', namespace: 'shop', uid: 'e1' }, type: 'Warning', reason: 'BackOff', count: 7,
    involvedObject: { kind: 'Pod', name: 'api-1' }, message: 'Back-off restarting', lastTimestamp: '2026-10-16T09:00:00Z' }))
    .toMatchObject({ tone: 'warn', cells: { type: 'Warning', reason: 'BackOff', object: 'Pod/api-1', count: 7, last: '2026-10-16T09:00:00Z' } });
});
it('parses quantities', () => {
  expect(parseCpu('250m')).toBe(250); expect(parseCpu('2')).toBe(2000); expect(parseCpu('1500n')).toBeCloseTo(0.0015); expect(parseCpu(undefined)).toBe(0);
  expect(parseMemory('128Mi')).toBe(128 * 1024 ** 2); expect(parseMemory('1G')).toBe(1e9); expect(parseMemory('1024')).toBe(1024); expect(parseMemory(undefined)).toBe(0);
});
it('returns null for objects without name or uid', () => { expect(toRow('pods', { metadata: {} })).toBeNull(); });
```

Außerdem je ein Test für `statefulsets`, `daemonsets` (`desiredNumberScheduled`/`numberReady`/`updatedNumberScheduled`), `jobs` (`completions` `"1/1"`, `lastRun` = `status.completionTime ?? status.startTime`), `cronjobs` (`schedule`, `lastRun` = `status.lastScheduleTime`), `services` (`ports` `"80/TCP,443/TCP"`, selector), `ingresses` (`hosts` kommagetrennt, `address` aus `status.loadBalancer.ingress[].ip|hostname`).

- [ ] **Step 2: Implementieren**

Regeln (verbindlich):
- `cells.name` = `metadata.name`; `cells.age` = `creationTimestamp` als ISO-String (Date → `toISOString()`); fehlt er, kein `age`-Eintrag.
- **Pods:** `ready` = Anzahl `containerStatuses[].ready === true` / Anzahl `spec.containers`; `restarts` = Summe `restartCount`; `status`: `deletionTimestamp` → `Terminating`; erster Container mit `state.waiting.reason` → dieser Grund; sonst mit `state.terminated.reason` (wenn Phase nicht Succeeded) → dieser Grund; `Succeeded` → `Completed`; sonst `status.phase ?? 'Unknown'`. Tone: `bad` für `CrashLoopBackOff|ImagePullBackOff|ErrImagePull|InvalidImageName|OOMKilled|Error|CreateContainerConfigError|Failed`; `warn` für `Pending|ContainerCreating|PodInitializing` oder Running mit nicht allen ready; `muted` für `Completed|Terminating`; sonst `ok`.
- **Deployments/StatefulSets:** `ready` = `${status.readyReplicas ?? 0}/${spec.replicas ?? 1}`, `upToDate` = `status.updatedReplicas ?? 0`, `image` = Images der Template-Container kommagetrennt, `selector` = `spec.selector.matchLabels`, `replicas` = `spec.replicas ?? 1`. Tone `ok` wenn ready == desired, `warn` sonst, `muted` wenn desired 0.
- **Nodes:** `status` = `Ready` | `NotReady` (+ `,SchedulingDisabled` wenn `spec.unschedulable`), `roles` = Label-Suffixe von `node-role.kubernetes.io/<role>` kommagetrennt oder `—`, Tone `bad` bei NotReady, `warn` bei Druck-Conditions oder unschedulable, sonst `ok`. `pods`-Zelle wird **nicht** hier gesetzt (Task 13 zählt).
- **Events:** `last` = `lastTimestamp ?? eventTime ?? metadata.creationTimestamp`; `count` = `count ?? series.count ?? 1`; Tone `warn` bei `Warning`, sonst `muted`.
- `toNodeTile`: Anteile = Nutzung / allocatable (gerundet auf 2 Stellen), ohne `usage` keine `cpu`/`memory`-Felder.
- `parseCpu`: Suffixe `n` (÷1e6), `u` (÷1e3), `m` (×1), ohne Suffix ×1000. `parseMemory`: Binär `Ki Mi Gi Ti Pi` (Potenzen von 1024), Dezimal `k M G T P` (Potenzen von 1000), ohne Suffix Bytes. Leer/undefined/ungültig → 0.

Run: `npx vitest run src/main/kubernetes/rows.test.ts` → PASS.

---

### Task 6: Problem-Erkennung

**Files:**
- Create: `src/main/kubernetes/problems.ts`, `src/main/kubernetes/problems.test.ts`

**Interfaces:**
- Consumes: `KubeObject` (Task 5 `api.ts`), `KubeProblem`.
- Produces: `export function detectProblems(pods: KubeObject[], nodes: KubeObject[], now: number): KubeProblem[];`

- [ ] **Step 1: Failing tests**

Regeln aus der Spec, je ein Test plus Grenzfälle:

```ts
const NOW = Date.parse('2026-10-16T10:00:00Z');
it('flags CrashLoopBackOff', () => { /* waiting.reason CrashLoopBackOff → { kind: 'crashloop', ref: pods/shop/api-1, message: 'api-1 crasht (CrashLoopBackOff, 14 Neustarts)' } */ });
it('flags OOMKilled within 60 minutes only', () => {
  // lastState.terminated { reason: 'OOMKilled', finishedAt: 59 min vor NOW } → Problem 'oomkilled', message 'api-1 wurde wegen Speichermangel beendet (OOMKilled)'
  // finishedAt 61 min vor NOW → kein Problem
});
it('flags image pull failures', () => { /* ImagePullBackOff | ErrImagePull | InvalidImageName → 'image', message 'api-1: Image kann nicht geladen werden (ImagePullBackOff)' */ });
it('flags pods pending longer than five minutes', () => {
  // phase Pending, creationTimestamp genau 5 min vor NOW → kein Problem; 5 min + 1 s → 'pending', message 'api-1 wartet seit 5 min (Pending)'
});
it('flags nodes that are not ready or under pressure', () => {
  // Ready False → 'node' 'k8s-worker2 ist nicht bereit'; Ready True + MemoryPressure True → 'node' 'k8s-worker2: MemoryPressure'
});
it('reports one problem per pod, crashloop before oomkilled, and sorts nodes first', () => { /* ... */ });
it('ignores terminating pods', () => { /* deletionTimestamp gesetzt → nichts */ });
```

`id` = `${kind}:${refKey(ref)}`. Schreibe die Tests vollständig aus (Fixtures wie in Task 5).

- [ ] **Step 2: Implementieren**

Reine Funktion; prüfe pro Pod die Regeln in der Reihenfolge crashloop → image → oomkilled → pending und nimm die erste passende (ein Problem pro Pod). Nodes zuerst in der Ergebnisliste, dann Pods nach Namespace/Name sortiert. Pending-Dauer in Minuten abgerundet.

Run: `npx vitest run src/main/kubernetes/problems.test.ts` → PASS.

---

### Task 7: YAML-Ansicht und Describe-Zusammenfassung

**Files:**
- Create: `src/main/kubernetes/describe.ts`, `src/main/kubernetes/describe.test.ts`

**Interfaces:**
- Consumes: `KubeObject`, `dumpYaml` aus `@kubernetes/client-node`.
- Produces:
```ts
export function toYaml(object: KubeObject): string;              // managedFields removed, Secret data masked
export function describe(object: KubeObject, events: KubeObject[]): string;
```

- [ ] **Step 1: Failing tests**

```ts
it('removes managedFields and masks secret data', () => {
  const yaml = toYaml({ apiVersion: 'v1', kind: 'Secret', metadata: { name: 's', managedFields: [{ manager: 'x' }] }, data: { password: 'c2VjcmV0' }, stringData: { token: 'plain' } });
  expect(yaml).not.toContain('managedFields');
  expect(yaml).not.toContain('c2VjcmV0');
  expect(yaml).not.toContain('plain');
  expect(yaml).toContain('password: •••');
});
it('masks the last-applied annotation of secrets', () => {
  const yaml = toYaml({ kind: 'Secret', metadata: { name: 's', annotations: { 'kubectl.kubernetes.io/last-applied-configuration': '{"data":{"a":"b"}}' } } });
  expect(yaml).not.toContain('"a":"b"');
});
it('describes a pod with containers, limits and events', () => {
  const text = describe(podFixture, [eventFixture]);
  expect(text).toContain('Name:        api-1');
  expect(text).toContain('Namespace:   shop');
  expect(text).toContain('Node:        worker2');
  expect(text).toContain('Container api');
  expect(text).toContain('Image:     harbor/shop/api:2.4.1');
  expect(text).toContain('Limits:    memory=2Gi');
  expect(text).toContain('Letzter Abbruch: OOMKilled (Exit 137)');
  expect(text).toContain('Warning  BackOff  Back-off restarting');
});
it('shows secretKeyRef env vars as references only', () => {
  // env [{ name: 'DB_PASS', valueFrom: { secretKeyRef: { name: 'db', key: 'pass' } } }, { name: 'MODE', value: 'prod' }]
  // → 'DB_PASS: <Secret db/pass>' und 'MODE: prod'
});
```

(`podFixture`/`eventFixture` im Test ausschreiben.)

- [ ] **Step 2: Implementieren**

- `toYaml`: tiefe Kopie (`structuredClone`), `metadata.managedFields` löschen; bei `kind === 'Secret'`: jeden Wert in `data` und `stringData` durch `'•••'` ersetzen und die Annotation `kubectl.kubernetes.io/last-applied-configuration` durch `'•••'`. Dann `dumpYaml(copy, { lineWidth: 160 })`.
- `describe`: Abschnitte (Labels in Spalte 13 ausgerichtet wie im Test): `Name`, `Namespace`, `Art` (`kind`), `Erstellt`, `Labels`, `Owner` (`ownerReferences` `Kind/name`), `Status` (Pods: Phase; Workloads: ready/desired; Nodes: Conditions). Pods zusätzlich: `Node`, `IP` (`status.podIP`), pro Container ein Block `Container <name>` mit `Image`, `Ports`, `Requests`, `Limits`, `Bereit`, `Neustarts`, `Letzter Abbruch: <reason> (Exit <code>)`, `Umgebung` (Werte oder `<Secret name/key>` / `<ConfigMap name/key>`), danach `Conditions` und `Events` (die letzten 10, neueste zuletzt, Format `<type>  <reason>  <message>`). Workloads: `Selector`, `Replicas`, `Strategie`, Container-Images. Keine Werte aus Secrets.

Run: `npx vitest run src/main/kubernetes/describe.test.ts` → PASS.

---

### Task 8: `KubeApi` über `@kubernetes/client-node`

**Files:**
- Create: `src/main/kubernetes/client-api.ts`, `src/main/kubernetes/client-api.test.ts`

**Interfaces:**
- Consumes: `KubeApi`, `KubeApiError`, Typen aus `api.ts` (Task 5), `KIND_INFO`.
- Produces:
```ts
export function resourcePath(kind: KubeKind, namespace: string | null): string;
export function selectorQuery(selector?: KubeSelector): { labelSelector?: string; fieldSelector?: string };
export function toApiError(error: unknown): KubeApiError;
export function createKubeApi(config: KubeConfig): KubeApi;
```

- [ ] **Step 1: Failing tests (nur reine Teile)**

```ts
it('builds resource paths', () => {
  expect(resourcePath('pods', 'shop')).toBe('/api/v1/namespaces/shop/pods');
  expect(resourcePath('pods', null)).toBe('/api/v1/pods');
  expect(resourcePath('deployments', 'shop')).toBe('/apis/apps/v1/namespaces/shop/deployments');
  expect(resourcePath('ingresses', null)).toBe('/apis/networking.k8s.io/v1/ingresses');
  expect(resourcePath('nodes', 'ignored')).toBe('/api/v1/nodes');
});
it('builds selector strings', () => {
  expect(selectorQuery({ labels: { app: 'api', tier: 'web' } })).toEqual({ labelSelector: 'app=api,tier=web' });
  expect(selectorQuery({ node: 'worker1' })).toEqual({ fieldSelector: 'spec.nodeName=worker1' });
  expect(selectorQuery()).toEqual({});
});
it('translates HTTP errors into German messages', () => {
  expect(toApiError({ code: 403, body: { message: 'pods "x" is forbidden: User "u" cannot delete resource "pods" in API group "" in the namespace "shop"' } }).message)
    .toBe('Keine Berechtigung: pods/delete in shop');
  expect(toApiError({ code: 401 }).message).toBe('Nicht angemeldet. Die Zugangsdaten der kubeconfig wurden abgelehnt.');
  expect(toApiError({ code: 404 }).message).toBe('Die Ressource gibt es nicht (mehr).');
  expect(toApiError({ statusCode: 410 }).code).toBe(410);
  expect(toApiError(Object.assign(new Error('x'), { code: 'ERR_TLS_CERT_ALTNAME_INVALID', reason: "Host: 10.0.0.5. is not in the cert's altnames: DNS:kubernetes" })).message)
    .toBe("TLS: Das Zertifikat des API-Servers passt nicht zum Namen (Host: 10.0.0.5. is not in the cert's altnames: DNS:kubernetes).");
  expect(toApiError(new Error('socket hang up')).message).toBe('Die Verbindung zum API-Server ist abgebrochen.');
});
```

- [ ] **Step 2: Implementieren**

- `resourcePath`: `v1` → `/api/v1`, sonst `/apis/<apiVersion>`; namespaced und `namespace` gesetzt → `/namespaces/<ns>`; dann Plural (= `KubeKind`).
- `list`: `KubernetesObjectApi.makeApiClient(config).list(info.apiVersion, info.kind, namespace ?? undefined, undefined, undefined, undefined, fieldSelector, labelSelector)` → `{ items, resourceVersion: list.metadata?.resourceVersion ?? '' }`.
- `watch`: `new Watch(config).watch(resourcePath(kind, namespace), { resourceVersion, allowWatchBookmarks: true, ...selectorQuery(selector) }, (type, object) => onEvent(type as WatchType, object), error => onEnd(error ? toApiError(error) : undefined))` → `{ stop: () => controller.abort() }`. Die `done`-Callback wird bei `abort` nicht als Fehler gemeldet (prüfe `error?.name === 'AbortError'` → `onEnd()` nicht aufrufen).
- `read`/`mergePatch`/`remove`: `KubernetesObjectApi` mit Header-Objekt `{ apiVersion, kind, metadata: { name, namespace } }`; `patch(spec, undefined, undefined, 'terminus', undefined, PatchStrategy.MergePatch)`.
- `eventsFor(ref)`: `list('v1', 'Event', ref.namespace, …, fieldSelector: \`involvedObject.name=${ref.name}${ref.namespace ? \`,involvedObject.namespace=${ref.namespace}\` : ''}\`)`.
- Metrics: `new Metrics(config).getNodeMetrics()` / `getPodMetrics(namespace ?? undefined)`; 404 oder 503 → `null`; Pod-Nutzung = Summe der Container; `cpuMilli` über `parseCpu`, `memoryBytes` über `parseMemory` aus `rows.ts`.
- `openTerminal`:
  - `logs`/`previous`: `new Log(config).log(ns, pod, container, writable, { follow: mode === 'logs', previous: mode === 'previous', tailLines: 500, timestamps: false })`; `writable` = `new Writable({ write(chunk, _e, cb) { io.data(Buffer.from(chunk)); cb(); } })`. Ende → `io.end(0)`; Fehler → `io.end(null, toApiError(e).message)`. `write`/`resize` sind No-ops; `close` → `controller.abort()`; `pause`/`resume` → `writable.cork()`/`uncork()` ist nicht ausreichend — stattdessen `pause`/`resume` als No-ops lassen (Log-Flow ist durch das Terminal-Limit gedeckelt).
  - `shell`: Command `['sh', '-c', 'command -v bash >/dev/null 2>&1 && exec bash || exec sh']` (gleich `SHELL_CHOICE` aus `containers/commands.ts`, von dort importieren). `stdin` = `new PassThrough()`; `stdout` = Writable wie oben **mit** Properties `rows`/`columns` (initial aus `size`), damit client-node die Größe sendet; `resize(cols, rows)` setzt die Properties und `stdout.emit('resize')`. `exec(ns, pod, container, command, stdout, stdout, stdin, true, status => { … })`. Status `Success` → `io.end(0)`; Status mit `details.causes[].reason === 'ExitCode'` → `io.end(Number(message))`; Meldung mit `executable file not found` → `io.end(127, 'Im Container gibt es weder bash noch sh.')`. WebSocket `close` ohne Status → `io.end(null)`. `write(data)` → `stdin.write(data)`; `close` → `websocket.close()`; `pause`/`resume` → `websocket.pause?.()`/`resume?.()` falls vorhanden.
- `toApiError`: Code aus `code` (Zahl) oder `statusCode`. 403: aus der Server-Meldung `cannot (\w+) resource "([^"]+)".*namespace "([^"]+)"` → `Keine Berechtigung: <resource>/<verb> in <ns>`, sonst `Keine Berechtigung.`. 401, 404 wie im Test. 410 → `KubeApiError('Watch veraltet.', 410)`. TLS-Codes `ERR_TLS_CERT_ALTNAME_INVALID`, `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, `SELF_SIGNED_CERT_IN_CHAIN`, `DEPTH_ZERO_SELF_SIGNED_CERT` → `TLS: …` mit `reason`/`message`. `ECONNRESET`/`socket hang up` → wie im Test. Sonst `Die Kubernetes-API hat einen Fehler gemeldet.` — **niemals** den rohen Body oder Header übernehmen.

Run: `npx vitest run src/main/kubernetes/client-api.test.ts` → PASS. `npx tsc --noEmit -p tsconfig.node.json` → keine Fehler in `client-api.ts`.

---

### Task 9: Aktionen

**Files:**
- Create: `src/main/kubernetes/actions.ts`, `src/main/kubernetes/actions.test.ts`

**Interfaces:**
- Consumes: `KubeApi`, `ACTION_KINDS`, `READ_ONLY_MESSAGE`, `MAX_REPLICAS`.
- Produces: `export function runAction(api: KubeApi, request: { ref: KubeRef; action: KubeAction; replicas?: number }, options: { readOnly: boolean; now?: () => Date }): Promise<void>;`

- [ ] **Step 1: Failing tests**

```ts
const fakeApi = () => ({ mergePatch: vi.fn(async () => {}), remove: vi.fn(async () => {}) }) as unknown as KubeApi & { mergePatch: Mock; remove: Mock };
const deploy = { kind: 'deployments', namespace: 'shop', name: 'api' } as const;

it('restarts by patching the template annotation', async () => {
  const api = fakeApi();
  await runAction(api, { ref: deploy, action: 'restart' }, { readOnly: false, now: () => new Date('2026-10-16T10:00:00Z') });
  expect(api.mergePatch).toHaveBeenCalledWith(deploy, { spec: { template: { metadata: { annotations: { 'kubectl.kubernetes.io/restartedAt': '2026-10-16T10:00:00.000Z' } } } } });
});
it('scales by patching spec.replicas', async () => {
  const api = fakeApi();
  await runAction(api, { ref: deploy, action: 'scale', replicas: 0 }, { readOnly: false });
  expect(api.mergePatch).toHaveBeenCalledWith(deploy, { spec: { replicas: 0 } });
});
it('deletes pods', async () => {
  const api = fakeApi();
  await runAction(api, { ref: { kind: 'pods', namespace: 'shop', name: 'api-1' }, action: 'delete' }, { readOnly: false });
  expect(api.remove).toHaveBeenCalledWith({ kind: 'pods', namespace: 'shop', name: 'api-1' });
});
it('refuses everything on read-only clusters without calling the API', async () => {
  const api = fakeApi();
  await expect(runAction(api, { ref: deploy, action: 'restart' }, { readOnly: true })).rejects.toThrow('Dieser Cluster ist schreibgeschützt.');
  expect(api.mergePatch).not.toHaveBeenCalled();
});
it('refuses actions that do not fit the kind, scale without replicas and refs without namespace', async () => {
  const api = fakeApi();
  await expect(runAction(api, { ref: { kind: 'pods', namespace: 'shop', name: 'a' }, action: 'restart' }, { readOnly: false })).rejects.toThrow('Diese Aktion ist hier nicht möglich.');
  await expect(runAction(api, { ref: deploy, action: 'scale' }, { readOnly: false })).rejects.toThrow('Bitte gib die Anzahl der Replicas an.');
  await expect(runAction(api, { ref: { kind: 'pods', name: 'a' }, action: 'delete' }, { readOnly: false })).rejects.toThrow('Diese Aktion ist hier nicht möglich.');
});
```

- [ ] **Step 2: Implementieren** — Reihenfolge der Prüfungen: readOnly → Kind passt (`ACTION_KINDS`) und `ref.namespace` gesetzt → replicas (Ganzzahl 0…`MAX_REPLICAS`) bei scale → API-Aufruf. Fehler der API (`KubeApiError`) unverändert weiterreichen.

Run: `npx vitest run src/main/kubernetes/actions.test.ts` → PASS.

---

### Task 10: Renderer-Zustand `kube-view.ts`

**Files:**
- Create: `src/renderer/src/kube-view.ts`, `src/renderer/src/kube-view.test.ts`

**Interfaces:**
- Consumes: `KubeEvent`, `KubeRow`, `KubeQuery`, `ClusterStatus`, `NodeTile`, `KubeProblem`, `UsageHistory`, `DockMode`, `KubeViewSnapshot`, `KIND_COLUMNS`, `refKey`, `queryKey`.
- Produces:
```ts
export interface Crumb { label: string; query: KubeQuery }
export interface KubeViewState {
  status: ClusterStatus | null;
  query: KubeQuery;
  /** Breadcrumb of drill-downs; empty at the top level. */
  crumbs: Crumb[];
  rows: KubeRow[];               // rows of `query`, in arrival order
  loading: boolean;              // true until the first `rows` event for `query`
  filter: string;
  sort: { key: string; descending: boolean } | null;
  selected: string | null;       // refKey
  /** Pods drilled into: container list instead of the pod table. */
  containersOf: KubeRow | null;
  container: string | null;
  dock: DockMode;
  dockOpen: boolean;
  nodes: NodeTile[];
  problems: KubeProblem[];
  namespaces: string[];
  usage: UsageHistory;
}
export type KubeViewAction =
  | { type: 'event'; event: KubeEvent }
  | { type: 'setKind'; kind: KubeKind }
  | { type: 'setNamespace'; namespace: string | null }
  | { type: 'filter'; text: string }
  | { type: 'sort'; key: string }
  | { type: 'select'; key: string | null }
  | { type: 'move'; delta: number }              // within visibleRows
  | { type: 'drill' }                             // Enter on the selected row
  | { type: 'back' }
  | { type: 'jump'; ref: KubeRef }                // from a problem or node tile
  | { type: 'dock'; mode: DockMode }
  | { type: 'toggleDock' }
  | { type: 'selectContainer'; name: string }
  | { type: 'restore'; snapshot: KubeViewSnapshot };
export function initialKubeView(namespace: string | null): KubeViewState;   // query { kind: 'pods', namespace }
export function kubeViewReducer(state: KubeViewState, action: KubeViewAction): KubeViewState;
export function visibleRows(state: KubeViewState): KubeRow[];               // filter + sort applied
export function matchesFilter(row: KubeRow, filter: string): boolean;       // name contains, or `key=value` label match
export function snapshotOf(state: KubeViewState): KubeViewSnapshot;
export function formatAge(iso: string, now: number): string;                // '41s', '12m', '3h', '9d'
export function formatUsage(kind: 'cpu' | 'memory', value: number): string; // '250m', '1.2Gi'
export function sparkline(values: number[]): string;                        // ▁▂▃▄▅▆▇█, empty → ''
```

- [ ] **Step 1: Failing tests** — mindestens:

1. `rows`-Event mit passender `queryKey` und `reset: true` ersetzt die Zeilen und setzt `loading: false`; mit `reset: false` werden `upserts` nach `uid` ersetzt/angehängt und `deletes` entfernt; Events für eine andere Query werden ignoriert.
2. Wird die selektierte Zeile gelöscht, springt `selected` auf die Zeile an derselben Position der sichtbaren Liste (oder die letzte, oder `null`).
3. `setKind` setzt `query.kind`, leert Zeilen, `loading: true`, `crumbs: []`, `selected: null`, `filter: ''`; `setNamespace(null)` → Query `namespace: null`.
4. `drill` auf Deployment-Zeile mit `selector {app:'api'}` → `query { kind: 'pods', namespace: 'shop', selector: { labels: { app: 'api' } } }`, Crumb `Deployment api`; auf Node-Zeile → Pods mit `selector.node`, `namespace: null`; auf Service mit Selector → Pods; auf Pod → `containersOf` = Pod-Zeile, `container` = erster Container; `back` geht jeweils eine Ebene zurück (bei `containersOf` zuerst diese schließen) und stellt die vorige Query wieder her.
5. `drill` auf Workloads ohne Selector oder Events → keine Änderung.
6. `matchesFilter`: `'api'` trifft Name `api-1`; `'app=api'` trifft Label; Groß/Klein egal; leerer Filter trifft alles.
7. `sort` auf `restarts` zweimal → absteigend; numerische Spalten numerisch, `age`-Spalten nach Zeit.
8. `move` begrenzt an den Rändern; ohne Auswahl wählt `+1` die erste Zeile.
9. `jump` auf Pod-Ref → Kind `pods`, Namespace der Ref, `selected` = refKey (auch wenn die Zeile noch nicht da ist).
10. `restore` übernimmt Query/Dock; `snapshotOf` liefert `crumbs` als Labels.
11. `formatAge`, `formatUsage`, `sparkline` mit Beispielwerten.
12. `status`-, `overview`- und `usage`-Events werden gespeichert, aber nur, wenn `viewId` egal ist (der Hook filtert nach viewId; der Reducer prüft das nicht).

Schreibe die Tests vollständig aus.

- [ ] **Step 2: Implementieren** (reine Funktionen, keine React-Importe)

Run: `npx vitest run src/renderer/src/kube-view.test.ts` → PASS.

---

### Task 11: Befehls- und Hotkey-Registry `kube-commands.ts`

**Files:**
- Create: `src/renderer/src/kube-commands.ts`, `src/renderer/src/kube-commands.test.ts`

**Interfaces:**
- Consumes: `KubeViewState`, `visibleRows` (Task 10), `ACTION_KINDS`, `KIND_INFO`, `KUBE_KINDS`.
- Produces:
```ts
export type CommandGroup = 'Navigation' | 'Ansicht' | 'Aktionen';
export type CommandId = 'down' | 'up' | 'drill' | 'back' | 'filter' | 'command' | 'tab' | 'logs' | 'shell' | 'events' | 'yaml'
  | 'describe' | 'previous' | 'restart' | 'scale' | 'delete' | 'toggleDock' | 'popout' | 'help' | 'kind' | 'namespace';
export interface CommandContext { state: KubeViewState; readOnly: boolean }
export interface KubeCommand {
  id: CommandId;
  group: CommandGroup;
  description: string;
  /** Display form, e.g. ['↓', 'j']. */
  keys: string[];
  /** Matches KeyboardEvent.key plus modifiers, e.g. 'j', 'ArrowDown', 'Ctrl+d', 'Ctrl+Shift+T', 'S'. */
  bindings: string[];
  /** `:` command with syntax for the help, e.g. { name: 'ns', syntax: ':ns <name|all>', example: ':ns shop' }. */
  command?: { name: string; syntax: string; example: string };
  /** Undefined: available. A string: why not (shown greyed in the help). */
  unavailable?: (context: CommandContext) => string | undefined;
}
export const KUBE_COMMANDS: KubeCommand[];
export function bindingOf(event: { key: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }): string;
export function commandForKey(binding: string): KubeCommand | undefined;
export type ParsedCommand =
  | { id: 'kind'; kind: KubeKind } | { id: 'namespace'; namespace: string | null } | { id: 'scale'; replicas: number }
  | { id: 'restart' } | { id: 'delete' } | { id: 'help' } | { error: string };
export function parseCommandLine(line: string): ParsedCommand;              // ':ns shop', 'pods', ':scale 3'
export function completions(prefix: string, namespaces: string[]): string[]; // ':n' → [':ns ', ':nodes'], ':ns s' → [':ns shop']
```

- [ ] **Step 1: Failing tests**

```ts
it('gives every command a description and a group', () => {
  for (const command of KUBE_COMMANDS) { expect(command.description.length).toBeGreaterThan(3); expect(['Navigation', 'Ansicht', 'Aktionen']).toContain(command.group); }
});
it('never binds a key twice', () => {
  const bindings = KUBE_COMMANDS.flatMap(command => command.bindings);
  expect(new Set(bindings).size).toBe(bindings.length);
});
it('maps the spec hotkeys', () => {
  expect(commandForKey('j')?.id).toBe('down'); expect(commandForKey('ArrowUp')?.id).toBe('up');
  expect(commandForKey('Enter')?.id).toBe('drill'); expect(commandForKey('Escape')?.id).toBe('back'); expect(commandForKey('Backspace')?.id).toBe('back');
  expect(commandForKey('l')?.id).toBe('logs'); expect(commandForKey('s')?.id).toBe('shell'); expect(commandForKey('e')?.id).toBe('events');
  expect(commandForKey('y')?.id).toBe('yaml'); expect(commandForKey('d')?.id).toBe('describe'); expect(commandForKey('p')?.id).toBe('previous');
  expect(commandForKey('r')?.id).toBe('restart'); expect(commandForKey('S')?.id).toBe('scale'); expect(commandForKey('Ctrl+d')?.id).toBe('delete');
  expect(commandForKey('Ctrl+j')?.id).toBe('toggleDock'); expect(commandForKey('Ctrl+Shift+T')?.id).toBe('popout');
  expect(commandForKey('?')?.id).toBe('help'); expect(commandForKey('/')?.id).toBe('filter'); expect(commandForKey(':')?.id).toBe('command');
  expect(commandForKey('1')?.id).toBe('tab'); expect(commandForKey('0')?.id).toBe('tab');
});
it('builds bindings from keyboard events', () => {
  expect(bindingOf({ key: 'd', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false })).toBe('Ctrl+d');
  expect(bindingOf({ key: 'T', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false })).toBe('Ctrl+Shift+T');
  expect(bindingOf({ key: 'S', ctrlKey: false, shiftKey: true, altKey: false, metaKey: false })).toBe('S');
});
it('explains why actions are unavailable', () => {
  const state = { ...initialKubeView('shop') };
  const restart = KUBE_COMMANDS.find(command => command.id === 'restart')!;
  expect(restart.unavailable?.({ state, readOnly: true })).toBe('Dieser Cluster ist schreibgeschützt.');
  expect(restart.unavailable?.({ state, readOnly: false })).toBe('Nur für Deployments, StatefulSets und DaemonSets.');
  expect(KUBE_COMMANDS.find(command => command.id === 'shell')!.unavailable?.({ state, readOnly: true })).toBe('Dieser Cluster ist schreibgeschützt.');
});
it('parses command lines', () => {
  expect(parseCommandLine(':pods')).toEqual({ id: 'kind', kind: 'pods' });
  expect(parseCommandLine('deploy')).toEqual({ id: 'kind', kind: 'deployments' });
  expect(parseCommandLine(':ns all')).toEqual({ id: 'namespace', namespace: null });
  expect(parseCommandLine(':ns shop')).toEqual({ id: 'namespace', namespace: 'shop' });
  expect(parseCommandLine(':scale 3')).toEqual({ id: 'scale', replicas: 3 });
  expect(parseCommandLine(':scale -1')).toEqual({ error: 'Replicas: ganze Zahl von 0 bis 1000.' });
  expect(parseCommandLine(':ns Shop')).toEqual({ error: 'Ungültiger Namespace „Shop“.' });
  expect(parseCommandLine(':foo')).toEqual({ error: 'Unbekannter Befehl „foo“. Mit ? siehst du alle Befehle.' });
});
it('completes commands and namespaces', () => {
  expect(completions(':n', [])).toEqual([':nodes', ':ns ']);
  expect(completions(':ns s', ['shop', 'monitoring', 'system'])).toEqual([':ns shop', ':ns system']);
});
```

- [ ] **Step 2: Implementieren.** Verfügbarkeit: `restart`/`scale`/`delete`/`shell` bei `readOnly` → `READ_ONLY_MESSAGE`; `restart`/`scale`/`delete` sonst nur, wenn `state.query.kind` in `ACTION_KINDS[action]` und eine Zeile gewählt ist (`'Wähle zuerst eine Zeile.'`); Texte für falsche Kinds: restart `Nur für Deployments, StatefulSets und DaemonSets.`, scale `Nur für Deployments und StatefulSets.`, delete `Nur für Pods.`; `logs`/`shell`/`previous` nur bei Pods oder geöffneter Container-Liste (`'Nur für Pods.'`). `:`-Befehle: Kind-Befehle aus `KIND_INFO[kind].command`, plus `ns`, `restart`, `scale`, `delete`, `help`.

Run: `npx vitest run src/renderer/src/kube-commands.test.ts` → PASS.

---

### Task 12: Cluster-Formular und Einrichtung aus einer SSH-Verbindung

**Files:**
- Create: `src/renderer/src/cluster-form.ts`, `src/renderer/src/cluster-form.test.ts`
- Create: `src/renderer/src/components/ClusterForm.tsx`
- Modify: `src/renderer/src/components/ConnectionForm.tsx` (für `protocol === 'kubernetes'` `ClusterForm` rendern)
- Modify: `src/renderer/src/connection-form.ts` (Defaults für neue Kubernetes-Verbindung)

**Interfaces:**
- Consumes: `KubernetesConnectionNode`, `SshConnectionNode`, `VaultNode`, `KubeProbeResult`, `window.desktopApi.kubeProbe`.
- Produces:
```ts
export function suggestAccessHosts(nodes: VaultNode[], sshId: string): string[];   // first entry is sshId
export function newClusterFromSsh(ssh: SshConnectionNode, nodes: VaultNode[], probe: KubeProbeResult, id: string): KubernetesConnectionNode;
export function emptyCluster(id: string): KubernetesConnectionNode;                // production: true, readOnly: false, kubeconfig auto
export function validateCluster(node: KubernetesConnectionNode, nodes: VaultNode[]): string | null;  // German message or null
```

- [ ] **Step 1: Failing tests**

```ts
it('suggests sibling control planes by host pattern', () => {
  const nodes = [ssh('a', 'k8s-cp1'), ssh('b', 'k8s-cp2'), ssh('c', 'k8s-cp3'), ssh('d', 'k8s-worker1'), ssh('e', 'other-cp2')];
  expect(suggestAccessHosts(nodes, 'a')).toEqual(['a', 'b', 'c']);
});
it('works with FQDNs and skips disabled connections', () => {
  const nodes = [ssh('a', 'k8s-cp1.example.local'), { ...ssh('b', 'k8s-cp2.example.local'), disabled: true }, ssh('c', 'k8s-cp3.example.local')];
  expect(suggestAccessHosts(nodes, 'a')).toEqual(['a', 'c']);
});
it('creates a production cluster from the probe', () => {
  const cluster = newClusterFromSsh(ssh('a', 'k8s-cp1'), [ssh('a', 'k8s-cp1')], { source: '/etc/kubernetes/admin.conf (sudo)', contexts: ['kubernetes-admin@kubernetes'], currentContext: 'kubernetes-admin@kubernetes', clusterName: 'kubernetes' }, 'k1');
  expect(cluster).toMatchObject({ id: 'k1', protocol: 'kubernetes', name: 'kubernetes', accessHosts: ['a'], kubeconfig: { source: 'auto' }, production: true, readOnly: false });
  expect(cluster.context).toBeUndefined();   // current context is the default
});
it('validates access hosts and paths', () => {
  expect(validateCluster({ ...emptyCluster('k'), accessHosts: [] }, [])).toBe('Wähle mindestens eine SSH-Verbindung als Zugang.');
  expect(validateCluster({ ...emptyCluster('k'), accessHosts: ['x'] }, [])).toBe('Die Zugangs-Verbindung „x“ gibt es nicht mehr.');
  expect(validateCluster({ ...emptyCluster('k'), name: '', accessHosts: ['a'] }, [ssh('a', 'h')])).toBe('Bitte gib einen Namen an.');
  expect(validateCluster({ ...emptyCluster('k'), name: 'x', accessHosts: ['a'], kubeconfig: { source: 'path', path: 'rel/path' } }, [ssh('a', 'h')]))
    .toBe('Der Pfad muss mit / oder ~/ beginnen.');
});
```

(`ssh(id, host)` als Test-Helfer, der eine `SshConnectionNode` baut.)

`suggestAccessHosts`: Host der Quell-Verbindung auf `/^(.*?)(\d+)(\D.*)?$/` zerlegen (Präfix, Zahl, Rest); Kandidaten = aktive SSH-Verbindungen, deren Host dasselbe Präfix und denselben Rest hat; sortiert nach Zahl; Quelle zuerst. Ohne Zahl im Host → nur `[sshId]`.

- [ ] **Step 2: Implementieren (`cluster-form.ts`)**, Tests grün.

- [ ] **Step 3: `ClusterForm.tsx`**

Felder (im Stil von `ConnectionForm.tsx`, gleiche CSS-Klassen):
- Name, Kommentar, Tags/Farbe/Icon wie bei anderen Verbindungen (bestehende Teilkomponenten wiederverwenden).
- **Zugangs-Hosts:** geordnete Liste der gewählten SSH-Verbindungen mit ↑/↓/Entfernen, darunter ein Auswahlfeld „SSH-Verbindung hinzufügen“ (nur aktive SSH-Verbindungen, die noch nicht drin sind).
- **Kubeconfig:** Radio „Automatisch (KUBECONFIG, ~/.kube/config, /etc/kubernetes/admin.conf)“ / „Pfad auf dem Host“ + Textfeld.
- **Context:** Textfeld mit Platzhalter „current-context“; Knopf „Contexts lesen“ ruft `kubeProbe({ connectionId: accessHosts[0] })` und bietet die Namen als `<datalist>` an; Fehlermeldung inline.
- **Namespace:** Textfeld, Platzhalter `default`.
- Checkboxen **„Produktion“** (Hinweis: „Aktionen verlangen das Eintippen des Namens.“) und **„Nur lesen“** (Hinweis: „Keine Aktionen und keine Shell, Logs bleiben erlaubt.“).
- Speichern ruft `validateCluster`; Meldung im vorhandenen Fehler-Stil.

- [ ] **Step 4: Einbinden** — `ConnectionForm.tsx`: bei `protocol === 'kubernetes'` `ClusterForm` statt der Host/Port-Felder. `connection-form.ts`: neue Verbindung mit `protocol: 'kubernetes'` → `emptyCluster(id)`.

Run: `npx vitest run src/renderer/src/cluster-form.test.ts src/renderer/src/connection-form.test.ts` → PASS. `npx tsc --noEmit -p tsconfig.web.json` → keine Fehler in den geänderten Dateien.

---

### Task 13: Watcher und Übersicht (Overview + Metrics)

**Files:**
- Create: `src/main/kubernetes/watch.ts`, `src/main/kubernetes/watch.test.ts`
- Create: `src/main/kubernetes/overview.ts`, `src/main/kubernetes/overview.test.ts`

**Interfaces:**
- Consumes: `KubeApi`, `KubeApiError` (Task 5), `toRow`, `toNodeTile` (Task 5), `detectProblems` (Task 6).
- Produces:
```ts
// watch.ts
export interface WatcherOptions { batchMs?: number; schedule?: (fn: () => void, ms: number) => unknown; cancel?: (handle: unknown) => void }
export class ResourceWatcher {
  constructor(api: KubeApi, query: KubeQuery, emit: (batch: { reset: boolean; upserts: KubeRow[]; deletes: string[] }) => void,
    onTrouble: (message: string | undefined) => void, options?: WatcherOptions);
  start(): Promise<void>;        // list → emit reset → watch
  stop(): void;
  /** Current rows (for late subscribers). */
  rows(): KubeRow[];
}
// overview.ts
export class Overview {
  constructor(api: KubeApi, emit: (overview: { nodes: NodeTile[]; problems: KubeProblem[]; namespaces: string[] }) => void,
    emitUsage: (pods: UsageHistory) => void, onMetrics: (available: boolean) => void, options?: { now?: () => number; metricsMs?: number; batchMs?: number; schedule?; cancel? });
  start(): Promise<void>;
  stop(): void;
  /** Pod refKeys of the visible namespace for usage; null = all. */
  setUsageNamespace(namespace: string | null): void;
  current(): { nodes: NodeTile[]; problems: KubeProblem[]; namespaces: string[] };
  /** Running pods per node name (for the Nodes table's `pods` cell). */
  podCounts(): Record<string, number>;
}
```

- [ ] **Step 1: Failing tests `watch.test.ts`** (Fake-`KubeApi` mit kontrollierbarem `watch`, Fake-Timer über `schedule`/`cancel`)

1. `start` listet, emittiert `{ reset: true, upserts: <alle Zeilen>, deletes: [] }`, startet `watch` mit der `resourceVersion` der Liste.
2. `ADDED`/`MODIFIED` innerhalb von 250 ms werden zu **einem** Batch gebündelt; dieselbe uid zweimal → nur der letzte Stand; `DELETED` → uid in `deletes`; `BOOKMARK` → kein Batch, aber die nächste Watch-Wiederaufnahme nutzt dessen `resourceVersion`.
3. `onEnd(KubeApiError code 410)` → neu listen, Batch mit `reset: true`, neue Watch; `onTrouble` **nicht** aufgerufen.
4. `onEnd()` ohne Fehler (Server schließt nach Timeout) → Watch mit letzter `resourceVersion` neu starten, ohne Liste.
5. Netzfehler dreimal in Folge → `onTrouble('Live-Aktualisierung gestört: <message>')`; danach erfolgreicher Batch → `onTrouble(undefined)`. Wiederholungen mit 1 s, 2 s, 5 s Abstand.
6. `stop` stoppt die Watch-Handle, verwirft ausstehende Batches, startet nichts neu.
7. Objekte, für die `toRow` `null` liefert, werden ignoriert.

- [ ] **Step 2: `watch.ts` implementieren**, Tests grün.

- [ ] **Step 3: Failing tests `overview.test.ts`**

1. `start` startet drei `ResourceWatcher`-artige Ströme: Pods (alle Namespaces), Nodes, Namespaces — Namespaces über `api.list('…')` ist kein `KubeKind`; deshalb Namespaces **aus den Pods ableiten** (eindeutige `metadata.namespace`, sortiert) plus `default`. Test: zwei Pods in `shop`, einer in `monitoring` → `namespaces: ['default', 'monitoring', 'shop']`.
2. Emission (gebündelt, 250 ms) enthält `nodes` aus `toNodeTile` (mit Nutzung aus `nodeMetrics`), `problems` aus `detectProblems(pods, nodes, now())`.
3. Metrics: alle 15 s `nodeMetrics()` und `podMetrics(usageNamespace)`; `null` → `onMetrics(false)`, Kacheln ohne `cpu`/`memory`; Werte → `onMetrics(true)`, `emitUsage` mit Historie pro refKey, maximal 20 Einträge (21. verdrängt den ältesten).
4. `podCounts()` zählt Pods mit `spec.nodeName` und Phase ≠ Succeeded/Failed.
5. `stop` stoppt Watcher und Metrics-Timer.

- [ ] **Step 4: `overview.ts` implementieren** (intern zwei `ResourceWatcher` für `pods`/`nodes` mit `namespace: null`; die Rohobjekte für `detectProblems` werden mitgeführt — erweitere dafür `ResourceWatcher` um eine optionale `onObjects?: (objects: KubeObject[]) => void`-Option, die nach jedem Batch den vollständigen Objektbestand liefert, und teste das in `watch.test.ts`).

Run: `npx vitest run src/main/kubernetes/watch.test.ts src/main/kubernetes/overview.test.ts` → PASS.

---

### Task 14: Logs und Shell als Terminal-Quelle im `SshSessionManager`

**Files:**
- Modify: `src/main/ssh/session.ts`
- Modify: `src/main/ssh/session.test.ts`

**Interfaces:**
- Consumes: `KubeTerminalTarget`, `KubeStream`, `TerminalIo` (Task 5), `READ_ONLY_MESSAGE`.
- Produces: neue Abhängigkeit in `SshDependencies`:
```ts
  /** Opens logs or a shell of a pod through the cluster's live session; absent disables cluster terminals. */
  openKubeTerminal?: (clusterId: string, target: KubeTerminalTarget, size: TerminalSize, io: TerminalIo) => Promise<KubeStream>;
```

- [ ] **Step 1: Failing tests** (in `session.test.ts`, mit vorhandenen Helfern; Vault-Fixture um einen Cluster `k1` erweitern)

1. `prepare` mit `connectionId: 'k1'` ohne `kube` → Fehler `Cluster öffnen sich im Cluster-Tab.`.
2. `prepare` + `connect` mit `kube: { namespace:'shop', pod:'api-1', container:'api', mode:'logs' }` → `openKubeTerminal('k1', target, size, io)` aufgerufen, Status `connected`; `io.data(Buffer)` erzeugt `data`-Events mit Sequenzen; `io.end(0)` → Status `closed`; `io.end(137, 'x')` → Status `error` mit Meldung `x`; `io.end(1)` ohne Meldung → `closed`.
3. `input` schreibt über `stream.write`; `resize` ruft `stream.resize(cols, rows)`; Flow-Control: über `OUTPUT_HIGH` → `stream.pause()`, nach Ack unter `OUTPUT_LOW` → `stream.resume()`; `close` → `stream.close()`.
4. Shell auf einem Cluster mit `readOnly: true` → `prepare` wirft `Dieser Cluster ist schreibgeschützt.`; Logs bleiben erlaubt.
5. `kube` an einer Nicht-Kubernetes-Verbindung → `Pod-Terminals gibt es nur für Kubernetes-Cluster.`.
6. `transferOwner`/`attach` funktionieren wie bei SSH (Ausgabe wird gehalten und übergeben).

- [ ] **Step 2: Implementieren**

- `Session` bekommt `kube?: KubeTerminalTarget; kubeStream?: KubeStream`.
- `prepare`: Validierung wie in den Tests; kein ssh2-`Client` für Cluster.
- `connect`: wenn `session.kube`: `this.dependencies.openKubeTerminal(session.connectionId, session.kube, session.size, io)` mit `io = { data: chunk => this.output(session, chunk), end: (code, message) => { session.exitCode = code; this.finish(session, message ? 'error' : 'closed', message); } }`; danach `session.kubeStream = stream; session.phase = 'connected'; this.status(session, 'connected')`. Wenn `!this.active(session)` nach dem `await` → `stream.close()`.
- `output`/`acknowledge`/`transferOwner`/`attach`: neben `stream`/`pty` auch `kubeStream?.pause()`/`resume()`.
- `input`: `if (session.kubeStream) { session.kubeStream.write(data); return; }` (innerhalb des vorhandenen Byte-Limits).
- `resize`: `session.kubeStream?.resize(size.cols, size.rows)`.
- `finish`: `session.kubeStream?.close()`.

Run: `npx vitest run src/main/ssh/session.test.ts` → PASS (alle alten Tests weiter grün).

---

### Task 15: Cluster-Sessions, IPC und Verdrahtung im Main-Prozess

**Files:**
- Create: `src/main/kubernetes/session.ts`, `src/main/kubernetes/session.test.ts`
- Create: `src/main/kubernetes/ipc.ts`
- Modify: `src/main/ssh/ipc.ts` (`openKubeTerminal` an `SshSessionManager` übergeben)
- Modify: `src/main/index.ts` (registrieren, `closeAll` beim Beenden/Sperren wie `containerDiscovery`)

**Interfaces:**
- Consumes: `openAccess`, `readKubeconfig` (Task 4), `openTunnel` (Task 2), `parseKubeconfig`, `listContexts` (Task 3), `createKubeApi` (Task 8), `runAction` (Task 9), `ResourceWatcher`, `Overview` (Task 13), `toYaml`, `describe` (Task 7), `toRow`.
- Produces:
```ts
export interface KubeSessionDependencies {
  getCluster: (id: string) => KubernetesConnectionNode;      // throws 'Der Cluster wurde nicht gefunden.'
  openAccess: (cluster: KubernetesConnectionNode) => Promise<ClusterAccess>;
  openTunnel: (access: ClusterAccess, target: { host: string; port: number }) => Promise<Tunnel>;
  createApi: (config: KubeConfig) => KubeApi;
  emit: (ownerId: number, event: KubeEvent) => void;
  idleMs?: number; backoffMs?: number[]; schedule?: (fn: () => void, ms: number) => unknown; cancel?: (handle: unknown) => void;
}
export class KubeSessions {
  constructor(dependencies: KubeSessionDependencies);
  open(ownerId: number, clusterId: string): { viewId: string };
  subscribe(ownerId: number, viewId: string, query: KubeQuery): void;
  detail(ownerId: number, viewId: string, ref: KubeRef, mode: KubeDetailMode): Promise<KubeDetail>;
  action(ownerId: number, viewId: string, request: { ref: KubeRef; action: KubeAction; replicas?: number }): Promise<void>;
  close(ownerId: number, viewId: string): void;
  closeOwner(ownerId: number): void;
  closeAll(): void;
  openTerminal(clusterId: string, target: KubeTerminalTarget, size: TerminalSize, io: TerminalIo): Promise<KubeStream>;
}
export function registerKubernetesIpcHandlers(knownHosts: KnownHosts, sudoRejections: SudoRejections): KubeSessions;
```

- [ ] **Step 1: Failing tests `session.test.ts`** (alles über Fakes; `createApi` liefert Fake-`KubeApi`)

1. `open` zweimal für denselben Cluster (zwei Owner) → `openAccess` und `openTunnel` je **einmal**; beide Views bekommen `status`-Events (`connecting`, dann `ready` mit `host: 'k8s-cp1'`, `production`, `readOnly`, `name`).
2. `subscribe` startet einen `ResourceWatcher` je **eindeutiger** Query (zwei Views mit gleicher Query teilen ihn); Wechsel der Query stoppt den alten Watcher, wenn ihn keine View mehr braucht; ein später Subscriber bekommt sofort einen `reset`-Batch aus `rows()`.
3. Nodes-Query: `rows`-Events enthalten in `cells.pods` die Zahl aus `overview.podCounts()`.
4. `close` der letzten View → Session wird nach `idleMs` geschlossen (Tunnel `close`, Host `close`); erneutes `open` vor Ablauf behält die Session.
5. `closeOwner` schließt alle Views dieses Owners.
6. Verbindungsabbruch: die Session prüft alle 5 s (über `schedule`) und sofort bei jeder Watcher-Störung `access.host.closed`; ist er `true` → `status: reconnecting`, nach Backoff erneut `openAccess` (Failover passiert dort), danach `ready` und alle Watcher melden `reset`.
7. `detail(yaml)` → `toYaml(await api.read(ref))`; `detail(describe)` → `describe(object, await api.eventsFor(ref))`; `detail(events)` → `{ mode: 'events', rows }`.
8. `action` auf `readOnly`-Cluster → `Dieser Cluster ist schreibgeschützt.`, API unberührt; sonst `runAction` mit `readOnly` aus dem **aktuellen** Vault-Stand (`getCluster` bei jedem Aufruf).
9. `openTerminal` für Shell auf `readOnly` → Fehler; für Logs → `api.openTerminal`; ohne laufende Session wird sie geöffnet und bleibt offen, solange das Terminal lebt (Terminal zählt wie eine View).
10. Fremder Owner auf fremde View → `Die Cluster-Ansicht ist nicht verfügbar.`.
11. TLS-Fallback: Wirft die erste API-Anfrage nach `ready` einen `KubeApiError` mit `TLS:`-Präfix wegen Altname, wird `parsed.build(port, 'kubernetes')` einmal versucht; klappt es, läuft die Session damit weiter.

- [ ] **Step 2: `session.ts` implementieren**

Ablauf `start(cluster)`: Status `connecting` → `access = await openAccess(cluster)` → `parsed = parseKubeconfig(access.kubeconfig, cluster.context)` → `tunnel = await openTunnel(access, parsed.server)` → `api = createApi(parsed.build(tunnel.port))` → Probe `await api.list('nodes', null)` (TLS-Fallback hier) → `overview.start()` → Status `ready`. Fehler → Status `error` mit Meldung (Klartext-Meldungen aus `KubeInputError`/`HostAccessError`/`KubeApiError`, sonst `Die Verbindung zum Cluster ist fehlgeschlagen.`) und **kein** automatischer Retry beim ersten Start; der Renderer bietet „Erneut versuchen“ (neues `open`). Nach einem `ready` gilt das Backoff-Verhalten aus der Spec.

- [ ] **Step 3: `ipc.ts`**

```ts
export function registerKubernetesIpcHandlers(knownHosts: KnownHosts, sudoRejections: SudoRejections): KubeSessions {
  const openRemote = (connection: SshConnectionNode) => openRemoteHost(connection, (host, port, key, isActive) => knownHosts.verify(host, port, key, isActive));
  const getConnection = (id: string) => findConnection(vaultSessionManager.getSnapshot().vault.nodes, id);
  const sessions = new KubeSessions({
    getCluster: id => { const node = getConnection(id); if (node?.protocol !== 'kubernetes') throw new Error('Der Cluster wurde nicht gefunden.'); return node; },
    openAccess: cluster => openAccess(cluster, { getConnection, openRemote, sudoRejections }),
    openTunnel: (access, target) => openTunnel((host, port) => access.host.forward(host, port), target),
    createApi: createKubeApi,
    emit: (ownerId, event) => { const owner = webContents.fromId(ownerId); if (owner && !owner.isDestroyed()) owner.send(IPC_CHANNELS.kubeEvent, event); },
  });
  ipcMain.handle(IPC_CHANNELS.kubeOpen, (event, request: unknown) => sessions.open(requireSshSender(event), parseRequest(KubeOpenRequestSchema, request).clusterId));
  // kubeSubscribe, kubeDetail, kubeAction, kubeClose analog mit den Schemas aus kubernetes-schema.ts
  ipcMain.handle(IPC_CHANNELS.kubeProbe, async (event, request: unknown) => {
    requireSshSender(event);
    const connection = getConnection(parseRequest(KubeProbeRequestSchema, request).connectionId);
    if (connection?.protocol !== 'ssh') throw new Error('Bitte wähle eine SSH-Verbindung.');
    const host = await openRemote(connection);
    try { const { text, source } = await readKubeconfig(host, connection, { source: 'auto' }, sudoRejections); return { source, ...listContexts(text) }; }
    finally { host.close(); }
  });
  return sessions;
}
```

Fehler aus Handlern: wie bei den Containern nur lesbare Meldungen weitergeben (`KubeInputError`, `HostAccessError`, `KubeApiError` wörtlich, sonst `publicError`).

- [ ] **Step 4: Verdrahten** — `index.ts`: `kubeSessions = registerKubernetesIpcHandlers(knownHosts, sudoRejections)` **vor** `registerSshIpcHandlers`; `registerSshIpcHandlers(knownHosts, sudoRejections, (clusterId, target, size, io) => kubeSessions.openTerminal(clusterId, target, size, io))` (neuer optionaler Parameter, an `SshSessionManager` als `openKubeTerminal` durchreichen). `kubeSessions.closeAll()` an denselben Stellen wie `containerDiscovery.closeAll()`; `closeOwner` dort, wo Fenster-Sessions aufgeräumt werden (wie `sshSessionManager.closeOwner`).

Run: `npx vitest run src/main/kubernetes` → PASS. `npm run typecheck` → keine Fehler.

---

### Task 16: Cluster-Tab im Renderer (Komponenten + Hook)

**Files:**
- Create: `src/renderer/src/hooks/useClusterSession.ts`
- Create: `src/renderer/src/components/kubernetes/ClusterView.tsx`, `NodeStrip.tsx`, `ProblemBanner.tsx`, `ResourceTable.tsx`, `DetailDock.tsx`, `HelpOverlay.tsx`, `ConfirmAction.tsx`
- Create: `src/renderer/src/kubernetes-ui.css`
- Create: `src/renderer/src/confirm-action.ts`, `src/renderer/src/confirm-action.test.ts`

**Interfaces:**
- Consumes: `kubeViewReducer`, `visibleRows`, `snapshotOf`, `formatAge`, `formatUsage`, `sparkline` (Task 10); `KUBE_COMMANDS`, `commandForKey`, `bindingOf`, `parseCommandLine`, `completions` (Task 11); `TerminalPanel`; `window.desktopApi.kube*`.
- Produces:
```ts
// useClusterSession.ts
export function useClusterSession(clusterId: string, initial?: KubeViewSnapshot, defaultNamespace?: string | null):
  { state: KubeViewState; dispatch: (action: KubeViewAction) => void; viewId: string | null; retry: () => void;
    detail: (ref: KubeRef, mode: KubeDetailMode) => Promise<KubeDetail>; action: (request: Omit<KubeActionRequest, 'viewId'>) => Promise<void> };
// ClusterView.tsx
export function ClusterView(props: { connection: TerminalConnection; tabId: string; visible: boolean; focused?: boolean; style?: CSSProperties;
  onFocus?: () => void; onStatusChange: (id: string, status: SshStatus) => void; onPopout: (connection: TerminalConnection) => void;
  initialView?: KubeViewSnapshot; onSnapshot?: (tabId: string, snapshot: KubeViewSnapshot) => void }): JSX.Element;
// confirm-action.ts
export function confirmationFor(request: { ref: KubeRef; action: KubeAction; replicas?: number; currentReplicas?: number }, cluster: { name: string; production: boolean }):
  { title: string; body: string; requireTyping: string | null; confirmLabel: string };
```

- [ ] **Step 1: Failing tests `confirm-action.test.ts`**

```ts
it('asks to type the name on production clusters', () => {
  expect(confirmationFor({ ref: { kind: 'deployments', namespace: 'shop', name: 'api' }, action: 'restart' }, { name: 'k8s', production: true }))
    .toEqual({ title: 'Rollout neu starten?', body: 'Deployment api im Namespace shop auf k8s wird neu gestartet.', requireTyping: 'api', confirmLabel: 'Neu starten' });
});
it('asks to type the name when scaling to zero, also outside production', () => {
  const result = confirmationFor({ ref: { kind: 'statefulsets', namespace: 'db', name: 'pg' }, action: 'scale', replicas: 0, currentReplicas: 3 }, { name: 'test', production: false });
  expect(result).toMatchObject({ title: 'Skalieren?', body: 'StatefulSet pg im Namespace db auf test: 3 → 0 Replicas.', requireTyping: 'pg', confirmLabel: 'Skalieren' });
});
it('only confirms without typing outside production', () => {
  expect(confirmationFor({ ref: { kind: 'pods', namespace: 'shop', name: 'api-1' }, action: 'delete' }, { name: 'test', production: false }))
    .toEqual({ title: 'Pod löschen?', body: 'Pod api-1 im Namespace shop auf test wird gelöscht.', requireTyping: null, confirmLabel: 'Löschen' });
});
```

Run → FAIL; implementieren → PASS.

- [ ] **Step 2: `useClusterSession`** — `kubeOpen` beim Mount (bei `StrictMode`-Doppelmount: geöffnete View im Cleanup schließen), `onKubeEvent` nach `viewId` filtern und in den Reducer geben, bei Änderung von `state.query` (über `queryKey`) `kubeSubscribe` senden, `kubeClose` beim Unmount. `retry` = schließen + neu öffnen. Initial `restore` mit `initial`, sonst `initialKubeView(defaultNamespace ?? 'default')`.

- [ ] **Step 3: Komponenten** (Layout laut Mockup „C“ in der Spec, Tokens aus `styles.css`)

- `ClusterView`: Kopfzeile (Name, Badges „Produktion“/„Nur lesen“, Breadcrumb aus `crumbs`, Namespace-Auswahl aus `namespaces` + „alle“, Eingabefeld für `/` und `:` mit `completions` als Vorschlagsliste, **?**-Knopf, Status-Text: `verbinde …` / `bereit über <host>` / `getrennt – verbinde neu …` / Fehlermeldung + Knopf „Erneut versuchen“). Bei `reconnecting` bekommt der Inhalt die Klasse `kube-stale` (grau). `onStatusChange(tabId, …)`: `ready` → `connected`, `error` → `error`, sonst `connecting`. Tastatur: `onKeyDown` auf dem Tabellen-Container → `commandForKey(bindingOf(event))`; Taste nur behandeln, wenn der Fokus nicht in einem Eingabefeld liegt (außer `Escape`). Nicht verfügbare Befehle (`unavailable`) zeigen ihre Begründung als kurze Meldung in der Statuszeile.
- `NodeStrip`: eine Kachel pro `NodeTile` (Name ohne gemeinsames Präfix, z. B. `cp1` für `k8s-cp1`), Punkt grün/gelb/rot, zwei Balken CPU/RAM wenn vorhanden, sonst einmalig der Hinweis „Auslastung nicht verfügbar“. Klick → `dispatch({ type: 'jump', ref: { kind: 'nodes', name } })`.
- `ProblemBanner`: ausgeblendet ohne Probleme; eine Zeile „N Probleme ▾“ (bei 1: Meldung direkt); aufgeklappt Liste, Klick → `jump`.
- `ResourceTable`: Reiter `KUBE_KINDS` mit Ziffer (1–9, 0), Spalten `KIND_COLUMNS[kind]` (Sortierung per Klick auf den Kopf), Zeilen aus `visibleRows`, `aria-selected`, Tone als Klasse, `age`-Spalten über `formatAge` (alle 10 s neu rendern), `usage`-Spalten aus `state.usage[refKey]` → letzter Wert über `formatUsage` + `sparkline`. Ab 200 Zeilen nur den sichtbaren Ausschnitt rendern (feste Zeilenhöhe 24 px, Scroll-Offset → Start-/Endindex). Bei `containersOf` statt der Pod-Tabelle die Container-Liste des Pods (Name, Image falls bekannt, Bereit). Doppelklick = `drill`.
- `DetailDock`: Reiter Logs/Shell/Events/YAML/Describe, Höhe per Ziehen (min. 120 px, max. 70 % der View), `Ctrl+J` klappt ein. Logs/Shell: ein eingebettetes `TerminalPanel` mit `connection = { ...props.connection, kube: { namespace, pod, container, mode } }`; `key` = `${refKey}/${container}/${mode}`, damit ein Auswahlwechsel den alten Stream schließt. Shell startet nur nach `s`/Klick auf „Shell öffnen“ (Platzhalter mit Knopf), nie durch Auswahlbewegung. Logs mit `p` → Modus `previous`. Events/YAML/Describe: `detail()` beim Wechsel von Auswahl oder Modus, Ergebnis in `<pre>` (YAML/Describe) bzw. einer kleinen Tabelle (Events). Knopf „Als Tab öffnen“ (und `Ctrl+Shift+T`) → `onPopout({ ...connection, name: \`Logs: ${pod} @ ${cluster}\` | \`${pod} @ ${cluster}\`, kube })`.
- `HelpOverlay`: modal, Suchfeld oben (filtert Beschreibung, Tasten, Befehle), zwei Spalten: Hotkeys nach `group`, Befehle mit `syntax` und `example`; nicht verfügbare ausgegraut mit Begründung. `Escape` schließt, Fokus zurück in die Tabelle.
- `ConfirmAction`: Dialog aus `confirmationFor`; bei `requireTyping` Eingabefeld „Zur Bestätigung ‚<name>‘ eintippen“, Bestätigen-Knopf erst bei exakter Übereinstimmung aktiv; für Scale vorher ein Zahlenfeld (Vorgabe = aktuelle Replicas, 0–1000). Nach Bestätigung `action(...)`, Fehler als Meldung im Dialog, Erfolg schließt.

- [ ] **Step 4: Prüfen**

Run: `npx vitest run src/renderer/src/confirm-action.test.ts` → PASS. `npx tsc --noEmit -p tsconfig.web.json` → keine Fehler in den neuen Dateien.

---

### Task 17: Einbindung in Tabs, Vault-Baum und Workspaces

**Files:**
- Modify: `src/renderer/src/components/SplitTerminalArea.tsx` (ClusterView für Cluster-Tabs)
- Modify: `src/renderer/src/terminal-tabs.ts` (+ Test) — `kube` in `open`/`adopt` übernehmen, `sameTarget` berücksichtigt `kube`, `shellOf` liefert für `kube.mode === 'shell'` `'ssh'`, sonst `null`; neue Funktion `kubeTabName(target, clusterName)`
- Modify: `src/renderer/src/App.tsx` (Popout öffnet Terminal-Tab; „Als Kubernetes-Cluster einrichten…“; Snapshots für Workspaces)
- Modify: `src/renderer/src/components/VaultTree.tsx` (Kontextmenü-Eintrag an SSH-Verbindungen; Produktions-Rahmen)
- Modify: `src/renderer/src/terminal-layout.ts` (+ Test) — `kubeTabs` speichern/wiederherstellen
- Modify: `src/renderer/src/navigation-ui.css` (Klasse `vault-node-production`)

**Interfaces:**
- Consumes: `ClusterView` (Task 16), `newClusterFromSsh`, `suggestAccessHosts` (Task 12), `KubeViewSnapshot`.

- [ ] **Step 1: Failing tests**

- `terminal-tabs.test.ts`: zwei Tabs desselben Clusters mit unterschiedlichem `kube` sind nicht `sameTarget`; `open` übernimmt `kube`; `kubeTabName({ namespace:'shop', pod:'api-1', container:'api', mode:'logs' }, 'k8s')` → `Logs: api-1 @ k8s`, Modus `previous` → `Vorherige Logs: api-1 @ k8s`, `shell` → `api-1 @ k8s`.
- `terminal-layout.test.ts`: Cluster-Tab ohne `kube` mit Snapshot wird als `kubeTabs: [{ index, view }]` gespeichert und beim Wiederherstellen mit `initialView` zurückgegeben; Cluster-Tabs **mit** `kube` (herausgelöste Logs/Shells) werden **nicht** gespeichert (Spec: nicht wiederhergestellt).

- [ ] **Step 2: Implementieren**

- `SplitTerminalArea`: `if (tab.connection.protocol === 'kubernetes' && !tab.connection.kube) return <ClusterView key={tab.id} {...panel} onPopout={…} initialView={…} onSnapshot={…} />;` — die Callbacks als neue Props von `SplitTerminalArea` bis `App` durchreichen.
- `App.tsx`: `onPopout(connection)` → `terminals.open(connection)`. Snapshots in einem `useRef<Map<string, KubeViewSnapshot>>` halten, beim Speichern eines Workspaces an `terminal-layout.ts` übergeben (dem Muster von `fileBrowsers`/`containerTabs` folgen).
- `VaultTree.tsx`: Kontextmenü einer aktiven SSH-Verbindung bekommt „Als Kubernetes-Cluster einrichten…“ → neuer Prop `onSetupCluster?: (sshId: string) => void`. In `App.tsx`: `kubeProbe({ connectionId })` (Fehler als Meldung), dann `newClusterFromSsh(...)` mit `crypto.randomUUID()` und den Editor mit diesem Entwurf öffnen (wie beim Anlegen einer neuen Verbindung, im selben Ordner wie die SSH-Verbindung). Doppelklick auf einen Cluster → `terminals.open(toTerminalConnection(node))` (funktioniert bereits, da `protocol: 'kubernetes'`). Cluster mit `production: true` bekommen die Klasse `vault-node-production` (roter linker Rand, Farbe `--ui-danger`).
- Disabled-Cluster öffnen sich nicht (bestehende `disabled`-Logik gilt automatisch).

- [ ] **Step 3: Prüfen**

Run: `npm test` → alles grün. `npm run typecheck` → keine Fehler.

---

### Task 18: Dokumentation und Version

**Files:**
- Modify: `README.md`, `CHANGELOG.md`, `package.json` (Version `0.5.0`), `docs/superpowers/specs/2026-10-14-container-integration-design.md`

- [ ] **Step 1: README** — neuer Abschnitt „Kubernetes“ nach „Container und VMs“: Einrichtung („Als Kubernetes-Cluster einrichten…“ an einer SSH-Verbindung), Zugangs-Hosts und Failover, kubeconfig-Quellen inkl. sudo für `admin.conf`, Produktion/Nur lesen, Bedienung (Tabelle, Drill-down, unterer Bereich, `?` für die Hilfe), Sicherheitshinweise (kubeconfig nur im Speicher, Tunnel nur `127.0.0.1`). In „Container und VMs“ den Satz „keine Cluster-Ansicht und kein Kubernetes.“ ersetzen durch „Kubernetes hat einen eigenen Abschnitt.“.
- [ ] **Step 2: CHANGELOG** — Eintrag `0.5.0` im bestehenden Format: „Kubernetes-Cluster (Stufe 1): …“.
- [ ] **Step 3: Version** — `npm run version:minor` (setzt 0.5.0); `npm run check:version` → OK.
- [ ] **Step 4: Container-Spec** — unter „Abgrenzung“ bei „Kubernetes“: „(eigene Spec: `2026-10-16-kubernetes-integration-design.md`)“.
- [ ] **Step 5: Prüfen** — `npm test`, `npm run typecheck`, `npm run check:version` → grün.

---

## Abnahme (manuell, nur lesend, gegen k8s)

Erst nach Freigabe durch den Nutzer. Keine Aktion bestätigen — Restart/Scale/Löschen nur bis zum Dialog öffnen und **abbrechen**.

1. `npm run dev`, Vault entsperren, an `k8s-cp1` „Als Kubernetes-Cluster einrichten…“ → Formular mit cp2/cp3 vorgeschlagen, Produktion an.
2. Cluster öffnen → Status „bereit über k8s-cp1“, 6 Node-Kacheln, Pods live.
3. Drill-down Deployment → Pods → Container; `Esc` zurück.
4. Logs (`l`), vorherige Logs (`p`), Shell (`s`, dort nur `hostname` tippen), Events/YAML/Describe; YAML eines Secrets zeigt `•••`.
5. `?` öffnet die Hilfe; `:ns all`, `:deploy` funktionieren.
6. Failover: cp1 im Vault deaktivieren, Tab neu öffnen → „bereit über k8s-cp2“; cp1 wieder aktivieren.
7. Restart/Scale/Löschen: Dialog verlangt Eintippen des Namens → **Abbrechen**.
8. Workspace speichern, App neu starten, Workspace öffnen → Cluster-Tab mit Namespace/Reiter wiederhergestellt.
