import { describe, expect, it } from 'vitest';
import type { InventoryKind, InventoryRow } from '../../shared/containers';
import {
  linkUsage, maskInspect, normalizeImageRef, parseContainerRows, parseDockerSize, parseDockerTime, parseImageRows, parseLabels,
  parseNetworkRows, parseVolumeRows, podmanPorts,
} from './inventory-parsers';

const ID_A = 'a'.repeat(64);
const ID_B = 'b'.repeat(64);
const lines = (...items: unknown[]): string => items.map(item => JSON.stringify(item)).join('\n');

const dockerPs = (extra: Record<string, unknown> = {}) => ({
  ID: ID_A, Names: 'web-1', State: 'running', Status: 'Up 2 hours (healthy)', Image: 'nginx', Ports: '0.0.0.0:8080->80/tcp',
  Labels: 'com.docker.compose.project=shop,a=b', CreatedAt: '2026-10-18 10:00:00 +0200 CEST', Mounts: 'pgdata,/srv/www', Networks: 'shop_default,bridge', ...extra,
});

describe('parseDockerSize', () => {
  it('reads all decimal units', () => {
    expect(parseDockerSize('142MB')).toBe(142_000_000);
    expect(parseDockerSize('1.2GB')).toBe(1_200_000_000);
    expect(parseDockerSize('10.5kB')).toBe(10_500);
    expect(parseDockerSize('3KB')).toBe(3000);
    expect(parseDockerSize('2TB')).toBe(2e12);
    expect(parseDockerSize('0B')).toBe(0);
    expect(parseDockerSize(4096)).toBe(4096);
  });
  it('returns null for garbage', () => {
    for (const value of ['', 'abc', '12XB', '-1MB', null, undefined, {}, NaN]) expect(parseDockerSize(value)).toBeNull();
  });
});

describe('parseDockerTime', () => {
  it('converts the Docker format with zone names', () => {
    expect(parseDockerTime('2026-10-18 10:00:00 +0200 CEST')).toBe('2026-10-18T08:00:00.000Z');
    expect(parseDockerTime('2026-10-18 10:00:00 +0000 UTC')).toBe('2026-10-18T10:00:00.000Z');
    expect(parseDockerTime('2026-10-18 10:00:00 +0530 +0530')).toBe('2026-10-18T04:30:00.000Z');
  });
  it('handles Unix seconds, milliseconds and ISO', () => {
    expect(parseDockerTime(1_760_000_000)).toBe(new Date(1_760_000_000_000).toISOString());
    expect(parseDockerTime(1_760_000_000_000)).toBe(new Date(1_760_000_000_000).toISOString());
    expect(parseDockerTime('2026-10-18T08:00:00.000Z')).toBe('2026-10-18T08:00:00.000Z');
  });
  it('returns an empty string for garbage', () => {
    for (const value of ['', 'nope', null, undefined, {}, NaN, 0]) expect(parseDockerTime(value)).toBe('');
  });
});

describe('parseLabels and podmanPorts', () => {
  it('reads string and object labels', () => {
    expect(parseLabels('a=b,c=d=e,broken')).toEqual({ a: 'b', c: 'd=e' });
    expect(parseLabels({ a: 'b', n: 1, o: null })).toEqual({ a: 'b', n: '1' });
    expect(parseLabels(undefined)).toEqual({});
    expect(parseLabels(5)).toEqual({});
  });
  it('does not let a __proto__ label touch the prototype', () => {
    expect(Object.getPrototypeOf(parseLabels('__proto__=x'))).toBe(Object.prototype);
  });
  it('formats Podman ports', () => {
    expect(podmanPorts([{ host_ip: '', host_port: 8080, container_port: 80, protocol: 'tcp' }, { container_port: 443, protocol: 'tcp' }]))
      .toBe('0.0.0.0:8080->80/tcp, 443/tcp');
    expect(podmanPorts(null)).toBe('');
    expect(podmanPorts('x')).toBe('');
  });
});

describe('normalizeImageRef', () => {
  it('normalises registry prefix and tag', () => {
    expect(normalizeImageRef('nginx')).toBe('nginx:latest');
    expect(normalizeImageRef('docker.io/library/nginx:latest')).toBe('nginx:latest');
    expect(normalizeImageRef('docker.io/user/app')).toBe('user/app:latest');
    expect(normalizeImageRef('registry:5000/a/b')).toBe('registry:5000/a/b:latest');
    expect(normalizeImageRef('nginx@sha256:abc')).toBe('nginx@sha256:abc');
  });
});

describe('parseContainerRows', () => {
  it('parses Docker JSON lines, skipping broken lines and non-objects', () => {
    const text = `${lines(dockerPs())}\nnot json\n42\n${lines(dockerPs({ ID: ID_B, Names: 'db', State: 'exited', Status: 'Exited (137) 3 minutes ago', Labels: '' }))}\n`;
    const rows = parseContainerRows('docker', text);
    expect(rows).toHaveLength(2);
    const [web, db] = rows;
    expect(web.uid).toBe(`docker:containers:${ID_A}`);
    expect(web.ref).toEqual({ kind: 'containers', runtime: 'docker', ref: 'web-1' });
    expect(web.state).toBe('running');
    expect(web.tone).toBe('ok');
    expect(web.project).toBe('shop');
    expect(web.cells).toMatchObject({
      name: 'web-1', status: 'running', info: 'Up 2 hours (healthy)', image: 'nginx', ports: '0.0.0.0:8080->80/tcp', project: 'shop', pod: '',
      networks: 'shop_default, bridge', created: '2026-10-18T08:00:00.000Z',
    });
    expect(web.links).toEqual({ image: 'nginx', imageId: '', mounts: ['pgdata', '/srv/www'], networks: ['shop_default', 'bridge'] });
    expect(db.exitCode).toBe(137);
    expect(db.tone).toBe('bad');
    expect(db.project).toBeUndefined();
  });

  it('marks an unhealthy container bad', () => {
    expect(parseContainerRows('docker', lines(dockerPs({ Status: 'Up 1 minute (unhealthy)' })))[0].tone).toBe('bad');
  });

  it('parses a Podman array with pod, ports, infra and exit code', () => {
    const text = JSON.stringify([
      { Id: ID_A, Names: ['api'], State: 'running', Status: 'Up 1 hour', Image: 'localhost/api:dev', ImageID: ID_B, PodName: 'mypod',
        Ports: [{ host_ip: '', host_port: 8080, container_port: 80, protocol: 'tcp' }], Labels: { 'io.podman.compose.project': 'pc', 'com.docker.compose.project': 'dc' },
        Created: 1_760_000_000, Mounts: ['/data'], Networks: ['podman'], ExitCode: 0, IsInfra: false },
      { Id: ID_B, Names: ['mypod-infra'], State: 'running', Image: 'pause', IsInfra: true },
      { Id: 'c'.repeat(64), Names: ['old'], State: 'exited', ExitCode: 2, Image: 'x' },
      { Id: 'd'.repeat(64), Names: ['cfg'], State: 'configured', Image: 'x' },
      { Id: 'e'.repeat(64), Names: ['odd'], State: 'weird', Image: 'x' },
    ]);
    const rows = parseContainerRows('podman', text);
    const byName = Object.fromEntries(rows.map(row => [row.name, row]));
    expect(byName.api.pod).toBe('mypod');
    expect(byName.api.project).toBe('dc');
    expect(byName.api.cells.ports).toBe('0.0.0.0:8080->80/tcp');
    expect(byName.api.links).toEqual({ image: 'localhost/api:dev', imageId: ID_B, mounts: ['/data'], networks: ['podman'] });
    expect(byName.api.cells.created).toBe(new Date(1_760_000_000_000).toISOString());
    expect(byName['mypod-infra'].tone).toBe('muted');
    expect(byName.old).toMatchObject({ exitCode: 2, tone: 'bad' });
    expect(byName.cfg.state).toBe('created');
    expect(byName.odd.state).toBe('unknown');
    expect(byName.odd.tone).toBe('warn');
  });

  it('falls back to the ID as ref when the name is not a valid ref and drops rows without any valid ref', () => {
    const rows = parseContainerRows('docker', lines(dockerPs({ Names: '-weird name' }), dockerPs({ ID: '', Names: '' })));
    expect(rows).toHaveLength(1);
    expect(rows[0].ref.ref).toBe(ID_A);
    expect(rows[0].name).toBe('-weird name');
  });

  it('handles empty and invalid input', () => {
    for (const text of ['', '   ', '[]', '{', '[1,2]', 'null']) expect(parseContainerRows('docker', text)).toEqual([]);
    expect(parseContainerRows('podman', undefined as unknown as string)).toEqual([]);
  });
});

describe('parseImageRows', () => {
  it('gives every Docker tag of one ID its own row and uid', () => {
    const rows = parseImageRows('docker', lines(
      { ID: `sha256:${ID_A}`, Repository: 'nginx', Tag: '1.27', Size: '142MB', CreatedAt: '2026-10-18 10:00:00 +0200 CEST' },
      { ID: `sha256:${ID_A}`, Repository: 'nginx', Tag: 'latest', Size: '142MB' },
    ));
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map(row => row.uid)).size).toBe(2);
    expect(rows[0].uid).toBe(`docker:images:${ID_A}@nginx:1.27`);
    expect(rows[0].ref.ref).toBe('nginx:1.27');
    expect(rows[0].id).toBe(ID_A);
    expect(rows[0].cells).toMatchObject({ repository: 'nginx', tag: '1.27', id: 'a'.repeat(12), size: 142_000_000, usedBy: '', created: '2026-10-18T08:00:00.000Z' });
  });

  it('uses the ID without prefix as ref for dangling images', () => {
    const [row] = parseImageRows('docker', lines({ ID: `sha256:${ID_A}`, Repository: '<none>', Tag: '<none>', Size: '1.2GB' }));
    expect(row.ref.ref).toBe(ID_A);
    expect(row.uid).toBe(`docker:images:${ID_A}`);
    expect(row.name).toBe('a'.repeat(12));
    expect(row.cells).toMatchObject({ repository: '', tag: '' });
    expect(row.tone).toBe('muted');
  });

  it('falls back to the ID for a tag that IMAGE_NAME_TAG rejects', () => {
    const [row] = parseImageRows('docker', lines({ ID: `sha256:${ID_A}`, Repository: 'My__App', Tag: 'v1' }));
    expect(row.ref.ref).toBe(ID_A);
    expect(row.name).toBe('My__App:v1');
  });

  it('creates one Podman row per name, splitting at the last colon after the last slash', () => {
    const rows = parseImageRows('podman', JSON.stringify([
      { Id: `sha256:${ID_A}`, Names: ['registry:5000/a/b:v1', 'localhost/app:dev'], Size: 1000, Created: 1_760_000_000, Containers: 2 },
      { Id: ID_B, Names: null, Size: 5, Containers: 0 },
    ]));
    expect(rows).toHaveLength(3);
    expect(rows[0].cells).toMatchObject({ repository: 'registry:5000/a/b', tag: 'v1', size: 1000, usedBy: 2 });
    expect(rows[0].uid).not.toBe(rows[1].uid);
    expect(rows[1].ref.ref).toBe('localhost/app:dev');
    expect(rows[1].usedBy).toBe(2);
    expect(rows[2].ref.ref).toBe(ID_B);
    expect(rows[2].tone).toBe('muted');
  });

  it('handles empty input', () => {
    expect(parseImageRows('docker', '')).toEqual([]);
    expect(parseImageRows('podman', '[]')).toEqual([]);
  });
});

describe('parseVolumeRows', () => {
  it('parses Docker volumes without created and drops invalid names', () => {
    const rows = parseVolumeRows('docker', lines({ Name: 'pgdata', Driver: 'local', Mountpoint: '/var/lib/docker/volumes/pgdata/_data' }, { Name: '-bad' }, { Name: 'a b' }));
    expect(rows).toHaveLength(1);
    expect(rows[0].uid).toBe('docker:volumes:pgdata');
    expect(rows[0].cells).toMatchObject({ name: 'pgdata', driver: 'local', created: '', usedBy: '' });
    expect(rows[0].usedBy).toBeUndefined();
  });
  it('reads Podman MountCount and CreatedAt', () => {
    const rows = parseVolumeRows('podman', JSON.stringify([
      { Name: 'a', Driver: 'local', Mountpoint: '/x', CreatedAt: '2026-10-18T08:00:00Z', MountCount: 0 },
      { Name: 'b', Driver: 'local' },
    ]));
    expect(rows[0]).toMatchObject({ usedBy: 0, tone: 'muted' });
    expect(rows[0].cells.created).toBe('2026-10-18T08:00:00.000Z');
    expect(rows[1].usedBy).toBeUndefined();
  });
});

describe('parseNetworkRows', () => {
  it('parses Docker networks', () => {
    const [row] = parseNetworkRows('docker', lines({ ID: 'abc123def456', Name: 'bridge', Driver: 'bridge', Scope: 'local', Internal: 'false', CreatedAt: '2026-10-18 10:00:00 +0200 CEST' }));
    expect(row.uid).toBe('docker:networks:abc123def456');
    expect(row.ref.ref).toBe('bridge');
    expect(row.cells).toMatchObject({ driver: 'bridge', scope: 'local', internal: 'nein', containers: '', created: '2026-10-18T08:00:00.000Z' });
    expect(row.tone).toBe('ok');
  });
  it('reads Podman lowercase keys', () => {
    const rows = parseNetworkRows('podman', JSON.stringify([{ name: 'podman', id: ID_A, driver: 'bridge', internal: true, created: '2026-10-18T08:00:00Z' }, { name: 'x', id: ID_B, internal: 'false' }, 'junk']));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: 'podman', id: ID_A });
    expect(rows[0].cells).toMatchObject({ internal: 'ja', scope: '', created: '2026-10-18T08:00:00.000Z' });
    expect(rows[1].cells.internal).toBe('nein');
  });
  it('falls back to the ID as ref and drops rows without a valid ref', () => {
    const rows = parseNetworkRows('docker', lines({ ID: 'abc123def456', Name: '-x' }, { ID: '', Name: '-y' }));
    expect(rows).toHaveLength(1);
    expect(rows[0].ref.ref).toBe('abc123def456');
  });
});

const rowsOf = (partial: Partial<Record<InventoryKind, InventoryRow[]>>): Record<InventoryKind, InventoryRow[]> =>
  ({ containers: [], images: [], volumes: [], networks: [], ...partial });

describe('linkUsage', () => {
  const containers = (...images: string[]) => parseContainerRows('docker', lines(...images.map((image, index) =>
    dockerPs({ ID: String(index).repeat(64), Names: `c${index}`, Image: image, Mounts: index === 0 ? 'pgdata' : '', Networks: index === 0 ? 'shop_default' : '' }))));
  const images = () => parseImageRows('docker', lines(
    { ID: `sha256:${ID_A}`, Repository: 'nginx', Tag: 'latest' },
    { ID: `sha256:${ID_B}`, Repository: 'redis', Tag: '7' },
    { ID: `sha256:${'c'.repeat(64)}`, Repository: '<none>', Tag: '<none>' },
  ));

  it('matches image references after normalisation and ID prefixes, each container once', () => {
    const out = linkUsage('docker', rowsOf({ containers: containers('nginx', 'docker.io/library/nginx:latest', 'aaaaaaaaaaaa', 'redis:7'), images: images() }));
    const [nginx, redis, dangling] = out.images;
    expect(nginx.usedBy).toBe(3);
    expect(nginx.cells.usedBy).toBe(3);
    expect(nginx.tone).toBe('ok');
    expect(redis.usedBy).toBe(1);
    expect(dangling.usedBy).toBe(0);
    expect(dangling.tone).toBe('muted');
  });

  it('counts volumes through Mounts and networks through Networks', () => {
    const vols = parseVolumeRows('docker', lines({ Name: 'pgdata' }, { Name: 'other' }));
    const nets = parseNetworkRows('docker', lines({ ID: 'n1', Name: 'shop_default' }, { ID: 'n2', Name: 'lonely' }));
    const out = linkUsage('docker', rowsOf({ containers: containers('x', 'y'), volumes: vols, networks: nets }));
    expect(out.volumes.map(row => row.usedBy)).toEqual([1, 0]);
    expect(out.volumes[1].tone).toBe('muted');
    expect(out.networks.map(row => row.usedBy)).toEqual([1, 0]);
    expect(out.networks[0].cells.containers).toBe(1);
  });

  it('keeps Podman image and volume counts and leaves unknown values undefined', () => {
    const imgs = parseImageRows('podman', JSON.stringify([{ Id: ID_A, Names: ['a:1'], Containers: 4 }]));
    const vols = parseVolumeRows('podman', JSON.stringify([{ Name: 'v' }, { Name: 'w', MountCount: 2 }]));
    const out = linkUsage('podman', rowsOf({ images: imgs, volumes: vols }));
    expect(out.images[0].usedBy).toBe(4);
    expect(out.volumes[0].usedBy).toBeUndefined();
    expect(out.volumes[0].cells.usedBy).toBe('');
    expect(out.volumes[1].usedBy).toBe(2);
  });

  it('leaves everything unknown when containers are not known', () => {
    const out = linkUsage('docker', rowsOf({
      images: images(), volumes: parseVolumeRows('docker', lines({ Name: 'pgdata' })),
      networks: parseNetworkRows('docker', lines({ ID: 'n1', Name: 'bridge' })),
    }), false);
    for (const row of [...out.images, ...out.volumes, ...out.networks]) expect(row.usedBy).toBeUndefined();
    expect(out.images[0].cells.usedBy).toBe('');
    expect(out.networks[0].cells.containers).toBe('');
  });

  it('is pure', () => {
    const input = rowsOf({ containers: containers('nginx'), images: images() });
    linkUsage('docker', input);
    expect(input.images[0].usedBy).toBeUndefined();
    expect(input.images[0].cells.usedBy).toBe('');
  });
});

describe('maskInspect', () => {
  it('masks secret names in Config.Env and ContainerConfig.Env only', () => {
    const input = JSON.stringify([{
      Config: { Env: ['PATH=/usr/bin', 'HOME=/root', 'DB_PASSWORD=hunter2', 'API_KEY=k', 'my_token=t', 'NOEQUALS'], Cmd: ['run', '--password=x'], Labels: { token: 'keep' } },
      ContainerConfig: { Env: ['SECRET_X=1', 'OK=1'] },
      Mounts: [{ Source: '/secret' }],
    }, { Config: { Env: ['PWD=/x'] } }]);
    const out = JSON.parse(maskInspect(input));
    expect(out[0].Config.Env).toEqual(['PATH=/usr/bin', 'HOME=/root', 'DB_PASSWORD=***', 'API_KEY=***', 'my_token=***', 'NOEQUALS']);
    expect(out[0].Config.Cmd).toEqual(['run', '--password=x']);
    expect(out[0].Config.Labels).toEqual({ token: 'keep' });
    expect(out[0].ContainerConfig.Env).toEqual(['SECRET_X=***', 'OK=1']);
    expect(out[0].Mounts).toEqual([{ Source: '/secret' }]);
    expect(out[1].Config.Env).toEqual(['PWD=***']);
  });
  it('indents with two spaces', () => {
    expect(maskInspect('[{"a":1}]')).toBe('[\n  {\n    "a": 1\n  }\n]');
  });
  it('leaves Env elsewhere untouched', () => {
    const out = JSON.parse(maskInspect(JSON.stringify({ Other: { Env: ['TOKEN=x'] } })));
    expect(out.Other.Env).toEqual(['TOKEN=x']);
  });
  it('returns unparsable input without env entries unchanged', () => {
    for (const text of ['', 'not json', '{"a":']) expect(maskInspect(text)).toBe(text);
  });
  it('masks secret env entries in unparsable input', () => {
    const text = 'WARNING: something odd\n[{"Config":{"Env":["PATH=/usr/bin","DB_PASSWORD=geheim","API_KEY=abc def"]}\nSECRET_X=1';
    const out = maskInspect(text);
    expect(out).toContain('"DB_PASSWORD=***"');
    expect(out).toContain('"API_KEY=***"');
    expect(out).toContain('\nSECRET_X=***');
    expect(out).toContain('"PATH=/usr/bin"');
    expect(out).toContain('WARNING: something odd');
    expect(out).not.toContain('geheim');
  });
});
