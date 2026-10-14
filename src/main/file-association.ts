import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute, win32 } from 'node:path';

/** New vaults use `.term`; `.terminus` files from earlier versions still open. */
export const VAULT_EXTENSIONS = ['.term', '.terminus'] as const;
const PROG_ID = 'Terminus.Vault';
const CLASSES = 'HKCU\\Software\\Classes';

export function isVaultFile(path: string): boolean {
  return VAULT_EXTENSIONS.some(extension => path.toLowerCase().endsWith(extension));
}

/** The vault file Explorer passed on the command line, if any. */
export function vaultFileFromArgs(argv: string[], exists: (path: string) => boolean = existsSync): string | null {
  return [...argv].reverse().find(arg => isAbsolute(arg) && isVaultFile(arg) && exists(arg)) ?? null;
}

/** Command Explorer runs; a development build also passes the app folder to Electron. */
export function launchCommand(execPath: string, appPath: string | null): string {
  return appPath ? `"${execPath}" "${appPath}" "%1"` : `"${execPath}" "%1"`;
}

/** `reg add` calls for the current user only; no administrator rights needed. */
export function registryEntries(command: string, icon: string): string[][] {
  const add = (key: string, value: string, name?: string): string[] =>
    ['add', `${CLASSES}\\${key}`, ...(name ? ['/v', name] : ['/ve']), '/t', 'REG_SZ', '/d', value, '/f'];
  return [
    add('.term', PROG_ID),
    add('.term\\OpenWithProgids', '', PROG_ID),
    add('.terminus\\OpenWithProgids', '', PROG_ID),
    add(PROG_ID, 'Terminus Vault'),
    add(`${PROG_ID}\\DefaultIcon`, icon),
    add(`${PROG_ID}\\shell`, 'open'),
    add(`${PROG_ID}\\shell\\open`, 'Mit Terminus öffnen'),
    add(`${PROG_ID}\\shell\\open\\command`, command),
  ];
}

const regExe = (): string => win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'reg.exe');

function reg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => execFile(regExe(), args, { windowsHide: true, timeout: 10_000 },
    (error, stdout) => error ? reject(error) : resolve(stdout)));
}

export class FileAssociation {
  constructor(private readonly execPath: string, private readonly appPath: string | null) {}

  private get command(): string { return launchCommand(this.execPath, this.appPath); }

  async registered(): Promise<boolean> {
    if (process.platform !== 'win32') return false;
    try {
      const output = await reg(['query', `${CLASSES}\\${PROG_ID}\\shell\\open\\command`, '/ve']);
      return output.includes(this.command);
    } catch { return false; }
  }

  async register(): Promise<void> {
    if (process.platform !== 'win32') throw new Error('Die Dateiverknüpfung gibt es nur unter Windows.');
    try {
      for (const args of registryEntries(this.command, `"${this.execPath}",0`)) await reg(args);
    } catch { throw new Error('Die Dateiverknüpfung konnte nicht eingetragen werden.'); }
  }

  async unregister(): Promise<void> {
    if (process.platform !== 'win32') return;
    // Only our own keys; `.term` itself is removed only while it still points to Terminus.
    await reg(['delete', `${CLASSES}\\${PROG_ID}`, '/f']).catch(() => {});
    for (const extension of VAULT_EXTENSIONS) await reg(['delete', `${CLASSES}\\${extension}\\OpenWithProgids`, '/v', PROG_ID, '/f']).catch(() => {});
    const current = await reg(['query', `${CLASSES}\\.term`, '/ve']).catch(() => '');
    if (current.includes(PROG_ID)) await reg(['delete', `${CLASSES}\\.term`, '/ve', '/f']).catch(() => {});
  }
}
