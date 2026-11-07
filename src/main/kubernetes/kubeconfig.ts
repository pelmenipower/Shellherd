import { spawn } from 'node:child_process';
import type { SpawnOptions } from 'node:child_process';
import path from 'node:path';
import { KubeConfig } from '@kubernetes/client-node';
import type { User } from '@kubernetes/client-node';
// Same js-yaml copy client-node parses with; the test pins that both resolve to the same file.
import { load as parseYaml } from 'js-yaml';
import { AppError } from '../../shared/errors';

/** The kubeconfig or its settings are unusable; the user can fix it. */
export class KubeInputError extends AppError {}

/** Who supplied the kubeconfig decides what it may do: ssh = text from a remote host, inline = pasted, file = a file on this computer. */
export type KubeconfigPolicy =
  | { source: 'ssh' }
  | { source: 'inline'; execConsent?: string }
  | { source: 'file'; dir: string };

/** Upper bound for one login-plugin run. */
export const EXEC_TIMEOUT_MS = 60_000;

export interface ParsedKubeconfig {
  contextName: string;
  clusterName: string;
  /** Namespace of the context, if set. */
  namespace?: string;
  /** API server as written in the kubeconfig. */
  server: { host: string; port: number };
  /** Builds the in-memory config. A port: https://127.0.0.1:<localPort> with tlsServerName = original host; null: the server as written. */
  build(localPort: number | null, tlsServerName?: string): KubeConfig;
}

const SAFE = /^[A-Za-z0-9_@%+:,./\\-]+$/; // no '=', no space, no quotes
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const word = (value: unknown): string => { const text = String(value); return SAFE.test(text) ? text : JSON.stringify(text); };

/** Unambiguous command line of a login plugin (env, command, args); this exact text is what the user approves. */
export function execCommandLine(user: User): string | undefined {
  const exec = user.exec as { command?: unknown; args?: unknown; env?: unknown } | null | undefined;
  if (!exec || typeof exec.command !== 'string' || !exec.command) return undefined;
  const env = Array.isArray(exec.env) ? exec.env.map((item: { name?: unknown; value?: unknown } | null) => {
    const name = String(item?.name);
    return `${ENV_NAME.test(name) ? name : JSON.stringify(name)}=${word(item?.value)}`;
  }) : [];
  const args = Array.isArray(exec.args) ? exec.args.map(word) : [];
  return [...env, word(exec.command), ...args].join(' ');
}

/** client-node reads `token-file` from the local disk while parsing, so such users are refused before it sees the text. */
function rejectTokenFiles(text: string): void {
  let doc: unknown;
  try { doc = parseYaml(text); } catch { throw new KubeInputError('kubernetes.kubeconfigInvalid'); }
  const users = (doc as { users?: unknown } | null)?.users;
  if (!Array.isArray(users)) return;
  for (const item of users) {
    const user = (item as { user?: unknown } | null)?.user;
    if (user && typeof user === 'object' && Object.hasOwn(user, 'token-file')) throw new KubeInputError('kubernetes.tokenFileUnsupported');
  }
}

/** The only place that hands text to client-node. `dir` makes relative certificate paths absolute. */
function load(text: string, dir?: string): KubeConfig {
  rejectTokenFiles(text);
  const config = new KubeConfig();
  try { config.loadFromString(text); } catch { throw new KubeInputError('kubernetes.kubeconfigInvalid'); }
  // client-node accepts invalid YAML silently and yields an empty config; treat "nothing parsed" as unreadable.
  if (!config.getContexts().length) {
    if (!config.getClusters().length && !config.getUsers().length) throw new KubeInputError('kubernetes.kubeconfigInvalid');
    throw new KubeInputError('kubernetes.kubeconfigNoContext');
  }
  if (dir) config.makePathsAbsolute(dir);
  return config;
}

export function listContexts(text: string): { contexts: string[]; currentContext?: string; clusterName?: string; execCommands: Record<string, string> } {
  const config = load(text);
  const current = config.getCurrentContext() || undefined;
  const context = config.getContexts().find(item => item.name === current);
  const execCommands: Record<string, string> = {};
  for (const item of config.getContexts()) {
    const user = config.getUsers().find(candidate => candidate.name === item.user);
    const line = user && execCommandLine(user);
    if (line) execCommands[item.name] = line;
  }
  return { contexts: config.getContexts().map(item => item.name), ...(current ? { currentContext: current } : {}), ...(context ? { clusterName: context.cluster } : {}), execCommands };
}

/** Credentials inside a pasted kubeconfig, for masking. Any error yields []. */
export function kubeconfigSecrets(text: string): string[] {
  // Reads the YAML document directly: client-node refuses whole files (token-file, no contexts) and would unmask the rest.
  let doc: unknown;
  try { doc = parseYaml(text); } catch { return []; }
  const users = (doc as { users?: unknown } | null)?.users;
  if (!Array.isArray(users)) return [];
  const found: string[] = [];
  const add = (value: unknown): void => { if (typeof value === 'string' && value) found.push(value); };
  for (const item of users) {
    const user = (item as { user?: unknown } | null)?.user as Record<string, unknown> | null | undefined;
    if (!user || typeof user !== 'object') continue;
    for (const key of ['token', 'password', 'client-key-data']) add(user[key]);
    const config = (user['auth-provider'] as { config?: Record<string, unknown> } | null | undefined)?.config;
    if (config && typeof config === 'object') for (const key of ['id-token', 'refresh-token', 'client-secret', 'access-token']) add(config[key]);
  }
  return found;
}

const isRelativeCommand = (command: string): boolean => /[\\/]/.test(command) && !path.isAbsolute(command);

export function parseKubeconfig(text: string, contextName?: string, policy: KubeconfigPolicy = { source: 'ssh' }): ParsedKubeconfig {
  const config = load(text, policy.source === 'file' ? policy.dir : undefined);
  const name = contextName ?? config.getCurrentContext();
  const context = config.getContexts().find(item => item.name === name);
  if (!context) throw new KubeInputError('kubernetes.contextMissing', { name, available: config.getContexts().map(item => item.name).join(', ') });
  const cluster = config.getCluster(context.cluster);
  const user = config.getUser(context.user);
  if (!cluster || !user) throw new KubeInputError('kubernetes.contextIncomplete');
  if (policy.source === 'ssh') {
    if (user.exec || user.authProvider) throw new KubeInputError('kubernetes.loginPluginUnsupported');
  } else {
    if (user.authProvider) throw new KubeInputError('kubernetes.authProviderUnsupported');
    if (user.exec) {
      const exec = user.exec as { command?: unknown; args?: unknown; env?: unknown };
      const shapeOk = typeof exec === 'object' && typeof exec.command === 'string' && exec.command !== ''
        && (exec.args == null || Array.isArray(exec.args)) && (exec.env == null || Array.isArray(exec.env));
      if (!shapeOk) throw new KubeInputError('kubernetes.loginPluginUnsupported');
      const command = String(exec.command).slice(0, 200);
      if (policy.source === 'inline') {
        if (isRelativeCommand(String(exec.command))) throw new KubeInputError('kubernetes.loginPluginNotStarted', { command });
        if (policy.execConsent !== execCommandLine(user)) throw new KubeInputError('kubernetes.loginPluginNeedsConsent', { command });
      }
    }
  }
  if (policy.source !== 'file' && ((cluster.caFile && !cluster.caData) || (user.certFile && !user.certData) || (user.keyFile && !user.keyData))) {
    throw new KubeInputError('kubernetes.certFilesUnsupported');
  }
  let url: URL;
  try { url = new URL(cluster.server); } catch { throw new KubeInputError('kubernetes.serverUrlInvalid'); }
  if (url.protocol !== 'https:') throw new KubeInputError('kubernetes.httpsRequired');
  if (policy.source !== 'ssh') {
    if (cluster.skipTLSVerify === true) throw new KubeInputError('kubernetes.tlsVerifyRequired');
    if (cluster.proxyUrl) throw new KubeInputError('kubernetes.proxyUnsupported');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const server = { host, port: url.port ? Number(url.port) : 443 };
  return {
    contextName: context.name, clusterName: context.cluster, ...(context.namespace ? { namespace: context.namespace } : {}), server,
    build(localPort: number | null, tlsServerName?: string): KubeConfig {
      const built = new KubeConfig();
      // A local file wins over ...-data in client-node, so only the file policy may keep file paths.
      const keepFiles = policy.source === 'file';
      const tls = localPort === null ? (tlsServerName ?? cluster.tlsServerName) : (tlsServerName ?? cluster.tlsServerName ?? host);
      let builtUser: User = keepFiles ? user : { ...user, certFile: undefined, keyFile: undefined };
      if (policy.source === 'file' && user.exec && isRelativeCommand(user.exec.command)) {
        builtUser = { ...builtUser, exec: { ...user.exec, command: path.resolve(policy.dir, user.exec.command) } };
      }
      built.loadFromOptions({
        clusters: [{
          ...cluster, ...(keepFiles ? {} : { caFile: undefined }),
          ...(localPort === null ? {} : { server: `https://127.0.0.1:${localPort}` }), tlsServerName: tls,
        }],
        users: [builtUser], contexts: [context], currentContext: context.name,
      });
      if (user.exec) {
        // shortcut: client-node 2.0.0 (exact pin) keeps ExecAuth private; the test fails if the field moves
        const auth = (built as unknown as { authenticators?: object[] }).authenticators?.find(item => 'execFn' in item) as { execFn: unknown } | undefined;
        if (!auth) throw new KubeInputError('kubernetes.loginPluginUnsupported');
        auth.execFn = (command: string, args: string[] | undefined, options: SpawnOptions) => {
          // spawn of .cmd/.bat throws EINVAL without a path on Windows; add it so toApiError names the command
          try { return spawn(command, args ?? [], { ...options, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: EXEC_TIMEOUT_MS }); }
          catch (error) { throw Object.assign(error as object, { path: command }); }
        };
      }
      return built;
    },
  };
}
