import { isIP } from 'node:net';
import { expect, it, vi } from 'vitest';
import { DEFAULT_LIMITS, createLimiter, parseTrustedProxies, sourceOf } from './rate-limit.mjs';

const any = parseTrustedProxies('10.0.0.0/8');
const req = (remoteAddress, headers = {}) => ({ socket: { remoteAddress }, headers });

it('exposes the frozen default budgets', () => {
  expect(DEFAULT_LIMITS).toEqual({ global: 600, source: 240, info: 30, login: 5, passwordFailuresGlobal: 20, rendezvousToken: 180, challenge: 30, session: 20, deviceWrites: 60, connectionsPerSource: 8, concurrentPerSource: 4, maxKeys: 4096 });
  expect(Object.isFrozen(DEFAULT_LIMITS)).toBe(true);
});
it('limits per key with a token bucket and reports whole-second retryAfter', () => {
  let now = 0; const limiter = createLimiter({ clock: () => now });
  for (let i = 0; i < 30; i++) expect(limiter.take('a', { capacity: 30, perMinute: 30 })).toEqual({ ok: true });
  expect(limiter.take('a', { capacity: 30, perMinute: 30 })).toEqual({ ok: false, retryAfter: 2 });
  expect(limiter.take('b', { capacity: 30, perMinute: 30 })).toEqual({ ok: true });
  now += 2000; expect(limiter.take('a', { capacity: 30, perMinute: 30 })).toEqual({ ok: true });
  now -= 10_000; expect(limiter.take('a', { capacity: 30, perMinute: 30 }).ok).toBe(false);
  expect(limiter.take('slow', { capacity: 1, perMinute: 1 }).ok).toBe(true);
  expect(limiter.take('slow', { capacity: 1, perMinute: 1 })).toEqual({ ok: false, retryAfter: 60 });
});
it('evicts the least recently used key beyond maxKeys', () => {
  const limiter = createLimiter({ clock: () => 0, maxKeys: 4096 }); const o = { capacity: 1, perMinute: 1 };
  expect(limiter.take('k0', o).ok).toBe(true); expect(limiter.take('k0', o).ok).toBe(false);
  for (let i = 1; i <= 4096; i++) limiter.take('k' + i, o);
  expect(limiter.take('k0', o).ok).toBe(true); // evicted at the 4097th key, so fresh again
  expect(limiter.take('k4096', o).ok).toBe(false); // recent keys survive
});
it('derives the source from the socket unless a trusted proxy supplies a valid last X-Forwarded-For element', () => {
  expect(sourceOf(req('203.0.113.5', { 'x-forwarded-for': '9.9.9.9' }))).toBe('4:203.0.113.5');
  expect(sourceOf(req('10.0.0.1', { 'x-forwarded-for': '9.9.9.9' }), { trustedProxy: any })).toBe('4:9.9.9.9');
  expect(sourceOf(req('10.0.0.1', { 'x-forwarded-for': '1.1.1.1, 8.8.8.8 ,  7.7.7.7' }), { trustedProxy: any })).toBe('4:7.7.7.7');
  expect(sourceOf(req('10.0.0.1', { 'x-forwarded-for': '1.1.1.1, bogus' }), { trustedProxy: any })).toBe('4:10.0.0.1');
  expect(sourceOf(req('10.0.0.1'), { trustedProxy: any })).toBe('4:10.0.0.1');
  expect(sourceOf(req('10.0.0.1', { 'x-forwarded-for': '2001:db8:1:2:3:4:5:6' }), { trustedProxy: any })).toBe('6:2001:db8:1:2::/64');
});
it('unpacks IPv4-mapped addresses and normalizes IPv6 to its /64', () => {
  expect(sourceOf(req('::ffff:1.2.3.4'))).toBe('4:1.2.3.4');
  expect(sourceOf(req('2001:db8:1:2:aaaa:bbbb:cccc:dddd'))).toBe('6:2001:db8:1:2::/64');
  expect(sourceOf(req('2001:DB8:1:2::1'))).toBe('6:2001:db8:1:2::/64');
  expect(sourceOf(req('2001:db8::1'))).toBe('6:2001:db8:0:0::/64');
  expect(sourceOf(req('::1'))).toBe('6:0:0:0:0::/64');
  expect(sourceOf(req('fe80::1%eth0'))).toBe('6:fe80:0:0:0::/64');
  expect(isIP('1.2.3.4')).toBe(4);
});
it('ignores X-Forwarded-For from a peer outside the trusted list and logs the peer once', () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    expect(sourceOf(req('203.0.113.77', { 'x-forwarded-for': '9.9.9.9' }), { trustedProxy: any })).toBe('4:203.0.113.77');
    expect(sourceOf(req('203.0.113.77', { 'x-forwarded-for': '9.9.9.9' }), { trustedProxy: any })).toBe('4:203.0.113.77');
    expect(log.mock.calls).toEqual([['Ignoring X-Forwarded-For from untrusted peer 203.0.113.77']]);
  } finally { log.mockRestore(); }
});
it('matches IPv4 and IPv6 CIDR lists and IPv4-mapped peers', () => {
  const match = parseTrustedProxies('172.31.87.1, 10.0.0.0/8 ,2001:db8:1::/48');
  expect(match('172.31.87.1')).toBe(true); expect(match('172.31.87.2')).toBe(false);
  expect(match('10.200.1.1')).toBe(true); expect(match('11.0.0.1')).toBe(false);
  expect(match('::ffff:172.31.87.1')).toBe(true); expect(match('::ffff:10.1.2.3')).toBe(true);
  expect(match('2001:db8:1:abcd::5')).toBe(true); expect(match('2001:db8:2::1')).toBe(false);
  expect(match('not an address')).toBe(false); expect(match(undefined)).toBe(false);
  expect(parseTrustedProxies('::ffff:192.0.2.9')('192.0.2.9')).toBe(true);
  expect(parseTrustedProxies('::1')('::1')).toBe(true);
});
it('rejects malformed trusted proxy lists with a hint', () => {
  for (const bad of ['1', 'true', '', '10.0.0.1,', ',', '10.0.0.0/0', '10.0.0.0/33', '::/0', '2001:db8::/129', '10.0.0.1/8', '10.0.0.0/08', 'fe80::1%eth0', '10.0.0.0/8/8', 'x.y.z.w', '10.0.0.0/a']) {
    expect(() => parseTrustedProxies(bad), bad).toThrow(expect.objectContaining({ hint: expect.stringContaining('SHELLHERD_SERVER_TRUSTED_PROXY') }));
  }
});
