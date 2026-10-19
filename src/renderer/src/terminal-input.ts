import type { TerminalTab } from './terminal-tabs';
import { isRunning } from './terminal-tabs';
import { liveSessions } from './session-registry';
import { insertableCommand } from './assistant-chat';

/**
 * Types one line into a terminal tab without pressing Enter. Returns null on success, otherwise
 * why nothing was typed.
 */
export async function typeIntoTerminal(tab: TerminalTab | undefined, command: string): Promise<{ typed: string } | { reason: string }> {
  const text = insertableCommand(command);
  if (!text) return { reason: 'Mehrzeiliger Befehl: bitte Zeile für Zeile kopieren.' };
  const live = tab ? liveSessions.get(tab.id) : undefined;
  if (!tab || !live?.terminal || !isRunning(tab)) return { reason: 'Das Terminal ist nicht verbunden; der Befehl wurde nicht eingetippt.' };
  if (live.terminal.fullscreen()) return { reason: 'Im Terminal läuft ein Vollbildprogramm; der Befehl wurde nicht eingetippt.' };
  try {
    await window.desktopApi.sshInput({ sessionId: live.sessionId, data: text });
    return { typed: text };
  } catch { return { reason: 'Der Befehl konnte nicht eingetippt werden.' }; }
}
