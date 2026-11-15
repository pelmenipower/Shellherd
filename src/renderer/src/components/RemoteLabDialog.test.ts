// @vitest-environment node
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RemoteLabState } from '../../../shared/remote-lab';
import type { RemoteSessionController } from '../remote-peer';
import { RemoteLabDialog } from './RemoteLabDialog';

function render(state: RemoteLabState): string {
  const controller = { view: { state }, subscribe: () => () => {}, act: async () => ({ ok: true, state }), clearError: () => {}, stop: () => {} } as unknown as RemoteSessionController;
  return renderToStaticMarkup(createElement(RemoteLabDialog, { controller, onClose: () => {} }));
}

describe('RemoteLabDialog sign-in', () => {
  const server = { serverUrl: 'https://a.example', serverId: 's' };
  it('asks for username, password and device name when not enrolled', () => {
    const markup = render({ phase: 'serverReady', server });
    expect(markup).toContain('Name dieses Geräts');
    expect(markup).not.toContain('Sitzung öffnen');
  });
  it('offers "Sitzung öffnen" without password when enrolled', () => {
    const markup = render({ phase: 'serverReady', server, enrolled: { username: 'u', name: 'Laptop' } });
    expect(markup).toContain('Sitzung öffnen');
    expect(markup).not.toContain('type="password"');
  });
  it('shows the old URL for enrolledElsewhere and the temporary identity before going online', () => {
    const markup = render({ phase: 'serverReady', server, enrolledElsewhere: 'https://old.example', identity: { fingerprint: 'a'.repeat(64), persistent: false } });
    expect(markup).toContain('https://old.example');
    expect(markup).toContain('Temporäre Geräteidentität');
  });
});
