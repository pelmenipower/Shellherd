import { ConnectionNodeSchema } from '../../shared/vault/schema';
import { CONNECTION_ICONS } from '../../shared/vault/appearance';
import type { Authentication, ConnectionNode, VaultNode } from '../../shared/vault/types';

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

export function connectionFromFields(id: string, fields: ConnectionFields): ConnectionNode {
  if (!fields.name.trim()) throw new ConnectionFieldError('name', 'Bitte gib einen Verbindungsnamen ein.');
  if (!fields.host.trim()) throw new ConnectionFieldError('host', 'Bitte gib einen Host ein.');
  if (!/^\d+$/.test(fields.port.trim())) throw new ConnectionFieldError('port', 'Der Port muss eine ganze Zahl zwischen 1 und 65535 sein.');
  const port = Number(fields.port.trim());
  if (port < 1 || port > 65535) throw new ConnectionFieldError('port', 'Der Port muss zwischen 1 und 65535 liegen.');
  if (fields.method === 'privateKey' && !fields.keyPath.trim()) throw new ConnectionFieldError('keyPath', 'Bitte gib den Pfad zum privaten Schlüssel ein.');
  if (fields.color && !/^#[\da-f]{6}$/i.test(fields.color)) throw new ConnectionFieldError('color', 'Bitte gib die Farbe als #RRGGBB an.');
  if (!CONNECTION_ICONS.some(icon => icon === fields.icon)) throw new ConnectionFieldError('icon', 'Bitte wähle ein verfügbares Symbol.');

  const authentication: Authentication = fields.method === 'agent' ? { method: 'agent' }
    : fields.method === 'password' ? { method: 'password', password: fields.password }
    : { method: 'privateKey', keyPath: fields.keyPath.trim(), ...(fields.passphrase ? { passphrase: fields.passphrase } : {}) };
  const result = ConnectionNodeSchema.safeParse({
    id, type: 'connection', name: fields.name.trim(), host: fields.host.trim(), port,
    ...(fields.comment.trim() ? { comment: fields.comment.trim() } : {}),
    ...(fields.username.trim() ? { username: fields.username.trim() } : {}),
    authentication, tags: [...new Set(fields.tags.split(',').map(tag => tag.trim()).filter(Boolean))],
    ...(fields.color ? { color: fields.color } : {}),
    icon: fields.icon,
  });
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
