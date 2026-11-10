import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, sign } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, expect, it as platformIt } from 'vitest';
import { createAccount, writeInitialPassword } from './account-auth.mjs';
import { createDeviceRoster } from './device-roster.mjs';
import { createDeviceIdentity, enrollmentBody } from './device-proof.mjs';
import { cleanDataDirectory, listDevices, readConfig, replaceAccount, revokeDevice, serveConfig } from '../../server/main.mjs';

const it = platformIt.runIf(process.platform === 'linux');
const main = fileURLToPath(new URL('../../server/main.mjs', import.meta.url));
const origin = 'https://sync.example.org'; const cleanup = []; let account;
beforeAll(async () => { account = await createAccount('operator', 'ONLY_TEST_SERVER_PASSWORD'); });
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function data(extra = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'shellherd-main-')); cleanup.push(() => rm(dir, { recursive: true, force: true })); await chmod(dir, 0o700);
  const config = { account, namespace: 'ns', serverId: randomBytes(32).toString('hex'), ...extra };
  await writeFile(join(dir, 'server.json'), JSON.stringify(config), { mode: 0o600 }); return { dir, config };
}
async function enrolled(dir, config, names) {
  await mkdir(join(dir, 'objects'), { recursive: true, mode: 0o700 });
  const roster = await createDeviceRoster({ directory: join(dir, 'objects'), serverId: config.serverId, namespace: config.namespace }); const ids = [];
  for (const name of names) {
    const identity = createDeviceIdentity(); ids.push(identity.id);
    const body = JSON.parse(enrollmentBody(config.serverId, config.namespace, origin, identity.id, identity.signingPublicKey, identity.publicKey, name));
    await roster.enroll({ document: [body, sign(null, Buffer.from(JSON.stringify(body)), identity.signingKey).toString('base64')], origin });
  }
  return ids;
}
const run = (args, env) => spawnSync(process.execPath, [main, ...args], { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8', timeout: 20_000 });

it('reads both server.json key sets and rejects a bad policy', async () => {
  const { dir, config } = await data(); expect(await readConfig(join(dir, 'server.json'))).toEqual(config);
  const withPolicy = await data({ passwordPolicy: 'generated' }); expect((await readConfig(join(withPolicy.dir, 'server.json'))).passwordPolicy).toBe('generated');
  const bad = await data({ passwordPolicy: 'weak' }); await expect(readConfig(join(bad.dir, 'server.json'))).rejects.toThrow();
});
it('replaceAccount carries the given policy, and drops a stale one when none is given', async () => {
  const { dir, config } = await data({ passwordPolicy: 'generated' }); const next = await createAccount('operator', 'ANOTHER_TEST_SERVER_PASSWORD');
  await replaceAccount(dir, next, 'custom'); expect(await readConfig(join(dir, 'server.json'))).toEqual({ ...config, account: next, passwordPolicy: 'custom' });
  await replaceAccount(dir, account); const { passwordPolicy, ...rest } = await readConfig(join(dir, 'server.json')); expect(passwordPolicy).toBeUndefined(); expect(rest.account).toEqual(account);
  await expect(replaceAccount(dir, account, 'strong')).rejects.toThrow();
});
it('parses the serve environment: origin is required and normalized, the old variables are refused, hints are attached', () => {
  expect(serveConfig({ SHELLHERD_SERVER_ORIGIN: origin })).toEqual({ port: 8787, host: '127.0.0.1', origin, trustedProxy: false });
  expect(serveConfig({ SHELLHERD_SERVER_ORIGIN: origin + '/', SHELLHERD_SERVER_PORT: '9000', SHELLHERD_SERVER_TRUSTED_PROXY: '172.31.87.1' })).toMatchObject({ port: 9000, origin, trustedProxy: '172.31.87.1' });
  const hint = env => { try { serveConfig(env); } catch (error) { return error.hint; } return null; };
  expect(hint({})).toContain('SHELLHERD_SERVER_ORIGIN');
  expect(hint({ SHELLHERD_SERVER_ORIGIN: origin, SHELLHERD_SERVER_PUBLIC_URL: origin })).toContain('use SHELLHERD_SERVER_ORIGIN');
  for (const bad of ['https://Sync.example.org', 'https://sync.example.org/x', 'https://sync.example.org:443', 'sync.example.org', 'http://sync.example.org']) expect(hint({ SHELLHERD_SERVER_ORIGIN: bad }), bad).toContain('SHELLHERD_SERVER_ORIGIN');
  expect(serveConfig({ SHELLHERD_SERVER_ORIGIN: 'http://127.0.0.1:8787' }).origin).toBe('http://127.0.0.1:8787');
  for (const proxy of ['1', 'true', '', '10.0.0.0/0']) expect(hint({ SHELLHERD_SERVER_ORIGIN: origin, SHELLHERD_SERVER_TRUSTED_PROXY: proxy }), proxy).toContain('SHELLHERD_SERVER_TRUSTED_PROXY');
});
it('lists devices with ISO dates and revokes one through the roster writer', async () => {
  const { dir, config } = await data(); const [first, second] = await enrolled(dir, config, ['Laptop', 'Phone']);
  const lines = await listDevices(dir); expect(lines).toHaveLength(2);
  const cells = lines.find(line => line.startsWith(first)).split('\t');
  expect(cells[0]).toBe(first); expect(cells[1]).toBe('Laptop'); expect(cells[2]).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z$/); expect(cells[3]).toBe('-'); expect(cells).toHaveLength(4);
  await revokeDevice(dir, second);
  expect((await listDevices(dir)).find(line => line.startsWith(second)).split('\t')[3]).toMatch(/^\d{4}-/);
  await expect(revokeDevice(dir, '9'.repeat(64))).rejects.toMatchObject({ hint: expect.stringContaining('list-devices') });
  await expect(revokeDevice(dir, 'nope')).rejects.toMatchObject({ hint: expect.stringContaining('hex') });
});
it('refuses a version 1 roster in the offline commands with the upgrade hint', async () => {
  const { dir, config } = await data(); await enrolled(dir, config, ['Laptop']); const file = join(dir, 'objects', 'devices.json');
  await writeFile(file, (await readFile(file, 'utf8')).replace('"version":2', '"version":1'), { mode: 0o600 });
  await expect(listDevices(dir)).rejects.toMatchObject({ hint: expect.stringContaining('re-enroll all devices') });
});
it('runs list-devices and revoke-device as commands with exit codes', async () => {
  const { dir, config } = await data(); const [id] = await enrolled(dir, config, ['Laptop']); const env = { SHELLHERD_SERVER_DATA: dir };
  const list = run(['list-devices'], env); expect(list.status).toBe(0); expect(list.stdout).toContain(id + '\tLaptop\t');
  expect(run(['revoke-device', '9'.repeat(64)], env).status).toBe(1);
  const revoke = run(['revoke-device', id], env); expect(revoke.status).toBe(0);
  expect(run(['list-devices'], env).stdout).not.toMatch(/\t-\s*$/m);
  expect(run(['list-devices', 'x', 'y'], env).status).toBe(1);
}, 30_000);
it('refuses to serve without the origin and prints the hint', async () => {
  const { dir } = await data(); const result = run(['serve'], { SHELLHERD_SERVER_DATA: dir });
  expect(result.status).toBe(1); expect(result.stderr).toContain('SHELLHERD_SERVER_ORIGIN');
  expect(run(['serve'], { SHELLHERD_SERVER_DATA: dir, SHELLHERD_SERVER_ORIGIN: origin, SHELLHERD_SERVER_TRUSTED_PROXY: '1' }).stderr).toContain('SHELLHERD_SERVER_TRUSTED_PROXY');
});
it('writes the generated password atomically with mode 0600 next to the config', async () => {
  const { dir } = await data(); const file = await writeInitialPassword(join(dir, 'server.json'), 'GENERATED_TEST_PASSWORD');
  expect(file).toBe(join(dir, 'initial-password.txt')); expect((await stat(file)).mode & 0o777).toBe(0o600); expect(await readFile(file, 'utf8')).toBe('GENERATED_TEST_PASSWORD\n');
  expect((await readdir(dir)).sort()).toEqual(['initial-password.txt', 'server.json']);
});
it('removes setup temp files older than an hour from the data directory only', async () => {
  const { dir } = await data(); const hex = () => randomBytes(16).toString('hex'); const old = [hex() + '.account-tmp', hex() + '.password-setup']; const fresh = hex() + '.account-tmp';
  const past = new Date(Date.now() - 2 * 3600_000);
  for (const name of [...old, fresh, 'keep.txt']) await writeFile(join(dir, name), 'x', { mode: 0o600 });
  for (const name of old) await utimes(join(dir, name), past, past); await utimes(join(dir, 'keep.txt'), past, past);
  await cleanDataDirectory(dir); expect((await readdir(dir)).sort()).toEqual([fresh, 'keep.txt', 'server.json'].sort());
});
