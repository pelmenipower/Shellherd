// Run against linux-unpacked, an extracted DEB, or an AppImage. No system Node is used by the app.
import { _electron as electron } from 'playwright-core';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

assert.notEqual(process.getuid?.(), 0, 'Run the GUI smoke test as a normal user so Playwright cannot disable the sandbox');
const executablePath = resolve(process.argv[2] ?? 'dist/linux-unpacked/shellherd');
const profile = await mkdtemp(join(tmpdir(), 'shellherd-smoke-'));
let app;
try {
  app = await electron.launch({ executablePath, args: [`--user-data-dir=${join(profile, 'user-data')}`], env: { ...process.env, XDG_CONFIG_HOME: join(profile, 'config') }, timeout: 30_000 });
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  const caps = await window.evaluate(() => window.desktopApi.capabilities);
  assert.equal(caps.platform, 'linux');
  assert.equal(caps.rdp, false);
  assert.equal(caps.windowsHello, false);
  assert.ok(caps.localShells.includes('bash'));
  const sandboxed = await app.evaluate(({ BrowserWindow }) => {
    const preferences = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return preferences.sandbox && preferences.contextIsolation && !preferences.nodeIntegration;
  });
  assert.ok(sandboxed, 'Renderer sandbox must be enabled');
  assert.ok((await window.locator('body').innerText()).includes('Shellherd'));
  console.log('Linux application opened successfully with isolated, sandboxed renderer.');
} finally {
  await app?.close();
  await rm(profile, { recursive: true, force: true });
}
