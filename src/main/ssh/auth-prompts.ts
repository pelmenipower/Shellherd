import { randomUUID } from 'node:crypto';
import { IPC_CHANNELS } from '../../shared/ipc';
import type { AuthPromptAnswer, AuthPromptRequest } from '../../shared/ssh';

/** Resolves with the answers, or null when cancelled, locked, inactive or without a window. */
export type AskPrompts = (request: Omit<AuthPromptRequest, 'promptId'>,
  options: { ownerId?: number; isActive: () => boolean }) => Promise<string[] | null>;
export interface PromptTarget { id: number; send(channel: string, payload: unknown): void }
export interface AuthPromptDependencies { resolveTarget(ownerId?: number): PromptTarget | undefined; isUnlocked(): boolean }

type Draft = Omit<AuthPromptRequest, 'promptId'>;

const MAX_FIELDS = 8;
const MAX_ANSWER = 1024;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
const CONTROL_KEEP_NEWLINE = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g;

/** Server texts are untrusted: strip control characters and cap the lengths. */
export function cleanPromptRequest(request: Draft): Draft | undefined {
  if (request.fields.length === 0 || request.fields.length > MAX_FIELDS) return undefined;
  return {
    ...request,
    title: request.title.replace(CONTROL, '').slice(0, 128),
    instructions: request.instructions.replace(CONTROL_KEEP_NEWLINE, '').slice(0, 1024),
    fields: request.fields.map(field => ({ text: field.text.replace(CONTROL, '').slice(0, 256), echo: field.echo === true })),
  };
}

/** One call of `ask` from queueing to settlement. */
interface Ask {
  ownerId?: number;
  cancelled: boolean;
  /** Set while the prompt is on screen. */
  open?: { promptId: string; target: PromptTarget; fields: number; settle(answers: string[] | null): void };
}

/** Keyboard-interactive questions for the user: one at a time, answered only by the window that got them. */
export class AuthPrompts {
  private queue: Promise<void> = Promise.resolve();
  private readonly asks = new Set<Ask>();

  constructor(private readonly deps: AuthPromptDependencies) {}

  ask: AskPrompts = (request, options) => {
    const entry: Ask = { ownerId: options.ownerId, cancelled: false };
    this.asks.add(entry);
    const result = this.queue.then(() => this.run(request, options, entry)).catch(() => null)
      .finally(() => this.asks.delete(entry));
    // Keep the queue usable after a failed prompt.
    this.queue = result.then(() => {});
    return result;
  };

  answer(senderId: number, answer: AuthPromptAnswer): void {
    for (const entry of this.asks) {
      const open = entry.open;
      if (!open || open.promptId !== answer.promptId) continue;
      const { answers } = answer;
      if (open.target.id !== senderId) return;
      if (answers !== null && (answers.length !== open.fields || answers.some(text => typeof text !== 'string' || text.length > MAX_ANSWER))) return;
      open.settle(answers);
      return;
    }
  }

  cancelAll(): void {
    for (const entry of this.asks) this.cancel(entry);
  }

  cancelOwner(ownerId: number): void {
    for (const entry of this.asks) {
      if (entry.ownerId === ownerId || entry.open?.target.id === ownerId) this.cancel(entry);
    }
  }

  private cancel(entry: Ask): void {
    entry.cancelled = true;
    entry.open?.settle(null);
  }

  private async run(request: Draft, options: { ownerId?: number; isActive: () => boolean }, entry: Ask): Promise<string[] | null> {
    const cleaned = cleanPromptRequest(request);
    if (!cleaned || entry.cancelled || !this.deps.isUnlocked()) return null;
    const target = this.deps.resolveTarget(options.ownerId);
    if (!target) return null;
    const promptId = randomUUID();
    if (!options.isActive()) {
      sendTo(target, IPC_CHANNELS.sshAuthPromptClosed, { promptId });
      return null;
    }
    return new Promise<string[] | null>(resolve => {
      const settle = (answers: string[] | null): void => {
        if (entry.open?.promptId !== promptId) return;
        entry.open = undefined;
        const accepted = answers !== null && options.isActive();
        // Answers are never logged or kept; the window only needs to close.
        if (!accepted) sendTo(target, IPC_CHANNELS.sshAuthPromptClosed, { promptId });
        resolve(accepted ? answers : null);
      };
      entry.open = { promptId, target, fields: cleaned.fields.length, settle };
      if (!sendTo(target, IPC_CHANNELS.sshAuthPrompt, { promptId, ...cleaned })) settle(null);
    });
  }
}

/** A window that closed in the meantime must not break the queue. */
function sendTo(target: PromptTarget, channel: string, payload: unknown): boolean {
  try {
    target.send(channel, payload);
    return true;
  } catch {
    return false;
  }
}
