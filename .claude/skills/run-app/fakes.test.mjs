import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import ssh2 from 'ssh2';
import { openRemoteHost } from '../../../src/main/containers/runner';
import { PROBE_COMMAND } from '../../../src/main/containers/commands';
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
import { streamChat } from '../../../src/main/ai/providers';
import { startSshd } from './sshd.mjs';
import { seedSftp } from './fixtures.mjs';
import { findOpenssl, startKubeFake } from './kube-fake.mjs';
import { startAiFake } from './ai-fake.mjs';

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

  it('serves the root shell and the start commands, and skips them without login', async () => {
    const { port } = await start('root');
    const run = async (extra, skipLogin, done) => {
      const events = [];
      const node = { ...connection(port), login: { sudo: true, commands: ['uptime', 'df -h /'] }, ...extra };
      const manager = new SshSessionManager({ getConnection: () => structuredClone(node), verifyHost: async () => true,
        spawnShell: () => { throw new Error('no local shell'); },
        emit: (owner, event) => { events.push(event); if (event.type === 'data') manager.acknowledge(owner, event.sessionId, event.sequence); } });
      cleanup.push(async () => manager.closeAll());
      const text = () => Buffer.concat(events.filter(event => event.type === 'data').map(event => Buffer.from(event.data))).toString('utf8');
      const { sessionId } = manager.prepare(1, { connectionId: node.id, cols: 80, rows: 24, ...(skipLogin ? { skipLogin: true } : {}) });
      await manager.connect(1, sessionId);
      for (const end = Date.now() + 8000; !done(text()); await new Promise(resolve => setTimeout(resolve, 20))) {
        if (Date.now() > end) throw new Error(`timeout, output so far: ${JSON.stringify(text())}`);
      }
      await new Promise(resolve => setTimeout(resolve, 300));
      manager.closeAll();
      return text();
    };
    const root = await run({}, false, out => out.includes('Mounted on'));
    expect(root).toContain('root@web-01:~# ');
    expect(root).toContain('load average');
    expect(root).not.toContain('terminus-');
    const plain = await run({}, true, out => out.includes('demo@web-01:~$ '));
    expect(plain).not.toContain('load average');
    expect(plain).not.toContain('terminus-');
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

  it('streams the AI fake, checks the key and answers the connection test', async () => {
    const ai = await startAiFake({ port: 0 });
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
});
