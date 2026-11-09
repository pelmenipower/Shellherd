// @vitest-environment node
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RecoveryCodeNotice, SyncDeviceList, SyncLabDialog } from './SyncLabDialog';

const CODE = '0123456789abcdef0123456789abcdef';
const device = (over: Record<string, unknown>) => ({ id: 'x', name: 'Laptop', enrolledAt: 1, revokedAt: null, ephemeral: false, self: false, ...over });
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
