import { describe, expect, it, vi } from 'vitest';

const appOn = vi.fn();
vi.mock('electron', () => ({ app: { on: (...a: unknown[]) => appOn(...a) } }));

import { decidePermission, registerPermissionHandlers, type PermissionContext } from './permissions';

const ctx = (over: Partial<PermissionContext> = {}, armed = true): PermissionContext => ({
  remoteLabEnabled: true,
  captureArmed: () => armed,
  ...over,
});

const OTHER = [
  'clipboard-read', 'clipboard-sanitized-write', 'display-capture-x', 'fullscreen', 'geolocation', 'idle-detection',
  'keyboardLock', 'mediaKeySystem', 'midi', 'midiSysex', 'notifications', 'pointerLock', 'openExternal',
  'speaker-selection', 'storage-access', 'top-level-storage-access', 'window-management', 'unknown',
  'fileSystem', 'hid', 'serial', 'usb', 'bluetooth', 'local-fonts', 'deprecated-sync-clipboard-read',
];

describe('decidePermission', () => {
  it.each(OTHER)('denies %s even when armed', p => {
    for (const kind of ['request', 'check'] as const) {
      expect(decidePermission(p, { isMainFrame: true }, 1, kind, ctx())).toBe(false);
    }
  });

  it('display-capture only with lab + main frame + armed', () => {
    const d = { isMainFrame: true };
    expect(decidePermission('display-capture', d, 1, 'request', ctx())).toBe(true);
    expect(decidePermission('display-capture', d, 1, 'check', ctx())).toBe(true);
    expect(decidePermission('display-capture', d, 1, 'request', ctx({ remoteLabEnabled: false }))).toBe(false);
    expect(decidePermission('display-capture', { isMainFrame: false }, 1, 'request', ctx())).toBe(false);
    expect(decidePermission('display-capture', {}, 1, 'request', ctx())).toBe(false);
    expect(decidePermission('display-capture', d, 1, 'request', ctx({}, false))).toBe(false);
  });

  it('passes the web contents id to captureArmed', () => {
    const captureArmed = vi.fn(() => true);
    decidePermission('display-capture', { isMainFrame: true }, 7, 'request', ctx({ captureArmed }));
    expect(captureArmed).toHaveBeenCalledWith(7);
  });

  it('media request: camera/mic denied, empty list follows armed', () => {
    const d = { isMainFrame: true };
    expect(decidePermission('media', { ...d, mediaTypes: ['video'] }, 1, 'request', ctx())).toBe(false);
    expect(decidePermission('media', { ...d, mediaTypes: ['audio'] }, 1, 'request', ctx())).toBe(false);
    expect(decidePermission('media', { ...d, mediaTypes: ['audio', 'video'] }, 1, 'request', ctx())).toBe(false);
    expect(decidePermission('media', { ...d, mediaTypes: [] }, 1, 'request', ctx())).toBe(true);
    expect(decidePermission('media', d, 1, 'request', ctx())).toBe(true);
    expect(decidePermission('media', { ...d, mediaTypes: [] }, 1, 'request', ctx({}, false))).toBe(false);
    expect(decidePermission('media', { ...d, mediaTypes: [] }, 1, 'request', ctx({ remoteLabEnabled: false }))).toBe(false);
  });

  it('media check: audio denied, others follow armed', () => {
    const d = { isMainFrame: true };
    expect(decidePermission('media', { ...d, mediaType: 'audio' }, 1, 'check', ctx())).toBe(false);
    expect(decidePermission('media', { ...d, mediaType: 'video' }, 1, 'check', ctx())).toBe(true);
    expect(decidePermission('media', d, 1, 'check', ctx())).toBe(true);
    expect(decidePermission('media', d, 1, 'check', ctx({}, false))).toBe(false);
  });

  it('null web contents id is denied', () => {
    expect(decidePermission('display-capture', { isMainFrame: true }, null, 'check', ctx())).toBe(false);
    expect(decidePermission('media', { isMainFrame: true }, null, 'check', ctx())).toBe(false);
  });
});

describe('registerPermissionHandlers', () => {
  it('registers all handlers and blocks device pickers', () => {
    appOn.mockClear();
    const on = vi.fn();
    const setPermissionRequestHandler = vi.fn();
    const setPermissionCheckHandler = vi.fn();
    const setDevicePermissionHandler = vi.fn();
    const session = { on, setPermissionRequestHandler, setPermissionCheckHandler, setDevicePermissionHandler };
    registerPermissionHandlers(session as never, ctx());

    const req = setPermissionRequestHandler.mock.calls[0][0];
    const cb = vi.fn();
    req({ id: 3 }, 'display-capture', cb, { isMainFrame: true });
    expect(cb).toHaveBeenCalledWith(true);
    req({ id: 3 }, 'geolocation', cb, { isMainFrame: true });
    expect(cb).toHaveBeenLastCalledWith(false);

    const check = setPermissionCheckHandler.mock.calls[0][0];
    expect(check({ id: 3 }, 'display-capture', 'o', { isMainFrame: true })).toBe(true);
    expect(check(null, 'display-capture', 'o', { isMainFrame: true })).toBe(false);

    expect(setDevicePermissionHandler.mock.calls[0][0]()).toBe(false);

    const events = on.mock.calls.map(c => c[0]);
    expect(events).toEqual(['select-hid-device', 'select-serial-port', 'select-usb-device']);
    for (const [, h] of on.mock.calls) {
      const e = { preventDefault: vi.fn() };
      const c = vi.fn();
      h(e, {}, c);
      expect(e.preventDefault).toHaveBeenCalled();
      expect(c).toHaveBeenCalledWith();
    }

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
