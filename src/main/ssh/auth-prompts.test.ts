import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthPrompts, cleanPromptRequest } from './auth-prompts';
import { IPC_CHANNELS } from '../../shared/ipc';
import type { AuthPromptRequest } from '../../shared/ssh';

type Draft = Omit<AuthPromptRequest, 'promptId'>;
type Sent = AuthPromptRequest;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const draft = (overrides: Partial<Draft> = {}): Draft => ({
  connectionName: 'Bastion', host: 'bastion.example:22', title: 'Login', instructions: 'Enter the code',
  fields: [{ text: 'Verification code: ', echo: true }], ...overrides,
});

/** Target window id equals the owner id (1 without an owner). */
function setup() {
  const send = vi.fn<(channel: string, payload: unknown) => void>();
  const state = { unlocked: true, reachable: true };
  const prompts = new AuthPrompts({
    resolveTarget: ownerId => (state.reachable ? { id: ownerId ?? 1, send } : undefined),
    isUnlocked: () => state.unlocked,
  });
  return { prompts, send, state };
}

type Fixture = ReturnType<typeof setup>;
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const sentOf = (send: Fixture['send'], channel: string) =>
  send.mock.calls.filter(([name]) => name === channel).map(([, payload]) => payload);
/** The n-th prompt that reached the window. */
const promptOf = (send: Fixture['send'], index = 0) => sentOf(send, IPC_CHANNELS.sshAuthPrompt)[index] as Sent;

describe('cleanPromptRequest', () => {
  it('removes control characters and keeps newlines only in instructions', () => {
    const cleaned = cleanPromptRequest(draft({
      title: 'A\u0007B\nC', instructions: 'x\u0001\ny\u009bz\u007f\tw', fields: [{ text: 'Code\r\n\u0085:', echo: true }],
    }));
    expect(cleaned).toEqual(draft({ title: 'ABC', instructions: 'x\nyzw', fields: [{ text: 'Code:', echo: true }] }));
  });
  it('caps title at 128, field text at 256 and instructions at 1024 characters', () => {
    const cleaned = cleanPromptRequest(draft({ title: 't'.repeat(200), instructions: 'i'.repeat(2_000), fields: [{ text: 'f'.repeat(300), echo: false }] }));
    expect(cleaned?.title).toHaveLength(128);
    expect(cleaned?.instructions).toHaveLength(1_024);
    expect(cleaned?.fields[0].text).toHaveLength(256);
  });
  it('rejects zero fields and more than eight, accepts eight', () => {
    expect(cleanPromptRequest(draft({ fields: [] }))).toBeUndefined();
    const nine = Array.from({ length: 9 }, () => ({ text: 'Code:', echo: true }));
    expect(cleanPromptRequest(draft({ fields: nine }))).toBeUndefined();
    expect(cleanPromptRequest(draft({ fields: nine.slice(1) }))?.fields).toHaveLength(8);
  });
});

describe('AuthPrompts ask and answer', () => {
  it('sends the cleaned request to the owner window and resolves with the answers', async () => {
    const { prompts, send } = setup();
    const pending = prompts.ask(draft({ title: 'T\u0000' }), { ownerId: 7, isActive: () => true });
    await flush();
    const request = promptOf(send);
    expect(request).toEqual({ ...draft({ title: 'T' }), promptId: expect.stringMatching(UUID) });
    prompts.answer(7, { promptId: request.promptId, answers: ['123456'] });
    await expect(pending).resolves.toEqual(['123456']);
  });
  it('accepts null as a cancel', async () => {
    const { prompts, send } = setup();
    const pending = prompts.ask(draft(), { isActive: () => true });
    await flush();
    prompts.answer(1, { promptId: promptOf(send).promptId, answers: null });
    await expect(pending).resolves.toBeNull();
  });
  it('ignores answers from another sender', async () => {
    const { prompts, send } = setup();
    const pending = prompts.ask(draft(), { ownerId: 7, isActive: () => true });
    await flush();
    const { promptId } = promptOf(send);
    prompts.answer(8, { promptId, answers: ['1'] });
    prompts.answer(7, { promptId, answers: ['1'] });
    await expect(pending).resolves.toEqual(['1']);
  });
  it('ignores an old prompt id', async () => {
    const { prompts, send } = setup();
    const first = prompts.ask(draft(), { isActive: () => true });
    await flush();
    const oldId = promptOf(send).promptId;
    prompts.answer(1, { promptId: oldId, answers: ['1'] });
    await first;
    const second = prompts.ask(draft(), { isActive: () => true });
    await flush();
    prompts.answer(1, { promptId: oldId, answers: ['2'] });
    prompts.answer(1, { promptId: promptOf(send, 1).promptId, answers: ['3'] });
    await expect(second).resolves.toEqual(['3']);
  });
  it('ignores answers with the wrong count or an overlong string', async () => {
    const { prompts, send } = setup();
    const pending = prompts.ask(draft({ fields: [{ text: 'A:', echo: true }, { text: 'B:', echo: false }] }), { isActive: () => true });
    await flush();
    const { promptId } = promptOf(send);
    prompts.answer(1, { promptId, answers: ['only one'] });
    prompts.answer(1, { promptId, answers: ['a', 'b', 'c'] });
    prompts.answer(1, { promptId, answers: ['a', 'x'.repeat(1_025)] });
    prompts.answer(1, { promptId, answers: ['a', 'b'] });
    await expect(pending).resolves.toEqual(['a', 'b']);
  });
  it('returns null without sending when the vault is locked', async () => {
    const { prompts, send, state } = setup();
    state.unlocked = false;
    await expect(prompts.ask(draft(), { isActive: () => true })).resolves.toBeNull();
    expect(send).not.toHaveBeenCalled();
  });
  it('returns null without sending when no window can take the prompt', async () => {
    const { prompts, send, state } = setup();
    state.reachable = false;
    await expect(prompts.ask(draft(), { isActive: () => true })).resolves.toBeNull();
    expect(send).not.toHaveBeenCalled();
  });
  it('returns null for a request without fields', async () => {
    const { prompts, send } = setup();
    await expect(prompts.ask(draft({ fields: [] }), { isActive: () => true })).resolves.toBeNull();
    expect(send).not.toHaveBeenCalled();
  });
  it('returns null and reports closed when inactive before sending', async () => {
    const { prompts, send } = setup();
    await expect(prompts.ask(draft(), { ownerId: 7, isActive: () => false })).resolves.toBeNull();
    expect(sentOf(send, IPC_CHANNELS.sshAuthPrompt)).toHaveLength(0);
    expect(sentOf(send, IPC_CHANNELS.sshAuthPromptClosed)).toEqual([{ promptId: expect.stringMatching(UUID) }]);
  });
  it('returns null and reports closed when inactive after the answer', async () => {
    const { prompts, send } = setup();
    let active = true;
    const pending = prompts.ask(draft(), { isActive: () => active });
    await flush();
    active = false;
    const { promptId } = promptOf(send);
    prompts.answer(1, { promptId, answers: ['1'] });
    await expect(pending).resolves.toBeNull();
    expect(sentOf(send, IPC_CHANNELS.sshAuthPromptClosed)).toEqual([{ promptId }]);
  });
  it('returns null when the window is gone while sending', async () => {
    const { prompts, send } = setup();
    send.mockImplementationOnce(() => { throw new Error('destroyed'); });
    await expect(prompts.ask(draft(), { isActive: () => true })).resolves.toBeNull();
  });
  it('shows one prompt at a time and starts the next after the answer', async () => {
    const { prompts, send } = setup();
    const first = prompts.ask(draft({ title: 'first' }), { isActive: () => true });
    const second = prompts.ask(draft({ title: 'second' }), { isActive: () => true });
    await flush();
    expect(sentOf(send, IPC_CHANNELS.sshAuthPrompt)).toHaveLength(1);
    prompts.answer(1, { promptId: promptOf(send).promptId, answers: ['a'] });
    await expect(first).resolves.toEqual(['a']);
    await flush();
    expect(sentOf(send, IPC_CHANNELS.sshAuthPrompt)).toHaveLength(2);
    prompts.answer(1, { promptId: promptOf(send, 1).promptId, answers: ['b'] });
    await expect(second).resolves.toEqual(['b']);
  });
});

describe('AuthPrompts cancellation', () => {
  it('cancelAll resolves the open and the queued prompts with null', async () => {
    const { prompts, send } = setup();
    const open = prompts.ask(draft(), { isActive: () => true });
    const queued = prompts.ask(draft(), { isActive: () => true });
    await flush();
    prompts.cancelAll();
    await expect(open).resolves.toBeNull();
    await expect(queued).resolves.toBeNull();
    expect(sentOf(send, IPC_CHANNELS.sshAuthPrompt)).toHaveLength(1);
    expect(sentOf(send, IPC_CHANNELS.sshAuthPromptClosed)).toHaveLength(1);
  });
  it('cancelOwner cancels only that owner, running and queued', async () => {
    const { prompts, send } = setup();
    const mine = prompts.ask(draft(), { ownerId: 7, isActive: () => true });
    const queuedMine = prompts.ask(draft(), { ownerId: 7, isActive: () => true });
    const theirs = prompts.ask(draft(), { ownerId: 8, isActive: () => true });
    await flush();
    prompts.cancelOwner(7);
    await expect(mine).resolves.toBeNull();
    await expect(queuedMine).resolves.toBeNull();
    await flush();
    const { promptId } = promptOf(send, 1);
    prompts.answer(8, { promptId, answers: ['still here'] });
    await expect(theirs).resolves.toEqual(['still here']);
    expect(sentOf(send, IPC_CHANNELS.sshAuthPromptClosed)).toEqual([{ promptId: promptOf(send).promptId }]);
  });
  it('a cancelled prompt cannot be answered afterwards', async () => {
    const { prompts, send } = setup();
    const pending = prompts.ask(draft(), { ownerId: 7, isActive: () => true });
    await flush();
    const { promptId } = promptOf(send);
    prompts.cancelOwner(7);
    prompts.answer(7, { promptId, answers: ['late'] });
    await expect(pending).resolves.toBeNull();
  });
});

describe('AuthPrompts liveness poll', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('ends an open prompt with null when the owner goes inactive and moves on to the next one', async () => {
    const { prompts, send } = setup();
    let active = true;
    const first = prompts.ask(draft({ title: 'first' }), { ownerId: 7, isActive: () => active });
    const second = prompts.ask(draft({ title: 'second' }), { ownerId: 7, isActive: () => true });
    await vi.advanceTimersByTimeAsync(0);
    const { promptId } = promptOf(send);
    active = false;
    await vi.advanceTimersByTimeAsync(500);
    await expect(first).resolves.toBeNull();
    expect(sentOf(send, IPC_CHANNELS.sshAuthPromptClosed)).toEqual([{ promptId }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(sentOf(send, IPC_CHANNELS.sshAuthPrompt)).toHaveLength(2);
    prompts.answer(7, { promptId: promptOf(send, 1).promptId, answers: ['b'] });
    await expect(second).resolves.toEqual(['b']);
  });

  it('leaves no timer behind after an answer, a cancel or cancelAll', async () => {
    const { prompts, send } = setup();
    const answered = prompts.ask(draft(), { ownerId: 7, isActive: () => true });
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    prompts.answer(7, { promptId: promptOf(send).promptId, answers: ['1'] });
    await expect(answered).resolves.toEqual(['1']);
    expect(vi.getTimerCount()).toBe(0);

    const cancelled = prompts.ask(draft(), { ownerId: 7, isActive: () => true });
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    prompts.cancelOwner(7);
    await expect(cancelled).resolves.toBeNull();
    expect(vi.getTimerCount()).toBe(0);

    const open = prompts.ask(draft(), { isActive: () => true });
    const queued = prompts.ask(draft(), { isActive: () => true });
    await vi.advanceTimersByTimeAsync(0);
    prompts.cancelAll();
    await expect(open).resolves.toBeNull();
    await expect(queued).resolves.toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
