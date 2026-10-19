import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearNotices, closeNotice, MAX_VISIBLE_NOTICES, notify, noticeStore, pushNotice, removeNotice, type Notice } from './notice-store';

const make = (id: number, title = `t${id}`, extra: Partial<Notice> = {}): Notice => ({ id, tone: 'error', title, leaving: false, ...extra });

describe('notice list operations', () => {
  it('appends a notice', () => {
    expect(pushNotice([make(1)], make(2)).map(n => n.id)).toEqual([1, 2]);
  });
  it('lets the oldest visible notice leave beyond three', () => {
    let list: Notice[] = [];
    for (let id = 1; id <= MAX_VISIBLE_NOTICES + 1; id++) list = pushNotice(list, make(id));
    expect(list.map(n => [n.id, n.leaving])).toEqual([[1, true], [2, false], [3, false], [4, false]]);
  });
  it('skips already leaving notices when counting and picking the oldest', () => {
    let list: Notice[] = [make(1, 'a', { leaving: true }), make(2), make(3), make(4)];
    list = pushNotice(list, make(5));
    expect(list.filter(n => !n.leaving).map(n => n.id)).toEqual([3, 4, 5]);
  });
  it('starts an identical visible notice leaving and appends the new one', () => {
    const list = pushNotice([make(1, 'same', { body: 'b' })], make(2, 'same', { body: 'b' }));
    expect(list.map(n => [n.id, n.leaving])).toEqual([[1, true], [2, false]]);
  });
  it('does not treat a different tone or body as identical', () => {
    expect(pushNotice([make(1, 'x')], make(2, 'x', { tone: 'info' })).every(n => !n.leaving)).toBe(true);
    expect(pushNotice([make(1, 'x')], make(2, 'x', { body: 'y' })).every(n => !n.leaving)).toBe(true);
  });
  it('closeNotice marks one notice as leaving; unknown id returns the same list', () => {
    const list = [make(1), make(2)];
    expect(closeNotice(list, 2).map(n => n.leaving)).toEqual([false, true]);
    expect(closeNotice(list, 9)).toBe(list);
  });
  it('removeNotice drops one notice; unknown id returns the same list', () => {
    const list = [make(1), make(2)];
    expect(removeNotice(list, 1).map(n => n.id)).toEqual([2]);
    expect(removeNotice(list, 9)).toBe(list);
  });
});

describe('notice store', () => {
  afterEach(() => clearNotices());
  it('notify adds notices with tone and options, and notifies subscribers', () => {
    const listener = vi.fn();
    const off = noticeStore.subscribe(listener);
    const run = vi.fn();
    const a = notify.error('Fehler', { body: 'Text', action: { label: 'Los', run } });
    const b = notify.info('Hinweis');
    const c = notify.ok('Fertig', { body: 'ok' });
    expect(new Set([a, b, c]).size).toBe(3);
    expect(noticeStore.getSnapshot().map(n => n.tone)).toEqual(['error', 'info', 'ok']);
    expect(noticeStore.getSnapshot()[0]).toMatchObject({ title: 'Fehler', body: 'Text', leaving: false });
    expect(noticeStore.getSnapshot()[0].action?.label).toBe('Los');
    expect(listener).toHaveBeenCalledTimes(3);
    off();
    notify.info('später');
    expect(listener).toHaveBeenCalledTimes(3);
  });
  it('notify.ok carries no action', () => {
    notify.ok('Fertig');
    expect(noticeStore.getSnapshot()[0].action).toBeUndefined();
  });
  it('close and remove update the snapshot; unknown ids do not notify', () => {
    const id = notify.error('x');
    const listener = vi.fn();
    noticeStore.subscribe(listener);
    noticeStore.close(999); noticeStore.remove(999);
    expect(listener).not.toHaveBeenCalled();
    noticeStore.close(id);
    expect(noticeStore.getSnapshot()[0].leaving).toBe(true);
    noticeStore.remove(id);
    expect(noticeStore.getSnapshot()).toEqual([]);
  });
  it('clearNotices empties the store', () => {
    notify.error('x');
    clearNotices();
    expect(noticeStore.getSnapshot()).toEqual([]);
  });
});
