import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => 'C:\\Temp' }, dialog: {} }));

import { AppError } from '../shared/errors';
import { decodeImport, localTestUrl, PARSE_TIMEOUT_MS, parseInWorker, readImport } from './import-source';
import type { ImportDeps, WorkerLike } from './import-source';
import { parseImport } from './import-parse';
import { MAX_IMPORT_BYTES } from '../shared/import';

const PUTTY_KEY = 'HKCU\\Software\\SimonTatham\\PuTTY\\Sessions';
const WINSCP_KEY = 'HKCU\\Software\\Martin Prikryl\\WinSCP 2\\Sessions';
const HOME = 'C:\\Users\\demo';
const utf16 = (text: string): Buffer => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
const PUTTY_TEXT = '[HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\web%2001]\r\n"HostName"="10.0.0.1"\r\n"PortNumber"=dword:00000016\r\n';

/** In-memory files, a fake reg.exe that writes `exported` (or fails with `runError`) and logs of runs and removed paths. */
function fakeDeps(files: Record<string, Buffer> = {}, options: { exported?: Buffer; runError?: Record<string, unknown>; env?: Record<string, string>; size?: number } = {}) {
  const store = new Map(Object.entries(files));
  const removed: string[] = [];
  const made: string[] = [];
  const runs: { file: string; args: string[] }[] = [];
  const deps: ImportDeps = {
    registryImport: true,
    env: options.env ?? {},
    home: HOME,
    tempRoot: 'C:\\Temp',
    parse: async (source, text, home) => parseImport(source, text, home),
    showOpen: async () => ({ canceled: true, filePaths: [] }),
    run: async (file, args) => {
      runs.push({ file, args });
      if (options.runError) throw Object.assign(new Error('reg.exe failed'), options.runError);
      if (options.exported) store.set(args[2], options.exported);
    },
    fs: {
      mkdtemp: async prefix => { const dir = `${prefix}x`; made.push(dir); return dir; },
      stat: async path => {
        const bytes = store.get(path);
        if (!bytes) throw new Error('ENOENT');
        return { size: options.size ?? bytes.length };
      },
      readFile: async path => {
        const bytes = store.get(path);
        if (!bytes) throw new Error('ENOENT');
        return bytes;
      },
      rm: async path => { removed.push(path); },
    },
  };
  return { deps, removed, made, runs, store };
}

describe('decodeImport', () => {
  it('decodes UTF-16LE with BOM and drops the BOM', () => {
    expect(decodeImport(utf16('[Sessions]'))).toBe('[Sessions]');
  });

  it('decodes UTF-8 and drops a UTF-8 BOM, keeping umlauts', () => {
    expect(decodeImport(Buffer.from('\uFEFFHost Größe', 'utf8'))).toBe('Host Größe');
    expect(decodeImport(Buffer.from('Host plain', 'utf8'))).toBe('Host plain');
  });
});

describe('readImport from a file', () => {
  it('returns canceled when the dialog is dismissed', async () => {
    const { deps } = fakeDeps();
    await expect(readImport('openssh', null, deps)).resolves.toEqual({ canceled: true });
  });

  it('reads the chosen OpenSSH file and keeps its path in the preview', async () => {
    const file = join(HOME, '.ssh', 'config');
    const { deps } = fakeDeps({ [file]: Buffer.from('Host web\n  HostName 10.0.0.1\n') });
    deps.showOpen = async (_parent, options) => {
      expect(options.defaultPath).toBe(join(HOME, '.ssh', 'config'));
      return { canceled: false, filePaths: [file] };
    };
    const result = await readImport('openssh', null, deps);
    expect(result).toMatchObject({ canceled: false, preview: { source: 'openssh', file, candidates: [{ key: 'web', host: '10.0.0.1' }] } });
  });

  it('rejects a file above the size limit before reading it', async () => {
    const file = 'C:\\big.xml';
    const { deps } = fakeDeps({ [file]: Buffer.from('x') }, { size: MAX_IMPORT_BYTES + 1 });
    deps.showOpen = async () => ({ canceled: false, filePaths: [file] });
    await expect(readImport('mremoteng', null, deps)).rejects.toMatchObject({ code: 'core.importTooLarge' });
  });

  it('maps a read failure to importUnreadable', async () => {
    const { deps } = fakeDeps();
    deps.showOpen = async () => ({ canceled: false, filePaths: ['C:\\gone'] });
    await expect(readImport('openssh', null, deps)).rejects.toMatchObject({ code: 'core.importUnreadable' });
  });

  it('passes the encrypted-file error of mRemoteNG through', async () => {
    const file = 'C:\\confCons.xml';
    const { deps } = fakeDeps({ [file]: Buffer.from('<Connections FullFileEncryption="true"></Connections>') });
    deps.showOpen = async () => ({ canceled: false, filePaths: [file] });
    await expect(readImport('mremoteng', null, deps)).rejects.toMatchObject({ code: 'core.importEncrypted' });
  });
});

describe('readImport from the registry', () => {
  it('exports the HKCU key to a temp file, reads it and removes the temp folder', async () => {
    const { deps, runs, removed, made, store } = fakeDeps({}, { exported: utf16(PUTTY_TEXT) });
    const result = await readImport('putty', null, deps);
    expect(runs).toHaveLength(1);
    expect(runs[0].file).toBe(join('C:\\Windows', 'System32', 'reg.exe'));
    expect(runs[0].args).toEqual(['export', PUTTY_KEY, join(made[0], 'export.reg'), '/y']);
    expect(store.has(join(made[0], 'export.reg'))).toBe(true);
    expect(result).toMatchObject({ canceled: false, preview: { source: 'putty', candidates: [{ key: 'web 01', host: '10.0.0.1', port: 22 }] } });
    expect(removed).toEqual(made);
  });

  it('returns an empty preview when the key is missing (normal reg.exe exit 1)', async () => {
    const { deps, removed, made } = fakeDeps({}, { runError: { code: 1 } });
    await expect(readImport('putty', null, deps)).resolves.toEqual({ canceled: false, preview: { source: 'putty', candidates: [], skipped: [] } });
    expect(removed).toEqual(made);
  });

  it.each([
    ['reg.exe missing (ENOENT)', { code: 'ENOENT' }],
    ['timeout (killed)', { code: 1, killed: true }],
    ['other failure without exit code', {}],
  ])('maps %s to importUnreadable and still removes the temp folder', async (_case, runError) => {
    const { deps, removed, made } = fakeDeps({}, { runError });
    await expect(readImport('putty', null, deps)).rejects.toMatchObject({ code: 'core.importUnreadable' });
    expect(removed).toEqual(made);
  });

  it('maps a failing temp folder to importUnreadable without running reg.exe', async () => {
    const { deps, runs } = fakeDeps();
    deps.fs.mkdtemp = async () => { throw Object.assign(new Error('EPERM'), { code: 'EPERM' }); };
    await expect(readImport('winscp', null, deps)).rejects.toMatchObject({ code: 'core.importUnreadable' });
    expect(runs).toHaveLength(0);
  });

  it('removes the temp folder even when the export is too large', async () => {
    const { deps, removed, made } = fakeDeps({}, { exported: utf16(PUTTY_TEXT), size: MAX_IMPORT_BYTES + 1 });
    await expect(readImport('putty', null, deps)).rejects.toMatchObject({ code: 'core.importTooLarge' });
    expect(removed).toEqual(made);
  });

  it.each([
    ['putty', 'SHELLHERD_PUTTY_REG_FILE', PUTTY_TEXT],
    ['winscp', 'SHELLHERD_WINSCP_REG_FILE', '[HKEY_CURRENT_USER\\Software\\Martin Prikryl\\WinSCP 2\\Sessions\\prod]\r\n"HostName"="files.example"\r\n'],
  ] as const)('reads the %s test file instead of reg.exe when the hook is set', async (source, hook, text) => {
    const file = 'C:\\fixtures\\export.reg';
    const { deps, runs, made } = fakeDeps({ [file]: utf16(text) }, { env: { [hook]: file } });
    const result = await readImport(source, null, deps);
    expect(runs).toHaveLength(0);
    expect(made).toHaveLength(0);
    expect(result).toMatchObject({ canceled: false, preview: { source, candidates: [{}] } });
    expect(result.canceled === false && result.preview.file).toBeUndefined();
  });

  it('exports the WinSCP sessions key', async () => {
    const { deps, runs, made } = fakeDeps({}, { exported: utf16('') });
    await readImport('winscp', null, deps);
    expect(runs[0].args).toEqual(['export', WINSCP_KEY, join(made[0], 'export.reg'), '/y']);
  });
});

describe('localTestUrl', () => {
  it('accepts a plain http URL on 127.0.0.1', () => {
    expect(localTestUrl('http://127.0.0.1:9335/x')).toBe('http://127.0.0.1:9335/x');
  });

  it.each([
    ['userinfo that points elsewhere', 'http://127.0.0.1:@evil.example/x'],
    ['https', 'https://127.0.0.1/x'],
    ['localhost', 'http://localhost:1/x'],
    ['not a URL', 'not a url'],
    ['credentials', 'http://user:pw@127.0.0.1:9335/x'],
    ['undefined', undefined],
  ])('rejects %s', (_case, value) => {
    expect(localTestUrl(value)).toBeUndefined();
  });
});

/** Fake worker: the test emits the events; posted messages are logged. */
class FakeWorker implements WorkerLike {
  readonly listeners = new Map<string, (value: unknown) => void>();
  readonly posted: unknown[] = [];
  terminated = 0;
  postMessage(value: unknown) { this.posted.push(value); }
  on(event: string, listener: (value: unknown) => void) { this.listeners.set(event, listener); return this; }
  terminate() { this.terminated++; return Promise.resolve(1); }
  emit(event: string, value?: unknown) { this.listeners.get(event)?.(value); }
}

describe('parseInWorker', () => {
  const preview = { candidates: [], skipped: [] };
  const paths: string[] = [];
  let worker: FakeWorker;
  const createWorker = (path: string): WorkerLike => { paths.push(path); return worker; };
  const run = () => parseInWorker('putty', 'text', HOME, { path: 'worker.js', createWorker });

  beforeEach(() => {
    worker = new FakeWorker();
    paths.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('posts the request to the given worker path and resolves with the reply', async () => {
    const result = run();
    expect(paths).toEqual(['worker.js']);
    expect(worker.posted).toEqual([{ source: 'putty', text: 'text', home: HOME }]);
    worker.emit('message', { ok: true, preview });
    await expect(result).resolves.toEqual(preview);
    expect(worker.terminated).toBe(1);
  });

  it('rejects with the coded error of an error reply and terminates the worker', async () => {
    const result = run();
    worker.emit('message', { ok: false, error: { code: 'core.importEncrypted' } });
    const error = await result.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'core.importEncrypted' });
    expect(worker.terminated).toBe(1);
  });

  it('terminates the worker and rejects with importTooComplex on timeout', async () => {
    vi.useFakeTimers();
    const result = run();
    const check = expect(result).rejects.toMatchObject({ code: 'core.importTooComplex' });
    await vi.advanceTimersByTimeAsync(PARSE_TIMEOUT_MS);
    await check;
    expect(worker.terminated).toBe(1);
  });

  it('rejects with importTooComplex when the worker exits without a reply', async () => {
    const result = run();
    worker.emit('exit', 1);
    await expect(result).rejects.toMatchObject({ code: 'core.importTooComplex' });
    expect(worker.terminated).toBe(1);
  });

  it('rejects with importTooComplex when the worker errors without a reply', async () => {
    const result = run();
    worker.emit('error', new Error('heap out of memory'));
    await expect(result).rejects.toMatchObject({ code: 'core.importTooComplex' });
  });

  it('settles only once: a late exit or timeout after the reply changes nothing', async () => {
    vi.useFakeTimers();
    const result = run();
    worker.emit('message', { ok: true, preview });
    worker.emit('exit', 0);
    await vi.advanceTimersByTimeAsync(PARSE_TIMEOUT_MS);
    await expect(result).resolves.toEqual(preview);
    expect(worker.terminated).toBe(1);
  });

  it('maps a worker that cannot be created to importUnreadable', async () => {
    const result = parseInWorker('putty', 'text', HOME, { createWorker: () => { throw new Error('bad path'); } });
    await expect(result).rejects.toMatchObject({ code: 'core.importUnreadable' });
  });
});

it('refuses Windows registry import before spawning or reading files when unavailable', async () => {
  const { deps, runs, made } = fakeDeps();
  deps.registryImport = false;
  await expect(readImport('putty', null, deps)).rejects.toMatchObject({ code: 'core.importWindowsOnly' });
  expect(runs).toEqual([]);
  expect(made).toEqual([]);
});
