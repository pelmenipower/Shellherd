import { describe, expect, it } from 'vitest';
import { ConnectionFieldError, connectionFromFields, folderOptions, parentFolderId } from './connection-form';
import type { ConnectionFields } from './connection-form';
import type { VaultNode } from '../../shared/vault/types';

const fields: ConnectionFields = {
  name: ' API ', comment: ' comment ', host: ' api.example.test ', port: '22', username: ' deploy ',
  method: 'agent', password: 'synthetic-only', keyPath: '/synthetic/key', passphrase: 'synthetic-only',
  tags: 'prod, linux, prod, ,', color: '', icon: 'terminal',
};

describe('connection form validation', () => {
  it('preserves the selected symbol and color and rejects unknown symbols', () => {
    expect(connectionFromFields('id', { ...fields, icon: 'database', color: '#fbbf24' })).toMatchObject({ icon: 'database', color: '#fbbf24' });
    expect(() => connectionFromFields('id', { ...fields, icon: 'unknown' })).toThrow('Symbol');
  });
  it('normalizes metadata and excludes secrets from agent authentication', () => {
    const connection = connectionFromFields('id', fields);
    expect(connection).toMatchObject({ name: 'API', host: 'api.example.test', port: 22, username: 'deploy', tags: ['prod', 'linux'] });
    expect(connection.authentication).toEqual({ method: 'agent' });
  });
  it.each(['', '0', '65536', '22.5', '1e2', '-22', '22ssh', 'Infinity'])('rejects invalid port %s', port => {
    expect(() => connectionFromFields('id', { ...fields, port })).toThrow('Port');
  });
  it.each(['1', '65535'])('accepts valid port boundary %s', port => {
    expect(connectionFromFields('id', { ...fields, port }).port).toBe(Number(port));
  });
  it('retains only fields for the chosen authentication method', () => {
    expect(connectionFromFields('id', { ...fields, method: 'password' }).authentication)
      .toEqual({ method: 'password', password: 'synthetic-only' });
    expect(connectionFromFields('id', { ...fields, method: 'privateKey', passphrase: '' }).authentication)
      .toEqual({ method: 'privateKey', keyPath: '/synthetic/key' });
  });
  it('rejects blank required fields and invalid color', () => {
    expect(() => connectionFromFields('id', { ...fields, name: ' ' })).toThrow();
    expect(() => connectionFromFields('id', { ...fields, host: ' ' })).toThrow();
    expect(() => connectionFromFields('id', { ...fields, method: 'privateKey', keyPath: ' ' })).toThrow();
    expect(() => connectionFromFields('id', { ...fields, color: 'red' })).toThrow();
  });
  it.each([
    ['name', { name: ' ' }], ['host', { host: '' }], ['port', { port: '22ssh' }],
    ['keyPath', { method: 'privateKey', keyPath: '' }], ['color', { color: 'red' }],
  ] as const)('identifies the invalid %s field for accessible feedback', (field, invalid) => {
    try {
      connectionFromFields('id', { ...fields, ...invalid });
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
