import type { ImportCandidate, ImportNoteCode, ImportPreview, ImportSkipCode } from './import';
import { MAX_IMPORT_CANDIDATES, validImportHost } from './import';

const SKIP_ORDER: ImportSkipCode[] = ['unsupported', 'invalid', 'tooMany'];
/** Only these values are read; passwords are never stored. */
const WANTED = new Set(['FSProtocol', 'HostName', 'PortNumber', 'UserName', 'PublicKeyFile', 'Tunnel']);

const SESSION_HEADER = /^\[(?:HKEY_CURRENT_USER\\Software\\Martin Prikryl\\WinSCP 2\\Sessions|Sessions)\\([^\\\]]+)\]$/i;
const REG_TEXT = /^"((?:[^"\\]|\\.)*)"="((?:[^"\\]|\\.)*)"$/;
const REG_DWORD = /^"((?:[^"\\]|\\.)*)"=dword:([0-9a-f]{1,8})$/i;

const utf8 = new TextDecoder();


/** Runs of %XX are UTF-8 bytes; invalid bytes become U+FFFD. */
function decodePercent(raw: string): string {
  return raw.replace(/(?:%[0-9a-f]{2})+/gi, run =>
    utf8.decode(Uint8Array.from(run.split('%').slice(1), hex => parseInt(hex, 16))));
}

/** Reg escapes: \\ and \" (and any other \x) lose the backslash. */
const unescapeReg = (raw: string) => raw.replace(/\\(.)/g, '$1');

/** Digits only (reg dwords are stored as decimal strings); NaN otherwise. */
const numberOf = (raw: string | undefined, fallback: number): number =>
  raw === undefined ? fallback : /^\d+$/.test(raw) ? Number(raw) : NaN;

interface RawSession { name: string; values: Map<string, string> }

function toCandidate(key: string, v: Map<string, string>): ImportCandidate | ImportSkipCode {
  const parts = key.split('/');
  const name = parts.pop() ?? '';
  if (!name || parts.some(part => !part)) return 'invalid';

  const notes: ImportNoteCode[] = [];
  const note = (code: ImportNoteCode) => { if (!notes.includes(code)) notes.push(code); };

  const protocol = numberOf(v.get('FSProtocol'), 2);
  if (protocol === 0) note('scpAsSftp');
  else if (protocol !== 1 && protocol !== 2) return 'unsupported';

  const host = v.get('HostName') ?? '';
  if (!validImportHost(host)) return 'invalid';
  const port = numberOf(v.get('PortNumber'), 22);
  if (!(port >= 1 && port <= 65535)) return 'invalid';

  const username = v.get('UserName');
  const keyPath = v.get('PublicKeyFile');
  if (keyPath?.toLowerCase().endsWith('.ppk')) note('ppkKey');
  if (v.get('Tunnel') === '1') note('jumpUnsupported');

  return {
    key, name, protocol: 'sftp', folder: parts, host, port,
    ...(username ? { username } : {}),
    ...(keyPath ? { keyPath } : {}),
    forwards: [], notes,
  };
}

/** Pure; text of a `reg export` of HKCU\Software\Martin Prikryl\WinSCP 2\Sessions, or a WinSCP.ini (already decoded). */
export function parseWinScp(text: string): Omit<ImportPreview, 'source' | 'file'> {
  const sessions: RawSession[] = [];
  let current: RawSession | null = null;

  for (const line of text.split(/\r?\n/).map(l => l.trim())) {
    if (line.startsWith('[')) {
      const header = SESSION_HEADER.exec(line);
      current = header ? { name: decodePercent(header[1]), values: new Map() } : null;
      if (current) sessions.push(current);
      continue;
    }
    if (!current) continue;

    let name: string | undefined;
    let value: string | undefined;
    const regText = REG_TEXT.exec(line);
    const regDword = REG_DWORD.exec(line);
    if (regText) {
      name = unescapeReg(regText[1]);
      value = unescapeReg(regText[2]);
    } else if (regDword) {
      name = unescapeReg(regDword[1]);
      value = String(parseInt(regDword[2], 16));
    } else if (!line.startsWith('"') && !line.startsWith(';') && line.indexOf('=') > 0) {
      const eq = line.indexOf('=');
      name = line.slice(0, eq);
      value = decodePercent(line.slice(eq + 1));
    }
    if (name !== undefined && value !== undefined && WANTED.has(name) && !current.values.has(name)) {
      current.values.set(name, value);
    }
  }

  const candidates: ImportCandidate[] = [];
  const seen = new Set<string>();
  const skipped = new Map<ImportSkipCode, number>();
  const count = (code: ImportSkipCode) => skipped.set(code, (skipped.get(code) ?? 0) + 1);

  for (const session of sessions) {
    if (session.name === 'Default Settings' || seen.has(session.name)) continue;
    seen.add(session.name);
    const candidate = toCandidate(session.name, session.values);
    if (typeof candidate === 'string') count(candidate);
    else if (candidates.length >= MAX_IMPORT_CANDIDATES) count('tooMany');
    else candidates.push(candidate);
  }

  return {
    candidates,
    skipped: SKIP_ORDER.filter(code => skipped.has(code)).map(code => ({ code, count: skipped.get(code) ?? 0 })),
  };
}
