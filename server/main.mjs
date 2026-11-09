// Standalone selfhosted server. No Electron or third-party runtime dependencies.
import { constants } from 'node:fs';
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createSyncServer } from '../scripts/sync-prototype/server.mjs';
import { accountAuth } from '../scripts/sync-prototype/account-auth.mjs';
const check = ok => { if (!ok) throw Error('Invalid server configuration'); };
export async function readConfig(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    check(stat.isFile() && stat.nlink === 1 && stat.size > 0 && stat.size <= 16384 && (stat.mode & 0o077) === 0);
    const buffer = Buffer.alloc(16385); let used = 0;
    while (used < buffer.length) { const { bytesRead } = await file.read(buffer, used, buffer.length - used, used); if (!bytesRead) break; used += bytesRead; }
    check(used <= 16384); const config = JSON.parse(buffer.subarray(0, used).toString('utf8'));
    check(config && Object.keys(config).sort().join(',') === 'account,namespace,serverId');
    check(config.account !== null && typeof config.account === 'object'); return config;
  } finally { await file.close(); }
}
export async function startServer({ dataDirectory, port = 8787, host = '127.0.0.1', publicUrl = null, trustedProxy = false }) {
  check(Number.isInteger(port) && port >= 0 && port <= 65535);
  await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
  const stat = await lstat(dataDirectory); check(stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0);
  const config = await readConfig(join(dataDirectory, 'server.json'));
  const service = await createSyncServer({ ...config, directory: join(dataDirectory, 'objects'), publicUrl, rendezvous: true, trustedProxy });
  try { await service.listen(port, host); return service; }
  catch (error) { await service.close(); throw error; }
}
// Run only with the server stopped. Preserve the namespace and all vault objects.
export async function replaceAccount(dataDirectory, account) {
  accountAuth(account); const config = await readConfig(join(dataDirectory, 'server.json'));
  const temporary = join(dataDirectory, randomBytes(16).toString('hex') + '.account-tmp');
  try {
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify({ ...config, account })); await file.sync(); } finally { await file.close(); }
    await rename(temporary, join(dataDirectory, 'server.json'));
    const dir = await open(dataDirectory, 'r'); try { await dir.sync(); } finally { await dir.close(); }
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
async function main() {
  process.umask(0o077);
  const mode = process.argv[2] ?? 'serve'; check(process.argv.length <= 3);
  const dataDirectory = resolve(process.env.SHELLHERD_SERVER_DATA ?? './server-data');
  if (mode === 'init' || mode === 'rotate-password') {
    await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
    const stat = await lstat(dataDirectory); check(stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0);
    const script = fileURLToPath(new URL('../scripts/sync-prototype/account-init.mjs', import.meta.url));
    if (mode === 'rotate-password') await readConfig(join(dataDirectory, 'server.json'));
    const target = join(dataDirectory, mode === 'init' ? 'server.json' : randomBytes(16).toString('hex') + '.password-setup');
    try {
      const child = spawn(process.execPath, [script, target], { stdio: 'inherit' });
      process.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); });
      if (mode === 'rotate-password' && process.exitCode === 0) {
        await replaceAccount(dataDirectory, (await readConfig(target)).account);
        console.log('Account replaced. Start the server to use the new login; previous sessions are invalid after restart.');
      }
    } finally { if (mode === 'rotate-password') await unlink(target).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    return;
  }
  check(mode === 'serve');
  const port = Number(process.env.SHELLHERD_SERVER_PORT ?? 8787); check(port > 0);
  const host = process.env.SHELLHERD_SERVER_HOST ?? '127.0.0.1';
  const service = await startServer({ dataDirectory, port, host, publicUrl: process.env.SHELLHERD_SERVER_PUBLIC_URL ?? null, trustedProxy: process.env.SHELLHERD_SERVER_TRUSTED_PROXY === '1' });
  console.log(`Shellherd storage and rendezvous listening on ${host}:${port}`);
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
    if (stopping) return; stopping = true;
    void service.close().catch(() => { process.exitCode = 1; });
  });
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(() => { console.error('Cannot start Shellherd server. Check private data directory, configuration, port and init command.'); process.exitCode = 1; });
}
