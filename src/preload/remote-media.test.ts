import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCALE_ARG } from '../shared/locale';
import { REMOTE_MEDIA_CHANNELS, REMOTE_MEDIA_FAKE_ARG, REMOTE_MEDIA_LOCALE_ARG } from '../shared/remote-media';
import type { RemoteMediaApi } from '../shared/remote-media';

const exposeInMainWorld = vi.fn();
const invoke = vi.fn();
const on = vi.fn();
const removeListener = vi.fn();
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld },
  ipcRenderer: { invoke, on, removeListener },
}));

async function load(argv: string[]): Promise<RemoteMediaApi> {
  const saved = process.argv;
  process.argv = ['electron', ...argv];
  vi.resetModules();
  exposeInMainWorld.mockClear();
  try {
    await import('./remote-media');
  } finally {
    process.argv = saved;
  }
  return exposeInMainWorld.mock.calls[0][1] as RemoteMediaApi;
}

describe('media preload', () => {
  beforeEach(() => { invoke.mockReset(); on.mockReset(); removeListener.mockReset(); });

  it('exposes exactly remoteMedia with the four keys', async () => {
    const api = await load([]);
    expect(exposeInMainWorld).toHaveBeenCalledTimes(1);
    expect(exposeInMainWorld.mock.calls[0][0]).toBe('remoteMedia');
    expect(Object.keys(api).sort()).toEqual(['action', 'captureFake', 'locale', 'onEvent']);
  });
  it('reads the locale from argv and falls back to de-DE', async () => {
    expect((await load([`${REMOTE_MEDIA_LOCALE_ARG}en-US`])).locale).toBe('en-US');
    expect((await load([`${REMOTE_MEDIA_LOCALE_ARG}fr-FR`])).locale).toBe('de-DE');
    expect((await load([])).locale).toBe('de-DE');
  });
  it('captureFake only for =1', async () => {
    expect((await load([`${REMOTE_MEDIA_FAKE_ARG}1`])).captureFake).toBe(true);
    expect((await load([`${REMOTE_MEDIA_FAKE_ARG}0`])).captureFake).toBe(false);
    expect((await load([])).captureFake).toBe(false);
  });
  it('action invokes remote-media:action', async () => {
    const api = await load([]);
    invoke.mockResolvedValue({ ok: true });
    await expect(api.action({ kind: 'stop' })).resolves.toEqual({ ok: true });
    expect(invoke).toHaveBeenCalledWith('remote-media:action', { kind: 'stop' });
    expect(REMOTE_MEDIA_CHANNELS.action).toBe('remote-media:action');
  });
  it('onEvent subscribes and unsubscribes', async () => {
    const api = await load([]);
    const listener = vi.fn();
    const off = api.onEvent(listener);
    expect(on.mock.calls[0][0]).toBe('remote-media:event');
    on.mock.calls[0][1]({}, { kind: 'accepted' });
    expect(listener).toHaveBeenCalledWith({ kind: 'accepted' });
    off();
    expect(removeListener).toHaveBeenCalledWith('remote-media:event', on.mock.calls[0][1]);
  });
  it('locale arg equals the main preload constant', () => {
    expect(REMOTE_MEDIA_LOCALE_ARG).toBe(LOCALE_ARG);
  });
  it('imports at runtime only electron and ../shared/remote-media', () => {
    const src = readFileSync(new URL('./remote-media.ts', import.meta.url), 'utf8');
    const specs = [...src.matchAll(/^\s*(import\s+(?!type\b)[^;]*?from|export\s[^;]*?from)\s*'([^']+)'/gms)].map(m => m[2]);
    expect(specs.sort()).toEqual(['../shared/remote-media', 'electron']);
    expect(src).not.toMatch(/require\(/);
  });
});
