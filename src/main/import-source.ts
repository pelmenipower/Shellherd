import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { app, dialog } from 'electron';
import type { BrowserWindow, OpenDialogOptions } from 'electron';

import { AppError } from '../shared/errors';
import { MAX_IMPORT_BYTES } from '../shared/import';
import type { ImportPreview, ImportReadResult, ImportSource } from '../shared/import';
import { parseMRemoteNg } from '../shared/import-mremoteng';
import { parseOpenSshConfig } from '../shared/import-openssh';
import { parsePuttyReg } from '../shared/import-putty';
import { parseWinScp } from '../shared/import-winscp';
import { mainT } from './i18n';

const PUTTY_KEY = 'HKCU\\Software\\SimonTatham\\PuTTY\\Sessions';
const WINSCP_KEY = 'HKCU\\Software\\Martin Prikryl\\WinSCP 2\\Sessions';

type Parsed = Omit<ImportPreview, 'source' | 'file'>;

/** Process and file calls of the import, injectable for tests. */
export interface ImportDeps {
  env: Record<string, string | undefined>;
  home: string;
  tempRoot: string;
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

function parse(source: ImportSource, text: string, home: string): Parsed {
  switch (source) {
    case 'openssh': return parseOpenSshConfig(text, home);
    case 'putty': return parsePuttyReg(text);
    case 'winscp': return parseWinScp(text);
    case 'mremoteng': return parseMRemoteNg(text);
  }
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
  return { canceled: false, preview: { source, file, ...parse(source, text, deps.home) } };
}

async function readRegistry(source: 'putty' | 'winscp', deps: ImportDeps): Promise<ImportReadResult> {
  // Test hook: read this file instead of exporting the real key.
  const hook = deps.env[source === 'putty' ? 'SHELLHERD_PUTTY_REG_FILE' : 'SHELLHERD_WINSCP_REG_FILE'];
  if (hook) return { canceled: false, preview: { source, ...parse(source, await readText(hook, deps), deps.home) } };

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
    return { canceled: false, preview: { source, ...parse(source, await readText(file, deps), deps.home) } };
  } finally {
    // A failed cleanup must not turn a finished import into an error.
    await deps.fs.rm(dir).catch(() => {});
  }
}
