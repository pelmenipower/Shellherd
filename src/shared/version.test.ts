import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareVersions, inlineCode, notesSince, parseChangelog } from './version';

const changelog = readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8');
const changelogEn = readFileSync(new URL('../../CHANGELOG.en.md', import.meta.url), 'utf8');
const packageVersion = (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }).version;

describe('versioning', () => {
  it('has release notes for the current package version', () => {
    const releases = parseChangelog(changelog);
    expect(releases[0].version).toBe(packageVersion);
    expect(releases[0].items.length).toBeGreaterThan(0);
  });

  it('has release notes for the current package version in English too', () => {
    const releases = parseChangelog(changelogEn);
    expect(releases[0].version).toBe(packageVersion);
    expect(releases[0].items.length).toBeGreaterThan(0);
  });

  it('keeps CHANGELOG.md and CHANGELOG.en.md in parity', () => {
    const summary = (markdown: string) => parseChangelog(markdown).map(({ version, date, items }) => ({ version, date, count: items.length }));
    expect(summary(changelogEn)).toEqual(summary(changelog));
  });

  it('compares versions numerically', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.2.0', '0.2.1')).toBeLessThan(0);
  });

  it('shows notes of every version since the last one seen', () => {
    const releases = parseChangelog('## [0.3.0] – 2026-11-01\n- C\n## [0.2.0] – 2026-10-14\n- B\n  more\n## [0.1.0] – 2026-09-01\n- A\n');
    expect(releases[1].items).toEqual(['B more']);
    expect(notesSince(releases, '0.3.0', '0.1.0').map(release => release.version)).toEqual(['0.3.0', '0.2.0']);
    expect(notesSince(releases, '0.3.0', '0.3.0')).toEqual([]);
    expect(notesSince(releases, '0.2.0', null).map(release => release.version)).toEqual(['0.2.0']);
  });
});

describe('inlineCode', () => {
  it('splits backtick spans into code parts', () => {
    expect(inlineCode('`Esc` bricht ab, `Enter` verbindet')).toEqual([
      { code: true, text: 'Esc' }, { code: false, text: ' bricht ab, ' }, { code: true, text: 'Enter' }, { code: false, text: ' verbindet' },
    ]);
  });

  it('keeps text without backticks and an unpaired backtick as plain text', () => {
    expect(inlineCode('Kein Code')).toEqual([{ code: false, text: 'Kein Code' }]);
    expect(inlineCode('a ` b')).toEqual([{ code: false, text: 'a ` b' }]);
  });

  it('leaves no backtick in any item of the changelog', () => {
    for (const release of parseChangelog(changelog))
      for (const item of release.items)
        for (const part of inlineCode(item)) expect(part.text).not.toContain('`');
  });
});
