// Remote-view scene: drives two running app instances (A = shared device, B = viewer) against the rendezvous fake.
// Usage: node .claude/skills/run-app/remote-scene.mjs
// Needs (see SKILL.md, "Fernzugriff-Szene"): `npm run drive:sshd` (rendezvous fake on 8788), two drivers started with
// SHELLHERD_REMOTE_LAB=1 SHELLHERD_REMOTE_CAPTURE_FAKE=1 (A on 9333, B on 9336 with its own SHELLHERD_RUN_DIR), an unlocked
// demo vault in each (`demo-setup.mjs`), and a non-loopback network interface (WebRTC uses host candidates only).
// Env: A_RUN_DIR/A_PORT (default <tmp>/shellherd-run, 9333), B_RUN_DIR/B_PORT (default <tmp>/shellherd-run-b, 9336),
// REMOTE_SERVER_URL (default http://127.0.0.1:8788). The video runs in B's media window (remote-media.html), not in the
// main window. With SHELLHERD_REMOTE_CAPTURE_FAKE=0 on both drivers (real capture, X11/xvfb) set the same variable for the
// scene: it then only requires videoWidth > 0 instead of the test pattern (K20). Synthetic data only; no real vault or profile is touched.
// Both devices enroll (device name in the sign-in form; the identity is temporary under --password-store=basic, so the
// server holds the enrollment in RAM only). A repeated run needs fresh instances (restart both drivers, keep the fake):
// the decline mutes B at A for 10 minutes and blocks the pair at the server for 30 s, and every new instance enrolls as
// a new temporary device. The server evicts the oldest idle temporary device when its quota is full (B9), so the same
// `npm run drive:sshd` fake serves any number of runs; device names carry a per-run suffix so stale rows never match.
// Exit codes: 0 ok, 1 step failed, 2 driver unreachable or out/ built without lab code (release build), 3 no non-loopback interface.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SERVER_URL = process.env.REMOTE_SERVER_URL ?? 'http://127.0.0.1:8788';
const USER = 'demo';
const PASSWORD = 'synthetic-rendezvous-demo';
const RUN = Date.now().toString(36).slice(-5);
const NAME_A = `Gerät A ${RUN}`;
const NAME_B = `Gerät B ${RUN}`;
// The hint text comes from the German catalog (the part before the colon), so the scene follows text changes.
const TEMPORARY_HINT = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../../../src/shared/locales/de-DE/remoteLab.json'), 'utf8')).identityTemporary.split(':')[0];
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
const REAL_CAPTURE = process.env.SHELLHERD_REMOTE_CAPTURE_FAKE === '0'; // K20: no pattern check, videoWidth > 0 only
const MAIN_SHARING_TITLE = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../../../src/shared/locales/de-DE/main.json'), 'utf8')).window.mainSharing;
const MAIN_TITLE = 'Shellherd';
const ARMED_HINT = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../../../src/shared/locales/de-DE/remoteLab.json'), 'utf8')).consent.armedHint;
const ENDED_STOPPED = 'Verbindung beendet.';
const MEDIA_PAGE = 'remote-media.html';
const CONNECT_WITHIN_MS = 8000; // consent -> encrypted channel (connecting) or running share

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

const windowUrls = side => side.call('windows');
const mediaWindows = async side => (await windowUrls(side)).filter(url => url.includes(MEDIA_PAGE));
// The main window is index.html without role=secondary (K19); `use?i=` needs the index from /windows.
const isMainUrl = url => url.includes('index.html') && !url.includes('role=secondary');
async function useWindow(side, predicate, label) {
  const index = (await windowUrls(side)).findIndex(predicate);
  if (index < 0) throw new Fail(`${side.label}: Fenster „${label}“ fehlt`);
  await side.call('use', undefined, `?i=${index}`);
}
// Main-process view of the main window only (by URL): title and content protection.
const mainWindowState = side => side.main(`const main = electron.BrowserWindow.getAllWindows().filter(w => !w.isDestroyed() && w.webContents.getURL().includes('index.html') && !w.webContents.getURL().includes('role=secondary'));
  return { platform: process.platform, titles: main.map(w => w.getTitle()), flags: electron.BrowserWindow.getAllWindows().filter(w => !w.isDestroyed()).map(w => w.isContentProtected()) };`);

function hasNonLoopbackInterface() {
  return Object.values(os.networkInterfaces()).flat().some(entry => entry && !entry.internal && !entry.address.startsWith('169.254.') && !entry.address.startsWith('fe80:'));
}

// Opens the lab dialog from the settings dialog and enrolls the device, one instance at a time (the server answers parallel enrollments with 429).
async function signIn(side, name) {
  await side.waitFor('Einstellungen-Knopf', has('.settings-button'));
  await side.click('.settings-button');
  await side.waitFor('Fernzugriff-Eintrag', `[...document.querySelectorAll('dialog.settings-dialog button')].some(b => b.textContent.includes('Fernzugriff einrichten'))`);
  await side.call('eval', `[...document.querySelectorAll('dialog.settings-dialog button')].find(b => b.textContent.includes('Fernzugriff einrichten')).click()`);
  await side.waitFor('Fernzugriff-Dialog', has(`${LAB}[open]`));
  await side.fill(`${LAB} input[type=url]`, SERVER_URL);
  await side.click(`${LAB} form button[type=submit]`);
  await side.waitFor('Anmeldeformular', has(`${LAB} input[type=password]`));
  // The temporary-identity hint must be visible before the enrollment (identity is set from "connect" on).
  await side.waitFor('Hinweis „Temporäre Geräteidentität“ vor der Einschreibung', `[...document.querySelectorAll('${LAB} .remote-lab-warning')].some(p => p.textContent.includes(${JSON.stringify(TEMPORARY_HINT)}))`);
  await side.fill(`${LAB} input[autocomplete=username]`, USER);
  await side.fill(`${LAB} input[type=password]`, PASSWORD);
  await side.fill(`${LAB} input[id$="-device-name"]`, name);
  await side.click(`${LAB} form button[type=submit]`);
  await side.waitFor('Einschreibung (Knopf „Dieses Gerät online melden“)', has(`${LAB} .remote-lab-account button.primary-button`));
  if (await side.evaluate(has(`${LAB} input[type=password]`))) throw new Fail(`${side.label}: das Passwortfeld steht nach der Einschreibung noch im DOM`);
  log(`${side.label}: eingeschrieben als „${name}“ (temporär)`);
}

async function goOnline(side, name) {
  await side.click(`${LAB} .remote-lab-account button.primary-button`);
  await side.waitFor('online (Fingerabdruck sichtbar)', has(`${LAB} .remote-lab-account > code.remote-lab-fingerprint`));
  const status = await side.evaluate(`[...document.querySelectorAll('${LAB} .remote-lab-account [role=status]')].map(p => p.textContent).join(' | ')`);
  if (!status.includes(name)) throw new Fail(`${side.label}: der Gerätename aus der Einschreibung fehlt in der Online-Anzeige (${status})`);
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
  const video = document.querySelector('video');
  if (!video || !(video.readyState >= 2 && video.videoWidth > 0)) return null;
  const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  const context = canvas.getContext('2d'); context.drawImage(video, 0, 0);
  return ${JSON.stringify(PATTERN)}.map(point => ({ ...point, got: [...context.getImageData(Math.floor(point.x * canvas.width), Math.floor(point.y * canvas.height), 1, 1).data].slice(0, 3) }));
})()`;

// H2: the typed check is the first two groups, 16 characters.
const FIRST_16 = fingerprint => fingerprint.replace(/\s+/g, '').slice(0, 16);
const DEVICE_A = `li.remote-lab-device:has(strong:text-is(${JSON.stringify(NAME_A)}))`; // Playwright selector (driver routes)
const ROW_A_JS = `[...document.querySelectorAll('li.remote-lab-device')].find(li => li.querySelector('strong')?.textContent === ${JSON.stringify(NAME_A)})`; // same row for page.evaluate
const CONSENT = 'dialog.remote-consent-dialog';

// Replaces the dialog stub from driver.mjs with one that records the options (without the AbortSignal) and still answers with the last button.
async function recordNativeDialogs() {
  await A.main(`globalThis.__shellherdDialogs = [];
    electron.dialog.showMessageBox = async (first, second) => {
      const options = second ?? first;
      globalThis.__shellherdDialogs.push({ type: options.type, title: options.title, message: options.message, detail: options.detail, buttons: options.buttons, at: Date.now() });
      return { response: Math.max(0, (options.buttons?.length ?? 1) - 1), checkboxChecked: false };
    }; return true;`);
}

// After consent B must show "connecting" (encrypted channel being established) or the share must already run, within 8 s.
async function awaitConnecting(consentAt) {
  const CONNECTING = 'Verschlüsselte Verbindung wird aufgebaut';
  const connectingAtB = `[...document.querySelectorAll('${LAB} .remote-lab-caption')].some(p => p.textContent.includes(${JSON.stringify(CONNECTING)}))`;
  for (;; await pause(100)) {
    if (await B.evaluate(`!!(${connectingAtB})`)) { log(`B: „${CONNECTING} …“ oder Bild nach ${Date.now() - consentAt} ms`); return; }
    if (await A.evaluate(has('.remote-share-bar'))) { log(`A: Freigabe aktiv nach ${Date.now() - consentAt} ms`); return; }
    if (Date.now() - consentAt >= CONNECT_WITHIN_MS) throw new Fail(`weder „connecting“ noch aktive Freigabe binnen ${CONNECT_WITHIN_MS / 1000} s nach der Zustimmung`);
  }
}

// B requests a view of A. With an unverified pin B types the first 16 characters of A's own display; with a verified pin there is no field.
async function request(fingerprintOfA, { verified }) {
  await B.waitFor('A in der Geräteliste', ROW_A_JS);
  const rowText = await B.evaluate(`${ROW_A_JS}.textContent`);
  // E6: only unverified peers must hide their fingerprint; verified pins may show it.
  if (!verified && rowText.replace(/\s+/g, '').includes(FIRST_16(fingerprintOfA))) throw new Fail('B: die Geräteliste zeigt den Fingerabdruck von A vor der Prüfung (E6)');
  if (verified) {
    if (!rowText.includes('Geprüft am')) throw new Fail('B: „Geprüft am“ fehlt bei A trotz bestätigtem Pin');
    if (await B.evaluate(`!!${ROW_A_JS}.querySelector('input.remote-lab-verify')`)) throw new Fail('B: Prüffeld bei A trotz bestätigtem Pin');
    log('B: A ist geprüft („Geprüft am“), kein Feld');
  } else {
    await B.fill(`${DEVICE_A} input.remote-lab-verify`, FIRST_16(fingerprintOfA));
    log('B: erste 16 Zeichen von A aus dessen Anzeige getippt');
  }
  await B.click(`${DEVICE_A} button.primary-button`);
  await A.waitFor('Zustimmungsdialog', has(`${CONSENT}[open]`));
}

// A confirms B in the renderer dialog: typed prefix for an unverified pin, no field for a verified one.
async function prepareConsent(fingerprintOfB, { verified }) {
  const dialogText = await A.evaluate(`document.querySelector('${CONSENT}').textContent`);
  if (!verified && dialogText.replace(/\s+/g, '').includes(FIRST_16(fingerprintOfB))) throw new Fail('A: der Renderer-Dialog zeigt den Fingerabdruck von B (E6)');
  if (verified) {
    if (!dialogText.includes('Geprüft am')) throw new Fail('A: „Geprüft am“ fehlt im Zustimmungsdialog trotz bestätigtem Pin');
    if (await A.evaluate(has(`${CONSENT} input.remote-lab-verify`))) throw new Fail('A: Prüffeld im Zustimmungsdialog trotz bestätigtem Pin');
    log('A: Zustimmung ohne Feld, B ist geprüft');
  } else {
    await A.fill(`${CONSENT} input.remote-lab-verify`, FIRST_16(fingerprintOfB));
    log('A: erste 16 Zeichen von B aus dessen Anzeige getippt');
  }
}

// out/ from `npm run dist*` (SHELLHERD_RELEASE=1) has no lab chunk; the scene would only time out (K18).
// Also B2: the two preloads are self-contained (no chunks, no relative require) and the media page exists.
function requireLabBuild() {
  const root = path.join(import.meta.dirname, '../../../out');
  const dir = path.join(root, 'main');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).filter(file => String(file).endsWith('.js')) : [];
  if (!files.some(file => fs.readFileSync(path.join(dir, String(file)), 'utf8').includes('RemoteLabHost'))) throw new Fail('out/ ohne Lab-Code (Release-Build). Neu bauen: npx electron-vite build', 2);
  const preload = path.join(root, 'preload');
  if (!fs.existsSync(path.join(preload, 'remote-media.cjs')) || !fs.existsSync(path.join(root, 'renderer', MEDIA_PAGE))) throw new Fail('out/ ohne Medienfenster (remote-media.cjs / remote-media.html). Neu bauen: npx electron-vite build', 2);
  if (fs.existsSync(path.join(preload, 'chunks'))) throw new Fail('out/preload/chunks existiert (B2: Preload muss eigenständig sein). Neu bauen: npx electron-vite build', 2);
  for (const file of fs.readdirSync(preload).filter(name => name.endsWith('.cjs')))
    if (fs.readFileSync(path.join(preload, file), 'utf8').includes('require("./')) throw new Fail(`out/preload/${file} enthält require("./ (B2)`, 2);
}

// B's viewer window shows up within 10 s; the video (and the pattern, unless real capture) is checked there.
async function awaitViewerVideo(check = true) {
  for (const end = Date.now() + 10000; !(await mediaWindows(B)).length; await pause(250))
    if (Date.now() >= end) throw new Fail(`B: kein Fenster ${MEDIA_PAGE} binnen 10 s`);
  await useWindow(B, url => url.includes(MEDIA_PAGE), 'Fernansicht');
  await B.waitFor('Video bei B (readyState >= 2, Breite > 0)', `(() => { const v = document.querySelector('video'); return v && v.readyState >= 2 && v.videoWidth > 0; })()`, 20000);
  if (!check) return;
  if (REAL_CAPTURE) { log('B: Video im Fernansichtsfenster hat Breite > 0 (echte Aufnahme, keine Pixelprüfung)'); return; }
  const points = await B.evaluate(PIXEL_CHECK);
  if (!points) throw new Fail('B: Video verschwand vor der Pixelprüfung');
  for (const point of points) {
    if (point.got.some((channel, i) => Math.abs(channel - point.rgb[i]) > TOLERANCE))
      throw new Fail(`B: Testmuster falsch bei (${point.x * 100} %, ${point.y * 100} %): erwartet ${point.rgb}, erhalten ${point.got}`);
  }
  log('B: Testmuster im Video des Fernansichtsfensters stimmt (4 Punkte)');
}

async function awaitNoMediaWindow(side, within, when) {
  for (const end = Date.now() + within; (await mediaWindows(side)).length; await pause(100))
    if (Date.now() >= end) throw new Fail(`${side.label}: Fenster ${MEDIA_PAGE} existiert ${when} nach ${within / 1000} s noch`);
}

// Protection is lifted with a delay so the renderer can stop its tracks first; wait up to 4 s for protection and title.
async function awaitUnprotected(when) {
  let after = await mainWindowState(A);
  for (const give = Date.now() + 4000; (after.flags.some(Boolean) || after.titles.some(title => title !== MAIN_TITLE)) && Date.now() < give;) { await pause(200); after = await mainWindowState(A); }
  if (after.flags.some(Boolean)) throw new Fail(`A: Fensterschutz ${when} noch aktiv (${JSON.stringify(after.flags)})`);
  if (after.titles.some(title => title !== MAIN_TITLE)) throw new Fail(`A: Titel des Hauptfensters ${when} noch mit Freigabe (${JSON.stringify(after.titles)})`);
  log(`A: Leiste weg, Fensterschutz und Titel zurückgesetzt (${when})`);
}

async function run() {
  requireLabBuild();
  if (!hasNonLoopbackInterface()) throw new Fail('Keine Netzwerkschnittstelle außer Loopback: WebRTC braucht Host-Kandidaten (LAN-IP), sonst endet die Szene mit errors.peer.', 3);

  // Sequential enrollment: the server answers a concurrent password check with 429.
  await signIn(A, NAME_A);
  const fingerprintA = await goOnline(A, NAME_A);
  await signIn(B, NAME_B);
  const fingerprintB = await goOnline(B, NAME_B);
  if (fingerprintA === fingerprintB) throw new Fail('A und B haben denselben Fingerabdruck (gleiche Geräteidentität?)');
  await closeDialogs(A);

  // Accept path (first run: both pins unverified, both sides type the prefix).
  await recordNativeDialogs();
  await request(fingerprintA, { verified: false });
  await prepareConsent(fingerprintB, { verified: false });
  await pause(1100); // accept is locked for 1 s after the dialog opens
  shots.push(await A.shot('remote-consent'));
  const consentAt = Date.now();
  await A.click(`${CONSENT} .primary-button`);
  // Double-click lock: while the capture is armed the button stays disabled and the hint is shown.
  await A.waitFor('Doppelklick-Sperre (Knopf gesperrt, Hinweis „Systemdialog erscheint gleich“)', `(() => { const d = document.querySelector('${CONSENT}'); return d && d.querySelector('.primary-button')?.disabled && d.textContent.includes(${JSON.stringify(ARMED_HINT)}); })()`, 3000);
  log('A: nach dem Klick ist „Bildschirm freigeben“ gesperrt, der Hinweis zum Systemdialog steht da');
  shots.push(await A.shot('remote-armed'));
  await awaitConnecting(consentAt);
  await A.waitFor('Leiste „Bildschirm wird angesehen“', has('.remote-share-bar'));
  const dialogs = await A.main('return globalThis.__shellherdDialogs');
  if (dialogs.length !== 1) throw new Fail(`A: erwartet genau einen nativen Dialog, aufgezeichnet ${dialogs.length}`);
  if (!dialogs[0].detail?.includes(fingerprintB)) throw new Fail('A: der native Dialog nennt den gruppierten Fingerabdruck von B nicht');
  if (JSON.stringify(dialogs[0].buttons) !== JSON.stringify(['Ablehnen', 'Bildschirm freigeben'])) throw new Fail(`A: Knöpfe des nativen Dialogs: ${JSON.stringify(dialogs[0].buttons)}`);
  // V8: the system dialog opens no earlier than 550 ms after the click (the lock above is the visible half of it).
  if (!(dialogs[0].at - consentAt >= 550)) throw new Fail(`A: Systemdialog ${dialogs[0].at - consentAt} ms nach dem Klick (erwartet ≥ 550 ms, V8)`);
  log(`A: nativer Dialog ${dialogs[0].at - consentAt} ms nach dem Klick, mit vollem Fingerabdruck von B und den Knöpfen Ablehnen / Bildschirm freigeben`);
  shots.push(await A.shot('remote-bar'));
  // The agent runs in its own media window: exactly one remote-media.html window while sharing.
  const agentWindows = await mediaWindows(A);
  if (agentWindows.length !== 1) throw new Fail(`A: erwartet genau ein Fenster ${MEDIA_PAGE} während der Freigabe, gefunden ${agentWindows.length}`);
  // K19: only the main window counts. setContentProtection is a no-op on Linux (isContentProtected() stays false),
  // so there the scene checks the main window title; elsewhere the protection flag of all windows.
  const sharingState = await mainWindowState(A);
  if (sharingState.platform === 'linux') {
    if (sharingState.titles.length !== 1 || sharingState.titles[0] !== MAIN_SHARING_TITLE) throw new Fail(`A: Titel des Hauptfensters ist nicht „${MAIN_SHARING_TITLE}“ (${JSON.stringify(sharingState.titles)})`);
    log(`A: Leiste sichtbar, Titel des Hauptfensters „${sharingState.titles[0]}“ (Fensterschutz unter Linux nicht verfügbar)`);
  } else {
    if (!sharingState.flags.length || !sharingState.flags.every(Boolean)) throw new Fail(`A: Fensterschutz nicht aktiv während der Freigabe (${JSON.stringify(sharingState.flags)})`);
    log('A: Leiste sichtbar, Fenster geschützt');
  }

  await awaitViewerVideo();
  shots.push(await B.shot('remote-viewer'));
  await useWindow(B, isMainUrl, 'Hauptfenster');

  // End at A; B must notice within 8 s and A's media window must be gone within 2 s.
  const stoppedAt = Date.now();
  await A.click('.remote-share-bar button');
  await B.waitFor(`Ende-Text bei B (≤ ${END_WITHIN_MS / 1000} s)`, `document.querySelector('${LAB} .remote-lab-ended')?.textContent.includes(${JSON.stringify(ENDED_REMOTE)})`, END_WITHIN_MS);
  log(`B: Ende nach ${Date.now() - stoppedAt} ms`);
  await A.waitFor('Leiste verschwunden', `!${has('.remote-share-bar')}`, 5000);
  await awaitNoMediaWindow(A, 2000, 'nach dem Beenden');
  await awaitUnprotected('nach dem Beenden');
  await awaitNoMediaWindow(B, 2000, 'nach dem Beenden');

  // Viewer closes its window (verified pins now, so no field). B shows "stopped", A loses the bar.
  await request(fingerprintA, { verified: true });
  await prepareConsent(fingerprintB, { verified: true });
  await pause(1100);
  await A.click(`${CONSENT} .primary-button`);
  await A.waitFor('Leiste „Bildschirm wird angesehen“ (dritte Anfrage)', has('.remote-share-bar'), 20000);
  await awaitViewerVideo(false);
  await useWindow(B, isMainUrl, 'Hauptfenster');
  const closedAt = Date.now();
  await B.main(`const w = electron.BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.webContents.getURL().includes(${JSON.stringify(MEDIA_PAGE)})); if (!w) throw new Error('kein Fernansichtsfenster'); w.close(); return true;`);
  await B.waitFor('Ende-Text „Verbindung beendet.“ bei B', `[...document.querySelectorAll('${LAB} .remote-lab-ended')].some(p => p.textContent.trim() === ${JSON.stringify(ENDED_STOPPED)})`, END_WITHIN_MS);
  log(`B: „${ENDED_STOPPED}“ nach ${Date.now() - closedAt} ms`);
  await A.waitFor(`Leiste bei A verschwunden (≤ ${END_WITHIN_MS / 1000} s)`, `!${has('.remote-share-bar')}`, END_WITHIN_MS);
  log(`B schließt das Fernansichtsfenster: B zeigt „${ENDED_STOPPED}“, A verliert die Leiste nach ${Date.now() - closedAt} ms`);
  await awaitNoMediaWindow(A, 2000, 'nach Fensterende');
  await awaitUnprotected('nach Fensterende');

  // Decline path (pins are verified, so neither side sees a field). It comes last: it mutes B at A for 10 minutes.
  await request(fingerprintA, { verified: true });
  await prepareConsent(fingerprintB, { verified: true });
  await pause(300);
  await A.click(`${CONSENT} .secondary-button`);
  await B.waitFor(`Ablehnen-Text bei B (≤ ${END_WITHIN_MS / 1000} s)`, `document.querySelector('${LAB} .remote-lab-ended')?.textContent.includes(${JSON.stringify(ENDED_DECLINED)}) || document.querySelector('${LAB} [role=alert]')?.textContent.includes(${JSON.stringify(ENDED_DECLINED)})`, END_WITHIN_MS);
  log('B: Ablehnung angezeigt');

  // No Content-Security-Policy violation in any window of either instance since the start (the driver collects all windows).
  for (const side of [A, B]) {
    const violations = (await side.call('console')).filter(message => message.text.includes('Content Security Policy'));
    if (violations.length) throw new Fail(`${side.label}: CSP-Meldung in der Konsole: ${violations[0].text} (${violations[0].url})`);
  }
  log('A und B: keine CSP-Meldung in der Konsole (alle Fenster)');
}

// Both devices go offline again, whatever happened.
async function cleanup() {
  for (const side of [A, B]) {
    try {
      await useWindow(side, isMainUrl, 'Hauptfenster'); // a failed run may leave the driver on the media window
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
  if (code === 1) for (const side of [A, B]) { try { await useWindow(side, isMainUrl, 'Hauptfenster'); console.error(`${side.label} Fehlerbild: ${await side.shot(`remote-failed-${side.label.toLowerCase()}`)}`); } catch { /* driver gone */ } }
} finally {
  if (code !== 2 && code !== 3) await cleanup();
}
process.exit(code);
