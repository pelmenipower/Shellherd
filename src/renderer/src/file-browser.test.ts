import { afterEach, describe, expect, it } from 'vitest';
import type { FileEntry } from '../../shared/sftp';
import { i18n } from './i18n';
import { formatSize, ipcErrorText, modeText, parseMode, joinPath, nameError, nextSelection, parentPath, formatDate, pathSegments, sortEntries } from './file-browser';

const file = (name: string, size = 0, modified = 0): FileEntry => ({ name, type: 'file', size, modified });
const folder = (name: string): FileEntry => ({ name, type: 'directory', size: 0, modified: 0 });

describe('file browser', () => {
  it('sorts folders and links to folders first, names naturally', () => {
    const link: FileEntry = { name: 'b-link', type: 'link', size: 0, modified: 0, linkTarget: 'directory' };
    const sorted = sortEntries([file('file10'), file('file2'), folder('z'), link, file('a')], { key: 'name', ascending: true });
    expect(sorted.map(entry => entry.name)).toEqual(['b-link', 'z', 'a', 'file2', 'file10']);
    const bySize = sortEntries([file('a', 5), file('b', 50), folder('c')], { key: 'size', ascending: false });
    expect(bySize.map(entry => entry.name)).toEqual(['c', 'b', 'a']);
  });

  it('navigates remote and Windows paths up to their root', () => {
    expect(parentPath('remote', '/home/user')).toBe('/home');
    expect(parentPath('remote', '/home')).toBe('/');
    expect(parentPath('remote', '/')).toBeNull();
    expect(parentPath('local', 'C:\\Users\\me')).toBe('C:\\Users');
    expect(parentPath('local', 'C:\\Users')).toBe('C:\\');
    expect(parentPath('local', 'C:\\')).toBeNull();
    expect(joinPath('remote', '/', 'etc')).toBe('/etc');
    expect(joinPath('local', 'C:\\', 'Temp')).toBe('C:\\Temp');
    expect(pathSegments('local', 'C:\\Users\\me').map(segment => segment.label)).toEqual(['C:', 'Users', 'me']);
    expect(pathSegments('remote', '/var/log').map(segment => segment.path)).toEqual(['/', '/var', '/var/log']);
  });

  it('rejects names the target side cannot store', () => {
    expect(nameError('remote', 'a/b')).toMatch('Schrägstrich');
    expect(nameError('local', 'a:b')).toMatch('Zeichen');
    expect(nameError('local', '..')).toMatch('nicht erlaubt');
    expect(nameError('remote', 'report.txt')).toBeNull();
  });

  it('selects like Explorer with Ctrl and Shift', () => {
    const names = ['a', 'b', 'c', 'd'];
    expect(nextSelection(names, [], null, 'b', { ctrl: false, shift: false })).toEqual({ selected: ['b'], anchor: 'b' });
    expect(nextSelection(names, ['b'], 'b', 'd', { ctrl: false, shift: true }).selected).toEqual(['b', 'c', 'd']);
    expect(nextSelection(names, ['b'], 'b', 'd', { ctrl: true, shift: false }).selected).toEqual(['b', 'd']);
    expect(nextSelection(names, ['b', 'd'], 'd', 'b', { ctrl: true, shift: false }).selected).toEqual(['d']);
  });

  it('formats sizes and strips IPC prefixes', () => {
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(1536)).toBe('1,5 KB');
    expect(formatSize(50 * 1024 * 1024)).toBe('50 MB');
    expect(ipcErrorText(new Error("Error invoking remote method 'sftp:list': Error: Zugriff verweigert."))).toBe('Zugriff verweigert.');
  });

  it('converts permission bits to and from octal text', () => {
    expect(parseMode('644')).toBe(0o644);
    expect(parseMode('0755')).toBe(0o755);
    expect(parseMode('2775')).toBe(0o2775);
    expect(parseMode('8')).toBeNull();
    expect(parseMode('rwx')).toBeNull();
    expect(modeText(0o100644)).toBe('644');
    expect(modeText(0o4755)).toBe('4755');
  });
  it('asks for a missing name as an imperative', () => {
    expect(nameError('remote', ' ')).toBe('Gib einen Namen ein.');
  });
});


describe('file browser in en-US', () => {
  afterEach(async () => { await i18n.changeLanguage('de-DE'); });

  it('formats sizes, dates and name errors in English', async () => {
    await i18n.changeLanguage('en-US');
    expect(formatSize(1536)).toBe('1.5 KB');
    expect(formatSize(512)).toBe('512 B');
    expect(formatDate(Date.UTC(2026, 9, 19, 13, 5))).toMatch(/^\d{1,2}\/\d{1,2}\/\d{2},\s\d{1,2}:\d{2}\s?[AP]M$/u);
    expect(formatDate(0)).toBe('');
    expect(nameError('remote', 'a/b')).toBe('The name must not contain a slash.');
    expect(ipcErrorText('')).toBe('The file action failed.');
  });
});
