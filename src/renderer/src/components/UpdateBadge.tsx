import { useEffect, useState } from 'react';
import type { UpdateStatus } from '../../../shared/ipc';
import { errorText } from '../error-text';
import { notify } from '../notice-store';
import { useT } from '../i18n';
import { ContextMenu } from './ContextMenu';

/** Status bar hint for a newer release; the menu opens the release notes or skips this version. */
export function UpdateBadge() {
  const { t } = useT();
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    let current = true;
    void window.desktopApi.updateStatus().then(value => { if (current) setStatus(value); }).catch(() => {});
    return () => { current = false; };
  }, []);
  const available = status?.available;
  if (!available) return null;
  const skip = (): void => {
    void window.desktopApi.updateSkip(available.version).then(value => setStatus({ ...value, available: null })).catch(() => {});
  };
  return (
    <>
      <button type="button" className="update-button" aria-haspopup="menu"
        onClick={event => { const box = event.currentTarget.getBoundingClientRect(); setMenu({ x: box.left, y: box.top }); }}>
        {t('app:update.available', { version: available.version })}
      </button>
      {menu && <ContextMenu x={menu.x} y={menu.y} label={t('app:update.title', { version: available.version })} onClose={() => setMenu(null)} entries={[
        { kind: 'heading', label: t('app:update.title', { version: available.version }) },
        { kind: 'item', label: t('app:update.notes'), onSelect: () => {
          window.desktopApi.openExternal(available.url).catch(error => notify.error(errorText(error)));
        } },
        { kind: 'item', label: t('app:update.skip'), onSelect: skip },
      ]} />}
    </>
  );
}
