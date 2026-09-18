import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';

import { argon2id } from 'hash-wasm';

import { validateVaultConsistency } from '../../shared/vault/consistency';
import {
  EncryptedVaultFileSchema,
  VaultSchema,
} from '../../shared/vault/schema';

import type { EncryptedVaultFile } from '../../shared/vault/file-format';
import type { Vault } from '../../shared/vault/types';

const DEFAULT_MEMORY_KIB = 65_536;
const DEFAULT_ITERATIONS = 3;
const DEFAULT_PARALLELISM = 1;

const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const NONCE_LENGTH = 12;

const ADDITIONAL_AUTHENTICATED_DATA = Buffer.from(
  'terminus-encrypted-vault:v1',
  'utf8',
);

export interface EncryptionOptions {
  memoryKiB?: number;
  iterations?: number;
  parallelism?: number;
}

export async function encryptVault(
  vault: Vault,
  password: string,
  options: EncryptionOptions = {},
): Promise<EncryptedVaultFile> {
  assertPassword(password);

  const validatedVault = VaultSchema.parse(vault);
  assertConsistent(validatedVault);

  const memoryKiB = options.memoryKiB ?? DEFAULT_MEMORY_KIB;
  const iterations = options.iterations ?? DEFAULT_ITERATIONS;
  const parallelism = options.parallelism ?? DEFAULT_PARALLELISM;

  const salt = randomBytes(SALT_LENGTH);
  const nonce = randomBytes(NONCE_LENGTH);

  const key = await deriveKey(
    password,
    salt,
    memoryKiB,
    iterations,
    parallelism,
  );

  try {
    const cipher = createCipheriv('aes-256-gcm', key, nonce);

    cipher.setAAD(ADDITIONAL_AUTHENTICATED_DATA);

    const plaintext = Buffer.from(
      JSON.stringify(validatedVault),
      'utf8',
    );

    const encrypted = Buffer.concat([
      cipher.update(plaintext),
      cipher.final(),
    ]);

    const authTag = cipher.getAuthTag();

    return {
      format: 'terminus-encrypted-vault',
      version: 1,

      kdf: {
        algorithm: 'argon2id',
        salt: salt.toString('base64'),
        memoryKiB,
        iterations,
        parallelism,
      },

      cipher: {
        algorithm: 'aes-256-gcm',
        nonce: nonce.toString('base64'),
        authTag: authTag.toString('base64'),
      },

      payload: encrypted.toString('base64'),
    };
  } finally {
    key.fill(0);
  }
}

export async function decryptVault(
  input: unknown,
  password: string,
): Promise<Vault> {
  assertPassword(password);

  const file = EncryptedVaultFileSchema.parse(input);

  const salt = Buffer.from(file.kdf.salt, 'base64');
  const nonce = Buffer.from(file.cipher.nonce, 'base64');
  const authTag = Buffer.from(file.cipher.authTag, 'base64');
  const payload = Buffer.from(file.payload, 'base64');

  assertLength(salt, SALT_LENGTH, 'Salt');
  assertLength(nonce, NONCE_LENGTH, 'Nonce');
  assertLength(authTag, 16, 'Authentifizierungstag');

  const key = await deriveKey(
    password,
    salt,
    file.kdf.memoryKiB,
    file.kdf.iterations,
    file.kdf.parallelism,
  );

  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);

    decipher.setAAD(ADDITIONAL_AUTHENTICATED_DATA);
    decipher.setAuthTag(authTag);

    const plaintext = Buffer.concat([
      decipher.update(payload),
      decipher.final(),
    ]);

    const parsed: unknown = JSON.parse(plaintext.toString('utf8'));
    const vault = VaultSchema.parse(parsed);

    assertConsistent(vault);

    return vault;
  } finally {
    key.fill(0);
  }
}

async function deriveKey(
  password: string,
  salt: Uint8Array,
  memoryKiB: number,
  iterations: number,
  parallelism: number,
): Promise<Buffer> {
  const result = await argon2id({
    password: password.normalize('NFKC'),
    salt,
    memorySize: memoryKiB,
    iterations,
    parallelism,
    hashLength: KEY_LENGTH,
    outputType: 'binary',
  });

  if (!(result instanceof Uint8Array)) {
    throw new Error('Argon2id hat keinen Binärschlüssel erzeugt.');
  }

  const key = Buffer.from(result);
  result.fill(0);

  return key;
}

function assertPassword(password: string): void {
  if (password.length === 0) {
    throw new Error('Das Vault-Passwort darf nicht leer sein.');
  }
}

function assertLength(
  value: Uint8Array,
  expectedLength: number,
  name: string,
): void {
  if (value.length !== expectedLength) {
    throw new Error(
      `${name} muss genau ${expectedLength} Bytes lang sein.`,
    );
  }
}

function assertConsistent(vault: Vault): void {
  const issues = validateVaultConsistency(vault);

  if (issues.length > 0) {
    throw new Error(
      `Die Vault ist inkonsistent: ${issues[0].message}`,
    );
  }
}