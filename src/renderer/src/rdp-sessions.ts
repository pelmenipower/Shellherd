import type { RdpAction } from '../../shared/rdp';

export const RDP_ACTION_LABELS: Record<RdpAction, { label: string; hint?: string }> = {
  ctrlAltDel: { label: 'Strg+Alt+Entf', hint: 'Sicherheitsoptionen' },
  taskManager: { label: 'Task-Manager', hint: 'Strg+Umschalt+Esc' },
  startScreen: { label: 'Startmenü', hint: 'Windows-Taste' },
  appSwitch: { label: 'Fenster wechseln', hint: 'Alt+Tab' },
  actionCenter: { label: 'Info-Center', hint: 'Windows+A' },
};
