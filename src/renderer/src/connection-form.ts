import { ConnectionNodeSchema } from '../../shared/vault/schema';
import { CONNECTION_ICONS } from '../../shared/vault/appearance';
import { PROTOCOLS } from '../../shared/vault/connections';
import { TIMEOUT_LIMITS, parseBounded } from '../../shared/vault/timeouts';
import { KUBE_NAME } from '../../shared/kubernetes';
import type { Authentication, ConnectionNode, ConnectionProtocol, VaultNode } from '../../shared/vault/types';
import { kubeconfigPathError, noAccessMessage } from './cluster-form';
import { t } from './i18n';

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
  /** SSH only: run container commands with sudo (stored password or sudo -n). */
  containerSudo: 'on' | 'off';
  /** Not editable in the form; carried over so saving never re-enables a connection. */
  disabled: 'on' | 'off';
  /** Kubernetes only: ordered SSH connection ids. */
  accessHosts: string[];
  kubeconfigSource: 'auto' | 'path';
  kubeconfigPath: string;
  context: string;
  namespace: string;
  production: 'on' | 'off';
  readOnly: 'on' | 'off';
  /** SSH/SFTP only: per-connection overrides; empty = inherit from the vault settings. */
  idleMinutes: string;
  keepaliveSeconds: string;
  keepaliveCount: string;
  connectSeconds: string;
}

const TIMEOUT_KEYS = ['idleMinutes', 'keepaliveSeconds', 'keepaliveCount', 'connectSeconds'] as const;

/** Form fields that hold plain text and can be shown in a text input. */
export type ConnectionTextField = { [K in keyof ConnectionFields]: ConnectionFields[K] extends string ? K : never }[keyof ConnectionFields];

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
    containerSudo: 'off',
    disabled: connection?.disabled ? 'on' : 'off',
    accessHosts: [], kubeconfigSource: 'auto', kubeconfigPath: '', context: '', namespace: '', production: 'on', readOnly: 'off',
    idleMinutes: '', keepaliveSeconds: '', keepaliveCount: '', connectSeconds: '',
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
      ...Object.fromEntries(TIMEOUT_KEYS.map(key => [key, String(connection.timeouts?.[key] ?? '')])),
    });
  }
  if (connection?.protocol === 'ssh') fields.containerSudo = connection.containers?.sudo ? 'on' : 'off';
  if (connection?.protocol === 'rdp') {
    Object.assign(fields, { password: connection.password ?? '', domain: connection.rdp.domain ?? '', clipboard: connection.rdp.clipboard ? 'on' : 'off' });
  }
  if (connection?.protocol === 'powershell' || connection?.protocol === 'cmd') fields.workingDirectory = connection.workingDirectory ?? '';
  if (connection?.protocol === 'aicli') Object.assign(fields, { workingDirectory: connection.workingDirectory ?? '', tool: connection.tool, command: connection.command ?? '' });
  if (connection?.protocol === 'kubernetes') Object.assign(fields, {
    accessHosts: [...connection.accessHosts], kubeconfigSource: connection.kubeconfig.source,
    kubeconfigPath: connection.kubeconfig.source === 'path' ? connection.kubeconfig.path : '',
    context: connection.context ?? '', namespace: connection.namespace ?? '',
    production: connection.production ? 'on' : 'off', readOnly: connection.readOnly ? 'on' : 'off',
  });
  return fields;
}

function remoteTarget(fields: ConnectionFields): { host: string; port: number; username?: string } {
  if (!fields.host.trim()) throw new ConnectionFieldError('host', t('connection:validation.hostMissing'));
  if (!/^\d+$/.test(fields.port.trim())) throw new ConnectionFieldError('port', t('connection:validation.portInteger'));
  const port = Number(fields.port.trim());
  if (port < 1 || port > 65535) throw new ConnectionFieldError('port', t('connection:validation.portRange'));
  return { host: fields.host.trim(), port, ...(fields.username.trim() ? { username: fields.username.trim() } : {}) };
}

/** Bindings are edited in the file view, never in the form: saving the form keeps the stored list. */
export function keepAutoUpload(updated: ConnectionNode, existing: VaultNode | undefined): ConnectionNode {
  if ((updated.protocol !== 'ssh' && updated.protocol !== 'sftp') || existing?.type !== 'connection'
    || existing.protocol !== updated.protocol || !existing.autoUpload?.length) return updated;
  return { ...updated, autoUpload: existing.autoUpload };
}

export function connectionFromFields(id: string, fields: ConnectionFields, protocol: ConnectionProtocol = 'ssh'): ConnectionNode {
  if (!fields.name.trim()) throw new ConnectionFieldError('name', t('connection:validation.nameMissing'));
  const base = {
    id, type: 'connection', name: fields.name.trim(),
    ...(fields.comment.trim() ? { comment: fields.comment.trim() } : {}),
    tags: [...new Set(fields.tags.split(',').map(tag => tag.trim()).filter(Boolean))],
    ...(fields.color ? { color: fields.color } : {}),
    icon: fields.icon,
    ...(fields.disabled === 'on' ? { disabled: true } : {}),
  };
  let node: object;
  if (protocol === 'ssh' || protocol === 'sftp') {
    const target = remoteTarget(fields);
    if (fields.method === 'privateKey' && !fields.keyPath.trim()) throw new ConnectionFieldError('keyPath', t('connection:validation.keyPathMissing'));
    const authentication: Authentication = fields.method === 'agent' ? { method: 'agent' }
      : fields.method === 'password' ? { method: 'password', password: fields.password }
      : { method: 'privateKey', keyPath: fields.keyPath.trim(), ...(fields.passphrase ? { passphrase: fields.passphrase } : {}) };
    const timeouts: Partial<Record<(typeof TIMEOUT_KEYS)[number], number>> = {};
    for (const key of TIMEOUT_KEYS) {
      if (!fields[key].trim()) continue;
      const value = parseBounded(fields[key], TIMEOUT_LIMITS[key]);
      if (value === null) throw new ConnectionFieldError(key, t('connection:validation.timeoutRange', { min: TIMEOUT_LIMITS[key][0], max: TIMEOUT_LIMITS[key][1] }));
      timeouts[key] = value;
    }
    node = { ...base, protocol, ...target, authentication, ...(Object.keys(timeouts).length ? { timeouts } : {}), ...(protocol === 'ssh' && fields.containerSudo === 'on' ? { containers: { sudo: true } } : {}) };
  } else if (protocol === 'rdp') {
    const target = remoteTarget(fields);
    const domain = fields.domain.trim();
    if (domain && /[\\@]/.test(target.username ?? '')) {
      throw new ConnectionFieldError('domain', t('connection:validation.domainTwice'));
    }
    node = { ...base, protocol, ...target, ...(fields.password ? { password: fields.password } : {}),
      rdp: { ...(domain ? { domain } : {}), clipboard: fields.clipboard === 'on' } };
  } else if (protocol === 'aicli') {
    const command = fields.command.trim();
    if (fields.tool === 'custom' && !command) throw new ConnectionFieldError('command', t('connection:validation.commandMissing'));
    if (/[\r\n]/.test(command)) throw new ConnectionFieldError('command', t('connection:validation.commandSingleLine'));
    node = { ...base, protocol, tool: fields.tool, ...(fields.tool === 'custom' ? { command } : {}),
      ...(fields.workingDirectory.trim() ? { workingDirectory: fields.workingDirectory.trim() } : {}) };
  } else if (protocol === 'kubernetes') {
    // Access hosts and the kubeconfig path get field errors here; ConnectionForm adds validateCluster for the rest.
    if (fields.accessHosts.length === 0) throw new ConnectionFieldError('accessHosts', noAccessMessage());
    const kubeconfigPath = fields.kubeconfigPath.trim();
    if (fields.kubeconfigSource === 'path') {
      const problem = kubeconfigPathError(kubeconfigPath);
      if (problem) throw new ConnectionFieldError('kubeconfigPath', problem);
    }
    const namespace = fields.namespace.trim();
    if (namespace && !KUBE_NAME.test(namespace)) throw new ConnectionFieldError('namespace', t('connection:validation.namespaceInvalid'));
    const context = fields.context.trim();
    node = { ...base, protocol, accessHosts: [...fields.accessHosts],
      kubeconfig: fields.kubeconfigSource === 'path' ? { source: 'path', path: kubeconfigPath } : { source: 'auto' },
      ...(context ? { context } : {}), ...(namespace ? { namespace } : {}),
      production: fields.production === 'on', readOnly: fields.readOnly === 'on' };
  } else {
    node = { ...base, protocol, ...(fields.workingDirectory.trim() ? { workingDirectory: fields.workingDirectory.trim() } : {}) };
  }
  if (fields.color && !/^#[\da-f]{6}$/i.test(fields.color)) throw new ConnectionFieldError('color', t('connection:validation.colorInvalid'));
  if (!CONNECTION_ICONS.some(icon => icon === fields.icon)) throw new ConnectionFieldError('icon', t('connection:validation.iconInvalid'));
  const result = ConnectionNodeSchema.safeParse(node);
  if (!result.success) throw new Error(t('connection:validation.checkData'));
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
