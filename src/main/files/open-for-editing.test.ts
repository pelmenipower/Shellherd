import { describe, expect, it } from 'vitest';
import { editorFor } from './ipc';

describe('editorFor', () => {
  it('sends anything but known text types to Notepad', () => {
    for (const name of ['evil.bat.', 'evil.bat ', 'x.chm', 'x.py', 'x.sh', 'x.html', 'noext']) expect(editorFor(name, 'default')).toBe('notepad');
  });
  it('opens text, config and compiled-language sources in the default program', () => {
    for (const name of ['x.txt', 'x.yaml', 'x.cs']) expect(editorFor(name, 'default')).toBe('default');
  });
  it('honors an explicit Notepad choice', () => expect(editorFor('x.txt', 'notepad')).toBe('notepad'));
});
