import { dumpYaml } from '@kubernetes/client-node';
import type { KubeObject } from './api';

const MASK = '•••';
const LAST_APPLIED = 'kubectl.kubernetes.io/last-applied-configuration';
const LABEL_WIDTH = 13;
const CONTAINER_LABEL_WIDTH = 11;
const WORKLOAD_KINDS = new Set(['Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet', 'Job']);
const EVENT_LIMIT = 10;

type Rec = Record<string, any>;

function isRecord(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rec(value: unknown): Rec | undefined {
  return isRecord(value) ? value : undefined;
}

function arr(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

function label(name: string, value: string, width = LABEL_WIDTH): string {
  return `${name.padEnd(width)}${value}`;
}

function formatMap(map: unknown, separator: string, pairSeparator = '='): string {
  const entries = Object.entries(rec(map) ?? {}).map(([k, v]) => `${k}${pairSeparator}${str(v)}`);
  return entries.length > 0 ? entries.join(separator) : '<none>';
}

/** Returns a copy with managedFields removed and Secret values replaced by a mask. */
export function toYaml(object: KubeObject): string {
  const copy = structuredClone(object);
  if (copy.metadata) {
    delete copy.metadata.managedFields;
  }
  if (copy.kind === 'Secret') {
    for (const field of ['data', 'stringData'] as const) {
      const values = rec(copy[field]);
      if (values) {
        for (const key of Object.keys(values)) {
          values[key] = MASK;
        }
      }
    }
    const annotations = copy.metadata?.annotations;
    if (annotations && LAST_APPLIED in annotations) {
      annotations[LAST_APPLIED] = MASK;
    }
  }
  return dumpYaml(copy, { lineWidth: 160 });
}

/** Env value as shown in describe: plain values only, references by name. Never reads secret data. */
function envValue(env: Rec): string {
  if (env.value !== undefined) {
    return str(env.value);
  }
  const ref = rec(env.valueFrom) ?? {};
  if (rec(ref.secretKeyRef)) {
    return `<Secret ${str(ref.secretKeyRef.name)}/${str(ref.secretKeyRef.key)}>`;
  }
  if (rec(ref.configMapKeyRef)) {
    return `<ConfigMap ${str(ref.configMapKeyRef.name)}/${str(ref.configMapKeyRef.key)}>`;
  }
  if (rec(ref.fieldRef)) {
    return `<Field ${str(ref.fieldRef.fieldPath)}>`;
  }
  if (rec(ref.resourceFieldRef)) {
    return `<Resource ${str(ref.resourceFieldRef.resource)}>`;
  }
  return '<unbekannt>';
}

function containerLines(container: Rec, status: Rec | undefined): string[] {
  const indent = (name: string, value: string) => `  ${label(name, value, CONTAINER_LABEL_WIDTH)}`;
  const ports = arr(container.ports).map((p) => `${str(p.containerPort)}/${str(p.protocol ?? 'TCP')}`);
  const terminated = rec(rec(status?.lastState)?.terminated);
  const lines = [
    indent('Image:', str(container.image)),
    indent('Ports:', ports.length > 0 ? ports.join(', ') : '<none>'),
    indent('Requests:', formatMap(container.resources?.requests, ', ')),
    indent('Limits:', formatMap(container.resources?.limits, ', ')),
    indent('Bereit:', status?.ready ? 'ja' : 'nein'),
    indent('Neustarts:', str(status?.restartCount ?? 0)),
  ];
  if (terminated) {
    lines.push(`  Letzter Abbruch: ${str(terminated.reason)} (Exit ${str(terminated.exitCode)})`);
  }
  const env = arr(container.env);
  if (env.length === 0) {
    lines.push(indent('Umgebung:', '<none>'));
  } else {
    lines.push('  Umgebung:');
    for (const entry of env) {
      lines.push(`    ${str(entry.name)}: ${envValue(entry)}`);
    }
  }
  return lines;
}

function eventTime(event: KubeObject): number {
  const time = Date.parse(str(event.lastTimestamp ?? event.eventTime ?? event.metadata?.creationTimestamp));
  return Number.isNaN(time) ? 0 : time;
}

function section(title: string, lines: string[]): string[] {
  return ['', title, ...(lines.length > 0 ? lines : ['  <none>'])];
}

/** kubectl-describe-style summary. Secret values are never included. */
export function describe(object: KubeObject, events: KubeObject[]): string {
  const meta = object.metadata ?? {};
  const kind = str(object.kind);
  const spec = rec(object.spec);
  const status = rec(object.status);
  const out: string[] = [];

  out.push(label('Name:', str(meta.name)));
  if (meta.namespace) {
    out.push(label('Namespace:', meta.namespace));
  }
  out.push(label('Art:', kind));
  out.push(label('Erstellt:', str(meta.creationTimestamp)));
  out.push(label('Labels:', formatMap(meta.labels, ', ')));
  const owners = arr(meta.ownerReferences).map((o) => `${str(o.kind)}/${str(o.name)}`);
  out.push(label('Owner:', owners.length > 0 ? owners.join(', ') : '<none>'));

  if (kind === 'Pod') {
    out.push(label('Status:', str(status?.phase)));
    out.push(label('Node:', str(spec?.nodeName)));
    out.push(label('IP:', str(status?.podIP)));
  } else if (WORKLOAD_KINDS.has(kind)) {
    const desired = spec?.replicas ?? status?.desiredNumberScheduled ?? status?.replicas ?? 0;
    const ready = status?.readyReplicas ?? status?.numberReady ?? 0;
    out.push(label('Status:', `${str(ready)}/${str(desired)} ready`));
  } else if (kind === 'Secret') {
    out.push(label('Typ:', str(object.type)));
  }

  if (kind === 'Pod') {
    const statuses = arr(status?.containerStatuses);
    for (const container of arr(spec?.containers)) {
      const name = str(container.name);
      out.push('', `Container ${name}`, ...containerLines(container, statuses.find((s) => s.name === name)));
    }
  } else if (WORKLOAD_KINDS.has(kind)) {
    const selector = rec(spec?.selector);
    out.push('', label('Selector:', formatMap(selector?.matchLabels, ', ')));
    out.push(label('Replicas:', str(spec?.replicas ?? '')));
    out.push(label('Strategie:', str(spec?.strategy?.type ?? spec?.updateStrategy?.type ?? '')));
    out.push('Images:');
    for (const container of arr(rec(spec?.template)?.spec?.containers)) {
      out.push(`  ${str(container.name)}: ${str(container.image)}`);
    }
  } else if (kind === 'Secret') {
    out.push('', 'Schlüssel:');
    for (const key of Object.keys(rec(object.data) ?? {})) {
      out.push(`  ${key}`);
    }
  }

  const conditions = arr(status?.conditions).map((c) => `  ${str(c.type)}  ${str(c.status)}`);
  out.push(...section('Conditions:', conditions));

  const recentEvents = [...events]
    .sort((a, b) => eventTime(a) - eventTime(b))
    .slice(-EVENT_LIMIT)
    .map((e) => `  ${str(e.type)}  ${str(e.reason)}  ${str(e.message)}`);
  out.push(...section('Events:', recentEvents));

  return out.join('\n');
}
