import { app, type Session } from 'electron';

export interface PermissionContext {
  remoteLabEnabled: boolean;
  /** Native consent was given for the current session of this web contents. */
  captureGranted(webContentsId: number): boolean;
  /** Runs the native consent dialog (once per session); resolves true only on acceptance. */
  requestCapture(webContentsId: number): Promise<boolean>;
}

export interface PermissionDetails {
  isMainFrame?: boolean;
  mediaTypes?: readonly string[];
  mediaType?: string;
}

/** Screen capture requests: display-capture, or media with an empty list (getDisplayMedia, or desktop getUserMedia). */
function isScreenCapture(permission: string, details: PermissionDetails, kind: 'request' | 'check'): boolean {
  if (permission === 'display-capture') return true;
  if (permission !== 'media') return false;
  // Camera/mic carry DEVICE_* types; desktop audio is never allowed. The check only passes for video (E1).
  if (kind === 'request') return !details.mediaTypes?.some(t => t === 'audio' || t === 'video');
  return details.mediaType === 'video';
}

/** Deny-by-default; screen capture passes only after native consent for the current session, in the main frame. */
export function decidePermission(
  permission: string,
  details: PermissionDetails,
  webContentsId: number | null,
  kind: 'request' | 'check',
  ctx: PermissionContext,
): boolean {
  if (webContentsId === null || !ctx.remoteLabEnabled || details.isMainFrame !== true) return false;
  return isScreenCapture(permission, details, kind) && ctx.captureGranted(webContentsId);
}

/** Request handler decision: asks the native dialog first when consent is still missing. Never throws. */
export async function decidePermissionRequest(
  permission: string,
  details: PermissionDetails,
  webContentsId: number | null,
  ctx: PermissionContext,
): Promise<boolean> {
  if (decidePermission(permission, details, webContentsId, 'request', ctx)) return true;
  if (webContentsId === null || !ctx.remoteLabEnabled || details.isMainFrame !== true || !isScreenCapture(permission, details, 'request')) return false;
  try {
    return (await ctx.requestCapture(webContentsId)) && ctx.captureGranted(webContentsId);
  } catch {
    return false;
  }
}

export function registerPermissionHandlers(target: Session, ctx: PermissionContext): void {
  target.setPermissionRequestHandler((wc, permission, callback, details) => {
    void decidePermissionRequest(permission, details as PermissionDetails, wc.id, ctx).then(allowed => {
      try { callback(allowed); } catch { /* frame destroyed meanwhile */ }
    });
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
