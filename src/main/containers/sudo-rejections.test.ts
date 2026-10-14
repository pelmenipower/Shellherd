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

describe('SudoRejections', () => {
  it('remembers a rejection per connection id and fingerprint', () => {
    const rejections = new SudoRejections();
    expect(rejections.isRejected('h1', 'a')).toBe(false);
    rejections.markRejected('h1', 'a');
    expect(rejections.isRejected('h1', 'a')).toBe(true);
    expect(rejections.isRejected('h1', 'b')).toBe(false);
    expect(rejections.isRejected('h2', 'a')).toBe(false);
    rejections.markRejected('h2', 'a');
    rejections.clear('h1');
    expect(rejections.isRejected('h1', 'a')).toBe(false);
    expect(rejections.isRejected('h2', 'a')).toBe(true);
    rejections.clearAll();
    expect(rejections.isRejected('h2', 'a')).toBe(false);
  });
});
