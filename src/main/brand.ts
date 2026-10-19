import { app } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Window and file-type icon (`resources/icon.ico` on Windows, `icon.png` elsewhere); undefined when the file is missing. */
export function brandIconPath(): string | undefined {
  const file = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  const path = app.isPackaged ? join(process.resourcesPath, file) : join(app.getAppPath(), 'resources', file);
  return existsSync(path) ? path : undefined;
}
