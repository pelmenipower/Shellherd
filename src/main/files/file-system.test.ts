import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileError, localFileSystem } from './file-system';

describe('fileError', () => {
  it('maps ENOTDIR to files.notADirectory', () => {
    expect(fileError({ code: 'ENOTDIR' })).toEqual({ code: 'files.notADirectory' });
  });
});

describe('local list on a file', () => {
  const base = mkdtempSync(join(tmpdir(), 'shellherd-fs-'));
  const file = join(base, 'notes.txt');
  beforeAll(() => { writeFileSync(file, 'synthetic'); });
  afterAll(() => { rmSync(base, { recursive: true, force: true }); });

  it('refuses a file as folder with files.notADirectory', async () => {
    const failure = await localFileSystem.list(file).then(() => null, error => fileError(error));
    expect(failure).toEqual({ code: 'files.notADirectory' });
  });

  it('keeps the error for a missing folder', async () => {
    const failure = await localFileSystem.list(join(base, 'fehlt')).then(() => null, error => fileError(error));
    expect(failure).toEqual({ code: 'files.notFound' });
  });
});
