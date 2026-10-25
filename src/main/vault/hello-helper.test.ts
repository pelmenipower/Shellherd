import { describe, expect, it } from 'vitest';

import { createHelloSigner, fakeHelloMode, helloSignature, readHelloReply } from './hello-helper';

const MISSING = 'C:\\shellherd-missing\\Shellherd.Hello.exe';
const challenge = Buffer.alloc(32, 7);

describe('Windows Hello helper connection', () => {
  it('ignores the run-app fake in a packaged build', async () => {
    expect(fakeHelloMode(true, { SHELLHERD_HELLO_FAKE: 'ok' })).toBeUndefined();
    expect(fakeHelloMode(false, { SHELLHERD_HELLO_FAKE: 'ok' })).toBe('ok');
    const packaged = createHelloSigner(MISSING, true, { SHELLHERD_HELLO_FAKE: 'ok' });
    expect(await packaged.available()).toBe(false);
    await expect(packaged.sign(challenge, false)).rejects.toMatchObject({ code: 'core.helloUnavailable' });
  });

  it('signs deterministically with the fake and reads the environment on every call', async () => {
    const env: NodeJS.ProcessEnv = { SHELLHERD_HELLO_FAKE: 'ok' };
    const signer = createHelloSigner(MISSING, false, env);
    const first = await signer.sign(challenge, false);
    expect(await signer.sign(challenge, false)).toEqual(first);
    env.SHELLHERD_HELLO_FAKE = 'reset';
    expect(await signer.sign(challenge, false)).not.toEqual(first);
    env.SHELLHERD_HELLO_FAKE = 'cancel';
    await expect(signer.sign(challenge, false)).rejects.toMatchObject({ code: 'core.helloCanceled' });
    env.SHELLHERD_HELLO_FAKE = 'unavailable';
    await expect(signer.sign(challenge, false)).rejects.toMatchObject({ code: 'core.helloUnavailable' });
    expect(await signer.available()).toBe(false);
  });

  it('runs one prompt at a time', async () => {
    const signer = createHelloSigner(MISSING, false, { SHELLHERD_HELLO_FAKE: 'ok' });
    const results = await Promise.allSettled([signer.sign(challenge, false), signer.sign(challenge, false)]);
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected']);
    expect(results[1]).toMatchObject({ reason: { code: 'core.helloBusy' } });
    expect((await signer.sign(challenge, false)).length).toBe(32);
  });

  it('reads the helper reply', () => {
    expect(readHelloReply('{"ok":true,"available":true}\r\n')).toEqual({ ok: true, available: true });
    const codes = { canceled: 'core.helloCanceled', notFound: 'core.helloStale', unavailable: 'core.helloUnavailable', x: 'core.helloFailed' };
    for (const [status, code] of Object.entries(codes)) {
      expect(() => readHelloReply(JSON.stringify({ ok: false, status }))).toThrow(expect.objectContaining({ code }));
    }
    for (const text of ['', 'garbage', 'null', '[]']) expect(() => readHelloReply(text)).toThrow(expect.objectContaining({ code: 'core.helloFailed' }));
  });

  it('accepts only signatures of RSA-2048 size or more', () => {
    expect(helloSignature(Buffer.alloc(256, 1).toString('base64'))).toEqual(Buffer.alloc(256, 1));
    for (const value of [Buffer.alloc(255, 1).toString('base64'), '', 42, undefined, 'A'.repeat(4097)]) {
      expect(() => helloSignature(value)).toThrow(expect.objectContaining({ code: 'core.helloFailed' }));
    }
  });
});
