import { decodeError, isCodedError, truncateDetail, type CodedError } from '../../shared/errors';
import { i18n, t } from './i18n';

const IPC_PREFIX = /^Error invoking remote method '[^']*': (?:[A-Za-z]*Error: )?/;

function codedText({ code, params, detail, causes }: CodedError): string {
  const key = `errors:${code}`;
  const text = i18n.exists(key) ? t(key as 'errors:core.unknown', params) : t('errors:core.unknown');
  // Translated reasons replace the plain detail.
  if (causes && causes.length > 0) {
    return t('common:errorWithDetail', { message: text, detail: causes.map(c => `${c.label}: ${errorText(c.error)}`).join(', ') });
  }
  return detail ? t('common:errorWithDetail', { message: text, detail }) : text;
}

/** Display text for anything caught or received: CodedError, AppError, IPC-wrapped AppError, foreign Error, string. */
export function errorText(error: unknown, fallback?: string): string {
  const coded = isCodedError(error)
    ? error
    : error instanceof Error ? decodeError(error.message)
    : typeof error === 'string' ? decodeError(error)
    : null;
  if (coded) return codedText(coded);
  if (error instanceof Error) {
    const rest = error.message.replace(IPC_PREFIX, '').trim();
    return rest ? truncateDetail(rest) : fallback ?? t('errors:core.unknown');
  }
  return fallback ?? t('errors:core.unknown');
}
