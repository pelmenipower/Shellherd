import { randomUUID } from 'node:crypto';
import { constants, copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

/** Files Shellherd takes over once from the Terminus profile; the Chromium profile stays behind. */
export const LEGACY_USER_DATA_FILES = ['known-hosts.json', 'last-vault.json'] as const;

export interface UserDataOps {
  rename: (from: string, to: string) => void;
  sleep: (ms: number) => void;
}

const defaultOps: UserDataOps = {
  rename: renameSync,
  sleep: ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
};

const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES']);
const RENAME_ATTEMPTS = 3;
const RENAME_BACKOFF_MS = 50;

/** Renames, retrying a few times when antivirus or an indexer briefly locks the file (Windows). */
function renameWithRetry(from: string, to: string, ops: UserDataOps): void {
  for (let attempt = 1; ; attempt++) {
    try {
      ops.rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= RENAME_ATTEMPTS || !code || !RETRYABLE.has(code)) throw error;
      ops.sleep(RENAME_BACKOFF_MS);
    }
  }
}

/** Removes `<name>.*.migrating` leftovers of earlier runs in `target`; nothing else. */
function removeOrphans(target: string, name: string): void {
  try {
    for (const entry of readdirSync(target)) {
      if (entry.startsWith(`${name}.`) && entry.endsWith('.migrating') && entry.length > name.length + '..migrating'.length - 1) {
        rmSync(join(target, entry), { force: true });
      }
    }
  } catch { /* target missing or unreadable */ }
}

/**
 * Copies each file that is missing in `target` from `source`. Never overwrites, never touches `source`,
 * never throws. Returns the names that were copied.
 */
export function migrateUserData(source: string, target: string, files: readonly string[] = LEGACY_USER_DATA_FILES, ops: UserDataOps = defaultOps): string[] {
  const copied: string[] = [];
  try {
    if (resolve(source).toLowerCase() === resolve(target).toLowerCase()) return copied;
    for (const name of files) {
      try {
        if (basename(name) !== name || name.includes('\\') || name.includes('/') || name === '' || name === '..') continue;
        const from = join(source, name);
        const to = join(target, name);
        removeOrphans(target, name);
        if (existsSync(to)) continue;
        if (!statSync(from).isFile()) continue;
        mkdirSync(target, { recursive: true });
        // A half-copied known-hosts.json would block every SSH connection, so copy aside and rename.
        const temp = `${to}.${randomUUID()}.migrating`;
        try {
          copyFileSync(from, temp, constants.COPYFILE_EXCL);
          if (existsSync(to)) continue;
          renameWithRetry(temp, to, ops);
          copied.push(name);
        } finally {
          rmSync(temp, { force: true });
        }
      } catch { /* a missing source file or an unwritable target skips just this file */ }
    }
  } catch { /* never block the start */ }
  return copied;
}
