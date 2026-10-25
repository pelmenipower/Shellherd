import { RdpConnectionNodeSchema, SftpConnectionNodeSchema, SshConnectionNodeSchema } from './vault/schema';
import type { Authentication, FolderNode, PortForward, RemoteConnectionNode, VaultNode } from './vault/types';

export type ImportSource = 'openssh' | 'putty' | 'winscp' | 'mremoteng';
export type ImportProtocol = 'ssh' | 'sftp' | 'rdp';

/** At most this many candidates per preview; the rest counts as skipped 'tooMany'. */
export const MAX_IMPORT_CANDIDATES = 500;
/** Largest source file main reads (ssh config, .reg export, WinSCP.ini, confCons.xml). */
export const MAX_IMPORT_BYTES = 4 * 1024 * 1024;

/** A forward without id and auto; buildImportNodes adds both. */
export type ImportForward =
  | { kind: 'local'; localPort: number; targetHost: string; targetPort: number }
  | { kind: 'remote'; remotePort: number; targetHost: string; targetPort: number }
  | { kind: 'dynamic'; localPort: number };

export type ImportNoteCode = 'ppkKey' | 'jumpUnsupported' | 'proxyDropped' | 'forwardsDropped' | 'keyUnresolved' | 'scpAsSftp';
export type ImportSkipCode = 'match' | 'include' | 'notSsh' | 'unsupported' | 'invalid' | 'tooMany';

export interface ImportCandidate {
  /** Unique within one preview: the Host alias (OpenSSH), the decoded session name (PuTTY, WinSCP, mRemoteNG). */
  key: string;
  name: string;
  /** Default 'ssh'. sftp: WinSCP sessions. rdp: mRemoteNG RDP connections. */
  protocol: ImportProtocol;
  /** Folder path inside the import folder, outermost first; empty for top level. WinSCP "a/b/name", mRemoteNG containers. */
  folder: string[];
  host: string;
  port: number;
  username?: string;
  /** rdp only. */
  domain?: string;
  /** Path only; the file is never read. */
  keyPath?: string;
  /** Key of another candidate in the same preview to hop through; that candidate has no jumpKey itself. */
  jumpKey?: string;
  forwards: ImportForward[];
  /** Each code at most once, in the order found. */
  notes: ImportNoteCode[];
}

export interface ImportPreview {
  source: ImportSource;
  /** Absolute path of the read file; absent for registry sources. */
  file?: string;
  candidates: ImportCandidate[];
  /** Only codes with count > 0. */
  skipped: { code: ImportSkipCode; count: number }[];
}

export type ImportReadResult = { canceled: true } | { canceled: false; preview: ImportPreview };

/** Shared host check of all parsers: 1–253 chars, no whitespace or control characters. */
export function validImportHost(host: string): boolean {
  return host.length > 0 && host.length <= 253 && !/[\s\x00-\x1f\x7f]/.test(host);
}

/** SSH and SFTP share one duplicate group; RDP is its own. */
const duplicateKey = (protocol: ImportProtocol, host: string, port: number, username: string | undefined) =>
  JSON.stringify([protocol === 'rdp' ? 'rdp' : 'ssh', host.toLowerCase(), port, username ?? '']);

/** Keys of candidates that match an existing SSH/SFTP/RDP connection or an earlier candidate (host case-insensitive, port, user). */
export function importDuplicates(candidates: ImportCandidate[], nodes: VaultNode[]): Set<string> {
  const seen = new Set<string>();
  const walk = (list: VaultNode[]) => {
    for (const node of list) {
      if (node.type === 'folder') walk(node.children);
      else if (node.protocol === 'ssh' || node.protocol === 'sftp' || node.protocol === 'rdp') {
        seen.add(duplicateKey(node.protocol, node.host, node.port, node.username));
      }
    }
  };
  walk(nodes);

  const duplicates = new Set<string>();
  for (const candidate of candidates) {
    const key = duplicateKey(candidate.protocol, candidate.host, candidate.port, candidate.username);
    if (seen.has(key)) duplicates.add(candidate.key);
    seen.add(key);
  }
  return duplicates;
}

const newUuid = () => crypto.randomUUID();

/** Connection node without jump host; forwards get a fresh id and auto false. */
function remoteNode(candidate: ImportCandidate, newId: () => string): RemoteConnectionNode {
  const common = {
    id: newId(),
    type: 'connection' as const,
    name: candidate.name,
    tags: [],
    host: candidate.host,
    port: candidate.port,
    ...(candidate.username ? { username: candidate.username } : {}),
  };
  if (candidate.protocol === 'rdp') {
    return { ...common, protocol: 'rdp', rdp: { clipboard: true, ...(candidate.domain ? { domain: candidate.domain } : {}) } };
  }
  const authentication: Authentication = candidate.keyPath
    ? { method: 'privateKey', keyPath: candidate.keyPath }
    : { method: 'agent' };
  if (candidate.protocol === 'sftp') return { ...common, protocol: 'sftp', authentication };
  const forwards: PortForward[] = candidate.forwards.map(forward => ({ ...forward, id: newId(), auto: false }));
  return { ...common, protocol: 'ssh', authentication, ...(forwards.length ? { forwards } : {}) };
}

/** Host, folder segments and the schema of the node kind; a failing check counts as invalid. */
function usable(candidate: ImportCandidate, node: RemoteConnectionNode): boolean {
  const schema = node.protocol === 'rdp' ? RdpConnectionNodeSchema
    : node.protocol === 'sftp' ? SftpConnectionNodeSchema
      : SshConnectionNodeSchema;
  return validImportHost(candidate.host)
    && candidate.folder.every(segment => segment.trim().length > 0)
    && schema.safeParse(node).success;
}

/** Nodes for the selected candidates, folders built from `folder`, in preview order. See import-update design 3.4 and validation V1. */
export function buildImportNodes(candidates: ImportCandidate[], selected: ReadonlySet<string>,
  newId: () => string = newUuid): { nodes: VaultNode[]; invalid: number; jumpsDropped: number } {
  const chosen = candidates.filter(candidate => selected.has(candidate.key));
  const byKey = new Map(chosen.map(candidate => [candidate.key, candidate]));

  // First pass: build and check every selected node without its jump host.
  const remote = new Map<string, RemoteConnectionNode>();
  let invalid = 0;
  let jumpsDropped = 0;
  for (const candidate of chosen) {
    const node = remoteNode(candidate, newId);
    if (usable(candidate, node)) remote.set(candidate.key, node);
    else invalid++;
  }

  // Second pass: one hop to a selected, valid target that has no jump host itself.
  for (const candidate of chosen) {
    const node = remote.get(candidate.key);
    if (!candidate.jumpKey || !node || node.protocol === 'rdp') continue;
    const target = remote.get(candidate.jumpKey);
    if (target && !byKey.get(candidate.jumpKey)?.jumpKey) remote.set(candidate.key, { ...node, jumpHost: target.id });
    else jumpsDropped++;
  }

  // Third pass: folders are created on the first child, so top-level order follows the preview.
  const roots: VaultNode[] = [];
  const folders = new Map<string, FolderNode>();
  for (const candidate of chosen) {
    const node = remote.get(candidate.key);
    if (!node) continue;
    let siblings = roots;
    for (let depth = 1; depth <= candidate.folder.length; depth++) {
      const path = JSON.stringify(candidate.folder.slice(0, depth));
      let folder = folders.get(path);
      if (!folder) {
        folder = { id: newId(), type: 'folder', name: candidate.folder[depth - 1], children: [] };
        folders.set(path, folder);
        siblings.push(folder);
      }
      siblings = folder.children;
    }
    siblings.push(node);
  }
  return { nodes: roots, invalid, jumpsDropped };
}

/** Folder with the given children; name is trimmed. */
export function importFolder(name: string, children: VaultNode[], newId: () => string = newUuid): FolderNode {
  return { id: newId(), type: 'folder', name: name.trim(), children };
}
