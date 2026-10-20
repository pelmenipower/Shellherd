import type { RdpAction } from '../../shared/rdp';
import { t } from './i18n';

const ACTION_LABEL_KEYS = {
  ctrlAltDel: 'terminal:rdp.actions.ctrlAltDel.label',
  taskManager: 'terminal:rdp.actions.taskManager.label',
  startScreen: 'terminal:rdp.actions.startScreen.label',
  appSwitch: 'terminal:rdp.actions.appSwitch.label',
  actionCenter: 'terminal:rdp.actions.actionCenter.label',
} as const satisfies Record<RdpAction, string>;

const ACTION_HINT_KEYS = {
  ctrlAltDel: 'terminal:rdp.actions.ctrlAltDel.hint',
  taskManager: 'terminal:rdp.actions.taskManager.hint',
  startScreen: 'terminal:rdp.actions.startScreen.hint',
  appSwitch: 'terminal:rdp.actions.appSwitch.hint',
  actionCenter: 'terminal:rdp.actions.actionCenter.hint',
} as const satisfies Record<RdpAction, string>;

/** Menu label and hint of an RDP key action in the current language; call at render time. */
export function rdpActionLabel(action: RdpAction): { label: string; hint: string } {
  const keys = { ctrl: t('common:keys.ctrl'), shift: t('common:keys.shift'), alt: t('common:keys.alt'), del: t('common:keys.del') };
  return { label: t(ACTION_LABEL_KEYS[action], keys), hint: t(ACTION_HINT_KEYS[action], keys) };
}
