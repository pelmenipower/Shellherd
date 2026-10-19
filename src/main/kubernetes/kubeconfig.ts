import { KubeConfig } from '@kubernetes/client-node';
import { AppError } from '../../shared/errors';

/** The kubeconfig or its settings are unusable; the user can fix it. */
export class KubeInputError extends AppError {}

export interface ParsedKubeconfig {
  contextName: string;
  clusterName: string;
  /** Namespace of the context, if set. */
  namespace?: string;
  /** API server as written in the kubeconfig. */
  server: { host: string; port: number };
  /** Builds the in-memory config that talks to https://127.0.0.1:<localPort> with tlsServerName = original host. */
  build(localPort: number, tlsServerName?: string): KubeConfig;
}

function load(text: string): KubeConfig {
  const config = new KubeConfig();
  try { config.loadFromString(text); } catch { throw new KubeInputError('kubernetes.kubeconfigInvalid'); }
  // client-node accepts invalid YAML silently and yields an empty config; treat "nothing parsed" as unreadable.
  if (!config.getContexts().length) {
    if (!config.getClusters().length && !config.getUsers().length) throw new KubeInputError('kubernetes.kubeconfigInvalid');
    throw new KubeInputError('kubernetes.kubeconfigNoContext');
  }
  return config;
}

export function listContexts(text: string): { contexts: string[]; currentContext?: string; clusterName?: string } {
  const config = load(text);
  const current = config.getCurrentContext() || undefined;
  const context = config.getContexts().find(item => item.name === current);
  return { contexts: config.getContexts().map(item => item.name), ...(current ? { currentContext: current } : {}), ...(context ? { clusterName: context.cluster } : {}) };
}

export function parseKubeconfig(text: string, contextName?: string): ParsedKubeconfig {
  const config = load(text);
  const name = contextName ?? config.getCurrentContext();
  const context = config.getContexts().find(item => item.name === name);
  if (!context) throw new KubeInputError('kubernetes.contextMissing', { name, available: config.getContexts().map(item => item.name).join(', ') });
  const cluster = config.getCluster(context.cluster);
  const user = config.getUser(context.user);
  if (!cluster || !user) throw new KubeInputError('kubernetes.contextIncomplete');
  if (user.exec || user.authProvider) throw new KubeInputError('kubernetes.loginPluginUnsupported');
  if ((cluster.caFile && !cluster.caData) || (user.certFile && !user.certData) || (user.keyFile && !user.keyData)) {
    throw new KubeInputError('kubernetes.certFilesUnsupported');
  }
  let url: URL;
  try { url = new URL(cluster.server); } catch { throw new KubeInputError('kubernetes.serverUrlInvalid'); }
  if (url.protocol !== 'https:') throw new KubeInputError('kubernetes.httpsRequired');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const server = { host, port: url.port ? Number(url.port) : 443 };
  return {
    contextName: context.name, clusterName: context.cluster, ...(context.namespace ? { namespace: context.namespace } : {}), server,
    build(localPort: number, tlsServerName?: string): KubeConfig {
      const built = new KubeConfig();
      built.loadFromOptions({
        clusters: [{ ...cluster, server: `https://127.0.0.1:${localPort}`, tlsServerName: tlsServerName ?? cluster.tlsServerName ?? host }],
        users: [user], contexts: [context], currentContext: context.name,
      });
      return built;
    },
  };
}
