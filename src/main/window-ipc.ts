import { ipcMain } from 'electron';
import type { BrowserWindow, Rectangle } from 'electron';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { IPC_CHANNELS } from '../shared/ipc';
import { WorkspaceLayoutSchema, WorkspaceViewsSchema } from '../shared/vault/schema';
import { TerminalTargetSchema } from '../shared/containers-schema';
import { redactSecrets } from '../shared/vault/connections';
import type { ConnectionCatalog, IncomingTab, IncomingView, TransferLayout, WindowLayoutReport, WorkspaceWindowState } from '../shared/windows';
import { requireSshSender } from './ssh/ipc';
import type { SshSessionManager } from './ssh/session';
import type { RdpSessionManager } from './rdp/host';
import type { SftpSessionManager } from './files/sftp-session';
import { vaultSessionManager } from './vault/ipc';
import { DragGhost, tearOffBounds } from './drag-ghost';
import { visibleBounds } from './windows';
import type { WindowRegistry } from './windows';

const finite = z.number().finite().min(-1_000_000).max(1_000_000);
const TabConnectionSchema = z.object({
  id: z.string().min(1).max(256), name: z.string().max(500),
  protocol: z.enum(['ssh', 'sftp', 'rdp', 'powershell', 'cmd', 'aicli']), address: z.string().max(1000), view: z.enum(['files', 'containers']).optional(),
  target: TerminalTargetSchema.optional(),
}).strict();
const TargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('main') }).strict(),
  z.object({ kind: z.literal('drop'), x: finite, y: finite }).strict(),
  z.object({ kind: z.literal('new'), x: finite, y: finite }).strict(),
]);
const tabFields = {
  connection: TabConnectionSchema,
  status: z.enum(['connecting', 'connected', 'closed', 'error']),
  session: z.object({ kind: z.enum(['terminal', 'rdp', 'sftp']), sessionId: z.string().uuid() }).strict().optional(),
  snapshot: z.string().max(8 * 1024 * 1024).optional(),
};
const TransferSchema = z.object({ ...tabFields, target: TargetSchema }).strict();
const id = z.string().min(1).max(128);
const LayoutSchema: z.ZodType<TransferLayout> = z.lazy(() => z.union([
  z.object({ type: z.literal('pane'), id, tabIds: z.array(id).max(16), activeTabId: id.nullable() }).strict(),
  z.object({ type: z.literal('split'), id, direction: z.enum(['horizontal', 'vertical']), ratio: z.number().min(0.1).max(0.9),
    first: LayoutSchema, second: LayoutSchema }).strict(),
]));
const ViewTransferSchema = z.object({
  name: z.string().min(1).max(60), layout: LayoutSchema, target: TargetSchema,
  tabs: z.array(z.object({ key: id, ...tabFields }).strict()).max(16),
}).strict();
const DragSchema = z.object({ x: finite, y: finite, label: z.string().max(500), kind: z.enum(['tab', 'view']).optional() }).strict().nullable();
const BoundsSchema = z.object({ x: z.number().int(), y: z.number().int(), width: z.number().int().min(320).max(20_000), height: z.number().int().min(240).max(20_000) }).strict();
const SavedSchema = { layout: WorkspaceLayoutSchema, views: WorkspaceViewsSchema.optional() };
const WindowsSchema = z.array(z.object({ bounds: BoundsSchema, ...SavedSchema }).strict()).max(8);
const ReportSchema = z.object({ requestId: z.string().uuid(), report: z.object(SavedSchema).strict().nullable() }).strict();

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error('Ungültige Fensteranfrage.');
  return result.data;
}

export interface WindowIpcDependencies {
  registry: WindowRegistry;
  ssh: SshSessionManager;
  rdp: RdpSessionManager;
  sftp: SftpSessionManager;
  createSecondary: (bounds: Rectangle) => BrowserWindow;
  closeOwnerSessions: (ownerId: number) => void;
}

export function catalog(): ConnectionCatalog {
  const { vault } = vaultSessionManager.getSnapshot();
  return { nodes: redactSecrets(vault.nodes), confirmBeforeClosingSession: vault.settings.confirmBeforeClosingSession, workflows: vault.workflows ?? [] };
}

export function registerWindowIpcHandlers({ registry, ssh, rdp, sftp, createSecondary, closeOwnerSessions }: WindowIpcDependencies): {
  broadcastCatalog: () => void;
} {
  const hovered = new Map<number, number>();
  const reports = new Map<string, (report: WindowLayoutReport) => void>();
  const send = (window: BrowserWindow | undefined, channel: string, payload: unknown): void => {
    if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
  };
  const ghost = new DragGhost();
  const clearHover = (sourceId: number): void => {
    ghost.dispose();
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

  /** Finds or creates the receiving window and waits until it can take over sessions. */
  const resolveTarget = async (from: number, spec: z.infer<typeof TargetSchema>): Promise<{ target: BrowserWindow; drop?: IncomingTab['drop'] }> => {
    let target: BrowserWindow | undefined;
    let drop: IncomingTab['drop'];
    if (spec.kind === 'main') target = registry.main();
    else {
      const point = { x: spec.x, y: spec.y };
      target = spec.kind === 'drop' ? registry.windowAt(point, from) : undefined;
      if (target) drop = registry.toClient(target, point);
      else target = createSecondary(tearOffBounds(point, registry.get(from)?.getBounds()));
    }
    if (!target || target.isDestroyed() || target.webContents.id === from) throw new Error('Kein Zielfenster verfügbar.');
    await registry.whenReady(target.webContents.id);
    return { target, ...(drop ? { drop } : {}) };
  };
  const moveSession = (from: number, tab: z.infer<z.ZodObject<typeof tabFields>>, target: BrowserWindow) => {
    const to = target.webContents.id;
    let status = tab.status;
    if (tab.session?.kind === 'terminal') status = ssh.transferOwner(from, tab.session.sessionId, to);
    if (tab.session?.kind === 'rdp') status = rdp.transferOwner(from, tab.session.sessionId, to, target);
    if (tab.session?.kind === 'sftp') status = sftp.transferOwner(from, tab.session.sessionId, to);
    return { connection: tab.connection, status, ...(tab.session ? { session: tab.session } : {}), ...(tab.snapshot ? { snapshot: tab.snapshot } : {}) };
  };
  const present = (target: BrowserWindow): void => {
    if (target.isMinimized()) target.restore();
    target.focus();
  };

  ipcMain.handle(IPC_CHANNELS.tabTransfer, async (event, request: unknown) => {
    const from = requireSshSender(event);
    const parsed = parse(TransferSchema, request);
    vaultSessionManager.getSnapshot();
    clearHover(from);
    const { target, drop } = await resolveTarget(from, parsed.target);
    const incoming: IncomingTab = { ...moveSession(from, parsed, target), ...(drop ? { drop } : {}) };
    send(target, IPC_CHANNELS.tabIncoming, incoming);
    present(target);
  });

  ipcMain.handle(IPC_CHANNELS.viewTransfer, async (event, request: unknown) => {
    const from = requireSshSender(event);
    const parsed = parse(ViewTransferSchema, request);
    vaultSessionManager.getSnapshot();
    clearHover(from);
    if (parsed.tabs.reduce((total, tab) => total + (tab.snapshot?.length ?? 0), 0) > 32 * 1024 * 1024) throw new Error('Die Ansicht ist zu groß zum Verschieben.');
    // Check every session first so a view never ends up split between two windows.
    for (const tab of parsed.tabs) {
      if (tab.session && !{ terminal: ssh, rdp, sftp }[tab.session.kind].owns(from, tab.session.sessionId)) throw new Error('Eine Sitzung der Ansicht ist nicht verfügbar.');
    }
    const { target } = await resolveTarget(from, parsed.target);
    const incoming: IncomingView = { name: parsed.name, layout: parsed.layout,
      tabs: parsed.tabs.map(tab => ({ key: tab.key, ...moveSession(from, tab, target) })) };
    send(target, IPC_CHANNELS.viewIncoming, incoming);
    present(target);
  });

  ipcMain.on(IPC_CHANNELS.tabDragMove, (event, value: unknown) => {
    let from: number;
    let point: z.infer<typeof DragSchema>;
    try { from = requireSshSender(event as never); point = parse(DragSchema, value); } catch { return; }
    if (!point) { clearHover(from); return; }
    const target = registry.windowAt(point, from);
    const previous = hovered.get(from);
    if (previous !== undefined && previous !== target?.webContents.id) send(registry.get(previous), IPC_CHANNELS.tabDragHover, null);
    if (!target) {
      hovered.delete(from);
      ghost.show(tearOffBounds(point, registry.get(from)?.getBounds()), point.label);
      return;
    }
    ghost.hide();
    hovered.set(from, target.webContents.id);
    send(target, IPC_CHANNELS.tabDragHover, { ...registry.toClient(target, point), label: point.label, ...(point.kind ? { kind: point.kind } : {}) });
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
      reports.set(requestId, report => {
        clearTimeout(timer);
        resolve(report && !window.isDestroyed() ? { bounds: window.getNormalBounds(), ...report } : null);
      });
      send(window, IPC_CHANNELS.workspaceCollect, { requestId });
    })));
    return results.filter((item): item is WorkspaceWindowState => item !== null);
  });

  ipcMain.handle(IPC_CHANNELS.workspaceReport, (event, value: unknown) => {
    requireSshSender(event);
    const parsed = parse(ReportSchema, value);
    reports.get(parsed.requestId)?.(parsed.report);
    reports.delete(parsed.requestId);
  });

  ipcMain.handle(IPC_CHANNELS.workspaceOpenWindows, async (event, value: unknown) => {
    registry.requireMain(event);
    vaultSessionManager.getSnapshot();
    for (const item of parse(WindowsSchema, value)) {
      const window = createSecondary(visibleBounds(item.bounds));
      await registry.whenReady(window.webContents.id);
      send(window, IPC_CHANNELS.workspaceRestore, { layout: item.layout, ...(item.views ? { views: item.views } : {}) });
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
