import type { SshStep } from '../../shared/ssh';
import { formatNumber } from '../../shared/format';
import { t } from './i18n';

/** The connecting card appears only after this long, so fast connects show nothing. */
export const WAIT_MS = 400;
/** After this long in one step the footer switches to a hint. */
export const SLOW_MS = 1500;
const STEP_KEYS = {
  jump: 'terminal:timeline.steps.jump', reach:'terminal:timeline.steps.reach', hostkey: 'terminal:timeline.steps.hostkey', auth: 'terminal:timeline.steps.auth', shell: 'terminal:timeline.steps.shell',
} as const satisfies Record<SshStep, string>;
export function stepLabel(step: SshStep): string { return t(STEP_KEYS[step]); }

export interface StepMark { step: SshStep; at: number }
export interface StepView { step: SshStep; label: string; state: 'open' | 'active' | 'done'; ms?: number }

/** Before the first mark the first step is active since startedAt; marks for steps not in `steps` are ignored. */
export function stepViews(steps: readonly SshStep[], marks: readonly StepMark[], startedAt: number, now: number): StepView[] {
  const markAt: (number | undefined)[] = steps.map(step => marks.find(mark => mark.step === step)?.at);
  let active = 0;
  markAt.forEach((at, index) => { if (at !== undefined) active = index; });
  // A step without its own mark takes the start of the next one (zero time); the first one starts at startedAt.
  const starts: number[] = [];
  starts[active] = markAt[active] ?? startedAt;
  for (let index = active - 1; index >= 0; index -= 1) starts[index] = index === 0 ? markAt[0] ?? startedAt : markAt[index] ?? starts[index + 1];
  return steps.map((step, index): StepView => {
    const label = stepLabel(step);
    if (index < active) return { step, label, state: 'done', ms: Math.max(0, starts[index + 1] - starts[index]) };
    if (index === active) return { step, label, state: 'active', ms: Math.max(0, now - starts[index]) };
    return { step, label, state: 'open' };
  });
}

/** 400 → '0,4 s' (de-DE), '0.4 s' (en-US). */
export function formatSeconds(ms: number): string {
  return t('terminal:timeline.seconds', { value: formatNumber(ms / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) });
}

/** 'Gesamt 1,2 s', or after SLOW_MS in the active step the slow text; slow = true colours it --color-warn. */
export function cardFooter(views: readonly StepView[], startedAt: number, now: number): { text: string; slow: boolean } {
  const active = views.find(view => view.state === 'active');
  if (active && (active.ms ?? 0) >= SLOW_MS) {
    // A known key checks in milliseconds; a long hostkey step is the confirmation dialog, not a slow server.
    if (active.step === 'hostkey') return { text: t('terminal:timeline.waitingHostKey'), slow: false };
    return { text: t(active.step === 'reach' ? 'terminal:timeline.slowServer' : 'terminal:timeline.slowGeneric'), slow: true };
  }
  return { text: t('terminal:timeline.total', { time: formatSeconds(Math.max(0, now - startedAt)) }), slow: false };
}

/** Seconds since `endedAt`: '12 s ago' (at least 1 s), from 60 s '2 min ago'. */
export function formatAgo(ms: number): string {
  const seconds = Math.max(1, Math.floor(ms / 1000));
  return seconds < 60 ? t('terminal:timeline.agoSeconds', { seconds }) : t('terminal:timeline.agoMinutes', { minutes: Math.floor(seconds / 60) });
}
