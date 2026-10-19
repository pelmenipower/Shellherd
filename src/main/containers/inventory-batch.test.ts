import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { INVENTORY_KINDS } from '../../shared/containers';
import type { ContainerRuntime, InventoryKind } from '../../shared/containers';
import { inventoryArgv, shellJoin } from './commands';
import type { SudoMode } from './commands';
import { BATCH_OUTPUT_LIMIT, BATCH_TOO_LARGE, inventoryBatchCommand, splitInventoryBatch } from './inventory-batch';
import type { RunResult } from './parsers';

function hasSh(): boolean {
  try { execFileSync('sh', ['-c', 'true'], { stdio: 'ignore' }); return true; } catch { return false; }
}

const M = '[terminus-list-0123456789abcdef]';
const none: SudoMode = { kind: 'none' };
const prompt: SudoMode = { kind: 'prompt', marker: '[terminus-sudo-0123456789abcdef]', ready: '[terminus-ready-0123456789abcdef]', stdin: true };
const runtimes: ContainerRuntime[] = ['docker', 'podman'];

/** Output of a successful batch: each segment, then its marker line. */
function stream(segments: Partial<Record<InventoryKind, string>>, codes: Partial<Record<InventoryKind, number>> = {}): string {
  return INVENTORY_KINDS.map(kind => `${segments[kind] ?? ''}\n${M}:${kind}:${codes[kind] ?? 0}\n`).join('');
}
/** The script inside `sh -c '...'`, with the quote escapes undone. */
const script = (command: string): string => command.replaceAll("'\\''", "'");
const countOf = (text: string, part: string): number => text.split(part).length - 1;

describe('inventoryBatchCommand', () => {
  it('is the exact script for Docker without sudo', () => {
    const parts = INVENTORY_KINDS.map(kind => `${shellJoin(inventoryArgv('docker', kind))}; c=$?; echo; echo '${M}:${kind}:'"$c"; echo >&2; echo '${M}:${kind}:'"$c" >&2`);
    expect(inventoryBatchCommand('docker', M, none)).toBe(shellJoin(['sh', '-c', `PATH="$PATH:/usr/sbin:/sbin"; ${parts.join('; ')}`]));
  });
  it('contains all four lists in order for both runtimes', () => {
    for (const rt of runtimes) {
      const command = script(inventoryBatchCommand(rt, M, none));
      let from = 0;
      for (const kind of INVENTORY_KINDS) {
        const at = command.indexOf(shellJoin(inventoryArgv(rt, kind)), from);
        expect(at).toBeGreaterThanOrEqual(from);
        from = at;
      }
    }
  });
  it('uses sudo -n per list except without sudo, and one sudo -v in prompt mode only', () => {
    for (const rt of runtimes) {
      const plain = inventoryBatchCommand(rt, M, none);
      expect(plain).not.toContain('sudo');
      const non = inventoryBatchCommand(rt, M, { kind: 'noninteractive' });
      expect(non).not.toContain(' -v');
      const prompted = inventoryBatchCommand(rt, M, prompt);
      for (const command of [script(non), script(prompted)]) {
        for (const kind of INVENTORY_KINDS) expect(command).toContain(`sudo -n ${shellJoin(inventoryArgv(rt, kind))}`);
        expect(countOf(command, 'sudo -n ')).toBe(4);
      }
      expect(countOf(prompted, ' -v')).toBe(1);
      expect(prompted).toContain('sudo -S -p ');
      for (const command of [plain, non, prompted]) {
        expect(countOf(command, M)).toBe(8);
        expect(command).not.toMatch(/ -f |--force|prune/);
      }
    }
  });
  it('refuses invalid markers in both functions', () => {
    for (const marker of ['%u', '', "x'y", '[terminus-sudo-0123456789abcdef]']) {
      expect(() => inventoryBatchCommand('docker', marker, none)).toThrow('Invalid list marker');
      expect(() => splitInventoryBatch({ code: 0, stdout: '', stderr: '' }, marker)).toThrow('Invalid list marker');
    }
  });
  it.runIf(hasSh())('round-trips through sh with a fake docker', () => {
    const directory = mkdtempSync(join(tmpdir(), 'terminus-fake-docker-'));
    try {
      writeFileSync(join(directory, 'docker'), '#!/bin/sh\necho "out-$1"\nif [ "$1" = images ]; then echo "err-images" >&2; exit 3; fi\nexit 0\n', { mode: 0o755 });
      const env = { ...process.env, PATH: `${directory}:${process.env.PATH}` };
      const command = inventoryBatchCommand('docker', M, none);
      // Run twice: once keeping stdout, once routing stderr to stdout.
      const stdout = execFileSync('sh', ['-c', command], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'ignore'] });
      const stderr = execFileSync('sh', ['-c', `{ ${command}; } 2>&1 >/dev/null`], { encoding: 'utf8', env });
      const split = splitInventoryBatch({ code: 0, stdout, stderr }, M);
      expect(split.containers).toEqual({ code: 0, stdout: 'out-ps\n', stderr: '' });
      expect(split.images).toEqual({ code: 3, stdout: 'out-images\n', stderr: 'err-images\n' });
      expect(split.volumes).toEqual({ code: 0, stdout: 'out-volume\n', stderr: '' });
      expect(split.networks).toEqual({ code: 0, stdout: 'out-network\n', stderr: '' });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 30_000);
});

describe('splitInventoryBatch', () => {
  const split = (result: Partial<RunResult>) => splitInventoryBatch({ code: 0, stdout: '', stderr: '', ...result }, M);
  it('cuts four segments with their codes', () => {
    const result = split({ stdout: stream({ containers: 'a', images: 'b', volumes: 'c', networks: 'd' }) });
    expect(INVENTORY_KINDS.map(kind => result[kind])).toEqual([
      { code: 0, stdout: 'a', stderr: '' }, { code: 0, stdout: 'b', stderr: '' },
      { code: 0, stdout: 'c', stderr: '' }, { code: 0, stdout: 'd', stderr: '' }]);
  });
  it('takes stderr and code of the failing list only', () => {
    const result = split({ stdout: stream({}, { images: 1 }), stderr: `\n${M}:containers:0\nError response from daemon: x\n${M}:images:1\n\n${M}:volumes:0\n\n${M}:networks:0\n` });
    expect(result.images).toEqual({ code: 1, stdout: '', stderr: 'Error response from daemon: x' });
    for (const kind of ['containers', 'volumes', 'networks'] as const) expect(result[kind]).toEqual({ code: 0, stdout: '', stderr: '' });
  });
  it('keeps Docker JSON lines and a Podman array byte-identical', () => {
    const lines = '{"ID":"a"}\n{"ID":"b"}\n';
    const array = '[\n  {\n    "Id": "a"\n  }\n]';
    const result = split({ stdout: stream({ containers: lines, images: array }) });
    expect(result.containers.stdout).toBe(lines);
    expect(result.images.stdout).toBe(array);
  });
  it('keeps the first segment and fails the rest on a timeout', () => {
    const result = split({ code: null, timedOut: true, stdout: `a\n${M}:containers:0\n` });
    expect(result.containers).toEqual({ code: 0, stdout: 'a', stderr: '' });
    for (const kind of ['images', 'volumes', 'networks'] as const) expect(result[kind]).toEqual({ code: null, stdout: '', stderr: '', timedOut: true });
  });
  it('carries sudo flags onto every kind without output', () => {
    for (const flag of ['sudoRejected', 'sudoBusy', 'sudoNoPrompt'] as const) {
      const result = split({ code: null, [flag]: true });
      for (const kind of INVENTORY_KINDS) expect(result[kind]).toEqual({ code: null, stdout: '', stderr: '', [flag]: true });
    }
    const ready = split({ code: 1, sudoReady: true, stderr: 'boom' });
    for (const kind of INVENTORY_KINDS) expect(ready[kind]).toEqual({ code: null, stdout: '', stderr: 'boom', sudoReady: true });
    const full = split({ sudoReady: true, stdout: stream({}) });
    for (const kind of INVENTORY_KINDS) expect(full[kind].sudoReady).toBe(true);
  });
  it('reports a failed sudo -v on every kind', () => {
    const result = split({ code: 1, stderr: 'sudo: admin is not in the sudoers file' });
    for (const kind of INVENTORY_KINDS) expect(result[kind]).toEqual({ code: null, stdout: '', stderr: 'sudo: admin is not in the sudoers file' });
  });
  it('reports truncated output as too large', () => {
    const result = split({ code: null, stdout: `${'x'.repeat(BATCH_OUTPUT_LIMIT - 40)}\n${M}:containers:0\n${'y'.repeat(100)}` });
    expect(result.containers.code).toBe(0);
    for (const kind of ['images', 'volumes', 'networks'] as const) expect(result[kind]).toMatchObject({ code: null, stderr: BATCH_TOO_LARGE });
  });
  it('is not fooled by quoted, foreign, duplicate or out-of-order marker lines', () => {
    const foreign = '[terminus-list-ffffffffffffffff]';
    const stdout = [`"${M}:images:0"`, `${foreign}:images:0`, 'x', `${M}:containers:0`, `${M}:containers:0`, `${M}:networks:0`, 'y', `${M}:images:0`,
      `${M}:volumes:0`, `${M}:networks:0`, ''].join('\n');
    const result = split({ stdout });
    expect(result.containers.stdout).toBe(`"${M}:images:0"\n${foreign}:images:0\nx`);
    expect(result.images.stdout).toBe(`${M}:containers:0\n${M}:networks:0\ny`);
    expect(result.volumes.stdout).toBe('');
    expect(result.networks.code).toBe(0);
  });
  it('never gives a kind without a stdout marker code 0', () => {
    const cases: Partial<RunResult>[] = [{}, { code: null, timedOut: true }, { code: 1, stderr: 'x' }, { sudoRejected: true },
      { stdout: `a\n${M}:containers:0\n${M}:images:0\n` }, { stdout: `${M}:images:0\n` }, { stdout: 'x'.repeat(BATCH_OUTPUT_LIMIT) }];
    for (const result of cases) {
      const out = split(result);
      const marked = INVENTORY_KINDS.filter(kind => result.stdout?.includes(`${M}:${kind}:`));
      for (const kind of INVENTORY_KINDS) {
        if (!marked.includes(kind)) expect(out[kind].code).toBeNull();
        expect(out[kind].notFound).toBeUndefined();
      }
    }
  });
});
