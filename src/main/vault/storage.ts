import { constants } from 'node:fs';
import {
  copyFile,
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';

import { encryptVault } from './crypto';
import { AppError } from '../../shared/errors';
import { EncryptedVaultFileSchema } from '../../shared/vault/schema';

import type { EncryptedVaultFile } from '../../shared/vault/file-format';
import type { Vault } from '../../shared/vault/types';

/** New vaults are `.term` files; `.terminus` files of earlier versions keep their name. */
const FILE_EXTENSION = '.term';

export function ensureVaultFileExtension(
  filePath: string,
): string {
  return /\.(term|terminus)$/i.test(filePath)
    ? filePath
    : `${filePath}${FILE_EXTENSION}`;
}

export async function writeEncryptedVaultFile(
  filePath: string,
  encryptedVault: EncryptedVaultFile,
): Promise<string> {
  const finalPath = ensureVaultFileExtension(filePath);
  const temporaryPath =
    `${finalPath}.${randomUUID()}.tmp`;

  const serializedVault = JSON.stringify(
    encryptedVault,
    null,
    2,
  );

  await mkdir(dirname(finalPath), {
    recursive: true,
  });

  try {
    // fsync before rename so a crash cannot leave an empty vault file.
    const handle = await open(temporaryPath, 'w', 0o600);
    try {
      await handle.writeFile(serializedVault, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }

    await rename(temporaryPath, finalPath);
  } finally {
    await rm(temporaryPath, {
      force: true,
    });
  }

  return finalPath;
}

/**
 * Copies the still-encrypted original next to it before a format upgrade overwrites it.
 * Existing backups are never overwritten.
 */
export async function backupVaultFile(
  filePath: string,
  label: string,
): Promise<string> {
  const extension = /\.terminus$/i.test(filePath) ? '.terminus' : FILE_EXTENSION;
  const base = filePath.replace(/\.(term|terminus)$/i, '');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const target = `${base}.${label}-backup-${stamp}${attempt ? `-${attempt}` : ''}${extension}`;

    try {
      await copyFile(filePath, target, constants.COPYFILE_EXCL);
      return target;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }

  throw new AppError('core.vaultBackupNameTaken');
}

export async function readEncryptedVaultFile(
  filePath: string,
): Promise<EncryptedVaultFile> {
  const serializedVault = await readFile(
    filePath,
    'utf8',
  );

  let parsed: unknown;

  try {
    parsed = JSON.parse(serializedVault);
  } catch {
    throw new AppError('core.vaultFileNotJson');
  }

  const file = EncryptedVaultFileSchema.safeParse(parsed);
  if (!file.success) throw new AppError('core.vaultFileCorrupt');
  return file.data;
}

export async function saveVault(
  filePath: string,
  vault: Vault,
  password: string,
): Promise<string> {
  const encryptedVault = await encryptVault(
    vault,
    password,
  );

  return writeEncryptedVaultFile(
    filePath,
    encryptedVault,
  );
}
