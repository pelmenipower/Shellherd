import { z } from 'zod';
import { ContainerTargetSchema, InventoryRefSchema } from '../../shared/containers-schema';

const hostId = z.string().min(1).max(256);
export const ListRequestSchema = z.object({ hostId }).strict();
export const ActionRequestSchema = z.object({ hostId, target: ContainerTargetSchema, action: z.enum(['start', 'stop', 'restart', 'shutdown']) }).strict();
export const InventoryRequestSchema = z.object({ hostId, runtime: z.enum(['docker', 'podman']).optional() }).strict();
export const InspectRequestSchema = z.object({ hostId, ref: InventoryRefSchema }).strict();
export const InventoryActionRequestSchema = z.object({ hostId, target: InventoryRefSchema, action: z.enum(['start', 'stop', 'restart', 'remove']) }).strict();
