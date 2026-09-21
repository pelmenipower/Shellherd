import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

import { decryptVault, encryptVault } from './crypto';

import type { Vault } from '../../shared/vault/types';

const FILE_EXTENSION = '.terminus';

export function ensureVaultFileExtension(filePath: string): string {
  return filePath.toLowerCase().endsWith(FILE_EXTENSION)
    ? filePath
    : `${filePath}${FILE_EXTENSION}`;
}

export async function saveVault(
  filePath: string,
  vault: Vault,
  password: string,
): Promise<string> {
  const finalPath = ensureVaultFileExtension(filePath);
  const temporaryPath = `${finalPath}.${randomUUID()}.tmp`;

  const encryptedVault = await encryptVault(vault, password);
  const serializedVault = JSON.stringify(encryptedVault, null, 2);

  await mkdir(dirname(finalPath), { recursive: true });

  try {
    await writeFile(temporaryPath, serializedVault, {
      encoding: 'utf8',
      mode: 0o600,
    });

    await rename(temporaryPath, finalPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }

  return finalPath;
}

export async function loadVault(
  filePath: string,
  password: string,
): Promise<Vault> {
  const serializedVault = await readFile(filePath, 'utf8');

  let encryptedVault: unknown;

  try {
    encryptedVault = JSON.parse(serializedVault);
  } catch {
    throw new Error('Die ausgewählte Datei enthält kein gültiges JSON.');
  }

  return decryptVault(encryptedVault, password);
}