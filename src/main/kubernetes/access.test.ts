import { describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import type { KubernetesConnectionNode, SshConnectionNode } from '../../shared/vault/types';
import type { RunResult } from '../containers/parsers';
import type { RemoteHost } from '../containers/runner';
import { SudoRejections } from '../containers/sudo-rejections';
import { AUTO_SCRIPT, openAccess, readKubeconfig } from './access';

function fakeHost(responses: Record<string, RunResult>, calls: string[] = []): RemoteHost {
  return { closed: false, close: vi.fn(), forward: vi.fn(),
    run: vi.fn(async (command: string) => {
      calls.push(command);
      const hit = Object.entries(responses).find(([key]) => command.includes(key));
      return hit ? hit[1] : { code: 1, stdout: '', stderr: 'unexpected' };
    }) } as unknown as RemoteHost;
}

const ssh = (id: string, extra: Partial<SshConnectionNode> = {}): SshConnectionNode => ({ id, type: 'connection', name: `k8s-${id}`, tags: [], protocol: 'ssh',
  host: `k8s-${id}`, port: 22, username: 'admin', authentication: { method: 'agent' }, ...extra });
const cluster = (accessHosts: string[], kubeconfig: KubernetesConnectionNode['kubeconfig'] = { source: 'auto' }): KubernetesConnectionNode =>
  ({ id: 'k', type: 'connection', name: 'k8s', tags: [], protocol: 'kubernetes', accessHosts, kubeconfig, production: true, readOnly: false });

const ok = (stdout: string): RunResult => ({ code: 0, stdout, stderr: '' });
const CONFIG_YAML = 'apiVersion: v1\nkind: Config\n';

function dependencies(hosts: Record<string, SshConnectionNode | undefined>, open: (connection: SshConnectionNode) => Promise<RemoteHost>) {
  return {
    getConnection: (id: string) => hosts[id],
    openRemote: vi.fn(open),
    sudoRejections: new SudoRejections(),
  };
}

describe('readKubeconfig auto', () => {
  it('uses the path printed by the probe', async () => {
    const host = fakeHost({ [AUTO_SCRIPT]: ok(`src:/home/admin/.kube/config\n${CONFIG_YAML}`) });
    const result = await readKubeconfig(host, ssh('cp1'), { source: 'auto' }, new SudoRejections());
    expect(result).toEqual({ text: CONFIG_YAML, source: '/home/admin/.kube/config' });
  });

  it('explains the options when sudo -n needs a password', async () => {
    const host = fakeHost({ [AUTO_SCRIPT]: ok('src:sudo\n'), 'sudo -n cat': { code: 1, stdout: '', stderr: 'sudo: a password is required' } });
    await expect(readKubeconfig(host, ssh('cp1'), { source: 'auto' }, new SudoRejections())).rejects.toThrow(
      '/etc/kubernetes/admin.conf braucht sudo, und sudo verlangt ein Passwort. Speichere das Passwort an der SSH-Verbindung, richte NOPASSWD ein oder lege die kubeconfig unter ~/.kube/config ab.');
  });

  it('answers the sudo prompt with the stored password of the SSH connection', async () => {
    const calls: string[] = [];
    const host = fakeHost({ [AUTO_SCRIPT]: ok('src:sudo\n'), 'cat -- /etc/kubernetes/admin.conf': ok(CONFIG_YAML) }, calls);
    const result = await readKubeconfig(host, ssh('cp1', { authentication: { method: 'password', password: 'pw' } }), { source: 'auto' }, new SudoRejections());
    expect(calls[1]).toContain('sudo -S -p');
    expect(vi.mocked(host.run).mock.calls[1][2]).toMatchObject({ password: 'pw' });
    expect(result.source).toBe('/etc/kubernetes/admin.conf (sudo)');
  });

  it('reads admin.conf with sudo -n through the existing SSH connection, without the container sudo flag', async () => {
    const calls: string[] = [];
    const host = fakeHost({ [AUTO_SCRIPT]: ok('src:sudo\n'), 'sudo -n cat -- /etc/kubernetes/admin.conf': ok(CONFIG_YAML) }, calls);
    const result = await readKubeconfig(host, ssh('cp1'), { source: 'auto' }, new SudoRejections());
    expect(calls[1]).toContain('sudo -n cat -- /etc/kubernetes/admin.conf');
    expect(result).toEqual({ text: CONFIG_YAML, source: '/etc/kubernetes/admin.conf (sudo)' });
  });

  it('names the checked locations when no kubeconfig exists', async () => {
    const host = fakeHost({ [AUTO_SCRIPT]: ok('src:none\n') });
    await expect(readKubeconfig(host, ssh('cp1'), { source: 'auto' }, new SudoRejections())).rejects.toThrow(
      'Keine kubeconfig auf k8s-cp1 gefunden (geprüft: $KUBECONFIG, ~/.kube/config, /etc/kubernetes/admin.conf).');
  });
});

describe('readKubeconfig path', () => {
  it('expands ~/ against the remote home directory', async () => {
    const calls: string[] = [];
    const host = fakeHost({ 'cat --': ok(CONFIG_YAML) }, calls);
    const result = await readKubeconfig(host, ssh('cp1'), { source: 'path', path: '~/k/config' }, new SudoRejections());
    expect(calls[0]).toContain('cat --');
    expect(calls[0]).toContain('"$HOME"');
    expect(result).toEqual({ text: CONFIG_YAML, source: '~/k/config' });
  });

  it('reads an absolute path with cat', async () => {
    const calls: string[] = [];
    const host = fakeHost({ 'cat -- /etc/x': ok(CONFIG_YAML) }, calls);
    await readKubeconfig(host, ssh('cp1'), { source: 'path', path: '/etc/x' }, new SudoRejections());
    expect(calls[0]).toBe('cat -- /etc/x');
  });

  it('names the path and host when the file cannot be read', async () => {
    const host = fakeHost({ 'cat --': { code: 1, stdout: '', stderr: 'No such file' } });
    await expect(readKubeconfig(host, ssh('cp1'), { source: 'path', path: '/etc/x' }, new SudoRejections())).rejects.toThrow(
      'Die kubeconfig „/etc/x“ auf k8s-cp1 konnte nicht gelesen werden.');
  });
});

describe('openAccess', () => {
  it('fails over to the second access host when the first cannot be opened', async () => {
    const cp2 = fakeHost({ [AUTO_SCRIPT]: ok(`src:/x\n${CONFIG_YAML}`) });
    const cp1 = fakeHost({});
    const deps = dependencies({ cp1: ssh('cp1'), cp2: ssh('cp2') }, async connection => {
      if (connection.id === 'cp1') throw new Error('Timed out');
      return cp2;
    });
    const access = await openAccess(cluster(['cp1', 'cp2']), deps);
    expect(access.connection.id).toBe('cp2');
    expect(access.kubeconfig).toBe(CONFIG_YAML);
    expect(access.source).toBe('/x');
    expect(cp1.run).not.toHaveBeenCalled();
  });

  it('reports every failed host when none can be opened', async () => {
    const deps = dependencies({ cp1: ssh('cp1'), cp2: ssh('cp2') }, async connection => {
      const error = Object.assign(new Error('timeout'), { level: 'client-timeout' });
      throw error;
    });
    await expect(openAccess(cluster(['cp1', 'cp2']), deps)).rejects.toThrow(
      'Keiner der Zugangs-Hosts erreichbar (k8s-cp1: Zeitüberschreitung beim Verbindungsaufbau., k8s-cp2: Zeitüberschreitung beim Verbindungsaufbau.).');
  });

  it('skips deleted, disabled and non-SSH access hosts', async () => {
    const deps = dependencies({ gone: undefined, off: ssh('off', { disabled: true }), other: { ...ssh('other'), protocol: 'sftp' } as unknown as SshConnectionNode }, async () => fakeHost({}));
    await expect(openAccess(cluster(['gone', 'off', 'other']), deps)).rejects.toThrow('Der Cluster hat keine gültige SSH-Verbindung als Zugang.');
    expect(deps.openRemote).not.toHaveBeenCalled();
  });

  it('closes a host whose kubeconfig failed and tries the next one', async () => {
    const cp1 = fakeHost({ [AUTO_SCRIPT]: { code: 1, stdout: '', stderr: 'boom' } });
    const cp2 = fakeHost({ [AUTO_SCRIPT]: ok(`src:/x\n${CONFIG_YAML}`) });
    const deps = dependencies({ cp1: ssh('cp1'), cp2: ssh('cp2') }, async connection => connection.id === 'cp1' ? cp1 : cp2);
    const access = await openAccess(cluster(['cp1', 'cp2']), deps);
    expect(cp1.close).toHaveBeenCalledTimes(1);
    expect(access.connection.id).toBe('cp2');
  });

  it('reports each tried host in order through onTry and skips the ones it does not try', async () => {
    const cp3 = fakeHost({ [AUTO_SCRIPT]: ok(`src:/x\n${CONFIG_YAML}`) });
    const deps = dependencies({ gone: undefined, cp1: ssh('cp1'), off: ssh('off', { disabled: true }), cp3: ssh('cp3') },
      async connection => { if (connection.id === 'cp1') throw new Error('Timed out'); return cp3; });
    const tried: string[] = [];
    await openAccess(cluster(['gone', 'cp1', 'off', 'cp3']), deps, name => {
      // Called right before openRemote.
      expect(deps.openRemote).toHaveBeenCalledTimes(tried.length);
      tried.push(name);
    });
    expect(tried).toEqual(['k8s-cp1', 'k8s-cp3']);
  });

  it('stops at a configuration error instead of trying the next host', async () => {
    const cp1 = fakeHost({ [AUTO_SCRIPT]: ok('src:sudo\n'), 'sudo -n cat': { code: 1, stdout: '', stderr: 'sudo: a password is required' } });
    const cp2 = fakeHost({ [AUTO_SCRIPT]: ok(`src:/x\n${CONFIG_YAML}`) });
    const deps = dependencies({ cp1: ssh('cp1'), cp2: ssh('cp2') }, async connection => connection.id === 'cp1' ? cp1 : cp2);
    await expect(openAccess(cluster(['cp1', 'cp2']), deps)).rejects.toThrow('sudo verlangt ein Passwort');
    expect(cp1.close).toHaveBeenCalledTimes(1);
    expect(cp2.run).not.toHaveBeenCalled();
  });
});

describe('AUTO_SCRIPT', () => {
  // Runs the real script through sh where one is installed; the unit tests above only match substrings.
  const sh = spawnSync('sh', ['-c', 'true']).error ? undefined : 'sh';
  it.skipIf(!sh)('is valid POSIX sh', () => {
    expect(spawnSync('sh', ['-n', '-c', AUTO_SCRIPT], { encoding: 'utf8' }).stderr).toBe('');
  });
  it.skipIf(!sh)('reports src:none without any kubeconfig', () => {
    const result = spawnSync('sh', ['-c', AUTO_SCRIPT], { encoding: 'utf8', env: { ...process.env, KUBECONFIG: '', HOME: '/nonexistent-terminus-home' } });
    expect(result.stdout.trim()).toMatch(/^src:(none|sudo)$/);
  });
});
