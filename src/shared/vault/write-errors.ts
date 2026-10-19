import type { ErrorCode } from '../errors';

const CODES: ReadonlyMap<string, ErrorCode> = new Map<string, ErrorCode>([
  ['EACCES', 'core.vaultWriteReadOnly'],
  ['EPERM', 'core.vaultWriteReadOnly'],
  ['EROFS', 'core.vaultWriteReadOnly'],
  ['EBUSY', 'core.vaultWriteLocked'],
  ['ENOENT', 'core.vaultWriteFolderUnreachable'],
  ['ENOSPC', 'core.vaultWriteDiskFull'],
]);

/** Error code for a failed vault write, by errno code; undefined for unknown codes. */
export function vaultWriteCode(code: string | undefined): ErrorCode | undefined {
  return code === undefined ? undefined : CODES.get(code);
}
