import { KubeConfig } from '@kubernetes/client-node';

export class KubeInputError extends Error {}

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
  try { config.loadFromString(text); } catch { throw new KubeInputError('Die kubeconfig konnte nicht gelesen werden.'); }
  // client-node accepts invalid YAML silently and yields an empty config; treat "nothing parsed" as unreadable.
  if (!config.getContexts().length) {
    if (!config.getClusters().length && !config.getUsers().length) throw new KubeInputError('Die kubeconfig konnte nicht gelesen werden.');
    throw new KubeInputError('Die kubeconfig enthält keinen Context.');
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
  if (!context) throw new KubeInputError(`Context „${name}“ gibt es in der kubeconfig nicht (vorhanden: ${config.getContexts().map(item => item.name).join(', ')}).`);
  const cluster = config.getCluster(context.cluster);
  const user = config.getUser(context.user);
  if (!cluster || !user) throw new KubeInputError('Der Context verweist auf einen fehlenden Cluster oder Benutzer.');
  if (user.exec || user.authProvider) throw new KubeInputError('Diese kubeconfig nutzt ein Login-Plugin. Das wird noch nicht unterstützt.');
  if ((cluster.caFile && !cluster.caData) || (user.certFile && !user.certData) || (user.keyFile && !user.keyData)) {
    throw new KubeInputError('Die kubeconfig verweist auf Zertifikatsdateien. Nutze eine kubeconfig mit eingebetteten Zertifikaten (z. B. /etc/kubernetes/admin.conf).');
  }
  let url: URL;
  try { url = new URL(cluster.server); } catch { throw new KubeInputError('Die Server-Adresse in der kubeconfig ist ungültig.'); }
  if (url.protocol !== 'https:') throw new KubeInputError('Der API-Server muss per HTTPS erreichbar sein.');
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
