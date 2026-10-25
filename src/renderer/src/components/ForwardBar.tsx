import { useT } from '../i18n';
import { errorText } from '../error-text';
import { notify } from '../notice-store';
import type { ForwardState, ForwardStatus } from '../../../shared/ssh';
import '../forward-ui.css';

export interface ForwardBarProps {
  sessionId: string;
  forwards: ForwardStatus[];
}

const STATE_KEYS = {
  active: 'terminal:forwards.state.active', stopped: 'terminal:forwards.state.stopped',
  starting: 'terminal:forwards.state.starting', elsewhere: 'terminal:forwards.state.elsewhere',
} as const satisfies Record<Exclude<ForwardState, 'error'>, string>;
const BUTTON_KEYS = {
  active: 'terminal:forwards.stop', starting: 'terminal:forwards.stop', stopped: 'terminal:forwards.start',
  error: 'terminal:forwards.start',
} as const satisfies Record<Exclude<ForwardState, 'elsewhere'>, string>;

/** Bar below the output of a connected session; it lists the port forwards and starts or stops them. */
export function ForwardBar({ sessionId, forwards }: ForwardBarProps) {
  const { t } = useT();
  const run = async (forward: ForwardStatus): Promise<void> => {
    const start = forward.state !== 'active' && forward.state !== 'starting';
    try {
      await window.desktopApi.sshForward({ sessionId, forwardId: forward.id, run: start });
    } catch (caught) {
      notify.error(t('terminal:forwards.failedTitle'), { body: errorText(caught) });
    }
  };
  const forwardText = (forward: ForwardStatus): string => {
    const target = `${forward.targetHost}:${forward.targetPort}`;
    if (forward.kind === 'dynamic') return t('terminal:forwards.dynamic', { port: forward.localPort });
    if (forward.kind === 'local') return t('terminal:forwards.local', { port: forward.localPort, target });
    return t('terminal:forwards.remote', { port: forward.remotePort, target });
  };
  return (
    <div className="forward-bar" role="group" aria-label={t('terminal:forwards.label')}>
      <span className="forward-bar-label">{t('terminal:forwards.label')}</span>
      <ul className="forward-list">
        {forwards.map(forward => (
          <li key={forward.id} className="forward-item">
            <span className="forward-text">{forwardText(forward)}</span>
            {forward.state === 'error'
              ? <span className="forward-error">{errorText(forward.error)}</span>
              : <span className="forward-state">{t(STATE_KEYS[forward.state])}</span>}
            {forward.state === 'active' && forward.open > 0 && <span className="forward-open">{t('terminal:forwards.open', { count: forward.open })}</span>}
            {/* elsewhere: another tab holds the forward, so there is nothing to start or stop here */}
            {forward.state !== 'elsewhere' && <button type="button" className="forward-button"
              aria-label={forward.state === 'active' || forward.state === 'starting'
                ? t('terminal:forwards.stopLabel', { forward: forwardText(forward) })
                : t('terminal:forwards.startLabel', { forward: forwardText(forward) })}
              onClick={() => void run(forward)}>{t(BUTTON_KEYS[forward.state])}</button>}
          </li>
        ))}
      </ul>
    </div>
  );
}
