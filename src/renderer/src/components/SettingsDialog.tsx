import { useEffect, useId, useRef } from 'react';
import type { Vault, VaultSettings } from '../../../shared/vault/types';
import { useNativeSurfaceBlock } from '../native-surface';
import { t, useT } from '../i18n';
import { aiProviderSummary, settingsSections, withConfirmBeforeClosing, type SettingsSection } from '../settings-sections';
import { LanguageSetting } from './LanguageSetting';
import { FileTypeSetting } from './FileTypeSetting';
import '../settings-ui.css';

export interface SettingsDialogProps {
  /** null before unlocking (start card): only "Allgemein" and the locked hint. */
  vault: Vault | null;
  busy: boolean;
  /** Skip the open animation (Ctrl+, and the return from the AI providers). */
  instant?: boolean;
  /** Element focused after showModal(); 'manageAi' falls back to 'close' without a vault. Default 'close'. */
  initialFocus?: 'close' | 'manageAi';
  onClose: () => void;
  onManageAi: () => void;
  onSaveSettings: (settings: VaultSettings) => Promise<boolean>;
}

/** Full literals, so unused keys can be found by search. */
const sectionTitle = (section: SettingsSection): string => ({
  general: t('app:settings.sections.general'),
  vault: t('app:settings.sections.vault'),
  assistant: t('app:settings.sections.assistant'),
})[section];

/** Language, file association, vault and AI provider entry points; every value applies immediately. */
export function SettingsDialog({ vault, busy, instant, initialFocus = 'close', onClose, onManageAi, onSaveSettings }: SettingsDialogProps) {
  const { t } = useT();
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const manageRef = useRef<HTMLButtonElement>(null);
  useNativeSurfaceBlock(true);
  useEffect(() => {
    dialogRef.current?.showModal();
    // Not the language select: an arrow key there would switch the language of every window.
    (initialFocus === 'manageAi' && manageRef.current ? manageRef.current : closeRef.current)?.focus();
  }, []);

  return (
    <dialog ref={dialogRef} className="confirm-dialog settings-dialog" data-instant={instant ? '' : undefined}
      aria-labelledby={`${id}-title`} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
      <h2 id={`${id}-title`}>{t('app:settings.title')}</h2>
      {settingsSections(vault).map(section => <section key={section} className="settings-section" aria-labelledby={`${id}-${section}`}>
        <h3 id={`${id}-${section}`}>{sectionTitle(section)}</h3>
        {section === 'general' && <>
          <div className="settings-stack"><LanguageSetting /><FileTypeSetting /></div>
          {!vault && <p className="settings-hint">{t('app:settings.locked')}</p>}
        </>}
        {section === 'vault' && vault && <>
          <label className="settings-check">
            <input type="checkbox" checked={vault.settings.confirmBeforeClosingSession} disabled={busy} aria-describedby={`${id}-confirm-hint`}
              onChange={event => void onSaveSettings(withConfirmBeforeClosing(vault.settings, event.target.checked))} />
            {t('app:settings.confirmClose.label')}</label>
          <p className="settings-hint" id={`${id}-confirm-hint`}>{t('app:settings.confirmClose.hint')}</p>
        </>}
        {section === 'assistant' && vault && <>
          <p className="settings-summary">{aiProviderSummary(vault.ai)}</p>
          <button ref={manageRef} type="button" className="secondary-button" disabled={busy} onClick={onManageAi}>{t('app:settings.assistant.manage')}</button>
        </>}
      </section>)}
      <div className="form-actions"><button ref={closeRef} type="button" className="primary-button" disabled={busy} onClick={onClose}>{t('common:actions.close')}</button></div>
    </dialog>
  );
}
