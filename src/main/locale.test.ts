import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readAppSettings } from './app-settings';
import { LocaleStore } from './locale';

describe('LocaleStore', () => {
  let dir: string;
  let file: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'shellherd-locale-')); file = join(dir, 'settings.json'); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('has a German default before init', () => {
    expect(new LocaleStore().get()).toEqual({ setting: 'system', effective: 'de-DE', system: 'de-DE' });
  });

  it('resolves system language on init', () => {
    const store = new LocaleStore();
    expect(store.init({ settingsFile: file, systemLanguages: () => ['en-GB'] })).toEqual({ setting: 'system', effective: 'en-US', system: 'en-US' });
  });

  it('reads the stored setting', () => {
    writeFileSync(file, JSON.stringify({ language: 'de-DE' }));
    const store = new LocaleStore();
    expect(store.init({ settingsFile: file, systemLanguages: () => ['en-US'] })).toEqual({ setting: 'de-DE', effective: 'de-DE', system: 'en-US' });
  });

  it('persists and notifies only on change', () => {
    const store = new LocaleStore();
    store.init({ settingsFile: file, systemLanguages: () => ['de-DE'] });
    const listener = vi.fn();
    const off = store.subscribe(listener);
    expect(store.set('en-US')).toEqual({ setting: 'en-US', effective: 'en-US', system: 'de-DE' });
    expect(readAppSettings(file).language).toBe('en-US');
    expect(listener).toHaveBeenCalledTimes(1);
    store.set('en-US');
    expect(listener).toHaveBeenCalledTimes(1);
    store.set('system');
    expect(listener).toHaveBeenCalledTimes(2);
    off();
    store.set('en-US');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('throws and keeps the old state when saving fails', () => {
    const store = new LocaleStore();
    store.init({ settingsFile: join(dir, 'missing', 'settings.json'), systemLanguages: () => ['de-DE'] });
    const listener = vi.fn();
    store.subscribe(listener);
    expect(() => store.set('en-US')).toThrowError(expect.objectContaining({ code: 'core.settingsWriteFailed' }));
    expect(store.get().setting).toBe('system');
    expect(listener).not.toHaveBeenCalled();
  });

  it('notifies when only the setting changes', () => {
    const store = new LocaleStore();
    store.init({ settingsFile: file, systemLanguages: () => ['de-DE'] });
    const listener = vi.fn();
    store.subscribe(listener);
    store.set('de-DE');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
