import { createHmac, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { AppError } from '../../shared/errors';
import { HelloVaults, openVaultKey, sealVaultKey } from './hello';
import type { HelloSigner } from './hello-helper';
import { recentId } from './recent-vaults';

const SALT = 'c2FsdC1vZi10aGUtdmF1bHQ=';
const OTHER_SALT = 'b3RoZXItc2FsdA==';
const PATH = 'C:\\A\\v.term';

function setup() {
  const file = join(mkdtempSync(join(tmpdir(), 'shellherd-hello-')), 'hello-unlock.json');
  const signer = { secret: 'one', fail: undefined as AppError | undefined };
  const sign = vi.fn(async (challenge: Buffer) => {
    if (signer.fail) throw signer.fail;
    return createHmac('sha256', signer.secret).update(challenge).digest();
  });
  const fake: HelloSigner = { available: async () => true, sign };
  const hello = new HelloVaults(file, fake);
  const vaultKey = randomBytes(32);
  const enable = (path = PATH, salt = SALT) => hello.enable(path, salt, () => Buffer.from(vaultKey));
  return { file, signer, sign, hello, vaultKey, enable };
}

describe('HelloVaults', () => {
  it('round-trips the vault key and never writes it in clear', async () => {
    const { file, hello, vaultKey, enable } = setup();
    expect(await enable()).toEqual({ available: true, enrolled: true });
    const text = readFileSync(file, 'utf8');
    expect(text).not.toContain(vaultKey.toString('base64'));
    expect(text).not.toContain(vaultKey.toString('hex'));
    expect(await hello.unwrap(PATH, SALT)).toEqual(vaultKey);
  });

  it('zeroes the key it was given', async () => {
    const { hello } = setup();
    const copy = randomBytes(32);
    await hello.enable(PATH, SALT, () => copy);
    expect(copy.equals(Buffer.alloc(32))).toBe(true);
  });

  it('stores nothing when takeKey throws', async () => {
    const { file, hello } = setup();
    await expect(hello.enable(PATH, SALT, () => { throw new AppError('core.vaultLocked'); })).rejects.toMatchObject({ code: 'core.vaultLocked' });
    expect(() => readFileSync(file, 'utf8')).toThrow();
  });

  it('drops the entry of another salt without a prompt', async () => {
    const { hello, sign, enable } = setup();
    await enable();
    sign.mockClear();
    await expect(hello.unwrap(PATH, OTHER_SALT)).rejects.toMatchObject({ code: 'core.helloStale' });
    expect(sign).not.toHaveBeenCalled();
    expect(await hello.status(PATH)).toEqual({ available: true, enrolled: false });
  });

  it('drops the entry when the signature changed', async () => {
    const { hello, signer, enable } = setup();
    await enable();
    signer.secret = 'two';
    await expect(hello.unwrap(PATH, SALT)).rejects.toMatchObject({ code: 'core.helloStale' });
    expect(await hello.status(PATH)).toEqual({ available: true, enrolled: false });
  });

  it('keeps the entry after a cancel and drops every entry when the Hello key is gone', async () => {
    const { hello, signer, enable } = setup();
    await enable('C:\\A\\one.term');
    await enable('C:\\A\\two.term');
    signer.fail = new AppError('core.helloCanceled');
    await expect(hello.unwrap('C:\\A\\one.term', SALT)).rejects.toMatchObject({ code: 'core.helloCanceled' });
    expect((await hello.status('C:\\A\\one.term')).enrolled).toBe(true);
    signer.fail = new AppError('core.helloStale');
    await expect(hello.unwrap('C:\\A\\one.term', SALT)).rejects.toMatchObject({ code: 'core.helloStale' });
    expect((await hello.status('C:\\A\\two.term')).enrolled).toBe(false);
  });

  it('matches paths like the grant list and keeps at most eight vaults', async () => {
    const { hello, enable } = setup();
    await enable();
    expect((await hello.status('c:\\a\\V.TERM')).enrolled).toBe(true);
    expect((await hello.status('C:\\B\\v.term')).enrolled).toBe(false);
    await enable('c:\\a\\v.term');
    for (let index = 0; index < 8; index += 1) await enable(`C:\\many\\${index}.term`);
    expect((await hello.status(PATH)).enrolled).toBe(false);
    expect((await hello.status('C:\\many\\0.term')).enrolled).toBe(true);
  });

  it('forgets by path and by recent id', async () => {
    const { hello, enable } = setup();
    await enable();
    hello.forgetRecent(42);
    expect((await hello.status(PATH)).enrolled).toBe(true);
    hello.forgetRecent(recentId(PATH));
    expect((await hello.status(PATH)).enrolled).toBe(false);
    await enable();
    hello.forget(PATH);
    expect((await hello.status(PATH)).enrolled).toBe(false);
  });

  it('treats a broken file as empty and writes it anew', async () => {
    const { file, hello, enable } = setup();
    await enable();
    const valid = JSON.parse(readFileSync(file, 'utf8')) as { vaults: Record<string, unknown>[] };
    for (const content of ['{', JSON.stringify({ version: 2, vaults: valid.vaults }), JSON.stringify({ version: 1, vaults: [{ ...valid.vaults[0], extra: 1 }] })]) {
      writeFileSync(file, content);
      expect((await hello.status(PATH)).enrolled).toBe(false);
    }
    await enable();
    expect((await hello.status(PATH)).enrolled).toBe(true);
  });

  it('binds the wrapped key to the vault salt and uses a fresh nonce', () => {
    const challenge = randomBytes(32);
    const signature = (): Buffer => createHmac('sha256', 'one').update(challenge).digest();
    const vaultKey = randomBytes(32);
    const entry = sealVaultKey(PATH, SALT, vaultKey, challenge, signature());
    expect(openVaultKey(entry, signature())).toEqual(vaultKey);
    expect(entry.nonce).not.toBe(sealVaultKey(PATH, SALT, vaultKey, challenge, signature()).nonce);
    expect(() => openVaultKey({ ...entry, salt: OTHER_SALT }, signature())).toThrow(expect.objectContaining({ code: 'core.helloStale' }));
  });
});
