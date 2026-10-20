import { describe, expect, it } from 'vitest';
import type { KubeKind, KubeRow } from './kubernetes';
import { compileSearch, EMPTY_FILTER, MAX_SEARCH_LENGTH, NUMERIC_FIELDS, QUALIFIERS, SEARCH_HELP, searchText } from './kube-filter';

function row(kind: KubeKind, name: string, extra: Partial<KubeRow> = {}): KubeRow {
  return { uid: name, ref: { kind, namespace: kind === 'nodes' ? undefined : 'shop', name }, cells: {}, tone: 'ok', labels: {}, ...extra };
}
const pod = (name: string, extra: Partial<KubeRow> = {}, cells: Record<string, string | number> = {}): KubeRow =>
  row('pods', name, { cells: { status: 'Running', restarts: 0, ...cells }, ...extra });
const match = (kind: KubeKind, text: string, r: KubeRow): boolean => compileSearch(kind, text)(r);

describe('constants', () => {
  it('exposes the empty filter and the limit', () => {
    expect(EMPTY_FILTER).toEqual({ text: '', chips: [] });
    expect(MAX_SEARCH_LENGTH).toBe(200);
    expect(NUMERIC_FIELDS).toEqual({ pods: ['restarts'], events: ['count'] });
  });
  it('derives the help qualifiers from QUALIFIERS', () => {
    expect(SEARCH_HELP.qualifiers.pods.map(q => q.name)).toEqual(['ns', 'node', 'status', 'image', 'owner', 'ip', 'container']);
    expect(SEARCH_HELP.qualifiers.ingresses).toEqual(QUALIFIERS.ingresses.map(q => ({ name: q.name, descriptionKey: q.descriptionKey })));
    expect(SEARCH_HELP.numeric).toBe(NUMERIC_FIELDS);
    expect(SEARCH_HELP.forms).toHaveLength(8);
    expect(QUALIFIERS.pods.find(q => q.name === 'owner')?.exact).toBe(true);
  });
});

describe('searchText', () => {
  it('joins the pod fields in lowercase and caches', () => {
    const r = pod('API-1', {
      node: 'Worker2', ip: '10.0.0.5', owner: { kind: 'deployments', namespace: 'shop', name: 'Api' }, labels: { app: 'secret' },
    }, { 'image:web': 'Nginx:1', 'image:side': 'Envoy:2' });
    const text = searchText(r);
    expect(text.split('\n')).toEqual(['api-1', 'shop', 'running', 'worker2', 'nginx:1', 'envoy:2', 'api', '10.0.0.5']);
    expect(searchText(r)).toBe(text);
  });
  it('drops missing values and never includes labels', () => {
    expect(searchText(pod('a', { labels: { app: 'zzz' } }))).not.toContain('zzz');
    expect(searchText(row('nodes', 'n1', { cells: { status: 'Ready', roles: 'control-plane', version: 'v1.30' }, ip: '1.2.3.4' })).split('\n'))
      .toEqual(['n1', 'ready', 'control-plane', 'v1.30', '1.2.3.4']);
  });
  it('events use reason, object, message, namespace, type but not the name', () => {
    const e = row('events', 'api-1.17f3a2', { cells: { reason: 'BackOff', object: 'Pod/api-1', message: 'Back-off restarting', type: 'Warning' } });
    expect(searchText(e).split('\n')).toEqual(['backoff', 'pod/api-1', 'back-off restarting', 'shop', 'warning']);
    expect(match('events', '17f3a2', e)).toBe(false);
    expect(match('events', 'restarting', e)).toBe(true);
  });
  it('covers the other kinds', () => {
    expect(searchText(row('services', 's', { cells: { type: 'NodePort', clusterIp: '10.1.1.1', ports: '80:30080/TCP' } })).split('\n'))
      .toEqual(['s', 'shop', 'nodeport', '10.1.1.1', '80:30080/tcp']);
    expect(searchText(row('ingresses', 'i', { cells: { hosts: 'a.example.com', address: '1.1.1.1' } })).split('\n'))
      .toEqual(['i', 'shop', 'a.example.com', '1.1.1.1']);
    expect(searchText(row('cronjobs', 'c', { cells: { schedule: '*/5 * * * *' } })).split('\n')).toEqual(['c', 'shop', '*/5 * * * *']);
    expect(searchText(row('deployments', 'd', { cells: { image: 'Img:1' } })).split('\n')).toEqual(['d', 'shop', 'img:1']);
    expect(searchText(row('jobs', 'j', { cells: { status: 'Failed' }, owner: { kind: 'cronjobs', name: 'Nightly' } })).split('\n'))
      .toEqual(['j', 'shop', 'failed', 'nightly']);
  });
});

describe('free text and tokenizer', () => {
  const r = pod('api-7f9c', { node: 'worker2' });
  it('empty or blank text matches everything', () => {
    expect(match('pods', '', r)).toBe(true);
    expect(match('pods', '   \t ', r)).toBe(true);
  });
  it('terms are AND, case-insensitive substrings', () => {
    expect(match('pods', 'API worker', r)).toBe(true);
    expect(match('pods', 'api nope', r)).toBe(false);
    expect(match('pods', 'RUNNING', r)).toBe(true);
  });
  it('quotes group a phrase, also mid-token, and are removed', () => {
    const e = row('events', 'e', { cells: { reason: 'BackOff', message: 'Back-off restarting failed container', type: 'Warning' } });
    expect(match('events', '"back-off restarting"', e)).toBe(true);
    expect(match('events', '"restarting back-off"', e)).toBe(false);
    expect(match('events', 'reason:"back off"', e)).toBe(false);
    const e2 = row('events', 'e', { cells: { reason: 'Back Off', type: 'Warning' } });
    expect(match('events', 'reason:"back off"', e2)).toBe(true);
  });
  it('an unclosed quote runs to the end', () => {
    const e = row('events', 'e', { cells: { message: 'back-off restarting' } });
    expect(match('events', '"back-off rest', e)).toBe(true);
  });
  it('a lone ! and an empty "" are ignored', () => {
    expect(match('pods', '!', r)).toBe(true);
    expect(match('pods', '""', r)).toBe(true);
    expect(match('pods', '!"" api', r)).toBe(true);
    expect(match('pods', '! nope', r)).toBe(false);
  });
  it('! negates a term', () => {
    expect(match('pods', '!api', r)).toBe(false);
    expect(match('pods', '!zzz', r)).toBe(true);
    expect(match('pods', 'api !zzz', r)).toBe(true);
  });
  it('a quoted token is plain text: "!foo" searches literally', () => {
    const lit = row('events', 'e', { cells: { message: 'saw !foo here' } });
    expect(match('events', '"!foo"', lit)).toBe(true);
    expect(match('events', '"!foo"', row('events', 'e', { cells: { message: 'foo' } }))).toBe(false);
    expect(match('events', '!"foo bar"', row('events', 'e', { cells: { message: 'foo bar' } }))).toBe(false);
    expect(match('events', '!"foo bar"', row('events', 'e', { cells: { message: 'baz' } }))).toBe(true);
  });
  it('a quoted phrase is never a qualifier or label', () => {
    expect(match('pods', '"node:worker2"', r)).toBe(false);
    expect(match('pods', '"app=api"', pod('x', { labels: { app: 'api' } }))).toBe(false);
  });
  it('is robust: odd tokens are text and nothing throws', () => {
    const ev = row('events', 'e', { cells: { message: 'a=b=c http://x 10:30 restarts>x foo:bar' } });
    for (const t of ['a=b=c', 'http://x', '10:30', 'restarts>x', 'foo:bar']) expect(match('events', t, ev)).toBe(true);
    expect(match('events', 'a=b=d', ev)).toBe(false);
    expect(() => compileSearch('pods', '\\ ( [ * ? "')(r)).not.toThrow();
  });
});

describe('numeric comparisons', () => {
  const r = (n: number | string) => pod('p', {}, { restarts: n });
  it('compares restarts with every operator', () => {
    expect(match('pods', 'restarts>3', r(4))).toBe(true);
    expect(match('pods', 'restarts>3', r(3))).toBe(false);
    expect(match('pods', 'restarts>=3', r(3))).toBe(true);
    expect(match('pods', 'restarts<3', r(2))).toBe(true);
    expect(match('pods', 'restarts<=3', r(4))).toBe(false);
    expect(match('pods', 'restarts=3', r(3))).toBe(true);
    expect(match('pods', 'restarts=3', r(4))).toBe(false);
  });
  it('restarts=3 is a number, not a label', () => {
    expect(match('pods', 'restarts=3', pod('p', { labels: { restarts: '3' } }, { restarts: 9 }))).toBe(false);
  });
  it('NaN never matches; negation inverts', () => {
    expect(match('pods', 'restarts>0', r('abc'))).toBe(false);
    expect(match('pods', '!restarts>0', r('abc'))).toBe(true);
    expect(match('pods', '!restarts>3', r(4))).toBe(false);
  });
  it('count works for events but restarts is text there', () => {
    const e = row('events', 'e', { cells: { count: 5, message: 'x' } });
    expect(match('events', 'count>=5', e)).toBe(true);
    expect(match('events', 'count>5', e)).toBe(false);
    expect(match('events', 'restarts>3', e)).toBe(false);
    expect(match('services', 'count>3', row('services', 's', { cells: { count: 9 } }))).toBe(false);
  });
});

describe('labels', () => {
  const r = pod('p', { labels: { app: 'API', tier: 'web', 'example.com/team': 'x' } });
  it('key=value is exact and case-insensitive', () => {
    expect(match('pods', 'app=api', r)).toBe(true);
    expect(match('pods', 'APP=Api', r)).toBe(true);
    expect(match('pods', 'app=ap', r)).toBe(false);
    expect(match('pods', 'example.com/team=x', r)).toBe(true);
  });
  it('key!=value: label missing or different', () => {
    expect(match('pods', 'tier!=web', r)).toBe(false);
    expect(match('pods', 'tier!=db', r)).toBe(true);
    expect(match('pods', 'zone!=a', r)).toBe(true);
  });
  it('!key=value equals key!=value and !key!=value equals key=value', () => {
    expect(match('pods', '!tier=web', r)).toBe(false);
    expect(match('pods', '!tier=db', r)).toBe(true);
    expect(match('pods', '!tier!=web', r)).toBe(true);
    expect(match('pods', '!tier!=db', r)).toBe(false);
  });
  it('label values are not in the free text', () => {
    expect(match('pods', 'web', r)).toBe(false);
  });
  it('invalid label key falls back to text', () => {
    const e = row('events', 'e', { cells: { message: '-x=1' } });
    expect(match('events', '-x=1', e)).toBe(true);
  });
});

describe('qualifiers', () => {
  const r = pod('api-1', {
    node: 'worker2', ip: '10.0.0.5', containers: ['web', 'sidecar'],
    owner: { kind: 'deployments', namespace: 'shop', name: 'Nightly' },
  }, { status: 'CrashLoopBackOff', 'image:web': 'nginx:1.2', 'image:side': 'envoy:3' });
  it('substring on a field, case-insensitive', () => {
    expect(match('pods', 'node:work', r)).toBe(true);
    expect(match('pods', 'NODE:WORKER2', r)).toBe(true);
    expect(match('pods', 'node:other', r)).toBe(false);
    expect(match('pods', 'status:crash', r)).toBe(true);
    expect(match('pods', 'ns:sho', r)).toBe(true);
    expect(match('pods', 'ip:10.0', r)).toBe(true);
  });
  it('image matches any container image; container matches names', () => {
    expect(match('pods', 'image:envoy', r)).toBe(true);
    expect(match('pods', 'image:nginx', r)).toBe(true);
    expect(match('pods', 'image:redis', r)).toBe(false);
    expect(match('pods', 'container:side', r)).toBe(true);
    expect(match('pods', 'container:db', r)).toBe(false);
  });
  it('owner is exact on the whole name', () => {
    expect(match('pods', 'owner:nightly', r)).toBe(true);
    expect(match('pods', 'owner:night', r)).toBe(false);
    expect(match('pods', 'owner:nightly', pod('x'))).toBe(false);
  });
  it('empty value is ignored, also when negated', () => {
    expect(match('pods', 'status:', r)).toBe(true);
    expect(match('pods', '!status:', r)).toBe(true);
    expect(match('pods', 'status: node:zzz', r)).toBe(false);
  });
  it('a missing field fails the qualifier; negated it passes', () => {
    const bare = pod('b');
    expect(match('pods', 'node:x', bare)).toBe(false);
    expect(match('pods', '!node:x', bare)).toBe(true);
    expect(match('pods', '!status:running', pod('b'))).toBe(false);
    expect(match('pods', '!status:failed', pod('b'))).toBe(true);
  });
  it('unknown qualifiers and qualifiers of other kinds are text', () => {
    expect(match('pods', 'foo:bar', r)).toBe(false);
    expect(match('services', 'node:x', row('services', 's', { cells: { type: 'ClusterIP' } }))).toBe(false);
    expect(match('services', 'type:node', row('services', 's', { cells: { type: 'NodePort' } }))).toBe(true);
  });
  it('events kind qualifier uses involved.kind, else the part before /', () => {
    const a = row('events', 'e', { cells: { object: 'Pod/api-1' }, involved: { kind: 'ReplicaSet', name: 'x' } });
    const b = row('events', 'e', { cells: { object: 'Pod/api-1' } });
    expect(match('events', 'kind:replicaset', a)).toBe(true);
    expect(match('events', 'kind:pod', a)).toBe(false);
    expect(match('events', 'kind:pod', b)).toBe(true);
    expect(match('events', 'object:api-1', b)).toBe(true);
  });
  it('node and service qualifiers', () => {
    expect(match('nodes', 'role:control', row('nodes', 'n', { cells: { roles: 'control-plane' } }))).toBe(true);
    expect(match('services', 'port:80', row('services', 's', { cells: { ports: '80/TCP' } }))).toBe(true);
    expect(match('services', 'ip:10.', row('services', 's', { cells: { clusterIp: '10.0.0.1' } }))).toBe(true);
  });
});

describe('memoisation', () => {
  it('returns the same predicate for the same kind and text', () => {
    expect(compileSearch('pods', 'abc')).toBe(compileSearch('pods', 'abc'));
    expect(compileSearch('pods', 'abc')).not.toBe(compileSearch('events', 'abc'));
  });
});
