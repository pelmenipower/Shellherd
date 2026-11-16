import { describe, expect, it } from 'vitest';
import { isPrivateTunnelAddress, needsPrivateNetwork, normalizeSyncServerUrl } from './sync-server-url.mjs';
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
  it('accepts numeric tunnel addresses only with private opt-in and keeps ports', () => {
    for (const u of ['http://10.8.0.1:8787/', 'http://100.64.3.4/', 'http://100.127.255.255/', 'http://172.16.0.1/', 'http://172.31.255.254/', 'http://192.168.1.5/', 'http://[fd7a:115c:a1e0::1]/', 'http://[fc00::1]/']) {
      expect(normalizeSyncServerUrl(u, { private: true })).toBe(u.replace(/^(http:\/\/[^/]+)\/?$/, '$1/'));
      expect(normalizeSyncServerUrl(u)).toBeNull();
      expect(normalizeSyncServerUrl(u, true)).toBeNull();
      expect(needsPrivateNetwork(u)).toBe(true);
    }
  });
  it('canonicalizes alternative IPv4 notations before checking', () => {
    expect(normalizeSyncServerUrl('http://167772161/', { private: true })).toBe('http://10.0.0.1/');
    expect(normalizeSyncServerUrl('http://0xa.0.0.1/', { private: true })).toBe('http://10.0.0.1/');
    expect(normalizeSyncServerUrl('http://10.1/', { private: true })).toBe('http://10.0.0.1/');
    expect(normalizeSyncServerUrl('http://010.8.0.1/', { private: true })).toBeNull();
  });
  it('refuses non-tunnel hosts even with private opt-in', () => {
    for (const u of ['http://100.63.255.255/', 'http://100.128.0.0/', 'http://172.15.0.1/', 'http://172.32.0.1/', 'http://169.254.1.1/', 'http://8.8.8.8/', 'http://0.0.0.0/', 'http://[fe80::1]/', 'http://[fec0::1]/', 'http://[fbff::1]/', 'http://[::ffff:10.0.0.1]/', 'http://[64:ff9b::a00:1]/', 'http://server.lan/', 'http://10.0.0.1.nip.io/']) {
      expect(normalizeSyncServerUrl(u, { private: true })).toBeNull();
      expect(needsPrivateNetwork(u)).toBe(false);
    }
  });
  it('keeps loopback and HTTPS rules independent of the private option', () => {
    expect(normalizeSyncServerUrl('http://127.0.0.1/', { private: true })).toBeNull();
    expect(normalizeSyncServerUrl('http://127.0.0.1/', { loopback: true })).toBe('http://127.0.0.1/');
    expect(normalizeSyncServerUrl('https://10.0.0.1:8443', { private: true })).toBe('https://10.0.0.1:8443/');
    expect(normalizeSyncServerUrl('https://sync.example.net', {})).toBe('https://sync.example.net/');
    expect(needsPrivateNetwork('https://10.0.0.1/')).toBe(false);
    expect(needsPrivateNetwork('http://127.0.0.1/')).toBe(false);
    expect(needsPrivateNetwork(42)).toBe(false);
    expect(isPrivateTunnelAddress('10.0.0.1')).toBe(true);
    expect(isPrivateTunnelAddress('::1')).toBe(false);
  });
});
