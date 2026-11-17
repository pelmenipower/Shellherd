import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, statSync, readdirSync, symlinkSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const installer = resolve('install.sh');
const notRoot = process.getuid?.() !== 0;
const hasCosign = spawnSync('bash', ['-c', 'command -v cosign']).status === 0;
const IDENTITY = 'https://github.com/pelmenipower/Shellherd/.github/workflows/release.yml@refs/heads/main';
const sha = (data) => createHash('sha256').update(data).digest('hex');

/**
 * Builds an isolated sandbox: stubs for curl, cosign, sudo, apt-get, dpkg-deb and setsid on PATH,
 * a fixture "release" directory served by the curl stub, and a private lock directory.
 * Nothing here touches the network, sudo or APT.
 */
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'shellherd-installer-test-'));
  const stubs = join(root, 'stubs');
  const release = join(root, 'release');
  const xdg = join(root, 'xdg');
  const logs = join(root, 'logs');
  for (const dir of [stubs, release, xdg, logs]) mkdirSync(dir);
  const stub = (name, body) => writeFileSync(join(stubs, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  // curl: serves files from $RELEASE_DIR by basename, records every URL, 22 when the file is missing.
  stub('curl', `url=''; out=''
while (($#)); do case "$1" in -o) out=$2; shift 2;; https://*) url=$1; shift;; *) shift;; esac; done
printf '%s\\n' "$url" >> "$LOGS/urls"
if [[ $url == https://api.github.com/*/releases/latest ]]; then printf '{"tag_name":"v%s"}' "$LATEST"; exit 0; fi
file="$RELEASE_DIR/\${url##*/}"
[[ -f $file ]] || exit 22
cp "$file" "$out"`);
  stub('cosign', `printf '%s\\n' "$*" >> "$LOGS/cosign"; exit "\${COSIGN_EXIT:-0}"`);
  stub('setsid', `{ printf '%s\\n' "$*"; env; } > "$LOGS/setsid"`);
  const recorder = 'printf "%s\\n" "$@" > "$LOGS/apt"';
  stub('sudo', recorder);
  stub('apt-get', recorder);
  stub('dpkg-deb', 'case "$3" in Package) echo shellherd;; Architecture) echo amd64;; Version) echo 9.9.9;; *) exit 1;; esac');

  const env = (extra = {}) => ({
    ...process.env,
    PATH: `${stubs}:${process.env.PATH}`,
    HOME: root,
    XDG_RUNTIME_DIR: xdg,
    RELEASE_DIR: release,
    LOGS: logs,
    LATEST: '9.9.9',
    ...extra,
  });
  const run = (args, extra = {}, options = {}) =>
    spawnSync('bash', [options.script ?? installer, ...args], { env: env(extra), encoding: 'utf8', ...options });
  const log = (name) => (existsSync(join(logs, name)) ? readFileSync(join(logs, name), 'utf8') : '');
  /** Publishes assets and a matching SHA256SUMS (optionally with a sigstore bundle). */
  const publish = (assets, { bundle = true } = {}) => {
    for (const [name, data] of Object.entries(assets)) writeFileSync(join(release, name), data);
    const sums = Object.entries(assets).map(([name, data]) => `${sha(data)}  ${name}\n`).join('');
    writeFileSync(join(release, 'SHA256SUMS'), sums);
    if (bundle) writeFileSync(join(release, 'SHA256SUMS.sigstore.json'), '{}');
  };
  return { root, stubs, release, xdg, logs, env, run, log, publish, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function withSandbox(fn) {
  const sb = sandbox();
  try { return fn(sb); } finally { sb.cleanup(); }
}

describe.runIf(process.platform === 'linux')('Linux shell installer', () => {
  it('has valid Bash syntax and explains its usage', () => {
    execFileSync('bash', ['-n', installer]);
    const help = execFileSync('bash', [installer, '--help'], { encoding: 'utf8' });
    expect(help).toContain('--package');
    expect(help).toContain('--appimage');
  });

  it('refuses invalid arguments before doing anything', () => {
    withSandbox(({ run }) => {
      const bad = [
        ['--version', '../bad'], ['--version', '1.2'], ['--package', '/does-not-exist.deb'], ['--version'],
        ['--package', '/x.deb', '--version', '1.2.3'], ['--wait-pid', '123'],
        ['--from-app'], ['--from-app', '--version', '1.2.3'], ['--from-app', '--wait-pid', '12'],
        ['--from-app', '--version', '1.2.3', '--wait-pid', '0'], ['--from-app', '--version', '1.2.3', '--wait-pid', 'abc'],
        ['--from-app', '--version', '1.2.3', '--wait-pid', '1', '--package', '/x.deb'],
        ['--appimage', 'relative.AppImage'], ['--bogus'],
      ];
      for (const args of bad) expect(run(args).status, args.join(' ')).not.toBe(0);
    });
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
      execFileSync('bash', [installer, '--package', packagePath], {
        env: { ...process.env, PATH: `${root}:${process.env.PATH}`, XDG_RUNTIME_DIR: root, SHELLHERD_TEST_APT_LOG: log },
      });
      const args = readFileSync(log, 'utf8').trim().split('\n');
      expect(args.slice(-4, -1)).toEqual(['install', '--reinstall', '-y']);
      expect(args.at(-1)).toMatch(/^\/tmp\/shellherd-install\.[^/]+\/shellherd.deb$/);
      expect(existsSync(args.at(-1))).toBe(false);
      expect(readFileSync(packagePath, 'utf8')).toBe('synthetic-package');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('verifies the signature with the pinned identity before installing the DEB', () => {
    withSandbox(({ run, log, publish }) => {
      publish({ 'Shellherd-9.9.9-amd64.deb': 'deb-bytes' });
      const result = run(['--version', '9.9.9']);
      expect(result.status, result.stderr).toBe(0);
      const cosign = log('cosign');
      expect(cosign).toContain(`--certificate-identity ${IDENTITY}`);
      expect(cosign).toContain('--certificate-oidc-issuer https://token.actions.githubusercontent.com');
      expect(cosign).toMatch(/--bundle \/\S+SHA256SUMS\.sigstore\.json .* \/\S+SHA256SUMS\n$/);
      expect(result.stdout).toContain('Signatur geprüft (Sigstore)');
      expect(log('apt')).toContain('--reinstall');
    });
  });

  it('resolves the latest version through the API when none is given', () => {
    withSandbox(({ run, log, publish }) => {
      publish({ 'Shellherd-9.9.9-amd64.deb': 'deb-bytes' });
      expect(run([]).status).toBe(0);
      expect(log('urls')).toContain('https://api.github.com/repos/pelmenipower/Shellherd/releases/latest');
      expect(log('urls')).toContain('/releases/download/v9.9.9/Shellherd-9.9.9-amd64.deb');
    });
  });

  it('aborts without installing when the signature does not verify', () => {
    withSandbox(({ run, log, publish }) => {
      publish({ 'Shellherd-9.9.9-amd64.deb': 'deb-bytes' });
      const result = run(['--version', '9.9.9'], { COSIGN_EXIT: '1' });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('Die Signatur von SHA256SUMS ist ungültig. Nichts wurde installiert.');
      expect(log('apt')).toBe('');
    });
  });

  it('warns and uses the checksum only when the release has no signature bundle', () => {
    withSandbox(({ run, log, publish }) => {
      publish({ 'Shellherd-9.9.9-amd64.deb': 'deb-bytes' }, { bundle: false });
      const result = run(['--version', '9.9.9']);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('Dieses Release hat keine Sigstore-Signatur; nur Prüfsummen.');
      expect(log('cosign')).toBe('');
      expect(log('apt')).toContain('--reinstall');
    });
  });

  it.skipIf(hasCosign)('falls back to the checksum with a hint when cosign is missing', () => {
    withSandbox(({ stubs, run, publish }) => {
      rmSync(join(stubs, 'cosign'));
      publish({ 'Shellherd-9.9.9-amd64.deb': 'deb-bytes' });
      const result = run(['--version', '9.9.9']);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('cosign nicht gefunden: nur Prüfsummen');
    });
  });

  it('rejects a package whose checksum does not match', () => {
    withSandbox(({ run, log, publish, release }) => {
      publish({ 'Shellherd-9.9.9-amd64.deb': 'deb-bytes' });
      writeFileSync(join(release, 'Shellherd-9.9.9-amd64.deb'), 'tampered');
      const result = run(['--version', '9.9.9']);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('Prüfsumme');
      expect(log('apt')).toBe('');
    });
  });

  it('only talks to the Shellherd release and API URLs', () => {
    withSandbox(({ run, log, publish }) => {
      publish({ 'Shellherd-9.9.9-amd64.deb': 'deb-bytes' });
      run([]);
      const urls = log('urls').trim().split('\n');
      expect(urls.length).toBeGreaterThan(0);
      for (const url of urls) {
        expect(url).toMatch(/^https:\/\/(github\.com\/pelmenipower\/Shellherd\/releases\/download\/v9\.9\.9\/|api\.github\.com\/repos\/pelmenipower\/Shellherd\/releases\/latest$)/);
      }
    });
  });

  it('refuses to run twice at the same time', () => {
    withSandbox(({ run, publish, xdg, root }) => {
      publish({ 'Shellherd-9.9.9-amd64.deb': 'deb-bytes' });
      const lock = join(xdg, `shellherd-install-${process.getuid()}.lock`);
      // The holder is reparented to init so the test process never has to reap it.
      execFileSync('bash', ['-c', `flock -n "${lock}" sleep 3 >/dev/null 2>&1 & sleep 0.4`], { cwd: root });
      const result = run(['--version', '9.9.9']);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('Ein anderer Shellherd-Installer läuft bereits.');
    });
  });

  describe('handoff', () => {
    // A stand-in for the newer install.sh published with the release.
    const newer = `#!/bin/bash
{ printf '%s\\n' "$@"; echo "HANDOFF=\${SHELLHERD_INSTALL_HANDOFF:-}"; } > "$LOGS/child"
exec 9>>"$XDG_RUNTIME_DIR/shellherd-install-$(id -u).lock"
if flock -n 9; then echo locked-ok >> "$LOGS/child"; fi
exit \${CHILD_EXIT:-0}
`;

    it('hands over to a differing release script with the same arguments and a free lock', () => {
      withSandbox(({ run, log, publish }) => {
        publish({ 'Shellherd-9.9.9-amd64.deb': 'deb-bytes', 'install.sh': newer });
        const result = run(['--version', '9.9.9']);
        expect(result.status, result.stderr).toBe(0);
        const child = log('child').trim().split('\n');
        expect(child.slice(0, 2)).toEqual(['--version', '9.9.9']);
        expect(child).toContain('HANDOFF=1');
        expect(child).toContain('locked-ok');
        expect(log('apt')).toBe(''); // the parent must not install itself
      });
    });

    it('passes the exit code of the child through', () => {
      withSandbox(({ run, publish }) => {
        publish({ 'Shellherd-9.9.9-amd64.deb': 'deb-bytes', 'install.sh': newer });
        expect(run(['--version', '9.9.9'], { CHILD_EXIT: '7' }).status).toBe(7);
      });
    });

    it('does not hand over a second time', () => {
      withSandbox(({ run, log, publish }) => {
        publish({ 'Shellherd-9.9.9-amd64.deb': 'deb-bytes', 'install.sh': newer });
        const result = run(['--version', '9.9.9'], { SHELLHERD_INSTALL_HANDOFF: '1' });
        expect(result.status, result.stderr).toBe(0);
        expect(log('child')).toBe('');
        expect(log('apt')).toContain('--reinstall');
      });
    });

    it('keeps running itself when the release does not list install.sh', () => {
      withSandbox(({ run, log, publish }) => {
        publish({ 'Shellherd-9.9.9-amd64.deb': 'deb-bytes' });
        expect(run(['--version', '9.9.9']).status).toBe(0);
        expect(log('child')).toBe('');
      });
    });

    it('skips the handoff when the script is not a regular file (curl | bash)', () => {
      withSandbox(({ env, log, publish }) => {
        publish({ 'Shellherd-9.9.9-amd64.deb': 'deb-bytes', 'install.sh': newer });
        const result = spawnSync('bash', ['-s', '--', '--version', '9.9.9'], {
          env: env(), input: readFileSync(installer, 'utf8'), encoding: 'utf8',
        });
        expect(result.status, result.stderr).toBe(0);
        expect(log('child')).toBe('');
        expect(log('apt')).toContain('--reinstall');
      });
    });
  });

  describe('early failures and private copy', () => {
    // Runs the script on a pseudo terminal, answers the Enter prompt and returns the terminal output.
    const hasPython = spawnSync('python3', ['-c', '']).status === 0;
    const onPty = (sb, args, extra = {}) => {
      const code = `import os,pty,sys,select,time
pid,fd=pty.fork()
if pid==0:
    os.execvp('bash',['bash']+sys.argv[1:])
out=b'';sent=False;end=time.time()+20
while time.time()<end:
    r,_,_=select.select([fd],[],[],0.2)
    if r:
        try: d=os.read(fd,4096)
        except OSError: break
        if not d: break
        out+=d
        if b'Enter zum' in out and not sent: os.write(fd,b'\\n');sent=True
_,st=os.waitpid(pid,0)
sys.stdout.write(out.decode('utf8','replace'));sys.exit(os.waitstatus_to_exitcode(st))`;
      return spawnSync('python3', ['-I', '-c', code, installer, ...args], { env: sb.env(extra), encoding: 'utf8' });
    };

    it.runIf(hasPython)('shows the failure and waits for Enter when --from-app fails on a bad argument', () => {
      withSandbox((sb) => {
        const result = onPty(sb, ['--from-app', '--bogus']);
        expect(result.status).toBe(1);
        expect(result.stdout).toContain('Unbekanntes Argument: --bogus');
        expect(result.stdout).toContain('Das Update ist fehlgeschlagen.');
        expect(result.stdout).toContain('Falls Shellherd nicht mehr läuft, starte es neu.');
        expect(result.stdout).toContain('Enter zum Schließen');
      });
    });

    it.runIf(hasPython && notRoot)('shows the failure and waits for Enter when the lock is taken', () => {
      withSandbox((sb) => {
        const lock = join(sb.xdg, `shellherd-install-${process.getuid()}.lock`);
        execFileSync('bash', ['-c', `flock -n "${lock}" sleep 4 >/dev/null 2>&1 & sleep 0.4`], { cwd: sb.root });
        const result = onPty(sb, ['--from-app', '--version', '9.9.9', '--wait-pid', '1']);
        expect(result.status).toBe(1);
        expect(result.stdout).toContain('Ein anderer Shellherd-Installer läuft bereits.');
        expect(result.stdout).toContain('Enter zum Schließen');
      });
    });

    it('does not wait for Enter when the same early failure happens in a handoff child', () => {
      withSandbox((sb) => {
        const result = sb.run(['--from-app', '--bogus'], { SHELLHERD_INSTALL_HANDOFF: '1' }, { input: '' });
        expect(result.status).toBe(1);
        expect(result.stdout).not.toContain('Enter zum');
      });
    });

    it('removes its own private update folder, and only that one', () => {
      withSandbox((sb) => {
        const tmp = join(sb.root, 'tmp');
        mkdirSync(tmp);
        const place = (parent, name) => {
          const dir = join(parent, name);
          mkdirSync(dir, { recursive: true });
          const script = join(dir, 'install.sh');
          writeFileSync(script, readFileSync(installer));
          return { dir, script };
        };
        const mine = place(tmp, 'shellherd-update-abc123');
        sb.run(['--bogus'], { TMPDIR: tmp }, { script: mine.script });
        expect(existsSync(mine.dir)).toBe(false);
        const otherName = place(tmp, 'something-else');
        sb.run(['--bogus'], { TMPDIR: tmp }, { script: otherName.script });
        expect(existsSync(otherName.dir)).toBe(true);
        const otherParent = place(join(sb.root, 'elsewhere'), 'shellherd-update-abc123');
        sb.run(['--bogus'], { TMPDIR: tmp }, { script: otherParent.script });
        expect(existsSync(otherParent.dir)).toBe(true);
      });
    });
  });

  describe.skipIf(!notRoot)('AppImage and --from-app', () => {
    const image = 'Shellherd-9.9.9-x86_64.AppImage';
    const setupImage = (sb, content = 'old-image') => {
      sb.publish({ [image]: 'new-image' });
      const dir = join(sb.root, 'apps');
      mkdirSync(dir);
      const target = join(dir, 'Shellherd-0.1.0-x86_64.AppImage');
      writeFileSync(target, content, { mode: 0o644 });
      return { dir, target };
    };

    it('replaces the AppImage file atomically with mode 755 and leaves no temp file', () => {
      withSandbox((sb) => {
        const { dir, target } = setupImage(sb);
        const before = statSync(target).ino;
        const result = sb.run(['--appimage', target, '--version', '9.9.9']);
        expect(result.status, result.stderr).toBe(0);
        expect(readFileSync(target, 'utf8')).toBe('new-image');
        expect(statSync(target).mode & 0o777).toBe(0o755);
        expect(statSync(target).ino).not.toBe(before);
        expect(readdirSync(dir)).toEqual(['Shellherd-0.1.0-x86_64.AppImage']);
        expect(result.stdout).toContain(`Ersetzt: ${target} (jetzt Shellherd 9.9.9)`);
        expect(sb.log('apt')).toBe(''); // no APT for AppImage
        expect(sb.log('setsid')).toBe(''); // no restart without --from-app
      });
    });

    it('rejects a symlink, a missing file and an unwritable folder', () => {
      withSandbox((sb) => {
        const { dir, target } = setupImage(sb);
        const link = join(dir, 'link.AppImage');
        symlinkSync(target, link);
        expect(sb.run(['--appimage', link, '--version', '9.9.9']).status).not.toBe(0);
        const missing = sb.run(['--appimage', join(dir, 'missing.AppImage'), '--version', '9.9.9']);
        expect(missing.stderr).toContain('AppImage-Datei nicht gefunden:');
        execFileSync('chmod', ['555', dir]);
        try {
          const locked = sb.run(['--appimage', target, '--version', '9.9.9']);
          expect(locked.status).not.toBe(0);
          expect(locked.stderr).toContain(`Der Ordner der AppImage-Datei ist nicht beschreibbar: ${dir}`);
          expect(readFileSync(target, 'utf8')).toBe('old-image');
        } finally { execFileSync('chmod', ['755', dir]); }
      });
    });

    it('restarts the new AppImage detached without handoff or update variables', () => {
      withSandbox((sb) => {
        const { target } = setupImage(sb);
        const deadPid = spawnSync('true').pid;
        const result = sb.run(
          ['--from-app', '--version', '9.9.9', '--wait-pid', String(deadPid), '--appimage', target],
          { SHELLHERD_INSTALL_HANDOFF: '1', SHELLHERD_UPDATE_VERSION: '0.0.1' },
        );
        expect(result.status, result.stderr).toBe(0);
        const setsid = sb.log('setsid');
        expect(setsid.split('\n')[0]).toBe(`-f ${target}`);
        expect(setsid).not.toContain('SHELLHERD_INSTALL_HANDOFF');
        expect(result.stdout).toContain('Shellherd 9.9.9 ist installiert und wird gestartet.');
      });
    });

    it('waits for the app to exit before replacing the file', () => {
      withSandbox((sb) => {
        const { target } = setupImage(sb);
        const pid = Number(execFileSync('bash', ['-c', 'sleep 1.2 >/dev/null 2>&1 & echo $!'], { encoding: 'utf8' }).trim());
        const started = Date.now();
        const result = sb.run(['--from-app', '--version', '9.9.9', '--wait-pid', String(pid), '--appimage', target]);
        expect(result.status, result.stderr).toBe(0);
        expect(Date.now() - started).toBeGreaterThanOrEqual(900);
        expect(readFileSync(target, 'utf8')).toBe('new-image');
      });
    });

    it('does not touch the file when verification fails', () => {
      withSandbox((sb) => {
        const { target } = setupImage(sb);
        writeFileSync(join(sb.release, image), 'tampered');
        const result = sb.run(['--appimage', target, '--version', '9.9.9']);
        expect(result.status).not.toBe(0);
        expect(readFileSync(target, 'utf8')).toBe('old-image');
      });
    });

    it('treats a missing signature bundle as an error with --from-app but not for manual runs', () => {
      withSandbox((sb) => {
        const { target } = setupImage(sb);
        sb.publish({ [image]: 'new-image' }, { bundle: false });
        rmSync(join(sb.release, 'SHA256SUMS.sigstore.json'), { force: true }); // setupImage published one
        const deadPid = String(spawnSync('true').pid);
        const fromApp = sb.run(['--from-app', '--version', '9.9.9', '--wait-pid', deadPid, '--appimage', target]);
        expect(fromApp.status).not.toBe(0);
        expect(fromApp.stderr).toContain('Dem Release fehlt die Sigstore-Signatur.');
        expect(readFileSync(target, 'utf8')).toBe('old-image');
        const manual = sb.run(['--version', '9.9.9', '--appimage', target]);
        expect(manual.status, manual.stderr).toBe(0);
        expect(manual.stdout).toContain('Dieses Release hat keine Sigstore-Signatur; nur Prüfsummen.');
        expect(readFileSync(target, 'utf8')).toBe('new-image');
      });
    });

    it('refuses --from-app without --version and --wait-pid', () => {
      withSandbox((sb) => {
        const { target } = setupImage(sb);
        expect(sb.run(['--from-app', '--appimage', target]).status).not.toBe(0);
      });
    });

    it('hands the exact original arguments to the handoff child', () => {
      withSandbox((sb) => {
        const { target } = setupImage(sb);
        const newer = '#!/bin/bash\nprintf \'%s\\n\' "$@" > "$LOGS/child"\n';
        sb.publish({ [image]: 'new-image', 'install.sh': newer });
        const deadPid = String(spawnSync('true').pid);
        const args = ['--from-app', '--version', '9.9.9', '--wait-pid', deadPid, '--appimage', target];
        const result = sb.run(args);
        expect(result.status, result.stderr).toBe(0);
        expect(sb.log('child').trim().split('\n')).toEqual(args);
        expect(readFileSync(target, 'utf8')).toBe('old-image');
      });
    });
  });
});
