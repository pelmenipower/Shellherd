import { BrowserWindow, screen } from 'electron';
import type { IpcMainEvent, IpcMainInvokeEvent, Point, Rectangle } from 'electron';

export type WindowRole = 'main' | 'secondary';

interface Entry {
  window: BrowserWindow;
  role: WindowRole;
  ready: Promise<void>;
  markReady: () => void;
  focusedAt: number;
  /** Set once the window may close without moving its tabs first. */
  closeAllowed: boolean;
}

/** Keeps a rectangle at least partly visible; falls back to the primary display. */
export function visibleBounds(bounds: Rectangle): Rectangle {
  const onScreen = screen.getAllDisplays().some(display => {
    const area = display.workArea;
    return bounds.x < area.x + area.width - 80 && bounds.x + bounds.width > area.x + 80
      && bounds.y >= area.y - 10 && bounds.y < area.y + area.height - 60;
  });
  if (onScreen) return bounds;
  const area = screen.getPrimaryDisplay().workArea;
  return { x: area.x + 40, y: area.y + 40, width: Math.min(bounds.width, area.width - 80), height: Math.min(bounds.height, area.height - 80) };
}

/** Tracks Shellherd windows by webContents ID. Exactly one main window owns vault, sidebar and editor. */
export class WindowRegistry {
  private entries = new Map<number, Entry>();

  register(window: BrowserWindow, role: WindowRole): void {
    const id = window.webContents.id;
    let markReady = (): void => {};
    const ready = new Promise<void>(resolve => { markReady = resolve; });
    this.entries.set(id, { window, role, ready, markReady, focusedAt: Date.now(), closeAllowed: false });
    window.on('focus', () => { const entry = this.entries.get(id); if (entry) entry.focusedAt = Date.now(); });
    window.on('closed', () => this.entries.delete(id));
  }

  get(id: number): BrowserWindow | undefined { return this.entries.get(id)?.window; }
  roleOf(id: number): WindowRole | undefined { return this.entries.get(id)?.role; }
  main(): BrowserWindow | undefined { return [...this.entries.values()].find(entry => entry.role === 'main')?.window; }
  secondaries(): BrowserWindow[] { return [...this.entries.values()].filter(entry => entry.role === 'secondary').map(entry => entry.window); }

  markReady(id: number): void { this.entries.get(id)?.markReady(); }

  async whenReady(id: number, timeoutMs = 15_000): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) throw new Error('Das Zielfenster ist nicht mehr verfügbar.');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([entry.ready, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Das Zielfenster reagiert nicht.')), timeoutMs);
      })]);
    } finally { clearTimeout(timer); }
  }

  allowClose(id: number): void { const entry = this.entries.get(id); if (entry) entry.closeAllowed = true; }
  closeAllowed(id: number): boolean { return this.entries.get(id)?.closeAllowed ?? true; }

  /** Topmost-by-focus Shellherd window under a screen point (DIP), optionally excluding the drag source. */
  windowAt(point: Point, excludeId?: number): BrowserWindow | undefined {
    return [...this.entries.entries()]
      .filter(([id, entry]) => id !== excludeId && !entry.window.isDestroyed() && entry.window.isVisible() && !entry.window.isMinimized())
      .filter(([, entry]) => {
        const bounds = entry.window.getBounds();
        return point.x >= bounds.x && point.x < bounds.x + bounds.width && point.y >= bounds.y && point.y < bounds.y + bounds.height;
      })
      .sort(([, a], [, b]) => b.focusedAt - a.focusedAt)[0]?.[1].window;
  }

  /** Converts a screen point (DIP) to viewport CSS pixels of a window. */
  toClient(window: BrowserWindow, point: Point): Point {
    const content = window.getContentBounds();
    const zoom = window.webContents.getZoomFactor();
    return { x: (point.x - content.x) / zoom, y: (point.y - content.y) / zoom };
  }

  requireMain(event: IpcMainInvokeEvent | IpcMainEvent): void {
    if (this.roleOf(event.sender.id) !== 'main' || event.senderFrame !== event.sender.mainFrame) {
      throw new Error('Diese Aktion ist nur im Hauptfenster erlaubt.');
    }
  }
}

export const windowRegistry = new WindowRegistry();
