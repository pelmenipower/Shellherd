// Scenario script: takes the component screenshots (SFTP, containers, Kubernetes, settings, AI assistant) through the running driver.
// Usage: node .claude/skills/run-app/screens.mjs [sftp|containers|kubernetes|settings|assistant …]   (no argument = all)
// Needs the driver, the test server (`npm run drive:sshd`) and the unlocked demo vault (`demo-setup.mjs`).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.DRIVER_PORT ?? 9333);
const RUN_DIR = process.env.SHELLHERD_RUN_DIR ?? path.join(os.tmpdir(), 'shellherd-run');
const SHOTS = process.env.SCREENSHOT_DIR ?? path.join(RUN_DIR, 'shots');

async function call(route, body, query = '') {
  const response = await fetch(`http://127.0.0.1:${PORT}/${route}${query}`, { method: body === undefined ? 'GET' : 'POST', body, headers: { 'x-driver-token': fs.readFileSync(path.join(RUN_DIR, 'token'), 'utf8') } });
  const text = await response.text();
  if (!response.ok) throw new Error(`/${route}: ${text}`);
  return JSON.parse(text);
}
const click = selector => call('click', selector);
const rclick = selector => call('rclick', selector);
const fill = (selector, value) => call('fill', `${selector}\n${value}`);
const key = name => call('key', undefined, `?k=${name}`);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
// Menu entries carry hints in child spans, so they are matched by their leading text.
const menuItem = label => call('eval', `const item = [...document.querySelectorAll('[role=menuitem]')].find(i => i.textContent.trim().startsWith(${JSON.stringify(label)}) && !i.disabled);
  if (!item) throw new Error('Menüeintrag fehlt: ' + ${JSON.stringify(label)}); item.click();`);
const evaluate = expression => call('eval', `return (${expression})`);

// Polls a renderer expression until it is truthy; the failure names the step, not just "timeout".
async function waitFor(step, expression, { timeout = 20000, every = 250 } = {}) {
  for (const end = Date.now() + timeout; ; await pause(every)) {
    if (await call('eval', `return !!(${expression})`)) return;
    if (Date.now() >= end) throw new Error(`${step} (Timeout nach ${timeout / 1000} s)`);
  }
}
const count = selector => `document.querySelectorAll(${JSON.stringify(selector)}).length`;
const shot = async name => { await call('ss', undefined, `?name=${name}&crop=status`); shots.push(path.join(SHOTS, `${name}.png`)); };

// Closes open dialogs and every terminal tab (confirming the close dialog if one appears) so each block starts from the same state.
async function closeTabs() {
  // demo-setup may leave the settings dialog open; it would intercept every click.
  if (await evaluate(`!!document.querySelector('dialog[open]')`)) { await key('Escape'); await pause(300); }
  for (const end = Date.now() + 10000; await evaluate(count('.terminal-tab-close')) > 0; await pause(250)) {
    if (Date.now() > end) throw new Error('Tabs lassen sich nicht schließen (Timeout nach 10 s)');
    if (await evaluate(`!!document.querySelector('dialog.compact-confirm[open]')`)) {
      await click('dialog.compact-confirm[open] .primary-button, dialog.compact-confirm[open] .danger-button');
    } else await click('.terminal-tab-close');
  }
}

// Local pane target: a synthetic folder, but only if the path shows no user name; otherwise the drive root.
function localTarget() {
  const dir = path.join(RUN_DIR, 'local');
  if (!RUN_DIR.toLowerCase().includes(os.userInfo().username.toLowerCase())) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'readme.txt'), 'Demo files\nfor the local pane\n');
    fs.writeFileSync(path.join(dir, 'deploy.sh'), '#!/bin/sh\necho deploy\n');
    fs.writeFileSync(path.join(dir, 'notes.md'), '# Notes\n\n- synthetic\n- demo\n');
    return { target: dir, segment: 'local' };
  }
  const root = path.parse(RUN_DIR).root;
  console.log('Hinweis: SHELLHERD_RUN_DIR ohne Benutzernamen setzen (z. B. C:\\shellherd-run), dann zeigt die lokale Spalte synthetische Dateien.');
  return { target: root, segment: root.replace(/[\\/]+$/, '') };
}

const shots = [];
const blocks = {
  async sftp() {
    const { target, segment } = localTarget();
    await click('text=files-01 >> nth=0');
    await key('Enter');
    await waitFor('SFTP-Liste', `${count('.file-pane-remote [role=row][data-name]')} >= 5 && document.querySelector('.file-pane-remote nav[aria-label="Pfad"]')?.textContent.includes('demo')`);
    // Double click on the nav itself (not on a segment button) switches the path bar to an input.
    await evaluate(`document.querySelector('.file-pane-local nav[aria-label="Pfad"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
    await fill('.file-pane-local input[aria-label="Pfad"]', target);
    await key('Enter');
    await waitFor('lokale Spalte', `document.querySelector('.file-pane-local nav[aria-label="Pfad"]')?.textContent.includes(${JSON.stringify(segment)})`);
    await pause(300);
    await shot('sftp');
  },
  async containers() {
    await rclick('text=web-01 >> nth=0');
    await menuItem('Container-Ansicht öffnen');
    await waitFor('Container-Tabelle', `${count('.kube-table tbody tr')} >= 6`);
    await pause(300);
    await shot('containers');
  },
  async kubernetes() {
    if (!await evaluate(`document.body.innerText.includes('prod-k8s')`)) { console.log('Kubernetes übersprungen: prod-k8s fehlt im Baum (Testserver ohne Kubernetes?).'); return; }
    await click('text=prod-k8s >> nth=0');
    await key('Enter');
    await waitFor('Kubernetes-Ansicht', `document.body.innerText.includes('bereit über web-01') && ${count('.kube-table tbody tr')} >= 5`);
    await pause(1500); // first metrics round
    await shot('kubernetes');
  },
  async settings() {
    await click('.settings-button');
    await waitFor('Einstellungsdialog', `document.querySelector('dialog.settings-dialog[open]')`);
    await pause(300);
    await shot('settings');
    await click('dialog.settings-dialog button:has-text("Anbieter verwalten")');
    await waitFor('Anbieterliste', `${count('.ai-provider-list li')} >= 1`);
    await pause(300);
    await shot('ai-settings');
    await click('dialog.ai-settings-dialog > .form-actions .primary-button');
    await waitFor('Dialog schließen', `!document.querySelector('dialog.ai-settings-dialog[open]')`);
    if (await evaluate(`!!document.querySelector('dialog.settings-dialog[open]')`)) await key('Escape');
    await waitFor('Einstellungen schließen', `!document.querySelector('dialog.settings-dialog[open]')`);
  },
  async assistant() {
    await click('text=web-01 >> nth=0');
    await key('Enter');
    await waitFor('Terminal', `document.querySelector('.xterm')`);
    await pause(1500);
    await click('.xterm-helper-textarea >> nth=0');
    await call('type', 'df -h /');
    await key('Enter');
    await pause(500);
    await click('.assistant-toggle');
    await waitFor('Assistent-Eingabe', `document.querySelector('.assistant-input textarea:not([disabled])')`);
    await fill('.assistant-input textarea', 'Ist die Platte zu voll?');
    await click('.assistant-input button[type=submit]');
    await waitFor('KI-Antwort', `!document.querySelector('.assistant-typing') && [...document.querySelectorAll('.assistant-message.is-assistant .assistant-command code')].some(c => c.textContent.includes('du -xh'))`);
    await pause(300);
    await shot('assistant');
  },
};

let vaultOpen = false;
try { vaultOpen = await evaluate(`!!document.querySelector('.workspace-save')?.offsetParent`); } catch (error) { console.error(`Treiber nicht erreichbar: ${error.message}`); process.exit(2); }
if (!vaultOpen) { console.error('Vault nicht offen – zuerst demo-setup.mjs ausführen.'); process.exit(2); }

const wanted = process.argv.slice(2);
const unknown = wanted.filter(name => !(name in blocks));
if (unknown.length) { console.error(`Unbekannter Block: ${unknown.join(', ')}. Verfügbar: ${Object.keys(blocks).join(', ')}`); process.exit(2); }
let failed = false;
for (const name of wanted.length ? wanted : Object.keys(blocks)) {
  try {
    await closeTabs();
    await blocks[name]();
  } catch (error) {
    failed = true;
    console.error(`✗ ${name}: ${error.message}`);
  }
}
for (const file of shots) console.log(file);
process.exit(failed ? 1 : 0);
