import type { AiProviderKind } from './vault/types';

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
  | { type: 'error'; requestId: string; message: string };

export const AI_PROVIDER_KINDS: Record<AiProviderKind, { label: string; model: string; baseUrl?: string; hint: string }> = {
  openai: { label: 'OpenAI-kompatibel', model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1',
    hint: 'OpenAI, Ollama (http://localhost:11434/v1), LM Studio, vLLM oder ein internes Gateway.' },
  azure: { label: 'Azure AI Foundry', model: 'gpt-4o-mini',
    hint: 'Endpoint aus dem Foundry-Portal; Modell = Name des Deployments.' },
  anthropic: { label: 'Anthropic (Claude)', model: 'claude-opus-5-5', hint: 'API-Schlüssel aus der Claude Console.' },
  gemini: { label: 'Google Gemini', model: 'gemini-2.5-flash', hint: 'API-Schlüssel aus Google AI Studio.' },
};
