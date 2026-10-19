import { BrowserWindow } from 'electron';
import type { Point, Rectangle } from 'electron';
import { visibleBounds } from './windows';

/** Where a torn-off tab opens: the tab bar sits under the pointer, size follows the source window. */
export function tearOffBounds(point: Point, source?: Rectangle): Rectangle {
  const size = source ?? { width: 1000, height: 700 };
  return visibleBounds({ x: Math.round(point.x - 160), y: Math.round(point.y - 20),
    width: Math.max(640, Math.min(size.width, 1400)), height: Math.max(420, Math.min(size.height, 1000)) });
}

const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);

function ghostPage(label: string): string {
  return `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:transparent;font:13px "Segoe UI",system-ui,sans-serif;overflow:hidden}
.frame{box-sizing:border-box;height:100%;border:2px solid rgba(103,232,249,.85);border-radius:8px;background:rgba(9,14,23,.38)}
.bar{display:flex;align-items:center;height:32px;padding:0 8px;background:rgba(17,25,37,.94);border-radius:6px 6px 0 0}
.tab{max-width:260px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;padding:4px 10px;border-radius:4px;color:#e2eaf4;background:rgba(103,232,249,.2)}
</style><div class="frame"><div class="bar"><span class="tab">${escapeHtml(label)}</span></div></div>`;
}

/**
 * Translucent outline that follows a tab dragged outside all Terminus windows and shows where the
 * new window will open. It never takes focus or mouse input, so the drag in the source window continues.
 */
export class DragGhost {
  private window?: BrowserWindow;
  private label?: string;

  show(bounds: Rectangle, label: string): void {
    if (!this.window || this.window.isDestroyed()) {
      this.window = new BrowserWindow({
        ...bounds, frame: false, transparent: true, resizable: false, movable: false, focusable: false,
        skipTaskbar: true, alwaysOnTop: true, hasShadow: false, show: false,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false, devTools: false },
      });
      this.window.setIgnoreMouseEvents(true);
      this.label = undefined;
    }
    if (label !== this.label) {
      this.label = label;
      void this.window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(ghostPage(label))}`);
    }
    this.window.setBounds(bounds);
    if (!this.window.isVisible()) this.window.showInactive();
  }

  hide(): void { if (this.window && !this.window.isDestroyed()) this.window.hide(); }

  /** Destroyed after every drag so a hidden ghost can never keep the app alive. */
  dispose(): void {
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = undefined;
    this.label = undefined;
  }
}
