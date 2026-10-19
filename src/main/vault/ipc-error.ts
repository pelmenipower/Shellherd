import { AppError } from '../../shared/errors';

/** Maps a failure of a vault command to a coded error; library text never reaches the UI. */
export function toVaultAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'ENOENT') return new AppError('core.vaultFileNotFound');
  if (code === 'EACCES' || code === 'EPERM' || code === 'EBUSY') return new AppError('core.vaultFileAccessDenied');
  return new AppError('core.vaultProcessFailed');
}
