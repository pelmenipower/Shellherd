import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { verifyNotes } from './release-verify-notes.mjs';

const script = fileURLToPath(new URL('./release-verify-notes.mjs', import.meta.url));
const IDENTITY = 'https://github.com/pelmenipower/Shellherd/.github/workflows/release.yml@refs/heads/main';
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

describe('verifyNotes', () => {
  it('starts with a blank line and the heading', () => {
    expect(verifyNotes('v1.2.3', true).startsWith('\n## Verify / Prüfen\n\n**English.**')).toBe(true);
  });

  it('contains the exact identity, issuer and versioned installer name', () => {
    const text = verifyNotes('v1.2.3', true);
    expect(text).toContain(`  --certificate-identity ${IDENTITY} \\\n`);
    expect(text).toContain('  --certificate-oidc-issuer https://token.actions.githubusercontent.com SHA256SUMS\n');
    expect(text).toContain('gh attestation verify Shellherd-Setup-1.2.3.exe --repo pelmenipower/Shellherd\n');
    expect(text).toContain('sha256sum --check --ignore-missing SHA256SUMS\n');
  });

  it('adds the signed Windows lines', () => {
    const text = verifyNotes('v1.2.3', true);
    expect(text.endsWith('```\n\nWindows: signed with a certificate from the SignPath Foundation (free code signing provided by SignPath.io). The uninstaller is not signed yet.\n\nWindows: signiert mit einem Zertifikat der SignPath Foundation (kostenlose Code-Signatur durch SignPath.io). Der Uninstaller ist noch nicht signiert.\n')).toBe(true);
    expect(text).not.toContain('not code-signed');
  });

  it('adds the unsigned Windows lines', () => {
    const text = verifyNotes('v1.2.3', false);
    expect(text.endsWith('```\n\nWindows: the files of this release are not code-signed. Verify them with SHA256SUMS; SmartScreen may warn on first start.\n\nWindows: Die Dateien dieses Releases sind nicht signiert. Prüfe sie mit SHA256SUMS; SmartScreen kann beim ersten Start warnen.\n')).toBe(true);
    expect(text).not.toContain('SignPath');
  });
});

describe('cli', () => {
  it('prints the notes to stdout', () => {
    const r = run('v1.2.3', 'signed');
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(verifyNotes('v1.2.3', true));
  });

  it.each([[['1.2.3', 'signed']], [['v1.2', 'signed']], [['v12345.1.1', 'signed']], [['v1.2.3', 'maybe']], [['v1.2.3']], [[]]])(
    'rejects %j with exit 2',
    args => {
      const r = run(...args);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('Usage: node scripts/release-verify-notes.mjs <vX.Y.Z> <signed|unsigned>');
    },
  );
});
