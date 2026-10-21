import { afterEach, describe, expect, it } from 'vitest';
import { i18n } from './i18n';
import type { ConnectionNode } from '../../shared/vault/types';
import { connectionAddress, protocolLabel, protocolShort } from './connection-labels';

const base = { id: 'x', type: 'connection' as const, name: 'X', tags: [] };

describe('connection labels', () => {
  afterEach(async () => { await i18n.changeLanguage('de-DE'); });

  it('names protocols in the UI language', async () => {
    expect(protocolLabel('sftp')).toBe('SFTP (Dateien)');
    expect(protocolLabel('ftp')).toBe('FTP');
    expect(protocolShort('kubernetes')).toBe('K8s');
    await i18n.changeLanguage('en-US');
    expect(protocolLabel('rdp')).toBe('Remote Desktop (RDP)');
    expect(protocolShort('aicli')).toBe('AI CLI');
  });

  it('formats addresses without secrets', () => {
    const nodes: ConnectionNode[] = [
      { ...base, protocol: 'ssh', host: 'h', port: 22, username: 'u', authentication: { method: 'agent' } },
      { ...base, protocol: 'rdp', host: 'h', port: 3389, rdp: { clipboard: true } },
      { ...base, protocol: 'cmd' },
      { ...base, protocol: 'aicli', tool: 'claude' },
      { ...base, protocol: 'aicli', tool: 'custom', command: ' my-tool --flag ' },
      { ...base, protocol: 'aicli', tool: 'custom' },
    ] as ConnectionNode[];
    expect(nodes.map(connectionAddress)).toEqual(['u@h:22', 'h:3389', 'Lokal · cmd', 'Lokal · Claude Code', 'Lokal · my-tool', 'Lokal · Eigener Befehl']);
  });

  it('pluralises cluster access hosts', async () => {
    const cluster = (count: number) => ({ ...base, protocol: 'kubernetes', accessHosts: Array.from({ length: count }, (_, index) => ({ connectionId: `c${index}` })) }) as unknown as ConnectionNode;
    expect(connectionAddress(cluster(1))).toBe('Cluster · 1 Zugang');
    expect(connectionAddress(cluster(3))).toBe('Cluster · 3 Zugänge');
    await i18n.changeLanguage('en-US');
    expect(connectionAddress(cluster(1))).toBe('Cluster · 1 access host');
    expect(connectionAddress(cluster(2))).toBe('Cluster · 2 access hosts');
  });
});
