// Synthetic Docker inventory and SFTP tree for the local SSH test server. Nothing here is real data.
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const hex = seed => createHash('sha256').update(seed).digest('hex');
const COMPOSE = 'com.docker.compose.project=shop';
const when = (day, time) => `2026-10-${day} ${time} +0200 CEST`;

const container = (name, image, state, status, extra = {}) => ({
  ID: hex(`container-${name}`), Names: name, Image: image, ImageID: `sha256:${hex(`image-${image}`)}`, State: state, Status: status,
  Labels: '', Ports: '', CreatedAt: when(18, '10:00:00'), Size: '0B (virtual 142MB)', Mounts: '', Networks: 'shop_default', ...extra,
});

export const CONTAINERS = [
  container('api', 'shop/api:1.8.2', 'running', 'Up 3 days', { Labels: `${COMPOSE},com.docker.compose.service=api`, Ports: '0.0.0.0:8080->8080/tcp', Size: '142MB' }),
  container('worker', 'shop/worker:1.8.2', 'running', 'Up 3 days', { Labels: `${COMPOSE},com.docker.compose.service=worker`, Size: '98MB' }),
  container('redis', 'redis:7-alpine', 'running', 'Up 9 days', { Labels: `${COMPOSE},com.docker.compose.service=redis`, Ports: '6379/tcp', Size: '12MB' }),
  container('db', 'postgres:16', 'running', 'Up 9 days', { Labels: `${COMPOSE},com.docker.compose.service=db`, Ports: '0.0.0.0:5432->5432/tcp', Mounts: 'pgdata', Size: '63MB' }),
  container('migrate', 'shop/api:1.8.2', 'exited', 'Exited (0) 2 hours ago', { CreatedAt: when(20, '08:00:00'), Networks: '' }),
  container('cron-legacy', 'shop/legacy:0.9', 'exited', 'Exited (137) 3 days ago', { CreatedAt: when(10, '03:00:00'), Networks: 'bridge' }),
];

const image = (repository, tag, size, createdAt) => ({ ID: `sha256:${hex(`image-${repository}:${tag}`)}`, Repository: repository, Tag: tag, Size: size, CreatedAt: createdAt });
export const IMAGES = [
  image('shop/api', '1.8.2', '142MB', when(15, '09:00:00')),
  image('shop/worker', '1.8.2', '98MB', when(15, '09:05:00')),
  image('redis', '7-alpine', '41.2MB', when(1, '12:00:00')),
  image('postgres', '16', '438MB', when(2, '12:00:00')),
  image('<none>', '<none>', '142MB', when(12, '09:00:00')),
];

const volume = (name, labels = '') => ({ Name: name, Driver: 'local', Mountpoint: `/var/lib/docker/volumes/${name}/_data`, Labels: labels });
export const VOLUMES = [volume('pgdata', 'com.docker.compose.project=shop'), volume('redisdata', 'com.docker.compose.project=shop'), volume('old-cache')];

const network = (name, driver, labels = '') => ({ ID: hex(`network-${name}`).slice(0, 12), Name: name, Driver: driver, Scope: 'local', Internal: false, CreatedAt: when(1, '12:00:00'), Labels: labels });
export const NETWORKS = [network('bridge', 'bridge'), network('host', 'host'), network('shop_default', 'bridge', 'com.docker.compose.project=shop')];

/** `docker container inspect <ref>` result: an array with one object, or undefined for an unknown ref. */
export function inspect(ref) {
  const row = CONTAINERS.find(c => c.Names === ref || c.ID.startsWith(ref));
  if (!row) return undefined;
  const running = row.State === 'running';
  return [{
    Id: row.ID, Name: `/${row.Names}`, Created: '2026-10-18T08:00:00.000000000Z',
    State: { Status: row.State, Running: running, StartedAt: '2026-10-17T08:00:00.000000000Z' },
    Config: { Image: row.Image, Env: ['NODE_ENV=production'] },
    Mounts: row.Mounts ? [{ Type: 'volume', Name: row.Mounts, Destination: '/var/lib/data', RW: true }] : [],
    NetworkSettings: { Networks: row.Networks ? { [row.Networks]: { IPAddress: '172.18.0.2' } } : {} },
  }];
}

const files = {
  'home/demo/.bashrc': '# ~/.bashrc\nexport PS1="\\u@\\h:\\w\\$ "\nalias ll="ls -la"\n',
  'home/demo/.profile': '# ~/.profile\n[ -f ~/.bashrc ] && . ~/.bashrc\n',
  'home/demo/notes.md': '# Notes\n\n- rotate logs\n- renew certificate\n- check disk usage on /var\n',
  'home/demo/www/index.html': '<!doctype html>\n<html><head><title>Shop</title></head><body><h1>Shop</h1></body></html>\n',
  'home/demo/www/style.css': 'body { font-family: sans-serif; margin: 2rem; }\nh1 { color: #333; }\n',
  'home/demo/www/app.js': 'document.title = "Shop";\nconsole.log("ready");\n',
  'home/demo/backups/db-2026-10-18.sql.gz': randomBytes(300 * 1024),
  'home/demo/backups/db-2026-10-19.sql.gz': randomBytes(300 * 1024),
  'etc/nginx/nginx.conf': 'worker_processes auto;\nevents { worker_connections 1024; }\nhttp { include /etc/nginx/sites-enabled/*; }\n',
  'etc/nginx/sites-enabled/default': 'server { listen 80; root /home/demo/www; }\n',
  'var/log/nginx/access.log': '127.0.0.1 - - [20/Oct/2026:09:00:00 +0200] "GET / HTTP/1.1" 200 612\n'.repeat(12000),
  'var/log/nginx/error.log': '2026/10/20 09:00:00 [notice] 1#1: signal process started\n',
};

/** Rebuilds the fake server tree under `root` (removing it first). No symlinks, they need developer mode on Windows. */
export function seedSftp(root) {
  rmSync(root, { recursive: true, force: true });
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, ...relative.split('/'));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}
