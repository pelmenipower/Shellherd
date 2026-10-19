import { describe, expect, it } from 'vitest';
import { connectionAddress, connectionsIn, disabledNotice, redactSecrets, sessionLimitNotice, sessionLimitText, skippedNotice } from './connections';
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
  it('reports skipped disabled connections in singular and plural', () => {
    expect(skippedNotice(1)).toBe('1 deaktivierte Verbindung wurde übersprungen.');
    expect(skippedNotice(3)).toBe('3 deaktivierte Verbindungen wurden übersprungen.');
  });
  it('explains how to re-enable a disabled connection', () => {
    expect(disabledNotice({ id: 'b', type: 'connection', protocol: 'cmd', name: 'B', tags: [], disabled: true }))
      .toBe('Die Verbindung „B“ ist deaktiviert. Per Rechtsklick → „Aktivieren“ wieder freigeben.');
  });
});

describe('session limit texts', () => {
  it('builds the toast and the sentence', () => {
    expect(sessionLimitNotice()).toEqual({ title: 'Maximal 16 Sessions', body: 'Schließe zuerst einen Tab.' });
    expect(sessionLimitText()).toBe('Maximal 16 Sessions gleichzeitig. Schließe zuerst einen Tab.');
    expect(sessionLimitText(4)).toBe('Maximal 4 Sessions gleichzeitig. Schließe zuerst einen Tab.');
  });
});
