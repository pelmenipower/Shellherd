import { describe, expect, it } from 'vitest';
import type { ConnectionErrorCode } from '../../shared/connection-errors';
import { actionLabel, connectionError } from './connection-error-text';
import { i18n } from './i18n';

const codes: ConnectionErrorCode[] = ['auth', 'timeout', 'hostkey-changed', 'hostkey-rejected', 'hostkey-store',
  'refused', 'not-found', 'key-file', 'agent', 'limit', 'closed-by-server', 'unknown'];
const ctx = { address: 'deploy@10.0.4.21:22', remote: true };

describe('connectionError', () => {
  it('gives every code a title, body and primary action', () => {
    for (const code of codes) {
      const text = connectionError(code, ctx);
      expect(text.title).not.toBe('');
      expect(text.body).not.toBe('');
      expect(actionLabel(text.primary)).toBeTruthy();
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
  it('uses the error text for hostkey-store and unknown, without the raw detail, with fallbacks', () => {
    const error = { code: 'ssh.hostKeysUnreadable' as const, detail: 'raw library text' };
    expect(connectionError('hostkey-store', { ...ctx, error }).body).toBe('Die gespeicherten Server-Schlüssel konnten nicht gelesen werden.');
    expect(connectionError('hostkey-store', ctx).body).toBe('Die gespeicherten Server-Schlüssel sind nicht verfügbar.');
    expect(connectionError('unknown', { ...ctx, error: { code: 'ssh.failed', detail: 'boom' } }).body)
      .toBe('Die SSH-Verbindung ist fehlgeschlagen. Prüfe Host, Benutzer und Authentifizierung.');
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
  it('labels the actions', () => {
    expect(['retry', 'edit', 'copy'].map(action => actionLabel(action as never))).toEqual(['Erneut verbinden', 'Verbindung bearbeiten', 'Fingerprint kopieren']);
  });
  it('follows the language', async () => {
    await i18n.changeLanguage('en-US');
    try {
      expect(connectionError('timeout', ctx).title).toBe('Server not responding');
      expect(actionLabel('retry')).toBe('Reconnect');
    } finally { await i18n.changeLanguage('de-DE'); }
  });
});
