import { describe, expect, it } from 'vitest';
import { ACTION_LABELS, DETAIL_LIMIT, connectionError, splitAddress, type ConnectionErrorCode } from './connection-errors';

const codes: ConnectionErrorCode[] = ['auth', 'timeout', 'hostkey-changed', 'hostkey-rejected', 'hostkey-store',
  'refused', 'not-found', 'key-file', 'agent', 'limit', 'closed-by-server', 'unknown'];
const ctx = { address: 'deploy@10.0.4.21:22', remote: true };

describe('connectionError', () => {
  it('gives every code a title, body and primary action', () => {
    for (const code of codes) {
      const text = connectionError(code, ctx);
      expect(text.title).not.toBe('');
      expect(text.body).not.toBe('');
      expect(ACTION_LABELS[text.primary]).toBeTruthy();
    }
  });
  it('names the user for auth and stays neutral without one', () => {
    expect(connectionError('auth', ctx).body).toBe('Der Server hat die Anmeldung als „deploy“ nicht angenommen.');
    expect(connectionError('auth', { address: '10.0.4.21:22', remote: true }).body).toBe('Der Server hat die Anmeldung nicht angenommen.');
    expect(connectionError('auth', ctx)).toMatchObject({ primary: 'edit', secondary: 'retry' });
  });
  it('uses host and port in timeout, rejected and refused', () => {
    expect(connectionError('timeout', ctx).body).toBe('10.0.4.21:22 hat nicht rechtzeitig geantwortet.');
    expect(connectionError('hostkey-rejected', ctx).body).toBe('Du hast den Schlüssel von 10.0.4.21:22 nicht bestätigt.');
    expect(connectionError('refused', ctx).body).toBe('10.0.4.21 nimmt auf Port 22 keine Verbindung an.');
    expect(connectionError('refused', { address: 'deploy@10.0.4.21', remote: true }).body).toBe('10.0.4.21 nimmt keine Verbindung an.');
    expect(connectionError('not-found', ctx).body).toBe('Der Name „10.0.4.21“ ließ sich nicht auflösen.');
  });
  it('offers the fingerprint copy for a changed key', () => {
    expect(connectionError('hostkey-changed', ctx)).toMatchObject({ primary: 'copy', secondary: 'retry' });
  });
  it('uses message for hostkey-store and unknown, with fallbacks', () => {
    expect(connectionError('hostkey-store', { ...ctx, message: 'Datei kaputt' }).body).toBe('Datei kaputt');
    expect(connectionError('hostkey-store', ctx).body).toBe('Die gespeicherten Server-Schlüssel sind nicht verfügbar.');
    expect(connectionError('unknown', { ...ctx, message: 'Boom' }).body).toBe('Boom');
    expect(connectionError('unknown', ctx).body).toBe('Die Verbindung ist fehlgeschlagen.');
  });
  it('gives unknown a next step only for remote connections', () => {
    expect(connectionError('unknown', ctx).next).toBe('Prüfe Host, Benutzer und Anmeldung.');
    expect(connectionError('unknown', { address: 'Lokal · CMD', remote: false }).next).toBeUndefined();
    expect(connectionError('unknown', ctx)).toMatchObject({ primary: 'retry', secondary: 'edit' });
  });
  it('titles the limit with the session maximum', () => {
    expect(connectionError('limit', ctx)).toMatchObject({ title: 'Maximal 16 Sessions', body: 'Alle Sessions sind belegt.', primary: 'retry' });
  });
  it('exports labels and limit', () => {
    expect(ACTION_LABELS).toEqual({ retry: 'Erneut verbinden', edit: 'Verbindung bearbeiten', copy: 'Fingerprint kopieren' });
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
