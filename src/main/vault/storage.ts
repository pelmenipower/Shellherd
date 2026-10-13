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
import { EncryptedVaultFileSchema } from '../../shared/vault/schema';

import type { EncryptedVaultFile } from '../../shared/vault/file-format';
import type { Vault } from '../../shared/vault/types';

const FILE_EXTENSION = '.terminus';

export function ensureVaultFileExtension(
  filePath: string,
): string {
  return filePath.toLowerCase().endsWith(FILE_EXTENSION)
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
  const base = filePath.replace(/\.terminus$/i, '');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const target = `${base}.${label}-backup-${stamp}${attempt ? `-${attempt}` : ''}${FILE_EXTENSION}`;

    try {
      await copyFile(filePath, target, constants.COPYFILE_EXCL);
      return target;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }

  throw new Error('Für die Vault-Sicherung wurde kein freier Dateiname gefunden.');
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
    throw new Error(
      'Die ausgewählte Datei enthält kein gültiges JSON.',
    );
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