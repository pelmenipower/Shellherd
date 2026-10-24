import type { ImportCandidate, ImportForward, ImportNoteCode, ImportPreview, ImportSkipCode } from './import';
import { AppError } from './errors';
import { MAX_IMPORT_CANDIDATES, validImportHost } from './import';
import { MAX_FORWARDS } from './vault/schema';

// Same limits as MAX_IMPORT_CANDIDATES and validImportHost in ./import; only types come from there.
const FORWARD_KEYS = new Set(['localforward', 'remoteforward', 'dynamicforward']);

interface Option { key: string; args: string[] }
// chars: lowercase code points of the glob without `!`, prepared once per pattern.
interface Pattern { raw: string; negated: boolean; chars: string[] }
interface Block { patterns: Pattern[]; options: Option[] }
interface StepBudget { left: number }

// Host blocks collected at most; further Host lines are ignored and each counts as tooMany.
const MAX_HOST_BLOCKS = 5_000;
// Patterns over all blocks; a Host line that runs out counts one tooMany, the rest of its patterns are ignored.
const MAX_PATTERNS = 5_000;
// Code points; longer patterns are ignored silently, longer aliases count as invalid.
const MAX_NAME_LENGTH = 255;
// Character comparisons of all glob matches in one parse run together; beyond that the import is too large.
const GLOB_STEP_BUDGET = 20_000_000;

/** Splits at whitespace; a "quoted part" stays inside one argument without its quotes. */
function tokenize(text: string): string[] {
  return (text.match(/(?:[^\s"]+|"[^"]*")+/g) ?? []).map(token => token.replace(/"/g, ''));
}

const codePoints = (text: string): string[] => [...text.toLowerCase()];

/** Matches prepared code points; each comparison and each call costs one budget step. */
function matchChars(p: string[], t: string[], budget: StepBudget): boolean {
  if (--budget.left < 0) throw new AppError('core.importTooLarge');
  let pi = 0;
  let ti = 0;
  let star = -1; // index of the last * in the pattern
  let mark = 0; // text index up to which the last * has absorbed characters
  while (ti < t.length) {
    if (--budget.left < 0) throw new AppError('core.importTooLarge');
    if (pi < p.length && p[pi] === '*') { star = pi++; mark = ti; }
    else if (pi < p.length && (p[pi] === '?' || p[pi] === t[ti])) { pi++; ti++; }
    else if (star >= 0) { pi = star + 1; ti = ++mark; }
    else return false;
  }
  while (pi < p.length && p[pi] === '*') pi++;
  return pi === p.length;
}

/** OpenSSH glob: * any run, ? one character, whole string, case-insensitive. No regex, so no backtracking blowup. */
export function globMatch(pattern: string, text: string): boolean {
  return matchChars(codePoints(pattern), codePoints(text), { left: Infinity });
}

/** undefined for a glob over MAX_NAME_LENGTH characters, which is ignored. A long plain name stays: it is an alias and counts as invalid. */
function toPattern(raw: string): Pattern | undefined {
  const negated = raw.startsWith('!');
  const chars = codePoints(negated ? raw.slice(1) : raw);
  return chars.length > MAX_NAME_LENGTH && /[*?]/.test(raw) ? undefined : { raw, negated, chars };
}

// eslint-disable-next-line no-control-regex

/** `none` or no value: no ProxyJump and no ProxyCommand. */
const isNone = (args: string[]): boolean => args.length === 0 || (args.length === 1 && args[0].toLowerCase() === 'none');

const first = (opts: Option[], key: string): string[] | undefined => opts.find(o => o.key === key)?.args;

const hasJump = (opts: Option[]): boolean => {
  const jump = first(opts, 'proxyjump');
  return jump !== undefined && !isNone(jump);
};

function addNote(candidate: ImportCandidate, code: ImportNoteCode): void {
  if (!candidate.notes.includes(code)) candidate.notes.push(code);
}

/** Port after the last colon of `[bind:]port`, 1–65535. */
function listenPort(text: string): number | undefined {
  const part = text.slice(text.lastIndexOf(':') + 1);
  const port = Number(part);
  return /^\d+$/.test(part) && port >= 1 && port <= 65_535 ? port : undefined;
}

/** `host:port` or `[v6]:port` with a valid host and port. */
function forwardTarget(text: string): { host: string; port: number } | undefined {
  const m = /^\[([^\]]+)\]:(\d+)$/.exec(text) ?? /^([^:[\]]+):(\d+)$/.exec(text);
  if (!m) return undefined;
  const port = Number(m[2]);
  return validImportHost(m[1]) && port >= 1 && port <= 65_535 ? { host: m[1], port } : undefined;
}

function parseForward(key: string, args: string[]): ImportForward | undefined {
  if (args.some(arg => arg.includes('/'))) return undefined; // Unix socket paths are not imported
  if (key === 'dynamicforward') {
    const port = args.length === 1 ? listenPort(args[0]) : undefined;
    return port === undefined ? undefined : { kind: 'dynamic', localPort: port };
  }
  const listen = args.length === 2 ? listenPort(args[0]) : undefined;
  const target = args.length === 2 ? forwardTarget(args[1]) : undefined;
  if (listen === undefined || !target) return undefined;
  return key === 'localforward'
    ? { kind: 'local', localPort: listen, targetHost: target.host, targetPort: target.port }
    : { kind: 'remote', remotePort: listen, targetHost: target.host, targetPort: target.port };
}

/** IdentityFile as an absolute path; null when a token other than %d or %% stays. Never reads the file. */
function keyPathOf(value: string, home: string): string | null {
  let unresolved = false;
  let path = value.replace(/%(.)?/g, (_, c: string | undefined) => {
    if (c === '%') return '%';
    if (c === 'd') return home;
    unresolved = true;
    return '';
  });
  if (unresolved) return null;
  if (path.startsWith('~')) path = home + path.slice(1);
  path = path.replace(/\//g, '\\');
  return /^[A-Za-z]:/.test(path) || path.startsWith('\\\\') ? path : `${home}\\.ssh\\${path}`;
}

/** Candidate without its jump; undefined when host or port is invalid. */
function candidateFor(alias: string, opts: Option[], home: string): ImportCandidate | undefined {
  // Joined, not cut: a second word makes the host or port invalid instead of guessing.
  const hostText = (first(opts, 'hostname') ?? [alias]).join(' ');
  const host = hostText.replace(/%%|%h/g, token => (token === '%h' ? alias : '%'));
  const portText = (first(opts, 'port') ?? ['22']).join(' ');
  const port = Number(portText);
  if (!validImportHost(host) || !/^\d+$/.test(portText) || port < 1 || port > 65_535) return undefined;

  const user = first(opts, 'user')?.[0];
  const candidate: ImportCandidate = {
    key: alias, name: alias, protocol: 'ssh', folder: [], host, port, forwards: [], notes: [],
    ...(user && !user.includes('%') ? { username: user } : {}),
  };

  const identity = first(opts, 'identityfile')?.[0];
  if (identity) {
    const keyPath = keyPathOf(identity, home);
    if (keyPath === null) addNote(candidate, 'keyUnresolved');
    else candidate.keyPath = keyPath;
  }

  const proxyCommand = first(opts, 'proxycommand');
  if (proxyCommand && !isNone(proxyCommand)) addNote(candidate, 'proxyDropped');

  for (const { key, args } of opts) {
    if (!FORWARD_KEYS.has(key)) continue;
    const forward = parseForward(key, args);
    if (forward && candidate.forwards.length < MAX_FORWARDS) candidate.forwards.push(forward);
    else addNote(candidate, 'forwardsDropped');
  }
  return candidate;
}

/** Pure; `home` is the user profile without trailing separator, e.g. C:\Users\demo. */
export function parseOpenSshConfig(text: string, home: string): Omit<ImportPreview, 'source' | 'file'> {
  const skips = new Map<ImportSkipCode, number>();
  const count = (code: ImportSkipCode) => skips.set(code, (skips.get(code) ?? 0) + 1);

  // Blocks in file order; lines before the first Host form the * block.
  // `current` is undefined inside an ignored Host block, so its options are dropped, not attached to the previous one.
  const blocks: Block[] = [{ patterns: [{ raw: '*', negated: false, chars: ['*'] }], options: [] }];
  let current: Block | undefined = blocks[0];
  let hostBlocks = 0;
  let patternCount = 1; // the implicit * block
  let skipping = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^([^\s=]+)\s*=?\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const args = tokenize(m[2]);
    if (key === 'host') {
      skipping = false;
      if (hostBlocks < MAX_HOST_BLOCKS) {
        hostBlocks++;
        const patterns: Pattern[] = [];
        for (const arg of args) {
          const pattern = toPattern(arg);
          if (!pattern) continue; // over 255 characters: ignored silently
          if (patternCount === MAX_PATTERNS) { count('tooMany'); break; } // one count per Host line
          patternCount++;
          patterns.push(pattern);
        }
        current = { patterns, options: [] };
        blocks.push(current);
      } else {
        count('tooMany'); // one count per ignored block, keeps the scan linear
        current = undefined;
      }
    } else if (key === 'match') {
      skipping = true;
      count('match');
    } else if (skipping) {
      continue;
    } else if (key === 'include') {
      count('include');
    } else {
      current?.options.push({ key, args });
    }
  }

  // Concrete aliases in order of first appearance; the rest beyond 500 is tooMany.
  const seen = new Set<string>();
  const aliases: string[] = [];
  for (const block of blocks) {
    for (const p of block.patterns) {
      if (p.raw && !/[*?!]/.test(p.raw) && !seen.has(p.raw)) {
        seen.add(p.raw);
        aliases.push(p.raw);
      }
    }
  }
  if (aliases.length > MAX_IMPORT_CANDIDATES) {
    skips.set('tooMany', (skips.get('tooMany') ?? 0) + aliases.length - MAX_IMPORT_CANDIDATES);
  }

  // Options of every block that applies to the alias: a positive pattern matches and no negated one.
  const budget: StepBudget = { left: GLOB_STEP_BUDGET };
  const optionsOf = (alias: string[]): Option[] => blocks
    .filter(block => block.patterns.some(p => !p.negated && matchChars(p.chars, alias, budget))
      && !block.patterns.some(p => p.negated && matchChars(p.chars, alias, budget)))
    .flatMap(block => block.options);
  const optsByAlias = new Map<string, Option[]>();
  for (const alias of aliases.slice(0, MAX_IMPORT_CANDIDATES)) {
    const chars = codePoints(alias);
    if (chars.length > MAX_NAME_LENGTH) { count('invalid'); continue; } // before any option lookup
    optsByAlias.set(alias, optionsOf(chars));
  }

  const valid = new Map<string, ImportCandidate>();
  for (const [alias, opts] of optsByAlias) {
    const candidate = candidateFor(alias, opts, home);
    if (candidate) valid.set(alias, candidate);
    else count('invalid');
  }

  // ProxyJump: exactly one hop to a valid same-file candidate that has no jump itself.
  for (const [alias, opts] of optsByAlias) {
    const candidate = valid.get(alias);
    if (!candidate || !hasJump(opts)) continue;
    const jump = first(opts, 'proxyjump') ?? [];
    const target = jump.length === 1 && /^[^,@:]+$/.test(jump[0]) ? jump[0] : undefined;
    if (target !== undefined && valid.has(target) && !hasJump(optsByAlias.get(target) ?? [])) candidate.jumpKey = target;
    else addNote(candidate, 'jumpUnsupported');
  }

  const order: ImportSkipCode[] = ['match', 'include', 'invalid', 'tooMany'];
  return {
    candidates: [...valid.values()],
    skipped: order.filter(code => skips.has(code)).map(code => ({ code, count: skips.get(code) ?? 0 })),
  };
}
