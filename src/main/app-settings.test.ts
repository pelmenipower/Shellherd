import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_APP_SETTINGS, readAppSettings, writeAppSettings } from './app-settings';

describe('app settings', () => {
  let dir: string;
  let file: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'shellherd-settings-')); file = join(dir, 'settings.json'); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns defaults for a missing file', () => {
    expect(readAppSettings(file)).toEqual(DEFAULT_APP_SETTINGS);
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

  it('writes, keeps unknown keys and leaves no tmp file', () => {
    writeFileSync(file, JSON.stringify({ other: 1, language: 'de-DE' }));
    writeAppSettings(file, { language: 'en-US' });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ other: 1, language: 'en-US' });
    expect(existsSync(`${file}.tmp`)).toBe(false);
  });

  it('writes into a missing file and never throws', () => {
    expect(writeAppSettings(file, { language: 'de-DE' })).toBe(true);
    expect(readAppSettings(file).language).toBe('de-DE');
    expect(writeAppSettings(join(dir, 'missing', 'x', 'settings.json'), { language: 'de-DE' })).toBe(false);
  });
});
