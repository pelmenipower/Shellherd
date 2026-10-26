// Synthetic Kubernetes API server for the run-app skill. HTTPS on 127.0.0.1 only, read-only (writes get 403); pods/portforward over WebSocket; pods/log with timestamps and follow; a SelfSubjectRulesReview; one Argo CD Application.
// The certificate is generated per start with openssl into the run dir; nothing secret lives in the repo.
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { SHOP_RULES, buildCluster, checkoutLog, checkoutPreviousLog } from './kube-fixtures.mjs';

export const KUBE_SERVER = 'https://k8s-cp1:6443';
export const KUBE_TOKEN = 'synthetic-kube-token';
/** Method, path and query of every API request, one per line; headers are never written. In the fake's dir (run dir/kube). */
export const KUBE_REQUEST_LOG = 'kube-requests.log';
// Running pods serve one synthetic text page on this port; every other port is refused like by a kubelet.
export const POD_HTTP_PORT = 8080;
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
  'v1': { pods: 'Pod', services: 'Service', nodes: 'Node', events: 'Event', namespaces: 'Namespace', secrets: 'Secret' },
  'apps/v1': { deployments: 'Deployment', statefulsets: 'StatefulSet', daemonsets: 'DaemonSet' },
  'batch/v1': { jobs: 'Job', cronjobs: 'CronJob' },
  'networking.k8s.io/v1': { ingresses: 'Ingress' },
  'argoproj.io/v1alpha1': { applications: 'Application' },
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
  const requests = [];
  const requestLog = path.join(dir, KUBE_REQUEST_LOG);
  writeFileSync(requestLog, ''); // shortcut: truncated per start, so a scene reads only its own requests
  const podPage = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`synthetic pod page ${req.url}\n`);
  });
  await new Promise((resolve, reject) => { podPage.once('error', reject); podPage.listen(0, '127.0.0.1', resolve); });
  // Port forward like the kubelet (v4.channel.k8s.io): channel 0 data, channel 1 errors, each opened with the port (2 bytes, little endian).
  const forwards = new WebSocketServer({ noServer: true, handleProtocols: protocols => (protocols.has('v4.channel.k8s.io') ? 'v4.channel.k8s.io' : false) });
  const portFrame = (channel, port) => Buffer.from([channel, port & 0xff, port >> 8]);
  const relay = (ws, port) => {
    ws.on('error', () => ws.terminate());
    ws.send(portFrame(0, port));
    ws.send(portFrame(1, port));
    if (port !== POD_HTTP_PORT) {
      ws.send(Buffer.concat([Buffer.from([1]), Buffer.from(`error forwarding port ${port} to pod: connect: connection refused`)]));
      ws.close();
      return;
    }
    const upstream = net.connect(podPage.address().port, '127.0.0.1');
    upstream.on('data', chunk => ws.send(Buffer.concat([Buffer.from([0]), chunk])));
    upstream.on('close', () => ws.close());
    upstream.on('error', () => ws.close());
    ws.on('message', data => {
      const frame = Buffer.from(data);
      if (frame[0] === 0 && frame.length > 1) upstream.write(frame.subarray(1));
    });
    ws.on('close', () => upstream.destroy());
  };
  const upgrade = (req, socket, head) => {
    socket.on('error', () => socket.destroy());
    const refuse = code => socket.end(`HTTP/1.1 ${code} ${http.STATUS_CODES[code]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    if (req.headers.authorization !== `Bearer ${KUBE_TOKEN}`) return refuse(401);
    const url = new URL(req.url ?? '/', 'https://k8s-cp1');
    const match = /^\/api\/v1\/namespaces\/([^/]+)\/pods\/([^/]+)\/portforward$/.exec(url.pathname);
    const pod = match && data.pods.find(item => item.metadata.namespace === match[1] && item.metadata.name === match[2]);
    if (!pod) return refuse(404);
    // A pod without a running container cannot be reached; the API server answers 400 (report-0 is Pending).
    if (pod.status.phase !== 'Running') return refuse(400);
    const port = Number(url.searchParams.get('ports'));
    if (!Number.isInteger(port) || port < 1 || port > 65535) return refuse(400);
    forwards.handleUpgrade(req, socket, head, ws => relay(ws, port));
  };

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

  // SelfSubjectRulesReview: shop has fixed rules, monitoring answers incomplete (like a webhook authorizer), every other namespace is forbidden.
  const rulesReview = (req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let namespace;
      try { namespace = JSON.parse(body).spec?.namespace; } catch { namespace = undefined; }
      if (namespace !== 'shop' && namespace !== 'monitoring') {
        return json(res, 403, status(403, 'Forbidden', `selfsubjectrulesreviews.authorization.k8s.io is forbidden in namespace "${namespace}"`));
      }
      const result = namespace === 'shop'
        ? { incomplete: false, resourceRules: SHOP_RULES, nonResourceRules: [] }
        : { incomplete: true, evaluationError: 'webhook authorizer does not support user rule resolution', resourceRules: [], nonResourceRules: [] };
      json(res, 201, { apiVersion: 'authorization.k8s.io/v1', kind: 'SelfSubjectRulesReview', spec: { namespace }, status: result });
    });
  };

  const handle = (req, res) => {
    const url = new URL(req.url ?? '/', 'https://k8s-cp1');
    // What Shellherd asked for, so tests and scenes can prove it never asked for secrets.
    const asked = `${req.method} ${url.pathname}${url.search}`;
    requests.push(asked);
    appendFileSync(requestLog, `${asked}\n`);
    const pathname = url.pathname.toLowerCase();
    const query = url.searchParams;
    if (req.headers.authorization !== `Bearer ${KUBE_TOKEN}`) return json(res, 401, status(401, 'Unauthorized'));
    const parts = pathname.split('/').filter(Boolean);
    const resourceName = /\/namespaces\/[^/]+\/([^/]+)/.exec(pathname)?.[1] ?? parts.find((_, i) => i >= (parts[0] === 'api' ? 2 : 3)) ?? '';
    if (req.method === 'POST' && pathname === '/apis/authorization.k8s.io/v1/selfsubjectrulesreviews') return rulesReview(req, res);
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
      // timestamps=true (logs of all pods): RFC 3339 with nine digits like the kubelet, tailLines respected, one new line every 2 s while following.
      if (query.get('timestamps') === 'true') {
        const podIndex = data.pods.indexOf(pod);
        const base = Date.now() - 60_000;
        const stamp = i => new Date(base + i * 4000 + podIndex * 900).toISOString().replace(/Z$/, '456789Z');
        const text = i => `${stamp(i)} ${i % 5 === 4 ? 'ERROR' : 'INFO'} ${pod.metadata.name} handled request ${1000 + i} in ${12 + (i % 40)} ms\n`;
        const tail = Math.min(Number(query.get('tailLines') ?? 15), 15);
        const first = Array.from({ length: tail }, (_, k) => text(15 - tail + k)).join('');
        if (query.get('follow') !== 'true') return json(res, 200, first, 'text/plain');
        hold(res, req, 300, 'text/plain', first);
        let next = 15;
        const timer = setInterval(() => { if (!res.writableEnded) res.write(text(next++)); }, 2000);
        res.on('close', () => clearInterval(timer));
        return;
      }
      // previous=true: only a restarted container has one (the API server answers 400 otherwise); checkout tells why it crashed.
      if (query.get('previous') === 'true') {
        if (!pod.status.containerStatuses?.some(item => item.restartCount > 0)) {
          return json(res, 400, status(400, 'BadRequest', `previous terminated container "${query.get('container')}" in pod "${name}" not found`));
        }
        return json(res, 200, checkoutPreviousLog(), 'text/plain');
      }
      if (query.get('follow') !== 'true' && name.startsWith('checkout-')) return json(res, 200, checkoutLog(), 'text/plain');
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
  server.on('upgrade', upgrade);
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
    requests,
    close: () => new Promise(resolve => {
      for (const res of open) res.end();
      for (const client of forwards.clients) client.terminate();
      podPage.closeAllConnections();
      podPage.close();
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
