import type { AiProvider, AiSettings } from '../../shared/vault/types';
import type { AiAskContext, AiAskRequest, AiCatalog, AiEvent, AiTerminalContext } from '../../shared/ai';
import { isKubeContext } from '../../shared/ai';
import type { Locale } from '../../shared/locale';
import { mainTFor } from '../i18n';
import { localeStore } from '../locale';
import { codedFrom, limitError } from '../../shared/errors';
import { AiError, streamChat, type ChatRequest } from './providers';
import { SecretMasker } from './secret-mask';

const MAX_PARALLEL = 3;
/** Conversations whose placeholders main remembers; the oldest is dropped first. */
const MAX_CONVERSATIONS = 256;

const PROMPT_LINES = [
  'assistant.prompt.data', 'assistant.prompt.brevity', 'assistant.prompt.command', 'assistant.prompt.explain',
  'assistant.prompt.goal', 'assistant.prompt.afterOutput', 'assistant.prompt.danger', 'assistant.prompt.question',
] as const;
const SHELL_KEYS = {
  ssh: 'assistant.shells.ssh', powershell: 'assistant.shells.powershell', cmd: 'assistant.shells.cmd', bash: 'assistant.shells.bash', zsh: 'assistant.shells.zsh', fish: 'assistant.shells.fish',
} as const satisfies Record<AiTerminalContext['shell'], string>;
const KUBE_PROMPT_LINES = [
  'assistant.kubePrompt.data', 'assistant.kubePrompt.task', 'assistant.kubePrompt.brevity', 'assistant.kubePrompt.readOnly',
  'assistant.kubePrompt.mutating', 'assistant.kubePrompt.missing',
] as const;

/**
 * Rules of the assistant. Kept short on purpose: it is sent with every request.
 * The terminal or cluster text it sees is data, never instructions.
 */
export function systemPrompt(context: AiAskContext, locale: Locale, masked = false): string {
  const t = mainTFor(locale);
  if (isKubeContext(context)) {
    return [
      t('assistant.kubePrompt.intro', { cluster: context.kube.cluster }),
      ...(context.kube.production ? [t('assistant.kubePrompt.production')] : []),
      ...KUBE_PROMPT_LINES.map(key => t(key)),
      ...(masked ? [t('assistant.prompt.masked')] : []),
    ].join('\n');
  }
  return [
    t('assistant.prompt.intro', { shell: t(SHELL_KEYS[context.shell]), target: context.target }),
    ...PROMPT_LINES.map(key => t(key)),
    ...(masked ? [t('assistant.prompt.masked')] : []),
  ].join('\n');
}

export interface AssistantDependencies {
  /** AI settings of the unlocked vault; throws while it is locked. */
  settings: () => AiSettings | undefined;
  emit: (ownerId: number, event: AiEvent) => void;
  stream?: typeof streamChat;
  /** Vault values to mask, longest first (vaultLiterals); absent in tests that do not need them. */
  secrets?: () => string[];
}

export function aiCatalog(settings: AiSettings | undefined): AiCatalog {
  const providers = (settings?.providers ?? []).map(({ id, name, kind, model, maskSecrets }) => ({ id, name, kind, model, masking: maskSecrets !== false }));
  return { providers, ...(settings?.defaultProviderId ? { defaultProviderId: settings.defaultProviderId } : {}) };
}

/** Runs assistant requests in the main process so API keys never reach a window. */
export class AssistantService {
  private running = new Map<string, { ownerId: number; controller: AbortController }>();
  private maskers = new Map<string, SecretMasker>();
  constructor(private readonly dependencies: AssistantDependencies) {}

  catalog(): AiCatalog { return aiCatalog(this.dependencies.settings()); }

  private provider(id?: string): AiProvider {
    const settings = this.dependencies.settings();
    const providers = settings?.providers ?? [];
    const provider = providers.find(item => item.id === (id ?? settings?.defaultProviderId)) ?? (id ? undefined : providers[0]);
    if (!provider) throw new AiError('ai.noProvider');
    return provider;
  }

  /** Masker of one conversation, most recently used last. */
  private masker(ownerId: number, conversationId: string): SecretMasker {
    const key = `${ownerId}/${conversationId}`;
    const masker = this.maskers.get(key) ?? new SecretMasker();
    this.maskers.delete(key);
    this.maskers.set(key, masker);
    while (this.maskers.size > MAX_CONVERSATIONS) this.maskers.delete(this.maskers.keys().next().value!);
    return masker;
  }

  /** The request as it leaves Shellherd: system prompt and every message masked, unless the user switched masking off. */
  private prepare(ownerId: number, request: AiAskRequest, provider: AiProvider): { chat: ChatRequest; masked: number } {
    // A Kubernetes analysis is always masked (user ruling), whatever the provider setting says.
    const masking = provider.maskSecrets !== false || isKubeContext(request.context);
    const system = systemPrompt(request.context, localeStore.get().effective, masking);
    if (!masking) return { chat: { system, messages: request.messages }, masked: 0 };
    const literals = this.dependencies.secrets?.() ?? [];
    try {
      const masker = this.masker(ownerId, request.conversationId);
      const results = request.messages.map(message => masker.mask(message.content, literals));
      const messages = request.messages.map((message, index) => ({ role: message.role, content: results[index].text }));
      return { chat: { system: masker.mask(system, literals).text, messages }, masked: results.at(-1)?.numbers.size ?? 0 };
    } catch {
      // Never send what could not be checked.
      throw new AiError('ai.maskFailed');
    }
  }

  ask(ownerId: number, request: AiAskRequest): void {
    if ([...this.running.values()].filter(item => item.ownerId === ownerId).length >= MAX_PARALLEL) throw new AiError('ai.busy');
    if (this.running.has(request.requestId)) throw new AiError('ai.requestRunning');
    const provider = this.provider(request.providerId);
    const { chat, masked } = this.prepare(ownerId, request, provider);
    const controller = new AbortController();
    this.running.set(request.requestId, { ownerId, controller });
    const emit = (event: AiEvent): void => this.dependencies.emit(ownerId, event);
    if (masked > 0) emit({ type: 'masked', requestId: request.requestId, count: masked });
    void (this.dependencies.stream ?? streamChat)(provider, chat,
      text => { if (!controller.signal.aborted) emit({ type: 'delta', requestId: request.requestId, text }); }, controller.signal)
      .then(() => emit({ type: 'done', requestId: request.requestId }))
      .catch(error => {
        if (controller.signal.aborted) emit({ type: 'done', requestId: request.requestId });
        else emit({ type: 'error', requestId: request.requestId, error: limitError(codedFrom(error, 'ai.requestFailed')) });
      })
      .finally(() => this.running.delete(request.requestId));
  }

  cancel(ownerId: number, requestId: string): void {
    const entry = this.running.get(requestId);
    if (entry?.ownerId === ownerId) entry.controller.abort();
  }

  cancelOwner(ownerId: number): void {
    for (const entry of this.running.values()) if (entry.ownerId === ownerId) entry.controller.abort();
    for (const key of [...this.maskers.keys()]) if (key.startsWith(`${ownerId}/`)) this.maskers.delete(key);
  }
  /** Disconnect or vault change: stop everything and forget all placeholders. */
  cancelAll(): void {
    for (const entry of this.running.values()) entry.controller.abort();
    this.maskers.clear();
  }

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
