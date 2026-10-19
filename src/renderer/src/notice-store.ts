export type NoticeTone = 'error' | 'info' | 'ok';
export interface NoticeAction { label: string; run: () => void }
export interface Notice {
  id: number; tone: NoticeTone; title: string; body?: string; action?: NoticeAction;
  /** Set when the exit starts; removed after the exit transition. */
  leaving: boolean;
}
export const MAX_VISIBLE_NOTICES = 3;

const sameMessage = (a: Notice, b: Notice): boolean => a.tone === b.tone && a.title === b.title && a.body === b.body;

/** Appends; an identical visible notice (tone, title, body) starts leaving first; beyond three visible the oldest starts leaving. */
export function pushNotice(list: readonly Notice[], notice: Notice): Notice[] {
  let next = list.map(item => (!item.leaving && sameMessage(item, notice) ? { ...item, leaving: true } : item));
  next.push(notice);
  const visible = next.filter(item => !item.leaving);
  if (visible.length > MAX_VISIBLE_NOTICES) {
    const oldest = visible[0].id;
    next = next.map(item => (item.id === oldest ? { ...item, leaving: true } : item));
  }
  return next;
}

/** Marks one notice as leaving; unknown id → same list. */
export function closeNotice(list: readonly Notice[], id: number): Notice[] {
  if (!list.some(item => item.id === id)) return list as Notice[];
  return list.map(item => (item.id === id ? { ...item, leaving: true } : item));
}

/** Drops one notice; unknown id → same list. */
export function removeNotice(list: readonly Notice[], id: number): Notice[] {
  if (!list.some(item => item.id === id)) return list as Notice[];
  return list.filter(item => item.id !== id);
}

// Module store (pattern of native-surface.ts)
let notices: readonly Notice[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = (): void => listeners.forEach(listener => listener());
const update = (next: readonly Notice[]): void => { if (next !== notices) { notices = next; emit(); } };

export const noticeStore = {
  subscribe(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; },
  getSnapshot(): readonly Notice[] { return notices; },
  close(id: number): void { update(closeNotice(notices, id)); },
  remove(id: number): void { update(removeNotice(notices, id)); },
};

export function clearNotices(): void {
  if (notices.length === 0) return;
  notices = [];
  emit();
}

function add(tone: NoticeTone, title: string, options?: { body?: string; action?: NoticeAction }): number {
  const id = nextId++;
  update(pushNotice(notices, { id, tone, title, body: options?.body, action: options?.action, leaving: false }));
  return id;
}

export const notify = {
  error: (title: string, options?: { body?: string; action?: NoticeAction }): number => add('error', title, options),
  info: (title: string, options?: { body?: string; action?: NoticeAction }): number => add('info', title, options),
  ok: (title: string, options?: { body?: string }): number => add('ok', title, { body: options?.body }),
};
