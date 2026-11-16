export interface SyncServerUrlOptions { loopback?: boolean; private?: boolean }
export function normalizeSyncServerUrl(input: unknown, options?: boolean | SyncServerUrlOptions): string | null;
export function isPrivateTunnelAddress(hostname: string): boolean;
/** True only for plain HTTP to a numeric tunnel address, i.e. a URL that needs the privateNetwork opt-in. */
export function needsPrivateNetwork(input: unknown): boolean;
