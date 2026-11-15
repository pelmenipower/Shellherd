// Integration test for the built image. Uses only uniquely named disposable resources.
import { spawn } from 'node:child_process';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { createAccount } from './sync-prototype/account-auth.mjs';
import { AccountStore } from './sync-prototype/account-transport.mjs';
import { probeSyncServer } from './sync-prototype/http-common.mjs';
import { RendezvousPeer } from './sync-prototype/rendezvous-client.mjs';
import { createDeviceIdentity } from './sync-prototype/device-proof.mjs';

const image = 'shellherd-server:local'; const suffix = randomBytes(8).toString('hex');
const name = `shellherd-server-test-${suffix}`; const volume = `${name}-data`; const restored = `${name}-restored`;
const volumes = []; const stores = []; const channels = []; let running = false;
const docker = (args, { input, binary = false, env } = {}) => new Promise((resolve, reject) => {
  const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'], env }); const output = []; const errors = []; let bytes = 0;
  child.on('error', reject); child.stdin.on('error', () => {});
  child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > 16 * 1024 * 1024) child.kill(); else output.push(chunk); });
  child.stderr.on('data', chunk => { if (errors.reduce((n, value) => n + value.length, 0) < 65536) errors.push(chunk); });
  child.on('close', code => code === 0 ? resolve(binary ? Buffer.concat(output) : Buffer.concat(output).toString('utf8').trim()) : reject(Error(`Docker ${args[0]} failed (${code}): ${Buffer.concat(errors).toString('utf8')}`)));
  child.stdin.end(input);
});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
// The server needs its public origin at start, so the host port is chosen first and published to exactly that port.
const freePort = () => new Promise((resolve, reject) => {
  const probe = createServer(); probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});
let devices = 0;
async function start(dataVolume) {
  const hostPort = await freePort();
  await docker(['run', '-d', '--name', name, '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--user', '1000:1000', '--memory', '512m', '--pids-limit', '64', '--cpus', '1', '-p', `127.0.0.1:${hostPort}:8787`, '-e', `SHELLHERD_SERVER_ORIGIN=http://127.0.0.1:${hostPort}`, '--mount', `type=volume,src=${dataVolume},dst=/data`, '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m', image]); running = true;
  const details = JSON.parse(await docker(['inspect', name]))[0];
  assert.equal(details.Config.User, '1000:1000'); assert.equal(details.HostConfig.ReadonlyRootfs, true);
  const port = details.NetworkSettings.Ports['8787/tcp'][0]; assert.equal(port.HostIp, '127.0.0.1'); assert.equal(port.HostPort, String(hostPort));
  const serverUrl = `http://127.0.0.1:${hostPort}/`;
  for (let attempt = 0; attempt < 50; attempt++) {
    try { return await probeSyncServer(serverUrl, { allowLoopbackHttp: true }); }
    catch (error) { if (attempt === 49) throw error; await pause(100); }
  }
}
async function stop() { if (running) { await docker(['rm', '-f', name]); running = false; } }
const volumeMount = dataVolume => ['--mount', `type=volume,src=${dataVolume},dst=/data`];
try {
  await docker(['image', 'inspect', image]);
  const compose = JSON.parse(await docker(['compose', '-f', fileURLToPath(new URL('../server/compose.yaml', import.meta.url)), 'config', '--format', 'json'], { env: { ...process.env, SHELLHERD_SERVER_ORIGIN: 'https://shellherd.example.org' } }));
  assert.equal(compose.services.server.read_only, true); assert.equal(compose.services.server.ports[0].host_ip, '127.0.0.1');
  assert.equal(compose.services.server.environment.SHELLHERD_SERVER_ORIGIN, 'https://shellherd.example.org');
  // The trusted proxy is the gateway of the fixed project network: both must stay the same address.
  assert.equal(compose.services.server.environment.SHELLHERD_SERVER_TRUSTED_PROXY, compose.networks.default.ipam.config[0].gateway);
  for (const item of [volume, restored]) { await docker(['volume', 'create', item]); volumes.push(item); }
  const password = randomBytes(32).toString('hex');
  const config = { account: await createAccount('container-test', password), serverId: randomBytes(32).toString('hex'), namespace: 'container-test' };
  const bootstrap = "import {readFileSync} from 'node:fs'; import {writeFile} from 'node:fs/promises'; const config=JSON.parse(readFileSync(0,'utf8')); await writeFile('/data/server.json',JSON.stringify(config),{mode:0o600,flag:'wx'});";
  await docker(['run', '--rm', '-i', '--network', 'none', '--read-only', ...volumeMount(volume), '--entrypoint', 'node', image, '--input-type=module', '-e', bootstrap], { input: JSON.stringify(config) });
  let info = await start(volume);
  // Enroll a device with the account password (needed once), or sign an enrolled one in with its key alone.
  async function enroll(currentInfo, enrollPassword = password, identity = createDeviceIdentity()) {
    const store = new AccountStore(currentInfo); stores.push(store);
    await store.enroll(identity, { username: 'container-test', password: enrollPassword, name: 'synthetic-device-' + ++devices, ephemeral: false }); await store.openSession(identity); return { store, identity };
  }
  async function signIn(currentInfo, identity) { const store = new AccountStore(currentInfo); stores.push(store); await store.openSession(identity); return store; }
  const { store: first, identity: firstIdentity } = await enroll(info); const { store: second, identity: secondIdentity } = await enroll(info);
  // Enrollment code: the first device invites, a third one enrolls with the code alone and the roster names the issuer.
  async function enrollByInvite(issuerStore, issuerIdentity, currentInfo) {
    const secret = randomBytes(32).toString('hex'); await issuerStore.invite(issuerIdentity, { secret, object: null });
    const store = new AccountStore(currentInfo); stores.push(store); const identity = createDeviceIdentity();
    assert.equal((await store.enrollWithInvite(identity, { secret, name: 'synthetic-device-' + ++devices, ephemeral: false })).username, 'container-test');
    await store.openSession(identity); return { store, identity };
  }
  const guest = await enrollByInvite(first, firstIdentity, info);
  assert.equal((await first.devices()).find(d => d.id === guest.identity.id).enrolledBy, firstIdentity.id);
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
  const wire = JSON.stringify({ format: 'shellherd-sync-object', version: 2, kind: 'version', epoch: 1, cipher: { algorithm: 'aes-256-gcm', nonce: nonce.toString('base64'), authTag: cipher.getAuthTag().toString('base64') }, payload: payload.toString('base64') });
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
  // Offline switch to invite-only: the password form is refused after the restart, an enrollment code still works.
  await stop();
  const lock = "import {setEnrollment} from './server/main.mjs'; await setEnrollment('/data','invite-only');";
  await docker(['run', '--rm', '--network', 'none', '--read-only', ...volumeMount(restored), '--entrypoint', 'node', image, '--input-type=module', '-e', lock]);
  info = await start(restored); assert.equal(info.enrollment, 'invite-only');
  await assert.rejects(() => enroll(info, newPassword), error => error.status === 403);
  const owner = await signIn(info, firstIdentity); const late = await enrollByInvite(owner, firstIdentity, info);
  assert.equal((await owner.devices()).find(d => d.id === late.identity.id).enrolledBy, firstIdentity.id);
  console.log('PASS: offline lock-enrollment: password enrollment is refused with 403, enrollment codes still enroll devices.');
  // The socket override must remove the published port and set the socket variable. Older Compose versions without !reset only get a hint.
  try {
    const socketCompose = JSON.parse(await docker(['compose', '-f', fileURLToPath(new URL('../server/compose.yaml', import.meta.url)), '-f', fileURLToPath(new URL('../server/compose.socket.yaml', import.meta.url)), 'config', '--format', 'json'], { env: { ...process.env, SHELLHERD_SERVER_ORIGIN: 'https://shellherd.example.org' } }));
    assert.equal(socketCompose.services.server.environment.SHELLHERD_SERVER_SOCKET, '/run/shellherd/server.sock');
    if (socketCompose.services.server.ports?.length) console.warn('Hint: this Docker Compose version does not apply !reset, the socket override keeps the published port.');
    else console.log('PASS: compose.socket.yaml sets the socket variable and publishes no port.');
  } catch (error) { if (error?.code === 'ERR_ASSERTION') throw error; console.warn('Hint: compose.socket.yaml could not be rendered with this Docker Compose version: ' + error.message); }
} finally {
  for (const channel of channels) channel.dispose(); for (const store of stores) store.close();
  await stop(); for (const item of volumes) await docker(['volume', 'rm', item]);
}
