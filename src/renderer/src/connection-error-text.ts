import { splitAddress } from '../../shared/connection-errors';
import type { ConnectionAction, ConnectionErrorCode, ConnectionErrorText } from '../../shared/connection-errors';
import type { CodedError } from '../../shared/errors';
import { MAX_SSH_SESSIONS } from '../../shared/ssh';
import { errorText } from './error-text';
import { t } from './i18n';

export interface ConnectionErrorContext {
  /** connection.address, e.g. "deploy@10.0.4.21:22" or "Lokal · CMD". */
  address: string;
  /** Error of the event or the rejected call; its text is the body of 'unknown' and 'hostkey-store'. */
  error?: CodedError;
  /** false for local shells, local containers and pods: no host hint. */
  remote: boolean;
}

/** Literal keys, so unused catalog entries stay detectable. */
const KEYS = {
  auth: { title: 'terminal:connectionError.auth.title', body: 'terminal:connectionError.auth.body', next: 'terminal:connectionError.auth.next', bodyWithUser: 'terminal:connectionError.auth.bodyWithUser' },
  timeout: { title: 'terminal:connectionError.timeout.title', body: 'terminal:connectionError.timeout.body', next: 'terminal:connectionError.timeout.next' },
  'hostkey-changed': { title: 'terminal:connectionError.hostkey-changed.title', body: 'terminal:connectionError.hostkey-changed.body', next: 'terminal:connectionError.hostkey-changed.next' },
  'hostkey-rejected': { title: 'terminal:connectionError.hostkey-rejected.title', body: 'terminal:connectionError.hostkey-rejected.body', next: 'terminal:connectionError.hostkey-rejected.next' },
  'hostkey-store': { title: 'terminal:connectionError.hostkey-store.title', body: 'terminal:connectionError.hostkey-store.body', next: 'terminal:connectionError.hostkey-store.next' },
  refused: { title: 'terminal:connectionError.refused.title', body: 'terminal:connectionError.refused.body', next: 'terminal:connectionError.refused.next', bodyWithPort: 'terminal:connectionError.refused.bodyWithPort' },
  'not-found': { title: 'terminal:connectionError.not-found.title', body: 'terminal:connectionError.not-found.body', next: 'terminal:connectionError.not-found.next' },
  'key-file': { title: 'terminal:connectionError.key-file.title', body: 'terminal:connectionError.key-file.body', next: 'terminal:connectionError.key-file.next' },
  agent: { title: 'terminal:connectionError.agent.title', body: 'terminal:connectionError.agent.body', next: 'terminal:connectionError.agent.next' },
  limit: { title: 'terminal:connectionError.limit.title', body: 'terminal:connectionError.limit.body', next: 'terminal:connectionError.limit.next' },
  'closed-by-server': { title: 'terminal:connectionError.closed-by-server.title', body: 'terminal:connectionError.closed-by-server.body', next: 'terminal:connectionError.closed-by-server.next' },
  unknown: { title: 'terminal:connectionError.unknown.title', body: 'terminal:connectionError.unknown.body', next: 'terminal:connectionError.unknown.next' },
} as const;
const ACTION_KEYS = {
  retry: 'terminal:connectionError.actions.retry', edit: 'terminal:connectionError.actions.edit', copy: 'terminal:connectionError.actions.copy',
} as const satisfies Record<ConnectionAction, string>;
type Params = Record<string, string | number>;

export function actionLabel(action: ConnectionAction): string {
  return t(ACTION_KEYS[action]);
}

/** The error's own text without the raw library detail; that goes under "Details". */
function bodyOf(error: CodedError | undefined, fallback: string): string {
  return error ? errorText({ ...error, detail: undefined }) : fallback;
}

export function connectionError(code: ConnectionErrorCode, context: ConnectionErrorContext): ConnectionErrorText {
  const { user, host, port } = splitAddress(context.address);
  const hostPort = port ? `${host}:${port}` : host;
  const keys = KEYS[code];
  const title = (params?: Params): string => t(keys.title, params);
  const body = (params?: Params): string => t(keys.body, params);
  const next = (): string => t(keys.next);
  switch (code) {
    case 'auth':
      return { title: title(), body: user ? t(KEYS.auth.bodyWithUser, { user }) : body(), next: next(), primary: 'edit', secondary: 'retry' };
    case 'timeout':
      return { title: title(), body: body({ hostPort }), next: next(), primary: 'retry', secondary: 'edit' };
    case 'hostkey-changed':
      return { title: title(), body: body(), next: next(), primary: 'copy', secondary: 'retry' };
    case 'hostkey-rejected':
      return { title: title(), body: body({ hostPort }), next: next(), primary: 'retry', secondary: 'edit' };
    case 'hostkey-store':
      return { title: title(), body: bodyOf(context.error, body()), next: next(), primary: 'retry' };
    case 'refused':
      return { title: title(), body: port ? t(KEYS.refused.bodyWithPort, { host, port }) : body({ host }), next: next(), primary: 'retry', secondary: 'edit' };
    case 'not-found':
      return { title: title(), body: body({ host }), next: next(), primary: 'edit', secondary: 'retry' };
    case 'key-file':
    case 'agent':
      return { title: title(), body: body(), next: next(), primary: 'edit', secondary: 'retry' };
    case 'limit':
      return { title: title({ max: MAX_SSH_SESSIONS }), body: body(), next: next(), primary: 'retry' };
    case 'closed-by-server':
      return { title: title(), body: body(), next: next(), primary: 'retry' };
    default:
      return { title: title(), body: bodyOf(context.error, body()), ...(context.remote ? { next: next() } : {}), primary: 'retry', secondary: 'edit' };
  }
}
