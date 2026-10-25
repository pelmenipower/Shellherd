/** Where a trusted or revoked server key comes from. */
export type KnownHostOrigin = 'confirmed' | 'imported' | 'revoked';

/** One row of the server key list; host/port null for hashed names and revoked keys, type null for confirmed keys. */
export interface KnownHostView {
  /** 16 hex chars, stable for the same entry; the only thing the renderer sends back. */
  id: string;
  host: string | null;
  port: number | null;
  type: string | null;
  fingerprint: string;
  origin: KnownHostOrigin;
}

/** Counts of one known_hosts import; conflicts are confirmed hosts whose key the file does not contain (at most 20). */
export interface KnownHostsImportResult { added: number; known: number; revoked: number; skipped: number; conflicts: string[] }

export type KnownHostsImportReply =
  | { canceled: true }
  | { canceled: false; result: KnownHostsImportResult; hosts: KnownHostView[] };

/** `host` on port 22, else `host:port`; IPv6 addresses get brackets. */
export function hostLabel(host: string, port: number): string {
  if (port === 22) return host;
  return host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`;
}
