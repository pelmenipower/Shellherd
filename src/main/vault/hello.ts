import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { z } from 'zod';

import { AppError } from '../../shared/errors';
import type { HelloStatus } from '../../shared/ipc';
import { MAX_RECENT_VAULTS } from '../app-settings';
import { grantKey, recentId } from './recent-vaults';
import type { HelloSigner } from './hello-helper';

const base64Of = (bytes: number) => z.string().max(64)
  .refine(text => /^[A-Za-z0-9+/]+={0,2}$/.test(text) && Buffer.from(text, 'base64').length === bytes);
const EntrySchema = z.object({
  filePath: z.string().min(1).max(4096),
  /** kdf.salt of the vault file the key belongs to; a replaced file has another one. */
  salt: z.string().min(1).max(4096),
  challenge: base64Of(32),
  nonce: base64Of(12),
  tag: base64Of(16),
  wrapped: base64Of(32),
}).strict();
const StoreSchema = z.object({ version: z.literal(1), vaults: z.array(EntrySchema).max(MAX_RECENT_VAULTS) });
export type HelloEntry = z.infer<typeof EntrySchema>;

/** AES-256-GCM key derived from the Hello signature; the signature is zeroed. */
function wrappingKey(signature: Buffer, challenge: Buffer): Buffer {
  try {
    return Buffer.from(hkdfSync('sha256', signature, challenge, 'shellherd-hello-v1', 32));
  } finally {
    signature.fill(0);
  }
}

const aad = (salt: string): Buffer => Buffer.from(`shellherd-hello:v1:${salt}`, 'utf8');

/** Wraps a vault key for the file with this KDF salt. Exported for tests. */
export function sealVaultKey(filePath: string, salt: string, vaultKey: Buffer, challenge: Buffer, signature: Buffer): HelloEntry {
  const key = wrappingKey(signature, challenge);
  try {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(aad(salt));
    const wrapped = Buffer.concat([cipher.update(vaultKey), cipher.final()]);
    return {
      filePath, salt,
      challenge: challenge.toString('base64'),
      nonce: nonce.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      wrapped: wrapped.toString('base64'),
    };
  } finally {
    key.fill(0);
  }
}

/** Unwraps the vault key; another signature or salt gives core.helloStale. No plaintext copy stays behind. Exported for tests. */
export function openVaultKey(entry: HelloEntry, signature: Buffer): Buffer {
  const key = wrappingKey(signature, Buffer.from(entry.challenge, 'base64'));
  let plain: Buffer | undefined;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(entry.nonce, 'base64'));
    decipher.setAAD(aad(entry.salt));
    decipher.setAuthTag(Buffer.from(entry.tag, 'base64'));
    plain = decipher.update(Buffer.from(entry.wrapped, 'base64'));
    decipher.final();
    return Buffer.from(plain);
  } catch {
    throw new AppError('core.helloStale');
  } finally {
    plain?.fill(0);
    key.fill(0);
  }
}

/** Wrapped vault keys for Windows Hello, per vault path, in hello-unlock.json next to settings.json. Never holds a password. */
export class HelloVaults {
  constructor(private readonly file: string, private readonly signer: HelloSigner) {}

  async status(filePath: string): Promise<HelloStatus> {
    return { available: await this.signer.available(), enrolled: this.find(filePath) !== undefined };
  }

  /**
   * Prompts first, then wraps the vault key that takeKey returns (zeroed here) for filePath; newest first, at most 8 vaults.
   * takeKey runs after the prompt, so no key copy waits through it; it throws if the vault was locked or switched meanwhile.
   */
  async enable(filePath: string, salt: string, takeKey: () => Buffer): Promise<HelloStatus> {
    const challenge = randomBytes(32);
    const signature = await this.signer.sign(challenge, true);
    let vaultKey: Buffer;
    try {
      vaultKey = takeKey();
    } catch (error) {
      signature.fill(0);
      throw error;
    }
    try {
      const entry = sealVaultKey(filePath, salt, vaultKey, challenge, signature);
      const key = grantKey(filePath);
      this.write([entry, ...this.entries().filter(item => grantKey(item.filePath) !== key)].slice(0, MAX_RECENT_VAULTS));
    } finally {
      vaultKey.fill(0);
    }
    return { available: true, enrolled: true };
  }

  /** Removes the entry of filePath; throws core.settingsWriteFailed if the file cannot be written. */
  forget(filePath: string): void {
    const key = grantKey(filePath);
    const entries = this.entries();
    const kept = entries.filter(item => grantKey(item.filePath) !== key);
    if (kept.length !== entries.length) this.write(kept);
  }

  /** Best effort: an entry that cannot be removed is caught again by the salt check or the next unwrap. */
  forgetQuietly(filePath: string): void {
    try { this.forget(filePath); } catch { /* see above */ }
  }

  /** Same removal for every entry of a recent-list id (recentId); never throws. */
  forgetRecent(id: unknown): void {
    for (const entry of this.entries().filter(item => recentId(item.filePath) === id)) this.forgetQuietly(entry.filePath);
  }

  /** Prompts and returns the vault key of filePath; the caller owns it. Stale entries are removed. */
  async unwrap(filePath: string, salt: string): Promise<Buffer> {
    const entry = this.find(filePath);
    if (!entry) throw new AppError('core.helloStale');
    // A replaced or new vault file: no prompt for a key that cannot fit.
    if (entry.salt !== salt) { this.forgetQuietly(filePath); throw new AppError('core.helloStale'); }
    let signature: Buffer;
    try {
      signature = await this.signer.sign(Buffer.from(entry.challenge, 'base64'), false);
    } catch (error) {
      // The Shellherd Hello key is gone (Windows Hello set up again): every stored entry is useless.
      if (error instanceof AppError && error.code === 'core.helloStale') {
        try { this.write([]); } catch { /* the next unlock reports the same */ }
      }
      throw error;
    }
    try {
      return openVaultKey(entry, signature);
    } catch (error) {
      this.forgetQuietly(filePath);
      throw error;
    }
  }

  private find(filePath: string): HelloEntry | undefined {
    const key = grantKey(filePath);
    return this.entries().find(entry => grantKey(entry.filePath) === key);
  }

  /** Missing, unreadable or invalid file → no entries; the next write replaces it. */
  private entries(): HelloEntry[] {
    try {
      const parsed = StoreSchema.safeParse(JSON.parse(readFileSync(this.file, 'utf8')));
      return parsed.success ? parsed.data.vaults : [];
    } catch {
      return [];
    }
  }

  private write(vaults: HelloEntry[]): void {
    const tmp = `${this.file}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify({ version: 1, vaults }, null, 2), { mode: 0o600 });
      renameSync(tmp, this.file);
    } catch {
      throw new AppError('core.settingsWriteFailed');
    }
  }
}
