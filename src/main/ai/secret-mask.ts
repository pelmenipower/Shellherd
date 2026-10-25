import type { Vault, VaultNode } from '../../shared/vault/types';

/** Vault values and earlier finds shorter than this are not searched for: they would hit ordinary words and numbers. */
export const MIN_LITERAL_LENGTH = 6;
/** Longest value read after a secret name or inside quotes. */
const MAX_VALUE = 4096;
/** Earlier finds searched in every later text of a conversation; the newest win, so a flood of finds cannot stall main. */
const MAX_KNOWN = 1000;

interface Span { start: number; end: number }

export interface MaskResult {
  text: string;
  /** Placeholder numbers that occur in this text. */
  numbers: Set<number>;
}

// Linear patterns only: a boundary lookbehind or a literal prefix, then one bounded character class (no nesting, no ReDoS).
const TOKEN_RULES: readonly RegExp[] = [
  /(?<![A-Za-z0-9])(?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}(?![A-Za-z0-9])/g, // AWS access key id
  /(?<![A-Za-z0-9_])gh[pousr]_[A-Za-z0-9]{36,255}/g, // GitHub tokens
  /(?<![A-Za-z0-9_])github_pat_[A-Za-z0-9_]{22,255}/g, // GitHub fine-grained tokens
  /(?<![A-Za-z0-9-])xox[abposr]-[A-Za-z0-9-]{10,250}/g, // Slack tokens
  /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{20,250}/g, // OpenAI and Anthropic (sk-proj-…, sk-ant-…)
  /(?<![A-Za-z0-9_-])AIza[A-Za-z0-9_-]{35}/g, // Google API key
  /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,4096}\.eyJ[A-Za-z0-9_-]{8,8192}\.[A-Za-z0-9_-]{0,4096}/g, // JWT
  /(?<![A-Za-z0-9+/])LS0tLS1CRUdJTi[A-Za-z0-9+/]{16,65536}={0,2}/g, // base64 of "-----BEGIN …" (Kubernetes tls.key)
  /(?<=hooks\.slack\.com\/services\/)[A-Za-z0-9/]{20,120}/g, // Slack webhook path
  /(?<=[?&]sig=)[A-Za-z0-9%+/=]{16,256}/g, // Azure SAS signature
  /(?<=\b[Bb]earer[ \t]{1,8})[A-Za-z0-9._~+/=-]{16,4096}/g, // Bearer token
  /(?<=\b[Aa]uthorization[ \t]{0,8}[:=][ \t]{0,8}[Bb]asic[ \t]{1,8})[A-Za-z0-9+/=]{8,4096}/g, // Basic auth
];
/** The name must end with one of these: DB_PASSWORD, apiKey, client_secret match; max_tokens, secretName do not. */
const SECRET_NAME = /(?:pass|passwd|password|passphrase|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|account[_-]?key|subscription[_-]?key|credentials?|auth|dockerconfigjson|dockercfg)$/i;
/** `name=`, `name:`, `"name": `, `name =>`; the lookbehind starts a name only once per run of name characters. */
const ASSIGN = /(?<![A-Za-z0-9_.-])([A-Za-z_][A-Za-z0-9_.-]{0,63})["']?[ \t]{0,8}(?:=>?|:)[ \t]{0,8}/g;
/** `--password value`, `--token=value`, `-Password value`. */
const FLAG = /(?<![A-Za-z0-9_-])--?([A-Za-z][A-Za-z0-9_-]{0,63})(?:=|[ \t]{1,8})/g;
/** Values that are no secret: flags, references, masks and placeholders. */
const SKIP_VALUE = /^(?:true|false|null|none|yes|no|[|>][+-]?|\*+|•+|x{3,}|\[SECRET_\d{1,6}\]|<[^<>]{0,64}>|\$\{?[A-Za-z_][A-Za-z0-9_]{0,63}\}?|%[A-Za-z_][A-Za-z0-9_]{0,63}%|\{\{[^{}]{0,64}\}\})$/i;
const BARE_END = /[\s"'`;&]/;
const PLACEHOLDER = /^\[SECRET_\d{1,6}\]$/;
const PLACEHOLDER_PARTS = /(\[SECRET_\d{1,6}\])/;
const SCHEME = /(?<![A-Za-z0-9+.-])[A-Za-z][A-Za-z0-9+.-]{1,30}:\/\//g;
const AUTHORITY_END = /[\s/?#"'<>]/;
const PEM_EDGE = /-----(BEGIN|END) [A-Z0-9 ]{0,40}PRIVATE KEY(?: BLOCK)?-----/g;
const BASE64_LINE = /^[A-Za-z0-9+/=]{16,}$/;
const SECRET_KIND = /\bkind:[ \t]*Secret\b/;
const DATA_KEY = /^(?:data|stringData):$/;

/** Value right after a separator: quoted up to the closing quote (or the line end), bare up to whitespace, quote, ; or &. */
function valueSpan(text: string, at: number): Span | null {
  const quote = text[at];
  // `<your password>`: a hint for the reader, no secret; the look-ahead is bounded, so this stays linear.
  if (quote === '<' && /^<[^<>\r\n]{0,64}>/.test(text.slice(at, at + 66))) return null;
  let start = at;
  let end = at;
  if (quote === '"' || quote === "'") {
    start = end = at + 1;
    while (end < text.length && end - start < MAX_VALUE && text[end] !== quote && text[end] !== '\n' && text[end] !== '\r') end += text[end] === '\\' && quote === '"' ? 2 : 1;
    end = Math.min(end, text.length);
  } else {
    while (end < text.length && end - start < MAX_VALUE && !BARE_END.test(text[end])) end += 1;
  }
  const value = text.slice(start, end);
  return value && !SKIP_VALUE.test(value) ? { start, end } : null;
}

/** Values of secret-sounding names; a found value is skipped as a whole so long runs stay linear. */
function pairSpans(text: string): Span[] {
  const spans: Span[] = [];
  for (const rule of [ASSIGN, FLAG]) {
    rule.lastIndex = 0;
    for (let match = rule.exec(text); match; match = rule.exec(text)) {
      if (!SECRET_NAME.test(match[1])) continue;
      const at = rule.lastIndex;
      // `--password --next`: the next flag is no value.
      if (rule === FLAG && text[at] === '-') continue;
      const span = valueSpan(text, at);
      if (span) { spans.push(span); rule.lastIndex = Math.max(rule.lastIndex, span.end); }
    }
  }
  return spans;
}

/** scheme://user:password@host → the password; parsed by hand, the authority is at most 1024 characters. */
function urlSpans(text: string): Span[] {
  const spans: Span[] = [];
  SCHEME.lastIndex = 0;
  for (let match = SCHEME.exec(text); match; match = SCHEME.exec(text)) {
    const start = SCHEME.lastIndex;
    let end = start;
    while (end < text.length && end - start < 1024 && !AUTHORITY_END.test(text[end])) end += 1;
    const authority = text.slice(start, end);
    const at = authority.lastIndexOf('@');
    const colon = authority.indexOf(':');
    if (at > 0 && colon >= 0 && colon < at - 1) spans.push({ start: start + colon + 1, end: start + at });
    SCHEME.lastIndex = Math.max(SCHEME.lastIndex, end);
  }
  return spans;
}

/** The span without surrounding whitespace, or null if nothing is left. */
function trimmed(text: string, start: number, end: number): Span | null {
  while (start < end && /\s/.test(text[start])) start += 1;
  while (end > start && /\s/.test(text[end - 1])) end -= 1;
  return start < end ? { start, end } : null;
}

/**
 * Bodies of private key blocks. A block without END (cut off) runs to the end of the text; an END without
 * BEGIN (the start scrolled away) takes the base64 lines right above it.
 */
function pemSpans(text: string): Span[] {
  const spans: Span[] = [];
  let open = -1;
  PEM_EDGE.lastIndex = 0;
  for (let match = PEM_EDGE.exec(text); match; match = PEM_EDGE.exec(text)) {
    if (match[1] === 'BEGIN') { if (open < 0) open = PEM_EDGE.lastIndex; continue; }
    let start = open;
    if (start < 0) {
      start = match.index;
      for (;;) {
        const lineEnd = start - 1;
        if (lineEnd < 0) break;
        const lineStart = text.lastIndexOf('\n', lineEnd - 1) + 1;
        if (!BASE64_LINE.test(text.slice(lineStart, lineEnd).trim())) break;
        start = lineStart;
      }
    }
    const span = trimmed(text, start, match.index);
    if (span) spans.push(span);
    open = -1;
  }
  if (open >= 0) { const span = trimmed(text, open, text.length); if (span) spans.push(span); }
  return spans;
}

/** `kubectl get secret -o yaml`: every value under data:/stringData: when the text names kind: Secret. */
function secretDataSpans(text: string): Span[] {
  if (!SECRET_KIND.test(text)) return [];
  const spans: Span[] = [];
  let block = -1;
  let position = 0;
  for (const line of text.split('\n')) {
    const content = line.trimEnd();
    const body = content.trimStart();
    const indent = content.length - body.length;
    if (block >= 0 && body && indent <= block) block = -1;
    if (block < 0) { if (DATA_KEY.test(body)) block = indent; }
    else {
      const colon = body.indexOf(': ');
      // `key: value` → the value; a line inside a `|` block (neither `key: ` nor `key:`) → the whole line.
      const from = colon > 0 ? indent + colon + 2 : body.endsWith(':') ? -1 : indent;
      const span = from >= 0 ? trimmed(text, position + from, position + content.length) : null;
      if (span && !SKIP_VALUE.test(text.slice(span.start, span.end))) spans.push(span);
    }
    position += line.length + 1;
  }
  return spans;
}

/** All rule hits, sorted and merged where they overlap. */
function findSpans(text: string): Span[] {
  const spans = [...pairSpans(text), ...urlSpans(text), ...pemSpans(text), ...secretDataSpans(text)];
  for (const rule of TOKEN_RULES) for (const match of text.matchAll(rule)) spans.push({ start: match.index!, end: match.index! + match[0].length });
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: Span[] = [];
  for (const span of spans) {
    const last = merged.at(-1);
    if (last && span.start < last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  return merged;
}

/** Every occurrence of `value` outside the placeholders already in `text`, so a found value never breaks a placeholder. */
function replaceOutside(text: string, value: string, placeholder: string): string {
  return text.split(PLACEHOLDER_PARTS).map((part, index) => (index % 2 === 1 ? part : part.split(value).join(placeholder))).join('');
}

/** Stable placeholders for one conversation: the same value always gets the same [SECRET_n]. */
export class SecretMasker {
  private readonly numbers = new Map<string, number>();

  private placeholder(value: string, used: Set<number>): string {
    let number = this.numbers.get(value);
    if (number === undefined) { number = this.numbers.size + 1; this.numbers.set(value, number); }
    used.add(number);
    return `[SECRET_${number}]`;
  }

  /**
   * Vault values first (callers pass them longest first), then the rules, then every value this
   * conversation has masked before, so a password found once stays hidden where no rule sees it.
   */
  mask(text: string, literals: readonly string[]): MaskResult {
    const used = new Set<number>();
    let current = text;
    for (const literal of literals) if (current.includes(literal)) current = replaceOutside(current, literal, this.placeholder(literal, used));
    let out = '';
    let from = 0;
    for (const span of findSpans(current)) {
      const value = current.slice(span.start, span.end);
      if (PLACEHOLDER.test(value)) continue;
      out += current.slice(from, span.start) + this.placeholder(value, used);
      from = span.end;
    }
    let result = out + current.slice(from);
    const known = [...this.numbers.keys()].filter(value => value.length >= MIN_LITERAL_LENGTH).slice(-MAX_KNOWN).sort((a, b) => b.length - a.length);
    for (const value of known) if (result.includes(value)) result = replaceOutside(result, value, this.placeholder(value, used));
    return { text: result, numbers: used };
  }
}

/** Passwords, passphrases and API keys stored in the vault (plus their URL-encoded form), longest first. */
export function vaultLiterals(vault: Vault): string[] {
  const found = new Set<string>();
  const add = (value: string | undefined): void => {
    if (!value || value.trim().length < MIN_LITERAL_LENGTH) return;
    found.add(value);
    const encoded = encodeURIComponent(value);
    if (encoded !== value) found.add(encoded);
  };
  const walk = (nodes: VaultNode[]): void => {
    for (const node of nodes) {
      if (node.type === 'folder') { walk(node.children); continue; }
      if (node.protocol === 'ssh' || node.protocol === 'sftp') {
        if (node.authentication.method === 'password') add(node.authentication.password);
        if (node.authentication.method === 'privateKey') add(node.authentication.passphrase);
      }
      if (node.protocol === 'rdp') add(node.password);
    }
  };
  walk(vault.nodes);
  for (const provider of vault.ai?.providers ?? []) add(provider.apiKey);
  return [...found].sort((a, b) => b.length - a.length);
}
