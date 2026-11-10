// @vitest-environment node
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RemoteLabSession } from '../../../shared/remote-lab';
import type { RemoteSessionController } from '../remote-peer';
import { RemoteConsentDialog } from './RemoteConsentDialog';

afterEach(() => { vi.unstubAllGlobals(); });

function render(platform: string, patch: Partial<RemoteLabSession> = {}): string {
  vi.stubGlobal('window', { desktopApi: { capabilities: { platform } } });
  const session: RemoteLabSession = {
    id: 's', role: 'agent', peer: { id: 'p', name: 'Büro', known: { firstSeen: 1, verified: true } }, scope: 'view',
    state: 'consent', expiresAt: Date.now() + 60000, ...patch
  };
  const controller = { view: {}, act: async () => ({ ok: true }), share: async () => {} } as unknown as RemoteSessionController;
  return renderToStaticMarkup(createElement(RemoteConsentDialog, { controller, session }));
}

describe('RemoteConsentDialog', () => {
  it('shows the Windows hint only on win32', () => {
    expect(render('win32')).toContain('Unter Windows nimmt Shellherd');
    expect(render('linux')).not.toContain('Unter Windows nimmt Shellherd');
    expect(render('darwin')).not.toContain('Unter Windows nimmt Shellherd');
  });
  it('shows the Linux hint only on linux', () => {
    expect(render('linux')).toContain('Unter Linux bleibt');
    expect(render('win32')).not.toContain('Unter Linux bleibt');
  });
  it('shows the armed hint and keeps the accept button disabled while armed', () => {
    const armed = render('win32', { armed: true });
    expect(armed).toContain('Der Systemdialog erscheint gleich');
    expect(render('win32')).not.toContain('Der Systemdialog erscheint gleich');
    const button = (markup: string): string => /<button[^>]*primary-button[^>]*>/.exec(markup)![0];
    expect(button(armed)).toContain('disabled');
  });
});
