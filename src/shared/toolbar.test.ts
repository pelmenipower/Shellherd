import { exampleVault } from './vault/example';
import { removeNodeFromVault } from './vault/mutations';
import { describe, expect, it } from 'vitest';
import { ToolbarConfigSchema, ToolbarItemSchema, parseToolbarOutput, toolbarItems, toolbarStyle, type ToolbarItem } from './toolbar';
const base = { id: '11111111-1111-4111-8111-111111111111', kind: 'status', name: 'Service', command: '/opt/check.sh', description: '', enabled: true, showText: true, confirm: false,
  icon: 'server', color: '#ffffff', text: '', trigger: 'both', intervalMs: 1000, timeoutMs: 2000, mappings: [{ value: 'banana', icon: 'check', color: '#00ff00', text: 'OK' }], unknown: { icon: 'warning', color: '#aaaaaa', text: '?' } };
export const item = ToolbarItemSchema.parse(base);
describe('toolbar contract and configuration', () => {
  it('accepts arbitrary string values and ignores additional JSON fields', () => {
    expect(parseToolbarOutput('{"value":"banana","message":"works","extra":{"x":1}}')).toEqual({ value: 'banana', message: 'works' });
    expect(parseToolbarOutput('{"value":"1"}')).toEqual({ value: '1' });
    for (const output of ['{"value":1}', '[]', '{}', '{"value":"ok","message":3}', 'banner\n{"value":"ok"}', '{"value":"ok"}\n{"value":"ok"}']) expect(() => parseToolbarOutput(output)).toThrow();
  });
  it('maps exact values; technical errors can never inherit a green mapping', () => {
    expect(toolbarStyle(item, { itemId: item.id, state: 'ok', value: 'banana' })).toEqual(item.mappings[0]);
    expect(toolbarStyle(item, { itemId: item.id, state: 'ok', value: 'Banana' })).toEqual(item.unknown);
    expect(toolbarStyle(item, { itemId: item.id, state: 'error', value: 'banana', error: 'timeout' }).color).not.toBe('#00ff00');
    expect(toolbarStyle(item).icon).toBe('refresh');
  });
  it('filters global and connection-specific items in their saved order', () => {
    const global = item, own: ToolbarItem = { ...item, id: '22222222-2222-4222-8222-222222222222', connectionId: 'a' };
    expect(toolbarItems({ mode: 'type', items: [own, global] }, 'a')).toEqual([own, global]);
    expect(toolbarItems({ mode: 'type', items: [own, global] }, 'b')).toEqual([global]);
  });
  it('bounds configuration and refuses duplicate identities, mappings and control characters', () => {
    expect(ToolbarConfigSchema.safeParse({ mode: 'type', items: [item, item] }).success).toBe(false);
    for (const patch of [{ command: 'echo ok\r\nrm x' }, { intervalMs: 0 }, { timeoutMs: Infinity }, { color: 'red' }, { mappings: [item.mappings[0], item.mappings[0]] }]) expect(ToolbarItemSchema.safeParse({ ...item, ...patch }).success).toBe(false);
  });
});

it('removes scoped toolbar items with their connection while retaining global items', () => {
  const own: ToolbarItem = { ...item, id: '22222222-2222-4222-8222-222222222222', connectionId: 'connection-dev-api' };
  const vault = { ...exampleVault, toolbar: { mode: 'type' as const, items: [item, own] } };
  expect(removeNodeFromVault(vault, 'connection-dev-api').toolbar?.items).toEqual([item]);
  expect(vault.toolbar.items).toHaveLength(2);
});
