import { DEFAULT_EXCLUDES, excludePatternError } from '../../shared/exclude-glob';
import { AUTO_UPLOAD_LOCAL_PATH } from '../../shared/vault/schema';
import type { AutoUploadBinding } from '../../shared/vault/types';
import { t } from './i18n';

export type AutoUploadField = 'localPath' | 'remotePath' | 'excludes';
/** Text of the dialog fields; `excludes` is the textarea content. */
export interface AutoUploadDraft { localPath: string; remotePath: string; excludes: string }

const MAX_PATTERNS = 200;
const MAX_PATTERN_LENGTH = 256;
const LINE_BREAK = /[\0\r\n]/;

export function newAutoUpload(localPath: string, remotePath: string): AutoUploadBinding {
  return { id: crypto.randomUUID(), localPath, remotePath, excludes: [...DEFAULT_EXCLUDES], enabled: true };
}

export function draftOf(binding: AutoUploadBinding): AutoUploadDraft {
  return { localPath: binding.localPath, remotePath: binding.remotePath, excludes: binding.excludes.join('\n') };
}

/** Trailing backslashes removed, except on a drive root (`X:\`). */
function trimLocal(path: string): string {
  const slashed = path.trim().replace(/\//g, '\\');
  const trimmed = slashed.replace(/\\+$/, '');
  return /^[A-Za-z]:$/.test(trimmed) ? `${trimmed}\\` : trimmed;
}

export function bindingFromDraft(base: AutoUploadBinding, draft: AutoUploadDraft): AutoUploadBinding {
  const remote = draft.remotePath.trim().replace(/\/+$/, '');
  return {
    id: base.id, enabled: base.enabled,
    localPath: trimLocal(draft.localPath),
    remotePath: remote || (draft.remotePath.trim().startsWith('/') ? '/' : ''),
    excludes: draft.excludes.split('\n').map(line => line.trim()).filter(Boolean),
  };
}

/** Last path segment, else the whole path (drive roots). */
export function bindingName(binding: Pick<AutoUploadBinding, 'localPath'>): string {
  const path = binding.localPath.replace(/\\+$/, '');
  const name = path.slice(path.lastIndexOf('\\') + 1);
  return !name || name.endsWith(':') ? binding.localPath : name;
}

/** Same rule as the main process (K11): case-insensitive, compared with a trailing backslash. */
function overlaps(a: string, b: string): boolean {
  const left = `${a.replace(/\\+$/, '').toLowerCase()}\\`;
  const right = `${b.replace(/\\+$/, '').toLowerCase()}\\`;
  return left.startsWith(right) || right.startsWith(left);
}

export function autoUploadErrors(binding: AutoUploadBinding, others: AutoUploadBinding[]): Partial<Record<AutoUploadField, string>> {
  const errors: Partial<Record<AutoUploadField, string>> = {};
  const { localPath, remotePath, excludes } = binding;
  if (!AUTO_UPLOAD_LOCAL_PATH.test(localPath) || LINE_BREAK.test(localPath)) errors.localPath = t('files:sync.errors.localAbsolute');
  else {
    const other = others.find(item => item.id !== binding.id && overlaps(localPath, item.localPath));
    if (other) errors.localPath = t('files:sync.errors.overlap', { name: bindingName(other) });
  }
  if (remotePath === '/') errors.remotePath = t('files:sync.errors.remoteRoot');
  else if (!remotePath.startsWith('/') || LINE_BREAK.test(remotePath)) errors.remotePath = t('files:sync.errors.remoteAbsolute');
  const bad = excludes.map(excludePatternError).find(Boolean);
  if (bad === 'negation') errors.excludes = t('files:sync.errors.negation');
  else if (bad || excludes.length > MAX_PATTERNS || excludes.some(pattern => pattern.length > MAX_PATTERN_LENGTH))
    errors.excludes = t('files:sync.errors.patternChars');
  return errors;
}
