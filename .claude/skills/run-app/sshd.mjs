// Local SSH test server with synthetic credentials: user `demo`, password `synthetic-demo`, 127.0.0.1:2222.
// User `mfa`: keyboard-interactive only, two rounds: "Password: " (`synthetic-demo`), then "Verification code: " (`DEMO_TOTP`, fixtures.mjs).
// Shell: a few canned commands; `exit` ends the session, `sudo reboot` simulates a server-side close.
// Root shell: the exec of `sudo -n -i` with a pty asks for the password (`synthetic-demo`, else a second prompt), prints READY and serves `root@web-01:~# `.
// Also serves SFTP (tree under sftpRoot), a fixed set of exec commands (never executed, only matched) and tcpip targets:
// k8s-cp1:6443 (Kubernetes fake), internal-01:22 (this server, behind a jump host), db-internal:5432 (TCP echo), intranet.demo:80 (one HTTP page).
// tcpip-forward is accepted for localhost and 127.0.0.1 only, cancel-tcpip-forward is accepted, everything else is refused.
// SSHD_LATENCY_MS (default 0) delays every READ, WRITE and CLOSE reply, in order, to simulate the ping to a real server.
// The sha256sum exec only hashes a file that `local()` maps into the SFTP root; the path is never executed.
import { createHash } from 'node:crypto';
import { chmodSync, closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmdirSync, statSync, unlinkSync, utimesSync, writeFileSync, writeSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ssh2 from 'ssh2';
import { CONTAINERS, DEMO_TOTP, IMAGES, NETWORKS, VOLUMES, inspect, seedSftp } from './fixtures.mjs';

const { Server, utils } = ssh2;
const { STATUS_CODE, flagsToString } = utils.sftp;
const RUN_DIR = process.env.SHELLHERD_RUN_DIR ?? path.join(os.tmpdir(), 'shellherd-run');
const prompt = 'demo@web-01:~$ ';
const motd = 'Welcome to Ubuntu 24.04 LTS (GNU/Linux 6.8.0-45-generic x86_64)\r\n\r\nLast login: Mon Oct 19 09:12:44 2026 from 10.0.0.8\r\n';
const outputs = {
  'uptime': ' 14:32:07 up 12 days,  3:41,  1 user,  load average: 0.08, 0.12, 0.10',
  'df -h /': 'Filesystem      Size  Used Avail Use% Mounted on\r\n/dev/sda1        78G   31G   44G  42% /',
  'systemctl status nginx --no-pager | head -3': '\x1b[32m●\x1b[0m nginx.service - A high performance web server\r\n     Loaded: loaded (/lib/systemd/system/nginx.service; enabled)\r\n     Active: \x1b[32mactive (running)\x1b[0m since Fri 2026-10-16 08:02:11 CEST',
  'docker ps --format "table {{.Names}}\\t{{.Status}}"': 'NAMES          STATUS\r\napi            Up 3 days\r\nworker         Up 3 days\r\nredis          Up 9 days',
  'cat ~/LIESMICH': 'Handbuch: https://intranet.demo/handbuch\r\nStatus:   https://status.intranet.demo/',
};

const LISTS = { containers: CONTAINERS, images: IMAGES, volumes: VOLUMES, networks: NETWORKS };
const HOME = '/home/demo';
const LATENCY = Number(process.env.SSHD_LATENCY_MS ?? 0);
const later = run => (LATENCY ? setTimeout(run, LATENCY) : run());

const enoent = () => Object.assign(new Error('outside root'), { code: 'ENOENT' });
// Maps a remote path to a local one; anything that could leave the root (Windows separators, drive letters, `..`) is "not found".
const localPath = (root, p) => {
  if (/[\\:]/.test(p)) throw enoent();
  const full = path.join(root, path.posix.normalize(`/${p}`));
  if (full !== root && !full.startsWith(root + path.sep)) throw enoent();
  return full;
};

/** Answers an exec command by matching known substrings; nothing from the command is ever run or used as a path. */
function execReply(command, kubeconfig, root) {
  if (command.includes('for c in docker podman pct qm')) return { out: 'has:docker\n', code: 0 };
  const marker = /\[terminus-list-[0-9a-f]{16}\]/.exec(command)?.[0];
  if (marker) {
    let out = '';
    let err = '';
    for (const [kind, rows] of Object.entries(LISTS)) {
      out += `${rows.map(row => `${JSON.stringify(row)}\n`).join('')}\n${marker}:${kind}:0\n`;
      err += `\n${marker}:${kind}:0\n`;
    }
    return { out, err, code: 0 };
  }
  const ref = /docker container inspect ([A-Za-z0-9_.-]+)\s*$/.exec(command)?.[1];
  if (ref) {
    const found = inspect(ref);
    return found ? { out: JSON.stringify(found, null, 2), code: 0 } : { err: `Error: No such container: ${ref}\n`, code: 1 };
  }
  const word = /^sh -c 'sha256sum -- "\$1" 2>\/dev\/null \|\| shasum -a 256 -- "\$1"' sh ('(?:[^']|'\\'')*'|[A-Za-z0-9_.\/:=@%+,-]+)$/.exec(command)?.[1];
  if (word) {
    const p = word.startsWith("'") ? word.slice(1, -1).replaceAll("'\\''", "'") : word;
    try { return { out: `${createHash('sha256').update(readFileSync(localPath(root, p))).digest('hex')}  ${p}\n`, code: 0 }; }
    catch { return { err: `sha256sum: ${p}: No such file or directory\n`, code: 1 }; }
  }
  if (command.includes('KUBECONFIG%%')) return { out: kubeconfig ? `src:${HOME}/.kube/config\n${kubeconfig}` : 'src:none\n', code: 0 };
  return { err: `sh: 1: ${command.trim().split(/\s+/)[0]}: not found\n`, code: 127 };
}

function sftpHandler(sftp, root) {
  const attrs = info => ({ mode: (info.mode & 0o170000) | (info.isDirectory() ? 0o755 : 0o644), uid: 0, gid: 0, size: info.size, atime: Math.floor(info.atimeMs / 1000), mtime: Math.floor(info.mtimeMs / 1000) });
  const local = p => localPath(root, p);
  const handles = new Map();
  let next = 0;
  const handle = value => { const id = next++; handles.set(id, value); const buffer = Buffer.alloc(4); buffer.writeUInt32BE(id); return buffer; };
  const lookup = buffer => handles.get(buffer.readUInt32BE(0));
  const guard = (reqid, run) => {
    try { run(); } catch (error) { sftp.status(reqid, error?.code === 'ENOENT' ? STATUS_CODE.NO_SUCH_FILE : STATUS_CODE.FAILURE); }
  };
  const ok = reqid => sftp.status(reqid, STATUS_CODE.OK);
  sftp.on('REALPATH', (reqid, p) => {
    const resolved = p === '.' || p === '' ? HOME : path.posix.normalize(`/${p}`).replace(/^\/+/, '/');
    sftp.name(reqid, [{ filename: resolved, longname: resolved, attrs: {} }]);
  });
  sftp.on('STAT', (reqid, p) => guard(reqid, () => sftp.attrs(reqid, attrs(statSync(local(p))))));
  sftp.on('LSTAT', (reqid, p) => guard(reqid, () => sftp.attrs(reqid, attrs(lstatSync(local(p))))));
  sftp.on('FSTAT', (reqid, buffer) => guard(reqid, () => sftp.attrs(reqid, attrs(fstatSync(lookup(buffer).fd)))));
  sftp.on('OPENDIR', (reqid, p) => guard(reqid, () => { statSync(local(p)); sftp.handle(reqid, handle({ dir: local(p) })); }));
  sftp.on('READDIR', (reqid, buffer) => {
    const entry = lookup(buffer);
    if (!entry?.dir) { sftp.status(reqid, STATUS_CODE.FAILURE); return; }
    if (entry.done) { sftp.status(reqid, STATUS_CODE.EOF); return; }
    entry.done = true;
    guard(reqid, () => sftp.name(reqid, readdirSync(entry.dir).map(name => ({ filename: name, longname: name, attrs: attrs(lstatSync(path.join(entry.dir, name))) }))));
  });
  sftp.on('OPEN', (reqid, p, flags) => guard(reqid, () => sftp.handle(reqid, handle({ fd: openSync(local(p), flagsToString(flags)) }))));
  sftp.on('READ', (reqid, buffer, offset, length) => later(() => guard(reqid, () => {
    const data = Buffer.alloc(length);
    const read = readSync(lookup(buffer).fd, data, 0, length, offset);
    if (read) sftp.data(reqid, data.subarray(0, read)); else sftp.status(reqid, STATUS_CODE.EOF);
  })));
  sftp.on('WRITE', (reqid, buffer, offset, data) => later(() => guard(reqid, () => { writeSync(lookup(buffer).fd, data, 0, data.length, offset); ok(reqid); })));
  sftp.on('CLOSE', (reqid, buffer) => later(() => { const entry = lookup(buffer); if (entry?.fd !== undefined) closeSync(entry.fd); handles.delete(buffer.readUInt32BE(0)); ok(reqid); }));
  sftp.on('MKDIR', (reqid, p) => guard(reqid, () => { mkdirSync(local(p)); ok(reqid); }));
  sftp.on('RMDIR', (reqid, p) => guard(reqid, () => { rmdirSync(local(p)); ok(reqid); }));
  sftp.on('REMOVE', (reqid, p) => guard(reqid, () => { unlinkSync(local(p)); ok(reqid); }));
  sftp.on('RENAME', (reqid, from, to) => guard(reqid, () => { renameSync(local(from), local(to)); ok(reqid); }));
  sftp.on('SETSTAT', (reqid, p, changes) => guard(reqid, () => {
    if (changes.mode !== undefined) chmodSync(local(p), changes.mode);
    if (changes.mtime !== undefined) utimesSync(local(p), changes.atime ?? changes.mtime, changes.mtime);
    ok(reqid);
  }));
}

/** Echoing shell emulation; pending = bytes that arrived with the previous step and belong to this shell. */
function serveShell(stream, { prompt, banner }, pending = '') {
  let line = '';
  const feed = data => {
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
        // Delayed reply: the prompt comes back only after the output, like a slow command.
        if (command === 'sleep 3; echo fertig') { setTimeout(() => { if (stream.writable) stream.write(`fertig\r\n${prompt}`); }, 3000); continue; }
        // cd prints nothing in a real shell; the fake keeps its prompt.
        if (command &&!/^cd(\s|$)/.test(command)) stream.write(`${outputs[command] ?? `${command.split(' ')[0]}: command not found`}\r\n`);
        stream.write(prompt);
      } else if (char === '\x7f') {
        if (line) { line = line.slice(0, -1); stream.write('\b \b'); }
      } else {
        line += char;
        stream.write(char);
      }
    }
  };
  stream.write(banner + prompt);
  stream.on('data', feed);
  if (pending) feed(pending);
}

/** Root shell of the exec `sh -c '… sudo -p MARKER -v … printf %s READY … sudo -n -i'`: marker prompt (no echo), then READY and a root shell. */
function serveRootShell(stream, command) {
  const marker = /\[terminus-sudo-[0-9a-f]{16}\]/.exec(command)[0];
  const ready = /\[terminus-ready-[0-9a-f]{16}\]/.exec(command)[0];
  // Two writes, so the app has to detect the marker across chunks.
  const ask = () => { stream.write(marker.slice(0, 9)); stream.write(marker.slice(9)); };
  let buffer = '';
  const onData = data => {
    buffer += data.toString();
    const end = buffer.indexOf('\n');
    if (end === -1) return;
    const attempt = buffer.slice(0, end).replace(/\r$/, '');
    const rest = buffer.slice(end + 1);
    buffer = '';
    if (attempt !== 'synthetic-demo') { stream.write('\r\nSorry, try again.\r\n'); ask(); return; }
    stream.off('data', onData);
    stream.write('\r\n');
    stream.write(ready);
    serveShell(stream, { prompt: 'root@web-01:~# ', banner: '' }, rest);
  };
  stream.on('data', onData);
  ask();
}

/** Host key persists in the run folder, otherwise known-hosts.json in the profile rejects every restart. */
function loadHostKey(dir) {
  const file = path.join(dir, 'sshd-host-key');
  if (existsSync(file)) return readFileSync(file);
  mkdirSync(dir, { recursive: true });
  const key = utils.generateKeyPairSync('ed25519').private;
  writeFileSync(file, key, { mode: 0o600 });
  return key;
}

export async function startSshd({ port = 2222, dir = RUN_DIR, sftpRoot = path.join(dir, 'sftp'), kubeconfig, kubePort } = {}) {
  const hostKey = loadHostKey(dir);
  seedSftp(sftpRoot);
  const clients = new Set();
  const sockets = new Set();
  const track = socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); return socket; };
  // Helper targets for tcpip: a TCP echo and a one-page HTTP server, both on loopback with a free port.
  const echo = net.createServer(socket => { track(socket).on('error', () => {}).pipe(socket); });
  const intranet = http.createServer((request, response) => response.end('<!doctype html><title>Intranet</title><h1>Synthetic intranet page</h1>\n'));
  intranet.on('connection', track);
  await Promise.all([echo, intranet].map(helper => new Promise((resolve, reject) => { helper.once('error', reject); helper.listen(0, '127.0.0.1', resolve); })));
  // Looked up per connection: internal-01:22 is this server itself, so its port is only known after listen.
  const targets = () => ({
    'k8s-cp1:6443': kubePort,
    'internal-01:22': server.address().port,
    'db-internal:5432': echo.address().port,
    'intranet.demo:80': intranet.address().port,
  });
  const server = new Server({ hostKeys: [hostKey] }, client => {
    clients.add(client);
    client.on('close', () => clients.delete(client));
    client.on('authentication', context => {
      if (context.username === 'mfa') {
        // Only keyboard-interactive: round 1 the password, round 2 the one-time code. Other methods are refused.
        if (context.method !== 'keyboard-interactive') return context.reject(['keyboard-interactive']);
        return context.prompt([{ prompt: 'Password: ', echo: false }], answers => {
          if (!Array.isArray(answers) || answers[0] !== 'synthetic-demo') return context.reject();
          context.prompt([{ prompt: 'Verification code: ', echo: false }], code => {
            if (Array.isArray(code) && code[0] === DEMO_TOTP) context.accept(); else context.reject();
          });
        });
      }
      if (context.method === 'password' && context.username === 'demo' && context.password === 'synthetic-demo') context.accept();
      else context.reject(['password']);
    });
    // Only the targets above, relayed to their servers; anything else is refused.
    client.on('tcpip', (accept, reject, info) => {
      const target = targets()[`${info.destIP}:${info.destPort}`];
      if (!target) return reject();
      const socket = net.connect(target, '127.0.0.1');
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      socket.once('error', () => reject());
      socket.once('connect', () => {
        const channel = accept();
        socket.removeAllListeners('error');
        socket.on('error', () => channel.destroy());
        channel.on('error', () => socket.destroy());
        channel.pipe(socket).pipe(channel);
        channel.on('close', () => socket.destroy());
        socket.on('close', () => channel.destroy());
      });
    });
    // Remote forwards only on loopback; the fake opens no real listener.
    client.on('request', (accept, reject, name, info) => {
      if (name === 'cancel-tcpip-forward') return accept();
      if (name === 'tcpip-forward' && ['localhost', '127.0.0.1'].includes(info.bindAddr)) return accept();
      reject();
    });
    client.on('ready', () => client.on('session', accept => {
      const session = accept();
      session.on('pty', ok => ok?.()).on('window-change', ok => ok?.()).on('env', ok => ok?.());
      session.on('sftp', acceptSftp => sftpHandler(acceptSftp(), sftpRoot));
      session.on('exec', (acceptExec, _reject, { command }) => {
        const stream = acceptExec();
        if (/\[terminus-sudo-[0-9a-f]{16}\]/.test(command) && /\[terminus-ready-[0-9a-f]{16}\]/.test(command) && command.includes('sudo -n -i')) { serveRootShell(stream, command); return; }
        const { out, err, code } = execReply(command, kubeconfig, sftpRoot);
        if (out) stream.write(out);
        if (err) stream.stderr.write(err);
        stream.exit(code);
        stream.end();
      });
      session.on('shell', acceptShell => serveShell(acceptShell(), { prompt, banner: motd }));
    })).on('error', () => {});
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return {
    port: server.address().port,
    close: () => new Promise(resolve => {
      for (const client of clients) client.end();
      for (const socket of sockets) socket.destroy();
      Promise.all([server, echo, intranet].map(s => new Promise(done => s.close(() => done())))).then(() => resolve());
    }),
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  // Dynamic imports: the fakes belong to other tasks and a missing one must not stop the SSH server.
  let kube;
  try {
    const { startKubeFake } = await import('./kube-fake.mjs');
    kube = await startKubeFake({ port: Number(process.env.KUBE_FAKE_PORT ?? 9334), dir: path.join(RUN_DIR, 'kube') });
  } catch (error) { console.warn(`Kubernetes-Fake übersprungen: ${error.message}`); }
  const { startAiFake } = await import('./ai-fake.mjs');
  const ai = await startAiFake({ port: Number(process.env.AI_FAKE_PORT ?? 9335) });
  const sshd = await startSshd({ port: Number(process.env.SSHD_PORT ?? 2222), dir: RUN_DIR, kubeconfig: kube?.kubeconfig, kubePort: kube?.port });
  console.log(`sshd ready on ${sshd.port} (demo / synthetic-demo; mfa: Passwort und Code)`);
  if (kube) console.log(`kube-fake ready on ${kube.port}`);
  console.log(`ai-fake ready on ${ai.port}`);
}
