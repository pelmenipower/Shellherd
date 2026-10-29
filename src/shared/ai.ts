import type { AiProviderKind } from './vault/types';
import type { CodedError } from './errors';

/** Provider as windows see it: never the API key. `masking` is false only when the user switched masking off. */
export interface AiProviderInfo { id: string; name: string; kind: AiProviderKind; model: string; masking: boolean }
export interface AiCatalog { providers: AiProviderInfo[]; defaultProviderId?: string }

/** Kubernetes analysis ("Mit KI analysieren"): the cluster its context comes from. Masking is always on for it. */
export interface AiKubeContext { kube: { cluster: string; production: boolean } }
export type AiAskContext = AiTerminalContext | AiKubeContext;
export const isKubeContext = (context: AiAskContext): context is AiKubeContext => 'kube' in context;

export interface AiChatMessage { role: 'user' | 'assistant'; content: string }

/** What the assistant works on; the screen text itself travels inside the user messages. */
export interface AiTerminalContext { shell: 'ssh' | 'powershell' | 'cmd' | 'bash' | 'zsh' | 'fish'; target: string }

export interface AiAskRequest {
  requestId: string;
  /** One per tab conversation (new after "Clear history"); keeps [SECRET_n] placeholders stable across turns. */
  conversationId: string;
  providerId?: string;
  messages: AiChatMessage[];
  context: AiAskContext;
}

export type AiEvent =
  | { type: 'masked'; requestId: string; count: number }
  | { type: 'delta'; requestId: string; text: string }
  | { type: 'done'; requestId: string }
  | { type: 'error'; requestId: string; error: CodedError };

/** A placeholder main put in for a secret before sending; the real value never comes back. */
export const SECRET_PLACEHOLDER = /\[SECRET_\d{1,6}\]/;

/** Defaults per provider kind; names and hints come from the assistant catalog. */
export const AI_PROVIDER_KINDS: Record<AiProviderKind, { model: string; baseUrl?: string }> = {
  openai: { model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1' },
  azure: { model: 'gpt-4o-mini' },
  anthropic: { model: 'claude-opus-5-5' },
  gemini: { model: 'gemini-2.5-flash' },
};
