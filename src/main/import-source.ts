import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Worker } from 'node:worker_threads';
import { app, dialog } from 'electron';
import type { BrowserWindow, OpenDialogOptions } from 'electron';

import { AppError } from '../shared/errors';
import { MAX_IMPORT_BYTES } from '../shared/import';
import type { ImportPreview, ImportReadResult, ImportSource } from '../shared/import';
import { mainT } from './i18n';
import type { ImportReply, ImportRequest } from './import-worker';
import { IMPORT_WORKER_PATH } from './import-worker-path';

const PUTTY_KEY = 'HKCU\\Software\\SimonTatham\\PuTTY\\Sessions';
const WINSCP_KEY = 'HKCU\\Software\\Martin Prikryl\\WinSCP 2\\Sessions';

type Parsed = Omit<ImportPreview, 'source' | 'file'>;

/** Time limit of one parse; a file that takes longer counts as too complex. */
export const PARSE_TIMEOUT_MS = 5000;

/** The slice of worker_threads.Worker that parseInWorker uses; tests inject a fake. */
export interface WorkerLike {
  postMessage(value: unknown): void;
  on(event: string, listener: (value: unknown) => void): unknown;
  terminate(): unknown;
}

/** Process and file calls of the import, injectable for tests. */
export interface ImportDeps {
  env: Record<string, string | undefined>;
  home: string;
  tempRoot: string;
  /** Parses one text; the default runs the parser in a worker with a time and heap limit. */
  parse: (source: ImportSource, text: string, home: string) => Promise<Parsed>;
  showOpen: (parent: BrowserWindow | null, options: OpenDialogOptions) => Promise<{ canceled: boolean; filePaths: string[] }>;
  /** Rejects on a non-zero exit. */
  run: (file: string, args: string[]) => Promise<unknown>;
  fs: {
    mkdtemp: (prefix: string) => Promise<string>;
    stat: (path: string) => Promise<{ size: number }>;
    readFile: (path: string) => Promise<Buffer>;
    rm: (path: string) => Promise<void>;
  };
}

export function defaultImportDeps(): ImportDeps {
  const execFileAsync = promisify(execFile);
  return {
    env: process.env,
    home: homedir(),
    tempRoot: app.getPath('temp'),
    parse: parseInWorker,
    showOpen: (parent, options) => parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options),
    run: (file, args) => execFileAsync(file, args, { timeout: 10_000, windowsHide: true }),
    fs: {
      mkdtemp: prefix => mkdtemp(prefix),
      stat: path => stat(path),
      readFile: path => readFile(path),
      rm: path => rm(path, { recursive: true, force: true }),
    },
  };
}

/** UTF-16LE when the file starts with a BOM (reg export), else UTF-8 without BOM. */
export function decodeImport(bytes: Buffer): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString('utf16le');
  return bytes.toString('utf8').replace(/^\uFEFF/, '');
}

/** True only for a regular non-zero exit: ENOENT, a timeout kill or a spawn error have no numeric code 1. */
function isPlainExit1(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, killed } = error as { code?: unknown; killed?: unknown };
  return code === 1 && killed !== true;
}

/** The SHELLHERD_UPDATE_URL test hook, accepted only as plain http to 127.0.0.1 (no userinfo tricks). */
export function localTestUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  const ok = url.protocol === 'http:' && url.hostname === '127.0.0.1' && !url.username && !url.password;
  return ok ? value : undefined;
}

function startWorker(path: string): WorkerLike {
  return new Worker(path, { resourceLimits: { maxOldGenerationSizeMb: 256 } });
}

/**
 * Parses in a fresh worker, so a crafted file cannot freeze main. A timeout, a crash or an exit without
 * reply means importTooComplex; an error reply keeps its code.
 */
export function parseInWorker(
  source: ImportSource,
  text: string,
  home: string,
  options: { path?: string; timeoutMs?: number; createWorker?: (path: string) => WorkerLike } = {},
): Promise<Parsed> {
  const path = options.path ?? IMPORT_WORKER_PATH;
  const timeoutMs = options.timeoutMs ?? PARSE_TIMEOUT_MS;
  const createWorker = options.createWorker ?? startWorker;
  return new Promise<Parsed>((resolve, reject) => {
    let worker: WorkerLike;
    try {
      worker = createWorker(path);
    } catch {
      reject(new AppError('core.importUnreadable'));
      return;
    }
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      action();
    };
    const tooComplex = () => finish(() => reject(new AppError('core.importTooComplex')));
    const timer = setTimeout(tooComplex, timeoutMs);
    worker.on('message', (value: unknown) => finish(() => {
      const reply = value as ImportReply | undefined;
      if (reply?.ok) resolve(reply.preview);
      else if (reply) reject(AppError.from(reply.error));
      else reject(new AppError('core.importTooComplex'));
    }));
    worker.on('error', tooComplex);
    worker.on('exit', tooComplex);
    const request: ImportRequest = { source, text, home };
    worker.postMessage(request);
  });
}

/** Size check, then read and decode. Read failures become importUnreadable. */
async function readText(file: string, deps: ImportDeps): Promise<string> {
  let bytes: Buffer;
  try {
    if ((await deps.fs.stat(file)).size > MAX_IMPORT_BYTES) throw new AppError('core.importTooLarge');
    bytes = await deps.fs.readFile(file);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('core.importUnreadable');
  }
  return decodeImport(bytes);
}

/** Reads a source after a click: a file dialog for OpenSSH and mRemoteNG, a reg.exe export for PuTTY and WinSCP. */
export async function readImport(source: ImportSource, parent: BrowserWindow | null, deps: ImportDeps = defaultImportDeps()): Promise<ImportReadResult> {
  if (source === 'openssh' || source === 'mremoteng') return readFromDialog(source, parent, deps);
  return readRegistry(source, deps);
}

async function readFromDialog(source: 'openssh' | 'mremoteng', parent: BrowserWindow | null, deps: ImportDeps): Promise<ImportReadResult> {
  const options: OpenDialogOptions = source === 'openssh'
    ? { title: mainT('dialogs.importOpenSsh.title'), defaultPath: join(deps.home, '.ssh', 'config'), properties: ['openFile'] }
    : {
      title: mainT('dialogs.importMRemoteNg.title'),
      defaultPath: join(deps.env.APPDATA ?? join(deps.home, 'AppData', 'Roaming'), 'mRemoteNG', 'confCons.xml'),
      filters: [{ name: 'XML', extensions: ['xml'] }],
      properties: ['openFile'],
    };
  const result = await deps.showOpen(parent, options);
  const file = result.filePaths[0];
  if (result.canceled || !file) return { canceled: true };
  const text = await readText(file, deps);
  return { canceled: false, preview: { source, file, ...(await deps.parse(source, text, deps.home)) } };
}

async function readRegistry(source: 'putty' | 'winscp', deps: ImportDeps): Promise<ImportReadResult> {
  // Test hook: read this file instead of exporting the real key.
  const hook = deps.env[source === 'putty' ? 'SHELLHERD_PUTTY_REG_FILE' : 'SHELLHERD_WINSCP_REG_FILE'];
  if (hook) return { canceled: false, preview: { source, ...(await deps.parse(source, await readText(hook, deps), deps.home)) } };

  let dir: string;
  try {
    dir = await deps.fs.mkdtemp(join(deps.tempRoot, 'shellherd-import-'));
  } catch {
    throw new AppError('core.importUnreadable');
  }
  try {
    const file = join(dir, 'export.reg');
    try {
      // Fixed program and arguments, read-only use of one HKCU key. A missing key exits non-zero.
      await deps.run(join(deps.env.SystemRoot ?? 'C:\\Windows', 'System32', 'reg.exe'), ['export', source === 'putty' ? PUTTY_KEY : WINSCP_KEY, file, '/y']);
    } catch (error) {
      // Only a plain exit 1 means "key missing". No reg.exe (ENOENT), a timeout or any other failure is unreadable.
      if (!isPlainExit1(error)) throw new AppError('core.importUnreadable');
      return { canceled: false, preview: { source, candidates: [], skipped: [] } };
    }
    return { canceled: false, preview: { source, ...(await deps.parse(source, await readText(file, deps), deps.home)) } };
  } finally {
    // A failed cleanup must not turn a finished import into an error.
    await deps.fs.rm(dir).catch(() => {});
  }
}
