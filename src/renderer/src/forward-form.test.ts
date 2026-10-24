import { describe, expect, it } from 'vitest';
import { MAX_FORWARDS } from '../../shared/vault/schema';
import type { PortForward } from '../../shared/vault/types';
import { t } from './i18n';
import { draftsFromForwards, forwardsFromDrafts, newForwardDraft } from './forward-form';
import type { ForwardDraft } from './forward-form';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];

const local: PortForward = { id: ids[0], kind: 'local', localPort: 15432, targetHost: 'db.internal', targetPort: 5432, auto: true };
const remote: PortForward = { id: ids[1], kind: 'remote', remotePort: 8080, targetHost: 'localhost', targetPort: 3000, auto: false };
const dynamic: PortForward = { id: ids[2], kind: 'dynamic', localPort: 1080, auto: false };

const draft = (change: Partial<ForwardDraft>): ForwardDraft =>
  ({ id: ids[0], kind: 'local', listenPort: '8080', targetHost: 'db.internal', targetPort: '5432', auto: false, ...change });

/** Message of the error thrown by forwardsFromDrafts; fails the test if nothing is thrown. */
function errorOf(drafts: ForwardDraft[]): string {
  try {
    forwardsFromDrafts(drafts);
  } catch (caught) {
    return (caught as Error).message;
  }
  throw new Error('Expected forwardsFromDrafts to throw');
}

describe('newForwardDraft', () => {
  it('starts as an empty local forward with a UUID, not started on connect', () => {
    const fresh = newForwardDraft();
    expect(fresh).toEqual({ id: expect.stringMatching(UUID), kind: 'local', listenPort: '', targetHost: '', targetPort: '', auto: false });
    expect(newForwardDraft().id).not.toBe(fresh.id);
  });
});

describe('draftsFromForwards and forwardsFromDrafts', () => {
  it('round-trips every kind unchanged', () => {
    const forwards = [local, remote, dynamic];
    expect(forwardsFromDrafts(draftsFromForwards(forwards))).toEqual(forwards);
  });

  it('maps the listen port of each kind to listenPort as text', () => {
    expect(draftsFromForwards([local, remote, dynamic])).toEqual([
      { id: ids[0], kind: 'local', listenPort: '15432', targetHost: 'db.internal', targetPort: '5432', auto: true },
      { id: ids[1], kind: 'remote', listenPort: '8080', targetHost: 'localhost', targetPort: '3000', auto: false },
      { id: ids[2], kind: 'dynamic', listenPort: '1080', targetHost: '', targetPort: '', auto: false },
    ]);
  });

  it('gives no drafts for missing or empty forwards', () => {
    expect(draftsFromForwards(undefined)).toEqual([]);
    expect(draftsFromForwards([])).toEqual([]);
  });

  it('returns undefined for an empty list', () => {
    expect(forwardsFromDrafts([])).toBeUndefined();
  });

  it('trims the target host and parses the ports', () => {
    expect(forwardsFromDrafts([draft({ listenPort: ' 8080 ', targetHost: '  db.internal  ', targetPort: ' 5432 ' })])).toEqual([
      { id: ids[0], kind: 'local', localPort: 8080, targetHost: 'db.internal', targetPort: 5432, auto: false },
    ]);
  });

  it('builds a remote forward with the server port as remotePort', () => {
    expect(forwardsFromDrafts([draft({ kind: 'remote', listenPort: '9000', targetHost: 'localhost', targetPort: '3000', auto: true })])).toEqual([
      { id: ids[0], kind: 'remote', remotePort: 9000, targetHost: 'localhost', targetPort: 3000, auto: true },
    ]);
  });

  it('ignores the target fields of a dynamic forward', () => {
    expect(forwardsFromDrafts([draft({ kind: 'dynamic', listenPort: '1080', targetHost: '', targetPort: 'x' })])).toEqual([
      { id: ids[0], kind: 'dynamic', localPort: 1080, auto: false },
    ]);
  });

  it('rejects a listen port that is not an integer', () => {
    const message = t('connection:validation.portInteger');
    expect(errorOf([draft({ listenPort: '' })])).toBe(message);
    expect(errorOf([draft({ listenPort: '80.5' })])).toBe(message);
    expect(errorOf([draft({ listenPort: 'abc' })])).toBe(message);
    expect(errorOf([draft({ kind: 'dynamic', listenPort: '-1' })])).toBe(message);
  });

  it('rejects a listen port outside 1 to 65535', () => {
    const message = t('connection:validation.portRange');
    expect(errorOf([draft({ listenPort: '0' })])).toBe(message);
    expect(errorOf([draft({ kind: 'remote', listenPort: '65536' })])).toBe(message);
  });

  it('rejects a target port that is not an integer or out of range', () => {
    expect(errorOf([draft({ targetPort: '' })])).toBe(t('connection:validation.portInteger'));
    expect(errorOf([draft({ kind: 'remote', targetPort: '70000' })])).toBe(t('connection:validation.portRange'));
  });

  it('rejects a missing target host for local and remote forwards', () => {
    const message = t('connection:validation.forwardTargetMissing');
    expect(errorOf([draft({ targetHost: '   ' })])).toBe(message);
    expect(errorOf([draft({ kind: 'remote', targetHost: '' })])).toBe(message);
  });

  it('rejects two local listen ports that are equal, also across local and dynamic', () => {
    expect(errorOf([draft({ listenPort: '8080' }), draft({ id: ids[1], listenPort: '8080' })]))
      .toBe(t('connection:validation.forwardPortTwice', { port: 8080 }));
    expect(errorOf([draft({ listenPort: '1080' }), draft({ id: ids[1], kind: 'dynamic', listenPort: '1080' })]))
      .toBe(t('connection:validation.forwardPortTwice', { port: 1080 }));
  });

  it('allows the same port as remote forward and local forward, since they listen in different places', () => {
    expect(forwardsFromDrafts([draft({ listenPort: '8080' }), draft({ id: ids[1], kind: 'remote', listenPort: '8080' })])).toHaveLength(2);
  });

  it('rejects more forwards than MAX_FORWARDS', () => {
    const many = Array.from({ length: MAX_FORWARDS + 1 }, (_, index) => draft({ kind: 'dynamic', listenPort: String(2000 + index) }));
    expect(errorOf(many)).toBe(t('connection:validation.forwardTooMany', { max: MAX_FORWARDS }));
    expect(forwardsFromDrafts(many.slice(0, MAX_FORWARDS))).toHaveLength(MAX_FORWARDS);
  });
});
