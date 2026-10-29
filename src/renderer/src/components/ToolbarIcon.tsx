import { CONNECTION_ICONS, type ConnectionIconName } from '../../../shared/vault/appearance';
import type { ToolbarIcon as Icon } from '../../../shared/toolbar';
import { ConnectionIcon, connectionIconLabel } from './ConnectionIcon';
import { t } from '../i18n';
const labels = { check: 'toolbar:icons.check', stop: 'toolbar:icons.stop', warning: 'toolbar:icons.warning', refresh: 'toolbar:icons.refresh', tools: 'toolbar:icons.tools', play: 'toolbar:icons.play' } as const;
export function toolbarIconLabel(icon: Icon): string { return icon in labels ? t(labels[icon as keyof typeof labels]) : connectionIconLabel(icon as ConnectionIconName); }
const paths = {
  check: 'm5 12 4 4L19 6', stop: 'M5 5h14v14H5z', warning: 'M12 3 2 21h20ZM12 9v5m0 3v1',
  refresh: 'M20 11a8 8 0 1 0-2 7m2-15v8h-8', tools: 'm4 20 7-7m3-9a5 5 0 0 0-5 7l4 4a5 5 0 0 0 7-5l-4 2-4-4z', play: 'm8 4 12 8-12 8z',
};
export function ToolbarIcon({ icon }: { icon: Icon }) {
  if ((CONNECTION_ICONS as readonly string[]).includes(icon)) return <ConnectionIcon icon={icon as ConnectionIconName} />;
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[icon as keyof typeof paths]} /></svg>;
}
