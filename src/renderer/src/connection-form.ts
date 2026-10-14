import { ConnectionNodeSchema } from '../../shared/vault/schema';
import { CONNECTION_ICONS } from '../../shared/vault/appearance';
import { PROTOCOLS } from '../../shared/vault/connections';
import type { Authentication, ConnectionNode, ConnectionProtocol, VaultNode } from '../../shared/vault/types';

/** All form values as strings; only the fields of the chosen protocol are used. */
export interface ConnectionFields {
  name: string;
  comment: string;
  host: string;
  port: string;
  username: string;
  method: Authentication['method'];
  password: string;
  keyPath: string;
  passphrase: string;
  domain: string;
  clipboard: 'on' | 'off';
  workingDirectory: string;
  /** AI CLI: preset tool or `custom` with `command`. */
  tool: 'claude' | 'codex' | 'gemini' | 'custom';
  command: string;
  tags: string;
  color: string;
  icon: string;
}

export class ConnectionFieldError extends Error {
  constructor(public readonly field: keyof ConnectionFields, message: string) {
    super(message);
    this.name = 'ConnectionFieldError';
  }
}

export function fieldsFromConnection(protocol: ConnectionProtocol, connection?: ConnectionNode): ConnectionFields {
  const fields: ConnectionFields = {
    name: connection?.name ?? '', comment: connection?.comment ?? '',
    host: '', port: String(PROTOCOLS[protocol].defaultPort ?? ''), username: '',
    method: 'agent', password: '', keyPath: '', passphrase: '',
    domain: '', clipboard: 'on', workingDirectory: '', tool: 'claude', command: '',
    tags: connection?.tags.join(', ') ?? '', color: connection?.color ?? '',
    icon: connection?.icon ?? PROTOCOLS[protocol].defaultIcon,
  };
  if (connection?.protocol === 'ssh' || connection?.protocol === 'sftp' || connection?.protocol === 'rdp') {
    Object.assign(fields, { host: connection.host, port: String(connection.port), username: connection.username ?? '' });
  }
  if (connection?.protocol === 'ssh' || connection?.protocol === 'sftp') {
    const auth = connection.authentication;
    Object.assign(fields, {
      method: auth.method,
      password: auth.method === 'password' ? auth.password : '',
      keyPath: auth.method === 'privateKey' ? auth.keyPath : '',
      passphrase: auth.method === 'privateKey' ? auth.passphrase ?? '' : '',
    });
  }
  if (connection?.protocol === 'rdp') {
    Object.assign(fields, { password: connection.password ?? '', domain: connection.rdp.domain ?? '', clipboard: connection.rdp.clipboard ? 'on' : 'off' });
  }
  if (connection?.protocol === 'powershell' || connection?.protocol === 'cmd') fields.workingDirectory = connection.workingDirectory ?? '';
  if (connection?.protocol === 'aicli') Object.assign(fields, { workingDirectory: connection.workingDirectory ?? '', tool: connection.tool, command: connection.command ?? '' });
  return fields;
}

function remoteTarget(fields: ConnectionFields): { host: string; port: number; username?: string } {
  if (!fields.host.trim()) throw new ConnectionFieldError('host', 'Bitte gib einen Host ein.');
  if (!/^\d+$/.test(fields.port.trim())) throw new ConnectionFieldError('port', 'Der Port muss eine ganze Zahl zwischen 1 und 65535 sein.');
  const port = Number(fields.port.trim());
  if (port < 1 || port > 65535) throw new ConnectionFieldError('port', 'Der Port muss zwischen 1 und 65535 liegen.');
  return { host: fields.host.trim(), port, ...(fields.username.trim() ? { username: fields.username.trim() } : {}) };
}

export function connectionFromFields(id: string, fields: ConnectionFields, protocol: ConnectionProtocol = 'ssh'): ConnectionNode {
  if (!fields.name.trim()) throw new ConnectionFieldError('name', 'Bitte gib einen Verbindungsnamen ein.');
  const base = {
    id, type: 'connection', name: fields.name.trim(),
    ...(fields.comment.trim() ? { comment: fields.comment.trim() } : {}),
    tags: [...new Set(fields.tags.split(',').map(tag => tag.trim()).filter(Boolean))],
    ...(fields.color ? { color: fields.color } : {}),
    icon: fields.icon,
  };
  let node: object;
  if (protocol === 'ssh' || protocol === 'sftp') {
    const target = remoteTarget(fields);
    if (fields.method === 'privateKey' && !fields.keyPath.trim()) throw new ConnectionFieldError('keyPath', 'Bitte gib den Pfad zum privaten Schlüssel ein.');
    const authentication: Authentication = fields.method === 'agent' ? { method: 'agent' }
      : fields.method === 'password' ? { method: 'password', password: fields.password }
      : { method: 'privateKey', keyPath: fields.keyPath.trim(), ...(fields.passphrase ? { passphrase: fields.passphrase } : {}) };
    node = { ...base, protocol, ...target, authentication };
  } else if (protocol === 'rdp') {
    const target = remoteTarget(fields);
    const domain = fields.domain.trim();
    if (domain && /[\\@]/.test(target.username ?? '')) {
      throw new ConnectionFieldError('domain', 'Gib die Domäne entweder hier oder im Benutzernamen an (DOMÄNE\\Benutzer oder benutzer@domäne), nicht beides.');
    }
    node = { ...base, protocol, ...target, ...(fields.password ? { password: fields.password } : {}),
      rdp: { ...(domain ? { domain } : {}), clipboard: fields.clipboard === 'on' } };
  } else if (protocol === 'aicli') {
    const command = fields.command.trim();
    if (fields.tool === 'custom' && !command) throw new ConnectionFieldError('command', 'Bitte gib den Befehl an, z. B. aider --model sonnet.');
    if (/[\r\n]/.test(command)) throw new ConnectionFieldError('command', 'Der Befehl muss eine Zeile sein.');
    node = { ...base, protocol, tool: fields.tool, ...(fields.tool === 'custom' ? { command } : {}),
      ...(fields.workingDirectory.trim() ? { workingDirectory: fields.workingDirectory.trim() } : {}) };
  } else {
    node = { ...base, protocol, ...(fields.workingDirectory.trim() ? { workingDirectory: fields.workingDirectory.trim() } : {}) };
  }
  if (fields.color && !/^#[\da-f]{6}$/i.test(fields.color)) throw new ConnectionFieldError('color', 'Bitte gib die Farbe als #RRGGBB an.');
  if (!CONNECTION_ICONS.some(icon => icon === fields.icon)) throw new ConnectionFieldError('icon', 'Bitte wähle ein verfügbares Symbol.');
  const result = ConnectionNodeSchema.safeParse(node);
  if (!result.success) throw new Error('Bitte prüfe die Verbindungsdaten.');
  return result.data;
}

export function folderOptions(nodes: VaultNode[], prefix = ''): { id: string; label: string }[] {
  return nodes.flatMap(node => {
    if (node.type !== 'folder') return [];
    const label = prefix ? `${prefix} / ${node.name}` : node.name;
    return [{ id: node.id, label }, ...folderOptions(node.children, label)];
  });
}

export function parentFolderId(nodes: VaultNode[], nodeId: string, parent = ''): string | undefined {
  for (const node of nodes) {
    if (node.id === nodeId) return parent;
    if (node.type === 'folder') {
      const result = parentFolderId(node.children, nodeId, node.id);
      if (result !== undefined) return result;
    }
  }
  return undefined;
}
