import { describe, expect, it } from 'vitest';
import { connectionsIn, redactSecrets, redactVault } from './connections';
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
    expect(folder.children.map(node => node.type === 'connection' && 'host' in node ? [node.host, node.port] : null)).toEqual([['h', 22], ['h', 3389], null]);
    expect(JSON.stringify(nodes)).toContain('secret-rdp');
  });
});

describe('login block redaction', () => {
  const login = { sudo: true, commands: ['synthetic-command'] };
  const ssh: VaultNode = { id: 's', type: 'connection', protocol: 'ssh', name: 'S', host: 'h', port: 22, tags: [],
    authentication: { method: 'password', password: 'secret-pw' }, login, containers: { sudo: true }, timeouts: { idleMinutes: 5 } };

  it('removes login from SSH nodes but keeps containers and timeouts', () => {
    const [node] = redactSecrets([ssh]);
    expect(node).not.toHaveProperty('login');
    expect(node).toMatchObject({ containers: { sudo: true }, timeouts: { idleMinutes: 5 }, authentication: { method: 'agent' } });
    expect(ssh).toHaveProperty('login');
  });

  it('removes login in redactVault, also inside folders', () => {
    const redacted = redactVault({ ...exampleVault, nodes: [{ id: 'f', type: 'folder', name: 'F', children: [ssh] }] });
    expect(JSON.stringify(redacted)).not.toContain('synthetic-command');
  });
});

describe('redactVault', () => {
  it('strips secrets and AI settings but keeps everything else', () => {
    const vault: Vault = { ...exampleVault, nodes, ai: { providers: [{ id: 'p', apiKey: 'secret-ai' }] } as unknown as Vault['ai'] };
    const before = JSON.stringify(vault);
    const redacted = redactVault(vault);
    const text = JSON.stringify(redacted);
    for (const secret of ['secret-key', 'secret-pass', 'secret-rdp', 'secret-ai']) expect(text).not.toContain(secret);
    expect(redacted).not.toHaveProperty('ai');
    expect(redacted.id).toBe(vault.id);
    expect(redacted.name).toBe(vault.name);
    expect(redacted.workflows).toBe(vault.workflows);
    expect(redacted.workspaces).toBe(vault.workspaces);
    expect(redacted.settings).toBe(vault.settings);
    expect(JSON.stringify(vault)).toBe(before);
  });

  it('keeps autoUpload as the same array reference', () => {
    const autoUpload = [{ localPath: 'a' }];
    const ssh = { id: 's', type: 'connection', protocol: 'ssh', name: 'S', host: 'h', port: 22, tags: [], authentication: { method: 'password', password: 'x' }, autoUpload } as unknown as VaultNode;
    const redacted = redactVault({ ...exampleVault, nodes: [ssh] });
    expect((redacted.nodes[0] as unknown as { autoUpload: unknown }).autoUpload).toBe(autoUpload);
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

  it('validates and prunes views of the workspace and of its windows', () => {
    const pane = { type: 'pane' as const, connectionIds: ['connection-dev-api'] };
    const withViews: Vault = { ...vault, workspaces: [{ ...vault.workspaces[0], views: [{ name: 'A', layout: pane }, { name: 'B', layout: pane }],
      windows: [{ ...vault.workspaces[0].windows![0], views: [{ name: 'C', layout: pane }] }] }] };
    expect(validateVaultConsistency(withViews)).toEqual([]);
    const broken = structuredClone(withViews);
    broken.workspaces[0].windows![0].views![0].layout = { type: 'pane', connectionIds: ['missing'] };
    expect(validateVaultConsistency(broken)[0].path).toContain('windows[0].views[0]');
    const updated = removeNodeFromVault(withViews, 'connection-dev-api');
    expect(updated.workspaces[0].views!.map(view => view.layout)).toEqual([{ type: 'pane', connectionIds: [] }, { type: 'pane', connectionIds: [] }]);
    expect(updated.workspaces[0].windows![0].views![0].layout).toEqual({ type: 'pane', connectionIds: [] });
  });

  it('removes deleted connections from window layouts', () => {
    const updated = removeNodeFromVault(vault, 'connection-dev-api');
    expect(updated.workspaces[0].windows![0].layout).toEqual({ type: 'pane', connectionIds: [] });
    expect(validateVaultConsistency(updated)).toEqual([]);
  });
});

describe('disabled connections', () => {
  const tree: VaultNode[] = [
    { id: 'a', type: 'connection', protocol: 'cmd', name: 'A', tags: [] },
    { id: 'sub', type: 'folder', name: 'Sub', children: [
      { id: 'b', type: 'connection', protocol: 'cmd', name: 'B', tags: [], disabled: true },
      { id: 'c', type: 'connection', protocol: 'cmd', name: 'C', tags: [], disabled: false },
    ] },
  ];
  it('collects active connections of a folder tree and counts disabled ones', () => {
    const result = connectionsIn(tree);
    expect(result.connections.map(node => node.id)).toEqual(['a', 'c']);
    expect(result.disabled).toBe(1);
  });
});
