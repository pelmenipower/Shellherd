import { AppError } from './errors';
import type { ImportCandidate, ImportPreview, ImportSkipCode } from './import';
import { MAX_IMPORT_CANDIDATES, validImportHost } from './import';

/** Opening `<Node …>` / `<Node …/>` or closing `</Node>`; no XML library, regex scan only. */
const NODE_TAG = /<Node\b([^>]*?)(\/?)>|<\/Node>/g;
const ROOT_TAG = /<Connections\b([^>]*)>/;
const ATTR = /(\w+)="([^"]*)"/g;
/** Only these attributes are read; Password is never touched. */
const READ = new Set(['Type', 'Name', 'Id', 'Protocol', 'Hostname', 'Port', 'Username', 'Domain', 'FullFileEncryption']);
const ENTITY = /&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g;
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Pure; text of confCons.xml. Throws AppError('core.importEncrypted') when FullFileEncryption="true". */
export function parseMRemoteNg(text: string): Omit<ImportPreview, 'source' | 'file'> {
  const root = ROOT_TAG.exec(text);
  if (root && readAttrs(root[1]).get('FullFileEncryption') === 'true') throw new AppError('core.importEncrypted');

  const candidates: ImportCandidate[] = [];
  const skipped = new Map<ImportSkipCode, number>();
  const skip = (code: ImportSkipCode) => skipped.set(code, (skipped.get(code) ?? 0) + 1);
  const keys = new Set<string>();
  const stack: { container: boolean; name: string }[] = [];

  for (const [whole, attrText, slash] of text.matchAll(NODE_TAG)) {
    if (whole.startsWith('</')) {
      stack.pop();
      continue;
    }
    const attrs = readAttrs(attrText);
    const type = attrs.get('Type');
    const name = attrs.get('Name') ?? '';
    // Self-closing nodes have no children, so they never sit on the stack.
    if (slash !== '/') stack.push({ container: type === 'Container', name });
    if (type !== 'Connection') continue;

    const folder = stack.filter((entry) => entry.container && entry.name !== '').map((entry) => entry.name);
    const candidate = readConnection(attrs, folder);
    if (typeof candidate === 'string') skip(candidate);
    else if (candidates.length >= MAX_IMPORT_CANDIDATES) skip('tooMany');
    else {
      // Keys must be unique: they identify the selected candidates.
      const base = attrs.get('Id') || [...folder, candidate.name].join('/');
      let key = base;
      for (let n = 2; keys.has(key); n++) key = `${base}#${n}`;
      keys.add(key);
      candidates.push({ ...candidate, key });
    }
  }

  return { candidates, skipped: [...skipped].map(([code, count]) => ({ code, count })) };
}

/** Attributes of one tag, entities decoded; only the READ names are kept. */
function readAttrs(tag: string): Map<string, string> {
  const attrs = new Map<string, string>();
  for (const [, name, value] of tag.matchAll(ATTR)) {
    if (READ.has(name)) attrs.set(name, decodeEntities(value));
  }
  return attrs;
}

function decodeEntities(value: string): string {
  return value.replace(ENTITY, (whole, body: string) => {
    if (body[0] !== '#') return NAMED[body];
    const code = body[1] === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

/** A candidate without key, or the skip code for an unsupported or invalid connection. */
function readConnection(attrs: Map<string, string>, folder: string[]): Omit<ImportCandidate, 'key'> | ImportSkipCode {
  const protocol = attrs.get('Protocol');
  const rdp = protocol === 'RDP';
  if (!rdp && protocol !== 'SSH2' && protocol !== 'SSH1') return 'unsupported';

  const host = attrs.get('Hostname') ?? '';
  if (!validImportHost(host)) return 'invalid';
  const port = readPort(attrs.get('Port'), rdp ? 3389 : 22);
  if (port === undefined) return 'invalid';

  const candidate: Omit<ImportCandidate, 'key'> = {
    name: attrs.get('Name') || host,
    protocol: rdp ? 'rdp' : 'ssh',
    folder,
    host,
    port,
    forwards: [],
    notes: [],
  };
  const username = attrs.get('Username');
  if (username) candidate.username = username;
  const domain = attrs.get('Domain');
  if (rdp && domain) candidate.domain = domain;
  return candidate;
}

/** Empty or missing Port means the default; anything else must be 1–65535. */
function readPort(raw: string | undefined, fallback: number): number | undefined {
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(raw)) return undefined;
  const port = Number(raw);
  return port >= 1 && port <= 65535 ? port : undefined;
}

