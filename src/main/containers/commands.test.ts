import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { actionArgv, ContainerInputError, listArgv, remoteCommand, shellJoin, SHELL_CHOICE, terminalArgv } from './commands';

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

describe('remoteCommand', () => {
  it('extends PATH for Proxmox tools and adds sudo -n only on request', () => {
    expect(remoteCommand(['pct', 'list'], false)).toBe('PATH="$PATH:/usr/sbin:/sbin" pct list');
    expect(remoteCommand(['pct', 'list'], true)).toBe('PATH="$PATH:/usr/sbin:/sbin" sudo -n pct list');
  });
  it.runIf(hasSh())('keeps a quoted argument intact through sh', () => {
    const arg = "a'; echo pwned; '";
    const out = execFileSync('sh', ['-c', `printf %s ${shellJoin([arg])}`], { encoding: 'utf8' });
    expect(out).toBe(arg);
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
