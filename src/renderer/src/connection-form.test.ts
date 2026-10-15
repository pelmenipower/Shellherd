import { describe, expect, it } from 'vitest';
import { ConnectionFieldError, connectionFromFields, fieldsFromConnection, folderOptions, parentFolderId } from './connection-form';
import { redactSecrets } from '../../shared/vault/connections';
import type { ConnectionFields } from './connection-form';
import type { VaultNode } from '../../shared/vault/types';

const fields: ConnectionFields = {
  name: ' API ', comment: ' comment ', host: ' api.example.test ', port: '22', username: ' deploy ',
  method: 'agent', password: 'synthetic-only', keyPath: '/synthetic/key', passphrase: 'synthetic-only',
  domain: '', clipboard: 'on', workingDirectory: '', tool: 'claude', command: '',
  tags: 'prod, linux, prod, ,', color: '', icon: 'terminal', containerSudo: 'off', disabled: 'off',
};

/** SSH result narrowed for property assertions. */
function ssh(input: ConnectionFields) {
  const connection = connectionFromFields('id', input);
  if (connection.protocol !== 'ssh') throw new Error('Expected SSH');
  return connection;
}

describe('connection form per protocol', () => {
  it('builds RDP connections and rejects a domain given twice', () => {
    const rdp = connectionFromFields('id', { ...fields, port: '3389', domain: ' EXAMPLE ', password: 'pw', clipboard: 'off' }, 'rdp');
    expect(rdp).toMatchObject({ protocol: 'rdp', host: 'api.example.test', port: 3389, username: 'deploy', password: 'pw', rdp: { domain: 'EXAMPLE', clipboard: false } });
    expect(rdp).not.toHaveProperty('authentication');
    expect(connectionFromFields('id', { ...fields, password: '' }, 'rdp')).not.toHaveProperty('password');
    expect(() => connectionFromFields('id', { ...fields, username: 'D\\user', domain: 'D' }, 'rdp')).toThrow(ConnectionFieldError);
    expect(() => connectionFromFields('id', { ...fields, username: 'user@d.test', domain: 'D' }, 'rdp')).toThrow('Domäne');
  });
  it('builds SFTP connections with SSH authentication and redacts them for other windows', () => {
    const sftp = connectionFromFields('id', { ...fields, method: 'password', password: 'synthetic-only', icon: 'files' }, 'sftp');
    expect(sftp).toMatchObject({ protocol: 'sftp', host: 'api.example.test', port: 22, username: 'deploy', authentication: { method: 'password', password: 'synthetic-only' } });
    expect(fieldsFromConnection('sftp', sftp)).toMatchObject({ host: 'api.example.test', method: 'password', password: 'synthetic-only' });
    expect(JSON.stringify(redactSecrets([sftp]))).not.toContain('synthetic-only');
  });
  it('keeps the container sudo option of SSH connections', () => {
    const fields = { ...fieldsFromConnection('ssh'), name: 'srv', host: 'srv', username: 'root', containerSudo: 'on' as const };
    const node = connectionFromFields('id1', fields, 'ssh');
    expect(node).toMatchObject({ protocol: 'ssh', containers: { sudo: true } });
    expect(fieldsFromConnection('ssh', node).containerSudo).toBe('on');
    expect(connectionFromFields('id1', { ...fields, containerSudo: 'off' }, 'ssh')).not.toHaveProperty('containers');
  });
  it('builds AI CLI tabs: preset tools without a command, custom ones with exactly one line', () => {
    const claude = connectionFromFields('id', { ...fields, tool: 'codex', command: 'ignored', workingDirectory: ' C:\\Projekte\\x ' }, 'aicli');
    expect(claude).toMatchObject({ protocol: 'aicli', tool: 'codex', workingDirectory: 'C:\\Projekte\\x' });
    expect(claude).not.toHaveProperty('command');
    expect(connectionFromFields('id', { ...fields, tool: 'custom', command: ' aider --model sonnet ' }, 'aicli')).toMatchObject({ tool: 'custom', command: 'aider --model sonnet' });
    expect(() => connectionFromFields('id', { ...fields, tool: 'custom', command: ' ' }, 'aicli')).toThrow(ConnectionFieldError);
    expect(() => connectionFromFields('id', { ...fields, tool: 'custom', command: 'a\nb' }, 'aicli')).toThrow('eine Zeile');
    expect(fieldsFromConnection('aicli', claude)).toMatchObject({ tool: 'codex', workingDirectory: 'C:\\Projekte\\x' });
  });
  it('builds local shells without host or credentials', () => {
    const shell = connectionFromFields('id', { ...fields, host: '', port: '', workingDirectory: ' C:\\Temp ' }, 'powershell');
    expect(shell).toEqual({ id: 'id', type: 'connection', protocol: 'powershell', name: 'API', comment: 'comment', tags: ['prod', 'linux'], icon: 'terminal', workingDirectory: 'C:\\Temp' });
    expect(connectionFromFields('id', { ...fields, workingDirectory: '' }, 'cmd')).not.toHaveProperty('workingDirectory');
  });
});

describe('connection form validation', () => {
  it('preserves the selected symbol and color and rejects unknown symbols', () => {
    expect(ssh({ ...fields, icon: 'database', color: '#fbbf24' })).toMatchObject({ icon: 'database', color: '#fbbf24' });
    expect(() => ssh({ ...fields, icon: 'unknown' })).toThrow('Symbol');
  });
  it('normalizes metadata and excludes secrets from agent authentication', () => {
    const connection = ssh(fields);
    expect(connection).toMatchObject({ name: 'API', host: 'api.example.test', port: 22, username: 'deploy', tags: ['prod', 'linux'] });
    expect(connection.authentication).toEqual({ method: 'agent' });
  });
  it.each(['', '0', '65536', '22.5', '1e2', '-22', '22ssh', 'Infinity'])('rejects invalid port %s', port => {
    expect(() => ssh({ ...fields, port })).toThrow('Port');
  });
  it.each(['1', '65535'])('accepts valid port boundary %s', port => {
    expect(ssh({ ...fields, port }).port).toBe(Number(port));
  });
  it('retains only fields for the chosen authentication method', () => {
    expect(ssh({ ...fields, method: 'password' }).authentication)
      .toEqual({ method: 'password', password: 'synthetic-only' });
    expect(ssh({ ...fields, method: 'privateKey', passphrase: '' }).authentication)
      .toEqual({ method: 'privateKey', keyPath: '/synthetic/key' });
  });
  it('rejects blank required fields and invalid color', () => {
    expect(() => ssh({ ...fields, name: ' ' })).toThrow();
    expect(() => ssh({ ...fields, host: ' ' })).toThrow();
    expect(() => ssh({ ...fields, method: 'privateKey', keyPath: ' ' })).toThrow();
    expect(() => ssh({ ...fields, color: 'red' })).toThrow();
  });
  it.each([
    ['name', { name: ' ' }], ['host', { host: '' }], ['port', { port: '22ssh' }],
    ['keyPath', { method: 'privateKey', keyPath: '' }], ['color', { color: 'red' }],
  ] as const)('identifies the invalid %s field for accessible feedback', (field, invalid) => {
    try {
      ssh({ ...fields, ...invalid });
      throw new Error('Expected validation failure');
    } catch (error) {
      expect(error).toBeInstanceOf(ConnectionFieldError);
      expect((error as ConnectionFieldError).field).toBe(field);
    }
  });
});

describe('connection destinations', () => {
  const connection = connectionFromFields('connection', fields);
  const nodes: VaultNode[] = [connection, { id: 'outer', type: 'folder', name: 'Outer', children: [
    { id: 'inner', type: 'folder', name: 'Inner', children: [{ ...connection, id: 'nested' }] },
  ] }];
  it('lists nested folders with their full path', () => {
    expect(folderOptions(nodes)).toEqual([{ id: 'outer', label: 'Outer' }, { id: 'inner', label: 'Outer / Inner' }]);
  });
  it('distinguishes root, nested parent and missing connection', () => {
    expect(parentFolderId(nodes, 'connection')).toBe('');
    expect(parentFolderId(nodes, 'nested')).toBe('inner');
    expect(parentFolderId(nodes, 'missing')).toBeUndefined();
  });
});

describe('disabled connections in the editor', () => {
  it('keeps a connection disabled when it is edited and saved', () => {
    const node: VaultNode = { id: 'c', type: 'connection', protocol: 'cmd', name: 'CMD', tags: [], disabled: true };
    if (node.type !== 'connection') throw new Error('fixture');
    expect(connectionFromFields('c', fieldsFromConnection('cmd', node), 'cmd')).toMatchObject({ disabled: true });
    expect(connectionFromFields('c', { ...fieldsFromConnection('cmd'), name: 'Neu' }, 'cmd')).not.toHaveProperty('disabled');
  });
});
