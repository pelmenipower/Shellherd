import { afterEach, describe, expect, it } from 'vitest';
import type { ConnectionNode } from '../../shared/vault/types';
import { MAX_SSH_SESSIONS } from '../../shared/ssh';
import { i18n } from './i18n';
import { disabledNotice, sessionLimitNotice, skippedNotice } from './vault-notices';

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

  it('states the session limit', () => {
    expect(sessionLimitNotice()).toBe(`Maximal ${MAX_SSH_SESSIONS} Sessions. Schließe zuerst einen Tab.`);
  });

  it('follows the UI language', async () => {
    await i18n.changeLanguage('en-US');
    expect(skippedNotice(1)).toBe('1 disabled connection was skipped.');
    expect(skippedNotice(2)).toBe('2 disabled connections were skipped.');
    expect(disabledNotice(node)).toContain('“Prod”');
    expect(sessionLimitNotice()).toContain(String(MAX_SSH_SESSIONS));
  });
});
