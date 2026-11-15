// Integration test for the built image. Uses only uniquely named disposable resources.
import { spawn } from 'node:child_process';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createAccount } from './sync-prototype/account-auth.mjs';
import { AccountStore } from './sync-prototype/account-transport.mjs';
import { probeSyncServer } from './sync-prototype/http-common.mjs';
import { RendezvousPeer } from './sync-prototype/rendezvous-client.mjs';
import { createDeviceIdentity } from './sync-prototype/device-proof.mjs';

const image = 'shellherd-server:local'; const suffix = randomBytes(8).toString('hex');
const name = `shellherd-server-test-${suffix}`; const volume = `${name}-data`; const restored = `${name}-restored`;
const volumes = []; const stores = []; const channels = []; let running = false;
const docker = (args, { input, binary = false } = {}) => new Promise((resolve, reject) => {
  const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] }); const output = []; const errors = []; let bytes = 0;
  child.on('error', reject); child.stdin.on('error', () => {});
  child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > 16 * 1024 * 1024) child.kill(); else output.push(chunk); });
  child.stderr.on('data', chunk => { if (errors.reduce((n, value) => n + value.length, 0) < 65536) errors.push(chunk); });
  child.on('close', code => code === 0 ? resolve(binary ? Buffer.concat(output) : Buffer.concat(output).toString('utf8').trim()) : reject(Error(`Docker ${args[0]} failed (${code}): ${Buffer.concat(errors).toString('utf8')}`)));
  child.stdin.end(input);
});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function start(dataVolume) {
  await docker(['run', '-d', '--name', name, '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--user', '1000:1000', '--memory', '512m', '--pids-limit', '64', '--cpus', '1', '-p', '127.0.0.1::8787', '--mount', `type=volume,src=${dataVolume},dst=/data`, '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m', image]); running = true;
  const details = JSON.parse(await docker(['inspect', name]))[0];
  assert.equal(details.Config.User, '1000:1000'); assert.equal(details.HostConfig.ReadonlyRootfs, true);
  const port = details.NetworkSettings.Ports['8787/tcp'][0]; assert.equal(port.HostIp, '127.0.0.1');
  const serverUrl = `http://127.0.0.1:${port.HostPort}/`;
  for (let attempt = 0; attempt < 50; attempt++) {
    try { return await probeSyncServer(serverUrl, { allowLoopbackHttp: true }); }
    catch (error) { if (attempt === 49) throw error; await pause(100); }
  }
}
async function stop() { if (running) { await docker(['rm', '-f', name]); running = false; } }
const volumeMount = dataVolume => ['--mount', `type=volume,src=${dataVolume},dst=/data`];
try {
  await docker(['image', 'inspect', image]);
  const compose = JSON.parse(await docker(['compose', '-f', fileURLToPath(new URL('../server/compose.yaml', import.meta.url)), 'config', '--format', 'json']));
  assert.equal(compose.services.server.read_only, true); assert.equal(compose.services.server.ports[0].host_ip, '127.0.0.1');
  for (const item of [volume, restored]) { await docker(['volume', 'create', item]); volumes.push(item); }
  const password = randomBytes(32).toString('hex');
  const config = { account: await createAccount('container-test', password), serverId: randomBytes(32).toString('hex'), namespace: 'container-test' };
  const bootstrap = "import {readFileSync} from 'node:fs'; import {writeFile} from 'node:fs/promises'; const config=JSON.parse(readFileSync(0,'utf8')); await writeFile('/data/server.json',JSON.stringify(config),{mode:0o600,flag:'wx'});";
  await docker(['run', '--rm', '-i', '--network', 'none', '--read-only', ...volumeMount(volume), '--entrypoint', 'node', image, '--input-type=module', '-e', bootstrap], { input: JSON.stringify(config) });
  let info = await start(volume);
  // Enroll a device with the account password (needed once), or sign an enrolled one in with its key alone.
  async function enroll(currentInfo, enrollPassword = password, identity = createDeviceIdentity()) {
    const store = new AccountStore(currentInfo); stores.push(store);
    await store.enroll(identity, { username: 'container-test', password: enrollPassword, name: 'synthetic-' + identity.id.slice(0, 8), ephemeral: false }); await store.openSession(identity); return { store, identity };
  }
  async function signIn(currentInfo, identity) { const store = new AccountStore(currentInfo); stores.push(store); await store.openSession(identity); return store; }
  const { store: first, identity: firstIdentity } = await enroll(info); const { store: second, identity: secondIdentity } = await enroll(info);
  const alice = new RendezvousPeer(first, firstIdentity); const bob = new RendezvousPeer(second, secondIdentity);
  await alice.register('synthetic-client'); await bob.register('synthetic-target');
  const session = await alice.request(bob.identity.id);
  const a = alice.channel(session, bob.identity.id, 'view');
  const b = bob.channel(session, alice.identity.id, 'view'); channels.push(a, b);
  await b.accept();
  for (let round = 0; round < 6 && !(a.ready && b.ready); round++) { await a.receive(); await b.receive(); }
  assert.equal(a.ready && b.ready, true); await a.send('SYNTHETIC_PRIVATE_SIGNAL'); assert.deepEqual(await b.receive(), ['SYNTHETIC_PRIVATE_SIGNAL']);
  console.log('PASS: image runs as UID 1000 with read-only root; enrollment, device sessions and encrypted signaling over the published loopback port.');
  const nonce = randomBytes(12); const key = randomBytes(32);
  const cipher = createCipheriv('aes-256-gcm', key, nonce); cipher.setAAD(Buffer.from('shellherd-container-check'));
  const payload = Buffer.concat([cipher.update('SYNTHETIC_PRIVATE_VAULT_CONTENT'), cipher.final()]);
  const wire = JSON.stringify({ format: 'shellherd-sync-object', version: 1, kind: 'version', cipher: { algorithm: 'aes-256-gcm', nonce: nonce.toString('base64'), authTag: cipher.getAuthTag().toString('base64') }, payload: payload.toString('base64') });
  const id = await first.put(wire);
  // Exercise the actual image HEALTHCHECK command before stopping.
  const health = JSON.parse(await docker(['inspect', name]))[0].Config.Healthcheck.Test;
  assert.equal(health[0], 'CMD-SHELL'); await docker(['exec', name, '/bin/sh', '-c', health[1]]);
  await stop(); info = await start(volume);
  first.info.serverUrl = info.serverUrl; await assert.rejects(() => first.list(), error => error.status === 401);
  const after = await signIn(info, firstIdentity); assert.deepEqual(await after.list(), [id]); assert.equal(await after.get(id), wire); // the enrollment lives in devices.json on the volume
  assert.deepEqual(await after.request('GET', '/v1/rendezvous/devices'), { devices: [] });
  console.log('PASS: account, roster and ciphertext survive container replacement; old tokens, presence and sessions do not.');
  await stop();
  const archive = await docker(['run', '--rm', '--network', 'none', '--read-only', ...volumeMount(volume), '--entrypoint', 'tar', image, '-C', '/data', '-czf', '-', '.'], { binary: true });
  await docker(['run', '--rm', '-i', '--network', 'none', '--read-only', ...volumeMount(restored), '--entrypoint', 'tar', image, '-C', '/data', '-xzf', '-'], { input: archive });
  const inspection = await docker(['run', '--rm', '--network', 'none', '--read-only', ...volumeMount(restored), '--entrypoint', 'node', image, '--input-type=module', '-e', "import {readFile,readdir} from 'node:fs/promises'; let text=await readFile('/data/server.json','utf8'); for(const name of await readdir('/data/objects'))text+=await readFile('/data/objects/'+name,'utf8'); console.log(text);"]);
  for (const marker of [password, 'SYNTHETIC_PRIVATE_SIGNAL', 'SYNTHETIC_PRIVATE_VAULT_CONTENT']) assert.equal(inspection.includes(marker), false);
  info = await start(restored); const fromBackup = await signIn(info, secondIdentity); const downloaded = JSON.parse(await fromBackup.get(id));
  const decipher = createDecipheriv('aes-256-gcm', key, nonce); decipher.setAAD(Buffer.from('shellherd-container-check')); decipher.setAuthTag(Buffer.from(downloaded.cipher.authTag, 'base64'));
  assert.equal(Buffer.concat([decipher.update(Buffer.from(downloaded.payload, 'base64')), decipher.final()]).toString(), 'SYNTHETIC_PRIVATE_VAULT_CONTENT'); key.fill(0);
  console.log('PASS: backup restored into a fresh volume, private file permissions preserved, no plaintext markers in server storage.');
  await stop();
  const newPassword = randomBytes(32).toString('hex'); const newAccount = await createAccount('container-test', newPassword);
  const rotate = "import {readFileSync} from 'node:fs'; import {replaceAccount} from './server/main.mjs'; await replaceAccount('/data',JSON.parse(readFileSync(0,'utf8')));";
  await docker(['run', '--rm', '-i', '--network', 'none', '--read-only', ...volumeMount(restored), '--entrypoint', 'node', image, '--input-type=module', '-e', rotate], { input: JSON.stringify(newAccount) });
  info = await start(restored); await assert.rejects(() => enroll(info), error => error.status === 401);
  assert.equal(await (await enroll(info, newPassword)).store.get(id), wire);
  assert.equal(await (await signIn(info, firstIdentity)).get(id), wire); // enrolled devices keep working without the password
  console.log('PASS: atomic account rotation rejects the old password for new enrollments and retains server identity, roster and encrypted objects.');
} finally {
  for (const channel of channels) channel.dispose(); for (const store of stores) store.close();
  await stop(); for (const item of volumes) await docker(['volume', 'rm', item]);
}
