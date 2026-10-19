import { afterEach, describe, expect, it } from 'vitest';
import type { ConnectionNode } from '../../shared/vault/types';
import { MAX_SSH_SESSIONS } from '../../shared/ssh';
import { i18n } from './i18n';
import { disabledNotice, disabledTitle, sessionLimitNotice, sessionLimitText, skippedNotice } from './vault-notices';

const node = { name: 'Prod' } as ConnectionNode;

afterEach(async () => { await i18n.changeLanguage('de-DE'); });

describe('vault notices', () => {
  it('names the disabled connection', () => {
    expect(disabledNotice(node)).toBe('Die Verbindung „Prod“ ist deaktiviert. Per Rechtsklick → „Aktivieren“ wieder freigeben.');
  });

  it('pluralises skipped connections', () => {
    expect(skippedNotice(1)).toBe('1 deaktivierte Verbindung wurde übersprungen.');
    expect(skippedNotice(3)).toBe('3 deaktivierte Verbindungen wurden übersprungen.');
  });

  it('states the session limit as title and body (audit wording)', () => {
    expect(sessionLimitNotice()).toEqual({ title: `Maximal ${MAX_SSH_SESSIONS} Sessions`, body: 'Schließe zuerst einen Tab.' });
    expect(sessionLimitText()).toBe(`Maximal ${MAX_SSH_SESSIONS} Sessions gleichzeitig. Schließe zuerst einen Tab.`);
    expect(sessionLimitText(4)).toBe('Maximal 4 Sessions gleichzeitig. Schließe zuerst einen Tab.');
    expect(disabledTitle()).toBe('Verbindung deaktiviert');
  });

  it('follows the UI language', async () => {
    await i18n.changeLanguage('en-US');
    expect(skippedNotice(1)).toBe('1 disabled connection was skipped.');
    expect(skippedNotice(2)).toBe('2 disabled connections were skipped.');
    expect(disabledNotice(node)).toContain('“Prod”');
    expect(sessionLimitNotice().title).toContain(String(MAX_SSH_SESSIONS));
  });
});
