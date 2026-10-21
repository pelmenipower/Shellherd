// Creates the synthetic demo vault through the running driver (`npm run drive`), or unlocks it if it exists.
// Entries: web-01 (SSH), ops-01 (SSH, root shell and start commands), files-01 (SFTP), prod-k8s (cluster via web-01), db-main (wrong password), legacy-app (closed port), folder Staging, AI provider Demo-KI.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.DRIVER_PORT ?? 9333);
const RUN_DIR = process.env.SHELLHERD_RUN_DIR ?? path.join(os.tmpdir(), 'shellherd-run');
const VAULT = path.join(RUN_DIR, 'profile', 'demo.term');
const PASSWORD = 'synthetic-vault-demo';

async function call(route, body, query = '') {
  const response = await fetch(`http://127.0.0.1:${PORT}/${route}${query}`, { method: body === undefined ? 'GET' : 'POST', body, headers: { 'x-driver-token': fs.readFileSync(path.join(RUN_DIR, 'token'), 'utf8') } });
  const text = await response.text();
  if (!response.ok) throw new Error(`/${route}: ${text}`);
  return JSON.parse(text);
}
const click = selector => call('click', selector);
const fill = (selector, value) => call('fill', `${selector}\n${value}`);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
// Menu entries carry hints in child spans, so they are matched by their leading text.
const menuItem = label => call('eval', `const item = [...document.querySelectorAll('[role=menuitem]')].find(i => i.textContent.trim().startsWith(${JSON.stringify(label)}) && !i.disabled);
  if (!item) throw new Error('Menüeintrag fehlt: ' + ${JSON.stringify(label)}); item.click();`);
const visible = selector => call('eval', `return !!document.querySelector(${JSON.stringify(selector)})?.offsetParent`);
// Polls a renderer expression until it is truthy; returns false on timeout.
async function waitFor(expression, timeout = 20000) {
  for (const end = Date.now() + timeout; Date.now() < end; await pause(250)) if (await call('eval', `return !!(${expression})`)) return true;
  return false;
}
const allConnections = () => call('eval', `[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Alle Verbindungen')?.click()`);

async function addConnection(menuLabel, name, port, password, extra) {
  await allConnections();
  await click('button:text-is("Neu")');
  await menuItem(menuLabel);
  await fill('input[id$="-name"]', name);
  await fill('input[id$="-host"]', '127.0.0.1');
  await fill('input[id$="-port"]', String(port));
  await fill('input[id$="-username"]', 'demo');
  await call('eval', `const select = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.text === 'Passwort'));
    const option = [...select.options].find(o => o.text === 'Passwort');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, option.value);
    select.dispatchEvent(new Event('change', { bubbles: true }));`);
  await fill('input[id$="-password"]', password);
  await extra?.();
  await click('button:has-text("Verbindung speichern")');
  await pause(800);
}
const addSsh = (name, port, password) => addConnection('SSH', name, port, password);
const addSftp = (name, port, password) => addConnection('SFTP (Dateien)', name, port, password);

// ops-01: root shell and start commands after login. Also added to an existing demo vault when missing.
async function ensureOps() {
  await allConnections();
  if (await call('eval', `return document.body.innerText.includes('ops-01')`)) return false;
  await addConnection('SSH', 'ops-01', 2222, 'synthetic-demo', async () => {
    await click('label:has-text("Nach dem Anmelden root werden (sudo -i)")');
    await fill('textarea[id$="-loginCommands"]', 'cd /var/www\nuptime');
  });
  return true;
}

// Cluster via the context menu of web-01; skipped when the test server has no Kubernetes fake. Returns whether it was created.
async function addCluster() {
  await allConnections();
  await call('rclick', 'text=web-01 >> nth=0');
  await menuItem('Als Kubernetes-Cluster einrichten');
  if (!await waitFor(`document.querySelector('input[id$="-context"]')`)) {
    console.log('Cluster übersprungen (Testserver ohne Kubernetes).');
    await call('key', undefined, '?k=Escape');
    return false;
  }
  await fill('input[id$="-name"]', 'prod-k8s');
  await click('button:has-text("Verbindung speichern")');
  await pause(800);
  return true;
}

// Provider form fields have no ids, so they are addressed by position: name, model, base URL, API key.
async function addAiProvider() {
  const dialog = 'dialog.ai-settings-dialog';
  await click('.settings-button');
  await waitFor(`document.querySelector('dialog.settings-dialog[open]')`);
  await click('dialog.settings-dialog button:has-text("Anbieter verwalten")');
  await waitFor(`document.querySelector('${dialog}[open]')`);
  await click(`${dialog} .ai-add button:has-text("OpenAI-kompatibel")`);
  const values = ['Demo-KI', 'gpt-4o-mini', 'http://127.0.0.1:9335/v1', 'sk-synthetic-demo'];
  for (const [index, value] of values.entries()) await fill(`${dialog} .ai-form .ai-field-input input >> nth=${index}`, value);
  await click(`${dialog} .ai-form button[type=submit]`);
  await waitFor(`document.querySelector('.ai-provider-list li')`);
  await click(`${dialog} > .form-actions .primary-button`);
  await waitFor(`!document.querySelector('${dialog}[open]')`);
  // The settings dialog stays open underneath and would swallow all clicks.
  await click('dialog.settings-dialog > .form-actions .primary-button');
  await waitFor(`!document.querySelector('dialog.settings-dialog[open]')`);
}

// Start states: start card (create/open buttons), open form (last vault preselected, password field) or vault already open.
const vaultOpen = await visible('.workspace-save');
if (!vaultOpen) {
  if (fs.existsSync(VAULT)) {
    if (!await visible('input[type=password]')) await click('button:text-is("Vault öffnen")');
    await fill('input[type=password]', PASSWORD);
    await click('button:text-is("Vault öffnen") >> nth=-1');
    await pause(3000);
    console.log('Demo-Vault entsperrt.');
    if (await ensureOps()) console.log('ops-01 nachgetragen.');
  } else {
    // A remembered file shows the open form; go back to the start card first.
    if (!await waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.includes('Neuen Vault erstellen'))`, 2000)) {
      await click('button:text-matches("^Zur.ck$")');
      await waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.includes('Neuen Vault erstellen'))`);
    }
    await click('button:has-text("Neuen Vault erstellen")');
    await fill('input[placeholder="Meine Server"]', 'Demo');
    await fill('(//input[@type="password"])[1]', PASSWORD);
    await fill('(//input[@type="password"])[2]', PASSWORD);
    await click('button:text-is("Vault erstellen")');
    await pause(4000);
    await addSsh('web-01', 2222, 'synthetic-demo');
    await addSftp('files-01', 2222, 'synthetic-demo');
    // Before db-main/legacy-app: suggestAccessHosts would offer every SSH connection with a matching host as fallback.
    const cluster = await addCluster();
    await addSsh('db-main', 2222, 'wrong-synthetic-pw');
    await addSsh('legacy-app', 1, 'synthetic-demo');
    await ensureOps();
    await allConnections();
    await click('button:text-is("Neu")');
    await menuItem('Neuer Ordner');
    await fill('.sidebar-create-form input', 'Staging');
    await call('key', undefined, '?k=Enter');
    await pause(800);
    await addAiProvider();
    await call('eval', `[...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') ?? '').startsWith('Editor schlie'))?.click()`);
    console.log(`Demo-Vault angelegt: web-01, files-01, ${cluster ? 'prod-k8s, ' : ''}db-main, legacy-app, ops-01, Ordner Staging, KI-Anbieter Demo-KI.`);
  }
} else {
  console.log('Kein Startbildschirm sichtbar – Vault ist vermutlich schon offen.');
}
