import { z } from 'zod';
import { AppError, type ErrorCode } from '../../shared/errors';
import { TerminalTargetSchema } from '../../shared/containers-schema';
import { KubeTerminalTargetSchema } from '../../shared/kubernetes-schema';

const session = { sessionId: z.string().uuid() };
const size = { cols: z.number().int().min(2).max(500), rows: z.number().int().min(1).max(300) };
export const PrepareSchema = z.object({ connectionId: z.string().min(1).max(256), target: TerminalTargetSchema.optional(), kube: KubeTerminalTargetSchema.optional(), ...size }).strict();
export const SessionSchema = z.object(session).strict();
export const InputSchema = z.object({ ...session, data: z.string().max(16_384) }).strict();
export const ResizeSchema = z.object({ ...session, ...size }).strict();
export const AckSchema = z.object({ ...session, sequence: z.number().int().positive() }).strict();

export function parseRequest<T>(schema: z.ZodType<T>, request: unknown, code: ErrorCode = 'ssh.invalidRequest'): T {
  const result = schema.safeParse(request);
  if (!result.success) throw new AppError(code);
  return result.data;
}
