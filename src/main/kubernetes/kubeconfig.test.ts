import { afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { KubeConfig } from '@kubernetes/client-node';
import type { User } from '@kubernetes/client-node';
import { KubeInputError, execCommandLine, kubeconfigSecrets, listContexts, parseKubeconfig } from './kubeconfig';
import type { KubeconfigPolicy } from './kubeconfig';

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
    expect(() => parseKubeconfig(config('https://h:6443'), 'missing')).toThrowError(expect.objectContaining({ code: 'kubernetes.contextMissing', params: { name: 'missing', available: 'admin@k8s, other' } }));
    expect(() => parseKubeconfig(config('https://h:6443', 'exec:\n      command: kubelogin'))).toThrowError(expect.objectContaining({ code: 'kubernetes.loginPluginUnsupported' }));
    expect(() => parseKubeconfig(config('http://h:8080'))).toThrow(KubeInputError);
    expect(() => parseKubeconfig(': : :')).toThrowError(expect.objectContaining({ code: 'kubernetes.kubeconfigInvalid' }));
  });
  it('rejects certificate files that only exist on cp1 and points to embedded certificates', () => {
    const message = expect.objectContaining({ code: 'kubernetes.certFilesUnsupported' });
    const withFiles = (cluster: string, user: string) => `
apiVersion: v1
kind: Config
clusters:
- name: k8s
  cluster:
    server: https://h:6443
    ${cluster}
contexts:
- name: admin@k8s
  context: { cluster: k8s, user: admin }
current-context: admin@k8s
users:
- name: admin
  user:
    ${user}
`;
    expect(() => parseKubeconfig(withFiles('certificate-authority: /etc/kubernetes/pki/ca.crt', 'client-certificate-data: Y2VydA==\n    client-key-data: a2V5'))).toThrowError(message);
    expect(() => parseKubeconfig(withFiles('certificate-authority-data: Y2E=', 'client-certificate: /etc/kubernetes/pki/admin.crt\n    client-key-data: a2V5'))).toThrowError(message);
    expect(() => parseKubeconfig(withFiles('certificate-authority-data: Y2E=', 'client-certificate-data: Y2VydA==\n    client-key: /etc/kubernetes/pki/admin.key'))).toThrowError(message);
  });
  it('never puts secrets into error messages', () => {
    try { parseKubeconfig(config('https://h:6443', 'token: SECRET-TOKEN'), 'missing'); } catch (error) { expect(String(error)).not.toContain('SECRET'); }
  });
});

describe('listContexts', () => {
  it('lists context names without credentials', () => {
    expect(listContexts(config('https://h:6443'))).toEqual({ contexts: ['admin@k8s', 'other'], currentContext: 'admin@k8s', clusterName: 'k8s', execCommands: {} });
  });
});

const INLINE: KubeconfigPolicy = { source: 'inline' };
const code = (c: string, params?: Record<string, unknown>) => expect.objectContaining({ code: c, ...(params ? { params } : {}) });
const full = (opts: { cluster?: string; user?: string } = {}) => `
apiVersion: v1
kind: Config
clusters:
- name: k8s
  cluster:
    server: https://h:6443
    certificate-authority-data: Y2E=
    ${opts.cluster ?? ''}
contexts:
- name: c1
  context: { cluster: k8s, user: u1 }
current-context: c1
users:
- name: u1
  user:
    ${opts.user ?? 'token: tok'}
`;
const EXEC = 'exec:\n      apiVersion: client.authentication.k8s.io/v1\n      command: /usr/bin/login\n      args: [a, b]\n      env:\n      - { name: K, value: SECRET-ENV }';
const execUser = (exec: unknown) => ({ name: 'u', exec }) as unknown as User;

describe('token-file (B-1)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'kube-tf-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const secretFile = path.join(dir, 'secret.txt').replace(/\\/g, '/');
  writeFileSync(secretFile, 'LOCAL-FILE-CONTENT');
  const withTokenFile = (key: string) => `
apiVersion: v1
kind: Config
clusters:
- { name: k8s, cluster: { server: 'https://h:6443' } }
contexts:
- { name: c1, context: { cluster: k8s, user: good } }
current-context: c1
users:
- { name: good, user: { token: t } }
- name: other
  user:
    ${key}: ${secretFile}
`;
  it('refuses token-file for every policy, entry point and escaped key', () => {
    for (const key of ['token-file', '"token\\x2dfile"']) {
      const text = withTokenFile(key);
      for (const policy of [{ source: 'ssh' }, INLINE, { source: 'file', dir }] as KubeconfigPolicy[]) {
        expect(() => parseKubeconfig(text, undefined, policy)).toThrowError(code('kubernetes.tokenFileUnsupported'));
      }
      expect(() => listContexts(text)).toThrowError(code('kubernetes.tokenFileUnsupported'));
      expect(kubeconfigSecrets(text)).toEqual([]);
    }
  });
  it('resolves js-yaml to the same file for us and for client-node', () => {
    const here = createRequire(import.meta.url).resolve('js-yaml');
    const clientNode = createRequire(createRequire(import.meta.url).resolve('@kubernetes/client-node')).resolve('js-yaml');
    expect(clientNode).toBe(here);
  });
});

describe('parseKubeconfig policies', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'kube-pol-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const consent = 'K=SECRET-ENV /usr/bin/login a b';

  it('exec: refused over ssh, needs consent inline, allowed for file', () => {
    const text = full({ user: EXEC });
    expect(() => parseKubeconfig(text)).toThrowError(code('kubernetes.loginPluginUnsupported'));
    expect(() => parseKubeconfig(text, undefined, INLINE)).toThrowError(code('kubernetes.loginPluginNeedsConsent', { command: '/usr/bin/login' }));
    expect(() => parseKubeconfig(text, undefined, { source: 'inline', execConsent: 'other' })).toThrowError(code('kubernetes.loginPluginNeedsConsent'));
    expect(parseKubeconfig(text, undefined, { source: 'inline', execConsent: consent }).contextName).toBe('c1');
    expect(parseKubeconfig(text, undefined, { source: 'file', dir }).contextName).toBe('c1');
  });
  it('never puts env values into the consent error', () => {
    let seen = '';
    try { parseKubeconfig(full({ user: EXEC }), undefined, INLINE); } catch (error) { seen = JSON.stringify(error) + String(error); }
    expect(seen).toContain('loginPluginNeedsConsent');
    expect(seen).not.toContain('SECRET-ENV');
  });
  it('auth-provider (also name: exec) is refused everywhere', () => {
    const text = full({ user: 'auth-provider: { name: exec, config: { exec: { command: x } } }' });
    expect(() => parseKubeconfig(text)).toThrowError(code('kubernetes.loginPluginUnsupported'));
    expect(() => parseKubeconfig(text, undefined, INLINE)).toThrowError(code('kubernetes.authProviderUnsupported'));
    expect(() => parseKubeconfig(text, undefined, { source: 'file', dir })).toThrowError(code('kubernetes.authProviderUnsupported'));
  });
  it('rejects malformed exec blocks', () => {
    for (const user of ['exec: { command: "" }', 'exec: { command: x, args: nope }', 'exec: { command: x, env: nope }', 'exec: { args: [a] }']) {
      expect(() => parseKubeconfig(full({ user }), undefined, INLINE)).toThrowError(code('kubernetes.loginPluginUnsupported'));
    }
  });
  it('relative exec commands: refused inline, resolved against dir for file', () => {
    const text = full({ user: 'exec: { apiVersion: client.authentication.k8s.io/v1, command: ./bin/login }' });
    expect(() => parseKubeconfig(text, undefined, INLINE)).toThrowError(code('kubernetes.loginPluginNotStarted', { command: './bin/login' }));
    const built = parseKubeconfig(text, undefined, { source: 'file', dir }).build(null);
    expect(built.getCurrentUser()?.exec.command).toBe(path.resolve(dir, './bin/login'));
  });
  it('replaces execFn so plugins run without a console window', () => {
    const find = (config: unknown) => (config as { authenticators: object[] }).authenticators.find(item => 'execFn' in item) as { execFn: unknown };
    const built = parseKubeconfig(full({ user: EXEC }), undefined, { source: 'file', dir }).build(null);
    const untouched = new KubeConfig();
    untouched.loadFromOptions({ clusters: [], users: [], contexts: [] });
    expect(find(built).execFn).not.toBe(find(untouched).execFn);
  });
  it('certificate files: refused inline, absolute for file, dropped when -data is there', () => {
    const files = full({ cluster: 'certificate-authority: ca.crt', user: 'client-certificate-data: Y2VydA==\n    client-key: keys/k.key' });
    expect(() => parseKubeconfig(files, undefined, INLINE)).toThrowError(code('kubernetes.certFilesUnsupported'));
    const built = parseKubeconfig(files, undefined, { source: 'file', dir }).build(null);
    expect(built.getCurrentUser()?.keyFile).toBe(path.resolve(dir, 'keys/k.key'));
    expect(built.getCurrentCluster()?.caFile).toBe(path.resolve(dir, 'ca.crt'));
    const both = full({ cluster: 'certificate-authority: /x/ca.crt', user: 'client-certificate-data: Y2VydA==\n    client-key-data: a2V5\n    client-key: /x/k.key' });
    for (const policy of [{ source: 'ssh' }, INLINE] as KubeconfigPolicy[]) {
      const built2 = parseKubeconfig(both, undefined, policy).build(1);
      expect(built2.getCurrentUser()?.keyFile).toBeUndefined();
      expect(built2.getCurrentCluster()?.caFile).toBeUndefined();
      expect(built2.getCurrentCluster()?.caData).toBe('Y2E=');
    }
  });
  it('skip-tls and proxy-url: passed through for ssh, refused otherwise', () => {
    const skip = full({ cluster: 'insecure-skip-tls-verify: true' });
    const proxy = full({ cluster: 'proxy-url: http://p:3128' });
    expect(parseKubeconfig(skip).build(1).getCurrentCluster()?.skipTLSVerify).toBe(true);
    expect(parseKubeconfig(proxy).build(1).getCurrentCluster()?.proxyUrl).toBe('http://p:3128');
    for (const policy of [INLINE, { source: 'file', dir }] as KubeconfigPolicy[]) {
      expect(() => parseKubeconfig(skip, undefined, policy)).toThrowError(code('kubernetes.tlsVerifyRequired'));
      expect(() => parseKubeconfig(proxy, undefined, policy)).toThrowError(code('kubernetes.proxyUnsupported'));
    }
  });
  it('build(null) keeps the server and only sets a TLS name that was given', () => {
    const plain = parseKubeconfig(full(), undefined, INLINE).build(null).getCurrentCluster()!;
    expect(plain.server).toBe('https://h:6443');
    expect(plain.tlsServerName).toBeUndefined();
    expect(parseKubeconfig(full({ cluster: 'tls-server-name: named' }), undefined, INLINE).build(null).getCurrentCluster()!.tlsServerName).toBe('named');
    expect(parseKubeconfig(full(), undefined, INLINE).build(null, 'kubernetes').getCurrentCluster()!.tlsServerName).toBe('kubernetes');
  });
});

describe('execCommandLine', () => {
  it('is unambiguous', () => {
    const line = (command: string, args?: string[], env?: { name: string; value: string }[]) => execCommandLine(execUser({ command, args, env }));
    expect(line('c', ['a b'])).not.toBe(line('c', ['a', 'b']));
    expect(line('c', [], [{ name: 'A', value: '1' }, { name: 'B', value: '2' }])).not.toBe(line('c', [], [{ name: 'B', value: '2' }, { name: 'A', value: '1' }]));
    expect(line('c', [], [{ name: 'A', value: 'x=y' }])).not.toBe(line('c', ['A=x=y']));
    expect(line('A=c')).not.toBe(line('c', [], [{ name: 'A', value: '' }]));
    expect(line('/usr/bin/x', ['--n=1'])).toBe('/usr/bin/x "--n=1"');
  });
  it('is undefined without a usable command', () => {
    expect(execCommandLine(execUser(undefined))).toBeUndefined();
    expect(execCommandLine(execUser({ command: '' }))).toBeUndefined();
  });
});

describe('listContexts secrets and exec', () => {
  it('lists the exec line per context and leaks no credentials otherwise', () => {
    const json = JSON.stringify(listContexts(full({ user: 'token: TOP-SECRET\n    client-key-data: KEYDATA-SECRET' })));
    expect(json).not.toMatch(/TOP-SECRET|KEYDATA-SECRET|Y2E=/);
    expect(listContexts(full({ user: EXEC })).execCommands).toEqual({ c1: 'K=SECRET-ENV /usr/bin/login a b' });
  });
});

describe('kubeconfigSecrets', () => {
  it('collects token, password, key data and auth-provider tokens; [] on errors', () => {
    expect(kubeconfigSecrets(full({ user: 'token: T1\n    password: P1\n    client-key-data: K1' })).sort()).toEqual(['K1', 'P1', 'T1']);
    expect(kubeconfigSecrets(full({ user: 'auth-provider: { name: oidc, config: { id-token: I1, refresh-token: R1, other: O } }' })).sort()).toEqual(['I1', 'R1']);
    expect(kubeconfigSecrets(': : :')).toEqual([]);
  });
});
