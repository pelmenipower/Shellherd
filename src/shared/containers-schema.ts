import { z } from 'zod';
import { CONTAINER_REF, MAX_REF_LENGTH, MAX_VMID, MIN_VMID, inventoryRefValid } from './containers';
import type { ContainerTarget, InventoryRef, TerminalTarget } from './containers';

export const ContainerTargetSchema: z.ZodType<ContainerTarget> = z.union([
  z.object({ kind: z.literal('container'), runtime: z.enum(['docker', 'podman']), ref: z.string().regex(CONTAINER_REF), name: z.string().min(1).max(256) }).strict(),
  z.object({ kind: z.enum(['lxc', 'vm']), vmid: z.number().int().min(MIN_VMID).max(MAX_VMID), name: z.string().max(256) }).strict(),
]);

export const TerminalTargetSchema: z.ZodType<TerminalTarget> = z.object({
  item: ContainerTargetSchema,
  mode: z.enum(['shell', 'logs']),
}).strict();

export const InventoryRefSchema: z.ZodType<InventoryRef> = z.object({
  kind: z.enum(['containers', 'images', 'volumes', 'networks']),
  runtime: z.enum(['docker', 'podman']),
  ref: z.string().min(1).max(MAX_REF_LENGTH),
}).strict().refine(inventoryRefValid, { message: 'Ungültige Angabe.' });
