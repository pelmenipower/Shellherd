// Prototype harness (P2): starts the RDP helper and opens one session in its own window.
// Usage: npm run rdp:try -- <server> [DOMAIN\user] [port]
// No password is passed; the RDP control asks for credentials itself.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [server, account = '', port = '3389'] = process.argv.slice(2);
if (!server) {
  console.error('Aufruf: npm run rdp:try -- <server> [DOMAIN\\benutzer] [port]');
  process.exit(1);
}
const [domain, username] = account.includes('\\') ? account.split('\\', 2) : [undefined, account || undefined];

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const helper = spawn(join(root, 'out', 'rdp-host', 'Terminus.RdpHost.exe'), [], { stdio: ['pipe', 'pipe', 'inherit'] });
const send = message => helper.stdin.write(`${JSON.stringify(message)}\n`);

createInterface({ input: helper.stdout }).on('line', line => {
  console.log(`[helper] ${line}`);
  const message = JSON.parse(line);
  if (message.type === 'hello') {
    send({ type: 'open', requestId: '1', sessionId: 'try-1', server, port: Number(port), username, domain, clipboard: true, width: 1280, height: 800 });
  }
  if (message.type === 'status' && message.status === 'closed') helper.stdin.end();
});
helper.on('exit', code => { console.log(`[helper] beendet (${code})`); process.exit(code ?? 0); });
process.on('SIGINT', () => helper.stdin.end());
