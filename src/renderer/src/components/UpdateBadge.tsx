import { useEffect, useState } from 'react';
import { errorText } from '../error-text';
import { notify } from '../notice-store';
import { useT } from '../i18n';
import { updateStore, useUpdateStatus } from '../update-store';
import { ContextMenu } from './ContextMenu';

/** Status bar hint for a newer release; the menu opens the release notes or skips this version. */
export function UpdateBadge() {
  const { t } = useT();
  const status = useUpdateStatus();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    // Asked again on every unlock, so a long-running session sees new releases.
    const load = (): void => { void window.desktopApi.updateStatus().then(value => updateStore.set(value)).catch(() => {}); };
    load();
    return window.desktopApi.onVaultUnlocked(load);
  }, []);
  const available = status?.available;
  if (!available) return null;
  const skip = (): void => {
    void window.desktopApi.updateSkip(available.version).then(value => updateStore.set({ ...value, available: null })).catch(() => {});
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
