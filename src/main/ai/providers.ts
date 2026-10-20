import Anthropic from '@anthropic-ai/sdk';
import type { AiProvider } from '../../shared/vault/types';
import type { AiChatMessage } from '../../shared/ai';
import { AppError, type ErrorCode } from '../../shared/errors';

export interface ChatRequest { system: string; messages: AiChatMessage[] }
export type TextSink = (text: string) => void;
/** Injected so tests never reach the network. */
export type Fetch = typeof fetch;

/** Coded errors for the user; params and detail never contain the API key. */
export class AiError extends AppError {}

/** Models that accept the server-side refusal fallback on the Claude API. */
const FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);

const trimSlash = (url: string): string => url.replace(/\/+$/, '');

export interface HttpCall { label: string; url: string; headers: Record<string, string>; body: unknown }

/**
 * Azure: the three ways a deployment can be reached. Any Foundry or Azure OpenAI URL works, including
 * a project URL (…/api/projects/<name>): explicit …/openai/v1 or …/models URLs are used as given,
 * otherwise the resource is derived and all fitting ways are tried in order.
 */
function azureCalls(provider: AiProvider, chat: unknown[]): HttpCall[] {
  if (!provider.baseUrl) throw new AiError('ai.azureEndpointMissing');
  const headers: Record<string, string> = provider.apiKey ? { 'api-key': provider.apiKey } : {};
  const version = (fallback: string): string => encodeURIComponent(provider.apiVersion || fallback);
  const v1 = (base: string): HttpCall => ({ label: 'openai/v1', url: `${base}/chat/completions`, headers, body: { model: provider.model, stream: true, messages: chat } });
  const models = (base: string): HttpCall => ({ label: 'models', url: `${base}/chat/completions?api-version=${version('2024-05-01-preview')}`, headers,
    body: { model: provider.model, stream: true, messages: chat } });
  const deployment = (origin: string): HttpCall => ({ label: 'openai/deployments',
    url: `${origin}/openai/deployments/${encodeURIComponent(provider.model)}/chat/completions?api-version=${version('2024-10-21')}`, headers, body: { stream: true, messages: chat } });
  let url: URL;
  try { url = new URL(provider.baseUrl); } catch { throw new AiError('ai.endpointInvalid'); }
  const endpoint = trimSlash(`${url.origin}${url.pathname}`);
  if (/\/openai\/v1$/i.test(endpoint)) return [v1(endpoint)];
  if (/\/models$/i.test(endpoint)) return [models(endpoint)];
  const calls = [v1(`${url.origin}/openai/v1`)];
  if (/\.services\.ai\.azure\.com$/i.test(url.hostname)) calls.push(models(`${url.origin}/models`));
  calls.push(deployment(url.origin));
  return calls;
}

/** Requests of the HTTP-based providers; several when the right way has to be found (Azure). */
export function httpRequests(provider: AiProvider, request: ChatRequest): HttpCall[] {
  const chat = [{ role: 'system', content: request.system }, ...request.messages];
  if (provider.kind === 'openai') {
    return [{ label: 'chat/completions', url: `${trimSlash(provider.baseUrl ?? 'https://api.openai.com/v1')}/chat/completions`,
      headers: provider.apiKey ? { authorization: `Bearer ${provider.apiKey}` } : {},
      body: { model: provider.model, stream: true, messages: chat } }];
  }
  if (provider.kind === 'azure') return azureCalls(provider, chat);
  if (provider.kind === 'gemini') {
    return [{ label: 'streamGenerateContent', url: `${trimSlash(provider.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta')}/models/${encodeURIComponent(provider.model)}:streamGenerateContent?alt=sse`,
      headers: provider.apiKey ? { 'x-goog-api-key': provider.apiKey } : {},
      body: { systemInstruction: { parts: [{ text: request.system }] },
        contents: request.messages.map(message => ({ role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }] })) } }];
  }
  throw new AiError('ai.noHttp');
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

function statusError(status: number, detail?: string): AiError {
  const code: ErrorCode = status === 401 || status === 403 ? 'ai.keyRejected' : status === 404 ? 'ai.notFound'
    : status === 429 ? 'ai.rateLimited' : status >= 500 ? 'ai.serverError' : 'ai.rejected';
  return new AiError(code, code === 'ai.serverError' || code === 'ai.rejected' ? { status } : undefined, detail);
}

/** Only "this way does not exist here" moves on to the next way; key or quota errors stop at once. */
const tryNext = (status: number): boolean => status === 400 || status === 404;

async function streamHttp(provider: AiProvider, request: ChatRequest, onText: TextSink, signal: AbortSignal, fetcher: Fetch): Promise<void> {
  const calls = httpRequests(provider, request);
  const failures: string[] = [];
  let response: Response | undefined;
  for (const [index, call] of calls.entries()) {
    try {
      response = await fetcher(call.url, { method: 'POST', headers: { 'content-type': 'application/json', ...call.headers }, body: JSON.stringify(call.body), signal });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new AiError('ai.unreachable');
    }
    if (response.ok && response.body) break;
    const detail = (await response.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
    if (index < calls.length - 1 && tryNext(response.status)) { failures.push(`${call.label}: ${response.status}${detail ? ` ${detail.slice(0, 120)}` : ''}`); continue; }
    const parts = [...(detail ? [`${call.label}: ${detail}`] : []), ...failures];
    throw statusError(response.status, parts.join(' · ') || undefined);
  }
  if (!response?.body) throw new AiError('ai.noResponse');
  for await (const data of sseData(response.body)) {
    if (!data || data === '[DONE]') continue;
    let event: unknown;
    try { event = JSON.parse(data); } catch { continue; }
    const text = deltaText(provider.kind, event);
    if (text) onText(text);
  }
}

async function streamAnthropic(provider: AiProvider, request: ChatRequest, onText: TextSink, signal: AbortSignal): Promise<void> {
  if (!provider.apiKey) throw new AiError('ai.keyMissing');
  const client = new Anthropic({ apiKey: provider.apiKey, ...(provider.baseUrl ? { baseURL: provider.baseUrl } : {}), maxRetries: 1 });
  // On the Claude API, a declined request is retried on a suitable model instead of just stopping.
  const fallback = !provider.baseUrl && FALLBACK_MODELS.has(provider.model)
    ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {};
  try {
    const stream = client.beta.messages.stream({ model: provider.model, max_tokens: 64000, system: request.system,
      messages: request.messages, ...fallback }, { signal });
    stream.on('text', text => onText(text));
    const message = await stream.finalMessage();
    if (message.stop_reason === 'refusal') throw new AiError('ai.refused');
  } catch (error) {
    if (error instanceof AiError || signal.aborted) throw error;
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) throw statusError(401);
    if (error instanceof Anthropic.NotFoundError) throw statusError(404);
    if (error instanceof Anthropic.RateLimitError) throw statusError(429);
    if (error instanceof Anthropic.APIConnectionError) throw new AiError('ai.anthropicUnreachable');
    if (error instanceof Anthropic.APIError) throw statusError(error.status ?? 0);
    throw new AiError('ai.anthropicFailed');
  }
}

/** Streams the answer as text deltas; resolves when it is complete. */
export function streamChat(provider: AiProvider, request: ChatRequest, onText: TextSink, signal: AbortSignal, fetcher: Fetch = fetch): Promise<void> {
  return provider.kind === 'anthropic' ? streamAnthropic(provider, request, onText, signal) : streamHttp(provider, request, onText, signal, fetcher);
}
