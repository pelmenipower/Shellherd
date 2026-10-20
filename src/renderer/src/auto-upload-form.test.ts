import { describe, expect, it } from 'vitest';
import { DEFAULT_EXCLUDES } from '../../shared/exclude-glob';
import { t } from './i18n';
import { autoUploadErrors, bindingFromDraft, bindingName, draftOf, newAutoUpload } from './auto-upload-form';
import type { AutoUploadBinding } from '../../shared/vault/types';

const make = (localPath: string, remotePath = '/srv/app', excludes: string[] = [], id = 'x'): AutoUploadBinding =>
  ({ id, localPath, remotePath, excludes, enabled: true });
const errors = (binding: AutoUploadBinding, others: AutoUploadBinding[] = []) => autoUploadErrors(binding, others);

describe('newAutoUpload', () => {
  it('has a UUID, the default excludes and is enabled', () => {
    const binding = newAutoUpload('C:\\a', '/srv');
    expect(binding.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(binding.excludes).toEqual([...DEFAULT_EXCLUDES]);
    expect(binding.excludes).not.toBe(DEFAULT_EXCLUDES);
    expect(binding).toMatchObject({ localPath: 'C:\\a', remotePath: '/srv', enabled: true });
  });
});

describe('draft and normalization', () => {
  it('round-trips excludes through the textarea text', () => {
    const binding = make('C:\\a', '/srv', ['a', 'b/']);
    expect(draftOf(binding)).toEqual({ localPath: 'C:\\a', remotePath: '/srv', excludes: 'a\nb/' });
  });
  it('normalizes local path: trim, slashes, trailing backslash', () => {
    const base = make('C:\\x', '/s', [], 'id1');
    const out = (localPath: string) => bindingFromDraft(base, { localPath, remotePath: '/s', excludes: '' }).localPath;
    expect(out('  C:/Projekte/app/  ')).toBe('C:\\Projekte\\app');
    expect(out('C:\\')).toBe('C:\\');
    expect(out('C:/')).toBe('C:\\');
    expect(out('\\\\srv\\share\\dir\\')).toBe('\\\\srv\\share\\dir');
  });
  it('normalizes remote path and excludes, keeps id and enabled', () => {
    const base = { ...make('C:\\x', '/s', [], 'id1'), enabled: false };
    const result = bindingFromDraft(base, { localPath: 'C:\\x', remotePath: ' /srv/app/ ', excludes: ' a \n\n  b/\r\n' });
    expect(result).toEqual({ id: 'id1', localPath: 'C:\\x', remotePath: '/srv/app', excludes: ['a', 'b/'], enabled: false });
    expect(bindingFromDraft(base, { localPath: 'C:\\x', remotePath: ' / ', excludes: '' }).remotePath).toBe('/');
  });
});

describe('bindingName', () => {
  it('is the last segment, else the whole path', () => {
    expect(bindingName({ localPath: 'C:\\Projekte\\app' })).toBe('app');
    expect(bindingName({ localPath: 'C:\\' })).toBe('C:\\');
    expect(bindingName({ localPath: '\\\\srv\\share' })).toBe('share');
  });
});

describe('autoUploadErrors', () => {
  it('accepts a valid binding', () => {
    expect(errors(make('C:\\a', '/srv', ['a', '*.tmp']))).toEqual({});
  });
  it('rejects non-absolute and device local paths and line breaks', () => {
    const message = t('files:sync.errors.localAbsolute');
    for (const path of ['app', 'C:app', '\\\\?\\C:\\x', '\\\\.\\C:\\x', 'C:\\a\nb', 'C:\\a\0'])
      expect(errors(make(path)).localPath, path).toBe(message);
  });
  it('rejects remote root, relative and line breaks', () => {
    expect(errors(make('C:\\a', '/')).remotePath).toBe(t('files:sync.errors.remoteRoot'));
    for (const path of ['srv', '', 'srv/app', '/a\nb', '/a\0'])
      expect(errors(make('C:\\a', path)).remotePath, path).toBe(t('files:sync.errors.remoteAbsolute'));
  });
  it('reports the first pattern with negation or control characters', () => {
    expect(errors(make('C:\\a', '/s', ['ok', '!keep'])).excludes).toBe(t('files:sync.errors.negation'));
    expect(errors(make('C:\\a', '/s', ['a\tb'])).excludes).toBe(t('files:sync.errors.patternChars'));
  });
  it('limits pattern count and length', () => {
    expect(errors(make('C:\\a', '/s', Array.from({ length: 201 }, (_, i) => `p${i}`))).excludes).toBe(t('files:sync.errors.patternChars'));
    expect(errors(make('C:\\a', '/s', Array.from({ length: 200 }, (_, i) => `p${i}`))).excludes).toBeUndefined();
    expect(errors(make('C:\\a', '/s', ['a'.repeat(257)])).excludes).toBe(t('files:sync.errors.patternChars'));
    expect(errors(make('C:\\a', '/s', ['a'.repeat(256)])).excludes).toBeUndefined();
  });
  it('detects overlap: same, ancestor, descendant, case; not a sibling prefix', () => {
    const other = make('C:\\Work\\App', '/o', [], 'other');
    const message = t('files:sync.errors.overlap', { name: 'App' });
    expect(errors(make('C:\\Work\\App'), [other]).localPath).toBe(message);
    expect(errors(make('C:\\work\\app'), [other]).localPath).toBe(message);
    expect(errors(make('C:\\Work'), [other]).localPath).toBe(message);
    expect(errors(make('C:\\Work\\App\\sub'), [other]).localPath).toBe(message);
    expect(errors(make('C:\\a'), [make('C:\\ab', '/o', [], 'o')]).localPath).toBeUndefined();
    expect(errors(make('C:\\Work\\App2'), [other]).localPath).toBeUndefined();
  });
  it('treats a trailing backslash like none for overlap', () => {
    expect(errors(make('C:\\a\\'), [make('C:\\a\\b', '/o', [], 'o')]).localPath).toBeDefined();
    expect(errors(make('C:\\'), [make('C:\\a', '/o', [], 'o')]).localPath).toBeDefined();
  });
  it('ignores itself by id (editing)', () => {
    expect(errors(make('C:\\a', '/s', [], 'same'), [make('C:\\a', '/s', [], 'same')]).localPath).toBeUndefined();
  });
});
