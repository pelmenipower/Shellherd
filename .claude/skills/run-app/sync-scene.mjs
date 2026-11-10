// Sync-lab scene: drives two running app instances (A = first device with the demo vault, B = second device without a vault)
// against a sync server that this script starts itself (temp directory, port 0, synthetic account) and stops at the end.
// Flow (H4, K17): A enrolls with the server password and syncs (recovery code noted); A invites, B enrolls with the enrollment
// code and loads the vault without a code field; a third synthetic device (written with AccountStore) raises the "new device"
// notice at A, which A acknowledges; A renews the sync key (new code); B reports "rotated" and adopts the key with the new
// code; A removes B and B's next session is refused. No code may stay in the DOM or in either console.
// Usage: node .claude/skills/run-app/sync-scene.mjs
// Needs (see SKILL.md, "Sync-Szene"): two drivers started with SHELLHERD_SYNC_LAB=1 (A on 9333, B on 9336 with its own
// SHELLHERD_RUN_DIR, no demo vault there: the import writes <B run dir>/profile/demo.term and never overwrites), and the
// demo vault unlocked in A (`demo-setup.mjs`). No `drive:sshd` and no non-loopback interface are needed.
// Env: A_RUN_DIR/A_PORT (default <tmp>/shellherd-run, 9333), B_RUN_DIR/B_PORT (default <tmp>/shellherd-run-b, 9336).
// Synthetic data only; no real vault or profile is touched. Linux only (the server insists on a 0700 data directory).
// Exit codes: 0 ok, 1 step failed, 2 driver unreachable, sync lab not enabled or out/ built without lab code (release build), 4 B already has a vault file.
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAccount } from '../../../scripts/sync-prototype/account-auth.mjs';
import { createSyncServer } from '../../../scripts/sync-prototype/server.mjs';
import { AccountStore } from '../../../scripts/sync-prototype/account-transport.mjs';
import { createDeviceIdentity } from '../../../scripts/sync-prototype/device-proof.mjs';
import { probeSyncServer } from '../../../scripts/sync-prototype/http-common.mjs';

const USER = 'demo';
const PASSWORD = 'synthetic-sync-scene-demo';
const NEW_VAULT_PASSWORD = 'synthetic-new-vault-pass';
const RUN = Date.now().toString(36).slice(-5);
const NAME_A = `Gerät A ${RUN}`;
const NAME_B = `Gerät B ${RUN}`;
const NAME_C = `Gerät C ${RUN}`;
const REPO = path.resolve(import.meta.dirname, '../../..');
// Expected UI texts come from the German catalog, so the scene follows text changes instead of duplicating literals.
const de = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../../../src/shared/locales/de-DE/syncLab.json'), 'utf8'));
const TEXT = {
  entry: de.entry, syncNow: de.syncNow, noted: de.recoveryCodeNoted, synced: de.synced, revoke: de.revokeDevice, revoked: de.deviceRevoked, openSession: de.openSession,
  authentication: de.errors.authentication, temporary: de.identityTemporary.split(':')[0], activeVault: de.activeVault.split(':')[0], close: 'Schließen',
  recoveryTitle: de.recoveryCodeTitle, inviteTitle: de.inviteCodeTitle, inviteDevice: de.inviteDevice, inviteDone: de.inviteCodeDone, withInvite: de.enrollWithInvite,
  importWithInvite: de.importWithInviteHint, rotateKey: de.rotateKey, rotateYes: de.rotateKeyYes, rotated: de.errors.syncRotated, acknowledge: de.acknowledgeDevice, advised: de.rotationAdvised,
};

class Fail extends Error { constructor(message, code = 1) { super(message); this.code = code; } }

function instance(label, runDirKey, portKey, runDirDefault, portDefault) {
  const runDir = process.env[runDirKey] ?? path.join(os.tmpdir(), runDirDefault);
  const port = Number(process.env[portKey] ?? portDefault);
  async function call(route, body, query = '') {
    let token;
    try { token = fs.readFileSync(path.join(runDir, 'token'), 'utf8'); }
    catch { throw new Fail(`${label}: Token fehlt in ${runDir} (Treiber nicht gestartet?)`, 2); }
    let response;
    try { response = await fetch(`http://127.0.0.1:${port}/${route}${query}`, { method: body === undefined ? 'GET' : 'POST', body, headers: { 'x-driver-token': token } }); }
    catch { throw new Fail(`${label}: Treiber auf Port ${port} nicht erreichbar`, 2); }
    const reply = await response.text();
    if (!response.ok) throw new Fail(`${label} /${route}: ${reply}`);
    return JSON.parse(reply);
  }
  return {
    label, runDir, port, call,
    click: selector => call('click', selector),
    fill: (selector, value) => call('fill', `${selector}\n${value}`),
    evaluate: expression => call('eval', `return (${expression})`),
    shot: name => call('ss', undefined, `?name=${name}`),
    // Clicks the first button of the open sync dialog whose text starts with the given label (the label is a catalog text).
    clickButton: label_ => call('eval', `const button = [...document.querySelectorAll('${DIALOG} button')].find(b => b.textContent.trim().startsWith(${JSON.stringify(label_)}) && !b.disabled); if (!button) throw new Error('Knopf fehlt oder gesperrt: ' + ${JSON.stringify(label_)}); button.click();`),
    async waitFor(step, expression, timeout = 20000, failOnAlert = false) {
      for (const end = Date.now() + timeout; ; await pause(250)) {
        if (await call('eval', `return !!(${expression})`)) return;
        // A dialog error ends the wait at once, with the app's own text instead of a bare timeout.
        if (failOnAlert) { const alert = await call('eval', `return document.querySelector('dialog.sync-lab-dialog .field-error[role=alert]')?.textContent?.trim() ?? ''`); if (alert) throw new Fail(`${label}: ${step}: Fehlermeldung im Dialog: ${alert}`); }
        if (Date.now() >= end) throw new Fail(`${label}: ${step} (Timeout nach ${timeout / 1000} s)`);
      }
    }
  };
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const DIALOG = 'dialog.sync-lab-dialog';
const A = instance('A', 'A_RUN_DIR', 'A_PORT', 'shellherd-run', 9333);
const B = instance('B', 'B_RUN_DIR', 'B_PORT', 'shellherd-run-b', 9336);
const log = message => console.log(message);
const has = selector => `!!document.querySelector(${JSON.stringify(selector)})`;
const dialogText = `(document.querySelector('${DIALOG}')?.textContent ?? '')`;
const shots = [];

// Waits until the sync button is enabled (no request running), then a moment longer so a vault save right after unlock can finish.
async function settle(side) {
  await side.waitFor('Abgleich-Knopf bereit', `[...document.querySelectorAll('${DIALOG} button')].some(b => b.textContent.trim().startsWith(${JSON.stringify(TEXT.syncNow)}) && !b.disabled)`, 20000, true);
  await pause(1000);
}

// Opens the sync dialog from the settings dialog (header button with a vault, footer link on the welcome screen).
async function openDialog(side) {
  await side.waitFor('Einstellungen-Zugang', `${has('.settings-button')} || ${has('footer button.link-button')}`);
  await side.call('eval', `(document.querySelector('.settings-button') ?? document.querySelector('footer button.link-button')).click()`);
  await side.waitFor('Selfhosted-Sync-Eintrag', `[...document.querySelectorAll('dialog.settings-dialog button')].some(b => b.textContent.includes(${JSON.stringify(TEXT.entry)}))`);
  await side.call('eval', `[...document.querySelectorAll('dialog.settings-dialog button')].find(b => b.textContent.includes(${JSON.stringify(TEXT.entry)})).click()`);
  await side.waitFor('Sync-Dialog', has(`${DIALOG}[open]`));
}

async function connect(side, url) {
  await side.fill(`${DIALOG} input[type=url]`, url);
  await side.click(`${DIALOG} form button[type=submit]`);
  // The URL form disappears once the server is probed; then either the enrollment form or "Sitzung öffnen" shows.
  await side.waitFor('Server verbunden (Einschreibeformular oder „Sitzung öffnen“)', `!${has(`${DIALOG} input[type=url]`)} && (${has(`${DIALOG} input[type=password]`)} || ${has(`${DIALOG} section.sync-server-form button.primary-button`)})`);
}

// Fills the enrollment form (password once, per device) and waits for the signed-in view.
async function enroll(side, name, { shot } = {}) {
  await side.waitFor('Einschreibeformular', has(`${DIALOG} input[type=password]`));
  await side.fill(`${DIALOG} input[autocomplete=username]`, USER);
  await side.fill(`${DIALOG} input[type=password]`, PASSWORD);
  await side.fill(`${DIALOG} input[id$="-device-name"]`, name);
  if (!(await side.evaluate(dialogText)).includes(TEXT.temporary)) throw new Fail(`${side.label}: der Hinweis „${TEXT.temporary}“ fehlt vor der Einschreibung`);
  if (shot) shots.push(await side.shot(shot));
  await side.click(`${DIALOG} form button[type=submit]`);
  await side.waitFor('angemeldet (Bereich „Am Sync-Server angemeldet“)', has(`${DIALOG} .sync-server-ready`));
  if (await side.evaluate(has(`${DIALOG} input[type=password]:not([id$="-new-password"]):not([id$="-repeat-password"])`))) throw new Fail(`${side.label}: das Serverpasswort-Feld steht nach der Einschreibung noch im DOM`);
  log(`${side.label}: eingeschrieben als „${name}“`);
}

const hexOnly = value => value.replace(/[^0-9a-f]/gi, '').toLowerCase();

// out/ from `npm run dist*` (SHELLHERD_RELEASE=1) has no lab chunk; the scene would only time out (K18).
function requireLabBuild() {
  const dir = path.join(REPO, 'out/main');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).filter(file => String(file).endsWith('.js')) : [];
  if (!files.some(file => fs.readFileSync(path.join(dir, String(file)), 'utf8').includes('SyncLabHost'))) throw new Fail('out/ ohne Lab-Code (Release-Build). Neu bauen: npx electron-vite build', 2);
}

// A one-time code shown in a notice section (found by its title) is read as typed text, 32 hex digits in groups of four.
async function readCode(side, title) {
  const selector = `${DIALOG} section[aria-label=${JSON.stringify(title)}] .sync-lab-code`;
  await side.waitFor(`Code „${title}“ bei ${side.label}`, has(selector), 20000, true);
  const shown = (await side.evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent`)).trim();
  if (hexOnly(shown).length !== 32 || !/^([0-9a-f]{4}-){7}[0-9a-f]{4}$/i.test(shown)) throw new Fail(`${side.label}: Anzeige des Codes „${title}“ hat nicht die Form xxxx-…-xxxx (${shown.length} Zeichen)`);
  return shown;
}

// The code must not sit anywhere in the DOM (markup or text) once the notice is dismissed.
async function requireNoCode(side, shown, what) {
  const leak = await side.evaluate(`(() => { const html = document.documentElement.outerHTML.toLowerCase(); const text = document.body.textContent.toLowerCase().replace(/[^0-9a-f]/g, ''); return html.includes(${JSON.stringify(hexOnly(shown))}) || html.includes(${JSON.stringify(shown.toLowerCase())}) || text.includes(${JSON.stringify(hexOnly(shown))}); })()`);
  if (leak) throw new Fail(`${side.label}: ${what} steht nach dem Bestätigen noch im DOM`);
}

async function run(url) {
  requireLabBuild();
  if (!await A.evaluate('window.desktopApi.syncLabEnabled')) throw new Fail('A: SHELLHERD_SYNC_LAB=1 fehlt im Treiber (syncLabEnabled ist false)', 2);
  if (!await B.evaluate('window.desktopApi.syncLabEnabled')) throw new Fail('B: SHELLHERD_SYNC_LAB=1 fehlt im Treiber (syncLabEnabled ist false)', 2);
  if (fs.existsSync(path.join(B.runDir, 'profile', 'demo.term'))) throw new Fail(`B: ${path.join(B.runDir, 'profile', 'demo.term')} existiert schon. Der Import überschreibt nichts; B mit leerem SHELLHERD_RUN_DIR neu starten.`, 4);

  // The sync state of a previous run belongs to that run's server (other serverId); the demo vault itself stays.
  for (const name of ['demo.term.sync-state', 'demo.term.sync-state.lock']) fs.rmSync(path.join(A.runDir, 'profile', name), { force: true });

  // 1. A: enroll with the server password; the first sync of an empty account creates the recovery code.
  await openDialog(A);
  await connect(A, url);
  await enroll(A, NAME_A, { shot: 'sync-enroll' });
  await A.waitFor('Vault-Name bei A (offener Vault)', `${dialogText}.includes(${JSON.stringify(TEXT.activeVault)})`);
  await settle(A);
  await A.clickButton(TEXT.syncNow);
  const recovery1 = await readCode(A, TEXT.recoveryTitle);
  shots.push(await A.shot('sync-code'));
  log('A: Wiederherstellungscode gelesen (32 Zeichen, Vierergruppen)');
  await A.clickButton(TEXT.noted);
  await A.waitFor('Code nach „notiert“ aus dem DOM', `!${has(`${DIALOG} .sync-lab-code`)}`);
  await requireNoCode(A, recovery1, 'der Wiederherstellungscode');
  // A fresh demo vault is rewritten by its first sync: the vault change is held back until the code is noted, then the
  // dialog closes. Reopen it and continue with the remembered enrollment.
  await A.waitFor('Synchronisiert-Meldung oder geschlossener Dialog bei A', `${dialogText}.includes(${JSON.stringify(TEXT.synced)}) || !${has(`${DIALOG}[open]`)}`, 20000, true);
  if (!await A.evaluate(has(`${DIALOG}[open]`))) {
    await openDialog(A);
    await connect(A, url);
    await A.waitFor('„Sitzung öffnen“ bei A (Einschreibung gemerkt)', `[...document.querySelectorAll('${DIALOG} button')].some(b => b.textContent.trim() === ${JSON.stringify(TEXT.openSession)})`);
    await A.clickButton(TEXT.openSession);
    await A.waitFor('Vault-Name bei A (offener Vault)', `${dialogText}.includes(${JSON.stringify(TEXT.activeVault)})`, 20000, true);
    log('A: Vault nach dem ersten Abgleich neu geladen, Dialog nach „notiert“ geschlossen und wieder geöffnet');
  }
  log('A: synchronisiert, Code nach „notiert“ nirgends mehr im DOM');

  // 2. A: invite a new device; the enrollment code is read once, then dismissed.
  await settle(A);
  await A.clickButton(TEXT.inviteDevice);
  const invite = await readCode(A, TEXT.inviteTitle);
  shots.push(await A.shot('sync-invite'));
  await A.clickButton(TEXT.inviteDone);
  await A.waitFor('Anmeldecode nach „übertragen“ aus dem DOM', `!${has(`${DIALOG} .sync-lab-code`)}`);
  await requireNoCode(A, invite, 'der Anmeldecode');
  log('A: Anmeldecode erzeugt und gelesen, nach „übertragen“ nirgends mehr im DOM');

  // 3. B: enroll with the code, no server password; the vault loads with a new local password and without a code field.
  await openDialog(B);
  await connect(B, url);
  await B.clickButton(TEXT.withInvite);
  await B.waitFor('Anmeldecode-Feld bei B', has(`${DIALOG} input[id$="-enroll-code"]`));
  await B.fill(`${DIALOG} input[id$="-enroll-code"]`, invite);
  await B.fill(`${DIALOG} input[id$="-invite-device-name"]`, NAME_B);
  if (await B.evaluate(has(`${DIALOG} input[type=password]`))) throw new Fail('B: im Anmeldecode-Formular steht ein Passwortfeld');
  await B.click(`${DIALOG} form button[type=submit]`);
  await B.waitFor('B angemeldet (Bereich „Am Sync-Server angemeldet“)', has(`${DIALOG} .sync-server-ready`), 20000, true);
  await requireNoCode(B, invite, 'der Anmeldecode');
  await B.waitFor('Hinweis „mit Anmeldecode angemeldet“ bei B', `${dialogText}.includes(${JSON.stringify(TEXT.importWithInvite)})`);
  if (await B.evaluate(has(`${DIALOG} input[id$="-code"]`))) throw new Fail('B: der Import fragt trotz Anmeldecode nach einem Wiederherstellungscode');
  await B.fill(`${DIALOG} input[id$="-new-password"]`, NEW_VAULT_PASSWORD);
  await B.fill(`${DIALOG} input[id$="-repeat-password"]`, NEW_VAULT_PASSWORD);
  await B.click(`${DIALOG} form button[type=submit]`);
  await B.waitFor('Vault bei B offen (Dialog zu, Verbindungsliste)', `!${has(`${DIALOG}[open]`)} && ${has('.settings-button')} && [...document.querySelectorAll('.vault-tree-row')].some(row => row.textContent.includes('web-01'))`, 60000, true);
  if (!fs.existsSync(path.join(B.runDir, 'profile', 'demo.term'))) throw new Fail('B: die Vault-Datei wurde nicht im Profil von B angelegt');
  log('B: mit Anmeldecode angemeldet, Vault ohne Code-Feld geladen, Verbindungsliste sichtbar');

  // 4. A: a third device enrolls with the server password behind A's back; A's next sync shows the "new device" notice.
  const info = await probeSyncServer(url, { allowLoopbackHttp: true });
  const third = new AccountStore(info);
  try { await third.enroll(createDeviceIdentity(), { username: USER, password: PASSWORD, name: NAME_C, ephemeral: true }); } finally { third.close(); }
  await settle(A);
  await A.clickButton(TEXT.syncNow);
  const notices = `[...document.querySelectorAll('${DIALOG} .sync-lab-confirm[role=alert]')]`;
  await A.waitFor(`Hinweis „Neues Gerät“ für ${NAME_C} bei A`, `${notices}.some(n => n.textContent.includes(${JSON.stringify(NAME_C)}))`, 20000, true);
  if (await A.evaluate(`${notices}.some(n => n.textContent.includes(${JSON.stringify(NAME_B)}))`)) throw new Fail(`A: ${NAME_B} wurde von A eingeladen, meldet aber „Neues Gerät“`);
  await A.waitFor('Geräteliste mit drei Geräten bei A', `document.querySelectorAll('${DIALOG} .sync-device-access li').length === 3`, 20000, true);
  shots.push(await A.shot('sync-new-device'));
  await A.clickButton(TEXT.acknowledge);
  await A.waitFor('Hinweis nach „Zur Kenntnis genommen“ weg', `${notices}.length === 0`);
  log(`A: „Neues Gerät“ (${NAME_C}) gemeldet und bestätigt, eigene Einladung (${NAME_B}) ohne Hinweis`);

  // 5. A: renew the sync key (needs a clean, fully synced state); the new recovery code is read once.
  await settle(A);
  await A.clickButton(TEXT.rotateKey);
  await A.clickButton(TEXT.rotateYes);
  const recovery2 = await readCode(A, TEXT.recoveryTitle);
  if (hexOnly(recovery2) === hexOnly(recovery1)) throw new Fail('A: der neue Wiederherstellungscode gleicht dem alten');
  shots.push(await A.shot('sync-rotate'));
  await A.clickButton(TEXT.noted);
  await A.waitFor('neuer Code nach „notiert“ aus dem DOM', `!${has(`${DIALOG} .sync-lab-code`)}`);
  await requireNoCode(A, recovery2, 'der neue Wiederherstellungscode');
  log('A: Sync-Schlüssel erneuert, neuer Wiederherstellungscode gelesen und bestätigt');

  // 6. B: the next sync reports the new epoch; the new code opens it (the old code would not).
  await openDialog(B);
  await connect(B, url);
  await B.waitFor('„Sitzung öffnen“ bei B (Einschreibung gemerkt)', `[...document.querySelectorAll('${DIALOG} button')].some(b => b.textContent.trim() === ${JSON.stringify(TEXT.openSession)})`);
  await B.clickButton(TEXT.openSession);
  await B.waitFor('Vault-Name bei B (offener Vault)', `${dialogText}.includes(${JSON.stringify(TEXT.activeVault)})`, 20000, true);
  await settle(B);
  await B.clickButton(TEXT.syncNow);
  await B.waitFor('Meldung „Sync-Schlüssel erneuert“ bei B', `document.querySelector('${DIALOG} .field-error[role=alert]')?.textContent.includes(${JSON.stringify(TEXT.rotated)})`);
  await B.waitFor('Code-Feld bei B', has(`${DIALOG} input[id$="-code"]`));
  await B.fill(`${DIALOG} input[id$="-code"]`, recovery2);
  await B.clickButton(TEXT.syncNow);
  await B.waitFor('Synchronisiert-Meldung bei B (neue Epoche übernommen)', `${dialogText}.includes(${JSON.stringify(TEXT.synced)})`, 30000, true);
  await requireNoCode(B, recovery2, 'der neue Wiederherstellungscode');
  log('B: „Sync-Schlüssel erneuert“ gemeldet, mit dem neuen Code synchronisiert');

  // 7. A: remove B (a removal advises renewing the key); B's next session is refused.
  await A.clickButton(TEXT.syncNow);
  await A.waitFor('Geräteliste mit drei Geräten bei A', `document.querySelectorAll('${DIALOG} .sync-device-access li').length === 3`, 20000, true);
  const rowB = `[...document.querySelectorAll('${DIALOG} .sync-device-access li')].find(li => li.querySelector('strong')?.textContent === ${JSON.stringify(NAME_B)})`;
  if (!await A.evaluate(`!!${rowB}`)) throw new Fail(`A: ${NAME_B} fehlt in der Geräteliste`);
  shots.push(await A.shot('sync-devices'));
  await A.call('eval', `${rowB}.querySelector('button').click()`);
  // A temporary device leaves the roster on removal (persistent ones stay marked as removed).
  await A.waitFor('B entfernt (temporär: aus der Liste, sonst markiert)', `!${rowB} || ${rowB}.textContent.includes(${JSON.stringify(TEXT.revoked)})`);
  await A.waitFor('Hinweis „Sync-Schlüssel erneuern“ nach dem Entfernen', `${dialogText}.includes(${JSON.stringify(TEXT.advised)})`);
  log('A: B entfernt, Erneuern des Schlüssels empfohlen');
  await B.clickButton(TEXT.close);
  await B.waitFor('Dialog bei B geschlossen', `!${has(`${DIALOG}[open]`)}`);
  await openDialog(B);
  await connect(B, url);
  await B.waitFor('„Sitzung öffnen“ bei B (Einschreibung gemerkt)', `[...document.querySelectorAll('${DIALOG} button')].some(b => b.textContent.trim() === ${JSON.stringify(TEXT.openSession)})`);
  await B.clickButton(TEXT.openSession);
  await B.waitFor('Fehler „authentication“ bei B', `document.querySelector('${DIALOG} .field-error[role=alert]')?.textContent.includes(${JSON.stringify(TEXT.authentication)})`);
  log('B: nächste Sitzung abgelehnt (authentication)');

  // No CSP violation and none of the three codes in either console since the start.
  for (const side of [A, B]) {
    const messages = await side.call('console');
    const violation = messages.find(message => message.text.includes('Content Security Policy'));
    if (violation) throw new Fail(`${side.label}: CSP-Meldung in der Konsole: ${violation.text}`);
    for (const secret of [recovery1, invite, recovery2]) if (messages.some(message => hexOnly(message.text).includes(hexOnly(secret)))) throw new Fail(`${side.label}: ein Code steht in der Konsole`);
  }
  log('A und B: keine CSP-Meldung, kein Code in der Konsole');
}

// Closes an open sync dialog so a repeated run starts from a clean window; failures here do not matter.
async function cleanup() {
  for (const side of [A, B]) {
    try { await side.call('eval', `[...document.querySelectorAll('${DIALOG} button')].find(b => b.textContent.trim() === ${JSON.stringify(TEXT.close)})?.click()`); } catch { /* driver gone */ }
  }
}

// The server: fresh temp directory (0700), port 0, own namespace, synthetic account only.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shellherd-sync-scene-'));
let service;
let code = 0;
try {
  service = await createSyncServer({ directory: path.join(directory, 'server'), serverId: randomBytes(32).toString('hex'), namespace: 'sync-scene', account: await createAccount(USER, PASSWORD) });
  await run(await service.listen(0));
  log(`OK. Screenshots:\n${shots.join('\n')}`);
} catch (error) {
  code = error instanceof Fail ? error.code : 1;
  console.error(`FEHLER: ${error.message}`);
  if (shots.length) console.error(`Screenshots bis dahin:\n${shots.join('\n')}`);
  if (code === 1) for (const side of [A, B]) { try { console.error(`${side.label} Fehlerbild: ${await side.shot(`sync-failed-${side.label.toLowerCase()}`)}`); } catch { /* driver gone */ } }
} finally {
  if (code !== 2 && code !== 4) await cleanup();
  await service?.close().catch(() => {});
  fs.rmSync(directory, { recursive: true, force: true });
}
process.exit(code);
