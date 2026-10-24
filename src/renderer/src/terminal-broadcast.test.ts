import { describe, expect, it } from 'vitest';
import type { TerminalTab } from './terminal-tabs';
import { broadcastable, broadcastEligible, broadcastGroup } from './terminal-broadcast';

describe('broadcastable', () => {
  it('passes typed input and pastes', () => {
    expect(broadcastable('ls\r')).toBe(true);
    expect(broadcastable('\x1b[A')).toBe(true);
    expect(broadcastable('\x03')).toBe(true);
    expect(broadcastable('line 1\nline 2')).toBe(true);
  });

  it('drops terminal replies and reports', () => {
    expect(broadcastable('\x1b[24;1R')).toBe(false);
    expect(broadcastable('\x1b[?1;2c')).toBe(false);
    expect(broadcastable('\x1b[I')).toBe(false);
    expect(broadcastable('\x1b[O')).toBe(false);
    expect(broadcastable('\x1b[<0;10;5M')).toBe(false);
  });
});

const tab = (connection: Partial<TerminalTab['connection']>, status: TerminalTab['status'] = 'connected') =>
  ({ connection: { id: 'h', name: 'n', protocol: 'ssh', address: 'a', ...connection }, status }) as Pick<TerminalTab, 'connection' | 'status'>;

describe('broadcastEligible', () => {
  it('accepts connected SSH and local shells', () => {
    expect(broadcastEligible(tab({ protocol: 'ssh' }))).toBe(true);
    expect(broadcastEligible(tab({ protocol: 'powershell' }))).toBe(true);
    expect(broadcastEligible(tab({ protocol: 'cmd' }))).toBe(true);
  });

  it('rejects tabs that are not connected', () => {
    expect(broadcastEligible(tab({ protocol: 'ssh' }, 'connecting'))).toBe(false);
  });

  it('rejects views, targets, pods and other protocols', () => {
    expect(broadcastEligible(tab({ view: 'files' }))).toBe(false);
    expect(broadcastEligible(tab({ view: 'containers' }))).toBe(false);
    expect(broadcastEligible(tab({ view: 'welcome' }))).toBe(false);
    expect(broadcastEligible(tab({ target: { mode: 'shell' } as never }))).toBe(false);
    expect(broadcastEligible(tab({ kube: { mode: 'shell' } as never }))).toBe(false);
    expect(broadcastEligible(tab({ protocol: 'rdp' }))).toBe(false);
    expect(broadcastEligible(tab({ protocol: 'sftp' }))).toBe(false);
  });
});

describe('broadcastGroup', () => {
  it('needs at least two members', () => {
    broadcastGroup.set(['a']);
    expect(broadcastGroup.others('a')).toEqual([]);
    broadcastGroup.set([]);
  });

  it('returns the other members of the group', () => {
    broadcastGroup.set(['a', 'b', 'c']);
    expect(broadcastGroup.others('a')).toEqual(['b', 'c']);
    expect(broadcastGroup.others('x')).toEqual([]);
    broadcastGroup.set([]);
  });
});
