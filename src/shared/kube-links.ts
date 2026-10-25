/** Links from the cluster tab to Argo CD and Harbor. Pure; used by main, renderer and the vault schema. The host always comes from the vault entry. */
import { MAX_LINK_LENGTH } from './links';

/** Longest Argo CD or Harbor address in the vault. */
export const MAX_BASE_URL = 512;
export const ARGO_INSTANCE_LABEL = 'argocd.argoproj.io/instance';
export const ARGO_TRACKING_ANNOTATION = 'argocd.argoproj.io/tracking-id';
/** Argo CD application name, optionally qualified with its namespace: `name` or `namespace_name`. */
const ARGO_APP = /^(?:([a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?)_)?([a-z0-9](?:[-a-z0-9.]{0,251}[a-z0-9])?)$/;
/** `<app>:<group>/<kind>:<namespace>/<name>`; group and namespace (cluster-scoped objects) may be empty. */
const TRACKING_ID = /^([^:/]+):[^:/]*\/[^:/]+:([^:/]*)\/([^:/]+)$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const TAG = /^\w[\w.-]{0,127}$/;
const PATH_COMPONENT = /^[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*$/;
const REGISTRY_HOST = /^(?:localhost|[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)(?::\d{1,5})?$/;

/** Normalized `https://host[:port][/path]` without a trailing slash, or null: https only, no user, password, query or fragment. */
export function httpsBase(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > MAX_BASE_URL) return null;
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !url.hostname) return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

/** Host (with a non-default port) of an address, for menu hints; '' when the address is not valid. */
export function linkHost(base: string): string {
  const root = httpsBase(base);
  return root ? new URL(root).host : '';
}

/** The link only when it stays on the origin of the address and within the link length. */
function onBase(root: string, href: string): string | null {
  try {
    return new URL(href).origin === new URL(root).origin && href.length <= MAX_LINK_LENGTH ? href : null;
  } catch { return null; }
}

/** Namespace (apps in any namespace) and name of a valid Argo CD application name, else null. */
export function argoAppParts(app: string): { namespace?: string; name: string } | null {
  if (app.length > 253) return null;
  const match = ARGO_APP.exec(app);
  if (!match) return null;
  return match[1] ? { namespace: match[1], name: match[2] } : { name: match[2] };
}

const stringAt = (map: unknown, key: string): string | undefined => {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return undefined;
  const value = (map as Record<string, unknown>)[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
};

/**
 * Argo CD application that tracks an object: the tracking-id annotation (Argo CD 3 default) when it names this object,
 * else the instance label. Only valid application names count; cluster input never becomes anything else.
 */
export function argoAppOf(meta: { name?: unknown; namespace?: unknown; labels?: unknown; annotations?: unknown }): string | undefined {
  const tracking = stringAt(meta.annotations, ARGO_TRACKING_ANNOTATION);
  const match = tracking ? TRACKING_ID.exec(tracking) : null;
  // Argo CD ignores a copied annotation whose namespace or name does not match; so does Shellherd.
  if (match && match[3] === meta.name && match[2] === (meta.namespace ?? '') && argoAppParts(match[1])) return match[1];
  const label = stringAt(meta.labels, ARGO_INSTANCE_LABEL);
  return label && argoAppParts(label) ? label : undefined;
}

/** `<base>/applications/<name>` or `<base>/applications/<namespace>/<name>`; null for an invalid address or name. */
export function argoAppUrl(base: string, app: string): string | null {
  const root = httpsBase(base);
  const parts = argoAppParts(app);
  if (!root || !parts) return null;
  return onBase(root, `${root}/applications/${parts.namespace ? `${parts.namespace}/` : ''}${parts.name}`);
}

export interface ParsedImage { host: string; project: string; repository: string; tag?: string; digest?: string }

/** `host[:port]/project/repo[/…][:tag][@sha256:…]`; null without a registry host or with anything outside the OCI patterns. */
export function parseImage(image: string): ParsedImage | null {
  const trimmed = image.trim();
  if (trimmed.length > MAX_BASE_URL) return null;
  const at = trimmed.indexOf('@');
  const digest = at >= 0 ? trimmed.slice(at + 1) : undefined;
  if (digest !== undefined && !DIGEST.test(digest)) return null;
  const name = at >= 0 ? trimmed.slice(0, at) : trimmed;
  const slash = name.indexOf('/');
  if (slash < 0) return null;
  const host = name.slice(0, slash).toLowerCase().replace(/:443$/, '');
  if (!REGISTRY_HOST.test(host)) return null;
  const rest = name.slice(slash + 1);
  const colon = rest.lastIndexOf(':');
  const tag = colon >= 0 ? rest.slice(colon + 1) : undefined;
  if (tag !== undefined && !TAG.test(tag)) return null;
  const segments = (colon >= 0 ? rest.slice(0, colon) : rest).split('/');
  if (segments.length < 2 || !segments.every(segment => PATH_COMPONENT.test(segment))) return null;
  return { host, project: segments[0], repository: segments.slice(1).join('/'), ...(tag ? { tag } : {}), ...(digest ? { digest } : {}) };
}

/** Digest of the running image when status.imageID names the same repository as the spec image (`docker-pullable://` allowed). */
export function digestOf(image: string, imageID: string | undefined): string | undefined {
  if (!imageID) return undefined;
  const id = imageID.replace(/^docker-pullable:\/\//, '');
  const at = id.lastIndexOf('@');
  if (at <= 0) return undefined;
  const digest = id.slice(at + 1);
  const repository = image.split('@')[0].replace(/:[^:/]*$/, '');
  return DIGEST.test(digest) && id.slice(0, at) === repository ? digest : undefined;
}

/**
 * Harbor page of an image: the artifact for a digest (in the image or the running one), else the repository.
 * null when the image does not live on the Harbor host of `base`; never a link to another host.
 */
export function harborImageUrl(base: string, image: string, digest?: string): string | null {
  const root = httpsBase(base);
  const parsed = parseImage(image);
  if (!root || !parsed || parsed.host !== new URL(root).host) return null;
  const reference = parsed.digest ?? (digest && DIGEST.test(digest) ? digest : undefined);
  const repository = `${root}/harbor/projects/${parsed.project}/repositories/${encodeURIComponent(parsed.repository)}/artifacts-tab`;
  return onBase(root, reference ? `${repository}/artifacts/${reference}` : repository);
}
