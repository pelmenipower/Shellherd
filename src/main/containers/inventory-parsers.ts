import { CONTAINER_REF, IMAGE_ID, IMAGE_NAME_TAG, containerTone } from '../../shared/containers';
import type { ContainerRuntime, InventoryKind, InventoryRow, InventoryState, RowTone } from '../../shared/containers';

type Rec = Record<string, unknown>;

/** Docker prints one JSON object per line, Podman a JSON array. Never throws. */
function records(text: string): Rec[] {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (!trimmed) return [];
  const isRecord = (value: unknown): value is Rec => !!value && typeof value === 'object' && !Array.isArray(value);
  if (trimmed.startsWith('[')) {
    try { const parsed: unknown = JSON.parse(trimmed); return Array.isArray(parsed) ? parsed.filter(isRecord) : []; }
    catch { return []; }
  }
  return trimmed.split(/\r?\n/).flatMap(line => {
    try { const parsed: unknown = JSON.parse(line); return isRecord(parsed) ? [parsed] : []; }
    catch { return []; }
  });
}

const str = (value: unknown): string => typeof value === 'string' ? value.trim() : typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
const bare = (id: string): string => id.replace(/^sha256:/, '');
const none = (value: string): string => value === '<none>' ? '' : value;
const list = (value: unknown): string[] => Array.isArray(value) ? value.map(str).filter(Boolean)
  : typeof value === 'string' ? value.split(',').map(entry => entry.trim()).filter(Boolean) : [];

const UNITS: Record<string, number> = { b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12 };
/** '142MB' -> 142_000_000, '1.2GB', '10.5kB', '0B'; decimal (B, kB/KB, MB, GB, TB); numbers pass through; else null. */
export function parseDockerSize(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== 'string') return null;
  const match = /^(\d+(?:\.\d+)?)\s*(B|kB|KB|MB|GB|TB)$/i.exec(value.trim());
  return match ? Math.round(Number(match[1]) * UNITS[match[2].toLowerCase()]) : null;
}

const DOCKER_TIME = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.\d+)? ([+-]\d{2})(\d{2})(?: \S+)?$/;
const iso = (date: Date): string => Number.isNaN(date.getTime()) ? '' : date.toISOString();
/** '2026-10-18 10:00:00 +0200 CEST' -> '2026-10-18T08:00:00.000Z'; Unix seconds (number) -> ISO; ISO stays; else ''. */
export function parseDockerTime(value: unknown): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return '';
    return iso(new Date(value > 1e12 ? value : value * 1000));
  }
  if (typeof value !== 'string') return '';
  const text = value.trim();
  const match = DOCKER_TIME.exec(text);
  if (match) return iso(new Date(`${match[1]}T${match[2]}${match[3]}:${match[4]}`));
  if (!text) return '';
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? '' : iso(new Date(parsed));
}

/** 'a=b,c=d' or an object -> record; anything else -> {}. */
export function parseLabels(value: unknown): Record<string, string> {
  const labels: Record<string, string> = {};
  const set = (key: string, val: string): void => { Object.defineProperty(labels, key, { value: val, enumerable: true, writable: true, configurable: true }); };
  if (typeof value === 'string') {
    for (const part of value.split(',')) {
      const at = part.indexOf('=');
      if (at > 0) set(part.slice(0, at).trim(), part.slice(at + 1));
    }
  } else if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, val] of Object.entries(value)) if (val !== null && val !== undefined && typeof val !== 'object') set(key, String(val));
  }
  return labels;
}

/** Podman Ports[] -> '0.0.0.0:8080->80/tcp, 443/tcp'; not an array -> ''. */
export function podmanPorts(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value.flatMap(entry => {
    if (!entry || typeof entry !== 'object') return [];
    const port = entry as Rec;
    const container = str(port.container_port);
    if (!container) return [];
    const proto = str(port.protocol) || 'tcp';
    const host = str(port.host_port);
    return [host ? `${str(port.host_ip) || '0.0.0.0'}:${host}->${container}/${proto}` : `${container}/${proto}`];
  }).join(', ');
}

/** Strips 'docker.io/', then 'library/', appends ':latest' when the last path part has no tag and no '@'. */
export function normalizeImageRef(ref: string): string {
  let out = ref.trim();
  if (out.startsWith('docker.io/')) out = out.slice('docker.io/'.length);
  if (out.startsWith('library/')) out = out.slice('library/'.length);
  const last = out.slice(out.lastIndexOf('/') + 1);
  return last.includes(':') || last.includes('@') ? out : `${out}:latest`;
}

const STATES: readonly InventoryState[] = ['running', 'exited', 'paused', 'restarting', 'created', 'dead', 'stopped'];
function stateOf(value: unknown): InventoryState {
  const text = str(value).toLowerCase();
  if (text === 'configured' || text === 'initialized') return 'created';
  return (STATES as readonly string[]).includes(text) ? text as InventoryState : 'unknown';
}

function projectOf(labels: Record<string, string>): string {
  return labels['com.docker.compose.project'] || labels['io.podman.compose.project'] || '';
}

export function parseContainerRows(runtime: ContainerRuntime, text: string): InventoryRow[] {
  return records(text).flatMap(r => {
    const id = bare(str(r.ID ?? r.Id));
    const names = Array.isArray(r.Names) ? r.Names.map(str) : str(r.Names).split(',');
    const name = (names[0] ?? '').replace(/^\//, '').trim() || id.slice(0, 12);
    const ref = CONTAINER_REF.test(name) ? name : id;
    if (!CONTAINER_REF.test(ref)) return [];
    const podman = runtime === 'podman';
    const state = stateOf(r.State);
    const info = str(r.Status);
    let exitCode: number | undefined;
    if (podman) {
      if ((state === 'exited' || state === 'stopped') && typeof r.ExitCode === 'number') exitCode = r.ExitCode;
    } else {
      const exited = /^Exited \((-?\d+)\)/.exec(info);
      if (exited) exitCode = Number(exited[1]);
    }
    const labels = parseLabels(r.Labels);
    const project = projectOf(labels);
    const pod = podman ? str(r.PodName) : '';
    const networks = list(r.Networks);
    const tone: RowTone = podman && r.IsInfra === true ? 'muted' : containerTone(state, info, exitCode);
    const row: InventoryRow = {
      uid: `${runtime}:containers:${id || name}`,
      ref: { kind: 'containers', runtime, ref },
      id: id || name,
      name,
      cells: {
        name, status: state, info, image: str(r.Image), ports: podman ? podmanPorts(r.Ports) : str(r.Ports),
        project, pod, networks: networks.join(', '), created: parseDockerTime(podman ? r.Created ?? r.CreatedAt : r.CreatedAt ?? r.Created),
      },
      tone, labels, state,
      links: { image: str(r.Image), imageId: bare(str(r.ImageID)), mounts: list(r.Mounts), networks },
    };
    if (exitCode !== undefined) row.exitCode = exitCode;
    if (project) row.project = project;
    if (pod) row.pod = pod;
    return [row];
  });
}

function imageRow(runtime: ContainerRuntime, id: string, repository: string, tag: string, r: Rec, usedBy: number | undefined): InventoryRow[] {
  const hasTag = !!repository && !!tag;
  const full = hasTag ? `${repository}:${tag}` : '';
  const ref = hasTag && IMAGE_NAME_TAG.test(full) ? full : id;
  if (!IMAGE_ID.test(ref) && !IMAGE_NAME_TAG.test(ref)) return [];
  const size = parseDockerSize(r.Size);
  const row: InventoryRow = {
    uid: `${runtime}:images:${hasTag ? `${id}@${full}` : id}`,
    ref: { kind: 'images', runtime, ref },
    id,
    name: hasTag ? full : id.slice(0, 12),
    cells: {
      repository: hasTag ? repository : none(repository), tag: hasTag ? tag : '', id: id.slice(0, 12), size: size ?? '',
      usedBy: usedBy ?? '', created: parseDockerTime(runtime === 'podman' ? r.Created ?? r.CreatedAt : r.CreatedAt ?? r.Created),
    },
    tone: !hasTag || usedBy === 0 ? 'muted' : 'ok',
    labels: parseLabels(r.Labels),
  };
  if (usedBy !== undefined) row.usedBy = usedBy;
  return [row];
}

export function parseImageRows(runtime: ContainerRuntime, text: string): InventoryRow[] {
  return records(text).flatMap(r => {
    const id = bare(str(r.ID ?? r.Id));
    if (!id) return [];
    if (runtime === 'docker') return imageRow(runtime, id, none(str(r.Repository)), none(str(r.Tag)), r, undefined);
    const count = typeof r.Containers === 'number' && Number.isFinite(r.Containers) ? r.Containers : undefined;
    const names = list(r.Names);
    if (!names.length) return imageRow(runtime, id, '', '', r, count);
    return names.flatMap(entry => {
      const colon = entry.lastIndexOf(':');
      const split = colon > entry.lastIndexOf('/');
      return imageRow(runtime, id, split ? entry.slice(0, colon) : entry, split ? entry.slice(colon + 1) : '', r, count);
    });
  });
}

export function parseVolumeRows(runtime: ContainerRuntime, text: string): InventoryRow[] {
  return records(text).flatMap(r => {
    const name = str(r.Name ?? r.name);
    if (!CONTAINER_REF.test(name)) return [];
    const usedBy = runtime === 'podman' && typeof r.MountCount === 'number' && Number.isFinite(r.MountCount) ? r.MountCount : undefined;
    const row: InventoryRow = {
      uid: `${runtime}:volumes:${name}`,
      ref: { kind: 'volumes', runtime, ref: name },
      id: name,
      name,
      cells: {
        name, driver: str(r.Driver), mountpoint: str(r.Mountpoint), usedBy: usedBy ?? '',
        created: runtime === 'podman' ? parseDockerTime(r.CreatedAt ?? r.Created) : '',
      },
      tone: usedBy === 0 ? 'muted' : 'ok',
      labels: parseLabels(r.Labels),
    };
    if (usedBy !== undefined) row.usedBy = usedBy;
    return [row];
  });
}

const yesNo = (value: unknown): string => value === true || value === 'true' ? 'ja' : value === false || value === 'false' ? 'nein' : '';

export function parseNetworkRows(runtime: ContainerRuntime, text: string): InventoryRow[] {
  return records(text).flatMap(r => {
    const name = str(r.Name ?? r.name);
    const id = bare(str(r.ID ?? r.Id ?? r.id));
    const ref = CONTAINER_REF.test(name) ? name : id;
    if (!CONTAINER_REF.test(ref)) return [];
    return [{
      uid: `${runtime}:networks:${id || name}`,
      ref: { kind: 'networks' as const, runtime, ref },
      id: id || name,
      name: name || id.slice(0, 12),
      cells: {
        name: name || id.slice(0, 12), driver: str(r.Driver ?? r.driver), scope: str(r.Scope ?? r.scope),
        internal: yesNo(r.Internal ?? r.internal), containers: '', created: parseDockerTime(r.CreatedAt ?? r.Created ?? r.created),
      },
      tone: 'ok' as const,
      labels: parseLabels(r.Labels ?? r.labels),
    }];
  });
}

/** Sets usedBy and cells.usedBy (images, volumes) or cells.containers (networks) from rows.containers[].links; see C8. Pure, returns new rows. */
export function linkUsage(runtime: ContainerRuntime, rows: Record<InventoryKind, InventoryRow[]>, containersKnown = true): Record<InventoryKind, InventoryRow[]> {
  const links = rows.containers.flatMap(row => row.links ? [row.links] : []);
  const withUsage = (row: InventoryRow, cell: string, usedBy: number | undefined, tone: RowTone): InventoryRow => {
    const next: InventoryRow = { ...row, cells: { ...row.cells, [cell]: usedBy ?? '' }, tone };
    if (usedBy === undefined) delete next.usedBy; else next.usedBy = usedBy;
    return next;
  };
  const unused = (row: InventoryRow, usedBy: number | undefined): RowTone => row.cells.tag === '' || usedBy === 0 ? 'muted' : 'ok';
  const result: Record<InventoryKind, InventoryRow[]> = { ...rows };
  result.images = rows.images.map(row => {
    if (runtime === 'podman') return withUsage(row, 'usedBy', row.usedBy, unused(row, row.usedBy));
    if (!containersKnown) return withUsage(row, 'usedBy', undefined, unused(row, undefined));
    const wanted = row.cells.tag === '' ? null : normalizeImageRef(row.name);
    const count = links.filter(link => {
      if (IMAGE_ID.test(link.image)) return row.id.startsWith(bare(link.image));
      return wanted !== null && normalizeImageRef(link.image) === wanted;
    }).length;
    return withUsage(row, 'usedBy', count, unused(row, count));
  });
  result.volumes = rows.volumes.map(row => {
    const usedBy = runtime === 'podman' ? row.usedBy : containersKnown ? links.filter(link => link.mounts.includes(row.name)).length : undefined;
    return withUsage(row, 'usedBy', usedBy, usedBy === 0 ? 'muted' : 'ok');
  });
  result.networks = rows.networks.map(row => withUsage(row, 'containers', containersKnown ? links.filter(link => link.networks.includes(row.name)).length : undefined, 'ok'));
  return result;
}

const SECRET_NAME = /PASS|PASSWORD|PASSWD|PWD|SECRET|TOKEN|API_?KEY|PRIVATE_?KEY|CREDENTIAL/i;

/** See C10. Unparsable input comes back unchanged. */
export function maskInspect(text: string): string {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return text; }
  const walk = (node: unknown, parent: string | undefined): void => {
    if (Array.isArray(node)) { for (const entry of node) walk(entry, parent); return; }
    if (!node || typeof node !== 'object') return;
    const object = node as Rec;
    for (const key of Object.keys(object)) {
      const child = object[key];
      if (key === 'Env' && Array.isArray(child) && (parent === 'Config' || parent === 'ContainerConfig')) {
        child.forEach((entry, index) => {
          if (typeof entry !== 'string') return;
          const at = entry.indexOf('=');
          if (at > 0 && SECRET_NAME.test(entry.slice(0, at))) child[index] = `${entry.slice(0, at)}=***`;
        });
      } else walk(child, key);
    }
  };
  walk(value, undefined);
  try { return JSON.stringify(value, null, 2) ?? text; } catch { return text; }
}
