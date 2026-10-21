import { describe, expect, it } from 'vitest';
import { SshConnectionNodeSchema, VaultSettingsSchema } from './schema';
import { DEFAULT_TIMEOUTS, effectiveTimeouts, parseBounded } from './timeouts';
import type { ConnectionNode, VaultSettings } from './types';

const ssh = (timeouts?: Record<string, number | undefined>): ConnectionNode => ({
  id: 'a', type: 'connection', name: 'a', tags: [], protocol: 'ssh', host: 'h', port: 22,
  authentication: { method: 'agent' }, ...(timeouts ? { timeouts } : {}),
} as ConnectionNode);
const settings: VaultSettings = { theme: 'dark', autoLockMinutes: 15, confirmBeforeClosingSession: true };

describe('effectiveTimeouts', () => {
  it('defaults to the former fixed values', () => {
    expect(DEFAULT_TIMEOUTS).toEqual({ idleMinutes: 0, keepaliveSeconds: 15, keepaliveCount: 3, connectSeconds: 120 });
    expect(effectiveTimeouts()).toEqual(DEFAULT_TIMEOUTS);
    expect(effectiveTimeouts(settings, ssh())).toEqual(DEFAULT_TIMEOUTS);
  });
  it('layers vault setting and a partial override, ignoring undefined keys', () => {
    const vault = { ...DEFAULT_TIMEOUTS, idleMinutes: 10, connectSeconds: 30 };
    const result = effectiveTimeouts({ timeouts: vault }, ssh({ idleMinutes: 5, connectSeconds: undefined }));
    expect(result).toEqual({ ...vault, idleMinutes: 5 });
    expect(result).not.toBe(vault);
    expect(DEFAULT_TIMEOUTS.idleMinutes).toBe(0);
  });
  it('ignores the override of other protocols', () => {
    const rdp = { ...ssh({ idleMinutes: 5 }), protocol: 'rdp' } as unknown as ConnectionNode;
    expect(effectiveTimeouts(undefined, rdp).idleMinutes).toBe(0);
  });
});

describe('parseBounded', () => {
  it('accepts trimmed digits within the inclusive limits', () => {
    expect(parseBounded(' 15 ', [5, 300])).toBe(15);
    expect(parseBounded('5', [5, 300])).toBe(5);
    expect(parseBounded('300', [5, 300])).toBe(300);
  });
  it('rejects everything else', () => {
    for (const value of ['', '1.5', '-1', '1e3', '4', '301', 'x']) expect(parseBounded(value, [5, 300])).toBeNull();
  });
});

describe('timeouts schema', () => {
  const full = { idleMinutes: 0, keepaliveSeconds: 15, keepaliveCount: 3, connectSeconds: 120 };
  it('keeps vaults without timeouts valid', () => {
    expect(VaultSettingsSchema.safeParse(settings).success).toBe(true);
    expect(VaultSettingsSchema.safeParse({ ...settings, timeouts: full }).success).toBe(true);
  });
  it('rejects values out of range', () => {
    for (const bad of [{ keepaliveSeconds: 4 }, { connectSeconds: 301 }, { idleMinutes: -1 }, { idleMinutes: 1.5 }]) {
      expect(VaultSettingsSchema.safeParse({ ...settings, timeouts: { ...full, ...bad } }).success).toBe(false);
    }
  });
  it('allows a partial override on the node', () => {
    expect(SshConnectionNodeSchema.safeParse(ssh({ idleMinutes: 5 })).data?.timeouts).toEqual({ idleMinutes: 5 });
    expect(SshConnectionNodeSchema.safeParse(ssh({ keepaliveSeconds: 4 })).success).toBe(false);
  });
});
