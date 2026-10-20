// Creates the synthetic demo vault through the running driver (`npm run drive`), or unlocks it if it exists.
// Connections: web-01 (works against `npm run drive:sshd`), db-main (wrong password), legacy-app (closed port), folder Staging (empty).
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

async function addSsh(name, port, password) {
  await call('eval', `[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Alle Verbindungen')?.click()`);
  await click('button:text-is("Neu")');
  await menuItem('SSH');
  await fill('input[id$="-name"]', name);
  await fill('input[id$="-host"]', '127.0.0.1');
  await fill('input[id$="-port"]', String(port));
  await fill('input[id$="-username"]', 'demo');
  await call('eval', `const select = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.text === 'Passwort'));
    const option = [...select.options].find(o => o.text === 'Passwort');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, option.value);
    select.dispatchEvent(new Event('change', { bubbles: true }));`);
  await fill('input[id$="-password"]', password);
  await click('button:has-text("Verbindung speichern")');
  await pause(800);
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
  } else {
    await click('button:has-text("Neuen Vault erstellen")');
    await fill('input[placeholder="Meine Server"]', 'Demo');
    await fill('(//input[@type="password"])[1]', PASSWORD);
    await fill('(//input[@type="password"])[2]', PASSWORD);
    await click('button:text-is("Vault erstellen")');
    await pause(4000);
    await addSsh('web-01', 2222, 'synthetic-demo');
    await addSsh('db-main', 2222, 'wrong-synthetic-pw');
    await addSsh('legacy-app', 1, 'synthetic-demo');
    await call('eval', `[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Alle Verbindungen')?.click()`);
    await click('button:text-is("Neu")');
    await menuItem('Neuer Ordner');
    await fill('.sidebar-create-form input', 'Staging');
    await call('key', undefined, '?k=Enter');
    await pause(800);
    await call('eval', `[...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') ?? '').startsWith('Editor schlie'))?.click()`);
    console.log('Demo-Vault angelegt: web-01, db-main, legacy-app, Ordner Staging.');
  }
} else {
  console.log('Kein Startbildschirm sichtbar – Vault ist vermutlich schon offen.');
}
