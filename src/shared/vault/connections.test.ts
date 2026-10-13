import { describe, expect, it } from 'vitest';
import { connectionAddress, redactSecrets } from './connections';
import { removeNodeFromVault } from './mutations';
import { validateVaultConsistency } from './consistency';
import { exampleVault } from './example';
import type { Vault, VaultNode } from './types';

const nodes: VaultNode[] = [{ id: 'f', type: 'folder', name: 'F', children: [
  { id: 's', type: 'connection', protocol: 'ssh', name: 'S', host: 'h', port: 22, tags: [],
    authentication: { method: 'privateKey', keyPath: 'C:/secret-key', passphrase: 'secret-pass' } },
  { id: 'r', type: 'connection', protocol: 'rdp', name: 'R', host: 'h', port: 3389, username: 'D\\u', password: 'secret-rdp', rdp: { clipboard: true }, tags: [] },
  { id: 'p', type: 'connection', protocol: 'cmd', name: 'P', tags: [] },
] }];

describe('connection helpers', () => {
  it('removes every credential for detached windows but keeps display data', () => {
    const redacted = redactSecrets(nodes);
    const text = JSON.stringify(redacted);
    for (const secret of ['secret-key', 'secret-pass', 'secret-rdp']) expect(text).not.toContain(secret);
    const folder = redacted[0];
    if (folder.type !== 'folder') throw new Error('folder expected');
    expect(folder.children.map(node => node.type === 'connection' ? connectionAddress(node) : '')).toEqual(['h:22', 'D\\u@h:3389', 'Lokal · CMD']);
    expect(JSON.stringify(nodes)).toContain('secret-rdp');
  });
});

describe('workspace windows', () => {
  const vault: Vault = { ...exampleVault, workspaces: [{ id: 'w', name: 'W', layout: { type: 'pane', connectionIds: ['connection-dev-api'] },
    windows: [{ bounds: { x: 0, y: 0, width: 800, height: 600 }, layout: { type: 'pane', connectionIds: ['connection-dev-api'], activeConnectionId: 'connection-dev-api' } }] }] };

  it('validates connection references inside window layouts', () => {
    expect(validateVaultConsistency(vault)).toEqual([]);
    const broken = structuredClone(vault);
    broken.workspaces[0].windows![0].layout = { type: 'pane', connectionIds: ['missing'] };
    expect(validateVaultConsistency(broken)[0].path).toContain('windows[0]');
  });

  it('removes deleted connections from window layouts', () => {
    const updated = removeNodeFromVault(vault, 'connection-dev-api');
    expect(updated.workspaces[0].windows![0].layout).toEqual({ type: 'pane', connectionIds: [] });
    expect(validateVaultConsistency(updated)).toEqual([]);
  });
});
