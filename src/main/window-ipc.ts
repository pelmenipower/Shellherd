import { ipcMain } from 'electron';
import type { BrowserWindow, Rectangle } from 'electron';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { IPC_CHANNELS } from '../shared/ipc';
import { WorkspaceLayoutSchema } from '../shared/vault/schema';
import { redactSecrets } from '../shared/vault/connections';
import type { ConnectionCatalog, IncomingTab, WorkspaceWindowState } from '../shared/windows';
import type { WorkspaceLayout } from '../shared/vault/types';
import { requireSshSender } from './ssh/ipc';
import type { SshSessionManager } from './ssh/session';
import type { RdpSessionManager } from './rdp/host';
import { vaultSessionManager } from './vault/ipc';
import { visibleBounds } from './windows';
import type { WindowRegistry } from './windows';

const finite = z.number().finite().min(-1_000_000).max(1_000_000);
const TabConnectionSchema = z.object({
  id: z.string().min(1).max(256), name: z.string().max(500),
  protocol: z.enum(['ssh', 'rdp', 'powershell', 'cmd']), address: z.string().max(1000),
}).strict();
const TransferSchema = z.object({
  connection: TabConnectionSchema,
  status: z.enum(['connecting', 'connected', 'closed', 'error']),
  session: z.object({ kind: z.enum(['terminal', 'rdp']), sessionId: z.string().uuid() }).strict().optional(),
  snapshot: z.string().max(8 * 1024 * 1024).optional(),
  target: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('main') }).strict(),
    z.object({ kind: z.literal('drop'), x: finite, y: finite }).strict(),
  ]),
}).strict();
const DragSchema = z.object({ x: finite, y: finite, label: z.string().max(500) }).strict().nullable();
const BoundsSchema = z.object({ x: z.number().int(), y: z.number().int(), width: z.number().int().min(320).max(20_000), height: z.number().int().min(240).max(20_000) }).strict();
const WindowsSchema = z.array(z.object({ bounds: BoundsSchema, layout: WorkspaceLayoutSchema }).strict()).max(8);
const ReportSchema = z.object({ requestId: z.string().uuid(), layout: WorkspaceLayoutSchema.nullable() }).strict();

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error('Ungültige Fensteranfrage.');
  return result.data;
}

export interface WindowIpcDependencies {
  registry: WindowRegistry;
  ssh: SshSessionManager;
  rdp: RdpSessionManager;
  createSecondary: (bounds: Rectangle) => BrowserWindow;
  closeOwnerSessions: (ownerId: number) => void;
}

export function catalog(): ConnectionCatalog {
  const { vault } = vaultSessionManager.getSnapshot();
  return { nodes: redactSecrets(vault.nodes), confirmBeforeClosingSession: vault.settings.confirmBeforeClosingSession };
}

export function registerWindowIpcHandlers({ registry, ssh, rdp, createSecondary, closeOwnerSessions }: WindowIpcDependencies): {
  broadcastCatalog: () => void;
} {
  const hovered = new Map<number, number>();
  const reports = new Map<string, (layout: WorkspaceLayout | null) => void>();
  const send = (window: BrowserWindow | undefined, channel: string, payload: unknown): void => {
    if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
  };
  const clearHover = (sourceId: number): void => {
    const target = hovered.get(sourceId);
    hovered.delete(sourceId);
    if (target !== undefined) send(registry.get(target), IPC_CHANNELS.tabDragHover, null);
  };

  ipcMain.handle(IPC_CHANNELS.windowReady, event => {
    const id = requireSshSender(event);
    registry.markReady(id);
    return { role: registry.roleOf(id) ?? 'secondary' };
  });

  ipcMain.handle(IPC_CHANNELS.connectionCatalog, event => { requireSshSender(event); return catalog(); });

  ipcMain.handle(IPC_CHANNELS.tabTransfer, async (event, request: unknown) => {
    const from = requireSshSender(event);
    const parsed = parse(TransferSchema, request);
    vaultSessionManager.getSnapshot();
    clearHover(from);
    let target: BrowserWindow | undefined;
    let drop: IncomingTab['drop'];
    if (parsed.target.kind === 'main') {
      target = registry.main();
    } else {
      const point = { x: parsed.target.x, y: parsed.target.y };
      target = registry.windowAt(point, from);
      if (target) drop = registry.toClient(target, point);
      else {
        const source = registry.get(from);
        const size = source?.getBounds() ?? { width: 1000, height: 700 };
        target = createSecondary(visibleBounds({ x: Math.round(point.x - 160), y: Math.round(point.y - 20),
          width: Math.max(640, Math.min(size.width, 1400)), height: Math.max(420, Math.min(size.height, 1000)) }));
      }
    }
    if (!target || target.isDestroyed() || target.webContents.id === from) throw new Error('Kein Zielfenster verfügbar.');
    const to = target.webContents.id;
    await registry.whenReady(to);
    let status = parsed.status;
    if (parsed.session?.kind === 'terminal') status = ssh.transferOwner(from, parsed.session.sessionId, to);
    if (parsed.session?.kind === 'rdp') status = rdp.transferOwner(from, parsed.session.sessionId, to, target);
    const incoming: IncomingTab = { connection: parsed.connection, status, ...(parsed.session ? { session: parsed.session } : {}),
      ...(parsed.snapshot ? { snapshot: parsed.snapshot } : {}), ...(drop ? { drop } : {}) };
    send(target, IPC_CHANNELS.tabIncoming, incoming);
    if (target.isMinimized()) target.restore();
    target.focus();
  });

  ipcMain.on(IPC_CHANNELS.tabDragMove, (event, value: unknown) => {
    let from: number;
    let point: z.infer<typeof DragSchema>;
    try { from = requireSshSender(event as never); point = parse(DragSchema, value); } catch { return; }
    if (!point) { clearHover(from); return; }
    const target = registry.windowAt(point, from);
    const previous = hovered.get(from);
    if (previous !== undefined && previous !== target?.webContents.id) send(registry.get(previous), IPC_CHANNELS.tabDragHover, null);
    if (!target) { hovered.delete(from); return; }
    hovered.set(from, target.webContents.id);
    send(target, IPC_CHANNELS.tabDragHover, { ...registry.toClient(target, point), label: point.label });
  });

  ipcMain.handle(IPC_CHANNELS.windowCloseReady, event => {
    const id = requireSshSender(event);
    if (registry.roleOf(id) !== 'secondary') return;
    registry.allowClose(id);
    registry.get(id)?.close();
  });

  ipcMain.handle(IPC_CHANNELS.workspaceWindows, async (event): Promise<WorkspaceWindowState[]> => {
    registry.requireMain(event);
    const results = await Promise.all(registry.secondaries().map(window => new Promise<WorkspaceWindowState | null>(resolve => {
      const requestId = randomUUID();
      const timer = setTimeout(() => { reports.delete(requestId); resolve(null); }, 2_000);
      reports.set(requestId, layout => {
        clearTimeout(timer);
        resolve(layout && !window.isDestroyed() ? { bounds: window.getNormalBounds(), layout } : null);
      });
      send(window, IPC_CHANNELS.workspaceCollect, { requestId });
    })));
    return results.filter((item): item is WorkspaceWindowState => item !== null);
  });

  ipcMain.handle(IPC_CHANNELS.workspaceReport, (event, value: unknown) => {
    requireSshSender(event);
    const parsed = parse(ReportSchema, value);
    reports.get(parsed.requestId)?.(parsed.layout);
    reports.delete(parsed.requestId);
  });

  ipcMain.handle(IPC_CHANNELS.workspaceOpenWindows, async (event, value: unknown) => {
    registry.requireMain(event);
    vaultSessionManager.getSnapshot();
    for (const item of parse(WindowsSchema, value)) {
      const window = createSecondary(visibleBounds(item.bounds));
      await registry.whenReady(window.webContents.id);
      send(window, IPC_CHANNELS.workspaceRestore, item.layout);
    }
  });

  ipcMain.handle(IPC_CHANNELS.closeSecondaryWindows, event => {
    registry.requireMain(event);
    for (const window of registry.secondaries()) {
      closeOwnerSessions(window.webContents.id);
      registry.allowClose(window.webContents.id);
      window.close();
    }
  });

  return {
    broadcastCatalog: () => {
      let value: ConnectionCatalog;
      try { value = catalog(); } catch { return; }
      for (const window of registry.secondaries()) send(window, IPC_CHANNELS.connectionCatalogChanged, value);
    },
  };
}
