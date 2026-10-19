// Prints the CHANGELOG.md section of a version (default: package.json) as GitHub release notes.
// Usage: node scripts/release-notes.mjs [x.y.z] > notes.md
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const version = process.argv[2]?.replace(/^v/, '')
  ?? JSON.parse(readFileSync(new URL('package.json', root), 'utf8')).version;
const changelog = readFileSync(new URL('CHANGELOG.md', root), 'utf8').replace(/\r\n/g, '\n');

const heading = /^## \[(\d+\.\d+\.\d+)\][^\n]*$/gm;
const sections = [...changelog.matchAll(heading)];
const index = sections.findIndex(match => match[1] === version);
if (index < 0) {
  console.error(`CHANGELOG.md enthält keinen Abschnitt für ${version}.`);
  process.exit(1);
}

const start = sections[index].index + sections[index][0].length;
const end = sections[index + 1]?.index ?? changelog.length;
process.stdout.write(`${changelog.slice(start, end).trim()}\n`);
