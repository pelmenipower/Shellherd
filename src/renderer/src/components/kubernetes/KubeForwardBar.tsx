import type { KubeForwardStatus } from '../../../../shared/kubernetes';
import { errorText } from '../../error-text';
import { useT } from '../../i18n';
import { targetText } from '../../kube-forward';
import '../../forward-ui.css';

interface KubeForwardBarProps {
  forwards: KubeForwardStatus[];
  onOpen: (forward: KubeForwardStatus) => void;
  onCopy: (forward: KubeForwardStatus) => void;
  onStop: (forward: KubeForwardStatus) => void;
}

/** Bar at the bottom of the cluster view with the port forwards of this view; looks like the terminal's bar. */
export function KubeForwardBar({ forwards, onOpen, onCopy, onStop }: KubeForwardBarProps) {
  const { t } = useT();
  const text = (forward: KubeForwardStatus): string => t('kubernetes:forwards.item', { port: forward.localPort, target: targetText(forward.target) });
  return (
    <div className="forward-bar" role="group" aria-label={t('terminal:forwards.label')}>
      <span className="forward-bar-label">{t('terminal:forwards.label')}</span>
      <ul className="forward-list">
        {forwards.map(forward => (
          <li key={forward.id} className="forward-item">
            <span className="forward-text">{text(forward)}</span>
            {forward.target.kind === 'services' && forward.pod && forward.podPort !== undefined && (
              <span className="forward-state">{t('kubernetes:forwards.via', { pod: forward.pod, port: forward.podPort })}</span>
            )}
            {forward.error
              ? <span className="forward-error">{errorText(forward.error)}</span>
              : <span className="forward-state">{t('terminal:forwards.state.active')}</span>}
            {forward.open > 0 && <span className="forward-open">{t('terminal:forwards.open', { count: forward.open })}</span>}
            <button type="button" className="forward-button" aria-label={t('kubernetes:forwards.openLabel', { forward: text(forward) })}
              onClick={() => onOpen(forward)}>{t('kubernetes:forwards.open')}</button>
            <button type="button" className="forward-button" aria-label={t('kubernetes:forwards.copyLabel', { forward: text(forward) })}
              onClick={() => onCopy(forward)}>{t('kubernetes:forwards.copy')}</button>
            <button type="button" className="forward-button" aria-label={t('terminal:forwards.stopLabel', { forward: text(forward) })}
              onClick={() => onStop(forward)}>{t('terminal:forwards.stop')}</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
