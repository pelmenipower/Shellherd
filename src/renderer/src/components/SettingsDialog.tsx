import { useEffect, useId, useRef, useState } from 'react';
import type { Vault, VaultSettings } from '../../../shared/vault/types';
import { AUTO_LOCK_LIMITS, TIMEOUT_LIMITS, effectiveTimeouts, parseBounded } from '../../../shared/vault/timeouts';
import { useNativeSurfaceBlock } from '../native-surface';
import { t, useT } from '../i18n';
import { aiProviderSummary, settingsSections, withAutoLockMinutes, withConfirmBeforeClosing, withTimeouts, type SettingsSection } from '../settings-sections';
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
  connections: t('app:settings.sections.connections'),
  assistant: t('app:settings.sections.assistant'),
})[section];

interface NumberSettingProps {
  id: string;
  label: string;
  unit: string;
  value: number;
  limits: readonly [number, number];
  busy: boolean;
  /** Section hint, referenced by aria-describedby. */
  hintId: string;
  onCommit: (value: number) => void;
}

/** Whole-number field: commits on blur or Enter only, so focus survives Tab between fields. */
function NumberSetting({ id, label, unit, value, limits, busy, hintId, onCommit }: NumberSettingProps) {
  const { t } = useT();
  const [draft, setDraft] = useState(String(value));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { setDraft(String(value)); setInvalid(false); }, [value]);
  function commit(): void {
    const parsed = parseBounded(draft, limits);
    setInvalid(parsed === null);
    if (parsed !== null && parsed !== value) onCommit(parsed);
  }
  return (
    <div className="settings-number">
      <label htmlFor={id}>{label}</label>
      {/* readOnly, not disabled: a disabled field would drop the focus while the blur commit saves. */}
      <input id={id} type="text" inputMode="numeric" autoComplete="off" spellCheck={false} value={draft} readOnly={busy}
        aria-invalid={invalid || undefined} aria-describedby={`${id}-unit ${hintId}${invalid ? ` ${id}-error` : ''}`}
        onChange={event => setDraft(event.target.value)} onBlur={commit}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commit(); } }} />
      <span id={`${id}-unit`}>{unit}</span>
      {invalid && <p className="field-error" id={`${id}-error`} role="alert">{t('app:settings.rangeError', { min: limits[0], max: limits[1] })}</p>}
    </div>
  );
}

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
          <NumberSetting id={`${id}-autolock`} label={t('app:settings.autoLock.label')} unit={t('app:settings.autoLock.unit')}
            value={vault.settings.autoLockMinutes} limits={AUTO_LOCK_LIMITS} busy={busy} hintId={`${id}-autolock-hint`}
            onCommit={minutes => void onSaveSettings(withAutoLockMinutes(vault.settings, minutes))} />
          <p className="settings-hint" id={`${id}-autolock-hint`}>{t('app:settings.autoLock.hint')}</p>
        </>}
        {section === 'connections' && vault && <>
          <NumberSetting id={`${id}-idle`} label={t('app:settings.timeouts.idle.label')} unit={t('app:settings.timeouts.idle.unit')}
            value={effectiveTimeouts(vault.settings).idleMinutes} limits={TIMEOUT_LIMITS.idleMinutes} busy={busy} hintId={`${id}-timeouts-hint`}
            onCommit={idleMinutes => void onSaveSettings(withTimeouts(vault.settings, { idleMinutes }))} />
          <NumberSetting id={`${id}-keepalive`} label={t('app:settings.timeouts.keepalive.label')} unit={t('app:settings.timeouts.keepalive.unit')}
            value={effectiveTimeouts(vault.settings).keepaliveSeconds} limits={TIMEOUT_LIMITS.keepaliveSeconds} busy={busy} hintId={`${id}-timeouts-hint`}
            onCommit={keepaliveSeconds => void onSaveSettings(withTimeouts(vault.settings, { keepaliveSeconds }))} />
          <NumberSetting id={`${id}-keepalive-count`} label={t('app:settings.timeouts.keepaliveCount.label')} unit={t('app:settings.timeouts.keepaliveCount.unit')}
            value={effectiveTimeouts(vault.settings).keepaliveCount} limits={TIMEOUT_LIMITS.keepaliveCount} busy={busy} hintId={`${id}-timeouts-hint`}
            onCommit={keepaliveCount => void onSaveSettings(withTimeouts(vault.settings, { keepaliveCount }))} />
          <NumberSetting id={`${id}-connect`} label={t('app:settings.timeouts.connect.label')} unit={t('app:settings.timeouts.connect.unit')}
            value={effectiveTimeouts(vault.settings).connectSeconds} limits={TIMEOUT_LIMITS.connectSeconds} busy={busy} hintId={`${id}-timeouts-hint`}
            onCommit={connectSeconds => void onSaveSettings(withTimeouts(vault.settings, { connectSeconds }))} />
          <p className="settings-hint" id={`${id}-timeouts-hint`}>{t('app:settings.timeouts.hint')}</p>
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
