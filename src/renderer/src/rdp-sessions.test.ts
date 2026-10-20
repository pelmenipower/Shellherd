import { afterEach, describe, expect, it } from 'vitest';
import { i18n } from './i18n';
import { rdpActionLabel } from './rdp-sessions';

afterEach(async () => { await i18n.changeLanguage('de-DE'); });

describe('rdpActionLabel', () => {
  it('keeps the German labels', () => {
    expect(rdpActionLabel('ctrlAltDel')).toEqual({ label: 'Strg+Alt+Entf', hint: 'Sicherheitsoptionen' });
    expect(rdpActionLabel('taskManager')).toEqual({ label: 'Task-Manager', hint: 'Strg+Umschalt+Esc' });
    expect(rdpActionLabel('startScreen').label).toBe('Startmenü');
  });
  it('translates labels and key words in English', async () => {
    await i18n.changeLanguage('en-US');
    expect(rdpActionLabel('ctrlAltDel')).toEqual({ label: 'Ctrl+Alt+Del', hint: 'Security options' });
    expect(rdpActionLabel('taskManager').hint).toBe('Ctrl+Shift+Esc');
  });
});
