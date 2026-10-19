import { describe, expect, it } from 'vitest';
import { DETAIL_LIMIT, splitAddress } from './connection-errors';

describe('connection-errors', () => {
  it('exports the detail limit', () => {
    expect(DETAIL_LIMIT).toBe(500);
  });
});

describe('splitAddress', () => {
  it('splits user, host and port', () => {
    expect(splitAddress('deploy@10.0.4.21:22')).toEqual({ user: 'deploy', host: '10.0.4.21', port: '22' });
  });
  it('handles missing user and port', () => {
    expect(splitAddress('10.0.4.21:22')).toEqual({ host: '10.0.4.21', port: '22' });
    expect(splitAddress('deploy@host')).toEqual({ user: 'deploy', host: 'host' });
    expect(splitAddress('Lokal · CMD')).toEqual({ host: 'Lokal · CMD' });
  });
  it('treats the digits after the last colon as port for IPv6', () => {
    expect(splitAddress('fe80::1:22')).toEqual({ host: 'fe80::1', port: '22' });
  });
});
