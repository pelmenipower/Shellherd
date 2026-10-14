import { z } from 'zod';
import { ContainerTargetSchema } from '../../shared/containers-schema';

const hostId = z.string().min(1).max(256);
export const ListRequestSchema = z.object({ hostId }).strict();
export const ActionRequestSchema = z.object({ hostId, target: ContainerTargetSchema, action: z.enum(['start', 'stop', 'restart', 'shutdown']) }).strict();
