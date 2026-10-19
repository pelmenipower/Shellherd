import { BrowserWindow, ipcMain, webContents } from 'electron';
import { z } from 'zod';
import { IPC_CHANNELS } from '../../shared/ipc';
import { AiProviderSchema } from '../../shared/vault/schema';
import type { AiCatalog } from '../../shared/ai';
import { requireSshSender } from '../ssh/ipc';
import { vaultSessionManager } from '../vault/ipc';
import type { WindowRegistry } from '../windows';
import { AssistantService } from './assistant';
import { AiError } from './providers';

const MessageSchema = z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(64 * 1024) }).strict();
const AskSchema = z.object({
  requestId: z.string().uuid(),
  providerId: z.string().min(1).max(200).optional(),
  messages: z.array(MessageSchema).min(1).max(40).refine(messages => messages[0].role === 'user' && messages.at(-1)!.role === 'user'),
  context: z.object({ shell: z.enum(['ssh', 'powershell', 'cmd']), target: z.string().max(500) }).strict(),
}).strict().refine(request => request.messages.reduce((total, message) => total + message.content.length, 0) <= 256 * 1024);
const CancelSchema = z.object({ requestId: z.string().uuid() }).strict();

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error('Ungültige KI-Anfrage.');
  return result.data;
}

const userError = (error: unknown): Error => new Error(error instanceof AiError ? error.message : 'Die KI-Anfrage ist fehlgeschlagen.');

export function registerAiIpcHandlers(registry: WindowRegistry): { service: AssistantService; broadcast: () => void } {
  const service = new AssistantService({
    settings: () => vaultSessionManager.getSnapshot().vault.ai,
    emit: (ownerId, event) => {
      const owner = webContents.fromId(ownerId);
      if (owner && !owner.isDestroyed()) owner.send(IPC_CHANNELS.aiEvent, event);
    },
  });
  ipcMain.handle(IPC_CHANNELS.aiCatalog, event => { requireSshSender(event); return service.catalog(); });
  ipcMain.handle(IPC_CHANNELS.aiAsk, (event, request: unknown) => {
    const ownerId = requireSshSender(event);
    try { service.ask(ownerId, parse(AskSchema, request)); } catch (error) { throw userError(error); }
  });
  ipcMain.handle(IPC_CHANNELS.aiCancel, (event, request: unknown) => service.cancel(requireSshSender(event), parse(CancelSchema, request).requestId));
  // Settings form: may test a provider that is not saved yet, so only the main window may send keys here.
  ipcMain.handle(IPC_CHANNELS.aiTest, async (event, provider: unknown) => {
    registry.requireMain(event);
    vaultSessionManager.getSnapshot();
    try { return await service.test(parse(AiProviderSchema, provider)); } catch (error) { throw userError(error); }
  });
  return {
    service,
    broadcast: () => {
      let catalog: AiCatalog;
      try { catalog = service.catalog(); } catch { return; }
      for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.aiCatalogChanged, catalog);
    },
  };
}
