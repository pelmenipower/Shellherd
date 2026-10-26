import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const screen = vi.hoisted(() => ({ getAllDisplays: vi.fn(), getPrimaryDisplay: vi.fn() }));
vi.mock('electron', () => ({ screen }));

import { DEFAULT_APP_SETTINGS, MAX_RECENT_VAULTS, readAppSettings, writeAppSettings } from './app-settings';
import type { MainWindowState, RecentVaultEntry } from './app-settings';
import { visibleBounds } from './windows';

const mainWindow: MainWindowState = { bounds: { x: 10, y: 20, width: 1200, height: 900 }, maximized: true };

describe('app settings', () => {
  let dir: string;
  let file: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'shellherd-settings-')); file = join(dir, 'settings.json'); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns defaults for a missing file', () => {
    expect(readAppSettings(file)).toEqual(DEFAULT_APP_SETTINGS);
    expect(DEFAULT_APP_SETTINGS).toEqual({ language: 'system', theme: 'dark', update: { enabled: true } });
  });

  it('returns defaults for a broken or non-object file', () => {
    writeFileSync(file, '{nope');
    expect(readAppSettings(file)).toEqual(DEFAULT_APP_SETTINGS);
    writeFileSync(file, '[1,2]');
    expect(readAppSettings(file)).toEqual(DEFAULT_APP_SETTINGS);
    writeFileSync(file, 'null');
    expect(readAppSettings(file)).toEqual(DEFAULT_APP_SETTINGS);
  });

  it('falls back to system for an invalid language', () => {
    writeFileSync(file, JSON.stringify({ language: 'fr-FR' }));
    expect(readAppSettings(file).language).toBe('system');
  });

  it('reads a valid language', () => {
    writeFileSync(file, JSON.stringify({ language: 'en-US' }));
    expect(readAppSettings(file).language).toBe('en-US');
  });

  it('reads a valid theme and falls back to dark for an invalid one', () => {
    writeFileSync(file, JSON.stringify({ theme: 'light' }));
    expect(readAppSettings(file).theme).toBe('light');
    writeFileSync(file, JSON.stringify({ theme: 'system' }));
    expect(readAppSettings(file).theme).toBe('system');
    writeFileSync(file, JSON.stringify({ theme: 'blue' }));
    expect(readAppSettings(file).theme).toBe('dark');
    writeFileSync(file, JSON.stringify({ theme: 42 }));
    expect(readAppSettings(file).theme).toBe('dark');
  });

  it('reads a valid main window state', () => {
    writeFileSync(file, JSON.stringify({ language: 'en-US', mainWindow }));
    expect(readAppSettings(file)).toEqual({ language: 'en-US', theme: 'dark', mainWindow, update: { enabled: true } });
  });

  it('ignores a broken main window state and keeps the language', () => {
    writeFileSync(file, JSON.stringify({ language: 'de-DE', mainWindow: { ...mainWindow, bounds: { ...mainWindow.bounds, width: 100 } } }));
    expect(readAppSettings(file)).toEqual({ language: 'de-DE', theme: 'dark', update: { enabled: true } });
    writeFileSync(file, JSON.stringify({ language: 'de-DE', mainWindow: { bounds: mainWindow.bounds } }));
    expect(readAppSettings(file)).toEqual({ language: 'de-DE', theme: 'dark', update: { enabled: true } });
    writeFileSync(file, JSON.stringify({ language: 'de-DE', mainWindow: { ...mainWindow, bounds: { ...mainWindow.bounds, x: 1.5 } } }));
    expect(readAppSettings(file).mainWindow).toBeUndefined();
  });

  it('reads the update settings', () => {
    writeFileSync(file, JSON.stringify({ update: { enabled: false, checkedAt: 1_700_000_000_000, latest: '0.22.0', skipped: '0.21.1' } }));
    expect(readAppSettings(file).update).toEqual({ enabled: false, checkedAt: 1_700_000_000_000, latest: '0.22.0', skipped: '0.21.1' });
  });

  it('keeps an opt-out when another update field is broken', () => {
    writeFileSync(file, JSON.stringify({ update: { enabled: false, checkedAt: -1, latest: 'v0.22.0', skipped: '1.2' } }));
    expect(readAppSettings(file).update).toEqual({ enabled: false });
  });

  it('treats a non-boolean enabled as on', () => {
    writeFileSync(file, JSON.stringify({ update: { enabled: 'no' } }));
    expect(readAppSettings(file).update).toEqual({ enabled: true });
  });

  it('reports recentVaults as undefined when the key was never written', () => {
    writeFileSync(file, JSON.stringify({ language: 'de-DE' }));
    expect(readAppSettings(file).recentVaults).toBeUndefined();
    writeFileSync(file, JSON.stringify({ recentVaults: 'C:\\a.term' }));
    expect(readAppSettings(file).recentVaults).toBeUndefined();
  });

  it('keeps an empty recentVaults list as an empty list', () => {
    writeFileSync(file, JSON.stringify({ recentVaults: [] }));
    expect(readAppSettings(file).recentVaults).toEqual([]);
  });

  it('drops invalid recent entries: relative paths, negative or fractional times, empty paths', () => {
    const good: RecentVaultEntry = { filePath: join(dir, 'a.term'), openedAt: 1_700_000_000_000 };
    writeFileSync(file, JSON.stringify({ recentVaults: [
      { filePath: 'relative.term', openedAt: 1 },
      { filePath: join(dir, 'b.term'), openedAt: -1 },
      { filePath: join(dir, 'c.term'), openedAt: 1.5 },
      { filePath: '', openedAt: 1 },
      'not an object',
      good,
    ] }));
    expect(readAppSettings(file).recentVaults).toEqual([good]);
  });

  it('keeps at most MAX_RECENT_VAULTS entries, newest first', () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({ filePath: join(dir, `v${i}.term`), openedAt: 1000 - i }));
    writeFileSync(file, JSON.stringify({ recentVaults: entries }));
    const list = readAppSettings(file).recentVaults ?? [];
    expect(MAX_RECENT_VAULTS).toBe(8);
    expect(list).toHaveLength(8);
    expect(list).toEqual(entries.slice(0, 8));
  });

  it('writes, keeps unknown keys and leaves no tmp file', () => {
    writeFileSync(file, JSON.stringify({ other: 1, language: 'de-DE' }));
    writeAppSettings(file, { language: 'en-US' });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ other: 1, language: 'en-US' });
    expect(existsSync(`${file}.tmp`)).toBe(false);
  });

  it('writes the theme and keeps language, main window and recent vaults', () => {
    const recent: RecentVaultEntry[] = [{ filePath: join(dir, 'a.term'), openedAt: 5 }];
    writeFileSync(file, JSON.stringify({ language: 'de-DE', mainWindow, recentVaults: recent }));
    writeAppSettings(file, { theme: 'light' });
    expect(readAppSettings(file)).toEqual({ language: 'de-DE', theme: 'light', mainWindow, update: { enabled: true }, recentVaults: recent });
  });

  it('writes the recent vaults and keeps the other keys', () => {
    writeFileSync(file, JSON.stringify({ language: 'de-DE', theme: 'light' }));
    const recent: RecentVaultEntry[] = [{ filePath: join(dir, 'a.term'), openedAt: 5 }];
    writeAppSettings(file, { recentVaults: recent });
    expect(readAppSettings(file)).toEqual({ language: 'de-DE', theme: 'light', update: { enabled: true }, recentVaults: recent });
  });

  it('writes the main window state and keeps the language', () => {
    writeFileSync(file, JSON.stringify({ language: 'de-DE' }));
    writeAppSettings(file, { mainWindow });
    expect(readAppSettings(file)).toEqual({ language: 'de-DE', theme: 'dark', mainWindow, update: { enabled: true } });
    writeAppSettings(file, { language: 'en-US' });
    expect(readAppSettings(file)).toEqual({ language: 'en-US', theme: 'dark', mainWindow, update: { enabled: true } });
  });

  it('writes the update block and keeps language and main window', () => {
    writeFileSync(file, JSON.stringify({ language: 'de-DE', mainWindow }));
    writeAppSettings(file, { update: { enabled: false, skipped: '0.22.0' } });
    expect(readAppSettings(file)).toEqual({ language: 'de-DE', theme: 'dark', mainWindow, update: { enabled: false, skipped: '0.22.0' } });
  });

  it('writes into a missing file and never throws', () => {
    expect(writeAppSettings(file, { language: 'de-DE' })).toBe(true);
    expect(readAppSettings(file).language).toBe('de-DE');
    expect(writeAppSettings(join(dir, 'missing', 'x', 'settings.json'), { language: 'de-DE' })).toBe(false);
  });
});

describe('visibleBounds for a saved main window', () => {
  const display = (x: number, y: number, width: number, height: number) => ({ workArea: { x, y, width, height } });
  beforeEach(() => {
    screen.getAllDisplays.mockReturnValue([display(0, 0, 1920, 1040)]);
    screen.getPrimaryDisplay.mockReturnValue(display(0, 0, 1920, 1040));
  });

  it('keeps a window that is on screen', () => {
    const bounds = { x: 100, y: 100, width: 1280, height: 800 };
    expect(visibleBounds(bounds)).toEqual(bounds);
  });

  it('moves a window from a removed display onto the primary display', () => {
    expect(visibleBounds({ x: 5000, y: 100, width: 1280, height: 800 })).toEqual({ x: 40, y: 40, width: 1280, height: 800 });
  });

  it('shrinks a window that is larger than the primary display', () => {
    expect(visibleBounds({ x: 5000, y: 100, width: 3000, height: 1200 })).toEqual({ x: 40, y: 40, width: 1840, height: 960 });
  });
});
