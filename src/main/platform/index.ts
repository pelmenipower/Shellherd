import { constants, accessSync, statSync } from 'node:fs';
import { delimiter, join, posix, win32 } from 'node:path';
import type { PlatformCapabilities } from '../../shared/platform';
import type { LocalShellProtocol } from '../../shared/vault/types';

export function executableOnPath(command: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (!/^[\w.-]+$/.test(command)) return null;
  for (const directory of (env.PATH ?? '').split(delimiter)) {
    // Never resolve executables relative to the vault's working directory.
    if (!posix.isAbsolute(directory)) continue;
    const file = join(directory, command);
    try { accessSync(file, constants.X_OK); if (statSync(file).isFile()) return file; } catch { /* try next */ }
  }
  return null;
}

export function platformCapabilities(platform: NodeJS.Platform = process.platform): PlatformCapabilities {
  const windows = platform === 'win32';
  return { platform, rdp: windows, windowsHello: windows, fileAssociation: windows, registryImport: windows,
    localShells: windows ? ['powershell', 'cmd'] : platform === 'linux'
      ? (['bash', 'zsh', 'fish'] as const).filter(shell => executableOnPath(shell) !== null) : [] };
}

export const capabilities = platformCapabilities();
export const localPath = process.platform === 'win32' ? win32 : posix;
export function supportsShell(shell: LocalShellProtocol): boolean { return capabilities.localShells.includes(shell); }
