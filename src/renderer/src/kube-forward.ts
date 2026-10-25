import type { KubeForwardStatus, KubeForwardTarget, KubePort, KubeRow } from '../../shared/kubernetes';
import { formatNumber } from '../../shared/format';

/** Ports are identifiers, not quantities: no digit grouping. */
const plain = (value: number): string => formatNumber(value, { useGrouping: false });

/** Port typed in a form field: 1..65535. Empty is 0 (any free port) where allowed; anything else invalid is NaN. */
export function parsePort(text: string, emptyIsAny: boolean): number {
  const trimmed = text.trim();
  if (trimmed === '') return emptyIsAny ? 0 : NaN;
  if (!/^\d{1,5}$/.test(trimmed)) return NaN;
  const port = Number(trimmed);
  return port >= 1 && port <= 65_535 ? port : NaN;
}

/** Target as kubectl writes it: `pod:port` or `svc/name:port`. */
export function targetText(target: KubeForwardTarget): string {
  return target.kind === 'services' ? `svc/${target.name}:${plain(target.port)}` : `${target.name}:${plain(target.port)}`;
}

export const forwardAddress = (status: KubeForwardStatus): string => `127.0.0.1:${plain(status.localPort)}`;

// shortcut: only the usual TLS ports open as https; a port named "https" elsewhere opens as http. Upgrade with the port name if users ask.
export const forwardUrl = (status: KubeForwardStatus): string =>
  `${status.target.port === 443 || status.target.port === 8443 ? 'https' : 'http'}://${forwardAddress(status)}/`;

/** Target a pod or service row offers; null for other kinds and rows without a namespace. */
export function forwardTargetOf(row: KubeRow, port: number): KubeForwardTarget | null {
  const namespace = row.ref.namespace;
  if (!namespace || (row.ref.kind !== 'pods' && row.ref.kind !== 'services')) return null;
  return { kind: row.ref.kind, namespace, name: row.ref.name, port };
}

/** Option text of a port: "8080 (http)" or "8080". */
export const portLabel = (port: KubePort): string => (port.name ? `${plain(port.port)} (${port.name})` : plain(port.port));
