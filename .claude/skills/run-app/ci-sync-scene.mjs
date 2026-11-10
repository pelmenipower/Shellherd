// CI orchestrator for the sync scene (A12): starts the two drivers, prepares A's demo vault, runs sync-scene.mjs and stops everything.
// Usage (Linux, needs a display such as `xvfb-run -a`, and a lab build in out/): node .claude/skills/run-app/ci-sync-scene.mjs
// The SSH/AI fakes (sshd.mjs, 127.0.0.1:2222 and :9335) run too: demo-setup.mjs probes them while it creates the demo vault.
// Both drivers use their own fresh temp run directories (never the default shellherd-run), SHELLHERD_SYNC_LAB=1 and
// SHELLHERD_RUN_NO_SANDBOX=1; A on 9333, B on 9336. Synthetic data only. Overall limit 6 minutes; the exit code is the scene's.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const HERE = import.meta.dirname;
const REPO = path.resolve(HERE, '../../..');
const TOTAL_MS = 6 * 60_000;
const DRIVER_START_MS = 60_000;
const A = { label: 'A', port: 9333, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'shellherd-ci-a-')) };
const B = { label: 'B', port: 9336, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'shellherd-ci-b-')) };
const FAKES = { label: 'Fakes', dir: fs.mkdtempSync(path.join(os.tmpdir(), 'shellherd-ci-fakes-')) };
const children = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const log = message => console.log(`[ci-sync-scene] ${message}`);

// Runs a node script with the given env; resolves with its exit code. Output goes to ours.
function run(script, env) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(HERE, script)], { cwd: REPO, env: { ...process.env, ...env }, stdio: 'inherit' });
    children.push(child);
    child.on('exit', code => resolve(code ?? 1));
  });
}

function startFakes() {
  const child = spawn(process.execPath, [path.join(HERE, 'sshd.mjs')], { cwd: REPO, env: { ...process.env, SHELLHERD_RUN_DIR: FAKES.dir }, stdio: ['ignore', 'inherit', 'inherit'] });
  children.push(child);
  FAKES.child = child;
  FAKES.exited = new Promise(resolve => child.on('exit', code => resolve(code)));
}

const listening = port => new Promise(resolve => { const socket = net.connect(port, '127.0.0.1'); socket.once('connect', () => { socket.destroy(); resolve(true); }); socket.once('error', () => resolve(false)); });
async function fakesReady() {
  for (const end = Date.now() + DRIVER_START_MS; Date.now() < end; await pause(500)) {
    if (FAKES.child.exitCode !== null) throw new Error(`sshd.mjs ist vorzeitig beendet (Code ${FAKES.child.exitCode})`);
    if (await listening(2222) && await listening(9335)) return;
  }
  throw new Error(`sshd.mjs: Ports 2222/9335 nach ${DRIVER_START_MS / 1000} s nicht bereit`);
}

function startDriver(side) {
  const child = spawn(process.execPath, [path.join(HERE, 'driver.mjs')], {
    cwd: REPO,
    env: { ...process.env, SHELLHERD_SYNC_LAB: '1', SHELLHERD_RUN_NO_SANDBOX: '1', SHELLHERD_RUN_DIR: side.dir, DRIVER_PORT: String(side.port) },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  children.push(child);
  side.child = child;
  side.exited = new Promise(resolve => child.on('exit', code => resolve(code)));
}

async function token(side) {
  for (const end = Date.now() + DRIVER_START_MS; Date.now() < end; await pause(500)) {
    if (side.child.exitCode !== null) throw new Error(`Treiber ${side.label} ist vorzeitig beendet (Code ${side.child.exitCode})`);
    try {
      const value = fs.readFileSync(path.join(side.dir, 'token'), 'utf8');
      const response = await fetch(`http://127.0.0.1:${side.port}/windows`, { headers: { 'x-driver-token': value } });
      if (response.ok) return value;
    } catch { /* not ready yet */ }
  }
  throw new Error(`Treiber ${side.label}: kein Token nach ${DRIVER_START_MS / 1000} s`);
}

// Stops the SSH/AI fakes.
async function stopFakes() {
  if (!FAKES.child || FAKES.child.exitCode !== null) return;
  FAKES.child.kill('SIGTERM');
  await Promise.race([FAKES.exited, pause(3000)]);
  if (FAKES.child.exitCode === null) FAKES.child.kill('SIGKILL');
}

// Asks the driver to quit (closes Electron), then makes sure the process is gone.
async function stop(side) {
  if (!side.child || side.child.exitCode !== null) return;
  try {
    const value = fs.readFileSync(path.join(side.dir, 'token'), 'utf8');
    await fetch(`http://127.0.0.1:${side.port}/quit`, { headers: { 'x-driver-token': value }, signal: AbortSignal.timeout(5000) }).catch(() => {});
  } catch { /* no token */ }
  await Promise.race([side.exited, pause(5000)]);
  if (side.child.exitCode === null) side.child.kill('SIGKILL');
}

let code = 1;
const timer = setTimeout(async () => {
  console.error(`[ci-sync-scene] Gesamtzeit von ${TOTAL_MS / 60_000} min überschritten`);
  for (const child of children) child.kill('SIGKILL');
  for (const side of [A, B, FAKES]) fs.rmSync(side.dir, { recursive: true, force: true });
  process.exit(1);
}, TOTAL_MS);
try {
  startFakes();
  await fakesReady();
  startDriver(A);
  await token(A);
  log('Treiber A bereit, Demo-Vault wird angelegt');
  const setup = await run('demo-setup.mjs', { SHELLHERD_RUN_DIR: A.dir, DRIVER_PORT: String(A.port) });
  if (setup !== 0) throw new Error(`demo-setup.mjs endete mit Code ${setup}`);
  startDriver(B);
  await token(B);
  log('Treiber B bereit, Szene startet');
  code = await run('sync-scene.mjs', { A_RUN_DIR: A.dir, A_PORT: String(A.port), B_RUN_DIR: B.dir, B_PORT: String(B.port) });
} catch (error) {
  console.error(`[ci-sync-scene] ${error.message}`);
  code = 1;
} finally {
  clearTimeout(timer);
  await Promise.all([stop(A), stop(B), stopFakes()]);
  // On failure the run directories stay (failure screenshots under <dir>/shots); CI can upload them.
  if (code === 0) for (const side of [A, B, FAKES]) fs.rmSync(side.dir, { recursive: true, force: true });
  else console.error(`[ci-sync-scene] Run-Ordner bleiben für die Fehlersuche: ${A.dir}, ${B.dir}`);
}
process.exit(code);
