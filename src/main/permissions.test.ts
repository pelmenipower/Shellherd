import { describe, expect, it, vi } from 'vitest';

const appOn = vi.fn();
vi.mock('electron', () => ({ app: { on: (...a: unknown[]) => appOn(...a) } }));

import { decidePermission, decidePermissionRequest, registerGlobalDeviceGuards, registerPermissionHandlers, type PermissionContext } from './permissions';

const ctx = (over: Partial<PermissionContext> = {}, granted = true): PermissionContext => ({
  remoteLabEnabled: true,
  captureGranted: () => granted,
  ...over,
});

const OTHER = [
  'clipboard-read', 'clipboard-sanitized-write', 'display-capture-x', 'fullscreen', 'geolocation', 'idle-detection',
  'keyboardLock', 'mediaKeySystem', 'midi', 'midiSysex', 'notifications', 'pointerLock', 'openExternal',
  'speaker-selection', 'storage-access', 'top-level-storage-access', 'window-management', 'unknown',
  'fileSystem', 'hid', 'serial', 'usb', 'bluetooth', 'local-fonts', 'deprecated-sync-clipboard-read',
];

describe('decidePermission', () => {
  it.each(OTHER)('denies %s even when granted', p => {
    for (const kind of ['request', 'check'] as const) {
      expect(decidePermission(p, { isMainFrame: true }, 1, kind, ctx())).toBe(false);
    }
  });

  it('display-capture only with lab + main frame + granted', () => {
    const d = { isMainFrame: true };
    expect(decidePermission('display-capture', d, 1, 'request', ctx())).toBe(true);
    expect(decidePermission('display-capture', d, 1, 'check', ctx())).toBe(true);
    expect(decidePermission('display-capture', d, 1, 'request', ctx({ remoteLabEnabled: false }))).toBe(false);
    expect(decidePermission('display-capture', { isMainFrame: false }, 1, 'request', ctx())).toBe(false);
    expect(decidePermission('display-capture', {}, 1, 'request', ctx())).toBe(false);
    expect(decidePermission('display-capture', d, 1, 'request', ctx({}, false))).toBe(false);
  });

  it('passes the web contents id to captureGranted', () => {
    const captureGranted = vi.fn(() => true);
    decidePermission('display-capture', { isMainFrame: true }, 7, 'request', ctx({ captureGranted }));
    expect(captureGranted).toHaveBeenCalledWith(7);
  });

  it('media request: camera/mic denied, empty list follows granted', () => {
    const d = { isMainFrame: true };
    expect(decidePermission('media', { ...d, mediaTypes: ['video'] }, 1, 'request', ctx())).toBe(false);
    expect(decidePermission('media', { ...d, mediaTypes: ['audio'] }, 1, 'request', ctx())).toBe(false);
    expect(decidePermission('media', { ...d, mediaTypes: ['audio', 'video'] }, 1, 'request', ctx())).toBe(false);
    expect(decidePermission('media', { ...d, mediaTypes: [] }, 1, 'request', ctx())).toBe(true);
    expect(decidePermission('media', d, 1, 'request', ctx())).toBe(true);
    expect(decidePermission('media', { ...d, mediaTypes: [] }, 1, 'request', ctx({}, false))).toBe(false);
    expect(decidePermission('media', { ...d, mediaTypes: [] }, 1, 'request', ctx({ remoteLabEnabled: false }))).toBe(false);
  });

  it('media check: only video follows granted; audio, unknown and missing are denied', () => {
    const d = { isMainFrame: true };
    expect(decidePermission('media', { ...d, mediaType: 'audio' }, 1, 'check', ctx())).toBe(false);
    expect(decidePermission('media', { ...d, mediaType: 'unknown' }, 1, 'check', ctx())).toBe(false);
    expect(decidePermission('media', { ...d, mediaType: 'video' }, 1, 'check', ctx())).toBe(true);
    expect(decidePermission('media', { ...d, mediaType: 'video' }, 1, 'check', ctx({}, false))).toBe(false);
    expect(decidePermission('media', d, 1, 'check', ctx())).toBe(false);
  });

  it('null web contents id is denied', () => {
    expect(decidePermission('display-capture', { isMainFrame: true }, null, 'check', ctx())).toBe(false);
    expect(decidePermission('media', { isMainFrame: true }, null, 'check', ctx())).toBe(false);
  });
});

describe('decidePermissionRequest', () => {
  const d = { isMainFrame: true, mediaTypes: [] };

  it('is synchronous and equals decidePermission (path A)', () => {
    expect(decidePermissionRequest('media', d, 1, ctx())).toBe(true);
    expect(decidePermissionRequest('display-capture', d, 1, ctx({}, false))).toBe(false);
    expect(decidePermissionRequest('geolocation', d, 1, ctx())).toBe(false);
    expect(decidePermissionRequest('media', { isMainFrame: true, mediaTypes: ['audio'] }, 1, ctx())).toBe(false);
    expect(decidePermissionRequest('media', { isMainFrame: false, mediaTypes: [] }, 1, ctx())).toBe(false);
    expect(decidePermissionRequest('media', d, null, ctx())).toBe(false);
    expect(decidePermissionRequest('media', d, 1, ctx({ remoteLabEnabled: false }))).toBe(false);
  });

  it('path B: the request consumes the grant once', () => {
    let granted = true;
    const consumeCapture = vi.fn(() => { const was = granted; granted = false; return was; });
    const c = ctx({ captureGranted: () => granted, consumeCapture });
    expect(decidePermissionRequest('media', d, 4, c)).toBe(true);
    expect(consumeCapture).toHaveBeenCalledWith(4);
    expect(decidePermissionRequest('media', d, 4, c)).toBe(false);
    expect(consumeCapture).toHaveBeenCalledTimes(1);
  });

  it('path B: a denied request never consumes', () => {
    const consumeCapture = vi.fn(() => true);
    expect(decidePermissionRequest('geolocation', d, 1, ctx({ consumeCapture }))).toBe(false);
    expect(consumeCapture).not.toHaveBeenCalled();
  });
});

describe('registerPermissionHandlers', () => {
  const fake = () => {
    const s = {
      on: vi.fn(), setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(),
      setDevicePermissionHandler: vi.fn(), setDisplayMediaRequestHandler: vi.fn(),
    };
    return s;
  };

  it('registers all handlers and blocks device pickers, without an app hook', () => {
    appOn.mockClear();
    const s = fake();
    registerPermissionHandlers(s as never, ctx());
    const req = s.setPermissionRequestHandler.mock.calls[0][0];
    const cb = vi.fn();
    req({ id: 3 }, 'display-capture', cb, { isMainFrame: true });
    expect(cb).toHaveBeenLastCalledWith(true);
    req({ id: 3 }, 'geolocation', cb, { isMainFrame: true });
    expect(cb).toHaveBeenLastCalledWith(false);
    const check = s.setPermissionCheckHandler.mock.calls[0][0];
    expect(check({ id: 3 }, 'display-capture', 'o', { isMainFrame: true })).toBe(true);
    expect(check(null, 'display-capture', 'o', { isMainFrame: true })).toBe(false);
    expect(s.setDevicePermissionHandler.mock.calls[0][0]()).toBe(false);
    expect(s.on.mock.calls.map(c => c[0])).toEqual(['select-hid-device', 'select-serial-port', 'select-usb-device']);
    for (const [, h] of s.on.mock.calls) {
      const e = { preventDefault: vi.fn() };
      const c = vi.fn();
      h(e, {}, c);
      expect(e.preventDefault).toHaveBeenCalled();
      expect(c).toHaveBeenCalledWith();
    }
    expect(appOn).not.toHaveBeenCalled();
    expect(s.setDisplayMediaRequestHandler).not.toHaveBeenCalled();
  });

  it('never opens a dialog and survives a throwing context', () => {
    const s = fake();
    registerPermissionHandlers(s as never, ctx({ captureGranted: () => { throw new Error('x'); } }));
    const cb = vi.fn();
    s.setPermissionRequestHandler.mock.calls[0][0]({ id: 1 }, 'display-capture', cb, { isMainFrame: true });
    expect(cb).toHaveBeenCalledWith(false);
  });

  it('a session without the lab refuses all capture and gets a deny display-media handler', () => {
    const s = fake();
    registerPermissionHandlers(s as never, { remoteLabEnabled: false, captureGranted: () => false });
    const cb = vi.fn();
    s.setDisplayMediaRequestHandler.mock.calls[0][0]({}, cb);
    expect(cb).toHaveBeenCalledWith({});
    const req = s.setPermissionRequestHandler.mock.calls[0][0];
    req({ id: 1 }, 'display-capture', cb, { isMainFrame: true });
    expect(cb).toHaveBeenLastCalledWith(false);
  });
});

describe('registerGlobalDeviceGuards', () => {
  it('hooks web-contents-created once and blocks the bluetooth picker', () => {
    appOn.mockClear();
    registerGlobalDeviceGuards();
    registerGlobalDeviceGuards();
    expect(appOn).toHaveBeenCalledTimes(1);
    expect(appOn.mock.calls[0][0]).toBe('web-contents-created');
    const wcOn = vi.fn();
    appOn.mock.calls[0][1]({}, { on: wcOn });
    expect(wcOn.mock.calls[0][0]).toBe('select-bluetooth-device');
    const e = { preventDefault: vi.fn() };
    const c = vi.fn();
    wcOn.mock.calls[0][1](e, [], c);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(c).toHaveBeenCalledWith('');
  });
});
