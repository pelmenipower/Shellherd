import type { UpdateStatus } from '../shared/ipc';
import { AppError } from '../shared/errors';
import { compareVersions } from '../shared/version';
import { readAppSettings, writeAppSettings } from './app-settings';
import type { UpdateSettings } from './app-settings';

export const UPDATE_URL = 'https://api.github.com/repos/pelmenipower/Shellherd/releases/latest';
export const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const UPDATE_TIMEOUT_MS = 5000;
/** shortcut: the body is read whole before the size check; a streamed limit would be safer. */
const MAX_BODY_BYTES = 1024 * 1024;
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;

export const releaseUrl = (version: string): string => `https://github.com/pelmenipower/Shellherd/releases/tag/v${version}`;

/** x.y.z from a releases/latest body, else null (draft or prerelease → null). */
export function parseReleaseTag(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const release = body as { tag_name?: unknown; draft?: unknown; prerelease?: unknown };
  if (release.draft === true || release.prerelease === true || typeof release.tag_name !== 'string') return null;
  const match = /^v?(\d{1,4}\.\d{1,4}\.\d{1,4})$/.exec(release.tag_name);
  return match ? match[1] : null;
}

/** True without checkedAt, after 24 h, or when checkedAt lies in the future. */
export function updateDue(checkedAt: number | undefined, now: number): boolean {
  if (checkedAt === undefined || checkedAt > now) return true;
  return now - checkedAt >= UPDATE_INTERVAL_MS;
}

/** latest when newer than current (compareVersions) and not skipped, else null. */
export function availableVersion(current: string, latest: string | undefined, skipped: string | undefined): string | null {
  if (!latest || latest === skipped || compareVersions(latest, current) <= 0) return null;
  return latest;
}

export interface UpdateCheckerDeps {
  current: string;
  settingsFile: string;
  url: string;
  now: () => number;
  isUnlocked: () => boolean;
  fetch: (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<Response>;
}

export class UpdateChecker {
  private readonly deps: UpdateCheckerDeps;
  private inFlight: Promise<UpdateStatus> | undefined;

  constructor(deps: UpdateCheckerDeps) {
    this.deps = deps;
  }

  /** Shares one in-flight check; never rejects. */
  status(): Promise<UpdateStatus> {
    this.inFlight ??= this.check().finally(() => { this.inFlight = undefined; });
    return this.inFlight;
  }

  /** Writes settings; false → available null. */
  setEnabled(enabled: boolean): UpdateStatus {
    this.save({ enabled });
    return this.state();
  }

  /** Validates x.y.z, else AppError('core.invalidRequest'). */
  skip(version: string): UpdateStatus {
    if (!VERSION.test(version)) throw new AppError('core.invalidRequest');
    this.save({ skipped: version });
    return this.state();
  }

  private async check(): Promise<UpdateStatus> {
    try {
      const { update } = readAppSettings(this.deps.settingsFile);
      const now = this.deps.now();
      if (update.enabled && this.deps.isUnlocked() && updateDue(update.checkedAt, now)) {
        const latest = await this.fetchLatest();
        // Read again: the user may have changed the settings while the request ran.
        if (latest) writeAppSettings(this.deps.settingsFile, { update: { ...readAppSettings(this.deps.settingsFile).update, checkedAt: now, latest } });
      }
    } catch { /* offline, timeout or broken answer: stay silent */ }
    return this.state();
  }

  private async fetchLatest(): Promise<string | null> {
    try {
      const response = await this.deps.fetch(this.deps.url, {
        headers: { accept: 'application/vnd.github+json', 'user-agent': `Shellherd/${this.deps.current}` },
        signal: AbortSignal.timeout(UPDATE_TIMEOUT_MS),
      });
      if (!response.ok) return null;
      const text = await response.text();
      if (Buffer.byteLength(text) > MAX_BODY_BYTES) return null;
      return parseReleaseTag(JSON.parse(text));
    } catch { return null; }
  }

  private save(patch: Partial<UpdateSettings>): void {
    const { update } = readAppSettings(this.deps.settingsFile);
    if (!writeAppSettings(this.deps.settingsFile, { update: { ...update, ...patch } })) throw new AppError('core.unknown');
  }

  private state(): UpdateStatus {
    const { update } = readAppSettings(this.deps.settingsFile);
    const version = update.enabled ? availableVersion(this.deps.current, update.latest, update.skipped) : null;
    return { enabled: update.enabled, current: this.deps.current, available: version ? { version, url: releaseUrl(version) } : null };
  }
}
