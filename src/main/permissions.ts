import { app, type Session } from 'electron';

export interface PermissionContext {
  remoteLabEnabled: boolean;
  /** Granted and not yet consumed for this webContents. */
  captureGranted(webContentsId: number): boolean;
  /** Fallback path B only: a screen-capture request consumes the grant; true once. */
  consumeCapture?(webContentsId: number): boolean;
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

/** Request handler decision: synchronous, never opens a dialog. Path B additionally consumes the grant. */
export function decidePermissionRequest(
  permission: string,
  details: PermissionDetails,
  webContentsId: number | null,
  ctx: PermissionContext,
): boolean {
  if (!decidePermission(permission, details, webContentsId, 'request', ctx)) return false;
  return ctx.consumeCapture && webContentsId !== null ? ctx.consumeCapture(webContentsId) : true;
}

/** No app hook here; a session without the lab also gets an explicit deny display-media handler (K16). */
export function registerPermissionHandlers(target: Session, ctx: PermissionContext): void {
  target.setPermissionRequestHandler((wc, permission, callback, details) => {
    let allowed = false;
    try { allowed = decidePermissionRequest(permission, details as PermissionDetails, wc.id, ctx); } catch { /* deny */ }
    try { callback(allowed); } catch { /* frame destroyed meanwhile */ }
  });
  target.setPermissionCheckHandler((wc, permission, _origin, details) =>
    decidePermission(permission, details as PermissionDetails, wc?.id ?? null, 'check', ctx));
  target.setDevicePermissionHandler(() => false);
  if (!ctx.remoteLabEnabled) target.setDisplayMediaRequestHandler((_request, callback) => callback({}));
  for (const ev of ['select-hid-device', 'select-serial-port', 'select-usb-device'] as const) {
    target.on(ev as never, ((e: { preventDefault(): void }, _d: unknown, cb: () => void) => {
      e.preventDefault();
      cb();
    }) as never);
  }
}

let guardsRegistered = false;

/** Bluetooth picker guard for every web contents; registered once per process. */
export function registerGlobalDeviceGuards(): void {
  if (guardsRegistered) return;
  guardsRegistered = true;
  app.on('web-contents-created', (_e, wc) => {
    wc.on('select-bluetooth-device', (e, _list, cb) => {
      e.preventDefault();
      cb('');
    });
  });
}
