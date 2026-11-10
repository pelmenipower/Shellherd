// @vitest-environment node
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DeviceNotices, EnrolledElsewhere, InviteCodeNotice, RotateConfirm, RemoveForeign, RecoveryCodeNotice, SyncDeviceList, SyncLabDialog } from './SyncLabDialog';

const CODE = '0123456789abcdef0123456789abcdef';
const device = (over: Record<string, unknown>) => ({ id: 'x', name: 'Laptop', enrolledAt: 1, revokedAt: null, ephemeral: false, self: false, enrolledVia: 'password' as const, ...over });
const html = (devices: ReturnType<typeof device>[]) => renderToStaticMarkup(createElement(SyncDeviceList, { devices, busy: false, onRevoke: () => {} }));

describe('RecoveryCodeNotice', () => {
  const markup = renderToStaticMarkup(createElement(RecoveryCodeNotice, { code: CODE, onNoted: () => {} }));
  it('shows the grouped code once with the noted button and no copy button', () => {
    expect(markup).toContain('0123-4567-89ab-cdef-0123-4567-89ab-cdef');
    expect(markup).toContain('sync-lab-code');
    expect(markup).toContain('Ich habe den Code notiert');
    expect(markup.match(/<button/g)).toHaveLength(1);
  });
});

describe('SyncLabDialog', () => {
  it('has no recovery code in a fresh render (also after close and reopen) and no state leak', () => {
    const open = () => renderToStaticMarkup(createElement(SyncLabDialog, { onClose: () => {}, onVaultChanged: () => {} }));
    for (const markup of [open(), open()]) {
      expect(markup).not.toContain('sync-lab-code');
      expect(markup).not.toContain('0123');
      expect(markup).not.toContain('Wiederherstellungscode');
    }
  });
});

describe('SyncDeviceList', () => {
  it('offers removal only for other, active devices', () => {
    expect(html([device({ self: true })])).not.toContain('Entfernen');
    expect(html([device({ revokedAt: 9 })])).not.toContain('Entfernen');
    expect(html([device({})]).match(/Entfernen/g)).toHaveLength(1);
  });
  it('marks self, temporary and removed devices and keeps server order', () => {
    const markup = html([device({ id: 'b', name: 'Zed', self: true }), device({ id: 'a', name: 'Amy', ephemeral: true, revokedAt: 3 })]);
    expect(markup).toContain('dieses Gerät');
    expect(markup).toContain('temporär');
    expect(markup).toContain('entfernt');
    expect(markup.indexOf('Zed')).toBeLessThan(markup.indexOf('Amy'));
  });
});

describe('H3.1 confirmations', () => {
  it('shows the warning with the old URL and an unchecked confirmation checkbox (C1)', () => {
    const markup = renderToStaticMarkup(createElement(EnrolledElsewhere, { url: 'https://old.example.net/', confirmed: false, busy: false, onChange: () => {} }));
    expect(markup).toContain('https://old.example.net/');
    expect(markup).toContain('Server-ID meldet');
    expect(markup).toContain('Ich habe die Adresse geprüft');
    expect(markup).toMatch(/type="checkbox"/);
    expect(markup).not.toContain('checked=""');
    expect(renderToStaticMarkup(createElement(EnrolledElsewhere, { url: 'u', confirmed: true, busy: false, onChange: () => {} }))).toContain('checked=""');
  });
  it('asks before the sync key is renewed with a yes and a cancel button (C2)', () => {
    const markup = renderToStaticMarkup(createElement(RotateConfirm, { busy: false, onYes: () => {}, onCancel: () => {} }));
    expect(markup).toContain('Sync-Schlüssel erneuern?');
    expect(markup).toContain('Jetzt erneuern');
    expect(markup).toContain('Abbrechen');
    expect(markup.match(/<button/g)).toHaveLength(2);
  });
  it('offers the foreign-versions opt-in and shows its warning only when checked (B8)', () => {
    const view = (versions: boolean) => renderToStaticMarkup(createElement(RemoveForeign, { versions, busy: false, onVersions: () => {}, onRemove: () => {} }));
    expect(view(false)).toContain('Auch verschlüsselte Versionen entfernen');
    expect(view(false)).not.toContain('verliert damit seine Serverhistorie');
    expect(view(true)).toContain('verliert damit seine Serverhistorie');
  });
});

describe('H4 enrollment codes and roster notices', () => {
  it('shows the grouped enrollment code once with the done button and no copy button', () => {
    const markup = renderToStaticMarkup(createElement(InviteCodeNotice, { code: CODE, onDone: () => {} }));
    expect(markup).toContain('0123-4567-89ab-cdef-0123-4567-89ab-cdef');
    expect(markup).toContain('sync-lab-code');
    expect(markup).toContain('Ich habe den Code übertragen');
    expect(markup.match(/<button/g)).toHaveLength(1);
  });
  it('shows how each device joined behind its date', () => {
    const markup = html([device({ id: 'a', name: 'Amy' }), device({ id: 'b', name: 'Bob', enrolledVia: 'invite', invitedBy: 'Amy' }), device({ id: 'c', name: 'Cid', enrolledVia: 'invite' })]);
    expect(markup).toContain('angemeldet mit Serverpasswort');
    expect(markup).toContain('angemeldet mit Anmeldecode von Amy');
    expect(markup).toContain('angemeldet mit Anmeldecode eines nicht mehr bekannten Geräts');
  });
  it('shows a new-device notice with its origin and an acknowledge button, also for a revived device', () => {
    const markup = renderToStaticMarkup(createElement(DeviceNotices, { newDevices: [{ id: 'n', name: 'Phone', enrolledVia: 'invite', invitedBy: 'Amy' }], revived: [{ id: 'r', name: 'Tablet' }], busy: false, onAcknowledge: () => {} }));
    expect(markup).toContain('Neues Gerät im Konto: Phone (angemeldet mit Anmeldecode von Amy)');
    expect(markup).toContain('Tablet war entfernt und ist laut Server wieder aktiv');
    expect(markup.match(/Zur Kenntnis genommen/g)).toHaveLength(2);
  });
  it('shows an own-invitation device as a quiet info notice with an acknowledge button', () => {
    const markup = renderToStaticMarkup(createElement(DeviceNotices, { newDevices: [{ id: 'n', name: 'Phone', enrolledVia: 'invite', ownInvite: true }], revived: [], busy: false, onAcknowledge: () => {} }));
    expect(markup).toContain('Mit deinem Anmeldecode angemeldet: Phone');
    expect(markup).toContain('sync-lab-notice-info');
    expect(markup).toContain('role="status"');
    expect(markup).not.toContain('role="alert"');
    expect(markup).toContain('Zur Kenntnis genommen');
  });
  it('renders nothing without notices', () => {
    expect(renderToStaticMarkup(createElement(DeviceNotices, { newDevices: [], revived: [], busy: false, onAcknowledge: () => {} }))).toBe('');
  });
});
