import { describe, expect, it } from 'vitest';
import { ACTION_KINDS, type KubeAction } from './kubernetes';
import { KUBE_ACCESS_IDS, actionAccess, deniedAccess, ruleAllows, type KubeAccessCheck, type KubeResourceRule } from './kube-access';

const rule = (verbs: string[], apiGroups: string[], resources: string[], resourceNames?: string[]): KubeResourceRule =>
  ({ verbs, apiGroups, resources, ...(resourceNames ? { resourceNames } : {}) });
const check = (verb: string, group: string, resource: string): KubeAccessCheck => ({ verb, group, resource });
const ids = (rules: KubeResourceRule[]) => deniedAccess(rules).map(item => item.id);

// Truth table of ruleAllows against the Kubernetes RBAC matcher (verb, apiGroup, resource incl. `*/sub`; resourceNames ignored = allowed).
const TRUTH: [string, KubeResourceRule, KubeAccessCheck, boolean][] = [
  ['everything', rule(['*'], ['*'], ['*']), check('patch', 'apps', 'deployments'), true],
  ['* resource covers a subresource', rule(['get'], [''], ['*']), check('get', '', 'pods/log'), true],
  ['* verb', rule(['*'], [''], ['pods']), check('delete', '', 'pods'), true],
  ['* group', rule(['patch'], ['*'], ['deployments']), check('patch', 'apps', 'deployments'), true],
  ['exact subresource', rule(['get'], [''], ['pods/log']), check('get', '', 'pods/log'), true],
  ['*/log matches pods/log', rule(['get'], [''], ['*/log']), check('get', '', 'pods/log'), true],
  ['*/exec matches pods/exec', rule(['create'], [''], ['*/exec']), check('create', '', 'pods/exec'), true],
  ['pods/* is no RBAC pattern', rule(['*'], [''], ['pods/*']), check('get', '', 'pods/log'), false],
  ['pods does not cover pods/log', rule(['get'], [''], ['pods']), check('get', '', 'pods/log'), false],
  ['pods/log does not cover pods', rule(['list'], [''], ['pods/log']), check('list', '', 'pods'), false],
  ['*/log does not match a plain resource', rule(['get'], [''], ['*/log']), check('get', '', 'pods'), false],
  ['*/exec does not match pods/portforward', rule(['create'], [''], ['*/exec']), check('create', '', 'pods/portforward'), false],
  ['deployments/scale does not grant patch on deployments', rule(['patch'], ['apps'], ['deployments/scale']), check('patch', 'apps', 'deployments'), false],
  ['*/scale does not grant patch on deployments', rule(['patch'], ['apps'], ['*/scale']), check('patch', 'apps', 'deployments'), false],
  ['wrong group: apps against core', rule(['get'], ['apps'], ['pods/log']), check('get', '', 'pods/log'), false],
  ['wrong group: core against apps', rule(['patch'], [''], ['deployments']), check('patch', 'apps', 'deployments'), false],
  ['wrong verb', rule(['get', 'list', 'watch'], ['*'], ['*']), check('patch', 'apps', 'deployments'), false],
  ['get on pods/exec allows the old exec check', rule(['get'], [''], ['pods/exec']), check('get', '', 'pods/exec'), true],
  ['resourceNames count as allowed', rule(['patch'], ['apps'], ['deployments'], ['api']), check('patch', 'apps', 'deployments'), true],
  ['empty apiGroups match nothing', rule(['*'], [], ['*']), check('get', '', 'pods/log'), false],
  ['empty verbs match nothing', rule([], ['*'], ['*']), check('get', '', 'pods/log'), false],
];

describe('ruleAllows (truth table)', () => {
  it.each(TRUTH)('%s', (_name, given, wanted, expected) => {
    expect(ruleAllows(given, wanted)).toBe(expected);
  });
});

describe('deniedAccess', () => {
  it('denies nothing to * on *', () => {
    expect(deniedAccess([rule(['*'], ['*'], ['*'])])).toEqual([]);
  });

  it('denies everything with the first missing check when there are no rules', () => {
    expect(ids([])).toEqual([...KUBE_ACCESS_IDS]);
    expect(deniedAccess([]).find(item => item.id === 'patchDeployments')).toEqual({ id: 'patchDeployments', verb: 'patch', resource: 'deployments' });
    expect(deniedAccess([]).find(item => item.id === 'shell')).toEqual({ id: 'shell', verb: 'create', resource: 'pods/exec' });
  });

  it('leaves logs and logs of all pods to the view role and denies all writes, shell and forward', () => {
    // Like the built-in ClusterRole view: explicit resources, so no pods/exec or pods/portforward.
    const view = [rule(['get', 'list', 'watch'], [''], ['pods', 'pods/log', 'services', 'events']), rule(['get', 'list', 'watch'], ['apps'], ['deployments', 'statefulsets', 'daemonsets']),
      rule(['get', 'list', 'watch'], ['batch'], ['jobs', 'cronjobs'])];
    expect(ids(view)).toEqual(['shell', 'forward', 'patchDeployments', 'patchStatefulSets', 'patchDaemonSets', 'patchCronJobs', 'patchNodes', 'deletePods', 'deleteJobs', 'trigger']);
  });

  it('fails open: get on * also grants get on pods/exec and pods/portforward, which older clusters use', () => {
    expect(ids([rule(['get', 'list', 'watch'], ['*'], ['*'])])).toEqual(['patchDeployments', 'patchStatefulSets', 'patchDaemonSets', 'patchCronJobs', 'patchNodes', 'deletePods', 'deleteJobs', 'trigger']);
  });

  it('allows shell and forward with get only (older clusters) or create only (1.31+)', () => {
    expect(ids([rule(['get'], [''], ['pods/exec', 'pods/portforward'])])).not.toContain('shell');
    expect(ids([rule(['get'], [''], ['pods/exec', 'pods/portforward'])])).not.toContain('forward');
    expect(ids([rule(['create'], [''], ['pods/exec', 'pods/portforward'])])).not.toContain('shell');
    expect(ids([rule(['create'], [''], ['pods/exec'])])).toContain('forward');
  });

  it('names the missing get on cronjobs for trigger and the missing watch for logs of all pods', () => {
    const denied = deniedAccess([rule(['create'], ['batch'], ['jobs']), rule(['get', 'list'], [''], ['pods', 'pods/log'])]);
    expect(denied.find(item => item.id === 'trigger')).toEqual({ id: 'trigger', verb: 'get', resource: 'cronjobs' });
    expect(denied.find(item => item.id === 'logsAll')).toEqual({ id: 'logsAll', verb: 'watch', resource: 'pods' });
    expect(denied.find(item => item.id === 'logs')).toBeUndefined();
  });

  it('counts rules for named objects as allowed (nothing greyed out that might work)', () => {
    expect(ids([rule(['patch'], ['apps'], ['deployments'], ['api'])])).not.toContain('patchDeployments');
  });

  it('adds up several rules like RBAC', () => {
    expect(ids([rule(['get'], [''], ['pods/log']), rule(['list', 'watch'], [''], ['pods'])])).not.toContain('logsAll');
  });
});

describe('actionAccess', () => {
  it('maps every allowed action and kind pair, and nothing else', () => {
    for (const action of Object.keys(ACTION_KINDS) as KubeAction[]) {
      for (const kind of ACTION_KINDS[action]) expect(actionAccess(action, kind), `${action} ${kind}`).toBeDefined();
    }
    expect(actionAccess('restart', 'pods')).toBeUndefined();
    expect(actionAccess('delete', 'deployments')).toBeUndefined();
    expect(actionAccess('scale', 'statefulsets')).toBe('patchStatefulSets');
    expect(actionAccess('restart', 'daemonsets')).toBe('patchDaemonSets');
    expect(actionAccess('uncordon', 'nodes')).toBe('patchNodes');
    expect(actionAccess('resume', 'cronjobs')).toBe('patchCronJobs');
    expect(actionAccess('trigger', 'cronjobs')).toBe('trigger');
    expect(actionAccess('delete', 'jobs')).toBe('deleteJobs');
  });
});
