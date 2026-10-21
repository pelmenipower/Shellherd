import { describe, expect, it } from 'vitest';
import { compileExcludes, DEFAULT_EXCLUDES, excludePatternError } from './exclude-glob';

// [pattern, path, isDirectory, expected]
const cases: [string, string, boolean, boolean][] = [
  ['.git', '.git', true, true],
  ['.git', 'a/.git', true, true],
  ['.git', 'a/.git/HEAD', false, true],
  ['.git', 'a/.gitignore', false, false],
  ['node_modules/', 'node_modules', true, true],
  ['node_modules/', 'x/node_modules/y', false, true],
  ['node_modules/', 'node_modules', false, false],
  ['*.log', 'a.log', false, true],
  ['*.log', 'x/a.log', false, true],
  ['*.log', '.hidden.log', false, true],
  ['*.log', 'A.LOG', false, true],
  ['/build/', 'build', true, true],
  ['/build/', 'src/build', true, false],
  ['secrets/**/*.pem', 'secrets/a.pem', false, true],
  ['secrets/**/*.pem', 'secrets/x/y/a.pem', false, true],
  ['secrets/**/*.pem', 'a/secrets/a.pem', false, false],
  ['~$*', '~$Report.docx', false, true],
  ['*.tmp', '.foo.tmp', false, true],
  ['[ab].txt', 'a.txt', false, true],
  ['[ab].txt', 'c.txt', false, false],
  ['[!a].txt', 'b.txt', false, true],
  ['[!a].txt', 'a.txt', false, false],
  ['a b/c d.txt', 'a b/c d.txt', false, true],
  ['(x)+.txt', '(x)+.txt', false, true],
  ['(x)+.txt', 'xx.txt', false, false],
  ['a[b', 'a[b', false, true],
  ['a?c', 'abc', false, true],
  ['a?c', 'a/c', false, false],
  ['build\\', 'build', true, true],
  ['src\\gen\\*.js', 'src/gen/a.js', false, true],
  ['src/*.js', 'src/a/b.js', false, false],
  ['#x', '#x', false, false],
  ['   ', 'a', false, false],
  ['/', 'a', true, false],
  ['**', 'a/b/c', false, true],
  ['!x', 'x', false, false],
  ['a\u0001b', 'a\u0001b', false, false],
  ['[z-a]', 'z', false, false], // invalid class: line ignored, no throw
  ['a/**', 'a/b/c', false, true],
  ['**/x', 'x', false, true],
  ['  .git  ', '.git', true, true],
];

describe('compileExcludes', () => {
  it.each(cases)('%j vs %j (dir=%s) -> %s', (pattern, path, isDir, expected) => {
    expect(compileExcludes([pattern])(path, isDir)).toBe(expected);
  });

  it('matches nothing for an empty list', () => {
    expect(compileExcludes([])('a', false)).toBe(false);
  });

  it('DEFAULT_EXCLUDES hits the usual junk and spares sources', () => {
    const m = compileExcludes(DEFAULT_EXCLUDES);
    expect(m('.git/config', false)).toBe(true);
    expect(m('x/node_modules/y/z.js', false)).toBe(true);
    expect(m('~$a.docx', false)).toBe(true);
    expect(m('.foo.tmp', false)).toBe(true);
    expect(m('src/app.ts', false)).toBe(false);
  });
});

describe('excludePatternError', () => {
  it('reports negation and control characters, negation first', () => {
    expect(excludePatternError('!x')).toBe('negation');
    expect(excludePatternError('  !x')).toBe('negation');
    expect(excludePatternError('!a\u0001')).toBe('negation');
    expect(excludePatternError('a\u0001')).toBe('control');
    expect(excludePatternError('a\u007f')).toBe('control');
  });
  it('accepts normal, blank and comment lines', () => {
    expect(excludePatternError('*.log')).toBeNull();
    expect(excludePatternError('')).toBeNull();
    expect(excludePatternError('#!x')).toBeNull();
  });
});
