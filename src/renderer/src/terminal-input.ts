import type { TerminalTab } from './terminal-tabs';
import { isRunning } from './terminal-tabs';
import { liveSessions } from './session-registry';
import { insertableCommand } from './assistant-chat';
import { t } from './i18n';

/**
 * Types one line into a terminal tab without pressing Enter. Returns null on success, otherwise
 * why nothing was typed.
 */
export async function typeIntoTerminal(tab: TerminalTab | undefined, command: string): Promise<{ typed: string } | { reason: string }> {
  const text = insertableCommand(command);
  if (!text) return { reason: t('terminal:input.multiline') };
  const live = tab ? liveSessions.get(tab.id) : undefined;
  if (!tab || !live?.terminal || !isRunning(tab)) return { reason: t('terminal:input.notConnected') };
  if (live.terminal.fullscreen()) return { reason: t('terminal:input.fullscreen') };
  try {
    await window.desktopApi.sshInput({ sessionId: live.sessionId, data: text });
    return { typed: text };
  } catch { return { reason: t('terminal:input.failed') }; }
}
