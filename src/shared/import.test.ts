import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { buildImportNodes, importDuplicates, importFolder, validImportHost } from './import';
import type { ImportCandidate } from './import';
import type { FolderNode, RdpConnectionNode, SftpConnectionNode, SshConnectionNode, VaultNode } from './vault/types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const candidate = (over: Partial<ImportCandidate> = {}): ImportCandidate => ({
  key: 'web-01',
  name: 'web-01',
  protocol: 'ssh',
  folder: [],
  host: 'web-01.example.com',
  port: 22,
  forwards: [],
  notes: [],
  ...over,
});

const all = (list: ImportCandidate[]) => new Set(list.map(c => c.key));

const sshNode = (over: Partial<SshConnectionNode> = {}): VaultNode => ({
  id: randomUUID(),
  type: 'connection',
  name: 'Bestand',
  tags: [],
  protocol: 'ssh',
  host: 'web-01.example.com',
  port: 22,
  authentication: { method: 'agent' },
  ...over,
});

const folder = (name: string, children: VaultNode[]): FolderNode => ({ id: randomUUID(), type: 'folder', name, children });

describe('validImportHost', () => {
  it('accepts plain host names and addresses', () => {
    expect(validImportHost('web-01.example.com')).toBe(true);
    expect(validImportHost('10.0.0.1')).toBe(true);
    expect(validImportHost('::1')).toBe(true);
  });

  it('refuses empty hosts, whitespace, control characters and overlong names', () => {
    expect(validImportHost('')).toBe(false);
    expect(validImportHost('a b')).toBe(false);
    expect(validImportHost('a\tb')).toBe(false);
    expect(validImportHost('a\x7f')).toBe(false);
    expect(validImportHost('a'.repeat(254))).toBe(false);
  });
});

describe('importDuplicates', () => {
  it('matches a saved SSH connection case-insensitively on host', () => {
    const nodes = [sshNode({ host: 'Web-01.Example.com', username: 'demo' })];
    const list = [candidate({ host: 'web-01.example.com', username: 'demo' })];
    expect(importDuplicates(list, nodes)).toEqual(new Set(['web-01']));
  });

  it('treats a missing user as the same user only when both are missing', () => {
    const nodes = [sshNode()];
    expect(importDuplicates([candidate()], nodes).size).toBe(1);
    expect(importDuplicates([candidate({ username: 'demo' })], nodes).size).toBe(0);
  });

  it('compares the port', () => {
    expect(importDuplicates([candidate({ port: 2222 })], [sshNode()]).size).toBe(0);
  });

  it('counts an SFTP connection as the same kind as SSH', () => {
    const sftp: SftpConnectionNode = { id: randomUUID(), type: 'connection', name: 'Dateien', tags: [], protocol: 'sftp', host: 'web-01.example.com', port: 22, authentication: { method: 'agent' } };
    expect(importDuplicates([candidate()], [sftp])).toEqual(new Set(['web-01']));
    expect(importDuplicates([candidate({ protocol: 'sftp' })], [sshNode()])).toEqual(new Set(['web-01']));
  });

  it('keeps RDP apart from SSH and SFTP', () => {
    expect(importDuplicates([candidate({ protocol: 'rdp', port: 3389 })], [sshNode({ port: 3389 })]).size).toBe(0);
    const rdp: RdpConnectionNode = { id: randomUUID(), type: 'connection', name: 'Desktop', tags: [], protocol: 'rdp', host: 'kunde-rdp', port: 3389, rdp: { clipboard: true } };
    expect(importDuplicates([candidate({ key: 'kunde-rdp', host: 'kunde-rdp', port: 3389, protocol: 'rdp' })], [rdp])).toEqual(new Set(['kunde-rdp']));
  });

  it('finds connections inside folders', () => {
    const nodes = [folder('Kunden', [sshNode()])];
    expect(importDuplicates([candidate()], nodes)).toEqual(new Set(['web-01']));
  });

  it('marks the later of two identical candidates in one batch, not the first', () => {
    const list = [candidate({ key: 'a' }), candidate({ key: 'b' })];
    expect(importDuplicates(list, [])).toEqual(new Set(['b']));
  });

  it('does not flag anything when nothing matches', () => {
    expect(importDuplicates([candidate()], [])).toEqual(new Set());
    expect(all([candidate()])).toEqual(new Set(['web-01']));
  });
});

describe('buildImportNodes', () => {
  it('builds an SSH node with agent authentication and no password', () => {
    const { nodes, invalid, jumpsDropped } = buildImportNodes([candidate({ username: 'demo' })], new Set(['web-01']));
    expect(invalid).toBe(0);
    expect(jumpsDropped).toBe(0);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ type: 'connection', name: 'web-01', protocol: 'ssh', host: 'web-01.example.com', port: 22, username: 'demo', tags: [], authentication: { method: 'agent' } });
    expect(nodes[0]).not.toHaveProperty('password');
    expect(nodes[0].id).toMatch(UUID);
  });

  it('uses the key path for privateKey authentication and never reads a key', () => {
    const { nodes } = buildImportNodes([candidate({ keyPath: 'C:\\Users\\demo\\.ssh\\id_ed25519' })], new Set(['web-01']));
    expect(nodes[0]).toMatchObject({ authentication: { method: 'privateKey', keyPath: 'C:\\Users\\demo\\.ssh\\id_ed25519' } });
  });

  it('adds forwards with a fresh uuid and auto false', () => {
    const forwards = [
      { kind: 'local' as const, localPort: 15433, targetHost: 'db-internal', targetPort: 5432 },
      { kind: 'dynamic' as const, localPort: 1080 },
    ];
    const { nodes, invalid } = buildImportNodes([candidate({ forwards })], new Set(['web-01']));
    expect(invalid).toBe(0);
    const ssh = nodes[0] as SshConnectionNode;
    expect(ssh.forwards).toHaveLength(2);
    expect(ssh.forwards?.[0]).toMatchObject({ kind: 'local', localPort: 15433, targetHost: 'db-internal', targetPort: 5432, auto: false });
    expect(ssh.forwards?.[1]).toMatchObject({ kind: 'dynamic', localPort: 1080, auto: false });
    expect(ssh.forwards?.[0].id).toMatch(UUID);
    expect(ssh.forwards?.[1].id).toMatch(UUID);
    expect(ssh.forwards?.[0].id).not.toBe(ssh.forwards?.[1].id);
  });

  it('omits the forwards key when there are none', () => {
    const { nodes } = buildImportNodes([candidate()], new Set(['web-01']));
    expect(nodes[0]).not.toHaveProperty('forwards');
  });

  it('builds an SFTP node without forwards', () => {
    const list = [candidate({ key: 'files', name: 'files', protocol: 'sftp', host: 'files-02', username: 'demo', keyPath: 'C:\\keys\\a' })];
    const { nodes, invalid } = buildImportNodes(list, new Set(['files']));
    expect(invalid).toBe(0);
    expect(nodes[0]).toMatchObject({ type: 'connection', name: 'files', protocol: 'sftp', host: 'files-02', port: 22, username: 'demo', authentication: { method: 'privateKey', keyPath: 'C:\\keys\\a' } });
    expect(nodes[0]).not.toHaveProperty('forwards');
    expect(nodes[0]).not.toHaveProperty('password');
  });

  it('builds an RDP node with clipboard and domain, never a password', () => {
    const list = [candidate({ key: 'kunde-rdp', name: 'kunde-rdp', protocol: 'rdp', host: 'kunde-rdp', port: 3389, username: 'anna', domain: 'KUNDE' })];
    const { nodes, invalid } = buildImportNodes(list, new Set(['kunde-rdp']));
    expect(invalid).toBe(0);
    expect(nodes[0]).toMatchObject({ type: 'connection', name: 'kunde-rdp', protocol: 'rdp', host: 'kunde-rdp', port: 3389, username: 'anna', tags: [], rdp: { clipboard: true, domain: 'KUNDE' } });
    expect(nodes[0]).not.toHaveProperty('authentication');
    expect(nodes[0]).not.toHaveProperty('password');
  });

  it('leaves the domain out of an RDP node without a domain', () => {
    const list = [candidate({ protocol: 'rdp', port: 3389 })];
    const { nodes } = buildImportNodes(list, new Set(['web-01']));
    expect(nodes[0]).toMatchObject({ rdp: { clipboard: true } });
    expect(nodes[0]).not.toHaveProperty('rdp.domain');
  });

  it('keeps unselected candidates out', () => {
    const list = [candidate({ key: 'a' }), candidate({ key: 'b', name: 'b', host: 'b.example.com' })];
    const { nodes } = buildImportNodes(list, new Set(['b']));
    expect(nodes.map(n => n.name)).toEqual(['b']);
  });

  it('counts an invalid node and drops it', () => {
    const { nodes, invalid } = buildImportNodes([candidate({ port: 70000 }), candidate({ key: 'ok', name: 'ok', host: 'ok.example.com' })], new Set(['web-01', 'ok']));
    expect(invalid).toBe(1);
    expect(nodes.map(n => n.name)).toEqual(['ok']);
  });

  it('counts a candidate with an invalid host as invalid', () => {
    const { nodes, invalid } = buildImportNodes([candidate({ host: 'web 01' })], new Set(['web-01']));
    expect(invalid).toBe(1);
    expect(nodes).toEqual([]);
  });

  it('counts a candidate with a blank folder segment as invalid', () => {
    const { nodes, invalid } = buildImportNodes([candidate({ folder: ['Kunden', ' '] })], new Set(['web-01']));
    expect(invalid).toBe(1);
    expect(nodes).toEqual([]);
  });

  it('sets the jump host when the target is selected and valid', () => {
    const list = [
      candidate({ key: 'build-01', name: 'build-01', host: '10.20.0.11' }),
      candidate({ key: 'db-01', name: 'db-01', host: 'db-01', jumpKey: 'build-01' }),
    ];
    const { nodes, jumpsDropped } = buildImportNodes(list, new Set(['build-01', 'db-01']));
    expect(jumpsDropped).toBe(0);
    const [build, db] = nodes as SshConnectionNode[];
    expect(db.jumpHost).toBe(build.id);
    expect(build).not.toHaveProperty('jumpHost');
  });

  it('drops the jump host when the target is not selected', () => {
    const list = [
      candidate({ key: 'build-01', name: 'build-01', host: '10.20.0.11' }),
      candidate({ key: 'db-01', name: 'db-01', host: 'db-01', jumpKey: 'build-01' }),
    ];
    const { nodes, jumpsDropped } = buildImportNodes(list, new Set(['db-01']));
    expect(jumpsDropped).toBe(1);
    expect(nodes[0]).not.toHaveProperty('jumpHost');
  });

  it('drops the jump host when the target is invalid', () => {
    const list = [
      candidate({ key: 'build-01', name: 'build-01', host: '10.20.0.11', port: 70000 }),
      candidate({ key: 'db-01', name: 'db-01', host: 'db-01', jumpKey: 'build-01' }),
    ];
    const { nodes, invalid, jumpsDropped } = buildImportNodes(list, new Set(['build-01', 'db-01']));
    expect(invalid).toBe(1);
    expect(jumpsDropped).toBe(1);
    expect(nodes.map(n => n.name)).toEqual(['db-01']);
    expect(nodes[0]).not.toHaveProperty('jumpHost');
  });

  it('drops the jump host when the target has a jump host itself (one hop only)', () => {
    const list = [
      candidate({ key: 'a', name: 'a', host: 'a.example.com', jumpKey: 'b' }),
      candidate({ key: 'b', name: 'b', host: 'b.example.com', jumpKey: 'c' }),
      candidate({ key: 'c', name: 'c', host: 'c.example.com' }),
    ];
    const { nodes, jumpsDropped } = buildImportNodes(list, new Set(['a', 'b', 'c']));
    expect(jumpsDropped).toBe(1);
    expect(nodes[0]).not.toHaveProperty('jumpHost');
  });

  it('builds nested folders from folder paths: same path is one folder, no empty folders', () => {
    const list = [
      candidate({ key: 'a1', name: 'a1', host: 'a1.example.com', folder: ['Kunden', 'Nord'] }),
      candidate({ key: 'a2', name: 'a2', host: 'a2.example.com', folder: ['Kunden', 'Nord'] }),
      candidate({ key: 'b', name: 'b', host: 'b.example.com', folder: ['Kunden'] }),
      candidate({ key: 'c', name: 'c', host: 'c.example.com' }),
      candidate({ key: 'd', name: 'd', host: 'd.example.com', folder: ['Leer'] }),
    ];
    const { nodes, invalid } = buildImportNodes(list, new Set(['a1', 'a2', 'b', 'c']));
    expect(invalid).toBe(0);
    expect(nodes.map(n => n.name)).toEqual(['Kunden', 'c']);

    const kunden = nodes[0] as FolderNode;
    expect(kunden.type).toBe('folder');
    expect(kunden.children.map(n => n.name)).toEqual(['Nord', 'b']);

    const nord = kunden.children[0] as FolderNode;
    expect(nord.children.map(n => n.name)).toEqual(['a1', 'a2']);
  });

  it('keeps the order of the first child when placing top-level folders', () => {
    const list = [
      candidate({ key: 'x', name: 'x', host: 'x.example.com', folder: ['Zuerst'] }),
      candidate({ key: 'y', name: 'y', host: 'y.example.com' }),
      candidate({ key: 'z', name: 'z', host: 'z.example.com', folder: ['Danach'] }),
    ];
    const { nodes } = buildImportNodes(list, new Set(['x', 'y', 'z']));
    expect(nodes.map(n => n.name)).toEqual(['Zuerst', 'y', 'Danach']);
  });

  it('uses the newId function for every new id', () => {
    let counter = 0;
    const newId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
    const { nodes } = buildImportNodes([candidate({ folder: ['Kunden'] })], new Set(['web-01']), newId);
    expect(nodes[0].id).toMatch(UUID);
    expect((nodes[0] as FolderNode).children[0].id).toBe('00000000-0000-4000-8000-000000000001');
    expect((nodes[0] as FolderNode).id).toBe('00000000-0000-4000-8000-000000000002');
  });
});

describe('importFolder', () => {
  it('wraps the children in a folder with a trimmed name', () => {
    const child = sshNode();
    const result = importFolder('  OpenSSH-Import  ', [child]);
    expect(result).toEqual({ id: expect.stringMatching(UUID), type: 'folder', name: 'OpenSSH-Import', children: [child] });
  });
});
