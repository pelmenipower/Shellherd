import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { Client } from 'ssh2';
import { autoPasswordAnswer, sshConnectConfig } from './client-config';
import type { KeyboardPrompts } from './client-config';
import type { AskPrompts } from './auth-prompts';
import type { SshConnectionNode } from '../../shared/vault/types';
import type { AuthPromptField } from '../../shared/ssh';
import { AppError } from '../../shared/errors';

const node: SshConnectionNode = { id: 'a', type: 'connection', name: 'a', tags: [], protocol: 'ssh', host: 'h', port: 22,
  authentication: { method: 'password', password: 'x' } };
const verify = (_key: Buffer, callback: (valid: boolean) => void): void => callback(true);
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('sshConnectConfig timeouts', () => {
  it('uses the former fixed values without an argument', async () => {
    const { config } = await sshConnectConfig(node, verify);
    expect(config).toMatchObject({ readyTimeout: 120_000, keepaliveInterval: 15_000, keepaliveCountMax: 3 });
  });
  it('converts the given timeouts', async () => {
    const { config } = await sshConnectConfig(node, verify, { idleMinutes: 9, keepaliveSeconds: 7, keepaliveCount: 2, connectSeconds: 30 });
    expect(config).toMatchObject({ readyTimeout: 30_000, keepaliveInterval: 7_000, keepaliveCountMax: 2 });
  });
});

describe('autoPasswordAnswer', () => {
  const hidden = (text: string): AuthPromptField[] => [{ text, echo: false }];

  it('answers one hidden password-like question with the stored password', () => {
    expect(autoPasswordAnswer(node, hidden('Password: '), false)).toBe('x');
    expect(autoPasswordAnswer(node, hidden('Passwort: '), false)).toBe('x');
    expect(autoPasswordAnswer(node, hidden('Kennwort: '), false)).toBe('x');
  });
  it('does not answer a second time', () => {
    expect(autoPasswordAnswer(node, hidden('Password: '), true)).toBeUndefined();
  });
  it('does not answer for other methods', () => {
    const agent: SshConnectionNode = { ...node, authentication: { method: 'agent' } };
    expect(autoPasswordAnswer(agent, hidden('Password: '), false)).toBeUndefined();
  });
  it('does not answer a visible question', () => {
    expect(autoPasswordAnswer(node, [{ text: 'Password: ', echo: true }], false)).toBeUndefined();
  });
  it('does not answer a round with two fields', () => {
    expect(autoPasswordAnswer(node, [...hidden('Password: '), { text: 'Code: ', echo: false }], false)).toBeUndefined();
  });
  it('does not answer questions that are not about a password', () => {
    expect(autoPasswordAnswer(node, hidden('Verification code: '), false)).toBeUndefined();
    expect(autoPasswordAnswer(node, hidden('Passcode: '), false)).toBeUndefined();
  });
});

describe('sshConnectConfig keyboard-interactive', () => {
  /** Fake ssh2 client: only the events the handler uses. */
  function fakeClient() {
    const client = Object.assign(new EventEmitter(), { destroy: vi.fn() });
    const errors: unknown[] = [];
    client.on('error', error => errors.push(error));
    return { client, errors, asClient: client as unknown as Client };
  }
  const round = (client: EventEmitter, prompts: Array<{ prompt: string; echo?: boolean }>, finish = vi.fn()) => {
    client.emit('keyboard-interactive', 'Server name', 'Read carefully', '', prompts, finish);
    return finish;
  };
  const mfa = (answers: string[] | null = ['123456']) => {
    const ask = vi.fn<AskPrompts>(async () => answers);
    const keyboard: KeyboardPrompts = { ask, ownerId: 7, isActive: () => true };
    return { ask, keyboard };
  };
  const codeRound: Array<{ prompt: string; echo?: boolean }> = [{ prompt: 'Verification code: ', echo: false }];

  it('does not enable keyboard-interactive without a client and a handler', async () => {
    const { client, asClient } = fakeClient();
    const { keyboard } = mfa();
    expect((await sshConnectConfig(node, verify, undefined, { keyboard })).config.tryKeyboard).toBe(false);
    expect((await sshConnectConfig(node, verify, undefined, { client: asClient })).config.tryKeyboard).toBe(false);
    expect(client.listenerCount('keyboard-interactive')).toBe(0);
  });
  it('enables keyboard-interactive and hands the stream to ssh2', async () => {
    const { client, asClient } = fakeClient();
    const sock = new PassThrough();
    const { config } = await sshConnectConfig(node, verify, undefined, { client: asClient, keyboard: mfa().keyboard, sock });
    expect(config).toMatchObject({ tryKeyboard: true, sock });
    expect(client.listenerCount('keyboard-interactive')).toBe(1);
  });
  it('gives the stored password once and asks the user for everything else', async () => {
    const { client, asClient } = fakeClient();
    const { ask, keyboard } = mfa();
    await sshConnectConfig(node, verify, undefined, { client: asClient, keyboard });
    const first = round(client, [{ prompt: 'Password: ', echo: false }]);
    expect(first).toHaveBeenCalledWith(['x']);
    expect(ask).not.toHaveBeenCalled();
    const second = round(client, [{ prompt: 'Password: ', echo: false }]);
    await flush();
    expect(ask).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith(['123456']);
  });
  it('passes a cleaned-up description of the round to the user, with the owner and the active check', async () => {
    const { client, asClient } = fakeClient();
    const { ask, keyboard } = mfa();
    await sshConnectConfig(node, verify, undefined, { client: asClient, keyboard });
    round(client, codeRound);
    await flush();
    expect(ask).toHaveBeenCalledWith({
      connectionName: 'a', host: 'h:22', title: 'Server name', instructions: 'Read carefully',
      fields: [{ text: 'Verification code: ', echo: false }],
    }, { ownerId: 7, isActive: keyboard.isActive });
  });
  it('treats a missing echo flag as hidden', async () => {
    const { client, asClient } = fakeClient();
    const { ask, keyboard } = mfa();
    await sshConnectConfig(node, verify, undefined, { client: asClient, keyboard });
    round(client, [{ prompt: 'Code: ' }]);
    await flush();
    expect(ask.mock.calls[0][0].fields).toEqual([{ text: 'Code: ', echo: false }]);
  });
  it('finishes with the answers of the user', async () => {
    const { client, asClient } = fakeClient();
    const { keyboard } = mfa(['654321']);
    await sshConnectConfig(node, verify, undefined, { client: asClient, keyboard });
    const finish = round(client, codeRound);
    await flush();
    expect(finish).toHaveBeenCalledWith(['654321']);
  });
  it('emits promptCancelled and destroys the client when the user cancels', async () => {
    const { client, asClient, errors } = fakeClient();
    const { keyboard } = mfa(null);
    await sshConnectConfig(node, verify, undefined, { client: asClient, keyboard });
    const finish = round(client, codeRound);
    await flush();
    expect(finish).not.toHaveBeenCalled();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(AppError);
    expect(errors[0]).toMatchObject({ code: 'ssh.promptCancelled' });
    expect((client as unknown as { destroy: ReturnType<typeof vi.fn> }).destroy).toHaveBeenCalledTimes(1);
  });
  it('only destroys the client when the window is gone', async () => {
    const { client, asClient, errors } = fakeClient();
    const keyboard: KeyboardPrompts = { ask: async () => null, isActive: () => false };
    await sshConnectConfig(node, verify, undefined, { client: asClient, keyboard });
    round(client, codeRound);
    await flush();
    expect(errors).toHaveLength(0);
    expect((client as unknown as { destroy: ReturnType<typeof vi.fn> }).destroy).toHaveBeenCalledTimes(1);
  });
  it('treats a failed prompt like a cancel', async () => {
    const { client, asClient, errors } = fakeClient();
    const keyboard: KeyboardPrompts = { ask: async () => { throw new Error('broken'); }, isActive: () => true };
    await sshConnectConfig(node, verify, undefined, { client: asClient, keyboard });
    round(client, codeRound);
    await flush();
    expect(errors[0]).toMatchObject({ code: 'ssh.promptCancelled' });
  });
  it('stops after six rounds with promptInvalid and never asks a seventh time', async () => {
    const { client, asClient, errors } = fakeClient();
    const { ask, keyboard } = mfa(['1']);
    await sshConnectConfig(node, verify, undefined, { client: asClient, keyboard });
    for (let index = 0; index < 6; index++) {
      round(client, codeRound);
      await flush();
    }
    expect(ask).toHaveBeenCalledTimes(6);
    expect(errors).toHaveLength(0);
    round(client, codeRound);
    await flush();
    expect(ask).toHaveBeenCalledTimes(6);
    expect(errors[0]).toMatchObject({ code: 'ssh.promptInvalid' });
    expect((client as unknown as { destroy: ReturnType<typeof vi.fn> }).destroy).toHaveBeenCalledTimes(1);
  });
});
