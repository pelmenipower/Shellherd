import { describe, expect, it } from 'vitest';
import type { ConnectionNode, VaultNode } from '../../shared/vault/types';
import { searchVaultNodes } from './vault-search';

const server: ConnectionNode = { id: 'web', type: 'connection', name: 'Webserver', host: 'web.example.test', port: 22, username: 'deploy', tags: ['production'], authentication: { method: 'password', password: 'hidden-secret' } };
const nodes: VaultNode[] = [{ id: 'folder', type: 'folder', name: 'Europa', children: [server] }];

describe('vault search', () => {
  it('matches all query terms across metadata and ancestor paths', () => {
    expect(searchVaultNodes(nodes, ' EUROPA deploy Production ')).toEqual([{ node: server, path: 'Europa' }]);
    expect(searchVaultNodes(nodes, 'web.example')).toHaveLength(1);
    expect(searchVaultNodes(nodes, 'Europa missing')).toEqual([]);
  });
  it('does not search passwords, key paths, or passphrases', () => {
    expect(searchVaultNodes(nodes, 'hidden-secret')).toEqual([]);
    const keyNode: ConnectionNode = { ...server, authentication: { method: 'privateKey', keyPath: 'secret-path', passphrase: 'hidden-passphrase' } };
    expect(searchVaultNodes([keyNode], 'secret-path')).toEqual([]);
    expect(searchVaultNodes([keyNode], 'hidden-passphrase')).toEqual([]);
  });
});
