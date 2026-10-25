import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, posix, win32 } from 'node:path';

import { AppError } from '../../shared/errors';
import type { RecentVault } from '../../shared/ipc';
import { MAX_RECENT_VAULTS, readAppSettings, RecentVaultSchema, writeAppSettings } from '../app-settings';
import type { RecentVaultEntry } from '../app-settings';

/** Returns the stat result or null; injectable for tests. */
export type Probe = (filePath: string) => Promise<{ isFile(): boolean } | null>;
const statOrNull: Probe = filePath => stat(filePath).catch(() => null);

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
    private readonly probe: Probe = statOrNull,
  ) {}

  /** Newest first. missing = probe fails or is not a file; UNC paths are not probed (no SMB connection). Never throws (unreadable settings → []). */
  async list(): Promise<RecentVault[]> {
    const entries = await this.entries();
    return Promise.all(entries.map(async entry => toView(entry, await this.missing(entry.filePath))));
  }

  /** filePath of the first entry that is not missing, or null. Checks one entry after the other and stops at the first hit. */
  async latest(): Promise<string | null> {
    for (const entry of await this.entries()) {
      if (!await this.missing(entry.filePath)) return entry.filePath;
    }
    return null;
  }

  private async missing(filePath: string): Promise<boolean> {
    if (filePath.startsWith('\\\\')) return false;
    return !(await this.probe(filePath))?.isFile();
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

  /** Start value from the old single-entry file; its mtime serves as the time. Same schema as stored entries. Never throws. */
  private async seed(): Promise<RecentVaultEntry[]> {
    try {
      const data: unknown = JSON.parse(await readFile(this.legacyFile, 'utf8'));
      const filePath = (data as { filePath?: unknown } | null)?.filePath;
      const { mtimeMs } = await stat(this.legacyFile);
      const parsed = RecentVaultSchema.safeParse({ filePath, openedAt: Math.round(mtimeMs) });
      return parsed.success ? [parsed.data] : [];
    } catch { return []; }
  }
}
