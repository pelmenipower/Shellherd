import type { AiCliConnectionNode, AiCliTool } from './vault/types';

/** AI command line tools Terminus can start in a tab; each brings its own login. */
export const AI_CLI_TOOLS: Record<Exclude<AiCliTool, 'custom'>, { label: string; command: string; install: string }> = {
  claude: { label: 'Claude Code', command: 'claude', install: 'npm install -g @anthropic-ai/claude-code' },
  codex: { label: 'Codex CLI', command: 'codex', install: 'npm install -g @openai/codex' },
  gemini: { label: 'Gemini CLI', command: 'gemini', install: 'npm install -g @google/gemini-cli' },
};

export function aiCliLabel(node: Pick<AiCliConnectionNode, 'tool' | 'command'>): string {
  return node.tool === 'custom' ? node.command?.trim().split(/\s+/)[0] || 'Eigener Befehl' : AI_CLI_TOOLS[node.tool].label;
}

/** The command typed into cmd.exe; a preset tool is started by name, so PATH decides which copy runs. */
export function aiCliCommandLine(node: Pick<AiCliConnectionNode, 'tool' | 'command'>): string {
  return node.tool === 'custom' ? (node.command ?? '').trim() : AI_CLI_TOOLS[node.tool].command;
}
