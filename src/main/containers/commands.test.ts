import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { actionArgv, ContainerInputError, inspectArgv, inventoryActionArgv, inventoryArgv, listArgv, localProbeArgv, PROBE_COMMAND, remoteCommand, remoteScript, shellJoin, SHELL_CHOICE, sudoSetting, terminalArgv } from './commands';
import { INVENTORY_KINDS } from '../../shared/containers';
import type { ContainerRuntime, InventoryAction, InventoryKind } from '../../shared/containers';
import type { SshConnectionNode } from '../../shared/vault/types';

function hasSh(): boolean {
  try {
    execFileSync('sh', ['-c', 'true'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const web = { kind: 'container' as const, runtime: 'docker' as const, ref: 'web-1', name: 'web-1' };
const ct = { kind: 'lxc' as const, vmid: 101, name: 'ct-web' };
const vm = { kind: 'vm' as const, vmid: 100, name: 'win11' };

describe('shellJoin', () => {
  it('leaves plain words and quotes everything else', () => {
    expect(shellJoin(['docker', 'ps', '--format', '{{json .}}'])).toBe("docker ps --format '{{json .}}'");
    expect(shellJoin(["it's"])).toBe("'it'\\''s'");
    expect(shellJoin(['$(rm -rf /)'])).toBe("'$(rm -rf /)'");
  });
  it.runIf(hasSh())('round-trips arguments through sh unchanged', () => {
    const args = ["it's", "a'; echo pwned; '", '$(id)', 'two words'];
    for (const arg of args) {
      const out = execFileSync('sh', ['-c', `printf %s ${shellJoin([arg])}`], { encoding: 'utf8' });
      expect(out).toBe(arg);
    }
  });
});

describe('PROBE_COMMAND', () => {
  it('runs the probe through sh with the extended PATH, whatever the login shell', () => {
    expect(PROBE_COMMAND).toBe(`sh -c 'PATH="$PATH:/usr/sbin:/sbin"; for c in docker podman pct qm; do command -v "$c" >/dev/null 2>&1 && echo "has:$c"; done; true'`);
  });
  it.runIf(hasSh())('runs through sh and prints only probe markers', () => {
    const out = execFileSync('sh', ['-c', PROBE_COMMAND], { encoding: 'utf8' });
    expect(out).toMatch(/^(has:(docker|podman|pct|qm)\r?\n)*$/);
  });
});

describe('remoteCommand', () => {
  it('extends PATH for Proxmox tools and adds sudo -n only on request', () => {
    expect(remoteCommand(['pct', 'list'], { kind: 'none' })).toBe('PATH="$PATH:/usr/sbin:/sbin" pct list');
    expect(remoteCommand(['pct', 'list'], { kind: 'noninteractive' })).toBe('PATH="$PATH:/usr/sbin:/sbin" sudo -n pct list');
  });
  it('authenticates first, then signals readiness, then runs the command with cached credentials', () => {
    const marker = '[terminus-sudo-0123456789abcdef]';
    const ready = '[terminus-ready-0123456789abcdef]';
    expect(remoteCommand(['pct', 'list'], { kind: 'prompt', marker, ready, stdin: true })).toBe(
      `sh -c 'PATH="$PATH:/usr/sbin:/sbin"; sudo -S -p '\\''${marker}'\\'' -v && printf %s '\\''${ready}'\\'' && sudo -n pct list; exit $?'`);
    expect(remoteCommand(['docker', 'exec', '-it', 'web-1', 'sh', '-c', SHELL_CHOICE], { kind: 'prompt', marker, ready, stdin: false })).toBe(
      `sh -c 'PATH="$PATH:/usr/sbin:/sbin"; sudo -p '\\''${marker}'\\'' -v && printf %s '\\''${ready}'\\'' && sudo -n docker exec -it web-1 sh -c '\\''command -v bash >/dev/null 2>&1 && exec bash || exec sh'\\''; exit $?'`);
  });
  it('refuses markers sudo would expand or the shell could misread', () => {
    const ready = '[terminus-ready-0123456789abcdef]';
    expect(() => remoteCommand(['pct', 'list'], { kind: 'prompt', marker: '%u', ready, stdin: true })).toThrow();
    expect(() => remoteCommand(['pct', 'list'], { kind: 'prompt', marker: '', ready, stdin: true })).toThrow();
    expect(() => remoteCommand(['pct', 'list'], { kind: 'prompt', marker: '[terminus-sudo-0123456789abcdef]', ready: "x'y", stdin: true })).toThrow();
  });
  it.runIf(hasSh())('runs the prompt script through sh with every argument intact', () => {
    const directory = mkdtempSync(join(tmpdir(), 'terminus-fake-sudo-'));
    try {
      // Fake sudo: -v succeeds silently, -n runs the remaining arguments.
      writeFileSync(join(directory, 'sudo'), '#!/bin/sh\nwhile [ $# -gt 0 ]; do case "$1" in -v) exit 0;; -n|-S) shift;; -p) shift 2;; *) break;; esac; done\nexec "$@"\n', { mode: 0o755 });
      const ready = '[terminus-ready-0123456789abcdef]';
      const command = remoteCommand(['printf', '%s|', "it's", 'two words', '$(id)'], { kind: 'prompt', marker: '[terminus-sudo-0123456789abcdef]', ready, stdin: true });
      const out = execFileSync('sh', ['-c', command], { encoding: 'utf8', env: { ...process.env, PATH: `${directory}:${process.env.PATH}` } });
      expect(out).toBe(`${ready}it's|two words|$(id)|`);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it.runIf(hasSh())('keeps a quoted argument intact through sh', () => {
    const arg = "a'; echo pwned; '";
    const out = execFileSync('sh', ['-c', `printf %s ${shellJoin([arg])}`], { encoding: 'utf8' });
    expect(out).toBe(arg);
  });
});

describe('remoteScript', () => {
  const marker = '[terminus-sudo-0123456789abcdef]';
  const ready = '[terminus-ready-0123456789abcdef]';
  it('wraps the body in sh with the extended PATH; the body sets sudo -n itself', () => {
    const expected = `sh -c 'PATH="$PATH:/usr/sbin:/sbin"; true'`;
    expect(remoteScript('true', { kind: 'none' })).toBe(expected);
    expect(remoteScript('true', { kind: 'noninteractive' })).toBe(expected);
  });
  it('validates once, signals readiness, then runs the body in braces', () => {
    expect(remoteScript('true', { kind: 'prompt', marker, ready, stdin: true })).toBe(
      `sh -c 'PATH="$PATH:/usr/sbin:/sbin"; sudo -S -p '\\''${marker}'\\'' -v && printf %s '\\''${ready}'\\'' && { true; }; exit $?'`);
  });
  it('refuses invalid markers', () => {
    expect(() => remoteScript('true', { kind: 'prompt', marker: '%u', ready, stdin: true })).toThrow('Invalid sudo marker');
    expect(() => remoteScript('true', { kind: 'prompt', marker: '', ready, stdin: true })).toThrow();
    expect(() => remoteScript('true', { kind: 'prompt', marker, ready: "x'y", stdin: true })).toThrow();
  });
});

describe('listArgv', () => {
  it('lists Proxmox guests', () => {
    expect(listArgv('lxc')).toEqual(['pct', 'list']);
    expect(listArgv('vm')).toEqual(['qm', 'list']);
  });
});

describe('localProbeArgv', () => {
  it('only asks for the version, never the daemon', () => {
    expect(localProbeArgv('docker')).toEqual(['docker', '--version']);
    expect(localProbeArgv('podman')).toEqual(['podman', '--version']);
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

describe('sudoSetting', () => {
  const base: SshConnectionNode = { id: 'h1', type: 'connection', protocol: 'ssh', name: 'h', host: 'h', port: 22, username: 'u',
    authentication: { method: 'password', password: 'synthetic-password' }, tags: [] };
  it('prompts only with sudo enabled and a stored password', () => {
    expect(sudoSetting(base)).toEqual({ kind: 'none' });
    expect(sudoSetting({ ...base, containers: { sudo: true } })).toEqual({ kind: 'prompt', password: 'synthetic-password' });
    expect(sudoSetting({ ...base, containers: { sudo: true }, authentication: { method: 'agent' } })).toEqual({ kind: 'noninteractive' });
    expect(sudoSetting({ ...base, containers: { sudo: true }, authentication: { method: 'password', password: '' } })).toEqual({ kind: 'noninteractive' });
  });
  it.each(['a\nb', 'a\rb'])('refuses a password with a line break (%j)', password => {
    expect(() => sudoSetting({ ...base, containers: { sudo: true }, authentication: { method: 'password', password } }))
      .toThrow(new ContainerInputError('Das Passwort enthält einen Zeilenumbruch und kann nicht für sudo verwendet werden.'));
  });
});

describe('inventory commands', () => {
  const runtimes: ContainerRuntime[] = ['docker', 'podman'];
  const actions: InventoryAction[] = ['start', 'stop', 'restart', 'remove'];
  const lists: Record<ContainerRuntime, Record<InventoryKind, string[]>> = {
    docker: {
      containers: ['docker', 'ps', '-a', '--no-trunc', '--format', '{{json .}}'],
      images: ['docker', 'images', '--no-trunc', '--format', '{{json .}}'],
      volumes: ['docker', 'volume', 'ls', '--format', '{{json .}}'],
      networks: ['docker', 'network', 'ls', '--no-trunc', '--format', '{{json .}}'],
    },
    podman: {
      containers: ['podman', 'ps', '-a', '--format', 'json'],
      images: ['podman', 'images', '--format', 'json'],
      volumes: ['podman', 'volume', 'ls', '--format', 'json'],
      networks: ['podman', 'network', 'ls', '--format', 'json'],
    },
  };
  const refFor = (kind: InventoryKind) => (kind === 'images' ? 'nginx:latest' : 'web-1');
  const forbidden = ['-f', '--force', '-v', '--volumes', 'prune'];

  it('lists every runtime and kind exactly', () => {
    for (const rt of runtimes) for (const kind of INVENTORY_KINDS) expect(inventoryArgv(rt, kind)).toEqual(lists[rt][kind]);
  });
  it('inspects each kind', () => {
    for (const rt of runtimes) {
      expect(inspectArgv({ kind: 'containers', runtime: rt, ref: 'web-1' })).toEqual([rt, 'container', 'inspect', 'web-1']);
      expect(inspectArgv({ kind: 'images', runtime: rt, ref: 'nginx:latest' })).toEqual([rt, 'image', 'inspect', 'nginx:latest']);
      expect(inspectArgv({ kind: 'volumes', runtime: rt, ref: 'data' })).toEqual([rt, 'volume', 'inspect', 'data']);
      expect(inspectArgv({ kind: 'networks', runtime: rt, ref: 'bridge' })).toEqual([rt, 'network', 'inspect', 'bridge']);
    }
  });
  it('builds actions for all combinations and never adds force flags', () => {
    const expected = (rt: string, kind: InventoryKind, action: InventoryAction, ref: string): string[] | null => {
      if (kind === 'networks') return null;
      if (action === 'remove') return kind === 'images' ? [rt, 'rmi', ref] : kind === 'volumes' ? [rt, 'volume', 'rm', ref] : [rt, 'rm', ref];
      return kind === 'containers' ? [rt, action, ref] : null;
    };
    for (const rt of runtimes) for (const kind of INVENTORY_KINDS) for (const action of actions) {
      const ref = refFor(kind);
      const want = expected(rt, kind, action, ref);
      if (want) {
        const got = inventoryActionArgv({ kind, runtime: rt, ref }, action);
        expect(got).toEqual(want);
        for (const token of forbidden) expect(got).not.toContain(token);
      } else {
        expect(() => inventoryActionArgv({ kind, runtime: rt, ref }, action)).toThrow('Diese Aktion ist hier nicht möglich.');
      }
    }
    for (const rt of runtimes) for (const kind of INVENTORY_KINDS) for (const token of forbidden) expect(inventoryArgv(rt, kind)).not.toContain(token);
  });
  it('rejects invalid refs and runtimes', () => {
    for (const ref of ['; rm', '$()', '<none>:<none>', 'a b', '-x', '']) {
      expect(() => inspectArgv({ kind: 'containers', runtime: 'docker', ref })).toThrow('Ungültige Container-Angabe.');
      expect(() => inventoryActionArgv({ kind: 'containers', runtime: 'docker', ref }, 'remove')).toThrow('Ungültige Container-Angabe.');
      expect(() => inventoryActionArgv({ kind: 'images', runtime: 'docker', ref }, 'remove')).toThrow('Ungültige Container-Angabe.');
    }
    expect(() => inspectArgv({ kind: 'containers', runtime: 'lxc' as never, ref: 'a' })).toThrow('Ungültige Container-Angabe.');
    expect(() => inventoryActionArgv({ kind: 'containers', runtime: 'lxc' as never, ref: 'a' }, 'start')).toThrow('Ungültige Container-Angabe.');
    expect(() => inventoryArgv('lxc' as never, 'containers')).toThrow('Ungültige Container-Angabe.');
  });
  it('checks the action before the runtime and ref', () => {
    expect(() => inventoryActionArgv({ kind: 'networks', runtime: 'x' as never, ref: ';' }, 'remove')).toThrow('Diese Aktion ist hier nicht möglich.');
  });
  it('quotes the JSON format in the remote command', () => {
    expect(remoteCommand(inventoryArgv('docker', 'containers'), { kind: 'none' })).toContain("--format '{{json .}}'");
  });
});
