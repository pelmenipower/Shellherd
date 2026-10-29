import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LEGACY_USER_DATA_FILES, migrateUserData } from './user-data';

describe('migrateUserData', () => {
  let root: string;
  let source: string;
  let target: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'shellherd-userdata-test-'));
    source = join(root, 'Terminus');
    target = join(root, 'Shellherd');
    mkdirSync(source);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('copies both files and creates the target when it is missing', () => {
    writeFileSync(join(source, 'known-hosts.json'), '{"hosts":1}');
    writeFileSync(join(source, 'last-vault.json'), '{"path":"x"}');
    expect(migrateUserData(source, target).sort()).toEqual(['known-hosts.json', 'last-vault.json']);
    expect(readFileSync(join(target, 'known-hosts.json'), 'utf8')).toBe('{"hosts":1}');
    expect(readFileSync(join(target, 'last-vault.json'), 'utf8')).toBe('{"path":"x"}');
  });

  it('never overwrites an existing target file, even an empty one', () => {
    writeFileSync(join(source, 'known-hosts.json'), 'old');
    writeFileSync(join(source, 'last-vault.json'), 'old');
    mkdirSync(target);
    writeFileSync(join(target, 'known-hosts.json'), '');
    expect(migrateUserData(source, target)).toEqual(['last-vault.json']);
    expect(readFileSync(join(target, 'known-hosts.json'), 'utf8')).toBe('');
  });

  it('returns [] without throwing when the source file or folder is missing', () => {
    expect(migrateUserData(source, target)).toEqual([]);
    expect(migrateUserData(join(root, 'nope'), target)).toEqual([]);
  });

  it('leaves the source untouched', () => {
    writeFileSync(join(source, 'known-hosts.json'), 'a');
    writeFileSync(join(source, 'other.bin'), 'b');
    migrateUserData(source, target);
    expect(readdirSync(source).sort()).toEqual(['known-hosts.json', 'other.bin']);
    expect(readFileSync(join(source, 'known-hosts.json'), 'utf8')).toBe('a');
  });

  it('does nothing when source and target are the same path in another spelling', () => {
    writeFileSync(join(source, 'known-hosts.json'), 'a');
    expect(migrateUserData(source, join(root, 'TERMINUS'))).toEqual(process.platform === 'win32' ? [] : ['known-hosts.json']);
    expect(migrateUserData(source, join(source, '..', 'Terminus'))).toEqual([]);
  });

  it('skips a source that is a directory', () => {
    mkdirSync(join(source, 'known-hosts.json'));
    expect(migrateUserData(source, target)).toEqual([]);
  });

  it('skips names with path separators', () => {
    mkdirSync(join(source, 'a'));
    writeFileSync(join(source, 'a', 'b'), 'x');
    writeFileSync(join(root, 'x'), 'x');
    expect(migrateUserData(source, target, ['..\\x', 'a/b', '../x'])).toEqual([]);
  });

  it('retries a rename that fails once with EPERM', () => {
    writeFileSync(join(source, 'known-hosts.json'), 'a');
    let calls = 0;
    const ops = {
      rename: (from: string, to: string) => {
        if (++calls === 1) throw Object.assign(new Error('locked'), { code: 'EPERM' });
        renameSync(from, to);
      },
      sleep: () => {},
    };
    expect(migrateUserData(source, target, ['known-hosts.json'], ops)).toEqual(['known-hosts.json']);
    expect(calls).toBe(2);
    expect(readFileSync(join(target, 'known-hosts.json'), 'utf8')).toBe('a');
    expect(readdirSync(target).filter(name => name.endsWith('.migrating'))).toEqual([]);
  });

  it('gives up after three failed renames and cleans up its temp file', () => {
    writeFileSync(join(source, 'known-hosts.json'), 'a');
    let calls = 0;
    const ops = {
      rename: () => {
        calls++;
        throw Object.assign(new Error('busy'), { code: 'EBUSY' });
      },
      sleep: () => {},
    };
    expect(migrateUserData(source, target, ['known-hosts.json'], ops)).toEqual([]);
    expect(calls).toBe(3);
    expect(existsSync(join(target, 'known-hosts.json'))).toBe(false);
    expect(readdirSync(target).filter(name => name.endsWith('.migrating'))).toEqual([]);
    expect(readFileSync(join(source, 'known-hosts.json'), 'utf8')).toBe('a');
  });

  it('removes orphaned <target>.*.migrating files from earlier runs, only that pattern', () => {
    writeFileSync(join(source, 'known-hosts.json'), 'a');
    mkdirSync(target);
    writeFileSync(join(target, 'known-hosts.json.dead-beef.migrating'), 'half');
    writeFileSync(join(target, 'last-vault.json.dead-beef.migrating'), 'other');
    writeFileSync(join(target, 'keep.migrating'), 'x');
    writeFileSync(join(target, 'known-hosts.json.bak'), 'x');
    migrateUserData(source, target, ['known-hosts.json']);
    expect(readdirSync(target).sort()).toEqual(['keep.migrating', 'known-hosts.json', 'known-hosts.json.bak', 'last-vault.json.dead-beef.migrating']);
  });

  it('leaves no *.migrating file behind', () => {
    for (const name of LEGACY_USER_DATA_FILES) writeFileSync(join(source, name), 'x');
    migrateUserData(source, target);
    migrateUserData(source, target);
    expect(readdirSync(target).filter(name => name.endsWith('.migrating'))).toEqual([]);
  });
});
