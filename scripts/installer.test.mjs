import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const installer = resolve('install.sh');
describe.runIf(process.platform === 'linux')('Linux shell installer', () => {
  it('has valid Bash syntax and explains its usage', () => {
    execFileSync('bash', ['-n', installer]);
    expect(execFileSync('bash', [installer, '--help'], { encoding: 'utf8' })).toContain('--package');
  });
  it('refuses invalid versions and missing local packages', () => {
    for (const args of [['--version', '../bad'], ['--package', '/does-not-exist.deb'], ['--version']]) {
      expect(spawnSync('bash', [installer, ...args]).status).not.toBe(0);
    }
  });
  it('reinstalls local builds of the same version and escalates only the APT step', () => {
    const root = mkdtempSync(join(tmpdir(), 'shellherd-installer-test-'));
    try {
      const packagePath = join(root, 'local package.deb');
      const log = join(root, 'apt-arguments');
      writeFileSync(packagePath, 'synthetic-package');
      writeFileSync(join(root, 'dpkg-deb'), '#!/bin/sh\ncase "$3" in Package) echo shellherd;; Architecture) echo amd64;; Version) echo 0.30.0;; *) exit 1;; esac\n', { mode: 0o755 });
      // The same recorder handles either a normal user (sudo) or a root test process (apt-get).
      const recorder = '#!/bin/sh\nprintf "%s\\n" "$@" > "$SHELLHERD_TEST_APT_LOG"\n';
      writeFileSync(join(root, 'sudo'), recorder, { mode: 0o755 });
      writeFileSync(join(root, 'apt-get'), recorder, { mode: 0o755 });
      execFileSync('bash', [installer, '--package', packagePath], { env: { ...process.env, PATH: `${root}:${process.env.PATH}`, SHELLHERD_TEST_APT_LOG: log } });
      const args = readFileSync(log, 'utf8').trim().split('\n');
      expect(args.slice(-4, -1)).toEqual(['install', '--reinstall', '-y']);
      expect(args.at(-1)).toMatch(/^\/tmp\/shellherd-install\.[^/]+\/shellherd.deb$/);
      expect(existsSync(args.at(-1))).toBe(false);
      expect(readFileSync(packagePath, 'utf8')).toBe('synthetic-package');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
