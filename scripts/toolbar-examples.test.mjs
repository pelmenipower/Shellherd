import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const cpu = resolve('examples/toolbar/cpu.sh');
const ram = resolve('examples/toolbar/ram.sh');
function fixture({ before = 'cpu 100 0 100 800 100 0 0 0 400 300', after = before, memory = 'MemTotal: 1048576 kB\nMemAvailable: 786432 kB\nMemFree: 0 kB' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'shellherd-examples-'));
  const awk = execFileSync('sh', ['-c', 'command -v awk'], { encoding: 'utf8' }).trim();
  writeFileSync(join(root, 'before'), before + '\n');
  writeFileSync(join(root, 'after'), after + '\n');
  writeFileSync(join(root, 'memory'), memory + '\n');
  // Execute the real AWK programs against fixtures; no production test hooks or root access.
  writeFileSync(join(root, 'awk'), `#!/usr/bin/env bash
set -eu
args=()
for arg in "$@"; do
  case "$arg" in
    /proc/stat) if [[ -f "$EXAMPLE_TEST_ROOT/sampled" ]]; then arg="$EXAMPLE_TEST_ROOT/after"; else arg="$EXAMPLE_TEST_ROOT/before"; fi ;;
    /proc/meminfo) arg="$EXAMPLE_TEST_ROOT/memory" ;;
  esac
  args+=("$arg")
done
exec "$EXAMPLE_REAL_AWK" "\${args[@]}"
`, { mode: 0o755 });
  writeFileSync(join(root, 'sleep'), '#!/bin/sh\n: > "$EXAMPLE_TEST_ROOT/sampled"\n', { mode: 0o755 });
  return {
    run: (script, overrides = {}) => spawnSync('bash', [script], { encoding: 'utf8', env: { ...process.env, WARN_PERCENT: '70', CRITICAL_PERCENT: '90', PATH: `${root}:${process.env.PATH}`, EXAMPLE_TEST_ROOT: root, EXAMPLE_REAL_AWK: awk, ...overrides } }),
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}
describe.runIf(process.platform === 'linux')('CPU and RAM dynamic display examples', () => {
  it('has valid Bash syntax', () => { execFileSync('bash', ['-n', cpu]); execFileSync('bash', ['-n', ram]); });
  it.each([[0, 'low'], [69, 'low'], [70, 'medium'], [89, 'medium'], [90, 'high'], [100, 'high']])('maps CPU and RAM utilization %s to %s', (percent, value) => {
    const f = fixture({ after: `cpu ${100 + percent} 0 100 ${900 - percent} 100 0 0 0 1400 1300`, memory: `MemTotal: 1000000 kB\nMemAvailable: ${1000000 - percent * 10000} kB` });
    try {
      for (const script of [cpu, ram]) {
        const result = f.run(script);
        expect(result.status, result.stderr).toBe(0);
        expect(result.stderr).toBe('');
        expect(JSON.parse(result.stdout)).toMatchObject({ value, percent });
        expect(typeof JSON.parse(result.stdout).message).toBe('string');
      }
    } finally { f.close(); }
  });
  it('treats iowait as idle and avoids double-counting guest counters', () => {
    const f = fixture({ after: 'cpu 110 0 100 870 120 0 0 0 1400 1300' });
    try { expect(JSON.parse(f.run(cpu).stdout)).toMatchObject({ value: 'low', percent: 10 }); } finally { f.close(); }
  });
  it('uses available memory rather than reporting all filesystem caches as used', () => {
    const f = fixture();
    try { const result = JSON.parse(f.run(ram).stdout); expect(result.percent).toBe(25); expect(result.message).toContain('0.25 / 1.00 GiB'); } finally { f.close(); }
  });
  it('supports user-selected thresholds without embedding any icon or color', () => {
    const f = fixture({ after: 'cpu 150 0 100 850 100 0 0 0 400 300', memory: 'MemTotal: 1000000 kB\nMemAvailable: 500000 kB' });
    try {
      for (const script of [cpu, ram]) {
        const result = f.run(script, { WARN_PERCENT: '30', CRITICAL_PERCENT: '50' });
        const payload = JSON.parse(result.stdout);
        expect(payload).toMatchObject({ value: 'high', percent: 50 });
        expect(payload).not.toHaveProperty('color'); expect(payload).not.toHaveProperty('icon');
      }
    } finally { f.close(); }
  });
  it.each([{ WARN_PERCENT: 'bad' }, { WARN_PERCENT: '-1' }, { CRITICAL_PERCENT: '101' }, { WARN_PERCENT: '90', CRITICAL_PERCENT: '70' }])('rejects invalid thresholds %j without emitting success JSON', overrides => {
    const f = fixture();
    try { for (const script of [cpu, ram]) { const result = f.run(script, overrides); expect(result.status).not.toBe(0); expect(result.stdout).toBe(''); expect(result.stderr).not.toBe(''); } } finally { f.close(); }
  });
  it('reports non-advancing CPU counters and missing memory data as technical failures', () => {
    const f = fixture({ memory: 'MemTotal: 1048576 kB\nMemFree: 200 kB' });
    try { for (const script of [cpu, ram]) { const result = f.run(script); expect(result.status).not.toBe(0); expect(result.stdout).toBe(''); expect(result.stderr).not.toBe(''); } } finally { f.close(); }
  });
});
