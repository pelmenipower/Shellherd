// HTTP driver for Shellherd under Playwright. Start with `npm run drive`, then talk to it with curl.
// The app runs from out/ with an isolated profile; native dialogs are stubbed (see SKILL.md).
import { _electron as electron } from 'playwright-core';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeImportFixtures } from './import-fixtures.mjs';

const REPO = path.resolve(import.meta.dirname, '../../..');
const WORK = process.env.SHELLHERD_RUN_DIR ?? path.join(os.tmpdir(), 'shellherd-run');
const PROFILE = path.join(WORK, 'profile');
const SHOTS = process.env.SCREENSHOT_DIR ?? path.join(WORK, 'shots');
const APP_DIR = path.join(WORK, 'app');
const PORT = Number(process.env.DRIVER_PORT ?? 9333);
const VAULT = path.join(PROFILE, 'demo.term');

if (!fs.existsSync(path.join(REPO, 'out/main/index.js'))) {
  console.error('out/main/index.js fehlt. Zuerst bauen: npx electron-vite build');
  process.exit(1);
}
for (const dir of [PROFILE, SHOTS, APP_DIR]) fs.mkdirSync(dir, { recursive: true });
// Electron reads name and version from the app directory, so it mirrors the repo's package.json.
const { version, productName } = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
fs.writeFileSync(path.join(APP_DIR, 'package.json'), JSON.stringify({ name: 'shellherd', productName, version, type: 'module', main: 'boot.mjs' }));
fs.copyFileSync(path.join(import.meta.dirname, 'boot.mjs'), path.join(APP_DIR, 'boot.mjs'));
// Import sources and the update check stay synthetic: no registry read, no GitHub call.
const imports = writeImportFixtures(path.join(WORK, 'import'));
const AI_PORT = Number(process.env.AI_FAKE_PORT ?? 9335);

const exe = process.platform === 'win32' ? 'electron.exe' : 'electron';
const app = await electron.launch({
  executablePath: path.join(REPO, 'node_modules/electron/dist', exe),
  args: [APP_DIR],
  cwd: REPO,
  // No emulated colour scheme: Playwright defaults to light, the app follows nativeTheme instead.
  colorScheme: null,
  env: {
    ...process.env,
    SHELLHERD_PROFILE: PROFILE,
    SHELLHERD_MAIN: process.env.SHELLHERD_MAIN ?? pathToFileURL(path.join(REPO, 'out/main/index.js')).href,
    SHELLHERD_PUTTY_REG_FILE: imports.puttyReg,
    SHELLHERD_WINSCP_REG_FILE: imports.winscpReg,
    // served by ai-fake.mjs (npm run drive:sshd)
    SHELLHERD_UPDATE_URL: `http://127.0.0.1:${AI_PORT}/releases/latest`,
  },
  timeout: 60_000,
});

// Native dialogs would open on the real desktop and block the driver: file dialogs return the demo vault,
// message boxes answer with their last button (for the host key prompt: "Schlüssel vertrauen und speichern").
if (process.env.SHELLHERD_RUN_REAL_DIALOGS !== '1') {
  await app.evaluate(({ dialog }, vault) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: vault });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [vault] });
    dialog.showMessageBox = async (first, second) => {
      const options = second ?? first;
      return { response: Math.max(0, (options.buttons?.length ?? 1) - 1), checkboxChecked: false };
    };
  }, VAULT);
}

let page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {});

const body = request => new Promise(resolve => { let data = ''; request.on('data', chunk => data += chunk); request.on('end', () => resolve(data)); });
const STATUS_BAR = 26;

const routes = {
  // page JavaScript as the body of an async function; the return value comes back as JSON
  eval: async request => page.evaluate(`(async () => { ${await body(request)} })()`),
  // main-process JavaScript; `electron` is the Electron module
  main: async request => app.evaluate(new Function('electron', `return (async () => { ${await body(request)} })()`)),
  // ?name=… ; &crop=status cuts off the status bar (it shows the vault path)
  ss: async (_request, url) => {
    const file = path.join(SHOTS, `${url.searchParams.get('name') || Date.now()}.png`);
    const size = page.viewportSize() ?? { width: 1440, height: 900 };
    const clip = url.searchParams.get('crop') === 'status' ? { x: 0, y: 0, width: size.width, height: size.height - STATUS_BAR } : undefined;
    await page.screenshot({ path: file, clip });
    return file;
  },
  key: async (_request, url) => { await page.keyboard.press(url.searchParams.get('k')); return 'ok'; },
  // ?x=&y= in viewport pixels; moves the mouse, e.g. to show a hover hint
  move: async (_request, url) => { await page.mouse.move(Number(url.searchParams.get('x')), Number(url.searchParams.get('y'))); return 'ok'; },
  type: async request => { await page.keyboard.type(await body(request)); return 'ok'; },
  // body: selector, newline, value
  fill: async request => { const [selector, ...value] = (await body(request)).split('\n'); await page.locator(selector).first().fill(value.join('\n'), { timeout: 5000 }); return 'ok'; },
  click: async request => { await page.locator(await body(request)).first().click({ timeout: 5000 }); return 'ok'; },
  rclick: async request => { await page.locator(await body(request)).first().click({ button: 'right', timeout: 5000 }); return 'ok'; },
  dblclick: async request => { await page.locator(await body(request)).first().dblclick({ timeout: 5000 }); return 'ok'; },
  text: async request => page.locator((await body(request)) || 'body').first().innerText({ timeout: 5000 }),
  windows: async () => app.windows().map(window => window.url()),
  use: async (_request, url) => { page = app.windows()[Number(url.searchParams.get('i'))]; return page.url(); },
};

// Any website can POST to 127.0.0.1 without preflight, so every request needs the per-start token (and no Origin).
const TOKEN = randomBytes(16).toString('hex');
fs.writeFileSync(path.join(WORK, 'token'), TOKEN, { mode: 0o600 });

http.createServer(async (request, response) => {
  if (request.headers.origin || request.headers['x-driver-token'] !== TOKEN) { response.statusCode = 403; response.end('token'); return; }
  const url = new URL(request.url, 'http://driver');
  const name = url.pathname.slice(1);
  if (name === 'quit') { response.end('"bye"'); await app.close(); process.exit(0); }
  try {
    const route = routes[name];
    if (!route) throw new Error(`Unbekannt: /${name}. Verfügbar: ${Object.keys(routes).join(', ')}, quit`);
    response.end(JSON.stringify(await route(request, url) ?? null));
  } catch (error) {
    response.statusCode = 500;
    response.end(String(error?.message ?? error));
  }
}).listen(PORT, '127.0.0.1', () => console.log(`driver ready on ${PORT} · token ${path.join(WORK, 'token')} · profile ${PROFILE} · shots ${SHOTS}`));
