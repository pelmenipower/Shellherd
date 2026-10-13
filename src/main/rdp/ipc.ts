import { BrowserWindow, ipcMain, webContents } from 'electron';
import { join } from 'node:path';
import { z } from 'zod';
import { IPC_CHANNELS } from '../../shared/ipc';
import { findConnection } from '../ssh/session';
import { requireSshSender } from '../ssh/ipc';
import { vaultSessionManager } from '../vault/ipc';
import { RdpSessionManager } from './host';
import type { RdpSurfaceMode } from '../../shared/rdp';

const coordinate = z.number().finite().min(-100_000).max(100_000);
const Rect = z.object({ x: coordinate, y: coordinate, width: z.number().finite().min(0).max(100_000), height: z.number().finite().min(0).max(100_000) }).strict();
const session = { sessionId: z.string().uuid() };
const OpenSchema = z.object({ connectionId: z.string().min(1).max(256), bounds: Rect, visible: z.boolean() }).strict();
const SessionSchema = z.object(session).strict();
const BoundsSchema = z.object({ ...session, bounds: Rect }).strict();
const VisibleSchema = z.object({ ...session, visible: z.boolean() }).strict();
const HangSchema = z.object({ ms: z.number().int().min(0).max(30_000) }).strict();

function parse<T>(schema: z.ZodType<T>, request: unknown): T {
  const result = schema.safeParse(request);
  if (!result.success) throw new Error('Ungültige RDP-Anfrage.');
  return result.data;
}

export function rdpSurfaceMode(): RdpSurfaceMode {
  return process.env.TERMINUS_RDP_MODE === 'child' ? 'child' : 'owned';
}

export function registerRdpIpcHandlers(): RdpSessionManager {
  const manager = new RdpSessionManager({
    executable: join(__dirname, '../rdp-host/Terminus.RdpHost.exe'),
    // Owned surfaces (variant B) are the default: child windows (A) are hidden by Chromium's
    // DirectComposition and share the input queue with Terminus. A stays available for experiments.
    mode: rdpSurfaceMode(),
    getTarget: id => {
      const connection = findConnection(vaultSessionManager.getSnapshot().vault.nodes, id);
      if (connection?.protocol !== 'rdp') throw new Error('Die RDP-Verbindung wurde nicht gefunden.');
      if (!connection.host.trim()) throw new Error('Bitte speichere einen Host, bevor du die Verbindung startest.');
      return { host: connection.host, port: connection.port, username: connection.username, domain: connection.rdp.domain,
        password: connection.password || undefined, clipboard: connection.rdp.clipboard };
    },
    emit: (ownerId, event) => {
      const owner = webContents.fromId(ownerId);
      if (owner && !owner.isDestroyed()) owner.send(IPC_CHANNELS.rdpEvent, event);
    },
  });
  ipcMain.handle(IPC_CHANNELS.rdpOpen, (event, request: unknown) => {
    const ownerId = requireSshSender(event);
    return manager.open(ownerId, BrowserWindow.fromWebContents(event.sender)!, parse(OpenSchema, request));
  });
  ipcMain.handle(IPC_CHANNELS.rdpBounds, (event, request: unknown) => {
    const parsed = parse(BoundsSchema, request);
    manager.bounds(requireSshSender(event), parsed.sessionId, parsed.bounds);
  });
  ipcMain.handle(IPC_CHANNELS.rdpVisible, (event, request: unknown) => {
    const parsed = parse(VisibleSchema, request);
    manager.visible(requireSshSender(event), parsed.sessionId, parsed.visible);
  });
  ipcMain.handle(IPC_CHANNELS.rdpFocus, (event, request: unknown) => manager.focus(requireSshSender(event), parse(SessionSchema, request).sessionId));
  ipcMain.handle(IPC_CHANNELS.rdpClose, (event, request: unknown) => manager.close(requireSshSender(event), parse(SessionSchema, request).sessionId));
  ipcMain.handle(IPC_CHANNELS.rdpDebugHang, (event, request: unknown) => {
    manager.debugHang(requireSshSender(event), parse(HangSchema, request).ms);
  });
  return manager;
}
