import type { Workflow } from '../../shared/vault/types';
import type { AiTerminalContext } from '../../shared/ai';
import { compareText, foldCase } from '../../shared/format';

const PLACEHOLDER = /\{\{\s*([\p{L}\p{N}_ .-]{1,40}?)\s*\}\}/gu;

/** Placeholder names in order of first use, e.g. `ssh {{user}}@{{host}}` → user, host. */
export function workflowParams(command: string): string[] {
  return [...new Set([...command.matchAll(PLACEHOLDER)].map(match => match[1].trim()))];
}

/** Command with every placeholder replaced; values lose line breaks and control characters. */
export function fillWorkflow(command: string, values: Record<string, string>): string {
  // eslint-disable-next-line no-control-regex
  return command.replace(PLACEHOLDER, (_match, name: string) => (values[name.trim()] ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ''));
}

const normalize = foldCase;

/** Search across name, tags, description and command; workflows for the current shell first. */
export function searchWorkflows(workflows: Workflow[], query: string, shell: AiTerminalContext['shell'] | null): Workflow[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  const matches = workflows.filter(workflow => {
    const haystack = normalize([workflow.name, workflow.description ?? '', workflow.command, ...workflow.tags].join(' '));
    return words.every(word => haystack.includes(word));
  });
  const rank = (workflow: Workflow): number => !workflow.shell || workflow.shell === shell ? 0 : 1;
  return matches.sort((a, b) => rank(a) - rank(b) || compareText(a.name, b.name));
}
