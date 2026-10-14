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
const PROBE = `sh -c '${P}; for c in docker podman pct qm; do command -v "$c" >/dev/null 2>&1 && echo "has:$c"; done; true'`;
const answers = {
  [PROBE]: ok('has:docker\nhas:pct\nhas:qm\n'),
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
  it('rejects when the probe times out or fails instead of reporting no containers', async () => {
    const slow = new ContainerDiscovery({ getConnection: () => ssh(), runLocal: vi.fn(),
      openRemote: async () => fakeHost({ [PROBE]: { code: null, stdout: '', stderr: '', timedOut: true } }) });
    await expect(slow.list('h1')).rejects.toThrow('Der Host hat nicht rechtzeitig geantwortet.');
    const failing = new ContainerDiscovery({ getConnection: () => ssh(), runLocal: vi.fn(),
      openRemote: async () => fakeHost({ [PROBE]: { code: 1, stdout: '', stderr: 'warning\nsh: cannot fork\n' } }) });
    await expect(failing.list('h1')).rejects.toThrow('sh: cannot fork');
    const silent = new ContainerDiscovery({ getConnection: () => ssh(), runLocal: vi.fn(),
      openRemote: async () => fakeHost({ [PROBE]: { code: 1, stdout: '', stderr: '' } }) });
    await expect(silent.list('h1')).rejects.toThrow('Die Container-Erkennung ist fehlgeschlagen (Exit-Code 1).');
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

describe('ContainerDiscovery connection lifecycle', () => {
  const target = { kind: 'container', runtime: 'docker', ref: 'web-1', name: 'web-1' } as const;

  it('does not close the connection while a command is running', async () => {
    vi.useFakeTimers();
    const host = fakeHost({});
    host.run = async () => { await new Promise(resolve => setTimeout(resolve, 90_000)); return ok(''); };
    const discovery = new ContainerDiscovery({ getConnection: () => ssh(), openRemote: async () => host, runLocal: vi.fn(), idleMs: 60_000 });
    const pending = discovery.action('h1', target, 'stop');
    await vi.advanceTimersByTimeAsync(80_000);
    expect(host.closed).toBe(false);
    await vi.advanceTimersByTimeAsync(10_001);
    await pending;
    await vi.advanceTimersByTimeAsync(59_000);
    expect(host.closed).toBe(false);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(host.closed).toBe(true);
  });
  it('evicts a failed opening and reconnects on the next call', async () => {
    const host = fakeHost(answers);
    const openRemote = vi.fn<() => Promise<RemoteHost>>()
      .mockRejectedValueOnce(new Error('connect failed'))
      .mockResolvedValue(host);
    const discovery = new ContainerDiscovery({ getConnection: () => ssh(), openRemote, runLocal: vi.fn() });
    await expect(discovery.list('h1')).rejects.toBeInstanceOf(Error);
    await expect(discovery.list('h1')).resolves.toMatchObject({ runtimes: ['docker', 'proxmox'] });
    expect(openRemote).toHaveBeenCalledTimes(2);
  });
  it('reconnects when the cached host reports closed', async () => {
    const first = fakeHost(answers);
    const second = fakeHost(answers);
    const openRemote = vi.fn<() => Promise<RemoteHost>>().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const discovery = new ContainerDiscovery({ getConnection: () => ssh(), openRemote, runLocal: vi.fn() });
    await discovery.list('h1');
    (first as { closed: boolean }).closed = true;
    await discovery.list('h1');
    expect(openRemote).toHaveBeenCalledTimes(2);
    expect(second.commands.length).toBeGreaterThan(0);
  });
  it('does not let a replaced entry timer close the new host', async () => {
    vi.useFakeTimers();
    let current = ssh();
    const hosts = [fakeHost(answers), fakeHost(answers)];
    const openRemote = vi.fn(async () => hosts[openRemote.mock.calls.length - 1]);
    const discovery = new ContainerDiscovery({ getConnection: () => current, openRemote, runLocal: vi.fn(), idleMs: 60_000 });
    await discovery.list('h1');
    await vi.advanceTimersByTimeAsync(30_000);
    current = ssh({ host: 'server02' });
    await discovery.list('h1');
    await vi.advanceTimersByTimeAsync(40_000);
    expect(hosts[1].closed).toBe(false);
  });
  it('turns raw rejections into readable errors and survives a throwing close', async () => {
    const broken = new ContainerDiscovery({ getConnection: () => { throw new Error('boom'); }, openRemote: vi.fn(), runLocal: vi.fn() });
    await expect(broken.list('h1')).rejects.toBeInstanceOf(Error);
    const local = new ContainerDiscovery({ getConnection: vi.fn(), openRemote: vi.fn(), runLocal: vi.fn().mockRejectedValue('raw') });
    await expect(local.list(LOCAL_CONTAINER_HOST)).rejects.toBeInstanceOf(Error);
    const host = fakeHost(answers);
    host.close = () => { throw new Error('close failed'); };
    const discovery = new ContainerDiscovery({ getConnection: () => ssh(), openRemote: async () => host, runLocal: vi.fn() });
    await discovery.list('h1');
    discovery.closeAll();
    await new Promise(resolve => setTimeout(resolve, 0));
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
