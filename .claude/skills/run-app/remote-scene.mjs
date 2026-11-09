// Remote-view scene: drives two running app instances (A = shared device, B = viewer) against the rendezvous fake.
// Usage: node .claude/skills/run-app/remote-scene.mjs
// Needs (see SKILL.md, "Fernzugriff-Szene"): `npm run drive:sshd` (rendezvous fake on 8788), two drivers started with
// SHELLHERD_REMOTE_LAB=1 SHELLHERD_REMOTE_CAPTURE_FAKE=1 (A on 9333, B on 9336 with its own SHELLHERD_RUN_DIR), an unlocked
// demo vault in each (`demo-setup.mjs`), and a non-loopback network interface (WebRTC uses host candidates only).
// Env: A_RUN_DIR/A_PORT (default <tmp>/shellherd-run, 9333), B_RUN_DIR/B_PORT (default <tmp>/shellherd-run-b, 9336),
// REMOTE_SERVER_URL (default http://127.0.0.1:8788). Synthetic data only; no real vault or profile is touched.
// A repeated run needs fresh instances: the decline mutes B at A for 10 minutes and blocks the pair at the server for 30 s.
// Exit codes: 0 ok, 1 step failed, 2 driver unreachable, 3 no non-loopback interface.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SERVER_URL = process.env.REMOTE_SERVER_URL ?? 'http://127.0.0.1:8788';
const USER = 'demo';
const PASSWORD = 'synthetic-rendezvous-demo';
const NAME_A = 'Gerät A';
const NAME_B = 'Gerät B';
const ENDED_REMOTE = 'Das andere Gerät hat die Verbindung beendet.';
const ENDED_DECLINED = 'Das andere Gerät hat die Anfrage abgelehnt.';
// Colours of the fake capture pattern (src/renderer/src/remote-capture-fake.ts), quadrant centres at 25 % / 75 %.
const PATTERN = [
  { x: 0.25, y: 0.25, rgb: [230, 40, 40] },
  { x: 0.75, y: 0.25, rgb: [40, 190, 80] },
  { x: 0.25, y: 0.75, rgb: [40, 90, 230] },
  { x: 0.75, y: 0.75, rgb: [240, 200, 40] }
];
const TOLERANCE = 48;
const END_WITHIN_MS = 8000;

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
    const text = await response.text();
    if (!response.ok) throw new Fail(`${label} /${route}: ${text}`);
    return JSON.parse(text);
  }
  return {
    label, runDir, port, call,
    click: selector => call('click', selector),
    fill: (selector, value) => call('fill', `${selector}\n${value}`),
    key: name => call('key', undefined, `?k=${encodeURIComponent(name)}`),
    evaluate: expression => call('eval', `return (${expression})`),
    main: code => call('main', code),
    shot: name => call('ss', undefined, `?name=${name}`),
    async waitFor(step, expression, timeout = 20000) {
      for (const end = Date.now() + timeout; ; await pause(250)) {
        if (await call('eval', `return !!(${expression})`)) return;
        if (Date.now() >= end) throw new Fail(`${label}: ${step} (Timeout nach ${timeout / 1000} s)`);
      }
    }
  };
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const A = instance('A', 'A_RUN_DIR', 'A_PORT', 'shellherd-run', 9333);
const B = instance('B', 'B_RUN_DIR', 'B_PORT', 'shellherd-run-b', 9336);
const log = message => console.log(message);
const LAB = 'dialog.remote-lab-dialog';
const text = (instanceRef, selector) => instanceRef.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent?.trim() ?? ''`);
const has = selector => `!!document.querySelector(${JSON.stringify(selector)})`;
const shots = [];

function hasNonLoopbackInterface() {
  return Object.values(os.networkInterfaces()).flat().some(entry => entry && !entry.internal && !entry.address.startsWith('169.254.') && !entry.address.startsWith('fe80:'));
}

// Opens the lab dialog from the settings dialog and signs in, one instance at a time (the server rejects parallel logins).
async function signIn(side) {
  await side.waitFor('Einstellungen-Knopf', has('.settings-button'));
  await side.click('.settings-button');
  await side.waitFor('Fernzugriff-Eintrag', `[...document.querySelectorAll('dialog.settings-dialog button')].some(b => b.textContent.includes('Fernzugriff einrichten'))`);
  await side.call('eval', `[...document.querySelectorAll('dialog.settings-dialog button')].find(b => b.textContent.includes('Fernzugriff einrichten')).click()`);
  await side.waitFor('Fernzugriff-Dialog', has(`${LAB}[open]`));
  await side.fill(`${LAB} input[type=url]`, SERVER_URL);
  await side.click(`${LAB} form button[type=submit]`);
  await side.waitFor('Anmeldeformular', has(`${LAB} input[type=password]`));
  await side.fill(`${LAB} input[autocomplete=username]`, USER);
  await side.fill(`${LAB} input[type=password]`, PASSWORD);
  await side.click(`${LAB} form button[type=submit]`);
  await side.waitFor('Anmeldung (Gerätename-Feld)', has(`${LAB} .remote-lab-account form input`));
  log(`${side.label}: angemeldet`);
}

async function goOnline(side, name) {
  await side.fill(`${LAB} .remote-lab-account form input`, name);
  await side.click(`${LAB} .remote-lab-account form button[type=submit]`);
  await side.waitFor('online (Fingerabdruck sichtbar)', has(`${LAB} .remote-lab-account > code.remote-lab-fingerprint`));
  const fingerprint = await text(side, `${LAB} .remote-lab-account > code.remote-lab-fingerprint`);
  log(`${side.label}: online, Fingerabdruck ${fingerprint}`);
  return fingerprint;
}

// Closes the lab dialog and the settings dialog it returns to, so the consent dialog and the share bar are reachable.
async function closeDialogs(side) {
  await side.click(`${LAB} .remote-lab-heading button`);
  await side.waitFor('Fernzugriff-Dialog geschlossen', `!${has(`${LAB}[open]`)}`);
  if (await side.evaluate(has('dialog.settings-dialog[open]'))) {
    await side.key('Escape');
    await side.waitFor('Einstellungen geschlossen', `!${has('dialog.settings-dialog[open]')}`);
  }
}

// Draws the viewer video into a canvas and compares the four pattern points.
const PIXEL_CHECK = `(() => {
  const video = document.querySelector('${LAB} video');
  if (!video || !(video.readyState >= 2 && video.videoWidth > 0)) return null;
  const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  const context = canvas.getContext('2d'); context.drawImage(video, 0, 0);
  return ${JSON.stringify(PATTERN)}.map(point => ({ ...point, got: [...context.getImageData(Math.floor(point.x * canvas.width), Math.floor(point.y * canvas.height), 1, 1).data].slice(0, 3) }));
})()`;

const FIRST_12 = fingerprint => fingerprint.replace(/\s+/g, '').slice(0, 12);
const DEVICE_A = `li.remote-lab-device:has(strong:text-is(${JSON.stringify(NAME_A)}))`; // Playwright selector (driver routes)
const ROW_A_JS = `[...document.querySelectorAll('li.remote-lab-device')].find(li => li.querySelector('strong')?.textContent === ${JSON.stringify(NAME_A)})`; // same row for page.evaluate
const CONSENT = 'dialog.remote-consent-dialog';

// Replaces the dialog stub from driver.mjs with one that records the options (without the AbortSignal) and still answers with the last button.
async function recordNativeDialogs() {
  await A.main(`globalThis.__shellherdDialogs = [];
    electron.dialog.showMessageBox = async (first, second) => {
      const options = second ?? first;
      globalThis.__shellherdDialogs.push({ type: options.type, title: options.title, message: options.message, detail: options.detail, buttons: options.buttons });
      return { response: Math.max(0, (options.buttons?.length ?? 1) - 1), checkboxChecked: false };
    }; return true;`);
}

// B requests a view of A. With an unverified pin B types the first 12 characters of A's own display; with a verified pin there is no field.
async function request(fingerprintOfA, { verified }) {
  await B.waitFor('A in der Geräteliste', ROW_A_JS);
  const rowText = await B.evaluate(`${ROW_A_JS}.textContent`);
  // E6: only unverified peers must hide their fingerprint; verified pins may show it.
  if (!verified && rowText.replace(/\s+/g, '').includes(FIRST_12(fingerprintOfA))) throw new Fail('B: die Geräteliste zeigt den Fingerabdruck von A vor der Prüfung (E6)');
  if (verified) {
    if (!rowText.includes('Geprüft am')) throw new Fail('B: „Geprüft am“ fehlt bei A trotz bestätigtem Pin');
    if (await B.evaluate(`!!${ROW_A_JS}.querySelector('input.remote-lab-verify')`)) throw new Fail('B: Prüffeld bei A trotz bestätigtem Pin');
    log('B: A ist geprüft („Geprüft am“), kein Feld');
  } else {
    await B.fill(`${DEVICE_A} input.remote-lab-verify`, FIRST_12(fingerprintOfA));
    log('B: erste 12 Zeichen von A aus dessen Anzeige getippt');
  }
  await B.click(`${DEVICE_A} button.primary-button`);
  await A.waitFor('Zustimmungsdialog', has(`${CONSENT}[open]`));
}

// A confirms B in the renderer dialog: typed prefix for an unverified pin, no field for a verified one.
async function prepareConsent(fingerprintOfB, { verified }) {
  const dialogText = await A.evaluate(`document.querySelector('${CONSENT}').textContent`);
  if (!verified && dialogText.replace(/\s+/g, '').includes(FIRST_12(fingerprintOfB))) throw new Fail('A: der Renderer-Dialog zeigt den Fingerabdruck von B (E6)');
  if (verified) {
    if (!dialogText.includes('Geprüft am')) throw new Fail('A: „Geprüft am“ fehlt im Zustimmungsdialog trotz bestätigtem Pin');
    if (await A.evaluate(has(`${CONSENT} input.remote-lab-verify`))) throw new Fail('A: Prüffeld im Zustimmungsdialog trotz bestätigtem Pin');
    log('A: Zustimmung ohne Feld, B ist geprüft');
  } else {
    await A.fill(`${CONSENT} input.remote-lab-verify`, FIRST_12(fingerprintOfB));
    log('A: erste 12 Zeichen von B aus dessen Anzeige getippt');
  }
}

async function run() {
  if (!hasNonLoopbackInterface()) throw new Fail('Keine Netzwerkschnittstelle außer Loopback: WebRTC braucht Host-Kandidaten (LAN-IP), sonst endet die Szene mit errors.peer.', 3);

  // Sequential sign-in: the server answers a concurrent login with 429.
  await signIn(A);
  const fingerprintA = await goOnline(A, NAME_A);
  await signIn(B);
  const fingerprintB = await goOnline(B, NAME_B);
  if (fingerprintA === fingerprintB) throw new Fail('A und B haben denselben Fingerabdruck (gleiche Geräteidentität?)');
  await closeDialogs(A);

  // Accept path (first run: both pins unverified, both sides type the prefix).
  await recordNativeDialogs();
  await request(fingerprintA, { verified: false });
  await prepareConsent(fingerprintB, { verified: false });
  await pause(1100); // accept is locked for 1 s after the dialog opens
  shots.push(await A.shot('remote-consent'));
  await A.click(`${CONSENT} .primary-button`);
  await A.waitFor('Leiste „Bildschirm wird angesehen“', has('.remote-share-bar'));
  const dialogs = await A.main('return globalThis.__shellherdDialogs');
  if (dialogs.length !== 1) throw new Fail(`A: erwartet genau einen nativen Dialog, aufgezeichnet ${dialogs.length}`);
  if (!dialogs[0].detail?.includes(fingerprintB)) throw new Fail('A: der native Dialog nennt den gruppierten Fingerabdruck von B nicht');
  if (JSON.stringify(dialogs[0].buttons) !== JSON.stringify(['Ablehnen', 'Bildschirm freigeben'])) throw new Fail(`A: Knöpfe des nativen Dialogs: ${JSON.stringify(dialogs[0].buttons)}`);
  log('A: nativer Dialog mit vollem Fingerabdruck von B und den Knöpfen Ablehnen / Bildschirm freigeben');
  shots.push(await A.shot('remote-bar'));
  // setContentProtection is a no-op on Linux (isContentProtected() stays false), so
  // there the scene checks the sharing window title; elsewhere the protection flag.
  const sharingState = await A.main(`return { platform: process.platform, flags: electron.BrowserWindow.getAllWindows().filter(w => !w.isDestroyed()).map(w => w.isContentProtected()), titles: electron.BrowserWindow.getAllWindows().filter(w => !w.isDestroyed()).map(w => w.getTitle()) };`);
  if (sharingState.platform === 'linux') {
    if (!sharingState.titles.some(title => title !== 'Shellherd' && title.startsWith('Shellherd'))) throw new Fail(`A: Fenstertitel zeigt die Freigabe nicht (${JSON.stringify(sharingState.titles)})`);
    log(`A: Leiste sichtbar, Titel „${sharingState.titles[0]}“ (Fensterschutz unter Linux nicht verfügbar)`);
  } else {
    if (!sharingState.flags.length || !sharingState.flags.every(Boolean)) throw new Fail(`A: Fensterschutz nicht aktiv während der Freigabe (${JSON.stringify(sharingState.flags)})`);
    log('A: Leiste sichtbar, Fenster geschützt');
  }

  await B.waitFor('Video bei B (readyState >= 2, Breite > 0)', `(() => { const v = document.querySelector('${LAB} video'); return v && v.readyState >= 2 && v.videoWidth > 0; })()`, 20000);
  const points = await B.evaluate(PIXEL_CHECK);
  if (!points) throw new Fail('B: Video verschwand vor der Pixelprüfung');
  for (const point of points) {
    if (point.got.some((channel, i) => Math.abs(channel - point.rgb[i]) > TOLERANCE))
      throw new Fail(`B: Testmuster falsch bei (${point.x * 100} %, ${point.y * 100} %): erwartet ${point.rgb}, erhalten ${point.got}`);
  }
  shots.push(await B.shot('remote-viewer'));
  log('B: Testmuster im Video stimmt (4 Punkte)');

  // End at A; B must notice within 8 s.
  const stoppedAt = Date.now();
  await A.click('.remote-share-bar button');
  await B.waitFor(`Ende-Text bei B (≤ ${END_WITHIN_MS / 1000} s)`, `document.querySelector('${LAB} .remote-lab-ended')?.textContent.includes(${JSON.stringify(ENDED_REMOTE)})`, END_WITHIN_MS);
  log(`B: Ende nach ${Date.now() - stoppedAt} ms`);
  await A.waitFor('Leiste verschwunden', `!${has('.remote-share-bar')}`, 5000);
  // Protection is lifted with a delay (up to 2 s) so the renderer can stop its tracks first; wait up to 4 s.
  const readAfter = () => A.main(`return { flags: electron.BrowserWindow.getAllWindows().filter(w => !w.isDestroyed()).map(w => w.isContentProtected()), titles: electron.BrowserWindow.getAllWindows().filter(w => !w.isDestroyed()).map(w => w.getTitle()) };`);
  let after = await readAfter();
  for (const give = Date.now() + 4000; after.flags.some(Boolean) && Date.now() < give;) { await pause(200); after = await readAfter(); }
  if (after.flags.some(Boolean)) throw new Fail(`A: Fensterschutz nach dem Beenden noch aktiv (${JSON.stringify(after.flags)})`);
  if (after.titles.some(title => title !== 'Shellherd')) throw new Fail(`A: Fenstertitel nach dem Beenden noch mit Freigabe (${JSON.stringify(after.titles)})`);
  log('A: Leiste weg, Fensterschutz und Titel zurückgesetzt');

  // Decline path (second run: both pins are verified now, so neither side sees a field).
  await request(fingerprintA, { verified: true });
  await prepareConsent(fingerprintB, { verified: true });
  await pause(300);
  await A.click(`${CONSENT} .secondary-button`);
  await B.waitFor(`Ablehnen-Text bei B (≤ ${END_WITHIN_MS / 1000} s)`, `document.querySelector('${LAB} .remote-lab-ended')?.textContent.includes(${JSON.stringify(ENDED_DECLINED)}) || document.querySelector('${LAB} [role=alert]')?.textContent.includes(${JSON.stringify(ENDED_DECLINED)})`, END_WITHIN_MS);
  log('B: Ablehnung angezeigt');

  // No Content-Security-Policy violation in either window since the start.
  for (const side of [A, B]) {
    const violations = (await side.call('console')).filter(message => message.text.includes('Content Security Policy'));
    if (violations.length) throw new Fail(`${side.label}: CSP-Meldung in der Konsole: ${violations[0].text}`);
  }
  log('A und B: keine CSP-Meldung in der Konsole');
}

// Both devices go offline again, whatever happened.
async function cleanup() {
  for (const side of [A, B]) {
    try {
      if (await side.evaluate(has(`${LAB}[open]`)) === false) {
        if (await side.evaluate(has('.remote-share-bar'))) await side.click('.remote-share-bar button');
        if (await side.evaluate(has('dialog.remote-consent-dialog[open]'))) await side.click('dialog.remote-consent-dialog .secondary-button');
        if (!await side.evaluate(has('dialog.settings-dialog[open]'))) await side.click('.settings-button');
        await side.call('eval', `[...document.querySelectorAll('dialog.settings-dialog button')].find(b => b.textContent.includes('Fernzugriff einrichten'))?.click()`);
        await side.waitFor('Fernzugriff-Dialog (Aufräumen)', has(`${LAB}[open]`), 5000);
      }
      await side.call('eval', `[...document.querySelectorAll('${LAB} button')].find(b => b.textContent.trim() === 'Offline gehen')?.click()`);
    } catch (error) { console.warn(`${side.label}: Offline gehen fehlgeschlagen: ${error.message}`); }
  }
}

let code = 0;
try { await run(); log(`OK. Screenshots:\n${shots.join('\n')}`); }
catch (error) {
  code = error instanceof Fail ? error.code : 1;
  console.error(`FEHLER: ${error.message}`);
  if (shots.length) console.error(`Screenshots bis dahin:\n${shots.join('\n')}`);
  if (code === 1) for (const side of [A, B]) { try { console.error(`${side.label} Fehlerbild: ${await side.shot(`remote-failed-${side.label.toLowerCase()}`)}`); } catch { /* driver gone */ } }
} finally {
  if (code !== 2 && code !== 3) await cleanup();
}
process.exit(code);
