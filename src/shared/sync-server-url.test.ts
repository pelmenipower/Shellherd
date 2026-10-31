import { describe, expect, it } from 'vitest';
import { normalizeSyncServerUrl } from './sync-server-url.mjs';
describe('central sync server URLs', () => {
  it('accepts explicit HTTPS servers and normalizes the root URL', () => {
    expect(normalizeSyncServerUrl(' https://Sync.Example.net:443 ')).toBe('https://sync.example.net/');
    expect(normalizeSyncServerUrl('https://192.168.1.2:8443')).toBe('https://192.168.1.2:8443/');
    expect(normalizeSyncServerUrl('http://127.0.0.1:8787', true)).toBe('http://127.0.0.1:8787/');
    expect(normalizeSyncServerUrl('http://[::1]:8787', true)).toBe('http://[::1]:8787/');
  });
  it('refuses cleartext LAN/public servers, embedded secrets, query strings and ambiguous paths', () => {
    for (const url of ['http://127.0.0.1', 'http://sync.example.net', 'http://192.168.1.2', 'file:///tmp/vault', 'https://user:secret@sync.example.net', 'https://sync.example.net?token=secret', 'https://sync.example.net#secret', 'https://sync.example.net/api', 'https://sy\nnc.example.net']) expect(normalizeSyncServerUrl(url)).toBeNull();
    expect(normalizeSyncServerUrl('http://localhost:8787', true)).toBeNull();
    expect(normalizeSyncServerUrl('http://192.168.1.2', true)).toBeNull();
  });
});
