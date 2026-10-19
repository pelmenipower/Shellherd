import changelog from '../../../CHANGELOG.md?raw';
import { parseChangelog } from '../../shared/version';

/** Release notes bundled from CHANGELOG.md, newest first. */
export const releases = parseChangelog(changelog);

const SEEN_KEY = 'shellherd.seenVersion';

/** Last version whose notes were dismissed on this computer; storage may be unavailable. */
export function seenVersion(): string | null {
  try { return localStorage.getItem(SEEN_KEY); } catch { return null; }
}

export function markVersionSeen(version: string): void {
  try { localStorage.setItem(SEEN_KEY, version); } catch { /* notes show again next time */ }
}
