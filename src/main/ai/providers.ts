import Anthropic from '@anthropic-ai/sdk';
import type { AiProvider } from '../../shared/vault/types';
import type { AiChatMessage } from '../../shared/ai';

export interface ChatRequest { system: string; messages: AiChatMessage[] }
export type TextSink = (text: string) => void;
/** Injected so tests never reach the network. */
export type Fetch = typeof fetch;

/** Errors whose message is written for the user; never contains the API key. */
export class AiError extends Error {}

/** Models that accept the server-side refusal fallback on the Claude API. */
const FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);

const trimSlash = (url: string): string => url.replace(/\/+$/, '');

/** Request URL, headers and body of the HTTP-based providers. */
export function httpRequest(provider: AiProvider, request: ChatRequest): { url: string; headers: Record<string, string>; body: unknown } {
  const chat = [{ role: 'system', content: request.system }, ...request.messages];
  if (provider.kind === 'openai') {
    return { url: `${trimSlash(provider.baseUrl ?? 'https://api.openai.com/v1')}/chat/completions`,
      headers: provider.apiKey ? { authorization: `Bearer ${provider.apiKey}` } : {},
      body: { model: provider.model, stream: true, messages: chat } };
  }
  if (provider.kind === 'azure') {
    if (!provider.baseUrl) throw new AiError('Bitte gib den Endpoint der Azure-Ressource an.');
    const endpoint = trimSlash(provider.baseUrl);
    const headers: Record<string, string> = provider.apiKey ? { 'api-key': provider.apiKey } : {};
    // Foundry model inference (…/models), the Azure OpenAI v1 API (…/openai/v1) or classic deployments.
    if (/\/models$/i.test(endpoint)) {
      return { url: `${endpoint}/chat/completions?api-version=${encodeURIComponent(provider.apiVersion || '2024-05-01-preview')}`, headers,
        body: { model: provider.model, stream: true, messages: chat } };
    }
    if (/\/openai\/v1$/i.test(endpoint)) return { url: `${endpoint}/chat/completions`, headers, body: { model: provider.model, stream: true, messages: chat } };
    return { url: `${endpoint}/openai/deployments/${encodeURIComponent(provider.model)}/chat/completions?api-version=${encodeURIComponent(provider.apiVersion || '2024-10-21')}`,
      headers, body: { stream: true, messages: chat } };
  }
  if (provider.kind === 'gemini') {
    return { url: `${trimSlash(provider.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta')}/models/${encodeURIComponent(provider.model)}:streamGenerateContent?alt=sse`,
      headers: provider.apiKey ? { 'x-goog-api-key': provider.apiKey } : {},
      body: { systemInstruction: { parts: [{ text: request.system }] },
        contents: request.messages.map(message => ({ role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }] })) } };
  }
  throw new AiError('Dieser Anbieter nutzt keine HTTP-Schnittstelle.');
}

/** Text of one streamed JSON event; providers differ only here. */
export function deltaText(kind: AiProvider['kind'], event: unknown): string {
  const data = event as { choices?: { delta?: { content?: string } }[]; candidates?: { content?: { parts?: { text?: string }[] } }[] };
  if (kind === 'gemini') return data.candidates?.[0]?.content?.parts?.map(part => part.text ?? '').join('') ?? '';
  return data.choices?.[0]?.delta?.content ?? '';
}

/** Splits a server-sent event stream into `data:` payloads. */
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let end: number;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end).replace(/\r$/, '');
      buffer = buffer.slice(end + 1);
      if (line.startsWith('data:')) yield line.slice(5).trimStart();
    }
    if (done) { if (buffer.startsWith('data:')) yield buffer.slice(5).trimStart(); return; }
  }
}

function statusText(status: number): string {
  if (status === 401 || status === 403) return 'Der Anbieter lehnt den API-Schlüssel ab.';
  if (status === 404) return 'Modell oder Endpoint wurde nicht gefunden. Prüfe Modellname, Deployment und URL.';
  if (status === 429) return 'Zu viele Anfragen oder Kontingent erschöpft. Bitte kurz warten.';
  if (status >= 500) return `Der Anbieter hat einen Serverfehler gemeldet (${status}).`;
  return `Der Anbieter hat die Anfrage abgelehnt (${status}).`;
}

async function streamHttp(provider: AiProvider, request: ChatRequest, onText: TextSink, signal: AbortSignal, fetcher: Fetch): Promise<void> {
  const { url, headers, body } = httpRequest(provider, request);
  let response: Response;
  try {
    response = await fetcher(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new AiError('Der Anbieter ist nicht erreichbar. Prüfe URL und Netzwerk.');
  }
  if (!response.ok || !response.body) {
    const detail = (await response.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
    throw new AiError(`${statusText(response.status)}${detail ? ` Antwort: ${detail}` : ''}`);
  }
  for await (const data of sseData(response.body)) {
    if (!data || data === '[DONE]') continue;
    let event: unknown;
    try { event = JSON.parse(data); } catch { continue; }
    const text = deltaText(provider.kind, event);
    if (text) onText(text);
  }
}

async function streamAnthropic(provider: AiProvider, request: ChatRequest, onText: TextSink, signal: AbortSignal): Promise<void> {
  if (!provider.apiKey) throw new AiError('Bitte hinterlege einen API-Schlüssel für Anthropic.');
  const client = new Anthropic({ apiKey: provider.apiKey, ...(provider.baseUrl ? { baseURL: provider.baseUrl } : {}), maxRetries: 1 });
  // On the Claude API, a declined request is retried on a suitable model instead of just stopping.
  const fallback = !provider.baseUrl && FALLBACK_MODELS.has(provider.model)
    ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {};
  try {
    const stream = client.beta.messages.stream({ model: provider.model, max_tokens: 64000, system: request.system,
      messages: request.messages, ...fallback }, { signal });
    stream.on('text', text => onText(text));
    const message = await stream.finalMessage();
    if (message.stop_reason === 'refusal') throw new AiError('Das Modell hat die Anfrage abgelehnt.');
  } catch (error) {
    if (error instanceof AiError || signal.aborted) throw error;
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) throw new AiError(statusText(401));
    if (error instanceof Anthropic.NotFoundError) throw new AiError(statusText(404));
    if (error instanceof Anthropic.RateLimitError) throw new AiError(statusText(429));
    if (error instanceof Anthropic.APIConnectionError) throw new AiError('Anthropic ist nicht erreichbar. Prüfe Netzwerk und Proxy.');
    if (error instanceof Anthropic.APIError) throw new AiError(statusText(error.status ?? 0));
    throw new AiError('Die Anfrage an Anthropic ist fehlgeschlagen.');
  }
}

/** Streams the answer as text deltas; resolves when it is complete. */
export function streamChat(provider: AiProvider, request: ChatRequest, onText: TextSink, signal: AbortSignal, fetcher: Fetch = fetch): Promise<void> {
  return provider.kind === 'anthropic' ? streamAnthropic(provider, request, onText, signal) : streamHttp(provider, request, onText, signal, fetcher);
}
