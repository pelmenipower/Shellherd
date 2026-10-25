import { win32 } from 'node:path';
import { isVaultFile } from '../file-association';
import { recentKey } from './recent-vaults';

/** Vault paths main may open in this run, keyed like the recent list (resolved, case-insensitive on Windows). */
export class VaultPathGrants {
  private readonly keys = new Set<string>();
  grant(filePath: string): void { this.keys.add(recentKey(filePath)); }
  has(filePath: string): boolean { return this.keys.has(recentKey(filePath)); }
}

/** Grants of this run: native dialog, Explorer argv and checked drops. */
export const vaultPathGrants = new VaultPathGrants();

/** A dropped vault file on a drive letter, resolved; UNC, device and relative paths give null (no SMB without a dialog). */
export function droppedVaultPath(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 4096 || !/^[A-Za-z]:[\\/]/.test(raw)) return null;
  const resolved = win32.resolve(raw);
  return /^[A-Za-z]:\\/.test(resolved) && isVaultFile(resolved) ? resolved : null;
}

/** Open only what came from a grant, the locked session or the recent list; checked before any file access. */
export async function vaultPathAllowed(filePath: string, grants: VaultPathGrants, lockedPath: string | undefined,
  inRecent: (filePath: string) => Promise<boolean>): Promise<boolean> {
  if (grants.has(filePath)) return true;
  if (lockedPath !== undefined && recentKey(lockedPath) === recentKey(filePath)) return true;
  return inRecent(filePath);
}
