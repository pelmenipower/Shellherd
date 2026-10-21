import { describe, expect, it } from 'vitest';
import { sshConnectConfig } from './client-config';
import type { SshConnectionNode } from '../../shared/vault/types';

const node: SshConnectionNode = { id: 'a', type: 'connection', name: 'a', tags: [], protocol: 'ssh', host: 'h', port: 22,
  authentication: { method: 'password', password: 'x' } };
const verify = (_key: Buffer, callback: (valid: boolean) => void): void => callback(true);

describe('sshConnectConfig timeouts', () => {
  it('uses the former fixed values without an argument', async () => {
    const { config } = await sshConnectConfig(node, verify);
    expect(config).toMatchObject({ readyTimeout: 120_000, keepaliveInterval: 15_000, keepaliveCountMax: 3 });
  });
  it('converts the given timeouts', async () => {
    const { config } = await sshConnectConfig(node, verify, { idleMinutes: 9, keepaliveSeconds: 7, keepaliveCount: 2, connectSeconds: 30 });
    expect(config).toMatchObject({ readyTimeout: 30_000, keepaliveInterval: 7_000, keepaliveCountMax: 2 });
  });
});
