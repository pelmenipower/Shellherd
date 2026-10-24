import { webLinkHref } from '../../shared/links';
import { errorText } from './error-text';
import { t } from './i18n';
import { notify } from './notice-store';

/** Opens a terminal link only with Ctrl held; anything but http(s) is ignored. Main validates again. */
export function openTerminalLink(event: Pick<MouseEvent, 'ctrlKey'>, uri: string): void {
  if (!event.ctrlKey || !webLinkHref(uri)) return;
  void window.desktopApi.openExternal(uri).catch(error =>
    notify.error(t('terminal:links.failedTitle'), { body: errorText(error, t('terminal:links.failed')) }));
}
