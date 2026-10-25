// Scenario script: takes the component screenshots (SFTP, containers, Kubernetes, settings, AI assistant, lock screen, secondary-window lock, login commands, welcome tab, import sources, update hint) through the running driver.
// Usage: node .claude/skills/run-app/screens.mjs [sftp|containers|kubernetes|settings|assistant|masking|lock|lock-secondary|login-commands|welcome|auth-prompt|jump-form|forwards|terminal-search|terminal-link|terminal-link-osc8|settings-terminal|tab-activity|broadcast|import|update|recent|theme-light|vault-path|host-keys|hello …] [--readme]   (no argument = all)
// --readme copies sftp, containers, kubernetes, settings and assistant to docs/images/screenshot-<name>.png
// Needs the driver, the test server (`npm run drive:sshd`) and the unlocked demo vault (`demo-setup.mjs`).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { AI_REQUEST_LOG, DEMO_KEPT, DEMO_SECRETS } from './ai-fake.mjs';

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
// Layout menu buttons carry no role; matched by their full text.
const menuButton = label => call('eval', `const item = [...document.querySelectorAll('.pane-layout-menu button')].find(b => b.textContent.trim() === ${JSON.stringify(label)});
  if (!item) throw new Error('Menüknopf fehlt: ' + ${JSON.stringify(label)}); item.click();`);

// Polls a renderer expression until it is truthy; the failure names the step, not just "timeout".
async function waitFor(step, expression, { timeout = 20000, every = 250 } = {}) {
  for (const end = Date.now() + timeout; ; await pause(every)) {
    if (await call('eval', `return !!(${expression})`)) return;
    if (Date.now() >= end) throw new Error(`${step} (Timeout nach ${timeout / 1000} s)`);
  }
}
const count = selector => `document.querySelectorAll(${JSON.stringify(selector)}).length`;
// The path comes from the driver; README images never show the real local container tree.
// keepStatus: the update badge lives in the status bar, so those shots keep it (the vault path is a temp path).
const shot = async (name, keepStatus = false) => {
  if (readme && README_SHOTS.has(name) && await evaluate(`!!document.querySelector('.local-containers')`))
    throw new Error('„Dieser Computer“ (lokale Container) in der Seitenleiste – kein README-Bild');
  shots.push(await call('ss', undefined, `?name=${name}${keepStatus ? '' : '&crop=status'}`));
};

// Content protection of every visible window, read in the main process (one flag per window, main window first).
const contentProtection = () => call('main', 'return electron.BrowserWindow.getAllWindows().filter(w => !w.isDestroyed() && w.isVisible()).map(w => w.isContentProtected());');

// Hovers the first occurrence of `link` in the visible terminal. xterm caches the link answer per row, so the mouse first
// rests on the bottom row (empty in these scenes); a move straight from the typed line would reuse the empty answer.
async function hoverLink(link) {
  const corner = await evaluate(`(() => { const r = document.querySelector('.terminal-panel:not([hidden]) .xterm-screen').getBoundingClientRect(); return { x: r.left + 5, y: r.bottom - 5 }; })()`);
  await call('move', undefined, `?x=${corner.x}&y=${corner.y}`);
  const point = await call('eval', `const rows = document.querySelector('.terminal-panel:not([hidden]) .xterm-rows');
  const walker = document.createTreeWalker(rows, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const at = node.textContent.indexOf(${JSON.stringify(link)});
    if (at < 0) continue;
    const range = document.createRange();
    range.setStart(node, at); range.setEnd(node, Math.min(node.textContent.length, at + ${link.length}));
    const box = range.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }
  throw new Error('Link nicht im Terminal gefunden');`);
  await call('move', undefined, `?x=${point.x}&y=${point.y}`);
}

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

// True when the path lies in the user's home directory (its names then show the Windows user name).
const insideHome = p => { const rel = path.relative(os.homedir(), p); return !rel.startsWith('..') && !path.isAbsolute(rel); };

// Local pane target: a synthetic folder whose path shows no user name (outside the home directory), else the block fails.
function localTarget() {
  const candidates = [path.join(RUN_DIR, 'local'), process.env.PUBLIC && path.join(process.env.PUBLIC, 'shellherd-demo-local')].filter(Boolean);
  const dir = candidates.find(p => !insideHome(p));
  if (!dir) throw new Error('Kein Ort für die lokale Spalte ohne Benutzernamen: SHELLHERD_RUN_DIR außerhalb des Benutzerordners setzen (z. B. C:\\shellherd-run).');
  fs.mkdirSync(dir, { recursive: true });
  // Leftover of an aborted run; auto-upload would otherwise upload it.
  fs.rmSync(path.join(dir, 'big.bin'), { force: true });
  fs.writeFileSync(path.join(dir, 'readme.txt'), 'Demo files\nfor the local pane\n');
  fs.writeFileSync(path.join(dir, 'deploy.sh'), '#!/bin/sh\necho deploy\n');
  fs.writeFileSync(path.join(dir, 'notes.md'), '# Notes\n\n- synthetic\n- demo\n');
  return { target: dir, segment: path.basename(dir) };
}

// Import and update scenes: sources from import-fixtures.mjs (the driver writes them to RUN_DIR/import).
const IMPORT_DIR = path.join(RUN_DIR, 'import');
const VAULT_FILE = path.join(RUN_DIR, 'profile', 'demo.term');
const SETTINGS_FILE = path.join(RUN_DIR, 'profile', 'Shellherd', 'settings.json');
const UPDATE_FLAG = path.join(RUN_DIR, 'update-available');
// Replaces the native open dialog in the main process; the driver's stub answers with the demo vault.
const setOpenDialog = file => call('main', `electron.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [${JSON.stringify(file)}] });`);
// Opens the import menu entry by its leading text and waits until the dialog shows its preview or error.
async function openImport(menuLabel, step) {
  await click('button:text-is("Neu")');
  await menuItem(menuLabel);
  await waitFor(`Import-Dialog ${step}`, `document.querySelector('dialog.import-dialog[open] .import-list, dialog.import-dialog[open] .field-error')`);
  await pause(300);
}
// Cancel button of the import dialog (form actions, not the close button of the error state, which has the same class).
const cancelImport = async () => {
  await click('dialog.import-dialog[open] .form-actions .secondary-button');
  await waitFor('Import-Dialog geschlossen', `!document.querySelector('dialog.import-dialog[open]')`);
};
// Earlier runs leave their import folder behind; its candidates would then all be duplicates and nothing is left to import.
// Best effort: the import is already done, so a failed cleanup only warns and the block stays green.
async function removeImportFolder(name) {
  const present = `[...document.querySelectorAll('.vault-tree-row')].some(r => r.textContent.includes(${JSON.stringify(name)}))`;
  if (!await evaluate(present)) return;
  try {
    // A plain click only selects the row; the folder editor opens through the context menu entry "Bearbeiten".
    await rclick(`.vault-tree-row >> text=${name} >> nth=0`);
    await menuItem('Bearbeiten');
    await waitFor(`Ordner-Editor ${name}`, `document.querySelector('section.node-editor .editor-management > summary')`);
    await click('section.node-editor .editor-management > summary');
    await click('section.node-editor .editor-management .danger-button');
    await click('dialog.compact-confirm[open] .primary-button, dialog.compact-confirm[open] .danger-button');
    await waitFor(`Ordner ${name} entfernt`, `!${present}`);
  } catch (error) {
    console.warn(`Warnung: Aufräumen von ${name} fehlgeschlagen (${error.message}). Der Importordner bleibt im Baum.`);
  }
}

const shots = [];
// The web-01 tab (not the fixed welcome tab) is connected; proves a session is alive.
const connectedTab = `[...document.querySelectorAll('.terminal-tab:not([data-fixed])')].some(b => b.querySelector('.tab-name')?.textContent === 'web-01' && b.querySelector('.tab-status-connected'))`;
// Sidebar row by name: the tab bar shows the same name, so the row is named explicitly.
const web01 = '.vault-tree-row >> text=web-01 >> nth=0';
// Connected web-01 tabs; duplicates are labelled "web-01 (1)", so the name is matched by prefix.
const web01Connected = `[...document.querySelectorAll('.terminal-tab:not([data-fixed])')].filter(b => /^web-01/.test(b.querySelector('.tab-name')?.textContent ?? '') && b.querySelector('.tab-status-connected')).length`;
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
    // Go-to field, hidden files and filter (server pane only). The menu entry decides what a click does, so a leftover switch from an aborted run is fixed too.
    const setServerHidden = async label => {
      await click('.file-pane-remote button[aria-haspopup="menu"]');
      if (await evaluate(`[...document.querySelectorAll('[role=menuitem]')].some(i => i.textContent.trim().startsWith(${JSON.stringify(label)}))`)) await menuItem(label);
      else await key('Escape');
    };
    try {
      // Go-to field: a missing folder keeps the field open with the error.
      await click('.file-pane-remote [role=row][data-name="backups"]');
      await key('Control+l');
      await fill('.file-pane-remote input[aria-label="Pfad"]', '/etc/nginx/fehlt');
      await key('Enter');
      await waitFor('Fehler am Pfadfeld', `!!document.querySelector('.file-pane-remote .file-path .field-error')`);
      await pause(300);
      await shot('sftp-goto');
      // Relative path, then "~" back to the home folder.
      await fill('.file-pane-remote input[aria-label="Pfad"]', 'www');
      await key('Enter');
      await waitFor('Ordner www', `document.querySelector('.file-pane-remote nav[aria-label="Pfad"]')?.textContent.includes('www')`);
      await key('Control+l');
      await fill('.file-pane-remote input[aria-label="Pfad"]', '~');
      await key('Enter');
      await waitFor('Basisordner mit notes.md', `!!document.querySelector('.file-pane-remote [role=row][data-name="notes.md"]')`);
      // Hidden files off: dot names gone, footer counts them.
      await setServerHidden('Versteckte Dateien ausblenden');
      await waitFor('ausgeblendete Dateien', `${count('.file-pane-remote [role=row][data-name=".bashrc"]')} === 0 && (document.querySelector('.file-pane-remote .file-pane-footer')?.textContent ?? '').includes('ausgeblendet')`);
      await pause(300);
      await shot('sftp-hidden');
      // Filter "ba": only backups stays; .bashrc is hidden; the hidden count depends on what earlier runs uploaded.
      await click('.file-pane-remote [role=row][data-name="backups"]');
      await key('Control+f');
      await fill('.file-pane-remote .file-filter input', 'ba');
      await waitFor('Filter ba', `${count('.file-pane-remote [role=row][data-name]')} === 1 && (document.querySelector('.file-pane-remote .file-pane-footer')?.textContent ?? '').includes(' ausgeblendet')`);
      await pause(300);
      await shot('sftp-filter');
    } finally {
      // Back to the old state: no filter, hidden files shown (the demo profile keeps localStorage).
      if (await evaluate(`${count('.file-pane-remote .file-filter input')} > 0`)) { await click('.file-pane-remote .file-filter input'); await key('Escape'); }
      await setServerHidden('Versteckte Dateien anzeigen');
    }
    // Transfer rate, cancel, resume, verify: a large random upload (random, so the content comparison means something); the rate vanishes at the end, so shots follow their wait at once.
    const queue = '.transfer-queue:not(.file-sync-list):not(.edit-list)';
    const bigLocal = path.join(target, 'big.bin');
    const bigServer = path.join(RUN_DIR, 'sftp', 'home', 'demo', 'big.bin');
    const rate = `/\\d\\s?[KMG]B\\/s/.test(document.querySelector('${queue}')?.innerText ?? '')`;
    const logRate = async () => console.log(`Rate: ${await evaluate(`(document.querySelector('${queue}')?.innerText.match(/\\d[\\d,.]*\\s?[KMG]B\\/s/) ?? [''])[0]`)}`);
    // Buttons of the big.bin job row, matched by their text.
    const jobButton = (label, row = '.transfer-job') => `[...document.querySelectorAll('${queue} ${row}')].filter(j => j.textContent.includes('big.bin')).flatMap(j => [...j.querySelectorAll('button')]).find(b => b.textContent.trim() === ${JSON.stringify(label)} && !b.disabled)`;
    const sha256 = file => new Promise((resolve, reject) => {
      const hash = createHash('sha256');
      fs.createReadStream(file).on('data', chunk => hash.update(chunk)).on('error', reject).on('end', () => resolve(hash.digest('hex')));
    });
    try {
      // 512 MiB; if the window for the cancel gets too tight, use 1 GiB.
      fs.writeFileSync(bigLocal, randomBytes(512 * 1024 * 1024));
      // The local pane has no watcher: refresh before the row exists.
      await click('.file-pane-local button[aria-label="Aktualisieren"]');
      await waitFor('große Datei lokal', `!!document.querySelector('.file-pane-local [role=row][data-name="big.bin"]')`);
      await click('.file-pane-local [role=row][data-name="big.bin"]');
      await click('.file-pane-local .file-pane-actions button:first-child');
      await waitFor('Rate', rate, { timeout: 60000, every: 100 });
      await logRate();
      await waitFor('Abbrechen-Knopf', jobButton('Abbrechen'), { timeout: 5000, every: 50 });
      await evaluate(`${jobButton('Abbrechen')}.click()`);
      await waitFor('Fortsetzen und Teildatei verwerfen', `${jobButton('Fortsetzen')} && ${jobButton('Teildatei verwerfen')}`);
      await pause(300);
      await shot('sftp-transfer-canceled');
      await evaluate(`${jobButton('Fortsetzen')}.click()`);
      await waitFor('fortgesetzt', `document.querySelector('${queue}')?.innerText.includes('fortgesetzt ab') && ${rate}`, { timeout: 60000, every: 100 });
      await logRate();
      await shot('sftp-transfer');
      await waitFor('Upload fertig', `!!${jobButton('Prüfen', '.transfer-job.is-done')}`, { timeout: 300000 });
      const [local, server] = await Promise.all([sha256(bigLocal), sha256(bigServer)]);
      if (local !== server) throw new Error(`SHA-256 weicht ab: lokal ${local}, Server ${server}`);
      await evaluate(`${jobButton('Prüfen', '.transfer-job.is-done')}.click()`);
      await waitFor('Prüfsumme', `[...document.querySelectorAll('${queue} .transfer-job.is-done')].some(j => j.textContent.includes('big.bin') && j.textContent.includes('Prüfsumme stimmt'))`, { timeout: 120000 });
      await shot('sftp-transfer-verified');
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
  // Masking: the demo server's terminal output and a question go to the AI fake, which logs every request body. Nothing synthetic may reach the log.
  // Masking is switched off through the provider form for a positive control, then on again in finally.
  async masking() {
    const log = path.join(RUN_DIR, AI_REQUEST_LOG);
    const sent = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '');
    const ask = async (question, done) => {
      await fill('.assistant-input textarea', question);
      await click('.assistant-input button[type=submit]');
      await waitFor('KI-Antwort', `!document.querySelector('.assistant-typing') && (${done})`);
    };
    // Masking on/off through the provider form: Settings → Anbieter verwalten → Bearbeiten.
    const setMasking = async (on, shotName) => {
      await click('.settings-button');
      await waitFor('Einstellungsdialog', `document.querySelector('dialog.settings-dialog[open]')`);
      await click('dialog.settings-dialog button:has-text("Anbieter verwalten")');
      await waitFor('Anbieterliste', `${count('.ai-provider-list li')} >= 1`);
      await click('.ai-provider-list li:has-text("Demo-KI") button:has-text("Bearbeiten")');
      await waitFor('Formular', `document.querySelector('.ai-check input')`);
      if (await evaluate(`document.querySelector('.ai-check input').checked`) !== on) await click('.ai-check input');
      if (shotName) { await pause(300); await shot(shotName); }
      await click('.ai-form button[type=submit]');
      await waitFor('Liste', `${count('.ai-provider-list li')} >= 1 && !document.querySelector('.ai-form')`);
      await click('dialog.ai-settings-dialog > .form-actions .primary-button');
      await waitFor('Dialog schließen', `!document.querySelector('dialog.ai-settings-dialog[open]')`);
      if (await evaluate(`!!document.querySelector('dialog.settings-dialog[open]')`)) await key('Escape');
      await waitFor('Einstellungen schließen', `!document.querySelector('dialog.settings-dialog[open]')`);
    };
    fs.rmSync(log, { force: true });
    await click('text=web-01 >> nth=0');
    await key('Enter');
    await waitFor('verbundener web-01-Tab', connectedTab);
    await pause(800);
    await click('.xterm-helper-textarea >> nth=0');
    await call('type', 'cat ~/.env');
    await key('Enter');
    await pause(500);
    if (!await evaluate(`document.querySelector('.assistant-toggle')?.getAttribute('aria-pressed') === 'true'`)) await click('.assistant-toggle');
    await waitFor('Assistent-Eingabe', `document.querySelector('.assistant-input textarea:not([disabled])')`);
    await ask('Warum klappt die Datenbankverbindung nicht?', `document.body.innerText.includes('Enthält maskierte Werte')`);
    await waitFor('Maskiert-Hinweis', `[...document.querySelectorAll('.assistant-note')].some(n => n.textContent.startsWith('Vertrauliche Werte maskiert:'))`);
    const masked = sent();
    const leaks = Object.entries(DEMO_SECRETS).filter(([, value]) => masked.includes(value)).map(([name]) => name);
    if (leaks.length) throw new Error(`Geheimnis erreicht den KI-Fake: ${leaks.join(', ')}`);
    const lost = DEMO_KEPT.filter(value => !masked.includes(value));
    if (lost.length) throw new Error(`Falsch maskiert: ${lost.join(', ')}`);
    // Only user messages count: the system prompt always names [SECRET_1] as an example.
    const userText = masked.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)).flatMap(body => body.messages.filter(m => m.role === 'user').map(m => m.content)).join('\n');
    if ((userText.match(/\[SECRET_\d+\]/g) ?? []).length < 14) throw new Error('Zu wenige Platzhalter in den Nutzer-Nachrichten');
    await pause(300);
    await shot('assistant-masked');
    try {
      await setMasking(false, 'ai-provider-masking');
      await waitFor('Hinweis Maskierung aus', `document.body.innerText.includes('Maskierung ist für diesen Anbieter aus')`);
      const before = sent().length;
      await ask('Und ohne Maskierung?', `[...document.querySelectorAll('.assistant-message.is-assistant .assistant-command code')].some(c => c.textContent.includes('du -xh'))`);
      // Positive control: with masking off the screen goes out unchanged.
      if (!sent().slice(before).includes(DEMO_SECRETS.dbPassword)) throw new Error('Schalter wirkt nicht: Klartext fehlt im Protokoll');
      await pause(300);
      await shot('assistant-masking-off');
    } finally {
      await setMasking(true);
      fs.rmSync(log, { force: true });
    }
    const catalog = await evaluate('window.desktopApi.aiCatalog()');
    if (!catalog.providers.every(p => p.masking)) throw new Error('Maskierung nach der Szene nicht wieder an');
    await closeTabs();
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
    const protectedNow = await contentProtection();
    if (!protectedNow.length || protectedNow.includes(false)) throw new Error(`Fensterschutz fehlt während der Sperre: ${JSON.stringify(protectedNow)}`);
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
    await click('.lock-screen .form-actions .secondary-button');
    await waitFor('Wechsel-Rückfrage', `document.querySelector('.lock-screen dialog[open]')`);
    await evaluate(`(() => { const d = document.createElement('dialog'); d.id = 'lock-probe'; document.body.appendChild(d); d.showModal(); })()`);
    await pause(300);
    const confirmClosed = await evaluate(`!document.querySelector('.lock-screen dialog[open]')`);
    if (!confirmClosed) { await evaluate(`document.getElementById('lock-probe')?.remove()`); throw new Error('Wechsel-Rückfrage bleibt nach der Neuanhebung offen'); }
    await click('.lock-screen .form-actions .secondary-button');
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
    if (!(await contentProtection()).every(v => v === false)) throw new Error('Fensterschutz bleibt nach dem Entsperren');
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
      const protectedNow = await contentProtection();
      if (protectedNow.length < 2 || protectedNow.includes(false)) throw new Error(`Fensterschutz fehlt im gesperrten Nebenfenster: ${JSON.stringify(protectedNow)}`);
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
      if (!(await contentProtection()).every(v => v === false)) throw new Error('Fensterschutz bleibt nach dem Entsperren');
      await waitFor('Fokus im Nebenfenster-Terminal', `document.activeElement?.classList.contains('xterm-helper-textarea')`, { timeout: 5000 });
    } finally {
      // Closing the last tab closes the window, so the page may vanish mid-cleanup.
      try { await use(secondary); await closeTabs(); } catch { /* window already closed */ }
      for (const end = Date.now() + 10000; (await call('windows')).length > 1 && Date.now() < end; await pause(250));
      await use(0);
    }
  },
  // ops-01: root shell (sudo -i) with start commands; then the tab menu renames the tab without touching the session.
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
    await menuItem('Umbenennen');
    await fill('input.view-rename', 'Deploy');
    await key('Enter');
    await waitFor('Tab umbenannt', `document.querySelector('.terminal-tab:not([data-fixed]) .tab-name')?.textContent === 'Deploy'`);
    await pause(300);
    if (await uptimes() !== before) throw new Error('Umbenennen hat die Sitzung neu gestartet');
    await shot('tab-renamed');
  },
  // mfa-01 has a stored password, so only the second round (verification code) reaches the dialog; Escape cancels it.
  async 'auth-prompt'() {
    await click('text=mfa-01 >> nth=0');
    await key('Enter');
    await waitFor('Anmeldedialog', `document.querySelector('dialog[open] input[type=password]')`, { timeout: 30000 });
    await pause(300);
    await shot('auth-prompt');
    await key('Escape');
    await waitFor('Anmeldedialog geschlossen', `!document.querySelector('dialog[open] input[type=password]')`);
  },
  // Edit form of app-intern with "Weitere Angaben" open: jump host selection and port forward editor.
  async 'jump-form'() {
    await rclick('text=app-intern >> nth=0');
    await menuItem('Bearbeiten');
    await waitFor('Formular', `document.querySelector('details.editor-details > summary')`);
    await call('eval', `const details = [...document.querySelectorAll('details.editor-details')].find(d => d.querySelector('summary')?.textContent.includes('Weitere Angaben'));
  if (!details) throw new Error('Abschnitt „Weitere Angaben“ fehlt'); details.open = true;`);
    await waitFor('Weitere Angaben geöffnet', `[...document.querySelectorAll('details.editor-details')].find(d => d.querySelector('summary')?.textContent.includes('Weitere Angaben'))?.open`);
    // The section sits below the fold; show the jump host and the forwards together.
    await call('eval', `[...document.querySelectorAll('label')].find(l => l.textContent.trim().startsWith('Sprunghost'))?.scrollIntoView({ block: 'start' });`);
    await pause(300);
    await shot('jump-form');
  },
  // app-intern through web-01: the bar shows the automatic local forward as active and the SOCKS forward as off.
  async forwards() {
    await click('text=app-intern >> nth=0');
    await key('Enter');
    await waitFor('Terminal', `document.querySelector('.xterm')`);
    await waitFor('verbundener app-intern-Tab', `[...document.querySelectorAll('.terminal-tab:not([data-fixed])')].some(b => b.querySelector('.tab-name')?.textContent === 'app-intern' && b.querySelector('.tab-status-connected'))`, { timeout: 30000 });
    await waitFor('Weiterleitungsleiste', `(document.querySelector('.terminal-panel:not([hidden])')?.innerText ?? '').includes('localhost:15432') && (document.querySelector('.terminal-panel:not([hidden])')?.innerText ?? '').includes('aktiv')`, { timeout: 30000 });
    await pause(300);
    await shot('forwards');
  },
  async welcome() {
    await click('.terminal-tab-add');
    await click('.connection-picker-welcome');
    await waitFor('Willkommensseite', `document.querySelector('.welcome-page')`);
    await pause(300);
    await shot('welcome');
  },
  // Search bar over the output of uptime: Strg+Umschalt+F opens it, typing selects the first match.
  async 'terminal-search'() {
    await click(web01);
    await key('Enter');
    await waitFor('Terminal', `document.querySelector('.xterm')`);
    await waitFor('verbundener web-01-Tab', `${web01Connected} === 1`);
    await click('.xterm-helper-textarea >> nth=0');
    await call('type', 'uptime');
    await key('Enter');
    await pause(500);
    await key('Control+Shift+F');
    await waitFor('Suchfeld fokussiert', `document.activeElement?.matches('.terminal-search input')`);
    await call('type', 'load');
    await waitFor('Suchleiste mit Treffer', `!!document.querySelector('.terminal-search') && !document.querySelector('.terminal-search-status')?.textContent`);
    await pause(300);
    await shot('terminal-search');
  },
  // cat ~/LIESMICH prints two https links; the hover hint names Strg+Klick. The mouse goes to the middle of the first link.
  async 'terminal-link'() {
    await click(web01);
    await key('Enter');
    await waitFor('Terminal', `document.querySelector('.xterm')`);
    await waitFor('verbundener web-01-Tab', `${web01Connected} === 1`);
    await click('.xterm-helper-textarea >> nth=0');
    await call('type', 'cat ~/LIESMICH');
    await key('Enter');
    await waitFor('Link im Terminal', `(document.querySelector('.terminal-panel:not([hidden]) .xterm-rows')?.textContent ?? '').includes('https://intranet.demo/handbuch')`);
    await hoverLink('https://intranet.demo/handbuch');
    await waitFor('Link-Hinweis', `!!document.querySelector('.terminal-link-hint')`);
    await pause(300);
    await shot('terminal-link');
  },
  // cat ~/LINKS prints an OSC-8 link: the text is intranet.demo, the target status.intranet.demo, so the hint must name the target host.
  async 'terminal-link-osc8'() {
    await click(web01);
    await key('Enter');
    await waitFor('Terminal', `document.querySelector('.xterm')`);
    await waitFor('verbundener web-01-Tab', `${web01Connected} === 1`);
    await click('.xterm-helper-textarea >> nth=0');
    await call('type', 'cat ~/LINKS');
    await key('Enter');
    await waitFor('OSC-8-Link im Terminal', `(document.querySelector('.terminal-panel:not([hidden]) .xterm-rows')?.textContent ?? '').includes('https://intranet.demo/login')`);
    await hoverLink('https://intranet.demo/login');
    await waitFor('Link-Hinweis mit Ziel-Host', `(document.querySelector('.terminal-link-hint')?.textContent ?? '').includes('status.intranet.demo')`);
    await pause(300);
    await shot('terminal-link-osc8');
  },
  // Terminal section of the settings dialog: font, size, scrollback, cursor and blink.
  async 'settings-terminal'() {
    await click('.settings-button');
    await waitFor('Einstellungsdialog', `document.querySelector('dialog.settings-dialog[open]')`);
    await call('eval', `const section = [...document.querySelectorAll('dialog.settings-dialog .settings-section')].find(s => s.querySelector('h3')?.textContent.trim() === 'Terminal');
  if (!section) throw new Error('Abschnitt „Terminal“ fehlt'); section.scrollIntoView({ block: 'start' });`);
    await pause(300);
    await shot('settings-terminal');
    await key('Escape');
    await waitFor('Einstellungen schließen', `!document.querySelector('dialog.settings-dialog[open]')`);
  },
  // Two tabs of web-01 in one view: the first runs a slow command, the second is selected at once; the ring marks the first when its output arrives.
  async 'tab-activity'() {
    await click(web01);
    await key('Enter');
    await waitFor('Terminal', `document.querySelector('.xterm')`);
    await waitFor('verbundener web-01-Tab', `${web01Connected} === 1`);
    await click(web01);
    await key('Enter');
    await waitFor('zwei verbundene web-01-Tabs', `${web01Connected} === 2`, { timeout: 30000 });
    await click('.terminal-tab:not([data-fixed]) >> nth=0');
    await click('.terminal-panel:not([hidden]) .xterm');
    await call('type', 'sleep 3; echo fertig');
    await key('Enter');
    await pause(300);
    await click('.terminal-tab:not([data-fixed]) >> nth=1');
    await waitFor('Ring am ersten Tab', `!!document.querySelector('.terminal-tab[data-activity]')`, { timeout: 15000 });
    await pause(300);
    await shot('tab-activity');
  },
  // Two web-01 panes side by side in one view; the broadcast mode sends one command to both and shows the warning line and chips.
  async broadcast() {
    await click(web01);
    await key('Enter');
    await waitFor('Terminal', `document.querySelector('.xterm')`);
    await waitFor('verbundener web-01-Tab', `${web01Connected} === 1`);
    await click('button[aria-label^="Layout für Bereich"] >> nth=0');
    await waitFor('Layoutmenü', `document.querySelector('.pane-layout-menu')`);
    await menuButton('Nebeneinander teilen');
    await waitFor('zweiter Bereich', `document.querySelectorAll('.pane-chrome').length === 2`);
    // The split leaves the old pane empty; "Hier verbinden" focuses it, so the next sidebar Enter connects there.
    await waitFor('leerer Bereich', `!!document.querySelector('.empty-pane button')`);
    await click('.empty-pane button');
    await click(web01);
    await key('Enter');
    await waitFor('zwei verbundene web-01-Tabs', `${web01Connected} === 2`, { timeout: 30000 });
    await click('button[aria-label^="Layout für Bereich"] >> nth=0');
    await waitFor('Layoutmenü', `document.querySelector('.pane-layout-menu')`);
    await menuButton('Eingabe an alle Bereiche senden');
    await waitFor('An-alle-Kennzeichen in beiden Bereichen', `document.querySelectorAll('.broadcast-chip').length === 2`);
    await click('.terminal-panel:not([hidden]) .xterm >> nth=0');
    await call('type', 'uptime');
    await key('Enter');
    await waitFor('uptime in beiden Bereichen', `[...document.querySelectorAll('.terminal-panel:not([hidden]) .xterm-rows')].filter(rows => rows.textContent.includes('load average')).length === 2`, { timeout: 10000 });
    await pause(300);
    await shot('broadcast');
    await click('.broadcast-chip >> nth=0');
    await waitFor('Eingabe an alle beendet', `document.querySelectorAll('.broadcast-chip').length === 0`);
  },
  // Import menu for all four sources. Only OpenSSH is imported; the other dialogs are cancelled, so no registry or file beyond the fixtures is read.
  async import() {
    // Test hooks first: without them the PuTTY and WinSCP entries would read the real registry.
    await call('main', `const missing = ['SHELLHERD_PUTTY_REG_FILE', 'SHELLHERD_WINSCP_REG_FILE'].filter(name => !process.env[name]);
      if (missing.length) throw new Error('Import-Block abgebrochen, fehlt: ' + missing.join(', ') + ' (sonst läse der Block die echte Registry).');`);
    try {
      await removeImportFolder('OpenSSH-Import');
      await setOpenDialog(path.join(IMPORT_DIR, 'ssh_config'));
      await openImport('Aus OpenSSH', 'OpenSSH');
      await shot('import-openssh');
      await click('dialog.import-dialog[open] .form-actions .primary-button');
      await waitFor('Import abgeschlossen', `!document.querySelector('dialog.import-dialog[open]')`);
      await waitFor('Ergebnis-Meldung', `[...document.querySelectorAll('.toast-title')].some(t => t.textContent.includes('importiert'))`);
      await waitFor('Importordner im Baum', `[...document.querySelectorAll('.vault-tree-row')].some(r => r.textContent.includes('OpenSSH-Import'))`);
      await shot('import-result');
      await openImport('Aus PuTTY', 'PuTTY');
      await shot('import-putty');
      await cancelImport();
      await openImport('Aus WinSCP', 'WinSCP');
      await shot('import-winscp');
      await cancelImport();
      await setOpenDialog(path.join(IMPORT_DIR, 'confCons.xml'));
      await openImport('Aus mRemoteNG', 'mRemoteNG');
      await shot('import-mremoteng');
      await cancelImport();
    } finally {
      if (await evaluate(`!!document.querySelector('dialog.import-dialog[open]')`)) { await key('Escape'); await pause(300); }
      await setOpenDialog(VAULT_FILE);
      await removeImportFolder('OpenSSH-Import');
    }
  },
  // Update hint: the fake release route offers the next minor version while RUN_DIR/update-available exists. The check runs at most once a day,
  // so the settings lose checkedAt, latest and the skip from the last run first. A reload does not load the new bundle, so the vault is locked and unlocked
  // instead: unlocking asks for the update again.
  async update() {
    fs.writeFileSync(UPDATE_FLAG, '');
    try {
      if (fs.existsSync(SETTINGS_FILE)) {
        const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
        if (settings.update) { delete settings.update.checkedAt; delete settings.update.skipped; delete settings.update.latest; }
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
      }
      await click('.lock-button');
      await waitFor('Sperrbildschirm', `document.querySelector('dialog.lock-screen[open]')`);
      await fill('.lock-screen input[type=password]', 'synthetic-vault-demo');
      await click('.lock-screen .primary-button');
      await waitFor('Entsperren', `!document.querySelector('dialog.lock-screen[open]') && document.querySelector('.vault-shell').inert === false`, { timeout: 30000 });
      await waitFor('Update-Knopf', `!!document.querySelector('.update-button')`, { timeout: 30000 });
      await pause(300);
      await shot('update-hint', true);
      await click('.update-button');
      await waitFor('Update-Menü', `!!document.querySelector('.context-menu[role=menu]')`);
      await pause(300);
      await shot('update-menu', true);
      fs.rmSync(UPDATE_FLAG, { force: true });
      await menuItem('Diese Version überspringen');
      await waitFor('Update-Knopf verschwunden', `!document.querySelector('.update-button')`);
    } finally {
      fs.rmSync(UPDATE_FLAG, { force: true });
    }
  },
  // Start list "Zuletzt benutzt": three synthetic entries (one missing), then demo.term is picked and unlocked. Main reads the list on every call,
  // so settings.json is enough. The file dialog is cancelled for the switch, else it would answer with demo.term and skip the list.
  async recent() {
    if (readme) throw new Error('recent: Der Startbildschirm zeigt Pfade mit dem Benutzernamen – kein README-Bild (R-A8)');
    if (insideHome(RUN_DIR)) console.warn(`Warnung: RUN_DIR liegt im Benutzerordner (${RUN_DIR}). Die Liste zeigt dann den Windows-Benutzernamen; Screenshot nicht teilen.`);
    const vaults = path.join(RUN_DIR, 'vaults');
    const teamOps = path.join(vaults, 'team-ops.term');
    const archive = path.join(vaults, 'archiv-2025.term'); // deliberately absent: "Datei nicht gefunden"
    fs.mkdirSync(vaults, { recursive: true });
    if (!fs.existsSync(teamOps)) fs.writeFileSync(teamOps, '');
    fs.rmSync(archive, { force: true });
    const settings = fs.existsSync(SETTINGS_FILE) ? JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) : {};
    const now = Date.now();
    settings.recentVaults = [
      { filePath: teamOps, openedAt: now },
      { filePath: VAULT_FILE, openedAt: now - 86400000 },
      { filePath: archive, openedAt: now - 30 * 86400000 },
    ];
    fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    await click('.lock-button');
    await waitFor('Sperrbildschirm', `document.querySelector('dialog.lock-screen[open]')`);
    await click('.lock-screen .secondary-button');
    await waitFor('Wechsel-Rückfrage', `document.querySelector('dialog.compact-confirm[open]')`);
    await call('main', `electron.dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });`);
    try {
      await click('dialog.compact-confirm[open] .primary-button, dialog.compact-confirm[open] .danger-button');
      await waitFor('Liste „Zuletzt benutzt“', `${count('.recent-vault-open')} === 3`);
      await pause(300);
      await shot('start-recent');
      await click('.recent-vault-open:has-text("demo.term")');
      await waitFor('demo.term gewählt', `document.querySelector('.recent-vault-open[aria-pressed="true"]')?.textContent.includes('demo.term')`);
      await fill('input[type=password]', 'synthetic-vault-demo');
      await click('button.primary-button[type=submit]');
      await waitFor('Vault entsperrt', `!!document.querySelector('.workspace-save')?.offsetParent`, { timeout: 30000 });
    } finally {
      await setOpenDialog(VAULT_FILE);
    }
  },
  // Light scheme: setTheme sets nativeTheme.themeSource, and prefers-color-scheme must follow in the renderer (R-B3).
  // If it stays dark, Playwright emulates the scheme (V2): the block names the main value and fails, since light shots would show dark.
  async 'theme-light'() {
    const setTheme = setting => call('eval', `await window.desktopApi.setTheme('${setting}'); return true;`);
    try {
      await setTheme('light');
      try {
        await waitFor('prefers-color-scheme: light', `matchMedia('(prefers-color-scheme: light)').matches`, { timeout: 5000 });
      } catch {
        const source = await call('main', 'return electron.nativeTheme.themeSource;');
        throw new Error(source === 'light'
          ? 'prefers-color-scheme bleibt dunkel, obwohl nativeTheme hell ist (Playwright-Emulation, V2): Treiber per colorScheme lösen, nicht im Produkt'
          : `setTheme(light) setzt nativeTheme nicht auf hell (themeSource = ${source})`);
      }
      await click(web01);
      await key('Enter');
      await waitFor('Terminal', `document.querySelector('.xterm')`);
      await waitFor('verbundener web-01-Tab', `${web01Connected} === 1`);
      await click('.xterm-helper-textarea >> nth=0');
      await call('type', 'cat ~/LIESMICH');
      await key('Enter');
      await waitFor('Ausgabe im Terminal', `(document.querySelector('.terminal-panel:not([hidden]) .xterm-rows')?.textContent ?? '').includes('https://intranet.demo/handbuch')`);
      await pause(300);
      await shot('light-terminal');
      await click('text=files-01 >> nth=0');
      await key('Enter');
      await waitFor('SFTP-Liste', `${count('.file-pane-remote [role=row][data-name]')} >= 5`);
      // Local pane on the synthetic folder, as the sftp block does; without a safe folder the shot is skipped, never the real user folder.
      let local = null;
      try { local = localTarget(); } catch (error) { console.log(`light-sftp übersprungen: ${error.message}`); }
      if (local) {
        await evaluate(`document.querySelector('.file-pane-local nav[aria-label="Pfad"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
        await fill('.file-pane-local input[aria-label="Pfad"]', local.target);
        await key('Enter');
        await waitFor('lokale Spalte', `document.querySelector('.file-pane-local nav[aria-label="Pfad"]')?.textContent.includes(${JSON.stringify(local.segment)})`);
        await pause(300);
        await shot('light-sftp');
      }
      if (await evaluate(`document.body.innerText.includes('prod-k8s')`)) {
        await click('text=prod-k8s >> nth=0');
        await key('Enter');
        await waitFor('Kubernetes-Ansicht', `document.body.innerText.includes('bereit über web-01') && ${count('.kube-table tbody tr')} >= 5`);
        await pause(1500); // first metrics round
        await shot('light-kubernetes');
      } else console.log('Kubernetes übersprungen: prod-k8s fehlt im Baum.');
      await click('.settings-button');
      await waitFor('Einstellungsdialog', `document.querySelector('dialog.settings-dialog[open]')`);
      await call('eval', `document.querySelector('dialog.settings-dialog select[aria-label="Farbschema der Oberfläche"]')?.scrollIntoView({ block: 'center' });`);
      await pause(300);
      await shot('light-settings');
      await key('Escape');
      await waitFor('Einstellungen schließen', `!document.querySelector('dialog.settings-dialog[open]')`);
    } finally {
      await setTheme('dark');
    }
  },
  // Vault path release (no screenshot): UNC and foreign paths are refused, a dropped local path is returned normalized. Only 127.0.0.1 is ever named.
  async 'vault-path'() {
    const result = await evaluate(`(async () => {
      const msg = p => p.then(() => 'ok', e => String(e?.message ?? e));
      return [
        await msg(window.desktopApi.unlockVault({ filePath: '\\\\\\\\127.0.0.1\\\\nope\\\\x.term', password: 'x' })),
        await msg(window.desktopApi.unlockVault({ filePath: '//127.0.0.1/nope/x.term', password: 'x' })),
        await msg(window.desktopApi.unlockVault({ filePath: 'C:\\\\nope\\\\never-granted.term', password: 'x' })),
        await msg(window.desktopApi.dropVaultFile('\\\\\\\\127.0.0.1\\\\nope\\\\x.term')),
        await window.desktopApi.dropVaultFile('C:/nope/x.term'),
      ];
    })()`);
    if (!result.slice(0, 4).every(text => text.includes('vaultPathNotAllowed'))) throw new Error(`Freigabeliste greift nicht: ${JSON.stringify(result)}`);
    if (result[4] !== 'C:\\nope\\x.term') throw new Error(`Drop vom Laufwerk nicht freigegeben: ${result[4]}`);
  },
  // Server keys: the demo server is confirmed once, then the known_hosts fixture is imported (1 revoked, 3 skipped, a conflict on 127.0.0.1:2222).
  // Imported and revoked entries are removed before and after the import; confirmed ones stay.
  async 'host-keys'() {
    const cleanup = () => evaluate(`(async () => { for (const h of await window.desktopApi.knownHostsList()) if (h.origin !== 'confirmed') await window.desktopApi.knownHostsRemove(h.id); })()`);
    await cleanup();
    if (!await evaluate(`(async () => (await window.desktopApi.knownHostsList()).some(h => h.origin === 'confirmed'))()`)) {
      await click(web01);
      await key('Enter');
      await waitFor('Terminal', `document.querySelector('.xterm')`);
      await waitFor('verbundener web-01-Tab', connectedTab);
      await closeTabs();
    }
    await click('.settings-button');
    await waitFor('Einstellungsdialog', `document.querySelector('dialog.settings-dialog[open]')`);
    await click('dialog.settings-dialog button:has-text("Server-Schlüssel verwalten")');
    await waitFor('Server-Schlüssel-Dialog', `document.querySelector('dialog.known-hosts-dialog[open]') && ${count('.known-hosts-list li')} >= 1`);
    await pause(300);
    await shot('host-keys');
    const status = () => evaluate(`document.querySelector('.known-hosts-dialog [role=status]')?.textContent ?? ''`);
    await setOpenDialog(path.join(IMPORT_DIR, 'known_hosts'));
    try {
      await click('dialog.known-hosts-dialog button:has-text("Aus known_hosts importieren")');
      await waitFor('Import-Ergebnis', `(document.querySelector('.known-hosts-dialog [role=status]')?.textContent ?? '').includes('übersprungen')`);
      // Either the demo server is confirmed (conflict on 127.0.0.1:2222) or it is not (5 new); the revoked and skipped counts are the same.
      const message = await status();
      const confirmedCase = message.includes('4 neu') && message.includes('1 schon bekannt') && message.includes('127.0.0.1:2222');
      if (!(message.includes('1 widerrufen') && message.includes('3 übersprungen') && (confirmedCase || message.includes('5 neu')))) throw new Error(`Import-Zahlen weichen ab: ${message}`);
      // Layout guard (I-1): only the list scrolls, and the close button stays inside the viewport.
      const layout = await evaluate(`(() => {
        const list = document.querySelector('.known-hosts-list');
        const close = document.querySelector('dialog.known-hosts-dialog > .form-actions .primary-button');
        return { overflowY: list ? getComputedStyle(list).overflowY : 'none', closeInView: !!close && close.getBoundingClientRect().bottom <= innerHeight };
      })()`);
      if (layout.overflowY !== 'auto' || !layout.closeInView) throw new Error(`Server-Schlüssel-Dialog scrollt falsch: ${JSON.stringify(layout)}`);
      await pause(300);
      await shot('host-keys-import');
      await fill('dialog.known-hosts-dialog .known-hosts-tools input', 'build');
      await waitFor('Suche nach build', `${count('.known-hosts-list li')} === 1`);
      await pause(300);
      await shot('host-keys-search');
      await fill('dialog.known-hosts-dialog .known-hosts-tools input', '');
      await waitFor('Liste ohne Suche', `${count('.known-hosts-list li')} > 1`);
      const names = await evaluate(`document.querySelector('.known-hosts-list')?.textContent ?? ''`);
      if (!names.includes('Gehashter Hostname') || !names.includes('Alle Hosts')) throw new Error(`Gehashter Hostname oder Alle Hosts fehlt in der Liste: ${names}`);
    } finally {
      await setOpenDialog(VAULT_FILE);
      await cleanup();
    }
    // Closing the server key dialog returns to the settings, focus on its button (the settings dialog remounts).
    await click('dialog.known-hosts-dialog > .form-actions .primary-button');
    await waitFor('zurück in den Einstellungen', `document.querySelector('dialog.settings-dialog[open]') && !document.querySelector('dialog.known-hosts-dialog[open]') && document.activeElement?.textContent === 'Server-Schlüssel verwalten'`);
    await key('Escape');
    await waitFor('Einstellungen schließen', `!document.querySelector('dialog.settings-dialog[open]')`);
  },
  // Windows Hello with the run-app fake: unavailable hint, enable, lock screen, cancel, unlock, stale key, open screen.
  // The fake (driver.mjs) replaces the helper, so no real Hello prompt appears. finally: fake back to ok, Hello off for the demo vault.
  async hello() {
    if (insideHome(RUN_DIR)) console.warn(`Warnung: RUN_DIR liegt im Benutzerordner (${RUN_DIR}). hello-open.png zeigt dann den Windows-Benutzernamen; Screenshot nicht teilen.`);
    const fake = mode => call('main', `process.env.SHELLHERD_HELLO_FAKE = ${JSON.stringify(mode)}; return true`);
    if (await call('main', 'return process.env.SHELLHERD_HELLO_FAKE ?? null') === null) throw new Error('hello: SHELLHERD_HELLO_FAKE fehlt – Treiber neu starten');
    const lockOpen = `!!document.querySelector('dialog.lock-screen[open]')`;
    const helloButton = text => `[...document.querySelectorAll('button')].find(b => b.textContent.includes(${JSON.stringify(text)}))`;
    const lockButton = helloButton('Mit Windows Hello entsperren');
    const unlockWithPassword = async () => {
      await fill('.lock-screen input[type=password]', 'synthetic-vault-demo');
      await click('.lock-screen .primary-button');
      await waitFor('Entsperren mit Passwort', `!document.querySelector('dialog.lock-screen[open]')`, { timeout: 30000 });
    };
    try {
      await fake('ok');
      await evaluate(`window.desktopApi.helloDisable()`);   // clean start after an aborted run
      // 1. Without Windows Hello: hint only.
      await fake('unavailable');
      await click('.settings-button');
      await waitFor('Hinweis ohne Windows Hello', `document.querySelector('dialog.settings-dialog[open]')?.textContent.includes('Windows Hello ist auf diesem Gerät nicht eingerichtet')`);
      await key('Escape');
      await waitFor('Einstellungen geschlossen', `!document.querySelector('dialog.settings-dialog[open]')`);
      // 2. Enable in the settings.
      await fake('ok');
      await click('.settings-button');
      await click('dialog.settings-dialog label:has-text("Mit Windows Hello entsperren") input');
      await waitFor('Eingeschaltet', `document.querySelector('dialog.settings-dialog [role=status]')?.textContent.includes('Windows Hello ist für diesen Vault eingeschaltet')`);
      // Scroll to the section heading, so the shot shows "Vault" and the settings above the checkbox.
      await call('eval', `const heading = [...document.querySelectorAll('dialog.settings-dialog .settings-section')].find(s => s.querySelector('h3')?.textContent.trim() === 'Vault')?.querySelector('h3');
  if (!heading) throw new Error('Abschnitt „Vault“ fehlt'); heading.scrollIntoView({ block: 'start' });`);
      await pause(300);
      await shot('hello-setting');
      await key('Escape');
      await waitFor('Einstellungen geschlossen', `!document.querySelector('dialog.settings-dialog[open]')`);
      // 3. Lock screen: the button takes the focus; a cancel stays silent.
      await click('.lock-button');
      await waitFor('Hello-Knopf', `${lockOpen} && !!${lockButton} && document.activeElement === ${lockButton}`);
      await pause(300);
      await shot('hello-lock');
      await fake('cancel');
      await evaluate(`${lockButton}.click()`);
      await waitFor('Abbruch verarbeitet', `!!${lockButton} && !${lockButton}.hasAttribute('aria-disabled')`);
      if (!await evaluate(`${lockOpen} && !document.querySelector('.lock-screen .error-message') && document.activeElement === ${lockButton}`)) throw new Error('Abbruch zeigt einen Fehler, entsperrt oder verliert den Fokus');
      // 4. Unlock with Windows Hello.
      await fake('ok');
      await evaluate(`${lockButton}.click()`);
      await waitFor('Mit Windows Hello entsperrt', `!${lockOpen}`, { timeout: 30000 });
      // 5. Re-created Hello key: message, button gone, password still works.
      await fake('reset');
      await click('.lock-button');
      await waitFor('Hello-Knopf', `${lockOpen} && !!${lockButton}`);
      await evaluate(`${lockButton}.click()`);
      await waitFor('Meldung', `document.querySelector('.lock-screen .error-message')?.textContent.includes('passt nicht mehr')`);
      await waitFor('Hello-Knopf weg', `!${lockButton}`);
      await pause(300);
      await shot('hello-stale');
      await fake('ok');
      await unlockWithPassword();
      // 5b. Switched off in the settings and locked again: no stale button, the password field keeps the focus.
      await evaluate(`window.desktopApi.helloDisable()`);
      await click('.lock-button');
      await waitFor('Sperrbildschirm ohne Hello', lockOpen);
      await pause(500);   // a stale button would vanish after the fresh status arrives (~200 ms)
      if (await evaluate(`!${lockButton} && document.activeElement === document.querySelector('.lock-screen input[type=password]')`) !== true) throw new Error('Ohne Hello verliert das Passwortfeld den Fokus oder zeigt einen veralteten Knopf');
      await unlockWithPassword();
      // 6. Open screen: "Andere Vault-Datei" → the file dialog returns the demo vault → "Mit Windows Hello öffnen".
      await evaluate(`window.desktopApi.helloEnable()`);
      await click('.lock-button');
      await waitFor('Sperrbildschirm', lockOpen);
      await click('.lock-screen .form-actions .secondary-button');
      await click('button:has-text("Trennen und wechseln")');
      await waitFor('Öffnen mit Hello', `!!${helloButton('Mit Windows Hello öffnen')}`);
      await pause(300);
      await shot('hello-open');
      await evaluate(`${helloButton('Mit Windows Hello öffnen')}.click()`);
      await waitFor('Vault offen', `!!document.querySelector('.lock-button')`, { timeout: 30000 });
    } finally {
      await fake('ok');
      if (await evaluate(lockOpen)) await unlockWithPassword();
      await evaluate(`window.desktopApi.helloDisable().catch(() => {})`);
    }
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
