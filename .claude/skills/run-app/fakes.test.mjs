import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import ssh2 from 'ssh2';
import { openRemoteHost } from '../../../src/main/containers/runner';
import { PROBE_COMMAND, shellJoin } from '../../../src/main/containers/commands';
import { parseProbe } from '../../../src/main/containers/parsers';
import { BATCH_OUTPUT_LIMIT, inventoryBatchCommand, splitInventoryBatch } from '../../../src/main/containers/inventory-batch';
import { parseContainerRows } from '../../../src/main/containers/inventory-parsers';
import { createSudoMarker } from '../../../src/main/containers/sudo';
import { SudoRejections } from '../../../src/main/containers/sudo-rejections';
import { SshSessionManager } from '../../../src/main/ssh/session';
import { readKubeconfig } from '../../../src/main/kubernetes/access';
import { parseKubeconfig } from '../../../src/main/kubernetes/kubeconfig';
import { openTunnel } from '../../../src/main/kubernetes/tunnel';
import { createKubeApi } from '../../../src/main/kubernetes/client-api';
import { KubeForwards } from '../../../src/main/kubernetes/forwards';
import { KubeWorkloadLogs } from '../../../src/main/kubernetes/workload-logs';
import { buildDiagnosis } from '../../../src/main/kubernetes/diagnose';
import { argoStateOf } from '../../../src/main/kubernetes/argo';
import { toRow } from '../../../src/main/kubernetes/rows';
import { harborImageUrl } from '../../../src/shared/kube-links';
import { DIAGNOSE_MAX_CHARS } from '../../../src/shared/kubernetes';
import { deniedAccess } from '../../../src/shared/kube-access';
import { streamChat } from '../../../src/main/ai/providers';
import { SecretMasker } from '../../../src/main/ai/secret-mask';
import { startSshd } from './sshd.mjs';
import { DEMO_TOTP, seedSftp } from './fixtures.mjs';
import { findOpenssl, KUBE_REQUEST_LOG, startKubeFake } from './kube-fake.mjs';
import { HARBOR_DIGEST, HARBOR_HOST, KUBE_SECRETS } from './kube-fixtures.mjs';
import { AI_KEY, AI_REQUEST_LOG, DEMO_ENV, DEMO_KEPT, DEMO_SECRETS, startAiFake } from './ai-fake.mjs';
import { writeImportFixtures } from './import-fixtures.mjs';

// Windows only: ssh2 server tests are flaky on Linux CI (see sftp-loopback.test.ts).
describe.runIf(process.platform === 'win32')('run-app fakes, driven by the real app code', { timeout: 20_000 }, () => {
  const base = mkdtempSync(join(tmpdir(), 'shellherd-fakes-'));
  const cleanup = [];
  afterAll(async () => {
    for (const fn of cleanup.reverse()) await fn().catch(() => {});
    rmSync(base, { recursive: true, force: true });
  });

  const connection = port => ({ id: 't', type: 'connection', name: 'web-01', tags: [], protocol: 'ssh', host: '127.0.0.1', port, username: 'demo',
    authentication: { method: 'password', password: 'synthetic-demo' } });
  const connect = async port => {
    const node = connection(port);
    const host = await openRemoteHost(node, async () => true);
    cleanup.push(async () => host.close());
    return { node, host };
  };
  const start = async (name, options = {}) => {
    const sshd = await startSshd({ port: 0, dir: join(base, name), ...options });
    cleanup.push(() => sshd.close());
    return sshd;
  };

  it('answers the container probe, the inventory batch and unknown commands', async () => {
    const { host } = await connect((await start('plain')).port);
    expect(parseProbe((await host.run(PROBE_COMMAND, 10_000)).stdout).has('docker')).toBe(true);

    const marker = createSudoMarker('list');
    const result = await host.run(inventoryBatchCommand('docker', marker, { kind: 'none' }), 10_000, undefined, BATCH_OUTPUT_LIMIT);
    const lists = splitInventoryBatch(result, marker);
    for (const kind of ['containers', 'images', 'volumes', 'networks']) expect(lists[kind].code, kind).toBe(0);
    expect(parseContainerRows('docker', lists.containers.stdout)).toHaveLength(6);

    expect((await host.run('rm -rf /', 5000)).code).toBe(127);
  });

  it('serves the root shell and the start commands', async () => {
    const { port } = await start('root');
    const run = async (extra, done) => {
      const events = [];
      const node = { ...connection(port), login: { sudo: true, commands: ['uptime', 'df -h /'] }, ...extra };
      const manager = new SshSessionManager({ getConnection: () => structuredClone(node), verifyHost: async () => true,
        spawnShell: () => { throw new Error('no local shell'); },
        emit: (owner, event) => { events.push(event); if (event.type === 'data') manager.acknowledge(owner, event.sessionId, event.sequence); } });
      cleanup.push(async () => manager.closeAll());
      const text = () => Buffer.concat(events.filter(event => event.type === 'data').map(event => Buffer.from(event.data))).toString('utf8');
      const { sessionId } = manager.prepare(1, { connectionId: node.id, cols: 80, rows: 24 });
      await manager.connect(1, sessionId);
      for (const end = Date.now() + 8000; !done(text()); await new Promise(resolve => setTimeout(resolve, 20))) {
        if (Date.now() > end) throw new Error(`timeout, output so far: ${JSON.stringify(text())}`);
      }
      await new Promise(resolve => setTimeout(resolve, 300));
      manager.closeAll();
      return text();
    };
    const root = await run({}, out => out.includes('Mounted on'));
    expect(root).toContain('root@web-01:~# ');
    expect(root).toContain('load average');
    expect(root).not.toContain('terminus-');
  });

  it('reports no kubeconfig without a Kubernetes fake', async () => {
    const { host, node } = await connect((await start('nokube')).port);
    await expect(readKubeconfig(host, node, { source: 'auto' }, new SudoRejections())).rejects.toMatchObject({ code: 'kubernetes.kubeconfigNotFound' });
  });

  it.skipIf(!findOpenssl())('serves the Kubernetes API through the SSH tunnel and refuses other forwards', async () => {
    const kube = await startKubeFake({ port: 0, dir: join(base, 'kube') });
    cleanup.push(() => kube.close());
    const { host, node } = await connect((await start('kube', { kubeconfig: kube.kubeconfig, kubePort: kube.port })).port);

    const { text, source } = await readKubeconfig(host, node, { source: 'auto' }, new SudoRejections());
    expect(source).toBe('/home/demo/.kube/config');
    const parsed = parseKubeconfig(text);
    expect(parsed.server).toEqual({ host: 'k8s-cp1', port: 6443 });

    const tunnel = await openTunnel((h, p) => host.forward(h, p), parsed.server);
    cleanup.push(async () => tunnel.close());
    const api = createKubeApi(parsed.build(tunnel.port));
    const nodes = await api.list('nodes', null);
    expect(nodes.items).toHaveLength(3);
    for (const item of nodes.items) expect(item.metadata.uid).toBeTruthy();
    expect((await api.list('pods', 'shop')).items.length).toBeGreaterThanOrEqual(5);
    expect(await api.nodeMetrics()).toHaveLength(3);
    expect(await api.podMetrics('shop')).not.toBeNull();

    const handle = await Promise.race([
      api.watch('pods', 'shop', undefined, '1', () => {}, () => {}),
      new Promise((_, reject) => setTimeout(() => reject(new Error('watch did not start within 3 s')), 3000)),
    ]);
    handle.stop();

    await expect(host.forward('k8s-cp1', 22)).rejects.toBeDefined();
    await expect(host.forward('127.0.0.1', 6443)).rejects.toBeDefined();
  });

  it.skipIf(!findOpenssl())('forwards a pod and a service port through the SSH tunnel to the pod page', async () => {
    const kube = await startKubeFake({ port: 0, dir: join(base, 'kube-forward') });
    cleanup.push(() => kube.close());
    const { host } = await connect((await start('kube-forward', { kubeconfig: kube.kubeconfig, kubePort: kube.port })).port);
    const parsed = parseKubeconfig(kube.kubeconfig);
    const tunnel = await openTunnel((h, p) => host.forward(h, p), parsed.server);
    cleanup.push(async () => tunnel.close());
    const api = createKubeApi(parsed.build(tunnel.port));
    const latest = new Map();
    const forwards = new KubeForwards((_owner, _view, list) => { for (const forward of list) latest.set(forward.id, forward); });
    cleanup.push(async () => forwards.stopAll());
    const view = { ownerId: 1, viewId: 'v', api: async () => api };
    const get = async port => (await fetch(`http://127.0.0.1:${port}/check`, { headers: { connection: 'close' } })).text();
    const until = async (id, test) => {
      for (const end = Date.now() + 5000; !test(latest.get(id)); await new Promise(resolve => setTimeout(resolve, 50))) {
        if (Date.now() > end) throw new Error(`forward ${id}: ${JSON.stringify(latest.get(id))}`);
      }
    };

    const pod = await forwards.start(view, { kind: 'pods', namespace: 'shop', name: 'api-6d8f9b7c5-x7k2p', port: 8080 }, 0);
    expect(await get(pod.localPort)).toContain('synthetic pod page /check');

    const service = await forwards.start(view, { kind: 'services', namespace: 'shop', name: 'api', port: 80 }, 0);
    expect(await get(service.localPort)).toContain('synthetic pod page /check');
    await until(service.id, forward => forward?.pod === 'api-6d8f9b7c5-h5t8w' && forward.podPort === 8080);

    const refused = await forwards.start(view, { kind: 'pods', namespace: 'shop', name: 'api-6d8f9b7c5-x7k2p', port: 9999 }, 0);
    await get(refused.localPort).catch(() => '');
    await until(refused.id, forward => forward?.error?.code === 'kubernetes.portForwardRefused');

    const pending = await forwards.start(view, { kind: 'pods', namespace: 'shop', name: 'report-0', port: 8080 }, 0);
    await get(pending.localPort).catch(() => '');
    await until(pending.id, forward => forward?.error?.code === 'kubernetes.portForwardNotRunning');

    const noReady = await forwards.start(view, { kind: 'services', namespace: 'shop', name: 'checkout', port: 8080 }, 0);
    await get(noReady.localPort).catch(() => '');
    await until(noReady.id, forward => forward?.error?.code === 'kubernetes.portForwardNoReadyPod');
  });

  it.skipIf(!findOpenssl())('follows the logs of all api pods with timestamps and answers the rules review', async () => {
    const kube = await startKubeFake({ port: 0, dir: join(base, 'kube-logs') });
    cleanup.push(() => kube.close());
    const { host } = await connect((await start('kube-logs', { kubeconfig: kube.kubeconfig, kubePort: kube.port })).port);
    const parsed = parseKubeconfig(kube.kubeconfig);
    const tunnel = await openTunnel((h, p) => host.forward(h, p), parsed.server);
    cleanup.push(async () => tunnel.close());
    const api = createKubeApi(parsed.build(tunnel.port));
    const batches = [];
    const logs = new KubeWorkloadLogs((_owner, _view, batch) => batches.push(batch));
    cleanup.push(async () => logs.stopAll());
    const lines = () => batches.flatMap(batch => batch.lines);
    const until = async (what, test) => {
      for (const end = Date.now() + 8000; !test(); await new Promise(resolve => setTimeout(resolve, 50))) if (Date.now() > end) throw new Error(what);
    };

    await logs.start({ ownerId: 1, viewId: 'v', api: async () => api }, { id: 'run', namespace: 'shop', selector: { app: 'api' }, format: 'raw' });
    await until('three sources with their tails', () => (batches.at(-1)?.sources.length ?? 0) === 3 && lines().length >= 45);
    expect(batches.at(-1).sources.map(source => source.pod)).toEqual(['api-6d8f9b7c5-h5t8w', 'api-6d8f9b7c5-q9m4d', 'api-6d8f9b7c5-x7k2p']);
    for (const line of lines()) expect(line.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{9}Z$/);
    const count = lines().length;
    await until('following brings new lines', () => lines().length > count);

    const shop = await api.rulesReview('shop');
    expect(shop.incomplete).toBe(false);
    const denied = deniedAccess(shop.rules).map(item => item.id);
    expect(denied).toEqual(expect.arrayContaining(['patchDeployments', 'patchStatefulSets', 'patchDaemonSets', 'patchNodes', 'deleteJobs']));
    expect(denied).not.toContain('logsAll');
    expect(denied).not.toContain('shell');
    expect((await api.rulesReview('monitoring')).incomplete).toBe(true);
    await expect(api.rulesReview('kube-system')).rejects.toMatchObject({ code: 403 });
  });

  it.skipIf(!findOpenssl())('analyses the crash-looping checkout pod, the deployment and a healthy pod by reading only, never a secret', async () => {
    const kube = await startKubeFake({ port: 0, dir: join(base, 'kube-ai') });
    cleanup.push(() => kube.close());
    const { host } = await connect((await start('kube-ai', { kubeconfig: kube.kubeconfig, kubePort: kube.port })).port);
    const parsed = parseKubeconfig(kube.kubeconfig);
    const tunnel = await openTunnel((h, p) => host.forward(h, p), parsed.server);
    cleanup.push(async () => tunnel.close());
    const api = createKubeApi(parsed.build(tunnel.port));
    const pod = { kind: 'pods', namespace: 'shop', name: 'checkout-7f9c6b8d4-m2n5z' };

    const crash = await buildDiagnosis(api, pod, { kind: 'events', namespace: 'shop', name: 'checkout-7f9c6b8d4-m2n5z.1' });
    expect(crash.parts.map(part => part.id)).toEqual(['trigger', 'object', 'events', 'logs', 'previousLogs', 'owner', 'node']);
    expect(crash.parts.filter(part => part.missing)).toEqual([]);
    for (const needle of ['CrashLoopBackOff', 'BackOff', 'connection refused', '<Secret checkout-db/password>', 'DB_PASSWORD: <hidden>', 'Kind: Deployment', 'Kubelet: v1.31.4']) expect(crash.text).toContain(needle);
    expect(crash.text.length).toBeLessThanOrEqual(DIAGNOSE_MAX_CHARS);
    expect(crash.text).not.toMatch(/GMT/);
    for (const value of [KUBE_SECRETS.secretValue, Buffer.from(KUBE_SECRETS.secretValue).toString('base64'), KUBE_SECRETS.envLiteral]) expect(crash.text).not.toContain(value);
    const masked = new SecretMasker().mask(crash.text, []).text;
    expect(masked).not.toContain(KUBE_SECRETS.logPassword);
    expect(masked).not.toContain(KUBE_SECRETS.logBearer);

    const deployment = await buildDiagnosis(api, { kind: 'deployments', namespace: 'shop', name: 'checkout' });
    expect(deployment.parts.map(part => part.id)).toEqual(['object', 'events', 'pods', 'podEvents', 'logs', 'previousLogs']);
    const healthy = await buildDiagnosis(api, { kind: 'pods', namespace: 'shop', name: 'api-6d8f9b7c5-x7k2p' });
    expect(healthy.parts.map(part => part.id)).toEqual(['object', 'events', 'logs', 'owner', 'node']);

    const asked = readFileSync(join(base, 'kube-ai', KUBE_REQUEST_LOG), 'utf8').split('\n').filter(Boolean);
    expect(kube.requests).toEqual(asked);
    expect(asked.every(line => line.startsWith('GET '))).toBe(true);
    expect(asked.some(line => /\/secrets|\/configmaps|\/replicasets/.test(line))).toBe(false);
    expect(asked.some(line => line.includes('/log?') && line.includes('previous=true'))).toBe(true);
  });

  it.skipIf(!findOpenssl())('reads the Argo CD application by GET only, tracks api and the CronJob, ignores the forged id and links the running digest', async () => {
    const kube = await startKubeFake({ port: 0, dir: join(base, 'kube-argo') });
    cleanup.push(() => kube.close());
    const { host } = await connect((await start('kube-argo', { kubeconfig: kube.kubeconfig, kubePort: kube.port })).port);
    const parsed = parseKubeconfig(kube.kubeconfig);
    const tunnel = await openTunnel((h, p) => host.forward(h, p), parsed.server);
    cleanup.push(async () => tunnel.close());
    const api = createKubeApi(parsed.build(tunnel.port));

    expect(argoStateOf(await api.readArgoApp('argocd', 'shop'))).toEqual({ automated: true, selfHeal: true, sync: 'Synced', health: 'Healthy' });
    await expect(api.readArgoApp('argocd', 'missing')).rejects.toMatchObject({ code: 404 });

    const rowOf = async (kind, name) => toRow(kind, (await api.list(kind, 'shop')).items.find(item => item.metadata.name === name));
    expect((await rowOf('deployments', 'api')).argoApp).toBe('shop');
    expect((await rowOf('cronjobs', 'nightly-report')).argoApp).toBe('shop');
    expect((await rowOf('deployments', 'checkout')).argoApp).toBeUndefined();
    const pod = await rowOf('pods', 'api-6d8f9b7c5-x7k2p');
    expect(pod.digests).toEqual({ main: HARBOR_DIGEST });
    expect(harborImageUrl(`https://${HARBOR_HOST}`, String(pod.cells['image:main']), pod.digests.main))
      .toBe(`https://${HARBOR_HOST}/harbor/projects/shop/repositories/api/artifacts-tab/artifacts/${HARBOR_DIGEST}`);

    const asked = readFileSync(join(base, 'kube-argo', KUBE_REQUEST_LOG), 'utf8').split('\n').filter(Boolean);
    expect(asked.filter(line => line.includes('argoproj'))).toEqual(['GET /apis/argoproj.io/v1alpha1/namespaces/argocd/applications/shop', 'GET /apis/argoproj.io/v1alpha1/namespaces/argocd/applications/missing']);
    expect(asked.every(line => line.startsWith('GET '))).toBe(true);
  });

  it('streams the AI fake, checks the key and answers the connection test', async () => {
    const ai = await startAiFake({ port: 0, runDir: base });
    cleanup.push(() => ai.close());
    const ask = async (content, apiKey = 'sk-synthetic-demo') => {
      let out = '';
      const provider = { id: 't', name: 't', kind: 'openai', model: 'gpt-4o-mini', baseUrl: `http://127.0.0.1:${ai.port}/v1`, apiKey };
      await streamChat(provider, { system: 's', messages: [{ role: 'user', content }] }, text => { out += text; }, new AbortController().signal);
      return out;
    };
    expect(await ask('Ist die Platte zu voll?')).toContain('<command>du -xh');
    expect(await ask('Verbindungstest')).toBe('OK');
    await expect(ask('Verbindungstest', 'sk-wrong')).rejects.toMatchObject({ code: 'ai.keyRejected' });
  });

  it('logs request bodies without headers and answers with the placeholder it got', async () => {
    const runDir = mkdtempSync(join(base, 'ai-log-'));
    const ai = await startAiFake({ port: 0, runDir });
    cleanup.push(() => ai.close());
    const ask = async content => {
      let out = '';
      const provider = { id: 't', name: 't', kind: 'openai', model: 'gpt-4o-mini', baseUrl: `http://127.0.0.1:${ai.port}/v1`, apiKey: AI_KEY };
      await streamChat(provider, { system: 's', messages: [{ role: 'user', content }] }, text => { out += text; }, new AbortController().signal);
      return out;
    };
    expect(await ask('Ist die Platte zu voll?')).toContain('<command>du -xh');
    const lines = readFileSync(join(runDir, AI_REQUEST_LOG), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('Ist die Platte zu voll?');
    expect(lines[0]).not.toContain(AI_KEY);
    expect(await ask('Fehler mit [SECRET_3] beim Login')).toContain("PGPASSWORD='[SECRET_3]'");
  });

  it('answers a Kubernetes analysis with a reading and a changing command, everything else as before', async () => {
    const ai = await startAiFake({ port: 0, runDir: mkdtempSync(join(base, 'ai-kube-')) });
    cleanup.push(() => ai.close());
    const ask = async (system, content) => {
      let out = '';
      const provider = { id: 't', name: 't', kind: 'openai', model: 'gpt-4o-mini', baseUrl: `http://127.0.0.1:${ai.port}/v1`, apiKey: AI_KEY };
      await streamChat(provider, { system, messages: [{ role: 'user', content }] }, text => { out += text; }, new AbortController().signal);
      return out;
    };
    const answer = await ask('Kubernetes-Assistent in Shellherd. Cluster: prod-k8s.', 'Warum startet dieser Pod immer wieder neu? DB_PASSWORD=[SECRET_1]');
    expect(answer).toContain('<command>kubectl -n shop get endpoints db</command>');
    expect(answer).toContain('<command>kubectl -n shop rollout restart deployment/checkout</command>');
    expect(await ask('Kubernetes assistant in Shellherd. Cluster: prod-k8s.', 'Why?')).toContain('rollout restart');
    expect(await ask('Terminal-Assistent', 'Ist die Platte zu voll?')).toContain('<command>du -xh');
  });

  it('serves a seeded SFTP tree and stays inside its root', async () => {
    const root = join(base, 'sftp-seed');
    seedSftp(root);
    expect(existsSync(join(root, 'home', 'demo', 'notes.md'))).toBe(true);

    const { port } = await start('sftp');
    const client = new ssh2.Client();
    cleanup.push(async () => client.end());
    await new Promise((resolve, reject) => client.on('ready', resolve).on('error', reject)
      .connect({ host: '127.0.0.1', port, username: 'demo', password: 'synthetic-demo' }));
    const sftp = await new Promise((resolve, reject) => client.sftp((error, value) => (error ? reject(error) : resolve(value))));
    const call = fn => new Promise((resolve, reject) => fn((error, value) => (error ? reject(error) : resolve(value))));

    expect((await call(done => sftp.readdir('/home/demo', done))).length).toBeGreaterThanOrEqual(5);
    // NO_SUCH_FILE (2): neither ".." climbing nor backslashes may leave the root.
    await expect(call(done => sftp.stat('/../../x', done))).rejects.toMatchObject({ code: 2 });
    await expect(call(done => sftp.stat('/home/..\\..\\..\\x', done))).rejects.toBeDefined();
  });

  it('answers sha256sum inside the SFTP root, quoted names too, and fails for missing files', async () => {
    const { port } = await start('sha');
    writeFileSync(join(base, 'sha', 'sftp', 'home', 'demo', "it's here.bin"), 'payload');
    const { host } = await connect(port);
    const digest = createHash('sha256').update('payload').digest('hex');
    const command = file => shellJoin(['sh', '-c', 'sha256sum -- "$1" 2>/dev/null || shasum -a 256 -- "$1"', 'sh', file]);
    expect(await host.run(command("/home/demo/it's here.bin"), 5000)).toMatchObject({ code: 0, stdout: `${digest}  /home/demo/it's here.bin\n` });
    expect((await host.run(command('/home/demo/notes.md'), 5000)).stdout).toMatch(/^[0-9a-f]{64} {2}\/home\/demo\/notes\.md\n$/);
    expect((await host.run(command('/home/demo/missing.bin'), 5000)).code).toBe(1);
    expect((await host.run(command('/../../x'), 5000)).code).toBe(1);
  });

  // Tries one login with the given config and answers per keyboard-interactive round; reports the rounds seen.
  const attempt = async (port, config, answers = []) => new Promise(resolve => {
    const client = new ssh2.Client();
    const prompts = [];
    cleanup.push(async () => client.end());
    client.on('keyboard-interactive', (name, instructions, lang, asked, finish) => {
      prompts.push(asked.map(prompt => prompt.prompt));
      finish(answers.shift() ?? []);
    });
    client.on('ready', () => resolve({ ok: true, prompts })).on('error', () => resolve({ ok: false, prompts }))
      .connect({ host: '127.0.0.1', port, ...config });
  });

  it('asks mfa two keyboard-interactive rounds and refuses plain password logins', async () => {
    const { port } = await start('mfa');
    const mfa = { username: 'mfa', tryKeyboard: true };
    expect(await attempt(port, mfa, [['synthetic-demo'], [DEMO_TOTP]])).toEqual({ ok: true, prompts: [['Password: '], ['Verification code: ']] });
    expect(await attempt(port, mfa, [['synthetic-demo'], ['000000']])).toEqual({ ok: false, prompts: [['Password: '], ['Verification code: ']] });
    expect(await attempt(port, mfa, [['wrong-synthetic-pw']])).toEqual({ ok: false, prompts: [['Password: ']] });
    expect(await attempt(port, { username: 'mfa', password: 'synthetic-demo' })).toEqual({ ok: false, prompts: [] });
  });

  it('opens the extra tcpip targets and refuses unknown ones', async () => {
    const { port } = await start('targets');
    const client = await sshClient(port);
    const open = (host, targetPort) => new Promise((resolve, reject) => client.forwardOut('127.0.0.1', 0, host, targetPort, (error, channel) => (error ? reject(error) : resolve(channel))));
    // Collects channel output until it contains the expected text.
    const readUntil = (channel, expected) => new Promise((resolve, reject) => {
      let text = '';
      channel.on('data', data => { text += data; if (text.includes(expected)) resolve(text); })
        .on('close', () => reject(new Error(`closed before ${expected}: ${text}`)));
    });

    // internal-01:22 is this server again, so its SSH banner comes back through the channel.
    expect(await readUntil(await open('internal-01', 22), 'SSH-2.0-')).toContain('SSH-2.0-');
    const db = await open('db-internal', 5432);
    db.write('ping');
    expect(await readUntil(db, 'ping')).toContain('ping');
    const web = await open('intranet.demo', 80);
    web.write('GET / HTTP/1.0\r\nHost: intranet.demo\r\n\r\n');
    expect(await readUntil(web, 'Synthetic intranet page')).toContain('Synthetic intranet page');
    await expect(open('nowhere.demo', 22)).rejects.toBeDefined();
  });

  it('accepts remote forwards on localhost and 127.0.0.1 only', async () => {
    const { port } = await start('forward');
    const client = await sshClient(port);
    const forwardIn = (address, bindPort) => new Promise(resolve => client.forwardIn(address, bindPort, error => resolve(!error)));
    expect(await forwardIn('localhost', 2345)).toBe(true);
    expect(await forwardIn('127.0.0.1', 2346)).toBe(true);
    expect(await forwardIn('0.0.0.0', 2347)).toBe(false);
    expect(await new Promise(resolve => client.unforwardIn('localhost', 2345, error => resolve(!error)))).toBe(true);
  });

  it('delays the sleep reply in the shell and prints the demo links for cat ~/LIESMICH and cat ~/LINKS', async () => {
    const { port } = await start('shell');
    const client = await sshClient(port);
    const stream = await new Promise((resolve, reject) => client.shell({ term: 'xterm' }, (error, value) => (error ? reject(error) : resolve(value))));
    cleanup.push(async () => stream.close());
    let text = '';
    stream.on('data', data => { text += data; });
    // Polls the collected shell output until it contains the expected text.
    const until = async expected => {
      for (const end = Date.now() + 8000; !text.includes(expected); await new Promise(resolve => setTimeout(resolve, 50))) {
        if (Date.now() > end) throw new Error(`timeout waiting for ${JSON.stringify(expected)}, output so far: ${JSON.stringify(text)}`);
      }
    };

    await until('demo@web-01:~$ ');
    const started = Date.now();
    stream.write('sleep 3; echo fertig\r');
    await until('\r\nfertig\r\n');
    expect(Date.now() - started).toBeGreaterThanOrEqual(2500);
    expect(text).toContain('\r\nfertig\r\ndemo@web-01:~$ ');

    stream.write('cat ~/LIESMICH\r');
    await until('Status:   https://status.intranet.demo/');
    expect(text).toContain('Handbuch: https://intranet.demo/handbuch');

    // OSC 8 link whose visible text names another host than its target.
    stream.write('cat ~/LINKS\r');
    await until('\x1b]8;;https://status.intranet.demo/\x1b\\https://intranet.demo/login\x1b]8;;\x1b\\');
  });

  // Demo user logged in with the password, for the tcpip and forward tests.
  async function sshClient(port) {
    const client = new ssh2.Client();
    cleanup.push(async () => client.end());
    await new Promise((resolve, reject) => client.on('ready', resolve).on('error', reject)
      .connect({ host: '127.0.0.1', port, username: 'demo', password: 'synthetic-demo' }));
    return client;
  }
});

describe('import sources and the release route', { timeout: 20_000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'shellherd-import-fakes-'));
  const cleanup = [];
  afterAll(async () => {
    for (const fn of cleanup.reverse()) await fn().catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  });

  // reg export: UTF-16LE with BOM; returns the decoded text
  const decodeReg = file => {
    const raw = readFileSync(file);
    expect(raw.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xfe]));
    expect(raw.includes(Buffer.from('Windows Registry', 'utf8'))).toBe(false);
    return raw.subarray(2).toString('utf16le');
  };

  it('writes the import sources with the expected encodings and content', () => {
    const files = writeImportFixtures(join(dir, 'import'));

    const ssh = readFileSync(files.sshConfig, 'utf8');
    expect(ssh).toContain('ProxyJump build-01');
    expect(ssh).toContain('LocalForward 15433 db-internal:5432');
    expect(ssh).toContain('ProxyJump a,b');
    expect(ssh).toContain('Match host x');
    expect(ssh).toContain('Include config.d/*');

    const putty = decodeReg(files.puttyReg);
    expect(putty.startsWith('Windows Registry Editor Version 5.00')).toBe(true);
    for (const name of ['Default%20Settings]', 'router]', 'jenkins]', 'monitoring]', 'web%2001]']) expect(putty).toContain(name);
    expect(putty).toContain('"Protocol"="telnet"');
    expect(putty).toContain('"PublicKeyFile"="C:\\\\Users\\\\demo\\\\.ssh\\\\jenkins.ppk"');
    expect(putty).toContain('"PortForwardings"="L3000=localhost:3000"');

    const winscp = decodeReg(files.winscpReg);
    expect(winscp.startsWith('Windows Registry Editor Version 5.00')).toBe(true);
    for (const name of ['Default%20Settings]', 'Prod%2Ffiles-02]', 'legacy-scp]', 'ftp-site]', 'behind-tunnel]']) expect(winscp).toContain(name);
    expect(winscp).toContain('"FSProtocol"=dword:00000000');
    expect(winscp).toContain('"FSProtocol"=dword:00000005');
    expect(winscp).toContain('"Tunnel"=dword:00000001');

    const conf = readFileSync(files.confCons, 'utf8');
    expect(conf).toContain('FullFileEncryption="false"');
    expect(conf).toContain('Type="Container"');
    expect(conf).toContain('Protocol="SSH2"');
    expect(conf).toContain('Protocol="RDP"');
    expect(conf).toContain('Domain="KUNDE"');
    expect(conf).toContain('Protocol="VNC"');
    expect(conf).toContain('Password="not-imported"');
  });

  it('offers the current version without the flag and the next minor version with it', async () => {
    const version = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')).version;
    const [major, minor] = version.split('.').map(Number);
    const runDir = mkdtempSync(join(dir, 'run-'));
    const ai = await startAiFake({ port: 0, runDir });
    cleanup.push(() => ai.close());
    const get = async () => {
      const response = await fetch(`http://127.0.0.1:${ai.port}/releases/latest`);
      expect(response.status).toBe(200);
      return response.json();
    };

    expect(await get()).toEqual({ tag_name: `v${version}`, draft: false, prerelease: false });
    writeFileSync(join(runDir, 'update-available'), '');
    expect(await get()).toEqual({ tag_name: `v${major}.${minor + 1}.0`, draft: false, prerelease: false });
  });
});

describe('masking fixture of the demo server', () => {
  it('hides every synthetic secret and keeps hashes, commit ids and uuids', () => {
    const { text, numbers } = new SecretMasker().mask(DEMO_ENV, [DEMO_SECRETS.vaultApiKey, DEMO_SECRETS.vaultPassword]);
    expect(Object.entries(DEMO_SECRETS).filter(([, value]) => text.includes(value)).map(([name]) => name)).toEqual([]);
    for (const value of DEMO_KEPT) expect(text).toContain(value);
    expect(numbers.size).toBe(Object.keys(DEMO_SECRETS).length);
  });
});
