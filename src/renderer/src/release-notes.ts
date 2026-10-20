import changelogDe from '../../../CHANGELOG.md?raw';
import changelogEn from '../../../CHANGELOG.en.md?raw';
import type { Locale } from '../../shared/locale';
import { parseChangelog } from '../../shared/version';
import type { ReleaseNotes } from '../../shared/version';

const byLocale: Record<Locale, ReleaseNotes[]> = {
  'de-DE': parseChangelog(changelogDe),
  'en-US': parseChangelog(changelogEn),
};

/** Release notes bundled from CHANGELOG.md / CHANGELOG.en.md, newest first. */
export function releasesFor(locale: Locale): ReleaseNotes[] { return byLocale[locale]; }

const SEEN_KEY = 'shellherd.seenVersion';

/** Last version whose notes were dismissed on this computer; storage may be unavailable. */
export function seenVersion(): string | null {
  try { return localStorage.getItem(SEEN_KEY); } catch { return null; }
}

export function markVersionSeen(version: string): void {
  try { localStorage.setItem(SEEN_KEY, version); } catch { /* notes show again next time */ }
}
