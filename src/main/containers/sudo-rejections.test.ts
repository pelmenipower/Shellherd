import { describe, expect, it } from 'vitest';
import type { SshConnectionNode } from '../../shared/vault/types';
import { connectionFingerprint, SudoRejections } from './sudo-rejections';

const connection = (password: string): SshConnectionNode => ({ id: 'h1', type: 'connection', protocol: 'ssh', name: 'h', host: 'h', port: 22,
  username: 'u', authentication: { method: 'password', password }, tags: [] });

describe('connectionFingerprint', () => {
  it('is a hash that changes with the settings and never contains the password', () => {
    const print = connectionFingerprint(connection('synthetic-password'));
    expect(print).toMatch(/^[0-9a-f]{64}$/);
    expect(connectionFingerprint(connection('synthetic-password'))).toBe(print);
    expect(connectionFingerprint(connection('other'))).not.toBe(print);
  });
});

describe('SudoRejections gate', () => {
  it('lets one authentication per connection run at a time, in order', async () => {
    const rejections = new SudoRejections();
    const order: string[] = [];
    const first = await rejections.acquire('h1');
    const second = rejections.acquire('h1').then(release => { order.push('second'); return release; });
    const third = rejections.acquire('h1').then(release => { order.push('third'); return release; });
    const other = await rejections.acquire('h2');
    other();
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(order).toEqual([]);
    first();
    first();
    (await second)();
    (await third)();
    expect(order).toEqual(['second', 'third']);
    (await rejections.acquire('h1'))();
  });
  it('gives up waiting after a timeout without holding the gate later', async () => {
    const rejections = new SudoRejections();
    const holder = await rejections.acquire('h1');
    expect(await rejections.acquire('h1', 30)).toBeUndefined();
    holder();
    const release = await Promise.race([rejections.acquire('h1'), new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), 100))]);
    expect(release).toBeTypeOf('function');
    release!();
  });
  it('is released by a holder that fails', async () => {
    const rejections = new SudoRejections();
    const failing = async () => {
      const release = await rejections.acquire('h1');
      try { throw new Error('boom'); } finally { release(); }
    };
    await expect(failing()).rejects.toThrow('boom');
    const release = await Promise.race([rejections.acquire('h1'), new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), 100))]);
    expect(release).toBeTypeOf('function');
    release!();
  });
});

describe('SudoRejections', () => {
  it('remembers a rejection per connection id and fingerprint', () => {
    const rejections = new SudoRejections();
    expect(rejections.isRejected('h1', 'a')).toBe(false);
    rejections.markRejected('h1', 'a');
    expect(rejections.isRejected('h1', 'a')).toBe(true);
    expect(rejections.isRejected('h1', 'b')).toBe(false);
    expect(rejections.isRejected('h2', 'a')).toBe(false);
    rejections.markRejected('h2', 'a');
    rejections.clearAll();
    expect(rejections.isRejected('h2', 'a')).toBe(false);
  });
});
