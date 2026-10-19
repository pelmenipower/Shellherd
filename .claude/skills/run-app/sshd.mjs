// Local SSH test server with synthetic credentials: user `demo`, password `synthetic-demo`, 127.0.0.1:2222.
// A few commands return canned output; `exit` ends the session, `sudo reboot` simulates a server-side close.
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(path.resolve(import.meta.dirname, '../../../package.json'));
const { Server, utils } = require('ssh2');

const PORT = Number(process.env.SSHD_PORT ?? 2222);
const hostKey = utils.generateKeyPairSync('ed25519').private;
const prompt = 'demo@web-01:~$ ';
const motd = 'Welcome to Ubuntu 24.04 LTS (GNU/Linux 6.8.0-45-generic x86_64)\r\n\r\nLast login: Mon Oct 19 09:12:44 2026 from 10.0.0.8\r\n';
const outputs = {
  'uptime': ' 14:32:07 up 12 days,  3:41,  1 user,  load average: 0.08, 0.12, 0.10',
  'df -h /': 'Filesystem      Size  Used Avail Use% Mounted on\r\n/dev/sda1        78G   31G   44G  42% /',
  'systemctl status nginx --no-pager | head -3': '\x1b[32m●\x1b[0m nginx.service - A high performance web server\r\n     Loaded: loaded (/lib/systemd/system/nginx.service; enabled)\r\n     Active: \x1b[32mactive (running)\x1b[0m since Fri 2026-10-16 08:02:11 CEST',
  'docker ps --format "table {{.Names}}\\t{{.Status}}"': 'NAMES          STATUS\r\napi            Up 3 days\r\nworker         Up 3 days\r\nredis          Up 9 days',
};

new Server({ hostKeys: [hostKey] }, client => {
  client.on('authentication', context => {
    if (context.method === 'password' && context.username === 'demo' && context.password === 'synthetic-demo') context.accept();
    else context.reject(['password']);
  }).on('ready', () => client.on('session', accept => {
    const session = accept();
    session.on('pty', ok => ok?.()).on('window-change', ok => ok?.()).on('env', ok => ok?.());
    session.on('shell', acceptShell => {
      const stream = acceptShell();
      let line = '';
      stream.write(motd + prompt);
      stream.on('data', data => {
        for (const char of data.toString()) {
          if (char === '\r') {
            const command = line.trim();
            line = '';
            stream.write('\r\n');
            if (command === 'exit' || command === 'sudo reboot') {
              if (command === 'sudo reboot') stream.write('Connection to 127.0.0.1 closed by remote host.\r\n');
              stream.exit(0);
              stream.end();
              return;
            }
            if (command) stream.write(`${outputs[command] ?? `${command.split(' ')[0]}: command not found`}\r\n`);
            stream.write(prompt);
          } else if (char === '\x7f') {
            if (line) { line = line.slice(0, -1); stream.write('\b \b'); }
          } else {
            line += char;
            stream.write(char);
          }
        }
      });
    });
  })).on('error', () => {});
}).listen(PORT, '127.0.0.1', () => console.log(`sshd ready on ${PORT} (demo / synthetic-demo)`));
