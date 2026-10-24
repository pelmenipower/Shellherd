import type { ImportPreview, ImportSource } from '../shared/import';
import { parseMRemoteNg } from '../shared/import-mremoteng';
import { parseOpenSshConfig } from '../shared/import-openssh';
import { parsePuttyReg } from '../shared/import-putty';
import { parseWinScp } from '../shared/import-winscp';

/** Pure parser dispatch; runs inside the import worker, see import-worker.ts. */
export function parseImport(source: ImportSource, text: string, home: string): Omit<ImportPreview, 'source' | 'file'> {
  switch (source) {
    case 'openssh': return parseOpenSshConfig(text, home);
    case 'putty': return parsePuttyReg(text);
    case 'winscp': return parseWinScp(text);
    case 'mremoteng': return parseMRemoteNg(text);
  }
}
