import type { ConnectionIconName } from '../../../shared/vault/appearance';

export const connectionIconLabels: Record<ConnectionIconName, string> = {
  terminal: 'Terminal', server: 'Server', database: 'Datenbank', desktop: 'Desktop', cloud: 'Cloud', network: 'Netzwerk',
};
const paths: Record<ConnectionIconName, string> = {
  terminal: 'm4 6 6 6-6 6m9 0h7',
  server: 'M4 3h16v8H4zM4 13h16v8H4zM7 7h1m3 0h6M7 17h1m3 0h6',
  database: 'M20 5c0 2-16 2-16 0s16-2 16 0v14c0 3-16 3-16 0V5m0 7c0 3 16 3 16 0',
  desktop: 'M3 4h18v13H3zM12 17v4m-5 0h10',
  cloud: 'M6 18a5 5 0 0 1-1-10 7 7 0 0 1 13-1 5.5 5.5 0 0 1 0 11H6Z',
  network: 'M9 3h6v5H9zM2 16h6v5H2zM16 16h6v5h-6zM12 8v4m-7 4v-4h14v4',
};
export function ConnectionIcon({ icon = 'terminal', color }: { icon?: ConnectionIconName; color?: string }) {
  return <svg className="connection-icon" data-icon={icon} width="16" height="16" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={color ? { color } : undefined} aria-hidden="true">
    <path d={paths[icon] ?? paths.terminal} />
  </svg>;
}
