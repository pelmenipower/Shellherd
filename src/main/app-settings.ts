import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { z } from 'zod';

import { LANGUAGE_SETTINGS } from '../shared/locale';
import type { LanguageSetting } from '../shared/locale';
import { THEME_SETTINGS } from '../shared/theme';
import type { ThemeSetting } from '../shared/theme';

/** Normal (not maximized) bounds of the main window plus its maximized flag. */
export interface MainWindowState { bounds: { x: number; y: number; width: number; height: number }; maximized: boolean }
/** Version check, see update-check.ts. Times in ms since epoch. */
export interface UpdateSettings { enabled: boolean; /** ms since epoch of the last successful check */ checkedAt?: number; latest?: string; skipped?: string }
/** Newest first; at most MAX_RECENT_VAULTS. Only path and time, never vault content. */
export interface RecentVaultEntry { filePath: string; /** ms since epoch */ openedAt: number }
export const MAX_RECENT_VAULTS = 8;
export interface AppSettings { language: LanguageSetting; theme: ThemeSetting; mainWindow?: MainWindowState; update: UpdateSettings; /** absent = never written (legacy seed allowed) */ recentVaults?: RecentVaultEntry[] }
export const DEFAULT_APP_SETTINGS: AppSettings = { language: 'system', theme: 'dark', update: { enabled: true } };

const LanguageSchema = z.enum(LANGUAGE_SETTINGS);
const ThemeSchema = z.enum(THEME_SETTINGS);
/** One recentVaults entry. Also checks the legacy start value from last-vault.json (recent-vaults.ts). */
export const RecentVaultSchema = z.object({
  filePath: z.string().min(1).max(4096).refine(isAbsolute),
  openedAt: z.number().int().min(0),
});
const MainWindowStateSchema: z.ZodType<MainWindowState> = z.object({
  bounds: z.object({ x: z.number().int(), y: z.number().int(), width: z.number().int().min(900).max(20_000), height: z.number().int().min(600).max(20_000) }),
  maximized: z.boolean(),
});
const CheckedAtSchema = z.number().int().min(0);
const VersionSchema = z.string().regex(/^\d{1,4}\.\d{1,4}\.\d{1,4}$/);

function readRaw(file: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

/** Field by field: a broken field is dropped, but only an explicit `false` turns the check off. */
function readUpdate(value: unknown): UpdateSettings {
  const raw = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
  const checkedAt = CheckedAtSchema.safeParse(raw.checkedAt);
  const latest = VersionSchema.safeParse(raw.latest);
  const skipped = VersionSchema.safeParse(raw.skipped);
  return {
    enabled: raw.enabled !== false,
    ...(checkedAt.success ? { checkedAt: checkedAt.data } : {}),
    ...(latest.success ? { latest: latest.data } : {}),
    ...(skipped.success ? { skipped: skipped.data } : {}),
  };
}

/** Not an array → undefined (never written); otherwise broken entries are dropped and the list is capped. */
function readRecentVaults(value: unknown): RecentVaultEntry[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries: RecentVaultEntry[] = [];
  for (const item of value) {
    const parsed = RecentVaultSchema.safeParse(item);
    if (parsed.success) entries.push(parsed.data);
  }
  return entries.slice(0, MAX_RECENT_VAULTS);
}

/** Sync. Missing, unreadable or non-object file → defaults; an invalid field → its default (mainWindow, recentVaults: omitted). */
export function readAppSettings(file: string): AppSettings {
  const raw = readRaw(file);
  const language = LanguageSchema.safeParse(raw.language);
  const theme = ThemeSchema.safeParse(raw.theme);
  const mainWindow = MainWindowStateSchema.safeParse(raw.mainWindow);
  const recentVaults = readRecentVaults(raw.recentVaults);
  return {
    language: language.success ? language.data : DEFAULT_APP_SETTINGS.language,
    theme: theme.success ? theme.data : DEFAULT_APP_SETTINGS.theme,
    ...(mainWindow.success ? { mainWindow: mainWindow.data } : {}),
    update: readUpdate(raw.update),
    ...(recentVaults !== undefined ? { recentVaults } : {}),
  };
}

/** Sync, never throws; false when the file could not be written. Keeps unknown keys; writes `${file}.tmp` then renames. */
export function writeAppSettings(file: string, patch: Partial<AppSettings>): boolean {
  try {
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ ...readRaw(file), ...patch }, null, 2), { mode: 0o600 });
    renameSync(tmp, file);
    return true;
  } catch { return false; }
}
