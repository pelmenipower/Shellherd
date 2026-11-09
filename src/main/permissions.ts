import { app, type Session } from 'electron';

export interface PermissionContext {
  remoteLabEnabled: boolean;
  captureArmed(webContentsId: number): boolean;
}

export interface PermissionDetails {
  isMainFrame?: boolean;
  mediaTypes?: readonly string[];
  mediaType?: string;
}

/** Deny-by-default; only screen capture for an armed Remote Lab session in the main frame passes. */
export function decidePermission(
  permission: string,
  details: PermissionDetails,
  webContentsId: number | null,
  kind: 'request' | 'check',
  ctx: PermissionContext,
): boolean {
  if (webContentsId === null) return false;
  const armed = ctx.remoteLabEnabled && details.isMainFrame === true && ctx.captureArmed(webContentsId);
  if (permission === 'display-capture') return armed;
  if (permission === 'media') {
    if (kind === 'request') {
      // getDisplayMedia arrives with an empty list; camera/mic carry DEVICE_* types.
      if (details.mediaTypes?.some(t => t === 'audio' || t === 'video')) return false;
      return armed;
    }
    if (details.mediaType === 'audio') return false;
    return armed;
  }
  return false;
}

export function registerPermissionHandlers(target: Session, ctx: PermissionContext): void {
  target.setPermissionRequestHandler((wc, permission, callback, details) => {
    callback(decidePermission(permission, details as PermissionDetails, wc.id, 'request', ctx));
  });
  target.setPermissionCheckHandler((wc, permission, _origin, details) =>
    decidePermission(permission, details as PermissionDetails, wc?.id ?? null, 'check', ctx));
  target.setDevicePermissionHandler(() => false);
  for (const ev of ['select-hid-device', 'select-serial-port', 'select-usb-device'] as const) {
    target.on(ev as never, ((e: { preventDefault(): void }, _d: unknown, cb: () => void) => {
      e.preventDefault();
      cb();
    }) as never);
  }
  app.on('web-contents-created', (_e, wc) => {
    wc.on('select-bluetooth-device', (e, _list, cb) => {
      e.preventDefault();
      cb('');
    });
  });
}
