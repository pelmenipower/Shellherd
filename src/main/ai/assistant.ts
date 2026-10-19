import type { AiProvider, AiSettings } from '../../shared/vault/types';
import type { AiAskRequest, AiCatalog, AiEvent, AiTerminalContext } from '../../shared/ai';
import type { Locale } from '../../shared/locale';
import { mainTFor } from '../i18n';
import { localeStore } from '../locale';
import { codedFrom } from '../../shared/errors';
import { AiError, streamChat } from './providers';

const MAX_PARALLEL = 3;

const PROMPT_LINES = [
  'assistant.prompt.data', 'assistant.prompt.brevity', 'assistant.prompt.command', 'assistant.prompt.explain',
  'assistant.prompt.goal', 'assistant.prompt.afterOutput', 'assistant.prompt.danger', 'assistant.prompt.question',
] as const;
const SHELL_KEYS = {
  ssh: 'assistant.shells.ssh', powershell: 'assistant.shells.powershell', cmd: 'assistant.shells.cmd',
} as const satisfies Record<AiTerminalContext['shell'], string>;

/**
 * Rules of the terminal assistant. Kept short on purpose: it is sent with every request.
 * The terminal text it sees is data, never instructions.
 */
export function systemPrompt(context: AiTerminalContext, locale: Locale): string {
  const t = mainTFor(locale);
  return [
    t('assistant.prompt.intro', { shell: t(SHELL_KEYS[context.shell]), target: context.target }),
    ...PROMPT_LINES.map(key => t(key)),
  ].join('\n');
}

export interface AssistantDependencies {
  /** AI settings of the unlocked vault; throws while it is locked. */
  settings: () => AiSettings | undefined;
  emit: (ownerId: number, event: AiEvent) => void;
  stream?: typeof streamChat;
}

export function aiCatalog(settings: AiSettings | undefined): AiCatalog {
  const providers = (settings?.providers ?? []).map(({ id, name, kind, model }) => ({ id, name, kind, model }));
  return { providers, ...(settings?.defaultProviderId ? { defaultProviderId: settings.defaultProviderId } : {}) };
}

/** Runs assistant requests in the main process so API keys never reach a window. */
export class AssistantService {
  private running = new Map<string, { ownerId: number; controller: AbortController }>();
  constructor(private readonly dependencies: AssistantDependencies) {}

  catalog(): AiCatalog { return aiCatalog(this.dependencies.settings()); }

  private provider(id?: string): AiProvider {
    const settings = this.dependencies.settings();
    const providers = settings?.providers ?? [];
    const provider = providers.find(item => item.id === (id ?? settings?.defaultProviderId)) ?? (id ? undefined : providers[0]);
    if (!provider) throw new AiError('ai.noProvider');
    return provider;
  }

  ask(ownerId: number, request: AiAskRequest): void {
    if ([...this.running.values()].filter(item => item.ownerId === ownerId).length >= MAX_PARALLEL) throw new AiError('ai.busy');
    if (this.running.has(request.requestId)) throw new AiError('ai.requestRunning');
    const provider = this.provider(request.providerId);
    const controller = new AbortController();
    this.running.set(request.requestId, { ownerId, controller });
    const emit = (event: AiEvent): void => this.dependencies.emit(ownerId, event);
    void (this.dependencies.stream ?? streamChat)(provider, { system: systemPrompt(request.context, localeStore.get().effective), messages: request.messages },
      text => { if (!controller.signal.aborted) emit({ type: 'delta', requestId: request.requestId, text }); }, controller.signal)
      .then(() => emit({ type: 'done', requestId: request.requestId }))
      .catch(error => {
        if (controller.signal.aborted) emit({ type: 'done', requestId: request.requestId });
        else emit({ type: 'error', requestId: request.requestId, error: codedFrom(error, 'ai.requestFailed') });
      })
      .finally(() => this.running.delete(request.requestId));
  }

  cancel(ownerId: number, requestId: string): void {
    const entry = this.running.get(requestId);
    if (entry?.ownerId === ownerId) entry.controller.abort();
  }

  cancelOwner(ownerId: number): void {
    for (const entry of this.running.values()) if (entry.ownerId === ownerId) entry.controller.abort();
  }
  cancelAll(): void { for (const entry of this.running.values()) entry.controller.abort(); }

  /** Short round trip with a provider from the settings form, which may not be saved yet. */
  async test(provider: AiProvider): Promise<string> {
    const t = mainTFor(localeStore.get().effective);
    let answer = '';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      await (this.dependencies.stream ?? streamChat)(provider, { system: t('assistant.test.system'), messages: [{ role: 'user', content: t('assistant.test.user') }] },
        text => { answer += text; }, controller.signal);
    } catch (error) {
      if (controller.signal.aborted) throw new AiError('ai.testTimeout');
      throw error instanceof AiError ? error : new AiError('ai.testFailed');
    } finally { clearTimeout(timer); }
    return answer.trim().slice(0, 200);
  }
}
