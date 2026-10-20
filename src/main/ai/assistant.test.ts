import { describe, expect, it, vi } from 'vitest';
import type { AiEvent } from '../../shared/ai';
import type { AiSettings } from '../../shared/vault/types';
import { AiError } from './providers';
import { AssistantService } from './assistant';

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
