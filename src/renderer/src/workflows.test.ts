import { describe, expect, it } from 'vitest';
import type { Workflow } from '../../shared/vault/types';
import { fillWorkflow, searchWorkflows, workflowParams } from './workflows';

const workflow = (name: string, command: string, patch: Partial<Workflow> = {}): Workflow => ({ id: name, name, command, tags: [], ...patch });

describe('workflows', () => {
  it('finds placeholders once, in order', () => {
    expect(workflowParams('ssh {{ user }}@{{host}} -p {{port}} # {{host}}')).toEqual(['user', 'host', 'port']);
    expect(workflowParams('Get-Service')).toEqual([]);
  });

  it('fills placeholders without letting values add lines', () => {
    expect(fillWorkflow('ssh {{user}}@{{host}}', { user: 'root', host: 'web\n01\u0003' })).toBe('ssh root@web01');
    expect(fillWorkflow('echo {{missing}}!', {})).toBe('echo !');
  });

  it('searches every field and lists workflows for the current shell first', () => {
    const list = [workflow('Dienst neu starten', 'Restart-Service {{name}}', { shell: 'powershell', tags: ['dienst'] }),
      workflow('Logs ansehen', 'journalctl -u {{dienst}} -f', { shell: 'ssh', tags: ['log'] }), workflow('Platz', 'df -h')];
    expect(searchWorkflows(list, 'dienst', 'ssh').map(item => item.name)).toEqual(['Logs ansehen', 'Dienst neu starten']);
    expect(searchWorkflows(list, 'DF', null).map(item => item.name)).toEqual(['Platz']);
    expect(searchWorkflows(list, '', 'powershell')[0].name).toBe('Dienst neu starten');
  });
});
