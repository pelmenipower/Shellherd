// Release hero and toolbar gallery. First run demo-setup.mjs and screens.mjs --readme.
// A temporary loopback SSH fake supplies fixed demo CPU/RAM readings. No real vaults.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { startSshd } from './sshd.mjs';
const work = process.env.SHELLHERD_RUN_DIR ?? path.join(os.tmpdir(), 'shellherd-run');
const repo = path.resolve(import.meta.dirname, '../../..');
const port = Number(process.env.DRIVER_PORT ?? 9333);
async function call(route, body, query = '') {
  const r = await fetch(`http://127.0.0.1:${port}/${route}${query}`, { method: body === undefined ? 'GET' : 'POST', body, headers: { 'x-driver-token': fs.readFileSync(path.join(work, 'token'), 'utf8') } });
  const text = await r.text(); if (!r.ok) throw new Error(text); return JSON.parse(text);
}
const evaluate = source => call('eval', source);
const click = selector => call('click', selector);
const key = k => call('key', undefined, `?k=${encodeURIComponent(k)}`);
async function wait(expression) {
  for (const end = Date.now() + 25000; Date.now() < end;) {
    if (await evaluate(`return !!(${expression})`)) return;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('Timed out: ' + expression);
}
async function shot(name) {
  await new Promise(resolve => setTimeout(resolve, 500));
  const file = await call('ss', undefined, `?name=${name}&crop=status`);
  const target = path.join(repo, 'docs/images', `screenshot-${name}.png`);
  fs.copyFileSync(file, target); console.log(target);
}
const sshd = await startSshd({ port: 0, dir: work });
let original;
try {
  // Read only the known synthetic vault, then restore its configuration in finally.
  const result = await evaluate(`return await window.desktopApi.unlockVault({filePath:${JSON.stringify(path.join(work, 'profile/demo.term'))},password:'synthetic-vault-demo'})`);
  original = result.vault;
  const style = { icon: 'server', color: '#8b949e', text: '' };
  const base = { description: 'Synthetic release demo', enabled: true, showText: true, confirm: false, ...style, trigger: 'both', intervalMs: 10000, timeoutMs: 5000, mappings: [], unknown: style };
  const item = (kind, name, command, icon, color, text = '') => ({ ...base, id: randomUUID(), kind, name, command, icon, color, text });
  const toolbar = { mode: 'type', items: [
    item('command', 'Uptime', 'uptime', 'server', '#79c0ff'),
    item('command', 'Disk', 'df -h /', 'database', '#d2a8ff'),
    item('command', 'Nginx', 'systemctl status nginx --no-pager | head -3', 'tools', '#e3b341'),
    ...['CPU', 'RAM'].map(name => ({ ...item('status', name, `~/.local/share/shellherd/${name.toLowerCase()}.sh`, 'check', '#3fb950'), mappings: [{ value: 'ok', icon: 'check', color: '#3fb950', text: `${name} OK` }] })),
  ] };
  const vault = structuredClone(original);
  const updateNodes = nodes => nodes.map(node => node.type === 'folder' ? { ...node, children: updateNodes(node.children) } : ['web-01', 'ops-01'].includes(node.name) ? { ...node, port: sshd.port } : node);
  vault.nodes = updateNodes(vault.nodes); vault.toolbar = toolbar;
  vault.settings.autoLockMinutes = 0; vault.settings.confirmBeforeClosingSession = false;
  await evaluate(`await window.desktopApi.saveCurrentVault({vault:${JSON.stringify(vault)}})`);
  await click('button:text-is("Vault sperren")');
  await wait('document.querySelector("dialog.lock-screen[open]")');
  await call('fill', 'dialog.lock-screen input[type=password]\nsynthetic-vault-demo');
  await click('dialog.lock-screen .primary-button');
  await wait('!document.querySelector("dialog.lock-screen[open]")');
  // Close the tabs left by the component scenes.
  for (let i = 0; i < 20 && await evaluate('return !!document.querySelector(".terminal-tab-close")'); i++) await click('.terminal-tab-close');
  await evaluate('await window.desktopApi.setTheme("dark")');
  await click('.vault-tree-row >> text=web-01 >> nth=0'); await key('Enter');
  await wait('document.querySelector(".toolbar-items")?.textContent.includes("RAM OK")');
  await click('button[aria-label^="Layout für Bereich"] >> nth=0');
  await evaluate('const b=[...document.querySelectorAll(".pane-layout-menu button")].find(b=>b.textContent.trim()==="Nebeneinander teilen"); b.click()');
  await click('.empty-pane button');
  await click('.vault-tree-row >> text=ops-01 >> nth=0'); await key('Enter');
  await wait('document.querySelectorAll(".tab-status-connected").length >= 2');
  await click('.terminal-panel:not([hidden]) .xterm >> nth=0');
  await call('type', 'uptime'); await key('Enter');
  await call('type', 'df -h /'); await key('Enter');
  await wait('document.querySelector(".terminal-panel:not([hidden]) .xterm-rows")?.textContent.includes("Mounted on")');
  await shot('terminals');
  await evaluate('await window.desktopApi.setTheme("light")');
  await wait('matchMedia("(prefers-color-scheme: light)").matches');
  await shot('terminals-light');
  await evaluate('await window.desktopApi.setTheme("dark")');
  await wait('matchMedia("(prefers-color-scheme: dark)").matches');
  await call('rclick', '.toolbar-item[aria-label="CPU"] >> nth=0');
  await evaluate('const b=[...document.querySelectorAll("[role=menuitem]")].find(b=>b.textContent.trim().startsWith("Toolbar-Element bearbeiten")); b.click()');
  await wait('document.querySelector("dialog.toolbar-editor[open]")');
  await shot('toolbar');
  await key('Escape');
} finally {
  try {
    if (original) await evaluate(`await window.desktopApi.saveCurrentVault({vault:${JSON.stringify(original)}})`);
  } finally {
    await sshd.close();
  }
}
