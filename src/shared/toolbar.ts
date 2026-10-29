import { z } from 'zod';
import { CONNECTION_ICONS } from './vault/appearance';

export const TOOLBAR_ICONS = [...CONNECTION_ICONS, 'check', 'stop', 'warning', 'refresh', 'tools', 'play'] as const;
const style = {
  icon: z.enum(TOOLBAR_ICONS),
  color: z.string().regex(/^#[\da-f]{6}$/i),
  text: z.string().max(80),
};
export const ToolbarStyleSchema = z.object(style);
export const ToolbarItemSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(['command', 'status']),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(1000),
  command: z.string().min(1).max(4000).refine(value => !/[\x00-\x1f\x7f-\x9f]/.test(value)),
  connectionId: z.string().min(1).max(256).optional(),
  enabled: z.boolean(),
  showText: z.boolean(),
  confirm: z.boolean(),
  ...style,
  trigger: z.enum(['click', 'interval', 'both']),
  intervalMs: z.number().int().min(100).max(86_400_000),
  timeoutMs: z.number().int().min(100).max(300_000),
  mappings: z.array(z.object({ value: z.string().max(1000), ...style })).max(100)
    .refine(rows => new Set(rows.map(row => row.value)).size === rows.length),
  unknown: ToolbarStyleSchema,
});
export const ToolbarConfigSchema = z.object({
  mode: z.enum(['type', 'execute']),
  items: z.array(ToolbarItemSchema).max(64).refine(items => new Set(items.map(item => item.id)).size === items.length),
});
export type ToolbarItem = z.infer<typeof ToolbarItemSchema>;
export type ToolbarConfig = z.infer<typeof ToolbarConfigSchema>;
export type ToolbarStyle = z.infer<typeof ToolbarStyleSchema>;
export type ToolbarIcon = (typeof TOOLBAR_ICONS)[number];
export const DEFAULT_TOOLBAR: ToolbarConfig = { mode: 'type', items: [] };
export const toolbarItems = (config: ToolbarConfig, connectionId: string): ToolbarItem[] => config.items.filter(item => !item.connectionId || item.connectionId === connectionId);
export interface ToolbarResult {
  itemId: string;
  state: 'checking' | 'ok' | 'error';
  value?: string;
  message?: string;
  error?: 'exit' | 'invalid-json' | 'timeout' | 'output-limit' | 'disconnected' | 'failed';
  detail?: string;
  checkedAt?: number;
  lastSuccess?: number;
}
export const StatusPayloadSchema = z.object({ value: z.string().max(1000), message: z.string().max(2000).optional() });
export function parseToolbarOutput(output: string): { value: string; message?: string } {
  return StatusPayloadSchema.parse(JSON.parse(output));
}
export function toolbarStyle(item: ToolbarItem, result?: ToolbarResult): ToolbarStyle {
  if (item.kind === 'command') return item;
  if (!result || result.state !== 'ok') return { icon: result?.state === 'error' ? 'warning' : 'refresh', color: '#8b949e', text: '' };
  return item.mappings.find(mapping => mapping.value === result.value) ?? item.unknown;
}
