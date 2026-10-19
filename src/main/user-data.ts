import { randomUUID } from 'node:crypto';
import { constants, copyFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

/** Files Shellherd takes over once from the Terminus profile; the Chromium profile stays behind. */
export const LEGACY_USER_DATA_FILES = ['known-hosts.json', 'last-vault.json'] as const;

/**
 * Copies each file that is missing in `target` from `source`. Never overwrites, never touches `source`,
 * never throws. Returns the names that were copied.
 */
export function migrateUserData(source: string, target: string, files: readonly string[] = LEGACY_USER_DATA_FILES): string[] {
  const copied: string[] = [];
  try {
    if (resolve(source).toLowerCase() === resolve(target).toLowerCase()) return copied;
    for (const name of files) {
      try {
        if (basename(name) !== name || name.includes('\\') || name.includes('/') || name === '' || name === '..') continue;
        const from = join(source, name);
        const to = join(target, name);
        if (existsSync(to)) continue;
        if (!statSync(from).isFile()) continue;
        mkdirSync(target, { recursive: true });
        // A half-copied known-hosts.json would block every SSH connection, so copy aside and rename.
        const temp = `${to}.${randomUUID()}.migrating`;
        try {
          copyFileSync(from, temp, constants.COPYFILE_EXCL);
          if (existsSync(to)) continue;
          renameSync(temp, to);
          copied.push(name);
        } finally {
          rmSync(temp, { force: true });
        }
      } catch { /* a missing source file or an unwritable target skips just this file */ }
    }
  } catch { /* never block the start */ }
  return copied;
}
