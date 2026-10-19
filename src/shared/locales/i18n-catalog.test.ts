import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NAMESPACES, resources } from './index';

const LOCALES = ['de-DE', 'en-US'] as const;
const SRC = join(__dirname, '..', '..');

type Tree = { [key: string]: Tree | string };

/** Flattens a catalog to `a.b.c` → leaf. */
function flatten(tree: Tree, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object') Object.assign(out, flatten(value as Tree, path));
    else out[path] = value;
  }
  return out;
}

const catalog = (locale: (typeof LOCALES)[number], ns: string): Record<string, unknown> =>
  flatten((resources[locale] as unknown as Record<string, Tree>)[ns]);

const placeholders = (text: string): string[] =>
  [...new Set([...text.matchAll(/\{\{\s*([^}\s]+)\s*\}\}/g)].map(match => match[1]))].sort();

/** Source files below src/, optionally filtered by relative posix path. */
function sourceFiles(accept: (rel: string) => boolean): { rel: string; text: string }[] {
  const out: { rel: string; text: string }[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      const rel = relative(SRC, full).split(sep).join('/');
      if (/\.(ts|tsx)$/.test(rel) && !rel.endsWith('.test.ts') && !rel.startsWith('shared/locales/')
        && !rel.startsWith('test/') && accept(rel)) {
        out.push({ rel, text: readFileSync(full, 'utf8') });
      }
    }
  };
  walk(SRC);
  return out;
}

describe('i18n catalogs', () => {
  it.each(NAMESPACES)('(a) %s has identical keys in both languages', ns => {
    expect(Object.keys(catalog('en-US', ns)).sort()).toEqual(Object.keys(catalog('de-DE', ns)).sort());
  });

  it.each(NAMESPACES)('(b) %s has identical placeholders per key', ns => {
    const de = catalog('de-DE', ns);
    const en = catalog('en-US', ns);
    for (const key of Object.keys(de)) {
      expect(placeholders(String(en[key])), `${ns}:${key}`).toEqual(placeholders(String(de[key])));
    }
  });

  it.each(NAMESPACES)('(c) %s has only non-empty strings', ns => {
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(catalog(locale, ns))) {
        expect(typeof value, `${locale} ${ns}:${key}`).toBe('string');
        expect((value as string).trim(), `${locale} ${ns}:${key}`).not.toBe('');
      }
    }
  });

  it('(e) every errors/<area>.json has exactly the key <area> with flat string leaves', () => {
    const areas = ['ssh', 'containers', 'kubernetes', 'files', 'ai', 'core'];
    for (const locale of LOCALES) {
      for (const area of areas) {
        const file = join(__dirname, locale, 'errors', `${area}.json`);
        const json = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
        expect(Object.keys(json), `${locale}/${area}`).toEqual([area]);
        for (const [key, value] of Object.entries(json[area] as Record<string, unknown>)) {
          expect(typeof value, `${locale} ${area}.${key}`).toBe('string');
          expect(key, `${locale} ${area}.${key}`).not.toMatch(/_(one|other)$/);
        }
      }
    }
  });

  it('(f) has no three dots, no leading Bitte/Please, no space before the en-US ellipsis and matching quote styles', () => {
    for (const locale of LOCALES) {
      for (const ns of NAMESPACES) {
        for (const [key, value] of Object.entries(catalog(locale, ns))) {
          const text = value as string;
          const where = `${locale} ${ns}:${key}`;
          expect(text, where).not.toContain('...');
          expect(text, where).not.toMatch(/^(bitte|please) /i);
          // en-US writes the ellipsis without a space before it (de-DE keeps its own style)
          if (locale === 'en-US') expect(text, where).not.toContain(' …');
          if (locale === 'en-US') expect(text, where).not.toContain('„');
          else expect(text, where).not.toMatch(/(^|[\s(])“/);
        }
      }
    }
  });

  it('(d) has no orphaned keys', () => {
    const all = sourceFiles(() => true);
    const main = sourceFiles(rel => rel.startsWith('main/'));
    const quoted = (haystack: { text: string }[], literal: string): boolean =>
      haystack.some(file => ['\'', '"', '`'].some(q => file.text.includes(`${q}${literal}${q}`)));
    const orphans: string[] = [];
    for (const ns of NAMESPACES) {
      for (const key of Object.keys(catalog('de-DE', ns))) {
        const base = key.replace(/_(one|other)$/, '');
        const used = ns === 'errors'
          ? quoted(all, key) || quoted(all, `errors:${key}`)
          : ns === 'main'
            ? quoted(main, base) || quoted(all, `main:${base}`)
            : quoted(all, `${ns}:${base}`);
        if (!used) orphans.push(`${ns}:${key}`);
      }
    }
    expect(orphans).toEqual([]);
  });

  it('(g) has no hard-coded German text in code', () => {
    const files = sourceFiles(rel => /^(renderer|main|shared)\//.test(rel) && rel !== 'shared/vault/example.ts');
    const hits: string[] = [];
    for (const { rel, text } of files) {
      text.split('\n').forEach((line, index) => {
        const trimmed = line.trim();
        if (/^(\/\/|\*|\/\*|\{\/\*)/.test(trimmed) || line.includes('i18n-ignore')) return;
        const umlaut = /[äöüÄÖÜß]/.test(line);
        const jsxText = rel.endsWith('.tsx')
          && />\s*[A-Za-zÄÖÜäöüß][^<>{}]*\s[A-Za-zÄÖÜäöüß][^<>{}]*</.test(line);
        if (umlaut || jsxText) hits.push(`${rel}:${index + 1}: ${trimmed}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
