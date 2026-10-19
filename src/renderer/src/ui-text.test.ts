import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const FILES = readdirSync(ROOT, { recursive: true }).map(String).map(file => file.split(/[\\/]/).join('/'))
  .filter(file => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file)).sort();

// Allowlist of "file:line" entries; intentionally empty (fix the text instead).
const ALLOWED: ReadonlySet<string> = new Set<string>();

/** Three ASCII dots that are not a spread/rest operator (spread is followed by an identifier, [, (, { or $). */
const DOTS = /\.\.\.(?![\w[({$])/;
/** A string literal that starts with the filler word "Bitte ". */
const BITTE = /(['"`])Bitte /;

/**
 * Blanks out comments while keeping every newline, so line numbers stay valid.
 * Removes block comments and `//` only at line start or after whitespace (so `https://` survives).
 */
function stripComments(source: string): string {
  const blank = (text: string): string => text.replace(/[^\n]/g, ' ');
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|\s)\/\/[^\n]*/g, (match, lead: string) => lead + blank(match.slice(lead.length)));
}

/** Lints one source file and returns violations as "<file>:<line> <rule> <text>". */
function lint(file: string, source: string): string[] {
  const out: string[] = [];
  stripComments(source).split('\n').forEach((line, index) => {
    const where = `${file}:${index + 1}`;
    if (ALLOWED.has(where)) return;
    if (DOTS.test(line)) out.push(`${where} "..." statt "…": ${line.trim()}`);
    if (BITTE.test(line)) out.push(`${where} "Bitte " am Textanfang: ${line.trim()}`);
  });
  return out;
}

const BAD_FIXTURE = [
  "const a = 'Speichert ...';",
  'const b = "Bitte warten";',
  'const c = `Bitte ${x}`;',
  '<span>Lade ...</span>',
].join('\n');

const GOOD_FIXTURE = [
  'const a = fn(...args);',
  'const b = [...x];',
  'const c = {...y};',
  'const d = { ...y, z };',
  'const e = [...[1, 2]];',
  "const f = 'Speichert …';",
  'const g = "Warte kurz";',
  "const h = 'https://example.com/a';",
  "const i = 'Bitte' + x;",
  '// Bitte warten ... hier',
  'const j = 1; // Speichert ...',
  '/* Bitte ... \n "Bitte warten" ... */',
  '/**\n * Loads ... "Bitte x"\n */',
].join('\n');

describe('ui text lint', () => {
  it('finds the source files', () => {
    expect(FILES).toContain('App.tsx');
    expect(FILES.some(file => file.endsWith('.test.ts'))).toBe(false);
  });

  for (const file of FILES) {
    it(file, () => {
      expect(lint(file, readFileSync(`${ROOT}${file}`, 'utf8'))).toEqual([]);
    });
  }

  it('flags three dots and "Bitte " literals', () => {
    const found = lint('fixture.ts', BAD_FIXTURE);
    expect(found.filter(line => line.includes('"..."')).map(line => line.split(' ')[0])).toEqual(['fixture.ts:1', 'fixture.ts:4']);
    expect(found.filter(line => line.includes('"Bitte "')).map(line => line.split(' ')[0])).toEqual(['fixture.ts:2', 'fixture.ts:3']);
  });

  it('accepts spread, rest, comments and clean text', () => {
    expect(lint('fixture.ts', GOOD_FIXTURE)).toEqual([]);
  });

  it('keeps line numbers across block comments', () => {
    const found = lint('fixture.ts', '/* a\nb */\nconst x = "Bitte warten";');
    expect(found[0]?.startsWith('fixture.ts:3 ')).toBe(true);
  });

  it('has an empty allowlist', () => {
    expect(ALLOWED.size).toBe(0);
  });
});
