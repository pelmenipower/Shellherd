import { MAX_DETAIL } from './errors';

export type ConnectionErrorCode = 'auth' | 'timeout' | 'hostkey-changed' | 'hostkey-rejected' | 'hostkey-store'
  | 'refused' | 'not-found' | 'key-file' | 'agent' | 'limit' | 'closed-by-server' | 'unknown';
export type ConnectionAction = 'retry' | 'edit' | 'copy';
export const DETAIL_LIMIT = MAX_DETAIL;

/** Texts of one card; produced by the renderer from the catalog. */
export interface ConnectionErrorText {
  title: string; body: string; next?: string;
  primary: ConnectionAction; secondary?: ConnectionAction;
}

/** "deploy@10.0.4.21:22" → { user: 'deploy', host: '10.0.4.21', port: '22' }; the port is the digits after the last ':'. */
export function splitAddress(address: string): { user?: string; host: string; port?: string } {
  const at = address.indexOf('@');
  const user = at > 0 ? address.slice(0, at) : undefined;
  let host = at > 0 ? address.slice(at + 1) : address;
  let port: string | undefined;
  const match = /^(.*):(\d+)$/.exec(host);
  if (match && match[1]) { host = match[1]; port = match[2]; }
  return { ...(user ? { user } : {}), host, ...(port ? { port } : {}) };
}
