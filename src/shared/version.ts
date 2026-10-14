/** Release notes of one version, read from CHANGELOG.md. */
export interface ReleaseNotes { version: string; date: string; items: string[] }

const HEADING = /^## \[(\d+\.\d+\.\d+)\] – (\d{4}-\d{2}-\d{2})\s*$/;

/** All versions in CHANGELOG.md, newest first as written there. */
export function parseChangelog(markdown: string): ReleaseNotes[] {
  const releases: ReleaseNotes[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const heading = HEADING.exec(line);
    if (heading) { releases.push({ version: heading[1], date: heading[2], items: [] }); continue; }
    if (line.startsWith('## ')) { releases.push({ version: '', date: '', items: [] }); continue; }
    const current = releases.at(-1);
    if (current?.version && line.startsWith('- ')) current.items.push(line.slice(2).trim());
    else if (current?.version && /^\s{2,}\S/.test(line) && current.items.length) current.items[current.items.length - 1] += ` ${line.trim()}`;
  }
  return releases.filter(release => release.version);
}

/** Negative, zero or positive like a sort comparator; only `x.y.z`. */
export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

/** Notes of every version newer than `seen` up to `current`; all of `current` when nothing was seen yet. */
export function notesSince(releases: ReleaseNotes[], current: string, seen: string | null): ReleaseNotes[] {
  return releases.filter(release => compareVersions(release.version, current) <= 0
    && (seen ? compareVersions(release.version, seen) > 0 : release.version === current));
}
