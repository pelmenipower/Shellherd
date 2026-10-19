import { readFile, stat, writeFile } from 'node:fs/promises';

/** Remembers the path of the last opened vault file (never its contents) so the open screen can preselect it. */
export class LastVaultFile {
  constructor(private readonly settingsFile: string) {}

  /** The remembered path, or null when none is stored or the file no longer exists. */
  async get(): Promise<string | null> {
    try {
      const data: unknown = JSON.parse(await readFile(this.settingsFile, 'utf8'));
      const filePath = typeof data === 'object' && data !== null && typeof (data as { filePath?: unknown }).filePath === 'string'
        ? (data as { filePath: string }).filePath : '';
      if (!filePath) return null;
      return (await stat(filePath).catch(() => null))?.isFile() ? filePath : null;
    } catch { return null; }
  }

  /** Best effort: a failed write only means the next start asks for the file again. */
  async set(filePath: string): Promise<void> {
    try { await writeFile(this.settingsFile, JSON.stringify({ filePath }), 'utf8'); } catch { /* not remembered */ }
  }
}
