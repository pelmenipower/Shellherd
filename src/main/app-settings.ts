import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { z } from 'zod';

import { LANGUAGE_SETTINGS } from '../shared/locale';
import type { LanguageSetting } from '../shared/locale';

export interface AppSettings { language: LanguageSetting }
export const DEFAULT_APP_SETTINGS: AppSettings = { language: 'system' };

const LanguageSchema = z.enum(LANGUAGE_SETTINGS);

function readRaw(file: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

/** Sync. Missing, unreadable or non-object file → defaults; an invalid field → its default. */
export function readAppSettings(file: string): AppSettings {
  const language = LanguageSchema.safeParse(readRaw(file).language);
  return { language: language.success ? language.data : DEFAULT_APP_SETTINGS.language };
}

/** Sync, never throws; false when the file could not be written. Keeps unknown keys; writes `${file}.tmp` then renames. */
export function writeAppSettings(file: string, patch: Partial<AppSettings>): boolean {
  try {
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ ...readRaw(file), ...patch }, null, 2));
    renameSync(tmp, file);
    return true;
  } catch { return false; }
}
