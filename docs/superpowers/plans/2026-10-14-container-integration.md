# Container-Integration (Docker, Podman, Proxmox) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Container und VMs unter SSH-Verbindungen (und lokal) in der Seitenleiste anzeigen, per Doppelklick eine Shell im Tab öffnen, Logs folgen und Start/Stop/Restart auslösen.

**Architecture:** Neues Main-Modul `src/main/containers/` führt feste, geprüfte Shell-Befehle über eine kurz zwischengespeicherte SSH-Verbindung (`ssh2 exec`) oder lokal (`execFile`) aus und parst die Ausgabe. Terminal-Tabs bekommen ein optionales `target`; `SshSessionManager` öffnet dafür `client.exec(cmd, { pty })` statt `client.shell` bzw. lokal `docker exec -it` per node-pty. Der Renderer hält die Ergebnisse nur im Speicher (Reducer + Hook) und rendert sie unter aufklappbaren SSH-Knoten.

**Tech Stack:** Electron 44, React 19, TypeScript 5.9, ssh2, node-pty, zod 4, vitest.

**Spec:** `docs/superpowers/specs/2026-10-14-container-integration-design.md`

## Global Constraints

- Keine neuen npm-Abhängigkeiten. Keine Vault-Migration: alle neuen Vault-Felder sind optional, `version` bleibt `2`.
- UI-Texte und Fehlermeldungen auf Deutsch, Code-Kommentare auf Englisch, knapp wie im bestehenden Code.
- Container-Referenzen (`ref`) passen auf `^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$`, VMIDs sind Ganzzahlen von 100 bis 999999999. Alles andere wird abgewiesen.
- Der Renderer schickt nie Befehlstext, nur `hostId`, `target` und das Enum `ContainerAction`. Befehle baut nur der Main-Prozess.
- Remote-Befehle werden immer über `remoteCommand(argv, sudo)` gebaut (Argumente in einfachen Anführungszeichen). Lokal immer Argument-Array, nie eine Shell-Zeichenkette.
- Timeouts: Erkennung und Listen 15 000 ms, Aktionen 120 000 ms, gecachte Host-Verbindung schließt nach 60 000 ms Leerlauf.
- `MAX_SSH_SESSIONS` (16) gilt auch für Container-Tabs.
- sudo nur, wenn `containers.sudo` an der Verbindung gesetzt ist, und dann immer als `sudo -n`.
- Befehle: `npm test` (vitest), `npm run typecheck`. Einzeltest: `npx vitest run <pfad>`.
- Branch: `claude/feature/container-integration` (von `claude/docs/container-integration` abzweigen). Commit-Format laut `~/.claude/CLAUDE.md` (type(scope): summary, What/Why, Bullets, keine Co-Authored-By-Zeile).

## Review Focus

1. **Container-Name mit Zeichen außerhalb des Musters** (Podman erlaubt mehr, z. B. bei importierten Containern): Eintrag muss trotzdem erscheinen und über die ID funktionieren. Test in Task 2 (`parseContainerList` fällt auf die ID zurück).
2. **Mehrere gleichzeitige Erkennungen für denselben Host** (zwei Fenster, schnelles Auf-/Zuklappen): darf nur eine SSH-Verbindung öffnen. Test in Task 4.
3. **Verbindung im Vault geändert (anderes Passwort/anderer Host), Cache-Client noch offen:** nächste Anfrage muss neu verbinden statt den alten Client zu nutzen. Test in Task 4.
4. **Tab eines lokalen Containers bei Vault-Änderung:** `retainConnections` darf ihn nicht schließen, weil es keine Vault-Verbindung dazu gibt. Test in Task 8.
5. **Workspace mit Container-Tab wird gespeichert und neu geladen:** Tab muss wieder ein Container-Tab sein (nicht die normale SSH-Shell des Hosts), lokale Container-Tabs fallen heraus. Test in Task 8.

---

## Dateiübersicht

| Datei | Neu/Ändern | Verantwortung |
|---|---|---|
| `src/shared/containers.ts` | neu | Typen, `LOCAL_CONTAINER_HOST`, `CONTAINER_REF`, `toTarget`, `targetKey` |
| `src/shared/containers-schema.ts` | neu | zod-Schemas `ContainerTargetSchema`, `TerminalTargetSchema` (Vault, IPC, Tab-Transfer) |
| `src/main/containers/commands.ts` | neu | Befehle bauen und Eingaben prüfen |
| `src/main/containers/parsers.ts` | neu | Ausgaben parsen, Fehler übersetzen, `RunResult` |
| `src/main/containers/runner.ts` | neu | Remote-Host über ssh2 (`openRemoteHost`), lokal (`runLocal`) |
| `src/main/containers/discovery.ts` | neu | `ContainerDiscovery`: Liste, Aktion, Client-Cache |
| `src/main/containers/ipc.ts` | neu | IPC-Handler und Validierung |
| `src/main/ssh/session.ts` | ändern | Sessions mit `target` (SSH-exec, lokal) |
| `src/main/ssh/validation.ts` | ändern | `target` im Prepare-Schema |
| `src/shared/ssh.ts` | ändern | `SshPrepareRequest.target` |
| `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/index.ts` | ändern | Kanäle, API, Verdrahtung |
| `src/shared/vault/types.ts`, `schema.ts` | ändern | `containers.sudo`, `WorkspacePane.containerTabs` |
| `src/renderer/src/connection-form.ts`, `components/ConnectionForm.tsx` | ändern | sudo-Häkchen |
| `src/shared/windows.ts`, `src/main/window-ipc.ts` | ändern | `TabConnection.target` |
| `src/renderer/src/terminal-tabs.ts`, `terminal-layout.ts`, `components/TerminalPanel.tsx` | ändern | Tabs mit Ziel, Workspaces |
| `src/renderer/src/container-tree.ts` | neu | Reducer, Gruppen, Menüs (rein, testbar) |
| `src/renderer/src/hooks/useContainerDiscovery.ts` | neu | Hook um Reducer und IPC |
| `src/renderer/src/components/ContainerChildren.tsx` | neu | Einträge eines Hosts |
| `src/renderer/src/components/LocalContainers.tsx` | neu | Abschnitt „Dieser Computer“ |
| `src/renderer/src/components/VaultTree.tsx`, `App.tsx`, `navigation-ui.css` | ändern | Aufklappbare SSH-Knoten, Verdrahtung, Styles |
| `README.md`, `CHANGELOG.md`, `package.json` | ändern | Doku, Version 0.3.0 |

---

### Task 0: Branch anlegen

- [ ] **Step 1:** `git switch -c claude/feature/container-integration` (vom Stand `claude/docs/container-integration`).

---

### Task 1: Gemeinsame Typen und Befehlsbau

**Files:**
- Create: `src/shared/containers.ts`
- Create: `src/shared/containers-schema.ts`
- Create: `src/main/containers/commands.ts`
- Test: `src/main/containers/commands.test.ts`

**Interfaces:**
- Produces: alle Typen aus `src/shared/containers.ts` (siehe Code), `ContainerTargetSchema`, `TerminalTargetSchema`, `SHELL_CHOICE`, `PROBE_SCRIPT`, `shellJoin(argv)`, `remoteCommand(argv, sudo)`, `listArgv(kind)`, `terminalArgv(target)`, `actionArgv(target, action)`, `ContainerInputError`.

- [ ] **Step 1: Gemeinsame Typen anlegen** (`src/shared/containers.ts`)

```ts
export type ContainerRuntime = 'docker' | 'podman';
export type RuntimeKind = ContainerRuntime | 'proxmox';
/** An SSH connection id from the vault, or LOCAL_CONTAINER_HOST for this computer. */
export type ContainerHostId = string;
export const LOCAL_CONTAINER_HOST = 'local-containers';
/** Docker and Podman enforce this for names; IDs match it too. */
export const CONTAINER_REF = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
export const MIN_VMID = 100;
export const MAX_VMID = 999_999_999;

export type ItemState = 'running' | 'paused' | 'stopped';
export type DiscoveredItem =
  | { kind: 'container'; runtime: ContainerRuntime; id: string; ref: string; name: string; image: string; state: ItemState }
  | { kind: 'lxc' | 'vm'; vmid: number; name: string; state: ItemState };

export interface DiscoveryResult {
  runtimes: RuntimeKind[];
  items: DiscoveredItem[];
  /** Per runtime: a short German message when listing failed (e.g. no permission). */
  problems: Partial<Record<RuntimeKind, string>>;
}

/** `ref` is the container name when it is a valid reference, otherwise the ID; commands use it. */
export type ContainerTarget =
  | { kind: 'container'; runtime: ContainerRuntime; ref: string; name: string }
  | { kind: 'lxc' | 'vm'; vmid: number; name: string };
export type TerminalTargetMode = 'shell' | 'logs';
export interface TerminalTarget { item: ContainerTarget; mode: TerminalTargetMode }
export type ContainerAction = 'start' | 'stop' | 'restart' | 'shutdown';

export function toTarget(item: DiscoveredItem): ContainerTarget {
  return item.kind === 'container'
    ? { kind: 'container', runtime: item.runtime, ref: item.ref, name: item.name }
    : { kind: item.kind, vmid: item.vmid, name: item.name };
}

/** Identity of a container or guest on one host. */
export function itemKey(item: DiscoveredItem | ContainerTarget): string {
  return item.kind === 'container' ? `container:${item.runtime}:${item.ref}` : `${item.kind}:${item.vmid}`;
}

export function targetKey(target: TerminalTarget): string { return `${itemKey(target.item)}:${target.mode}`; }
```

- [ ] **Step 2: zod-Schemas anlegen** (`src/shared/containers-schema.ts`)

```ts
import { z } from 'zod';
import { CONTAINER_REF, MAX_VMID, MIN_VMID } from './containers';
import type { ContainerTarget, TerminalTarget } from './containers';

export const ContainerTargetSchema: z.ZodType<ContainerTarget> = z.union([
  z.object({ kind: z.literal('container'), runtime: z.enum(['docker', 'podman']), ref: z.string().regex(CONTAINER_REF), name: z.string().min(1).max(256) }).strict(),
  z.object({ kind: z.enum(['lxc', 'vm']), vmid: z.number().int().min(MIN_VMID).max(MAX_VMID), name: z.string().max(256) }).strict(),
]);

export const TerminalTargetSchema: z.ZodType<TerminalTarget> = z.object({
  item: ContainerTargetSchema,
  mode: z.enum(['shell', 'logs']),
}).strict();
```

- [ ] **Step 3: Failing Tests schreiben** (`src/main/containers/commands.test.ts`)

```ts
import { describe, expect, it } from 'vitest';
import { actionArgv, ContainerInputError, listArgv, remoteCommand, shellJoin, SHELL_CHOICE, terminalArgv } from './commands';

const web = { kind: 'container' as const, runtime: 'docker' as const, ref: 'web-1', name: 'web-1' };
const ct = { kind: 'lxc' as const, vmid: 101, name: 'ct-web' };
const vm = { kind: 'vm' as const, vmid: 100, name: 'win11' };

describe('shellJoin', () => {
  it('leaves plain words and quotes everything else', () => {
    expect(shellJoin(['docker', 'ps', '--format', '{{json .}}'])).toBe("docker ps --format '{{json .}}'");
    expect(shellJoin(["it's"])).toBe("'it'\\''s'");
    expect(shellJoin(['$(rm -rf /)'])).toBe("'$(rm -rf /)'");
  });
});

describe('remoteCommand', () => {
  it('extends PATH for Proxmox tools and adds sudo -n only on request', () => {
    expect(remoteCommand(['pct', 'list'], false)).toBe('PATH="$PATH:/usr/sbin:/sbin" pct list');
    expect(remoteCommand(['pct', 'list'], true)).toBe('PATH="$PATH:/usr/sbin:/sbin" sudo -n pct list');
  });
});

describe('listArgv', () => {
  it('lists every runtime', () => {
    expect(listArgv('docker')).toEqual(['docker', 'ps', '-a', '--no-trunc', '--format', '{{json .}}']);
    expect(listArgv('podman')).toEqual(['podman', 'ps', '-a', '--format', 'json']);
    expect(listArgv('lxc')).toEqual(['pct', 'list']);
    expect(listArgv('vm')).toEqual(['qm', 'list']);
  });
});

describe('terminalArgv', () => {
  it('opens a shell, logs, an LXC console and a serial console', () => {
    expect(terminalArgv({ item: web, mode: 'shell' })).toEqual(['docker', 'exec', '-it', 'web-1', 'sh', '-c', SHELL_CHOICE]);
    expect(terminalArgv({ item: { ...web, runtime: 'podman' }, mode: 'logs' })).toEqual(['podman', 'logs', '-f', '--tail', '500', 'web-1']);
    expect(terminalArgv({ item: ct, mode: 'shell' })).toEqual(['pct', 'enter', '101']);
    expect(terminalArgv({ item: vm, mode: 'shell' })).toEqual(['qm', 'terminal', '100']);
  });
  it('rejects logs for Proxmox guests', () => {
    expect(() => terminalArgv({ item: ct, mode: 'logs' })).toThrow(ContainerInputError);
  });
  it.each(['; rm -rf /', 'web 1', '$(id)', '', '-it', '.hidden'])('rejects the reference %j', ref => {
    expect(() => terminalArgv({ item: { ...web, ref }, mode: 'shell' })).toThrow(ContainerInputError);
  });
  it.each([99, 1.5, -1, 1_000_000_000])('rejects the VMID %j', vmid => {
    expect(() => terminalArgv({ item: { ...ct, vmid }, mode: 'shell' })).toThrow(ContainerInputError);
  });
});

describe('actionArgv', () => {
  it('maps actions per kind', () => {
    expect(actionArgv(web, 'restart')).toEqual(['docker', 'restart', 'web-1']);
    expect(actionArgv(ct, 'shutdown')).toEqual(['pct', 'shutdown', '101']);
    expect(actionArgv(vm, 'stop')).toEqual(['qm', 'stop', '100']);
  });
  it('rejects actions a kind does not have', () => {
    expect(() => actionArgv(web, 'shutdown')).toThrow(ContainerInputError);
    expect(() => actionArgv(vm, 'restart')).toThrow(ContainerInputError);
  });
});
```

- [ ] **Step 4:** `npx vitest run src/main/containers/commands.test.ts` → FAIL (Modul fehlt).

- [ ] **Step 5: Implementierung** (`src/main/containers/commands.ts`)

```ts
import { CONTAINER_REF, MAX_VMID, MIN_VMID } from '../../shared/containers';
import type { ContainerAction, ContainerTarget, RuntimeKind, TerminalTarget } from '../../shared/containers';

/** Invalid targets or actions; the message is safe to show. */
export class ContainerInputError extends Error {}

export const SHELL_CHOICE = 'command -v bash >/dev/null 2>&1 && exec bash || exec sh';
/** Proxmox tools live in /usr/sbin, which non-root PATHs often lack. */
const PATH_PREFIX = 'PATH="$PATH:/usr/sbin:/sbin"';
export const PROBE_SCRIPT = `${PATH_PREFIX}; for c in docker podman pct qm; do command -v "$c" >/dev/null 2>&1 && echo "has:$c"; done; true`;

const SAFE_WORD = /^[A-Za-z0-9_./:=@%+,-]+$/;
export function shellJoin(argv: string[]): string {
  return argv.map(arg => SAFE_WORD.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`).join(' ');
}
export function remoteCommand(argv: string[], sudo: boolean): string {
  return `${PATH_PREFIX} ${shellJoin(sudo ? ['sudo', '-n', ...argv] : argv)}`;
}

function ref(value: string): string {
  if (!CONTAINER_REF.test(value)) throw new ContainerInputError('Ungültige Container-Angabe.');
  return value;
}
function vmid(value: number): string {
  if (!Number.isInteger(value) || value < MIN_VMID || value > MAX_VMID) throw new ContainerInputError('Ungültige VM-ID.');
  return String(value);
}

export function listArgv(kind: Exclude<RuntimeKind, 'proxmox'> | 'lxc' | 'vm'): string[] {
  switch (kind) {
    case 'docker': return ['docker', 'ps', '-a', '--no-trunc', '--format', '{{json .}}'];
    case 'podman': return ['podman', 'ps', '-a', '--format', 'json'];
    case 'lxc': return ['pct', 'list'];
    case 'vm': return ['qm', 'list'];
  }
}

export function terminalArgv({ item, mode }: TerminalTarget): string[] {
  if (item.kind === 'container') {
    return mode === 'logs' ? [item.runtime, 'logs', '-f', '--tail', '500', ref(item.ref)]
      : [item.runtime, 'exec', '-it', ref(item.ref), 'sh', '-c', SHELL_CHOICE];
  }
  if (mode === 'logs') throw new ContainerInputError('Logs gibt es nur für Docker- und Podman-Container.');
  return item.kind === 'lxc' ? ['pct', 'enter', vmid(item.vmid)] : ['qm', 'terminal', vmid(item.vmid)];
}

const ACTIONS: Record<ContainerTarget['kind'], ContainerAction[]> = {
  container: ['start', 'stop', 'restart'], lxc: ['start', 'shutdown', 'stop'], vm: ['start', 'shutdown', 'stop'],
};

export function actionArgv(target: ContainerTarget, action: ContainerAction): string[] {
  if (!ACTIONS[target.kind].includes(action)) throw new ContainerInputError('Diese Aktion ist hier nicht möglich.');
  if (target.kind === 'container') return [target.runtime, action, ref(target.ref)];
  return [target.kind === 'lxc' ? 'pct' : 'qm', action, vmid(target.vmid)];
}
```

Hinweis: `'.hidden'` und `'-it'` scheitern am ersten Zeichen des Musters (nur Buchstabe/Ziffer), das ist gewollt.

- [ ] **Step 6:** `npx vitest run src/main/containers/commands.test.ts` → PASS.
- [ ] **Step 7: Commit**

```bash
git add src/shared/containers.ts src/shared/containers-schema.ts src/main/containers/commands.ts src/main/containers/commands.test.ts
git commit   # feat(containers): add shared types and validated command builder
```

---

### Task 2: Parser und Fehlerübersetzung

**Files:**
- Create: `src/main/containers/parsers.ts`
- Test: `src/main/containers/parsers.test.ts`

**Interfaces:**
- Consumes: `DiscoveredItem`, `ContainerRuntime`, `RuntimeKind`, `CONTAINER_REF` aus Task 1.
- Produces: `RunResult`, `parseProbe(text): Set<'docker'|'podman'|'pct'|'qm'>`, `parseContainerList(runtime, text): DiscoveredItem[]`, `parsePctList(text)`, `parseQmList(text)`, `describeFailure(kind, result): string`.

- [ ] **Step 1: Failing Tests**

```ts
import { describe, expect, it } from 'vitest';
import { describeFailure, parseContainerList, parsePctList, parseProbe, parseQmList } from './parsers';

const dockerLines = [
  '{"Command":"\\"nginx\\"","ID":"3f2a1b","Image":"nginx:1.27","Names":"web-1","State":"running","Status":"Up 2 hours"}',
  '{"ID":"9c8d7e","Image":"postgres:16","Names":"db,db-alias","State":"exited","Status":"Exited (0)"}',
  '{"ID":"aa11bb","Image":"redis","Names":"cache","State":"paused","Status":"Up (Paused)"}',
].join('\n');

const podmanJson = JSON.stringify([
  { Id: 'f00dcafe', Image: 'docker.io/library/alpine:latest', Names: ['tools'], State: 'running' },
  { Id: 'beef1234', Image: 'quay.io/x/y', Names: ['weird name'], State: 'created' },
]);

const pct = `VMID       Status     Lock         Name
101        running                 ct-web
102        stopped    backup       ct-db
`;

const qm = `      VMID NAME                 STATUS     MEM(MB)    BOOTDISK(GB) PID
       100 win11                running    8192              64.00 12345
       103 debian-test          stopped    2048              32.00 0
`;

describe('container parsers', () => {
  it('reads the probe markers', () => {
    expect([...parseProbe('has:docker\nhas:pct\nnoise\n')]).toEqual(['docker', 'pct']);
  });
  it('parses docker JSON lines', () => {
    expect(parseContainerList('docker', dockerLines)).toEqual([
      { kind: 'container', runtime: 'docker', id: '3f2a1b', ref: 'web-1', name: 'web-1', image: 'nginx:1.27', state: 'running' },
      { kind: 'container', runtime: 'docker', id: '9c8d7e', ref: 'db', name: 'db', image: 'postgres:16', state: 'stopped' },
      { kind: 'container', runtime: 'docker', id: 'aa11bb', ref: 'cache', name: 'cache', image: 'redis', state: 'paused' },
    ]);
  });
  it('parses the podman JSON array and falls back to the ID for unusual names', () => {
    expect(parseContainerList('podman', podmanJson)).toEqual([
      { kind: 'container', runtime: 'podman', id: 'f00dcafe', ref: 'tools', name: 'tools', image: 'docker.io/library/alpine:latest', state: 'running' },
      { kind: 'container', runtime: 'podman', id: 'beef1234', ref: 'beef1234', name: 'weird name', image: 'quay.io/x/y', state: 'stopped' },
    ]);
  });
  it('skips malformed lines and empty output', () => {
    expect(parseContainerList('docker', 'not json\n\n')).toEqual([]);
    expect(parseContainerList('podman', '')).toEqual([]);
  });
  it('parses pct list including the lock column', () => {
    expect(parsePctList(pct)).toEqual([
      { kind: 'lxc', vmid: 101, name: 'ct-web', state: 'running' },
      { kind: 'lxc', vmid: 102, name: 'ct-db', state: 'stopped' },
    ]);
  });
  it('parses qm list', () => {
    expect(parseQmList(qm)).toEqual([
      { kind: 'vm', vmid: 100, name: 'win11', state: 'running' },
      { kind: 'vm', vmid: 103, name: 'debian-test', state: 'stopped' },
    ]);
  });
});

describe('describeFailure', () => {
  const failed = (stderr: string, code = 1) => ({ code, stdout: '', stderr });
  it('explains common problems in German', () => {
    expect(describeFailure('docker', failed('permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock'))).toContain('Gruppe docker');
    expect(describeFailure('docker', failed('Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?'))).toBe('Der Docker-Dienst läuft nicht.');
    expect(describeFailure('proxmox', failed('sudo: a password is required'))).toContain('NOPASSWD');
    expect(describeFailure('proxmox', failed('', 127))).toContain('root');
    expect(describeFailure('docker', { code: null, stdout: '', stderr: '', timedOut: true })).toBe('Der Host hat nicht rechtzeitig geantwortet.');
  });
  it('falls back to the last stderr line or the exit code', () => {
    expect(describeFailure('podman', failed('line one\nError: something odd\n'))).toBe('Error: something odd');
    expect(describeFailure('podman', failed('', 2))).toBe('Befehl fehlgeschlagen (Exit-Code 2).');
  });
});
```

- [ ] **Step 2:** `npx vitest run src/main/containers/parsers.test.ts` → FAIL.

- [ ] **Step 3: Implementierung**

```ts
import { CONTAINER_REF } from '../../shared/containers';
import type { ContainerRuntime, DiscoveredItem, ItemState, RuntimeKind } from '../../shared/containers';

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  /** Local only: the program is not installed. */
  notFound?: boolean;
}

type ProbeTool = 'docker' | 'podman' | 'pct' | 'qm';
export function parseProbe(text: string): Set<ProbeTool> {
  const found = new Set<ProbeTool>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^has:(docker|podman|pct|qm)$/.exec(line.trim());
    if (match) found.add(match[1] as ProbeTool);
  }
  return found;
}

const state = (value: unknown): ItemState => value === 'running' ? 'running' : value === 'paused' ? 'paused' : 'stopped';

function containerRecords(text: string): Record<string, unknown>[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try { const parsed: unknown = JSON.parse(trimmed); return Array.isArray(parsed) ? parsed.filter(entry => entry && typeof entry === 'object') : []; }
    catch { return []; }
  }
  return trimmed.split(/\r?\n/).flatMap(line => {
    try { const parsed: unknown = JSON.parse(line); return parsed && typeof parsed === 'object' ? [parsed as Record<string, unknown>] : []; }
    catch { return []; }
  });
}

/** Docker prints one JSON object per line, Podman a JSON array. */
export function parseContainerList(runtime: ContainerRuntime, text: string): DiscoveredItem[] {
  return containerRecords(text).flatMap(record => {
    const id = String(record.ID ?? record.Id ?? '');
    const names = Array.isArray(record.Names) ? record.Names.map(String) : String(record.Names ?? '').split(',');
    const name = names[0]?.trim() || id.slice(0, 12);
    const ref = CONTAINER_REF.test(name) ? name : id;
    if (!CONTAINER_REF.test(ref)) return [];
    return [{ kind: 'container' as const, runtime, id, ref, name, image: String(record.Image ?? ''), state: state(String(record.State ?? '').toLowerCase()) }];
  });
}

function guestRows(text: string): string[][] {
  return text.split(/\r?\n/).map(line => line.trim().split(/\s+/)).filter(parts => /^\d+$/.test(parts[0] ?? ''));
}

/** Columns: VMID Status [Lock] Name. */
export function parsePctList(text: string): DiscoveredItem[] {
  return guestRows(text).filter(parts => parts.length >= 3)
    .map(parts => ({ kind: 'lxc' as const, vmid: Number(parts[0]), name: parts[parts.length - 1], state: state(parts[1]) }));
}

/** Columns: VMID NAME STATUS MEM BOOTDISK PID. */
export function parseQmList(text: string): DiscoveredItem[] {
  return guestRows(text).filter(parts => parts.length >= 3)
    .map(parts => ({ kind: 'vm' as const, vmid: Number(parts[0]), name: parts[1], state: state(parts[2]) }));
}

const SUDO_PASSWORD = 'sudo verlangt ein Passwort. Richte NOPASSWD für docker/pct ein oder füge den Benutzer der Gruppe docker hinzu.';

export function describeFailure(kind: RuntimeKind, result: RunResult): string {
  if (result.timedOut) return 'Der Host hat nicht rechtzeitig geantwortet.';
  const text = `${result.stderr}\n${result.stdout}`;
  if (/sudo: (a password is required|a terminal is required)/i.test(text)) return SUDO_PASSWORD;
  if (kind !== 'proxmox' && /permission denied[^\n]*\.sock/i.test(text)) {
    return `Keine Berechtigung für ${kind === 'docker' ? 'Docker' : 'Podman'}. Benutzer zur Gruppe docker hinzufügen oder sudo aktivieren.`;
  }
  if (kind === 'docker' && /Cannot connect to the Docker daemon/i.test(text)) return 'Der Docker-Dienst läuft nicht.';
  if (kind === 'proxmox' && (result.code === 127 || /root|permission denied/i.test(text))) return 'Proxmox-Befehle brauchen root. sudo aktivieren oder als root verbinden.';
  const last = result.stderr.split(/\r?\n/).map(line => line.trim()).filter(Boolean).pop();
  return last ? last.slice(0, 200) : `Befehl fehlgeschlagen (Exit-Code ${result.code ?? '?'}).`;
}
```

- [ ] **Step 4:** Test → PASS.
- [ ] **Step 5: Commit** (`feat(containers): parse docker, podman and proxmox listings`)

---

### Task 3: Befehlsausführung (SSH und lokal)

**Files:**
- Create: `src/main/containers/runner.ts`
- Test: `src/main/containers/runner.test.ts`

**Interfaces:**
- Consumes: `RunResult` (Task 2), `sshConnectConfig` aus `src/main/ssh/client-config.ts`.
- Produces:
  - `interface RemoteHost { run(command: string, timeoutMs: number): Promise<RunResult>; close(): void; readonly closed: boolean }`
  - `openRemoteHost(connection: SshConnectionNode, verifyHost: VerifyHost, createClient?: () => Client): Promise<RemoteHost>`
  - `type VerifyHost = (host: string, port: number, key: Buffer, isActive: () => boolean) => Promise<boolean>`
  - `runLocal(file: string, args: string[], timeoutMs: number, exec?: typeof execFile): Promise<RunResult>`
  - `class HostAccessError extends Error` (Meldung darf angezeigt werden)

- [ ] **Step 1: Failing Tests.** Echte lokale ssh2-Server-Instanz wie in `src/main/ssh/session.test.ts` (gleiches Setup: `generateKeyPairSync('rsa')`, `Server`, Port 0, Passwort-Auth `synthetic-user`/`synthetic-password`). Der Server beantwortet `exec`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { Server } from 'ssh2';
import type { Connection } from 'ssh2';
import type { SshConnectionNode } from '../../shared/vault/types';
import { HostAccessError, openRemoteHost, runLocal } from './runner';

const hostKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });
let server: Server;
let peers: Connection[];
let commands: string[];
let connection: SshConnectionNode;

beforeEach(async () => {
  peers = []; commands = [];
  server = new Server({ hostKeys: [hostKey] }, peer => {
    peers.push(peer);
    peer.on('error', () => {});
    peer.on('authentication', context => context.method === 'password' && context.password === 'synthetic-password' ? context.accept() : context.reject());
    peer.on('ready', () => peer.on('session', accept => accept().on('exec', (acceptExec, _reject, info) => {
      commands.push(info.command);
      const stream = acceptExec();
      if (info.command === 'hang') return;
      if (info.command === 'fail') { stream.stderr.write('boom\n'); stream.exit(3); stream.end(); return; }
      stream.write(`ran:${info.command}\n`); stream.exit(0); stream.end();
    })));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address === 'string' || !address) throw new Error('Missing server address');
  connection = { id: 'c1', type: 'connection', protocol: 'ssh', name: 'Host', host: '127.0.0.1', port: address.port,
    username: 'synthetic-user', authentication: { method: 'password', password: 'synthetic-password' }, tags: [] };
});

afterEach(async () => {
  for (const peer of peers) peer.end();
  await new Promise<void>(resolve => server.close(() => resolve()));
});

describe('openRemoteHost', () => {
  it('runs commands over one connection and reports exit codes', async () => {
    const host = await openRemoteHost(connection, async () => true);
    expect(await host.run('echo a', 5_000)).toEqual({ code: 0, stdout: 'ran:echo a\n', stderr: '' });
    expect(await host.run('fail', 5_000)).toEqual({ code: 3, stdout: '', stderr: 'boom\n' });
    expect(peers).toHaveLength(1);
    host.close();
    expect(host.closed).toBe(true);
  });
  it('times out a command without closing the host', async () => {
    const host = await openRemoteHost(connection, async () => true);
    expect(await host.run('hang', 200)).toMatchObject({ timedOut: true, code: null });
    expect((await host.run('echo b', 5_000)).code).toBe(0);
    host.close();
  });
  it('refuses an unconfirmed host key with a readable error', async () => {
    await expect(openRemoteHost(connection, async () => false)).rejects.toThrow(HostAccessError);
    await expect(openRemoteHost(connection, async () => false)).rejects.toThrow('Der Server-Schlüssel wurde nicht bestätigt.');
  });
});

describe('runLocal', () => {
  it('reports a missing program as notFound', async () => {
    const exec = ((_file: string, _args: string[], _options: object, callback: (error: NodeJS.ErrnoException | null, stdout: string, stderr: string) => void) => {
      callback(Object.assign(new Error('spawn docker ENOENT'), { code: 'ENOENT' }), '', '');
    }) as never;
    expect(await runLocal('docker', ['ps'], 1_000, exec)).toEqual({ code: null, stdout: '', stderr: '', notFound: true });
  });
  it('returns output and exit code', async () => {
    const exec = ((_file: string, _args: string[], _options: object, callback: (error: (Error & { code?: number }) | null, stdout: string, stderr: string) => void) => {
      callback(Object.assign(new Error('failed'), { code: 2 }), 'out', 'err');
    }) as never;
    expect(await runLocal('docker', ['ps'], 1_000, exec)).toEqual({ code: 2, stdout: 'out', stderr: 'err' });
  });
});
```

- [ ] **Step 2:** `npx vitest run src/main/containers/runner.test.ts` → FAIL.

- [ ] **Step 3: Implementierung**

```ts
import { execFile } from 'node:child_process';
import { Client } from 'ssh2';
import type { SshConnectionNode } from '../../shared/vault/types';
import { sshConnectConfig } from '../ssh/client-config';
import type { RunResult } from './parsers';

const OUTPUT_LIMIT = 1024 * 1024;
const CONNECT_TIMEOUT = 15_000;

/** Errors whose message is meant for the user. */
export class HostAccessError extends Error {}

export type VerifyHost = (host: string, port: number, key: Buffer, isActive: () => boolean) => Promise<boolean>;

export interface RemoteHost {
  run(command: string, timeoutMs: number): Promise<RunResult>;
  close(): void;
  readonly closed: boolean;
}

export async function openRemoteHost(connection: SshConnectionNode, verifyHost: VerifyHost, createClient = () => new Client()): Promise<RemoteHost> {
  const client = createClient();
  let closed = false;
  let rejectedKey = false;
  const { config, key } = await sshConnectConfig(connection, (hostKey, callback) => {
    void verifyHost(connection.host, connection.port, hostKey, () => !closed)
      .then(valid => { rejectedKey = !valid; callback(valid); })
      .catch(() => { rejectedKey = true; callback(false); });
  });
  config.readyTimeout = CONNECT_TIMEOUT;
  try {
    await new Promise<void>((resolve, reject) => {
      client.once('ready', resolve);
      client.once('error', error => reject(rejectedKey ? new HostAccessError('Der Server-Schlüssel wurde nicht bestätigt.') : error));
      client.connect(config);
    });
  } catch (error) { client.destroy(); throw error; }
  finally { key?.fill(0); }
  client.on('error', () => { closed = true; });
  client.on('close', () => { closed = true; });
  return {
    get closed() { return closed; },
    close() { closed = true; client.end(); },
    run(command, timeoutMs) {
      return new Promise((resolve, reject) => {
        client.exec(command, (error, stream) => {
          if (error) { reject(error); return; }
          let stdout = '', stderr = '', code: number | null = null, done = false;
          const finish = (result: RunResult): void => { if (!done) { done = true; clearTimeout(timer); resolve(result); } };
          const timer = setTimeout(() => { stream.close(); finish({ code: null, stdout, stderr, timedOut: true }); }, timeoutMs);
          stream.on('data', (chunk: Buffer) => { if (stdout.length < OUTPUT_LIMIT) stdout += chunk.toString('utf8'); });
          stream.stderr.on('data', (chunk: Buffer) => { if (stderr.length < OUTPUT_LIMIT) stderr += chunk.toString('utf8'); });
          stream.on('exit', (exitCode: number | null) => { code = exitCode; });
          stream.on('close', () => finish({ code, stdout, stderr }));
        });
      });
    },
  };
}

export function runLocal(file: string, args: string[], timeoutMs: number, exec: typeof execFile = execFile): Promise<RunResult> {
  return new Promise(resolve => {
    exec(file, args, { timeout: timeoutMs, maxBuffer: 4 * OUTPUT_LIMIT, windowsHide: true, encoding: 'utf8' }, (error, stdout, stderr) => {
      const failure = error as (NodeJS.ErrnoException & { killed?: boolean; code?: string | number }) | null;
      if (failure?.code === 'ENOENT') { resolve({ code: null, stdout: '', stderr: '', notFound: true }); return; }
      if (failure?.killed) { resolve({ code: null, stdout: String(stdout), stderr: String(stderr), timedOut: true }); return; }
      resolve({ code: failure ? (typeof failure.code === 'number' ? failure.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}
```

- [ ] **Step 4:** Test → PASS. Falls der Host-Key-Test statt `HostAccessError` einen ssh2-Fehler liefert: prüfen, ob `rejectedKey` vor dem `error`-Event gesetzt wird (ssh2 ruft den Verifier vor dem Abbruch auf), nicht die Assertion ändern.
- [ ] **Step 5: Commit** (`feat(containers): run commands over SSH exec and locally`)

---

### Task 4: ContainerDiscovery

**Files:**
- Create: `src/main/containers/discovery.ts`
- Test: `src/main/containers/discovery.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3, `publicError` aus `src/main/ssh/session.ts`.
- Produces:

```ts
export interface DiscoveryDependencies {
  getConnection: (id: string) => ConnectionNode;
  openRemote: (connection: SshConnectionNode) => Promise<RemoteHost>;
  runLocal: (file: string, args: string[], timeoutMs: number) => Promise<RunResult>;
  idleMs?: number;
}
export class ContainerDiscovery {
  constructor(dependencies: DiscoveryDependencies);
  list(hostId: ContainerHostId): Promise<DiscoveryResult>;
  action(hostId: ContainerHostId, target: ContainerTarget, action: ContainerAction): Promise<void>;
  closeAll(): void;
}
```

Fehler aus `list`/`action` sind immer `Error` mit deutscher, anzeigbarer Meldung.

- [ ] **Step 1: Failing Tests**

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SshConnectionNode } from '../../shared/vault/types';
import { LOCAL_CONTAINER_HOST } from '../../shared/containers';
import { ContainerDiscovery } from './discovery';
import type { RemoteHost } from './runner';
import type { RunResult } from './parsers';

const ok = (stdout: string): RunResult => ({ code: 0, stdout, stderr: '' });
const ssh = (overrides: Partial<SshConnectionNode> = {}): SshConnectionNode => ({ id: 'h1', type: 'connection', protocol: 'ssh', name: 'server01',
  host: 'server01', port: 22, username: 'admin', authentication: { method: 'agent' }, tags: [], ...overrides });

function fakeHost(answers: Record<string, RunResult>) {
  const commands: string[] = [];
  const host: RemoteHost & { commands: string[] } = { commands, closed: false,
    async run(command) { commands.push(command); return answers[command] ?? { code: 127, stdout: '', stderr: 'not found' }; },
    close() { (host as { closed: boolean }).closed = true; } };
  return host;
}

const P = 'PATH="$PATH:/usr/sbin:/sbin"';
const answers = {
  [`${P}; for c in docker podman pct qm; do command -v "$c" >/dev/null 2>&1 && echo "has:$c"; done; true`]: ok('has:docker\nhas:pct\nhas:qm\n'),
  [`${P} docker ps -a --no-trunc --format '{{json .}}'`]: ok('{"ID":"abc","Names":"web-1","Image":"nginx","State":"running"}\n'),
  [`${P} pct list`]: { code: 2, stdout: '', stderr: 'only root can run this command' },
  [`${P} qm list`]: { code: 2, stdout: '', stderr: 'only root can run this command' },
};

afterEach(() => vi.useRealTimers());

describe('ContainerDiscovery over SSH', () => {
  it('lists docker containers and reports Proxmox permission problems per runtime', async () => {
    const host = fakeHost(answers);
    const discovery = new ContainerDiscovery({ getConnection: () => ssh(), openRemote: async () => host, runLocal: vi.fn() });
    const result = await discovery.list('h1');
    expect(result.runtimes).toEqual(['docker', 'proxmox']);
    expect(result.items).toEqual([{ kind: 'container', runtime: 'docker', id: 'abc', ref: 'web-1', name: 'web-1', image: 'nginx', state: 'running' }]);
    expect(result.problems.proxmox).toContain('root');
  });
  it('prefixes sudo -n when the connection asks for it', async () => {
    const host = fakeHost({});
    const discovery = new ContainerDiscovery({ getConnection: () => ssh({ containers: { sudo: true } }), openRemote: async () => host, runLocal: vi.fn() });
    await discovery.action('h1', { kind: 'lxc', vmid: 101, name: 'ct' }, 'start').catch(() => {});
    expect(host.commands).toContain(`${P} sudo -n pct start 101`);
  });
  it('shares one connection between concurrent requests', async () => {
    const host = fakeHost(answers);
    const openRemote = vi.fn(async () => host);
    const discovery = new ContainerDiscovery({ getConnection: () => ssh(), openRemote, runLocal: vi.fn() });
    await Promise.all([discovery.list('h1'), discovery.list('h1')]);
    expect(openRemote).toHaveBeenCalledTimes(1);
  });
  it('reconnects when the saved connection changed', async () => {
    let current = ssh();
    const hosts = [fakeHost(answers), fakeHost(answers)];
    const openRemote = vi.fn(async () => hosts[openRemote.mock.calls.length - 1]);
    const discovery = new ContainerDiscovery({ getConnection: () => current, openRemote, runLocal: vi.fn() });
    await discovery.list('h1');
    current = ssh({ host: 'server02' });
    await discovery.list('h1');
    expect(openRemote).toHaveBeenCalledTimes(2);
    expect(hosts[0].closed).toBe(true);
  });
  it('closes an idle connection', async () => {
    vi.useFakeTimers();
    const host = fakeHost(answers);
    const discovery = new ContainerDiscovery({ getConnection: () => ssh(), openRemote: async () => host, runLocal: vi.fn(), idleMs: 60_000 });
    await discovery.list('h1');
    await vi.advanceTimersByTimeAsync(60_001);
    expect(host.closed).toBe(true);
  });
  it('throws a readable error for failed actions and rejects non-SSH hosts', async () => {
    const host = fakeHost({ [`${P} docker stop web-1`]: { code: 1, stdout: '', stderr: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock.' } });
    const discovery = new ContainerDiscovery({ getConnection: () => ssh(), openRemote: async () => host, runLocal: vi.fn() });
    await expect(discovery.action('h1', { kind: 'container', runtime: 'docker', ref: 'web-1', name: 'web-1' }, 'stop')).rejects.toThrow('Der Docker-Dienst läuft nicht.');
    const rdp = new ContainerDiscovery({ getConnection: () => ({ ...ssh(), protocol: 'rdp' }) as never, openRemote: vi.fn(), runLocal: vi.fn() });
    await expect(rdp.list('h1')).rejects.toThrow('nur für SSH-Verbindungen');
  });
});

describe('ContainerDiscovery on this computer', () => {
  it('skips missing programs and lists the installed ones', async () => {
    const runLocal = vi.fn(async (file: string) => file === 'docker'
      ? ok('{"ID":"abc","Names":"web-1","Image":"nginx","State":"exited"}\n')
      : { code: null, stdout: '', stderr: '', notFound: true });
    const discovery = new ContainerDiscovery({ getConnection: vi.fn(), openRemote: vi.fn(), runLocal });
    const result = await discovery.list(LOCAL_CONTAINER_HOST);
    expect(result.runtimes).toEqual(['docker']);
    expect(result.items[0]).toMatchObject({ ref: 'web-1', state: 'stopped' });
    expect(runLocal).toHaveBeenCalledWith('docker', ['ps', '-a', '--no-trunc', '--format', '{{json .}}'], 15_000);
  });
  it('refuses Proxmox actions locally', async () => {
    const discovery = new ContainerDiscovery({ getConnection: vi.fn(), openRemote: vi.fn(), runLocal: vi.fn() });
    await expect(discovery.action(LOCAL_CONTAINER_HOST, { kind: 'vm', vmid: 100, name: 'x' }, 'start')).rejects.toThrow('Proxmox');
  });
});
```

- [ ] **Step 2:** `npx vitest run src/main/containers/discovery.test.ts` → FAIL.

- [ ] **Step 3: Implementierung**

```ts
import { LOCAL_CONTAINER_HOST } from '../../shared/containers';
import type { ContainerAction, ContainerHostId, ContainerRuntime, ContainerTarget, DiscoveredItem, DiscoveryResult, RuntimeKind } from '../../shared/containers';
import type { ConnectionNode, SshConnectionNode } from '../../shared/vault/types';
import { publicError } from '../ssh/session';
import { actionArgv, ContainerInputError, listArgv, PROBE_SCRIPT, remoteCommand } from './commands';
import { describeFailure, parseContainerList, parsePctList, parseProbe, parseQmList } from './parsers';
import type { RunResult } from './parsers';
import { HostAccessError } from './runner';
import type { RemoteHost } from './runner';

const LIST_TIMEOUT = 15_000;
const ACTION_TIMEOUT = 120_000;

export interface DiscoveryDependencies {
  getConnection: (id: string) => ConnectionNode;
  openRemote: (connection: SshConnectionNode) => Promise<RemoteHost>;
  runLocal: (file: string, args: string[], timeoutMs: number) => Promise<RunResult>;
  idleMs?: number;
}

interface CachedHost { fingerprint: string; host: Promise<RemoteHost>; timer?: ReturnType<typeof setTimeout> }

const fingerprint = (connection: SshConnectionNode): string =>
  JSON.stringify([connection.host, connection.port, connection.username, connection.authentication]);

function readable(error: unknown): Error {
  if (error instanceof HostAccessError || error instanceof ContainerInputError) return error;
  return new Error(publicError(error));
}

const kindOf = (target: ContainerTarget): RuntimeKind => target.kind === 'container' ? target.runtime : 'proxmox';

export class ContainerDiscovery {
  private hosts = new Map<string, CachedHost>();
  constructor(private readonly dependencies: DiscoveryDependencies) {}

  async list(hostId: ContainerHostId): Promise<DiscoveryResult> {
    if (hostId === LOCAL_CONTAINER_HOST) return this.listLocal();
    const connection = this.sshConnection(hostId);
    try {
      const host = await this.remote(connection);
      const sudo = connection.containers?.sudo === true;
      const tools = parseProbe((await host.run(PROBE_SCRIPT, LIST_TIMEOUT)).stdout);
      const result: DiscoveryResult = { runtimes: [], items: [], problems: {} };
      for (const runtime of ['docker', 'podman'] as const) {
        if (!tools.has(runtime)) continue;
        result.runtimes.push(runtime);
        this.collect(result, runtime, await host.run(remoteCommand(listArgv(runtime), sudo), LIST_TIMEOUT), text => parseContainerList(runtime, text));
      }
      if (tools.has('pct') || tools.has('qm')) {
        result.runtimes.push('proxmox');
        if (tools.has('pct')) this.collect(result, 'proxmox', await host.run(remoteCommand(listArgv('lxc'), sudo), LIST_TIMEOUT), parsePctList);
        if (tools.has('qm')) this.collect(result, 'proxmox', await host.run(remoteCommand(listArgv('vm'), sudo), LIST_TIMEOUT), parseQmList);
      }
      return result;
    } catch (error) { throw readable(error); }
  }

  async action(hostId: ContainerHostId, target: ContainerTarget, action: ContainerAction): Promise<void> {
    const argv = actionArgv(target, action);
    let result: RunResult;
    if (hostId === LOCAL_CONTAINER_HOST) {
      if (target.kind !== 'container') throw new ContainerInputError('Proxmox gibt es nur auf entfernten Hosts.');
      result = await this.dependencies.runLocal(argv[0], argv.slice(1), ACTION_TIMEOUT);
    } else {
      const connection = this.sshConnection(hostId);
      try { result = await (await this.remote(connection)).run(remoteCommand(argv, connection.containers?.sudo === true), ACTION_TIMEOUT); }
      catch (error) { throw readable(error); }
    }
    if (result.code !== 0) throw new Error(result.notFound ? `${argv[0]} ist nicht installiert.` : describeFailure(kindOf(target), result));
  }

  closeAll(): void {
    for (const [id, cached] of this.hosts) { clearTimeout(cached.timer); this.hosts.delete(id); void cached.host.then(host => host.close(), () => {}); }
  }

  private async listLocal(): Promise<DiscoveryResult> {
    const result: DiscoveryResult = { runtimes: [], items: [], problems: {} };
    for (const runtime of ['docker', 'podman'] as const) {
      const argv = listArgv(runtime);
      const run = await this.dependencies.runLocal(argv[0], argv.slice(1), LIST_TIMEOUT);
      if (run.notFound) continue;
      result.runtimes.push(runtime);
      this.collect(result, runtime, run, text => parseContainerList(runtime, text));
    }
    return result;
  }

  private collect(result: DiscoveryResult, kind: RuntimeKind, run: RunResult, parse: (text: string) => DiscoveredItem[]): void {
    if (run.code === 0) result.items.push(...parse(run.stdout));
    else result.problems[kind] ??= describeFailure(kind, run);
  }

  private sshConnection(hostId: string): SshConnectionNode {
    const connection = this.dependencies.getConnection(hostId);
    if (connection.protocol !== 'ssh') throw new ContainerInputError('Container gibt es nur für SSH-Verbindungen.');
    if (!connection.host.trim() || !connection.username?.trim()) throw new ContainerInputError('Bitte speichere Host und Benutzername der Verbindung.');
    return connection;
  }

  /** One cached connection per host; replaced when the saved connection changes, closed when idle. */
  private async remote(connection: SshConnectionNode): Promise<RemoteHost> {
    const print = fingerprint(connection);
    let cached = this.hosts.get(connection.id);
    if (cached && cached.fingerprint !== print) { this.drop(connection.id, cached); cached = undefined; }
    if (cached) {
      const host = await cached.host.catch(() => undefined);
      if (host?.closed) { this.drop(connection.id, cached); cached = undefined; }
    }
    if (!cached) {
      const opened = this.dependencies.openRemote(connection);
      cached = { fingerprint: print, host: opened };
      this.hosts.set(connection.id, cached);
      opened.catch(() => { if (this.hosts.get(connection.id) === cached) this.hosts.delete(connection.id); });
    }
    const entry = cached;
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => this.drop(connection.id, entry), this.dependencies.idleMs ?? 60_000);
    return entry.host;
  }

  private drop(id: string, cached: CachedHost): void {
    clearTimeout(cached.timer);
    if (this.hosts.get(id) === cached) this.hosts.delete(id);
    void cached.host.then(host => host.close(), () => {});
  }
}
```

Hinweis: `drop` schließt asynchron über `.then`, deshalb nutzt der Leerlauf-Test `advanceTimersByTimeAsync`.

Hinweis zum `SshConnectionNode.containers`-Feld: Das wird erst in Task 7 eingeführt. Damit `npm run typecheck` hier schon grün ist, das Feld in diesem Task bereits in `src/shared/vault/types.ts` am `SshConnectionNode` ergänzen:

```ts
  /** Container discovery and tabs; see docs/superpowers/specs/2026-10-14-container-integration-design.md. */
  containers?: { sudo?: boolean };
```

(Task 7 ergänzt Schema und Formular.)

- [ ] **Step 4:** `npx vitest run src/main/containers` → PASS.
- [ ] **Step 5: Commit** (`feat(containers): discover containers per host with a cached connection`)

---

### Task 5: IPC, Preload und Main-Verdrahtung

**Files:**
- Create: `src/main/containers/validation.ts` (Schemas ohne Electron-Import, damit testbar)
- Create: `src/main/containers/ipc.ts`
- Test: `src/main/containers/validation.test.ts`
- Modify: `src/shared/ipc.ts` (Kanäle + `DesktopApi`), `src/preload/index.ts`, `src/main/index.ts:27-37,175-176`

**Interfaces:**
- Consumes: `ContainerDiscovery`, `openRemoteHost`, `runLocal`, `ContainerTargetSchema`, `requireSshSender`, `findConnection`, `vaultSessionManager`, `KnownHosts`.
- Produces: `ListRequestSchema`, `ActionRequestSchema` (in `validation.ts`), `registerContainerIpcHandlers(knownHosts): ContainerDiscovery`; `DesktopApi.containersList({ hostId }): Promise<DiscoveryResult>`, `DesktopApi.containersAction({ hostId, target, action }): Promise<void>`; Kanäle `containers:list`, `containers:action`.

- [ ] **Step 1: Failing Test für die Schemas** (`src/main/containers/validation.test.ts`)

```ts
import { describe, expect, it } from 'vitest';
import { ActionRequestSchema, ListRequestSchema } from './validation';

describe('container IPC validation', () => {
  it('accepts valid requests', () => {
    expect(ListRequestSchema.safeParse({ hostId: 'h1' }).success).toBe(true);
    expect(ActionRequestSchema.safeParse({ hostId: 'h1', target: { kind: 'lxc', vmid: 101, name: 'ct' }, action: 'shutdown' }).success).toBe(true);
  });
  it('rejects command text, unknown actions and extra fields', () => {
    expect(ActionRequestSchema.safeParse({ hostId: 'h1', target: { kind: 'container', runtime: 'docker', ref: 'a; rm -rf /', name: 'a' }, action: 'stop' }).success).toBe(false);
    expect(ActionRequestSchema.safeParse({ hostId: 'h1', target: { kind: 'vm', vmid: 100, name: 'x' }, action: 'exec' }).success).toBe(false);
    expect(ListRequestSchema.safeParse({ hostId: 'h1', command: 'id' }).success).toBe(false);
  });
});
```


- [ ] **Step 2:** Test → FAIL.

- [ ] **Step 3: `src/main/containers/validation.ts`**

```ts
import { z } from 'zod';
import { ContainerTargetSchema } from '../../shared/containers-schema';

const hostId = z.string().min(1).max(256);
export const ListRequestSchema = z.object({ hostId }).strict();
export const ActionRequestSchema = z.object({ hostId, target: ContainerTargetSchema, action: z.enum(['start', 'stop', 'restart', 'shutdown']) }).strict();
```

`src/main/containers/ipc.ts`:

```ts
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc';
import { vaultSessionManager } from '../vault/ipc';
import type { KnownHosts } from '../ssh/known-hosts';
import { requireSshSender } from '../ssh/ipc';
import { findConnection } from '../ssh/session';
import { parseRequest } from '../ssh/validation';
import { ContainerDiscovery } from './discovery';
import { openRemoteHost, runLocal } from './runner';
import { ActionRequestSchema, ListRequestSchema } from './validation';

export function registerContainerIpcHandlers(knownHosts: KnownHosts): ContainerDiscovery {
  const discovery = new ContainerDiscovery({
    getConnection: id => {
      const connection = findConnection(vaultSessionManager.getSnapshot().vault.nodes, id);
      if (!connection) throw new Error('Die Verbindung wurde nicht gefunden.');
      return connection;
    },
    openRemote: connection => openRemoteHost(connection, (host, port, key, isActive) => knownHosts.verify(host, port, key, isActive)),
    runLocal: (file, args, timeoutMs) => runLocal(file, args, timeoutMs),
  });
  ipcMain.handle(IPC_CHANNELS.containersList, (event, request: unknown) => {
    requireSshSender(event);
    return discovery.list(parseRequest(ListRequestSchema, request).hostId);
  });
  ipcMain.handle(IPC_CHANNELS.containersAction, (event, request: unknown) => {
    requireSshSender(event);
    const parsed = parseRequest(ActionRequestSchema, request);
    return discovery.action(parsed.hostId, parsed.target, parsed.action);
  });
  return discovery;
}
```

Hinweis: `requireSshSender` aus `src/main/ssh/ipc.ts` zu importieren, ist ein Zyklus (`ssh/ipc` importiert nichts aus `containers`), also unkritisch.

- [ ] **Step 4: Kanäle und API** in `src/shared/ipc.ts`:
  - In `IPC_CHANNELS` nach `connectionTest`: `containersList: 'containers:list', containersAction: 'containers:action',`
  - Import: `import type { ContainerAction, ContainerHostId, ContainerTarget, DiscoveryResult } from './containers';`
  - In `DesktopApi` nach `connectionTest`:

```ts
  /** Lists containers and Proxmox guests of an SSH connection or of this computer; always fresh. */
  containersList: (request: { hostId: ContainerHostId }) => Promise<DiscoveryResult>;
  containersAction: (request: { hostId: ContainerHostId; target: ContainerTarget; action: ContainerAction }) => Promise<void>;
```

- [ ] **Step 5: Preload** (`src/preload/index.ts`, nach `connectionTest`):

```ts
  containersList: request => ipcRenderer.invoke('containers:list', request),
  containersAction: request => ipcRenderer.invoke('containers:action', request),
```

- [ ] **Step 6: Main** (`src/main/index.ts`):
  - Import: `import { registerContainerIpcHandlers } from './containers/ipc';` und `import type { ContainerDiscovery } from './containers/discovery';`
  - Neben `let sshSessionManager`: `let containerDiscovery: ContainerDiscovery | undefined;`
  - In `closeAllSessions` (Zeile 37) ergänzen: `containerDiscovery?.closeAll();`
  - Nach Zeile 176: `containerDiscovery = registerContainerIpcHandlers(knownHosts);`

- [ ] **Step 7:** `npx vitest run src/main/containers && npm run typecheck` → PASS.
- [ ] **Step 8: Commit** (`feat(containers): expose discovery and actions over IPC`)

---

### Task 6: Terminal-Sessions mit Ziel

**Files:**
- Modify: `src/shared/ssh.ts`, `src/main/ssh/validation.ts`, `src/main/ssh/session.ts`
- Test: `src/main/ssh/session.test.ts`, `src/main/ssh/validation.test.ts`

**Interfaces:**
- Consumes: `TerminalTarget`, `LOCAL_CONTAINER_HOST`, `TerminalTargetSchema`, `terminalArgv`, `remoteCommand`.
- Produces: `SshPrepareRequest.target?: TerminalTarget`; exportierte Hilfsfunktion `targetExitMessage(target, code, tail): string | undefined`.

- [ ] **Step 1: Failing Tests.** In `session.test.ts` im bestehenden `beforeEach` den Server um einen `exec`-Handler erweitern. Im `session`-Callback neben `session.on('shell', …)`:

```ts
      session.on('exec', (acceptExec, _reject, info) => {
        execCommands.push(info.command);
        const stream = acceptExec();
        stream.on('error', () => {});
        if (info.command.includes('missing')) { stream.stderr.write('Error response from daemon: No such container: missing\r\n'); stream.exit(1); stream.end(); return; }
        stream.write('exec-ready\r\n');
        stream.on('data', (data: Buffer) => { stream.write(data); });
      });
```

Oben `let execCommands: string[];` deklarieren und in `beforeEach` auf `[]` setzen. Neue Tests im ersten `describe`:

```ts
  const web = { kind: 'container' as const, runtime: 'docker' as const, ref: 'web-1', name: 'web-1' };

  it('opens a container shell through exec with a pseudo terminal', async () => {
    const id = manager.prepare(1, { connectionId: connection.id, cols: 90, rows: 30, target: { item: web, mode: 'shell' } }).sessionId;
    await manager.connect(1, id);
    await waitFor(() => output().includes('exec-ready'));
    expect(execCommands).toEqual([`PATH="$PATH:/usr/sbin:/sbin" docker exec -it web-1 sh -c 'command -v bash >/dev/null 2>&1 && exec bash || exec sh'`]);
    expect(size).toMatchObject({ cols: 90, rows: 30, term: 'xterm-256color' });
    await manager.input(1, id, 'ls\r');
    await waitFor(() => output().includes('ls'));
    expect(shells).toHaveLength(0);
  });

  it('uses sudo -n when the connection asks for it', async () => {
    connection = { ...connection, containers: { sudo: true } };
    const id = manager.prepare(1, { connectionId: connection.id, cols: 80, rows: 24, target: { item: { kind: 'lxc', vmid: 101, name: 'ct' }, mode: 'shell' } }).sessionId;
    await manager.connect(1, id);
    await waitFor(() => execCommands.length === 1);
    expect(execCommands[0]).toBe('PATH="$PATH:/usr/sbin:/sbin" sudo -n pct enter 101');
  });

  it('reports a missing container when the command fails', async () => {
    const id = manager.prepare(1, { connectionId: connection.id, cols: 80, rows: 24, target: { item: { ...web, ref: 'missing', name: 'missing' }, mode: 'shell' } }).sessionId;
    await manager.connect(1, id);
    await waitFor(() => hasStatus('error'));
    expect(events).toContainEqual(expect.objectContaining({ type: 'status', status: 'error', message: 'Container „missing“ wurde nicht gefunden.' }));
  });

  it('rejects invalid targets before connecting', () => {
    expect(() => manager.prepare(1, { connectionId: connection.id, cols: 80, rows: 24, target: { item: { ...web, ref: '$(id)' }, mode: 'shell' } })).toThrow('Ungültige Container-Angabe.');
    expect(() => manager.prepare(1, { connectionId: LOCAL_CONTAINER_HOST, cols: 80, rows: 24 })).toThrow();
  });
```

Imports ergänzen: `import { LOCAL_CONTAINER_HOST } from '../../shared/containers';` Außerdem ein neues `describe` für reine Logik:

```ts
describe('targetExitMessage', () => {
  const web = { kind: 'container' as const, runtime: 'docker' as const, ref: 'web-1', name: 'web-1' };
  it('explains failed container commands', () => {
    expect(targetExitMessage({ item: web, mode: 'shell' }, 0, '')).toBeUndefined();
    expect(targetExitMessage({ item: web, mode: 'shell' }, 127, '')).toBe('Keine Shell im Container gefunden.');
    expect(targetExitMessage({ item: web, mode: 'logs' }, 1, 'No such container: web-1')).toBe('Container „web-1“ wurde nicht gefunden.');
    expect(targetExitMessage({ item: { kind: 'vm', vmid: 100, name: 'w' }, mode: 'shell' }, 255, 'unable to find a serial interface')).toContain('Serielle Schnittstelle');
    expect(targetExitMessage({ item: web, mode: 'shell' }, 130, '')).toBeUndefined();
  });
});
```

und ein `describe` für lokale Container mit Fake-pty (nur unter Windows, wie `startLocalShell`):

```ts
describe.runIf(process.platform === 'win32')('local container tabs', () => {
  it('starts docker exec through node-pty with an argument array', async () => {
    const spawned: { file: string; args: string[] | string }[] = [];
    const localEvents: SshEvent[] = [];
    let exit: ((event: { exitCode: number }) => void) | undefined;
    const pty = { onData: () => ({ dispose() {} }), onExit: (listener: typeof exit) => { exit = listener; return { dispose() {} }; },
      write() {}, resize() {}, kill() {}, pause() {}, resume() {} };
    const local = new SshSessionManager({ getConnection: () => { throw new Error('no vault lookups'); },
      verifyHost: async () => true, locate: async command => `C:\\bin\\${command}.exe`, emit: (_owner, event) => localEvents.push(event),
      spawnShell: (file, args) => { spawned.push({ file, args }); return pty as never; } });
    const id = local.prepare(1, { connectionId: LOCAL_CONTAINER_HOST, cols: 80, rows: 24, target: { item: { kind: 'container', runtime: 'docker', ref: 'web-1', name: 'web-1' }, mode: 'shell' } }).sessionId;
    await local.connect(1, id);
    expect(spawned).toEqual([{ file: 'C:\\bin\\docker.exe', args: ['exec', '-it', 'web-1', 'sh', '-c', 'command -v bash >/dev/null 2>&1 && exec bash || exec sh'] }]);
    exit?.({ exitCode: 127 });
    expect(localEvents).toContainEqual(expect.objectContaining({ status: 'error', message: 'Keine Shell im Container gefunden.' }));
  });
});
```

In `validation.test.ts` ergänzen:

```ts
it('accepts an optional container target and rejects malformed ones', () => {
  const base = { connectionId: 'c1', cols: 80, rows: 24 };
  expect(PrepareSchema.safeParse({ ...base, target: { item: { kind: 'lxc', vmid: 101, name: 'ct' }, mode: 'shell' } }).success).toBe(true);
  expect(PrepareSchema.safeParse({ ...base, target: { item: { kind: 'lxc', vmid: 101, name: 'ct' }, mode: 'exec' } }).success).toBe(false);
  expect(PrepareSchema.safeParse({ ...base, target: { item: { kind: 'container', runtime: 'docker', ref: 'a b', name: 'a' }, mode: 'shell' } }).success).toBe(false);
});
```

- [ ] **Step 2:** `npx vitest run src/main/ssh` → neue Tests FAIL.

- [ ] **Step 3: Request und Schema**
  - `src/shared/ssh.ts`: `import type { TerminalTarget } from './containers';` und `export interface SshPrepareRequest extends TerminalSize { connectionId: string; target?: TerminalTarget }`
  - `src/main/ssh/validation.ts`: `import { TerminalTargetSchema } from '../../shared/containers-schema';` und `PrepareSchema = z.object({ connectionId: z.string().min(1).max(256), target: TerminalTargetSchema.optional(), ...size }).strict();`

- [ ] **Step 4: Session-Manager** (`src/main/ssh/session.ts`)
  - Imports: `LOCAL_CONTAINER_HOST`, `type TerminalTarget` aus `../../shared/containers`; `remoteCommand`, `terminalArgv`, `ContainerInputError` aus `../containers/commands`.
  - `Session` ergänzen: `target?: TerminalTarget; exitCode?: number | null; tail?: string;`
  - `publicError`: `ContainerInputError` wie `LocalShellError` durchreichen: `if (error instanceof HostKeyError || error instanceof LocalShellError || error instanceof ContainerInputError) return error.message;`
  - Neue exportierte Funktion:

```ts
/** Why a container tab ended; undefined when the output already says enough. */
export function targetExitMessage(target: TerminalTarget, code: number | null | undefined, tail: string): string | undefined {
  if (code === undefined || code === null || code === 0) return undefined;
  if (/No such container/i.test(tail)) return `Container „${target.item.name}“ wurde nicht gefunden.`;
  if (target.item.kind === 'container' && target.mode === 'shell' && (code === 126 || code === 127)) return 'Keine Shell im Container gefunden.';
  if (target.item.kind === 'vm') return 'Die serielle Konsole ist nicht verfügbar. Serielle Schnittstelle in der VM-Hardware hinzufügen.';
  return undefined;
}
```

  - `prepare` ersetzen bis vor `const id = randomUUID();`:

```ts
    if (this.sessions.size >= MAX_SSH_SESSIONS) throw new Error(`Maximal ${MAX_SSH_SESSIONS} Terminal-Sessions gleichzeitig. Schließe zuerst einen Tab.`);
    const local = request.connectionId === LOCAL_CONTAINER_HOST;
    if (local && !request.target) throw new Error('Die Verbindung wurde nicht gefunden.');
    const connection = local ? undefined : this.dependencies.getConnection(request.connectionId);
    if (connection?.protocol === 'rdp' || connection?.protocol === 'sftp') throw new Error('Diese Verbindung ist keine Terminalverbindung.');
    if (connection && request.target && connection.protocol !== 'ssh') throw new Error('Container-Tabs gibt es nur für SSH-Verbindungen.');
    if (connection?.protocol === 'ssh' && (!connection.host.trim() || !connection.username?.trim())) {
      throw new Error('Bitte speichere Host und Benutzername, bevor du die Verbindung startest.');
    }
    // Validates the target now so the tab fails before any connection is made.
    if (request.target) terminalArgv(request.target);
```

  - Im Session-Literal `...(request.target ? { target: request.target, tail: '' } : {})` ergänzen. `if (connection.protocol === 'ssh')` → `if (connection?.protocol === 'ssh')`.
  - `connect`: als erste Zeile im `try`:

```ts
      if (session.connectionId === LOCAL_CONTAINER_HOST) { await this.startLocalContainer(session); return; }
```

  - Im `ready`-Handler den `client.shell(...)`-Callback in eine private Methode `private attachStream(session: Session, error: Error | undefined, stream: ClientChannel | undefined): void` auslagern (Inhalt unverändert, plus für Ziele `stream.on('exit', (code: number | null) => { session.exitCode = code; });` und `stream.on('close', () => this.ended(session))` statt `this.finish(session, 'closed')`). Dann:

```ts
      client.once('ready', () => {
        this.clearKey(session);
        const pty = { term: 'xterm-256color', cols: session.size.cols, rows: session.size.rows };
        const attach = (error: Error | undefined, stream: ClientChannel) => this.attachStream(session, error, stream);
        if (session.target) client.exec(remoteCommand(terminalArgv(session.target), connection.containers?.sudo === true), { pty }, attach);
        else client.shell(pty, attach);
      });
```

  - Neue Methoden:

```ts
  private ended(session: Session): void {
    const message = session.target ? targetExitMessage(session.target, session.exitCode, session.tail ?? '') : undefined;
    this.finish(session, message ? 'error' : 'closed', message);
  }

  private async startLocalContainer(session: Session): Promise<void> {
    if (process.platform !== 'win32') throw new LocalShellError('Lokale Container-Tabs sind nur unter Windows verfügbar.');
    const target = session.target!;
    if (target.item.kind !== 'container') throw new LocalShellError('Proxmox gibt es nur auf entfernten Hosts.');
    const argv = terminalArgv(target);
    const file = await (this.dependencies.locate ?? locateCommand)(argv[0]);
    if (!file) throw new LocalShellError(`${argv[0]} ist nicht installiert oder nicht im PATH.`);
    if (!this.active(session)) return;
    let pty: IPty;
    try {
      pty = this.dependencies.spawnShell(file, argv.slice(1), { name: 'xterm-256color', cols: session.size.cols, rows: session.size.rows,
        cwd: homedir(), env: shellEnvironment(), useConpty: true });
    } catch { throw new LocalShellError(`${argv[0]} konnte nicht gestartet werden.`); }
    session.pty = pty;
    session.phase = 'connected';
    pty.onData(data => this.output(session, Buffer.from(data, 'utf8')));
    pty.onExit(({ exitCode }) => { session.exitCode = exitCode; this.ended(session); });
    this.status(session, 'connected');
  }
```

  - In `output()` nach der Aktiv-Prüfung: `if (session.target) session.tail = ((session.tail ?? '') + chunk.toString('utf8')).slice(-2048);`

- [ ] **Step 5:** `npx vitest run src/main/ssh` → PASS (alte und neue Tests).
- [ ] **Step 6:** `npm run typecheck` → PASS.
- [ ] **Step 7: Commit** (`feat(ssh): open container shells and logs as terminal sessions`)

---

### Task 7: sudo-Einstellung im Vault und Formular

**Files:**
- Modify: `src/shared/vault/schema.ts` (`SshConnectionNodeSchema`), `src/renderer/src/connection-form.ts`, `src/renderer/src/components/ConnectionForm.tsx`
- Test: `src/renderer/src/connection-form.test.ts`, ggf. `src/shared/vault/schema.test.ts` (falls vorhanden, sonst im Formular-Test abgedeckt)

**Interfaces:**
- Consumes: `SshConnectionNode.containers` (in Task 4 angelegt).
- Produces: `ConnectionFields.containerSudo: 'on' | 'off'`.

- [ ] **Step 1: Failing Test** (`connection-form.test.ts`)

```ts
it('keeps the container sudo option of SSH connections', () => {
  const fields = { ...fieldsFromConnection('ssh'), name: 'srv', host: 'srv', username: 'root', containerSudo: 'on' as const };
  const node = connectionFromFields('id1', fields, 'ssh');
  expect(node).toMatchObject({ protocol: 'ssh', containers: { sudo: true } });
  expect(fieldsFromConnection('ssh', node).containerSudo).toBe('on');
  expect(connectionFromFields('id1', { ...fields, containerSudo: 'off' }, 'ssh')).not.toHaveProperty('containers');
});
```

(Imports `connectionFromFields`, `fieldsFromConnection` sind dort schon vorhanden; falls nicht, ergänzen.)

- [ ] **Step 2:** `npx vitest run src/renderer/src/connection-form.test.ts` → FAIL.
- [ ] **Step 3: Implementierung**
  - `schema.ts`, in `SshConnectionNodeSchema` nach `authentication`: `containers: z.object({ sudo: z.boolean().optional() }).optional(),`
  - `connection-form.ts`:
    - `ConnectionFields`: `/** SSH only: run container commands with sudo -n. */ containerSudo: 'on' | 'off';`
    - Default in `fieldsFromConnection`: `containerSudo: 'off'` und im SSH-Zweig: `if (connection?.protocol === 'ssh') fields.containerSudo = connection.containers?.sudo ? 'on' : 'off';`
    - In `connectionFromFields`, SSH/SFTP-Zweig: `node = { ...base, protocol, ...target, authentication, ...(protocol === 'ssh' && fields.containerSudo === 'on' ? { containers: { sudo: true } } : {}) };`
  - `ConnectionForm.tsx`, direkt nach dem `{fields.method === 'privateKey' && <>…</>}`-Block, noch innerhalb von `{sshAuth && <>…</>}`:

```tsx
        {protocol === 'ssh' && <label className="editor-checkbox"><input type="checkbox" checked={fields.containerSudo === 'on'} disabled={busy}
          onChange={event => setField('containerSudo', event.target.checked ? 'on' : 'off')} />Container-Befehle mit sudo ausführen</label>}
```

- [ ] **Step 4:** `npx vitest run src/renderer/src/connection-form.test.ts && npm run typecheck` → PASS (Typecheck findet weitere Stellen, die `ConnectionFields` als Literal bauen; dort `containerSudo: 'off'` ergänzen).
- [ ] **Step 5: Commit** (`feat(connections): add option to run container commands with sudo`)

---

### Task 8: Tabs mit Ziel und Workspaces

**Files:**
- Modify: `src/shared/windows.ts:7-11`, `src/main/window-ipc.ts:19-22`, `src/renderer/src/terminal-tabs.ts`, `src/renderer/src/terminal-layout.ts:153-180`, `src/renderer/src/components/TerminalPanel.tsx:150`, `src/shared/vault/types.ts` (`WorkspacePane`), `src/shared/vault/schema.ts` (`WorkspacePaneSchema`)
- Test: `src/renderer/src/terminal-tabs.test.ts`, `src/renderer/src/terminal-layout.test.ts`

**Interfaces:**
- Consumes: `TerminalTarget`, `targetKey`, `LOCAL_CONTAINER_HOST`, `TerminalTargetSchema`, `ContainerTargetSchema`.
- Produces: `TabConnection.target?: TerminalTarget`; `containerConnection(hostId: string, hostName: string, address: string, target: TerminalTarget): TerminalConnection`; `containerTabName(target, hostName): string`; `WorkspaceContainerTab { index: number; target: ContainerTarget; mode: TerminalTargetMode }`.

- [ ] **Step 1: Failing Tests**

In `terminal-tabs.test.ts`:

```ts
import { LOCAL_CONTAINER_HOST } from '../../shared/containers';
import { containerConnection, containerTabName, sameTarget, terminalTabsReducer, emptyTerminalTabs } from './terminal-tabs';

const shell = { item: { kind: 'container' as const, runtime: 'docker' as const, ref: 'web-1', name: 'web-1' }, mode: 'shell' as const };

describe('container tabs', () => {
  it('names tabs after the container and the host', () => {
    expect(containerTabName(shell, 'server01')).toBe('web-1 @ server01');
    expect(containerTabName({ ...shell, mode: 'logs' }, 'server01')).toBe('Logs: web-1 @ server01');
    expect(containerTabName({ item: { kind: 'lxc', vmid: 101, name: 'ct-web' }, mode: 'shell' }, 'pve1')).toBe('CT 101 ct-web @ pve1');
    expect(containerTabName({ item: { kind: 'vm', vmid: 100, name: 'win11' }, mode: 'shell' }, 'pve1')).toBe('VM 100 win11 @ pve1');
  });
  it('keeps the target when opening and tells targets apart', () => {
    const tab = containerConnection('h1', 'server01', 'admin@server01', shell);
    const state = terminalTabsReducer(emptyTerminalTabs, { type: 'open', id: 't1', connection: tab });
    expect(state.tabs[0].connection.target).toEqual(shell);
    expect(sameTarget(tab, containerConnection('h1', 'server01', 'admin@server01', { ...shell, mode: 'logs' }))).toBe(false);
    expect(sameTarget(tab, { id: 'h1', name: 'server01', protocol: 'ssh', address: 'admin@server01' })).toBe(false);
  });
  it('keeps local container tabs when the vault changes', () => {
    const local = containerConnection(LOCAL_CONTAINER_HOST, 'Dieser Computer', 'lokal', shell);
    let state = terminalTabsReducer(emptyTerminalTabs, { type: 'open', id: 't1', connection: local });
    state = terminalTabsReducer(state, { type: 'retainConnections', connectionIds: [] });
    expect(state.tabs).toHaveLength(1);
  });
});
```

In `terminal-layout.test.ts` (vorhandene Helfer zum Bauen von `LiveLayout` nutzen; ansonsten wie hier inline):

```ts
import { LOCAL_CONTAINER_HOST } from '../../shared/containers';
import { containerConnection } from './terminal-tabs';

describe('workspaces with container tabs', () => {
  const host = { id: 'h1', type: 'connection', protocol: 'ssh', name: 'server01', host: 'server01', port: 22, username: 'admin', authentication: { method: 'agent' }, tags: [] } as const;
  const shell = { item: { kind: 'container' as const, runtime: 'docker' as const, ref: 'web-1', name: 'web-1' }, mode: 'shell' as const };
  it('saves remote container tabs and restores them as container tabs; drops local ones', () => {
    const tabs = [
      { id: 'a', connection: { id: 'h1', name: 'server01', protocol: 'ssh' as const, address: 'admin@server01' }, ordinal: 1, status: 'connected' as const },
      { id: 'b', connection: containerConnection('h1', 'server01', 'admin@server01', shell), ordinal: 1, status: 'connected' as const },
      { id: 'c', connection: containerConnection(LOCAL_CONTAINER_HOST, 'Dieser Computer', 'lokal', shell), ordinal: 1, status: 'connected' as const },
    ];
    const saved = savedLayout({ type: 'pane', id: 'p', tabIds: ['a', 'b', 'c'], activeTabId: 'b' }, tabs);
    expect(saved).toEqual({ type: 'pane', connectionIds: ['h1', 'h1'], activeConnectionId: 'h1', containerTabs: [{ index: 1, target: shell.item, mode: 'shell' }] });
    let n = 0;
    const restored = restoreLayout(saved, id => id === 'h1' ? host as never : undefined, () => `u${++n}`);
    expect(restored.tabs.map(tab => tab.connection.target)).toEqual([undefined, shell]);
    expect(restored.tabs[1].connection.name).toBe('web-1 @ server01');
  });
});
```

- [ ] **Step 2:** `npx vitest run src/renderer/src/terminal-tabs.test.ts src/renderer/src/terminal-layout.test.ts` → FAIL.

- [ ] **Step 3: Implementierung**
  - `src/shared/windows.ts`: `import type { TerminalTarget } from './containers';` und in `TabConnection`: `/** Container or Proxmox guest on the host `id`. */ target?: TerminalTarget;`
  - `src/main/window-ipc.ts`, `TabConnectionSchema`: `target: TerminalTargetSchema.optional(),` (Import aus `../shared/containers-schema`).
  - `src/renderer/src/terminal-tabs.ts`:

```ts
import { LOCAL_CONTAINER_HOST, targetKey } from '../../shared/containers';
import type { TerminalTarget } from '../../shared/containers';

export function containerTabName(target: TerminalTarget, hostName: string): string {
  const item = target.item;
  const label = item.kind === 'container' ? item.name : `${item.kind === 'lxc' ? 'CT' : 'VM'} ${item.vmid} ${item.name}`;
  return `${target.mode === 'logs' ? 'Logs: ' : ''}${label} @ ${hostName}`;
}

/** Tab for a container or guest; `hostId` is the SSH connection or LOCAL_CONTAINER_HOST. */
export function containerConnection(hostId: string, hostName: string, address: string, target: TerminalTarget): TerminalConnection {
  return { id: hostId, name: containerTabName(target, hostName), protocol: hostId === LOCAL_CONTAINER_HOST ? 'cmd' : 'ssh', address, target };
}
```

    - `sameTarget`: `return a.id === b.id && a.view === b.view && (a.target ? targetKey(a.target) : '') === (b.target ? targetKey(b.target) : '');`
    - `open` und `adopt`: in der Destrukturierung `target` ergänzen und im Objekt `...(target ? { target } : {})` neben `...(view ? { view } : {})`.
    - `retainConnections`: `const tabs = state.tabs.filter(tab => tab.connection.id === LOCAL_CONTAINER_HOST || ids.has(tab.connection.id));`
  - `src/shared/vault/types.ts`: Import `import type { ContainerTarget, TerminalTargetMode } from '../containers';`, neues Interface und Feld:

```ts
/** A container tab in a workspace; `index` is its position in `connectionIds` (the host's SSH connection). */
export interface WorkspaceContainerTab { index: number; target: ContainerTarget; mode: TerminalTargetMode }
```

    In `WorkspacePane`: `containerTabs?: WorkspaceContainerTab[];`
  - `src/shared/vault/schema.ts`, `WorkspacePaneSchema`: `containerTabs: z.array(z.object({ index: z.number().int().min(0).max(63), target: ContainerTargetSchema, mode: z.enum(['shell', 'logs']) }).strict()).max(64).optional(),` (Import aus `../containers-schema`).
  - `src/renderer/src/terminal-layout.ts`, `savedLayout` (Pane-Zweig):

```ts
  // Local container tabs have no vault connection to come back to.
  const saved = layout.tabIds.flatMap(id => tabs.find(tab => tab.id === id) ?? []).filter(tab => tab.connection.id !== LOCAL_CONTAINER_HOST);
  const active = layout.activeTabId ? saved.find(tab => tab.id === layout.activeTabId)?.connection.id : undefined;
  const fileBrowsers = saved.flatMap((tab, index) => tab.connection.view === 'files' ? [index] : []);
  const containerTabs = saved.flatMap((tab, index) => tab.connection.target ? [{ index, target: tab.connection.target.item, mode: tab.connection.target.mode }] : []);
  return { type: 'pane', connectionIds: saved.map(tab => tab.connection.id), ...(active ? { activeConnectionId: active } : {}),
    ...(fileBrowsers.length ? { fileBrowsers } : {}), ...(containerTabs.length ? { containerTabs } : {}) };
```

    `restoreLayout`, statt `const target = toTerminalConnection(...)`:

```ts
      const container = node.containerTabs?.find(entry => entry.index === index);
      const target = container && connection.protocol === 'ssh'
        ? containerConnection(connection.id, connection.name, connectionAddress(connection), { item: container.target, mode: container.mode })
        : toTerminalConnection(connection, node.fileBrowsers?.includes(index));
```

    Imports: `LOCAL_CONTAINER_HOST`, `containerConnection`, `connectionAddress` (aus `../../shared/vault/connections`).
  - `TerminalPanel.tsx:150`: `window.desktopApi.sshPrepare({ connectionId: connection.id, ...(connection.target ? { target: connection.target } : {}), cols: …, rows: … })`. Prüfen, dass `connection` dort das `TerminalConnection` des Tabs ist (Props ansehen). Falls nur Teilfelder durchgereicht werden, `target` mit durchreichen.

- [ ] **Step 4:** `npx vitest run src/renderer/src && npm run typecheck` → PASS.
- [ ] **Step 5: Commit** (`feat(tabs): keep container targets in tabs, windows and workspaces`)

---

### Task 9: Container-Zustand im Renderer

**Files:**
- Create: `src/renderer/src/container-tree.ts`
- Create: `src/renderer/src/hooks/useContainerDiscovery.ts`
- Test: `src/renderer/src/container-tree.test.ts`

**Interfaces:**
- Consumes: `DiscoveryResult`, `DiscoveredItem`, `ContainerAction`, `toTarget`, `itemKey`.
- Produces:

```ts
export type HostDiscovery =
  | { status: 'loading' }
  | { status: 'ready'; result: DiscoveryResult; busy: string[]; notice?: { key: string; message: string } }
  | { status: 'error'; message: string };
export type ContainerTreeState = Record<string, HostDiscovery>;
export type ContainerTreeAction = …;            // siehe Code
export function containerTreeReducer(state, action): ContainerTreeState;
export interface ItemGroup { key: string; label: string; items: DiscoveredItem[]; problem?: string }
export function groupItems(result: DiscoveryResult): ItemGroup[];
export type ItemCommand = { label: string; run: 'shell' | 'logs' | ContainerAction; confirm?: string };
export function itemCommands(item: DiscoveredItem): ItemCommand[];
export function hasUsableLocalRuntime(result: DiscoveryResult): boolean;
export function ipcMessage(error: unknown, fallback: string): string;
export interface ContainerTreeProps { … }   // siehe Code, von Task 10 genutzt
// hook:
export function useContainerDiscovery(): { state: ContainerTreeState; load(hostId: string): Promise<void>; act(hostId: string, item: DiscoveredItem, action: ContainerAction): Promise<void> };
```

- [ ] **Step 1: Failing Tests**

```ts
import { describe, expect, it } from 'vitest';
import type { DiscoveryResult } from '../../shared/containers';
import { containerTreeReducer, groupItems, hasUsableLocalRuntime, itemCommands } from './container-tree';

const web = { kind: 'container' as const, runtime: 'docker' as const, id: 'a', ref: 'web-1', name: 'web-1', image: 'nginx', state: 'running' as const };
const result: DiscoveryResult = { runtimes: ['docker', 'proxmox'], problems: { proxmox: 'Proxmox-Befehle brauchen root.' },
  items: [web, { kind: 'vm', vmid: 100, name: 'win11', state: 'stopped' }] };

describe('container tree state', () => {
  it('moves through loading, ready, busy and error', () => {
    let state = containerTreeReducer({}, { type: 'loading', hostId: 'h1' });
    expect(state.h1).toEqual({ status: 'loading' });
    state = containerTreeReducer(state, { type: 'loaded', hostId: 'h1', result });
    state = containerTreeReducer(state, { type: 'busy', hostId: 'h1', key: 'container:docker:web-1', busy: true });
    expect(state.h1).toMatchObject({ status: 'ready', busy: ['container:docker:web-1'] });
    state = containerTreeReducer(state, { type: 'notice', hostId: 'h1', key: 'container:docker:web-1', message: 'kaputt' });
    expect(state.h1).toMatchObject({ notice: { key: 'container:docker:web-1', message: 'kaputt' } });
    state = containerTreeReducer(state, { type: 'failed', hostId: 'h1', message: 'weg' });
    expect(state.h1).toEqual({ status: 'error', message: 'weg' });
  });
  it('ignores busy and notice for hosts that are not ready', () => {
    expect(containerTreeReducer({}, { type: 'busy', hostId: 'h1', key: 'x', busy: true })).toEqual({});
  });
});

describe('groupItems', () => {
  it('groups by runtime in a fixed order and keeps problems', () => {
    expect(groupItems(result).map(group => [group.label, group.items.length, group.problem])).toEqual([
      ['Docker', 1, undefined], ['Proxmox LXC', 0, 'Proxmox-Befehle brauchen root.'], ['Proxmox VMs', 1, undefined],
    ]);
  });
  it('shows a problem once for Proxmox and hides empty Proxmox groups without problems', () => {
    const clean: DiscoveryResult = { runtimes: ['proxmox'], problems: {}, items: [{ kind: 'lxc', vmid: 101, name: 'ct', state: 'running' }] };
    expect(groupItems(clean).map(group => group.label)).toEqual(['Proxmox LXC']);
  });
});

describe('itemCommands', () => {
  it('offers what fits the state', () => {
    expect(itemCommands(web).map(command => command.run)).toEqual(['shell', 'logs', 'restart', 'stop']);
    expect(itemCommands({ ...web, state: 'stopped' }).map(command => command.run)).toEqual(['start', 'logs']);
    expect(itemCommands({ kind: 'lxc', vmid: 101, name: 'ct', state: 'running' }).map(command => command.run)).toEqual(['shell', 'shutdown', 'stop']);
    const vmStop = itemCommands({ kind: 'vm', vmid: 100, name: 'win11', state: 'running' }).find(command => command.run === 'stop');
    expect(vmStop?.confirm).toContain('win11');
  });
});

describe('hasUsableLocalRuntime', () => {
  it('needs at least one runtime that answered', () => {
    expect(hasUsableLocalRuntime({ runtimes: ['docker'], items: [], problems: {} })).toBe(true);
    expect(hasUsableLocalRuntime({ runtimes: ['docker'], items: [], problems: { docker: 'Der Docker-Dienst läuft nicht.' } })).toBe(false);
    expect(hasUsableLocalRuntime({ runtimes: [], items: [], problems: {} })).toBe(false);
  });
});
```

- [ ] **Step 2:** Test → FAIL.

- [ ] **Step 3: `container-tree.ts`**

```ts
import type { ContainerAction, DiscoveredItem, DiscoveryResult, TerminalTargetMode } from '../../shared/containers';

/** What VaultTree and LocalContainers need from the app. */
export interface ContainerTreeProps {
  state: ContainerTreeState;
  onExpand: (hostId: string) => void;
  onOpen: (hostId: string, item: DiscoveredItem, mode: TerminalTargetMode) => void;
  onAction: (hostId: string, item: DiscoveredItem, action: ContainerAction, confirm?: string) => void;
}

export type HostDiscovery =
  | { status: 'loading' }
  | { status: 'ready'; result: DiscoveryResult; busy: string[]; notice?: { key: string; message: string } }
  | { status: 'error'; message: string };
export type ContainerTreeState = Record<string, HostDiscovery>;
export type ContainerTreeAction =
  | { type: 'loading'; hostId: string }
  | { type: 'loaded'; hostId: string; result: DiscoveryResult }
  | { type: 'failed'; hostId: string; message: string }
  | { type: 'busy'; hostId: string; key: string; busy: boolean }
  | { type: 'notice'; hostId: string; key: string; message: string };

export function containerTreeReducer(state: ContainerTreeState, action: ContainerTreeAction): ContainerTreeState {
  switch (action.type) {
    case 'loading': return { ...state, [action.hostId]: { status: 'loading' } };
    case 'loaded': return { ...state, [action.hostId]: { status: 'ready', result: action.result, busy: [] } };
    case 'failed': return { ...state, [action.hostId]: { status: 'error', message: action.message } };
    case 'busy': case 'notice': {
      const host = state[action.hostId];
      if (host?.status !== 'ready') return state;
      if (action.type === 'notice') return { ...state, [action.hostId]: { ...host, notice: { key: action.key, message: action.message } } };
      const busy = host.busy.filter(key => key !== action.key);
      return { ...state, [action.hostId]: { ...host, busy: action.busy ? [...busy, action.key] : busy, ...(action.busy ? { notice: undefined } : {}) } };
    }
  }
}

export interface ItemGroup { key: string; label: string; items: DiscoveredItem[]; problem?: string }

export function groupItems(result: DiscoveryResult): ItemGroup[] {
  const groups: ItemGroup[] = [];
  for (const runtime of ['docker', 'podman'] as const) {
    if (!result.runtimes.includes(runtime)) continue;
    groups.push({ key: runtime, label: runtime === 'docker' ? 'Docker' : 'Podman',
      items: result.items.filter(item => item.kind === 'container' && item.runtime === runtime), problem: result.problems[runtime] });
  }
  if (result.runtimes.includes('proxmox')) {
    const lxc = result.items.filter(item => item.kind === 'lxc'), vms = result.items.filter(item => item.kind === 'vm');
    const problem = result.problems.proxmox;
    // The problem is shown once, on the first Proxmox group.
    if (lxc.length || problem) groups.push({ key: 'lxc', label: 'Proxmox LXC', items: lxc, problem });
    if (vms.length) groups.push({ key: 'vm', label: 'Proxmox VMs', items: vms });
  }
  return groups;
}

export type ItemCommand = { label: string; run: 'shell' | 'logs' | ContainerAction; confirm?: string };

export function itemCommands(item: DiscoveredItem): ItemCommand[] {
  const running = item.state === 'running';
  if (item.kind === 'container') {
    if (running) return [{ label: 'Shell öffnen', run: 'shell' }, { label: 'Logs folgen', run: 'logs' }, { label: 'Neu starten', run: 'restart' }, { label: 'Stoppen', run: 'stop' }];
    if (item.state === 'paused') return [{ label: 'Logs folgen', run: 'logs' }, { label: 'Stoppen', run: 'stop' }];
    return [{ label: 'Starten', run: 'start' }, { label: 'Logs folgen', run: 'logs' }];
  }
  if (!running) return [{ label: 'Starten', run: 'start' }];
  return [
    { label: item.kind === 'lxc' ? 'Shell öffnen' : 'Serielle Konsole', run: 'shell' },
    { label: 'Herunterfahren', run: 'shutdown' },
    { label: 'Stoppen', run: 'stop', ...(item.kind === 'vm' ? { confirm: `VM „${item.name}“ hart ausschalten? Nicht gespeicherte Daten in der VM gehen verloren.` } : {}) },
  ];
}

export function hasUsableLocalRuntime(result: DiscoveryResult): boolean {
  return result.runtimes.some(runtime => !result.problems[runtime]);
}

export function ipcMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : fallback;
}
```

- [ ] **Step 4: Hook** (`src/renderer/src/hooks/useContainerDiscovery.ts`)

```ts
import { useCallback, useReducer } from 'react';
import { itemKey, toTarget } from '../../../shared/containers';
import type { ContainerAction, DiscoveredItem } from '../../../shared/containers';
import { containerTreeReducer, ipcMessage } from '../container-tree';

export function useContainerDiscovery() {
  const [state, dispatch] = useReducer(containerTreeReducer, {});
  const load = useCallback(async (hostId: string) => {
    dispatch({ type: 'loading', hostId });
    try { dispatch({ type: 'loaded', hostId, result: await window.desktopApi.containersList({ hostId }) }); }
    catch (error) { dispatch({ type: 'failed', hostId, message: ipcMessage(error, 'Die Container konnten nicht geladen werden.') }); }
  }, []);
  /** Reloads the host after success; on failure the list stays and the item shows the message. */
  const act = useCallback(async (hostId: string, item: DiscoveredItem, action: ContainerAction) => {
    const key = itemKey(item);
    dispatch({ type: 'busy', hostId, key, busy: true });
    try {
      await window.desktopApi.containersAction({ hostId, target: toTarget(item), action });
    } catch (error) {
      dispatch({ type: 'busy', hostId, key, busy: false });
      dispatch({ type: 'notice', hostId, key, message: ipcMessage(error, 'Die Aktion ist fehlgeschlagen.') });
      return;
    }
    await load(hostId);
  }, [load]);
  return { state, load, act };
}
```

- [ ] **Step 5:** `npx vitest run src/renderer/src/container-tree.test.ts && npm run typecheck` → PASS.
- [ ] **Step 6: Commit** (`feat(containers): track discovered containers per host in the renderer`)

---

### Task 10: Seitenleiste, „Dieser Computer“ und App-Verdrahtung

**Files:**
- Create: `src/renderer/src/components/ContainerChildren.tsx`
- Create: `src/renderer/src/components/LocalContainers.tsx`
- Modify: `src/renderer/src/components/VaultTree.tsx`, `src/renderer/src/App.tsx` (bei `connectNode` ~585 und Sidebar ~690-700), `src/renderer/src/components/navigation-ui.css`

**Interfaces:**
- Consumes: Tasks 8 und 9 (`containerConnection`, `useContainerDiscovery`, `groupItems`, `itemCommands`, `itemKey`, `HostDiscovery`), `ContextMenu`/`ContextMenuEntry`.
- Produces: `VaultTreeProps.containers?: ContainerTreeProps` (Typ aus Task 9).

Diese Task ist UI-Verdrahtung ohne Unit-Tests (Logik liegt in Task 9). Abnahme über Typecheck und manuelle Prüfung (Step 7).

- [ ] **Step 1: `ContainerChildren.tsx`**

```tsx
import { useState } from 'react';
import type { DiscoveredItem } from '../../../shared/containers';
import { itemKey } from '../../../shared/containers';
import type { ContainerTreeProps, HostDiscovery } from '../container-tree';
import { groupItems, itemCommands } from '../container-tree';
import { ContextMenu } from './ContextMenu';
import type { ContextMenuEntry } from './ContextMenu';

interface ContainerChildrenProps extends Omit<ContainerTreeProps, 'state' | 'onExpand'> {
  hostId: string;
  discovery: HostDiscovery | undefined;
  depth: number;
  disabled: boolean;
  onRefresh: () => void;
}

const STATE_LABEL = { running: 'läuft', paused: 'pausiert', stopped: 'gestoppt' } as const;

export function ContainerChildren({ hostId, discovery, depth, disabled, onOpen, onAction, onRefresh }: ContainerChildrenProps) {
  const [menu, setMenu] = useState<{ x: number; y: number; item: DiscoveredItem } | null>(null);
  const indent = { paddingLeft: `${depth * 14 + 26}px` };
  if (!discovery || discovery.status === 'loading') return <p className="tree-empty container-note" style={indent} role="status">Suche Container …</p>;
  if (discovery.status === 'error') return <p className="tree-error container-note" style={indent} role="alert">{discovery.message}{' '}
    <button type="button" className="link-button" disabled={disabled} onClick={onRefresh}>Erneut versuchen</button></p>;
  const groups = groupItems(discovery.result);
  if (!groups.length) return <p className="tree-empty container-note" style={indent}>Keine Container gefunden.</p>;
  const entries = (item: DiscoveredItem): ContextMenuEntry[] => [
    ...itemCommands(item).map((command): ContextMenuEntry => ({ kind: 'item', label: command.label,
      onSelect: () => command.run === 'shell' || command.run === 'logs' ? onOpen(hostId, item, command.run) : onAction(hostId, item, command.run, command.confirm) })),
    { kind: 'separator' },
    { kind: 'item', label: 'Aktualisieren', onSelect: onRefresh },
  ];
  return <ul className="container-children">
    {menu && <ContextMenu x={menu.x} y={menu.y} label={`Aktionen für ${menu.item.name}`} entries={entries(menu.item)} onClose={() => setMenu(null)} />}
    {groups.map(group => <li key={group.key}>
      <div className="container-group" style={indent}>{group.label}</div>
      {group.problem && <p className="tree-error container-note" style={{ paddingLeft: `${depth * 14 + 40}px` }}>{group.problem}</p>}
      <ul>{group.items.map(item => {
        const key = itemKey(item);
        const busy = discovery.busy.includes(key);
        const notice = discovery.notice?.key === key ? discovery.notice.message : undefined;
        const canOpen = item.state === 'running';
        return <li key={key}>
          <div className="vault-tree-row container-row" style={{ paddingLeft: `${depth * 14 + 14}px` }}
            onContextMenu={event => { event.preventDefault(); event.stopPropagation(); if (!disabled) setMenu({ x: event.clientX, y: event.clientY, item }); }}>
            <span className="tree-toggle-spacer" />
            <button className="tree-node-button" type="button" disabled={disabled || busy} aria-busy={busy}
              title={item.kind === 'container' ? `${item.name} — ${item.image} (${STATE_LABEL[item.state]})` : `${item.kind === 'lxc' ? 'CT' : 'VM'} ${item.vmid} — ${STATE_LABEL[item.state]}`}
              onDoubleClick={() => { if (canOpen) onOpen(hostId, item, 'shell'); }}
              onKeyDown={event => {
                if (event.key === 'Enter' && canOpen) { event.preventDefault(); onOpen(hostId, item, 'shell'); }
                if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
                  event.preventDefault();
                  const rect = event.currentTarget.getBoundingClientRect();
                  setMenu({ x: rect.left + 24, y: rect.bottom, item });
                }
              }}>
              <span className={`container-state is-${busy ? 'busy' : item.state}`} aria-label={busy ? 'wird ausgeführt' : STATE_LABEL[item.state]} />
              <span className="tree-node-text"><span>{item.kind === 'container' ? item.name : `${item.vmid} ${item.name}`}</span></span>
            </button>
          </div>
          {notice && <p className="tree-error container-note" style={{ paddingLeft: `${depth * 14 + 40}px` }} role="alert">{notice}</p>}
        </li>;
      })}</ul>
    </li>)}
  </ul>;
}
```

Falls `link-button` als Klasse nicht existiert (`grep -rn "link-button" src/renderer/src`), eine vorhandene Klasse für Text-Buttons nutzen oder in `navigation-ui.css` ergänzen (Step 5).

- [ ] **Step 2: `VaultTree.tsx`**
  - Props: `/** Containers below SSH connections; omitted hides them. */ containers?: ContainerTreeProps;` in Interface und Destrukturierung.
  - State: `const [expandedHosts, setExpandedHosts] = useState<Set<string>>(new Set());` und

```ts
  const isHost = (node: VaultNode): boolean => Boolean(containers) && node.type === 'connection' && node.protocol === 'ssh' && !searching;
  const toggleHost = (id: string) => setExpandedHosts(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else { next.add(id); if (!containers?.state[id]) containers?.onExpand(id); }
    return next;
  });
```

  - Den Toggle-Ausdruck im Row-Render erweitern: Für `isHost(node)` einen Button wie bei Ordnern rendern (`className={`tree-toggle${expandedHosts.has(node.id) ? ' is-expanded' : ''}`}`, `aria-label={`Container von ${node.name} ${expandedHosts.has(node.id) ? 'zuklappen' : 'anzeigen'}`}`, `aria-expanded={expandedHosts.has(node.id)}`, `onClick={() => toggleHost(node.id)}`). Ordner bleiben unverändert, sonst `tree-toggle-spacer`.
  - Im `onKeyDown` des Knotens: `if (isHost(node) && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) { event.preventDefault(); if ((event.key === 'ArrowRight') !== expandedHosts.has(node.id)) toggleHost(node.id); }`
  - Nach der Ordner-Kinderliste:

```tsx
    {isHost(node) && expandedHosts.has(node.id) && containers && <ContainerChildren hostId={node.id} discovery={containers.state[node.id]} depth={depth + 1}
      disabled={disabled} onOpen={containers.onOpen} onAction={containers.onAction} onRefresh={() => containers.onExpand(node.id)} />}
```

  - Im Kontextmenü einer SSH-Verbindung (bei „Dateien öffnen (SFTP)“) ergänzen: `...(node.protocol === 'ssh' && containers ? [{ kind: 'item' as const, label: 'Container anzeigen', onSelect: () => { if (!expandedHosts.has(node.id)) toggleHost(node.id); else containers.onExpand(node.id); } }] : [])`.

- [ ] **Step 3: `LocalContainers.tsx`**

```tsx
import { LOCAL_CONTAINER_HOST } from '../../../shared/containers';
import type { ContainerTreeProps } from '../container-tree';
import { hasUsableLocalRuntime } from '../container-tree';
import { ContainerChildren } from './ContainerChildren';

/** "Dieser Computer": only shown when Docker or Podman answered locally. */
export function LocalContainers({ containers, disabled }: { containers: ContainerTreeProps; disabled: boolean }) {
  const discovery = containers.state[LOCAL_CONTAINER_HOST];
  if (discovery?.status !== 'ready' || !hasUsableLocalRuntime(discovery.result)) return null;
  return <section className="local-containers" aria-label="Container auf diesem Computer">
    <div className="container-group">Dieser Computer</div>
    <ContainerChildren hostId={LOCAL_CONTAINER_HOST} discovery={discovery} depth={0} disabled={disabled}
      onOpen={containers.onOpen} onAction={containers.onAction} onRefresh={() => containers.onExpand(LOCAL_CONTAINER_HOST)} />
  </section>;
}
```

- [ ] **Step 4: `App.tsx`**
  - Imports: `useContainerDiscovery`, `LocalContainers`, `containerConnection`, `LOCAL_CONTAINER_HOST`, Typen `DiscoveredItem`, `TerminalTargetMode`, `ContainerAction`, `toTarget` und `ContainerTreeProps`.
  - Im Component-Body: `const containerDiscovery = useContainerDiscovery();`
  - Lokale Erkennung einmal je entsperrtem Vault:

```ts
  const vaultId = vault?.id;
  const { load: loadContainers } = containerDiscovery;
  useEffect(() => { if (vaultId) void loadContainers(LOCAL_CONTAINER_HOST); }, [vaultId, loadContainers]);
```

  - Nach `connectNode`:

```ts
  function openContainer(hostId: string, item: DiscoveredItem, mode: TerminalTargetMode): void {
    const host = hostId === LOCAL_CONTAINER_HOST ? undefined : vault && findNode(vault.nodes, hostId);
    if (hostId !== LOCAL_CONTAINER_HOST && host?.type !== 'connection') return;
    navigateEditor(() => {
      if (terminals.tabs.length >= MAX_SSH_SESSIONS) { setError(`Maximal ${MAX_SSH_SESSIONS} Sessions. Schließe zuerst einen Tab.`); return; }
      const name = host?.type === 'connection' ? host.name : 'Dieser Computer';
      const address = host?.type === 'connection' ? connectionAddress(host) : 'lokal';
      terminals.open(containerConnection(hostId, name, address, { item: toTarget(item), mode }));
      setEditorOpen(false); setEditorDirty(false); setError(null);
    });
  }

  const containerTree: ContainerTreeProps = {
    state: containerDiscovery.state,
    onExpand: id => void containerDiscovery.load(id),
    onOpen: openContainer,
    onAction: (id, item, action, confirm) => { if (!confirm || window.confirm(confirm)) void containerDiscovery.act(id, item, action); },
  };
```

  (`connectionAddress` ggf. aus `../../shared/vault/connections` importieren, falls noch nicht vorhanden.)
  - Sidebar: direkt vor `<VaultTree …>`: `<LocalContainers containers={containerTree} disabled={busy} />`; an `<VaultTree …>` die Prop `containers={containerTree}` ergänzen.

- [ ] **Step 5: CSS** (`navigation-ui.css`, am Ende)

```css
.container-group { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--ui-muted); padding: 6px 8px 2px; }
.container-note { margin: 0; padding-top: 2px; padding-bottom: 4px; }
.container-children ul, .container-children { list-style: none; margin: 0; padding: 0; }
.container-state { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 8px; margin: 0 8px 0 4px; background: var(--ui-muted); }
.container-state.is-running { background: #4ade80; }
.container-state.is-paused { background: #facc15; }
.container-state.is-busy { background: var(--ui-accent); animation: container-pulse 1s ease-in-out infinite; }
@keyframes container-pulse { 50% { opacity: .35; } }
@media (prefers-reduced-motion: reduce) { .container-state.is-busy { animation: none; } }
.local-containers { margin-bottom: 6px; }
```

- [ ] **Step 6:** `npm run typecheck && npm test` → PASS.
- [ ] **Step 7: Manuelle Prüfung** mit `npm run dev`:
  1. SSH-Verbindung zu einem Docker-Host aufklappen: „Suche Container …“, danach Gruppe Docker mit Status-Punkten.
  2. Doppelklick auf laufenden Container: Tab `name @ host` mit bash/sh. `top` starten und Fenster verkleinern; die Größe muss folgen.
  3. Kontextmenü → Logs folgen: Tab `Logs: …`. Stoppen: Punkt pulsiert, danach grau.
  4. Benutzer ohne docker-Gruppe: Hinweis an der Gruppe. sudo-Häkchen setzen und erneut aufklappen.
  5. Proxmox-Node als root: LXC-Shell (`pct enter`), VM Starten/Herunterfahren, „Stoppen“ fragt nach. Serielle Konsole einer VM ohne Schnittstelle zeigt den Hinweis.
  6. Docker Desktop lokal gestartet: Abschnitt „Dieser Computer“ erscheint, Shell öffnet. Docker Desktop beendet und neu geladen: Abschnitt fehlt.
  7. Workspace mit Container-Tab speichern, Vault sperren, entsperren, Workspace öffnen: Container-Tab kommt wieder.
  8. Container-Tab in eigenes Fenster abdocken: Sitzung läuft weiter.
- [ ] **Step 8: Commit** (`feat(ui): show containers below SSH connections and on this computer`)

---

### Task 11: Doku und Version

**Files:**
- Modify: `README.md`, `CHANGELOG.md`, `package.json`

- [ ] **Step 1:** `package.json` → `"version": "0.3.0"`.
- [ ] **Step 2:** `CHANGELOG.md`, über `## [0.2.0]` (Datum bei Umsetzung anpassen):

```markdown
## [0.3.0] – 2026-10-14

- Container und VMs unter SSH-Verbindungen: Docker, Podman und Proxmox (LXC/VMs) werden beim Aufklappen erkannt; auf dem Server muss nichts installiert werden.
- Shell in Container und LXC per Doppelklick, Logs folgen, Starten/Stoppen/Neu starten; serielle Konsole für Proxmox-VMs.
- Lokales Docker Desktop oder Podman unter „Dieser Computer“.
- Option „Container-Befehle mit sudo ausführen“ (sudo -n) pro SSH-Verbindung.
```

- [ ] **Step 3:** `README.md`: im Funktionsabschnitt einen Absatz „Container und VMs“ mit den drei Laufzeiten, Bedienung (Aufklappen, Doppelklick, Kontextmenü), Voraussetzungen (Gruppe `docker` bzw. root für Proxmox, sonst sudo-Option mit NOPASSWD) und Grenzen (kein Datei-Browser, keine Proxmox-API in dieser Version).
- [ ] **Step 4:** `npm run build` → läuft durch (prüft den Changelog-Abschnitt).
- [ ] **Step 5: Commit** (`docs(containers): document container integration and bump to 0.3.0`)
