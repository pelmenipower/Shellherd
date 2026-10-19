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
    expect(listContexts(config('https://h:6443'))).toEqual({ contexts: ['admin@k8s', 'other'], currentContext: 'admin@k8s', clusterName: 'k8s' });
  });
});
