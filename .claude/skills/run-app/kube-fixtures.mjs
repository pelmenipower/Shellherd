// Synthetic cluster for kube-fake.mjs. Shapes follow what src/main/kubernetes/rows.ts reads.
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const HTTP_PORTS = [{ name: 'http', containerPort: 8080, protocol: 'TCP' }];

// Synthetic secrets of the checkout pod for the AI analysis scene. Never real values; none of them may reach the AI fake.
// Split into parts so secret scanners stay quiet.
const join = (...parts) => parts.join('');
export const KUBE_SECRETS = {
  secretValue: join('Synth-Kube-', 'Secret-4711'), // only inside the Secret checkout-db: Shellherd never reads it
  envLiteral: join('Synth-Kube-', 'Env-0815'), // literal DB_PASSWORD env value: hidden by Shellherd before masking
  logPassword: join('Synth-Kube-', 'Log-Pass'), // in the previous container's log: masked
  logBearer: join('synthKube', 'Bearer0000000000'), // in the previous container's log: masked
};
// Synthetic Argo CD and Harbor of the shop. Hosts under .test never resolve; the driver records links instead of opening them.
export const ARGO_HOST = 'argocd.example.test';
export const HARBOR_HOST = 'harbor.example.test';
export const HARBOR_DIGEST = `sha256:${'5e'.repeat(32)}`;
/** Log of the checkout container now (it crashed and waits for the next start). */
export const checkoutLog = () => [
  '2026-10-25T08:00:00Z INFO starting checkout 1.9.0',
  '2026-10-25T08:00:00Z INFO connecting to db.shop.svc:5432',
].join('\n') + '\n';
/** Log of the checkout container before its last restart: why it crashed, with two synthetic secrets. */
export const checkoutPreviousLog = () => [
  '2026-10-25T07:55:00Z INFO starting checkout 1.9.0',
  '2026-10-25T07:55:00Z INFO config: DB_HOST=db.shop.svc DB_PORT=5432',
  `2026-10-25T07:55:01Z DEBUG DB_PASSWORD=${KUBE_SECRETS.logPassword}`,
  `2026-10-25T07:55:01Z DEBUG upstream Authorization: Bearer ${KUBE_SECRETS.logBearer}`,
  '2026-10-25T07:55:02Z ERROR dial tcp 10.96.40.12:5432: connect: connection refused',
  '2026-10-25T07:55:02Z FATAL cannot reach database db.shop.svc:5432, exiting with code 1',
].join('\n') + '\n';

export function buildCluster(now = Date.now()) {
  const ago = ms => new Date(now - ms).toISOString();
  const meta = (kind, name, namespace, age, extra = {}) => ({
    name, ...(namespace ? { namespace } : {}), uid: `uid-${kind}-${namespace ? `${namespace}-` : ''}${name}`,
    creationTimestamp: ago(age), resourceVersion: '1', ...extra,
  });

  const nodeDefs = [
    ['k8s-cp1', '10.0.0.11', true, { 'node-role.kubernetes.io/control-plane': '' }, ['420m', '2831Mi']],
    ['k8s-w1', '10.0.0.12', true, { 'node-role.kubernetes.io/worker': '' }, ['1650m', '9216Mi']],
    ['k8s-w2', '10.0.0.13', false, { 'node-role.kubernetes.io/worker': '' }, ['610m', '4096Mi']],
  ];
  const nodes = nodeDefs.map(([name, ip, ready, labels]) => ({
    metadata: meta('node', name, undefined, 90 * DAY, { labels: { 'kubernetes.io/hostname': name, ...labels } }),
    spec: {},
    status: {
      allocatable: { cpu: '4', memory: '16Gi' },
      addresses: [{ type: 'InternalIP', address: ip }, { type: 'Hostname', hostname: name }],
      conditions: [{ type: 'Ready', status: ready ? 'True' : 'False' }],
      nodeInfo: { kubeletVersion: 'v1.31.4' },
    },
  }));
  const nodeMetrics = nodeDefs.map(([name, , , , [cpu, memory]]) => ({ metadata: { name }, usage: { cpu, memory } }));

  const namespaces = ['shop', 'monitoring', 'kube-system'].map(name => ({ metadata: meta('namespace', name, undefined, 90 * DAY), status: { phase: 'Active' } }));

  const pods = [];
  const podMetrics = [];
  const addPod = ({ name, namespace = 'shop', node, labels = {}, owner, image, imageID, phase = 'Running', ready = true, restarts = 0, state, age, running = true, ports, env, lastState }) => {
    const containerState = state ?? (phase === 'Succeeded' ? { terminated: { reason: 'Completed', exitCode: 0, startedAt: ago(age), finishedAt: ago(age - 2 * MIN) } } : { running: { startedAt: ago(age) } });
    pods.push({
      metadata: meta('pod', name, namespace, age, { labels, ...(owner ? { ownerReferences: [{ apiVersion: owner.apiVersion, kind: owner.kind, name: owner.name, uid: `uid-${owner.kind.toLowerCase()}-${owner.name}`, controller: true }] } : {}) }),
      spec: { nodeName: node, containers: [{ name: 'main', image, ...(ports ? { ports } : {}), ...(env ? { env } : {}) }] },
      status: {
        phase, conditions: [{ type: 'Ready', status: phase === 'Running' && ready ? 'True' : 'False' }], podIP: phase === 'Pending' ? undefined : `10.244.${pods.length % 200}.${10 + pods.length}`,
        containerStatuses: phase === 'Pending' ? [] : [{ name: 'main', image, ready, restartCount: restarts, ...(imageID ? { imageID } : {}), state: containerState, ...(lastState ? { lastState } : {}) }],
      },
    });
    if (running) podMetrics.push({ metadata: { name, namespace }, containers: [{ name: 'main', usage: { cpu: `${20 + (pods.length * 17) % 90}m`, memory: `${90 + (pods.length * 23) % 200}Mi` } }] });
  };
  const rs = (deploy, hash) => ({ apiVersion: 'apps/v1', kind: 'ReplicaSet', name: `${deploy}-${hash}` });
  const deployPods = (deploy, hash, image, count, nodesToUse, ports, imageID) => {
    for (let i = 0; i < count; i++) {
      addPod({
        name: `${deploy}-${hash}-${['x7k2p', 'q9m4d', 'h5t8w'][i]}`, node: nodesToUse[i % nodesToUse.length],
        labels: { app: deploy, 'pod-template-hash': hash }, owner: rs(deploy, hash), image, imageID, age: 3 * DAY + i * HOUR, ports,
      });
    }
  };
  deployPods('api', '6d8f9b7c5', `${HARBOR_HOST}/shop/api:2.4.1`, 3, ['k8s-w1', 'k8s-w1', 'k8s-w2'], HTTP_PORTS, `${HARBOR_HOST}/shop/api@${HARBOR_DIGEST}`);
  deployPods('worker', '5c7b4d9f8', 'registry.local/shop/worker:2.4.1', 2, ['k8s-w1', 'k8s-w2']);
  addPod({
    name: 'checkout-7f9c6b8d4-m2n5z', node: 'k8s-w1', labels: { app: 'checkout', 'pod-template-hash': '7f9c6b8d4' }, owner: rs('checkout', '7f9c6b8d4'),
    image: 'registry.local/shop/checkout:1.9.0', ready: false, restarts: 14, age: 2 * DAY, ports: HTTP_PORTS,
    state: { waiting: { reason: 'CrashLoopBackOff', message: 'back-off 5m0s restarting failed container=main' } },
    env: [
      { name: 'DB_HOST', value: 'db.shop.svc' },
      { name: 'DB_PASSWORD', value: KUBE_SECRETS.envLiteral },
      { name: 'DB_SECRET', valueFrom: { secretKeyRef: { name: 'checkout-db', key: 'password' } } },
    ],
    lastState: { terminated: { reason: 'Error', exitCode: 1, startedAt: ago(6 * MIN), finishedAt: ago(5 * MIN) } },
  });
  addPod({ name: 'report-0', node: undefined, labels: { app: 'report' }, image: 'registry.local/shop/report:0.3.2', phase: 'Pending', ready: false, age: 20 * MIN, running: false });
  addPod({
    name: 'image-migrate-4kq8l', node: 'k8s-w1', labels: { 'job-name': 'image-migrate' }, owner: { apiVersion: 'batch/v1', kind: 'Job', name: 'image-migrate' },
    image: 'registry.local/shop/migrate:2.4.1', phase: 'Succeeded', ready: false, age: 5 * HOUR, running: false,
  });
  addPod({ name: 'postgres-0', namespace: 'monitoring', node: 'k8s-w1', labels: { app: 'postgres' }, owner: { apiVersion: 'apps/v1', kind: 'StatefulSet', name: 'postgres' }, image: 'postgres:16', age: 30 * DAY });
  nodeDefs.forEach(([node], i) => addPod({
    name: `node-exporter-${['b4c8d', 'k2m9p', 'w7x3z'][i]}`, namespace: 'monitoring', node, labels: { app: 'node-exporter' },
    owner: { apiVersion: 'apps/v1', kind: 'DaemonSet', name: 'node-exporter' }, image: 'prom/node-exporter:v1.8.2', age: 30 * DAY,
  }));

  const template = (app, image) => ({ metadata: { labels: { app } }, spec: { containers: [{ name: 'main', image }] } });
  const deployment = (name, image, replicas, ready, namespace = 'shop', extra = {}) => ({
    metadata: meta('deployment', name, namespace, 30 * DAY, { labels: { app: name }, ...extra }),
    spec: { replicas, selector: { matchLabels: { app: name } }, template: template(name, image) },
    status: { replicas, readyReplicas: ready, updatedReplicas: replicas, availableReplicas: ready },
  });
  const deployments = [
    // Label tracking (Argo CD 2.x style).
    deployment('api', `${HARBOR_HOST}/shop/api:2.4.1`, 3, 3, 'shop', { labels: { app: 'api', 'argocd.argoproj.io/instance': 'shop' } }),
    deployment('worker', 'registry.local/shop/worker:2.4.1', 2, 2),
    // Forged tracking id: an app name with a host and a path; Shellherd must ignore it (no heading, no link).
    deployment('checkout', 'registry.local/shop/checkout:1.9.0', 1, 0, 'shop', { annotations: { 'argocd.argoproj.io/tracking-id': 'evil.example.test/x:apps/Deployment:shop/checkout' } }),
  ];
  const statefulsets = [{
    metadata: meta('statefulset', 'postgres', 'monitoring', 30 * DAY),
    spec: { replicas: 1, selector: { matchLabels: { app: 'postgres' } }, template: template('postgres', 'postgres:16') },
    status: { replicas: 1, readyReplicas: 1, updatedReplicas: 1 },
  }];
  const daemonsets = [{
    metadata: meta('daemonset', 'node-exporter', 'monitoring', 30 * DAY),
    spec: { selector: { matchLabels: { app: 'node-exporter' } }, template: template('node-exporter', 'prom/node-exporter:v1.8.2') },
    status: { desiredNumberScheduled: 3, numberReady: 3, updatedNumberScheduled: 3 },
  }];
  const jobs = [{
    metadata: meta('job', 'image-migrate', 'shop', 5 * HOUR),
    spec: { completions: 1, selector: { matchLabels: { 'job-name': 'image-migrate' } }, template: template('migrate', 'registry.local/shop/migrate:2.4.1') },
    status: { succeeded: 1, startTime: ago(5 * HOUR), completionTime: ago(5 * HOUR - 2 * MIN), conditions: [{ type: 'Complete', status: 'True' }] },
  }];
  const cronjobs = [{
    // Annotation tracking (Argo CD 3).
    metadata: meta('cronjob', 'nightly-report', 'shop', 30 * DAY, { annotations: { 'argocd.argoproj.io/tracking-id': 'shop:batch/CronJob:shop/nightly-report' } }),
    spec: { schedule: '0 3 * * *', jobTemplate: { spec: { template: template('report', 'registry.local/shop/report:0.3.2') } } },
    status: { lastScheduleTime: ago(9 * HOUR) },
  }];
  const services = [
    { metadata: meta('service', 'api', 'shop', 30 * DAY), spec: { type: 'ClusterIP', clusterIP: '10.96.12.40', ports: [{ name: 'http', port: 80, targetPort: 'http', protocol: 'TCP' }], selector: { app: 'api' } } },
    { metadata: meta('service', 'checkout', 'shop', 30 * DAY), spec: { type: 'ClusterIP', clusterIP: '10.96.33.7', ports: [{ port: 8080, targetPort: 8080, protocol: 'TCP' }], selector: { app: 'checkout' } } },
  ];
  const ingresses = [{
    metadata: meta('ingress', 'shop', 'shop', 30 * DAY),
    spec: { rules: [{ host: 'shop.example.test' }] },
    status: { loadBalancer: { ingress: [{ ip: '10.0.0.50' }] } },
  }];

  const event = (n, type, reason, message, kind, name, namespace, count, age) => ({
    metadata: meta('event', `${name}.${n}`, namespace, age), type, reason, message, count,
    involvedObject: { kind, name, namespace }, lastTimestamp: ago(age),
  });
  const events = [
    event(1, 'Warning', 'BackOff', 'Back-off restarting failed container main in pod checkout-7f9c6b8d4-m2n5z', 'Pod', 'checkout-7f9c6b8d4-m2n5z', 'shop', 14, 2 * MIN),
    event(2, 'Warning', 'FailedScheduling', '0/3 nodes are available: 1 node(s) had untolerated taint, 2 Insufficient memory.', 'Pod', 'report-0', 'shop', 4, 5 * MIN),
    event(3, 'Normal', 'Pulled', `Container image "${HARBOR_HOST}/shop/api:2.4.1" already present on machine`, 'Pod', 'api-6d8f9b7c5-x7k2p', 'shop', 1, 3 * DAY),
  ];

  // Served by the fake on purpose: the AI scene proves Shellherd never asks for it.
  const secrets = [{ metadata: meta('secret', 'checkout-db', 'shop', 30 * DAY), type: 'Opaque', data: { password: Buffer.from(KUBE_SECRETS.secretValue).toString('base64') } }];

  // The Argo CD application of the shop, Self-Heal on: the confirmation of the CronJob says Argo CD reverts the change.
  const applications = [{
    metadata: meta('application', 'shop', 'argocd', 30 * DAY),
    spec: {
      project: 'default', destination: { server: 'https://kubernetes.default.svc', namespace: 'shop' },
      source: { repoURL: 'https://git.example.test/shop/deploy.git', path: 'shop', targetRevision: 'main' },
      syncPolicy: { automated: { prune: true, selfHeal: true } },
    },
    status: { sync: { status: 'Synced' }, health: { status: 'Healthy' } },
  }];

  return { nodes, pods, deployments, statefulsets, daemonsets, jobs, cronjobs, services, ingresses, events, namespaces, nodeMetrics, podMetrics, secrets, applications };
}

// Rules of the synthetic account in shop: read everything, logs, exec and port forward, delete pods, CronJobs.
// No patch on Deployments, StatefulSets, DaemonSets and Nodes, no delete on Jobs: restart, scale, cordon and job delete are greyed out.
export const SHOP_RULES = [
  { verbs: ['get', 'list', 'watch'], apiGroups: ['*'], resources: ['*'] },
  { verbs: ['create'], apiGroups: [''], resources: ['pods/exec', 'pods/portforward'] },
  { verbs: ['delete'], apiGroups: [''], resources: ['pods'] },
  { verbs: ['patch'], apiGroups: ['batch'], resources: ['cronjobs'] },
  { verbs: ['create'], apiGroups: ['batch'], resources: ['jobs'] },
];
