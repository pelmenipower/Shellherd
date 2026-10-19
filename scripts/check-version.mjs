// Build guard: the newest CHANGELOG.md section must describe the version in package.json.
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const { version } = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
const changelog = readFileSync(new URL('CHANGELOG.md', root), 'utf8');
const newest = /^## \[(\d+\.\d+\.\d+)\] – \d{4}-\d{2}-\d{2}\s*$/m.exec(changelog)?.[1];

if (newest !== version) {
  console.error(`CHANGELOG.md: der neueste Abschnitt ist ${newest ?? 'nicht vorhanden'}, package.json steht auf ${version}.`);
  console.error(`Füge oben einen Abschnitt "## [${version}] – JJJJ-MM-TT" mit den Änderungen hinzu.`);
  process.exit(1);
}
console.log(`Version ${version}: Changelog vorhanden.`);
