// Builds the native RDP helper with the C# compiler that ships with Windows (.NET Framework 4.8).
// No SDK, NuGet or Visual Studio required.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') {
  console.log('RDP-Helfer wird nur unter Windows gebaut - übersprungen.');
  process.exit(0);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'native', 'Terminus.RdpHost');
// --out <dir> builds elsewhere, e.g. while a running Terminus locks out/rdp-host.
const outFlag = process.argv.indexOf('--out');
const outputDir = outFlag > 0 && process.argv[outFlag + 1] ? resolve(process.argv[outFlag + 1]) : join(root, 'out', 'rdp-host');
const framework = join(process.env.SystemRoot ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319');
const csc = join(framework, 'csc.exe');

if (!existsSync(csc)) {
  console.error(`C#-Compiler nicht gefunden: ${csc}`);
  process.exit(1);
}

const references = ['System.dll', 'System.Core.dll', 'System.Drawing.dll', 'System.Windows.Forms.dll',
  'System.Web.Extensions.dll', 'Microsoft.CSharp.dll'];
const sources = readdirSync(source).filter(file => file.endsWith('.cs')).sort().map(file => join(source, file));

mkdirSync(outputDir, { recursive: true });
execFileSync(csc, [
  '/nologo', '/noconfig', '/target:winexe', '/platform:x64', '/optimize+', '/warnaserror+',
  `/win32manifest:${join(source, 'app.manifest')}`,
  ...references.map(reference => `/reference:${join(framework, reference)}`),
  `/out:${join(outputDir, 'Terminus.RdpHost.exe')}`,
  ...sources,
], { stdio: 'inherit' });
console.log(`RDP-Helfer gebaut: ${join(outputDir, 'Terminus.RdpHost.exe')}`);
