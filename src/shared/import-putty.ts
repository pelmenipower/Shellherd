import type { ImportCandidate, ImportForward, ImportNoteCode, ImportPreview, ImportSkipCode } from './import';
import { MAX_IMPORT_CANDIDATES, validImportHost } from './import';

/** Same limit as MAX_FORWARDS in vault/schema.ts. */
const MAX_FORWARDS = 16;
const SESSIONS = 'HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions';

type RegValues = Map<string, string | number>;

/** Value names the parser reads; `ProxyPassword` and friends are never stored. */
const PUTTY_VALUES: ReadonlySet<string> = new Set(['HostName', 'PortNumber', 'UserName', 'Protocol', 'PublicKeyFile', 'ProxyMethod', 'PortForwardings']);

/**
 * Sections directly below `prefix` (without trailing separator) in a decoded `.reg` text.
 * `raw` is the last key segment, still encoded; prefix match is case-insensitive.
 * Only values named in `wanted` are stored (name match is case-insensitive), so secrets never enter the map.
 */
export function parseRegSections(text: string, prefix: string, wanted: ReadonlySet<string>): { raw: string; values: RegValues }[] {
  const sections: { raw: string; values: RegValues }[] = [];
  const head = `${prefix}\\`.toLowerCase();
  const keep = new Set([...wanted].map(w => w.toLowerCase()));
  let current: RegValues | null = null;
  let continued = false;
  for (const physical of text.split(/\r?\n/)) {
    const line = physical.trim();
    // A line ending in `\` continues on the next line; that continuation is never a value we read.
    const isContinuation = continued;
    continued = line.endsWith('\\');
    if (isContinuation) continue;
    if (line.startsWith('[') && line.endsWith(']')) {
      const path = line.slice(1, -1);
      const raw = path.slice(head.length);
      current = path.slice(0, head.length).toLowerCase() === head && raw !== '' && !raw.includes('\\') ? new Map() : null;
      if (current) sections.push({ raw, values: current });
      continue;
    }
    if (!current) continue;
    const m = /^"((?:[^"\\]|\\.)*)"=(?:"((?:[^"\\]|\\.)*)"|dword:([0-9a-fA-F]{1,8}))$/.exec(line);
    if (!m) continue;
    const name = unescapeReg(m[1]);
    if (!keep.has(name.toLowerCase()) || current.has(name)) continue;
    current.set(name, m[2] !== undefined ? unescapeReg(m[2]) : parseInt(m[3], 16));
  }
  return sections;
}

const unescapeReg = (s: string) => s.replace(/\\([\\"])/g, '$1');

/** Session name: `%XX` decoded as PuTTY stores it. */
const decodeName = (raw: string) => raw.replace(/%([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));

/** Shared host check of both parsers (same rule as validImportHost in import.ts). */
const validPort = (port: number) => Number.isInteger(port) && port >= 1 && port <= 65535;

const text = (values: RegValues, name: string): string | undefined => {
  const v = values.get(name);
  return typeof v === 'string' ? v : undefined;
};

/** `[bind:]port` as a number, or null. */
function portOf(s: string): number | null {
  const digits = s.slice(s.lastIndexOf(':') + 1);
  const port = Number(digits);
  return /^\d{1,5}$/.test(digits) && validPort(port) ? port : null;
}

/** Splits `host:port` at the last colon; `[v6]` brackets are removed. */
function hostPortOf(s: string): { host: string; port: number } | null {
  const c = s.lastIndexOf(':');
  if (c < 0) return null;
  const host = s.slice(0, c).replace(/^\[(.*)\]$/, '$1');
  const port = portOf(s);
  return port !== null && validImportHost(host) ? { host, port } : null;
}

/** One PuTTY PortForwardings entry, or null when it is not usable. */
function parseForward(entry: string): ImportForward | null {
  if (!/^[LRD]/.test(entry)) return null;
  // Optional family digit after the letter; "L4000" may also be a plain port 4000, so try both readings.
  const rests = /^[LRD][46]/.test(entry) ? [entry.slice(2), entry.slice(1)] : [entry.slice(1)];
  for (const rest of rests) {
    const f = entry[0] === 'D' ? dynamicOf(rest) : forwardOf(entry[0], rest);
    if (f) return f;
  }
  return null;
}

function dynamicOf(rest: string): ImportForward | null {
  const localPort = portOf(rest);
  return localPort === null ? null : { kind: 'dynamic', localPort };
}

function forwardOf(kind: string, rest: string): ImportForward | null {
  const eq = rest.indexOf('=');
  if (eq < 0) return null;
  const listen = portOf(rest.slice(0, eq));
  const target = hostPortOf(rest.slice(eq + 1));
  if (listen === null || target === null) return null;
  return kind === 'L'
    ? { kind: 'local', localPort: listen, targetHost: target.host, targetPort: target.port }
    : { kind: 'remote', remotePort: listen, targetHost: target.host, targetPort: target.port };
}

/** Pure; text of a `reg export` of HKCU\Software\SimonTatham\PuTTY\Sessions (already decoded). */
export function parsePuttyReg(input: string): Omit<ImportPreview, 'source' | 'file'> {
  const candidates: ImportCandidate[] = [];
  const skipped = new Map<ImportSkipCode, number>();
  const skip = (code: ImportSkipCode) => skipped.set(code, (skipped.get(code) ?? 0) + 1);

  for (const { raw, values } of parseRegSections(input, SESSIONS, PUTTY_VALUES)) {
    const name = decodeName(raw);
    if (name === 'Default Settings') continue;
    const protocol = values.get('Protocol');
    if (protocol !== undefined && protocol !== 'ssh') {
      skip('notSsh');
      continue;
    }

    // "user@host" in HostName: user before the last @; UserName takes precedence.
    const hostName = text(values, 'HostName') ?? '';
    const at = hostName.lastIndexOf('@');
    const host = at < 0 ? hostName : hostName.slice(at + 1);
    const username = text(values, 'UserName') || (at < 0 ? '' : hostName.slice(0, at));
    const port = values.get('PortNumber') ?? 22;
    if (!validImportHost(host) || typeof port !== 'number' || !validPort(port)) {
      skip('invalid');
      continue;
    }
    if (candidates.length >= MAX_IMPORT_CANDIDATES) {
      skip('tooMany');
      continue;
    }

    const notes: ImportNoteCode[] = [];
    const keyPath = text(values, 'PublicKeyFile');
    if (keyPath && /\.ppk$/i.test(keyPath)) notes.push('ppkKey');
    const proxy = values.get('ProxyMethod');
    if (typeof proxy === 'number' && proxy !== 0) notes.push('proxyDropped');

    const forwards: ImportForward[] = [];
    let dropped = false;
    for (const entry of (text(values, 'PortForwardings') ?? '').split(',')) {
      const trimmed = entry.trim();
      if (!trimmed) continue;
      const f = parseForward(trimmed);
      if (f && forwards.length < MAX_FORWARDS) forwards.push(f);
      else dropped = true;
    }
    if (dropped) notes.push('forwardsDropped');

    candidates.push({
      key: name,
      name,
      protocol: 'ssh',
      folder: [],
      host,
      port,
      ...(username ? { username } : {}),
      ...(keyPath ? { keyPath } : {}),
      forwards,
      notes,
    });
  }

  return {
    candidates,
    skipped: [...skipped].map(([code, count]) => ({ code, count })),
  };
}
