import { expect, it } from 'vitest';
import { describe, toYaml } from './describe';
import type { KubeObject } from './api';

/** A label padded like describe.ts does, so alignment changes are caught in one place. */
const field = (name: string, value: string, width = 21): string => name.padEnd(width) + value;

const podFixture: KubeObject = {
  apiVersion: 'v1',
  kind: 'Pod',
  metadata: {
    name: 'api-1',
    namespace: 'shop',
    creationTimestamp: '2026-10-15T10:00:00Z',
    labels: { app: 'api', tier: 'web' },
    ownerReferences: [{ kind: 'ReplicaSet', name: 'api-7c9' }],
    managedFields: [{ manager: 'kubectl' }],
  },
  spec: {
    nodeName: 'worker2',
    containers: [
      {
        name: 'api',
        image: 'harbor/shop/api:2.4.1',
        ports: [{ containerPort: 8080, protocol: 'TCP' }],
        resources: { requests: { cpu: '250m', memory: '512Mi' }, limits: { memory: '2Gi' } },
        env: [
          { name: 'DB_PASS', valueFrom: { secretKeyRef: { name: 'db', key: 'pass' } } },
          { name: 'MODE', value: 'prod' },
        ],
      },
    ],
  },
  status: {
    phase: 'Running',
    podIP: '10.42.1.17',
    conditions: [
      { type: 'Ready', status: 'False' },
      { type: 'ContainersReady', status: 'False' },
    ],
    containerStatuses: [
      {
        name: 'api',
        ready: false,
        restartCount: 5,
        image: 'harbor/shop/api:2.4.1',
        lastState: { terminated: { reason: 'OOMKilled', exitCode: 137 } },
      },
    ],
  },
};

const eventFixture: KubeObject = {
  apiVersion: 'v1',
  kind: 'Event',
  metadata: { name: 'api-1.17a', namespace: 'shop', creationTimestamp: '2026-10-16T08:00:00Z' },
  type: 'Warning',
  reason: 'BackOff',
  message: 'Back-off restarting failed container api in pod api-1',
  lastTimestamp: '2026-10-16T08:05:00Z',
  count: 12,
};

it('removes managedFields and masks secret data', () => {
  const yaml = toYaml({ apiVersion: 'v1', kind: 'Secret', metadata: { name: 's', managedFields: [{ manager: 'x' }] }, data: { password: 'c2VjcmV0' }, stringData: { token: 'plain' } });
  expect(yaml).not.toContain('managedFields');
  expect(yaml).not.toContain('c2VjcmV0');
  expect(yaml).not.toContain('plain');
  expect(yaml).toContain('password: •••');
});
it('masks the last-applied annotation of secrets', () => {
  const yaml = toYaml({ kind: 'Secret', metadata: { name: 's', annotations: { 'kubectl.kubernetes.io/last-applied-configuration': '{"data":{"a":"b"}}' } } });
  expect(yaml).not.toContain('"a":"b"');
});
it('describes a pod with containers, limits and events', () => {
  const text = describe(podFixture, [eventFixture]);
  expect(text).toContain(field('Name:', 'api-1'));
  expect(text).toContain(field('Namespace:', 'shop'));
  expect(text).toContain(field('Node:', 'worker2'));
  expect(text).toContain(field('Kind:', 'Pod'));
  expect(text).toContain(field('Creation Timestamp:', '2026-10-15T10:00:00Z'));
  expect(text).toContain('Container api');
  expect(text).toContain(field('Image:', 'harbor/shop/api:2.4.1', 17));
  expect(text).toContain(field('Limits:', 'memory=2Gi', 17));
  expect(text).toContain('Last State: Terminated (OOMKilled, Exit Code: 137)');
  expect(text).toContain(field('Restart Count:', '', 17));
  expect(text).toContain(field('Ready:', 'False', 17));
  expect(text).toContain('  Environment:');
  expect(text).toContain('Warning  BackOff  Back-off restarting');
});
it('describes a ready container and a secret with kubectl wording', () => {
  const ready: KubeObject = { ...podFixture, status: { containerStatuses: [{ name: 'api', ready: true, restartCount: 2 }] } };
  const text = describe(ready, []);
  expect(text).toContain(field('Ready:', 'True', 17));
  expect(text).toContain(field('Restart Count:', '2', 17));
  const secret = describe({ kind: 'Secret', metadata: { name: 's' }, type: 'Opaque', data: { password: 'x' } }, []);
  expect(secret).toContain(field('Type:', 'Opaque'));
  expect(secret).toContain('Keys:');
  expect(secret).toContain('  password');
  const workload = describe({ kind: 'Deployment', metadata: { name: 'd' }, spec: { replicas: 1, strategy: { type: 'RollingUpdate' }, selector: {}, template: { spec: { containers: [] } } } }, []);
  expect(workload).toContain(field('Strategy:', 'RollingUpdate'));
});
it('shows secretKeyRef env vars as references only', () => {
  const pod: KubeObject = {
    ...podFixture,
    spec: {
      containers: [
        {
          name: 'api',
          image: 'x',
          env: [
            { name: 'DB_PASS', valueFrom: { secretKeyRef: { name: 'db', key: 'pass' } } },
            { name: 'MODE', value: 'prod' },
          ],
        },
      ],
    },
  };
  const text = describe(pod, []);
  expect(text).toContain('DB_PASS: <Secret db/pass>');
  expect(text).toContain('MODE: prod');
});
