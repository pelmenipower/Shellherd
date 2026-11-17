// Prints the bilingual "Verify / Prüfen" section appended to the release notes.
// Usage: node scripts/release-verify-notes.mjs <vX.Y.Z> <signed|unsigned> >> notes.md
import { fileURLToPath } from 'node:url';

const IDENTITY = 'https://github.com/pelmenipower/Shellherd/.github/workflows/release.yml@refs/heads/main';
const USAGE = 'Usage: node scripts/release-verify-notes.mjs <vX.Y.Z> <signed|unsigned>';

const WINDOWS_SIGNED = [
  'Windows: signed with a certificate from the SignPath Foundation (free code signing provided by SignPath.io). The uninstaller is not signed yet.',
  'Windows: signiert mit einem Zertifikat der SignPath Foundation (kostenlose Code-Signatur durch SignPath.io). Der Uninstaller ist noch nicht signiert.',
];
const WINDOWS_UNSIGNED = [
  'Windows: the files of this release are not code-signed. Verify them with SHA256SUMS; SmartScreen may warn on first start.',
  'Windows: Die Dateien dieses Releases sind nicht signiert. Prüfe sie mit SHA256SUMS; SmartScreen kann beim ersten Start warnen.',
];

export function verifyNotes(tag, signed) {
  const v = tag.replace(/^v/, '');
  return `
## Verify / Prüfen

**English.** Every file of this release is listed in \`SHA256SUMS\`. The release workflow signed it with Sigstore (\`SHA256SUMS.sigstore.json\`) and published a GitHub build attestation.

**Deutsch.** Alle Dateien dieses Releases stehen in \`SHA256SUMS\`. Der Release-Workflow hat sie mit Sigstore signiert (\`SHA256SUMS.sigstore.json\`) und eine GitHub-Build-Attestierung veröffentlicht.

\`\`\`bash
cosign verify-blob --bundle SHA256SUMS.sigstore.json \\
  --certificate-identity ${IDENTITY} \\
  --certificate-oidc-issuer https://token.actions.githubusercontent.com SHA256SUMS
sha256sum --check --ignore-missing SHA256SUMS
gh attestation verify Shellherd-Setup-${v}.exe --repo pelmenipower/Shellherd
\`\`\`

${(signed ? WINDOWS_SIGNED : WINDOWS_UNSIGNED).join('\n\n')}
`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [tag, state] = process.argv.slice(2);
  if (process.argv.length !== 4 || !/^v\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(tag) || !['signed', 'unsigned'].includes(state)) {
    console.error(USAGE);
    process.exit(2);
  }
  process.stdout.write(verifyNotes(tag, state === 'signed'));
}
