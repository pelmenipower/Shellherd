import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { z } from 'zod';

import { LANGUAGE_SETTINGS } from '../shared/locale';
import type { LanguageSetting } from '../shared/locale';

/** Normal (not maximized) bounds of the main window plus its maximized flag. */
export interface MainWindowState { bounds: { x: number; y: number; width: number; height: number }; maximized: boolean }
export interface AppSettings { language: LanguageSetting; mainWindow?: MainWindowState }
export const DEFAULT_APP_SETTINGS: AppSettings = { language: 'system' };

const LanguageSchema = z.enum(LANGUAGE_SETTINGS);
const MainWindowStateSchema: z.ZodType<MainWindowState> = z.object({
  bounds: z.object({ x: z.number().int(), y: z.number().int(), width: z.number().int().min(900).max(20_000), height: z.number().int().min(600).max(20_000) }),
  maximized: z.boolean(),
});

function readRaw(file: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

/** Sync. Missing, unreadable or non-object file → defaults; an invalid field → its default (mainWindow: omitted). */
export function readAppSettings(file: string): AppSettings {
  const raw = readRaw(file);
  const language = LanguageSchema.safeParse(raw.language);
  const mainWindow = MainWindowStateSchema.safeParse(raw.mainWindow);
  return {
    language: language.success ? language.data : DEFAULT_APP_SETTINGS.language,
    ...(mainWindow.success ? { mainWindow: mainWindow.data } : {}),
  };
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
