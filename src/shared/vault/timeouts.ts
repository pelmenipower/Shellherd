import type { ConnectionNode, ConnectionTimeouts, VaultSettings } from './types';

/** Today's fixed values; idle 0 = never, so an upgrade changes no connection behaviour. */
export const DEFAULT_TIMEOUTS: ConnectionTimeouts = { idleMinutes: 0, keepaliveSeconds: 15, keepaliveCount: 3, connectSeconds: 120 };
export const TIMEOUT_LIMITS = {
  idleMinutes: [0, 1_440], keepaliveSeconds: [5, 300], keepaliveCount: [1, 10], connectSeconds: [5, 300],
} as const satisfies Record<keyof ConnectionTimeouts, readonly [number, number]>;
export const AUTO_LOCK_LIMITS = [0, 1_440] as const;

/** Defaults, then the vault setting, then the ssh/sftp connection's own keys; undefined keys never override, other protocols have no override. */
export function effectiveTimeouts(settings?: Pick<VaultSettings, 'timeouts'>, connection?: ConnectionNode): ConnectionTimeouts {
  const result: ConnectionTimeouts = { ...DEFAULT_TIMEOUTS, ...settings?.timeouts };
  if (connection?.protocol === 'ssh' || connection?.protocol === 'sftp') {
    for (const key of Object.keys(result) as (keyof ConnectionTimeouts)[]) {
      const value = connection.timeouts?.[key];
      if (value !== undefined) result[key] = value;
    }
  }
  return result;
}

/** Trimmed decimal digits only (/^\d+$/) within [min, max] inclusive, else null ('' → null, '1.5' → null, '-1' → null). */
export function parseBounded(value: string, limits: readonly [number, number]): number | null {
  const text = value.trim();
  if (!/^\d+$/.test(text)) return null;
  const number = Number(text);
  return number >= limits[0] && number <= limits[1] ? number : null;
}
