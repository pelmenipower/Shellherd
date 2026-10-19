import { describe, expect, it } from 'vitest';
import { statusWord } from './status-words';

describe('statusWord', () => {
  it('short form', () => {
    expect(['connecting', 'connected', 'closed', 'error'].map(s => statusWord(s as never, 'short')))
      .toEqual(['Verbindet …', 'Verbunden', 'Getrennt', 'Fehler']);
  });
  it('long form without name', () => {
    expect(['connecting', 'connected', 'closed', 'error'].map(s => statusWord(s as never, 'long')))
      .toEqual(['Verbindet …', 'Verbunden', 'Verbindung getrennt', 'Verbindung fehlgeschlagen']);
  });
  it('long form with name only changes connecting', () => {
    expect(statusWord('connecting', 'long', { name: 'web-01' })).toBe('Verbinde mit web-01 …');
    expect(statusWord('closed', 'long', { name: 'web-01' })).toBe('Verbindung getrennt');
  });
  it('prefixes the protocol', () => {
    expect(statusWord('connected', 'long', { protocol: 'RDP' })).toBe('RDP: Verbunden');
    expect(statusWord('connecting', 'long', { protocol: 'SFTP' })).toBe('SFTP: Verbindet …');
  });
});
