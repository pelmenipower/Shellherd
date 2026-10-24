import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, posix, win32 } from 'node:path';

import { AppError } from '../../shared/errors';
import type { RecentVault } from '../../shared/ipc';
import { MAX_RECENT_VAULTS, readAppSettings, writeAppSettings } from '../app-settings';
import type { RecentVaultEntry } from '../app-settings';

/** Dedup key: resolved path, case-insensitive on Windows. */
export function recentKey(filePath: string, platform: NodeJS.Platform = process.platform): string {
  const path = platform === 'win32' ? win32 : posix;
  const resolved = path.resolve(filePath);
  return platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/** Stable id for the renderer: first 16 hex chars of sha256(recentKey(filePath)). */
export function recentId(filePath: string, platform?: NodeJS.Platform): string {
  return createHash('sha256').update(recentKey(filePath, platform)).digest('hex').slice(0, 16);
}

function toView(entry: RecentVaultEntry, missing: boolean): RecentVault {
  return {
    id: recentId(entry.filePath),
    filePath: entry.filePath,
    name: basename(entry.filePath),
    folder: dirname(entry.filePath),
    openedAt: entry.openedAt,
    missing,
  };
}

/** Recently used vault files, kept in settings.json. Only paths and times are stored, never vault content. */
export class RecentVaults {
  constructor(
    private readonly settingsFile: string,
    private readonly legacyFile: string,
    private readonly now: () => number = Date.now,
  ) {}

  /** Newest first. missing = stat fails or is not a file. Never throws (unreadable settings → []). */
  async list(): Promise<RecentVault[]> {
    const entries = await this.entries();
    return Promise.all(entries.map(async entry => {
      const info = await stat(entry.filePath).catch(() => null);
      return toView(entry, !info?.isFile());
    }));
  }

  /** filePath of the first entry that is not missing, or null. Replaces LastVaultFile.get(). */
  async latest(): Promise<string | null> {
    return (await this.list()).find(entry => !entry.missing)?.filePath ?? null;
  }

  /** Moves/inserts filePath at the top with openedAt = now(), dedups by recentKey, keeps 8. Best effort: never throws. */
  async touch(filePath: string): Promise<void> {
    const key = recentKey(filePath);
    const rest = (await this.entries()).filter(entry => recentKey(entry.filePath) !== key);
    writeAppSettings(this.settingsFile, { recentVaults: [{ filePath, openedAt: this.now() }, ...rest].slice(0, MAX_RECENT_VAULTS) });
  }

  /** Removes the entry with this id. Unknown id or non-string → AppError('core.invalidRequest'); write fails → AppError('core.settingsWriteFailed'). Returns list(). */
  async remove(id: unknown): Promise<RecentVault[]> {
    const entries = await this.entries();
    const kept = entries.filter(entry => recentId(entry.filePath) !== id);
    if (kept.length === entries.length) throw new AppError('core.invalidRequest');
    if (!writeAppSettings(this.settingsFile, { recentVaults: kept })) throw new AppError('core.settingsWriteFailed');
    return this.list();
  }

  /** Stored list; without a recentVaults key only the one-time seed from the legacy last-vault.json. */
  private async entries(): Promise<RecentVaultEntry[]> {
    return readAppSettings(this.settingsFile).recentVaults ?? this.seed();
  }

  /** Start value from the old single-entry file; its mtime serves as the time. Never throws. */
  private async seed(): Promise<RecentVaultEntry[]> {
    try {
      const data: unknown = JSON.parse(await readFile(this.legacyFile, 'utf8'));
      const filePath = (data as { filePath?: unknown } | null)?.filePath;
      if (typeof filePath !== 'string' || filePath === '') return [];
      const { mtimeMs } = await stat(this.legacyFile);
      return [{ filePath, openedAt: Math.round(mtimeMs) }];
    } catch { return []; }
  }
}
