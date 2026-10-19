import { MAX_SSH_SESSIONS } from './ssh';

export type ConnectionErrorCode = 'auth' | 'timeout' | 'hostkey-changed' | 'hostkey-rejected' | 'hostkey-store'
  | 'refused' | 'not-found' | 'key-file' | 'agent' | 'limit' | 'closed-by-server' | 'unknown';
export type ConnectionAction = 'retry' | 'edit' | 'copy';
export const ACTION_LABELS: Readonly<Record<ConnectionAction, string>> = {
  retry: 'Erneut verbinden', edit: 'Verbindung bearbeiten', copy: 'Fingerprint kopieren',
};
export const DETAIL_LIMIT = 500;

export interface ConnectionErrorContext {
  /** connection.address, e.g. "deploy@10.0.4.21:22" or "Lokal · CMD". */
  address: string;
  /** Main text of the event or the rejected call; body of 'unknown' and 'hostkey-store'. */
  message?: string;
  /** false for local shells, local containers and pods: no host hint. */
  remote: boolean;
}
export interface ConnectionErrorText {
  title: string; body: string; next?: string;
  primary: ConnectionAction; secondary?: ConnectionAction;
}

/** "deploy@10.0.4.21:22" → { user: 'deploy', host: '10.0.4.21', port: '22' }; the port is the digits after the last ':'. */
export function splitAddress(address: string): { user?: string; host: string; port?: string } {
  const at = address.indexOf('@');
  const user = at > 0 ? address.slice(0, at) : undefined;
  let host = at > 0 ? address.slice(at + 1) : address;
  let port: string | undefined;
  const match = /^(.*):(\d+)$/.exec(host);
  if (match && match[1]) { host = match[1]; port = match[2]; }
  return { ...(user ? { user } : {}), host, ...(port ? { port } : {}) };
}

export function connectionError(code: ConnectionErrorCode, context: ConnectionErrorContext): ConnectionErrorText {
  const { user, host, port } = splitAddress(context.address);
  const hostPort = port ? `${host}:${port}` : host;
  switch (code) {
    case 'auth':
      return { title: 'Anmeldung abgelehnt',
        body: user ? `Der Server hat die Anmeldung als „${user}“ nicht angenommen.` : 'Der Server hat die Anmeldung nicht angenommen.',
        next: 'Prüfe Benutzer und Anmeldung in den Verbindungseinstellungen.', primary: 'edit', secondary: 'retry' };
    case 'timeout':
      return { title: 'Server antwortet nicht', body: `${hostPort} hat nicht rechtzeitig geantwortet.`,
        next: 'Prüfe VPN, Firewall und Port. Möglicherweise ist der Rechner aus.', primary: 'retry', secondary: 'edit' };
    case 'hostkey-changed':
      return { title: 'Server-Schlüssel hat sich geändert',
        body: 'Der Fingerprint stimmt nicht mit dem bestätigten überein. Shellherd hat die Verbindung abgebrochen.',
        next: 'Kläre den Schlüsselwechsel mit dem Administrator, bevor du fortfährst.', primary: 'copy', secondary: 'retry' };
    case 'hostkey-rejected':
      return { title: 'Server-Schlüssel nicht bestätigt', body: `Du hast den Schlüssel von ${hostPort} nicht bestätigt.`,
        next: 'Verbinde erneut und vergleiche den Fingerprint mit einer vertrauenswürdigen Quelle.', primary: 'retry', secondary: 'edit' };
    case 'hostkey-store':
      return { title: 'Server-Schlüssel nicht geprüft',
        body: context.message || 'Die gespeicherten Server-Schlüssel sind nicht verfügbar.',
        next: 'Prüfe die Zugriffsrechte auf den Shellherd-Datenordner und verbinde erneut.', primary: 'retry' };
    case 'refused':
      return { title: 'Verbindung abgelehnt',
        body: port ? `${host} nimmt auf Port ${port} keine Verbindung an.` : `${host} nimmt keine Verbindung an.`,
        next: 'Prüfe Host und Port. Läuft der SSH-Dienst?', primary: 'retry', secondary: 'edit' };
    case 'not-found':
      return { title: 'Host nicht gefunden', body: `Der Name „${host}“ ließ sich nicht auflösen.`,
        next: 'Prüfe Schreibweise, DNS und VPN.', primary: 'edit', secondary: 'retry' };
    case 'key-file':
      return { title: 'Schlüsseldatei nicht lesbar', body: 'Die private Schlüsseldatei fehlt oder ist nicht lesbar.',
        next: 'Prüfe Pfad und Zugriffsrechte in den Verbindungseinstellungen.', primary: 'edit', secondary: 'retry' };
    case 'agent':
      return { title: 'Kein SSH-Agent', body: 'Es läuft kein SSH-Agent, der den Schlüssel liefern könnte.',
        next: 'Starte den Agent oder wähle Passwort oder Schlüsseldatei.', primary: 'edit', secondary: 'retry' };
    case 'limit':
      return { title: `Maximal ${MAX_SSH_SESSIONS} Sessions`, body: 'Alle Sessions sind belegt.',
        next: 'Schließe zuerst einen Tab.', primary: 'retry' };
    case 'closed-by-server':
      return { title: 'Verbindung beendet', body: 'Der Server hat die Verbindung beendet.',
        next: 'Verbinde neu, wenn du weiterarbeiten willst.', primary: 'retry' };
    default:
      return { title: 'Verbindung fehlgeschlagen', body: context.message || 'Die Verbindung ist fehlgeschlagen.',
        ...(context.remote ? { next: 'Prüfe Host, Benutzer und Anmeldung.' } : {}), primary: 'retry', secondary: 'edit' };
  }
}
