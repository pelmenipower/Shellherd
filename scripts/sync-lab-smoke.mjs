// Server-first UI test in a sandboxed Electron checkout. Test data/profile only.
import { _electron as electron } from 'playwright-core';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { createSyncServer } from './sync-prototype/server.mjs';
import { createAccount } from './sync-prototype/account-auth.mjs';
assert.notEqual(process.getuid?.(), 0);
assert.ok(process.argv[2], 'Pass a sandbox-capable Electron wrapper which starts this checkout');
const directory = await mkdtemp(join(tmpdir(), 'shellherd-server-ui-'));
const username = 'demo'; const password = 'ONLY_TEST_SERVER_PASSWORD'; let app; let service; let slow;
const launch = (enabled, profile = enabled ? 'enabled' : 'disabled') => electron.launch({ executablePath: resolve(process.argv[2]),
  args: [`--user-data-dir=${join(directory, profile)}`],
  env: { ...process.env, SHELLHERD_SYNC_LAB: enabled ? '1' : '0', XDG_CONFIG_HOME: join(directory, profile, 'config'), SHELLHERD_UPDATE_URL: 'http://127.0.0.1:1/' }, timeout: 30000 });
try {
  const data = join(directory, 'server-data');
  service = await createSyncServer({ directory: data, serverId: randomBytes(32).toString('hex'), namespace: 'ui-probe', account: await createAccount(username, password) });
  const serverUrl = await service.listen();
  app = await launch(true); const page = await app.firstWindow(); const errors = [];
  page.on('pageerror', error => errors.push(error.message)); await page.waitForLoadState('domcontentloaded');
  assert.ok(await page.evaluate(() => window.desktopApi.syncLabEnabled));
  assert.ok(await app.evaluate(({ BrowserWindow }) => { const p = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(); return p.sandbox && p.contextIsolation && !p.nodeIntegration; }));
  await page.evaluate(() => window.desktopApi.setLanguage('de-DE'));
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await page.getByRole('button', { name: 'Selfhosted Sync einrichten', exact: true }).click();
  const dialog = page.locator('dialog.sync-lab-dialog');
  const input = dialog.getByLabel('Server-URL', { exact: true });
  const connect = () => dialog.getByRole('button', { name: 'Anmelden', exact: true });
  assert.equal(await input.inputValue(), ''); assert.ok(await connect().isDisabled());
  await input.fill('http://192.168.1.2:8787'); assert.ok(await connect().isDisabled());
  await input.fill('https://name:secret@sync.example.net'); assert.ok(await connect().isDisabled());
  await input.fill(serverUrl);
  const userInput = dialog.getByLabel('Benutzername', { exact: true }); const passwordInput = dialog.getByLabel('Serverpasswort', { exact: true });
  await userInput.fill(username); await passwordInput.fill('WRONG_TEST_PASSWORD'); await connect().click();
  await dialog.getByRole('alert').filter({ hasText: 'Benutzername oder Serverpasswort ist falsch' }).waitFor();
  assert.equal(await passwordInput.inputValue(), '');
  await passwordInput.fill(password); await page.screenshot({ path: '/tmp/shellherd-sync-server-url.png' });
  await connect().click();
  await dialog.getByRole('heading', { name: 'Am Sync-Server angemeldet' }).waitFor();
  assert.ok((await dialog.innerText()).includes(serverUrl));
  await dialog.getByLabel('Lokales Vault-Passwort', { exact: true }).waitFor();
  assert.ok(!(await dialog.innerText()).includes('noch nicht angebunden'));
  assert.deepEqual(await readdir(data), []); // Discovery never uploads a user's Vault.
  await page.screenshot({ path: '/tmp/shellherd-sync-server-ready.png' });
  assert.ok(!(await dialog.innerText()).toLowerCase().includes('fingerprint'));
  assert.ok(!(await dialog.innerText()).includes(password));
  assert.deepEqual(await readdir(data), []);
  await dialog.getByRole('button', { name: 'Anderen Server auswählen' }).click();
  slow = createServer((_req, _res) => {});
  await new Promise(resolve => slow.listen(0, '127.0.0.1', resolve));
  const pendingRequest = once(slow, 'request');
  await input.fill(`http://127.0.0.1:${slow.address().port}/`); await passwordInput.fill(password); await connect().click();
  const [, response] = await pendingRequest; const disconnected = once(response, 'close');
  await dialog.getByRole('button', { name: 'Schließen', exact: true }).click(); await disconnected;
  await page.evaluate(() => window.desktopApi.setLanguage('en-US'));
  await page.getByRole('button', { name: 'Set up self-hosted sync', exact: true }).click();
  await dialog.getByRole('heading', { name: 'Connect to your sync server' }).waitFor();
  assert.equal(await dialog.getByLabel('Server URL', { exact: true }).inputValue(), '');
  await page.keyboard.press('Escape'); assert.deepEqual(errors, []);

  // Create only a synthetic local vault, then exercise the real manual sync UI.
  const sourcePath = join(directory, 'source.term'); const localPassword = 'ONLY_TEST_LOCAL_VAULT_PASSWORD';
  await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }); }, sourcePath);
  await page.evaluate(async password => {
    const now = new Date().toISOString();
    await window.desktopApi.saveVault({ password, suggestedName: 'source.term', vault: {
      format: 'terminus-vault', version: 2, id: 'ui-sync-test', name: 'Synthetic sync vault', createdAt: now, updatedAt: now,
      nodes: [{ id: 'synthetic-ssh', type: 'connection', protocol: 'ssh', name: 'Synthetic sync SSH', host: 'example.test', port: 22,
        tags: [], authentication: { method: 'password', password: 'ONLY_TEST_SSH_CREDENTIAL' } }], workspaces: [],
      settings: { theme: 'dark', autoLockMinutes: 0, confirmBeforeClosingSession: false },
    } });
  }, localPassword);
  await page.evaluate(() => window.desktopApi.setLanguage('de-DE'));
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, sourcePath);
  await page.reload(); await page.waitForLoadState('domcontentloaded');
  if (!await page.locator('input[type=password]').count()) await page.getByRole('button', { name: 'Vault öffnen', exact: true }).click();
  await page.getByRole('button', { name: /Vault-Datei auswählen/ }).click();
  await page.getByLabel('Passwort', { exact: true }).fill(localPassword);
  await page.getByRole('button', { name: 'Vault öffnen', exact: true }).click();
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await page.getByRole('button', { name: 'Selfhosted Sync einrichten', exact: true }).click();
  await input.fill(serverUrl); await userInput.fill(username); await passwordInput.fill(password); await connect().click();
  await dialog.getByRole('button', { name: 'Jetzt synchronisieren', exact: true }).click();
  await page.getByText('Vault erfolgreich synchronisiert.', { exact: true }).first().waitFor();
  assert.equal((await readdir(data)).length, 1);
  await page.screenshot({ path: '/tmp/shellherd-sync-vault-published.png' });
  assert.deepEqual(errors, []);
  await app.close();

  // A second, fresh profile imports via the server while the first app is offline.
  app = await launch(true, 'second-device'); const importedPage = await app.firstWindow();
  importedPage.on('pageerror', error => errors.push(error.message));
  await importedPage.waitForLoadState('domcontentloaded');
  const importedPath = join(directory, 'imported.term');
  await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }); }, importedPath);
  await importedPage.evaluate(() => window.desktopApi.setLanguage('de-DE'));
  await importedPage.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await importedPage.getByRole('button', { name: 'Selfhosted Sync einrichten', exact: true }).click();
  const importDialog = importedPage.locator('dialog.sync-lab-dialog');
  await importDialog.getByLabel('Server-URL', { exact: true }).fill(serverUrl);
  await importDialog.getByLabel('Benutzername', { exact: true }).fill(username);
  await importDialog.getByLabel('Serverpasswort', { exact: true }).fill(password);
  await importDialog.getByRole('button', { name: 'Anmelden', exact: true }).click();
  const localInput = importDialog.getByLabel('Lokales Vault-Passwort', { exact: true });
  await localInput.fill('WRONG_LOCAL_PASSWORD');
  await importDialog.getByRole('button', { name: 'Vault vom Server laden', exact: true }).click();
  await importDialog.getByRole('alert').filter({ hasText: 'Vault-Passwort' }).waitFor();
  assert.equal(await localInput.inputValue(), '');
  await localInput.fill(localPassword);
  await importDialog.getByRole('button', { name: 'Vault vom Server laden', exact: true }).click();
  await importedPage.locator('.vault-tree-row.is-disabled').filter({ hasText: 'Synthetic sync SSH' }).waitFor();
  await importedPage.screenshot({ path: '/tmp/shellherd-sync-vault-imported.png' });
  for (const path of [importedPath, ...((await readdir(data)).map(file => join(data, file)))]) {
    const raw = await readFile(path, 'utf8');
    for (const secret of [password, localPassword, 'ONLY_TEST_SSH_CREDENTIAL']) assert.ok(!raw.includes(secret));
  }
  assert.deepEqual(errors, []);
  await app.close(); app = await launch(false); const disabled = await app.firstWindow();
  await disabled.waitForLoadState('domcontentloaded');
  assert.equal(await disabled.evaluate(() => window.desktopApi.syncLabEnabled), false);
  const denied = await disabled.evaluate(() => window.desktopApi.syncLabAction({ kind: 'connect', clientId: crypto.randomUUID(), serverUrl: 'https://sync.example.net' }));
  assert.deepEqual(denied, { ok: false, code: 'unavailable' });
  console.log('PASS: Password login, wrong server/local password rejection, cancellation, real Vault upload/import across isolated profiles, disabled imported connection and disabled-feature IPC; renderer sandbox enabled.');
} finally {
  await app?.close(); await service?.close();
  if (slow) await new Promise(resolve => { slow.closeAllConnections(); slow.close(resolve); });
  await rm(directory, { recursive: true, force: true });
}
