import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../shared/errors';
import {
  UPDATE_INTERVAL_MS, UPDATE_TIMEOUT_MS, UPDATE_URL, UpdateChecker, availableVersion, parseReleaseTag, releaseUrl, updateDue,
} from './update-check';
import type { UpdateCheckerDeps } from './update-check';

const NOW = Date.UTC(2026, 9, 24, 12);
const HOUR = 60 * 60 * 1000;

function release(tag: unknown, extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ tag_name: tag, draft: false, prerelease: false, html_url: 'https://evil.example', ...extra }), { status: 200 });
}

describe('parseReleaseTag', () => {
  it('returns x.y.z with or without the v prefix', () => {
    expect(parseReleaseTag({ tag_name: 'v0.22.0' })).toBe('0.22.0');
    expect(parseReleaseTag({ tag_name: '0.22.0' })).toBe('0.22.0');
  });

  it('ignores drafts, prereleases and invalid tags', () => {
    expect(parseReleaseTag({ tag_name: 'v0.22.0', draft: true, prerelease: false })).toBeNull();
    expect(parseReleaseTag({ tag_name: 'v0.22.0', draft: false, prerelease: true })).toBeNull();
    expect(parseReleaseTag({ tag_name: 'v0.22' })).toBeNull();
    expect(parseReleaseTag({ tag_name: 'v0.22.0-beta' })).toBeNull();
    expect(parseReleaseTag({ tag_name: 'latest' })).toBeNull();
    expect(parseReleaseTag({ tag_name: 22 })).toBeNull();
    expect(parseReleaseTag(['v0.22.0'])).toBeNull();
    expect(parseReleaseTag(null)).toBeNull();
  });
});

describe('updateDue', () => {
  it('is due without a check, after 24 h, or when the check lies in the future', () => {
    expect(updateDue(undefined, NOW)).toBe(true);
    expect(updateDue(NOW - UPDATE_INTERVAL_MS + 1, NOW)).toBe(false);
    expect(updateDue(NOW - UPDATE_INTERVAL_MS, NOW)).toBe(true);
    expect(updateDue(NOW + HOUR, NOW)).toBe(true);
  });
});

describe('availableVersion', () => {
  it('offers only a newer, not skipped version', () => {
    expect(availableVersion('0.21.0', '0.22.0', undefined)).toBe('0.22.0');
    expect(availableVersion('0.21.0', '0.21.0', undefined)).toBeNull();
    expect(availableVersion('0.21.0', '0.20.9', undefined)).toBeNull();
    expect(availableVersion('0.21.0', undefined, undefined)).toBeNull();
    expect(availableVersion('0.21.0', '0.22.0', '0.22.0')).toBeNull();
    expect(availableVersion('0.21.0', '0.22.0', '0.21.5')).toBe('0.22.0');
  });
});

describe('release URL and constants', () => {
  it('builds the release URL from the version and points to GitHub', () => {
    expect(releaseUrl('0.22.0')).toBe('https://github.com/pelmenipower/Shellherd/releases/tag/v0.22.0');
    expect(UPDATE_URL).toBe('https://api.github.com/repos/pelmenipower/Shellherd/releases/latest');
    expect(UPDATE_INTERVAL_MS).toBe(24 * HOUR);
    expect(UPDATE_TIMEOUT_MS).toBe(5000);
  });
});

describe('UpdateChecker', () => {
  let dir: string;
  let file: string;
  let now: number;
  let unlocked: boolean;
  let fetch: ReturnType<typeof vi.fn<UpdateCheckerDeps['fetch']>>;

  const stored = () => JSON.parse(readFileSync(file, 'utf8'));
  const make = () => new UpdateChecker({
    current: '0.21.0', settingsFile: file, url: UPDATE_URL, now: () => now, isUnlocked: () => unlocked, fetch,
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'shellherd-update-'));
    file = join(dir, 'settings.json');
    writeFileSync(file, JSON.stringify({ language: 'de-DE', mainWindow: { bounds: { x: 1, y: 2, width: 1200, height: 900 }, maximized: false } }));
    now = NOW;
    unlocked = true;
    fetch = vi.fn<UpdateCheckerDeps['fetch']>(async () => release('v0.22.0'));
  });
  afterEach(() => { vi.restoreAllMocks(); rmSync(dir, { recursive: true, force: true }); });

  it('fetches when enabled, unlocked and due, then stores the result and offers it', async () => {
    const status = await make().status();
    expect(status).toEqual({ enabled: true, current: '0.21.0', available: { version: '0.22.0', url: releaseUrl('0.22.0') } });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(UPDATE_URL);
    expect(init.headers).toEqual({ accept: 'application/vnd.github+json', 'user-agent': 'Shellherd/0.21.0' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(stored()).toEqual({
      language: 'de-DE',
      mainWindow: { bounds: { x: 1, y: 2, width: 1200, height: 900 }, maximized: false },
      update: { enabled: true, checkedAt: NOW, latest: '0.22.0' },
    });
  });

  it('uses the time limit for the request', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => AbortSignal.abort());
    fetch.mockImplementationOnce(async (_url, init) => { if (init.signal.aborted) throw new Error('timeout'); return release('v0.22.0'); });
    await make().status();
    expect(timeout).toHaveBeenCalledWith(UPDATE_TIMEOUT_MS);
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(stored().update).toBeUndefined();
  });

  it('does not touch the network while the vault is locked', async () => {
    unlocked = false;
    const status = await make().status();
    expect(fetch).not.toHaveBeenCalled();
    expect(status.available).toBeNull();
  });

  it('does not touch the network when disabled', async () => {
    writeFileSync(file, JSON.stringify({ update: { enabled: false } }));
    const status = await make().status();
    expect(fetch).not.toHaveBeenCalled();
    expect(status).toEqual({ enabled: false, current: '0.21.0', available: null });
  });

  it('checks at most once per 24 h after a success', async () => {
    const checker = make();
    await checker.status();
    now += HOUR;
    await checker.status();
    expect(fetch).toHaveBeenCalledTimes(1);
    now += UPDATE_INTERVAL_MS;
    await checker.status();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('shares one request for parallel calls', async () => {
    const checker = make();
    const [first, second] = await Promise.all([checker.status(), checker.status()]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it('ignores drafts, prereleases and invalid tags without storing a check', async () => {
    fetch.mockResolvedValueOnce(release('v0.22.0', { draft: true }));
    expect((await make().status()).available).toBeNull();
    fetch.mockResolvedValueOnce(release('v0.22.0', { prerelease: true }));
    expect((await make().status()).available).toBeNull();
    fetch.mockResolvedValueOnce(release('latest'));
    expect((await make().status()).available).toBeNull();
    expect(stored().update).toBeUndefined();
  });

  it('stays silent on network errors, HTTP errors and broken bodies', async () => {
    fetch.mockRejectedValueOnce(new Error('offline'));
    await expect(make().status()).resolves.toEqual({ enabled: true, current: '0.21.0', available: null });
    fetch.mockResolvedValueOnce(new Response('nope', { status: 500 }));
    await expect(make().status()).resolves.toMatchObject({ available: null });
    fetch.mockResolvedValueOnce(new Response('{broken', { status: 200 }));
    await expect(make().status()).resolves.toMatchObject({ available: null });
    expect(stored().update).toBeUndefined();
  });

  it('ignores a body above 1 MiB', async () => {
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ tag_name: 'v0.22.0', pad: 'x'.repeat(1024 * 1024) }), { status: 200 }));
    expect((await make().status()).available).toBeNull();
    expect(stored().update).toBeUndefined();
  });

  it('keeps a stored latest version when a later check fails', async () => {
    const checker = make();
    await checker.status();
    now += UPDATE_INTERVAL_MS;
    fetch.mockRejectedValueOnce(new Error('offline'));
    expect((await checker.status()).available).toEqual({ version: '0.22.0', url: releaseUrl('0.22.0') });
  });

  it('does not offer a version that is not newer than the current one', async () => {
    fetch.mockResolvedValueOnce(release('v0.20.0'));
    expect((await make().status()).available).toBeNull();
  });

  it('keeps an opt-out that was set while the check was running', async () => {
    const checker = make();
    fetch.mockImplementationOnce(async () => { checker.setEnabled(false); return release('v0.22.0'); });
    const status = await checker.status();
    expect(status.available).toBeNull();
    expect(stored().update).toEqual({ enabled: false, checkedAt: NOW, latest: '0.22.0' });
  });

  it('setEnabled writes the flag and hides a known version while off', async () => {
    const checker = make();
    await checker.status();
    expect(checker.setEnabled(false)).toEqual({ enabled: false, current: '0.21.0', available: null });
    expect(stored().update).toEqual({ enabled: false, checkedAt: NOW, latest: '0.22.0' });
    expect(checker.setEnabled(true)).toMatchObject({ enabled: true, available: { version: '0.22.0' } });
    expect(stored().language).toBe('de-DE');
  });

  it('skip hides exactly that version and a later one is shown again', async () => {
    const checker = make();
    await checker.status();
    expect(checker.skip('0.22.0')).toEqual({ enabled: true, current: '0.21.0', available: null });
    expect(stored().update).toEqual({ enabled: true, checkedAt: NOW, latest: '0.22.0', skipped: '0.22.0' });
    now += UPDATE_INTERVAL_MS;
    fetch.mockResolvedValueOnce(release('v0.23.0'));
    expect((await checker.status()).available).toEqual({ version: '0.23.0', url: releaseUrl('0.23.0') });
  });

  it('skip rejects a value that is not x.y.z and writes nothing', () => {
    const checker = make();
    expect(() => checker.skip('v0.22.0')).toThrow(AppError);
    expect(() => checker.skip('0.22')).toThrow(AppError);
    expect(() => checker.skip('latest')).toThrow(AppError);
    expect(stored().update).toBeUndefined();
  });
});
