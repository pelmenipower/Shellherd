import { describe, expect, it } from 'vitest';
import { ConnectionNodeSchema } from './schema';
import { parseVaultDocument } from './migrations';
import { exampleVault } from './example';

const legacyConnection = {
  id: 'legacy-ssh', type: 'connection', name: 'Legacy', host: 'example.test', port: 22, username: 'synthetic',
  authentication: { method: 'password', password: 'synthetic-secret' }, tags: ['a'], color: '#22c55e', icon: 'server',
};
const legacyVault = {
  ...exampleVault, version: 1,
  nodes: [legacyConnection, { id: 'folder', type: 'folder', name: 'Folder', children: [
    { id: 'nested', type: 'folder', name: 'Nested', children: [{ ...legacyConnection, id: 'deep-ssh' }] },
  ] }],
  workspaces: [{ id: 'ws', name: 'WS', layout: { type: 'split', direction: 'horizontal', ratio: 0.5,
    first: { type: 'pane', connectionIds: ['legacy-ssh'] }, second: { type: 'pane', connectionIds: ['deep-ssh'], activeConnectionId: 'deep-ssh' } } }],
};

describe('parseVaultDocument', () => {
  it('migrates version 1 to SSH connections and keeps every other value', () => {
    const { vault, migratedFrom } = parseVaultDocument(structuredClone(legacyVault));
    expect(migratedFrom).toBe(1);
    expect(vault.version).toBe(2);
    expect(vault.nodes[0]).toEqual({ ...legacyConnection, protocol: 'ssh' });
    const folder = vault.nodes[1];
    if (folder.type !== 'folder' || folder.children[0].type !== 'folder') throw new Error('Folders missing');
    expect(folder.children[0].children[0]).toMatchObject({ id: 'deep-ssh', protocol: 'ssh', authentication: { password: 'synthetic-secret' } });
    expect(vault.workspaces).toEqual(legacyVault.workspaces);
    expect(vault.id).toBe(legacyVault.id);
  });

  it('accepts version 2 without migration', () => {
    expect(parseVaultDocument(structuredClone(exampleVault))).toEqual({ vault: exampleVault });
  });

  it('rejects newer and unknown versions instead of guessing', () => {
    expect(() => parseVaultDocument({ ...exampleVault, version: 3 })).toThrow(/neueren Terminus-Version/);
    expect(() => parseVaultDocument({ ...exampleVault, version: 'x' })).toThrow(/nicht unterstützt/);
    expect(() => parseVaultDocument(null)).toThrow(/nicht unterstützt/);
  });

  it('rejects version 2 data claiming to be version 1', () => {
    const rdp = { id: 'rdp', type: 'connection', protocol: 'rdp', name: 'RDP', host: 'h', port: 3389, rdp: { clipboard: true }, tags: [] };
    expect(() => parseVaultDocument({ ...exampleVault, version: 1, nodes: [rdp], workspaces: [] })).toThrow();
  });
});

describe('ConnectionNodeSchema protocols', () => {
  const base = { id: 'x', type: 'connection', name: 'X', tags: [] };
  it('accepts RDP and local shell connections', () => {
    expect(ConnectionNodeSchema.safeParse({ ...base, protocol: 'rdp', host: 'h', port: 3389, username: 'u', password: 'p',
      rdp: { domain: 'D', clipboard: false } }).success).toBe(true);
    expect(ConnectionNodeSchema.safeParse({ ...base, protocol: 'powershell' }).success).toBe(true);
    expect(ConnectionNodeSchema.safeParse({ ...base, protocol: 'cmd', workingDirectory: 'C:\\Temp' }).success).toBe(true);
  });
  it('rejects unknown protocols and incomplete RDP data', () => {
    expect(ConnectionNodeSchema.safeParse({ ...base, protocol: 'telnet' }).success).toBe(false);
    expect(ConnectionNodeSchema.safeParse({ ...base, protocol: 'rdp', host: 'h', port: 3389 }).success).toBe(false);
  });
});
