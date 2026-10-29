import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { EncryptedVaultFileSchema } from '../../shared/vault/schema';
import { encryptVault, unlockVault } from './crypto';

// Synthetic file produced on Linux. Both CI runners open and re-save the same bytes.
// The encryption envelope remains v1; Windows and Linux paths are data, not normalized on decrypt.
it('opens and re-encrypts an unchanged v1 fixture on Windows and Linux', async () => {
  const fixture = JSON.parse(await readFile(new URL('../../test/fixtures/cross-platform-v1.term', import.meta.url), 'utf8'));
  const password = 'synthetic-cross-platform-fixture';
  const first = await unlockVault(fixture, password);
  try {
    expect(first.vault.nodes).toContainEqual(expect.objectContaining({ protocol: 'powershell', workingDirectory: 'C:\\Users\\Synthetic' }));
    expect(first.vault.nodes).toContainEqual(expect.objectContaining({ protocol: 'bash', workingDirectory: '/home/synthetic' }));
    const saved = await encryptVault(first.vault, password, { memoryKiB: 16_384, iterations: 1, parallelism: 1 });
    expect(EncryptedVaultFileSchema.parse(saved)).toMatchObject({ format: 'terminus-encrypted-vault', version: 1 });
    const second = await unlockVault(saved, password);
    try { expect(second.vault).toEqual(first.vault); } finally { second.key.fill(0); }
  } finally { first.key.fill(0); }
});

it('keeps retired saved-command data when an existing vault is opened and saved', async () => {
  const fixture = JSON.parse(await readFile(new URL('../../test/fixtures/cross-platform-v1.term', import.meta.url), 'utf8'));
  const password = 'synthetic-cross-platform-fixture';
  const first = await unlockVault(fixture, password);
  try {
    const legacy = [{ id: 'retired', name: 'Old command', command: 'echo synthetic-legacy', tags: [] }];
    const saved = await encryptVault({ ...first.vault, workflows: legacy }, password, { memoryKiB: 16_384, iterations: 1, parallelism: 1 });
    const reopened = await unlockVault(saved, password);
    try { expect(reopened.vault.workflows).toEqual(legacy); } finally { reopened.key.fill(0); }
  } finally { first.key.fill(0); }
});
