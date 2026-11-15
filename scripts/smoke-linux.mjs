// Run against linux-unpacked, an extracted DEB, or an AppImage. No system Node is used by the app.
import { _electron as electron } from 'playwright-core';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { FuseV1Options, getCurrentFuseWire } from '@electron/fuses';

// FuseState.DISABLE of @electron/fuses (the enum is not exported at runtime).
const FUSE_DISABLED = 0x30;
assert.notEqual(process.getuid?.(), 0, 'Run the GUI smoke test as a normal user so Playwright cannot disable the sandbox');
// The release bundle (SHELLHERD_RELEASE=1) must carry no lab code, in any chunk.
const mainDir = resolve('out/main');
const walk = async (dir) => (await Promise.all((await readdir(dir, { withFileTypes: true })).map((e) => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))).flat();
for (const file of (await walk(mainDir)).filter((f) => f.endsWith('.js'))) {
  const text = await readFile(file, 'utf8');
  for (const marker of ['SyncLabHost', 'RemoteLabHost', 'SHELLHERD_SYNC_LAB', 'SHELLHERD_REMOTE_LAB']) {
    assert.ok(!text.includes(marker), `Release bundle must not contain lab code (build with SHELLHERD_RELEASE=1): ${marker} in ${file}`);
  }
}
const executablePath = resolve(process.argv[2] ?? 'dist/linux-unpacked/shellherd');
const profile = await mkdtemp(join(tmpdir(), 'shellherd-smoke-'));
let app;
try {
  app = await electron.launch({ executablePath, args: [`--user-data-dir=${join(profile, 'user-data')}`], env: { ...process.env, XDG_CONFIG_HOME: join(profile, 'config'), SHELLHERD_SYNC_LAB: '1', SHELLHERD_REMOTE_LAB: '1', SHELLHERD_REMOTE_CAPTURE_FAKE: '1' }, timeout: 30_000 });
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  const caps = await window.evaluate(() => window.desktopApi.capabilities);
  assert.equal(caps.platform, 'linux');
  assert.equal(caps.rdp, false);
  assert.equal(caps.windowsHello, false);
  assert.ok(caps.localShells.includes('bash'));
  // Packaged builds must ignore the lab flags even when the environment requests them.
  const labs = await window.evaluate(() => ({ sync: window.desktopApi.syncLabEnabled, remote: window.desktopApi.remoteLabEnabled, fake: window.desktopApi.remoteCaptureFake }));
  assert.deepEqual(labs, { sync: false, remote: false, fake: false }, 'Lab flags must stay off in a packaged build');
  const sandboxed = await app.evaluate(({ BrowserWindow }) => {
    const preferences = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return preferences.sandbox && preferences.contextIsolation && !preferences.nodeIntegration;
  });
  assert.ok(sandboxed, 'Renderer sandbox must be enabled');
  assert.ok((await window.locator('body').innerText()).includes('Shellherd'));
  // Read the flipped fuses straight from the binary (Electron ignores NODE_OPTIONS in packaged apps anyway, so a behaviour probe proves nothing).
  const wire = await getCurrentFuseWire(executablePath);
  assert.equal(wire[FuseV1Options.RunAsNode], FUSE_DISABLED, 'RunAsNode fuse must be disabled');
  assert.equal(wire[FuseV1Options.EnableNodeOptionsEnvironmentVariable], FUSE_DISABLED, 'NODE_OPTIONS fuse must be disabled');
  // Behaviour probe: ELECTRON_RUN_AS_NODE must have no effect on the packaged binary.
  const run = (args, env, ms) => new Promise((res) => {
    const child = spawn(executablePath, args, { env: { ...process.env, ...env, XDG_CONFIG_HOME: join(profile, 'probe-config') }, stdio: 'ignore' });
    const timer = setTimeout(() => child.kill('SIGKILL'), ms);
    child.on('exit', (code) => { clearTimeout(timer); res(code); });
    child.on('error', () => { clearTimeout(timer); res(null); });
  });
  const code = await run(['-e', 'process.exit(7)'], { ELECTRON_RUN_AS_NODE: '1' }, 15_000);
  assert.notEqual(code, 7, 'ELECTRON_RUN_AS_NODE must not turn the binary into Node');
  console.log('Linux application opened successfully with isolated, sandboxed renderer.');
} finally {
  await app?.close();
  await rm(profile, { recursive: true, force: true });
}
