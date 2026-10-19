import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const FILES = readdirSync(ROOT, { recursive: true }).map(String).map(file => file.split(/[\\/]/).join('/'))
  .filter(file => file.endsWith('.css')).sort();

interface Block { selector: string; ancestors: string[]; declarations: Array<{ property: string; value: string }> }

interface Frame { prelude: string; text: string; hasChild: boolean }

/** Strips BOM and comments, then walks the text with a stack and returns every declaration block. */
function tokenize(css: string): Block[] {
  const text = css.replace(/^﻿/, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const stack: Frame[] = [];
  const blocks: Block[] = [];
  let buf = '';
  for (const ch of text) {
    if (ch === '{') {
      stack.push({ prelude: buf.trim(), text: '', hasChild: false });
      buf = '';
    } else if (ch === '}') {
      const frame = stack.pop();
      if (!frame) throw new Error('Unbalanced braces: stray "}"');
      frame.text += buf;
      buf = '';
      if (!frame.hasChild) {
        const declarations = frame.text.split(';').map(part => part.trim()).filter(Boolean).map(part => {
          const colon = part.indexOf(':');
          return colon < 0
            ? { property: part.toLowerCase(), value: '' }
            : { property: part.slice(0, colon).trim().toLowerCase(), value: part.slice(colon + 1).trim() };
        });
        blocks.push({ selector: frame.prelude, ancestors: stack.map(item => item.prelude), declarations });
      }
      const parent = stack[stack.length - 1];
      if (parent) parent.hasChild = true;
    } else if (ch === ';') {
      const top = stack[stack.length - 1];
      if (top) top.text += `${buf};`;
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (stack.length > 0) throw new Error('Unbalanced braces: missing "}"');
  return blocks;
}

const isMotion = (property: string): boolean => /^(transition|animation)(-|$)/.test(property);
const TRANSFORM_PROPS = ['transform', 'translate', 'scale', 'rotate'];
const STAGE = /\.(?:terminal-panel|terminal-container|split-terminal-stage|rdp-surface|kube-dock-terminal)(?![\w-])/;
const STAGE_FORBIDDEN = (property: string): boolean => property === 'transform' || property === 'filter' || property === 'will-change' || isMotion(property);

const EASES = {
  '--ease-out': 'cubic-bezier(0.23, 1, 0.32, 1)',
  '--ease-in-out': 'cubic-bezier(0.77, 0, 0.175, 1)',
  '--ease-drawer': 'cubic-bezier(0.32, 0.72, 0, 1)',
};
const ALIASES = ['--ui-bg', '--ui-panel', '--ui-raised', '--ui-border', '--ui-text', '--ui-muted', '--ui-accent', '--ui-danger',
  '--surface', '--surface-raised', '--surface-hover', '--border', '--text', '--text-muted', '--accent',
  '--ui-radius', '--ui-control-height', '--ui-input-height'];
const COLORS = ['bg-stage', 'bg-app', 'bg-panel', 'bg-raised', 'bg-hover', 'bg-input', 'bg-selected', 'bg-active', 'bg-drop', 'bg-tint',
  'overlay', 'backdrop', 'border', 'border-strong', 'text', 'text-muted', 'text-code', 'accent', 'accent-hover', 'on-accent',
  'selection-bg', 'selection-text', 'ok', 'warn', 'warn-border', 'danger', 'danger-strong', 'danger-text', 'danger-bg',
  'danger-bg-hover', 'danger-border'].map(name => `--color-${name}`);

/** Lints one stylesheet and returns violations as "<file> <rule> <selector> { <property>: <value> }". */
function lint(file: string, css: string): string[] {
  const isTokens = file === 'tokens.css';
  const out: string[] = [];
  const add = (rule: string, selector: string, property: string, value: string): void => {
    out.push(`${file} ${rule} ${selector} { ${property}: ${value} }`);
  };
  const stripped = css.replace(/^﻿/, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = tokenize(css);
  let hasMotion = false;

  for (const block of blocks) {
    const { selector, ancestors } = block;
    const ancestorText = ancestors.join(' ');
    for (const { property, value } of block.declarations) {
      const motion = isMotion(property);
      if (!isTokens) {
        if (/#[0-9a-f]{3,8}\b/i.test(value) || /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\(/i.test(value)) add('R1', selector, property, value);
        if (/var\(\s*--[\w-]+\s*,/.test(value)) add('R1', selector, property, value);
        if (motion && /(?:cubic-bezier|steps)\(/.test(value)) add('R3', selector, property, value);
        if (motion && /(?<![\w.-])(?:\d+\.?\d*|\.\d+)m?s(?![\w-])/.test(value)) add('R4', selector, property, value);
        if (property === 'z-index' && /^-?\d+$/.test(value)) add('R6', selector, property, value);
        if (property.startsWith('--')) add('R11', selector, property, value);
        if (/var\(\s*--(?:ui-[\w-]+|surface(?:-raised|-hover)?|border|text|text-muted|accent)\s*\)/.test(value)) add('R12', selector, property, value);
      }
      if ((property === 'transition' || property === 'transition-property') && /(?<![-\w])all(?![-\w])/.test(value)) add('R2', selector, property, value);
      if (motion && /(?<![-\w])(?:ease|ease-in|ease-out|ease-in-out|step-start|step-end)(?![-\w])/.test(value)) add('R3', selector, property, value);
      if (/\bscale(?:X|Y|Z|3d)?\(\s*0\s*[,)]/.test(value)) add('R5', selector, property, value);
      if (motion && value !== 'none') hasMotion = true;
      const gated = ancestors.some(item => /prefers-reduced-motion:\s*no-preference/.test(item));
      if (TRANSFORM_PROPS.includes(property) && value !== 'none' && (ancestors.includes('@starting-style') || /:active/.test(selector)) && !gated) add('R7b', selector, property, value);
      if (motion && value.includes('transform') && !gated) add('R7b', selector, property, value);
      if (/:hover/.test(selector) && (TRANSFORM_PROPS.includes(property) || motion) && !/\(hover:\s*hover\)/.test(ancestorText)) add('R8', selector, property, value);
      if (STAGE.test(selector) && STAGE_FORBIDDEN(property)) add('R13', selector, property, value);
    }
  }
  if (hasMotion && !css.includes('prefers-reduced-motion')) add('R7', '-', 'motion', 'no prefers-reduced-motion');
  if (file === 'styles.css') {
    if (!stripped.trim().startsWith("@import './tokens.css';")) add('R10', '-', '@import', 'styles.css must start with the tokens import');
  } else if (/@import/.test(stripped)) {
    add('R10', '-', '@import', 'only styles.css may import');
  }

  if (isTokens) {
    const declared = new Map<string, string>();
    for (const block of blocks) {
      for (const { property, value } of block.declarations) {
        if (property.startsWith('--')) declared.set(property, value.replace(/\s+/g, ' '));
        if (/^--dur-/.test(property) && property !== '--dur-pulse') {
          const match = /^(\d+)ms$/.exec(value);
          if (!match || Number(match[1]) > 300) add('R4', block.selector, property, value);
        }
      }
    }
    for (const [name, value] of Object.entries(EASES)) {
      if (declared.get(name) !== value) add('R9', ':root', name, declared.get(name) ?? 'missing');
    }
    for (const name of [...ALIASES, ...COLORS]) {
      if (!declared.has(name)) add('R9', ':root', name, 'missing');
    }
    if (!blocks.some(block => block.ancestors.some(item => item.replace(/\s+/g, ' ') === '@keyframes tm-pulse'))) add('R9', '-', '@keyframes', 'tm-pulse missing');
    const layer = (name: string): number => Number(declared.get(`--layer-${name}`));
    const order = ['header', 'popover', 'menu', 'modal', 'toast'].map(layer);
    if (order.some((value, index) => !Number.isFinite(value) || (index > 0 && value <= order[index - 1]))) add('R9', ':root', '--layer-*', 'order header < popover < menu < modal < toast violated');
  }
  return out;
}

const RULE_IDS = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R7b', 'R8', 'R11', 'R12', 'R13'];

const BAD_FIXTURE = `
.a { color: #fff; background: rgb(0 0 0 / 5%); }
.b { color: var(--color-text, red); }
.c { transition: all 1s; }
.d { transition: opacity var(--dur-fade) ease-out; }
.e { animation: spin 200ms linear; }
.f { transform: scale(0); }
.g { z-index: 5; }
.h:hover { transition: opacity var(--dur-fade) linear; }
.i:active { transform: scale(.97); }
.j { --foo: 1px; }
.k { color: var(--ui-text); }
.terminal-panel { transform: none; }
`;

const GOOD_FIXTURE = `
.release-notes-dialog { text-transform: uppercase; color: var(--color-text); }
#add { color: var(--color-accent); }
.x { transition: width var(--dur-fade) linear; z-index: calc(var(--layer-chrome) + 5); }
@media (prefers-reduced-motion: no-preference) {
  .y:active { transform: scale(.97); }
}
`;

describe('design tokens lint', () => {
  it('R0 finds every stylesheet', () => {
    for (const file of ['tokens.css', 'styles.css', 'terminal-ui.css', 'files-ui.css', 'assistant-ui.css', 'workflows-ui.css',
      'kubernetes-ui.css', 'kubernetes-dock.css', 'containers-ui.css', 'components/navigation-ui.css', 'components/editor-ui.css']) {
      expect(FILES).toContain(file);
    }
  });

  for (const file of FILES) {
    it(file, () => {
      expect(lint(file, readFileSync(`${ROOT}${file}`, 'utf8'))).toEqual([]);
    });
  }

  it('flags every rule', () => {
    const found = lint('fixture.css', BAD_FIXTURE);
    for (const id of RULE_IDS) expect(found.some(line => line.split(' ')[1] === id), id).toBe(true);
    expect(found.filter(line => line.split(' ')[1] === 'R1').length).toBeGreaterThanOrEqual(3);
  });

  it('flags a broken tokens file and a missing import', () => {
    const tokens = lint('tokens.css', ':root { --ease-out: ease; --dur-fade: 500ms; }');
    expect(tokens.some(line => line.includes(' R9 '))).toBe(true);
    expect(tokens.some(line => line.includes(' R4 '))).toBe(true);
    expect(lint('styles.css', 'body { margin: 0; }').some(line => line.includes(' R10 '))).toBe(true);
    expect(lint('other.css', "@import './tokens.css';").some(line => line.includes(' R10 '))).toBe(true);
  });

  it('accepts the negative fixture', () => {
    expect(lint('fixture.css', GOOD_FIXTURE)).toEqual([]);
  });

  it('rejects unbalanced braces', () => {
    expect(() => tokenize('.a { color: red;')).toThrow();
    expect(() => tokenize('.a { color: red; } }')).toThrow();
  });
});
