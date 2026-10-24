import { webLinkHref } from '../../shared/links';
import { errorText } from './error-text';
import { t } from './i18n';
import { notify } from './notice-store';

/** Host that Ctrl+click would open, so the hint shows the real target of OSC 8 links too. */
export function linkHintHost(uri: string): string | null {
  const href = webLinkHref(uri);
  return href ? new URL(href).host : null;
}

/** Opens a terminal link only with Ctrl held; anything but http(s) is ignored. Main validates again. */
export function openTerminalLink(event: Pick<MouseEvent, 'ctrlKey'>, uri: string): void {
  if (!event.ctrlKey || !webLinkHref(uri)) return;
  void window.desktopApi.openExternal(uri).catch(error =>
    notify.error(t('terminal:links.failedTitle'), { body: errorText(error, t('terminal:links.failed')) }));
}
