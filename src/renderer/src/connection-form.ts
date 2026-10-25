import { ConnectionNodeSchema, LOGIN_CONTROL, LOGIN_LIMITS } from '../../shared/vault/schema';
import { CONNECTION_ICONS } from '../../shared/vault/appearance';
import { PROTOCOLS } from '../../shared/vault/connections';
import { TIMEOUT_LIMITS, parseBounded } from '../../shared/vault/timeouts';
import { KUBE_NAME } from '../../shared/kubernetes';
import type { Authentication, ConnectionNode, ConnectionProtocol, PortForward, VaultNode } from '../../shared/vault/types';
import { flattenConnections, kubeconfigPathError, noAccessMessage } from './cluster-form';
import { draftsFromForwards, forwardsFromDrafts } from './forward-form';
import type { ForwardDraft } from './forward-form';
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
  /** SSH only: become root after login (sudo -i). */
  loginSudo: 'on' | 'off';
  /** SSH only: start commands, one per line. */
  loginCommands: string;
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
  /** SSH/SFTP only: id of the SSH connection to hop through; empty = connect directly. */
  jumpHost: string;
  /** SSH only: port forwards, see forward-form.ts. */
  forwards: ForwardDraft[];
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
    containerSudo: 'off', loginSudo: 'off', loginCommands: '',
    disabled: connection?.disabled ? 'on' : 'off',
    accessHosts: [], kubeconfigSource: 'auto', kubeconfigPath: '', context: '', namespace: '', production: 'on', readOnly: 'off',
    idleMinutes: '', keepaliveSeconds: '', keepaliveCount: '', connectSeconds: '',
    jumpHost: '', forwards: [],
  };
  if (connection?.protocol === 'ssh' || connection?.protocol === 'sftp' || connection?.protocol === 'rdp') {
    Object.assign(fields, { host: connection.host, port: String(connection.port), username: connection.username ?? '' });
  }
  if (connection?.protocol === 'ssh' || connection?.protocol === 'sftp') {
    const auth = connection.authentication;
    Object.assign(fields, {
      jumpHost: connection.jumpHost ?? '',
      method: auth.method,
      password: auth.method === 'password' ? auth.password : '',
      keyPath: auth.method === 'privateKey' ? auth.keyPath : '',
      passphrase: auth.method === 'privateKey' ? auth.passphrase ?? '' : '',
      ...Object.fromEntries(TIMEOUT_KEYS.map(key => [key, String(connection.timeouts?.[key] ?? '')])),
    });
  }
  if (connection?.protocol === 'ssh') {
    fields.forwards = draftsFromForwards(connection.forwards);
    fields.containerSudo = connection.containers?.sudo ? 'on' : 'off';
    fields.loginSudo = connection.login?.sudo ? 'on' : 'off';
    fields.loginCommands = (connection.login?.commands ?? []).join('\n');
  }
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

/** Trimmed start commands; errors carry the 1-based line number in the text field (blank lines counted). */
function loginCommandLines(text: string): string[] {
  const commands: string[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    if (LOGIN_CONTROL.test(line)) throw new ConnectionFieldError('loginCommands', t('connection:validation.loginControlChars', { line: index + 1 }));
    if (line.length > LOGIN_LIMITS.length) throw new ConnectionFieldError('loginCommands', t('connection:validation.loginLineTooLong', { line: index + 1, max: LOGIN_LIMITS.length }));
    commands.push(line);
  });
  if (commands.length > LOGIN_LIMITS.lines) throw new ConnectionFieldError('loginCommands', t('connection:validation.loginTooManyLines', { max: LOGIN_LIMITS.lines }));
  return commands;
}

/** Bindings are edited in the file view, never in the form: saving the form keeps the stored list. */
export function keepAutoUpload(updated: ConnectionNode, existing: VaultNode | undefined): ConnectionNode {
  if ((updated.protocol !== 'ssh' && updated.protocol !== 'sftp') || existing?.type !== 'connection'
    || existing.protocol !== updated.protocol || !existing.autoUpload?.length) return updated;
  return { ...updated, autoUpload: existing.autoUpload };
}

/** Drafts become the stored list; a bad draft is reported on the forwards field. */
function forwardsOf(drafts: ForwardDraft[]): PortForward[] | undefined {
  try { return forwardsFromDrafts(drafts); }
  catch (error) { throw new ConnectionFieldError('forwards', error instanceof Error ? error.message : t('connection:validation.checkData')); }
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
    const commands = protocol === 'ssh' ? loginCommandLines(fields.loginCommands) : [];
    const forwards = protocol === 'ssh' ? forwardsOf(fields.forwards) : undefined;
    const sudo = protocol === 'ssh' && fields.loginSudo === 'on';
    node = { ...base, protocol, ...target, authentication, ...(fields.jumpHost ? { jumpHost: fields.jumpHost } : {}), ...(forwards ? { forwards } : {}), ...(Object.keys(timeouts).length ? { timeouts } : {}), ...(protocol === 'ssh' && fields.containerSudo === 'on' ? { containers: { sudo: true } } : {}),
      ...(sudo || commands.length ? { login: { ...(sudo ? { sudo: true } : {}), ...(commands.length ? { commands } : {}) } } : {}) };
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

export interface JumpHostOption { id: string; label: string }

function jumpLabel(node: ConnectionNode): string {
  return node.disabled ? t('connection:form.jump.disabled', { name: node.name }) : node.name;
}

/** SSH connections that may be the jump host of selfId, plus the current value if it is no longer listed. */
export function jumpHostOptions(nodes: VaultNode[], selfId: string | undefined, current: string): JumpHostOption[] {
  const connections = flattenConnections(nodes);
  const options = connections
    .filter(node => node.protocol === 'ssh' && node.id !== selfId && !node.jumpHost)
    .map(node => ({ id: node.id, label: jumpLabel(node) }));
  if (current && !options.some(option => option.id === current)) {
    const node = connections.find(candidate => candidate.id === current);
    options.push({ id: current, label: node ? jumpLabel(node) : t('connection:form.jump.missing', { id: current }) });
  }
  return options;
}

/** Rules for a jump host choice (spec 4.5, K10); the main process checks again when connecting. */
export function validateJumpHost(jumpHost: string, selfId: string | undefined, nodes: VaultNode[]): void {
  if (!jumpHost) return;
  const connections = flattenConnections(nodes);
  const target = connections.find(node => node.id === jumpHost);
  if (jumpHost === selfId) throw new ConnectionFieldError('jumpHost', t('connection:validation.jumpSelf'));
  if (!target || target.protocol !== 'ssh') throw new ConnectionFieldError('jumpHost', t('connection:validation.jumpGone', { id: jumpHost }));
  if (target.disabled) throw new ConnectionFieldError('jumpHost', t('connection:validation.jumpDisabled', { name: target.name }));
  if (target.jumpHost) throw new ConnectionFieldError('jumpHost', t('connection:validation.jumpChained', { name: target.name }));
  if (selfId && connections.some(node => (node.protocol === 'ssh' || node.protocol === 'sftp') && node.jumpHost === selfId)) {
    throw new ConnectionFieldError('jumpHost', t('connection:validation.jumpIsJumpHost'));
  }
}

/** Number of connections whose jump host is id. */
export function jumpHostReferences(nodes: VaultNode[], id: string): number {
  return flattenConnections(nodes).filter(node => (node.protocol === 'ssh' || node.protocol === 'sftp') && node.jumpHost === id).length;
}
