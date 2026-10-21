import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loginInput, rootShellCommand } from './login';
import type { RootShellPlan } from './login';

const marker = '[terminus-sudo-0123456789abcdef]';
const ready = '[terminus-ready-0123456789abcdef]';
const hints = (['de-DE', 'en-US'] as const).map(locale =>
  (JSON.parse(readFileSync(new URL(`../../shared/locales/${locale}/main.json`, import.meta.url), 'utf8')) as { terminal: { sudoNeedsPassword: string } }).terminal.sudoNeedsPassword);
const plans: RootShellPlan[] = [{ kind: 'password', marker, ready }, ...hints.map(hint => ({ kind: 'manual' as const, ready, hint }))];

describe('rootShellCommand', () => {
  it.each(plans)('ends with sudo -n -i and has no backslash outside quote escapes (%#)', plan => {
    const command = rootShellCommand(plan);
    expect(command).toContain('sudo -n -i; exit $?');
    expect(command.replaceAll(`'\\''`, '')).not.toContain('\\');
  });

  it('password mode is the container prompt script with -i', () => {
    const command = rootShellCommand(plans[0]);
    expect(command).toMatch(/^sh -c 'PATH="\$PATH:\/usr\/sbin:\/sbin"; sudo -p '\\''\[terminus-sudo-[0-9a-f]{16}\]'\\'' -v && printf %s '\\''\[terminus-ready-[0-9a-f]{16}\]'\\'' && sudo -n -i; exit \$\?'$/);
    expect(command).toContain('-v && printf %s');
  });

  it('manual mode checks with sudo -n true, never sudo -n -v', () => {
    for (const plan of plans.slice(1)) {
      const command = rootShellCommand(plan);
      expect(command).toContain('sudo -n true 2>/dev/null ||');
      expect(command).not.toContain('-v && printf');
      expect(command).not.toContain('sudo -n -v');
      expect(command).not.toContain('-p ');
      expect(command).toContain('sudo -v; }; } && printf %s ');
    }
  });

  it('keeps the hint texts free of characters a shell could reinterpret', () => {
    for (const hint of hints) expect(hint).not.toMatch(/['\\%!$`"]/);
  });

  it('rejects markers with a percent sign or a space', () => {
    expect(() => rootShellCommand({ kind: 'manual', ready: '[terminus-ready-%s%s%s%s]', hint: 'x' })).toThrow('Invalid sudo marker');
    expect(() => rootShellCommand({ kind: 'manual', ready: '[terminus ready 0123456789]', hint: 'x' })).toThrow('Invalid sudo marker');
    expect(() => rootShellCommand({ kind: 'password', marker: 'a b a b a b a b', ready })).toThrow('Invalid sudo marker');
    expect(() => rootShellCommand({ kind: 'password', marker, ready: '100%100%' })).toThrow('Invalid sudo marker');
  });
});

describe('loginInput', () => {
  it('ends every line with Enter', () => {
    expect(loginInput(['uptime', 'df -h /'])).toBe('uptime\rdf -h /\r');
    expect(loginInput([])).toBe('');
  });
});
