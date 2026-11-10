import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';

const mocks = vi.hoisted(() => ({ all: [] as unknown[], catalog: vi.fn(() => ({ providers: [] })) }));
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => mocks.all },
  ipcMain: { handle: () => {} },
  webContents: { fromId: () => undefined },
}));
vi.mock('../vault/ipc', () => ({ vaultSessionManager: { getSnapshot: () => ({ vault: { ai: {} } }) } }));
vi.mock('./assistant', () => ({ AssistantService: class { catalog = mocks.catalog; } }));

import { registerAiIpcHandlers } from './ipc';
import { WindowRegistry } from '../windows';

const fakeWindow = (id: number): BrowserWindow & { send: ReturnType<typeof vi.fn> } => {
  const send = vi.fn();
  return { webContents: { id, send }, on: () => {}, isDestroyed: () => false, send } as never;
};

describe('AI catalog broadcast', () => {
  beforeEach(() => { mocks.all = []; });
  it('reaches only registry windows, not unregistered ones', () => {
    const registry = new WindowRegistry();
    const main = fakeWindow(1), secondary = fakeWindow(2), media = fakeWindow(3);
    registry.register(main, 'main'); registry.register(secondary, 'secondary');
    mocks.all = [main, secondary, media];
    registerAiIpcHandlers(registry).broadcast();
    expect(main.send).toHaveBeenCalledTimes(1);
    expect(secondary.send).toHaveBeenCalledTimes(1);
    expect(media.send).not.toHaveBeenCalled();
  });
  it('does nothing without a main window', () => {
    expect(() => registerAiIpcHandlers(new WindowRegistry()).broadcast()).not.toThrow();
  });
});
