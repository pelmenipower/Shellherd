import { useEffect, useState } from 'react';
import type { ConnectionProtocol, Workspace } from '../../../shared/vault/types';
import { NEW_CONNECTION_KINDS } from '../../../shared/vault/connections';
import { workspaceSummary } from '../terminal-views';

interface WelcomePageProps {
  vaultName: string;
  connectionCount: number;
  workspaces: Workspace[];
  busy: boolean;
  onNewConnection: (protocol: ConnectionProtocol) => void;
  onOpenWorkspace: (id: string) => void;
}

/** Shown while no tab is open: quick starts instead of an empty connection form. */
export function WelcomePage({ vaultName, connectionCount, workspaces, busy, onNewConnection, onOpenWorkspace }: WelcomePageProps) {
  return (
    <div className="welcome-page">
      <header>
        <h1>Willkommen in „{vaultName}“</h1>
        <p>{connectionCount === 0 ? 'Noch keine Verbindungen gespeichert. Leg die erste an.'
          : `${connectionCount} ${connectionCount === 1 ? 'Verbindung' : 'Verbindungen'} gespeichert. Doppelklick in der Liste links verbindet.`}</p>
      </header>
      <div className="welcome-grid">
        {workspaces.length > 0 && <section aria-labelledby="welcome-workspaces">
          <h2 id="welcome-workspaces">Workspaces</h2>
          <ul className="welcome-list">
            {workspaces.map(workspace => <li key={workspace.id}>
              <button type="button" disabled={busy} onClick={() => onOpenWorkspace(workspace.id)}>
                <strong>{workspace.name}</strong><small>{workspaceSummary(workspace)}</small>
              </button>
            </li>)}
          </ul>
        </section>}
        <section aria-labelledby="welcome-new">
          <h2 id="welcome-new">Neue Verbindung</h2>
          <ul className="welcome-list">
            {NEW_CONNECTION_KINDS.filter(kind => !kind.planned).map(kind => <li key={kind.protocol}>
              <button type="button" disabled={busy} onClick={() => onNewConnection(kind.protocol as ConnectionProtocol)}><strong>{kind.label}</strong></button>
            </li>)}
          </ul>
        </section>
        <section aria-labelledby="welcome-tips">
          <h2 id="welcome-tips">Gut zu wissen</h2>
          <ul className="welcome-tips">
            <li>Rechtsklick auf einen Ordner → <strong>Alle verbinden</strong> öffnet jede Verbindung darin als Tab.</li>
            <li>Tabs an den Rand eines Bereichs ziehen teilt ihn; aus dem Fenster ziehen öffnet ein eigenes Fenster.</li>
            <li>Ansichten oben bündeln mehrere Bereiche; ein Workspace speichert alle Ansichten und Fenster.</li>
            <li>Im Dateibrowser: F4 bearbeitet, F5 kopiert, Umschalt+F4 legt eine Datei an.</li>
          </ul>
          <FileTypeSetting />
        </section>
      </div>
    </div>
  );
}

/** Lets Explorer open `.term` vault files with Terminus (per user, no administrator rights). */
export function FileTypeSetting() {
  const [registered, setRegistered] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { void window.desktopApi.fileTypeStatus().then(setRegistered).catch(() => setRegistered(false)); }, []);
  const change = (register: boolean): void => {
    setPending(true); setMessage(null);
    void (register ? window.desktopApi.fileTypeRegister() : window.desktopApi.fileTypeUnregister())
      .then(() => { setRegistered(register); setMessage(register ? '.term-Dateien öffnen sich jetzt per Doppelklick oder Rechtsklick → „Mit Terminus öffnen“.' : 'Die Verknüpfung wurde entfernt.'); })
      .catch(() => setMessage('Die Verknüpfung konnte nicht geändert werden.'))
      .finally(() => setPending(false));
  };
  if (registered === null) return null;
  return (
    <div className="file-type-setting">
      <span>{registered ? 'Terminus ist mit .term-Dateien verknüpft.' : 'Vault-Dateien (.term) per Doppelklick im Explorer öffnen:'}</span>
      <button type="button" className="secondary-button" disabled={pending} onClick={() => change(!registered)}>
        {registered ? 'Verknüpfung entfernen' : 'In Windows einbinden'}</button>
      {message && <small role="status">{message}</small>}
    </div>
  );
}
