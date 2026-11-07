import { describe, expect, it } from 'vitest';
import { exampleVault } from '../../shared/vault/example';
import type { FolderNode, SshConnectionNode, Vault, VaultNode } from '../../shared/vault/types';
import { materializeVault, mergePortableVaults, resolveVaultConfigurationConflicts, splitVaultForSync, validatePortableVault } from './vault-merge';

function fixture(): Vault {
  const v: Vault = structuredClone(exampleVault);
  const folder = v.nodes[0] as FolderNode;
  const first = folder.children[0] as SshConnectionNode;
  first.authentication = { method: 'password', password: 'FIXTURE_API_INITIAL' };
  folder.children.push({ ...structuredClone(first), id: 'db', host: 'db.internal', authentication: { method: 'password', password: 'FIXTURE_DB_INITIAL' } });
  v.nodes.push({ type: 'folder', id: 'other', name: 'Other', children: [] });
  return v;
}
function find(v: Vault, id: string): VaultNode {
  const walk = (nodes: VaultNode[]): VaultNode | undefined => {
    for (const n of nodes) { if (n.id === id) return n; if (n.type === 'folder') { const found = walk(n.children); if (found) return found; } }
  };
  const value = walk(v.nodes); if (!value) throw Error('Missing fixture node'); return value;
}
const ssh = (v: Vault, id = 'connection-dev-api') => find(v, id) as SshConnectionNode;
const portable = (v: Vault) => splitVaultForSync(v).portable;
const merge = (b: Vault, l: Vault, r: Vault) => mergePortableVaults(portable(b), portable(l), portable(r));

describe('experimental real Vault three-way adapter', () => {
  it('resolves an explicitly chosen whole configuration while preserving independent metadata and other edits', () => {
    const b = fixture(); const l = structuredClone(b); const r = structuredClone(b);
    ssh(l).host = 'left.invalid'; ssh(l).authentication = { method: 'password', password: 'LEFT' };
    ssh(r).host = 'right.invalid'; ssh(r).authentication = { method: 'password', password: 'RIGHT' };
    ssh(l).comment = 'Independent API comment'; ssh(r, 'db').name = 'Independent DB name';
    for (const side of ['left', 'right'] as const) {
      const resolved = resolveVaultConfigurationConflicts(portable(b), portable(l), portable(r), [{ id: ssh(b).id, side }]);
      const view = materializeVault(resolved).vault!;
      expect(ssh(view).host).toBe(side === 'left' ? 'left.invalid' : 'right.invalid');
      expect(ssh(view).authentication).toEqual({ method: 'password', password: side === 'left' ? 'LEFT' : 'RIGHT' });
      expect(ssh(view).comment).toBe('Independent API comment'); expect(ssh(view, 'db').name).toBe('Independent DB name');
    }
    expect(() => resolveVaultConfigurationConflicts(portable(b), portable(l), portable(r), [])).toThrow('choices');
    expect(() => resolveVaultConfigurationConflicts(portable(b), portable(l), portable(r), [{ id: 'not-conflicted', side: 'left' }])).toThrow('choices');
  });
  it('merges independent credential edits inside the same folder, preserves inputs and ignores clock ordering', () => {
    const b = fixture(); const l = structuredClone(b); const r = structuredClone(b);
    ssh(l).authentication = { method: 'password', password: 'FIXTURE_LEFT' };
    ssh(r, 'db').authentication = { method: 'password', password: 'FIXTURE_RIGHT' };
    l.updatedAt = '2099-01-01T00:00:00.000Z'; r.updatedAt = '2001-01-01T00:00:00.000Z';
    const before = structuredClone([b, l, r]); const result = merge(b, l, r);
    expect(result.conflicts).toEqual([]);
    expect([b, l, r]).toEqual(before);
    const view = materializeVault(result.portable, splitVaultForSync(b).local);
    expect(ssh(view.vault!).authentication).toEqual({ method: 'password', password: 'FIXTURE_LEFT' });
    expect(ssh(view.vault!, 'db').authentication).toEqual({ method: 'password', password: 'FIXTURE_RIGHT' });
    expect(ssh(view.vault!).disabled).toBe(true);
    expect(view.needsApproval.sort()).toEqual(['connection-dev-api', 'db']);
    expect(result.portable!.document.updatedAt).toBe(b.updatedAt);
  });

  it('combines display metadata with a unilateral configuration change and compares object keys semantically', () => {
    const b = fixture(); const l = structuredClone(b); const r = structuredClone(b);
    ssh(l).host = 'changed.internal'; ssh(r).name = 'Renamed'; ssh(r, 'db').comment = 'New note';
    const result = merge(b, l, r);
    expect(result.conflicts).toEqual([]);
    const view = materializeVault(result.portable).vault!;
    expect(ssh(view).host).toBe('changed.internal'); expect(ssh(view).name).toBe('Renamed');
    // Reorder the properties of a connection only, retaining all nested values.
    const rr = structuredClone(b);
    (rr.nodes[0] as FolderNode).children[0] = Object.fromEntries(Object.entries(ssh(rr)).reverse()) as unknown as SshConnectionNode;
    expect(merge(b, b, rr).conflicts).toEqual([]);
  });

  it('never synthesizes credentials and targets from concurrent changes, and retains complete variants', () => {
    const b = fixture(); const l = structuredClone(b); const r = structuredClone(b);
    ssh(l).host = 'new-target.internal'; ssh(r).authentication = { method: 'password', password: 'OTHER_SECRET' };
    const result = merge(b, l, r);
    expect(result.portable).toBeNull();
    expect(result.conflicts).toContainEqual({ scope: 'node', id: 'connection-dev-api', field: 'configuration-or-move' });
    expect(JSON.stringify(result.variants.left)).toContain('new-target.internal');
    expect(JSON.stringify(result.variants.right)).toContain('OTHER_SECRET');
    expect(JSON.stringify(result.conflicts)).not.toContain('OTHER_SECRET');
  });

  it('reports deletion versus edit and independently created ID collisions', () => {
    const b = fixture(); const l = structuredClone(b); const r = structuredClone(b);
    (l.nodes[0] as FolderNode).children = [ssh(l)]; ssh(r, 'db').name = 'Edited DB';
    expect(merge(b, l, r).conflicts).toContainEqual({ scope: 'node', id: 'db', field: 'delete-edit' });
    const ll = structuredClone(b); const rr = structuredClone(b);
    (ll.nodes[0] as FolderNode).children.push({ ...structuredClone(ssh(b)), id: 'collision' });
    (rr.nodes[0] as FolderNode).children.push({ ...structuredClone(ssh(b)), id: 'collision' });
    expect(merge(b, ll, rr).conflicts).toContainEqual({ scope: 'node', id: 'collision', field: 'id-collision' });
  });

  it('merges concurrent additions by ID and preserves deliberate unilateral reordering', () => {
    const b = fixture(); const l = structuredClone(b); const r = structuredClone(b);
    (l.nodes[0] as FolderNode).children.push({ ...structuredClone(ssh(b)), id: 'new-z' });
    (r.nodes[0] as FolderNode).children.push({ ...structuredClone(ssh(b)), id: 'new-a' });
    const merged = merge(b, l, r);
    expect(merged.conflicts).toEqual([]);
    const view = materializeVault(merged.portable).vault!;
    expect((view.nodes[0] as FolderNode).children.map(n => n.id)).toEqual(['connection-dev-api', 'db', 'new-a', 'new-z']);
    const reordered = structuredClone(b); (reordered.nodes[0] as FolderNode).children.reverse();
    ssh(r, 'db').name = 'Changed display only';
    expect((materializeVault(merge(b, reordered, r).portable).vault!.nodes[0] as FolderNode).children[0].id).toBe('db');
  });

  it('rejects contradictory ordering and cross-branch folder cycles', () => {
    const b = fixture(); (b.nodes[0] as FolderNode).children.push({ ...structuredClone(ssh(b)), id: 'third' });
    const l = structuredClone(b); const r = structuredClone(b);
    const lc = (l.nodes[0] as FolderNode).children; [lc[0], lc[1]] = [lc[1], lc[0]];
    const rc = (r.nodes[0] as FolderNode).children; [rc[1], rc[2]] = [rc[2], rc[1]];
    expect(merge(b, l, r).conflicts.some(c => c.scope === 'order')).toBe(true);
    const left = fixture(); const right = fixture();
    const [la, lb] = left.nodes as FolderNode[]; lb.children.push(la); left.nodes = [lb];
    const [ra, rb] = right.nodes as FolderNode[]; ra.children.push(rb); right.nodes = [ra];
    expect(merge(fixture(), left, right).conflicts.some(c => c.scope === 'structure')).toBe(true);
  });

  it('detects dangling workspace and jump-host references introduced only by consolidation', () => {
    const b = fixture(); const l = structuredClone(b); const r = structuredClone(b);
    (l.nodes[0] as FolderNode).children = [ssh(l)];
    if (r.workspaces[0].layout.type === 'pane') r.workspaces[0].layout.connectionIds.push('db');
    expect(merge(b, l, r).conflicts.some(c => c.scope === 'references')).toBe(true);
    const jump = structuredClone(b); ssh(jump).jumpHost = 'db';
    expect(merge(b, l, jump).conflicts.some(c => c.scope === 'references')).toBe(true);
  });

  it('handles workspace units atomically instead of splicing incompatible layouts', () => {
    const b = fixture(); const l = structuredClone(b); const r = structuredClone(b);
    l.workspaces[0].name = 'Left'; r.workspaces[0].name = 'Right';
    expect(merge(b, l, r).conflicts).toContainEqual({ scope: 'workspace', id: b.workspaces[0].id });
  });

  it('rejects unknown fields, duplicates, foreign Vaults, excessive nesting and broken source references', () => {
    const b = fixture(); const unknown = structuredClone(b) as Vault & { futureSecrets: string };
    unknown.futureSecrets = 'MUST_NOT_BE_SILENTLY_DROPPED';
    expect(() => portable(unknown)).toThrow('Unsupported');
    const duplicate = structuredClone(b); duplicate.nodes.push(structuredClone(ssh(b)));
    expect(() => portable(duplicate)).toThrow();
    const foreign = fixture(); foreign.id = 'different-vault'; expect(() => merge(b, foreign, b)).toThrow('identity');
    const broken = fixture(); ssh(broken).jumpHost = 'missing'; expect(() => portable(broken)).toThrow('reference');
    const deep = fixture(); let nested = deep.nodes;
    for (let i = 0; i < 60; i++) { const next: FolderNode = { id: 'deep' + i, type: 'folder', name: 'deep', children: [] }; nested.push(next); nested = next.children; }
    expect(() => portable(deep)).toThrow('limit');
    const unsafe = JSON.parse(JSON.stringify(b)); unsafe.workflows = JSON.parse('{"__proto__":{"polluted":true}}');
    expect(() => portable(unsafe)).toThrow('unsafe');
  });
});

describe('device-specific binding projection', () => {
  it('keeps key paths, key passphrases, auto-upload, login commands and port bindings local', () => {
    const v = fixture(); const node = ssh(v);
    node.authentication = { method: 'privateKey', keyPath: '/home/local-only/id_ed25519', passphrase: 'LOCAL_KEY_PHRASE' };
    node.login = { commands: ['echo LOCAL_BOOT_ACTION'] };
    node.forwards = [{ id: '550e8400-e29b-41d4-a716-446655440000', kind: 'dynamic', localPort: 1080, auto: true }];
    node.autoUpload = [{ id: '550e8400-e29b-41d4-a716-446655440001', localPath: '/home/local-only/project', remotePath: '/deploy', excludes: [], enabled: true }];
    const split = splitVaultForSync(v); const wire = JSON.stringify(split.portable);
    for (const secret of ['local-only', 'LOCAL_KEY_PHRASE', 'LOCAL_BOOT_ACTION', 'autoUpload', 'forwards']) expect(wire).not.toContain(secret);
    const original = materializeVault(split.portable, split.local);
    expect(ssh(original.vault!).authentication).toEqual(node.authentication);
    expect(ssh(original.vault!).autoUpload).toEqual(node.autoUpload);
    expect(original.needsApproval).toEqual([]);
    const newDevice = materializeVault(split.portable);
    expect(newDevice.vault).toBeNull(); expect(newDevice.needsBindings).toEqual([node.id]);
    const windows = structuredClone(v); ssh(windows).authentication = { method: 'privateKey', keyPath: 'C:\\Keys\\device.pem' };
    const second = splitVaultForSync(windows);
    expect(second.portable).toEqual(split.portable);
    expect(ssh(materializeVault(split.portable, second.local).vault!).authentication).toEqual(ssh(windows).authentication);
  });

  it('invalidates approvals when a target changes or moves, but preserves them for a display rename', () => {
    const b = fixture(); ssh(b).login = { commands: ['echo LOCAL_ONLY_START'] }; const split = splitVaultForSync(b);
    const renamed = structuredClone(b); ssh(renamed).name = 'Renamed';
    expect(materializeVault(portable(renamed), split.local).needsApproval).toEqual([]);
    const moved = structuredClone(b); const node = (moved.nodes[0] as FolderNode).children.shift()!; (moved.nodes[1] as FolderNode).children.push(node);
    expect(materializeVault(portable(moved), split.local).needsApproval).toEqual([node.id]);
    const changed = structuredClone(b); ssh(changed).host = 'different.internal';
    expect(ssh(materializeVault(portable(changed), split.local).vault!).disabled).toBe(true);
    expect(ssh(materializeVault(portable(changed), split.local).vault!).login).toBeUndefined();
    expect(materializeVault(portable(b)).vault!.nodes).toBeDefined();
    expect(ssh(materializeVault(portable(b)).vault!).disabled).toBe(true);
  });

  it('keeps shell directories, kubeconfig paths, clipboard consent and lock policy device-specific', () => {
    const v = fixture(); v.settings.autoLockMinutes = 0; v.settings.confirmBeforeClosingSession = false;
    v.nodes.push({ id: 'shell', type: 'connection', protocol: 'bash', name: 'shell', tags: [], workingDirectory: '/local/work' });
    v.nodes.push({ id: 'cluster', type: 'connection', protocol: 'kubernetes', name: 'cluster', tags: [], accessHosts: ['db'], kubeconfig: { source: 'path', path: '/local/kube' }, production: true, readOnly: true });
    v.nodes.push({ id: 'desktop', type: 'connection', protocol: 'rdp', name: 'desktop', tags: [], host: 'desktop.internal', port: 3389, rdp: { clipboard: true } });
    const split = splitVaultForSync(v);
    expect(JSON.stringify(split.portable)).not.toContain('/local/');
    const own = materializeVault(split.portable, split.local).vault!;
    expect(own.settings.autoLockMinutes).toBe(0); expect(own.settings.confirmBeforeClosingSession).toBe(false);
    expect(find(own, 'desktop')).toMatchObject({ rdp: { clipboard: true } });
    const other = materializeVault(split.portable);
    expect(other.vault).toBeNull(); expect(other.needsBindings).toContain('cluster');
    const ordinary = splitVaultForSync(fixture());
    expect(materializeVault(ordinary.portable).vault!.settings.autoLockMinutes).toBe(15);
    expect(materializeVault(ordinary.portable).vault!.settings.confirmBeforeClosingSession).toBe(true);
    const malicious = structuredClone(split.portable) as any;
    malicious.document.nodes[0].children[0].login = { commands: ['echo remote'] };
    expect(() => validatePortableVault(malicious)).toThrow('Device fields');
    const unlocked = structuredClone(split.portable);
    (unlocked.document.settings as Record<string, unknown>).autoLockMinutes = 0;
    expect(() => validatePortableVault(unlocked)).toThrow('Device fields');
  });

  it('holds AI endpoint use until local approval and retains retired data exclusively locally', () => {
    const v = fixture(); v.workflows = { path: '/retired/local-only' };
    v.ai = { providers: [{ id: 'provider', name: 'provider', kind: 'openai', model: 'fixture', apiKey: 'PORTABLE_ENCRYPTED_API_KEY', baseUrl: 'https://provider.example/api' }], defaultProviderId: 'provider' };
    const split = splitVaultForSync(v);
    expect(JSON.stringify(split.portable)).not.toContain('retired/local-only');
    expect(materializeVault(split.portable, split.local).vault!.ai).toEqual(v.ai);
    const newDevice = materializeVault(split.portable);
    expect(newDevice.vault!.ai).toBeUndefined(); expect(newDevice.needsApproval).toContain('ai');
    const changed = structuredClone(v); changed.ai!.providers[0].baseUrl = 'https://changed.example/api';
    expect(materializeVault(portable(changed), split.local).vault!.ai).toBeUndefined();
    expect(materializeVault(split.portable, split.local).vault!.workflows).toEqual(v.workflows);
  });

  it('keeps detached window geometry and executable toolbar settings local and holds them on changed documents', () => {
    const v = fixture(); v.toolbar = { mode: 'execute', items: [] };
    v.workspaces[0].windows = [{ bounds: { x: -777, y: 0, width: 900, height: 600 }, layout: structuredClone(v.workspaces[0].layout) }];
    const split = splitVaultForSync(v);
    expect(JSON.stringify(split.portable)).not.toContain('"toolbar"');
    expect(JSON.stringify(split.portable)).not.toContain('"bounds"');
    const original = materializeVault(split.portable, split.local);
    expect(original.vault!.toolbar).toEqual(v.toolbar); expect(original.vault!.workspaces[0].windows).toEqual(v.workspaces[0].windows);
    const changed = structuredClone(v); ssh(changed).name = 'New display';
    const projected = materializeVault(portable(changed), split.local);
    expect(projected.localActionsHeld).toBe(true);
    expect(projected.vault!.toolbar).toBeUndefined(); expect(projected.vault!.workspaces[0].windows).toBeUndefined();
    const invalid = fixture(); if (invalid.workspaces[0].layout.type === 'pane') invalid.workspaces[0].layout.fileBrowsers = [6];
    expect(() => portable(invalid)).toThrow('index reference');
  });
});
