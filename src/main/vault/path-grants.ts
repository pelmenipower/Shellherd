import { win32 } from 'node:path';
import { isVaultFile } from '../file-association';
import { grantKey } from './recent-vaults';

// Defined in recent-vaults (path-grants imports it, not the other way round); re-exported here for callers.
export { grantKey };

/** Vault paths main may open in this run, keyed by grantKey (resolved, ASCII case-insensitive). */
export class VaultPathGrants {
  private readonly keys = new Set<string>();
  grant(filePath: string): void { this.keys.add(grantKey(filePath)); }
  has(filePath: string): boolean { return this.keys.has(grantKey(filePath)); }
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
  if (lockedPath !== undefined && grantKey(lockedPath) === grantKey(filePath)) return true;
  return inRecent(filePath);
}
