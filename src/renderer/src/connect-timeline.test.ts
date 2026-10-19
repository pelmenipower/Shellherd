import { describe, expect, it } from 'vitest';
import type { SshStep } from '../../shared/ssh';
import { SLOW_MS, WAIT_MS, cardFooter, formatAgo, formatSeconds, stepLabel, stepViews } from './connect-timeline';

const SSH: SshStep[] = ['reach', 'hostkey', 'auth', 'shell'];

describe('connect-timeline', () => {
  it('exposes the thresholds and German labels', () => {
    expect(WAIT_MS).toBe(400);
    expect(SLOW_MS).toBe(1500);
    expect((['reach', 'hostkey', 'auth', 'shell'] as const).map(stepLabel)).toEqual(['Server erreichen', 'Server-Schlüssel prüfen', 'Anmelden', 'Shell öffnen']);
  });

  it('activates the first step since startedAt before the first mark', () => {
    const views = stepViews(SSH, [], 1000, 1700);
    expect(views.map(view => view.state)).toEqual(['active', 'open', 'open', 'open']);
    expect(views[0]).toEqual({ step: 'reach', label: 'Server erreichen', state: 'active', ms: 700 });
    expect(views[1].ms).toBeUndefined();
  });

  it('marks earlier steps done with their duration and the latest one active', () => {
    const views = stepViews(SSH, [{ step: 'reach', at: 1000 }, { step: 'hostkey', at: 1400 }, { step: 'auth', at: 1900 }], 1000, 2500);
    expect(views.map(view => view.state)).toEqual(['done', 'done', 'active', 'open']);
    expect(views.map(view => view.ms)).toEqual([400, 500, 600, undefined]);
  });

  it('measures the first step from startedAt when its mark is missing', () => {
    const views = stepViews(SSH, [{ step: 'hostkey', at: 1300 }], 1000, 1500);
    expect(views[0]).toMatchObject({ state: 'done', ms: 300 });
    expect(views[1]).toMatchObject({ state: 'active', ms: 200 });
  });

  it('gives a skipped step zero time', () => {
    const views = stepViews(SSH, [{ step: 'reach', at: 1000 }, { step: 'auth', at: 1800 }], 1000, 2000);
    expect(views.map(view => view.state)).toEqual(['done', 'done', 'active', 'open']);
    expect(views.map(view => view.ms)).toEqual([800, 0, 200, undefined]);
  });

  it('ignores marks for steps that are not in the list', () => {
    const views = stepViews(['shell'], [{ step: 'reach', at: 1100 }, { step: 'auth', at: 1200 }], 1000, 1500);
    expect(views).toEqual([{ step: 'shell', label: 'Shell öffnen', state: 'active', ms: 500 }]);
  });

  it('keeps the first mark of a repeated step and never goes backwards', () => {
    const views = stepViews(SSH, [{ step: 'auth', at: 1500 }, { step: 'reach', at: 1600 }], 1000, 2000);
    expect(views.map(view => view.state)).toEqual(['done', 'done', 'active', 'open']);
  });

  it('shows the total while nothing is slow', () => {
    const views = stepViews(SSH, [], 1000, 2200);
    expect(cardFooter(views, 1000, 2200)).toEqual({ text: 'Gesamt 1,2 s', slow: false });
  });

  it('shows the server hint when the reach step is slow', () => {
    const views = stepViews(SSH, [], 1000, 2500);
    expect(cardFooter(views, 1000, 2500)).toEqual({ text: 'Der Server antwortet langsam …', slow: true });
  });

  it('shows the generic hint when another step is slow', () => {
    const marks = [{ step: 'reach' as const, at: 1000 }, { step: 'auth' as const, at: 1200 }];
    expect(cardFooter(stepViews(SSH, marks, 1000, 3000), 1000, 3000)).toEqual({ text: 'Dauert länger als üblich …', slow: true });
    expect(cardFooter(stepViews(['shell'], [], 1000, 2600), 1000, 2600)).toEqual({ text: 'Dauert länger als üblich …', slow: true });
  });

  it('points to the host key prompt instead of warning when the hostkey step waits', () => {
    const marks = [{ step: 'reach' as const, at: 1000 }, { step: 'hostkey' as const, at: 1100 }];
    expect(cardFooter(stepViews(SSH, marks, 1000, 3000), 1000, 3000))
      .toEqual({ text: 'Wartet auf deine Bestätigung des Server-Schlüssels …', slow: false });
  });

  it('is not slow just below the limit', () => {
    expect(cardFooter(stepViews(SSH, [], 0, 1499), 0, 1499).slow).toBe(false);
  });

  it('formats seconds with a decimal comma', () => {
    expect(formatSeconds(400)).toBe('0,4 s');
    expect(formatSeconds(1200)).toBe('1,2 s');
    expect(formatSeconds(0)).toBe('0,0 s');
  });

  it('formats the age at least 1 s and switches to minutes at 60 s', () => {
    expect(formatAgo(0)).toBe('vor 1 s');
    expect(formatAgo(1000)).toBe('vor 1 s');
    expect(formatAgo(12_400)).toBe('vor 12 s');
    expect(formatAgo(59_999)).toBe('vor 59 s');
    expect(formatAgo(60_000)).toBe('vor 1 min');
    expect(formatAgo(125_000)).toBe('vor 2 min');
  });
});
