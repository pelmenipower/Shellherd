// Scenario script: takes the component screenshots (SFTP, containers, Kubernetes, settings, AI assistant, lock screen, secondary-window lock, login commands, welcome tab) through the running driver.
// Usage: node .claude/skills/run-app/screens.mjs [sftp|containers|kubernetes|settings|assistant|lock|lock-secondary|login-commands|welcome …] [--readme]   (no argument = all)
// --readme copies sftp, containers, kubernetes, settings and assistant to docs/images/screenshot-<name>.png
// Needs the driver, the test server (`npm run drive:sshd`) and the unlocked demo vault (`demo-setup.mjs`).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.DRIVER_PORT ?? 9333);
const RUN_DIR = process.env.SHELLHERD_RUN_DIR ?? path.join(os.tmpdir(), 'shellherd-run');
const SHOTS = process.env.SCREENSHOT_DIR ?? path.join(RUN_DIR, 'shots');
const REPO = path.resolve(import.meta.dirname, '../../..');
const README_SHOTS = new Set(['sftp', 'containers', 'kubernetes', 'settings', 'assistant']);

async function call(route, body, query = '') {
  const response = await fetch(`http://127.0.0.1:${PORT}/${route}${query}`, { method: body === undefined ? 'GET' : 'POST', body, headers: { 'x-driver-token': fs.readFileSync(path.join(RUN_DIR, 'token'), 'utf8') } });
  const text = await response.text();
  if (!response.ok) throw new Error(`/${route}: ${text}`);
  return JSON.parse(text);
}
const click = selector => call('click', selector);
const rclick = selector => call('rclick', selector);
const fill = (selector, value) => call('fill', `${selector}\n${value}`);
const key = name => call('key', undefined, `?k=${encodeURIComponent(name)}`);
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
// The path comes from the driver; README images never show the real local container tree.
const shot = async name => {
  if (readme && README_SHOTS.has(name) && await evaluate(`!!document.querySelector('.local-containers')`))
    throw new Error('„Dieser Computer“ (lokale Container) in der Seitenleiste – kein README-Bild');
  shots.push(await call('ss', undefined, `?name=${name}&crop=status`));
};

// Closes open dialogs and every terminal tab (confirming the close dialog if one appears) so each block starts from the same state.
async function closeTabs() {
  // demo-setup may leave the settings dialog open; it would intercept every click.
  if (await evaluate(`!!document.querySelector('dialog[open]')`)) { await key('Escape'); await pause(300); }
  // The assistant panel persists between runs and would squeeze every other view; the assistant block reopens it.
  if (await evaluate(`document.querySelector('.assistant-toggle')?.getAttribute('aria-pressed') === 'true'`)) { await click('.assistant-toggle'); await pause(300); }
  for (const end = Date.now() + 10000; await evaluate(count('.terminal-tab-close')) > 0; await pause(250)) {
    if (Date.now() > end) throw new Error('Tabs lassen sich nicht schließen (Timeout nach 10 s)');
    if (await evaluate(`!!document.querySelector('dialog.compact-confirm[open]')`)) {
      await click('dialog.compact-confirm[open] .primary-button, dialog.compact-confirm[open] .danger-button');
    } else await click('.terminal-tab-close');
  }
}

// Local pane target: a synthetic folder whose path shows no user name (outside the home directory), else the block fails.
function localTarget() {
  const inside = p => { const rel = path.relative(os.homedir(), p); return !rel.startsWith('..') && !path.isAbsolute(rel); };
  const candidates = [path.join(RUN_DIR, 'local'), process.env.PUBLIC && path.join(process.env.PUBLIC, 'shellherd-demo-local')].filter(Boolean);
  const dir = candidates.find(p => !inside(p));
  if (!dir) throw new Error('Kein Ort für die lokale Spalte ohne Benutzernamen: SHELLHERD_RUN_DIR außerhalb des Benutzerordners setzen (z. B. C:\\shellherd-run).');
  fs.mkdirSync(dir, { recursive: true });
  // Leftover of an aborted run; auto-upload would otherwise upload it.
  fs.rmSync(path.join(dir, 'big.bin'), { force: true });
  fs.writeFileSync(path.join(dir, 'readme.txt'), 'Demo files\nfor the local pane\n');
  fs.writeFileSync(path.join(dir, 'deploy.sh'), '#!/bin/sh\necho deploy\n');
  fs.writeFileSync(path.join(dir, 'notes.md'), '# Notes\n\n- synthetic\n- demo\n');
  return { target: dir, segment: path.basename(dir) };
}

const shots = [];
// The web-01 tab (not the fixed welcome tab) is connected; proves a session is alive.
const connectedTab = `[...document.querySelectorAll('.terminal-tab:not([data-fixed])')].some(b => b.querySelector('.tab-name')?.textContent === 'web-01' && b.querySelector('.tab-status-connected'))`;
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
    // The demo vault survives runs, so a leftover binding (aborted run) is removed first and the block ends by removing its own.
    const removeBinding = async () => {
      await evaluate(`[...document.querySelectorAll('.file-sync-list .transfer-job button')].find(b => b.textContent.trim() === 'Entfernen')?.click()`);
      await waitFor('Bindung entfernen', `!document.querySelector('.file-sync-list .transfer-job')`);
    };
    if (await evaluate(`!!document.querySelector('.file-sync-list .transfer-job')`)) await removeBinding();
    await pause(300);
    await shot('sftp');
    // Type-to-jump: a click on a fixed row focuses the list, then "n" must land on notes.md.
    await click('.file-pane-remote [role=row][data-name="backups"]');
    await key('n');
    await waitFor('Typeahead', `!!document.querySelector('.file-pane-remote .file-row.is-cursor[data-name="notes.md"]')`);
    await shot('sftp-typeahead');
    // Transfer rate: a large upload; the rate vanishes at the end, so the shot follows the wait at once.
    const queue = '.transfer-queue:not(.file-sync-list):not(.edit-list)';
    const bigLocal = path.join(target, 'big.bin');
    const bigServer = path.join(RUN_DIR, 'sftp', 'home', 'demo', 'big.bin');
    try {
      fs.writeFileSync(bigLocal, Buffer.alloc(256 * 1024 * 1024));
      // The local pane has no watcher: refresh before the row exists.
      await click('.file-pane-local button[aria-label="Aktualisieren"]');
      await waitFor('große Datei lokal', `!!document.querySelector('.file-pane-local [role=row][data-name="big.bin"]')`);
      await click('.file-pane-local [role=row][data-name="big.bin"]');
      await click('.file-pane-local .file-pane-actions button:first-child');
      await waitFor('Rate', `/\\d\\s?[KMG]B\\/s/.test(document.querySelector('${queue}')?.innerText ?? '')`, { timeout: 60000, every: 100 });
      await shot('sftp-transfer');
      await waitFor('Upload fertig', `[...document.querySelectorAll('${queue} .transfer-job.is-done')].some(j => j.textContent.includes('big.bin'))`, { timeout: 180000 });
    } finally {
      // Only our own test file, no recursion.
      for (const file of [bigLocal, bigServer, `${bigServer}.part`]) fs.rmSync(file, { force: true });
    }
    await click('.file-pane-local button[aria-label="Aktualisieren"]');
    await click('.file-pane-remote button[aria-label="Aktualisieren"]');
    await waitFor('große Datei entfernt', `!document.querySelector('[role=row][data-name="big.bin"]')`);
    await click(`${queue} header button`);
    // Gear menu in the local pane header: binds the folder shown there.
    await click('.file-pane-local button[aria-haspopup="menu"]');
    await menuItem('Auto-Upload');
    await waitFor('Auto-Upload-Dialog', `document.querySelector('dialog.file-sync-dialog[open]')`);
    await pause(300);
    await shot('sftp-auto-upload-dialog');
    // BusyButton carries hidden placeholder labels, so match by class: the dialog has one primary button.
    await click('dialog.file-sync-dialog[open] .primary-button');
    await waitFor('Zeile Überwacht', `[...document.querySelectorAll('.file-sync-list .transfer-job')].some(j => j.textContent.includes('Überwacht'))`);
    // The server column refreshes throttled after uploads; show the uploaded file.
    await waitFor('hochgeladene Datei', `!!document.querySelector('.file-pane-remote [role=row][data-name="readme.txt"]')`);
    await pause(300);
    await shot('sftp-auto-upload');
    await removeBinding();
  },
  async containers() {
    await rclick('text=web-01 >> nth=0');
    await menuItem('Container-Ansicht öffnen');
    await waitFor('Container-Tabelle', `${count('.kube-table tbody tr')} >= 6`);
    await pause(300);
    await shot('containers');
  },
  async kubernetes() {
    if (!await evaluate(`document.body.innerText.includes('prod-k8s')`)) {
      // A skipped block would leave an outdated README image in place.
      if (readme) throw new Error('prod-k8s fehlt im Baum – ohne Cluster kein README-Bild (Testserver ohne Kubernetes?).');
      console.log('Kubernetes übersprungen: prod-k8s fehlt im Baum (Testserver ohne Kubernetes?).'); return;
    }
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
    // The panel may already be open (state persists between runs); a click would close it.
    if (!await evaluate(`document.querySelector('.assistant-toggle')?.getAttribute('aria-pressed') === 'true'`)) await click('.assistant-toggle');
    await waitFor('Assistent-Eingabe', `document.querySelector('.assistant-input textarea:not([disabled])')`);
    await fill('.assistant-input textarea', 'Ist die Platte zu voll?');
    await click('.assistant-input button[type=submit]');
    await waitFor('KI-Antwort', `!document.querySelector('.assistant-typing') && [...document.querySelectorAll('.assistant-message.is-assistant .assistant-command code')].some(c => c.textContent.includes('du -xh'))`);
    await pause(300);
    await shot('assistant');
  },
  async lock() {
    await click('text=web-01 >> nth=0');
    await key('Enter');
    await waitFor('Terminal', `document.querySelector('.xterm')`);
    await waitFor('verbundener web-01-Tab', connectedTab);
    // Marks the visible terminal node: if it survives the lock, it was not remounted.
    await evaluate(`(document.querySelector('.terminal-panel:not([hidden]) .xterm').dataset.lockProbe = '1')`);
    await pause(1000);
    await click('.lock-button');
    await waitFor('Sperrbildschirm', `document.querySelector('dialog.lock-screen[open]')`);
    if (!await evaluate(`document.querySelector('.vault-shell').inert === true`)) throw new Error('Shell ist nicht inert');
    // Escape must not close the lock screen.
    await key('Escape'); await pause(300); await key('Escape'); await pause(300);
    if (!await evaluate(`!!document.querySelector('dialog.lock-screen[open]')`)) throw new Error('Escape schließt den Sperrbildschirm');
    // A modal opened later must not cover the lock screen: it raises itself again.
    await evaluate(`(() => { const d = document.createElement('dialog'); d.id = 'lock-probe'; document.body.appendChild(d); d.showModal(); })()`);
    await pause(300);
    const onTop = await evaluate(`!!document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest('dialog.lock-screen')`);
    await evaluate(`document.getElementById('lock-probe')?.remove()`);
    if (!onTop) throw new Error('Sperrbildschirm liegt nicht oben (Neuanhebung)');
    // The switch confirmation is a child of the lock screen; raising the lock screen must close it, or the next click would do nothing.
    await click('.lock-screen .secondary-button');
    await waitFor('Wechsel-Rückfrage', `document.querySelector('.lock-screen dialog[open]')`);
    await evaluate(`(() => { const d = document.createElement('dialog'); d.id = 'lock-probe'; document.body.appendChild(d); d.showModal(); })()`);
    await pause(300);
    const confirmClosed = await evaluate(`!document.querySelector('.lock-screen dialog[open]')`);
    if (!confirmClosed) { await evaluate(`document.getElementById('lock-probe')?.remove()`); throw new Error('Wechsel-Rückfrage bleibt nach der Neuanhebung offen'); }
    await click('.lock-screen .secondary-button');
    const confirmReopened = await evaluate(`!!document.querySelector('.lock-screen dialog[open]')`);
    await key('Escape'); await pause(300);
    await evaluate(`document.getElementById('lock-probe')?.remove()`);
    if (!confirmReopened) throw new Error('Wechsel-Rückfrage öffnet nach der Neuanhebung nicht erneut');
    await pause(300);
    await shot('lock-screen');
    await fill('.lock-screen input[type=password]', 'falsches-passwort');
    await click('.lock-screen .primary-button');
    await waitFor('Fehlermeldung', `document.querySelector('.lock-screen .error-message')?.offsetParent`);
    // After a failed attempt the field is empty and keeps the focus, so typing can continue at once.
    if (!await evaluate(`document.activeElement === document.querySelector('.lock-screen input[type=password]') && document.querySelector('.lock-screen input[type=password]').value === ''`)) throw new Error('Passwortfeld nach Fehlversuch nicht leer oder ohne Fokus');
    await fill('.lock-screen input[type=password]', 'synthetic-vault-demo');
    await click('.lock-screen .primary-button');
    await waitFor('Entsperren', `!document.querySelector('dialog.lock-screen[open]') && document.querySelector('.xterm[data-lock-probe]') && ${connectedTab}`, { timeout: 30000 });
    if (!await evaluate(`document.querySelector('.vault-shell').inert === false`)) throw new Error('Shell bleibt nach dem Entsperren inert');
  },
  // Detached window: locks with the main window, shows a form-less lock screen, and is usable again after unlocking in the main window.
  async 'lock-secondary'() {
    await click('.view-add');
    await click('text=web-01 >> nth=0');
    await key('Enter');
    await waitFor('Terminal', `document.querySelector('.xterm')`);
    await waitFor('verbundener web-01-Tab', connectedTab);
    await rclick('.view-tab.is-active');
    await menuItem('In neues Fenster verschieben');
    let main = 0, secondary = -1;
    for (const end = Date.now() + 20000; secondary < 0; await pause(250)) {
      const urls = await call('windows');
      secondary = urls.findIndex(url => url.includes('role=secondary'));
      main = urls.findIndex(url => !url.includes('role=secondary'));
      if (secondary < 0 && Date.now() > end) throw new Error('Nebenfenster (Timeout nach 20 s)');
    }
    const use = index => call('use', undefined, `?i=${index}`);
    try {
      await use(secondary);
      await waitFor('Terminal im Nebenfenster', `document.querySelector('.xterm')`);
      await waitFor('verbundener web-01-Tab im Nebenfenster', connectedTab);
      await click('.xterm-helper-textarea >> nth=0');
      await evaluate(`(document.querySelector('.terminal-panel:not([hidden]) .xterm').dataset.lockProbe = '1')`);
      await use(main);
      await click('.lock-button');
      await use(secondary);
      await waitFor('Sperrbildschirm im Nebenfenster', `document.querySelector('dialog.lock-screen[open]')`);
      if (!await evaluate(`document.querySelector('.vault-shell').inert === true`)) throw new Error('Nebenfenster ist nicht inert');
      if (!await evaluate(`!document.querySelector('.lock-screen form')`)) throw new Error('Sperrbildschirm im Nebenfenster zeigt ein Formular');
      await key('Control+Shift+Space'); await pause(500);
      if (!await evaluate(`!document.querySelector('dialog.workflow-palette[open]') && document.querySelectorAll('dialog[open]').length === 1`)) throw new Error('Workflow-Palette öffnet sich im gesperrten Nebenfenster');
      await call('ss', undefined, '?name=lock-secondary'); shots.push(path.join(SHOTS, 'lock-secondary.png'));
      await use(main);
      await waitFor('Sperrbildschirm im Hauptfenster', `document.querySelector('dialog.lock-screen[open]')`);
      await fill('.lock-screen input[type=password]', 'synthetic-vault-demo');
      await click('.lock-screen .primary-button');
      await waitFor('Entsperren', `!document.querySelector('dialog.lock-screen[open]')`, { timeout: 30000 });
      await use(secondary);
      await waitFor('Nebenfenster entsperrt', `!document.querySelector('dialog.lock-screen[open]') && document.querySelector('.xterm[data-lock-probe]') && ${connectedTab}`, { timeout: 30000 });
      if (!await evaluate(`document.querySelector('.vault-shell').inert === false`)) throw new Error('Nebenfenster bleibt nach dem Entsperren inert');
      await waitFor('Fokus im Nebenfenster-Terminal', `document.activeElement?.classList.contains('xterm-helper-textarea')`, { timeout: 5000 });
    } finally {
      // Closing the last tab closes the window, so the page may vanish mid-cleanup.
      try { await use(secondary); await closeTabs(); } catch { /* window already closed */ }
      for (const end = Date.now() + 10000; (await call('windows')).length > 1 && Date.now() < end; await pause(250));
      await use(0);
    }
  },
  // ops-01: root shell (sudo -i) with start commands; then "Ohne Startbefehle verbinden" gives the plain user prompt without typed commands.
  async 'login-commands'() {
    const screen = `(document.querySelector('.terminal-panel:not([hidden]) .xterm-rows')?.textContent ?? '')`;
    await click('text=ops-01 >> nth=0');
    await key('Enter');
    await waitFor('Terminal', `document.querySelector('.xterm')`);
    await waitFor('Root-Prompt und Startbefehle', `${screen}.includes('root@web-01') && ${screen}.includes('load average')`, { timeout: 30000 });
    await pause(500);
    const uptimes = () => evaluate(`${screen}.split('load average').length - 1`);
    const before = await uptimes();
    await shot('login-commands');
    // Focus return: Escape gives the focus back to the tab, a click into the terminal keeps it there.
    await rclick('.terminal-tab:not([data-fixed])');
    await key('Escape');
    await pause(300);
    if (!await evaluate(`document.activeElement?.id.startsWith('tab-')`)) throw new Error('Fokus ging nach Escape nicht auf den Tab zurück');
    await rclick('.terminal-tab:not([data-fixed])');
    await click('.terminal-panel:not([hidden]) .xterm');
    await pause(300);
    if (!await evaluate(`!!document.activeElement?.closest('.xterm')`)) throw new Error('Fokus wurde nach Klick ins Terminal dem Tab zurückgegeben');
    await rclick('.terminal-tab:not([data-fixed])');
    await menuItem('Ohne Startbefehle verbinden');
    // The root screen has no demo@ prompt, so this only matches the new session.
    await waitFor('Benutzer-Prompt', `${screen}.includes('demo@web-01')`, { timeout: 30000 });
    await pause(500);
    if (await uptimes() > before) throw new Error('Startbefehle wurden trotz „Ohne Startbefehle“ ausgeführt');
    await shot('login-plain');
  },
  async welcome() {
    await click('.terminal-tab-add');
    await click('.connection-picker-welcome');
    await waitFor('Willkommensseite', `document.querySelector('.welcome-page')`);
    await pause(300);
    await shot('welcome');
  },
};

const args = process.argv.slice(2);
const readme = args.includes('--readme');
const wanted = args.filter(arg => arg !== '--readme');
const unknown = wanted.filter(name => !Object.hasOwn(blocks, name));
if (unknown.length) { console.error(`Unbekannter Block: ${unknown.join(', ')}. Verfügbar: ${Object.keys(blocks).join(', ')}`); process.exit(2); }

let vaultOpen = false;
try { vaultOpen = await evaluate(`!!document.querySelector('.workspace-save')?.offsetParent`); } catch (error) { console.error(`Treiber nicht erreichbar: ${error.message}`); process.exit(2); }
if (!vaultOpen) { console.error('Vault nicht offen – zuerst demo-setup.mjs ausführen.'); process.exit(2); }

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
if (readme) for (const file of shots.filter(f => README_SHOTS.has(path.basename(f, '.png')))) {
  const target = path.join(REPO, 'docs', 'images', `screenshot-${path.basename(file)}`);
  fs.copyFileSync(file, target);
  console.log(`→ ${target}`);
}
process.exit(failed ? 1 : 0);
