// Build guard: the newest section of CHANGELOG.md and CHANGELOG.en.md must describe the version in package.json.
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const { version } = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
const heading = /^## \[(\d+\.\d+\.\d+)\] – \d{4}-\d{2}-\d{2}\s*$/m;

let failed = false;
for (const file of ['CHANGELOG.md', 'CHANGELOG.en.md']) {
  const newest = heading.exec(readFileSync(new URL(file, root), 'utf8'))?.[1];
  if (newest !== version) {
    console.error(`${file}: der neueste Abschnitt ist ${newest ?? 'nicht vorhanden'}, package.json steht auf ${version}.`);
    console.error(`Füge oben einen Abschnitt "## [${version}] – JJJJ-MM-TT" mit den Änderungen hinzu.`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log(`Version ${version}: Changelog vorhanden (Deutsch und Englisch).`);
