import type { AiProviderKind } from './vault/types';
import type { CodedError } from './errors';

/** Provider as windows see it: never the API key. */
export interface AiProviderInfo { id: string; name: string; kind: AiProviderKind; model: string }
export interface AiCatalog { providers: AiProviderInfo[]; defaultProviderId?: string }

export interface AiChatMessage { role: 'user' | 'assistant'; content: string }

/** What the assistant works on; the screen text itself travels inside the user messages. */
export interface AiTerminalContext { shell: 'ssh' | 'powershell' | 'cmd'; target: string }

export interface AiAskRequest {
  requestId: string;
  providerId?: string;
  messages: AiChatMessage[];
  context: AiTerminalContext;
}

export type AiEvent =
  | { type: 'delta'; requestId: string; text: string }
  | { type: 'done'; requestId: string }
  | { type: 'error'; requestId: string; error: CodedError };

/** Defaults per provider kind; names and hints come from the assistant catalog. */
export const AI_PROVIDER_KINDS: Record<AiProviderKind, { model: string; baseUrl?: string }> = {
  openai: { model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1' },
  azure: { model: 'gpt-4o-mini' },
  anthropic: { model: 'claude-opus-5-5' },
  gemini: { model: 'gemini-2.5-flash' },
};
