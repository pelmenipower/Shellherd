import { z } from 'zod';
import { GROUP_BY_IDS, KUBE_KINDS, KUBE_NAME, LABEL_KEY, LABEL_VALUE, MAX_COLLAPSED, MAX_COLUMN_FILTER_LENGTH, MAX_COLUMN_FILTERS, MAX_GROUP_KEY_LENGTH, MAX_REPLICAS } from './kubernetes';
import type { DockMode, KubeQuery, KubeRef, KubeTerminalTarget, KubeViewSnapshot } from './kubernetes';

export const KubeNameSchema = z.string().max(253).regex(KUBE_NAME);
const viewId = z.string().uuid();
export const KubeRefSchema: z.ZodType<KubeRef> = z.object({ kind: z.enum(KUBE_KINDS), namespace: KubeNameSchema.optional(), name: KubeNameSchema }).strict();
export const KubeSelectorSchema = z.object({
  labels: z.record(z.string().max(317).regex(LABEL_KEY), z.string().max(63).regex(LABEL_VALUE)).optional(),
  node: KubeNameSchema.optional(),
}).strict();
export const KubeQuerySchema: z.ZodType<KubeQuery> = z.object({ kind: z.enum(KUBE_KINDS), namespace: KubeNameSchema.nullable(), selector: KubeSelectorSchema.optional() }).strict();
export const KubeOpenRequestSchema = z.object({ clusterId: z.string().min(1).max(256) }).strict();
export const KubeViewRequestSchema = z.object({ viewId }).strict();
export const KubeSubscribeRequestSchema = z.object({ viewId, query: KubeQuerySchema }).strict();
export const KubeDetailRequestSchema = z.object({ viewId, ref: KubeRefSchema, mode: z.enum(['yaml', 'describe', 'events']) }).strict();
export const KubeActionRequestSchema = z.object({ viewId, ref: KubeRefSchema, action: z.enum(['restart', 'scale', 'delete', 'cordon', 'uncordon', 'suspend', 'resume', 'trigger']),
  replicas: z.number().int().min(0).max(MAX_REPLICAS).optional() }).strict();
export const KubeProbeRequestSchema = z.object({ connectionId: z.string().min(1).max(256) }).strict();
export const KubeTerminalTargetSchema: z.ZodType<KubeTerminalTarget> = z.object({ namespace: KubeNameSchema, pod: KubeNameSchema, container: KubeNameSchema,
  mode: z.enum(['logs', 'previous', 'shell']), format: z.enum(['compact', 'raw']).optional() }).strict();
const DockModeSchema: z.ZodType<DockMode> = z.enum(['logs', 'shell', 'events', 'yaml', 'describe']);
const KubeFilterSnapshotSchema = z.object({
  text: z.string().max(200).optional(),
  chips: z.array(z.string().max(40)).max(16).optional(),
  columns: z.record(z.string().regex(/^[A-Za-z]{1,40}$/), z.string().max(MAX_COLUMN_FILTER_LENGTH))
    .refine(columns => Object.keys(columns).length <= MAX_COLUMN_FILTERS, { message: 'tooManyColumnFilters' })
    .optional(),
  groupBy: z.enum(GROUP_BY_IDS).optional(),
  collapsed: z.array(z.string().max(MAX_GROUP_KEY_LENGTH)).max(MAX_COLLAPSED).optional(),
}).strict();
export const KubeViewSnapshotSchema: z.ZodType<KubeViewSnapshot> = z.object({ query: KubeQuerySchema, crumbs: z.array(z.string().max(300)).max(8),
  selected: z.string().max(600).optional(), dock: DockModeSchema,
  filters: z.partialRecord(z.enum(KUBE_KINDS), KubeFilterSnapshotSchema).optional(),
  logFormat: z.enum(['compact', 'raw']).optional() }).strict();
