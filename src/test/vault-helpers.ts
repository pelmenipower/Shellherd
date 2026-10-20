import { AppError } from '../shared/errors';
import { EncryptedVaultFileSchema } from '../shared/vault/schema';
import type { Vault } from '../shared/vault/types';
import { unlockVault } from '../main/vault/crypto';

export async function decryptVault(
  input: unknown,
  password: string,
): Promise<Vault> {
  const parsedFile = EncryptedVaultFileSchema.safeParse(input);

  if (!parsedFile.success) {
    throw new AppError('core.vaultFileCorrupt');
  }

  const unlocked = await unlockVault(parsedFile.data, password);

  try {
    return unlocked.vault;
  } finally {
    unlocked.key.fill(0);
  }
}
