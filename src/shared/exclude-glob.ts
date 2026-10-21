export type ExcludeMatcher = (relativePosixPath: string, isDirectory: boolean) => boolean;

export const DEFAULT_EXCLUDES: readonly string[] = ['.git', 'node_modules/', '~$*', '*.swp', '*.tmp', '.DS_Store'];

// Control characters never belong in a file pattern; checked per line.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\x00-\x1f\x7f]/;

/** For the dialog; `pattern` is one line. */
export function excludePatternError(pattern: string): 'negation' | 'control' | null {
  const line = pattern.trim();
  if (line.startsWith('!')) return 'negation';
  return CONTROL.test(line) ? 'control' : null;
}

function translate(glob: string): string {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const rest = glob.slice(i);
    const c = glob[i];
    if (rest.startsWith('**/')) { out += '(?:.*/)?'; i += 2; }
    else if (rest === '/**') { out += '(?:/.*)?'; break; }
    else if (rest.startsWith('**')) { out += '.*'; i += 1; }
    else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else if (c === '[' && glob.indexOf(']', i + 2) > 0) {
      const end = glob.indexOf(']', i + 2);
      const body = glob.slice(i + 1, end);
      out += `[${body.startsWith('!') ? `^${body.slice(1)}` : body}]`;
      i = end;
    } else out += c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  }
  return out;
}

/** gitignore rules: no slash → any level; leading or inner slash → from the binding root; trailing slash → folders only. Case-insensitive; `\` counts as `/`. Invalid lines are ignored. */
export function compileExcludes(patterns: readonly string[]): ExcludeMatcher {
  const rules: { re: RegExp; dirOnly: boolean }[] = [];
  for (const raw of patterns) {
    let line = raw.trim();
    if (!line || line.startsWith('#') || excludePatternError(line)) continue;
    line = line.replace(/\\/g, '/');
    const dirOnly = line.endsWith('/');
    if (dirOnly) line = line.slice(0, -1);
    const anchored = line.includes('/');
    if (line.startsWith('/')) line = line.slice(1);
    if (!line) continue;
    try {
      rules.push({ re: new RegExp(`${anchored ? '^' : '(?:^|/)'}${translate(line)}$`, 'i'), dirOnly });
    } catch { /* invalid character class: ignore the line */ }
  }
  return (path, isDirectory) => {
    const segs = path.split('/');
    // A hit on any ancestor folder excludes everything below it.
    for (let i = 1; i <= segs.length; i += 1) {
      const prefix = segs.slice(0, i).join('/');
      const isDir = i < segs.length || isDirectory;
      if (rules.some((r) => (isDir || !r.dirOnly) && r.re.test(prefix))) return true;
    }
    return false;
  };
}
