import { describe, expect, it } from 'vitest';
import type { KnownHostView } from '../../shared/known-hosts';
import { knownHostName, matchesKnownHost, sortKnownHosts } from './known-hosts-view';

const view = (partial: Partial<KnownHostView> & Pick<KnownHostView, 'origin'>): KnownHostView => ({
  id: 'a1b2c3d4e5f60718', host: 'web-01', port: 22, type: 'ssh-ed25519', fingerprint: 'SHA256:b3JlbQ', ...partial,
});

describe('sortKnownHosts', () => {
  it('lists named entries first, then hashed, then revoked', () => {
    const list = [
      view({ origin: 'revoked', host: null, port: null, type: null, id: 'r' }),
      view({ origin: 'imported', host: null, port: null, id: 'h' }),
      view({ origin: 'imported', host: 'web-10', id: 'w10' }),
      view({ origin: 'confirmed', host: 'Alpha', type: null, id: 'alpha' }),
      view({ origin: 'imported', host: 'web-02', id: 'w02' }),
    ];
    expect(sortKnownHosts(list).map(item => item.id)).toEqual(['alpha', 'w02', 'w10', 'h', 'r']);
  });
});

describe('matchesKnownHost', () => {
  const entry = view({ origin: 'confirmed', host: 'web-01', port: 2222, type: null, fingerprint: 'SHA256:xyz' });
  const imported = view({ origin: 'imported', type: 'ssh-ed25519', fingerprint: 'SHA256:b3JlbQ' });

  it('ignores case', () => {
    expect(matchesKnownHost(entry, 'WEB')).toBe(true);
  });
  it('finds the key type', () => {
    expect(matchesKnownHost(imported, 'ed25519')).toBe(true);
    expect(matchesKnownHost(entry, 'ed25519')).toBe(false);
  });
  it('finds part of the fingerprint', () => {
    expect(matchesKnownHost(imported, 'b3Jl')).toBe(true);
  });
  it('matches everything for a blank query', () => {
    expect(matchesKnownHost(entry, '  ')).toBe(true);
    expect(matchesKnownHost(entry, '')).toBe(true);
  });
  it('rejects a query that matches nothing', () => {
    expect(matchesKnownHost(entry, 'nicht-da')).toBe(false);
  });
});

describe('knownHostName', () => {
  it('omits port 22', () => {
    expect(knownHostName(view({ origin: 'confirmed', host: 'web-01', port: 22 }))).toBe('web-01');
  });
  it('shows the port and brackets IPv6', () => {
    expect(knownHostName(view({ origin: 'confirmed', host: '::1', port: 2222 }))).toBe('[::1]:2222');
  });
  it('names hashed entries', () => {
    expect(knownHostName(view({ origin: 'imported', host: null, port: null }))).toBe('Gehashter Hostname');
  });
  it('names revoked keys for all hosts', () => {
    expect(knownHostName(view({ origin: 'revoked', host: null, port: null }))).toBe('Alle Hosts');
  });
});
