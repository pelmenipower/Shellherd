import { decodeError, isCodedError, truncateDetail, type CodedError } from '../../shared/errors';
import { i18n, t } from './i18n';

const IPC_PREFIX = /^Error invoking remote method '[^']*': (?:[A-Za-z]*Error: )?/;

function codedText({ code, params, detail }: CodedError): string {
  const key = `errors:${code}`;
  const text = i18n.exists(key) ? t(key as 'errors:core.unknown', params) : t('errors:core.unknown');
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
