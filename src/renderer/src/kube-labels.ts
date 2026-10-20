import type { KubeKind } from '../../shared/kubernetes';
import { t } from './i18n';

// Dynamic keys only through maps of full literals; `Object.hasOwn` keeps prototype names out.
const COLUMN_KEYS = {
  name: 'kubernetes:columns.name', ready: 'kubernetes:columns.ready', status: 'kubernetes:columns.status',
  restarts: 'kubernetes:columns.restarts', cpu: 'kubernetes:columns.cpu', memory: 'kubernetes:columns.memory',
  node: 'kubernetes:columns.node', age: 'kubernetes:columns.age', upToDate: 'kubernetes:columns.upToDate',
  image: 'kubernetes:columns.image', completions: 'kubernetes:columns.completions', lastRun: 'kubernetes:columns.lastRun',
  schedule: 'kubernetes:columns.schedule', type: 'kubernetes:columns.type', clusterIp: 'kubernetes:columns.clusterIp',
  ports: 'kubernetes:columns.ports', hosts: 'kubernetes:columns.hosts', address: 'kubernetes:columns.address',
  roles: 'kubernetes:columns.roles', pods: 'kubernetes:columns.pods', version: 'kubernetes:columns.version',
  reason: 'kubernetes:columns.reason', object: 'kubernetes:columns.object', message: 'kubernetes:columns.message',
  count: 'kubernetes:columns.count', last: 'kubernetes:columns.last', namespace: 'kubernetes:columns.namespace',
  container: 'kubernetes:columns.container',
} as const;

const CHIP_KEYS = {
  attention: 'kubernetes:chips.attention', complete: 'kubernetes:chips.complete', incomplete: 'kubernetes:chips.incomplete',
  zero: 'kubernetes:chips.zero', running: 'kubernetes:chips.running', waiting: 'kubernetes:chips.waiting',
  failed: 'kubernetes:chips.failed', completed: 'kubernetes:chips.completed', terminating: 'kubernetes:chips.terminating',
  notready: 'kubernetes:chips.notready', restarts: 'kubernetes:chips.restarts', success: 'kubernetes:chips.success',
  active: 'kubernetes:chips.active', suspended: 'kubernetes:chips.suspended', clusterip: 'kubernetes:chips.clusterip',
  nodeport: 'kubernetes:chips.nodeport', loadbalancer: 'kubernetes:chips.loadbalancer', externalname: 'kubernetes:chips.externalname',
  headless: 'kubernetes:chips.headless', noselector: 'kubernetes:chips.noselector', cordoned: 'kubernetes:chips.cordoned',
  pressure: 'kubernetes:chips.pressure', controlplane: 'kubernetes:chips.controlplane', warning: 'kubernetes:chips.warning',
  normal: 'kubernetes:chips.normal', '5m': 'kubernetes:chips.last5m', '15m': 'kubernetes:chips.last15m',
} as const;

/** Header text of a table column; an unknown key comes back unchanged. */
export function columnLabel(key: string): string {
  return Object.hasOwn(COLUMN_KEYS, key) ? t(COLUMN_KEYS[key as keyof typeof COLUMN_KEYS]) : key;
}

/** Text of a filter chip; an unknown id comes back unchanged. `kind` tells apart the job chip "failed" ("Fehlgeschlagen") from the pod chip. */
export function chipLabel(id: string, kind?: KubeKind): string {
  if (id === 'failed' && kind === 'jobs') return t('kubernetes:chips.jobFailed');
  return Object.hasOwn(CHIP_KEYS, id) ? t(CHIP_KEYS[id as keyof typeof CHIP_KEYS]) : id;
}
