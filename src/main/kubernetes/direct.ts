import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { KUBECONFIG_LOCAL_PATH } from '../../shared/kubernetes';
import type { KubernetesConnectionNode } from '../../shared/vault/types';
import { KubeInputError } from './kubeconfig';
import type { KubeconfigPolicy } from './kubeconfig';

/** A kubeconfig is a few KiB; anything bigger is not one (and /dev/zero or a FIFO must never be read). */
export const DIRECT_FILE_MAX_BYTES = 1_048_576;

/** Where the cluster is reached from this computer: kubeconfig text, a label for the UI and the rules that apply to it. */
export interface DirectAccess { kubeconfig: string; source: string; policy: KubeconfigPolicy }

export interface LocalFiles {
  stat(path: string): Promise<{ isFile(): boolean; size: number }>;
  readFile(path: string, encoding: 'utf8'): Promise<string>;
}

const nodeFiles: LocalFiles = { stat: p => fs.promises.stat(p), readFile: (p, e) => fs.promises.readFile(p, e) };

/** `~/` and `~\` mean the home directory. */
export function expandHome(file: string, home = os.homedir()): string {
  return /^~[\\/]/.test(file) ? path.join(home, file.slice(2)) : file;
}

/** Reads the kubeconfig at `file` once. No $KUBECONFIG, no search; every failure is the same error naming the path as entered. */
export async function readLocalKubeconfig(file: string, files: LocalFiles = nodeFiles): Promise<{ text: string; path: string }> {
  const unreadable = new KubeInputError('kubernetes.kubeconfigFileUnreadable', { path: file });
  if (!KUBECONFIG_LOCAL_PATH.test(file) || /[\0\r\n]/.test(file)) throw unreadable;
  const expanded = expandHome(file);
  // Defense in depth: on Windows anything that does not resolve to a drive path (e.g. UNC) is refused before any disk access.
  if (process.platform === 'win32' && !/^[A-Za-z]:\\/.test(path.win32.resolve(expanded))) throw unreadable;
  try {
    const info = await files.stat(expanded);
    if (!info.isFile() || info.size > DIRECT_FILE_MAX_BYTES) throw unreadable;
    return { text: await files.readFile(expanded, 'utf8'), path: expanded };
  } catch { throw unreadable; }
}

export async function openDirect(cluster: KubernetesConnectionNode, files?: LocalFiles): Promise<DirectAccess> {
  const source = cluster.kubeconfig;
  if (source.source === 'inline') {
    return { kubeconfig: source.text, source: 'inline', policy: { source: 'inline', ...(source.execConsent ? { execConsent: source.execConsent } : {}) } };
  }
  if (source.source === 'file') {
    const { text, path: expanded } = await readLocalKubeconfig(source.path, files);
    return { kubeconfig: text, source: expanded, policy: { source: 'file', dir: path.dirname(expanded) } };
  }
  throw new KubeInputError('kubernetes.kubeconfigInvalid');
}
