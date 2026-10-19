import { constants } from 'node:fs';
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';

import {
  decryptVault,
  encryptVault,
} from './crypto';
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
    await writeFile(temporaryPath, serializedVault, {
      encoding: 'utf8',
      mode: 0o600,
    });

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

  return EncryptedVaultFileSchema.parse(parsed);
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

export async function loadVault(
  filePath: string,
  password: string,
): Promise<Vault> {
  const encryptedVault =
    await readEncryptedVaultFile(filePath);

  return decryptVault(
    encryptedVault,
    password,
  );
}