export type RemotePathAction = 'list' | 'complete' | 'validate';
export interface RemotePathEntry { name: string; path: string; directory: boolean; executable: boolean | null }
export interface RemotePathReply {
  path: string;
  entries?: RemotePathEntry[];
  directory?: boolean;
  executable?: boolean | null;
  truncated?: boolean;
  error?: 'not-found' | 'denied' | 'unavailable' | 'timeout' | 'failed' | 'busy';
}
export interface RemotePathRequest { sessionId: string; action: RemotePathAction; path: string }

/** Shell quoting is only for inserting the chosen path, never for querying the server. */
export const quoteRemotePath = (path: string): string => `'${path.replace(/'/g, `'\\''`)}'`;
interface Token { value: string; start: number; end: number; quote?: string; closed: boolean; raw: string }
export interface RemoteScriptToken { path: string; start: number; end: number; closed: boolean }

/** Deliberately limited: a direct script path, optionally after bash/sh, with ordinary arguments. */
export function remoteScriptToken(command: string): RemoteScriptToken | null {
  const tokens: Token[] = [];
  let i = 0;
  while (i < command.length) {
    if (/\s/.test(command[i])) { i++; continue; }
    const start = i;
    let value = '', quote = '', firstQuote: string | undefined;
    while (i < command.length) {
      const char = command[i];
      if (!quote && /\s/.test(char)) break;
      if (!quote && /[;&|<>`()\x00-\x1f\x7f]/.test(char)) return null;
      if (char === "'" || char === '"') {
        if (!quote) { quote = char; if (i === start) firstQuote = char; i++; continue; }
        if (quote === char) { quote = ''; i++; continue; }
      }
      if (char === '\\' && quote !== "'" && i + 1 < command.length) {
        if (!quote || /["\\$`]/.test(command[i + 1])) { value += command[i + 1]; i += 2; continue; }
      }
      value += char; i++;
    }
    tokens.push({ value, start, end: i, quote: firstQuote, closed: !quote, raw: command.slice(start, i) });
  }
  const token = tokens[tokens[0]?.value === 'bash' || tokens[0]?.value === 'sh' ? 1 : 0];
  if (!token) return null;
  const home = /^(?:\$HOME|\$\{HOME\})(?:\/|$)/;
  if (token.value.startsWith('~') && token.quote || home.test(token.value) && (token.quote === "'" || token.raw.startsWith('\\'))) return null;
  if (token.quote !== "'" && (token.value.replace(home, '').includes('$') || token.value.includes('`'))) return null;
  if (!(token.value.startsWith('/') || token.value.startsWith('~/') || home.test(token.value) || token.value.startsWith('./') || token.value.startsWith('../'))) return null;
  return { path: token.value, start: token.start, end: token.end, closed: token.closed };
}
export function replaceRemoteScript(command: string, path: string): string {
  const token = remoteScriptToken(command);
  return token ? command.slice(0, token.start) + quoteRemotePath(path) + command.slice(token.end) : quoteRemotePath(path);
}
export function commonRemotePrefix(paths: string[]): string {
  if (!paths.length) return '';
  let prefix = Array.from(paths[0]);
  for (const path of paths.slice(1)) { const chars = Array.from(path); let i = 0; while (i < prefix.length && chars[i] === prefix[i]) i++; prefix = prefix.slice(0, i); }
  return prefix.join('');
}
