import { AppError } from './errors';
import type { ImportCandidate, ImportPreview, ImportSkipCode } from './import';
import { MAX_IMPORT_CANDIDATES, validImportHost } from './import';

/**
 * Opening `<Node …>` / `<Node …/>` or closing `</Node>`; no XML library, regex scan only.
 * Tag bodies exclude `<` and `>`, so a failed attempt ends at the next tag: linear time.
 */
const NODE_TAG = /<Node\b([^<>]*?)(\/?)>|<\/Node>/g;
const ROOT_TAG = /<Connections\b([^<>]*)>/;
/** Anchored to whitespace, so a word run is scanned once and never restarted mid-run. */
const ATTR = /(?:^|\s)(\w+)="([^"]*)"/g;
/** Only these attributes are read; Password is never touched. */
const READ = new Set(['Type', 'Name', 'Id', 'Protocol', 'Hostname', 'Port', 'Username', 'Domain', 'FullFileEncryption']);
const ENTITY = /&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g;
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
/** Hostile-file bounds: deeper containers and longer names are cut, not rejected. */
const MAX_FOLDER_DEPTH = 32;
const MAX_SEGMENT = 255;
const MAX_KEY = 1024;

/** Pure; text of confCons.xml. Throws AppError('core.importEncrypted') when FullFileEncryption="true". */
export function parseMRemoteNg(text: string): Omit<ImportPreview, 'source' | 'file'> {
  const root = ROOT_TAG.exec(text);
  if (root && readAttrs(root[1]).get('FullFileEncryption') === 'true') throw new AppError('core.importEncrypted');

  const candidates: ImportCandidate[] = [];
  const skipped = new Map<ImportSkipCode, number>();
  const skip = (code: ImportSkipCode) => skipped.set(code, (skipped.get(code) ?? 0) + 1);
  const keys = new Set<string>();
  // Next free suffix per base, so duplicates never rescan earlier keys.
  const next = new Map<string, number>();
  // Open nodes (true = named container) and the names of the named containers among them.
  const stack: boolean[] = [];
  const folder: string[] = [];

  for (const [whole, attrText, slash] of text.matchAll(NODE_TAG)) {
    if (whole.startsWith('</')) {
      if (stack.pop()) folder.pop();
      continue;
    }
    const attrs = readAttrs(attrText);
    const type = attrs.get('Type');
    const name = attrs.get('Name') ?? '';
    // Self-closing nodes have no children, so they never sit on the stack.
    if (slash !== '/') {
      const named = type === 'Container' && name !== '' && folder.length < MAX_FOLDER_DEPTH;
      stack.push(named);
      if (named) folder.push(clip(name, MAX_SEGMENT));
    }
    if (type !== 'Connection') continue;

    const candidate = readConnection(attrs);
    if (typeof candidate === 'string') skip(candidate);
    else if (candidates.length >= MAX_IMPORT_CANDIDATES) skip('tooMany');
    else {
      // Keys must be unique: they identify the selected candidates.
      const base = clip(attrs.get('Id') || [...folder, candidate.name].join('/'), MAX_KEY);
      // The while loop runs only for a real collision with a key already taken.
      let n = next.get(base) ?? 1;
      let key = n === 1 ? base : `${base}#${n}`;
      while (keys.has(key)) key = `${base}#${++n}`;
      next.set(base, n + 1);
      keys.add(key);
      candidates.push({ ...candidate, folder: [...folder], key });
    }
  }

  return { candidates, skipped: [...skipped].map(([code, count]) => ({ code, count })) };
}

/** Cuts to max code units without leaving a lone high surrogate at the end. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const last = text.charCodeAt(max - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? max - 1 : max);
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

/** A candidate without key and folder, or the skip code for an unsupported or invalid connection. */
function readConnection(attrs: Map<string, string>): Omit<ImportCandidate, 'key' | 'folder'> | ImportSkipCode {
  const protocol = attrs.get('Protocol');
  const rdp = protocol === 'RDP';
  if (!rdp && protocol !== 'SSH2' && protocol !== 'SSH1') return 'unsupported';

  const host = attrs.get('Hostname') ?? '';
  if (!validImportHost(host)) return 'invalid';
  const port = readPort(attrs.get('Port'), rdp ? 3389 : 22);
  if (port === undefined) return 'invalid';

  const candidate: Omit<ImportCandidate, 'key' | 'folder'> = {
    name: clip(attrs.get('Name') || host, MAX_SEGMENT),
    protocol: rdp ? 'rdp' : 'ssh',
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

