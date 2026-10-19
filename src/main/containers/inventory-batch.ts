import { INVENTORY_KINDS } from '../../shared/containers';
import type { ContainerRuntime, InventoryKind } from '../../shared/containers';
import { inventoryArgv, remoteScript, shellJoin } from './commands';
import type { SudoMode } from './commands';
import type { RunResult } from './parsers';

export const LIST_MARKER = /^\[terminus-list-[0-9a-f]{16}\]$/;
/** O3: four times the 1 MiB a single list had. */
export const BATCH_OUTPUT_LIMIT = 4 * 1024 * 1024;
/** C1: four times LIST_TIMEOUT (15 s) a single list had. */
export const BATCH_TIMEOUT = 60_000;
/** Same text as runLocal's maxBuffer case (runner.ts:113). */
export const BATCH_TOO_LARGE = 'Die Ausgabe ist zu groß.';

/** One remote command for all four lists; after each list `<marker>:<kind>:<exit code>` is printed on its own line, on stdout and on stderr. */
export function inventoryBatchCommand(runtime: ContainerRuntime, marker: string, sudo: SudoMode): string {
  if (!LIST_MARKER.test(marker)) throw new Error('Invalid list marker');
  const prefix = sudo.kind === 'none' ? [] : ['sudo', '-n'];
  const part = (kind: InventoryKind): string => {
    const tag = `${shellJoin([`${marker}:${kind}:`])}"$c"`;
    return `${shellJoin([...prefix, ...inventoryArgv(runtime, kind)])}; c=$?; echo; echo ${tag}; echo >&2; echo ${tag} >&2`;
  };
  return remoteScript(INVENTORY_KINDS.map(part).join('; '), sudo);
}

type Found = Map<InventoryKind, { segment: string; code: number }>;

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** One leading and one trailing newline belong to the markers (`echo` before each tag, the tag line's own newline). */
const trim = (text: string): string => { const start = text.startsWith('\n') ? text.slice(1) : text; return start.endsWith('\n') ? start.slice(0, -1) : start; };

function cut(text: string, marker: string): { found: Found; rest: string } {
  const line = new RegExp(`^${escapeRegExp(marker)}:(containers|images|volumes|networks):(\\d{1,3})$`, 'gm');
  const found: Found = new Map();
  let cursor = 0;
  let next = 0;
  for (const match of text.matchAll(line)) {
    if (next >= INVENTORY_KINDS.length) break;
    // Only the next expected kind counts; duplicates and out-of-order lines stay inside the segment.
    if (match[1] !== INVENTORY_KINDS[next]) continue;
    found.set(INVENTORY_KINDS[next], { segment: trim(text.slice(cursor, match.index)), code: Number(match[2]) });
    cursor = match.index! + match[0].length;
    next++;
  }
  const rest = next === 0 ? text : text.slice(cursor);
  return { found, rest: next === 0 ? rest : (rest.startsWith('\n') ? rest.slice(1) : rest) };
}

/** Splits the batch output back into one RunResult per kind (B3, C2). */
export function splitInventoryBatch(result: RunResult, marker: string): Record<InventoryKind, RunResult> {
  if (!LIST_MARKER.test(marker)) throw new Error('Invalid list marker');
  const out = cut(result.stdout, marker);
  const err = cut(result.stderr, marker);
  const flags: Partial<RunResult> = {};
  if (result.timedOut) flags.timedOut = true;
  if (result.sudoRejected) flags.sudoRejected = true;
  if (result.sudoBusy) flags.sudoBusy = true;
  if (result.sudoNoPrompt) flags.sudoNoPrompt = true;
  if (result.sudoReady) flags.sudoReady = true;
  const results = {} as Record<InventoryKind, RunResult>;
  for (const kind of INVENTORY_KINDS) {
    const hit = out.found.get(kind);
    results[kind] = hit
      ? { code: hit.code, stdout: hit.segment, stderr: err.found.get(kind)?.segment ?? '', ...(result.sudoReady ? { sudoReady: true } : {}) }
      : { code: null, stdout: '', stderr: result.stdout.length >= BATCH_OUTPUT_LIMIT ? BATCH_TOO_LARGE : err.rest, ...flags };
  }
  return results;
}
