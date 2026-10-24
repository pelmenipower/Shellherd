import { MAX_FORWARDS } from '../../shared/vault/schema';
import type { ForwardKind } from '../../shared/ssh';
import type { PortForward } from '../../shared/vault/types';
import { t } from './i18n';

/** A port forward as typed in the editor; ports stay text until validated. */
export interface ForwardDraft { id: string; kind: ForwardKind; listenPort: string; targetHost: string; targetPort: string; auto: boolean }

export function newForwardDraft(): ForwardDraft {
  return { id: crypto.randomUUID(), kind: 'local', listenPort: '', targetHost: '', targetPort: '', auto: false };
}

export function draftsFromForwards(forwards: PortForward[] | undefined): ForwardDraft[] {
  return (forwards ?? []).map(forward => {
    const base = { id: forward.id, kind: forward.kind, auto: forward.auto };
    if (forward.kind === 'dynamic') return { ...base, listenPort: String(forward.localPort), targetHost: '', targetPort: '' };
    const listenPort = forward.kind === 'local' ? forward.localPort : forward.remotePort;
    return { ...base, listenPort: String(listenPort), targetHost: forward.targetHost, targetPort: String(forward.targetPort) };
  });
}

/** Same rule as the connection form's remote port: an integer from 1 to 65535. */
function parsePort(text: string): number {
  const value = text.trim();
  if (!/^\d+$/.test(value)) throw new Error(t('connection:validation.portInteger'));
  const port = Number(value);
  if (port < 1 || port > 65535) throw new Error(t('connection:validation.portRange'));
  return port;
}

/** Throws Error(message) with the translated text. Duplicate local listen ports (local and dynamic) are rejected; remote ports are not local. */
export function forwardsFromDrafts(drafts: ForwardDraft[]): PortForward[] | undefined {
  if (drafts.length === 0) return undefined;
  if (drafts.length > MAX_FORWARDS) throw new Error(t('connection:validation.forwardTooMany', { max: MAX_FORWARDS }));
  const localPorts = new Set<number>();
  return drafts.map((draft): PortForward => {
    const port = parsePort(draft.listenPort);
    if (draft.kind !== 'remote') {
      if (localPorts.has(port)) throw new Error(t('connection:validation.forwardPortTwice', { port }));
      localPorts.add(port);
    }
    if (draft.kind === 'dynamic') return { id: draft.id, kind: 'dynamic', localPort: port, auto: draft.auto };
    const targetHost = draft.targetHost.trim();
    if (!targetHost) throw new Error(t('connection:validation.forwardTargetMissing'));
    const targetPort = parsePort(draft.targetPort);
    if (draft.kind === 'remote') return { id: draft.id, kind: 'remote', remotePort: port, targetHost, targetPort, auto: draft.auto };
    return { id: draft.id, kind: 'local', localPort: port, targetHost, targetPort, auto: draft.auto };
  });
}
