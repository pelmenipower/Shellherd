// Runs the given command with SHELLHERD_RELEASE=1 (cross-platform; release builds drop the labs).
import { spawn } from 'node:child_process';

const [command, ...args] = process.argv.slice(2);
if (!command) { console.error('Usage: node scripts/with-release.mjs <command> [args...]'); process.exit(2); }
const child = spawn(command, args, { stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, SHELLHERD_RELEASE: '1' } });
child.on('error', (error) => { console.error(error.message); process.exit(1); });
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
