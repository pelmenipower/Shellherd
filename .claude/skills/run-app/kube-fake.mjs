// Synthetic Kubernetes API server for the run-app skill. HTTPS on 127.0.0.1 only, read-only (writes get 403).
// The certificate is generated per start with openssl into the run dir; nothing secret lives in the repo.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildCluster } from './kube-fixtures.mjs';

export const KUBE_SERVER = 'https://k8s-cp1:6443';
export const KUBE_TOKEN = 'synthetic-kube-token';
const RUN_DIR = process.env.SHELLHERD_RUN_DIR ?? path.join(os.tmpdir(), 'shellherd-run');

const probe = candidate => {
  try { execFileSync(candidate, ['version'], { stdio: 'pipe', timeout: 5000 }); return true; } catch { return false; }
};

export function findOpenssl() {
  const candidates = [process.env.OPENSSL, 'openssl', 'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe', 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe'];
  return candidates.find(candidate => candidate && probe(candidate)) ?? null;
}

// plural → [apiVersion, kind, fixture key]; the group/version in the URL decides which table applies.
const RESOURCES = {
  'v1': { pods: 'Pod', services: 'Service', nodes: 'Node', events: 'Event', namespaces: 'Namespace' },
  'apps/v1': { deployments: 'Deployment', statefulsets: 'StatefulSet', daemonsets: 'DaemonSet' },
  'batch/v1': { jobs: 'Job', cronjobs: 'CronJob' },
  'networking.k8s.io/v1': { ingresses: 'Ingress' },
};
const CLUSTER_SCOPED = new Set(['nodes', 'namespaces']);
const singular = plural => plural.replace(/ies$/, 'y').replace(/s$/, '');

const status = (code, reason, message) => ({ kind: 'Status', apiVersion: 'v1', status: 'Failure', reason, code, ...(message ? { message } : {}) });
const VERBS = { POST: 'create', PUT: 'update', PATCH: 'patch', DELETE: 'delete' };

// Matches a "k=v,k2=v2" selector against a dotted-path reader.
const matchSelector = (selector, read) => !selector || selector.split(',').filter(Boolean).every(term => {
  const [key, ...rest] = term.split(/==?/);
  return String(read(key.trim()) ?? '') === rest.join('=').trim();
});
const dig = (object, dotted) => dotted.split('.').reduce((value, part) => (value && typeof value === 'object' ? value[part] : undefined), object);

export async function startKubeFake({ port = 9334, dir = path.join(RUN_DIR, 'kube') } = {}) {
  const openssl = findOpenssl();
  if (!openssl) throw new Error('openssl nicht gefunden (PATH, OPENSSL, Git for Windows)');
  mkdirSync(dir, { recursive: true });
  const keyFile = path.join(dir, 'key.pem');
  const certFile = path.join(dir, 'cert.pem');
  try {
    execFileSync(openssl, ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-subj', '/CN=k8s-cp1',
      '-addext', 'subjectAltName=DNS:k8s-cp1', '-days', '2', '-keyout', keyFile, '-out', certFile],
    { stdio: 'pipe', env: { ...process.env, MSYS2_ARG_CONV_EXCL: '*', MSYS_NO_PATHCONV: '1' } });
  } catch (error) {
    throw new Error(`openssl fehlgeschlagen: ${error.stderr?.toString().trim() || error.message}`);
  }
  const cert = readFileSync(certFile);
  const data = buildCluster();
  const open = new Set();

  const json = (res, code, body, type = 'application/json') => {
    res.writeHead(code, { 'content-type': type });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
  // Headers go out immediately; the stream stays open until `seconds` pass or the server closes.
  const hold = (res, req, seconds, type, first) => {
    res.writeHead(200, { 'content-type': type });
    res.flushHeaders();
    if (first) res.write(first);
    open.add(res);
    const timer = setTimeout(() => res.end(), Math.min(seconds, 300) * 1000);
    req.on('close', () => { clearTimeout(timer); open.delete(res); });
  };

  const handle = (req, res) => {
    const url = new URL(req.url ?? '/', 'https://k8s-cp1');
    const pathname = url.pathname.toLowerCase();
    const query = url.searchParams;
    if (req.headers.authorization !== `Bearer ${KUBE_TOKEN}`) return json(res, 401, status(401, 'Unauthorized'));
    const parts = pathname.split('/').filter(Boolean);
    const resourceName = /\/namespaces\/[^/]+\/([^/]+)/.exec(pathname)?.[1] ?? parts.find((_, i) => i >= (parts[0] === 'api' ? 2 : 3)) ?? '';
    if (req.method !== 'GET') {
      const verb = VERBS[req.method ?? ''] ?? String(req.method).toLowerCase();
      const ns = /\/namespaces\/([^/]+)/.exec(pathname)?.[1];
      return json(res, 403, status(403, 'Forbidden', `${verb} is forbidden: User "admin" cannot ${verb} resource "${resourceName}" in API group "" ${ns ? `in the namespace "${ns}"` : 'at the cluster scope'}`));
    }

    const groupVersion = /^\/(?:api\/(v1)|apis\/([^/]+\/[^/]+))$/.exec(pathname);
    if (groupVersion) {
      const gv = groupVersion[1] ?? groupVersion[2];
      const table = RESOURCES[gv];
      if (!table) return json(res, 404, status(404, 'NotFound'));
      return json(res, 200, {
        kind: 'APIResourceList', apiVersion: 'v1', groupVersion: gv,
        resources: Object.entries(table).map(([name, kind]) => ({ name, singularName: singular(name), namespaced: !CLUSTER_SCOPED.has(name), kind, verbs: ['get', 'list', 'watch'] })),
      });
    }

    const match = /^\/(api\/v1|apis\/[^/]+\/[^/]+)(?:\/namespaces\/([^/]+))?\/([^/]+)(?:\/([^/]+))?(?:\/(log))?$/.exec(pathname);
    if (!match) return json(res, 404, status(404, 'NotFound'));
    const [, prefix, namespace, plural, name, log] = match;
    const gv = prefix === 'api/v1' ? 'v1' : prefix.slice('apis/'.length);

    if (gv === 'metrics.k8s.io/v1beta1') {
      if (plural === 'nodes' && !name) return json(res, 200, { kind: 'NodeMetricsList', apiVersion: gv, items: data.nodeMetrics });
      if (plural === 'pods' && !name) {
        const items = data.podMetrics.filter(item => !namespace || item.metadata.namespace === namespace);
        return json(res, 200, { kind: 'PodMetricsList', apiVersion: gv, items });
      }
      return json(res, 404, status(404, 'NotFound'));
    }

    const kind = RESOURCES[gv]?.[plural];
    if (!kind) return json(res, 404, status(404, 'NotFound'));
    const apiVersion = gv;
    const all = data[plural].filter(item => !namespace || item.metadata.namespace === namespace);

    if (log) {
      const pod = all.find(item => item.metadata.name === name);
      if (plural !== 'pods' || !pod) return json(res, 404, status(404, 'NotFound'));
      const lines = Array.from({ length: 15 }, (_, i) => `2026-10-20T08:${String(10 + i).padStart(2, '0')}:00Z INFO ${pod.metadata.name} handled request ${1000 + i} in ${12 + i} ms\n`).join('');
      if (query.get('follow') === 'true') return hold(res, req, Number(query.get('timeoutSeconds') ?? 300), 'text/plain', lines);
      return json(res, 200, lines, 'text/plain');
    }
    if (name) {
      const item = all.find(entry => entry.metadata.name === name);
      return item ? json(res, 200, { apiVersion, kind, ...item }) : json(res, 404, status(404, 'NotFound'));
    }

    const items = all.filter(item => matchSelector(query.get('labelSelector'), key => item.metadata.labels?.[key])
      && matchSelector(query.get('fieldSelector'), key => dig(item, key)));
    if (query.get('watch') === 'true') {
      const bookmark = { type: 'BOOKMARK', object: { kind, apiVersion, metadata: { resourceVersion: '1' } } };
      return hold(res, req, Number(query.get('timeoutSeconds') ?? 300), 'application/json', `${JSON.stringify(bookmark)}\n`);
    }
    return json(res, 200, { kind: `${kind}List`, apiVersion, metadata: { resourceVersion: '1' }, items });
  };

  const server = https.createServer({ key: readFileSync(keyFile), cert }, handle);
  server.requestTimeout = 0; // watches must outlive Node's default request timeout
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });

  const kubeconfig = [
    'apiVersion: v1', 'kind: Config', 'current-context: prod', 'clusters:', '- name: prod', '  cluster:',
    `    server: ${KUBE_SERVER}`, `    certificate-authority-data: ${cert.toString('base64')}`,
    'contexts:', '- name: prod', '  context: { cluster: prod, user: admin, namespace: shop }',
    'users:', '- name: admin', `  user: { token: ${KUBE_TOKEN} }`, '',
  ].join('\n');

  return {
    port: server.address().port,
    kubeconfig,
    close: () => new Promise(resolve => {
      for (const res of open) res.end();
      server.close(() => resolve());
      server.closeAllConnections();
    }),
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  try {
    const fake = await startKubeFake({ port: Number(process.env.KUBE_FAKE_PORT ?? 9334) });
    console.log(`kube-fake ready on ${fake.port}`);
    process.on('SIGINT', () => fake.close().then(() => process.exit(0)));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
