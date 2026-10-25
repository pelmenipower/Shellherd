// Builds the Windows Hello helper with the C# compiler that ships with Windows (.NET Framework 4.8).
// WinRT types come from the metadata in System32\WinMetadata: no SDK, NuGet or Visual Studio required.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') {
  console.log('Hello-Helfer wird nur unter Windows gebaut - übersprungen.');
  process.exit(0);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'native', 'Shellherd.Hello');
// --out <dir> builds elsewhere, e.g. while a running Shellherd locks out/hello.
const outFlag = process.argv.indexOf('--out');
const outputDir = outFlag > 0 && process.argv[outFlag + 1] ? resolve(process.argv[outFlag + 1]) : join(root, 'out', 'hello');
const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
const framework = join(systemRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319');
const metadata = join(systemRoot, 'System32', 'WinMetadata');
const csc = join(framework, 'csc.exe');
// System.Runtime.WindowsRuntime.dll (AsTask, ToArray) expects the SDK's merged Windows.winmd; Program.cs does without it on purpose.
const references = [
  ...['System.dll', 'System.Core.dll', 'System.Runtime.dll', 'System.Web.Extensions.dll'].map(file => join(framework, file)),
  ...['Windows.Foundation.winmd', 'Windows.Security.winmd', 'Windows.Storage.winmd'].map(file => join(metadata, file)),
];
for (const file of [csc, ...references]) {
  if (!existsSync(file)) {
    console.error(`Fehlt: ${file}`);
    process.exit(1);
  }
}

const executable = join(outputDir, 'Shellherd.Hello.exe');
const inputs = [join(source, 'Program.cs'), join(source, 'app.manifest'), fileURLToPath(import.meta.url)];
const builtAt = existsSync(executable) ? statSync(executable).mtimeMs : 0;
// Up to date: no csc run, so a Shellherd that holds the helper open does not break `npm run dev` (CS0016).
if (builtAt > 0 && inputs.every(file => statSync(file).mtimeMs <= builtAt)) {
  console.log(`Hello-Helfer ist aktuell: ${executable}`);
} else {
  mkdirSync(outputDir, { recursive: true });
  try {
    execFileSync(csc, [
      '/nologo', '/noconfig', '/target:winexe', '/platform:x64', '/optimize+', '/warnaserror+',
      `/win32manifest:${join(source, 'app.manifest')}`,
      ...references.map(reference => `/reference:${reference}`),
      `/out:${executable}`,
      join(source, 'Program.cs'),
    ], { stdio: 'inherit' });
  } catch {
    console.error('Hello-Helfer nicht gebaut. Hält ein laufendes Shellherd die Datei offen, Shellherd beenden und erneut bauen oder mit --out <Ordner> woanders bauen.');
    process.exit(1);
  }
}

// Smoke test without a prompt: "status" only asks whether Windows Hello is set up.
const reply = JSON.parse(execFileSync(executable, [], { input: '{"op":"status"}\n', encoding: 'utf8', windowsHide: true, timeout: 30_000 }));
if (typeof reply.ok !== 'boolean') {
  console.error(`Hello-Helfer antwortet unerwartet: ${JSON.stringify(reply)}`);
  process.exit(1);
}
console.log(`Hello-Helfer bereit: ${executable} (Windows Hello ${reply.available === true ? 'verfügbar' : 'nicht verfügbar'})`);
