import type { ConnectionProtocol, Workspace } from '../../../shared/vault/types';
import { NEW_CONNECTION_KINDS } from '../../../shared/vault/connections';
import { workspaceSummary } from '../terminal-views';
import { protocolLabel } from '../connection-labels';
import { Trans, useT } from '../i18n';
import { WhatsNew } from './ReleaseNotes';

interface WelcomePageProps {
  vaultName: string;
  version: string;
  onShowReleaseNotes: () => void;
  connectionCount: number;
  workspaces: Workspace[];
  busy: boolean;
  onNewConnection: (protocol: ConnectionProtocol) => void;
  onOpenWorkspace: (id: string) => void;
}

/** Shown while no tab is open: quick starts instead of an empty connection form. */
export function WelcomePage({ vaultName, version, onShowReleaseNotes, connectionCount, workspaces, busy, onNewConnection, onOpenWorkspace }: WelcomePageProps) {
  const { t } = useT();
  return (
    <div className="welcome-page">
      <header>
        <h1>{t('app:welcome.title', { name: vaultName })}</h1>
        <p>{connectionCount === 0 ? t('app:welcome.empty') : t('app:welcome.saved', { count: connectionCount })}</p>
      </header>
      {/^\d+\.\d+\.\d+$/.test(version) && <WhatsNew version={version} onShowAll={onShowReleaseNotes} />}
      <div className="welcome-grid">
        {workspaces.length > 0 && <section aria-labelledby="welcome-workspaces">
          <h2 id="welcome-workspaces">{t('app:welcome.workspaces')}</h2>
          <ul className="welcome-list">
            {workspaces.map(workspace => <li key={workspace.id}>
              <button type="button" disabled={busy} onClick={() => onOpenWorkspace(workspace.id)}>
                <strong>{workspace.name}</strong><small>{workspaceSummary(workspace)}</small>
              </button>
            </li>)}
          </ul>
        </section>}
        <section aria-labelledby="welcome-new">
          <h2 id="welcome-new">{t('app:welcome.newConnection')}</h2>
          <ul className="welcome-list">
            {NEW_CONNECTION_KINDS.filter(kind => !kind.planned).map(kind => <li key={kind.protocol}>
              <button type="button" disabled={busy} onClick={() => onNewConnection(kind.protocol as ConnectionProtocol)}><strong>{protocolLabel(kind.protocol)}</strong></button>
            </li>)}
          </ul>
        </section>
        <section aria-labelledby="welcome-tips">
          <h2 id="welcome-tips">{t('app:welcome.goodToKnow')}</h2>
          <ul className="welcome-tips">
            <li><Trans t={t} i18nKey="app:welcome.tips.folder" components={{ strong: <strong /> }} /></li>
            <li>{t('app:welcome.tips.split')}</li>
            <li>{t('app:welcome.tips.views')}</li>
            <li>{t('app:welcome.tips.files')}</li>
            <li>{t('app:welcome.tips.settings', { shortcut: t('common:shortcuts.settings') })}</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
