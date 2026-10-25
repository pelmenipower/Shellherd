import { compareText, foldCase } from '../../shared/format';
import { hostLabel } from '../../shared/known-hosts';
import type { KnownHostOrigin, KnownHostView } from '../../shared/known-hosts';
import { t } from './i18n';

/** Shown name: host[:port]; hashed names and revoked keys get a fixed text. */
export function knownHostName(view: KnownHostView): string {
  if (view.origin === 'revoked') return t('app:hostKeys.anyHost');
  return view.host === null || view.port === null ? t('app:hostKeys.hashed') : hostLabel(view.host, view.port);
}

/** Full literals, so unused keys can be found by search. */
export const originLabel = (origin: KnownHostOrigin): string => ({
  confirmed: t('app:hostKeys.origin.confirmed'),
  imported: t('app:hostKeys.origin.imported'),
  revoked: t('app:hostKeys.origin.revoked'),
})[origin];

const rank = (view: KnownHostView): number => view.origin === 'revoked' ? 2 : view.host === null ? 1 : 0;

/** Named entries by name, then hashed, then revoked; store order inside the last two groups. */
export function sortKnownHosts(list: readonly KnownHostView[]): KnownHostView[] {
  return [...list].sort((a, b) => rank(a) - rank(b) || (rank(a) === 0 ? compareText(knownHostName(a), knownHostName(b)) : 0));
}

/** "Contains" on name, type and fingerprint, ignoring case; an empty query matches everything. */
export function matchesKnownHost(view: KnownHostView, query: string): boolean {
  const needle = foldCase(query.trim());
  return !needle || [knownHostName(view), view.type ?? '', view.fingerprint].some(text => foldCase(text).includes(needle));
}
