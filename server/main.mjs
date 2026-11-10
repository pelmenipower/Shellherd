// Standalone selfhosted server. No Electron or third-party runtime dependencies.
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createSyncServer } from '../scripts/sync-prototype/server.mjs';
import { accountAuth, INITIAL_PASSWORD_FILE } from '../scripts/sync-prototype/account-auth.mjs';
import { createDeviceRoster } from '../scripts/sync-prototype/device-roster.mjs';
import { originOk } from '../scripts/sync-prototype/device-proof.mjs';
import { parseTrustedProxies } from '../scripts/sync-prototype/rate-limit.mjs';
const check = (ok, hint) => { if (!ok) throw Object.assign(Error('Invalid server configuration'), hint ? { hint } : {}); };
const POLICIES = ['generated', 'custom'];
export async function readConfig(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    check(stat.isFile() && stat.nlink === 1 && stat.size > 0 && stat.size <= 16384 && (stat.mode & 0o077) === 0);
    const buffer = Buffer.alloc(16385); let used = 0;
    while (used < buffer.length) { const { bytesRead } = await file.read(buffer, used, buffer.length - used, used); if (!bytesRead) break; used += bytesRead; }
    check(used <= 16384); const config = JSON.parse(buffer.subarray(0, used).toString('utf8'));
    const keys = config && typeof config === 'object' ? Object.keys(config).sort().join(',') : '';
    check(keys === 'account,namespace,serverId' || keys === 'account,namespace,passwordPolicy,serverId');
    check(config.account !== null && typeof config.account === 'object' && (config.passwordPolicy === undefined || POLICIES.includes(config.passwordPolicy))); return config;
  } finally { await file.close(); }
}
async function privateDirectory(dataDirectory) {
  await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
  const stat = await lstat(dataDirectory); check(stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0);
}
/** Removes leftover setup/rotation temp files older than one hour. */
export async function cleanDataDirectory(dataDirectory) {
  for (const file of await readdir(dataDirectory)) {
    if (!/^[a-f0-9]{32}\.(account-tmp|password-setup)$/.test(file)) continue;
    try { const stat = await lstat(join(dataDirectory, file)); if (stat.isFile() && Date.now() - stat.mtimeMs > 3600_000) await unlink(join(dataDirectory, file)); } catch { /* best effort */ }
  }
}
export async function startServer({ dataDirectory, port = 8787, host = '127.0.0.1', origin = null, trustedProxy = false }) {
  check(Number.isInteger(port) && port >= 0 && port <= 65535);
  await privateDirectory(dataDirectory); await cleanDataDirectory(dataDirectory);
  const { account, serverId, namespace } = await readConfig(join(dataDirectory, 'server.json'));
  const service = await createSyncServer({ account, serverId, namespace, directory: join(dataDirectory, 'objects'), origin, initialPasswordFile: join(dataDirectory, INITIAL_PASSWORD_FILE), rendezvous: true, trustedProxy });
  try { await service.listen(port, host); return service; }
  catch (error) { await service.close(); throw error; }
}
// The policy describes the account password; without a known policy the marker is dropped (the server then warns at start).
function withPolicy(config, passwordPolicy) {
  const { passwordPolicy: _old, ...rest } = config;
  return passwordPolicy === undefined ? rest : { ...rest, passwordPolicy };
}
// Offline device commands: run only with the server stopped. They use the same atomic roster writer as the server.
async function offlineRoster(dataDirectory) {
  await privateDirectory(dataDirectory);
  const { serverId, namespace } = await readConfig(join(dataDirectory, 'server.json'));
  return createDeviceRoster({ directory: join(dataDirectory, 'objects'), serverId, namespace });
}
const iso = ms => new Date(ms).toISOString();
export async function listDevices(dataDirectory) {
  const roster = await offlineRoster(dataDirectory);
  return roster.list().map(device => [device.id, device.name, iso(device.enrolledAt), device.revokedAt === null ? '-' : iso(device.revokedAt), ...(device.ephemeral ? ['ephemeral'] : [])].join('\t'));
}
export async function revokeDevice(dataDirectory, id) {
  check(typeof id === 'string' && /^[a-f0-9]{64}$/.test(id), 'revoke-device takes a 64-character lowercase hex device id (see list-devices)');
  const roster = await offlineRoster(dataDirectory);
  try { await roster.revoke(id); } catch (error) { if (error?.status === 404) throw Object.assign(Error('Unknown device'), { hint: 'No device with this id (see list-devices)' }); throw error; }
}
/** Reads the serve environment; every configuration error carries a hint that main() prints. */
export function serveConfig(env) {
  check(env.SHELLHERD_SERVER_PUBLIC_URL === undefined, 'SHELLHERD_SERVER_PUBLIC_URL is no longer supported: use SHELLHERD_SERVER_ORIGIN');
  const rawOrigin = env.SHELLHERD_SERVER_ORIGIN;
  check(typeof rawOrigin === 'string' && rawOrigin !== '', 'Set SHELLHERD_SERVER_ORIGIN to the public origin of this server, e.g. https://sync.example.home');
  const origin = rawOrigin.endsWith('/') ? rawOrigin.slice(0, -1) : rawOrigin;
  check(originOk(origin), 'SHELLHERD_SERVER_ORIGIN must be an origin without path, in lowercase and without the default port, e.g. https://sync.example.home (plain http only for loopback or private addresses)');
  const port = Number(env.SHELLHERD_SERVER_PORT ?? 8787); check(Number.isInteger(port) && port > 0 && port <= 65535, 'SHELLHERD_SERVER_PORT must be a port number');
  const host = env.SHELLHERD_SERVER_HOST ?? '127.0.0.1';
  const trustedProxy = env.SHELLHERD_SERVER_TRUSTED_PROXY === undefined ? false : env.SHELLHERD_SERVER_TRUSTED_PROXY;
  if (trustedProxy !== false) parseTrustedProxies(trustedProxy); // fails with a hint; createSyncServer parses it again
  return { port, host, origin, trustedProxy };
}
// Run only with the server stopped. Preserve the namespace and all vault objects.
export async function replaceAccount(dataDirectory, account, passwordPolicy) {
  check(passwordPolicy === undefined || POLICIES.includes(passwordPolicy));
  accountAuth(account); const config = await readConfig(join(dataDirectory, 'server.json'));
  const temporary = join(dataDirectory, randomBytes(16).toString('hex') + '.account-tmp');
  try {
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(withPolicy({ ...config, account }, passwordPolicy))); await file.sync(); } finally { await file.close(); }
    await rename(temporary, join(dataDirectory, 'server.json'));
    const dir = await open(dataDirectory, 'r'); try { await dir.sync(); } finally { await dir.close(); }
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
async function main() {
  process.umask(0o077);
  const mode = process.argv[2] ?? 'serve'; check(process.argv.length <= (mode === 'list-devices' || mode === 'revoke-device' ? 4 : 3));
  const dataDirectory = resolve(process.env.SHELLHERD_SERVER_DATA ?? './server-data');
  if (mode === 'init' || mode === 'rotate-password') {
    await privateDirectory(dataDirectory);
    const script = fileURLToPath(new URL('../scripts/sync-prototype/account-init.mjs', import.meta.url));
    if (mode === 'rotate-password') await readConfig(join(dataDirectory, 'server.json'));
    const target = join(dataDirectory, mode === 'init' ? 'server.json' : randomBytes(16).toString('hex') + '.password-setup');
    try {
      const child = spawn(process.execPath, [script, target], { stdio: 'inherit' });
      process.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); });
      if (mode === 'rotate-password' && process.exitCode === 0) {
        const setup = await readConfig(target);
        await replaceAccount(dataDirectory, setup.account, setup.passwordPolicy);
        console.log('Account replaced. Start the server to use the new login; previous sessions are invalid after restart.');
      }
    } finally { if (mode === 'rotate-password') await unlink(target).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    return;
  }
  if (mode === 'list-devices') { for (const line of await listDevices(dataDirectory)) console.log(line); return; }
  if (mode === 'revoke-device') { await revokeDevice(dataDirectory, process.argv[3]); console.log('Device revoked.'); return; }
  check(mode === 'serve');
  const { port, host, origin, trustedProxy } = serveConfig(process.env);
  const service = await startServer({ dataDirectory, port, host, origin, trustedProxy });
  if ((await readConfig(join(dataDirectory, 'server.json'))).passwordPolicy === undefined) console.error('Warning: this account predates the H3.1 password policy; its password may be shorter than 20 characters. Run rotate-password.');
  console.log(`Shellherd storage and rendezvous listening on ${host}:${port}`);
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
    if (stopping) return; stopping = true;
    void service.close().catch(() => { process.exitCode = 1; });
  });
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error?.hint ?? 'Cannot start Shellherd server. Check private data directory, configuration, port and init command.'); process.exitCode = 1; });
}
