import { describe, expect, it } from 'vitest';
import { ConnectionFieldError, connectionFromFields, fieldsFromConnection, folderOptions, keepAutoUpload, parentFolderId } from './connection-form';
import { redactSecrets } from '../../shared/vault/connections';
import type { ConnectionFields } from './connection-form';
import type { VaultNode } from '../../shared/vault/types';

const fields: ConnectionFields = {
  name: ' API ', comment: ' comment ', host: ' api.example.test ', port: '22', username: ' deploy ',
  method: 'agent', password: 'synthetic-only', keyPath: '/synthetic/key', passphrase: 'synthetic-only',
  domain: '', clipboard: 'on', workingDirectory: '', tool: 'claude', command: '',
  tags: 'prod, linux, prod, ,', color: '', icon: 'terminal', containerSudo: 'off', loginSudo: 'off', loginCommands: '', disabled: 'off',
  accessHosts: [], kubeconfigSource: 'auto', kubeconfigPath: '', context: '', namespace: '', production: 'on', readOnly: 'off',
  idleMinutes: '', keepaliveSeconds: '', keepaliveCount: '', connectSeconds: '',
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
  it('round-trips the login block together with timeouts and containers', () => {
    const input = { ...fields, loginSudo: 'on' as const, loginCommands: ' uptime \n\n  df -h /  \n', containerSudo: 'on' as const, idleMinutes: '5' };
    const node = ssh(input);
    expect(node).toMatchObject({ login: { sudo: true, commands: ['uptime', 'df -h /'] }, timeouts: { idleMinutes: 5 }, containers: { sudo: true } });
    expect(fieldsFromConnection('ssh', node)).toMatchObject({ loginSudo: 'on', loginCommands: 'uptime\ndf -h /', containerSudo: 'on', idleMinutes: '5' });
    expect(ssh({ ...fields, loginCommands: 'ls' }).login).toEqual({ commands: ['ls'] });
    expect(ssh({ ...fields, loginSudo: 'on' }).login).toEqual({ sudo: true });
    expect(ssh({ ...fields, loginCommands: ' \n ' })).not.toHaveProperty('login');
    expect(fieldsFromConnection('ssh')).toMatchObject({ loginSudo: 'off', loginCommands: '' });
  });
  it('keeps autoUpload while login comes from the form', () => {
    const existing = { ...ssh(fields), autoUpload: [{ id: 'b', localPath: '/a', remotePath: '/b', enabled: true }], login: { sudo: true } } as unknown as VaultNode;
    const updated = keepAutoUpload(ssh({ ...fields, loginCommands: 'ls' }), existing);
    expect(updated).toMatchObject({ autoUpload: (existing as { autoUpload: unknown }).autoUpload, login: { commands: ['ls'] } });
    expect((updated as { login: object }).login).not.toHaveProperty('sudo');
  });
  it('rejects bad login lines with the line number in the text field', () => {
    const fail = (loginCommands: string) => {
      try { connectionFromFields('id', { ...fields, loginCommands }); } catch (error) { return error; }
      throw new Error('no error');
    };
    const tab = fail('a\n\nb\tc');
    expect(tab).toBeInstanceOf(ConnectionFieldError);
    expect(tab).toMatchObject({ field: 'loginCommands' });
    expect((tab as Error).message).toContain('Zeile 3');
    expect((fail('a\u009bb') as Error).message).toContain('Zeile 1');
    expect((fail(`ok\n${'x'.repeat(501)}`) as Error).message).toContain('Zeile 2');
    expect(fail(Array(21).fill('x').join('\n'))).toMatchObject({ field: 'loginCommands' });
    expect(() => connectionFromFields('id', { ...fields, loginCommands: 'x'.repeat(500) })).not.toThrow();
  });
  it('writes no login block for SFTP', () => {
    expect(connectionFromFields('id', { ...fields, loginSudo: 'on', loginCommands: 'ls' }, 'sftp')).not.toHaveProperty('login');
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

describe('kubernetes clusters in the form', () => {
  const cluster = { ...fields, accessHosts: ['a', 'b'], context: ' prod ', namespace: 'apps', production: 'off' as const, readOnly: 'on' as const };
  it('builds a cluster with ordered access hosts, defaults and overrides', () => {
    expect(connectionFromFields('k', cluster, 'kubernetes')).toMatchObject({ id: 'k', protocol: 'kubernetes', name: 'API', accessHosts: ['a', 'b'],
      kubeconfig: { source: 'auto' }, context: 'prod', namespace: 'apps', production: false, readOnly: true });
    expect(connectionFromFields('k', { ...cluster, context: '', namespace: '' }, 'kubernetes')).not.toHaveProperty('context');
  });
  it('reads a cluster back into the form fields', () => {
    const node = connectionFromFields('k', { ...cluster, kubeconfigSource: 'path', kubeconfigPath: '/etc/k.conf' }, 'kubernetes');
    expect(fieldsFromConnection('kubernetes', node)).toMatchObject({ accessHosts: ['a', 'b'], kubeconfigSource: 'path', kubeconfigPath: '/etc/k.conf', context: 'prod', production: 'off', readOnly: 'on' });
  });
  it('reports access host, kubeconfig path and namespace problems on their fields', () => {
    expect(() => connectionFromFields('k', { ...cluster, accessHosts: [] }, 'kubernetes')).toThrow(ConnectionFieldError);
    expect(() => connectionFromFields('k', { ...cluster, kubeconfigSource: 'path', kubeconfigPath: 'rel' }, 'kubernetes')).toThrow('beginnen');
    expect(() => connectionFromFields('k', { ...cluster, namespace: 'Bad_NS' }, 'kubernetes')).toThrow('Namespace');
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
  it('words validation messages as imperatives without "Bitte"', () => {
    const message = (patch: Partial<ConnectionFields>, protocol: Parameters<typeof connectionFromFields>[2] = 'ssh') => {
      try { connectionFromFields('id', { ...fields, ...patch }, protocol); } catch (error) { return (error as Error).message; }
      return '';
    };
    expect(message({ host: '' })).toBe('Gib einen Host oder eine IP-Adresse ein.');
    expect(message({ name: ' ' })).toBe('Gib einen Verbindungsnamen ein.');
    expect(message({ method: 'privateKey', keyPath: '' })).toBe('Gib den Pfad zum privaten Schlüssel ein.');
    expect(message({ tool: 'custom', command: '' }, 'aicli')).toBe('Gib den Befehl an, z. B. aider --model sonnet.');
    expect(message({ accessHosts: ['a'], namespace: 'Bad Name' }, 'kubernetes')).toBe('Gib einen gültigen Namespace ein, z. B. default.');
    expect(message({ color: 'red' })).toBe('Gib die Farbe als #RRGGBB an.');
    expect(message({ icon: 'nope' as ConnectionFields['icon'] })).toBe('Wähle ein verfügbares Symbol.');
  });
});

describe('connection timeout overrides', () => {
  const all = { idleMinutes: '30', keepaliveSeconds: '20', keepaliveCount: '5', connectSeconds: '60' };
  it('round-trips all four fields for SSH and SFTP', () => {
    for (const protocol of ['ssh', 'sftp'] as const) {
      const node = connectionFromFields('id', { ...fields, ...all }, protocol);
      expect(node).toMatchObject({ timeouts: { idleMinutes: 30, keepaliveSeconds: 20, keepaliveCount: 5, connectSeconds: 60 } });
      expect(fieldsFromConnection(protocol, node)).toMatchObject(all);
    }
  });
  it('writes no timeouts object when every field is empty', () => {
    expect(connectionFromFields('id', fields)).not.toHaveProperty('timeouts');
    expect(fieldsFromConnection('ssh')).toMatchObject({ idleMinutes: '', connectSeconds: '' });
  });
  it('keeps a partial override partial, and 0 idle is a value', () => {
    const node = connectionFromFields('id', { ...fields, idleMinutes: ' 0 ', keepaliveCount: '4' });
    expect(node).toMatchObject({ timeouts: { idleMinutes: 0, keepaliveCount: 4 } });
    expect((node as { timeouts: object }).timeouts).toEqual({ idleMinutes: 0, keepaliveCount: 4 });
  });
  it('names the field on a range error', () => {
    for (const [key, value] of [['keepaliveSeconds', '4'], ['idleMinutes', '1441'], ['connectSeconds', '1.5'], ['keepaliveCount', '-1']] as const) {
      expect(() => connectionFromFields('id', { ...fields, [key]: value })).toThrow(expect.objectContaining({ name: 'ConnectionFieldError', field: key }));
    }
  });
  it('ignores the fields for RDP and keeps them next to autoUpload', () => {
    expect(connectionFromFields('id', { ...fields, ...all }, 'rdp')).not.toHaveProperty('timeouts');
    const list = [{ id: 'b1', localPath: 'C:\\x', remotePath: '/x', excludes: [], enabled: true }];
    const existing = { ...connectionFromFields('id', fields), autoUpload: list } as VaultNode;
    expect(keepAutoUpload(connectionFromFields('id', { ...fields, ...all }), existing)).toMatchObject({ autoUpload: list, timeouts: { idleMinutes: 30 } });
  });
});

describe('keepAutoUpload', () => {
  const list = [{ id: 'b1', localPath: 'C:\\x', remotePath: '/x', excludes: [], enabled: true }];
  const existing = (protocol: 'ssh' | 'sftp'): VaultNode => ({ ...connectionFromFields('id', fields, protocol), autoUpload: list } as VaultNode);

  it('keeps the stored list on a freshly built SSH or SFTP node', () => {
    for (const protocol of ['ssh', 'sftp'] as const) {
      expect(keepAutoUpload(connectionFromFields('id', fields, protocol), existing(protocol))).toMatchObject({ autoUpload: list });
    }
  });

  it('returns the node unchanged without a stored list or for another protocol', () => {
    const updated = connectionFromFields('id', fields);
    expect(keepAutoUpload(updated, undefined)).toBe(updated);
    expect(keepAutoUpload(updated, connectionFromFields('id', fields))).toBe(updated);
    expect(keepAutoUpload(updated, { ...existing('ssh'), autoUpload: [] } as VaultNode)).toBe(updated);
    expect(keepAutoUpload(updated, existing('sftp'))).toBe(updated);
    const rdp = connectionFromFields('id', fields, 'rdp');
    expect(keepAutoUpload(rdp, existing('ssh'))).toBe(rdp);
  });
});
